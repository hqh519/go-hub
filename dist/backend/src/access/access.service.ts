import { Injectable } from '@nestjs/common';
import { prisma } from '../common/prisma';
import { SysConfigService } from '../settings/sysconfig.service';
import { SettingsService } from '../settings/settings.service';
import { cachedAddress, resolveAddress } from '../common/ip-query';
import { parseUa, refererHostOf } from '../common/ua';
import { appLog } from '../common/app-log';

export interface AccessEntry {
  ip: string;
  path: string;
  referer?: string;
  username?: string;
  ua?: string;
  title?: string;
  method?: string;
  status?: number;
  kind?: 'page' | 'file' | 'api';
}

/** 除 /api、静态资源、S3/WebDAV 协议通道外的路径才算「一次访问」（避免日志被轮询刷爆） */
const IGNORED_PREFIX = /^\/(api|dav|s3|dev|assets|static|_nuxt|@vite|node_modules)(\/|$)/i;
/** 明显是静态资源的扩展名 —— 页面导航不会带这些后缀 */
const STATIC_EXT = /\.(js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|mp4|webm|mp3|json|txt|xml|webmanifest)$/i;

export function shouldRecordPath(path: string): boolean {
  const p = String(path || '');
  if (!p || p === '/favicon.ico') return false;
  if (IGNORED_PREFIX.test(p)) return false;
  if (STATIC_EXT.test(p)) return false;
  return true;
}

/**
 * 访问记录服务（v2.3.0）。
 *
 * 写入有两条路径：
 *   1) 站内 SPA 页面 —— 前端 router.afterEach 调 POST /api/access/visit，
 *      并在离开页面时用 sendBeacon 调 /api/access/stay 回填停留时长；
 *   2) 文件外链 /file/*、/random —— 前端拿不到这些请求，由 main.ts 的中间件直接落库。
 *
 * 两个由后端补齐的派生字段：
 *   prevVisitAt —— 同一 IP（有登录用户时按 IP+用户名）的上一条记录时间；
 *   targetUrl   —— 「跳转链接」。写入新记录时，把「同一 IP + UA 的上一条记录」的
 *                  targetUrl 回填成本次访问的 path（30 分钟内才算一次连续浏览）。
 */
@Injectable()
export class AccessService {
  /** ip|ua → 上一条访问记录的 id / 时间（仅用于回填跳转链接，进程级即可） */
  private lastByClient = new Map<string, { id: string; at: number }>();
  private lastByIp = new Map<string, { id: string; at: number }>();

  constructor(private sysConfig: SysConfigService, private settings: SettingsService) {}

  private clientKey(ip: string, ua: string) {
    return `${ip}|${String(ua || '').slice(0, 120)}`;
  }

  /** 落一条访问记录；返回记录 id（失败返回空串，绝不影响主流程） */
  async record(entry: AccessEntry): Promise<string> {
    try {
      const ip = String(entry.ip || '');
      const ua = String(entry.ua || '').slice(0, 500);
      const info = parseUa(ua);
      const at = Date.now();

      // 上次来访时间：同一 IP 的上一条记录（有登录用户时优先同账户，否则同 IP 任意账户）
      let prevVisitAt: Date | null = null;
      try {
        const prev = await prisma.accessLog.findFirst({
          where: entry.username ? { ip, username: entry.username } : { ip },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        if (prev) prevVisitAt = prev.createdAt;
      } catch {
        /* 查询失败不影响主流程 */
      }

      // 归属地：只读缓存，未命中交给后台异步补
      const addr = await cachedAddress(ip);

      const row = await prisma.accessLog.create({
        data: {
          ip,
          ipLocation: addr,
          refererHost: refererHostOf(entry.referer),
          refererUrl: String(entry.referer || '').slice(0, 1000),
          path: String(entry.path || '').slice(0, 1000),
          title: String(entry.title || '').slice(0, 200),
          username: String(entry.username || '').slice(0, 60),
          ua,
          device: info.device,
          browser: info.browser,
          os: info.os,
          method: String(entry.method || 'GET').toUpperCase(),
          status: Number(entry.status || 200) || 200,
          kind: entry.kind || 'page',
          prevVisitAt,
        },
        select: { id: true },
      });

      // 回填上一条记录的「跳转链接」（同一客户端 30 分钟内的连续访问）
      // 注意：这里 **await** 而不是 fire-and-forget —— 单条主键 update 只要 1~2ms，
      // 但异步化会让「刚访问完 A 再访问 B，立刻查 A 的跳转链接」拿到空值。
      const key = this.clientKey(ip, ua);
      const last = this.lastByClient.get(key);
      if (last && at - last.at < 30 * 60 * 1000 && last.id !== row.id) {
        await prisma.accessLog
          .update({ where: { id: last.id }, data: { targetUrl: String(entry.path || '').slice(0, 1000) } })
          .catch(() => undefined);
      }
      this.lastByClient.set(key, { id: row.id, at });
      if (this.lastByClient.size > 5000) this.lastByClient.clear();
      const lastIp = this.lastByIp.get(ip);
      if (lastIp && at - lastIp.at < 30 * 60 * 1000 && lastIp.id !== row.id && !last?.id) {
        await prisma.accessLog
          .update({ where: { id: lastIp.id }, data: { targetUrl: String(entry.path || '').slice(0, 1000) } })
          .catch(() => undefined);
      }
      this.lastByIp.set(ip, { id: row.id, at });

      // 归属地异步补写（外部请求，最长 6 秒，绝不阻塞响应）
      if (!addr && ip) {
        void this.backfillLocation(row.id, ip);
      }
      return row.id;
    } catch (err) {
      // 访问记录是旁路功能，任何异常都不该冒泡到业务
      /*
       * v3.0.0（R11）：打印 err.name / err.code / stack —— 只打 message 时，
       * 数据库类错误（Prisma P2002/P2022、连接池超时 ECONNRESET 等）
       * 往往只留一句「写入访问记录失败」，排查时完全黑盒。
       */
      const e = err as Error & { code?: string; meta?: unknown };
      console.warn(
        `[access] 写入访问记录失败: ${e?.name || 'Error'}${e?.code ? ` (${e.code})` : ''} ${e?.message || err}`,
        e?.meta ? `meta=${JSON.stringify(e.meta)}` : '',
        `\n${e?.stack || '(无 stack)'}`,
      );
      return '';
    }
  }

  private async backfillLocation(id: string, ip: string) {
    try {
      const address = await resolveAddress(ip, this.sysConfig);
      if (!address) return;
      await prisma.accessLog.update({ where: { id }, data: { ipLocation: address } });
    } catch {
      /* 忽略 */
    }
  }

  /** 回填停留时长（前端 sendBeacon 上报；毫秒） */
  async stay(id: string, stayMs: number): Promise<boolean> {
    const ms = Math.max(0, Math.min(24 * 3600 * 1000, Math.round(Number(stayMs) || 0)));
    if (!id) return false;
    try {
      await prisma.accessLog.update({ where: { id }, data: { stayMs: ms } });
      return true;
    } catch {
      return false;
    }
  }

  /** 最近 N 条（系统状态页的「访问记录」功能块） */
  async recent(take = 20) {
    const rows = await prisma.accessLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(100, take)),
    });
    return rows.map((r) => this.toView(r));
  }

  /** 管理页列表：关键字 + 时间范围 + 分页 */
  async list(q: {
    keyword?: string;
    start?: string;
    end?: string;
    kind?: string;
    page?: string | number;
    pageSize?: string | number;
  }) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.max(1, Math.min(200, Number(q.pageSize) || 30));
    const where: any = {};
    const kw = String(q.keyword || '').trim();
    if (kw) {
      where.OR = [
        { ip: { contains: kw } },
        { username: { contains: kw } },
        { path: { contains: kw } },
        { title: { contains: kw } },
        { refererHost: { contains: kw } },
        { ipLocation: { contains: kw } },
      ];
    }
    if (q.kind && ['page', 'file', 'api'].includes(String(q.kind))) where.kind = String(q.kind);
    const start = String(q.start || '').trim();
    const end = String(q.end || '').trim();
    if (start || end) {
      where.createdAt = {};
      if (start) {
        const d = new Date(start);
        if (!Number.isNaN(d.getTime())) where.createdAt.gte = d;
      }
      if (end) {
        const d = new Date(end);
        if (!Number.isNaN(d.getTime())) {
          // 只给日期（YYYY-MM-DD）时按「当天结束」包含进去
          if (/^\d{4}-\d{2}-\d{2}$/.test(end)) d.setHours(23, 59, 59, 999);
          where.createdAt.lte = d;
        }
      }
    }

    const [total, rows] = await Promise.all([
      prisma.accessLog.count({ where }),
      prisma.accessLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { total, page, pageSize, items: rows.map((r) => this.toView(r)) };
  }

  /** 汇总：供管理页顶部的小卡片（今日访问 / 独立 IP / 独立用户） */
  async summary() {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const [today, ips, users, total] = await Promise.all([
      prisma.accessLog.count({ where: { createdAt: { gte: dayStart } } }),
      prisma.accessLog.findMany({ where: { createdAt: { gte: dayStart } }, select: { ip: true }, distinct: ['ip'] }),
      prisma.accessLog.findMany({
        where: { createdAt: { gte: dayStart }, NOT: { username: '' } },
        select: { username: true },
        distinct: ['username'],
      }),
      prisma.accessLog.count(),
    ]);
    return { today, todayIps: ips.length, todayUsers: users.length, total };
  }

  /** 删除指定记录 */
  async remove(ids: string[]): Promise<number> {
    const list = (ids || []).filter(Boolean);
    if (!list.length) return 0;
    const res = await prisma.accessLog.deleteMany({ where: { id: { in: list } } });
    return res.count;
  }

  /** 清空全部访问记录 */
  async clear(): Promise<number> {
    const res = await prisma.accessLog.deleteMany({});
    return res.count;
  }

  /** 按保留天数清理（默认 90 天；设置项 accessLogRetentionDays，0 = 永久保留） */
  async cleanup(): Promise<number> {
    let days = 90;
    try {
      const raw = await this.settings.get('accessLogRetentionDays', '90');
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) days = Math.floor(n);
    } catch {
      /* 读不到就用默认值 */
    }
    if (days <= 0) return 0;
    const before = new Date(Date.now() - days * 24 * 3600 * 1000);
    const res = await prisma.accessLog.deleteMany({ where: { createdAt: { lt: before } } });
    if (res.count > 0) appLog.info('access', `已清理 ${res.count} 条超过 ${days} 天的访问记录`);
    return res.count;
  }

  private toView(r: any) {
    return {
      id: r.id,
      ip: r.ip,
      ipLocation: r.ipLocation,
      refererHost: r.refererHost,
      refererUrl: r.refererUrl,
      path: r.path,
      targetUrl: r.targetUrl,
      title: r.title,
      stayMs: r.stayMs,
      username: r.username,
      ua: r.ua,
      device: r.device,
      browser: r.browser,
      os: r.os,
      method: r.method,
      status: r.status,
      kind: r.kind,
      prevVisitAt: r.prevVisitAt ? r.prevVisitAt.getTime() : 0,
      createdAt: r.createdAt ? r.createdAt.getTime() : 0,
    };
  }
}
