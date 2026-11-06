import { createHash } from 'crypto';
import { AdapterError, ChannelInfo, CopyInfo, StorageAdapter, UploadResult } from './adapter.interface';
import { ensureProtocol } from '../common/endpoint';
import { buildAssetUrl } from '../common/asset-url';

/**
 * Immich 适配器 —— 按参考 PHP 案例（已跑通）实现：
 *   1. POST /api/assets/bulk-upload-check   去重检查（sha1）
 *   2. POST /api/assets                     multipart 上传 → assetId
 *   3. PUT  /api/albums/:id/assets          加入相册（可选）
 *   4. POST /api/shared-links               创建分享链接 → key
 *
 * 外链：{domain|serverUrl}/api/assets/{assetId}/original?key={shareKey}
 * 删除参数即 assetId（存于 remoteKey，格式 "assetId|shareKey"）。
 *
 * 配置字段：serverUrl / apiKey / albumId(可选) / shareLinkId(可选) / domain(可选)
 *
 * serverUrl 支持内网 IP / Docker 容器名（如 immich:2283、192.168.1.10:2283）：
 * 缺协议时内网自动按 http、公网按 https；API 请求由服务端发起，
 * 图床对外是 https 不影响用内网地址与 Immich 通信。
 *
 * ⚠️ 分享链接必须用 `POST /api/shared-links`（createSharedLink）。
 *    早期实现误用 `POST /api/assets/{id}/share`，Immich 无此路由，必然 404。
 */
export class ImmichAdapter implements StorageAdapter {
  private headers(channel: ChannelInfo): Record<string, string> {
    return { 'x-api-key': channel.config.apiKey, Accept: 'application/json' };
  }

  private api(channel: ChannelInfo, path: string): string {
    return ensureProtocol(channel.config.serverUrl || '').replace(/\/+$/, '') + path;
  }

  /**
   * 对外访问域名（v3.0.0 R14 收紧）：只用「公开访问域名」（domain / publicDomain），
   * 不再回落 serverUrl —— serverUrl 通常是内网地址 / Docker 容器名，
   * 详情页「存储渠道 / 备份渠道」地址绝不能出现内网域名。
   * 两项都未配置时返回空串 → buildDirectUrl 返回 null → 前端回退本站代理地址（本站域名）。
   */
  private linkBase(channel: ChannelInfo): string {
    const base = ensureProtocol(
      channel.config.publicDomain || channel.config.domain || '',
    ).replace(/\/+$/, '');
    return base;
  }

  /** v2.8.7：内网通信域名（preferInternal 时优先，未配置回落对外域名 / 服务地址） */
  private internalLinkBase(channel: ChannelInfo): string {
    const base = ensureProtocol(
      channel.config.internalDomain || channel.config.publicDomain || channel.config.domain || channel.config.serverUrl || '',
    ).replace(/\/+$/, '');
    return base;
  }

  /**
   * v3.0.0（R10）：immich 的固化地址。
   * 路径固定为 `api/assets/<assetId>/original`，分享 key 属于「文件级 query」必须固化 ——
   * 重建分享链接后 key 会变，老文件仍要用当初的 key。
   */
  private pathsOf(assetId: string, shareKey: string): { objectPath: string; urlQuery: string } {
    return {
      objectPath: `api/assets/${assetId}/original`,
      urlQuery: shareKey ? `key=${shareKey}` : '',
    };
  }

  async upload(file: { buffer: Buffer; mime: string; originalName: string }, key: string, channel: ChannelInfo): Promise<UploadResult> {
    const cfg = channel.config;
    if (!cfg.serverUrl || !cfg.apiKey) throw new AdapterError('缺少 serverUrl / apiKey 配置', channel.type);

    try {
      // 步骤 1：去重检查（Immich 接受 sha1-hex 或 sha1-base64；与 PHP 案例一致用 hex）
      const checksum = createHash('sha1').update(file.buffer).digest('hex');
      const checkResp = await fetch(this.api(channel, '/api/assets/bulk-upload-check'), {
        method: 'POST',
        headers: { ...this.headers(channel), 'Content-Type': 'application/json' },
        body: JSON.stringify({ assets: [{ checksum, id: key }] }),
      });
      if (checkResp.ok) {
        const checkJson = (await checkResp.json()) as {
          results?: Array<{ id?: string; assetId?: string; action?: string; reason?: string }>;
        };
        const hit = checkJson.results?.find(
          (r) => r.action === 'reject' && (r.assetId || r.id),
        );
        const dupId = hit?.assetId || hit?.id;
        if (dupId) return this.share(dupId, channel);
      }

      // 步骤 2：multipart 上传
      const now = new Date().toISOString();
      const form = new FormData();
      form.append('assetData', new Blob([new Uint8Array(file.buffer)], { type: file.mime }), file.originalName);
      form.append('deviceAssetId', `${key}-${Date.now()}`);
      form.append('deviceId', 'GoHub');
      form.append('fileCreatedAt', now);
      form.append('fileModifiedAt', now);
      form.append('isFavorite', 'false');
      const upResp = await fetch(this.api(channel, '/api/assets'), {
        method: 'POST',
        headers: this.headers(channel),
        body: form,
      });
      if (!upResp.ok) {
        const detail = await upResp.text().catch(() => '');
        throw new AdapterError(`上传失败: HTTP ${upResp.status} ${detail.slice(0, 200)}`, channel.type);
      }
      const upJson = (await upResp.json()) as
        | { id?: string; status?: string; message?: string }
        | Array<{ id?: string }>;
      const assetId = Array.isArray(upJson) ? upJson[0]?.id : upJson.id;
      if (!assetId) throw new AdapterError('响应中未找到 assetId', channel.type);

      return this.share(assetId, channel);
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      throw new AdapterError(`请求失败: ${(err as Error).message}`, channel.type);
    }
  }

  /** 步骤 3 + 4：入相册（可选）+ 建分享链接，返回 "assetId|shareKey" */
  private async share(assetId: string, channel: ChannelInfo): Promise<UploadResult> {
    const cfg = channel.config;
    if (cfg.albumId) {
      const albumResp = await fetch(this.api(channel, `/api/albums/${encodeURIComponent(cfg.albumId)}/assets`), {
        method: 'PUT',
        headers: { ...this.headers(channel), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [assetId] }),
      }).catch(() => undefined); // 入相册失败不阻断
      if (albumResp && !albumResp.ok) {
        console.warn(`[immich] 加入相册失败 HTTP ${albumResp.status}（不阻断上传）`);
      }
    }

    // 已配置「相册共享链接 ID/Key」时直接复用，不再创建单张分享链接
    const fixedKey = (cfg.shareLinkId || '').trim();
    if (fixedKey) {
      return {
        remoteKey: `${assetId}|${fixedKey}`,
        ...this.pathsOf(assetId, fixedKey),
        metas: { assetId, shareKey: fixedKey, albumId: cfg.albumId || '' },
      };
    }

    // ⚠️ 正确路由：POST /api/shared-links（createSharedLink）
    const shareResp = await fetch(this.api(channel, '/api/shared-links'), {
      method: 'POST',
      headers: { ...this.headers(channel), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'INDIVIDUAL',
        assetIds: [assetId],
        allowDownload: true,
        allowUpload: false,
        showMetadata: true,
      }),
    });
    if (!shareResp.ok) {
      const detail = await shareResp.text().catch(() => '');
      throw new AdapterError(
        `创建分享链接失败: HTTP ${shareResp.status} ${detail.slice(0, 200)}（请确认 Immich 版本支持 /api/shared-links）`,
        channel.type,
      );
    }
    const shareJson = (await shareResp.json()) as { key?: string; slug?: string };
    const shareKey = shareJson.key || shareJson.slug;
    if (!shareKey) throw new AdapterError('分享响应中未找到 key/slug', channel.type);
    return {
      remoteKey: `${assetId}|${shareKey}`,
      ...this.pathsOf(assetId, shareKey),
      metas: { assetId, shareKey, albumId: cfg.albumId || '' },
    };
  }

  async delete(copy: CopyInfo, channel: ChannelInfo): Promise<void> {
    const assetId = copy.remoteKey.split('|')[0];
    const resp = await fetch(this.api(channel, '/api/assets'), {
      method: 'DELETE',
      headers: { ...this.headers(channel), 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true, ids: [assetId] }),
    });
    if (!resp.ok) throw new AdapterError(`删除失败: HTTP ${resp.status}`, channel.type);
  }

  buildDirectUrl(copy: CopyInfo, channel: ChannelInfo, preferInternal?: boolean): string | null {
    const base = preferInternal ? this.internalLinkBase(channel) : this.linkBase(channel);
    if (!base) return null;
    /*
     * v3.0.0（R10）：新数据「动态域名 + 固化地址」——
     * 域名永远跟随渠道配置（改域名立即生效），assetId 与 shareKey 固化在 objectPath/urlQuery 里。
     */
    if (copy.objectPath) {
      return buildAssetUrl({ base, objectPath: copy.objectPath, urlQuery: copy.urlQuery });
    }
    /*
     * v3.0.0：防御「登记文件」的 remoteKey —— 登记侧存的是源地址完整路径
     * （如 api/assets/<id>/thumbnail?key=...），不含 "|" 分隔符。
     * 之前会把整段路径当 assetId 拼出 /api/assets/api/assets/.../original 的错误直链；
     * 现在识别为路径时按「域名 + 原样路径」拼接（查询串原样保留）。
     */
    if (copy.remoteKey.includes('/')) {
      return `${base.replace(/\/+$/, '')}/${copy.remoteKey.replace(/^\/+/, '')}`;
    }
    const [assetId, shareKey] = copy.remoteKey.split('|');
    if (!assetId) return null;
    // 无分享 key 时退化为原始资源地址（Immich 需登录，仅作兜底）
    if (!shareKey) return `${base}/api/assets/${assetId}/original`;
    return `${base}/api/assets/${assetId}/original?key=${shareKey}`;
  }
}
