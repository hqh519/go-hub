import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { AdapterError, ChannelInfo, CopyInfo, StorageAdapter, UploadResult } from './adapter.interface';
import { ensureProtocol } from '../common/endpoint';
import { buildAssetUrl } from '../common/asset-url';

/**
 * WebDAV 适配器 —— 接入他人的 WebDAV 网盘当存储（PUT/DELETE/MKCOL）。
 * 注意：这是「WebDAV 作为存储渠道」，与"对外提供 WebDAV 服务"（已砍掉）无关。
 *
 * 配置字段：baseUri / username / password / publicDomain(可选) / directory(可选)
 *
 * baseUri 支持内网 IP / Docker 容器名（如 nas.local:5005/dav、webdav:80/dav）：
 * 缺协议时内网自动按 http、公网按 https；请求由服务端发起，
 * 因此图床自身对外是 https 也能正常用内网地址上传。
 */
export class WebdavAdapter implements StorageAdapter {
  private authHeader(channel: ChannelInfo): string {
    const { username, password } = channel.config;
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  /** 规范化后的 baseUri（已补协议、已去尾斜杠） */
  private baseOf(channel: ChannelInfo): string {
    return ensureProtocol(channel.config.baseUri || '').replace(/\/+$/, '');
  }

  private fullPath(key: string, channel: ChannelInfo): string {
    const base = this.baseOf(channel);
    const dir = (channel.config.directory || '').replace(/^\/+|\/+$/g, '');
    return `${base}/${dir ? dir + '/' : ''}${key}`;
  }

  /**
   * v3.0.0（R10）：固化地址 = `<存储目录>/<对象键>`（不含域名）。
   * 存储目录在 UI 上已与「自定义存储前缀」合并展示，但落盘路径语义不变，
   * 老数据的 remoteKey 不动，因此存量文件不会失效。
   */
  private objectPathOf(key: string, channel: ChannelInfo): string {
    const dir = (channel.config.directory || '').replace(/^\/+|\/+$/g, '');
    const k = String(key || '').replace(/^\/+/, '');
    return dir ? `${dir}/${k}` : k;
  }

  /** 逐级 MKCOL 建目录（PUT 对不存在的父目录会 409） */
  private async ensureKeyDirs(key: string, channel: ChannelInfo): Promise<void> {
    const base = this.baseOf(channel);
    const dir = (channel.config.directory || '').replace(/^\/+|\/+$/g, '');
    const keyDir = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '';
    const fullDir = [dir, keyDir].filter(Boolean).join('/');
    if (!fullDir) return;
    const parts = fullDir.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      const p = `${base}/${parts.slice(0, i).join('/')}`;
      try {
        const r = await fetch(p, { method: 'MKCOL', headers: { Authorization: this.authHeader(channel) } });
        if (!r.ok && r.status !== 405 && r.status !== 301) { /* 已存在等情况忽略 */ }
      } catch { /* 忽略 */ }
    }
  }

  async upload(file: { buffer: Buffer; mime: string; originalName: string }, key: string, channel: ChannelInfo): Promise<UploadResult> {
    if (!channel.config.baseUri) throw new AdapterError('缺少 baseUri 配置', channel.type);
    const url = this.fullPath(key, channel);
    await this.ensureKeyDirs(key, channel);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const resp = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: this.authHeader(channel), 'Content-Type': file.mime },
        body: new Uint8Array(file.buffer),
        signal: ctrl.signal,
      });
      if (!resp.ok) throw new AdapterError(`WebDAV PUT 失败: HTTP ${resp.status}`, channel.type);
      return { remoteKey: key, objectPath: this.objectPathOf(key, channel) };
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      throw new AdapterError(`WebDAV 请求失败: ${(err as Error).message}`, channel.type);
    } finally {
      clearTimeout(timer);
    }
  }

  /** v2.8.3：大文件流式 PUT（不再把整份文件读进内存） */
  async uploadFile(
    path: string,
    size: number,
    file: { mime: string; originalName: string },
    key: string,
    channel: ChannelInfo,
  ): Promise<UploadResult> {
    if (!channel.config.baseUri) throw new AdapterError('缺少 baseUri 配置', channel.type);
    const url = this.fullPath(key, channel);
    await this.ensureKeyDirs(key, channel);
    const ctrl = new AbortController();
    // 500MB 在慢速网盘上可能超过 10 分钟，给足 30 分钟
    const timer = setTimeout(() => ctrl.abort(), 30 * 60 * 1000);
    try {
      const resp = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: this.authHeader(channel),
          'Content-Type': file.mime,
          'Content-Length': String(size),
        },
        body: Readable.toWeb(createReadStream(path)) as unknown as BodyInit,
        duplex: 'half',
        signal: ctrl.signal,
      } as RequestInit);
      if (!resp.ok) throw new AdapterError(`WebDAV PUT 失败: HTTP ${resp.status}`, channel.type);
      return { remoteKey: key, objectPath: this.objectPathOf(key, channel) };
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      throw new AdapterError(`WebDAV 请求失败: ${(err as Error).message}`, channel.type);
    } finally {
      clearTimeout(timer);
    }
  }

  async delete(copy: CopyInfo, channel: ChannelInfo): Promise<void> {
    const resp = await fetch(this.fullPath(copy.remoteKey, channel), {
      method: 'DELETE',
      headers: { Authorization: this.authHeader(channel) },
    });
    if (!resp.ok && resp.status !== 404) {
      throw new AdapterError(`WebDAV DELETE 失败: HTTP ${resp.status}`, channel.type);
    }
  }

  buildDirectUrl(copy: CopyInfo, channel: ChannelInfo, preferInternal?: boolean): string | null {
    // v2.8.7：preferInternal 时优先「内网通信域名」，其次公开域名，否则就是 WebDAV 自身地址
    const domainRaw = (preferInternal && channel.config.internalDomain) || channel.config.publicDomain;
    /*
     * v3.0.0（R10）：新数据「动态域名 + 固化地址」——
     * 改域名/内网地址立即生效；改为存储目录或前缀不影响已落库文件。
     */
    if (copy.objectPath) {
      const base = domainRaw
        ? ensureProtocol(domainRaw).replace(/\/+$/, '')
        : this.baseOf(channel);
      if (!base) return null;
      return buildAssetUrl({ base, objectPath: copy.objectPath, urlQuery: copy.urlQuery });
    }
    if (domainRaw) {
      // 同样支持不写协议的内网地址（如 nas.local:5005）
      const domain = ensureProtocol(domainRaw).replace(/\/+$/, '');
      const dir = (channel.config.directory || '').replace(/^\/+|\/+$/g, '');
      return `${domain}/${dir ? dir + '/' : ''}${copy.remoteKey}`;
    }
    return this.fullPath(copy.remoteKey, channel);
  }
}
