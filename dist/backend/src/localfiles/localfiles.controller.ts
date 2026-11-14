/**
 * 本地文件系统控制器（v3.0.0）
 * ----------------------------------------------------------------------------
 * 路由前缀：/api/localfiles
 *   GET  channels   当前账户可浏览的「本地文件」渠道（管理员=全部，普通用户=被授权）
 *   GET  settings   读取浏览设置（每页条数 / 单目录上限 / 预览阈值）
 *   POST settings   保存浏览设置
 *   GET  tree       目录树（整棵，供左侧侧栏）
 *   GET  list       目录列表（分页 / 筛选 / 排序 / 搜索 + 已入库标记）
 *   GET  preview    预览（支持 Range，仅登录会话，不计访问统计；download=1 时下载）
 *   POST upload     勾选文件批量上传到图床（复用主上传链路）
 *   POST rename     重命名（v1.0.6，仅 WebDAV 文件虚拟渠道可用）
 *   POST delete     删除（v1.0.6，仅 WebDAV 文件虚拟渠道可用，可批量）
 *
 * 权限：管理员全部可用；普通用户仅能访问「授权名单包含自己」的本地文件渠道。
 * 写操作（rename / delete）只对 WebDAV 虚拟渠道开放，其余渠道一律只读。
 */

import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { createReadStream, promises as fsp } from 'fs';
import * as path from 'path';
import { prisma } from '../common/prisma';
import { appLog } from '../common/app-log';
import { currentSession } from '../auth/auth.guard';
import { channelVisibleTo } from '../common/channel-access';
// v1.2.1：挂载文件上传到图床时要能带上「附件上传」这类来源
import { isClientUploadSource, normalizeUploadSource } from '../common/file-view';
// v1.2.1（需求）：文件去重口径统一 —— 「已落库」标记与上传去重必须用同一套比对规则，
// 否则剪辑过的文件在挂载页会被标成「未落库」而重复上传。
import { isDuplicateFile } from '../common/dedup';
import { SettingsService } from '../settings/settings.service';
import { SysConfigService } from '../settings/sysconfig.service';
import { UploadService } from '../upload/upload.service';
import { LocalAdapter } from '../adapters/local.adapter';
import { webdavRoot } from '../webdav/webdav.storage';
import {
  DEFAULT_MAX_PER_DIR,
  DEFAULT_PAGE_SIZE,
  DEFAULT_PREVIEW_THRESHOLD_MB,
  LocalEntry,
  localFilesAdminOnly,
  collectDirs,
  hashFile,
  isHiddenName,
  localTypeOf,
  logLocalFileError,
  readDirEntries,
  safeJoin,
  sanitizeRelativeDir,
  sortEntries,
  toRelative,
} from './localfiles.util';

/** 设置项 key（存 settings 表，与其它设置一致） */
const K_PAGE_SIZE = 'localFilesPageSize';
const K_MAX_PER_DIR = 'localFilesMaxPerDir';
const K_PREVIEW_MB = 'localFilesPreviewMB';

/**
 * v1.0.6：「默认本地文件」虚拟渠道。
 *
 * 每个账户的上传到内置本地存储渠道（code=999999）的文件，物理落在
 * `uploads/_user/{用户名}/999999/...`（`_user` 是字面目录名）。这条目录不在任何「本地文件」渠道的配置里，
 * 用户此前只能通过图床文件管理看这些文件，看不到磁盘上的真实目录。
 *
 * 这里把它作为一条**不落库的虚拟渠道**塞进渠道列表：
 *   · 列表里 id 固定为 DEFAULT_LOCAL_VIRTUAL_ID；
 *   · resolveChannel 见到这个 id 就地合成渠道对象，不查库；
 *   · 目录不存在时按需创建（新账户第一次进来就是空的，而不是报错）。
 */
const DEFAULT_LOCAL_CHANNEL_CODE = '999999';
const DEFAULT_LOCAL_VIRTUAL_ID = '__default_local__';
/*
 * v1.0.8.1：加载项名称由「默认本地文件」改为「本地默认文件」，
 * 与目录一起变化：uploads/_user/{当前账户}/999999。
 * v1.0.9：再改为「本地用户默认文件」—— 这一条只代表**当前登录账户自己的**
 * 默认落盘目录（uploads/_user/{当前账户}/999999），不是全站公共目录，
 * 旧名称容易被理解成「所有用户的默认目录」。
 */
const DEFAULT_LOCAL_ROOT_NAME = '本地用户默认文件';

/**
 * v1.0.6：「WebDAV 文件」虚拟渠道。
 *
 * 对应用户在「用户管理 → WebDAV 管理」里建的那些渠道的**公共上级目录**
 * `webdav/{用户名}`。挂在「本地文件」页里，用户可以直接看到网盘里存了什么。
 *
 * 与其他本地文件渠道的区别：这一条**允许重命名和删除**
 * （网盘本来就是可写的；其它渠道指向的是用户机器上的原始目录，只读更安全）。
 */
const WEBDAV_VIRTUAL_ID = '__webdav__';
const WEBDAV_ROOT_NAME = 'WebDAV 文件';

/**
 * v1.0.8.1：管理员专属的「WebDav存储文件」加载项。
 *
 * 与上面那条「WebDAV 文件」（普通用户看到自己的 webdav/{账户}）的区别：
 *   · 只对管理员出现；
 *   · 根目录是容器内的 WebDAV**总根** <backend>/webdav，不带账户子目录，
 *     管理员因此能直接看到所有账户的网盘目录；
 *   · id 单独一个，避免与用户那条混淆。
 */
const WEBDAV_ADMIN_VIRTUAL_ID = '__webdav_admin__';
const WEBDAV_ADMIN_ROOT_NAME = 'WebDav存储文件';

/** 扩展名 → MIME（够用即可，上传链路只依赖它做类型归类） */
const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
  tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', flv: 'video/x-flv', wmv: 'video/x-ms-wmv', mpg: 'video/mpeg', mpeg: 'video/mpeg',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', wma: 'audio/x-ms-wma', ape: 'audio/x-ape', aiff: 'audio/aiff',
  pdf: 'application/pdf',
  txt: 'text/plain', text: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', json: 'application/json',
  log: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values', ini: 'text/plain', conf: 'text/plain',
  cfg: 'text/plain', yml: 'text/yaml', yaml: 'text/yaml', xml: 'application/xml', html: 'text/html', htm: 'text/html',
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', ts: 'text/typescript', jsx: 'text/javascript',
  tsx: 'text/typescript', sh: 'text/x-sh', bash: 'text/x-sh', bat: 'text/plain', ps1: 'text/plain',
  py: 'text/x-python', go: 'text/x-go', java: 'text/x-java', c: 'text/x-c', h: 'text/x-c', cpp: 'text/x-c++', sql: 'text/plain',
  /*
   * v3.0.0（R15）：补齐「能用文本方式打开」的扩展名 ——
   * 这些文件此前落到 application/octet-stream，被当作二进制，
   * TXT 灯箱打不开、也筛不进「文本」类。
   */
  php: 'application/x-httpd-php', phtml: 'application/x-httpd-php',
  vue: 'text/plain', svelte: 'text/plain', rs: 'text/x-rust', rb: 'text/x-ruby', kt: 'text/x-kotlin',
  swift: 'text/x-swift', lua: 'text/x-lua', pl: 'text/x-perl', r: 'text/x-r', scala: 'text/x-scala',
  dart: 'text/x-dart', gradle: 'text/plain', toml: 'application/toml', properties: 'text/plain',
  plist: 'text/xml', lock: 'text/plain', map: 'application/json', graphql: 'application/graphql',
  gql: 'application/graphql', proto: 'text/plain', tex: 'application/x-latex', rst: 'text/plain',
  srt: 'text/plain', vtt: 'text/vtt', diff: 'text/plain', patch: 'text/plain',
  env: 'text/plain', service: 'text/plain', nginx: 'text/plain', htaccess: 'text/plain',
  dockerfile: 'text/plain', makefile: 'text/plain', gitignore: 'text/plain', editorconfig: 'text/plain',
  xaml: 'application/xml', svgx: 'application/xml', asm: 'text/plain', s: 'text/plain',
};

function mimeOf(ext: string): string {
  return MIME_MAP[String(ext || '').toLowerCase()] || 'application/octet-stream';
}

/** 预览 / 下载时允许内联展示的类型（其它一律按附件下载，避免浏览器误执行 html/js） */
const INLINE_TYPES = new Set(['image', 'video', 'audio', 'pdf']);

@Controller('api/localfiles')
export class LocalFilesController {
  constructor(
    private settings: SettingsService,
    private uploads: UploadService,
    private sysConfig: SysConfigService,
  ) {}

  /**
   * v1.0.6：对外 WebDAV 的全局开关（系统管理 → 安全设置 → 对外 WebDAV）。
   * 配置存在 sysConfig 的 **others** 分区（`{ webdav: { enabled } }`）。
   *
   * 需求：「开关关闭时全局 WebDAV 停用，所有 WebDAV 文件不可传输和访问」——
   * 所以这里不只拦 /dav，连「本地文件」里的 WebDAV 加载项也一并下线。
   */
  private async webdavOn(): Promise<boolean> {
    try {
      const cfg: any = await this.sysConfig.get('others');
      const w = cfg?.webdav || {};
      return w.enabled === true || String(w.enabled) === 'true';
    } catch {
      return false;
    }
  }

  private session(req: Request) {
    return currentSession(req);
  }

  private role(req: Request): string {
    return this.session(req)?.role || '';
  }

  private userName(req: Request): string {
    return this.session(req)?.user || '';
  }

  /** 读取浏览设置（带默认值兜底） */
  private async readSettings() {
    const [ps, mx, pm] = await Promise.all([
      this.settings.get(K_PAGE_SIZE, String(DEFAULT_PAGE_SIZE)),
      this.settings.get(K_MAX_PER_DIR, String(DEFAULT_MAX_PER_DIR)),
      this.settings.get(K_PREVIEW_MB, String(DEFAULT_PREVIEW_THRESHOLD_MB)),
    ]);
    return {
      pageSize: Math.min(200, Math.max(12, Number(ps) || DEFAULT_PAGE_SIZE)),
      maxPerDir: Math.min(5000, Math.max(100, Number(mx) || DEFAULT_MAX_PER_DIR)),
      previewThresholdMB: Math.min(4096, Math.max(1, Number(pm) || DEFAULT_PREVIEW_THRESHOLD_MB)),
    };
  }

  /** 取一条「本地文件」渠道并按权限解析出真实根目录（realpath 兜底）。
   *  v3.0.0（R8）：支持多个「浏览目录」（cfg.rootPaths，一行一个 / 数组）；
   *  旧配置只有 cfg.rootPath 单目录时自动视为一个浏览目录，完全平滑兼容。 */
  private async resolveChannel(req: Request, channelId: string) {
    const id = String(channelId || '').trim();
    if (!id) return { error: '请选择挂载文件渠道' as string };
    /*
     * v1.0.8.1：管理员专属「WebDav存储文件」——容器内 WebDAV 总根 <backend>/webdav。
     *
     * 只给管理员：普通账户仍然只看自己的 webdav/{账户}（下一条分支）。
     * 这里是**直接浏览磁盘目录**，不走 /dav 协议，因此不受「对外 WebDAV」总开关影响。
     */
    if (id === WEBDAV_ADMIN_VIRTUAL_ID) {
      if (!localFilesAdminOnly(this.role(req))) return { error: '仅管理员可浏览该目录' };
      const base = webdavRoot();
      await fsp.mkdir(base, { recursive: true }).catch(() => undefined);
      let real = base;
      try {
        real = await fsp.realpath(base);
      } catch {
        /* 目录不可达时沿用字面路径，下面的 stat 会给出准确报错 */
      }
      try {
        const st = await fsp.stat(real);
        if (!st.isDirectory()) throw new Error('not a directory');
        const pseudo = {
          id: WEBDAV_ADMIN_VIRTUAL_ID,
          code: 'WEBDAV',
          name: WEBDAV_ADMIN_ROOT_NAME,
          type: 'webdav',
          enabled: true,
          config: '{}',
          authorizedUsers: '[]',
        };
        return {
          channel: pseudo,
          root: real,
          roots: [{ name: WEBDAV_ADMIN_ROOT_NAME, display: base, real, mtime: st.mtimeMs }],
          broken: [] as string[],
        };
      } catch (err) {
        logLocalFileError('读取 WebDAV 目录', `管理员 路径=${base}`, err);
        return { error: 'WebDAV 目录不存在或不可访问' };
      }
    }

    /*
     * v1.0.6：虚拟渠道「WebDAV 文件」——webdav/{当前账户}。
     *
     * 这是用户所有 WebDAV 渠道的公共上级目录（每个渠道自己的存储路径是它的子目录）。
     * 允许重命名 / 删除（见 renameEntry / deleteEntry），因为网盘天然可写。
     */
    if (id === WEBDAV_VIRTUAL_ID) {
      const me = this.userName(req);
      if (!me) return { error: '请先登录' };
      if (!(await this.webdavOn())) return { error: '对外 WebDAV 已停用（系统管理 → 安全设置）' };
      const base = path.join(webdavRoot(), me);
      await fsp.mkdir(base, { recursive: true }).catch(() => undefined);
      let real = base;
      try {
        real = await fsp.realpath(base);
      } catch {
        /* 同上：交给 stat 报错 */
      }
      try {
        const st = await fsp.stat(real);
        if (!st.isDirectory()) throw new Error('not a directory');
        const pseudo = {
          id: WEBDAV_VIRTUAL_ID,
          code: 'WEBDAV',
          name: WEBDAV_ROOT_NAME,
          type: 'webdav',
          enabled: true,
          config: '{}',
          authorizedUsers: '[]',
        };
        return {
          channel: pseudo,
          root: real,
          roots: [{ name: WEBDAV_ROOT_NAME, display: base, real, mtime: st.mtimeMs }],
          broken: [] as string[],
        };
      } catch (err) {
        logLocalFileError('读取 WebDAV 目录', `账户=${me} 路径=${base}`, err);
        return { error: 'WebDAV 目录不存在或不可访问' };
      }
    }
    /*
     * v1.0.8.1：虚拟渠道「本地用户默认文件」——uploads/_user/{当前账户}/999999。
     * 不查库，就地合成渠道对象；目录不存在则创建空目录（新账户第一次进来应当看到空列表，
     * 而不是「浏览目录不存在」的报错）。
     * `_user` 是字面目录名，`me` 才是用户名。
     */
    if (id === DEFAULT_LOCAL_VIRTUAL_ID) {
      const me = this.userName(req);
      if (!me) return { error: '请先登录' };
      const dir = path.join(LocalAdapter.userRoot(), me, DEFAULT_LOCAL_CHANNEL_CODE);
      await fsp.mkdir(dir, { recursive: true }).catch(() => undefined);
      let real = dir;
      try {
        real = await fsp.realpath(dir);
      } catch {
        /* 目录不可达时沿用字面路径，下面的 stat 会给出准确报错 */
      }
      try {
        const st = await fsp.stat(real);
        if (!st.isDirectory()) throw new Error('not a directory');
        const pseudo = {
          id: DEFAULT_LOCAL_VIRTUAL_ID,
          code: DEFAULT_LOCAL_CHANNEL_CODE,
          name: DEFAULT_LOCAL_ROOT_NAME,
          type: 'local',
          enabled: true,
          config: '{}',
          authorizedUsers: '[]',
        };
        return {
          channel: pseudo,
          root: real,
          roots: [{ name: DEFAULT_LOCAL_ROOT_NAME, display: dir, real, mtime: st.mtimeMs }],
          broken: [] as string[],
        };
      } catch (err) {
        logLocalFileError('读取默认本地目录', `账户=${me} 路径=${dir}`, err);
        return { error: '默认本地目录不存在或不可访问' };
      }
    }
    /*
     * v1.0.1：除了专门的「本地文件」渠道，自定义本地存储渠道只要打开了
     * 「同步到本地文件管理」开关（cfg.syncToLocalFiles），也在这里可用 ——
     * 管理员可以直接浏览该存储目录，无需再单独建一条本地文件渠道。
     */
    const ch = await prisma.channel.findFirst({
      where: { type: { in: ['localfiles', 'local'] }, OR: [{ id }, { code: id }] },
    });
    if (!ch) return { error: '渠道不存在或不是「挂载文件」渠道' };
    if (!ch.enabled) return { error: '该渠道已停用' };
    /*
     * v1.0.5：渠道授权 —— 管理员直通；普通用户必须在授权名单里，
     * 且只对「本地文件」类渠道生效（本地存储渠道的授权沿用它自己的名单）。
     */
    if (!localFilesAdminOnly(this.role(req))) {
      const me = this.userName(req);
      if (!me || !channelVisibleTo(ch.authorizedUsers, ch.type, me, false)) {
        return { error: '该挂载文件渠道未授权给当前账户' };
      }
    }
    let cfg: Record<string, any> = {};
    try {
      cfg = JSON.parse(ch.config || '{}');
    } catch {
      cfg = {};
    }
    // 自定义本地存储渠道：只有显式开启「同步到本地文件管理」才允许浏览
    if (ch.type === 'local') {
      const on = cfg.syncToLocalFiles === true || String(cfg.syncToLocalFiles || '') === 'true';
      if (!on) return { error: '该本地存储渠道未开启「同步到挂载管理」' };
    }
    // 解析浏览目录清单（rootPaths 优先，回落 rootPath）
    let wanted: string[] = [];
    if (Array.isArray(cfg.rootPaths)) wanted = cfg.rootPaths.map((s: unknown) => String(s || '').trim());
    else if (typeof cfg.rootPaths === 'string' && cfg.rootPaths.trim()) {
      wanted = cfg.rootPaths.split(/\r?\n/).map((s: string) => s.trim());
    }
    if (!wanted.length && cfg.rootPath) wanted = [String(cfg.rootPath).trim()];
    wanted = wanted.filter(Boolean);
    if (!wanted.length) return { error: '该渠道没有配置浏览目录' };
    // 逐个 realpath 校验；个别目录失效不拖垮整渠道（记系统日志），全部失效才报错
    const roots: { name: string; display: string; real: string; mtime: number }[] = [];
    const broken: string[] = [];
    const usedNames = new Set<string>();
    for (const display of wanted) {
      try {
        const real = await fsp.realpath(display);
        const st = await fsp.stat(real);
        if (!st.isDirectory()) throw new Error('not a directory');
        let name = path.basename(real) || real;
        while (usedNames.has(name)) name = `${name}-2`;
        usedNames.add(name);
        roots.push({ name, display, real, mtime: st.mtimeMs });
      } catch (err) {
        broken.push(display);
        logLocalFileError('读取浏览目录', `渠道=${ch.name} 路径=${display}`, err);
      }
    }
    if (!roots.length) return { error: '浏览目录不存在或不可访问' };
    return { channel: ch, root: roots[0].real, roots, broken };
  }

  /** 虚拟路径 → 实际目录：首段匹配浏览目录名，剩余为该目录内相对路径；不匹配 = 越界 */
  private resolveInsideRoot(roots: { name: string; real: string }[], dir: string) {
    const segs = String(dir || '').split('/').filter(Boolean);
    if (!segs.length) return null;
    const hit = roots.find((r) => r.name === segs[0]);
    if (!hit) return null;
    return { root: hit, inside: segs.slice(1).join('/') };
  }

  /** 当前账户可见的「本地文件」渠道列表 */
  @Get('channels')
  async channels(@Req() req: Request) {
    if (!this.session(req)) return { success: false, message: '请先登录' };
    const admin = localFilesAdminOnly(this.role(req));
    const me = this.userName(req);
    /*
     * v1.0.5：本地文件渠道开放「授权」——
     *   · 管理员恒可见全部；
     *   · 普通用户只看到**授权名单包含自己**的渠道，一个都没有就是空列表
     *     （前端 DashboardTabs 据此决定是否显示「本地文件」入口）。
     */
    if (!admin && !me) return { success: true, data: [] };
    /*
     * v1.0.1：列表里同时带上「开启了同步开关的自定义本地存储渠道」——
     * 这类渠道的浏览目录就是它的存储地址（rootPath），无需再单独建一条本地文件渠道。
     */
    const rows = await prisma.channel.findMany({
      where: { type: { in: ['localfiles', 'local'] } },
      orderBy: [{ typeCode: 'asc' }, { name: 'asc' }],
    });
    const configured = rows
      .map((ch) => {
        let cfg: Record<string, any> = {};
        try {
          cfg = JSON.parse(ch.config || '{}');
        } catch {
          cfg = {};
        }
        const synced = ch.type === 'local' && (cfg.syncToLocalFiles === true || String(cfg.syncToLocalFiles || '') === 'true');
        /*
         * v1.1.6：渠道被停用（「系统管理 → 渠道设置」里启用开关关闭）→ 该加载源整条隐藏。
         * 原实现仍把停用渠道下发（enabled=false），挂载管理页会列出这个点进去就报
         * 「该渠道已停用」的死入口；现在直接从列表里去掉。
         */
        if (!ch.enabled) return null;
        // 自定义本地存储渠道：没开同步开关 / 没配存储地址 → 不出现在本地文件渠道选择里
        if (ch.type === 'local' && (!synced || !String(cfg.rootPath || '').trim())) return null;
        // v1.0.5：普通用户按授权名单过滤（管理员直通）
        if (!admin && !channelVisibleTo(ch.authorizedUsers, ch.type, me, false)) return null;
        return {
          id: ch.id,
          code: ch.code,
          name: ch.name,
          rootPath: String(cfg.rootPath || ''),
          enabled: ch.enabled,
          // v1.0.1：来源类型 —— 前端据此标注「本地存储同步」角标
          source: ch.type === 'local' ? 'local' : 'localfiles',
        };
      })
      .filter(Boolean);
    /*
     * v1.0.8.1：每个账户都先放一条「本地用户默认文件」——
     * 目录固定为 uploads/_user/{当前账户}/999999，也就是走内置本地存储渠道上传时文件真正落盘的位置。
     * 它不在渠道表里（上面那条 findMany 查不到），所以单独拼在最前面；
     * 前端拿 id 就能浏览，不需要用户先在后台配一条本地文件渠道。
     */
    const mine = {
      id: DEFAULT_LOCAL_VIRTUAL_ID,
      code: DEFAULT_LOCAL_CHANNEL_CODE,
      name: DEFAULT_LOCAL_ROOT_NAME,
      rootPath: path.join(LocalAdapter.userRoot(), me, DEFAULT_LOCAL_CHANNEL_CODE),
      enabled: true,
      source: 'default',
    };
    /*
     * v1.0.6：WebDAV 目录也作为一条加载项。
     * 只有当这个账户确实建过 WebDAV 渠道时才出现 —— 没建过的人看到一条空目录只会困惑。
     * 管理员的 webdav 目录同样不加（管理员禁止使用 WebDAV）。
     */
    /*
     * v1.0.6：全局开关关闭时整条 WebDAV 加载项也隐藏（需求：关闭后不可访问）。
     *
     * v1.0.7：判断口径放宽 —— 只要「全局开关打开 + 该账户被授权 WebDAV」就出现，
     * 不再要求「已经建过至少一个 WebDAV 渠道」。
     * 原口径下有个死结：管理员给账户打开了 WebDAV 授权，但用户还没建渠道，
     * 于是「本地文件」里看不到 webdav/{账户名} 这一项，用户以为功能没生效；
     * 而建渠道的入口又在别处，绕一圈才明白。现在授权即出现（目录为空也没关系，
     * WebDAV 客户端往里传文件后自然就有内容）。
     * 管理员账户仍然没有这一项（管理员禁止使用 WebDAV）。
     */
    const webdavOn = await this.webdavOn();
    let webdavItem: Record<string, unknown> | null = null;
    if (webdavOn && me) {
      const account = await prisma.user.findUnique({ where: { username: me }, select: { role: true, webdavEnabled: true } });
      const allowed = account?.role === 'user' && account.webdavEnabled === true;
      if (allowed) {
        webdavItem = {
          id: WEBDAV_VIRTUAL_ID,
          code: 'WEBDAV',
          name: WEBDAV_ROOT_NAME,
          rootPath: path.join(webdavRoot(), me),
          enabled: true,
          source: 'webdav',
        };
      }
    }
    /*
     * v1.0.8.1：管理员在「本地文件」里多一条「WebDav存储文件」。
     *
     * 指向容器内 WebDAV **总根** <backend>/webdav（不带账户子目录），
     * 因此管理员一眼能看到所有账户的网盘目录。
     * 这是直接浏览磁盘，不走 /dav 协议，所以不受「对外 WebDAV」总开关影响
     * （用户那条仍然受开关约束，见上）。
     */
    const adminWebdavItem: Record<string, unknown> | null = admin
      ? {
          id: WEBDAV_ADMIN_VIRTUAL_ID,
          code: 'WEBDAV',
          name: WEBDAV_ADMIN_ROOT_NAME,
          rootPath: webdavRoot(),
          enabled: true,
          source: 'webdav',
        }
      : null;

    return {
      success: true,
      data: [mine, ...(adminWebdavItem ? [adminWebdavItem] : []), ...(webdavItem ? [webdavItem] : []), ...configured],
    };
  }

  @Get('settings')
  async getSettings(@Req() req: Request) {
    if (!this.session(req)) return { success: false, message: '请先登录' };
    return { success: true, data: await this.readSettings() };
  }

  @Post('settings')
  async saveSettings(
    @Body() body: { pageSize?: number; maxPerDir?: number; previewThresholdMB?: number },
    @Req() req: Request,
  ) {
    // 浏览设置属于「当前账户的显示偏好」，任何登录账户都能改
    if (!this.session(req)) return { success: false, message: '请先登录' };
    const cur = await this.readSettings();
    const pageSize = Math.min(200, Math.max(12, Number(body?.pageSize) || cur.pageSize));
    const maxPerDir = Math.min(5000, Math.max(100, Number(body?.maxPerDir) || cur.maxPerDir));
    const previewThresholdMB = Math.min(4096, Math.max(1, Number(body?.previewThresholdMB) || cur.previewThresholdMB));
    await Promise.all([
      this.settings.set(K_PAGE_SIZE, String(pageSize)),
      this.settings.set(K_MAX_PER_DIR, String(maxPerDir)),
      this.settings.set(K_PREVIEW_MB, String(previewThresholdMB)),
    ]);
    appLog.info('localfiles', '更新本地文件浏览设置', `每页=${pageSize} 单目录上限=${maxPerDir} 预览阈值=${previewThresholdMB}MB`);
    return { success: true, data: { pageSize, maxPerDir, previewThresholdMB } };
  }

  /** 目录树（整棵，供左侧侧栏；超过 3000 个目录只返回前 3000 个） */
  @Get('tree')
  async tree(@Req() req: Request, @Query() q: Record<string, string>) {
    const r = await this.resolveChannel(req, q.channelId);
    if (r.error) return { success: false, message: r.error };
    const roots = r.roots!;
    /*
     * v3.0.0（R8）：多浏览目录 —— 每个浏览目录都是根目录下的一级子目录（虚拟根）
     * v3.0.0（R12）：上限从 800 提到 3000，并在截断时记系统日志（否则目录树看起来「莫名少目录」）
     */
    const TREE_LIMIT = 3000;
    const dirs: string[] = [];
    let truncated = false;
    for (const rt of roots) {
      dirs.push(rt.name);
      const subs = await collectDirs(rt.real, rt.real, TREE_LIMIT);
      if (subs.length >= TREE_LIMIT) truncated = true;
      for (const s of subs) dirs.push(`${rt.name}/${s}`);
    }
    if (truncated) {
      appLog.warn('localfiles', '目录树条目超过上限已截断', `渠道=${r.channel!.name} 上限=${TREE_LIMIT}`);
    }
    dirs.sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return { success: true, data: { root: '', dirs, total: dirs.length, truncated } };
  }

  /** 目录列表 */
  @Get('list')
  async list(@Req() req: Request, @Query() q: Record<string, string>) {
    const r = await this.resolveChannel(req, q.channelId);
    if (r.error) return { success: false, message: r.error };
    const roots = r.roots!;
    const dir = sanitizeRelativeDir(q.dir);
    if (dir === null) return { success: false, message: '目录路径不合法' };

    const cfg = await this.readSettings();
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || cfg.pageSize));
    const type = String(q.type || '').toLowerCase();
    const search = String(q.search || '').trim().toLowerCase();
    const sort = String(q.sort || 'name');
    const order = String(q.order || 'asc');

    /*
     * v3.0.0（R8）：根目录 = 虚拟层 —— 每个浏览目录渲染成一个一级子目录；
     * 子目录里的路径统一带「浏览目录名/」前缀返回给前端。
     */
    let entries: LocalEntry[] = [];
    let truncated = false;
    let dirs: string[] = [];
    if (dir === '') {
      entries = roots.map((rt) => ({
        path: rt.name,
        name: rt.name,
        kind: 'dir' as const,
        size: 0,
        mtime: rt.mtime,
        ext: '',
        type: '',
      }));
      dirs = roots.map((rt) => rt.name);
    } else {
      const hit = this.resolveInsideRoot(roots, dir);
      if (!hit) return { success: false, message: '目录路径越界' };
      const abs = safeJoin(hit.root.real, hit.inside || '.');
      if (!abs) return { success: false, message: '目录路径越界' };
      let read: { entries: LocalEntry[]; truncated: boolean; dirs: string[] };
      try {
        /*
         * v3.0.0（R9 修复）：第二个参数必须传 abs（当前目录）——
         * readDirEntries 返回「相对第二个参数」的路径；之前传 hit.root.real（浏览目录根），
         * 子目录里的条目路径就已经含「子目录/」段，再被下方拼上 dir 前缀后整段重复
         * （如 lf-test/子目录/子目录/内层.txt）→ 预览 404（无缩略图、点不开），
         * 目录树也出现「含完整路径的假文件夹」。
         */
        read = await readDirEntries(abs, abs, cfg.maxPerDir);
      } catch (err) {
        logLocalFileError('读取目录', `渠道=${r.channel!.name} 目录=${dir || '/'}`, err);
        return { success: false, message: '目录读取失败' };
      }
      const prefix = dir;
      entries = read.entries.map((e) => ({ ...e, path: prefix ? `${prefix}/${e.path}` : e.path }));
      truncated = read.truncated;
      /*
       * v3.0.0（R9 修复）：dirs 返回「当前目录下的裸目录名」（不带任何前缀）——
       * 前端 enterDirJoin 会自己拼上当前目录。之前返回完整虚拟路径，
       * 前端再拼一次产生「lf-test/lf-test/子目录」越界 + 同名卡片重复显示。
       */
      dirs = read.dirs;
    }

    let list = entries;
    /*
     * v3.0.0（R14）：新增「落库」筛选（?type=inlibrary）——
     * 只看已经进入图床记录体系的文件（与「已落库」标记同一套比对逻辑）。
     * 目录一律保留，方便继续往下翻。
     */
    if (type === 'inlibrary') {
      const probe = list.filter((e) => e.kind === 'file').slice(0, 400);
      const libMap = await this.markInLibrary(roots, probe);
      list = list.filter((e) => e.kind === 'dir' || libMap.has(e.path));
    } else if (type) {
      list = list.filter((e) => e.kind === 'dir' || e.type === type);
    }
    // 搜索：同时匹配「文件名」和「相对路径」，便于在子目录里找东西
    if (search) list = list.filter((e) => e.name.toLowerCase().includes(search) || e.path.toLowerCase().includes(search));
    list = sortEntries(list, sort, order);

    /*
     * v3.0.0（R12）：按「是否落库」排序 ——
     * 排序键依赖与数据库的比对结果，所以先对（过滤后的）全部文件算一遍落库标记再排序分页；
     * 为防止超大目录把整目录文件都哈希一遍，只比对前 LIB_SORT_LIMIT 个文件，
     * 其余按「未落库」处理（排序仍稳定，只是这些文件排在未落库分组里）。
     */
    const LIB_SORT_LIMIT = 400;
    let inLibrary: Map<string, string> | null = null;
    if (sort === 'inLibrary') {
      inLibrary = await this.markInLibrary(
        roots,
        list.filter((e) => e.kind === 'file').slice(0, LIB_SORT_LIMIT),
      );
      const dir = order === 'desc' ? -1 : 1;
      const rank = (e: LocalEntry) => (inLibrary!.has(e.path) ? 0 : 1);
      list = [...list].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        const cmp = (rank(a) - rank(b)) * dir;
        if (cmp) return cmp;
        return a.name.localeCompare(b.name, 'zh-CN');
      });
    }

    const total = list.length;
    const start = (page - 1) * pageSize;
    const pageEntries = list.slice(start, start + pageSize);

    // 「已落库」标记：先按大小圈定候选，再对大小命中的文件算 MD5 精确比对（只算当前页）
    const marked = inLibrary ?? (await this.markInLibrary(roots, pageEntries));

    return {
      success: true,
      data: {
        dir,
        entries: pageEntries.map((e) => ({ ...e, inLibrary: marked.get(e.path) || '' })),
        total,
        page,
        pageSize,
        truncated,
        dirs,
        settings: cfg,
      },
    };
  }

  /**
   * 当前页「已入库」比对结果：path → 命中文件的 File_ID（未入库则不出现在 Map 里）
   * 策略：先按 size 查库（走文件表索引，代价低），只对「大小能对上」的文件算 MD5，
   * 因此绝大多数目录只需一次 SQL，不会把整个目录的文件都哈希一遍。
   * v3.0.0（R8）：path 带浏览目录名前缀，先映射回真实绝对路径再哈希。
   *
   * v1.2.1（需求）：比对口径改成与上传去重完全一致的 `isDuplicateFile` ——
   *   · 剪辑过的文件「原始大小 + 原始 md5」和「实际大小 + 实际 md5」都可能对上磁盘上的那份，
   *     所以候选记录必须带上 originalSize / originalMd5；
   *   · 索引桶同时登记 size 与 originalSize（同一行可能落在两个桶里，去重后不影响结果）；
   *   · 具体命中判定交给 isDuplicateFile，避免这里再维护一份漂移的比对规则。
   */
  private async markInLibrary(
    roots: { name: string; real: string }[],
    entries: LocalEntry[],
    limit = 200,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const files = entries.filter((e) => e.kind === 'file' && e.size > 0).slice(0, Math.max(1, limit));
    if (!files.length) return out;
    const sizes = Array.from(new Set(files.map((f) => f.size)));
    let rows: {
      name: string;
      size: number;
      originalSize: number;
      md5: string;
      originalMd5: string;
      editedAt: Date | null;
    }[] = [];
    try {
      rows = await prisma.fileRecord.findMany({
        where: { status: 'active', OR: [{ size: { in: sizes } }, { originalSize: { in: sizes } }] },
        // v1.2.2：剪辑过的记录只比「实际大小 + 实际 md5」，必须把 editedAt 取回来
        select: { name: true, size: true, originalSize: true, md5: true, originalMd5: true, editedAt: true },
        take: 500,
      });
    } catch {
      return out;
    }
    if (!rows.length) return out;
    type Cand = {
      name: string;
      size: number;
      originalSize: number;
      md5: string;
      originalMd5: string;
      editedAt: Date | null;
    };
    const bySize = new Map<number, Cand[]>();
    for (const r of rows) {
      const cand: Cand = {
        name: r.name,
        size: Number(r.size) || 0,
        originalSize: Number(r.originalSize) || 0,
        md5: r.md5 || '',
        originalMd5: r.originalMd5 || '',
        editedAt: r.editedAt || null,
      };
      /*
       * v1.2.2：剪辑过的记录不参与组①，所以它不该出现在「原始大小」的桶里 ——
       * 否则那个桶会把磁盘上恰好同大小的文件都哈希一遍，最后还是判不中，纯浪费。
       */
      const buckets = cand.editedAt ? [cand.size] : [cand.size, cand.originalSize];
      for (const s of new Set(buckets)) {
        if (!s) continue;
        if (!bySize.has(s)) bySize.set(s, []);
        const bucket = bySize.get(s)!;
        // 同一行可能因 size === originalSize 被两次 set 命中，这里只登记一次
        if (!bucket.some((c) => c.name === cand.name && c.md5 === cand.md5)) bucket.push(cand);
      }
    }
    for (const f of files) {
      const cands = bySize.get(f.size);
      if (!cands || !cands.length) continue;
      const hit = this.resolveInsideRoot(roots, f.path);
      if (!hit) continue;
      const abs = safeJoin(hit.root.real, hit.inside || '.');
      if (!abs) continue;
      try {
        const md5 = await hashFile(abs);
        const probe = { size: f.size, md5 };
        const match = cands.find((c) => isDuplicateFile(probe, c));
        if (match) out.set(f.path, match.name);
      } catch {
        /* 单个文件读不到不影响整页 */
      }
    }
    return out;
  }

  /**
   * v1.0.6：把「虚拟路径」解析成一个真实绝对路径，并额外返回可写性。
   *
   * 只有 WebDAV 虚拟渠道允许写（重命名 / 删除）：
   *   · 其它本地文件渠道指向的是用户机器上的**原始目录**，从网页上删文件风险太大，一律只读；
   *   · WebDAV 目录本来就是网盘，可写是它的属性。
   *
   * 同时禁掉「对渠道根目录本身动手」—— hit.inside 为空说明操作对象是根，直接拒绝。
   */
  private async resolveWritable(
    req: Request,
    channelId: string,
    rel: string,
  ): Promise<{ error?: string; abs?: string; rel?: string; channel?: any }> {
    const r = await this.resolveChannel(req, channelId);
    if (r.error) return { error: r.error as string };
    if (String(r.channel?.id || '') !== WEBDAV_VIRTUAL_ID) {
      return { error: '该渠道不支持重命名或删除（仅 WebDAV 文件可写）' };
    }
    const clean = sanitizeRelativeDir(rel);
    if (clean === null || !clean) return { error: '文件路径不合法' };
    const hit = this.resolveInsideRoot(r.roots!, clean);
    if (!hit) return { error: '文件路径越界' };
    if (!hit.inside) return { error: '不能对渠道根目录执行该操作' };
    const abs = safeJoin(hit.root.real, hit.inside);
    if (!abs) return { error: '文件路径越界' };
    return { abs, rel: clean, channel: r.channel! };
  }

  /** v1.0.6：WebDAV 目录内的文件 / 文件夹重命名（同目录内改名，不支持移动） */
  @Post('rename')
  async rename(
    @Body() body: { channelId?: string; path?: string; name?: string },
    @Req() req: Request,
  ) {
    if (!this.session(req)) return { success: false, message: '请先登录' };
    const target = await this.resolveWritable(req, String(body?.channelId || ''), String(body?.path || ''));
    if (target.error) return { success: false, message: target.error };
    const raw = String(body?.name || '');
    const name = raw.trim();
    if (!name) return { success: false, message: '请输入新名称' };
    if (name.length > 255) return { success: false, message: '名称过长（最多 255 个字符）' };
    if (/[\\/\u0000-\u001f]/.test(name)) return { success: false, message: '名称不能包含 / \\ 等非法字符' };
    if (name === '.' || name === '..') return { success: false, message: '名称不合法' };
    if (isHiddenName(name)) return { success: false, message: '名称不能以「.」开头' };
    const abs = target.abs!;
    const parent = path.dirname(abs);
    const next = path.join(parent, name);
    if (next === abs) return { success: true, data: { path: target.rel, name } };
    // 目标已存在 → 拒绝（避免 rename 覆盖别的文件）
    const exists = await fsp.stat(next).then(() => true).catch(() => false);
    if (exists) return { success: false, message: '同目录下已存在同名文件或文件夹' };
    try {
      await fsp.rename(abs, next);
    } catch (err) {
      logLocalFileError('重命名本地文件', `文件=${target.rel} 新名=${name}`, err);
      return { success: false, message: `重命名失败：${(err as Error).message || '未知错误'}` };
    }
    const oldRel = target.rel!;
    const segs = oldRel.split('/');
    segs[segs.length - 1] = name;
    const newPath = segs.join('/');
    appLog.info('localfiles', 'WebDAV 文件重命名', `${oldRel} → ${newPath}（账户=${this.userName(req)}）`);
    return { success: true, data: { path: newPath, oldPath: oldRel, name } };
  }

  /**
   * v1.0.6：WebDAV 目录内的文件 / 文件夹删除（可批量）。
   *
   * 注意：这是真实删除、不进回收站；前端必须二次确认。
   * 只允许 WebDAV 虚拟渠道，且逐条校验仍在账户根目录内。
   */
  @Post('delete')
  async remove(@Body() body: { channelId?: string; paths?: string[] }, @Req() req: Request) {
    if (!this.session(req)) return { success: false, message: '请先登录' };
    const list = Array.isArray(body?.paths) ? body!.paths!.map((p) => String(p || '')) : [];
    if (!list.length) return { success: false, message: '请选择要删除的文件' };
    if (list.length > 200) return { success: false, message: '一次最多删除 200 个文件' };
    const channelId = String(body?.channelId || '');
    const removed: string[] = [];
    const failed: { path: string; message: string }[] = [];
    for (const rel of list) {
      const target = await this.resolveWritable(req, channelId, rel);
      if (target.error) {
        failed.push({ path: rel, message: target.error });
        continue;
      }
      try {
        await fsp.rm(target.abs!, { recursive: true, force: true });
        removed.push(target.rel!);
      } catch (err) {
        logLocalFileError('删除本地文件', `文件=${rel}`, err);
        failed.push({ path: rel, message: (err as Error).message || '删除失败' });
      }
    }
    if (removed.length) {
      appLog.info('localfiles', 'WebDAV 文件删除', `共 ${removed.length} 项（账户=${this.userName(req)}）：${removed.slice(0, 10).join(', ')}`);
    }
    if (!removed.length) {
      return { success: false, message: failed[0]?.message || '删除失败' };
    }
    return { success: true, data: { removed, failed } };
  }

  /** 预览 / 下载：支持 Range，仅登录会话，不计访问统计 */
  @Get('preview')
  async preview(@Req() req: Request, @Res() res: Response, @Query() q: Record<string, string>): Promise<void> {
    if (!this.session(req)) {
      res.status(401).json({ success: false, message: '请先登录' });
      return;
    }
    const r = await this.resolveChannel(req, q.channelId);
    if (r.error) {
      res.status(403).json({ success: false, message: r.error });
      return;
    }
    const roots = r.roots!;
    const rel = sanitizeRelativeDir(q.path);
    if (rel === null || !rel) {
      res.status(400).json({ success: false, message: '文件路径不合法' });
      return;
    }
    // v3.0.0（R8）：路径首段是浏览目录名 → 映射到真实目录
    const hit = this.resolveInsideRoot(roots, rel);
    const abs = hit ? safeJoin(hit.root.real, hit.inside || '.') : null;
    if (!abs) {
      res.status(400).json({ success: false, message: '文件路径越界' });
      return;
    }
    let st;
    try {
      st = await fsp.stat(abs);
    } catch (err) {
      logLocalFileError('预览定位文件', `渠道=${r.channel!.name} 路径=${rel}`, err);
      res.status(404).json({ success: false, message: '文件不存在' });
      return;
    }
    if (!st.isFile()) {
      res.status(400).json({ success: false, message: '不是文件' });
      return;
    }
    const ext = path.extname(abs).replace(/^\./, '').toLowerCase();
    const type = localTypeOf(ext);
    const download = q.download === '1' || q.download === 'true';
    const cfg = await this.readSettings();
    const tooBig = st.size > cfg.previewThresholdMB * 1024 * 1024;
    const asAttachment = download || tooBig || !INLINE_TYPES.has(type);

    const mime = mimeOf(ext);
    res.setHeader('Content-Type', mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=60');
    const fileName = path.basename(abs);
    res.setHeader(
      'Content-Disposition',
      `${asAttachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    // 预览内容可能包含用户文件，禁止被当成页面脚本执行
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const range = String(req.headers.range || '');
    if (range && /^bytes=/.test(range)) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.replace(/\s/g, ''));
      if (!m) {
        res.status(416).end();
        return;
      }
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (Number.isNaN(start) || start >= st.size || end < start) {
        res.setHeader('Content-Range', `bytes */${st.size}`);
        res.status(416).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      createReadStream(abs, { start, end }).pipe(res);
      return;
    }
    res.setHeader('Content-Length', String(st.size));
    createReadStream(abs).pipe(res);
  }

  /**
   * 批量上传到图床：{ channelId, paths: [], targetChannelId?, instanceId?, uploadFolder? }
   * 逐个文件走主上传链路（去重 → 压缩/转码 → 写渠道 → 落库 → 签发外链），
   * 单个文件失败不影响其它文件，结果逐条返回。
   */
  @Post('upload')
  async upload(
    @Body()
    body: {
      channelId?: string;
      paths?: string[];
      targetChannelId?: string;
      instanceId?: string;
      uploadFolder?: string;
      /**
       * v1.2.1（需求）：上传来源。此前这里写死 'Default'，导致「发布笔记 → 选择文件 →
       * 挂载文件 → 上传到图床」进来的附件，在文件详情里显示成「默认」而不是「附件上传」。
       * 只接受白名单内的前端来源（Upload / Fetch / Attachment），其余一律回落 Default。
       */
      uploadSource?: string;
    },
    @Req() req: Request,
  ) {
    const session = this.session(req);
    if (!session) return { success: false, message: '请先登录' };
    const r = await this.resolveChannel(req, String(body?.channelId || ''));
    if (r.error) return { success: false, message: r.error };
    const roots = r.roots!;
    const paths = Array.isArray(body?.paths) ? body.paths.slice(0, 200) : [];
    if (!paths.length) return { success: false, message: '请选择要上传的文件' };
    const ip = String(req.ip || '').replace(/^::ffff:/, '');

    const results: { path: string; name: string; success: boolean; id?: string; dedup?: boolean; error?: string }[] = [];
    for (const raw of paths) {
      const rel = sanitizeRelativeDir(raw);
      const name = rel ? path.basename(rel) : '';
      if (rel === null || !rel) {
        results.push({ path: String(raw || ''), name, success: false, error: '路径不合法' });
        continue;
      }
      // v3.0.0（R8）：路径首段是浏览目录名 → 映射到真实目录
      const hit = this.resolveInsideRoot(roots, rel);
      const abs = hit ? safeJoin(hit.root.real, hit.inside || '.') : null;
      if (!abs) {
        results.push({ path: rel, name, success: false, error: '路径越界' });
        continue;
      }
      try {
        const st = await fsp.stat(abs);
        if (!st.isFile()) {
          results.push({ path: rel, name, success: false, error: '不是文件' });
          continue;
        }
        const ext = path.extname(abs).replace(/^\./, '').toLowerCase();
        const res = await this.uploads.upload(
          { buffer: Buffer.alloc(0), path: abs, size: st.size, mime: mimeOf(ext), originalName: name },
          {
            channelId: String(body?.targetChannelId || '') || undefined,
            uploader: session.user,
            owner: session.user,
            ip,
            uploadFolder: String(body?.uploadFolder || '') || undefined,
            instanceId: String(body?.instanceId || '') || undefined,
            uploadSource: isClientUploadSource(body?.uploadSource)
              ? normalizeUploadSource(body?.uploadSource)
              : 'Default',
            // v3.0.0（R14）：本地文件管理页上传的文件自动加「本地上传」标签
            extraTags: ['本地上传'],
            // 本地文件是外部已有文件，不做「白名单格式 / 大小上限」拦截（与 WebDAV 通道同口径）
            skipFileLimits: true,
          },
        );
        if (res.error) {
          results.push({ path: rel, name, success: false, error: res.error });
          appLog.warn('localfiles', `上传到图床失败：${name}`, `${rel} ｜ ${res.error}`);
        } else {
          results.push({ path: rel, name, success: true, id: res.id, dedup: !!res.dedup });
          appLog.info(
            'localfiles',
            `本地文件已上传到图床：${name}`,
            // v1.2.1：带上来源 —— 「详情里为什么显示成默认」这类问题看这一行就能定位
            `${rel} ｜ 文件ID=${res.id} ｜ 来源=${isClientUploadSource(body?.uploadSource) ? normalizeUploadSource(body?.uploadSource) : 'Default'}` +
              (res.dedup ? ' ｜ 命中已有内容（去重）' : ''),
            ip,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ path: rel, name, success: false, error: msg });
        logLocalFileError('上传', `渠道=${r.channel!.name} 文件=${rel}`, err);
      }
    }
    return { success: true, data: results };
  }
}
