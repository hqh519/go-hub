/**
 * 引用统计 / 删除统计（共用计数）—— v1.1.5
 * ----------------------------------------------------------------------------
 * 图床里「一个文件」其实是两层东西：
 *
 *   ① 数据（files 一行，它决定外链 /file/<File_ID> 能不能打开）
 *   ② 实体文件（远端渠道里的对象，由 file_copies 一行行的 remoteKey / objectPath 指向）
 *
 * 去重克隆、跨实例复制都会让「多条数据 → 同一个实体对象」。所以删除时有两个独立问题：
 *
 *   · 这份数据还能删吗？  → 看「引用统计」refCount
 *       笔记挂了这个附件（强引用）、或者这个文件所在目录被共享给了别人，
 *       删掉数据会让别人的页面挂图 / 缺文件，所以一条都不许删（连进回收站也不行）。
 *
 *   · 实体文件能删吗？    → 看「删除统计」shareCount（共用数）
 *       同一个对象还被别的记录用着（哪怕那条记录在回收站里，恢复后仍要读它），
 *       就只能删自己这行数据，远端对象必须留着。
 *
 * 为什么是「按需重算再落库」而不是上传/共享时增量加减：
 *   增量维护点太多（笔记增删、共享用户变更、目录移动、跨实例移动、回收站恢复…），
 *   漏一处就永久漂移，而且漂移的两个方向都很危险：
 *   算大了 → 永远删不掉实体文件；算小了 → 把别人还在用的对象删了。
 *   重算一次只有两条查询，只在「打开详情 / 查看引用 / 执行删除」这些真正要用到的
 *   时刻算，算完写回列里（表里能看到数字，也算「记录」在案）。
 */
import { prisma } from './prisma';

/** 目录共享用户数组解析（与 files.controller 的 parseSharedUsers 同口径） */
function parseUsers(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x || '').trim()).filter(Boolean);
  const s = String(raw ?? '').trim();
  if (!s || s === '[]') return [];
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr.map((x) => String(x || '').trim()).filter(Boolean);
    return [];
  } catch {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }
}

/** 目录路径归一（去首尾斜杠，空串 = 根目录） */
function normPath(p: unknown): string {
  return String(p || '').replace(/^\/+|\/+$/g, '');
}

/** 共享目录是否覆盖某个文件所在目录（含子目录；空 target = 根目录，覆盖全部） */
function covers(target: string, folder: string): boolean {
  const t = normPath(target);
  const f = normPath(folder);
  if (!t) return true;
  return f === t || f.startsWith(`${t}/`);
}

export interface FileStats {
  /** 引用统计：笔记附件条数 + 目录共享接收人数 */
  ref: number;
  /** 删除统计：同一实体对象还被多少条「别的记录」用着（含回收站） */
  share: number;
}

/**
 * 计算一批文件的引用统计 / 共用统计，并把结果写回 files 两列。
 *
 * @param ids files.id 列表
 * @param persist 是否落库（默认 true；纯展示场景也可传 false）
 */
export async function syncFileStats(ids: string[], persist = true): Promise<Map<string, FileStats>> {
  const uniq = Array.from(new Set((ids || []).map((x) => String(x || '')).filter(Boolean)));
  const out = new Map<string, FileStats>();
  if (!uniq.length) return out;

  const files = await prisma.fileRecord.findMany({
    where: { id: { in: uniq } },
    select: {
      id: true,
      folder: true,
      instanceId: true,
      uploader: true,
      refCount: true,
      shareCount: true,
      copies: { select: { channelId: true, remoteKey: true, objectPath: true } },
    },
  });
  if (!files.length) return out;

  /* ---------------- 1) 引用统计 ---------------- */
  // 1a. 笔记附件：note_assets 每挂一次算一次（封面 cover / 正文 inline 同样算）。
  //     笔记进回收站不清附件（onDelete: Cascade 只在彻底删除时触发），
  //     恢复后仍要读这个文件，所以回收站里的笔记照样计数。
  const noteLinks = await prisma.noteAsset.groupBy({
    by: ['fileId'],
    where: { fileId: { in: files.map((f) => f.id) } },
    _count: { _all: true },
  });
  const noteCount = new Map<string, number>();
  for (const row of noteLinks) noteCount.set(row.fileId, Number(row._count?._all || 0));

  // 1b. 目录共享：文件所在目录（含祖先目录）被共享给 N 个用户 → 引用 N 次。
  //     只认「文件归属实例」下的目录属性行，避免 A 实例的目录共享算到 B 实例头上。
  const instances = Array.from(new Set(files.map((f) => String(f.instanceId || ''))));
  const metas = await prisma.folderMeta.findMany({
    where: { type: 'file', instanceId: { in: instances }, sharedUsers: { not: '[]' } },
    select: { owner: true, path: true, instanceId: true, sharedUsers: true },
  });
  const shareRows = metas
    .map((m) => ({
      owner: String(m.owner || ''),
      path: normPath(m.path),
      instanceId: String(m.instanceId || ''),
      users: parseUsers(m.sharedUsers),
    }))
    .filter((m) => m.users.length > 0);

  const refOf = new Map<string, number>();
  for (const f of files) {
    const folder = normPath(f.folder);
    const inst = String(f.instanceId || '');
    const mine = String(f.uploader || '');
    let shared = 0;
    for (const m of shareRows) {
      if (m.instanceId !== inst) continue;
      // 只算「目录归属者本人设置的共享」——别人对该路径也有一行属性时不算
      if (mine && m.owner && m.owner !== mine) continue;
      if (!covers(m.path, folder)) continue;
      shared += m.users.length;
    }
    refOf.set(f.id, (noteCount.get(f.id) || 0) + shared);
  }

  /* ---------------- 2) 删除统计（共用） ---------------- */
  // 判定键：同渠道 + (remoteKey 或 objectPath) 相同 ⇒ 指向同一个实体对象。
  // 两条键都收进来，是为了同时覆盖新数据（两者都有）和老数据（只有其一）。
  const keyOf = (c: { channelId: string; remoteKey: string; objectPath: string }) =>
    [
      c.remoteKey ? `${c.channelId}\u0000k\u0000${c.remoteKey}` : '',
      c.objectPath ? `${c.channelId}\u0000p\u0000${c.objectPath}` : '',
    ].filter(Boolean);

  const myKeys = new Map<string, Set<string>>();
  const allKeys = new Set<string>();
  for (const f of files) {
    const set = new Set<string>();
    for (const c of f.copies) for (const k of keyOf(c)) set.add(k);
    myKeys.set(f.id, set);
    for (const k of set) allKeys.add(k);
  }

  const shareOf = new Map<string, number>();
  for (const f of files) shareOf.set(f.id, 0);
  if (allKeys.size) {
    // 一次查出所有「沾到这些键」的副本行（含回收站里的记录 —— 恢复后仍要读同一对象）
    const cousins = await prisma.fileCopy.findMany({
      where: {
        OR: Array.from(allKeys).map((k) => {
          const [channelId, kind, v] = k.split('\u0000');
          return kind === 'k' ? { channelId, remoteKey: v } : { channelId, objectPath: v };
        }),
      },
      select: { fileId: true, channelId: true, remoteKey: true, objectPath: true },
    });
    const keysByFile = new Map<string, Set<string>>();
    for (const c of cousins) {
      const set = keysByFile.get(c.fileId) || new Set<string>();
      for (const k of keyOf(c)) set.add(k);
      keysByFile.set(c.fileId, set);
    }
    for (const f of files) {
      const mine = myKeys.get(f.id) || new Set<string>();
      let n = 0;
      for (const [otherId, keys] of keysByFile) {
        if (otherId === f.id) continue;
        let hit = false;
        for (const k of keys) {
          if (mine.has(k)) {
            hit = true;
            break;
          }
        }
        if (hit) n += 1;
      }
      shareOf.set(f.id, n);
    }
  }

  /* ---------------- 3) 汇总 + 落库 ---------------- */
  for (const f of files) {
    const ref = refOf.get(f.id) || 0;
    const share = shareOf.get(f.id) || 0;
    out.set(f.id, { ref, share });
    if (!persist) continue;
    if (ref === f.refCount && share === f.shareCount) continue;
    try {
      await prisma.fileRecord.update({ where: { id: f.id }, data: { refCount: ref, shareCount: share } });
    } catch {
      // 记录刚好被删掉了（并发）—— 统计写不进去不影响调用方
    }
  }
  return out;
}

/** 单个文件的统计（详情页 / 删除判定用） */
export async function fileStats(fileId: string): Promise<FileStats> {
  const map = await syncFileStats([fileId]);
  return map.get(String(fileId || '')) || { ref: 0, share: 0 };
}

/** 批量：只要有一条 refCount > 0 就返回该条（用于批量删除前的拦截提示） */
export async function firstReferenced(ids: string[]): Promise<{ id: string; name: string; ref: number } | null> {
  const uniq = Array.from(new Set((ids || []).map((x) => String(x || '')).filter(Boolean)));
  if (!uniq.length) return null;
  const rows = await prisma.fileRecord.findMany({
    where: { id: { in: uniq } },
    select: { id: true, name: true, originalName: true },
  });
  const map = await syncFileStats(rows.map((r) => r.id));
  for (const r of rows) {
    const st = map.get(r.id);
    if (st && st.ref > 0) return { id: r.id, name: r.originalName || r.name, ref: st.ref };
  }
  return null;
}

export interface SharedMember {
  /** files.id */
  fileId: string;
  /** File_ID（外链标识） */
  name: string;
  originalName: string;
  uploader: string;
  instanceId: string;
  /** 实例名（空实例 = 默认实例） */
  instanceName: string;
  /** active | deleted */
  status: string;
  createdAt: number;
  /** 是不是本文件派生出去的克隆（cloneOf 指向自己） */
  clonedFromMe: boolean;
}

/**
 * 共用清单：和这个文件共用同一个实体对象的「别的记录」。
 * 明细页「共用」区、删除提示都用它。
 */
export async function sharedMembers(fileId: string): Promise<SharedMember[]> {
  const me = await prisma.fileRecord.findUnique({
    where: { id: String(fileId || '') },
    select: { id: true, copies: { select: { channelId: true, remoteKey: true, objectPath: true } } },
  });
  if (!me) return [];
  const keyOf = (c: { channelId: string; remoteKey: string; objectPath: string }) => [
    c.remoteKey ? `${c.channelId}\u0000k\u0000${c.remoteKey}` : '',
    c.objectPath ? `${c.channelId}\u0000p\u0000${c.objectPath}` : '',
  ].filter(Boolean);
  const mine = new Set<string>();
  for (const c of me.copies) for (const k of keyOf(c)) mine.add(k);
  if (!mine.size) return [];

  const cousins = await prisma.fileCopy.findMany({
    where: {
      fileId: { not: me.id },
      OR: Array.from(mine).map((k) => {
        const [channelId, kind, v] = k.split('\u0000');
        return kind === 'k' ? { channelId, remoteKey: v } : { channelId, objectPath: v };
      }),
    },
    select: {
      channelId: true,
      remoteKey: true,
      objectPath: true,
      file: {
        select: {
          id: true,
          name: true,
          originalName: true,
          uploader: true,
          instanceId: true,
          status: true,
          createdAt: true,
          cloneOf: true,
        },
      },
    },
  });

  const seen = new Map<string, SharedMember>();
  for (const c of cousins) {
    const f = c.file;
    if (!f || seen.has(f.id)) continue;
    // 必须真的撞上同一个键（OR 查询是「任一键命中」，这里再核一次）
    const hit = keyOf(c).some((k) => mine.has(k));
    if (!hit) continue;
    seen.set(f.id, {
      fileId: f.id,
      name: f.name,
      originalName: f.originalName,
      uploader: f.uploader || '',
      instanceId: String(f.instanceId || ''),
      instanceName: '',
      status: f.status,
      createdAt: f.createdAt ? new Date(f.createdAt).getTime() : 0,
      clonedFromMe: String(f.cloneOf || '') === me.id,
    });
  }
  if (!seen.size) return [];

  // 实例名：空串 = 默认实例；其余查一次表（共用通常就一两条，代价可忽略）
  const ids = Array.from(new Set(Array.from(seen.values()).map((m) => m.instanceId).filter(Boolean)));
  const instMap = new Map<string, string>();
  if (ids.length) {
    const list = await prisma.instance.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    for (const i of list) instMap.set(i.id, i.name);
  }
  for (const m of seen.values()) m.instanceName = m.instanceId ? instMap.get(m.instanceId) || m.instanceId : '默认实例';
  return Array.from(seen.values()).sort((a, b) => a.createdAt - b.createdAt);
}
