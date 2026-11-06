import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * TOTP（RFC 6238）实现 —— 两步验证用。
 *
 * 设计取舍：
 *   - 不引入第三方依赖（otplib / speakeasy），只用 Node 内置 crypto，Docker 镜像不增加体积；
 *   - 算法 SHA1 / 6 位 / 30 秒步长 —— 与 Google Authenticator、Microsoft Authenticator、
 *     1Password、Bitwarden 等主流 App 的默认参数一致（它们对 SHA256/512 支持并不完整，
 *     统一用 SHA1 兼容性最好）；
 *   - 校验允许前后各 1 个时间步（±30s），吸收手机与服务器之间的时钟漂移。
 *
 * 密钥存储：Base32 明文只出现在「启用时展示给用户扫码」的那一次响应里，
 * 落库前由调用方用 CryptoService.encrypt 加密（与渠道密钥同一套 AES-GCM）。
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 随机生成 Base32 密钥（默认 20 字节 = 160 bit，符合 RFC 4226 推荐长度） */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = String(input || '')
    .toUpperCase()
    .replace(/[\s=]/g, '')
    .replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 指定时间步的 6 位验证码 */
export function totpAt(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  // 64 位大端写入（JS 位运算只有 32 位，拆高低位写）
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/** 当前验证码（测试/调试用） */
export function currentTotp(secret: string, at = Date.now()): string {
  return totpAt(secret, Math.floor(at / 1000 / 30));
}

/**
 * 校验用户输入的验证码。
 * @param window 允许的时间步容差（1 = 前后各 30 秒）
 */
export function verifyTotp(secret: string, input: string, window = 1): boolean {
  const code = String(input || '').replace(/\D/g, '');
  if (code.length !== 6) return false;
  if (!secret) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i += 1) {
    const expect = totpAt(secret, counter + i);
    // 定长比较，避免时序侧信道（6 位数字，风险很低，但仍按安全惯例写）
    if (timingSafeEqual(Buffer.from(expect), Buffer.from(code))) return true;
  }
  return false;
}

/** otpauth:// 链接（前端据此生成二维码，主流验证器 App 直接扫码） */
export function totpUri(secret: string, account: string, issuer = 'GoHub'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
