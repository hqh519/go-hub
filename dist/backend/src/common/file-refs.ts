/**
 * 文件「被谁引用」（v1.1.2 建立，v1.1.2.1 从「只统计笔记」扩到全类型）
 * ----------------------------------------------------------------------------
 * 为什么单独成模块，而不是写在 notes.service 里：
 *   · 使用方是**图床**侧（文件详情、删除校验），notes 模块反过来不该被 files 依赖；
 *   · 这里只有「查」这一件事，没有业务分支，放 common 下两边都能用，也不会循环引用。
 *
 * 引用来源分两类：
 *
 *   1) note —— 笔记附件（note_assets：fileId → files.id）。
 *      这是**强引用**：笔记正文里就挂着这张图，删掉笔记会缺图。
 *      note_assets 没有文件外键，所以文件被彻底删除后关联行还在 ——
 *      查询时按 notes 是否还存在过滤即可，不会因为悬空引用把数量算错。
 *
 *   2) share —— 图床的分享链接（share_links：目录分享 / 标签分享）。
 *      这是**弱引用**：文件被目录分享「覆盖」或挂在被分享的标签上，删掉它只是让
 *      分享里少一个文件，不会破坏任何内容。
 *      特意不把它算进「禁止删除」：分享是按目录/标签筛选的，一旦把根目录分享出去，
 *      整库文件都会变成「被引用」—— 那样连换个图都删不掉，明显不合理。
 *      （这一条是 v1.1.2.1 的取舍，写在删除提示与修改日志里，避免以后被当成 bug。）
 *
 * 明细页展示时两类都要给出来；FileRefCount 是两类之和。
 */
import { prisma } from './prisma';
import { safeParse } from '../notes/notes.util';

export type FileRefSource = 'note' | 'share';

export interface FileRef {
  /** 引用来源：笔记 / 分享 */
  source: FileRefSource;
  /** 来源对象的 id（note.id / shareLink.id） */
  id: string;
  /** 展示标题：笔记标题、分享的目录或标签名 */
  title: string;
  /** 分类：笔记是 moment/article/…，分享是 cate/tag */
  kind: string;
  /** 状态：笔记的 active/deleted；分享恒为 active */
  status: string;
  createdAt: number;
  author: string;
  /** 强引用（= 笔记）。只有强引用会阻断删除 */
  strong: boolean;
}

/** 目录路径归一：去掉首尾斜杠，空串代表根目录 */
function normPath(p: unknown) {
  return String(p || '').replace(/^\/+|\/+$/g, '');
}

/** 目录分享是否覆盖某个文件所在目录（含子目录；空 target = 根目录，覆盖全部） */
function shareCoversFolder(target: unknown, folder: unknown) {
  const t = normPath(target);
  const f = normPath(folder);
  if (!t) return true;
  return f === t || f.startsWith(`${t}/`);
}

/** 笔记部分：note_assets → notes */
async function noteRefsOf(ids: string[], map: Map<string, FileRef[]>) {
  if (!ids.length) return map;
  const links = await prisma.noteAsset.findMany({
    where: { fileId: { in: ids } },
    select: {
      fileId: true,
      note: {
        select: { id: true, kind: true, status: true, createdAt: true, author: true, metas: true },
      },
    },
  });
  for (const l of links) {
    const note = l.note;
    if (!note) continue;
    const list = map.get(l.fileId) || [];
    list.push({
      source: 'note',
      id: note.id,
      title: String(safeParse(note.metas).title || ''),
      kind: note.kind,
      status: note.status,
      createdAt: note.createdAt ? new Date(note.createdAt).getTime() : 0,
      author: note.author || '',
      strong: true,
    });
    map.set(l.fileId, list);
  }
  return map;
}

/** 分享部分：share_links（启用中且未过期）+ 文件所在目录 / 标签 */
async function shareRefsOf(ids: string[], map: Map<string, FileRef[]>) {
  if (!ids.length) return map;
  // 分享链接表很小（每人几十条以内），一次全取比按文件反查更省事，也不会 N+1
  const shares = await prisma.shareLink.findMany({
    where: { enabled: true },
    select: {
      id: true,
      owner: true,
      instanceId: true,
      type: true,
      target: true,
      tagId: true,
      expireAt: true,
      createdAt: true,
    },
  });
  const now = Date.now();
  const alive = shares.filter((s) => !s.expireAt || new Date(s.expireAt).getTime() > now);
  if (!alive.length) return map;

  const files = await prisma.fileRecord.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      folder: true,
      instanceId: true,
      tags: { select: { tagId: true } },
    },
  });

  for (const f of files) {
    const tagIds = f.tags.map((t) => t.tagId);
    const list = map.get(f.id) || [];
    for (const s of alive) {
      // 实例必须一致：A 实例的目录分享不该把 B 实例的同名目录算成引用
      if (String(s.instanceId || '') !== String(f.instanceId || '')) continue;
      const hit = s.type === 'tag' ? tagIds.includes(s.tagId) : shareCoversFolder(s.target, f.folder);
      if (!hit) continue;
      const isTag = s.type === 'tag';
      list.push({
        source: 'share',
        id: s.id,
        title: isTag ? `#${s.target || ''}` : `/${normPath(s.target)}`,
        kind: s.type || 'cate',
        status: 'active',
        createdAt: s.createdAt ? new Date(s.createdAt).getTime() : 0,
        author: s.owner || '',
        strong: false,
      });
    }
    if (list.length) map.set(f.id, list);
  }
  return map;
}

/**
 * 批量查「这些文件被哪些对象引用」。
 *
 * 一次查询取全部关联 + 对应对象，返回 Map<fileId, FileRef[]>。
 * 回收站里的笔记也算引用（恢复后仍在使用），因此只排除「彻底删除」——
 * 那种情况行本身已被级联删除，查不到。
 */
export async function refsOfFiles(fileIds: string[]): Promise<Map<string, FileRef[]>> {
  const ids = Array.from(new Set((fileIds || []).map((x) => String(x || '')).filter(Boolean)));
  const map = new Map<string, FileRef[]>();
  if (!ids.length) return map;
  await noteRefsOf(ids, map);
  try {
    await shareRefsOf(ids, map);
  } catch (e) {
    // 分享表结构异常不能连累「文件详情」这种只读页面：笔记部分照常返回
    console.warn('[file-refs] 统计分享引用失败：', (e as Error)?.message || e);
  }
  return map;
}

/** 单个文件的引用列表 */
export async function refsOfFile(fileId: string): Promise<FileRef[]> {
  const map = await refsOfFiles([fileId]);
  return map.get(String(fileId || '')) || [];
}

/** 引用数量的分类小计（详情页展示「其中笔记 N / 分享 M」用） */
export function countBySource(refs: FileRef[]) {
  let note = 0;
  let share = 0;
  for (const r of refs) {
    if (r.source === 'note') note += 1;
    else share += 1;
  }
  return { note, share };
}

/**
 * 删除前的引用校验 —— 只看**强引用**（笔记）。
 *
 * 需求：被笔记引用的文件不允许删除，并把引用它的笔记标题列出来，
 * 让用户知道「先去删哪几篇笔记」。分享属于筛选式引用，不阻断删除
 * （否则根目录一旦被分享，全库文件都删不掉）。
 */
export async function fileReferenceBlockMessage(fileId: string): Promise<string> {
  const refs = await refsOfFile(fileId);
  return formatRefBlockMessage(refs.filter((r) => r.strong));
}

/** 批量版：一批文件里只要有一条被笔记引用，就整批拒绝（目录删除用） */
export async function batchReferenceBlockMessage(fileIds: string[]): Promise<string> {
  const map = await refsOfFiles(fileIds);
  const all: FileRef[] = [];
  for (const list of map.values()) all.push(...list.filter((r) => r.strong));
  return formatRefBlockMessage(all);
}

function formatRefBlockMessage(refs: FileRef[]): string {
  if (!refs.length) return '';
  // 标题去重（同一篇笔记引用多个附件时只列一次）
  const titles: string[] = [];
  for (const r of refs) {
    const name = r.title || `未命名（${r.id.slice(-6)}）`;
    if (!titles.includes(name)) titles.push(name);
  }
  const shown = titles.slice(0, 5).join('、');
  const more = titles.length > 5 ? ` 等 ${titles.length} 篇` : '';
  return `该文件已被笔记引用，无法删除。引用它的笔记：${shown}${more}。请先删除对应笔记后再试。`;
}
