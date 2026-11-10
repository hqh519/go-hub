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
 *  4) 权限口径：
 *       · 必须登录（笔记是个人内容，匿名不可用）
 *       · 一律按 instanceId 收窄（与文件体系同一套实例隔离）
 *       · 普通用户只能看/改自己的；管理员在实例内可看全部（与文件管理一致）
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '../common/prisma';
import { appLog } from '../common/app-log';
import { findOrCreateTag } from '../common/tags';
import { fileTypeOf } from '../common/file-view';
import {
  DEFAULT_MOMENT_MAX_CHARS,
  MAX_ASSETS_PER_NOTE,
  NOTE_VISIBILITIES,
  countTextChars,
  fileUrlOf,
  mediaKindOf,
  mediaKindOfMime,
  normalizeTagNames,
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
  /** 瞬间的「标题」（存 metas.title；进入编辑页自动填日期时间，用户可改） */
  title: string;
  content: string;
  coverFileId: string;
  visibility: string;
  status: string;
  author: string;
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
    location: string;
  } | null;
  assets: NoteAssetView[];
  tags: { id: string; name: string }[];
}

export interface ListInput {
  kind?: string;
  mediaKind?: string;
  search?: string;
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

export interface MomentInput {
  /** 标题（进入编辑页自动填日期时间；存进 metas.title，瞬间不单独占列） */
  title?: string;
  content?: string;
  mood?: string;
  weather?: string;
  location?: string;
  visibility?: string;
  assetIds?: string[];
  tagNames?: string[];
  instanceId?: string;
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
  private async toListItem(row: any): Promise<NoteListItem> {
    const assets: NoteAssetView[] = [];
    const map = await this.resolveFiles((row.assets || []).map((a: any) => a.fileId));
    for (const a of row.assets || []) {
      const hit = map.get(a.fileId);
      if (hit) assets.push(hit);
    }
    return {
      id: row.id,
      kind: row.kind,
      title: String(safeParse(row.metas).title || ''),
      content: row.content || '',
      coverFileId: row.coverFileId || '',
      visibility: row.visibility || 'private',
      status: row.status,
      author: row.author || '',
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
            location: row.moment.location || '',
          }
        : null,
      assets,
      tags: (row.tags || []).map((t: any) => ({ id: t.tag?.id || t.tagId, name: t.tag?.name || '' })).filter((t: any) => t.name),
    };
  }

  /* ========================================================================
   *  列表
   * ====================================================================== */
  private buildWhere(input: ListInput): Record<string, unknown> {
    const where: Record<string, unknown> = {
      // 实例隔离：空串 = 默认实例（与文件体系一致，不是「不过滤」）
      instanceId: String(input.instanceId || ''),
    };
    // 「全部」= 不传 kind（不要写成 kind='moment'，否则以后加类型要改所有调用点）
    if (input.kind) where.kind = String(input.kind);
    // 回收站：status=deleted 才看回收站，否则只看正常内容
    where.status = input.status === 'deleted' ? 'deleted' : input.status === 'all' ? { not: 'deleted' } : 'published';
    // 普通用户只能看自己的；管理员在实例内看全部
    if (!input.isAdmin) where.author = String(input.viewer || '');
    // 搜索：正文 + 标题（标题存在 metas JSON 里，直接对整段 JSON 做 LIKE 即可命中 title 值；
    // 不用额外加 title 列，保持「瞬间不单独占列」的瘦表设计）
    if (input.search) {
      const s = String(input.search);
      where.OR = [
        { content: { contains: s, mode: 'insensitive' } },
        { metas: { contains: s, mode: 'insensitive' } },
      ];
    }
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
    const sortKey = SORTABLE[String(input.sort || '')] || 'createdAt';
    const order: 'asc' | 'desc' = String(input.order || 'desc') === 'asc' ? 'asc' : 'desc';

    const [total, rows] = await Promise.all([
      prisma.note.count({ where: where as any }),
      prisma.note.findMany({
        where: where as any,
        orderBy: { [sortKey]: order } as any,
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
    const list = rows.map((row: any) => {
      const assets: NoteAssetView[] = [];
      for (const a of row.assets || []) {
        const hit = fileMap.get(a.fileId);
        if (hit) assets.push(hit);
      }
      return this.shape(row, assets);
    });

    return { total, page, pageSize, list };
  }

  /** 纯同步的行 → 契约映射（附件由调用方传入，便于批量复用） */
  private shape(row: any, assets: NoteAssetView[]): NoteListItem {
    return {
      id: row.id,
      kind: row.kind,
      title: String(safeParse(row.metas).title || ''),
      content: row.content || '',
      coverFileId: row.coverFileId || '',
      visibility: row.visibility || 'private',
      status: row.status,
      author: row.author || '',
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
            location: row.moment.location || '',
          }
        : null,
      assets,
      tags: (row.tags || [])
        .map((t: any) => ({ id: t.tag?.id || t.tagId, name: t.tag?.name || '' }))
        .filter((t: any) => t.name),
    };
  }

  /* ========================================================================
   *  详情
   * ====================================================================== */
  async detail(id: string, viewer: string, isAdmin: boolean, instanceId: string) {
    const row = await prisma.note.findFirst({
      where: {
        id: String(id || ''),
        instanceId: String(instanceId || ''),
        ...(isAdmin ? {} : { author: String(viewer || '') }),
      },
      include: {
        moment: true,
        assets: { orderBy: { sort: 'asc' } },
        tags: { include: { tag: true } },
      },
    });
    if (!row) return null;
    return this.toListItem(row);
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
          metas: JSON.stringify({ title: String(input.title || '').trim().slice(0, 80) }),
          moment: {
            create: {
              mediaKind,
              assetCount: ordered.length,
              charCount,
              mood: String(input.mood || '').slice(0, 32),
              weather: String(input.weather || '').slice(0, 32),
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
    if (!isAdmin && existing.author !== viewer) return { error: '无权编辑他人的瞬间' };
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

    try {
      await prisma.note.update({
        where: { id: existing.id },
        data: {
          content,
          visibility,
          // 封面：保持/更新为第一张图
          coverFileId: finalFiles.find((f) => mediaKindOfMime(f.mime) === 'image')?.id || '',
          version: { increment: 1 },
          // 标题存 metas.title（瞬间不单独占列；后续文章版本才有 title 列）
          ...(input.title === undefined
            ? {}
            : { metas: JSON.stringify({ ...safeParse(existing.metas), title: String(input.title).trim().slice(0, 80) }) }),
          moment: {
            // 老数据可能没有扩展行（极端情况）→ upsert 兜住
            upsert: {
              create: {
                mediaKind,
                assetCount: finalFiles.length,
                charCount,
                mood: String(input.mood || '').slice(0, 32),
                weather: String(input.weather || '').slice(0, 32),
                location: String(input.location || '').slice(0, 80),
              },
              update: {
                mediaKind,
                assetCount: finalFiles.length,
                charCount,
                ...(input.mood === undefined ? {} : { mood: String(input.mood).slice(0, 32) }),
                ...(input.weather === undefined ? {} : { weather: String(input.weather).slice(0, 32) }),
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
  private async findOwned(id: string, viewer: string, isAdmin: boolean) {
    const row = await prisma.note.findUnique({ where: { id: String(id || '') } });
    if (!row) return { error: '瞬间不存在' as string };
    if (!isAdmin && row.author !== viewer) return { error: '无权操作他人的瞬间' as string };
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
  async tagCandidates(instanceId: string) {
    const rows = await prisma.tag.findMany({
      where: { instanceId: String(instanceId || ''), type: 'note' },
      select: { id: true, name: true, _count: { select: { noteTags: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows
      .map((r) => ({ id: r.id, name: r.name, count: r._count.noteTags }))
      .sort((a, b) => b.count - a.count);
  }

  /* ========================================================================
   *  图床选文件器（只读，供「从图床选择」用）
   * ====================================================================== */
  async pickFiles(input: {
    search?: string;
    type?: string;
    page?: number;
    pageSize?: number;
    instanceId?: string;
    viewer: string;
    isAdmin: boolean;
  }) {
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize) || 24)));
    const where: Record<string, unknown> = {
      status: 'active',
      instanceId: String(input.instanceId || ''),
    };
    // 与「文件管理」同一口径：普通用户只看到自己的上传
    if (!input.isAdmin) where.uploader = String(input.viewer || '');
    if (input.search) {
      where.OR = [
        { originalName: { contains: String(input.search), mode: 'insensitive' } },
        { name: { contains: String(input.search), mode: 'insensitive' } },
      ];
    }
    const type = String(input.type || '');
    if (type === 'image') where.mime = { startsWith: 'image/' };
    else if (type === 'video') where.mime = { startsWith: 'video/' };
    else if (type === 'audio') where.mime = { startsWith: 'audio/' };

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
      list: rows.map((r) => {
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
      }),
    };
  }

  /** 从 metas 里读扩展字段（保留给后续版本的封面/水印等） */
  readMetas(raw: unknown) {
    return safeParse(raw, {});
  }
}
