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
var ManageCompatController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManageCompatController = exports.PublicCompatController = void 0;
const request_origin_1 = require("../common/request-origin");
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const prisma_1 = require("../common/prisma");
const tags_1 = require("../common/tags");
const crypto_service_1 = require("../common/crypto.service");
const auth_guard_1 = require("../auth/auth.guard");
const settings_service_1 = require("../settings/settings.service");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const file_view_1 = require("../common/file-view");
const app_log_1 = require("../common/app-log");
const ip_query_1 = require("../common/ip-query");
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
function parseIpList(raw) {
    if (!raw)
        return [];
    try {
        const v = JSON.parse(raw);
        if (Array.isArray(v))
            return v.map(String).filter(Boolean);
    }
    catch {
    }
    return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}
function parseStrArray(raw) {
    if (!raw)
        return [];
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v.map(String) : [];
    }
    catch {
        return [];
    }
}
function tagOwnerScope(req) {
    const me = (0, auth_guard_1.currentSession)(req)?.user || '';
    return me ? { type: tags_1.TAG_TYPE_FILE } : { id: { in: [] } };
}
let PublicCompatController = class PublicCompatController {
    bingWallpaper() {
        return { data: [] };
    }
};
exports.PublicCompatController = PublicCompatController;
__decorate([
    (0, common_1.Get)('bing/wallpaper'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PublicCompatController.prototype, "bingWallpaper", null);
exports.PublicCompatController = PublicCompatController = __decorate([
    (0, common_1.Controller)('api')
], PublicCompatController);
let ManageCompatController = class ManageCompatController {
    static { ManageCompatController_1 = this; }
    settings;
    sysConfig;
    constructor(settings, sysConfig) {
        this.settings = settings;
        this.sysConfig = sysConfig;
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
    async listTokens(req) {
        const rows = await prisma_1.prisma.apiToken.findMany({ orderBy: { createdAt: 'desc' } });
        const origin = (0, request_origin_1.signOrigin)(req);
        return {
            tokens: rows.map((t) => {
                const metas = JSON.parse(t.metas || '{}');
                const type = t.type || metas.type || 'web';
                let plain = '';
                if (type === 's3') {
                    plain = '';
                }
                else if (metas.tokenEnc) {
                    try {
                        plain = crypto_service_1.CryptoService.decrypt(metas.tokenEnc);
                    }
                    catch {
                        plain = '';
                    }
                }
                let secretKey = '';
                if (type === 's3' && metas.secretKeyEnc) {
                    try {
                        secretKey = crypto_service_1.CryptoService.decrypt(metas.secretKeyEnc);
                    }
                    catch {
                        secretKey = '';
                    }
                }
                return {
                    id: t.id,
                    name: t.name,
                    type,
                    token: type === 'web' ? plain || `${t.prefix}••••••••••••` : '',
                    prefix: t.prefix,
                    owner: metas.owner || 'admin',
                    permissions: parseStrArray(t.permissions),
                    enabled: t.enabled,
                    enforceLimits: t.enforceLimits !== false,
                    createdAt: t.createdAt,
                    lastUsedAt: t.lastUsedAt,
                    expiresAt: metas.expiresAt || null,
                    autoDelete: !!metas.autoDelete,
                    endpoint: type === 's3' ? `${origin}/s3` : '',
                    accessKey: metas.accessKey || '',
                    secretKey,
                    region: metas.region || '',
                    defaultBucket: metas.defaultBucket || '',
                    defaultBackup: metas.defaultBackup || '',
                    defaultCategory: metas.defaultCategory || '',
                };
            }),
        };
    }
    async createToken(req, body) {
        const type = body.type === 's3' ? 's3' : 'web';
        const accessKey = type === 's3' ? `gbk${(0, crypto_1.randomBytes)(10).toString('hex')}` : '';
        const secretKey = type === 's3' ? (0, crypto_1.randomBytes)(20).toString('hex') : '';
        const raw = type === 'web' ? `gb_${(0, crypto_1.randomBytes)(24).toString('hex')}` : `s3_${(0, crypto_1.randomBytes)(24).toString('hex')}`;
        const tokenHash = (0, crypto_1.createHash)('sha256').update(type === 's3' ? `${accessKey}:${secretKey}` : raw).digest('hex');
        const created = await prisma_1.prisma.apiToken.create({
            data: {
                name: body.name || 'token',
                type,
                tokenHash,
                prefix: type === 'web' ? `gb_${raw.slice(3, 11)}` : accessKey.slice(0, 11),
                permissions: JSON.stringify(body.permissions || []),
                enforceLimits: body.enforceLimits !== false,
                metas: JSON.stringify({
                    type,
                    owner: (() => {
                        const o = String(body.owner || '').trim();
                        return o && o !== 'admin' ? o : undefined;
                    })() || (await this.adminUsername()),
                    expiresAt: body.expiresAt || null,
                    autoDelete: !!body.autoDelete,
                    defaultBucket: String(body.defaultBucket || '').trim(),
                    defaultBackup: String(body.defaultBackup || '').trim(),
                    defaultCategory: String(body.defaultCategory || '').trim(),
                    ...(type === 's3'
                        ? {
                            accessKey,
                            secretKeyEnc: crypto_service_1.CryptoService.encrypt(secretKey),
                            region: 'us-east-1',
                        }
                        : { tokenEnc: crypto_service_1.CryptoService.encrypt(raw) }),
                }),
            },
        });
        const origin = (0, request_origin_1.signOrigin)(req);
        return {
            success: true,
            token: raw,
            data: {
                id: created.id,
                name: created.name,
                type,
                token: type === 'web' ? raw : '',
                endpoint: type === 's3' ? `${origin}/s3` : '',
                accessKey,
                secretKey,
                region: type === 's3' ? 'us-east-1' : '',
                permissions: parseStrArray(created.permissions),
                enforceLimits: created.enforceLimits !== false,
                createdAt: created.createdAt,
                expiresAt: body.expiresAt || null,
            },
        };
    }
    async updateToken(body) {
        if (!body.tokenId)
            return { success: false, error: '缺少 tokenId' };
        const cur = await prisma_1.prisma.apiToken.findUnique({ where: { id: body.tokenId } });
        if (!cur)
            return { success: false, error: 'Token 不存在' };
        const metas = JSON.parse(cur.metas || '{}');
        metas.expiresAt = body.expiresAt ?? metas.expiresAt ?? null;
        metas.autoDelete = body.autoDelete ?? metas.autoDelete ?? false;
        if (body.defaultBucket !== undefined)
            metas.defaultBucket = String(body.defaultBucket || '').trim();
        if (body.defaultBackup !== undefined)
            metas.defaultBackup = String(body.defaultBackup || '').trim();
        if (body.defaultCategory !== undefined)
            metas.defaultCategory = String(body.defaultCategory || '').trim();
        metas.region = 'us-east-1';
        await prisma_1.prisma.apiToken.update({
            where: { id: body.tokenId },
            data: {
                name: body.name ? String(body.name) : cur.name,
                permissions: body.permissions ? JSON.stringify(body.permissions) : cur.permissions,
                enabled: body.enabled ?? cur.enabled,
                enforceLimits: body.enforceLimits === undefined ? cur.enforceLimits : !!body.enforceLimits,
                metas: JSON.stringify(metas),
            },
        });
        return { success: true };
    }
    async deleteToken(id) {
        if (!id)
            return { success: false, error: '缺少 id' };
        await prisma_1.prisma.apiToken.delete({ where: { id } }).catch(() => null);
        return { success: true };
    }
    async getQuota() {
        return { success: true, quotaStats: await this.channelStats() };
    }
    async refreshQuota() {
        return { success: true, channelStats: await this.channelStats() };
    }
    async channelStats() {
        const channels = await prisma_1.prisma.channel.findMany();
        const copies = await prisma_1.prisma.fileCopy.findMany({
            where: { status: 'active' },
            include: { file: { select: { size: true } } },
        });
        const out = {};
        for (const c of channels) {
            const mine = copies.filter((x) => x.channelId === c.id);
            const bytes = mine.reduce((a, b) => a + (b.file?.size || 0), 0);
            out[c.name] = { usedMB: Math.round((bytes / 1024 / 1024) * 100) / 100, fileCount: mine.length, limitMB: 0 };
        }
        return out;
    }
    async tagAutocomplete(req, q) {
        const limit = Math.min(50, Math.max(1, Number(q.limit || 10)));
        const prefix = (q.prefix || '').trim();
        const rows = await prisma_1.prisma.tag.findMany({
            where: {
                instanceId: String(q.instanceId ?? ''),
                ...tagOwnerScope(req),
                ...(prefix ? { name: { startsWith: prefix } } : {}),
            },
            orderBy: { name: 'asc' },
            take: limit,
        });
        return { tags: rows.map((t) => t.name) };
    }
    async tagsAll(req, q) {
        const rows = await prisma_1.prisma.tag.findMany({
            where: { instanceId: String(q.instanceId ?? ''), ...tagOwnerScope(req) },
            include: { _count: { select: { files: true } } },
            orderBy: { name: 'asc' },
        });
        return {
            tags: rows.map((t) => ({ name: t.name, count: t._count?.files || 0, createdAt: t.createdAt })),
        };
    }
    async tagsApply(req, body) {
        const ids = body.fileIds || [];
        const me = (0, auth_guard_1.currentSession)(req)?.user || '';
        for (const id of ids)
            await this.applyTags(id, body.tags || [], body.action || 'add', me);
        return { success: true, count: ids.length };
    }
    async tagsBatch(req, body) {
        const ids = Array.isArray(body.fileIds) ? body.fileIds : [];
        const me = (0, auth_guard_1.currentSession)(req)?.user || '';
        const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [];
        const raw = String(body.action || 'add').toLowerCase();
        const action = raw === 'remove' || raw === 'set' ? raw : 'add';
        const results = [];
        for (const id of ids) {
            const rec = await this.findFile(id);
            if (!rec) {
                results.push({ fileId: String(id), saved: false, tags: [], indexPending: false, error: '文件不存在' });
                continue;
            }
            let savedTags = [];
            if (action === 'set') {
                await prisma_1.prisma.fileTag.deleteMany({ where: { fileId: rec.id } });
                savedTags = tags.length ? await this.applyTags(id, tags, 'add', me) : [];
            }
            else {
                savedTags = await this.applyTags(id, tags, action, me);
            }
            results.push({ fileId: String(id), saved: true, tags: savedTags, indexPending: false });
        }
        const updated = results.filter((r) => r.saved).length;
        return {
            success: ids.length > 0 && updated === ids.length,
            updated,
            count: ids.length,
            results,
        };
    }
    async getTags(req) {
        const rec = await this.findFile(wildcardParam(req));
        if (!rec)
            return { tags: [] };
        const rows = await prisma_1.prisma.fileTag.findMany({ where: { fileId: rec.id }, include: { tag: true } });
        return { tags: rows.map((r) => r.tag.name) };
    }
    async updateTags(req, body) {
        const key = wildcardParam(req);
        const rec = await this.findFile(key);
        if (!rec)
            return { success: false, error: '文件不存在', tags: [] };
        const tags = await this.applyTags(key, body.tags || [], body.action || 'add', (0, auth_guard_1.currentSession)(req)?.user || '');
        return { success: true, tags, indexPending: false };
    }
    async findFile(key) {
        const k = String(key || '');
        const bare = k.replace(/\.[^.]*$/, '');
        return prisma_1.prisma.fileRecord.findFirst({ where: { OR: [{ id: k }, { name: k }, { name: bare }] } });
    }
    async applyTags(fileKey, tags, action, owner = '') {
        const rec = await this.findFile(fileKey);
        if (!rec)
            return [];
        const instanceId = String(rec.instanceId || '');
        const tagOwner = String(owner || rec.uploader || '');
        for (const raw of tags) {
            const name = String(raw).trim();
            if (!name)
                continue;
            const tag = await (0, tags_1.findOrCreateTag)(name, instanceId, tagOwner, tags_1.TAG_TYPE_FILE);
            if (action === 'remove') {
                await prisma_1.prisma.fileTag.deleteMany({ where: { fileId: rec.id, tagId: tag.id } });
            }
            else {
                await prisma_1.prisma.fileTag.upsert({
                    where: { fileId_tagId: { fileId: rec.id, tagId: tag.id } },
                    update: {},
                    create: { fileId: rec.id, tagId: tag.id },
                });
            }
        }
        const rows = await prisma_1.prisma.fileTag.findMany({ where: { fileId: rec.id }, include: { tag: true } });
        return rows.map((r) => r.tag.name);
    }
    async move(req, q) {
        const key = wildcardParam(req);
        const dist = (q.dist || '').replace(/^\/+|\/+$/g, '');
        if (q.folder === 'true') {
            const oldPrefix = key.replace(/\/+$/, '');
            const rows = await prisma_1.prisma.fileRecord.findMany({
                where: { OR: [{ folder: oldPrefix }, { folder: { startsWith: `${oldPrefix}/` } }] },
            });
            for (const r of rows) {
                const suffix = r.folder.slice(oldPrefix.length).replace(/^\/+/, '');
                await prisma_1.prisma.fileRecord.update({
                    where: { id: r.id },
                    data: { folder: suffix ? `${dist}/${suffix}` : dist },
                });
            }
            return { success: true, moved: rows.length };
        }
        const rec = await this.findFile(key);
        if (!rec)
            return { success: false, error: '文件不存在' };
        await prisma_1.prisma.fileRecord.update({ where: { id: rec.id }, data: { folder: dist } });
        return { success: true };
    }
    async cusList(q) {
        const start = Math.max(0, Number(q.start || 0));
        const count = Math.min(500, Math.max(1, Number(q.count || 20)));
        const grouped = await prisma_1.prisma.fileRecord.groupBy({
            by: ['ip'],
            where: { status: 'active' },
            _count: { _all: true },
            _max: { createdAt: true },
            orderBy: { _max: { createdAt: 'desc' } },
        });
        const ips = grouped.map((g) => g.ip).filter(Boolean);
        const records = await prisma_1.prisma.ipRecord.findMany({ where: { ip: { in: ips } } });
        const addrOf = new Map(records.map((r) => [r.ip, [r.country, r.region, r.city].filter(Boolean).join(' ')]));
        let displayOf = new Map();
        try {
            displayOf = await (0, ip_query_1.ipDisplayBatch)(ips, addrOf, this.sysConfig);
        }
        catch {
        }
        return grouped
            .filter((g) => g.ip)
            .slice(start, start + count)
            .map((g) => ({
            ip: g.ip,
            address: addrOf.get(g.ip) || '',
            display: displayOf.get(g.ip) || '',
            count: g._count._all,
        }));
    }
    async cusFiles(q) {
        const ip = q.ip || '';
        const uploader = q.uploader || '';
        if (!ip && !uploader)
            return { data: [] };
        const count = Math.min(2000, Math.max(1, Number(q.count || 100)));
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: { status: 'active', ...(ip ? { ip } : { uploader }) },
            orderBy: { createdAt: 'desc' },
            take: count,
            include: { copies: { include: { channel: true } }, tags: { include: { tag: true } } },
        });
        return { data: rows.map((r) => (0, file_view_1.serializeFile)(r, r.copies, { tags: r.tags.map((t) => t.tag.name) })) };
    }
    async cusWhite(body) {
        const ip = this.readIp(body);
        if (!ip)
            return { success: false };
        const list = parseIpList(await this.settings.get('whiteIpList', '[]'));
        const block = parseIpList(await this.settings.get('blockIpList', '[]')).filter((x) => x !== ip);
        await this.settings.set('whiteIpList', JSON.stringify(Array.from(new Set([...list, ip]))));
        await this.settings.set('blockIpList', JSON.stringify(block));
        await prisma_1.prisma.ipRecord.upsert({
            where: { ip },
            update: { whitelisted: true, blocked: false },
            create: { ip, whitelisted: true },
        });
        return { success: true };
    }
    async cusBlock(body) {
        const ip = this.readIp(body);
        if (!ip)
            return { success: false };
        const list = parseIpList(await this.settings.get('blockIpList', '[]'));
        const white = parseIpList(await this.settings.get('whiteIpList', '[]')).filter((x) => x !== ip);
        await this.settings.set('blockIpList', JSON.stringify(Array.from(new Set([...list, ip]))));
        await this.settings.set('whiteIpList', JSON.stringify(white));
        await prisma_1.prisma.ipRecord.upsert({
            where: { ip },
            update: { blocked: true, whitelisted: false },
            create: { ip, blocked: true },
        });
        return { success: true };
    }
    async cusBlockList() {
        return parseIpList(await this.settings.get('blockIpList', '[]')).join(',');
    }
    readIp(body) {
        if (typeof body === 'string')
            return body.trim();
        if (body && typeof body === 'object' && body.ip)
            return String(body.ip).trim();
        return '';
    }
    static CONFIG_SECTIONS = ['page', 'upload', 'others', 'security', 'ai'];
    async batchSettings() {
        const settings = {};
        for (const section of ManageCompatController_1.CONFIG_SECTIONS) {
            try {
                settings[section] =
                    section === 'security' ? await this.sysConfig.readSecurityRaw() : await this.sysConfig.get(section);
            }
            catch (err) {
                app_log_1.appLog.warn('config', `配置备份：读取分区 ${section} 失败`, err.message);
            }
        }
        app_log_1.appLog.info('config', '导出配置备份', `分区：${Object.keys(settings).join(' / ') || '无'}`);
        return { settings };
    }
    async indexConfig() {
        return { success: true, chunkSize: 500, databaseType: 'sqlite' };
    }
    async indexChunk() {
        return { success: true };
    }
    async indexFinalize() {
        const started = Date.now();
        try {
            await prisma_1.prisma.$executeRawUnsafe('REINDEX');
            await prisma_1.prisma.$executeRawUnsafe('ANALYZE');
            await prisma_1.prisma.$executeRawUnsafe('VACUUM');
            const [files, copies] = await Promise.all([
                prisma_1.prisma.fileRecord.count(),
                prisma_1.prisma.fileCopy.count(),
            ]);
            return {
                success: true,
                message: `索引已重建并整理完成（${files} 个文件 / ${copies} 个副本，耗时 ${Date.now() - started}ms）`,
                data: { files, copies, elapsedMs: Date.now() - started },
            };
        }
        catch (err) {
            return { success: false, message: `索引维护失败: ${err.message}` };
        }
    }
    async restoreChunk(body) {
        const type = String(body?.type || '');
        const data = (body?.data || {});
        if (type !== 'settings')
            return { success: true, restoredCount: 0, failedCount: 0 };
        const allowed = ManageCompatController_1.CONFIG_SECTIONS;
        let restoredCount = 0;
        let failedCount = 0;
        for (const [section, value] of Object.entries(data)) {
            if (!allowed.includes(section) || !value || typeof value !== 'object') {
                failedCount += 1;
                continue;
            }
            try {
                if (section === 'security')
                    await this.sysConfig.writeSecurityRaw(value);
                else
                    await this.sysConfig.save(section, value);
                restoredCount += 1;
            }
            catch (err) {
                failedCount += 1;
                app_log_1.appLog.error('config', `恢复配置失败：${section}`, err.message);
            }
        }
        app_log_1.appLog.warn('config', `恢复配置：成功 ${restoredCount} 项，失败 ${failedCount} 项`);
        return { success: restoredCount > 0 || failedCount === 0, restoredCount, failedCount };
    }
    async batchList(q) {
        const limit = Math.min(1000, Math.max(1, Number(q.limit || 500)));
        const start = Math.max(0, Number(q.cursor || 0) || 0);
        const total = await prisma_1.prisma.fileRecord.count({ where: { status: 'active' } });
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: { status: 'active' },
            orderBy: { createdAt: 'asc' },
            skip: start,
            take: limit,
            include: { copies: { include: { channel: true } } },
        });
        const next = start + rows.length < total ? String(start + rows.length) : '';
        return {
            success: true,
            keys: rows.map((r) => ({ name: r.name, metadata: (0, file_view_1.serializeFile)(r, r.copies).metadata })),
            cursor: next,
            total,
        };
    }
    aiTagsGet() {
        return { success: false, error: 'AI 功能未启用', tags: [] };
    }
    aiTagsPost() {
        return { success: false, error: 'AI 功能未启用', tags: [] };
    }
    aiTest() {
        return { success: false, error: 'AI 功能未启用' };
    }
};
exports.ManageCompatController = ManageCompatController;
__decorate([
    (0, common_1.Get)('apiTokens'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "listTokens", null);
__decorate([
    (0, common_1.Post)('apiTokens'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "createToken", null);
__decorate([
    (0, common_1.Put)('apiTokens'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "updateToken", null);
__decorate([
    (0, common_1.Delete)('apiTokens'),
    __param(0, (0, common_1.Query)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "deleteToken", null);
__decorate([
    (0, common_1.Get)('quota'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "getQuota", null);
__decorate([
    (0, common_1.Post)('quota'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "refreshQuota", null);
__decorate([
    (0, common_1.Get)('tags/autocomplete'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "tagAutocomplete", null);
__decorate([
    (0, common_1.Get)('tags/all'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "tagsAll", null);
__decorate([
    (0, common_1.Post)('tags/apply'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "tagsApply", null);
__decorate([
    (0, common_1.Post)('tags/batch'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "tagsBatch", null);
__decorate([
    (0, common_1.Get)('tags/*'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "getTags", null);
__decorate([
    (0, common_1.Post)('tags/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "updateTags", null);
__decorate([
    (0, common_1.Get)('move/*'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "move", null);
__decorate([
    (0, common_1.Get)('cusConfig/list'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "cusList", null);
__decorate([
    (0, common_1.Get)('cusConfig/files'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "cusFiles", null);
__decorate([
    (0, common_1.Post)('cusConfig/whiteip'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "cusWhite", null);
__decorate([
    (0, common_1.Post)('cusConfig/blockip'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "cusBlock", null);
__decorate([
    (0, common_1.Get)('cusConfig/blockipList'),
    (0, common_1.Header)('Content-Type', 'text/plain; charset=utf-8'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "cusBlockList", null);
__decorate([
    (0, common_1.Get)('batch/settings'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "batchSettings", null);
__decorate([
    (0, common_1.Get)('batch/index/config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "indexConfig", null);
__decorate([
    (0, common_1.Post)('batch/index/chunk'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "indexChunk", null);
__decorate([
    (0, common_1.Post)('batch/index/finalize'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "indexFinalize", null);
__decorate([
    (0, common_1.Post)('batch/restore/chunk'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "restoreChunk", null);
__decorate([
    (0, common_1.Get)('batch/list'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ManageCompatController.prototype, "batchList", null);
__decorate([
    (0, common_1.Get)('ai/tags'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ManageCompatController.prototype, "aiTagsGet", null);
__decorate([
    (0, common_1.Post)('ai/tags'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ManageCompatController.prototype, "aiTagsPost", null);
__decorate([
    (0, common_1.Post)('ai/test'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ManageCompatController.prototype, "aiTest", null);
exports.ManageCompatController = ManageCompatController = ManageCompatController_1 = __decorate([
    (0, common_1.Controller)('api/manage'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        sysconfig_service_1.SysConfigService])
], ManageCompatController);
