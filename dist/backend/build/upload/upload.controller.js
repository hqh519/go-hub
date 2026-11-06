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
var UploadController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadController = void 0;
const request_origin_1 = require("../common/request-origin");
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const common_2 = require("@nestjs/common");
const fs_1 = require("fs");
const stream_1 = require("stream");
const promises_1 = require("stream/promises");
const auth_guard_1 = require("../auth/auth.guard");
const upload_service_1 = require("./upload.service");
const settings_service_1 = require("../settings/settings.service");
const storage_channel_service_1 = require("../storage/storage-channel.service");
const file_view_1 = require("../common/file-view");
const video_resolve_1 = require("./video-resolve");
const app_log_1 = require("../common/app-log");
const upload_session_1 = require("./upload-session");
const STAGE_DIRECT_BYTES = 32 * 1024 * 1024;
const MAX_SINGLE_BYTES = Math.max(512, Number(process.env.UPLOAD_MAX_SINGLE_MB || 4096)) * 1024 * 1024;
const MAX_FETCH_BYTES = Math.max(512, Number(process.env.UPLOAD_FETCH_MAX_MB || 4096)) * 1024 * 1024;
function isBlockedFetchHost(hostname) {
    const h = hostname.toLowerCase();
    if (h === '0.0.0.0')
        return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
        const [a, b] = h.split('.').map(Number);
        if (a === 169 && b === 254)
            return true;
        if (a >= 224)
            return true;
    }
    if (h.startsWith('fe80'))
        return true;
    return false;
}
function fixFilename(name) {
    const raw = String(name || '');
    if (!raw)
        return raw;
    if (!/[\u0080-\u00FF]/.test(raw))
        return raw;
    try {
        const restored = Buffer.from(raw, 'latin1').toString('utf8');
        if (!restored.includes('\uFFFD') && /[^\u0000-\u007F]/.test(restored)) {
            console.log(`[upload] multipart 文件名编码已还原: ${raw} -> ${restored}`);
            return restored;
        }
    }
    catch {
    }
    return raw;
}
let UploadController = class UploadController {
    static { UploadController_1 = this; }
    svc;
    settings;
    static MIME_EXT = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/bmp': 'bmp',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/quicktime': 'mov',
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/aac': 'aac',
        'audio/ogg': 'ogg',
    };
    constructor(svc, settings) {
        this.svc = svc;
        this.settings = settings;
        (0, upload_session_1.startUploadSweeper)();
    }
    async signedSrc(id, req) {
        const origin = (0, request_origin_1.signOrigin)(req);
        const prefix = await this.settings.getLinkPrefix(origin);
        return `${prefix}${encodeURIComponent(id)}`;
    }
    clientIp(req) {
        const fwd = req.headers['x-forwarded-for']?.split(',')[0]?.trim();
        return (fwd || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    }
    async cleanupChunked(q, req, res) {
        if (q.cleanup === 'true' && q.uploadId) {
            await (0, upload_session_1.removeSession)(q.uploadId);
            return res.json({ success: true });
        }
        if (q.session === 'true' && q.uploadId) {
            const session = await (0, upload_session_1.getSession)(q.uploadId);
            if (!session) {
                return res.json({ success: false, gone: true, message: '上传会话不存在或已过期，请重新上传' });
            }
            const received = await (0, upload_session_1.receivedChunks)(q.uploadId);
            const merging = !!(session.mergingAt && Date.now() - session.mergingAt < 10 * 60_000);
            const base = {
                success: true,
                uploadId: session.uploadId,
                name: session.originalName,
                completed: !!session.completedAt,
                merging,
                totalChunks: session.totalChunks,
                receivedCount: received.length,
            };
            if (session.completedAt && session.mergeFileId) {
                return res.json({
                    ...base,
                    result: [{ src: await this.signedSrc(session.mergeFileId, req), name: session.mergeName || session.originalName }],
                });
            }
            return res.json(base);
        }
        return res.status(400).json({ success: false, message: '无效的清理请求' });
    }
    async registerFile(body, req, res) {
        const uploader = (0, auth_guard_1.currentSession)(req)?.user || req.session?.user || '';
        if (!uploader) {
            return res.status(401).json({ success: false, message: '请先登录后再登记文件' });
        }
        const result = await this.svc.registerFile({
            sourceUrl: String(body.sourceUrl || ''),
            originalName: String(body.originalName || ''),
            extension: String(body.extension || ''),
            channelId: String(body.channelId || ''),
            folder: String(body.folder || ''),
            note: String(body.note || ''),
            uploader,
            ip: this.clientIp(req),
            instanceId: String(body.instanceId || '').trim(),
        });
        if (result.error)
            return res.status(400).json({ success: false, message: result.error });
        return res.json({
            success: true,
            data: {
                id: result.id,
                name: result.info?.name,
                size: result.info?.size,
                mime: result.info?.mime,
                md5: result.info?.md5,
                channel: result.info?.channel,
                src: result.id ? await this.signedSrc(result.id, req) : '',
            },
        });
    }
    async upload(file, q, body, req, res) {
        if (q.cleanup === 'true' && q.uploadId) {
            await (0, upload_session_1.removeSession)(q.uploadId);
            return res.json({ success: true });
        }
        const backupRaw = String(q.backupChannelId ?? q.backupChannel ?? '').trim();
        const backupOff = storage_channel_service_1.NO_BACKUP_VALUES.includes(backupRaw.toLowerCase());
        const backupChannelId = !backupOff && backupRaw ? backupRaw : undefined;
        const uploader = (0, auth_guard_1.currentSession)(req)?.user || req.session?.user || '';
        const enforceLimits = await this.svc.userEnforceLimits(uploader);
        const overrideExts = String(q.allowedExtensions || '')
            .split(',')
            .map((s) => s.trim().replace(/^\./, '').toLowerCase())
            .filter(Boolean);
        const overrideMaxMB = Number(q.maxFileSizeMB || 0) || 0;
        const arrivedAt = Number(req._arrivedAt) || Date.now();
        const declaredSource = (0, file_view_1.isClientUploadSource)(q.uploadSource) ? (0, file_view_1.normalizeUploadSource)(q.uploadSource) : '';
        const uploadSource = q.stagingId ? 'Fetch' : declaredSource || 'Default';
        const opts = {
            uploadChannel: q.uploadChannel,
            channelId: q.channelId ?? q.channelName,
            uploadNameType: q.uploadNameType,
            serverCompress: q.serverCompress === undefined ? undefined : q.serverCompress === 'true' || q.serverCompress === '1',
            uploadFolder: q.uploadFolder || '',
            uploader,
            ip: this.clientIp(req),
            originalSize: Number(q.originalSize || body.originalSize || 0) || 0,
            compressPercent: Number(q.compressPercent || body.compressPercent || 0) || 0,
            videoTranscode: q.videoTranscode === undefined ? undefined : q.videoTranscode === 'true' || q.videoTranscode === '1',
            backup: backupOff ? false : q.backup !== 'false' && q.backup !== '0',
            backupChannelId,
            autoRetry: q.autoSwitch === undefined && q.autoRetry === undefined
                ? undefined
                : (q.autoSwitch ?? q.autoRetry) === 'true' || (q.autoSwitch ?? q.autoRetry) === '1',
            retryRound: Math.max(0, Number(q.retryRound) || 0),
            failReason: String(q.failReason || '').slice(0, 300),
            webpSkip: String(q.webpSkip || '').slice(0, 120),
            instanceId: String(q.instanceId ?? body.instanceId ?? '').trim(),
            webpMode: q.webpMode === 'lossless' || q.webpMode === 'lossy' ? q.webpMode : '',
            skipFileLimits: !enforceLimits,
            uploadSource,
            extraTags: String(q.extraTags || '')
                .split(',')
                .map((t) => t.trim().slice(0, 20))
                .filter(Boolean)
                .slice(0, 10),
            uploadStartedAt: new Date(arrivedAt),
            limitsOverride: {
                exts: overrideExts.length ? overrideExts : undefined,
                maxMB: overrideMaxMB > 0 ? overrideMaxMB : undefined,
            },
        };
        if (q.initChunked === 'true') {
            const totalChunks = Math.max(1, Number(body.totalChunks || q.totalChunks || 0));
            const originalName = fixFilename(body.originalFileName || q.originalFileName || 'chunked.bin');
            const mime = body.originalFileType || q.originalFileType || 'application/octet-stream';
            const size = Number(body.fileSize || q.fileSize || 0) || 0;
            const uploadKey = String(body.uploadKey || q.uploadKey || '').slice(0, 200);
            if (uploadKey) {
                const done = await (0, upload_session_1.findCompletedSessionByKey)(uploadKey);
                if (done && done.totalChunks === totalChunks) {
                    if (done.mergeFileId) {
                        app_log_1.appLog.info('upload', `幂等命中：${originalName} 已上传完成（会话 ${done.uploadId}），跳过重传直接返回已有结果`, `uploadKey=${uploadKey}`);
                        return res.json({
                            success: true,
                            completed: true,
                            uploadId: done.uploadId,
                            received: [],
                            resumed: false,
                            result: [{ src: await this.signedSrc(done.mergeFileId, req), name: done.mergeName || done.originalName }],
                        });
                    }
                    app_log_1.appLog.warn('upload', `幂等拦截：${originalName} 的会话 ${done.uploadId} 已完成但未记录结果，拒绝重传`, `uploadKey=${uploadKey}`);
                    return res.json({ success: false, completed: true, message: '该文件已上传完成，请到文件管理确认，不要重复上传' });
                }
                const exist = await (0, upload_session_1.findSessionByKey)(uploadKey);
                if (exist && exist.totalChunks === totalChunks) {
                    const received = await (0, upload_session_1.receivedChunks)(exist.uploadId);
                    console.log(`[upload] 续传命中：${originalName}（已收 ${received.length}/${totalChunks} 片）`);
                    return res.json({ success: true, uploadId: exist.uploadId, received, resumed: true });
                }
            }
            const session = await (0, upload_session_1.createSession)({ totalChunks, originalName, mime, size, uploadKey });
            return res.json({ success: true, uploadId: session.uploadId, received: [], resumed: false });
        }
        if (q.chunked === 'true') {
            const uploadId = body.uploadId || q.uploadId || '';
            const session = await (0, upload_session_1.getSession)(uploadId);
            if (!session) {
                return res.status(400).json({ success: false, message: '上传会话不存在或已过期，请重新上传' });
            }
            if (q.merge === 'true') {
                if (session.completedAt) {
                    if (session.mergeFileId) {
                        app_log_1.appLog.info('upload', `合并重入：${session.originalName} 已上传完成，直接返回已有结果（不重复落库）`, `uploadId=${session.uploadId}`);
                        return res.json([
                            { src: await this.signedSrc(session.mergeFileId, req), name: session.mergeName || session.originalName },
                        ]);
                    }
                    app_log_1.appLog.warn('upload', `合并重入被拒：${session.originalName} 的会话已完成但未记录结果`, `uploadId=${session.uploadId}`);
                    return res.status(400).json({ success: false, completed: true, message: '该文件已上传完成，请到文件管理确认，不要重复提交' });
                }
                if (!(await (0, upload_session_1.claimMergeLock)(session))) {
                    app_log_1.appLog.warn('upload', `并发合并被拒：${session.originalName} 正在合并中，忽略重复的合并请求`, `uploadId=${session.uploadId}`);
                    return res.status(400).json({ success: false, message: '该文件正在合并中，请耐心等待，不要重复提交' });
                }
                let merged;
                try {
                    merged = await (0, upload_session_1.mergeSession)(session);
                    const originalName = fixFilename(body.originalFileName || session.originalName);
                    try {
                        const r = await this.svc.upload({
                            buffer: Buffer.alloc(0),
                            path: merged.path,
                            size: merged.size,
                            mime: session.mime,
                            originalName,
                        }, { ...opts, uploadStartedAt: new Date(session.startedAt || arrivedAt) });
                        if (r.error) {
                            app_log_1.appLog.error('upload', `分片合并后写渠道失败：${originalName}`, r.error);
                            return res.status(500).json({ success: false, message: r.error });
                        }
                        await (0, upload_session_1.markSessionCompleted)(session, { fileId: r.id, name: r.finalName || originalName });
                        return res.json([{ src: await this.signedSrc(r.id, req), name: r.finalName || originalName }]);
                    }
                    catch (err) {
                        app_log_1.appLog.error('upload', `分片合并后上传异常：${session.originalName}`, err.message);
                        return res.status(500).json({ success: false, message: err.message });
                    }
                }
                catch (err) {
                    const msg = err.message || '分片合并失败';
                    app_log_1.appLog.warn('upload', `分片合并失败：${session.originalName}`, msg);
                    return res.status(400).json({ success: false, message: msg });
                }
                finally {
                    await (0, upload_session_1.releaseMergeLock)(session);
                }
            }
            const idx = Number(body.chunkIndex ?? q.chunkIndex ?? -1);
            if (!Number.isInteger(idx) || idx < 0 || idx >= session.totalChunks) {
                return res.status(400).json({ success: false, message: `分片序号无效（${idx}）` });
            }
            if (!file?.buffer?.length) {
                return res.status(400).json({ success: false, message: '分片内容为空' });
            }
            await (0, upload_session_1.writeChunk)(uploadId, idx, file.buffer);
            await (0, upload_session_1.touchSession)(session);
            return res.json({ success: true, chunkIndex: idx });
        }
        const stagingId = String(body.stagingId || q.stagingId || '');
        if (stagingId) {
            const meta = await (0, upload_session_1.getStaging)(stagingId);
            if (!meta)
                return res.status(400).json({ success: false, message: '暂存文件不存在或已过期，请重新转存' });
            let st = null;
            try {
                st = await fs_1.promises.stat((0, upload_session_1.stagingFilePath)(stagingId));
            }
            catch {
                st = null;
            }
            if (!st)
                return res.status(400).json({ success: false, message: '暂存文件已丢失，请重新转存' });
            const originalName = fixFilename(body.originalFileName || q.originalFileName || meta.name);
            const r = await this.svc.upload({
                buffer: Buffer.alloc(0),
                path: (0, upload_session_1.stagingFilePath)(stagingId),
                size: st.size,
                mime: meta.mime,
                originalName,
            }, {
                ...opts,
                originalSize: Number(q.originalSize || 0) || st.size,
                uploadStartedAt: new Date(meta.createdAt || arrivedAt),
            });
            if (r.error)
                return res.status(500).json({ success: false, message: r.error });
            await (0, upload_session_1.updateStaging)(meta, { committedAt: Date.now() });
            return res.json([{ src: await this.signedSrc(r.id, req), name: r.finalName || originalName }]);
        }
        if (!file)
            return res.status(400).json({ success: false, message: '缺少文件' });
        const originalName = fixFilename(file.originalname);
        const r = await this.svc.upload({ buffer: file.buffer, mime: file.mimetype, originalName }, opts);
        if (r.error)
            return res.status(500).json({ success: false, message: r.error });
        return res.json([{ src: await this.signedSrc(r.id, req), name: r.finalName || originalName }]);
    }
    async fetchRes(body, res) {
        const url = body.url || '';
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch {
            app_log_1.appLog.warn('fetch', `链接转存失败：URL 无效`, url.slice(0, 200));
            return res.status(400).json({ success: false, message: 'URL 无效' });
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            app_log_1.appLog.warn('fetch', `链接转存失败：仅支持 http/https`, url.slice(0, 200));
            return res.status(400).json({ success: false, message: '仅支持 http/https' });
        }
        if (isBlockedFetchHost(parsed.hostname)) {
            app_log_1.appLog.warn('fetch', `链接转存失败：目标为云元数据/组播地址，已拦截`, url.slice(0, 200));
            return res.status(400).json({ success: false, message: '禁止访问该地址（云元数据/组播地址）' });
        }
        const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        const firstCtrl = new AbortController();
        const firstTimer = setTimeout(() => firstCtrl.abort(), 15000);
        try {
            let resp = await fetch(url, {
                signal: firstCtrl.signal,
                redirect: 'follow',
                headers: { 'user-agent': UA },
            });
            if (!resp.ok) {
                app_log_1.appLog.warn('fetch', `链接转存失败：HTTP ${resp.status}`, url.slice(0, 200));
                return res.status(400).json({ success: false, message: `拉取失败 HTTP ${resp.status}` });
            }
            const firstMime = resp.headers.get('content-type')?.split(';')[0]?.trim() || '';
            let referer;
            let suggestedName = '';
            if (/^text\/html/i.test(firstMime)) {
                const html = await resp.text();
                const finalUrl = resp.url || url;
                const r = await (0, video_resolve_1.resolveVideoFromHtml)(finalUrl, html);
                if (!r.ok) {
                    app_log_1.appLog.warn('video', `视频解析失败：${url.slice(0, 120)}`, r.message);
                    return res.status(400).json({ success: false, message: r.message });
                }
                referer = r.video.referer;
                suggestedName = r.video.name || '';
                const secondCtrl = new AbortController();
                const secondTimer = setTimeout(() => secondCtrl.abort(), 120000);
                try {
                    resp = await fetch(r.video.directUrl, {
                        signal: secondCtrl.signal,
                        redirect: 'follow',
                        headers: { 'user-agent': UA, ...(referer ? { referer } : {}) },
                    });
                }
                finally {
                    clearTimeout(secondTimer);
                }
                if (!resp.ok) {
                    app_log_1.appLog.warn('fetch', `视频转存失败：HTTP ${resp.status}`, url.slice(0, 200));
                    return res.status(400).json({ success: false, message: `视频拉取失败 HTTP ${resp.status}` });
                }
            }
            let name = decodeURIComponent(safeTargetUrl(resp.url || url).pathname.split('/').pop() || '');
            const mime = resp.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
            if (!name || !name.includes('.')) {
                const ext = UploadController_1.MIME_EXT[mime] || 'bin';
                name = `${name || 'PastedFile' + Date.now()}.${ext}`;
            }
            if (suggestedName)
                name = suggestedName;
            const declaredLen = Number(resp.headers.get('content-length') || 0) || 0;
            const isImage = /^image\//i.test(mime);
            const wantStage = !isImage || declaredLen > 256 * 1024 * 1024;
            if (wantStage) {
                if (!resp.body) {
                    return res.status(400).json({ success: false, message: '目标地址没有返回可读取的内容' });
                }
                const staged = await (0, upload_session_1.createStaging)({ name, mime, size: declaredLen, sourceUrl: url });
                try {
                    await (0, promises_1.pipeline)(stream_1.Readable.fromWeb(resp.body), (0, fs_1.createWriteStream)((0, upload_session_1.stagingFilePath)(staged.stagingId)));
                }
                catch (err) {
                    await (0, upload_session_1.removeStaging)(staged.stagingId);
                    throw err;
                }
                const st = await fs_1.promises.stat((0, upload_session_1.stagingFilePath)(staged.stagingId));
                if (st.size > MAX_FETCH_BYTES) {
                    await (0, upload_session_1.removeStaging)(staged.stagingId);
                    app_log_1.appLog.warn('fetch', `链接转存失败：文件超过 ${Math.round(MAX_FETCH_BYTES / 1024 / 1024)}MB 上限`, url.slice(0, 200));
                    return res.status(400).json({ success: false, message: `文件超过 ${Math.round(MAX_FETCH_BYTES / 1024 / 1024)}MB 上限` });
                }
                const updated = await (0, upload_session_1.updateStaging)(staged, { size: st.size });
                app_log_1.appLog.info('fetch', `链接已暂存到服务端：${name}`, `${st.size}B ｜ ${url.slice(0, 180)}`);
                return res.json({
                    success: true,
                    staged: true,
                    stagingId: updated.stagingId,
                    name,
                    size: st.size,
                    mime,
                });
            }
            const buf = Buffer.from(await resp.arrayBuffer());
            if (buf.length > MAX_FETCH_BYTES) {
                app_log_1.appLog.warn('fetch', `链接转存失败：文件超过 ${Math.round(MAX_FETCH_BYTES / 1024 / 1024)}MB 上限`, url.slice(0, 200));
                return res.status(400).json({ success: false, message: `文件超过 ${Math.round(MAX_FETCH_BYTES / 1024 / 1024)}MB 上限` });
            }
            res.setHeader('Content-Type', mime);
            res.setHeader('Content-Length', String(buf.length));
            res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
            return res.send(buf);
        }
        catch (err) {
            app_log_1.appLog.error('fetch', `链接转存异常：${err.message}`, url.slice(0, 200));
            return res.status(400).json({ success: false, message: `拉取失败: ${err.message}` });
        }
        finally {
            clearTimeout(firstTimer);
        }
    }
    async deleteStaging(body) {
        const id = String(body?.stagingId || '');
        if (!id)
            return { success: true };
        try {
            await (0, upload_session_1.removeStaging)(id);
        }
        catch {
        }
        return { success: true };
    }
};
exports.UploadController = UploadController;
__decorate([
    (0, common_1.Get)('upload'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_2.Req)()),
    __param(2, (0, common_2.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "cleanupChunked", null);
__decorate([
    (0, common_1.Post)('api/record'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_2.Req)()),
    __param(2, (0, common_2.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "registerFile", null);
__decorate([
    (0, common_1.Post)('upload'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: MAX_SINGLE_BYTES } })),
    __param(0, (0, common_2.UploadedFile)()),
    __param(1, (0, common_1.Query)()),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_2.Req)()),
    __param(4, (0, common_2.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "upload", null);
__decorate([
    (0, common_1.Post)('api/fetchRes'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_2.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "fetchRes", null);
__decorate([
    (0, common_1.Post)('api/staging/delete'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "deleteStaging", null);
exports.UploadController = UploadController = UploadController_1 = __decorate([
    (0, common_1.Controller)(),
    (0, common_1.UseGuards)(auth_guard_1.OptionalAuthGuard),
    __metadata("design:paramtypes", [upload_service_1.UploadService,
        settings_service_1.SettingsService])
], UploadController);
function safeTargetUrl(u) {
    try {
        return new URL(u);
    }
    catch {
        return new URL('http://invalid.local/');
    }
}
