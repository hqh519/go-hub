"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PAGE_SIZE = exports.DEFAULT_PREVIEW_THRESHOLD_MB = exports.DEFAULT_MAX_PER_DIR = void 0;
exports.localTypeOf = localTypeOf;
exports.isHiddenName = isHiddenName;
exports.sanitizeRelativeDir = sanitizeRelativeDir;
exports.safeJoin = safeJoin;
exports.toRelative = toRelative;
exports.hashFile = hashFile;
exports.localFilesAdminOnly = localFilesAdminOnly;
exports.logLocalFileError = logLocalFileError;
exports.sortEntries = sortEntries;
exports.readDirEntries = readDirEntries;
exports.collectDirs = collectDirs;
const fs_1 = require("fs");
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const app_log_1 = require("../common/app-log");
exports.DEFAULT_MAX_PER_DIR = 200;
exports.DEFAULT_PREVIEW_THRESHOLD_MB = 500;
exports.DEFAULT_PAGE_SIZE = 50;
const HIDDEN_DIR_NAMES = new Set(['.git', '.svn', 'node_modules', '@eaDir', '__MACOSX']);
function localTypeOf(ext) {
    const e = String(ext || '').toLowerCase();
    if (['jpg', 'jpeg', 'jfif', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif', 'ico', 'tiff', 'tif', 'heic'].includes(e))
        return 'image';
    if (['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'flv', 'wmv', 'm3u8', 'mpg', 'mpeg'].includes(e))
        return 'video';
    if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'wma', 'ape', 'aiff'].includes(e))
        return 'audio';
    if (e === 'pdf')
        return 'pdf';
    if ([
        'txt', 'text', 'md', 'markdown', 'json', 'jsonl', 'ndjson', 'json5', 'log', 'csv', 'tsv',
        'ini', 'conf', 'cfg', 'properties', 'yml', 'yaml', 'toml', 'xml', 'plist', 'xaml',
        'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl',
        'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'vue', 'svelte',
        'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1',
        'py', 'go', 'java', 'kt', 'kts', 'scala', 'groovy', 'gradle',
        'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'm', 'mm', 'swift', 'rs', 'dart',
        'rb', 'php', 'phtml', 'pl', 'pm', 'lua', 'r', 'jl', 'tex', 'rst', 'proto',
        'sql', 'graphql', 'gql', 'env', 'lock', 'map', 'diff', 'patch', 'srt', 'vtt',
        'htaccess', 'dockerfile', 'makefile', 'gitignore', 'editorconfig',
        'service', 'nginx', 'asm', 's',
    ].includes(e))
        return 'text';
    return 'other';
}
function isHiddenName(name) {
    if (!name)
        return true;
    if (name.startsWith('.') || name.startsWith('#'))
        return true;
    return HIDDEN_DIR_NAMES.has(name);
}
function sanitizeRelativeDir(raw) {
    const v = String(raw ?? '').replace(/\\/g, '/').trim();
    if (!v)
        return '';
    const segs = v.split('/').filter((s) => s !== '' && s !== '.');
    if (segs.some((s) => s === '..'))
        return null;
    if (segs.some((s) => isHiddenName(s)))
        return null;
    return segs.join('/');
}
function safeJoin(root, rel) {
    const abs = path.resolve(root, rel || '.');
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (abs !== root && !abs.startsWith(rootWithSep))
        return null;
    return abs;
}
function toRelative(root, abs) {
    const rel = path.relative(root, abs);
    return rel.split(path.sep).join('/');
}
function hashFile(absPath) {
    return new Promise((resolve, reject) => {
        const hash = (0, crypto_1.createHash)('md5');
        const stream = (0, fs_1.createReadStream)(absPath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', (err) => reject(err));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}
function localFilesAdminOnly(role) {
    return role === 'admin' || role === 'super';
}
function logLocalFileError(action, detail, err) {
    const msg = err instanceof Error ? err.message : String(err || '');
    app_log_1.appLog.error('localfiles', `本地文件${action}失败`, `${detail}${msg ? ` ｜ ${msg}` : ''}`);
}
function sortEntries(list, sort = 'name', order = 'asc') {
    const dir = order === 'desc' ? -1 : 1;
    const key = sort === 'size' ? 'size' : sort === 'mtime' ? 'mtime' : 'name';
    return [...list].sort((a, b) => {
        if (a.kind !== b.kind)
            return a.kind === 'dir' ? -1 : 1;
        if (key === 'name')
            return a.name.localeCompare(b.name, 'zh-CN') * dir;
        if (a[key] === b[key])
            return a.name.localeCompare(b.name, 'zh-CN');
        return (a[key] - b[key]) * dir;
    });
}
async function readDirEntries(absDir, root, maxPerDir) {
    const dirs = [];
    const entries = [];
    const names = await fs_1.promises.readdir(absDir, { withFileTypes: true });
    let truncated = false;
    let seen = 0;
    for (const d of names) {
        if (isHiddenName(d.name))
            continue;
        seen += 1;
        if (seen > maxPerDir) {
            truncated = true;
            break;
        }
        const abs = path.join(absDir, d.name);
        const rel = toRelative(root, abs);
        let kind = d.isDirectory() ? 'dir' : 'file';
        let size = 0;
        let mtime = 0;
        try {
            const st = await fs_1.promises.stat(abs);
            if (st.isDirectory())
                kind = 'dir';
            else if (st.isFile())
                kind = 'file';
            else
                continue;
            size = st.size;
            mtime = st.mtimeMs;
        }
        catch {
            continue;
        }
        const ext = kind === 'file' ? path.extname(d.name).replace(/^\./, '').toLowerCase() : '';
        if (kind === 'dir')
            dirs.push(d.name);
        entries.push({ path: rel, name: d.name, kind, size, mtime, ext, type: kind === 'file' ? localTypeOf(ext) : '' });
    }
    dirs.sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return { entries, truncated, dirs };
}
async function collectDirs(absRoot, root, limit = 500) {
    const out = [];
    const visited = new Set();
    const walk = async (dir) => {
        if (out.length >= limit)
            return;
        let real = dir;
        try {
            real = await fs_1.promises.realpath(dir);
        }
        catch {
            return;
        }
        if (visited.has(real))
            return;
        visited.add(real);
        let names = [];
        try {
            names = await fs_1.promises.readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const d of names) {
            if (out.length >= limit)
                return;
            if (isHiddenName(d.name))
                continue;
            const abs = path.join(dir, d.name);
            let isDir = d.isDirectory();
            if (!isDir && !d.isFile()) {
                try {
                    isDir = (await fs_1.promises.stat(abs)).isDirectory();
                }
                catch {
                    isDir = false;
                }
            }
            if (!isDir)
                continue;
            out.push(toRelative(root, abs));
            await walk(abs);
        }
    };
    await walk(absRoot);
    return out.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
