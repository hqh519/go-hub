import { ChannelInfo, CopyInfo, StorageAdapter } from './adapter.interface';
import { S3Adapter } from './s3.adapter';
import { AliyunOssAdapter } from './aliyun.adapter';
import { HttpPostAdapter } from './http-post.adapter';
import { WebdavAdapter } from './webdav.adapter';
import { ImmichAdapter } from './immich.adapter';
import { LocalAdapter } from './local.adapter';

/**
 * 适配器工厂 —— 渠道类型 → 适配器实例。
 * cos/minio/r2/s3 共享 S3 协议实现（对外仍为四个专属渠道）；
 * aliyun 走 OSS 自有签名实现（不依赖 S3 兼容层）；
 * local 为系统内置的本地磁盘存储（无需任何配置，也不允许通过「添加渠道」创建）。
 */
export function createAdapter(channel: ChannelInfo): StorageAdapter {
  switch (channel.type) {
    case 'local':
      return new LocalAdapter();
    case 'cos':
    case 'minio':
    case 'r2':
    case 's3':
      return new S3Adapter(channel);
    case 'aliyun':
      return new AliyunOssAdapter(channel);
    case 'easyimages':
    case 'lsky':
    case 'custom':
      return new HttpPostAdapter(channel);
    case 'webdav':
      return new WebdavAdapter();
    case 'immich':
      return new ImmichAdapter();
    default:
      throw new Error(`未知渠道类型: ${channel.type}`);
  }
}

/** Prisma 副本行 → 适配器 CopyInfo（metas 为 JSON 字符串，适配器不需要解析它） */
export function toCopyInfo(c: {
  remoteKey: string;
  remoteUrl: string;
  objectPath?: string | null;
  urlQuery?: string | null;
  metas?: string | null;
}): CopyInfo {
  let metas: Record<string, unknown> = {};
  try {
    const parsed = c.metas ? JSON.parse(c.metas) : null;
    if (parsed && typeof parsed === 'object') metas = parsed as Record<string, unknown>;
  } catch {
    metas = {};
  }
  return {
    remoteKey: c.remoteKey,
    remoteUrl: c.remoteUrl,
    objectPath: c.objectPath || '',
    urlQuery: c.urlQuery || '',
    metas,
  };
}

/** 各渠道的敏感配置字段（用于脱敏/加密判定，与 channels.controller 保持一致） */
export const ADAPTER_META = {
  local: { label: '本地存储', secretFields: [] as string[] },
  cos: { label: '腾讯云 COS', secretFields: ['secretId', 'secretKey'] },
  minio: { label: 'MinIO', secretFields: ['accessKeyId', 'secretAccessKey'] },
  r2: { label: 'Cloudflare R2', secretFields: ['accessKeyId', 'secretAccessKey'] },
  s3: { label: 'S3 兼容存储', secretFields: ['accessKeyId', 'secretAccessKey'] },
  aliyun: { label: '阿里云 OSS', secretFields: ['accessKeyId', 'accessKeySecret'] },
  easyimages: { label: 'EasyImages 简单图床', secretFields: ['token'] },
  lsky: { label: 'Lsky Pro 兰空图床', secretFields: ['token'] },
  webdav: { label: 'WebDAV 协议', secretFields: ['password'] },
  immich: { label: 'Immich', secretFields: ['apiKey'] },
  custom: { label: '自定义 Web 存储', secretFields: ['tokenValue'] },
} as const;
