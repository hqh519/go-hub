"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CryptoService = void 0;
const crypto_1 = require("crypto");
class CryptoService {
    static key() {
        const secret = process.env.CONFIG_SECRET || 'go-imgbed-dev-secret-change-me';
        return (0, crypto_1.scryptSync)(secret, 'go-imgbed-kdf', 32);
    }
    static encrypt(plain) {
        if (!plain)
            return '';
        const iv = (0, crypto_1.randomBytes)(12);
        const cipher = (0, crypto_1.createCipheriv)('aes-256-gcm', this.key(), iv);
        const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, enc]).toString('base64');
    }
    static decrypt(payload) {
        if (!payload)
            return '';
        try {
            const buf = Buffer.from(payload, 'base64');
            const iv = buf.subarray(0, 12);
            const tag = buf.subarray(12, 28);
            const data = buf.subarray(28);
            const decipher = (0, crypto_1.createDecipheriv)('aes-256-gcm', this.key(), iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
        }
        catch {
            return '';
        }
    }
    static mask(value) {
        if (!value)
            return '';
        if (value.length <= 8)
            return '****';
        return value.slice(0, 4) + '****' + value.slice(-4);
    }
    static sign(value) {
        return (0, crypto_1.createHmac)('sha256', this.key()).update(value).digest('base64url');
    }
    static verifySigned(payload, signature) {
        const expect = this.sign(payload);
        try {
            return (0, crypto_1.timingSafeEqual)(Buffer.from(expect), Buffer.from(signature));
        }
        catch {
            return false;
        }
    }
    static hashPassword(password) {
        const salt = (0, crypto_1.randomBytes)(16).toString('hex');
        const hash = (0, crypto_1.scryptSync)(password, salt, 64).toString('hex');
        return `${salt}:${hash}`;
    }
    static verifyPassword(password, stored) {
        const [salt, hash] = stored.split(':');
        if (!salt || !hash)
            return false;
        const calc = (0, crypto_1.scryptSync)(password, salt, 64).toString('hex');
        try {
            return (0, crypto_1.timingSafeEqual)(Buffer.from(calc), Buffer.from(hash));
        }
        catch {
            return false;
        }
    }
    static shortId() {
        return (0, crypto_1.randomUUID)().replace(/-/g, '').slice(0, 12);
    }
    static fileId(length = 48) {
        const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const limit = 256 - (256 % alphabet.length);
        const out = [];
        while (out.length < length) {
            for (const b of (0, crypto_1.randomBytes)(length)) {
                if (b >= limit)
                    continue;
                out.push(alphabet[b % alphabet.length]);
                if (out.length === length)
                    break;
            }
        }
        return out.join('');
    }
    static fileId32() {
        return CryptoService.fileId(48);
    }
}
exports.CryptoService = CryptoService;
