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
 *
 * 权限：管理员全部可用；普通用户仅能访问「授权名单包含自己」的本地文件渠道。
 */

import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { createReadStream, promises as fsp } from 'fs';
import * as path from 'path';
import { prisma } from '../common/prisma';
import { appLog } from '../common/app-log';
import { currentSession } from '../auth/auth.guard';
import { SettingsService } from '../settings/settings.service';
import { UploadService } from '../upload/upload.service';
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
  ) {}

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
    if (!id) return { error: '请选择本地文件渠道' as string };
    const ch = await prisma.channel.findFirst({ where: { type: 'localfiles', OR: [{ id }, { code: id }] } });
    if (!ch) return { error: '渠道不存在或不是「本地文件」渠道' };
    if (!ch.enabled) return { error: '该渠道已停用' };
    if (!localFilesAdminOnly(this.role(req))) {
      return { error: '本地文件渠道仅管理员可用' };
    }
    let cfg: Record<string, any> = {};
    try {
      cfg = JSON.parse(ch.config || '{}');
    } catch {
      cfg = {};
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
    // v3.0.0（R5）：本地文件渠道仅管理员可见可用（不做渠道授权）
    if (!localFilesAdminOnly(this.role(req))) return { success: true, data: [] };
    const rows = await prisma.channel.findMany({ where: { type: 'localfiles' }, orderBy: [{ typeCode: 'asc' }, { name: 'asc' }] });
    const list = rows
      .map((ch) => {
        let rootPath = '';
        try {
          rootPath = String(JSON.parse(ch.config || '{}').rootPath || '');
        } catch {
          rootPath = '';
        }
        return { id: ch.id, code: ch.code, name: ch.name, rootPath, enabled: ch.enabled };
      });
    return { success: true, data: list };
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
    let rows: { name: string; size: number; originalSize: number; md5: string }[] = [];
    try {
      rows = await prisma.fileRecord.findMany({
        where: { status: 'active', OR: [{ size: { in: sizes } }, { originalSize: { in: sizes } }] },
        select: { name: true, size: true, originalSize: true, md5: true },
        take: 500,
      });
    } catch {
      return out;
    }
    if (!rows.length) return out;
    const bySize = new Map<number, { name: string; md5: string }[]>();
    for (const r of rows) {
      for (const s of new Set([r.size, r.originalSize])) {
        if (!s) continue;
        if (!bySize.has(s)) bySize.set(s, []);
        bySize.get(s)!.push({ name: r.name, md5: r.md5 || '' });
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
        const match = cands.find((c) => c.md5 && c.md5 === md5);
        if (match) out.set(f.path, match.name);
      } catch {
        /* 单个文件读不到不影响整页 */
      }
    }
    return out;
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
            uploadSource: 'Default',
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
            `${rel} ｜ 文件ID=${res.id}${res.dedup ? ' ｜ 命中已有内容（去重）' : ''}`,
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
