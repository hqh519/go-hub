/**
 * 对外 WebDAV（v1.0.6 重构）。
 *
 * ⚠️ 与前几版的根本差别：**本版不再走图床上传链路**。
 * 旧实现把 PUT 交给 UploadService，等于把网盘当图床用 —— 文件会被命名规则改名、
 * 可能被转码/压缩/转 WebP，还会写进「图床文件」和「历史记录」。
 * 现在 WebDAV 就是一块**纯网盘目录**：文件原样进磁盘，原样读出来。
 *
 * 访问模型：
 *   根目录    `<后端根>/webdav`
 *   账户目录  `webdav/{用户名}`
 *   渠道目录  `webdav/{用户名}/{渠道存储路径}`
 *
 * 鉴权（Basic）：
 *   用户名 = 账户登录名
 *   密码   = 该账户下某个 WebDAV 渠道的**访问密钥**（16 位随机串）
 *   —— 用户密码不再能用于 WebDAV 登录（需求：只能使用渠道自身的访问密钥）。
 *   —— 管理员账户一律禁止使用（`role !== 'user'` 直接 403）。
 *   —— 全局开关「系统管理 → 安全设置 → 对外 WebDAV」关闭时，一切请求 403。
 *
 * 支持方法：OPTIONS / PROPFIND / GET / HEAD / PUT / DELETE / MKCOL / MOVE / COPY / PROPPATCH
 */
import { All, Controller, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { createReadStream, createWriteStream, promises as fsp } from 'fs';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { prisma } from '../common/prisma';
import { SysConfigService } from '../settings/sysconfig.service';
import { appLog } from '../common/app-log';
import {
  channelRoot,
  cleanRelPath,
  ensureDir,
  invalidateDavCache,
  listDir,
  mimeOf,
  resolveInside,
} from './webdav.storage';

/** 鉴权结果：带上「这次请求落在哪个渠道」 */
interface DavAuth {
  ok: boolean;
  username: string;
  channelId: string;
  channelName: string;
  channelPath: string;
}

@Controller()
export class WebDavController {
  constructor(private sysConfig: SysConfigService) {}

  /**
   * 全局开关（系统管理 → 安全设置 → 对外 WebDAV）。
   *
   * 注意存的位置：这一段的配置由前端写进 sysConfig 的 **others 分区**
   * （`{ webdav: { enabled, rootPath, readonly } }`），不在 security 分区里。
   * 早前版本读的是 readSecurityRaw()，永远读不到 → 关掉开关也拦不住请求。
   */
  private async enabled(): Promise<boolean> {
    try {
      const cfg: any = await this.sysConfig.get('others');
      const w = cfg?.webdav || {};
      return w.enabled === true || String(w.enabled) === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Basic 鉴权：用户名 + 渠道访问密钥。
   *
   * 一个账户可以有多个渠道，密钥唯一 → 由密钥反查出「这次挂载的是哪个目录」。
   * 这样同一个人可以在 Finder 里同时挂载「文件」和「工作」两个盘。
   */
  private async authenticate(req: Request): Promise<DavAuth> {
    const fail: DavAuth = { ok: false, username: '', channelId: '', channelName: '', channelPath: '' };
    const hdr = String(req.headers['authorization'] || '');
    if (!hdr.toLowerCase().startsWith('basic ')) return fail;
    let user = '';
    let key = '';
    try {
      const decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      user = decoded.slice(0, i).trim();
      key = decoded.slice(i + 1).trim();
    } catch {
      return fail;
    }
    if (!user || !key) return fail;

    const u = await prisma.user.findUnique({ where: { username: user } });
    /*
     * 需求：管理员账户禁止使用 WebDAV —— 只能通过普通用户启用。
     * 这里连同「已停用账户」一起拦掉（停用后仍然能挂盘读写是很糟糕的体验）。
     */
    if (!u || !u.enabled || u.role !== 'user') return fail;
    if (!u.webdavEnabled) return fail;

    const ch = await prisma.webDavChannel.findFirst({ where: { username: user, accessKey: key } });
    if (!ch) return fail;
    return { ok: true, username: user, channelId: ch.id, channelName: ch.name, channelPath: ch.path };
  }

  /** 401 应答（带 WWW-Authenticate，客户端才会弹账号框） */
  private basic(res: Response) {
    res.setHeader('WWW-Authenticate', 'Basic realm="GoHub WebDAV"');
    return res.status(401).send('Unauthorized');
  }

  /** 请求路径 → 渠道内相对路径（去掉 /dav 前缀） */
  private davRelPath(req: Request): string {
    const qIdx = req.originalUrl.indexOf('?');
    const raw = (qIdx === -1 ? req.originalUrl : req.originalUrl.slice(0, qIdx)).replace(/^\/dav\/?/, '');
    let p = '';
    try {
      p = decodeURIComponent(raw);
    } catch {
      p = raw;
    }
    return cleanRelPath(p);
  }

  /** 拼 href：集合固定带一个结尾斜杠 */
  private hrefOf(origin: string, rel: string, dir: boolean): string {
    const segs = String(rel || '')
      .split('/')
      .filter(Boolean)
      .map((s) => encodeURIComponent(s));
    const tail = segs.length ? `/${segs.join('/')}` : '';
    return `${origin}/dav${tail}${dir ? '/' : ''}`;
  }

  private xmlEscape(s: string): string {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 统一入口。
   *
   * ⚠️ 必须写成**一个**装饰器 + 路径数组（同 v1.0.0 的教训）：
   * 两个 @All 叠在同一个方法上时，后一个会把前一个的路径元数据覆盖掉，
   * 结果只有 `/dav` 注册成功，`PROPFIND /dav/xxx` 全 404。
   */
  @All(['dav', 'dav/*'])
  async handle(@Req() req: Request, @Res() res: Response) {
    if (!(await this.enabled())) return res.status(403).send('WebDAV 未启用');

    const method = String(req.method || '').toUpperCase();
    // OPTIONS 在客户端还没有凭据时就会发，不能要求鉴权
    if (method === 'OPTIONS') {
      res.setHeader('DAV', '1,2');
      res.setHeader('MS-Author-Via', 'DAV');
      res.setHeader(
        'Allow',
        'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY',
      );
      return res.status(200).send('');
    }

    const auth = await this.authenticate(req);
    if (!auth.ok) return this.basic(res);

    const rel = this.davRelPath(req);
    const root = channelRoot(auth.username, auth.channelPath);
    const abs = resolveInside(root, rel);
    if (!abs) return res.status(403).send('路径越界');
    // 渠道根目录按需创建（首次挂载时还不存在）
    try {
      await ensureDir(root);
    } catch {
      /* 目录建不出来会在下面的操作里报错 */
    }

    try {
      switch (method) {
        case 'PROPFIND':
          return await this.propfind(req, res, root, rel, abs);

        case 'GET':
        case 'HEAD':
          return await this.getFile(req, res, abs, method === 'HEAD');

        case 'PUT':
          return await this.putFile(req, res, abs, root);

        case 'MKCOL':
          return await this.mkcol(res, abs);

        case 'DELETE':
          return await this.remove(res, abs, root);

        case 'MOVE':
          return await this.moveOrCopy(req, res, root, abs, true);

        case 'COPY':
          return await this.moveOrCopy(req, res, root, abs, false);

        case 'PROPPATCH':
          // 不维护自定义属性，但必须回 207，否则部分客户端（Windows）会认为属性写入失败
          return res
            .status(207)
            .setHeader('Content-Type', 'application/xml; charset=utf-8')
            .send('<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:"></D:multistatus>');

        default:
          return res.status(405).send('Method Not Allowed');
      }
    } catch (err) {
      appLog.error('webdav', `${method} ${rel} 失败（账户=${auth.username}）`, (err as Error).message);
      return res.status(500).send((err as Error).message);
    }
  }

  /** v1.0.7：字符串 → 32 位 FNV-1a 十六进制（给 PROPFIND 生成 ETag 用） */
  private bodyTag(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  /* ------------------------------------------------------------------ */
  /* PROPFIND                                                            */
  /* ------------------------------------------------------------------ */

  private async propfind(req: Request, res: Response, root: string, rel: string, abs: string) {
    const origin = `${req.protocol}://${req.headers.host || req.headers['x-forwarded-host'] || 'localhost'}`;
    const depth = String(req.headers.depth ?? '1').trim().toLowerCase();
    const selfOnly = depth === '0';

    let st;
    try {
      st = await fsp.stat(abs);
    } catch {
      return res.status(404).send('Not Found');
    }

    const entries: string[] = [];
    const statXml = (p: string, dir: boolean, size: number, mtime: Date) =>
      `<D:response><D:href>${this.xmlEscape(this.hrefOf(origin, p, dir))}</D:href><D:propstat><D:prop>` +
      (dir
        ? '<D:resourcetype><D:collection/></D:resourcetype><D:getcontentlength>0</D:getcontentlength><D:getcontenttype>httpd/unix-directory</D:getcontenttype>'
        : `<D:resourcetype/><D:getcontentlength>${size}</D:getcontentlength><D:getcontenttype>${this.xmlEscape(mimeOf(p))}</D:getcontenttype>`) +
      `<D:getlastmodified>${mtime.toUTCString()}</D:getlastmodified>` +
      `<D:creationdate>${new Date(mtime).toISOString()}</D:creationdate>` +
      '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';

    entries.push(statXml(rel, st.isDirectory(), st.size, st.mtime));

    if (!selfOnly && st.isDirectory()) {
      try {
        const children = await listDir(abs, rel);
        for (const c of children) {
          entries.push(statXml(c.rel, c.dir, c.size, c.mtime));
        }
      } catch (err) {
        appLog.warn('webdav', `列目录失败：${rel}`, (err as Error).message);
      }
    }

    const body = `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">\n${entries.join('\n')}\n</D:multistatus>`;
    /*
     * v1.0.7：给目录清单加 ETag + 条件请求。
     *
     * 目录内容一变（mtime / 条目数 / 各条目大小与时间任一变化）ETag 必变，
     * 所以这里直接对响应体做一次轻量哈希（FNV-1a），不额外 stat、也不占内存。
     * 客户端（同步工具、Finder 预取）带 If-None-Match 回来时，命中就回 304，
     * 连 XML 都不用再序列化一遍。
     */
    const etag = `"dav-${this.bodyTag(body)}"`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('ETag', etag);
    const inm = String(req.headers['if-none-match'] || '').trim();
    if (inm && inm.split(',').some((v) => v.trim() === etag)) {
      res.status(304).end();
      return;
    }
    res.status(207);
    return res.send(body);
  }

  /* ------------------------------------------------------------------ */
  /* GET / HEAD                                                          */
  /* ------------------------------------------------------------------ */

  private async getFile(req: Request, res: Response, abs: string, headOnly: boolean) {
    let st;
    try {
      st = await fsp.stat(abs);
    } catch {
      return res.status(404).send('Not Found');
    }
    if (st.isDirectory()) return res.status(405).send('目录不支持直接下载');

    res.setHeader('Content-Type', mimeOf(abs));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Last-Modified', st.mtime.toUTCString());
    /*
     * v1.0.6：告诉 Nginx「这段响应不要缓冲」。
     * 不声明的话 Nginx 默认会把整个文件先收进自己的临时目录再吐给客户端，
     * 下载一个几 GB 的文件会先卡住十几秒，还平白多占一份磁盘。
     * 有没有 Nginx 都不影响功能，只是一个透传提示。
     */
    res.setHeader('X-Accel-Buffering', 'no');
    // 网盘内容按修改时间协商，避免客户端一直拿到旧文件
    res.setHeader('ETag', `"${st.size}-${st.mtimeMs}"`);

    /*
     * Range 支持：视频客户端 / 播放器拖进度条要靠它，
     * 不支持的话整段重传，体验极差。
     */
    const range = String(req.headers.range || '');
    if (range.startsWith('bytes=')) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.replace(/^bytes=/, 'bytes='));
      const startRaw = m?.[1] || '';
      const endRaw = m?.[2] || '';
      let start = startRaw ? Number(startRaw) : 0;
      let end = endRaw ? Number(endRaw) : st.size - 1;
      if (!startRaw && endRaw) {
        // bytes=-N：最后 N 字节
        start = Math.max(0, st.size - Number(endRaw));
        end = st.size - 1;
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= st.size) {
        res.setHeader('Content-Range', `bytes */${st.size}`);
        return res.status(416).send('');
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      if (headOnly) return res.end();
      return pipeline(createReadStream(abs, { start, end }), res).catch(() => undefined);
    }

    res.setHeader('Content-Length', String(st.size));
    if (headOnly) return res.end();
    return pipeline(createReadStream(abs), res).catch(() => undefined);
  }

  /* ------------------------------------------------------------------ */
  /* PUT                                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * 上传：**流式落盘**，不经过任何图床处理。
   *
   * 为什么不用 readBody 全量缓冲：网盘客户端动辄推几个 GB 的文件，
   * 缓冲进内存等于直接把进程打死。这里直接把请求流 pipe 到磁盘，
   * 顺带也就没有了「单文件大小限制」。
   *
   * 写入用「临时文件 + rename」：客户端中途断线时不会留下半截文件
   * （否则下次同步会认为文件已存在且完整）。
   */
  private async putFile(req: Request, res: Response, abs: string, root: string) {
    const dir = path.dirname(abs);
    const rootAbs = path.resolve(root);
    const dirAbs = path.resolve(dir);
    // 父目录也必须在渠道根内（防止 ../ 拼出根外路径）
    if (dirAbs !== rootAbs && !dirAbs.startsWith(rootAbs + path.sep)) {
      return res.status(403).send('路径越界');
    }
    await ensureDir(dir);

    /*
     * 临时文件命名：`.dav-tmp-{时间戳}-{随机串}`
     *   · 点开头 → PROPFIND（listDir 跳过隐藏项）与「本地文件」都不会显示它，
     *     中断后残留的碎片不会变成网盘里的垃圾文件；
     *   · 随机串 → 同一毫秒内并发 PUT 同一个文件（同步工具经常这么干）不会互相踩；
     *   · 与目标同目录 → rename 是同分区操作，原子且不复制数据。
     */
    const tmp = path.join(dir, `.dav-tmp-${Date.now()}-${randomBytes(6).toString('hex')}`);
    const exists = await fsp
      .stat(abs)
      .then(() => true)
      .catch(() => false);

    try {
      const body = (req as unknown as { body?: unknown }).body;
      if (Buffer.isBuffer(body)) {
        // 小文件被上游 raw 中间件收成了 Buffer（某些客户端会带 Content-Type 骗过路由）
        await fsp.writeFile(tmp, body);
      } else {
        /*
         * 流式落盘：请求体多大，内存占用都是恒定的一小块。
         * 客户端中途断开时 pipeline 以 ERR_STREAM_PREMATURE_CLOSE 拒绝 →
         * 走下面的 catch，删掉临时文件；**已存在的原文件一个字节都不动**，
         * 客户端下次同步会重传，而不是留下一个半截文件冒充完整文件。
         */
        await pipeline(req, createWriteStream(tmp));
      }

      /*
       * 先 fsync 再 rename。
       *
       * rename 只改目录项，数据可能还躺在页缓存里。不 fsync 的话会出现
       * 「客户端已经收到 201、容器这时被重启，回来一看文件是 0 字节」——
       * 这是网盘类应用最典型的「文件掉了」。代价是每个文件多一次 fsync，
       * 相对网络传输可以忽略。
       */
      const fh = await fsp.open(tmp, 'r+');
      try {
        await fh.sync();
      } finally {
        await fh.close();
      }

      try {
        await fsp.rename(tmp, abs);
      } catch (err) {
        /*
         * Linux 上 rename 覆盖是原子的；Windows 上目标正被读取时会 EPERM/EACCES。
         * 生产跑在容器里（Linux）不会走到这里，开发机（Windows）退化成「先删再改名」。
         */
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EPERM' || code === 'EACCES' || code === 'EEXIST') {
          await fsp.rm(abs, { force: true });
          await fsp.rename(tmp, abs);
        } else {
          throw err;
        }
      }
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
      /*
       * 客户端自己断开时不要再往已经死掉的 socket 写响应 ——
       * 否则 Express 会抛 "Cannot set headers after they are sent"，
       * 日志里刷满毫无意义的 500，真正的错误反而被埋了。
       */
      if (req.destroyed || res.headersSent) {
        if (!res.writableEnded && res.writable) res.end();
        return;
      }
      const code = (err as NodeJS.ErrnoException).code;
      const msg = code === 'ENOSPC' ? '服务器磁盘空间不足' : '写入失败';
      appLog.error('webdav', `PUT 失败 ${path.basename(abs)}`, err, this.clientIp(req));
      return res.status(code === 'ENOSPC' ? 507 : 500).send(msg);
    }
    // 201 = 新建，204 = 覆盖（标准 WebDAV 语义）
    // v1.0.7：写入成功 → 目录列举缓存立即失效（否则同秒内的 PROPFIND 会看到旧列表）
    invalidateDavCache();
    return res.status(exists ? 204 : 201).send('');
  }

  /** 客户端 IP（只用于日志，取 X-Forwarded-For 首段） */
  private clientIp(req: Request): string {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = fwd || req.socket?.remoteAddress || '';
    return ip.replace(/^::ffff:/, '');
  }

  /* ------------------------------------------------------------------ */
  /* MKCOL / DELETE / MOVE / COPY                                        */
  /* ------------------------------------------------------------------ */

  private async mkcol(res: Response, abs: string) {
    const exists = await fsp
      .stat(abs)
      .then(() => true)
      .catch(() => false);
    if (exists) return res.status(405).send('已存在');
    await ensureDir(abs);
    invalidateDavCache();
    return res.status(201).send('');
  }

  private async remove(res: Response, abs: string, root: string) {
    // 不允许删掉渠道根目录本身（客户端清理时会尝试，删了就整个盘没了）
    if (path.resolve(abs) === path.resolve(root)) return res.status(403).send('不能删除网盘根目录');
    const exists = await fsp
      .stat(abs)
      .then(() => true)
      .catch(() => false);
    if (!exists) return res.status(404).send('Not Found');
    await fsp.rm(abs, { recursive: true, force: true });
    invalidateDavCache();
    return res.status(204).send('');
  }

  /**
   * MOVE / COPY：目标地址来自 `Destination` 头（完整 URL）。
   * 需要剥掉 `http://host/dav` 前缀再拼回渠道根 —— 直接当路径用会拼出一个奇怪的文件名。
   */
  private async moveOrCopy(req: Request, res: Response, root: string, abs: string, move: boolean) {
    const destRaw = String(req.headers.destination || '');
    if (!destRaw) return res.status(400).send('缺少 Destination');
    let destPath = destRaw;
    try {
      const u = new URL(destRaw);
      destPath = decodeURIComponent(u.pathname);
    } catch {
      /* 不是完整 URL：当作路径处理 */
    }
    destPath = destPath.replace(/^\/dav\/?/, '');
    const destAbs = resolveInside(root, destPath);
    if (!destAbs) return res.status(403).send('路径越界');
    if (path.resolve(destAbs) === path.resolve(root)) return res.status(403).send('不能覆盖网盘根目录');

    const srcExists = await fsp
      .stat(abs)
      .then(() => true)
      .catch(() => false);
    if (!srcExists) return res.status(404).send('Not Found');

    await ensureDir(path.dirname(destAbs));
    // Overwrite: F → 目标存在时报 412
    const overwrite = String(req.headers.overwrite || 'T').toUpperCase() !== 'F';
    const destExists = await fsp
      .stat(destAbs)
      .then(() => true)
      .catch(() => false);
    if (destExists && !overwrite) return res.status(412).send('目标已存在');

    if (move) {
      /*
       * v1.0.6：MOVE **先尝试直接 rename**，不要一上来就删目标。
       * Linux 上 rename 覆盖是原子的，源和目标始终至少有一份是完整的；
       * 若先 rm 再 rename，中途失败（权限、磁盘满、进程被杀）就是**两份都没了** ——
       * 对网盘来说这是最不能接受的失败方式。
       * 只有 Windows 上目标被占用（EPERM/EACCES/ENOTEMPTY）才退化成「先删再改名」。
       */
      try {
        await fsp.rename(abs, destAbs);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const retriable = code === 'EPERM' || code === 'EACCES' || code === 'EEXIST' || code === 'ENOTEMPTY';
        if (!retriable || !destExists) throw err;
        await fsp.rm(destAbs, { recursive: true, force: true });
        await fsp.rename(abs, destAbs);
      }
    } else {
      // COPY 是「再写一份」，目标必须先腾出来；先写到临时名再替换，避免复制中途失败留下半份
      const tmpDest = path.join(
        path.dirname(destAbs),
        '.dav-copy-' + Date.now() + '-' + randomBytes(6).toString('hex'),
      );
      try {
        await fsp.cp(abs, tmpDest, { recursive: true });
        if (destExists) await fsp.rm(destAbs, { recursive: true, force: true });
        await fsp.rename(tmpDest, destAbs);
      } catch (err) {
        await fsp.rm(tmpDest, { recursive: true, force: true }).catch(() => undefined);
        throw err;
      }
    }
    // v1.0.7：MOVE / COPY 同样要让目录缓存失效（目标目录多了一项）
    invalidateDavCache();
    return res.status(destExists ? 204 : 201).send('');
  }
}
