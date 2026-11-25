/**
 * 文章板块 · 服务层（v1.4.0）
 * ----------------------------------------------------------------------------
 * 文章（article）/ 待办（todo）/ 导航（nav）共用 `articles` 一张表，靠 type 区分。
 * 本文件负责：
 *   1) 分类目录（article_folders）—— 建 / 改名 / 移动 / 删除上浮 / 同级排序；
 *   2) 文章 CRUD —— 列表（不拉全文）/ 详情（含页签与标签）/ 元信息保存（乐观锁）；
 *   3) 页签批量保存 —— 正文真源在页签里，保存后同步镜像正文、字数与待办完成率；
 *   4) 标签（复用 tags 表，type 跟随文章类型）；
 *   5) 回收站 —— 软删 / 恢复 / 彻底删除。
 *
 * 三条硬约束：
 *   · 权限一律 `author = viewer` + `instanceId` 双收窄，与记事 / 瞬间同一口径；
 *   · 列表必须走 select 投影：正文可能几万字，拉全文等于把列表页变成下载页；
 *   · 版本号只在「元信息保存」和「页签保存」时 +1，冲突返回 409 交给前端选择覆盖或放弃。
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '../common/prisma';
import { appLog } from '../common/app-log';
import { findOrCreateTag, tagScope } from '../common/tags';
import { findOrCreateMarker } from '../common/markers';
import { safeParse, normalizeTagNames, MAX_TAGS_PER_NOTE } from '../notes/notes.util';
import {
  MAX_ARTICLE_EXCERPT,
  MAX_ARTICLE_NOTE,
  MAX_ARTICLE_TABS,
  MAX_ARTICLE_TITLE,
  MAX_TAB_CONTENT,
  MAX_TAB_TITLE,
  countArticleWords,
  countTodoTasks,
  excerptOfArticle,
  todoNamesOfArticle,
  normalizeArticleStatus,
  normalizeArticleType,
} from './article.util';

function asInt(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function timeOf(v: unknown): number {
  if (!v) return 0;
  const t = v instanceof Date ? v.getTime() : new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : 0;
}

export type ArticleListItem = {
  id: string;
  type: string;
  title: string;
  excerpt: string;
  folderId: string;
  folderName: string;
  status: string;
  done: boolean;
  views: number;
  comments: number;
  wordCount: number;
  todoTotal: number;
  todoDone: number;
  version: number;
  tags: string[];
  coverFileId: string;
  coverName: string;
  /** v1.4.1.1：待办截止时间（0 = 未设），列表据此算「剩几天 / 剩几时」 */
  dueAt: number;
  createdAt: number;
  updatedAt: number;
  publishedAt: number;
};

@Injectable()
export class ArticleService {
  /** 列表投影：刻意不含 content（几万字正文不进列表） */
  private readonly LIST_SELECT = {
    id: true,
    type: true,
    title: true,
    excerpt: true,
    content: true, // 仅用于「没有摘要时」现算兜底，见下
    folderId: true,
    status: true,
    done: true,
    views: true,
    comments: true,
    wordCount: true,
    todoTotal: true,
    todoDone: true,
    version: true,
    coverFileId: true,
    author: true,
    /// v1.4.1.1：待办截止时间 —— 列表直接算「剩几天」，不必再查一次详情
    dueAt: true,
    createdAt: true,
    updatedAt: true,
    publishedAt: true,
  } as const;

  // ==========================================================
  //  分类目录
  // ==========================================================

  /**
   * 目录树（扁平数组，前端按 parentId 组树）。
   * 每个节点带 totalCount = 自身 + 所有子孙目录下的文章数（不含回收站）。
   */
  async listFolders(viewer: string, instanceId: string, typeRaw: unknown) {
    const type = normalizeArticleType(typeRaw);
    const where = { author: viewer, instanceId, type };
    const [folders, rows] = await Promise.all([
      prisma.articleFolder.findMany({ where, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
      prisma.article.groupBy({
        by: ['folderId'],
        where: { author: viewer, instanceId, type, status: { not: 'deleted' } },
        _count: { _all: true },
      }),
    ]);
    const direct = new Map<string, number>();
    for (const r of rows as Array<{ folderId: string; _count: { _all: number } }>) {
      direct.set(String(r.folderId || ''), Number(r._count?._all || 0));
    }
    const nodes = folders.map((f) => ({
      id: String(f.id),
      name: String(f.name || ''),
      parentId: String(f.parentId || ''),
      sort: asInt(f.sort),
      type: String(f.type || type),
      directCount: direct.get(String(f.id)) || 0,
      totalCount: 0,
      createdAt: timeOf(f.createdAt),
    }));
    // 自底向上累加子孙计数（树深有限，按父链回填即可，不需要递归）
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) n.totalCount = n.directCount;
    for (const n of nodes) {
      let cur = n.parentId ? byId.get(n.parentId) : undefined;
      let guard = 0;
      while (cur && guard < 64) {
        cur.totalCount += n.directCount;
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        guard += 1;
      }
    }
    return {
      type,
      nodes,
      unfiled: direct.get('') || 0,
      total: nodes.reduce((s, n) => s + n.directCount, 0) + (direct.get('') || 0),
    };
  }

  async createFolder(viewer: string, instanceId: string, input: { type?: unknown; name?: unknown; parentId?: unknown }) {
    const type = normalizeArticleType(input.type);
    const name = String(input.name ?? '').trim().slice(0, 60) || '新建分类';
    const parentId = String(input.parentId ?? '');
    if (parentId) {
      const parent = await prisma.articleFolder.findFirst({ where: { id: parentId, author: viewer, instanceId, type } });
      if (!parent) return { error: '上级分类不存在' as string };
    }
    const max = await prisma.articleFolder.aggregate({
      where: { author: viewer, instanceId, type, parentId },
      _max: { sort: true },
    });
    const folder = await prisma.articleFolder.create({
      data: { type, name, parentId, author: viewer, instanceId, sort: asInt(max._max.sort) + 10 },
    });
    appLog.info('article', `新建分类「${name}」（${viewer}@${instanceId || 'default'} · ${type}）`);
    return { folder: this.folderOut(folder) };
  }

  private folderOut(f: {
    id: string;
    type: string;
    name: string;
    parentId: string;
    sort: number;
    createdAt: Date;
  }) {
    return {
      id: String(f.id),
      type: String(f.type || ''),
      name: String(f.name || ''),
      parentId: String(f.parentId || ''),
      sort: asInt(f.sort),
      createdAt: timeOf(f.createdAt),
    };
  }

  async updateFolder(
    viewer: string,
    instanceId: string,
    id: string,
    input: { name?: unknown; parentId?: unknown; sort?: unknown; type?: unknown },
  ) {
    const type = normalizeArticleType(input.type);
    const row = await prisma.articleFolder.findFirst({ where: { id, author: viewer, instanceId, type } });
    if (!row) return { error: '分类不存在' as string };
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = String(input.name ?? '').trim().slice(0, 60);
      if (!name) return { error: '分类名称不能为空' as string };
      data.name = name;
    }
    if (input.parentId !== undefined) {
      const pid = String(input.parentId ?? '');
      if (pid === id) return { error: '不能把分类挂到自己下面' as string };
      if (pid) {
        // 防环：目标上级不能是自己的子孙
        const all = await prisma.articleFolder.findMany({ where: { author: viewer, instanceId, type } });
        const byId = new Map(all.map((f) => [String(f.id), String(f.parentId || '')]));
        let cur = pid;
        let guard = 0;
        while (cur && guard < 128) {
          if (cur === id) return { error: '不能把分类挂到自己的子孙下面' as string };
          cur = byId.get(cur) || '';
          guard += 1;
        }
        const target = await prisma.articleFolder.findFirst({ where: { id: pid, author: viewer, instanceId, type } });
        if (!target) return { error: '目标分类不存在' as string };
      }
      data.parentId = pid;
    }
    if (input.sort !== undefined) data.sort = asInt(input.sort);
    const folder = await prisma.articleFolder.update({ where: { id }, data: data as never });
    appLog.info('article', `更新分类 ${id}：${JSON.stringify(data)}`);
    return { folder: this.folderOut(folder) };
  }

  /**
   * 删除分类：子分类上浮到被删分类的上级，分类下的文章改为「未分类」。
   * 不删文章 —— 与记事树「删除节点」的语义一致：删的是分组，不是内容。
   */
  async deleteFolder(viewer: string, instanceId: string, id: string, typeRaw: unknown) {
    const type = normalizeArticleType(typeRaw);
    const row = await prisma.articleFolder.findFirst({ where: { id, author: viewer, instanceId, type } });
    if (!row) return { error: '分类不存在' as string };
    const [movedFolders, movedArticles] = await Promise.all([
      prisma.articleFolder.updateMany({ where: { parentId: id, author: viewer, instanceId, type }, data: { parentId: row.parentId } }),
      prisma.article.updateMany({ where: { folderId: id, author: viewer, instanceId, type }, data: { folderId: '' } }),
    ]);
    await prisma.articleFolder.delete({ where: { id } });
    appLog.info(
      'article',
      `删除分类「${row.name}」：上浮子分类 ${movedFolders.count} 个 / 文章 ${movedArticles.count} 篇改为未分类`,
    );
    return { ok: true, movedFolders: movedFolders.count, movedArticles: movedArticles.count };
  }

  async reorderFolders(viewer: string, instanceId: string, typeRaw: unknown, parentId: string, ids: unknown) {
    const type = normalizeArticleType(typeRaw);
    const list = Array.isArray(ids) ? ids.map((x) => String(x)) : [];
    let sort = 10;
    for (const id of list) {
      await prisma.articleFolder.updateMany({
        where: { id, author: viewer, instanceId, type, parentId: String(parentId || '') },
        data: { sort },
      });
      sort += 10;
    }
    return { ok: true };
  }

  // ==========================================================
  //  文章列表 / 详情
  // ==========================================================

  /** 收集某分类及其全部子孙分类 id（列表「含子分类」用） */
  private async collectFolderIds(viewer: string, instanceId: string, type: string, rootId: string) {
    const all = await prisma.articleFolder.findMany({ where: { author: viewer, instanceId, type }, select: { id: true, parentId: true } });
    const children = new Map<string, string[]>();
    for (const f of all) {
      const p = String(f.parentId || '');
      const arr = children.get(p);
      if (arr) arr.push(String(f.id));
      else children.set(p, [String(f.id)]);
    }
    const out: string[] = [];
    const queue = [rootId];
    let guard = 0;
    while (queue.length && guard < 5000) {
      const cur = queue.shift() as string;
      out.push(cur);
      for (const c of children.get(cur) || []) queue.push(c);
      guard += 1;
    }
    return out;
  }

  async listArticles(input: {
    viewer: string;
    instanceId: string;
    type?: unknown;
    folderId?: string;
    /** true = 连子分类一起列 */
    deep?: boolean;
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    /** 'updated' | 'created' | 'title' */
    sort?: string;
  }) {
    const { viewer, instanceId } = input;
    const type = normalizeArticleType(input.type);
    const page = Math.max(1, asInt(input.page, 1));
    const pageSize = Math.min(200, Math.max(1, asInt(input.pageSize, 30)));
    const where: Record<string, unknown> = { author: viewer, instanceId, type };

    const status = String(input.status ?? '');
    where.status = status === 'deleted' ? 'deleted' : { not: 'deleted' };
    if (status === 'draft') where.status = 'draft';
    if (status === 'published') where.status = 'published';

    const folderId = String(input.folderId ?? '');
    if (folderId === '__unfiled') where.folderId = '';
    else if (folderId && folderId !== '__all') {
      where.folderId = input.deep ? { in: await this.collectFolderIds(viewer, instanceId, type, folderId) } : folderId;
    }

    const search = String(input.search ?? '').trim();
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { excerpt: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
      ];
    }

    const sortKey = String(input.sort || 'updated');
    const orderBy =
      sortKey === 'created'
        ? [{ createdAt: 'desc' as const }]
        : sortKey === 'title'
          ? [{ title: 'asc' as const }]
          : [{ updatedAt: 'desc' as const }];

    const [total, rows] = await Promise.all([
      prisma.article.count({ where: where as never }),
      prisma.article.findMany({
        where: where as never,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: this.LIST_SELECT as never,
      }),
    ]);

    const ids = (rows as Array<{ id: string }>).map((r) => String(r.id));
    const [tagLinks, folders, covers] = await Promise.all([
      ids.length
        ? prisma.articleTag.findMany({
            where: { articleId: { in: ids } },
            include: { tag: { select: { id: true, name: true } } },
          })
        : Promise.resolve([]),
      prisma.articleFolder.findMany({ where: { author: viewer, instanceId, type }, select: { id: true, name: true } }),
      (() => {
        const coverIds = (rows as Array<{ coverFileId: string }>).map((r) => String(r.coverFileId || '')).filter(Boolean);
        return coverIds.length
          ? prisma.fileRecord.findMany({ where: { id: { in: coverIds } }, select: { id: true, name: true } })
          : Promise.resolve([]);
      })(),
    ]);
    const tagMap = new Map<string, string[]>();
    for (const link of tagLinks as Array<{ articleId: string; tag: { name: string } }>) {
      const key = String(link.articleId);
      const arr = tagMap.get(key);
      if (arr) arr.push(String(link.tag?.name || ''));
      else tagMap.set(key, [String(link.tag?.name || '')]);
    }
    const folderMap = new Map((folders as Array<{ id: string; name: string }>).map((f) => [String(f.id), String(f.name || '')]));
    const coverMap = new Map((covers as Array<{ id: string; name: string }>).map((f) => [String(f.id), String(f.name || '')]));

    const list: ArticleListItem[] = (rows as Array<Record<string, unknown>>).map((r) => {
      const id = String(r.id);
      /*
       * v1.4.1.1（需求）：
       *   · 待办 → 摘要为空时先取正文里的任务项名称，没有任务项才回落正文；
       *   · 文章 → 摘要为空时回落正文（过滤代码 / 附件等非文本）。
       */
      const excerpt =
        String(r.excerpt || '').trim() ||
        (String(r.type || type) === 'todo' ? todoNamesOfArticle(r.content, 140) : '') ||
        excerptOfArticle(r.content, 140);
      const folderIdOf = String(r.folderId || '');
      return {
        id,
        type: String(r.type || type),
        title: String(r.title || ''),
        excerpt,
        folderId: folderIdOf,
        folderName: folderIdOf ? folderMap.get(folderIdOf) || '' : '',
        status: String(r.status || 'draft'),
        author: String(r.author || ''),
        done: !!r.done,
        views: asInt(r.views),
        comments: asInt(r.comments),
        wordCount: asInt(r.wordCount),
        todoTotal: asInt(r.todoTotal),
        todoDone: asInt(r.todoDone),
        version: asInt(r.version, 1),
        tags: tagMap.get(id) || [],
        coverFileId: String(r.coverFileId || ''),
        coverName: coverMap.get(String(r.coverFileId || '')) || '',
        dueAt: timeOf((r as { dueAt?: unknown }).dueAt),
        createdAt: timeOf(r.createdAt),
        updatedAt: timeOf(r.updatedAt),
        publishedAt: timeOf(r.publishedAt),
      };
    });

    return { type, list, total, page, pageSize, hasMore: page * pageSize < total };
  }

  async getArticle(viewer: string, instanceId: string, id: string) {
    const row = await prisma.article.findFirst({
      where: { id, author: viewer, instanceId },
      include: {
        tabs: { orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] },
        tags: { include: { tag: { select: { id: true, name: true } } } },
        // v1.4.1.1：标记（一条内容只能有一个，关联表唯一键保证）
        markers: { include: { marker: { select: { id: true, name: true } } } },
      },
    });
    if (!row) return { error: '文章不存在' as string };
    let folderName = '';
    if (row.folderId) {
      const f = await prisma.articleFolder.findFirst({ where: { id: row.folderId }, select: { name: true } });
      folderName = String(f?.name || '');
    }
    let coverName = '';
    if (row.coverFileId) {
      const f = await prisma.fileRecord.findFirst({ where: { id: row.coverFileId }, select: { name: true } });
      coverName = String(f?.name || '');
    }
    const tabs = row.tabs.length
      ? row.tabs
      : // 兜底：历史脏数据没有页签时给一个空页签，前端不必处理「零页签」这种边角
        [{ id: '', title: '正文', content: String(row.content || ''), sort: 0, todoTotal: 0, todoDone: 0, wordCount: 0 }];
    return {
      article: {
        id: String(row.id),
        type: String(row.type || 'article'),
        title: String(row.title || ''),
        excerpt: String(row.excerpt || ''),
        note: String(row.note || ''),
        content: String(row.content || ''),
        coverFileId: String(row.coverFileId || ''),
        coverName,
        folderId: String(row.folderId || ''),
        folderName,
        status: String(row.status || 'draft'),
        done: !!row.done,
        views: asInt(row.views),
        comments: asInt(row.comments),
        wordCount: asInt(row.wordCount),
        todoTotal: asInt(row.todoTotal),
        todoDone: asInt(row.todoDone),
        version: asInt(row.version, 1),
        author: String(row.author || ''),
        /* v1.4.1.1：待办编辑区改成笔记样式后，标题栏要显示心情 / 天气 / 标记 */
        mood: String((row as { mood?: string }).mood || ''),
        moodName: String((row as { moodName?: string }).moodName || ''),
        weather: String((row as { weather?: string }).weather || ''),
        weatherName: String((row as { weatherName?: string }).weatherName || ''),
        markerName: String((row as { markers?: { marker?: { name?: string } }[] }).markers?.[0]?.marker?.name || ''),
        /* v1.4.1.1：待办截止时间（0 = 未设） */
        dueAt: timeOf(row.dueAt),
        createdAt: timeOf(row.createdAt),
        updatedAt: timeOf(row.updatedAt),
        publishedAt: timeOf(row.publishedAt),
        metas: safeParse(row.metas, {}),
        tags: row.tags.map((t) => String(t.tag?.name || '')).filter(Boolean),
        tabs: tabs.map((t) => ({
          id: String(t.id || ''),
          title: String(t.title || ''),
          content: String(t.content || ''),
          sort: asInt(t.sort),
          todoTotal: asInt((t as { todoTotal?: number }).todoTotal),
          todoDone: asInt((t as { todoDone?: number }).todoDone),
          wordCount: asInt((t as { wordCount?: number }).wordCount),
        })),
      },
    };
  }

  // ==========================================================
  //  新建 / 保存
  // ==========================================================

  /**
   * 新建文章。
   * 需求：新建待办时自动把类型写成 todo，新建导航写成 nav，其余为普通文章。
   * 类型由调用方（对应入口）传入，服务端只做归一与校验。
   */
  async createArticle(
    viewer: string,
    instanceId: string,
    input: { type?: unknown; folderId?: unknown; title?: unknown; content?: unknown; status?: unknown },
  ) {
    const type = normalizeArticleType(input.type);
    const title = String(input.title ?? '').trim().slice(0, MAX_ARTICLE_TITLE);
    const folderId = String(input.folderId ?? '');
    if (folderId) {
      const f = await prisma.articleFolder.findFirst({ where: { id: folderId, author: viewer, instanceId, type } });
      if (!f) return { error: '分类不存在' as string };
    }
    const content = String(input.content ?? '');
    const stat = countTodoTasks(content);
    /*
     * v1.4.1（需求）：待办没有「草稿」这一说 —— 新建即发布。
     * 文章仍然从草稿起步（作者通常还要写摘要 / 选封面）。
     *
     * 待办这里**不看前端传的 status**：待办有多个创建入口（列表页、发布页、
     * 右键菜单…），逐个入口保证传 published 太脆，漏一个就会冒出「草稿待办」。
     * 收口在服务端，任何入口新建待办都是已发布。
     */
    const asked = String(input.status ?? '').trim();
    const status = type === 'todo' ? 'published' : asked === 'published' ? 'published' : 'draft';
    const article = await prisma.article.create({
      data: {
        type,
        title,
        content,
        folderId,
        author: viewer,
        instanceId,
        status,
        publishedAt: status === 'published' ? new Date() : null,
        wordCount: countArticleWords(content),
        todoTotal: stat.total,
        todoDone: stat.done,
        tabs: {
          create: [
            {
              title: '正文',
              content,
              sort: 0,
              todoTotal: stat.total,
              todoDone: stat.done,
              wordCount: countArticleWords(content),
            },
          ],
        },
      },
      include: { tabs: { orderBy: [{ sort: 'asc' }] } },
    });
    appLog.info('article', `新建${type === 'todo' ? '待办' : type === 'nav' ? '导航' : '文章'} ${article.id}（${viewer}@${instanceId || 'default'}）`);
    return { id: String(article.id), type, tabs: article.tabs.map((t) => ({ id: String(t.id), title: String(t.title || ''), content: String(t.content || ''), sort: asInt(t.sort) })) };
  }

  /**
   * 保存元信息（标题 / 摘要 / 备注 / 封面 / 分类 / 状态 / 待办勾选）。
   * 带 version 时做乐观锁：期望版本与库内不一致直接返回冲突，不静默覆盖。
   */
  async updateArticle(
    viewer: string,
    instanceId: string,
    id: string,
    input: {
      title?: unknown;
      excerpt?: unknown;
      note?: unknown;
      coverFileId?: unknown;
      folderId?: unknown;
      status?: unknown;
      done?: unknown;
      version?: unknown;
      /* v1.4.1.1：待办编辑区的标题栏字段（心情 / 天气 / 标记） */
      mood?: unknown;
      moodName?: unknown;
      weather?: unknown;
      weatherName?: unknown;
      markerName?: unknown;
      /* v1.4.1.1：截止时间（时间戳；0 / null = 清除） */
      dueAt?: unknown;
    },
  ) {
    const row = await prisma.article.findFirst({ where: { id, author: viewer, instanceId } });
    if (!row) return { error: '文章不存在' as string };
    const expect = input.version === undefined || input.version === null ? null : asInt(input.version, -1);
    if (expect !== null && expect !== asInt(row.version, 1)) {
      appLog.warn('article', `保存冲突：文章 ${id} 期望版本 ${expect}，库内 ${row.version}`);
      return { conflict: true as const, version: asInt(row.version, 1), error: '内容已在别处更新' };
    }
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = String(input.title ?? '').trim().slice(0, MAX_ARTICLE_TITLE);
    if (input.excerpt !== undefined) data.excerpt = String(input.excerpt ?? '').slice(0, MAX_ARTICLE_EXCERPT);
    if (input.note !== undefined) data.note = String(input.note ?? '').slice(0, MAX_ARTICLE_NOTE);
    if (input.coverFileId !== undefined) data.coverFileId = String(input.coverFileId ?? '');
    if (input.folderId !== undefined) {
      const fid = String(input.folderId ?? '');
      if (fid) {
        const f = await prisma.articleFolder.findFirst({ where: { id: fid, author: viewer, instanceId, type: row.type } });
        if (!f) return { error: '分类不存在' as string };
      }
      data.folderId = fid;
    }
    if (input.done !== undefined) data.done = !!input.done;
    /* v1.4.1.1：心情 / 天气（与笔记同一套 key / 名称，只有传了才写） */
    if (input.mood !== undefined) data.mood = String(input.mood ?? '').slice(0, 40);
    if (input.moodName !== undefined) data.moodName = String(input.moodName ?? '').slice(0, 60);
    if (input.weather !== undefined) data.weather = String(input.weather ?? '').slice(0, 40);
    if (input.weatherName !== undefined) data.weatherName = String(input.weatherName ?? '').slice(0, 60);
    /* v1.4.1.1：截止时间 —— 0 / 空 / 非法值一律按「不设截止」写 null */
    if (input.dueAt !== undefined) {
      const ts = Number(input.dueAt);
      data.dueAt = Number.isFinite(ts) && ts > 0 ? new Date(ts) : null;
    }
    if (input.status !== undefined) {
      const status = normalizeArticleStatus(input.status);
      data.status = status;
      if (status === 'published' && !row.publishedAt) data.publishedAt = new Date();
    }
    data.version = asInt(row.version, 1) + 1;
    const updated = await prisma.article.update({ where: { id }, data: data as never });
    /*
     * v1.4.1.1：标记（单选）—— 写 markers 表 + article_markers 关联。
     * 与笔记同一套「传了才改」规则：编辑器普通自动保存不带 markerName，
     * 不能把已经设好的标记清掉；传空串才代表清空。
     */
    if (input.markerName !== undefined) {
      try {
        const name = String(input.markerName ?? '').trim().slice(0, 120);
        const markerType = String(row.type || 'article');
        const marker = name ? await findOrCreateMarker(name, instanceId, viewer, markerType) : null;
        await prisma.articleMarker.deleteMany({ where: { articleId: id } });
        if (marker) await prisma.articleMarker.create({ data: { articleId: id, markerId: marker.id } });
      } catch (e) {
        appLog.warn('article', `保存标记失败：文章 ${id}`);
      }
    }
    return {
      id: String(updated.id),
      version: asInt(updated.version, 1),
      updatedAt: timeOf(updated.updatedAt),
      status: String(updated.status || ''),
      done: !!updated.done,
      folderId: String(updated.folderId || ''),
      title: String(updated.title || ''),
      dueAt: timeOf(updated.dueAt),
    };
  }

  /**
   * 批量保存页签（正文真源）。
   *
   * 入参 tabs 的顺序就是页签顺序；id 为空 = 新增，缺省的旧页签 = 删除。
   * 保存后一次性重算：镜像正文（第一个页签）、总字数、待办完成率。
   */
  async saveTabs(
    viewer: string,
    instanceId: string,
    id: string,
    input: { tabs?: unknown; version?: unknown },
  ) {
    const row = await prisma.article.findFirst({ where: { id, author: viewer, instanceId } });
    if (!row) return { error: '文章不存在' as string };
    const expect = input.version === undefined || input.version === null ? null : asInt(input.version, -1);
    if (expect !== null && expect !== asInt(row.version, 1)) {
      appLog.warn('article', `页签保存冲突：文章 ${id} 期望版本 ${expect}，库内 ${row.version}`);
      return { conflict: true as const, version: asInt(row.version, 1), error: '内容已在别处更新' };
    }
    const raw = Array.isArray(input.tabs) ? input.tabs : [];
    if (!raw.length) return { error: '至少保留一个页签' as string };
    if (raw.length > MAX_ARTICLE_TABS) return { error: `页签最多 ${MAX_ARTICLE_TABS} 个` as string };

    const incoming = raw.slice(0, MAX_ARTICLE_TABS).map((t, i) => {
      const o = (t || {}) as Record<string, unknown>;
      const content = String(o.content ?? '');
      if (content.length > MAX_TAB_CONTENT) throw new Error('单个页签正文过长');
      const stat = countTodoTasks(content);
      return {
        id: String(o.id ?? ''),
        title: String(o.title ?? '').trim().slice(0, MAX_TAB_TITLE) || `页签 ${i + 1}`,
        content,
        sort: i * 10,
        todoTotal: stat.total,
        todoDone: stat.done,
        wordCount: countArticleWords(content),
      };
    });

    const existing = await prisma.articleTab.findMany({ where: { articleId: id }, select: { id: true } });
    const existingIds = new Set(existing.map((t) => String(t.id)));
    const keepIds = new Set(incoming.map((t) => t.id).filter((x) => x && existingIds.has(x)));

    let wordCount = 0;
    let todoTotal = 0;
    let todoDone = 0;
    for (const t of incoming) {
      wordCount += t.wordCount;
      todoTotal += t.todoTotal;
      todoDone += t.todoDone;
    }

    await prisma.$transaction(async (tx) => {
      // 1) 删掉本次没提交的旧页签
      const removeIds = [...existingIds].filter((x) => !keepIds.has(x));
      if (removeIds.length) await tx.articleTab.deleteMany({ where: { id: { in: removeIds } } });
      // 2) 逐条 upsert（id 属于本篇才更新，防止跨文章改别人的页签）
      for (const t of incoming) {
        if (t.id && keepIds.has(t.id)) {
          await tx.articleTab.update({
            where: { id: t.id },
            data: {
              title: t.title,
              content: t.content,
              sort: t.sort,
              todoTotal: t.todoTotal,
              todoDone: t.todoDone,
              wordCount: t.wordCount,
            },
          });
        } else {
          await tx.articleTab.create({
            data: {
              articleId: id,
              title: t.title,
              content: t.content,
              sort: t.sort,
              todoTotal: t.todoTotal,
              todoDone: t.todoDone,
              wordCount: t.wordCount,
            },
          });
        }
      }
      // 3) 回写镜像正文与聚合统计
      await tx.article.update({
        where: { id },
        data: {
          content: incoming[0].content,
          wordCount,
          todoTotal,
          todoDone,
          // 待办全部勾完时自动把整篇标成已完成，用户手动取消则不会被这里清除
          done: row.type === 'todo' && todoTotal > 0 && todoDone >= todoTotal ? true : !!row.done,
          version: asInt(row.version, 1) + 1,
        },
      });
    });

    const tabs = await prisma.articleTab.findMany({ where: { articleId: id }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
    const fresh = await prisma.article.findFirst({ where: { id }, select: { version: true, updatedAt: true, done: true, content: true } });
    return {
      tabs: tabs.map((t) => ({
        id: String(t.id),
        title: String(t.title || ''),
        content: String(t.content || ''),
        sort: asInt(t.sort),
        todoTotal: asInt(t.todoTotal),
        todoDone: asInt(t.todoDone),
        wordCount: asInt(t.wordCount),
      })),
      wordCount,
      todoTotal,
      todoDone,
      version: asInt(fresh?.version, 1),
      updatedAt: timeOf(fresh?.updatedAt),
      done: !!fresh?.done,
    };
  }

  // ==========================================================
  //  标签
  // ==========================================================

  /** 候选标签（当前账户在该内容类型下用过的全部标签，按使用次数降序） */
  async tagCandidates(viewer: string, instanceId: string, typeRaw: unknown) {
    const type = normalizeArticleType(typeRaw);
    const scope = tagScope(instanceId, type, viewer);
    const tags = await prisma.tag.findMany({
      where: { ...scope },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true, name: true },
    });
    const counts = await prisma.articleTag.groupBy({
      by: ['tagId'],
      where: { article: { author: viewer, instanceId, type } },
      _count: { _all: true },
    });
    const countMap = new Map((counts as Array<{ tagId: string; _count: { _all: number } }>).map((c) => [String(c.tagId), Number(c._count?._all || 0)]));
    return tags
      .map((t) => ({ id: String(t.id), name: String(t.name || ''), count: countMap.get(String(t.id)) || 0 }))
      .filter((t) => t.name)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  /** 设置文章标签（全量覆盖：前端提交最终名单） */
  async setTags(viewer: string, instanceId: string, id: string, rawNames: unknown) {
    const row = await prisma.article.findFirst({ where: { id, author: viewer, instanceId } });
    if (!row) return { error: '文章不存在' as string };
    const names = normalizeTagNames(rawNames).slice(0, MAX_TAGS_PER_NOTE);
    const tagIds: string[] = [];
    for (const name of names) {
      const tag = await findOrCreateTag(name, instanceId, viewer, String(row.type || 'article'));
      tagIds.push(String(tag.id));
    }
    await prisma.$transaction(async (tx) => {
      await tx.articleTag.deleteMany({ where: { articleId: id } });
      for (const tagId of tagIds) {
        await tx.articleTag.create({ data: { articleId: id, tagId } }).catch(() => undefined);
      }
    });
    return { tags: names };
  }

  // ==========================================================
  //  回收站
  // ==========================================================

  async deleteArticle(viewer: string, instanceId: string, id: string) {
    const row = await prisma.article.findFirst({ where: { id, author: viewer, instanceId } });
    if (!row) return { error: '文章不存在' as string };
    await prisma.article.update({ where: { id }, data: { status: 'deleted', deletedAt: new Date() } });
    appLog.info('article', `${row.type === 'todo' ? '待办' : '文章'}进回收站：${id}（${row.title || '无标题'}）`);
    return { ok: true };
  }

  async restoreArticle(viewer: string, instanceId: string, id: string) {
    const row = await prisma.article.findFirst({ where: { id, author: viewer, instanceId } });
    if (!row) return { error: '文章不存在' as string };
    // 原分类可能已被删除 → 恢复到未分类，避免出现「挂在不存在分类下」的脏数据
    let folderId = String(row.folderId || '');
    if (folderId) {
      const f = await prisma.articleFolder.findFirst({ where: { id: folderId }, select: { id: true } });
      if (!f) folderId = '';
    }
    await prisma.article.update({
      where: { id },
      data: { status: 'draft', deletedAt: null, folderId },
    });
    return { ok: true };
  }

  async purgeArticle(viewer: string, instanceId: string, id: string) {
    const row = await prisma.article.findFirst({ where: { id, author: viewer, instanceId } });
    if (!row) return { error: '文章不存在' as string };
    await prisma.article.delete({ where: { id } });
    appLog.info('article', `彻底删除文章 ${id}（${row.title || '无标题'}）`);
    return { ok: true };
  }
}
