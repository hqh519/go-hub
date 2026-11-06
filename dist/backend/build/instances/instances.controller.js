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
exports.InstancesController = void 0;
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("../auth/auth.guard");
const instances_service_1 = require("./instances.service");
let InstancesController = class InstancesController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    me(req) {
        const self = (0, auth_guard_1.currentSession)(req)?.user || '';
        const as = String(req.query?.username || '').trim();
        if (as && (0, auth_guard_1.currentSession)(req)?.role === 'admin' && as !== self)
            return as;
        return self;
    }
    fail(res, error, status = 400) {
        return res.status(status).json({ error: error || '请求失败' });
    }
    async list(req, res) {
        const items = await this.svc.list(this.me(req));
        return res.json(items.map((it, i) => ({ ...it, index: i + 1 })));
    }
    async create(body, req, res) {
        const r = await this.svc.create(this.me(req), String(body?.name || ''), String(body?.note || ''));
        if (r.error)
            return this.fail(res, r.error);
        return res.json(r.item);
    }
    async patch(id, body, req, res) {
        const r = await this.svc.update(id, this.me(req), {
            name: body?.name === undefined ? undefined : String(body.name),
            note: body?.note === undefined ? undefined : String(body.note),
        });
        if (r.error)
            return this.fail(res, r.error);
        return res.json(r.item);
    }
    async remove(id, req, res) {
        const r = await this.svc.remove(id, this.me(req));
        if (r.error)
            return this.fail(res, r.error);
        return res.json({ success: true });
    }
    async getInvite(id, req, res) {
        const r = await this.svc.getInvite(id, this.me(req));
        if (r.error)
            return this.fail(res, r.error);
        return res.json({ inviteCode: r.inviteCode || '' });
    }
    async createInvite(id, req, res) {
        const r = await this.svc.createInvite(id, this.me(req));
        if (r.error)
            return this.fail(res, r.error);
        return res.json({ inviteCode: r.inviteCode });
    }
    async closeInvite(id, req, res) {
        const r = await this.svc.closeInvite(id, this.me(req));
        if (r.error)
            return this.fail(res, r.error);
        return res.json({ success: true });
    }
    async join(body, req, res) {
        const r = await this.svc.join(this.me(req), String(body?.username || ''), String(body?.code || ''));
        if (r.error)
            return this.fail(res, r.error);
        return res.json(r.item);
    }
    async members(id, req, res) {
        const r = await this.svc.members(id, this.me(req));
        if (r.error)
            return this.fail(res, r.error);
        return res.json(r.list);
    }
    async removeMember(id, username, req, res) {
        const r = await this.svc.removeMember(id, this.me(req), username);
        if (r.error)
            return this.fail(res, r.error);
        return res.json({ success: true });
    }
};
exports.InstancesController = InstancesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], InstancesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], InstancesController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], InstancesController.prototype, "patch", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], InstancesController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)(':id/invite'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], InstancesController.prototype, "getInvite", null);
__decorate([
    (0, common_1.Post)(':id/invite'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], InstancesController.prototype, "createInvite", null);
__decorate([
    (0, common_1.Delete)(':id/invite'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], InstancesController.prototype, "closeInvite", null);
__decorate([
    (0, common_1.Post)('join'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], InstancesController.prototype, "join", null);
__decorate([
    (0, common_1.Get)(':id/members'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], InstancesController.prototype, "members", null);
__decorate([
    (0, common_1.Delete)(':id/members/:username'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Param)('username')),
    __param(2, (0, common_1.Req)()),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], InstancesController.prototype, "removeMember", null);
exports.InstancesController = InstancesController = __decorate([
    (0, common_1.Controller)('api/instances'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __metadata("design:paramtypes", [instances_service_1.InstancesService])
], InstancesController);
