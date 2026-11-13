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
exports.NotesController = void 0;
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("../auth/auth.guard");
const notes_service_1 = require("./notes.service");
let NotesController = class NotesController {
    notes;
    constructor(notes) {
        this.notes = notes;
    }
    ctx(req) {
        const session = (0, auth_guard_1.currentSession)(req);
        const viewer = String(session?.user || '');
        if (!viewer) {
            throw new common_1.HttpException({ success: false, message: '请先登录后再使用笔记' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        return { viewer, isAdmin: (0, auth_guard_1.isAdminRole)(session?.role) };
    }
    async list(req, kind, scope, mediaKind, search, searchType, tagId, status, from, to, sort, order, page, pageSize, instanceId) {
        const { viewer, isAdmin } = this.ctx(req);
        return this.notes.list({
            kind,
            scope,
            mediaKind,
            search,
            searchType,
            tagId,
            status,
            from,
            to,
            sort,
            order,
            page: Number(page) || 1,
            pageSize: Number(pageSize) || 20,
            instanceId: instanceId || '',
            viewer,
            isAdmin,
        });
    }
    async tags(req, instanceId) {
        const { viewer } = this.ctx(req);
        return this.notes.tagCandidates(instanceId || '', viewer);
    }
    async getSettings(req, instanceId) {
        this.ctx(req);
        return { success: true, data: await this.notes.getNoteSettings(instanceId || '') };
    }
    async saveSettings(req, body) {
        this.ctx(req);
        const { instanceId, ...patch } = body || {};
        const data = await this.notes.saveNoteSettings(String(instanceId || ''), patch);
        return { success: true, data };
    }
    async files(req, q) {
        const { viewer, isAdmin } = this.ctx(req);
        return this.notes.pickFiles({
            search: q.search,
            searchScope: q.searchType,
            type: q.type,
            page: Number(q.page) || 1,
            pageSize: Number(q.pageSize) || 24,
            instanceId: q.instanceId || '',
            viewer,
            isAdmin,
            filterQuery: q,
            matchMode: q.matchMode,
        });
    }
    async tagAdmin(req, instanceId, kind) {
        const { viewer } = this.ctx(req);
        return this.notes.tagAdmin(instanceId || '', kind || '', viewer);
    }
    async locations(req, instanceId, q) {
        const { viewer } = this.ctx(req);
        return this.notes.pickLocations(viewer, instanceId || '', q || '');
    }
    async comments(req, id, instanceId, page, pageSize) {
        const { viewer, isAdmin } = this.ctx(req);
        const r = await this.notes.listComments({
            noteId: id,
            viewer,
            isAdmin,
            instanceId: instanceId || '',
            page: Number(page) || 1,
            pageSize: Number(pageSize) || 20,
        });
        if ('error' in r && r.error)
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.NOT_FOUND);
        return r;
    }
    async addComment(req, id, body) {
        const { viewer, isAdmin } = this.ctx(req);
        const r = await this.notes.addComment({
            noteId: id,
            content: String(body.content ?? ''),
            viewer,
            isAdmin,
            instanceId: String(body.instanceId ?? ''),
            ip: String(req.ip || ''),
        });
        if ('error' in r && r.error)
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        return { success: true, id: r.id, comment: r.comment || null };
    }
    async deleteComment(req, commentId) {
        const { viewer, isAdmin } = this.ctx(req);
        const r = await this.notes.deleteComment(commentId, viewer, isAdmin, String(req.ip || ''));
        if ('error' in r && r.error)
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        return { success: true };
    }
    async detail(req, id, instanceId) {
        const { viewer, isAdmin } = this.ctx(req);
        const hit = await this.notes.detail(id, viewer, isAdmin, instanceId || '');
        if (!hit)
            throw new common_1.HttpException({ success: false, message: '瞬间不存在或无权查看' }, common_1.HttpStatus.NOT_FOUND);
        return hit;
    }
    async create(req, body) {
        const { viewer } = this.ctx(req);
        const r = await this.notes.createMoment({
            title: body.title,
            content: body.content,
            mood: body.mood,
            weather: body.weather,
            moodName: body.moodName,
            weatherName: body.weatherName,
            location: body.location,
            visibility: body.visibility,
            assetIds: body.assetIds,
            tagNames: body.tagNames,
            instanceId: body.instanceId,
        }, viewer, String(req.ip || ''));
        if ('error' in r && r.error)
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        return { success: true, id: r.id };
    }
    async update(req, id, body) {
        const { viewer, isAdmin } = this.ctx(req);
        const r = await this.notes.updateMoment(id, {
            title: body.title,
            content: body.content,
            mood: body.mood,
            weather: body.weather,
            moodName: body.moodName,
            weatherName: body.weatherName,
            location: body.location,
            visibility: body.visibility,
            assetIds: body.assetIds,
            tagNames: body.tagNames,
            instanceId: body.instanceId,
            publishedAt: body.publishedAt,
        }, viewer, isAdmin, String(req.ip || ''));
        if ('error' in r && r.error)
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        return { success: true, id: r.id };
    }
    async remove(req, id) {
        const { viewer, isAdmin } = this.ctx(req);
        const r = await this.notes.softDelete(id, viewer, isAdmin, String(req.ip || ''));
        if ('error' in r && r.error)
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        return { success: true };
    }
    async restore(req, id) {
        const { viewer, isAdmin } = this.ctx(req);
        const r = await this.notes.restore(id, viewer, isAdmin, String(req.ip || ''));
        if ('error' in r && r.error)
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        return { success: true };
    }
    async purge(req, id) {
        const { viewer, isAdmin } = this.ctx(req);
        const r = await this.notes.purge(id, viewer, isAdmin, String(req.ip || ''));
        if ('error' in r && r.error)
            throw new common_1.HttpException({ success: false, message: r.error }, common_1.HttpStatus.BAD_REQUEST);
        return { success: true };
    }
};
exports.NotesController = NotesController;
__decorate([
    (0, common_1.Get)('list'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('kind')),
    __param(2, (0, common_1.Query)('scope')),
    __param(3, (0, common_1.Query)('mediaKind')),
    __param(4, (0, common_1.Query)('search')),
    __param(5, (0, common_1.Query)('searchType')),
    __param(6, (0, common_1.Query)('tagId')),
    __param(7, (0, common_1.Query)('status')),
    __param(8, (0, common_1.Query)('from')),
    __param(9, (0, common_1.Query)('to')),
    __param(10, (0, common_1.Query)('sort')),
    __param(11, (0, common_1.Query)('order')),
    __param(12, (0, common_1.Query)('page')),
    __param(13, (0, common_1.Query)('pageSize')),
    __param(14, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String, String, String, String, String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('tags'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "tags", null);
__decorate([
    (0, common_1.Get)('settings'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "getSettings", null);
__decorate([
    (0, common_1.Put)('settings'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "saveSettings", null);
__decorate([
    (0, common_1.Get)('files'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "files", null);
__decorate([
    (0, common_1.Get)('tag-admin'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __param(2, (0, common_1.Query)('kind')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "tagAdmin", null);
__decorate([
    (0, common_1.Get)('locations'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __param(2, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "locations", null);
__decorate([
    (0, common_1.Get)(':id/comments'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('instanceId')),
    __param(3, (0, common_1.Query)('page')),
    __param(4, (0, common_1.Query)('pageSize')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "comments", null);
__decorate([
    (0, common_1.Post)(':id/comments'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "addComment", null);
__decorate([
    (0, common_1.Delete)('comments/:commentId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('commentId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "deleteComment", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "detail", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "create", null);
__decorate([
    (0, common_1.Put)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':id/restore'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "restore", null);
__decorate([
    (0, common_1.Delete)(':id/purge'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], NotesController.prototype, "purge", null);
exports.NotesController = NotesController = __decorate([
    (0, common_1.Controller)('api/notes'),
    __metadata("design:paramtypes", [notes_service_1.NotesService])
], NotesController);
