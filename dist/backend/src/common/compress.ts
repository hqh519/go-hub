/**
 * 媒体压缩（v2.3.0 统一入口）。
 *
 * 和 v1.x 的「只压图片」相比，这里明确了几条规则：
 *   1) **图片**：jpg/png/webp/avif 走 sharp。
 *        · png 必须保持透明 —— 用 `png({compressionLevel:9})` 重编码（不转调色板、不转 webp），
 *          压完不比原图小就放弃，改用原图（需求：无法保透明就不压）。
 *        · gif 直接跳过（sharp 会丢帧，动图压完就废了）。
 *        · svg / heic / tiff 等不支持的一律跳过。
 *   2) **视频 / 音频**：走 ffmpeg（H.264 / AAC / MP3）。ffmpeg 是可选依赖 ——
 *      没装就自动跳过并记一行日志，绝不因为「压不了」把上传搞失败。
 *   3) **任何一步失败 → 返回原文件**（compressed=false + reason），调用方直接上传原图。
 */
import { execFile, execFileSync } from 'child_process';
import { promises as fsp } from 'fs';
import { cpus, freemem, loadavg, tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { promisify } from 'util';

const run = promisify(execFile);

export interface CompressResult {
  buffer: Buffer;
  mime: string;
  ext: string;
  /** 是否真的压小了并替换了内容 */
  compressed: boolean;
  /** 未压缩时的原因（写日志用） */
  reason?: string;
}

/** 图片类可压缩的格式 */
const IMAGE_OK = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif']);
/** 视频类可压缩的格式 */
const VIDEO_OK = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']);
/** 音频类可压缩的格式 */
const AUDIO_OK = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus']);
/** 明确跳过的（会丢帧 / 丢透明 / 矢量 / 需要专业编码器） */
const SKIP = new Set(['gif', 'svg', 'heic', 'heif', 'tiff', 'tif', 'bmp', 'ico', 'apng', 'psd']);

/**
 * 单个 ffmpeg 步骤的时间上限（秒）—— v2.8.8 起用于「后置压缩 / 转码」。
 * 默认 300 秒（5 分钟）：预计超过直接放弃，执行超时由 execFile 杀掉进程。
 */
export const MEDIA_POST_MAX_SECONDS = Math.max(30, Number(process.env.MEDIA_POST_MAX_SECONDS || 300));

/* ---------------- ffmpeg 探测 ---------------- */

let ffmpegChecked = false;
let ffmpegPath = '';

/**
 * ffmpeg 二进制定位顺序：
 *   1) 环境变量 FFMPEG_PATH（显式指定，优先级最高）
 *   2) ffmpeg-static 依赖自带的静态二进制（v2.8.4 起随 npm 依赖分发，镜像内开箱即用）
 *   3) PATH 里的 ffmpeg（系统安装）
 */
function resolveFfmpegStatic(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static') as string;
    return p || '';
  } catch {
    return '';
  }
}

/** ffmpeg 是否可用（结果进程内缓存；可用 FFMPEG_PATH 指定绝对路径） */
export function ffmpegAvailable(): boolean {
  if (ffmpegChecked) return !!ffmpegPath;
  ffmpegChecked = true;
  const envPath = String(process.env.FFMPEG_PATH || '').trim();
  const staticPath = resolveFfmpegStatic();
  for (const bin of [envPath, staticPath, 'ffmpeg'].filter(Boolean)) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore', timeout: 5000 });
      ffmpegPath = bin;
      console.log(`[compress] ffmpeg 可用：${bin === staticPath ? 'ffmpeg-static 内置二进制' : bin}（视频 / 音频压缩与转码已启用）`);
      return true;
    } catch {
      /* 试下一个 */
    }
  }
  ffmpegPath = '';
  console.log('[compress] 未检测到 ffmpeg：视频 / 音频将跳过压缩与转码（图片压缩不受影响）');
  return false;
}

/**
 * 解析视频/音频时长（秒）。
 * 用 `ffmpeg -i` 的 stderr 读 Duration，不解码、几百毫秒返回；失败返回 0。
 * v2.8.8：后置处理用它估算「这次重编码大概要多久」。
 */
export async function probeMediaDurationFile(srcPath: string): Promise<number> {
  if (!ffmpegAvailable()) return 0;
  try {
    await run(ffmpegPath, ['-hide_banner', '-i', srcPath], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    return 0;
  } catch (err) {
    // 没有输出目标时 ffmpeg 以退出码 1 结束，但 stderr 里带完整元信息
    const stderr = String((err as { stderr?: string }).stderr || '');
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
}

/**
 * 音频码率探测（v3.0.0 R7）：`ffmpeg -i` 的 stderr 里带 `Audio: mp3 ..., 128 kb/s`
 * 或 `Audio: pcm_s16le ..., 1411 kb/s`。失败返回 0（调用方退回按百分比估算）。
 *
 * 为什么需要它：原先音频压缩固定用「压缩百分比 × 2」当目标码率（80% → 160k），
 * 于是 128k 的 mp3 会被「压」成 160k —— 产物更大被丢弃，用户看到的就是
 * 「上传音频时压缩根本没触发」。现在按源码率的百分比算目标码率，才真的会变小。
 */
export async function probeAudioBitrateFile(srcPath: string): Promise<number> {
  if (!ffmpegAvailable()) return 0;
  try {
    await run(ffmpegPath, ['-hide_banner', '-i', srcPath], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    return 0;
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr || '');
    const audioLine = stderr.split(/\r?\n/).find((l) => l.includes('Audio:'));
    if (!audioLine) return 0;
    const m = audioLine.match(/(\d{2,6})\s*kb\/s/);
    return m ? Number(m[1]) : 0;
  }
}

/**
 * 视频尺寸探测（v2.8.9）：`ffmpeg -i` 的 stderr 里带着
 * `Video: h264 ..., 1920x1080 [SAR 1:1 DAR 16:9], ...`，不解码、几百毫秒返回。
 * 没有 ffmpeg 或解析不到时返回空对象（详情页留空，不影响上传）。
 */
export async function probeVideoSizeFile(srcPath: string): Promise<{ width?: number; height?: number }> {
  if (!ffmpegAvailable()) return {};
  try {
    await run(ffmpegPath, ['-hide_banner', '-i', srcPath], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    return {};
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr || '');
    const m = stderr.match(/(\d{2,5})x(\d{2,5})[\s,\[]/);
    if (!m) return {};
    const width = Number(m[1]);
    const height = Number(m[2]);
    if (!width || !height) return {};
    return { width, height };
  }
}

/* ---------------- 图片 ---------------- */
function clampQuality(percent: number): number {
  const p = Number.isFinite(percent) && percent > 0 ? percent : 80;
  return Math.min(100, Math.max(10, p));
}

async function compressImage(buffer: Buffer, ext: string, percent: number): Promise<CompressResult> {
  const keep = (reason: string): CompressResult => ({ buffer, mime: '', ext: '', compressed: false, reason });
  if (SKIP.has(ext)) return keep(`${ext} 格式不支持压缩`);
  if (!IMAGE_OK.has(ext)) return keep(`${ext} 不是可压缩的图片格式`);

  const sharp = (await import('sharp')).default;
  sharp.cache({ memory: 32 });
  sharp.concurrency(2);

  const quality = clampQuality(percent);
  const ratio = Math.max(0.1, quality / 100);
  const target = Math.max(1024, Math.round(buffer.length * ratio));

  // —— PNG：保透明重编码，压不下去就放弃 ——
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

  // —— jpg / webp / avif：转 webp，迭代压到目标体积 ——
  let q = quality;
  let out = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().webp({ quality: q }).toBuffer();
  for (let i = 0; i < 4 && out.length > target && q > 20; i++) {
    q = Math.max(20, Math.round(q * Math.sqrt(target / out.length)));
    out = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().webp({ quality: q }).toBuffer();
  }
  if (out.length >= buffer.length) return keep('压缩后体积未减小');
  return { buffer: out, mime: 'image/webp', ext: '.webp', compressed: true };
}

/* ---------------- 视频 / 音频 ---------------- */

async function withTempFiles<T>(exts: string[], fn: (paths: string[]) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'gohub-cmp-'));
  const paths = exts.map((e) => join(dir, `${randomBytes(6).toString('hex')}${e}`));
  try {
    return await fn(paths);
  } finally {
    // 自底向上删：目录删除在部分环境会被安全策略拦住，忽略失败即可（temp 目录由系统清理）
    for (const p of paths) await fsp.unlink(p).catch(() => undefined);
    await fsp.rmdir(dir).catch(() => undefined);
  }
}

/** 视频压缩：H.264 + AAC，CRF 由「压缩期望百分比」换算 */
async function compressVideo(buffer: Buffer, ext: string, percent: number): Promise<CompressResult> {
  const keep = (reason: string): CompressResult => ({ buffer, mime: '', ext: '', compressed: false, reason });
  if (!ffmpegAvailable()) return keep('未安装 ffmpeg，视频跳过压缩');
  if (!VIDEO_OK.has(ext)) return keep(`${ext} 不是可压缩的视频格式`);

  const p = clampQuality(percent);
  // percent 表示「压到原体积的 p%」：p 越小 CRF 越大（画质越低、体积越小）
  const crf = Math.min(40, Math.max(20, Math.round(38 - p * 0.14)));
  const outExt = ext === 'webm' ? '.webm' : '.mp4';

  try {
    return await withTempFiles([`.${ext}`, outExt], async ([src, dst]) => {
      await fsp.writeFile(src, buffer);
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
      const outBuf = await fsp.readFile(dst);
      if (!outBuf.length) return keep('ffmpeg 输出为空');
      // v2.8.5：只要求「比原文件小」；压完反而更大/一样大就用原文件
      if (outBuf.length >= buffer.length) return keep(`压缩后体积未减小（${buffer.length}B → ${outBuf.length}B），保留原文件`);
      return {
        buffer: outBuf,
        mime: outExt === '.webm' ? 'video/webm' : 'video/mp4',
        ext: outExt,
        compressed: true,
      };
    });
  } catch (err) {
    return keep(`ffmpeg 转码失败：${(err as Error).message}`);
  }
}

/** 音频压缩：mp3 保持 mp3，其它统一转 m4a(AAC) */
async function compressAudio(buffer: Buffer, ext: string, percent: number): Promise<CompressResult> {
  const keep = (reason: string): CompressResult => ({ buffer, mime: '', ext: '', compressed: false, reason });
  if (!ffmpegAvailable()) return keep('未安装 ffmpeg，音频跳过压缩');
  if (!AUDIO_OK.has(ext)) return keep(`${ext} 不是可压缩的音频格式`);

  const p = clampQuality(percent);
  const outExt = ext === 'mp3' ? '.mp3' : '.m4a';

  try {
    return await withTempFiles([`.${ext}`, outExt], async ([src, dst]) => {
      await fsp.writeFile(src, buffer);
      // v3.0.0（R7）：与磁盘版一致 —— 目标码率跟着源码率走，避免「越压越大」
      const sourceKbps = await probeAudioBitrateFile(src);
      if (sourceKbps && sourceKbps <= 64) return keep(`源码率仅 ${sourceKbps}k，再压缩收益过低，保留原文件`);
      const bitrate = sourceKbps
        ? Math.min(320, Math.max(48, Math.round((sourceKbps * p) / 100)))
        : Math.round(Math.min(320, Math.max(48, p * 2)));
      const args = outExt === '.mp3'
        ? ['-y', '-i', src, '-vn', '-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, dst]
        : ['-y', '-i', src, '-vn', '-c:a', 'aac', '-b:a', `${bitrate}k`, '-movflags', '+faststart', dst];
      await run(ffmpegPath, args, { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
      const outBuf = await fsp.readFile(dst);
      if (!outBuf.length) return keep('ffmpeg 输出为空');
      // v2.8.5：只要求「比原文件小」；压完反而更大/一样大就用原文件
      if (outBuf.length >= buffer.length) return keep(`压缩后体积未减小（${buffer.length}B → ${outBuf.length}B），保留原文件`);
      return {
        buffer: outBuf,
        mime: outExt === '.mp3' ? 'audio/mpeg' : 'audio/mp4',
        ext: outExt,
        compressed: true,
      };
    });
  } catch (err) {
    return keep(`ffmpeg 转码失败：${(err as Error).message}`);
  }
}

/* ---------------- 统一入口 ---------------- */

export interface CompressOptions {
  /** v2.8.4：视频兼容转码 —— 遇到 HEVC 等浏览器不支持的编码时自动转 H.264（与压缩开关相互独立） */
  videoTranscode?: boolean;
  /** v2.8.4：是否允许视频压缩重编码。显式传 false 时只做兼容转码、不做压缩（默认 undefined = 允许，兼容旧调用） */
  videoCompress?: boolean;
}

/**
 * 按 MIME / 扩展名分派到对应的压缩器。
 * 永远不抛异常 —— 失败一律返回原 buffer + reason，调用方无需 try/catch。
 */
export async function compressMedia(
  buffer: Buffer,
  mime: string,
  ext: string,
  percent: number,
  opts?: CompressOptions,
): Promise<CompressResult> {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  try {
    if ((mime || '').startsWith('image/')) return await compressImage(buffer, e, percent);
    if ((mime || '').startsWith('video/')) return await processVideoBuffer(buffer, e, percent, opts);
    if ((mime || '').startsWith('audio/')) return await compressAudio(buffer, e, percent);
    return { buffer, mime: '', ext: '', compressed: false, reason: `${mime || e} 不支持压缩` };
  } catch (err) {
    return { buffer, mime: '', ext: '', compressed: false, reason: `压缩异常：${(err as Error).message}` };
  }
}

/** 读取图片/视频尺寸（图片走 sharp，视频走 ffprobe；拿不到返回空对象） */
export async function readDimensions(
  buffer: Buffer,
  mime: string,
  ext: string,
): Promise<{ width?: number; height?: number; duration?: number }> {
  try {
    const e = String(ext || '').toLowerCase().replace(/^\./, '');
    // v2.8.9：svg 也读一次（sharp 读矢量头部，代价很小）；gif 仍然跳过（避免整份解码）
    const readable = ((mime || '').startsWith('image/') && !SKIP.has(e)) || e === 'svg';
    if (readable) {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(buffer, { limitInputPixels: 100_000_000 }).metadata();
      if (meta.width && meta.height) return { width: meta.width, height: meta.height };
    }
  } catch {
    /* 尺寸读不到不影响上传 */
  }
  return {};
}

/* ---------------- v2.8.3：磁盘 → 磁盘（大文件不读内存） ---------------- */

export interface FileCompressResult {
  /** 压缩产物的绝对路径；未压缩时等于入参 srcPath */
  path: string;
  size: number;
  mime: string;
  /** 产物扩展名（含点，如 .webp），未压缩为空 */
  ext: string;
  compressed: boolean;
  reason?: string;
}

/**
 * 大文件压缩：输入/输出都是磁盘路径。
 * · 图片：sharp 直接读文件写文件（png 保透明；jpg/webp/avif 转 webp 并尝试逼近目标体积）
 * · 视频/音频：ffmpeg -i 文件 → 输出文件，避免整份 Buffer
 * 永远不抛异常：失败返回原路径 + reason，调用方照常上传原文件。
 */
export async function compressFile(
  srcPath: string,
  mime: string,
  ext: string,
  percent: number,
  opts?: CompressOptions,
): Promise<FileCompressResult> {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  let original = 0;
  try {
    original = (await fsp.stat(srcPath)).size;
  } catch {
    original = 0;
  }
  const keep = (reason: string): FileCompressResult => ({
    path: srcPath,
    size: original,
    mime: '',
    ext: '',
    compressed: false,
    reason,
  });
  if (!original) return keep('无法读取文件大小');
  if (SKIP.has(e)) return keep(`${e} 格式按规则不压缩`);
  try {
    if ((mime || '').startsWith('image/')) return await compressImageFile(srcPath, e, percent, original);
    if ((mime || '').startsWith('video/')) return await processVideoFile(srcPath, e, percent, original, opts);
    if ((mime || '').startsWith('audio/')) return await compressAudioFile(srcPath, e, percent, original);
    return keep(`${mime || e} 不支持压缩`);
  } catch (err) {
    return keep(`压缩异常：${(err as Error).message}`);
  }
}

async function compressImageFile(srcPath: string, e: string, percent: number, original: number): Promise<FileCompressResult> {
  const keep = (reason: string): FileCompressResult => ({
    path: srcPath,
    size: original,
    mime: '',
    ext: '',
    compressed: false,
    reason,
  });
  if (!IMAGE_OK.has(e)) return keep(`${e} 不是可压缩的图片格式`);
  const sharp = (await import('sharp')).default;
  sharp.cache({ memory: 32 });
  sharp.concurrency(2);
  const quality = clampQuality(percent);
  const target = Math.max(1024, Math.round(original * Math.max(0.1, quality / 100)));

  // PNG：保透明重编码，压不下去就放弃
  if (e === 'png') {
    const out = `${srcPath}.cmp.png`;
    await sharp(srcPath, { limitInputPixels: 40_000_000 })
      .rotate()
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
      .toFile(out);
    const st = await fsp.stat(out);
    if (st.size < original) {
      return { path: out, size: st.size, mime: 'image/png', ext: '.png', compressed: true };
    }
    await fsp.rm(out, { force: true }).catch(() => undefined);
    return keep('png 重编码后没有变小（保持透明优先）');
  }

  const out = `${srcPath}.cmp.webp`;
  let q = quality;
  let lastSize = 0;
  for (let i = 0; i < 4; i++) {
    await sharp(srcPath, { limitInputPixels: 40_000_000 }).rotate().webp({ quality: q }).toFile(out);
    lastSize = (await fsp.stat(out)).size;
    if (lastSize <= target || q <= 20) break;
    q = Math.max(20, Math.round(q * Math.sqrt(target / Math.max(1, lastSize))));
  }
  if (lastSize && lastSize < original) {
    return { path: out, size: lastSize, mime: 'image/webp', ext: '.webp', compressed: true };
  }
  await fsp.rm(out, { force: true }).catch(() => undefined);
  return keep('压缩后体积未减小');
}

export async function compressVideoFile(
  srcPath: string,
  e: string,
  percent: number,
  original: number,
  maxSeconds = 30 * 60,
): Promise<FileCompressResult> {
  const keep = (reason: string): FileCompressResult => ({
    path: srcPath,
    size: original,
    mime: '',
    ext: '',
    compressed: false,
    reason,
  });
  if (!ffmpegAvailable()) return keep('未安装 ffmpeg，视频跳过压缩');
  if (!VIDEO_OK.has(e)) return keep(`${e} 不是可压缩的视频格式`);
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
  const st = await fsp.stat(out);
  // v2.8.5：压缩后必须比原文件小，否则丢弃压缩产物、继续用原文件
  if (st.size >= original) {
    await fsp.rm(out, { force: true }).catch(() => undefined);
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

export async function compressAudioFile(
  srcPath: string,
  e: string,
  percent: number,
  original: number,
  maxSeconds = 30 * 60,
): Promise<FileCompressResult> {
  const keep = (reason: string): FileCompressResult => ({
    path: srcPath,
    size: original,
    mime: '',
    ext: '',
    compressed: false,
    reason,
  });
  if (!ffmpegAvailable()) return keep('未安装 ffmpeg，音频跳过压缩');
  if (!AUDIO_OK.has(e)) return keep(`${e} 不是可压缩的音频格式`);
  const p = clampQuality(percent);
  /*
   * v3.0.0（R7）：目标码率按「源码率 × 压缩百分比」计算。
   *   · 源码率探不到 → 退回旧口径（百分比 × 2，最高 320k）；
   *   · 源码率已很低（≤64k，语音/播客）→ 再压只会更糊且大概率压不下去，直接跳过；
   *   · 无损格式（wav/flac/ape，常见 1000k+）→ 目标被 320k 封顶，通常能省 70% 以上。
   */
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
  const st = await fsp.stat(out);
  // v2.8.5：压缩后必须比原文件小，否则丢弃压缩产物、继续用原文件
  if (st.size >= original) {
    await fsp.rm(out, { force: true }).catch(() => undefined);
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

/* ---------------- v2.8.4：视频编码探测与兼容转码 ---------------- */

/*
 * 背景：华为 / 新款安卓手机默认用 H.265(HEVC) 录像，绝大多数浏览器在 <video> 里
 * 解不了 HEVC 视频轨（音频 AAC 正常）→ 表现为「只有声音、没有画面」。
 * 这里只对**浏览器不兼容的编码**做转码，已是 H.264 / AV1 / VP9 的视频一律放行，
 * 避免「全量转码」带来的 CPU 浪费与时长等待。
 */

/** mp4/mov 容器里浏览器普遍播放不了的视频编码（采样描述 fourcc） */
export const VIDEO_CODEC_INCOMPATIBLE = new Set([
  'hvc1', 'hev1', // H.265 / HEVC（华为、iPhone 高效格式）
  'dvh1', 'dva1', // Dolby Vision（HEVC 底座）
  'vvc1', // H.266 / VVC
  'mp4v', // MPEG-4 Part 2（老设备 / 行车记录仪常见）
  'ap4h', 'apcn', 'apch', 'apcs', 'apco', // Apple ProRes（Final Cut 导出）
]);

interface Mp4Box {
  type: string;
  /** payload 起始偏移（相对传入 buffer） */
  start: number;
  /** payload 长度 */
  size: number;
}

function parseMp4Boxes(buf: Buffer, start: number, end: number): Mp4Box[] {
  const out: Mp4Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let header = 8;
    if (size === 1) {
      if (p + 16 > end) break;
      const hi = buf.readUInt32BE(p + 8);
      const lo = buf.readUInt32BE(p + 12);
      size = hi * 4294967296 + lo;
      header = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < header) break;
    out.push({ type, start: p + header, size: Math.min(size - header, end - p - header) });
    p += size;
  }
  return out;
}

/** 从 moov 里收集所有 stsd 采样描述 fourcc（视频轨 + 音频轨都在里面，靠白名单筛视频编码） */
function collectStsdFourccs(buf: Buffer, range: { start: number; size: number }): string[] {
  const found: string[] = [];
  const walk = (start: number, end: number) => {
    for (const box of parseMp4Boxes(buf, start, end)) {
      const bs = box.start;
      const be = box.start + box.size;
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(box.type)) {
        walk(bs, be);
      } else if (box.type === 'stsd') {
        // stsd payload: 4 字节 version/flags + 4 字节 entryCount + N 个采样描述
        let p = bs + 8;
        while (p + 8 <= be) {
          const size = buf.readUInt32BE(p);
          if (size < 8) break;
          found.push(buf.toString('latin1', p + 4, p + 8).trim());
          p += size;
        }
      }
    }
  };
  walk(range.start, range.start + range.size);
  return found;
}

/** 探测磁盘上 mp4/mov 视频的编码 fourcc；非 mp4 容器（mkv/webm/avi 等）或解析失败返回空串 */
export async function probeVideoCodecFile(srcPath: string): Promise<string> {
  let fh: import('fs/promises').FileHandle | null = null;
  try {
    fh = await fsp.open(srcPath, 'r');
    const stat = await fh.stat();
    // 逐盒扫描顶层 box 定位 moov（moov 可能在头也可能在尾，逐个跳过 mdat）
    let offset = 0;
    for (let guard = 0; guard < 64 && offset + 8 <= stat.size; guard++) {
      const head = Buffer.alloc(16);
      const { bytesRead } = await fh.read(head, 0, 16, offset);
      if (bytesRead < 8) return '';
      let size = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      let header = 8;
      if (size === 1) {
        if (bytesRead < 16) return '';
        size = head.readUInt32BE(8) * 4294967296 + head.readUInt32BE(12);
        header = 16;
      } else if (size === 0) {
        size = stat.size - offset;
      }
      if (size < header) return '';
      if (type === 'moov') {
        const cap = Math.min(size, 64 * 1024 * 1024); // moov 正常只有几 MB，兜个底
        const moov = Buffer.alloc(cap);
        await fh.read(moov, 0, cap, offset + header);
        const fourccs = collectStsdFourccs(moov, { start: 0, size: cap });
        return fourccs.find((c) => VIDEO_CODEC_INCOMPATIBLE.has(c)) || fourccs.find((c) => ['avc1', 'av01', 'vp09'].includes(c)) || '';
      }
      offset += size;
    }
    return '';
  } catch {
    return '';
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

/** Buffer 版探测（小文件内存路径用） */
export function probeVideoCodecBuffer(buf: Buffer): string {
  try {
    if (buf.length < 16 || buf.toString('latin1', 4, 8) !== 'ftyp') return '';
    for (const box of parseMp4Boxes(buf, 0, buf.length)) {
      if (box.type === 'moov') {
        const fourccs = collectStsdFourccs(buf, box);
        return fourccs.find((c) => VIDEO_CODEC_INCOMPATIBLE.has(c)) || fourccs.find((c) => ['avc1', 'av01', 'vp09'].includes(c)) || '';
      }
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * 兼容转码（磁盘 → 磁盘）：把 HEVC / ProRes / MPEG-4 Part 2 等转成 H.264 mp4。
 * 与「压缩」不同：**不要求产物比原文件小** —— 哪怕变大也换，目的就是能在浏览器里播。
 * -movflags +faststart 顺带把 moov 挪到头部，边下边播体验更好。
 */
export async function transcodeVideoFile(srcPath: string, original: number, maxSeconds = 60 * 60): Promise<FileCompressResult> {
  const keep = (reason: string): FileCompressResult => ({ path: srcPath, size: original, mime: '', ext: '', compressed: false, reason });
  const out = `${srcPath}.h264.mp4`;
  try {
    await run(
      ffmpegPath,
      ['-y', '-i', srcPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', out],
      { timeout: Math.max(5, maxSeconds) * 1000, maxBuffer: 16 * 1024 * 1024 },
    );
    const st = await fsp.stat(out);
    if (!st.size) {
      await fsp.rm(out, { force: true }).catch(() => undefined);
      return keep('兼容转码输出为空');
    }
    /*
     * v2.8.5：兼容转码的目的是「让浏览器能播」，与压缩目标不同 ——
     * 即使转码后体积变大也必须保留（否则又回到「只有声音没画面」），
     * 但要在日志里留一条记录，便于解释「为什么这个视频没变小」。
     */
    if (st.size >= original) {
      console.warn(
        `[compress] 兼容转码后体积变大（${original}B → ${st.size}B），为保证浏览器可播放仍使用转码结果`,
      );
    }
    return { path: out, size: st.size, mime: 'video/mp4', ext: '.mp4', compressed: true };
  } catch (err) {
    await fsp.rm(out, { force: true }).catch(() => undefined);
    return keep(`兼容转码失败：${(err as Error).message}`);
  }
}

/** 视频处理统一入口（文件版）：不兼容编码 → 兼容转码；否则按压缩策略走 */
async function processVideoFile(srcPath: string, e: string, percent: number, original: number, opts?: CompressOptions): Promise<FileCompressResult> {
  const keep = (reason: string): FileCompressResult => ({ path: srcPath, size: original, mime: '', ext: '', compressed: false, reason });
  if (opts?.videoTranscode && ['mp4', 'mov', 'm4v'].includes(e)) {
    const codec = await probeVideoCodecFile(srcPath);
    if (VIDEO_CODEC_INCOMPATIBLE.has(codec)) {
      console.log(`[compress] 检测到浏览器不兼容编码 ${codec}，开始兼容转码 → H.264`);
      return transcodeVideoFile(srcPath, original);
    }
    if (codec) console.log(`[compress] 视频编码 ${codec} 浏览器可播，无需转码`);
  }
  if (opts?.videoCompress === false) return keep('视频编码兼容，且未开启视频压缩');
  return compressVideoFile(srcPath, e, percent, original);
}

/** 视频处理统一入口（内存版） */
async function processVideoBuffer(buffer: Buffer, e: string, percent: number, opts?: CompressOptions): Promise<CompressResult> {
  const keep = (reason: string): CompressResult => ({ buffer, mime: '', ext: '', compressed: false, reason });
  if (opts?.videoTranscode && ['mp4', 'mov', 'm4v'].includes(e)) {
    const codec = probeVideoCodecBuffer(buffer);
    if (VIDEO_CODEC_INCOMPATIBLE.has(codec)) {
      if (!ffmpegAvailable()) return keep('未安装 ffmpeg，HEVC 视频跳过兼容转码');
      const outExt = '.mp4';
      try {
        return await withTempFiles([`.${e}`, outExt], async ([src, dst]) => {
          await fsp.writeFile(src, buffer);
          await run(ffmpegPath, ['-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', dst], { timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
          const outBuf = await fsp.readFile(dst);
          if (!outBuf.length) return keep('兼容转码输出为空');
          return { buffer: outBuf, mime: 'video/mp4', ext: outExt, compressed: true };
        });
      } catch (err) {
        return keep(`兼容转码失败：${(err as Error).message}`);
      }
    }
  }
  if (opts?.videoCompress === false) return keep('视频编码兼容，且未开启视频压缩');
  return compressVideo(buffer, e, percent);
}

/** 从磁盘路径读取图片尺寸（大图不整份读内存） */
export async function readDimensionsFile(
  path: string,
  mime: string,
  ext: string,
): Promise<{ width?: number; height?: number; duration?: number }> {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  try {
    const readable = ((mime || '').startsWith('image/') && !SKIP.has(e)) || e === 'svg';
    if (readable) {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(path, { limitInputPixels: 100_000_000 }).metadata();
      if (meta.width && meta.height) return { width: meta.width, height: meta.height };
    }
  } catch {
    /* 尺寸读不到不影响上传 */
  }
  // v2.8.9：视频从容器元信息里读宽高（含手机竖拍视频，读到的就是真实像素尺寸）
  try {
    if ((mime || '').startsWith('video/') || VIDEO_OK.has(e)) {
      const d = await probeVideoSizeFile(path);
      if (d.width && d.height) return d;
    }
  } catch {
    /* 同上 */
  }
  return {};
}
