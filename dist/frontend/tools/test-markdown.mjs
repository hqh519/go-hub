/**
 * md ⇄ doc 往返自检（v1.3.1）
 * 用法：node tools/test-markdown.mjs
 */
import { mdToDoc, docToMd, plainTextOf } from '../src/utils/markdown.js';

let pass = 0;
let fail = 0;

function eq(name, a, b) {
    const ok = String(a) === String(b);
    if (ok) {
        pass += 1;
        console.log(`  ✓ ${name}`);
    } else {
        fail += 1;
        console.log(`  ✗ ${name}`);
        console.log('    --- 期望 ---');
        console.log(String(b).replace(/^/gm, '    '));
        console.log('    --- 实际 ---');
        console.log(String(a).replace(/^/gm, '    '));
    }
}

/** 往返三次必须稳定：md → doc → md 的第 2、3 次结果一致 */
function roundtrip(name, md, times = 3) {
    let cur = md;
    const outs = [];
    for (let i = 0; i < times; i += 1) {
        cur = docToMd(mdToDoc(cur));
        outs.push(cur);
    }
    eq(`${name}（第1次往返）`, outs[0], md.trimEnd());
    eq(`${name}（幂等）`, outs[outs.length - 1], outs[1]);
}

console.log('\n=== 1. 基础块回归 ===');
roundtrip('段落', '这是一个段落。');
roundtrip('多段落', '第一段\n\n第二段');
roundtrip('行内格式', '**粗** *斜* ~~删~~ `code` [链接](https://a.com)');
roundtrip('标题', '# 一级\n\n## 二级\n\n### 三级');
roundtrip('无序列表', '- a\n- b\n- c');
roundtrip('有序列表', '1. a\n2. b\n3. c');
roundtrip('任务列表', '- [ ] 未完成\n- [x] 已完成');
roundtrip('引述', '> 引用内容');
roundtrip('代码块', '```js\nconst a = 1;\n```');
roundtrip('分割线', '---');
roundtrip('图片', '![图](/file/abc)');

console.log('\n=== 2. 嵌套列表 ===');
roundtrip('两级无序', '- a\n  - a1\n  - a2\n- b');
/*
 * 有序项嵌无序项：层级必须保住。
 * 缩进按 2 空格规范化（原 md 用 3 空格也合法）—— 属分期方案 §9 风险 1 里
 * 明确接受的规范化，不算丢格式。
 */
roundtrip('有序套无序', '1. a\n  - a1\n2. b');
roundtrip('有序套无序（3空格原稿也被规范成2空格）', '1. a\n  - a1\n2. b');

console.log('\n=== 3. v1.3.1 新块 ===');
roundtrip('图片带宽度', '![图](/file/abc){width=600}');
roundtrip('视频', '<video src="/file/v1" controls></video>');
roundtrip('音频', '<audio src="/file/a1" controls></audio>');
roundtrip('附件', '<a href="/file/f1" class="gh-file" download>说明书.pdf</a>');
roundtrip('提示块', ':::callout{type=info}\n提示内容\n:::');
roundtrip('提示块-警告', ':::callout{type=warning}\n小心\n:::');
roundtrip('表格', '| A | B |\n| --- | --- |\n| 1 | 2 |');
roundtrip('表格-对齐', '| A | B |\n| :---: | ---: |\n| 1 | 2 |');

console.log('\n=== 4. 混合文档 ===');
const mixed = [
    '# 标题',
    '',
    '一段带 **粗体** 的正文。',
    '',
    '- 列表项一',
    '- 列表项二',
    '',
    '> 引用',
    '',
    '```python',
    'print(1)',
    '```',
    '',
    '| 列1 | 列2 |',
    '| --- | --- |',
    '| a | b |',
    '',
    ':::callout{type=tip}',
    '这是个提示',
    ':::',
    '',
    '![图](/file/x){width=320}',
    '',
    '<video src="/file/v" controls></video>',
].join('\n');
roundtrip('混合文档', mixed);

console.log('\n=== 5. 结构正确性 ===');
{
    const doc = mdToDoc('| A | B |\n| --- | --- |\n| 1 | 2 |');
    eq('表格节点类型', doc.content[0].type, 'table');
    eq('表格行数', doc.content[0].content.length, 2);
    eq('表头单元格类型', doc.content[0].content[0].content[0].type, 'tableHeader');
    eq('数据单元格类型', doc.content[0].content[1].content[0].type, 'tableCell');
}
{
    const doc = mdToDoc(':::callout{type=danger}\n内容\n:::');
    eq('提示块类型', doc.content[0].type, 'callout');
    eq('提示块子类型', doc.content[0].attrs.type, 'danger');
    eq('提示块内有段落', doc.content[0].content[0].type, 'paragraph');
}
{
    const doc = mdToDoc('![图](/file/abc){width=600}');
    eq('图片宽度', doc.content[0].attrs.width, 600);
}
{
    const doc = mdToDoc('<video src="/file/v" controls></video>');
    eq('视频 src', doc.content[0].attrs.src, '/file/v');
}

console.log('\n=== 6. 降级不丢内容 ===');
{
    const md = '| 只有表头没分隔 |\n不是表格';
    const out = docToMd(mdToDoc(md));
    eq('无分隔行不当表格', out.includes('只有表头没分隔'), true);
}
{
    const md = ':::callout{type=info}\n没闭合的提示块';
    const out = docToMd(mdToDoc(md));
    eq('未闭合提示块保留内容', out.includes('没闭合的提示块'), true);
}

// ============================================================
//  v1.5.0 引用类行内原子 + 块 ID 剥离
// ============================================================
for (const [name, md] of [
    ['笔记引用', '见 [[note:abc123]] 一文'],
    ['带标题的笔记引用', '见 [[note:abc123|另一篇笔记]] 一文'],
    ['块引用', '参见 ((blk_1a2b3c4d))'],
    ['嵌入引用', '上面这段来自 ![[note:abc123#blk:1a2b3c4d|被嵌入的块]]'],
    ['引用与格式混排', '**重点**：见 [[note:abc|X]] 与 ((blk_0f0f0f0f))'],
]) {
    roundtrip(name, md);
}

const idMd = ['# 标题 ^blk_11111111', '', '正文 ^blk_22222222', '', '```js', 'const a = "^blk_33333333";', '```'].join('\n');
const idBack = docToMd(mdToDoc(idMd));
eq('块 ID 不进编辑器', idBack.includes('blk_11111111') || idBack.includes('blk_22222222'), false);
eq('代码块里的 ^blk 原样保留', idBack.includes('blk_33333333'), true);

const widthMd = '![图](/file/x){width=600}';
roundtrip('图片宽度', widthMd);

// v1.3.1.1：段级对齐走 `<p align>`，往返必须稳定
roundtrip('段落居中', '<p align="center">居中的一段</p>');
roundtrip('段落右对齐', '<p align="right">靠右一段</p>');

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
