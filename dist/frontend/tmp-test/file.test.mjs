import { mdToDoc, docToMd } from '../src/utils/markdown.js';
const md = `第一段

![[file:/file/2026/08/a.pdf|说明书.pdf]]

最后一段`;
const doc = mdToDoc(md);
console.log(JSON.stringify(doc).slice(0, 800));
console.log('--- BACK ---');
console.log(docToMd(doc));
