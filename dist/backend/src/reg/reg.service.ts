import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { prisma } from '../common/prisma';
import { TAG_TYPE_REGISTER, findOrCreateTag, tagScope } from '../common/tags';

/**
 * v1.3.5.3 登记功能（P0 + P1）
 * ---------------------------------------------------------------------------
 * 「一套原子数据 + 按形态聚合的统计」：
 *   · RegTracker  登记项（= 用户口中的「标记」），锁定类型 / 单位 / 精度；
 *   · RegEntry    一次登记（原子数据，统计只读这张表）；
 *   · RegUnit     自定义单位（登记设置里维护）。
 *
 * v1.3.5.7：条目回归登记自己的独立表 ——
 *   · 「条目」= RegTracker，是登记的身份表，**不再写 markers**。改名 / 改类型 /
 *     改单位 / 改分母 / 合并都在这一张表上做，关联记录通过 trackerId 自动跟着变；
 *   · RegEntry 不再保存 markerName / markerId 快照 —— 名称只有 trackerId 一个真源；
 *   · 「标签」仍归主表：身份存 tags（type='register'），关联走 reg_entry_tags。
 */

/** 六种基础形态 */
export const REG_VALUE_TYPES = ['stock', 'flow', 'count', 'duration', 'ratio', 'price'];
export const REG_CURRENCIES = ['CNY', 'USD'];

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
  const ms = typeof v === 'number' ? v : Date.parse(String(v));
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

/** 时间分桶键：day / week（周一起）/ month / year */
function bucketKey(d: Date, bucket: string): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (bucket === 'year') return `${y}`;
  if (bucket === 'month') return `${y}-${m}`;
  if (bucket === 'week') {
    const t = new Date(d.getTime());
    const offset = (t.getDay() + 6) % 7;
    t.setDate(t.getDate() - offset);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }
  return `${y}-${m}-${day}`;
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
  quantity?: number | string;
  unit?: string;
  /** v1.3.5.7：分母（复合单位 `/` 之后的部分） */
  portion?: string;
  currency?: string;
  direction?: number;
  note?: string;
  tags?: string[];
  attachments?: string[];
  docNoteId?: string;
  valueType?: string;
  unitKind?: string;
  precision?: number;
  scene?: string;
  /** 预留字段（P3 未启用）：预算额度（0 = 不设） */
  budget?: number;
  /** 预留字段（P3 未启用）：是否共享给同实例成员（只读） */
  shared?: boolean;
}

@Injectable()
export class RegService implements OnApplicationBootstrap {
  private readonly logger = new Logger('RegService');

  /**
   * v1.3.5.7：升级后补齐条目分母（幂等，重复启动无副作用）。
   * 标签的搬迁在 prisma/compat-sync.js 里完成 —— 那一列会被 db push 直接删掉，
   * 只能跑在 db push 之前；这里只处理 db push 之后才有列可写的项目。
   */
  async onApplicationBootstrap() {
    try {
      await this.backfillTrackerPortion();
    } catch (e) {
      this.logger.warn(`条目分母回填失败（下次启动会重试）：${(e as Error)?.message || e}`);
    }
  }

  /**
   * v1.3.5.7：老数据的 `reg_entries.portion` 是「元/升」这种整串（当时叫「份量」），
   * 升级脚本已把它裁成「/ 之后」的分母；条目表这边的分母还是空的，
   * 这里用每条条目最近一次记录的分母补上，保证「选中已有条目 → 分母冻结」有值可用。
   */
  async backfillTrackerPortion() {
    const rows = await prisma.regTracker.findMany({
      where: { portion: '' },
      select: { id: true },
      take: 1000,
    });
    if (!rows.length) return 0;
    let filled = 0;
    for (const t of rows) {
      const last = await prisma.regEntry.findFirst({
        where: { trackerId: t.id, portion: { not: '' } },
        orderBy: { occurredAt: 'desc' },
        select: { portion: true },
      });
      if (!last?.portion) continue;
      await prisma.regTracker.update({ where: { id: t.id }, data: { portion: last.portion } }).catch(() => undefined);
      filled += 1;
    }
    if (filled) this.logger.log(`条目分母回填 ${filled} 条`);
    return filled;
  }

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
      where: { trackerId: { in: rows.map((r) => r.id) } },
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
      if (input.note !== undefined) patch.note = String(input.note).slice(0, 200);
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
        direction: [-1, 0, 1].includes(Math.round(num(input.direction, 0))) ? Math.round(num(input.direction, 0)) : 0,
      },
    });
    return { row, locked: false };
  }

  /**
   * v1.3.5.7：条目管理 —— 改名称 / 类型 / 单位 / 分母。
   *
   * 这里改的是「根源」：名称一改，所有关联记录按 trackerId 取到的名字自动变；
   * 类型 / 单位 / 分母同时回写到关联记录（它们本来就是这个条目的口径快照），
   * 统计口径因此保持一致。
   */
  async updateTracker(
    id: string,
    input: { name?: string; valueType?: string; unit?: string; portion?: string; scene?: string; note?: string; precision?: number; direction?: number },
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
        ...(input.direction === undefined ? {} : { direction: Math.round(num(input.direction, existed.direction)) }),
      },
    });
    /* 口径回写：单位 / 分母变了，关联记录跟着走（类型在记录上没有列，只在条目上） */
    if (unit !== existed.unit || portion !== existed.portion) {
      await prisma.regEntry.updateMany({ where: { trackerId: row.id }, data: { unit, portion } }).catch(() => undefined);
    }
    return { id: row.id, name: row.name, unit: row.unit, portion: row.portion, valueType: row.valueType };
  }

  /**
   * v1.3.5.7：合并条目 —— 把 sources 的记录全部并到 target，然后删掉 sources。
   * 记录自己的单位 / 分母按当时记下的值保留（不重写历史数据），标签关联也不动。
   */
  async mergeTrackers(targetId: string, sourceIds: string[], owner: string) {
    const target = await prisma.regTracker.findFirst({ where: { id: String(targetId || ''), owner } });
    if (!target) return { error: '目标条目不存在或无权修改' as string };
    const ids = (Array.isArray(sourceIds) ? sourceIds : [])
      .map((x) => String(x || ''))
      .filter((x) => x && x !== target.id);
    if (!ids.length) return { error: '请选择要合并的条目' as string };
    const sources = await prisma.regTracker.findMany({ where: { id: { in: ids }, owner }, select: { id: true } });
    if (!sources.length) return { error: '要合并的条目不存在或无权修改' as string };
    const keep = sources.map((s) => s.id);
    const moved = await prisma.regEntry.updateMany({
      where: { trackerId: { in: keep } },
      data: { trackerId: target.id },
    });
    await prisma.regTracker.deleteMany({ where: { id: { in: keep } } });
    return { id: target.id, merged: keep.length, moved: moved.count };
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
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Math.floor(num(q.page, 1)));
    const pageSize = Math.min(100, Math.max(1, Math.floor(num(q.pageSize, 20))));
    const where: Record<string, unknown> = {
      owner: String(q.owner || ''),
      instanceId: String(q.instanceId || ''),
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
        { note: { contains: kw } },
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
    return { total, page, pageSize, list: rows.map((r) => this.entryView(r)) };
  }

  /**
   * v1.3.5.7：条目名称、单位、分母都从 tracker 关联取（记录里不再存名称快照）。
   * tags 改读 reg_entry_tags，attachments 仍是 JSON（只服务展示）。
   */
  private entryView(r: any) {
    const tracker = r.tracker || null;
    const tagLinks = Array.isArray(r.tagLinks) ? r.tagLinks : [];
    return {
      ...r,
      tracker,
      trackerName: tracker ? String(tracker.name || '') : '',
      occurredAt: r.occurredAt ? r.occurredAt.getTime() : 0,
      startAt: r.startAt ? r.startAt.getTime() : null,
      dueAt: r.dueAt ? r.dueAt.getTime() : null,
      createdAt: r.createdAt ? r.createdAt.getTime() : 0,
      updatedAt: r.updatedAt ? r.updatedAt.getTime() : 0,
      tags: tagLinks.map((l: any) => String(l?.tag?.name || '')).filter(Boolean),
      attachments: parseArr(r.attachments),
    };
  }

  async createEntry(input: RegEntryInput, owner: string) {
    const tracker = await this.ensureTracker(input, owner);
    if ('error' in tracker && tracker.error) return { error: tracker.error };
    const row = tracker.row!;
    const occurredAt = dateOf(input.occurredAt) || new Date();
    const amount = num(input.amount, 0);
    const quantity = input.quantity === undefined || input.quantity === '' ? 1 : num(input.quantity, 1);
    if (!Number.isFinite(amount)) return { error: '登记数值必须是可运算的数字' };
    if (!Number.isFinite(quantity) || quantity === 0) return { error: '数量必须是可运算的非零数字' };

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
        amount,
        quantity,
        unit: text(input.unit || row.unit, 24),
        portion: text(input.portion === undefined || input.portion === '' ? row.portion : input.portion, 32),
        currency: REG_CURRENCIES.includes(String(input.currency || '')) ? String(input.currency) : 'CNY',
        direction: [-1, 0, 1].includes(Math.round(num(input.direction, row.direction))) ? Math.round(num(input.direction, row.direction)) : 0,
        note: String(input.note || '').slice(0, 500),
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
        ...(input.amount === undefined ? {} : { amount: num(input.amount, existed.amount) }),
        ...(input.quantity === undefined ? {} : { quantity: num(input.quantity, existed.quantity) }),
        ...(input.unit === undefined ? {} : { unit: text(input.unit, 24) }),
        ...(input.portion === undefined ? {} : { portion: text(input.portion, 32) }),
        ...(input.currency === undefined ? {} : { currency: REG_CURRENCIES.includes(String(input.currency)) ? String(input.currency) : existed.currency }),
        ...(input.direction === undefined ? {} : { direction: Math.round(num(input.direction, existed.direction)) }),
        ...(input.note === undefined ? {} : { note: String(input.note).slice(0, 500) }),
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

  async removeEntry(id: string, owner: string) {
    const existed = await prisma.regEntry.findFirst({ where: { id: String(id || ''), owner: String(owner || '') } });
    if (!existed) return { error: '登记不存在或无权删除' as string };
    await prisma.regEntry.delete({ where: { id: existed.id } });
    return { id: existed.id };
  }

  /* ── 统计（P1） ─────────────────────────────────────────── */

  /**
   * 联合统计：scope = me（仅自己）/ all（同实例下所有人的同名标记）。
   * 聚合口径：value = amount × quantity（数量默认 1），与规划方案一致。
   */
  async stats(q: {
    owner: string;
    instanceId: string;
    scope?: string;
    trackerId?: string;
    trackerName?: string;
    /** v1.3.5.6：按标签筛选 */
    tag?: string;
    from?: string;
    to?: string;
    bucket?: string;
    /** v1.3.5.4（P2）：year = 追加去年同期对比 */
    compare?: string;
  }) {
    const instanceId = String(q.instanceId || '');
    const baseWhere: Record<string, unknown> = { instanceId };
    if (String(q.scope || 'me') !== 'all') baseWhere.owner = String(q.owner || '');
    if (q.trackerId) baseWhere.trackerId = String(q.trackerId);
    else if (q.trackerName) baseWhere.tracker = { name: String(q.trackerName) };
    if (String(q.tag || '').trim()) {
      baseWhere.tagLinks = { some: { tag: { name: String(q.tag).trim() } } };
    }
    const from = dateOf(q.from);
    const to = dateOf(q.to);
    const where: Record<string, unknown> = {
      ...baseWhere,
      ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };

    const rows = await prisma.regEntry.findMany({
      where: where as any,
      include: { tracker: { select: { name: true } } },
      orderBy: { occurredAt: 'asc' },
    });
    const bucket = ['day', 'week', 'month', 'year'].includes(String(q.bucket || '')) ? String(q.bucket) : 'month';

    const buckets = new Map<string, { key: string; sum: number; count: number; quantity: number }>();
    const owners = new Map<string, { owner: string; sum: number; count: number }>();
    /* v1.3.5.6：图表需要的维度（一次遍历算完，不额外查库） */
    const trackerMap = new Map<string, { name: string; sum: number; count: number }>();
    const weekday = [0, 0, 0, 0, 0, 0, 0];
    const values: number[] = [];
    let total = 0;
    let quantity = 0;
    let max = Number.NEGATIVE_INFINITY;
    let min = Number.POSITIVE_INFINITY;
    for (const r of rows) {
      const v = num(r.amount) * (r.quantity === 0 ? 1 : num(r.quantity, 1));
      total += v;
      quantity += num(r.quantity, 1);
      if (v > max) max = v;
      if (v < min) min = v;
      const k = bucketKey(r.occurredAt, bucket);
      const b = buckets.get(k) || { key: k, sum: 0, count: 0, quantity: 0 };
      b.sum += v;
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
    }
    const series = Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
    for (let i = 1; i < series.length; i += 1) {
      const prev = series[i - 1].sum;
      const cur = series[i].sum;
      (series[i] as any).diff = cur - prev;
      (series[i] as any).pct = prev ? ((cur - prev) / Math.abs(prev)) * 100 : null;
    }

    /* P2：派生指标（单价 / 结存 / 间隔 / 消耗速度） */
    const derive = this.buildDerive(rows, series, from, to);

    /* P2：同比（去年同期） */
    const compare = String(q.compare || '') === 'year'
      ? await this.buildYoy(baseWhere, from, to, bucket, total)
      : null;

    const byTracker = Array.from(trackerMap.values()).sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));
    const byWeekday = weekday.map((sum, i) => ({
      weekday: i,
      label: ['一', '二', '三', '四', '五', '六', '日'][i],
      sum,
    }));

    return {
      total,
      count: rows.length,
      quantity,
      avg: rows.length ? total / rows.length : 0,
      max: rows.length ? max : 0,
      min: rows.length ? min : 0,
      series,
      byOwner: Array.from(owners.values()).sort((a, b) => b.sum - a.sum),
      /* v1.3.5.6：圆环 / 条形 / 雷达 / 分布图的数据源 */
      byTracker,
      byWeekday,
      histogram: this.buildHistogram(values),
      unit: rows[0]?.unit || '',
      currency: rows[0]?.currency || 'CNY',
      bucket,
      from: from ? from.getTime() : null,
      to: to ? to.getTime() : null,
      scope: String(q.scope || 'me'),
      /* v1.3.5.4 新增 */
      derive,
      compare,
    };
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
  private buildDerive(rows: any[], series: any[], from: Date | null, to: Date | null) {
    let sumValue = 0;
    let sumQty = 0;
    for (const r of rows) {
      sumValue += num(r.amount) * (r.quantity === 0 ? 1 : num(r.quantity, 1));
      sumQty += num(r.quantity, 1);
    }
    const unitPrice = sumQty > 0 ? sumValue / sumQty : null;

    let acc = 0;
    const balance = series.map((b) => {
      acc += num(b.sum);
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
    const perDay = spanDays ? sumQty / spanDays : null;

    return {
      unitPrice,
      balance,
      interval: { avgDays, count: intervals.length, list: intervals.slice(-30).reverse() },
      speed: { perDay, spanDays },
    };
  }

  /** P2：同比 —— 去年同期同区间再算一次 */
  private async buildYoy(
    baseWhere: Record<string, unknown>,
    from: Date | null,
    to: Date | null,
    bucket: string,
    currentTotal: number,
  ) {
    const now = new Date();
    const prevFrom = from
      ? new Date(from.getFullYear() - 1, from.getMonth(), from.getDate(), from.getHours(), from.getMinutes())
      : new Date(now.getFullYear() - 1, 0, 1);
    const prevTo = to
      ? new Date(to.getFullYear() - 1, to.getMonth(), to.getDate(), to.getHours(), to.getMinutes())
      : new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 23, 59, 59);
    const rows = await prisma.regEntry.findMany({
      where: { ...baseWhere, occurredAt: { gte: prevFrom, lte: prevTo } } as any,
      orderBy: { occurredAt: 'asc' },
    });
    const buckets = new Map<string, { key: string; sum: number; count: number }>();
    let total = 0;
    for (const r of rows) {
      const v = num(r.amount) * (r.quantity === 0 ? 1 : num(r.quantity, 1));
      total += v;
      const k = bucketKey(r.occurredAt as Date, bucket);
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

  /* ── 单位 ───────────────────────────────────────────────── */

  async listUnits(owner: string, instanceId: string) {
    const rows = await prisma.regUnit.findMany({
      where: { owner: String(owner || ''), instanceId: String(instanceId || '') },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() }));
  }

  async saveUnit(input: { id?: string; name?: string; kind?: string; factor?: number; baseUnit?: string; instanceId?: string }, owner: string) {
    const name = String(input.name || '').trim().slice(0, 24);
    if (!name) return { error: '单位名称不能为空' as string };
    const instanceId = String(input.instanceId || '');
    const existed = input.id
      ? await prisma.regUnit.findFirst({ where: { id: String(input.id), owner } })
      : await prisma.regUnit.findFirst({ where: { owner, instanceId, name } });
    if (existed) {
      const row = await prisma.regUnit.update({
        where: { id: existed.id },
        data: {
          name,
          kind: String(input.kind || existed.kind).slice(0, 24),
          factor: num(input.factor, existed.factor),
          baseUnit: String(input.baseUnit === undefined ? existed.baseUnit : input.baseUnit).slice(0, 24),
        },
      });
      return { id: row.id };
    }
    const row = await prisma.regUnit.create({
      data: {
        owner,
        instanceId,
        name,
        kind: String(input.kind || 'count').slice(0, 24),
        factor: num(input.factor, 1),
        baseUnit: String(input.baseUnit || '').slice(0, 24),
      },
    });
    return { id: row.id };
  }

  async removeUnit(id: string, owner: string) {
    const existed = await prisma.regUnit.findFirst({ where: { id: String(id || ''), owner } });
    if (!existed) return { error: '单位不存在' as string };
    await prisma.regUnit.delete({ where: { id: existed.id } });
    return { id: existed.id };
  }

  /* ── 候选值（地点 / 发生人 / 关联人） ───────────────────── */

  /**
   * v1.3.5.7：候选值统一从「记录 + 条目表」两处取 ——
   * 记录给这个账户实际用过的值，条目表给登记口径里定下的单位 / 分母
   * （刚建好还没录入数据的条目也能在表单里选到）。
   */
  async candidates(owner: string, instanceId: string) {
    const [rows, trackers] = await Promise.all([
      prisma.regEntry.findMany({
        where: { owner: String(owner || ''), instanceId: String(instanceId || '') },
        select: { placeName: true, subjectName: true, relatedName: true, unit: true, portion: true },
        orderBy: { occurredAt: 'desc' },
        take: 500,
      }),
      prisma.regTracker.findMany({
        where: { owner: String(owner || ''), instanceId: String(instanceId || ''), archived: false },
        select: { unit: true, portion: true },
        take: 500,
      }),
    ]);
    const collect = (key: 'placeName' | 'subjectName' | 'relatedName' | 'unit' | 'portion') => {
      const set = new Set<string>();
      for (const r of rows) {
        const v = String((r as any)[key] || '').trim();
        if (v) set.add(v);
      }
      for (const t of trackers) {
        if (key !== 'unit' && key !== 'portion') break;
        const v = String((t as any)[key] || '').trim();
        if (v) set.add(v);
      }
      return Array.from(set).slice(0, 50);
    };
    return {
      places: collect('placeName'),
      subjects: collect('subjectName'),
      related: collect('relatedName'),
      units: collect('unit'),
      portions: collect('portion'),
      tags: await this.listTagNames(instanceId, owner),
    };
  }

  /* ── Excel / CSV 导入（P1） ─────────────────────────────── */

  /**
   * 批量导入：前端把 Excel / CSV 解析成 [{...}] 后提交，
   * 后端逐条走 createEntry，返回成功 / 失败明细（不整批回滚，便于用户修正后重导）。
   * 必填：trackerName（条目，兼容旧列名 markerName）、occurredAt（时间）、amount（数值）；
   * 可选：quantity / unit / title / event / subjectName / relatedName / placeName / note / note / valueType。
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
