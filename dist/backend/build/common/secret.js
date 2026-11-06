"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECRET_PREFIX = void 0;
exports.safeEqual = safeEqual;
exports.hashSecret = hashSecret;
exports.isHashedSecret = isHashedSecret;
exports.matchSecret = matchSecret;
const crypto_1 = require("crypto");
const crypto_service_1 = require("./crypto.service");
exports.SECRET_PREFIX = 'scrypt:';
function safeEqual(a, b) {
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ba.length !== bb.length)
        return false;
    return (0, crypto_1.timingSafeEqual)(ba, bb);
}
function hashSecret(plain) {
    return exports.SECRET_PREFIX + crypto_service_1.CryptoService.hashPassword(plain);
}
function isHashedSecret(stored) {
    return typeof stored === 'string' && stored.startsWith(exports.SECRET_PREFIX);
}
function matchSecret(input, stored) {
    if (!input || !stored)
        return false;
    if (isHashedSecret(stored)) {
        return crypto_service_1.CryptoService.verifyPassword(input, stored.slice(exports.SECRET_PREFIX.length));
    }
    return safeEqual(input, stored);
}
