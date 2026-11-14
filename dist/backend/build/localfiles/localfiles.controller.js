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
exports.LocalFilesController = void 0;
const common_1 = require("@nestjs/common");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const prisma_1 = require("../common/prisma");
const app_log_1 = require("../common/app-log");
const auth_guard_1 = require("../auth/auth.guard");
const channel_access_1 = require("../common/channel-access");
const file_view_1 = require("../common/file-view");
const dedup_1 = require("../common/dedup");
const settings_service_1 = require("../settings/settings.service");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const upload_service_1 = require("../upload/upload.service");
const local_adapter_1 = require("../adapters/local.adapter");
const webdav_storage_1 = require("../webdav/webdav.storage");
const localfiles_util_1 = require("./localfiles.util");
const K_PAGE_SIZE = 'localFilesPageSize';
const K_MAX_PER_DIR = 'localFilesMaxPerDir';
const K_PREVIEW_MB = 'localFilesPreviewMB';
const DEFAULT_LOCAL_CHANNEL_CODE = '999999';
const DEFAULT_LOCAL_VIRTUAL_ID = '__default_local__';
const DEFAULT_LOCAL_ROOT_NAME = '本地用户默认文件';
const WEBDAV_VIRTUAL_ID = '__webdav__';
const WEBDAV_ROOT_NAME = 'WebDAV 文件';
const WEBDAV_ADMIN_VIRTUAL_ID = '__webdav_admin__';
const WEBDAV_ADMIN_ROOT_NAME = 'WebDav存储文件';
const MIME_MAP = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
    tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', avi: 'video/x-msvideo',
    mkv: 'video/x-matroska', flv: 'video/x-flv', wmv: 'video/x-ms-wmv', mpg: 'video/mpeg', mpeg: 'video/mpeg',
    mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', wma: 'audio/x-ms-wma', ape: 'audio/x-ape', aiff: 'audio/aiff',
    pdf: 'application/pdf',
    txt: 'text/plain', text: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', json: 'application/json',
    log: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values', ini: 'text/plain', conf: 'text/plain',
    cfg: 'text/plain', yml: 'text/yaml', yaml: 'text/yaml', xml: 'application/xml', html: 'text/html', htm: 'text/html',
    css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', ts: 'text/typescript', jsx: 'text/javascript',
    tsx: 'text/typescript', sh: 'text/x-sh', bash: 'text/x-sh', bat: 'text/plain', ps1: 'text/plain',
    py: 'text/x-python', go: 'text/x-go', java: 'text/x-java', c: 'text/x-c', h: 'text/x-c', cpp: 'text/x-c++', sql: 'text/plain',
    php: 'application/x-httpd-php', phtml: 'application/x-httpd-php',
    vue: 'text/plain', svelte: 'text/plain', rs: 'text/x-rust', rb: 'text/x-ruby', kt: 'text/x-kotlin',
    swift: 'text/x-swift', lua: 'text/x-lua', pl: 'text/x-perl', r: 'text/x-r', scala: 'text/x-scala',
    dart: 'text/x-dart', gradle: 'text/plain', toml: 'application/toml', properties: 'text/plain',
    plist: 'text/xml', lock: 'text/plain', map: 'application/json', graphql: 'application/graphql',
    gql: 'application/graphql', proto: 'text/plain', tex: 'application/x-latex', rst: 'text/plain',
    srt: 'text/plain', vtt: 'text/vtt', diff: 'text/plain', patch: 'text/plain',
    env: 'text/plain', service: 'text/plain', nginx: 'text/plain', htaccess: 'text/plain',
    dockerfile: 'text/plain', makefile: 'text/plain', gitignore: 'text/plain', editorconfig: 'text/plain',
    xaml: 'application/xml', svgx: 'application/xml', asm: 'text/plain', s: 'text/plain',
};
function mimeOf(ext) {
    return MIME_MAP[String(ext || '').toLowerCase()] || 'application/octet-stream';
}
const INLINE_TYPES = new Set(['image', 'video', 'audio', 'pdf']);
let LocalFilesController = class LocalFilesController {
    settings;
    uploads;
    sysConfig;
    constructor(settings, uploads, sysConfig) {
        this.settings = settings;
        this.uploads = uploads;
        this.sysConfig = sysConfig;
    }
    async webdavOn() {
        try {
            const cfg = await this.sysConfig.get('others');
            const w = cfg?.webdav || {};
            return w.enabled === true || String(w.enabled) === 'true';
        }
        catch {
            return false;
        }
    }
    session(req) {
        return (0, auth_guard_1.currentSession)(req);
    }
    role(req) {
        return this.session(req)?.role || '';
    }
    userName(req) {
        return this.session(req)?.user || '';
    }
    async readSettings() {
        const [ps, mx, pm] = await Promise.all([
            this.settings.get(K_PAGE_SIZE, String(localfiles_util_1.DEFAULT_PAGE_SIZE)),
            this.settings.get(K_MAX_PER_DIR, String(localfiles_util_1.DEFAULT_MAX_PER_DIR)),
            this.settings.get(K_PREVIEW_MB, String(localfiles_util_1.DEFAULT_PREVIEW_THRESHOLD_MB)),
        ]);
        return {
            pageSize: Math.min(200, Math.max(12, Number(ps) || localfiles_util_1.DEFAULT_PAGE_SIZE)),
            maxPerDir: Math.min(5000, Math.max(100, Number(mx) || localfiles_util_1.DEFAULT_MAX_PER_DIR)),
            previewThresholdMB: Math.min(4096, Math.max(1, Number(pm) || localfiles_util_1.DEFAULT_PREVIEW_THRESHOLD_MB)),
        };
    }
    async resolveChannel(req, channelId) {
        const id = String(channelId || '').trim();
        if (!id)
            return { error: '请选择挂载文件渠道' };
        if (id === WEBDAV_ADMIN_VIRTUAL_ID) {
            if (!(0, localfiles_util_1.localFilesAdminOnly)(this.role(req)))
                return { error: '仅管理员可浏览该目录' };
            const base = (0, webdav_storage_1.webdavRoot)();
            await fs_1.promises.mkdir(base, { recursive: true }).catch(() => undefined);
            let real = base;
            try {
                real = await fs_1.promises.realpath(base);
            }
            catch {
            }
            try {
                const st = await fs_1.promises.stat(real);
                if (!st.isDirectory())
                    throw new Error('not a directory');
                const pseudo = {
                    id: WEBDAV_ADMIN_VIRTUAL_ID,
                    code: 'WEBDAV',
                    name: WEBDAV_ADMIN_ROOT_NAME,
                    type: 'webdav',
                    enabled: true,
                    config: '{}',
                    authorizedUsers: '[]',
                };
                return {
                    channel: pseudo,
                    root: real,
                    roots: [{ name: WEBDAV_ADMIN_ROOT_NAME, display: base, real, mtime: st.mtimeMs }],
                    broken: [],
                };
            }
            catch (err) {
                (0, localfiles_util_1.logLocalFileError)('读取 WebDAV 目录', `管理员 路径=${base}`, err);
                return { error: 'WebDAV 目录不存在或不可访问' };
            }
        }
        if (id === WEBDAV_VIRTUAL_ID) {
            const me = this.userName(req);
            if (!me)
                return { error: '请先登录' };
            if (!(await this.webdavOn()))
                return { error: '对外 WebDAV 已停用（系统管理 → 安全设置）' };
            const base = path.join((0, webdav_storage_1.webdavRoot)(), me);
            await fs_1.promises.mkdir(base, { recursive: true }).catch(() => undefined);
            let real = base;
            try {
                real = await fs_1.promises.realpath(base);
            }
            catch {
            }
            try {
                const st = await fs_1.promises.stat(real);
                if (!st.isDirectory())
                    throw new Error('not a directory');
                const pseudo = {
                    id: WEBDAV_VIRTUAL_ID,
                    code: 'WEBDAV',
                    name: WEBDAV_ROOT_NAME,
                    type: 'webdav',
                    enabled: true,
                    config: '{}',
                    authorizedUsers: '[]',
                };
                return {
                    channel: pseudo,
                    root: real,
                    roots: [{ name: WEBDAV_ROOT_NAME, display: base, real, mtime: st.mtimeMs }],
                    broken: [],
                };
            }
            catch (err) {
                (0, localfiles_util_1.logLocalFileError)('读取 WebDAV 目录', `账户=${me} 路径=${base}`, err);
                return { error: 'WebDAV 目录不存在或不可访问' };
            }
        }
        if (id === DEFAULT_LOCAL_VIRTUAL_ID) {
            const me = this.userName(req);
            if (!me)
                return { error: '请先登录' };
            const dir = path.join(local_adapter_1.LocalAdapter.userRoot(), me, DEFAULT_LOCAL_CHANNEL_CODE);
            await fs_1.promises.mkdir(dir, { recursive: true }).catch(() => undefined);
            let real = dir;
            try {
                real = await fs_1.promises.realpath(dir);
            }
            catch {
            }
            try {
                const st = await fs_1.promises.stat(real);
                if (!st.isDirectory())
                    throw new Error('not a directory');
                const pseudo = {
                    id: DEFAULT_LOCAL_VIRTUAL_ID,
                    code: DEFAULT_LOCAL_CHANNEL_CODE,
                    name: DEFAULT_LOCAL_ROOT_NAME,
                    type: 'local',
                    enabled: true,
                    config: '{}',
                    authorizedUsers: '[]',
                };
                return {
                    channel: pseudo,
                    root: real,
                    roots: [{ name: DEFAULT_LOCAL_ROOT_NAME, display: dir, real, mtime: st.mtimeMs }],
                    broken: [],
                };
            }
            catch (err) {
                (0, localfiles_util_1.logLocalFileError)('读取默认本地目录', `账户=${me} 路径=${dir}`, err);
                return { error: '默认本地目录不存在或不可访问' };
            }
        }
        const ch = await prisma_1.prisma.channel.findFirst({
            where: { type: { in: ['localfiles', 'local'] }, OR: [{ id }, { code: id }] },
        });
        if (!ch)
            return { error: '渠道不存在或不是「挂载文件」渠道' };
        if (!ch.enabled)
            return { error: '该渠道已停用' };
        if (!(0, localfiles_util_1.localFilesAdminOnly)(this.role(req))) {
            const me = this.userName(req);
            if (!me || !(0, channel_access_1.channelVisibleTo)(ch.authorizedUsers, ch.type, me, false)) {
                return { error: '该挂载文件渠道未授权给当前账户' };
            }
        }
        let cfg = {};
        try {
            cfg = JSON.parse(ch.config || '{}');
        }
        catch {
            cfg = {};
        }
        if (ch.type === 'local') {
            const on = cfg.syncToLocalFiles === true || String(cfg.syncToLocalFiles || '') === 'true';
            if (!on)
                return { error: '该本地存储渠道未开启「同步到挂载管理」' };
        }
        let wanted = [];
        if (Array.isArray(cfg.rootPaths))
            wanted = cfg.rootPaths.map((s) => String(s || '').trim());
        else if (typeof cfg.rootPaths === 'string' && cfg.rootPaths.trim()) {
            wanted = cfg.rootPaths.split(/\r?\n/).map((s) => s.trim());
        }
        if (!wanted.length && cfg.rootPath)
            wanted = [String(cfg.rootPath).trim()];
        wanted = wanted.filter(Boolean);
        if (!wanted.length)
            return { error: '该渠道没有配置浏览目录' };
        const roots = [];
        const broken = [];
        const usedNames = new Set();
        for (const display of wanted) {
            try {
                const real = await fs_1.promises.realpath(display);
                const st = await fs_1.promises.stat(real);
                if (!st.isDirectory())
                    throw new Error('not a directory');
                let name = path.basename(real) || real;
                while (usedNames.has(name))
                    name = `${name}-2`;
                usedNames.add(name);
                roots.push({ name, display, real, mtime: st.mtimeMs });
            }
            catch (err) {
                broken.push(display);
                (0, localfiles_util_1.logLocalFileError)('读取浏览目录', `渠道=${ch.name} 路径=${display}`, err);
            }
        }
        if (!roots.length)
            return { error: '浏览目录不存在或不可访问' };
        return { channel: ch, root: roots[0].real, roots, broken };
    }
    resolveInsideRoot(roots, dir) {
        const segs = String(dir || '').split('/').filter(Boolean);
        if (!segs.length)
            return null;
        const hit = roots.find((r) => r.name === segs[0]);
        if (!hit)
            return null;
        return { root: hit, inside: segs.slice(1).join('/') };
    }
    async channels(req) {
        if (!this.session(req))
            return { success: false, message: '请先登录' };
        const admin = (0, localfiles_util_1.localFilesAdminOnly)(this.role(req));
        const me = this.userName(req);
        if (!admin && !me)
            return { success: true, data: [] };
        const rows = await prisma_1.prisma.channel.findMany({
            where: { type: { in: ['localfiles', 'local'] } },
            orderBy: [{ typeCode: 'asc' }, { name: 'asc' }],
        });
        const configured = rows
            .map((ch) => {
            let cfg = {};
            try {
                cfg = JSON.parse(ch.config || '{}');
            }
            catch {
                cfg = {};
            }
            const synced = ch.type === 'local' && (cfg.syncToLocalFiles === true || String(cfg.syncToLocalFiles || '') === 'true');
            if (!ch.enabled)
                return null;
            if (ch.type === 'local' && (!synced || !String(cfg.rootPath || '').trim()))
                return null;
            if (!admin && !(0, channel_access_1.channelVisibleTo)(ch.authorizedUsers, ch.type, me, false))
                return null;
            return {
                id: ch.id,
                code: ch.code,
                name: ch.name,
                rootPath: String(cfg.rootPath || ''),
                enabled: ch.enabled,
                source: ch.type === 'local' ? 'local' : 'localfiles',
            };
        })
            .filter(Boolean);
        const mine = {
            id: DEFAULT_LOCAL_VIRTUAL_ID,
            code: DEFAULT_LOCAL_CHANNEL_CODE,
            name: DEFAULT_LOCAL_ROOT_NAME,
            rootPath: path.join(local_adapter_1.LocalAdapter.userRoot(), me, DEFAULT_LOCAL_CHANNEL_CODE),
            enabled: true,
            source: 'default',
        };
        const webdavOn = await this.webdavOn();
        let webdavItem = null;
        if (webdavOn && me) {
            const account = await prisma_1.prisma.user.findUnique({ where: { username: me }, select: { role: true, webdavEnabled: true } });
            const allowed = account?.role === 'user' && account.webdavEnabled === true;
            if (allowed) {
                webdavItem = {
                    id: WEBDAV_VIRTUAL_ID,
                    code: 'WEBDAV',
                    name: WEBDAV_ROOT_NAME,
                    rootPath: path.join((0, webdav_storage_1.webdavRoot)(), me),
                    enabled: true,
                    source: 'webdav',
                };
            }
        }
        const adminWebdavItem = admin
            ? {
                id: WEBDAV_ADMIN_VIRTUAL_ID,
                code: 'WEBDAV',
                name: WEBDAV_ADMIN_ROOT_NAME,
                rootPath: (0, webdav_storage_1.webdavRoot)(),
                enabled: true,
                source: 'webdav',
            }
            : null;
        return {
            success: true,
            data: [mine, ...(adminWebdavItem ? [adminWebdavItem] : []), ...(webdavItem ? [webdavItem] : []), ...configured],
        };
    }
    async getSettings(req) {
        if (!this.session(req))
            return { success: false, message: '请先登录' };
        return { success: true, data: await this.readSettings() };
    }
    async saveSettings(body, req) {
        if (!this.session(req))
            return { success: false, message: '请先登录' };
        const cur = await this.readSettings();
        const pageSize = Math.min(200, Math.max(12, Number(body?.pageSize) || cur.pageSize));
        const maxPerDir = Math.min(5000, Math.max(100, Number(body?.maxPerDir) || cur.maxPerDir));
        const previewThresholdMB = Math.min(4096, Math.max(1, Number(body?.previewThresholdMB) || cur.previewThresholdMB));
        await Promise.all([
            this.settings.set(K_PAGE_SIZE, String(pageSize)),
            this.settings.set(K_MAX_PER_DIR, String(maxPerDir)),
            this.settings.set(K_PREVIEW_MB, String(previewThresholdMB)),
        ]);
        app_log_1.appLog.info('localfiles', '更新本地文件浏览设置', `每页=${pageSize} 单目录上限=${maxPerDir} 预览阈值=${previewThresholdMB}MB`);
        return { success: true, data: { pageSize, maxPerDir, previewThresholdMB } };
    }
    async tree(req, q) {
        const r = await this.resolveChannel(req, q.channelId);
        if (r.error)
            return { success: false, message: r.error };
        const roots = r.roots;
        const TREE_LIMIT = 3000;
        const dirs = [];
        let truncated = false;
        for (const rt of roots) {
            dirs.push(rt.name);
            const subs = await (0, localfiles_util_1.collectDirs)(rt.real, rt.real, TREE_LIMIT);
            if (subs.length >= TREE_LIMIT)
                truncated = true;
            for (const s of subs)
                dirs.push(`${rt.name}/${s}`);
        }
        if (truncated) {
            app_log_1.appLog.warn('localfiles', '目录树条目超过上限已截断', `渠道=${r.channel.name} 上限=${TREE_LIMIT}`);
        }
        dirs.sort((a, b) => a.localeCompare(b, 'zh-CN'));
        return { success: true, data: { root: '', dirs, total: dirs.length, truncated } };
    }
    async list(req, q) {
        const r = await this.resolveChannel(req, q.channelId);
        if (r.error)
            return { success: false, message: r.error };
        const roots = r.roots;
        const dir = (0, localfiles_util_1.sanitizeRelativeDir)(q.dir);
        if (dir === null)
            return { success: false, message: '目录路径不合法' };
        const cfg = await this.readSettings();
        const page = Math.max(1, Number(q.page) || 1);
        const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || cfg.pageSize));
        const type = String(q.type || '').toLowerCase();
        const search = String(q.search || '').trim().toLowerCase();
        const sort = String(q.sort || 'name');
        const order = String(q.order || 'asc');
        let entries = [];
        let truncated = false;
        let dirs = [];
        if (dir === '') {
            entries = roots.map((rt) => ({
                path: rt.name,
                name: rt.name,
                kind: 'dir',
                size: 0,
                mtime: rt.mtime,
                ext: '',
                type: '',
            }));
            dirs = roots.map((rt) => rt.name);
        }
        else {
            const hit = this.resolveInsideRoot(roots, dir);
            if (!hit)
                return { success: false, message: '目录路径越界' };
            const abs = (0, localfiles_util_1.safeJoin)(hit.root.real, hit.inside || '.');
            if (!abs)
                return { success: false, message: '目录路径越界' };
            let read;
            try {
                read = await (0, localfiles_util_1.readDirEntries)(abs, abs, cfg.maxPerDir);
            }
            catch (err) {
                (0, localfiles_util_1.logLocalFileError)('读取目录', `渠道=${r.channel.name} 目录=${dir || '/'}`, err);
                return { success: false, message: '目录读取失败' };
            }
            const prefix = dir;
            entries = read.entries.map((e) => ({ ...e, path: prefix ? `${prefix}/${e.path}` : e.path }));
            truncated = read.truncated;
            dirs = read.dirs;
        }
        let list = entries;
        if (type === 'inlibrary') {
            const probe = list.filter((e) => e.kind === 'file').slice(0, 400);
            const libMap = await this.markInLibrary(roots, probe);
            list = list.filter((e) => e.kind === 'dir' || libMap.has(e.path));
        }
        else if (type) {
            list = list.filter((e) => e.kind === 'dir' || e.type === type);
        }
        if (search)
            list = list.filter((e) => e.name.toLowerCase().includes(search) || e.path.toLowerCase().includes(search));
        list = (0, localfiles_util_1.sortEntries)(list, sort, order);
        const LIB_SORT_LIMIT = 400;
        let inLibrary = null;
        if (sort === 'inLibrary') {
            inLibrary = await this.markInLibrary(roots, list.filter((e) => e.kind === 'file').slice(0, LIB_SORT_LIMIT));
            const dir = order === 'desc' ? -1 : 1;
            const rank = (e) => (inLibrary.has(e.path) ? 0 : 1);
            list = [...list].sort((a, b) => {
                if (a.kind !== b.kind)
                    return a.kind === 'dir' ? -1 : 1;
                const cmp = (rank(a) - rank(b)) * dir;
                if (cmp)
                    return cmp;
                return a.name.localeCompare(b.name, 'zh-CN');
            });
        }
        const total = list.length;
        const start = (page - 1) * pageSize;
        const pageEntries = list.slice(start, start + pageSize);
        const marked = inLibrary ?? (await this.markInLibrary(roots, pageEntries));
        return {
            success: true,
            data: {
                dir,
                entries: pageEntries.map((e) => ({ ...e, inLibrary: marked.get(e.path) || '' })),
                total,
                page,
                pageSize,
                truncated,
                dirs,
                settings: cfg,
            },
        };
    }
    async markInLibrary(roots, entries, limit = 200) {
        const out = new Map();
        const files = entries.filter((e) => e.kind === 'file' && e.size > 0).slice(0, Math.max(1, limit));
        if (!files.length)
            return out;
        const sizes = Array.from(new Set(files.map((f) => f.size)));
        let rows = [];
        try {
            rows = await prisma_1.prisma.fileRecord.findMany({
                where: { status: 'active', OR: [{ size: { in: sizes } }, { originalSize: { in: sizes } }] },
                select: { name: true, size: true, originalSize: true, md5: true, originalMd5: true },
                take: 500,
            });
        }
        catch {
            return out;
        }
        if (!rows.length)
            return out;
        const bySize = new Map();
        for (const r of rows) {
            const cand = {
                name: r.name,
                size: Number(r.size) || 0,
                originalSize: Number(r.originalSize) || 0,
                md5: r.md5 || '',
                originalMd5: r.originalMd5 || '',
            };
            for (const s of new Set([cand.size, cand.originalSize])) {
                if (!s)
                    continue;
                if (!bySize.has(s))
                    bySize.set(s, []);
                const bucket = bySize.get(s);
                if (!bucket.some((c) => c.name === cand.name && c.md5 === cand.md5))
                    bucket.push(cand);
            }
        }
        for (const f of files) {
            const cands = bySize.get(f.size);
            if (!cands || !cands.length)
                continue;
            const hit = this.resolveInsideRoot(roots, f.path);
            if (!hit)
                continue;
            const abs = (0, localfiles_util_1.safeJoin)(hit.root.real, hit.inside || '.');
            if (!abs)
                continue;
            try {
                const md5 = await (0, localfiles_util_1.hashFile)(abs);
                const probe = { size: f.size, md5 };
                const match = cands.find((c) => (0, dedup_1.isDuplicateFile)(probe, c));
                if (match)
                    out.set(f.path, match.name);
            }
            catch {
            }
        }
        return out;
    }
    async resolveWritable(req, channelId, rel) {
        const r = await this.resolveChannel(req, channelId);
        if (r.error)
            return { error: r.error };
        if (String(r.channel?.id || '') !== WEBDAV_VIRTUAL_ID) {
            return { error: '该渠道不支持重命名或删除（仅 WebDAV 文件可写）' };
        }
        const clean = (0, localfiles_util_1.sanitizeRelativeDir)(rel);
        if (clean === null || !clean)
            return { error: '文件路径不合法' };
        const hit = this.resolveInsideRoot(r.roots, clean);
        if (!hit)
            return { error: '文件路径越界' };
        if (!hit.inside)
            return { error: '不能对渠道根目录执行该操作' };
        const abs = (0, localfiles_util_1.safeJoin)(hit.root.real, hit.inside);
        if (!abs)
            return { error: '文件路径越界' };
        return { abs, rel: clean, channel: r.channel };
    }
    async rename(body, req) {
        if (!this.session(req))
            return { success: false, message: '请先登录' };
        const target = await this.resolveWritable(req, String(body?.channelId || ''), String(body?.path || ''));
        if (target.error)
            return { success: false, message: target.error };
        const raw = String(body?.name || '');
        const name = raw.trim();
        if (!name)
            return { success: false, message: '请输入新名称' };
        if (name.length > 255)
            return { success: false, message: '名称过长（最多 255 个字符）' };
        if (/[\\/\u0000-\u001f]/.test(name))
            return { success: false, message: '名称不能包含 / \\ 等非法字符' };
        if (name === '.' || name === '..')
            return { success: false, message: '名称不合法' };
        if ((0, localfiles_util_1.isHiddenName)(name))
            return { success: false, message: '名称不能以「.」开头' };
        const abs = target.abs;
        const parent = path.dirname(abs);
        const next = path.join(parent, name);
        if (next === abs)
            return { success: true, data: { path: target.rel, name } };
        const exists = await fs_1.promises.stat(next).then(() => true).catch(() => false);
        if (exists)
            return { success: false, message: '同目录下已存在同名文件或文件夹' };
        try {
            await fs_1.promises.rename(abs, next);
        }
        catch (err) {
            (0, localfiles_util_1.logLocalFileError)('重命名本地文件', `文件=${target.rel} 新名=${name}`, err);
            return { success: false, message: `重命名失败：${err.message || '未知错误'}` };
        }
        const oldRel = target.rel;
        const segs = oldRel.split('/');
        segs[segs.length - 1] = name;
        const newPath = segs.join('/');
        app_log_1.appLog.info('localfiles', 'WebDAV 文件重命名', `${oldRel} → ${newPath}（账户=${this.userName(req)}）`);
        return { success: true, data: { path: newPath, oldPath: oldRel, name } };
    }
    async remove(body, req) {
        if (!this.session(req))
            return { success: false, message: '请先登录' };
        const list = Array.isArray(body?.paths) ? body.paths.map((p) => String(p || '')) : [];
        if (!list.length)
            return { success: false, message: '请选择要删除的文件' };
        if (list.length > 200)
            return { success: false, message: '一次最多删除 200 个文件' };
        const channelId = String(body?.channelId || '');
        const removed = [];
        const failed = [];
        for (const rel of list) {
            const target = await this.resolveWritable(req, channelId, rel);
            if (target.error) {
                failed.push({ path: rel, message: target.error });
                continue;
            }
            try {
                await fs_1.promises.rm(target.abs, { recursive: true, force: true });
                removed.push(target.rel);
            }
            catch (err) {
                (0, localfiles_util_1.logLocalFileError)('删除本地文件', `文件=${rel}`, err);
                failed.push({ path: rel, message: err.message || '删除失败' });
            }
        }
        if (removed.length) {
            app_log_1.appLog.info('localfiles', 'WebDAV 文件删除', `共 ${removed.length} 项（账户=${this.userName(req)}）：${removed.slice(0, 10).join(', ')}`);
        }
        if (!removed.length) {
            return { success: false, message: failed[0]?.message || '删除失败' };
        }
        return { success: true, data: { removed, failed } };
    }
    async preview(req, res, q) {
        if (!this.session(req)) {
            res.status(401).json({ success: false, message: '请先登录' });
            return;
        }
        const r = await this.resolveChannel(req, q.channelId);
        if (r.error) {
            res.status(403).json({ success: false, message: r.error });
            return;
        }
        const roots = r.roots;
        const rel = (0, localfiles_util_1.sanitizeRelativeDir)(q.path);
        if (rel === null || !rel) {
            res.status(400).json({ success: false, message: '文件路径不合法' });
            return;
        }
        const hit = this.resolveInsideRoot(roots, rel);
        const abs = hit ? (0, localfiles_util_1.safeJoin)(hit.root.real, hit.inside || '.') : null;
        if (!abs) {
            res.status(400).json({ success: false, message: '文件路径越界' });
            return;
        }
        let st;
        try {
            st = await fs_1.promises.stat(abs);
        }
        catch (err) {
            (0, localfiles_util_1.logLocalFileError)('预览定位文件', `渠道=${r.channel.name} 路径=${rel}`, err);
            res.status(404).json({ success: false, message: '文件不存在' });
            return;
        }
        if (!st.isFile()) {
            res.status(400).json({ success: false, message: '不是文件' });
            return;
        }
        const ext = path.extname(abs).replace(/^\./, '').toLowerCase();
        const type = (0, localfiles_util_1.localTypeOf)(ext);
        const download = q.download === '1' || q.download === 'true';
        const cfg = await this.readSettings();
        const tooBig = st.size > cfg.previewThresholdMB * 1024 * 1024;
        const asAttachment = download || tooBig || !INLINE_TYPES.has(type);
        const mime = mimeOf(ext);
        res.setHeader('Content-Type', mime);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, max-age=60');
        const fileName = path.basename(abs);
        res.setHeader('Content-Disposition', `${asAttachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const range = String(req.headers.range || '');
        if (range && /^bytes=/.test(range)) {
            const m = /^bytes=(\d*)-(\d*)$/.exec(range.replace(/\s/g, ''));
            if (!m) {
                res.status(416).end();
                return;
            }
            const start = m[1] ? Number(m[1]) : 0;
            const end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
            if (Number.isNaN(start) || start >= st.size || end < start) {
                res.setHeader('Content-Range', `bytes */${st.size}`);
                res.status(416).end();
                return;
            }
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
            res.setHeader('Content-Length', String(end - start + 1));
            (0, fs_1.createReadStream)(abs, { start, end }).pipe(res);
            return;
        }
        res.setHeader('Content-Length', String(st.size));
        (0, fs_1.createReadStream)(abs).pipe(res);
    }
    async upload(body, req) {
        const session = this.session(req);
        if (!session)
            return { success: false, message: '请先登录' };
        const r = await this.resolveChannel(req, String(body?.channelId || ''));
        if (r.error)
            return { success: false, message: r.error };
        const roots = r.roots;
        const paths = Array.isArray(body?.paths) ? body.paths.slice(0, 200) : [];
        if (!paths.length)
            return { success: false, message: '请选择要上传的文件' };
        const ip = String(req.ip || '').replace(/^::ffff:/, '');
        const results = [];
        for (const raw of paths) {
            const rel = (0, localfiles_util_1.sanitizeRelativeDir)(raw);
            const name = rel ? path.basename(rel) : '';
            if (rel === null || !rel) {
                results.push({ path: String(raw || ''), name, success: false, error: '路径不合法' });
                continue;
            }
            const hit = this.resolveInsideRoot(roots, rel);
            const abs = hit ? (0, localfiles_util_1.safeJoin)(hit.root.real, hit.inside || '.') : null;
            if (!abs) {
                results.push({ path: rel, name, success: false, error: '路径越界' });
                continue;
            }
            try {
                const st = await fs_1.promises.stat(abs);
                if (!st.isFile()) {
                    results.push({ path: rel, name, success: false, error: '不是文件' });
                    continue;
                }
                const ext = path.extname(abs).replace(/^\./, '').toLowerCase();
                const res = await this.uploads.upload({ buffer: Buffer.alloc(0), path: abs, size: st.size, mime: mimeOf(ext), originalName: name }, {
                    channelId: String(body?.targetChannelId || '') || undefined,
                    uploader: session.user,
                    owner: session.user,
                    ip,
                    uploadFolder: String(body?.uploadFolder || '') || undefined,
                    instanceId: String(body?.instanceId || '') || undefined,
                    uploadSource: (0, file_view_1.isClientUploadSource)(body?.uploadSource)
                        ? (0, file_view_1.normalizeUploadSource)(body?.uploadSource)
                        : 'Default',
                    extraTags: ['本地上传'],
                    skipFileLimits: true,
                });
                if (res.error) {
                    results.push({ path: rel, name, success: false, error: res.error });
                    app_log_1.appLog.warn('localfiles', `上传到图床失败：${name}`, `${rel} ｜ ${res.error}`);
                }
                else {
                    results.push({ path: rel, name, success: true, id: res.id, dedup: !!res.dedup });
                    app_log_1.appLog.info('localfiles', `本地文件已上传到图床：${name}`, `${rel} ｜ 文件ID=${res.id} ｜ 来源=${(0, file_view_1.isClientUploadSource)(body?.uploadSource) ? (0, file_view_1.normalizeUploadSource)(body?.uploadSource) : 'Default'}` +
                        (res.dedup ? ' ｜ 命中已有内容（去重）' : ''), ip);
                }
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                results.push({ path: rel, name, success: false, error: msg });
                (0, localfiles_util_1.logLocalFileError)('上传', `渠道=${r.channel.name} 文件=${rel}`, err);
            }
        }
        return { success: true, data: results };
    }
};
exports.LocalFilesController = LocalFilesController;
__decorate([
    (0, common_1.Get)('channels'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], LocalFilesController.prototype, "channels", null);
__decorate([
    (0, common_1.Get)('settings'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], LocalFilesController.prototype, "getSettings", null);
__decorate([
    (0, common_1.Post)('settings'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LocalFilesController.prototype, "saveSettings", null);
__decorate([
    (0, common_1.Get)('tree'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LocalFilesController.prototype, "tree", null);
__decorate([
    (0, common_1.Get)('list'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LocalFilesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)('rename'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LocalFilesController.prototype, "rename", null);
__decorate([
    (0, common_1.Post)('delete'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LocalFilesController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)('preview'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], LocalFilesController.prototype, "preview", null);
__decorate([
    (0, common_1.Post)('upload'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LocalFilesController.prototype, "upload", null);
exports.LocalFilesController = LocalFilesController = __decorate([
    (0, common_1.Controller)('api/localfiles'),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        upload_service_1.UploadService,
        sysconfig_service_1.SysConfigService])
], LocalFilesController);
