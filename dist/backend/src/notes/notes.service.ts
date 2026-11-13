/**
 * 笔记板块 · 业务逻辑（v1.2.0 起：瞬间）
 * ----------------------------------------------------------------------------
 * 设计要点（与 docs/规划/瞬间功能-实施方案-v1.md 对应）：
 *
 *  1) 主干 + 扩展：Note 存所有类型共用字段，NoteMoment 存瞬间专属字段。
 *     「全部」视图 = 不过滤 kind，天然支持以后混排。
 *
 *  2) 附件只存 fileId。列表/详情返回时按当前 FileRecord.name 拼 `/file/<name>`，
 *     于是「文件改名 / 换渠道 / 换自定义域名」三种情况历史笔记都不会挂图。
 *     一次 findMany 批量取全，绝不循环查库（一页 20 条 × 最多 50 个附件）。
 *
 *  3) mediaKind / assetCount / charCount 是冗余列：保存时算一次写死，
 *     列表筛选与「要不要显示全文」直接读，避免每次翻页都聚合附件表。
 *
 *  4) 权限口径（v1.1.4 收紧）：
 *       · 必须登录（笔记是个人内容，匿名不可用）
 *       · 一律按 instanceId 收窄（与文件体系同一套实例隔离）
 *       · 笔记只对作者本人可见：列表 / 详情 / 编辑 / 删除 / 留言一律 `author = viewer`，
 *         管理员也不再在笔记里「看全部」—— 笔记属于私人内容，角色不应该扩大可读范围。
 *         实例隔离与用户隔离是两层独立的过滤，两层都必须命中，杜绝跨用户、跨实例串位。
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '../common/prisma';
import { appLog } from '../common/app-log';
import { TAG_TYPE_NOTE, findOrCreateTag, tagScope } from '../common/tags';
import { syncFileStats } from '../common/file-share-stats';
import { fileTypeOf } from '../common/file-view';
// v1.1.3：「图床文件」模式的筛选与图床管理共用同一份求值实现（见 common/file-filter.ts）
import { isEmptyFileFilter, parseFileFilterQuery, passesFileFilters } from '../common/file-filter';
import {
  DEFAULT_MOMENT_MAX_CHARS,
  MAX_ASSETS_PER_NOTE,
  MAX_COMMENT_CHARS,
  NOTE_VISIBILITIES,
  countTextChars,
  fileUrlOf,
  mediaKindOf,
  mediaKindOfMime,
  normalizeTagNames,
  normalizeNoteSettings,
  safeParse,
} from './notes.util';

/** 列表 / 详情统一返回的附件形态（前端直接吃，不需要再拼地址） */
export interface NoteAssetView {
  fileId: string;
  /** 当前外链（改名 / 换渠道 / 换域名后自动跟随） */
  url: string;
  /** 九宫格用的缩略图（服务端 sharp 缩放；非图片时与 url 相同） */
  thumbUrl: string;
  name: string;
  originalName: string;
  mime: string;
  size: number;
  /** image | video | audio | file */
  mediaKind: string;
  /** 文件是否仍然存在（被彻底删除后为 false，前端跳过该格） */
  alive: boolean;
}

export interface NoteListItem {
  id: string;
  kind: string;
  /** 瞬间的「标题」（存 note_moments.title，独立成列；进入编辑页自动填日期时间，用户可改） */
  title: string;
  content: string;
  coverFileId: string;
  visibility: string;
  status: string;
  author: string;
  /**
   * v1.1.9.4：这条笔记是不是当前登录账户自己的。
   * 广场里会混进别人的公开笔记 —— 前端据它隐藏编辑 / 删除入口（后端写接口仍会再校验）。
   */
  mine: boolean;
  instanceId: string;
  version: number;
  publishedAt: number;
  createdAt: number;
  updatedAt: number;
  moment: {
    mediaKind: string;
    assetCount: number;
    charCount: number;
    weather: string;
    mood: string;
    /** v1.1.2：心情 / 天气的名称（「开心」「晴」…），入参时由前端一并送来 */
    weatherName: string;
    moodName: string;
    location: string;
  } | null;
  assets: NoteAssetView[];
  tags: { id: string; name: string }[];
  /**
   * v1.1.2.3：留言（内联展示在卡片底部）。
   * 列表一次批量取回，前端不再逐条请求（一页 20 条 × 每条一次请求 = 20 个请求）。
   */
  comments: NoteCommentView[];
  /** 留言总数（可能大于 comments.length —— 单条笔记最多带 100 条，超出由前端按需补拉） */
  commentCount: number;
}

/** 列表里带的留言形态（字段与 listComments 完全一致，前端一套渲染逻辑） */
export interface NoteCommentView {
  id: string;
  content: string;
  charCount: number;
  author: string;
  createdAt: number;
  mine: boolean;
}

/** 一条瞬间最多随列表带多少条留言（超出部分按需补拉，避免一页几百 KB） */
export const LIST_COMMENT_MAX = 100;

export interface ListInput {
  kind?: string;
  /**
   * v1.1.9.4：'square' = 广场（全站公开笔记，跨账户跨实例）；
   * 不传 = 我的笔记（author + instanceId 收窄）。
   */
  scope?: string;
  mediaKind?: string;
  search?: string;
  /** v1.1.3：搜索范围 —— all（默认）| title 标题 | content 正文 | tag 标签 | other 其他 */
  searchType?: string;
  tagId?: string;
  status?: string;
  from?: string;
  to?: string;
  sort?: string;
  order?: string;
  page?: number;
  pageSize?: number;
  instanceId?: string;
  /** 当前登录账户与角色（由控制器注入，不信任前端传值） */
  viewer: string;
  isAdmin: boolean;
}

/**
 * v1.1.3：把搜索词拆成「关键词 + 必须包含的标签 + 必须排除的标签」。
 *
 * 规则与图床管理页完全一致（同一个用户的心智模型，不要造第二套语法）：
 *   · `#标签`  → 必须带这个标签
 *   · `-#标签` → 不能带这个标签
 *   · 其余词   → 普通关键词，按 searchType 决定搜索哪几列
 *
 * 例：`海边 #旅行 -#工作` → keyword='海边'，include=['旅行']，exclude=['工作']
 */
export function parseNoteSearch(raw?: string): { keyword: string; includeTags: string[]; excludeTags: string[] } {
  const includeTags: string[] = [];
  const excludeTags: string[] = [];
  const words: string[] = [];
  for (const token of String(raw || '').split(/\s+/)) {
    if (!token) continue;
    if (token.startsWith('-#') && token.length > 2) {
      excludeTags.push(token.slice(2));
    } else if (token.startsWith('#') && token.length > 1) {
      includeTags.push(token.slice(1));
    } else {
      words.push(token);
    }
  }
  return { keyword: words.join(' '), includeTags, excludeTags };
}

export interface MomentInput {
  /** 标题（进入编辑页自动填日期时间；v1.1.3 起存进 note_moments.title 独立列） */
  title?: string;
  content?: string;
  mood?: string;
  weather?: string;
  /** v1.1.2：心情 / 天气的名称（与 mood/weather 成对写入，供以后筛选统计） */
  moodName?: string;
  weatherName?: string;
  location?: string;
  visibility?: string;
  assetIds?: string[];
  tagNames?: string[];
  instanceId?: string;
  /**
   * v1.1.6：实际发布时间（点击卡片标题旁的时间可改）。
   * 接受毫秒时间戳或 ISO 字符串；只用于校正「这条内容是什么时候发的」，
   * 不影响 createdAt（数据入库时间），排序仍按 publishedAt 走。
   */
  publishedAt?: number | string;
}

/** 允许排序的字段（白名单，杜绝把任意字符串塞进 orderBy） */
const SORTABLE: Record<string, string> = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  publishedAt: 'publishedAt',
};

/** 列表一次取文件时只选必要列（大文件表，别把 metas 全拉出来） */
const FILE_SELECT = {
  id: true,
  name: true,
  originalName: true,
  mime: true,
  size: true,
} as const;

@Injectable()
export class NotesService {
  /* ========================================================================
   *  瞬间字数上限（存 settings 表，可在系统设置里改；缺省 500）
   * ====================================================================== */
  async momentMaxChars(): Promise<number> {
    try {
      const row = await prisma.setting.findUnique({ where: { key: 'notesMomentMaxChars' } });
      const n = Number(row?.value);
      if (Number.isFinite(n) && n >= 50 && n <= 20000) return Math.round(n);
    } catch {
      /* 查不到就用默认值 */
    }
    return DEFAULT_MOMENT_MAX_CHARS;
  }

  /**
   * 附件入参解析：既接受 files.id（cuid），也接受 File_ID（name）。
   *
   * 为什么要兼容两种：
   *   · 图床选文件器返回的是 files.id（稳定）；
   *   · 但 `POST /upload` 的响应里 `id` 是 **File_ID**（v1.0.9 起为「灯箱抓拍查看详情」补的），
   *     前端「本地上传后自动插入」拿到的就是它。
   * 两者都在这里统一解析成 files.id 落库，避免前端各写一套转换、也避免把会变的 File_ID 存进库。
   *
   * 同时做三件事：去重、保持入参顺序（九宫格顺序 = 用户添加顺序）、校验实例归属。
   */
  private async resolveAssetFiles(rawIds: string[], instanceId: string) {
    const ids = Array.from(new Set((rawIds || []).map((x) => String(x || '').trim()).filter(Boolean)));
    if (!ids.length) return { ordered: [] as { id: string; mime: string }[], missing: [] as string[] };
    const rows = await prisma.fileRecord.findMany({
      where: {
        instanceId,
        // 回收站里的文件不允许再被引用
        status: 'active',
        OR: [{ id: { in: ids } }, { name: { in: ids } }],
      },
      select: FILE_SELECT,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const byName = new Map(rows.map((r) => [r.name, r]));
    const ordered: { id: string; mime: string }[] = [];
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const raw of ids) {
      const hit = byId.get(raw) || byName.get(raw);
      if (!hit) {
        missing.push(raw);
        continue;
      }
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      ordered.push(hit);
    }
    return { ordered, missing };
  }

  /* ========================================================================
   *  附件解析：fileId[] → 当前外链（批量，一次查询）
   * ====================================================================== */
  private async resolveFiles(fileIds: string[]): Promise<Map<string, NoteAssetView>> {
    const ids = Array.from(new Set((fileIds || []).filter(Boolean)));
    const map = new Map<string, NoteAssetView>();
    if (!ids.length) return map;
    const rows = await prisma.fileRecord.findMany({
      where: { id: { in: ids } },
      select: FILE_SELECT,
    });
    for (const r of rows) {
      const kind = mediaKindOfMime(r.mime);
      map.set(r.id, {
        fileId: r.id,
        // 这里用**当前** name（不是上传时的名字）—— 改名后仍然正确
        url: fileUrlOf(r.name),
        thumbUrl: fileUrlOf(r.name, kind === 'image' ? 480 : undefined),
        name: r.name,
        originalName: r.originalName,
        mime: r.mime,
        size: r.size,
        mediaKind: kind,
        alive: true,
      });
    }
    return map;
  }

  /** 把数据库行转成前端契约（附件缺文件时跳过该格，不让整条崩掉） */
  private async toListItem(row: any, viewer = ''): Promise<NoteListItem> {
    const assets: NoteAssetView[] = [];
    const map = await this.resolveFiles((row.assets || []).map((a: any) => a.fileId));
    for (const a of row.assets || []) {
      const hit = map.get(a.fileId);
      if (hit) assets.push(hit);
    }
    // v1.1.2.3：详情接口也带留言，详情页与列表用同一份渲染逻辑
    const commentRows = await prisma.noteComment.findMany({
      where: { noteId: row.id },
      orderBy: { createdAt: 'asc' },
      take: LIST_COMMENT_MAX,
    });
    const commentCount = await prisma.noteComment.count({ where: { noteId: row.id } });
    return this.shape(row, assets, commentRows, commentCount, viewer);
  }

  /* ========================================================================
   *  列表
   * ====================================================================== */
  private buildWhere(input: ListInput): Record<string, unknown> {
    /*
     * v1.1.9.4（需求）：广场（scope=square）—— 全站公开笔记。
     * 与「我的」是完全不同的两套口径：
     *   · 不分账户（所有人的公开笔记都在里面）；
     *   · 不分实例（需求原文：广场加载所有用户所有实例的公开内容）；
     *   · 只取 visibility=public 且已发布（status=published），回收站内容不外露。
     * 写入仍然照旧按 author 校验 —— 广场只放宽「看」，不放宽「改」。
     */
    const square = String(input.scope || '').toLowerCase() === 'square';
    const where: Record<string, unknown> = square
      ? {}
      : {
          // 实例隔离：空串 = 默认实例（与文件体系一致，不是「不过滤」）
          instanceId: String(input.instanceId || ''),
        };
    // 「全部」= 不传 kind（不要写成 kind='moment'，否则以后加类型要改所有调用点）
    if (input.kind) where.kind = String(input.kind);
    if (square) {
      where.visibility = 'public';
      where.status = 'published';
    } else {
      // 回收站：status=deleted 才看回收站，否则只看正常内容
      where.status = input.status === 'deleted' ? 'deleted' : input.status === 'all' ? { not: 'deleted' } : 'published';
      /*
       * v1.1.4：笔记只属于作者本人 —— 无论角色都按 author 收窄。
       * 原来是「管理员在实例内看全部」，会让管理员在笔记管理里看到别人的私人记录；
       * 现在管理员与普通用户同一口径：谁的笔记谁自己看。
       */
      where.author = String(input.viewer || '');
    }
    /*
     * 搜索（v1.1.3）：从「一句 LIKE 打天下」升级成「关键词 + 范围 + 标签语法」。
     *   · `#标签` / `-#标签` 从搜索词里解析出来，走关系过滤（tagId 用等值，名称用模糊）；
     *   · 剩下的关键词按 searchType 决定搜哪几列 —— 默认 all 仍然是「全部列都试一遍」，
     *     所以老书签 / 老前端不传 searchType 时行为与升级前一致；
     *   · 标题自 v1.1.3 起独立成 note_moments.title 列，按标题搜不再对 metas 整段 JSON 做
     *     LIKE（那样既搜不准，也用不上索引）；metas 仍保留在 all 里，兜住老数据与其它类型
     *     将来可能塞进 JSON 的可搜文本。
     */
    const parsed = parseNoteSearch(input.search);
    const and: Record<string, unknown>[] = [];
    for (const name of parsed.includeTags) {
      and.push({ tags: { some: { tag: { name: { equals: name, mode: 'insensitive' } } } } });
    }
    for (const name of parsed.excludeTags) {
      and.push({ tags: { none: { tag: { name: { equals: name, mode: 'insensitive' } } } } });
    }
    if (parsed.keyword) {
      const kw = { contains: parsed.keyword, mode: 'insensitive' };
      const byScope: Record<string, Record<string, unknown>[]> = {
        title: [{ moment: { title: kw } }],
        content: [{ content: kw }],
        tag: [{ tags: { some: { tag: { name: kw } } } }],
        // 其他 = 除标题 / 正文 / 标签之外能被用户记住的东西：地点、心情、天气、作者、留言
        other: [
          { moment: { location: kw } },
          { moment: { moodName: kw } },
          { moment: { weatherName: kw } },
          { author: kw },
          { comments: { some: { content: kw } } },
        ],
        all: [
          { content: kw },
          { metas: kw },
          { moment: { title: kw } },
          { tags: { some: { tag: { name: kw } } } },
          { moment: { location: kw } },
          { moment: { moodName: kw } },
          { moment: { weatherName: kw } },
          { author: kw },
          { comments: { some: { content: kw } } },
        ],
      };
      const scope = String(input.searchType || 'all').toLowerCase();
      and.push({ OR: byScope[scope] || byScope.all });
    }
    if (and.length) where.AND = and;
    if (input.mediaKind) where.moment = { mediaKind: String(input.mediaKind) };
    if (input.tagId) where.tags = { some: { tagId: String(input.tagId) } };
    if (input.from || input.to) {
      const range: Record<string, Date> = {};
      if (input.from) {
        const d = new Date(input.from);
        if (!Number.isNaN(d.getTime())) range.gte = d;
      }
      if (input.to) {
        const d = new Date(input.to);
        if (!Number.isNaN(d.getTime())) {
          // 「到某天」按当天 23:59:59.999 理解（筛选「今天」不能漏掉今天下午发的）
          d.setHours(23, 59, 59, 999);
          range.lte = d;
        }
      }
      if (Object.keys(range).length) where.createdAt = range;
    }
    return where;
  }

  async list(input: ListInput) {
    const where = this.buildWhere(input);
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize) || 20)));
    /*
     * v1.1.8（需求）：默认排序「最新发布」按**发布时间**降序 —— 发布时间可以在瞬间头部
     * 点开手工校正，才是用户认知里的「发布顺序」；创建时间（createdAt）只是落库时间，
     * 库里固定、不提供修改，作为并列时的次序兜底。
     */
    const sortKey = SORTABLE[String(input.sort || '')] || 'publishedAt';
    const order: 'asc' | 'desc' = String(input.order || 'desc') === 'asc' ? 'asc' : 'desc';
    /*
     * 老数据的 publishedAt 可能为空（v1.1.x 之前的瞬间没有这一列），
     * Postgres 的 DESC 默认把 NULL 排在最前面 —— 那会让最老的几条永远置顶。
     * 显式指定 nulls last / first：升序时 NULL 排最后、降序时也排最后。
     */
    const orderBy =
      sortKey === 'publishedAt'
        ? ([{ publishedAt: { sort: order, nulls: 'last' } }, { createdAt: 'desc' }] as any)
        : ({ [sortKey]: order } as any);

    const [total, rows] = await Promise.all([
      prisma.note.count({ where: where as any }),
      prisma.note.findMany({
        where: where as any,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          moment: true,
          assets: { orderBy: { sort: 'asc' } },
          tags: { include: { tag: true } },
        },
      }),
    ]);

    // 分页内所有笔记的附件一次性批量解析（避免每条一次查询的 N+1）
    const allFileIds = rows.flatMap((r: any) => (r.assets || []).map((a: any) => a.fileId));
    const fileMap = await this.resolveFiles(allFileIds);

    // v1.1.2.3：留言也批量取（一条 SQL 取回本页所有笔记的留言，再按 noteId 分组），
    // 不能让每张卡片自己请求一次 —— 一页 20 条就是 20 个请求。
    const noteIds = rows.map((r: any) => String(r.id));
    const [commentRows, commentCounts] = noteIds.length
      ? await Promise.all([
          prisma.noteComment.findMany({
            where: { noteId: { in: noteIds } },
            orderBy: { createdAt: 'asc' },
          }),
          prisma.noteComment.groupBy({ by: ['noteId'], where: { noteId: { in: noteIds } }, _count: { _all: true } }),
        ])
      : [[], []];
    const commentsByNote = new Map<string, any[]>();
    for (const c of commentRows as any[]) {
      const key = String(c.noteId);
      const arr = commentsByNote.get(key);
      if (arr) arr.push(c);
      else commentsByNote.set(key, [c]);
    }
    const countByNote = new Map<string, number>();
    for (const g of commentCounts as any[]) {
      countByNote.set(String(g.noteId), Number(g._count && g._count._all) || 0);
    }

    const list = rows.map((row: any) => {
      const assets: NoteAssetView[] = [];
      for (const a of row.assets || []) {
        const hit = fileMap.get(a.fileId);
        if (hit) assets.push(hit);
      }
      const all = commentsByNote.get(String(row.id)) || [];
      return this.shape(row, assets, all.slice(0, LIST_COMMENT_MAX), countByNote.get(String(row.id)) || all.length, input.viewer);
    });

    return { total, page, pageSize, list };
  }

  /** 把数据库留言行转成前端契约（列表 / 详情 / 留言接口共用同一形态，前端一套渲染） */
  private shapeComments(rows: any[], viewer: string): NoteCommentView[] {
    return (rows || []).map((r: any) => ({
      id: r.id,
      content: r.content,
      charCount: Number(r.charCount) || 0,
      author: r.author,
      createdAt: r.createdAt ? new Date(r.createdAt).getTime() : 0,
      // 前端据此决定要不要显示删除按钮（后端仍然会再校验一次）
      mine: r.author === viewer,
    }));
  }

  /** 纯同步的行 → 契约映射（附件与留言由调用方传入，便于批量复用） */
  private shape(row: any, assets: NoteAssetView[], comments: any[] = [], commentCount = 0, viewer = ''): NoteListItem {
    return {
      id: row.id,
      kind: row.kind,
      // 标题只认独立列（v1.1.3 起）；metas 里不再写 title，也不做兜底 ——
      // 兜底会让「清空标题」失效（列已空、旧 JSON 里还留着上一版的值）
      title: String(row.moment?.title || ''),
      content: row.content || '',
      coverFileId: row.coverFileId || '',
      visibility: row.visibility || 'private',
      status: row.status,
      author: row.author || '',
      // v1.1.9.4：广场里据此区分「我的」与「别人的公开内容」
      mine: String(row.author || '') === String(viewer || ''),
      instanceId: row.instanceId || '',
      version: Number(row.version) || 1,
      publishedAt: row.publishedAt ? new Date(row.publishedAt).getTime() : 0,
      createdAt: row.createdAt ? new Date(row.createdAt).getTime() : 0,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : 0,
      moment: row.moment
        ? {
            mediaKind: row.moment.mediaKind || 'text',
            assetCount: Number(row.moment.assetCount) || assets.length,
            charCount: Number(row.moment.charCount) || 0,
            weather: row.moment.weather || '',
            mood: row.moment.mood || '',
            weatherName: row.moment.weatherName || '',
            moodName: row.moment.moodName || '',
            location: row.moment.location || '',
          }
        : null,
      assets,
      tags: (row.tags || [])
        .map((t: any) => ({ id: t.tag?.id || t.tagId, name: t.tag?.name || '' }))
        .filter((t: any) => t.name),
      comments: this.shapeComments(comments, viewer),
      commentCount: Number(commentCount) || 0,
    };
  }

  /* ========================================================================
   *  详情
   * ====================================================================== */
  async detail(id: string, viewer: string, _isAdmin: boolean, instanceId: string) {
    const row = await prisma.note.findFirst({
      where: {
        id: String(id || ''),
        instanceId: String(instanceId || ''),
        // v1.1.4：详情也只认作者本人（isAdmin 不再扩大可见范围）
        author: String(viewer || ''),
      },
      include: {
        moment: true,
        assets: { orderBy: { sort: 'asc' } },
        tags: { include: { tag: true } },
      },
    });
    if (row) return this.toListItem(row, viewer);
    /*
     * v1.1.9.4（需求）：广场里的公开笔记，任何登录账户都可以打开查看。
     * 只放宽「读」——编辑 / 删除仍由 updateMoment / softDelete 里的 author 校验拦住。
     */
    const published = await prisma.note.findFirst({
      where: {
        id: String(id || ''),
        status: 'published',
        visibility: 'public',
      },
      include: {
        moment: true,
        assets: { orderBy: { sort: 'asc' } },
        tags: { include: { tag: true } },
      },
    });
    if (!published) return null;
    return this.toListItem(published, viewer);
  }

  /* ========================================================================
   *  创建（本版只有瞬间）
   * ====================================================================== */
  async createMoment(input: MomentInput, viewer: string, ip: string) {
    const instanceId = String(input.instanceId || '');
    const maxChars = await this.momentMaxChars();
    const content = String(input.content ?? '');
    const charCount = countTextChars(content);
    if (charCount > maxChars) {
      return { error: `正文超出上限：当前 ${charCount} 字，上限 ${maxChars} 字（标点与符号不计入）` };
    }
    // 允许「只有附件、没有文字」，但两者都空就没有意义了
    const assetIds = Array.isArray(input.assetIds) ? Array.from(new Set(input.assetIds.map(String).filter(Boolean))) : [];
    if (assetIds.length > MAX_ASSETS_PER_NOTE) {
      return { error: `附件过多：当前 ${assetIds.length} 个，上限 ${MAX_ASSETS_PER_NOTE} 个` };
    }
    if (!content.trim() && assetIds.length === 0) {
      return { error: '瞬间内容不能为空：请填写文字或添加附件' };
    }

    // 附件必须存在、状态正常、且属于当前实例（防止把别的实例的 fileId 塞进来）
    const resolved = await this.resolveAssetFiles(assetIds, instanceId);
    if (resolved.missing.length) {
      return { error: `有 ${resolved.missing.length} 个附件不存在或不属于当前实例，请重新选择` };
    }
    const ordered = resolved.ordered;
    const mediaKind = mediaKindOf(ordered.map((f) => f.mime));

    const tagNames = normalizeTagNames(input.tagNames);
    const tagRows: { id: string }[] = [];
    for (const name of tagNames) {
      // 第四个参数 = 标签类型：笔记标签与文件标签同名也是两条记录，互不污染
      tagRows.push(await findOrCreateTag(name, instanceId, viewer, 'note'));
    }

    const visibility = NOTE_VISIBILITIES.includes(String(input.visibility || '') as any)
      ? String(input.visibility)
      : 'private';
    const now = new Date();

    try {
      /*
       * 嵌套写入 = 单条 SQL 事务（Prisma 内部用一次事务包住 note + moment + assets + tags），
       * 不经过交互式事务的 5 秒窗口，也不会留下「主干写了、扩展没写」的半截记录。
       */
      const created = await prisma.note.create({
        data: {
          kind: 'moment',
          content,
          coverFileId: ordered.find((f) => mediaKindOfMime(f.mime) === 'image')?.id || '',
          visibility,
          status: 'published',
          author: viewer,
          instanceId,
          publishedAt: now,
          // v1.1.7：首次发布时间只在这里写一次，后续改 publishedAt 不会动它
          firstPublishedAt: now,
          // metas 不再写 title（v1.1.3：标题独立成 note_moments.title 列）
          moment: {
            create: {
              title: String(input.title || '').trim().slice(0, 80),
              mediaKind,
              assetCount: ordered.length,
              charCount,
              mood: String(input.mood || '').slice(0, 32),
              weather: String(input.weather || '').slice(0, 32),
              moodName: String(input.moodName || '').slice(0, 32),
              weatherName: String(input.weatherName || '').slice(0, 32),
              location: String(input.location || '').slice(0, 80),
            },
          },
          assets: {
            create: ordered.map((f, idx) => ({ fileId: f.id, sort: idx, usage: 'attachment' })),
          },
          tags: {
            create: tagRows.map((t) => ({ tagId: t.id })),
          },
        },
        select: { id: true },
      });
      appLog.info(
        'note',
        `发布瞬间成功：${created.id}`,
        `正文 ${charCount} 字 ｜ 附件 ${ordered.length} 个（${mediaKind}）｜ 标签 ${tagRows.length} 个 ｜ 实例=${instanceId || '默认'}`,
        ip,
      );
      return { id: created.id };
    } catch (err) {
      appLog.error('note', '发布瞬间失败', `${(err as Error).message} ｜ 作者=${viewer}`, ip);
      return { error: `发布失败：${(err as Error).message}` };
    }
  }

  /* ========================================================================
   *  编辑
   * ====================================================================== */
  async updateMoment(id: string, input: MomentInput, viewer: string, isAdmin: boolean, ip: string) {
    const existing = await prisma.note.findUnique({
      where: { id: String(id || '') },
      include: { assets: true },
    });
    if (!existing || existing.kind !== 'moment') return { error: '瞬间不存在' };
    if (existing.status === 'deleted') return { error: '该瞬间在回收站里，请先恢复再编辑' };
    // v1.1.4：笔记私有 —— 管理员也不能编辑他人的瞬间
    if (existing.author !== viewer) return { error: '无权编辑他人的瞬间' };
    if (String(input.instanceId || '') !== String(existing.instanceId || '')) {
      return { error: '实例不匹配，请刷新后重试' };
    }

    const instanceId = existing.instanceId || '';
    const maxChars = await this.momentMaxChars();
    // 未传的字段保持原值（PUT 语义按「部分更新」处理，前端只送改动的项）
    const content = input.content === undefined ? existing.content : String(input.content);
    const charCount = countTextChars(content);
    if (charCount > maxChars) {
      return { error: `正文超出上限：当前 ${charCount} 字，上限 ${maxChars} 字（标点与符号不计入）` };
    }

    const assetIds =
      input.assetIds === undefined
        ? null
        : Array.from(new Set((input.assetIds || []).map(String).filter(Boolean)));
    if (assetIds && assetIds.length > MAX_ASSETS_PER_NOTE) {
      return { error: `附件过多：当前 ${assetIds.length} 个，上限 ${MAX_ASSETS_PER_NOTE} 个` };
    }
    if (!content.trim() && assetIds !== null && assetIds.length === 0) {
      return { error: '瞬间内容不能为空：请填写文字或添加附件' };
    }

    let ordered: { id: string; mime: string }[] | null = null;
    if (assetIds) {
      const resolved = await this.resolveAssetFiles(assetIds, instanceId);
      if (resolved.missing.length) return { error: '有附件不存在或不属于当前实例，请重新选择' };
      ordered = resolved.ordered;
    }
    // 媒体类型必须由后端统一重算（前端算的只用于预览）
    const finalAssetIds = assetIds || existing.assets.map((a) => a.fileId);
    const finalFiles = assetIds
      ? ordered!
      : await prisma.fileRecord.findMany({ where: { id: { in: finalAssetIds } }, select: FILE_SELECT });
    const mediaKind = mediaKindOf(finalFiles.map((f) => f.mime));

    const tagNames = input.tagNames === undefined ? null : normalizeTagNames(input.tagNames);
    const tagRows: { id: string }[] = [];
    if (tagNames) {
      for (const name of tagNames) tagRows.push(await findOrCreateTag(name, instanceId, viewer, 'note'));
    }

    const visibility =
      input.visibility !== undefined && NOTE_VISIBILITIES.includes(String(input.visibility) as any)
        ? String(input.visibility)
        : existing.visibility;

    /*
     * v1.1.6：发布时间校正 —— 只接受合法时间，且限制在「1970 ~ 现在 + 1 天」之间。
     * 上限放宽一天是为了容忍客户端与服务端的时区差（比如用户在东八区选了「今天 23:50」）。
     */
    let publishedAt: Date | null = null;
    if (input.publishedAt !== undefined) {
      const raw = input.publishedAt;
      const ms = typeof raw === 'number' ? raw : Date.parse(String(raw || ''));
      if (!Number.isFinite(ms)) return { error: '发布时间格式不正确' };
      const d = new Date(ms);
      const min = new Date('1970-01-02T00:00:00Z').getTime();
      const max = Date.now() + 24 * 3600 * 1000;
      if (ms < min || ms > max) return { error: '发布时间超出允许范围（不能早于 1970 年，也不能晚于明天）' };
      publishedAt = d;
    }

    try {
      await prisma.note.update({
        where: { id: existing.id },
        data: {
          content,
          visibility,
          // v1.1.6：发布时间的校正（未传则保持原值）
          ...(publishedAt ? { publishedAt } : {}),
          // 封面：保持/更新为第一张图
          coverFileId: finalFiles.find((f) => mediaKindOfMime(f.mime) === 'image')?.id || '',
          version: { increment: 1 },
          moment: {
            // 老数据可能没有扩展行（极端情况）→ upsert 兜住
            upsert: {
              create: {
                title: String(input.title || '').trim().slice(0, 80),
                mediaKind,
                assetCount: finalFiles.length,
                charCount,
                mood: String(input.mood || '').slice(0, 32),
                weather: String(input.weather || '').slice(0, 32),
                moodName: String(input.moodName || '').slice(0, 32),
                weatherName: String(input.weatherName || '').slice(0, 32),
                location: String(input.location || '').slice(0, 80),
              },
              update: {
                // 标题：v1.1.3 起写独立列（此前写 metas.title，改完还要整段重写 JSON）
                ...(input.title === undefined ? {} : { title: String(input.title).trim().slice(0, 80) }),
                mediaKind,
                assetCount: finalFiles.length,
                charCount,
                ...(input.mood === undefined ? {} : { mood: String(input.mood).slice(0, 32) }),
                ...(input.weather === undefined ? {} : { weather: String(input.weather).slice(0, 32) }),
                ...(input.moodName === undefined ? {} : { moodName: String(input.moodName).slice(0, 32) }),
                ...(input.weatherName === undefined ? {} : { weatherName: String(input.weatherName).slice(0, 32) }),
                ...(input.location === undefined ? {} : { location: String(input.location).slice(0, 80) }),
              },
            },
          },
          // 附件与标签：传了才整体替换（先清后建，同一事务内完成）
          ...(assetIds && ordered
            ? {
                assets: {
                  deleteMany: {},
                  create: ordered.map((f, idx) => ({ fileId: f.id, sort: idx, usage: 'attachment' })),
                },
              }
            : {}),
          ...(tagRows
            ? {
                tags: {
                  deleteMany: {},
                  create: tagRows.map((t) => ({ tagId: t.id })),
                },
              }
            : {}),
        },
      });
      appLog.info('note', `编辑瞬间成功：${existing.id}`, `正文 ${charCount} 字 ｜ 附件 ${finalFiles.length} 个（${mediaKind}）`, ip);
      return { id: existing.id };
    } catch (err) {
      appLog.error('note', '编辑瞬间失败', `${(err as Error).message} ｜ ID=${existing.id}`, ip);
      return { error: `保存失败：${(err as Error).message}` };
    }
  }

  /* ========================================================================
   *  软删 / 恢复 / 彻底删除
   * ====================================================================== */
  private async findOwned(id: string, viewer: string, _isAdmin: boolean) {
    const row = await prisma.note.findUnique({ where: { id: String(id || '') } });
    if (!row) return { error: '瞬间不存在' as string };
    // v1.1.4：笔记私有 —— 恢复 / 彻底删除同样只允许作者本人
    if (row.author !== viewer) return { error: '无权操作他人的瞬间' as string };
    return { row };
  }

  async softDelete(id: string, viewer: string, isAdmin: boolean, ip: string) {
    const hit = await this.findOwned(id, viewer, isAdmin);
    if ('error' in hit) return { error: hit.error };
    await prisma.note.update({
      where: { id: hit.row!.id },
      data: { status: 'deleted', deletedAt: new Date() },
    });
    appLog.info('note', `瞬间移入回收站：${hit.row!.id}`, `作者=${hit.row!.author}`, ip);
    return { id: hit.row!.id };
  }

  async restore(id: string, viewer: string, isAdmin: boolean, ip: string) {
    const hit = await this.findOwned(id, viewer, isAdmin);
    if ('error' in hit) return { error: hit.error };
    await prisma.note.update({
      where: { id: hit.row!.id },
      data: { status: 'published', deletedAt: null },
    });
    appLog.info('note', `恢复瞬间：${hit.row!.id}`, `作者=${hit.row!.author}`, ip);
    return { id: hit.row!.id };
  }

  /**
   * 彻底删除。
   * 只删笔记本身（附件 / 标签关联由外键级联清理），**绝不动图床里的文件** ——
   * 那些文件可能还被别的笔记引用，或者用户就是要留着图床里的原图。
   */
  async purge(id: string, viewer: string, isAdmin: boolean, ip: string) {
    const hit = await this.findOwned(id, viewer, isAdmin);
    if ('error' in hit) return { error: hit.error };
    await prisma.note.delete({ where: { id: hit.row!.id } });
    appLog.info('note', `彻底删除瞬间：${hit.row!.id}`, `作者=${hit.row!.author}`, ip);
    return { ok: true };
  }

  /* ========================================================================
   *  标签候选（type='note'，与文件标签天然隔离）
   * ====================================================================== */
  /**
   * 标签候选（v1.1.4：按用户隔离）。
   * 笔记私有之后，标签候选也不能把别人笔记上用过的标签名漏出来 ——
   * 只统计「当前用户自己的笔记」关联到的标签，计数同样只算自己的笔记。
   */
  async tagCandidates(instanceId: string, viewer: string) {
    /*
     * v1.1.6：按「账户 + 实例」隔离。
     * 笔记标签的 scope 就是用户名（见 common/tags.ts tagScope），
     * 因此这里直接按作用域取，不再需要「靠自己的笔记反查」——
     * 也不存在两个账户共用一行标签的问题（改名 / 删除不会互相影响）。
     */
    const rows = await prisma.tag.findMany({
      where: {
        ...tagScope(instanceId, TAG_TYPE_NOTE, viewer),
        noteTags: { some: { note: { author: String(viewer || '') } } },
      },
      select: {
        id: true,
        name: true,
        noteTags: { select: { noteId: true }, where: { note: { author: String(viewer || '') } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows
      .map((r) => ({ id: r.id, name: r.name, count: (r.noteTags || []).length }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  /* ========================================================================
   *  标签管理（v1.1.2）—— 复刻图床「标签管理」的只读列表部分
   * ----------------------------------------------------------------------
   * 与图床那套的区别：笔记标签要能按「笔记分类」切换 —— 一个标签属于哪个分类，
   * 由「它被哪些分类的笔记使用」决定（不额外存 kind 列：
   *   · 同一标签可能同时用在瞬间和文章上，存单个 kind 会丢信息；
   *   · 用法派生出来的口径永远与列表一致，不会出现「标签说属于瞬间，但瞬间里筛不到」）。
   * 合并 / 拆分 / 改名 / 备注直接复用图床已有的 /api/tags/* 接口（已支持 type='note'）。
   * ====================================================================== */
  async tagAdmin(instanceId: string, kind: string, viewer: string) {
    // v1.1.6：只取「本账户 + 本实例」的笔记标签（scope = 用户名）
    const where: Record<string, unknown> = tagScope(instanceId, TAG_TYPE_NOTE, viewer);
    const tags = await prisma.tag.findMany({ where: where as any, orderBy: { createdAt: 'asc' } });
    if (!tags.length) return [];
    /*
     * v1.1.4：使用次数只统计当前用户自己的笔记 ——
     * 笔记私有后，「这个标签被用了 12 次」不能把别人的 12 次算进来，
     * 否则标签管理页会间接泄露别人有多少条笔记、用了哪些标签。
     */
    const links = await prisma.noteTag.findMany({
      where: {
        tagId: { in: tags.map((t) => t.id) },
        note: { author: String(viewer || '') },
      },
      select: { tagId: true, note: { select: { kind: true } } },
    });
    const byTag = new Map<string, Map<string, number>>();
    for (const l of links) {
      const noteKind = String(l.note?.kind || '');
      const bucket = byTag.get(l.tagId) || new Map<string, number>();
      bucket.set(noteKind, (bucket.get(noteKind) || 0) + 1);
      byTag.set(l.tagId, bucket);
    }
    const out = tags.map((t) => {
      const bucket = byTag.get(t.id) || new Map<string, number>();
      const kindCounts: Record<string, number> = {};
      for (const [k, v] of bucket.entries()) kindCounts[k] = v;
      return {
        id: t.id,
        name: t.name,
        // 全部使用次数（所有分类相加）
        count: Array.from(bucket.values()).reduce((a, b) => a + b, 0),
        // 每个分类下的使用次数 —— 前端「全部 / 瞬间 / 待办…」切换时直接读
        kindCounts,
        note: String(safeParse(t.metas).note || ''),
        creator: t.owner || '',
        createdAt: new Date(t.createdAt).getTime(),
      };
    })
      // 只保留自己用过的标签（计数为 0 = 从没在自己笔记里出现）
      .filter((t) => t.count > 0);
    if (!kind) return out;
    return out
      .filter((t) => (t.kindCounts[kind] || 0) > 0)
      .map((t) => ({ ...t, count: t.kindCounts[kind] }));
  }

  /* ========================================================================
   *  留言（v1.1.2）
   * ----------------------------------------------------------------------
   * 每条上限 500 字（同样只数汉字/字母/数字）；空留言拒绝。
   * 权限：能看见这条瞬间就能看见留言；留言只能由作者本人或管理员删除。
   * ====================================================================== */
  private async accessibleNote(id: string, viewer: string, _isAdmin: boolean, instanceId: string) {
    const select = { id: true, author: true, status: true, instanceId: true, metas: true };
    const own = await prisma.note.findFirst({
      where: {
        id: String(id || ''),
        instanceId: String(instanceId || ''),
        // v1.1.4：留言也只跟随作者本人（笔记私有的直接推论）
        author: String(viewer || ''),
      },
      select,
    });
    if (own) return own;
    /*
     * v1.1.9.4（需求）：广场里的公开笔记，任何登录账户都能看留言、也能留言；
     * 但删除留言仍由 deleteComment 的「本人或管理员」校验拦住。
     */
    return prisma.note.findFirst({
      where: {
        id: String(id || ''),
        status: 'published',
        visibility: 'public',
      },
      select,
    });
  }

  async listComments(input: { noteId: string; viewer: string; isAdmin: boolean; instanceId: string; page?: number; pageSize?: number }) {
    const note = await this.accessibleNote(input.noteId, input.viewer, input.isAdmin, input.instanceId);
    if (!note) return { error: '瞬间不存在或无权查看' };
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize) || 20)));
    const [total, rows] = await Promise.all([
      prisma.noteComment.count({ where: { noteId: note.id } }),
      prisma.noteComment.findMany({
        where: { noteId: note.id },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      // 与列表 / 详情返回的留言完全同形（shapeComments），前端一套渲染逻辑
      list: this.shapeComments(rows as any[], input.viewer),
    };
  }

  async addComment(input: { noteId: string; content: string; viewer: string; isAdmin: boolean; instanceId: string; ip: string }) {
    const note = await this.accessibleNote(input.noteId, input.viewer, input.isAdmin, input.instanceId);
    if (!note) return { error: '瞬间不存在或无权留言' };
    const content = String(input.content ?? '').trim();
    if (!content) return { error: '留言内容不能为空' };
    const charCount = countTextChars(content);
    if (charCount > MAX_COMMENT_CHARS) {
      return { error: `留言超出上限：当前 ${charCount} 字，上限 ${MAX_COMMENT_CHARS} 字（标点与符号不计入）` };
    }
    const created = await prisma.noteComment.create({
      data: {
        noteId: note.id,
        content,
        charCount,
        author: input.viewer,
        instanceId: note.instanceId || '',
      },
    });
    appLog.info('note', `瞬间留言：${note.id}`, `${charCount} 字 ｜ 留言人=${input.viewer}`, input.ip);
    // v1.1.2.3：直接把整条留言回给前端 —— 卡片内联展示时可以就地追加，
    // 不必为了看到自己刚发的留言再整页重载一次
    const [view] = this.shapeComments([created], input.viewer);
    return { id: created.id, comment: view };
  }

  async deleteComment(id: string, viewer: string, _isAdmin: boolean, ip: string) {
    const row = await prisma.noteComment.findUnique({ where: { id: String(id || '') } });
    if (!row) return { error: '留言不存在' };
    // v1.1.4：只能删自己的留言（笔记私有后，管理员也无权代删他人留言）
    if (row.author !== viewer) return { error: '无权删除他人的留言' };
    await prisma.noteComment.delete({ where: { id: row.id } });
    appLog.info('note', `删除瞬间留言：${row.noteId}`, `留言人=${row.author}`, ip);
    return { ok: true };
  }

  /* ========================================================================
   *  位置候选（v1.1.7）
   * ====================================================================== */
  /**
   * 取当前账户 + 当前实例下瞬间里出现过的 location。
   *
   * 为什么不再用前端 localStorage：
   *   旧实现把地点记在浏览器里，换设备 / 换浏览器就全丢，也不跟着实例隔离。
   *   地点本来就存在 note_moments.location 这一列，直接查库最准确，也顺带
   *   「换设备可用」。
   *
   * 顺序按**最近一次发布时间**去重（同一地点只留最新那条），所以列表是
   * 「最近用过的地点」而不是字典序。
   *
   * @param viewer     当前登录账户（只看自己的笔记）
   * @param instanceId 当前实例（空串 = 默认实例）
   * @param q          关键字（空 = 返回最近的若干条）
   */
  async pickLocations(viewer: string, instanceId: string, q: string) {
    const me = String(viewer || '');
    if (!me) return [];
    const keyword = String(q || '').trim();
    const rows = await prisma.noteMoment.findMany({
      where: {
        location: keyword ? { contains: keyword, mode: 'insensitive' } : { not: '' },
        note: {
          kind: 'moment',
          status: { not: 'deleted' },
          author: me,
          instanceId: String(instanceId || ''),
        },
      },
      select: { location: true, note: { select: { publishedAt: true, createdAt: true } } },
      orderBy: [{ note: { publishedAt: 'desc' } }, { note: { createdAt: 'desc' } }],
      // 只需「最近的一批」：200 条足够覆盖常用地点的去重结果，再多就是浪费
      take: 200,
    });
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      const v = String(r.location || '').trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
      if (out.length >= 20) break;
    }
    return out;
  }

  /* ========================================================================
   *  图床选文件器（只读，供「从图床选择」用）
   * ====================================================================== */
  async pickFiles(input: {
    search?: string;
    /** 搜索范围（all / title / tag / category / user / note / other），语义同图床管理 */
    searchScope?: string;
    type?: string;
    page?: number;
    pageSize?: number;
    instanceId?: string;
    viewer: string;
    isAdmin: boolean;
    /**
     * v1.1.3：「图床文件」模式的筛选参数 —— 与 /api/files/list 同名同义，
     * 由 common/file-filter.ts 统一求值，保证「一样的筛选范围」不是两套实现。
     */
    filterQuery?: Record<string, string | undefined>;
    /** 同时(all) / 任意(any)，语义同图床管理 */
    matchMode?: string;
  }) {
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize) || 24)));
    const where: Record<string, unknown> = {
      status: 'active',
      instanceId: String(input.instanceId || ''),
    };
    // v1.1.6：笔记是私有内容，选文件器只给「自己账户 + 当前实例」的文件 ——
    // 管理员同样不例外（原来 isAdmin 会跳过 uploader 过滤，能在选文件里看到别人的图床文件）。
    where.uploader = String(input.viewer || '');
    /*
     * 搜索范围（v1.1.3）—— 与 /api/files/list 的 searchType 完全同义：
     *   all（默认，兼容老请求） = 文件名 / 文件ID / MD5 / 分类 / 标签 / MIME / 上传者
     *   title = 文件名；tag = 标签名；category = 分类（folder）；
     *   user = 上传者；note = 备注；other = MD5 / MIME / IP
     * 不传 searchType 时仍按 all 处理，老调用方行为不变。
     */
    const kw = String(input.search || '').trim();
    if (kw) {
      const contains = { contains: kw, mode: 'insensitive' as const };
      const scope = String(input.searchScope || 'all').toLowerCase();
      const byScope: Record<string, unknown[]> = {
        title: [{ originalName: contains }, { name: contains }],
        tag: [{ tags: { some: { tag: { name: contains } } } }],
        category: [{ folder: contains }],
        user: [{ uploader: contains }],
        note: [{ note: contains }],
        other: [{ md5: contains }, { mime: contains }, { ip: { contains: kw } }],
      };
      where.OR =
        scope !== 'all' && byScope[scope]
          ? byScope[scope]
          : [
              { originalName: contains },
              { name: contains },
              { md5: contains },
              { folder: contains },
              { tags: { some: { tag: { name: contains } } } },
              { mime: contains },
              { uploader: contains },
            ];
    }
    const type = String(input.type || '');
    if (type === 'image') where.mime = { startsWith: 'image/' };
    else if (type === 'video') where.mime = { startsWith: 'video/' };
    else if (type === 'audio') where.mime = { startsWith: 'audio/' };
    /*
     * v1.1.2：新增「其他」—— 图 / 视 / 音之外的普通文件（pdf、压缩包、文本…）。
     * 用 NOT + 三个前缀表达，比列举 mime 白名单更稳（新格式自动归到「其他」）。
     */
    else if (type === 'other') {
      where.NOT = [
        { mime: { startsWith: 'image/' } },
        { mime: { startsWith: 'video/' } },
        { mime: { startsWith: 'audio/' } },
      ];
    }

    /*
     * ── v1.1.3：把筛选参数接进来 ────────────────────────────────────────
     * 有筛选值时才走「内存求值」这条路（和回收站同一套办法）：
     *   筛选条件里有一半是 metas JSON / 关联表（标签、渠道副本、备份、重定向…），
     *   用 Prisma where 表达既啰嗦又容易和 filterGroups 的口径对不上。
     *   统一取回（上限 2000，选文件器这种场景足够）→ filterGroups 求值 → 内存分页，
     *   保证和图床管理页「勾出来的结果完全一致」。
     * 没有筛选值时仍然走原来的库级分页，性能不受影响。
     */
    const filterOpts = parseFileFilterQuery(input.filterQuery || {});
    const mmRaw = String(input.matchMode || '').toLowerCase();
    const matchMode: 'all' | 'any' = mmRaw === 'any' || mmRaw === 'or' ? 'any' : 'all';
    if (!isEmptyFileFilter(filterOpts)) {
      const rows = await prisma.fileRecord.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        take: 2000,
        include: {
          copies: { include: { channel: true } },
          tags: { include: { tag: true } },
        },
      });
      // v1.1.6：筛「文件引用 / 文件共用」时按需重算统计，避免缓存滞后导致筛错
      if (filterOpts.hasRef || filterOpts.hasShare) {
        const statsMap = await syncFileStats(
          rows.map((r) => r.id),
          false,
        );
        for (const r of rows) {
          const st = statsMap.get(r.id);
          if (!st) continue;
          (r as unknown as { refCount: number }).refCount = st.ref;
          (r as unknown as { shareCount: number }).shareCount = st.share;
        }
      }
      const filtered = rows.filter((r) => passesFileFilters(r, filterOpts, matchMode));      const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
      return {
        total: filtered.length,
        page,
        pageSize,
        filtered: true,
        list: slice.map((r) => this.pickFileRow(r)),
      };
    }

    const [total, rows] = await Promise.all([
      prisma.fileRecord.count({ where: where as any }),
      prisma.fileRecord.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { ...FILE_SELECT, createdAt: true },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      list: rows.map((r) => this.pickFileRow(r)),
    };
  }

  /**
   * 选文件器单行 → 前端网格单元格。
   * 抽成一个方法，是因为「库级分页」和「内存筛选」两条路径必须返回**完全一样**的结构，
   * 否则前端会出现「筛了就少字段」这种鬼问题。
   */
  private pickFileRow(r: {
    id: string;
    name: string;
    originalName: string;
    mime: string;
    size: number;
    createdAt: Date | string;
  }) {
    const kind = mediaKindOfMime(r.mime);
    return {
      id: r.id,
      name: r.name,
      originalName: r.originalName,
      mime: r.mime,
      size: r.size,
      mediaKind: kind,
      url: fileUrlOf(r.name),
      thumbUrl: fileUrlOf(r.name, kind === 'image' ? 320 : undefined),
      createdAt: new Date(r.createdAt).getTime(),
      // 供前端显示类型角标（image / video / audio / txt / pdf / other）
      fileType: fileTypeOf(r.mime),
    };
  }

  /** 从 metas 里读扩展字段（保留给后续版本的封面/水印等） */
  readMetas(raw: unknown) {
    return safeParse(raw, {});
  }

  // ==========================================================
  //  笔记设置（v1.1.2.1）—— 按实例存，实例之间互不影响
  // ==========================================================

  /**
   * 设置表的键名。
   *
   * 口径是**实例**（不是用户）：同一个实例里的人看到同一套附件区布局，
   * 换到另一个实例就是另一套 —— 与文件、标签、笔记的隔离口径完全一致。
   * 空串代表默认实例，键名里用 `~default` 代替，避免出现 `note-settings:` 这种
   * 结尾是冒号的键（排查时容易看错）。
   */
  private noteSettingsKey(instanceId: string) {
    const id = String(instanceId || '').trim();
    return `note-settings:${id || '~default'}`;
  }

  /**
   * 读某个实例的笔记设置。
   * 没存过 / 存坏了都返回默认值 —— 前端永远拿到一份完整对象，不用自己兜底。
   */
  async getNoteSettings(instanceId: string) {
    const key = this.noteSettingsKey(instanceId);
    let raw = '';
    try {
      const row = await prisma.setting.findUnique({ where: { key } });
      raw = String(row?.value || '');
    } catch (e) {
      // 读失败不影响页面：退回默认值，但要留痕（否则用户会觉得「设置没生效」）
      appLog.warn('notes', `读取笔记设置失败（${key}）：${(e as Error)?.message || e}`);
    }
    return normalizeNoteSettings(safeParse(raw, {}));
  }

  /** 写设置：合并式保存（只覆盖传进来的分类，不会把别的分类清掉） */
  async saveNoteSettings(instanceId: string, patch: Record<string, unknown>) {
    const key = this.noteSettingsKey(instanceId);
    const current = await this.getNoteSettings(instanceId);
    const p = patch && typeof patch === 'object' ? patch : {};
    /*
     * v1.1.2.2：分类对象也要合并，不能整块替换。
     * 前端每次都会提交完整的 moment（所以以前没暴露问题），但只要有人只提交
     * 「改掉的那一项」，整块替换就会把没提交的项打回默认值 —— 这里按分类浅合并，
     * 让 PUT 真正具备「只改我传的字段」的语义。
     */
    const merged: Record<string, unknown> = { ...current, ...p };
    if (p.moment && typeof p.moment === 'object') {
      merged.moment = {
        ...(current.moment as unknown as Record<string, unknown>),
        ...(p.moment as Record<string, unknown>),
      };
    }
    // v1.1.7：通用设置同样按分类浅合并
    if (p.general && typeof p.general === 'object') {
      merged.general = {
        ...((current.general as unknown as Record<string, unknown>) || {}),
        ...(p.general as Record<string, unknown>),
      };
    }
    const next = normalizeNoteSettings(merged);
    /*
     * v1.1.8（笔记页背景图）：写了内容但一条合法地址都没有 —— 记一条警告。
     * 这类「设置了却没生效」最容易让人以为功能坏了（校验是静默丢弃非法地址，
     * 不报错是为了不因为一张图写错就把整份设置存不进去），所以留痕方便排查。
     */
    const rawBg = (merged.general as Record<string, unknown> | undefined)?.pageBg;
    if (rawBg !== undefined && String(rawBg).trim() && !next.general.pageBg) {
      appLog.warn('notes', '笔记页背景图地址全部无效，已忽略', String(rawBg).slice(0, 300));
    }
    const value = JSON.stringify(next);
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    appLog.info('notes', `笔记设置已更新（${key}）：${value}`);
    return next;
  }
}
