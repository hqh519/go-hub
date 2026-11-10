/**
 * 笔记板块 · 公共工具（v1.2.0）
 * ----------------------------------------------------------------------------
 * 这里放的全是「前后端必须用同一套口径」的规则：
 *   · 字数怎么数（瞬间 500 字上限）
 *   · 媒体类型怎么归类（纯文字 / 图片 / 视频 / 音频 / 混合）
 *   · 附件地址怎么拼（fileId → /file/<当前 File_ID>）
 *   · 标签名怎么清洗
 *
 * 为什么要单独成文件：字数与媒体类型都在「保存时算一次、列表直接读」的冗余列里，
 * 一旦前后端口径不一致，就会出现「前端说没超、后端说超了」这种最难解释的 bug。
 * 前端对应实现见 `frontend/src/utils/notes.js`，两处逻辑必须逐行等价。
 */

/** 笔记类型（本版只实现 moment，其余为后续版本的预留取值） */
export const NOTE_KINDS = ['moment', 'article', 'collection', 'nav', 'todo', 'board'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** 瞬间的媒体类型 */
export const MOMENT_MEDIA_KINDS = ['text', 'image', 'video', 'audio', 'mixed'] as const;
export type MomentMediaKind = (typeof MOMENT_MEDIA_KINDS)[number];

/** 瞬间正文字数上限（只数汉字/字母/数字，不含标点与符号） */
export const DEFAULT_MOMENT_MAX_CHARS = 500;

/**
 * 单篇附件的硬上限。
 * 需求是「列表只显示 9 个，超出部分点灯箱浏览」，所以 9 不是上限；
 * 但完全不设上限会让一个请求塞进几千个 fileId，这里取 50 作为防滥用边界。
 */
export const MAX_ASSETS_PER_NOTE = 50;

/** 单个标签名长度上限、单篇标签数量上限 */
export const MAX_TAG_NAME_LENGTH = 20;
export const MAX_TAGS_PER_NOTE = 20;

/** 可见性白名单（本版只落 private / public；specified = 指定人，留到分享版本） */
export const NOTE_VISIBILITIES = ['private', 'public', 'specified'] as const;

/**
 * 正文字数统计：只数「汉字 + 字母 + 数字」。
 *
 * 按需求原文「500 个字（不含标点和其他特殊符号）」：
 *   · 标点（，。！？、；：""''（）…）不计入
 *   · 空格 / 换行不计入
 *   · emoji / 特殊符号不计入
 *   · 中日韩汉字、拉丁字母、数字计入（`\p{L}` 已覆盖汉字与各语种字母）
 *
 * 用 for...of 按「码点」遍历而不是 `.length` —— 否则一个 emoji 会被算成 2 个字符，
 * 生僻字（代理对）也会算错。
 */
export function countTextChars(input: unknown): number {
  const s = String(input ?? '');
  if (!s) return 0;
  let n = 0;
  for (const ch of s) {
    if (/[\p{L}\p{N}]/u.test(ch)) n += 1;
  }
  return n;
}

/** 单个文件的媒体大类（用于九宫格排版与「媒体类型」聚合） */
export function mediaKindOfMime(mime: string): 'image' | 'video' | 'audio' | 'file' {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * 由附件 mime 列表推导瞬间的媒体类型：
 *   无附件                → text
 *   全部 image/*          → image
 *   全部 video/*          → video
 *   全部 audio/*          → audio
 *   其余（含多种、含普通文件） → mixed
 */
export function mediaKindOf(mimes: string[]): MomentMediaKind {
  const list = (mimes || []).filter(Boolean);
  if (list.length === 0) return 'text';
  const kinds = new Set(list.map((m) => mediaKindOfMime(m)));
  if (kinds.size > 1) return 'mixed';
  const only = Array.from(kinds)[0];
  if (only === 'image') return 'image';
  if (only === 'video') return 'video';
  if (only === 'audio') return 'audio';
  return 'mixed';
}

/**
 * 文件「当前」外链：`/file/<File_ID>`（逐段编码，File_ID 允许带目录层级）。
 *
 * 这是本模块唯一允许拼附件地址的地方。为什么不返回渠道直链：
 *   · 渠道直链带域名 —— 换自定义域名后历史数据全挂；
 *   · 渠道直链在「转存 / 存入本地」后会指向旧渠道 —— 换渠道后全挂；
 *   · `/file/<name>` 由服务端按当前主副本实时取流，改名/换渠道/换域名都自动跟随。
 *
 * 调用方必须用**当前**的 FileRecord.name 来拼（不是上传时记下的名字），
 * 文件改名后列表刷新即恢复，这也是「只存 fileId」的全部意义。
 */
export function fileUrlOf(name: string, thumb?: number): string {
  const raw = String(name || '').replace(/^\/+/, '');
  if (!raw) return '';
  const path = raw.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  const q = Number(thumb) > 0 ? `?thumb=${Math.round(Number(thumb))}` : '';
  return `/file/${path}${q}`;
}

/** 标签名清洗：去首尾空白、压缩内部空白、去重、限量 */
export function normalizeTagNames(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? String(raw).split(/[,，]/) : [];
  const out: string[] = [];
  for (const item of list) {
    let name = String(item ?? '')
      .replace(/[\r\n\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;
    if (name.length > MAX_TAG_NAME_LENGTH) name = name.slice(0, MAX_TAG_NAME_LENGTH);
    if (out.includes(name)) continue;
    out.push(name);
    if (out.length >= MAX_TAGS_PER_NOTE) break;
  }
  return out;
}

/** 安全 JSON.parse（坏数据不抛异常） */
export function safeParse(raw: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  const s = String(raw ?? '');
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : fallback;
  } catch {
    return fallback;
  }
}

/** 截断字符串（写日志用，避免把整篇正文灌进日志） */
export function brief(text: unknown, max = 60): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
