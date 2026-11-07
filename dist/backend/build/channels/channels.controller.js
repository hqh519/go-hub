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
exports.ChannelAllowedController = exports.ChannelManageController = exports.StorageSettingsController = exports.ChannelsController = exports.parseAuthorizedUsers = exports.channelVisibleTo = exports.ChannelsService = exports.CHANNEL_ORDER_BY = exports.CUSTOM_LOCAL_TYPE_CODE = exports.CHANNEL_TYPE_CODE = exports.LEGACY_LOCAL_CHANNEL_CODE = exports.LOCAL_FILES_CHANNEL_CODE = exports.LOCAL_CHANNEL_CODE = exports.BUILTIN_CHANNEL_TYPES = exports.CHANNEL_TYPES = void 0;
exports.channelTypeCode = channelTypeCode;
const local_adapter_1 = require("../adapters/local.adapter");
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const crypto_service_1 = require("../common/crypto.service");
const auth_guard_1 = require("../auth/auth.guard");
const settings_service_1 = require("../settings/settings.service");
const adapter_factory_1 = require("../adapters/adapter.factory");
const storage_channel_service_1 = require("../storage/storage-channel.service");
const app_log_1 = require("../common/app-log");
const channel_domain_1 = require("../common/channel-domain");
const mounts_1 = require("./mounts");
const SECRET_FIELDS = {
    local: [],
    cos: ['secretId', 'secretKey'],
    minio: ['accessKeyId', 'secretAccessKey'],
    r2: ['accessKeyId', 'secretAccessKey'],
    s3: ['accessKeyId', 'secretAccessKey'],
    easyimages: ['tokenValue'],
    lsky: ['tokenValue'],
    webdav: ['password'],
    immich: ['apiKey'],
    custom: ['tokenValue'],
};
exports.CHANNEL_TYPES = ['cos', 'minio', 'r2', 's3', 'aliyun', 'easyimages', 'lsky', 'webdav', 'immich', 'custom', 'local', 'localfiles'];
exports.BUILTIN_CHANNEL_TYPES = ['local'];
exports.LOCAL_CHANNEL_CODE = '999999';
exports.LOCAL_FILES_CHANNEL_CODE = '999990';
exports.LEGACY_LOCAL_CHANNEL_CODE = '100000';
exports.CHANNEL_TYPE_CODE = {
    easyimages: 100,
    lsky: 110,
    immich: 120,
    minio: 130,
    r2: 140,
    s3: 150,
    cos: 160,
    aliyun: 170,
    webdav: 180,
    custom: 190,
    localfiles: 1000,
    local: 999,
};
exports.CUSTOM_LOCAL_TYPE_CODE = 995;
function channelTypeCode(type, code) {
    if (type === 'local' && code !== undefined && code !== exports.LOCAL_CHANNEL_CODE)
        return exports.CUSTOM_LOCAL_TYPE_CODE;
    return exports.CHANNEL_TYPE_CODE[type] ?? 998;
}
exports.CHANNEL_ORDER_BY = [{ typeCode: 'asc' }, { name: 'asc' }];
async function makeTestPng() {
    try {
        const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
        return await sharp({
            create: { width: 512, height: 512, channels: 3, background: { r: 84, g: 150, b: 214 } },
        })
            .png()
            .toBuffer();
    }
    catch {
        return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    }
}
const IDENTITY_FIELDS = {
    cos: ['secretId', 'bucket', 'region'],
    minio: ['endpoint', 'bucket', 'accessKeyId'],
    r2: ['endpoint', 'bucket', 'accessKeyId'],
    s3: ['endpoint', 'bucket', 'accessKeyId'],
    easyimages: ['apiUrl', 'tokenValue'],
    lsky: ['apiUrl', 'tokenValue'],
    webdav: ['baseUri', 'username'],
    immich: ['serverUrl', 'apiKey'],
    custom: ['apiUrl', 'tokenValue'],
    local: ['rootPath'],
};
function channelIdentity(type, cfg) {
    const fields = IDENTITY_FIELDS[type] || [];
    return `${type}::${fields.map((f) => cfg[f] || '').join('|')}`;
}
let ChannelsService = class ChannelsService {
    settings;
    constructor(settings) {
        this.settings = settings;
    }
    decryptConfig(type, configJson) {
        const cfg = JSON.parse(configJson || '{}');
        const out = {};
        for (const [k, v] of Object.entries(cfg)) {
            out[k] = SECRET_FIELDS[type]?.includes(k) ? crypto_service_1.CryptoService.decrypt(String(v)) : String(v);
        }
        return (0, channel_domain_1.normalizeBucketDomain)(type, out);
    }
    maskConfig(type, configJson) {
        const cfg = JSON.parse(configJson || '{}');
        const out = {};
        for (const [k, v] of Object.entries(cfg)) {
            out[k] = SECRET_FIELDS[type]?.includes(k) ? crypto_service_1.CryptoService.mask(crypto_service_1.CryptoService.decrypt(String(v))) : String(v);
        }
        return out;
    }
    identityOf(type, configJson) {
        return channelIdentity(type, this.decryptConfig(type, configJson));
    }
    async ensureBuiltinLocalChannel() {
        const legacy = await prisma_1.prisma.channel.findUnique({ where: { code: exports.LEGACY_LOCAL_CHANNEL_CODE } });
        if (legacy) {
            const taken = await prisma_1.prisma.channel.findUnique({ where: { code: exports.LOCAL_CHANNEL_CODE } });
            if (!taken) {
                await prisma_1.prisma.channel.update({ where: { id: legacy.id }, data: { code: exports.LOCAL_CHANNEL_CODE } });
            }
            else if (taken.id !== legacy.id) {
                let alt = '';
                for (let i = 0; i < 60 && !alt; i++) {
                    const c = String(100000 + Math.floor(Math.random() * 899000));
                    if (c !== exports.LOCAL_CHANNEL_CODE && !(await prisma_1.prisma.channel.findUnique({ where: { code: c } })))
                        alt = c;
                }
                await prisma_1.prisma.channel.update({ where: { id: taken.id }, data: { code: alt || '100001' } });
                await prisma_1.prisma.channel.update({ where: { id: legacy.id }, data: { code: exports.LOCAL_CHANNEL_CODE } });
            }
        }
        const all = await prisma_1.prisma.channel.findMany({ select: { id: true, type: true, typeCode: true, code: true } });
        for (const c of all) {
            const want = channelTypeCode(c.type, c.code);
            if (c.typeCode !== want) {
                await prisma_1.prisma.channel.update({ where: { id: c.id }, data: { typeCode: want } });
            }
        }
        const existing = await prisma_1.prisma.channel.findUnique({ where: { code: exports.LOCAL_CHANNEL_CODE } });
        if (existing) {
            const patch = {};
            if (existing.type !== 'local')
                patch.type = 'local';
            if (!existing.enabled)
                patch.enabled = true;
            if (existing.typeCode !== channelTypeCode('local'))
                patch.typeCode = channelTypeCode('local');
            if (!existing.isMain && !existing.isBackup) {
                const hasMain = await prisma_1.prisma.channel.count({
                    where: { isMain: true, enabled: true, NOT: { id: existing.id } },
                });
                if (hasMain === 0)
                    patch.isMain = true;
            }
            if (Object.keys(patch).length) {
                await prisma_1.prisma.channel.update({ where: { id: existing.id }, data: patch });
            }
            return;
        }
        let name = '本地存储';
        if (await prisma_1.prisma.channel.findUnique({ where: { name } }))
            name = '本地存储-系统';
        if (await prisma_1.prisma.channel.findUnique({ where: { name } }))
            name = '本地存储_系统';
        const hasMain = await prisma_1.prisma.channel.count({ where: { isMain: true } });
        await prisma_1.prisma.channel.create({
            data: {
                code: exports.LOCAL_CHANNEL_CODE,
                name,
                type: 'local',
                typeCode: channelTypeCode('local'),
                enabled: true,
                isMain: hasMain === 0,
                isBackup: false,
                sortOrder: 9999,
                config: JSON.stringify({ quotaEnabled: 'false', quotaLimitGB: '10', quotaThreshold: '95' }),
            },
        });
    }
    async ensureBuiltinLocalFilesChannel() {
        const root = local_adapter_1.LocalAdapter.root();
        const existing = await prisma_1.prisma.channel.findUnique({ where: { code: exports.LOCAL_FILES_CHANNEL_CODE } });
        if (existing) {
            let cfg = {};
            try {
                cfg = JSON.parse(existing.config || '{}');
            }
            catch {
                cfg = {};
            }
            const current = Array.isArray(cfg.rootPaths) ? cfg.rootPaths : [];
            const patch = {};
            if (existing.type !== 'localfiles')
                patch.type = 'localfiles';
            if (!existing.enabled)
                patch.enabled = true;
            const wantCode = channelTypeCode('localfiles');
            if (existing.typeCode !== wantCode)
                patch.typeCode = wantCode;
            if (current.length !== 1 || String(current[0]) !== root) {
                patch.config = JSON.stringify({ ...cfg, rootPaths: [root] });
            }
            if (Object.keys(patch).length) {
                await prisma_1.prisma.channel.update({ where: { id: existing.id }, data: patch });
            }
            return;
        }
        let name = '本地文件';
        if (await prisma_1.prisma.channel.findUnique({ where: { name } }))
            name = '本地文件-系统';
        if (await prisma_1.prisma.channel.findUnique({ where: { name } }))
            name = '本地文件_系统';
        await prisma_1.prisma.channel.create({
            data: {
                code: exports.LOCAL_FILES_CHANNEL_CODE,
                name,
                type: 'localfiles',
                typeCode: channelTypeCode('localfiles'),
                enabled: true,
                isMain: false,
                isBackup: false,
                sortOrder: 9998,
                config: JSON.stringify({ rootPaths: [root] }),
            },
        });
    }
};
exports.ChannelsService = ChannelsService;
exports.ChannelsService = ChannelsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [settings_service_1.SettingsService])
], ChannelsService);
const channel_access_1 = require("../common/channel-access");
Object.defineProperty(exports, "channelVisibleTo", { enumerable: true, get: function () { return channel_access_1.channelVisibleTo; } });
Object.defineProperty(exports, "parseAuthorizedUsers", { enumerable: true, get: function () { return channel_access_1.parseAuthorizedUsers; } });
let ChannelsController = class ChannelsController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    async list(req, includeDisabled) {
        const session = (0, auth_guard_1.currentSession)(req);
        const admin = (0, auth_guard_1.isAdminRole)(session?.role);
        const username = session?.user || '';
        const channels = await prisma_1.prisma.channel.findMany({
            where: includeDisabled === 'true' && admin ? {} : { enabled: true },
            orderBy: exports.CHANNEL_ORDER_BY,
        });
        const grouped = {};
        for (const c of channels) {
            if (!(0, channel_access_1.channelVisibleTo)(c.authorizedUsers, c.type, username, admin))
                continue;
            if (!grouped[c.type])
                grouped[c.type] = [];
            grouped[c.type].push({
                id: c.id,
                code: c.code,
                name: c.name,
                type: c.type,
                typeCode: c.typeCode,
                enabled: c.enabled,
                isMain: c.isMain,
                isBackup: c.isBackup,
                backupPool: c.backupPool,
                config: this.svc.maskConfig(c.type, c.config),
            });
        }
        return grouped;
    }
};
exports.ChannelsController = ChannelsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('includeDisabled')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ChannelsController.prototype, "list", null);
exports.ChannelsController = ChannelsController = __decorate([
    (0, common_1.Controller)('api/channels'),
    __metadata("design:paramtypes", [ChannelsService])
], ChannelsController);
let StorageSettingsController = class StorageSettingsController {
    settings;
    svc;
    storageChannel;
    constructor(settings, svc, storageChannel) {
        this.settings = settings;
        this.svc = svc;
        this.storageChannel = storageChannel;
    }
    async get() {
        const [linkMode, accessChannel, proxyTimeoutMs, proxyCacheSeconds, dedupEnabled, dedupScope, customDomain] = await Promise.all([
            this.settings.getLinkMode(),
            this.settings.getAccessChannel(),
            this.settings.get('proxyTimeoutMs', '15000'),
            this.settings.get('proxyCacheSeconds', '86400'),
            this.settings.get('dedupEnabled', 'false'),
            this.settings.get('dedupScope', 'all'),
            this.settings.getCustomDomain(),
        ]);
        const pickBrief = (c) => c ? { id: c.id, code: c.code, name: c.name, type: c.type, enabled: true } : null;
        return {
            linkMode,
            accessChannel,
            proxyTimeoutMs: Number(proxyTimeoutMs) || 15000,
            proxyCacheSeconds: Number(proxyCacheSeconds) || 86400,
            dedupEnabled: dedupEnabled === 'true',
            dedupScope: dedupScope === 'channelType' ? 'channelType' : dedupScope === 'channel' ? 'channel' : 'all',
            customDomain,
            mainChannel: pickBrief(await this.storageChannel.getStorageChannel('', 'main')),
            backupChannel: pickBrief(await this.storageChannel.getStorageChannel('', 'backup')),
        };
    }
    async save(body) {
        if (body.linkMode !== undefined) {
            const v = body.linkMode === 'redirect' ? 'redirect' : 'proxy';
            await this.settings.set('linkMode', v);
        }
        if (body.accessChannel !== undefined) {
            await this.settings.set('accessChannel', body.accessChannel === 'backup' ? 'backup' : 'main');
        }
        if (body.proxyTimeoutMs !== undefined) {
            const n = Math.min(120000, Math.max(1000, Number(body.proxyTimeoutMs) || 15000));
            await this.settings.set('proxyTimeoutMs', String(n));
        }
        if (body.proxyCacheSeconds !== undefined) {
            const n = Math.max(0, Number(body.proxyCacheSeconds) || 0);
            await this.settings.set('proxyCacheSeconds', String(n));
        }
        if (body.dedupEnabled !== undefined) {
            await this.settings.set('dedupEnabled', body.dedupEnabled ? 'true' : 'false');
        }
        if (body.dedupScope !== undefined) {
            const v = body.dedupScope === 'channelType' ? 'channelType' : body.dedupScope === 'channel' ? 'channel' : 'all';
            await this.settings.set('dedupScope', v);
        }
        if (body.customDomain !== undefined) {
            const dom = String(body.customDomain || '').trim().replace(/\/+$/, '');
            await this.settings.set('customDomain', dom);
        }
        return { success: true };
    }
};
exports.StorageSettingsController = StorageSettingsController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], StorageSettingsController.prototype, "get", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], StorageSettingsController.prototype, "save", null);
exports.StorageSettingsController = StorageSettingsController = __decorate([
    (0, common_1.Controller)('api/manage/storage'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        ChannelsService,
        storage_channel_service_1.StorageChannelService])
], StorageSettingsController);
let ChannelManageController = class ChannelManageController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    async list() {
        const channels = await prisma_1.prisma.channel.findMany({
            orderBy: exports.CHANNEL_ORDER_BY,
        });
        const copies = await prisma_1.prisma.fileCopy.findMany({
            where: { status: 'active' },
            include: { file: { select: { size: true } } },
        });
        const usageMB = new Map();
        for (const c of copies) {
            usageMB.set(c.channelId, (usageMB.get(c.channelId) || 0) + (c.file?.size || 0) / 1024 / 1024);
        }
        const grouped = {};
        const addable = [...exports.CHANNEL_TYPES].sort((a, b) => channelTypeCode(a) - channelTypeCode(b));
        for (const type of addable)
            grouped[type] = [];
        for (const c of channels) {
            const config = this.svc.maskConfig(c.type, c.config);
            (grouped[c.type] ||= []).push({
                id: c.id,
                code: c.code,
                name: c.name,
                type: c.type,
                typeCode: c.typeCode,
                enabled: c.enabled,
                isMain: c.isMain,
                isBackup: c.isBackup,
                backupPool: c.backupPool,
                authorizedUsers: (0, channel_access_1.parseAuthorizedUsers)(c.authorizedUsers),
                sortOrder: c.sortOrder,
                config,
                quota: {
                    enabled: config.quotaEnabled === 'true',
                    limitGB: Number(config.quotaLimitGB) || 10,
                    threshold: Number(config.quotaThreshold) || 95,
                    usedMB: Math.round((usageMB.get(c.id) || 0) * 100) / 100,
                },
            });
        }
        return grouped;
    }
    async mounts() {
        try {
            const list = await (0, mounts_1.listContainerMounts)();
            return { success: true, data: list };
        }
        catch (err) {
            app_log_1.appLog.warn('channel', '读取容器内映射路径失败', err.message);
            return { success: false, message: '读取容器内映射路径失败', data: [] };
        }
    }
    async plain(id) {
        const c = await prisma_1.prisma.channel.findUnique({ where: { id } });
        if (!c)
            return { success: false, message: '渠道不存在' };
        return { success: true, type: c.type, config: this.svc.decryptConfig(c.type, c.config) };
    }
    async enforceUniqueFlags(id, isMain, isBackup) {
        if (isMain) {
            await prisma_1.prisma.channel.updateMany({
                where: id ? { isMain: true, NOT: { id } } : { isMain: true },
                data: { isMain: false },
            });
        }
        if (isBackup) {
            await prisma_1.prisma.channel.updateMany({
                where: id ? { isBackup: true, NOT: { id } } : { isBackup: true },
                data: { isBackup: false },
            });
        }
    }
    async verifyAdminPassword(req, password) {
        const me = (0, auth_guard_1.currentSession)(req)?.user || '';
        const p = String(password || '');
        if (!me || !p)
            return false;
        try {
            const u = await prisma_1.prisma.user.findUnique({ where: { username: me } });
            if (u?.passwordHash)
                return crypto_service_1.CryptoService.verifyPassword(p, u.passwordHash);
        }
        catch {
        }
        const envUser = (process.env.SUPER_ADMIN_USERNAME || process.env.ADMIN_USER || 'admin').trim();
        const envPass = process.env.SUPER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'gohub';
        return me === envUser && p === envPass;
    }
    async sameAccountAsMain(type, selfId, identity) {
        const main = await prisma_1.prisma.channel.findFirst({ where: { isMain: true, NOT: selfId ? { id: selfId } : undefined } });
        if (!main)
            return null;
        if (this.svc.identityOf(main.type, main.config) === identity) {
            return `备份渠道不能与主渠道「${main.name}」使用同一账户`;
        }
        return null;
    }
    async nextCode() {
        for (let i = 0; i < 60; i++) {
            const code = String(100000 + Math.floor(Math.random() * 899000));
            if (code === exports.LOCAL_CHANNEL_CODE || code === exports.LOCAL_FILES_CHANNEL_CODE)
                continue;
            if (!(await prisma_1.prisma.channel.findUnique({ where: { code } })))
                return code;
        }
        const fallback = String(Date.now()).slice(-6);
        return fallback === exports.LOCAL_CHANNEL_CODE || fallback === exports.LOCAL_FILES_CHANNEL_CODE ? '100001' : fallback;
    }
    async nextLocalCode() {
        for (let n = 990000; n <= 999998; n++) {
            const code = String(n);
            if (code === exports.LOCAL_CHANNEL_CODE || code === exports.LOCAL_FILES_CHANNEL_CODE)
                continue;
            if (!(await prisma_1.prisma.channel.findUnique({ where: { code } })))
                return code;
        }
        return this.nextCode();
    }
    validateLocalRootPath(raw) {
        const s = String(raw || '').trim();
        if (!s)
            return { ok: false, message: '自定义本地渠道必须填写 rootPath（容器内存储地址）' };
        if (s.includes('..'))
            return { ok: false, message: 'rootPath 禁止包含 ".."' };
        return { ok: true, rootPath: s };
    }
    validateLocalRootPaths(raw) {
        let list = [];
        if (Array.isArray(raw)) {
            list = raw.map((v) => String(v || '').trim());
        }
        else if (typeof raw === 'string') {
            list = raw.split(/\r?\n/).map((v) => v.trim());
        }
        list = list.filter(Boolean);
        if (!list.length) {
            return { ok: false, message: '本地文件渠道必须填写「浏览目录」（容器内绝对路径，一行一个）' };
        }
        const bad = list.find((p) => p.includes('..'));
        if (bad)
            return { ok: false, message: `浏览目录禁止包含 ".."：${bad}` };
        return { ok: true, rootPaths: list.join('\n') };
    }
    async create(body) {
        if (!exports.CHANNEL_TYPES.includes(body.type)) {
            return { success: false, message: `不支持的渠道类型: ${body.type}` };
        }
        if (!body.name || !String(body.name).trim()) {
            return { success: false, message: '渠道名称不能为空' };
        }
        if (body.isBackup && body.isMain) {
            return { success: false, message: '同一条渠道不能同时作为主渠道和备份渠道' };
        }
        const dup = await prisma_1.prisma.channel.findFirst({ where: { name: body.name } });
        if (dup)
            return { success: false, message: `渠道名称「${body.name}」已存在` };
        if (body.type === 'localfiles' && (body.isMain || body.isBackup)) {
            return { success: false, message: '本地文件渠道只用于浏览本地目录，不能设为主渠道或备份渠道' };
        }
        const raw = (0, channel_domain_1.normalizeBucketDomain)(body.type, body.config || {});
        let rootPath = '';
        if (body.type === 'local') {
            const check = this.validateLocalRootPath(raw.rootPath);
            if (!check.ok)
                return { success: false, message: check.message };
            rootPath = check.rootPath;
        }
        else if (body.type === 'localfiles') {
            const check = this.validateLocalRootPaths(raw.rootPaths ?? raw.rootPath);
            if (!check.ok)
                return { success: false, message: check.message };
            raw.rootPaths = check.rootPaths;
            if (!String(raw.hostPath || '').trim())
                delete raw.hostPath;
        }
        if (body.isBackup) {
            const err = await this.sameAccountAsMain(body.type, null, channelIdentity(body.type, raw));
            if (err)
                return { success: false, message: err };
        }
        const encrypted = {};
        for (const [k, v] of Object.entries(raw)) {
            encrypted[k] = SECRET_FIELDS[body.type]?.includes(k) ? crypto_service_1.CryptoService.encrypt(String(v)) : String(v);
        }
        const isLocal = body.type === 'local';
        const ch = await prisma_1.prisma.channel.create({
            data: {
                name: body.name,
                type: body.type,
                typeCode: isLocal ? exports.CUSTOM_LOCAL_TYPE_CODE : channelTypeCode(body.type),
                config: JSON.stringify(encrypted),
                isMain: !!body.isMain,
                isBackup: !!body.isBackup,
                code: isLocal ? await this.nextLocalCode() : await this.nextCode(),
            },
        });
        await this.enforceUniqueFlags(ch.id, body.isMain, body.isBackup);
        app_log_1.appLog.info('channel', `新增渠道：${body.name}（${body.type}${isLocal ? `，rootPath=${rootPath}` : ''}）`, `code=${ch.code}`);
        return { success: true, data: { id: ch.id, code: ch.code } };
    }
    async update(req, id, body) {
        const ch = await prisma_1.prisma.channel.findUnique({ where: { id } });
        if (!ch)
            return { success: false, message: '渠道不存在' };
        if (body.isMain && body.isBackup) {
            return { success: false, message: '同一条渠道不能同时作为主渠道和备份渠道' };
        }
        if (ch.type === 'localfiles' && (body.isMain || body.isBackup)) {
            return { success: false, message: '本地文件渠道只用于浏览本地目录，不能设为主渠道或备份渠道' };
        }
        if (body.name !== undefined && String(body.name).trim() !== ch.name) {
            const name = String(body.name).trim();
            if (!name)
                return { success: false, message: '渠道名称不能为空' };
            const dup = await prisma_1.prisma.channel.findFirst({ where: { name, NOT: { id } } });
            if (dup)
                return { success: false, message: `渠道名称「${name}」已存在` };
        }
        const old = this.svc.decryptConfig(ch.type, ch.config);
        const merged = { ...old };
        for (const [k, v] of Object.entries(body.config || {})) {
            if (String(v).includes('****'))
                continue;
            merged[k] = v;
        }
        if (ch.code === exports.LOCAL_FILES_CHANNEL_CODE) {
            merged.rootPaths = JSON.stringify([local_adapter_1.LocalAdapter.root()]);
            delete merged.rootPath;
        }
        if (!['local', 'localfiles'].includes(ch.type)) {
            const pd = String(merged.publicDomain || '').trim();
            if (!pd) {
                const ep = String(merged.endpoint || merged.apiUrl || merged.serverUrl || merged.baseUri || merged.domain || '').trim();
                if (ep) {
                    try {
                        merged.publicDomain = new URL(/^https?:\/\//i.test(ep) ? ep : `https://${ep}`).origin;
                    }
                    catch {
                        merged.publicDomain = ep;
                    }
                }
            }
        }
        if (body.isBackup) {
            const err = await this.sameAccountAsMain(ch.type, id, channelIdentity(ch.type, merged));
            if (err)
                return { success: false, message: err };
        }
        if (ch.type === 'local' || ch.type === 'localfiles') {
            const rootSig = (cfg) => {
                const rp = String(cfg.rootPaths || '').trim();
                const r = String(cfg.rootPath || '').trim();
                return `${rp}\u0000${r}`;
            };
            if (ch.code !== exports.LOCAL_FILES_CHANNEL_CODE && rootSig(old) !== rootSig(merged)) {
                if (!(await this.verifyAdminPassword(req, String(body?.adminPassword || '')))) {
                    app_log_1.appLog.warn('channel', `修改本地存储地址被拦截：${ch.name}`, '未提供或提供了错误的管理员密码');
                    return { success: false, needAdminPassword: true, message: '修改「存储地址（容器内路径）」需要验证管理员密码' };
                }
            }
        }
        const encrypted = {};
        for (const [k, v] of Object.entries((0, channel_domain_1.normalizeBucketDomain)(ch.type, merged))) {
            encrypted[k] = SECRET_FIELDS[ch.type]?.includes(k) ? crypto_service_1.CryptoService.encrypt(v) : v;
        }
        await prisma_1.prisma.channel.update({
            where: { id },
            data: {
                name: body.name !== undefined ? String(body.name).trim() : ch.name,
                enabled: body.enabled ?? ch.enabled,
                isMain: body.isMain ?? ch.isMain,
                isBackup: body.isBackup ?? ch.isBackup,
                config: JSON.stringify(encrypted),
            },
        });
        await this.enforceUniqueFlags(id, body.isMain, body.isBackup);
        return { success: true };
    }
    async test(body) {
        let type = body.type || '';
        let cfg = {};
        if (body.id) {
            const ch = await prisma_1.prisma.channel.findUnique({ where: { id: body.id } });
            if (!ch)
                return { success: false, message: '渠道不存在' };
            type = ch.type;
            cfg = this.svc.decryptConfig(ch.type, ch.config);
            for (const [k, v] of Object.entries(body.config || {})) {
                if (String(v).includes('****'))
                    continue;
                cfg[k] = v;
            }
        }
        else {
            cfg = body.config || {};
        }
        if (!exports.CHANNEL_TYPES.includes(type)) {
            return { success: false, message: `不支持的渠道类型: ${type || '(空)'}` };
        }
        if (type === 'localfiles') {
            return { success: false, message: '本地文件渠道只用于浏览本地目录，不支持上传测试' };
        }
        cfg = (0, channel_domain_1.normalizeBucketDomain)(type, cfg);
        const info = { id: body.id || 'channel-test', name: '连接测试', type, config: cfg, metas: {} };
        const key = `GoHub-test-${Date.now()}.png`;
        const png = await makeTestPng();
        const started = Date.now();
        try {
            const adapter = (0, adapter_factory_1.createAdapter)(info);
            const res = await adapter.upload({ buffer: png, mime: 'image/png', originalName: 'test.png' }, key, info);
            const url = adapter.buildDirectUrl({ remoteKey: res.remoteKey, remoteUrl: res.remoteUrl || '', metas: {} }, info);
            let cleaned = true;
            try {
                await adapter.delete({ remoteKey: res.remoteKey, remoteUrl: res.remoteUrl || '', metas: {} }, info);
            }
            catch {
                cleaned = false;
            }
            return {
                success: true,
                data: { url, key: res.remoteKey, cleaned, elapsedMs: Date.now() - started },
                message: cleaned ? '上传成功，测试文件已清理' : '上传成功（该渠道未配置删除接口，测试文件可能残留）',
            };
        }
        catch (err) {
            return { success: false, message: err.message, data: { elapsedMs: Date.now() - started } };
        }
    }
    async setPool(id, body) {
        const ch = await prisma_1.prisma.channel.findUnique({ where: { id } });
        if (!ch)
            return { success: false, message: '渠道不存在' };
        const enabled = body.enabled !== false;
        await prisma_1.prisma.channel.update({ where: { id }, data: { backupPool: enabled } });
        const count = await prisma_1.prisma.channel.count({ where: { backupPool: true } });
        return { success: true, data: { backupPool: enabled, count } };
    }
    async getAuthorize(id) {
        const ch = await prisma_1.prisma.channel.findUnique({ where: { id } });
        if (!ch)
            return { success: false, message: '渠道不存在' };
        const users = await prisma_1.prisma.user.findMany({
            orderBy: { createdAt: 'asc' },
            select: { username: true, nickname: true, role: true, avatar: true },
        });
        return {
            success: true,
            data: {
                authorizedUsers: (0, channel_access_1.parseAuthorizedUsers)(ch.authorizedUsers),
                users: users.map((u) => ({
                    username: u.username,
                    nickname: u.nickname || u.username,
                    role: u.role,
                    avatar: u.avatar || '',
                })),
            },
        };
    }
    async setAuthorize(id, body) {
        const ch = await prisma_1.prisma.channel.findUnique({ where: { id } });
        if (!ch)
            return { success: false, message: '渠道不存在' };
        if (ch.type === 'localfiles')
            return { success: false, message: '本地文件渠道不支持授权（仅管理员可用）' };
        const wanted = Array.isArray(body.usernames) ? body.usernames.map((x) => String(x || '').trim()).filter(Boolean) : [];
        const exists = await prisma_1.prisma.user.findMany({
            where: { username: { in: wanted } },
            select: { username: true },
        });
        const valid = exists.map((u) => u.username);
        await prisma_1.prisma.channel.update({ where: { id }, data: { authorizedUsers: JSON.stringify(valid) } });
        return { success: true, data: { authorizedUsers: valid } };
    }
    async remove(id) {
        const target = await prisma_1.prisma.channel.findUnique({ where: { id } });
        if (target && target.code === exports.LOCAL_CHANNEL_CODE) {
            return { success: false, message: '内置本地存储是系统渠道，不能删除（可以禁用以停用）' };
        }
        if (target && target.code === exports.LOCAL_FILES_CHANNEL_CODE) {
            return { success: false, message: '内置本地文件浏览渠道是系统渠道，不能删除' };
        }
        const copies = await prisma_1.prisma.fileCopy.count({ where: { channelId: id } });
        if (copies > 0) {
            const [trash, registered] = await Promise.all([
                prisma_1.prisma.fileCopy.count({ where: { channelId: id, file: { status: 'deleted' } } }),
                prisma_1.prisma.fileCopy.count({ where: { channelId: id, file: { uploadSource: 'Record' } } }),
            ]);
            const detail = [
                `${copies} 个文件副本`,
                trash ? `其中回收站 ${trash} 个` : '',
                registered ? `登记文件 ${registered} 个` : '',
            ].filter(Boolean).join('，');
            return { success: false, message: `该渠道仍有 ${detail}，请先删除这些文件（含回收站与登记文件）后再删除渠道` };
        }
        await prisma_1.prisma.channel.delete({ where: { id } });
        return { success: true };
    }
};
exports.ChannelManageController = ChannelManageController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('mounts'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "mounts", null);
__decorate([
    (0, common_1.Get)(':id/plain'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "plain", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "create", null);
__decorate([
    (0, common_1.Put)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "update", null);
__decorate([
    (0, common_1.Post)('test'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "test", null);
__decorate([
    (0, common_1.Post)(':id/pool'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "setPool", null);
__decorate([
    (0, common_1.Get)(':id/authorize'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "getAuthorize", null);
__decorate([
    (0, common_1.Post)(':id/authorize'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "setAuthorize", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ChannelManageController.prototype, "remove", null);
exports.ChannelManageController = ChannelManageController = __decorate([
    (0, common_1.Controller)('api/manage/channels'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:paramtypes", [ChannelsService])
], ChannelManageController);
let ChannelAllowedController = class ChannelAllowedController {
    async allowed(req, username) {
        const session = (0, auth_guard_1.currentSession)(req);
        const admin = (0, auth_guard_1.isAdminRole)(session?.role);
        const target = String(username || session?.user || '').trim();
        if (!admin && target && target !== session?.user) {
            return { success: false, message: '只能查看自己的渠道' };
        }
        const channels = await prisma_1.prisma.channel.findMany({
            where: { enabled: true },
            orderBy: exports.CHANNEL_ORDER_BY,
        });
        const list = channels
            .filter((c) => (admin && !target ? true : (0, channel_access_1.channelVisibleTo)(c.authorizedUsers, c.type, target, admin)))
            .map((c) => ({
            id: c.id,
            code: c.code,
            name: c.name,
            type: c.type,
            typeCode: c.typeCode,
            isMain: c.isMain,
            isBackup: c.isBackup,
            backupPool: c.backupPool,
        }));
        app_log_1.appLog.info('channel', `渠道下拉（allowed/list）：${session?.user || '-'}${target && target !== session?.user ? ` → ${target}` : ''}，共 ${list.length} 个`);
        return { success: true, data: list };
    }
};
exports.ChannelAllowedController = ChannelAllowedController;
__decorate([
    (0, common_1.Get)('allowed/list'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('username')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ChannelAllowedController.prototype, "allowed", null);
exports.ChannelAllowedController = ChannelAllowedController = __decorate([
    (0, common_1.Controller)('api/manage/channels'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard)
], ChannelAllowedController);
