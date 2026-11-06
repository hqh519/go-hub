"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEDIA_MAX_SECONDS = void 0;
exports.cpuCores = cpuCores;
exports.estimateFfmpegSeconds = estimateFfmpegSeconds;
exports.mediaResourceGuard = mediaResourceGuard;
exports.postProcessMediaFile = postProcessMediaFile;
exports.mediaQueueStats = mediaQueueStats;
exports.enqueueMediaJob = enqueueMediaJob;
const os_1 = require("os");
const fs_1 = require("fs");
const compress_1 = require("../common/compress");
exports.MEDIA_MAX_SECONDS = compress_1.MEDIA_POST_MAX_SECONDS;
function cpuCores() {
    const n = (0, os_1.cpus)().length;
    return Number.isFinite(n) && n > 0 ? n : 1;
}
function estimateFfmpegSeconds(input) {
    const size = Math.max(0, Number(input.sizeBytes) || 0);
    const dur = Math.max(0, Number(input.durationSec) || 0);
    const factor = Math.max(1, cpuCores() / 4);
    if (input.kind === 'audio') {
        return Math.max(dur * 0.05, size / (6 * 1024 * 1024)) / factor;
    }
    return Math.max(dur * (3 / factor), size / (1.2 * 1024 * 1024) / factor);
}
function mediaResourceGuard(opts) {
    const cores = cpuCores();
    if (cores < 2)
        return { ok: false, reason: `CPU 核心数过少（${cores} 核），跳过重编码以保证上传与网页响应` };
    const loadFactor = Number(opts?.loadFactor);
    const lf = Number.isFinite(loadFactor) && loadFactor >= 0 ? loadFactor : 1.5;
    const load1 = (0, os_1.loadavg)()[0] || 0;
    if (lf > 0 && load1 > cores * lf) {
        return {
            ok: false,
            reason: `系统负载过高（load1=${load1.toFixed(2)} > ${lf} × ${cores} 核 = ${(cores * lf).toFixed(1)}），跳过重编码`,
        };
    }
    const freeMB = Math.round((0, os_1.freemem)() / 1024 / 1024);
    const ramLimit = Number(opts?.ramFreeMB);
    const rm = Number.isFinite(ramLimit) && ramLimit >= 0 ? ramLimit : 256;
    if (rm > 0 && freeMB < rm)
        return { ok: false, reason: `可用内存不足（${freeMB}MB < ${rm}MB），跳过重编码` };
    return { ok: true };
}
async function postProcessMediaFile(srcPath, mime, ext, opts) {
    const e = String(ext || '').toLowerCase().replace(/^\./, '');
    const startedAt = Date.now();
    let original = 0;
    try {
        original = (await fs_1.promises.stat(srcPath)).size;
    }
    catch {
        original = 0;
    }
    const skip = (reason) => ({
        path: srcPath,
        size: original,
        mime: '',
        ext: '',
        compressed: false,
        reason,
        stage: 'none',
        skipReason: reason,
        elapsedMs: Date.now() - startedAt,
    });
    const isVideo = (mime || '').startsWith('video/');
    const isAudio = (mime || '').startsWith('audio/');
    if (!isVideo && !isAudio)
        return skip('非视频/音频，不进入后置处理');
    if (!original)
        return skip('无法读取文件大小');
    if (!(0, compress_1.ffmpegAvailable)())
        return skip('未安装 ffmpeg，跳过压缩与转码');
    const rawCompressMax = Number(opts.compressMaxSeconds);
    const rawTranscodeMax = Number(opts.transcodeMaxSeconds);
    const compressUnlimited = rawCompressMax === 0;
    const transcodeUnlimited = rawTranscodeMax === 0;
    const compressMax = Math.max(30, Number.isFinite(rawCompressMax) && rawCompressMax > 0 ? rawCompressMax : exports.MEDIA_MAX_SECONDS);
    const transcodeMax = Math.max(30, Number.isFinite(rawTranscodeMax) && rawTranscodeMax > 0 ? rawTranscodeMax : exports.MEDIA_MAX_SECONDS);
    const guard = opts.guard?.enabled === false ? { ok: true } : mediaResourceGuard(opts.guard);
    if (!guard.ok)
        return skip(guard.reason || '系统资源不足，跳过压缩与转码');
    const kind = isVideo ? 'video' : 'audio';
    const durationSec = isVideo ? await (0, compress_1.probeMediaDurationFile)(srcPath) : 0;
    let cur = { path: srcPath, size: original, mime: '', ext: '', compressed: false };
    let stage = 'none';
    let skipReason = '';
    let estimated = 0;
    if (opts.compress) {
        estimated = estimateFfmpegSeconds({ sizeBytes: original, durationSec, kind });
        if (!compressUnlimited && estimated > compressMax) {
            skipReason = `预计耗时约 ${Math.round(estimated)} 秒，超过 ${compressMax} 秒上限，放弃压缩`;
        }
        else {
            const r = isVideo
                ? await (0, compress_1.compressVideoFile)(srcPath, e, opts.percent, original, compressUnlimited ? exports.MEDIA_MAX_SECONDS : compressMax)
                : await (0, compress_1.compressAudioFile)(srcPath, e, opts.percent, original, compressUnlimited ? exports.MEDIA_MAX_SECONDS : compressMax);
            if (r.compressed) {
                cur = r;
                stage = 'compress';
            }
            else {
                skipReason = r.reason || '压缩未生效';
            }
        }
    }
    else {
        skipReason = '压缩开关未开启';
    }
    let codec = '';
    if (isVideo) {
        codec = await (0, compress_1.probeVideoCodecFile)(cur.path);
        const incompatible = compress_1.VIDEO_CODEC_INCOMPATIBLE.has(codec);
        if (stage === 'compress') {
        }
        else if (!opts.transcode) {
        }
        else if (!incompatible) {
            if (codec)
                skipReason = `${skipReason ? skipReason + '；' : ''}视频编码 ${codec} 浏览器可播，无需转码`;
        }
        else {
            const est = estimateFfmpegSeconds({ sizeBytes: cur.size, durationSec, kind: 'video' });
            if (!transcodeUnlimited && est > transcodeMax) {
                skipReason = `${skipReason ? skipReason + '；' : ''}兼容转码预计耗时约 ${Math.round(est)} 秒，超过 ${transcodeMax} 秒上限，放弃转码`;
            }
            else {
                estimated = Math.max(estimated, est);
                const r = await (0, compress_1.transcodeVideoFile)(cur.path, cur.size, transcodeUnlimited ? exports.MEDIA_MAX_SECONDS : transcodeMax);
                if (r.compressed) {
                    cur = r;
                    stage = 'transcode';
                }
                else {
                    skipReason = `${skipReason ? skipReason + '；' : ''}${r.reason || '兼容转码未生效'}`;
                }
            }
        }
    }
    return {
        ...cur,
        stage,
        codec: codec || undefined,
        skipReason: skipReason || undefined,
        estimatedSeconds: estimated ? Math.round(estimated) : undefined,
        elapsedMs: Date.now() - startedAt,
    };
}
const lanes = {
    compress: { limit: 1, running: 0, current: [], queue: [] },
    transcode: { limit: 1, running: 0, current: [], queue: [] },
};
function effectiveLimit(limit) {
    const n = Number(limit);
    if (!Number.isFinite(n))
        return 1;
    if (n <= 0)
        return 64;
    return Math.min(64, Math.max(1, Math.floor(n)));
}
function pumpLane(lane) {
    const st = lanes[lane];
    while (st.queue.length && st.running < st.limit) {
        const job = st.queue.shift();
        st.running += 1;
        st.current.push(job.label);
        void (async () => {
            try {
                await job.run();
            }
            catch (err) {
                console.warn('[media-post] 任务异常:', job.label, err?.message || err);
            }
            finally {
                st.running = Math.max(0, st.running - 1);
                const idx = st.current.indexOf(job.label);
                if (idx !== -1)
                    st.current.splice(idx, 1);
                pumpLane(lane);
            }
        })();
    }
}
function mediaQueueStats() {
    const c = lanes.compress;
    const t = lanes.transcode;
    const current = [...c.current, ...t.current].join('、');
    return {
        running: c.running + t.running,
        current,
        pending: c.queue.length + t.queue.length,
        compress: { running: c.running, pending: c.queue.length, limit: c.limit },
        transcode: { running: t.running, pending: t.queue.length, limit: t.limit },
    };
}
function enqueueMediaJob(label, run, lane = 'compress', limit = 1) {
    const st = lanes[lane];
    st.limit = effectiveLimit(limit);
    st.queue.push({ label, run });
    pumpLane(lane);
}
