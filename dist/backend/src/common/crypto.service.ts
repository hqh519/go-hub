import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHmac, timingSafeEqual, randomUUID } from 'crypto';

/**
 * 加密服务 —— 渠道密钥的 AES-256-GCM 加密存储 + 会话 Cookie 签名。
 * 主密钥来自环境变量 CONFIG_SECRET（.env，不入库不入 git）。
 */
export class CryptoService {
  /**
   * 派生密钥的内存缓存：secret -> 32 字节 key。
   *
   * ⚠️ 必须缓存。scrypt 是 memory-hard KDF（默认 N=16384/r=8/p=1），单次 50~100ms。
   * 早期实现每次 encrypt/decrypt/sign 都重算一遍，导致带 ?from=admin 的请求
   * （会话验签 → sign() → key()）平白多出约 120ms，图片灯箱明显"等一会才出来"。
   * 同一进程内 secret 不变，派生结果恒定，缓存不改变任何加密语义。
   */
  private static keyCache: { secret: string; key: Buffer } | null = null;

  private static key(): Buffer {
    // ⚠️ 下面两个字面量是历史密钥派生参数，**永远不要跟着项目改名而改**：
    //   它们是 scrypt 的 secret 兜底值 + salt，改动会让已加密的渠道密钥全部解不开。
    const secret = process.env.CONFIG_SECRET || 'go-imgbed-dev-secret-change-me';
    const hit = this.keyCache;
    if (hit && hit.secret === secret) return hit.key;
    const key = scryptSync(secret, 'go-imgbed-kdf', 32);
    this.keyCache = { secret, key };
    return key;
  }

  /** AES-256-GCM 加密，输出 base64(iv|tag|ciphertext) */
  static encrypt(plain: string): string {
    if (!plain) return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  static decrypt(payload: string): string {
    if (!payload) return '';
    try {
      const buf = Buffer.from(payload, 'base64');
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const data = buf.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', this.key(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
      return '';
    }
  }

  /** 脱敏：AKID****1234 */
  static mask(value: string): string {
    if (!value) return '';
    if (value.length <= 8) return '****';
    return value.slice(0, 4) + '****' + value.slice(-4);
  }

  /** HMAC-SHA256 签名（会话 Cookie） */
  static sign(value: string): string {
    return createHmac('sha256', this.key()).update(value).digest('base64url');
  }

  static verifySigned(payload: string, signature: string): boolean {
    const expect = this.sign(payload);
    try {
      return timingSafeEqual(Buffer.from(expect), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  /** scrypt 密码散列 */
  static hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  static verifyPassword(password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const calc = scryptSync(password, salt, 64).toString('hex');
    try {
      return timingSafeEqual(Buffer.from(calc), Buffer.from(hash));
    } catch {
      return false;
    }
  }

  static shortId(): string {
    return randomUUID().replace(/-/g, '').slice(0, 12);
  }

  /**
   * 混合字符随机 ID（数字 + 大写 + 小写）。
   * 用作对外文件标识 /file/:name：默认 48 位，约 62^48 ≈ 4.6e85 种组合，
   * 无法通过随机遍历命中他人文件链接（原 32 位已升级为 48 位，提高破译难度）。
   * 取模采用「拒绝采样」：仅接受 < 248 的字节（62×4），避免 modulo bias 削弱随机性。
   */
  static fileId(length = 48): string {
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const limit = 256 - (256 % alphabet.length); // 248
    const out: string[] = [];
    while (out.length < length) {
      for (const b of randomBytes(length)) {
        if (b >= limit) continue;
        out.push(alphabet[b % alphabet.length]);
        if (out.length === length) break;
      }
    }
    return out.join('');
  }

  /** @deprecated 名称保留以兼容旧调用；实际生成 48 位（见 fileId） */
  static fileId32(): string {
    return CryptoService.fileId(48);
  }
}
