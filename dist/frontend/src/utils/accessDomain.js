/**
 * 对外访问域名（前缀）—— 安全设置里的「API 接入信息」与「对外 WebDAV」共用同一取值。
 *
 * 优先级（与后端 /api/userConfig 下发的 urlPrefix 一致）：
 *   1) 上传设置的「自定义访问域名」
 *   2) 页面设置「默认URL前缀」（历史数据兜底 customDomain）
 *   3) 本站 /file/（Endpoint 主机部分或当前浏览器地址）
 *
 * 本系统对外只签发 `域名/file/<文件标识>` 形式的外链，
 * 因此客户端（S3 / Web 通道 / WebDAV 挂载）里要填的「访问域名」就是这个前缀。
 */
export function resolveAccessDomain({ userConfig, origin = '', endpoint = '' } = {}) {
  const cfg = userConfig || {};

  // 1) 全站统一出口（后端已算好的前缀，自定义访问域名优先）
  const fromConfig = String(cfg.urlPrefix || '').trim();
  if (fromConfig) return fromConfig.replace(/\/+$/, '');

  // 2) 仅配了自定义域名（历史数据兜底）
  const custom = String(cfg.customDomain || '').trim().replace(/\/+$/, '');
  if (custom) return `${custom}/file`;

  // 3) 都没配 → 本站 /file/
  const host = endpoint
    ? String(endpoint).replace(/\/s3\/?$/, '')
    : String(origin || '');
  return `${host.replace(/\/+$/, '')}/file`;
}

export default resolveAccessDomain;
