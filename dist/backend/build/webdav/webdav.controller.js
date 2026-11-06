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
exports.WebDavController = void 0;
const request_origin_1 = require("../common/request-origin");
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const crypto_service_1 = require("../common/crypto.service");
const settings_service_1 = require("../settings/settings.service");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const upload_service_1 = require("../upload/upload.service");
const storage_channel_service_1 = require("../storage/storage-channel.service");
const file_view_1 = require("../common/file-view");
const app_log_1 = require("../common/app-log");
let WebDavController = class WebDavController {
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
    async cfg() {
        const fallback = { enabled: false, rootPath: '', readonly: false };
        try {
            const others = await this.sysConfig.get('others');
            const j = others?.webdav || {};
            if (j.enabled === undefined && j.channelId === undefined) {
                const legacy = await this.settings.get('webdav', '');
                if (legacy) {
                    const lj = JSON.parse(legacy);
                    return {
                        enabled: lj.enabled === true,
                        rootPath: String(lj.rootPath || '').replace(/^\/+|\/+$/g, ''),
                        readonly: lj.readonly === true,
                    };
                }
            }
            return {
                enabled: j.enabled === true,
                rootPath: String(j.rootPath || '').replace(/^\/+|\/+$/g, ''),
                readonly: j.readonly === true,
            };
        }
        catch {
            return fallback;
        }
    }
    async authenticate(req) {
        const hdr = String(req.headers['authorization'] || '');
        if (!hdr.toLowerCase().startsWith('basic '))
            return { ok: false, user: '' };
        let user = '';
        let pass = '';
        try {
            const decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
            const i = decoded.indexOf(':');
            user = decoded.slice(0, i);
            pass = decoded.slice(i + 1);
        }
        catch {
            return { ok: false, user: '' };
        }
        const u = await prisma_1.prisma.user.findUnique({ where: { username: user } });
        if (u && u.enabled && crypto_service_1.CryptoService.verifyPassword(pass, u.passwordHash))
            return { ok: true, user };
        try {
            const raw = await this.sysConfig.readSecurityRaw();
            const adm = raw?.auth?.admin || {};
            const admUser = String(adm.adminUsername || 'admin');
            if (user === admUser && String(adm.adminPassword || '')) {
                const stored = String(adm.adminPassword);
                if (stored.startsWith('scrypt:')) {
                    if (crypto_service_1.CryptoService.verifyPassword(pass, stored.slice(7)))
                        return { ok: true, user };
                }
                else if (stored === pass) {
                    return { ok: true, user };
                }
            }
        }
        catch {
        }
        const envUser = process.env.ADMIN_USER || 'admin';
        const envPass = process.env.ADMIN_PASSWORD || 'gohub';
        if (user === envUser && pass === envPass)
            return { ok: true, user };
        return { ok: false, user };
    }
    davPath(req, rootPath) {
        const qIdx = req.originalUrl.indexOf('?');
        const raw = (qIdx === -1 ? req.originalUrl : req.originalUrl.slice(0, qIdx)).replace(/^\/dav\/?/, '');
        let p = '';
        try {
            p = decodeURIComponent(raw);
        }
        catch {
            p = raw;
        }
        p = p.replace(/^\/+|\/+$/g, '');
        if (rootPath && !p.startsWith(rootPath))
            p = rootPath + (p ? `/${p}` : '');
        return p;
    }
    encodePath(id) {
        return String(id || '')
            .split('/')
            .map((seg) => encodeURIComponent(seg))
            .join('/');
    }
    basic(res) {
        res.setHeader('WWW-Authenticate', 'Basic realm="GoHub WebDAV"');
        return res.status(401).send('Unauthorized');
    }
    async handle(req, res) {
        const cfg = await this.cfg();
        if (!cfg.enabled)
            return res.status(403).send('WebDAV 未启用');
        const auth = await this.authenticate(req);
        if (!auth.ok)
            return this.basic(res);
        const method = req.method.toUpperCase();
        const path = this.davPath(req, cfg.rootPath);
        const segs = path.split('/').filter(Boolean);
        const last = segs.length ? segs[segs.length - 1] : '';
        const isDirRequest = !last || !/\.[A-Za-z0-9]{1,8}$/.test(last);
        const folder = isDirRequest ? path : segs.slice(0, -1).join('/');
        try {
            switch (method) {
                case 'OPTIONS':
                    res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL');
                    res.setHeader('DAV', '1,2');
                    res.setHeader('MS-Author-Via', 'DAV');
                    return res.status(200).send('');
                case 'PROPFIND':
                    return this.propfind(req, res, folder, path, isDirRequest);
                case 'GET':
                case 'HEAD': {
                    if (isDirRequest)
                        return res.status(405).send('目录不支持直接下载');
                    const rec = await prisma_1.prisma.fileRecord.findFirst({
                        where: {
                            status: 'active',
                            folder,
                            OR: [{ name: last }, { name: path }, { originalName: last }, { name: last.replace(/\.[^.]*$/, '') }],
                        },
                        include: { copies: true },
                    });
                    if (!rec)
                        return res.status(404).send('Not Found');
                    const origin = (0, request_origin_1.signOrigin)(req);
                    const prefix = await this.settings.getLinkPrefix(origin);
                    res.setHeader('Location', `${prefix}${this.encodePath(rec.name)}${(0, file_view_1.extSuffixFor)(rec.name, last)}`);
                    return res.status(302).send('');
                }
                case 'PUT': {
                    if (cfg.readonly)
                        return res.status(403).send('WebDAV 处于只读模式');
                    const raw = await this.readBody(req);
                    if (!raw.length)
                        return res.status(400).send('空请求体');
                    const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0];
                    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
                    const mainChannel = await this.storageChannel.getStorageChannel(auth.user, 'main');
                    const backupChannel = await this.storageChannel.getStorageChannel(auth.user, 'backup');
                    const r = await this.uploadSvc.upload({ buffer: raw, mime, originalName: last || `dav-${Date.now()}` }, {
                        channelId: mainChannel?.id || undefined,
                        backupChannelId: backupChannel?.id || undefined,
                        uploadFolder: folder,
                        uploader: auth.user,
                        ip,
                        presetFileId: path || last,
                        backup: !!backupChannel,
                        skipFileLimits: !(await this.uploadSvc.userEnforceLimits(auth.user)),
                        uploadSource: 'WebDAV',
                    });
                    if (r.error)
                        return res.status(500).send(r.error);
                    const origin = (0, request_origin_1.signOrigin)(req);
                    const prefix = await this.settings.getLinkPrefix(origin);
                    const signedUrl = `${prefix}${this.encodePath(r.id)}${(0, file_view_1.extSuffixFor)(r.id, last)}`;
                    res.setHeader('Location', signedUrl);
                    res.setHeader('x-gohub-url', signedUrl);
                    return res.status(201).send('');
                }
                case 'MKCOL': {
                    return res.status(201).send('');
                }
                case 'DELETE': {
                    if (cfg.readonly)
                        return res.status(403).send('WebDAV 处于只读模式');
                    if (isDirRequest)
                        return res.status(403).send('暂不支持目录删除');
                    const rec = await prisma_1.prisma.fileRecord.findFirst({
                        where: {
                            status: 'active',
                            folder,
                            OR: [{ name: last }, { name: path }, { originalName: last }],
                        },
                    });
                    if (!rec)
                        return res.status(404).send('Not Found');
                    await prisma_1.prisma.fileRecord.update({ where: { id: rec.id }, data: { status: 'deleted', deletedAt: new Date() } });
                    return res.status(204).send('');
                }
                default:
                    return res.status(405).send('Method Not Allowed');
            }
        }
        catch (err) {
            app_log_1.appLog.error('webdav', `${method} ${path} 失败`, err.message);
            return res.status(500).send(err.message);
        }
    }
    readBody(req) {
        const body = req.body;
        if (Buffer.isBuffer(body))
            return Promise.resolve(body);
        if (typeof body === 'string')
            return Promise.resolve(Buffer.from(body));
        if (body && typeof body === 'object')
            return Promise.resolve(Buffer.from(JSON.stringify(body)));
        if (req.readableEnded)
            return Promise.resolve(Buffer.alloc(0));
        return new Promise((resolve, reject) => {
            const chunks = [];
            const timer = setTimeout(() => resolve(Buffer.concat(chunks)), 30000);
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                clearTimeout(timer);
                resolve(Buffer.concat(chunks));
            });
            req.on('error', (e) => {
                clearTimeout(timer);
                reject(e);
            });
        });
    }
    async propfind(req, res, folder, path, isDirRequest) {
        const origin = (0, request_origin_1.signOrigin)(req);
        const depth = String(req.headers.depth ?? '1').trim().toLowerCase();
        const selfOnly = depth === '0';
        const href = (p, dir) => {
            const segs = String(p || '')
                .split('/')
                .filter(Boolean)
                .map((s) => encodeURIComponent(s));
            const tail = segs.length ? `/${segs.join('/')}` : '';
            return `${origin}/dav${tail}${dir ? '/' : ''}`;
        };
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const entries = [];
        const stat = (p, collection, size = 0, mtime = new Date()) => `<D:response><D:href>${esc(href(p, collection))}</D:href><D:propstat><D:prop>` +
            (collection
                ? '<D:resourcetype><D:collection/></D:resourcetype><D:getcontentlength>0</D:getcontentlength><D:getcontenttype>httpd/unix-directory</D:getcontenttype>'
                : `<D:resourcetype/><D:getcontentlength>${size}</D:getcontentlength><D:getcontenttype>${esc(mimeOf(p))}</D:getcontenttype>`) +
            `<D:getlastmodified>${mtime.toUTCString()}</D:getlastmodified>` +
            '<D:creationdate>' + new Date(mtime).toISOString() + '</D:creationdate>' +
            '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';
        entries.push(stat(path, true));
        if (!selfOnly) {
            const rows = await prisma_1.prisma.fileRecord.findMany({
                where: {
                    status: 'active',
                    ...(folder ? { OR: [{ folder }, { folder: { startsWith: `${folder}/` } }] } : {}),
                },
                orderBy: { createdAt: 'desc' },
            });
            const dirSet = new Set();
            for (const r of rows) {
                const rest = folder ? r.folder.slice(folder.length).replace(/^\/+/, '') : r.folder;
                const first = rest.split('/')[0];
                if (first)
                    dirSet.add(folder ? `${folder}/${first}` : first);
            }
            for (const d of dirSet)
                entries.push(stat(d, true));
            if (isDirRequest) {
                const seen = new Set();
                for (const r of rows) {
                    if ((r.folder || '') !== folder)
                        continue;
                    const name = r.originalName || r.name;
                    if (!name || seen.has(name))
                        continue;
                    seen.add(name);
                    entries.push(stat(folder ? `${folder}/${name}` : name, false, r.size, r.createdAt));
                }
            }
        }
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.status(207);
        return res.send(`<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">\n${entries.join('\n')}\n</D:multistatus>`);
    }
};
exports.WebDavController = WebDavController;
__decorate([
    (0, common_1.All)(['dav', 'dav/*']),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], WebDavController.prototype, "handle", null);
exports.WebDavController = WebDavController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        sysconfig_service_1.SysConfigService,
        upload_service_1.UploadService,
        storage_channel_service_1.StorageChannelService])
], WebDavController);
function mimeOf(name) {
    const ext = String(name).split('.').pop()?.toLowerCase() || '';
    const map = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
        webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
        mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
        mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg',
        txt: 'text/plain', json: 'application/json', pdf: 'application/pdf',
        zip: 'application/zip',
    };
    return map[ext] || 'application/octet-stream';
}
