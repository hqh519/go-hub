"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccessService = void 0;
exports.shouldRecordPath = shouldRecordPath;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const settings_service_1 = require("../settings/settings.service");
const ip_query_1 = require("../common/ip-query");
const ua_1 = require("../common/ua");
const app_log_1 = require("../common/app-log");
const IGNORED_PREFIX = /^\/(api|dav|s3|dev|assets|static|_nuxt|@vite|node_modules)(\/|$)/i;
const STATIC_EXT = /\.(js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|mp4|webm|mp3|json|txt|xml|webmanifest)$/i;
function shouldRecordPath(path) {
    const p = String(path || '');
    if (!p || p === '/favicon.ico')
        return false;
    if (IGNORED_PREFIX.test(p))
        return false;
    if (STATIC_EXT.test(p))
        return false;
    return true;
}
let AccessService = class AccessService {
    sysConfig;
    settings;
    lastByClient = new Map();
    lastByIp = new Map();
    constructor(sysConfig, settings) {
        this.sysConfig = sysConfig;
        this.settings = settings;
    }
    clientKey(ip, ua) {
        return `${ip}|${String(ua || '').slice(0, 120)}`;
    }
    async record(entry) {
        try {
            const ip = String(entry.ip || '');
            const ua = String(entry.ua || '').slice(0, 500);
            const info = (0, ua_1.parseUa)(ua);
            const at = Date.now();
            let prevVisitAt = null;
            try {
                const prev = await prisma_1.prisma.accessLog.findFirst({
                    where: entry.username ? { ip, username: entry.username } : { ip },
                    orderBy: { createdAt: 'desc' },
                    select: { createdAt: true },
                });
                if (prev)
                    prevVisitAt = prev.createdAt;
            }
            catch {
            }
            const addr = await (0, ip_query_1.cachedAddress)(ip);
            const row = await prisma_1.prisma.accessLog.create({
                data: {
                    ip,
                    ipLocation: addr,
                    refererHost: (0, ua_1.refererHostOf)(entry.referer),
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
            const key = this.clientKey(ip, ua);
            const last = this.lastByClient.get(key);
            if (last && at - last.at < 30 * 60 * 1000 && last.id !== row.id) {
                await prisma_1.prisma.accessLog
                    .update({ where: { id: last.id }, data: { targetUrl: String(entry.path || '').slice(0, 1000) } })
                    .catch(() => undefined);
            }
            this.lastByClient.set(key, { id: row.id, at });
            if (this.lastByClient.size > 5000)
                this.lastByClient.clear();
            const lastIp = this.lastByIp.get(ip);
            if (lastIp && at - lastIp.at < 30 * 60 * 1000 && lastIp.id !== row.id && !last?.id) {
                await prisma_1.prisma.accessLog
                    .update({ where: { id: lastIp.id }, data: { targetUrl: String(entry.path || '').slice(0, 1000) } })
                    .catch(() => undefined);
            }
            this.lastByIp.set(ip, { id: row.id, at });
            if (!addr && ip) {
                void this.backfillLocation(row.id, ip);
            }
            return row.id;
        }
        catch (err) {
            const e = err;
            console.warn(`[access] 写入访问记录失败: ${e?.name || 'Error'}${e?.code ? ` (${e.code})` : ''} ${e?.message || err}`, e?.meta ? `meta=${JSON.stringify(e.meta)}` : '', `\n${e?.stack || '(无 stack)'}`);
            return '';
        }
    }
    async backfillLocation(id, ip) {
        try {
            const address = await (0, ip_query_1.resolveAddress)(ip, this.sysConfig);
            if (!address)
                return;
            await prisma_1.prisma.accessLog.update({ where: { id }, data: { ipLocation: address } });
        }
        catch {
        }
    }
    async stay(id, stayMs) {
        const ms = Math.max(0, Math.min(24 * 3600 * 1000, Math.round(Number(stayMs) || 0)));
        if (!id)
            return false;
        try {
            await prisma_1.prisma.accessLog.update({ where: { id }, data: { stayMs: ms } });
            return true;
        }
        catch {
            return false;
        }
    }
    async recent(take = 20) {
        const rows = await prisma_1.prisma.accessLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: Math.max(1, Math.min(100, take)),
        });
        return rows.map((r) => this.toView(r));
    }
    async list(q) {
        const page = Math.max(1, Number(q.page) || 1);
        const pageSize = Math.max(1, Math.min(200, Number(q.pageSize) || 30));
        const where = {};
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
        if (q.kind && ['page', 'file', 'api'].includes(String(q.kind)))
            where.kind = String(q.kind);
        const start = String(q.start || '').trim();
        const end = String(q.end || '').trim();
        if (start || end) {
            where.createdAt = {};
            if (start) {
                const d = new Date(start);
                if (!Number.isNaN(d.getTime()))
                    where.createdAt.gte = d;
            }
            if (end) {
                const d = new Date(end);
                if (!Number.isNaN(d.getTime())) {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(end))
                        d.setHours(23, 59, 59, 999);
                    where.createdAt.lte = d;
                }
            }
        }
        const [total, rows] = await Promise.all([
            prisma_1.prisma.accessLog.count({ where }),
            prisma_1.prisma.accessLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        ]);
        return { total, page, pageSize, items: rows.map((r) => this.toView(r)) };
    }
    async summary() {
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const [today, ips, users, total] = await Promise.all([
            prisma_1.prisma.accessLog.count({ where: { createdAt: { gte: dayStart } } }),
            prisma_1.prisma.accessLog.findMany({ where: { createdAt: { gte: dayStart } }, select: { ip: true }, distinct: ['ip'] }),
            prisma_1.prisma.accessLog.findMany({
                where: { createdAt: { gte: dayStart }, NOT: { username: '' } },
                select: { username: true },
                distinct: ['username'],
            }),
            prisma_1.prisma.accessLog.count(),
        ]);
        return { today, todayIps: ips.length, todayUsers: users.length, total };
    }
    async remove(ids) {
        const list = (ids || []).filter(Boolean);
        if (!list.length)
            return 0;
        const res = await prisma_1.prisma.accessLog.deleteMany({ where: { id: { in: list } } });
        return res.count;
    }
    async clear() {
        const res = await prisma_1.prisma.accessLog.deleteMany({});
        return res.count;
    }
    async cleanup() {
        let days = 90;
        try {
            const raw = await this.settings.get('accessLogRetentionDays', '90');
            const n = Number(raw);
            if (Number.isFinite(n) && n >= 0)
                days = Math.floor(n);
        }
        catch {
        }
        if (days <= 0)
            return 0;
        const before = new Date(Date.now() - days * 24 * 3600 * 1000);
        const res = await prisma_1.prisma.accessLog.deleteMany({ where: { createdAt: { lt: before } } });
        if (res.count > 0)
            app_log_1.appLog.info('access', `已清理 ${res.count} 条超过 ${days} 天的访问记录`);
        return res.count;
    }
    toView(r) {
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
};
exports.AccessService = AccessService;
exports.AccessService = AccessService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [sysconfig_service_1.SysConfigService, settings_service_1.SettingsService])
], AccessService);
