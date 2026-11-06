"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.S3Adapter = exports.looksInternalHost = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const fs_1 = require("fs");
const adapter_interface_1 = require("./adapter.interface");
const endpoint_1 = require("../common/endpoint");
const asset_url_1 = require("../common/asset-url");
var endpoint_2 = require("../common/endpoint");
Object.defineProperty(exports, "looksInternalHost", { enumerable: true, get: function () { return endpoint_2.looksInternalHost; } });
function resolveEndpoint(type, cfg) {
    const raw = (cfg.endpoint || '').trim();
    if (type === 'r2' && raw && !/^https?:\/\//i.test(raw)) {
        return `https://${raw}.r2.cloudflarestorage.com`;
    }
    if (raw)
        return (0, endpoint_1.ensureProtocol)(raw);
    if (type === 'cos' && cfg.region) {
        return `https://cos.${cfg.region}.myqcloud.com`;
    }
    return '';
}
function resolveBucket(type, cfg) {
    const bucket = (cfg.bucket || '').trim();
    const appid = (cfg.appid || '').trim();
    if (type === 'cos' && appid && !bucket.includes(`-${appid}`)) {
        return `${bucket}-${appid}`;
    }
    return bucket;
}
class S3Adapter {
    client;
    bucket;
    channel;
    endpoint;
    constructor(channel) {
        this.channel = channel;
        const cfg = channel.config;
        const ak = cfg.accessKeyId || cfg.secretId || '';
        const sk = cfg.secretAccessKey || cfg.secretKey || '';
        if (!ak || !sk || !cfg.bucket) {
            throw new adapter_interface_1.AdapterError('缺少 AccessKey / SecretKey / bucket 配置', channel.type);
        }
        this.endpoint = resolveEndpoint(channel.type, cfg);
        this.client = new client_s3_1.S3Client({
            endpoint: this.endpoint || undefined,
            region: cfg.region || 'auto',
            credentials: { accessKeyId: ak, secretAccessKey: sk },
            forcePathStyle: cfg.pathStyle === 'true' || channel.type === 'minio',
        });
        this.bucket = resolveBucket(channel.type, cfg);
        this.applyUserAgent(cfg.userAgent);
    }
    applyUserAgent(userAgent) {
        const ua = (userAgent || '').trim();
        if (!ua)
            return;
        if (/[^\x20-\x7e]/.test(ua)) {
            throw new adapter_interface_1.AdapterError('User-Agent 只能包含可打印 ASCII 字符', this.channel.type);
        }
        this.client.middlewareStack.addRelativeTo((next) => async (args) => {
            args.request.headers['user-agent'] = ua;
            return next(args);
        }, { name: 'channelUserAgentMiddleware', relation: 'after', toMiddleware: 'getUserAgentMiddleware' });
    }
    async upload(file, key, channel) {
        const fullKey = key;
        try {
            await this.client.send(new client_s3_1.PutObjectCommand({
                Bucket: this.bucket,
                Key: fullKey,
                Body: file.buffer,
                ContentType: file.mime,
            }));
            return { remoteKey: fullKey, objectPath: this.objectPathFor(fullKey) };
        }
        catch (err) {
            throw new adapter_interface_1.AdapterError(`上传失败: ${err.message}`, channel.type);
        }
    }
    async uploadFile(path, size, file, key, channel) {
        const fullKey = key;
        const PART_SIZE = 16 * 1024 * 1024;
        if (size <= PART_SIZE) {
            const buffer = await fs_1.promises.readFile(path);
            return this.upload({ buffer, mime: file.mime, originalName: file.originalName }, key, channel);
        }
        let uploadId;
        try {
            const created = await this.client.send(new client_s3_1.CreateMultipartUploadCommand({
                Bucket: this.bucket,
                Key: fullKey,
                ContentType: file.mime,
            }));
            uploadId = created.UploadId;
            if (!uploadId)
                throw new Error('未返回 UploadId');
            const parts = [];
            const fh = await fs_1.promises.open(path, 'r');
            try {
                for (let offset = 0, partNumber = 1; offset < size; offset += PART_SIZE, partNumber++) {
                    const len = Math.min(PART_SIZE, size - offset);
                    const buf = Buffer.allocUnsafe(len);
                    const { bytesRead } = await fh.read(buf, 0, len, offset);
                    if (bytesRead !== len)
                        throw new Error(`读取第 ${partNumber} 片失败：期望 ${len}B，实际 ${bytesRead}B`);
                    const part = await this.client.send(new client_s3_1.UploadPartCommand({
                        Bucket: this.bucket,
                        Key: fullKey,
                        UploadId: uploadId,
                        PartNumber: partNumber,
                        Body: buf,
                    }));
                    parts.push({ ETag: part.ETag, PartNumber: partNumber });
                }
            }
            finally {
                await fh.close().catch(() => undefined);
            }
            await this.client.send(new client_s3_1.CompleteMultipartUploadCommand({
                Bucket: this.bucket,
                Key: fullKey,
                UploadId: uploadId,
                MultipartUpload: { Parts: parts },
            }));
            return { remoteKey: fullKey, objectPath: this.objectPathFor(fullKey) };
        }
        catch (err) {
            if (uploadId) {
                await this.client
                    .send(new client_s3_1.AbortMultipartUploadCommand({ Bucket: this.bucket, Key: fullKey, UploadId: uploadId }))
                    .catch(() => undefined);
            }
            throw new adapter_interface_1.AdapterError(`分片上传失败: ${err.message}`, channel.type);
        }
    }
    async delete(copy, channel) {
        try {
            await this.client.send(new client_s3_1.DeleteObjectCommand({ Bucket: this.bucket, Key: copy.remoteKey }));
        }
        catch (err) {
            throw new adapter_interface_1.AdapterError(`删除失败: ${err.message}`, channel.type);
        }
    }
    baseUrlOf(preferInternal) {
        const cfg = this.channel.config;
        const raw = preferInternal && cfg.internalDomain ? cfg.internalDomain : cfg.publicDomain || '';
        const domain = (0, endpoint_1.ensureProtocol)(raw || '').replace(/\/+$/, '');
        if (domain)
            return domain;
        const endpoint = resolveEndpoint(this.channel.type, cfg).replace(/\/+$/, '');
        if (!endpoint)
            return '';
        const pathStyle = cfg.pathStyle === 'true' || this.channel.type === 'minio';
        if (pathStyle)
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
        const cfg = this.channel.config;
        const pathStyle = cfg.pathStyle === 'true' || this.channel.type === 'minio';
        if (!pathStyle)
            return key;
        const domain = String(cfg.publicDomain || cfg.internalDomain || '').trim();
        if (domain) {
            try {
                const segs = new URL((0, endpoint_1.ensureProtocol)(domain)).pathname.split('/').filter(Boolean);
                if (segs[segs.length - 1] === this.bucket)
                    return key;
            }
            catch {
            }
        }
        return `${this.bucket}/${key}`;
    }
    buildDirectUrl(copy, channel, preferInternal) {
        const cfg = channel.config;
        const key = copy.remoteKey;
        const suffix = (cfg.suffix || '').trim();
        const withSuffix = (u) => (suffix ? u + (suffix.startsWith('?') ? suffix : `?${suffix}`) : u);
        const pathStyle = cfg.pathStyle === 'true' || channel.type === 'minio';
        if (copy.objectPath) {
            const base = this.baseUrlOf(!!preferInternal);
            if (!base)
                return null;
            return (0, asset_url_1.buildAssetUrl)({ base, objectPath: copy.objectPath, urlQuery: copy.urlQuery, suffix });
        }
        const domain = (0, endpoint_1.ensureProtocol)((preferInternal && cfg.internalDomain) || cfg.publicDomain || '').replace(/\/+$/, '');
        if (domain) {
            if (pathStyle) {
                let pathHasBucket = false;
                try {
                    const u = new URL(domain);
                    pathHasBucket = u.pathname.split('/').filter(Boolean).includes(this.bucket);
                }
                catch {
                    pathHasBucket = domain.split('/').filter(Boolean).includes(this.bucket);
                }
                return withSuffix(pathHasBucket ? `${domain}/${key}` : `${domain}/${this.bucket}/${key}`);
            }
            return withSuffix(`${domain}/${key}`);
        }
        const endpoint = resolveEndpoint(channel.type, cfg).replace(/\/+$/, '');
        if (!endpoint)
            return null;
        if (pathStyle) {
            return withSuffix(`${endpoint}/${this.bucket}/${key}`);
        }
        try {
            const url = new URL(endpoint);
            return withSuffix(`${url.protocol}//${this.bucket}.${url.host}${url.pathname.replace(/\/+$/, '')}/${key}`);
        }
        catch {
            return withSuffix(`${endpoint}/${this.bucket}/${key}`);
        }
    }
}
exports.S3Adapter = S3Adapter;
