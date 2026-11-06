import type { NextFunction, Request, Response } from 'express';

/**
 * 轻量级固定窗口限流（单实例内存计数）。
 *
 * 设计取舍：
 *  - 不引入 @nestjs/throttler 等重依赖，纯内存实现，零额外依赖、零配置即可生效；
 *  - 单实例 SQLite 部署形态下内存计数完全够用；多实例横向扩容时应换成 Redis 计数
 *    （把 buckets 换成一个带 TTL 的 Redis INCR/EXPIRE 即可，接口不变）；
 *  - 「固定窗口」而非「滑动窗口」：实现简单、内存占用恒定，边界处最多放行 2 倍流量，
 *    对图床这类场景足够；确实需要严格的场景可换令牌桶。
 *
 * 分档策略（按路径 + 方法）：
 *  - 登录接口  : 严防爆破，阈值低
 *  - 上传接口  : 防批量灌图
 *  - 随机图 API: 通常被前端页面/壁纸脚本频繁调用，阈值中等
 *  - 图片直链  : 一个页面可能同时拉几十张图，阈值高（主要靠 Cache-Control 降低回源）
 *  - 其余 API  : 通用兜底
 *  - 静态资源  : 前端 JS/CSS/字体等构建产物，一律豁免（否则首屏就会误伤）
 *
 * 本地回环地址（127.0.0.1）阈值放宽 RL_LOOPBACK_FACTOR 倍，避免本机联调时被自己限流。
 */

interface Rule {
  name: string;
  /** 返回 true 表示该请求归入本条规则 */
  test: (path: string, method: string) => boolean;
  limit: number;
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** 静态资源扩展名：构建产物、字体、地图等，一律不限流 */
const STATIC_EXT = /\.(js|mjs|css|map|woff2?|ttf|otf|eot|svg|ico|png|jpe?g|gif|webp|avif|txt|webmanifest)$/i;

function envInt(key: string, def: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

function buildRules(): Rule[] {
  const login = envInt('RL_LOGIN_PER_MIN', 10);
  const upload = envInt('RL_UPLOAD_PER_MIN', 60);
  const file = envInt('RL_FILE_PER_MIN', 1200);
  const random = envInt('RL_RANDOM_PER_MIN', 300);
  const api = envInt('RL_API_PER_MIN', 300);
  const MIN = 60_000;

  return [
    // 登录：仅限制提交动作，sessionCheck / logout 不受影响
    {
      name: 'auth',
      test: (p, m) => p.startsWith('/api/auth/') && m === 'POST',
      limit: login,
      windowMs: MIN,
    },
    // 上传：常规 + 分块，全部计入
    { name: 'upload', test: (p) => p === '/upload' || p.startsWith('/upload/') || p === '/api/fetchRes', limit: upload, windowMs: MIN },
    // 随机图 API
    { name: 'random', test: (p) => p.startsWith('/api/random'), limit: random, windowMs: MIN },
    // 图片/文件直链（代理回源）
    { name: 'file', test: (p) => p.startsWith('/file/'), limit: file, windowMs: MIN },
    // 其余 API 兜底
    { name: 'api', test: (p) => p.startsWith('/api/'), limit: api, windowMs: MIN },
  ];
}

function clientIp(req: Request): string {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  const ip = fwd || req.socket?.remoteAddress || '';
  return ip.replace(/^::ffff:/, '');
}

export function rateLimiter() {
  if (String(process.env.RL_ENABLED || 'true').toLowerCase() === 'false') {
    // 显式关闭：返回直通中间件，避免调用方再判断
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const rules = buildRules();
  const buckets = new Map<string, Bucket>();
  const factor = envInt('RL_LOOPBACK_FACTOR', 20);

  // 惰性清理：最多每 30 秒扫描一次，删除已过期条目，防止 Map 无限增长
  let lastSweep = Date.now();
  const sweep = (now: number) => {
    if (now - lastSweep < 30_000) return;
    lastSweep = now;
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const path = req.path || '';
    // 静态资源与生产前端产物豁免（首屏会瞬间产生几十个请求）
    if (STATIC_EXT.test(path) || path.startsWith('/assets/')) return next();

    const rule = rules.find((r) => r.test(path, req.method));
    if (!rule) return next();

    const ip = clientIp(req) || 'unknown';
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
    const limit = isLoopback ? rule.limit * factor : rule.limit;

    const key = `${rule.name}:${ip}`;
    const now = Date.now();
    sweep(now);

    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + rule.windowMs };
      buckets.set(key, b);
    }
    b.count += 1;

    const remaining = Math.max(0, limit - b.count);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)));

    if (b.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        message: `请求过于频繁，请 ${retryAfter} 秒后重试`,
        code: 'RATE_LIMITED',
      });
    }
    return next();
  };
}
