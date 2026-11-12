"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHANNEL_SHORT = exports.CHANNEL_LABEL = exports.CLIENT_UPLOAD_SOURCES = exports.UPLOAD_SOURCES = void 0;
exports.normalizeUploadSource = normalizeUploadSource;
exports.isClientUploadSource = isClientUploadSource;
exports.buildUploadTiming = buildUploadTiming;
exports.channelShort = channelShort;
exports.fileTypeOf = fileTypeOf;
exports.fileExtOf = fileExtOf;
exports.hasFileExt = hasFileExt;
exports.extSuffixFor = extSuffixFor;
exports.formatSize = formatSize;
exports.safeParse = safeParse;
exports.buildDirectoryTree = buildDirectoryTree;
exports.isRecordFile = isRecordFile;
exports.pickPrimaryCopy = pickPrimaryCopy;
exports.buildMetadata = buildMetadata;
exports.serializeFile = serializeFile;
exports.normalizeDir = normalizeDir;
const local_adapter_1 = require("../adapters/local.adapter");
exports.UPLOAD_SOURCES = ['Default', 'Upload', 'Fetch', 'WebDAV', 'API-Web', 'API-S3', 'Record', 'StoreIn', 'StoreOut', 'Attachment'];
exports.CLIENT_UPLOAD_SOURCES = ['Upload', 'Fetch', 'Attachment'];
function normalizeUploadSource(raw) {
    const v = String(raw || '').trim();
    return exports.UPLOAD_SOURCES.includes(v) ? v : 'Default';
}
function isClientUploadSource(raw) {
    return exports.CLIENT_UPLOAD_SOURCES.includes(String(raw || '').trim());
}
function buildUploadTiming(rec) {
    const start = rec.uploadStartedAt ? new Date(rec.uploadStartedAt).getTime() : 0;
    const end = rec.uploadFinishedAt ? new Date(rec.uploadFinishedAt).getTime() : 0;
    const dur = start && end && end >= start ? end - start : 0;
    const bytes = Number(rec.size) || 0;
    const speed = dur > 0 && bytes > 0 ? bytes / (dur / 1000) / 1024 / 1024 : 0;
    return {
        UploadStartedAt: start ? new Date(start).toISOString() : '',
        UploadFinishedAt: end ? new Date(end).toISOString() : '',
        UploadDurationMs: dur,
        UploadSpeedMBps: speed ? Number(speed.toFixed(2)) : 0,
    };
}
exports.CHANNEL_LABEL = {
    cos: 'Tencent',
    minio: 'MinIO',
    r2: 'R2',
    s3: 'S3',
    aliyun: 'Aliyun',
    easyimages: 'Easy',
    lsky: 'Lsky',
    webdav: 'WebDAV',
    immich: 'Immich',
    custom: 'External',
    local: 'Local',
    localfiles: 'File',
};
exports.CHANNEL_SHORT = {
    easyimages: 'EI',
    lsky: 'LS',
    cos: 'COS',
    aliyun: 'OSS',
    immich: 'IM',
    minio: 'MI',
    r2: 'R2',
    s3: 'S3',
    webdav: 'WD',
    custom: 'DIY',
    local: 'LCL',
    localfiles: 'File',
};
function channelShort(typeOrLabel) {
    const raw = String(typeOrLabel || '').trim();
    if (!raw)
        return '';
    const key = raw.toLowerCase();
    if (exports.CHANNEL_SHORT[key])
        return exports.CHANNEL_SHORT[key];
    const byLabel = Object.keys(exports.CHANNEL_LABEL).find((t) => exports.CHANNEL_LABEL[t].toLowerCase() === key);
    if (byLabel && exports.CHANNEL_SHORT[byLabel])
        return exports.CHANNEL_SHORT[byLabel];
    return raw.slice(0, 4).toUpperCase();
}
function fileTypeOf(mime) {
    const m = String(mime || '').toLowerCase().split(';')[0].trim();
    if (!m)
        return 'other';
    if (m.startsWith('image/'))
        return 'image';
    if (m.startsWith('video/'))
        return 'video';
    if (m.startsWith('audio/'))
        return 'audio';
    if (m === 'application/pdf')
        return 'pdf';
    if (m.startsWith('text/') ||
        /^application\/(json|ld\+json|ndjson|x-ndjson|json5|javascript|ecmascript|x-javascript|x-httpd-php|php|x-sh|x-csh|x-yaml|yaml|x-toml|toml|x-properties|sql|x-python|x-ruby|x-perl|x-lua|x-php|x-httpd-php-source|graphql|xml|xhtml\+xml|x-latex|rtf)$/.test(m)) {
        return 'txt';
    }
    return 'other';
}
function fileExtOf(originalName, mime) {
    const m = /\.([A-Za-z0-9]{1,12})$/.exec(String(originalName || ''));
    if (m)
        return m[1].toLowerCase();
    const sub = String(mime || '').split('/')[1] || '';
    const cleaned = sub.split(';')[0].replace(/^x-/, '').trim().toLowerCase();
    if (!cleaned)
        return '';
    return cleaned === 'jpeg' ? 'jpg' : cleaned;
}
function hasFileExt(id) {
    return /\.[A-Za-z0-9]{1,12}$/.test(String(id || ''));
}
function extSuffixFor(id, originalName) {
    void id;
    void originalName;
    return '';
}
function formatSize(bytes) {
    if (!bytes || bytes <= 0)
        return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i += 1;
    }
    return `${i === 0 ? n : n.toFixed(2)} ${units[i]}`;
}
function safeParse(raw) {
    if (!raw)
        return {};
    try {
        const v = JSON.parse(raw);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    }
    catch {
        return {};
    }
}
function buildDirectoryTree(directories) {
    const root = { name: '/', path: '', children: [] };
    const nodeMap = new Map([['', root]]);
    for (const dirPath of [...directories].sort()) {
        if (!dirPath)
            continue;
        const normalized = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
        const parts = normalized.split('/').filter(Boolean);
        let currentPath = '';
        let parent = root;
        for (const part of parts) {
            currentPath += `${part}/`;
            const existing = nodeMap.get(currentPath);
            if (existing) {
                parent = existing;
                continue;
            }
            const node = { name: part, path: currentPath, children: [] };
            parent.children.push(node);
            nodeMap.set(currentPath, node);
            parent = node;
        }
    }
    const sortChildren = (node) => {
        node.children.sort((a, b) => a.name.localeCompare(b.name));
        node.children.forEach(sortChildren);
    };
    sortChildren(root);
    return root;
}
function isRecordFile(rec) {
    if (!rec)
        return false;
    if (String(rec.uploadSource || '') === 'Record')
        return true;
    const metas = typeof rec.metas === 'string'
        ? safeParse(rec.metas)
        : rec.metas;
    return !!(metas && metas.Registered === true);
}
function pickPrimaryCopy(copies) {
    const list = Array.isArray(copies) ? copies.filter(Boolean) : [];
    if (!list.length)
        return undefined;
    return (list.find((c) => c.isPrimary === true && (!c.status || c.status === 'active')) ||
        list.find((c) => c.isPrimary === true) ||
        list.find((c) => c.channel?.isMain === true) ||
        list[0]);
}
function realNameOfCopy(copy) {
    const key = String(copy?.remoteKey || '').replace(/\\/g, '/');
    if (!key)
        return '';
    const seg = key.split('/').filter(Boolean).pop() || '';
    return seg;
}
function buildMetadata(rec, copies, opts = {}) {
    const metas = safeParse(rec.metas);
    const primary = pickPrimaryCopy(copies);
    const channelLabel = primary?.channel ? exports.CHANNEL_LABEL[primary.channel.type] || primary.channel.type : '';
    const backupChannels = copies
        .filter((c) => c !== primary && c.status === 'active' && c.channel?.isBackup)
        .map((c) => ({
        id: c.channelId,
        code: c.channel.code || '',
        type: c.channel.type,
        label: exports.CHANNEL_LABEL[c.channel.type] || c.channel.type,
        short: channelShort(c.channel.type),
        name: c.channel.name,
        url: (opts.resolveDirectUrl ? opts.resolveDirectUrl(c, rec) : '') || '',
    }));
    const otherCopies = copies
        .filter((c) => c !== primary && c.status === 'active' && c.channel && !c.channel.isBackup)
        .map((c) => ({
        id: c.channelId,
        type: c.channel.type,
        name: c.channel.name,
        label: exports.CHANNEL_LABEL[c.channel.type] || c.channel.type,
    }));
    const storageUrl = (primary && opts.resolveDirectUrl ? opts.resolveDirectUrl(primary, rec) : '') || '';
    const loadUrl = (primary && (opts.resolveLoadUrl || opts.resolveDirectUrl)
        ? (opts.resolveLoadUrl || opts.resolveDirectUrl)(primary, rec)
        : '') || '';
    const size = Number(rec.size) || 0;
    const rawOriginalSize = Number(rec.originalSize) || 0;
    const originalSize = rawOriginalSize > 0 ? rawOriginalSize : size;
    const meta = {
        FileName: rec.originalName,
        FileFirstName: rec.firstName || rec.name,
        FilePrevName: rec.prevName || '',
        FileType: fileTypeOf(rec.mime),
        FileExt: fileExtOf(rec.originalName, rec.mime),
        FileRealName: realNameOfCopy(primary),
        FileSize: formatSize(size),
        FileSizeBytes: size,
        FileSizeOriginal: formatSize(originalSize),
        FileSizeOriginalBytes: originalSize,
        MD5: rec.md5 || '',
        Views: rec.views || 0,
        UploadIP: rec.ip || '',
        UploadAddress: metas.UploadAddress || '',
        UploadUser: rec.uploader || '',
        UploadSource: normalizeUploadSource(rec.uploadSource),
        ...buildUploadTiming(rec),
        RedirectUrl: rec.redirectUrl || '',
        LinkExpiresAt: rec.linkExpiresAt
            ? rec.linkExpiresAt.getTime()
            : 0,
        ListType: metas.ListType || 'None',
        LastViewedAt: rec.lastViewedAt
            ? rec.lastViewedAt.getTime()
            : 0,
        Rating: Number(rec.rating) || 0,
        Level: Number(rec.level) || 0,
        TimeStamp: rec.createdAt.getTime(),
        Label: metas.Label || 'None',
        Directory: rec.folder ? `${rec.folder.replace(/\/+$/, '')}/` : '',
        Tags: opts.tags || metas.Tags || [],
        Channel: channelLabel,
        ChannelShort: primary?.channel ? channelShort(primary.channel.type) : '',
        ChannelType: primary?.channel?.type || '',
        ChannelId: primary?.channelId || '',
        ChannelCode: primary?.channel?.code || '',
        ChannelName: primary?.channel?.name || '',
        StorageUrl: storageUrl,
        LoadUrl: loadUrl || storageUrl,
        LocalPath: primary ? (0, local_adapter_1.localAbsPathOf)(primary.channel, primary.remoteKey || '') : '',
        BackupChannels: backupChannels,
        OtherCopies: otherCopies,
        FileHash: rec.hash || '',
    };
    if (metas.Width)
        meta.Width = metas.Width;
    if (metas.Height)
        meta.Height = metas.Height;
    if (metas.ExternalLink)
        meta.ExternalLink = metas.ExternalLink;
    for (const [k, v] of Object.entries(metas)) {
        if (!(k in meta))
            meta[k] = v;
    }
    return meta;
}
function serializeFile(rec, copies, opts = {}) {
    return { name: rec.name, metadata: buildMetadata(rec, copies, opts) };
}
function normalizeDir(dir) {
    let d = (dir || '').replace(/\.\./g, '_').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    if (d.startsWith('/'))
        d = d.substring(1);
    if (d && !d.endsWith('/'))
        d += '/';
    return d;
}
