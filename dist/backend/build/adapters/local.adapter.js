"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalAdapter = void 0;
exports.localFileAbsOf = localFileAbsOf;
exports.localFileAbs = localFileAbs;
exports.writeLocalStream = writeLocalStream;
const node_crypto_1 = require("node:crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const promises_1 = require("stream/promises");
const adapter_interface_1 = require("./adapter.interface");
const project_paths_1 = require("../common/project-paths");
const path_template_1 = require("../common/path-template");
class LocalAdapter {
    static root() {
        return (0, project_paths_1.backendSub)('uploads');
    }
    static readChannelCfg(channel) {
        let cfg = {};
        try {
            cfg = typeof channel?.config === 'string' ? JSON.parse(channel.config || '{}') : channel?.config || {};
        }
        catch {
            cfg = {};
        }
        const rawRoot = String(cfg.rootPath || '').trim();
        return {
            isCustom: !!rawRoot,
            rootPath: LocalAdapter.sanitizeRootPath(rawRoot),
            objectPrefix: String(cfg.objectPrefix || '').trim(),
            nameTemplate: String(cfg.nameTemplate || '').trim(),
            sizeLimitEnabled: String(cfg.sizeLimitEnabled || '') === 'true' || cfg.sizeLimitEnabled === true,
            sizeLimitGB: Number(cfg.sizeLimitGB) || 0,
        };
    }
    static sanitizeRootPath(raw) {
        const s = String(raw || '').trim().replace(/\\/g, '/');
        if (!s)
            return '';
        if (s.includes('..'))
            throw new adapter_interface_1.AdapterError('rootPath 禁止包含 ".."（禁止路径穿越）', 'local');
        if (/^\/|^[A-Za-z]:\//.test(s))
            return s.replace(/\/+$/, '');
        return (0, path_1.join)((0, project_paths_1.backendRoot)(), s.replace(/^\/+/, ''));
    }
    static toRelativePath(key) {
        const clean = String(key || '')
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .split('/')
            .filter((seg) => seg && seg !== '.' && seg !== '..')
            .join('/');
        if (!clean)
            throw new adapter_interface_1.AdapterError('key 为空，无法写入本地存储', 'local');
        const parts = clean.split('/');
        const head = parts[0];
        if (/^\d{6}$/.test(head)) {
            parts.splice(0, 1, head.slice(0, 4), head.slice(4));
        }
        return parts.join('/');
    }
    static ownerSegment(owner) {
        const s = String(owner || '')
            .trim()
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
            .replace(/^\.+$/, '')
            .replace(/\/{2,}/g, '/');
        return s || 'default';
    }
    static instanceSegment(instanceId) {
        return LocalAdapter.ownerSegment(instanceId || 'default');
    }
    static toRelativePathFor(key, owner, instanceId) {
        const rel = LocalAdapter.toRelativePath(key);
        const rawHead = String(key || '')
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .split('/')[0];
        if (!/^\d{6}$/.test(rawHead))
            return rel;
        return `${LocalAdapter.ownerSegment(owner)}/${LocalAdapter.instanceSegment(instanceId)}/${rel}`;
    }
    static absolutePath(key) {
        const root = LocalAdapter.root();
        const abs = (0, path_1.normalize)((0, path_1.join)(root, LocalAdapter.toRelativePath(key)));
        const rootWithSep = root.endsWith(path_1.sep) ? root : root + path_1.sep;
        if (!abs.startsWith(rootWithSep)) {
            throw new adapter_interface_1.AdapterError('非法的本地存储路径', 'local');
        }
        return abs;
    }
    baseRoot(channel) {
        const cfg = LocalAdapter.readChannelCfg(channel);
        return cfg.isCustom ? cfg.rootPath : LocalAdapter.root();
    }
    static safeJoin(base, rel) {
        const abs = (0, path_1.normalize)((0, path_1.join)(base, rel));
        const baseWithSep = base.endsWith(path_1.sep) ? base : base + path_1.sep;
        if (!abs.startsWith(baseWithSep)) {
            throw new adapter_interface_1.AdapterError('非法的本地存储路径', 'local');
        }
        return abs;
    }
    static usageCache = new Map();
    static async dirUsageBytes(base) {
        const hit = LocalAdapter.usageCache.get(base);
        if (hit && Date.now() - hit.at < 60_000)
            return hit.bytes;
        let total = 0;
        const walk = async (dir, depth) => {
            if (depth > 12)
                return;
            let entries;
            try {
                entries = await fs_1.promises.readdir(dir, { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const e of entries) {
                const p = (0, path_1.join)(dir, e.name);
                if (e.isDirectory()) {
                    await walk(p, depth + 1);
                }
                else if (e.isFile()) {
                    try {
                        total += (0, fs_1.statSync)(p).size;
                    }
                    catch {
                    }
                }
            }
        };
        await walk(base, 0);
        LocalAdapter.usageCache.set(base, { bytes: total, at: Date.now() });
        return total;
    }
    async enforceSizeLimit(base, channel) {
        const cfg = LocalAdapter.readChannelCfg(channel);
        if (!cfg.sizeLimitEnabled || cfg.sizeLimitGB <= 0)
            return;
        const used = await LocalAdapter.dirUsageBytes(base);
        const limit = cfg.sizeLimitGB * 1024 * 1024 * 1024;
        if (used >= limit) {
            throw new adapter_interface_1.AdapterError(`本地存储渠道容量已达上限（已用 ${(used / 1024 ** 3).toFixed(2)}GB / 限制 ${cfg.sizeLimitGB}GB）`, 'local');
        }
    }
    async buildRelKey(key, file, channel, ctx) {
        const cfg = LocalAdapter.readChannelCfg(channel);
        const ownerSeg = LocalAdapter.ownerSegment(ctx?.owner);
        const instSeg = LocalAdapter.instanceSegment(ctx?.instanceId);
        const keyNorm = String(key || '').replace(/\\/g, '/').replace(/^\/+/, '');
        const prefixTpl = cfg.objectPrefix || path_template_1.LOCAL_DEFAULT_PREFIX;
        const prefix = (0, path_template_1.renderObjectPrefix)(prefixTpl, new Date(), {
            channelId: channel.code || channel.id,
            user: ctx?.owner,
        });
        if (prefix && (keyNorm === prefix || keyNorm.startsWith(`${prefix}/`))) {
            return keyNorm;
        }
        const segsOfKey = keyNorm.split('/');
        const rawHead = segsOfKey[0] || '';
        const looksRawKey = /^\d{6}$/.test(rawHead) || (/^\d{4}$/.test(rawHead) && /^\d{1,2}$/.test(segsOfKey[1] || ''));
        if (!looksRawKey) {
            return keyNorm;
        }
        const tpl = cfg.nameTemplate;
        const rel = LocalAdapter.toRelativePath(key);
        const baseSegs = /\{user\}/i.test(prefixTpl) ? [] : [ownerSeg, instSeg];
        const dirSegs = [...baseSegs, prefix].filter(Boolean).join('/');
        let name;
        if (tpl) {
            const dot = file.originalName.lastIndexOf('.');
            const stem = dot > 0 ? file.originalName.slice(0, dot) : file.originalName;
            const ext = dot > 0 ? file.originalName.slice(dot + 1).toLowerCase() : '';
            const md5 = file.buffer
                ? (0, node_crypto_1.createHash)('md5').update(file.buffer).digest('hex')
                : (0, path_template_1.randomUuid)().replace(/-/g, '');
            name = (0, path_template_1.renderFileName)(tpl, { originalName: file.originalName, stem, ext, md5, timestamp: Date.now() });
        }
        else {
            const segs = rel.split('/');
            name = segs[segs.length - 1] || rel;
        }
        const dirAbs = LocalAdapter.safeJoin(this.baseRoot(channel), dirSegs);
        const p = (0, path_1.parse)(name);
        for (let i = 1; i < 1000; i += 1) {
            const candidate = i === 1 ? name : `${p.name}-${i}${p.ext}`;
            if (!(0, fs_1.existsSync)((0, path_1.join)(dirAbs, candidate))) {
                name = candidate;
                break;
            }
        }
        return `${dirSegs ? `${dirSegs}/` : ''}${name}`;
    }
    async upload(file, key, channel, ctx) {
        const base = this.baseRoot(channel);
        await this.enforceSizeLimit(base, channel);
        const relKey = await this.buildRelKey(key, file, channel, ctx);
        const abs = LocalAdapter.safeJoin(base, relKey);
        try {
            await fs_1.promises.mkdir((0, path_1.dirname)(abs), { recursive: true });
            await fs_1.promises.writeFile(abs, file.buffer);
        }
        catch (err) {
            throw new adapter_interface_1.AdapterError(`写入本地文件失败：${err.message}`, 'local');
        }
        return {
            remoteKey: relKey,
            objectPath: relKey,
            metas: {
                local: true,
                owner: LocalAdapter.ownerSegment(ctx?.owner),
                instanceId: LocalAdapter.instanceSegment(ctx?.instanceId),
            },
        };
    }
    async uploadFile(path, _size, file, key, channel, ctx) {
        const base = this.baseRoot(channel);
        await this.enforceSizeLimit(base, channel);
        const relKey = await this.buildRelKey(key, { originalName: file.originalName }, channel, ctx);
        const abs = LocalAdapter.safeJoin(base, relKey);
        try {
            await fs_1.promises.mkdir((0, path_1.dirname)(abs), { recursive: true });
            try {
                await fs_1.promises.link(path, abs);
            }
            catch {
                await fs_1.promises.copyFile(path, abs);
            }
        }
        catch (err) {
            throw new adapter_interface_1.AdapterError(`写入本地文件失败：${err.message}`, 'local');
        }
        return {
            remoteKey: relKey,
            objectPath: relKey,
            metas: {
                local: true,
                owner: LocalAdapter.ownerSegment(ctx?.owner),
                instanceId: LocalAdapter.instanceSegment(ctx?.instanceId),
            },
        };
    }
    async delete(copy, channel) {
        const rel = String(copy.remoteKey || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (!rel)
            return;
        let abs;
        try {
            abs = LocalAdapter.safeJoin(this.baseRoot(channel), LocalAdapter.toRelativePath(rel));
        }
        catch {
            return;
        }
        try {
            await fs_1.promises.unlink(abs);
        }
        catch (err) {
            if (err?.code !== 'ENOENT') {
                throw new adapter_interface_1.AdapterError(`删除本地文件失败：${err.message}`, 'local');
            }
        }
    }
    buildDirectUrl(_copy, _channel) {
        return null;
    }
}
exports.LocalAdapter = LocalAdapter;
function probeRoot(root, rel) {
    try {
        const abs = (0, path_1.normalize)((0, path_1.join)(root, LocalAdapter.toRelativePath(rel)));
        const rootWithSep = root.endsWith(path_1.sep) ? root : root + path_1.sep;
        if (abs.startsWith(rootWithSep) && (0, fs_1.existsSync)(abs))
            return abs;
    }
    catch {
    }
    const legacy = (0, path_1.normalize)((0, path_1.join)(root, rel));
    const rootWithSep = root.endsWith(path_1.sep) ? root : root + path_1.sep;
    if (legacy.startsWith(rootWithSep) && (0, fs_1.existsSync)(legacy))
        return legacy;
    return '';
}
async function localFileAbsOf(remoteKey) {
    const rel = String(remoteKey || '').replace(/^\/+/, '');
    if (!rel)
        return '';
    const builtin = probeRoot(LocalAdapter.root(), rel);
    if (builtin)
        return builtin;
    try {
        const { prisma } = await Promise.resolve().then(() => __importStar(require('../common/prisma')));
        const channels = await prisma.channel.findMany({ where: { type: 'local' }, select: { id: true, config: true } });
        for (const ch of channels) {
            let root = '';
            try {
                const cfg = LocalAdapter.readChannelCfg({
                    id: ch.id, name: '', type: 'local',
                    config: (() => { try {
                        return JSON.parse(ch.config || '{}');
                    }
                    catch {
                        return {};
                    } })(),
                    metas: {},
                });
                root = cfg.rootPath;
            }
            catch {
                root = '';
            }
            if (!root || !(0, fs_1.existsSync)(root))
                continue;
            const hit = probeRoot(root, rel);
            if (hit)
                return hit;
        }
    }
    catch {
    }
    return '';
}
function localFileAbs(remoteKey) {
    const rel = String(remoteKey || '').replace(/^\/+/, '');
    if (!rel)
        return '';
    return probeRoot(LocalAdapter.root(), rel);
}
async function writeLocalStream(relKey, source) {
    const abs = LocalAdapter.absolutePath(relKey);
    (0, fs_1.mkdirSync)((0, path_1.dirname)(abs), { recursive: true });
    await (0, promises_1.pipeline)(source, (0, fs_1.createWriteStream)(abs));
}
