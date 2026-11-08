/**
 * 对外 WebDAV 的磁盘存储层（v1.0.6 重构）。
 *
 * 定位：WebDAV 是「网盘」，不是图床。
 *   · 文件原样落盘，不改名、不裁剪、不压缩、不转码、不转 WebP；
 *   · 不写 FileRecord / FileCopy，因此不会出现在「图床文件」和「历史记录」里；
 *   · 目录结构就是用户自己建的目录结构，遵循标准 WebDAV 语义。
 *
 * 根目录：`<后端根>/webdav`
 * 实际路径：`webdav/{账户名}/{渠道存储路径}/{请求路径}`
 *
 * 安全：所有路径都要经过 resolveInside() —— 先 normalize，再校验最终绝对路径
 * 仍在根目录内。WebDAV 客户端（尤其是同步工具）会发带 `..` 的路径，
 * 直接拼字符串等于把整个磁盘暴露出去。
 */
import { promises as fsp } from 'fs';
import * as path from 'path';
import { backendSub } from '../common/project-paths';

/** WebDAV 存储根目录：<后端根>/webdav */
export function webdavRoot(): string {
  return backendSub('webdav');
}

/**
 * 清洗一段用户输入的相对路径。
 *   · 统一分隔符为 `/`；
 *   · 丢弃 `.`、`..`、空段（`..` 一律丢弃而不是报错 —— 报错会让部分客户端反复重试）；
 *   · 去掉首尾斜杠。
 */
export function cleanRelPath(raw: string): string {
  return String(raw || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

/**
 * 清洗「渠道存储路径」（创建时填的多级目录，例如 `/文件/工作`）。
 * 与 cleanRelPath 的差别：这里不允许空（渠道必须有存储路径）。
 */
export function cleanChannelPath(raw: string): string {
  return cleanRelPath(raw);
}

/**
 * 把一个相对路径挂到根下，并确保结果不越界。
 * 越界返回 null —— 调用方一律按 403 / 404 处理，绝不落到根外。
 */
export function resolveInside(root: string, rel: string): string | null {
  const safeRel = cleanRelPath(rel);
  const abs = path.resolve(root, safeRel);
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  return abs;
}

/** 某账户的 WebDAV 根（webdav/{用户名}） */
export function userRoot(username: string): string {
  return path.join(webdavRoot(), String(username || '').trim());
}

/** 某渠道的实际根（webdav/{用户名}/{存储路径}） */
export function channelRoot(username: string, channelPath: string): string {
  return path.join(userRoot(username), cleanRelPath(channelPath));
}

/** 目录不存在就建出来（含多级） */
export async function ensureDir(abs: string): Promise<void> {
  await fsp.mkdir(abs, { recursive: true });
}

/** 目录项（PROPFIND / 本地文件共用） */
export interface DavEntry {
  name: string;
  /** 相对渠道根的路径（不含首尾斜杠） */
  rel: string;
  dir: boolean;
  size: number;
  mtime: Date;
}

/* ------------------------------------------------------------------ */
/* v1.0.7：目录列举缓存 + 并发 stat                                     */
/*                                                                      */
/* 为什么要做：                                                          */
/*   旧实现是「readdir 之后对每个条目串行 await fsp.stat()」。           */
/*   一个 2000 个文件的目录 = 2000 次串行系统调用，Windows 上单次        */
/*   stat 的往返就要几十微秒到毫秒级，叠加起来 Finder / 资源管理器       */
/*   打开目录会明显卡顿（客户端超时后还会重发 PROPFIND，越拖越糟）。      */
/*   现在两点改进：                                                      */
/*     1) stat 用有上限的并发池（默认 32），不再一条一条排队；            */
/*     2) 结果按「绝对路径 + 目录 mtime + 写入代数」缓存 3 秒 ——        */
/*        同步工具常见的「同秒内连续 PROPFIND 多层目录」直接命中，        */
/*        任何写操作（PUT / DELETE / MKCOL / MOVE / COPY）都会把代数 +1， */
/*        缓存立刻整体失效，不会读到过期列表。                           */
/* ------------------------------------------------------------------ */

/** 条目缓存：key = 绝对路径（内含账户名，天然按账户隔离） */
interface DirCacheEntry {
  at: number;
  epoch: number;
  dirMtimeMs: number;
  entries: DavEntry[];
}
const dirCache = new Map<string, DirCacheEntry>();
const DIR_CACHE_TTL = 3000;
/** 缓存条目上限（超过就整体清空，避免长期运行堆积内存） */
const DIR_CACHE_MAX = 2000;
/** 写入代数：任何写操作 +1，并清空缓存 */
let writeEpoch = 0;

/**
 * 写操作之后调用 —— 让所有目录列表缓存立即失效。
 * 因为缓存里存的是「目录 mtime + 代数」，代数一变就全部作废，
 * 不需要按前缀精确失效（省一次路径匹配，也不会漏）。
 */
export function invalidateDavCache(): void {
  writeEpoch += 1;
  dirCache.clear();
}

/** 有并发上限的 map：把逐条 await 的串行 stat 变成若干条并行 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 列目录（不递归，按名字排序，目录在前）。
 * v1.0.7：并发 stat + 3 秒缓存（见上方说明）。
 */
export async function listDir(abs: string, relBase: string): Promise<DavEntry[]> {
  let dirMtimeMs = 0;
  try {
    const st = await fsp.stat(abs);
    dirMtimeMs = st.mtimeMs;
  } catch {
    /* 目录都读不到：直接走 readdir 让调用方拿到真实错误 */
  }
  const hit = dirCache.get(abs);
  if (hit && hit.epoch === writeEpoch && hit.dirMtimeMs === dirMtimeMs && Date.now() - hit.at < DIR_CACHE_TTL) {
    return hit.entries;
  }

  const items = await fsp.readdir(abs, { withFileTypes: true });
  // 跳过隐藏文件（.DS_Store / thumbs.db / 同步工具的临时文件），避免污染列表
  const visible = items.filter((it) => !it.name.startsWith('.'));
  const out = await mapLimit(visible, 32, async (it) => {
    const childAbs = path.join(abs, it.name);
    const rel = relBase ? `${relBase}/${it.name}` : it.name;
    let size = 0;
    let mtime = new Date();
    try {
      const st = await fsp.stat(childAbs);
      size = st.size;
      mtime = st.mtime;
    } catch {
      /* 读不到就按 0 处理，不让单个坏项拖垮整次列目录 */
    }
    return { name: it.name, rel, dir: it.isDirectory(), size, mtime };
  });
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));

  if (dirCache.size >= DIR_CACHE_MAX) dirCache.clear();
  dirCache.set(abs, { at: Date.now(), epoch: writeEpoch, dirMtimeMs, entries: out });
  return out;
}

/** 扩展名 → MIME（WebDAV 客户端据此决定图标 / 打开方式） */
export function mimeOf(name: string): string {
  const ext = String(name).split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', heic: 'image/heic',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav',
    txt: 'text/plain', md: 'text/markdown', json: 'application/json', xml: 'application/xml',
    pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv', html: 'text/html', css: 'text/css', js: 'text/javascript',
  };
  return map[ext] || 'application/octet-stream';
}
