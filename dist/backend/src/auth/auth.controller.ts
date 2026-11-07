import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { prisma } from '../common/prisma';
import { CryptoService } from '../common/crypto.service';
import { hashSecret, isHashedSecret, matchSecret, safeEqual } from '../common/secret';
import { SESSION_COOKIE, Role, currentSession, frontValid, makeSession, parseSession, totpValid } from './auth.guard';
import { SysConfigService } from '../settings/sysconfig.service';
import { verifyTotp } from '../common/totp';
import { consumeRecoveryCode, countRecoveryCodes } from '../common/recovery';
import { MailService } from '../mail/mail.service';
import { appLog } from '../common/app-log';

/** 会话有效期默认值（天）—— 账户未设置时生效（v202610221824） */
const DEFAULT_SESSION_DAYS = 7;
/** 超级管理员会话有效期（天）—— v1.0.3：固定 1 天，不可配置 */
const SUPER_ADMIN_SESSION_DAYS = 1;

/**
 * 认证接口 —— 统一账户体系。
 *
 *   POST /api/auth/login        { username, password }  统一登录（管理员 / 普通用户 / 超级管理员）
 *   POST /api/auth/adminLogin   { username, password }  兼容旧前端：等价于 login
 *   GET  /api/auth/sessionCheck                         会话与「是否需要认证」探测
 *   POST /api/auth/logout
 *   POST /api/auth/superUpdateAdmin                     超级管理员专用：修改管理员用户名/密码
 *
 * 账户来源优先级：
 *   1. 超级管理员 —— 仅由 docker 环境变量 SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD 定义，
 *      后台不可修改；用于初始管理员密码遗忘后的找回，登录后仅能修改管理员账户。
 *   2. users 表 —— 后台「用户管理」创建的账户（管理员 / 普通用户）。
 *   3. 安全设置 sysConfig:security —— 历史管理员账号（兼容保留，登录成功后自动升级为散列）。
 *   4. 环境变量 ADMIN_USER / ADMIN_PASSWORD —— 首次部署兜底。
 *
 * 说明：旧版「用户认证码(authCode)」已废弃，上传页改为用户名 + 密码登录；
 * 这里仍保留 authCode 登录入口作兼容，登录后角色为 user。
 */
@Controller('api/auth')
export class AuthController {
  constructor(private sysConfig: SysConfigService, private mail: MailService) {}

  /* ================= v2.7.0：2FA 验证码错误锁定（分用户） =================
   * 规则（需求约定）：
   *   · 每个用户独立统计（按用户名）；
   *   · 第一次输错时记录时间，自该时间起 1 小时为一个统计窗口（固定窗口，
   *     超过 1 小时清空重新计算）；
   *   · 窗口内累计输错 6 次 → 锁定 30 分钟，期间拒绝验证；锁定期满自动解锁；
   *   · 验证成功立即清零。
   * 内存级存储：单实例部署下够用，进程重启即清零（对爆破者反而更严格窗口重置）。
   */
  private static readonly TOTP_FAIL_MAX = 6;          // 窗口内允许的最大错误次数
  private static readonly TOTP_FAIL_WINDOW_MS = 60 * 60 * 1000;   // 1 小时统计窗口
  private static readonly TOTP_LOCK_MS = 30 * 60 * 1000;          // 锁定 30 分钟
  private totpFailStore = new Map<string, { firstFailAt: number; count: number; lockedUntil: number }>();

  /** 查询某用户的 2FA 锁定状态（顺带做窗口过期惰性清理） */
  private totpLockState(username: string): { locked: boolean; remainingMs: number; count: number } {
    const st = this.totpFailStore.get(username);
    if (!st) return { locked: false, remainingMs: 0, count: 0 };
    const now = Date.now();
    if (st.lockedUntil > now) return { locked: true, remainingMs: st.lockedUntil - now, count: st.count };
    // 窗口过期（自首次失败起 1 小时）→ 清空重算
    if (now - st.firstFailAt >= AuthController.TOTP_FAIL_WINDOW_MS) {
      this.totpFailStore.delete(username);
      return { locked: false, remainingMs: 0, count: 0 };
    }
    return { locked: false, remainingMs: 0, count: st.count };
  }

  /** 记录一次 2FA 验证失败；达到阈值时触发 30 分钟锁定 */
  private totpRecordFailure(username: string): { count: number; locked: boolean; remainingMs: number } {
    const now = Date.now();
    const st = this.totpFailStore.get(username);
    if (!st || now - st.firstFailAt >= AuthController.TOTP_FAIL_WINDOW_MS) {
      // 首次失败：记录时间，计数 1
      this.totpFailStore.set(username, { firstFailAt: now, count: 1, lockedUntil: 0 });
      return { count: 1, locked: false, remainingMs: 0 };
    }
    st.count += 1;
    if (st.count >= AuthController.TOTP_FAIL_MAX) {
      st.lockedUntil = now + AuthController.TOTP_LOCK_MS;
      return { count: st.count, locked: true, remainingMs: AuthController.TOTP_LOCK_MS };
    }
    return { count: st.count, locked: false, remainingMs: 0 };
  }

  /** 验证成功：清空该用户的失败计数 */
  private totpClearFailures(username: string): void {
    this.totpFailStore.delete(username);
  }

  /** 读取「安全设置」中的账号配置（原始值，含散列/历史明文） */
  private async authConfig(): Promise<any> {
    try {
      const raw = await this.sysConfig.readSecurityRaw();
      const auth = raw?.auth;
      return auth && typeof auth === 'object' ? auth : {};
    } catch {
      return {};
    }
  }

  /** 管理端账号是否已配置（安全设置 / 用户表 / 环境变量任一存在） */
  private async isAdminConfigured(auth: any): Promise<boolean> {
    if (String(auth?.admin?.adminPassword || '')) return true;
    if (process.env.ADMIN_USER || process.env.ADMIN_PASSWORD) return true;
    try {
      return (await prisma.user.count({ where: { role: 'admin' } })) > 0;
    } catch {
      return false;
    }
  }

  /** 是否存在可登录账户 → 上传页 / 后台是否需要登录（v202610221824 起只看 users 表） */
  private async isUserConfigured(_auth?: any): Promise<boolean> {
    try {
      return (await prisma.user.count()) > 0;
    } catch {
      return false;
    }
  }

  /**
   * 统一账户校验：超管 → users 表 → 历史环境变量兜底。
   * 返回账户信息或 null。
   *
   * v202610221824 起账户体系收敛：
   *   - 「上传密码」通道彻底下线，登录只认账户自身的用户名 + 密码；
   *   - 安全设置里的「管理端认证」不再参与登录（管理员就是 users 表里 role='admin' 的那条记录），
   *     仅当 users 表里一条管理员都没有时才作为历史兜底，避免老部署升级后直接锁死；
   *   - 用户名 / 密码的管理统一收到「用户管理」里。
   */
  private async verifyAccount(
    username: string,
    password: string,
  ): Promise<{
    user: string;
    role: Role;
    enabled: boolean;
    canEdit: boolean;
    canDelete: boolean;
    totpEnabled: boolean;
    frontDays: number;
    backDays: number;
  } | null> {
    if (!username || !password) return null;

    // 1) 超级管理员（仅 .env 配置）
    const suUser = (process.env.SUPER_ADMIN_USERNAME || '').trim();
    const suPass = process.env.SUPER_ADMIN_PASSWORD || '';
    if (suUser && suPass && safeEqual(username, suUser) && matchSecret(password, suPass)) {
      return {
        user: suUser,
        role: 'super',
        enabled: true,
        canEdit: true,
        canDelete: true,
        totpEnabled: false,
        /*
         * v1.0.3：超级管理员是「应急找回」角色，不该长期挂着登录态。
         * 会话固定 1 天、不读「用户管理」里的账户设置、也不做可配置项 ——
         * 用完就过期，避免长期有效的超管凭据留在浏览器里。
         * （管理员 admin 走下面的 users 表分支，按各自账户的 frontSessionDays 生效。）
         */
        frontDays: SUPER_ADMIN_SESSION_DAYS,
        backDays: SUPER_ADMIN_SESSION_DAYS,
      };
    }

    // 2) users 表（管理员与普通用户都在这里）
    const u = await prisma.user.findUnique({ where: { username } });
    if (u) {
      if (!u.enabled) return null;
      if (!CryptoService.verifyPassword(password, u.passwordHash)) return null;
      return {
        user: u.username,
        role: (u.role === 'admin' ? 'admin' : 'user') as Role,
        enabled: u.enabled,
        canEdit: u.canEdit,
        canDelete: u.canDelete,
        totpEnabled: u.totpEnabled,
        frontDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
        backDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
      };
    }

    // 3) 历史兜底：users 表里没有任何管理员时，才认安全设置里的管理端账号
    const hasAdmin = (await prisma.user.count({ where: { role: 'admin' } })) > 0;
    if (!hasAdmin) {
      const auth = await this.authConfig();
      const cfgPass = String(auth?.admin?.adminPassword || '');
      if (cfgPass) {
        const cfgUser = String(auth?.admin?.adminUsername || '').trim() || 'admin';
        if (safeEqual(username, cfgUser) && matchSecret(password, cfgPass)) {
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
      // 4) 环境变量初始账号（同上，仅全新空库时生效）
      const envUser = process.env.ADMIN_USER || 'admin';
      const envPass = process.env.ADMIN_PASSWORD || 'gohub';
      if (safeEqual(username, envUser) && safeEqual(password, envPass)) {
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

  /*
   * 「用户端认证 / 上传密码」通道已于 v202610221824 下线：
   * 用户登录只认自身账户的用户名 + 密码，不再接受安全设置里配置的公共上传口令。
   * 相关的 matchUserAuthCode / verifyAuthCode / upgradeUserSecret 一并删除。
   */

  /** 把历史明文管理端口令原地升级为散列 */
  private async upgradeAdminSecret(stored: string): Promise<void> {
    if (isHashedSecret(stored)) return;
    const raw = await this.sysConfig.readSecurityRaw();
    const cur = String(raw?.auth?.admin?.adminPassword || '');
    if (!cur || isHashedSecret(cur)) return;
    raw.auth.admin.adminPassword = hashSecret(cur);
    await this.sysConfig.writeSecurityRaw(raw);
  }

  /**
   * 会话有效期（天）——
   * v202610221824 起从「安全设置 → 会话安全策略」迁移到「用户管理 → 每个账户」：
   *   frontSessionDays 管前端页（上传页/画廊/历史记录），到期需重新登录；
   *   backSessionDays  管后台页（系统管理/用户管理/文件管理），到期只需重新做两步验证。
   * 账户未设置（null）时按 DEFAULT_SESSION_DAYS（7 天）处理，0 表示永久。
   */
  private sessionDaysOf(days: number | null | undefined): number {
    const n = Number(days);
    if (!Number.isFinite(n)) return DEFAULT_SESSION_DAYS;
    if (n === 0) return 0;
    if (n < 0) return DEFAULT_SESSION_DAYS;
    return Math.floor(n);
  }

  /**
   * 「Secure 模式」（安全设置 → 会话安全策略）：开启后会话 Cookie 只随 HTTPS 传输。
   *
   * 注意：仅在请求确实走 HTTPS 时才打 Secure 标记 —— http 部署（内网 IP 直连、
   * 未上证书的测试环境）一旦带上 Secure，浏览器会直接丢弃 Cookie，
   * 表现为「登录成功却立刻掉线」。此开关此前只存不用，等于失效，这里补上。
   */
  private async sessionSecureEnabled(): Promise<boolean> {
    try {
      const security: any = await this.sysConfig.get('security');
      return security?.access?.sessionSecure === true;
    } catch {
      return false;
    }
  }

  /** 请求是否走 HTTPS（兼容反向代理的 x-forwarded-proto） */
  private isHttps(req?: Request): boolean {
    if (!req) return false;
    if ((req as any).secure) return true;
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    return proto === 'https';
  }

  /**
   * 下发会话 Cookie。
   * @param verified 本次是否已通过两步验证（未启用 2FA 的账户恒 true）
   */
  private async setSession(
    res: Response,
    account: { user: string; role: Role; totpEnabled?: boolean; frontDays?: number; backDays?: number },
    req?: Request,
    verified = false,
  ) {
    const { payload, sig, maxAge } = makeSession(account.user, account.role, {
      frontDays: this.sessionDaysOf(account.frontDays),
      backDays: this.sessionDaysOf(account.backDays),
      totpEnabled: !!account.totpEnabled,
      verified: account.totpEnabled ? verified : true,
    });
    const opts: Record<string, unknown> = { httpOnly: true, sameSite: 'lax', path: '/' };
    if (maxAge > 0) opts.maxAge = maxAge;
    if ((await this.sessionSecureEnabled()) && this.isHttps(req)) opts.secure = true;
    res.cookie(SESSION_COOKIE, `${payload}.${sig}`, opts);
  }

  /**
   * 统一登录：用户名 + 密码。
   *
   * 启用两步验证的账户登录成功后 `needTotp: true` —— 此时会话已建立但 `tv=false`，
   * 只能访问前端页面；进后台会被 guard 拦下要求输入动态码（POST /api/auth/totp/verify）。
   */
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { username?: string; password?: string; code?: string },
    @Res() res: Response,
    @Req() req?: Request,
  ) {
    const username = (body.username || '').trim();
    const account = await this.verifyAccount(username, body.password || '');
    if (!account) return res.status(401).json({ success: false, message: '用户名或密码错误' });

    // 登录时一并提交了动态码 → 直接完成两步验证（减少一次交互）
    // v2.3.0 起这里同样接受「恢复码 / 邮箱验证码」，不只是 6 位 TOTP。
    let verified = false;
    if (account.totpEnabled && body.code) {
      const u = await prisma.user.findUnique({ where: { username: account.user } });
      if (u) verified = (await this.verifySecondFactor(u, String(body.code))).ok;
    }
    await this.setSession(res, account, req, verified);
    return res.json({
      success: true,
      data: {
        type: account.role === 'user' ? 'user' : 'admin',
        role: account.role,
        username: account.user,
        // 启用了 2FA 且本次未带/未通过动态码 → 前端弹输入框
        needTotp: account.totpEnabled && !verified,
      },
    });
  }

  /** 兼容旧接口名：行为与 login 完全一致 */
  @Post('adminLogin')
  @HttpCode(200)
  async adminLogin(
    @Body() body: { username?: string; password?: string; code?: string },
    @Res() res: Response,
    @Req() req?: Request,
  ) {
    return this.login(body, res, req);
  }

  /** 校验某账户的动态码（内部：读取加密存储的 TOTP 密钥） */
  private async checkTotp(username: string, code: string): Promise<boolean> {
    const u = await prisma.user.findUnique({ where: { username } });
    if (!u || !u.totpEnabled || !u.totpSecret) return false;
    const ok = this.checkTotpSecret(u.totpSecret, code);
    if (ok) {
      await prisma.user.update({ where: { id: u.id }, data: { backVerifiedAt: new Date() } });
    }
    return ok;
  }

  /** 纯函数式校验 TOTP 密钥（不查库、不落库），供多因子复核复用 */
  private checkTotpSecret(encSecret: string, code: string): boolean {
    let secret = '';
    try {
      secret = CryptoService.decrypt(encSecret);
    } catch {
      return false;
    }
    if (!secret) return false;
    return verifyTotp(secret, code);
  }

  /**
   * 第二因子校验（v2.3.0，v2.6.0 更新判别规则）—— 一次输入框同时接受三种凭据：
   *
   *   1) 含「-」 → 恢复码（新格式 xxxxxx-xxxxxx / 旧格式 xxxx-xxxxx 都认）；
   *   2) 纯 6 位数字 → 先按「验证器动态码（TOTP）」校验，不通过再试邮箱验证码；
   *   3) 其它（v2.6.0 起的 6 位字母数字邮箱验证码） → 先按「邮箱验证码」校验，
   *      再兜底试一次恢复码（用户手输漏掉连字符的场景）。
   *
   * 三者都过不了才返回失败；日志里记录实际命中的方式，便于排查「为什么进不去」。
   */
  private async verifySecondFactor(
    u: { id: string; username: string; totpSecret: string; totpEnabled: boolean; email: string; emailVerified: boolean; recoveryHashes: string },
    code: string,
  ): Promise<{ ok: boolean; method: 'totp' | 'recovery' | 'email' | ''; message?: string }> {
    const raw = String(code || '').trim();
    if (!raw) return { ok: false, method: '', message: '请输入验证码' };

    // —— 恢复码（含连字符的输入优先按恢复码处理）——
    if (raw.includes('-')) {
      const hit = consumeRecoveryCode(u.recoveryHashes, raw);
      if (!hit) return { ok: false, method: '', message: '恢复码无效或已被使用' };
      await prisma.user.update({
        where: { id: u.id },
        data: { recoveryHashes: JSON.stringify(hit.rest), backVerifiedAt: new Date() },
      });
      appLog.warn('auth', `账户「${u.username}」使用恢复码通过两步验证（剩余 ${hit.rest.length} 个）`);
      return { ok: true, method: 'recovery' };
    }

    // —— 纯 6 位数字：先 TOTP ——
    if (/^\d{6}$/.test(raw) && u.totpEnabled && u.totpSecret && this.checkTotpSecret(u.totpSecret, raw)) {
      await prisma.user.update({ where: { id: u.id }, data: { backVerifiedAt: new Date() } });
      return { ok: true, method: 'totp' };
    }

    // —— 再试邮箱验证码（只在确实发过码时才算一次尝试）——
    if (u.email && u.emailVerified) {
      const res = this.mail.consumeCode(u.email, 'login', raw);
      if (res.ok) {
        await prisma.user.update({ where: { id: u.id }, data: { backVerifiedAt: new Date() } });
        appLog.info('auth', `账户「${u.username}」使用邮箱验证码通过两步验证`);
        return { ok: true, method: 'email' };
      }
      // 邮箱码存在但输错 → 把它更具体的提示带出去
      if (!/请先获取验证码/.test(res.message)) {
        return { ok: false, method: '', message: res.message };
      }
    }

    // —— 兜底：恢复码（用户手输漏掉连字符）——
    const hit = consumeRecoveryCode(u.recoveryHashes, raw);
    if (hit) {
      await prisma.user.update({
        where: { id: u.id },
        data: { recoveryHashes: JSON.stringify(hit.rest), backVerifiedAt: new Date() },
      });
      appLog.warn('auth', `账户「${u.username}」使用恢复码（无连字符）通过两步验证（剩余 ${hit.rest.length} 个）`);
      return { ok: true, method: 'recovery' };
    }

    return { ok: false, method: '', message: '验证码不正确或已过期' };
  }

  /**
   * 两步验证（后台门禁）：当前会话已登录但未通过 2FA / 2FA 状态过期时调用。
   * 校验通过后重新签发会话（tva 刷新），不需要重新输入密码。
   * 支持 TOTP 动态码 / 恢复码 / 邮箱验证码三种凭据（v2.3.0）。
   */
  @Post('totp/verify')
  @HttpCode(200)
  async totpVerify(@Body() body: { code?: string }, @Req() req: Request, @Res() res: Response) {
    return this.verifyAndRefresh(body?.code, req, res);
  }

  /** 兼容别名：前端新代码用 /api/auth/verify */
  @Post('verify')
  @HttpCode(200)
  async verifySecond(@Body() body: { code?: string }, @Req() req: Request, @Res() res: Response) {
    return this.verifyAndRefresh(body?.code, req, res);
  }

  private async verifyAndRefresh(code: string | undefined, req: Request, res: Response) {
    const session = parseSession(req.cookies?.[SESSION_COOKIE]);
    if (!session) return res.status(401).json({ success: false, message: '未登录或会话已过期', code: 'NOT_LOGGED_IN' });
    const u = await prisma.user.findUnique({ where: { username: session.user } });
    if (!u) return res.status(401).json({ success: false, message: '账户不存在', code: 'NOT_LOGGED_IN' });
    if (!u.totpEnabled) {
      // 没启用 2FA：直接刷新会话即可（避免前端卡在验证框）
      await this.setSession(res, { user: u.username, role: session.role, totpEnabled: false }, req, true);
      return res.json({ success: true, data: { verified: true } });
    }
    // v2.7.0：验证前先检查该用户是否处于错误锁定期
    const lock = this.totpLockState(u.username);
    if (lock.locked) {
      const remainMin = Math.max(1, Math.ceil(lock.remainingMs / 60000));
      appLog.warn('auth', `账户「${u.username}」2FA 验证处于锁定期（窗口内累计错误 ${lock.count} 次），剩余约 ${remainMin} 分钟，拒绝本次验证`);
      return res.status(400).json({
        success: false,
        message: `验证码错误次数过多，已锁定，请约 ${remainMin} 分钟后再试`,
        code: 'TOTP_LOCKED',
        data: { locked: true, remainMinutes: remainMin },
      });
    }
    const hit = await this.verifySecondFactor(u, String(code || ''));
    if (!hit.ok) {
      // v2.7.0：分用户记录失败次数，窗口内达 6 次锁定 30 分钟
      const fail = this.totpRecordFailure(u.username);
      if (fail.locked) {
        appLog.warn('auth', `账户「${u.username}」2FA 验证错误已达 ${fail.count} 次（1 小时窗口），锁定 30 分钟`);
      } else {
        appLog.warn('auth', `账户「${u.username}」2FA 验证失败（第 ${fail.count}/${AuthController.TOTP_FAIL_MAX} 次，1 小时窗口）`);
      }
      // 注意：这里**不能**清 Cookie / 跳登录页 —— 前端要继续停在验证框上让用户重试
      const suffix = fail.locked
        ? `，已锁定 30 分钟`
        : `（${fail.count}/${AuthController.TOTP_FAIL_MAX}，1 小时内累计 6 次将锁定 30 分钟）`;
      return res.status(400).json({
        success: false,
        message: (hit.message || '验证失败') + suffix,
        code: fail.locked ? 'TOTP_LOCKED' : 'VERIFY_FAILED',
        data: { locked: fail.locked, failCount: fail.count },
      });
    }
    // 验证成功：清零失败计数
    this.totpClearFailures(u.username);
    await this.setSession(
      res,
      {
        user: u.username,
        role: session.role,
        totpEnabled: true,
        frontDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
        backDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
      },
      req,
      true,
    );
    return res.json({ success: true, data: { verified: true, method: hit.method } });
  }

  /**
   * 发送「进入管理中心」用的邮箱验证码（v2.3.0）。
   *
   *   body: { username? }  —— 未登录时用来定位账户；已登录时忽略，直接用会话账户。
   *
   * 安全约束：
   *   · 仅对「已启用两步验证 + 邮箱已验证 + 邮箱服务已配置」的账户发码；
   *   · 无论账户是否存在，接口都返回同一句话，避免成为账户探测接口；
   *   · 单邮箱 60 秒内只允许发一次（MailService 内部限流）。
   */
  @Post('email/send')
  @HttpCode(200)
  async sendLoginCode(@Body() body: { username?: string }, @Req() req: Request) {
    const session = parseSession(req.cookies?.[SESSION_COOKIE]);
    const username = (session?.user || String(body?.username || '').trim() || '').trim();
    const generic = { success: true, message: '如果该账户已绑定并验证邮箱，验证码已发出，请查收' };
    if (!username) return generic;
    const u = await prisma.user.findUnique({ where: { username } });
    if (!u || !u.enabled || !u.totpEnabled || !u.email || !u.emailVerified) return generic;
    if (!(await this.mail.configured())) {
      return { success: false, message: '管理员尚未配置发信邮箱，请改用验证器动态码或恢复码' };
    }
    const r = await this.mail.sendCode(u.email, 'login', u.nickname || u.username);
    if (!r.ok) return { success: false, message: r.message };
    // v2.6.0：data.email = 脱敏邮箱（abc***@126.com），前端弹窗提示语要用
    return {
      success: true,
      message: `验证码已发送至 ${maskEmail(u.email)}`,
      data: { email: maskEmail(u.email) },
    };
  }

  /* ---------------- v2.6.0：忘记密码（邮件链接重置，10 分钟有效） ---------------- */

  /** 重置令牌（进程内内存）：token → { username, expiresAt }；一次性，用完即删 */
  private static passwordResetTokens = new Map<string, { username: string; expiresAt: number }>();
  private static PASSWORD_RESET_TTL = 10 * 60 * 1000;

  /**
   * POST /api/auth/password/forgot  { username, email }
   * 用户名 + 邮箱都匹配（且邮箱已验证）才发重置链接；无论是否匹配都返回同一句话，
   * 避免成为账户/邮箱枚举接口。链接 10 分钟有效，一次性。
   */
  @Post('password/forgot')
  @HttpCode(200)
  async forgotPassword(@Body() body: { username?: string; email?: string }, @Req() req: Request) {
    const generic = {
      success: true,
      message: '如果用户名与邮箱匹配，重置链接已发送，请前往邮箱查收（10 分钟内有效）',
    };
    const username = String(body?.username || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    if (!username || !email) return generic;
    const u = await prisma.user.findUnique({ where: { username } });
    if (!u || !u.enabled) return generic;
    if (!u.email || !u.emailVerified || u.email.trim().toLowerCase() !== email) return generic;
    if (!(await this.mail.configured())) {
      return { success: false, message: '管理员尚未配置发信邮箱，请联系管理员重置密码' };
    }
    // 60 秒内同一账户只发一次
    for (const [, v] of AuthController.passwordResetTokens) {
      if (v.username === u.username && v.expiresAt > Date.now() + AuthController.PASSWORD_RESET_TTL - 60 * 1000) {
        return { success: false, message: '重置链接已发送，请 60 秒后再试或直接查收邮件' };
      }
    }
    const token = randomBytes(24).toString('hex');
    AuthController.passwordResetTokens.set(token, {
      username: u.username,
      expiresAt: Date.now() + AuthController.PASSWORD_RESET_TTL,
    });
    // 顺手清理过期令牌
    if (AuthController.passwordResetTokens.size > 200) {
      const now = Date.now();
      for (const [k, v] of AuthController.passwordResetTokens) if (v.expiresAt < now) AuthController.passwordResetTokens.delete(k);
    }
    // 重置链接指向前端页面（后端与前端同源部署，直接用请求的 host）
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http');
    const link = `${proto}://${host}/reset-password?token=${token}`;
    const html = buildForgotMail({ name: u.nickname || u.username, link, minutes: 10 });
    try {
      await this.mail.send(u.email, '【GoHub】重置密码', html);
      appLog.warn('auth', `账户「${u.username}」申请了「忘记密码」重置链接 → ${maskEmail(u.email)}`);
    } catch (e) {
      AuthController.passwordResetTokens.delete(token);
      return { success: false, message: `邮件发送失败：${(e as Error).message}` };
    }
    return generic;
  }

  /**
   * POST /api/auth/password/reset  { token, password }
   * 校验一次性令牌并设置新密码；令牌用完即删。
   */
  @Post('password/reset')
  @HttpCode(200)
  async resetPassword(@Body() body: { token?: string; password?: string }) {
    const token = String(body?.token || '').trim();
    const password = String(body?.password || '');
    if (!token || !password) return { success: false, message: '参数不完整' };
    if (password.length < 4) return { success: false, message: '密码至少 4 位' };
    const entry = AuthController.passwordResetTokens.get(token);
    if (!entry) return { success: false, message: '重置链接无效或已被使用' };
    if (entry.expiresAt < Date.now()) {
      AuthController.passwordResetTokens.delete(token);
      return { success: false, message: '重置链接已过期（有效期 10 分钟），请重新申请' };
    }
    AuthController.passwordResetTokens.delete(token);
    const u = await prisma.user.findUnique({ where: { username: entry.username } });
    if (!u) return { success: false, message: '账户不存在' };
    await prisma.user.update({
      where: { id: u.id },
      data: { passwordHash: CryptoService.hashPassword(password) },
    });
    appLog.warn('auth', `账户「${u.username}」通过「忘记密码」邮件链接重置了密码`);
    return { success: true, message: '密码已重置，请使用新密码登录' };
  }

  /**
   * 「遗忘验证器」自助关闭两步验证（v2.3.0）。
   * 必须同时提供「邮箱验证码」与「一枚恢复码」两个凭据，缺一不可。
   */
  @Post('totp/disable-fallback')
  @HttpCode(200)
  async disableTotpFallback(
    @Body() body: { emailCode?: string; recoveryCode?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const session = parseSession(req.cookies?.[SESSION_COOKIE]);
    if (!session) return res.status(401).json({ success: false, message: '未登录或会话已过期' });
    const result = await this.disableTotpWithProof(session.user, body?.emailCode, body?.recoveryCode);
    if (!result.ok) return res.status(400).json({ success: false, message: result.message });
    // 关闭 2FA 后重新签发会话（tv 已无意义）
    await this.setSession(res, { user: session.user, role: session.role, totpEnabled: false }, req, true);
    return res.json({ success: true, message: result.message });
  }

  /**
   * 用「邮箱验证码 或 恢复码（v2.6.0 起任选其一）」关闭某账户的 2FA
   * —— 登录态与管理员改他人账户共用。
   * 恢复码用掉即作废；关闭后清空 secret；用邮箱验证码关闭时恢复码原样保留。
   */
  async disableTotpWithProof(
    username: string,
    emailCode?: string,
    recoveryCode?: string,
  ): Promise<{ ok: boolean; message: string }> {
    const u = await prisma.user.findUnique({ where: { username } });
    if (!u) return { ok: false, message: '账户不存在' };
    if (!u.totpEnabled) return { ok: true, message: '该账户未启用两步验证' };
    if (!u.email || !u.emailVerified) return { ok: false, message: '该账户邮箱未验证，无法通过邮箱验证码关闭两步验证' };

    /*
     * v2.6.0（v20261024-1）：由「邮箱验证码 + 恢复码缺一不可」放宽为
     * 「二者任一即可」—— 验证器丢失时用户往往两样只记得住一样。
     */
    const email = String(emailCode || '').trim();
    const recovery = String(recoveryCode || '').trim();
    if (!email && !recovery) return { ok: false, message: '请提供邮箱验证码或恢复码（任一即可）' };

    let method = '';
    let recoveryHashes = u.recoveryHashes;
    if (email) {
      // 兼容两个入口签发的验证码：登录页「发送邮箱验证码」(login) 与
      // 用户编辑页「发送关闭验证码」(disable-2fa)。
      const mailRes = this.mail.consumeAnyCode(u.email, ['disable-2fa', 'login'], email);
      if (!mailRes.ok) return { ok: false, message: mailRes.message };
      method = '邮箱验证码';
    } else {
      const hit = consumeRecoveryCode(u.recoveryHashes, recovery);
      if (!hit) return { ok: false, message: '恢复码无效或已被使用' };
      recoveryHashes = JSON.stringify(hit.rest);
      method = '恢复码';
    }

    await prisma.user.update({
      where: { id: u.id },
      data: {
        totpEnabled: false,
        totpSecret: '',
        recoveryHashes,
        backVerifiedAt: null,
      },
    });
    appLog.warn('auth', `账户「${u.username}」通过「${method}」关闭了两步验证`);
    return { ok: true, message: '两步验证已关闭，请尽快重新绑定验证器' };
  }

  /** 当前会话的两步验证状态（前端弹框前先问一次，避免无谓弹窗） */
  @Get('totp/status')
  async totpStatus(@Req() req: Request) {
    const session = parseSession(req.cookies?.[SESSION_COOKIE]);
    if (!session) return { success: true, data: { loggedIn: false, enabled: false, required: false } };
    const u = await prisma.user.findUnique({ where: { username: session.user } });
    const enabled = !!u?.totpEnabled;
    return {
      success: true,
      data: {
        loggedIn: true,
        enabled,
        // required = 已启用 2FA 但本次会话没通过验证 / 验证状态已过后端会话窗
        required: enabled && !totpValid(session),
        // 三种验证方式各自是否可用（前端据此决定提示语与「发送邮箱验证码」按钮）
        email: u?.email || '',
        emailVerified: !!u?.emailVerified,
        mailReady: await this.mail.configured(),
        recoveryCount: u ? countRecoveryCodes(u.recoveryHashes) : 0,
      },
    };
  }

  /**
   * 会话探测：前端路由守卫读取【顶层】字段（adminRequired / userRequired / valid / authType）。
   * 新增 role / canEdit / canDelete，供前端按角色渲染。
   */
  @Get('sessionCheck')
  async sessionCheck(@Req() req: Request) {
    const auth = await this.authConfig();
    const adminRequired = await this.isAdminConfigured(auth);
    const userRequired = await this.isUserConfigured(auth);

    const session = parseSession(req.cookies?.[SESSION_COOKIE]);
    // 前端会话到期（fexp）即视为未登录 —— 需要重新输入用户名密码
    const valid = !!session && frontValid(session);
    const role: Role | null = session ? session.role : null;

    // 权限 / 资料：普通用户取账户配置；管理员/超管默认全权
    let canEdit = true;
    let canDelete = true;
    let totpEnabled = !!session?.t2;
    let totpRequired = false;
    // v3.0.0：对外分享权限（管理员默认拥有；普通用户由后台「管理员操作 → 分享权限」开启）
    let shareEnabled = role === 'admin' || role === 'super';
    let profile: Record<string, unknown> = {};
    if (session) {
      const u = await prisma.user.findUnique({ where: { username: session.user } });
      if (u) {
        canEdit = u.canEdit ?? true;
        canDelete = u.canDelete ?? true;
        totpEnabled = u.totpEnabled;
        totpRequired = u.totpEnabled && !totpValid(session);
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
          recoveryCount: countRecoveryCodes(u.recoveryHashes),
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
      // v3.0.0：对外分享权限（前端据此决定是否显示「对外分享」相关入口）
      shareEnabled,
      // 已启用 2FA 且当前会话未通过验证 → 前端进后台前弹动态码输入框
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

  /**
   * 超级管理员专用：修改管理员的用户名 / 密码。
   * 用于「初始管理员密码被改后遗忘」的找回场景；超级管理员除此之外无其它权限。
   */
  @Post('superUpdateAdmin')
  @HttpCode(200)
  async superUpdateAdmin(
    @Body() body: { username?: string; password?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const s = currentSession(req);
    if (!s || s.role !== 'super') {
      return res.status(403).json({ success: false, message: '需要超级管理员权限' });
    }
    const raw = await this.sysConfig.readSecurityRaw();
    raw.auth = raw.auth || {};
    raw.auth.admin = raw.auth.admin || {};
    const newUser = String(body.username || '').trim();
    const newPass = String(body.password || '');
    if (newUser) raw.auth.admin.adminUsername = newUser;
    if (newPass) raw.auth.admin.adminPassword = hashSecret(newPass);
    await this.sysConfig.writeSecurityRaw(raw);

    // 同步更新 users 表中首个管理员账户（若存在），保证两条路径都能登录
    if (newUser || newPass) {
      const admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
      if (admin) {
        await prisma.user.update({
          where: { id: admin.id },
          data: {
            username: newUser || admin.username,
            passwordHash: newPass ? CryptoService.hashPassword(newPass) : admin.passwordHash,
          },
        });
      }
    }
    return res.json({ success: true, message: '管理员账户已更新' });
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res() res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return res.json({ success: true });
  }
}

/**
 * 邮箱脱敏（v2.6.0 起统一格式）：abcdefg@126.com → abc***@126.com
 * —— 只显示前 3 个字符 + *** + 域名（不足 3 个字符时全显示）。
 * 用于「验证码已发送至 …」等提示语。
 */
export function maskEmail(raw: string): string {
  const s = String(raw || '').trim();
  const at = s.indexOf('@');
  if (at <= 0) return s;
  const name = s.slice(0, at);
  const domain = s.slice(at);
  return `${name.slice(0, 3)}***${domain}`;
}

/** 「忘记密码」邮件模板（内联样式，与验证码邮件同风格） */
function buildForgotMail(o: { name: string; link: string; minutes: number }): string {
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

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
