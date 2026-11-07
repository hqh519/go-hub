"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FOLDER_TYPE_FILE = void 0;
exports.sha256Hex = sha256Hex;
exports.normalizeFolderPath = normalizeFolderPath;
exports.extraFoldersKey = extraFoldersKey;
exports.extraFoldersOf = extraFoldersOf;
exports.parseSharedUsers = parseSharedUsers;
exports.folderMetasOf = folderMetasOf;
exports.normalizeSharedPerm = normalizeSharedPerm;
exports.serializeFolderMeta = serializeFolderMeta;
exports.findFolderMeta = findFolderMeta;
exports.parseGalleryDirs = parseGalleryDirs;
exports.setGalleryPath = setGalleryPath;
exports.listSharedFoldersFor = listSharedFoldersFor;
exports.listFoldersSharedBy = listFoldersSharedBy;
exports.folderSharedWithUser = folderSharedWithUser;
exports.folderSharedPermission = folderSharedPermission;
exports.requiredPasswordHashes = requiredPasswordHashes;
exports.shouldLogPasswordFailure = shouldLogPasswordFailure;
const node_crypto_1 = require("node:crypto");
const prisma_1 = require("../common/prisma");
const file_view_1 = require("../common/file-view");
function sha256Hex(text) {
    return (0, node_crypto_1.createHash)('sha256').update(String(text || ''), 'utf8').digest('hex');
}
exports.FOLDER_TYPE_FILE = 'file';
function normalizeFolderPath(p) {
    return String(p || '')
        .replace(/\.\./g, '_')
        .replace(/\\/g, '/')
        .replace(/\/{2,}/g, '/')
        .replace(/^\/+|\/+$/g, '');
}
function extraFoldersKey(owner, instanceId) {
    const inst = String(instanceId || '');
    return inst ? `${owner}::${inst}` : owner;
}
function extraFoldersOf(map, owner, instanceId) {
    if (String(instanceId) === '*') {
        const out = [];
        for (const [k, v] of Object.entries(map || {})) {
            if (!Array.isArray(v))
                continue;
            if (k === owner || k.startsWith(`${owner}::`))
                out.push(...v);
        }
        return out;
    }
    const v = (map || {})[extraFoldersKey(owner, instanceId)];
    return Array.isArray(v) ? v : [];
}
function parseSharedUsers(raw) {
    try {
        const arr = JSON.parse(raw || '[]');
        return Array.isArray(arr) ? arr.map((x) => String(x || '').trim()).filter(Boolean) : [];
    }
    catch {
        return [];
    }
}
function folderMetasOf(row) {
    return (0, file_view_1.safeParse)(row?.metas);
}
function normalizeSharedPerm(raw) {
    return String(raw || '').trim() === 'readonly' ? 'readonly' : 'edit';
}
function serializeFolderMeta(row, opts = {}) {
    const metas = folderMetasOf(row);
    return {
        id: row.id,
        owner: row.owner,
        path: row.path,
        instanceId: row.instanceId,
        encrypted: !!row.passwordHash,
        ...(opts.hideNote ? {} : { note: row.note }),
        sharedUsers: parseSharedUsers(row.sharedUsers),
        sharedPerm: normalizeSharedPerm(row.sharedPerm),
        gallery: row.gallery,
        displayName: metas.displayName || '',
        createdAt: row.createdAt,
    };
}
async function findFolderMeta(path, instanceId, owner) {
    const p = normalizeFolderPath(path);
    if (!p)
        return null;
    return prisma_1.prisma.folderMeta.findFirst({
        where: { path: p, instanceId: instanceId || '', type: exports.FOLDER_TYPE_FILE, ...(owner ? { owner } : {}) },
    });
}
function parseGalleryDirs(allowedDir) {
    return String(allowedDir || '')
        .split(/[\n\r,]+/)
        .map((d) => normalizeFolderPath(d))
        .filter(Boolean);
}
async function setGalleryPath(sysConfig, path, on) {
    const others = (await sysConfig.get('others'));
    const cur = parseGalleryDirs(others?.publicBrowse?.allowedDir);
    const p = normalizeFolderPath(path);
    const next = (on ? Array.from(new Set([...cur, p])) : cur.filter((d) => d !== p))
        .filter(Boolean)
        .sort();
    await sysConfig.save('others', {
        publicBrowse: { allowedDir: next.join('\n') },
    });
    return next;
}
async function listSharedFoldersFor(username, instanceId) {
    const u = String(username || '').trim();
    if (!u)
        return [];
    const rows = await prisma_1.prisma.folderMeta.findMany({
        where: {
            type: exports.FOLDER_TYPE_FILE,
            ...(String(instanceId) === '*' ? {} : { instanceId: instanceId || '' }),
        },
    });
    return rows
        .filter((r) => r.owner && r.owner !== u && parseSharedUsers(r.sharedUsers).includes(u))
        .map((r) => ({
        path: r.path,
        owner: r.owner,
        displayName: folderMetasOf(r).displayName || '',
        sharedPerm: normalizeSharedPerm(r.sharedPerm),
    }))
        .sort((a, b) => a.path.localeCompare(b.path));
}
async function listFoldersSharedBy(username, instanceId) {
    const u = String(username || '').trim();
    if (!u)
        return [];
    const rows = await prisma_1.prisma.folderMeta.findMany({
        where: {
            owner: u,
            type: exports.FOLDER_TYPE_FILE,
            ...(String(instanceId) === '*' ? {} : { instanceId: instanceId || '' }),
        },
    });
    return rows
        .filter((r) => parseSharedUsers(r.sharedUsers).length > 0)
        .map((r) => ({
        path: r.path,
        owner: r.owner,
        displayName: folderMetasOf(r).displayName || '',
    }))
        .sort((a, b) => a.path.localeCompare(b.path));
}
async function folderSharedWithUser(folderPath, instanceId, username) {
    const r = await folderSharedPermission(folderPath, instanceId, username);
    return { shared: r.shared, owner: r.owner };
}
async function folderSharedPermission(folderPath, instanceId, username) {
    const u = String(username || '').trim();
    const p = normalizeFolderPath(folderPath);
    if (!u || !p)
        return { shared: false, owner: '', perm: 'edit' };
    const parts = p.split('/');
    const chain = [];
    for (let i = parts.length; i >= 1; i--)
        chain.push(parts.slice(0, i).join('/'));
    const rows = await prisma_1.prisma.folderMeta.findMany({
        where: { instanceId: instanceId || '', type: exports.FOLDER_TYPE_FILE, path: { in: chain } },
    });
    const hit = rows
        .filter((r) => r.owner && r.owner !== u && parseSharedUsers(r.sharedUsers).includes(u))
        .sort((a, b) => a.path.length - b.path.length)[0];
    return hit
        ? { shared: true, owner: hit.owner, perm: normalizeSharedPerm(hit.sharedPerm) }
        : { shared: false, owner: '', perm: 'edit' };
}
async function requiredPasswordHashes(record) {
    const fileMetas = (0, file_view_1.safeParse)(record.metas);
    const fileHash = String(fileMetas.AccessPasswordHash || '').trim();
    return fileHash ? [fileHash] : [];
}
const pwLogThrottle = new Map();
function shouldLogPasswordFailure(name, ip) {
    const key = `${name}::${ip || '-'}`;
    const now = Date.now();
    const last = pwLogThrottle.get(key) || 0;
    if (now - last < 60_000)
        return false;
    pwLogThrottle.set(key, now);
    if (pwLogThrottle.size > 500) {
        for (const [k, t] of pwLogThrottle) {
            if (now - t > 60_000)
                pwLogThrottle.delete(k);
        }
    }
    return true;
}
