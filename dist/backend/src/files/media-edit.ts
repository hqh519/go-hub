/**
 * 文件详情页的「原位媒体编辑」（v1.0.5）。
 *
 * 与上传链路的区别：
 *   · 上传链路是「拿到一件新东西，存进渠道」；
 *   · 这里是「已经签发过外链的文件，改它的字节，但不许动外链」。
 *
 * 由此成立的硬约束：
 *   1. **磁盘路径不变** —— 直接覆盖原文件，remoteKey 不动，副本记录不动；
 *   2. **文件名与扩展名不变** —— 外链是 /file/<name>.<ext>，扩展名一变就等于换了个链接；
 *   3. 只处理**主副本落在本地存储渠道**的文件 —— 第三方渠道没有「直接改字节」的接口，
 *      硬做只能整份重新上传，那已经不是「编辑」而是「转存」了。
 *
 * 每次编辑完成后同步刷新：size / md5 / mime / metas.Width / metas.Height / metas.EditedAt，
 * 并把压缩前的原始大小留在 originalSize（只在第一次压缩时写入）。
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fsp } from 'fs';
import { prisma } from '../common/prisma';
import { appLog } from '../common/app-log';
import { localAbsPathOf } from '../adapters/local.adapter';
import {
  VIDEO_CODEC_INCOMPATIBLE,
  compressAudioFile,
  compressVideoFile,
  ffmpegAvailable,
  probeVideoCodecFile,
  transcodeVideoFile,
} from '../common/compress';

export interface MediaTarget {
  id: string;
  name: string;
  originalName: string;
  ext: string;
  mime: string;
  size: number;
  originalSize: number;
  abs: string;
  metas: Record<string, unknown>;
  /** 之前是否已经被压缩过（实际大小 ≠ 原始大小） */
  compressedBefore: boolean;
}

export interface MediaEditResult {
  ok: boolean;
  message?: string;
  size?: number;
  width?: number;
  height?: number;
  md5?: string;
  mime?: string;
  elapsedMs?: number;
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif']);

/** 从对外标识（File_ID / 内部 id）取扩展名，小写、不含点 */
export function extOf(nameOrFile: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(nameOrFile || ''));
  return m ? m[1].toLowerCase() : '';
}

/**
 * 定位「可原位编辑」的目标文件。
 * 返回 null 表示不允许编辑（不存在 / 不是本地主副本 / 磁盘文件丢失）。
 */
export async function resolveMediaTarget(
  fileKey: string,
  uploader: string,
): Promise<{ target?: MediaTarget; reason?: string }> {
  const rec = await prisma.fileRecord.findFirst({
    where: {
      uploader,
      status: 'active',
      OR: [{ id: fileKey }, { name: fileKey }],
    },
    include: { copies: { include: { channel: true } } },
  });
  if (!rec) return { reason: '文件不存在或无权操作' };

  const active = rec.copies.filter((c) => c.status === 'active');
  const primary =
    active.find((c) => c.isPrimary) ||
    active.find((c) => c.channel?.isMain) ||
    active[0];
  if (!primary || !primary.channel) return { reason: '该文件没有可用的渠道副本' };
  if (primary.channel.type !== 'local') {
    return { reason: '只有在「本地存储」渠道上的文件才支持原位编辑，请先「转本地」' };
  }

  const abs = localAbsPathOf(primary.channel, primary.remoteKey || '');
  if (!abs) return { reason: '无法解析本地文件路径' };
  try {
    await fsp.stat(abs);
  } catch {
    return { reason: '磁盘上的文件已不存在（可能被手工删除）' };
  }

  let metas: Record<string, unknown> = {};
  try {
    metas = JSON.parse(rec.metas || '{}');
  } catch {
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
    },
  };
}

/** 原子替换：先写同目录临时文件再 rename，避免写一半被读到 */
async function writeInPlace(abs: string, data: Buffer | string): Promise<void> {
  const tmp = `${abs}.edit-${Date.now()}.tmp`;
  if (typeof data === 'string') {
    // data 是「已经生成好的临时文件路径」→ 直接移动过去
    await fsp.rename(data, tmp).catch(async () => {
      await fsp.copyFile(data, tmp);
      await fsp.rm(data, { force: true }).catch(() => undefined);
    });
  } else {
    await fsp.writeFile(tmp, data);
  }
  await fsp.rename(tmp, abs);
}

/** 编辑落库：大小 / md5 / mime / 宽高 / 编辑时间 */
async function commitEdit(
  target: MediaTarget,
  opts: {
    size: number;
    mime?: string;
    width?: number;
    height?: number;
    /** 压缩类操作才需要把「压缩前大小」记进 originalSize */
    recordOriginal?: boolean;
    kind: string;
  },
): Promise<{ md5: string }> {
  let md5 = '';
  try {
    // 流式计算：视频动辄几百 MB，readFile 整份读进内存会把进程顶爆
    md5 = await new Promise<string>((resolve, reject) => {
      const hash = createHash('md5');
      createReadStream(target.abs)
        .on('data', (chunk) => hash.update(chunk))
        .on('error', reject)
        .on('end', () => resolve(hash.digest('hex')));
    });
  } catch {
    md5 = '';
  }
  const metas: Record<string, unknown> = { ...target.metas, EditedAt: Date.now() };
  if (opts.width && opts.height) {
    metas.Width = opts.width;
    metas.Height = opts.height;
  } else {
    delete metas.Width;
    delete metas.Height;
  }
  const data: Record<string, unknown> = {
    size: opts.size,
    metas: JSON.stringify(metas),
  };
  if (md5) data.md5 = md5;
  if (opts.mime) data.mime = opts.mime;
  if (opts.recordOriginal && !target.compressedBefore) {
    data.originalSize = target.size;
  } else if (opts.recordOriginal && target.compressedBefore) {
    // 已经压过一次：保留最初的原始大小，不被后续压缩覆盖
    data.originalSize = target.originalSize || target.size;
  }
  await prisma.fileRecord.update({ where: { id: target.id }, data });
  appLog.info(
    'file',
    `原位编辑完成：${target.name}`,
    `${opts.kind} ｜ ${target.size}B → ${opts.size}B ｜ ${opts.mime || target.mime}`,
  );
  return { md5 };
}

/* ==========================================================================
 * 一、裁剪（前端已经裁好并转成 PNG/JPEG 传上来，这里只负责按原格式重新编码）
 * ========================================================================== */

export async function cropImage(
  target: MediaTarget,
  buffer: Buffer,
): Promise<MediaEditResult> {
  const started = Date.now();
  const ext = target.ext;
  if (!IMAGE_EXT.has(ext)) return { ok: false, message: `「${ext || '未知'}」格式不支持裁剪` };
  const sharp = (await import('sharp')).default;
  try {
    const pipeline = sharp(buffer, { limitInputPixels: 60_000_000 });
    const meta = await pipeline.metadata();
    /*
     * 关键：输出必须是**原扩展名的格式**。
     * 外链里带着扩展名，一旦把 jpg 存成 png，浏览器拿到的 Content-Type 与后缀不符，
     * 已经发出去的链接就可能打不开或触发下载。
     */
    let encoded: Buffer;
    if (ext === 'jpg' || ext === 'jpeg') encoded = await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    else if (ext === 'png') encoded = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    else if (ext === 'webp') encoded = await pipeline.webp({ quality: 92 }).toBuffer();
    else encoded = await pipeline.avif({ quality: 60 }).toBuffer();

    if (!encoded.length) return { ok: false, message: '裁剪结果为空' };
    await writeInPlace(target.abs, encoded);
    const { md5 } = await commitEdit(target, {
      size: encoded.length,
      mime: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      width: meta.width,
      height: meta.height,
      kind: '裁剪',
    });
    return { ok: true, size: encoded.length, width: meta.width, height: meta.height, md5, elapsedMs: Date.now() - started };
  } catch (err) {
    return { ok: false, message: `裁剪失败：${(err as Error).message}`, elapsedMs: Date.now() - started };
  }
}

/* ==========================================================================
 * 二、压缩（图片 / 视频 / 音频，按「压缩到原体积的百分之多少」）
 * ========================================================================== */

export async function compressInPlace(
  target: MediaTarget,
  percent: number,
  maxSeconds: number,
): Promise<MediaEditResult> {
  const started = Date.now();
  const deadline = maxSeconds > 0 ? started + maxSeconds * 1000 : 0;
  const p = Math.min(100, Math.max(10, Math.round(percent || 0)));
  const ext = target.ext;
  const mime = target.mime || '';

  const tooLate = () =>
    deadline > 0 && Date.now() > deadline
      ? `执行时间超过「压缩文件上限时长」（${maxSeconds} 秒），已放弃本次压缩`
      : '';

  try {
    if (mime.startsWith('image/')) {
      if (!IMAGE_EXT.has(ext)) return { ok: false, message: `「${ext}」格式不支持压缩` };
      const r = await compressImageSameFormat(target.abs, ext, p, target.size);
      if (!r.buffer) return { ok: false, message: r.reason || '压缩后体积未减小' };
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
      if (!ffmpegAvailable()) return { ok: false, message: '服务端未安装 ffmpeg，无法压缩视频' };
      if (!['mp4', 'm4v', 'mov', 'webm'].includes(ext)) {
        return { ok: false, message: `「${ext}」容器暂不支持原位压缩（会改变扩展名，破坏已签发外链）` };
      }
      const remain = deadline > 0 ? Math.max(5, Math.round((deadline - Date.now()) / 1000)) : undefined;
      const r = await compressVideoFile(target.abs, ext, p, target.size, remain);
      if (!r.compressed) return { ok: false, message: r.reason || '压缩未生效' };
      /*
       * 超时判定必须放在 writeInPlace **之前**：一旦落盘就已成事实，
       * 此时再回「已放弃」等于骗调用方（文件其实已经被换掉了）。
       */
      const late = tooLate();
      if (late) return { ok: false, message: late, elapsedMs: Date.now() - started };
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
      if (!ffmpegAvailable()) return { ok: false, message: '服务端未安装 ffmpeg，无法压缩音频' };
      const remain = deadline > 0 ? Math.max(5, Math.round((deadline - Date.now()) / 1000)) : undefined;
      const r = await compressAudioFile(target.abs, ext, p, target.size, remain);
      if (!r.compressed) return { ok: false, message: r.reason || '压缩未生效' };
      const late = tooLate();
      if (late) return { ok: false, message: late, elapsedMs: Date.now() - started };
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
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    // ffmpeg 超时被杀 → execFile 抛 killed / SIGTERM，这里统一翻译成「超过上限时长」
    const timeout = /timeout|killed|SIGTERM|SIGKILL|maxBuffer/i.test(msg);
    const reason = timeout
      ? `执行时间超过「压缩文件上限时长」（${maxSeconds} 秒），已放弃本次压缩`
      : `压缩失败：${msg}`;
    appLog.warn('file', `原位压缩失败：${target.name}`, reason);
    return { ok: false, message: reason, elapsedMs: Date.now() - started };
  }
}

/**
 * 图片「保格式」压缩：png 优先重编码、jpg/webp/avif 用 quality 逼近目标体积。
 *
 * 与 compress.ts 里的 compressImageFile 的区别：**不转 webp**。
 * 那个函数是给上传链路用的（换格式无所谓，反正是新文件）；
 * 这里的文件已经签发过外链，换成 webp 等于让 .jpg 的链接指向 webp 字节。
 */
async function compressImageSameFormat(
  abs: string,
  ext: string,
  percent: number,
  original: number,
): Promise<{ buffer?: Buffer; reason?: string; width?: number; height?: number }> {
  const sharp = (await import('sharp')).default;
  const target = Math.max(1024, Math.round((original * percent) / 100));
  const img = sharp(abs, { limitInputPixels: 60_000_000 });
  const meta = await img.metadata();
  const w = meta.width;
  const h = meta.height;

  const encode = async (quality: number): Promise<Buffer> => {
    const p = sharp(abs, { limitInputPixels: 60_000_000 });
    if (ext === 'jpg' || ext === 'jpeg') return p.jpeg({ quality, mozjpeg: true }).toBuffer();
    if (ext === 'webp') return p.webp({ quality }).toBuffer();
    if (ext === 'avif') return p.avif({ quality }).toBuffer();
    return p.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  };

  if (ext === 'png') {
    const buf = await encode(100);
    if (buf.length >= original) return { reason: `png 重编码后没有变小（${original}B → ${buf.length}B）`, width: w, height: h };
    return { buffer: buf, width: w, height: h };
  }

  // 有损格式：从 90 起步，按体积差距迭代逼近目标
  let quality = Math.min(90, Math.max(30, percent));
  let best: Buffer | null = null;
  for (let i = 0; i < 4; i += 1) {
    const buf = await encode(quality);
    best = buf;
    if (buf.length <= target || quality <= 25) break;
    quality = Math.max(25, Math.round(quality * Math.sqrt(target / Math.max(1, buf.length))));
  }
  if (!best || best.length >= original) {
    return { reason: `压缩后体积未减小（${original}B → ${best?.length ?? 0}B）`, width: w, height: h };
  }
  return { buffer: best, width: w, height: h };
}

/* ==========================================================================
 * 三、转 WebP（唯一会改变编码格式的操作）
 * ========================================================================== */

export async function toWebp(
  target: MediaTarget,
  lossless: boolean,
): Promise<MediaEditResult> {
  const started = Date.now();
  if (target.ext === 'webp' || target.mime === 'image/webp') {
    return { ok: false, message: '这个文件已经是 WebP 了，无需转换' };
  }
  if (!IMAGE_EXT.has(target.ext)) return { ok: false, message: `「${target.ext || '未知'}」格式不支持转 WebP` };
  const sharp = (await import('sharp')).default;
  try {
    const pipeline = sharp(target.abs, { limitInputPixels: 60_000_000 });
    const meta = await pipeline.metadata();
    const buf = lossless
      ? await pipeline.webp({ lossless: true, effort: 5 }).toBuffer()
      : await pipeline.webp({ quality: 82, effort: 4 }).toBuffer();
    if (!buf.length) return { ok: false, message: 'WebP 转换结果为空' };
    /*
     * 文件名与扩展名保持不变（外链不能变），只把 record.mime 改成 image/webp。
     * 浏览器按 Content-Type 决定解码器，所以 .jpg 的地址返回 WebP 字节依然能正常显示。
     */
    await writeInPlace(target.abs, buf);
    const { md5 } = await commitEdit(target, {
      size: buf.length,
      mime: 'image/webp',
      width: meta.width,
      height: meta.height,
      kind: lossless ? '转WebP(无损)' : '转WebP(有损)',
    });
    return { ok: true, size: buf.length, width: meta.width, height: meta.height, md5, mime: 'image/webp', elapsedMs: Date.now() - started };
  } catch (err) {
    return { ok: false, message: `转 WebP 失败：${(err as Error).message}`, elapsedMs: Date.now() - started };
  }
}

/* ==========================================================================
 * 四、视频转码（仅当浏览器确实播不了时才做）
 * ========================================================================== */

export async function transcodeInPlace(
  target: MediaTarget,
  maxSeconds: number,
): Promise<MediaEditResult> {
  const started = Date.now();
  if (!(target.mime || '').startsWith('video/')) return { ok: false, message: '只有视频文件支持转码' };
  if (!ffmpegAvailable()) return { ok: false, message: '服务端未安装 ffmpeg，无法转码' };

  // 先探测：已经是浏览器能播的编码就不浪费 CPU
  let codec = '';
  try {
    codec = await probeVideoCodecFile(target.abs);
  } catch {
    codec = '';
  }
  if (codec && !VIDEO_CODEC_INCOMPATIBLE.has(codec)) {
    return {
      ok: false,
      message: `当前视频编码是 ${codec.toUpperCase()}，浏览器可以直接播放，无需转码`,
      elapsedMs: Date.now() - started,
    };
  }

  try {
    const r = await transcodeVideoFile(target.abs, target.size, maxSeconds > 0 ? maxSeconds : undefined);
    if (!r.compressed) {
      const timeout = /timeout|killed|SIGTERM|SIGKILL/i.test(r.reason || '');
      const reason = timeout
        ? `执行时间超过「视频转码上限时长」（${maxSeconds} 秒），已放弃本次转码`
        : r.reason || '转码未生效';
      appLog.warn('file', `原位转码失败：${target.name}`, reason);
      return { ok: false, message: reason, elapsedMs: Date.now() - started };
    }
    /*
     * 转码产物是 mp4/H.264。原文件若是 .mov / .m4v，文件名保持不变但容器已变成 mp4，
     * 因此把 mime 一并更新为 video/mp4 —— 浏览器按 Content-Type 选解码器，播放不受影响。
     */
    await writeInPlace(target.abs, r.path);
    const mime = r.mime || 'video/mp4';
    const { md5 } = await commitEdit(target, {
      size: r.size,
      mime,
      kind: '转码H.264',
    });
    return { ok: true, size: r.size, md5, mime, elapsedMs: Date.now() - started };
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    const timeout = /timeout|killed|SIGTERM|SIGKILL|maxBuffer/i.test(msg);
    const reason = timeout
      ? `执行时间超过「视频转码上限时长」（${maxSeconds} 秒），已放弃本次转码`
      : `转码失败：${msg}`;
    appLog.warn('file', `原位转码失败：${target.name}`, reason);
    return { ok: false, message: reason, elapsedMs: Date.now() - started };
  }
}

/** 记录一次「放弃」的失败原因到系统日志（供后台「系统日志」查看） */
export function logAbandoned(name: string, kind: string, reason: string): void {
  appLog.warn('file', `已放弃${kind}：${name}`, reason);
}
