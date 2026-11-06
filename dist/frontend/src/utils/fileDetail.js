/**
 * 文件详情 —— 通用数据构造器（配合 `components/dashboard/FileDetailDialog.vue` 复用）。
 *
 * 后台「文件管理」与「历史记录」都用同一个 `FileDetailDialog` 模板展示文件详情，
 * 差别只在「喂给它的数据」。这个文件把这三样统一算出来：
 *   · file     —— 文件记录本身（`{ name, metadata }`，列表项就是这个结构）
 *   · fileLink —— 预览用的地址（后台内部走 ?from=admin，避开黑白名单/域名白名单）
 *   · urls     —— 原始链接 / Markdown / HTML / BBCode / TG File ID / S3 等复制用文本
 *
 * 任何页面只要拿到一条文件记录，调 `buildFileDetail(file)` 就能把整套详情弹窗挂上去，
 * 不用再各写一套拼链接的逻辑（全站文件链接统一走 utils/fileLink 的出口）。
 */
import { fileLink } from '@/utils/fileLink';

/** 取扩展名（优先 metadata.FileExt，其次从显示文件名推断），小写、不带点 */
export function fileExtOf(fileOrMetadata) {
  if (!fileOrMetadata) return '';
  const meta = fileOrMetadata.metadata || fileOrMetadata;
  if (meta.FileExt) return String(meta.FileExt).toLowerCase().replace(/^\./, '');
  const name = meta.FileName || (typeof fileOrMetadata === 'string' ? fileOrMetadata : '') || '';
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(String(name));
  return m ? m[1].toLowerCase() : '';
}

/**
 * 在链接末尾补上扩展名 —— 仅用于直观展示文件类型。
 * 已有扩展名（或已是已知文件后缀）时原样返回；带 query / hash 时只改路径部分。
 */
export function withExt(url, ext) {
  if (!url || !ext) return url;
  const [base, hash = ''] = String(url).split('#');
  const [path, query = ''] = base.split('?');
  const lower = path.toLowerCase();
  if (new RegExp(`\\.${String(ext).toLowerCase()}$`).test(lower)) return url;
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|heic|mp4|webm|mov|m4v|mp3|m4a|aac|ogg|wav|flac|zip|pdf)$/i.test(path)) return url;
  return `${path}.${ext}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}

/**
 * 对外可复制的完整外链（含自定义访问域名，**不带** ?from=admin）。
 * 用于「文件详情 → 原始链接 / Markdown / HTML / BBCode」以及各类复制入口。
 */
export function filePublicUrl(name, metadata) {
  return fileLink(name, fileExtOf(metadata || name));
}

/**
 * 后台内部预览 / 取流地址：带 ?from=admin 走管理员会话，
 * 不受黑白名单与域名白名单限制 —— 只用于 <img>/<video> 预览、批量下载。
 */
export function filePreviewUrl(name, metadata) {
  return `${withExt(`/file/${name}`, fileExtOf(metadata || name))}?from=admin`;
}

/**
 * 构造 FileDetailDialog 需要的 `urls` 对象（各复制格式）。
 * `metadata.Channel === 'External'` 时用渠道返回的原始外链，其余走本站签发链接。
 */
export function buildFileDetailUrls(file) {
  const metadata = file?.metadata || {};
  const displayName = metadata.FileName || file?.name || '';
  const unknown = '-';
  const ext = fileExtOf(metadata || file?.name);
  const external = metadata.Channel === 'External' ? withExt(metadata.ExternalLink, ext) : '';
  const url = external || filePublicUrl(file?.name, metadata);

  return {
    originUrl: url,
    mdUrl: `![${displayName}](${url})`,
    htmlUrl: `<img src="${url}" alt="${displayName}">`,
    bbUrl: `[img]${url}[/img]`,
    tgId: metadata.TgFileId || unknown,
    S3Location: metadata.S3Location || unknown,
    S3CdnFileUrl: metadata.S3CdnFileUrl || unknown,
  };
}

/**
 * 一站式构造详情弹窗所需的全部 props。
 * @param {{name:string, metadata:object}} file 文件记录（列表项）
 * @param {{previewMode?:'admin'|'public'}} [opts]
 *        previewMode='admin'（默认）→ 预览地址带 ?from=admin；
 *        previewMode='public'      → 预览用对外签发链接。
 */
export function buildFileDetail(file, opts = {}) {
  const previewMode = opts.previewMode || 'admin';
  return {
    file,
    fileLink: previewMode === 'admin'
      ? filePreviewUrl(file?.name, file?.metadata)
      : filePublicUrl(file?.name, file?.metadata),
    urls: buildFileDetailUrls(file),
  };
}
