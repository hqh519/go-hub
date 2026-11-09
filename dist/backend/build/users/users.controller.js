"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AvatarController = exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const fs_1 = require("fs");
const path_1 = require("path");
const prisma_1 = require("../common/prisma");
const file_view_1 = require("../common/file-view");
const crypto_service_1 = require("../common/crypto.service");
const project_paths_1 = require("../common/project-paths");
const totp_1 = require("../common/totp");
const recovery_1 = require("../common/recovery");
const mail_service_1 = require("../mail/mail.service");
const auth_controller_1 = require("../auth/auth.controller");
const channel_access_1 = require("../common/channel-access");
const app_log_1 = require("../common/app-log");
const auth_guard_1 = require("../auth/auth.guard");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const settings_service_1 = require("../settings/settings.service");
const ip_query_1 = require("../common/ip-query");
const DEFAULT_SESSION_DAYS = 7;
const AVATAR_SIZE = 256;
const NOTICE_KEY = 'userNotice';
let UsersController = class UsersController {
    sysConfig;
    settings;
    mail;
    constructor(sysConfig, settings, mail) {
        this.sysConfig = sysConfig;
        this.settings = settings;
        this.mail = mail;
    }
    isAdmin(req) {
        return (0, auth_guard_1.isAdminRole)((0, auth_guard_1.currentSession)(req)?.role);
    }
    me(req) {
        return (0, auth_guard_1.currentSession)(req)?.user || '';
    }
    async adminUsername() {
        try {
            const admin = await prisma_1.prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
            if (admin?.username)
                return admin.username;
        }
        catch {
        }
        return (process.env.ADMIN_USER || '').trim() || (process.env.SUPER_ADMIN_USERNAME || '').trim() || 'admin';
    }
    async readAdminProfile() {
        try {
            const raw = await this.sysConfig.get('adminProfile');
            return raw && typeof raw === 'object' ? raw : {};
        }
        catch {
            return {};
        }
    }
    async channelLabelMap() {
        const channels = await prisma_1.prisma.channel.findMany({ select: { id: true, name: true, code: true } });
        const m = new Map();
        for (const c of channels) {
            const label = c.code ? `${c.code} · ${c.name}` : c.name;
            m.set(c.id, label);
            if (c.code)
                m.set(c.code, label);
        }
        return m;
    }
    async readNotice() {
        return (await this.settings.get(NOTICE_KEY, '')) || '';
    }
    async authorizedChannelIds(username) {
        const out = new Set();
        const rows = await prisma_1.prisma.channel.findMany({
            select: { id: true, code: true, type: true, authorizedUsers: true },
        });
        let isAdmin = false;
        try {
            const me = await prisma_1.prisma.user.findUnique({ where: { username }, select: { role: true } });
            isAdmin = me?.role === 'admin';
        }
        catch {
            isAdmin = false;
        }
        for (const c of rows) {
            const ok = (0, channel_access_1.channelVisibleTo)(c.authorizedUsers, c.type, username, isAdmin);
            if (!ok)
                continue;
            out.add(c.id);
            if (c.code)
                out.add(c.code);
        }
        return out;
    }
    async list(req) {
        const users = await prisma_1.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
        const cName = await this.channelLabelMap();
        const rows = users.map((u) => ({
            id: u.id,
            username: u.username,
            nickname: u.nickname,
            email: u.email || '',
            avatar: u.avatar || '',
            role: u.role,
            enabled: u.enabled,
            canEdit: u.canEdit,
            canDelete: u.canDelete,
            linkEnabled: u.linkEnabled,
            shareEnabled: u.role === 'admin' || u.role === 'super' ? true : !!u.shareEnabled,
            enforceLimits: u.enforceLimits,
            transcodePolicy: u.transcodePolicy || 'inherit',
            maxFileSizeMB: Number(u.maxFileSizeMB) || 0,
            mainChannelId: u.mainChannelId,
            backupChannelId: u.backupChannelId,
            mainChannelName: cName.get(u.mainChannelId) || '',
            backupChannelName: cName.get(u.backupChannelId) || '',
            totpEnabled: u.totpEnabled,
            emailVerified: u.emailVerified,
            recoveryCount: (0, recovery_1.countRecoveryCodes)(u.recoveryHashes),
            frontSessionDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
            backSessionDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
            adminNote: u.adminNote || '',
            createdAt: u.createdAt,
        }));
        if (!this.isAdmin(req)) {
            const me = this.me(req);
            return rows
                .filter((r) => r.username === me)
                .map(({ adminNote: _omit, ...rest }) => rest);
        }
        const adminUser = await this.adminUsername();
        if (!rows.some((r) => r.role === 'admin')) {
            const prof = await this.readAdminProfile();
            const mainId = String(prof.mainChannelId || '');
            const backupId = String(prof.backupChannelId || '');
            rows.unshift({
                id: `__admin__${adminUser}`,
                username: adminUser,
                nickname: String(prof.nickname || '管理员'),
                email: String(prof.email || ''),
                avatar: '',
                role: 'admin',
                enabled: true,
                canEdit: true,
                canDelete: true,
                linkEnabled: true,
                shareEnabled: true,
                enforceLimits: prof.enforceLimits !== false,
                transcodePolicy: String(prof.transcodePolicy || 'inherit'),
                maxFileSizeMB: Number(prof.maxFileSizeMB) || 0,
                mainChannelId: mainId,
                backupChannelId: backupId,
                mainChannelName: cName.get(mainId) || '',
                backupChannelName: cName.get(backupId) || '',
                totpEnabled: false,
                frontSessionDays: DEFAULT_SESSION_DAYS,
                backSessionDays: DEFAULT_SESSION_DAYS,
                adminNote: String(prof.adminNote || ''),
                createdAt: null,
                builtin: true,
            });
        }
        return rows;
    }
    async options(req) {
        if (!this.isAdmin(req)) {
            const me = this.me(req);
            return me ? [{ username: me, nickname: me }] : [];
        }
        const users = await prisma_1.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
        return users.map((u) => ({
            username: u.username,
            nickname: u.nickname || u.username,
            avatar: u.avatar || '',
            role: u.role,
            createdAt: u.createdAt,
        }));
    }
    async getNotice(req) {
        if (!(0, auth_guard_1.currentSession)(req))
            return { success: false, message: '未登录' };
        return { success: true, data: { content: await this.readNotice() } };
    }
    async saveNotice(req, body) {
        if (!this.isAdmin(req))
            return { success: false, message: '没有权限发布公告' };
        const content = String(body.content ?? '').slice(0, 20000);
        await this.settings.set(NOTICE_KEY, content);
        return { success: true, data: { content } };
    }
    async collect(req, mode) {
        const admin = this.isAdmin(req);
        const me = this.me(req);
        const byIp = admin && mode === 'ip';
        const files = await prisma_1.prisma.fileRecord.findMany({
            where: { status: 'active', ...(admin ? {} : { uploader: me || '' }) },
            select: {
                uploader: true, ip: true, size: true, createdAt: true, metas: true,
                uploadSource: true,
            },
        });
        const buckets = new Map();
        for (const f of files) {
            const key = (byIp ? f.ip : f.uploader) || (byIp ? '(未知IP)' : '(匿名)');
            const b = buckets.get(key) || { key, count: 0, size: 0, lastAt: 0, sources: new Set() };
            b.count += 1;
            b.size += f.size || 0;
            b.lastAt = Math.max(b.lastAt, f.createdAt.getTime());
            b.sources.add((0, file_view_1.normalizeUploadSource)(f.uploadSource));
            if (byIp && !b.address) {
                try {
                    b.address = JSON.parse(f.metas || '{}').UploadAddress || '';
                }
                catch {
                }
            }
            buckets.set(key, b);
        }
        if (byIp) {
            const ips = Array.from(buckets.keys());
            const records = await prisma_1.prisma.ipRecord.findMany({ where: { ip: { in: ips } } });
            for (const r of records) {
                const b = buckets.get(r.ip);
                if (b)
                    b.address = [r.country, r.region, r.city].filter(Boolean).join(' ') || b.address;
            }
            try {
                const fallback = new Map();
                for (const [k, b] of buckets)
                    if (byIp)
                        fallback.set(k, b.address || '');
                const displays = await (0, ip_query_1.ipDisplayBatch)(ips, fallback, this.sysConfig);
                for (const [k, b] of buckets) {
                    const d = displays.get(k);
                    if (d)
                        b.display = d;
                }
            }
            catch {
            }
        }
        const items = Array.from(buckets.values())
            .map(({ sources, ...b }) => ({
            ...b,
            uploadSources: Array.from(sources).sort(),
        }))
            .sort((a, b) => b.count - a.count);
        return { mode: byIp ? 'ip' : 'user', items };
    }
    async checkUsername(username, selfId) {
        if (!username)
            return '用户名不能为空';
        if (!/^[A-Za-z0-9_.@-]{2,32}$/.test(username)) {
            return '用户名仅支持字母/数字/_ . @ - ，长度 2-32';
        }
        const dup = await prisma_1.prisma.user.findFirst({
            where: { username, ...(selfId ? { NOT: { id: selfId } } : {}) },
        });
        if (dup)
            return `用户名「${username}」已存在`;
        return null;
    }
    async detail(req, id) {
        const admin = this.isAdmin(req);
        if (id.startsWith('__admin__')) {
            if (!admin)
                return { success: false, message: '没有权限查看该账户' };
            const name = id.replace('__admin__', '');
            const prof = await this.readAdminProfile();
            return {
                success: true,
                data: {
                    id,
                    username: name,
                    nickname: String(prof.nickname || '管理员'),
                    email: String(prof.email || ''),
                    avatar: '',
                    role: 'admin',
                    enabled: true,
                    canEdit: true,
                    canDelete: true,
                    linkEnabled: true,
                    shareEnabled: true,
                    enforceLimits: prof.enforceLimits !== false,
                    transcodePolicy: String(prof.transcodePolicy || 'inherit'),
                    maxFileSizeMB: Number(prof.maxFileSizeMB) || 0,
                    mainChannelId: String(prof.mainChannelId || ''),
                    backupChannelId: String(prof.backupChannelId || ''),
                    totpEnabled: false,
                    frontSessionDays: DEFAULT_SESSION_DAYS,
                    backSessionDays: DEFAULT_SESSION_DAYS,
                    adminNote: String(prof.adminNote || ''),
                    builtin: true,
                },
            };
        }
        const u = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!u)
            return { success: false, message: '用户不存在' };
        if (!admin && u.username !== this.me(req))
            return { success: false, message: '没有权限查看该账户' };
        return {
            success: true,
            data: {
                id: u.id,
                username: u.username,
                nickname: u.nickname,
                email: u.email || '',
                avatar: u.avatar || '',
                avatarUrl: u.avatar ? `/api/avatar/${encodeURIComponent(u.username)}?v=${encodeURIComponent(u.avatar)}` : '',
                role: u.role,
                enabled: u.enabled,
                canEdit: u.canEdit,
                canDelete: u.canDelete,
                linkEnabled: u.linkEnabled,
                shareEnabled: u.role === 'admin' || u.role === 'super' ? true : !!u.shareEnabled,
                enforceLimits: u.enforceLimits,
                transcodePolicy: u.transcodePolicy || 'inherit',
                maxFileSizeMB: Number(u.maxFileSizeMB) || 0,
                mainChannelId: u.mainChannelId,
                backupChannelId: u.backupChannelId,
                totpEnabled: u.totpEnabled,
                emailVerified: u.emailVerified,
                recoveryCount: (0, recovery_1.countRecoveryCodes)(u.recoveryHashes),
                recoveryAt: u.recoveryAt ? u.recoveryAt.getTime() : 0,
                mailReady: await this.mail.configured(),
                frontSessionDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
                backSessionDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
                uploadBkImg: u.uploadBkImg || '',
                adminBkImg: u.adminBkImg || '',
                webdavEnabled: !!u.webdavEnabled,
                webdavMax: Number(u.webdavMax) || 2,
                adminNote: admin ? u.adminNote || '' : '',
                createdAt: u.createdAt,
                self: u.username === this.me(req),
            },
        };
    }
    async create(req, body) {
        if (!this.isAdmin(req))
            return { success: false, message: '没有权限创建用户' };
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const nameErr = await this.checkUsername(username);
        if (nameErr)
            return { success: false, message: nameErr };
        if (!password)
            return { success: false, message: '密码不能为空' };
        if (password.length < 4)
            return { success: false, message: '密码至少 4 位' };
        const u = await prisma_1.prisma.user.create({
            data: {
                username,
                passwordHash: crypto_service_1.CryptoService.hashPassword(password),
                uploadPassword: '',
                nickname: String(body.nickname || '').trim(),
                email: String(body.email || '').trim().slice(0, 120),
                role: 'user',
                enabled: body.enabled !== false,
                canEdit: body.canEdit !== false,
                canDelete: body.canDelete !== false,
                linkEnabled: body.linkEnabled !== false,
                enforceLimits: body.enforceLimits !== false,
                transcodePolicy: normalizeTranscodePolicy(body.transcodePolicy),
                maxFileSizeMB: clampMaxFileSizeMB(body.maxFileSizeMB),
                mainChannelId: String(body.mainChannelId || ''),
                backupChannelId: String(body.backupChannelId || ''),
                adminNote: String(body.adminNote || '').slice(0, 4000),
            },
        });
        return { success: true, data: { id: u.id } };
    }
    async update(req, id, body) {
        if (id.startsWith('__admin__')) {
            if (!this.isAdmin(req))
                return { success: false, message: '只能修改自己的账户' };
            const patch = {};
            if (body.nickname !== undefined)
                patch.nickname = String(body.nickname);
            if (body.email !== undefined)
                patch.email = String(body.email);
            if (body.mainChannelId !== undefined)
                patch.mainChannelId = String(body.mainChannelId);
            if (body.backupChannelId !== undefined)
                patch.backupChannelId = String(body.backupChannelId);
            if (body.enforceLimits !== undefined)
                patch.enforceLimits = !!body.enforceLimits;
            if (body.transcodePolicy !== undefined)
                patch.transcodePolicy = normalizeTranscodePolicy(body.transcodePolicy);
            if (body.maxFileSizeMB !== undefined)
                patch.maxFileSizeMB = clampMaxFileSizeMB(body.maxFileSizeMB);
            if (body.adminNote !== undefined)
                patch.adminNote = String(body.adminNote).slice(0, 4000);
            await this.sysConfig.save('adminProfile', patch);
            return { success: true };
        }
        const u = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!u)
            return { success: false, message: '用户不存在' };
        const admin = this.isAdmin(req);
        const self = u.username === this.me(req);
        if (!admin && !self)
            return { success: false, message: '只能修改自己的账户' };
        const data = {};
        if (body.username !== undefined) {
            const next = String(body.username).trim();
            if (next !== u.username) {
                const err = await this.checkUsername(next, u.id);
                if (err)
                    return { success: false, message: err };
                data.username = next;
            }
        }
        if (body.password !== undefined && body.password !== '') {
            if (String(body.password).length < 4)
                return { success: false, message: '密码至少 4 位' };
            if (admin && !self) {
                const okAdmin = await this.verifyAdminPassword(req, String(body.adminPassword || ''));
                if (!okAdmin)
                    return { success: false, message: '请输入正确的管理员密码后再修改他人密码' };
            }
            else {
                const v = this.verifySelfPassword(u, body);
                if (!v.ok)
                    return { success: false, message: v.message };
            }
            data.passwordHash = crypto_service_1.CryptoService.hashPassword(String(body.password));
        }
        if (body.nickname !== undefined)
            data.nickname = String(body.nickname).slice(0, 60);
        if (body.email !== undefined) {
            const email = String(body.email).trim().slice(0, 120);
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                return { success: false, message: '邮箱格式不正确' };
            if (email !== (u.email || '')) {
                if (u.emailVerified) {
                    return { success: false, message: '该邮箱已验证，更换邮箱请点击「更换邮箱」并重新接收验证码' };
                }
                data.email = email;
                data.emailVerified = false;
            }
        }
        for (const key of ['frontSessionDays', 'backSessionDays']) {
            const raw = body[key];
            if (raw === undefined)
                continue;
            if (raw === null || String(raw).trim() === '') {
                data[key] = null;
                continue;
            }
            const n = Number(raw);
            if (!Number.isFinite(n) || n < 0 || n > 3650) {
                return { success: false, message: '会话有效期需在 0~3650 天之间（0 = 永久）' };
            }
            data[key] = Math.floor(n);
        }
        for (const key of ['uploadBkImg', 'adminBkImg']) {
            if (body[key] === undefined)
                continue;
            const v = normalizeBkImg(body[key]);
            if (v === null)
                return { success: false, message: '背景图格式不正确，需为 ["图片地址1","图片地址2"]' };
            data[key] = v;
        }
        if (admin) {
            if (body.enabled !== undefined)
                data.enabled = !!body.enabled;
            if (body.canEdit !== undefined)
                data.canEdit = !!body.canEdit;
            if (body.canDelete !== undefined)
                data.canDelete = !!body.canDelete;
            if (body.linkEnabled !== undefined)
                data.linkEnabled = !!body.linkEnabled;
            if (body.shareEnabled !== undefined)
                data.shareEnabled = !!body.shareEnabled;
            if (body.enforceLimits !== undefined)
                data.enforceLimits = !!body.enforceLimits;
            if (body.transcodePolicy !== undefined)
                data.transcodePolicy = normalizeTranscodePolicy(body.transcodePolicy);
            if (body.maxFileSizeMB !== undefined)
                data.maxFileSizeMB = clampMaxFileSizeMB(body.maxFileSizeMB);
            if (body.adminNote !== undefined)
                data.adminNote = String(body.adminNote).slice(0, 4000);
            if (body.webdavEnabled !== undefined) {
                data.webdavEnabled = u.role === 'user' ? !!body.webdavEnabled : false;
            }
            if (body.webdavMax !== undefined) {
                const n = Math.floor(Number(body.webdavMax));
                data.webdavMax = Number.isFinite(n) ? Math.min(50, Math.max(1, n)) : 2;
            }
        }
        if (body.mainChannelId !== undefined || body.backupChannelId !== undefined) {
            const allowed = await this.authorizedChannelIds(u.username);
            if (body.mainChannelId !== undefined) {
                const v = String(body.mainChannelId || '');
                if (v && !allowed.has(v))
                    return { success: false, message: '该存储渠道未授权给此账户' };
                data.mainChannelId = v;
            }
            if (body.backupChannelId !== undefined) {
                const v = String(body.backupChannelId || '');
                if (v && v !== 'none' && !allowed.has(v))
                    return { success: false, message: '该备份渠道未授权给此账户' };
                data.backupChannelId = v;
            }
        }
        if (Object.keys(data).length === 0)
            return { success: false, message: '没有可修改的内容' };
        const updated = await prisma_1.prisma.user.update({ where: { id }, data });
        if (data.username && updated.username !== u.username) {
            await prisma_1.prisma.fileRecord.updateMany({ where: { uploader: u.username }, data: { uploader: updated.username } });
        }
        return { success: true, data: { username: updated.username } };
    }
    async remove(req, id) {
        if (!this.isAdmin(req))
            return { success: false, message: '没有权限删除用户' };
        const u = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!u)
            return { success: false, message: '用户不存在' };
        if (u.role === 'admin')
            return { success: false, message: '不能删除管理员账户' };
        await prisma_1.prisma.user.delete({ where: { id } });
        await fs_1.promises.unlink((0, path_1.join)(avatarDir(), `${id}.webp`)).catch(() => undefined);
        return { success: true };
    }
    async uploadAvatar(req, id, file) {
        if (!file?.buffer?.length)
            return { success: false, message: '没有收到图片文件' };
        const u = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!u)
            return { success: false, message: '用户不存在' };
        if (!this.isAdmin(req) && u.username !== this.me(req))
            return { success: false, message: '只能修改自己的头像' };
        let out;
        try {
            const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
            out = await sharp(file.buffer, { limitInputPixels: 40_000_000 })
                .rotate()
                .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
                .webp({ quality: 88 })
                .toBuffer();
        }
        catch (err) {
            return { success: false, message: `图片处理失败：${err.message}` };
        }
        const dir = avatarDir();
        await fs_1.promises.mkdir(dir, { recursive: true });
        await fs_1.promises.writeFile((0, path_1.join)(dir, `${u.id}.webp`), out);
        const version = String(Date.now());
        await prisma_1.prisma.user.update({ where: { id: u.id }, data: { avatar: version } });
        return {
            success: true,
            data: {
                avatar: version,
                avatarUrl: `/api/avatar/${encodeURIComponent(u.username)}?v=${version}`,
            },
        };
    }
    async removeAvatar(req, id) {
        const u = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!u)
            return { success: false, message: '用户不存在' };
        if (!this.isAdmin(req) && u.username !== this.me(req))
            return { success: false, message: '只能修改自己的头像' };
        await fs_1.promises.unlink((0, path_1.join)(avatarDir(), `${u.id}.webp`)).catch(() => undefined);
        await prisma_1.prisma.user.update({ where: { id: u.id }, data: { avatar: '' } });
        return { success: true };
    }
    async sendEmailCode(req, id, body) {
        const target = await this.emailTarget(req, id);
        if (!target.u)
            return { success: false, message: target.err };
        const email = String(body?.email || target.u.email || '').trim().toLowerCase();
        if (!email)
            return { success: false, message: '请先填写邮箱地址' };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return { success: false, message: '邮箱格式不正确' };
        if (target.u.emailVerified && email === (target.u.email || '').toLowerCase()) {
            return { success: false, message: '该邮箱已验证，无需重复验证' };
        }
        if (!(await this.mail.configured())) {
            return { success: false, message: '管理员尚未配置发信邮箱（安全设置 → 邮箱配置）' };
        }
        const r = await this.mail.sendCode(email, 'verify-email', target.u.nickname || target.u.username);
        if (!r.ok)
            return { success: false, message: r.message };
        return { success: true, message: `验证码已发送至 ${(0, auth_controller_1.maskEmail)(email)}`, data: { email } };
    }
    async verifyEmail(req, id, body) {
        const target = await this.emailTarget(req, id);
        if (!target.u)
            return { success: false, message: target.err };
        const email = String(body?.email || target.u.email || '').trim().toLowerCase();
        if (!email)
            return { success: false, message: '请先填写邮箱地址' };
        const code = String(body?.code || '').trim();
        if (!/^[0-9A-Za-z]{6}$/.test(code))
            return { success: false, message: '请输入 6 位验证码' };
        const r = this.mail.consumeCode(email, 'verify-email', code);
        if (!r.ok)
            return { success: false, message: r.message };
        const dup = await prisma_1.prisma.user.findFirst({
            where: { email, emailVerified: true, NOT: { id: target.u.id } },
            select: { username: true },
        });
        if (dup)
            return { success: false, message: '该邮箱已被其他账户验证使用' };
        await prisma_1.prisma.user.update({ where: { id: target.u.id }, data: { email, emailVerified: true } });
        app_log_1.appLog.info('user', `账户「${target.u.username}」邮箱验证通过（${(0, auth_controller_1.maskEmail)(email)}）`);
        return { success: true, message: '邮箱验证成功', data: { email, emailVerified: true } };
    }
    async resetEmailVerified(req, id) {
        const target = await this.emailTarget(req, id);
        if (!target.u)
            return { success: false, message: target.err };
        if (target.u.totpEnabled)
            return { success: false, message: '请先关闭两步验证，否则将无法接收验证码' };
        await prisma_1.prisma.user.update({ where: { id: target.u.id }, data: { emailVerified: false } });
        return { success: true, message: '已取消邮箱验证状态' };
    }
    async emailTarget(req, id) {
        const u = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!u)
            return { u: null, err: '用户不存在' };
        if (!this.isAdmin(req) && u.username !== this.me(req))
            return { u: null, err: '只能操作自己的账户' };
        return { u, err: '' };
    }
    async totpTarget(req, id) {
        const u = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!u)
            return { u: null, err: '用户不存在' };
        if (!this.isAdmin(req) && u.username !== this.me(req))
            return { u: null, err: '只能操作自己的账户' };
        return { u, err: '' };
    }
    verifySelfPassword(u, body) {
        const merged = String(body.verifyCode || '').trim();
        const vType = String(body.verifyType || '').trim().toLowerCase();
        if (merged && vType) {
            if (vType === 'password') {
                if (crypto_service_1.CryptoService.verifyPassword(merged, u.passwordHash))
                    return { ok: true };
                return { ok: false, message: '原密码不正确' };
            }
            if (vType === 'email') {
                if (!u.email || !u.emailVerified)
                    return { ok: false, message: '该账户邮箱未验证，无法使用邮箱验证码改密' };
                const r = this.mail.consumeAnyCode(u.email, ['change-password', 'login'], merged);
                return r.ok ? { ok: true } : { ok: false, message: r.message };
            }
            if (vType === 'totp') {
                if (!u.totpEnabled || !u.totpSecret)
                    return { ok: false, message: '该账户未启用两步验证' };
                try {
                    if ((0, totp_1.verifyTotp)(crypto_service_1.CryptoService.decrypt(u.totpSecret), merged))
                        return { ok: true };
                }
                catch {
                }
                return { ok: false, message: '动态码错误或已过期' };
            }
            return { ok: false, message: '身份验证方式无效' };
        }
        if (merged) {
            if (crypto_service_1.CryptoService.verifyPassword(merged, u.passwordHash))
                return { ok: true };
            if (merged.length <= 8) {
                if (u.email && u.emailVerified) {
                    const r = this.mail.consumeAnyCode(u.email, ['change-password', 'login'], merged);
                    if (r.ok)
                        return { ok: true };
                }
                if (u.totpEnabled && u.totpSecret) {
                    try {
                        if ((0, totp_1.verifyTotp)(crypto_service_1.CryptoService.decrypt(u.totpSecret), merged))
                            return { ok: true };
                    }
                    catch {
                    }
                }
            }
            return { ok: false, message: '身份验证失败：原密码 / 邮箱验证码 / 两步验证动态码均不匹配' };
        }
        const oldPassword = String(body.oldPassword || '');
        const emailCode = String(body.emailCode || '').trim();
        const totpCode = String(body.totpCode || '').trim();
        if (!oldPassword && !emailCode && !totpCode) {
            return { ok: false, message: '修改密码需要验证身份：请输入原密码、邮箱验证码或两步验证动态码（任一）' };
        }
        if (oldPassword) {
            if (crypto_service_1.CryptoService.verifyPassword(oldPassword, u.passwordHash))
                return { ok: true };
            return { ok: false, message: '原密码不正确' };
        }
        if (emailCode) {
            if (!u.email || !u.emailVerified)
                return { ok: false, message: '该账户邮箱未验证，无法使用邮箱验证码改密' };
            const r = this.mail.consumeAnyCode(u.email, ['change-password', 'login'], emailCode);
            return r.ok ? { ok: true } : { ok: false, message: r.message };
        }
        if (!u.totpEnabled || !u.totpSecret)
            return { ok: false, message: '该账户未启用两步验证' };
        try {
            if ((0, totp_1.verifyTotp)(crypto_service_1.CryptoService.decrypt(u.totpSecret), totpCode))
                return { ok: true };
        }
        catch {
            return { ok: false, message: '动态码错误或已过期' };
        }
        return { ok: false, message: '动态码错误或已过期' };
    }
    async verifyAdminPassword(req, adminPassword) {
        const pwd = String(adminPassword || '');
        if (!pwd)
            return false;
        const me = this.me(req);
        const row = me ? await prisma_1.prisma.user.findUnique({ where: { username: me } }) : null;
        if (row && row.role === 'admin')
            return crypto_service_1.CryptoService.verifyPassword(pwd, row.passwordHash);
        const suUser = (process.env.SUPER_ADMIN_USERNAME || '').trim();
        const suPass = process.env.SUPER_ADMIN_PASSWORD || '';
        if (suUser && suPass && me === suUser && pwd === suPass)
            return true;
        try {
            const raw = await this.sysConfig.readSecurityRaw();
            const cfgPass = String(raw?.auth?.admin?.adminPassword || '');
            const cfgUser = String(raw?.auth?.admin?.adminUsername || '').trim() || 'admin';
            if (cfgPass && me === cfgUser && pwd === cfgPass)
                return true;
        }
        catch {
        }
        return false;
    }
    async sendPasswordChangeCode(req, id) {
        const { u, err } = await this.totpTarget(req, id);
        if (!u)
            return { success: false, message: err };
        if (!u.email || !u.emailVerified)
            return { success: false, message: '该账户邮箱未验证，无法发送验证码' };
        if (!(await this.mail.configured())) {
            return { success: false, message: '管理员尚未配置发信邮箱（安全设置 → 邮箱配置）' };
        }
        const r = await this.mail.sendCode(u.email, 'change-password', u.nickname || u.username);
        if (!r.ok)
            return { success: false, message: r.message };
        return { success: true, message: `验证码已发送至 ${(0, auth_controller_1.maskEmail)(u.email)}`, data: { email: (0, auth_controller_1.maskEmail)(u.email) } };
    }
    async totpSetup(req, id) {
        const { u, err } = await this.totpTarget(req, id);
        if (!u)
            return { success: false, message: err };
        if (u.totpEnabled)
            return { success: false, message: '该账户已启用两步验证，请先关闭再重新绑定' };
        if (!u.email || !u.emailVerified) {
            return { success: false, message: '请先完成邮箱验证，再启用两步验证' };
        }
        const secret = (0, totp_1.generateTotpSecret)();
        await prisma_1.prisma.user.update({
            where: { id: u.id },
            data: { totpSecret: crypto_service_1.CryptoService.encrypt(secret), totpEnabled: false },
        });
        return {
            success: true,
            data: {
                secret,
                uri: (0, totp_1.totpUri)(secret, u.username),
                digits: 6,
                period: 30,
            },
        };
    }
    async totpEnable(req, id, body) {
        const { u, err } = await this.totpTarget(req, id);
        if (!u)
            return { success: false, message: err };
        if (u.totpEnabled)
            return { success: false, message: '该账户已启用两步验证' };
        if (!u.totpSecret)
            return { success: false, message: '请先生成密钥' };
        let secret = '';
        try {
            secret = crypto_service_1.CryptoService.decrypt(u.totpSecret);
        }
        catch {
            return { success: false, message: '密钥读取失败，请重新生成' };
        }
        if (!(0, totp_1.verifyTotp)(secret, String(body.code || ''))) {
            return { success: false, message: '验证码错误或已过期' };
        }
        const { plain, hashes } = (0, recovery_1.generateRecoveryCodes)();
        await prisma_1.prisma.user.update({
            where: { id: u.id },
            data: {
                totpEnabled: true,
                backVerifiedAt: new Date(),
                recoveryHashes: JSON.stringify(hashes),
                recoveryAt: new Date(),
            },
        });
        app_log_1.appLog.info('auth', `账户「${u.username}」启用了两步验证（已生成 ${plain.length} 个恢复码）`);
        return {
            success: true,
            data: { recoveryCodes: plain },
            message: '两步验证已启用，请立即保存恢复码（仅显示这一次）',
        };
    }
    async regenerateRecovery(req, id, body) {
        const { u, err } = await this.totpTarget(req, id);
        if (!u)
            return { success: false, message: err };
        if (!u.totpEnabled)
            return { success: false, message: '该账户未启用两步验证' };
        let secret = '';
        try {
            secret = crypto_service_1.CryptoService.decrypt(u.totpSecret || '');
        }
        catch {
            secret = '';
        }
        if (!secret || !(0, totp_1.verifyTotp)(secret, String(body?.code || ''))) {
            return { success: false, message: '动态码错误或已过期' };
        }
        const { plain, hashes } = (0, recovery_1.generateRecoveryCodes)();
        await prisma_1.prisma.user.update({
            where: { id: u.id },
            data: { recoveryHashes: JSON.stringify(hashes), recoveryAt: new Date() },
        });
        app_log_1.appLog.warn('auth', `账户「${u.username}」重新生成了恢复码（旧恢复码已全部作废）`);
        return { success: true, data: { recoveryCodes: plain }, message: '新的恢复码已生成，请立即保存（仅显示这一次）' };
    }
    async totpDisableFallback(req, id, body) {
        const { u, err } = await this.totpTarget(req, id);
        if (!u)
            return { success: false, message: err };
        if (!u.totpEnabled)
            return { success: true, message: '该账户未启用两步验证' };
        if (!u.email || !u.emailVerified)
            return { success: false, message: '该账户邮箱未验证，无法使用邮箱验证码关闭' };
        const emailCode = String(body?.emailCode || '').trim();
        const recoveryCode = String(body?.recoveryCode || '').trim();
        if (!emailCode && !recoveryCode)
            return { success: false, message: '请提供邮箱验证码或恢复码（任一即可）' };
        let method = '';
        let recoveryHashes = u.recoveryHashes;
        if (emailCode) {
            const mailRes = this.mail.consumeAnyCode(u.email, ['disable-2fa', 'login'], emailCode);
            if (!mailRes.ok)
                return { success: false, message: mailRes.message };
            method = '邮箱验证码';
        }
        else {
            const hit = (0, recovery_1.consumeRecoveryCode)(u.recoveryHashes, recoveryCode);
            if (!hit)
                return { success: false, message: '恢复码无效或已被使用' };
            recoveryHashes = JSON.stringify(hit.rest);
            method = '恢复码';
        }
        await prisma_1.prisma.user.update({
            where: { id: u.id },
            data: {
                totpEnabled: false,
                totpSecret: '',
                recoveryHashes,
                backVerifiedAt: null,
            },
        });
        app_log_1.appLog.warn('auth', `账户「${u.username}」通过「${method}」关闭了两步验证`);
        return { success: true, message: '两步验证已关闭，请重新绑定验证器' };
    }
    async sendDisableCode(req, id) {
        const { u, err } = await this.totpTarget(req, id);
        if (!u)
            return { success: false, message: err };
        if (!u.totpEnabled)
            return { success: false, message: '该账户未启用两步验证' };
        if (!u.email || !u.emailVerified)
            return { success: false, message: '该账户邮箱未验证，无法通过邮箱验证码关闭' };
        if (!(await this.mail.configured())) {
            return { success: false, message: '管理员尚未配置发信邮箱（安全设置 → 邮箱配置）' };
        }
        const r = await this.mail.sendCode(u.email, 'disable-2fa', u.nickname || u.username);
        if (!r.ok)
            return { success: false, message: r.message };
        return { success: true, message: `验证码已发送至 ${(0, auth_controller_1.maskEmail)(u.email)}`, data: { email: (0, auth_controller_1.maskEmail)(u.email) } };
    }
    async totpDisable(req, id, body) {
        const { u, err } = await this.totpTarget(req, id);
        if (!u)
            return { success: false, message: err };
        if (!u.totpEnabled)
            return { success: true };
        let secret = '';
        try {
            secret = crypto_service_1.CryptoService.decrypt(u.totpSecret || '');
        }
        catch {
            secret = '';
        }
        if (secret && !(0, totp_1.verifyTotp)(secret, String(body.code || ''))) {
            return { success: false, message: '验证码错误或已过期' };
        }
        await prisma_1.prisma.user.update({
            where: { id: u.id },
            data: { totpEnabled: false, totpSecret: '', recoveryHashes: '[]', backVerifiedAt: null },
        });
        app_log_1.appLog.warn('auth', `账户「${u.username}」关闭了两步验证`);
        return { success: true };
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('options'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "options", null);
__decorate([
    (0, common_1.Get)('notice'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getNotice", null);
__decorate([
    (0, common_1.Post)('notice'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "saveNotice", null);
__decorate([
    (0, common_1.Get)('collect'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('mode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "collect", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "detail", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "create", null);
__decorate([
    (0, common_1.Put)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':id/avatar'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: 8 * 1024 * 1024 } })),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "uploadAvatar", null);
__decorate([
    (0, common_1.Delete)(':id/avatar'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "removeAvatar", null);
__decorate([
    (0, common_1.Post)(':id/email/send-code'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "sendEmailCode", null);
__decorate([
    (0, common_1.Post)(':id/email/verify'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "verifyEmail", null);
__decorate([
    (0, common_1.Delete)(':id/email/verified'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "resetEmailVerified", null);
__decorate([
    (0, common_1.Post)(':id/password/send-code'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "sendPasswordChangeCode", null);
__decorate([
    (0, common_1.Post)(':id/totp/setup'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "totpSetup", null);
__decorate([
    (0, common_1.Post)(':id/totp/enable'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "totpEnable", null);
__decorate([
    (0, common_1.Post)(':id/totp/recovery'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "regenerateRecovery", null);
__decorate([
    (0, common_1.Post)(':id/totp/disable-fallback'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "totpDisableFallback", null);
__decorate([
    (0, common_1.Post)(':id/totp/disable-code'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "sendDisableCode", null);
__decorate([
    (0, common_1.Post)(':id/totp/disable'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "totpDisable", null);
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('api/manage/users'),
    (0, common_1.UseGuards)(auth_guard_1.ManageAuthGuard),
    __metadata("design:paramtypes", [sysconfig_service_1.SysConfigService,
        settings_service_1.SettingsService,
        mail_service_1.MailService])
], UsersController);
function normalizeTranscodePolicy(raw) {
    const v = String(raw ?? '').trim();
    return v === 'off' || v === 'on' || v === 'user' ? v : 'inherit';
}
function clampMaxFileSizeMB(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0)
        return 0;
    return Math.min(1048576, Math.round(n));
}
function normalizeBkImg(raw) {
    if (raw === undefined)
        return null;
    if (raw === null)
        return '';
    const text = String(raw).trim();
    if (!text)
        return '';
    let arr;
    if (text.startsWith('[')) {
        try {
            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed))
                return null;
            arr = parsed;
        }
        catch {
            return null;
        }
    }
    else {
        arr = [text];
    }
    const list = arr
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean)
        .map((x) => x.slice(0, 2000))
        .filter((x) => /^https?:\/\//i.test(x) || x.startsWith('/'))
        .slice(0, 20);
    return list.length ? JSON.stringify(list) : '';
}
function avatarDir() {
    return (0, project_paths_1.backendSub)('uploads', '_avatars');
}
function avatarDirLegacy() {
    return (0, project_paths_1.backendSub)('uploads', 'avatars');
}
let AvatarController = class AvatarController {
    async get(username, res) {
        const u = await prisma_1.prisma.user.findUnique({ where: { username } });
        if (!u || !u.avatar)
            return res.status(404).end();
        const buf = await fs_1.promises
            .readFile((0, path_1.join)(avatarDir(), `${u.id}.webp`))
            .catch(() => fs_1.promises.readFile((0, path_1.join)(avatarDirLegacy(), `${u.id}.webp`)).catch(() => null));
        if (!buf)
            return res.status(404).end();
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.end(buf);
    }
};
exports.AvatarController = AvatarController;
__decorate([
    (0, common_1.Get)(':username'),
    __param(0, (0, common_1.Param)('username')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AvatarController.prototype, "get", null);
exports.AvatarController = AvatarController = __decorate([
    (0, common_1.Controller)('api/avatar')
], AvatarController);
