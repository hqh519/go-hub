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
    async tree(req, instanceId) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.listTree(viewer, instanceId || '');
        return { success: true, data };
    }
    async getNodeSettings(req, instanceId) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.getNodeSettings(viewer, instanceId || '');
        return { success: true, data };
    }
    async saveNodeSettings(req, body) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.saveNodeSettings(viewer, String(body.instanceId ?? ''), body.settings ?? body);
        return { success: true, data };
    }
    async templates(req, instanceId) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.listTemplates(viewer, instanceId || '');
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
    async tagCandidates(req, q) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.noteTagCandidates(viewer, q.instanceId || '', q.keyword || '');
        return { success: true, data };
    }
    async listTags(req, id, instanceId) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.listNoteTags(viewer, instanceId || '', id);
        if ('error' in data && data.error)
            this.fail(String(data.error), common_1.HttpStatus.NOT_FOUND);
        return { success: true, data };
    }
    async setTags(req, id, body) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.setNoteTags(viewer, String(body.instanceId ?? ''), id, body.tagNames);
        if ('error' in data && data.error)
            this.fail(String(data.error), common_1.HttpStatus.NOT_FOUND);
        return { success: true, data };
    }
    async pushHistory(req, id, body) {
        const { viewer } = this.ctx(req);
        const instanceId = String(body.instanceId ?? '');
        const data = await this.memo.pushHistory(viewer, instanceId, id, {
            title: body.title,
            content: body.content,
            version: body.version,
        });
        if ('error' in data && data.error)
            this.fail(String(data.error), common_1.HttpStatus.NOT_FOUND);
        return { success: true, data };
    }
    async listHistory(req, id, instanceId) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.listHistory(viewer, instanceId || '', id);
        if ('error' in data && data.error)
            this.fail(String(data.error), common_1.HttpStatus.NOT_FOUND);
        return { success: true, data };
    }
    async getHistory(req, id, hid, instanceId) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.getHistory(viewer, instanceId || '', id, hid);
        if ('error' in data && data.error)
            this.fail(String(data.error), common_1.HttpStatus.NOT_FOUND);
        return { success: true, data };
    }
    async restoreHistory(req, id, hid, body) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.restoreHistory(viewer, String(body?.instanceId ?? ''), id, hid);
        if ('error' in data && data.error)
            this.fail(String(data.error), common_1.HttpStatus.NOT_FOUND);
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
        const r = await this.memo.createNode(viewer, String(body.instanceId ?? ''), {
            type: body.type,
            parentId: body.parentId,
            title: body.title,
            content: body.content,
        });
        if ('error' in r && r.error)
            this.fail(String(r.error));
        return { success: true, data: r };
    }
    async reorder(req, body) {
        const { viewer } = this.ctx(req);
        const data = await this.memo.reorderNodes(viewer, String(body.instanceId ?? ''), String(body.parentId ?? ''), body.ids);
        return { success: true, data };
    }
    async rename(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.memo.renameNode(viewer, String(body.instanceId ?? ''), id, body.title);
        if ('error' in r && r.error)
            this.fail(String(r.error));
        return { success: true, data: r };
    }
    async save(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.memo.saveNote(viewer, String(body.instanceId ?? ''), id, {
            title: body.title,
            content: body.content,
            folderId: body.folderId,
            version: body.version,
            mood: body.mood,
            moodName: body.moodName,
            weather: body.weather,
            weatherName: body.weatherName,
        });
        if ('error' in r && r.error)
            this.fail(r.error);
        if ('conflict' in r && r.conflict) {
            throw new common_1.HttpException({ success: false, conflict: true, message: r.message, version: r.version }, common_1.HttpStatus.CONFLICT);
        }
        return { success: true, data: r };
    }
    async promote(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.memo.promoteNode(viewer, String(body.instanceId ?? ''), id);
        if ('error' in r && r.error)
            this.fail(String(r.error));
        return { success: true, data: r };
    }
    async move(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = body.parentId !== undefined || body.sort !== undefined
            ? await this.memo.moveNode(viewer, String(body.instanceId ?? ''), id, {
                parentId: body.parentId,
                sort: body.sort,
            })
            : await this.memo.moveNote(viewer, String(body.instanceId ?? ''), id, body.folderId);
        if ('error' in r && r.error)
            this.fail(String(r.error));
        return { success: true, data: r };
    }
    async trash(req, id, instanceId) {
        const { viewer } = this.ctx(req);
        const r = await this.memo.trashTree(viewer, instanceId || '', id);
        if ('error' in r && r.error)
            this.fail(String(r.error));
        return { success: true, data: r };
    }
    async restore(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.memo.restoreTree(viewer, String(body.instanceId ?? ''), id);
        if ('error' in r && r.error)
            this.fail(String(r.error));
        return { success: true, data: r };
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
    (0, common_1.Get)('tree'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "tree", null);
__decorate([
    (0, common_1.Get)('node-settings'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "getNodeSettings", null);
__decorate([
    (0, common_1.Put)('node-settings'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "saveNodeSettings", null);
__decorate([
    (0, common_1.Get)('templates'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "templates", null);
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
    (0, common_1.Get)('tags/candidates'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "tagCandidates", null);
__decorate([
    (0, common_1.Get)(':id/tags'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "listTags", null);
__decorate([
    (0, common_1.Put)(':id/tags'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "setTags", null);
__decorate([
    (0, common_1.Post)(':id/history'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "pushHistory", null);
__decorate([
    (0, common_1.Get)(':id/history'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "listHistory", null);
__decorate([
    (0, common_1.Get)(':id/history/:hid'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('hid')),
    __param(3, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "getHistory", null);
__decorate([
    (0, common_1.Post)(':id/history/:hid/restore'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('hid')),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "restoreHistory", null);
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
    (0, common_1.Post)('reorder'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "reorder", null);
__decorate([
    (0, common_1.Put)(':id/rename'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "rename", null);
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
    (0, common_1.Post)(':id/promote'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MemoController.prototype, "promote", null);
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
