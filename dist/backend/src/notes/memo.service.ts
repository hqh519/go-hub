/**
 * 笔记板块 · 笔记管理（v1.3.0）
 * ----------------------------------------------------------------------------
 * 与「瞬间」共用 `notes` 主表，靠 `kind = 'memo'` 区分。刻意**不新建主表**：
 * 标签、附件、留言、回收站、乐观锁版本号这些能力瞬间已经跑通，
 * 笔记再建一套就是两份并行维护的代码。
 *
 * 本文件负责两件事：
 *   1) 无限层级目录（`memo_folders`）—— 建 / 改名 / 移动 / 删除上浮 / 同级排序；
 *   2) 文档型笔记的 CRUD —— 列表（**不拉全文**）/ 详情 / 保存（乐观锁）/ 回收站。
 *
 * 三条硬约束（对应 `docs/规划/编辑器分期方案.md` §2.3、§10.1）：
 *   · 列表必须走 select 投影：正文是几万字的 md，拉全文等于把列表页变成下载页；
 *   · `contentFormat` 显式标注格式：老数据的''（瞬间纯文本）永远不被当 md 重新解析；
 *   · 权限一律 `author = viewer` + `instanceId` 双收窄，与瞬间同一口径。
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '../common/prisma';
import { appLog } from '../common/app-log';
import { safeParse, normalizeTagNames } from './notes.util';
import { findOrCreateTag } from '../common/tags';
import { countMemoChars, countMemoWords, excerptOf, titleFromContent, withBlockIds } from './memo.util';
import { parseBlocks, parseLinks } from './memo-block.util';

/** 列表项（前端契约）—— 刻意不含 content */
export interface MemoListItem {
  id: string;
  title: string;
  excerpt: string;
  folderId: string;
  charCount: number;
  /**
   * v1.3.4.2（需求）：列表显示「字数」（汉字 + 字母）。
   * 旧笔记的 metas 里没有这个字段，返回 null 让前端回退到 charCount。
   */
  wordCount: number | null;
  version: number;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoFolderView {
  id: string;
  name: string;
  parentId: string;
  sort: number;
  /** 直属笔记数 */
  count: number;
  /** 含所有子目录的笔记数 */
  total: number;
  createdAt: number;
  updatedAt: number;
}

const MAX_TITLE = 200;
/** 每篇内容最多保留多少条历史快照（需求原文：100 条，超出删旧） */
const MAX_HISTORY = 100;
const MAX_FOLDER_NAME = 60;
/**
 * 向上遍历目录链时的圈数上限。
 *
 * v1.3.1：12 → 200。原值只是防「A 在 B 里、B 在 A 里」的死循环，
 * 但它同时截断了两种情况：① 超过 12 层的目录，祖先的笔记计数不再往上汇总；
 * ② 超过 12 层的移动，环检测直接放弃（可能真的写出一个环）。
 * 需求要的是「无限层级目录」，所以这里放到 200 —— 对人手建的目录等于无上限，
 * 又仍然是有限值，绝不会把进程转死。
 */
const MAX_FOLDER_DEPTH = 200;

function asInt(v: unknown, fallback = 0): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : fallback;
}

function timeOf(v: unknown): number {
  if (!v) return 0;
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? t : 0;
}

@Injectable()
export class MemoService {
  // ============================================================
  //  目录
  // ============================================================

  /**
   * 目录树 + 每个目录的笔记数。
   *
   * 计数用一次 groupBy 取「全部目录各自的直属数量」，再在内存里向上累加，
   * 不要对每个目录各查一次 —— 目录一多就是 N+1。
   */
  async listFolders(viewer: string, instanceId: string) {
    const where = { author: viewer, instanceId };
    const [folders, counts] = await Promise.all([
      prisma.memoFolder.findMany({ where, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
      prisma.note.groupBy({
        by: ['folderId'],
        where: { ...where, kind: 'memo', status: { not: 'deleted' } },
        _count: { _all: true },
      }),
    ]);
    const direct = new Map<string, number>();
    let unfiled = 0;
    for (const g of counts as any[]) {
      const key = String(g.folderId || '');
      const n = asInt(g._count?._all);
      if (!key) unfiled += n;
      else direct.set(key, n);
    }
    const list: MemoFolderView[] = folders.map((f: any) => ({
      id: String(f.id),
      name: String(f.name || ''),
      parentId: String(f.parentId || ''),
      sort: asInt(f.sort),
      count: direct.get(String(f.id)) || 0,
      total: 0,
      createdAt: timeOf(f.createdAt),
      updatedAt: timeOf(f.updatedAt),
    }));
    // 向上累加：先全部置为直属数，再把每个目录的数加到它的所有祖先上
    const byId = new Map(list.map((f) => [f.id, f]));
    for (const f of list) f.total = f.count;
    for (const f of list) {
      let pid = f.parentId;
      let guard = 0;
      while (pid && byId.has(pid) && guard < MAX_FOLDER_DEPTH + 1) {
        byId.get(pid)!.total += f.count;
        pid = byId.get(pid)!.parentId;
        guard += 1;
      }
    }
    return { folders: list, unfiled };
  }

  /** 校验 parentId 合法：必须存在、属于本人、且不会形成环 */
  private async assertParent(viewer: string, instanceId: string, parentId: string, selfId = '') {
    const pid = String(parentId || '');
    if (!pid) return '';
    if (selfId && pid === selfId) return '__self__';
    const row = await prisma.memoFolder.findFirst({
      where: { id: pid, author: viewer, instanceId },
      select: { id: true, parentId: true },
    });
    if (!row) return '__missing__';
    if (!selfId) return pid;
    /*
     * 移动目录时不能挂到自己的子孙下面 —— 那样整个子树会从树上脱落（谁都不是它的后代），
     * 表现为「拖完这一支就消失了」。这里从目标节点往上走，撞到自己就拒绝。
     */
    let cur = String(row.parentId || '');
    let guard = 0;
    while (cur && guard < MAX_FOLDER_DEPTH + 1) {
      if (cur === selfId) {
        appLog.warn('memo', `拒绝目录移动：${selfId} 试图挂到自己的子孙 ${pid} 下（会形成环）`);
        return '__cycle__';
      }
      const next = await prisma.memoFolder.findFirst({
        where: { id: cur, author: viewer, instanceId },
        select: { parentId: true },
      });
      cur = String(next?.parentId || '');
      guard += 1;
    }
    return pid;
  }

  async createFolder(viewer: string, instanceId: string, input: { name: unknown; parentId: unknown }) {
    const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME);
    if (!name) return { error: '目录名不能为空' };
    const parentId = await this.assertParent(viewer, instanceId, String(input.parentId ?? ''));
    if (parentId === '__missing__') return { error: '上级目录不存在' };
    if (parentId === '__self__' || parentId === '__cycle__') return { error: '上级目录不合法' };
    // 同级排序取当前最大值 +1：新目录总在最后，不会插到用户排好的顺序中间
    const last = await prisma.memoFolder.findFirst({
      where: { author: viewer, instanceId, parentId },
      orderBy: { sort: 'desc' },
      select: { sort: true },
    });
    const row = await prisma.memoFolder.create({
      data: { name, parentId, author: viewer, instanceId, sort: asInt(last?.sort) + 1 },
    });
    return { folder: { ...row, count: 0, total: 0 } };
  }

  async updateFolder(
    viewer: string,
    instanceId: string,
    id: string,
    input: { name?: unknown; parentId?: unknown; sort?: unknown },
  ) {
    const row = await prisma.memoFolder.findFirst({ where: { id, author: viewer, instanceId } });
    if (!row) return { error: '目录不存在' };
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME);
      if (!name) return { error: '目录名不能为空' };
      data.name = name;
    }
    if (input.parentId !== undefined) {
      const parentId = await this.assertParent(viewer, instanceId, String(input.parentId ?? ''), id);
      if (parentId === '__missing__') return { error: '上级目录不存在' };
      if (parentId === '__self__' || parentId === '__cycle__') return { error: '不能把目录移动到它自己或它的子目录下' };
      data.parentId = parentId;
    }
    if (input.sort !== undefined) data.sort = asInt(input.sort);
    const next = await prisma.memoFolder.update({ where: { id }, data });
    return { folder: next };
  }

  /**
   * 删除目录。
   *
   * **不级联删笔记**：目录只是分类，删目录把用户的笔记一起删掉是不可接受的。
   * 处理方式与文件系统「删文件夹保留内容」相反 —— 这里把子目录与笔记一起上浮到
   * 上一级（没有上一级就是根），于是「删目录」只丢失一层分类信息。
   */
  async deleteFolder(viewer: string, instanceId: string, id: string) {
    const row = await prisma.memoFolder.findFirst({ where: { id, author: viewer, instanceId } });
    if (!row) return { error: '目录不存在' };
    const parentId = String(row.parentId || '');
    // 先把下属内容上浮，再删目录本身 —— 顺序不能反：反了以后子项就找不到父目录了
    const movedNotes = await prisma.note.updateMany({
      where: { author: viewer, instanceId, kind: 'memo', folderId: id },
      data: { folderId: parentId },
    });
    const movedFolders = await prisma.memoFolder.updateMany({
      where: { author: viewer, instanceId, parentId: id },
      data: { parentId },
    });
    await prisma.memoFolder.delete({ where: { id } });
    appLog.info('memo', `删除笔记目录 ${id}（上浮笔记 ${movedNotes.count} 篇 / 子目录 ${movedFolders.count} 个）`);
    return { movedNotes: movedNotes.count, movedFolders: movedFolders.count };
  }

  /** 同级重排：ids 的先后即最终顺序（前端拖拽后一次性提交） */
  async reorderFolders(viewer: string, instanceId: string, parentId: string, ids: unknown) {
    const list = Array.isArray(ids) ? ids.map((x) => String(x)).filter(Boolean) : [];
    if (!list.length) return { updated: 0 };
    // 只更新属于本人、且父目录匹配的那些，避免越权改别人的目录顺序
    const rows = await prisma.memoFolder.findMany({
      where: { id: { in: list }, author: viewer, instanceId, parentId: String(parentId || '') },
      select: { id: true },
    });
    const ok = new Set(rows.map((r: any) => String(r.id)));
    const ops = list.filter((id) => ok.has(id)).map((id, i) => prisma.memoFolder.update({ where: { id }, data: { sort: i } }));
    if (ops.length) await prisma.$transaction(ops);
    return { updated: ops.length };
  }

  // ============================================================
  //  笔记
  // ============================================================

  /** 列表投影：**不含 content**（这是 v1.3 的第一件事） */
  private readonly LIST_SELECT = {
    id: true,
    title: true,
    folderId: true,
    version: true,
    status: true,
    metas: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  async listNotes(input: {
    viewer: string;
    instanceId: string;
    folderId?: string;
    /** '__root' = 只看未归档；'' / 不传 = 全部 */
    search?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { viewer, instanceId } = input;
    const page = Math.max(1, asInt(input.page, 1));
    const pageSize = Math.min(200, Math.max(1, asInt(input.pageSize, 50)));
    const where: Record<string, unknown> = { author: viewer, instanceId, kind: 'memo' };
    const folderId = String(input.folderId ?? '');
    if (folderId === '__root') where.folderId = '';
    else if (folderId) where.folderId = folderId;
    const status = String(input.status ?? '');
    where.status = status === 'deleted' ? 'deleted' : { not: 'deleted' };
    const search = String(input.search ?? '').trim();
    if (search) {
      /*
       * 搜索命中「标题」或「摘要」。
       * 摘要存在 metas.excerpt 里 —— 只是列表展示用的冗余值，命中率不如全文，
       * 但换来的是列表页永远不会因为搜索把几万字正文全拉出来。
       * 全文搜索留给后续版本（FTS 索引），本版不做。
       */
      where.OR = [{ title: { contains: search, mode: 'insensitive' } }, { metas: { contains: search } }];
    }
    const [total, rows] = await Promise.all([
      prisma.note.count({ where: where as any }),
      prisma.note.findMany({
        where: where as any,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: this.LIST_SELECT as any,
      }),
    ]);
    /*
     * v1.3.4.2（需求：列表显示字数）
     * 旧笔记的 metas 里只有 charCount，没有 wordCount。列表接口为了性能不返回正文，
     * 所以这里只对本页「缺 wordCount」的少量旧笔记补查一次 content 现算，
     * 不写库、不改旧数据 —— 等用户下次保存，metas 里自然就有 wordCount 了。
     */
    const needWord = (rows as any[])
      .filter((r) => safeParse(r.metas, {}).wordCount == null)
      .map((r) => String(r.id));
    let wordMap: Map<string, number> | null = null;
    if (needWord.length) {
      const full = await prisma.note.findMany({
        where: { id: { in: needWord } },
        select: { id: true, content: true },
      });
      wordMap = new Map(full.map((f) => [String(f.id), countMemoWords(f.content)]));
    }
    const list: MemoListItem[] = (rows as any[]).map((r) => {
      const metas = safeParse(r.metas, {});
      const id = String(r.id);
      return {
        id,
        title: String(r.title || ''),
        excerpt: String(metas.excerpt || ''),
        folderId: String(r.folderId || ''),
        charCount: asInt(metas.charCount),
        wordCount:
          metas.wordCount != null
            ? asInt(metas.wordCount)
            : wordMap && wordMap.has(id)
              ? wordMap.get(id)!
              : null,
        version: asInt(r.version, 1),
        status: String(r.status || ''),
        createdAt: timeOf(r.createdAt),
        updatedAt: timeOf(r.updatedAt),
      };
    });
    return { total, page, pageSize, list };
  }

  /** 详情：只有这里才带 content */
  async getNote(viewer: string, instanceId: string, id: string) {
    const row = await prisma.note.findFirst({
      where: { id, author: viewer, instanceId, kind: 'memo' },
    });
    if (!row) return null;
    return {
      id: row.id,
      title: String(row.title || ''),
      content: String(row.content || ''),
      contentFormat: String(row.contentFormat || ''),
      folderId: String(row.folderId || ''),
      version: asInt(row.version, 1),
      status: String(row.status || ''),
      createdAt: timeOf(row.createdAt),
      updatedAt: timeOf(row.updatedAt),
    };
  }

  /**
   * 块 ID 是否随正文一起写入。
   *
   * 读的是笔记设置里的 `editor.blockIds`（默认 false）——
   * 见 `memo.util.ts` 顶部说明：ID 由内容哈希推导，写入是幂等的，
   * 但会出现在「源码模式」的每一行末尾，所以在 v1.5 真正解析引用之前默认关闭，
   * 免得用户以为正文被污染了。开启后保存即生效，不需要迁移。
   */
  private async blockIdsEnabled(instanceId: string, viewer = ''): Promise<boolean> {
    try {
      /*
       * v1.3.1.1：编辑器设置改为按用户存 —— 先看用户级（扁平 { blockIds }），
       * 再回落到实例级（老库结构 { editor: { blockIds } }）。
       * 用户级没写过 blockIds 字段时也继续回落，避免「用户只改了主题」把块 ID 关掉。
       */
      const userKey = `note-editor:${instanceId || '~default'}:${viewer || '~anon'}`;
      const instKey = `note-settings:${instanceId || '~default'}`;
      const rows = await prisma.setting.findMany({ where: { key: { in: [userKey, instKey] } } });
      const userAll = safeParse(rows.find((r) => r.key === userKey)?.value, {});
      if (typeof (userAll as Record<string, unknown>)?.blockIds === 'boolean') {
        return (userAll as Record<string, unknown>).blockIds === true;
      }
      const instAll = safeParse(rows.find((r) => r.key === instKey)?.value, {});
      const editor = (instAll.editor && typeof instAll.editor === 'object' ? instAll.editor : {}) as Record<string, unknown>;
      return editor.blockIds === true;
    } catch (e) {
      return false;
    }
  }

  async createNote(
    viewer: string,
    instanceId: string,
    input: { title?: unknown; content?: unknown; folderId?: unknown },
  ) {
    const md = String(input.content ?? '');
    const useIds = await this.blockIdsEnabled(instanceId, viewer);
    const content = useIds ? withBlockIds(md) : md;
    const title =
      String(input.title ?? '').trim().slice(0, MAX_TITLE) || titleFromContent(content, MAX_TITLE);
    const folderId = String(input.folderId ?? '');
    if (folderId) {
      const ok = await prisma.memoFolder.findFirst({ where: { id: folderId, author: viewer, instanceId }, select: { id: true } });
      if (!ok) return { error: '目录不存在' };
    }
    const row = await prisma.note.create({
      data: {
        kind: 'memo',
        title,
        content,
        // 新内容一律 markdown；空正文也算 markdown（格式由编辑器决定，与内容长短无关）
        contentFormat: 'markdown',
        folderId,
        author: viewer,
        instanceId,
        visibility: 'private',
        status: 'published',
        // 与瞬间同一口径：publishedAt 是「发布时刻」，笔记创建即发布（草稿态由 status 表达）
        publishedAt: new Date(),
        firstPublishedAt: new Date(),
        metas: JSON.stringify({ excerpt: excerptOf(content), charCount: countMemoChars(content), wordCount: countMemoWords(content) }),
      },
    });
    // 新建即建索引：否则「刚建好就引用它的块」会查不到，得等第一次保存
    await this.rebuildNoteIndex(row.id, content, viewer, instanceId);
    return { id: row.id, version: asInt(row.version, 1), createdAt: timeOf(row.createdAt) };
  }

  /**
   * 保存（乐观锁）。
   *
   * `version` 不匹配 → 不写库，把当前 version 一起返回，前端据提示「已被其他标签页修改」。
   * 静默覆盖是编辑器最不能犯的错 —— 用户在两个标签页里各写一段，后保存的那份会吃掉前面那份。
   */
  async saveNote(
    viewer: string,
    instanceId: string,
    id: string,
    input: { title?: unknown; content?: unknown; folderId?: unknown; version?: unknown },
  ) {
    const row = await prisma.note.findFirst({
      where: { id, author: viewer, instanceId, kind: 'memo' },
      select: { id: true, version: true, content: true, folderId: true, title: true },
    });
    if (!row) return { error: '笔记不存在' };
    const expect = asInt(input.version, 0);
    if (expect && expect !== asInt(row.version, 1)) {
      // 冲突要留痕：排查「内容莫名变回去」时，先看有没有被另一端盖过
      appLog.warn('memo', `保存冲突：笔记 ${id} 期望版本 ${expect}，库内 ${row.version}`);
      return { conflict: true, version: asInt(row.version, 1), message: '这篇笔记已在别处被修改，请刷新后重试' };
    }
    const md = String(input.content ?? row.content ?? '');
    const useIds = await this.blockIdsEnabled(instanceId, viewer);
    const content = useIds ? withBlockIds(md) : md;
    const title =
      input.title !== undefined
        ? String(input.title ?? '').trim().slice(0, MAX_TITLE)
        : String(row.title || '');
    const data: Record<string, unknown> = {
      content,
      contentFormat: 'markdown',
      title: title || titleFromContent(content, MAX_TITLE),
      version: { increment: 1 },
      metas: JSON.stringify({ excerpt: excerptOf(content), charCount: countMemoChars(content) }),
    };
    if (input.folderId !== undefined) {
      const folderId = String(input.folderId ?? '');
      if (folderId) {
        const ok = await prisma.memoFolder.findFirst({
          where: { id: folderId, author: viewer, instanceId },
          select: { id: true },
        });
        if (!ok) return { error: '目录不存在' };
      }
      data.folderId = folderId;
    }
    const next = await prisma.note.update({ where: { id }, data: data as any, select: { version: true, updatedAt: true } });
    /*
     * 块索引跟着 md 走。内部已 try/catch，索引挂了也不影响这次保存 ——
     * 索引是派生物，随时能从 md 重建；内容才是真源。
     */
    await this.rebuildNoteIndex(id, content, viewer, instanceId);
    return { version: asInt(next.version, 1), updatedAt: timeOf(next.updatedAt) };
  }

  /** 移动到目录（拖拽笔记到左侧目录） */
  async moveNote(viewer: string, instanceId: string, id: string, folderId: unknown) {
    const row = await prisma.note.findFirst({ where: { id, author: viewer, instanceId, kind: 'memo' }, select: { id: true } });
    if (!row) return { error: '笔记不存在' };
    const target = String(folderId ?? '');
    if (target) {
      const ok = await prisma.memoFolder.findFirst({ where: { id: target, author: viewer, instanceId }, select: { id: true } });
      if (!ok) return { error: '目录不存在' };
    }
    await prisma.note.update({ where: { id }, data: { folderId: target } });
    return { ok: true, folderId: target };
  }

  /** 进回收站（软删，可恢复；不动图床文件） */
  async trash(viewer: string, instanceId: string, id: string) {
    const row = await prisma.note.findFirst({ where: { id, author: viewer, instanceId, kind: 'memo' }, select: { id: true } });
    if (!row) return { error: '笔记不存在' };
    await prisma.note.update({ where: { id }, data: { status: 'deleted', deletedAt: new Date() } });
    return { ok: true };
  }

  async restore(viewer: string, instanceId: string, id: string) {
    const row = await prisma.note.findFirst({ where: { id, author: viewer, instanceId, kind: 'memo' }, select: { id: true } });
    if (!row) return { error: '笔记不存在' };
    await prisma.note.update({ where: { id }, data: { status: 'published', deletedAt: null } });
    return { ok: true };
  }

  /** 彻底删除：只删笔记行，图床文件保持不动（可能是别的笔记也在引用的图） */
  async purge(viewer: string, instanceId: string, id: string) {
    const row = await prisma.note.findFirst({ where: { id, author: viewer, instanceId, kind: 'memo' }, select: { id: true } });
    if (!row) return { error: '笔记不存在' };
    await prisma.note.delete({ where: { id } });
    // 物理删除，不可恢复 —— 必须留一条可追溯的记录
    appLog.info('memo', `彻底删除笔记 ${id}`);
    // 派生物一起清掉：块索引、引用关系留着就是脏数据
    await prisma.noteBlock.deleteMany({ where: { noteId: id } }).catch(() => undefined);
    await prisma.noteLink.deleteMany({ where: { OR: [{ sourceNoteId: id }, { targetNoteId: id }] } }).catch(() => undefined);
    // v1.3.1.1：历史快照也要跟着删，否则彻底删除后还留着一堆孤儿正文
    await prisma.noteHistory.deleteMany({ where: { noteId: id } }).catch(() => undefined);
    return { ok: true };
  }

  // ============================================================
  //  块索引与引用（v1.3.1 落地 · 对应 v1.5.0 计划）
  // ============================================================

  /**
   * 重建一篇笔记的块索引与引用关系。
   *
   * 为什么放在保存流程里：块索引是**派生物**，md 变了索引就必须跟着变；
   * 放到定时任务里会让「刚写完立刻引用」失效。
   *
   * 认领策略（§3 v1.5.0 验收第 5 条）：
   *   带 `^blk_` 标记的块 ID 固定不动；没标记的按 contentHash 去旧索引里找，
   *   找到就沿用旧 ID（同哈希按出现顺序配对）。这样删掉一段再粘回来，
   *   原来指向它的引用依然有效。
   *
   * 整个过程失败**不影响保存** —— 索引坏了可以从 md 全量重建，笔记内容才是真源。
   */
  async rebuildNoteIndex(noteId: string, md: string, viewer: string, instanceId: string) {
    try {
      const parsed = parseBlocks(md);
      const old = await prisma.noteBlock.findMany({
        where: { noteId },
        select: { blockId: true, contentHash: true },
      });
      const pool = new Map<string, string[]>();
      for (const b of old) {
        const arr = pool.get(b.contentHash) || [];
        arr.push(b.blockId);
        pool.set(b.contentHash, arr);
      }

      const used = new Set<string>();
      const idMap = new Map<string, string>();
      for (const b of parsed) {
        if (b.explicit) {
          used.add(b.blockId);
          idMap.set(b.blockId, b.blockId);
          continue;
        }
        const cands = pool.get(b.contentHash) || [];
        const pick = cands.find((id) => !used.has(id));
        const finalId = pick || b.blockId;
        used.add(finalId);
        idMap.set(b.blockId, finalId);
        b.blockId = finalId;
      }
      // 父块 id 跟随认领结果重映射（否则子项会指向一个已经不存在的块）
      for (const b of parsed) {
        if (b.parentBlockId) b.parentBlockId = idMap.get(b.parentBlockId) || b.parentBlockId;
      }

      const links = parseLinks(md).filter((l) => l.targetNoteId || l.targetBlockId);

      await prisma.noteBlock.deleteMany({ where: { noteId } });
      if (parsed.length) {
        await prisma.noteBlock.createMany({
          data: parsed.map((b) => ({
            noteId,
            blockId: b.blockId,
            blockType: b.blockType,
            parentBlockId: b.parentBlockId,
            blockOrder: b.blockOrder,
            depth: b.depth,
            plainText: b.plainText.slice(0, 2000),
            contentHash: b.contentHash,
            headingLevel: b.headingLevel,
            author: viewer,
            instanceId,
          })),
        });
      }

      await prisma.noteLink.deleteMany({ where: { sourceNoteId: noteId } });
      if (links.length) {
        await prisma.noteLink.createMany({
          data: links.map((l) => ({
            sourceNoteId: noteId,
            targetNoteId: l.targetNoteId,
            targetBlockId: l.targetBlockId,
            linkType: l.linkType,
            excerpt: l.excerpt,
            author: viewer,
            instanceId,
          })),
        });
      }
      return { blocks: parsed.length, links: links.length };
    } catch (e) {
      appLog.warn('memo', `块索引重建失败（笔记 ${noteId}）：${(e as Error)?.message || e}`);
      return { blocks: 0, links: 0, error: true };
    }
  }

  /** 某篇笔记的块列表（按阅读顺序） */
  async listBlocks(noteId: string, viewer: string, instanceId: string) {
    const note = await prisma.note.findFirst({
      where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
      select: { id: true },
    });
    if (!note) return { error: '笔记不存在' };
    const blocks = await prisma.noteBlock.findMany({
      where: { noteId },
      orderBy: { blockOrder: 'asc' },
    });
    return {
      blocks: blocks.map((b) => ({
        blockId: b.blockId,
        blockType: b.blockType,
        parentBlockId: b.parentBlockId,
        blockOrder: b.blockOrder,
        depth: b.depth,
        plainText: b.plainText,
        headingLevel: b.headingLevel,
      })),
    };
  }

  /**
   * 按块 ID 定位（跨笔记）。引用块渲染时用它取内容。
   * 权限收窄到「本人的、当前实例的笔记」—— 不能靠一个 blockId 读到别人的笔记。
   */
  async resolveBlock(blockId: string, viewer: string, instanceId: string) {
    const block = await prisma.noteBlock.findFirst({
      where: { blockId, author: viewer, instanceId },
    });
    if (!block) return { error: '源块已删除或无权访问' };
    const note = await prisma.note.findFirst({
      where: { id: block.noteId, author: viewer, instanceId },
      select: { id: true, title: true, status: true },
    });
    if (!note || note.status === 'deleted') return { error: '源块已删除或无权访问' };
    return {
      blockId: block.blockId,
      noteId: note.id,
      noteTitle: note.title,
      blockType: block.blockType,
      plainText: block.plainText,
    };
  }

  /** 反向链接：哪些笔记引用了本篇（整篇或本篇的某个块） */
  async backlinks(noteId: string, viewer: string, instanceId: string) {
    const note = await prisma.note.findFirst({
      where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
      select: { id: true },
    });
    if (!note) return { error: '笔记不存在' };
    const ownBlocks = await prisma.noteBlock.findMany({ where: { noteId }, select: { blockId: true } });
    const ids = ownBlocks.map((b) => b.blockId);
    const links = await prisma.noteLink.findMany({
      where: {
        author: viewer,
        instanceId,
        // 自己引自己不算反链：本篇内部的块引用不该出现在「被引用」面板里
        sourceNoteId: { not: noteId },
        OR: [{ targetNoteId: noteId }, ...(ids.length ? [{ targetBlockId: { in: ids } }] : [])],
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const sourceIds = Array.from(new Set(links.map((l) => l.sourceNoteId)));
    const sources = sourceIds.length
      ? await prisma.note.findMany({
          where: { id: { in: sourceIds }, author: viewer, instanceId, status: { not: 'deleted' } },
          select: { id: true, title: true },
        })
      : [];
    const titleOf = new Map(sources.map((s) => [s.id, s.title]));
    return {
      backlinks: links
        .filter((l) => titleOf.has(l.sourceNoteId))
        .map((l) => ({
          noteId: l.sourceNoteId,
          noteTitle: titleOf.get(l.sourceNoteId) || '',
          blockId: l.targetBlockId,
          linkType: l.linkType,
          excerpt: l.excerpt,
        })),
    };
  }

  /** 全量重建（删表重跑 / 迁移后用）：返回处理了多少篇 */
  // ============================================================
  //  笔记标签（v1.3.1.1 · 需求：标题下方加一行标签，交互与瞬间一致）
  // ============================================================

  /*
   * 存的是 note_tags 关联表（与瞬间共用同一张表、同一套标签池 type='note'）。
   * 共用而不是另建一套的理由：标签本身就是「跨内容类型的分类词」，
   * 用户在瞬间里建的 #灵感，在笔记里也应该能直接选到。
   * 隔离口径仍是 author + instanceId —— 别人的标签不会出现在候选里。
   */

  async listNoteTags(viewer: string, instanceId: string, noteId: string) {
    const note = await prisma.note.findFirst({
      where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
      select: { id: true },
    });
    if (!note) return { error: '笔记不存在' };
    const links = await prisma.noteTag.findMany({
      where: { noteId },
      select: { tag: { select: { id: true, name: true } } },
    });
    return { tags: links.map((l) => ({ id: l.tag.id, name: l.tag.name })) };
  }

  /** 覆盖式设置本篇标签（前端整行提交，不在后端做增删 diff） */
  async setNoteTags(viewer: string, instanceId: string, noteId: string, names: unknown) {
    const note = await prisma.note.findFirst({
      where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
      select: { id: true },
    });
    if (!note) return { error: '笔记不存在' };
    const list = normalizeTagNames(names);
    const tagIds: string[] = [];
    for (const name of list) {
      const t = await findOrCreateTag(name, instanceId, viewer, 'note');
      if (t?.id) tagIds.push(String(t.id));
    }
    await prisma.noteTag.deleteMany({ where: { noteId } });
    if (tagIds.length) {
      await prisma.noteTag.createMany({
        data: tagIds.map((tagId) => ({ noteId, tagId })),
        skipDuplicates: true,
      });
    }
    return this.listNoteTags(viewer, instanceId, noteId);
  }

  /** 标签候选（按当前账户 + 实例隔离，只列 type=note 的标签） */
  async noteTagCandidates(viewer: string, instanceId: string, keyword = '') {
    const kw = String(keyword || '').trim();
    const rows = await prisma.tag.findMany({
      where: {
        instanceId,
        type: 'note',
        ...(kw ? { name: { contains: kw, mode: 'insensitive' as const } } : {}),
        /*
         * v1.3.2（需求：已经存过的标签读不到）
         *
         * 旧条件是 `noteTags: { some: { note: { author: viewer } } }` ——
         * 只列「当前还挂在某篇笔记上」的标签。一旦某篇笔记把标签删掉，
         * 这条 Tag 还在表里，却再也不会出现在候选里，看起来就像"没存进去"。
         * 现在按归属判断：新数据 scope=当前用户，老数据 owner=当前用户（scope 为空）。
         */
        OR: [{ scope: String(viewer || '') }, { owner: String(viewer || '') }],
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 50,
    });
    return { tags: rows };
  }

  // ============================================================
  //  历史快照（v1.3.1.1 · 需求：每篇内容保存 100 条历史记录）
  // ============================================================

  /**
   * 追加一条历史快照。
   *
   * 由前端按「笔记设置 → 历史保存间隔」定时调用，服务端只做三件事：
   *   1) 与最近一条内容相同就跳过（避免定时器空转写一堆重复行）；
   *   2) 空正文不记（新建笔记还没写东西时不该占历史额度）；
   *   3) 超过 100 条删最旧的 —— **每篇独立计算**，不是全局池。
   */
  async pushHistory(
    viewer: string,
    instanceId: string,
    noteId: string,
    input: { title?: unknown; content?: unknown; version?: unknown } = {},
  ) {
    const note = await prisma.note.findFirst({
      where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
      select: { id: true, title: true, content: true, version: true },
    });
    if (!note) return { error: '笔记不存在' };
    const content = String(input.content ?? note.content ?? '');
    if (!content.trim()) return { ok: true, skipped: true };
    const last = await prisma.noteHistory.findFirst({
      where: { noteId },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    if (last && last.content === content) return { ok: true, skipped: true };
    const row = await prisma.noteHistory.create({
      data: {
        noteId,
        title: String(input.title ?? note.title ?? '').slice(0, MAX_TITLE),
        content,
        charCount: countMemoChars(content),
        version: asInt(input.version, asInt(note.version, 1)),
        author: viewer,
        instanceId,
      },
    });
    const overflow = await prisma.noteHistory.findMany({
      where: { noteId },
      orderBy: { createdAt: 'desc' },
      skip: MAX_HISTORY,
      select: { id: true },
    });
    if (overflow.length) {
      await prisma.noteHistory.deleteMany({ where: { id: { in: overflow.map((o) => o.id) } } });
    }
    return { id: row.id, createdAt: timeOf(row.createdAt) };
  }

  /** 历史列表（不含正文，列表页只要时间 / 字数 / 版本） */
  async listHistory(viewer: string, instanceId: string, noteId: string) {
    const note = await prisma.note.findFirst({
      where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
      select: { id: true },
    });
    if (!note) return { error: '笔记不存在' };
    const rows = await prisma.noteHistory.findMany({
      where: { noteId },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY,
      select: { id: true, title: true, charCount: true, version: true, createdAt: true },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        charCount: r.charCount,
        version: r.version,
        createdAt: timeOf(r.createdAt),
      })),
      max: MAX_HISTORY,
    };
  }

  /** 单条快照详情（含正文，点开某一条时用） */
  async getHistory(viewer: string, instanceId: string, noteId: string, hid: string) {
    const note = await prisma.note.findFirst({
      where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
      select: { id: true },
    });
    if (!note) return { error: '笔记不存在' };
    const row = await prisma.noteHistory.findFirst({ where: { id: hid, noteId } });
    if (!row) return { error: '历史记录不存在（可能已被更早的记录挤出保留范围）' };
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      charCount: row.charCount,
      version: row.version,
      createdAt: timeOf(row.createdAt),
    };
  }

  /**
   * 用某一版历史覆盖当前内容。
   *
   * 「恢复」本身也要能撤回 —— 所以先把**当前**内容压一条历史，再覆盖。
   * 覆盖后 version+1、块索引重建，前端拿到新 version 继续编辑不会撞乐观锁。
   */
  async restoreHistory(viewer: string, instanceId: string, noteId: string, hid: string) {
    const note = await prisma.note.findFirst({
      where: { id: noteId, author: viewer, instanceId, kind: 'memo' },
      select: { id: true, title: true, content: true, version: true },
    });
    if (!note) return { error: '笔记不存在' };
    const row = await prisma.noteHistory.findFirst({ where: { id: hid, noteId } });
    if (!row) return { error: '历史记录不存在' };
    // 先把当前内容存成一条历史（恢复也可以再恢复回来）
    await this.pushHistory(viewer, instanceId, noteId, { content: note.content, title: note.title });
    const useIds = await this.blockIdsEnabled(instanceId, viewer);
    const content = useIds ? withBlockIds(row.content) : row.content;
    const next = await prisma.note.update({
      where: { id: noteId },
      data: {
        content,
        title: row.title || String(note.title || ''),
        version: { increment: 1 },
        metas: JSON.stringify({ excerpt: excerptOf(content), charCount: countMemoChars(content), wordCount: countMemoWords(content) }),
      },
      select: { version: true, updatedAt: true },
    });
    await this.rebuildNoteIndex(noteId, content, viewer, instanceId);
    appLog.info('memo', `笔记 ${noteId} 恢复到历史 ${hid}`);
    return {
      version: asInt(next.version, 1),
      content,
      title: row.title || '',
      updatedAt: timeOf(next.updatedAt),
    };
  }

  async rebuildAllIndex(viewer: string, instanceId: string) {
    const notes = await prisma.note.findMany({
      where: { author: viewer, instanceId, kind: 'memo', status: { not: 'deleted' } },
      select: { id: true, content: true },
    });
    let blocks = 0;
    for (const n of notes) {
      const r = await this.rebuildNoteIndex(n.id, String(n.content || ''), viewer, instanceId);
      blocks += r.blocks || 0;
    }
    return { notes: notes.length, blocks };
  }
}
