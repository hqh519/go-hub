"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREFIX_CAPABLE_TYPES = exports.LOCAL_USER_ROOT = exports.LOCAL_DEFAULT_PREFIX = void 0;
exports.sanitizeNameSegment = sanitizeNameSegment;
exports.renderObjectPrefix = renderObjectPrefix;
exports.renderFileName = renderFileName;
exports.joinObjectKey = joinObjectKey;
exports.randomUuid = randomUuid;
exports.supportsPrefix = supportsPrefix;
exports.LOCAL_DEFAULT_PREFIX = '{user}/{ID}/{y}/{m}';
exports.LOCAL_USER_ROOT = '_user';
function pad(n, len = 2) {
    return String(n).padStart(len, '0');
}
function sanitizeNameSegment(input) {
    let v = String(input ?? '').trim();
    v = v.replace(/[^\p{L}\p{N}\-_. ]+/gu, '');
    v = v.replace(/\s+/g, '-');
    v = v.replace(/-{2,}/g, '-');
    v = v.replace(/^[-_.]+|[-_.]+$/g, '');
    return v;
}
function renderObjectPrefix(template, at = new Date(), tokens = {}, defaultTemplate) {
    const tpl = String(template ?? '').trim() || String(defaultTemplate ?? '').trim();
    if (!tpl)
        return `${at.getFullYear()}/${pad(at.getMonth() + 1)}`;
    const userSeg = sanitizeNameSegment(tokens.user);
    const replaced = tpl
        .replace(/\{y\}/g, String(at.getFullYear()))
        .replace(/\{m\}/g, pad(at.getMonth() + 1))
        .replace(/\{d\}/g, pad(at.getDate()))
        .replace(/\{(?:ID|id)\}/g, sanitizeNameSegment(tokens.channelId))
        .replace(/\{user\}/g, userSeg)
        .replace(/\{domain\}/g, sanitizeNameSegment(tokens.domain));
    return replaced.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}
function renderFileName(template, tokens) {
    const tpl = String(template ?? '').trim();
    const ext = tokens.ext || '';
    const use = tpl || '{hash}';
    const hasExtToken = /\{ext\}/.test(use);
    const md5 = tokens.md5 || '';
    const hash = md5 ? md5.slice(0, 16) : randomUuid().replace(/-/g, '').slice(0, 16);
    let name = use
        .replace(/\{hash\}/g, hash)
        .replace(/\{filename\}/g, sanitizeNameSegment(tokens.stem) || 'file')
        .replace(/\{uuid\}/g, randomUuid())
        .replace(/\{md5\}/g, md5 || randomUuid().replace(/-/g, '').slice(0, 32))
        .replace(/\{timestamp\}/g, String(tokens.timestamp))
        .replace(/\{ext\}/g, ext ? `.${ext}` : '');
    name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '');
    if (!name)
        name = hash;
    if (ext && !hasExtToken && !name.toLowerCase().endsWith('.' + ext.toLowerCase())) {
        name += '.' + ext;
    }
    return name;
}
function joinObjectKey(prefix, fileName) {
    const p = String(prefix || '').replace(/^\/+|\/+$/g, '');
    const f = String(fileName || '').replace(/^\/+/g, '');
    return p ? `${p}/${f}` : f;
}
function randomUuid() {
    const b = Buffer.alloc(16);
    for (let i = 0; i < 16; i += 1)
        b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
exports.PREFIX_CAPABLE_TYPES = ['minio', 'cos', 'aliyun', 'r2', 's3', 'webdav', 'local'];
function supportsPrefix(type) {
    return exports.PREFIX_CAPABLE_TYPES.includes(type);
}
