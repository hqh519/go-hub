"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appLog = void 0;
exports.scrub = scrub;
const fs_1 = require("fs");
const path_1 = require("path");
const project_paths_1 = require("./project-paths");
const MAX_ENTRIES = 2000;
const SECRET_PATTERNS = [
    [/(secret|token|apikey|api_key|password|passwd|authorization|accesskey|signature)(["'\s:=]+)([^\s"',&]{4})[^\s"',&]*/gi, '$1$2$3****'],
    [/\b(AKID|LTAI)[A-Za-z0-9]{6,}/g, '$1****'],
    [/(Bearer\s+)[A-Za-z0-9._\-|+/=]{6,}/gi, '$1****'],
];
function scrub(text) {
    if (!text)
        return text;
    let out = text;
    for (const [re, rep] of SECRET_PATTERNS)
        out = out.replace(re, rep);
    return out;
}
function toText(v) {
    if (typeof v === 'string')
        return v;
    if (v instanceof Error)
        return `${v.message}${v.stack ? `\n${v.stack.split('\n').slice(1, 4).join('\n')}` : ''}`;
    if (v === null || v === undefined)
        return String(v);
    try {
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    catch {
        return String(v);
    }
}
class AppLogStore {
    buf = [];
    seq = 0;
    logDir = null;
    currentFile = null;
    patched = false;
    constructor() {
        this.initFile();
        this.pruneOldLogs();
        const timer = setInterval(() => this.pruneOldLogs(), 6 * 3600 * 1000);
        if (typeof timer.unref === 'function')
            timer.unref();
    }
    pruneOldLogs() {
        if (!this.logDir)
            return;
        const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
        try {
            for (const f of (0, fs_1.readdirSync)(this.logDir)) {
                if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
                    continue;
                const p = (0, path_1.join)(this.logDir, f);
                try {
                    const st = (0, fs_1.statSync)(p);
                    const dayMs = Date.parse(f.slice(4, 14));
                    if ((Number.isFinite(dayMs) && dayMs < cutoff) || st.mtimeMs < cutoff)
                        (0, fs_1.unlinkSync)(p);
                }
                catch {
                }
            }
        }
        catch {
        }
    }
    initFile() {
        try {
            const target = (0, project_paths_1.logsDir)();
            if (!(0, fs_1.existsSync)(target))
                (0, fs_1.mkdirSync)(target, { recursive: true });
            this.logDir = target;
        }
        catch {
        }
    }
    writeFile(entry) {
        if (!this.logDir)
            return;
        try {
            const day = new Date(entry.at).toISOString().slice(0, 10);
            const file = (0, path_1.join)(this.logDir, `app-${day}.log`);
            this.currentFile = file;
            const line = `${new Date(entry.at).toISOString()} [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}${entry.detail ? ` | ${entry.detail}` : ''}${entry.ip ? ` | ip=${entry.ip}` : ''}\n`;
            (0, fs_1.appendFile)(file, line, () => undefined);
        }
        catch {
        }
    }
    add(level, scope, message, detail, ip) {
        const entry = {
            id: ++this.seq,
            at: Date.now(),
            level,
            scope: scope || 'app',
            message: scrub(String(message ?? '')).slice(0, 2000),
            detail: detail ? scrub(String(detail)).slice(0, 4000) : undefined,
            ip: ip || undefined,
        };
        this.buf.push(entry);
        if (this.buf.length > MAX_ENTRIES)
            this.buf.splice(0, this.buf.length - MAX_ENTRIES);
        this.writeFile(entry);
        return entry;
    }
    info(scope, message, detail, ip) {
        return this.add('info', scope, message, detail, ip);
    }
    warn(scope, message, detail, ip) {
        return this.add('warn', scope, message, detail, ip);
    }
    error(scope, message, detail, ip) {
        return this.add('error', scope, message, detail, ip);
    }
    list(opts = {}) {
        const today = new Date().toISOString().slice(0, 10);
        if (opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) && opts.date !== today) {
            return this.listFromFile(opts);
        }
        const limit = Math.min(1000, Math.max(1, Number(opts.limit) || 200));
        const kw = (opts.keyword || '').toLowerCase();
        const rows = this.buf.filter((e) => {
            if (opts.level && opts.level !== 'all' && e.level !== opts.level)
                return false;
            if (opts.scope && opts.scope !== 'all' && e.scope !== opts.scope)
                return false;
            if (opts.since && e.at <= opts.since)
                return false;
            if (kw && !(`${e.scope} ${e.message} ${e.detail || ''}`.toLowerCase().includes(kw)))
                return false;
            return true;
        });
        return { total: rows.length, entries: rows.slice(-limit).reverse() };
    }
    listFromFile(opts) {
        if (!this.logDir)
            return { total: 0, entries: [] };
        const file = (0, path_1.join)(this.logDir, `app-${opts.date}.log`);
        if (!(0, fs_1.existsSync)(file))
            return { total: 0, entries: [] };
        let text = '';
        try {
            text = (0, fs_1.readFileSync)(file, 'utf8');
        }
        catch {
            return { total: 0, entries: [] };
        }
        const limit = Math.min(2000, Math.max(1, Number(opts.limit) || 500));
        const kw = (opts.keyword || '').toLowerCase();
        const entries = [];
        let id = 0;
        for (const line of text.split(/\r?\n/)) {
            if (!line)
                continue;
            const m = /^(\S+)\s+\[(\w+)\]\s+\[([^\]]+)\]\s*(.*)$/.exec(line);
            if (!m)
                continue;
            const level = m[2].toLowerCase();
            if (opts.level && opts.level !== 'all' && level !== opts.level)
                continue;
            if (opts.scope && opts.scope !== 'all' && m[3] !== opts.scope)
                continue;
            const parts = m[4].split(' | ');
            const message = parts[0];
            const ipPart = parts.find((p) => p.startsWith('ip='));
            const detail = parts.slice(1).filter((p) => !p.startsWith('ip=')).join(' | ');
            if (kw && !`${m[3]} ${message} ${detail}`.toLowerCase().includes(kw))
                continue;
            const at = Date.parse(m[1]);
            entries.push({ id: ++id, at: Number.isFinite(at) ? at : 0, level, scope: m[3], message, detail: detail || undefined, ip: ipPart ? ipPart.slice(3) : undefined });
        }
        return { total: entries.length, entries: entries.slice(-limit).reverse() };
    }
    logFiles() {
        if (!this.logDir)
            return [];
        try {
            return (0, fs_1.readdirSync)(this.logDir)
                .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
                .map((f) => {
                const st = (0, fs_1.statSync)((0, path_1.join)(this.logDir, f));
                return { name: f, date: f.slice(4, 14), size: st.size, mtime: st.mtimeMs };
            })
                .sort((a, b) => (a.date < b.date ? 1 : -1));
        }
        catch {
            return [];
        }
    }
    scopes() {
        return Array.from(new Set(this.buf.map((e) => e.scope))).sort();
    }
    stats() {
        const byLevel = { info: 0, warn: 0, error: 0 };
        for (const e of this.buf)
            byLevel[e.level] += 1;
        return { buffered: this.buf.length, capacity: MAX_ENTRIES, byLevel, logDir: this.logDir, file: this.currentFile };
    }
    clear() {
        const n = this.buf.length;
        this.buf = [];
        return n;
    }
    get directory() {
        return this.logDir;
    }
    patchConsole() {
        if (this.patched)
            return;
        this.patched = true;
        const self = this;
        const raw = {
            log: console.log.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console),
        };
        const wrap = (level, fallbackScope, orig) => (...args) => {
            orig(...args);
            try {
                const parts = args.map(toText);
                const message = parts[0] || '';
                const detail = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
                const m = /^\[([\w.-]+)\]\s*(.*)$/.exec(message);
                self.add(level, m ? m[1] : fallbackScope, m ? m[2] : message, detail);
            }
            catch {
            }
        };
        console.log = wrap('info', 'app', raw.log);
        console.warn = wrap('warn', 'app', raw.warn);
        console.error = wrap('error', 'app', raw.error);
    }
}
exports.appLog = new AppLogStore();
