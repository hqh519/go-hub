"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenApiController = void 0;
const request_origin_1 = require("../common/request-origin");
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const crypto_1 = require("crypto");
const prisma_1 = require("../common/prisma");
const crypto_service_1 = require("../common/crypto.service");
const upload_service_1 = require("../upload/upload.service");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const settings_service_1 = require("../settings/settings.service");
const storage_channel_service_1 = require("../storage/storage-channel.service");
const file_view_1 = require("../common/file-view");
const app_log_1 = require("../common/app-log");
const folder_placeholders_1 = require("./folder-placeholders");
let TokenApiController = class TokenApiController {
    uploadSvc;
    sysConfig;
    settings;
    storageChannel;
    constructor(uploadSvc, sysConfig, settings, storageChannel) {
        this.uploadSvc = uploadSvc;
        this.sysConfig = sysConfig;
        this.settings = settings;
        this.storageChannel = storageChannel;
    }
    encodePath(id) {
        return String(id || '')
            .split('/')
            .map((seg) => encodeURIComponent(seg))
            .join('/');
    }
    setSafeHeader(res, name, value) {
        res.setHeader(name, String(value ?? '').replace(/[^\t\x20-\x7e\xa0-\xff]/g, ''));
    }
    async adminUsername() {
        try {
            const security = (await this.sysConfig.get('security'));
            const u = String(security?.auth?.admin?.adminUsername || security?.admin?.adminUsername || '').trim();
            if (u)
                return u;
        }
        catch {
        }
        return (process.env.ADMIN_USER || '').trim() || (process.env.SUPER_ADMIN_USERNAME || '').trim() || 'admin';
    }
    async resolveToken(req, body) {
        const hdr = String(req.headers['x-api-token'] || req.headers['authorization'] || '');
        let raw = hdr.replace(/^Bearer\s+/i, '').trim();
        if (!raw && body?.token)
            raw = String(body.token).trim();
        if (!raw && req.query.token)
            raw = String(req.query.token).trim();
        if (!raw)
            return { ok: false, error: '缺少 API Token' };
        const hash = (0, crypto_1.createHash)('sha256').update(raw).digest('hex');
        const t = await prisma_1.prisma.apiToken.findUnique({ where: { tokenHash: hash } });
        if (!t || !t.enabled)
            return { ok: false, error: 'Token 无效或已禁用' };
        const metas = JSON.parse(t.metas || '{}');
        if (metas.expiresAt && Date.parse(metas.expiresAt) < Date.now())
            return { ok: false, error: 'Token 已过期' };
        void prisma_1.prisma.apiToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
        return { ok: true, token: t };
    }
    async resolveChannelId(bucket) {
        const key = String(bucket || '').trim();
        const lower = key.toLowerCase();
        if (!key || lower === 'default' || lower === 'auto' || storage_channel_service_1.NO_BACKUP_VALUES.includes(lower))
            return '';
        const ch = (await prisma_1.prisma.channel.findUnique({ where: { code: key } })) ||
            (await prisma_1.prisma.channel.findUnique({ where: { id: key } })) ||
            null;
        return ch && ch.enabled ? ch.id : '';
    }
    async uploadByToken(file, req, body, res) {
        const auth = await this.resolveToken(req, body);
        if (!auth.ok || !auth.token)
            return res.status(401).json({ success: false, message: auth.error });
        if ((auth.token.type || 'web') !== 'web') {
            return res.status(400).json({ success: false, message: '该 Token 为 S3 类型，请使用 S3 协议上传' });
        }
        const tokenMetas = JSON.parse(auth.token.metas || '{}');
        const usernameParam = String(body.username || '').trim();
        const userstoreRaw = String(body.userstore ?? '').trim().toLowerCase();
        const useUserStore = !!usernameParam && userstoreRaw !== 'false' && userstoreRaw !== '0';
        if (useUserStore) {
            const tokenOwner = String(tokenMetas.owner || '').trim();
            const admin = await this.adminUsername();
            const isAdminToken = !tokenOwner || tokenOwner === 'admin' || tokenOwner === admin;
            if (!isAdminToken && tokenOwner !== usernameParam) {
                app_log_1.appLog.warn('token', 'API Token 越权尝试', `token=${auth.token.prefix} owner=${tokenOwner} username=${usernameParam}`);
                return res.status(403).json({ success: false, message: `该 Token 仅可为账户「${tokenOwner}」上传` });
            }
            const targetUser = await prisma_1.prisma.user.findUnique({ where: { username: usernameParam } });
            if (!targetUser || !targetUser.enabled) {
                return res.status(400).json({ success: false, message: `username「${usernameParam}」对应的账户不存在或已禁用` });
            }
        }
        const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
        let channelId = '';
        let backupChannelId = '';
        let owner = '';
        let ignoreUploaderChannel = false;
        if (useUserStore) {
            const mainCh = await this.storageChannel.getStorageChannel(usernameParam, '');
            const backupCh = await this.storageChannel.getStorageChannel(usernameParam, 'backup');
            channelId = mainCh?.id || '';
            backupChannelId = backupCh?.id || '';
            owner = usernameParam;
        }
        else {
            const rawOwner = String(tokenMetas.owner || '').trim();
            owner = rawOwner && rawOwner !== 'admin' ? rawOwner : await this.adminUsername();
            const tokenMainRaw = String(tokenMetas.defaultBucket || '').trim();
            const tokenBackupRaw = String(tokenMetas.defaultBackup || '').trim();
            if (tokenMainRaw) {
                channelId = (await this.storageChannel.findById(tokenMainRaw))?.id || '';
            }
            if (tokenBackupRaw && !storage_channel_service_1.NO_BACKUP_VALUES.includes(tokenBackupRaw.toLowerCase())) {
                backupChannelId = (await this.storageChannel.findById(tokenBackupRaw))?.id || '';
            }
            ignoreUploaderChannel = true;
        }
        const tokenBackupFlag = String(tokenMetas.defaultBackup || '').trim().toLowerCase();
        const backupOff = !useUserStore && storage_channel_service_1.NO_BACKUP_VALUES.includes(tokenBackupFlag);
        const tokenFolder = (0, folder_placeholders_1.expandFolderPlaceholders)(String(tokenMetas.defaultCategory || ''), {
            tokenName: auth.token.name,
            user: owner,
        });
        const opts = {
            channelId: channelId || undefined,
            tokenId: undefined,
            uploadFolder: tokenFolder,
            uploadNameType: String(body.nameType || 'default'),
            uploader: owner,
            ip,
            serverCompress: body.compress === 'true' || body.compress === '1',
            compressPercent: Number(body.compressPercent || 0) || 0,
            backup: backupOff ? false : true,
            backupChannelId: backupChannelId || undefined,
            ignoreUploaderChannel,
            autoRetry: body.autoRetry === 'true',
            skipFileLimits: auth.token.enforceLimits === false,
            uploadSource: 'API-Web',
        };
        try {
            let buffer;
            let mime;
            let originalName;
            if (file) {
                buffer = file.buffer;
                mime = file.mimetype;
                originalName = file.originalname;
            }
            else if (body.url) {
                const r = await fetch(String(body.url));
                if (!r.ok)
                    return res.status(400).json({ success: false, message: `拉取链接失败 HTTP ${r.status}` });
                buffer = Buffer.from(await r.arrayBuffer());
                mime = r.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
                originalName = decodeURIComponent(String(body.url).split('/').pop() || 'file');
            }
            else {
                return res.status(400).json({ success: false, message: '缺少 file 或 url' });
            }
            const r = await this.uploadSvc.upload({ buffer, mime, originalName }, opts);
            if (r.error)
                return res.status(500).json({ success: false, message: r.error });
            const origin = (0, request_origin_1.signOrigin)(req);
            const prefix = await this.settings.getLinkPrefix(origin);
            const ext = (0, file_view_1.extSuffixFor)(r.id, originalName);
            return res.json({
                success: true,
                data: { name: r.id, url: `${prefix}${this.encodePath(r.id)}${ext}`, dedup: !!r.dedup },
            });
        }
        catch (err) {
            app_log_1.appLog.error('token', 'API Token 上传失败', err.message, ip);
            return res.status(500).json({ success: false, message: err.message });
        }
    }
    parseSigV4(headers) {
        const auth = headers['authorization'] || '';
        const m = /^AWS4-HMAC-SHA256\s+Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]+)$/i.exec(auth);
        if (!m)
            return null;
        return { accessKey: m[1], dateStamp: m[2], region: m[3], service: m[4], signedHeaders: m[5].split(';'), signature: m[6] };
    }
    verifySigV4(req, body, secretKey) {
        const headers = {};
        for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string')
                headers[k.toLowerCase()] = v;
        }
        const parsed = this.parseSigV4(headers);
        if (!parsed)
            return { ok: false, error: '仅支持 AWS4-HMAC-SHA256 签名' };
        const qIdx = req.originalUrl.indexOf('?');
        const path = qIdx === -1 ? req.originalUrl : req.originalUrl.slice(0, qIdx);
        const rawQuery = qIdx === -1 ? '' : req.originalUrl.slice(qIdx + 1);
        const query = rawQuery
            .split('&')
            .filter(Boolean)
            .map((kv) => {
            const i = kv.indexOf('=');
            return i === -1 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)];
        })
            .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            .map(([k, v]) => `${k}=${v}`)
            .join('&');
        const canonicalHeaders = parsed.signedHeaders.map((h) => `${h}:${(headers[h] || '').trim()}\n`).join('');
        const payloadHash = headers['x-amz-content-sha256'] || (0, crypto_1.createHash)('sha256').update(body).digest('hex');
        const canonicalRequest = [req.method, path, query, canonicalHeaders, parsed.signedHeaders.join(';'), payloadHash].join('\n');
        const scope = `${parsed.dateStamp}/${parsed.region}/s3/aws4_request`;
        const stringToSign = [
            'AWS4-HMAC-SHA256',
            headers['x-amz-date'] || headers['date'] || '',
            scope,
            (0, crypto_1.createHash)('sha256').update(canonicalRequest).digest('hex'),
        ].join('\n');
        let k = (0, crypto_1.createHmac)('sha256', `AWS4${secretKey}`).update(parsed.dateStamp, 'utf8').digest();
        k = (0, crypto_1.createHmac)('sha256', k).update(parsed.region, 'utf8').digest();
        k = (0, crypto_1.createHmac)('sha256', k).update('s3', 'utf8').digest();
        k = (0, crypto_1.createHmac)('sha256', k).update('aws4_request', 'utf8').digest();
        const expected = (0, crypto_1.createHmac)('sha256', k).update(stringToSign, 'utf8').digest('hex');
        if (expected !== parsed.signature)
            return { ok: false, error: `签名不匹配（accessKey=${parsed.accessKey}）` };
        return { ok: true };
    }
    async findS3Token(accessKey) {
        if (!accessKey)
            return null;
        const rows = await prisma_1.prisma.apiToken.findMany({ where: { type: 's3', enabled: true } });
        for (const t of rows) {
            const metas = JSON.parse(t.metas || '{}');
            if (metas.accessKey === accessKey && metas.secretKeyEnc) {
                try {
                    return {
                        tokenId: t.id,
                        tokenName: String(t.name || '').trim(),
                        secretKey: crypto_service_1.CryptoService.decrypt(metas.secretKeyEnc),
                        owner: String(metas.owner || '').trim(),
                        defaultBackup: String(metas.defaultBackup || '').trim(),
                        defaultBucket: String(metas.defaultBucket || '').trim(),
                        defaultCategory: String(metas.defaultCategory || '').trim(),
                        enforceLimits: t.enforceLimits !== false,
                    };
                }
                catch {
                    return null;
                }
            }
        }
        return null;
    }
    objectKeyOf(req, bucket) {
        const qIdx = req.originalUrl.indexOf('?');
        const path = qIdx === -1 ? req.originalUrl : req.originalUrl.slice(0, qIdx);
        const after = path.replace(/^\/s3\//, '');
        const key = after.startsWith(`${bucket}/`) ? after.slice(bucket.length + 1) : after.split('/').slice(1).join('/');
        try {
            return decodeURIComponent(key);
        }
        catch {
            return key;
        }
    }
    async listBuckets(req, res) {
        const channels = await prisma_1.prisma.channel.findMany({ where: { enabled: true }, orderBy: { code: 'asc' } });
        const xml = channels
            .map((c) => `  <Bucket><Name>${c.code}</Name><CreationDate>${c.createdAt.toISOString()}</CreationDate></Bucket>`)
            .join('\n');
        void req;
        res.setHeader('Content-Type', 'application/xml');
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<ListAllMyBucketsResult><Buckets>\n${xml}\n</Buckets></ListAllMyBucketsResult>`);
    }
    async putObject(req, res) {
        const rawPath = req.originalUrl.split('?')[0];
        const after = rawPath.replace(/^\/s3\/?/, '');
        const bucket = after.split('/')[0] ? decodeURIComponent(after.split('/')[0]) : '';
        if (!bucket)
            return res.status(400).send('缺少 bucket');
        const headers = {};
        for (const [k, v] of Object.entries(req.headers))
            if (typeof v === 'string')
                headers[k.toLowerCase()] = v;
        const parsed = this.parseSigV4(headers);
        if (!parsed)
            return res.status(403).send('仅支持 AWS4-HMAC-SHA256 签名');
        const found = await this.findS3Token(parsed.accessKey);
        if (!found)
            return res.status(403).send('AccessKey 无效或已禁用');
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const check = this.verifySigV4(req, body, found.secretKey);
        if (!check.ok) {
            app_log_1.appLog.warn('token', 'S3 签名校验失败', check.error);
            return res.status(403).send(check.error || '签名校验失败');
        }
        const key = this.objectKeyOf(req, bucket);
        const channelId = await this.resolveChannelId(bucket);
        const ip = String(headers['x-forwarded-for'] || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
        const originalName = key.split('/').pop() || key;
        const owner = found.owner && found.owner !== 'admin' ? found.owner : await this.adminUsername();
        const backupOff = storage_channel_service_1.NO_BACKUP_VALUES.includes(String(found.defaultBackup || '').trim().toLowerCase());
        const uploadFolder = (0, folder_placeholders_1.expandFolderPlaceholders)(String(found.defaultCategory || ''), {
            tokenName: found.tokenName,
            user: owner,
        });
        try {
            const r = await this.uploadSvc.upload({ buffer: body, mime: headers['content-type'] || 'application/octet-stream', originalName }, {
                channelId: channelId || undefined,
                tokenId: found.tokenId,
                uploadNameType: 'default',
                uploadFolder,
                uploader: owner,
                ip,
                presetFileId: key,
                backup: !backupOff,
                skipFileLimits: found.enforceLimits === false,
                uploadSource: 'API-S3',
            });
            if (r.error)
                return res.status(500).send(r.error);
            void prisma_1.prisma.apiToken.update({ where: { id: found.tokenId }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
            res.setHeader('ETag', `"${(0, crypto_1.createHash)('md5').update(body).digest('hex')}"`);
            res.setHeader('x-amz-request-id', (0, crypto_1.randomBytes)(16).toString('hex').toUpperCase());
            const origin = (0, request_origin_1.signOrigin)(req);
            const prefix = await this.settings.getLinkPrefix(origin);
            const signedUrl = `${prefix}${this.encodePath(r.id)}${(0, file_view_1.extSuffixFor)(r.id, originalName)}`;
            this.setSafeHeader(res, 'Location', signedUrl);
            this.setSafeHeader(res, 'x-gohub-url', signedUrl);
            this.setSafeHeader(res, 'x-gohub-id', this.encodePath(r.id));
            return res.status(200).send('');
        }
        catch (err) {
            app_log_1.appLog.error('token', 'S3 上传失败', err.message, ip);
            return res.status(500).send(err.message);
        }
    }
    async headObject(req, res) {
        const bucket = decodeURIComponent(req.originalUrl.split('?')[0].replace(/^\/s3\/?/, '').split('/')[0]);
        const key = this.objectKeyOf(req, bucket);
        const rec = await prisma_1.prisma.fileRecord.findFirst({
            where: { status: 'active', OR: [{ name: key }, { originalName: key.split('/').pop() || key }] },
        });
        return rec ? res.status(200).send('') : res.status(404).send('');
    }
    async deleteObject(req, res) {
        const rawPath = req.originalUrl.split('?')[0];
        const after = rawPath.replace(/^\/s3\/?/, '');
        const bucket = after.split('/')[0] ? decodeURIComponent(after.split('/')[0]) : '';
        if (!bucket)
            return res.status(400).send('缺少 bucket');
        const headers = {};
        for (const [k, v] of Object.entries(req.headers))
            if (typeof v === 'string')
                headers[k.toLowerCase()] = v;
        const parsed = this.parseSigV4(headers);
        if (!parsed)
            return res.status(403).send('仅支持 AWS4-HMAC-SHA256 签名');
        const found = await this.findS3Token(parsed.accessKey);
        if (!found)
            return res.status(403).send('AccessKey 无效或已禁用');
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const check = this.verifySigV4(req, body, found.secretKey);
        if (!check.ok) {
            app_log_1.appLog.warn('token', 'S3 删除签名校验失败', check.error);
            return res.status(403).send(check.error || '签名校验失败');
        }
        const key = this.objectKeyOf(req, bucket);
        const record = await prisma_1.prisma.fileRecord.findFirst({
            where: { status: 'active', OR: [{ name: key }, { name: key.replace(/\.[^.]*$/, '') }] },
        });
        if (!record)
            return res.status(404).send('NoSuchKey');
        try {
            await this.uploadSvc.softDeleteFile(record.id, record.name);
        }
        catch (err) {
            app_log_1.appLog.error('token', 'S3 删除失败', `${record.name}：${err.message}`);
            return res.status(500).send(err.message);
        }
        void prisma_1.prisma.apiToken.update({ where: { id: found.tokenId }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
        app_log_1.appLog.info('token', 'S3 删除对象（进回收站）', `${record.name} ｜ bucket=${bucket}`);
        return res.status(204).send('');
    }
};
exports.TokenApiController = TokenApiController;
__decorate([
    (0, common_1.Post)('api/token/upload'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: 200 * 1024 * 1024 } })),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], TokenApiController.prototype, "uploadByToken", null);
__decorate([
    (0, common_1.Get)('s3'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TokenApiController.prototype, "listBuckets", null);
__decorate([
    (0, common_1.Put)('s3/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TokenApiController.prototype, "putObject", null);
__decorate([
    (0, common_1.Head)('s3/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TokenApiController.prototype, "headObject", null);
__decorate([
    (0, common_1.Delete)('s3/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TokenApiController.prototype, "deleteObject", null);
exports.TokenApiController = TokenApiController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [upload_service_1.UploadService,
        sysconfig_service_1.SysConfigService,
        settings_service_1.SettingsService,
        storage_channel_service_1.StorageChannelService])
], TokenApiController);
