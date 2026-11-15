import { mdToDoc, docToMd } from '../src/utils/markdown.js';
const md = `# 标题一

这是一段**粗体**和*斜体*还有~~删除~~和 \`code\` 的文字。

## 二级标题

- 第一项
- 第二项
  - 嵌套项
- 第三项

1. 有序一
2. 有序二

- [ ] 待办一
- [x] 待办二

> 引述内容
> 第二行

\`\`\`js
const a = 1;
console.log(a);
\`\`\`

![图](/file/abc.png)

---
最后一段
有换行`;
const doc = mdToDoc(md);
const back = docToMd(doc);
console.log('=== BACK ===');
console.log(back);
console.log('=== blocks ===', doc.content.map(n=>n.type).join(','));
const doc2 = mdToDoc(back);
const back2 = docToMd(doc2);
console.log('=== 往返稳定 ===', back === back2);
if (back !== back2) { console.log('--- 2nd ---'); console.log(back2); }
