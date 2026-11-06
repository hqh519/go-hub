/**
 * v3.0.0（R10）：后台内部预览的缩略图地址。
 *
 * 目的：后台列表/历史/系统状态里的缩略图只用于「看一眼」，不需要原图。
 *   · 走本站 `/file/:name` 代理（代理模式下后端会用「内网通信域名」取流，外网也照常可用，
 *     不依赖管理员浏览器能否直连渠道内网域名）；
 *   · 后端按 `thumb` 参数用 sharp 缩到指定宽度并强缓存，首屏流量可降一个数量级；
 *   · 只对本站 `/file/` 地址生效 —— 外部直链（登记文件/外链模式）原样返回，避免破坏第三方 URL。
 *
 * 注意：视频/音频不要调用本函数（后端缩放只处理图片）。
 */
const THUMB_PATH_RE = /\/file\//i;

export function thumbUrl(url, size = 320) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  // 只处理本站文件出口；已经是缩略图或外部地址时原样返回
  if (!THUMB_PATH_RE.test(raw)) return raw;
  if (/[?&]thumb=/.test(raw)) return raw;
  const w = Math.max(64, Math.min(640, Number(size) || 320));
  return `${raw}${raw.includes('?') ? '&' : '?'}thumb=${w}`;
}

export default thumbUrl;
