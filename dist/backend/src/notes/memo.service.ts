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

/**
 * v1.3.9：文档节点树的一个节点。
 *
 * 与旧目录最大的区别：节点**本身就是一篇笔记**（有正文、有标题、有版本），
 * 同时可以挂子节点。所以这里不再区分「目录」与「笔记」，只保留一个 `isSystem`
 * 标记 4 个不可删改移动的一级固定节点。
 */
export interface MemoTreeNode {
  id: string;
  title: string;
  parentId: string;
  sort: number;
  /** 系统固定一级节点（笔记 / 日记 / 札记 / 灵感 / 模板） */
  isSystem: boolean;
  /** v1.3.9.1：文档类型（note | diary | journal | inspiration | template） */
  docType: string;
  status: string;
  charCount: number;
  wordCount: number | null;
  /** 直属子笔记数 */
  directCount: number;
  /** 含所有子孙的笔记数 */
  totalCount: number;
  createdAt: number;
  updatedAt: number;
}

/** 5 个固定一级节点的定义（顺序即 sort） */
const SYSTEM_ROOT_TITLES = ['笔记', '日记', '札记', '灵感', '模板'] as const;
type MemoNodeType = 'note' | 'diary' | 'journal' | 'inspiration' | 'template';

/** 固定一级节点的标题 → docType */
const ROOT_DOC_TYPE: Record<string, MemoNodeType> = {
  笔记: 'note',
  日记: 'diary',
  札记: 'journal',
  灵感: 'inspiration',
  模板: 'template',
};

/** 节点设置（行高 / 关系线 / 图标）的默认值 */
/**
 * v1.3.9.2：初始默认值按需求参考图落定 —— 行高 30、显示关系线、
 * 目录节点 book-bookmark，各类型页 file-lines / heart / feather-pointed / lightbulb，
 * 模板留空走默认图标。前端 utils/memoNodeSettings.js 保持逐字段一致。
 */
const DEFAULT_NODE_SETTINGS = {
  rowHeight: 30,
  showLines: true,
  folderIcon: 'book-bookmark',
  typeIcons: { note: 'file-lines', diary: 'heart', journal: 'feather-pointed', inspiration: 'lightbulb', template: '' } as Record<string, string>,
};

/** 旧版 4 个固定节点的标题（迁移时补「模板」用） */
const LEGACY_SYSTEM_TITLES = ['笔记', '日记', '札记', '灵感'];

/** 迁移标记按「用户 + 实例」分开记：不同用户的数据互不影响，谁先访问谁先迁 */
function migratedKey(instanceId: string, viewer: string): string {
  return `memoTreeMigrated:${instanceId || '_'}:${viewer}`;
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
  //  v1.3.9：文档节点树
  //
  //  旧模型是「目录（memo_folders）+ 笔记（notes.folderId）」两套东西；
  //  新模型里每个节点本身就是一篇笔记（notes.parentId 自引用），
  //  既可以写正文，也可以无限嵌套子笔记 —— 与 Typora / Notion 的目录树一致。
  //
  //  旧目录不删除：首次访问时按「父先子后」转成空正文的目录页节点，
  //  并把原目录下的笔记 parentId 指过去。迁移标记按「用户 + 实例」分开，
  //  多用户/多实例各自迁移，互不影响。
  // ============================================================

  /**
   * v1.3.9.1：同一「用户 + 实例」的根节点初始化做进程内串行。
   *
   * 前端首屏会并行发 /api/memo/tree、/api/memo/node-settings、/api/memo/templates 三个请求，
   * 它们各自都会 ensureTreeMigrated → ensureSystemRoots；两个请求同时查到「模板」
   * 不存在、又同时 create，就会在树里出现两个「模板」根（本次实测到的现象）。
   * 表上没有（也不该有）「同标题唯一」约束 —— 用户完全可以建多篇同名笔记，
   * 所以这里用 Promise 复用把并发收口，跨进程的残留再用 mergeDuplicateRoots 兜底。
   */
  private rootsInflight = new Map<string, Promise<Map<string, string>>>();

  /** 5 个固定一级节点：缺哪个补哪个（按作者 + 实例各一份） */
  private async ensureSystemRoots(viewer: string, instanceId: string): Promise<Map<string, string>> {
    const lockKey = `${viewer}@${instanceId || '_'}`;
    const flying = this.rootsInflight.get(lockKey);
    if (flying) return flying;
    const task = this.ensureSystemRootsInner(viewer, instanceId).finally(() => {
      this.rootsInflight.delete(lockKey);
    });
    this.rootsInflight.set(lockKey, task);
    return task;
  }

  private async ensureSystemRootsInner(viewer: string, instanceId: string): Promise<Map<string, string>> {
    const rows = await prisma.note.findMany({
      where: {
        author: viewer,
        instanceId,
        kind: 'memo',
        isSystem: true,
        parentId: '',
        status: { not: 'deleted' },
      },
      select: { id: true, title: true, docType: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }],
    });
    const byTitle = new Map<string, string>();
    /*
     * v1.3.9.1（修「树里出现两个模板根」）：
     * 历史并发 / 旧迁移都可能留下同名系统根。这里按 createdAt 取最早的一个当正主，
     * 其余的把子节点挂过来后软删除 —— 幂等，多次访问不会反复处理。
     */
    const dup: Array<{ keep: string; drop: string; title: string }> = [];
    for (const r of rows as any[]) {
      const title = String(r.title || '');
      const id = String(r.id);
      if (byTitle.has(title)) {
        dup.push({ keep: byTitle.get(title)!, drop: id, title });
        continue;
      }
      byTitle.set(title, id);
      // v1.3.9.1：旧库的系统节点没有 docType，这里补一次（幂等）
      const want = ROOT_DOC_TYPE[title];
      if (want && String(r.docType || '') !== want) {
        await prisma.note.update({ where: { id }, data: { docType: want } });
      }
    }
    for (const d of dup) {
      await prisma.note.updateMany({ where: { parentId: d.drop }, data: { parentId: d.keep } });
      await prisma.note.update({
        where: { id: d.drop },
        data: { status: 'deleted', isSystem: false },
      });
      // 并进来的子节点按「正主」的类型重算一遍，避免留在迁移时的默认 note
      const keepType = ROOT_DOC_TYPE[d.title];
      if (keepType) await this.retypeSubtree(viewer, instanceId, d.keep, keepType);
      appLog.info('memo', `合并重复固定节点「${d.title}」（${viewer}@${instanceId || 'default'}）`);
    }
    for (let i = 0; i < SYSTEM_ROOT_TITLES.length; i += 1) {
      const title = SYSTEM_ROOT_TITLES[i];
      if (byTitle.has(title)) continue;
      /*
       * v1.3.9.1：旧版本把「模板」当成普通目录迁移过（标题一模一样但不是系统节点）。
       * 这种情况直接把这个节点认领成正主，而不是再建一个 —— 否则树里会并排两个「模板」。
       */
      const legacy = await prisma.note.findFirst({
        where: {
          author: viewer,
          instanceId,
          kind: 'memo',
          title,
          parentId: '',
          isSystem: false,
          status: { not: 'deleted' },
        },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      if (legacy) {
        await prisma.note.update({
          where: { id: String(legacy.id) },
          data: { isSystem: true, docType: ROOT_DOC_TYPE[title] || 'note', sort: i },
        });
        byTitle.set(title, String(legacy.id));
        appLog.info('memo', `认领旧节点「${title}」为固定节点（${viewer}@${instanceId || 'default'}）`);
        // 认领后整棵子树按该类型重算（旧目录迁移时一律写的 note）
        const adoptType = ROOT_DOC_TYPE[title];
        if (adoptType) await this.retypeSubtree(viewer, instanceId, String(legacy.id), adoptType);
        continue;
      }
      const row = await prisma.note.create({
        data: {
          kind: 'memo',
          title,
          content: '',
          contentFormat: 'markdown',
          parentId: '',
          sort: i,
          isSystem: true,
          docType: ROOT_DOC_TYPE[title] || 'note',
          author: viewer,
          instanceId,
          visibility: 'private',
          status: 'published',
          publishedAt: new Date(),
          firstPublishedAt: new Date(),
          metas: JSON.stringify({ excerpt: '', charCount: 0, wordCount: 0 }),
        },
        select: { id: true },
      });
      byTitle.set(title, String(row.id));
      appLog.info('memo', `创建固定节点「${title}」（${viewer}@${instanceId || 'default'}）`);
    }
    return byTitle;
  }

  /**
   * 旧目录 → 文档节点（幂等）。
   *
   * 只处理当前 `viewer + instanceId` 的数据：迁移标记也是这个粒度，
   * 否则 A 用户先访问触发了全局标记，B 用户的目录就永远不会被转过来。
   */
  private async ensureTreeMigrated(viewer: string, instanceId: string): Promise<Map<string, string>> {
    const key = migratedKey(instanceId, viewer);
    const flag = await prisma.setting.findUnique({ where: { key } });
    if (String(flag?.value || '') !== '1') {
      const folders = await prisma.memoFolder.findMany({
        where: { author: viewer, instanceId },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      });
      if (folders.length) {
        const map = new Map<string, string>();
        const remaining = folders.slice();
        let guard = 0;
        // 父节点必须先落库：旧目录允许任意顺序，这里按「父已建」反复扫一遍
        while (remaining.length && guard < MAX_FOLDER_DEPTH * 4) {
          guard += 1;
          for (let i = remaining.length - 1; i >= 0; i -= 1) {
            const f = remaining[i] as any;
            const pid = String(f.parentId || '');
            if (pid && !map.has(pid)) continue;
            const parentNote = pid ? map.get(pid)! : '';
            const row = await prisma.note.create({
              data: {
                kind: 'memo',
                title: String(f.name || '未命名目录').slice(0, MAX_TITLE),
                content: '',
                contentFormat: 'markdown',
                parentId: parentNote,
                sort: asInt(f.sort),
                isSystem: false,
                docType: 'note',
                author: viewer,
                instanceId,
                visibility: 'private',
                status: 'published',
                publishedAt: new Date(),
                firstPublishedAt: new Date(),
                // 留一个来源标记：排查「这个空节点哪来的」时能直接对上旧目录
                metas: JSON.stringify({
                  excerpt: '',
                  charCount: 0,
                  wordCount: 0,
                  migratedFromFolder: String(f.id),
                }),
              },
              select: { id: true },
            });
            map.set(String(f.id), String(row.id));
            remaining.splice(i, 1);
          }
        }
        const notes = await prisma.note.findMany({
          where: { author: viewer, instanceId, kind: 'memo', parentId: '', folderId: { not: '' } },
          select: { id: true, folderId: true },
        });
        for (const n of notes as any[]) {
          const pid = map.get(String(n.folderId || ''));
          if (pid) await prisma.note.update({ where: { id: String(n.id) }, data: { parentId: pid } });
        }
        appLog.info(
          'memo',
          `旧目录迁移完成：${folders.length} 个目录 → 文档节点（${viewer}@${instanceId || 'default'}）`,
        );
      }
      await prisma.setting.upsert({ where: { key }, create: { key, value: '1' }, update: { value: '1' } });
    }
    const roots = await this.ensureSystemRoots(viewer, instanceId);
    // v1.3.9.1：旧数据没有 docType，按所属固定一级节点回填（幂等，每次访问最多一次全表扫描本用户）
    await this.backfillDocTypes(viewer, instanceId);
    return roots;
  }

  /**
   * v1.3.9.1：按「所属固定一级节点」回填 docType。
   *
   * 从节点向上找第一个 `isSystem` 的祖先，它的标题决定 docType；
   * 根级散文档没有系统祖先，按 note 处理。只处理 docType 为空的行，
   * 已有类型的节点（例如用户移动过的）不会被覆盖。
   */
  private async backfillDocTypes(viewer: string, instanceId: string) {
    const pending = await prisma.note.findMany({
      where: { author: viewer, instanceId, kind: 'memo', docType: '' },
      select: { id: true, parentId: true, title: true, isSystem: true },
    });
    if (!pending.length) return;
    const all = await prisma.note.findMany({
      where: { author: viewer, instanceId, kind: 'memo' },
      select: { id: true, parentId: true, title: true, isSystem: true },
    });
    const byId = new Map((all as any[]).map((r) => [String(r.id), r]));
    const typeOf = (pid: string): string => {
      let cur = String(pid || '');
      let guard = 0;
      while (cur && guard < MAX_FOLDER_DEPTH) {
        const n: any = byId.get(cur);
        if (!n) break;
        if (n.isSystem) return ROOT_DOC_TYPE[String(n.title || '')] || 'note';
        cur = String(n.parentId || '');
        guard += 1;
      }
      return 'note';
    };
    for (const r of pending as any[]) {
      const title = String(r.title || '');
      const t = r.isSystem ? ROOT_DOC_TYPE[title] || 'note' : typeOf(String(r.parentId || ''));
      await prisma.note.update({ where: { id: String(r.id) }, data: { docType: t } });
    }
  }

  /**
   * 树（一次拉全）：笔记数量按人头是「几百篇」级别，扁平数组 + 前端组树最省事，
   * 逐层懒加载会让「展开到第 5 层」变成 5 次请求，拖拽跨层移动还要额外刷新。
   */
  async listTree(viewer: string, instanceId: string) {
    await this.ensureTreeMigrated(viewer, instanceId);
    const rows = await prisma.note.findMany({
      where: { author: viewer, instanceId, kind: 'memo', status: { not: 'deleted' } },
      select: {
        id: true,
        title: true,
        parentId: true,
        sort: true,
        isSystem: true,
        docType: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        metas: true,
      },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    const nodes: MemoTreeNode[] = (rows as any[]).map((r) => {
      const metas = safeParse(r.metas, {});
      return {
        id: String(r.id),
        title: String(r.title || ''),
        parentId: String(r.parentId || ''),
        sort: asInt(r.sort),
        isSystem: !!r.isSystem,
        docType: String(r.docType || '') || (r.isSystem ? ROOT_DOC_TYPE[String(r.title || '')] || 'note' : 'note'),
        status: String(r.status || ''),
        charCount: asInt(metas.charCount),
        wordCount: metas.wordCount != null ? asInt(metas.wordCount) : null,
        directCount: 0,
        totalCount: 0,
        createdAt: timeOf(r.createdAt),
        updatedAt: timeOf(r.updatedAt),
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) {
      if (n.parentId && byId.has(n.parentId)) byId.get(n.parentId)!.directCount += 1;
    }
    // 子孙总数：每个节点给它的所有祖先 +1
    for (const n of nodes) {
      let pid = n.parentId;
      let guard = 0;
      while (pid && byId.has(pid) && guard < MAX_FOLDER_DEPTH) {
        byId.get(pid)!.totalCount += 1;
        pid = byId.get(pid)!.parentId;
        guard += 1;
      }
    }
    return {
      nodes,
      roots: SYSTEM_ROOT_TITLES.map((t) => {
        const hit = nodes.find((n) => n.isSystem && n.title === t);
        return { title: t, id: hit ? hit.id : '' };
      }),
    };
  }

  /** 在指定父节点下找同名子节点，没有就建一个空正文的目录页 */
  private async ensureChildNode(
    viewer: string,
    instanceId: string,
    parentId: string,
    title: string,
    sortHint = 0,
  ): Promise<string> {
    const hit = await prisma.note.findFirst({
      where: {
        author: viewer,
        instanceId,
        kind: 'memo',
        parentId,
        title,
        status: { not: 'deleted' },
      },
      select: { id: true },
    });
    if (hit) return String(hit.id);
    const last = await prisma.note.findFirst({
      where: { author: viewer, instanceId, kind: 'memo', parentId, status: { not: 'deleted' } },
      orderBy: { sort: 'desc' },
      select: { sort: true },
    });
    const row = await prisma.note.create({
      data: {
        kind: 'memo',
        title,
        content: '',
        contentFormat: 'markdown',
        parentId,
        sort: Math.max(asInt(last?.sort) + 1, sortHint),
        author: viewer,
        instanceId,
        visibility: 'private',
        status: 'published',
        publishedAt: new Date(),
        firstPublishedAt: new Date(),
        metas: JSON.stringify({ excerpt: '', charCount: 0, wordCount: 0, autoFolder: true }),
      },
      select: { id: true },
    });
    return String(row.id);
  }

  /**
   * 默认标题的下一个序号：`未命名笔记1`、`未命名笔记2`……
   *
   * 只看「同一父节点下」的兄弟，不数全库 —— 用户把 A 目录里的未命名笔记删了，
   * B 目录里的编号不该跟着变。
   */
  private async nextUntitledIndex(viewer: string, instanceId: string, parentId: string, prefix: string): Promise<number> {
    const rows = await prisma.note.findMany({
      where: { author: viewer, instanceId, kind: 'memo', parentId, title: { startsWith: prefix } },
      select: { title: true },
    });
    let max = 0;
    for (const r of rows as any[]) {
      const m = new RegExp(`^${prefix}(\\d+)$`).exec(String(r.title || ''));
      if (m) max = Math.max(max, asInt(m[1]));
    }
    return max + 1;
  }

  private static pad2(n: number): string {
    return String(n).padStart(2, '0');
  }

  /**
   * 按类型创建节点。
   *
   * - `parentId` 显式给了（在某个节点上「新建子笔记」）→ 直接挂到它下面，
   *   不再套 `/日记/YYYY/MM` 那套默认路径 —— 用户已经指明了位置，再套一层就是反直觉。
   * - 没给 → 按类型落到默认的一级固定目录下。
   */
  async createNode(
    viewer: string,
    instanceId: string,
    input: { type?: unknown; parentId?: unknown; title?: unknown; content?: unknown },
  ) {
    const rawType = String(input.type ?? 'note');
    let type: MemoNodeType =
      rawType === 'diary' || rawType === 'journal' || rawType === 'inspiration' || rawType === 'template'
        ? rawType
        : 'note';
    const roots = await this.ensureTreeMigrated(viewer, instanceId);
    const now = new Date();
    const YYYY = String(now.getFullYear());
    const MM = MemoService.pad2(now.getMonth() + 1);
    const DD = MemoService.pad2(now.getDate());
    const hh = MemoService.pad2(now.getHours());
    const mi = MemoService.pad2(now.getMinutes());

    const explicitParent = String(input.parentId ?? '');
    let parentId = '';
    let title = String(input.title ?? '').trim();

    if (explicitParent) {
      const ok = await prisma.note.findFirst({
        where: {
          id: explicitParent,
          author: viewer,
          instanceId,
          kind: 'memo',
          status: { not: 'deleted' },
        },
        select: { id: true, docType: true },
      });
      if (!ok) return { error: '上级节点不存在' };
      parentId = explicitParent;
      /*
       * v1.3.9.1（需求：在某节点下新建子文档 → 直接创建同类型文档，无需再弹类型选择页）。
       * 父节点的 docType 由 ensureTreeMigrated/backfillDocTypes 保证已回填，
       * 这里以它为准覆盖前端传来的 type（前端直建子页时会带上父类型，双保险）。
       */
      const parentType = String((ok as any).docType || '');
      if (parentType === 'diary' || parentType === 'journal' || parentType === 'inspiration' || parentType === 'template' || parentType === 'note') {
        type = parentType;
      }
    }

    if (!parentId) {
      const rootNote = roots.get(SYSTEM_ROOT_TITLES[0]) || roots.get('笔记') || '';
      if (type === 'diary') {
        const root = roots.get('日记') || '';
        const year = await this.ensureChildNode(viewer, instanceId, root, YYYY, 1);
        parentId = await this.ensureChildNode(viewer, instanceId, year, MM, 2);
      } else if (type === 'journal') {
        const root = roots.get('札记') || '';
        parentId = await this.ensureChildNode(viewer, instanceId, root, YYYY, 1);
      } else if (type === 'inspiration') {
        const root = roots.get('灵感') || '';
        parentId = await this.ensureChildNode(viewer, instanceId, root, YYYY, 1);
      } else if (type === 'template') {
        parentId = roots.get('模板') || '';
      } else {
        parentId = rootNote;
      }
    }

    if (!title) {
      if (type === 'diary') {
        /* v1.3.9.1（需求）：日记默认名称改成「2026年11月22日 周日」 */
        const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
        title = `${YYYY}年${Number(MM)}月${Number(DD)}日 ${week}`;
      } else if (type === 'inspiration') {
        // v1.3.9.1（需求）：灵感默认名称改成「灵感_YYYYMMDD-HHMM」
        title = `灵感_${YYYY}${MM}${DD}-${hh}${mi}`;
      } else if (type === 'template') {
        const prefix = '未命名模板';
        title = `${prefix}${await this.nextUntitledIndex(viewer, instanceId, parentId, prefix)}`;
      } else {
        const prefix = type === 'journal' ? '未命名札记' : '未命名笔记';
        title = `${prefix}${await this.nextUntitledIndex(viewer, instanceId, parentId, prefix)}`;
      }
    }
    title = title.slice(0, MAX_TITLE);

    /*
     * v1.3.9.1（需求：同名日记直接打开已有日记）
     * 只对「由默认规则生成名称」的日记生效 —— 用户显式传了 title 时按用户的来。
     * 判断范围是同一个月节点下，未删除且标题完全一致。
     */
    if (type === 'diary' && !String(input.title ?? '').trim()) {
      const existed = await prisma.note.findFirst({
        where: {
          author: viewer,
          instanceId,
          kind: 'memo',
          parentId,
          title,
          status: { not: 'deleted' },
        },
        select: { id: true, version: true, createdAt: true },
      });
      if (existed) {
        return {
          id: String(existed.id),
          title,
          parentId,
          type,
          existed: true,
          version: asInt(existed.version, 1),
          createdAt: timeOf(existed.createdAt),
        };
      }
    }

    const md = String(input.content ?? '');
    const useIds = await this.blockIdsEnabled(instanceId, viewer);
    const content = useIds ? withBlockIds(md) : md;
    const last = await prisma.note.findFirst({
      where: { author: viewer, instanceId, kind: 'memo', parentId, status: { not: 'deleted' } },
      orderBy: { sort: 'desc' },
      select: { sort: true },
    });
    const row = await prisma.note.create({
      data: {
        kind: 'memo',
        title,
        content,
        contentFormat: 'markdown',
        parentId,
        sort: asInt(last?.sort) + 1,
        isSystem: false,
        docType: type,
        author: viewer,
        instanceId,
        visibility: 'private',
        status: 'published',
        publishedAt: new Date(),
        firstPublishedAt: new Date(),
        metas: JSON.stringify({
          excerpt: excerptOf(content),
          charCount: countMemoChars(content),
          wordCount: countMemoWords(content),
        }),
      },
    });
    await this.rebuildNoteIndex(row.id, content, viewer, instanceId);
    return {
      id: row.id,
      title,
      parentId,
      type,
      version: asInt(row.version, 1),
      createdAt: timeOf(row.createdAt),
    };
  }

  /**
   * v1.3.9.1：按「所在父链上的固定一级节点」解析某位置应有的 docType。
   * 从 parentId 往上找第一个 isSystem 的系统根，用它的标题映射到类型；
   * 链上没有系统根（根级散文档）时，退回父节点自身的类型，再兜底 note。
   * 移动 / 升级后用它重算类型记录，保证「文档放在哪个分类下就是哪个类型」。
   */
  private async docTypeForParent(viewer: string, instanceId: string, parentId: string): Promise<MemoNodeType> {
    let cur = String(parentId || '');
    let firstType = '';
    let guard = 0;
    while (cur && guard < MAX_FOLDER_DEPTH) {
      const n: any = await prisma.note.findFirst({
        where: { id: cur, author: viewer, instanceId, kind: 'memo' },
        select: { parentId: true, isSystem: true, title: true, docType: true },
      });
      if (!n) break;
      if (!firstType) firstType = String(n.docType || '');
      if (n.isSystem) {
        const t = ROOT_DOC_TYPE[String(n.title || '')];
        if (t) return t;
      }
      cur = String(n.parentId || '');
      guard += 1;
    }
    return firstType === 'diary' || firstType === 'journal' || firstType === 'inspiration' || firstType === 'template'
      ? firstType
      : 'note';
  }

  /** 把整棵子树（含自身）的 docType 统一改写 —— 移动 / 升级后保持子节点类型一致 */
  private async retypeSubtree(viewer: string, instanceId: string, rootId: string, type: MemoNodeType): Promise<number> {
    const ids = await this.subtreeIds(viewer, instanceId, rootId);
    if (!ids.length) return 0;
    const r = await prisma.note.updateMany({
      where: { id: { in: ids }, author: viewer, instanceId, kind: 'memo' },
      data: { docType: type },
    });
    return r.count;
  }

  /**
   * v1.3.9.1（需求：更多菜单「升级」）—— 文档层级上升一级。
   * 把节点从「父节点下」移到「父节点的父节点下」（父是系统根时升到根级散文档），
   * 并重算该子树的 docType，因为移动后所属分类变了。
   */
  async promoteNode(viewer: string, instanceId: string, id: string) {
    const row = await prisma.note.findFirst({
      where: { id, author: viewer, instanceId, kind: 'memo' },
      select: { id: true, isSystem: true, parentId: true },
    });
    if (!row) return { error: '笔记不存在' };
    if ((row as any).isSystem) return { error: '固定一级目录不能升级' };
    const oldParent = String(row.parentId || '');
    if (!oldParent) return { error: '已经是最高层级' };
    const parent: any = await prisma.note.findFirst({
      where: { id: oldParent, author: viewer, instanceId, kind: 'memo' },
      select: { id: true, parentId: true },
    });
    const newParent = parent ? String(parent.parentId || '') : '';
    const last = await prisma.note.findFirst({
      where: { author: viewer, instanceId, kind: 'memo', parentId: newParent, status: { not: 'deleted' } },
      orderBy: { sort: 'desc' },
      select: { sort: true },
    });
    await prisma.note.update({
      where: { id },
      data: { parentId: newParent, sort: asInt(last?.sort) + 1 } as any,
    });
    const docType = await this.docTypeForParent(viewer, instanceId, newParent);
    await this.retypeSubtree(viewer, instanceId, id, docType);
    appLog.info('memo', `节点升级：${id} 从 ${oldParent} 升到 ${newParent || '根级'}，类型重算为 ${docType}`);
    return { ok: true, parentId: newParent, docType };
  }

  /** 节点设置的 setting key（按用户 + 实例隔离，与迁移标记同一口径） */
  private nodeSettingsKey(instanceId: string, viewer: string): string {
    return `memoNodeSettings:${instanceId || '_'}:${viewer}`;
  }

  /** v1.3.9.1：读取文档树节点设置（行高 / 关系线 / 图标），缺项一律补默认值 */
  async getNodeSettings(viewer: string, instanceId: string) {
    const key = this.nodeSettingsKey(instanceId, viewer);
    const row = await prisma.setting.findUnique({ where: { key } });
    const saved = safeParse(row?.value, {});
    const def = DEFAULT_NODE_SETTINGS;
    const typeIcons: Record<string, string> = { ...def.typeIcons };
    if (saved.typeIcons && typeof saved.typeIcons === 'object') {
      for (const k of Object.keys(typeIcons)) {
        const v = (saved.typeIcons as Record<string, unknown>)[k];
        if (typeof v === 'string') typeIcons[k] = v.slice(0, 60);
      }
    }
    return {
      rowHeight: Math.min(64, Math.max(22, asInt(saved.rowHeight, def.rowHeight))),
      showLines: typeof saved.showLines === 'boolean' ? saved.showLines : def.showLines,
      folderIcon: typeof saved.folderIcon === 'string' ? saved.folderIcon.slice(0, 60) : def.folderIcon,
      typeIcons,
    };
  }

  /** v1.3.9.1：保存文档树节点设置（合并写入，避免漏项把别的设置冲掉） */
  async saveNodeSettings(viewer: string, instanceId: string, input: unknown) {
    const cur = await this.getNodeSettings(viewer, instanceId);
    const src = (input || {}) as Record<string, unknown>;
    const next = {
      rowHeight: Math.min(64, Math.max(22, asInt(src.rowHeight, cur.rowHeight))),
      showLines: typeof src.showLines === 'boolean' ? src.showLines : cur.showLines,
      folderIcon: typeof src.folderIcon === 'string' ? String(src.folderIcon).slice(0, 60) : cur.folderIcon,
      typeIcons: { ...cur.typeIcons },
    };
    const ti = src.typeIcons;
    if (ti && typeof ti === 'object') {
      for (const k of Object.keys(next.typeIcons)) {
        const v = (ti as Record<string, unknown>)[k];
        if (typeof v === 'string') next.typeIcons[k] = v.slice(0, 60);
      }
    }
    const key = this.nodeSettingsKey(instanceId, viewer);
    const value = JSON.stringify(next);
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return next;
  }

  /** v1.3.9.1：导入模板弹窗的数据源 —— 列出「模板」分类下的可用模板文档（含正文） */
  async listTemplates(viewer: string, instanceId: string) {
    await this.ensureTreeMigrated(viewer, instanceId);
    const rows = await prisma.note.findMany({
      where: {
        author: viewer,
        instanceId,
        kind: 'memo',
        docType: 'template',
        isSystem: false,
        status: { not: 'deleted' },
      },
      select: { id: true, title: true, content: true, parentId: true, updatedAt: true, createdAt: true },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      templates: (rows as any[]).map((r) => ({
        id: String(r.id),
        title: String(r.title || ''),
        content: String(r.content || ''),
        updatedAt: timeOf(r.updatedAt),
        createdAt: timeOf(r.createdAt),
      })),
    };
  }

  /** 移动 / 同级排序（拖拽）；系统固定节点不可移动；v1.3.9.1 移动后重算类型 */
  async moveNode(
    viewer: string,
    instanceId: string,
    id: string,
    input: { parentId?: unknown; sort?: unknown },
  ) {
    const row = await prisma.note.findFirst({
      where: { id, author: viewer, instanceId, kind: 'memo' },
      select: { id: true, isSystem: true, parentId: true },
    });
    if (!row) return { error: '笔记不存在' };
    if (row.isSystem) return { error: '固定一级目录不能移动' };
    const target = String(input.parentId ?? '');
    if (target) {
      if (target === id) return { error: '不能移动到自身下面' };
      const ok = await prisma.note.findFirst({
        where: { id: target, author: viewer, instanceId, kind: 'memo', status: { not: 'deleted' } },
        select: { id: true },
      });
      if (!ok) return { error: '目标节点不存在' };
      let cur = target;
      let guard = 0;
      while (cur && guard < MAX_FOLDER_DEPTH) {
        if (cur === id) return { error: '不能移动到自己的子节点下' };
        const p = await prisma.note.findFirst({
          where: { id: cur, author: viewer, instanceId, kind: 'memo' },
          select: { parentId: true },
        });
        cur = String(p?.parentId || '');
        guard += 1;
      }
    }
    const data: Record<string, unknown> = { parentId: target };
    if (input.sort !== undefined) data.sort = asInt(input.sort);
    else {
      const last = await prisma.note.findFirst({
        where: { author: viewer, instanceId, kind: 'memo', parentId: target, status: { not: 'deleted' } },
        orderBy: { sort: 'desc' },
        select: { sort: true },
      });
      data.sort = asInt(last?.sort) + 1;
    }
    await prisma.note.update({ where: { id }, data: data as any });
    // v1.3.9.1（需求：移动时会变更移动后所在的类型记录）—— 连子树一起重算
    const docType = await this.docTypeForParent(viewer, instanceId, target);
    await this.retypeSubtree(viewer, instanceId, id, docType);
    return { ok: true, parentId: target, docType };
  }

  /** 同级重排（拖拽落位后一次提交；系统固定节点不参与） */
  async reorderNodes(viewer: string, instanceId: string, parentId: string, ids: unknown) {
    const list = Array.isArray(ids) ? ids.map((x) => String(x)) : [];
    if (!list.length) return { ok: true, count: 0 };
    const rows = await prisma.note.findMany({
      where: { id: { in: list }, author: viewer, instanceId, kind: 'memo' },
      select: { id: true, isSystem: true },
    });
    const allowed = new Set((rows as any[]).filter((r) => !r.isSystem).map((r) => String(r.id)));
    let i = 0;
    for (const id of list) {
      if (!allowed.has(id)) continue;
      await prisma.note.update({ where: { id }, data: { parentId, sort: i } });
      i += 1;
    }
    return { ok: true, count: i };
  }

  /** 改名（系统固定节点拒绝；正文与名称是两件事，改名不动 version） */
  async renameNode(viewer: string, instanceId: string, id: string, title: unknown) {
    const row = await prisma.note.findFirst({
      where: { id, author: viewer, instanceId, kind: 'memo' },
      select: { id: true, isSystem: true },
    });
    if (!row) return { error: '笔记不存在' };
    if (row.isSystem) return { error: '固定一级目录不能修改名称' };
    const name = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    if (!name) return { error: '名称不能为空' };
    await prisma.note.update({ where: { id }, data: { title: name } });
    return { ok: true, title: name };
  }

  /** 子树 id（含自身），不限状态 —— 恢复时要连已删除的子孙一起捞出来 */
  private async subtreeIds(viewer: string, instanceId: string, id: string): Promise<string[]> {
    const out: string[] = [];
    let layer = [String(id)];
    const seen = new Set<string>();
    let guard = 0;
    while (layer.length && guard < MAX_FOLDER_DEPTH * 4) {
      guard += 1;
      for (const cur of layer) if (!seen.has(cur)) seen.add(cur);
      const rows = await prisma.note.findMany({
        where: { author: viewer, instanceId, kind: 'memo', parentId: { in: layer } },
        select: { id: true },
      });
      const next: string[] = [];
      for (const r of rows as any[]) {
        const nid = String(r.id);
        if (!seen.has(nid)) {
          seen.add(nid);
          next.push(nid);
        }
      }
      out.push(...layer.filter((x) => !out.includes(x)));
      layer = next;
    }
    return out;
  }

  /**
   * 删除节点 = 整棵子树进回收站。
   *
   * 单独删一篇会让它的子节点变成「父不存在」的孤儿（树里直接消失），
   * 所以这里必须递归。系统固定节点拒绝。
   */
  async trashTree(viewer: string, instanceId: string, id: string) {
    const row = await prisma.note.findFirst({
      where: { id, author: viewer, instanceId, kind: 'memo' },
      select: { id: true, isSystem: true, status: true },
    });
    if (!row) return { error: '笔记不存在' };
    if (row.isSystem) return { error: '固定一级目录不能删除' };
    const ids = await this.subtreeIds(viewer, instanceId, id);
    const r = await prisma.note.updateMany({
      where: { id: { in: ids }, status: { not: 'deleted' } },
      data: { status: 'deleted', deletedAt: new Date() },
    });
    appLog.info('memo', `节点进回收站：${id}（含子孙共 ${r.count} 篇）`);
    return { ok: true, count: r.count };
  }

  /** 恢复：自身 + 子孙 + 已删除的祖先链（否则恢复完在树里看不见） */
  async restoreTree(viewer: string, instanceId: string, id: string) {
    const row = await prisma.note.findFirst({
      where: { id, author: viewer, instanceId, kind: 'memo' },
      select: { id: true, parentId: true, status: true },
    });
    if (!row) return { error: '笔记不存在' };
    const ids = await this.subtreeIds(viewer, instanceId, id);
    const ancestors: string[] = [];
    let cur = String(row.parentId || '');
    let guard = 0;
    while (cur && guard < MAX_FOLDER_DEPTH) {
      const p: any = await prisma.note.findFirst({
        where: { id: cur, author: viewer, instanceId, kind: 'memo' },
        select: { id: true, parentId: true, status: true },
      });
      if (!p) break;
      if (String(p.status || '') === 'deleted') ancestors.push(String(p.id));
      cur = String(p.parentId || '');
      guard += 1;
    }
    await prisma.note.updateMany({
      where: { id: { in: [...ids, ...ancestors] } },
      data: { status: 'published', deletedAt: null },
    });
    return { ok: true, count: ids.length + ancestors.length };
  }

  // ============================================================
  //  目录（v1.3.0，v1.3.9 起仅保留接口兼容；前端已不再使用）
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

  /**
   * v1.3.9.3：收集某节点及其全部子孙的 id（用于「查看节点」一次列出整棵子树的文档）。
   * 返回值包含根节点本身 —— 放进 `folderId IN (...)` 时它只代表「根的直接子级」，
   * 不会把根节点自己查出来（根节点的 parentId 指向的是它的上级）。
   */
  private async collectSubtreeIds(viewer: string, instanceId: string, rootId: string) {
    const rows = await prisma.note.findMany({
      where: { author: viewer, instanceId, kind: 'memo', status: { not: 'deleted' } },
      select: { id: true, parentId: true },
    });
    const childrenOf = new Map<string, string[]>();
    for (const r of rows as any[]) {
      const p = String(r.parentId || '');
      if (!childrenOf.has(p)) childrenOf.set(p, []);
      childrenOf.get(p)!.push(String(r.id));
    }
    const out: string[] = [];
    const seen = new Set<string>();
    const queue = [rootId];
    while (queue.length) {
      const id = queue.shift()!;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      for (const c of childrenOf.get(id) || []) queue.push(c);
    }
    return out;
  }

  async listNotes(input: {
    viewer: string;
    instanceId: string;
    folderId?: string;
    /**
     * v1.3.9.3：文档树节点 id。
     * v1.3.9 起树的层级用 parentId 表达（folderId 是旧「目录」模型遗留字段，
     * 新节点一律为空），所以「列某节点下的文档」必须按 parentId 收窄。
     */
    parentId?: string;
    /** '__root' = 只看未归档；'' / 不传 = 全部 */
    /** v1.3.9.3：true = 连该节点下的所有子孙文档一起列出（节点「查看节点」用） */
    deep?: boolean;
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
    /*
     * v1.3.5（需求：删除笔记没有进入回收站 / 回收站看不到）
     * '__trash' 是前端目录树里的虚拟节点，不是真实目录 id。
     * 以前这里直接把它当 folderId 过滤，等于要求「folderId === '__trash'」，
     * 而删除后的笔记仍保留原 folderId，所以回收站永远查不到任何笔记。
     * 回收站必须忽略目录维度，看全部 status='deleted' 的笔记。
     */
    if (folderId === '__trash') {
      // 不收窄 folderId
    } else if (folderId === '__root') where.folderId = '';
    else if (folderId) where.folderId = folderId;
    /*
     * v1.3.9.3（需求：节点「查看节点」列出自身节点的所有子级文档）
     * v1.3.9 起树层级是 parentId 链（folderId 只是旧目录模型的遗留字段，新节点为空），
     * 所以这里按 parentId 收窄：普通列表 = 直接子级，deep = 整棵子树。
     */
    const parentId = String(input.parentId ?? '');
    if (parentId) {
      where.parentId = input.deep ? { in: await this.collectSubtreeIds(viewer, instanceId, parentId) } : parentId;
    }
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
    /*
     * v1.3.7：旧笔记的摘要里混着源码字符（图片 width、<br>、((blk_…))、文件名）。
     * 摘要只在保存时算一次，老数据不会自己变干净，所以列表对「看起来脏」的
     * 少量笔记补查一次正文现算 —— 与下面的 wordCount 共用同一次查询，不写库。
     */
    const dirtyExcerpt = (v: unknown) => /[{<]|\[\[|\]\]|\(\(blk_|\.(?:png|jpe?g|gif|webp|bmp|svg|mp4|webm|mp3|wav)\b/i.test(String(v || ''));
    const needFullIds = (rows as any[])
      .filter((r) => {
        const m = safeParse(r.metas, {});
        return m.wordCount == null || dirtyExcerpt(m.excerpt);
      })
      .map((r) => String(r.id));
    let wordMap: Map<string, number> | null = null;
    let excerptMap: Map<string, string> | null = null;
    if (needFullIds.length) {
      const full = await prisma.note.findMany({
        where: { id: { in: needFullIds } },
        select: { id: true, content: true },
      });
      wordMap = new Map(full.map((f) => [String(f.id), countMemoWords(f.content)]));
      excerptMap = new Map(full.map((f) => [String(f.id), excerptOf(f.content)]));
    }
    const list: MemoListItem[] = (rows as any[]).map((r) => {
      const metas = safeParse(r.metas, {});
      const id = String(r.id);
      return {
        id,
        title: String(r.title || ''),
        excerpt: excerptMap && excerptMap.has(id) ? excerptMap.get(id)! : String(metas.excerpt || ''),
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
      // v1.3.9：文档节点树需要父级 / 排序 / 系统标记
      parentId: String((row as any).parentId || ''),
      sort: asInt((row as any).sort),
      isSystem: !!(row as any).isSystem,
      // v1.3.9.1：类型 + 心情 / 天气（编辑器标题栏与元信息行要显示）
      docType: String((row as any).docType || ''),
      mood: String((row as any).mood || ''),
      moodName: String((row as any).moodName || ''),
      weather: String((row as any).weather || ''),
      weatherName: String((row as any).weatherName || ''),
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
    input: { title?: unknown; content?: unknown; folderId?: unknown; parentId?: unknown },
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
    // v1.3.9：新前端按 parentId 建节点；folderId 只为旧调用方保留
    const parentId = String(input.parentId ?? '');
    if (parentId) {
      const ok = await prisma.note.findFirst({
        where: { id: parentId, author: viewer, instanceId, kind: 'memo', status: { not: 'deleted' } },
        select: { id: true },
      });
      if (!ok) return { error: '上级节点不存在' };
    }
    const last = parentId
      ? await prisma.note.findFirst({
          where: { author: viewer, instanceId, kind: 'memo', parentId, status: { not: 'deleted' } },
          orderBy: { sort: 'desc' },
          select: { sort: true },
        })
      : null;
    const row = await prisma.note.create({
      data: {
        kind: 'memo',
        title,
        content,
        // 新内容一律 markdown；空正文也算 markdown（格式由编辑器决定，与内容长短无关）
        contentFormat: 'markdown',
        folderId,
        parentId,
        sort: asInt(last?.sort) + 1,
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
    input: {
      title?: unknown; content?: unknown; folderId?: unknown; version?: unknown;
      mood?: unknown; moodName?: unknown; weather?: unknown; weatherName?: unknown;
    },
  ) {
    const row = await prisma.note.findFirst({
      where: { id, author: viewer, instanceId, kind: 'memo' },
      select: { id: true, version: true, content: true, folderId: true, title: true, isSystem: true },
    });
    if (!row) return { error: '笔记不存在' };
    /*
     * v1.3.9：4 个固定一级节点可以写正文（它们也是笔记），但名称不能改 ——
     * 「笔记 / 日记 / 札记 / 灵感」是新建规则的落点，改名会让规则失效。
     */
    if ((row as any).isSystem && input.title !== undefined && String(input.title ?? '').trim() !== String(row.title || '').trim()) {
      return { error: '固定一级目录不能修改名称' };
    }
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
    /*
     * v1.3.9.1（需求：编辑器标题栏心情 / 天气，选择后把名称存进数据表）。
     * 只有传了字段才写 —— 编辑器普通自动保存不带这几个字段，不能把已选的心情清掉。
     */
    if (input.mood !== undefined) data.mood = String(input.mood ?? '').slice(0, 40);
    if (input.moodName !== undefined) data.moodName = String(input.moodName ?? '').slice(0, 60);
    if (input.weather !== undefined) data.weather = String(input.weather ?? '').slice(0, 40);
    if (input.weatherName !== undefined) data.weatherName = String(input.weatherName ?? '').slice(0, 60);
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
    const row = await prisma.note.findFirst({ where: { id, author: viewer, instanceId, kind: 'memo' }, select: { id: true, status: true } });
    if (!row) return { error: '笔记不存在' };
    // v1.3.5：重复删除保持幂等，不刷新 deletedAt（排序/清理都依赖它）
    if (String(row.status || '') === 'deleted') return { ok: true };
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
    const row = await prisma.note.findFirst({
      where: { id, author: viewer, instanceId, kind: 'memo' },
      select: { id: true, status: true, parentId: true, isSystem: true },
    });
    if (!row) return { error: '笔记不存在' };
    if ((row as any).isSystem) return { error: '固定一级目录不能删除' };
    /*
     * v1.3.5（需求：删除先进回收站、从回收站再彻底删除）
     * 必须先软删（status='deleted'）才允许 purge，防止调用方绕过回收站把笔记直接抹掉。
     */
    if (String(row.status || '') !== 'deleted') return { error: '只能从回收站彻底删除' };
    /*
     * v1.3.9：彻底删除父节点前把直接子节点上浮到它的父级。
     * 否则子节点的 parentId 指向一条不存在的记录，树里会整支消失（数据还在，但找不到）。
     */
    await prisma.note
      .updateMany({ where: { parentId: id, author: viewer, instanceId, kind: 'memo' }, data: { parentId: String(row.parentId || '') } })
      .catch(() => undefined);
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
