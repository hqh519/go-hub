import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, PutObjectCommand, DeleteObjectCommand, S3Client, UploadPartCommand } from '@aws-sdk/client-s3';
import { promises as fsp } from 'fs';
import { AdapterError, ChannelInfo, CopyInfo, StorageAdapter, UploadResult } from './adapter.interface';
import { ensureProtocol } from '../common/endpoint';
import { buildAssetUrl } from '../common/asset-url';

export { looksInternalHost } from '../common/endpoint';

/**
 * S3 协议适配器 —— 覆盖 4 个渠道类型：
 *   cos   腾讯云 COS（专属预设：S3 兼容端点）
 *   minio MinIO（专属预设：path-style）
 *   r2    Cloudflare R2（专属预设：自动 endpoint 规则）
 *   s3    任意 S3 兼容存储
 *
 * 四者对外是独立渠道、独立配置表单（符合"专属通道"要求），
 * 实现层共享 S3 协议代码以减少重复。
 *
 * 配置字段：
 *   endpoint / region / accessKeyId / secretAccessKey / bucket
 *   pathStyle (true 时 path-style 寻址)
 *   publicDomain (自定义访问域名，如 COS 的 CDN 域名或 R2 的自定义域)
 *   keyPrefix (可选，对象 key 前缀)
 */
/**
 * 解析渠道 endpoint —— 支持各「专属通道」的自动推导：
 *   cos  ：填了 region 未填 endpoint → https://cos.<region>.myqcloud.com
 *          （填了本地/加速端点时不会被覆盖）
 *   r2   ：endpoint 只填「账户 ID」→ https://<accountId>.r2.cloudflarestorage.com
 *   minio/s3：按填写值原样使用
 */
function resolveEndpoint(type: string, cfg: Record<string, string>): string {
  const raw = (cfg.endpoint || '').trim();
  if (type === 'r2' && raw && !/^https?:\/\//i.test(raw)) {
    return `https://${raw}.r2.cloudflarestorage.com`;
  }
  // 端点缺协议时按地址类型补默认协议：
  //   内网 / 容器名（minio:9000、192.168.1.10）→ http（自建服务普遍未开 TLS）
  //   公网域名（s3.amazonaws.com 等）        → https
  // 详见 common/endpoint.ts 的说明（内网直连可显著提速，且不受前端 https 影响）
  if (raw) return ensureProtocol(raw);
  if (type === 'cos' && cfg.region) {
    return `https://cos.${cfg.region}.myqcloud.com`;
  }
  return '';
}

/**
 * 解析真实 Bucket 名。
 * 腾讯云 COS 的 Bucket 必须是 `<bucket>-<appid>` 形式（对齐 PHP 案例：
 * 用户填的桶名不含 AppID 时自动补上；已含则不再重复拼接）。
 */
function resolveBucket(type: string, cfg: Record<string, string>): string {
  const bucket = (cfg.bucket || '').trim();
  const appid = (cfg.appid || '').trim();
  if (type === 'cos' && appid && !bucket.includes(`-${appid}`)) {
    return `${bucket}-${appid}`;
  }
  return bucket;
}

export class S3Adapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;
  private channel: ChannelInfo;
  private endpoint: string;

  constructor(channel: ChannelInfo) {
    this.channel = channel;
    const cfg = channel.config;
    // 兼容两套命名：COS 用 SecretId/SecretKey，其余用 AccessKeyId/SecretAccessKey
    const ak = cfg.accessKeyId || cfg.secretId || '';
    const sk = cfg.secretAccessKey || cfg.secretKey || '';
    if (!ak || !sk || !cfg.bucket) {
      throw new AdapterError('缺少 AccessKey / SecretKey / bucket 配置', channel.type);
    }
    this.endpoint = resolveEndpoint(channel.type, cfg);
    this.client = new S3Client({
      endpoint: this.endpoint || undefined,
      region: cfg.region || 'auto',
      credentials: { accessKeyId: ak, secretAccessKey: sk },
      forcePathStyle: cfg.pathStyle === 'true' || channel.type === 'minio',
    });
    this.bucket = resolveBucket(channel.type, cfg);
    this.applyUserAgent(cfg.userAgent);
  }

  /**
   * 自定义 User-Agent（复用 CloudFlare-ImgBed 的 createS3Client 方案）。
   * 部分 S3 兼容服务商（如某些对象存储网关）把访问密钥与特定 UA 绑定，
   * SDK 默认 UA 会被拒 —— 配置了 userAgent 时直接「替换」请求头而非追加。
   */
  private applyUserAgent(userAgent?: string) {
    const ua = (userAgent || '').trim();
    if (!ua) return;
    if (/[^\x20-\x7e]/.test(ua)) {
      throw new AdapterError('User-Agent 只能包含可打印 ASCII 字符', this.channel.type);
    }
    this.client.middlewareStack.addRelativeTo(
      (next: any) => async (args: any) => {
        args.request.headers['user-agent'] = ua;
        return next(args);
      },
      { name: 'channelUserAgentMiddleware', relation: 'after', toMiddleware: 'getUserAgentMiddleware' } as any,
    );
  }

  async upload(file: { buffer: Buffer; mime: string; originalName: string }, key: string, channel: ChannelInfo): Promise<UploadResult> {
    // key 已由 UploadService.makeKeyFor 拼好「对象前缀 + 文件名」（含 {y}/{m}/{d} 渲染），
    // 这里**不要**再拼 config.keyPrefix，否则前缀会重复叠加。
    const fullKey = key;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: fullKey,
          Body: file.buffer,
          ContentType: file.mime,
        }),
      );
      return { remoteKey: fullKey, objectPath: this.objectPathFor(fullKey) };
    } catch (err) {
      throw new AdapterError(`上传失败: ${(err as Error).message}`, channel.type);
    }
  }

  /**
   * v2.8.3：大文件分片上传（multipart upload）。
   * 每片 16MB 从磁盘读入后发送，内存占用恒定；失败时 Abort，避免对象存储里留半截文件。
   * 500MB 文件 = 32 片，顺序发送（并发会争抢上行，顺序更稳）。
   */
  async uploadFile(
    path: string,
    size: number,
    file: { mime: string; originalName: string },
    key: string,
    channel: ChannelInfo,
  ): Promise<UploadResult> {
    const fullKey = key;
    const PART_SIZE = 16 * 1024 * 1024;
    // 小于一片直接单次 PUT，省一次 Create/Complete 往返
    if (size <= PART_SIZE) {
      const buffer = await fsp.readFile(path);
      return this.upload({ buffer, mime: file.mime, originalName: file.originalName }, key, channel);
    }

    let uploadId: string | undefined;
    try {
      const created = await this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: fullKey,
          ContentType: file.mime,
        }),
      );
      uploadId = created.UploadId;
      if (!uploadId) throw new Error('未返回 UploadId');

      const parts: Array<{ ETag?: string; PartNumber: number }> = [];
      const fh = await fsp.open(path, 'r');
      try {
        for (let offset = 0, partNumber = 1; offset < size; offset += PART_SIZE, partNumber++) {
          const len = Math.min(PART_SIZE, size - offset);
          const buf = Buffer.allocUnsafe(len);
          const { bytesRead } = await fh.read(buf, 0, len, offset);
          if (bytesRead !== len) throw new Error(`读取第 ${partNumber} 片失败：期望 ${len}B，实际 ${bytesRead}B`);
          const part = await this.client.send(
            new UploadPartCommand({
              Bucket: this.bucket,
              Key: fullKey,
              UploadId: uploadId,
              PartNumber: partNumber,
              Body: buf,
            }),
          );
          parts.push({ ETag: part.ETag, PartNumber: partNumber });
        }
      } finally {
        await fh.close().catch(() => undefined);
      }

      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: fullKey,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }),
      );
      return { remoteKey: fullKey, objectPath: this.objectPathFor(fullKey) };
    } catch (err) {
      if (uploadId) {
        await this.client
          .send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: fullKey, UploadId: uploadId }))
          .catch(() => undefined);
      }
      throw new AdapterError(`分片上传失败: ${(err as Error).message}`, channel.type);
    }
  }

  async delete(copy: CopyInfo, channel: ChannelInfo): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: copy.remoteKey }));
    } catch (err) {
      throw new AdapterError(`删除失败: ${(err as Error).message}`, channel.type);
    }
  }

  /**
   * 直链构造（严格对齐 PHP 联调案例）：
   *   - path-style 渠道（MinIO / 勾选了 Path-Style）：
   *       公开域名若只到 host（如 https://minio.example.com），需补上 bucket；
   *       已含 bucket 时不重复拼接。最终形如 `https://host/bucket/<key>`。
   *   - virtual-host 渠道（COS / S3 / R2）：
   *       公开域名视为「完整前缀」（通常是 CDN 域名，已含 bucket 或映射），直接拼 key。
   *   未配置公开域名时回退 endpoint 推导；endpoint 缺协议会自动补齐
   *   （内网 / 容器名补 http，公网域名补 https，见 common/endpoint.ts）。
   */
  /**
   * v3.0.0（R10）：该渠道「加载域名」基址 —— 文件加载域名的唯一出口。
   *   ① 代理模式优先内网通信域名，否则公开访问域名；
   *   ② 都没配时退回 Endpoint（path-style 直接用，virtual-host 把桶名提到 host）；
   * 返回值不含尾斜杠，路径部分由 objectPath 补。
   */
  private baseUrlOf(preferInternal: boolean): string {
    const cfg = this.channel.config;
    const raw = preferInternal && cfg.internalDomain ? cfg.internalDomain : cfg.publicDomain || '';
    const domain = ensureProtocol(raw || '').replace(/\/+$/, '');
    if (domain) return domain;
    const endpoint = resolveEndpoint(this.channel.type, cfg).replace(/\/+$/, '');
    if (!endpoint) return '';
    const pathStyle = cfg.pathStyle === 'true' || this.channel.type === 'minio';
    if (pathStyle) return endpoint;
    try {
      const u = new URL(endpoint);
      return `${u.protocol}//${this.bucket}.${u.host}${u.pathname.replace(/\/+$/, '')}`;
    } catch {
      return `${endpoint}/${this.bucket}`;
    }
  }

  /**
   * v3.0.0（R10）：固化路径。
   * path-style 时桶名在路径里（`bucket/2026/11/x.png`）；
   * virtual-host 时桶名在域名里（`2026/11/x.png`），不能重复。
   */
  private objectPathFor(key: string): string {
    const cfg = this.channel.config;
    const pathStyle = cfg.pathStyle === 'true' || this.channel.type === 'minio';
    if (!pathStyle) return key;
    const domain = String(cfg.publicDomain || cfg.internalDomain || '').trim();
    if (domain) {
      try {
        const segs = new URL(ensureProtocol(domain)).pathname.split('/').filter(Boolean);
        if (segs[segs.length - 1] === this.bucket) return key;
      } catch {
        /* 非法域名交给后面兜底 */
      }
    }
    return `${this.bucket}/${key}`;
  }

  buildDirectUrl(copy: CopyInfo, channel: ChannelInfo, preferInternal?: boolean): string | null {
    const cfg = channel.config;
    const key = copy.remoteKey;
    // COS 等支持在 URL 末尾追加图片处理参数（对齐 PHP 案例的 tencent_suffix）
    const suffix = (cfg.suffix || '').trim();
    const withSuffix = (u: string) => (suffix ? u + (suffix.startsWith('?') ? suffix : `?${suffix}`) : u);
    const pathStyle = cfg.pathStyle === 'true' || channel.type === 'minio';
    /*
     * v3.0.0（R10）：新数据一律「动态域名 + 固化地址」——
     * 域名取自渠道当前配置（改域名立即生效），路径用上传时落库的 objectPath
     * （改桶名/前缀/命名不影响存量文件）。objectPath 为空的老数据继续走下面的旧规则。
     */
    if (copy.objectPath) {
      const base = this.baseUrlOf(!!preferInternal);
      if (!base) return null;
      return buildAssetUrl({ base, objectPath: copy.objectPath, urlQuery: copy.urlQuery, suffix });
    }

    // 外链域名同样允许不写协议（如填 minio:9000 走内网）：内网补 http、公网补 https
    // v3.0.0：MinIO 的域名只填域名（不含 /bucket）—— 桶名一律由下面的 pathStyle 分支拼接；
    //         历史配置里若仍带着 /bucket，靠 pathHasBucket 判断避免拼成 /bucket/bucket。
    // v2.8.7：preferInternal 时优先「内网通信域名」（服务端代理拉取走内网）
    const domain = ensureProtocol((preferInternal && cfg.internalDomain) || cfg.publicDomain || '').replace(/\/+$/, '');
    if (domain) {
      // MinIO 的公开域名一般只到 host（不含 bucket）→ 补 bucket。
      // ⚠️ 判断「域名里是否已含 bucket」必须按 URL 的路径分段比较：
      //    早期用 `domain.includes('/' + bucket)` 时，若域名恰好以 bucket 开头
      //    （bucket=img、域名=https://img.example.com），`https://` 里的 `//`
      //    会被当成 `/img` 命中 → 漏拼 bucket，返回 404 的错误链接。
      if (pathStyle) {
        let pathHasBucket = false;
        try {
          const u = new URL(domain);
          pathHasBucket = u.pathname.split('/').filter(Boolean).includes(this.bucket);
        } catch {
          pathHasBucket = domain.split('/').filter(Boolean).includes(this.bucket);
        }
        return withSuffix(pathHasBucket ? `${domain}/${key}` : `${domain}/${this.bucket}/${key}`);
      }
      return withSuffix(`${domain}/${key}`);
    }

    const endpoint = resolveEndpoint(channel.type, cfg).replace(/\/+$/, '');
    if (!endpoint) return null;
    if (pathStyle) {
      return withSuffix(`${endpoint}/${this.bucket}/${key}`);
    }
    // virtual-host 风格：COS 是 bucket.cos.region.myqcloud.com
    try {
      const url = new URL(endpoint);
      return withSuffix(`${url.protocol}//${this.bucket}.${url.host}${url.pathname.replace(/\/+$/, '')}/${key}`);
    } catch {
      return withSuffix(`${endpoint}/${this.bucket}/${key}`);
    }
  }
}
