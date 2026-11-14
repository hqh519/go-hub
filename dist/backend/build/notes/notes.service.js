"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotesService = exports.LIST_COMMENT_MAX = void 0;
exports.parseNoteSearch = parseNoteSearch;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const app_log_1 = require("../common/app-log");
const tags_1 = require("../common/tags");
const file_share_stats_1 = require("../common/file-share-stats");
const file_view_1 = require("../common/file-view");
const file_filter_1 = require("../common/file-filter");
const notes_util_1 = require("./notes.util");
exports.LIST_COMMENT_MAX = 100;
function parseNoteSearch(raw) {
    const includeTags = [];
    const excludeTags = [];
    const words = [];
    for (const token of String(raw || '').split(/\s+/)) {
        if (!token)
            continue;
        if (token.startsWith('-#') && token.length > 2) {
            excludeTags.push(token.slice(2));
        }
        else if (token.startsWith('#') && token.length > 1) {
            includeTags.push(token.slice(1));
        }
        else {
            words.push(token);
        }
    }
    return { keyword: words.join(' '), includeTags, excludeTags };
}
const SORTABLE = {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    publishedAt: 'publishedAt',
};
const FILE_SELECT = {
    id: true,
    name: true,
    originalName: true,
    mime: true,
    size: true,
};
let NotesService = class NotesService {
    async momentMaxChars() {
        try {
            const row = await prisma_1.prisma.setting.findUnique({ where: { key: 'notesMomentMaxChars' } });
            const n = Number(row?.value);
            if (Number.isFinite(n) && n >= 50 && n <= 20000)
                return Math.round(n);
        }
        catch {
        }
        return notes_util_1.DEFAULT_MOMENT_MAX_CHARS;
    }
    async resolveAssetFiles(rawIds, instanceId) {
        const ids = Array.from(new Set((rawIds || []).map((x) => String(x || '').trim()).filter(Boolean)));
        if (!ids.length)
            return { ordered: [], missing: [] };
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: {
                instanceId,
                status: 'active',
                OR: [{ id: { in: ids } }, { name: { in: ids } }],
            },
            select: FILE_SELECT,
        });
        const byId = new Map(rows.map((r) => [r.id, r]));
        const byName = new Map(rows.map((r) => [r.name, r]));
        const ordered = [];
        const missing = [];
        const seen = new Set();
        for (const raw of ids) {
            const hit = byId.get(raw) || byName.get(raw);
            if (!hit) {
                missing.push(raw);
                continue;
            }
            if (seen.has(hit.id))
                continue;
            seen.add(hit.id);
            ordered.push(hit);
        }
        return { ordered, missing };
    }
    async resolveFiles(fileIds) {
        const ids = Array.from(new Set((fileIds || []).filter(Boolean)));
        const map = new Map();
        if (!ids.length)
            return map;
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: { id: { in: ids } },
            select: FILE_SELECT,
        });
        for (const r of rows) {
            const kind = (0, notes_util_1.mediaKindOfMime)(r.mime);
            map.set(r.id, {
                fileId: r.id,
                url: (0, notes_util_1.fileUrlOf)(r.name),
                thumbUrl: (0, notes_util_1.fileUrlOf)(r.name, kind === 'image' ? 480 : undefined),
                name: r.name,
                originalName: r.originalName,
                mime: r.mime,
                size: r.size,
                mediaKind: kind,
                alive: true,
            });
        }
        return map;
    }
    async toListItem(row, viewer = '') {
        const assets = [];
        const map = await this.resolveFiles((row.assets || []).map((a) => a.fileId));
        for (const a of row.assets || []) {
            const hit = map.get(a.fileId);
            if (hit)
                assets.push(hit);
        }
        const commentRows = await prisma_1.prisma.noteComment.findMany({
            where: { noteId: row.id },
            orderBy: { createdAt: 'asc' },
            take: exports.LIST_COMMENT_MAX,
        });
        const commentCount = await prisma_1.prisma.noteComment.count({ where: { noteId: row.id } });
        return this.shape(row, assets, commentRows, commentCount, viewer);
    }
    buildWhere(input) {
        const square = String(input.scope || '').toLowerCase() === 'square';
        const where = square
            ? {}
            : {
                instanceId: String(input.instanceId || ''),
            };
        if (input.kind)
            where.kind = String(input.kind);
        if (square) {
            where.visibility = 'public';
            where.status = 'published';
        }
        else {
            where.status = input.status === 'deleted' ? 'deleted' : input.status === 'all' ? { not: 'deleted' } : 'published';
            where.author = String(input.viewer || '');
        }
        const parsed = parseNoteSearch(input.search);
        const and = [];
        for (const name of parsed.includeTags) {
            and.push({ tags: { some: { tag: { name: { equals: name, mode: 'insensitive' } } } } });
        }
        for (const name of parsed.excludeTags) {
            and.push({ tags: { none: { tag: { name: { equals: name, mode: 'insensitive' } } } } });
        }
        if (parsed.keyword) {
            const kw = { contains: parsed.keyword, mode: 'insensitive' };
            const byScope = {
                title: [{ moment: { title: kw } }],
                content: [{ content: kw }],
                tag: [{ tags: { some: { tag: { name: kw } } } }],
                other: [
                    { moment: { location: kw } },
                    { moment: { moodName: kw } },
                    { moment: { weatherName: kw } },
                    { author: kw },
                    { comments: { some: { content: kw } } },
                ],
                all: [
                    { content: kw },
                    { metas: kw },
                    { moment: { title: kw } },
                    { tags: { some: { tag: { name: kw } } } },
                    { moment: { location: kw } },
                    { moment: { moodName: kw } },
                    { moment: { weatherName: kw } },
                    { author: kw },
                    { comments: { some: { content: kw } } },
                ],
            };
            const scope = String(input.searchType || 'all').toLowerCase();
            and.push({ OR: byScope[scope] || byScope.all });
        }
        if (and.length)
            where.AND = and;
        if (input.mediaKind)
            where.moment = { mediaKind: String(input.mediaKind) };
        if (input.tagId)
            where.tags = { some: { tagId: String(input.tagId) } };
        if (input.from || input.to) {
            const range = {};
            if (input.from) {
                const d = new Date(input.from);
                if (!Number.isNaN(d.getTime()))
                    range.gte = d;
            }
            if (input.to) {
                const d = new Date(input.to);
                if (!Number.isNaN(d.getTime())) {
                    d.setHours(23, 59, 59, 999);
                    range.lte = d;
                }
            }
            if (Object.keys(range).length)
                where.createdAt = range;
        }
        return where;
    }
    async list(input) {
        const where = this.buildWhere(input);
        const page = Math.max(1, Math.floor(Number(input.page) || 1));
        const pageSize = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize) || 20)));
        const sortKey = SORTABLE[String(input.sort || '')] || 'publishedAt';
        const order = String(input.order || 'desc') === 'asc' ? 'asc' : 'desc';
        const orderBy = sortKey === 'publishedAt'
            ? [{ publishedAt: { sort: order, nulls: 'last' } }, { createdAt: 'desc' }]
            : { [sortKey]: order };
        const [total, rows] = await Promise.all([
            prisma_1.prisma.note.count({ where: where }),
            prisma_1.prisma.note.findMany({
                where: where,
                orderBy,
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: {
                    moment: true,
                    assets: { orderBy: { sort: 'asc' } },
                    tags: { include: { tag: true } },
                },
            }),
        ]);
        const allFileIds = rows.flatMap((r) => (r.assets || []).map((a) => a.fileId));
        const fileMap = await this.resolveFiles(allFileIds);
        const noteIds = rows.map((r) => String(r.id));
        const [commentRows, commentCounts] = noteIds.length
            ? await Promise.all([
                prisma_1.prisma.noteComment.findMany({
                    where: { noteId: { in: noteIds } },
                    orderBy: { createdAt: 'asc' },
                }),
                prisma_1.prisma.noteComment.groupBy({ by: ['noteId'], where: { noteId: { in: noteIds } }, _count: { _all: true } }),
            ])
            : [[], []];
        const commentsByNote = new Map();
        for (const c of commentRows) {
            const key = String(c.noteId);
            const arr = commentsByNote.get(key);
            if (arr)
                arr.push(c);
            else
                commentsByNote.set(key, [c]);
        }
        const countByNote = new Map();
        for (const g of commentCounts) {
            countByNote.set(String(g.noteId), Number(g._count && g._count._all) || 0);
        }
        const authorNames = Array.from(new Set(rows.map((r) => String(r.author || '')).filter(Boolean)));
        const profileMap = new Map();
        if (authorNames.length) {
            const users = await prisma_1.prisma.user.findMany({
                where: { username: { in: authorNames } },
                select: { username: true, nickname: true, avatar: true },
            });
            for (const u of users) {
                profileMap.set(String(u.username), {
                    nickname: String(u.nickname || ''),
                    avatar: String(u.avatar || ''),
                });
            }
        }
        const list = rows.map((row) => {
            const assets = [];
            for (const a of row.assets || []) {
                const hit = fileMap.get(a.fileId);
                if (hit)
                    assets.push(hit);
            }
            const all = commentsByNote.get(String(row.id)) || [];
            return this.shape(row, assets, all.slice(0, exports.LIST_COMMENT_MAX), countByNote.get(String(row.id)) || all.length, input.viewer, profileMap);
        });
        return { total, page, pageSize, list };
    }
    shapeComments(rows, viewer) {
        return (rows || []).map((r) => ({
            id: r.id,
            content: r.content,
            charCount: Number(r.charCount) || 0,
            author: r.author,
            createdAt: r.createdAt ? new Date(r.createdAt).getTime() : 0,
            mine: r.author === viewer,
        }));
    }
    shape(row, assets, comments = [], commentCount = 0, viewer = '', profiles) {
        const prof = profiles ? profiles.get(String(row.author || '')) : undefined;
        return {
            id: row.id,
            kind: row.kind,
            title: String(row.moment?.title || ''),
            content: row.content || '',
            coverFileId: row.coverFileId || '',
            visibility: row.visibility || 'private',
            status: row.status,
            author: row.author || '',
            authorNickname: prof ? String(prof.nickname || '') : '',
            authorAvatarUrl: prof && prof.avatar
                ? `/api/avatar/${encodeURIComponent(String(row.author || ''))}?v=${encodeURIComponent(String(prof.avatar))}`
                : '',
            mine: String(row.author || '') === String(viewer || ''),
            instanceId: row.instanceId || '',
            version: Number(row.version) || 1,
            publishedAt: row.publishedAt ? new Date(row.publishedAt).getTime() : 0,
            createdAt: row.createdAt ? new Date(row.createdAt).getTime() : 0,
            updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : 0,
            moment: row.moment
                ? {
                    mediaKind: row.moment.mediaKind || 'text',
                    assetCount: Number(row.moment.assetCount) || assets.length,
                    charCount: Number(row.moment.charCount) || 0,
                    weather: row.moment.weather || '',
                    mood: row.moment.mood || '',
                    weatherName: row.moment.weatherName || '',
                    moodName: row.moment.moodName || '',
                    location: row.moment.location || '',
                }
                : null,
            assets,
            tags: (row.tags || [])
                .map((t) => ({ id: t.tag?.id || t.tagId, name: t.tag?.name || '' }))
                .filter((t) => t.name),
            comments: this.shapeComments(comments, viewer),
            commentCount: Number(commentCount) || 0,
        };
    }
    async detail(id, viewer, _isAdmin, instanceId) {
        const row = await prisma_1.prisma.note.findFirst({
            where: {
                id: String(id || ''),
                instanceId: String(instanceId || ''),
                author: String(viewer || ''),
            },
            include: {
                moment: true,
                assets: { orderBy: { sort: 'asc' } },
                tags: { include: { tag: true } },
            },
        });
        if (row)
            return this.toListItem(row, viewer);
        const published = await prisma_1.prisma.note.findFirst({
            where: {
                id: String(id || ''),
                status: 'published',
                visibility: 'public',
            },
            include: {
                moment: true,
                assets: { orderBy: { sort: 'asc' } },
                tags: { include: { tag: true } },
            },
        });
        if (!published)
            return null;
        return this.toListItem(published, viewer);
    }
    async createMoment(input, viewer, ip) {
        const instanceId = String(input.instanceId || '');
        const maxChars = await this.momentMaxChars();
        const content = String(input.content ?? '');
        const charCount = (0, notes_util_1.countTextChars)(content);
        if (charCount > maxChars) {
            return { error: `正文超出上限：当前 ${charCount} 字，上限 ${maxChars} 字（标点与符号不计入）` };
        }
        const assetIds = Array.isArray(input.assetIds) ? Array.from(new Set(input.assetIds.map(String).filter(Boolean))) : [];
        if (assetIds.length > notes_util_1.MAX_ASSETS_PER_NOTE) {
            return { error: `附件过多：当前 ${assetIds.length} 个，上限 ${notes_util_1.MAX_ASSETS_PER_NOTE} 个` };
        }
        if (!content.trim() && assetIds.length === 0) {
            return { error: '瞬间内容不能为空：请填写文字或添加附件' };
        }
        const resolved = await this.resolveAssetFiles(assetIds, instanceId);
        if (resolved.missing.length) {
            return { error: `有 ${resolved.missing.length} 个附件不存在或不属于当前实例，请重新选择` };
        }
        const ordered = resolved.ordered;
        const mediaKind = (0, notes_util_1.mediaKindOf)(ordered.map((f) => f.mime));
        const tagNames = (0, notes_util_1.normalizeTagNames)(input.tagNames);
        const tagRows = [];
        for (const name of tagNames) {
            tagRows.push(await (0, tags_1.findOrCreateTag)(name, instanceId, viewer, 'note'));
        }
        const visibility = notes_util_1.NOTE_VISIBILITIES.includes(String(input.visibility || ''))
            ? String(input.visibility)
            : 'private';
        const now = new Date();
        try {
            const created = await prisma_1.prisma.note.create({
                data: {
                    kind: 'moment',
                    content,
                    coverFileId: ordered.find((f) => (0, notes_util_1.mediaKindOfMime)(f.mime) === 'image')?.id || '',
                    visibility,
                    status: 'published',
                    author: viewer,
                    instanceId,
                    publishedAt: now,
                    firstPublishedAt: now,
                    moment: {
                        create: {
                            title: String(input.title || '').trim().slice(0, 80),
                            mediaKind,
                            assetCount: ordered.length,
                            charCount,
                            mood: String(input.mood || '').slice(0, 32),
                            weather: String(input.weather || '').slice(0, 32),
                            moodName: String(input.moodName || '').slice(0, 32),
                            weatherName: String(input.weatherName || '').slice(0, 32),
                            location: String(input.location || '').slice(0, 80),
                        },
                    },
                    assets: {
                        create: ordered.map((f, idx) => ({ fileId: f.id, sort: idx, usage: 'attachment' })),
                    },
                    tags: {
                        create: tagRows.map((t) => ({ tagId: t.id })),
                    },
                },
                select: { id: true },
            });
            app_log_1.appLog.info('note', `发布瞬间成功：${created.id}`, `正文 ${charCount} 字 ｜ 附件 ${ordered.length} 个（${mediaKind}）｜ 标签 ${tagRows.length} 个 ｜ 实例=${instanceId || '默认'}`, ip);
            return { id: created.id };
        }
        catch (err) {
            app_log_1.appLog.error('note', '发布瞬间失败', `${err.message} ｜ 作者=${viewer}`, ip);
            return { error: `发布失败：${err.message}` };
        }
    }
    async updateMoment(id, input, viewer, isAdmin, ip) {
        const existing = await prisma_1.prisma.note.findUnique({
            where: { id: String(id || '') },
            include: { assets: true },
        });
        if (!existing || existing.kind !== 'moment')
            return { error: '瞬间不存在' };
        if (existing.status === 'deleted')
            return { error: '该瞬间在回收站里，请先恢复再编辑' };
        if (existing.author !== viewer)
            return { error: '无权编辑他人的瞬间' };
        if (String(input.instanceId || '') !== String(existing.instanceId || '')) {
            return { error: '实例不匹配，请刷新后重试' };
        }
        const instanceId = existing.instanceId || '';
        const maxChars = await this.momentMaxChars();
        const content = input.content === undefined ? existing.content : String(input.content);
        const charCount = (0, notes_util_1.countTextChars)(content);
        if (charCount > maxChars) {
            return { error: `正文超出上限：当前 ${charCount} 字，上限 ${maxChars} 字（标点与符号不计入）` };
        }
        const assetIds = input.assetIds === undefined
            ? null
            : Array.from(new Set((input.assetIds || []).map(String).filter(Boolean)));
        if (assetIds && assetIds.length > notes_util_1.MAX_ASSETS_PER_NOTE) {
            return { error: `附件过多：当前 ${assetIds.length} 个，上限 ${notes_util_1.MAX_ASSETS_PER_NOTE} 个` };
        }
        if (!content.trim() && assetIds !== null && assetIds.length === 0) {
            return { error: '瞬间内容不能为空：请填写文字或添加附件' };
        }
        let ordered = null;
        if (assetIds) {
            const resolved = await this.resolveAssetFiles(assetIds, instanceId);
            if (resolved.missing.length)
                return { error: '有附件不存在或不属于当前实例，请重新选择' };
            ordered = resolved.ordered;
        }
        const finalAssetIds = assetIds || existing.assets.map((a) => a.fileId);
        const finalFiles = assetIds
            ? ordered
            : await prisma_1.prisma.fileRecord.findMany({ where: { id: { in: finalAssetIds } }, select: FILE_SELECT });
        const mediaKind = (0, notes_util_1.mediaKindOf)(finalFiles.map((f) => f.mime));
        const tagNames = input.tagNames === undefined ? null : (0, notes_util_1.normalizeTagNames)(input.tagNames);
        const tagRows = [];
        if (tagNames) {
            for (const name of tagNames)
                tagRows.push(await (0, tags_1.findOrCreateTag)(name, instanceId, viewer, 'note'));
        }
        const visibility = input.visibility !== undefined && notes_util_1.NOTE_VISIBILITIES.includes(String(input.visibility))
            ? String(input.visibility)
            : existing.visibility;
        let publishedAt = null;
        if (input.publishedAt !== undefined) {
            const raw = input.publishedAt;
            const ms = typeof raw === 'number' ? raw : Date.parse(String(raw || ''));
            if (!Number.isFinite(ms))
                return { error: '发布时间格式不正确' };
            const d = new Date(ms);
            const min = new Date('1970-01-02T00:00:00Z').getTime();
            const max = Date.now() + 24 * 3600 * 1000;
            if (ms < min || ms > max)
                return { error: '发布时间超出允许范围（不能早于 1970 年，也不能晚于明天）' };
            publishedAt = d;
        }
        try {
            await prisma_1.prisma.note.update({
                where: { id: existing.id },
                data: {
                    content,
                    visibility,
                    ...(publishedAt ? { publishedAt } : {}),
                    coverFileId: finalFiles.find((f) => (0, notes_util_1.mediaKindOfMime)(f.mime) === 'image')?.id || '',
                    version: { increment: 1 },
                    moment: {
                        upsert: {
                            create: {
                                title: String(input.title || '').trim().slice(0, 80),
                                mediaKind,
                                assetCount: finalFiles.length,
                                charCount,
                                mood: String(input.mood || '').slice(0, 32),
                                weather: String(input.weather || '').slice(0, 32),
                                moodName: String(input.moodName || '').slice(0, 32),
                                weatherName: String(input.weatherName || '').slice(0, 32),
                                location: String(input.location || '').slice(0, 80),
                            },
                            update: {
                                ...(input.title === undefined ? {} : { title: String(input.title).trim().slice(0, 80) }),
                                mediaKind,
                                assetCount: finalFiles.length,
                                charCount,
                                ...(input.mood === undefined ? {} : { mood: String(input.mood).slice(0, 32) }),
                                ...(input.weather === undefined ? {} : { weather: String(input.weather).slice(0, 32) }),
                                ...(input.moodName === undefined ? {} : { moodName: String(input.moodName).slice(0, 32) }),
                                ...(input.weatherName === undefined ? {} : { weatherName: String(input.weatherName).slice(0, 32) }),
                                ...(input.location === undefined ? {} : { location: String(input.location).slice(0, 80) }),
                            },
                        },
                    },
                    ...(assetIds && ordered
                        ? {
                            assets: {
                                deleteMany: {},
                                create: ordered.map((f, idx) => ({ fileId: f.id, sort: idx, usage: 'attachment' })),
                            },
                        }
                        : {}),
                    ...(tagRows
                        ? {
                            tags: {
                                deleteMany: {},
                                create: tagRows.map((t) => ({ tagId: t.id })),
                            },
                        }
                        : {}),
                },
            });
            app_log_1.appLog.info('note', `编辑瞬间成功：${existing.id}`, `正文 ${charCount} 字 ｜ 附件 ${finalFiles.length} 个（${mediaKind}）`, ip);
            return { id: existing.id };
        }
        catch (err) {
            app_log_1.appLog.error('note', '编辑瞬间失败', `${err.message} ｜ ID=${existing.id}`, ip);
            return { error: `保存失败：${err.message}` };
        }
    }
    async findOwned(id, viewer, _isAdmin) {
        const row = await prisma_1.prisma.note.findUnique({ where: { id: String(id || '') } });
        if (!row)
            return { error: '瞬间不存在' };
        if (row.author !== viewer)
            return { error: '无权操作他人的瞬间' };
        return { row };
    }
    async softDelete(id, viewer, isAdmin, ip) {
        const hit = await this.findOwned(id, viewer, isAdmin);
        if ('error' in hit)
            return { error: hit.error };
        await prisma_1.prisma.note.update({
            where: { id: hit.row.id },
            data: { status: 'deleted', deletedAt: new Date() },
        });
        app_log_1.appLog.info('note', `瞬间移入回收站：${hit.row.id}`, `作者=${hit.row.author}`, ip);
        return { id: hit.row.id };
    }
    async restore(id, viewer, isAdmin, ip) {
        const hit = await this.findOwned(id, viewer, isAdmin);
        if ('error' in hit)
            return { error: hit.error };
        await prisma_1.prisma.note.update({
            where: { id: hit.row.id },
            data: { status: 'published', deletedAt: null },
        });
        app_log_1.appLog.info('note', `恢复瞬间：${hit.row.id}`, `作者=${hit.row.author}`, ip);
        return { id: hit.row.id };
    }
    async purge(id, viewer, isAdmin, ip) {
        const hit = await this.findOwned(id, viewer, isAdmin);
        if ('error' in hit)
            return { error: hit.error };
        await prisma_1.prisma.note.delete({ where: { id: hit.row.id } });
        app_log_1.appLog.info('note', `彻底删除瞬间：${hit.row.id}`, `作者=${hit.row.author}`, ip);
        return { ok: true };
    }
    async tagCandidates(instanceId, viewer) {
        const rows = await prisma_1.prisma.tag.findMany({
            where: {
                ...(0, tags_1.tagScope)(instanceId, tags_1.TAG_TYPE_NOTE, viewer),
                noteTags: { some: { note: { author: String(viewer || '') } } },
            },
            select: {
                id: true,
                name: true,
                noteTags: { select: { noteId: true }, where: { note: { author: String(viewer || '') } } },
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
        });
        return rows
            .map((r) => ({ id: r.id, name: r.name, count: (r.noteTags || []).length }))
            .filter((r) => r.count > 0)
            .sort((a, b) => b.count - a.count);
    }
    async tagAdmin(instanceId, kind, viewer) {
        const where = (0, tags_1.tagScope)(instanceId, tags_1.TAG_TYPE_NOTE, viewer);
        const tags = await prisma_1.prisma.tag.findMany({ where: where, orderBy: { createdAt: 'asc' } });
        if (!tags.length)
            return [];
        const links = await prisma_1.prisma.noteTag.findMany({
            where: {
                tagId: { in: tags.map((t) => t.id) },
                note: { author: String(viewer || '') },
            },
            select: { tagId: true, note: { select: { kind: true } } },
        });
        const byTag = new Map();
        for (const l of links) {
            const noteKind = String(l.note?.kind || '');
            const bucket = byTag.get(l.tagId) || new Map();
            bucket.set(noteKind, (bucket.get(noteKind) || 0) + 1);
            byTag.set(l.tagId, bucket);
        }
        const out = tags.map((t) => {
            const bucket = byTag.get(t.id) || new Map();
            const kindCounts = {};
            for (const [k, v] of bucket.entries())
                kindCounts[k] = v;
            return {
                id: t.id,
                name: t.name,
                count: Array.from(bucket.values()).reduce((a, b) => a + b, 0),
                kindCounts,
                note: String((0, notes_util_1.safeParse)(t.metas).note || ''),
                creator: t.owner || '',
                createdAt: new Date(t.createdAt).getTime(),
            };
        })
            .filter((t) => t.count > 0);
        if (!kind)
            return out;
        return out
            .filter((t) => (t.kindCounts[kind] || 0) > 0)
            .map((t) => ({ ...t, count: t.kindCounts[kind] }));
    }
    async accessibleNote(id, viewer, _isAdmin, instanceId) {
        const select = { id: true, author: true, status: true, instanceId: true, metas: true };
        const own = await prisma_1.prisma.note.findFirst({
            where: {
                id: String(id || ''),
                instanceId: String(instanceId || ''),
                author: String(viewer || ''),
            },
            select,
        });
        if (own)
            return own;
        return prisma_1.prisma.note.findFirst({
            where: {
                id: String(id || ''),
                status: 'published',
                visibility: 'public',
            },
            select,
        });
    }
    async listComments(input) {
        const note = await this.accessibleNote(input.noteId, input.viewer, input.isAdmin, input.instanceId);
        if (!note)
            return { error: '瞬间不存在或无权查看' };
        const page = Math.max(1, Math.floor(Number(input.page) || 1));
        const pageSize = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize) || 20)));
        const [total, rows] = await Promise.all([
            prisma_1.prisma.noteComment.count({ where: { noteId: note.id } }),
            prisma_1.prisma.noteComment.findMany({
                where: { noteId: note.id },
                orderBy: { createdAt: 'asc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ]);
        return {
            total,
            page,
            pageSize,
            list: this.shapeComments(rows, input.viewer),
        };
    }
    async addComment(input) {
        const note = await this.accessibleNote(input.noteId, input.viewer, input.isAdmin, input.instanceId);
        if (!note)
            return { error: '瞬间不存在或无权留言' };
        const content = String(input.content ?? '').trim();
        if (!content)
            return { error: '留言内容不能为空' };
        const charCount = (0, notes_util_1.countCommentChars)(content);
        if (charCount > notes_util_1.MAX_COMMENT_CHARS) {
            return { error: `留言超出上限：当前 ${charCount} 字，上限 ${notes_util_1.MAX_COMMENT_CHARS} 字（标点与符号不计入）` };
        }
        const created = await prisma_1.prisma.noteComment.create({
            data: {
                noteId: note.id,
                content,
                charCount,
                author: input.viewer,
                instanceId: note.instanceId || '',
            },
        });
        app_log_1.appLog.info('note', `瞬间留言：${note.id}`, `${charCount} 字 ｜ 留言人=${input.viewer}`, input.ip);
        const [view] = this.shapeComments([created], input.viewer);
        return { id: created.id, comment: view };
    }
    async deleteComment(id, viewer, _isAdmin, ip) {
        const row = await prisma_1.prisma.noteComment.findUnique({ where: { id: String(id || '') } });
        if (!row)
            return { error: '留言不存在' };
        if (row.author !== viewer)
            return { error: '无权删除他人的留言' };
        await prisma_1.prisma.noteComment.delete({ where: { id: row.id } });
        app_log_1.appLog.info('note', `删除瞬间留言：${row.noteId}`, `留言人=${row.author}`, ip);
        return { ok: true };
    }
    async pickLocations(viewer, instanceId, q) {
        const me = String(viewer || '');
        if (!me)
            return [];
        const keyword = String(q || '').trim();
        const rows = await prisma_1.prisma.noteMoment.findMany({
            where: {
                location: keyword ? { contains: keyword, mode: 'insensitive' } : { not: '' },
                note: {
                    kind: 'moment',
                    status: { not: 'deleted' },
                    author: me,
                    instanceId: String(instanceId || ''),
                },
            },
            select: { location: true, note: { select: { publishedAt: true, createdAt: true } } },
            orderBy: [{ note: { publishedAt: 'desc' } }, { note: { createdAt: 'desc' } }],
            take: 200,
        });
        const seen = new Set();
        const out = [];
        for (const r of rows) {
            const v = String(r.location || '').trim();
            if (!v)
                continue;
            const key = v.toLowerCase();
            if (seen.has(key))
                continue;
            seen.add(key);
            out.push(v);
            if (out.length >= 20)
                break;
        }
        return out;
    }
    async pickFiles(input) {
        const page = Math.max(1, Math.floor(Number(input.page) || 1));
        const pageSize = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize) || 24)));
        const where = {
            status: 'active',
            instanceId: String(input.instanceId || ''),
        };
        where.uploader = String(input.viewer || '');
        const kw = String(input.search || '').trim();
        if (kw) {
            const contains = { contains: kw, mode: 'insensitive' };
            const scope = String(input.searchScope || 'all').toLowerCase();
            const byScope = {
                title: [{ originalName: contains }, { name: contains }],
                tag: [{ tags: { some: { tag: { name: contains } } } }],
                category: [{ folder: contains }],
                user: [{ uploader: contains }],
                note: [{ note: contains }],
                other: [{ md5: contains }, { mime: contains }, { ip: { contains: kw } }],
            };
            where.OR =
                scope !== 'all' && byScope[scope]
                    ? byScope[scope]
                    : [
                        { originalName: contains },
                        { name: contains },
                        { md5: contains },
                        { folder: contains },
                        { tags: { some: { tag: { name: contains } } } },
                        { mime: contains },
                        { uploader: contains },
                    ];
        }
        const type = String(input.type || '');
        if (type === 'image')
            where.mime = { startsWith: 'image/' };
        else if (type === 'video')
            where.mime = { startsWith: 'video/' };
        else if (type === 'audio')
            where.mime = { startsWith: 'audio/' };
        else if (type === 'other') {
            where.NOT = [
                { mime: { startsWith: 'image/' } },
                { mime: { startsWith: 'video/' } },
                { mime: { startsWith: 'audio/' } },
            ];
        }
        const filterOpts = (0, file_filter_1.parseFileFilterQuery)(input.filterQuery || {});
        const mmRaw = String(input.matchMode || '').toLowerCase();
        const matchMode = mmRaw === 'any' || mmRaw === 'or' ? 'any' : 'all';
        const sortBy = String(input.sortBy || 'time');
        const sortDir = String(input.order || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
        const orderBy = sortBy === 'size'
            ? { size: sortDir }
            : sortBy === 'name'
                ? { originalName: sortDir }
                : sortBy === 'type'
                    ? { mime: sortDir }
                    : { createdAt: sortDir };
        if (!(0, file_filter_1.isEmptyFileFilter)(filterOpts)) {
            const rows = await prisma_1.prisma.fileRecord.findMany({
                where: where,
                orderBy,
                take: 2000,
                include: {
                    copies: { include: { channel: true } },
                    tags: { include: { tag: true } },
                },
            });
            if (filterOpts.hasRef.length || filterOpts.hasShare.length) {
                const statsMap = await (0, file_share_stats_1.syncFileStats)(rows.map((r) => r.id), false);
                for (const r of rows) {
                    const st = statsMap.get(r.id);
                    if (!st)
                        continue;
                    r.refCount = st.ref;
                    r.shareCount = st.share;
                }
            }
            const filtered = rows.filter((r) => (0, file_filter_1.passesFileFilters)(r, filterOpts, matchMode));
            const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
            return {
                total: filtered.length,
                page,
                pageSize,
                filtered: true,
                list: slice.map((r) => this.pickFileRow(r)),
            };
        }
        const [total, rows] = await Promise.all([
            prisma_1.prisma.fileRecord.count({ where: where }),
            prisma_1.prisma.fileRecord.findMany({
                where: where,
                orderBy,
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: { ...FILE_SELECT, createdAt: true },
            }),
        ]);
        return {
            total,
            page,
            pageSize,
            list: rows.map((r) => this.pickFileRow(r)),
        };
    }
    pickFileRow(r) {
        const kind = (0, notes_util_1.mediaKindOfMime)(r.mime);
        return {
            id: r.id,
            name: r.name,
            originalName: r.originalName,
            mime: r.mime,
            size: r.size,
            mediaKind: kind,
            url: (0, notes_util_1.fileUrlOf)(r.name),
            thumbUrl: (0, notes_util_1.fileUrlOf)(r.name, kind === 'image' ? 320 : undefined),
            createdAt: new Date(r.createdAt).getTime(),
            fileType: (0, file_view_1.fileTypeOf)(r.mime),
        };
    }
    readMetas(raw) {
        return (0, notes_util_1.safeParse)(raw, {});
    }
    noteSettingsKey(instanceId) {
        const id = String(instanceId || '').trim();
        return `note-settings:${id || '~default'}`;
    }
    async getNoteSettings(instanceId) {
        const key = this.noteSettingsKey(instanceId);
        let raw = '';
        try {
            const row = await prisma_1.prisma.setting.findUnique({ where: { key } });
            raw = String(row?.value || '');
        }
        catch (e) {
            app_log_1.appLog.warn('notes', `读取笔记设置失败（${key}）：${e?.message || e}`);
        }
        return (0, notes_util_1.normalizeNoteSettings)((0, notes_util_1.safeParse)(raw, {}));
    }
    async saveNoteSettings(instanceId, patch) {
        const key = this.noteSettingsKey(instanceId);
        const current = await this.getNoteSettings(instanceId);
        const p = patch && typeof patch === 'object' ? patch : {};
        const merged = { ...current, ...p };
        if (p.moment && typeof p.moment === 'object') {
            merged.moment = {
                ...current.moment,
                ...p.moment,
            };
        }
        if (p.general && typeof p.general === 'object') {
            merged.general = {
                ...(current.general || {}),
                ...p.general,
            };
        }
        const next = (0, notes_util_1.normalizeNoteSettings)(merged);
        const rawBg = merged.general?.pageBg;
        if (rawBg !== undefined && String(rawBg).trim() && !next.general.pageBg) {
            app_log_1.appLog.warn('notes', '笔记页背景图地址全部无效，已忽略', String(rawBg).slice(0, 300));
        }
        const value = JSON.stringify(next);
        await prisma_1.prisma.setting.upsert({
            where: { key },
            update: { value },
            create: { key, value },
        });
        app_log_1.appLog.info('notes', `笔记设置已更新（${key}）：${value}`);
        return next;
    }
};
exports.NotesService = NotesService;
exports.NotesService = NotesService = __decorate([
    (0, common_1.Injectable)()
], NotesService);
