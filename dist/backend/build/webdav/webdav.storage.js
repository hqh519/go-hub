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
exports.webdavRoot = webdavRoot;
exports.cleanRelPath = cleanRelPath;
exports.cleanChannelPath = cleanChannelPath;
exports.resolveInside = resolveInside;
exports.userRoot = userRoot;
exports.channelRoot = channelRoot;
exports.ensureDir = ensureDir;
exports.listDir = listDir;
exports.mimeOf = mimeOf;
const fs_1 = require("fs");
const path = __importStar(require("path"));
const project_paths_1 = require("../common/project-paths");
function webdavRoot() {
    return (0, project_paths_1.backendSub)('webdav');
}
function cleanRelPath(raw) {
    return String(raw || '')
        .replace(/\\/g, '/')
        .split('/')
        .map((s) => s.trim())
        .filter((s) => s && s !== '.' && s !== '..')
        .join('/');
}
function cleanChannelPath(raw) {
    return cleanRelPath(raw);
}
function resolveInside(root, rel) {
    const safeRel = cleanRelPath(rel);
    const abs = path.resolve(root, safeRel);
    const rootAbs = path.resolve(root);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep))
        return null;
    return abs;
}
function userRoot(username) {
    return path.join(webdavRoot(), String(username || '').trim());
}
function channelRoot(username, channelPath) {
    return path.join(userRoot(username), cleanRelPath(channelPath));
}
async function ensureDir(abs) {
    await fs_1.promises.mkdir(abs, { recursive: true });
}
async function listDir(abs, relBase) {
    const items = await fs_1.promises.readdir(abs, { withFileTypes: true });
    const out = [];
    for (const it of items) {
        if (it.name.startsWith('.'))
            continue;
        const childAbs = path.join(abs, it.name);
        const rel = relBase ? `${relBase}/${it.name}` : it.name;
        let size = 0;
        let mtime = new Date();
        try {
            const st = await fs_1.promises.stat(childAbs);
            size = st.size;
            mtime = st.mtime;
        }
        catch {
        }
        out.push({ name: it.name, rel, dir: it.isDirectory(), size, mtime });
    }
    out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    return out;
}
function mimeOf(name) {
    const ext = String(name).split('.').pop()?.toLowerCase() || '';
    const map = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
        webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', heic: 'image/heic',
        mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
        mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav',
        txt: 'text/plain', md: 'text/markdown', json: 'application/json', xml: 'application/xml',
        pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
        doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        csv: 'text/csv', html: 'text/html', css: 'text/css', js: 'text/javascript',
    };
    return map[ext] || 'application/octet-stream';
}
