"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAG_TYPE_NOTE = exports.TAG_TYPE_FILE = void 0;
exports.tagScope = tagScope;
exports.findOrCreateTag = findOrCreateTag;
exports.mergeDuplicateTags = mergeDuplicateTags;
exports.splitSharedNoteTags = splitSharedNoteTags;
const prisma_1 = require("./prisma");
exports.TAG_TYPE_FILE = 'file';
exports.TAG_TYPE_NOTE = 'note';
function tagScope(instanceId, type = exports.TAG_TYPE_FILE, owner = '') {
    const t = String(type || exports.TAG_TYPE_FILE);
    return {
        instanceId: String(instanceId || ''),
        type: t,
        scope: t === exports.TAG_TYPE_NOTE ? String(owner || '') : '',
    };
}
async function findOrCreateTag(name, instanceId, operator = '', type = exports.TAG_TYPE_FILE) {
    const n = String(name || '').trim();
    const scope = tagScope(instanceId, type, operator);
    const existed = await prisma_1.prisma.tag.findFirst({
        where: { ...scope, name: n },
        orderBy: { createdAt: 'asc' },
    });
    if (existed)
        return existed;
    try {
        const created = await prisma_1.prisma.tag.upsert({
            where: {
                name_instanceId_type_scope: {
                    name: n,
                    instanceId: scope.instanceId,
                    type: scope.type,
                    scope: scope.scope,
                },
            },
            update: {},
            create: {
                name: n,
                instanceId: scope.instanceId,
                type: scope.type,
                scope: scope.scope,
                owner: String(operator || ''),
            },
        });
        return created;
    }
    catch {
        const again = await prisma_1.prisma.tag.findFirst({ where: { ...scope, name: n }, orderBy: { createdAt: 'asc' } });
        if (again)
            return again;
        throw new Error(`标签创建失败：${n}`);
    }
}
async function mergeDuplicateTags() {
    let merged = 0;
    try {
        const rows = (await prisma_1.prisma.tag.findMany({ orderBy: { createdAt: 'asc' } }));
        const groups = new Map();
        for (const r of rows) {
            const key = `${String(r.instanceId || '')}\u0000${String(r.type || exports.TAG_TYPE_FILE)}\u0000${String(r.scope || '')}\u0000${r.name}`;
            const list = groups.get(key);
            if (list)
                list.push(r);
            else
                groups.set(key, [r]);
        }
        for (const list of groups.values()) {
            if (list.length < 2)
                continue;
            const [keep, ...dupes] = list;
            for (const dup of dupes) {
                const links = await prisma_1.prisma.fileTag.findMany({ where: { tagId: dup.id } });
                for (const link of links) {
                    const exists = await prisma_1.prisma.fileTag.findFirst({
                        where: { fileId: link.fileId, tagId: keep.id },
                        select: { id: true },
                    });
                    if (exists)
                        await prisma_1.prisma.fileTag.delete({ where: { id: link.id } });
                    else
                        await prisma_1.prisma.fileTag.update({ where: { id: link.id }, data: { tagId: keep.id } });
                }
                const noteLinks = await prisma_1.prisma.noteTag.findMany({ where: { tagId: dup.id } });
                for (const link of noteLinks) {
                    const exists = await prisma_1.prisma.noteTag.findUnique({
                        where: { noteId_tagId: { noteId: link.noteId, tagId: keep.id } },
                        select: { noteId: true },
                    });
                    if (exists)
                        await prisma_1.prisma.noteTag.delete({ where: { noteId_tagId: { noteId: link.noteId, tagId: dup.id } } });
                    else
                        await prisma_1.prisma.noteTag.update({ where: { noteId_tagId: { noteId: link.noteId, tagId: dup.id } }, data: { tagId: keep.id } });
                }
                await prisma_1.prisma.tag.delete({ where: { id: dup.id } }).catch(() => undefined);
                merged += 1;
            }
        }
    }
    catch {
    }
    return merged;
}
async function splitSharedNoteTags() {
    let fixed = 0;
    try {
        const tags = await prisma_1.prisma.tag.findMany({ where: { type: exports.TAG_TYPE_NOTE } });
        for (const tag of tags) {
            const links = await prisma_1.prisma.noteTag.findMany({
                where: { tagId: tag.id },
                select: { noteId: true, note: { select: { author: true } } },
            });
            const authors = Array.from(new Set(links.map((l) => String(l.note?.author || '')).filter(Boolean))).sort();
            if (!authors.length) {
                const want = String(tag.owner || '');
                if (want && String(tag.scope || '') !== want) {
                    await prisma_1.prisma.tag.update({ where: { id: tag.id }, data: { scope: want } }).catch(() => undefined);
                    fixed += 1;
                }
                continue;
            }
            const owner = String(tag.owner || '');
            const keeper = authors.includes(owner) ? owner : authors[0];
            if (String(tag.scope || '') !== keeper) {
                await prisma_1.prisma.tag.update({ where: { id: tag.id }, data: { scope: keeper } }).catch(() => undefined);
                fixed += 1;
            }
            for (const author of authors) {
                if (author === keeper)
                    continue;
                const row = await findOrCreateTag(tag.name, String(tag.instanceId || ''), author, exports.TAG_TYPE_NOTE);
                const mine = links.filter((l) => String(l.note?.author || '') === author);
                for (const link of mine) {
                    const exists = await prisma_1.prisma.noteTag.findUnique({
                        where: { noteId_tagId: { noteId: link.noteId, tagId: row.id } },
                        select: { noteId: true },
                    });
                    if (exists) {
                        await prisma_1.prisma.noteTag
                            .delete({ where: { noteId_tagId: { noteId: link.noteId, tagId: tag.id } } })
                            .catch(() => undefined);
                    }
                    else {
                        await prisma_1.prisma.noteTag
                            .update({ where: { noteId_tagId: { noteId: link.noteId, tagId: tag.id } }, data: { tagId: row.id } })
                            .catch(() => undefined);
                    }
                }
                fixed += 1;
            }
        }
    }
    catch {
    }
    return fixed;
}
