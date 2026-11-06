/**
 * API Token「默认分类目录」的占位符展开（v3.0.0 R18）
 *
 * 支持的占位符（大小写不敏感）：
 *   {tokenName}  → 该 API Token 的名称
 *   {user}       → 本次上传的归属账户名（Token 未绑定账户时为管理员账户）
 *   {y}          → 4 位年份
 *   {m}          → 2 位月份
 *   {d}          → 2 位日期
 *
 * 例：`{tokenName}/{user}/{y}/{m}` → `PicList/admin/2026/11`
 *
 * 说明：
 *   · 未知占位符原样保留（不静默吞掉，避免配置写错却毫无反馈）；
 *   · 展开结果按目录规则清洗：非法字符（\/:*?"<>| 与控制字符）去掉、
 *     连续斜杠合并、首尾斜杠去掉 —— 最终交给 upload.service 的 uploadFolder。
 */

export interface FolderPlaceholderContext {
  tokenName?: string;
  user?: string;
  /** 便于测试注入固定时间 */
  now?: Date;
}

/** 目录名里不允许出现的字符（Windows / S3 key 都按这套清洗最安全） */
const ILLEGAL_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

function safeSegment(input: unknown): string {
  return String(input ?? '')
    .replace(ILLEGAL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function expandFolderPlaceholders(raw: string, ctx: FolderPlaceholderContext = {}): string {
  const source = String(raw || '');
  if (!source) return '';

  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const values: Record<string, string> = {
    tokenname: safeSegment(ctx.tokenName),
    user: safeSegment(ctx.user),
    y: String(now.getFullYear()),
    m: pad(now.getMonth() + 1),
    d: pad(now.getDate()),
  };

  const expanded = source.replace(/\{([A-Za-z]+)\}/g, (whole, key: string) => {
    const k = String(key).toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : whole;
  });

  return expanded
    .replace(/\\/g, '/')
    // 目录名里的非法字符一并清掉（不含分隔斜杠）；占位符取值已在 safeSegment 里处理过
    .replace(/[:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');
}
