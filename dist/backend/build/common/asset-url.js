"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeObjectPath = encodeObjectPath;
exports.splitAssetUrl = splitAssetUrl;
exports.buildAssetUrl = buildAssetUrl;
function encodeObjectPath(path) {
    const raw = String(path || '').replace(/^\/+/, '');
    if (!raw)
        return '';
    return raw
        .split('/')
        .map((seg) => {
        if (!seg)
            return seg;
        let plain = seg;
        if (/%[0-9A-Fa-f]{2}/.test(seg)) {
            try {
                plain = decodeURIComponent(seg);
            }
            catch {
                plain = seg;
            }
        }
        return encodeURIComponent(plain);
    })
        .join('/');
}
function splitAssetUrl(raw) {
    const val = String(raw || '').trim();
    if (!val)
        return { objectPath: '', urlQuery: '' };
    try {
        const u = new URL(val, 'http://placeholder.local');
        const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(val) || val.startsWith('//');
        const path = isAbsolute ? u.pathname.replace(/^\/+/, '') : val.split('?')[0].replace(/^\/+/, '');
        const query = isAbsolute ? u.search.replace(/^\?/, '') : (val.split('?')[1] || '');
        let decoded = path;
        try {
            decoded = decodeURIComponent(path);
        }
        catch {
            decoded = path;
        }
        return { objectPath: decoded, urlQuery: query };
    }
    catch {
        const [p, q] = val.split('?');
        return { objectPath: p.replace(/^\/+/, ''), urlQuery: q || '' };
    }
}
function buildAssetUrl(opts) {
    const base = String(opts.base || '').trim().replace(/\/+$/, '');
    let path = String(opts.objectPath || '').replace(/^\/+/, '');
    if (!base)
        return '';
    if (!path)
        return base;
    try {
        const ub = new URL(base);
        const baseSegs = ub.pathname.split('/').filter(Boolean);
        const pathSegs = path.split('/').filter(Boolean);
        if (baseSegs.length && pathSegs.length && baseSegs[baseSegs.length - 1] === pathSegs[0]) {
            path = pathSegs.slice(1).join('/');
        }
    }
    catch {
    }
    const url = `${base}/${encodeObjectPath(path)}`;
    const q = String(opts.urlQuery || '').replace(/^\?/, '').trim();
    const suffix = String(opts.suffix || '').trim();
    const parts = [];
    if (q)
        parts.push(q);
    if (suffix)
        parts.push(suffix.replace(/^\?/, ''));
    return parts.length ? `${url}?${parts.join('&')}` : url;
}
