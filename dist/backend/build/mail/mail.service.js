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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailService = exports.MAIL_DEFAULTS = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const sysconfig_service_1 = require("../settings/sysconfig.service");
const crypto_service_1 = require("../common/crypto.service");
const app_log_1 = require("../common/app-log");
exports.MAIL_DEFAULTS = {
    enabled: false,
    host: '',
    port: 465,
    secure: true,
    user: '',
    pass: '',
    fromName: 'GoHub',
    fromAddress: '',
    replyTo: '',
};
const CODE_TTL = 10 * 60 * 1000;
const SEND_GAP = 60 * 1000;
const MAX_ATTEMPTS = 5;
const EMAIL_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function generateEmailCode() {
    let s = '';
    for (let i = 0; i < 6; i++)
        s += EMAIL_CODE_ALPHABET[(0, crypto_1.randomInt)(EMAIL_CODE_ALPHABET.length)];
    return s;
}
let MailService = class MailService {
    sysConfig;
    codes = new Map();
    transporter = null;
    transporterKey = '';
    constructor(sysConfig) {
        this.sysConfig = sysConfig;
    }
    async config() {
        try {
            const raw = await this.sysConfig.readSecurityRaw();
            const m = raw?.mail || {};
            const merged = {
                ...exports.MAIL_DEFAULTS,
                ...m,
                port: Number(m.port) || exports.MAIL_DEFAULTS.port,
                secure: m.secure !== false,
            };
            if (merged.pass && merged.pass.startsWith('enc:')) {
                merged.pass = crypto_service_1.CryptoService.decrypt(merged.pass.slice(4));
            }
            return merged;
        }
        catch {
            return { ...exports.MAIL_DEFAULTS };
        }
    }
    async configured() {
        const c = await this.config();
        return !!(c.enabled && c.host && c.port && c.user);
    }
    async publicConfig() {
        const c = await this.config();
        return {
            ...c,
            pass: '',
            hasPass: !!c.pass,
            ready: !!(c.enabled && c.host && c.port && c.user),
        };
    }
    static sealPassword(plain) {
        return plain ? `enc:${crypto_service_1.CryptoService.encrypt(plain)}` : '';
    }
    async transport() {
        const c = await this.config();
        return this.transportOf(c);
    }
    async transportOf(c) {
        const key = `${c.host}:${c.port}:${c.secure}:${c.user}:${c.pass.length}`;
        if (this.transporter && this.transporterKey === key)
            return this.transporter;
        const t = await this.createTransport(c);
        this.transporter = t;
        this.transporterKey = key;
        return t;
    }
    async createTransport(c) {
        const nodemailer = await Promise.resolve().then(() => __importStar(require('nodemailer')));
        return nodemailer.createTransport({
            host: c.host,
            port: c.port,
            secure: c.secure,
            auth: c.user ? { user: c.user, pass: c.pass } : undefined,
            connectionTimeout: 15_000,
            greetingTimeout: 15_000,
            socketTimeout: 20_000,
        });
    }
    from(c) {
        const addr = c.fromAddress || c.user;
        return c.fromName ? `"${c.fromName}" <${addr}>` : addr;
    }
    async send(to, subject, html, text) {
        const c = await this.config();
        return this.sendWithConfig(c, to, subject, html, text);
    }
    async sendWithOverride(override, to, subject, html, text) {
        const c = await this.effectiveConfig(override);
        return this.sendWithConfig(c, to, subject, html, text);
    }
    async sendWithConfig(c, to, subject, html, text) {
        if (!c.enabled)
            throw new Error('邮箱服务未启用，请先在「安全设置 → 邮箱配置」中启用并填写 SMTP 信息');
        if (!c.host || !c.user)
            throw new Error('邮箱配置不完整（缺少 SMTP 服务器或账号）');
        const target = String(to || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target))
            throw new Error('收件邮箱格式不正确');
        const t = await this.transportOf(c);
        await t.sendMail({
            from: this.from(c),
            to: target,
            replyTo: c.replyTo || undefined,
            subject,
            text: text || html.replace(/<[^>]+>/g, ' '),
            html,
        });
        app_log_1.appLog.info('mail', `已发送邮件「${subject}」→ ${target}`);
    }
    async effectiveConfig(override) {
        const stored = await this.config();
        if (!override || typeof override !== 'object')
            return stored;
        const merged = { ...stored };
        for (const k of ['enabled', 'host', 'port', 'secure', 'user', 'fromName', 'fromAddress', 'replyTo']) {
            if (override[k] !== undefined)
                merged[k] = override[k];
        }
        if (override.pass)
            merged.pass = String(override.pass);
        merged.port = Number(merged.port) || exports.MAIL_DEFAULTS.port;
        merged.secure = merged.secure !== false;
        return merged;
    }
    async verify(override) {
        const c = await this.effectiveConfig(override);
        if (!c.host)
            return { ok: false, message: '未填写 SMTP 服务器地址' };
        if (!c.user)
            return { ok: false, message: '未填写 SMTP 账号（发信邮箱地址）' };
        try {
            const t = await this.transportOf(c);
            await t.verify();
            return { ok: true, message: 'SMTP 连接成功' };
        }
        catch (err) {
            return { ok: false, message: err.message };
        }
    }
    async sendCode(email, purpose, displayName = '') {
        const target = String(email || '').trim().toLowerCase();
        if (!target)
            return { ok: false, message: '该账户未填写邮箱' };
        const key = `${purpose}:${target}`;
        const prev = this.codes.get(key);
        const now = Date.now();
        if (prev && now - prev.sentAt < SEND_GAP) {
            const wait = Math.ceil((SEND_GAP - (now - prev.sentAt)) / 1000);
            return { ok: false, message: `发送过于频繁，请 ${wait} 秒后再试` };
        }
        const code = generateEmailCode();
        this.codes.set(key, { code, purpose, expiresAt: now + CODE_TTL, attempts: 0, sentAt: now });
        if (this.codes.size > 500) {
            for (const [k, v] of this.codes)
                if (v.expiresAt < now)
                    this.codes.delete(k);
        }
        const titles = {
            'verify-email': '邮箱验证',
            login: '登录验证码',
            'disable-2fa': '关闭两步验证',
            'change-password': '修改密码',
        };
        const subject = `【GoHub】${titles[purpose]}验证码：${code}`;
        const html = buildCodeMail({
            title: `GoHub ${titles[purpose]}`,
            code,
            name: displayName || target,
            minutes: Math.round(CODE_TTL / 60000),
            hint: purpose === 'disable-2fa'
                ? '该验证码用于「关闭两步验证」，输入验证码或一枚恢复码（任一）即可关闭。'
                : purpose === 'login'
                    ? '在两步验证弹窗里输入该验证码即可进入管理中心。'
                    : purpose === 'change-password'
                        ? '在用户编辑页输入该验证码即可完成身份验证并修改密码。'
                        : '将该验证码填入「验证邮箱」弹窗即可完成验证。',
        });
        try {
            await this.send(target, subject, html);
            return { ok: true, message: '验证码已发送' };
        }
        catch (err) {
            this.codes.delete(key);
            return { ok: false, message: err.message };
        }
    }
    consumeCode(email, purpose, code) {
        const target = String(email || '').trim().toLowerCase();
        const key = `${purpose}:${target}`;
        const entry = this.codes.get(key);
        if (!entry)
            return { ok: false, message: '请先获取验证码' };
        if (Date.now() > entry.expiresAt) {
            this.codes.delete(key);
            return { ok: false, message: '验证码已过期，请重新获取' };
        }
        entry.attempts += 1;
        if (entry.attempts > MAX_ATTEMPTS) {
            this.codes.delete(key);
            return { ok: false, message: '验证码错误次数过多，请重新获取' };
        }
        if (String(code || '').trim().toUpperCase() !== entry.code.toUpperCase()) {
            return { ok: false, message: `验证码不正确（还可尝试 ${Math.max(0, MAX_ATTEMPTS - entry.attempts)} 次）` };
        }
        this.codes.delete(key);
        return { ok: true, message: '验证通过' };
    }
    consumeAnyCode(email, purposes, code) {
        const target = String(email || '').trim().toLowerCase();
        let last = '请先获取验证码';
        for (const p of purposes) {
            if (!this.codes.has(`${p}:${target}`))
                continue;
            const r = this.consumeCode(target, p, code);
            if (r.ok)
                return r;
            last = r.message;
        }
        return { ok: false, message: last };
    }
};
exports.MailService = MailService;
exports.MailService = MailService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [sysconfig_service_1.SysConfigService])
], MailService);
function buildCodeMail(o) {
    return `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.06);">
    <div style="padding:20px 24px;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;">
      <div style="font-size:16px;font-weight:600;">${escapeHtml(o.title)}</div>
    </div>
    <div style="padding:24px;color:#303133;font-size:14px;line-height:1.8;">
      <p style="margin:0 0 12px;">你好，${escapeHtml(o.name)}：</p>
      <p style="margin:0 0 18px;">你正在进行身份验证，请在页面中输入下面的验证码：</p>
      <div style="text-align:center;margin:0 0 18px;">
        <span style="display:inline-block;padding:12px 22px;border-radius:10px;background:#f0f5ff;color:#1d4ed8;font-size:28px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,Menlo,Consolas,monospace;">${escapeHtml(o.code)}</span>
      </div>
      <p style="margin:0 0 8px;color:#606266;">${escapeHtml(o.hint)}</p>
      <p style="margin:0;color:#909399;font-size:12px;">验证码 ${o.minutes} 分钟内有效，请勿转发给他人。如非本人操作，请忽略本邮件并尽快修改密码。</p>
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
