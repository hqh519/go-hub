"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refsOfFiles = refsOfFiles;
exports.refsOfFile = refsOfFile;
exports.countBySource = countBySource;
exports.fileReferenceBlockMessage = fileReferenceBlockMessage;
exports.batchReferenceBlockMessage = batchReferenceBlockMessage;
const prisma_1 = require("./prisma");
const notes_util_1 = require("../notes/notes.util");
function normPath(p) {
    return String(p || '').replace(/^\/+|\/+$/g, '');
}
function shareCoversFolder(target, folder) {
    const t = normPath(target);
    const f = normPath(folder);
    if (!t)
        return true;
    return f === t || f.startsWith(`${t}/`);
}
async function noteRefsOf(ids, map) {
    if (!ids.length)
        return map;
    const links = await prisma_1.prisma.noteAsset.findMany({
        where: { fileId: { in: ids } },
        select: {
            fileId: true,
            note: {
                select: { id: true, kind: true, status: true, createdAt: true, author: true, metas: true },
            },
        },
    });
    for (const l of links) {
        const note = l.note;
        if (!note)
            continue;
        const list = map.get(l.fileId) || [];
        list.push({
            source: 'note',
            id: note.id,
            title: String((0, notes_util_1.safeParse)(note.metas).title || ''),
            kind: note.kind,
            status: note.status,
            createdAt: note.createdAt ? new Date(note.createdAt).getTime() : 0,
            author: note.author || '',
            strong: true,
        });
        map.set(l.fileId, list);
    }
    return map;
}
async function shareRefsOf(ids, map) {
    if (!ids.length)
        return map;
    const shares = await prisma_1.prisma.shareLink.findMany({
        where: { enabled: true },
        select: {
            id: true,
            owner: true,
            instanceId: true,
            type: true,
            target: true,
            tagId: true,
            expireAt: true,
            createdAt: true,
        },
    });
    const now = Date.now();
    const alive = shares.filter((s) => !s.expireAt || new Date(s.expireAt).getTime() > now);
    if (!alive.length)
        return map;
    const files = await prisma_1.prisma.fileRecord.findMany({
        where: { id: { in: ids } },
        select: {
            id: true,
            folder: true,
            instanceId: true,
            tags: { select: { tagId: true } },
        },
    });
    for (const f of files) {
        const tagIds = f.tags.map((t) => t.tagId);
        const list = map.get(f.id) || [];
        for (const s of alive) {
            if (String(s.instanceId || '') !== String(f.instanceId || ''))
                continue;
            const hit = s.type === 'tag' ? tagIds.includes(s.tagId) : shareCoversFolder(s.target, f.folder);
            if (!hit)
                continue;
            const isTag = s.type === 'tag';
            list.push({
                source: 'share',
                id: s.id,
                title: isTag ? `#${s.target || ''}` : `/${normPath(s.target)}`,
                kind: s.type || 'cate',
                status: 'active',
                createdAt: s.createdAt ? new Date(s.createdAt).getTime() : 0,
                author: s.owner || '',
                strong: false,
            });
        }
        if (list.length)
            map.set(f.id, list);
    }
    return map;
}
async function refsOfFiles(fileIds) {
    const ids = Array.from(new Set((fileIds || []).map((x) => String(x || '')).filter(Boolean)));
    const map = new Map();
    if (!ids.length)
        return map;
    await noteRefsOf(ids, map);
    try {
        await shareRefsOf(ids, map);
    }
    catch (e) {
        console.warn('[file-refs] 统计分享引用失败：', e?.message || e);
    }
    return map;
}
async function refsOfFile(fileId) {
    const map = await refsOfFiles([fileId]);
    return map.get(String(fileId || '')) || [];
}
function countBySource(refs) {
    let note = 0;
    let share = 0;
    for (const r of refs) {
        if (r.source === 'note')
            note += 1;
        else
            share += 1;
    }
    return { note, share };
}
async function fileReferenceBlockMessage(fileId) {
    const refs = await refsOfFile(fileId);
    return formatRefBlockMessage(refs.filter((r) => r.strong));
}
async function batchReferenceBlockMessage(fileIds) {
    const map = await refsOfFiles(fileIds);
    const all = [];
    for (const list of map.values())
        all.push(...list.filter((r) => r.strong));
    return formatRefBlockMessage(all);
}
function formatRefBlockMessage(refs) {
    if (!refs.length)
        return '';
    const titles = [];
    for (const r of refs) {
        const name = r.title || `未命名（${r.id.slice(-6)}）`;
        if (!titles.includes(name))
            titles.push(name);
    }
    const shown = titles.slice(0, 5).join('、');
    const more = titles.length > 5 ? ` 等 ${titles.length} 篇` : '';
    return `该文件已被笔记引用，无法删除。引用它的笔记：${shown}${more}。请先删除对应笔记后再试。`;
}
