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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AuthController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
exports.maskEmail = maskEmail;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const prisma_1 = require("../common/prisma");
const crypto_service_1 = require("../common/crypto.service");
const secret_1 = require("../common/secret");
const auth_guard_1 = require("./auth.guard");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const totp_1 = require("../common/totp");
const recovery_1 = require("../common/recovery");
const mail_service_1 = require("../mail/mail.service");
const app_log_1 = require("../common/app-log");
const DEFAULT_SESSION_DAYS = 7;
const SUPER_ADMIN_SESSION_DAYS = 1;
let AuthController = class AuthController {
    static { AuthController_1 = this; }
    sysConfig;
    mail;
    constructor(sysConfig, mail) {
        this.sysConfig = sysConfig;
        this.mail = mail;
    }
    static TOTP_FAIL_MAX = 6;
    static TOTP_FAIL_WINDOW_MS = 60 * 60 * 1000;
    static TOTP_LOCK_MS = 30 * 60 * 1000;
    totpFailStore = new Map();
    totpLockState(username) {
        const st = this.totpFailStore.get(username);
        if (!st)
            return { locked: false, remainingMs: 0, count: 0 };
        const now = Date.now();
        if (st.lockedUntil > now)
            return { locked: true, remainingMs: st.lockedUntil - now, count: st.count };
        if (now - st.firstFailAt >= AuthController_1.TOTP_FAIL_WINDOW_MS) {
            this.totpFailStore.delete(username);
            return { locked: false, remainingMs: 0, count: 0 };
        }
        return { locked: false, remainingMs: 0, count: st.count };
    }
    totpRecordFailure(username) {
        const now = Date.now();
        const st = this.totpFailStore.get(username);
        if (!st || now - st.firstFailAt >= AuthController_1.TOTP_FAIL_WINDOW_MS) {
            this.totpFailStore.set(username, { firstFailAt: now, count: 1, lockedUntil: 0 });
            return { count: 1, locked: false, remainingMs: 0 };
        }
        st.count += 1;
        if (st.count >= AuthController_1.TOTP_FAIL_MAX) {
            st.lockedUntil = now + AuthController_1.TOTP_LOCK_MS;
            return { count: st.count, locked: true, remainingMs: AuthController_1.TOTP_LOCK_MS };
        }
        return { count: st.count, locked: false, remainingMs: 0 };
    }
    totpClearFailures(username) {
        this.totpFailStore.delete(username);
    }
    async authConfig() {
        try {
            const raw = await this.sysConfig.readSecurityRaw();
            const auth = raw?.auth;
            return auth && typeof auth === 'object' ? auth : {};
        }
        catch {
            return {};
        }
    }
    async isAdminConfigured(auth) {
        if (String(auth?.admin?.adminPassword || ''))
            return true;
        if (process.env.ADMIN_USER || process.env.ADMIN_PASSWORD)
            return true;
        try {
            return (await prisma_1.prisma.user.count({ where: { role: 'admin' } })) > 0;
        }
        catch {
            return false;
        }
    }
    async isUserConfigured(_auth) {
        try {
            return (await prisma_1.prisma.user.count()) > 0;
        }
        catch {
            return false;
        }
    }
    async verifyAccount(username, password) {
        if (!username || !password)
            return null;
        const suUser = (process.env.SUPER_ADMIN_USERNAME || '').trim();
        const suPass = process.env.SUPER_ADMIN_PASSWORD || '';
        if (suUser && suPass && (0, secret_1.safeEqual)(username, suUser) && (0, secret_1.matchSecret)(password, suPass)) {
            return {
                user: suUser,
                role: 'super',
                enabled: true,
                canEdit: true,
                canDelete: true,
                totpEnabled: false,
                frontDays: SUPER_ADMIN_SESSION_DAYS,
                backDays: SUPER_ADMIN_SESSION_DAYS,
            };
        }
        const u = await prisma_1.prisma.user.findUnique({ where: { username } });
        if (u) {
            if (!u.enabled)
                return null;
            if (!crypto_service_1.CryptoService.verifyPassword(password, u.passwordHash))
                return null;
            return {
                user: u.username,
                role: (u.role === 'admin' ? 'admin' : 'user'),
                enabled: u.enabled,
                canEdit: u.canEdit,
                canDelete: u.canDelete,
                totpEnabled: u.totpEnabled,
                frontDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
                backDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
            };
        }
        const hasAdmin = (await prisma_1.prisma.user.count({ where: { role: 'admin' } })) > 0;
        if (!hasAdmin) {
            const auth = await this.authConfig();
            const cfgPass = String(auth?.admin?.adminPassword || '');
            if (cfgPass) {
                const cfgUser = String(auth?.admin?.adminUsername || '').trim() || 'admin';
                if ((0, secret_1.safeEqual)(username, cfgUser) && (0, secret_1.matchSecret)(password, cfgPass)) {
                    this.upgradeAdminSecret(cfgPass).catch(() => undefined);
                    return {
                        user: cfgUser,
                        role: 'admin',
                        enabled: true,
                        canEdit: true,
                        canDelete: true,
                        totpEnabled: false,
                        frontDays: DEFAULT_SESSION_DAYS,
                        backDays: DEFAULT_SESSION_DAYS,
                    };
                }
                return null;
            }
            const envUser = process.env.ADMIN_USER || 'admin';
            const envPass = process.env.ADMIN_PASSWORD || 'gohub';
            if ((0, secret_1.safeEqual)(username, envUser) && (0, secret_1.safeEqual)(password, envPass)) {
                return {
                    user: envUser,
                    role: 'admin',
                    enabled: true,
                    canEdit: true,
                    canDelete: true,
                    totpEnabled: false,
                    frontDays: DEFAULT_SESSION_DAYS,
                    backDays: DEFAULT_SESSION_DAYS,
                };
            }
        }
        return null;
    }
    async upgradeAdminSecret(stored) {
        if ((0, secret_1.isHashedSecret)(stored))
            return;
        const raw = await this.sysConfig.readSecurityRaw();
        const cur = String(raw?.auth?.admin?.adminPassword || '');
        if (!cur || (0, secret_1.isHashedSecret)(cur))
            return;
        raw.auth.admin.adminPassword = (0, secret_1.hashSecret)(cur);
        await this.sysConfig.writeSecurityRaw(raw);
    }
    sessionDaysOf(days) {
        const n = Number(days);
        if (!Number.isFinite(n))
            return DEFAULT_SESSION_DAYS;
        if (n === 0)
            return 0;
        if (n < 0)
            return DEFAULT_SESSION_DAYS;
        return Math.floor(n);
    }
    async sessionSecureEnabled() {
        try {
            const security = await this.sysConfig.get('security');
            return security?.access?.sessionSecure === true;
        }
        catch {
            return false;
        }
    }
    isHttps(req) {
        if (!req)
            return false;
        if (req.secure)
            return true;
        const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
        return proto === 'https';
    }
    async setSession(res, account, req, verified = false) {
        const { payload, sig, maxAge } = (0, auth_guard_1.makeSession)(account.user, account.role, {
            frontDays: this.sessionDaysOf(account.frontDays),
            backDays: this.sessionDaysOf(account.backDays),
            totpEnabled: !!account.totpEnabled,
            verified: account.totpEnabled ? verified : true,
        });
        const opts = { httpOnly: true, sameSite: 'lax', path: '/' };
        if (maxAge > 0)
            opts.maxAge = maxAge;
        if ((await this.sessionSecureEnabled()) && this.isHttps(req))
            opts.secure = true;
        res.cookie(auth_guard_1.SESSION_COOKIE, `${payload}.${sig}`, opts);
    }
    async login(body, res, req) {
        const username = (body.username || '').trim();
        const account = await this.verifyAccount(username, body.password || '');
        if (!account)
            return res.status(401).json({ success: false, message: '用户名或密码错误' });
        let verified = false;
        if (account.totpEnabled && body.code) {
            const u = await prisma_1.prisma.user.findUnique({ where: { username: account.user } });
            if (u)
                verified = (await this.verifySecondFactor(u, String(body.code))).ok;
        }
        await this.setSession(res, account, req, verified);
        return res.json({
            success: true,
            data: {
                type: account.role === 'user' ? 'user' : 'admin',
                role: account.role,
                username: account.user,
                needTotp: account.totpEnabled && !verified,
            },
        });
    }
    async adminLogin(body, res, req) {
        return this.login(body, res, req);
    }
    async checkTotp(username, code) {
        const u = await prisma_1.prisma.user.findUnique({ where: { username } });
        if (!u || !u.totpEnabled || !u.totpSecret)
            return false;
        const ok = this.checkTotpSecret(u.totpSecret, code);
        if (ok) {
            await prisma_1.prisma.user.update({ where: { id: u.id }, data: { backVerifiedAt: new Date() } });
        }
        return ok;
    }
    checkTotpSecret(encSecret, code) {
        let secret = '';
        try {
            secret = crypto_service_1.CryptoService.decrypt(encSecret);
        }
        catch {
            return false;
        }
        if (!secret)
            return false;
        return (0, totp_1.verifyTotp)(secret, code);
    }
    async verifySecondFactor(u, code) {
        const raw = String(code || '').trim();
        if (!raw)
            return { ok: false, method: '', message: '请输入验证码' };
        if (raw.includes('-')) {
            const hit = (0, recovery_1.consumeRecoveryCode)(u.recoveryHashes, raw);
            if (!hit)
                return { ok: false, method: '', message: '恢复码无效或已被使用' };
            await prisma_1.prisma.user.update({
                where: { id: u.id },
                data: { recoveryHashes: JSON.stringify(hit.rest), backVerifiedAt: new Date() },
            });
            app_log_1.appLog.warn('auth', `账户「${u.username}」使用恢复码通过两步验证（剩余 ${hit.rest.length} 个）`);
            return { ok: true, method: 'recovery' };
        }
        if (/^\d{6}$/.test(raw) && u.totpEnabled && u.totpSecret && this.checkTotpSecret(u.totpSecret, raw)) {
            await prisma_1.prisma.user.update({ where: { id: u.id }, data: { backVerifiedAt: new Date() } });
            return { ok: true, method: 'totp' };
        }
        if (u.email && u.emailVerified) {
            const res = this.mail.consumeCode(u.email, 'login', raw);
            if (res.ok) {
                await prisma_1.prisma.user.update({ where: { id: u.id }, data: { backVerifiedAt: new Date() } });
                app_log_1.appLog.info('auth', `账户「${u.username}」使用邮箱验证码通过两步验证`);
                return { ok: true, method: 'email' };
            }
            if (!/请先获取验证码/.test(res.message)) {
                return { ok: false, method: '', message: res.message };
            }
        }
        const hit = (0, recovery_1.consumeRecoveryCode)(u.recoveryHashes, raw);
        if (hit) {
            await prisma_1.prisma.user.update({
                where: { id: u.id },
                data: { recoveryHashes: JSON.stringify(hit.rest), backVerifiedAt: new Date() },
            });
            app_log_1.appLog.warn('auth', `账户「${u.username}」使用恢复码（无连字符）通过两步验证（剩余 ${hit.rest.length} 个）`);
            return { ok: true, method: 'recovery' };
        }
        return { ok: false, method: '', message: '验证码不正确或已过期' };
    }
    async totpVerify(body, req, res) {
        return this.verifyAndRefresh(body?.code, req, res);
    }
    async verifySecond(body, req, res) {
        return this.verifyAndRefresh(body?.code, req, res);
    }
    async verifyAndRefresh(code, req, res) {
        const session = (0, auth_guard_1.parseSession)(req.cookies?.[auth_guard_1.SESSION_COOKIE]);
        if (!session)
            return res.status(401).json({ success: false, message: '未登录或会话已过期', code: 'NOT_LOGGED_IN' });
        const u = await prisma_1.prisma.user.findUnique({ where: { username: session.user } });
        if (!u)
            return res.status(401).json({ success: false, message: '账户不存在', code: 'NOT_LOGGED_IN' });
        if (!u.totpEnabled) {
            await this.setSession(res, { user: u.username, role: session.role, totpEnabled: false }, req, true);
            return res.json({ success: true, data: { verified: true } });
        }
        const lock = this.totpLockState(u.username);
        if (lock.locked) {
            const remainMin = Math.max(1, Math.ceil(lock.remainingMs / 60000));
            app_log_1.appLog.warn('auth', `账户「${u.username}」2FA 验证处于锁定期（窗口内累计错误 ${lock.count} 次），剩余约 ${remainMin} 分钟，拒绝本次验证`);
            return res.status(400).json({
                success: false,
                message: `验证码错误次数过多，已锁定，请约 ${remainMin} 分钟后再试`,
                code: 'TOTP_LOCKED',
                data: { locked: true, remainMinutes: remainMin },
            });
        }
        const hit = await this.verifySecondFactor(u, String(code || ''));
        if (!hit.ok) {
            const fail = this.totpRecordFailure(u.username);
            if (fail.locked) {
                app_log_1.appLog.warn('auth', `账户「${u.username}」2FA 验证错误已达 ${fail.count} 次（1 小时窗口），锁定 30 分钟`);
            }
            else {
                app_log_1.appLog.warn('auth', `账户「${u.username}」2FA 验证失败（第 ${fail.count}/${AuthController_1.TOTP_FAIL_MAX} 次，1 小时窗口）`);
            }
            const suffix = fail.locked
                ? `，已锁定 30 分钟`
                : `（${fail.count}/${AuthController_1.TOTP_FAIL_MAX}，1 小时内累计 6 次将锁定 30 分钟）`;
            return res.status(400).json({
                success: false,
                message: (hit.message || '验证失败') + suffix,
                code: fail.locked ? 'TOTP_LOCKED' : 'VERIFY_FAILED',
                data: { locked: fail.locked, failCount: fail.count },
            });
        }
        this.totpClearFailures(u.username);
        await this.setSession(res, {
            user: u.username,
            role: session.role,
            totpEnabled: true,
            frontDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
            backDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
        }, req, true);
        return res.json({ success: true, data: { verified: true, method: hit.method } });
    }
    async sendLoginCode(body, req) {
        const session = (0, auth_guard_1.parseSession)(req.cookies?.[auth_guard_1.SESSION_COOKIE]);
        const username = (session?.user || String(body?.username || '').trim() || '').trim();
        const generic = { success: true, message: '如果该账户已绑定并验证邮箱，验证码已发出，请查收' };
        if (!username)
            return generic;
        const u = await prisma_1.prisma.user.findUnique({ where: { username } });
        if (!u || !u.enabled || !u.totpEnabled || !u.email || !u.emailVerified)
            return generic;
        if (!(await this.mail.configured())) {
            return { success: false, message: '管理员尚未配置发信邮箱，请改用验证器动态码或恢复码' };
        }
        const r = await this.mail.sendCode(u.email, 'login', u.nickname || u.username);
        if (!r.ok)
            return { success: false, message: r.message };
        return {
            success: true,
            message: `验证码已发送至 ${maskEmail(u.email)}`,
            data: { email: maskEmail(u.email) },
        };
    }
    static passwordResetTokens = new Map();
    static PASSWORD_RESET_TTL = 10 * 60 * 1000;
    async forgotPassword(body, req) {
        const generic = {
            success: true,
            message: '如果用户名与邮箱匹配，重置链接已发送，请前往邮箱查收（10 分钟内有效）',
        };
        const username = String(body?.username || '').trim();
        const email = String(body?.email || '').trim().toLowerCase();
        if (!username || !email)
            return generic;
        const u = await prisma_1.prisma.user.findUnique({ where: { username } });
        if (!u || !u.enabled)
            return generic;
        if (!u.email || !u.emailVerified || u.email.trim().toLowerCase() !== email)
            return generic;
        if (!(await this.mail.configured())) {
            return { success: false, message: '管理员尚未配置发信邮箱，请联系管理员重置密码' };
        }
        for (const [, v] of AuthController_1.passwordResetTokens) {
            if (v.username === u.username && v.expiresAt > Date.now() + AuthController_1.PASSWORD_RESET_TTL - 60 * 1000) {
                return { success: false, message: '重置链接已发送，请 60 秒后再试或直接查收邮件' };
            }
        }
        const token = (0, crypto_1.randomBytes)(24).toString('hex');
        AuthController_1.passwordResetTokens.set(token, {
            username: u.username,
            expiresAt: Date.now() + AuthController_1.PASSWORD_RESET_TTL,
        });
        if (AuthController_1.passwordResetTokens.size > 200) {
            const now = Date.now();
            for (const [k, v] of AuthController_1.passwordResetTokens)
                if (v.expiresAt < now)
                    AuthController_1.passwordResetTokens.delete(k);
        }
        const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
        const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http');
        const link = `${proto}://${host}/reset-password?token=${token}`;
        const html = buildForgotMail({ name: u.nickname || u.username, link, minutes: 10 });
        try {
            await this.mail.send(u.email, '【GoHub】重置密码', html);
            app_log_1.appLog.warn('auth', `账户「${u.username}」申请了「忘记密码」重置链接 → ${maskEmail(u.email)}`);
        }
        catch (e) {
            AuthController_1.passwordResetTokens.delete(token);
            return { success: false, message: `邮件发送失败：${e.message}` };
        }
        return generic;
    }
    async resetPassword(body) {
        const token = String(body?.token || '').trim();
        const password = String(body?.password || '');
        if (!token || !password)
            return { success: false, message: '参数不完整' };
        if (password.length < 4)
            return { success: false, message: '密码至少 4 位' };
        const entry = AuthController_1.passwordResetTokens.get(token);
        if (!entry)
            return { success: false, message: '重置链接无效或已被使用' };
        if (entry.expiresAt < Date.now()) {
            AuthController_1.passwordResetTokens.delete(token);
            return { success: false, message: '重置链接已过期（有效期 10 分钟），请重新申请' };
        }
        AuthController_1.passwordResetTokens.delete(token);
        const u = await prisma_1.prisma.user.findUnique({ where: { username: entry.username } });
        if (!u)
            return { success: false, message: '账户不存在' };
        await prisma_1.prisma.user.update({
            where: { id: u.id },
            data: { passwordHash: crypto_service_1.CryptoService.hashPassword(password) },
        });
        app_log_1.appLog.warn('auth', `账户「${u.username}」通过「忘记密码」邮件链接重置了密码`);
        return { success: true, message: '密码已重置，请使用新密码登录' };
    }
    async disableTotpFallback(body, req, res) {
        const session = (0, auth_guard_1.parseSession)(req.cookies?.[auth_guard_1.SESSION_COOKIE]);
        if (!session)
            return res.status(401).json({ success: false, message: '未登录或会话已过期' });
        const result = await this.disableTotpWithProof(session.user, body?.emailCode, body?.recoveryCode);
        if (!result.ok)
            return res.status(400).json({ success: false, message: result.message });
        await this.setSession(res, { user: session.user, role: session.role, totpEnabled: false }, req, true);
        return res.json({ success: true, message: result.message });
    }
    async disableTotpWithProof(username, emailCode, recoveryCode) {
        const u = await prisma_1.prisma.user.findUnique({ where: { username } });
        if (!u)
            return { ok: false, message: '账户不存在' };
        if (!u.totpEnabled)
            return { ok: true, message: '该账户未启用两步验证' };
        if (!u.email || !u.emailVerified)
            return { ok: false, message: '该账户邮箱未验证，无法通过邮箱验证码关闭两步验证' };
        const email = String(emailCode || '').trim();
        const recovery = String(recoveryCode || '').trim();
        if (!email && !recovery)
            return { ok: false, message: '请提供邮箱验证码或恢复码（任一即可）' };
        let method = '';
        let recoveryHashes = u.recoveryHashes;
        if (email) {
            const mailRes = this.mail.consumeAnyCode(u.email, ['disable-2fa', 'login'], email);
            if (!mailRes.ok)
                return { ok: false, message: mailRes.message };
            method = '邮箱验证码';
        }
        else {
            const hit = (0, recovery_1.consumeRecoveryCode)(u.recoveryHashes, recovery);
            if (!hit)
                return { ok: false, message: '恢复码无效或已被使用' };
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
        return { ok: true, message: '两步验证已关闭，请尽快重新绑定验证器' };
    }
    async totpStatus(req) {
        const session = (0, auth_guard_1.parseSession)(req.cookies?.[auth_guard_1.SESSION_COOKIE]);
        if (!session)
            return { success: true, data: { loggedIn: false, enabled: false, required: false } };
        const u = await prisma_1.prisma.user.findUnique({ where: { username: session.user } });
        const enabled = !!u?.totpEnabled;
        return {
            success: true,
            data: {
                loggedIn: true,
                enabled,
                required: enabled && !(0, auth_guard_1.totpValid)(session),
                email: u?.email || '',
                emailVerified: !!u?.emailVerified,
                mailReady: await this.mail.configured(),
                recoveryCount: u ? (0, recovery_1.countRecoveryCodes)(u.recoveryHashes) : 0,
            },
        };
    }
    async sessionCheck(req) {
        const auth = await this.authConfig();
        const adminRequired = await this.isAdminConfigured(auth);
        const userRequired = await this.isUserConfigured(auth);
        const session = (0, auth_guard_1.parseSession)(req.cookies?.[auth_guard_1.SESSION_COOKIE]);
        const valid = !!session && (0, auth_guard_1.frontValid)(session);
        const role = session ? session.role : null;
        let canEdit = true;
        let canDelete = true;
        let totpEnabled = !!session?.t2;
        let totpRequired = false;
        let shareEnabled = role === 'admin' || role === 'super';
        let profile = {};
        if (session) {
            const u = await prisma_1.prisma.user.findUnique({ where: { username: session.user } });
            if (u) {
                canEdit = u.canEdit ?? true;
                canDelete = u.canDelete ?? true;
                totpEnabled = u.totpEnabled;
                totpRequired = u.totpEnabled && !(0, auth_guard_1.totpValid)(session);
                shareEnabled = u.role === 'admin' || u.role === 'super' ? true : !!u.shareEnabled;
                profile = {
                    username: u.username,
                    nickname: u.nickname || u.username,
                    email: u.email || '',
                    emailVerified: !!u.emailVerified,
                    role: u.role,
                    avatar: u.avatar || '',
                    avatarUrl: u.avatar ? `/api/avatar/${encodeURIComponent(u.username)}?v=${encodeURIComponent(u.avatar)}` : '',
                    frontSessionDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
                    backSessionDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
                    recoveryCount: (0, recovery_1.countRecoveryCodes)(u.recoveryHashes),
                    shareEnabled,
                };
            }
        }
        return {
            success: true,
            adminRequired,
            userRequired,
            valid,
            authType: role,
            role,
            username: session?.user ?? null,
            canEdit,
            canDelete,
            shareEnabled,
            totpEnabled,
            totpRequired,
            profile,
            data: {
                isLoggedIn: valid,
                isAdmin: role === 'admin' || role === 'super',
                isSuper: role === 'super',
                username: session?.user ?? null,
                role,
                canEdit,
                canDelete,
                shareEnabled,
                adminRequired,
                userRequired,
                valid,
                authType: role,
                totpEnabled,
                totpRequired,
                profile,
            },
        };
    }
    async superUpdateAdmin(body, req, res) {
        const s = (0, auth_guard_1.currentSession)(req);
        if (!s || s.role !== 'super') {
            return res.status(403).json({ success: false, message: '需要超级管理员权限' });
        }
        const raw = await this.sysConfig.readSecurityRaw();
        raw.auth = raw.auth || {};
        raw.auth.admin = raw.auth.admin || {};
        const newUser = String(body.username || '').trim();
        const newPass = String(body.password || '');
        if (newUser)
            raw.auth.admin.adminUsername = newUser;
        if (newPass)
            raw.auth.admin.adminPassword = (0, secret_1.hashSecret)(newPass);
        await this.sysConfig.writeSecurityRaw(raw);
        if (newUser || newPass) {
            const admin = await prisma_1.prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
            if (admin) {
                await prisma_1.prisma.user.update({
                    where: { id: admin.id },
                    data: {
                        username: newUser || admin.username,
                        passwordHash: newPass ? crypto_service_1.CryptoService.hashPassword(newPass) : admin.passwordHash,
                    },
                });
            }
        }
        return res.json({ success: true, message: '管理员账户已更新' });
    }
    logout(res) {
        res.clearCookie(auth_guard_1.SESSION_COOKIE, { path: '/' });
        return res.json({ success: true });
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('login'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('adminLogin'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "adminLogin", null);
__decorate([
    (0, common_1.Post)('totp/verify'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "totpVerify", null);
__decorate([
    (0, common_1.Post)('verify'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "verifySecond", null);
__decorate([
    (0, common_1.Post)('email/send'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "sendLoginCode", null);
__decorate([
    (0, common_1.Post)('password/forgot'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "forgotPassword", null);
__decorate([
    (0, common_1.Post)('password/reset'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "resetPassword", null);
__decorate([
    (0, common_1.Post)('totp/disable-fallback'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "disableTotpFallback", null);
__decorate([
    (0, common_1.Get)('totp/status'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "totpStatus", null);
__decorate([
    (0, common_1.Get)('sessionCheck'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "sessionCheck", null);
__decorate([
    (0, common_1.Post)('superUpdateAdmin'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "superUpdateAdmin", null);
__decorate([
    (0, common_1.Post)('logout'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "logout", null);
exports.AuthController = AuthController = AuthController_1 = __decorate([
    (0, common_1.Controller)('api/auth'),
    __metadata("design:paramtypes", [sysconfig_service_1.SysConfigService, mail_service_1.MailService])
], AuthController);
function maskEmail(raw) {
    const s = String(raw || '').trim();
    const at = s.indexOf('@');
    if (at <= 0)
        return s;
    const name = s.slice(0, at);
    const domain = s.slice(at);
    return `${name.slice(0, 3)}***${domain}`;
}
function buildForgotMail(o) {
    return `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.06);">
    <div style="padding:20px 24px;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;">
      <div style="font-size:16px;font-weight:600;">GoHub 重置密码</div>
    </div>
    <div style="padding:24px;color:#303133;font-size:14px;line-height:1.8;">
      <p style="margin:0 0 12px;">你好，${escapeHtml(o.name)}：</p>
      <p style="margin:0 0 18px;">我们收到了你的「忘记密码」请求。点击下面的按钮设置新密码（链接 ${o.minutes} 分钟内有效，且只能使用一次）：</p>
      <div style="text-align:center;margin:0 0 18px;">
        <a href="${o.link}" style="display:inline-block;padding:12px 28px;border-radius:10px;background:#1d4ed8;color:#fff;font-size:15px;font-weight:600;text-decoration:none;">重置密码</a>
      </div>
      <p style="margin:0 0 8px;color:#606266;">如果按钮无法点击，请复制下面的链接到浏览器打开：</p>
      <p style="margin:0 0 18px;word-break:break-all;color:#1d4ed8;">${o.link}</p>
      <p style="margin:0;color:#909399;font-size:12px;">如非本人操作，请忽略本邮件；账户密码不会被更改。</p>
    </div>
    <div style="padding:14px 24px;border-top:1px solid #f0f2f5;color:#a8abb2;font-size:12px;">
      此邮件由 GoHub 自动发送，请勿直接回复。
    </div>
  </div>
</body></html>`;
}
function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
