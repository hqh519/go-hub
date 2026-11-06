"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpPostAdapter = void 0;
exports.httpAdapterSecretFields = httpAdapterSecretFields;
const adapter_interface_1 = require("./adapter.interface");
const endpoint_1 = require("../common/endpoint");
const asset_url_1 = require("../common/asset-url");
const channel_domain_1 = require("../common/channel-domain");
const TOKEN_SECRET_FIELDS = ['tokenValue'];
function httpAdapterSecretFields() {
    return TOKEN_SECRET_FIELDS;
}
const COMMON_RESPONSE_PATHS = [
    'url',
    'data.url',
    'data.link',
    'data.src',
    'data.path',
    'data.full_url',
    'data.image.url',
    'image.url',
    'links.url',
    'data.links.url',
    'result',
    'result.url',
    'path',
    'src',
    'file',
    '[0].src',
    '[0].url',
    'data.0.url',
    'data[0].url',
    'data.list.0.url',
];
class HttpPostAdapter {
    channel;
    constructor(channel) {
        this.channel = channel;
    }
    jsonCfg(raw) {
        if (!raw)
            return {};
        try {
            const v = JSON.parse(raw);
            return v && typeof v === 'object' ? v : {};
        }
        catch {
            return {};
        }
    }
    fill(tpl, file) {
        if (!tpl)
            return tpl;
        const name = file.originalName || 'file';
        const dot = name.lastIndexOf('.');
        const base = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot + 1) : '';
        const map = {
            filename: name,
            name: base,
            ext,
            mime: file.mime || '',
            size: String(file.buffer?.length ?? 0),
            timestamp: String(Math.floor(Date.now() / 1000)),
            random: Math.random().toString(36).slice(2, 10),
        };
        return tpl.replace(/\{(filename|name|ext|mime|size|timestamp|random)\}/g, (_, k) => map[k] ?? '');
    }
    uniqueName(originalName, key) {
        const base = (key || '').split('/').pop() || originalName || 'file';
        if (/\.[A-Za-z0-9]{1,8}$/.test(base))
            return base;
        const dot = (originalName || '').lastIndexOf('.');
        return dot > 0 ? base + originalName.slice(dot) : base;
    }
    async upload(file, key, channel) {
        const cfg = channel.config;
        let rawApiUrl = (0, endpoint_1.ensureProtocol)(this.fill(cfg.apiUrl || '', file));
        if (!rawApiUrl)
            throw new adapter_interface_1.AdapterError('缺少 apiUrl 配置', channel.type);
        if (channel.type === 'lsky')
            rawApiUrl = normalizeLskyUrl(rawApiUrl);
        const fileField = cfg.fileField || 'file';
        const extra = {};
        for (const raw of [cfg.extraFields, cfg.body]) {
            for (const [k, v] of Object.entries(this.jsonCfg(raw))) {
                if (!k)
                    continue;
                extra[k] = this.fill(typeof v === 'string' ? v : JSON.stringify(v), file);
            }
        }
        if (cfg.tokenField && cfg.tokenValue)
            extra[cfg.tokenField] = this.fill(String(cfg.tokenValue), file);
        delete extra[fileField];
        const headers = { Accept: 'application/json' };
        if (cfg.tokenHeader && cfg.tokenValue) {
            let token = this.fill(String(cfg.tokenValue).trim(), file);
            if (/^authorization$/i.test(cfg.tokenHeader) && token && !/^[A-Za-z]+\s/.test(token)) {
                token = `Bearer ${token}`;
            }
            headers[cfg.tokenHeader] = token;
        }
        for (const [k, v] of Object.entries(this.jsonCfg(cfg.headers))) {
            if (k)
                headers[k] = this.fill(String(v), file);
        }
        const useJson = /^json$/i.test(String(cfg.requestFormat || '').trim());
        let body;
        if (useJson) {
            const payload = { ...extra };
            payload[fileField] = `data:${file.mime || 'application/octet-stream'};base64,${file.buffer.toString('base64')}`;
            body = JSON.stringify(payload);
            headers['Content-Type'] = 'application/json';
        }
        else {
            const form = new FormData();
            const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mime });
            form.append(fileField, blob, this.uniqueName(file.originalName, key));
            for (const [k, v] of Object.entries(extra))
                form.append(k, v);
            body = form;
        }
        const method = (cfg.httpMethod || 'POST').toUpperCase();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60000);
        let resp;
        try {
            resp = await fetch(rawApiUrl, { method, body, headers, signal: ctrl.signal });
        }
        catch (err) {
            throw new adapter_interface_1.AdapterError(`请求失败: ${err.message}`, channel.type);
        }
        finally {
            clearTimeout(timer);
        }
        const text = await resp.text();
        if (!resp.ok) {
            throw new adapter_interface_1.AdapterError(`HTTP ${resp.status}: ${text.slice(0, 300)}`, channel.type);
        }
        let url = '';
        let respJson = null;
        try {
            const json = JSON.parse(text);
            respJson = json;
            const codePath = cfg.codePath || (channel.type === 'easyimages' ? 'code' : '');
            if (codePath) {
                const code = pickPath(json, codePath);
                const expect = cfg.codeValue || '200';
                if (code !== '' && code !== expect) {
                    throw new adapter_interface_1.AdapterError(`接口返回失败码 ${code}（期望 ${expect}）：${responseMessage(json, text)}`, channel.type);
                }
            }
            if (!codePath) {
                const flag = pickPath(json, 'success') || pickPath(json, 'ok');
                if (flag === 'false') {
                    throw new adapter_interface_1.AdapterError(`接口返回失败：${responseMessage(json, text)}`, channel.type);
                }
            }
            url = extractUrl(json, cfg.responsePath);
        }
        catch (err) {
            if (err instanceof adapter_interface_1.AdapterError)
                throw err;
            url = text.trim();
        }
        if (!url) {
            throw new adapter_interface_1.AdapterError(`响应中未找到 URL（responsePath=${cfg.responsePath || '自动探测'}）: ${text.slice(0, 200)}`, channel.type);
        }
        url = normalizeUrl(url, cfg.publicDomain, rawApiUrl);
        const { objectPath, urlQuery } = (0, asset_url_1.splitAssetUrl)(url);
        const metas = {};
        if (respJson) {
            const del = pickPath(respJson, 'del');
            if (del) {
                const delUrl = normalizeUrl(del, cfg.publicDomain, rawApiUrl);
                const delParts = (0, asset_url_1.splitAssetUrl)(delUrl);
                if (delParts.objectPath) {
                    metas.deletePath = delParts.objectPath;
                    metas.deleteQuery = delParts.urlQuery;
                }
            }
            const imageKey = pickPath(respJson, 'data.key') || pickPath(respJson, 'key');
            if (imageKey)
                metas.imageKey = imageKey;
        }
        return { remoteKey: key, remoteUrl: '', objectPath, urlQuery, metas };
    }
    async delete(copy, channel) {
        const cfg = channel.config;
        const meta = copy.metas || {};
        if (channel.type === 'easyimages') {
            let target = '';
            const delPath = String(meta.deletePath || '');
            if (delPath) {
                const base = (0, channel_domain_1.getLoadDomain)(channel.type, cfg, true);
                if (base)
                    target = (0, asset_url_1.buildAssetUrl)({ base, objectPath: delPath, urlQuery: String(meta.deleteQuery || '') });
            }
            if (!target && meta.deleteUrl) {
                const legacy = (0, asset_url_1.splitAssetUrl)((0, endpoint_1.ensureProtocol)(String(meta.deleteUrl)));
                const base = (0, channel_domain_1.getLoadDomain)(channel.type, cfg, true);
                target = legacy.objectPath && base
                    ? (0, asset_url_1.buildAssetUrl)({ base, objectPath: legacy.objectPath, urlQuery: legacy.urlQuery })
                    : (0, endpoint_1.ensureProtocol)(String(meta.deleteUrl));
            }
            if (!target)
                return;
            const r = await fetch(target, { method: 'GET' });
            if (!r.ok && r.status !== 404) {
                throw new adapter_interface_1.AdapterError(`删除失败: HTTP ${r.status}`, channel.type);
            }
            return;
        }
        if (channel.type === 'lsky' && meta.imageKey) {
            const origin = (0, endpoint_1.ensureProtocol)(cfg.apiUrl || '');
            if (!origin)
                throw new adapter_interface_1.AdapterError('缺少 apiUrl 配置', channel.type);
            const headers = { Accept: 'application/json' };
            const token = String(cfg.tokenValue || '').trim();
            if (token)
                headers[cfg.tokenHeader || 'Authorization'] = /^[A-Za-z]+\s/.test(token) ? token : `Bearer ${token}`;
            const r = await fetch(`${new URL(origin).origin}/api/v1/images/${encodeURIComponent(String(meta.imageKey))}`, {
                method: 'DELETE',
                headers,
            });
            if (!r.ok && r.status !== 404) {
                throw new adapter_interface_1.AdapterError(`删除失败: HTTP ${r.status}`, channel.type);
            }
            return;
        }
        if (!cfg.customDeleteUrl)
            return;
        const target = copy.remoteUrl || this.directUrlOf(copy, channel, false) || copy.remoteKey;
        const url = (0, endpoint_1.ensureProtocol)(cfg.customDeleteUrl
            .replace('{url}', encodeURIComponent(target))
            .replace('{key}', encodeURIComponent(copy.remoteKey || '')));
        try {
            const headers = {};
            if (cfg.tokenHeader && cfg.tokenValue) {
                let token = String(cfg.tokenValue).trim();
                if (/^authorization$/i.test(cfg.tokenHeader) && token && !/^[A-Za-z]+\s/.test(token)) {
                    token = `Bearer ${token}`;
                }
                headers[cfg.tokenHeader] = token;
            }
            await fetch(url, { method: (cfg.customDeleteMethod || 'GET').toUpperCase(), headers });
        }
        catch (err) {
            throw new adapter_interface_1.AdapterError(`删除失败: ${err.message}`, channel.type);
        }
    }
    directUrlOf(copy, channel, preferInternal) {
        if (!copy.objectPath)
            return '';
        const base = (0, channel_domain_1.getLoadDomain)(channel.type, channel.config, preferInternal);
        if (!base)
            return '';
        return (0, asset_url_1.buildAssetUrl)({ base, objectPath: copy.objectPath, urlQuery: copy.urlQuery });
    }
    buildDirectUrl(copy, channel, preferInternal) {
        const cfg = channel.config;
        if (copy.objectPath) {
            const built = this.directUrlOf(copy, channel, !!preferInternal);
            if (built)
                return built;
        }
        let url = copy.remoteUrl;
        if (!url && copy.remoteKey)
            url = copy.remoteKey.replace(/^\/+/, '');
        if (!url)
            return null;
        url = normalizeUrl(url, (preferInternal && cfg.internalDomain) || cfg.publicDomain, cfg.apiUrl);
        return url;
    }
}
exports.HttpPostAdapter = HttpPostAdapter;
function extractUrl(json, responsePath) {
    const raw = (responsePath || '').trim();
    const candidates = raw && !/^auto$/i.test(raw)
        ? raw.split('|').map((s) => s.trim()).filter(Boolean)
        : COMMON_RESPONSE_PATHS;
    for (const p of candidates) {
        const v = pickPath(json, p);
        if (v)
            return v;
    }
    return '';
}
function responseMessage(json, fallback) {
    for (const p of ['message', 'msg', 'error', 'error.message', 'data.message', 'errmsg']) {
        const v = pickPath(json, p);
        if (v)
            return v;
    }
    return fallback.slice(0, 200);
}
function normalizeLskyUrl(url) {
    const u = String(url || '').trim().replace(/\/+$/, '');
    if (!u)
        return u;
    if (/\/upload$/i.test(u))
        return u;
    return `${u}/upload`;
}
function normalizeUrl(url, publicDomain, apiUrl) {
    let val = String(url).trim();
    if (!val)
        return val;
    const domain = (0, endpoint_1.ensureProtocol)(publicDomain || '').replace(/\/+$/, '');
    if (domain) {
        try {
            const parsed = new URL(val, apiUrl || undefined);
            return domain + parsed.pathname + parsed.search;
        }
        catch {
        }
    }
    if (val.startsWith('//')) {
        const proto = /^(https?):/i.exec(apiUrl || '')?.[1] || 'https';
        return `${proto}:${val}`;
    }
    if (/^https?:\/\//i.test(val))
        return val;
    try {
        return new URL(val, apiUrl || undefined).toString();
    }
    catch {
        return val;
    }
}
function pickPath(obj, path) {
    let cur = obj;
    for (const seg of path.split('.')) {
        if (cur == null)
            return '';
        const m = seg.match(/^\[(\d+)\]$/);
        const idx = m ? Number(m[1]) : Number.NaN;
        if (!Number.isNaN(idx)) {
            cur = cur[idx];
        }
        else if (Array.isArray(cur)) {
            cur = cur[Number(seg)];
        }
        else {
            cur = cur[seg];
        }
    }
    if (cur == null)
        return '';
    if (typeof cur === 'string')
        return cur;
    if (typeof cur === 'number' || typeof cur === 'boolean')
        return String(cur);
    return '';
}
