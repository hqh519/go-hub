import { prisma } from './prisma';

/**
 * 标记（v1.3.5.1）—— 独立于「标签」的第二套标签体系。
 *
 * 与 Tag 完全同构：身份 = 名称 + 实例 + 内容类型 + 账户（scope）。
 * 区别只在业务层：一条内容只能有一个标记，且标记通常用于记录长名称
 * （如「番茄二年级上学期语文考试成绩」）以便把同一跟进事项串起来。
 *
 * 重要：本模块只管「标记本身」。登记功能要用的类型 / 单位 / 计算规则
 * 另存在登记的登记表里，通过标记名关联，绝不往 markers 表塞计算字段 ——
 * markers 会被瞬间 / 笔记 / 文章 / 待办共用，混入计算字段会污染其它内容。
 */
export const MARKER_TYPE_MOMENT = 'moment';

/** 内容 kind → 标记 type（与标签的 tagTypeOfKind 同一套思路，但保留原始 kind） */
export function markerTypeOfKind(kind: string): string {
  const k = String(kind || '').trim();
  return k || MARKER_TYPE_MOMENT;
}

/** 「用户 + 实例 + 类型」的收口，与 tagScope 同口径 */
export function markerScope(instanceId: string, type: string, owner: string) {
  return {
    instanceId: String(instanceId || ''),
    type: String(type || MARKER_TYPE_MOMENT),
    scope: String(owner || ''),
  };
}

/** 先查后建，撞唯一键时回查一次（并发安全，和 findOrCreateTag 一致） */
export async function findOrCreateMarker(
  name: string,
  instanceId: string,
  operator: string,
  type: string,
): Promise<{ id: string; name: string } | null> {
  const n = String(name || '').trim();
  if (!n) return null;
  const scope = markerScope(instanceId, type, operator);
  const existed = await prisma.marker.findFirst({ where: { ...scope, name: n } });
  if (existed) return { id: existed.id, name: existed.name };
  try {
    const created = await prisma.marker.upsert({
      where: { name_instanceId_type_scope: { name: n, ...scope } },
      update: {},
      create: { name: n, ...scope, owner: String(operator || '') },
    });
    return { id: created.id, name: created.name };
  } catch {
    const again = await prisma.marker.findFirst({ where: { ...scope, name: n } });
    return again ? { id: again.id, name: again.name } : null;
  }
}

/** 候选列表：只取当前账户 + 当前实例 + 当前内容类型下的标记 */
export async function markerCandidates(
  instanceId: string,
  viewer: string,
  type: string,
  keyword = '',
): Promise<{ id: string; name: string; count: number }[]> {
  const scope = markerScope(instanceId, type, viewer);
  const kw = String(keyword || '').trim();
  const rows = await prisma.marker.findMany({
    where: {
      ...scope,
      ...(kw ? { name: { contains: kw } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, name: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, count: 0 }));
}
