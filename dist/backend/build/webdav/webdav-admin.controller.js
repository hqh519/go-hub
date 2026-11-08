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
exports.WebDavAdminController = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const auth_guard_1 = require("../auth/auth.guard");
const webdav_storage_1 = require("./webdav.storage");
const channel_service_1 = require("./channel-service");
let WebDavAdminController = class WebDavAdminController {
    async list(id) {
        const user = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!user)
            return { success: false, message: '账户不存在' };
        const list = await (0, channel_service_1.listChannelsOf)(user.username);
        return {
            success: true,
            data: {
                enabled: user.webdavEnabled,
                max: user.webdavMax,
                root: (0, webdav_storage_1.webdavRoot)(),
                adminBlocked: user.role !== 'user',
                channels: list.map((c) => ({
                    id: c.id,
                    name: c.name,
                    path: c.path,
                    accessKey: c.accessKey,
                    note: c.note,
                    createdAt: c.createdAt,
                    mountPath: `/dav`,
                })),
            },
        };
    }
    async create(id, body) {
        const user = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!user)
            return { success: false, message: '账户不存在' };
        return (0, channel_service_1.createChannel)({
            username: user.username,
            role: user.role,
            webdavEnabled: user.webdavEnabled,
            webdavMax: user.webdavMax,
        }, body);
    }
    async update(channelId, body) {
        return (0, channel_service_1.updateChannel)(channelId, body);
    }
    async rotateKey(channelId) {
        return (0, channel_service_1.rotateChannelKey)(channelId);
    }
    async remove(channelId) {
        return (0, channel_service_1.deleteChannel)(channelId);
    }
};
exports.WebDavAdminController = WebDavAdminController;
__decorate([
    (0, common_1.Get)('users/:id/webdav'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], WebDavAdminController.prototype, "list", null);
__decorate([
    (0, common_1.Post)('users/:id/webdav'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], WebDavAdminController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)('webdav/:channelId'),
    __param(0, (0, common_1.Param)('channelId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], WebDavAdminController.prototype, "update", null);
__decorate([
    (0, common_1.Post)('webdav/:channelId/key'),
    __param(0, (0, common_1.Param)('channelId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], WebDavAdminController.prototype, "rotateKey", null);
__decorate([
    (0, common_1.Delete)('webdav/:channelId'),
    __param(0, (0, common_1.Param)('channelId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], WebDavAdminController.prototype, "remove", null);
exports.WebDavAdminController = WebDavAdminController = __decorate([
    (0, common_1.Controller)('api/manage'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard)
], WebDavAdminController);
