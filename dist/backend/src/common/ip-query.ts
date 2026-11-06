/**
 * IP 归属地查询（全站唯一实现）。
 *
 * v2.3.0 起从 upload.service 里抽出来，上传记录与「访问记录」共用同一套
 * 配置（安全设置 → 上传 → IP 归属地查询）、同一张缓存表（ip_records）、
 * 同一个 6 秒超时与失败降级策略。
 *
 * 缓存策略：
 *   · 先查 ip_records（命中且至少有 country/region/city 之一即视为有效）
 *   · 未命中且开关打开 → 请求外部 API → 写回 ip_records
 *   · 结果在进程内再做一层短 TTL 内存缓存，避免同一 IP 高并发时打爆外部 API
 */
import { prisma } from './prisma';
import { SysConfigService } from '../settings/sysconfig.service';
import { queryQqwry } from './qqwry';

/** 内存缓存：ip → { address, at }；TTL 10 分钟（库里已有更持久的缓存） */
const memCache = new Map<string, { address: string; at: number }>();
const MEM_TTL = 10 * 60 * 1000;
/** 正在查询中的 IP（避免并发重复请求同一个 IP） */
const inflight = new Map<string, Promise<string>>();

/** 归属地配置（安全设置 → 上传 → IP 归属地查询）带 5s 缓存 */
export interface IpQueryCfg {
  enabled: boolean;
  channel: string; // ipApi（默认）/ customApi / local
  displayFormat: string; // ipFirst / addressFirst / ipThenAddress / addressThenIp
  regionFormat: string; // provinceArea / province / area
  raw: any;
}

let cfgCache: { at: number; cfg: IpQueryCfg | null } = { at: 0, cfg: null };

export async function getIpQueryCfg(sysConfig: SysConfigService): Promise<IpQueryCfg | null> {
  if (Date.now() - cfgCache.at < 5000) return cfgCache.cfg;
  let cfg: IpQueryCfg | null = null;
  try {
    const security: any = await sysConfig.get('security');
    const q = security?.upload?.ipQuery;
    if (q) {
      cfg = {
        enabled: q.enabled === true,
        channel: String(q.channel || 'ipApi'),
        displayFormat: String(q.displayFormat || 'ipFirst'),
        regionFormat: String(q.regionFormat || 'provinceArea'),
        raw: q,
      };
    }
  } catch {
    cfg = null;
  }
  cfgCache = { at: Date.now(), cfg };
  return cfg;
}

/** 按地区格式从三段记录拼「归属地」文本 */
export function addressByRegionFormat(
  parts: { country?: string; region?: string; city?: string },
  regionFormat: string,
): string {
  const country = String(parts.country || '').trim();
  const region = String(parts.region || '').trim();
  const city = String(parts.city || '').trim();
  if (regionFormat === 'province') {
    // 省份：国内取省级；国外退回国家
    return region || country;
  }
  if (regionFormat === 'area') {
    // 地区：市级/地区；为空退回省份再退回国家
    return city || region || country;
  }
  // provinceArea（默认）：省份 + 地区；国外带国家
  if (region && city) return `${region}${city}`;
  if (region || city) return region || city;
  return country;
}

/** 按显示格式把「IP + 归属地」拼成统一展示文本（全系统显示统一走这里） */
export function formatIpDisplay(ip: string, address: string, cfg: Pick<IpQueryCfg, 'displayFormat'> | null): string {
  const a = String(address || '').trim();
  const i = String(ip || '').trim();
  if (!a) return i;
  if (!i) return a;
  switch (cfg?.displayFormat) {
    case 'addressFirst':
      return `${a}(${i})`;
    case 'ipThenAddress':
      return `${i}\n${a}`;
    case 'addressThenIp':
      return `${a}\n${i}`;
    case 'ipFirst':
    default:
      return `(${i})${a}`;
  }
}

/**
 * 单条 IP 的统一展示文本（全系统 IP 显示统一入口）：
 * 归属地优先取 ip_records 缓存，取不到退回调用方给的 fallback（如 metas.UploadAddress）。
 */
export async function ipDisplayOf(
  ip: string,
  fallbackAddress: string,
  sysConfig: SysConfigService,
): Promise<{ ip: string; address: string; display: string }> {
  const cfg = await getIpQueryCfg(sysConfig);
  let address = await cachedAddress(ip);
  if (!address) address = String(fallbackAddress || '');
  return { ip, address, display: formatIpDisplay(ip, address, cfg) };
}

/** 批量版本：一次取回 ip_records，再按格式拼 display（管理列表 / 归集统计用） */
export async function ipDisplayBatch(
  ips: string[],
  fallback: Map<string, string>,
  sysConfig: SysConfigService,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = Array.from(new Set(ips.filter(Boolean)));
  if (!uniq.length) return out;
  const cfg = await getIpQueryCfg(sysConfig);
  let records: { ip: string; country: string; region: string; city: string }[] = [];
  try {
    records = await prisma.ipRecord.findMany({ where: { ip: { in: uniq } } });
  } catch {
    /* 库查询失败就用 fallback */
  }
  const addrOf = new Map<string, string>();
  for (const r of records) {
    const joined = [r.country, r.region, r.city].filter(Boolean).join(' ');
    addrOf.set(r.ip, addressByRegionFormat(r, cfg?.regionFormat || 'provinceArea') || joined);
  }
  for (const ip of uniq) {
    const address = addrOf.get(ip) || String(fallback?.get(ip) || '');
    out.set(ip, formatIpDisplay(ip, address, cfg));
  }
  return out;
}

/** 内网 / 回环地址不做归属地查询（查了也是空的，白费一次外部请求） */
export function isPrivateIp(ip: string): boolean {
  const s = String(ip || '').trim();
  if (!s) return true;
  if (s === '::1' || s === 'localhost') return true;
  if (/^127\./.test(s)) return true;
  if (/^10\./.test(s)) return true;
  if (/^192\.168\./.test(s)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(s)) return true;
  if (/^169\.254\./.test(s)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(s)) return true; // IPv6 ULA
  if (/^fe80:/i.test(s)) return true; // IPv6 link-local
  return false;
}

/** 读缓存（只读库，不发外部请求）—— 上传主链路 / 访问记录落库都用这个 */
export async function cachedAddress(ip: string): Promise<string> {
  if (!ip) return '';
  const mem = memCache.get(ip);
  const now = Date.now();
  if (mem && now - mem.at < MEM_TTL) return mem.address;
  try {
    const row = await prisma.ipRecord.findUnique({ where: { ip } });
    if (row && (row.country || row.region || row.city)) {
      const address = [row.country, row.region, row.city].filter(Boolean).join(' ');
      memCache.set(ip, { address, at: now });
      return address;
    }
  } catch {
    /* 缓存查询失败不影响主流程 */
  }
  return '';
}

/** 归属地写库（同时刷新内存缓存） */
async function saveAddress(ip: string, country: string, region: string, city: string, address: string) {
  memCache.set(ip, { address, at: Date.now() });
  await prisma.ipRecord.upsert({
    where: { ip },
    update: { country, region, city },
    create: { ip, country, region, city },
  });
}

/**
 * 主动查询归属地（含外部请求）。
 * 开关关闭 / 内网 IP / 请求失败 → 返回空串（调用方按「未知」展示）。
 */
export async function resolveAddress(ip: string, sysConfig: SysConfigService): Promise<string> {
  const hit = await cachedAddress(ip);
  if (hit) return hit;
  if (isPrivateIp(ip)) return '';
  const pending = inflight.get(ip);
  if (pending) return pending;

  const task = (async () => {
    let cfg: any;
    try {
      cfg = await getIpQueryCfg(sysConfig);
    } catch {
      return '';
    }
    if (!cfg?.enabled) return '';

    // v2.6.0 #301：本地数据包渠道（纯真 qqwry.dat，离线查询、零外部请求）
    if (cfg.channel === 'local') {
      try {
        const r = queryQqwry(ip);
        if (r && (r.country || r.region || r.city)) {
          const address = addressByRegionFormat(r, cfg.regionFormat);
          if (address) await saveAddress(ip, r.country, r.region, r.city, address);
          return address;
        }
        return '';
      } catch (err) {
        console.warn('[ipQuery] 本地数据包查询失败:', (err as Error).message);
        return '';
      }
    }

    const timeout = AbortSignal.timeout(6000);
    try {
      if (cfg.channel === 'customApi' && cfg.raw?.customApi?.url) {
        let url = String(cfg.raw.customApi.url);
        for (const p of cfg.raw.customApi.params || []) {
          if (!p?.key) continue;
          url = url.replace(new RegExp(`\\{${p.key}\\}`, 'g'), encodeURIComponent(p.value === '{ip}' ? ip : p.value));
        }
        const resp = await fetch(url, { signal: timeout });
        const json: any = await resp.json();
        const pick = (path: string) =>
          String(path)
            .split('.')
            .reduce((o: any, k: string) => (o == null ? '' : o[k]), json) || '';
        const fields: string[] = cfg.raw.customApi.responseFields || [];
        const parts = fields.map(pick).filter(Boolean);
        const address = parts.join(' ');
        if (address) await saveAddress(ip, '', '', '', address);
        return address;
      }
      // 默认：ip-api.com（免费、无需 key）
      const resp = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN`, { signal: timeout });
      const json: any = await resp.json();
      const country = json?.country || '';
      const region = json?.regionName || '';
      const city = json?.city || '';
      // v2.6.0：落库存三段原值，返回给调用方的文本按地区格式拼装
      const full = [country, region, city].filter(Boolean).join(' ');
      const address = addressByRegionFormat({ country, region, city }, cfg.regionFormat) || full;
      if (full) await saveAddress(ip, country, region, city, address);
      return address;
    } catch (err) {
      console.warn('[ipQuery] 归属地查询失败:', (err as Error).message);
      return '';
    }
  })();

  inflight.set(ip, task);
  try {
    return await task;
  } finally {
    inflight.delete(ip);
  }
}

/** 归属地上传计数（用户管理 → 按 IP 归集） */
export async function touchIpUpload(ip: string, address: string): Promise<void> {
  if (!ip) return;
  try {
    const parts = (address || '').split(' ');
    await prisma.ipRecord.upsert({
      where: { ip },
      update: { uploadCount: { increment: 1 } },
      create: {
        ip,
        country: parts[0] || '',
        region: parts[1] || '',
        city: parts.slice(2).join(' '),
        uploadCount: 1,
      },
    });
  } catch (err) {
    console.warn('[ipRecord] 计数失败:', (err as Error).message);
  }
}
