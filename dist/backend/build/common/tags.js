"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAG_TYPE_FILE = void 0;
exports.tagScope = tagScope;
exports.findOrCreateTag = findOrCreateTag;
exports.mergeDuplicateTags = mergeDuplicateTags;
const prisma_1 = require("./prisma");
exports.TAG_TYPE_FILE = 'file';
function tagScope(instanceId, type = exports.TAG_TYPE_FILE) {
    return { instanceId: String(instanceId || ''), type: String(type || exports.TAG_TYPE_FILE) };
}
async function findOrCreateTag(name, instanceId, operator = '', type = exports.TAG_TYPE_FILE) {
    const n = String(name || '').trim();
    const scope = tagScope(instanceId, type);
    const existed = await prisma_1.prisma.tag.findFirst({
        where: { ...scope, name: n },
        orderBy: { createdAt: 'asc' },
    });
    if (existed)
        return existed;
    try {
        const created = await prisma_1.prisma.tag.upsert({
            where: { name_instanceId_type: { name: n, instanceId: scope.instanceId, type: scope.type } },
            update: {},
            create: { name: n, instanceId: scope.instanceId, type: scope.type, owner: String(operator || '') },
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
            const key = `${String(r.instanceId || '')}\u0000${String(r.type || exports.TAG_TYPE_FILE)}\u0000${r.name}`;
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
                await prisma_1.prisma.tag.delete({ where: { id: dup.id } }).catch(() => undefined);
                merged += 1;
            }
        }
    }
    catch {
    }
    return merged;
}
