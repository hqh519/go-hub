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
exports.WebDavSelfController = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const auth_guard_1 = require("../auth/auth.guard");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const webdav_storage_1 = require("./webdav.storage");
const channel_service_1 = require("./channel-service");
let WebDavSelfController = class WebDavSelfController {
    sysConfig;
    constructor(sysConfig) {
        this.sysConfig = sysConfig;
    }
    me(req) {
        const s = (0, auth_guard_1.currentSession)(req);
        if (!s?.user)
            throw new common_1.UnauthorizedException('未登录');
        return { user: s.user, role: String(s.role || '') };
    }
    async globalOn() {
        try {
            const cfg = await this.sysConfig.get('others');
            const w = cfg?.webdav || {};
            return w.enabled === true || String(w.enabled) === 'true';
        }
        catch {
            return false;
        }
    }
    async ownChannel(channelId, username) {
        const ch = await prisma_1.prisma.webDavChannel.findUnique({ where: { id: channelId } });
        if (!ch || ch.username !== username)
            return null;
        return ch;
    }
    async overview(req) {
        const { user, role } = this.me(req);
        const globalEnabled = await this.globalOn();
        const account = await prisma_1.prisma.user.findUnique({ where: { username: user } });
        if (!account) {
            if ((0, auth_guard_1.isAdminRole)(role)) {
                return {
                    success: true,
                    data: {
                        globalEnabled,
                        enabled: false,
                        max: 0,
                        adminBlocked: true,
                        root: (0, webdav_storage_1.webdavRoot)(),
                        channels: [],
                    },
                };
            }
            throw new common_1.UnauthorizedException('账户不存在');
        }
        const adminBlocked = (0, auth_guard_1.isAdminRole)(account.role);
        const channels = adminBlocked ? [] : await (0, channel_service_1.listChannelsOf)(account.username);
        return {
            success: true,
            data: {
                globalEnabled,
                enabled: !!account.webdavEnabled,
                max: Number(account.webdavMax) || 2,
                adminBlocked,
                root: (0, webdav_storage_1.webdavRoot)(),
                channels: channels.map((c) => ({
                    id: c.id,
                    name: c.name,
                    path: c.path,
                    accessKey: c.accessKey,
                    note: c.note,
                    createdAt: c.createdAt,
                    mountPath: '/dav',
                })),
            },
        };
    }
    async create(req, body) {
        const { user } = this.me(req);
        if (!(await this.globalOn())) {
            return { success: false, message: '对外 WebDAV 已停用（系统管理 → 安全设置）' };
        }
        const account = await prisma_1.prisma.user.findUnique({ where: { username: user } });
        if (!account) {
            return { success: false, message: '管理员账户禁止使用 WebDAV，请用普通账户创建' };
        }
        return (0, channel_service_1.createChannel)({
            username: account.username,
            role: account.role,
            webdavEnabled: account.webdavEnabled,
            webdavMax: account.webdavMax,
        }, body);
    }
    async update(req, channelId, body) {
        const { user } = this.me(req);
        const ch = await this.ownChannel(channelId, user);
        if (!ch)
            return { success: false, message: 'WebDAV 渠道不存在' };
        return (0, channel_service_1.updateChannel)(ch.id, body);
    }
    async rotateKey(req, channelId) {
        const { user } = this.me(req);
        const ch = await this.ownChannel(channelId, user);
        if (!ch)
            return { success: false, message: 'WebDAV 渠道不存在' };
        return (0, channel_service_1.rotateChannelKey)(ch.id);
    }
    async remove(req, channelId) {
        const { user } = this.me(req);
        const ch = await this.ownChannel(channelId, user);
        if (!ch)
            return { success: false, message: 'WebDAV 渠道不存在' };
        return (0, channel_service_1.deleteChannel)(ch.id);
    }
};
exports.WebDavSelfController = WebDavSelfController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WebDavSelfController.prototype, "overview", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], WebDavSelfController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':channelId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('channelId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], WebDavSelfController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(':channelId/key'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('channelId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], WebDavSelfController.prototype, "rotateKey", null);
__decorate([
    (0, common_1.Delete)(':channelId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('channelId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], WebDavSelfController.prototype, "remove", null);
exports.WebDavSelfController = WebDavSelfController = __decorate([
    (0, common_1.Controller)('api/webdav-self'),
    __metadata("design:paramtypes", [sysconfig_service_1.SysConfigService])
], WebDavSelfController);
