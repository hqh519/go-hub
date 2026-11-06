/**
 * 应用日志中心 —— 后台「系统日志」页的数据源。
 *
 * 设计目标（调试优先，单实例 SQLite 部署形态）：
 *   1. 内存环形缓冲（默认 2000 条）：后台可实时查看，进程重启即清空；
 *   2. 同步落盘 backend/logs/app-YYYY-MM-DD.log：重启后仍可追溯；
 *   3. 接管 console.log/warn/error —— 项目中已有的所有日志（适配器报错、
 *      备份失败、未捕获异常等）自动进入缓冲区，无需逐处改造；
 *   4. 提供 HTTP 请求日志（只记 /api、/upload 等动态请求，跳过 /file/* 静态直链）。
 *
 * 安全：详情里可能出现渠道密钥 ⇒ `scrub()` 统一脱敏后再入库/落盘。
 */

import { existsSync, mkdirSync, appendFile, readdirSync, statSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { logsDir } from './project-paths';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  at: number;
  level: LogLevel;
  scope: string;
  message: string;
  detail?: string;
  ip?: string;
}

const MAX_ENTRIES = 2000;
/** 常见密钥字段：命中即打码 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(secret|token|apikey|api_key|password|passwd|authorization|accesskey|signature)(["'\s:=]+)([^\s"',&]{4})[^\s"',&]*/gi, '$1$2$3****'],
  [/\b(AKID|LTAI)[A-Za-z0-9]{6,}/g, '$1****'],
  [/(Bearer\s+)[A-Za-z0-9._\-|+/=]{6,}/gi, '$1****'],
];

export function scrub(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

function toText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.message}${v.stack ? `\n${v.stack.split('\n').slice(1, 4).join('\n')}` : ''}`;
  if (v === null || v === undefined) return String(v);
  try {
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  } catch {
    return String(v);
  }
}

class AppLogStore {
  private buf: LogEntry[] = [];
  private seq = 0;
  private logDir: string | null = null;
  private currentFile: string | null = null;
  private patched = false;

  constructor() {
    this.initFile();
    // 日志只保留最近 7 天：启动时清理一次，之后每 6 小时清理一次
    this.pruneOldLogs();
    const timer = setInterval(() => this.pruneOldLogs(), 6 * 3600 * 1000);
    if (typeof timer.unref === 'function') timer.unref();
  }

  /** 保留最近 7 天日志，超期文件自动删除（避免长期运行堆积占满磁盘） */
  private pruneOldLogs() {
    if (!this.logDir) return;
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    try {
      for (const f of readdirSync(this.logDir)) {
        if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
        const p = join(this.logDir, f);
        try {
          const st = statSync(p);
          const dayMs = Date.parse(f.slice(4, 14)); // app-YYYY-MM-DD.log
          if ((Number.isFinite(dayMs) && dayMs < cutoff) || st.mtimeMs < cutoff) unlinkSync(p);
        } catch {
          /* 单个文件异常忽略 */
        }
      }
    } catch {
      /* 目录不可读忽略 */
    }
  }

  /**
   * 日志目录：固定为 <后端根>/logs。
   *
   * v1.6.0 起不再自己推导路径 —— 直接用 project-paths 的 backendRoot()
   * （按 package.json 定位）。这样 debug/backend/build、dist/backend/build、
   * 容器内 /app/backend/build 三种布局都落到各自的 ../logs，
   * 不会出现「日志跑到 dist/logs 或嵌套出 build/backend/logs」的问题。
   */
  private initFile() {
    try {
      const target = logsDir();
      if (!existsSync(target)) mkdirSync(target, { recursive: true });
      this.logDir = target;
    } catch {
      /* 无写权限时退化为仅内存日志 */
    }
  }

  /** 落盘（按天一个文件） */
  private writeFile(entry: LogEntry) {
    if (!this.logDir) return;
    try {
      const day = new Date(entry.at).toISOString().slice(0, 10);
      const file = join(this.logDir, `app-${day}.log`);
      this.currentFile = file;
      const line = `${new Date(entry.at).toISOString()} [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}${
        entry.detail ? ` | ${entry.detail}` : ''
      }${entry.ip ? ` | ip=${entry.ip}` : ''}\n`;
      appendFile(file, line, () => undefined);
    } catch {
      /* 落盘失败不影响服务 */
    }
  }

  add(level: LogLevel, scope: string, message: string, detail?: string, ip?: string): LogEntry {
    const entry: LogEntry = {
      id: ++this.seq,
      at: Date.now(),
      level,
      scope: scope || 'app',
      message: scrub(String(message ?? '')).slice(0, 2000),
      detail: detail ? scrub(String(detail)).slice(0, 4000) : undefined,
      ip: ip || undefined,
    };
    this.buf.push(entry);
    if (this.buf.length > MAX_ENTRIES) this.buf.splice(0, this.buf.length - MAX_ENTRIES);
    this.writeFile(entry);
    return entry;
  }

  info(scope: string, message: string, detail?: string, ip?: string) {
    return this.add('info', scope, message, detail, ip);
  }

  warn(scope: string, message: string, detail?: string, ip?: string) {
    return this.add('warn', scope, message, detail, ip);
  }

  error(scope: string, message: string, detail?: string, ip?: string) {
    return this.add('error', scope, message, detail, ip);
  }

  /**
   * 查询日志。
   *   - 不传 date / date 为今天 → 读内存缓冲（实时）
   *   - date 为历史日期       → 直接解析 backend/logs/app-<date>.log 磁盘文件
   */
  list(opts: { level?: string; scope?: string; keyword?: string; limit?: number; since?: number; date?: string } = {}) {
    const today = new Date().toISOString().slice(0, 10);
    if (opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) && opts.date !== today) {
      return this.listFromFile(opts);
    }
    const limit = Math.min(1000, Math.max(1, Number(opts.limit) || 200));
    const kw = (opts.keyword || '').toLowerCase();
    const rows = this.buf.filter((e) => {
      if (opts.level && opts.level !== 'all' && e.level !== opts.level) return false;
      if (opts.scope && opts.scope !== 'all' && e.scope !== opts.scope) return false;
      if (opts.since && e.at <= opts.since) return false;
      if (kw && !(`${e.scope} ${e.message} ${e.detail || ''}`.toLowerCase().includes(kw))) return false;
      return true;
    });
    return { total: rows.length, entries: rows.slice(-limit).reverse() };
  }

  /** 从磁盘日志文件读取指定日期的日志（后台「选择日志版本」用） */
  private listFromFile(opts: { level?: string; scope?: string; keyword?: string; limit?: number; date?: string }) {
    if (!this.logDir) return { total: 0, entries: [] as LogEntry[] };
    const file = join(this.logDir, `app-${opts.date}.log`);
    if (!existsSync(file)) return { total: 0, entries: [] as LogEntry[] };
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return { total: 0, entries: [] as LogEntry[] };
    }
    const limit = Math.min(2000, Math.max(1, Number(opts.limit) || 500));
    const kw = (opts.keyword || '').toLowerCase();
    const entries: LogEntry[] = [];
    let id = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      const m = /^(\S+)\s+\[(\w+)\]\s+\[([^\]]+)\]\s*(.*)$/.exec(line);
      if (!m) continue;
      const level = m[2].toLowerCase() as LogLevel;
      if (opts.level && opts.level !== 'all' && level !== opts.level) continue;
      if (opts.scope && opts.scope !== 'all' && m[3] !== opts.scope) continue;
      const parts = m[4].split(' | ');
      const message = parts[0];
      const ipPart = parts.find((p) => p.startsWith('ip='));
      const detail = parts.slice(1).filter((p) => !p.startsWith('ip=')).join(' | ');
      if (kw && !`${m[3]} ${message} ${detail}`.toLowerCase().includes(kw)) continue;
      const at = Date.parse(m[1]);
      entries.push({ id: ++id, at: Number.isFinite(at) ? at : 0, level, scope: m[3], message, detail: detail || undefined, ip: ipPart ? ipPart.slice(3) : undefined });
    }
    return { total: entries.length, entries: entries.slice(-limit).reverse() };
  }

  /** 磁盘日志文件列表（后台「选择日志版本」下拉数据源），按日期倒序 */
  logFiles(): Array<{ name: string; date: string; size: number; mtime: number }> {
    if (!this.logDir) return [];
    try {
      return readdirSync(this.logDir)
        .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
        .map((f) => {
          const st = statSync(join(this.logDir as string, f));
          return { name: f, date: f.slice(4, 14), size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => (a.date < b.date ? 1 : -1));
    } catch {
      return [];
    }
  }

  /** 作用域清单（供前端筛选下拉） */
  scopes(): string[] {
    return Array.from(new Set(this.buf.map((e) => e.scope))).sort();
  }

  stats() {
    const byLevel = { info: 0, warn: 0, error: 0 };
    for (const e of this.buf) byLevel[e.level] += 1;
    return { buffered: this.buf.length, capacity: MAX_ENTRIES, byLevel, logDir: this.logDir, file: this.currentFile };
  }

  clear() {
    const n = this.buf.length;
    this.buf = [];
    return n;
  }

  /** 落盘文件路径（供管理端提示「完整日志见 …」） */
  get directory() {
    return this.logDir;
  }

  /**
   * 接管 console.*：项目里已有的 console.error/warn/log 全部进入缓冲区。
   * 必须在其它模块输出日志之前调用一次即可。
   */
  patchConsole() {
    if (this.patched) return;
    this.patched = true;
    const self = this;
    const raw = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };
    const wrap =
      (level: LogLevel, fallbackScope: string, orig: (...a: unknown[]) => void) =>
      (...args: unknown[]) => {
        orig(...args);
        try {
          const parts = args.map(toText);
          const message = parts[0] || '';
          const detail = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
          // 形如 "[lsky] xxx" / "[backup] xxx" 的前缀 → 提取为 scope
          const m = /^\[([\w.-]+)\]\s*(.*)$/.exec(message);
          self.add(level, m ? m[1] : fallbackScope, m ? m[2] : message, detail);
        } catch {
          /* 记录失败不影响业务 */
        }
      };
    console.log = wrap('info', 'app', raw.log);
    console.warn = wrap('warn', 'app', raw.warn);
    console.error = wrap('error', 'app', raw.error);
  }
}

export const appLog = new AppLogStore();
