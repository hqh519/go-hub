"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sourceFingerprint = sourceFingerprint;
exports.thumbCacheKey = thumbCacheKey;
exports.readThumb = readThumb;
exports.writeThumb = writeThumb;
exports.withThumbCache = withThumbCache;
exports.pruneThumbCache = pruneThumbCache;
exports.thumbCacheSizeMB = thumbCacheSizeMB;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const project_paths_1 = require("./project-paths");
function cacheRoot() {
    return (0, project_paths_1.backendSub)('.cache', 'thumbs');
}
function bucketDir(key) {
    const dir = (0, path_1.join)(cacheRoot(), key.slice(0, 2));
    if (!(0, fs_1.existsSync)(dir)) {
        try {
            (0, fs_1.mkdirSync)(dir, { recursive: true });
        }
        catch {
        }
    }
    return dir;
}
function sourceFingerprint(absPath) {
    try {
        const st = (0, fs_1.statSync)(absPath);
        return `${Math.round(st.mtimeMs)}-${st.size}`;
    }
    catch {
        return '0-0';
    }
}
function thumbCacheKey(parts) {
    const raw = [parts.source, parts.version || '0-0', parts.width ?? '', parts.height ?? '', parts.fit || 'cover'].join('|');
    return (0, crypto_1.createHash)('sha1').update(raw).digest('hex');
}
function readThumb(key) {
    try {
        const dir = (0, path_1.join)(cacheRoot(), key.slice(0, 2));
        const binPath = (0, path_1.join)(dir, `${key}.bin`);
        const metaPath = (0, path_1.join)(dir, `${key}.json`);
        if (!(0, fs_1.existsSync)(binPath) || !(0, fs_1.existsSync)(metaPath))
            return null;
        const meta = JSON.parse((0, fs_1.readFileSync)(metaPath, 'utf8'));
        return { data: (0, fs_1.readFileSync)(binPath), type: meta.type || 'application/octet-stream' };
    }
    catch {
        return null;
    }
}
function writeThumb(key, data, type) {
    try {
        const dir = bucketDir(key);
        (0, fs_1.writeFileSync)((0, path_1.join)(dir, `${key}.bin`), data);
        (0, fs_1.writeFileSync)((0, path_1.join)(dir, `${key}.json`), JSON.stringify({ type, at: Date.now() }));
    }
    catch {
    }
}
const inflight = new Map();
async function withThumbCache(key, type, factory) {
    const hit = readThumb(key);
    if (hit)
        return hit.data;
    const running = inflight.get(key);
    if (running)
        return running;
    const job = (async () => {
        try {
            const data = await factory();
            writeThumb(key, data, type);
            return data;
        }
        finally {
            inflight.delete(key);
        }
    })();
    inflight.set(key, job);
    return job;
}
function pruneThumbCache(limit = 20000, dropRatio = 0.2) {
    try {
        const root = cacheRoot();
        if (!(0, fs_1.existsSync)(root))
            return;
        const files = [];
        for (const bucket of (0, fs_1.readdirSync)(root)) {
            const dir = (0, path_1.join)(root, bucket);
            let names = [];
            try {
                names = (0, fs_1.readdirSync)(dir);
            }
            catch {
                continue;
            }
            for (const n of names) {
                if (!n.endsWith('.bin'))
                    continue;
                const p = (0, path_1.join)(dir, n);
                try {
                    const st = (0, fs_1.statSync)(p);
                    files.push({ path: p, mtime: st.mtimeMs, size: st.size });
                }
                catch {
                }
            }
        }
        if (files.length <= limit)
            return;
        files.sort((a, b) => a.mtime - b.mtime);
        const drop = Math.floor(files.length * dropRatio);
        for (let i = 0; i < drop; i++) {
            const p = files[i].path;
            try {
                (0, fs_1.unlinkSync)(p);
                (0, fs_1.unlinkSync)(p.replace(/\.bin$/, '.json'));
            }
            catch {
            }
        }
    }
    catch {
    }
}
function thumbCacheSizeMB() {
    try {
        const root = cacheRoot();
        if (!(0, fs_1.existsSync)(root))
            return 0;
        let bytes = 0;
        for (const bucket of (0, fs_1.readdirSync)(root)) {
            const dir = (0, path_1.join)(root, bucket);
            let names = [];
            try {
                names = (0, fs_1.readdirSync)(dir);
            }
            catch {
                continue;
            }
            for (const n of names) {
                if (!n.endsWith('.bin'))
                    continue;
                try {
                    bytes += (0, fs_1.statSync)((0, path_1.join)(dir, n)).size;
                }
                catch {
                }
            }
        }
        return Math.round((bytes / 1024 / 1024) * 10) / 10;
    }
    catch {
        return 0;
    }
}
