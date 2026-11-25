"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArticleService = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const app_log_1 = require("../common/app-log");
const tags_1 = require("../common/tags");
const markers_1 = require("../common/markers");
const notes_util_1 = require("../notes/notes.util");
const article_util_1 = require("./article.util");
function asInt(v, d = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : d;
}
function timeOf(v) {
    if (!v)
        return 0;
    const t = v instanceof Date ? v.getTime() : new Date(String(v)).getTime();
    return Number.isFinite(t) ? t : 0;
}
let ArticleService = class ArticleService {
    LIST_SELECT = {
        id: true,
        type: true,
        title: true,
        excerpt: true,
        content: true,
        folderId: true,
        status: true,
        done: true,
        views: true,
        comments: true,
        wordCount: true,
        todoTotal: true,
        todoDone: true,
        version: true,
        coverFileId: true,
        author: true,
        dueAt: true,
        createdAt: true,
        updatedAt: true,
        publishedAt: true,
    };
    async listFolders(viewer, instanceId, typeRaw) {
        const type = (0, article_util_1.normalizeArticleType)(typeRaw);
        const where = { author: viewer, instanceId, type };
        const [folders, rows] = await Promise.all([
            prisma_1.prisma.articleFolder.findMany({ where, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
            prisma_1.prisma.article.groupBy({
                by: ['folderId'],
                where: { author: viewer, instanceId, type, status: { not: 'deleted' } },
                _count: { _all: true },
            }),
        ]);
        const direct = new Map();
        for (const r of rows) {
            direct.set(String(r.folderId || ''), Number(r._count?._all || 0));
        }
        const nodes = folders.map((f) => ({
            id: String(f.id),
            name: String(f.name || ''),
            parentId: String(f.parentId || ''),
            sort: asInt(f.sort),
            type: String(f.type || type),
            directCount: direct.get(String(f.id)) || 0,
            totalCount: 0,
            createdAt: timeOf(f.createdAt),
        }));
        const byId = new Map(nodes.map((n) => [n.id, n]));
        for (const n of nodes)
            n.totalCount = n.directCount;
        for (const n of nodes) {
            let cur = n.parentId ? byId.get(n.parentId) : undefined;
            let guard = 0;
            while (cur && guard < 64) {
                cur.totalCount += n.directCount;
                cur = cur.parentId ? byId.get(cur.parentId) : undefined;
                guard += 1;
            }
        }
        return {
            type,
            nodes,
            unfiled: direct.get('') || 0,
            total: nodes.reduce((s, n) => s + n.directCount, 0) + (direct.get('') || 0),
        };
    }
    async createFolder(viewer, instanceId, input) {
        const type = (0, article_util_1.normalizeArticleType)(input.type);
        const name = String(input.name ?? '').trim().slice(0, 60) || '新建分类';
        const parentId = String(input.parentId ?? '');
        if (parentId) {
            const parent = await prisma_1.prisma.articleFolder.findFirst({ where: { id: parentId, author: viewer, instanceId, type } });
            if (!parent)
                return { error: '上级分类不存在' };
        }
        const max = await prisma_1.prisma.articleFolder.aggregate({
            where: { author: viewer, instanceId, type, parentId },
            _max: { sort: true },
        });
        const folder = await prisma_1.prisma.articleFolder.create({
            data: { type, name, parentId, author: viewer, instanceId, sort: asInt(max._max.sort) + 10 },
        });
        app_log_1.appLog.info('article', `新建分类「${name}」（${viewer}@${instanceId || 'default'} · ${type}）`);
        return { folder: this.folderOut(folder) };
    }
    folderOut(f) {
        return {
            id: String(f.id),
            type: String(f.type || ''),
            name: String(f.name || ''),
            parentId: String(f.parentId || ''),
            sort: asInt(f.sort),
            createdAt: timeOf(f.createdAt),
        };
    }
    async updateFolder(viewer, instanceId, id, input) {
        const type = (0, article_util_1.normalizeArticleType)(input.type);
        const row = await prisma_1.prisma.articleFolder.findFirst({ where: { id, author: viewer, instanceId, type } });
        if (!row)
            return { error: '分类不存在' };
        const data = {};
        if (input.name !== undefined) {
            const name = String(input.name ?? '').trim().slice(0, 60);
            if (!name)
                return { error: '分类名称不能为空' };
            data.name = name;
        }
        if (input.parentId !== undefined) {
            const pid = String(input.parentId ?? '');
            if (pid === id)
                return { error: '不能把分类挂到自己下面' };
            if (pid) {
                const all = await prisma_1.prisma.articleFolder.findMany({ where: { author: viewer, instanceId, type } });
                const byId = new Map(all.map((f) => [String(f.id), String(f.parentId || '')]));
                let cur = pid;
                let guard = 0;
                while (cur && guard < 128) {
                    if (cur === id)
                        return { error: '不能把分类挂到自己的子孙下面' };
                    cur = byId.get(cur) || '';
                    guard += 1;
                }
                const target = await prisma_1.prisma.articleFolder.findFirst({ where: { id: pid, author: viewer, instanceId, type } });
                if (!target)
                    return { error: '目标分类不存在' };
            }
            data.parentId = pid;
        }
        if (input.sort !== undefined)
            data.sort = asInt(input.sort);
        const folder = await prisma_1.prisma.articleFolder.update({ where: { id }, data: data });
        app_log_1.appLog.info('article', `更新分类 ${id}：${JSON.stringify(data)}`);
        return { folder: this.folderOut(folder) };
    }
    async deleteFolder(viewer, instanceId, id, typeRaw) {
        const type = (0, article_util_1.normalizeArticleType)(typeRaw);
        const row = await prisma_1.prisma.articleFolder.findFirst({ where: { id, author: viewer, instanceId, type } });
        if (!row)
            return { error: '分类不存在' };
        const [movedFolders, movedArticles] = await Promise.all([
            prisma_1.prisma.articleFolder.updateMany({ where: { parentId: id, author: viewer, instanceId, type }, data: { parentId: row.parentId } }),
            prisma_1.prisma.article.updateMany({ where: { folderId: id, author: viewer, instanceId, type }, data: { folderId: '' } }),
        ]);
        await prisma_1.prisma.articleFolder.delete({ where: { id } });
        app_log_1.appLog.info('article', `删除分类「${row.name}」：上浮子分类 ${movedFolders.count} 个 / 文章 ${movedArticles.count} 篇改为未分类`);
        return { ok: true, movedFolders: movedFolders.count, movedArticles: movedArticles.count };
    }
    async reorderFolders(viewer, instanceId, typeRaw, parentId, ids) {
        const type = (0, article_util_1.normalizeArticleType)(typeRaw);
        const list = Array.isArray(ids) ? ids.map((x) => String(x)) : [];
        let sort = 10;
        for (const id of list) {
            await prisma_1.prisma.articleFolder.updateMany({
                where: { id, author: viewer, instanceId, type, parentId: String(parentId || '') },
                data: { sort },
            });
            sort += 10;
        }
        return { ok: true };
    }
    async collectFolderIds(viewer, instanceId, type, rootId) {
        const all = await prisma_1.prisma.articleFolder.findMany({ where: { author: viewer, instanceId, type }, select: { id: true, parentId: true } });
        const children = new Map();
        for (const f of all) {
            const p = String(f.parentId || '');
            const arr = children.get(p);
            if (arr)
                arr.push(String(f.id));
            else
                children.set(p, [String(f.id)]);
        }
        const out = [];
        const queue = [rootId];
        let guard = 0;
        while (queue.length && guard < 5000) {
            const cur = queue.shift();
            out.push(cur);
            for (const c of children.get(cur) || [])
                queue.push(c);
            guard += 1;
        }
        return out;
    }
    async listArticles(input) {
        const { viewer, instanceId } = input;
        const type = (0, article_util_1.normalizeArticleType)(input.type);
        const page = Math.max(1, asInt(input.page, 1));
        const pageSize = Math.min(200, Math.max(1, asInt(input.pageSize, 30)));
        const where = { author: viewer, instanceId, type };
        const status = String(input.status ?? '');
        where.status = status === 'deleted' ? 'deleted' : { not: 'deleted' };
        if (status === 'draft')
            where.status = 'draft';
        if (status === 'published')
            where.status = 'published';
        const folderId = String(input.folderId ?? '');
        if (folderId === '__unfiled')
            where.folderId = '';
        else if (folderId && folderId !== '__all') {
            where.folderId = input.deep ? { in: await this.collectFolderIds(viewer, instanceId, type, folderId) } : folderId;
        }
        const search = String(input.search ?? '').trim();
        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { excerpt: { contains: search, mode: 'insensitive' } },
                { content: { contains: search, mode: 'insensitive' } },
            ];
        }
        const sortKey = String(input.sort || 'updated');
        const orderBy = sortKey === 'created'
            ? [{ createdAt: 'desc' }]
            : sortKey === 'title'
                ? [{ title: 'asc' }]
                : [{ updatedAt: 'desc' }];
        const [total, rows] = await Promise.all([
            prisma_1.prisma.article.count({ where: where }),
            prisma_1.prisma.article.findMany({
                where: where,
                orderBy,
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: this.LIST_SELECT,
            }),
        ]);
        const ids = rows.map((r) => String(r.id));
        const [tagLinks, folders, covers] = await Promise.all([
            ids.length
                ? prisma_1.prisma.articleTag.findMany({
                    where: { articleId: { in: ids } },
                    include: { tag: { select: { id: true, name: true } } },
                })
                : Promise.resolve([]),
            prisma_1.prisma.articleFolder.findMany({ where: { author: viewer, instanceId, type }, select: { id: true, name: true } }),
            (() => {
                const coverIds = rows.map((r) => String(r.coverFileId || '')).filter(Boolean);
                return coverIds.length
                    ? prisma_1.prisma.fileRecord.findMany({ where: { id: { in: coverIds } }, select: { id: true, name: true } })
                    : Promise.resolve([]);
            })(),
        ]);
        const tagMap = new Map();
        for (const link of tagLinks) {
            const key = String(link.articleId);
            const arr = tagMap.get(key);
            if (arr)
                arr.push(String(link.tag?.name || ''));
            else
                tagMap.set(key, [String(link.tag?.name || '')]);
        }
        const folderMap = new Map(folders.map((f) => [String(f.id), String(f.name || '')]));
        const coverMap = new Map(covers.map((f) => [String(f.id), String(f.name || '')]));
        const list = rows.map((r) => {
            const id = String(r.id);
            const excerpt = String(r.excerpt || '').trim() ||
                (String(r.type || type) === 'todo' ? (0, article_util_1.todoNamesOfArticle)(r.content, 140) : '') ||
                (0, article_util_1.excerptOfArticle)(r.content, 140);
            const folderIdOf = String(r.folderId || '');
            return {
                id,
                type: String(r.type || type),
                title: String(r.title || ''),
                excerpt,
                folderId: folderIdOf,
                folderName: folderIdOf ? folderMap.get(folderIdOf) || '' : '',
                status: String(r.status || 'draft'),
                author: String(r.author || ''),
                done: !!r.done,
                views: asInt(r.views),
                comments: asInt(r.comments),
                wordCount: asInt(r.wordCount),
                todoTotal: asInt(r.todoTotal),
                todoDone: asInt(r.todoDone),
                version: asInt(r.version, 1),
                tags: tagMap.get(id) || [],
                coverFileId: String(r.coverFileId || ''),
                coverName: coverMap.get(String(r.coverFileId || '')) || '',
                dueAt: timeOf(r.dueAt),
                createdAt: timeOf(r.createdAt),
                updatedAt: timeOf(r.updatedAt),
                publishedAt: timeOf(r.publishedAt),
            };
        });
        return { type, list, total, page, pageSize, hasMore: page * pageSize < total };
    }
    async getArticle(viewer, instanceId, id) {
        const row = await prisma_1.prisma.article.findFirst({
            where: { id, author: viewer, instanceId },
            include: {
                tabs: { orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] },
                tags: { include: { tag: { select: { id: true, name: true } } } },
                markers: { include: { marker: { select: { id: true, name: true } } } },
            },
        });
        if (!row)
            return { error: '文章不存在' };
        let folderName = '';
        if (row.folderId) {
            const f = await prisma_1.prisma.articleFolder.findFirst({ where: { id: row.folderId }, select: { name: true } });
            folderName = String(f?.name || '');
        }
        let coverName = '';
        if (row.coverFileId) {
            const f = await prisma_1.prisma.fileRecord.findFirst({ where: { id: row.coverFileId }, select: { name: true } });
            coverName = String(f?.name || '');
        }
        const tabs = row.tabs.length
            ? row.tabs
            :
                [{ id: '', title: '正文', content: String(row.content || ''), sort: 0, todoTotal: 0, todoDone: 0, wordCount: 0 }];
        return {
            article: {
                id: String(row.id),
                type: String(row.type || 'article'),
                title: String(row.title || ''),
                excerpt: String(row.excerpt || ''),
                note: String(row.note || ''),
                content: String(row.content || ''),
                coverFileId: String(row.coverFileId || ''),
                coverName,
                folderId: String(row.folderId || ''),
                folderName,
                status: String(row.status || 'draft'),
                done: !!row.done,
                views: asInt(row.views),
                comments: asInt(row.comments),
                wordCount: asInt(row.wordCount),
                todoTotal: asInt(row.todoTotal),
                todoDone: asInt(row.todoDone),
                version: asInt(row.version, 1),
                author: String(row.author || ''),
                mood: String(row.mood || ''),
                moodName: String(row.moodName || ''),
                weather: String(row.weather || ''),
                weatherName: String(row.weatherName || ''),
                markerName: String(row.markers?.[0]?.marker?.name || ''),
                dueAt: timeOf(row.dueAt),
                createdAt: timeOf(row.createdAt),
                updatedAt: timeOf(row.updatedAt),
                publishedAt: timeOf(row.publishedAt),
                metas: (0, notes_util_1.safeParse)(row.metas, {}),
                tags: row.tags.map((t) => String(t.tag?.name || '')).filter(Boolean),
                tabs: tabs.map((t) => ({
                    id: String(t.id || ''),
                    title: String(t.title || ''),
                    content: String(t.content || ''),
                    sort: asInt(t.sort),
                    todoTotal: asInt(t.todoTotal),
                    todoDone: asInt(t.todoDone),
                    wordCount: asInt(t.wordCount),
                })),
            },
        };
    }
    async createArticle(viewer, instanceId, input) {
        const type = (0, article_util_1.normalizeArticleType)(input.type);
        const title = String(input.title ?? '').trim().slice(0, article_util_1.MAX_ARTICLE_TITLE);
        const folderId = String(input.folderId ?? '');
        if (folderId) {
            const f = await prisma_1.prisma.articleFolder.findFirst({ where: { id: folderId, author: viewer, instanceId, type } });
            if (!f)
                return { error: '分类不存在' };
        }
        const content = String(input.content ?? '');
        const stat = (0, article_util_1.countTodoTasks)(content);
        const asked = String(input.status ?? '').trim();
        const status = type === 'todo' ? 'published' : asked === 'published' ? 'published' : 'draft';
        const article = await prisma_1.prisma.article.create({
            data: {
                type,
                title,
                content,
                folderId,
                author: viewer,
                instanceId,
                status,
                publishedAt: status === 'published' ? new Date() : null,
                wordCount: (0, article_util_1.countArticleWords)(content),
                todoTotal: stat.total,
                todoDone: stat.done,
                tabs: {
                    create: [
                        {
                            title: '正文',
                            content,
                            sort: 0,
                            todoTotal: stat.total,
                            todoDone: stat.done,
                            wordCount: (0, article_util_1.countArticleWords)(content),
                        },
                    ],
                },
            },
            include: { tabs: { orderBy: [{ sort: 'asc' }] } },
        });
        app_log_1.appLog.info('article', `新建${type === 'todo' ? '待办' : type === 'nav' ? '导航' : '文章'} ${article.id}（${viewer}@${instanceId || 'default'}）`);
        return { id: String(article.id), type, tabs: article.tabs.map((t) => ({ id: String(t.id), title: String(t.title || ''), content: String(t.content || ''), sort: asInt(t.sort) })) };
    }
    async updateArticle(viewer, instanceId, id, input) {
        const row = await prisma_1.prisma.article.findFirst({ where: { id, author: viewer, instanceId } });
        if (!row)
            return { error: '文章不存在' };
        const expect = input.version === undefined || input.version === null ? null : asInt(input.version, -1);
        if (expect !== null && expect !== asInt(row.version, 1)) {
            app_log_1.appLog.warn('article', `保存冲突：文章 ${id} 期望版本 ${expect}，库内 ${row.version}`);
            return { conflict: true, version: asInt(row.version, 1), error: '内容已在别处更新' };
        }
        const data = {};
        if (input.title !== undefined)
            data.title = String(input.title ?? '').trim().slice(0, article_util_1.MAX_ARTICLE_TITLE);
        if (input.excerpt !== undefined)
            data.excerpt = String(input.excerpt ?? '').slice(0, article_util_1.MAX_ARTICLE_EXCERPT);
        if (input.note !== undefined)
            data.note = String(input.note ?? '').slice(0, article_util_1.MAX_ARTICLE_NOTE);
        if (input.coverFileId !== undefined)
            data.coverFileId = String(input.coverFileId ?? '');
        if (input.folderId !== undefined) {
            const fid = String(input.folderId ?? '');
            if (fid) {
                const f = await prisma_1.prisma.articleFolder.findFirst({ where: { id: fid, author: viewer, instanceId, type: row.type } });
                if (!f)
                    return { error: '分类不存在' };
            }
            data.folderId = fid;
        }
        if (input.done !== undefined)
            data.done = !!input.done;
        if (input.mood !== undefined)
            data.mood = String(input.mood ?? '').slice(0, 40);
        if (input.moodName !== undefined)
            data.moodName = String(input.moodName ?? '').slice(0, 60);
        if (input.weather !== undefined)
            data.weather = String(input.weather ?? '').slice(0, 40);
        if (input.weatherName !== undefined)
            data.weatherName = String(input.weatherName ?? '').slice(0, 60);
        if (input.dueAt !== undefined) {
            const ts = Number(input.dueAt);
            data.dueAt = Number.isFinite(ts) && ts > 0 ? new Date(ts) : null;
        }
        if (input.status !== undefined) {
            const status = (0, article_util_1.normalizeArticleStatus)(input.status);
            data.status = status;
            if (status === 'published' && !row.publishedAt)
                data.publishedAt = new Date();
        }
        data.version = asInt(row.version, 1) + 1;
        const updated = await prisma_1.prisma.article.update({ where: { id }, data: data });
        if (input.markerName !== undefined) {
            try {
                const name = String(input.markerName ?? '').trim().slice(0, 120);
                const markerType = String(row.type || 'article');
                const marker = name ? await (0, markers_1.findOrCreateMarker)(name, instanceId, viewer, markerType) : null;
                await prisma_1.prisma.articleMarker.deleteMany({ where: { articleId: id } });
                if (marker)
                    await prisma_1.prisma.articleMarker.create({ data: { articleId: id, markerId: marker.id } });
            }
            catch (e) {
                app_log_1.appLog.warn('article', `保存标记失败：文章 ${id}`);
            }
        }
        return {
            id: String(updated.id),
            version: asInt(updated.version, 1),
            updatedAt: timeOf(updated.updatedAt),
            status: String(updated.status || ''),
            done: !!updated.done,
            folderId: String(updated.folderId || ''),
            title: String(updated.title || ''),
            dueAt: timeOf(updated.dueAt),
        };
    }
    async saveTabs(viewer, instanceId, id, input) {
        const row = await prisma_1.prisma.article.findFirst({ where: { id, author: viewer, instanceId } });
        if (!row)
            return { error: '文章不存在' };
        const expect = input.version === undefined || input.version === null ? null : asInt(input.version, -1);
        if (expect !== null && expect !== asInt(row.version, 1)) {
            app_log_1.appLog.warn('article', `页签保存冲突：文章 ${id} 期望版本 ${expect}，库内 ${row.version}`);
            return { conflict: true, version: asInt(row.version, 1), error: '内容已在别处更新' };
        }
        const raw = Array.isArray(input.tabs) ? input.tabs : [];
        if (!raw.length)
            return { error: '至少保留一个页签' };
        if (raw.length > article_util_1.MAX_ARTICLE_TABS)
            return { error: `页签最多 ${article_util_1.MAX_ARTICLE_TABS} 个` };
        const incoming = raw.slice(0, article_util_1.MAX_ARTICLE_TABS).map((t, i) => {
            const o = (t || {});
            const content = String(o.content ?? '');
            if (content.length > article_util_1.MAX_TAB_CONTENT)
                throw new Error('单个页签正文过长');
            const stat = (0, article_util_1.countTodoTasks)(content);
            return {
                id: String(o.id ?? ''),
                title: String(o.title ?? '').trim().slice(0, article_util_1.MAX_TAB_TITLE) || `页签 ${i + 1}`,
                content,
                sort: i * 10,
                todoTotal: stat.total,
                todoDone: stat.done,
                wordCount: (0, article_util_1.countArticleWords)(content),
            };
        });
        const existing = await prisma_1.prisma.articleTab.findMany({ where: { articleId: id }, select: { id: true } });
        const existingIds = new Set(existing.map((t) => String(t.id)));
        const keepIds = new Set(incoming.map((t) => t.id).filter((x) => x && existingIds.has(x)));
        let wordCount = 0;
        let todoTotal = 0;
        let todoDone = 0;
        for (const t of incoming) {
            wordCount += t.wordCount;
            todoTotal += t.todoTotal;
            todoDone += t.todoDone;
        }
        await prisma_1.prisma.$transaction(async (tx) => {
            const removeIds = [...existingIds].filter((x) => !keepIds.has(x));
            if (removeIds.length)
                await tx.articleTab.deleteMany({ where: { id: { in: removeIds } } });
            for (const t of incoming) {
                if (t.id && keepIds.has(t.id)) {
                    await tx.articleTab.update({
                        where: { id: t.id },
                        data: {
                            title: t.title,
                            content: t.content,
                            sort: t.sort,
                            todoTotal: t.todoTotal,
                            todoDone: t.todoDone,
                            wordCount: t.wordCount,
                        },
                    });
                }
                else {
                    await tx.articleTab.create({
                        data: {
                            articleId: id,
                            title: t.title,
                            content: t.content,
                            sort: t.sort,
                            todoTotal: t.todoTotal,
                            todoDone: t.todoDone,
                            wordCount: t.wordCount,
                        },
                    });
                }
            }
            await tx.article.update({
                where: { id },
                data: {
                    content: incoming[0].content,
                    wordCount,
                    todoTotal,
                    todoDone,
                    done: row.type === 'todo' && todoTotal > 0 && todoDone >= todoTotal ? true : !!row.done,
                    version: asInt(row.version, 1) + 1,
                },
            });
        });
        const tabs = await prisma_1.prisma.articleTab.findMany({ where: { articleId: id }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
        const fresh = await prisma_1.prisma.article.findFirst({ where: { id }, select: { version: true, updatedAt: true, done: true, content: true } });
        return {
            tabs: tabs.map((t) => ({
                id: String(t.id),
                title: String(t.title || ''),
                content: String(t.content || ''),
                sort: asInt(t.sort),
                todoTotal: asInt(t.todoTotal),
                todoDone: asInt(t.todoDone),
                wordCount: asInt(t.wordCount),
            })),
            wordCount,
            todoTotal,
            todoDone,
            version: asInt(fresh?.version, 1),
            updatedAt: timeOf(fresh?.updatedAt),
            done: !!fresh?.done,
        };
    }
    async tagCandidates(viewer, instanceId, typeRaw) {
        const type = (0, article_util_1.normalizeArticleType)(typeRaw);
        const scope = (0, tags_1.tagScope)(instanceId, type, viewer);
        const tags = await prisma_1.prisma.tag.findMany({
            where: { ...scope },
            orderBy: [{ createdAt: 'asc' }],
            select: { id: true, name: true },
        });
        const counts = await prisma_1.prisma.articleTag.groupBy({
            by: ['tagId'],
            where: { article: { author: viewer, instanceId, type } },
            _count: { _all: true },
        });
        const countMap = new Map(counts.map((c) => [String(c.tagId), Number(c._count?._all || 0)]));
        return tags
            .map((t) => ({ id: String(t.id), name: String(t.name || ''), count: countMap.get(String(t.id)) || 0 }))
            .filter((t) => t.name)
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }
    async setTags(viewer, instanceId, id, rawNames) {
        const row = await prisma_1.prisma.article.findFirst({ where: { id, author: viewer, instanceId } });
        if (!row)
            return { error: '文章不存在' };
        const names = (0, notes_util_1.normalizeTagNames)(rawNames).slice(0, notes_util_1.MAX_TAGS_PER_NOTE);
        const tagIds = [];
        for (const name of names) {
            const tag = await (0, tags_1.findOrCreateTag)(name, instanceId, viewer, String(row.type || 'article'));
            tagIds.push(String(tag.id));
        }
        await prisma_1.prisma.$transaction(async (tx) => {
            await tx.articleTag.deleteMany({ where: { articleId: id } });
            for (const tagId of tagIds) {
                await tx.articleTag.create({ data: { articleId: id, tagId } }).catch(() => undefined);
            }
        });
        return { tags: names };
    }
    async deleteArticle(viewer, instanceId, id) {
        const row = await prisma_1.prisma.article.findFirst({ where: { id, author: viewer, instanceId } });
        if (!row)
            return { error: '文章不存在' };
        await prisma_1.prisma.article.update({ where: { id }, data: { status: 'deleted', deletedAt: new Date() } });
        app_log_1.appLog.info('article', `${row.type === 'todo' ? '待办' : '文章'}进回收站：${id}（${row.title || '无标题'}）`);
        return { ok: true };
    }
    async restoreArticle(viewer, instanceId, id) {
        const row = await prisma_1.prisma.article.findFirst({ where: { id, author: viewer, instanceId } });
        if (!row)
            return { error: '文章不存在' };
        let folderId = String(row.folderId || '');
        if (folderId) {
            const f = await prisma_1.prisma.articleFolder.findFirst({ where: { id: folderId }, select: { id: true } });
            if (!f)
                folderId = '';
        }
        await prisma_1.prisma.article.update({
            where: { id },
            data: { status: 'draft', deletedAt: null, folderId },
        });
        return { ok: true };
    }
    async purgeArticle(viewer, instanceId, id) {
        const row = await prisma_1.prisma.article.findFirst({ where: { id, author: viewer, instanceId } });
        if (!row)
            return { error: '文章不存在' };
        await prisma_1.prisma.article.delete({ where: { id } });
        app_log_1.appLog.info('article', `彻底删除文章 ${id}（${row.title || '无标题'}）`);
        return { ok: true };
    }
};
exports.ArticleService = ArticleService;
exports.ArticleService = ArticleService = __decorate([
    (0, common_1.Injectable)()
], ArticleService);
