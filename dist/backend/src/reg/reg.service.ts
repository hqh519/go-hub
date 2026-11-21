import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '../common/prisma';
import { TAG_TYPE_REGISTER, findOrCreateTag, tagScope } from '../common/tags';
import { fileUrlOf, mediaKindOfMime } from '../notes/notes.util';

/**
 * v1.3.5.3 登记功能（P0 + P1）
 * ---------------------------------------------------------------------------
 * 「一套原子数据 + 按形态聚合的统计」：
 *   · RegTracker  登记项（= 用户口中的「条目」），锁定类型 / 单位 / 分母；
 *   · RegEntry    一次登记（原子数据，统计只读这张表；v1.3.6 起软删除进回收站）；
 *
 * v1.3.6：移除 RegUnit 自定义单位表 —— 表单里的单位/分母直接来自条目，这张表没有实际用途。
 *
 * v1.3.5.7：条目回归登记自己的独立表 ——
 *   · 「条目」= RegTracker，是登记的身份表，**不再写 markers**。改名 / 改类型 /
 *     改单位 / 改分母 / 合并都在这一张表上做，关联记录通过 trackerId 自动跟着变；
 *   · RegEntry 不再保存 markerName / markerId 快照 —— 名称只有 trackerId 一个真源；
 *   · 「标签」仍归主表：身份存 tags（type='register'），关联走 reg_entry_tags。
 *
 * v1.3.5.8：条目是口径的唯一真源，记录上的口径快照列（unit / portion /
 *   direction / note / status）全部删除；对外接口仍在 entryView 里按 tracker
 *   回填 unit / portion。
 *
 * v1.3.5.9：性质（direction）从条目搬回每条记录 —— 同一条目可以有收有支，
 *   条目管理里不再改性质，改在登记表单里逐条选。
 */

/** 六种基础形态 */
export const REG_VALUE_TYPES = ['stock', 'flow', 'count', 'duration', 'ratio', 'price'];
/** v1.3.5.8：币种多一个「无」（空串），并作为默认 */
export const REG_CURRENCIES = ['', 'CNY', 'USD'];
/** 横轴可选的四个时间字段 */
export const REG_AXIS_X = ['occurredAt', 'startAt', 'dueAt', 'createdAt'];
/** 纵轴：数值 = Σ(金额×份量)；份量 = Σ(份量) */
export const REG_AXIS_Y = ['value', 'quantity'];

/** v1.3.5.7：所有文本字段一律去首尾空格（表单 / CSV 导入 / 接口三种入口都盖到） */
function text(v: unknown, max = 120): string {
  return String(v === undefined || v === null ? '' : v).trim().slice(0, max);
}

function num(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function dateOf(v: unknown): Date | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? new Date(v) : null;
  const s = String(v).trim();
  if (!s) return null;
  /* v1.3.5.8：前端统一按毫秒时间戳传（字符串形态），
     Date.parse('1794000000000') 会当成纪元年份而返回 NaN，必须先识别纯数字 */
  if (/^-?\d{10,}$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? new Date(n) : null;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function parseArr(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw || '[]'));
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch (e) {
    return [];
  }
}

/** 时间分桶键：day / month / year（v1.3.5.8 起不再提供「按周」） */
/** v1.3.6：ISO 周（周一为一周起点，跨年按 ISO 规则归属） */
function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((t.getTime() - start.getTime()) / 86400000) + 1) / 7);
  return { year, week };
}

function bucketKey(d: Date, bucket: string): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (bucket === 'year') return `${y}`;
  if (bucket === 'quarter') return `${y}-Q${Math.floor(d.getMonth() / 3) + 1}`;
  if (bucket === 'month') return `${y}-${m}`;
  if (bucket === 'week') {
    const w = isoWeek(d);
    return `${w.year}-W${String(w.week).padStart(2, '0')}`;
  }
  return `${y}-${m}-${day}`;
}

/** 桶的中文展示（补零，和键一一对应） */
function bucketLabel(key: string): string {
  return key;
}

/** v1.3.5.9：附件视图（与瞬间的 NoteAssetView 同形，前端可直接渲染缩略图） */
export interface RegAttachmentView {
  fileId: string;
  url: string;
  thumbUrl: string;
  name: string;
  originalName: string;
  mime: string;
  size: number;
  mediaKind: 'image' | 'video' | 'audio' | 'file';
}

export interface RegLegendInput {
  /** v1.3.5.10：系列显示名（默认项 / 项1 …）；空则按序号生成 */
  name?: string;
  /** v1.3.5.10：「默认项」= 总范围里的发生对象 / 关联对象 / 地点 / 标签，可以没有条目 */
  isDefault?: boolean;
  trackerId?: string;
  trackerName?: string;
  placeName?: string;
  subjectName?: string;
  relatedName?: string;
  tags?: string[];
}

export interface RegEntryInput {
  trackerId?: string;
  trackerName?: string;
  instanceId?: string;
  title?: string;
  /** 兼容旧调用（CSV 导入 / 老前端）：等同 trackerName */
  markerName?: string;
  event?: string;
  occurredAt?: number | string;
  startAt?: number | string | null;
  dueAt?: number | string | null;
  subjectName?: string;
  relatedName?: string;
  placeName?: string;
  amount?: number | string;
  /** v1.3.5.8：份量（原「数量」，留空按 1 提交） */
  quantity?: number | string;
  currency?: string;
  /** v1.3.5.8：性质，0 无 / 1 收入 / -1 支出；v1.3.5.9 起落每条记录 */
  direction?: number;
  tags?: string[];
  attachments?: string[];
  docNoteId?: string;
  valueType?: string;
  unit?: string;
  /** v1.3.5.7：分母（复合单位 `/` 之后的部分） */
  portion?: string;
  unitKind?: string;
  precision?: number;
  scene?: string;
  /** 预留字段（P3 未启用）：预算额度（0 = 不设） */
  budget?: number;
  /** 预留字段（P3 未启用）：是否共享给同实例成员（只读） */
  shared?: boolean;
}

@Injectable()
export class RegService {
  private readonly logger = new Logger('RegService');

  /** 把标签名数组写进 tags 主表并重建关联（entryId 维度全量覆盖） */
  async syncEntryTags(entryId: string, names: string[], instanceId: string, owner: string) {
    const tagIds: string[] = [];
    for (const raw of Array.isArray(names) ? names.slice(0, 20) : []) {
      const tag = await findOrCreateTag(String(raw || ''), instanceId, owner, TAG_TYPE_REGISTER);
      if (tag?.id) tagIds.push(tag.id);
    }
    const uniq = Array.from(new Set(tagIds));
    await prisma.regEntryTag.deleteMany({ where: { entryId } });
    if (!uniq.length) return;
    await prisma.regEntryTag.createMany({
      data: uniq.map((tagId) => ({ entryId, tagId })),
      skipDuplicates: true,
    });
  }

  /** 当前账户下已存在的登记标签（主表口径，用于候选） */
  async listTagNames(instanceId: string, owner: string) {
    const rows = await prisma.tag.findMany({
      where: { ...tagScope(instanceId, TAG_TYPE_REGISTER, owner) },
      select: { name: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return rows.map((r) => r.name).filter(Boolean);
  }

  /* ── 登记项 ─────────────────────────────────────────────── */

  async listTrackers(owner: string, instanceId: string) {
    const me = String(owner || '');
    const where = { owner: me, instanceId: String(instanceId || ''), archived: false };
    const rows = await prisma.regTracker.findMany({ where, orderBy: [{ updatedAt: 'desc' }] });
    if (!rows.length) return [];
    const counts = await prisma.regEntry.groupBy({
      by: ['trackerId'],
      where: { trackerId: { in: rows.map((r) => r.id) }, deletedAt: null },
      _count: { _all: true },
    });
    const map = new Map(counts.map((c) => [c.trackerId, c._count._all]));
    return rows.map((r) => ({
      ...r,
      count: map.get(r.id) || 0,
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
    }));
  }

  /**
   * 取或建条目。
   *   · 带 trackerId（表单里选中已有条目）→ 直接用这一条，口径全部锁定；
   *   · 只带名称 → 同一账户 / 实例下同名即复用，否则新建；
   *   · 已存在时不覆盖口径（需求：同一条目的类型 / 单位 / 分母不可在表单里改，
   *     要改请去「登记设置 → 条目管理」，那里改的是根源）。
   */
  async ensureTracker(input: RegEntryInput, owner: string) {
    const instanceId = String(input.instanceId || '');
    const id = String(input.trackerId || '');
    if (id) {
      const hit = await prisma.regTracker.findFirst({ where: { id, owner } });
      if (hit) return { row: hit, locked: true };
    }
    const name = String(input.trackerName || input.markerName || '').trim().slice(0, 80);
    if (!name) return { error: '条目名称不能为空' as string };
    const existed = await prisma.regTracker.findFirst({ where: { owner, instanceId, name } });
    if (existed) {
      const patch: Record<string, unknown> = {};
      if (input.scene !== undefined) patch.scene = String(input.scene).slice(0, 24);
      if (Object.keys(patch).length) {
        const row = await prisma.regTracker.update({ where: { id: existed.id }, data: patch });
        return { row, locked: true };
      }
      return { row: existed, locked: true };
    }
    const valueType = REG_VALUE_TYPES.includes(String(input.valueType || '')) ? String(input.valueType) : 'flow';
    const row = await prisma.regTracker.create({
      data: {
        owner,
        instanceId,
        name,
        scene: String(input.scene || '').slice(0, 24),
        valueType,
        unit: text(input.unit, 24),
        portion: text(input.portion, 32),
        unitKind: String(input.unitKind || '').slice(0, 24),
        precision: Math.max(0, Math.min(6, Math.round(num(input.precision, 2)))),
      },
    });
    return { row, locked: false };
  }

  /**
   * v1.3.5.7：条目管理 —— 改名称 / 类型 / 单位 / 分母。
   *
   * 这里改的是「根源」：名称一改，所有关联记录按 trackerId 取到的名字自动变；
   * 单位 / 分母同理（记录上不再存快照，只有条目这一份）。
   * v1.3.5.9：性质已不属于条目（每条登记自带），这里不再接受 direction。
   */
  async updateTracker(
    id: string,
    input: {
      name?: string; valueType?: string; unit?: string; portion?: string;
      scene?: string; note?: string; precision?: number;
    },
    owner: string,
  ) {
    const existed = await prisma.regTracker.findFirst({ where: { id: String(id || ''), owner } });
    if (!existed) return { error: '条目不存在或无权修改' as string };
    const name = input.name === undefined ? existed.name : String(input.name).trim().slice(0, 80);
    if (!name) return { error: '条目名称不能为空' as string };
    if (name !== existed.name) {
      const dup = await prisma.regTracker.findFirst({
        where: { owner: existed.owner, instanceId: existed.instanceId, name, NOT: { id: existed.id } },
        select: { id: true },
      });
      if (dup) return { error: `已存在同名条目「${name}」，请改用合并` as string };
    }
    const valueType = input.valueType === undefined
      ? existed.valueType
      : (REG_VALUE_TYPES.includes(String(input.valueType)) ? String(input.valueType) : existed.valueType);
    const unit = input.unit === undefined ? existed.unit : String(input.unit).trim().slice(0, 24);
    const portion = input.portion === undefined ? existed.portion : String(input.portion).trim().slice(0, 32);
    const row = await prisma.regTracker.update({
      where: { id: existed.id },
      data: {
        name,
        valueType,
        unit,
        portion,
        ...(input.scene === undefined ? {} : { scene: String(input.scene).slice(0, 24) }),
        ...(input.note === undefined ? {} : { note: String(input.note).slice(0, 200) }),
        ...(input.precision === undefined ? {} : { precision: Math.max(0, Math.min(6, Math.round(num(input.precision, 2)))) }),
      },
    });
    return { id: row.id, name: row.name, unit: row.unit, portion: row.portion, valueType: row.valueType };
  }

  /**
   * v1.3.5.7：合并条目 —— 把 sources 的记录全部并到 target，然后删掉 sources。
   * v1.3.5.8：合并前必须校验「类型 / 单位 / 分母」完全一致（性质不参与），
   * 因为合并后这些口径只剩目标条目一份，不一致就等同于篡改历史语义。
   */
  async mergeTrackers(targetId: string, sourceIds: string[], owner: string) {
    const target = await prisma.regTracker.findFirst({ where: { id: String(targetId || ''), owner } });
    if (!target) return { error: '目标条目不存在或无权修改' as string };
    const ids = (Array.isArray(sourceIds) ? sourceIds : [])
      .map((x) => String(x || ''))
      .filter((x) => x && x !== target.id);
    if (!ids.length) return { error: '请选择要合并的条目' as string };
    const sources = await prisma.regTracker.findMany({ where: { id: { in: ids }, owner } });
    if (!sources.length) return { error: '要合并的条目不存在或无权修改' as string };
    const bad = sources.filter((s) => s.valueType !== target.valueType || s.unit !== target.unit || s.portion !== target.portion);
    if (bad.length) {
      const names = bad.map((s) => `「${s.name}」`).join('、');
      return { error: `${names} 的类型 / 单位 / 分母与目标条目不统一，无法合并（可先改到一致再合并）` as string };
    }
    const keep = sources.map((s) => s.id);
    const moved = await prisma.regEntry.updateMany({
      where: { trackerId: { in: keep } },
      data: { trackerId: target.id },
    });
    await prisma.regTracker.deleteMany({ where: { id: { in: keep } } });
    return { id: target.id, merged: keep.length, moved: moved.count };
  }

  /**
   * v1.3.5.8：删除条目 —— 只有「没有任何关联记录」时才允许删。
   * 有数据的条目请改用合并，避免统计口径凭空消失。
   */
  async removeTracker(id: string, owner: string) {
    const existed = await prisma.regTracker.findFirst({ where: { id: String(id || ''), owner } });
    if (!existed) return { error: '条目不存在或无权删除' as string };
    const count = await prisma.regEntry.count({ where: { trackerId: existed.id } });
    if (count > 0) return { error: `条目「${existed.name}」下还有 ${count} 条登记，不能删除（可先合并到其它条目）` as string };
    await prisma.regTracker.delete({ where: { id: existed.id } });
    return { id: existed.id };
  }

  /* ── 记录 ───────────────────────────────────────────────── */

  async listEntries(q: {
    owner: string;
    instanceId: string;
    trackerId?: string;
    trackerName?: string;
    from?: string;
    to?: string;
    keyword?: string;
    /** v1.3.5.6：按标签筛选，走 reg_entry_tags 关联表 */
    tag?: string;
    /** v1.3.6：true = 回收站（只取已软删除的） */
    trash?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Math.floor(num(q.page, 1)));
    const pageSize = Math.min(100, Math.max(1, Math.floor(num(q.pageSize, 20))));
    const where: Record<string, unknown> = {
      owner: String(q.owner || ''),
      instanceId: String(q.instanceId || ''),
      /* v1.3.6：正常列表排除回收站，回收站只看已删除 */
      deletedAt: q.trash ? { not: null } : null,
    };
    if (q.trackerId) where.trackerId = String(q.trackerId);
    else if (q.trackerName) where.tracker = { name: String(q.trackerName) };
    const tag = String(q.tag || '').trim();
    if (tag) where.tagLinks = { some: { tag: { name: tag } } };
    const from = dateOf(q.from);
    const to = dateOf(q.to);
    if (from || to) where.occurredAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const kw = String(q.keyword || '').trim();
    if (kw) {
      where.OR = [
        { title: { contains: kw } },
        { event: { contains: kw } },
        { tracker: { name: { contains: kw } } },
        { placeName: { contains: kw } },
        { subjectName: { contains: kw } },
      ];
    }
    const [total, rows] = await Promise.all([
      prisma.regEntry.count({ where: where as any }),
      prisma.regEntry.findMany({
        where: where as any,
        include: {
          tracker: { select: { id: true, name: true, valueType: true, unit: true, portion: true } },
          tagLinks: { select: { tag: { select: { name: true } } } },
        },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    /* v1.3.5.9：列表要直接显示附件缩略图 —— 一次把这一页用到的文件全查出来 */
    const views = await this.resolveAttachments(
      rows.flatMap((r) => parseArr(r.attachments)),
    );
    /* v1.3.5.10：卡片要显示「上次 4500 元 / 43 天前」—— 一次把这几条条目的历史取回来 */
    const prevs = await this.previousEntries(rows, String(q.owner || ''), String(q.instanceId || ''));
    return {
      total,
      page,
      pageSize,
      list: rows.map((r) => this.entryView(r, views, prevs)),
    };
  }

  /**
   * v1.3.5.7：条目名称、单位、分母都从 tracker 关联取（记录里不再存名称快照）。
   * v1.3.5.8：unit / portion 从 tracker 回填，对外响应保持原样。
   * v1.3.5.9：direction 改回读记录自己的列；附件一并给出可显示的视图
   *   （流水账页与表单缩略图都靠它，前端不用再单独查文件）。
   */
  /**
   * v1.3.5.10：每条记录「同条目的上一条」。
   * 只查当前这一页涉及的条目，每个条目最多取 500 条近期记录，内存里配对。
   */
  private async previousEntries(rows: any[], owner: string, instanceId: string) {
    const map = new Map<string, { occurredAt: number; value: number; unit: string; portion: string }>();
    if (!rows.length) return map;
    const ids = Array.from(new Set(rows.map((r) => String(r.trackerId || '')).filter(Boolean)));
    if (!ids.length) return map;
    /* 取到本页最晚那条为止的全部历史，再按时间比出「上一条」（只取 1000 条，够覆盖常规使用） */
    const latest = rows.reduce((max, r) => Math.max(max, (r.occurredAt as Date).getTime()), 0);
    const history = await prisma.regEntry.findMany({
      where: { trackerId: { in: ids }, owner: String(owner || ''), instanceId, deletedAt: null, occurredAt: { lte: new Date(latest) } },
      orderBy: { occurredAt: 'desc' },
      take: 1000,
      select: { id: true, trackerId: true, occurredAt: true, amount: true, quantity: true, tracker: { select: { unit: true, portion: true } } },
    });
    for (const r of rows) {
      const at = (r.occurredAt as Date).getTime();
      const prev = history.find((h) => h.trackerId === r.trackerId && h.id !== r.id && h.occurredAt.getTime() < at);
      if (!prev) continue;
      map.set(String(r.id), {
        occurredAt: prev.occurredAt.getTime(),
        value: num(prev.amount) * (prev.quantity === 0 ? 1 : num(prev.quantity, 1)),
        unit: String((prev as any).tracker?.unit || ''),
        portion: String((prev as any).tracker?.portion || ''),
      });
    }
    return map;
  }

  private entryView(r: any, views?: Map<string, RegAttachmentView>, prevs?: Map<string, any>) {
    const tracker = r.tracker || null;
    const tagLinks = Array.isArray(r.tagLinks) ? r.tagLinks : [];
    const ids = parseArr(r.attachments);
    const map = views || null;
    return {
      ...r,
      tracker,
      trackerName: tracker ? String(tracker.name || '') : '',
      unit: tracker ? String(tracker.unit || '') : '',
      portion: tracker ? String(tracker.portion || '') : '',
      direction: Number(r.direction || 0),
      occurredAt: r.occurredAt ? r.occurredAt.getTime() : 0,
      startAt: r.startAt ? r.startAt.getTime() : null,
      dueAt: r.dueAt ? r.dueAt.getTime() : null,
      createdAt: r.createdAt ? r.createdAt.getTime() : 0,
      updatedAt: r.updatedAt ? r.updatedAt.getTime() : 0,
      tags: tagLinks.map((l: any) => String(l?.tag?.name || '')).filter(Boolean),
      attachments: ids,
      /* 文件可能已被删掉：只回还活着的那几条，顺序按 attachments 原序 */
      attachmentViews: map
        ? ids.map((id) => map.get(id)).filter(Boolean)
        : [],
      /* v1.3.5.10：上一条（同条目、更早）的数值与时间，卡片上显示「上次…」 */
      prev: prevs && prevs.get(String(r.id)) ? prevs.get(String(r.id)) : null,
    };
  }

  /**
   * v1.3.5.9：表单打开时补附件缩略图。
   * 只认当前账户自己上传的文件 —— 登记是私有内容，不能让任意 id 探到别人的文件。
   */
  async attachmentViews(ids: string[], owner: string) {
    const uniq = Array.from(new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))).slice(0, 60);
    if (!uniq.length) return [];
    const rows = await prisma.fileRecord.findMany({
      where: { id: { in: uniq }, uploader: String(owner || '') },
      select: { id: true, name: true, originalName: true, mime: true, size: true },
    });
    const map = new Map<string, RegAttachmentView>();
    for (const r of rows) {
      const kind = mediaKindOfMime(r.mime);
      map.set(r.id, {
        fileId: r.id,
        url: fileUrlOf(r.name),
        thumbUrl: fileUrlOf(r.name, kind === 'image' ? 480 : undefined),
        name: r.name,
        originalName: r.originalName,
        mime: r.mime,
        size: r.size,
        mediaKind: kind,
      });
    }
    return uniq.map((id) => map.get(id)).filter(Boolean);
  }

  /** 把 files.id 解析成前端可直接渲染的附件视图（一次查询，供列表 / 表单复用） */
  private async resolveAttachments(ids: string[]): Promise<Map<string, RegAttachmentView>> {
    const uniq = Array.from(new Set((ids || []).map(String).filter(Boolean)));
    const map = new Map<string, RegAttachmentView>();
    if (!uniq.length) return map;
    const rows = await prisma.fileRecord.findMany({
      where: { id: { in: uniq } },
      select: { id: true, name: true, originalName: true, mime: true, size: true },
    });
    for (const r of rows) {
      const kind = mediaKindOfMime(r.mime);
      map.set(r.id, {
        fileId: r.id,
        url: fileUrlOf(r.name),
        thumbUrl: fileUrlOf(r.name, kind === 'image' ? 480 : undefined),
        name: r.name,
        originalName: r.originalName,
        mime: r.mime,
        size: r.size,
        mediaKind: kind,
      });
    }
    return map;
  }

  async createEntry(input: RegEntryInput, owner: string) {
    const tracker = await this.ensureTracker(input, owner);
    if ('error' in tracker && tracker.error) return { error: tracker.error };
    const row = tracker.row!;
    const occurredAt = dateOf(input.occurredAt) || new Date();
    const amount = num(input.amount, 0);
    /* v1.3.5.8：份量留空也要按 1 落库（需求点名的行为） */
    const quantity = input.quantity === undefined || input.quantity === null || input.quantity === ''
      ? 1
      : num(input.quantity, 1);
    if (!Number.isFinite(amount)) return { error: '登记数值必须是可运算的数字' };
    if (!Number.isFinite(quantity) || quantity === 0) return { error: '份量必须是可运算的非零数字' };
    /* v1.3.5.9：性质跟着记录走；和数值符号冲突时以性质为准 */
    const direction = [-1, 0, 1].includes(Math.round(num(input.direction, 0)))
      ? Math.round(num(input.direction, 0))
      : 0;
    const signedAmount = direction === 1 ? Math.abs(amount) : (direction === -1 ? -Math.abs(amount) : amount);

    const created = await prisma.regEntry.create({
      data: {
        trackerId: row.id,
        owner,
        instanceId: String(input.instanceId || ''),
        title: text(input.title, 120),
        event: text(input.event, 1000),
        occurredAt,
        startAt: dateOf(input.startAt),
        dueAt: dateOf(input.dueAt),
        subjectName: text(input.subjectName, 40),
        relatedName: text(input.relatedName, 40),
        placeName: text(input.placeName, 80),
        amount: signedAmount,
        quantity,
        direction,
        currency: REG_CURRENCIES.includes(String(input.currency || '')) ? String(input.currency || '') : '',
        attachments: JSON.stringify(Array.isArray(input.attachments) ? input.attachments.map(String).slice(0, 30) : []),
        docNoteId: String(input.docNoteId || ''),
      },
    });
    /* v1.3.5.7：标签只写 tags 主表 + 关联表（记录上的 JSON 快照列已删除） */
    await this.syncEntryTags(
      created.id,
      Array.isArray(input.tags) ? input.tags.map(String) : [],
      String(input.instanceId || ''),
      owner,
    ).catch(() => undefined);
    // 登记项最后使用时间前移，列表按「最近登记」排序更符合直觉
    await prisma.regTracker.update({ where: { id: row.id }, data: { updatedAt: new Date() } }).catch(() => undefined);
    return { id: created.id, trackerId: row.id, locked: 'locked' in tracker ? tracker.locked : false };
  }

  async updateEntry(id: string, input: RegEntryInput, owner: string) {
    const existed = await prisma.regEntry.findFirst({ where: { id: String(id || ''), owner: String(owner || '') } });
    if (!existed) return { error: '登记不存在或无权修改' as string };
    /* v1.3.5.7：允许在编辑时换条目（编号跟着 trackerId 走，名称自动取新条目的） */
    let nextTrackerId = existed.trackerId;
    if (input.trackerId || input.trackerName) {
      const t = await this.ensureTracker(input, owner);
      if ('error' in t && t.error) return { error: t.error as string };
      nextTrackerId = (t as any).row.id;
    }
    const occurredAt = input.occurredAt === undefined ? existed.occurredAt : dateOf(input.occurredAt) || existed.occurredAt;
    /* v1.3.5.9：性质变了要同时把数值符号掰过来（性质 1 只允许正、-1 只允许负） */
    const direction = input.direction === undefined
      ? Number(existed.direction || 0)
      : ([-1, 0, 1].includes(Math.round(num(input.direction, existed.direction)))
        ? Math.round(num(input.direction, existed.direction))
        : Number(existed.direction || 0));
    const nextAmount = input.amount === undefined ? num(existed.amount) : num(input.amount, num(existed.amount));
    const signedAmount = direction === 1
      ? Math.abs(nextAmount)
      : (direction === -1 ? -Math.abs(nextAmount) : nextAmount);
    const updated = await prisma.regEntry.update({
      where: { id: existed.id },
      data: {
        trackerId: nextTrackerId,
        ...(input.title === undefined ? {} : { title: text(input.title, 120) }),
        ...(input.event === undefined ? {} : { event: text(input.event, 1000) }),
        occurredAt,
        ...(input.startAt === undefined ? {} : { startAt: dateOf(input.startAt) }),
        ...(input.dueAt === undefined ? {} : { dueAt: dateOf(input.dueAt) }),
        ...(input.subjectName === undefined ? {} : { subjectName: text(input.subjectName, 40) }),
        ...(input.relatedName === undefined ? {} : { relatedName: text(input.relatedName, 40) }),
        ...(input.placeName === undefined ? {} : { placeName: text(input.placeName, 80) }),
        ...(input.amount === undefined && input.direction === undefined ? {} : { amount: signedAmount }),
        ...(input.direction === undefined ? {} : { direction }),
        ...(input.quantity === undefined || input.quantity === ''
          ? {}
          : { quantity: num(input.quantity, existed.quantity) }),
        ...(input.currency === undefined
          ? {}
          : { currency: REG_CURRENCIES.includes(String(input.currency)) ? String(input.currency) : existed.currency }),
        ...(input.attachments === undefined ? {} : { attachments: JSON.stringify(Array.isArray(input.attachments) ? input.attachments.map(String).slice(0, 30) : []) }),
        ...(input.docNoteId === undefined ? {} : { docNoteId: String(input.docNoteId) }),
      },
    });
    if (input.tags !== undefined) {
      await this.syncEntryTags(
        updated.id,
        Array.isArray(input.tags) ? input.tags.map(String) : [],
        String(input.instanceId || existed.instanceId || ''),
        owner,
      ).catch(() => undefined);
    }
    return { id: updated.id };
  }

  /**
   * v1.3.6：删除改为软删除（进回收站），可恢复 / 彻底删除。
   * 统计、候选、列表默认都排除 deletedAt 非空的记录。
   */
  async removeEntry(id: string, owner: string) {
    const existed = await prisma.regEntry.findFirst({ where: { id: String(id || ''), owner: String(owner || ''), deletedAt: null } });
    if (!existed) return { error: '登记不存在或无权删除' as string };
    await prisma.regEntry.update({ where: { id: existed.id }, data: { deletedAt: new Date() } });
    return { id: existed.id, trashed: true };
  }

  /** v1.3.6：从回收站恢复 */
  async restoreEntry(id: string, owner: string) {
    const existed = await prisma.regEntry.findFirst({ where: { id: String(id || ''), owner: String(owner || ''), deletedAt: { not: null } } });
    if (!existed) return { error: '回收站里没有这条登记' as string };
    await prisma.regEntry.update({ where: { id: existed.id }, data: { deletedAt: null } });
    return { id: existed.id };
  }

  /** v1.3.6：彻底删除（物理删除，关联标签一并清理） */
  async purgeEntry(id: string, owner: string) {
    const existed = await prisma.regEntry.findFirst({ where: { id: String(id || ''), owner: String(owner || ''), deletedAt: { not: null } } });
    if (!existed) return { error: '回收站里没有这条登记' as string };
    await prisma.regEntry.delete({ where: { id: existed.id } });
    return { id: existed.id };
  }

  /**
   * v1.3.6：导出当前实例（当前账户）的全部登记为 CSV。
   * 列顺序按需求固定；时间统一 YYYY-MM-DD HH:mm:ss，字段全部加引号转义。
   */
  async exportCsv(owner: string, instanceId: string) {
    const rows = await prisma.regEntry.findMany({
      where: { owner: String(owner || ''), instanceId: String(instanceId || ''), deletedAt: null },
      include: {
        tracker: { select: { name: true, valueType: true, unit: true, portion: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });
    const typeLabels: Record<string, string> = {
      stock: '存量', flow: '流水', count: '计数', duration: '时长', ratio: '比例', price: '单价',
    };
    const dirLabels: Record<number, string> = { 0: '无', 1: '收入', [-1]: '支出' };
    const c = (v: unknown) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
    const dt = (d: Date | null | undefined) => {
      if (!d) return '';
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    const heads = ['标题', '详情', '地点', '发生时间', '起始时间', '截止时间', '登记时间', '条目名称', '类型名称', '性质名称', '登记数值', '份量', '单位', '分母', '币种', '发生对象', '关联对象'];
    const lines = [heads.map(c).join(',')];
    for (const r of rows) {
      const tk = (r as any).tracker || {};
      lines.push([
        c(r.title), c(r.event), c(r.placeName), c(dt(r.occurredAt)), c(dt(r.startAt)), c(dt(r.dueAt)),
        c(dt(r.createdAt)), c(tk.name || ''), c(typeLabels[String(tk.valueType || '')] || String(tk.valueType || '')),
        c(dirLabels[Number(r.direction) || 0] || '无'), c(r.amount), c(r.quantity),
        c(tk.unit || ''), c(tk.portion || ''), c(r.currency), c(r.subjectName), c(r.relatedName),
      ].join(','));
    }
    /* BOM：Excel 直接双击打开不乱码 */
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  /* ── 统计（P1 / v1.3.5.8 多系列） ────────────────────────── */

  /** 横轴时间字段（非法值一律回落到发生时间） */
  private axisField(v: unknown): string {
    const s = String(v || '');
    return REG_AXIS_X.includes(s) ? s : 'occurredAt';
  }

  /** 某条记录在横轴上的时间（startAt / dueAt 可能为空） */
  private axisDate(r: any, field: string): Date | null {
    const v = r[field];
    return v instanceof Date ? v : null;
  }

  /** 纵轴口径：数值 = amount × 份量；份量 = 份量 */
  private metricOf(r: any, axisY: string): number {
    const qty = r.quantity === 0 || r.quantity === undefined || r.quantity === null ? 1 : num(r.quantity, 1);
    return axisY === 'quantity' ? qty : num(r.amount) * qty;
  }

  /**
   * 统计（一次查库，内存里按「总范围 → 图例」分派）。
   *
   * 总范围配置 = 实例 + 账户口径（scope）+ 类型范围 + 条目 + 时间范围（按横轴字段筛）
   * 默认项     = 总范围配置 + 发生人 / 关联人 / 地点 / 标签（数据卡片同此口径）
   * 图例       = 默认项 + 自定义项；自定义项只受「总范围配置」约束，
   *              不再继承默认项的附属条件（v1.3.5.10）
   */
  async stats(q: {
    owner: string;
    instanceId: string;
    scope?: string;
    /** v1.3.5.8：类型范围（登记类型），空 = 全部 */
    type?: string;
    trackerId?: string;
    trackerName?: string;
    /** v1.3.5.6：按标签筛选 */
    tag?: string;
    /** v1.3.5.10：总范围的人物 / 地点 / 标签（多条标签按「且」处理） */
    subjectName?: string;
    relatedName?: string;
    placeName?: string;
    tags?: string[] | string;
    from?: string;
    to?: string;
    bucket?: string;
    /** v1.3.5.4（P2）：year = 追加去年同期对比 */
    compare?: string;
    /** v1.3.5.8：横轴 / 纵轴 / 图例 */
    axisX?: string;
    axisY?: string;
    legends?: RegLegendInput[] | string;
  }) {
    const instanceId = String(q.instanceId || '');
    const axisX = this.axisField(q.axisX);
    const axisY = REG_AXIS_Y.includes(String(q.axisY || '')) ? String(q.axisY) : 'value';
    const bucket = ['day', 'week', 'month', 'quarter', 'year'].includes(String(q.bucket || '')) ? String(q.bucket) : 'month';

    const baseWhere: Record<string, unknown> = { instanceId, deletedAt: null };
    if (String(q.scope || 'me') !== 'all') baseWhere.owner = String(q.owner || '');
    /**
     * 总范围配置 = 实例 + 账户口径 + 登记类型 + 时间段（条目属于默认项配置）。
     * 类型限定大类，条目再收窄到某一条，两者可以同时给。
     */
    const type = String(q.type || '').trim();
    const trackerWhere: Record<string, unknown> = {};
    if (type && REG_VALUE_TYPES.includes(type)) trackerWhere.valueType = type;
    if (q.trackerName) trackerWhere.name = String(q.trackerName);
    if (Object.keys(trackerWhere).length) baseWhere.tracker = trackerWhere;
    if (String(q.tag || '').trim()) {
      baseWhere.tagLinks = { some: { tag: { name: String(q.tag).trim() } } };
    }
    const from = dateOf(q.from);
    const to = dateOf(q.to);

    /* 总范围配置（类型 + 时间段 + 用户）：自定义图例项只认这一层 */
    const totalWhere: Record<string, unknown> = { ...baseWhere };
    if (from || to) totalWhere[axisX] = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    /**
     * v1.3.5.10：默认项 = 总范围配置 + 条目 + 附属条件（发生人 / 关联人 / 地点 / 标签）。
     * 卡片与默认项走这一层；自定义图例项只用 totalWhere，避免被默认项的条目 / 条件连带过滤。
     */
    const defaultWhere: Record<string, unknown> = { ...totalWhere };
    if (q.trackerId) defaultWhere.trackerId = String(q.trackerId);
    if (String(q.subjectName || '').trim()) defaultWhere.subjectName = String(q.subjectName).trim();
    if (String(q.relatedName || '').trim()) defaultWhere.relatedName = String(q.relatedName).trim();
    if (String(q.placeName || '').trim()) defaultWhere.placeName = String(q.placeName).trim();
    const totalTags = (Array.isArray(q.tags) ? q.tags : String(q.tags || '').split(','))
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .slice(0, 10);
    if (totalTags.length) {
      const and = Array.isArray(defaultWhere.AND) ? defaultWhere.AND : [];
      for (const t of totalTags) and.push({ tagLinks: { some: { tag: { name: t } } } });
      defaultWhere.AND = and;
    }
    const hasDefaultExtra = Object.keys(defaultWhere).length !== Object.keys(totalWhere).length;

    const rows = await prisma.regEntry.findMany({
      where: defaultWhere as any,
      include: {
        tracker: { select: { id: true, name: true, valueType: true, unit: true, portion: true } },
        tagLinks: { select: { tag: { select: { name: true } } } },
      },
      orderBy: { occurredAt: 'asc' },
    });
    /* 设了默认项附属条件时，图表另取一份「只按总范围」的数据 */
    const chartRows = hasDefaultExtra
      ? await prisma.regEntry.findMany({
        where: totalWhere as any,
        include: {
          tracker: { select: { id: true, name: true, valueType: true, unit: true, portion: true } },
          tagLinks: { select: { tag: { select: { name: true } } } },
        },
        orderBy: { occurredAt: 'asc' },
      })
      : rows;

    /* ── 卡片（默认项口径，跟纵轴） ── */
    let total = 0;
    let quantity = 0;
    let max = Number.NEGATIVE_INFINITY;
    let min = Number.POSITIVE_INFINITY;
    /* 旧图表（圆环 / 条形 / 雷达 / 分布）仍用「数值」口径 + 发生时间 */
    const buckets = new Map<string, { key: string; sum: number; metric: number; count: number; quantity: number }>();
    const owners = new Map<string, { owner: string; sum: number; count: number }>();
    const trackerMap = new Map<string, { name: string; sum: number; count: number }>();
    const weekday = [0, 0, 0, 0, 0, 0, 0];
    const values: number[] = [];
    /* 单位是否混用：混用时卡片不再挂一个会误导人的单位 */
    const unitKeys = new Set<string>();
    for (const r of rows) {
      const m = this.metricOf(r, axisY);
      const v = num(r.amount) * (r.quantity === 0 ? 1 : num(r.quantity, 1));
      total += m;
      quantity += num(r.quantity, 1);
      if (m > max) max = m;
      if (m < min) min = m;
      const k = bucketKey(r.occurredAt, bucket);
      const b = buckets.get(k) || { key: k, sum: 0, metric: 0, count: 0, quantity: 0 };
      b.sum += v;
      b.metric += m;
      b.count += 1;
      b.quantity += num(r.quantity, 1);
      buckets.set(k, b);
      const o = owners.get(r.owner) || { owner: r.owner, sum: 0, count: 0 };
      o.sum += v;
      o.count += 1;
      owners.set(r.owner, o);
      const tkey = String((r as any).tracker?.name || r.trackerId || '未命名');
      const t = trackerMap.get(tkey) || { name: tkey, sum: 0, count: 0 };
      t.sum += v;
      t.count += 1;
      trackerMap.set(tkey, t);
      /* 周一 = 0 … 周日 = 6（国内习惯，雷达图按这个顺序渲染） */
      weekday[((r.occurredAt as Date).getDay() + 6) % 7] += v;
      values.push(v);
      const tk = (r as any).tracker || {};
      unitKeys.add(`${tk.unit || ''}|${tk.portion || ''}`);
    }
    const series = Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
    for (let i = 1; i < series.length; i += 1) {
      const prev = series[i - 1].sum;
      const cur = series[i].sum;
      (series[i] as any).diff = cur - prev;
      (series[i] as any).pct = prev ? ((cur - prev) / Math.abs(prev)) * 100 : null;
    }

    const derive = this.buildDerive(rows, series, from, to, axisY);
    const compare = String(q.compare || '') === 'year'
      ? await this.buildYoy(defaultWhere, axisX, from, to, bucket, total, axisY)
      : null;

    const legends = this.normalizeLegends(q.legends);
    /**
     * 默认项没写条目时，用总范围里选中的条目兜底。
     * 总范围配置这一层的查询已不再带条目（要让自定义项能取到别的条目），
     * 若不兜底，默认项会把同类型的全部条目混进来。
     */
    const defaultLegend = legends.find((l) => l.isDefault);
    if (defaultLegend && !defaultLegend.trackerId && !defaultLegend.trackerName && q.trackerId) {
      defaultLegend.trackerId = String(q.trackerId);
    }
    /* v1.3.5.10：图表用「只按总范围配置」的数据，自定义图例项不再被默认项附属条件过滤；
       没有传图例时退回按默认项范围出图（兼容旧调用） */
    const chart = this.buildChart(legends.length ? chartRows : rows, { axisX, axisY, bucket, from, to, legends });
    /* 只有「默认项」时是全部条目一起统计，单位不一致就不显示单位（否则会误导） */
    if (!legends.some((l) => !l.isDefault) && unitKeys.size > 1) {
      chart.unit = '';
      chart.portion = '';
    }

    const byTracker = Array.from(trackerMap.values()).sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));
    const byWeekday = weekday.map((sum, i) => ({
      weekday: i,
      label: ['一', '二', '三', '四', '五', '六', '日'][i],
      sum,
    }));
    const firstTracker = (rows[0] as any)?.tracker || null;

    return {
      total,
      count: rows.length,
      quantity,
      avg: rows.length ? total / rows.length : 0,
      max: rows.length ? max : 0,
      min: rows.length ? min : 0,
      series,
      byOwner: Array.from(owners.values()).sort((a, b) => b.sum - a.sum),
      byTracker,
      byWeekday,
      histogram: this.buildHistogram(values),
      /* 概览卡片的单位按「总范围」算：单位混用时不挂单位，免得把 分 和 元 加在一起还标个元 */
      unit: unitKeys.size > 1 ? '' : (firstTracker ? String(firstTracker.unit || '') : ''),
      portion: unitKeys.size > 1 ? '' : (firstTracker ? String(firstTracker.portion || '') : ''),
      currency: (rows[0] as any)?.currency || '',
      bucket,
      axisX,
      axisY,
      from: from ? from.getTime() : null,
      to: to ? to.getTime() : null,
      scope: String(q.scope || 'me'),
      type,
      derive,
      compare,
      /* v1.3.5.8：多图例图表（柱形 / 折线用这一份） */
      chart,
    };
  }

  /** 图例入参归一（容忍 JSON 字符串 / 空值 / 非法项） */
  private normalizeLegends(raw: RegLegendInput[] | string | undefined): RegLegendInput[] {
    let arr: any = raw;
    if (typeof raw === 'string') {
      try { arr = JSON.parse(raw); } catch (e) { arr = []; }
    }
    if (!Array.isArray(arr)) return [];
    return arr
      /* v1.3.6：默认项 + 最多 5 条自定义 = 6 条 */
      .slice(0, 6)
      .map((x) => ({
        name: String(x?.name || ''),
        isDefault: !!x?.isDefault,
        trackerId: String(x?.trackerId || ''),
        trackerName: String(x?.trackerName || ''),
        placeName: String(x?.placeName || ''),
        subjectName: String(x?.subjectName || ''),
        relatedName: String(x?.relatedName || ''),
        tags: Array.isArray(x?.tags) ? x.tags.map(String).filter(Boolean).slice(0, 10) : [],
      }))
      /* 默认项允许没有条目（它就是总范围本身）；自定义项必须有条目 */
      .filter((x) => x.isDefault || x.trackerId || x.trackerName);
  }

  /**
   * 多系列图表数据。
   *   · 没有图例时按「全部条目」出一条线，页面一进来就能看到趋势；
   *   · 横轴字段为空（起始 / 截止时间没填）的记录无法落点到时间轴，直接跳过；
   *   · 设了起止时间就按周期补齐连续的时间桶，折线不会断成虚线。
   */
  private buildChart(
    rows: any[],
    opt: { axisX: string; axisY: string; bucket: string; from: Date | null; to: Date | null; legends: RegLegendInput[] },
  ) {
    const { axisX, axisY, bucket, from, to, legends } = opt;
    const groups = legends.length ? legends : [null as unknown as RegLegendInput];

    const keyOf = (r: any) => {
      const d = this.axisDate(r, axisX);
      return d ? bucketKey(d, bucket) : '';
    };

    /* 每条图例自己的时间桶累加 */
    const per: { name: string; condition: string; map: Map<string, number>; total: number; count: number; unit: string; portion: string }[] = [];
    groups.forEach((lg, i) => {
      const tags = (lg?.tags || []).map((t) => String(t).trim()).filter(Boolean);
      const hit = rows.filter((r) => {
        const t = (r as any).tracker || {};
        if (lg) {
          if (lg.trackerId && String(t.id || '') !== lg.trackerId) return false;
          if (!lg.trackerId && lg.trackerName && String(t.name || '') !== lg.trackerName) return false;
          if (lg.placeName && String(r.placeName || '') !== lg.placeName) return false;
          if (lg.subjectName && String(r.subjectName || '') !== lg.subjectName) return false;
          if (lg.relatedName && String(r.relatedName || '') !== lg.relatedName) return false;
          if (tags.length) {
            const own = (Array.isArray(r.tagLinks) ? r.tagLinks : [])
              .map((l: any) => String(l?.tag?.name || ''))
              .filter(Boolean);
            if (!tags.every((x) => own.includes(x))) return false;
          }
        }
        return !!this.axisDate(r, axisX);
      });
      const map = new Map<string, number>();
      let sum = 0;
      for (const r of hit) {
        const k = keyOf(r);
        if (!k) continue;
        const m = this.metricOf(r, axisY);
        map.set(k, (map.get(k) || 0) + m);
        sum += m;
      }
      const cond: string[] = [];
      if (lg) {
        /* 默认项可以没有条目 —— 它是「总范围里的全部条目」再加人物 / 地点 / 标签 */
        if (lg.trackerId || lg.trackerName) {
          const t = (hit[0] as any)?.tracker;
          cond.push(String(t?.name || lg.trackerName || '条目'));
        } else {
          cond.push('全部条目');
        }
        if (lg.placeName) cond.push(`地点=${lg.placeName}`);
        if (lg.subjectName) cond.push(`发生对象=${lg.subjectName}`);
        if (lg.relatedName) cond.push(`关联对象=${lg.relatedName}`);
        if (tags.length) cond.push(`标签=${tags.join('+')}`);
      } else {
        cond.push('全部条目');
      }
      per.push({
        name: lg?.name
          ? String(lg.name)
          : (legends.length ? `项${i + 1}` : '全部'),
        condition: cond.join(' · '),
        map,
        total: sum,
        count: hit.length,
        unit: String(((hit[0] as any)?.tracker || {}).unit || ''),
        portion: String(((hit[0] as any)?.tracker || {}).portion || ''),
      });
    });

    /**
     * labels（横轴）：按各图例项实际出现的桶取并集（默认项一定会参与）。
     * v1.3.5.10：默认项加了附属条件后，时间节点会变少 —— 横轴必须跟着筛选后的
     * 数据重新生成，不能继续沿用总范围里的全部节点。
     * 自定义图例项若有额外的桶也一并纳入，避免它的数据被裁掉；
     * 设了起止时间则补齐连续桶，折线不会断成虚线。
     */
    let keys: string[] = [];
    if (from && to) keys = this.fillBuckets(from, to, bucket);
    if (!keys.length) {
      const set = new Set<string>();
      for (const g of per) for (const k of g.map.keys()) set.add(k);
      keys = Array.from(set).sort((a, b) => a.localeCompare(b));
    }

    const labels = keys.map((k) => bucketLabel(k));
    const datasets = per.map((g) => ({
      name: g.name,
      condition: g.condition,
      total: g.total,
      count: g.count,
      data: keys.map((k) => g.map.get(k) || 0),
    }));

    /**
     * 展示单位取「第 1 条图例」的条目口径 —— 多图例已被强制要求
     * 与第 1 条的单位 / 分母一致，所以一条就代表全部系列。
     */
    const unit = per[0]?.unit || '';
    const portion = per[0]?.portion || '';
    return { labels, datasets, axisX, axisY, bucket, unit, portion };
  }

  /** 按周期补齐 [from, to] 之间的连续桶（上限 400 个，避免把浏览器画死） */
  private fillBuckets(from: Date, to: Date, bucket: string): string[] {
    const out: string[] = [];
    if (bucket === 'year') {
      for (let y = from.getFullYear(); y <= to.getFullYear() && out.length < 400; y += 1) {
        out.push(String(y));
      }
      return out;
    }
    if (bucket === 'quarter') {
      const cur = new Date(from.getFullYear(), Math.floor(from.getMonth() / 3) * 3, 1);
      const end = new Date(to.getFullYear(), Math.floor(to.getMonth() / 3) * 3, 1);
      while (cur <= end && out.length < 400) {
        out.push(`${cur.getFullYear()}-Q${Math.floor(cur.getMonth() / 3) + 1}`);
        cur.setMonth(cur.getMonth() + 3);
      }
      return out;
    }
    if (bucket === 'week') {
      /* 从 from 所在周的周一开始，每 7 天一个桶 */
      const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      const day = cur.getDay() || 7;
      cur.setDate(cur.getDate() - (day - 1));
      while (cur <= to && out.length < 400) {
        out.push(bucketKey(cur, 'week'));
        cur.setDate(cur.getDate() + 7);
      }
      return out;
    }
    if (bucket === 'month') {
      const cur = new Date(from.getFullYear(), from.getMonth(), 1);
      const end = new Date(to.getFullYear(), to.getMonth(), 1);
      while (cur <= end && out.length < 400) {
        out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
        cur.setMonth(cur.getMonth() + 1);
      }
      return out;
    }
    const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    while (cur <= end && out.length < 400) {
      out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  /**
   * v1.3.5.6：数值分布（直方图）。
   * 分箱数按样本量取平方根并夹在 4~10 之间 —— 太少看不出形状，太多全是空柱。
   */
  private buildHistogram(values: number[]) {
    if (!values.length) return [] as { from: number; to: number; count: number }[];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return [{ from: min, to: max, count: values.length }];
    const bins = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(values.length))));
    const step = (max - min) / bins;
    const out = Array.from({ length: bins }, (_, i) => ({
      from: min + i * step,
      to: min + (i + 1) * step,
      count: 0,
    }));
    for (const v of values) {
      let i = Math.floor((v - min) / step);
      if (i >= bins) i = bins - 1;
      if (i < 0) i = 0;
      out[i].count += 1;
    }
    return out;
  }

  /** P2：派生指标 —— 单价 / 结存累计 / 相邻间隔 / 消耗速度 */
  private buildDerive(rows: any[], series: any[], from: Date | null, to: Date | null, axisY = 'value') {
    let sumValue = 0;
    let sumQty = 0;
    let sumMetric = 0;
    for (const r of rows) {
      sumValue += num(r.amount) * (r.quantity === 0 ? 1 : num(r.quantity, 1));
      sumQty += num(r.quantity, 1);
      sumMetric += this.metricOf(r, axisY);
    }
    const unitPrice = sumQty > 0 ? sumValue / sumQty : null;

    /* v1.3.5.10：结存跟随「数据源」累计（原来固定累计数值，切份量时不会变） */
    let acc = 0;
    const balance = series.map((b) => {
      acc += num((b as any).metric !== undefined ? (b as any).metric : b.sum);
      return { key: b.key, value: acc };
    });

    const intervals: { from: number; to: number; days: number }[] = [];
    for (let i = 1; i < rows.length; i += 1) {
      const a = rows[i - 1].occurredAt as Date;
      const b = rows[i].occurredAt as Date;
      const days = Math.round((b.getTime() - a.getTime()) / 86400000);
      if (days >= 0) intervals.push({ from: a.getTime(), to: b.getTime(), days });
    }
    const avgDays = intervals.length ? intervals.reduce((s, x) => s + x.days, 0) / intervals.length : null;

    const start = from || (rows.length ? (rows[0].occurredAt as Date) : null);
    const end = to || (rows.length ? (rows[rows.length - 1].occurredAt as Date) : null);
    const spanDays = start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1) : 0;
    const perDay = spanDays ? sumMetric / spanDays : null;

    return {
      unitPrice,
      balance,
      interval: { avgDays, count: intervals.length, list: intervals.slice(-30).reverse() },
      speed: { perDay, spanDays },
    };
  }

  /** P2：同比 —— 去年同期同区间再算一次（区间跟着横轴字段走） */
  private async buildYoy(
    baseWhere: Record<string, unknown>,
    axisX: string,
    from: Date | null,
    to: Date | null,
    bucket: string,
    currentTotal: number,
    axisY: string,
  ) {
    const now = new Date();
    const prevFrom = from
      ? new Date(from.getFullYear() - 1, from.getMonth(), from.getDate(), from.getHours(), from.getMinutes())
      : new Date(now.getFullYear() - 1, 0, 1);
    const prevTo = to
      ? new Date(to.getFullYear() - 1, to.getMonth(), to.getDate(), to.getHours(), to.getMinutes())
      : new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 23, 59, 59);
    const where: Record<string, unknown> = { ...baseWhere, [axisX]: { gte: prevFrom, lte: prevTo } };
    const rows = await prisma.regEntry.findMany({
      where: where as any,
      orderBy: { occurredAt: 'asc' },
    });
    const buckets = new Map<string, { key: string; sum: number; count: number }>();
    let total = 0;
    for (const r of rows) {
      const d = this.axisDate(r, axisX);
      if (!d) continue;
      const v = this.metricOf(r, axisY);
      total += v;
      const k = bucketKey(d, bucket);
      const b = buckets.get(k) || { key: k, sum: 0, count: 0 };
      b.sum += v;
      b.count += 1;
      buckets.set(k, b);
    }
    return {
      from: prevFrom.getTime(),
      to: prevTo.getTime(),
      total,
      count: rows.length,
      pct: total ? ((currentTotal - total) / Math.abs(total)) * 100 : null,
      series: Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  /* ── P2：报表保存 ─────────────────────────────────────── */

  async listReports(owner: string, instanceId: string) {
    const rows = await prisma.regReport.findMany({
      where: { owner: String(owner || ''), instanceId: String(instanceId || '') },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => {
      let query: Record<string, unknown> = {};
      try { query = JSON.parse(String(r.query || '{}')); } catch (e) { query = {}; }
      return { ...r, query, createdAt: r.createdAt.getTime(), updatedAt: r.updatedAt.getTime() };
    });
  }

  async saveReport(
    input: { id?: string; name?: string; query?: Record<string, unknown>; instanceId?: string },
    owner: string,
  ) {
    const name = String(input.name || '').trim().slice(0, 60);
    if (!name) return { error: '报表名称不能为空' as string };
    const instanceId = String(input.instanceId || '');
    const payload = JSON.stringify(input.query || {});
    if (input.id) {
      const existed = await prisma.regReport.findFirst({ where: { id: String(input.id), owner } });
      if (!existed) return { error: '报表不存在' as string };
      const row = await prisma.regReport.update({
        where: { id: existed.id },
        data: { name, query: payload },
      });
      return { id: row.id };
    }
    const row = await prisma.regReport.create({
      data: { owner, instanceId, name, query: payload },
    });
    return { id: row.id };
  }

  async removeReport(id: string, owner: string) {
    const existed = await prisma.regReport.findFirst({ where: { id: String(id || ''), owner } });
    if (!existed) return { error: '报表不存在' as string };
    await prisma.regReport.delete({ where: { id: existed.id } });
    return { id: existed.id };
  }

  /* ── 候选值（地点 / 发生人 / 关联人 / 图例筛选项） ──────── */

  /**
   * v1.3.5.7：候选值统一从「记录 + 条目表」两处取 ——
   * 记录给这个账户实际用过的值，条目表给登记口径里定下的单位 / 分母
   * （刚建好还没录入数据的条目也能在表单里选到）。
   * v1.3.5.8：单位 / 分母现在只在条目表上，不再读记录。
   */
  async candidates(owner: string, instanceId: string) {
    const [rows, trackers] = await Promise.all([
      prisma.regEntry.findMany({
        where: { owner: String(owner || ''), instanceId: String(instanceId || ''), deletedAt: null },
        select: { placeName: true, subjectName: true, relatedName: true },
        orderBy: { occurredAt: 'desc' },
        take: 500,
      }),
      prisma.regTracker.findMany({
        where: { owner: String(owner || ''), instanceId: String(instanceId || ''), archived: false },
        select: { unit: true, portion: true },
        take: 500,
      }),
    ]);
    const collect = (key: 'placeName' | 'subjectName' | 'relatedName') => {
      const set = new Set<string>();
      for (const r of rows) {
        const v = String((r as any)[key] || '').trim();
        if (v) set.add(v);
      }
      return Array.from(set).slice(0, 50);
    };
    const units = new Set<string>();
    const portions = new Set<string>();
    for (const t of trackers) {
      if (t.unit) units.add(String(t.unit).trim());
      if (t.portion) portions.add(String(t.portion).trim());
    }
    return {
      places: collect('placeName'),
      subjects: collect('subjectName'),
      related: collect('relatedName'),
      units: Array.from(units).filter(Boolean).slice(0, 50),
      portions: Array.from(portions).filter(Boolean).slice(0, 50),
      tags: await this.listTagNames(instanceId, owner),
    };
  }

  /**
   * v1.3.5.8：图例筛选项 —— 某个条目（在总范围之内）实际用过的
   * 地点 / 发生人 / 关联人 / 标签，供「图例项设置」的四个下拉框加载。
   */
  async legendOptions(q: {
    owner: string;
    instanceId: string;
    scope?: string;
    trackerId?: string;
    trackerName?: string;
    axisX?: string;
    from?: string;
    to?: string;
  }) {
    const instanceId = String(q.instanceId || '');
    const axisX = this.axisField(q.axisX);
    const where: Record<string, unknown> = { instanceId, deletedAt: null };
    if (String(q.scope || 'me') !== 'all') where.owner = String(q.owner || '');
    if (q.trackerId) where.trackerId = String(q.trackerId);
    else if (q.trackerName) where.tracker = { name: String(q.trackerName) };
    const from = dateOf(q.from);
    const to = dateOf(q.to);
    if (from || to) where[axisX] = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const rows = await prisma.regEntry.findMany({
      where: where as any,
      select: {
        placeName: true,
        subjectName: true,
        relatedName: true,
        tagLinks: { select: { tag: { select: { name: true } } } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 1000,
    });
    const places = new Set<string>();
    const subjects = new Set<string>();
    const related = new Set<string>();
    const tags = new Set<string>();
    for (const r of rows) {
      if (r.placeName) places.add(String(r.placeName));
      if (r.subjectName) subjects.add(String(r.subjectName));
      if (r.relatedName) related.add(String(r.relatedName));
      for (const l of Array.isArray(r.tagLinks) ? r.tagLinks : []) {
        const n = String((l as any)?.tag?.name || '');
        if (n) tags.add(n);
      }
    }
    return {
      places: Array.from(places).slice(0, 100),
      subjects: Array.from(subjects).slice(0, 100),
      related: Array.from(related).slice(0, 100),
      tags: Array.from(tags).slice(0, 100),
    };
  }

  /* ── Excel / CSV 导入（P1） ─────────────────────────────── */

  /**
   * 批量导入：前端把 Excel / CSV 解析成 [{...}] 后提交，
   * 后端逐条走 createEntry，返回成功 / 失败明细（不整批回滚，便于用户修正后重导）。
   * 必填：trackerName（条目，兼容旧列名 markerName）、occurredAt（时间）、amount（数值）；
   * 可选：quantity / unit / partial / title / event / subjectName / relatedName / placeName。
   */
  async importRows(rows: RegEntryInput[], owner: string, instanceId: string) {
    const ok: string[] = [];
    const failed: { row: number; message: string }[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i] || {};
      const res = await this.createEntry({ ...r, instanceId }, owner);
      if ('error' in res && res.error) failed.push({ row: i + 1, message: String(res.error) });
      else ok.push(String((res as { id: string }).id));
      if (ok.length + failed.length >= 500) break; // 单次上限，避免一次导入拖死
    }
    return { ok: ok.length, failed };
  }
}
