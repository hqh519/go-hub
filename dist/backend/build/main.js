"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const settings_service_1 = require("./settings/settings.service");
require("./common/load-env");
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const platform_express_1 = require("@nestjs/platform-express");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const express_1 = __importDefault(require("express"));
const path_1 = require("path");
const fs_1 = require("fs");
const zlib_1 = require("zlib");
const app_module_1 = require("./app.module");
const channels_controller_1 = require("./channels/channels.controller");
const access_service_1 = require("./access/access.service");
const prisma_1 = require("./common/prisma");
const auth_guard_1 = require("./auth/auth.guard");
const rate_limit_1 = require("./common/rate-limit");
const app_log_1 = require("./common/app-log");
const tags_1 = require("./common/tags");
const crypto_service_1 = require("./common/crypto.service");
const project_paths_1 = require("./common/project-paths");
app_log_1.appLog.patchConsole();
let listCache = { at: 0, white: [], block: [], enabled: false };
let accessSvc = null;
async function loadLists() {
    if (Date.now() - listCache.at < 5000)
        return listCache;
    const rows = await prisma_1.prisma.setting.findMany({
        where: { key: { in: ['whiteIpList', 'blockIpList', 'securityEnabled'] } },
    });
    const raw = (k) => rows.find((r) => r.key === k)?.value || '';
    const parse = (v) => {
        if (!v)
            return [];
        try {
            const j = JSON.parse(v);
            return Array.isArray(j) ? j.map(String) : [];
        }
        catch {
            return v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
        }
    };
    listCache = {
        at: Date.now(),
        white: parse(raw('whiteIpList')),
        block: parse(raw('blockIpList')),
        enabled: raw('securityEnabled') === 'true',
    };
    return listCache;
}
process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
});
function clientIp(req) {
    const fwd = req.headers['x-forwarded-for']?.split(',')[0]?.trim();
    const ip = fwd || req.socket.remoteAddress || '';
    return ip.replace(/^::ffff:/, '');
}
function isLoopback(req) {
    const ip = clientIp(req);
    return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}
function stripAnchor(s) {
    return String(s || '').split('#')[0].trim();
}
function hostOf(urlOrHost) {
    const s = stripAnchor(urlOrHost).replace(/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//, '');
    const slash = s.indexOf('/');
    const host = slash === -1 ? s : s.slice(0, slash);
    return host.trim().toLowerCase().replace(/\.+$/, '');
}
function sourceAllowed(entry, sources) {
    const e = hostOf(entry);
    if (!e)
        return false;
    return sources.some((s) => {
        const h = hostOf(s);
        return !!h && h === e;
    });
}
function sourceAddressesOf(req) {
    const list = [];
    const referer = String(req.headers.referer || '').trim();
    if (referer)
        list.push(referer);
    const host = String(req.headers.host || '').trim();
    if (host) {
        const proto = req.protocol || 'http';
        list.push(`${proto}://${host}${req.originalUrl || req.url || ''}`);
    }
    const ip = clientIp(req);
    if (ip)
        list.push(ip);
    return list;
}
async function ensureInitialAdmin() {
    const adminCount = await prisma_1.prisma.user.count({ where: { role: 'admin' } });
    if (adminCount > 0)
        return;
    const username = (process.env.ADMIN_USER || 'admin').trim() || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'gohub';
    const hash = crypto_service_1.CryptoService.hashPassword(password);
    const existing = await prisma_1.prisma.user.findUnique({ where: { username } });
    if (existing) {
        await prisma_1.prisma.user.update({
            where: { id: existing.id },
            data: { role: 'admin', passwordHash: hash, uploadPassword: hash, enabled: true, canEdit: true, canDelete: true },
        });
        console.log(`[seed] 已把账户「${username}」提升为管理员（来自 ADMIN_USER / ADMIN_PASSWORD）`);
        return;
    }
    await prisma_1.prisma.user.create({
        data: {
            username,
            passwordHash: hash,
            uploadPassword: hash,
            nickname: '管理员',
            role: 'admin',
            enabled: true,
            canEdit: true,
            canDelete: true,
        },
    });
    const fromEnv = !!(process.env.ADMIN_USER || process.env.ADMIN_PASSWORD);
    console.log(`[seed] 已创建初始管理员账户：${username}` +
        `（密码取自 ${fromEnv ? 'ADMIN_PASSWORD' : '默认值 gohub'}，请登录后台后立即修改）`);
}
async function bootstrap() {
    const server = (0, express_1.default)();
    server.set('trust proxy', true);
    server.use((req, _res, next) => {
        req._arrivedAt = Date.now();
        next();
    });
    server.use((0, cookie_parser_1.default)());
    server.use('/s3', express_1.default.raw({ type: '*/*', limit: '200mb' }));
    const expressRawForDav = express_1.default.raw({ type: '*/*', limit: '4mb' });
    server.use('/dav', (req, res, next) => {
        const method = String(req.method || '').toUpperCase();
        if (method === 'OPTIONS') {
            res.setHeader('DAV', '1,2');
            res.setHeader('MS-Author-Via', 'DAV');
            res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY');
            res.setHeader('Content-Length', '0');
            return res.status(200).end();
        }
        next();
    });
    server.use('/dav', (req, res, next) => {
        if (String(req.method || '').toUpperCase() === 'PUT') {
            req._body = true;
            return next();
        }
        return expressRawForDav(req, res, next);
    });
    server.use(express_1.default.json({ limit: '2mb' }));
    server.use(express_1.default.text({ type: ['text/plain'], limit: '1mb' }));
    server.use((req, res, next) => {
        loadLists()
            .then((lists) => {
            if (!lists.enabled)
                return next();
            if (isLoopback(req))
                return next();
            if ((0, auth_guard_1.parseSession)(req.cookies?.[auth_guard_1.SESSION_COOKIE]))
                return next();
            const ip = clientIp(req);
            if (lists.block.includes(ip))
                return res.status(403).send('Forbidden: IP blocked');
            if (lists.white.length > 0) {
                const sources = sourceAddressesOf(req);
                if (!lists.white.some((entry) => sourceAllowed(entry, sources))) {
                    console.error(`[security] 白名单拦截 ip=${ip} referer=${String(req.headers.referer || '-')} path=${req.originalUrl || req.url} ｜ 放行清单=${lists.white.join(',') || '(空)'}`);
                    return res.status(403).send('Forbidden: source not in whitelist');
                }
            }
            next();
        })
            .catch(() => next());
    });
    const frontendDir = (0, project_paths_1.frontendAppDir)();
    if (frontendDir) {
        const GZIP_TYPES = {
            '.js': 'application/javascript; charset=utf-8',
            '.mjs': 'application/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.svg': 'image/svg+xml',
            '.txt': 'text/plain; charset=utf-8',
            '.map': 'application/json; charset=utf-8',
            '.html': 'text/html; charset=utf-8',
        };
        const gzipCache = new Map();
        const GZIP_MAX_ENTRIES = 240;
        server.use((req, res, next) => {
            if (req.method !== 'GET' && req.method !== 'HEAD')
                return next();
            if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || '')))
                return next();
            if (res.getHeader('Content-Encoding'))
                return next();
            let rel = req.path || '';
            if (!rel || rel === '/' || rel.includes('..'))
                return next();
            const dot = rel.lastIndexOf('.');
            if (dot < 0)
                return next();
            const ext = rel.slice(dot).toLowerCase();
            const contentType = GZIP_TYPES[ext];
            if (!contentType)
                return next();
            let full;
            try {
                rel = decodeURIComponent(rel);
                if (rel.includes('..'))
                    return next();
                full = (0, path_1.join)(frontendDir, rel);
            }
            catch (e) {
                return next();
            }
            let st;
            try {
                st = (0, fs_1.statSync)(full);
                if (!st.isFile())
                    return next();
            }
            catch (e) {
                return next();
            }
            if (st.size < 1024)
                return next();
            try {
                const hit = gzipCache.get(full);
                let body;
                if (hit && hit.mtime === st.mtimeMs) {
                    body = hit.body;
                }
                else {
                    body = (0, zlib_1.gzipSync)((0, fs_1.readFileSync)(full), { level: 6 });
                    if (gzipCache.size >= GZIP_MAX_ENTRIES)
                        gzipCache.clear();
                    gzipCache.set(full, { mtime: st.mtimeMs, body });
                }
                res.setHeader('Content-Type', contentType);
                res.setHeader('Content-Encoding', 'gzip');
                res.setHeader('Vary', 'Accept-Encoding');
                res.setHeader('Content-Length', String(body.length));
                res.setHeader('Cache-Control', /[/\\]assets[/\\]/.test(full) ? 'public, max-age=31536000, immutable' : 'no-cache');
                if (req.method === 'HEAD')
                    return res.status(200).end();
                return res.status(200).end(body);
            }
            catch (e) {
                return next();
            }
        });
        server.use(express_1.default.static(frontendDir, {
            index: false,
            setHeaders(res, filePath) {
                if (/[/\\]assets[/\\]/.test(filePath)) {
                    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                }
                else {
                    res.setHeader('Cache-Control', 'no-cache');
                }
            },
        }));
    }
    const SPA_SKIP = /^\/(api|upload|file|random|dav|dev|s3)(\/|$)/;
    if (frontendDir) {
        server.use((req, res, next) => {
            if (req.method !== 'GET' && req.method !== 'HEAD')
                return next();
            if (SPA_SKIP.test(req.path))
                return next();
            if (/\.[a-zA-Z0-9]+$/.test(req.path))
                return next();
            const accept = req.headers.accept || '';
            if (accept && !accept.includes('*/*') && !accept.includes('text/html'))
                return next();
            res.setHeader('Cache-Control', 'no-cache');
            return res.sendFile((0, path_1.join)(frontendDir, 'index.html'));
        });
    }
    server.use((0, rate_limit_1.rateLimiter)());
    server.use((req, res, next) => {
        const started = Date.now();
        res.on('finish', () => {
            try {
                const ms = Date.now() - started;
                const status = res.statusCode;
                const isFile = req.path.startsWith('/file/');
                const isWrite = req.method !== 'GET' && req.method !== 'HEAD';
                if (isFile && status < 400)
                    return;
                if ((req.path === '/dav' || req.path.startsWith('/dav/')) && status < 400)
                    return;
                if (!isWrite && status < 400 && ms < 3000)
                    return;
                const line = `${req.method} ${req.originalUrl} → ${status} (${ms}ms)`;
                const ip = clientIp(req);
                if (status >= 500)
                    app_log_1.appLog.error('http', line, undefined, ip);
                else if (status >= 400)
                    app_log_1.appLog.warn('http', line, undefined, ip);
                else if (ms >= 3000)
                    app_log_1.appLog.warn('http', `${line} [慢请求]`, undefined, ip);
                else
                    app_log_1.appLog.info('http', line, undefined, ip);
            }
            catch {
            }
        });
        next();
    });
    server.use((req, res, next) => {
        const isFile = req.path.startsWith('/file/') || req.path === '/random';
        if (!isFile || (req.method !== 'GET' && req.method !== 'HEAD'))
            return next();
        if (req.query.from === 'admin')
            return next();
        res.on('finish', () => {
            try {
                if (!accessSvc)
                    return;
                const ip = clientIp(req);
                if (!ip || ip === '127.0.0.1' || ip === '::1')
                    return;
                const session = (0, auth_guard_1.parseSession)(req.cookies?.[auth_guard_1.SESSION_COOKIE]);
                void accessSvc.record({
                    ip,
                    path: req.path,
                    referer: String(req.headers.referer || ''),
                    username: session?.user || '',
                    ua: String(req.headers['user-agent'] || ''),
                    method: req.method,
                    status: res.statusCode,
                    kind: 'file',
                });
            }
            catch {
            }
        });
        next();
    });
    const publicDir = (0, project_paths_1.backendSub)('public');
    if ((0, fs_1.existsSync)(publicDir))
        server.use('/dev', express_1.default.static(publicDir));
    const app = await core_1.NestFactory.create(app_module_1.AppModule, new platform_express_1.ExpressAdapter(server), { logger: ['error', 'warn', 'log'] });
    app.enableCors({ origin: true, credentials: true });
    await app.init();
    try {
        await app.get(channels_controller_1.ChannelsService).ensureBuiltinLocalChannel();
        await app.get(channels_controller_1.ChannelsService).ensureBuiltinLocalFilesChannel();
    }
    catch (err) {
        console.warn(`[local-channel] 内置本地存储渠道初始化失败：${err.message}`);
    }
    try {
        await app.get(settings_service_1.SettingsService).getServerDomain();
    }
    catch {
    }
    try {
        const svc = app.get(access_service_1.AccessService);
        accessSvc = svc;
        void svc.cleanup();
        const timer = setInterval(() => void svc.cleanup(), 6 * 3600 * 1000);
        timer.unref?.();
    }
    catch (err) {
        console.warn(`[access] 访问记录服务初始化失败：${err.message}`);
    }
    try {
        await ensureInitialAdmin();
    }
    catch (err) {
        console.warn(`[seed] 初始管理员账户写入失败：${err.message}`);
    }
    const secret = process.env.CONFIG_SECRET || '';
    if (!secret || /^(please-change|change-me)/.test(secret)) {
        console.warn('[security] ⚠️ CONFIG_SECRET 未配置或仍是模板默认值：渠道密钥将使用内置开发密钥加密，' +
            '请尽快在 .env / compose 里设置随机长串（修改后已保存的渠道密钥需重新填写）。');
    }
    try {
        const merged = await (0, tags_1.mergeDuplicateTags)();
        if (merged) {
            console.log(`[tag] 已合并历史重复标签 ${merged} 条（实例 + 类型 + 名称 确权迁移）`);
            app_log_1.appLog.info('file', `标签确权迁移：合并重复标签 ${merged} 条`, '实例 + 类型 + 名称 作为唯一口径');
        }
    }
    catch (err) {
        console.warn(`[tag] 标签去重失败：${err.message}`);
    }
    const port = Number(process.env.PORT || 3619);
    await app.listen(port, '0.0.0.0');
    const httpServer = app.getHttpServer();
    const uploadTimeout = Number(process.env.UPLOAD_REQUEST_TIMEOUT_MS || 0);
    httpServer.requestTimeout = Number.isFinite(uploadTimeout) && uploadTimeout >= 0 ? uploadTimeout : 0;
    httpServer.headersTimeout = 120_000;
    httpServer.keepAliveTimeout = 65_000;
    httpServer.setTimeout(0);
    console.log(`GoHub 已启动: http://localhost:${port}`);
}
bootstrap();
