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
exports.MemoController = void 0;
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("../auth/auth.guard");
const memo_service_1 = require("./memo.service");
let MemoController = class MemoController {
    memo;
    constructor(memo) {
        this.memo = memo;
    }
    ctx(req) {
        const session = (0, auth_guard_1.currentSession)(req);
        const viewer = String(session?.user || '');
        if (!viewer) {
            throw new common_1.HttpException({ success: false, message: '请先登录后再使用笔记' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        return { viewer };
    }
    fail(message, status = common_1.HttpStatus.BAD_REQUEST) {
        throw new common_1.HttpException({ success: false, message }, status);
    }
    async folders(req, instanceId) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.listFolders(viewer, instanceId || '');
        return { success: true, data };
    }
    async createFolder(req, body) {
        const { viewer } = this.ctx(req);
        const r = await this.memo.createFolder(viewer, String(body.instanceId ?? ''), {
            name: body.name,
            parentId: body.parentId,
        });
        if ('error' in r && r.error)
            this.fail(r.error);
        return { success: true, data: r.folder };
    }
    async updateFolder(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.memo.updateFolder(viewer, String(body.instanceId ?? ''), id, {
            name: body.name,
            parentId: body.parentId,
            sort: body.sort,
        });
        if ('error' in r && r.error)
            this.fail(r.error);
        return { success: true, data: r.folder };
    }
    async deleteFolder(req, id, instanceId) {
        const { viewer } = this.ctx(req);
        const r = await this.memo.deleteFolder(viewer, instanceId || '', id);
        if ('error' in r && r.error)
            this.fail(r.error);
        return { success: true, data: r };
    }
    async reorderFolders(req, body) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.reorderFolders(viewer, String(body.instanceId ?? ''), String(body.parentId ?? ''), body.ids);
        return { success: true, data };
    }
    async list(req, q) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.listNotes({
            viewer,
            instanceId: q.instanceId || '',
            folderId: q.folderId,
            search: q.search,
            status: q.status,
            page: Number(q.page) || 1,
            pageSize: Number(q.pageSize) || 50,
        });
        return { success: true, data };
    }
    async resolveBlock(req, q) {
        const { viewer } = this.ctx(req);
        const bid = String(q.blockId || '');
        if (!bid)
            this.fail('缺少 blockId');
        const data = await this.memo.resolveBlock(bid, viewer, q.instanceId || '');
        if ('error' in data && data.error)
            this.fail(data.error, common_1.HttpStatus.NOT_FOUND);
        return { success: true, data };
    }
    async blocks(req, id, instanceId) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.listBlocks(id, viewer, instanceId || '');
        if ('error' in data && data.error)
            this.fail(data.error, common_1.HttpStatus.NOT_FOUND);
        return { success: true, data };
    }
    async backlinks(req, id, instanceId) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.backlinks(id, viewer, instanceId || '');
        if ('error' in data && data.error)
            this.fail(data.error, common_1.HttpStatus.NOT_FOUND);
        return { success: true, data };
    }
    async rebuildIndex(req, id, body) {
        const { viewer } = this.ctx(req);
        const instanceId = String(body.instanceId ?? '');
        const note = await this.memo.getNote(viewer, instanceId, id);
        if (!note)
            this.fail('笔记不存在', common_1.HttpStatus.NOT_FOUND);
        const data = await this.memo.rebuildNoteIndex(id, String(note?.content || ''), viewer, instanceId);
        return { success: true, data };
    }
    async rebuildAll(req, body) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.rebuildAllIndex(viewer, String(body.instanceId ?? ''));
        return { success: true, data };
    }
    async detail(req, id, instanceId) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.getNote(viewer, instanceId || '', id);
        if (!data)
            this.fail('笔记不存在或无权查看', common_1.HttpStatus.NOT_FOUND);
        return { success: true, data };
    }
    async create(req, body) {
        const { viewer } = this.ctx(req);
        const r = await this.memo.createNote(viewer, String(body.instanceId ?? ''), {
            title: body.title,
            content: body.content,
            folderId: body.folderId,
        });
        if ('error' in r && r.error)
            this.fail(r.error);
        return { success: true, data: r };
    }
    async save(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.memo.saveNote(viewer, String(body.instanceId ?? ''), id, {
            title: body.title,
            content: body.content,
            folderId: body.folderId,
            version: body.version,
        });
        if ('error' in r && r.error)
            this.fail(r.error);
        if ('conflict' in r && r.conflict) {
            throw new common_1.HttpException({ success: false, conflict: true, message: r.message, version: r.version }, common_1.HttpStatus.CONFLICT);
        }
        return { success: true, data: r };
    }
    async move(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.memo.moveNote(viewer, String(body.instanceId ?? ''), id, body.folderId);
        if ('error' in r && r.error)
            this.fail(r.error);
        return { success: true, data: r };
    }
    async trash(req, id, instanceId) {
        const { viewer } = this.ctx(req);
        const r = await this.memo.trash(viewer, instanceId || '', id);
        if ('error' in r && r.error)
            this.fail(r.error);
        return { success: true };
    }
    async restore(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.memo.restore(viewer, String(body.instanceId ?? ''), id);
        if ('error' in r && r.error)
            this.fail(r.error);
        return { success: true };
    }
    async purge(req, id, instanceId) {
        const { viewer } = this.ctx(req);
        const r = await this.memo.purge(viewer, instanceId || '', id);
        if ('error' in r && r.error)
            this.fail(r.error);
        return { success: true };
    }
};
exports.MemoController = MemoController;
__decorate([
    (0, common_1.Get)('folders'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "folders", null);
__decorate([
    (0, common_1.Post)('folders'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "createFolder", null);
__decorate([
    (0, common_1.Put)('folders/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "updateFolder", null);
__decorate([
    (0, common_1.Delete)('folders/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "deleteFolder", null);
__decorate([
    (0, common_1.Post)('folders/reorder'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "reorderFolders", null);
__decorate([
    (0, common_1.Get)('list'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('blocks/resolve'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "resolveBlock", null);
__decorate([
    (0, common_1.Get)(':id/blocks'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "blocks", null);
__decorate([
    (0, common_1.Get)(':id/backlinks'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "backlinks", null);
__decorate([
    (0, common_1.Post)(':id/rebuild-index'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "rebuildIndex", null);
__decorate([
    (0, common_1.Post)('rebuild-index'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "rebuildAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "detail", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "create", null);
__decorate([
    (0, common_1.Put)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "save", null);
__decorate([
    (0, common_1.Post)(':id/move'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "move", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "trash", null);
__decorate([
    (0, common_1.Post)(':id/restore'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "restore", null);
__decorate([
    (0, common_1.Delete)(':id/purge'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "purge", null);
exports.MemoController = MemoController = __decorate([
    (0, common_1.Controller)('api/memo'),
    __metadata("design:paramtypes", [memo_service_1.MemoService])
], MemoController);
