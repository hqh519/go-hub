/**
 * 存储路径 / 文件命名模板 —— 渠道配置里的「自定义存储前缀」与「自定义文件命名」。
 *
 * 两套占位符：
 *   前缀（目录部分）：{y} 年（4 位） / {m} 月（2 位） / {d} 日（2 位） /
 *                     {ID} 渠道 ID（6 位业务 code，缺省回落主键） /
 *                     {user} 上传者当前用户名（原样，不再追加随机数字） /
 *                     {domain} 渠道外链域名（publicDomain，未配置则为空）
 *   文件命名（文件名部分）：{hash} 内容哈希前 16 位（v3.0.0 R9） / {filename} 原文件名（已清洗） /
 *                          {uuid} uuid / {md5} md5（内容哈希不可得时用随机串兜底） /
 *                          {timestamp} 13 位毫秒时间戳 / {ext} 扩展名（含点，v3.0.0）
 *
 * 约定：
 *   - 前缀为空 → 默认 `{y}/{m}`（即 2026/10）；末尾斜杠统一由调用方补齐；
 *   - 命名字段为空 → 默认 `{hash}`（v3.0.0 R9 起，原默认 `{filename}-{timestamp}`）；
 *   - 模板里若没写 {ext}，会自动补上原扩展名 —— 否则存进对象存储的文件没有后缀，
 *     浏览器拿不到正确 Content-Type，下载下来也打不开；
 *   - {filename} 只保留「文字 / 字母 / 数字 / - / _ / .」，首尾空格去掉、中间空格转 `-`；
 *   - 未知占位符原样保留（不吞掉用户输入，便于排查拼写错误）。
 */

export interface NameTokens {
  /** 原文件名（含扩展名） */
  originalName: string;
  /** 不带扩展名的文件名 */
  stem: string;
  /** 扩展名（不含点，小写） */
  ext: string;
  /** 文件内容 md5 */
  md5: string;
  /** 13 位毫秒时间戳 */
  timestamp: number;
}

/** 前缀专属占位符的取值来源（v3.0.0 R9） */
export interface PrefixTokens {
  /** 渠道 ID：{ID} —— 6 位业务 code 优先，缺省用主键 */
  channelId?: string;
  /** 上传者用户名：{user} —— 直接取当前账户用户名 */
  user?: string;
  /** 渠道外链域名：{domain} */
  domain?: string;
}

/**
 * v3.0.0（R11）：本地存储渠道「自定义存储前缀」留空时的默认模板。
 * 直接按「用户名 / 渠道 ID / 年 / 月」归档，多人多渠道共用一个根目录也不会混。
 */
export const LOCAL_DEFAULT_PREFIX = '{user}/{ID}/{y}/{m}';

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

/**
 * v3.0.0（R9）：路径 / 文件名片段清洗。
 * 只保留「文字（含中文）/ 字母 / 数字 / - / _ / .」，首尾空格清掉、中间空格替换为 `-`，
 * 并去掉首尾多余的 `-` `_` `.`（避免生成 `.hidden` 或 `-x-` 形态）。
 */
export function sanitizeNameSegment(input: string | undefined): string {
  let v = String(input ?? '').trim();
  // 去掉不允许的字符（路径分隔符、控制字符、emoji 等）
  v = v.replace(/[^\p{L}\p{N}\-_. ]+/gu, '');
  v = v.replace(/\s+/g, '-');
  v = v.replace(/-{2,}/g, '-');
  v = v.replace(/^[-_.]+|[-_.]+$/g, '');
  return v;
}

/** 对象前缀：占位符替换 + 规范化（去首尾斜杠、压缩重复斜杠） */
export function renderObjectPrefix(
  template: string | undefined,
  at = new Date(),
  tokens: PrefixTokens = {},
  /** v3.0.0（R11）：模板留空时使用的默认模板（缺省仍为「年/月」） */
  defaultTemplate?: string,
): string {
  const tpl = String(template ?? '').trim() || String(defaultTemplate ?? '').trim();
  if (!tpl) return `${at.getFullYear()}/${pad(at.getMonth() + 1)}`;
  /*
   * v3.0.0（R11）：{user} 直接使用当前账户用户名。
   * 旧版在这里额外拼了 3 位随机数字（abc123 → abc123524），导致每次上传落到不同目录，
   * 既没法按用户归档、也让「自定义前缀」失去意义；随机段已移除。
   */
  const userSeg = sanitizeNameSegment(tokens.user);
  const replaced = tpl
    .replace(/\{y\}/g, String(at.getFullYear()))
    .replace(/\{m\}/g, pad(at.getMonth() + 1))
    .replace(/\{d\}/g, pad(at.getDate()))
    .replace(/\{(?:ID|id)\}/g, sanitizeNameSegment(tokens.channelId))
    .replace(/\{user\}/g, userSeg)
    .replace(/\{domain\}/g, sanitizeNameSegment(tokens.domain));
  return replaced.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}

/** 文件命名：占位符替换；未含 {ext} 时自动补扩展名 */
export function renderFileName(template: string | undefined, tokens: NameTokens): string {
  const tpl = String(template ?? '').trim();
  const ext = tokens.ext || '';
  // v3.0.0（R9）：命名留空 → 默认 {hash}（内容哈希前 16 位，稳定且不重复）
  const use = tpl || '{hash}';
  const hasExtToken = /\{ext\}/.test(use);
  const md5 = tokens.md5 || '';
  const hash = md5 ? md5.slice(0, 16) : randomUuid().replace(/-/g, '').slice(0, 16);
  /*
   * v3.0.0：{ext} 语义定为「含点扩展名」—— `photo.{ext}` → `photo.jpg`、
   * `photo{ext}` 同样得到 `photo.jpg`（点不重复）。历史版本把 {ext} 展开成
   * 不带点的扩展名，模板里写 `photo.{ext}` 会得到 `photojpg`，这里一并修正。
   * v3.0.0（R9）：{filename} 按清洗规则落地（只留文字/字母/数字/-/_/.，中间空格转 -）。
   */
  let name = use
    .replace(/\{hash\}/g, hash)
    .replace(/\{filename\}/g, sanitizeNameSegment(tokens.stem) || 'file')
    .replace(/\{uuid\}/g, randomUuid())
    .replace(/\{md5\}/g, md5 || randomUuid().replace(/-/g, '').slice(0, 32))
    .replace(/\{timestamp\}/g, String(tokens.timestamp))
    .replace(/\{ext\}/g, ext ? `.${ext}` : '');
  // 去掉 Windows / 对象存储都不接受的控制字符与路径分隔符；压缩重复点（{ext} 已含点，模板再写点会得到 ".."）
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '');
  if (!name) name = hash;
  if (ext && !hasExtToken && !name.toLowerCase().endsWith('.' + ext.toLowerCase())) {
    name += '.' + ext;
  }
  return name;
}

/** 拼接目录与文件名（空目录时只返回文件名） */
export function joinObjectKey(prefix: string, fileName: string): string {
  const p = String(prefix || '').replace(/^\/+|\/+$/g, '');
  const f = String(fileName || '').replace(/^\/+/g, '');
  return p ? `${p}/${f}` : f;
}

/** RFC 4122 v4（不引依赖） */
export function randomUuid(): string {
  const b = Buffer.alloc(16);
  for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * 该渠道类型是否支持「对象前缀 / 自定义文件命名」（需求指定的 6 类）。
 * 注意：local 不在此列 —— 本地渠道的「对象前缀 / 命名模板」由 LocalAdapter
 * 自己从渠道配置读取并展开（还要叠加 上传者/实例 两级目录段），
 * 若让 upload.service 把前缀烤进 key，适配器将无法区分「原始 key」与「已展开路径」。
 */
/*
 * v3.0.0（R10）：本地存储（local）也纳入前缀/命名模板体系 ——
 * 此前它走的是「老格式」分支，导致渠道里填的「自定义存储前缀 / 自定义文件命名」完全被忽略
 * （正是「本地存储不按自定义文件命名」这个 bug 的根因）。
 * 本地适配器会在这段 key 前面再加「用户名/实例」两级目录，路径布局保持不变。
 */
export const PREFIX_CAPABLE_TYPES = ['minio', 'cos', 'aliyun', 'r2', 's3', 'webdav', 'local'] as const;

export function supportsPrefix(type: string): boolean {
  return (PREFIX_CAPABLE_TYPES as readonly string[]).includes(type);
}
