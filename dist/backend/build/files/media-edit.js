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
exports.videoCodecLabel = videoCodecLabel;
exports.extOf = extOf;
exports.resolveMediaTarget = resolveMediaTarget;
exports.cropImage = cropImage;
exports.compressInPlace = compressInPlace;
exports.toWebp = toWebp;
exports.transcodeInPlace = transcodeInPlace;
exports.logAbandoned = logAbandoned;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const fs_1 = require("fs");
const node_path_1 = require("node:path");
const prisma_1 = require("../common/prisma");
const app_log_1 = require("../common/app-log");
const local_adapter_1 = require("../adapters/local.adapter");
const compress_1 = require("../common/compress");
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif']);
const VIDEO_CODEC_LABELS = {
    avc1: 'H.264 (AVC)',
    avc3: 'H.264 (AVC)',
    hvc1: 'H.265 (HEVC)',
    hev1: 'H.265 (HEVC)',
    dvh1: 'Dolby Vision (HEVC)',
    dvhe: 'Dolby Vision (HEVC)',
    av01: 'AV1',
    vp09: 'VP9',
    vp08: 'VP8',
    vvc1: 'H.266 (VVC)',
    vvi1: 'H.266 (VVC)',
    mp4v: 'MPEG-4 Part 2',
    prores: 'Apple ProRes',
};
function videoCodecLabel(codec) {
    const k = String(codec || '').trim().toLowerCase();
    if (!k)
        return '';
    return VIDEO_CODEC_LABELS[k] || k.toUpperCase();
}
function extOf(nameOrFile) {
    const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(nameOrFile || ''));
    return m ? m[1].toLowerCase() : '';
}
async function resolveMediaTarget(fileKey, uploader) {
    const rec = await prisma_1.prisma.fileRecord.findFirst({
        where: {
            uploader,
            status: 'active',
            OR: [{ id: fileKey }, { name: fileKey }],
        },
        include: { copies: { include: { channel: true } } },
    });
    if (!rec)
        return { reason: '文件不存在或无权操作' };
    const active = rec.copies.filter((c) => c.status === 'active');
    const primary = active.find((c) => c.isPrimary) ||
        active.find((c) => c.channel?.isMain) ||
        active[0];
    if (!primary || !primary.channel)
        return { reason: '该文件没有可用的渠道副本' };
    if (primary.channel.type !== 'local') {
        return { reason: '只有在「本地存储」渠道上的文件才支持原位编辑，请先「转本地」' };
    }
    const abs = (0, local_adapter_1.localAbsPathOf)(primary.channel, primary.remoteKey || '');
    if (!abs)
        return { reason: '无法解析本地文件路径' };
    try {
        await fs_1.promises.stat(abs);
    }
    catch {
        return { reason: '磁盘上的文件已不存在（可能被手工删除）' };
    }
    let metas = {};
    try {
        metas = JSON.parse(rec.metas || '{}');
    }
    catch {
        metas = {};
    }
    const ext = extOf(rec.originalName || rec.name) || extOf(primary.remoteKey || '');
    return {
        target: {
            id: rec.id,
            name: rec.name,
            originalName: rec.originalName,
            ext,
            mime: rec.mime || '',
            size: rec.size || 0,
            originalSize: rec.originalSize || 0,
            abs,
            metas,
            compressedBefore: !!rec.originalSize && rec.originalSize !== rec.size,
            remoteKey: primary.remoteKey || '',
        },
    };
}
async function writeInPlace(abs, data) {
    const tmp = `${abs}.edit-${Date.now()}.tmp`;
    if (typeof data === 'string') {
        await fs_1.promises.rename(data, tmp).catch(async () => {
            await fs_1.promises.copyFile(data, tmp);
            await fs_1.promises.rm(data, { force: true }).catch(() => undefined);
        });
    }
    else {
        await fs_1.promises.writeFile(tmp, data);
    }
    await fs_1.promises.rename(tmp, abs);
}
async function commitEdit(target, opts) {
    let md5 = '';
    try {
        md5 = await new Promise((resolve, reject) => {
            const hash = (0, node_crypto_1.createHash)('md5');
            (0, node_fs_1.createReadStream)(target.abs)
                .on('data', (chunk) => hash.update(chunk))
                .on('error', reject)
                .on('end', () => resolve(hash.digest('hex')));
        });
    }
    catch {
        md5 = '';
    }
    const metas = { ...target.metas, EditedAt: Date.now() };
    if (opts.width && opts.height) {
        metas.Width = opts.width;
        metas.Height = opts.height;
    }
    else {
        delete metas.Width;
        delete metas.Height;
    }
    const data = {
        size: opts.size,
        metas: JSON.stringify(metas),
    };
    try {
        const prev = await prisma_1.prisma.fileRecord.findUnique({
            where: { id: target.id },
            select: { md5: true, originalMd5: true, size: true, originalSize: true },
        });
        if (prev) {
            if (!String(prev.originalMd5 || '') && String(prev.md5 || ''))
                data.originalMd5 = String(prev.md5);
            if (!Number(prev.originalSize)) {
                const pristine = Number(prev.size) || Number(target.size) || 0;
                if (pristine > 0)
                    data.originalSize = pristine;
            }
        }
    }
    catch {
    }
    if (md5)
        data.md5 = md5;
    if (opts.mime)
        data.mime = opts.mime;
    if (opts.markEdited)
        data.editedAt = new Date();
    if (opts.recordOriginal && !target.compressedBefore) {
        data.originalSize = target.size;
    }
    else if (opts.recordOriginal && target.compressedBefore) {
        data.originalSize = target.originalSize || target.size;
    }
    await prisma_1.prisma.fileRecord.update({ where: { id: target.id }, data });
    app_log_1.appLog.info('file', `原位编辑完成：${target.name}`, `${opts.kind} ｜ ${target.size}B → ${opts.size}B ｜ ${opts.mime || target.mime}`);
    return { md5 };
}
async function renameExtToWebp(target) {
    try {
        const oldAbs = target.abs;
        const dir = (0, node_path_1.dirname)(oldAbs);
        const base = (0, node_path_1.basename)(oldAbs);
        const stem = base.replace(/\.[A-Za-z0-9]{1,12}$/, '');
        const newBase = `${stem}.webp`;
        if (newBase === base)
            return false;
        const newAbs = (0, node_path_1.join)(dir, newBase);
        await fs_1.promises.rename(oldAbs, newAbs);
        const newKey = target.remoteKey
            ? target.remoteKey.replace(/[^/]+$/, newBase)
            : newBase;
        if (target.remoteKey) {
            await prisma_1.prisma.fileCopy.updateMany({
                where: { fileId: target.id, remoteKey: target.remoteKey },
                data: { remoteKey: newKey },
            });
        }
        const newOriginal = /\.([A-Za-z0-9]{1,12})$/.test(target.originalName || '')
            ? target.originalName.replace(/\.[A-Za-z0-9]{1,12}$/, '.webp')
            : `${target.originalName || stem}.webp`;
        await prisma_1.prisma.fileRecord.update({
            where: { id: target.id },
            data: { originalName: newOriginal },
        });
        target.abs = newAbs;
        target.remoteKey = newKey;
        target.originalName = newOriginal;
        target.ext = 'webp';
        return true;
    }
    catch (err) {
        app_log_1.appLog.warn('file', `转 WebP 后改扩展名失败：${target.name}`, err.message);
        return false;
    }
}
async function cropImage(target, buffer) {
    const started = Date.now();
    const ext = target.ext;
    if (!IMAGE_EXT.has(ext))
        return { ok: false, message: `「${ext || '未知'}」格式不支持裁剪` };
    const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
    try {
        const pipeline = sharp(buffer, { limitInputPixels: 60_000_000 });
        const meta = await pipeline.metadata();
        let encoded;
        if (ext === 'jpg' || ext === 'jpeg')
            encoded = await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
        else if (ext === 'png')
            encoded = await pipeline.png({ compressionLevel: 9 }).toBuffer();
        else if (ext === 'webp')
            encoded = await pipeline.webp({ quality: 92 }).toBuffer();
        else
            encoded = await pipeline.avif({ quality: 60 }).toBuffer();
        if (!encoded.length)
            return { ok: false, message: '裁剪结果为空' };
        await writeInPlace(target.abs, encoded);
        const { md5 } = await commitEdit(target, {
            size: encoded.length,
            mime: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
            width: meta.width,
            height: meta.height,
            markEdited: true,
            kind: '裁剪',
        });
        return { ok: true, size: encoded.length, width: meta.width, height: meta.height, md5, elapsedMs: Date.now() - started };
    }
    catch (err) {
        return { ok: false, message: `裁剪失败：${err.message}`, elapsedMs: Date.now() - started };
    }
}
async function compressInPlace(target, percent, maxSeconds) {
    const started = Date.now();
    const deadline = maxSeconds > 0 ? started + maxSeconds * 1000 : 0;
    const p = Math.min(100, Math.max(10, Math.round(percent || 0)));
    const ext = target.ext;
    const mime = target.mime || '';
    const tooLate = () => deadline > 0 && Date.now() > deadline
        ? `执行时间超过「压缩文件上限时长」（${maxSeconds} 秒），已放弃本次压缩`
        : '';
    try {
        if (mime.startsWith('image/')) {
            if (!IMAGE_EXT.has(ext))
                return { ok: false, message: `「${ext}」格式不支持压缩` };
            const r = await compressImageSameFormat(target.abs, ext, p, target.size);
            if (!r.buffer)
                return { ok: false, message: r.reason || '压缩后体积未减小' };
            await writeInPlace(target.abs, r.buffer);
            const { md5 } = await commitEdit(target, {
                size: r.buffer.length,
                mime: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
                width: r.width,
                height: r.height,
                recordOriginal: true,
                kind: `压缩(${p}%)`,
            });
            return { ok: true, size: r.buffer.length, width: r.width, height: r.height, md5, elapsedMs: Date.now() - started };
        }
        if (mime.startsWith('video/')) {
            if (!(0, compress_1.ffmpegAvailable)())
                return { ok: false, message: '服务端未安装 ffmpeg，无法压缩视频' };
            if (!['mp4', 'm4v', 'mov', 'webm'].includes(ext)) {
                return { ok: false, message: `「${ext}」容器暂不支持原位压缩（会改变扩展名，破坏已签发外链）` };
            }
            const remain = deadline > 0 ? Math.max(5, Math.round((deadline - Date.now()) / 1000)) : undefined;
            const r = await (0, compress_1.compressVideoFile)(target.abs, ext, p, target.size, remain);
            if (!r.compressed)
                return { ok: false, message: r.reason || '压缩未生效' };
            const late = tooLate();
            if (late)
                return { ok: false, message: late, elapsedMs: Date.now() - started };
            await writeInPlace(target.abs, r.path);
            const { md5 } = await commitEdit(target, {
                size: r.size,
                mime: r.mime || mime,
                recordOriginal: true,
                kind: `压缩(${p}%)`,
            });
            return { ok: true, size: r.size, md5, mime: r.mime || mime, elapsedMs: Date.now() - started };
        }
        if (mime.startsWith('audio/')) {
            if (!(0, compress_1.ffmpegAvailable)())
                return { ok: false, message: '服务端未安装 ffmpeg，无法压缩音频' };
            const remain = deadline > 0 ? Math.max(5, Math.round((deadline - Date.now()) / 1000)) : undefined;
            const r = await (0, compress_1.compressAudioFile)(target.abs, ext, p, target.size, remain);
            if (!r.compressed)
                return { ok: false, message: r.reason || '压缩未生效' };
            const late = tooLate();
            if (late)
                return { ok: false, message: late, elapsedMs: Date.now() - started };
            await writeInPlace(target.abs, r.path);
            const { md5 } = await commitEdit(target, {
                size: r.size,
                mime: r.mime || mime,
                recordOriginal: true,
                kind: `压缩(${p}%)`,
            });
            return { ok: true, size: r.size, md5, mime: r.mime || mime, elapsedMs: Date.now() - started };
        }
        return { ok: false, message: `「${mime || ext}」不支持压缩` };
    }
    catch (err) {
        const msg = err?.message || String(err);
        const timeout = /timeout|killed|SIGTERM|SIGKILL|maxBuffer/i.test(msg);
        const reason = timeout
            ? `执行时间超过「压缩文件上限时长」（${maxSeconds} 秒），已放弃本次压缩`
            : `压缩失败：${msg}`;
        app_log_1.appLog.warn('file', `原位压缩失败：${target.name}`, reason);
        return { ok: false, message: reason, elapsedMs: Date.now() - started };
    }
}
async function compressImageSameFormat(abs, ext, percent, original) {
    const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
    const target = Math.max(1024, Math.round((original * percent) / 100));
    const img = sharp(abs, { limitInputPixels: 60_000_000 });
    const meta = await img.metadata();
    const w = meta.width;
    const h = meta.height;
    const encode = async (quality) => {
        const p = sharp(abs, { limitInputPixels: 60_000_000 });
        if (ext === 'jpg' || ext === 'jpeg')
            return p.jpeg({ quality, mozjpeg: true }).toBuffer();
        if (ext === 'webp')
            return p.webp({ quality }).toBuffer();
        if (ext === 'avif')
            return p.avif({ quality }).toBuffer();
        return p.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    };
    if (ext === 'png') {
        const buf = await encode(100);
        if (buf.length >= original)
            return { reason: `png 重编码后没有变小（${original}B → ${buf.length}B）`, width: w, height: h };
        return { buffer: buf, width: w, height: h };
    }
    let quality = Math.min(90, Math.max(30, percent));
    let best = null;
    for (let i = 0; i < 4; i += 1) {
        const buf = await encode(quality);
        best = buf;
        if (buf.length <= target || quality <= 25)
            break;
        quality = Math.max(25, Math.round(quality * Math.sqrt(target / Math.max(1, buf.length))));
    }
    if (!best || best.length >= original) {
        return { reason: `压缩后体积未减小（${original}B → ${best?.length ?? 0}B）`, width: w, height: h };
    }
    return { buffer: best, width: w, height: h };
}
async function toWebp(target, lossless) {
    const started = Date.now();
    if (target.ext === 'webp' || target.mime === 'image/webp') {
        return { ok: false, message: '这个文件已经是 WebP 了，无需转换' };
    }
    if (!IMAGE_EXT.has(target.ext))
        return { ok: false, message: `「${target.ext || '未知'}」格式不支持转 WebP` };
    const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
    try {
        const pipeline = sharp(target.abs, { limitInputPixels: 60_000_000 });
        const meta = await pipeline.metadata();
        const buf = lossless
            ? await pipeline.webp({ lossless: true, effort: 5 }).toBuffer()
            : await pipeline.webp({ quality: 82, effort: 4 }).toBuffer();
        if (!buf.length)
            return { ok: false, message: 'WebP 转换结果为空' };
        await writeInPlace(target.abs, buf);
        await renameExtToWebp(target);
        const { md5 } = await commitEdit(target, {
            size: buf.length,
            mime: 'image/webp',
            width: meta.width,
            height: meta.height,
            kind: lossless ? '转WebP(无损)' : '转WebP(有损)',
        });
        return {
            ok: true,
            size: buf.length,
            width: meta.width,
            height: meta.height,
            md5,
            mime: 'image/webp',
            originalName: target.originalName,
            elapsedMs: Date.now() - started,
        };
    }
    catch (err) {
        return { ok: false, message: `转 WebP 失败：${err.message}`, elapsedMs: Date.now() - started };
    }
}
async function transcodeInPlace(target, maxSeconds) {
    const started = Date.now();
    if (!(target.mime || '').startsWith('video/'))
        return { ok: false, message: '只有视频文件支持转码' };
    if (!(0, compress_1.ffmpegAvailable)())
        return { ok: false, message: '服务端未安装 ffmpeg，无法转码' };
    let codec = '';
    try {
        codec = await (0, compress_1.probeVideoCodecFile)(target.abs);
    }
    catch {
        codec = '';
    }
    if (codec && !compress_1.VIDEO_CODEC_INCOMPATIBLE.has(codec)) {
        return {
            ok: false,
            message: `当前视频编码是 ${codec.toUpperCase()}，浏览器可以直接播放，无需转码`,
            elapsedMs: Date.now() - started,
        };
    }
    try {
        const r = await (0, compress_1.transcodeVideoFile)(target.abs, target.size, maxSeconds > 0 ? maxSeconds : undefined);
        if (!r.compressed) {
            const timeout = /timeout|killed|SIGTERM|SIGKILL/i.test(r.reason || '');
            const reason = timeout
                ? `执行时间超过「视频转码上限时长」（${maxSeconds} 秒），已放弃本次转码`
                : r.reason || '转码未生效';
            app_log_1.appLog.warn('file', `原位转码失败：${target.name}`, reason);
            return { ok: false, message: reason, elapsedMs: Date.now() - started };
        }
        await writeInPlace(target.abs, r.path);
        const mime = r.mime || 'video/mp4';
        const { md5 } = await commitEdit(target, {
            size: r.size,
            mime,
            kind: '转码H.264',
        });
        return { ok: true, size: r.size, md5, mime, elapsedMs: Date.now() - started };
    }
    catch (err) {
        const msg = err?.message || String(err);
        const timeout = /timeout|killed|SIGTERM|SIGKILL|maxBuffer/i.test(msg);
        const reason = timeout
            ? `执行时间超过「视频转码上限时长」（${maxSeconds} 秒），已放弃本次转码`
            : `转码失败：${msg}`;
        app_log_1.appLog.warn('file', `原位转码失败：${target.name}`, reason);
        return { ok: false, message: reason, elapsedMs: Date.now() - started };
    }
}
function logAbandoned(name, kind, reason) {
    app_log_1.appLog.warn('file', `已放弃${kind}：${name}`, reason);
}
