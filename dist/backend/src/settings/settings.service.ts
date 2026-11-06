import { primeSignOrigin } from '../common/request-origin';
import { Injectable } from '@nestjs/common';
import { prisma } from '../common/prisma';

/** 全局设置服务：settings 表 key-value，带内存缓存 */
@Injectable()
export class SettingsService {
  private cache = new Map<string, string>();

  async get(key: string, fallback = ''): Promise<string> {
    if (this.cache.has(key)) return this.cache.get(key)!;
    const row = await prisma.setting.findUnique({ where: { key } });
    const v = row?.value ?? fallback;
    this.cache.set(key, v);
    return v;
  }

  async getJson<T>(key: string, fallback: T): Promise<T> {
    const raw = await this.get(key, '');
    if (!raw) return fallback;
    try {
      return { ...fallback, ...JSON.parse(raw) };
    } catch {
      return fallback;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    this.cache.set(key, value);
  }

  async setJson(key: string, obj: unknown): Promise<void> {
    await this.set(key, JSON.stringify(obj));
  }

  /** 服务器域名：外链签发的基准；未设置时由调用方回退请求 Host */
  async getServerDomain(): Promise<string> {
    const v = (await this.get('serverDomain', '')).replace(/\/+$/, '');
    // v3.0.0（R10）：顺带刷新「外链访问域名」内存缓存，供同步签发点使用
    primeSignOrigin(v);
    return v;
  }

  /**
   * 自定义访问域名（系统设置 → 上传设置）。
   * 一旦设置，全站生成的文件外链统一使用它（例：https://cdn.example.com/file/xxx.png）；
   * 未设置时回退当前访问域名。变更后所有文件的外链前缀立即跟随变动
   * —— 因为外链是「每次序列化时按当前配置实时拼接」，不落库、无快照。
   */
  async getCustomDomain(): Promise<string> {
    return (await this.get('customDomain', '')).trim().replace(/\/+$/, '');
  }

  /** 外链前缀：自定义访问域名优先，其次「默认URL前缀」(page.urlPrefix)，最后回退请求 Host */
  async getLinkPrefix(fallbackOrigin: string): Promise<string> {
    const custom = await this.getCustomDomain();
    if (custom) return `${custom}/file/`;
    const prefix = (await this.get('urlPrefix', '')).trim();
    if (prefix) return prefix.endsWith('/') ? prefix : `${prefix}/`;
    return `${fallbackOrigin.replace(/\/+$/, '')}/file/`;
  }

  /** 当前访问渠道：main | backup */
  async getAccessChannel(): Promise<'main' | 'backup'> {
    const v = await this.get('accessChannel', 'main');
    return v === 'backup' ? 'backup' : 'main';
  }

  /**
   * 外链分发模式：
   *   proxy    —— 代理模式（默认）：服务端拉取上游字节并转发，外链地址恒定不变
   *   redirect —— 302 重定向模式：由客户端直接访问上游地址
   */
  async getLinkMode(): Promise<'proxy' | 'redirect'> {
    const v = await this.get('linkMode', 'proxy');
    return v === 'redirect' ? 'redirect' : 'proxy';
  }
}
