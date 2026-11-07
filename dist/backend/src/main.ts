// 必须最先导入（副作用模块）：在 PrismaClient 构造之前把 backend/.env 注入 process.env
import { SettingsService } from './settings/settings.service';
import './common/load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { join } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import { gzipSync } from 'zlib';
import { AppModule } from './app.module';
import { ChannelsService } from './channels/channels.controller';
import { AccessService } from './access/access.service';
import { prisma } from './common/prisma';
import { SESSION_COOKIE, parseSession } from './auth/auth.guard';
import { rateLimiter } from './common/rate-limit';
import { appLog } from './common/app-log';
import { mergeDuplicateTags } from './common/tags';
import { CryptoService } from './common/crypto.service';
import { backendSub, frontendAppDir } from './common/project-paths';

// 接管 console —— 此后所有 console.log/warn/error 都会进入后台「系统日志」
appLog.patchConsole();

/** 黑白名单缓存（避免每请求查库） */
let listCache = { at: 0, white: [] as string[], block: [] as string[], enabled: false };

/**
 * 访问记录服务引用（v2.3.0）。
 *
 * 采集 /file/* 的中间件必须注册在 Nest 路由之前（否则命中不了这些路径），
 * 但 AccessService 要等 app.init() 之后才能从容器里取 ——
 * 所以先留一个「晚绑定」的引用，中间件里判空即可（启动瞬间的几百毫秒不做记录）。
 */
let accessSvc: AccessService | null = null;

async function loadLists() {
  if (Date.now() - listCache.at < 5000) return listCache;
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['whiteIpList', 'blockIpList', 'securityEnabled'] } },
  });
  const raw = (k: string) => rows.find((r) => r.key === k)?.value || '';
  const parse = (v: string): string[] => {
    if (!v) return [];
    try {
      const j = JSON.parse(v);
      return Array.isArray(j) ? j.map(String) : [];
    } catch {
      return v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    }
  };
  listCache = {
    at: Date.now(),
    white: parse(raw('whiteIpList')),
    block: parse(raw('blockIpList')),
    enabled: raw('securityEnabled') === 'true',
  };
  return listCache;
}

/**
 * 进程级兜底：单个请求的未捕获异常/未处理 Promise 不应导致整个图床服务退出。
 * 仅记录日志，保持服务可用（图床是长驻服务，漂掉一次就意味着所有外链 502）。
 */
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

function clientIp(req: express.Request): string {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  const ip = fwd || req.socket.remoteAddress || '';
  return ip.replace(/^::ffff:/, '');
}

function isLoopback(req: express.Request): boolean {
  const ip = clientIp(req);
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

/**
 * v2.6.0：白名单放行规则 —— 来源地址匹配（一行一条）。
 *
 * 规则（锚链接不算）：
 *   ① 访问来源地址与放行地址相符（去掉 #锚点 后相等）则放行；
 *   ② 访问来源地址包含放行地址（或等于）即放行 ——
 *      如放行 `192.168.1.3:5505`，则 `http://192.168.1.3:5505/?id=29` 等均放行；
 *      放行 `http://192.168.1.3:55105/?id=29`，则同地址带 #锚点 也放行。
 *
 * 参与匹配的「访问来源地址」（按优先级）：
 *   Referer → 本请求完整 URL（无 Referer 的直接访问）→ 客户端 IP（兼容历史纯 IP 条目）。
 */
function stripAnchor(s: string): string {
  return String(s || '').split('#')[0].trim();
}

/**
 * 去掉协议前缀与路径，返回 host[:port]（白名单按「域名 + 端口」比对）。
 * v2.8.5：统一小写、去尾部斜点，避免用户填 Example.COM 或 example.com. 时匹配不上。
 */
function hostOf(urlOrHost: string): string {
  const s = stripAnchor(urlOrHost).replace(/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//, '');
  const slash = s.indexOf('/');
  const host = slash === -1 ? s : s.slice(0, slash);
  return host.trim().toLowerCase().replace(/\.+$/, '');
}

/**
 * v2.8.2：白名单恢复为「按域名（含端口）匹配」。
 * 完整来源地址无法保证 100% 拿到（浏览器 Referrer 策略会把跨站 Referer 截成根地址），
 * 按完整地址匹配会误拦；域名+端口在任何场景都拿得到，稳定可靠。
 * 条目与来源都取 host:port 比对（带协议的条目、带路径的条目同样只取域名部分）。
 */
function sourceAllowed(entry: string, sources: string[]): boolean {
  const e = hostOf(entry);
  if (!e) return false;
  return sources.some((s) => {
    const h = hostOf(s);
    return !!h && h === e;
  });
}

function sourceAddressesOf(req: express.Request): string[] {
  const list: string[] = [];
  const referer = String(req.headers.referer || '').trim();
  if (referer) list.push(referer);
  const host = String(req.headers.host || '').trim();
  if (host) {
    const proto = req.protocol || 'http';
    list.push(`${proto}://${host}${req.originalUrl || req.url || ''}`);
  }
  const ip = clientIp(req);
  if (ip) list.push(ip);
  return list;
}

/**
 * 首次安装写入初始管理员账户（幂等）。
 *
 * 取值：ADMIN_USER / ADMIN_PASSWORD，未配置时用 admin / gohub。
 * 只有在「users 表里没有任何管理员」时才写；已有管理员 → 直接返回，
 * 保证后台改过的账号密码不会被下次启动覆盖。
 */
async function ensureInitialAdmin(): Promise<void> {
  const adminCount = await prisma.user.count({ where: { role: 'admin' } });
  if (adminCount > 0) return;

  const username = (process.env.ADMIN_USER || 'admin').trim() || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'gohub';
  const hash = CryptoService.hashPassword(password);

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    // 同名账户存在但不是管理员（历史数据）→ 提升为管理员并同步密码
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: 'admin', passwordHash: hash, uploadPassword: hash, enabled: true, canEdit: true, canDelete: true },
    });
    console.log(`[seed] 已把账户「${username}」提升为管理员（来自 ADMIN_USER / ADMIN_PASSWORD）`);
    return;
  }

  await prisma.user.create({
    data: {
      username,
      passwordHash: hash,
      uploadPassword: hash,
      nickname: '管理员',
      role: 'admin',
      enabled: true,
      canEdit: true,
      canDelete: true,
    },
  });
  const fromEnv = !!(process.env.ADMIN_USER || process.env.ADMIN_PASSWORD);
  console.log(
    `[seed] 已创建初始管理员账户：${username}` +
      `（密码取自 ${fromEnv ? 'ADMIN_PASSWORD' : '默认值 gohub'}，请登录后台后立即修改）`,
  );
}

async function bootstrap() {
  const server = express();
  // 反代场景：信任 X-Forwarded-Host / X-Forwarded-Proto
  server.set('trust proxy', true);
  /**
   * 请求到达时刻（毫秒）—— 必须挂在**所有**中间件之前：
   * 上传接口的 body 由 multer 先收完才进 handler，等 handler 再取时间会漏掉
   * 「客户端 → 服务端」的传输耗时，导致详情页「上传时长 / 上传速度」偏小。
   */
  server.use((req, _res, next) => {
    (req as unknown as { _arrivedAt?: number })._arrivedAt = Date.now();
    next();
  });
  server.use(cookieParser());
  // S3 协议接入（/s3/*）：请求体是对象的原始字节流，必须先于 JSON 解析器注册
  server.use('/s3', express.raw({ type: '*/*', limit: '200mb' }));

  /**
   * 对外 WebDAV（/dav/*）—— 必须在 CORS 预检与 body 解析器之前接管：
   *
   *  1) 挂载前必发 OPTIONS 探测能力头。Nest 的 enableCors() 会把 OPTIONS 当成
   *     CORS 预检直接以 204 短路（响应里完全没有 `DAV:` / `MS-Author-Via`），
   *     Windows 资源管理器 / RaiDrive / Cyberduck 据此判定「对方不是 WebDAV 服务」
   *     → 外部配置测试失败。这里显式应答 OPTIONS（不带鉴权，客户端探测时还没有凭据）。
   *
   *  2) PROPFIND 的 XML body 与 PUT 的二进制 body 不能被 JSON / text 解析器提前吃掉
   *     （PUT 一个 .json / .txt 文件时会命中 express.json / express.text，
   *      流被消费后 readBody() 会永久等不到数据 → 请求挂死）。
   *     统一在 /dav 上用 raw 收进 Buffer，body-parser 的 _body 标记会让后续解析器跳过。
   */
  server.use('/dav', (req, res, next) => {
    const method = String(req.method || '').toUpperCase();
    if (method === 'OPTIONS') {
      res.setHeader('DAV', '1,2');
      res.setHeader('MS-Author-Via', 'DAV');
      res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL');
      res.setHeader('Content-Length', '0');
      return res.status(200).end();
    }
    next();
  });
  server.use('/dav', express.raw({ type: '*/*', limit: '200mb' }));

  // 限制请求体大小（上传走 multer 例外）
  server.use(express.json({ limit: '2mb' }));
  // 黑白名单等接口以纯文本 body 提交（fetch 未设置 Content-Type 时默认为 text/plain）
  server.use(express.text({ type: ['text/plain'], limit: '1mb' }));

  /**
   * 黑白名单拦截（必须先于 Nest 路由注册才会生效）。
   * 三道保险避免自锁：默认关闭、本地回环豁免、已登录会话豁免。
   */
  server.use((req, res, next) => {
    loadLists()
      .then((lists) => {
        if (!lists.enabled) return next();
        if (isLoopback(req)) return next();
        if (parseSession(req.cookies?.[SESSION_COOKIE])) return next();
        const ip = clientIp(req);
        if (lists.block.includes(ip)) return res.status(403).send('Forbidden: IP blocked');
        if (lists.white.length > 0) {
          // v2.6.0：放行规则改为来源地址匹配（锚点忽略、包含即放行，兼容历史纯 IP 条目）
          const sources = sourceAddressesOf(req);
          if (!lists.white.some((entry) => sourceAllowed(entry, sources))) {
            console.error(
              `[security] 白名单拦截 ip=${ip} referer=${String(req.headers.referer || '-')} path=${req.originalUrl || req.url} ｜ 放行清单=${lists.white.join(',') || '(空)'}`,
            );
            return res.status(403).send('Forbidden: source not in whitelist');
          }
        }
        next();
      })
      .catch(() => next());
  });

  // 静态资源必须先于 Nest 路由注册（Nest 的 404 会终止链路）
  // 顺序关键：前端应用目录在前，public 目录在后 —— 否则 public/index.html 会劫持首页
  //
  // 目录布局（v1.6.0 起固定为「源码 / 产物分离，产物与后端并列」）：
  //   <parent>/frontend/app   前端产物（vite 输出，含 index.html）
  //   <parent>/backend/...    后端（build/ 产物 + src/ 源码）
  // 其中 <parent> = debug/（开发）或 dist/（生产）或 /app（容器）。
  // 定位逻辑统一在 common/project-paths.ts，不再按 cwd 硬拼路径。
  const frontendDir = frontendAppDir();
  if (frontendDir) {
    /*
     * v2.8.2 缓存策略：vite 产物文件名自带内容哈希（内容变 → 文件名变），
     * assets 目录里的 js/css 可以永久缓存（immutable）；
     * index.html 必须每次协商缓存（no-cache，命中 304 也极快），
     * 否则浏览器启发式缓存住旧 html、引用旧哈希资源 —— 表现为「系统更新后仍残留旧缓存」。
     * index: false —— index.html 统一由下方 SPA 回退发出，便于统一控制响应头。
     */
    /*
     * v3.0.0（R19）：静态产物 gzip 压缩（纯内置模块，不引入第三方依赖）。
     *
     * 为什么需要：入口 JS 约 1.7MB（gzip 后约 560KB），未压缩时首屏要下载全量文本，
     * 弱网 / 手机流量下等待明显。这里对 js / css / json / svg / txt 做一次压缩并缓存
     * （按「路径 + mtime」命中，文件更新后自动失效），之后直接用压缩结果响应。
     *
     * 安全边界：
     *   · 只处理 GET / HEAD，且客户端明确接受 gzip；
     *   · 只处理 frontendDir 下的真实文件，路径含 .. 一律跳过（防目录穿越）；
     *   · 命中不到文件就交给后面的 express.static / SPA 回退，行为完全不变；
     *   · 已带 Content-Encoding 的响应不重复压缩。
     * 若外层有 nginx 且已开 gzip，nginx 见到 Content-Encoding 会原样透传，不会二次压缩。
     */
    const GZIP_TYPES: Record<string, string> = {
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.txt': 'text/plain; charset=utf-8',
      '.map': 'application/json; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
    };
    const gzipCache = new Map<string, { mtime: number; body: Buffer }>();
    const GZIP_MAX_ENTRIES = 240;

    server.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return next();
      if (res.getHeader('Content-Encoding')) return next();
      let rel = req.path || '';
      if (!rel || rel === '/' || rel.includes('..')) return next();
      const dot = rel.lastIndexOf('.');
      if (dot < 0) return next();
      const ext = rel.slice(dot).toLowerCase();
      const contentType = GZIP_TYPES[ext];
      if (!contentType) return next();
      let full: string;
      try {
        rel = decodeURIComponent(rel);
        if (rel.includes('..')) return next();
        full = join(frontendDir, rel);
      } catch (e) {
        return next();
      }
      let st;
      try {
        st = statSync(full);
        if (!st.isFile()) return next();
      } catch (e) {
        return next();
      }
      // 太小的文件压缩收益为负（gzip 头 + 额外开销），交给原流程
      if (st.size < 1024) return next();
      try {
        const hit = gzipCache.get(full);
        let body: Buffer;
        if (hit && hit.mtime === st.mtimeMs) {
          body = hit.body;
        } else {
          body = gzipSync(readFileSync(full), { level: 6 });
          if (gzipCache.size >= GZIP_MAX_ENTRIES) gzipCache.clear();
          gzipCache.set(full, { mtime: st.mtimeMs, body });
        }
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Content-Length', String(body.length));
        res.setHeader(
          'Cache-Control',
          /[/\\]assets[/\\]/.test(full) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
        if (req.method === 'HEAD') return res.status(200).end();
        return res.status(200).end(body);
      } catch (e) {
        return next();
      }
    });

    server.use(express.static(frontendDir, {
      index: false,
      setHeaders(res, filePath) {
        if (/[/\\]assets[/\\]/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }));
  }

  // SPA 历史路由回退：/dashboard、/systemConfig、/browse/xx 等深链接刷新时回落到 index.html。
  // 顺序关键：必须在静态资源之后（静态文件优先命中）、Nest 路由之前（Nest 的 404 会终止链路）；
  // 接口与文件分发路径一律放行给后端；带扩展名的请求直接 404，避免掩盖真实的资源缺失。
  const SPA_SKIP = /^\/(api|upload|file|random|dav|dev|s3)(\/|$)/;
  if (frontendDir) {
    server.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (SPA_SKIP.test(req.path)) return next();
      if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next();
      // 显式声明「只接受非 HTML」的请求不回落（例如脚本抓取 JSON 资源）
      const accept = req.headers.accept || '';
      if (accept && !accept.includes('*/*') && !accept.includes('text/html')) return next();
      // v2.8.2：index.html 协商缓存 —— 更新后浏览器总能立刻拿到新版本入口
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(join(frontendDir, 'index.html'));
    });
  }

  /**
   * 接口限流：防登录爆破、防上传灌图、防随机图/直链被刷。
   * 顺序关键 —— 放在静态资源与 SPA 回退之后：
   *   静态产物与页面导航已被前面的中间件响应，不会再进入限流器，
   *   这里只覆盖 /api/*、/upload、/file/* 等真正需要保护的动态请求。
   */
  server.use(rateLimiter());

  /**
   * HTTP 访问日志（后台「系统日志」页可见）。
   * 记录策略：所有写操作（上传/保存/删除）+ 任何 4xx/5xx + 慢请求；
   * 成功的 GET 跳过 —— 后台页面会轮询系统状态，否则日志会被轮询刷爆。
   */
  server.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      try {
        const ms = Date.now() - started;
        const status = res.statusCode;
        const isFile = req.path.startsWith('/file/');
        const isWrite = req.method !== 'GET' && req.method !== 'HEAD';
        if (isFile && status < 400) return; // 直链访问量极大，正常请求不记
        if (!isWrite && status < 400 && ms < 3000) return; // 正常 GET 不记（防轮询刷屏）
        const line = `${req.method} ${req.originalUrl} → ${status} (${ms}ms)`;
        const ip = clientIp(req);
        if (status >= 500) appLog.error('http', line, undefined, ip);
        else if (status >= 400) appLog.warn('http', line, undefined, ip);
        else if (ms >= 3000) appLog.warn('http', `${line} [慢请求]`, undefined, ip);
        else appLog.info('http', line, undefined, ip);
      } catch {
        /* 日志失败不影响响应 */
      }
    });
    next();
  });

  /**
   * 访问记录采集（v2.3.0）—— 只覆盖「前端拿不到」的那部分：
   *   /file/*  外链直链访问（图床最关心的数据：谁在什么时候从哪个域名引用了哪张图）
   *   /random  随机图 API
   *
   * 站内 SPA 页面不在这里记：路由切换不经过服务端，改由前端 POST /api/access/visit 上报，
   * 顺带能把「停留时长 / 跳转链接」带回来。
   * 管理端预览（?from=admin）与本地回环访问不计入，否则后台自己点一下就刷一条。
   */
  server.use((req, res, next) => {
    const isFile = req.path.startsWith('/file/') || req.path === '/random';
    if (!isFile || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    if (req.query.from === 'admin') return next();
    res.on('finish', () => {
      try {
        if (!accessSvc) return;
        const ip = clientIp(req);
        if (!ip || ip === '127.0.0.1' || ip === '::1') return;
        const session = parseSession(req.cookies?.[SESSION_COOKIE]);
        void accessSvc.record({
          ip,
          path: req.path,
          referer: String(req.headers.referer || ''),
          username: session?.user || '',
          ua: String(req.headers['user-agent'] || ''),
          method: req.method,
          status: res.statusCode,
          kind: 'file',
        });
      } catch {
        /* 采集失败不影响响应 */
      }
    });
    next();
  });

  // public/ 只放开发用测试页（upload-test.html），不占用 index.html
  const publicDir = backendSub('public');
  if (existsSync(publicDir)) server.use('/dev', express.static(publicDir));

  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { logger: ['error', 'warn', 'log'] });
  app.enableCors({ origin: true, credentials: true });

  await app.init();

  // v2.0.0：数据库只支持 PostgreSQL，SQLite 时代的 PRAGMA 稳定性垫片（WAL /
  // busy_timeout / synchronous）已随 SQLite 双轨一并移除；PG 的并发控制由服务端自己管理。

  /*
   * 内置「本地存储」渠道：随启动幂等创建。
   * 必须放在 app.init() 之后（此时 Prisma 已连接、db push 已完成建表），
   * 且要在开始接请求之前 —— 否则首次安装的头几个请求会因找不到任何渠道而失败。
   */
  try {
    await app.get(ChannelsService).ensureBuiltinLocalChannel();
    await app.get(ChannelsService).ensureBuiltinLocalFilesChannel();
  } catch (err) {
    console.warn(`[local-channel] 内置本地存储渠道初始化失败：${(err as Error).message}`);
  }

  /*
   * v3.0.0（R10）：预热「外链访问域名」缓存。
   * 签发函数 signOrigin() 是同步的（上传响应、WebDAV、API Token 等十几个调用点），
   * 若不在启动时读一次配置，第一次签发会退化成按请求头推断的域名。
   */
  try {
    await app.get(SettingsService).getServerDomain();
  } catch {
    /* 设置读取失败时按动态浏览域名兜底 */
  }

  /*
   * 访问记录：晚绑定服务引用（见文件顶部 accessSvc 说明），
   * 并在启动时 + 每 6 小时按「保留天数」清理一次历史数据（默认 90 天，设置项可改）。
   */
  try {
    const svc = app.get(AccessService);
    accessSvc = svc;
    void svc.cleanup();
    const timer = setInterval(() => void svc.cleanup(), 6 * 3600 * 1000);
    timer.unref?.();
  } catch (err) {
    console.warn(`[access] 访问记录服务初始化失败：${(err as Error).message}`);
  }

  /*
   * 初始管理员账户（v2.0.0）：首次安装把 yaml/.env 里的管理员配置落成 users 表里的
   * 真实记录 —— 此后「用户管理」里能看到它，也能正常改密码/改权限。
   *
   *   · ADMIN_USER / ADMIN_PASSWORD 有配置 → 用配置值；
   *   · 都没配置 → 用默认 admin / gohub；
   *   · 库里已存在管理员 → 完全不动（尊重后台改过的账号密码，重启不会回滚）。
   *
   * 说明：登录校验本身还有「环境变量兜底」通道（见 AuthController.verifyAccount），
   * 所以即使这一步失败，首次登录也不会被卡住；但落库后才是完整的初始数据。
   */
  try {
    await ensureInitialAdmin();
  } catch (err) {
    console.warn(`[seed] 初始管理员账户写入失败：${(err as Error).message}`);
  }

  // CONFIG_SECRET 缺失时 CryptoService 会退化成内置开发密钥 —— 渠道密钥虽能加密，
  // 但任何人拿到代码就能解开。首次部署必须显式配置，这里给出醒目告警。
  const secret = process.env.CONFIG_SECRET || '';
  if (!secret || /^(please-change|change-me)/.test(secret)) {
    console.warn(
      '[security] ⚠️ CONFIG_SECRET 未配置或仍是模板默认值：渠道密钥将使用内置开发密钥加密，' +
        '请尽快在 .env / compose 里设置随机长串（修改后已保存的渠道密钥需重新填写）。',
    );
  }

  /*
   * v1.0.2：标签确权模型迁移 —— 旧库里同实例同名标签可能分属不同 owner（多条），
   * 新模型下它们应当合并成一条。这里在启动时做一次幂等合并，把 file_tags 关联并到最早那条。
   */
  try {
    const merged = await mergeDuplicateTags();
    if (merged) {
      console.log(`[tag] 已合并历史重复标签 ${merged} 条（实例 + 类型 + 名称 确权迁移）`);
      appLog.info('file', `标签确权迁移：合并重复标签 ${merged} 条`, '实例 + 类型 + 名称 作为唯一口径');
    }
  } catch (err) {
    console.warn(`[tag] 标签去重失败：${(err as Error).message}`);
  }

  const port = Number(process.env.PORT || 3619);
  await app.listen(port, '0.0.0.0');
  /*
   * v2.8.3：大文件上传 / 合并 / ffmpeg 压缩可能持续数分钟。
   * Node 18+ 默认 requestTimeout=300s，会在慢速网络传 500MB 时把请求掐断 →
   * 默认改为 0（不限制），需要强制超时可设 UPLOAD_REQUEST_TIMEOUT_MS。
   */
  const httpServer = app.getHttpServer();
  const uploadTimeout = Number(process.env.UPLOAD_REQUEST_TIMEOUT_MS || 0);
  httpServer.requestTimeout = Number.isFinite(uploadTimeout) && uploadTimeout >= 0 ? uploadTimeout : 0;
  httpServer.headersTimeout = 120_000;
  httpServer.keepAliveTimeout = 65_000;
  console.log(`GoHub 已启动: http://localhost:${port}`);
}

bootstrap();
