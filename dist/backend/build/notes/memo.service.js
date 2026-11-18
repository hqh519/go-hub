"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoService = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const app_log_1 = require("../common/app-log");
const notes_util_1 = require("./notes.util");
const tags_1 = require("../common/tags");
const memo_util_1 = require("./memo.util");
const memo_block_util_1 = require("./memo-block.util");
const MAX_TITLE = 200;
const MAX_HISTORY = 100;
const MAX_FOLDER_NAME = 60;
const MAX_FOLDER_DEPTH = 200;
function asInt(v, fallback = 0) {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? n : fallback;
}
function timeOf(v) {
    if (!v)
        return 0;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
}
let MemoService = class MemoService {
    async listFolders(viewer, instanceId) {
        const where = { author: viewer, instanceId };
        const [folders, counts] = await Promise.all([
            prisma_1.prisma.memoFolder.findMany({ where, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
            prisma_1.prisma.note.groupBy({
                by: ['folderId'],
                where: { ...where, kind: 'memo', status: { not: 'deleted' } },
                _count: { _all: true },
            }),
        ]);
        const direct = new Map();
        let unfiled = 0;
        for (const g of counts) {
            const key = String(g.folderId || '');
            const n = asInt(g._count?._all);
            if (!key)
                unfiled += n;
            else
                direct.set(key, n);
        }
        const list = folders.map((f) => ({
            id: String(f.id),
            name: String(f.name || ''),
            parentId: String(f.parentId || ''),
            sort: asInt(f.sort),
            count: direct.get(String(f.id)) || 0,
            total: 0,
            createdAt: timeOf(f.createdAt),
            updatedAt: timeOf(f.updatedAt),
        }));
        const byId = new Map(list.map((f) => [f.id, f]));
        for (const f of list)
            f.total = f.count;
        for (const f of list) {
            let pid = f.parentId;
            let guard = 0;
            while (pid && byId.has(pid) && guard < MAX_FOLDER_DEPTH + 1) {
                byId.get(pid).total += f.count;
                pid = byId.get(pid).parentId;
                guard += 1;
            }
        }
        return { folders: list, unfiled };
    }
    async assertParent(viewer, instanceId, parentId, selfId = '') {
        const pid = String(parentId || '');
        if (!pid)
            return '';
        if (selfId && pid === selfId)
            return '__self__';
        const row = await prisma_1.prisma.memoFolder.findFirst({
            where: { id: pid, author: viewer, instanceId },
            select: { id: true, parentId: true },
        });
        if (!row)
            return '__missing__';
        if (!selfId)
            return pid;
        let cur = String(row.parentId || '');
        let guard = 0;
        while (cur && guard < MAX_FOLDER_DEPTH + 1) {
            if (cur === selfId) {
                app_log_1.appLog.warn('memo', `拒绝目录移动：${selfId} 试图挂到自己的子孙 ${pid} 下（会形成环）`);
                return '__cycle__';
            }
            const next = await prisma_1.prisma.memoFolder.findFirst({
                where: { id: cur, author: viewer, instanceId },
                select: { parentId: true },
            });
            cur = String(next?.parentId || '');
            guard += 1;
        }
        return pid;
    }
    async createFolder(viewer, instanceId, input) {
        const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME);
        if (!name)
            return { error: '目录名不能为空' };
        const parentId = await this.assertParent(viewer, instanceId, String(input.parentId ?? ''));
        if (parentId === '__missing__')
            return { error: '上级目录不存在' };
        if (parentId === '__self__' || parentId === '__cycle__')
            return { error: '上级目录不合法' };
        const last = await prisma_1.prisma.memoFolder.findFirst({
            where: { author: viewer, instanceId, parentId },
            orderBy: { sort: 'desc' },
            select: { sort: true },
        });
        const row = await prisma_1.prisma.memoFolder.create({
            data: { name, parentId, author: viewer, instanceId, sort: asInt(last?.sort) + 1 },
        });
        return { folder: { ...row, count: 0, total: 0 } };
    }
    async updateFolder(viewer, instanceId, id, input) {
        const row = await prisma_1.prisma.memoFolder.findFirst({ where: { id, author: viewer, instanceId } });
        if (!row)
            return { error: '目录不存在' };
        const data = {};
        if (input.name !== undefined) {
            const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME);
            if (!name)
                return { error: '目录名不能为空' };
            data.name = name;
        }
        if (input.parentId !== undefined) {
            const parentId = await this.assertParent(viewer, instanceId, String(input.parentId ?? ''), id);
            if (parentId === '__missing__')
                return { error: '上级目录不存在' };
            if (parentId === '__self__' || parentId === '__cycle__')
                return { error: '不能把目录移动到它自己或它的子目录下' };
            data.parentId = parentId;
        }
        if (input.sort !== undefined)
            data.sort = asInt(input.sort);
        const next = await prisma_1.prisma.memoFolder.update({ where: { id }, data });
        return { folder: next };
    }
    async deleteFolder(viewer, instanceId, id) {
        const row = await prisma_1.prisma.memoFolder.findFirst({ where: { id, author: viewer, instanceId } });
        if (!row)
            return { error: '目录不存在' };
        const parentId = String(row.parentId || '');
        const movedNotes = await prisma_1.prisma.note.updateMany({
            where: { author: viewer, instanceId, kind: 'memo', folderId: id },
            data: { folderId: parentId },
        });
        const movedFolders = await prisma_1.prisma.memoFolder.updateMany({
            where: { author: viewer, instanceId, parentId: id },
            data: { parentId },
        });
        await prisma_1.prisma.memoFolder.delete({ where: { id } });
        app_log_1.appLog.info('memo', `删除笔记目录 ${id}（上浮笔记 ${movedNotes.count} 篇 / 子目录 ${movedFolders.count} 个）`);
        return { movedNotes: movedNotes.count, movedFolders: movedFolders.count };
    }
    async reorderFolders(viewer, instanceId, parentId, ids) {
        const list = Array.isArray(ids) ? ids.map((x) => String(x)).filter(Boolean) : [];
        if (!list.length)
            return { updated: 0 };
        const rows = await prisma_1.prisma.memoFolder.findMany({
            where: { id: { in: list }, author: viewer, instanceId, parentId: String(parentId || '') },
            select: { id: true },
        });
        const ok = new Set(rows.map((r) => String(r.id)));
        const ops = list.filter((id) => ok.has(id)).map((id, i) => prisma_1.prisma.memoFolder.update({ where: { id }, data: { sort: i } }));
        if (ops.length)
            await prisma_1.prisma.$transaction(ops);
        return { updated: ops.length };
    }
    LIST_SELECT = {
        id: true,
        title: true,
        folderId: true,
        version: true,
        status: true,
        metas: true,
        createdAt: true,
        updatedAt: true,
    };
    async listNotes(input) {
        const { viewer, instanceId } = input;
        const page = Math.max(1, asInt(input.page, 1));
        const pageSize = Math.min(200, Math.max(1, asInt(input.pageSize, 50)));
        const where = { author: viewer, instanceId, kind: 'memo' };
        const folderId = String(input.folderId ?? '');
        if (folderId === '__root')
            where.folderId = '';
        else if (folderId)
            where.folderId = folderId;
        const status = String(input.status ?? '');
        where.status = status === 'deleted' ? 'deleted' : { not: 'deleted' };
        const search = String(input.search ?? '').trim();
        if (search) {
            where.OR = [{ title: { contains: search, mode: 'insensitive' } }, { metas: { contains: search } }];
        }
        const [total, rows] = await Promise.all([
            prisma_1.prisma.note.count({ where: where }),
            prisma_1.prisma.note.findMany({
                where: where,
                orderBy: [{ updatedAt: 'desc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: this.LIST_SELECT,
            }),
        ]);
        const needWord = rows
            .filter((r) => (0, notes_util_1.safeParse)(r.metas, {}).wordCount == null)
            .map((r) => String(r.id));
        let wordMap = null;
        if (needWord.length) {
            const full = await prisma_1.prisma.note.findMany({
                where: { id: { in: needWord } },
                select: { id: true, content: true },
            });
            wordMap = new Map(full.map((f) => [String(f.id), (0, memo_util_1.countMemoWords)(f.content)]));
        }
        const list = rows.map((r) => {
            const metas = (0, notes_util_1.safeParse)(r.metas, {});
            const id = String(r.id);
            return {
                id,
                title: String(r.title || ''),
                excerpt: String(metas.excerpt || ''),
                folderId: String(r.folderId || ''),
                charCount: asInt(metas.charCount),
                wordCount: metas.wordCount != null
                    ? asInt(metas.wordCount)
                    : wordMap && wordMap.has(id)
                        ? wordMap.get(id)
                        : null,
                version: asInt(r.version, 1),
                status: String(r.status || ''),
                createdAt: timeOf(r.createdAt),
                updatedAt: timeOf(r.updatedAt),
            };
        });
        return { total, page, pageSize, list };
    }
    async getNote(viewer, instanceId, id) {
        const row = await prisma_1.prisma.note.findFirst({
            where: { id, author: viewer, instanceId, kind: 'memo' },
        });
        if (!row)
            return null;
        return {
            id: row.id,
            title: String(row.title || ''),
            content: String(row.content || ''),
            contentFormat: String(row.contentFormat || ''),
            folderId: String(row.folderId || ''),
            version: asInt(row.version, 1),
            status: String(row.status || ''),
            createdAt: timeOf(row.createdAt),
            updatedAt: timeOf(row.updatedAt),
        };
    }
    async blockIdsEnabled(instanceId, viewer = '') {
        try {
            const userKey = `note-editor:${instanceId || '~default'}:${viewer || '~anon'}`;
            const instKey = `note-settings:${instanceId || '~default'}`;
            const rows = await prisma_1.prisma.setting.findMany({ where: { key: { in: [userKey, instKey] } } });
            const userAll = (0, notes_util_1.safeParse)(rows.find((r) => r.key === userKey)?.value, {});
            if (typeof userAll?.blockIds === 'boolean') {
                return userAll.blockIds === true;
            }
            const instAll = (0, notes_util_1.safeParse)(rows.find((r) => r.key === instKey)?.value, {});
            const editor = (instAll.editor && typeof instAll.editor === 'object' ? instAll.editor : {});
            return editor.blockIds === true;
        }
        catch (e) {
            return false;
        }
    }
    async createNote(viewer, instanceId, input) {
        const md = String(input.content ?? '');
        const useIds = await this.blockIdsEnabled(instanceId, viewer);
        const content = useIds ? (0, memo_util_1.withBlockIds)(md) : md;
        const title = String(input.title ?? '').trim().slice(0, MAX_TITLE) || (0, memo_util_1.titleFromContent)(content, MAX_TITLE);
        const folderId = String(input.folderId ?? '');
        if (folderId) {
            const ok = await prisma_1.prisma.memoFolder.findFirst({ where: { id: folderId, author: viewer, instanceId }, select: { id: true } });
            if (!ok)
                return { error: '目录不存在' };
        }
        const row = await prisma_1.prisma.note.create({
            data: {
                kind: 'memo',
                title,
                content,
                contentFormat: 'markdown',
                folderId,
                author: viewer,
                instanceId,
                visibility: 'private',
                status: 'published',
                publishedAt: new Date(),
                firstPublishedAt: new Date(),
                metas: JSON.stringify({ excerpt: (0, memo_util_1.excerptOf)(content), charCount: (0, memo_util_1.countMemoChars)(content), wordCount: (0, memo_util_1.countMemoWords)(content) }),
            },
        });
        await this.rebuildNoteIndex(row.id, content, viewer, instanceId);
        return { id: row.id, version: asInt(row.version, 1), createdAt: timeOf(row.createdAt) };
    }
    async saveNote(viewer, instanceId, id, input) {
        const row = await prisma_1.prisma.note.findFirst({
            where: { id, author: viewer, instanceId, kind: 'memo' },
            select: { id: true, version: true, content: true, folderId: true, title: true },
        });
        if (!row)
            return { error: '笔记不存在' };
        const expect = asInt(input.version, 0);
        if (expect && expect !== asInt(row.version, 1)) {
            app_log_1.appLog.warn('memo', `保存冲突：笔记 ${id} 期望版本 ${expect}，库内 ${row.version}`);
            return { conflict: true, version: asInt(row.version, 1), message: '这篇笔记已在别处被修改，请刷新后重试' };
        }
        const md = String(input.content ?? row.content ?? '');
        const useIds = await this.blockIdsEnabled(instanceId, viewer);
        const content = useIds ? (0, memo_util_1.withBlockIds)(md) : md;
        const title = input.title !== undefined
            ? String(input.title ?? '').trim().slice(0, MAX_TITLE)
            : String(row.title || '');
        const data = {
            content,
            contentFormat: 'markdown',
            title: title || (0, memo_util_1.titleFromContent)(content, MAX_TITLE),
            version: { increment: 1 },
            metas: JSON.stringify({ excerpt: (0, memo_util_1.excerptOf)(content), charCount: (0, memo_util_1.countMemoChars)(content) }),
        };
        if (input.folderId !== undefined) {
            const folderId = String(input.folderId ?? '');
            if (folderId) {
                const ok = await prisma_1.prisma.memoFolder.findFirst({
                    where: { id: folderId, author: viewer, instanceId },
                    select: { id: true },
                });
                if (!ok)
                    return { error: '目录不存在' };
            }
            data.folderId = folderId;
        }
        const next = await prisma_1.prisma.note.update({ where: { id }, data: data, select: { version: true, updatedAt: true } });
        await this.rebuildNoteIndex(id, content, viewer, instanceId);
        return { version: asInt(next.version, 1), updatedAt: timeOf(next.updatedAt) };
    }
    async moveNote(viewer, instanceId, id, folderId) {
        const row = await prisma_1.prisma.note.findFirst({ where: { id, author: viewer, instanceId, kind: 'memo' }, select: { id: true } });
        if (!row)
            return { error: '笔记不存在' };
        const target = String(folderId ?? '');
        if (target) {
            const ok = await prisma_1.prisma.memoFolder.findFirst({ where: { id: target, author: viewer, instanceId }, select: { id: true } });
            if (!ok)
                return { error: '目录不存在' };
        }
        await prisma_1.prisma.note.update({ where: { id }, data: { folderId: target } });
        return { ok: true, folderId: target };
    }
    async trash(viewer, instanceId, id) {
        const row = await prisma_1.prisma.note.findFirst({ where: { id, author: viewer, instanceId, kind: 'memo' }, select: { id: true } });
        if (!row)
            return { error: '笔记不存在' };
        await prisma_1.prisma.note.update({ where: { id }, data: { status: 'deleted', deletedAt: new Date() } });
        return { ok: true };
    }
    async restore(viewer, instanceId, id) {
        const row = await prisma_1.prisma.note.findFirst({ where: { id, author: viewer, instanceId, kind: 'memo' }, select: { id: true } });
        if (!row)
            return { error: '笔记不存在' };
        await prisma_1.prisma.note.update({ where: { id }, data: { status: 'published', deletedAt: null } });
        return { ok: true };
    }
    async purge(viewer, instanceId, id) {
        const row = await prisma_1.prisma.note.findFirst({ where: { id, author: viewer, instanceId, kind: 'memo' }, select: { id: true } });
        if (!row)
            return { error: '笔记不存在' };
        await prisma_1.prisma.note.delete({ where: { id } });
        app_log_1.appLog.info('memo', `彻底删除笔记 ${id}`);
        await prisma_1.prisma.noteBlock.deleteMany({ where: { noteId: id } }).catch(() => undefined);
        await prisma_1.prisma.noteLink.deleteMany({ where: { OR: [{ sourceNoteId: id }, { targetNoteId: id }] } }).catch(() => undefined);
        await prisma_1.prisma.noteHistory.deleteMany({ where: { noteId: id } }).catch(() => undefined);
        return { ok: true };
    }
    async rebuildNoteIndex(noteId, md, viewer, instanceId) {
        try {
            const parsed = (0, memo_block_util_1.parseBlocks)(md);
            const old = await prisma_1.prisma.noteBlock.findMany({
                where: { noteId },
                select: { blockId: true, contentHash: true },
            });
            const pool = new Map();
            for (const b of old) {
                const arr = pool.get(b.contentHash) || [];
                arr.push(b.blockId);
                pool.set(b.contentHash, arr);
            }
            const used = new Set();
            const idMap = new Map();
            for (const b of parsed) {
                if (b.explicit) {
                    used.add(b.blockId);
                    idMap.set(b.blockId, b.blockId);
                    continue;
                }
                const cands = pool.get(b.contentHash) || [];
                const pick = cands.find((id) => !used.has(id));
                const finalId = pick || b.blockId;
                used.add(finalId);
                idMap.set(b.blockId, finalId);
                b.blockId = finalId;
            }
            for (const b of parsed) {
                if (b.parentBlockId)
                    b.parentBlockId = idMap.get(b.parentBlockId) || b.parentBlockId;
            }
            const links = (0, memo_block_util_1.parseLinks)(md).filter((l) => l.targetNoteId || l.targetBlockId);
            await prisma_1.prisma.noteBlock.deleteMany({ where: { noteId } });
            if (parsed.length) {
                await prisma_1.prisma.noteBlock.createMany({
                    data: parsed.map((b) => ({
                        noteId,
                        blockId: b.blockId,
                        blockType: b.blockType,
                        parentBlockId: b.parentBlockId,
                        blockOrder: b.blockOrder,
                        depth: b.depth,
                        plainText: b.plainText.slice(0, 2000),
                        contentHash: b.contentHash,
                        headingLevel: b.headingLevel,
                        author: viewer,
                        instanceId,
                    })),
                });
            }
            await prisma_1.prisma.noteLink.deleteMany({ where: { sourceNoteId: noteId } });
            if (links.length) {
                await prisma_1.prisma.noteLink.createMany({
                    data: links.map((l) => ({
                        sourceNoteId: noteId,
                        targetNoteId: l.targetNoteId,
                        targetBlockId: l.targetBlockId,
                        linkType: l.linkType,
                        excerpt: l.excerpt,
                        author: viewer,
                        instanceId,
                    })),
                });
            }
            return { blocks: parsed.length, links: links.length };
        }
        catch (e) {
            app_log_1.appLog.warn('memo', `块索引重建失败（笔记 ${noteId}）：${e?.message || e}`);
            return { blocks: 0, links: 0, error: true };
        }
    }
    async listBlocks(noteId, viewer, instanceId) {
        const note = await prisma_1.prisma.note.findFirst({
            where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
            select: { id: true },
        });
        if (!note)
            return { error: '笔记不存在' };
        const blocks = await prisma_1.prisma.noteBlock.findMany({
            where: { noteId },
            orderBy: { blockOrder: 'asc' },
        });
        return {
            blocks: blocks.map((b) => ({
                blockId: b.blockId,
                blockType: b.blockType,
                parentBlockId: b.parentBlockId,
                blockOrder: b.blockOrder,
                depth: b.depth,
                plainText: b.plainText,
                headingLevel: b.headingLevel,
            })),
        };
    }
    async resolveBlock(blockId, viewer, instanceId) {
        const block = await prisma_1.prisma.noteBlock.findFirst({
            where: { blockId, author: viewer, instanceId },
        });
        if (!block)
            return { error: '源块已删除或无权访问' };
        const note = await prisma_1.prisma.note.findFirst({
            where: { id: block.noteId, author: viewer, instanceId },
            select: { id: true, title: true, status: true },
        });
        if (!note || note.status === 'deleted')
            return { error: '源块已删除或无权访问' };
        return {
            blockId: block.blockId,
            noteId: note.id,
            noteTitle: note.title,
            blockType: block.blockType,
            plainText: block.plainText,
        };
    }
    async backlinks(noteId, viewer, instanceId) {
        const note = await prisma_1.prisma.note.findFirst({
            where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
            select: { id: true },
        });
        if (!note)
            return { error: '笔记不存在' };
        const ownBlocks = await prisma_1.prisma.noteBlock.findMany({ where: { noteId }, select: { blockId: true } });
        const ids = ownBlocks.map((b) => b.blockId);
        const links = await prisma_1.prisma.noteLink.findMany({
            where: {
                author: viewer,
                instanceId,
                sourceNoteId: { not: noteId },
                OR: [{ targetNoteId: noteId }, ...(ids.length ? [{ targetBlockId: { in: ids } }] : [])],
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
        });
        const sourceIds = Array.from(new Set(links.map((l) => l.sourceNoteId)));
        const sources = sourceIds.length
            ? await prisma_1.prisma.note.findMany({
                where: { id: { in: sourceIds }, author: viewer, instanceId, status: { not: 'deleted' } },
                select: { id: true, title: true },
            })
            : [];
        const titleOf = new Map(sources.map((s) => [s.id, s.title]));
        return {
            backlinks: links
                .filter((l) => titleOf.has(l.sourceNoteId))
                .map((l) => ({
                noteId: l.sourceNoteId,
                noteTitle: titleOf.get(l.sourceNoteId) || '',
                blockId: l.targetBlockId,
                linkType: l.linkType,
                excerpt: l.excerpt,
            })),
        };
    }
    async listNoteTags(viewer, instanceId, noteId) {
        const note = await prisma_1.prisma.note.findFirst({
            where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
            select: { id: true },
        });
        if (!note)
            return { error: '笔记不存在' };
        const links = await prisma_1.prisma.noteTag.findMany({
            where: { noteId },
            select: { tag: { select: { id: true, name: true } } },
        });
        return { tags: links.map((l) => ({ id: l.tag.id, name: l.tag.name })) };
    }
    async setNoteTags(viewer, instanceId, noteId, names) {
        const note = await prisma_1.prisma.note.findFirst({
            where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
            select: { id: true },
        });
        if (!note)
            return { error: '笔记不存在' };
        const list = (0, notes_util_1.normalizeTagNames)(names);
        const tagIds = [];
        for (const name of list) {
            const t = await (0, tags_1.findOrCreateTag)(name, instanceId, viewer, 'note');
            if (t?.id)
                tagIds.push(String(t.id));
        }
        await prisma_1.prisma.noteTag.deleteMany({ where: { noteId } });
        if (tagIds.length) {
            await prisma_1.prisma.noteTag.createMany({
                data: tagIds.map((tagId) => ({ noteId, tagId })),
                skipDuplicates: true,
            });
        }
        return this.listNoteTags(viewer, instanceId, noteId);
    }
    async noteTagCandidates(viewer, instanceId, keyword = '') {
        const kw = String(keyword || '').trim();
        const rows = await prisma_1.prisma.tag.findMany({
            where: {
                instanceId,
                type: 'note',
                ...(kw ? { name: { contains: kw, mode: 'insensitive' } } : {}),
                OR: [{ scope: String(viewer || '') }, { owner: String(viewer || '') }],
            },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
            take: 50,
        });
        return { tags: rows };
    }
    async pushHistory(viewer, instanceId, noteId, input = {}) {
        const note = await prisma_1.prisma.note.findFirst({
            where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
            select: { id: true, title: true, content: true, version: true },
        });
        if (!note)
            return { error: '笔记不存在' };
        const content = String(input.content ?? note.content ?? '');
        if (!content.trim())
            return { ok: true, skipped: true };
        const last = await prisma_1.prisma.noteHistory.findFirst({
            where: { noteId },
            orderBy: { createdAt: 'desc' },
            select: { content: true },
        });
        if (last && last.content === content)
            return { ok: true, skipped: true };
        const row = await prisma_1.prisma.noteHistory.create({
            data: {
                noteId,
                title: String(input.title ?? note.title ?? '').slice(0, MAX_TITLE),
                content,
                charCount: (0, memo_util_1.countMemoChars)(content),
                version: asInt(input.version, asInt(note.version, 1)),
                author: viewer,
                instanceId,
            },
        });
        const overflow = await prisma_1.prisma.noteHistory.findMany({
            where: { noteId },
            orderBy: { createdAt: 'desc' },
            skip: MAX_HISTORY,
            select: { id: true },
        });
        if (overflow.length) {
            await prisma_1.prisma.noteHistory.deleteMany({ where: { id: { in: overflow.map((o) => o.id) } } });
        }
        return { id: row.id, createdAt: timeOf(row.createdAt) };
    }
    async listHistory(viewer, instanceId, noteId) {
        const note = await prisma_1.prisma.note.findFirst({
            where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
            select: { id: true },
        });
        if (!note)
            return { error: '笔记不存在' };
        const rows = await prisma_1.prisma.noteHistory.findMany({
            where: { noteId },
            orderBy: { createdAt: 'desc' },
            take: MAX_HISTORY,
            select: { id: true, title: true, charCount: true, version: true, createdAt: true },
        });
        return {
            items: rows.map((r) => ({
                id: r.id,
                title: r.title,
                charCount: r.charCount,
                version: r.version,
                createdAt: timeOf(r.createdAt),
            })),
            max: MAX_HISTORY,
        };
    }
    async getHistory(viewer, instanceId, noteId, hid) {
        const note = await prisma_1.prisma.note.findFirst({
            where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
            select: { id: true },
        });
        if (!note)
            return { error: '笔记不存在' };
        const row = await prisma_1.prisma.noteHistory.findFirst({ where: { id: hid, noteId } });
        if (!row)
            return { error: '历史记录不存在（可能已被更早的记录挤出保留范围）' };
        return {
            id: row.id,
            title: row.title,
            content: row.content,
            charCount: row.charCount,
            version: row.version,
            createdAt: timeOf(row.createdAt),
        };
    }
    async restoreHistory(viewer, instanceId, noteId, hid) {
        const note = await prisma_1.prisma.note.findFirst({
            where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
            select: { id: true, title: true, content: true, version: true },
        });
        if (!note)
            return { error: '笔记不存在' };
        const row = await prisma_1.prisma.noteHistory.findFirst({ where: { id: hid, noteId } });
        if (!row)
            return { error: '历史记录不存在' };
        await this.pushHistory(viewer, instanceId, noteId, { content: note.content, title: note.title });
        const useIds = await this.blockIdsEnabled(instanceId, viewer);
        const content = useIds ? (0, memo_util_1.withBlockIds)(row.content) : row.content;
        const next = await prisma_1.prisma.note.update({
            where: { id: noteId },
            data: {
                content,
                title: row.title || String(note.title || ''),
                version: { increment: 1 },
                metas: JSON.stringify({ excerpt: (0, memo_util_1.excerptOf)(content), charCount: (0, memo_util_1.countMemoChars)(content), wordCount: (0, memo_util_1.countMemoWords)(content) }),
            },
            select: { version: true, updatedAt: true },
        });
        await this.rebuildNoteIndex(noteId, content, viewer, instanceId);
        app_log_1.appLog.info('memo', `笔记 ${noteId} 恢复到历史 ${hid}`);
        return {
            version: asInt(next.version, 1),
            content,
            title: row.title || '',
            updatedAt: timeOf(next.updatedAt),
        };
    }
    async rebuildAllIndex(viewer, instanceId) {
        const notes = await prisma_1.prisma.note.findMany({
            where: { author: viewer, instanceId, kind: 'memo', status: { not: 'deleted' } },
            select: { id: true, content: true },
        });
        let blocks = 0;
        for (const n of notes) {
            const r = await this.rebuildNoteIndex(n.id, String(n.content || ''), viewer, instanceId);
            blocks += r.blocks || 0;
        }
        return { notes: notes.length, blocks };
    }
};
exports.MemoService = MemoService;
exports.MemoService = MemoService = __decorate([
    (0, common_1.Injectable)()
], MemoService);
