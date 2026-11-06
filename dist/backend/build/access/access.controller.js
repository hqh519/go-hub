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
exports.AccessAdminController = exports.AccessController = void 0;
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("../auth/auth.guard");
const access_service_1 = require("./access.service");
const app_log_1 = require("../common/app-log");
function clientIp(req) {
    const fwd = req.headers['x-forwarded-for']?.split(',')[0]?.trim();
    const ip = fwd || req.socket?.remoteAddress || '';
    return String(ip).replace(/^::ffff:/, '');
}
let AccessController = class AccessController {
    access;
    constructor(access) {
        this.access = access;
    }
    async visit(body, req) {
        const path = String(body.path || '').split('?')[0].slice(0, 500);
        if (!path || !path.startsWith('/'))
            return { success: true, data: { id: '' } };
        if (!(0, access_service_1.shouldRecordPath)(path))
            return { success: true, data: { id: '' } };
        const session = (0, auth_guard_1.currentSession)(req);
        const id = await this.access.record({
            ip: clientIp(req),
            path,
            title: body.title || '',
            referer: body.referer || req.headers.referer || '',
            username: session?.user || '',
            ua: String(req.headers['user-agent'] || ''),
            method: 'GET',
            status: 200,
            kind: 'page',
        });
        return { success: true, data: { id } };
    }
    async stay(body) {
        const ok = await this.access.stay(String(body.id || ''), Number(body.stayMs || 0));
        return { success: ok };
    }
};
exports.AccessController = AccessController;
__decorate([
    (0, common_1.Post)('visit'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AccessController.prototype, "visit", null);
__decorate([
    (0, common_1.Post)('stay'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AccessController.prototype, "stay", null);
exports.AccessController = AccessController = __decorate([
    (0, common_1.Controller)('api/access'),
    __metadata("design:paramtypes", [access_service_1.AccessService])
], AccessController);
let AccessAdminController = class AccessAdminController {
    access;
    constructor(access) {
        this.access = access;
    }
    async list(q) {
        const data = await this.access.list(q);
        return { success: true, data };
    }
    async summary() {
        return { success: true, data: await this.access.summary() };
    }
    async recent(take) {
        return { success: true, data: await this.access.recent(Number(take) || 20) };
    }
    async remove(body) {
        const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
        if (!ids.length)
            throw new common_1.BadRequestException('缺少 ids');
        const count = await this.access.remove(ids);
        app_log_1.appLog.warn('access', `删除访问记录 ${count} 条`, JSON.stringify(ids.slice(0, 20)));
        return { success: true, data: { deleted: count } };
    }
    async clearAll(_res) {
        const count = await this.access.clear();
        app_log_1.appLog.warn('access', `清空全部访问记录（${count} 条）`);
        return { success: true, data: { deleted: count } };
    }
};
exports.AccessAdminController = AccessAdminController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AccessAdminController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('summary'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AccessAdminController.prototype, "summary", null);
__decorate([
    (0, common_1.Get)('recent'),
    __param(0, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AccessAdminController.prototype, "recent", null);
__decorate([
    (0, common_1.Delete)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AccessAdminController.prototype, "remove", null);
__decorate([
    (0, common_1.Delete)('all'),
    __param(0, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AccessAdminController.prototype, "clearAll", null);
exports.AccessAdminController = AccessAdminController = __decorate([
    (0, common_1.Controller)('api/manage/access'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:paramtypes", [access_service_1.AccessService])
], AccessAdminController);
