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

/** 列目录（不递归，按名字排序，目录在前） */
export async function listDir(abs: string, relBase: string): Promise<DavEntry[]> {
  const items = await fsp.readdir(abs, { withFileTypes: true });
  const out: DavEntry[] = [];
  for (const it of items) {
    // 跳过隐藏文件（.DS_Store / thumbs.db / 同步工具的临时文件），避免污染列表
    if (it.name.startsWith('.')) continue;
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
    out.push({ name: it.name, rel, dir: it.isDirectory(), size, mtime });
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
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
