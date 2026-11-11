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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var ManageController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserConfigController = exports.ManageController = exports.LinkController = void 0;
const request_origin_1 = require("../common/request-origin");
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const common_2 = require("@nestjs/common");
const node_stream_1 = require("node:stream");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const sharp_1 = __importDefault(require("sharp"));
const prisma_1 = require("../common/prisma");
const adapter_factory_1 = require("../adapters/adapter.factory");
const local_adapter_1 = require("../adapters/local.adapter");
const channels_controller_1 = require("../channels/channels.controller");
const storage_channel_service_1 = require("../storage/storage-channel.service");
const upload_service_1 = require("../upload/upload.service");
const settings_service_1 = require("../settings/settings.service");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const auth_guard_1 = require("../auth/auth.guard");
const file_view_1 = require("../common/file-view");
const file_filter_1 = require("../common/file-filter");
const file_refs_1 = require("../common/file-refs");
const file_share_stats_1 = require("../common/file-share-stats");
const media_edit_1 = require("./media-edit");
const compress_1 = require("../common/compress");
const app_log_1 = require("../common/app-log");
const project_paths_1 = require("../common/project-paths");
const thumb_cache_1 = require("../common/thumb-cache");
const qqwry_1 = require("../common/qqwry");
const ip_query_1 = require("../common/ip-query");
const crypto_service_1 = require("../common/crypto.service");
const totp_1 = require("../common/totp");
const channel_domain_1 = require("../common/channel-domain");
const record_link_1 = require("../common/record-link");
const instance_access_1 = require("../common/instance-access");
const tags_1 = require("../common/tags");
const folder_meta_service_1 = require("./folder-meta.service");
const FILE_PW_COOKIE = 'gohub_fpw';
function splitCsv(v) {
    return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
function wildcardParam(req) {
    const raw = String(req.params['0'] ?? '');
    if (!raw)
        return '';
    if (!/%[0-9a-fA-F]{2}/.test(raw))
        return raw;
    try {
        return decodeURIComponent(raw);
    }
    catch {
        return raw;
    }
}
function dirAllowed(dir, allowed) {
    if (!allowed.length)
        return true;
    const norm = (s) => s.trim().replace(/^\/+/, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');
    const target = norm(dir || '');
    return allowed.some((a) => {
        const base = norm(a);
        if (!base)
            return true;
        return target === base || target.startsWith(`${base}/`);
    });
}
function frontendAsset(...segments) {
    const base = (0, project_paths_1.frontendAppDir)();
    if (!base)
        return null;
    const p = (0, node_path_1.join)(base, ...segments);
    if ((0, node_fs_1.existsSync)(p))
        return p;
    return null;
}
const DAY_MS = 86400000;
const pad2 = (n) => String(n).padStart(2, '0');
function parseDayMs(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    if (!m)
        return NaN;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function isoDayMs(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
let LinkController = class LinkController {
    settings;
    channels;
    sysConfig;
    constructor(settings, channels, sysConfig) {
        this.settings = settings;
        this.channels = channels;
        this.sysConfig = sysConfig;
    }
    domainAllowed(req, allowedDomains) {
        const referer = req.headers.referer;
        if (!referer)
            return true;
        let host = '';
        try {
            host = new URL(String(referer)).hostname.toLowerCase();
        }
        catch {
            return false;
        }
        const domains = String(allowedDomains || '')
            .split(/[\n,;]+/)
            .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/[/:].*$/, ''))
            .filter(Boolean);
        if (domains.length === 0)
            return true;
        const self = String(req.headers.host || '').split(':')[0].toLowerCase();
        if (self && !domains.includes(self))
            domains.push(self);
        return domains.some((raw) => {
            if (raw.startsWith('*.')) {
                const base = raw.slice(2);
                return host === base || host.endsWith(`.${base}`);
            }
            if (raw.includes('.'))
                return host === raw || host.endsWith(`.${raw}`);
            return host.includes(raw);
        });
    }
    async readFallback() {
        try {
            const security = await this.sysConfig.get('security');
            const a = security?.access || {};
            return {
                enabled: a.fallbackEnabled === true && !!String(a.fallbackUrl || '').trim(),
                type: a.fallbackType === 'redirect' ? 'redirect' : 'image',
                url: String(a.fallbackUrl || '').trim(),
            };
        }
        catch {
            return { enabled: false, type: 'image', url: '' };
        }
    }
    async serveFallback(res, isHead, fallback) {
        const cfg = await this.readFallback();
        if (!cfg.enabled) {
            fallback();
            return;
        }
        res.setHeader('Cache-Control', 'no-cache, max-age=0');
        if (cfg.type === 'redirect') {
            res.redirect(302, cfg.url);
            return;
        }
        try {
            const resp = await fetch(cfg.url, { signal: AbortSignal.timeout(8000) });
            if (!resp.ok || !resp.body)
                throw new Error(`HTTP ${resp.status}`);
            const type = resp.headers.get('content-type') || 'image/png';
            res.setHeader('Content-Type', type);
            res.status(200);
            if (isHead) {
                res.end();
                return;
            }
            node_stream_1.Readable.fromWeb(resp.body).pipe(res);
            return;
        }
        catch (err) {
            app_log_1.appLog.warn('file', `失效替换图片加载失败：${err.message}`, cfg.url);
            if (!res.headersSent)
                res.status(404).send('Not Found');
        }
    }
    renderBlocked(res, kind) {
        const asset = kind === 'block' ? 'BlockImg.png' : 'WhiteListOn.png';
        const page = kind === 'block' ? '/blockimg' : '/whiteliston';
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const local = frontendAsset('static', 'media', asset);
        if (local) {
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Content-Disposition', 'inline');
            res.status(403);
            return res.sendFile(local);
        }
        return res.redirect(302, page);
    }
    async checkAccess(req, res, record) {
        const metas = (0, file_view_1.safeParse)(record.metas);
        const listType = metas.ListType || 'None';
        if (req.query.from === 'admin') {
            const session = (0, auth_guard_1.parseSession)(req.cookies?.[auth_guard_1.SESSION_COOKIE]);
            const mine = !!session?.user && session.user === (record.uploader || '');
            let sharedToMe = false;
            if (!(0, auth_guard_1.isAdminRole)(session?.role) && !mine && session?.user) {
                const hit = await (0, folder_meta_service_1.folderSharedWithUser)(record.folder, record.instanceId, session.user);
                sharedToMe = hit.shared;
            }
            if (!(0, auth_guard_1.isAdminRole)(session?.role) && !mine && !sharedToMe) {
                res.setHeader('Cache-Control', 'private, no-store, max-age=0');
                res.status(401).send('Admin authentication required');
                return false;
            }
            res.setHeader('Cache-Control', 'private, max-age=86400');
            return true;
        }
        const isHead = String(req.method).toUpperCase() === 'HEAD';
        if (listType === 'Block' || metas.Label === 'adult') {
            await this.serveFallback(res, isHead, () => this.renderBlocked(res, 'block'));
            return false;
        }
        if (!(await this.linkAllowed(record.uploader))) {
            app_log_1.appLog.info('file', `链接权限已关闭，拒绝访问：${String(record.name || '')}`);
            await this.serveFallback(res, isHead, () => this.renderBlocked(res, 'block'));
            return false;
        }
        if (listType === 'White')
            return true;
        const security = (await this.sysConfig.get('security'));
        const access = security?.access || {};
        if (access.whiteListMode && !this.domainAllowed(req, access.allowedDomains)) {
            app_log_1.appLog.info('file', `白名单域名拒绝：referer=${String(req.headers.referer || '-')} path=${req.path}`);
            await this.serveFallback(res, isHead, () => this.renderBlocked(res, 'white'));
            return false;
        }
        return true;
    }
    verifiedPwHashes(req) {
        try {
            const raw = req.cookies?.[FILE_PW_COOKIE];
            const arr = typeof raw === 'string' ? JSON.parse(decodeURIComponent(raw)) : raw;
            return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)) : [];
        }
        catch {
            return [];
        }
    }
    linkCache = new Map();
    async linkAllowed(uploader) {
        const u = String(uploader || '').trim();
        if (!u)
            return true;
        const hit = this.linkCache.get(u);
        const now = Date.now();
        if (hit && now - hit.at < 10_000)
            return hit.allowed;
        let allowed = true;
        try {
            const row = await prisma_1.prisma.user.findUnique({ where: { username: u }, select: { linkEnabled: true } });
            if (row)
                allowed = row.linkEnabled !== false;
        }
        catch {
            allowed = true;
        }
        this.linkCache.set(u, { allowed, at: now });
        return allowed;
    }
    absolutize(req, target) {
        const t = String(target || '').trim();
        if (!t)
            return '';
        if (/^https?:\/\//i.test(t))
            return t;
        const origin = (0, request_origin_1.signOrigin)(req);
        return t.startsWith('/') ? `${origin}${t}` : `${origin}/${t}`;
    }
    async sendLocalFile(req, res, abs, record) {
        const thumbRaw = String(req.query.thumb ?? '').trim();
        if (thumbRaw) {
            const ext = (0, file_view_1.fileExtOf)(record.originalName || record.name, record.mime || '').toLowerCase().replace(/^\./, '');
            if (['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(ext)) {
                try {
                    const n = Number(thumbRaw);
                    const w = Number.isFinite(n) && n > 0 ? Math.min(640, Math.max(64, Math.round(n))) : 320;
                    const key = (0, thumb_cache_1.thumbCacheKey)({
                        source: abs,
                        version: (0, thumb_cache_1.sourceFingerprint)(abs),
                        width: w,
                        fit: 'cover',
                    });
                    const types = {
                        jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif',
                    };
                    const data = await (0, thumb_cache_1.withThumbCache)(key, types[ext === 'jpg' ? 'jpeg' : ext] || 'image/jpeg', async () => {
                        const out = await (0, sharp_1.default)(abs).resize({ width: w, fit: 'cover' }).toBuffer({ resolveWithObject: true });
                        return out.data;
                    });
                    const outType = types[ext === 'jpg' ? 'jpeg' : ext] || 'image/jpeg';
                    res.setHeader('Content-Type', outType);
                    res.setHeader('Content-Length', String(data.length));
                    if (!res.getHeader('Cache-Control')) {
                        res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
                    }
                    res.setHeader('X-Imgbed-Transformed', '1');
                    return res.end(data);
                }
                catch {
                }
            }
        }
        let stat;
        try {
            stat = (0, node_fs_1.statSync)(abs);
        }
        catch {
            return res.status(404).send('Not Found');
        }
        const total = stat.size;
        const mime = record.mime || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.setHeader('Accept-Ranges', 'bytes');
        if (!res.getHeader('Cache-Control')) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
        const range = String(req.headers['range'] || '');
        if (range) {
            const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
            if (m) {
                let start = m[1] ? Number(m[1]) : NaN;
                let end = m[2] ? Number(m[2]) : NaN;
                if (Number.isNaN(start)) {
                    if (Number.isNaN(end) || end <= 0) {
                        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
                        return;
                    }
                    start = Math.max(0, total - end);
                    end = total - 1;
                }
                else {
                    if (Number.isNaN(end))
                        end = total - 1;
                    end = Math.min(end, total - 1);
                }
                if (start > end || start >= total) {
                    res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
                    return;
                }
                res.status(206);
                res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
                res.setHeader('Content-Length', String(end - start + 1));
                (0, node_fs_1.createReadStream)(abs, { start, end }).on('error', () => res.end()).pipe(res);
                return;
            }
        }
        const etag = `W/"${total.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
        const lastModified = new Date(stat.mtimeMs).toUTCString();
        res.setHeader('ETag', etag);
        res.setHeader('Last-Modified', lastModified);
        if (!range) {
            const inm = String(req.headers['if-none-match'] || '').trim();
            const ims = String(req.headers['if-modified-since'] || '').trim();
            const etagHit = inm && inm.split(',').some((v) => v.trim() === etag || v.trim() === '*');
            const timeHit = !inm && ims && Date.parse(ims) >= Math.floor(stat.mtimeMs / 1000) * 1000;
            if (etagHit || timeHit) {
                res.status(304);
                res.removeHeader('Content-Length');
                return res.end();
            }
        }
        res.setHeader('Content-Length', String(total));
        (0, node_fs_1.createReadStream)(abs).on('error', () => res.end()).pipe(res);
    }
    async proxyStream(req, res, candidates, extraHeaders) {
        const timeoutMs = Number(await this.settings.get('proxyTimeoutMs', '15000')) || 15000;
        const cacheSeconds = Number(await this.settings.get('proxyCacheSeconds', '86400')) || 86400;
        const range = req.headers['range'];
        let lastErr = '';
        for (const cand of candidates) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            const onClose = () => ctrl.abort();
            req.on('close', onClose);
            try {
                const headers = { 'User-Agent': 'GoHub-proxy', ...(extraHeaders || {}) };
                if (range)
                    headers['Range'] = String(range);
                const inmReq = String(req.headers['if-none-match'] || '').trim();
                const imsReq = String(req.headers['if-modified-since'] || '').trim();
                if (inmReq)
                    headers['If-None-Match'] = inmReq;
                else if (imsReq)
                    headers['If-Modified-Since'] = imsReq;
                const upstream = await fetch(cand.url, { headers, signal: ctrl.signal, redirect: 'follow' });
                if (upstream.status === 304) {
                    for (const h of ['etag', 'last-modified', 'cache-control']) {
                        const v = upstream.headers.get(h);
                        if (v)
                            res.setHeader(h, v);
                    }
                    clearTimeout(timer);
                    req.off('close', onClose);
                    res.status(304).end();
                    return;
                }
                if (!upstream.ok && upstream.status !== 206) {
                    lastErr = `${cand.label} → HTTP ${upstream.status}`;
                    clearTimeout(timer);
                    req.off('close', onClose);
                    continue;
                }
                for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
                    const v = upstream.headers.get(h);
                    if (v)
                        res.setHeader(h, v);
                }
                const upstreamCC = upstream.headers.get('cache-control');
                res.setHeader('Cache-Control', upstreamCC || `public, max-age=${cacheSeconds}, immutable`);
                res.setHeader('X-Imgbed-Source', encodeURIComponent(cand.label));
                res.status(upstream.status);
                if (!upstream.body) {
                    clearTimeout(timer);
                    req.off('close', onClose);
                    return res.end();
                }
                const nodeStream = node_stream_1.Readable.fromWeb(upstream.body);
                nodeStream.on('error', () => { try {
                    res.end();
                }
                catch { } });
                res.on('close', () => { try {
                    nodeStream.destroy();
                }
                catch { } });
                nodeStream.pipe(res);
                return;
            }
            catch (err) {
                clearTimeout(timer);
                req.off('close', onClose);
                lastErr = `${cand.label} → ${err.message}`;
                continue;
            }
        }
        return res.status(502).send(`上游图床不可用：${lastErr}`);
    }
    async resolveImageTransform(req) {
        const widthRaw = String(req.query.width ?? '').trim();
        const heightRaw = String(req.query.height ?? '').trim();
        const fitRaw = String(req.query.fit ?? '').trim().toLowerCase();
        const thumbRaw = String(req.query.thumb ?? '').trim();
        if (thumbRaw) {
            const n = Number(thumbRaw);
            const w = Number.isFinite(n) && n > 0 ? Math.min(640, Math.max(64, Math.round(n))) : 320;
            return { width: w, fit: 'cover' };
        }
        if (!widthRaw && !heightRaw && !fitRaw)
            return {};
        const access = (await this.sysConfig.get('security'))?.access || {};
        if (access.imageTransformEnabled !== true)
            return {};
        let fit = '';
        if (fitRaw) {
            if (!['cover', 'contain', 'fill', 'inside', 'outside'].includes(fitRaw)) {
                return { error: 'fit 参数不合法（cover / contain / fill / inside / outside）' };
            }
            fit = fitRaw;
        }
        const parseDim = (raw) => {
            if (!raw)
                return undefined;
            if (/^auto$/i.test(raw))
                return 'auto';
            const n = Number(raw);
            if (!Number.isInteger(n) || n < 1 || n > 4096)
                return undefined;
            return n;
        };
        const width = parseDim(widthRaw);
        const height = parseDim(heightRaw);
        if (widthRaw && width === undefined)
            return { error: 'width 参数不合法（1-4096 的整数或 auto）' };
        if (heightRaw && height === undefined)
            return { error: 'height 参数不合法（1-4096 的整数或 auto）' };
        const allowed = String(access.imageTransformAllowedSizes || '').trim();
        if (allowed) {
            const list = allowed.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
            const key = `${width ?? 'auto'}x${height ?? 'auto'}`;
            if (!list.includes(key))
                return { error: `该尺寸不在允许列表内（${list.join('、')}）` };
        }
        return { width, height, fit };
    }
    async serveTransformedImage(res, candidates, t, longCache = false) {
        const timeoutMs = Number(await this.settings.get('proxyTimeoutMs', '15000')) || 15000;
        let lastErr = '';
        for (const cand of candidates) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            try {
                const cacheKey = longCache
                    ? (0, thumb_cache_1.thumbCacheKey)({
                        source: cand.url,
                        version: 'remote',
                        width: t.width,
                        height: t.height,
                        fit: t.fit || 'cover',
                    })
                    : '';
                if (cacheKey) {
                    const hit = (0, thumb_cache_1.readThumb)(cacheKey);
                    if (hit) {
                        res.setHeader('Content-Type', hit.type);
                        res.setHeader('Content-Length', String(hit.data.length));
                        res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
                        res.setHeader('X-Imgbed-Transformed', '1');
                        res.setHeader('X-Imgbed-Cache', 'hit');
                        return res.end(hit.data);
                    }
                }
                const upstream = await fetch(cand.url, {
                    headers: { 'User-Agent': 'GoHub-proxy' },
                    signal: ctrl.signal,
                    redirect: 'follow',
                });
                if (!upstream.ok) {
                    lastErr = `${cand.label} → HTTP ${upstream.status}`;
                    continue;
                }
                const buf = Buffer.from(await upstream.arrayBuffer());
                const option = { fit: t.fit || 'cover' };
                if (typeof t.width === 'number')
                    option.width = t.width;
                if (typeof t.height === 'number')
                    option.height = t.height;
                const out = await (0, sharp_1.default)(buf).resize(option).toBuffer({ resolveWithObject: true });
                const types = {
                    jpeg: 'image/jpeg',
                    png: 'image/png',
                    webp: 'image/webp',
                    avif: 'image/avif',
                };
                res.setHeader('Content-Type', types[out.info.format] || 'application/octet-stream');
                res.setHeader('Content-Length', String(out.data.length));
                res.setHeader('Cache-Control', longCache ? 'public, max-age=2592000, immutable' : 'public, max-age=3600');
                res.setHeader('X-Imgbed-Transformed', '1');
                if (cacheKey)
                    (0, thumb_cache_1.writeThumb)(cacheKey, out.data, types[out.info.format] || 'image/jpeg');
                return res.end(out.data);
            }
            catch (err) {
                lastErr = `${cand.label} → ${err.message}`;
            }
            finally {
                clearTimeout(timer);
            }
        }
        return res.status(502).send(`图片处理失败：${lastErr}`);
    }
    async serve(req, res) {
        const name = wildcardParam(req);
        const isHead = String(req.method).toUpperCase() === 'HEAD';
        const nameCandidates = [];
        const pushName = (v) => {
            const s = String(v || '').replace(/^\/+/, '');
            if (!s)
                return;
            if (!nameCandidates.includes(s))
                nameCandidates.push(s);
            const b = s.replace(/\.[^.]*$/, '');
            if (b && b !== s && !nameCandidates.includes(b))
                nameCandidates.push(b);
        };
        pushName(name);
        let rest = name;
        while (rest.includes('/')) {
            rest = rest.slice(rest.indexOf('/') + 1);
            pushName(rest);
        }
        const adminPreview = req.query.from === 'admin';
        const record = await prisma_1.prisma.fileRecord.findFirst({
            where: { ...(adminPreview ? {} : { status: 'active' }), OR: nameCandidates.map((n) => ({ name: n })) },
            include: { copies: true },
        });
        if (!record) {
            await this.serveFallback(res, isHead, () => res.status(404).send('Not Found'));
            return;
        }
        if (record.linkExpiresAt && !adminPreview && !(0, auth_guard_1.isAdminRole)((0, auth_guard_1.currentSession)(req)?.role) && Date.now() > record.linkExpiresAt.getTime()) {
            res.setHeader('Cache-Control', 'no-store');
            await this.serveFallback(res, isHead, () => res.status(410).send('链接已过期'));
            return;
        }
        if (!(await this.checkAccess(req, res, record)))
            return;
        if (!adminPreview) {
            const needHashes = await (0, folder_meta_service_1.requiredPasswordHashes)(record);
            if (needHashes.length) {
                const clientHashes = new Set(this.verifiedPwHashes(req));
                const pwRaw = String(req.query.pw ?? '');
                let matchedByParam = false;
                if (pwRaw) {
                    const given = (0, folder_meta_service_1.sha256Hex)(pwRaw);
                    if (needHashes.includes(given)) {
                        clientHashes.add(given);
                        matchedByParam = true;
                    }
                }
                if (needHashes.some((h) => clientHashes.has(h))) {
                    if (matchedByParam) {
                        res.setHeader('Set-Cookie', `${FILE_PW_COOKIE}=${encodeURIComponent(JSON.stringify(Array.from(clientHashes)))}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`);
                    }
                }
                else {
                    if ((0, folder_meta_service_1.shouldLogPasswordFailure)(record.name, req.ip || '')) {
                        app_log_1.appLog.warn('file', `外链密码验证失败：${record.name}`, '来源=文件自身密码', req.ip || '');
                    }
                    res.setHeader('Cache-Control', 'no-store');
                    res.status(401).send('需要密码：请通过 ?pw=<密码> 访问该文件');
                    return;
                }
            }
        }
        if (req.query.from !== 'admin') {
            void prisma_1.prisma.fileRecord
                .update({ where: { id: record.id }, data: { views: { increment: 1 } } })
                .catch(() => undefined);
        }
        if (record.redirectUrl) {
            const target = String(record.redirectUrl).trim();
            const abs = this.absolutize(req, target);
            const selfKey = decodeURIComponent(abs.split('?')[0].replace(/^.*\/file\//, '').replace(/\.[^.]*$/, ''));
            if (selfKey && (selfKey === record.name || selfKey === record.id)) {
                return res.status(404).send('Not Found');
            }
            const depth = Number(req.headers['x-gohub-redirect-depth'] || 0) || 0;
            if (depth >= 3)
                return res.status(508).send('重定向链路过长');
            res.setHeader('Cache-Control', 'no-cache, max-age=0');
            return this.proxyStream(req, res, [{ url: abs, label: 'redirect' }], {
                'X-Imgbed-Redirect-Depth': String(depth + 1),
            });
        }
        const prefer = await this.settings.getAccessChannel();
        let active = record.copies.filter((c) => c.status === 'active' && (c.remoteKey || c.remoteUrl || c.objectPath));
        if (active.length === 0) {
            app_log_1.appLog.warn('file', `外链取源失败：文件没有可用的渠道副本（404）`, `文件=${record.name} ｜ 副本数=${record.copies.length} ｜ 状态=${record.copies
                .map((c) => `${c.status}/${c.remoteKey ? 'key' : c.objectPath ? 'path' : 'none'}`)
                .join(',') || '无'}`, req.ip || '');
            await this.serveFallback(res, isHead, () => res.status(404).send('Not Found'));
            return;
        }
        const forceChannel = String(req.query.channel || '').trim();
        if (forceChannel) {
            active = active.filter((c) => c.channelId === forceChannel);
            if (active.length === 0) {
                await this.serveFallback(res, isHead, () => res.status(404).send('Not Found'));
                return;
            }
        }
        const channelIds = active.map((c) => c.channelId);
        const channels = await prisma_1.prisma.channel.findMany({ where: { id: { in: channelIds } } });
        const preferList = prefer === 'backup' ? ['backup', 'primary', 'main'] : ['primary', 'main', 'backup'];
        const enabledIds = new Set(channels.filter((c) => c.enabled).map((c) => c.id));
        const ordered = [];
        const roleOf = (channelId) => {
            const ch = channels.find((x) => x.id === channelId);
            if (!ch)
                return '';
            if (ch.isBackup)
                return 'backup';
            if (ch.isMain)
                return 'main';
            return '';
        };
        const byRole = (role, enabledOnly = false) => {
            for (const c of active) {
                if (ordered.includes(c))
                    continue;
                if (role === 'primary' ? !c.isPrimary : roleOf(c.channelId) !== role)
                    continue;
                if (enabledOnly && !enabledIds.has(c.channelId))
                    continue;
                ordered.push(c);
            }
        };
        for (const role of preferList)
            byRole(role, true);
        for (const c of active) {
            if (!ordered.includes(c) && enabledIds.has(c.channelId))
                ordered.push(c);
        }
        for (const role of preferList)
            byRole(role);
        for (const c of active)
            if (!ordered.includes(c))
                ordered.push(c);
        const candidates = [];
        const mode = await this.settings.getLinkMode();
        const preferInternal = mode !== 'redirect';
        for (const copy of ordered) {
            const ch = channels.find((c) => c.id === copy.channelId);
            if (!ch)
                continue;
            const absoluteRemote = /^https?:\/\//i.test(String(copy.remoteUrl || '')) ? String(copy.remoteUrl) : '';
            if (ch.type === 'local') {
                if (absoluteRemote) {
                    candidates.push({ url: absoluteRemote, label: ch.name });
                    continue;
                }
                if ((0, file_view_1.isRecordFile)(record) && copy.objectPath) {
                    const q = String(copy.urlQuery || '').trim();
                    candidates.push({
                        url: `${(0, request_origin_1.signOrigin)(req)}/${String(copy.objectPath).replace(/^\/+/, '')}${q ? `?${q}` : ''}`,
                        label: ch.name,
                    });
                    continue;
                }
                if (candidates.length > 0)
                    continue;
                const abs = await (0, local_adapter_1.localFileAbsOf)(copy.remoteKey);
                if (!abs)
                    continue;
                return this.sendLocalFile(req, res, abs, record);
            }
            const info = {
                id: ch.id,
                name: ch.name,
                type: ch.type,
                config: this.channels.decryptConfig(ch.type, ch.config),
                metas: {},
            };
            if (!absoluteRemote && copy.objectPath && (0, file_view_1.isRecordFile)(record)) {
                const recordDynamic = (0, adapter_factory_1.createAdapter)(info).buildDirectUrl((0, adapter_factory_1.toCopyInfo)(copy), info, preferInternal);
                if (recordDynamic) {
                    candidates.push({ url: recordDynamic, label: ch.name });
                    continue;
                }
            }
            if (!absoluteRemote && copy.remoteKey && (0, file_view_1.isRecordFile)(record) && (0, record_link_1.hasRecordDomains)(info.config, ch.type)) {
                const recordUrl = (0, record_link_1.joinRecordUrl)((0, record_link_1.recordLoadOrigin)(info.config, preferInternal, ch.type), (0, channel_domain_1.ensureBucketInKey)(ch.type, info.config, copy.remoteKey));
                if (recordUrl) {
                    candidates.push({ url: recordUrl, label: ch.name });
                    continue;
                }
            }
            const dynamicUrl = (0, adapter_factory_1.createAdapter)(info).buildDirectUrl((0, adapter_factory_1.toCopyInfo)(copy), info, preferInternal);
            const url = dynamicUrl || (absoluteRemote && ch.type !== 'custom' ? absoluteRemote : '');
            if (url)
                candidates.push({ url, label: ch.name });
        }
        if (candidates.length === 0) {
            await this.serveFallback(res, isHead, () => res.status(404).send('Not Found'));
            return;
        }
        const t = await this.resolveImageTransform(req);
        if (t.error)
            return res.status(400).send(t.error);
        const imgExt = (0, file_view_1.fileExtOf)(record.originalName || record.name, record.mime || '').toLowerCase().replace(/^\./, '');
        const scalable = ['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(imgExt);
        const wantThumb = String(req.query.thumb ?? '').trim() !== '';
        if ((t.width || t.height) && scalable && (preferInternal || wantThumb)) {
            return this.serveTransformedImage(res, candidates, t, wantThumb);
        }
        if (preferInternal)
            return this.proxyStream(req, res, candidates);
        res.setHeader('Cache-Control', 'no-cache, max-age=0');
        return res.redirect(302, candidates[0].url);
    }
    sessionUser(req) {
        return (0, auth_guard_1.currentSession)(req)?.user || '';
    }
    sessionAdmin(req) {
        return (0, auth_guard_1.isAdminRole)((0, auth_guard_1.currentSession)(req)?.role);
    }
    async getFolderMeta(req, q) {
        const path = (0, folder_meta_service_1.normalizeFolderPath)(q.path);
        if (!path)
            return { success: false, message: '缺少 path' };
        const row = await (0, folder_meta_service_1.findFolderMeta)(path, String(q.instanceId ?? ''));
        if (!row)
            return { exists: false };
        const me = this.sessionUser(req);
        const admin = this.sessionAdmin(req);
        const shared = (0, folder_meta_service_1.parseSharedUsers)(row.sharedUsers).includes(me);
        if (!admin && row.owner !== me && !shared) {
            return { exists: false, forbidden: true };
        }
        return { exists: true, meta: (0, folder_meta_service_1.serializeFolderMeta)(row, { hideNote: !admin && row.owner !== me }) };
    }
    async saveFolderMeta(req, body) {
        const path = (0, folder_meta_service_1.normalizeFolderPath)(body?.path);
        if (!path)
            return { success: false, message: '缺少 path' };
        const me = this.sessionUser(req);
        if (!me)
            return { success: false, message: '未登录' };
        const instanceId = String(body?.instanceId ?? '');
        let row = await (0, folder_meta_service_1.findFolderMeta)(path, instanceId, me);
        const metasObj = row ? (0, file_view_1.safeParse)(row.metas) : {};
        if (body?.name !== undefined)
            metasObj.displayName = String(body.name || '').slice(0, 200);
        const metasJson = JSON.stringify(metasObj);
        let passwordHash = row?.passwordHash || '';
        if (body?.password !== undefined) {
            passwordHash = String(body.password || '') ? (0, folder_meta_service_1.sha256Hex)(String(body.password)) : '';
        }
        let sharedUsers = row?.sharedUsers || '[]';
        if (body?.sharedUsers !== undefined) {
            const list = Array.isArray(body.sharedUsers)
                ? body.sharedUsers
                : String(body.sharedUsers).split(',');
            sharedUsers = JSON.stringify(Array.from(new Set(list.map((s) => String(s || '').trim()).filter(Boolean))));
        }
        const sharedPerm = body?.sharedPerm !== undefined ? (0, folder_meta_service_1.normalizeSharedPerm)(body.sharedPerm) : (0, folder_meta_service_1.normalizeSharedPerm)(row?.sharedPerm);
        const gallery = body?.gallery === undefined ? (row?.gallery ?? false) : body.gallery === true || body.gallery === 'true';
        if (row) {
            row = await prisma_1.prisma.folderMeta.update({
                where: { id: row.id },
                data: {
                    passwordHash,
                    note: body?.note !== undefined ? String(body.note || '').slice(0, 4000) : row.note,
                    sharedUsers,
                    sharedPerm,
                    metas: metasJson,
                    gallery,
                },
            });
        }
        else {
            row = await prisma_1.prisma.folderMeta.create({
                data: {
                    owner: me,
                    path,
                    instanceId,
                    type: folder_meta_service_1.FOLDER_TYPE_FILE,
                    passwordHash,
                    note: String(body?.note || '').slice(0, 4000),
                    sharedUsers,
                    sharedPerm,
                    metas: metasJson,
                    gallery,
                },
            });
        }
        let galleryDirs;
        if (body?.gallery !== undefined || gallery) {
            try {
                galleryDirs = await (0, folder_meta_service_1.setGalleryPath)(this.sysConfig, path, gallery);
            }
            catch (err) {
                app_log_1.appLog.warn('file', `访客图库白名单更新失败：${path}`, err.message);
            }
        }
        app_log_1.appLog.info('file', `目录属性已保存：${path}`, `实例=${instanceId || '默认'} ｜ 加密=${!!passwordHash} ｜ 共享=${(0, folder_meta_service_1.parseSharedUsers)(sharedUsers).length}人(${sharedPerm}) ｜ 访客图库=${gallery}`);
        return { success: true, meta: (0, folder_meta_service_1.serializeFolderMeta)(row), galleryDirs };
    }
    async deleteFolderMeta(req, q) {
        const path = (0, folder_meta_service_1.normalizeFolderPath)(q.path);
        if (!path)
            return { success: false, message: '缺少 path' };
        const row = await (0, folder_meta_service_1.findFolderMeta)(path, String(q.instanceId ?? ''));
        if (!row)
            return { success: false, message: '目录属性不存在' };
        const me = this.sessionUser(req);
        if (!this.sessionAdmin(req) && row.owner !== me) {
            return { success: false, message: '只有目录归属者或管理员可以删除目录属性' };
        }
        if (row.gallery) {
            try {
                await (0, folder_meta_service_1.setGalleryPath)(this.sysConfig, row.path, false);
            }
            catch {
            }
        }
        await prisma_1.prisma.folderMeta.delete({ where: { id: row.id } });
        app_log_1.appLog.info('file', `目录属性已删除：${path}`, `owner=${row.owner}`);
        return { success: true };
    }
    async sharedFolders(req, q) {
        const list = await (0, folder_meta_service_1.listSharedFoldersFor)(this.sessionUser(req), String(q.instanceId ?? ''));
        return { success: true, data: list };
    }
    async tagsManage(req, q) {
        const instanceId = String(q.instanceId ?? '');
        const me = this.sessionUser(req);
        if (!me)
            return { success: true, data: [] };
        const tags = await prisma_1.prisma.tag.findMany({
            where: { instanceId, type: tags_1.TAG_TYPE_FILE },
            orderBy: { createdAt: 'asc' },
        });
        const links = await prisma_1.prisma.fileTag.findMany({
            where: { tagId: { in: tags.map((t) => t.id) } },
            select: { tagId: true, file: { select: { status: true } } },
        });
        const counts = new Map();
        for (const l of links) {
            if ((l.file?.status || 'active') === 'active')
                counts.set(l.tagId, (counts.get(l.tagId) || 0) + 1);
        }
        const items = tags.map((t) => ({
            id: t.id,
            name: t.name,
            count: counts.get(t.id) || 0,
            encrypted: !!(0, file_view_1.safeParse)(t.metas).passwordHash,
            note: String((0, file_view_1.safeParse)(t.metas).note || ''),
            creator: t.owner || '',
            mine: String(t.owner || '') === me,
            createdAt: t.createdAt,
        }));
        const order = String(q.order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
        const sort = String(q.sort || 'createdAt');
        items.sort((a, b) => {
            if (sort === 'name')
                return a.name.localeCompare(b.name) * order;
            if (sort === 'count')
                return (a.count - b.count) * order;
            return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * order;
        });
        return { success: true, data: items };
    }
    async tagUpdate(req, id, body) {
        const tag = await prisma_1.prisma.tag.findUnique({ where: { id } });
        if (!tag)
            return { success: false, message: '标签不存在' };
        if (!(await this.canAccessInstance(req, tag.instanceId))) {
            return { success: false, message: '无权操作该实例下的标签' };
        }
        if (!this.canEditTag(req, tag))
            return { success: false, message: '无权修改其他账户的标签' };
        const data = {};
        if (body?.name !== undefined) {
            const name = String(body.name || '').trim();
            if (!name)
                return { success: false, message: '标签名不能为空' };
            if (name !== tag.name) {
                const dup = await prisma_1.prisma.tag.findFirst({
                    where: { name, instanceId: tag.instanceId, type: tag.type || tags_1.TAG_TYPE_FILE, NOT: { id } },
                });
                if (dup)
                    return { success: false, message: `同实例下已存在标签「${name}」` };
                data.name = name;
            }
        }
        if (body?.note !== undefined) {
            const metas = (0, file_view_1.safeParse)(data.metas ? data.metas : tag.metas);
            const note = String(body.note || '').slice(0, 2000);
            if (note)
                metas.note = note;
            else
                delete metas.note;
            data.metas = JSON.stringify(metas);
        }
        if (body?.password !== undefined) {
            const metas = (0, file_view_1.safeParse)(data.metas ? data.metas : tag.metas);
            if (String(body.password || ''))
                metas.passwordHash = (0, folder_meta_service_1.sha256Hex)(String(body.password));
            else
                delete metas.passwordHash;
            data.metas = JSON.stringify(metas);
        }
        const updated = await prisma_1.prisma.tag.update({ where: { id }, data });
        app_log_1.appLog.info('file', `标签已更新：${tag.name} → ${updated.name}`, `加密=${!!(0, file_view_1.safeParse)(updated.metas).passwordHash}`);
        return {
            success: true,
            data: {
                id: updated.id,
                name: updated.name,
                encrypted: !!(0, file_view_1.safeParse)(updated.metas).passwordHash,
                note: String((0, file_view_1.safeParse)(updated.metas).note || ''),
            },
        };
    }
    async tagDelete(req, id) {
        const tag = await prisma_1.prisma.tag.findUnique({ where: { id } });
        if (!tag)
            return { success: false, message: '标签不存在' };
        if (!(await this.canAccessInstance(req, tag.instanceId))) {
            return { success: false, message: '无权操作该实例下的标签' };
        }
        if (!this.canEditTag(req, tag))
            return { success: false, message: '无权删除其他账户的标签' };
        await prisma_1.prisma.tag.delete({ where: { id } });
        app_log_1.appLog.info('file', `标签已删除：${tag.name}`, `实例=${tag.instanceId || '默认'}`);
        return { success: true };
    }
    async tagsMerge(req, body) {
        const sourceIds = Array.isArray(body?.sourceIds) ? body.sourceIds.map(String).filter(Boolean) : [];
        if (!sourceIds.length)
            return { success: false, message: '缺少 sourceIds' };
        const sources = await prisma_1.prisma.tag.findMany({ where: { id: { in: sourceIds } } });
        if (!sources.length)
            return { success: false, message: '源标签不存在' };
        if (sources.some((s) => !this.canEditTag(req, s))) {
            return { success: false, message: '无权合并其他账户的标签' };
        }
        const sourceIdSet = new Set(sources.map((s) => s.id));
        const instanceId = sources[0].instanceId;
        const owner = String(sources[0].owner || '');
        const tagType = String(sources[0].type || tags_1.TAG_TYPE_FILE);
        if (sources.some((t) => String(t.type || tags_1.TAG_TYPE_FILE) !== tagType)) {
            return { success: false, message: '不同类型（文件标签 / 笔记标签）的标签不能合并' };
        }
        let target = null;
        if (body?.targetId) {
            const row = await prisma_1.prisma.tag.findUnique({ where: { id: String(body.targetId) } });
            if (row && this.canEditTag(req, row))
                target = { id: row.id, name: row.name };
        }
        if (!target) {
            const name = String(body?.targetName || '').trim();
            if (!name)
                return { success: false, message: '缺少 targetId 或 targetName' };
            const row = await (0, tags_1.findOrCreateTag)(name, instanceId, this.sessionUser(req), tagType);
            target = { id: row.id, name: row.name };
        }
        if (sourceIdSet.has(target.id))
            return { success: false, message: '目标标签不能同时是源标签' };
        let moved = 0;
        if (tagType === 'note') {
            for (const sid of sourceIdSet) {
                const links = await prisma_1.prisma.noteTag.findMany({ where: { tagId: sid } });
                for (const link of links) {
                    const exists = await prisma_1.prisma.noteTag.findUnique({
                        where: { noteId_tagId: { noteId: link.noteId, tagId: target.id } },
                    });
                    if (exists)
                        await prisma_1.prisma.noteTag.delete({ where: { noteId_tagId: { noteId: link.noteId, tagId: sid } } });
                    else {
                        await prisma_1.prisma.noteTag.update({
                            where: { noteId_tagId: { noteId: link.noteId, tagId: sid } },
                            data: { tagId: target.id },
                        });
                        moved += 1;
                    }
                }
            }
        }
        else {
            for (const sid of sourceIdSet) {
                const links = await prisma_1.prisma.fileTag.findMany({ where: { tagId: sid } });
                for (const link of links) {
                    const exists = await prisma_1.prisma.fileTag.findUnique({
                        where: { fileId_tagId: { fileId: link.fileId, tagId: target.id } },
                    });
                    if (exists)
                        await prisma_1.prisma.fileTag.delete({ where: { id: link.id } });
                    else {
                        await prisma_1.prisma.fileTag.update({ where: { id: link.id }, data: { tagId: target.id } });
                        moved += 1;
                    }
                }
            }
        }
        await prisma_1.prisma.tag.deleteMany({ where: { id: { in: Array.from(sourceIdSet) } } });
        app_log_1.appLog.info('file', `标签合并完成：${sourceIdSet.size} 个标签 → 「${target.name}」`, `迁移关联 ${moved} 条`);
        return { success: true, data: { moved, targetId: target.id, targetName: target.name } };
    }
    async canAccessInstance(req, instanceId) {
        if (this.sessionAdmin(req))
            return true;
        return (0, instance_access_1.userInInstance)(this.sessionUser(req), instanceId);
    }
    canEditTag(req, _tag) {
        return !!this.sessionUser(req);
    }
    async tagSplit(req, id, body) {
        const tag = await prisma_1.prisma.tag.findUnique({ where: { id: String(id || '') } });
        if (!tag)
            throw new common_1.NotFoundException('标签不存在');
        if (!(await this.canAccessInstance(req, tag.instanceId))) {
            throw new common_1.ForbiddenException('无权操作该实例下的标签');
        }
        if (!this.canEditTag(req, tag))
            throw new common_1.ForbiddenException('无权拆分其他账户的标签');
        const owner = String(tag.owner || '');
        const raw = Array.isArray(body?.names) ? body.names : [];
        const names = Array.from(new Set(raw
            .map((n) => String(n ?? '').trim())
            .filter(Boolean)
            .filter((n) => n !== tag.name)));
        if (!names.length)
            throw new common_1.BadRequestException('names 不能为空');
        const tagType = String(tag.type || tags_1.TAG_TYPE_FILE);
        const isNoteTag = tagType === 'note';
        const fileLinks = isNoteTag ? [] : await prisma_1.prisma.fileTag.findMany({ where: { tagId: tag.id }, select: { fileId: true } });
        const noteLinks = isNoteTag ? await prisma_1.prisma.noteTag.findMany({ where: { tagId: tag.id }, select: { noteId: true } }) : [];
        const created = [];
        let linked = 0;
        for (const name of names) {
            const target = await (0, tags_1.findOrCreateTag)(name, tag.instanceId, owner, tagType);
            created.push({ id: target.id, name: target.name });
            if (isNoteTag) {
                if (noteLinks.length) {
                    const res = await prisma_1.prisma.noteTag.createMany({
                        data: noteLinks.map((l) => ({ noteId: l.noteId, tagId: target.id })),
                        skipDuplicates: true,
                    });
                    linked += res.count;
                }
            }
            else if (fileLinks.length) {
                const res = await prisma_1.prisma.fileTag.createMany({
                    data: fileLinks.map((l) => ({ fileId: l.fileId, tagId: target.id })),
                    skipDuplicates: true,
                });
                linked += res.count;
            }
        }
        app_log_1.appLog.info('tag', `拆分标签 ${tag.name} → ${created.map((c) => c.name).join('、')}`, `复制关联 ${linked} 条（源标签 ${isNoteTag ? noteLinks.length : fileLinks.length} 条 / 实例=${tag.instanceId || '默认'}）`);
        return { success: true, created, linked };
    }
    async tagsBatchPassword(req, body) {
        const ids = Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean) : [];
        if (!ids.length)
            return { success: false, message: '缺少 ids' };
        let updated = 0;
        for (const id of ids) {
            const tag = await prisma_1.prisma.tag.findUnique({ where: { id } });
            if (!tag)
                continue;
            if (!this.canEditTag(req, tag))
                continue;
            const metas = (0, file_view_1.safeParse)(tag.metas);
            if (String(body?.password || ''))
                metas.passwordHash = (0, folder_meta_service_1.sha256Hex)(String(body.password));
            else
                delete metas.passwordHash;
            await prisma_1.prisma.tag.update({ where: { id }, data: { metas: JSON.stringify(metas) } });
            updated += 1;
        }
        app_log_1.appLog.info('file', `批量设置标签密码：${updated} 个`, String(body?.password || '') ? '设置' : '清除');
        return { success: true, data: { updated } };
    }
};
exports.LinkController = LinkController;
__decorate([
    (0, common_1.Get)('file/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LinkController.prototype, "serve", null);
__decorate([
    (0, common_1.Get)('api/folders/meta'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LinkController.prototype, "getFolderMeta", null);
__decorate([
    (0, common_1.Post)('api/folders/meta'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LinkController.prototype, "saveFolderMeta", null);
__decorate([
    (0, common_1.Delete)('api/folders/meta'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LinkController.prototype, "deleteFolderMeta", null);
__decorate([
    (0, common_1.Get)('api/folders/shared'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LinkController.prototype, "sharedFolders", null);
__decorate([
    (0, common_1.Get)('api/tags/manage'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LinkController.prototype, "tagsManage", null);
__decorate([
    (0, common_1.Patch)('api/tags/:id'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], LinkController.prototype, "tagUpdate", null);
__decorate([
    (0, common_1.Delete)('api/tags/:id'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], LinkController.prototype, "tagDelete", null);
__decorate([
    (0, common_1.Post)('api/tags/merge'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LinkController.prototype, "tagsMerge", null);
__decorate([
    (0, common_1.Post)('api/tags/:id/split'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], LinkController.prototype, "tagSplit", null);
__decorate([
    (0, common_1.Post)('api/tags/batch-password'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LinkController.prototype, "tagsBatchPassword", null);
exports.LinkController = LinkController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        channels_controller_1.ChannelsService,
        sysconfig_service_1.SysConfigService])
], LinkController);
let ManageController = ManageController_1 = class ManageController {
    settings;
    sysConfig;
    channelsSvc;
    uploadSvc;
    storageChannel;
    constructor(settings, sysConfig, channelsSvc, uploadSvc, storageChannel) {
        this.settings = settings;
        this.sysConfig = sysConfig;
        this.channelsSvc = channelsSvc;
        this.uploadSvc = uploadSvc;
        this.storageChannel = storageChannel;
    }
    admin(req) {
        return (0, auth_guard_1.isAdminRole)((0, auth_guard_1.currentSession)(req)?.role);
    }
    async filterOwned(fileIds, req) {
        const user = (0, auth_guard_1.currentSession)(req)?.user || '';
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: { uploader: user, OR: [{ id: { in: fileIds } }, { name: { in: fileIds } }] },
            select: { id: true, name: true },
        });
        const ok = new Set();
        for (const r of rows) {
            ok.add(r.id);
            ok.add(r.name);
        }
        return fileIds.filter((f) => ok.has(f));
    }
    numOrNullParam(raw, max) {
        if (raw === undefined || raw === null || String(raw) === '')
            return null;
        const n = Number(raw);
        if (!Number.isFinite(n))
            return null;
        return Math.max(0, Math.min(max, n));
    }
    async dropReadonlyShared(rows, req) {
        const me = (0, auth_guard_1.currentSession)(req)?.user || '';
        if (!rows.length || !me)
            return { ok: rows, denied: [] };
        const cache = new Map();
        const ok = [];
        const denied = [];
        for (const r of rows) {
            const folder = String(r.folder || '');
            const key = `${r.instanceId || ''}\u0000${folder}`;
            let readonly = cache.get(key);
            if (readonly === undefined) {
                const info = folder
                    ? await (0, folder_meta_service_1.folderSharedPermission)(folder, r.instanceId || '', me)
                    : { shared: false, owner: '', perm: 'edit' };
                readonly = info.shared && info.perm === 'readonly';
                cache.set(key, readonly);
            }
            if (readonly)
                denied.push(String(r.name || '').replace(/\.[^.]*$/, ''));
            else
                ok.push(r);
        }
        if (denied.length) {
            app_log_1.appLog.warn('file', `批量操作已拦截（只读共享目录）：${denied.slice(0, 5).join(', ')}${denied.length > 5 ? ' …' : ''}`, `共 ${denied.length} 个文件位于别人共享给当前用户（${me}）的只读目录内`);
        }
        return { ok, denied };
    }
    async userPerm(req, kind) {
        if (this.admin(req))
            return true;
        const s = (0, auth_guard_1.currentSession)(req);
        if (!s)
            return false;
        const u = await prisma_1.prisma.user.findUnique({ where: { username: s.user } });
        if (!u || !u.enabled)
            return false;
        return kind === 'edit' ? u.canEdit : u.canDelete;
    }
    async sharedScopeDirs(scope, username, instanceId) {
        const user = String(username || '').trim();
        if (!user)
            return [];
        const rows = await prisma_1.prisma.folderMeta.findMany({
            where: {
                type: folder_meta_service_1.FOLDER_TYPE_FILE,
                ...(String(instanceId) === '*' ? {} : { instanceId: instanceId || '' }),
                sharedUsers: { not: '[]' },
            },
            select: { path: true, owner: true, sharedUsers: true },
        });
        const seen = new Set();
        const out = [];
        for (const r of rows) {
            const path = String(r.path || '').replace(/^\/+|\/+$/g, '');
            if (!path)
                continue;
            const shared = (0, folder_meta_service_1.parseSharedUsers)(r.sharedUsers);
            if (!shared.length)
                continue;
            const owner = String(r.owner || '');
            const hit = scope === 'tome'
                ? !!owner && owner !== user && shared.includes(user)
                : owner === user;
            const key = `${owner}\u0000${path}`;
            if (!hit || seen.has(key))
                continue;
            seen.add(key);
            out.push({ path, owner });
        }
        return out.sort((a, b) => a.path.localeCompare(b.path));
    }
    filterGroups(r, f, matchMode = 'all') {
        return (0, file_filter_1.fileFilterGroups)(r, f, matchMode);
    }
    matchDimPreset(w, h, preset) {
        return (0, file_filter_1.matchDimPreset)(w, h, preset);
    }
    async list(req, q) {
        if (q.action === 'info') {
            if (!this.admin(req))
                return { forbidden: true, totalFiles: 0, channelStats: {}, typeStats: {}, uploadSourceStats: {}, mimeStats: {}, uploadTrend: { labels: [], total: [], groupBy: {} } };
            return this.indexInfo(q);
        }
        const session = (0, auth_guard_1.currentSession)(req);
        const ownerFilter = String(q.user || '') && q.user !== 'all' && String(q.user) === String(session?.user || '')
            ? String(q.user)
            : session?.user || '';
        const recursive = q.recursive === 'true';
        const dir = (0, file_view_1.normalizeDir)(q.dir);
        const search = (q.search || '').trim().toLowerCase();
        const searchType = (q.searchType || 'all').toLowerCase();
        let count = q.count === undefined ? 50 : Number(q.count);
        if (Number.isNaN(count))
            count = 50;
        const start = Math.max(0, Number(q.start || 0) || 0);
        const sumOnly = count === -1 && q.sum === 'true';
        const includeTags = splitCsv(q.includeTags);
        const excludeTags = splitCsv(q.excludeTags);
        const filterTags = splitCsv(q.filterTags);
        const tagMode = String(q.tagMode || 'and').toLowerCase() === 'or' ? 'or' : 'and';
        const hasTags = String(q.hasTags || '').toLowerCase();
        const fListType = splitCsv(q.listType);
        const fAccess = splitCsv(q.accessStatus);
        if (q.encryptedOnly === '1' || q.encryptedOnly === 'true') {
            if (!fAccess.includes('encrypted'))
                fAccess.push('encrypted');
        }
        const encryptedOnly = fAccess.includes('encrypted');
        const fLabel = splitCsv(q.label);
        const fFileType = splitCsv(q.fileType);
        const fChannel = splitCsv(q.channel);
        const fChannelName = splitCsv(q.channelName);
        const fUploadSource = splitCsv(q.uploadSource).map((s) => (0, file_view_1.normalizeUploadSource)(s));
        const fBackup = splitCsv(q.backup);
        const fRedirect = splitCsv(q.redirect);
        const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(q.dateFrom || '')) ? String(q.dateFrom) : '';
        const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(q.dateTo || '')) ? String(q.dateTo) : '';
        const tzMin = Number(q.tz);
        const tzOffset = Number.isFinite(tzMin) ? Math.max(-840, Math.min(840, tzMin)) : 0;
        const dayStartMs = (date) => {
            const [y, m, d] = date.split('-').map(Number);
            return Date.UTC(y, m - 1, d) + tzOffset * 60_000;
        };
        const fromMs = dateFrom ? dayStartMs(dateFrom) : 0;
        const toMs = dateTo ? dayStartMs(dateTo) + 86_400_000 - 1 : 0;
        const sizeMin = Math.max(0, Number(q.sizeMin) || 0);
        const sizeMax = Math.max(0, Number(q.sizeMax) || 0);
        const fValidity = splitCsv(q.validity).map((v) => v.toLowerCase());
        const fNameChanged = splitCsv(q.nameChanged).map((v) => v.toLowerCase());
        const sizeMode = String(q.sizeMode || 'actual').toLowerCase() === 'original' ? 'original' : 'actual';
        const fDimPreset = splitCsv(q.dimPreset).map((v) => v.toLowerCase());
        const widthMin = Math.max(0, Number(q.widthMin) || 0);
        const widthMax = Math.max(0, Number(q.widthMax) || 0);
        const heightMin = Math.max(0, Number(q.heightMin) || 0);
        const heightMax = Math.max(0, Number(q.heightMax) || 0);
        const numOrNull = (raw, max) => {
            if (raw === undefined || raw === null || String(raw) === '')
                return null;
            const n = Number(raw);
            if (!Number.isFinite(n))
                return null;
            return Math.max(0, Math.min(max, n));
        };
        const ratingMin = numOrNull(q.ratingMin, 5);
        const ratingMax = numOrNull(q.ratingMax, 5);
        const levelMin = numOrNull(q.levelMin, 5);
        const levelMax = numOrNull(q.levelMax, 5);
        const matchModeRaw = String(q.matchMode || '').toLowerCase();
        const matchMode = matchModeRaw === 'any' || matchModeRaw === 'or' ? 'any' : 'all';
        const fUsers = splitCsv(q.filterUsers);
        const withDeleted = fAccess.includes('deleted');
        const filterOpts = {
            hasTags,
            filterTags,
            tagMode,
            listType: fListType,
            label: fLabel,
            fileType: fFileType,
            channel: fChannel,
            channelName: fChannelName,
            uploadSource: fUploadSource,
            backup: fBackup,
            redirect: fRedirect,
            access: fAccess,
            validity: fValidity,
            nameChanged: fNameChanged,
            users: fUsers,
            fromMs,
            toMs,
            sizeMin,
            sizeMax,
            sizeMode,
            ratingMin,
            ratingMax,
            levelMin,
            levelMax,
            dimPreset: fDimPreset,
            widthMin,
            widthMax,
            heightMin,
            heightMax,
        };
        const rawInstance = String(q.instanceId ?? '');
        const allInstances = rawInstance === '*';
        const instanceFilter = allInstances ? '' : rawInstance;
        const shareScope = q.shareScope === 'mine' || q.shareScope === 'tome' ? q.shareScope : '';
        const shareDirs = shareScope
            ? await this.sharedScopeDirs(shareScope, session?.user || '', allInstances ? '*' : instanceFilter)
            : [];
        const shareFolderOr = shareDirs.flatMap((d) => [
            { folder: d.path },
            { folder: { startsWith: `${d.path}/` } },
        ]);
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: {
                status: withDeleted ? { in: ['active', 'deleted'] } : 'active',
                ...(allInstances ? {} : { instanceId: instanceFilter }),
                ...(ownerFilter && !shareScope ? { uploader: ownerFilter } : {}),
                ...(encryptedOnly ? { metas: { contains: '"AccessPasswordHash"' } } : {}),
                ...(shareScope
                    ? shareFolderOr.length
                        ? { OR: shareFolderOr }
                        : { folder: { in: [] } }
                    : {}),
            },
            include: {
                copies: { include: { channel: true } },
                tags: { include: { tag: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        const sharedMark = [];
        if (session?.user) {
            const markInstance = allInstances ? '*' : instanceFilter;
            const [toMe, byMe] = await Promise.all([
                (0, folder_meta_service_1.listSharedFoldersFor)(session.user, markInstance),
                (0, folder_meta_service_1.listFoldersSharedBy)(session.user, markInstance),
            ]);
            const seenMark = new Set();
            for (const d of [
                ...byMe.map((x) => ({ ...x, sharedPerm: 'edit' })),
                ...toMe,
            ]) {
                const key = `${d.path}\u0000${d.owner}`;
                if (seenMark.has(key))
                    continue;
                seenMark.add(key);
                sharedMark.push({ path: d.path, owner: d.owner, sharedPerm: d.sharedPerm });
            }
        }
        const sharedInfoOf = (r) => {
            const f = r.folder || '';
            const hit = sharedMark.find((d) => f === d.path || f.startsWith(`${d.path}/`));
            if (!hit)
                return null;
            return { owner: hit.owner, self: hit.owner === session?.user, perm: hit.sharedPerm };
        };
        const allFolders = new Set(rows.map((r) => r.folder).filter(Boolean));
        for (const f of Array.from(allFolders)) {
            const segs = String(f).split('/').filter(Boolean);
            for (let i = 1; i < segs.length; i++)
                allFolders.add(segs.slice(0, i).join('/'));
        }
        for (const d of shareScope ? [] : await this.extraFolders(req, allInstances ? '*' : instanceFilter))
            allFolders.add(d);
        const matched = rows.filter((r) => {
            if (search) {
                const tagNames = r.tags.map((t) => t.tag.name).join(',').toLowerCase();
                const mime = (r.mime || '').toLowerCase();
                const dirName = (r.folder || '').toLowerCase();
                const hit = searchType === 'title'
                    ? r.originalName.toLowerCase().includes(search) || r.name.toLowerCase().includes(search)
                    : searchType === 'tag'
                        ? tagNames.includes(search)
                        : searchType === 'category'
                            ? dirName.includes(search)
                            : searchType === 'user'
                                ? (r.uploader || '').toLowerCase().includes(search)
                                : searchType === 'note'
                                    ? (r.note || '').toLowerCase().includes(search)
                                    : searchType === 'other'
                                        ? (r.md5 || '').toLowerCase().includes(search) ||
                                            mime.includes(search) ||
                                            (r.ip || '').includes(search)
                                        :
                                            r.originalName.toLowerCase().includes(search) ||
                                                r.name.toLowerCase().includes(search) ||
                                                (r.md5 || '').toLowerCase().includes(search) ||
                                                dirName.includes(search) ||
                                                tagNames.includes(search) ||
                                                mime.includes(search) ||
                                                (r.uploader || '').toLowerCase().includes(search) ||
                                                (r.note || '').toLowerCase().includes(search);
                if (!hit)
                    return false;
            }
            if (includeTags.length && !includeTags.every((t) => r.tags.map((x) => x.tag.name).includes(t)))
                return false;
            if (excludeTags.length && excludeTags.some((t) => r.tags.map((x) => x.tag.name).includes(t)))
                return false;
            const groups = this.filterGroups(r, filterOpts, matchMode);
            if (!groups.length)
                return true;
            return matchMode === 'any' ? groups.some(Boolean) : groups.every(Boolean);
        });
        const filterActive = !!search ||
            !!includeTags.length ||
            !!excludeTags.length ||
            !!filterTags.length ||
            !!hasTags ||
            !!fListType.length ||
            !!fAccess.length ||
            !!fLabel.length ||
            !!fFileType.length ||
            !!fChannel.length ||
            !!fChannelName.length ||
            !!fUploadSource.length ||
            !!fBackup.length ||
            !!fRedirect.length ||
            !!fValidity.length ||
            !!fNameChanged.length ||
            !!fUsers.length ||
            !!fromMs ||
            !!toMs ||
            sizeMin > 0 ||
            sizeMax > 0 ||
            ratingMin !== null ||
            ratingMax !== null ||
            levelMin !== null ||
            levelMax !== null ||
            !!fDimPreset.length ||
            widthMin > 0 ||
            widthMax > 0 ||
            heightMin > 0 ||
            heightMax > 0 ||
            !!shareScope ||
            !!(this.admin(req) && q.user && q.user !== 'all');
        if (filterActive) {
            const keep = new Set();
            const addChain = (p) => {
                const segs = String(p).split('/').filter(Boolean);
                for (let i = 1; i <= segs.length; i += 1)
                    keep.add(segs.slice(0, i).join('/'));
            };
            for (const r of matched)
                if (r.folder)
                    addChain(r.folder);
            if (search) {
                for (const f of Array.from(allFolders)) {
                    const leaf = String(f).split('/').pop() || '';
                    if (leaf.toLowerCase().includes(search))
                        addChain(f);
                }
            }
            allFolders.clear();
            for (const f of keep)
                allFolders.add(f);
        }
        const flat = q.flat === 'true';
        const dirBare = dir.replace(/\/+$/, '');
        let files;
        let directories = [];
        if (flat) {
            files = matched.filter((r) => (!dirBare ? true : r.folder === dirBare || r.folder.startsWith(`${dirBare}/`)));
        }
        else if (recursive) {
            files = matched.filter((r) => (!dirBare ? true : r.folder === dirBare || r.folder.startsWith(`${dirBare}/`)));
        }
        else {
            files = matched.filter((r) => (r.folder || '') === dirBare);
            const set = new Set();
            for (const f of allFolders) {
                const full = `${f}/`;
                if (!full.startsWith(dir))
                    continue;
                const rest = full.slice(dir.length);
                const idx = rest.indexOf('/');
                if (idx !== -1)
                    set.add(dir + rest.slice(0, idx));
            }
            directories = Array.from(set).sort();
        }
        const directoryStats = {};
        if (!flat && !recursive) {
            for (const d of directories) {
                const prefix = `${d}/`;
                let sub = 0;
                for (const f of allFolders) {
                    if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/'))
                        sub += 1;
                }
                let creator = '';
                let createdAt = 0;
                for (const r of matched) {
                    if ((r.folder || '') !== d && !(r.folder || '').startsWith(prefix))
                        continue;
                    const t = r.createdAt ? new Date(r.createdAt).getTime() : 0;
                    if (!createdAt || (t && t < createdAt)) {
                        createdAt = t;
                        creator = r.uploader || '';
                    }
                }
                directoryStats[d] = {
                    folders: sub,
                    files: matched.filter((r) => (r.folder || '') === d).length,
                    creator,
                    createdAt,
                };
            }
        }
        const totalCount = files.length;
        if (sumOnly)
            return { sum: totalCount, indexLastUpdated: Date.now() };
        const folderDisplayNames = {};
        if (directories.length) {
            try {
                const metaRows = await prisma_1.prisma.folderMeta.findMany({
                    where: {
                        type: folder_meta_service_1.FOLDER_TYPE_FILE,
                        ...(allInstances ? {} : { instanceId: instanceFilter || '' }),
                        path: { in: directories },
                    },
                    select: { path: true, metas: true },
                });
                for (const row of metaRows) {
                    const name = String((0, file_view_1.safeParse)(row.metas).displayName || '').trim();
                    if (name)
                        folderDisplayNames[row.path] = name;
                }
            }
            catch (err) {
                app_log_1.appLog.warn('file', '目录显示名查询失败', err.message);
            }
        }
        const paged = count === -1 ? files.slice(start) : files.slice(start, start + count);
        const resolveDirectUrl = this.directUrlResolver();
        const resolveLoadUrl = this.directUrlResolver(true);
        const fileItems = paged.map((r) => {
            const item = (0, file_view_1.serializeFile)(r, r.copies, { tags: r.tags.map((t) => t.tag.name), resolveDirectUrl, resolveLoadUrl });
            item.instanceId = r.instanceId || '';
            item.folder = r.folder || '';
            const sharedInfo = sharedInfoOf(r);
            if (sharedInfo) {
                item.shared = true;
                item.sharedOwner = sharedInfo.owner;
                item.sharedSelf = sharedInfo.self;
                item.sharedPerm = sharedInfo.perm;
            }
            return item;
        });
        try {
            const instIdSet = new Set();
            for (const i of fileItems) {
                const v = String(i.instanceId || '');
                if (v)
                    instIdSet.add(v);
            }
            const instIds = Array.from(instIdSet);
            if (instIds.length) {
                const instRows = await prisma_1.prisma.instance.findMany({
                    where: { id: { in: instIds } },
                    select: { id: true, name: true },
                });
                const nameById = new Map(instRows.map((r) => [String(r.id), String(r.name)]));
                for (const item of fileItems) {
                    const nm = nameById.get(String(item.instanceId || ''));
                    if (nm)
                        item.metadata = { ...(item.metadata || {}), InstanceName: nm };
                }
            }
        }
        catch (err) {
            app_log_1.appLog.warn('file', `实例名回填失败（不影响列表）：${err?.message || err}`);
        }
        try {
            const fallback = new Map();
            for (const item of fileItems) {
                const m = item.metadata;
                if (m?.UploadIP)
                    fallback.set(String(m.UploadIP), String(m.UploadAddress || ''));
            }
            const displays = await (0, ip_query_1.ipDisplayBatch)(fileItems.map((i) => String(i.metadata?.UploadIP || '')), fallback, this.sysConfig);
            for (const item of fileItems) {
                const m = item.metadata;
                const d = displays.get(String(m?.UploadIP || ''));
                if (m && d)
                    m.IpDisplay = d;
            }
        }
        catch {
        }
        return {
            files: fileItems,
            directories,
            folderDisplayNames,
            folders: flat ? [] : undefined,
            sharedFolders: sharedMark.map((d) => ({
                path: d.path,
                owner: d.owner,
                mine: d.owner === (session?.user || ''),
                sharedPerm: d.sharedPerm,
            })),
            flat,
            directoryStats,
            totalCount,
            directFileCount: files.length,
            directFolderCount: flat ? 0 : directories.length,
            returnedCount: paged.length,
            indexLastUpdated: Date.now(),
            isIndexedResponse: true,
        };
    }
    async indexInfo(q) {
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: { status: 'active' },
            include: { copies: { include: { channel: true } } },
            orderBy: { createdAt: 'asc' },
        });
        const primaryOf = (r) => (0, file_view_1.pickPrimaryCopy)(r.copies);
        const totalFiles = rows.length;
        const lastUpdated = totalFiles ? rows[totalFiles - 1].createdAt.getTime() : Date.now();
        const offMinStat = Number(q.timezoneOffset || 0) || 0;
        const localMs = (d) => d.getTime() - offMinStat * 60000;
        const dayStartMs = (ms) => {
            const d = new Date(ms);
            return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        };
        const nowLocal = localMs(new Date());
        const todayStart = dayStartMs(nowLocal);
        const yesterdayStart = todayStart - DAY_MS;
        const dow = new Date(todayStart).getUTCDay();
        const weekStart = todayStart - ((dow + 6) % 7) * DAY_MS;
        const monthStart = Date.UTC(new Date(nowLocal).getUTCFullYear(), new Date(nowLocal).getUTCMonth(), 1);
        const yearStart = Date.UTC(new Date(nowLocal).getUTCFullYear(), 0, 1);
        let todayCount = 0;
        let yesterdayCount = 0;
        let weekCount = 0;
        let monthCount = 0;
        let yearCount = 0;
        let totalSize = 0;
        let totalViews = 0;
        const folderSet = new Set();
        for (const r of rows) {
            const t = localMs(r.createdAt);
            totalSize += r.size || 0;
            totalViews += r.views || 0;
            if (r.folder)
                folderSet.add(r.folder.replace(/\/+$/, ''));
            if (t >= todayStart)
                todayCount += 1;
            if (t >= yesterdayStart && t < todayStart)
                yesterdayCount += 1;
            if (t >= weekStart)
                weekCount += 1;
            if (t >= monthStart)
                monthCount += 1;
            if (t >= yearStart)
                yearCount += 1;
        }
        const recentLimit = Math.min(100, Math.max(1, Number(q.recentLimit || 20) || 20));
        const recentFiles = [...rows]
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, recentLimit)
            .map((r) => ({
            id: r.name,
            name: r.name,
            metadata: {
                FileName: r.originalName,
                FileType: (0, file_view_1.fileTypeOf)(r.mime),
                FileExt: (0, file_view_1.fileExtOf)(r.originalName, r.mime),
                FileSize: (0, file_view_1.formatSize)(r.size),
                FileSizeBytes: r.size,
                TimeStamp: r.createdAt.getTime(),
                Views: r.views || 0,
                User: r.uploader || '',
                Directory: r.folder ? `${r.folder.replace(/\/+$/, '')}/` : '',
            },
        }));
        const channelStats = {};
        const userStats = {};
        const typeStats = {};
        const uploadSourceStats = {};
        const mimeStats = {};
        for (const r of rows) {
            const p = primaryOf(r);
            const chLabel = p?.channel
                ? p.channel.name || file_view_1.CHANNEL_LABEL[p.channel.type] || p.channel.type
                : 'Unknown';
            channelStats[chLabel] = (channelStats[chLabel] || 0) + 1;
            const userLabel = r.uploader || '(匿名)';
            userStats[userLabel] = (userStats[userLabel] || 0) + 1;
            const metas = (0, file_view_1.safeParse)(r.metas);
            const listType = metas.ListType || 'None';
            typeStats[listType] = (typeStats[listType] || 0) + 1;
            const sourceLabel = (0, file_view_1.normalizeUploadSource)(r.uploadSource);
            uploadSourceStats[sourceLabel] = (uploadSourceStats[sourceLabel] || 0) + 1;
            const mimeLabel = (0, file_view_1.fileTypeOf)(r.mime);
            mimeStats[mimeLabel] = (mimeStats[mimeLabel] || 0) + 1;
        }
        const brief = (r) => r
            ? {
                id: r.name,
                name: r.name,
                metadata: {
                    FileName: r.originalName,
                    FileType: (0, file_view_1.fileTypeOf)(r.mime),
                    FileSizeBytes: r.size,
                    TimeStamp: r.createdAt.getTime(),
                },
            }
            : null;
        const offMin = Number(q.timezoneOffset || 0) || 0;
        const maxPoints = Math.min(365, Math.max(2, Number(q.trendMaxPoints || 90) || 90));
        const seriesLimit = Math.max(1, Number(q.trendSeriesLimit || 8) || 8);
        const nowMs = Date.now();
        let endMs = parseDayMs(q.trendEndDate);
        if (!Number.isFinite(endMs))
            endMs = parseDayMs(isoDayMs(nowMs - offMin * 60000));
        let startMs = parseDayMs(q.trendStartDate);
        if (!Number.isFinite(startMs))
            startMs = endMs - 6 * DAY_MS;
        if (endMs < startMs)
            [startMs, endMs] = [endMs, startMs];
        if (Math.floor((endMs - startMs) / DAY_MS) + 1 > maxPoints) {
            startMs = endMs - (maxPoints - 1) * DAY_MS;
        }
        const labels = [];
        for (let t = startMs; t <= endMs; t += DAY_MS)
            labels.push(isoDayMs(t));
        const labelIndex = new Map(labels.map((l, i) => [l, i]));
        const total = new Array(labels.length).fill(0);
        const byType = {};
        const byName = {};
        const byUser = {};
        const bySource = {};
        const byMime = {};
        for (const r of rows) {
            const key = isoDayMs(r.createdAt.getTime() - offMin * 60000);
            const i = labelIndex.get(key);
            if (i === undefined)
                continue;
            total[i] += 1;
            const p = primaryOf(r);
            const typeLabel = p?.channel ? file_view_1.CHANNEL_LABEL[p.channel.type] || p.channel.type : 'Unknown';
            const nameLabel = p?.channel?.name || typeLabel;
            const userLabel = r.uploader || '(匿名)';
            const sourceLabel = (0, file_view_1.normalizeUploadSource)(r.uploadSource);
            const mimeLabel = (0, file_view_1.fileTypeOf)(r.mime);
            if (!byType[typeLabel])
                byType[typeLabel] = new Array(labels.length).fill(0);
            if (!byName[nameLabel])
                byName[nameLabel] = new Array(labels.length).fill(0);
            if (!byUser[userLabel])
                byUser[userLabel] = new Array(labels.length).fill(0);
            if (!bySource[sourceLabel])
                bySource[sourceLabel] = new Array(labels.length).fill(0);
            if (!byMime[mimeLabel])
                byMime[mimeLabel] = new Array(labels.length).fill(0);
            byType[typeLabel][i] += 1;
            byName[nameLabel][i] += 1;
            byUser[userLabel][i] += 1;
            bySource[sourceLabel][i] += 1;
            byMime[mimeLabel][i] += 1;
        }
        const buildSeries = (map) => {
            const arr = Object.entries(map)
                .map(([name, data]) => ({ name, data, sum: data.reduce((a, b) => a + b, 0) }))
                .sort((a, b) => b.sum - a.sum || a.name.localeCompare(b.name));
            const head = arr.slice(0, seriesLimit).map(({ name, data }) => ({ name, data }));
            const tail = arr.slice(seriesLimit);
            if (tail.length) {
                const other = new Array(labels.length).fill(0);
                for (const s of tail)
                    s.data.forEach((v, i) => (other[i] += v));
                head.push({ name: '__other__', isOther: true, data: other });
            }
            return head;
        };
        return {
            totalFiles,
            lastUpdated,
            channelStats,
            userStats,
            typeStats,
            uploadSourceStats,
            mimeStats,
            newestFile: brief(rows[totalFiles - 1]),
            oldestFile: brief(rows[0]),
            recentFiles,
            stats: {
                today: todayCount,
                yesterday: yesterdayCount,
                week: weekCount,
                month: monthCount,
                year: yearCount,
                totalSize,
                totalViews,
                folderCount: folderSet.size,
            },
            uploadTrend: {
                labels,
                total,
                groupBy: {
                    channel: { series: buildSeries(byType) },
                    channelName: { series: buildSeries(byName) },
                    user: { series: buildSeries(byUser) },
                    uploadSource: { series: buildSeries(bySource) },
                    mime: { series: buildSeries(byMime) },
                },
                range: { startDate: isoDayMs(startMs), endDate: isoDayMs(endMs) },
            },
            indexLastUpdated: Date.now(),
            isIndexedResponse: true,
        };
    }
    deleteByGet(req, q) {
        return this.remove(req, q);
    }
    deleteByDelete(req, q) {
        return this.remove(req, q);
    }
    async remove(req, q) {
        if (!(await this.userPerm(req, 'delete')))
            return { success: false, message: '没有删除权限' };
        const key = wildcardParam(req);
        if (!key)
            return { success: false, message: '缺少文件名' };
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        const own = owner ? { uploader: owner } : {};
        const delInstance = String(q.instanceId ?? '');
        const instWhere = delInstance === '*' ? {} : { instanceId: delInstance };
        let sharedToMeDirs = [];
        if (!this.admin(req) && owner) {
            sharedToMeDirs = await (0, folder_meta_service_1.listSharedFoldersFor)(owner, '*');
        }
        const sharedHitOf = (folder) => sharedToMeDirs.find((d) => folder === d.path || folder.startsWith(`${d.path}/`));
        if (q.folder === 'true') {
            const prefix = key.replace(/\/+$/, '');
            const hit = sharedHitOf(prefix);
            if (hit) {
                return { success: false, message: `「${hit.path}」是 ${hit.owner} 共享给你的目录，不允许删除` };
            }
            const rows = await prisma_1.prisma.fileRecord.findMany({
                where: {
                    status: 'active',
                    ...own,
                    ...instWhere,
                    OR: [{ folder: prefix }, { folder: { startsWith: `${prefix}/` } }],
                },
            });
            const batchMsg = await this.refBlockMessage(rows.map((r) => r.id));
            if (batchMsg)
                return { success: false, message: batchMsg };
            for (const r of rows)
                await this.trashRecord(r.id, r.name);
            const unregistered = await this.unregisterFolders(owner, prefix, delInstance === '*' ? '' : delInstance);
            let metaRemoved = 0;
            let metaSnapshot = null;
            try {
                const metas = await prisma_1.prisma.folderMeta.findMany({
                    where: {
                        type: folder_meta_service_1.FOLDER_TYPE_FILE,
                        OR: [{ path: prefix }, { path: { startsWith: `${prefix}/` } }],
                        ...(owner ? { owner } : {}),
                        ...(delInstance === '*' ? {} : { instanceId: delInstance }),
                    },
                });
                if (metas.length) {
                    const self = metas.find((m) => m.path === prefix);
                    if (self) {
                        const { id, createdAt, ...rest } = self;
                        metaSnapshot = rest;
                    }
                    const del = await prisma_1.prisma.folderMeta.deleteMany({ where: { id: { in: metas.map((m) => m.id) } } });
                    metaRemoved = del.count;
                }
            }
            catch (err) {
                app_log_1.appLog.warn('file', `目录属性清理失败：${prefix}`, err.message);
            }
            try {
                await this.addDeletedFolder(owner, {
                    path: prefix,
                    deletedAt: new Date().toISOString(),
                    instanceId: delInstance === '*' ? String(metaSnapshot?.instanceId ?? '') : delInstance,
                    meta: metaSnapshot,
                });
            }
            catch (err) {
                app_log_1.appLog.warn('file', `目录移入回收站登记失败：${prefix}`, err.message);
            }
            app_log_1.appLog.info('file', `目录已移入回收站：${prefix}`, `文件 ${rows.length} 条 ｜ 登记目录 ${unregistered} 条 ｜ 目录属性 ${metaRemoved} 条`);
            return { success: true, deleted: rows.length, folders: 1, unregistered, metaRemoved };
        }
        const reqFolder = String(q.folder || '');
        if (reqFolder && reqFolder !== 'true') {
            const hitByFolder = sharedHitOf(reqFolder);
            if (hitByFolder) {
                return { success: false, message: `「${hitByFolder.path}」是 ${hitByFolder.owner} 共享给你的目录，不允许删除` };
            }
        }
        const record = await prisma_1.prisma.fileRecord.findFirst({
            where: { status: 'active', ...own, OR: [{ name: key }, { name: key.replace(/\.[^.]*$/, '') }] },
        });
        if (!record)
            return { success: false, message: '文件不存在' };
        const sharedHit = sharedHitOf(record.folder || '');
        if (sharedHit) {
            return { success: false, message: `该文件位于 ${sharedHit.owner} 共享给你的「${sharedHit.path}」内，不允许删除` };
        }
        const refMsg = await this.refBlockMessage([record.id]);
        if (refMsg)
            return { success: false, message: refMsg };
        await this.trashRecord(record.id, record.name);
        return { success: true, deleted: 1 };
    }
    async refBlockMessage(fileIds) {
        const ids = Array.from(new Set((fileIds || []).map((x) => String(x || '')).filter(Boolean)));
        if (!ids.length)
            return '';
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, originalName: true },
        });
        const map = await (0, file_share_stats_1.syncFileStats)(rows.map((r) => r.id));
        const blocked = rows.filter((r) => (map.get(r.id)?.ref || 0) > 0);
        if (!blocked.length)
            return '';
        const noteMsg = await (0, file_refs_1.batchReferenceBlockMessage)(blocked.map((r) => r.id));
        if (noteMsg)
            return noteMsg;
        const first = blocked[0];
        const ref = map.get(first.id)?.ref || 0;
        const who = blocked.length > 1 ? `等 ${blocked.length} 个文件` : `「${first.originalName || first.name}」`;
        return `${who}正在被共享（引用统计 ${ref}），无法删除，也不能移入回收站。请先在「文件夹属性」里取消共享后再试。`;
    }
    async trashRecord(id, name) {
        await this.uploadSvc.softDeleteFile(id, name);
    }
    async trashList(req, q) {
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        const instanceFilter = String(q.instanceId ?? '');
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: {
                status: 'deleted',
                instanceId: instanceFilter,
                ...(owner ? { uploader: owner } : {}),
            },
            include: {
                copies: { include: { channel: true } },
                tags: { include: { tag: true } },
            },
            orderBy: { deletedAt: 'desc' },
            take: 2000,
        });
        const search = (q.search || '').trim().toLowerCase();
        const matchModeRaw = String(q.matchMode || '').toLowerCase();
        const matchMode = matchModeRaw === 'any' || matchModeRaw === 'or' ? 'any' : 'all';
        const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(q.dateFrom || '')) ? String(q.dateFrom) : '';
        const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(q.dateTo || '')) ? String(q.dateTo) : '';
        const tzMin = Number(q.tz);
        const tzOffset = Number.isFinite(tzMin) ? Math.max(-840, Math.min(840, tzMin)) : 0;
        const dayStartMs = (date) => {
            const [y, m, d] = date.split('-').map(Number);
            return Date.UTC(y, m - 1, d) + tzOffset * 60_000;
        };
        const fromMs = dateFrom ? dayStartMs(dateFrom) : 0;
        const toMs = dateTo ? dayStartMs(dateTo) + 86_400_000 - 1 : 0;
        const filterOpts = {
            hasTags: String(q.hasTags || '').toLowerCase(),
            filterTags: splitCsv(q.filterTags),
            tagMode: String(q.tagMode || 'and').toLowerCase() === 'or' ? 'or' : 'and',
            listType: splitCsv(q.listType),
            label: splitCsv(q.label),
            fileType: splitCsv(q.fileType),
            channel: splitCsv(q.channel),
            channelName: splitCsv(q.channelName),
            uploadSource: splitCsv(q.uploadSource).map((v) => (0, file_view_1.normalizeUploadSource)(v)),
            backup: splitCsv(q.backup),
            redirect: splitCsv(q.redirect),
            access: splitCsv(q.accessStatus),
            validity: splitCsv(q.validity).map((v) => v.toLowerCase()),
            nameChanged: splitCsv(q.nameChanged).map((v) => v.toLowerCase()),
            users: splitCsv(q.filterUsers),
            fromMs,
            toMs,
            sizeMin: Math.max(0, Number(q.sizeMin) || 0),
            sizeMax: Math.max(0, Number(q.sizeMax) || 0),
            sizeMode: String(q.sizeMode || 'actual').toLowerCase() === 'original' ? 'original' : 'actual',
            ratingMin: this.numOrNullParam(q.ratingMin, 5),
            ratingMax: this.numOrNullParam(q.ratingMax, 5),
            levelMin: this.numOrNullParam(q.levelMin, 5),
            levelMax: this.numOrNullParam(q.levelMax, 5),
            dimPreset: splitCsv(q.dimPreset).map((v) => v.toLowerCase()),
            widthMin: Math.max(0, Number(q.widthMin) || 0),
            widthMax: Math.max(0, Number(q.widthMax) || 0),
            heightMin: Math.max(0, Number(q.heightMin) || 0),
            heightMax: Math.max(0, Number(q.heightMax) || 0),
        };
        const filtered = rows.filter((r) => {
            if (search) {
                const hit = r.name.toLowerCase().includes(search) ||
                    r.originalName.toLowerCase().includes(search) ||
                    (r.uploader || '').toLowerCase().includes(search) ||
                    (r.folder || '').toLowerCase().includes(search) ||
                    (r.md5 || '').toLowerCase().includes(search);
                if (!hit)
                    return false;
            }
            const groups = this.filterGroups(r, filterOpts, matchMode);
            if (!groups.length)
                return true;
            return matchMode === 'any' ? groups.some(Boolean) : groups.every(Boolean);
        });
        const channelIds = Array.from(new Set(filtered.flatMap((r) => r.copies.map((c) => c.channelId))));
        const channels = await prisma_1.prisma.channel.findMany({
            where: { id: { in: channelIds } },
            select: { id: true, name: true, type: true },
        });
        const chMap = new Map(channels.map((c) => [c.id, c]));
        const mapped = filtered.map((r) => ({
            id: r.id,
            name: r.name,
            originalName: r.originalName,
            size: r.size,
            mime: r.mime,
            folder: r.folder,
            uploader: r.uploader,
            uploadSource: r.uploadSource,
            status: r.status,
            deletedAt: r.deletedAt,
            channels: r.copies.map((c) => ({
                name: chMap.get(c.channelId)?.name || '(已删除渠道)',
                type: chMap.get(c.channelId)?.type || '',
                isPrimary: c.isPrimary,
                status: c.status,
            })),
        }));
        const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 48));
        const page = Math.max(1, Number(q.page) || 1);
        const dirParam = String(q.dir || '').replace(/^\/+|\/+$/g, '');
        const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
        let folderEntries = [];
        try {
            folderEntries = (await this.listDeletedFoldersFor(req, owner)).filter((e) => (e.instanceId || '') === instanceFilter);
        }
        catch (err) {
            app_log_1.appLog.warn('file', `回收站目录条目读取失败`, err.message);
        }
        const pathSet = new Set();
        const addChain = (raw) => {
            const segs = String(raw || '').split('/').filter(Boolean);
            for (let i = 1; i <= segs.length; i += 1)
                pathSet.add(segs.slice(0, i).join('/'));
        };
        for (const r of filtered)
            if (r.folder)
                addChain(r.folder);
        for (const e of folderEntries)
            if (e.path)
                addChain(e.path);
        const children = Array.from(pathSet).filter((p) => parentOf(p) === dirParam);
        const latestDeletedAtUnder = (prefix) => {
            let latest = 0;
            for (const r of filtered) {
                const f = String(r.folder || '');
                if (f === prefix || f.startsWith(`${prefix}/`))
                    latest = Math.max(latest, new Date(r.deletedAt).getTime());
            }
            for (const e of folderEntries) {
                if (e.path === prefix || String(e.path).startsWith(`${prefix}/`)) {
                    latest = Math.max(latest, new Date(e.deletedAt).getTime());
                }
            }
            return latest ? new Date(latest) : null;
        };
        const folderItems = children.map((p) => {
            const base = p.split('/').pop() || p;
            return {
                id: `folder:${p}`,
                name: base,
                originalName: base,
                size: 0,
                mime: '',
                folder: parentOf(p),
                trashPath: p,
                uploader: owner,
                uploadSource: '',
                status: 'deleted',
                deletedAt: latestDeletedAtUnder(p),
                isFolder: true,
                registered: folderEntries.some((e) => e.path === p),
                channels: [],
            };
        });
        const levelFiles = mapped.filter((m) => String(m.folder || '') === dirParam);
        const merged = [
            ...folderItems,
            ...levelFiles,
        ];
        const total = merged.length;
        const start = (page - 1) * pageSize;
        const items = merged.slice(start, start + pageSize);
        return {
            success: true,
            items,
            total,
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            path: dirParam,
            parent: dirParam ? parentOf(dirParam) : '',
            isRoot: !dirParam,
        };
    }
    async trashRestore(req) {
        if (!(await this.userPerm(req, 'delete')))
            return { success: false, message: '没有恢复权限' };
        const key = wildcardParam(req);
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        if (key.startsWith('folder:')) {
            const path = key.slice('folder:'.length);
            const entry = (await this.listDeletedFoldersFor(req, owner)).find((e) => e.path === path);
            if (entry) {
                const restored = await this.restoreFolderEntry(owner, path, String(entry.instanceId || ''));
                return { success: true, folder: true, restoredFiles: restored.filesRestored };
            }
            const rows = await prisma_1.prisma.fileRecord.findMany({
                where: {
                    status: 'deleted',
                    uploader: owner,
                    OR: [{ folder: path }, { folder: { startsWith: `${path}/` } }],
                },
                select: { id: true, name: true, folder: true, uploader: true, instanceId: true },
            });
            if (!rows.length)
                return { success: false, message: '回收站中不存在该目录' };
            for (const r of rows) {
                await this.uploadSvc.restoreFile(r.id, r.name);
                await this.restoreFolderChain(r.uploader || owner, r.folder || '', r.instanceId || '');
            }
            return { success: true, folder: true, restoredFiles: rows.length };
        }
        const record = await prisma_1.prisma.fileRecord.findFirst({
            where: { id: key, status: 'deleted', ...(owner ? { uploader: owner } : {}) },
        });
        if (!record)
            return { success: false, message: '回收站中不存在该文件' };
        await this.uploadSvc.restoreFile(record.id, record.name);
        await this.restoreFolderChain(record.uploader || owner, record.folder || '', record.instanceId || '');
        return { success: true };
    }
    async trashPurge(req, q) {
        return this.trashPurgeOne(req, String(q?.totpCode || ''));
    }
    async trashPurgeDelete(req, q) {
        return this.trashPurgeOne(req, String(q?.totpCode || ''));
    }
    async trashPurgeOne(req, totpCode = '') {
        if (!(await this.userPerm(req, 'delete')))
            return { success: false, message: '没有删除权限' };
        const key = wildcardParam(req);
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        if (key.startsWith('folder:')) {
            const path = key.slice('folder:'.length);
            const hit = (await this.listDeletedFoldersFor(req, owner)).find((e) => e.path === path);
            if (hit) {
                const gate = await this.verifyTrashTotp(req, totpCode);
                if (gate)
                    return gate;
                try {
                    const n = await this.purgeFolderEntry(owner, path, String(hit.instanceId || ''));
                    return { success: true, folder: true, purged: n };
                }
                catch (err) {
                    return { success: false, message: err.message };
                }
            }
            const rows = await prisma_1.prisma.fileRecord.findMany({
                where: {
                    status: 'deleted',
                    uploader: owner,
                    OR: [{ folder: path }, { folder: { startsWith: `${path}/` } }],
                },
                select: { id: true, name: true, uploader: true, folder: true, instanceId: true },
            });
            if (!rows.length)
                return { success: false, message: '回收站中不存在该目录' };
            const gate2 = await this.verifyTrashTotp(req, totpCode);
            if (gate2)
                return gate2;
            const blockedMsg = await this.refBlockMessage(rows.map((r) => r.id));
            if (blockedMsg)
                return { success: false, message: blockedMsg };
            for (const r of rows) {
                await this.uploadSvc.removeFile(r.id, r.name);
                await this.cleanupEmptiedFolderChain(r.uploader || owner, r.folder || '', r.instanceId || '');
            }
            return { success: true, folder: true, purged: rows.length };
        }
        const record = await prisma_1.prisma.fileRecord.findFirst({
            where: { id: key, status: 'deleted', ...(owner ? { uploader: owner } : {}) },
        });
        if (!record)
            return { success: false, message: '回收站中不存在该文件' };
        const gate = await this.verifyTrashTotp(req, totpCode);
        if (gate)
            return gate;
        const purgeBlocked = await this.refBlockMessage([record.id]);
        if (purgeBlocked)
            return { success: false, message: purgeBlocked };
        await this.uploadSvc.removeFile(record.id, record.name);
        await this.cleanupEmptiedFolderChain(record.uploader || owner, record.folder || '', record.instanceId || '');
        return { success: true };
    }
    async trashBatch(req, body) {
        if (!(await this.userPerm(req, 'delete')))
            return { success: false, message: '没有权限' };
        const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
        const action = body.action === 'purge' ? 'purge' : 'restore';
        if (!ids.length)
            return { success: false, message: '缺少 ids' };
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        if (action === 'purge') {
            const gate = await this.verifyTrashTotp(req, body?.totpCode);
            if (gate)
                return gate;
        }
        const folderPaths = new Set((await this.listDeletedFoldersFor(req, owner)).map((e) => e.path));
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: { id: { in: ids }, status: 'deleted', ...(owner ? { uploader: owner } : {}) },
        });
        const found = new Set(rows.map((r) => r.id));
        const statsMap = action === 'purge' ? await (0, file_share_stats_1.syncFileStats)(rows.map((r) => r.id)) : null;
        const results = [];
        for (const id of ids) {
            if (id.startsWith('folder:')) {
                const path = id.slice('folder:'.length);
                if (!folderPaths.has(path)) {
                    try {
                        const under = await prisma_1.prisma.fileRecord.findMany({
                            where: {
                                status: 'deleted',
                                uploader: owner,
                                OR: [{ folder: path }, { folder: { startsWith: `${path}/` } }],
                            },
                            select: { id: true, name: true, uploader: true, folder: true, instanceId: true },
                        });
                        if (!under.length) {
                            results.push({ id, ok: false, message: '目录不存在或无权限' });
                            continue;
                        }
                        if (action === 'purge') {
                            const blocked = await this.refBlockMessage(under.map((r) => r.id));
                            if (blocked) {
                                results.push({ id, ok: false, message: blocked });
                                continue;
                            }
                        }
                        for (const r of under) {
                            if (action === 'purge') {
                                await this.uploadSvc.removeFile(r.id, r.name);
                                await this.cleanupEmptiedFolderChain(r.uploader || owner, r.folder || '', r.instanceId || '');
                            }
                            else {
                                await this.uploadSvc.restoreFile(r.id, r.name);
                                await this.restoreFolderChain(r.uploader || owner, r.folder || '', r.instanceId || '');
                            }
                        }
                        results.push({ id, ok: true, message: `${action === 'purge' ? '连带删除' : '连带恢复'}文件 ${under.length} 条` });
                    }
                    catch (err) {
                        results.push({ id, ok: false, message: err.message });
                    }
                    continue;
                }
                try {
                    const entry = (await this.listDeletedFoldersFor(req, owner)).find((e) => e.path === path);
                    if (action === 'purge') {
                        const n = await this.purgeFolderEntry(owner, path, String(entry?.instanceId || ''));
                        results.push({ id, ok: true, message: `连带文件 ${n} 条` });
                    }
                    else {
                        const restored = await this.restoreFolderEntry(owner, path, String(entry?.instanceId || ''));
                        results.push({ id, ok: true, message: `连带恢复文件 ${restored.filesRestored} 条` });
                    }
                }
                catch (err) {
                    results.push({ id, ok: false, message: err.message });
                }
                continue;
            }
            if (!found.has(id)) {
                results.push({ id, ok: false, message: '不存在或无权限' });
                continue;
            }
            try {
                const rec = rows.find((r) => r.id === id);
                if (action === 'purge') {
                    const ref = statsMap?.get(rec.id)?.ref || 0;
                    if (ref > 0) {
                        const blocked = await this.refBlockMessage([rec.id]);
                        results.push({ id, ok: false, message: blocked || `该文件存在 ${ref} 条引用，无法彻底删除` });
                        continue;
                    }
                    await this.uploadSvc.removeFile(rec.id, rec.name);
                    await this.cleanupEmptiedFolderChain(rec.uploader || owner, rec.folder || '', rec.instanceId || '');
                }
                else {
                    await this.uploadSvc.restoreFile(rec.id, rec.name);
                    await this.restoreFolderChain(rec.uploader || owner, rec.folder || '', rec.instanceId || '');
                }
                results.push({ id, ok: true });
            }
            catch (err) {
                results.push({ id, ok: false, message: err.message });
            }
        }
        return {
            success: true,
            action,
            results,
            okCount: results.filter((r) => r.ok).length,
            failCount: results.filter((r) => !r.ok).length,
        };
    }
    async deletedFoldersRead() {
        const raw = await this.settings.get('deletedFolders', '{}');
        return (0, file_view_1.safeParse)(raw);
    }
    async deletedFoldersWrite(map) {
        await this.settings.set('deletedFolders', JSON.stringify(map));
    }
    async listDeletedFolders(owner) {
        const map = await this.deletedFoldersRead();
        return Array.isArray(map[owner]) ? map[owner] : [];
    }
    async listDeletedFoldersFor(req, owner) {
        const mine = await this.listDeletedFolders(owner);
        if (!this.admin(req) || !owner)
            return mine;
        const legacy = await this.listDeletedFolders('');
        if (!legacy.length)
            return mine;
        const seen = new Set(mine.map((e) => `${e.path}\u0000${e.instanceId || ''}`));
        return [...mine, ...legacy.filter((e) => !seen.has(`${e.path}\u0000${e.instanceId || ''}`))];
    }
    async addDeletedFolder(owner, entry) {
        const map = await this.deletedFoldersRead();
        const list = (map[owner] || []).filter((e) => e.path !== entry.path);
        list.unshift(entry);
        map[owner] = list;
        await this.deletedFoldersWrite(map);
    }
    async removeDeletedFolder(owner, path) {
        const map = await this.deletedFoldersRead();
        if (!map[owner])
            return null;
        const hit = map[owner].find((e) => e.path === path) || null;
        map[owner] = map[owner].filter((e) => e.path !== path);
        await this.deletedFoldersWrite(map);
        return hit;
    }
    async restoreFolderEntry(owner, path, instanceId = '') {
        const metaRestored = await this.reinstateFolder(owner, path, instanceId);
        let filesRestored = 0;
        try {
            const res = await prisma_1.prisma.fileRecord.updateMany({
                where: {
                    status: 'deleted',
                    ...(owner ? { uploader: owner } : {}),
                    instanceId,
                    OR: [{ folder: path }, { folder: { startsWith: `${path}/` } }],
                },
                data: { status: 'active', deletedAt: null },
            });
            filesRestored = res.count;
        }
        catch (err) {
            app_log_1.appLog.warn('file', `回收站恢复目录内的文件失败：${path}`, err.message);
        }
        app_log_1.appLog.info('file', `目录已从回收站恢复：${path}`, `目录属性还原 ${metaRestored} 条 ｜ 连带恢复文件 ${filesRestored} 条`);
        return { metaRestored, filesRestored };
    }
    async reinstateFolder(owner, path, instanceId = '') {
        try {
            const raw = await this.settings.get('extraFolders', '{}');
            const map = (0, file_view_1.safeParse)(raw);
            const key = this.extraFoldersKey(owner, instanceId);
            const list = new Set(Array.isArray(map[key]) ? map[key] : []);
            list.add(path);
            map[key] = Array.from(list).sort();
            await this.settings.set('extraFolders', JSON.stringify(map));
        }
        catch (err) {
            app_log_1.appLog.warn('file', `回收站恢复目录登记失败：${path}`, err.message);
        }
        let metaRestored = 0;
        const entry = await this.removeDeletedFolder(owner, path);
        if (entry?.meta && Object.keys(entry.meta).length) {
            try {
                const exists = await prisma_1.prisma.folderMeta.findFirst({
                    where: { path, instanceId, type: folder_meta_service_1.FOLDER_TYPE_FILE, ...(owner ? { owner } : {}) },
                    select: { id: true },
                });
                if (!exists) {
                    await prisma_1.prisma.folderMeta.create({ data: entry.meta });
                    metaRestored = 1;
                }
            }
            catch (err) {
                app_log_1.appLog.warn('file', `回收站恢复目录属性失败：${path}`, err.message);
            }
        }
        return metaRestored;
    }
    async restoreFolderChain(owner, folder, instanceId = '') {
        const f = String(folder || '').replace(/^\/+|\/+$/g, '').trim();
        if (!f)
            return 0;
        let entries = [];
        try {
            entries = await this.listDeletedFolders(owner);
        }
        catch (err) {
            app_log_1.appLog.warn('file', `读取回收站目录登记失败（跳过目录链恢复）`, err.message);
            return 0;
        }
        if (!entries.length)
            return 0;
        const sameInstance = (e) => String(e.instanceId || '') === String(instanceId || '');
        const segs = f.split('/').filter(Boolean);
        let restored = 0;
        for (let i = 1; i <= segs.length; i++) {
            const path = segs.slice(0, i).join('/');
            if (!entries.some((e) => e.path === path && sameInstance(e)))
                continue;
            await this.reinstateFolder(owner, path, instanceId);
            restored += 1;
        }
        if (restored)
            app_log_1.appLog.info('file', `文件恢复时一并恢复目录链：${f}`, `共恢复 ${restored} 级目录`);
        return restored;
    }
    async cleanupEmptiedFolderChain(owner, folder, instanceId = '') {
        const f = String(folder || '').replace(/^\/+|\/+$/g, '').trim();
        if (!f)
            return 0;
        const segs = f.split('/').filter(Boolean);
        let cleaned = 0;
        for (let i = segs.length; i >= 1; i--) {
            const path = segs.slice(0, i).join('/');
            try {
                const under = await prisma_1.prisma.fileRecord.count({
                    where: {
                        status: 'active',
                        instanceId,
                        ...(owner ? { uploader: owner } : {}),
                        OR: [{ folder: path }, { folder: { startsWith: `${path}/` } }],
                    },
                });
                if (under > 0)
                    break;
                const removedReg = await this.unregisterFolders(owner, path, instanceId);
                const delMeta = await prisma_1.prisma.folderMeta.deleteMany({
                    where: { path, instanceId, type: folder_meta_service_1.FOLDER_TYPE_FILE, ...(owner ? { owner } : {}) },
                });
                if (removedReg || delMeta.count)
                    cleaned += 1;
            }
            catch (err) {
                app_log_1.appLog.warn('file', `空目录登记清理失败：${path}`, err.message);
                break;
            }
        }
        if (cleaned) {
            app_log_1.appLog.info('file', `彻底删除后已清理空目录登记：${f}`, `共清理 ${cleaned} 级（登记 + 目录属性）`);
        }
        return cleaned;
    }
    async purgeFolderEntry(owner, path, instanceId = '') {
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: {
                status: 'deleted',
                ...(owner ? { uploader: owner } : {}),
                OR: [{ folder: path }, { folder: { startsWith: `${path}/` } }],
            },
            select: { id: true, name: true },
        });
        const stats = await (0, file_share_stats_1.syncFileStats)(rows.map((r) => r.id));
        if (rows.some((r) => (stats.get(r.id)?.ref || 0) > 0)) {
            const msg = (await this.refBlockMessage(rows.map((r) => r.id))) || '目录内存在被引用的文件，无法彻底删除';
            app_log_1.appLog.warn('file', `回收站目录彻底删除被拒绝：${path}`, msg);
            throw new Error(msg);
        }
        await this.removeDeletedFolder(owner, path);
        let n = 0;
        for (const r of rows) {
            try {
                await this.uploadSvc.removeFile(r.id, r.name);
                n++;
            }
            catch (err) {
                app_log_1.appLog.warn('file', `回收站目录连带删除失败：${r.name}`, err.message);
            }
        }
        try {
            await prisma_1.prisma.folderMeta.deleteMany({
                where: {
                    type: folder_meta_service_1.FOLDER_TYPE_FILE,
                    ...(instanceId ? { instanceId } : {}),
                    ...(owner ? { owner } : {}),
                    OR: [{ path }, { path: { startsWith: `${path}/` } }],
                },
            });
            await this.cleanupEmptiedFolderChain(owner, path, instanceId);
        }
        catch (err) {
            app_log_1.appLog.warn('file', `回收站目录彻底删除后清理登记失败：${path}`, err.message);
        }
        app_log_1.appLog.info('file', `回收站目录已彻底删除：${path}`, `连带文件 ${n} 条（已恢复到别处/重建目录中的活跃文件不受影响）`);
        return n;
    }
    async verifyTrashTotp(req, code = '') {
        const me = (0, auth_guard_1.currentSession)(req)?.user || '';
        if (!me)
            return null;
        const u = await prisma_1.prisma.user.findUnique({
            where: { username: me },
            select: { totpEnabled: true, totpSecret: true },
        });
        if (!u || !u.totpEnabled || !u.totpSecret)
            return null;
        const c = String(code || '').trim();
        if (!c) {
            app_log_1.appLog.warn('file', `彻底删除被拦截：账户已开启两步验证`, `user=${me}`);
            return { success: false, needTotp: true, message: '该账户已开启两步验证，彻底删除需输入动态验证码' };
        }
        try {
            if ((0, totp_1.verifyTotp)(crypto_service_1.CryptoService.decrypt(u.totpSecret), c))
                return null;
        }
        catch {
        }
        app_log_1.appLog.warn('file', `彻底删除两步验证失败`, `user=${me}`);
        return { success: false, needTotp: true, message: '两步验证码不匹配' };
    }
    bodyIds(body) {
        return Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean) : [];
    }
    async loadOwned(ids, req) {
        if (!ids.length)
            return [];
        return prisma_1.prisma.fileRecord.findMany({
            where: {
                uploader: (0, auth_guard_1.currentSession)(req)?.user || '',
                OR: [{ id: { in: ids } }, { name: { in: ids } }],
            },
        });
    }
    async batchOriginalName(req, body) {
        if (!(await this.userPerm(req, 'edit')))
            return { success: false, message: '没有编辑权限' };
        const ids = this.bodyIds(body);
        if (!ids.length)
            return { success: false, message: '缺少 ids' };
        const mode = String(body.mode || '');
        if (!['replace', 'rewrite', 'prepend', 'append', 'ext'].includes(mode)) {
            return { success: false, message: 'mode 不合法（replace / rewrite / prepend / append / ext）' };
        }
        const { ok: rows } = await this.dropReadonlyShared(await this.loadOwned(ids, req), req);
        const byKey = new Map();
        for (const r of rows) {
            byKey.set(r.id, r);
            byKey.set(r.name, r);
        }
        const failed = [];
        const plan = [];
        for (const id of ids) {
            const rec = byKey.get(id);
            if (!rec) {
                failed.push({ id, error: '不存在或无权限' });
                continue;
            }
            const cur = rec.originalName;
            const dot = cur.lastIndexOf('.');
            const stem = dot > 0 ? cur.slice(0, dot) : cur;
            const ext = dot > 0 ? cur.slice(dot + 1) : '';
            let target = cur;
            try {
                if (mode === 'replace') {
                    const find = String(body.find ?? '');
                    if (!find)
                        throw new Error('缺少 find');
                    const replaced = stem.split(find).join(String(body.replace ?? ''));
                    if (!replaced.trim())
                        throw new Error('替换后名称为空');
                    target = replaced + (ext ? `.${ext}` : '');
                }
                else if (mode === 'rewrite') {
                    const value = String(body.value ?? '').trim();
                    if (!value)
                        throw new Error('缺少 value');
                    const hasExt = /\.[A-Za-z0-9]{1,12}$/.test(value);
                    target = hasExt || !ext ? value : `${value}.${ext}`;
                }
                else if (mode === 'prepend') {
                    target = String(body.value ?? '') + cur;
                }
                else if (mode === 'append') {
                    target = stem + String(body.value ?? '') + (ext ? `.${ext}` : '');
                }
                else if (mode === 'ext') {
                    const e = String(body.ext ?? '').replace(/^\.+/, '').trim();
                    if (!e)
                        throw new Error('缺少 ext');
                    target = `${stem}.${e}`;
                }
            }
            catch (err) {
                failed.push({ id, error: err.message });
                continue;
            }
            if (!target || target === cur) {
                failed.push({ id, error: '新名称为空或未变化' });
                continue;
            }
            plan.push({ rec, target });
        }
        const taken = new Set();
        if (plan.length) {
            const exists = await prisma_1.prisma.fileRecord.findMany({
                where: {
                    originalName: { in: plan.map((u) => u.target) },
                    NOT: { id: { in: plan.map((u) => u.rec.id) } },
                },
                select: { originalName: true },
            });
            for (const e of exists)
                taken.add(e.originalName);
        }
        const applied = [];
        for (const u of plan) {
            let target = u.target;
            if (taken.has(target)) {
                const dot = target.lastIndexOf('.');
                const ts = String(Date.now());
                const withTs = (base, suffix) => {
                    const d = base.lastIndexOf('.');
                    return d > 0 ? `${base.slice(0, d)}-${suffix}${base.slice(d)}` : `${base}-${suffix}`;
                };
                target = withTs(target, ts);
                let n = 1;
                while (taken.has(target))
                    target = withTs(u.target, `${ts}-${n++}`);
            }
            taken.add(target);
            applied.push({ rec: u.rec, target });
        }
        let updated = 0;
        for (const u of applied) {
            try {
                await prisma_1.prisma.fileRecord.update({ where: { id: u.rec.id }, data: { originalName: u.target } });
                updated += 1;
            }
            catch (err) {
                failed.push({ id: u.rec.id, error: err.message });
            }
        }
        app_log_1.appLog.info('manage', `批量改名完成：mode=${mode}`, `总数=${ids.length} 更新=${updated} 失败=${failed.length}`);
        return { success: failed.length === 0, updated, failed };
    }
    async batchExpiry(req, body) {
        if (!(await this.userPerm(req, 'edit')))
            return { success: false, message: '没有编辑权限' };
        const ids = this.bodyIds(body);
        if (!ids.length)
            return { success: false, message: '缺少 ids' };
        const { ok: rows } = await this.dropReadonlyShared(await this.loadOwned(ids, req), req);
        const raw = String(body?.linkExpiresAt ?? '');
        let at = null;
        if (raw) {
            const t = Date.parse(raw);
            if (!Number.isFinite(t))
                return { success: false, message: 'linkExpiresAt 不是合法的时间字符串' };
            at = new Date(t);
        }
        const failed = [];
        let updated = 0;
        for (const r of rows) {
            try {
                await prisma_1.prisma.fileRecord.update({ where: { id: r.id }, data: { linkExpiresAt: at } });
                updated += 1;
            }
            catch (err) {
                failed.push({ id: r.id, error: err.message });
            }
        }
        app_log_1.appLog.info('manage', `批量限时${raw ? '设置' : '取消'}完成`, `更新=${updated} 失败=${failed.length}`);
        return { success: true, updated, failed };
    }
    async batchRedirect(req, body) {
        if (!(await this.userPerm(req, 'edit')))
            return { success: false, message: '没有编辑权限' };
        const ids = this.bodyIds(body);
        if (!ids.length)
            return { success: false, message: '缺少 ids' };
        const { ok: rows } = await this.dropReadonlyShared(await this.loadOwned(ids, req), req);
        const url = String(body?.redirectUrl ?? '').trim();
        if (url) {
            try {
                const u = new URL(url);
                if (!['http:', 'https:'].includes(u.protocol))
                    return { success: false, message: '仅支持 http/https 地址' };
            }
            catch {
                return { success: false, message: 'URL 格式不正确' };
            }
        }
        const failed = [];
        let updated = 0;
        for (const r of rows) {
            try {
                await prisma_1.prisma.fileRecord.update({ where: { id: r.id }, data: { redirectUrl: url } });
                updated += 1;
            }
            catch (err) {
                failed.push({ id: r.id, error: err.message });
            }
        }
        app_log_1.appLog.info('manage', `批量重定向${url ? '设置' : '取消'}完成`, `更新=${updated} 失败=${failed.length}`);
        return { success: true, updated, failed };
    }
    async applyFilePassword(rec, password) {
        const metas = (0, file_view_1.safeParse)(rec.metas);
        if (String(password || ''))
            metas.AccessPasswordHash = (0, folder_meta_service_1.sha256Hex)(String(password));
        else
            delete metas.AccessPasswordHash;
        await prisma_1.prisma.fileRecord.update({ where: { id: rec.id }, data: { metas: JSON.stringify(metas) } });
    }
    async batchPassword(req, body) {
        if (!(await this.userPerm(req, 'edit')))
            return { success: false, message: '没有编辑权限' };
        const ids = this.bodyIds(body);
        if (!ids.length)
            return { success: false, message: '缺少 ids' };
        const { ok: rows } = await this.dropReadonlyShared(await this.loadOwned(ids, req), req);
        const failed = [];
        let updated = 0;
        for (const r of rows) {
            try {
                await this.applyFilePassword(r, String(body?.password ?? ''));
                updated += 1;
            }
            catch (err) {
                failed.push({ id: r.id, error: err.message });
            }
        }
        app_log_1.appLog.info('manage', `批量${String(body?.password || '') ? '设置' : '清除'}文件密码完成`, `更新=${updated} 失败=${failed.length}`);
        return { success: true, updated, failed };
    }
    async setPassword(req, id, body) {
        if (!(await this.userPerm(req, 'edit')))
            return { success: false, message: '没有编辑权限' };
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        const rec = await this.resolveFile(id, owner);
        if (!rec)
            return { success: false, message: '文件不存在' };
        await this.applyFilePassword(rec, String(body?.password ?? ''));
        app_log_1.appLog.info('manage', `文件密码已${String(body?.password || '') ? '设置' : '清除'}：${rec.name}`);
        return { success: true, data: { name: rec.name, encrypted: !!String(body?.password || '') } };
    }
    async batchMove(req, body) {
        if (!(await this.userPerm(req, 'edit')))
            return { success: false, message: '没有编辑权限' };
        const ids = this.bodyIds(body);
        const folders = (Array.isArray(body?.folders) ? body.folders : [])
            .map((f) => (0, folder_meta_service_1.normalizeFolderPath)(String(f || '')))
            .filter(Boolean);
        if (!ids.length && !folders.length)
            return { success: false, message: '缺少 ids' };
        if (body?.folder === undefined && body?.instanceId === undefined) {
            return { success: false, message: '缺少 folder 或 instanceId' };
        }
        const targetInstance = body?.instanceId !== undefined ? String(body.instanceId ?? '') : undefined;
        const fromInstance = body?.fromInstanceId !== undefined ? String(body.fromInstanceId ?? '') : undefined;
        if (targetInstance) {
            const inst = await prisma_1.prisma.instance.findUnique({ where: { id: targetInstance }, select: { id: true } });
            if (!inst)
                throw new common_1.BadRequestException('目标实例不存在');
            if (!(await this.canAccessInstance(req, targetInstance))) {
                return { success: false, message: '无权移动到该实例' };
            }
        }
        const data = {};
        if (targetInstance !== undefined)
            data.instanceId = targetInstance;
        if (body?.folder !== undefined)
            data.folder = (0, folder_meta_service_1.normalizeFolderPath)(String(body.folder));
        else if (targetInstance !== undefined)
            data.folder = '';
        const failed = [];
        let moved = 0;
        let tagCopied = 0;
        let movedFolders = 0;
        let movedRegistered = 0;
        if (folders.length) {
            const me = (0, auth_guard_1.currentSession)(req)?.user || '';
            const isAdmin = this.admin(req);
            const distBase = data.folder !== undefined ? data.folder : '';
            const srcInstKey = fromInstance !== undefined
                ? String(fromInstance)
                : (targetInstance !== undefined ? String(targetInstance) : undefined);
            const dstInstKey = targetInstance !== undefined ? String(targetInstance) : srcInstKey;
            const srcInstWhere = srcInstKey !== undefined ? { instanceId: srcInstKey } : {};
            for (const f of folders) {
                if (me) {
                    const info = await (0, folder_meta_service_1.folderSharedPermission)(f, targetInstance || '', me);
                    if (info.shared && info.perm === 'readonly') {
                        failed.push({ id: f, error: '只读共享目录，不允许移动' });
                        continue;
                    }
                }
                const leaf = f.split('/').filter(Boolean).pop() || '';
                const newRoot = [distBase, leaf].filter(Boolean).join('/');
                const moveInst = srcInstWhere;
                const rowsInFolder = await prisma_1.prisma.fileRecord.findMany({
                    where: {
                        ...(isAdmin ? {} : { uploader: me }),
                        ...moveInst,
                        OR: [{ folder: f }, { folder: { startsWith: `${f}/` } }],
                    },
                    select: { id: true, folder: true, instanceId: true, uploader: true },
                });
                for (const r of rowsInFolder) {
                    const suffix = String(r.folder || '').slice(f.length).replace(/^\/+/, '');
                    try {
                        const fromInst = String(r.instanceId || '');
                        const toInst = targetInstance !== undefined ? String(targetInstance) : fromInst;
                        await prisma_1.prisma.fileRecord.update({
                            where: { id: r.id },
                            data: {
                                folder: suffix ? `${newRoot}/${suffix}` : newRoot,
                                ...(targetInstance !== undefined ? { instanceId: targetInstance } : {}),
                            },
                        });
                        if (targetInstance !== undefined && toInst !== fromInst) {
                            tagCopied += await this.copyTagsToInstance(r.id, fromInst, toInst, r.uploader || '');
                        }
                        moved += 1;
                    }
                    catch (err) {
                        failed.push({ id: r.id, error: err.message });
                    }
                }
                try {
                    const metas = await prisma_1.prisma.folderMeta.findMany({
                        where: { ...moveInst, type: folder_meta_service_1.FOLDER_TYPE_FILE, OR: [{ path: f }, { path: { startsWith: `${f}/` } }] },
                    });
                    for (const m of metas) {
                        const suffix = String(m.path || '').slice(f.length).replace(/^\/+/, '');
                        const nextPath = suffix ? `${newRoot}/${suffix}` : newRoot;
                        try {
                            await prisma_1.prisma.folderMeta.update({
                                where: { id: m.id },
                                data: {
                                    path: nextPath,
                                    ...(targetInstance !== undefined ? { instanceId: targetInstance } : {}),
                                },
                            });
                        }
                        catch (err) {
                            if (err.code === 'P2002') {
                                await prisma_1.prisma.folderMeta.delete({ where: { id: m.id } }).catch(() => undefined);
                            }
                            else {
                                throw err;
                            }
                        }
                    }
                }
                catch (err) {
                    app_log_1.appLog.warn('file', `目录属性搬家失败：${f}`, err.message);
                }
                try {
                    movedRegistered += await this.moveRegisteredFolders(isAdmin ? '' : me, [f], distBase, srcInstKey ?? '', dstInstKey ?? '');
                }
                catch (err) {
                    app_log_1.appLog.warn('file', `登记目录搬家失败：${f}`, err.message);
                }
                movedFolders += 1;
            }
        }
        const { ok: rows } = await this.dropReadonlyShared(await this.loadOwned(ids, req), req);
        for (const r of rows) {
            try {
                if (fromInstance !== undefined && String(r.instanceId || '') !== String(fromInstance)) {
                    failed.push({ id: r.id, error: '文件不属于当前实例' });
                    continue;
                }
                const fromInst = String(r.instanceId || '');
                const toInst = targetInstance !== undefined ? String(targetInstance) : fromInst;
                await prisma_1.prisma.fileRecord.update({ where: { id: r.id }, data });
                if (targetInstance !== undefined && toInst !== fromInst) {
                    const n = await this.copyTagsToInstance(r.id, fromInst, toInst, r.uploader || '');
                    if (n)
                        tagCopied += n;
                }
                moved += 1;
            }
            catch (err) {
                failed.push({ id: r.id, error: err.message });
            }
        }
        const dirText = data.folder === undefined ? '(不变)' : data.folder || '(根目录)';
        app_log_1.appLog.info('manage', `批量移动 ${rows.length} 个文件 / ${movedFolders} 个目录 → 实例 ${targetInstance !== undefined ? targetInstance || 'default' : '(不变)'}`, `请求 ${ids.length} 个文件，成功 ${moved} 条记录，失败 ${failed.length} 个 ｜ 目标目录=${dirText}${tagCopied ? ` ｜ 复制标签 ${tagCopied} 条` : ''}`);
        return {
            success: true,
            moved,
            movedFolders,
            movedRegistered,
            tagCopied,
            updated: moved,
            ...(targetInstance !== undefined ? { instanceId: targetInstance } : {}),
            failed,
        };
    }
    async batchCopy(req, body) {
        if (!(await this.userPerm(req, 'edit')))
            return { success: false, message: '没有编辑权限' };
        const ids = this.bodyIds(body);
        const folders = (Array.isArray(body?.folders) ? body.folders : [])
            .map((f) => (0, folder_meta_service_1.normalizeFolderPath)(String(f || '')))
            .filter(Boolean);
        if (!ids.length && !folders.length)
            return { success: false, message: '缺少 ids' };
        const targetInstance = String(body?.instanceId ?? '');
        if (targetInstance) {
            const inst = await prisma_1.prisma.instance.findUnique({ where: { id: targetInstance }, select: { id: true } });
            if (!inst)
                throw new common_1.BadRequestException('目标实例不存在');
            if (!(await this.canAccessInstance(req, targetInstance))) {
                return { success: false, message: '无权复制到该实例' };
            }
        }
        const fromInstance = body?.fromInstanceId !== undefined ? String(body.fromInstanceId ?? '') : undefined;
        const distBase = (0, folder_meta_service_1.normalizeFolderPath)(String(body?.folder ?? ''));
        const me = (0, auth_guard_1.currentSession)(req)?.user || '';
        const ip = this.clientIpOf(req);
        const failed = [];
        let copied = 0;
        let copiedFolders = 0;
        const copyOne = async (recId, folder) => {
            const rec = await prisma_1.prisma.fileRecord.findFirst({
                where: {
                    OR: [{ id: recId }, { name: recId }],
                    ...(this.admin(req) || !me ? {} : { uploader: me }),
                    ...(fromInstance !== undefined ? { instanceId: fromInstance } : {}),
                },
                select: { id: true, name: true, folder: true, instanceId: true },
            });
            if (!rec)
                throw new Error('文件不存在或无权复制');
            if (!this.admin(req) && me) {
                const info = await (0, folder_meta_service_1.folderSharedPermission)(rec.folder || '', String(rec.instanceId || ''), me);
                if (info.shared && info.perm === 'readonly')
                    throw new Error('只读共享目录，不允许复制');
            }
            return this.uploadSvc.copyRecordTo(rec.id, {
                instanceId: targetInstance,
                ...(folder !== undefined ? { folder } : {}),
                uploader: me || undefined,
                ip,
            });
        };
        for (const id of ids) {
            try {
                const r = await copyOne(id, distBase);
                if (r)
                    copied += 1;
            }
            catch (err) {
                failed.push({ id, error: err.message });
            }
        }
        for (const f of folders) {
            const leaf = f.split('/').filter(Boolean).pop() || '';
            const newRoot = [distBase, leaf].filter(Boolean).join('/');
            const rows = await prisma_1.prisma.fileRecord.findMany({
                where: {
                    ...(this.admin(req) || !me ? {} : { uploader: me }),
                    ...(fromInstance !== undefined ? { instanceId: fromInstance } : {}),
                    status: 'active',
                    OR: [{ folder: f }, { folder: { startsWith: `${f}/` } }],
                },
                select: { id: true, folder: true },
            });
            if (!rows.length) {
                failed.push({ id: `folder:${f}`, error: '目录为空或不存在可复制的文件（空目录没有实体，无法复制）' });
                continue;
            }
            for (const r of rows) {
                const suffix = String(r.folder || '').slice(f.length).replace(/^\/+/, '');
                try {
                    const out = await copyOne(r.id, suffix ? `${newRoot}/${suffix}` : newRoot);
                    if (out)
                        copied += 1;
                }
                catch (err) {
                    failed.push({ id: r.id, error: err.message });
                }
            }
            copiedFolders += 1;
        }
        app_log_1.appLog.info('manage', `批量复制 ${ids.length} 个文件 / ${folders.length} 个目录 → 实例 ${targetInstance || 'default'}`, `成功 ${copied} 条记录${copiedFolders ? `（含目录 ${copiedFolders} 个）` : ''}，失败 ${failed.length} 个 ｜ 目标目录=${distBase || '(根)'}`, ip);
        return { success: true, copied, copiedFolders, updated: copied, failed };
    }
    async canAccessInstance(req, instanceId) {
        if (this.admin(req))
            return true;
        return (0, instance_access_1.userInInstance)((0, auth_guard_1.currentSession)(req)?.user || '', instanceId);
    }
    async copyTagsToInstance(fileId, fromInst, toInst, fallbackOwner = '') {
        if (String(fromInst) === String(toInst))
            return 0;
        let copied = 0;
        try {
            const links = await prisma_1.prisma.fileTag.findMany({ where: { fileId }, include: { tag: true } });
            for (const link of links) {
                const src = link.tag;
                if (!src)
                    continue;
                if (String(src.instanceId || '') === String(toInst))
                    continue;
                const target = await (0, tags_1.findOrCreateTag)(src.name, toInst, String(src.owner || fallbackOwner || ''), String(src.type || tags_1.TAG_TYPE_FILE));
                const srcMetas = String(src.metas || '{}');
                if (srcMetas && srcMetas !== '{}' && String(target.metas || '{}') === '{}') {
                    await prisma_1.prisma.tag.update({ where: { id: target.id }, data: { metas: srcMetas } }).catch(() => undefined);
                }
                const exists = await prisma_1.prisma.fileTag.findFirst({
                    where: { fileId, tagId: target.id },
                    select: { id: true },
                });
                if (!exists) {
                    await prisma_1.prisma.fileTag.create({ data: { fileId, tagId: target.id } });
                    copied += 1;
                }
            }
        }
        catch (err) {
            app_log_1.appLog.warn('manage', `跨实例移动时复制标签失败：${fileId}`, err.message);
        }
        return copied;
    }
    directUrlResolver(preferInternal = false) {
        const infoCache = new Map();
        return (copy, rec) => {
            const ch = copy.channel;
            if (!ch)
                return null;
            try {
                let info = infoCache.get(ch.id);
                if (!info) {
                    info = {
                        id: ch.id,
                        name: ch.name,
                        type: ch.type,
                        config: this.channelsSvc.decryptConfig(ch.type, ch.config),
                        metas: {},
                    };
                    infoCache.set(ch.id, info);
                }
                if (!copy.objectPath &&
                    !copy.remoteUrl &&
                    copy.remoteKey &&
                    (0, file_view_1.isRecordFile)(rec) &&
                    (0, record_link_1.hasRecordDomains)(info.config, ch.type)) {
                    const url = (0, record_link_1.joinRecordUrl)((0, record_link_1.recordLoadOrigin)(info.config, preferInternal, ch.type), (0, channel_domain_1.ensureBucketInKey)(ch.type, info.config, copy.remoteKey));
                    if (url) {
                        return preferInternal ? url : (0, channel_domain_1.publicizeExternalUrl)(url, ch.type, info.config);
                    }
                }
                if (!preferInternal) {
                    const built = (0, adapter_factory_1.createAdapter)(info).buildDirectUrl((0, adapter_factory_1.toCopyInfo)(copy), info, false);
                    return (0, channel_domain_1.publicizeExternalUrl)(built, ch.type, info.config);
                }
                return (0, adapter_factory_1.createAdapter)(info).buildDirectUrl((0, adapter_factory_1.toCopyInfo)(copy), info, preferInternal);
            }
            catch {
                return null;
            }
        };
    }
    renamePost(req, body) {
        return this.doRename(wildcardParam(req), body, req);
    }
    async generateRenameName(req) {
        if (!(await this.userPerm(req, 'edit')))
            throw new common_1.ForbiddenException('没有编辑权限');
        for (let i = 0; i < 30; i += 1) {
            const candidate = crypto_service_1.CryptoService.fileId(48);
            const dup = await prisma_1.prisma.fileRecord.findFirst({ where: { name: candidate }, select: { id: true } });
            if (!dup)
                return { success: true, name: candidate };
        }
        app_log_1.appLog.warn('file', '生成重命名候选失败：连续 30 次与库中已有名称重复', '');
        throw new common_1.BadRequestException('生成名称失败，请重试');
    }
    rename(req, body) {
        return this.doRename(wildcardParam(req), body, req);
    }
    async doRename(oldId, body, req) {
        if (!(await this.userPerm(req, 'edit')))
            throw new common_1.ForbiddenException('没有编辑权限');
        const target = String(body.newFileId ?? body.newName ?? '').trim();
        if (!target)
            throw new common_1.BadRequestException('缺少 newFileId');
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        const rec = await this.resolveFile(oldId, owner);
        if (!rec)
            throw new common_1.NotFoundException('文件不存在');
        if (target === rec.name)
            throw new common_1.BadRequestException('文件名未发生变化');
        const newId = target
            .replace(/\\/g, '/')
            .replace(/\/{2,}/g, '/')
            .replace(/^\/+/, '')
            .replace(/\.\./g, '_');
        if (!newId)
            throw new common_1.BadRequestException('文件名不能为空');
        const conflict = await prisma_1.prisma.fileRecord.findFirst({ where: { name: newId, NOT: { id: rec.id } } });
        if (conflict)
            throw new common_1.ConflictException('目标文件名已存在');
        const oldRedirect = String(rec.redirectUrl || '');
        const newRedirect = oldRedirect && oldRedirect.includes(rec.name) ? oldRedirect.split(rec.name).join(newId) : oldRedirect;
        const updated = await prisma_1.prisma.fileRecord.update({
            where: { id: rec.id },
            data: {
                name: newId,
                ...(newRedirect !== oldRedirect ? { redirectUrl: newRedirect } : {}),
                prevName: rec.name,
                firstName: rec.firstName || rec.name,
            },
            include: { copies: { include: { channel: true } }, tags: { include: { tag: true } } },
        });
        app_log_1.appLog.info('file', `重命名：${rec.name} → ${newId}`);
        return {
            success: true,
            newFileId: newId,
            metadata: (0, file_view_1.serializeFile)(updated, updated.copies, { tags: updated.tags.map((t) => t.tag.name), resolveDirectUrl: this.directUrlResolver(), resolveLoadUrl: this.directUrlResolver(true) }).metadata,
        };
    }
    async resolveFile(fileId, owner = '') {
        const key = String(fileId || '');
        const bare = key.replace(/\.[^.]*$/, '');
        return prisma_1.prisma.fileRecord.findFirst({
            where: { ...(owner ? { uploader: owner } : {}), OR: [{ id: key }, { name: key }, { name: bare }] },
            include: { copies: { include: { channel: true } }, tags: { include: { tag: true } } },
        });
    }
    async getMeta(req) {
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        const rec = await this.resolveFile(wildcardParam(req), owner);
        if (!rec)
            return { success: false, message: '文件不存在' };
        const metadata = (0, file_view_1.serializeFile)(rec, rec.copies, {
            tags: rec.tags.map((t) => t.tag.name),
            resolveDirectUrl: this.directUrlResolver(), resolveLoadUrl: this.directUrlResolver(true),
        }).metadata;
        metadata.LinkExpiresAt = rec.linkExpiresAt ? rec.linkExpiresAt.getTime() : 0;
        const refs = await (0, file_refs_1.refsOfFile)(rec.id);
        const bySource = (0, file_refs_1.countBySource)(refs);
        const stats = await (0, file_share_stats_1.fileStats)(rec.id);
        metadata.FileRefCount = stats.ref;
        metadata.FileShareCount = stats.share;
        metadata.FileRefNoteCount = bySource.note;
        metadata.FileRefShareCount = bySource.share;
        metadata.FileRefNotes = refs
            .filter((r) => r.source === 'note')
            .slice(0, 5)
            .map((r) => r.title || '未命名');
        try {
            const m = metadata;
            if (m.UploadIP) {
                const r = await (0, ip_query_1.ipDisplayOf)(String(m.UploadIP), String(m.UploadAddress || ''), this.sysConfig);
                m.IpDisplay = r.display;
                if (r.address)
                    m.UploadAddress = r.address;
            }
        }
        catch {
        }
        return {
            success: true,
            data: {
                metas: rec.metas,
                name: rec.name,
                ...(this.canUseNote(req, rec) ? { note: rec.note, Note: rec.note } : {}),
                metadata,
            },
        };
    }
    async fileRefs(req) {
        const me = (0, auth_guard_1.currentSession)(req)?.user || '';
        if (!me)
            return { success: false, message: '请先登录后再查看引用' };
        const rec = await this.resolveFile(wildcardParam(req), this.admin(req) ? '' : me);
        if (!rec)
            return { success: false, message: '文件不存在或无权查看' };
        const refs = await (0, file_refs_1.refsOfFile)(rec.id);
        const bySource = (0, file_refs_1.countBySource)(refs);
        const stats = await (0, file_share_stats_1.fileStats)(rec.id);
        const members = await (0, file_share_stats_1.sharedMembers)(rec.id);
        return {
            success: true,
            data: {
                fileId: rec.id,
                name: rec.name,
                originalName: rec.originalName,
                count: stats.ref,
                noteCount: bySource.note,
                shareCount: bySource.share,
                sharedCount: stats.share,
                shared: members.map((m) => ({
                    fileId: m.fileId,
                    name: m.name,
                    originalName: m.originalName,
                    uploader: m.uploader,
                    instanceId: m.instanceId,
                    instanceName: m.instanceName,
                    status: m.status,
                    createdAt: m.createdAt,
                    clonedFromMe: m.clonedFromMe,
                })),
                list: refs.map((r) => ({
                    source: r.source,
                    noteId: r.source === 'note' ? r.id : '',
                    shareId: r.source === 'share' ? r.id : '',
                    title: r.title,
                    kind: r.kind,
                    status: r.status,
                    author: r.author,
                    createdAt: r.createdAt,
                })),
            },
        };
    }
    isAuthor(req, rec) {
        const me = (0, auth_guard_1.currentSession)(req)?.user || '';
        if (!me)
            return false;
        const up = String(rec.uploader || '');
        if (up)
            return up === me;
        return this.admin(req);
    }
    canUseNote(req, rec) {
        return this.admin(req) || this.isAuthor(req, rec);
    }
    async canRate(req, rec) {
        if (this.canUseNote(req, rec))
            return true;
        const me = (0, auth_guard_1.currentSession)(req)?.user || '';
        if (!me)
            return false;
        try {
            const hit = await (0, folder_meta_service_1.folderSharedPermission)(rec.folder || '', rec.instanceId || '', me);
            return hit.shared && hit.perm === 'edit';
        }
        catch {
            return false;
        }
    }
    async setExpiry(req, body) {
        if (!(await this.userPerm(req, 'edit')))
            return { success: false, message: '没有编辑权限' };
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        const rec = await this.resolveFile(wildcardParam(req), owner);
        if (!rec)
            return { success: false, message: '文件不存在' };
        if (!this.isAuthor(req, rec))
            return { success: false, message: '只有上传者本人可以设置限时' };
        let at = null;
        if (!body?.clear) {
            if (body?.expiresAt !== undefined && body?.expiresAt !== null && body?.expiresAt !== '') {
                const raw = typeof body.expiresAt === 'number' ? body.expiresAt : Date.parse(String(body.expiresAt));
                if (!Number.isFinite(raw))
                    return { success: false, message: '截止时间格式不正确' };
                at = new Date(raw);
            }
            else {
                const sec = Number(body?.seconds);
                if (!Number.isFinite(sec) || sec <= 0)
                    return { success: false, message: '请设置有效时长或截止时间' };
                at = new Date(Date.now() + sec * 1000);
            }
            if (at.getTime() <= Date.now())
                return { success: false, message: '截止时间必须晚于当前时间' };
        }
        await prisma_1.prisma.fileRecord.update({ where: { id: rec.id }, data: { linkExpiresAt: at } });
        return {
            success: true,
            data: { name: rec.name, LinkExpiresAt: at ? at.getTime() : 0, link: `${await this.linkPrefixSafe()}/${rec.name}` },
        };
    }
    async linkPrefixSafe() {
        try {
            const s = this.settings;
            const domain = await s.getServerDomain();
            return (await s.getLinkPrefix(domain)).replace(/\/+$/, '');
        }
        catch {
            return '';
        }
    }
    async putMeta(req, body) {
        return this.saveMeta(req, body);
    }
    async patchMeta(req, body) {
        return this.saveMeta(req, body);
    }
    async saveMeta(req, body) {
        if (!(await this.userPerm(req, 'edit')))
            return { success: false, message: '没有编辑权限' };
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        const rec = await this.resolveFile(wildcardParam(req), owner);
        if (!rec)
            return { success: false, message: '文件不存在' };
        let metasRaw;
        const patch = {};
        if (body && body.metas !== undefined) {
            metasRaw = typeof body.metas === 'string' ? body.metas : JSON.stringify(body.metas || {});
        }
        else {
            const cur = (0, file_view_1.safeParse)(rec.metas);
            const b = (body || {});
            if (b.Note !== undefined || b.note !== undefined) {
                if (!this.canUseNote(req, rec))
                    return { success: false, message: '只有上传者本人或管理员可以编辑备注' };
                patch.note = String(b.Note ?? b.note ?? '').slice(0, 4000);
            }
            if (b.Rating !== undefined || b.rating !== undefined) {
                if (!(await this.canRate(req, rec)))
                    return { success: false, message: '只有上传者本人、管理员或可编辑共享用户可以评分' };
                const raw = Number(b.Rating ?? b.rating);
                patch.rating = Number.isFinite(raw) ? Math.max(0, Math.min(5, Math.round(raw))) : 0;
            }
            if (b.Level !== undefined || b.level !== undefined) {
                if (!(await this.canRate(req, rec)))
                    return { success: false, message: '只有上传者本人、管理员或可编辑共享用户可以设置等级' };
                const raw = Number(b.Level ?? b.level);
                patch.level = Number.isFinite(raw) ? Math.max(0, Math.min(5, Math.round(raw))) : 0;
            }
            if (b.FileName !== undefined) {
                const next = String(b.FileName || '').trim();
                if (next)
                    patch.originalName = next;
            }
            if (b.FileType !== undefined)
                cur.FileType = String(b.FileType || '');
            if (b.ListType !== undefined) {
                const lt = String(b.ListType || '').trim();
                cur.ListType = lt === 'White' || lt === 'Block' ? lt : 'None';
            }
            if (b.Directory !== undefined) {
                patch.folder = (0, file_view_1.normalizeDir)(String(b.Directory || '')).replace(/\/+$/, '');
            }
            metasRaw = JSON.stringify(cur);
        }
        try {
            JSON.parse(metasRaw);
        }
        catch {
            return { success: false, message: 'metas 不是合法 JSON' };
        }
        await prisma_1.prisma.fileRecord.update({ where: { id: rec.id }, data: { metas: metasRaw, ...patch } });
        if (patch.note !== undefined)
            app_log_1.appLog.info('file', `文件备注已保存：${rec.name}`);
        if (patch.rating !== undefined || patch.level !== undefined) {
            app_log_1.appLog.info('file', `文件评分/等级已保存：${rec.name}`, `评分=${patch.rating ?? '-'} ｜ 等级=${patch.level ?? '-'}`);
        }
        const updated = await this.resolveFile(rec.name, owner);
        return {
            success: true,
            data: {
                metas: metasRaw,
                name: rec.name,
                ...(this.canUseNote(req, rec) ? { note: patch.note !== undefined ? patch.note : rec.note } : {}),
                metadata: updated
                    ? (0, file_view_1.serializeFile)(updated, updated.copies, { tags: updated.tags.map((t) => t.tag.name), resolveDirectUrl: this.directUrlResolver(), resolveLoadUrl: this.directUrlResolver(true) }).metadata
                    : undefined,
            },
        };
    }
    async rebackup(req, body) {
        const ids = await this.filterOwned(body.fileIds || [], req);
        const r = await this.uploadSvc.rebackup(ids);
        return { success: true, data: r };
    }
    async backupSelected(req, body) {
        return this.rebackup(req, body);
    }
    async backupSelectedFiles(req, body) {
        return this.rebackup(req, body);
    }
    async backupOne(req) {
        const key = wildcardParam(req);
        if (!key)
            return { success: false, message: '缺少文件名' };
        const ids = await this.filterOwned([key], req);
        if (!ids.length)
            return { success: false, message: '文件不存在' };
        const r = await this.uploadSvc.rebackup(ids);
        return { success: r.ok > 0 || r.skipped > 0, data: r, message: r.ok > 0 ? '备份成功' : r.skipped > 0 ? '该文件已有备份' : '备份失败，请检查备份渠道配置' };
    }
    async setRedirect(req, body) {
        if (!(await this.userPerm(req, 'edit')))
            return { success: false, message: '没有编辑权限' };
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        const rec = await this.resolveFile(wildcardParam(req), owner);
        if (!rec)
            return { success: false, message: '文件不存在' };
        const url = String(body.url || '').trim();
        if (url) {
            try {
                const u = new URL(url);
                if (!['http:', 'https:'].includes(u.protocol))
                    return { success: false, message: '仅支持 http/https 地址' };
            }
            catch {
                return { success: false, message: 'URL 格式不正确' };
            }
        }
        await prisma_1.prisma.fileRecord.update({ where: { id: rec.id }, data: { redirectUrl: url } });
        return { success: true, data: { redirectUrl: url } };
    }
    async createFolder(req, q, body) {
        let base = String(body.dir || '').replace(/^\/+|\/+$/g, '');
        let rawName = body.name;
        if (!rawName && body.path) {
            const parts = String(body.path).replace(/^\/+|\/+$/g, '').split('/');
            rawName = parts.pop() || '';
            base = parts.join('/');
        }
        const name = String(rawName || '').trim().replace(/^\/+|\/+$/g, '').replace(/\.\./g, '_');
        if (!name)
            return { success: false, message: '目录名不能为空' };
        const full = base ? `${base}/${name}` : name;
        const instanceId = String(body?.instanceId ?? q?.instanceId ?? '');
        await this.registerFolder(req, full, instanceId);
        app_log_1.appLog.info('file', `新建目录：${full}`, `实例=${instanceId || '默认'}`);
        return { success: true, data: { path: full } };
    }
    extraFoldersKey(owner, instanceId) {
        return (0, folder_meta_service_1.extraFoldersKey)(owner, instanceId);
    }
    extraFoldersOf(map, owner, instanceId) {
        return (0, folder_meta_service_1.extraFoldersOf)(map, owner, instanceId);
    }
    async registerFolder(req, full, instanceId = '') {
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        const raw = await this.settings.get('extraFolders', '{}');
        let map = {};
        try {
            map = raw ? JSON.parse(raw) : {};
        }
        catch {
            map = {};
        }
        const key = this.extraFoldersKey(owner, instanceId);
        const list = new Set(Array.isArray(map[key]) ? map[key] : []);
        const fullPath = full.replace(/^\/+|\/+$/g, '');
        list.add(fullPath);
        map[key] = Array.from(list).sort();
        if (this.admin(req)) {
            const legacyKey = this.extraFoldersKey('', instanceId);
            if (Array.isArray(map[legacyKey])) {
                map[legacyKey] = map[legacyKey].filter((p) => p !== fullPath);
                if (!map[legacyKey].length)
                    delete map[legacyKey];
            }
        }
        await this.settings.set('extraFolders', JSON.stringify(map));
    }
    async extraFolders(req, instanceId = '') {
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        try {
            const map = JSON.parse((await this.settings.get('extraFolders', '{}')) || '{}');
            const mine = this.extraFoldersOf(map, owner, instanceId);
            if (!this.admin(req) || !owner)
                return mine;
            const legacy = this.extraFoldersOf(map, '', instanceId);
            return Array.from(new Set([...mine, ...legacy])).sort();
        }
        catch {
            return [];
        }
    }
    async unregisterFolders(owner, prefix, instanceId = '') {
        const p = String(prefix || '').replace(/^\/+|\/+$/g, '');
        if (!p)
            return 0;
        let map = {};
        try {
            map = JSON.parse((await this.settings.get('extraFolders', '{}')) || '{}');
        }
        catch {
            map = {};
        }
        const key = this.extraFoldersKey(owner, instanceId);
        const list = Array.isArray(map[key]) ? map[key] : [];
        const kept = list.filter((d) => d !== p && !String(d).startsWith(`${p}/`));
        const removed = list.length - kept.length;
        if (removed > 0) {
            map[key] = kept;
            await this.settings.set('extraFolders', JSON.stringify(map));
        }
        return removed;
    }
    async moveRegisteredFolders(owner, folders, distBase, fromInstance = '', toInstance = '') {
        if (!folders.length)
            return 0;
        let map = {};
        try {
            map = JSON.parse((await this.settings.get('extraFolders', '{}')) || '{}');
        }
        catch {
            map = {};
        }
        const srcKey = this.extraFoldersKey(owner, fromInstance);
        const dstKey = this.extraFoldersKey(owner, toInstance);
        let list = Array.isArray(map[srcKey]) ? [...map[srcKey]] : [];
        let changed = 0;
        for (const raw of folders) {
            const f = String(raw || '').replace(/^\/+|\/+$/g, '');
            if (!f)
                continue;
            const leaf = f.split('/').filter(Boolean).pop() || '';
            const newRoot = [String(distBase || '').replace(/^\/+|\/+$/g, ''), leaf].filter(Boolean).join('/');
            const next = [];
            for (const d of list) {
                if (d === f || d.startsWith(`${f}/`)) {
                    const suffix = d.slice(f.length).replace(/^\/+/, '');
                    next.push(suffix ? `${newRoot}/${suffix}` : newRoot);
                    changed += 1;
                }
                else {
                    next.push(d);
                }
            }
            list = next;
        }
        if (changed > 0) {
            map[srcKey] = Array.from(new Set(list)).sort();
            if (dstKey !== srcKey) {
                const dstList = Array.isArray(map[dstKey]) ? map[dstKey] : [];
                map[dstKey] = Array.from(new Set([...dstList, ...list])).sort();
            }
            await this.settings.set('extraFolders', JSON.stringify(map));
        }
        return changed;
    }
    async proxyDownload(req, res, url, name) {
        const raw = String(url || '').trim();
        if (!/^https?:\/\//i.test(raw)) {
            throw new common_1.BadRequestException('只支持 http / https 链接');
        }
        let target;
        try {
            target = new URL(raw);
        }
        catch {
            throw new common_1.BadRequestException('链接格式不正确');
        }
        const guess = decodeURIComponent((target.pathname || '').split('/').filter(Boolean).pop() || '') || 'download';
        const fileName = String(name || guess).replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120) || 'download';
        let upstream;
        try {
            upstream = await fetch(target.toString(), {
                redirect: 'follow',
                headers: { 'User-Agent': 'GoHub/1.0.7 (+link-download)' },
                signal: AbortSignal.timeout(60000),
            });
        }
        catch (err) {
            throw new common_1.BadRequestException(`远端文件获取失败：${err.message}`);
        }
        if (!upstream.ok || !upstream.body) {
            throw new common_1.BadRequestException(`远端返回 ${upstream.status}`);
        }
        const len = Number(upstream.headers.get('content-length') || 0);
        if (len > 2 * 1024 * 1024 * 1024)
            throw new common_1.BadRequestException('文件超过 2GB，请直接打开原链接下载');
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
        if (len > 0)
            res.setHeader('Content-Length', String(len));
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        res.setHeader('Cache-Control', 'no-store');
        app_log_1.appLog.info('file', '链接下载中转', `${target.origin}${target.pathname}`.slice(0, 200), this.clientIpOf(req));
        const body = node_stream_1.Readable.fromWeb(upstream.body);
        body.on('error', () => {
            if (!res.headersSent)
                res.status(502);
            res.end();
        });
        body.pipe(res);
    }
    clientIpOf(req) {
        const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        return (fwd || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    }
    async convertOptions(req, id) {
        const me = (0, auth_guard_1.currentSession)(req)?.user || '';
        const rec = await prisma_1.prisma.fileRecord.findFirst({
            where: { uploader: me, status: 'active', OR: [{ id }, { name: id }] },
            include: { copies: { include: { channel: true } } },
        });
        if (!rec)
            return { success: false, message: '文件不存在或无权操作' };
        const copy = rec.copies.find((c) => c.status === 'active' && c.isPrimary) ||
            rec.copies.find((c) => c.status === 'active');
        const ch = copy?.channel || null;
        const isLocalType = (t) => t === 'local' || t === 'localfiles';
        const srcLocal = !!ch && isLocalType(ch.type);
        const all = await prisma_1.prisma.channel.findMany({
            where: { enabled: true, isBackup: false },
            orderBy: [{ typeCode: 'asc' }, { name: 'asc' }],
            select: { id: true, name: true, type: true },
        });
        const channels = all.filter((c) => srcLocal ? !isLocalType(c.type) : c.type === 'local');
        const registered = String(rec.uploadSource || '') === 'Record';
        const pending = this.readConvertPending(copy?.metas);
        return {
            success: true,
            direction: srcLocal ? 'to-remote' : 'to-local',
            currentChannel: ch ? { name: ch.name, type: ch.type } : null,
            registered,
            canDeleteSource: !srcLocal && !registered,
            forceDeleteSource: srcLocal,
            channels,
            pending,
        };
    }
    readConvertPending(metas) {
        try {
            const obj = JSON.parse(String(metas || '{}'));
            const c = obj?.__convert;
            if (!c || typeof c !== 'object')
                return null;
            return {
                state: String(c.state || 'pending'),
                targetChannelId: String(c.targetChannelId || ''),
                targetChannelName: String(c.targetChannelName || ''),
                attempts: Number(c.attempts) || 0,
                lastError: String(c.lastError || ''),
                hasStaged: !!c.staged,
                startedAt: Number(c.startedAt) || 0,
            };
        }
        catch {
            return null;
        }
    }
    async convertFile(req, body) {
        const me = (0, auth_guard_1.currentSession)(req)?.user || '';
        if (!me)
            return { success: false, message: '未登录' };
        if (!(await this.userPerm(req, 'edit')))
            return { success: false, message: '没有编辑权限' };
        const id = String(body?.id || '');
        const channelId = String(body?.channelId || '');
        if (!id || !channelId)
            return { success: false, message: '缺少文件或目标渠道' };
        const r = await this.uploadSvc.convertChannel({
            recordId: id,
            targetChannelId: channelId,
            deleteSource: body?.deleteSource === true,
            uploader: me,
            ip: req.ip,
        });
        if (!r.ok) {
            app_log_1.appLog.warn('channel', `文件转存失败：${r.message || '未知原因'}`, `fileId=${id}${r.retryable ? ' ｜ 可在详情页点「重试转存」继续' : ''}`, req.ip);
            return { success: false, message: r.message || '转存失败', retryable: r.retryable === true };
        }
        return { success: true, ...r };
    }
    async foldersAll(req, q) {
        const instanceId = String(q.instanceId ?? '');
        const admin = this.admin(req);
        const me = (0, auth_guard_1.currentSession)(req)?.user || '';
        const rows = await prisma_1.prisma.fileRecord.groupBy({
            by: ['folder'],
            where: { status: 'active', instanceId, uploader: me },
        });
        const base = new Set(rows.map((r) => r.folder).filter(Boolean));
        if (!admin) {
            for (const d of await (0, folder_meta_service_1.listSharedFoldersFor)(me, instanceId))
                base.add(d.path);
        }
        const metas = await prisma_1.prisma.folderMeta.findMany({
            where: { instanceId, type: folder_meta_service_1.FOLDER_TYPE_FILE, ...(admin ? {} : { owner: me }) },
            select: { path: true, metas: true },
        });
        const displayNames = {};
        for (const m of metas) {
            const p = String(m.path || '').replace(/^\/+|\/+$/g, '');
            if (!p)
                continue;
            base.add(p);
            const name = String((0, file_view_1.safeParse)(m.metas).displayName || '').trim();
            if (name)
                displayNames[p] = name;
        }
        for (const d of await this.extraFolders(req, instanceId)) {
            const p = String(d || '').replace(/^\/+|\/+$/g, '');
            if (p)
                base.add(p);
        }
        const all = new Set();
        for (const f of base) {
            const segs = f.split('/').filter(Boolean);
            for (let i = 1; i <= segs.length; i += 1)
                all.add(segs.slice(0, i).join('/'));
        }
        return {
            success: true,
            data: Array.from(all).sort((a, b) => a.localeCompare(b)),
            displayNames,
        };
    }
    async stats() {
        const [fileCount, sizeAgg, channels] = await Promise.all([
            prisma_1.prisma.fileRecord.count({ where: { status: 'active' } }),
            prisma_1.prisma.fileRecord.aggregate({ where: { status: 'active' }, _sum: { size: true } }),
            prisma_1.prisma.channel.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
        ]);
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        since.setDate(since.getDate() - 6);
        const recent = await prisma_1.prisma.fileRecord.findMany({
            where: { status: 'active', createdAt: { gte: since } },
            select: { createdAt: true },
        });
        const byDay = {};
        for (let i = 0; i < 7; i++) {
            const d = new Date(since);
            d.setDate(d.getDate() + i);
            byDay[d.toISOString().slice(0, 10)] = 0;
        }
        for (const r of recent) {
            const k = r.createdAt.toISOString().slice(0, 10);
            if (k in byDay)
                byDay[k] += 1;
        }
        const copies = await prisma_1.prisma.fileCopy.groupBy({
            by: ['channelId', 'status'],
            _count: { _all: true },
        });
        const briefOf = (c) => c ? { id: c.id, code: c.code, name: c.name, type: c.type, enabled: true } : null;
        return {
            success: true,
            data: {
                fileCount,
                totalSize: sizeAgg._sum.size || 0,
                channelCount: channels.length,
                mainChannel: briefOf(await this.storageChannel.getStorageChannel('', 'main')),
                backupChannel: briefOf(await this.storageChannel.getStorageChannel('', 'backup')),
                accessChannel: await this.settings.getAccessChannel(),
                backupEnabled: (await this.settings.get('backupEnabled', 'true')) === 'true',
                allowUpload: (await this.settings.get('allowUpload', 'true')) === 'true',
                serverDomain: (await this.settings.getServerDomain()) || '',
                byDay: Object.entries(byDay).map(([date, count]) => ({ date, count })),
                channels: channels.map((c) => {
                    const mine = copies.filter((x) => x.channelId === c.id);
                    const sum = (st) => mine.filter((x) => x.status === st).reduce((a, b) => a + b._count._all, 0);
                    return {
                        id: c.id,
                        name: c.name,
                        type: c.type,
                        enabled: c.enabled,
                        isMain: c.isMain,
                        isBackup: c.isBackup,
                        active: sum('active'),
                        failed: sum('failed'),
                        pending: sum('pending'),
                    };
                }),
            },
        };
    }
    async lists() {
        return { success: true, data: await this.readLists() };
    }
    async addWhite(ip) {
        return this.mutateList('whiteIpList', ip, 'add');
    }
    async delWhite(ip) {
        return this.mutateList('whiteIpList', ip, 'del');
    }
    async addBlock(ip) {
        return this.mutateList('blockIpList', ip, 'add');
    }
    async delBlock(ip) {
        return this.mutateList('blockIpList', ip, 'del');
    }
    async setListsEnabled(body) {
        const v = body.enabled === true || body.enabled === 'true';
        await this.settings.set('securityEnabled', v ? 'true' : 'false');
        return { success: true };
    }
    async ipQueryDatStatus() {
        return { success: true, data: (0, qqwry_1.qqwryStatus)() };
    }
    async ipQueryDatUpload(req) {
        const chunks = [];
        let total = 0;
        const MAX = 64 * 1024 * 1024;
        await new Promise((resolve, reject) => {
            req.on('data', (c) => {
                total += c.length;
                if (total > MAX) {
                    reject(new Error('文件超过 64MB 上限'));
                    req.destroy();
                    return;
                }
                chunks.push(c);
            });
            req.on('end', () => resolve());
            req.on('error', reject);
        });
        const buf = Buffer.concat(chunks);
        if (!buf.length)
            return { success: false, message: '未收到数据包内容' };
        try {
            const r = (0, qqwry_1.saveQqwry)(buf);
            console.log(`[security] qqwry.dat 上传成功：${r.records.toLocaleString()} 条，${(r.sizeBytes / 1048576).toFixed(1)} MB`);
            return { success: true, data: r };
        }
        catch (err) {
            console.error('[security] qqwry.dat 上传失败:', err?.message || err);
            return { success: false, message: String(err?.message || '数据包解析失败') };
        }
    }
    async readLists() {
        const parse = (raw) => {
            if (!raw)
                return [];
            try {
                const v = JSON.parse(raw);
                return Array.isArray(v) ? v.map(String) : [];
            }
            catch {
                return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
            }
        };
        return {
            white: parse(await this.settings.get('whiteIpList', '[]')),
            block: parse(await this.settings.get('blockIpList', '[]')),
            enabled: (await this.settings.get('securityEnabled', 'false')) === 'true',
        };
    }
    async mutateList(key, ip, mode) {
        const cur = await this.readLists();
        const list = key === 'whiteIpList' ? cur.white : cur.block;
        const next = mode === 'add'
            ? Array.from(new Set([...list, ip]))
            : list.filter((x) => x !== ip);
        await this.settings.set(key, JSON.stringify(next));
        return { success: true, data: await this.readLists() };
    }
    async getWebdav() {
        const raw = await this.settings.get('webdav', '');
        try {
            return { success: true, data: raw ? JSON.parse(raw) : {} };
        }
        catch {
            return { success: true, data: {} };
        }
    }
    async saveWebdav(body) {
        await this.settings.set('webdav', JSON.stringify(body || {}));
        return { success: true };
    }
    async getSysConfig(section) {
        return this.sysConfig.get(section);
    }
    getLogs(q) {
        const data = app_log_1.appLog.list({
            level: q.level,
            scope: q.scope,
            keyword: q.keyword,
            limit: Number(q.limit) || 200,
            since: Number(q.since) || 0,
            date: q.date,
        });
        return { success: true, ...data, scopes: app_log_1.appLog.scopes(), stats: app_log_1.appLog.stats(), files: app_log_1.appLog.logFiles() };
    }
    clearLogs() {
        return { success: true, cleared: app_log_1.appLog.clear() };
    }
    testLog() {
        app_log_1.appLog.info('debug', '这是一条来自后台的测试日志', `时间：${new Date().toLocaleString('zh-CN')}`);
        return { success: true };
    }
    logFiles() {
        return { success: true, data: app_log_1.appLog.logFiles() };
    }
    exportLogs(q, res) {
        const data = app_log_1.appLog.list({
            level: q.level,
            scope: q.scope,
            keyword: q.keyword,
            limit: Number(q.limit) || 5000,
            since: Number(q.since) || 0,
        });
        const text = (data.entries || [])
            .map((e) => `${new Date(e.at).toISOString()} [${e.level.toUpperCase()}] [${e.scope}] ${e.message}${e.detail ? ` ｜ ${e.detail}` : ''}${e.ip ? ` ｜ ip=${e.ip}` : ''}`)
            .join('\n');
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="GoHub-logs-${stamp}.log"`);
        return res.send(text || '(无日志)');
    }
    startBackupAll() {
        return { success: true, data: this.uploadSvc.startBackupAll() };
    }
    backupAllStatus() {
        return { success: true, data: this.uploadSvc.backupAllStatus() };
    }
    async postSysConfig(section, body, res) {
        return this.persistSysConfig(section, body, res);
    }
    async putSysConfig(section, body, res) {
        return this.persistSysConfig(section, body, res);
    }
    async persistSysConfig(section, body, res) {
        const out = await this.sysConfig.save(section, body);
        app_log_1.appLog.info('settings', `系统配置已保存：${section} 分区`);
        if (section === 'security' && out?.adminPasswordChanged) {
            res.clearCookie(auth_guard_1.SESSION_COOKIE, { path: '/' });
        }
        return out;
    }
    async mediaLimitSeconds(id, fallback = 600) {
        try {
            const page = await this.sysConfig.get('page');
            const hit = (page?.config || []).find((x) => x.id === id);
            const raw = hit && hit.value !== undefined && hit.value !== null ? String(hit.value).trim() : '';
            if (raw === '')
                return fallback;
            const n = Number(raw);
            if (!Number.isFinite(n) || n < 0)
                return fallback;
            return Math.floor(n);
        }
        catch {
            return fallback;
        }
    }
    static mediaKindOf(mime, ext) {
        const m = String(mime || '').toLowerCase();
        if (m.startsWith('image/'))
            return 'image';
        if (m.startsWith('video/'))
            return 'video';
        if (m.startsWith('audio/'))
            return 'audio';
        const e = String(ext || '').toLowerCase();
        if (['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'].includes(e))
            return 'image';
        if (['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'].includes(e))
            return 'video';
        if (['mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg'].includes(e))
            return 'audio';
        return '';
    }
    async mediaInfo(id, req) {
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        const { target, reason } = await (0, media_edit_1.resolveMediaTarget)(id, owner);
        if (!target)
            return { success: false, message: reason || '文件不可编辑' };
        const kind = ManageController_1.mediaKindOf(target.mime, target.ext);
        const isWebp = target.ext === 'webp' || String(target.mime || '').toLowerCase() === 'image/webp';
        let videoCodec = '';
        let videoCodecLabelText = '';
        if (kind === 'video') {
            try {
                videoCodec = await (0, compress_1.probeVideoCodecFile)(target.abs);
                videoCodecLabelText = (0, media_edit_1.videoCodecLabel)(videoCodec);
            }
            catch {
                videoCodec = '';
            }
        }
        return {
            success: true,
            data: {
                id: target.id,
                name: target.name,
                ext: target.ext,
                mime: target.mime,
                size: target.size,
                originalSize: target.originalSize,
                kind,
                videoCodec,
                videoCodecLabel: videoCodecLabelText,
                compressedBefore: target.compressedBefore,
                localPath: target.abs,
                canCrop: kind === 'image',
                canCompress: kind === 'image' || kind === 'video' || kind === 'audio',
                canWebp: kind === 'image' && !isWebp,
                canTranscode: kind === 'video',
            },
        };
    }
    async mediaCrop(body, file, req) {
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        const id = String(body?.id ?? body?.fileId ?? '').trim();
        if (!id)
            return { success: false, message: '缺少文件标识' };
        if (!file?.buffer?.length)
            return { success: false, message: '没有收到裁剪后的图片数据' };
        const { target, reason } = await (0, media_edit_1.resolveMediaTarget)(id, owner);
        if (!target)
            return { success: false, message: reason || '文件不可编辑' };
        const r = await (0, media_edit_1.cropImage)(target, file.buffer);
        if (!r.ok) {
            app_log_1.appLog.warn('file', `原位裁剪失败：${target.name}`, r.message || '');
            return { success: false, message: r.message || '裁剪失败' };
        }
        app_log_1.appLog.info('file', `原位裁剪完成：${target.name}`, `${target.size} → ${r.size}`);
        return { success: true, data: r };
    }
    async mediaCompress(body, req) {
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        const id = String(body?.id ?? body?.fileId ?? '').trim();
        const percent = Number(body?.percent ?? 0);
        if (!id)
            return { success: false, message: '缺少文件标识' };
        if (!Number.isFinite(percent) || percent < 10 || percent > 99) {
            return { success: false, message: '压缩比例需在 10~99 之间（目标体积占原体积的百分比）' };
        }
        const { target, reason } = await (0, media_edit_1.resolveMediaTarget)(id, owner);
        if (!target)
            return { success: false, message: reason || '文件不可编辑' };
        if (target.compressedBefore && String(body?.confirm ?? '') !== '1') {
            return {
                success: false,
                needConfirm: true,
                message: `「${target.name}」已经压缩过一次，再压会继续损失画质，确认继续吗？`,
            };
        }
        const maxSeconds = await this.mediaLimitSeconds('compressMaxSeconds', 600);
        const r = await (0, media_edit_1.compressInPlace)(target, percent, maxSeconds);
        if (!r.ok) {
            if (/上限时长/.test(r.message || ''))
                (0, media_edit_1.logAbandoned)(target.name, '压缩', r.message || '');
            return { success: false, message: r.message || '压缩失败' };
        }
        app_log_1.appLog.info('file', `原位压缩完成：${target.name}`, `${target.size} → ${r.size}（目标 ${percent}%）`);
        return { success: true, data: r };
    }
    async mediaWebp(body, req) {
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        const id = String(body?.id ?? body?.fileId ?? '').trim();
        if (!id)
            return { success: false, message: '缺少文件标识' };
        const raw = String(body?.mode ?? body?.lossless ?? 'lossy').toLowerCase();
        const lossless = raw === 'lossless' || raw === 'true' || raw === '1';
        const { target, reason } = await (0, media_edit_1.resolveMediaTarget)(id, owner);
        if (!target)
            return { success: false, message: reason || '文件不可编辑' };
        const r = await (0, media_edit_1.toWebp)(target, lossless);
        if (!r.ok)
            return { success: false, message: r.message || '转 WebP 失败' };
        app_log_1.appLog.info('file', `原位转 WebP（${lossless ? '无损' : '有损'}）：${target.name}`, `${target.size} → ${r.size}`);
        return { success: true, data: r };
    }
    async mediaTranscode(body, req) {
        const owner = (0, auth_guard_1.currentSession)(req)?.user || '';
        const id = String(body?.id ?? body?.fileId ?? '').trim();
        if (!id)
            return { success: false, message: '缺少文件标识' };
        const { target, reason } = await (0, media_edit_1.resolveMediaTarget)(id, owner);
        if (!target)
            return { success: false, message: reason || '文件不可编辑' };
        const maxSeconds = await this.mediaLimitSeconds('videoTranscodeMaxSeconds', 600);
        const r = await (0, media_edit_1.transcodeInPlace)(target, maxSeconds);
        if (!r.ok) {
            if (/上限时长/.test(r.message || ''))
                (0, media_edit_1.logAbandoned)(target.name, '转码', r.message || '');
            return { success: false, message: r.message || '转码失败' };
        }
        app_log_1.appLog.info('file', `原位转码完成：${target.name}`, `${target.size} → ${r.size}`);
        return { success: true, data: r };
    }
};
exports.ManageController = ManageController;
__decorate([
    (0, common_1.Get)('list'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('delete/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "deleteByGet", null);
__decorate([
    (0, common_1.Delete)('delete/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "deleteByDelete", null);
__decorate([
    (0, common_1.Get)('trash'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "trashList", null);
__decorate([
    (0, common_1.Get)('trash/restore/*'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "trashRestore", null);
__decorate([
    (0, common_1.Get)('trash/purge/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "trashPurge", null);
__decorate([
    (0, common_1.Delete)('trash/purge/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "trashPurgeDelete", null);
__decorate([
    (0, common_1.Post)('trash/batch'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "trashBatch", null);
__decorate([
    (0, common_1.Post)('batch/original-name'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "batchOriginalName", null);
__decorate([
    (0, common_1.Post)('batch/expiry'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "batchExpiry", null);
__decorate([
    (0, common_1.Post)('batch/redirect'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "batchRedirect", null);
__decorate([
    (0, common_1.Post)('batch/password'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "batchPassword", null);
__decorate([
    (0, common_1.Post)(':id/password'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "setPassword", null);
__decorate([
    (0, common_1.Post)('batch/move'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "batchMove", null);
__decorate([
    (0, common_1.Post)('batch/copy'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "batchCopy", null);
__decorate([
    (0, common_1.Post)('rename/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "renamePost", null);
__decorate([
    (0, common_1.Get)('rename/generate'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "generateRenameName", null);
__decorate([
    (0, common_1.Patch)('rename/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "rename", null);
__decorate([
    (0, common_1.Get)('metadata/*'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "getMeta", null);
__decorate([
    (0, common_1.Get)('api/file-refs/*'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "fileRefs", null);
__decorate([
    (0, common_1.Post)('expiry/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "setExpiry", null);
__decorate([
    (0, common_1.Put)('metadata/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "putMeta", null);
__decorate([
    (0, common_1.Patch)('metadata/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "patchMeta", null);
__decorate([
    (0, common_1.Put)('batch/rebackup'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "rebackup", null);
__decorate([
    (0, common_1.Post)('batch/backupSelected'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "backupSelected", null);
__decorate([
    (0, common_1.Post)('files/batch/backupSelected'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "backupSelectedFiles", null);
__decorate([
    (0, common_1.Post)('files/backup/*'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "backupOne", null);
__decorate([
    (0, common_1.Post)('files/redirect/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "setRedirect", null);
__decorate([
    (0, common_1.Post)('folder'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "createFolder", null);
__decorate([
    (0, common_1.Get)('download'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Query)('url')),
    __param(3, (0, common_1.Query)('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "proxyDownload", null);
__decorate([
    (0, common_1.Get)('convert/options/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "convertOptions", null);
__decorate([
    (0, common_1.Post)('convert'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "convertFile", null);
__decorate([
    (0, common_1.Get)('folders/all'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "foldersAll", null);
__decorate([
    (0, common_1.Get)('stats'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "stats", null);
__decorate([
    (0, common_1.Get)('lists'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "lists", null);
__decorate([
    (0, common_1.Post)('white/:ip'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('ip')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "addWhite", null);
__decorate([
    (0, common_1.Delete)('white/:ip'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('ip')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "delWhite", null);
__decorate([
    (0, common_1.Post)('block/:ip'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('ip')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "addBlock", null);
__decorate([
    (0, common_1.Delete)('block/:ip'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('ip')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "delBlock", null);
__decorate([
    (0, common_1.Put)('lists/enabled'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "setListsEnabled", null);
__decorate([
    (0, common_1.Get)('security/ip-query/dat'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "ipQueryDatStatus", null);
__decorate([
    (0, common_1.Post)('security/ip-query/dat'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "ipQueryDatUpload", null);
__decorate([
    (0, common_1.Get)('webdav'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "getWebdav", null);
__decorate([
    (0, common_1.Post)('webdav'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "saveWebdav", null);
__decorate([
    (0, common_1.Get)('sysConfig/:section'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('section')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "getSysConfig", null);
__decorate([
    (0, common_1.Get)('logs'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "getLogs", null);
__decorate([
    (0, common_1.Delete)('logs'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "clearLogs", null);
__decorate([
    (0, common_1.Post)('logs/test'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "testLog", null);
__decorate([
    (0, common_1.Get)('logs/files'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "logFiles", null);
__decorate([
    (0, common_1.Get)('logs/export'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "exportLogs", null);
__decorate([
    (0, common_1.Post)('backupAll/start'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "startBackupAll", null);
__decorate([
    (0, common_1.Get)('backupAll/status'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ManageController.prototype, "backupAllStatus", null);
__decorate([
    (0, common_1.Post)('sysConfig/:section'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('section')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "postSysConfig", null);
__decorate([
    (0, common_1.Put)('sysConfig/:section'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('section')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "putSysConfig", null);
__decorate([
    (0, common_1.Get)('media/info/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "mediaInfo", null);
__decorate([
    (0, common_1.Post)('media/crop'),
    (0, common_2.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: 64 * 1024 * 1024 } })),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_2.UploadedFile)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "mediaCrop", null);
__decorate([
    (0, common_1.Post)('media/compress'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "mediaCompress", null);
__decorate([
    (0, common_1.Post)('media/webp'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "mediaWebp", null);
__decorate([
    (0, common_1.Post)('media/transcode'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageController.prototype, "mediaTranscode", null);
exports.ManageController = ManageController = ManageController_1 = __decorate([
    (0, common_1.Controller)('api/manage'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        sysconfig_service_1.SysConfigService,
        channels_controller_1.ChannelsService,
        upload_service_1.UploadService,
        storage_channel_service_1.StorageChannelService])
], ManageController);
let UserConfigController = class UserConfigController {
    settings;
    sysConfig;
    uploadSvc;
    storageChannel;
    constructor(settings, sysConfig, uploadSvc, storageChannel) {
        this.settings = settings;
        this.sysConfig = sysConfig;
        this.uploadSvc = uploadSvc;
        this.storageChannel = storageChannel;
    }
    channelBrief(c) {
        return c ? { id: c.id, code: c.code, name: c.name, type: c.type } : null;
    }
    parseRetryTimes(raw) {
        const n = Number(String(raw ?? '').trim());
        if (String(raw ?? '').trim() === '')
            return 3;
        if (!Number.isFinite(n) || n < 0)
            return 3;
        if (n === 0)
            return 0;
        return Math.min(999, Math.floor(n));
    }
    async userConfig(req) {
        const s = this.settings;
        const uploader = (0, auth_guard_1.currentSession)(req)?.user || '';
        const domain = (await s.getServerDomain()) || (0, request_origin_1.signOrigin)(req);
        let accountTotpEnabled = false;
        let accountUploadBk = [];
        let accountAdminBk = [];
        if (uploader) {
            const u = await prisma_1.prisma.user
                .findUnique({
                where: { username: uploader },
                select: { totpEnabled: true, uploadBkImg: true, adminBkImg: true },
            })
                .catch(() => null);
            accountTotpEnabled = !!u?.totpEnabled;
            const parseBk = (raw) => {
                if (!raw)
                    return [];
                try {
                    const a = JSON.parse(raw);
                    return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()) : [];
                }
                catch {
                    return [];
                }
            };
            accountUploadBk = parseBk(u?.uploadBkImg);
            accountAdminBk = parseBk(u?.adminBkImg);
        }
        const bool = async (k, d = false) => (await s.get(k, d ? 'true' : 'false')) === 'true';
        let page = { config: [] };
        try {
            page = await this.sysConfig.get('page');
        }
        catch {
        }
        const pv = (id, d = '') => {
            const item = (page?.config || []).find((x) => x.id === id);
            return item && item.value !== undefined && item.value !== null && item.value !== '' ? item.value : d;
        };
        const pb = (id, d = true) => {
            const v = pv(id, d);
            if (typeof v === 'boolean')
                return v;
            const t = String(v).trim().toLowerCase();
            if (t === 'false' || t === '0' || t === 'off' || t === 'no')
                return false;
            if (t === 'true' || t === '1' || t === 'on' || t === 'yes')
                return true;
            return d;
        };
        const asBk = (v) => {
            if (Array.isArray(v))
                return v;
            if (typeof v === 'string') {
                const s = v.trim();
                if (!s)
                    return [];
                if (s.toLowerCase() === 'bing')
                    return 'bing';
                if (s.startsWith('[')) {
                    try {
                        const a = JSON.parse(s);
                        return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()) : [];
                    }
                    catch {
                        return [];
                    }
                }
                return [s];
            }
            return [];
        };
        return {
            siteTitle: pv('siteTitle', 'GoHub') || 'GoHub',
            siteIcon: pv('siteIcon', ''),
            ownerName: pv('ownerName', ''),
            logoUrl: pv('logoUrl', ''),
            logoLink: pv('logoLink', ''),
            announcement: pv('announcement', ''),
            announcementRefreshAt: page?.announcementRefreshAt || 0,
            footerLink: pv('footerLink', ''),
            disableFooter: pv('disableFooter', false) === true,
            defaultLanguage: 'zh-CN',
            serverDomain: domain,
            urlPrefix: await s.getLinkPrefix(domain),
            customDomain: await s.getCustomDomain(),
            defaultChannel: this.channelBrief(await this.storageChannel.getStorageChannel('', 'main')),
            mainChannel: this.channelBrief(await this.storageChannel.getStorageChannel(uploader, 'main')),
            backupChannel: this.channelBrief(await this.storageChannel.getStorageChannel(uploader, 'backup')),
            allowUpload: await bool('allowUpload', true),
            defaultUploadNameType: pv('defaultUploadNameType', 'default'),
            defaultUploadFolder: pv('defaultUploadFolder', ''),
            defaultConvertToWebp: pv('defaultConvertToWebp', false) === true,
            webpMode: pv('webpMode', 'lossless') === 'lossy' ? 'lossy' : 'lossless',
            defaultCustomerCompress: pv('defaultCustomerCompress', true) === true,
            webpEnabled: pv('defaultConvertToWebp', false) === true,
            compressEnabled: pv('defaultCustomerCompress', true) === true,
            transcodePolicy: await this.uploadSvc.videoTranscodePolicy(uploader),
            transcodeGlobal: await this.uploadSvc.globalTranscodeEnabled(),
            uploadConcurrency: Math.min(10, Math.max(1, Number(pv('defaultUploadConcurrency', '3')) || 3)),
            autoRetry: pb('defaultAutoRetry', true),
            retryTimes: this.parseRetryTimes(pv('defaultRetryTimes', '3')),
            autoSwitch: pb('defaultAutoSwitch', true),
            defaultCompressBar: pv('defaultCompressBar', '0.8'),
            defaultCompressQuality: pv('defaultCompressQuality', '80'),
            defaultUrlForm: pv('defaultUrlForm', 'url'),
            allowedExtensions: String(pv('allowedExtensions', 'jpg,png,gif,jpeg,webp,bmp,mp4,webm,mov,m4v,mp3,m4a,aac,ogg'))
                .split(',')
                .map((x) => x.trim().replace(/^\./, '').toLowerCase())
                .filter(Boolean),
            maxUploadSizeMB: (await this.uploadSvc.userMaxFileSizeMB(uploader)) || (Number(pv('maxUploadSizeMB', 1024)) || 1024),
            wallpaperEnabled: pv('wallpaperEnabled', false) === true,
            autoDarkMode: pv('autoDarkMode', true) !== false,
            bkInterval: Number(pv('bkInterval', 3000)) || 3000,
            bkOpacity: Number(pv('bkOpacity', 1)) || 1,
            themeAutoRange: String(pv('themeAutoRange', '') || ''),
            uploadBkImg: accountUploadBk.length ? accountUploadBk : asBk(pv('uploadBkImg', [])),
            adminBkImg: accountAdminBk.length ? accountAdminBk : asBk(pv('adminBkImg', [])),
            adminLoginBkImg: asBk(pv('adminLoginBkImg', [])),
            showDirectorySuggestions: pv('showDirectorySuggestions', true) !== false,
            accountTotpEnabled,
        };
    }
    async directoryTree(req, q) {
        const session = (0, auth_guard_1.currentSession)(req);
        const owner = session?.user || '';
        const instanceId = String(q.instanceId ?? '');
        try {
            const rows = await prisma_1.prisma.fileRecord.groupBy({
                by: ['folder'],
                where: { status: 'active', instanceId, ...(owner ? { uploader: owner } : {}) },
            });
            const dirs = rows.map((r) => r.folder).filter(Boolean);
            try {
                const map = JSON.parse((await this.settings.get('extraFolders', '{}')) || '{}');
                dirs.push(...(0, folder_meta_service_1.extraFoldersOf)(map, owner, instanceId));
            }
            catch {
            }
            return { success: true, tree: (0, file_view_1.buildDirectoryTree)(Array.from(new Set(dirs)).sort()) };
        }
        catch (err) {
            app_log_1.appLog.error('file', `目录树加载失败：${err.message}`, `owner=${owner || '-'} instance=${instanceId || 'default'}`);
            throw err;
        }
    }
    async publicList(q, res) {
        const others = (await this.sysConfig.get('others'));
        const cfg = others?.publicBrowse || {};
        if (cfg.enabled !== true) {
            return res.status(403).json({ error: 'Public browse is disabled' });
        }
        const allowedDirs = String(cfg.allowedDir || '')
            .split(/[\n\r,]+/)
            .map((d) => d.trim())
            .filter(Boolean);
        const recursive = q.recursive === 'true';
        const dir = (0, file_view_1.normalizeDir)(q.dir);
        const bare = dir.replace(/\/+$/, '');
        if (!dirAllowed(bare, allowedDirs)) {
            return res.status(403).json({ error: 'Directory not allowed' });
        }
        const start = Math.max(0, Number(q.start || 0) || 0);
        const count = q.count === undefined ? 50 : Math.max(0, Number(q.count) || 0);
        const search = (q.search || '').trim().toLowerCase();
        const type = (q.type || '').trim().toLowerCase();
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: { status: 'active' },
            include: { copies: { include: { channel: true } } },
            orderBy: { createdAt: 'desc' },
        });
        const visible = rows.filter((r) => {
            const metas = (0, file_view_1.safeParse)(r.metas);
            return (metas.ListType || 'None') !== 'Block' && metas.Label !== 'adult';
        });
        const matched = visible.filter((r) => {
            const folder = (r.folder || '').replace(/\/+$/, '');
            if (recursive) {
                if (bare && folder !== bare && !folder.startsWith(`${bare}/`))
                    return false;
            }
            else if (folder !== bare) {
                return false;
            }
            if (search && !r.originalName.toLowerCase().includes(search) && !r.name.toLowerCase().includes(search))
                return false;
            if (type && (0, file_view_1.fileTypeOf)(r.mime) !== type)
                return false;
            return true;
        });
        const dirSet = new Set();
        for (const r of visible) {
            const full = `${(r.folder || '').replace(/\/+$/, '')}/`;
            if (!full.startsWith(dir))
                continue;
            const rest = full.slice(dir.length);
            const idx = rest.indexOf('/');
            if (idx !== -1)
                dirSet.add(dir + rest.slice(0, idx));
        }
        const directories = Array.from(dirSet)
            .map((d) => d.replace(/\/+$/, ''))
            .filter((d) => d !== '' && dirAllowed(d, allowedDirs))
            .sort();
        const totalCount = matched.length;
        const paged = count > 0 ? matched.slice(start, start + count) : matched.slice(start);
        return res.json({
            files: paged.map((r) => (0, file_view_1.serializeFile)(r, r.copies)),
            directories,
            totalCount,
            returnedCount: paged.length,
            allowedDirs,
            fromCache: false,
        });
    }
    async random(q, req, res) {
        const asJson = q.type === 'json' || q.json === '1' || q.format === 'json';
        const others = (await this.sysConfig.get('others'));
        const randomCfg = others?.randomImageAPI || {};
        if (randomCfg.enabled !== true) {
            return asJson
                ? res.status(403).json({ success: false, error: 'Random is disabled', message: '随机图 API 已关闭' })
                : res.status(403).send('Random is disabled');
        }
        const allowedRandomDirs = String(randomCfg.allowedDir || '')
            .split(/[\n\r,]+/)
            .map((d) => d.trim())
            .filter(Boolean);
        const count = Math.min(10, Math.max(1, Number(q.count || 1) || 1));
        const recursive = q.recursive === 'true';
        const where = { status: 'active' };
        const dir = (0, file_view_1.normalizeDir)(q.dir);
        if (dir) {
            if (!dirAllowed(dir.replace(/\/+$/, ''), allowedRandomDirs)) {
                return asJson
                    ? res.status(403).json({ success: false, error: 'Directory not allowed', message: '目录不在允许范围内' })
                    : res.status(403).send('Directory not allowed');
            }
            const bare = dir.replace(/\/+$/, '');
            where.folder = recursive ? { startsWith: bare } : bare;
        }
        else if (allowedRandomDirs.length) {
            where.AND = allowedRandomDirs.map((d) => ({
                OR: [{ folder: d.replace(/\/+$/, '') }, { folder: { startsWith: `${d.replace(/\/+$/, '')}/` } }],
            }));
        }
        const cat = (q.category || q.fileType || '').toLowerCase();
        const prefix = cat.startsWith('img') || cat === 'image' ? 'image/' : cat === 'video' ? 'video/' : cat === 'audio' ? 'audio/' : '';
        if (prefix)
            where.mime = { startsWith: prefix };
        const exts = splitCsv(q.ext).map((e) => e.replace(/^\./, '').toLowerCase());
        if (exts.length) {
            where.OR = exts.flatMap((e) => [
                { originalName: { endsWith: `.${e}` } },
                { name: { endsWith: `.${e}` } },
            ]);
        }
        const needMemory = Boolean(q.channel || q.channelName || q.label || q.access);
        const isPubliclyVisible = (metasRaw) => {
            const m = (0, file_view_1.safeParse)(metasRaw);
            return (m.ListType || 'None') !== 'Block' && m.Label !== 'adult';
        };
        const pick = async () => {
            if (!needMemory) {
                const candidates = await prisma_1.prisma.fileRecord.findMany({ where, select: { name: true, metas: true } });
                const names = candidates.filter((c) => isPubliclyVisible(c.metas)).map((c) => c.name);
                if (!names.length)
                    return [];
                for (let i = names.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [names[i], names[j]] = [names[j], names[i]];
                }
                const chosen = names.slice(0, count);
                const recs = await prisma_1.prisma.fileRecord.findMany({ where: { name: { in: chosen } } });
                return chosen.map((n) => recs.find((r) => r.name === n)).filter(Boolean);
            }
            const rows = await prisma_1.prisma.fileRecord.findMany({
                where,
                orderBy: { id: 'asc' },
                include: { copies: { include: { channel: true } }, tags: { include: { tag: true } } },
            });
            const filtered = rows.filter((r) => {
                const metas = (0, file_view_1.safeParse)(r.metas);
                if (!isPubliclyVisible(r.metas))
                    return false;
                if (q.label && (metas.Label || 'None') !== q.label)
                    return false;
                if (q.access) {
                    const lt = metas.ListType || 'None';
                    const ok = (q.access === 'normal' && lt === 'None') ||
                        (q.access === 'block' && lt === 'Block') ||
                        (q.access === 'white' && lt === 'White');
                    if (!ok)
                        return false;
                }
                if (q.channel || q.channelName) {
                    const primary = (0, file_view_1.pickPrimaryCopy)(r.copies);
                    const typeLabel = primary?.channel ? file_view_1.CHANNEL_LABEL[primary.channel.type] || primary.channel.type : '';
                    if (q.channel && typeLabel !== q.channel)
                        return false;
                    if (q.channelName && (primary?.channel?.name || '') !== q.channelName)
                        return false;
                }
                return true;
            });
            if (!filtered.length)
                return [];
            const shuffled = filtered.slice();
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled.slice(0, count);
        };
        const picked = await pick();
        if (!picked.length) {
            if (asJson)
                return res.json({ success: false, message: '没有符合条件的图片', data: [] });
            return res.status(404).send('没有符合条件的图片');
        }
        res.setHeader('Cache-Control', 'no-store');
        if (asJson) {
            const origin = (0, request_origin_1.signOrigin)(req);
            const prefix = await this.settings.getLinkPrefix(origin);
            const items = picked.map((r) => ({
                src: `${prefix}${encodeURIComponent(r.name)}`,
                url: `${prefix}${encodeURIComponent(r.name)}`,
                name: r.originalName,
                size: r.size,
                mime: r.mime,
                dir: r.folder || '',
            }));
            return res.json({ success: true, data: count === 1 ? items[0] : items, list: items });
        }
        return res.redirect(302, `/file/${picked[0].name}`);
    }
};
exports.UserConfigController = UserConfigController;
__decorate([
    (0, common_1.Get)('userConfig'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserConfigController.prototype, "userConfig", null);
__decorate([
    (0, common_1.Get)('directoryTree'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserConfigController.prototype, "directoryTree", null);
__decorate([
    (0, common_1.Get)('public/list'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserConfigController.prototype, "publicList", null);
__decorate([
    (0, common_1.Get)('random'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], UserConfigController.prototype, "random", null);
exports.UserConfigController = UserConfigController = __decorate([
    (0, common_1.Controller)('api'),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        sysconfig_service_1.SysConfigService,
        upload_service_1.UploadService,
        storage_channel_service_1.StorageChannelService])
], UserConfigController);
