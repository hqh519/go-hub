/**
 * 存储渠道「访问域名」统一解析（v3.0.0）。
 *
 * 背景：渠道配置里的域名字段分散在各类型自己的键名下（immich 用 domain/serverUrl、
 * easyimages 用 apiUrl、webdav 用 baseUri……），历史上读取侧各写各的，
 * 一处漏改就会出现「改了渠道域名，文件还在用旧域名（死链）访问」。
 *
 * 这里收敛为两个全站唯一入口（语义与需求逐字对应）：
 *
 *   getDomainInternal(type, cfg) —— 内部加载域名（服务端取流/代理转发用）：
 *     ① 内网通信域名 internalDomain
 *     ② 公开访问域名 publicDomain（immich 兼容键 domain）
 *     ③ Endpoint/服务地址（各类型键名见 ENDPOINT_KEY）
 *
 *   getDomainExternal(type, cfg) —— 外部访问域名（详情页源链接 / 302 重定向用）：
 *     ① 公开访问域名 publicDomain（immich 兼容键 domain）
 *     ② Endpoint/服务地址
 *
 * 返回值都补全了协议（内网/容器名补 http，公网补 https）并去掉尾部斜杠；
 * 三段都为空返回空串，由调用方兜底。
 */

import { ensureProtocol } from './endpoint';

/** 各渠道类型「Endpoint/服务地址」的配置键名 */
export const ENDPOINT_KEY: Record<string, string> = {
  minio: 'endpoint',
  r2: 'endpoint',
  s3: 'endpoint',
  cos: 'endpoint',
  aliyun: 'endpoint',
  easyimages: 'apiUrl',
  lsky: 'apiUrl',
  custom: 'apiUrl',
  webdav: 'baseUri',
  immich: 'serverUrl',
  localfiles: '',
};

function cleanDomain(raw: unknown): string {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  return ensureProtocol(v).replace(/\/+$/, '');
}

/** 公开访问域名（immich 历史键为 domain，做兼容） */
export function publicDomainOf(type: string, cfg: Record<string, unknown> | null | undefined): string {
  const c = cfg || {};
  if (type === 'immich' && cleanDomain(c.domain)) return cleanDomain(c.domain);
  return cleanDomain(c.publicDomain);
}

/** Endpoint/服务地址（按类型取键；apiUrl 只取站点源，去掉 /api/... 接口路径） */
export function endpointOf(type: string, cfg: Record<string, unknown> | null | undefined): string {
  const c = cfg || {};
  const key = ENDPOINT_KEY[type];
  const raw = key ? String(c[key] ?? '').trim() : '';
  if (!raw) return '';
  if (key === 'apiUrl' || key === 'serverUrl') {
    // 上传接口地址往往带路径（/api/v1/upload、/api），拼文件路径前只保留站点源
    try {
      return new URL(ensureProtocol(raw)).origin;
    } catch {
      return '';
    }
  }
  return cleanDomain(raw);
}

/** 内部加载域名：内网通信域名 → 公开访问域名 → Endpoint */
export function getDomainInternal(type: string, cfg: Record<string, unknown> | null | undefined): string {
  const c = cfg || {};
  return cleanDomain(c.internalDomain) || publicDomainOf(type, c) || endpointOf(type, c);
}

/** 外部访问域名：公开访问域名 → Endpoint
 *  v3.0.0（R14）：immich 例外 —— 不回落 serverUrl（Endpoint 键）。
 *  immich 的 serverUrl 通常是内网地址 / Docker 容器名（服务端 API 取流用），
 *  对外地址（详情页存储/备份渠道链接、302 目标）绝不能出现内网域名。
 *  未配置公开访问域名时返回空串，由调用方回退本站代理地址。 */
export function getDomainExternal(type: string, cfg: Record<string, unknown> | null | undefined): string {
  const c = cfg || {};
  if (type === 'immich') return publicDomainOf(type, c);
  return publicDomainOf(type, c) || endpointOf(type, c);
}

/**
 * v3.0.0（R10）统一命名（与需求逐字对应，新代码一律用这三个）：
 *
 *   getProxyDomain  —— 代理域名：内网通信域名 > 公开访问域名 > Endpoint。
 *                      仅服务端取流时使用（内网提速、省公网流量）。
 *   getLoadDomain   —— 文件加载域名：代理模式走 getProxyDomain，重定向模式走公开访问域名。
 *                      文件加载链路的唯一出口。
 *   getPublicDomain —— 对外地址域名：公开访问域名 > Endpoint（302 目标 / 详情页对外地址）。
 */
export const getProxyDomain = getDomainInternal;
export const getPublicDomain = getDomainExternal;

/**
 * v3.0.0（R15）：主机名是否「不可从公网访问」。
 *
 * 用途：详情页「存储渠道 / 备份渠道」要展示的是**对外**地址，
 * 内网 IP、localhost、Docker 容器名（单段主机名，如 immich / minio）都不合格。
 * 判定偏保守（宁可判为内网）：单段主机名一律视为内网/容器名。
 */
export function isPrivateHost(host: string): boolean {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home')) return true;
  // 单段主机名：Docker 服务名 / 容器名 / 局域网机器名（如 immich、minio、nas）
  if (!h.includes('.') && !h.includes(':')) return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

/**
 * v3.0.0（R15）：把「对外地址」净化成公网域名。
 *
 * 场景：某些渠道（immich / webdav / 自定义）的 Endpoint 常填内网 IP 或容器名，
 * 一旦直链被拼成内网地址，详情页「存储渠道 / 备份渠道」就会输出内网域名 ——
 * 浏览器打不开、复制出去的外链也不能用。
 *
 * 规则：URL 主机命中内网时，改用该渠道的「公开访问域名」重拼（保留路径与查询串）；
 * 渠道没有可用的公开域名 → 返回空串，由前端显示「无对外直链」，
 * 绝不再回退成本站地址（本站可能本身就是内网 IP）。
 */
export function publicizeExternalUrl(
  url: string | null | undefined,
  type: string,
  cfg: Record<string, unknown> | null | undefined,
): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  let parsed: URL;
  try {
    parsed = new URL(ensureProtocol(raw));
  } catch {
    return '';
  }
  if (!isPrivateHost(parsed.hostname)) return raw;
  const pub = publicDomainOf(type, cfg);
  if (!pub) return '';
  try {
    const p = new URL(ensureProtocol(pub));
    if (isPrivateHost(p.hostname)) return '';
    return `${p.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return '';
  }
}

/** 文件加载域名：preferInternal=true（代理模式）用代理域名，否则用公开访问域名 */
export function getLoadDomain(
  type: string,
  cfg: Record<string, unknown> | null | undefined,
  preferInternal = true,
): string {
  return preferInternal ? getDomainInternal(type, cfg) : getDomainExternal(type, cfg);
}

/**
 * v3.0.0：MinIO 的「公开访问域名 / 内网通信域名」改为只填域名（不含 `/存储桶`）。
 *
 * 历史版本要求用户手写成 `http://minio:9000/gohub`，现在桶名统一由后端
 * （s3.adapter.buildDirectUrl）在拼接时补上。为了不让老配置里残留的 `/bucket`
 * 与新逻辑叠加成 `/bucket/bucket`，写入渠道配置前先剥离末尾与 bucket 完全相同的路径段。
 *
 * 只处理 minio：其它 S3 兼容渠道的公开域名常是 CDN 域名（路径本身有意义），不做改动。
 */
export function normalizeBucketDomain(type: string, cfg: Record<string, string>): Record<string, string> {
  if (type !== 'minio') return cfg;
  const bucket = String(cfg.bucket ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!bucket) return cfg;
  /** 去掉末尾的 `/bucket`；只去掉「整段等于 bucket」的那一段，避免误伤 CDN 自定义路径 */
  const stripBucket = (raw: string): string => {
    const v = String(raw ?? '').trim();
    if (!v) return v;
    const noTailSlash = v.replace(/\/+$/, '');
    const parts = noTailSlash.split('/');
    if (parts.length > 1 && parts[parts.length - 1] === bucket) {
      return parts.slice(0, -1).join('/');
    }
    return v;
  };
  const out: Record<string, string> = { ...cfg };
  if (out.publicDomain) out.publicDomain = stripBucket(out.publicDomain);
  if (out.internalDomain) out.internalDomain = stripBucket(out.internalDomain);
  return out;
}

/**
 * v3.0.0（R6）：登记文件的 key 补桶名。
 *
 * 登记文件存的是「剔除域名后剩下的路径」，不同时期整理出来的数据形态不一致：
 *   · 域名只填域名（新规则）→ 路径里天然含桶名：`test/2026/10/x.png`；
 *   · 域名带 /桶名（旧规则）→ 路径里不含桶名：`2026/10/x.png`。
 * 为了两种数据都能拼出 `域名/桶名/对象前缀/文件`，这里做一次幂等补全：
 * key 首段已经是桶名就原样返回，否则在最前面补一段桶名。
 * 只对 minio 生效（只有它的域名被强制「只填域名」且固定 path-style）。
 */
export function ensureBucketInKey(type: string, cfg: Record<string, unknown> | null | undefined, key: string): string {
  if (type !== 'minio') return key;
  const c = cfg || {};
  const bucket = String(c.bucket ?? '').trim().replace(/^\/+|\/+$/g, '');
  const k = String(key ?? '').replace(/^\/+/, '');
  if (!bucket || !k) return k;
  const first = k.split('/')[0];
  if (first === bucket) return k;
  return `${bucket}/${k}`;
}
