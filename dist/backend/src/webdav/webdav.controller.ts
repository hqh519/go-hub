import { signOrigin } from '../common/request-origin';
import { All, Controller, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { prisma } from '../common/prisma';
import { CryptoService } from '../common/crypto.service';
import { SettingsService } from '../settings/settings.service';
import { SysConfigService } from '../settings/sysconfig.service';
import { UploadService } from '../upload/upload.service';
import { StorageChannelService } from '../storage/storage-channel.service';
import { extSuffixFor } from '../common/file-view';
import { appLog } from '../common/app-log';

/**
 * 对外 WebDAV 访问（系统管理 → 其他设置 → 对外 WebDAV）。
 *
 * 机制与 CloudFlare-ImgBed 原系统一致：把图床挂成一个 WebDAV 网盘，
 * 用任意 WebDAV 客户端（Finder / 资源管理器 / RaiDrive…）即可浏览与上传。
 *
 * 上传渠道（本版起）：不再单独配置「上传渠道」，统一由 StorageChannelService
 * 的 getStorageChannel 决定 —— 用「配置这个 WebDAV 的账户」去查「用户管理」里
 * 为该账户指定的主/备渠道，没有指定则回退后台「上传设置」里的全局主/备渠道。
 *
 * 特殊定位（WebDAV 的「类型和大小限制」跟随授权账户）：
 *   与网页上传同源 —— 由「用户管理 → 编辑用户 → 类型和大小限制」决定：
 *   开启（默认）则受「允许上传格式 + 单文件大小上限」约束；
 *   关闭则跳过这两项（魔数比对仍照常执行），适配笔记平台 / 阅读平台 /
 *   网盘客户端推任意类型、任意体积文件的同步场景。
 *
 * 支持的方法：OPTIONS / PROPFIND / GET / HEAD / PUT / MKCOL / DELETE
 * 鉴权：HTTP Basic（管理员账号，或用户管理中创建的普通账户）。
 */
@Controller()
export class WebDavController {
  constructor(
    private settings: SettingsService,
    private sysConfig: SysConfigService,
    private uploadSvc: UploadService,
    private storageChannel: StorageChannelService,
  ) {}

  /**
   * WebDAV 配置（系统管理 → 其他设置 → 对外 WebDAV）。
   * 存放在系统设置 others 分区下（key = sysConfig:others → others.webdav），
   * 与后台设置页共用同一份存储，无需额外的读写接口。
   *   enabled   —— 是否启用
   *   rootPath  —— 挂载根目录
   *   readonly  —— 只读模式
   *   注：上传渠道已移除（统一走 getStorageChannel），此处不再读取 channelCode/channelId。
   */
  private async cfg(): Promise<{ enabled: boolean; rootPath: string; readonly: boolean }> {
    const fallback = { enabled: false, rootPath: '', readonly: false };
    try {
      const others: any = await this.sysConfig.get('others');
      const j = others?.webdav || {};
      // 兼容早期版本：曾把配置写在 settings 表的 webdav 键上
      if (j.enabled === undefined && j.channelId === undefined) {
        const legacy = await this.settings.get('webdav', '');
        if (legacy) {
          const lj = JSON.parse(legacy);
          return {
            enabled: lj.enabled === true,
            rootPath: String(lj.rootPath || '').replace(/^\/+|\/+$/g, ''),
            readonly: lj.readonly === true,
          };
        }
      }
      return {
        enabled: j.enabled === true,
        rootPath: String(j.rootPath || '').replace(/^\/+|\/+$/g, ''),
        readonly: j.readonly === true,
      };
    } catch {
      return fallback;
    }
  }

  /** Basic 鉴权：管理员或任意启用中的普通账户 */
  private async authenticate(req: Request): Promise<{ ok: boolean; user: string }> {
    const hdr = String(req.headers['authorization'] || '');
    if (!hdr.toLowerCase().startsWith('basic ')) return { ok: false, user: '' };
    let user = '';
    let pass = '';
    try {
      const decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      user = decoded.slice(0, i);
      pass = decoded.slice(i + 1);
    } catch {
      return { ok: false, user: '' };
    }
    // 1) 用户表账户
    const u = await prisma.user.findUnique({ where: { username: user } });
    if (u && u.enabled && CryptoService.verifyPassword(pass, u.passwordHash)) return { ok: true, user };
    // 2) 安全设置里的管理员账号
    try {
      const raw = await this.sysConfig.readSecurityRaw();
      const adm = raw?.auth?.admin || {};
      const admUser = String(adm.adminUsername || 'admin');
      if (user === admUser && String(adm.adminPassword || '')) {
        const stored = String(adm.adminPassword);
        if (stored.startsWith('scrypt:')) {
          if (CryptoService.verifyPassword(pass, stored.slice(7))) return { ok: true, user };
        } else if (stored === pass) {
          return { ok: true, user };
        }
      }
    } catch {
      /* 忽略 */
    }
    // 3) 环境变量初始账号
    const envUser = process.env.ADMIN_USER || 'admin';
    const envPass = process.env.ADMIN_PASSWORD || 'gohub';
    if (user === envUser && pass === envPass) return { ok: true, user };
    return { ok: false, user };
  }

  /** 解析 /dav/<path> 中的路径（去掉 /dav 前缀与根目录前缀） */
  private davPath(req: Request, rootPath: string): string {
    const qIdx = req.originalUrl.indexOf('?');
    const raw = (qIdx === -1 ? req.originalUrl : req.originalUrl.slice(0, qIdx)).replace(/^\/dav\/?/, '');
    let p = '';
    try {
      p = decodeURIComponent(raw);
    } catch {
      p = raw;
    }
    p = p.replace(/^\/+|\/+$/g, '');
    if (rootPath && !p.startsWith(rootPath)) p = rootPath + (p ? `/${p}` : '');
    return p;
  }

  /** 文件标识 → URL 路径段编码（标识可能含目录层级，按段编码保留 `/`） */
  private encodePath(id: string): string {
    return String(id || '')
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
  }

  private basic(res: Response) {
    res.setHeader('WWW-Authenticate', 'Basic realm="GoHub WebDAV"');
    return res.status(401).send('Unauthorized');
  }

  /**
   * 统一入口：WebDAV 使用 PROPFIND 等自定义方法，无法用 @Get/@Put 精确声明。
   *
   * ⚠️ 必须写成**一个**装饰器 + 路径数组。
   * Nest 的 @All()/@Get() 内部都是 `Reflect.defineMetadata(PATH_METADATA, path)`，
   * 在同一个方法上叠两个（`@All('dav')` + `@All('dav/*')`）后一个会把前一个覆盖掉，
   * 结果只有 `/dav` 注册成功 —— `PROPFIND /dav/2026/`、`PUT /dav/a/b.png` 全部 404，
   * 客户端挂载后一进目录就失败（这正是「对外 WebDAV 外部配置测试失败」的根因）。
   */
  @All(['dav', 'dav/*'])
  async handle(@Req() req: Request, @Res() res: Response) {
    const cfg = await this.cfg();
    if (!cfg.enabled) return res.status(403).send('WebDAV 未启用');

    const auth = await this.authenticate(req);
    if (!auth.ok) return this.basic(res);

    const method = req.method.toUpperCase();
    const path = this.davPath(req, cfg.rootPath);
    const segs = path.split('/').filter(Boolean);
    const last = segs.length ? segs[segs.length - 1] : '';
    const isDirRequest = !last || !/\.[A-Za-z0-9]{1,8}$/.test(last);
    const folder = isDirRequest ? path : segs.slice(0, -1).join('/');

    try {
      switch (method) {
        case 'OPTIONS':
          // 兼容层：正常由 main.ts 在 CORS 之前应答，这里再兜一次
          res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL');
          res.setHeader('DAV', '1,2');
          res.setHeader('MS-Author-Via', 'DAV');
          return res.status(200).send('');

        case 'PROPFIND':
          return this.propfind(req, res, folder, path, isDirRequest);

        case 'GET':
        case 'HEAD': {
          if (isDirRequest) return res.status(405).send('目录不支持直接下载');
          const rec = await prisma.fileRecord.findFirst({
            where: {
              status: 'active',
              folder,
              // name 兼容「WebDAV 上传时以 dav 路径作为对外标识」的情况
              OR: [{ name: last }, { name: path }, { originalName: last }, { name: last.replace(/\.[^.]*$/, '') }],
            },
            include: { copies: true },
          });
          if (!rec) return res.status(404).send('Not Found');
          const origin = signOrigin(req);
          // 对外只跳 GoHub 的签发链接，并走全站统一出口（自定义访问域名优先）；
          // 标识里已带扩展名就不再追加，没有才补原文件扩展名（仅作标识用）。
          const prefix = await this.settings.getLinkPrefix(origin);
          res.setHeader('Location', `${prefix}${this.encodePath(rec.name)}${extSuffixFor(rec.name, last)}`);
          return res.status(302).send('');
        }

        case 'PUT': {
          if (cfg.readonly) return res.status(403).send('WebDAV 处于只读模式');
          const raw = await this.readBody(req);
          if (!raw.length) return res.status(400).send('空请求体');
          const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0];
          const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
          /*
           * 存储渠道：用【本次接入授权的账户】(auth.user) 去统一入口取 ——
           *   getStorageChannel(auth.user, 'main')   → 该账户的默认存储渠道（未配置则全局主渠道）
           *   getStorageChannel(auth.user, 'backup') → 该账户的备份渠道（未配置则全局备份渠道）
           * 早前这里只传 uploader、由 UploadService 内部再兜底，且界面上的主/备渠道语义容易搞反；
           * 现在改成显式取出一对渠道并分别传入，默认存储渠道与备份渠道不会再错位。
           */
          const mainChannel = await this.storageChannel.getStorageChannel(auth.user, 'main');
          const backupChannel = await this.storageChannel.getStorageChannel(auth.user, 'backup');
          const r = await this.uploadSvc.upload(
            { buffer: raw, mime, originalName: last || `dav-${Date.now()}` },
            {
              channelId: mainChannel?.id || undefined,
              backupChannelId: backupChannel?.id || undefined,
              uploadFolder: folder,
              uploader: auth.user,
              ip,
              /*
               * 用 WebDAV 里的相对路径作为对外文件标识。
               * 外部客户端（PicList / 资源管理器）上传后通常不看响应头，
               * 而是拿「自定义域名 + 上传路径」自己拼链接 —— 只有让
               * /file/<该路径> 真实可访问，客户端拼出来的地址才不是 404。
               */
              presetFileId: path || last,
              backup: !!backupChannel,
              /*
               * 「类型和大小限制」不再由 WebDAV 通道自行写死跳过，而是跟随
               * 「本次接入授权的账户」在【用户管理 → 编辑】里的同名开关：
               *   开启（默认）→ 与网页上传一致，受允许格式 + 单文件大小上限约束
               *   关闭        → 跳过这两项限制（同步/备份型客户端可推任意类型、任意体积）
               */
              skipFileLimits: !(await this.uploadSvc.userEnforceLimits(auth.user)),
              // 上传渠道：走「对外 WebDAV」通道
              uploadSource: 'WebDAV',
            },
          );
          if (r.error) return res.status(500).send(r.error);
          /*
           * 上传成功：把 GoHub 的【签发链接】回给客户端（走全站统一出口，自定义访问域名优先）。
           * 外部客户端（如 PicList）默认会用「自己的服务器地址 + 上传时的文件名」自己拼一个地址，
           * 那个地址在本系统里是不存在的（本系统的外链是 /file/<File_ID>）——
           * 这里显式给出正确链接，客户端可优先取用。
           */
          const origin = signOrigin(req);
          const prefix = await this.settings.getLinkPrefix(origin);
          const signedUrl = `${prefix}${this.encodePath(r.id)}${extSuffixFor(r.id, last)}`;
          res.setHeader('Location', signedUrl);
          res.setHeader('x-gohub-url', signedUrl);
          return res.status(201).send('');
        }

        case 'MKCOL': {
          // 目录在本系统中是「逻辑分类」，由文件归属推导；这里仅做存在性应答
          return res.status(201).send('');
        }

        case 'DELETE': {
          if (cfg.readonly) return res.status(403).send('WebDAV 处于只读模式');
          if (isDirRequest) return res.status(403).send('暂不支持目录删除');
          const rec = await prisma.fileRecord.findFirst({
            where: {
              status: 'active',
              folder,
              OR: [{ name: last }, { name: path }, { originalName: last }],
            },
          });
          if (!rec) return res.status(404).send('Not Found');
          await prisma.fileRecord.update({ where: { id: rec.id }, data: { status: 'deleted', deletedAt: new Date() } });
          return res.status(204).send('');
        }

        default:
          return res.status(405).send('Method Not Allowed');
      }
    } catch (err) {
      appLog.error('webdav', `${method} ${path} 失败`, (err as Error).message);
      return res.status(500).send((err as Error).message);
    }
  }

  /**
   * 读取原始请求体。
   * main.ts 已在 /dav 上挂了 express.raw，正常情况下 req.body 就是 Buffer；
   * 这里再兼容「流式未被消费」的情况，并防御「流已结束」导致 Promise 永不 resolve 挂死。
   */
  private readBody(req: Request): Promise<Buffer> {
    const body = (req as unknown as { body?: unknown }).body;
    if (Buffer.isBuffer(body)) return Promise.resolve(body);
    if (typeof body === 'string') return Promise.resolve(Buffer.from(body));
    if (body && typeof body === 'object') return Promise.resolve(Buffer.from(JSON.stringify(body)));
    if ((req as unknown as { readableEnded?: boolean }).readableEnded) return Promise.resolve(Buffer.alloc(0));
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => resolve(Buffer.concat(chunks)), 30000);
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      });
      req.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  /**
   * PROPFIND：列目录（文件夹 + 文件）。
   *
   * 兼容性要点（外部客户端挂载能否成功的关键）：
   *   - 遵循 `Depth` 头：0 = 只回自身；1 / infinity = 回自身 + 直接子项
   *     （早期实现忽略 Depth，Depth:0 也返回全部子项，部分客户端会判定响应非法）
   *   - 集合的 href **必须有且只有一个结尾斜杠**（早期 `path=''` 时拼出 `/dav//`，
   *     客户端解析相对路径时会错位 → 挂载失败）
   *   - 文件名 / 目录名做 XML 转义（含 & < > 的名字会破坏 XML）
   *   - href 按「路径段」编码，避免 # ? 等字符截断 URL
   */
  private async propfind(req: Request, res: Response, folder: string, path: string, isDirRequest: boolean) {
    const origin = signOrigin(req);
    const depth = String(req.headers.depth ?? '1').trim().toLowerCase();
    const selfOnly = depth === '0';

    /** 拼 href：集合固定带一个结尾斜杠，且不重复 */
    const href = (p: string, dir: boolean) => {
      const segs = String(p || '')
        .split('/')
        .filter(Boolean)
        .map((s) => encodeURIComponent(s));
      const tail = segs.length ? `/${segs.join('/')}` : '';
      return `${origin}/dav${tail}${dir ? '/' : ''}`;
    };
    const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const entries: string[] = [];
    const stat = (p: string, collection: boolean, size = 0, mtime = new Date()) =>
      `<D:response><D:href>${esc(href(p, collection))}</D:href><D:propstat><D:prop>` +
      (collection
        ? '<D:resourcetype><D:collection/></D:resourcetype><D:getcontentlength>0</D:getcontentlength><D:getcontenttype>httpd/unix-directory</D:getcontenttype>'
        : `<D:resourcetype/><D:getcontentlength>${size}</D:getcontentlength><D:getcontenttype>${esc(mimeOf(p))}</D:getcontenttype>`) +
      `<D:getlastmodified>${mtime.toUTCString()}</D:getlastmodified>` +
      '<D:creationdate>' + new Date(mtime).toISOString() + '</D:creationdate>' +
      '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';

    // 自身（集合）
    entries.push(stat(path, true));

    if (!selfOnly) {
      const rows = await prisma.fileRecord.findMany({
        where: {
          status: 'active',
          ...(folder ? { OR: [{ folder }, { folder: { startsWith: `${folder}/` } }] } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });

      // 子目录集合
      const dirSet = new Set<string>();
      for (const r of rows) {
        const rest = folder ? r.folder.slice(folder.length).replace(/^\/+/, '') : r.folder;
        const first = rest.split('/')[0];
        if (first) dirSet.add(folder ? `${folder}/${first}` : first);
      }
      for (const d of dirSet) entries.push(stat(d, true));

      if (isDirRequest) {
        const seen = new Set<string>();
        for (const r of rows) {
          if ((r.folder || '') !== folder) continue; // 只列当前层
          const name = r.originalName || r.name;
          if (!name || seen.has(name)) continue; // 同名文件只列一次，避免客户端重复项报错
          seen.add(name);
          entries.push(stat(folder ? `${folder}/${name}` : name, false, r.size, r.createdAt));
        }
      }
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207);
    return res.send(
      `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">\n${entries.join('\n')}\n</D:multistatus>`,
    );
  }
}

/** 扩展名 → MIME（WebDAV 客户端据此决定图标 / 打开方式） */
function mimeOf(name: string): string {
  const ext = String(name).split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg',
    txt: 'text/plain', json: 'application/json', pdf: 'application/pdf',
    zip: 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}
