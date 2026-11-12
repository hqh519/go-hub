"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitCsv = splitCsv;
exports.numOrNull = numOrNull;
exports.parseFileFilterQuery = parseFileFilterQuery;
exports.isEmptyFileFilter = isEmptyFileFilter;
exports.matchDimPreset = matchDimPreset;
exports.fileFilterGroups = fileFilterGroups;
exports.passesFileFilters = passesFileFilters;
const file_view_1 = require("./file-view");
function splitCsv(v) {
    return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
function numOrNull(raw, max) {
    if (raw === undefined || raw === null || raw === '')
        return null;
    const n = Number(raw);
    if (!Number.isFinite(n))
        return null;
    return Math.max(0, Math.min(max, n));
}
function parseFileFilterQuery(q) {
    const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(q.dateFrom || '')) ? String(q.dateFrom) : '';
    const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(q.dateTo || '')) ? String(q.dateTo) : '';
    const tzMin = Number(q.tz);
    const tzOffset = Number.isFinite(tzMin) ? Math.max(-840, Math.min(840, tzMin)) : 0;
    const dayStartMs = (date) => {
        const [y, m, d] = date.split('-').map(Number);
        return Date.UTC(y, m - 1, d) + tzOffset * 60_000;
    };
    return {
        hasTags: String(q.hasTags || '').toLowerCase(),
        hasRef: String(q.hasRef || '').toLowerCase(),
        hasShare: String(q.hasShare || '').toLowerCase(),
        filterTags: splitCsv(q.filterTags),
        tagMode: String(q.tagMode || 'and').toLowerCase() === 'or' ? 'or' : 'and',
        listType: splitCsv(q.listType),
        label: splitCsv(q.label),
        fileType: splitCsv(q.fileType),
        channel: splitCsv(q.channel),
        channelName: splitCsv(q.channelName),
        uploadSource: splitCsv(q.uploadSource).map((v) => (0, file_view_1.normalizeUploadSource)(v)),
        backup: splitCsv(q.backup),
        redirect: splitCsv(q.redirect),
        access: splitCsv(q.accessStatus),
        validity: splitCsv(q.validity).map((v) => v.toLowerCase()),
        nameChanged: splitCsv(q.nameChanged).map((v) => v.toLowerCase()),
        users: splitCsv(q.filterUsers),
        fromMs: dateFrom ? dayStartMs(dateFrom) : 0,
        toMs: dateTo ? dayStartMs(dateTo) + 86_400_000 - 1 : 0,
        sizeMin: Math.max(0, Number(q.sizeMin) || 0),
        sizeMax: Math.max(0, Number(q.sizeMax) || 0),
        sizeMode: String(q.sizeMode || 'actual').toLowerCase() === 'original' ? 'original' : 'actual',
        ratingMin: numOrNull(q.ratingMin, 5),
        ratingMax: numOrNull(q.ratingMax, 5),
        levelMin: numOrNull(q.levelMin, 5),
        levelMax: numOrNull(q.levelMax, 5),
        dimPreset: splitCsv(q.dimPreset).map((v) => v.toLowerCase()),
        widthMin: Math.max(0, Number(q.widthMin) || 0),
        widthMax: Math.max(0, Number(q.widthMax) || 0),
        heightMin: Math.max(0, Number(q.heightMin) || 0),
        heightMax: Math.max(0, Number(q.heightMax) || 0),
    };
}
function isEmptyFileFilter(f) {
    return (!f.hasTags &&
        !f.hasRef &&
        !f.hasShare &&
        !f.filterTags.length &&
        !f.listType.length &&
        !f.label.length &&
        !f.fileType.length &&
        !f.channel.length &&
        !f.channelName.length &&
        !f.uploadSource.length &&
        !f.backup.length &&
        !f.redirect.length &&
        !f.access.length &&
        !f.validity.length &&
        !f.nameChanged.length &&
        !f.users.length &&
        !f.fromMs &&
        !f.toMs &&
        !f.sizeMin &&
        !f.sizeMax &&
        f.sizeMode !== 'original' &&
        f.ratingMin === null &&
        f.ratingMax === null &&
        f.levelMin === null &&
        f.levelMax === null &&
        !f.dimPreset.length &&
        !f.widthMin &&
        !f.widthMax &&
        !f.heightMin &&
        !f.heightMax);
}
function matchDimPreset(w, h, preset) {
    if (!w || !h)
        return false;
    const short = Math.min(w, h);
    const long = Math.max(w, h);
    const ratio = long / Math.max(1, short);
    switch (preset) {
        case 'landscape':
            return w > h;
        case 'portrait':
            return h > w;
        case 'square':
            return Math.abs(w - h) <= Math.max(2, Math.round(long * 0.01));
        case 'ratio-4-3':
            return Math.abs(ratio - 4 / 3) <= 0.06;
        case 'ratio-16-9':
            return Math.abs(ratio - 16 / 9) <= 0.08;
        case '360p':
            return short >= 300 && short < 420;
        case '480p':
            return short >= 420 && short < 600;
        case '720p':
            return short >= 600 && short < 840;
        case '1080p':
            return short >= 840 && short < 1300;
        case '2k':
            return short >= 1300 && short < 1800;
        case '4k':
            return short >= 1800 && short < 2600;
        case '8k':
            return short >= 4000;
        default:
            return false;
    }
}
function fileFilterGroups(r, f, matchMode = 'all') {
    const groups = [];
    const pushGroup = (values, pred) => {
        if (matchMode === 'all')
            values.forEach((v) => groups.push(pred(v)));
        else
            groups.push(values.some((v) => pred(v)));
    };
    const tagNames = Array.isArray(r.tags)
        ? r.tags.map((t) => t?.tag?.name).filter(Boolean)
        : [];
    if (f.hasTags === 'yes')
        groups.push(tagNames.length > 0);
    else if (f.hasTags === 'no')
        groups.push(tagNames.length === 0);
    if (f.hasRef === 'yes')
        groups.push(Number(r.refCount || 0) > 0);
    else if (f.hasRef === 'no')
        groups.push(Number(r.refCount || 0) <= 0);
    if (f.hasShare === 'yes')
        groups.push(Number(r.shareCount || 0) > 0);
    else if (f.hasShare === 'no')
        groups.push(Number(r.shareCount || 0) <= 0);
    if (f.filterTags.length) {
        groups.push(f.tagMode === 'or'
            ? f.filterTags.some((t) => tagNames.includes(t))
            : f.filterTags.every((t) => tagNames.includes(t)));
    }
    const metas = (0, file_view_1.safeParse)(r.metas);
    const listType = metas.ListType || 'None';
    const label = metas.Label || 'None';
    pushGroup(f.listType, (v) => v === listType);
    pushGroup(f.label, (v) => v === label);
    pushGroup(f.fileType, (v) => v === (0, file_view_1.fileTypeOf)(r.mime));
    const copies = Array.isArray(r.copies) ? r.copies : [];
    const primary = (0, file_view_1.pickPrimaryCopy)(copies);
    const chType = primary?.channel?.type || '';
    const chLabel = chType ? file_view_1.CHANNEL_LABEL[chType] || chType : '';
    const chName = String(primary?.channel?.name || '');
    pushGroup(f.channel, (v) => v === chLabel);
    pushGroup(f.channelName, (v) => v === chName);
    pushGroup(f.uploadSource, (v) => v === (0, file_view_1.normalizeUploadSource)(r.uploadSource));
    pushGroup(f.users, (v) => v === String(r.uploader || ''));
    if (f.backup.length) {
        const hasBackup = copies.some((c) => c !== primary && c?.status === 'active' && (c?.remoteKey || c?.remoteUrl || c?.objectPath));
        pushGroup(f.backup, (v) => (v === 'backedup' ? hasBackup : !hasBackup));
    }
    if (f.redirect.length) {
        const has = !!r.redirectUrl;
        pushGroup(f.redirect, (v) => (v === 'yes' ? has : !has));
    }
    if (f.access.length) {
        const deleted = String(r.status || 'active') === 'deleted';
        const encrypted = !!String(metas.AccessPasswordHash || '').trim();
        pushGroup(f.access, (v) => (v === 'encrypted' && encrypted) ||
            (v === 'deleted' && deleted) ||
            (!deleted && v === 'normal' && listType === 'None') ||
            (!deleted && v === 'block' && listType === 'Block') ||
            (!deleted && v === 'white' && listType === 'White'));
    }
    if (f.fromMs || f.toMs) {
        const t = r.createdAt ? new Date(r.createdAt).getTime() : 0;
        groups.push(!!t && (!f.fromMs || t >= f.fromMs) && (!f.toMs || t <= f.toMs));
    }
    if (f.sizeMin > 0 || f.sizeMax > 0 || f.sizeMode === 'original') {
        const cmpSize = f.sizeMode === 'original' ? Number(r.originalSize) || r.size || 0 : r.size || 0;
        groups.push((!f.sizeMin || cmpSize >= f.sizeMin) && (!f.sizeMax || cmpSize <= f.sizeMax));
    }
    if (f.ratingMin !== null || f.ratingMax !== null || f.levelMin !== null || f.levelMax !== null) {
        const rating = Number(r.rating) || 0;
        const level = Number(r.level) || 0;
        groups.push((f.ratingMin === null || rating >= f.ratingMin) &&
            (f.ratingMax === null || rating <= f.ratingMax) &&
            (f.levelMin === null || level >= f.levelMin) &&
            (f.levelMax === null || level <= f.levelMax));
    }
    if (f.validity.length) {
        const exp = r.linkExpiresAt;
        const expMs = exp ? new Date(exp).getTime() : 0;
        const now = Date.now();
        pushGroup(f.validity, (v) => (v === 'limited' && expMs > now) ||
            (v === 'expired' && expMs > 0 && expMs <= now) ||
            (v === 'permanent' && !expMs));
    }
    if (f.nameChanged.length) {
        const renamed = !!String(r.prevName || '');
        pushGroup(f.nameChanged, (v) => (v === 'changed' ? renamed : !renamed));
    }
    if (f.dimPreset.length || f.widthMin || f.widthMax || f.heightMin || f.heightMax) {
        const w = Number(metas.Width || 0);
        const h = Number(metas.Height || 0);
        if (!w || !h) {
            groups.push(false);
        }
        else {
            const okRange = (!f.widthMin || w >= f.widthMin) &&
                (!f.widthMax || w <= f.widthMax) &&
                (!f.heightMin || h >= f.heightMin) &&
                (!f.heightMax || h <= f.heightMax);
            const okPreset = !f.dimPreset.length || f.dimPreset.some((p) => matchDimPreset(w, h, p));
            groups.push(okRange && okPreset);
        }
    }
    return groups;
}
function passesFileFilters(r, f, matchMode = 'all') {
    const groups = fileFilterGroups(r, f, matchMode);
    if (!groups.length)
        return true;
    return matchMode === 'any' ? groups.some(Boolean) : groups.every(Boolean);
}
