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
exports.SharesController = void 0;
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("../auth/auth.guard");
const shares_service_1 = require("./shares.service");
let SharesController = class SharesController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    actor(req) {
        const session = (0, auth_guard_1.currentSession)(req);
        return { user: session?.user || '', isAdmin: (0, auth_guard_1.isAdminRole)(session?.role) };
    }
    cookieHash(req) {
        const raw = req.cookies?.[shares_service_1.SHARE_PW_COOKIE];
        if (typeof raw !== 'string' || !raw)
            return '';
        try {
            return decodeURIComponent(raw);
        }
        catch {
            return raw;
        }
    }
    grant(res, hash) {
        if (!hash)
            return;
        res.cookie(shares_service_1.SHARE_PW_COOKIE, hash, shares_service_1.SHARE_PW_COOKIE_OPTIONS);
    }
    async list(req, q, res) {
        const actor = this.actor(req);
        if (!actor.user)
            return res.status(401).json({ success: false, error: '未登录' });
        return res.json(await this.svc.list(q, actor));
    }
    async upsert(body, req, res) {
        const actor = this.actor(req);
        if (!actor.user)
            return res.status(401).json({ success: false, error: '未登录' });
        const r = await this.svc.upsert(actor, body || {});
        if (r.error)
            return res.status(r.status || 400).json({ success: false, error: r.error });
        return res.json({ success: true, data: r.item });
    }
    async batch(body, req, res) {
        const actor = this.actor(req);
        if (!actor.user)
            return res.status(401).json({ success: false, error: '未登录' });
        const r = await this.svc.batch(actor, body || {});
        if (r.error)
            return res.status(r.status || 400).json({ success: false, error: r.error });
        return res.json({ success: true, updated: r.updated || 0 });
    }
    async patch(id, body, req, res) {
        const actor = this.actor(req);
        if (!actor.user)
            return res.status(401).json({ success: false, error: '未登录' });
        const r = await this.svc.patch(id, actor, body || {});
        if (r.error)
            return res.status(r.status || 400).json({ success: false, error: r.error });
        return res.json({ success: true, data: r.item });
    }
    async remove(id, req, res) {
        const actor = this.actor(req);
        if (!actor.user)
            return res.status(401).json({ success: false, error: '未登录' });
        const r = await this.svc.remove(id, actor);
        if (r.error)
            return res.status(r.status || 400).json({ success: false, error: r.error });
        return res.json({ success: true });
    }
    async publicAccess(q, req, res) {
        const r = await this.svc.publicAccess(q, { cookieHash: this.cookieHash(req), ip: req.ip || '' });
        this.grant(res, r.setPwHash);
        const { setPwHash: _omit, ...body } = r;
        return body;
    }
    async publicList(q, req, res) {
        const r = await this.svc.publicList(q, { cookieHash: this.cookieHash(req), ip: req.ip || '' });
        this.grant(res, r.setPwHash);
        const { setPwHash: _omit2, ...body } = r;
        return body;
    }
};
exports.SharesController = SharesController;
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], SharesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(200),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], SharesController.prototype, "upsert", null);
__decorate([
    (0, common_1.Post)('batch'),
    (0, common_1.HttpCode)(200),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], SharesController.prototype, "batch", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], SharesController.prototype, "patch", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], SharesController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)('public/access'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], SharesController.prototype, "publicAccess", null);
__decorate([
    (0, common_1.Get)('public/list'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], SharesController.prototype, "publicList", null);
exports.SharesController = SharesController = __decorate([
    (0, common_1.Controller)('api/shares'),
    __metadata("design:paramtypes", [shares_service_1.SharesService])
], SharesController);
