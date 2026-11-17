import { mdToDoc, docToMd } from '../src/utils/markdown.js';
const md = `# 标题

<video src="/file/a.mp4" width="600" align="center" controls></video>

<audio src="/file/b.mp3" width="480" controls></audio>

![[file:/file/c.pdf|说明书.pdf]]{width=320}

普通附件：![[file:/file/d.zip|打包.zip]]{width=240} 结束。`;
const back = docToMd(mdToDoc(md));
console.log(back);
console.log('--- 往返稳定 ---', back === md);
