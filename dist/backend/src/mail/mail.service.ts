import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { SysConfigService } from '../settings/sysconfig.service';
import { CryptoService } from '../common/crypto.service';
import { appLog } from '../common/app-log';
import type { Transporter } from 'nodemailer';

/** 发信配置（存于 settings 表的 sysConfig:security → mail） */
export interface MailConfig {
  enabled: boolean;
  host: string;
  port: number;
  /** true = 465 隐式 TLS；false = 25/587 STARTTLS */
  secure: boolean;
  user: string;
  /** 库里存的是 AES-GCM 密文；读出来是明文，对外接口一律不回传 */
  pass: string;
  fromName: string;
  /** 发信地址；空 = 用 SMTP 账号（多数邮箱要求两者一致） */
  fromAddress: string;
  replyTo: string;
}

export const MAIL_DEFAULTS: MailConfig = {
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

/** 验证码有效期（毫秒） */
const CODE_TTL = 10 * 60 * 1000;
/** 同一邮箱两次发码的最小间隔（毫秒）—— 防刷 */
const SEND_GAP = 60 * 1000;
/** 单个验证码最多试错次数 */
const MAX_ATTEMPTS = 5;

/**
 * v2.6.0（v20261024-1）：验证码改为 6 位「大小写字母 + 数字」混合（不再纯数字）。
 * 密码学安全随机（randomInt）；校验时不区分大小写（用户手输大小写不应影响通过）。
 */
const EMAIL_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function generateEmailCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += EMAIL_CODE_ALPHABET[randomInt(EMAIL_CODE_ALPHABET.length)];
  return s;
}

export type MailPurpose = 'verify-email' | 'login' | 'disable-2fa' | 'change-password';

interface CodeEntry {
  code: string;
  purpose: MailPurpose;
  expiresAt: number;
  attempts: number;
  sentAt: number;
}

/**
 * 邮件服务（v2.3.0）。
 *
 * 职责：
 *   1) 读写「安全设置 → 邮箱配置」（密码 AES-GCM 加密，接口脱敏）；
 *   2) 发送验证码 / 通知邮件（nodemailer，支持 465 隐式 TLS 与 587 STARTTLS）；
 *   3) 验证码的签发与校验（进程内内存，10 分钟过期，5 次试错上限，60 秒发送间隔）。
 *
 * 验证码为什么放内存不上库：验证码是「短时一次性凭据」，重启后失效反而更安全；
 * 图床是单实例常驻服务，进程内 Map 完全够用（多实例部署需要换成 Redis，已在文档注明）。
 */
@Injectable()
export class MailService {
  private codes = new Map<string, CodeEntry>();
  private transporter: Transporter | null = null;
  private transporterKey = '';

  constructor(private sysConfig: SysConfigService) {}

  /* ---------------- 配置 ---------------- */

  /** 读取配置（含解密后的明文密码）—— 仅后端内部使用 */
  async config(): Promise<MailConfig> {
    try {
      const raw = await this.sysConfig.readSecurityRaw();
      const m = raw?.mail || {};
      const merged: MailConfig = {
        ...MAIL_DEFAULTS,
        ...m,
        port: Number(m.port) || MAIL_DEFAULTS.port,
        secure: m.secure !== false,
      };
      // 密码可能是密文（新写入）或历史明文（直接改库场景）
      if (merged.pass && merged.pass.startsWith('enc:')) {
        merged.pass = CryptoService.decrypt(merged.pass.slice(4));
      }
      return merged;
    } catch {
      return { ...MAIL_DEFAULTS };
    }
  }

  /** 是否可用于发信 */
  async configured(): Promise<boolean> {
    const c = await this.config();
    return !!(c.enabled && c.host && c.port && c.user);
  }

  /** 对外展示用的配置（密码脱敏） */
  async publicConfig(): Promise<Record<string, unknown>> {
    const c = await this.config();
    return {
      ...c,
      pass: '',
      hasPass: !!c.pass,
      ready: !!(c.enabled && c.host && c.port && c.user),
    };
  }

  /** 把明文密码加密后落库（保存配置时调用） */
  static sealPassword(plain: string): string {
    return plain ? `enc:${CryptoService.encrypt(plain)}` : '';
  }

  private async transport(): Promise<Transporter> {
    const c = await this.config();
    return this.transportOf(c);
  }

  /** 按给定配置取（或建）transport；自检/测试邮件用表单值时走这里 */
  private async transportOf(c: MailConfig): Promise<Transporter> {
    const key = `${c.host}:${c.port}:${c.secure}:${c.user}:${c.pass.length}`;
    if (this.transporter && this.transporterKey === key) return this.transporter;
    const t = await this.createTransport(c);
    this.transporter = t;
    this.transporterKey = key;
    return t;
  }

  private async createTransport(c: MailConfig): Promise<Transporter> {
    const nodemailer = await import('nodemailer');
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

  /* ---------------- 发信 ---------------- */

  private from(c: MailConfig): string {
    const addr = c.fromAddress || c.user;
    return c.fromName ? `"${c.fromName}" <${addr}>` : addr;
  }

  /** 发送一封 HTML 邮件；未配置时抛错（调用方负责转成友好提示） */
  async send(to: string, subject: string, html: string, text?: string): Promise<void> {
    const c = await this.config();
    return this.sendWithConfig(c, to, subject, html, text);
  }

  /** 发送邮件（可携带表单当前值覆盖库中配置 —— 测试邮件按钮用） */
  async sendWithOverride(
    override: Partial<MailConfig> | null | undefined,
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<void> {
    const c = await this.effectiveConfig(override);
    return this.sendWithConfig(c, to, subject, html, text);
  }

  private async sendWithConfig(c: MailConfig, to: string, subject: string, html: string, text?: string): Promise<void> {
    if (!c.enabled) throw new Error('邮箱服务未启用，请先在「安全设置 → 邮箱配置」中启用并填写 SMTP 信息');
    if (!c.host || !c.user) throw new Error('邮箱配置不完整（缺少 SMTP 服务器或账号）');
    const target = String(to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) throw new Error('收件邮箱格式不正确');
    const t = await this.transportOf(c);
    await t.sendMail({
      from: this.from(c),
      to: target,
      replyTo: c.replyTo || undefined,
      subject,
      text: text || html.replace(/<[^>]+>/g, ' '),
      html,
    });
    appLog.info('mail', `已发送邮件「${subject}」→ ${target}`);
  }

  /**
   * 把「表单当前值」合并进库中配置（连接自检 / 测试邮件用）。
   * 为什么需要：用户改完表单还没点保存时，自检也应该测表单里的值，
   * 否则会出现「表单明明填了，自检却说未填写」的困惑（v2.4.0 修复）。
   * pass 为空时回退到库中已存密码（前端在「已设密码不改」场景会留空）。
   */
  private async effectiveConfig(override?: Partial<MailConfig> | null): Promise<MailConfig> {
    const stored = await this.config();
    if (!override || typeof override !== 'object') return stored;
    const merged: MailConfig = { ...stored };
    for (const k of ['enabled', 'host', 'port', 'secure', 'user', 'fromName', 'fromAddress', 'replyTo'] as const) {
      if (override[k] !== undefined) (merged as any)[k] = override[k] as any;
    }
    if (override.pass) merged.pass = String(override.pass);
    merged.port = Number(merged.port) || MAIL_DEFAULTS.port;
    merged.secure = merged.secure !== false;
    return merged;
  }

  /** 连通性自检（「连接自检」按钮；可携带表单当前值） */
  async verify(override?: Partial<MailConfig> | null): Promise<{ ok: boolean; message: string }> {
    const c = await this.effectiveConfig(override);
    if (!c.host) return { ok: false, message: '未填写 SMTP 服务器地址' };
    if (!c.user) return { ok: false, message: '未填写 SMTP 账号（发信邮箱地址）' };
    try {
      const t = await this.transportOf(c);
      await t.verify();
      return { ok: true, message: 'SMTP 连接成功' };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  /* ---------------- 验证码 ---------------- */

  /**
   * 签发并发送验证码。
   * @param email   目标邮箱
   * @param purpose 用途（不同用途的码不通用，防止「验证邮箱的码被拿去当登录码」）
   */
  async sendCode(email: string, purpose: MailPurpose, displayName = ''): Promise<{ ok: boolean; message: string }> {
    const target = String(email || '').trim().toLowerCase();
    if (!target) return { ok: false, message: '该账户未填写邮箱' };
    const key = `${purpose}:${target}`;
    const prev = this.codes.get(key);
    const now = Date.now();
    if (prev && now - prev.sentAt < SEND_GAP) {
      const wait = Math.ceil((SEND_GAP - (now - prev.sentAt)) / 1000);
      return { ok: false, message: `发送过于频繁，请 ${wait} 秒后再试` };
    }
    const code = generateEmailCode();
    this.codes.set(key, { code, purpose, expiresAt: now + CODE_TTL, attempts: 0, sentAt: now });
    // 顺手清理过期项，避免 Map 无限增长
    if (this.codes.size > 500) {
      for (const [k, v] of this.codes) if (v.expiresAt < now) this.codes.delete(k);
    }

    const titles: Record<MailPurpose, string> = {
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
      hint:
        purpose === 'disable-2fa'
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
    } catch (err) {
      this.codes.delete(key);
      return { ok: false, message: (err as Error).message };
    }
  }

  /**
   * 校验验证码。
   * 校验成功即销毁（一次性）；失败累加试错次数，超过 MAX_ATTEMPTS 直接作废。
   */
  consumeCode(email: string, purpose: MailPurpose, code: string): { ok: boolean; message: string } {
    const target = String(email || '').trim().toLowerCase();
    const key = `${purpose}:${target}`;
    const entry = this.codes.get(key);
    if (!entry) return { ok: false, message: '请先获取验证码' };
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

  /**
   * 校验验证码（多用途兼容）。
   *
   * 为什么需要它：同一件事在不同入口签发的验证码用途可能不同 ——
   * 例如「遗忘验证器 → 关闭两步验证」既可以在登录页点「发送邮箱验证码」（purpose=login），
   * 也可以在用户编辑页点「发送关闭验证码」（purpose=disable-2fa）。
   * 这里只对「确实存在未过期验证码」的用途做校验，不会凭空消耗其它用途的试错次数。
   */
  consumeAnyCode(email: string, purposes: MailPurpose[], code: string): { ok: boolean; message: string } {
    const target = String(email || '').trim().toLowerCase();
    let last = '请先获取验证码';
    for (const p of purposes) {
      if (!this.codes.has(`${p}:${target}`)) continue;
      const r = this.consumeCode(target, p, code);
      if (r.ok) return r;
      last = r.message;
    }
    return { ok: false, message: last };
  }
}

/** 验证码邮件模板（内联样式，兼容 QQ / 163 / Gmail） */
function buildCodeMail(o: { title: string; code: string; name: string; minutes: number; hint: string }): string {
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

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
