"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIpQueryCfg = getIpQueryCfg;
exports.addressByRegionFormat = addressByRegionFormat;
exports.formatIpDisplay = formatIpDisplay;
exports.ipDisplayOf = ipDisplayOf;
exports.ipDisplayBatch = ipDisplayBatch;
exports.isPrivateIp = isPrivateIp;
exports.cachedAddress = cachedAddress;
exports.resolveAddress = resolveAddress;
exports.touchIpUpload = touchIpUpload;
const prisma_1 = require("./prisma");
const qqwry_1 = require("./qqwry");
const memCache = new Map();
const MEM_TTL = 10 * 60 * 1000;
const inflight = new Map();
let cfgCache = { at: 0, cfg: null };
async function getIpQueryCfg(sysConfig) {
    if (Date.now() - cfgCache.at < 5000)
        return cfgCache.cfg;
    let cfg = null;
    try {
        const security = await sysConfig.get('security');
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
    }
    catch {
        cfg = null;
    }
    cfgCache = { at: Date.now(), cfg };
    return cfg;
}
function addressByRegionFormat(parts, regionFormat) {
    const country = String(parts.country || '').trim();
    const region = String(parts.region || '').trim();
    const city = String(parts.city || '').trim();
    if (regionFormat === 'province') {
        return region || country;
    }
    if (regionFormat === 'area') {
        return city || region || country;
    }
    if (region && city)
        return `${region}${city}`;
    if (region || city)
        return region || city;
    return country;
}
function formatIpDisplay(ip, address, cfg) {
    const a = String(address || '').trim();
    const i = String(ip || '').trim();
    if (!a)
        return i;
    if (!i)
        return a;
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
async function ipDisplayOf(ip, fallbackAddress, sysConfig) {
    const cfg = await getIpQueryCfg(sysConfig);
    let address = await cachedAddress(ip);
    if (!address)
        address = String(fallbackAddress || '');
    return { ip, address, display: formatIpDisplay(ip, address, cfg) };
}
async function ipDisplayBatch(ips, fallback, sysConfig) {
    const out = new Map();
    const uniq = Array.from(new Set(ips.filter(Boolean)));
    if (!uniq.length)
        return out;
    const cfg = await getIpQueryCfg(sysConfig);
    let records = [];
    try {
        records = await prisma_1.prisma.ipRecord.findMany({ where: { ip: { in: uniq } } });
    }
    catch {
    }
    const addrOf = new Map();
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
function isPrivateIp(ip) {
    const s = String(ip || '').trim();
    if (!s)
        return true;
    if (s === '::1' || s === 'localhost')
        return true;
    if (/^127\./.test(s))
        return true;
    if (/^10\./.test(s))
        return true;
    if (/^192\.168\./.test(s))
        return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(s))
        return true;
    if (/^169\.254\./.test(s))
        return true;
    if (/^f[cd][0-9a-f]{2}:/i.test(s))
        return true;
    if (/^fe80:/i.test(s))
        return true;
    return false;
}
async function cachedAddress(ip) {
    if (!ip)
        return '';
    const mem = memCache.get(ip);
    const now = Date.now();
    if (mem && now - mem.at < MEM_TTL)
        return mem.address;
    try {
        const row = await prisma_1.prisma.ipRecord.findUnique({ where: { ip } });
        if (row && (row.country || row.region || row.city)) {
            const address = [row.country, row.region, row.city].filter(Boolean).join(' ');
            memCache.set(ip, { address, at: now });
            return address;
        }
    }
    catch {
    }
    return '';
}
async function saveAddress(ip, country, region, city, address) {
    memCache.set(ip, { address, at: Date.now() });
    await prisma_1.prisma.ipRecord.upsert({
        where: { ip },
        update: { country, region, city },
        create: { ip, country, region, city },
    });
}
async function resolveAddress(ip, sysConfig) {
    const hit = await cachedAddress(ip);
    if (hit)
        return hit;
    if (isPrivateIp(ip))
        return '';
    const pending = inflight.get(ip);
    if (pending)
        return pending;
    const task = (async () => {
        let cfg;
        try {
            cfg = await getIpQueryCfg(sysConfig);
        }
        catch {
            return '';
        }
        if (!cfg?.enabled)
            return '';
        if (cfg.channel === 'local') {
            try {
                const r = (0, qqwry_1.queryQqwry)(ip);
                if (r && (r.country || r.region || r.city)) {
                    const address = addressByRegionFormat(r, cfg.regionFormat);
                    if (address)
                        await saveAddress(ip, r.country, r.region, r.city, address);
                    return address;
                }
                return '';
            }
            catch (err) {
                console.warn('[ipQuery] 本地数据包查询失败:', err.message);
                return '';
            }
        }
        const timeout = AbortSignal.timeout(6000);
        try {
            if (cfg.channel === 'customApi' && cfg.raw?.customApi?.url) {
                let url = String(cfg.raw.customApi.url);
                for (const p of cfg.raw.customApi.params || []) {
                    if (!p?.key)
                        continue;
                    url = url.replace(new RegExp(`\\{${p.key}\\}`, 'g'), encodeURIComponent(p.value === '{ip}' ? ip : p.value));
                }
                const resp = await fetch(url, { signal: timeout });
                const json = await resp.json();
                const pick = (path) => String(path)
                    .split('.')
                    .reduce((o, k) => (o == null ? '' : o[k]), json) || '';
                const fields = cfg.raw.customApi.responseFields || [];
                const parts = fields.map(pick).filter(Boolean);
                const address = parts.join(' ');
                if (address)
                    await saveAddress(ip, '', '', '', address);
                return address;
            }
            const resp = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN`, { signal: timeout });
            const json = await resp.json();
            const country = json?.country || '';
            const region = json?.regionName || '';
            const city = json?.city || '';
            const full = [country, region, city].filter(Boolean).join(' ');
            const address = addressByRegionFormat({ country, region, city }, cfg.regionFormat) || full;
            if (full)
                await saveAddress(ip, country, region, city, address);
            return address;
        }
        catch (err) {
            console.warn('[ipQuery] 归属地查询失败:', err.message);
            return '';
        }
    })();
    inflight.set(ip, task);
    try {
        return await task;
    }
    finally {
        inflight.delete(ip);
    }
}
async function touchIpUpload(ip, address) {
    if (!ip)
        return;
    try {
        const parts = (address || '').split(' ');
        await prisma_1.prisma.ipRecord.upsert({
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
    }
    catch (err) {
        console.warn('[ipRecord] 计数失败:', err.message);
    }
}
