"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expandFolderPlaceholders = expandFolderPlaceholders;
const ILLEGAL_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;
function safeSegment(input) {
    return String(input ?? '')
        .replace(ILLEGAL_CHARS, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function expandFolderPlaceholders(raw, ctx = {}) {
    const source = String(raw || '');
    if (!source)
        return '';
    const now = ctx.now instanceof Date ? ctx.now : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const values = {
        tokenname: safeSegment(ctx.tokenName),
        user: safeSegment(ctx.user),
        y: String(now.getFullYear()),
        m: pad(now.getMonth() + 1),
        d: pad(now.getDate()),
    };
    const expanded = source.replace(/\{([A-Za-z]+)\}/g, (whole, key) => {
        const k = String(key).toLowerCase();
        return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : whole;
    });
    return expanded
        .replace(/\\/g, '/')
        .replace(/[:*?"<>|\u0000-\u001f]/g, '')
        .replace(/\/{2,}/g, '/')
        .replace(/^\/+|\/+$/g, '');
}
