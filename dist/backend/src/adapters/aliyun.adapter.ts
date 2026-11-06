import { createHash, createHmac } from 'node:crypto';
import { AdapterError, ChannelInfo, CopyInfo, StorageAdapter, UploadResult } from './adapter.interface';
import { ensureProtocol } from '../common/endpoint';
import { buildAssetUrl } from '../common/asset-url';

/**
 * 阿里云 OSS 专用适配器。
 *
 * 为什么不用 S3 兼容通道？
 *   OSS 的 S3 兼容性并不完整（部分操作、签名与 region 行为与标准 S3 有差异），
 *   直接用 OSS 官方 REST 接口 + OSS 自有签名最稳，不依赖第三方兼容层。
 *
 * 签名算法（官方 V1，Authorization: OSS <AccessKeyId>:<Signature>）：
 *   StringToSign = VERB + "\n"
 *                + Content-MD5 + "\n"
 *                + Content-Type + "\n"
 *                + Date + "\n"
 *                + CanonicalizedOSSHeaders   // 所有 x-oss-* 头，按名称升序，每行 "name:value\n"
 *                + CanonicalizedResource     // "/<bucket>/<key>"
 *   其中 Date 字段与请求头 Date 一致；同时发送 x-oss-date（会被算进 CanonicalizedOSSHeaders）
 *   以保证签名里带的日期与「实际发出的时间」严格一致。
 *
 * 配置字段：
 *   bucket / accessKeyId / accessKeySecret
 *   region      —— 如 oss-cn-hangzhou（也接受 cn-hangzhou），用于推导 endpoint
 *   endpoint    —— 可选，覆盖自动推导（如自建代理网关、内网端点）
 *   pathStyle   —— true 时用 endpoint/bucket/key，默认 false（bucket.endpoint/key）
 *   publicDomain / keyPrefix / suffix（外链图片处理参数）
 */

/** 签名入参（抽成纯函数便于单独校验） */
export interface OssSignInput {
  method: string;
  /** CanonicalizedResource：形如 /<bucket>/<key> */
  resource: string;
  /** 实际要发送的请求头（大小写不敏感）。建议包含 x-oss-date。 */
  headers: Record<string, string>;
  secret: string;
  /** URL 签名场景的过期时间（普通请求不需要） */
  expires?: string;
}

/**
 * 构造 V1 待签名字符串（与阿里云官方 Node SDK ali-oss 的
 * `buildCanonicalString` 完全一致）：
 *   ① 方法（大写）② Content-MD5 ③ Content-Type ④ 时间
 *   ⑤ 所有 x-oss-* 头（转小写、按名升序、`name:value` 形式、值 trim）
 *   ⑥ CanonicalizedResource（/bucket/key）
 * 其中第 ④ 行取 `expires || x-oss-date` —— 本系统统一只发 x-oss-date、不发 Date，
 * 与官方 SDK 行为一致（官方 SDK 出于浏览器/Node 对 Date 头的限制，均改用 x-oss-date）。
 */
export function buildOssCanonicalString(input: Omit<OssSignInput, 'secret'>): string {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers || {})) {
    lower[String(k).toLowerCase()] = String(v ?? '').trim();
  }
  const ossHeaderLines = Object.keys(lower)
    .filter((k) => k.startsWith('x-oss-'))
    .sort()
    .map((k) => `${k}:${lower[k]}`);
  return [
    String(input.method || '').toUpperCase(),
    lower['content-md5'] || '',
    lower['content-type'] || '',
    input.expires || lower['x-oss-date'] || '',
    ...ossHeaderLines,
    input.resource,
  ].join('\n');
}

/** 计算 OSS V1 签名（base64(HMAC-SHA1(secret, 待签名字符串))） */
export function ossSignature(input: OssSignInput): string {
  return createHmac('sha1', input.secret)
    .update(buildOssCanonicalString(input), 'utf8')
    .digest('base64');
}

/** 推导 OSS Endpoint：优先手填，其次按 region 推导 oss-<region>.aliyuncs.com */
function resolveOssEndpoint(cfg: Record<string, string>): string {
  const raw = (cfg.endpoint || '').trim();
  if (raw) return ensureProtocol(raw).replace(/\/+$/, '');
  const region = (cfg.region || '').trim();
  if (!region) return '';
  const host = region.startsWith('oss-') ? region : `oss-${region}`;
  return `https://${host}.aliyuncs.com`;
}

/** 对象 key → URL 路径（逐段百分号编码，保留 / 分隔） */
function encodeObjectPath(key: string): string {
  return String(key)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/** 拼接外链末尾的图片处理参数（对齐 COS 渠道的 suffix 用法，如 ?x-oss-process=image/resize,w_800） */
function withSuffix(url: string, suffix: string): string {
  const s = (suffix || '').trim();
  if (!s) return url;
  return url + (s.startsWith('?') ? s : `?${s}`);
}

export class AliyunOssAdapter implements StorageAdapter {
  private ak: string;
  private sk: string;
  private bucket: string;
  private endpoint: string;
  private pathStyle: boolean;
  private channel!: ChannelInfo;

  constructor(channel: ChannelInfo) {
    const cfg = channel.config;
    this.channel = channel;
    const ak = (cfg.accessKeyId || '').trim();
    // 兼容几种常见写法：AccessKeySecret / secretAccessKey 等
    const sk = (cfg.accessKeySecret || cfg.secretAccessKey || '').trim();
    const bucket = (cfg.bucket || '').trim();
    if (!ak || !sk || !bucket) {
      throw new AdapterError('缺少 AccessKeyId / AccessKeySecret / bucket 配置', channel.type);
    }
    this.ak = ak;
    this.sk = sk;
    this.bucket = bucket;
    this.pathStyle = cfg.pathStyle === 'true';
    this.endpoint = resolveOssEndpoint(cfg);
    if (!this.endpoint) {
      throw new AdapterError('缺少 Endpoint 或 Region（如 oss-cn-hangzhou）', channel.type);
    }
  }

  /** 拼出访问某个对象的真实请求地址（区分 virtual-host / path-style） */
  private objectUrl(key: string): string {
    const path = encodeObjectPath(key);
    if (this.pathStyle) {
      return `${this.endpoint}/${this.bucket}/${path}`;
    }
    return `${this.endpoint.replace('://', `://${this.bucket}.`)}/${path}`;
  }

  /** 统一的签名请求（PUT / DELETE 共用） */
  private async request(
    method: 'PUT' | 'DELETE',
    key: string,
    opts: { body?: Buffer; mime?: string } = {},
  ): Promise<void> {
    const url = this.objectUrl(key);
    // 只发 x-oss-date（不发 Date）—— 与官方 SDK 一致：签名第 ④ 行取 x-oss-date 的值
    const headers: Record<string, string> = { 'x-oss-date': new Date().toUTCString() };
    if (opts.body) {
      headers['Content-MD5'] = createHash('md5').update(opts.body).digest('base64');
      headers['Content-Type'] = opts.mime || 'application/octet-stream';
    }

    const signature = ossSignature({
      method,
      resource: `/${this.bucket}/${key}`,
      headers,
      secret: this.sk,
    });

    const res = await fetch(url, {
      method,
      headers: { ...headers, Authorization: `OSS ${this.ak}:${signature}` },
      body: opts.body ? new Uint8Array(opts.body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AdapterError(
        `${method === 'PUT' ? '上传' : '删除'}失败: HTTP ${res.status}${detail ? ` ${detail.slice(0, 300)}` : ''}`,
        'aliyun',
      );
    }
  }

  async upload(
    file: { buffer: Buffer; mime: string; originalName: string },
    key: string,
    channel: ChannelInfo,
  ): Promise<UploadResult> {
    // key 已由 UploadService.makeKeyFor 拼好「对象前缀 + 文件名」（含 {y}/{m}/{d} 渲染），
    // 这里**不要**再拼 config.keyPrefix，否则前缀会重复叠加。
    const fullKey = key;
    try {
      await this.request('PUT', fullKey, { body: file.buffer, mime: file.mime });
      return { remoteKey: fullKey, objectPath: this.objectPathFor(fullKey) };
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      throw new AdapterError(`上传失败: ${(err as Error).message}`, channel.type);
    }
  }

  async delete(copy: CopyInfo, channel: ChannelInfo): Promise<void> {
    try {
      await this.request('DELETE', copy.remoteKey);
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      throw new AdapterError(`删除失败: ${(err as Error).message}`, channel.type);
    }
  }

  /**
   * 直链构造：
   *   自定义访问域名（CDN / 绑定域名）优先，直接拼 key；
   *   否则按寻址风格拼 OSS 默认域名（bucket.endpoint 或 endpoint/bucket）。
   */
  /** v3.0.0（R10）：加载域名基址（不含尾斜杠，路径由 objectPath 补） */
  private baseUrlOf(preferInternal: boolean): string {
    const cfg = this.channel?.config || {};
    const raw = preferInternal && cfg.internalDomain ? cfg.internalDomain : cfg.publicDomain || '';
    const domain = ensureProtocol(raw || '').replace(/\/+$/, '');
    if (domain) return domain;
    const endpoint = this.endpoint.replace(/\/+$/, '');
    if (!endpoint) return '';
    if (this.pathStyle) return endpoint;
    try {
      const u = new URL(endpoint);
      return `${u.protocol}//${this.bucket}.${u.host}${u.pathname.replace(/\/+$/, '')}`;
    } catch {
      return `${endpoint}/${this.bucket}`;
    }
  }

  /**
   * v3.0.0（R10）：固化路径。
   * 绑定自定义域名时桶名在域名里（OSS 自定义域与桶绑定）→ 路径不含桶；
   * 未绑定时 path-style 含桶、virtual-host 不含桶。
   */
  private objectPathFor(key: string): string {
    const cfg = this.channel?.config || {};
    if (String(cfg.publicDomain || cfg.internalDomain || '').trim()) return key;
    return this.pathStyle ? `${this.bucket}/${key}` : key;
  }

  buildDirectUrl(copy: CopyInfo, channel: ChannelInfo, preferInternal?: boolean): string | null {
    const cfg = channel.config;
    const key = copy.remoteKey;
    const suffix = cfg.suffix || '';
    /*
     * v3.0.0（R10）：新数据「动态域名 + 固化地址」。
     * domain 不再参与 URL 拼接的路径部分，只作为加载域名基址；改域名立即生效。
     */
    if (copy.objectPath) {
      const base = this.baseUrlOf(!!preferInternal);
      if (!base) return null;
      return buildAssetUrl({ base, objectPath: copy.objectPath, urlQuery: copy.urlQuery, suffix });
    }
    const domain = ensureProtocol(
      (preferInternal && cfg.internalDomain) || cfg.publicDomain || '',
    ).replace(/\/+$/, '');
    if (domain) return withSuffix(`${domain}/${encodeObjectPath(key)}`, suffix);

    const endpoint = resolveOssEndpoint(cfg).replace(/\/+$/, '');
    if (!endpoint) return null;
    if (cfg.pathStyle === 'true') {
      return withSuffix(`${endpoint}/${this.bucket}/${encodeObjectPath(key)}`, suffix);
    }
    try {
      const url = new URL(endpoint);
      return withSuffix(
        `${url.protocol}//${this.bucket}.${url.host}${url.pathname.replace(/\/+$/, '')}/${encodeObjectPath(key)}`,
        suffix,
      );
    } catch {
      return withSuffix(`${endpoint}/${this.bucket}/${encodeObjectPath(key)}`, suffix);
    }
  }
}
