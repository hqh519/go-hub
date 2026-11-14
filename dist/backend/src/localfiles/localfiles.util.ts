/**
 * 本地文件系统（v3.0.0）
 * ----------------------------------------------------------------------------
 * 用途：把一个「已挂载进容器的目录」当作文件浏览器来用 —— 浏览、预览、批量上传到图床。
 *
 * 与「本地存储渠道」的区别：
 *   · 本地存储渠道（type=local）参与上传，文件由本系统写入；
 *   · 本地文件渠道（type=localfiles）**只读**，不参与上传，只用来浏览外部已有文件；
 *     勾选后点「上传到图床」，才走完整的上传链路（去重 → 压缩/转码 → 写渠道 → 落库 → 签发外链）。
 *
 * 安全边界（缺一不可）：
 *   ① 所有路径都基于渠道配置的 rootPath 解析，先 path.resolve 再用 realpath 复核；
 *   ② 任何一段出现 `..` 直接拒绝（防止越出根目录）；
 *   ③ 隐藏 .env / .git / node_modules / 以 `#` 开头的目录与文件；
 *   ④ 预览接口要求登录会话 + 渠道可见性，且不计入文件访问统计。
 */

import { promises as fsp, createReadStream } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { appLog } from '../common/app-log';

/** 单个目录最多列出多少个条目（可被设置面板覆盖） */
export const DEFAULT_MAX_PER_DIR = 200;
/** 预览走流式直出的大小上限（超过则只给下载） */
export const DEFAULT_PREVIEW_THRESHOLD_MB = 500;
/** 默认每页条数 */
export const DEFAULT_PAGE_SIZE = 50;

/** 永远隐藏的目录名（出现在任意层级都不展示） */
const HIDDEN_DIR_NAMES = new Set(['.git', '.svn', 'node_modules', '@eaDir', '__MACOSX']);

export interface LocalEntry {
  /** 相对 rootPath 的路径（统一用 `/` 分隔，不含前导斜杠） */
  path: string;
  name: string;
  /** file | dir */
  kind: 'file' | 'dir';
  size: number;
  /** 毫秒时间戳 */
  mtime: number;
  /** 小写扩展名（不含点），目录为空串 */
  ext: string;
  /** 粗分类：image / video / audio / pdf / text / other（目录为空串） */
  type: string;
}

export interface LocalChannelInfo {
  id: string;
  code: string;
  name: string;
  rootPath: string;
  enabled: boolean;
  authorized: boolean;
}

export interface LocalListResult {
  entries: LocalEntry[];
  total: number;
  page: number;
  pageSize: number;
  /** 被单目录上限截断时为 true（提示用户缩小范围 / 用搜索） */
  truncated: boolean;
  /** 当前目录下的子目录名（用于左侧目录树懒加载） */
  dirs: string[];
}

/** 扩展名 → 粗分类（与前端灯箱的 kind 对齐，便于直接复用预览组件） */
export function localTypeOf(ext: string): string {
  const e = String(ext || '').toLowerCase();
  if (['jpg', 'jpeg', 'jfif', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif', 'ico', 'tiff', 'tif', 'heic'].includes(e)) return 'image';
  // 注意：`.ts` 既可能是 MPEG-TS 视频，也可能是 TypeScript 源码；这里按「文本」处理（见下方 text 分支）
  if (['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'flv', 'wmv', 'm3u8', 'mpg', 'mpeg'].includes(e)) return 'video';
  if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'wma', 'ape', 'aiff'].includes(e)) return 'audio';
  if (e === 'pdf') return 'pdf';
  /*
   * v3.0.0（R15）：所有「能用文本方式打开」的扩展名都归 text ——
   * 补齐脚本 / 模板 / 配置 / 源码类（php、vue、toml、rs、rb、lua…），
   * 之前它们落到 other，灯箱里只能下载、不能浏览。
   */
  if ([
    'txt', 'text', 'md', 'markdown', 'json', 'jsonl', 'ndjson', 'json5', 'log', 'csv', 'tsv',
    'ini', 'conf', 'cfg', 'properties', 'yml', 'yaml', 'toml', 'xml', 'plist', 'xaml',
    'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl',
    'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'vue', 'svelte',
    'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1',
    'py', 'go', 'java', 'kt', 'kts', 'scala', 'groovy', 'gradle',
    'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'm', 'mm', 'swift', 'rs', 'dart',
    'rb', 'php', 'phtml', 'pl', 'pm', 'lua', 'r', 'jl', 'tex', 'rst', 'proto',
    'sql', 'graphql', 'gql', 'env', 'lock', 'map', 'diff', 'patch', 'srt', 'vtt',
    'htaccess', 'dockerfile', 'makefile', 'gitignore', 'editorconfig',
    'service', 'nginx', 'asm', 's',
  ].includes(e)) return 'text';
  return 'other';
}

/** 需要隐藏的条目：点开头的隐藏文件 / `#` 开头（临时文件）/ node_modules 等 */
export function isHiddenName(name: string): boolean {
  if (!name) return true;
  if (name.startsWith('.') || name.startsWith('#')) return true;
  return HIDDEN_DIR_NAMES.has(name);
}

/**
 * 把用户传入的相对路径规整成安全形式：
 *   · 反斜杠统一成 `/`，去掉前导 `/` 与重复斜杠；
 *   · 任一段为 `..` 直接拒绝（返回 null）；
 *   · 空串表示根目录。
 */
export function sanitizeRelativeDir(raw: string | undefined | null): string | null {
  const v = String(raw ?? '').replace(/\\/g, '/').trim();
  if (!v) return '';
  const segs = v.split('/').filter((s) => s !== '' && s !== '.');
  if (segs.some((s) => s === '..')) return null;
  if (segs.some((s) => isHiddenName(s))) return null;
  return segs.join('/');
}

/** 相对路径 → 绝对路径（必须在根目录内；越界返回 null） */
export function safeJoin(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel || '.');
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

/** 绝对路径 → 相对 rootPath 的路径（用于返回给前端） */
export function toRelative(root: string, abs: string): string {
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join('/');
}

/** 流式计算文件 MD5（大文件不读进内存） */
export function hashFile(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    const stream = createReadStream(absPath);
    stream.on('data', (chunk) => hash.update(chunk as Buffer));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * v3.0.0（R5）：本地文件渠道**仅管理员可用**，不再做渠道授权。
 *
 * 原因：该渠道直接暴露服务器 / 容器内的真实目录，授权给普通用户风险过高；
 * 需求也明确「这个渠道不需要授权给其他用户，只有管理员可管理使用」。
 * 因此这里取代了原先按 authorizedUsers 判断的 channelVisible()。
 */
export function localFilesAdminOnly(role: string): boolean {
  return role === 'admin' || role === 'super';
}

/** 记录一次本地文件系统的错误（统一日志域 localfiles，便于排查权限 / 路径问题） */
export function logLocalFileError(action: string, detail: string, err?: unknown): void {
  const msg = err instanceof Error ? err.message : String(err || '');
  appLog.error('localfiles', `本地文件${action}失败`, `${detail}${msg ? ` ｜ ${msg}` : ''}`);
}

/** 把目录条目排序（默认按名称；支持 name/size/mtime/type） */
export function sortEntries(list: LocalEntry[], sort = 'name', order = 'asc'): LocalEntry[] {
  const dir = order === 'desc' ? -1 : 1;
  const key = sort === 'size' ? 'size' : sort === 'mtime' ? 'mtime' : sort === 'type' ? 'type' : 'name';
  return [...list].sort((a, b) => {
    // 目录恒排在最前（无论升序降序）
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    if (key === 'name') return a.name.localeCompare(b.name, 'zh-CN') * dir;
    /*
     * v1.2.1（需求：选文件器支持按类型排序）：
     * 粗分类（image / video / audio / pdf / text / other）相同的再按扩展名聚一次，
     * 否则「按类型」在图片之间看不出任何顺序。
     */
    if (key === 'type') {
      const byType = String(a.type || '').localeCompare(String(b.type || ''));
      if (byType !== 0) return byType * dir;
      const byExt = String(a.ext || '').localeCompare(String(b.ext || ''));
      if (byExt !== 0) return byExt * dir;
      return a.name.localeCompare(b.name, 'zh-CN');
    }
    if (a[key] === b[key]) return a.name.localeCompare(b.name, 'zh-CN');
    return (a[key] - b[key]) * dir;
  });
}

/** 读取目录（只返回一层；隐藏项过滤 + 单目录上限保护） */
export async function readDirEntries(absDir: string, root: string, maxPerDir: number): Promise<{ entries: LocalEntry[]; truncated: boolean; dirs: string[] }> {
  const dirs: string[] = [];
  const entries: LocalEntry[] = [];
  const names = await fsp.readdir(absDir, { withFileTypes: true });
  let truncated = false;
  let seen = 0;
  for (const d of names) {
    if (isHiddenName(d.name)) continue;
    seen += 1;
    if (seen > maxPerDir) {
      truncated = true;
      break;
    }
    const abs = path.join(absDir, d.name);
    const rel = toRelative(root, abs);
    let kind: 'file' | 'dir' = d.isDirectory() ? 'dir' : 'file';
    let size = 0;
    let mtime = 0;
    try {
      const st = await fsp.stat(abs);
      // 符号链接：只认可指向普通文件/目录的目标，其它（设备文件、管道）忽略
      if (st.isDirectory()) kind = 'dir';
      else if (st.isFile()) kind = 'file';
      else continue;
      size = st.size;
      mtime = st.mtimeMs;
    } catch {
      continue;
    }
    const ext = kind === 'file' ? path.extname(d.name).replace(/^\./, '').toLowerCase() : '';
    if (kind === 'dir') dirs.push(d.name);
    entries.push({ path: rel, name: d.name, kind, size, mtime, ext, type: kind === 'file' ? localTypeOf(ext) : '' });
  }
  dirs.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return { entries, truncated, dirs };
}

/**
 * 递归收集某目录下的全部子目录（最多 limit 个，供目录树一次性展开）
 *
 * v3.0.0（R12）修复「内容区有、目录树缺」：
 *   · 原来只认 `Dirent.isDirectory()`，符号链接 / 绑定挂载（Docker 里很常见）返回 false，
 *     这些目录在内容区（readDirEntries 会 stat 后再判定）能看到，却永远进不了目录树；
 *   · 现在对非目录项补一次 stat 判定，并用 realpath 去重防符号链接成环。
 */
export async function collectDirs(absRoot: string, root: string, limit = 500): Promise<string[]> {
  const out: string[] = [];
  const visited = new Set<string>();
  const walk = async (dir: string) => {
    if (out.length >= limit) return;
    let real = dir;
    try {
      real = await fsp.realpath(dir);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    let names: import('fs').Dirent[] = [];
    try {
      names = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      if (out.length >= limit) return;
      if (isHiddenName(d.name)) continue;
      const abs = path.join(dir, d.name);
      let isDir = d.isDirectory();
      if (!isDir && !d.isFile()) {
        // 符号链接 / 特殊项：stat 跟随链接后再判定（链接到目录 → 视为目录）
        try {
          isDir = (await fsp.stat(abs)).isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (!isDir) continue;
      out.push(toRelative(root, abs));
      await walk(abs);
    }
  };
  await walk(absRoot);
  return out.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
