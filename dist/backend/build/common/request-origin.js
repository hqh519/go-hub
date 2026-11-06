"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamicOrigin = dynamicOrigin;
exports.primeSignOrigin = primeSignOrigin;
exports.signOrigin = signOrigin;
exports.resolveOrigin = resolveOrigin;
const endpoint_1 = require("./endpoint");
function dynamicOrigin(req) {
    const xf = String(req.headers['x-forwarded-host'] || '')
        .split(',')[0]
        .trim();
    const raw = xf || String(req.headers.host || '').trim();
    const host = raw.replace(/\/.*$/, '').trim();
    if (!host || !/^[a-z0-9.\-]+(:\d+)?$/i.test(host))
        return '';
    const protoRaw = String(req.headers['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim()
        .toLowerCase();
    const proto = protoRaw === 'https' ? 'https' : protoRaw === 'http' ? 'http' : req.protocol || 'http';
    return `${proto}://${host}`;
}
let configuredOrigin = '';
function primeSignOrigin(value) {
    const v = String(value || '').trim();
    configuredOrigin = v ? (0, endpoint_1.ensureProtocol)(v).replace(/\/+$/, '') : '';
}
function signOrigin(req) {
    return configuredOrigin || dynamicOrigin(req) || 'http://localhost:3619';
}
function resolveOrigin(req, configured) {
    const c = String(configured || '').trim();
    if (c)
        return (0, endpoint_1.ensureProtocol)(c).replace(/\/+$/, '');
    return dynamicOrigin(req) || 'http://localhost:3619';
}
