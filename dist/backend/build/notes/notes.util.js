"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTE_VISIBILITIES = exports.MAX_TAGS_PER_NOTE = exports.MAX_TAG_NAME_LENGTH = exports.MAX_ASSETS_PER_NOTE = exports.DEFAULT_MOMENT_MAX_CHARS = exports.MOMENT_MEDIA_KINDS = exports.NOTE_KINDS = void 0;
exports.countTextChars = countTextChars;
exports.mediaKindOfMime = mediaKindOfMime;
exports.mediaKindOf = mediaKindOf;
exports.fileUrlOf = fileUrlOf;
exports.normalizeTagNames = normalizeTagNames;
exports.safeParse = safeParse;
exports.brief = brief;
exports.NOTE_KINDS = ['moment', 'article', 'collection', 'nav', 'todo', 'board'];
exports.MOMENT_MEDIA_KINDS = ['text', 'image', 'video', 'audio', 'mixed'];
exports.DEFAULT_MOMENT_MAX_CHARS = 500;
exports.MAX_ASSETS_PER_NOTE = 50;
exports.MAX_TAG_NAME_LENGTH = 20;
exports.MAX_TAGS_PER_NOTE = 20;
exports.NOTE_VISIBILITIES = ['private', 'public', 'specified'];
function countTextChars(input) {
    const s = String(input ?? '');
    if (!s)
        return 0;
    let n = 0;
    for (const ch of s) {
        if (/[\p{L}\p{N}]/u.test(ch))
            n += 1;
    }
    return n;
}
function mediaKindOfMime(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.startsWith('image/'))
        return 'image';
    if (m.startsWith('video/'))
        return 'video';
    if (m.startsWith('audio/'))
        return 'audio';
    return 'file';
}
function mediaKindOf(mimes) {
    const list = (mimes || []).filter(Boolean);
    if (list.length === 0)
        return 'text';
    const kinds = new Set(list.map((m) => mediaKindOfMime(m)));
    if (kinds.size > 1)
        return 'mixed';
    const only = Array.from(kinds)[0];
    if (only === 'image')
        return 'image';
    if (only === 'video')
        return 'video';
    if (only === 'audio')
        return 'audio';
    return 'mixed';
}
function fileUrlOf(name, thumb) {
    const raw = String(name || '').replace(/^\/+/, '');
    if (!raw)
        return '';
    const path = raw.split('/').map((seg) => encodeURIComponent(seg)).join('/');
    const q = Number(thumb) > 0 ? `?thumb=${Math.round(Number(thumb))}` : '';
    return `/file/${path}${q}`;
}
function normalizeTagNames(raw) {
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? String(raw).split(/[,，]/) : [];
    const out = [];
    for (const item of list) {
        let name = String(item ?? '')
            .replace(/[\r\n\t]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!name)
            continue;
        if (name.length > exports.MAX_TAG_NAME_LENGTH)
            name = name.slice(0, exports.MAX_TAG_NAME_LENGTH);
        if (out.includes(name))
            continue;
        out.push(name);
        if (out.length >= exports.MAX_TAGS_PER_NOTE)
            break;
    }
    return out;
}
function safeParse(raw, fallback = {}) {
    const s = String(raw ?? '');
    if (!s)
        return fallback;
    try {
        const v = JSON.parse(s);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
    }
    catch {
        return fallback;
    }
}
function brief(text, max = 60) {
    const s = String(text ?? '').replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max)}…` : s;
}
