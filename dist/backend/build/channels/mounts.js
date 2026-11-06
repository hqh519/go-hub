"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listContainerMounts = listContainerMounts;
const fs_1 = require("fs");
const project_paths_1 = require("../common/project-paths");
const PSEUDO_PREFIXES = [
    '/proc',
    '/sys',
    '/dev',
    '/run',
    '/etc/hosts',
    '/etc/hostname',
    '/etc/resolv.conf',
    '/etc/localtime',
    '/etc/timezone',
    '/etc/passwd',
    '/etc/group',
    '/etc/shadow',
    '/etc/nsswitch.conf',
];
const PSEUDO_FSTYPES = new Set([
    'proc', 'sysfs', 'devtmpfs', 'devpts', 'tmpfs', 'cgroup', 'cgroup2', 'mqueue',
    'securityfs', 'debugfs', 'tracefs', 'bpf', 'pstore', 'configfs', 'fusectl',
    'nsfs', 'hugetlbfs', 'autofs', 'binfmt_misc',
]);
function isPseudoPath(p) {
    return PSEUDO_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`));
}
async function readMountInfo() {
    const file = '/proc/self/mountinfo';
    if (!(0, fs_1.existsSync)(file))
        return [];
    let raw = '';
    try {
        raw = await fs_1.promises.readFile(file, 'utf8');
    }
    catch {
        return [];
    }
    const out = [];
    for (const line of raw.split('\n')) {
        if (!line.trim())
            continue;
        const parts = line.split(' ');
        if (parts.length < 7)
            continue;
        const mountPoint = parts[4];
        const sep = parts.indexOf('-');
        const fstype = sep >= 0 ? parts[sep + 1] || '' : '';
        const source = sep >= 0 ? parts[sep + 2] || '' : '';
        if (!mountPoint || mountPoint === '/')
            continue;
        if (isPseudoPath(mountPoint))
            continue;
        if (PSEUDO_FSTYPES.has(fstype))
            continue;
        out.push({ path: mountPoint, writable: false, source });
    }
    return out;
}
async function listContainerMounts() {
    const seen = new Map();
    const push = (p, source = '') => {
        if (!p || p === '/')
            return;
        const norm = p.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
        if (norm === '/')
            return;
        if (seen.has(norm))
            return;
        seen.set(norm, { path: norm, writable: false, source });
    };
    for (const m of await readMountInfo())
        push(m.path, m.source);
    for (const p of ['/app/data', '/app/backend/uploads']) {
        if ((0, fs_1.existsSync)(p))
            push(p);
    }
    const root = (0, project_paths_1.backendRoot)();
    if (root)
        push(root);
    const list = Array.from(seen.values());
    for (const m of list) {
        try {
            const st = await fs_1.promises.stat(m.path);
            if (!st.isDirectory()) {
                seen.delete(m.path);
                continue;
            }
            await fs_1.promises.access(m.path, 2);
            m.writable = true;
        }
        catch {
        }
    }
    return Array.from(seen.values()).sort((a, b) => a.path.localeCompare(b.path));
}
