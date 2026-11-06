/**
 * 文件「固化地址」与「动态域名」的拼装（v3.0.0 / R10）。
 *
 * 核心约定（全站唯一实现，任何地方拼文件地址都必须走这里）：
 *
 *   1) 域名永不落库。数据库只存 objectPath（URL 去掉 scheme://host 后的 path）
 *      与 urlQuery（文件级查询串）。访问时用「渠道当前加载域名 + objectPath」实时拼。
 *   2) 结构性信息一次固化。桶名 / 自定义前缀 / 自定义文件命名 / immich assetId
 *      全部体现在 objectPath 里，之后改渠道配置不影响已落库文件。
 *   3) 特殊字符安全。objectPath 存「未编码原文」，输出时才逐段 encode；
 *      urlQuery 存原始查询串，原样拼接（绝不能再 encode 一次）。
 *
 * 为什么不用「域名 + bucket + key」推导：
 *   R2 自定义域名 / COS 无 publicDomain 时，bucket 在 host 里而不是 path 里，
 *   推导会拼出「域名/bucket/key」→ 404。以「实际 URL 去掉 origin」为准才通用。
 */

/** 逐段编码路径：保留 `/`，且不二次编码已编码过的段 */
export function encodeObjectPath(path: string): string {
  const raw = String(path || '').replace(/^\/+/, '');
  if (!raw) return '';
  return raw
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      let plain = seg;
      // 已含 %XX 的段先解码再统一编码，避免 %2520 这类二次编码
      if (/%[0-9A-Fa-f]{2}/.test(seg)) {
        try {
          plain = decodeURIComponent(seg);
        } catch {
          plain = seg;
        }
      }
      return encodeURIComponent(plain);
    })
    .join('/');
}

export interface SplitAsset {
  /** 不含域名、不含 query 的路径（未编码原文） */
  objectPath: string;
  /** 不含 `?` 的查询串（原样） */
  urlQuery: string;
}

/**
 * 把完整 URL 拆成「固化路径 + 文件级 query」。
 * 相对路径（无 origin）直接当作 objectPath。
 */
export function splitAssetUrl(raw: string): SplitAsset {
  const val = String(raw || '').trim();
  if (!val) return { objectPath: '', urlQuery: '' };
  try {
    const u = new URL(val, 'http://placeholder.local');
    const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(val) || val.startsWith('//');
    const path = isAbsolute ? u.pathname.replace(/^\/+/, '') : val.split('?')[0].replace(/^\/+/, '');
    const query = isAbsolute ? u.search.replace(/^\?/, '') : (val.split('?')[1] || '');
    // 解码成原文存储：读取时统一由 encodeObjectPath 编码
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      decoded = path;
    }
    return { objectPath: decoded, urlQuery: query };
  } catch {
    const [p, q] = val.split('?');
    return { objectPath: p.replace(/^\/+/, ''), urlQuery: q || '' };
  }
}

export interface BuildAssetOptions {
  /** 加载域名（已补协议、无尾斜杠）；可能自带路径（如 WebDAV 的 /file） */
  base: string;
  /** 固化路径（未编码原文） */
  objectPath: string;
  /** 文件级查询串（不含 ?，原样） */
  urlQuery?: string;
  /** 渠道级外链后缀（COS/OSS 的 ?imageMogr2/...，动态取，不落库） */
  suffix?: string;
}

/**
 * 组装最终地址：`<base>/<objectPath>[?<urlQuery>][&suffix]`。
 *
 * base 自带路径且末段与 objectPath 首段相同时去重一次 ——
 * 兼容历史配置里「公开访问域名」被写成 `https://minio:9000/bucket` 的情况，
 * 避免拼出 `/bucket/bucket/...`。
 */
export function buildAssetUrl(opts: BuildAssetOptions): string {
  const base = String(opts.base || '').trim().replace(/\/+$/, '');
  let path = String(opts.objectPath || '').replace(/^\/+/, '');
  if (!base) return '';
  if (!path) return base;
  try {
    const ub = new URL(base);
    const baseSegs = ub.pathname.split('/').filter(Boolean);
    const pathSegs = path.split('/').filter(Boolean);
    if (baseSegs.length && pathSegs.length && baseSegs[baseSegs.length - 1] === pathSegs[0]) {
      path = pathSegs.slice(1).join('/');
    }
  } catch {
    /* base 非法时不做事先去重 */
  }
  const url = `${base}/${encodeObjectPath(path)}`;
  const q = String(opts.urlQuery || '').replace(/^\?/, '').trim();
  const suffix = String(opts.suffix || '').trim();
  const parts: string[] = [];
  if (q) parts.push(q);
  if (suffix) parts.push(suffix.replace(/^\?/, ''));
  return parts.length ? `${url}?${parts.join('&')}` : url;
}
