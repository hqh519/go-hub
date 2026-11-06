"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECOVERY_CODE_COUNT = void 0;
exports.normalizeRecoveryCode = normalizeRecoveryCode;
exports.hashRecoveryCode = hashRecoveryCode;
exports.generateRecoveryCodes = generateRecoveryCodes;
exports.consumeRecoveryCode = consumeRecoveryCode;
exports.countRecoveryCodes = countRecoveryCodes;
const crypto_1 = require("crypto");
const crypto_service_1 = require("./crypto.service");
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
exports.RECOVERY_CODE_COUNT = 10;
function oneCode() {
    let s = '';
    for (let i = 0; i < 12; i++)
        s += ALPHABET[(0, crypto_1.randomInt)(ALPHABET.length)];
    return `${s.slice(0, 6)}-${s.slice(6)}`;
}
function normalizeRecoveryCode(input) {
    return String(input || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}
function hashRecoveryCode(code) {
    return crypto_service_1.CryptoService.sign(`recovery:${normalizeRecoveryCode(code)}`);
}
function generateRecoveryCodes(count = exports.RECOVERY_CODE_COUNT) {
    const plain = [];
    const seen = new Set();
    while (plain.length < count) {
        const c = oneCode();
        const n = normalizeRecoveryCode(c);
        if (seen.has(n))
            continue;
        seen.add(n);
        plain.push(c);
    }
    return { plain, hashes: plain.map(hashRecoveryCode) };
}
function consumeRecoveryCode(storedHashesRaw, input) {
    let hashes = [];
    try {
        const parsed = JSON.parse(String(storedHashesRaw || '[]'));
        if (Array.isArray(parsed))
            hashes = parsed.map(String);
    }
    catch {
        return null;
    }
    if (!hashes.length)
        return null;
    const target = hashRecoveryCode(input);
    const index = hashes.indexOf(target);
    if (index < 0)
        return null;
    const rest = hashes.slice(0, index).concat(hashes.slice(index + 1));
    return { rest, index };
}
function countRecoveryCodes(storedHashesRaw) {
    try {
        const parsed = JSON.parse(String(storedHashesRaw || '[]'));
        return Array.isArray(parsed) ? parsed.length : 0;
    }
    catch {
        return 0;
    }
}
