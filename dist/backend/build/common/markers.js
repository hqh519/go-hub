"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MARKER_TYPE_MOMENT = void 0;
exports.markerTypeOfKind = markerTypeOfKind;
exports.markerScope = markerScope;
exports.findOrCreateMarker = findOrCreateMarker;
exports.markerCandidates = markerCandidates;
const prisma_1 = require("./prisma");
exports.MARKER_TYPE_MOMENT = 'moment';
function markerTypeOfKind(kind) {
    const k = String(kind || '').trim();
    return k || exports.MARKER_TYPE_MOMENT;
}
function markerScope(instanceId, type, owner) {
    return {
        instanceId: String(instanceId || ''),
        type: String(type || exports.MARKER_TYPE_MOMENT),
        scope: String(owner || ''),
    };
}
async function findOrCreateMarker(name, instanceId, operator, type) {
    const n = String(name || '').trim();
    if (!n)
        return null;
    const scope = markerScope(instanceId, type, operator);
    const existed = await prisma_1.prisma.marker.findFirst({ where: { ...scope, name: n } });
    if (existed)
        return { id: existed.id, name: existed.name };
    try {
        const created = await prisma_1.prisma.marker.upsert({
            where: { name_instanceId_type_scope: { name: n, ...scope } },
            update: {},
            create: { name: n, ...scope, owner: String(operator || '') },
        });
        return { id: created.id, name: created.name };
    }
    catch {
        const again = await prisma_1.prisma.marker.findFirst({ where: { ...scope, name: n } });
        return again ? { id: again.id, name: again.name } : null;
    }
}
async function markerCandidates(instanceId, viewer, type, keyword = '') {
    const scope = markerScope(instanceId, type, viewer);
    const kw = String(keyword || '').trim();
    const rows = await prisma_1.prisma.marker.findMany({
        where: {
            ...scope,
            ...(kw ? { name: { contains: kw } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, name: true },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, count: 0 }));
}
