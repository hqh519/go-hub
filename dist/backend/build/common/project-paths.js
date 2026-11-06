"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backendRoot = backendRoot;
exports.backendSub = backendSub;
exports.frontendAppDir = frontendAppDir;
exports.logsDir = logsDir;
exports.envCandidates = envCandidates;
const fs_1 = require("fs");
const path_1 = require("path");
let cachedRoot = '';
function backendRoot() {
    if (cachedRoot)
        return cachedRoot;
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        if ((0, fs_1.existsSync)((0, path_1.join)(dir, 'package.json'))) {
            cachedRoot = dir;
            return dir;
        }
        const up = (0, path_1.dirname)(dir);
        if (up === dir)
            break;
        dir = up;
    }
    cachedRoot = process.cwd();
    return cachedRoot;
}
function backendSub(...segments) {
    return (0, path_1.join)(backendRoot(), ...segments);
}
function frontendAppDir() {
    const root = backendRoot();
    const cwd = process.cwd();
    const candidates = [
        (0, path_1.join)(root, '..', 'frontend', 'app'),
        (0, path_1.join)(root, '..', 'frontend'),
        (0, path_1.join)(root, '..', '..', 'dist', 'frontend', 'app'),
        (0, path_1.join)(cwd, 'dist', 'frontend', 'app'),
        (0, path_1.join)(cwd, '..', 'dist', 'frontend', 'app'),
        (0, path_1.join)(cwd, 'frontend-dist'),
        (0, path_1.join)(root, '..', 'frontend-dist'),
    ];
    for (const c of candidates) {
        if ((0, fs_1.existsSync)((0, path_1.join)(c, 'index.html')))
            return (0, path_1.resolve)(c);
    }
    return '';
}
function logsDir() {
    return backendSub('logs');
}
function envCandidates() {
    return [backendSub('.env'), (0, path_1.join)(process.cwd(), '.env')];
}
