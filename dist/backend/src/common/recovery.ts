/**
 * 两步验证恢复码（v2.3.0）。
 *
 * 需求：「恢复码不存入数据库，需要用户自行存储」。
 * 做法：**明文只在生成的那一次返回给前端**（只展示一次，关掉就再也看不到），
 * 库里只留每个码的 HMAC-SHA256 摘要（JSON 数组），用掉一个删一个。
 * 这样即便数据库泄露，也无法还原出可用的恢复码 —— 既满足「不存恢复码」的语义，
 * 又保留了「恢复码可登录 / 可关闭 2FA」的校验能力。
 */
import { randomInt } from 'crypto';
import { CryptoService } from './crypto.service';

/** 去掉易混字符（I / L / O / 0 / 1），只留 32 个 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** 默认生成 10 个 */
export const RECOVERY_CODE_COUNT = 10;

/**
 * v2.6.0（v20261024-1）：恢复码格式改为 xxxxxx-xxxxxx（前后各 6 位字母+数字）。
 * 旧格式（XXXX-XXXXX）的历史恢复码仍可校验通过 —— normalizeRecoveryCode
 * 去掉连字符后统一大写比较，摘要不受展示格式影响。
 */
function oneCode(): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 6)}-${s.slice(6)}`;
}

/** 归一化：去掉空格 / 连字符 / 转小写 → 统一大写比较 */
export function normalizeRecoveryCode(input: string): string {
  return String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** 恢复码摘要（不可逆） */
export function hashRecoveryCode(code: string): string {
  return CryptoService.sign(`recovery:${normalizeRecoveryCode(code)}`);
}

/** 生成一批恢复码：返回 { plain: 明文数组（仅此一次）, hashes: 待入库的摘要数组 } */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  const seen = new Set<string>();
  while (plain.length < count) {
    const c = oneCode();
    const n = normalizeRecoveryCode(c);
    if (seen.has(n)) continue;
    seen.add(n);
    plain.push(c);
  }
  return { plain, hashes: plain.map(hashRecoveryCode) };
}

/**
 * 校验恢复码。
 * 命中返回「剩余摘要数组」（调用方写回库里，实现一次性）；
 * 未命中返回 null。
 */
export function consumeRecoveryCode(storedHashesRaw: string, input: string): { rest: string[]; index: number } | null {
  let hashes: string[] = [];
  try {
    const parsed = JSON.parse(String(storedHashesRaw || '[]'));
    if (Array.isArray(parsed)) hashes = parsed.map(String);
  } catch {
    return null;
  }
  if (!hashes.length) return null;
  const target = hashRecoveryCode(input);
  const index = hashes.indexOf(target);
  if (index < 0) return null;
  const rest = hashes.slice(0, index).concat(hashes.slice(index + 1));
  return { rest, index };
}

/** 剩余恢复码数量（只读，用于编辑页展示「还剩 N 个」） */
export function countRecoveryCodes(storedHashesRaw: string): number {
  try {
    const parsed = JSON.parse(String(storedHashesRaw || '[]'));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
