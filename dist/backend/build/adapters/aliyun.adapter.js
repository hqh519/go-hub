"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AliyunOssAdapter = void 0;
exports.buildOssCanonicalString = buildOssCanonicalString;
exports.ossSignature = ossSignature;
const node_crypto_1 = require("node:crypto");
const adapter_interface_1 = require("./adapter.interface");
const endpoint_1 = require("../common/endpoint");
const asset_url_1 = require("../common/asset-url");
function buildOssCanonicalString(input) {
    const lower = {};
    for (const [k, v] of Object.entries(input.headers || {})) {
        lower[String(k).toLowerCase()] = String(v ?? '').trim();
    }
    const ossHeaderLines = Object.keys(lower)
        .filter((k) => k.startsWith('x-oss-'))
        .sort()
        .map((k) => `${k}:${lower[k]}`);
    return [
        String(input.method || '').toUpperCase(),
        lower['content-md5'] || '',
        lower['content-type'] || '',
        input.expires || lower['x-oss-date'] || '',
        ...ossHeaderLines,
        input.resource,
    ].join('\n');
}
function ossSignature(input) {
    return (0, node_crypto_1.createHmac)('sha1', input.secret)
        .update(buildOssCanonicalString(input), 'utf8')
        .digest('base64');
}
function resolveOssEndpoint(cfg) {
    const raw = (cfg.endpoint || '').trim();
    if (raw)
        return (0, endpoint_1.ensureProtocol)(raw).replace(/\/+$/, '');
    const region = (cfg.region || '').trim();
    if (!region)
        return '';
    const host = region.startsWith('oss-') ? region : `oss-${region}`;
    return `https://${host}.aliyuncs.com`;
}
function encodeObjectPath(key) {
    return String(key)
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');
}
function withSuffix(url, suffix) {
    const s = (suffix || '').trim();
    if (!s)
        return url;
    return url + (s.startsWith('?') ? s : `?${s}`);
}
class AliyunOssAdapter {
    ak;
    sk;
    bucket;
    endpoint;
    pathStyle;
    channel;
    constructor(channel) {
        const cfg = channel.config;
        this.channel = channel;
        const ak = (cfg.accessKeyId || '').trim();
        const sk = (cfg.accessKeySecret || cfg.secretAccessKey || '').trim();
        const bucket = (cfg.bucket || '').trim();
        if (!ak || !sk || !bucket) {
            throw new adapter_interface_1.AdapterError('缺少 AccessKeyId / AccessKeySecret / bucket 配置', channel.type);
        }
        this.ak = ak;
        this.sk = sk;
        this.bucket = bucket;
        this.pathStyle = cfg.pathStyle === 'true';
        this.endpoint = resolveOssEndpoint(cfg);
        if (!this.endpoint) {
            throw new adapter_interface_1.AdapterError('缺少 Endpoint 或 Region（如 oss-cn-hangzhou）', channel.type);
        }
    }
    objectUrl(key) {
        const path = encodeObjectPath(key);
        if (this.pathStyle) {
            return `${this.endpoint}/${this.bucket}/${path}`;
        }
        return `${this.endpoint.replace('://', `://${this.bucket}.`)}/${path}`;
    }
    async request(method, key, opts = {}) {
        const url = this.objectUrl(key);
        const headers = { 'x-oss-date': new Date().toUTCString() };
        if (opts.body) {
            headers['Content-MD5'] = (0, node_crypto_1.createHash)('md5').update(opts.body).digest('base64');
            headers['Content-Type'] = opts.mime || 'application/octet-stream';
        }
        const signature = ossSignature({
            method,
            resource: `/${this.bucket}/${key}`,
            headers,
            secret: this.sk,
        });
        const res = await fetch(url, {
            method,
            headers: { ...headers, Authorization: `OSS ${this.ak}:${signature}` },
            body: opts.body ? new Uint8Array(opts.body) : undefined,
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new adapter_interface_1.AdapterError(`${method === 'PUT' ? '上传' : '删除'}失败: HTTP ${res.status}${detail ? ` ${detail.slice(0, 300)}` : ''}`, 'aliyun');
        }
    }
    async upload(file, key, channel) {
        const fullKey = key;
        try {
            await this.request('PUT', fullKey, { body: file.buffer, mime: file.mime });
            return { remoteKey: fullKey, objectPath: this.objectPathFor(fullKey) };
        }
        catch (err) {
            if (err instanceof adapter_interface_1.AdapterError)
                throw err;
            throw new adapter_interface_1.AdapterError(`上传失败: ${err.message}`, channel.type);
        }
    }
    async delete(copy, channel) {
        try {
            await this.request('DELETE', copy.remoteKey);
        }
        catch (err) {
            if (err instanceof adapter_interface_1.AdapterError)
                throw err;
            throw new adapter_interface_1.AdapterError(`删除失败: ${err.message}`, channel.type);
        }
    }
    baseUrlOf(preferInternal) {
        const cfg = this.channel?.config || {};
        const raw = preferInternal && cfg.internalDomain ? cfg.internalDomain : cfg.publicDomain || '';
        const domain = (0, endpoint_1.ensureProtocol)(raw || '').replace(/\/+$/, '');
        if (domain)
            return domain;
        const endpoint = this.endpoint.replace(/\/+$/, '');
        if (!endpoint)
            return '';
        if (this.pathStyle)
            return endpoint;
        try {
            const u = new URL(endpoint);
            return `${u.protocol}//${this.bucket}.${u.host}${u.pathname.replace(/\/+$/, '')}`;
        }
        catch {
            return `${endpoint}/${this.bucket}`;
        }
    }
    objectPathFor(key) {
        const cfg = this.channel?.config || {};
        if (String(cfg.publicDomain || cfg.internalDomain || '').trim())
            return key;
        return this.pathStyle ? `${this.bucket}/${key}` : key;
    }
    buildDirectUrl(copy, channel, preferInternal) {
        const cfg = channel.config;
        const key = copy.remoteKey;
        const suffix = cfg.suffix || '';
        if (copy.objectPath) {
            const base = this.baseUrlOf(!!preferInternal);
            if (!base)
                return null;
            return (0, asset_url_1.buildAssetUrl)({ base, objectPath: copy.objectPath, urlQuery: copy.urlQuery, suffix });
        }
        const domain = (0, endpoint_1.ensureProtocol)((preferInternal && cfg.internalDomain) || cfg.publicDomain || '').replace(/\/+$/, '');
        if (domain)
            return withSuffix(`${domain}/${encodeObjectPath(key)}`, suffix);
        const endpoint = resolveOssEndpoint(cfg).replace(/\/+$/, '');
        if (!endpoint)
            return null;
        if (cfg.pathStyle === 'true') {
            return withSuffix(`${endpoint}/${this.bucket}/${encodeObjectPath(key)}`, suffix);
        }
        try {
            const url = new URL(endpoint);
            return withSuffix(`${url.protocol}//${this.bucket}.${url.host}${url.pathname.replace(/\/+$/, '')}/${encodeObjectPath(key)}`, suffix);
        }
        catch {
            return withSuffix(`${endpoint}/${this.bucket}/${encodeObjectPath(key)}`, suffix);
        }
    }
}
exports.AliyunOssAdapter = AliyunOssAdapter;
