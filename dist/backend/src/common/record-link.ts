/**
 * 「登记文件」的链接规则（v2.9.0 重做）。
 *
 * 需求背景：登记文件只保存「这个文件在渠道上的路径」，不保存任何写死的域名 ——
 * 渠道换了域名（比如内网 IP 变了、公开访问域名换了），登记文件的外链要自动跟着变。
 *
 * 规则（与需求逐字对应）：
 *   提交时：拿源地址去匹配渠道配置里的域名，顺序是
 *           ① 内网通信域名 internalDomain → ② 公开访问域名 publicDomain → ③ Endpoint（apiUrl 的站点源）
 *           命中哪一段就把这一段从源地址里剔除，剩下的就是路径（rest）。
 *           三段都匹配不上 → 视为不属于该渠道，登记失败。
 *   读取时：实际加载域名 = internalDomain（为空则）publicDomain（为空则）apiUrl 的站点源，
 *          再拼上上面存下来的路径 → 就是登记文件的加载链接。
 *
 * 说明：Endpoint 只取「协议 + 主机 + 端口」这一层（如 https://lsky.example.com），
 * 因为 apiUrl 往往带 /api/v1/upload 这类接口路径，拼文件路径时会变成错误地址。
 */

export type RecordDomainField = 'internalDomain' | 'publicDomain' | 'apiUrl';

export interface RecordDomainCandidate {
  field: RecordDomainField;
  /** 归一化后的域名（去尾部斜杠；apiUrl 取 origin） */
  domain: string;
}

export interface RecordSourceMatch extends RecordDomainCandidate {
  /** 从源地址里剔除域名后剩下的路径（已去首部斜杠） */
  rest: string;
}

function clean(value: unknown): string {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

/** 取 URL 的「协议 + 主机 + 端口」，非法地址返回空串 */
function originOf(raw: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

/** 渠道配置里的域名候选（按需求顺序：内网 → 公开 → Endpoint）。
 *  v3.0.0：支持传入渠道类型 —— immich 的公开域名键是 domain、端点键是 serverUrl，
 *  不传类型时按通用键（publicDomain / apiUrl|endpoint）解析（旧行为兼容）。 */
export function recordDomainCandidates(
  cfg: Record<string, unknown> | null | undefined,
  type?: string,
): RecordDomainCandidate[] {
  const c = cfg || {};
  const out: RecordDomainCandidate[] = [];
  const internal = clean(c.internalDomain);
  let publicDomain = clean(c.publicDomain);
  let apiRaw = clean(c.apiUrl) || clean(c.endpoint);
  // v3.0.0：immich 的公开访问域名键是 domain、服务地址键是 serverUrl（与登记侧 channelDomainCandidates 一致）
  if (type === 'immich') {
    if (clean(c.domain)) publicDomain = clean(c.domain);
    if (clean(c.serverUrl)) apiRaw = clean(c.serverUrl);
  }
  const api = originOf(apiRaw);
  if (internal) out.push({ field: 'internalDomain', domain: internal });
  if (publicDomain) out.push({ field: 'publicDomain', domain: publicDomain });
  if (api) out.push({ field: 'apiUrl', domain: api });
  return out;
}

/**
 * 提交时：源地址 → 命中的域名段 + 剩余路径；三段都不匹配返回 null（→ 登记失败）。
 * 用「内容段包含」判断而不是严格 host 相等 —— 用户填的源地址可能带端口/路径前缀差异。
 */
export function matchRecordSource(
  cfg: Record<string, unknown> | null | undefined,
  sourceUrl: string,
  type?: string,
): RecordSourceMatch | null {
  const src = String(sourceUrl || '').trim();
  if (!/^https?:\/\//i.test(src)) return null;
  for (const cand of recordDomainCandidates(cfg, type)) {
    if (!src.includes(cand.domain)) continue;
    const rest = src.split(cand.domain).join('').replace(/^\/+/, '');
    if (!rest) return null;
    return { ...cand, rest };
  }
  return null;
}

/**
 * 读取时：渠道当前的实际加载域名。
 * preferInternal=false（302 重定向模式，浏览器直连）时优先公开访问域名 ——
 * 内网地址在外网浏览器里打不开，这种情况只能退回公开域名 / Endpoint。
 */
export function recordLoadOrigin(
  cfg: Record<string, unknown> | null | undefined,
  preferInternal = true,
  type?: string,
): string {
  const cands = recordDomainCandidates(cfg, type);
  if (!cands.length) return '';
  if (preferInternal) return cands[0].domain;
  return cands.find((c) => c.field === 'publicDomain')?.domain || cands[0].domain;
}

/** 实际加载域名 + 路径 → 登记文件的外链 */
export function joinRecordUrl(origin: string, rest: string): string {
  const o = String(origin || '').replace(/\/+$/, '');
  const p = String(rest || '').replace(/^\/+/, '');
  if (!o || !p) return '';
  return `${o}/${p}`;
}

/** 该渠道配置里是否有可用的「域名三件套」——没有就不是登记文件的路径语义 */
export function hasRecordDomains(
  cfg: Record<string, unknown> | null | undefined,
  type?: string,
): boolean {
  return recordDomainCandidates(cfg, type).length > 0;
}
