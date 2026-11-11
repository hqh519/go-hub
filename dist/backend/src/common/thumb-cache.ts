/**
 * 缩略图磁盘缓存（v1.1.3）
 * ----------------------------------------------------------------------------
 * 问题：列表里的缩略图走 `/file/<name>?thumb=480`，后端每次请求都要
 *   · 本地渠道：sharp 解码**原图**再缩放；
 *   · 第三方渠道：先 HTTP 拉一遍原图，再 sharp 解码缩放。
 * 一屏 20 条瞬间、每条最多 9 张图 = 最多 180 次原图解码同时压上来，
 * 于是出现「有的图加载失败、刷新一下又好了」（CPU 打满 / 上游超时 / 浏览器排队）。
 * 灯箱打开原图时也卡，同一批请求把带宽占满了。
 *
 * 做法：把「文件 + 尺寸参数」的确定结果落到磁盘，命中直接读文件下发。
 *   · 键 = 绝对路径（或对外 URL）+ 尺寸 + fit + 源文件的 mtime/size；
 *     用 mtime/size 而不是内容哈希 —— 不必为了算键把原图读一遍，
 *     而文件一旦被替换，mtime 必然变化，旧缓存自然失效。
 *   · 缓存目录 `<后端根>/.cache/thumbs`，按 key 前两位分桶，避免单目录几十万文件。
 *   · 同时做**进行中合并**：同一张图被多个请求同时要，只解码一次，其余等结果。
 *   · 任何异常都不抛出（缓存是加速手段，不是功能）：读失败就当没命中，
 *     写失败只记一笔，照常返回内存里的结果。
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { backendSub } from './project-paths';

/** 缓存根目录 */
function cacheRoot(): string {
  return backendSub('.cache', 'thumbs');
}

function bucketDir(key: string): string {
  const dir = join(cacheRoot(), key.slice(0, 2));
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* 并发创建目录时可能已存在，忽略 */
    }
  }
  return dir;
}

/** 源文件的「版本指纹」：读不到（远端 URL / 权限问题）就用 0 */
export function sourceFingerprint(absPath: string): string {
  try {
    const st = statSync(absPath);
    return `${Math.round(st.mtimeMs)}-${st.size}`;
  } catch {
    return '0-0';
  }
}

export interface ThumbKeyParts {
  /** 源标识：本地绝对路径，或远端 URL */
  source: string;
  /** 版本指纹（本地文件用 sourceFingerprint，远端用 ETag / 空） */
  version?: string;
  width?: number | 'auto';
  height?: number | 'auto';
  fit?: string;
}

/** 生成缓存键（64 位十六进制里取 40 位足够，碰撞概率可忽略） */
export function thumbCacheKey(parts: ThumbKeyParts): string {
  const raw = [parts.source, parts.version || '0-0', parts.width ?? '', parts.height ?? '', parts.fit || 'cover'].join('|');
  return createHash('sha1').update(raw).digest('hex');
}

interface CacheHit {
  data: Buffer;
  type: string;
}

/** 读缓存；未命中返回 null */
export function readThumb(key: string): CacheHit | null {
  try {
    const dir = join(cacheRoot(), key.slice(0, 2));
    const binPath = join(dir, `${key}.bin`);
    const metaPath = join(dir, `${key}.json`);
    if (!existsSync(binPath) || !existsSync(metaPath)) return null;
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { type?: string };
    return { data: readFileSync(binPath), type: meta.type || 'application/octet-stream' };
  } catch {
    return null;
  }
}

/** 写缓存（失败静默） */
export function writeThumb(key: string, data: Buffer, type: string): void {
  try {
    const dir = bucketDir(key);
    writeFileSync(join(dir, `${key}.bin`), data);
    writeFileSync(join(dir, `${key}.json`), JSON.stringify({ type, at: Date.now() }));
  } catch {
    /* 磁盘满 / 只读挂载：放弃缓存，不影响本次响应 */
  }
}

const inflight = new Map<string, Promise<Buffer>>();

/**
 * 「读缓存 → 未命中则调用 factory 生成并落盘 → 相同 key 并发只生成一次」。
 */
export async function withThumbCache(
  key: string,
  type: string,
  factory: () => Promise<Buffer>,
): Promise<Buffer> {
  const hit = readThumb(key);
  if (hit) return hit.data;
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    try {
      const data = await factory();
      writeThumb(key, data, type);
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

/**
 * 粗粒度清理：缓存文件数超过 limit 时，删掉最旧的一批。
 * 不做精细 LRU —— 缩略图是「可再生资源」，删错了下次重新生成即可，
 * 为它维护一份访问时间索引不划算。
 */
export function pruneThumbCache(limit = 20000, dropRatio = 0.2): void {
  try {
    const root = cacheRoot();
    if (!existsSync(root)) return;
    const files: { path: string; mtime: number; size: number }[] = [];
    for (const bucket of readdirSync(root)) {
      const dir = join(root, bucket);
      let names: string[] = [];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const n of names) {
        if (!n.endsWith('.bin')) continue;
        const p = join(dir, n);
        try {
          const st = statSync(p);
          files.push({ path: p, mtime: st.mtimeMs, size: st.size });
        } catch {
          /* 刚被删掉 */
        }
      }
    }
    if (files.length <= limit) return;
    files.sort((a, b) => a.mtime - b.mtime);
    const drop = Math.floor(files.length * dropRatio);
    for (let i = 0; i < drop; i++) {
      const p = files[i].path;
      try {
        unlinkSync(p);
        unlinkSync(p.replace(/\.bin$/, '.json'));
      } catch {
        /* 忽略 */
      }
    }
  } catch {
    /* 清理失败不影响主流程 */
  }
}

/** 供调试：当前缓存体积（MB，粗略） */
export function thumbCacheSizeMB(): number {
  try {
    const root = cacheRoot();
    if (!existsSync(root)) return 0;
    let bytes = 0;
    for (const bucket of readdirSync(root)) {
      const dir = join(root, bucket);
      let names: string[] = [];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const n of names) {
        if (!n.endsWith('.bin')) continue;
        try {
          bytes += statSync(join(dir, n)).size;
        } catch {
          /* 忽略 */
        }
      }
    }
    return Math.round((bytes / 1024 / 1024) * 10) / 10;
  } catch {
    return 0;
  }
}
