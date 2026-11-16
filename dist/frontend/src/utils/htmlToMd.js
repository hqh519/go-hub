/**
 * HTML → Markdown（v1.3.1.2）
 *
 * 编辑器里「HTML/MD 格式互换」工具用这个。
 *
 * 为什么手写而不是装 turndown：
 *   1) turndown 有 40KB+ 体积，而这里只需要覆盖「编辑器自己能产出的那些标签」；
 *   2) 我们需要的是**与本项目 markdown.js 往返一致**的输出（表格用 `|`、附件用
 *      gh-file 锚点、提示块用 :::callout），第三方库的默认口味对不上，还得再写规则。
 *
 * 覆盖：h1-h6 / p / strong,b / em,i / del,s / u / code / pre / a / img /
 *       ul,ol,li（含嵌套与任务列表）/ blockquote / hr / br / table / div,span。
 * 不认识的标签按「继续走子节点」处理，不丢内容。
 */

/** 行内节点的序列化（递归） */
function inlineOf(node) {
  if (!node) return '';
  if (node.nodeType === 3) return String(node.nodeValue || '').replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';

  const tag = node.tagName.toLowerCase();
  const inner = Array.from(node.childNodes).map(inlineOf).join('');

  switch (tag) {
    case 'br':
      return '  \n';
    case 'strong':
    case 'b':
      return inner.trim() ? `**${inner}**` : inner;
    case 'em':
    case 'i':
      return inner.trim() ? `*${inner}*` : inner;
    case 'del':
    case 's':
    case 'strike':
      return inner.trim() ? `~~${inner}~~` : inner;
    case 'u':
      return inner.trim() ? `<u>${inner}</u>` : inner;
    case 'mark':
      return inner.trim() ? `==${inner}==` : inner;
    case 'code':
      return inner ? `\`${inner}\`` : '';
    case 'a': {
      const href = node.getAttribute('href') || '';
      const cls = node.getAttribute('class') || '';
      if (!href) return inner;
      // 附件（class="gh-file"）保持原生 html 锚点 —— 与编辑器序列化口径一致
      if (/gh-file/.test(cls)) {
        return `<a href="${href}" class="gh-file" download>${inner || href}</a>`;
      }
      return `[${inner || href}](${href})`;
    }
    case 'img': {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      if (!src) return '';
      const w = node.getAttribute('width');
      return w ? `![${alt}](${src}){width=${w}}` : `![${alt}](${src})`;
    }
    case 'input': {
      // 任务列表的复选框由 li 处理，这里吞掉
      return '';
    }
    default:
      return inner;
  }
}

/** 表格 → md 表格 */
function tableOf(table) {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (!rows.length) return '';
  const grid = rows.map((tr) =>
    Array.from(tr.children).map((td) => inlineOf(td).trim().replace(/\|/g, '\\|')),
  );
  const cols = Math.max(...grid.map((r) => r.length));
  const pad = (r) => {
    const copy = r.slice();
    while (copy.length < cols) copy.push('');
    return copy;
  };
  const head = pad(grid[0]);
  const sep = head.map(() => '---');
  const body = grid.slice(1).map(pad);
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(head), line(sep), ...body.map(line)].join('\n');
}

/** 列表 → md（支持嵌套与任务列表） */
function listOf(list, depth = 0) {
  const ordered = list.tagName.toLowerCase() === 'ol';
  const out = [];
  let index = 1;
  for (const li of Array.from(list.children)) {
    if (li.tagName.toLowerCase() !== 'li') continue;
    const marker = ordered ? `${index}. ` : '- ';
    const box = li.querySelector(':scope > input[type="checkbox"]');
    const prefix = box ? `- [${box.hasAttribute('checked') ? 'x' : ' '}] ` : marker;
    // li 自己的文本（不含嵌套列表）
    const clone = li.cloneNode(true);
    Array.from(clone.children).forEach((c) => {
      if (/^(ul|ol)$/i.test(c.tagName)) c.remove();
    });
    clone.querySelectorAll('input[type="checkbox"]').forEach((c) => c.remove());
    const text = inlineOf(clone).trim();
    out.push(`${'  '.repeat(depth)}${prefix}${text}`);
    // 嵌套列表
    for (const sub of Array.from(li.children)) {
      if (/^(ul|ol)$/i.test(sub.tagName)) out.push(listOf(sub, depth + 1));
    }
    index += 1;
  }
  return out.join('\n');
}

/** 块级节点 → md（递归） */
function blockOf(node) {
  if (!node) return '';
  if (node.nodeType === 3) {
    const t = String(node.nodeValue || '').trim();
    return t ? t : '';
  }
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(tag[1]);
      return `${'#'.repeat(level)} ${inlineOf(node).trim()}`;
    }
    case 'p': {
      const text = inlineOf(node).trim();
      const align = node.getAttribute('align');
      return align ? `<p align="${align}">${text}</p>` : text;
    }
    case 'blockquote': {
      const inner = Array.from(node.childNodes)
        .map(blockOf)
        .filter(Boolean)
        .join('\n\n');
      return inner
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    }
    case 'pre': {
      const code = node.querySelector('code');
      const lang = code ? (code.className.match(/language-([\w-]+)/) || [])[1] || '' : '';
      const raw = (code || node).textContent || '';
      return `\`\`\`${lang}\n${raw.replace(/\n$/, '')}\n\`\`\``;
    }
    case 'ul':
    case 'ol':
      return listOf(node, 0);
    case 'hr':
      return '---';
    case 'table':
      return tableOf(node);
    case 'div':
    case 'section':
    case 'article':
    case 'figure': {
      // 提示块 / HTML 块：保留成围栏，避免转换时把结构化内容拍平
      const cls = node.getAttribute('class') || '';
      if (/gh-callout/.test(cls) || node.hasAttribute('data-callout')) {
        const type = node.getAttribute('data-callout') || (cls.match(/gh-callout-([\w-]+)/) || [])[1] || 'info';
        const inner = Array.from(node.childNodes)
          .map(blockOf)
          .filter(Boolean)
          .join('\n\n');
        return `:::callout{type=${type}}\n${inner}\n:::`;
      }
      if (node.hasAttribute('data-html-block')) {
        return `:::html\n${node.innerHTML}\n:::`;
      }
      if (node.hasAttribute('data-embed-iframe')) {
        const frame = node.querySelector('iframe');
        const src = frame ? frame.getAttribute('src') || '' : '';
        return src ? `:::iframe{src="${src}" height="420"}\n:::` : '';
      }
      return Array.from(node.childNodes)
        .map(blockOf)
        .filter(Boolean)
        .join('\n\n');
    }
    default:
      return inlineOf(node).trim();
  }
}

/**
 * 入口：任意 HTML 片段 → markdown。
 * 用 DOMParser 解析（不插入 document，不会执行脚本、不会加载图片）。
 */
export function htmlToMd(html) {
  const src = String(html ?? '').trim();
  if (!src) return '';
  const doc = new DOMParser().parseFromString(`<div id="__root">${src}</div>`, 'text/html');
  const root = doc.getElementById('__root');
  if (!root) return '';
  const blocks = Array.from(root.childNodes)
    .map(blockOf)
    .filter((x) => String(x || '').trim().length);
  // 块之间统一空一行；行内节点连在一起时不额外加空行（上面 blockOf 已经处理）
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

export default { htmlToMd };
