"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPublicDomain = exports.getProxyDomain = exports.ENDPOINT_KEY = void 0;
exports.publicDomainOf = publicDomainOf;
exports.endpointOf = endpointOf;
exports.getDomainInternal = getDomainInternal;
exports.getDomainExternal = getDomainExternal;
exports.isPrivateHost = isPrivateHost;
exports.publicizeExternalUrl = publicizeExternalUrl;
exports.getLoadDomain = getLoadDomain;
exports.normalizeBucketDomain = normalizeBucketDomain;
exports.ensureBucketInKey = ensureBucketInKey;
const endpoint_1 = require("./endpoint");
exports.ENDPOINT_KEY = {
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
function cleanDomain(raw) {
    const v = String(raw ?? '').trim();
    if (!v)
        return '';
    return (0, endpoint_1.ensureProtocol)(v).replace(/\/+$/, '');
}
function publicDomainOf(type, cfg) {
    const c = cfg || {};
    if (type === 'immich' && cleanDomain(c.domain))
        return cleanDomain(c.domain);
    return cleanDomain(c.publicDomain);
}
function endpointOf(type, cfg) {
    const c = cfg || {};
    const key = exports.ENDPOINT_KEY[type];
    const raw = key ? String(c[key] ?? '').trim() : '';
    if (!raw)
        return '';
    if (key === 'apiUrl' || key === 'serverUrl') {
        try {
            return new URL((0, endpoint_1.ensureProtocol)(raw)).origin;
        }
        catch {
            return '';
        }
    }
    return cleanDomain(raw);
}
function getDomainInternal(type, cfg) {
    const c = cfg || {};
    return cleanDomain(c.internalDomain) || publicDomainOf(type, c) || endpointOf(type, c);
}
function getDomainExternal(type, cfg) {
    const c = cfg || {};
    if (type === 'immich')
        return publicDomainOf(type, c);
    return publicDomainOf(type, c) || endpointOf(type, c);
}
exports.getProxyDomain = getDomainInternal;
exports.getPublicDomain = getDomainExternal;
function isPrivateHost(host) {
    const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!h)
        return true;
    if (h === 'localhost' || h === '0.0.0.0' || h === '::1')
        return true;
    if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home'))
        return true;
    if (!h.includes('.') && !h.includes(':'))
        return true;
    if (/^127\./.test(h))
        return true;
    if (/^10\./.test(h))
        return true;
    if (/^192\.168\./.test(h))
        return true;
    if (/^169\.254\./.test(h))
        return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h))
        return true;
    return false;
}
function publicizeExternalUrl(url, type, cfg) {
    const raw = String(url || '').trim();
    if (!raw)
        return '';
    let parsed;
    try {
        parsed = new URL((0, endpoint_1.ensureProtocol)(raw));
    }
    catch {
        return '';
    }
    if (!isPrivateHost(parsed.hostname))
        return raw;
    const pub = publicDomainOf(type, cfg);
    if (!pub)
        return '';
    try {
        const p = new URL((0, endpoint_1.ensureProtocol)(pub));
        if (isPrivateHost(p.hostname))
            return '';
        return `${p.origin}${parsed.pathname}${parsed.search}`;
    }
    catch {
        return '';
    }
}
function getLoadDomain(type, cfg, preferInternal = true) {
    return preferInternal ? getDomainInternal(type, cfg) : getDomainExternal(type, cfg);
}
function normalizeBucketDomain(type, cfg) {
    if (type !== 'minio')
        return cfg;
    const bucket = String(cfg.bucket ?? '').trim().replace(/^\/+|\/+$/g, '');
    if (!bucket)
        return cfg;
    const stripBucket = (raw) => {
        const v = String(raw ?? '').trim();
        if (!v)
            return v;
        const noTailSlash = v.replace(/\/+$/, '');
        const parts = noTailSlash.split('/');
        if (parts.length > 1 && parts[parts.length - 1] === bucket) {
            return parts.slice(0, -1).join('/');
        }
        return v;
    };
    const out = { ...cfg };
    if (out.publicDomain)
        out.publicDomain = stripBucket(out.publicDomain);
    if (out.internalDomain)
        out.internalDomain = stripBucket(out.internalDomain);
    return out;
}
function ensureBucketInKey(type, cfg, key) {
    if (type !== 'minio')
        return key;
    const c = cfg || {};
    const bucket = String(c.bucket ?? '').trim().replace(/^\/+|\/+$/g, '');
    const k = String(key ?? '').replace(/^\/+/, '');
    if (!bucket || !k)
        return k;
    const first = k.split('/')[0];
    if (first === bucket)
        return k;
    return `${bucket}/${k}`;
}
