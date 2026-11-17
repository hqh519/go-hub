import { mdToDoc } from '../src/utils/markdown.js';
const md = `# 一级标题测试

这是第一段正文，用来验证行号与内容块的对齐、以及选中文本浮层的位置。这是一段足够长的文字，用来让它折行显示。

## 二级标题测试

第二段文字。这里再写一点内容，保证段落高度足够。

- 列表项一
- 列表项二
  - 嵌套项

- [ ] 待办一
- [x] 待办二

![测试图](/file/2026/08/1794884060084_image.png)

<video src="/file/PTzUrfIPEDyW79ho46yMEZIyv8Z7.mp4" controls></video>

![[file:/file/abc123.pdf|说明书.pdf]]

| 列一 | 列二 |
| --- | --- |
| a | b |

:::callout{type=info}
提示块内容
:::

最后一段。`;
const doc = mdToDoc(md);
let pos = 0;
for (const n of doc.content) {
  console.log(pos, n.type, JSON.stringify(n.attrs||{}).slice(0,80));
  pos += 2; // placeholder
}
console.log('--- sizes ---');
let p = 0;
for (const n of doc.content) {
  const size = (function calc(node){ if(!node.content) return 1; return 1 + node.content.reduce((s,c)=>s+calc(c),0) + (node.content.length?1:0); })(n);
  console.log(p, n.type, 'size=', size);
  p += size;
}
