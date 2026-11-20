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
exports.RegController = void 0;
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("../auth/auth.guard");
const reg_service_1 = require("./reg.service");
let RegController = class RegController {
    reg;
    constructor(reg) {
        this.reg = reg;
    }
    ctx(req) {
        const session = (0, auth_guard_1.currentSession)(req);
        const viewer = String(session?.user || '');
        if (!viewer) {
            throw new common_1.HttpException({ success: false, message: '请先登录后再使用登记' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        return { viewer, isAdmin: (0, auth_guard_1.isAdminRole)(session?.role) };
    }
    async trackers(req, instanceId) {
        const { viewer } = this.ctx(req);
        return this.reg.listTrackers(viewer, instanceId || '');
    }
    async saveTracker(req, body) {
        const { viewer } = this.ctx(req);
        const r = await this.reg.ensureTracker(body, viewer);
        if ('error' in r && r.error) {
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        }
        return { success: true, tracker: r.row, locked: r.locked };
    }
    async updateTracker(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.reg.updateTracker(id, body, viewer);
        if ('error' in r && r.error) {
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        }
        return { success: true, ...r };
    }
    async mergeTrackers(req, body) {
        const { viewer } = this.ctx(req);
        const r = await this.reg.mergeTrackers(String(body?.targetId || ''), Array.isArray(body?.sourceIds) ? body.sourceIds : [], viewer);
        if ('error' in r && r.error) {
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        }
        return { success: true, ...r };
    }
    async entries(req, q) {
        const { viewer } = this.ctx(req);
        return this.reg.listEntries({
            owner: viewer,
            instanceId: String(q.instanceId || ''),
            trackerId: q.trackerId || '',
            trackerName: q.trackerName || '',
            from: q.from || '',
            to: q.to || '',
            keyword: q.keyword || '',
            tag: q.tag || '',
            page: Number(q.page) || 1,
            pageSize: Number(q.pageSize) || 20,
        });
    }
    async createEntry(req, body) {
        const { viewer } = this.ctx(req);
        const r = await this.reg.createEntry(body, viewer);
        if ('error' in r && r.error) {
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        }
        return { success: true, ...r };
    }
    async updateEntry(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.reg.updateEntry(id, body, viewer);
        if ('error' in r && r.error) {
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        }
        return { success: true, ...r };
    }
    async removeEntry(req, id) {
        const { viewer } = this.ctx(req);
        const r = await this.reg.removeEntry(id, viewer);
        if ('error' in r && r.error) {
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        }
        return { success: true, ...r };
    }
    async stats(req, q) {
        const { viewer } = this.ctx(req);
        return this.reg.stats({
            owner: viewer,
            instanceId: String(q.instanceId || ''),
            scope: q.scope || 'me',
            trackerId: q.trackerId || '',
            trackerName: q.trackerName || '',
            tag: q.tag || '',
            from: q.from || '',
            to: q.to || '',
            bucket: q.bucket || 'month',
            compare: q.compare || '',
        });
    }
    async units(req, instanceId) {
        const { viewer } = this.ctx(req);
        return this.reg.listUnits(viewer, instanceId || '');
    }
    async saveUnit(req, body) {
        const { viewer } = this.ctx(req);
        const r = await this.reg.saveUnit(body, viewer);
        if ('error' in r && r.error) {
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        }
        return { success: true, ...r };
    }
    async removeUnit(req, id) {
        const { viewer } = this.ctx(req);
        const r = await this.reg.removeUnit(id, viewer);
        if ('error' in r && r.error) {
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        }
        return { success: true, ...r };
    }
    async tagCandidates(req, instanceId) {
        const { viewer } = this.ctx(req);
        return this.reg.listTagNames(instanceId || '', viewer);
    }
    async candidates(req, instanceId) {
        const { viewer } = this.ctx(req);
        return this.reg.candidates(viewer, instanceId || '');
    }
    async reports(req, instanceId) {
        const { viewer } = this.ctx(req);
        return this.reg.listReports(viewer, instanceId || '');
    }
    async saveReport(req, body) {
        const { viewer } = this.ctx(req);
        const r = await this.reg.saveReport(body, viewer);
        if ('error' in r && r.error) {
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        }
        return { success: true, ...r };
    }
    async removeReport(req, id) {
        const { viewer } = this.ctx(req);
        const r = await this.reg.removeReport(id, viewer);
        if ('error' in r && r.error) {
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        }
        return { success: true, ...r };
    }
    async importRows(req, body) {
        const { viewer } = this.ctx(req);
        const rows = Array.isArray(body?.rows) ? body.rows : [];
        if (!rows.length)
            return { ok: 0, failed: [] };
        return this.reg.importRows(rows, viewer, String(body.instanceId || ''));
    }
};
exports.RegController = RegController;
__decorate([
    (0, common_1.Get)('trackers'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "trackers", null);
__decorate([
    (0, common_1.Post)('trackers'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "saveTracker", null);
__decorate([
    (0, common_1.Put)('trackers/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "updateTracker", null);
__decorate([
    (0, common_1.Post)('trackers/merge'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "mergeTrackers", null);
__decorate([
    (0, common_1.Get)('entries'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "entries", null);
__decorate([
    (0, common_1.Post)('entries'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "createEntry", null);
__decorate([
    (0, common_1.Put)('entries/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "updateEntry", null);
__decorate([
    (0, common_1.Delete)('entries/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "removeEntry", null);
__decorate([
    (0, common_1.Get)('stats'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "stats", null);
__decorate([
    (0, common_1.Get)('units'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "units", null);
__decorate([
    (0, common_1.Post)('units'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "saveUnit", null);
__decorate([
    (0, common_1.Delete)('units/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "removeUnit", null);
__decorate([
    (0, common_1.Get)('tag-candidates'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "tagCandidates", null);
__decorate([
    (0, common_1.Get)('candidates'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "candidates", null);
__decorate([
    (0, common_1.Get)('reports'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "reports", null);
__decorate([
    (0, common_1.Post)('reports'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "saveReport", null);
__decorate([
    (0, common_1.Delete)('reports/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "removeReport", null);
__decorate([
    (0, common_1.Post)('import'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], RegController.prototype, "importRows", null);
exports.RegController = RegController = __decorate([
    (0, common_1.Controller)('api/reg'),
    __metadata("design:paramtypes", [reg_service_1.RegService])
], RegController);
