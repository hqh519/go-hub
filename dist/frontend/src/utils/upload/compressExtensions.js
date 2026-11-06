/**
 * 可压缩格式清单（v2.8.5 从 UploadFileItem 提到公共模块，前后端语义对齐）。
 *
 * 后端 common/compress.ts 实际能压的格式：
 *   图片 jpg/jpeg/jfif/png/webp/avif（gif 会丢帧、svg/heic/tiff/bmp/ico/psd 一律跳过）
 *   视频 mp4/webm/mov/m4v/mkv
 *   音频 mp3/m4a/aac/wav/flac/ogg/opus
 *
 * 用途：
 *   · UploadFileItem 判断条目是否可能停在「压缩中」；
 *   · UploadForm 在「上传设置 → 允许压缩格式」留空时用它兜底。
 */
export const COMPRESSIBLE_EXTENSIONS = [
  'jpg', 'jpeg', 'jfif', 'png', 'webp', 'avif',
  'mp4', 'webm', 'mov', 'm4v', 'mkv',
  'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'
];

/** 把 "jpg,png, MP4" / "jpg png" 这类输入解析成小写扩展名数组；空输入返回 [] */
export function parseExtList(raw) {
  return String(raw || '')
    .split(/[,，、\s]+/)
    .map((s) => s.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean);
}

export default COMPRESSIBLE_EXTENSIONS;
