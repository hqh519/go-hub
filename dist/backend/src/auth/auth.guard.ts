import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../common/prisma';
import { CryptoService } from '../common/crypto.service';
import { SysConfigService } from '../settings/sysconfig.service';

export const SESSION_COOKIE = 'gohub_session';

/** 角色：admin=管理员 / user=普通用户 / super=超级管理员（仅 docker .env 配置，后台不可改） */
export type Role = 'admin' | 'user' | 'super';

export interface SessionPayload {
  user: string;
  role: Role;
  /** 整体会话过期时间戳（秒）= max(fexp, bexp)；0 = 永久 */
  exp: number;
  /** 前端会话（上传页 / 画廊 / 历史记录）过期时间戳；0 = 永久 */
  fexp: number;
  /** 后端会话（系统管理 / 用户管理 / 文件管理）过期时间戳；0 = 永久 */
  bexp: number;
  /** 该账户是否启用了两步验证（登录时快照） */
  t2: boolean;
  /** 本次会话是否已通过两步验证 */
  tv: boolean;
  /** 通过两步验证的时间戳（秒）；0 = 未通过 */
  tva: number;
}

/** 会话签发参数 */
export interface SessionOptions {
  /** 前端会话有效期（天）；<=0 表示永久 */
  frontDays?: number;
  /** 后端会话有效期（天）；<=0 表示永久 */
  backDays?: number;
  /** 账户是否启用两步验证 */
  totpEnabled?: boolean;
  /** 本次是否已完成两步验证 */
  verified?: boolean;
}

/** 天数 → 绝对过期时间戳（秒）；0 = 永久 */
function expiryOf(days: number | undefined, now = Math.floor(Date.now() / 1000)): number {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return now + Math.round(d * 24 * 3600);
}

/**
 * 签发会话。
 *
 * 会话里同时带「前端 / 后端」两个过期点（v202610221824）：
 *   - 前端到期 → 上传页/画廊需重新登录（整站登录态失效）；
 *   - 后端到期 → 登录态仍在，但两步验证状态失效，进后台需重新输入动态码。
 * Cookie 的 maxAge 取两者较大值，否则后端设置 30 天会被前端 7 天提前打断。
 */
export function makeSession(user: string, role: Role, opts: SessionOptions = {}): { payload: string; sig: string; maxAge: number } {
  const now = Math.floor(Date.now() / 1000);
  const fexp = expiryOf(opts.frontDays, now);
  const bexp = expiryOf(opts.backDays, now);
  // 永久（任一侧为 0）时整体也按永久处理；否则取较晚的一个
  const exp = fexp === 0 || bexp === 0 ? 0 : Math.max(fexp, bexp);
  const totpEnabled = !!opts.totpEnabled;
  const verified = totpEnabled ? !!opts.verified : true;
  const payload: SessionPayload = {
    user,
    role,
    exp,
    fexp,
    bexp,
    t2: totpEnabled,
    tv: verified,
    tva: verified ? now : 0,
  };
  const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
  // Cookie 生命周期：与整体会话一致；永久会话下发 10 年
  const maxAge = exp === 0 ? 10 * 365 * 24 * 3600 * 1000 : (exp - now) * 1000;
  return { payload: raw, sig: CryptoService.sign(raw), maxAge };
}

export function parseSession(cookieValue: string | undefined): SessionPayload | null {
  if (!cookieValue) return null;
  const idx = cookieValue.indexOf('.');
  if (idx <= 0) return null;
  const payload = cookieValue.slice(0, idx);
  const sig = cookieValue.slice(idx + 1);
  if (!CryptoService.verifySigned(payload, sig)) return null;
  try {
    const raw = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Partial<SessionPayload>;
    const now = Math.floor(Date.now() / 1000);
    // 兼容旧会话（无 fexp/bexp）：用 exp 兜底，避免升级瞬间全体掉线
    const exp = Number(raw.exp || 0);
    const fexp = Number(raw.fexp ?? exp);
    const bexp = Number(raw.bexp ?? exp);
    const overall = fexp === 0 || bexp === 0 ? 0 : Math.max(fexp, bexp);
    if (overall > 0 && overall < now) return null;
    if (exp > 0 && exp < now) return null;
    return {
      user: String(raw.user || ''),
      role: (raw.role as Role) || 'user',
      exp,
      fexp,
      bexp,
      t2: raw.t2 === true,
      tv: raw.tv !== false,
      tva: Number(raw.tva || 0),
    };
  } catch {
    return null;
  }
}

/** 前端会话是否仍有效（登录态） */
export function frontValid(session: SessionPayload): boolean {
  if (!session.fexp) return true;
  return session.fexp >= Math.floor(Date.now() / 1000);
}

/** 后端会话是否仍有效（登录态 + 后台允许进入的时间窗） */
export function backValid(session: SessionPayload): boolean {
  if (!session.bexp) return true;
  return session.bexp >= Math.floor(Date.now() / 1000);
}

/**
 * 两步验证状态是否有效。
 * 未启用 2FA 的账户恒为 true；启用的账户要求：
 *   1) 本次会话已通过验证（tv / tva）；
 *   2) 未超过「后端会话有效期」—— 到期后登录态还在，但需要重新输入动态码。
 */
export function totpValid(session: SessionPayload): boolean {
  if (!session.t2) return true;
  if (!session.tv || !session.tva) return false;
  if (session.bexp > 0 && session.bexp < Math.floor(Date.now() / 1000)) return false;
  return true;
}

/** 登录守卫：校验 HttpOnly 会话 Cookie（前端会话窗口内有效） */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const session = parseSession(req.cookies?.[SESSION_COOKIE]);
    if (!session) {
      res.status(401).json({ success: false, message: '未登录或会话已过期' });
      return false;
    }
    if (!frontValid(session)) {
      res.status(401).json({ success: false, message: '登录已过期，请重新登录', code: 'FRONT_SESSION_EXPIRED' });
      return false;
    }
    (req as Request & { session?: SessionPayload }).session = session;
    return true;
  }
}

/**
 * 后台（管理端）门禁 —— 登录态 + 两步验证状态。
 * 未启用 2FA 的账户直接放行；启用的账户在「后端会话有效期」到期或尚未验证时
 * 返回 403 + code=TOTP_REQUIRED，前端据此弹出动态码输入框（重新验证后可继续，
 * 不需要重新登录）。
 */
function guardBackend(req: Request, res: Response): SessionPayload | null {
  const session = parseSession(req.cookies?.[SESSION_COOKIE]);
  if (!session) {
    res.status(401).json({ success: false, message: '未登录或会话已过期' });
    return null;
  }
  if (!totpValid(session)) {
    res.status(403).json({
      success: false,
      message: '需要两步验证',
      code: 'TOTP_REQUIRED',
    });
    return null;
  }
  (req as Request & { session?: SessionPayload }).session = session;
  return session;
}

/** 管理员守卫（管理员 / 超级管理员） */
@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const session = guardBackend(req, res);
    if (!session) return false;
    if (session.role !== 'admin' && session.role !== 'super') {
      res.status(403).json({ success: false, message: '需要管理员权限' });
      return false;
    }
    return true;
  }
}

/**
 * 后台登录守卫 —— 管理员与普通用户都可进入；具体能做什么由各接口内按
 * `session.role` 二次判定（普通用户只能访问自身账户的文件与文件夹）。
 * 同样挂两步验证门禁：后台页面（系统管理/用户管理/文件管理）都要求 2FA 通过。
 */
@Injectable()
export class ManageAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    return guardBackend(req, res) !== null;
  }
}

/**
 * 取出当前会话（无会话返回 null）。
 *
 * 先取守卫注入的 `req.session`；守卫缺省时（例如 `/api/userConfig`、
 * `/api/directoryTree` 这类「登录与否都要能访问」的接口没有挂守卫）
 * 直接解析签名 Cookie —— 否则这些接口永远拿不到当前账户，
 * 会把「按账户隔离」的目录、渠道一律退化成全局视图（越权展示他人目录）。
 * 解析走 parseSession，签名无效/过期即视为未登录。
 */
export function currentSession(req: Request): SessionPayload | null {
  const injected = (req as Request & { session?: SessionPayload }).session;
  if (injected) return injected;
  return parseSession(req.cookies?.[SESSION_COOKIE]);
}

/** 是否管理员（admin / super） */
export function isAdminRole(role?: string): boolean {
  return role === 'admin' || role === 'super';
}

/**
 * 上传接口守卫 —— 与前端 `userRequired` 语义严格对齐：
 *   未配置用户认证码 → 允许匿名上传（页面本来就无需登录）
 *   已配置用户认证码 → 必须携带有效会话（admin / user 均可）
 *
 * 这样「安全设置里清空用户认证码 = 上传页免登录」才真正生效，
 * 不会出现「前端放行、后端 401」的割裂。
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private sysConfig: SysConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const codeRequired = await this.userCodeRequired();
    if (!codeRequired) return true;

    const session = parseSession(req.cookies?.[SESSION_COOKIE]);
    if (!session) {
      res.status(401).json({ success: false, message: '未登录或会话已过期' });
      return false;
    }
    (req as Request & { session?: SessionPayload }).session = session;
    return true;
  }

  private async userCodeRequired(): Promise<boolean> {
    try {
      // 用户账户体系统一登录后：只要系统中存在任何可登录账户（用户表有记录、
      // 或安全设置里配置过管理员/用户密码、或环境变量提供了初始账号），
      // 上传页即要求登录 —— 前端 sessionCheck 的 userRequired 与此同源。
      if ((await prisma.user.count()) > 0) return true;
      const raw = await this.sysConfig.readSecurityRaw();
      if (String(raw?.auth?.admin?.adminPassword || '')) return true;
      if (String(raw?.auth?.user?.authCode || '')) return true;
      return !!(process.env.ADMIN_USER || process.env.ADMIN_PASSWORD);
    } catch {
      return true; // 配置读取异常时按「需要认证」处理，宁严勿松
    }
  }
}

export { NextFunction };
