"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegService = exports.REG_AXIS_Y = exports.REG_AXIS_X = exports.REG_CURRENCIES = exports.REG_VALUE_TYPES = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const tags_1 = require("../common/tags");
const notes_util_1 = require("../notes/notes.util");
exports.REG_VALUE_TYPES = ['stock', 'flow', 'count', 'duration', 'ratio', 'price'];
exports.REG_CURRENCIES = ['', 'CNY', 'USD'];
exports.REG_AXIS_X = ['occurredAt', 'startAt', 'dueAt', 'createdAt'];
exports.REG_AXIS_Y = ['value', 'quantity'];
function text(v, max = 120) {
    return String(v === undefined || v === null ? '' : v).trim().slice(0, max);
}
function num(v, def = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}
function dateOf(v) {
    if (v === undefined || v === null || v === '')
        return null;
    if (typeof v === 'number')
        return Number.isFinite(v) ? new Date(v) : null;
    const s = String(v).trim();
    if (!s)
        return null;
    if (/^-?\d{10,}$/.test(s)) {
        const n = Number(s);
        return Number.isFinite(n) ? new Date(n) : null;
    }
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? new Date(ms) : null;
}
function parseArr(raw) {
    try {
        const v = JSON.parse(String(raw || '[]'));
        return Array.isArray(v) ? v.map((x) => String(x)) : [];
    }
    catch (e) {
        return [];
    }
}
function bucketKey(d, bucket) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    if (bucket === 'year')
        return `${y}`;
    if (bucket === 'month')
        return `${y}-${m}`;
    return `${y}-${m}-${day}`;
}
function bucketLabel(key) {
    return key;
}
let RegService = class RegService {
    logger = new common_1.Logger('RegService');
    async syncEntryTags(entryId, names, instanceId, owner) {
        const tagIds = [];
        for (const raw of Array.isArray(names) ? names.slice(0, 20) : []) {
            const tag = await (0, tags_1.findOrCreateTag)(String(raw || ''), instanceId, owner, tags_1.TAG_TYPE_REGISTER);
            if (tag?.id)
                tagIds.push(tag.id);
        }
        const uniq = Array.from(new Set(tagIds));
        await prisma_1.prisma.regEntryTag.deleteMany({ where: { entryId } });
        if (!uniq.length)
            return;
        await prisma_1.prisma.regEntryTag.createMany({
            data: uniq.map((tagId) => ({ entryId, tagId })),
            skipDuplicates: true,
        });
    }
    async listTagNames(instanceId, owner) {
        const rows = await prisma_1.prisma.tag.findMany({
            where: { ...(0, tags_1.tagScope)(instanceId, tags_1.TAG_TYPE_REGISTER, owner) },
            select: { name: true },
            orderBy: { createdAt: 'asc' },
            take: 200,
        });
        return rows.map((r) => r.name).filter(Boolean);
    }
    async listTrackers(owner, instanceId) {
        const me = String(owner || '');
        const where = { owner: me, instanceId: String(instanceId || ''), archived: false };
        const rows = await prisma_1.prisma.regTracker.findMany({ where, orderBy: [{ updatedAt: 'desc' }] });
        if (!rows.length)
            return [];
        const counts = await prisma_1.prisma.regEntry.groupBy({
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
    async ensureTracker(input, owner) {
        const instanceId = String(input.instanceId || '');
        const id = String(input.trackerId || '');
        if (id) {
            const hit = await prisma_1.prisma.regTracker.findFirst({ where: { id, owner } });
            if (hit)
                return { row: hit, locked: true };
        }
        const name = String(input.trackerName || input.markerName || '').trim().slice(0, 80);
        if (!name)
            return { error: '条目名称不能为空' };
        const existed = await prisma_1.prisma.regTracker.findFirst({ where: { owner, instanceId, name } });
        if (existed) {
            const patch = {};
            if (input.scene !== undefined)
                patch.scene = String(input.scene).slice(0, 24);
            if (Object.keys(patch).length) {
                const row = await prisma_1.prisma.regTracker.update({ where: { id: existed.id }, data: patch });
                return { row, locked: true };
            }
            return { row: existed, locked: true };
        }
        const valueType = exports.REG_VALUE_TYPES.includes(String(input.valueType || '')) ? String(input.valueType) : 'flow';
        const row = await prisma_1.prisma.regTracker.create({
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
    async updateTracker(id, input, owner) {
        const existed = await prisma_1.prisma.regTracker.findFirst({ where: { id: String(id || ''), owner } });
        if (!existed)
            return { error: '条目不存在或无权修改' };
        const name = input.name === undefined ? existed.name : String(input.name).trim().slice(0, 80);
        if (!name)
            return { error: '条目名称不能为空' };
        if (name !== existed.name) {
            const dup = await prisma_1.prisma.regTracker.findFirst({
                where: { owner: existed.owner, instanceId: existed.instanceId, name, NOT: { id: existed.id } },
                select: { id: true },
            });
            if (dup)
                return { error: `已存在同名条目「${name}」，请改用合并` };
        }
        const valueType = input.valueType === undefined
            ? existed.valueType
            : (exports.REG_VALUE_TYPES.includes(String(input.valueType)) ? String(input.valueType) : existed.valueType);
        const unit = input.unit === undefined ? existed.unit : String(input.unit).trim().slice(0, 24);
        const portion = input.portion === undefined ? existed.portion : String(input.portion).trim().slice(0, 32);
        const row = await prisma_1.prisma.regTracker.update({
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
    async mergeTrackers(targetId, sourceIds, owner) {
        const target = await prisma_1.prisma.regTracker.findFirst({ where: { id: String(targetId || ''), owner } });
        if (!target)
            return { error: '目标条目不存在或无权修改' };
        const ids = (Array.isArray(sourceIds) ? sourceIds : [])
            .map((x) => String(x || ''))
            .filter((x) => x && x !== target.id);
        if (!ids.length)
            return { error: '请选择要合并的条目' };
        const sources = await prisma_1.prisma.regTracker.findMany({ where: { id: { in: ids }, owner } });
        if (!sources.length)
            return { error: '要合并的条目不存在或无权修改' };
        const bad = sources.filter((s) => s.valueType !== target.valueType || s.unit !== target.unit || s.portion !== target.portion);
        if (bad.length) {
            const names = bad.map((s) => `「${s.name}」`).join('、');
            return { error: `${names} 的类型 / 单位 / 分母与目标条目不统一，无法合并（可先改到一致再合并）` };
        }
        const keep = sources.map((s) => s.id);
        const moved = await prisma_1.prisma.regEntry.updateMany({
            where: { trackerId: { in: keep } },
            data: { trackerId: target.id },
        });
        await prisma_1.prisma.regTracker.deleteMany({ where: { id: { in: keep } } });
        return { id: target.id, merged: keep.length, moved: moved.count };
    }
    async removeTracker(id, owner) {
        const existed = await prisma_1.prisma.regTracker.findFirst({ where: { id: String(id || ''), owner } });
        if (!existed)
            return { error: '条目不存在或无权删除' };
        const count = await prisma_1.prisma.regEntry.count({ where: { trackerId: existed.id } });
        if (count > 0)
            return { error: `条目「${existed.name}」下还有 ${count} 条登记，不能删除（可先合并到其它条目）` };
        await prisma_1.prisma.regTracker.delete({ where: { id: existed.id } });
        return { id: existed.id };
    }
    async listEntries(q) {
        const page = Math.max(1, Math.floor(num(q.page, 1)));
        const pageSize = Math.min(100, Math.max(1, Math.floor(num(q.pageSize, 20))));
        const where = {
            owner: String(q.owner || ''),
            instanceId: String(q.instanceId || ''),
        };
        if (q.trackerId)
            where.trackerId = String(q.trackerId);
        else if (q.trackerName)
            where.tracker = { name: String(q.trackerName) };
        const tag = String(q.tag || '').trim();
        if (tag)
            where.tagLinks = { some: { tag: { name: tag } } };
        const from = dateOf(q.from);
        const to = dateOf(q.to);
        if (from || to)
            where.occurredAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
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
            prisma_1.prisma.regEntry.count({ where: where }),
            prisma_1.prisma.regEntry.findMany({
                where: where,
                include: {
                    tracker: { select: { id: true, name: true, valueType: true, unit: true, portion: true } },
                    tagLinks: { select: { tag: { select: { name: true } } } },
                },
                orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ]);
        const views = await this.resolveAttachments(rows.flatMap((r) => parseArr(r.attachments)));
        const prevs = await this.previousEntries(rows, String(q.owner || ''), String(q.instanceId || ''));
        return {
            total,
            page,
            pageSize,
            list: rows.map((r) => this.entryView(r, views, prevs)),
        };
    }
    async previousEntries(rows, owner, instanceId) {
        const map = new Map();
        if (!rows.length)
            return map;
        const ids = Array.from(new Set(rows.map((r) => String(r.trackerId || '')).filter(Boolean)));
        if (!ids.length)
            return map;
        const latest = rows.reduce((max, r) => Math.max(max, r.occurredAt.getTime()), 0);
        const history = await prisma_1.prisma.regEntry.findMany({
            where: { trackerId: { in: ids }, owner: String(owner || ''), instanceId, occurredAt: { lte: new Date(latest) } },
            orderBy: { occurredAt: 'desc' },
            take: 1000,
            select: { id: true, trackerId: true, occurredAt: true, amount: true, quantity: true, tracker: { select: { unit: true, portion: true } } },
        });
        for (const r of rows) {
            const at = r.occurredAt.getTime();
            const prev = history.find((h) => h.trackerId === r.trackerId && h.id !== r.id && h.occurredAt.getTime() < at);
            if (!prev)
                continue;
            map.set(String(r.id), {
                occurredAt: prev.occurredAt.getTime(),
                value: num(prev.amount) * (prev.quantity === 0 ? 1 : num(prev.quantity, 1)),
                unit: String(prev.tracker?.unit || ''),
                portion: String(prev.tracker?.portion || ''),
            });
        }
        return map;
    }
    entryView(r, views, prevs) {
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
            tags: tagLinks.map((l) => String(l?.tag?.name || '')).filter(Boolean),
            attachments: ids,
            attachmentViews: map
                ? ids.map((id) => map.get(id)).filter(Boolean)
                : [],
            prev: prevs && prevs.get(String(r.id)) ? prevs.get(String(r.id)) : null,
        };
    }
    async attachmentViews(ids, owner) {
        const uniq = Array.from(new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))).slice(0, 60);
        if (!uniq.length)
            return [];
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: { id: { in: uniq }, uploader: String(owner || '') },
            select: { id: true, name: true, originalName: true, mime: true, size: true },
        });
        const map = new Map();
        for (const r of rows) {
            const kind = (0, notes_util_1.mediaKindOfMime)(r.mime);
            map.set(r.id, {
                fileId: r.id,
                url: (0, notes_util_1.fileUrlOf)(r.name),
                thumbUrl: (0, notes_util_1.fileUrlOf)(r.name, kind === 'image' ? 480 : undefined),
                name: r.name,
                originalName: r.originalName,
                mime: r.mime,
                size: r.size,
                mediaKind: kind,
            });
        }
        return uniq.map((id) => map.get(id)).filter(Boolean);
    }
    async resolveAttachments(ids) {
        const uniq = Array.from(new Set((ids || []).map(String).filter(Boolean)));
        const map = new Map();
        if (!uniq.length)
            return map;
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: { id: { in: uniq } },
            select: { id: true, name: true, originalName: true, mime: true, size: true },
        });
        for (const r of rows) {
            const kind = (0, notes_util_1.mediaKindOfMime)(r.mime);
            map.set(r.id, {
                fileId: r.id,
                url: (0, notes_util_1.fileUrlOf)(r.name),
                thumbUrl: (0, notes_util_1.fileUrlOf)(r.name, kind === 'image' ? 480 : undefined),
                name: r.name,
                originalName: r.originalName,
                mime: r.mime,
                size: r.size,
                mediaKind: kind,
            });
        }
        return map;
    }
    async createEntry(input, owner) {
        const tracker = await this.ensureTracker(input, owner);
        if ('error' in tracker && tracker.error)
            return { error: tracker.error };
        const row = tracker.row;
        const occurredAt = dateOf(input.occurredAt) || new Date();
        const amount = num(input.amount, 0);
        const quantity = input.quantity === undefined || input.quantity === null || input.quantity === ''
            ? 1
            : num(input.quantity, 1);
        if (!Number.isFinite(amount))
            return { error: '登记数值必须是可运算的数字' };
        if (!Number.isFinite(quantity) || quantity === 0)
            return { error: '份量必须是可运算的非零数字' };
        const direction = [-1, 0, 1].includes(Math.round(num(input.direction, 0)))
            ? Math.round(num(input.direction, 0))
            : 0;
        const signedAmount = direction === 1 ? Math.abs(amount) : (direction === -1 ? -Math.abs(amount) : amount);
        const created = await prisma_1.prisma.regEntry.create({
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
                currency: exports.REG_CURRENCIES.includes(String(input.currency || '')) ? String(input.currency || '') : '',
                attachments: JSON.stringify(Array.isArray(input.attachments) ? input.attachments.map(String).slice(0, 30) : []),
                docNoteId: String(input.docNoteId || ''),
            },
        });
        await this.syncEntryTags(created.id, Array.isArray(input.tags) ? input.tags.map(String) : [], String(input.instanceId || ''), owner).catch(() => undefined);
        await prisma_1.prisma.regTracker.update({ where: { id: row.id }, data: { updatedAt: new Date() } }).catch(() => undefined);
        return { id: created.id, trackerId: row.id, locked: 'locked' in tracker ? tracker.locked : false };
    }
    async updateEntry(id, input, owner) {
        const existed = await prisma_1.prisma.regEntry.findFirst({ where: { id: String(id || ''), owner: String(owner || '') } });
        if (!existed)
            return { error: '登记不存在或无权修改' };
        let nextTrackerId = existed.trackerId;
        if (input.trackerId || input.trackerName) {
            const t = await this.ensureTracker(input, owner);
            if ('error' in t && t.error)
                return { error: t.error };
            nextTrackerId = t.row.id;
        }
        const occurredAt = input.occurredAt === undefined ? existed.occurredAt : dateOf(input.occurredAt) || existed.occurredAt;
        const direction = input.direction === undefined
            ? Number(existed.direction || 0)
            : ([-1, 0, 1].includes(Math.round(num(input.direction, existed.direction)))
                ? Math.round(num(input.direction, existed.direction))
                : Number(existed.direction || 0));
        const nextAmount = input.amount === undefined ? num(existed.amount) : num(input.amount, num(existed.amount));
        const signedAmount = direction === 1
            ? Math.abs(nextAmount)
            : (direction === -1 ? -Math.abs(nextAmount) : nextAmount);
        const updated = await prisma_1.prisma.regEntry.update({
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
                    : { currency: exports.REG_CURRENCIES.includes(String(input.currency)) ? String(input.currency) : existed.currency }),
                ...(input.attachments === undefined ? {} : { attachments: JSON.stringify(Array.isArray(input.attachments) ? input.attachments.map(String).slice(0, 30) : []) }),
                ...(input.docNoteId === undefined ? {} : { docNoteId: String(input.docNoteId) }),
            },
        });
        if (input.tags !== undefined) {
            await this.syncEntryTags(updated.id, Array.isArray(input.tags) ? input.tags.map(String) : [], String(input.instanceId || existed.instanceId || ''), owner).catch(() => undefined);
        }
        return { id: updated.id };
    }
    async removeEntry(id, owner) {
        const existed = await prisma_1.prisma.regEntry.findFirst({ where: { id: String(id || ''), owner: String(owner || '') } });
        if (!existed)
            return { error: '登记不存在或无权删除' };
        await prisma_1.prisma.regEntry.delete({ where: { id: existed.id } });
        return { id: existed.id };
    }
    axisField(v) {
        const s = String(v || '');
        return exports.REG_AXIS_X.includes(s) ? s : 'occurredAt';
    }
    axisDate(r, field) {
        const v = r[field];
        return v instanceof Date ? v : null;
    }
    metricOf(r, axisY) {
        const qty = r.quantity === 0 || r.quantity === undefined || r.quantity === null ? 1 : num(r.quantity, 1);
        return axisY === 'quantity' ? qty : num(r.amount) * qty;
    }
    async stats(q) {
        const instanceId = String(q.instanceId || '');
        const axisX = this.axisField(q.axisX);
        const axisY = exports.REG_AXIS_Y.includes(String(q.axisY || '')) ? String(q.axisY) : 'value';
        const bucket = ['day', 'month', 'year'].includes(String(q.bucket || '')) ? String(q.bucket) : 'month';
        const baseWhere = { instanceId };
        if (String(q.scope || 'me') !== 'all')
            baseWhere.owner = String(q.owner || '');
        const type = String(q.type || '').trim();
        const trackerWhere = {};
        if (type && exports.REG_VALUE_TYPES.includes(type))
            trackerWhere.valueType = type;
        if (q.trackerId)
            baseWhere.trackerId = String(q.trackerId);
        else if (q.trackerName)
            trackerWhere.name = String(q.trackerName);
        if (Object.keys(trackerWhere).length)
            baseWhere.tracker = trackerWhere;
        if (String(q.tag || '').trim()) {
            baseWhere.tagLinks = { some: { tag: { name: String(q.tag).trim() } } };
        }
        if (String(q.subjectName || '').trim())
            baseWhere.subjectName = String(q.subjectName).trim();
        if (String(q.relatedName || '').trim())
            baseWhere.relatedName = String(q.relatedName).trim();
        if (String(q.placeName || '').trim())
            baseWhere.placeName = String(q.placeName).trim();
        const totalTags = (Array.isArray(q.tags) ? q.tags : String(q.tags || '').split(','))
            .map((t) => String(t || '').trim())
            .filter(Boolean)
            .slice(0, 10);
        if (totalTags.length) {
            const and = Array.isArray(baseWhere.AND) ? baseWhere.AND : [];
            for (const t of totalTags)
                and.push({ tagLinks: { some: { tag: { name: t } } } });
            baseWhere.AND = and;
        }
        const from = dateOf(q.from);
        const to = dateOf(q.to);
        const who = { ...baseWhere };
        if (from || to)
            who[axisX] = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
        const rows = await prisma_1.prisma.regEntry.findMany({
            where: who,
            include: {
                tracker: { select: { id: true, name: true, valueType: true, unit: true, portion: true } },
                tagLinks: { select: { tag: { select: { name: true } } } },
            },
            orderBy: { occurredAt: 'asc' },
        });
        let total = 0;
        let quantity = 0;
        let max = Number.NEGATIVE_INFINITY;
        let min = Number.POSITIVE_INFINITY;
        const buckets = new Map();
        const owners = new Map();
        const trackerMap = new Map();
        const weekday = [0, 0, 0, 0, 0, 0, 0];
        const values = [];
        const unitKeys = new Set();
        for (const r of rows) {
            const m = this.metricOf(r, axisY);
            const v = num(r.amount) * (r.quantity === 0 ? 1 : num(r.quantity, 1));
            total += m;
            quantity += num(r.quantity, 1);
            if (m > max)
                max = m;
            if (m < min)
                min = m;
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
            const tkey = String(r.tracker?.name || r.trackerId || '未命名');
            const t = trackerMap.get(tkey) || { name: tkey, sum: 0, count: 0 };
            t.sum += v;
            t.count += 1;
            trackerMap.set(tkey, t);
            weekday[(r.occurredAt.getDay() + 6) % 7] += v;
            values.push(v);
            const tk = r.tracker || {};
            unitKeys.add(`${tk.unit || ''}|${tk.portion || ''}`);
        }
        const series = Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
        for (let i = 1; i < series.length; i += 1) {
            const prev = series[i - 1].sum;
            const cur = series[i].sum;
            series[i].diff = cur - prev;
            series[i].pct = prev ? ((cur - prev) / Math.abs(prev)) * 100 : null;
        }
        const derive = this.buildDerive(rows, series, from, to);
        const compare = String(q.compare || '') === 'year'
            ? await this.buildYoy(baseWhere, axisX, from, to, bucket, total, axisY)
            : null;
        const legends = this.normalizeLegends(q.legends);
        const chart = this.buildChart(rows, { axisX, axisY, bucket, from, to, legends });
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
        const firstTracker = rows[0]?.tracker || null;
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
            unit: unitKeys.size > 1 ? '' : (firstTracker ? String(firstTracker.unit || '') : ''),
            portion: unitKeys.size > 1 ? '' : (firstTracker ? String(firstTracker.portion || '') : ''),
            currency: rows[0]?.currency || '',
            bucket,
            axisX,
            axisY,
            from: from ? from.getTime() : null,
            to: to ? to.getTime() : null,
            scope: String(q.scope || 'me'),
            type,
            derive,
            compare,
            chart,
        };
    }
    normalizeLegends(raw) {
        let arr = raw;
        if (typeof raw === 'string') {
            try {
                arr = JSON.parse(raw);
            }
            catch (e) {
                arr = [];
            }
        }
        if (!Array.isArray(arr))
            return [];
        return arr
            .slice(0, 4)
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
            .filter((x) => x.isDefault || x.trackerId || x.trackerName);
    }
    buildChart(rows, opt) {
        const { axisX, axisY, bucket, from, to, legends } = opt;
        const groups = legends.length ? legends : [null];
        const keyOf = (r) => {
            const d = this.axisDate(r, axisX);
            return d ? bucketKey(d, bucket) : '';
        };
        const per = [];
        groups.forEach((lg, i) => {
            const tags = (lg?.tags || []).map((t) => String(t).trim()).filter(Boolean);
            const hit = rows.filter((r) => {
                const t = r.tracker || {};
                if (lg) {
                    if (lg.trackerId && String(t.id || '') !== lg.trackerId)
                        return false;
                    if (!lg.trackerId && lg.trackerName && String(t.name || '') !== lg.trackerName)
                        return false;
                    if (lg.placeName && String(r.placeName || '') !== lg.placeName)
                        return false;
                    if (lg.subjectName && String(r.subjectName || '') !== lg.subjectName)
                        return false;
                    if (lg.relatedName && String(r.relatedName || '') !== lg.relatedName)
                        return false;
                    if (tags.length) {
                        const own = (Array.isArray(r.tagLinks) ? r.tagLinks : [])
                            .map((l) => String(l?.tag?.name || ''))
                            .filter(Boolean);
                        if (!tags.every((x) => own.includes(x)))
                            return false;
                    }
                }
                return !!this.axisDate(r, axisX);
            });
            const map = new Map();
            let sum = 0;
            for (const r of hit) {
                const k = keyOf(r);
                if (!k)
                    continue;
                const m = this.metricOf(r, axisY);
                map.set(k, (map.get(k) || 0) + m);
                sum += m;
            }
            const cond = [];
            if (lg) {
                if (lg.trackerId || lg.trackerName) {
                    const t = hit[0]?.tracker;
                    cond.push(String(t?.name || lg.trackerName || '条目'));
                }
                else {
                    cond.push('全部条目');
                }
                if (lg.placeName)
                    cond.push(`地点=${lg.placeName}`);
                if (lg.subjectName)
                    cond.push(`发生人=${lg.subjectName}`);
                if (lg.relatedName)
                    cond.push(`关联人=${lg.relatedName}`);
                if (tags.length)
                    cond.push(`标签=${tags.join('+')}`);
            }
            else {
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
                unit: String((hit[0]?.tracker || {}).unit || ''),
                portion: String((hit[0]?.tracker || {}).portion || ''),
            });
        });
        let keys = [];
        if (from && to)
            keys = this.fillBuckets(from, to, bucket);
        if (!keys.length) {
            const set = new Set();
            for (const r of rows) {
                const d = this.axisDate(r, axisX);
                if (d)
                    set.add(bucketKey(d, bucket));
            }
            if (!set.size)
                for (const g of per)
                    for (const k of g.map.keys())
                        set.add(k);
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
        const unit = per[0]?.unit || '';
        const portion = per[0]?.portion || '';
        return { labels, datasets, axisX, axisY, bucket, unit, portion };
    }
    fillBuckets(from, to, bucket) {
        const out = [];
        if (bucket === 'year') {
            for (let y = from.getFullYear(); y <= to.getFullYear() && out.length < 400; y += 1) {
                out.push(String(y));
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
    buildHistogram(values) {
        if (!values.length)
            return [];
        const min = Math.min(...values);
        const max = Math.max(...values);
        if (min === max)
            return [{ from: min, to: max, count: values.length }];
        const bins = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(values.length))));
        const step = (max - min) / bins;
        const out = Array.from({ length: bins }, (_, i) => ({
            from: min + i * step,
            to: min + (i + 1) * step,
            count: 0,
        }));
        for (const v of values) {
            let i = Math.floor((v - min) / step);
            if (i >= bins)
                i = bins - 1;
            if (i < 0)
                i = 0;
            out[i].count += 1;
        }
        return out;
    }
    buildDerive(rows, series, from, to) {
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
        const intervals = [];
        for (let i = 1; i < rows.length; i += 1) {
            const a = rows[i - 1].occurredAt;
            const b = rows[i].occurredAt;
            const days = Math.round((b.getTime() - a.getTime()) / 86400000);
            if (days >= 0)
                intervals.push({ from: a.getTime(), to: b.getTime(), days });
        }
        const avgDays = intervals.length ? intervals.reduce((s, x) => s + x.days, 0) / intervals.length : null;
        const start = from || (rows.length ? rows[0].occurredAt : null);
        const end = to || (rows.length ? rows[rows.length - 1].occurredAt : null);
        const spanDays = start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1) : 0;
        const perDay = spanDays ? sumQty / spanDays : null;
        return {
            unitPrice,
            balance,
            interval: { avgDays, count: intervals.length, list: intervals.slice(-30).reverse() },
            speed: { perDay, spanDays },
        };
    }
    async buildYoy(baseWhere, axisX, from, to, bucket, currentTotal, axisY) {
        const now = new Date();
        const prevFrom = from
            ? new Date(from.getFullYear() - 1, from.getMonth(), from.getDate(), from.getHours(), from.getMinutes())
            : new Date(now.getFullYear() - 1, 0, 1);
        const prevTo = to
            ? new Date(to.getFullYear() - 1, to.getMonth(), to.getDate(), to.getHours(), to.getMinutes())
            : new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 23, 59, 59);
        const where = { ...baseWhere, [axisX]: { gte: prevFrom, lte: prevTo } };
        const rows = await prisma_1.prisma.regEntry.findMany({
            where: where,
            orderBy: { occurredAt: 'asc' },
        });
        const buckets = new Map();
        let total = 0;
        for (const r of rows) {
            const d = this.axisDate(r, axisX);
            if (!d)
                continue;
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
    async listReports(owner, instanceId) {
        const rows = await prisma_1.prisma.regReport.findMany({
            where: { owner: String(owner || ''), instanceId: String(instanceId || '') },
            orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
        });
        return rows.map((r) => {
            let query = {};
            try {
                query = JSON.parse(String(r.query || '{}'));
            }
            catch (e) {
                query = {};
            }
            return { ...r, query, createdAt: r.createdAt.getTime(), updatedAt: r.updatedAt.getTime() };
        });
    }
    async saveReport(input, owner) {
        const name = String(input.name || '').trim().slice(0, 60);
        if (!name)
            return { error: '报表名称不能为空' };
        const instanceId = String(input.instanceId || '');
        const payload = JSON.stringify(input.query || {});
        if (input.id) {
            const existed = await prisma_1.prisma.regReport.findFirst({ where: { id: String(input.id), owner } });
            if (!existed)
                return { error: '报表不存在' };
            const row = await prisma_1.prisma.regReport.update({
                where: { id: existed.id },
                data: { name, query: payload },
            });
            return { id: row.id };
        }
        const row = await prisma_1.prisma.regReport.create({
            data: { owner, instanceId, name, query: payload },
        });
        return { id: row.id };
    }
    async removeReport(id, owner) {
        const existed = await prisma_1.prisma.regReport.findFirst({ where: { id: String(id || ''), owner } });
        if (!existed)
            return { error: '报表不存在' };
        await prisma_1.prisma.regReport.delete({ where: { id: existed.id } });
        return { id: existed.id };
    }
    async listUnits(owner, instanceId) {
        const rows = await prisma_1.prisma.regUnit.findMany({
            where: { owner: String(owner || ''), instanceId: String(instanceId || '') },
            orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
        });
        return rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() }));
    }
    async saveUnit(input, owner) {
        const name = String(input.name || '').trim().slice(0, 24);
        if (!name)
            return { error: '单位名称不能为空' };
        const instanceId = String(input.instanceId || '');
        const existed = input.id
            ? await prisma_1.prisma.regUnit.findFirst({ where: { id: String(input.id), owner } })
            : await prisma_1.prisma.regUnit.findFirst({ where: { owner, instanceId, name } });
        if (existed) {
            const row = await prisma_1.prisma.regUnit.update({
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
        const row = await prisma_1.prisma.regUnit.create({
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
    async removeUnit(id, owner) {
        const existed = await prisma_1.prisma.regUnit.findFirst({ where: { id: String(id || ''), owner } });
        if (!existed)
            return { error: '单位不存在' };
        await prisma_1.prisma.regUnit.delete({ where: { id: existed.id } });
        return { id: existed.id };
    }
    async candidates(owner, instanceId) {
        const [rows, trackers] = await Promise.all([
            prisma_1.prisma.regEntry.findMany({
                where: { owner: String(owner || ''), instanceId: String(instanceId || '') },
                select: { placeName: true, subjectName: true, relatedName: true },
                orderBy: { occurredAt: 'desc' },
                take: 500,
            }),
            prisma_1.prisma.regTracker.findMany({
                where: { owner: String(owner || ''), instanceId: String(instanceId || ''), archived: false },
                select: { unit: true, portion: true },
                take: 500,
            }),
        ]);
        const collect = (key) => {
            const set = new Set();
            for (const r of rows) {
                const v = String(r[key] || '').trim();
                if (v)
                    set.add(v);
            }
            return Array.from(set).slice(0, 50);
        };
        const units = new Set();
        const portions = new Set();
        for (const t of trackers) {
            if (t.unit)
                units.add(String(t.unit).trim());
            if (t.portion)
                portions.add(String(t.portion).trim());
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
    async legendOptions(q) {
        const instanceId = String(q.instanceId || '');
        const axisX = this.axisField(q.axisX);
        const where = { instanceId };
        if (String(q.scope || 'me') !== 'all')
            where.owner = String(q.owner || '');
        if (q.trackerId)
            where.trackerId = String(q.trackerId);
        else if (q.trackerName)
            where.tracker = { name: String(q.trackerName) };
        const from = dateOf(q.from);
        const to = dateOf(q.to);
        if (from || to)
            where[axisX] = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
        const rows = await prisma_1.prisma.regEntry.findMany({
            where: where,
            select: {
                placeName: true,
                subjectName: true,
                relatedName: true,
                tagLinks: { select: { tag: { select: { name: true } } } },
            },
            orderBy: { occurredAt: 'desc' },
            take: 1000,
        });
        const places = new Set();
        const subjects = new Set();
        const related = new Set();
        const tags = new Set();
        for (const r of rows) {
            if (r.placeName)
                places.add(String(r.placeName));
            if (r.subjectName)
                subjects.add(String(r.subjectName));
            if (r.relatedName)
                related.add(String(r.relatedName));
            for (const l of Array.isArray(r.tagLinks) ? r.tagLinks : []) {
                const n = String(l?.tag?.name || '');
                if (n)
                    tags.add(n);
            }
        }
        return {
            places: Array.from(places).slice(0, 100),
            subjects: Array.from(subjects).slice(0, 100),
            related: Array.from(related).slice(0, 100),
            tags: Array.from(tags).slice(0, 100),
        };
    }
    async importRows(rows, owner, instanceId) {
        const ok = [];
        const failed = [];
        for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i] || {};
            const res = await this.createEntry({ ...r, instanceId }, owner);
            if ('error' in res && res.error)
                failed.push({ row: i + 1, message: String(res.error) });
            else
                ok.push(String(res.id));
            if (ok.length + failed.length >= 500)
                break;
        }
        return { ok: ok.length, failed };
    }
};
exports.RegService = RegService;
exports.RegService = RegService = __decorate([
    (0, common_1.Injectable)()
], RegService);
