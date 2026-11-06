"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.looksInternalHost = looksInternalHost;
exports.ensureProtocol = ensureProtocol;
function looksInternalHost(raw) {
    let h = String(raw || '').trim().toLowerCase();
    if (!h)
        return false;
    h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0];
    const at = h.lastIndexOf('@');
    if (at !== -1)
        h = h.slice(at + 1);
    if (h.startsWith('[')) {
        const end = h.indexOf(']');
        h = end === -1 ? h.slice(1) : h.slice(1, end);
    }
    else {
        h = h.split(':')[0];
    }
    if (!h)
        return false;
    if (h === 'localhost')
        return true;
    if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan'))
        return true;
    if (!h.includes('.'))
        return true;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if (a === 10 || a === 127)
            return true;
        if (a === 192 && b === 168)
            return true;
        if (a === 172 && b >= 16 && b <= 31)
            return true;
        if (a === 169 && b === 254)
            return true;
    }
    if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd'))
        return true;
    return false;
}
function ensureProtocol(raw) {
    const v = String(raw || '').trim();
    if (!v)
        return '';
    if (/^https?:\/\//i.test(v))
        return v;
    return `${looksInternalHost(v) ? 'http' : 'https'}://${v}`;
}
