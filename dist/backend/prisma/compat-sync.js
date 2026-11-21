#!/usr/bin/env node
/**
 * 数据库升级兼容脚本（v3.0.0）
 * ============================================================
 * 为什么需要它：
 *   `prisma db push` 在「新增唯一约束」时可能因为历史重复数据而失败，
 *   报 `A unique constraint covering the columns [...] will be added.
 *   If there are existing duplicate values, this will fail.`，
 *   并且要求加 `--accept-data-loss` 才肯继续。
 *
 *   典型例子（v3.0.0）：tags 的唯一约束从 `name` 单列改为 `name + instanceId`。
 *   老库里如果存在同名标签（历史版本某些路径没有唯一约束、或人工导入过数据），
 *   新约束就建不起来，容器直接启动失败。
 *
 * 做法：
 *   在 db push **之前**先跑一遍本脚本 —— 把重复行合并成一行并把关联数据
 *   （file_tags）重新指向保留下来的那一行，然后再让 db push 建唯一约束。
 *   全程只用原生 SQL，不依赖 Prisma Client 的模型定义，
 *   **可以在「旧结构」的库上安全运行**（列不存在会自动降级判断）。
 *
 * 用法：
 *   node prisma/compat-sync.js          # 执行（entrypoint 自动调用）
 *   node prisma/compat-sync.js --check  # 只报告会处理哪些重复，不改数据
 *
 * 退出码始终为 0（除非连接数据库失败）：兼容处理失败不应该阻塞启动，
 * 让随后的 db push 给出真正的错误信息。
 */
'use strict';

const crypto = require('node:crypto');

const CHECK_ONLY = process.argv.includes('--check');

/** 生成 25 位 cuid 风格 id（Prisma 的 @default(cuid()) 在数据库层没有默认值，原生插入必须自己给） */
function newId() {
  return 'c' + crypto.randomBytes(12).toString('hex');
}

function log(msg) {
  console.log(`[compat] ${msg}`);
}

async function main() {
  let prisma;
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
  } catch (e) {
    log(`跳过：无法加载 @prisma/client（${e && e.message}）`);
    return;
  }

  const q = (sql, ...args) => prisma.$queryRawUnsafe(sql, ...args);

  try {
    // 连通性检查：连不上就别浪费时间（db push 会给出更完整的报错）
    await q('SELECT 1');
  } catch (e) {
    log(`跳过：数据库连接失败（${e && e.message ? String(e.message).split('\n')[0] : e}）`);
    await prisma.$disconnect().catch(() => {});
    return;
  }

  const tableExists = async (t) =>
    (await q('SELECT to_regclass($1) IS NOT NULL AS ok', `public.${t}`))[0].ok === true;
  const columnExists = async (t, c) =>
    (
      await q(
        'SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3',
        'public',
        t,
        c,
      )
    ).length > 0;

  try {
    // ------------------------------------------------------------
    // 规则 1：tags 唯一约束（name[, instanceId][, type]）
    //   · 最旧结构（没有 instanceId 列）→ 按 name 合并
    //   · v3.0.0 结构 → 按 name + instanceId 合并
    //   · v1.0.3 结构（有 type 列）→ 按 name + instanceId + type 合并
    // 合并策略：保留「关联文件最多、创建最早」的那一行，其余行的 file_tags
    // 重新指向保留下来的行（重复关联忽略），随后删除多余标签行。
    // ------------------------------------------------------------
    if (await tableExists('tags')) {
      const hasInstance = await columnExists('tags', 'instanceId');
      const hasType = await columnExists('tags', 'type');
      const keyCols = ['name'];
      if (hasInstance) keyCols.push('"instanceId"');
      if (hasType) keyCols.push('type');
      const keyExpr = keyCols.join(', ');
      const keySelect = keyExpr;

      const groups = await q(
        `SELECT ${keySelect}, count(*)::int AS c
           FROM tags GROUP BY ${keyExpr} HAVING count(*) > 1 ORDER BY c DESC`,
      );

      if (groups.length === 0) {
        log('tags：无重复（唯一约束可安全创建）');
      } else {
        log(`tags：发现 ${groups.length} 组重复标签${CHECK_ONLY ? '（--check 模式，不改数据）' : '，开始合并'}`);
        for (const g of groups) {
          const conds = ['name = $1'];
          const args = [g.name];
          if (hasInstance) {
            args.push(g.instanceId);
            conds.push(`"instanceId" = $${args.length}`);
          }
          if (hasType) {
            args.push(g.type);
            conds.push(`type = $${args.length}`);
          }
          const where = conds.join(' AND ');
          const rows = await q(
            `SELECT t.id, t.metas,
                    (SELECT count(*)::int FROM file_tags ft WHERE ft."tagId" = t.id) AS refs,
                    t."createdAt"
               FROM tags t WHERE ${where}
              ORDER BY refs DESC, t."createdAt" ASC`,
            ...args,
          );
          if (rows.length < 2) continue;
          const [survivor, ...rest] = rows;
          log(`  · 「${g.name}」${rows.length} 行 → 保留 ${survivor.id}`);
          if (CHECK_ONLY) continue;

          // 保留下来的行如果 metas 是空对象，而其它行带内容（如备注），顺手继承一份
          if (!survivor.metas || survivor.metas === '{}') {
            const donor = rest.find((r) => r.metas && r.metas !== '{}');
            if (donor) {
              await prisma.$executeRawUnsafe(
                'UPDATE tags SET metas = $1 WHERE id = $2',
                donor.metas,
                survivor.id,
              );
            }
          }

          for (const r of rest) {
            await prisma.$executeRawUnsafe(
              `INSERT INTO file_tags (id, "fileId", "tagId", "createdAt")
               SELECT $1, ft."fileId", $2, ft."createdAt"
                 FROM file_tags ft
                WHERE ft."tagId" = $3
               ON CONFLICT ("fileId", "tagId") DO NOTHING`,
              newId(),
              survivor.id,
              r.id,
            );
            await prisma.$executeRawUnsafe('DELETE FROM file_tags WHERE "tagId" = $1', r.id);
            await prisma.$executeRawUnsafe('DELETE FROM tags WHERE id = $1', r.id);
          }
        }
      }
    } else {
      log('tags：表不存在（首次安装，跳过）');
    }

    // ------------------------------------------------------------
    // 规则 2：file_tags 重复关联（fileId + tagId）
    //   历史上有过手工导入数据的库可能残留重复行，会让唯一约束建不起来。
    // ------------------------------------------------------------
    if ((await tableExists('file_tags')) && (await tableExists('tags'))) {
      const dupLinks = await q(
        `SELECT count(*)::int AS c FROM (
           SELECT "fileId", "tagId" FROM file_tags GROUP BY 1,2 HAVING count(*) > 1
         ) x`,
      );
      const dupCount = dupLinks[0].c;
      if (dupCount === 0) {
        log('file_tags：无重复关联');
      } else {
        log(`file_tags：发现 ${dupCount} 组重复关联${CHECK_ONLY ? '（--check）' : '，保留最早一条'}`);
        if (!CHECK_ONLY) {
          await prisma.$executeRawUnsafe(
            `DELETE FROM file_tags a
              USING file_tags b
              WHERE a."fileId" = b."fileId"
                AND a."tagId" = b."tagId"
                AND a."createdAt" > b."createdAt"`,
          );
          await prisma.$executeRawUnsafe(
            `DELETE FROM file_tags a
              USING file_tags b
              WHERE a."fileId" = b."fileId"
                AND a."tagId" = b."tagId"
                AND a."createdAt" = b."createdAt"
                AND a.ctid > b.ctid`,
          );
        }
      }
    }

    // ------------------------------------------------------------
    // 规则 4：note_moments.title 独立成列（v1.1.3）
    //   之前瞬间标题存在 notes.metas 的 JSON 里（{"title":"…"}）。
    //   db push 会补出 title 列，但**不会**把老数据搬过去 ——
    //   所以在 db push 之前先建列 + 回填，避免升级后所有老瞬间标题变空。
    //   幂等：列已存在就只补「title 为空、metas 里有值」的行，重复跑无副作用。
    // ------------------------------------------------------------
    if ((await tableExists('note_moments')) && (await tableExists('notes'))) {
      const hasTitle = await columnExists('note_moments', 'title');
      if (!hasTitle) {
        log('note_moments：缺少 title 列，先建列（db push 随后会确认结构一致）');
        if (!CHECK_ONLY) {
          await prisma.$executeRawUnsafe(
            `ALTER TABLE note_moments ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT ''`,
          );
        }
      }
      // 只在能读到 notes 表时回填；metas 用 JS 解析（不用 SQL 的 ::jsonb，
      // 历史上存在过手工写入的非法 JSON，一条坏数据不该让整条 UPDATE 失败）
      let rows = [];
      if (!hasTitle && CHECK_ONLY) {
        // --check 模式下不建列，此时列还不存在，查询必然报错 —— 直接跳过统计
        log('note_moments：title 列尚未创建（--check 模式，跳过回填统计）');
      } else try {
        rows = await q(
          `SELECT m."noteId", n.metas
             FROM note_moments m
             JOIN notes n ON n.id = m."noteId"
            WHERE m.title = '' AND n.metas LIKE '%title%'`,
        );
      } catch (e) {
        log(`note_moments：读取待回填数据失败（${e && e.message ? String(e.message).split('\n')[0] : e}）`);
      }
      if (!rows.length) {
        log('note_moments：无需回填标题');
      } else {
        log(`note_moments：${rows.length} 条瞬间的标题待回填${CHECK_ONLY ? '（--check 模式，不改数据）' : ''}`);
        if (!CHECK_ONLY) {
          let filled = 0;
          let bad = 0;
          for (const r of rows) {
            let title = '';
            try {
              const meta = JSON.parse(r.metas || '{}');
              title = String((meta && meta.title) || '').trim().slice(0, 80);
            } catch (e) {
              bad += 1;
              continue;
            }
            if (!title) continue;
            await prisma.$executeRawUnsafe('UPDATE note_moments SET title = $1 WHERE "noteId" = $2', title, r.noteId);
            filled += 1;
          }
          log(`note_moments：回填完成 ${filled} 条${bad ? `，跳过 ${bad} 条非法 JSON` : ''}`);
        }
      }
    } else {
      log('note_moments：表不存在（首次安装，跳过）');
    }

    // ------------------------------------------------------------
    // 规则 3：users.username 重复（主键/唯一约束级别的老问题）
    //   username 一直是唯一键，正常不会重复；这里只做报告，不动数据。
    // ------------------------------------------------------------
    if (await tableExists('users')) {
      const dupUsers = await q(
        `SELECT username, count(*)::int AS c FROM users GROUP BY username HAVING count(*) > 1`,
      );
      if (dupUsers.length) {
        log(`users：⚠️ 存在 ${dupUsers.length} 组重复用户名，需人工处理（脚本不敢自动合并账户）`);
        for (const u of dupUsers.slice(0, 10)) log(`  · ${u.username} × ${u.c}`);
      }
    }

    // ------------------------------------------------------------
    // 规则 4：登记 v1.3.5.7 —— 条目回归独立表
    //
    //   这一版把「条目」的身份从 markers 收回 reg_trackers，并删掉了几个
    //   冗余列。db push 会直接 DROP 掉这些列，数据必须先在这里搬走：
    //     4.1 reg_entries.tags（JSON 快照）→ tags 主表 + reg_entry_tags
    //     4.2 reg_entries.portion（旧语义「份量」如 元/升）→ 只留 `/` 后的「分母」
    //     4.3 markers(type='register') 的孤儿行清理（不再有内容引用它们）
    // ------------------------------------------------------------
    if (await tableExists('reg_entries')) {
      if ((await columnExists('reg_entries', 'tags')) && (await tableExists('reg_entry_tags')) && (await tableExists('tags'))) {
        const pending = await q(
          `SELECT e.id, e.tags, e."instanceId", e.owner
             FROM reg_entries e
            WHERE e.tags IS NOT NULL AND e.tags <> '' AND e.tags <> '[]'
              AND NOT EXISTS (SELECT 1 FROM reg_entry_tags r WHERE r."entryId" = e.id)`,
        );
        if (!pending.length) {
          log('登记标签：无待搬迁的记录');
        } else {
          log(`登记标签：${pending.length} 条记录的 JSON 标签待搬进 tags 主表${CHECK_ONLY ? '（--check 模式，不改数据）' : ''}`);
          if (!CHECK_ONLY) {
            let linked = 0;
            for (const row of pending) {
              let names = [];
              try {
                const v = JSON.parse(row.tags);
                if (Array.isArray(v)) names = v.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 20);
              } catch (e) {
                names = [];
              }
              const instanceId = String(row.instanceId || '');
              const scope = String(row.owner || '');
              for (const name of names) {
                const hit = await q(
                  'SELECT id FROM tags WHERE name=$1 AND "instanceId"=$2 AND type=$3 AND scope=$4 LIMIT 1',
                  name,
                  instanceId,
                  'register',
                  scope,
                );
                let tagId = hit[0] && hit[0].id;
                if (!tagId) {
                  tagId = newId();
                  await prisma.$executeRawUnsafe(
                    'INSERT INTO tags (id, name, "instanceId", type, owner, scope, metas, "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())',
                    tagId,
                    name,
                    instanceId,
                    'register',
                    scope,
                    scope,
                    '{}',
                  );
                }
                await prisma.$executeRawUnsafe(
                  'INSERT INTO reg_entry_tags ("entryId", "tagId", "createdAt") VALUES ($1,$2,now()) ON CONFLICT DO NOTHING',
                  row.id,
                  tagId,
                );
                linked += 1;
              }
            }
            log(`登记标签：搬迁完成，写入 ${linked} 条关联`);
          }
        }
      } else {
        log('登记标签：列或关联表不存在（已是新结构 / 首次安装，跳过）');
      }

      if (await columnExists('reg_entries', 'portion')) {
        const rows = await q(`SELECT count(*)::int AS c FROM reg_entries WHERE position('/' in portion) > 0`);
        const n = rows[0] ? rows[0].c : 0;
        if (n > 0) {
          log(`登记分母：${n} 条记录的「份量」形如 元/升，取 / 之后的部分作分母${CHECK_ONLY ? '（--check 模式，不改数据）' : ''}`);
          if (!CHECK_ONLY) {
            await prisma.$executeRawUnsafe(
              `UPDATE reg_entries SET portion = btrim(split_part(portion, '/', 2)) WHERE position('/' in portion) > 0`,
            );
          }
        }
      }
    }

    // ------------------------------------------------------------
    // 规则 5：登记 v1.3.5.8 —— reg_entries 去掉口径快照列
    //
    //   条目（reg_trackers）是名称 / 类型 / 单位 / 分母 / 性质的唯一真源，
    //   记录上再存一份 unit / portion / direction 只是冗余快照。db push 会直接
    //   DROP 掉这些列，所以必须在它之前把「条目上还空着、记录里有值」的补回去，
    //   否则老数据会丢掉自己的单位。幂等：只补空值，重复跑无副作用。
    // ------------------------------------------------------------
    if ((await tableExists('reg_entries')) && (await tableExists('reg_trackers'))) {
      const moves = [
        { col: 'unit', label: '单位' },
        { col: 'portion', label: '分母' },
        { col: 'direction', label: '性质' },
      ];
      for (const m of moves) {
        if (!(await columnExists('reg_entries', m.col))) continue;
        const emptyCond = m.col === 'direction' ? `t.direction = 0` : `(t.${m.col} IS NULL OR t.${m.col} = '')`;
        const pickCond = m.col === 'direction' ? `e.direction <> 0` : `(e.${m.col} IS NOT NULL AND e.${m.col} <> '')`;
        const rows = await q(
          `SELECT count(*)::int AS c
             FROM reg_trackers t
            WHERE ${emptyCond}
              AND EXISTS (SELECT 1 FROM reg_entries e WHERE e."trackerId" = t.id AND ${pickCond})`,
        );
        const n = rows[0] ? rows[0].c : 0;
        if (!n) {
          log(`登记口径：条目${m.label}无需回填`);
          continue;
        }
        log(`登记口径：${n} 个条目的${m.label}可从历史记录补齐${CHECK_ONLY ? '（--check 模式，不改数据）' : ''}`);
        if (CHECK_ONLY) continue;
        const updated = await prisma.$executeRawUnsafe(
          `UPDATE reg_trackers t
              SET ${m.col} = (
                    SELECT e.${m.col} FROM reg_entries e
                     WHERE e."trackerId" = t.id AND ${pickCond}
                     ORDER BY e."occurredAt" DESC LIMIT 1
                  )
            WHERE ${emptyCond}
              AND EXISTS (SELECT 1 FROM reg_entries e WHERE e."trackerId" = t.id AND ${pickCond})`,
        );
        log(`登记口径：${m.label}回填 ${updated} 个条目`);
      }
    }

    // ------------------------------------------------------------
    // 规则 6：登记 v1.3.5.9 —— 「性质」从条目迁到每一条记录
    //
    //   旧版把 direction 存在 reg_trackers 上（一个条目一个性质），新版改为
    //   每条登记各自带性质。db push 会 DROP reg_trackers.direction，所以在它之前
    //   必须先把条目上的性质复制到它名下每条记录的 direction 列。
    //   列可能还不存在（老库）：先 ADD COLUMN IF NOT EXISTS，再回填。
    //   幂等：只补 direction = 0 的记录，重复跑无副作用。
    // ------------------------------------------------------------
    if ((await tableExists('reg_entries')) && (await tableExists('reg_trackers'))) {
      const hasTrackerDir = await columnExists('reg_trackers', 'direction');
      const hasEntryDir = await columnExists('reg_entries', 'direction');
      if (hasTrackerDir && !hasEntryDir) {
        if (CHECK_ONLY) {
          log('登记性质：需要把 reg_entries.direction 建出来并从条目回填（--check 模式，不改数据）');
        } else {
          await prisma.$executeRawUnsafe(
            'ALTER TABLE reg_entries ADD COLUMN IF NOT EXISTS direction integer NOT NULL DEFAULT 0',
          );
          log('登记性质：已新增 reg_entries.direction 列');
        }
      }
      if (hasTrackerDir) {
        const rows = await q(
          `SELECT count(*)::int AS c
             FROM reg_entries e
             JOIN reg_trackers t ON t.id = e."trackerId"
            WHERE e.direction = 0 AND t.direction <> 0`,
        );
        const n = rows[0] ? rows[0].c : 0;
        if (n > 0) {
          log(`登记性质：${n} 条记录可从条目补齐${CHECK_ONLY ? '（--check 模式，不改数据）' : ''}`);
          if (!CHECK_ONLY) {
            const updated = await prisma.$executeRawUnsafe(
              `UPDATE reg_entries e
                  SET direction = t.direction
                 FROM reg_trackers t
                WHERE t.id = e."trackerId" AND e.direction = 0 AND t.direction <> 0`,
            );
            log(`登记性质：回填 ${updated} 条记录`);
          }
        } else {
          log('登记性质：记录无需回填');
        }
      }
    }

    if ((await tableExists('markers')) && (await tableExists('note_markers'))) {
      const own = await q(`SELECT count(*)::int AS c FROM markers WHERE type = 'register'`);
      const n = own[0] ? own[0].c : 0;
      if (n > 0) {
        log(`markers：${n} 条 type='register' 的历史行（登记已改用独立条目表）${CHECK_ONLY ? '（--check 模式，不改数据）' : '，清理无引用的孤儿行'}`);
        if (!CHECK_ONLY) {
          const del = await prisma.$executeRawUnsafe(
            `DELETE FROM markers m WHERE m.type = 'register'
               AND NOT EXISTS (SELECT 1 FROM note_markers nm WHERE nm."markerId" = m.id)`,
          );
          log(`markers：已清理 ${del} 行`);
        }
      }
    }

    log(CHECK_ONLY ? '检查完成（未修改任何数据）' : '兼容处理完成');
  } catch (e) {
    log(`兼容处理异常（已忽略，继续执行 db push）：${e && e.message ? String(e.message).split('\n')[0] : e}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().then(
  () => process.exit(0),
  () => process.exit(0),
);
