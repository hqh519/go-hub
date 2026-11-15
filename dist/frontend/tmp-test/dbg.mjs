import { mdToDoc } from '../src/utils/markdown.js';
const doc = mdToDoc("- 第一项\n- 第二项\n  - 嵌套项\n- 第三项");
console.log(JSON.stringify(doc, null, 1));
