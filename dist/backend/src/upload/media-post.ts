/**
 * 视频/音频「后置处理」模块（v2.8.8）。
 *
 * 背景：v2.8.7 及以前，视频压缩 / 视频兼容转码挂在分块合并请求里同步执行。
 * 低配服务器（J1900 之类）上传几百 MB 的 HEVC 视频时，ffmpeg 要跑几十分钟：
 *   · 合并请求必然被反向代理（NPM / nginx）超时切断；
 *   · 前端判失败后重试，又撞上「合并中」并发锁（400），表现成「合并后一直失败」；
 *   · 同时 3 路 ffmpeg 把整机打满，连 /api/userConfig 都要 20 秒。
 *
 * 本模块把重活挪到「文件已上传成功之后」，并遵守三条硬规则：
 *   1) 全局单通道 —— 同一时刻只允许 1 路 ffmpeg（进程级串行队列）；
 *   2) 先压缩、后转码 —— 压缩产物已是 H.264，压完不必再转；
 *   3) 随时可以放弃 —— 预计耗时超过上限 / 整机资源不足 / 执行超时，
 *      立刻放弃当前步骤并保留上一步的产物，原文件永远可用。
 */
import { cpus, freemem, loadavg } from 'os';
import { promises as fsp } from 'fs';
import {
  MEDIA_POST_MAX_SECONDS,
  compressAudioFile,
  compressVideoFile,
  ffmpegAvailable,
  probeMediaDurationFile,
  probeVideoCodecFile,
  transcodeVideoFile,
  VIDEO_CODEC_INCOMPATIBLE,
  type FileCompressResult,
} from '../common/compress';

/** 单个 ffmpeg 步骤的时间上限（秒），可用 MEDIA_POST_MAX_SECONDS 覆盖 */
export const MEDIA_MAX_SECONDS = MEDIA_POST_MAX_SECONDS;

/** 当前机器可用核心数（容器内读到的是限额核数） */
export function cpuCores(): number {
  const n = cpus().length;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * 估算一次 ffmpeg 重编码需要多久（秒）。只用于「该不该开始」的决策，宁可估高：
 *   · 视频：按「每 1 秒视频需要 3 秒 / 核心倍率」，再用「单核 1.2MB/s」兜底；
 *   · 音频：重编码几乎不吃 CPU，按体积估。
 */
export function estimateFfmpegSeconds(input: { sizeBytes: number; durationSec?: number; kind: 'video' | 'audio' }): number {
  const size = Math.max(0, Number(input.sizeBytes) || 0);
  const dur = Math.max(0, Number(input.durationSec) || 0);
  const factor = Math.max(1, cpuCores() / 4);
  if (input.kind === 'audio') {
    return Math.max(dur * 0.05, size / (6 * 1024 * 1024)) / factor;
  }
  return Math.max(dur * (3 / factor), size / (1.2 * 1024 * 1024) / factor);
}

/**
 * 资源闸门阈值（v3.0.0 第十三轮：由后台「影音压缩/转码控制」三项配置驱动，缺省沿用历史硬编码值）。
 */
export interface MediaGuardOptions {
  /** load1 负载倍率上限：load1 > 核数 × 该值 → 跳过；0 = 不按负载检测 */
  loadFactor?: number;
  /** 可用内存下限（MB）：低于该值 → 跳过；0 = 不按内存检测 */
  ramFreeMB?: number;
  /** 总开关（由 upload.service 读取后台配置后传入）：false = 完全不做资源检测 */
  enabled?: boolean;
}

/**
 * 整机资源闸门：负载过高 / 可用内存过低时不做重编码 ——
 * 上传与网页响应优先，压缩转码只是「锦上添花」。
 */
export function mediaResourceGuard(opts?: MediaGuardOptions): { ok: boolean; reason?: string } {
  const cores = cpuCores();
  if (cores < 2) return { ok: false, reason: `CPU 核心数过少（${cores} 核），跳过重编码以保证上传与网页响应` };
  const loadFactor = Number(opts?.loadFactor);
  const lf = Number.isFinite(loadFactor) && loadFactor >= 0 ? loadFactor : 1.5;
  const load1 = loadavg()[0] || 0;
  if (lf > 0 && load1 > cores * lf) {
    return {
      ok: false,
      reason: `系统负载过高（load1=${load1.toFixed(2)} > ${lf} × ${cores} 核 = ${(cores * lf).toFixed(1)}），跳过重编码`,
    };
  }
  const freeMB = Math.round(freemem() / 1024 / 1024);
  const ramLimit = Number(opts?.ramFreeMB);
  const rm = Number.isFinite(ramLimit) && ramLimit >= 0 ? ramLimit : 256;
  if (rm > 0 && freeMB < rm) return { ok: false, reason: `可用内存不足（${freeMB}MB < ${rm}MB），跳过重编码` };
  return { ok: true };
}

export interface PostProcessOptions {
  /** 是否允许「压缩」这一步 */
  compress: boolean;
  /** 压缩期望（体积占原文件百分比，10-100） */
  percent: number;
  /** 是否允许「兼容转码」这一步 */
  transcode: boolean;
  /**
   * v2.8.9：压缩 / 转码各有独立的时间上限（后台「压缩文件上限时长」「视频转码上限时长」）。
   * 0 = 不限制（用 MEDIA_MAX_SECONDS 兜底为「实际执行超时保护」）；
   * 缺省 = MEDIA_MAX_SECONDS。
   */
  compressMaxSeconds?: number;
  transcodeMaxSeconds?: number;
  /** v3.0.0 第十三轮：资源闸门阈值（后台「影音压缩/转码控制」三项配置） */
  guard?: MediaGuardOptions;
}

export interface PostProcessResult extends FileCompressResult {
  /** 最终产出来自哪一步：none（保持原文件）/ compress / transcode */
  stage: 'none' | 'compress' | 'transcode';
  /** 放弃/跳过原因（写系统日志用） */
  skipReason?: string;
  /** 探测到的视频编码（日志用） */
  codec?: string;
  /** 实际耗时（毫秒） */
  elapsedMs?: number;
  /** 估算耗时（秒，日志用） */
  estimatedSeconds?: number;
}

/**
 * 视频/音频后置处理：先压缩、再转码（v2.8.8 顺序要求）。
 *
 * 关键点：
 *   · 压缩走 libx264，产物本身就是 H.264 —— 压缩成功时不必再跑一遍全量转码；
 *   · 压缩被放弃（估算超时 / 资源不足 / 压不动）时，若编码浏览器不可播，再尝试兼容转码；
 *   · 任何一步失败都退回上一步的产物，最终退回原文件 —— 本函数永不抛异常。
 */
export async function postProcessMediaFile(
  srcPath: string,
  mime: string,
  ext: string,
  opts: PostProcessOptions,
): Promise<PostProcessResult> {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  const startedAt = Date.now();
  let original = 0;
  try {
    original = (await fsp.stat(srcPath)).size;
  } catch {
    original = 0;
  }
  const skip = (reason: string): PostProcessResult => ({
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
  if (!isVideo && !isAudio) return skip('非视频/音频，不进入后置处理');
  if (!original) return skip('无法读取文件大小');
  if (!ffmpegAvailable()) return skip('未安装 ffmpeg，跳过压缩与转码');

  /*
   * 0 表示「不限制」——但执行时仍需要一个硬超时兜底，否则 ffmpeg 卡死会永久占用队列，
   * 所以 0 时退化成 MEDIA_MAX_SECONDS 的执行保护（只影响执行阶段，不做预估拦截）。
   */
  const rawCompressMax = Number(opts.compressMaxSeconds);
  const rawTranscodeMax = Number(opts.transcodeMaxSeconds);
  const compressUnlimited = rawCompressMax === 0;
  const transcodeUnlimited = rawTranscodeMax === 0;
  const compressMax = Math.max(30, Number.isFinite(rawCompressMax) && rawCompressMax > 0 ? rawCompressMax : MEDIA_MAX_SECONDS);
  const transcodeMax = Math.max(30, Number.isFinite(rawTranscodeMax) && rawTranscodeMax > 0 ? rawTranscodeMax : MEDIA_MAX_SECONDS);
  // v3.0.0 第十三轮：闸门总开关由后台配置控制；关闭时完全不做资源检测
  const guard = opts.guard?.enabled === false ? { ok: true as const } : mediaResourceGuard(opts.guard);
  if (!guard.ok) return skip(guard.reason || '系统资源不足，跳过压缩与转码');

  const kind: 'video' | 'audio' = isVideo ? 'video' : 'audio';
  const durationSec = isVideo ? await probeMediaDurationFile(srcPath) : 0;

  // ---- 第一步：压缩 ----
  let cur: FileCompressResult = { path: srcPath, size: original, mime: '', ext: '', compressed: false };
  let stage: 'none' | 'compress' | 'transcode' = 'none';
  let skipReason = '';
  let estimated = 0;
  if (opts.compress) {
    estimated = estimateFfmpegSeconds({ sizeBytes: original, durationSec, kind });
    if (!compressUnlimited && estimated > compressMax) {
      skipReason = `预计耗时约 ${Math.round(estimated)} 秒，超过 ${compressMax} 秒上限，放弃压缩`;
    } else {
      const r = isVideo
        ? await compressVideoFile(srcPath, e, opts.percent, original, compressUnlimited ? MEDIA_MAX_SECONDS : compressMax)
        : await compressAudioFile(srcPath, e, opts.percent, original, compressUnlimited ? MEDIA_MAX_SECONDS : compressMax);
      if (r.compressed) {
        cur = r;
        stage = 'compress';
      } else {
        skipReason = r.reason || '压缩未生效';
      }
    }
  } else {
    skipReason = '压缩开关未开启';
  }

  // ---- 第二步：兼容转码（仅视频；压缩已成功时产物必然是 H.264，无需再转）----
  let codec = '';
  if (isVideo) {
    codec = await probeVideoCodecFile(cur.path);
    const incompatible = VIDEO_CODEC_INCOMPATIBLE.has(codec);
    if (stage === 'compress') {
      // 压缩产物统一是 libx264 → 浏览器可播，直接收工
    } else if (!opts.transcode) {
      // 兼容转码开关关闭，什么也不做
    } else if (!incompatible) {
      if (codec) skipReason = `${skipReason ? skipReason + '；' : ''}视频编码 ${codec} 浏览器可播，无需转码`;
    } else {
      const est = estimateFfmpegSeconds({ sizeBytes: cur.size, durationSec, kind: 'video' });
      if (!transcodeUnlimited && est > transcodeMax) {
        skipReason = `${skipReason ? skipReason + '；' : ''}兼容转码预计耗时约 ${Math.round(est)} 秒，超过 ${transcodeMax} 秒上限，放弃转码`;
      } else {
        estimated = Math.max(estimated, est);
        const r = await transcodeVideoFile(cur.path, cur.size, transcodeUnlimited ? MEDIA_MAX_SECONDS : transcodeMax);
        if (r.compressed) {
          cur = r;
          stage = 'transcode';
        } else {
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

/* ---------------- 进程级队列（v2.8.9：压缩 / 转码双通道，各自可配并发） ---------------- */

export type MediaLane = 'compress' | 'transcode';

type Job = { label: string; run: () => Promise<void> };

interface LaneState {
  /** 当前并发上限（后台可配；0 = 不限制，这里折算成「足够大」） */
  limit: number;
  running: number;
  current: string[];
  queue: Job[];
}

const lanes: Record<MediaLane, LaneState> = {
  compress: { limit: 1, running: 0, current: [], queue: [] },
  transcode: { limit: 1, running: 0, current: [], queue: [] },
};

function effectiveLimit(limit: number): number {
  const n = Number(limit);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return 64; // 0 = 不限制（给一个安全上限，避免把进程数打爆）
  return Math.min(64, Math.max(1, Math.floor(n)));
}

function pumpLane(lane: MediaLane): void {
  const st = lanes[lane];
  while (st.queue.length && st.running < st.limit) {
    const job = st.queue.shift() as Job;
    st.running += 1;
    st.current.push(job.label);
    void (async () => {
      try {
        await job.run();
      } catch (err) {
        // 单个任务失败绝不影响队列继续跑
        console.warn('[media-post] 任务异常:', job.label, (err as Error)?.message || err);
      } finally {
        st.running = Math.max(0, st.running - 1);
        const idx = st.current.indexOf(job.label);
        if (idx !== -1) st.current.splice(idx, 1);
        pumpLane(lane);
      }
    })();
  }
}

/** 队列状态（系统状态页 / 日志用） */
export function mediaQueueStats(): {
  running: number;
  current: string;
  pending: number;
  compress: { running: number; pending: number; limit: number };
  transcode: { running: number; pending: number; limit: number };
} {
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

/**
 * 投递一个后置处理任务。
 * lane = compress / transcode 两条独立通道，各自按后台配置的并发上限执行（默认各 1 路）。
 */
export function enqueueMediaJob(
  label: string,
  run: () => Promise<void>,
  lane: MediaLane = 'compress',
  limit = 1,
): void {
  const st = lanes[lane];
  st.limit = effectiveLimit(limit);
  st.queue.push({ label, run });
  pumpLane(lane);
}
