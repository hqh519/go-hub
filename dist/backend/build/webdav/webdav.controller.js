"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebDavController = void 0;
const common_1 = require("@nestjs/common");
const fs_1 = require("fs");
const crypto_1 = require("crypto");
const path = __importStar(require("path"));
const promises_1 = require("stream/promises");
const prisma_1 = require("../common/prisma");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const app_log_1 = require("../common/app-log");
const webdav_storage_1 = require("./webdav.storage");
let WebDavController = class WebDavController {
    sysConfig;
    constructor(sysConfig) {
        this.sysConfig = sysConfig;
    }
    async enabled() {
        try {
            const cfg = await this.sysConfig.get('others');
            const w = cfg?.webdav || {};
            return w.enabled === true || String(w.enabled) === 'true';
        }
        catch {
            return false;
        }
    }
    async authenticate(req) {
        const fail = { ok: false, username: '', channelId: '', channelName: '', channelPath: '' };
        const hdr = String(req.headers['authorization'] || '');
        if (!hdr.toLowerCase().startsWith('basic '))
            return fail;
        let user = '';
        let key = '';
        try {
            const decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
            const i = decoded.indexOf(':');
            user = decoded.slice(0, i).trim();
            key = decoded.slice(i + 1).trim();
        }
        catch {
            return fail;
        }
        if (!user || !key)
            return fail;
        const u = await prisma_1.prisma.user.findUnique({ where: { username: user } });
        if (!u || !u.enabled || u.role !== 'user')
            return fail;
        if (!u.webdavEnabled)
            return fail;
        const ch = await prisma_1.prisma.webDavChannel.findFirst({ where: { username: user, accessKey: key } });
        if (!ch)
            return fail;
        return { ok: true, username: user, channelId: ch.id, channelName: ch.name, channelPath: ch.path };
    }
    basic(res) {
        res.setHeader('WWW-Authenticate', 'Basic realm="GoHub WebDAV"');
        return res.status(401).send('Unauthorized');
    }
    davRelPath(req) {
        const qIdx = req.originalUrl.indexOf('?');
        const raw = (qIdx === -1 ? req.originalUrl : req.originalUrl.slice(0, qIdx)).replace(/^\/dav\/?/, '');
        let p = '';
        try {
            p = decodeURIComponent(raw);
        }
        catch {
            p = raw;
        }
        return (0, webdav_storage_1.cleanRelPath)(p);
    }
    hrefOf(origin, rel, dir) {
        const segs = String(rel || '')
            .split('/')
            .filter(Boolean)
            .map((s) => encodeURIComponent(s));
        const tail = segs.length ? `/${segs.join('/')}` : '';
        return `${origin}/dav${tail}${dir ? '/' : ''}`;
    }
    xmlEscape(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    async handle(req, res) {
        if (!(await this.enabled()))
            return res.status(403).send('WebDAV 未启用');
        const method = String(req.method || '').toUpperCase();
        if (method === 'OPTIONS') {
            res.setHeader('DAV', '1,2');
            res.setHeader('MS-Author-Via', 'DAV');
            res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY');
            return res.status(200).send('');
        }
        const auth = await this.authenticate(req);
        if (!auth.ok)
            return this.basic(res);
        const rel = this.davRelPath(req);
        const root = (0, webdav_storage_1.channelRoot)(auth.username, auth.channelPath);
        const abs = (0, webdav_storage_1.resolveInside)(root, rel);
        if (!abs)
            return res.status(403).send('路径越界');
        try {
            await (0, webdav_storage_1.ensureDir)(root);
        }
        catch {
        }
        try {
            switch (method) {
                case 'PROPFIND':
                    return await this.propfind(req, res, root, rel, abs);
                case 'GET':
                case 'HEAD':
                    return await this.getFile(req, res, abs, method === 'HEAD');
                case 'PUT':
                    return await this.putFile(req, res, abs, root);
                case 'MKCOL':
                    return await this.mkcol(res, abs);
                case 'DELETE':
                    return await this.remove(res, abs, root);
                case 'MOVE':
                    return await this.moveOrCopy(req, res, root, abs, true);
                case 'COPY':
                    return await this.moveOrCopy(req, res, root, abs, false);
                case 'PROPPATCH':
                    return res
                        .status(207)
                        .setHeader('Content-Type', 'application/xml; charset=utf-8')
                        .send('<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:"></D:multistatus>');
                default:
                    return res.status(405).send('Method Not Allowed');
            }
        }
        catch (err) {
            app_log_1.appLog.error('webdav', `${method} ${rel} 失败（账户=${auth.username}）`, err.message);
            return res.status(500).send(err.message);
        }
    }
    bodyTag(text) {
        let h = 0x811c9dc5;
        for (let i = 0; i < text.length; i += 1) {
            h ^= text.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return h.toString(16).padStart(8, '0');
    }
    async propfind(req, res, root, rel, abs) {
        const origin = `${req.protocol}://${req.headers.host || req.headers['x-forwarded-host'] || 'localhost'}`;
        const depth = String(req.headers.depth ?? '1').trim().toLowerCase();
        const selfOnly = depth === '0';
        let st;
        try {
            st = await fs_1.promises.stat(abs);
        }
        catch {
            return res.status(404).send('Not Found');
        }
        const entries = [];
        const statXml = (p, dir, size, mtime) => `<D:response><D:href>${this.xmlEscape(this.hrefOf(origin, p, dir))}</D:href><D:propstat><D:prop>` +
            (dir
                ? '<D:resourcetype><D:collection/></D:resourcetype><D:getcontentlength>0</D:getcontentlength><D:getcontenttype>httpd/unix-directory</D:getcontenttype>'
                : `<D:resourcetype/><D:getcontentlength>${size}</D:getcontentlength><D:getcontenttype>${this.xmlEscape((0, webdav_storage_1.mimeOf)(p))}</D:getcontenttype>`) +
            `<D:getlastmodified>${mtime.toUTCString()}</D:getlastmodified>` +
            `<D:creationdate>${new Date(mtime).toISOString()}</D:creationdate>` +
            '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';
        entries.push(statXml(rel, st.isDirectory(), st.size, st.mtime));
        if (!selfOnly && st.isDirectory()) {
            try {
                const children = await (0, webdav_storage_1.listDir)(abs, rel);
                for (const c of children) {
                    entries.push(statXml(c.rel, c.dir, c.size, c.mtime));
                }
            }
            catch (err) {
                app_log_1.appLog.warn('webdav', `列目录失败：${rel}`, err.message);
            }
        }
        const body = `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">\n${entries.join('\n')}\n</D:multistatus>`;
        const etag = `"dav-${this.bodyTag(body)}"`;
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('ETag', etag);
        const inm = String(req.headers['if-none-match'] || '').trim();
        if (inm && inm.split(',').some((v) => v.trim() === etag)) {
            res.status(304).end();
            return;
        }
        res.status(207);
        return res.send(body);
    }
    async getFile(req, res, abs, headOnly) {
        let st;
        try {
            st = await fs_1.promises.stat(abs);
        }
        catch {
            return res.status(404).send('Not Found');
        }
        if (st.isDirectory())
            return res.status(405).send('目录不支持直接下载');
        res.setHeader('Content-Type', (0, webdav_storage_1.mimeOf)(abs));
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Last-Modified', st.mtime.toUTCString());
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('ETag', `"${st.size}-${st.mtimeMs}"`);
        const range = String(req.headers.range || '');
        if (range.startsWith('bytes=')) {
            const m = /^bytes=(\d*)-(\d*)$/.exec(range.replace(/^bytes=/, 'bytes='));
            const startRaw = m?.[1] || '';
            const endRaw = m?.[2] || '';
            let start = startRaw ? Number(startRaw) : 0;
            let end = endRaw ? Number(endRaw) : st.size - 1;
            if (!startRaw && endRaw) {
                start = Math.max(0, st.size - Number(endRaw));
                end = st.size - 1;
            }
            if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= st.size) {
                res.setHeader('Content-Range', `bytes */${st.size}`);
                return res.status(416).send('');
            }
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
            res.setHeader('Content-Length', String(end - start + 1));
            if (headOnly)
                return res.end();
            return (0, promises_1.pipeline)((0, fs_1.createReadStream)(abs, { start, end }), res).catch(() => undefined);
        }
        res.setHeader('Content-Length', String(st.size));
        if (headOnly)
            return res.end();
        return (0, promises_1.pipeline)((0, fs_1.createReadStream)(abs), res).catch(() => undefined);
    }
    async putFile(req, res, abs, root) {
        const dir = path.dirname(abs);
        const rootAbs = path.resolve(root);
        const dirAbs = path.resolve(dir);
        if (dirAbs !== rootAbs && !dirAbs.startsWith(rootAbs + path.sep)) {
            return res.status(403).send('路径越界');
        }
        await (0, webdav_storage_1.ensureDir)(dir);
        const tmp = path.join(dir, `.dav-tmp-${Date.now()}-${(0, crypto_1.randomBytes)(6).toString('hex')}`);
        const exists = await fs_1.promises
            .stat(abs)
            .then(() => true)
            .catch(() => false);
        try {
            const body = req.body;
            if (Buffer.isBuffer(body)) {
                await fs_1.promises.writeFile(tmp, body);
            }
            else {
                await (0, promises_1.pipeline)(req, (0, fs_1.createWriteStream)(tmp));
            }
            const fh = await fs_1.promises.open(tmp, 'r+');
            try {
                await fh.sync();
            }
            finally {
                await fh.close();
            }
            try {
                await fs_1.promises.rename(tmp, abs);
            }
            catch (err) {
                const code = err.code;
                if (code === 'EPERM' || code === 'EACCES' || code === 'EEXIST') {
                    await fs_1.promises.rm(abs, { force: true });
                    await fs_1.promises.rename(tmp, abs);
                }
                else {
                    throw err;
                }
            }
        }
        catch (err) {
            await fs_1.promises.rm(tmp, { force: true }).catch(() => undefined);
            if (req.destroyed || res.headersSent) {
                if (!res.writableEnded && res.writable)
                    res.end();
                return;
            }
            const code = err.code;
            const msg = code === 'ENOSPC' ? '服务器磁盘空间不足' : '写入失败';
            app_log_1.appLog.error('webdav', `PUT 失败 ${path.basename(abs)}`, err, this.clientIp(req));
            return res.status(code === 'ENOSPC' ? 507 : 500).send(msg);
        }
        (0, webdav_storage_1.invalidateDavCache)();
        return res.status(exists ? 204 : 201).send('');
    }
    clientIp(req) {
        const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        const ip = fwd || req.socket?.remoteAddress || '';
        return ip.replace(/^::ffff:/, '');
    }
    async mkcol(res, abs) {
        const exists = await fs_1.promises
            .stat(abs)
            .then(() => true)
            .catch(() => false);
        if (exists)
            return res.status(405).send('已存在');
        await (0, webdav_storage_1.ensureDir)(abs);
        (0, webdav_storage_1.invalidateDavCache)();
        return res.status(201).send('');
    }
    async remove(res, abs, root) {
        if (path.resolve(abs) === path.resolve(root))
            return res.status(403).send('不能删除网盘根目录');
        const exists = await fs_1.promises
            .stat(abs)
            .then(() => true)
            .catch(() => false);
        if (!exists)
            return res.status(404).send('Not Found');
        await fs_1.promises.rm(abs, { recursive: true, force: true });
        (0, webdav_storage_1.invalidateDavCache)();
        return res.status(204).send('');
    }
    async moveOrCopy(req, res, root, abs, move) {
        const destRaw = String(req.headers.destination || '');
        if (!destRaw)
            return res.status(400).send('缺少 Destination');
        let destPath = destRaw;
        try {
            const u = new URL(destRaw);
            destPath = decodeURIComponent(u.pathname);
        }
        catch {
        }
        destPath = destPath.replace(/^\/dav\/?/, '');
        const destAbs = (0, webdav_storage_1.resolveInside)(root, destPath);
        if (!destAbs)
            return res.status(403).send('路径越界');
        if (path.resolve(destAbs) === path.resolve(root))
            return res.status(403).send('不能覆盖网盘根目录');
        const srcExists = await fs_1.promises
            .stat(abs)
            .then(() => true)
            .catch(() => false);
        if (!srcExists)
            return res.status(404).send('Not Found');
        await (0, webdav_storage_1.ensureDir)(path.dirname(destAbs));
        const overwrite = String(req.headers.overwrite || 'T').toUpperCase() !== 'F';
        const destExists = await fs_1.promises
            .stat(destAbs)
            .then(() => true)
            .catch(() => false);
        if (destExists && !overwrite)
            return res.status(412).send('目标已存在');
        if (move) {
            try {
                await fs_1.promises.rename(abs, destAbs);
            }
            catch (err) {
                const code = err.code;
                const retriable = code === 'EPERM' || code === 'EACCES' || code === 'EEXIST' || code === 'ENOTEMPTY';
                if (!retriable || !destExists)
                    throw err;
                await fs_1.promises.rm(destAbs, { recursive: true, force: true });
                await fs_1.promises.rename(abs, destAbs);
            }
        }
        else {
            const tmpDest = path.join(path.dirname(destAbs), '.dav-copy-' + Date.now() + '-' + (0, crypto_1.randomBytes)(6).toString('hex'));
            try {
                await fs_1.promises.cp(abs, tmpDest, { recursive: true });
                if (destExists)
                    await fs_1.promises.rm(destAbs, { recursive: true, force: true });
                await fs_1.promises.rename(tmpDest, destAbs);
            }
            catch (err) {
                await fs_1.promises.rm(tmpDest, { recursive: true, force: true }).catch(() => undefined);
                throw err;
            }
        }
        (0, webdav_storage_1.invalidateDavCache)();
        return res.status(destExists ? 204 : 201).send('');
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
    __metadata("design:paramtypes", [sysconfig_service_1.SysConfigService])
], WebDavController);
