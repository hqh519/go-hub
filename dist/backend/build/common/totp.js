"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTotpSecret = generateTotpSecret;
exports.base32Encode = base32Encode;
exports.base32Decode = base32Decode;
exports.totpAt = totpAt;
exports.currentTotp = currentTotp;
exports.verifyTotp = verifyTotp;
exports.totpUri = totpUri;
const crypto_1 = require("crypto");
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function generateTotpSecret(bytes = 20) {
    return base32Encode((0, crypto_1.randomBytes)(bytes));
}
function base32Encode(buf) {
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
    if (bits > 0)
        out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return out;
}
function base32Decode(input) {
    const clean = String(input || '')
        .toUpperCase()
        .replace(/[\s=]/g, '')
        .replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let value = 0;
    const out = [];
    for (const ch of clean) {
        const idx = BASE32_ALPHABET.indexOf(ch);
        if (idx < 0)
            continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}
function totpAt(secret, counter) {
    const key = base32Decode(secret);
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    buf.writeUInt32BE(counter >>> 0, 4);
    const hmac = (0, crypto_1.createHmac)('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);
    return String(code % 1_000_000).padStart(6, '0');
}
function currentTotp(secret, at = Date.now()) {
    return totpAt(secret, Math.floor(at / 1000 / 30));
}
function verifyTotp(secret, input, window = 1) {
    const code = String(input || '').replace(/\D/g, '');
    if (code.length !== 6)
        return false;
    if (!secret)
        return false;
    const counter = Math.floor(Date.now() / 1000 / 30);
    for (let i = -window; i <= window; i += 1) {
        const expect = totpAt(secret, counter + i);
        if ((0, crypto_1.timingSafeEqual)(Buffer.from(expect), Buffer.from(code)))
            return true;
    }
    return false;
}
function totpUri(secret, account, issuer = 'GoHub') {
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
