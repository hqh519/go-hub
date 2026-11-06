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
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageChannelService = exports.NO_BACKUP_VALUES = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const channel_access_1 = require("../common/channel-access");
exports.NO_BACKUP_VALUES = ['none', '__none__', 'false', '0'];
let StorageChannelService = class StorageChannelService {
    sysConfig;
    constructor(sysConfig) {
        this.sysConfig = sysConfig;
    }
    async adminProfileChannel(uploader, kind) {
        try {
            const security = await this.sysConfig.get('security');
            const adminName = String(security?.auth?.admin?.adminUsername || '').trim() ||
                (process.env.ADMIN_USER || '').trim() ||
                'admin';
            if (!uploader || uploader !== adminName)
                return '';
            const prof = await this.sysConfig.get('adminProfile');
            return String((kind === 'backup' ? prof?.backupChannelId : prof?.mainChannelId) || '').trim();
        }
        catch {
            return '';
        }
    }
    async findRawById(key) {
        const k = String(key || '').trim();
        if (!k)
            return null;
        const c = (await prisma_1.prisma.channel.findUnique({ where: { code: k } })) ||
            (await prisma_1.prisma.channel.findUnique({ where: { id: k } })) ||
            null;
        if (!c)
            return null;
        return { id: c.id, code: c.code, name: c.name, type: c.type, enabled: c.enabled };
    }
    async findById(key) {
        const k = String(key || '').trim();
        if (!k)
            return null;
        const c = (await prisma_1.prisma.channel.findUnique({ where: { code: k } })) ||
            (await prisma_1.prisma.channel.findUnique({ where: { id: k } })) ||
            null;
        if (!c || !c.enabled)
            return null;
        return {
            id: c.id,
            code: c.code,
            name: c.name,
            type: c.type,
            config: c.config,
            authorizedUsers: c.authorizedUsers,
        };
    }
    async uploaderRole(uploader) {
        const name = String(uploader || '').trim();
        if (!name)
            return null;
        try {
            const u = await prisma_1.prisma.user.findUnique({ where: { username: name }, select: { role: true } });
            if (!u)
                return null;
            return u.role === 'admin' ? 'admin' : 'user';
        }
        catch {
            return null;
        }
    }
    async getStorageChannelCandidates(kind, q = {}) {
        const out = [];
        const seen = new Set();
        const role = await this.uploaderRole(q.uploader);
        const restrictToUser = role === 'user';
        const allow = (c) => {
            if (!c)
                return false;
            if (!restrictToUser)
                return true;
            return (0, channel_access_1.channelVisibleTo)(c.authorizedUsers, c.type, String(q.uploader || ''), false);
        };
        const push = (c) => {
            if (c && allow(c) && !seen.has(c.id)) {
                seen.add(c.id);
                out.push(c);
            }
        };
        if (q.explicitId)
            push(await this.findById(q.explicitId));
        if (q.tokenId) {
            try {
                const t = await prisma_1.prisma.apiToken.findUnique({ where: { id: q.tokenId } });
                const metas = JSON.parse(t?.metas || '{}');
                const raw = String((kind === 'backup' ? metas.defaultBackup : metas.defaultBucket) || '').trim();
                if (raw && !exports.NO_BACKUP_VALUES.includes(raw.toLowerCase()))
                    push(await this.findById(raw));
            }
            catch {
            }
        }
        if (q.uploader) {
            try {
                const u = await prisma_1.prisma.user.findUnique({ where: { username: q.uploader } });
                let pid = String((kind === 'backup' ? u?.backupChannelId : u?.mainChannelId) || '').trim();
                if (!u)
                    pid = await this.adminProfileChannel(q.uploader, kind);
                if (pid)
                    push(await this.findById(pid));
            }
            catch {
            }
        }
        const globals = await prisma_1.prisma.channel.findMany({
            where: kind === 'backup' ? { isBackup: true, enabled: true } : { isMain: true, enabled: true },
            orderBy: { sortOrder: 'asc' },
        });
        for (const g of globals)
            push({ id: g.id, code: g.code, name: g.name, type: g.type, config: g.config, authorizedUsers: g.authorizedUsers });
        if (out.length === 0 && q.channelType) {
            const byType = await prisma_1.prisma.channel.findMany({
                where: { type: q.channelType, enabled: true },
                orderBy: [{ isMain: 'desc' }, { sortOrder: 'asc' }],
            });
            for (const c of byType)
                push({ id: c.id, code: c.code, name: c.name, type: c.type, config: c.config, authorizedUsers: c.authorizedUsers });
        }
        return out;
    }
    async getStorageChannel(user, type, extra) {
        const kind = this.normalizeKind(type);
        const list = await this.getStorageChannelCandidates(kind, {
            ...(extra || {}),
            uploader: String(user || '').trim() || extra?.uploader || undefined,
        });
        return list[0] || null;
    }
    normalizeKind(type) {
        return String(type || '').trim().toLowerCase() === 'backup' ? 'backup' : 'main';
    }
    async getStorageChannelName(user, type, extra) {
        const c = await this.getStorageChannel(user, type, extra);
        return c ? `${c.code} · ${c.name}` : '';
    }
};
exports.StorageChannelService = StorageChannelService;
exports.StorageChannelService = StorageChannelService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [sysconfig_service_1.SysConfigService])
], StorageChannelService);
