"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadTmpRoot = uploadTmpRoot;
exports.sessionDir = sessionDir;
exports.newId = newId;
exports.createSession = createSession;
exports.getSession = getSession;
exports.findSessionByKey = findSessionByKey;
exports.findCompletedSessionByKey = findCompletedSessionByKey;
exports.claimMergeLock = claimMergeLock;
exports.releaseMergeLock = releaseMergeLock;
exports.touchSession = touchSession;
exports.receivedChunks = receivedChunks;
exports.writeChunk = writeChunk;
exports.chunkPath = chunkPath;
exports.mergeSession = mergeSession;
exports.markSessionCompleted = markSessionCompleted;
exports.removeSession = removeSession;
exports.stagingDir = stagingDir;
exports.stagingFilePath = stagingFilePath;
exports.createStaging = createStaging;
exports.getStaging = getStaging;
exports.updateStaging = updateStaging;
exports.removeStaging = removeStaging;
exports.sweepExpiredUploads = sweepExpiredUploads;
exports.startUploadSweeper = startUploadSweeper;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const crypto_1 = require("crypto");
const SESSION_TTL_MS = Math.max(1, Number(process.env.UPLOAD_SESSION_TTL_HOURS || 24)) * 3600_000;
const COMPLETED_TTL_MS = 2 * 3600_000;
const MERGED_NAME = 'merged.bin';
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
function uploadTmpRoot() {
    const env = String(process.env.UPLOAD_TMP_DIR || '').trim();
    return env ? (0, path_1.resolve)(env) : (0, path_1.join)((0, os_1.tmpdir)(), 'gohub-upload');
}
function sessionsRoot() {
    return (0, path_1.join)(uploadTmpRoot(), 'sessions');
}
function stagingRoot() {
    return (0, path_1.join)(uploadTmpRoot(), 'staging');
}
function assertId(id, label) {
    if (!ID_RE.test(String(id || '')))
        throw new Error(`${label} 无效`);
    return id;
}
function sessionDir(uploadId) {
    return (0, path_1.join)(sessionsRoot(), assertId(uploadId, 'uploadId'));
}
function manifestPath(uploadId) {
    return (0, path_1.join)(sessionDir(uploadId), 'manifest.json');
}
async function readJson(path) {
    try {
        return JSON.parse(await fs_1.promises.readFile(path, 'utf8'));
    }
    catch {
        return null;
    }
}
async function writeJsonAtomic(path, data) {
    const tmp = `${path}.${(0, crypto_1.randomBytes)(4).toString('hex')}.tmp`;
    await fs_1.promises.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fs_1.promises.rename(tmp, path);
}
function newId(prefix) {
    return `${prefix}${Date.now().toString(36)}${(0, crypto_1.randomBytes)(6).toString('hex')}`;
}
async function createSession(input) {
    const uploadId = newId('u');
    const now = Date.now();
    const dir = sessionDir(uploadId);
    await fs_1.promises.mkdir(dir, { recursive: true });
    const session = {
        uploadId,
        uploadKey: input.uploadKey,
        totalChunks: Math.max(1, Number(input.totalChunks) || 1),
        originalName: input.originalName,
        mime: input.mime,
        size: Math.max(0, Number(input.size) || 0),
        startedAt: now,
        updatedAt: now,
    };
    await writeJsonAtomic(manifestPath(uploadId), session);
    return session;
}
async function getSession(uploadId) {
    try {
        return await readJson(manifestPath(uploadId));
    }
    catch {
        return null;
    }
}
async function findSessionByKey(uploadKey) {
    if (!uploadKey)
        return null;
    let dirs = [];
    try {
        dirs = await fs_1.promises.readdir(sessionsRoot());
    }
    catch {
        return null;
    }
    const now = Date.now();
    let best = null;
    for (const d of dirs) {
        if (!ID_RE.test(d))
            continue;
        const s = await getSession(d);
        if (!s || s.completedAt)
            continue;
        if (s.uploadKey !== uploadKey)
            continue;
        if (now - s.updatedAt > SESSION_TTL_MS)
            continue;
        if (!best || s.updatedAt > best.updatedAt)
            best = s;
    }
    return best;
}
async function findCompletedSessionByKey(uploadKey) {
    if (!uploadKey)
        return null;
    let dirs = [];
    try {
        dirs = await fs_1.promises.readdir(sessionsRoot());
    }
    catch {
        return null;
    }
    const now = Date.now();
    let best = null;
    for (const d of dirs) {
        if (!ID_RE.test(d))
            continue;
        const s = await getSession(d);
        if (!s || !s.completedAt)
            continue;
        if (s.uploadKey !== uploadKey)
            continue;
        if (now - s.updatedAt > COMPLETED_TTL_MS)
            continue;
        if (!best || s.updatedAt > best.updatedAt)
            best = s;
    }
    return best;
}
async function claimMergeLock(session) {
    const now = Date.now();
    if (session.mergingAt && now - session.mergingAt < 10 * 60_000)
        return false;
    session.mergingAt = now;
    session.updatedAt = now;
    try {
        await writeJsonAtomic(manifestPath(session.uploadId), session);
    }
    catch {
    }
    return true;
}
async function releaseMergeLock(session) {
    session.mergingAt = 0;
    session.updatedAt = Date.now();
    try {
        await writeJsonAtomic(manifestPath(session.uploadId), session);
    }
    catch {
    }
}
async function touchSession(s) {
    s.updatedAt = Date.now();
    try {
        await writeJsonAtomic(manifestPath(s.uploadId), s);
    }
    catch {
    }
}
async function receivedChunks(uploadId) {
    const dir = sessionDir(uploadId);
    let names = [];
    try {
        names = await fs_1.promises.readdir(dir);
    }
    catch {
        return [];
    }
    const out = [];
    for (const name of names) {
        const m = /^(\d+)\.part$/.exec(name);
        if (!m)
            continue;
        try {
            const st = await fs_1.promises.stat((0, path_1.join)(dir, name));
            if (st.size > 0)
                out.push({ index: Number(m[1]), size: st.size });
        }
        catch {
        }
    }
    return out.sort((a, b) => a.index - b.index);
}
async function writeChunk(uploadId, index, buffer) {
    const dir = sessionDir(uploadId);
    const target = (0, path_1.join)(dir, `${String(index).padStart(6, '0')}.part`);
    const tmp = `${target}.${(0, crypto_1.randomBytes)(4).toString('hex')}.tmp`;
    await fs_1.promises.writeFile(tmp, buffer);
    await fs_1.promises.rename(tmp, target);
}
function chunkPath(uploadId, index) {
    return (0, path_1.join)(sessionDir(uploadId), `${String(index).padStart(6, '0')}.part`);
}
async function mergeSession(session) {
    const received = await receivedChunks(session.uploadId);
    const map = new Map(received.map((r) => [r.index, r.size]));
    const missing = [];
    for (let i = 0; i < session.totalChunks; i++) {
        if (!map.get(i))
            missing.push(i);
    }
    if (missing.length) {
        throw new Error(`分片不完整：缺少第 ${missing.slice(0, 10).map((i) => i + 1).join('、')} 片（共缺 ${missing.length} 片）`);
    }
    const merged = (0, path_1.join)(sessionDir(session.uploadId), MERGED_NAME);
    await fs_1.promises.rm(merged, { force: true });
    let total = 0;
    for (let i = 0; i < session.totalChunks; i++) {
        const data = await fs_1.promises.readFile(chunkPath(session.uploadId, i));
        await fs_1.promises.appendFile(merged, data);
        total += data.length;
    }
    if (session.size > 0 && total !== session.size) {
        await fs_1.promises.rm(merged, { force: true });
        throw new Error(`分片总大小不一致：收到 ${total}B，声明 ${session.size}B（请重试，已传分片会保留）`);
    }
    return { path: merged, size: total };
}
async function markSessionCompleted(session, result) {
    session.completedAt = Date.now();
    session.updatedAt = session.completedAt;
    session.mergingAt = 0;
    if (result && result.fileId) {
        session.mergeFileId = result.fileId;
        session.mergeName = result.name;
    }
    await writeJsonAtomic(manifestPath(session.uploadId), session);
}
async function removeSession(uploadId) {
    try {
        await fs_1.promises.rm(sessionDir(uploadId), { recursive: true, force: true });
    }
    catch {
    }
}
function stagingDir(stagingId) {
    return (0, path_1.join)(stagingRoot(), assertId(stagingId, 'stagingId'));
}
function stagingFilePath(stagingId) {
    return (0, path_1.join)(stagingDir(stagingId), 'file');
}
function stagingMetaPath(stagingId) {
    return (0, path_1.join)(stagingDir(stagingId), 'meta.json');
}
async function createStaging(input) {
    const stagingId = newId('st');
    await fs_1.promises.mkdir(stagingDir(stagingId), { recursive: true });
    const meta = {
        stagingId,
        name: input.name,
        mime: input.mime,
        size: Math.max(0, Number(input.size) || 0),
        sourceUrl: input.sourceUrl,
        createdAt: Date.now(),
    };
    await writeJsonAtomic(stagingMetaPath(stagingId), meta);
    return meta;
}
async function getStaging(stagingId) {
    try {
        return await readJson(stagingMetaPath(stagingId));
    }
    catch {
        return null;
    }
}
async function updateStaging(meta, patch) {
    const next = { ...meta, ...patch, stagingId: meta.stagingId, createdAt: meta.createdAt };
    await writeJsonAtomic(stagingMetaPath(meta.stagingId), next);
    return next;
}
async function removeStaging(stagingId) {
    try {
        await fs_1.promises.rm(stagingDir(stagingId), { recursive: true, force: true });
    }
    catch {
    }
}
async function sweepDir(root, decide) {
    let names = [];
    try {
        names = await fs_1.promises.readdir(root);
    }
    catch {
        return 0;
    }
    let removed = 0;
    for (const name of names) {
        if (!ID_RE.test(name))
            continue;
        try {
            if (await decide(root, name)) {
                await fs_1.promises.rm((0, path_1.join)(root, name), { recursive: true, force: true });
                removed += 1;
            }
        }
        catch {
        }
    }
    return removed;
}
async function sweepExpiredUploads() {
    const now = Date.now();
    const sessions = await sweepDir(sessionsRoot(), async (_root, name) => {
        const s = await getSession(name);
        if (!s) {
            const st = await fs_1.promises.stat((0, path_1.join)(sessionsRoot(), name));
            return now - st.mtimeMs > SESSION_TTL_MS;
        }
        const dirStat = await fs_1.promises.stat((0, path_1.join)(sessionsRoot(), name)).catch(() => null);
        const lastActive = Math.max(s.updatedAt || 0, dirStat ? dirStat.mtimeMs : 0);
        const deadline = s.completedAt ? s.completedAt + COMPLETED_TTL_MS : lastActive + SESSION_TTL_MS;
        return now > deadline;
    });
    const staging = await sweepDir(stagingRoot(), async (_root, name) => {
        const s = await getStaging(name);
        if (!s) {
            const st = await fs_1.promises.stat((0, path_1.join)(stagingRoot(), name));
            return now - st.mtimeMs > SESSION_TTL_MS;
        }
        const deadline = s.committedAt ? s.committedAt + COMPLETED_TTL_MS : s.createdAt + SESSION_TTL_MS;
        return now > deadline;
    });
    if (sessions || staging) {
        console.log(`[upload] TTL 清理：分片会话 ${sessions} 个，链接暂存 ${staging} 个`);
    }
    return { sessions, staging };
}
let sweeperStarted = false;
function startUploadSweeper() {
    if (sweeperStarted)
        return;
    sweeperStarted = true;
    try {
        sweepExpiredUploads().catch(() => undefined);
    }
    catch {
    }
    const timer = setInterval(() => {
        sweepExpiredUploads().catch((e) => console.warn('[upload] TTL 清理失败:', e.message));
    }, 30 * 60 * 1000);
    timer.unref?.();
}
