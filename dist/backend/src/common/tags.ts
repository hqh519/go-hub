import { prisma } from './prisma';

/**
 * 标签作用域（v1.0.2 重构）。
 *
 * 旧的隔离维度是「实例 + 创建人（owner）」：同一个实例里，A 建的「猫咪」和 B 建的「猫咪」
 * 是两条互不相干的标签，跨实例移动文件时只能连带复制一份过去。
 *
 * 新的模型：**实例 + 类型 + 名称** 才是标签的身份，owner 只用来记录「谁最先创建」。
 *   · 同一实例内同名标签只有一条，所有成员共用（团队空间语义）；
 *   · 不同实例天然隔离，A 实例的标签不会出现在 B 实例；
 *   · type 为后续内容系统预留（file / note / article / todo / nav …），
 *     不同类型的同名标签互不影响（「猫咪」可以同时是文件标签和笔记标签）。
 *
 * 唯一性由应用层保证：数据库不建 (instanceId, type, name) 唯一索引，
 * 原因是老库里同名标签可能分属多个 owner，直接加唯一索引会让 upgrade 时 db push 失败。
 * 历史重复数据由启动时的合并逻辑处理（tag-dedupe）。
 */
export const TAG_TYPE_FILE = 'file';

export type TagScope = { instanceId: string; type: string };

/** 生成标签查询作用域（默认文件标签） */
export function tagScope(instanceId: string, type: string = TAG_TYPE_FILE): TagScope {
  return { instanceId: String(instanceId || ''), type: String(type || TAG_TYPE_FILE) };
}

type TagRow = { id: string; name: string; instanceId: string; type?: string; owner: string; metas?: string };

/**
 * 取标签（不存在则创建）。按「实例 + 类型 + 名称」定位，取最早创建的那条。
 *
 * @param name      标签名（已 trim）
 * @param instanceId 所属实例（空串 = 默认实例）
 * @param operator  创建人（只在新建时写入 owner，仅作记录）
 * @param type      标签类型（默认 file）
 */
export async function findOrCreateTag(
  name: string,
  instanceId: string,
  operator = '',
  type: string = TAG_TYPE_FILE,
): Promise<TagRow> {
  const n = String(name || '').trim();
  const scope = tagScope(instanceId, type);
  const existed = await prisma.tag.findFirst({
    where: { ...scope, name: n },
    orderBy: { createdAt: 'asc' },
  });
  if (existed) return existed as unknown as TagRow;
  try {
    return (await prisma.tag.create({
      data: { name: n, instanceId: scope.instanceId, type: scope.type, owner: String(operator || '') },
    })) as unknown as TagRow;
  } catch {
    // 并发下可能被别人先建（或命中旧的复合唯一键）→ 再查一次
    const again = await prisma.tag.findFirst({ where: { ...scope, name: n }, orderBy: { createdAt: 'asc' } });
    if (again) return again as unknown as TagRow;
    throw new Error(`标签创建失败：${n}`);
  }
}

/**
 * 启动时合并历史重复标签（v1.0.2 迁移）。
 *
 * 旧模型按「实例 + owner」隔离，同一个实例里 A 的「猫咪」和 B 的「猫咪」是两条不同记录。
 * 新模型下它们应该是一条：这里按 (instanceId, type, name) 分组，
 * 保留最早创建的那条，把其余记录的 file_tags 关联迁过去，然后删掉重复行。
 * 幂等：没有重复时直接返回 0，不会改动任何数据。
 *
 * @returns 被合并（删除）的重复标签条数
 */
export async function mergeDuplicateTags(): Promise<number> {
  let merged = 0;
  try {
    const rows = (await prisma.tag.findMany({ orderBy: { createdAt: 'asc' } })) as unknown as (TagRow & {
      createdAt?: Date;
    })[];
    const groups = new Map<string, TagRow[]>();
    for (const r of rows) {
      const key = `${String(r.instanceId || '')}\u0000${String(r.type || TAG_TYPE_FILE)}\u0000${r.name}`;
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const [keep, ...dupes] = list;
      for (const dup of dupes) {
        const links = await prisma.fileTag.findMany({ where: { tagId: dup.id } });
        for (const link of links) {
          const exists = await prisma.fileTag.findFirst({
            where: { fileId: link.fileId, tagId: keep.id },
            select: { id: true },
          });
          if (exists) await prisma.fileTag.delete({ where: { id: link.id } });
          else await prisma.fileTag.update({ where: { id: link.id }, data: { tagId: keep.id } });
        }
        await prisma.tag.delete({ where: { id: dup.id } }).catch(() => undefined);
        merged += 1;
      }
    }
  } catch {
    // 表还没建 / 旧库缺列 → 静默跳过，不影响启动
  }
  return merged;
}
