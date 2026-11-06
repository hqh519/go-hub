"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimiter = rateLimiter;
const STATIC_EXT = /\.(js|mjs|css|map|woff2?|ttf|otf|eot|svg|ico|png|jpe?g|gif|webp|avif|txt|webmanifest)$/i;
function envInt(key, def) {
    const v = Number(process.env[key]);
    return Number.isFinite(v) && v > 0 ? v : def;
}
function buildRules() {
    const login = envInt('RL_LOGIN_PER_MIN', 10);
    const upload = envInt('RL_UPLOAD_PER_MIN', 60);
    const file = envInt('RL_FILE_PER_MIN', 1200);
    const random = envInt('RL_RANDOM_PER_MIN', 300);
    const api = envInt('RL_API_PER_MIN', 300);
    const MIN = 60_000;
    return [
        {
            name: 'auth',
            test: (p, m) => p.startsWith('/api/auth/') && m === 'POST',
            limit: login,
            windowMs: MIN,
        },
        { name: 'upload', test: (p) => p === '/upload' || p.startsWith('/upload/') || p === '/api/fetchRes', limit: upload, windowMs: MIN },
        { name: 'random', test: (p) => p.startsWith('/api/random'), limit: random, windowMs: MIN },
        { name: 'file', test: (p) => p.startsWith('/file/'), limit: file, windowMs: MIN },
        { name: 'api', test: (p) => p.startsWith('/api/'), limit: api, windowMs: MIN },
    ];
}
function clientIp(req) {
    const fwd = req.headers['x-forwarded-for']?.split(',')[0]?.trim();
    const ip = fwd || req.socket?.remoteAddress || '';
    return ip.replace(/^::ffff:/, '');
}
function rateLimiter() {
    if (String(process.env.RL_ENABLED || 'true').toLowerCase() === 'false') {
        return (_req, _res, next) => next();
    }
    const rules = buildRules();
    const buckets = new Map();
    const factor = envInt('RL_LOOPBACK_FACTOR', 20);
    let lastSweep = Date.now();
    const sweep = (now) => {
        if (now - lastSweep < 30_000)
            return;
        lastSweep = now;
        for (const [k, b] of buckets)
            if (b.resetAt <= now)
                buckets.delete(k);
    };
    return (req, res, next) => {
        const path = req.path || '';
        if (STATIC_EXT.test(path) || path.startsWith('/assets/'))
            return next();
        const rule = rules.find((r) => r.test(path, req.method));
        if (!rule)
            return next();
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
