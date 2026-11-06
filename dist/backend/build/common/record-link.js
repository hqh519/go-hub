"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordDomainCandidates = recordDomainCandidates;
exports.matchRecordSource = matchRecordSource;
exports.recordLoadOrigin = recordLoadOrigin;
exports.joinRecordUrl = joinRecordUrl;
exports.hasRecordDomains = hasRecordDomains;
function clean(value) {
    return String(value ?? '').trim().replace(/\/+$/, '');
}
function originOf(raw) {
    try {
        return new URL(raw).origin;
    }
    catch {
        return '';
    }
}
function recordDomainCandidates(cfg, type) {
    const c = cfg || {};
    const out = [];
    const internal = clean(c.internalDomain);
    let publicDomain = clean(c.publicDomain);
    let apiRaw = clean(c.apiUrl) || clean(c.endpoint);
    if (type === 'immich') {
        if (clean(c.domain))
            publicDomain = clean(c.domain);
        if (clean(c.serverUrl))
            apiRaw = clean(c.serverUrl);
    }
    const api = originOf(apiRaw);
    if (internal)
        out.push({ field: 'internalDomain', domain: internal });
    if (publicDomain)
        out.push({ field: 'publicDomain', domain: publicDomain });
    if (api)
        out.push({ field: 'apiUrl', domain: api });
    return out;
}
function matchRecordSource(cfg, sourceUrl, type) {
    const src = String(sourceUrl || '').trim();
    if (!/^https?:\/\//i.test(src))
        return null;
    for (const cand of recordDomainCandidates(cfg, type)) {
        if (!src.includes(cand.domain))
            continue;
        const rest = src.split(cand.domain).join('').replace(/^\/+/, '');
        if (!rest)
            return null;
        return { ...cand, rest };
    }
    return null;
}
function recordLoadOrigin(cfg, preferInternal = true, type) {
    const cands = recordDomainCandidates(cfg, type);
    if (!cands.length)
        return '';
    if (preferInternal)
        return cands[0].domain;
    return cands.find((c) => c.field === 'publicDomain')?.domain || cands[0].domain;
}
function joinRecordUrl(origin, rest) {
    const o = String(origin || '').replace(/\/+$/, '');
    const p = String(rest || '').replace(/^\/+/, '');
    if (!o || !p)
        return '';
    return `${o}/${p}`;
}
function hasRecordDomains(cfg, type) {
    return recordDomainCandidates(cfg, type).length > 0;
}
