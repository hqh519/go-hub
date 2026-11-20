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
 * v1.0.3：唯一性已下沉到数据库层 —— schema 里是
 *   `@@unique([name, instanceId, type])`（旧键 [name, instanceId, owner] 已删除）。
 *   升级前由 prisma/compat-sync.js 先合并历史重复，因此 db push 不会因重复数据失败。
 *   应用层仍保留「先查后建」的写法：并发插入撞唯一键时回查一次，不把错误抛给调用方。
 */
export const TAG_TYPE_FILE = 'file';
/** v1.1.6：笔记（memo）标签 —— 与文件标签同名也是两条记录，且按账户隔离 */
export const TAG_TYPE_NOTE = 'note';
/**
 * v1.3.1.2（需求：标签要按「用户 + 实例 + 内容类型」三层隔离）
 *
 * 原来瞬间和笔记共用 type='note'，于是「瞬间里建的 #灵感」会出现在笔记的候选里。
 * 内容类型本身就是标签的天然分区，加一个独立 type 即可，不需要新表：
 *   file / note(memo) / moment / article / todo / nav …
 * 三者叠加后才是完整身份：type（内容类型）+ instanceId（实例）+ scope（账户）。
 */
export const TAG_TYPE_MOMENT = 'moment';
/** v1.3.5.6：登记标签 —— 身份统一存 tags 表，关联走 reg_entry_tags */
export const TAG_TYPE_REGISTER = 'register';

/** 内容种类 → 标签类型（以后加文章 / 待办 / 导航，只改这张映射表） */
export function tagTypeOfKind(kind: string): string {
  switch (String(kind || '')) {
    case 'moment':
      return TAG_TYPE_MOMENT;
    case 'article':
      return 'article';
    case 'todo':
      return 'todo';
    case 'nav':
      return 'nav';
    case 'register':
      return TAG_TYPE_REGISTER;
    case 'note':
    case 'memo':
      return TAG_TYPE_NOTE;
    default:
      return TAG_TYPE_NOTE;
  }
}

export type TagScope = { instanceId: string; type: string; scope: string };

/**
 * 生成标签查询作用域。
 *
 * v1.1.6 起多一个 `scope` 维度：
 *   · 文件标签恒为 ''（实例内共用一套，团队语义不变）；
 *   · 笔记标签填 owner（笔记是私有的，标签必须跟着人走）。
 */
export function tagScope(instanceId: string, type: string = TAG_TYPE_FILE, owner = ''): TagScope {
  const t = String(type || TAG_TYPE_FILE);
  return {
    instanceId: String(instanceId || ''),
    type: t,
    /*
     * v1.3.1.2：作用域从「只有笔记按账户」扩成「除文件之外的都按账户」。
     * 瞬间、文章、待办同样是私有内容，标签不能跨账户共用；
     * 文件标签保持实例内共用的团队语义（scope 恒空）。
     */
    scope: t === TAG_TYPE_FILE ? '' : String(owner || ''),
  };
}

export type TagRow = { id: string; name: string; instanceId: string; type?: string; owner: string; metas?: string };

/**
 * 取标签（不存在则创建）。按「实例 + 类型 + 作用域 + 名称」定位，取最早创建的那条。
 *
 * @param name      标签名（已 trim）
 * @param instanceId 所属实例（空串 = 默认实例）
 * @param operator  操作人：新建时写入 owner；type='note' 时同时作为隔离作用域
 * @param type      标签类型（默认 file）
 */
export async function findOrCreateTag(
  name: string,
  instanceId: string,
  operator = '',
  type: string = TAG_TYPE_FILE,
): Promise<TagRow> {
  const n = String(name || '').trim();
  const scope = tagScope(instanceId, type, operator);
  const existed = await prisma.tag.findFirst({
    where: { ...scope, name: n },
    orderBy: { createdAt: 'asc' },
  });
  if (existed) return existed as unknown as TagRow;
  try {
    // v1.1.6：唯一键扩到 (name, instanceId, type, scope)，upsert 一并带上
    const created = await prisma.tag.upsert({
      where: {
        name_instanceId_type_scope: {
          name: n,
          instanceId: scope.instanceId,
          type: scope.type,
          scope: scope.scope,
        },
      },
      update: {},
      create: {
        name: n,
        instanceId: scope.instanceId,
        type: scope.type,
        scope: scope.scope,
        owner: String(operator || ''),
      },
    });
    return created as unknown as TagRow;
  } catch {
    // 兜底：极端情况下（老库结构未同步）再查一次
    const again = await prisma.tag.findFirst({ where: { ...scope, name: n }, orderBy: { createdAt: 'asc' } });
    if (again) return again as unknown as TagRow;
    throw new Error(`标签创建失败：${n}`);
  }
}

/**
 * 启动时合并历史重复标签（v1.0.2 迁移，v1.1.6 补 scope 维度）。
 *
 * 旧模型按「实例 + owner」隔离，同一个实例里 A 的「猫咪」和 B 的「猫咪」是两条不同记录。
 * 新模型下文件标签应该是一条：这里按 (instanceId, type, scope, name) 分组，
 * 保留最早创建的那条，把其余记录的关联（file_tags / note_tags）迁过去，然后删掉重复行。
 *
 * v1.1.6：分组键加上 scope —— 否则刚刚按账户拆开的笔记标签会在下一次启动时被合并回去。
 * 幂等：没有重复时直接返回 0，不会改动任何数据。
 *
 * @returns 被合并（删除）的重复标签条数
 */
export async function mergeDuplicateTags(): Promise<number> {
  let merged = 0;
  try {
    const rows = (await prisma.tag.findMany({ orderBy: { createdAt: 'asc' } })) as unknown as (TagRow & {
      createdAt?: Date;
      scope?: string;
    })[];
    const groups = new Map<string, TagRow[]>();
    for (const r of rows) {
      const key = `${String(r.instanceId || '')}\u0000${String(r.type || TAG_TYPE_FILE)}\u0000${String(
        (r as { scope?: string }).scope || '',
      )}\u0000${r.name}`;
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
        const noteLinks = await prisma.noteTag.findMany({ where: { tagId: dup.id } });
        for (const link of noteLinks) {
          const exists = await prisma.noteTag.findUnique({
            where: { noteId_tagId: { noteId: link.noteId, tagId: keep.id } },
            select: { noteId: true },
          });
          if (exists) await prisma.noteTag.delete({ where: { noteId_tagId: { noteId: link.noteId, tagId: dup.id } } });
          else await prisma.noteTag.update({ where: { noteId_tagId: { noteId: link.noteId, tagId: dup.id } }, data: { tagId: keep.id } });
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

/**
 * v1.1.6 启动迁移：把「多账户共用一条笔记标签」的历史数据按笔记作者拆开。
 *
 * 背景：v1.1.6 之前笔记标签和文件标签共用一条记录（身份 = 实例 + 类型 + 名称），
 * 于是 A、B 两人用同一个标签名会落到同一行 —— 改名 / 删除互相影响，创建人还会暴露。
 * 新模型给笔记标签加了 `scope = 用户名`，这里把历史行按关联笔记的作者拆分：
 *   · 单作者的行：直接把 scope 补成作者名（最常见的升级路径，只改一行，不动关联）；
 *   · 多作者的行：作者 A（最早关联的那个，通常是创建人）留下，其余作者各自新建一条，
 *     并把属于他们的 note_tags 关联迁过去。
 * 幂等：scope 已经等于作者名的行会被跳过，重复启动不会产生新行。
 *
 * @returns 新建 / 修正的标签行数
 */
/**
 * v1.3.1.2：把历史上「瞬间与笔记共用 type='note'」的标签拆开。
 *
 * 规则（幂等）：
 *   · 一条 note 标签只被 moment 用过 → 整条改成 type='moment'（连带 scope 已经有了，不动）；
 *   · 同时被 moment 与 memo 用过 → 保留 note 那条给 memo，另建一条 moment 给瞬间，
 *     把瞬间的关联挪过去；
 *   · 只被 memo 用过 / 没有关联 → 保持 note 不动。
 *
 * 为什么不在查询处「兼容旧数据」：那会让候选列表同时出现两份同名标签，
 * 用户改了一个另一个不变，长期更难收拾 —— 一次性搬干净，之后只有一套口径。
 */
export async function splitMomentTags(): Promise<number> {
  let fixed = 0;
  try {
    const tags = await prisma.tag.findMany({ where: { type: TAG_TYPE_NOTE } });
    for (const tag of tags) {
      const links = await prisma.noteTag.findMany({
        where: { tagId: tag.id },
        select: { noteId: true, note: { select: { kind: true, author: true } } },
      });
      if (!links.length) continue;
      const momentLinks = links.filter((l) => String(l.note?.kind || '') === 'moment');
      const memoLinks = links.filter((l) => String(l.note?.kind || '') !== 'moment');
      if (!momentLinks.length) continue;
      if (!memoLinks.length) {
        // 纯瞬间标签：整条换成 moment
        await prisma.tag.update({ where: { id: tag.id }, data: { type: TAG_TYPE_MOMENT } }).catch(() => undefined);
        fixed += 1;
        continue;
      }
      /*
       * 混合标签：按作者拆。moment 侧的作者可能不止一个，逐个建 moment 标签再挪关联；
       * 原 note 标签留给 memo 侧，scope 不变（原本就是 memo 作者的隔离域）。
       */
      const authors = Array.from(new Set(momentLinks.map((l) => String(l.note?.author || '')).filter(Boolean)));
      for (const author of authors) {
        const row = await findOrCreateTag(tag.name, String(tag.instanceId || ''), author, TAG_TYPE_MOMENT);
        const mine = momentLinks.filter((l) => String(l.note?.author || '') === author);
        for (const link of mine) {
          const exists = await prisma.noteTag.findUnique({
            where: { noteId_tagId: { noteId: link.noteId, tagId: row.id } },
            select: { noteId: true },
          });
          if (exists) {
            await prisma.noteTag
              .delete({ where: { noteId_tagId: { noteId: link.noteId, tagId: tag.id } } })
              .catch(() => undefined);
          } else {
            await prisma.noteTag
              .update({ where: { noteId_tagId: { noteId: link.noteId, tagId: tag.id } }, data: { tagId: row.id } })
              .catch(() => undefined);
          }
        }
      }
      fixed += 1;
    }
  } catch (e) {
    console.warn(`[tag] 瞬间标签拆分失败：${(e as Error)?.message || e}`);
  }
  return fixed;
}

export async function splitSharedNoteTags(): Promise<number> {
  let fixed = 0;
  try {
    const tags = await prisma.tag.findMany({ where: { type: TAG_TYPE_NOTE } });
    for (const tag of tags) {
      const links = await prisma.noteTag.findMany({
        where: { tagId: tag.id },
        select: { noteId: true, note: { select: { author: true } } },
      });
      const authors = Array.from(
        new Set(links.map((l) => String(l.note?.author || '')).filter(Boolean)),
      ).sort();
      if (!authors.length) {
        // 没有任何关联：按创建人归位，避免变成没人看得见的孤儿标签
        const want = String(tag.owner || '');
        if (want && String(tag.scope || '') !== want) {
          await prisma.tag.update({ where: { id: tag.id }, data: { scope: want } }).catch(() => undefined);
          fixed += 1;
        }
        continue;
      }
      const owner = String(tag.owner || '');
      // 留下的那一行归给「创建人」，创建人不在关联作者里则归最早那个
      const keeper = authors.includes(owner) ? owner : authors[0];
      if (String(tag.scope || '') !== keeper) {
        await prisma.tag.update({ where: { id: tag.id }, data: { scope: keeper } }).catch(() => undefined);
        fixed += 1;
      }
      for (const author of authors) {
        if (author === keeper) continue;
        const row = await findOrCreateTag(tag.name, String(tag.instanceId || ''), author, TAG_TYPE_NOTE);
        const mine = links.filter((l) => String(l.note?.author || '') === author);
        for (const link of mine) {
          const exists = await prisma.noteTag.findUnique({
            where: { noteId_tagId: { noteId: link.noteId, tagId: row.id } },
            select: { noteId: true },
          });
          if (exists) {
            await prisma.noteTag
              .delete({ where: { noteId_tagId: { noteId: link.noteId, tagId: tag.id } } })
              .catch(() => undefined);
          } else {
            await prisma.noteTag
              .update({ where: { noteId_tagId: { noteId: link.noteId, tagId: tag.id } }, data: { tagId: row.id } })
              .catch(() => undefined);
          }
        }
        fixed += 1;
      }
    }
  } catch {
    // 表结构未同步（老库）→ 静默跳过
  }
  return fixed;
}
