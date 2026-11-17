"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_EDITOR_TOOLBAR_LINES = exports.DEFAULT_EDITOR_STYLES = exports.DEFAULT_HISTORY_INTERVAL = exports.HISTORY_INTERVAL_MAX = exports.HISTORY_INTERVAL_MIN = exports.EDITOR_THEMES = exports.EDITOR_TOOLBAR_MAX_LINE_LENGTH = exports.EDITOR_TOOLBAR_MAX_LINES = exports.NOTE_PAGE_BG_MAX_URL_LENGTH = exports.NOTE_PAGE_BG_MAX_ITEMS = exports.NOTE_FONT_SIZE_MAX = exports.NOTE_FONT_SIZE_MIN = exports.DEFAULT_NOTE_FONT_SIZE = exports.DEFAULT_NOTE_PAGE_LOAD = exports.NOTE_PAGE_LOAD_MODES = exports.MOMENT_ATTACH_SINGLE_FACTOR = exports.MOMENT_ATTACH_RATIO_MAX = exports.MOMENT_ATTACH_RATIO_MIN = exports.DEFAULT_MOMENT_ATTACH_RATIO = exports.MOMENT_ATTACH_ROWS = exports.MOMENT_LAYOUT_STYLES = exports.MOMENT_ATTACH_ALIGNS = exports.MOMENT_ATTACH_SIZES = exports.NOTE_VISIBILITIES = exports.MAX_TAGS_PER_NOTE = exports.MAX_TAG_NAME_LENGTH = exports.MAX_ASSETS_PER_NOTE = exports.MAX_COMMENT_CHARS = exports.DEFAULT_MOMENT_MAX_CHARS = exports.MOMENT_MEDIA_KINDS = exports.NOTE_CONTENT_FORMATS = exports.NOTE_KINDS = void 0;
exports.normalizeNoteKind = normalizeNoteKind;
exports.attachHeightFactorOf = attachHeightFactorOf;
exports.normalizeEditorStyles = normalizeEditorStyles;
exports.normalizeSticky = normalizeSticky;
exports.normalizeToolbarLines = normalizeToolbarLines;
exports.normalizeEditorSettings = normalizeEditorSettings;
exports.normalizeToolLines = normalizeToolLines;
exports.normalizeNotePageBg = normalizeNotePageBg;
exports.normalizeGeneralSettings = normalizeGeneralSettings;
exports.normalizeMomentSettings = normalizeMomentSettings;
exports.normalizeNoteSettings = normalizeNoteSettings;
exports.countTextChars = countTextChars;
exports.countCommentChars = countCommentChars;
exports.mediaKindOfMime = mediaKindOfMime;
exports.mediaKindOf = mediaKindOf;
exports.fileUrlOf = fileUrlOf;
exports.normalizeTagNames = normalizeTagNames;
exports.safeParse = safeParse;
exports.brief = brief;
exports.NOTE_KINDS = ['moment', 'article', 'collection', 'nav', 'todo', 'memo'];
const NOTE_KIND_ALIASES = {
    board: 'memo',
};
function normalizeNoteKind(raw) {
    const s = String(raw ?? '').trim();
    if (!s)
        return '';
    if (exports.NOTE_KINDS.includes(s))
        return s;
    const alias = NOTE_KIND_ALIASES[s];
    return alias || '';
}
exports.NOTE_CONTENT_FORMATS = ['', 'markdown'];
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
exports.NOTE_PAGE_LOAD_MODES = ['auto', 'manual'];
exports.DEFAULT_NOTE_PAGE_LOAD = 'auto';
exports.DEFAULT_NOTE_FONT_SIZE = 14.5;
exports.NOTE_FONT_SIZE_MIN = 12;
exports.NOTE_FONT_SIZE_MAX = 22;
exports.NOTE_PAGE_BG_MAX_ITEMS = 20;
exports.NOTE_PAGE_BG_MAX_URL_LENGTH = 2000;
exports.EDITOR_TOOLBAR_MAX_LINES = 4;
exports.EDITOR_TOOLBAR_MAX_LINE_LENGTH = 400;
exports.EDITOR_THEMES = ['auto', 'light', 'dark'];
exports.HISTORY_INTERVAL_MIN = 1;
exports.HISTORY_INTERVAL_MAX = 120;
exports.DEFAULT_HISTORY_INTERVAL = 3;
exports.DEFAULT_EDITOR_STYLES = {
    h1: 1.75,
    h2: 1.45,
    h3: 1.24,
    h4: 1.1,
    h5: 1,
    h6: 0.94,
    lineHeight: 1.75,
    customCss: '',
};
function normalizeEditorStyles(raw) {
    const o = (raw && typeof raw === 'object' ? raw : {});
    const num = (v, min, max, dflt) => {
        const n = Number(v);
        if (!Number.isFinite(n))
            return dflt;
        return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
    };
    return {
        h1: num(o.h1, 0.9, 3, exports.DEFAULT_EDITOR_STYLES.h1),
        h2: num(o.h2, 0.9, 2.6, exports.DEFAULT_EDITOR_STYLES.h2),
        h3: num(o.h3, 0.9, 2.2, exports.DEFAULT_EDITOR_STYLES.h3),
        h4: num(o.h4, 0.85, 2, exports.DEFAULT_EDITOR_STYLES.h4),
        h5: num(o.h5, 0.8, 1.8, exports.DEFAULT_EDITOR_STYLES.h5),
        h6: num(o.h6, 0.75, 1.6, exports.DEFAULT_EDITOR_STYLES.h6),
        lineHeight: num(o.lineHeight, 1.2, 2.4, exports.DEFAULT_EDITOR_STYLES.lineHeight),
        customCss: String(o.customCss || '').slice(0, 4000),
    };
}
function normalizeSticky(raw) {
    const o = (raw && typeof raw === 'object' ? raw : {});
    const one = (v) => {
        const x = (v && typeof v === 'object' ? v : {});
        return { toolbar: x.toolbar === true, title: x.title === true, aux: x.aux === true };
    };
    return { pc: one(o.pc), m: one(o.m) };
}
exports.DEFAULT_EDITOR_TOOLBAR_LINES = [
    'h1 h2 h3 | bold italic strike underline code highlight | bulletList orderedList taskList | blockquote codeBlock hr',
    'alignLeft alignCenter alignRight | indent outdent | hardBreak paragraph | table [tableAddRow tableAddCol tableDelRow tableDelCol tableMerge tableSplit tableDelete] callout | image upload file video audio link linkExtract | outline foldAll | clear | undo redo',
];
function normalizeToolbarLines(raw) {
    let lines = [];
    if (Array.isArray(raw))
        lines = raw;
    else if (typeof raw === 'string')
        lines = raw.split(/\r?\n/);
    const out = lines
        .map((l) => String(l ?? '').replace(/[\t ]+/g, ' ').trim().slice(0, exports.EDITOR_TOOLBAR_MAX_LINE_LENGTH))
        .filter(Boolean)
        .slice(0, exports.EDITOR_TOOLBAR_MAX_LINES);
    return out.length ? out : exports.DEFAULT_EDITOR_TOOLBAR_LINES.slice();
}
function normalizeEditorSettings(raw) {
    const o = (raw && typeof raw === 'object' ? raw : {});
    const themeRaw = String(o.theme || 'auto');
    const interval = Math.round(Number(o.historyInterval));
    return {
        toolbarLines: normalizeToolbarLines(o.toolbarLines),
        blockIds: o.blockIds === true,
        theme: themeRaw === 'light' || themeRaw === 'dark' ? themeRaw : 'auto',
        inputLines: normalizeToolLines(o.inputLines, 8),
        slashLines: normalizeToolLines(o.slashLines, 12),
        rightClickLines: normalizeToolLines(o.rightClickLines, 12),
        selectionLines: normalizeToolLines(o.selectionLines, 12),
        selectImageLines: normalizeToolLines(o.selectImageLines, 8),
        selectVideoLines: normalizeToolLines(o.selectVideoLines, 8),
        selectAudioLines: normalizeToolLines(o.selectAudioLines, 8),
        selectFileLines: normalizeToolLines(o.selectFileLines, 8),
        historyInterval: Number.isFinite(interval)
            ? Math.min(exports.HISTORY_INTERVAL_MAX, Math.max(exports.HISTORY_INTERVAL_MIN, interval))
            : exports.DEFAULT_HISTORY_INTERVAL,
        sticky: normalizeSticky(o.sticky),
        styles: normalizeEditorStyles(o.styles),
    };
}
function normalizeToolLines(raw, maxLines) {
    let lines = [];
    if (Array.isArray(raw))
        lines = raw;
    else if (typeof raw === 'string')
        lines = raw.split(/\r?\n/);
    return lines
        .map((l) => String(l ?? '').replace(/[\t ]+/g, ' ').trim().slice(0, exports.EDITOR_TOOLBAR_MAX_LINE_LENGTH))
        .filter(Boolean)
        .slice(0, maxLines);
}
function normalizeNotePageBg(raw) {
    let arr = [];
    if (Array.isArray(raw)) {
        arr = raw;
    }
    else {
        const text = String(raw ?? '').trim();
        if (!text)
            return '';
        if (text.startsWith('[')) {
            try {
                const parsed = JSON.parse(text);
                if (!Array.isArray(parsed))
                    return '';
                arr = parsed;
            }
            catch {
                return '';
            }
        }
        else {
            arr = text
                .split(/[\r\n]+/)
                .map((x) => x.trim())
                .filter(Boolean);
        }
    }
    const list = arr
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean)
        .map((x) => x.slice(0, exports.NOTE_PAGE_BG_MAX_URL_LENGTH))
        .filter((x) => /^https?:\/\//i.test(x) || x.startsWith('/'))
        .slice(0, exports.NOTE_PAGE_BG_MAX_ITEMS);
    return list.length ? JSON.stringify(list) : '';
}
function normalizeGeneralSettings(raw) {
    const o = (raw && typeof raw === 'object' ? raw : {});
    const pageLoad = exports.NOTE_PAGE_LOAD_MODES.includes(String(o.pageLoad))
        ? String(o.pageLoad)
        : exports.DEFAULT_NOTE_PAGE_LOAD;
    let fontSize = Number(o.fontSize);
    if (!Number.isFinite(fontSize) || fontSize <= 0)
        fontSize = exports.DEFAULT_NOTE_FONT_SIZE;
    fontSize = Math.min(exports.NOTE_FONT_SIZE_MAX, Math.max(exports.NOTE_FONT_SIZE_MIN, Math.round(fontSize * 10) / 10));
    const pageBg = normalizeNotePageBg(o.pageBg);
    return { pageLoad, fontSize, pageBg };
}
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
    return {
        ...o,
        general: normalizeGeneralSettings(o.general),
        moment: normalizeMomentSettings(o.moment),
        editor: normalizeEditorSettings(o.editor),
    };
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
const REPLY_PREFIX_RE = /^回复 @[^：:\n]{1,40}[：:]/;
function countCommentChars(input) {
    const s = String(input ?? '');
    if (!s)
        return 0;
    return countTextChars(s.replace(REPLY_PREFIX_RE, ''));
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
