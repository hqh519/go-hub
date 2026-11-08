/**
 * 文件详情页的「原位媒体编辑」（v1.0.5，v1.0.6 起支持改扩展名）。
 *
 * 与上传链路的区别：
 *   · 上传链路是「拿到一件新东西，存进渠道」；
 *   · 这里是「已经签发过外链的文件，改它的字节，但不许动外链」。
 *
 * 由此成立的硬约束：
 *   1. **对外标识（FileRecord.name）不变** —— 外链是 /file/<name>，它是链接的唯一锚点；
 *   2. 磁盘物理文件走「临时文件 + rename」原子替换，中途被读到不会拿到半份字节；
 *   3. 只处理**主副本落在本地存储渠道**的文件 —— 第三方渠道没有「直接改字节」的接口，
 *      硬做只能整份重新上传，那已经不是「编辑」而是「转存」了。
 *
 * v1.0.6 的变化：转 WebP 时会同时把**扩展名**改成 .webp
 * （磁盘物理文件名 + FileCopy.remoteKey + FileRecord.originalName）。
 * 之所以敢动扩展名，是因为同一版里把签发外链改成**默认不带扩展名**，
 * 链接与文件格式解耦：转码前后外链一模一样，用户引用过的地址不会因为格式变化而 404。
 * 注意仍然不动 FileRecord.name —— 少数历史文件（WebDAV / S3 上传）的 name 自带扩展名，
 * 改它会真的换掉链接。
 *
 * 每次编辑完成后同步刷新：size / md5 / mime / metas.Width / metas.Height / metas.EditedAt，
 * 并把压缩前的原始大小留在 originalSize（只在第一次压缩时写入）。
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fsp } from 'fs';
import { basename, dirname, join } from 'node:path';
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
  /** 主副本在渠道里的相对键（= 磁盘上的物理文件名），转 WebP 改扩展名时要用 */
  remoteKey: string;
}

export interface MediaEditResult {
  ok: boolean;
  message?: string;
  size?: number;
  width?: number;
  height?: number;
  md5?: string;
  mime?: string;
  /** 转 WebP 会改扩展名，前端据此刷新详情页显示的文件名 */
  originalName?: string;
  elapsedMs?: number;
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif']);

/**
 * 视频编码 fourcc → 大家看得懂的名字（v1.0.6）。
 *
 * 转码确认页要把「当前视频的编码格式」直接摆出来，用户才有判断依据 ——
 * 只丢一个 `hvc1` 出去没人知道那是 HEVC，也就不知道到底该不该转。
 */
const VIDEO_CODEC_LABELS: Record<string, string> = {
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

/** 把 fourcc 转成可读编码名；未知的直接大写原样返回，至少比空着强 */
export function videoCodecLabel(codec: string): string {
  const k = String(codec || '').trim().toLowerCase();
  if (!k) return '';
  return VIDEO_CODEC_LABELS[k] || k.toUpperCase();
}

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
      remoteKey: primary.remoteKey || '',
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

/**
 * 把文件扩展名改成 .webp：磁盘物理名 + 副本 remoteKey + 原始文件名，三处一起改。
 *
 * 为什么只改这三处、**不改 FileRecord.name**：name 是 `/file/<name>` 的唯一锚点。
 * 大多是 48 位随机串（不含扩展名），改不改都一样；但 WebDAV / S3 上传的文件
 * 会带着上传时的路径当 name，动它等于把已签发的外链换掉。
 *
 * 物理文件用 rename 而不是「复制 + 删除」：同目录同一分区，rename 是原子的，
 * 也不会因为磁盘空间不足而失败。
 *
 * 返回是否发生了改名；改名成功后会就地更新 target，让随后的 commitEdit 在新路径上算 md5。
 */
async function renameExtToWebp(target: MediaTarget): Promise<boolean> {
  try {
    const oldAbs = target.abs;
    const dir = dirname(oldAbs);
    const base = basename(oldAbs);
    const stem = base.replace(/\.[A-Za-z0-9]{1,12}$/, '');
    const newBase = `${stem}.webp`;
    if (newBase === base) return false;
    const newAbs = join(dir, newBase);
    await fsp.rename(oldAbs, newAbs);

    // remoteKey 可能带目录层级（2026/08/xxx.png），只替换最后一段
    const newKey = target.remoteKey
      ? target.remoteKey.replace(/[^/]+$/, newBase)
      : newBase;
    if (target.remoteKey) {
      await prisma.fileCopy.updateMany({
        where: { fileId: target.id, remoteKey: target.remoteKey },
        data: { remoteKey: newKey },
      });
    }
    const newOriginal = /\.([A-Za-z0-9]{1,12})$/.test(target.originalName || '')
      ? target.originalName.replace(/\.[A-Za-z0-9]{1,12}$/, '.webp')
      : `${target.originalName || stem}.webp`;
    await prisma.fileRecord.update({
      where: { id: target.id },
      data: { originalName: newOriginal },
    });

    target.abs = newAbs;
    target.remoteKey = newKey;
    target.originalName = newOriginal;
    target.ext = 'webp';
    return true;
  } catch (err) {
    // 改名失败不影响字节已经转好——只是文件名还留着旧扩展名，记录一笔便于排查
    appLog.warn('file', `转 WebP 后改扩展名失败：${target.name}`, (err as Error).message);
    return false;
  }
}

/* ==========================================================================
 * 一、裁剪（前端已经裁好并转成 PNG/JPEG 传上来，这里只负责按原格式重新编码）
 * ========================================================================== */export async function cropImage(
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
     * v1.0.6：字节写完顺手把扩展名改成 .webp（磁盘名 / remoteKey / originalName）。
     * 外链不受影响 —— 同一版起签发外链默认不带扩展名，链接与格式彻底解耦。
     * 顺序很重要：先落字节，再改名；改名会把 target.abs 指向新路径，
     * 后面的 commitEdit 于是在新文件上算 md5，不会算到旧路径上。
     */
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
      // 让前端知道名字变了（详情页要显示新的 .webp 文件名）
      originalName: target.originalName,
      elapsedMs: Date.now() - started,
    };
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
