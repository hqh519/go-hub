"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var UploadService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const stream_1 = require("stream");
const promises_1 = require("stream/promises");
const prisma_1 = require("../common/prisma");
const tags_1 = require("../common/tags");
const crypto_service_1 = require("../common/crypto.service");
const settings_service_1 = require("../settings/settings.service");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const tag_defaults_1 = require("../common/tag-defaults");
const channels_controller_1 = require("../channels/channels.controller");
const storage_channel_service_1 = require("../storage/storage-channel.service");
const adapter_factory_1 = require("../adapters/adapter.factory");
const local_adapter_1 = require("../adapters/local.adapter");
const adapter_interface_1 = require("../adapters/adapter.interface");
const file_view_1 = require("../common/file-view");
const app_log_1 = require("../common/app-log");
const path_template_1 = require("../common/path-template");
const compress_1 = require("../common/compress");
const media_post_1 = require("./media-post");
const COMPRESS_MAX_BYTES = Math.max(512, Number(process.env.COMPRESS_MAX_MB || 4096)) * 1024 * 1024;
const STREAM_REQUIRED_BYTES = 256 * 1024 * 1024;
let UploadService = class UploadService {
    static { UploadService_1 = this; }
    settings;
    channels;
    sysConfig;
    storageChannel;
    static DEFAULT_EXT = [
        'jpg', 'png', 'gif', 'jpeg', 'webp', 'bmp',
        'mp4', 'webm', 'mov', 'm4v',
        'mp3', 'm4a', 'aac', 'ogg',
    ];
    constructor(settings, channels, sysConfig, storageChannel) {
        this.settings = settings;
        this.channels = channels;
        this.sysConfig = sysConfig;
        this.storageChannel = storageChannel;
    }
    activeUploads = 0;
    poolCursor = 0;
    lowPriorityChain = Promise.resolve();
    enqueueLowPriority(task) {
        const run = this.lowPriorityChain.then(async () => {
            await this.waitForUploadIdle();
            return task();
        });
        this.lowPriorityChain = run.catch((err) => {
            console.error('[backup] 低优先级任务异常:', err?.message || err);
            return undefined;
        });
        return run;
    }
    backgroundChain = Promise.resolve();
    enqueueBackground(task) {
        const run = this.backgroundChain.then(() => new Promise((r) => setImmediate(r))).then(task);
        this.backgroundChain = run.catch((err) => {
            console.warn('[bg] 后台任务异常:', err?.message || err);
            return undefined;
        });
        return run;
    }
    tagChain = Promise.resolve();
    enqueueTagTask(task) {
        const run = this.tagChain.then(() => new Promise((r) => setImmediate(r))).then(task);
        this.tagChain = run.catch((err) => {
            console.warn('[tag] 自动标签任务异常:', err?.message || err);
            return undefined;
        });
        return run;
    }
    async waitForUploadIdle(maxWaitMs = 20000) {
        const started = Date.now();
        while (this.activeUploads > 0 && Date.now() - started < maxWaitMs) {
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
    }
    async userEnforceLimits(username) {
        const name = String(username || '').trim();
        if (!name)
            return true;
        try {
            const row = await prisma_1.prisma.user.findUnique({
                where: { username: name },
                select: { enforceLimits: true },
            });
            if (row)
                return row.enforceLimits !== false;
            const security = await this.sysConfig.get('security');
            const adminName = String(security?.auth?.admin?.adminUsername || '').trim() ||
                (process.env.ADMIN_USER || '').trim() ||
                'admin';
            if (name === adminName) {
                const prof = await this.sysConfig.get('adminProfile');
                return prof?.enforceLimits !== false;
            }
            return true;
        }
        catch {
            return true;
        }
    }
    async limits() {
        try {
            const page = await this.sysConfig.get('page');
            const get = (id) => (page?.config || []).find((x) => x.id === id)?.value;
            const raw = get('allowedExtensions');
            const exts = String(raw || UploadService_1.DEFAULT_EXT.join(','))
                .split(',')
                .map((s) => s.trim().replace(/^\./, '').toLowerCase())
                .filter(Boolean);
            const maxMB = Number(get('maxUploadSizeMB')) || 1024;
            return { exts: exts.length ? exts : UploadService_1.DEFAULT_EXT, maxMB };
        }
        catch {
            return { exts: UploadService_1.DEFAULT_EXT, maxMB: 1024 };
        }
    }
    signatureOk(buf, ext) {
        if (buf.length < 4)
            return null;
        const hex = buf.subarray(0, 16).toString('hex');
        const a4 = buf.subarray(0, 4).toString('latin1');
        const b4 = buf.subarray(4, 8).toString('latin1');
        switch (ext) {
            case 'jpg':
            case 'jpeg':
                return hex.startsWith('ffd8ff');
            case 'png':
                return hex.startsWith('89504e47');
            case 'gif':
                return a4 === 'GIF8';
            case 'webp':
                return a4 === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
            case 'bmp':
                return hex.startsWith('424d');
            case 'webm':
                return hex.startsWith('1a45dfa3');
            case 'ogg':
                return a4 === 'OggS';
            case 'mp4':
            case 'm4v':
            case 'm4a':
                return b4 === 'ftyp';
            case 'mov':
                return b4 === 'ftyp' || ['moov', 'mdat', 'free', 'wide'].includes(b4);
            case 'aac':
                return /^fff[019]/.test(hex);
            case 'mp3':
                return hex.startsWith('494433') || /^ff[ef][0-9a-f]/.test(hex);
            default:
                return null;
        }
    }
    static IMG_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);
    static detectImageExt(buf) {
        if (buf.length < 12)
            return null;
        const hex = buf.subarray(0, 16).toString('hex');
        const a4 = buf.subarray(0, 4).toString('latin1');
        if (hex.startsWith('ffd8ff'))
            return 'jpg';
        if (hex.startsWith('89504e47'))
            return 'png';
        if (a4 === 'GIF8')
            return 'gif';
        if (a4 === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP')
            return 'webp';
        if (hex.startsWith('424d'))
            return 'bmp';
        return null;
    }
    static EXT_MIME = { jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
        mp4: 'video/mp4',
        m4v: 'video/mp4',
        webm: 'video/webm',
        mov: 'video/quicktime',
        mp3: 'audio/mpeg',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        ogg: 'audio/ogg',
    };
    normalizeMime(originalName, clientMime) {
        const ext = (originalName.split('.').pop() || '').toLowerCase();
        const mapped = UploadService_1.EXT_MIME[ext];
        if (mapped)
            return mapped;
        const cm = (clientMime || '').split(';')[0].trim().toLowerCase();
        if (cm && cm !== 'application/octet-stream')
            return cm;
        return 'application/octet-stream';
    }
    async validate(input, override, uploader) {
        const base = await this.limits();
        const exts = override?.exts && override.exts.length ? override.exts : base.exts;
        const userMaxMB = await this.userMaxFileSizeMB(uploader);
        const maxMB = override?.maxMB && override.maxMB > 0
            ? override.maxMB
            : userMaxMB > 0
                ? userMaxMB
                : base.maxMB;
        const ext = (input.originalName.split('.').pop() || '').toLowerCase();
        if (!ext || ext === input.originalName.toLowerCase()) {
            return '无法识别文件类型（缺少扩展名）';
        }
        if (!exts.includes(ext)) {
            return `不支持的格式 .${ext}，允许：${exts.join('/')}`;
        }
        const size = Number(input.size || 0) || (input.path ? (await fs_1.promises.stat(input.path)).size : input.buffer.length);
        if (size > maxMB * 1024 * 1024) {
            const scope = userMaxMB > 0 && !(override?.maxMB && override.maxMB > 0)
                ? `该账户的单文件大小限制为 ${maxMB}MB`
                : `单文件大小上限 ${maxMB}MB（可在「其他设置 → 上传相关配置」调整）`;
            return `文件超过${scope}（当前 ${(size / 1024 / 1024).toFixed(1)}MB）`;
        }
        const head = input.buffer.length ? input.buffer.subarray(0, 64) : await this.readHead(input.path || '', 64);
        if (this.signatureOk(head, ext) === false) {
            const realExt = UploadService_1.detectImageExt(head);
            app_log_1.appLog.warn('upload', `魔数不符放行（v3.0.0 起只验扩展名）：声明 .${ext}${realExt ? `，实际内容疑似 .${realExt}` : ''}`, input.originalName);
            return null;
        }
        return null;
    }
    async readHead(path, n) {
        if (!path)
            return Buffer.alloc(0);
        const fh = await fs_1.promises.open(path, 'r');
        try {
            const buf = Buffer.alloc(n);
            const { bytesRead } = await fh.read(buf, 0, n, 0);
            return buf.subarray(0, bytesRead);
        }
        finally {
            await fh.close().catch(() => undefined);
        }
    }
    async moderate(buffer, mime) {
        if (!mime.startsWith('image/'))
            return null;
        let cfg;
        try {
            const security = await this.sysConfig.get('security');
            cfg = security?.upload?.moderate;
        }
        catch {
            return null;
        }
        if (!cfg?.enabled)
            return null;
        const timeout = AbortSignal.timeout(8000);
        try {
            if (cfg.channel === 'moderatecontent.com') {
                if (!cfg.moderateContentApiKey)
                    return null;
                const form = new FormData();
                form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), 'image');
                const resp = await fetch(`https://api.moderatecontent.com/moderate/?key=${encodeURIComponent(cfg.moderateContentApiKey)}`, { method: 'POST', body: form, signal: timeout });
                const json = await resp.json();
                const idx = Number(json?.rating_index);
                if (Number.isFinite(idx) && idx >= 3) {
                    return `图片未通过内容审查（评级 ${json?.rating_letter || idx}）`;
                }
            }
            else if (cfg.channel === 'nsfwjs') {
                if (!cfg.nsfwApiPath)
                    return null;
                const form = new FormData();
                form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), 'image');
                const resp = await fetch(cfg.nsfwApiPath, { method: 'POST', body: form, signal: timeout });
                const json = await resp.json();
                let porn = 0;
                if (typeof json?.porn === 'number') {
                    porn = json.porn;
                }
                else if (Array.isArray(json?.predictions)) {
                    porn = Math.max(0, ...json.predictions
                        .filter((p) => ['Porn', 'Hentai', 'Sexy'].includes(p?.className))
                        .map((p) => Number(p?.probability) || 0));
                }
                if (porn >= 0.6) {
                    return `图片未通过内容审查（敏感度 ${porn.toFixed(2)}）`;
                }
            }
        }
        catch (err) {
            console.warn('[moderate] 审查接口异常，放行:', err.message);
        }
        return null;
    }
    async cachedAddress(ip) {
        if (!ip)
            return '';
        try {
            const cached = await prisma_1.prisma.ipRecord.findUnique({ where: { ip } });
            if (cached && (cached.country || cached.region || cached.city)) {
                return [cached.country, cached.region, cached.city].filter(Boolean).join(' ');
            }
        }
        catch {
        }
        return '';
    }
    async resolveAddress(ip) {
        if (!ip)
            return '';
        try {
            const cached = await prisma_1.prisma.ipRecord.findUnique({ where: { ip } });
            if (cached && (cached.country || cached.region || cached.city)) {
                return [cached.country, cached.region, cached.city].filter(Boolean).join(' ');
            }
        }
        catch {
        }
        let cfg;
        try {
            const security = await this.sysConfig.get('security');
            cfg = security?.upload?.ipQuery;
        }
        catch {
            return '';
        }
        if (!cfg?.enabled)
            return '';
        const timeout = AbortSignal.timeout(6000);
        try {
            let country = '';
            let region = '';
            let city = '';
            if (cfg.channel === 'customApi' && cfg.customApi?.url) {
                let url = String(cfg.customApi.url);
                for (const p of cfg.customApi.params || []) {
                    if (!p?.key)
                        continue;
                    url = url.replace(new RegExp(`\\{${p.key}\\}`, 'g'), encodeURIComponent(p.value === '{ip}' ? ip : p.value));
                }
                const resp = await fetch(url, { signal: timeout });
                const json = await resp.json();
                const pick = (path) => String(path)
                    .split('.')
                    .reduce((o, k) => (o == null ? '' : o[k]), json) || '';
                const fields = cfg.customApi.responseFields || [];
                const parts = fields.map(pick).filter(Boolean);
                const address = parts.join(' ');
                if (address)
                    await this.cacheAddress(ip, '', '', address);
                return address;
            }
            const resp = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN`, {
                signal: timeout,
            });
            const json = await resp.json();
            country = json?.country || '';
            region = json?.regionName || '';
            city = json?.city || '';
            const address = [country, region, city].filter(Boolean).join(' ');
            if (address)
                await this.cacheAddress(ip, country, region, [city].filter(Boolean).join(' '));
            return address;
        }
        catch (err) {
            console.warn('[ipQuery] 归属地查询失败:', err.message);
            return '';
        }
    }
    async cacheAddress(ip, country, region, city) {
        await prisma_1.prisma.ipRecord.upsert({
            where: { ip },
            update: { country, region, city },
            create: { ip, country, region, city },
        });
    }
    async touchIp(ip, address) {
        if (!ip)
            return;
        try {
            const parts = (address || '').split(' ');
            await prisma_1.prisma.ipRecord.upsert({
                where: { ip },
                update: { uploadCount: { increment: 1 } },
                create: {
                    ip,
                    country: parts[0] || '',
                    region: parts[1] || '',
                    city: parts.slice(2).join(' '),
                    uploadCount: 1,
                },
            });
        }
        catch (err) {
            console.warn('[ipRecord] 计数失败:', err.message);
        }
    }
    async autoTag(fileId, info) {
        try {
            const legacyOn = (await this.settings.get('autoTagEnabled', 'true')) !== 'false';
            const instanceId = String(info.instanceId || '').trim();
            const owner = String(info.owner || '').trim();
            let rules = {
                enabled: true,
                placeholders: UploadService_1.DEFAULT_TAG_PLACEHOLDERS,
                extract: '',
                markerEnabled: true,
                startChars: UploadService_1.DEFAULT_TAG_START,
                stopChars: UploadService_1.DEFAULT_TAG_STOP,
                maxLen: UploadService_1.DEFAULT_TAG_MAX_LEN,
            };
            try {
                const cfg = await this.sysConfig.get('others');
                const at = (cfg && cfg.autoTag) || {};
                rules = {
                    enabled: at.enabled === undefined ? true : !(at.enabled === false || String(at.enabled) === 'false'),
                    placeholders: at.placeholders === undefined ? UploadService_1.DEFAULT_TAG_PLACEHOLDERS : String(at.placeholders ?? ''),
                    extract: at.extract === undefined ? '' : String(at.extract ?? ''),
                    markerEnabled: at.markerEnabled === undefined ? true : !(at.markerEnabled === false || String(at.markerEnabled) === 'false'),
                    startChars: String(at.startChars ?? '').trim() || UploadService_1.DEFAULT_TAG_START,
                    stopChars: String(at.stopChars ?? '').trim() || UploadService_1.DEFAULT_TAG_STOP,
                    maxLen: at.maxLen === undefined ? UploadService_1.DEFAULT_TAG_MAX_LEN : Math.max(0, Number(at.maxLen) || 0),
                };
            }
            catch (err) {
                app_log_1.appLog.warn('upload', `读取自动标签规则失败，使用默认规则`, err?.message || String(err));
            }
            const extraTags = (info.extraTags || [])
                .map((t) => String(t || '').trim().slice(0, 20))
                .filter(Boolean)
                .slice(0, 10);
            if (!(legacyOn && rules.enabled) && !extraTags.length)
                return;
            const autoNames = [];
            if (legacyOn && rules.enabled) {
                const now = new Date();
                const ext = info.originalName.includes('.')
                    ? String(info.originalName.split('.').pop() || '').toLowerCase().replace(/^\./, '')
                    : '';
                const vars = {
                    mime: (0, file_view_1.fileTypeOf)(info.mime),
                    ext,
                    channelName: (0, file_view_1.channelShort)(info.channelType),
                    uploadSource: (0, file_view_1.normalizeUploadSource)(info.uploadSource),
                    y: String(now.getFullYear()),
                    m: String(now.getMonth() + 1).padStart(2, '0'),
                    d: String(now.getDate()).padStart(2, '0'),
                    width: info.width ? String(info.width) : '',
                    height: info.height ? String(info.height) : '',
                };
                for (const piece of String(rules.placeholders || '').split(/[,，\n]/)) {
                    const raw = piece.trim();
                    if (!raw)
                        continue;
                    let resolved = false;
                    const rendered = raw.replace(/\{(mime|ext|channelName|uploadSource|y|m|d|width|height)\}/g, (_m, k) => {
                        const v = vars[k] || '';
                        if (v)
                            resolved = true;
                        return v;
                    });
                    if (raw.includes('{') && !resolved)
                        continue;
                    const name = rendered.trim();
                    if (name)
                        autoNames.push(name);
                }
                for (const rule of UploadService_1.parseTagExtractRules(rules.extract)) {
                    if (String(info.originalName || '').includes(rule.find))
                        autoNames.push(rule.tag);
                }
                if (rules.markerEnabled) {
                    for (const hit of UploadService_1.extractByMarkers(String(info.originalName || ''), rules.startChars, rules.stopChars, rules.maxLen)) {
                        autoNames.push(hit);
                    }
                }
            }
            const names = Array.from(new Set([...autoNames, ...extraTags]
                .map((v) => String(v || '').trim().slice(0, 20))
                .filter(Boolean))).slice(0, 30);
            for (const name of names) {
                const tag = await (0, tags_1.findOrCreateTag)(name, instanceId, owner, tags_1.TAG_TYPE_FILE);
                const exists = await prisma_1.prisma.fileTag.findFirst({
                    where: { fileId, tagId: tag.id },
                    select: { id: true },
                });
                if (!exists)
                    await prisma_1.prisma.fileTag.create({ data: { fileId, tagId: tag.id } });
            }
        }
        catch (err) {
            app_log_1.appLog.warn('upload', `自动打标签失败（不影响文件本身）`, err?.message || String(err));
        }
    }
    static DEFAULT_TAG_PLACEHOLDERS = '{mime},{ext},{channelName},{uploadSource},{y}';
    static DEFAULT_TAG_START = tag_defaults_1.DEFAULT_TAG_START;
    static DEFAULT_TAG_STOP = tag_defaults_1.DEFAULT_TAG_STOP;
    static DEFAULT_TAG_MAX_LEN = tag_defaults_1.DEFAULT_TAG_MAX_LEN;
    static parseMarkerList(raw, keepEmpty = false) {
        const s = String(raw || '').trim();
        if (!s)
            return [];
        let items = [];
        if (s.startsWith('[') && s.endsWith(']')) {
            try {
                const j = JSON.parse(s);
                if (Array.isArray(j))
                    items = j.map((v) => String(v ?? ''));
            }
            catch {
                items = [];
            }
        }
        if (!items.length)
            items = Array.from(s);
        const cleaned = items.map((v) => String(v ?? '').trim());
        return Array.from(new Set(keepEmpty ? cleaned : cleaned.filter(Boolean)));
    }
    static extractByMarkers(originalName, startRaw, stopRaw, maxLen = 0) {
        const name = String(originalName || '');
        if (!name)
            return [];
        const rawStarts = UploadService_1.parseMarkerList(startRaw, true);
        const hasEmptyStart = rawStarts.includes('');
        const starts = rawStarts.filter(Boolean);
        if (!starts.length && !hasEmptyStart)
            return [];
        const stops = UploadService_1.parseMarkerList(stopRaw);
        const isStop = (ch) => /[\s]/.test(ch) || stops.some((s) => ch.startsWith(s));
        const matchStart = (idx) => {
            for (const s of starts) {
                if (s && name.startsWith(s, idx))
                    return s;
            }
            return null;
        };
        const out = [];
        let pos = 0;
        let guard = 0;
        while (pos < name.length && guard < 50) {
            guard += 1;
            let hit = -1;
            let hitLen = 0;
            for (let i = pos; i < name.length; i += 1) {
                const s = matchStart(i);
                if (s) {
                    hit = i;
                    hitLen = s.length;
                    break;
                }
            }
            if (hit < 0) {
                if (!hasEmptyStart || pos > 0)
                    break;
                hit = 0;
                hitLen = 0;
            }
            let cur = hit + hitLen;
            for (;;) {
                const s = matchStart(cur);
                if (!s)
                    break;
                cur += s.length;
            }
            let end = cur;
            while (end < name.length && !isStop(name[end]))
                end += 1;
            let content = name.slice(cur, end).trim();
            if (end >= name.length)
                content = content.replace(/\.[A-Za-z0-9]{1,10}$/, '');
            if (content && (maxLen <= 0 || content.length <= maxLen) && !out.includes(content))
                out.push(content);
            pos = end > hit ? end : hit + hitLen;
            if (out.length >= 20)
                break;
        }
        return out;
    }
    static parseTagExtractRules(raw) {
        const out = [];
        const s = String(raw || '').trim();
        if (!s)
            return out;
        const push = (find, tag) => {
            const f = String(find ?? '').trim();
            const t = String(tag ?? '').trim();
            if (f && t && !out.some((x) => x.find === f))
                out.push({ find: f, tag: t });
        };
        try {
            const j = JSON.parse(s);
            if (Array.isArray(j)) {
                for (const it of j) {
                    if (Array.isArray(it) && it.length >= 2)
                        push(it[0], it[1]);
                    else if (it && typeof it === 'object')
                        push(it.find ?? it.key, it.tag ?? it.value);
                    else if (typeof it === 'string') {
                        const sep = it.indexOf(':');
                        if (sep > 0)
                            push(it.slice(0, sep), it.slice(sep + 1));
                    }
                }
            }
            else if (j && typeof j === 'object') {
                for (const [k, v] of Object.entries(j))
                    push(k, v);
            }
            if (out.length)
                return out;
        }
        catch {
        }
        const re = /["']([^"']+)["']\s*:\s*["']([^"']*)["']/g;
        let m;
        while ((m = re.exec(s)) !== null)
            push(m[1], m[2]);
        return out;
    }
    static extractHashTags(originalName) {
        const out = [];
        const re = /#([0-9A-Za-z\u4e00-\u9fff]{1,8})(?![0-9A-Za-z\u4e00-\u9fff])/g;
        let m;
        while ((m = re.exec(String(originalName || ''))) !== null) {
            const tag = m[1];
            if (tag && !out.includes(tag))
                out.push(tag);
            if (out.length >= 10)
                break;
        }
        return out;
    }
    toChannelInfo(c) {
        return {
            id: c.id,
            code: c.code,
            name: c.name,
            type: c.type,
            config: this.channels.decryptConfig(c.type, c.config),
            metas: {},
        };
    }
    async channelWritable(c) {
        let cfg = {};
        try {
            cfg = JSON.parse(c.config || '{}');
        }
        catch {
            return true;
        }
        if (cfg.quotaEnabled !== 'true')
            return true;
        const limitGB = Number(cfg.quotaLimitGB) || 10;
        const threshold = Number(cfg.quotaThreshold) || 95;
        const rows = await prisma_1.prisma.fileCopy.findMany({
            where: { channelId: c.id, status: 'active' },
            include: { file: { select: { size: true } } },
        });
        const usedGB = rows.reduce((a, b) => a + (b.file?.size || 0), 0) / 1024 / 1024 / 1024;
        return usedGB / limitGB < threshold / 100;
    }
    async findChannelById(key) {
        return this.storageChannel.findById(key);
    }
    async resolveMainChannel(q = {}) {
        if (q.channelId) {
            const raw = await this.storageChannel.findRawById(q.channelId);
            if (raw && !raw.enabled) {
                app_log_1.appLog.warn('upload', `拒绝上传：渠道「${raw.name}」已停用`, `渠道 ID=${raw.code}`);
                throw new Error(`渠道「${raw.name}」已停用，请先在后台「上传设置 → 存储渠道管理」启用后再上传`);
            }
        }
        const list = await this.storageChannel.getStorageChannelCandidates('main', {
            explicitId: q.channelId,
            channelType: q.channelType,
            uploader: q.uploader,
            tokenId: q.tokenId,
        });
        if (q.preferredId && !list.some((c) => c.id === q.preferredId)) {
            const extra = await this.storageChannel.findById(q.preferredId);
            if (extra)
                list.push(extra);
        }
        for (const c of list) {
            if (await this.channelWritable(c))
                return c;
        }
        if (q.channelId && list.length) {
            throw new Error(`渠道「${list[0].name}」已达到容量阈值，写入已暂停`);
        }
        return null;
    }
    async resolveBackupChannel(q = {}) {
        const list = await this.storageChannel.getStorageChannelCandidates('backup', {
            explicitId: q.explicitId,
            uploader: q.uploader,
            tokenId: q.tokenId,
        });
        if (q.preferredId && !list.some((c) => c.id === q.preferredId)) {
            const extra = await this.storageChannel.findById(q.preferredId);
            if (extra)
                list.push(extra);
        }
        for (const c of list) {
            if (await this.channelWritable(c))
                return c;
        }
        return null;
    }
    async backupEnabled() {
        const sw = await this.settings.get('backupEnabled', 'true');
        return sw === 'true';
    }
    makeKeyFor(channel, originalName, nameType, md5, uploader) {
        const dot = originalName.lastIndexOf('.');
        const ext = dot > 0 ? originalName.slice(dot + 1).toLowerCase() : '';
        const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
        if ((0, path_template_1.supportsPrefix)(channel.type)) {
            let cfg = {};
            try {
                cfg = this.channels.decryptConfig(channel.type, channel.config);
            }
            catch {
                cfg = {};
            }
            let fileName;
            const customName = String(cfg.customName || cfg.nameTemplate || '').trim();
            if (customName) {
                fileName = (0, path_template_1.renderFileName)(customName, { originalName, stem, ext, md5, timestamp: Date.now() });
            }
            else if (nameType === 'original') {
                fileName = ext ? `${stem}.${ext}` : stem;
            }
            else if (nameType === 'index') {
                fileName = `${Date.now()}.${ext || 'bin'}`;
            }
            else {
                fileName = (0, path_template_1.renderFileName)('', { originalName, stem, ext, md5, timestamp: Date.now() });
            }
            const prefix = (0, path_template_1.renderObjectPrefix)(cfg.objectPrefix || cfg.keyPrefix, new Date(), {
                channelId: channel.code || channel.id,
                user: uploader,
                domain: cfg.publicDomain || cfg.domain,
            }, channel.type === 'local' ? path_template_1.LOCAL_DEFAULT_PREFIX : undefined);
            return (0, path_template_1.joinObjectKey)(prefix, fileName);
        }
        const date = new Date();
        const datePath = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
        let name;
        switch (nameType) {
            case 'original':
                name = stem;
                break;
            case 'index':
                name = datePath + String(date.getTime());
                break;
            default:
                name = crypto_service_1.CryptoService.shortId();
        }
        return `${datePath}/${name}${ext ? '.' + ext : ''}`;
    }
    async resolveFolder(input) {
        const clean = (input || '').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
        if (clean)
            return clean;
        try {
            const page = await this.sysConfig.get('page');
            const v = String((page?.config || []).find((x) => x.id === 'defaultUploadFolder')?.value || '').trim();
            const dv = v.replace(/^\/+|\/+$/g, '');
            if (dv)
                return dv;
        }
        catch {
        }
        const d = new Date();
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    async pageValue(id, fallback = '') {
        try {
            const page = await this.sysConfig.get('page');
            const hit = (page?.config || []).find((x) => x.id === id);
            if (hit && hit.value !== undefined && hit.value !== null)
                return String(hit.value);
        }
        catch {
        }
        return fallback;
    }
    async mediaSettings() {
        const num = (raw, fallback) => {
            const t = String(raw ?? '').trim();
            if (t === '')
                return fallback;
            const n = Number(t);
            if (!Number.isFinite(n) || n < 0)
                return fallback;
            return n === 0 ? 0 : Math.floor(n);
        };
        const numF = (raw, fallback) => {
            const t = String(raw ?? '').trim();
            if (t === '')
                return fallback;
            const n = Number(t);
            if (!Number.isFinite(n) || n < 0)
                return fallback;
            return n;
        };
        const bool = (raw, fallback) => {
            const t = String(raw ?? '').trim().toLowerCase();
            if (t === '')
                return fallback;
            return t === 'true' || t === '1';
        };
        const [cMax, tMax, cConc, tConc, retry, times, autoSwitch, guardOn, guardLoad, guardRam] = await Promise.all([
            this.pageValue('compressMaxSeconds', '600'),
            this.pageValue('videoTranscodeMaxSeconds', '600'),
            this.pageValue('compressConcurrency', '1'),
            this.pageValue('videoTranscodeConcurrency', '1'),
            this.pageValue('defaultAutoRetry', 'true'),
            this.pageValue('defaultRetryTimes', '3'),
            this.pageValue('defaultAutoSwitch', 'true'),
            this.pageValue('mediaResourceGuardEnabled', 'true'),
            this.pageValue('mediaResourceLoadLimit', '1.5'),
            this.pageValue('mediaResourceRamLimit', '256'),
        ]);
        return {
            compressMax: num(cMax, 600),
            transcodeMax: num(tMax, 600),
            compressConcurrency: num(cConc, 1),
            transcodeConcurrency: num(tConc, 1),
            retryEnabled: bool(retry, true),
            retryTimes: num(times, 3),
            autoSwitch: bool(autoSwitch, true),
            guardEnabled: bool(guardOn, true),
            guardLoadFactor: numF(guardLoad, 1.5),
            guardRamFreeMB: numF(guardRam, 256),
        };
    }
    async defaultCompressPercent() {
        try {
            const page = await this.sysConfig.get('page');
            const v = Number((page?.config || []).find((x) => x.id === 'defaultCompressQuality')?.value);
            if (Number.isFinite(v) && v >= 10 && v <= 100)
                return v;
        }
        catch {
        }
        return 80;
    }
    makeFileId() {
        return crypto_service_1.CryptoService.fileId(48);
    }
    deferMediaPostProcess(job) {
        void (async () => {
            let path = job.srcPath;
            let tempOwned = false;
            try {
                if (!path) {
                    const dir = (0, path_1.join)((0, os_1.tmpdir)(), 'gohub-post');
                    await fs_1.promises.mkdir(dir, { recursive: true });
                    path = (0, path_1.join)(dir, `${job.fileId.replace(/[\\/:*?"<>|]/g, '_')}.${job.ext || 'bin'}`);
                    await fs_1.promises.writeFile(path, job.buffer);
                    tempOwned = true;
                }
            }
            catch (err) {
                app_log_1.appLog.warn('compress', `后置压缩/转码任务创建失败（文件已上传成功，跳过处理）`, `${err.message} ｜ ${job.originalName}`, job.ip);
                return;
            }
            const ms = await this.mediaSettings();
            const lane = job.compress ? 'compress' : 'transcode';
            const limit = job.compress ? ms.compressConcurrency : ms.transcodeConcurrency;
            (0, media_post_1.enqueueMediaJob)(`${job.fileId}（${job.originalName}）`, () => this.runMediaPostProcess({ ...job, srcPath: path, buffer: Buffer.alloc(0), tempOwned }), lane, limit);
            const stats = (0, media_post_1.mediaQueueStats)();
            app_log_1.appLog.info('compress', `已排入后置处理队列：${job.originalName}`, `压缩=${job.compress ? `${job.percent}%` : '关'} ｜ 兼容转码=${job.transcode ? '开' : '关'} ｜ 通道=${lane}(${limit === 0 ? '不限' : `${limit} 路`}) ｜ 队列=${stats.pending} 等待 | 执行中=${stats.current || '无'}`, job.ip);
        })();
    }
    async runMediaPostProcess(job) {
        const t0 = Date.now();
        try {
            const rec = await prisma_1.prisma.fileRecord.findUnique({
                where: { id: job.recordId },
                select: { status: true, originalName: true, size: true, md5: true, instanceId: true },
            });
            if (!rec || rec.status !== 'active') {
                app_log_1.appLog.info('compress', `后置处理跳过：文件已删除或不在正常状态`, job.fileId, job.ip);
                return;
            }
            const ch = await prisma_1.prisma.channel.findUnique({ where: { id: job.channelId } });
            if (!ch) {
                app_log_1.appLog.warn('compress', `后置处理跳过：目标渠道已不存在`, job.fileId, job.ip);
                return;
            }
            const ms = await this.mediaSettings();
            const r = await (0, media_post_1.postProcessMediaFile)(job.srcPath, job.mime, job.ext, {
                compress: job.compress,
                percent: job.percent,
                transcode: job.transcode,
                compressMaxSeconds: ms.compressMax,
                transcodeMaxSeconds: ms.transcodeMax,
                guard: { enabled: ms.guardEnabled, loadFactor: ms.guardLoadFactor, ramFreeMB: ms.guardRamFreeMB },
            });
            if (r.skipReason) {
                app_log_1.appLog.info('compress', `后置处理未改变文件：${rec.originalName}`, `${r.skipReason} ｜ 耗时 ${r.elapsedMs ?? 0}ms${r.codec ? ` ｜ 编码=${r.codec}` : ''}`, job.ip);
            }
            const skipped = r.skipReason || '';
            const ev = {};
            if (job.compress) {
                ev.compress =
                    r.stage === 'compress'
                        ? { enabled: true, status: 'done', reason: '', ms: r.elapsedMs, size: r.size, originalSize: rec.size }
                        : {
                            enabled: true,
                            status: 'skipped',
                            reason: 'media',
                            ms: r.elapsedMs,
                            ...(skipped ? { detail: skipped } : {}),
                        };
            }
            else {
                ev.compress = { enabled: false, status: 'skipped', reason: 'off' };
            }
            if (job.transcode) {
                ev.transcode =
                    r.stage === 'transcode'
                        ? { enabled: true, status: 'done', ms: r.elapsedMs }
                        : r.stage === 'compress'
                            ? { enabled: true, status: 'skipped', reason: '压缩产物已是 H.264，无需转码' }
                            : {
                                enabled: true,
                                status: skipped ? 'failed' : 'skipped',
                                ms: r.elapsedMs,
                                reason: skipped || '无需转码或转码未生效',
                            };
            }
            else {
                ev.transcode = { enabled: false, status: 'skipped', reason: '转码开关未开启' };
            }
            await this.writeProcessEvent(job.recordId, ev);
            if (!r.compressed || r.stage === 'none')
                return;
            const info = this.toChannelInfo(ch);
            const newName = r.ext ? rec.originalName.replace(/\.[^.]+$/, '') + r.ext : rec.originalName;
            const key = this.makeKeyFor({ id: ch.id, code: ch.code, name: ch.name, type: ch.type, config: ch.config }, newName, job.nameType, rec.md5 || '', job.uploader);
            const adapter = (0, adapter_factory_1.createAdapter)(info);
            const up = await this.uploadToAdapter(adapter, { buffer: Buffer.alloc(0), path: r.path, size: r.size, mime: r.mime || job.mime, originalName: newName }, key, info, job.uploader, rec.instanceId || '');
            const copy = await prisma_1.prisma.fileCopy.findFirst({
                where: { fileId: job.recordId, channelId: ch.id },
                select: { id: true, remoteKey: true, remoteUrl: true, metas: true },
            });
            let prevMetas = {};
            try {
                const parsed = copy?.metas ? JSON.parse(copy.metas) : null;
                if (parsed && typeof parsed === 'object')
                    prevMetas = parsed;
            }
            catch {
                prevMetas = {};
            }
            const writeData = this.copyWriteData(up, ch);
            await prisma_1.prisma.fileCopy.update({
                where: { fileId_channelId: { fileId: job.recordId, channelId: ch.id } },
                data: { ...writeData, metas: JSON.stringify({ ...prevMetas, ...JSON.parse(writeData.metas) }), status: 'active' },
            });
            await prisma_1.prisma.fileRecord.update({
                where: { id: job.recordId },
                data: { size: r.size, mime: r.mime || job.mime, originalName: newName },
            });
            if (copy && (copy.remoteKey || copy.remoteUrl)) {
                try {
                    await adapter.delete((0, adapter_factory_1.toCopyInfo)(copy), info);
                }
                catch (err) {
                    app_log_1.appLog.warn('compress', `旧对象删除失败（不影响新外链）`, `${err.message} ｜ ${copy.remoteKey}`, job.ip);
                }
            }
            app_log_1.appLog.info('compress', `后置${r.stage === 'transcode' ? '兼容转码' : '压缩'}完成：${rec.originalName} → ${newName}`, `${rec.size}B → ${r.size}B ｜ 耗时 ${Date.now() - t0}ms（估算 ${r.estimatedSeconds ?? '-'}s）｜ 渠道=${ch.name}`, job.ip);
        }
        catch (err) {
            app_log_1.appLog.warn('compress', `后置处理失败（渠道与原记录均保持不变）：${job.originalName}`, `${err.message} ｜ 耗时 ${Date.now() - t0}ms`, job.ip);
        }
        finally {
            if (job.tempOwned && job.srcPath)
                await fs_1.promises.unlink(job.srcPath).catch(() => undefined);
            for (const suffix of ['.cmp.mp4', '.cmp.webm', '.cmp.m4a', '.cmp.mp3', '.h264.mp4']) {
                await fs_1.promises.unlink(`${job.srcPath}${suffix}`).catch(() => undefined);
            }
        }
    }
    async writeProcessEvent(recordId, patch) {
        try {
            const cur = await prisma_1.prisma.fileRecord.findUnique({ where: { id: recordId }, select: { metas: true } });
            if (!cur)
                return;
            let metas = {};
            try {
                metas = JSON.parse(cur.metas || '{}');
            }
            catch {
                metas = {};
            }
            const prev = (metas.ProcessEvent && typeof metas.ProcessEvent === 'object' ? metas.ProcessEvent : {});
            metas.ProcessEvent = { ...prev, ...patch, updatedAt: new Date().toISOString() };
            await prisma_1.prisma.fileRecord.update({ where: { id: recordId }, data: { metas: JSON.stringify(metas) } });
        }
        catch (err) {
            app_log_1.appLog.warn('compress', `处理事件写入失败（不影响文件）`, err?.message || String(err));
        }
    }
    mediaQueue() {
        return (0, media_post_1.mediaQueueStats)();
    }
    mediaMaxSeconds() {
        return media_post_1.MEDIA_MAX_SECONDS;
    }
    sanitizeFileId(raw) {
        let s = String(raw || '').trim();
        s = s.replace(/^https?:\/\/[^/]+/i, '');
        s = s.split('?')[0].split('#')[0];
        s = s
            .split('/')
            .filter((seg) => seg && seg !== '.' && seg !== '..')
            .join('/');
        s = s.replace(/[\u0000-\u001f<>:"|*\\]/g, '_');
        return s.slice(0, 200);
    }
    async uniqueFileId(base) {
        const fallback = base || this.makeFileId();
        const ext = /\.[A-Za-z0-9]{1,8}$/.test(fallback) ? fallback.slice(fallback.lastIndexOf('.')) : '';
        const stem = ext ? fallback.slice(0, -ext.length) : fallback;
        for (let i = 0; i < 50; i += 1) {
            const candidate = i === 0 ? fallback : `${stem}-${i}${ext}`;
            const exists = await prisma_1.prisma.fileRecord.findFirst({
                where: { name: candidate },
                select: { id: true, name: true, status: true },
            });
            if (!exists)
                return candidate;
            if (exists.status === 'deleted') {
                await this.removeFile(exists.id, exists.name);
                continue;
            }
        }
        return this.makeFileId();
    }
    async dedupEnabled() {
        try {
            return (await this.settings.get('dedupEnabled', 'false')) === 'true';
        }
        catch {
            return false;
        }
    }
    async dedupScope() {
        try {
            const v = await this.settings.get('dedupScope', 'all');
            return v === 'channel' ? 'channel' : v === 'channelType' ? 'channelType' : 'all';
        }
        catch {
            return 'all';
        }
    }
    hashFile(path) {
        return new Promise((resolve, reject) => {
            const hash = (0, crypto_1.createHash)('md5');
            const stream = (0, fs_1.createReadStream)(path);
            stream.on('data', (chunk) => hash.update(chunk));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        });
    }
    async uploadToAdapter(adapter, file, key, info, owner, instanceId) {
        if (file.path && typeof adapter.uploadFile === 'function') {
            return adapter.uploadFile(file.path, file.size || 0, { mime: file.mime, originalName: file.originalName }, key, info, { owner, instanceId });
        }
        if (file.path) {
            const size = file.size || 0;
            if (size > STREAM_REQUIRED_BYTES) {
                throw new adapter_interface_1.AdapterError(`渠道「${info.name || info.type}」不支持大文件流式写入，${Math.round(size / 1024 / 1024)}MB 超过直传安全阈值；请改用 S3 / 本地存储 / WebDAV 渠道`, info.type);
            }
            const buffer = await fs_1.promises.readFile(file.path);
            return adapter.upload({ buffer, mime: file.mime, originalName: file.originalName }, key, info, { owner, instanceId });
        }
        return adapter.upload({ buffer: file.buffer, mime: file.mime, originalName: file.originalName }, key, info, { owner, instanceId });
    }
    async compress(buffer, mime, percent) {
        const ext = mime.split('/')[1] || '';
        const r = await (0, compress_1.compressMedia)(buffer, mime, ext, percent);
        if (r.compressed)
            return { buffer: r.buffer, mime: r.mime || mime, ext: r.ext || `.${ext}` };
        return { buffer, mime, ext: ext ? `.${ext}` : '' };
    }
    async defaultServerCompress() {
        try {
            const page = await this.sysConfig.get('page');
            const item = (page?.config || []).find((x) => x.id === 'defaultCustomerCompress');
            return item ? item.value === true || item.value === 'true' : true;
        }
        catch {
            return true;
        }
    }
    async globalTranscodeEnabled() {
        try {
            const page = await this.sysConfig.get('page');
            const item = (page?.config || []).find((x) => x.id === 'videoTranscodeIncompatible');
            if (!item)
                return true;
            if (item.value === undefined || item.value === null || item.value === '')
                return item.default !== false;
            return item.value === true || item.value === 'true';
        }
        catch {
            return true;
        }
    }
    async videoTranscodePolicy(username) {
        const name = String(username || '').trim();
        if (!name)
            return 'inherit';
        const normalize = (v) => v === 'off' || v === 'on' || v === 'user' ? v : 'inherit';
        try {
            const row = await prisma_1.prisma.user.findUnique({
                where: { username: name },
                select: { transcodePolicy: true },
            });
            if (row)
                return normalize(row.transcodePolicy);
            const prof = await this.adminProfileIfAdmin(name);
            if (prof)
                return normalize(prof.transcodePolicy);
            return 'inherit';
        }
        catch {
            return 'inherit';
        }
    }
    async adminProfileIfAdmin(username) {
        try {
            const security = await this.sysConfig.get('security');
            const adminName = String(security?.auth?.admin?.adminUsername || '').trim() ||
                (process.env.ADMIN_USER || '').trim() ||
                'admin';
            if (username !== adminName)
                return null;
            const prof = await this.sysConfig.get('adminProfile');
            return prof && typeof prof === 'object' ? prof : null;
        }
        catch {
            return null;
        }
    }
    async transcodeDecision(uploader, explicit) {
        const policy = await this.videoTranscodePolicy(uploader);
        if (policy === 'on')
            return true;
        if (policy === 'off')
            return false;
        if (policy === 'user' && typeof explicit === 'boolean')
            return explicit;
        return this.globalTranscodeEnabled();
    }
    async userMaxFileSizeMB(username) {
        const name = String(username || '').trim();
        if (!name)
            return 0;
        try {
            const row = await prisma_1.prisma.user.findUnique({
                where: { username: name },
                select: { maxFileSizeMB: true },
            });
            if (row)
                return Math.max(0, Number(row.maxFileSizeMB) || 0);
            const prof = await this.adminProfileIfAdmin(name);
            if (prof)
                return Math.max(0, Number(prof.maxFileSizeMB) || 0);
            return 0;
        }
        catch {
            return 0;
        }
    }
    async instanceOwnerIdOf(username) {
        const name = String(username || '').trim();
        if (!name)
            return '';
        try {
            const row = await prisma_1.prisma.user.findUnique({ where: { username: name }, select: { id: true } });
            if (row?.id)
                return row.id;
            const userCount = await prisma_1.prisma.user.count();
            return userCount > 0 ? name : 'admin';
        }
        catch {
            return name;
        }
    }
    async resolveInstanceScope(instanceId, uploader, ip) {
        const id = String(instanceId || '').trim();
        if (!id)
            return '';
        try {
            const inst = await prisma_1.prisma.instance.findUnique({ where: { id } });
            if (!inst) {
                app_log_1.appLog.warn('upload', `实例归属校验失败：实例不存在，已回退默认实例`, `instanceId=${id}`, ip);
                return '';
            }
            let members = [];
            try {
                const parsed = JSON.parse(inst.metas || '{}');
                if (Array.isArray(parsed?.members))
                    members = parsed.members.map((m) => String(m || '').trim()).filter(Boolean);
            }
            catch {
                members = [];
            }
            const isOwner = inst.ownerName === uploader || (await this.instanceOwnerIdOf(uploader || '')) === inst.ownerId;
            if (isOwner || members.includes(String(uploader || '').trim()))
                return id;
            app_log_1.appLog.warn('upload', `实例归属校验失败：用户 ${uploader || '(匿名)'} 不是实例「${inst.name}」的成员，已回退默认实例`, `instanceId=${id}`, ip);
            return '';
        }
        catch (err) {
            app_log_1.appLog.warn('upload', `实例归属校验异常，已回退默认实例`, err?.message || String(err), ip);
            return '';
        }
    }
    async upload(input, opts) {
        this.activeUploads += 1;
        try {
            return await this.uploadInner(input, opts);
        }
        finally {
            this.activeUploads -= 1;
        }
    }
    async uploadInner(input, opts) {
        let { buffer, mime, originalName } = input;
        let srcPath = input.path || '';
        let size = Number(input.size || 0);
        if (!size) {
            size = srcPath ? (await fs_1.promises.stat(srcPath)).size : buffer.length;
        }
        if (!opts.skipFileLimits) {
            const invalid = await this.validate(input, opts.limitsOverride, opts.uploader);
            if (invalid)
                return { id: '', error: invalid };
        }
        const originalSize = opts.originalSize && opts.originalSize > 0 ? opts.originalSize : size;
        mime = this.normalizeMime(originalName, mime);
        const uploadIp = opts.ip || '';
        let main = null;
        try {
            main = await this.resolveMainChannel({
                channelId: opts.channelId,
                channelType: opts.uploadChannel,
                uploader: opts.ignoreUploaderChannel ? undefined : opts.uploader,
                tokenId: opts.tokenId,
            });
        }
        catch (err) {
            return { id: '', error: err.message };
        }
        if (!main) {
            const hint = opts.channelId
                ? `渠道 ID「${opts.channelId}」不存在或已禁用`
                : opts.uploadChannel
                    ? `没有可用的「${opts.uploadChannel}」渠道，且未设置全局主渠道`
                    : '未指定渠道，且「用户管理」「上传设置」里都没有可用的主渠道';
            return { id: '', error: `未配置可用的主渠道（${hint}），请先在后台「存储渠道」检查` };
        }
        const md5 = srcPath ? await this.hashFile(srcPath) : (0, crypto_1.createHash)('md5').update(buffer).digest('hex');
        if (await this.dedupEnabled()) {
            const scope = await this.dedupScope();
            const dups = await prisma_1.prisma.fileRecord.findMany({
                where: {
                    status: 'active',
                    md5,
                    OR: [{ originalSize }, { size: originalSize }],
                },
                take: 50,
                select: {
                    name: true,
                    originalName: true,
                    copies: { select: { channelId: true, status: true, isPrimary: true, channel: { select: { name: true, type: true } } } },
                },
            });
            const primaryCopyOf = (d) => d.copies.find((c) => c.isPrimary) || d.copies[0];
            const hit = dups.find((d) => {
                if (scope === 'all')
                    return true;
                const pc = primaryCopyOf(d);
                if (!pc)
                    return false;
                return scope === 'channel'
                    ? (pc.channel?.name || '') === main.name
                    : (pc.channel?.type || '') === main.type;
            }) || null;
            if (!hit && dups.length) {
                const d0 = dups[0];
                const pc = primaryCopyOf(d0);
                app_log_1.appLog.info('upload', `去重跳过：${originalName} 与已有文件 ${d0.name} 内容相同，但渠道${scope === 'channel' ? '名称' : '类型'}不同（去重范围为「${scope === 'channel' ? '同一渠道名称内' : '同一渠道类型内'}」）`, `目标渠道=${main.name}（类型=${main.type}） ｜ 已有文件渠道=${pc?.channel?.name || '未知'}（类型=${pc?.channel?.type || '未知'}）`, uploadIp);
            }
            if (hit) {
                const cloned = await this.cloneDedupRecord(hit.name, {
                    uploader: opts.uploader,
                    uploadSource: opts.uploadSource,
                    instanceId: opts.instanceId,
                    originalName,
                    mime,
                    channelType: main.type,
                }, uploadIp);
                app_log_1.appLog.info('upload', `命中去重：${originalName} 与已有文件 ${hit.originalName}（${hit.name}）内容相同，已为本次上传克隆记录 ${cloned}`, `md5=${md5} ｜ 原始大小=${originalSize}B ｜ 范围=${scope === 'channel' ? `同一渠道名称内（${main.name}）` : scope === 'channelType' ? `同一渠道类型内（${main.type}）` : '全部渠道'}`, uploadIp);
                return { id: cloned, dedup: true, finalName: originalName };
            }
        }
        if (mime.startsWith('image/') && size <= 64 * 1024 * 1024) {
            const reviewBuffer = buffer.length ? buffer : await fs_1.promises.readFile(srcPath);
            const rejected = await this.moderate(reviewBuffer, mime);
            if (rejected)
                return { id: '', error: rejected };
        }
        const uploadAddress = await this.cachedAddress(uploadIp);
        const instanceScope = await this.resolveInstanceScope(opts.instanceId, opts.uploader, uploadIp);
        const wantCompress = opts.serverCompress ?? (await this.defaultServerCompress());
        const isVideo = (mime || '').startsWith('video/');
        const isAudio = (mime || '').startsWith('audio/');
        const isImage = (mime || '').startsWith('image/');
        const wantTranscode = isVideo ? await this.transcodeDecision(opts.uploader, opts.videoTranscode) : false;
        const srcExt = originalName.includes('.') ? String(originalName.split('.').pop() || '') : '';
        const compressPercent = opts.compressPercent && opts.compressPercent > 0 ? opts.compressPercent : await this.defaultCompressPercent();
        const webpConverted = !!opts.webpMode && !opts.webpSkip;
        const skipReasonOf = () => (webpConverted ? 'webp' : 'threshold');
        let imageCompress;
        if (isImage) {
            imageCompress = { enabled: wantCompress, status: 'skipped', reason: wantCompress ? skipReasonOf() : 'off', originalSize };
        }
        else if (!isVideo && !isAudio) {
            imageCompress = { enabled: false, status: 'skipped', reason: 'off' };
        }
        else if (!wantCompress) {
            imageCompress = { enabled: false, status: 'skipped', reason: 'off' };
        }
        if (wantCompress && isImage) {
            const c0 = Date.now();
            if (size > COMPRESS_MAX_BYTES) {
                imageCompress = { enabled: true, status: 'skipped', reason: 'threshold', originalSize };
                console.log(`[upload] 跳过压缩：文件 ${(size / 1024 / 1024).toFixed(1)}MB 超过压缩上限`);
            }
            else if (srcPath) {
                const r = await (0, compress_1.compressFile)(srcPath, mime, srcExt, compressPercent);
                imageCompress = r.compressed
                    ? { enabled: true, status: 'done', reason: '', ms: Date.now() - c0, size: r.size, originalSize }
                    : { enabled: true, status: 'skipped', reason: skipReasonOf(), ms: Date.now() - c0, originalSize };
                if (r.compressed) {
                    srcPath = r.path;
                    size = r.size;
                    mime = r.mime || mime;
                    if (r.ext)
                        originalName = originalName.replace(/\.[^.]+$/, '') + r.ext;
                    app_log_1.appLog.info('upload', `已压缩（流式）：${originalSize}B → ${size}B（${Math.round((1 - size / Math.max(1, originalSize)) * 100)}%）`, `${originalName} ｜ 期望 ${compressPercent}%`, uploadIp);
                }
                else if (r.reason) {
                    app_log_1.appLog.info('upload', `跳过压缩：${r.reason}`, originalName, uploadIp);
                }
            }
            else {
                const r = await (0, compress_1.compressMedia)(buffer, mime, srcExt, compressPercent);
                imageCompress = r.compressed
                    ? { enabled: true, status: 'done', reason: '', ms: Date.now() - c0, size: r.buffer.length, originalSize }
                    : { enabled: true, status: 'skipped', reason: skipReasonOf(), ms: Date.now() - c0, originalSize };
                if (r.compressed) {
                    const before = buffer.length;
                    buffer = r.buffer;
                    size = buffer.length;
                    mime = r.mime || mime;
                    if (r.ext)
                        originalName = originalName.replace(/\.[^.]+$/, '') + r.ext;
                    app_log_1.appLog.info('upload', `已压缩：${before}B → ${buffer.length}B（${Math.round((1 - buffer.length / before) * 100)}%）`, `${originalName} ｜ 期望 ${compressPercent}%`, uploadIp);
                }
                else if (r.reason) {
                    app_log_1.appLog.info('upload', `跳过压缩：${r.reason}`, originalName, uploadIp);
                }
            }
        }
        const mediaDeferred = (isVideo || isAudio) && (wantCompress || wantTranscode);
        const dims = srcPath
            ? await (0, compress_1.readDimensionsFile)(srcPath, mime, mime.split('/')[1] || '')
            : await (0, compress_1.readDimensions)(buffer, mime, mime.split('/')[1] || '');
        const folder = await this.resolveFolder(opts.uploadFolder);
        const key = this.makeKeyFor(main, originalName, opts.uploadNameType, md5, opts.uploader);
        const ms = await this.mediaSettings();
        const retryEnabled = opts.autoRetry === undefined ? ms.retryEnabled : opts.autoRetry;
        const allowSwitch = retryEnabled && ms.autoSwitch;
        const chain = [main];
        if (allowSwitch) {
            const pool = await prisma_1.prisma.channel.findMany({
                where: { enabled: true, backupPool: true, NOT: { id: main.id } },
                orderBy: { code: 'asc' },
            });
            if (pool.length) {
                const start = this.poolCursor++ % pool.length;
                const rotated = [...pool.slice(start), ...pool.slice(0, start)];
                for (const c of rotated) {
                    chain.push({ id: c.id, code: c.code, name: c.name, type: c.type, config: c.config });
                }
            }
            else {
                const others = await prisma_1.prisma.channel.findMany({
                    where: { enabled: true, NOT: { id: main.id } },
                    orderBy: { code: 'asc' },
                });
                chain.push(...others);
            }
        }
        const startedAt = Date.now();
        let result;
        let usedChannel = main;
        let lastErr = '';
        for (const ch of chain) {
            if (ch.id !== main.id && !(await this.channelWritable(ch)))
                continue;
            try {
                const info = this.toChannelInfo(ch);
                result = await this.uploadToAdapter((0, adapter_factory_1.createAdapter)(info), {
                    buffer,
                    path: srcPath,
                    size,
                    mime,
                    originalName,
                }, key, info, opts.uploader, instanceScope);
                usedChannel = ch;
                break;
            }
            catch (err) {
                lastErr = err.message || String(err);
                app_log_1.appLog.warn('upload', `渠道上传失败：${ch.name}（${ch.type}）${allowSwitch ? '，尝试自动切换下一个渠道' : ''}`, `${lastErr} ｜ key=${key} ｜ 大小=${size}B ｜ 文件=${originalName}`, uploadIp);
            }
        }
        if (!result) {
            return {
                id: '',
                error: allowSwitch
                    ? `所有可用渠道均上传失败（最后错误：${lastErr}）`
                    : `存储渠道「${main.name}」上传失败：${lastErr}`,
            };
        }
        if (usedChannel.id !== main.id) {
            app_log_1.appLog.info('upload', `自动切换成功：${main.name} → ${usedChannel.name}（${usedChannel.type}）`, `key=${key}`, uploadIp);
        }
        app_log_1.appLog.info('upload', `上传成功：${usedChannel.name}（${usedChannel.type}）`, `${key} ｜ ${size}B ｜ 耗时 ${Date.now() - startedAt}ms ｜ 文件=${originalName}`, uploadIp);
        const processEvent = {};
        const retryRound = Math.max(0, Number(opts.retryRound) || 0);
        if (retryRound) {
            processEvent.retries = retryRound;
            processEvent.failCount = retryRound;
        }
        if (opts.failReason)
            processEvent.failReason = opts.failReason;
        if (usedChannel.id !== main.id)
            processEvent.switchedTo = usedChannel.name;
        if (imageCompress)
            processEvent.compress = imageCompress;
        const webpMode = opts.webpMode === 'lossless' || opts.webpMode === 'lossy' ? opts.webpMode : '';
        if (opts.webpSkip) {
            processEvent.webp = { enabled: true, mode: webpMode, status: 'skipped', reason: opts.webpSkip };
        }
        else if (webpMode) {
            processEvent.webp = { enabled: true, mode: webpMode, status: 'done' };
        }
        if (!isImage)
            delete processEvent.webp;
        const fileId = opts.presetFileId
            ? await this.uniqueFileId(this.sanitizeFileId(opts.presetFileId))
            : this.makeFileId();
        const record = await prisma_1.prisma.fileRecord.create({
            data: {
                name: fileId,
                firstName: fileId,
                prevName: '',
                originalName,
                size,
                originalSize,
                mime,
                md5,
                folder,
                uploader: opts.uploader || '',
                uploadSource: (0, file_view_1.normalizeUploadSource)(opts.uploadSource),
                ip: uploadIp,
                instanceId: instanceScope,
                uploadStartedAt: opts.uploadStartedAt || new Date(startedAt),
                uploadFinishedAt: new Date(),
                metas: JSON.stringify({
                    UploadAddress: uploadAddress,
                    ...(dims.width && dims.height ? { Width: dims.width, Height: dims.height } : {}),
                    ...(Object.keys(processEvent).length ? { ProcessEvent: processEvent } : {}),
                }),
                copies: {
                    create: {
                        channelId: usedChannel.id,
                        ...this.copyWriteData(result, usedChannel),
                        status: 'active',
                        isPrimary: true,
                    },
                },
            },
        });
        if (mediaDeferred) {
            this.deferMediaPostProcess({
                recordId: record.id,
                fileId,
                channelId: usedChannel.id,
                srcPath,
                buffer,
                mime,
                ext: srcExt,
                originalName,
                nameType: opts.uploadNameType,
                compress: wantCompress === true,
                percent: compressPercent,
                transcode: wantTranscode,
                uploader: opts.uploader || '',
                ip: uploadIp,
            });
        }
        this.enqueueBackground(() => this.touchIp(uploadIp, uploadAddress));
        if (uploadIp && !uploadAddress) {
            this.enqueueBackground(async () => {
                const addr = await this.resolveAddress(uploadIp);
                if (!addr)
                    return;
                const cur = await prisma_1.prisma.fileRecord.findUnique({ where: { id: record.id }, select: { metas: true } });
                if (!cur)
                    return;
                let metas = {};
                try {
                    metas = JSON.parse(cur.metas || '{}');
                }
                catch {
                    metas = {};
                }
                await prisma_1.prisma.fileRecord.update({
                    where: { id: record.id },
                    data: { metas: JSON.stringify({ ...metas, UploadAddress: addr }) },
                });
                await this.touchIp(uploadIp, addr);
            });
        }
        this.enqueueTagTask(() => this.autoTag(record.id, {
            originalName,
            mime,
            channelType: opts.backup === false ? usedChannel.type : main.type,
            uploadSource: opts.uploadSource,
            instanceId: instanceScope,
            owner: record.uploader,
            extraTags: [...(opts.extraTags || [])],
            width: dims.width,
            height: dims.height,
        }));
        if (opts.backup !== false) {
            const payload = { buffer, path: srcPath, size, mime, originalName };
            this.enqueueBackground(async () => {
                if (!(await this.backupEnabled()))
                    return;
                const backup = await this.resolveBackupChannel({
                    explicitId: opts.backupChannelId,
                    uploader: opts.ignoreUploaderChannel ? undefined : opts.uploader,
                    tokenId: opts.tokenId,
                });
                if (!backup || backup.id === usedChannel.id)
                    return;
                await this.enqueueLowPriority(async () => {
                    await this.backupUpload(record.id, payload, key, backup, opts.uploader);
                });
            });
        }
        return { id: fileId, finalName: originalName };
    }
    async registerFile(input) {
        const rawUrl = String(input.sourceUrl || '').trim();
        let url;
        try {
            url = new URL(rawUrl);
        }
        catch {
            return { error: '文件源地址格式不正确（需以 http:// 或 https:// 开头）' };
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return { error: '文件源地址只支持 http / https 协议' };
        }
        const channelKey = String(input.channelId || '');
        if (!channelKey)
            return { error: '请选择存储渠道' };
        const ch = await prisma_1.prisma.channel.findFirst({
            where: { OR: [{ id: channelKey }, { code: channelKey }] },
        });
        if (!ch) {
            app_log_1.appLog.warn('record', '登记失败：所选存储渠道不存在', `channelId=${channelKey}`, String(input.ip || ''));
            return { error: '所选存储渠道不存在' };
        }
        if (!ch.enabled) {
            app_log_1.appLog.warn('record', `登记失败：存储渠道「${ch.name}」已停用`, `channelId=${channelKey}`, String(input.ip || ''));
            return { error: `存储渠道「${ch.name}」已停用，请先启用或换一个渠道` };
        }
        let contentType = '';
        let contentLength = 0;
        let reachable = false;
        const timeout = () => AbortSignal.timeout(20000);
        try {
            const head = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: timeout() });
            if (head.ok) {
                reachable = true;
                contentType = head.headers.get('content-type') || '';
                contentLength = Number(head.headers.get('content-length') || 0) || 0;
            }
        }
        catch {
        }
        if (!contentLength || !contentType) {
            try {
                const probe = await fetch(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: timeout() });
                if (probe.ok || probe.status === 206) {
                    reachable = true;
                    contentType = contentType || probe.headers.get('content-type') || '';
                    const range = probe.headers.get('content-range') || '';
                    const total = Number(range.split('/')[1]) || 0;
                    if (!contentLength)
                        contentLength = total || 0;
                }
                await probe.body?.cancel().catch(() => undefined);
            }
            catch {
            }
        }
        if (!reachable) {
            app_log_1.appLog.warn('record', '登记失败：源地址不可访问', `源=${rawUrl} ｜ 渠道=${ch.name}`, String(input.ip || ''));
            return { error: '无法访问该文件源地址（超时或被拒绝），请确认地址可公开访问' };
        }
        const mimeClean = (contentType || '').split(';')[0].trim().toLowerCase();
        let originalName = this.sanitizeRecordName(String(input.originalName || '').trim());
        let nameSource = originalName ? 'input' : '';
        if (!originalName) {
            const resolved = await this.resolveRecordOriginalName(url);
            originalName = resolved.name;
            nameSource = resolved.from;
        }
        const urlBase = (() => {
            const raw = url.pathname.split('/').filter(Boolean).pop() || '';
            try {
                return decodeURIComponent(raw);
            }
            catch {
                return raw;
            }
        })();
        const urlExt = /\.([A-Za-z0-9]{1,10})$/.test(urlBase) ? String(urlBase.split('.').pop() || '').toLowerCase() : '';
        const nameExt = /\.([A-Za-z0-9]{1,10})$/.test(originalName)
            ? String(originalName.split('.').pop() || '').toLowerCase()
            : '';
        const givenExt = String(input.extension || '')
            .trim()
            .replace(/^\.+/, '')
            .toLowerCase();
        const validGivenExt = /^[a-z0-9]{1,10}$/.test(givenExt) ? givenExt : '';
        let ext = urlExt || nameExt || validGivenExt;
        const MIME_EXT = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/bmp': 'bmp',
            'image/avif': 'avif',
            'video/mp4': 'mp4',
            'video/webm': 'webm',
            'video/quicktime': 'mov',
            'audio/mpeg': 'mp3',
            'audio/mp4': 'm4a',
            'audio/aac': 'aac',
            'audio/ogg': 'ogg',
        };
        if (!ext) {
            ext = MIME_EXT[mimeClean] || 'bin';
        }
        if (!/\.[A-Za-z0-9]{1,10}$/.test(originalName))
            originalName = `${originalName}.${ext}`;
        const mime = mimeClean || UploadService_1.EXT_MIME[ext] || 'application/octet-stream';
        const md5Cap = Math.max(1, Number(process.env.RECORD_MD5_MAX_MB || 256)) * 1024 * 1024;
        let md5 = '';
        let size = contentLength;
        let sampleBuffer;
        const canHash = contentLength > 0 ? contentLength <= md5Cap : true;
        if (canHash) {
            try {
                const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
                if (res.ok && res.body) {
                    const hash = (0, crypto_1.createHash)('md5');
                    let total = 0;
                    let over = false;
                    const sampleLimit = 8 * 1024 * 1024;
                    const chunks = [];
                    let sampled = 0;
                    for await (const chunk of res.body) {
                        total += chunk.length;
                        if (total > md5Cap) {
                            over = true;
                            break;
                        }
                        hash.update(chunk);
                        if (sampled <= sampleLimit) {
                            chunks.push(Buffer.from(chunk));
                            sampled += chunk.length;
                        }
                    }
                    if (over) {
                        md5 = '';
                        if (!size)
                            size = 0;
                    }
                    else {
                        md5 = hash.digest('hex');
                        if (!size)
                            size = total;
                        if (sampled > 0 && sampled <= sampleLimit)
                            sampleBuffer = Buffer.concat(chunks);
                    }
                }
            }
            catch {
                md5 = '';
            }
        }
        if (!size)
            size = 0;
        const uploadIp = String(input.ip || '');
        const uploadAddress = await this.cachedAddress(uploadIp);
        const instanceScope = await this.resolveInstanceScope(input.instanceId, input.uploader, uploadIp);
        const folderInput = String(input.folder || '').trim();
        let folder;
        if (folderInput) {
            folder = await this.resolveFolder(folderInput);
        }
        else {
            const now = new Date();
            folder = `登记文件/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
        const fileId = await this.uniqueFileId(this.makeFileId());
        const now = new Date();
        let recordCfg = {};
        try {
            recordCfg = (this.channels.decryptConfig(ch.type, ch.config) || {});
        }
        catch {
            recordCfg = {};
        }
        const candidates = this.channelDomainCandidates(ch.type, recordCfg);
        let domainHit = this.matchChannelSource(candidates, url);
        if (!domainHit && ch.type === 'local') {
            const rest = `${url.pathname.replace(/^\/+/, '')}${url.search || ''}`;
            if (rest)
                domainHit = { field: 'signOrigin', host: url.host.toLowerCase(), rest };
        }
        if (!domainHit) {
            app_log_1.appLog.warn('record', `登记失败：源地址与渠道域名不匹配（${ch.name}）`, `源=${rawUrl} ｜ 渠道域名候选=${candidates.map((c) => `${c.field}=${c.host}`).join(' , ') || '无'}`, String(input.ip || ''));
            return {
                error: `源地址不属于存储渠道「${ch.name}」：请确认地址的域名（含端口）与该渠道的「内网通信域名 / 公开访问域名 / Endpoint（服务地址）」之一一致`,
            };
        }
        const qIdx = domainHit.rest.indexOf('?');
        const restPathRaw = qIdx === -1 ? domainHit.rest : domainHit.rest.slice(0, qIdx);
        const restQuery = qIdx === -1 ? '' : domainHit.rest.slice(qIdx);
        let restPathDecoded = restPathRaw;
        try {
            restPathDecoded = decodeURIComponent(restPathRaw);
        }
        catch {
        }
        const objectKey = `${restPathDecoded}${restQuery}`;
        const dims = sampleBuffer
            ? await (0, compress_1.readDimensions)(sampleBuffer, mime, ext)
            : { width: undefined, height: undefined };
        const record = await prisma_1.prisma.fileRecord.create({
            data: {
                name: fileId,
                firstName: fileId,
                prevName: '',
                originalName,
                size,
                originalSize: size,
                mime,
                md5,
                folder,
                uploader: String(input.uploader || ''),
                uploadSource: 'Record',
                ip: uploadIp,
                note: String(input.note || '').slice(0, 2000),
                instanceId: instanceScope,
                uploadStartedAt: now,
                uploadFinishedAt: now,
                metas: JSON.stringify({
                    UploadAddress: uploadAddress,
                    Registered: true,
                    SourceUrl: rawUrl,
                    SourceOnChannel: true,
                    SourceHostField: domainHit.field,
                    RecordPath: domainHit.rest,
                    ...(dims.width && dims.height ? { Width: dims.width, Height: dims.height } : {}),
                }),
                copies: {
                    create: {
                        channelId: ch.id,
                        remoteKey: restPathDecoded,
                        remoteUrl: '',
                        objectPath: restPathDecoded,
                        urlQuery: restQuery.replace(/^\?/, ''),
                        metas: JSON.stringify({ snap: { channelType: ch.type, registered: true, capturedAt: now.toISOString() } }),
                        status: 'active',
                        isPrimary: true,
                    },
                },
            },
        });
        this.enqueueTagTask(() => this.autoTag(record.id, {
            originalName,
            mime,
            channelType: ch.type,
            uploadSource: 'Record',
            instanceId: instanceScope,
            owner: record.uploader,
            width: dims.width,
            height: dims.height,
        }));
        this.enqueueBackground(() => this.touchIp(uploadIp, uploadAddress));
        app_log_1.appLog.info('record', `登记文件成功：${originalName}`, `渠道=${ch.name} ｜ ${size}B ｜ mime=${mime} ｜ md5=${md5 || '未获取'} ｜ 匹配域名=${domainHit.field}(${domainHit.host}) ｜ 路径=${domainHit.rest} ｜ 文件名来源=${nameSource} ｜ 分类=${folder}${folderInput ? '' : '（默认 登记文件/年/月）'} ｜ 源=${rawUrl}`, uploadIp);
        return { id: fileId, info: { name: originalName, size, mime, md5, channel: ch.name } };
    }
    channelDomainCandidates(type, cfg) {
        const out = [];
        const seen = new Set();
        const push = (field, raw) => {
            const host = UploadService_1.domainHostOf(raw);
            if (!host || seen.has(host))
                return;
            seen.add(host);
            out.push({ field, host });
        };
        push('internalDomain', cfg.internalDomain);
        push('publicDomain', cfg.publicDomain);
        if (type === 'immich')
            push('domain', cfg.domain);
        const endpointKey = {
            minio: 'endpoint',
            r2: 'endpoint',
            s3: 'endpoint',
            cos: 'endpoint',
            aliyun: 'endpoint',
            easyimages: 'apiUrl',
            lsky: 'apiUrl',
            custom: 'apiUrl',
            webdav: 'baseUri',
            immich: 'serverUrl',
        };
        const key = endpointKey[type];
        if (key)
            push(key, cfg[key]);
        for (const [field, value] of Object.entries(cfg)) {
            if (typeof value === 'string' && /^https?:\/\//i.test(value.trim()))
                push(field, value);
        }
        return out;
    }
    static domainHostOf(raw) {
        const v = String(raw ?? '').trim();
        if (!v)
            return '';
        const abs = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
        try {
            return new URL(abs).host.toLowerCase();
        }
        catch {
            return '';
        }
    }
    matchChannelSource(candidates, sourceUrl) {
        const target = sourceUrl.host.toLowerCase();
        const hit = candidates.find((c) => c.host === target);
        if (!hit)
            return null;
        const rest = `${sourceUrl.pathname.replace(/^\/+/, '')}${sourceUrl.search || ''}`;
        if (!rest)
            return null;
        return { ...hit, rest };
    }
    sanitizeRecordName(raw) {
        return String(raw || '')
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^\.+/, '')
            .slice(0, 200);
    }
    looksLikeFileName(seg) {
        const s = String(seg || '').trim();
        if (!s)
            return false;
        if (/\.[A-Za-z0-9]{1,10}$/.test(s))
            return true;
        const generic = new Set([
            'original', 'download', 'downloads', 'file', 'files', 'image', 'photo', 'picture',
            'asset', 'assets', 'media', 'content', 'data', 'raw', 'view', 'preview', 'thumb',
            'thumbnail', 'get', 'api', 'render',
        ]);
        if (generic.has(s.toLowerCase()))
            return false;
        return s.length >= 3;
    }
    async fetchDispositionName(url) {
        const signal = AbortSignal.timeout(5000);
        try {
            const head = await fetch(url, { method: 'HEAD', redirect: 'follow', signal });
            let raw = head.headers.get('content-disposition') || '';
            if (!raw) {
                try {
                    const get = await fetch(url, { headers: { Range: 'bytes=0-4095' }, redirect: 'follow', signal });
                    raw = get.headers.get('content-disposition') || '';
                    await get.body?.cancel().catch(() => undefined);
                }
                catch {
                }
            }
            return UploadService_1.parseDispositionFilename(raw);
        }
        catch {
            return '';
        }
    }
    static parseDispositionFilename(header) {
        const raw = String(header || '');
        if (!raw)
            return '';
        const star = /filename\*\s*=\s*([^;]+)/i.exec(raw);
        if (star) {
            const v = star[1].trim().replace(/^"|"$/g, '');
            const m = /^[^']*'[^']*'(.*)$/.exec(v);
            const text = (m ? m[1] : v).trim();
            try {
                return decodeURIComponent(text);
            }
            catch {
                return text;
            }
        }
        const plain = /filename\s*=\s*("[^"]*"|[^;]+)/i.exec(raw);
        if (!plain)
            return '';
        const v = plain[1].trim().replace(/^"|"$/g, '').trim();
        try {
            return decodeURIComponent(v);
        }
        catch {
            return v;
        }
    }
    async resolveRecordOriginalName(url) {
        let lastSeg = url.pathname.split('/').filter(Boolean).pop() || '';
        try {
            lastSeg = decodeURIComponent(lastSeg);
        }
        catch {
        }
        const fromUrl = this.sanitizeRecordName(lastSeg);
        if (this.looksLikeFileName(fromUrl))
            return { name: fromUrl, from: 'url' };
        for (const val of url.searchParams.values()) {
            const seg = String(val || '').split('/').filter(Boolean).pop() || '';
            const cleaned = this.sanitizeRecordName(seg);
            if (this.looksLikeFileName(cleaned))
                return { name: cleaned, from: 'query' };
        }
        const fromHeader = this.sanitizeRecordName(await this.fetchDispositionName(url).catch(() => ''));
        if (fromHeader)
            return { name: fromHeader, from: 'header' };
        return { name: `登记文件-${Date.now()}`, from: 'fallback' };
    }
    async backupUpload(fileId, file, key, backup, owner) {
        await prisma_1.prisma.fileCopy.upsert({
            where: { fileId_channelId: { fileId, channelId: backup.id } },
            update: { status: 'pending' },
            create: { fileId, channelId: backup.id, remoteKey: '', remoteUrl: '', status: 'pending' },
        });
        try {
            const info = this.toChannelInfo(backup);
            const adapter = (0, adapter_factory_1.createAdapter)(info);
            const t0 = Date.now();
            const rec4inst = await prisma_1.prisma.fileRecord.findUnique({ where: { id: fileId }, select: { instanceId: true } });
            const result = await this.uploadToAdapter(adapter, file, key, info, owner, rec4inst?.instanceId || '');
            await prisma_1.prisma.fileCopy.update({
                where: { fileId_channelId: { fileId, channelId: backup.id } },
                data: { ...this.copyWriteData(result, backup), status: 'active' },
            });
            app_log_1.appLog.info('backup', `备份完成：${backup.name}（${backup.type}）`, `${key} ｜ ${file.size || file.buffer.length}B ｜ 耗时 ${Date.now() - t0}ms（低优先级，主渠道上传期间自动让路）`);
        }
        catch (err) {
            app_log_1.appLog.error('backup', `备份渠道写入失败：${backup.name}（${backup.type}）`, `${err.message} ｜ key=${key}`);
            await prisma_1.prisma.fileCopy.update({
                where: { fileId_channelId: { fileId, channelId: backup.id } },
                data: { status: 'failed', metas: JSON.stringify({ error: err.message }) },
            });
        }
    }
    async rebackup(fileIds) {
        let ok = 0;
        let fail = 0;
        let skipped = 0;
        const keys = (fileIds || []).filter(Boolean);
        const records = await prisma_1.prisma.fileRecord.findMany({
            where: { OR: [{ id: { in: keys } }, { name: { in: keys } }] },
            include: { copies: true },
        });
        const cache = new Map();
        const backupFor = async (uploader) => {
            const k = String(uploader || '');
            if (!cache.has(k))
                cache.set(k, await this.resolveBackupChannel({ uploader: k || undefined }));
            return cache.get(k) ?? null;
        };
        for (const rec of records) {
            const backup = await backupFor(rec.uploader);
            if (!backup) {
                fail += 1;
                continue;
            }
            const outcome = await this.enqueueLowPriority(async () => {
                if (!rec.copies.some((c) => c.status === 'active' && c.remoteKey))
                    return 'fail';
                if (rec.copies.some((c) => c.channelId === backup.id && c.status === 'active'))
                    return 'skipped';
                try {
                    await this.backupSingleFromMain(rec, backup);
                    return 'ok';
                }
                catch (err) {
                    console.error('[rebackup] 补备份失败:', rec.name, err.message);
                    return 'fail';
                }
            });
            if (outcome === 'ok')
                ok += 1;
            else if (outcome === 'skipped')
                skipped += 1;
            else
                fail += 1;
        }
        return { ok, fail, skipped, total: records.length };
    }
    async softDeleteFile(id, name = '') {
        await prisma_1.prisma.fileRecord.update({
            where: { id },
            data: { status: 'deleted', deletedAt: new Date() },
        });
        app_log_1.appLog.info('upload', `移入回收站：${name || id}`);
    }
    async restoreFile(id, name = '') {
        await prisma_1.prisma.fileRecord.update({
            where: { id },
            data: { status: 'active', deletedAt: null },
        });
        app_log_1.appLog.info('upload', `从回收站恢复：${name || id}`);
    }
    async cloneDedupRecord(sourceName, opts, ip) {
        const src = await prisma_1.prisma.fileRecord.findUnique({
            where: { name: sourceName },
            include: { copies: true, tags: true },
        });
        if (!src)
            return sourceName;
        const fileId = this.makeFileId();
        const copies = src.copies
            .filter((c) => c.status === 'active' || c.isPrimary)
            .map((c) => ({
            channelId: c.channelId,
            remoteKey: c.remoteKey,
            remoteUrl: c.remoteUrl,
            objectPath: c.objectPath,
            urlQuery: c.urlQuery,
            metas: c.metas,
            status: c.status === 'failed' ? 'failed' : 'active',
            isPrimary: c.isPrimary,
        }));
        const newOriginalName = String(opts.originalName || '').trim() || src.originalName;
        const instanceId = String(opts.instanceId || '');
        const sameInstance = String(src.instanceId || '') === instanceId;
        const tagRows = sameInstance ? src.tags.map((t) => ({ tagId: t.tagId })) : [];
        let metas = src.metas;
        try {
            const obj = (JSON.parse(src.metas || '{}') || {});
            const prev = (obj.ProcessEvent && typeof obj.ProcessEvent === 'object' ? obj.ProcessEvent : {});
            obj.ProcessEvent = {
                ...prev,
                Dedup: {
                    IsDuplicate: true,
                    SourceFileId: src.name,
                    SourceOriginalName: src.originalName,
                    ClonedAt: new Date().toISOString(),
                },
            };
            metas = JSON.stringify(obj);
        }
        catch {
            metas = src.metas;
        }
        try {
            const now = new Date();
            const created = await prisma_1.prisma.fileRecord.create({
                data: {
                    name: fileId,
                    firstName: fileId,
                    prevName: '',
                    originalName: newOriginalName,
                    size: src.size,
                    originalSize: src.originalSize,
                    mime: src.mime,
                    hash: src.hash,
                    md5: src.md5,
                    folder: src.folder,
                    uploader: opts.uploader || '',
                    uploadSource: opts.uploadSource || 'Default',
                    ip,
                    instanceId,
                    metas,
                    uploadStartedAt: now,
                    uploadFinishedAt: now,
                    copies: { create: copies },
                    ...(tagRows.length ? { tags: { create: tagRows } } : {}),
                },
                select: { name: true, id: true },
            });
            await this.autoTag(created.id, {
                originalName: newOriginalName,
                mime: opts.mime || src.mime,
                channelType: String(opts.channelType || ''),
                uploadSource: opts.uploadSource || 'Default',
                instanceId,
                owner: opts.uploader || '',
            });
            app_log_1.appLog.info('upload', `去重复刻完成：${newOriginalName} → ${created.name}`, `源文件=${src.name}（${src.originalName}） ｜ 复刻标签=${tagRows.length} ｜ 实例=${instanceId || '默认'}`, ip);
            return created.name;
        }
        catch (err) {
            app_log_1.appLog.warn('upload', `去重克隆失败，回退复用原外链`, `${err.message} ｜ 源=${sourceName}`, ip);
            return sourceName;
        }
    }
    copyWriteData(result, channel) {
        const snap = {
            channelType: channel.type,
            capturedAt: new Date().toISOString(),
        };
        const allow = [
            'bucket', 'region', 'pathStyle', 'objectPrefix', 'nameTemplate', 'customName',
            'prefixPath', 'directory', 'albumId', 'shareLinkId', 'suffix', 'rootPath',
        ];
        let cfg = {};
        if (typeof channel.config === 'string') {
            try {
                const parsed = JSON.parse(channel.config || '{}');
                if (parsed && typeof parsed === 'object')
                    cfg = parsed;
            }
            catch {
                cfg = {};
            }
        }
        else {
            cfg = channel.config || {};
        }
        for (const k of allow) {
            const v = cfg[k];
            if (v === undefined || v === '')
                continue;
            if (/secret|token|password|api[-_]?key/i.test(k))
                continue;
            snap[k] = v;
        }
        const metas = { ...(result.metas || {}), snap };
        return {
            remoteKey: result.remoteKey,
            remoteUrl: result.remoteUrl || '',
            objectPath: result.objectPath || '',
            urlQuery: result.urlQuery || '',
            metas: JSON.stringify(metas),
        };
    }
    async removeFile(id, name = '') {
        const rec = await prisma_1.prisma.fileRecord.findUnique({
            where: { id },
            select: { uploadSource: true, originalName: true },
        });
        const registered = (0, file_view_1.normalizeUploadSource)(rec?.uploadSource) === 'Record';
        const copies = await prisma_1.prisma.fileCopy.findMany({ where: { fileId: id } });
        let sharedSkipped = 0;
        for (const copy of copies) {
            if (registered)
                continue;
            if (!copy.remoteKey && !copy.remoteUrl && !copy.objectPath)
                continue;
            const refKeys = [];
            if (copy.remoteKey)
                refKeys.push({ remoteKey: copy.remoteKey });
            if (copy.objectPath)
                refKeys.push({ objectPath: copy.objectPath });
            if (refKeys.length) {
                const shared = await prisma_1.prisma.fileCopy.count({
                    where: {
                        channelId: copy.channelId,
                        fileId: { not: id },
                        file: { status: 'active' },
                        OR: refKeys,
                    },
                });
                if (shared > 0) {
                    sharedSkipped += 1;
                    continue;
                }
            }
            const ch = await prisma_1.prisma.channel.findUnique({ where: { id: copy.channelId } });
            if (!ch)
                continue;
            try {
                const info = {
                    id: ch.id,
                    name: ch.name,
                    type: ch.type,
                    config: this.channels.decryptConfig(ch.type, ch.config),
                    metas: {},
                };
                await (0, adapter_factory_1.createAdapter)(info).delete((0, adapter_factory_1.toCopyInfo)(copy), info);
            }
            catch (err) {
                app_log_1.appLog.warn('upload', `远端删除失败（继续删库）${name || id}`, err.message);
            }
        }
        await prisma_1.prisma.fileRecord.delete({ where: { id } });
        app_log_1.appLog.info('upload', `删除文件：${name || id}`, registered
            ? '登记文件：只删库记录，不动源站对象'
            : `远端副本 ${copies.length} 个${sharedSkipped ? `（其中 ${sharedSkipped} 个仍被其他记录/实例复用，仅删库）` : ''}`);
    }
    backupAllJob = null;
    startBackupAll() {
        if (this.backupAllJob?.running) {
            return { started: false, message: '已有备份任务在进行中，请稍候' };
        }
        this.backupAllJob = { running: true, total: 0, done: 0, ok: 0, fail: 0, startedAt: Date.now(), finishedAt: 0 };
        void this.runBackupAll().catch((err) => {
            app_log_1.appLog.error('backup', `一键备份任务异常终止：${err.message}`);
            if (this.backupAllJob) {
                this.backupAllJob.running = false;
                this.backupAllJob.finishedAt = Date.now();
            }
        });
        return { started: true };
    }
    backupAllStatus() {
        return this.backupAllJob || { running: false, total: 0, done: 0, ok: 0, fail: 0, startedAt: 0, finishedAt: 0 };
    }
    async runBackupAll() {
        const job = this.backupAllJob;
        const records = await prisma_1.prisma.fileRecord.findMany({
            where: { status: 'active' },
            include: { copies: true },
            orderBy: { createdAt: 'desc' },
        });
        const cache = new Map();
        const backupFor = async (uploader) => {
            const k = String(uploader || '');
            if (!cache.has(k))
                cache.set(k, await this.resolveBackupChannel({ uploader: k || undefined }));
            return cache.get(k) ?? null;
        };
        const pending = [];
        for (const rec of records) {
            const backup = await backupFor(rec.uploader);
            if (!backup)
                continue;
            if (rec.copies.some((c) => c.channelId === backup.id && c.status === 'active'))
                continue;
            pending.push({ rec, backup });
        }
        job.total = pending.length;
        if (!pending.length) {
            app_log_1.appLog.info('backup', '一键备份：所有文件均已有备份，无需处理');
            job.running = false;
            job.finishedAt = Date.now();
            return;
        }
        app_log_1.appLog.info('backup', `一键备份开始：共 ${pending.length} 个文件待备份`);
        for (const { rec, backup } of pending) {
            const okOne = await this.enqueueLowPriority(async () => {
                try {
                    await this.backupSingleFromMain(rec, backup);
                    return true;
                }
                catch (err) {
                    app_log_1.appLog.error('backup', `一键备份失败：${rec.name}（${rec.originalName}）`, err.message);
                    return false;
                }
            });
            if (okOne)
                job.ok += 1;
            else
                job.fail += 1;
            job.done += 1;
        }
        job.running = false;
        job.finishedAt = Date.now();
        app_log_1.appLog.info('backup', `一键备份完成：成功 ${job.ok}，失败 ${job.fail}，共 ${job.total}`);
    }
    async backupSingleFromMain(rec, backup) {
        if (rec.copies.some((c) => c.channelId === backup.id && c.status === 'active'))
            return;
        const mainCopy = rec.copies.find((c) => c.status === 'active' && c.remoteKey);
        if (!mainCopy)
            throw new Error('没有可用的主渠道副本');
        const mainCh = await prisma_1.prisma.channel.findUnique({ where: { id: mainCopy.channelId } });
        if (!mainCh)
            throw new Error('主渠道记录不存在');
        const mainInfo = this.toChannelInfo(mainCh);
        const mainAdapter = (0, adapter_factory_1.createAdapter)(mainInfo);
        let buf;
        if (mainCh.type === 'local') {
            const abs = await (0, local_adapter_1.localFileAbsOf)(mainCopy.remoteKey);
            if (!abs)
                throw new Error('本地文件不存在，无法备份');
            buf = await fs_1.promises.readFile(abs);
        }
        else {
            const url = mainAdapter.buildDirectUrl((0, adapter_factory_1.toCopyInfo)(mainCopy), mainInfo);
            if (!url)
                throw new Error('无法构造主渠道直链');
            const resp = await fetch(url);
            if (!resp.ok)
                throw new Error(`源文件拉取失败 HTTP ${resp.status}`);
            buf = Buffer.from(await resp.arrayBuffer());
        }
        const info = this.toChannelInfo(backup);
        const adapter = (0, adapter_factory_1.createAdapter)(info);
        const result = await adapter.upload({ buffer: buf, mime: rec.mime, originalName: rec.originalName }, mainCopy.remoteKey, info);
        await prisma_1.prisma.fileCopy.upsert({
            where: { fileId_channelId: { fileId: rec.id, channelId: backup.id } },
            update: { ...this.copyWriteData(result, backup), status: 'active' },
            create: { fileId: rec.id, channelId: backup.id, ...this.copyWriteData(result, backup), status: 'active' },
        });
    }
    async convertChannel(input) {
        const rec = await prisma_1.prisma.fileRecord.findFirst({
            where: {
                uploader: input.uploader,
                status: 'active',
                OR: [{ id: input.recordId }, { name: input.recordId }],
            },
            include: { copies: { include: { channel: true } } },
        });
        if (!rec)
            return { ok: false, message: '文件不存在或无权操作' };
        const activeCopies = rec.copies.filter((c) => c.status === 'active');
        if (!activeCopies.length)
            return { ok: false, message: '该文件没有可用的渠道副本，无法转存' };
        const sourceCopy = activeCopies.find((c) => c.isPrimary) || activeCopies[0];
        const sourceCh = sourceCopy.channel;
        if (!sourceCh)
            return { ok: false, message: '源渠道记录已不存在，无法转存' };
        const targetCh = await prisma_1.prisma.channel.findUnique({ where: { id: input.targetChannelId } });
        if (!targetCh)
            return { ok: false, message: '目标渠道不存在' };
        if (!targetCh.enabled)
            return { ok: false, message: `目标渠道「${targetCh.name}」已停用` };
        if (targetCh.isBackup) {
            return { ok: false, message: '「备份渠道」只做本份镜像，不能作为转存目标' };
        }
        if (targetCh.id === sourceCh.id)
            return { ok: false, message: '目标渠道与当前渠道相同，无需转存' };
        const isLocalType = (t) => t === 'local' || t === 'localfiles';
        const srcLocal = isLocalType(sourceCh.type);
        const dstLocal = isLocalType(targetCh.type);
        if (targetCh.type === 'localfiles') {
            return { ok: false, message: '「挂载文件」是浏览入口，不能作为转存目标，请选择本地存储渠道' };
        }
        if (srcLocal && dstLocal)
            return { ok: false, message: '源渠道与目标渠道都是本地存储，无需转存' };
        if (!srcLocal && !dstLocal) {
            return { ok: false, message: '第三方渠道之间不支持直接转存，请先「转本地」再「转异地」' };
        }
        const registered = String(rec.uploadSource || '') === 'Record';
        const deleteSource = srcLocal ? true : input.deleteSource === true;
        if (deleteSource && registered) {
            return { ok: false, message: '登记文件不允许删除源件（源文件不在本系统管理范围内）' };
        }
        const prevMarker = this.readConvertMarker(sourceCopy.metas);
        const sameTarget = !!prevMarker && prevMarker.targetChannelId === targetCh.id;
        if (prevMarker?.staged && !sameTarget)
            await this.dropStagedCopy(prevMarker, input.ip);
        const marker = {
            state: 'pending',
            targetChannelId: targetCh.id,
            targetChannelName: targetCh.name,
            sourceChannelId: sourceCh.id,
            deleteSource,
            startedAt: Date.now(),
            attempts: (sameTarget ? Number(prevMarker?.attempts) || 0 : 0) + 1,
            ...(sameTarget && prevMarker?.staged ? { staged: prevMarker.staged } : {}),
        };
        try {
            await this.saveConvertMarker(sourceCopy.id, sourceCopy.metas, marker);
        }
        catch (err) {
            return { ok: false, message: `登记转存任务失败：${err.message}` };
        }
        const fail = async (message, retryable = true) => {
            marker.state = 'failed';
            marker.lastError = message;
            await this.saveConvertMarker(sourceCopy.id, sourceCopy.metas, marker).catch(() => undefined);
            return { ok: false, message, retryable };
        };
        const srcInfo = this.toChannelInfo(sourceCh);
        const srcAdapter = (0, adapter_factory_1.createAdapter)(srcInfo);
        let srcPath = '';
        let tempSrc = '';
        let srcSize = 0;
        try {
            if (srcLocal) {
                const abs = await (0, local_adapter_1.localFileAbsOf)(sourceCopy.remoteKey);
                if (!abs)
                    return await fail('本地源文件已不存在（可能被手工删除），无法转存', false);
                const st = await fs_1.promises.stat(abs).catch(() => null);
                if (!st || !st.isFile())
                    return await fail('本地源文件已不存在（可能被手工删除），无法转存', false);
                if (!st.size)
                    return await fail('源文件为空，已取消转存', false);
                srcPath = abs;
                srcSize = st.size;
            }
            else {
                const url = srcAdapter.buildDirectUrl((0, adapter_factory_1.toCopyInfo)(sourceCopy), srcInfo, true);
                if (!url)
                    return await fail('无法构造源渠道直链，转存失败');
                const pulled = await this.downloadToTempFile(url, rec, input.ip);
                srcPath = pulled.path;
                tempSrc = pulled.path;
                srcSize = pulled.size;
            }
            if (!srcSize)
                return await fail('源文件为空，已取消转存', false);
            const dstInfo = this.toChannelInfo(targetCh);
            const dstAdapter = (0, adapter_factory_1.createAdapter)(dstInfo);
            let result = sameTarget ? prevMarker?.staged : undefined;
            if (!result) {
                const dstKey = this.makeKeyFor({ id: targetCh.id, code: targetCh.code, name: targetCh.name, type: targetCh.type, config: targetCh.config }, rec.originalName, undefined, rec.md5 || (await this.md5OfFile(srcPath)), rec.uploader || '');
                try {
                    result = await this.uploadFileReliable(dstAdapter, srcPath, srcSize, rec, dstKey, dstInfo, {
                        owner: rec.uploader || '',
                        instanceId: rec.instanceId || '',
                    });
                }
                catch (err) {
                    app_log_1.appLog.warn('channel', `文件转存失败：写入目标渠道「${targetCh.name}」出错`, `${err.message} ｜ 文件=${rec.name} ｜ 大小=${srcSize}B ｜ 第 ${marker.attempts} 次尝试`, input.ip);
                    return await fail(`写入目标渠道失败：${err.message}`);
                }
                marker.staged = result;
                try {
                    await this.saveConvertMarker(sourceCopy.id, sourceCopy.metas, marker);
                }
                catch (err) {
                    app_log_1.appLog.warn('channel', '转存实体已写入，但「已暂存」标记落库失败（重试会重新上传）', `${err.message} ｜ 文件=${rec.name}`, input.ip);
                }
                if (dstLocal) {
                    const dstAbs = await (0, local_adapter_1.localFileAbsOf)(result.remoteKey).catch(() => null);
                    const st = dstAbs ? await fs_1.promises.stat(dstAbs).catch(() => null) : null;
                    if (st && st.size !== srcSize) {
                        return await fail(`目标渠道写入不完整（${st.size}/${srcSize} 字节），已中止切换`);
                    }
                }
            }
            const staged = result;
            if (!staged)
                return await fail('转存实体尚未就绪，请重试', true);
            const writeData = { ...this.copyWriteData(staged, targetCh), status: 'active', isPrimary: true };
            const existingTarget = rec.copies.find((c) => c.channelId === targetCh.id && c.id !== sourceCopy.id);
            const convertSource = dstLocal ? 'StoreIn' : 'StoreOut';
            const uploadSourceOp = prisma_1.prisma.fileRecord.update({
                where: { id: rec.id },
                data: { uploadSource: convertSource },
            });
            const ops = existingTarget
                ? [
                    prisma_1.prisma.fileCopy.update({ where: { id: existingTarget.id }, data: writeData }),
                    prisma_1.prisma.fileCopy.delete({ where: { id: sourceCopy.id } }),
                    uploadSourceOp,
                ]
                : [
                    prisma_1.prisma.fileCopy.update({
                        where: { id: sourceCopy.id },
                        data: { channelId: targetCh.id, ...writeData },
                    }),
                    uploadSourceOp,
                ];
            try {
                await prisma_1.prisma.$transaction(ops);
            }
            catch (err) {
                const msg = `切换文件渠道数据失败：${err.message}`;
                app_log_1.appLog.error('channel', '文件转存：数据切换失败（实体已暂存在目标渠道，可重试）', msg, input.ip);
                return await fail(msg);
            }
            let deletedSource = false;
            if (deleteSource) {
                try {
                    await srcAdapter.delete((0, adapter_factory_1.toCopyInfo)(sourceCopy), srcInfo);
                }
                catch (err) {
                    app_log_1.appLog.warn('channel', `转存后删除源件失败（主副本已切到新渠道）：${sourceCh.name}`, `${err.message} ｜ 文件=${rec.name}`, input.ip);
                }
                deletedSource = true;
            }
            else {
                await prisma_1.prisma.fileCopy
                    .upsert({
                    where: { fileId_channelId: { fileId: rec.id, channelId: sourceCh.id } },
                    update: { status: 'active', isPrimary: false },
                    create: {
                        fileId: rec.id,
                        channelId: sourceCh.id,
                        remoteKey: sourceCopy.remoteKey,
                        remoteUrl: sourceCopy.remoteUrl || '',
                        objectPath: sourceCopy.objectPath || '',
                        urlQuery: sourceCopy.urlQuery || '',
                        metas: JSON.stringify(this.withoutConvertMarker(sourceCopy.metas)),
                        status: 'active',
                        isPrimary: false,
                    },
                })
                    .catch(() => undefined);
            }
            app_log_1.appLog.info('channel', `文件转存成功：${sourceCh.name}（${sourceCh.type}）→ ${targetCh.name}（${targetCh.type}）`, `${deletedSource ? '已删除源件' : '保留源件'} ｜ 文件=${rec.name} ｜ ${srcSize}B ｜ 第 ${marker.attempts} 次尝试 ｜ 上传方式=${convertSource} ｜ 外链不变`, input.ip);
            return {
                ok: true,
                channelName: targetCh.name,
                direction: dstLocal ? 'to-local' : 'to-remote',
                deletedSource,
                bytes: srcSize,
                attempts: marker.attempts,
            };
        }
        finally {
            if (tempSrc)
                await fs_1.promises.rm(tempSrc, { force: true }).catch(() => undefined);
        }
    }
    readConvertMarker(metas) {
        try {
            const obj = JSON.parse(String(metas || '{}'));
            const c = obj?.__convert;
            return c && typeof c === 'object' ? c : null;
        }
        catch {
            return null;
        }
    }
    withoutConvertMarker(metas) {
        let obj = {};
        try {
            obj = JSON.parse(String(metas || '{}'));
        }
        catch {
            obj = {};
        }
        delete obj.__convert;
        return obj;
    }
    async saveConvertMarker(copyId, baseMetas, marker) {
        const next = this.withoutConvertMarker(baseMetas);
        next.__convert = marker;
        await prisma_1.prisma.fileCopy.update({ where: { id: copyId }, data: { metas: JSON.stringify(next) } });
    }
    async dropStagedCopy(marker, ip) {
        const staged = marker.staged;
        if (!staged)
            return;
        try {
            const ch = await prisma_1.prisma.channel.findUnique({ where: { id: marker.targetChannelId } });
            if (!ch)
                return;
            const info = this.toChannelInfo(ch);
            const adapter = (0, adapter_factory_1.createAdapter)(info);
            await adapter.delete({
                remoteKey: staged.remoteKey,
                remoteUrl: staged.remoteUrl || '',
                objectPath: staged.objectPath || '',
                urlQuery: staged.urlQuery || '',
                metas: (staged.metas || {}),
            }, info);
        }
        catch (err) {
            app_log_1.appLog.warn('channel', '转存：清理上一轮暂存实体失败（目标渠道可能残留一个孤儿文件）', `${err.message} ｜ key=${staged.remoteKey}`, ip);
        }
    }
    async md5OfFile(path) {
        const hash = (0, crypto_1.createHash)('md5');
        await new Promise((resolve, reject) => {
            const rs = (0, fs_1.createReadStream)(path);
            rs.on('data', (c) => hash.update(c));
            rs.on('error', reject);
            rs.on('end', () => resolve());
        });
        return hash.digest('hex');
    }
    async downloadToTempFile(url, rec, ip) {
        const dir = await fs_1.promises.mkdtemp((0, path_1.join)((0, os_1.tmpdir)(), 'gohub-convert-')).catch(() => (0, os_1.tmpdir)());
        const dest = (0, path_1.join)(dir, `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        let lastErr = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                const resp = await fetch(url);
                if (!resp.ok || !resp.body)
                    throw new Error(`HTTP ${resp.status}`);
                const expect = Number(resp.headers.get('content-length') || 0) || 0;
                const hash = (0, crypto_1.createHash)('md5');
                const tap = new stream_1.Transform({
                    transform(chunk, _enc, cb) {
                        hash.update(chunk);
                        cb(null, chunk);
                    },
                });
                await (0, promises_1.pipeline)(stream_1.Readable.fromWeb(resp.body), tap, (0, fs_1.createWriteStream)(dest));
                const st = await fs_1.promises.stat(dest);
                if (!st.size)
                    throw new Error('下载内容为空');
                if (expect && st.size !== expect)
                    throw new Error(`下载不完整（${st.size}/${expect} 字节）`);
                const digest = hash.digest('hex');
                const want = String(rec.md5 || '').toLowerCase();
                if (want && want !== digest)
                    throw new Error(`MD5 校验不一致（${digest} ≠ ${want}）`);
                return { path: dest, size: st.size };
            }
            catch (err) {
                lastErr = err;
                await fs_1.promises.rm(dest, { force: true }).catch(() => undefined);
                app_log_1.appLog.warn('channel', `转存取源失败（第 ${attempt}/3 次）：${rec.name || ''}`, lastErr.message, ip);
                if (attempt < 3)
                    await new Promise((r) => setTimeout(r, 500 * attempt));
            }
        }
        throw new Error(`拉取源文件失败（已重试 3 次）：${lastErr?.message || '未知原因'}`);
    }
    async uploadFileReliable(adapter, path, size, rec, key, info, ctx) {
        let lastErr = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                if (typeof adapter.uploadFile === 'function') {
                    return await adapter.uploadFile(path, size, { mime: rec.mime, originalName: rec.originalName }, key, info, ctx);
                }
                if (size > STREAM_REQUIRED_BYTES) {
                    throw new Error(`目标渠道不支持流式写入，${(size / 1024 / 1024).toFixed(0)}MB 超过安全阈值，已拒绝以免占满内存`);
                }
                const buffer = await fs_1.promises.readFile(path);
                return await adapter.upload({ buffer, mime: rec.mime, originalName: rec.originalName }, key, info, ctx);
            }
            catch (err) {
                lastErr = err;
                const code = err?.code || '';
                const fatal = /不支持流式写入|超过安全阈值|413|401|403|404/i.test(lastErr.message) || code === 'ENOSPC';
                if (fatal || attempt === 3)
                    break;
                await new Promise((r) => setTimeout(r, 400 * attempt));
            }
        }
        throw lastErr || new Error('写入目标渠道失败');
    }
};
exports.UploadService = UploadService;
exports.UploadService = UploadService = UploadService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        channels_controller_1.ChannelsService,
        sysconfig_service_1.SysConfigService,
        storage_channel_service_1.StorageChannelService])
], UploadService);
