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
exports.ArticleController = void 0;
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("../auth/auth.guard");
const article_service_1 = require("./article.service");
let ArticleController = class ArticleController {
    article;
    constructor(article) {
        this.article = article;
    }
    ctx(req) {
        const session = (0, auth_guard_1.currentSession)(req);
        const viewer = String(session?.user || '');
        if (!viewer) {
            throw new common_1.HttpException({ success: false, message: '请先登录后再使用文章功能' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        return { viewer };
    }
    fail(message, status = common_1.HttpStatus.BAD_REQUEST) {
        throw new common_1.HttpException({ success: false, message }, status);
    }
    unwrap(r) {
        if (r && r.conflict) {
            throw new common_1.HttpException({ success: false, conflict: true, version: r.version, message: '内容已在别处更新，请重新加载后再改' }, common_1.HttpStatus.CONFLICT);
        }
        if (r && r.error)
            this.fail(r.error);
        return r;
    }
    async folders(req, instanceId, type) {
        const { viewer } = this.ctx(req);
        const data = await this.article.listFolders(viewer, instanceId || '', type);
        return { success: true, data };
    }
    async createFolder(req, body) {
        const { viewer } = this.ctx(req);
        const r = await this.article.createFolder(viewer, String(body.instanceId ?? ''), {
            type: body.type,
            name: body.name,
            parentId: body.parentId,
        });
        const ok = this.unwrap(r);
        return { success: true, data: ok.folder };
    }
    async updateFolder(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.article.updateFolder(viewer, String(body.instanceId ?? ''), id, {
            name: body.name,
            parentId: body.parentId,
            sort: body.sort,
            type: body.type,
        });
        const ok = this.unwrap(r);
        return { success: true, data: ok.folder };
    }
    async deleteFolder(req, id, instanceId, type) {
        const { viewer } = this.ctx(req);
        const r = await this.article.deleteFolder(viewer, instanceId || '', id, type);
        this.unwrap(r);
        return { success: true, data: r };
    }
    async reorderFolders(req, body) {
        const { viewer } = this.ctx(req);
        const data = await this.article.reorderFolders(viewer, String(body.instanceId ?? ''), body.type, String(body.parentId ?? ''), body.ids);
        return { success: true, data };
    }
    async list(req, q) {
        const { viewer } = this.ctx(req);
        const data = await this.article.listArticles({
            viewer,
            instanceId: q.instanceId || '',
            type: q.type,
            folderId: q.folderId,
            deep: q.deep === '1' || q.deep === 'true',
            status: q.status,
            search: q.search,
            page: Number(q.page || 1),
            pageSize: Number(q.pageSize || 30),
            sort: q.sort,
        });
        return { success: true, data };
    }
    async tags(req, instanceId, type) {
        const { viewer } = this.ctx(req);
        const data = await this.article.tagCandidates(viewer, instanceId || '', type);
        return { success: true, data };
    }
    async detail(req, id, instanceId) {
        const { viewer } = this.ctx(req);
        const r = await this.article.getArticle(viewer, instanceId || '', id);
        this.unwrap(r);
        return { success: true, data: r.article };
    }
    async create(req, body) {
        const { viewer } = this.ctx(req);
        const r = await this.article.createArticle(viewer, String(body.instanceId ?? ''), {
            type: body.type,
            folderId: body.folderId,
            title: body.title,
            content: body.content,
        });
        this.unwrap(r);
        return { success: true, data: r };
    }
    async update(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.article.updateArticle(viewer, String(body.instanceId ?? ''), id, {
            title: body.title,
            excerpt: body.excerpt,
            note: body.note,
            coverFileId: body.coverFileId,
            folderId: body.folderId,
            status: body.status,
            done: body.done,
            version: body.version,
        });
        this.unwrap(r);
        return { success: true, data: r };
    }
    async saveTabs(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.article.saveTabs(viewer, String(body.instanceId ?? ''), id, {
            tabs: body.tabs,
            version: body.version,
        });
        this.unwrap(r);
        return { success: true, data: r };
    }
    async setTags(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.article.setTags(viewer, String(body.instanceId ?? ''), id, body.names);
        this.unwrap(r);
        return { success: true, data: r };
    }
    async remove(req, id, instanceId) {
        const { viewer } = this.ctx(req);
        const r = await this.article.deleteArticle(viewer, instanceId || '', id);
        this.unwrap(r);
        return { success: true, data: r };
    }
    async restore(req, id, body) {
        const { viewer } = this.ctx(req);
        const r = await this.article.restoreArticle(viewer, String(body?.instanceId ?? ''), id);
        this.unwrap(r);
        return { success: true, data: r };
    }
    async purge(req, id, instanceId) {
        const { viewer } = this.ctx(req);
        const r = await this.article.purgeArticle(viewer, instanceId || '', id);
        this.unwrap(r);
        return { success: true, data: r };
    }
};
exports.ArticleController = ArticleController;
__decorate([
    (0, common_1.Get)('folders'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __param(2, (0, common_1.Query)('type')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "folders", null);
__decorate([
    (0, common_1.Post)('folders'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "createFolder", null);
__decorate([
    (0, common_1.Put)('folders/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "updateFolder", null);
__decorate([
    (0, common_1.Delete)('folders/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('instanceId')),
    __param(3, (0, common_1.Query)('type')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "deleteFolder", null);
__decorate([
    (0, common_1.Post)('folders/reorder'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "reorderFolders", null);
__decorate([
    (0, common_1.Get)('list'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('tags'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('instanceId')),
    __param(2, (0, common_1.Query)('type')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "tags", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "detail", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "create", null);
__decorate([
    (0, common_1.Put)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "update", null);
__decorate([
    (0, common_1.Put)(':id/tabs'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "saveTabs", null);
__decorate([
    (0, common_1.Post)(':id/tags'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "setTags", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':id/restore'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "restore", null);
__decorate([
    (0, common_1.Delete)(':id/purge'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('instanceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], ArticleController.prototype, "purge", null);
exports.ArticleController = ArticleController = __decorate([
    (0, common_1.Controller)('api/article'),
    __metadata("design:paramtypes", [article_service_1.ArticleService])
], ArticleController);
