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
