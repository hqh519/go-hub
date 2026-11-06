/**
 * 口令 / 认证码的统一存储与校验。
 *
 * 背景：
 *   「安全设置」页会把管理端用户名密码、用户认证码保存进 settings 表
 *   （key = sysConfig:security）。早期实现按明文原样落库，且登录接口根本
 *   不读这份配置 —— 于是出现「设置保存成功但登录仍只认初始口令」的问题。
 *
 * 现在的约定：
 *   - 新写入的值一律散列存储，格式 `scrypt:<salt>:<hash>`；
 *   - 历史明文值仍可校验通过，并在首次成功登录后自动升级为散列；
 *   - 比较使用恒定时间算法，避免时序侧信道。
 */

import { timingSafeEqual } from 'crypto';
import { CryptoService } from './crypto.service';

/** 散列值前缀（用于区分历史明文） */
export const SECRET_PREFIX = 'scrypt:';

/** 常量时间字符串比较（长度不同直接判否，避免 timingSafeEqual 抛错） */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 明文 → 散列（带前缀） */
export function hashSecret(plain: string): string {
  return SECRET_PREFIX + CryptoService.hashPassword(plain);
}

/** 是否已是散列格式 */
export function isHashedSecret(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith(SECRET_PREFIX);
}

/**
 * 校验用户输入与已存值是否匹配。
 *   - 散列格式：scrypt 校验
 *   - 历史明文：恒定时间比较
 */
export function matchSecret(input: string, stored: string): boolean {
  if (!input || !stored) return false;
  if (isHashedSecret(stored)) {
    return CryptoService.verifyPassword(input, stored.slice(SECRET_PREFIX.length));
  }
  return safeEqual(input, stored);
}
