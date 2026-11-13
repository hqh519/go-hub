/**
 * 文件夹属性服务 —— v3.0.0
 *
 * FolderMeta（folder_metas 表）的读写与配套判定逻辑：
 *   · 目录加密（passwordHash）—— 目录及其父级链上任一层命中即要求外链密码；
 *   · 共享（sharedUsers）—— 目录归属者把目录共享给其它账户，被共享人可在
 *     文件列表里看到该目录（含子目录）下的文件；
 *   · 访客图库（gallery）—— 把目录路径写进「其他设置 → 公开游览」的目录白名单
 *     （sysConfig:others → publicBrowse.allowedDir，多行文本、一行一个目录）。
 *
 * 实现说明：本文件以「纯函数 + 直接使用 prisma 单例」的方式组织，
 * 不做成 @Injectable provider —— app.module 不允许在本轮改动，
 * 纯函数可被 files.controller 内多个控制器直接 import 复用。
 */

import { createHash } from 'node:crypto';
import { prisma } from '../common/prisma';
import { safeParse } from '../common/file-view';
import type { SysConfigService } from '../settings/sysconfig.service';

/** sha256 十六进制（小写）—— 目录 / 标签 / 文件级密码统一存这个哈希 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

/**
 * v1.0.3：目录类型（与标签的 type 同一套口径）。
 * 目前只有文件分类；内容系统接入后，笔记 / 文章 / 待办 / 导航各自的分类
 * 用各自的 type 存，同名路径可以各存一份属性、互不覆盖。
 */
export const FOLDER_TYPE_FILE = 'file';

/**
 * 目录路径规范化：反斜杠转正、压缩重复斜杠、去首尾斜杠、路径穿越替换。
 * FileRecord.folder 本身就是「无首尾斜杠」的形态，这里保持同一规范。
 */
export function normalizeFolderPath(p?: string | null): string {
  return String(p || '')
    .replace(/\.\./g, '_')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

/**
 * v1.1.9.2：「新建目录」的创建者 / 创建时间登记（settings.extraFolderCreator）。
 *
 * 背景：目录在本系统里是逻辑概念（settings.extraFolders 里的路径字符串），
 * 没有自己的数据行，所以「创建用户」一直是拿「目录内最早一条文件记录的上传者」顶替。
 * 结果就是空目录永远没有创建者 —— 用户从图床管理新建的目录，属性里创建者一栏是空的。
 *
 * 现在建目录时把创建者单独记一份：**账户::实例 → { 路径: { creator, createdAt } }**。
 * 键恒带 `::`，默认实例也写 `owner::`，避免与 extraFolders 的旧键格式混淆。
 * 存量目录没有这条记录，读取时仍回落到「最早文件的上传者」，行为不变。
 */
export function extraFolderCreatorKey(owner: string, instanceId: string): string {
  return `${owner || ''}::${instanceId || ''}`;
}

/** 单条目录创建信息 */
export type FolderCreatorEntry = { creator: string; createdAt: number };

/**
 * 从 extraFolderCreator 映射里取某账户在某实例下的创建者表。
 * instanceId = '*' 表示「全部实例」：合并该账户所有实例键。
 */
export function folderCreatorsOf(
  map: Record<string, Record<string, FolderCreatorEntry>>,
  owner: string,
  instanceId: string,
): Record<string, FolderCreatorEntry> {
  const out: Record<string, FolderCreatorEntry> = {};
  const prefix = `${owner || ''}::`;
  for (const [k, v] of Object.entries(map || {})) {
    if (String(instanceId) === '*') {
      if (!k.startsWith(prefix)) continue;
    } else if (k !== extraFolderCreatorKey(owner, instanceId)) {
      continue;
    }
    for (const [p, entry] of Object.entries(v || {})) {
      if (!entry) continue;
      // 同名目录在多个实例下都有时，保留创建时间最早的那条（与「合并全部实例」的展示口径一致）
      const prev = out[p];
      const t = Number(entry.createdAt) || 0;
      if (!prev || (t && (!prev.createdAt || t < prev.createdAt))) out[p] = entry;
    }
  }
  return out;
}

/**
 * v1.0.0：settings.extraFolders（「新建目录」登记的空目录）的存储键。
 *
 * 旧格式是「账户 → 目录数组」，没有实例维度 —— 于是在 A 实例新建的目录，
 * 切到 B 实例后照样出现在目录树里（跨实例串位）。
 * 现在改为「账户::实例 → 目录数组」；默认实例（instanceId 为空）继续沿用旧键（纯账户名），
 * 存量数据不需要迁移即可照常读取。
 */
export function extraFoldersKey(owner: string, instanceId: string): string {
  const inst = String(instanceId || '');
  return inst ? `${owner}::${inst}` : owner;
}

/**
 * 从 extraFolders 映射里取某账户在某实例下的目录。
 * instanceId = '*' 表示「全部实例」：合并该账户所有实例键下的目录。
 */
export function extraFoldersOf(
  map: Record<string, string[]>,
  owner: string,
  instanceId: string,
): string[] {
  if (String(instanceId) === '*') {
    const out: string[] = [];
    for (const [k, v] of Object.entries(map || {})) {
      if (!Array.isArray(v)) continue;
      if (k === owner || k.startsWith(`${owner}::`)) out.push(...v);
    }
    return out;
  }
  const v = (map || {})[extraFoldersKey(owner, instanceId)];
  return Array.isArray(v) ? v : [];
}

/** 解析 FolderMeta.sharedUsers（JSON 数组字符串），脏数据按空数组处理 */
export function parseSharedUsers(raw?: string | null): string[] {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.map((x) => String(x || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** FolderMeta.metas 解析 */
export function folderMetasOf(row: { metas?: string | null }): Record<string, unknown> {
  return safeParse(row?.metas);
}

/** FolderMeta.sharedPerm 规范化：只认 edit / readonly，其余按 edit（历史数据兼容） */
export function normalizeSharedPerm(raw?: string | null): 'edit' | 'readonly' {
  return String(raw || '').trim() === 'readonly' ? 'readonly' : 'edit';
}

/** 目录属性的对外形状（共享用户读取时传 hideNote=true 隐藏备注） */
export function serializeFolderMeta(
  row: {
    id: string;
    owner: string;
    path: string;
    instanceId: string;
    passwordHash: string;
    note: string;
    sharedUsers: string;
    sharedPerm?: string | null;
    gallery: boolean;
    metas: string;
    createdAt: Date;
  },
  opts: { hideNote?: boolean; hideHash?: boolean } = {},
) {
  const metas = folderMetasOf(row);
  return {
    id: row.id,
    owner: row.owner,
    path: row.path,
    instanceId: row.instanceId,
    // 加密状态对外只给布尔，不回传哈希（哈希可被离线爆破明文等价物没有，但最小暴露原则）
    encrypted: !!row.passwordHash,
    ...(opts.hideNote ? {} : { note: row.note }),
    sharedUsers: parseSharedUsers(row.sharedUsers),
    // v3.0.0（R8）：共享权限（edit / readonly）—— 只读时被共享人不可选中、看不到目录属性入口
    sharedPerm: normalizeSharedPerm(row.sharedPerm),
    gallery: row.gallery,
    displayName: (metas.displayName as string) || '',
    createdAt: row.createdAt,
  };
}

/** 读单个目录属性（owner + instanceId + path 唯一） */
export async function findFolderMeta(path: string, instanceId: string, owner?: string) {
  const p = normalizeFolderPath(path);
  if (!p) return null;
  return prisma.folderMeta.findFirst({
    where: { path: p, instanceId: instanceId || '', type: FOLDER_TYPE_FILE, ...(owner ? { owner } : {}) },
  });
}

/**
 * 「访客图库」目录白名单的读取 / 写入。
 *
 * 现状（调查结论 v3.0.0）：后端的访客图库 = 公开画廊（公开游览），
 *   配置存 sysConfig:others → publicBrowse { enabled, allowedDir, fixed }，
 *   其中 allowedDir 是【多行文本】：一行一个目录（兼容逗号分隔的旧格式，
 *   见 files.controller publicList 的解析）。目录列表本身就支持多目录，
 *   因此 gallery=true 直接把路径并入 allowedDir；gallery=false 移出即可。
 */
export function parseGalleryDirs(allowedDir: unknown): string[] {
  return String(allowedDir || '')
    .split(/[\n\r,]+/)
    .map((d) => normalizeFolderPath(d))
    .filter(Boolean);
}

/** 把目录加入 / 移出访客图库白名单（复用 sysConfig 的深合并保存，不动其它字段） */
export async function setGalleryPath(
  sysConfig: SysConfigService,
  path: string,
  on: boolean,
): Promise<string[]> {
  const others = (await sysConfig.get('others')) as { publicBrowse?: { allowedDir?: string } };
  const cur = parseGalleryDirs(others?.publicBrowse?.allowedDir);
  const p = normalizeFolderPath(path);
  const next = (on ? Array.from(new Set([...cur, p])) : cur.filter((d) => d !== p))
    .filter(Boolean)
    .sort();
  await sysConfig.save('others', {
    publicBrowse: { allowedDir: next.join('\n') },
  });
  return next;
}

/**
 * 「共享给我的目录」列表：owner 是别人、且当前用户名在 sharedUsers 里。
 * instanceId 空 = 默认实例；'*' = 全部实例（v3.0.0 R7：历史记录 / 文件管理切「全部实例」时
 * 共享标识不能凭空消失，此时不加实例条件）。
 */
export async function listSharedFoldersFor(
  username: string,
  instanceId: string,
): Promise<{ path: string; owner: string; displayName: string; sharedPerm: 'edit' | 'readonly' }[]> {
  const u = String(username || '').trim();
  if (!u) return [];
  const rows = await prisma.folderMeta.findMany({
    where: {
      type: FOLDER_TYPE_FILE,
      ...(String(instanceId) === '*' ? {} : { instanceId: instanceId || '' }),
    },
  });
  return rows
    .filter((r) => r.owner && r.owner !== u && parseSharedUsers(r.sharedUsers).includes(u))
    .map((r) => ({
      path: r.path,
      owner: r.owner,
      displayName: (folderMetasOf(r).displayName as string) || '',
      // v3.0.0（R8）：把共享权限一并下发（前端据此隐藏属性入口 / 禁止选中）
      sharedPerm: normalizeSharedPerm(r.sharedPerm),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * 「我共享出去的目录」列表（v3.0.0）：owner 是当前用户、且 sharedUsers 非空。
 *
 * 用途：共享标识要对**所有可查看者**展示 —— 被共享者看得到，共享者自己也要看到
 * （否则自己共享出去的目录在自己列表里没有任何标识，无法确认共享是否生效）。
 */
export async function listFoldersSharedBy(
  username: string,
  instanceId: string,
): Promise<{ path: string; owner: string; displayName: string }[]> {
  const u = String(username || '').trim();
  if (!u) return [];
  const rows = await prisma.folderMeta.findMany({
    where: {
      owner: u,
      type: FOLDER_TYPE_FILE,
      ...(String(instanceId) === '*' ? {} : { instanceId: instanceId || '' }),
    },
  });
  return rows
    .filter((r) => parseSharedUsers(r.sharedUsers).length > 0)
    .map((r) => ({
      path: r.path,
      owner: r.owner,
      displayName: (folderMetasOf(r).displayName as string) || '',
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * 「当前用户能否看到这个目录（因为被共享）」—— v3.0.0（第三轮）。
 *
 * 判定：文件所在目录及其**任一层父目录**中，只要有一层被归属者共享给了 username，
 *       且该层归属者不是 username 自己，就算可见。
 * 用途：被共享用户在前台点开共享文件时，链接带 `?from=admin`，
 *       原先 checkAccess 只放行「管理员 / 上传者本人」→ 被共享用户一律 401、
 *       卡片和预览全是「加载失败」。这里补上共享这一条通路。
 *
 * 返回 { shared, owner }：owner 是命中的那一层目录归属者（前端「共享」标识要用）。
 */export async function folderSharedWithUser(
  folderPath: string | null | undefined,
  instanceId: string | null | undefined,
  username: string,
): Promise<{ shared: boolean; owner: string }> {
  const r = await folderSharedPermission(folderPath, instanceId, username);
  return { shared: r.shared, owner: r.owner };
}

/**
 * 「共享给我」的权限判定 —— v3.0.0（R12）。
 *
 * 与 folderSharedWithUser 同一套「逐层向上找命中者」规则，额外把 sharedPerm 带回。
 * 命中多层层级时取**最外层**（路径最短）那一层 —— 共享是从那一层开始生效的，
 * 其权限也是继承基线；与 listSharedFoldersFor 的语义保持一致。
 *
 * 返回 perm 默认 'edit'（历史数据没有 sharedPerm 字段，按可编辑兼容）。
 */
export async function folderSharedPermission(
  folderPath: string | null | undefined,
  instanceId: string | null | undefined,
  username: string,
): Promise<{ shared: boolean; owner: string; perm: 'edit' | 'readonly' }> {
  const u = String(username || '').trim();
  const p = normalizeFolderPath(folderPath);
  if (!u || !p) return { shared: false, owner: '', perm: 'edit' };
  const parts = p.split('/');
  const chain: string[] = [];
  for (let i = parts.length; i >= 1; i--) chain.push(parts.slice(0, i).join('/'));
  const rows = await prisma.folderMeta.findMany({
    where: { instanceId: instanceId || '', type: FOLDER_TYPE_FILE, path: { in: chain } },
  });
  const hit = rows
    .filter((r) => r.owner && r.owner !== u && parseSharedUsers(r.sharedUsers).includes(u))
    .sort((a, b) => a.path.length - b.path.length)[0];
  return hit
    ? { shared: true, owner: hit.owner, perm: normalizeSharedPerm(hit.sharedPerm) }
    : { shared: false, owner: '', perm: 'edit' };
}

/**
 * 外链密码判定（v3.0.0 起只认文件自身）。
 *
 * v3.0.0 变更：**目录加密 / 标签加密不再影响文件外链**。
 *   原先这里是三层聚合（① 文件自身 ② 目录链 ③ 标签），目录和标签的密码会让
 *   名下所有文件的外链都弹密码，与「目录/标签加密只是整理时的可见性标记」的
 *   定位不符，也让「目录对外分享」（v3.0.0 新增）与文件密码互相干扰。
 *   现在只读取文件自身 metas.AccessPasswordHash —— 一个文件是否要密码，
 *   完全由它自己的「访问密码」属性决定。
 *
 * 函数签名保持原样（folder / uploader / tags 等字段不再使用），调用方无需修改。
 *
 * 返回：{ hashes: 需要的哈希集合（空 = 无密码直接放行） }；
 * 调用方拿请求里的 pw / Cookie 哈希与之求交。
 */
export async function requiredPasswordHashes(record: {
  folder?: string | null;
  uploader?: string | null;
  metas?: string | null;
  instanceId?: string | null;
  tags?: { tag: { metas?: string | null } }[];
}): Promise<string[]> {
  const fileMetas = safeParse(record.metas);
  const fileHash = String(fileMetas.AccessPasswordHash || '').trim();
  return fileHash ? [fileHash] : [];
}

/** 外链密码验证限频：同文件 + 同 IP 一分钟只记一条失败日志 */
const pwLogThrottle = new Map<string, number>();

export function shouldLogPasswordFailure(name: string, ip: string): boolean {
  const key = `${name}::${ip || '-'}`;
  const now = Date.now();
  const last = pwLogThrottle.get(key) || 0;
  if (now - last < 60_000) return false;
  pwLogThrottle.set(key, now);
  // 顺手清理过期项，避免长期运行 Map 无限膨胀
  if (pwLogThrottle.size > 500) {
    for (const [k, t] of pwLogThrottle) {
      if (now - t > 60_000) pwLogThrottle.delete(k);
    }
  }
  return true;
}
