/**
 * 大文件上传会话 / 链接暂存 —— 磁盘落盘版（v2.8.3）。
 *
 * 背景：v2.8.2 及以前分片全部放在 `Map<uploadId, Buffer>` 里，
 * 一个 500MB 文件 = 500MB 常驻内存 + merge 时再 concat 一份 → 峰值 1GB，
 * 小内存容器必 OOM；且没有任何过期清理，用户中途关页面就会永久占内存。
 *
 * 这里把「分片 / 合并结果 / 链接暂存」全部改成磁盘文件：
 *   <tmp>/sessions/<uploadId>/manifest.json + 000001.part ...
 *   <tmp>/staging/<stagingId>/meta.json + file
 *
 * 约定：
 *   · 分片会话 24h 未完成自动清理；成功合并后保留 2h（等异步备份读完再删）。
 *   · 链接暂存 24h 清理（未提交） / 提交后保留 2h（同理等备份）。
 *   · 所有 id 只允许 [A-Za-z0-9_-]，防止路径穿越。
 */
import { promises as fsp } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

/** 未完成会话保留时长（默认 24h，可用 UPLOAD_SESSION_TTL_HOURS 覆盖） */
const SESSION_TTL_MS = Math.max(1, Number(process.env.UPLOAD_SESSION_TTL_HOURS || 24)) * 3600_000;
/** 已完成（等备份读完）保留时长 */
const COMPLETED_TTL_MS = 2 * 3600_000;
/** 合并结果文件名 */
const MERGED_NAME = 'merged.bin';

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

export interface UploadSession {
  uploadId: string;
  /** 前端生成的稳定指纹（名称+大小+修改时间），用于刷新/失败后命中同一会话 */
  uploadKey?: string;
  totalChunks: number;
  originalName: string;
  mime: string;
  /** 前端声明的文件总字节数（用于合并后校验；0 表示未知） */
  size: number;
  startedAt: number;
  updatedAt: number;
  /** 合并成功并已落库的时间；有值表示后续只等备份读完就清理 */
  completedAt?: number;
  /** v2.8.7：合并进行中的时间戳（防并发重复合并/重复落库；完成或失败后清零） */
  mergingAt?: number;
  /** v2.8.7：合并成功后落库的文件记录（幂等依据 —— 重复 merge 请求直接返回这份结果） */
  mergeFileId?: string;
  mergeName?: string;
}

export interface StagedFile {
  stagingId: string;
  name: string;
  mime: string;
  size: number;
  sourceUrl: string;
  createdAt: number;
  /** 已提交到存储渠道的时间 */
  committedAt?: number;
}

export function uploadTmpRoot(): string {
  const env = String(process.env.UPLOAD_TMP_DIR || '').trim();
  return env ? resolve(env) : join(tmpdir(), 'gohub-upload');
}

function sessionsRoot(): string {
  return join(uploadTmpRoot(), 'sessions');
}

function stagingRoot(): string {
  return join(uploadTmpRoot(), 'staging');
}

function assertId(id: string, label: string): string {
  if (!ID_RE.test(String(id || ''))) throw new Error(`${label} 无效`);
  return id;
}

export function sessionDir(uploadId: string): string {
  return join(sessionsRoot(), assertId(uploadId, 'uploadId'));
}

function manifestPath(uploadId: string): string {
  return join(sessionDir(uploadId), 'manifest.json');
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fsp.rename(tmp, path);
}

export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
}

/* ---------------- 分片会话 ---------------- */

export async function createSession(input: {
  totalChunks: number;
  originalName: string;
  mime: string;
  size?: number;
  uploadKey?: string;
}): Promise<UploadSession> {
  const uploadId = newId('u');
  const now = Date.now();
  const dir = sessionDir(uploadId);
  await fsp.mkdir(dir, { recursive: true });
  const session: UploadSession = {
    uploadId,
    uploadKey: input.uploadKey,
    totalChunks: Math.max(1, Number(input.totalChunks) || 1),
    originalName: input.originalName,
    mime: input.mime,
    size: Math.max(0, Number(input.size) || 0),
    startedAt: now,
    updatedAt: now,
  };
  await writeJsonAtomic(manifestPath(uploadId), session);
  return session;
}

export async function getSession(uploadId: string): Promise<UploadSession | null> {
  try {
    return await readJson<UploadSession>(manifestPath(uploadId));
  } catch {
    return null;
  }
}

/** 按前端指纹找可续传的会话（同一文件刷新页面/失败重试时命中） */
export async function findSessionByKey(uploadKey: string): Promise<UploadSession | null> {
  if (!uploadKey) return null;
  let dirs: string[] = [];
  try {
    dirs = await fsp.readdir(sessionsRoot());
  } catch {
    return null;
  }
  const now = Date.now();
  let best: UploadSession | null = null;
  for (const d of dirs) {
    if (!ID_RE.test(d)) continue;
    const s = await getSession(d);
    if (!s || s.completedAt) continue;
    if (s.uploadKey !== uploadKey) continue;
    if (now - s.updatedAt > SESSION_TTL_MS) continue;
    if (!best || s.updatedAt > best.updatedAt) best = s;
  }
  return best;
}

/**
 * v2.8.7：按前端指纹找「已完成」的会话（保留期内）。
 * 用于失败重试场景 —— 文件其实早已上传成功，前端再来 init 时不许新建会话重传，
 * 直接把上次的上传结果还给前端（幂等），否则每重试一轮就多落一份重复文件。
 */
export async function findCompletedSessionByKey(uploadKey: string): Promise<UploadSession | null> {
  if (!uploadKey) return null;
  let dirs: string[] = [];
  try {
    dirs = await fsp.readdir(sessionsRoot());
  } catch {
    return null;
  }
  const now = Date.now();
  let best: UploadSession | null = null;
  for (const d of dirs) {
    if (!ID_RE.test(d)) continue;
    const s = await getSession(d);
    if (!s || !s.completedAt) continue;
    if (s.uploadKey !== uploadKey) continue;
    if (now - s.updatedAt > COMPLETED_TTL_MS) continue;
    if (!best || s.updatedAt > best.updatedAt) best = s;
  }
  return best;
}

/**
 * v2.8.7：尝试占住合并锁（防同一会话被并发/重复 merge）。
 * 锁有效期 10 分钟 —— 超时视为上一次合并异常退出，允许重新占锁。
 * @returns true = 占到锁；false = 已有合并在进行中
 */
export async function claimMergeLock(session: UploadSession): Promise<boolean> {
  const now = Date.now();
  if (session.mergingAt && now - session.mergingAt < 10 * 60_000) return false;
  session.mergingAt = now;
  session.updatedAt = now;
  try {
    await writeJsonAtomic(manifestPath(session.uploadId), session);
  } catch {
    /* manifest 写失败不阻塞合并（与 touchSession 同理，TTL 有目录 mtime 兜底） */
  }
  return true;
}

/** v2.8.7：释放合并锁（合并成功/失败都要调，否则 10 分钟内该会话无法再次合并） */
export async function releaseMergeLock(session: UploadSession): Promise<void> {
  session.mergingAt = 0;
  session.updatedAt = Date.now();
  try {
    await writeJsonAtomic(manifestPath(session.uploadId), session);
  } catch {
    /* 同上，静默 */
  }
}

export async function touchSession(s: UploadSession): Promise<void> {
  s.updatedAt = Date.now();
  try {
    await writeJsonAtomic(manifestPath(s.uploadId), s);
  } catch {
    /*
     * Windows 下多个分片并发 rename 覆盖同一个 manifest 会偶发 EPERM。
     * 这不是数据问题：分片本身各自原子写入，manifest 只是缓存。
     * TTL 清理会用「目录 mtime」兜底，所以这里静默忽略即可。
     */
  }
}

/** 已收到的分片（含每片字节数），按索引升序 */
export async function receivedChunks(uploadId: string): Promise<Array<{ index: number; size: number }>> {
  const dir = sessionDir(uploadId);
  let names: string[] = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const out: Array<{ index: number; size: number }> = [];
  for (const name of names) {
    const m = /^(\d+)\.part$/.exec(name);
    if (!m) continue;
    try {
      const st = await fsp.stat(join(dir, name));
      if (st.size > 0) out.push({ index: Number(m[1]), size: st.size });
    } catch {
      /* 统计失败视为未收到 */
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** 原子写入一个分片：先写 .tmp 再 rename，避免半个分片被当成完整分片 */
export async function writeChunk(uploadId: string, index: number, buffer: Buffer): Promise<void> {
  const dir = sessionDir(uploadId);
  const target = join(dir, `${String(index).padStart(6, '0')}.part`);
  const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, buffer);
  await fsp.rename(tmp, target);
}

export function chunkPath(uploadId: string, index: number): string {
  return join(sessionDir(uploadId), `${String(index).padStart(6, '0')}.part`);
}

/**
 * 合并分片到单个文件。
 * · 缺片/空片/总大小不符 → 直接抛错（绝不 Buffer.alloc(0) 补零，否则会产出「大小对、内容坏」的文件）
 * · 逐片 append，内存占用 = 单片大小，不再出现 2× 文件大小的峰值
 */
export async function mergeSession(session: UploadSession): Promise<{ path: string; size: number }> {
  const received = await receivedChunks(session.uploadId);
  const map = new Map(received.map((r) => [r.index, r.size]));
  const missing: number[] = [];
  for (let i = 0; i < session.totalChunks; i++) {
    if (!map.get(i)) missing.push(i);
  }
  if (missing.length) {
    throw new Error(`分片不完整：缺少第 ${missing.slice(0, 10).map((i) => i + 1).join('、')} 片（共缺 ${missing.length} 片）`);
  }
  const merged = join(sessionDir(session.uploadId), MERGED_NAME);
  await fsp.rm(merged, { force: true });
  let total = 0;
  for (let i = 0; i < session.totalChunks; i++) {
    const data = await fsp.readFile(chunkPath(session.uploadId, i));
    await fsp.appendFile(merged, data);
    total += data.length;
  }
  if (session.size > 0 && total !== session.size) {
    await fsp.rm(merged, { force: true });
    throw new Error(`分片总大小不一致：收到 ${total}B，声明 ${session.size}B（请重试，已传分片会保留）`);
  }
  return { path: merged, size: total };
}

/**
 * 标记会话完成。
 * v2.8.7：同时把上传结果（fileId/name）写进 manifest —— 这是合并幂等的依据，
 * 任何迟到的重复 merge 请求都直接返回这份结果，绝不再次落库。
 */
export async function markSessionCompleted(
  session: UploadSession,
  result?: { fileId: string; name: string },
): Promise<void> {
  session.completedAt = Date.now();
  session.updatedAt = session.completedAt;
  session.mergingAt = 0;
  if (result && result.fileId) {
    session.mergeFileId = result.fileId;
    session.mergeName = result.name;
  }
  await writeJsonAtomic(manifestPath(session.uploadId), session);
}

export async function removeSession(uploadId: string): Promise<void> {
  try {
    await fsp.rm(sessionDir(uploadId), { recursive: true, force: true });
  } catch {
    /* 清理失败交给 TTL */
  }
}

/* ---------------- 链接暂存 ---------------- */

export function stagingDir(stagingId: string): string {
  return join(stagingRoot(), assertId(stagingId, 'stagingId'));
}

export function stagingFilePath(stagingId: string): string {
  return join(stagingDir(stagingId), 'file');
}

function stagingMetaPath(stagingId: string): string {
  return join(stagingDir(stagingId), 'meta.json');
}

export async function createStaging(input: {
  name: string;
  mime: string;
  size: number;
  sourceUrl: string;
}): Promise<StagedFile> {
  const stagingId = newId('st');
  await fsp.mkdir(stagingDir(stagingId), { recursive: true });
  const meta: StagedFile = {
    stagingId,
    name: input.name,
    mime: input.mime,
    size: Math.max(0, Number(input.size) || 0),
    sourceUrl: input.sourceUrl,
    createdAt: Date.now(),
  };
  await writeJsonAtomic(stagingMetaPath(stagingId), meta);
  return meta;
}

export async function getStaging(stagingId: string): Promise<StagedFile | null> {
  try {
    return await readJson<StagedFile>(stagingMetaPath(stagingId));
  } catch {
    return null;
  }
}

export async function updateStaging(meta: StagedFile, patch: Partial<StagedFile>): Promise<StagedFile> {
  const next = { ...meta, ...patch, stagingId: meta.stagingId, createdAt: meta.createdAt };
  await writeJsonAtomic(stagingMetaPath(meta.stagingId), next);
  return next;
}

export async function removeStaging(stagingId: string): Promise<void> {
  try {
    await fsp.rm(stagingDir(stagingId), { recursive: true, force: true });
  } catch {
    /* 清理失败交给 TTL */
  }
}

/* ---------------- TTL 清理 ---------------- */

async function sweepDir(root: string, decide: (dir: string, name: string) => Promise<boolean>): Promise<number> {
  let names: string[] = [];
  try {
    names = await fsp.readdir(root);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!ID_RE.test(name)) continue;
    try {
      if (await decide(root, name)) {
        await fsp.rm(join(root, name), { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      /* 单个目录失败不影响其它 */
    }
  }
  return removed;
}

/** 清理过期会话/暂存；启动时和每 30 分钟执行一次 */
export async function sweepExpiredUploads(): Promise<{ sessions: number; staging: number }> {
  const now = Date.now();
  const sessions = await sweepDir(sessionsRoot(), async (_root, name) => {
    const s = await getSession(name);
    if (!s) {
      // 没有 manifest（写到一半崩溃）→ 按目录 mtime 兜底
      const st = await fsp.stat(join(sessionsRoot(), name));
      return now - st.mtimeMs > SESSION_TTL_MS;
    }
    // 未完成会话以「目录 mtime」兜底：每次新增分片都会更新目录时间，
    // 即使 manifest 因并发写失败没更新，也不会被误判成过期。
    const dirStat = await fsp.stat(join(sessionsRoot(), name)).catch(() => null);
    const lastActive = Math.max(s.updatedAt || 0, dirStat ? dirStat.mtimeMs : 0);
    const deadline = s.completedAt ? s.completedAt + COMPLETED_TTL_MS : lastActive + SESSION_TTL_MS;
    return now > deadline;
  });
  const staging = await sweepDir(stagingRoot(), async (_root, name) => {
    const s = await getStaging(name);
    if (!s) {
      const st = await fsp.stat(join(stagingRoot(), name));
      return now - st.mtimeMs > SESSION_TTL_MS;
    }
    const deadline = s.committedAt ? s.committedAt + COMPLETED_TTL_MS : s.createdAt + SESSION_TTL_MS;
    return now > deadline;
  });
  if (sessions || staging) {
    console.log(`[upload] TTL 清理：分片会话 ${sessions} 个，链接暂存 ${staging} 个`);
  }
  return { sessions, staging };
}

let sweeperStarted = false;

/** 幂等启动清理定时器（unref：不阻止进程退出） */
export function startUploadSweeper(): void {
  if (sweeperStarted) return;
  sweeperStarted = true;
  try {
    sweepExpiredUploads().catch(() => undefined);
  } catch {
    /* 忽略 */
  }
  const timer = setInterval(() => {
    sweepExpiredUploads().catch((e) => console.warn('[upload] TTL 清理失败:', (e as Error).message));
  }, 30 * 60 * 1000);
  timer.unref?.();
}
