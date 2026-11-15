/**
 * 笔记板块 service 冒烟（v1.3.1）
 * 直接调服务层，不经过 HTTP —— 覆盖目录 / 笔记 / 乐观锁 / 块索引 / 引用 / 反链。
 * 用法：cd debug/backend && node tools/smoke-memo.js
 * 测试数据全部以 __SMOKE 前缀标记，跑完自动清理。
 */
const fs = require('fs');
const path = require('path');

// 手动加载 .env（Prisma Client 自己不读 .env，只有 CLI 读）
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
}

const { MemoService } = require('../build/notes/memo.service.js');
const { prisma } = require('../build/common/prisma.js');

const VIEWER = '__SMOKE_user';
const INST = '';

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
    if (cond) {
        pass += 1;
        console.log(`  ✓ ${name}`);
    } else {
        fail += 1;
        console.log(`  ✗ ${name}${extra !== undefined ? ` —— ${JSON.stringify(extra)}` : ''}`);
    }
}

/** createFolder / updateFolder 都返回 { folder }，取 id 要过一层 */
const fid = (r) => (r && r.folder && r.folder.id) || undefined;

(async () => {
    const svc = new MemoService();

    // 先清一遍历史残留，避免上次中断的脏数据干扰
    for (const f of await prisma.memoFolder.findMany({ where: { author: VIEWER } })) {
        await svc.deleteFolder(VIEWER, f.instanceId || '', f.id).catch(() => undefined);
    }
    for (const n of await prisma.note.findMany({ where: { author: VIEWER } })) {
        await svc.purge(VIEWER, n.instanceId || '', n.id).catch(() => undefined);
    }

    console.log('\n=== 1. 目录（无限层级） ===');
    const f1r = await svc.createFolder(VIEWER, INST, { name: '__SMOKE_A', parentId: '' });
    const f1 = fid(f1r);
    const f2 = fid(await svc.createFolder(VIEWER, INST, { name: '__SMOKE_B', parentId: f1 }));
    const f3 = fid(await svc.createFolder(VIEWER, INST, { name: '__SMOKE_C', parentId: f2 }));
    ok('建三级目录', !!(f1 && f2 && f3), { f1, f2, f3 });
    const tree = await svc.listFolders(VIEWER, INST);
    ok('目录树返回 3 个', tree.folders.length === 3, tree.folders.length);
    const cyc = await svc.updateFolder(VIEWER, INST, f1, { parentId: f3 });
    ok('环检测拦住（父移到孙下）', !!cyc.error, cyc);
    const self = await svc.updateFolder(VIEWER, INST, f1, { parentId: f1 });
    ok('自引用被拦住', !!self.error, self);
    const dup = await svc.createFolder(VIEWER, INST, { name: '__SMOKE_B', parentId: f1 });
    ok('同名目录允许（不同父级）', !dup.error, dup);

    console.log('\n=== 2. 笔记 + 乐观锁 ===');
    const md = [
        '# 冒烟标题',
        '',
        '第一段内容',
        '',
        '- 列表项一',
        '  - 子项',
        '- 列表项二',
        '',
        '> 一段引用',
        '',
        '```js',
        'const a = 1;',
        '```',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        ':::callout{type=tip}',
        '提示内容',
        ':::',
        '',
        '![图](/file/x){width=600}',
    ].join('\n');
    const note = await svc.createNote(VIEWER, INST, { title: '__SMOKE_N1', content: md, folderId: f3 });
    ok('建笔记', !!note.id, note);
    ok('新建 version=1', note.version === 1, note.version);

    const saved = await svc.saveNote(VIEWER, INST, note.id, { content: md, version: note.version });
    ok('保存成功且 version+1', saved.version === 2, saved);
    const conflict = await svc.saveNote(VIEWER, INST, note.id, { content: md, version: note.version });
    ok('旧版本号 → 冲突', !!conflict.conflict, conflict);
    const detail = await svc.getNote(VIEWER, INST, note.id);
    ok('冲突未落库（版本仍是 2）', detail.version === 2, detail.version);

    console.log('\n=== 3. 块索引 ===');
    const blocks = await svc.listBlocks(note.id, VIEWER, INST);
    const bl = blocks.blocks || [];
    ok('块列表非空', bl.length >= 9, bl.length);
    const types = new Set(bl.map((b) => b.blockType));
    for (const t of ['heading', 'paragraph', 'listItem', 'blockquote', 'codeBlock', 'table', 'callout', 'image']) {
        ok(`含 ${t}`, types.has(t), [...types]);
    }
    const child = bl.find((b) => b.blockType === 'listItem' && b.depth > 0);
    ok('嵌套列表有 parentBlockId', !!(child && child.parentBlockId), child);
    const callout = bl.find((b) => b.blockType === 'callout');
    const calloutChild = bl.find((b) => b.parentBlockId === (callout && callout.blockId));
    ok('callout 内部块挂在 callout 下', !!calloutChild, { callout, calloutChild });
    ok('块顺序连续递增', bl.every((b, i) => b.blockOrder === i), bl.map((b) => b.blockOrder));
    const headingBlock = bl.find((b) => b.blockType === 'heading');
    ok('标题层级记录', headingBlock.headingLevel === 1, headingBlock);

    console.log('\n=== 4. 块定位与引用 ===');
    const firstBlock = bl[0];
    const resolved = await svc.resolveBlock(firstBlock.blockId, VIEWER, INST);
    ok('按 blockId 定位成功', resolved.blockId === firstBlock.blockId, resolved);
    const miss = await svc.resolveBlock('blk_00000000', VIEWER, INST);
    ok('不存在的块 → 报错', !!miss.error, miss);

    const titleBlock = bl.find((b) => b.blockType === 'heading');
    const mdRef = `${md}\n\n参见 ((${titleBlock.blockId})) 和 [[note:${note.id}|自己]]`;
    const s2 = await svc.saveNote(VIEWER, INST, note.id, { content: mdRef, version: saved.version });
    ok('带引用保存成功', !s2.error && !s2.conflict, s2);
    const links = await prisma.noteLink.findMany({ where: { sourceNoteId: note.id } });
    ok('引用关系已写入（块引用 + 笔记引用）', links.length === 2, links.map((l) => l.linkType));
    ok('块引用记到 targetBlockId', links.some((l) => l.targetBlockId === titleBlock.blockId), links);

    console.log('\n=== 5. 反链 ===');
    const blk = await svc.backlinks(note.id, VIEWER, INST);
    ok('反链接口可用', !!blk && !blk.error && Array.isArray(blk.backlinks), blk);
    ok('自己引自己不算反链', (blk.backlinks || []).every((b) => b.noteId !== note.id), blk.backlinks);

    console.log('\n=== 6. 索引重建稳定性 ===');
    const before = bl.map((b) => b.blockId).join(',');
    await svc.rebuildNoteIndex(note.id, md, VIEWER, INST);
    const mid = (await svc.listBlocks(note.id, VIEWER, INST)).blocks.map((b) => b.blockId).join(',');
    ok('同内容重建后 blockId 不变', before === mid, { before, mid });
    await svc.rebuildNoteIndex(note.id, md, VIEWER, INST);
    const mid2 = (await svc.listBlocks(note.id, VIEWER, INST)).blocks.map((b) => b.blockId).join(',');
    ok('连续两次重建同样稳定', mid === mid2);
    // 中间插入一段：其余块应认领回原 id
    const mdShift = md.replace('第一段内容', '第一段内容\n\n插进来的一段');
    await svc.rebuildNoteIndex(note.id, mdShift, VIEWER, INST);
    const after = (await svc.listBlocks(note.id, VIEWER, INST)).blocks;
    ok('插入新段后块数 +1', after.length === bl.length + 1, { before: bl.length, after: after.length });
    ok('标题块 ID 未漂移', after.find((b) => b.blockType === 'heading').blockId === titleBlock.blockId);

    console.log('\n=== 7. 块 ID 写入（设置开） ===');
    const setKey = `note-settings:${INST || '~default'}`;
    // 这个 key 是「实例级」的，跑完必须还原，否则会把开发环境里真人用户的编辑器设置改掉
    const prevSetting = await prisma.setting.findUnique({ where: { key: setKey } });
    await prisma.setting.upsert({
        where: { key: setKey },
        update: { value: JSON.stringify({ editor: { blockIds: true } }) },
        create: { key: setKey, value: JSON.stringify({ editor: { blockIds: true } }) },
    });
    const n2 = await svc.createNote(VIEWER, INST, { title: '__SMOKE_N2', content: md });
    const n2d = await svc.getNote(VIEWER, INST, n2.id);
    ok('正文带 ^blk_ 标记', /\^blk_[0-9a-f]{8}/.test(n2d.content), n2d.content.slice(-160));
    const n2b = (await svc.listBlocks(n2.id, VIEWER, INST)).blocks;
    const mdIds = (n2d.content.match(/\^blk_[0-9a-f]{8}/g) || []).map((s) => s.slice(1));
    ok('正文里每个标记都能对上块', mdIds.every((id) => n2b.some((b) => b.blockId === id)), {
        mdIds,
        blocks: n2b.map((b) => b.blockId),
    });
    /*
     * 表格与代码块**故意不塞行内标记**：`^blk_x` 落进单元格/代码里会被原样显示，
     * 所以它们的 blockId 走「内容哈希派生」。这条断言把该设计钉死。
     */
    const derived = n2b.filter((b) => !mdIds.includes(b.blockId)).map((b) => b.blockType).sort();
    ok('表格 / 代码块用派生 ID', derived.join(',') === 'codeBlock,table', derived);
    ok('块总数与解析一致', n2b.length === 11, n2b.length);
    const s3 = await svc.saveNote(VIEWER, INST, n2.id, { content: n2d.content, version: n2d.version });
    const n2c = (await svc.listBlocks(n2.id, VIEWER, INST)).blocks;
    ok('带 ID 保存后 blockId 不变', n2c.map((b) => b.blockId).join() === n2b.map((b) => b.blockId).join(), s3);
    // 关掉开关，把实例设置还原成跑之前的样子
    if (prevSetting) {
        await prisma.setting.update({ where: { key: setKey }, data: { value: prevSetting.value } });
    } else {
        await prisma.setting.deleteMany({ where: { key: setKey } });
    }

    console.log('\n=== 8. 全量重建 ===');
    const all = await svc.rebuildAllIndex(VIEWER, INST);
    ok('全量重建不报错', !all.error, all);

    console.log('\n=== 9. 回收站 / 删除 ===');
    await svc.trash(VIEWER, INST, note.id);
    const trashed = await svc.listNotes({ viewer: VIEWER, instanceId: INST, status: 'deleted', page: 1, pageSize: 10 });
    ok('回收站能看到', trashed.list.some((n) => n.id === note.id), trashed.list.map((n) => n.id));
    const trashedBlocks = await svc.resolveBlock(titleBlock.blockId, VIEWER, INST);
    ok('回收站里的笔记块不可定位', !!trashedBlocks.error, trashedBlocks);
    await svc.restore(VIEWER, INST, note.id);
    const back = await svc.getNote(VIEWER, INST, note.id);
    ok('恢复后读得到', !!back && back.status !== 'deleted', back && back.status);
    const purged = await svc.purge(VIEWER, INST, note.id);
    ok('彻底删除', purged.ok === true, purged);
    const gone = await svc.getNote(VIEWER, INST, note.id);
    ok('删除后详情为空', !gone);
    const orphanBlocks = await prisma.noteBlock.count({ where: { noteId: note.id } });
    const orphanLinks = await prisma.noteLink.count({ where: { sourceNoteId: note.id } });
    ok('块索引与引用一并清掉', orphanBlocks === 0 && orphanLinks === 0, { orphanBlocks, orphanLinks });

    console.log('\n=== 10. 实例隔离 ===');
    const other = await svc.createNote(VIEWER, 'other-inst', { title: '__SMOKE_ISO', content: md });
    const cross = await svc.getNote(VIEWER, INST, other.id);
    ok('跨实例读不到', !cross, cross && cross.id);
    const crossList = await svc.listNotes({ viewer: VIEWER, instanceId: INST, page: 1, pageSize: 100 });
    ok('跨实例不出现在列表', !crossList.list.some((n) => n.id === other.id));
    const otherBlocks = await svc.listBlocks(other.id, VIEWER, INST);
    ok('跨实例读不到块索引', !!otherBlocks.error, otherBlocks);
    await svc.purge(VIEWER, 'other-inst', other.id);

    // 清理
    await svc.purge(VIEWER, INST, n2.id).catch(() => undefined);
    for (const f of await prisma.memoFolder.findMany({ where: { author: VIEWER } })) {
        await svc.deleteFolder(VIEWER, f.instanceId || '', f.id).catch(() => undefined);
    }
    const leftNotes = await prisma.note.count({ where: { author: VIEWER } });
    const leftFolders = await prisma.memoFolder.count({ where: { author: VIEWER } });
    const leftBlocks = await prisma.noteBlock.count({ where: { author: VIEWER } });
    const leftLinks = await prisma.noteLink.count({ where: { author: VIEWER } });
    ok(
        '测试数据已清理',
        leftNotes === 0 && leftFolders === 0 && leftBlocks === 0 && leftLinks === 0,
        { notes: leftNotes, folders: leftFolders, blocks: leftBlocks, links: leftLinks },
    );

    console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
})().catch(async (e) => {
    console.error('冒烟异常：', e);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
});
