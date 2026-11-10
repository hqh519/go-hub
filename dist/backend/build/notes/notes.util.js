"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOMENT_ATTACH_SINGLE_FACTOR = exports.MOMENT_ATTACH_RATIO_MAX = exports.MOMENT_ATTACH_RATIO_MIN = exports.DEFAULT_MOMENT_ATTACH_RATIO = exports.MOMENT_ATTACH_ROWS = exports.MOMENT_LAYOUT_STYLES = exports.MOMENT_ATTACH_ALIGNS = exports.MOMENT_ATTACH_SIZES = exports.NOTE_VISIBILITIES = exports.MAX_TAGS_PER_NOTE = exports.MAX_TAG_NAME_LENGTH = exports.MAX_ASSETS_PER_NOTE = exports.MAX_COMMENT_CHARS = exports.DEFAULT_MOMENT_MAX_CHARS = exports.MOMENT_MEDIA_KINDS = exports.NOTE_KINDS = void 0;
exports.attachHeightFactorOf = attachHeightFactorOf;
exports.normalizeMomentSettings = normalizeMomentSettings;
exports.normalizeNoteSettings = normalizeNoteSettings;
exports.countTextChars = countTextChars;
exports.mediaKindOfMime = mediaKindOfMime;
exports.mediaKindOf = mediaKindOf;
exports.fileUrlOf = fileUrlOf;
exports.normalizeTagNames = normalizeTagNames;
exports.safeParse = safeParse;
exports.brief = brief;
exports.NOTE_KINDS = ['moment', 'article', 'collection', 'nav', 'todo', 'board'];
exports.MOMENT_MEDIA_KINDS = ['text', 'image', 'video', 'audio', 'mixed'];
exports.DEFAULT_MOMENT_MAX_CHARS = 1000;
exports.MAX_COMMENT_CHARS = 500;
exports.MAX_ASSETS_PER_NOTE = 50;
exports.MAX_TAG_NAME_LENGTH = 20;
exports.MAX_TAGS_PER_NOTE = 20;
exports.NOTE_VISIBILITIES = ['private', 'public', 'specified'];
exports.MOMENT_ATTACH_SIZES = ['default', 'custom'];
exports.MOMENT_ATTACH_ALIGNS = ['center', 'left'];
exports.MOMENT_LAYOUT_STYLES = ['default', 'divider'];
exports.MOMENT_ATTACH_ROWS = [1, 2, 3];
exports.DEFAULT_MOMENT_ATTACH_RATIO = 35;
exports.MOMENT_ATTACH_RATIO_MIN = 5;
exports.MOMENT_ATTACH_RATIO_MAX = 80;
function attachHeightFactorOf(count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n <= 1)
        return 0.8;
    if (n === 2)
        return 0.7;
    if (n === 3)
        return 0.6;
    if (n <= 6)
        return 0.8;
    return 1;
}
exports.MOMENT_ATTACH_SINGLE_FACTOR = 0.8;
function normalizeMomentSettings(raw) {
    const o = (raw && typeof raw === 'object' ? raw : {});
    const size = exports.MOMENT_ATTACH_SIZES.includes(String(o.attachSize))
        ? String(o.attachSize)
        : 'custom';
    const align = exports.MOMENT_ATTACH_ALIGNS.includes(String(o.attachAlign))
        ? String(o.attachAlign)
        : 'left';
    let ratio = Number(o.attachRatio);
    if (!Number.isFinite(ratio) || ratio <= 0)
        ratio = exports.DEFAULT_MOMENT_ATTACH_RATIO;
    ratio = Math.min(exports.MOMENT_ATTACH_RATIO_MAX, Math.max(exports.MOMENT_ATTACH_RATIO_MIN, Math.round(ratio * 10) / 10));
    const layoutStyle = exports.MOMENT_LAYOUT_STYLES.includes(String(o.layoutStyle))
        ? String(o.layoutStyle)
        : 'divider';
    const rowsNum = Math.round(Number(o.attachRows));
    const attachRows = exports.MOMENT_ATTACH_ROWS.includes(rowsNum) ? rowsNum : 2;
    return { attachSize: size, attachRatio: ratio, attachAlign: align, layoutStyle, attachRows };
}
function normalizeNoteSettings(raw) {
    const o = (raw && typeof raw === 'object' ? raw : {});
    return { ...o, moment: normalizeMomentSettings(o.moment) };
}
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
