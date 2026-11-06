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
exports.VIDEO_CODEC_INCOMPATIBLE = exports.MEDIA_POST_MAX_SECONDS = void 0;
exports.ffmpegAvailable = ffmpegAvailable;
exports.probeMediaDurationFile = probeMediaDurationFile;
exports.probeAudioBitrateFile = probeAudioBitrateFile;
exports.probeVideoSizeFile = probeVideoSizeFile;
exports.compressMedia = compressMedia;
exports.readDimensions = readDimensions;
exports.compressFile = compressFile;
exports.compressVideoFile = compressVideoFile;
exports.compressAudioFile = compressAudioFile;
exports.probeVideoCodecFile = probeVideoCodecFile;
exports.probeVideoCodecBuffer = probeVideoCodecBuffer;
exports.transcodeVideoFile = transcodeVideoFile;
exports.readDimensionsFile = readDimensionsFile;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const crypto_1 = require("crypto");
const util_1 = require("util");
const run = (0, util_1.promisify)(child_process_1.execFile);
const IMAGE_OK = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif']);
const VIDEO_OK = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']);
const AUDIO_OK = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus']);
const SKIP = new Set(['gif', 'svg', 'heic', 'heif', 'tiff', 'tif', 'bmp', 'ico', 'apng', 'psd']);
exports.MEDIA_POST_MAX_SECONDS = Math.max(30, Number(process.env.MEDIA_POST_MAX_SECONDS || 300));
let ffmpegChecked = false;
let ffmpegPath = '';
function resolveFfmpegStatic() {
    try {
        const p = require('ffmpeg-static');
        return p || '';
    }
    catch {
        return '';
    }
}
function ffmpegAvailable() {
    if (ffmpegChecked)
        return !!ffmpegPath;
    ffmpegChecked = true;
    const envPath = String(process.env.FFMPEG_PATH || '').trim();
    const staticPath = resolveFfmpegStatic();
    for (const bin of [envPath, staticPath, 'ffmpeg'].filter(Boolean)) {
        try {
            (0, child_process_1.execFileSync)(bin, ['-version'], { stdio: 'ignore', timeout: 5000 });
            ffmpegPath = bin;
            console.log(`[compress] ffmpeg 可用：${bin === staticPath ? 'ffmpeg-static 内置二进制' : bin}（视频 / 音频压缩与转码已启用）`);
            return true;
        }
        catch {
        }
    }
    ffmpegPath = '';
    console.log('[compress] 未检测到 ffmpeg：视频 / 音频将跳过压缩与转码（图片压缩不受影响）');
    return false;
}
async function probeMediaDurationFile(srcPath) {
    if (!ffmpegAvailable())
        return 0;
    try {
        await run(ffmpegPath, ['-hide_banner', '-i', srcPath], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
        return 0;
    }
    catch (err) {
        const stderr = String(err.stderr || '');
        const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (!m)
            return 0;
        return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
}
async function probeAudioBitrateFile(srcPath) {
    if (!ffmpegAvailable())
        return 0;
    try {
        await run(ffmpegPath, ['-hide_banner', '-i', srcPath], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
        return 0;
    }
    catch (err) {
        const stderr = String(err.stderr || '');
        const audioLine = stderr.split(/\r?\n/).find((l) => l.includes('Audio:'));
        if (!audioLine)
            return 0;
        const m = audioLine.match(/(\d{2,6})\s*kb\/s/);
        return m ? Number(m[1]) : 0;
    }
}
async function probeVideoSizeFile(srcPath) {
    if (!ffmpegAvailable())
        return {};
    try {
        await run(ffmpegPath, ['-hide_banner', '-i', srcPath], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
        return {};
    }
    catch (err) {
        const stderr = String(err.stderr || '');
        const m = stderr.match(/(\d{2,5})x(\d{2,5})[\s,\[]/);
        if (!m)
            return {};
        const width = Number(m[1]);
        const height = Number(m[2]);
        if (!width || !height)
            return {};
        return { width, height };
    }
}
function clampQuality(percent) {
    const p = Number.isFinite(percent) && percent > 0 ? percent : 80;
    return Math.min(100, Math.max(10, p));
}
async function compressImage(buffer, ext, percent) {
    const keep = (reason) => ({ buffer, mime: '', ext: '', compressed: false, reason });
    if (SKIP.has(ext))
        return keep(`${ext} 格式不支持压缩`);
    if (!IMAGE_OK.has(ext))
        return keep(`${ext} 不是可压缩的图片格式`);
    const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
    sharp.cache({ memory: 32 });
    sharp.concurrency(2);
    const quality = clampQuality(percent);
    const ratio = Math.max(0.1, quality / 100);
    const target = Math.max(1024, Math.round(buffer.length * ratio));
    if (ext === 'png') {
        const out = await sharp(buffer, { limitInputPixels: 40_000_000 })
            .rotate()
            .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
            .toBuffer();
        if (out.length < buffer.length) {
            return { buffer: out, mime: 'image/png', ext: '.png', compressed: true };
        }
        return keep('png 重编码后没有变小（保持透明优先）');
    }
    let q = quality;
    let out = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().webp({ quality: q }).toBuffer();
    for (let i = 0; i < 4 && out.length > target && q > 20; i++) {
        q = Math.max(20, Math.round(q * Math.sqrt(target / out.length)));
        out = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().webp({ quality: q }).toBuffer();
    }
    if (out.length >= buffer.length)
        return keep('压缩后体积未减小');
    return { buffer: out, mime: 'image/webp', ext: '.webp', compressed: true };
}
async function withTempFiles(exts, fn) {
    const dir = await fs_1.promises.mkdtemp((0, path_1.join)((0, os_1.tmpdir)(), 'gohub-cmp-'));
    const paths = exts.map((e) => (0, path_1.join)(dir, `${(0, crypto_1.randomBytes)(6).toString('hex')}${e}`));
    try {
        return await fn(paths);
    }
    finally {
        for (const p of paths)
            await fs_1.promises.unlink(p).catch(() => undefined);
        await fs_1.promises.rmdir(dir).catch(() => undefined);
    }
}
async function compressVideo(buffer, ext, percent) {
    const keep = (reason) => ({ buffer, mime: '', ext: '', compressed: false, reason });
    if (!ffmpegAvailable())
        return keep('未安装 ffmpeg，视频跳过压缩');
    if (!VIDEO_OK.has(ext))
        return keep(`${ext} 不是可压缩的视频格式`);
    const p = clampQuality(percent);
    const crf = Math.min(40, Math.max(20, Math.round(38 - p * 0.14)));
    const outExt = ext === 'webm' ? '.webm' : '.mp4';
    try {
        return await withTempFiles([`.${ext}`, outExt], async ([src, dst]) => {
            await fs_1.promises.writeFile(src, buffer);
            const args = outExt === '.webm'
                ? ['-y', '-i', src, '-c:v', 'libvpx-vp9', '-crf', String(Math.min(50, crf + 8)), '-b:v', '0', '-c:a', 'libopus', dst]
                : [
                    '-y', '-i', src,
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
                    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                    '-c:a', 'aac', '-b:a', '96k',
                    dst,
                ];
            await run(ffmpegPath, args, { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
            const outBuf = await fs_1.promises.readFile(dst);
            if (!outBuf.length)
                return keep('ffmpeg 输出为空');
            if (outBuf.length >= buffer.length)
                return keep(`压缩后体积未减小（${buffer.length}B → ${outBuf.length}B），保留原文件`);
            return {
                buffer: outBuf,
                mime: outExt === '.webm' ? 'video/webm' : 'video/mp4',
                ext: outExt,
                compressed: true,
            };
        });
    }
    catch (err) {
        return keep(`ffmpeg 转码失败：${err.message}`);
    }
}
async function compressAudio(buffer, ext, percent) {
    const keep = (reason) => ({ buffer, mime: '', ext: '', compressed: false, reason });
    if (!ffmpegAvailable())
        return keep('未安装 ffmpeg，音频跳过压缩');
    if (!AUDIO_OK.has(ext))
        return keep(`${ext} 不是可压缩的音频格式`);
    const p = clampQuality(percent);
    const outExt = ext === 'mp3' ? '.mp3' : '.m4a';
    try {
        return await withTempFiles([`.${ext}`, outExt], async ([src, dst]) => {
            await fs_1.promises.writeFile(src, buffer);
            const sourceKbps = await probeAudioBitrateFile(src);
            if (sourceKbps && sourceKbps <= 64)
                return keep(`源码率仅 ${sourceKbps}k，再压缩收益过低，保留原文件`);
            const bitrate = sourceKbps
                ? Math.min(320, Math.max(48, Math.round((sourceKbps * p) / 100)))
                : Math.round(Math.min(320, Math.max(48, p * 2)));
            const args = outExt === '.mp3'
                ? ['-y', '-i', src, '-vn', '-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, dst]
                : ['-y', '-i', src, '-vn', '-c:a', 'aac', '-b:a', `${bitrate}k`, '-movflags', '+faststart', dst];
            await run(ffmpegPath, args, { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
            const outBuf = await fs_1.promises.readFile(dst);
            if (!outBuf.length)
                return keep('ffmpeg 输出为空');
            if (outBuf.length >= buffer.length)
                return keep(`压缩后体积未减小（${buffer.length}B → ${outBuf.length}B），保留原文件`);
            return {
                buffer: outBuf,
                mime: outExt === '.mp3' ? 'audio/mpeg' : 'audio/mp4',
                ext: outExt,
                compressed: true,
            };
        });
    }
    catch (err) {
        return keep(`ffmpeg 转码失败：${err.message}`);
    }
}
async function compressMedia(buffer, mime, ext, percent, opts) {
    const e = String(ext || '').toLowerCase().replace(/^\./, '');
    try {
        if ((mime || '').startsWith('image/'))
            return await compressImage(buffer, e, percent);
        if ((mime || '').startsWith('video/'))
            return await processVideoBuffer(buffer, e, percent, opts);
        if ((mime || '').startsWith('audio/'))
            return await compressAudio(buffer, e, percent);
        return { buffer, mime: '', ext: '', compressed: false, reason: `${mime || e} 不支持压缩` };
    }
    catch (err) {
        return { buffer, mime: '', ext: '', compressed: false, reason: `压缩异常：${err.message}` };
    }
}
async function readDimensions(buffer, mime, ext) {
    try {
        const e = String(ext || '').toLowerCase().replace(/^\./, '');
        const readable = ((mime || '').startsWith('image/') && !SKIP.has(e)) || e === 'svg';
        if (readable) {
            const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
            const meta = await sharp(buffer, { limitInputPixels: 100_000_000 }).metadata();
            if (meta.width && meta.height)
                return { width: meta.width, height: meta.height };
        }
    }
    catch {
    }
    return {};
}
async function compressFile(srcPath, mime, ext, percent, opts) {
    const e = String(ext || '').toLowerCase().replace(/^\./, '');
    let original = 0;
    try {
        original = (await fs_1.promises.stat(srcPath)).size;
    }
    catch {
        original = 0;
    }
    const keep = (reason) => ({
        path: srcPath,
        size: original,
        mime: '',
        ext: '',
        compressed: false,
        reason,
    });
    if (!original)
        return keep('无法读取文件大小');
    if (SKIP.has(e))
        return keep(`${e} 格式按规则不压缩`);
    try {
        if ((mime || '').startsWith('image/'))
            return await compressImageFile(srcPath, e, percent, original);
        if ((mime || '').startsWith('video/'))
            return await processVideoFile(srcPath, e, percent, original, opts);
        if ((mime || '').startsWith('audio/'))
            return await compressAudioFile(srcPath, e, percent, original);
        return keep(`${mime || e} 不支持压缩`);
    }
    catch (err) {
        return keep(`压缩异常：${err.message}`);
    }
}
async function compressImageFile(srcPath, e, percent, original) {
    const keep = (reason) => ({
        path: srcPath,
        size: original,
        mime: '',
        ext: '',
        compressed: false,
        reason,
    });
    if (!IMAGE_OK.has(e))
        return keep(`${e} 不是可压缩的图片格式`);
    const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
    sharp.cache({ memory: 32 });
    sharp.concurrency(2);
    const quality = clampQuality(percent);
    const target = Math.max(1024, Math.round(original * Math.max(0.1, quality / 100)));
    if (e === 'png') {
        const out = `${srcPath}.cmp.png`;
        await sharp(srcPath, { limitInputPixels: 40_000_000 })
            .rotate()
            .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
            .toFile(out);
        const st = await fs_1.promises.stat(out);
        if (st.size < original) {
            return { path: out, size: st.size, mime: 'image/png', ext: '.png', compressed: true };
        }
        await fs_1.promises.rm(out, { force: true }).catch(() => undefined);
        return keep('png 重编码后没有变小（保持透明优先）');
    }
    const out = `${srcPath}.cmp.webp`;
    let q = quality;
    let lastSize = 0;
    for (let i = 0; i < 4; i++) {
        await sharp(srcPath, { limitInputPixels: 40_000_000 }).rotate().webp({ quality: q }).toFile(out);
        lastSize = (await fs_1.promises.stat(out)).size;
        if (lastSize <= target || q <= 20)
            break;
        q = Math.max(20, Math.round(q * Math.sqrt(target / Math.max(1, lastSize))));
    }
    if (lastSize && lastSize < original) {
        return { path: out, size: lastSize, mime: 'image/webp', ext: '.webp', compressed: true };
    }
    await fs_1.promises.rm(out, { force: true }).catch(() => undefined);
    return keep('压缩后体积未减小');
}
async function compressVideoFile(srcPath, e, percent, original, maxSeconds = 30 * 60) {
    const keep = (reason) => ({
        path: srcPath,
        size: original,
        mime: '',
        ext: '',
        compressed: false,
        reason,
    });
    if (!ffmpegAvailable())
        return keep('未安装 ffmpeg，视频跳过压缩');
    if (!VIDEO_OK.has(e))
        return keep(`${e} 不是可压缩的视频格式`);
    const p = clampQuality(percent);
    const crf = Math.min(40, Math.max(20, Math.round(38 - p * 0.14)));
    const outExt = e === 'webm' ? '.webm' : '.mp4';
    const out = `${srcPath}.cmp${outExt}`;
    const args = outExt === '.webm'
        ? ['-y', '-i', srcPath, '-c:v', 'libvpx-vp9', '-crf', String(Math.min(50, crf + 8)), '-b:v', '0', '-c:a', 'libopus', out]
        : [
            '-y', '-i', srcPath,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
            '-c:a', 'aac', '-b:a', '96k',
            out,
        ];
    await run(ffmpegPath, args, { timeout: Math.max(5, maxSeconds) * 1000, maxBuffer: 16 * 1024 * 1024 });
    const st = await fs_1.promises.stat(out);
    if (st.size >= original) {
        await fs_1.promises.rm(out, { force: true }).catch(() => undefined);
        return keep(`压缩后体积未减小（${original}B → ${st.size}B），保留原文件`);
    }
    return {
        path: out,
        size: st.size,
        mime: outExt === '.webm' ? 'video/webm' : 'video/mp4',
        ext: outExt,
        compressed: true,
    };
}
async function compressAudioFile(srcPath, e, percent, original, maxSeconds = 30 * 60) {
    const keep = (reason) => ({
        path: srcPath,
        size: original,
        mime: '',
        ext: '',
        compressed: false,
        reason,
    });
    if (!ffmpegAvailable())
        return keep('未安装 ffmpeg，音频跳过压缩');
    if (!AUDIO_OK.has(e))
        return keep(`${e} 不是可压缩的音频格式`);
    const p = clampQuality(percent);
    const sourceKbps = await probeAudioBitrateFile(srcPath);
    if (sourceKbps && sourceKbps <= 64) {
        return keep(`源码率仅 ${sourceKbps}k，再压缩收益过低，保留原文件`);
    }
    const targetKbps = sourceKbps
        ? Math.min(320, Math.max(48, Math.round((sourceKbps * p) / 100)))
        : Math.round(Math.min(320, Math.max(48, p * 2)));
    const bitrate = targetKbps;
    const outExt = e === 'mp3' ? '.mp3' : '.m4a';
    const out = `${srcPath}.cmp${outExt}`;
    const args = outExt === '.mp3'
        ? ['-y', '-i', srcPath, '-vn', '-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, out]
        : ['-y', '-i', srcPath, '-vn', '-c:a', 'aac', '-b:a', `${bitrate}k`, '-movflags', '+faststart', out];
    await run(ffmpegPath, args, { timeout: Math.max(5, maxSeconds) * 1000, maxBuffer: 16 * 1024 * 1024 });
    const st = await fs_1.promises.stat(out);
    if (st.size >= original) {
        await fs_1.promises.rm(out, { force: true }).catch(() => undefined);
        return keep(`压缩后体积未减小（${original}B → ${st.size}B），保留原文件`);
    }
    return {
        path: out,
        size: st.size,
        mime: outExt === '.mp3' ? 'audio/mpeg' : 'audio/mp4',
        ext: outExt,
        compressed: true,
    };
}
exports.VIDEO_CODEC_INCOMPATIBLE = new Set([
    'hvc1', 'hev1',
    'dvh1', 'dva1',
    'vvc1',
    'mp4v',
    'ap4h', 'apcn', 'apch', 'apcs', 'apco',
]);
function parseMp4Boxes(buf, start, end) {
    const out = [];
    let p = start;
    while (p + 8 <= end) {
        let size = buf.readUInt32BE(p);
        const type = buf.toString('latin1', p + 4, p + 8);
        let header = 8;
        if (size === 1) {
            if (p + 16 > end)
                break;
            const hi = buf.readUInt32BE(p + 8);
            const lo = buf.readUInt32BE(p + 12);
            size = hi * 4294967296 + lo;
            header = 16;
        }
        else if (size === 0) {
            size = end - p;
        }
        if (size < header)
            break;
        out.push({ type, start: p + header, size: Math.min(size - header, end - p - header) });
        p += size;
    }
    return out;
}
function collectStsdFourccs(buf, range) {
    const found = [];
    const walk = (start, end) => {
        for (const box of parseMp4Boxes(buf, start, end)) {
            const bs = box.start;
            const be = box.start + box.size;
            if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(box.type)) {
                walk(bs, be);
            }
            else if (box.type === 'stsd') {
                let p = bs + 8;
                while (p + 8 <= be) {
                    const size = buf.readUInt32BE(p);
                    if (size < 8)
                        break;
                    found.push(buf.toString('latin1', p + 4, p + 8).trim());
                    p += size;
                }
            }
        }
    };
    walk(range.start, range.start + range.size);
    return found;
}
async function probeVideoCodecFile(srcPath) {
    let fh = null;
    try {
        fh = await fs_1.promises.open(srcPath, 'r');
        const stat = await fh.stat();
        let offset = 0;
        for (let guard = 0; guard < 64 && offset + 8 <= stat.size; guard++) {
            const head = Buffer.alloc(16);
            const { bytesRead } = await fh.read(head, 0, 16, offset);
            if (bytesRead < 8)
                return '';
            let size = head.readUInt32BE(0);
            const type = head.toString('latin1', 4, 8);
            let header = 8;
            if (size === 1) {
                if (bytesRead < 16)
                    return '';
                size = head.readUInt32BE(8) * 4294967296 + head.readUInt32BE(12);
                header = 16;
            }
            else if (size === 0) {
                size = stat.size - offset;
            }
            if (size < header)
                return '';
            if (type === 'moov') {
                const cap = Math.min(size, 64 * 1024 * 1024);
                const moov = Buffer.alloc(cap);
                await fh.read(moov, 0, cap, offset + header);
                const fourccs = collectStsdFourccs(moov, { start: 0, size: cap });
                return fourccs.find((c) => exports.VIDEO_CODEC_INCOMPATIBLE.has(c)) || fourccs.find((c) => ['avc1', 'av01', 'vp09'].includes(c)) || '';
            }
            offset += size;
        }
        return '';
    }
    catch {
        return '';
    }
    finally {
        await fh?.close().catch(() => undefined);
    }
}
function probeVideoCodecBuffer(buf) {
    try {
        if (buf.length < 16 || buf.toString('latin1', 4, 8) !== 'ftyp')
            return '';
        for (const box of parseMp4Boxes(buf, 0, buf.length)) {
            if (box.type === 'moov') {
                const fourccs = collectStsdFourccs(buf, box);
                return fourccs.find((c) => exports.VIDEO_CODEC_INCOMPATIBLE.has(c)) || fourccs.find((c) => ['avc1', 'av01', 'vp09'].includes(c)) || '';
            }
        }
        return '';
    }
    catch {
        return '';
    }
}
async function transcodeVideoFile(srcPath, original, maxSeconds = 60 * 60) {
    const keep = (reason) => ({ path: srcPath, size: original, mime: '', ext: '', compressed: false, reason });
    const out = `${srcPath}.h264.mp4`;
    try {
        await run(ffmpegPath, ['-y', '-i', srcPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', out], { timeout: Math.max(5, maxSeconds) * 1000, maxBuffer: 16 * 1024 * 1024 });
        const st = await fs_1.promises.stat(out);
        if (!st.size) {
            await fs_1.promises.rm(out, { force: true }).catch(() => undefined);
            return keep('兼容转码输出为空');
        }
        if (st.size >= original) {
            console.warn(`[compress] 兼容转码后体积变大（${original}B → ${st.size}B），为保证浏览器可播放仍使用转码结果`);
        }
        return { path: out, size: st.size, mime: 'video/mp4', ext: '.mp4', compressed: true };
    }
    catch (err) {
        await fs_1.promises.rm(out, { force: true }).catch(() => undefined);
        return keep(`兼容转码失败：${err.message}`);
    }
}
async function processVideoFile(srcPath, e, percent, original, opts) {
    const keep = (reason) => ({ path: srcPath, size: original, mime: '', ext: '', compressed: false, reason });
    if (opts?.videoTranscode && ['mp4', 'mov', 'm4v'].includes(e)) {
        const codec = await probeVideoCodecFile(srcPath);
        if (exports.VIDEO_CODEC_INCOMPATIBLE.has(codec)) {
            console.log(`[compress] 检测到浏览器不兼容编码 ${codec}，开始兼容转码 → H.264`);
            return transcodeVideoFile(srcPath, original);
        }
        if (codec)
            console.log(`[compress] 视频编码 ${codec} 浏览器可播，无需转码`);
    }
    if (opts?.videoCompress === false)
        return keep('视频编码兼容，且未开启视频压缩');
    return compressVideoFile(srcPath, e, percent, original);
}
async function processVideoBuffer(buffer, e, percent, opts) {
    const keep = (reason) => ({ buffer, mime: '', ext: '', compressed: false, reason });
    if (opts?.videoTranscode && ['mp4', 'mov', 'm4v'].includes(e)) {
        const codec = probeVideoCodecBuffer(buffer);
        if (exports.VIDEO_CODEC_INCOMPATIBLE.has(codec)) {
            if (!ffmpegAvailable())
                return keep('未安装 ffmpeg，HEVC 视频跳过兼容转码');
            const outExt = '.mp4';
            try {
                return await withTempFiles([`.${e}`, outExt], async ([src, dst]) => {
                    await fs_1.promises.writeFile(src, buffer);
                    await run(ffmpegPath, ['-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', dst], { timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
                    const outBuf = await fs_1.promises.readFile(dst);
                    if (!outBuf.length)
                        return keep('兼容转码输出为空');
                    return { buffer: outBuf, mime: 'video/mp4', ext: outExt, compressed: true };
                });
            }
            catch (err) {
                return keep(`兼容转码失败：${err.message}`);
            }
        }
    }
    if (opts?.videoCompress === false)
        return keep('视频编码兼容，且未开启视频压缩');
    return compressVideo(buffer, e, percent);
}
async function readDimensionsFile(path, mime, ext) {
    const e = String(ext || '').toLowerCase().replace(/^\./, '');
    try {
        const readable = ((mime || '').startsWith('image/') && !SKIP.has(e)) || e === 'svg';
        if (readable) {
            const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
            const meta = await sharp(path, { limitInputPixels: 100_000_000 }).metadata();
            if (meta.width && meta.height)
                return { width: meta.width, height: meta.height };
        }
    }
    catch {
    }
    try {
        if ((mime || '').startsWith('video/') || VIDEO_OK.has(e)) {
            const d = await probeVideoSizeFile(path);
            if (d.width && d.height)
                return d;
        }
    }
    catch {
    }
    return {};
}
