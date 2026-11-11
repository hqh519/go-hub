"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncFileStats = syncFileStats;
exports.fileStats = fileStats;
exports.firstReferenced = firstReferenced;
exports.sharedMembers = sharedMembers;
const prisma_1 = require("./prisma");
function parseUsers(raw) {
    if (Array.isArray(raw))
        return raw.map((x) => String(x || '').trim()).filter(Boolean);
    const s = String(raw ?? '').trim();
    if (!s || s === '[]')
        return [];
    try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr))
            return arr.map((x) => String(x || '').trim()).filter(Boolean);
        return [];
    }
    catch {
        return s.split(',').map((x) => x.trim()).filter(Boolean);
    }
}
function normPath(p) {
    return String(p || '').replace(/^\/+|\/+$/g, '');
}
function covers(target, folder) {
    const t = normPath(target);
    const f = normPath(folder);
    if (!t)
        return true;
    return f === t || f.startsWith(`${t}/`);
}
async function syncFileStats(ids, persist = true) {
    const uniq = Array.from(new Set((ids || []).map((x) => String(x || '')).filter(Boolean)));
    const out = new Map();
    if (!uniq.length)
        return out;
    const files = await prisma_1.prisma.fileRecord.findMany({
        where: { id: { in: uniq } },
        select: {
            id: true,
            folder: true,
            instanceId: true,
            uploader: true,
            refCount: true,
            shareCount: true,
            copies: { select: { channelId: true, remoteKey: true, objectPath: true } },
        },
    });
    if (!files.length)
        return out;
    const noteLinks = await prisma_1.prisma.noteAsset.groupBy({
        by: ['fileId'],
        where: { fileId: { in: files.map((f) => f.id) } },
        _count: { _all: true },
    });
    const noteCount = new Map();
    for (const row of noteLinks)
        noteCount.set(row.fileId, Number(row._count?._all || 0));
    const instances = Array.from(new Set(files.map((f) => String(f.instanceId || ''))));
    const metas = await prisma_1.prisma.folderMeta.findMany({
        where: { type: 'file', instanceId: { in: instances }, sharedUsers: { not: '[]' } },
        select: { owner: true, path: true, instanceId: true, sharedUsers: true },
    });
    const shareRows = metas
        .map((m) => ({
        owner: String(m.owner || ''),
        path: normPath(m.path),
        instanceId: String(m.instanceId || ''),
        users: parseUsers(m.sharedUsers),
    }))
        .filter((m) => m.users.length > 0);
    const refOf = new Map();
    for (const f of files) {
        const folder = normPath(f.folder);
        const inst = String(f.instanceId || '');
        const mine = String(f.uploader || '');
        let shared = 0;
        for (const m of shareRows) {
            if (m.instanceId !== inst)
                continue;
            if (mine && m.owner && m.owner !== mine)
                continue;
            if (!covers(m.path, folder))
                continue;
            shared += m.users.length;
        }
        refOf.set(f.id, (noteCount.get(f.id) || 0) + shared);
    }
    const keyOf = (c) => [
        c.remoteKey ? `${c.channelId}\u0000k\u0000${c.remoteKey}` : '',
        c.objectPath ? `${c.channelId}\u0000p\u0000${c.objectPath}` : '',
    ].filter(Boolean);
    const myKeys = new Map();
    const allKeys = new Set();
    for (const f of files) {
        const set = new Set();
        for (const c of f.copies)
            for (const k of keyOf(c))
                set.add(k);
        myKeys.set(f.id, set);
        for (const k of set)
            allKeys.add(k);
    }
    const shareOf = new Map();
    for (const f of files)
        shareOf.set(f.id, 0);
    if (allKeys.size) {
        const cousins = await prisma_1.prisma.fileCopy.findMany({
            where: {
                OR: Array.from(allKeys).map((k) => {
                    const [channelId, kind, v] = k.split('\u0000');
                    return kind === 'k' ? { channelId, remoteKey: v } : { channelId, objectPath: v };
                }),
            },
            select: { fileId: true, channelId: true, remoteKey: true, objectPath: true },
        });
        const keysByFile = new Map();
        for (const c of cousins) {
            const set = keysByFile.get(c.fileId) || new Set();
            for (const k of keyOf(c))
                set.add(k);
            keysByFile.set(c.fileId, set);
        }
        for (const f of files) {
            const mine = myKeys.get(f.id) || new Set();
            let n = 0;
            for (const [otherId, keys] of keysByFile) {
                if (otherId === f.id)
                    continue;
                let hit = false;
                for (const k of keys) {
                    if (mine.has(k)) {
                        hit = true;
                        break;
                    }
                }
                if (hit)
                    n += 1;
            }
            shareOf.set(f.id, n);
        }
    }
    for (const f of files) {
        const ref = refOf.get(f.id) || 0;
        const share = shareOf.get(f.id) || 0;
        out.set(f.id, { ref, share });
        if (!persist)
            continue;
        if (ref === f.refCount && share === f.shareCount)
            continue;
        try {
            await prisma_1.prisma.fileRecord.update({ where: { id: f.id }, data: { refCount: ref, shareCount: share } });
        }
        catch {
        }
    }
    return out;
}
async function fileStats(fileId) {
    const map = await syncFileStats([fileId]);
    return map.get(String(fileId || '')) || { ref: 0, share: 0 };
}
async function firstReferenced(ids) {
    const uniq = Array.from(new Set((ids || []).map((x) => String(x || '')).filter(Boolean)));
    if (!uniq.length)
        return null;
    const rows = await prisma_1.prisma.fileRecord.findMany({
        where: { id: { in: uniq } },
        select: { id: true, name: true, originalName: true },
    });
    const map = await syncFileStats(rows.map((r) => r.id));
    for (const r of rows) {
        const st = map.get(r.id);
        if (st && st.ref > 0)
            return { id: r.id, name: r.originalName || r.name, ref: st.ref };
    }
    return null;
}
async function sharedMembers(fileId) {
    const me = await prisma_1.prisma.fileRecord.findUnique({
        where: { id: String(fileId || '') },
        select: { id: true, copies: { select: { channelId: true, remoteKey: true, objectPath: true } } },
    });
    if (!me)
        return [];
    const keyOf = (c) => [
        c.remoteKey ? `${c.channelId}\u0000k\u0000${c.remoteKey}` : '',
        c.objectPath ? `${c.channelId}\u0000p\u0000${c.objectPath}` : '',
    ].filter(Boolean);
    const mine = new Set();
    for (const c of me.copies)
        for (const k of keyOf(c))
            mine.add(k);
    if (!mine.size)
        return [];
    const cousins = await prisma_1.prisma.fileCopy.findMany({
        where: {
            fileId: { not: me.id },
            OR: Array.from(mine).map((k) => {
                const [channelId, kind, v] = k.split('\u0000');
                return kind === 'k' ? { channelId, remoteKey: v } : { channelId, objectPath: v };
            }),
        },
        select: {
            channelId: true,
            remoteKey: true,
            objectPath: true,
            file: {
                select: {
                    id: true,
                    name: true,
                    originalName: true,
                    uploader: true,
                    instanceId: true,
                    status: true,
                    createdAt: true,
                    cloneOf: true,
                },
            },
        },
    });
    const seen = new Map();
    for (const c of cousins) {
        const f = c.file;
        if (!f || seen.has(f.id))
            continue;
        const hit = keyOf(c).some((k) => mine.has(k));
        if (!hit)
            continue;
        seen.set(f.id, {
            fileId: f.id,
            name: f.name,
            originalName: f.originalName,
            uploader: f.uploader || '',
            instanceId: String(f.instanceId || ''),
            instanceName: '',
            status: f.status,
            createdAt: f.createdAt ? new Date(f.createdAt).getTime() : 0,
            clonedFromMe: String(f.cloneOf || '') === me.id,
        });
    }
    if (!seen.size)
        return [];
    const ids = Array.from(new Set(Array.from(seen.values()).map((m) => m.instanceId).filter(Boolean)));
    const instMap = new Map();
    if (ids.length) {
        const list = await prisma_1.prisma.instance.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
        for (const i of list)
            instMap.set(i.id, i.name);
    }
    for (const m of seen.values())
        m.instanceName = m.instanceId ? instMap.get(m.instanceId) || m.instanceId : '默认实例';
    return Array.from(seen.values()).sort((a, b) => a.createdAt - b.createdAt);
}
