/**
 * 存储适配器统一接口 —— 策略模式核心。
 * 所有渠道实现同一接口，新增渠道 = 新增一个文件。
 *
 * 关键约定：upload 返回 remoteKey（资源的不可变标识）；
 * 直链 URL 不落库，访问时由 buildDirectUrl 按「渠道当前配置」动态构造
 * —— 渠道配置里的域名/桶变更后，存量外链自动跟随（302 分发层实时调用）。
 */
export interface ChannelInfo {
  id: string;
  /**
   * v3.0.0（R11）：6 位业务渠道 ID（code）。
   * 存储路径占位符 {ID} 用它渲染 —— 适配器只拿到 id 时会渲染成一长串主键，
   * 于是「自动切换渠道」上传的文件目录与正常上传不一致。
   */
  code?: string;
  name: string;
  type: string;
  /** 已解密的配置（服务端内部使用） */
  config: Record<string, string>;
  metas: Record<string, unknown>;
}

export interface CopyInfo {
  remoteKey: string;
  remoteUrl: string; // 仅「非本渠道上传」的外部地址（登记文件/外链）用
  /** v3.0.0：固化寻址路径（不含域名、不含 query，未编码原文） */
  objectPath?: string;
  /** v3.0.0：文件级查询串（不含 ?，原样），如 immich 的 key=<shareKey> */
  urlQuery?: string;
  metas: Record<string, unknown>;
}

export interface UploadResult {
  remoteKey: string;
  /** 仅当渠道无法用 key 构造 URL 时填写（custom 渠道兜底） */
  remoteUrl?: string;
  /** v3.0.0：固化寻址路径（URL 去掉 origin 的 path）—— 域名永不落库 */
  objectPath?: string;
  /** v3.0.0：文件级查询串（不含 ?） */
  urlQuery?: string;
  /** v3.0.0：附带落库的渠道侧凭证（远端删除用），会并入 copy.metas */
  metas?: Record<string, unknown>;
}

export interface UploadContext {
  /** 上传者用户名（本地渠道按此归档目录） */
  owner?: string;
  /**
   * v3.0.0 多实例：归属实例 ID。空串/缺省 → 'default'（默认实例）。
   * 仅本地存储渠道用于落盘路径分段（uploads/<用户名>/<实例ID>/…），其它渠道忽略。
   */
  instanceId?: string;
}

export interface StorageAdapter {
  /**
   * 上传文件，返回渠道内资源标识。
   * ctx.owner：上传者用户名。仅本地存储渠道使用 —— 落盘路径按
   * `uploads/<上传者>/年/月/文件` 归档，未指定上传者时归入 `default/`。
   */
  upload(
    file: { buffer: Buffer; mime: string; originalName: string },
    key: string,
    channel: ChannelInfo,
    ctx?: UploadContext,
  ): Promise<UploadResult>;
  /**
   * v2.8.3：从磁盘路径流式写入（大文件专用，避免整份读进内存）。
   * 未实现该方法的渠道会回退到 upload(buffer)；超过安全阈值时由 UploadService 拒绝。
   */
  uploadFile?(
    path: string,
    size: number,
    file: { mime: string; originalName: string },
    key: string,
    channel: ChannelInfo,
    ctx?: UploadContext,
  ): Promise<UploadResult>;
  /** 删除渠道内资源 */
  delete(copy: CopyInfo, channel: ChannelInfo): Promise<void>;
  /**
   * 按渠道当前配置构造直链（返回 null 表示无法构造）。
   * v2.8.7：preferInternal=true 时优先使用渠道配置的「内网通信域名」（internalDomain）——
   * 供服务端代理拉取（/file 出口代理模式）使用，走内网提速并省公网流量；
   * 302 重定向模式与文件详情页「渠道源链接」仍用公开访问域名（内网地址外网访客打不开）。
   */
  buildDirectUrl(copy: CopyInfo, channel: ChannelInfo, preferInternal?: boolean): string | null;
}

export class AdapterError extends Error {
  constructor(message: string, public readonly channelType: string) {
    super(`[${channelType}] ${message}`);
  }
}
