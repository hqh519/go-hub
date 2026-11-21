/**
 * Markdown ⇄ ProseMirror 文档（v1.3.0）
 * ----------------------------------------------------------------------------
 * 编辑器路线是「md 是真源，富文本只是它的一种视图」。所以这里必须有两个方向的转换，
 * 而且必须是**我们自己的实现** —— 引第三方 md 序列化器会带来两个问题：
 *   1) 它支持的语法远超 v1.3 的 6 种块，多出来的语法一旦被写进 md，
 *      切回富文本就丢内容（看上去像"保存出错"）；
 *   2) 序列化规则黑盒，往返丢格式时无从定位。
 *
 * 本版支持的块（与 `docs/规划/编辑器分期方案.md` §3 v1.3.0 一致）：
 *   段落 / 标题 H1-H6 / 无序列表 / 有序列表 / 任务列表 / 引述 / 代码块 / 图片 / 分割线
 *
 * 不支持的语法（表格、公式、HTML 块……）在解析时**降级成纯文本段落**而不是报错 ——
 * 宁可「样式没了」也不能「内容没了」。
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';

// ============================================================
//  行内
// ============================================================

/** 反斜杠转义：`\*` → 字面 `*` */
function unescapeMd(text) {
  return String(text || '').replace(/\\([\\`*_{}\[\]()#+\-.!~>|])/g, '$1');
}

/**
 * 行内解析：**粗体** / *斜体* / _斜体_ / ~~删除线~~ / `代码` / [文字](链接) / ![图](地址)
 *
 * 用「扫描 + 递归」而不是一次性正则替换：递归才能正确处理嵌套（`**粗 *斜* 粗**`），
 * 一次性替换在这种场景下要么漏、要么把标记切坏。
 */
/**
 * v1.3.7：批注上标
 * ----------------------------------------------------------------------------
 * md 里写成一段最小 HTML：`<sup class="gh-ann" data-note="...">?</sup>`。
 * 选它而不是自定义 `{{ann:…}}` 的原因：
 *   · 预览走 marked，原生就认识 HTML，不用再教 marked 一套语法；
 *   · DOMPurify 白名单本来就放行 sup 与 data-*；
 *   · 第三方 md 查看器即使不认批注，也只是多一个「?」上标，不会露出源码。
 */
function decodeAnnNote(v) {
  return String(v || '')
    .replace(/&#10;/g, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
function encodeAnnNote(v) {
  return String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;');
}

function parseInline(src, marks = []) {
  const out = [];
  let buf = '';
  let i = 0;
  const text = String(src || '');
  const flush = () => {
    if (buf) {
      out.push(marks.length ? { type: 'text', text: buf, marks: marks.slice() } : { type: 'text', text: buf });
      buf = '';
    }
  };
  const withMark = (mark) => [...marks, mark];
  while (i < text.length) {
    const rest = text.slice(i);
    let m;
    // 转义字符：原样收下后一个字符，不参与语法
    if (rest[0] === '\\' && rest.length > 1) {
      buf += rest[1];
      i += 2;
      continue;
    }
    /*
     * 实体换行（v1.3.1.2）：`<br>` 明确写成 HTML，比「行尾两个空格」可靠得多 ——
     * 后者会被各种编辑器 / 格式化工具顺手 trim 掉，用户就会觉得「换行丢了」。
     */
    if ((m = /^<br\s*\/?>/i.exec(rest))) {
      flush();
      out.push({ type: 'hardBreak' });
      i += m[0].length;
      continue;
    }
    if ((m = /^<sup class="gh-ann" data-note="([^"]*)">\?<\/sup>/i.exec(rest))) {
      flush();
      out.push({ type: 'annotation', attrs: { note: decodeAnnNote(m[1]) } });
      i += m[0].length;
      continue;
    }
    if ((m = /^`([^`]+)`/.exec(rest))) {
      flush();
      out.push({ type: 'text', text: m[1], marks: withMark({ type: 'code' }) });
      i += m[0].length;
      continue;
    }
    if ((m = /^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/.exec(rest))) {
      flush();
      out.push({ type: 'image', attrs: { src: m[2], alt: m[1] } });
      i += m[0].length;
      continue;
    }
    /*
     * 笔记引用（v1.5.0）：`[[note:id]]` / `[[note:id|标题]]` / `[[note:id#blk:bid|标题]]`，
     * 前面多一个 `!` 就是「嵌入」。
     * 必须先于普通链接 `/^\[([^\]]*)\]/` 匹配 —— 否则 `[[` 会被当成一个空文字的链接吃掉。
     */
    if ((m = /^!\[\[file:([^|\]]+)(?:\|([^\]]*))?\]\](\{[^}]*\})?/.exec(rest))) {
      flush();
      const attrs = { href: m[1], name: m[2] || '附件' };
      const w = /width\s*=\s*(\d+)/.exec(m[3] || '');
      const h = /height\s*=\s*(\d+)/.exec(m[3] || '');
      if (w) attrs.width = Number(w[1]);
      if (h) attrs.height = Number(h[1]);
      out.push({ type: 'fileAttachment', attrs });
      i += m[0].length;
      continue;
    }
    if ((m = /^(!?)\[\[note:([A-Za-z0-9_-]+)(?:#blk:(blk_[0-9a-f]{8}))?(?:\|([^\]]*))?\]\]/.exec(rest))) {
      flush();
      out.push({
        type: m[1] === '!' ? 'noteEmbed' : 'noteRef',
        attrs: { noteId: m[2], blockId: m[3] || null, label: m[4] || '' },
      });
      i += m[0].length;
      continue;
    }
    /** 块引用（v1.5.0）：`((blk_xxxxxxxx))` */
    if ((m = /^\(\((blk_[0-9a-f]{8})\)\)/.exec(rest))) {
      flush();
      out.push({ type: 'blockRef', attrs: { blockId: m[1] } });
      i += m[0].length;
      continue;
    }
    if ((m = /^\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/.exec(rest))) {
      flush();
      out.push(...parseInline(m[1], withMark({ type: 'link', attrs: { href: m[2] } })));
      i += m[0].length;
      continue;
    }
    /*
     * v1.3.1.2：下划线 / 高亮 / 字号 / 颜色。
     *
     * md 语法本身没有这四样，所以统一用最小限度的 HTML：
     *   <u>…</u>、==…==（GFM 表格里也常见的写法）、
     *   <span class="gh-fs-l">…</span>、<span class="gh-c-red">…</span>。
     * 用 class 而不是 style：预览走 DOMPurify 白名单，style 会被剥掉，
     * 那样「编辑器里是红色、预览变黑」就成了两套观感。
     */
    if ((m = /^<u>([\s\S]+?)<\/u>/i.exec(rest))) {
      flush();
      out.push(...parseInline(m[1], withMark({ type: 'underline' })));
      i += m[0].length;
      continue;
    }
    if ((m = /^==([\s\S]+?)==/.exec(rest))) {
      flush();
      out.push(...parseInline(m[1], withMark({ type: 'highlight' })));
      i += m[0].length;
      continue;
    }
    if ((m = /^<span class="gh-fs-(s|m|l)">([\s\S]*?)<\/span>/i.exec(rest))) {
      flush();
      out.push(...parseInline(m[2], withMark({ type: 'fontSize', attrs: { size: m[1] } })));
      i += m[0].length;
      continue;
    }
    if ((m = /^<span class="gh-c-([a-z]+)">([\s\S]*?)<\/span>/i.exec(rest))) {
      flush();
      out.push(...parseInline(m[2], withMark({ type: 'textColor', attrs: { color: m[1] } })));
      i += m[0].length;
      continue;
    }
    if ((m = /^(\*\*|__)([\s\S]+?)\1/.exec(rest))) {
      flush();
      out.push(...parseInline(m[2], withMark({ type: 'bold' })));
      i += m[0].length;
      continue;
    }
    if ((m = /^~~([\s\S]+?)~~/.exec(rest))) {
      flush();
      out.push(...parseInline(m[1], withMark({ type: 'strike' })));
      i += m[0].length;
      continue;
    }
    if ((m = /^\*([^*\n]+)\*/.exec(rest))) {
      flush();
      out.push(...parseInline(m[1], withMark({ type: 'italic' })));
      i += m[0].length;
      continue;
    }
    if ((m = /^_([^_\n]+)_/.exec(rest))) {
      flush();
      out.push(...parseInline(m[1], withMark({ type: 'italic' })));
      i += m[0].length;
      continue;
    }
    buf += rest[0];
    i += 1;
  }
  flush();
  return out;
}

/** ProseMirror 要求相邻同 marks 的 text 合并，否则光标跳字 */
function normalizeInline(nodes) {
  const out = [];
  const keyOf = (n) =>
    `${n.type}|${(n.marks || []).map((m) => `${m.type}:${(m.attrs && JSON.stringify(m.attrs)) || ''}`).sort().join(',')}`;
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (node.type === 'text' && prev && prev.type === 'text' && keyOf(prev) === keyOf(node)) {
      prev.text += node.text;
      continue;
    }
    out.push(node);
  }
  return out;
}

// ============================================================
//  块
// ============================================================

const FENCE_RE = /^\s{0,3}(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*)$/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE_RE = /^\s{0,3}>\s?/;
/*
 * 图片行，v1.3.1 起支持尾部尺寸标记：`![alt](/f/x){width=600}`。
 * 尺寸写在 md 里而不是数据库，是为了「md 脱离本系统后仍能看懂」——
 * 它退化成一段没人认的 {width=600} 文本，不会丢图。
 */
const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)(?:\{([^}]*)\})?\s*$/;
const TASK_RE = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\s*)\d+[.)]\s+(.*)$/;

/* ── v1.3.1 新增块 ─────────────────────────────────────────── */

/**
 * 段级对齐（v1.3.1.1）：`<p align="center">文字</p>`。
 * markdown 本身没有段落对齐语法，用 HTML 属性表达 —— DOMPurify 白名单放行 align，
 * 编辑器与预览的观感一致，别的 md 查看器也认得。
 */
const P_ALIGN_RE = /^\s*<p\s+align="(left|center|right)"\s*>([\s\S]*)<\/p>\s*$/i;
/** 表格分隔行：| --- | :---: | ---: | */
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
/** 一行表格数据：至少含一个 `|`，首尾的 `|` 可省 */
function isTableRow(line) {
    return /\|/.test(line) && !/^\s*```/.test(line);
}
/**
 * v1.3.1.2：HTML 块与网页嵌入。
 *
 * 两者都用 `:::` 围栏，而不是直接塞裸 `<div>` / `<iframe>`：
 *   · 围栏是「整块」语义，跨行内容不用逐行猜边界（行式解析器做不到匹配标签配对）；
 *   · 收尾一定有一个 `:::`，围栏里写坏的 HTML 也不会把后面半篇文档吞掉；
 *   · 在别的 md 查看器里只是一段带 ::: 的代码块，不会执行任何东西。
 */
const HTML_OPEN_RE = /^\s*:::\s*html\s*$/i;
const IFRAME_OPEN_RE = /^\s*:::\s*iframe\s*(?:\{([^}]*)\})?\s*$/i;
/** 提示块围栏：`:::callout{type=info}` … `:::` */
const CALLOUT_OPEN_RE = /^\s*:::\s*callout\s*(?:\{([^}]*)\})?\s*$/i;
const CALLOUT_OPEN_LOOSE_RE = /^\s*:::\s*([a-z][\w-]*)\s*(?:\{([^}]*)\})?\s*$/i;
const CALLOUT_CLOSE_RE = /^\s*:::\s*$/;
/**
 * v1.3.5.1（需求）：GitHub 风格提示块 `> [!IMPORTANT]` / `> 正文`。
 * 与既有的 `:::callout{type=...}` 共用【同一个 callout 节点】，只是多一种源码写法；
 * 保存时统一序列化成这种 `> [!TAG]` 形式，两种输入都能解析，往返不会抖。
 */
const GITHUB_ALERT_RE = /^\s{0,3}>\s*\[!([A-Z][A-Z0-9_-]*)\]\s*$/i;
const GITHUB_ALERT_TYPE = {
    NOTE: 'info', TIP: 'tip', IMPORTANT: 'important', WARNING: 'warning', CAUTION: 'danger',
};
const GITHUB_ALERT_TAG = {
    info: 'NOTE', tip: 'TIP', important: 'IMPORTANT', warning: 'WARNING', danger: 'CAUTION',
};
/** v1.3.5.1：数学公式块 `$$` … `$$`（整块单独成行） */
const MATH_FENCE_RE = /^\s*\$\$\s*$/;
/** v1.3.5.1：页签块 `::: tabs` … `:::`，内部用 `@tab 标题` / `@tab:active 标题` 分段 */
const TABS_OPEN_RE = /^\s*:::\s*tabs\s*$/i;
const TAB_HEAD_RE = /^\s*@tab(?::active)?\s+(.+?)\s*$/i;
/**
 * 媒体 / 附件的独占行（html 形式）。
 * 选 html 而不是自定义标记，是因为它在任何 md 查看器里都还能用，
 * 而且 DOMPurify 白名单里放行 video / audio 就够，不需要额外的解析通道。
 */
const MEDIA_LINE_RE = /^\s*<(video|audio)\b([^>]*)>\s*(?:<\/\1>)?\s*$/i;
const FILE_LINE_RE = /^\s*<a\b([^>]*\bclass="gh-file"[^>]*)>([\s\S]*?)<\/a>\s*$/i;

/** 从一行 html 属性串里取某个属性的值 */
function attrOf(attrText, name) {
    const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(String(attrText || ''));
    return m ? m[1] : '';
}

/* ── 块 ID（v1.3.1） ─────────────────────────────────────────
 * 后端在开启「块 ID」设置时会给每个块的行尾补 ` ^blk_xxxxxxxx`。
 * 那是给引用用的注解，**不是正文**：进编辑器前必须剥掉，
 * 序列化出去也不需要再补（后端保存时会按内容重算，从而保持稳定）。
 * 代码围栏内一律不动 —— 里面的 `^blk_x` 是用户代码。
 */
const BLOCK_ID_TAIL_RE = /[ \t]+\^blk_[0-9a-f]{8}[ \t]*$/;

/** 剥掉行尾块 ID（围栏外），返回新 md 字符串 */
export function stripBlockIds(md) {
    const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
    let inFence = false;
    const out = lines.map((line) => {
        if (FENCE_RE.test(line)) {
            inFence = !inFence;
            return line;
        }
        return inFence ? line : line.replace(BLOCK_ID_TAIL_RE, '');
    });
    return out.join('\n');
}

function indentLevel(spaces) {
  // 2 空格 = 一级（兼容 tab 与 4 空格：先折算成 2 的倍数，最多 8 级）
  const n = Math.floor(String(spaces || '').replace(/\t/g, '  ').length / 2);
  return Math.min(8, n);
}

function paragraphOf(text) {
  const inline = normalizeInline(parseInline(text));
  if (!inline.length) return { type: 'paragraph' };
  // 「整段只有一张图」→ 提升为块级图片（Tiptap 的 image 是块节点）
  if (inline.length === 1 && inline[0].type === 'image') return inline[0];
  return { type: 'paragraph', content: inline };
}

/** 列表：按缩进组装成嵌套结构（Tiptap 的 list 是 container 节点） */
/**
 * 去掉一段行的公共缩进（v1.3.4.2）。
 *
 * 列表项下的子块（引述 / 代码块 / 图片 / 附件…）在 md 里是靠「比父项多缩进一级」
 * 表达层级的；但把这几行直接交给 mdToDoc 时，4 空格以上的缩进会被 markdown
 * 当成普通段落（blockquote 只允许 ≤3 空格），于是 `> 引述` 变成一行带 `>` 的正文、
 * 代码围栏变成正文里的反引号 —— 保存刷新后就是「子块被拍平」。
 * 解析前先还原到第 0 列，层级由 buildList 挂到 listItem 的 content 上。
 */
function dedentLines(lines) {
  const indents = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    const m = /^[ \t]*/.exec(l);
    indents.push(m ? m[0].length : 0);
  }
  const min = indents.length ? Math.min(...indents) : 0;
  if (!min) return lines;
  return lines.map((l) => (l.trim() ? l.slice(min) : l));
}

function buildList(kind, items) {
  const root = { children: [] };
  /*
   * 基准缩进归一：md 里整段列表被整体缩进（常见于复制粘贴）时，
   * 第一项不会是 level 0 —— 若直接用绝对缩进，第一项会被当成「某个不存在父项的子树」而丢掉。
   * 减去首项的层级，让「第一项」永远等于根层。
   */
  const base = items.length ? items[0].level : 0;
  const stack = [{ level: 0, children: root.children }];
  for (const raw of items) {
    const item = { ...raw, level: Math.max(0, raw.level - base) };
    while (stack.length > 1 && item.level < stack[stack.length - 1].level) stack.pop();
    const top = stack[stack.length - 1];
    if (item.level > top.level) {
      // 新开一层：挂到上一个 item 的 children 上；没有上一个 item 就把当前层提上去
      const last = top.children[top.children.length - 1];
      if (!last) {
        top.level = item.level;
      } else {
        last.children = last.children || [];
        stack.push({ level: item.level, children: last.children });
      }
    }
    const entry = { text: item.text, checked: item.checked, children: [], sub: item.sub };
    stack[stack.length - 1].children.push(entry);
  }
  /*
   * 子项必须包在「列表节点」里：
   * ProseMirror 的 listItem 只能含 paragraph / 子列表，不能直接含 listItem —
   * 直接把子项塞进去，Tiptap 会把它当非法节点整棵丢掉（表现为「嵌套项消失」）。
   */
  const listType = kind === 'bullet' ? 'bulletList' : kind === 'ordered' ? 'orderedList' : 'taskList';
  const toNodes = (entries) =>
    entries.map((e) => {
      const inner = [{ type: 'paragraph', content: normalizeInline(parseInline(e.text)) }];
      if (!inner[0].content.length) delete inner[0].content;
      if (e.children && e.children.length) {
        inner.push({
          type: listType,
          ...(listType === 'orderedList' ? { attrs: { start: 1 } } : {}),
          content: toNodes(e.children),
        });
      }
      /*
       * v1.3.1：子列表是「另一种列表类型」时（有序项里嵌无序项），
       * 递归解析成完整的列表节点再挂进 listItem —— listItem 只能含
       * paragraph 或列表节点，直接把子项铺平会丢掉层级。
       */
      if (e.sub && e.sub.length) {
        try {
          const subDoc = mdToDoc(dedentLines(e.sub).join('\n'));
          for (const n of subDoc.content || []) inner.push(n);
        } catch (err) {
          // 子块解析失败：当成普通文本续行，不丢字
          inner.push({ type: 'paragraph', content: [{ type: 'text', text: e.sub.join(' ').trim() }] });
        }
      }
      if (kind === 'task') return { type: 'taskItem', attrs: { checked: !!e.checked }, content: inner };
      return { type: 'listItem', content: inner };
    });
  const content = toNodes(root.children);
  if (!content.length) return null;
  if (kind === 'bullet') return { type: 'bulletList', content };
  if (kind === 'ordered') return { type: 'orderedList', attrs: { start: 1 }, content };
  return { type: 'taskList', content };
}

/**
 * 收集「缩进比 baseIndent 更深」的连续行（v1.3.1）。
 *
 * 用途：有序列表里嵌一个无序列表（`1. a` 下面跟 `  - a1`）。
 * v1.3.0 的实现遇到「不同列表类型」直接 break，于是子列表被当成一个新的顶层列表，
 * 层级就丢了 —— 用户看到的是「缩进没了、三行变平级」。
 *
 * 这里不裁剪缩进：buildList 会用「第一个子项的缩进」做基准再归一，
 * 原始行直接交给递归解析反而更不容易算错。
 */
function grabIndented(lines, start, baseIndent) {
  const out = [];
  let i = start;
  let blanks = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      /*
       * v1.3.4.2：空行先记着不立刻 break。
       * 松散列表（listItemToMd 保存图片 / 文字子块时用的格式）会在子块之间留空行，
       * 一遇到空行就截断，后面的子块就全丢了。
       */
      blanks += 1;
      i += 1;
      continue;
    }
    const m = /^(\s*)/.exec(line);
    const ind = indentLevel(m ? m[1] : '');
    if (ind <= baseIndent) break;
    if (blanks) {
      out.push('');
      blanks = 0;
    }
    out.push(line);
    i += 1;
  }
  // 末尾多读的空行不属于子块，回退给外层
  return [out, i - blanks];
}

/**
 * 从第 start 行开始收集一个列表块。
 * 返回 [node, nextIndex]；收集不到返回 [null, start]。
 */
function collectList(lines, start, kind) {
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if ((m = TASK_RE.exec(line))) {
      if (kind !== 'task') {
        const lvl = indentLevel(m[1]);
        const last = items[items.length - 1];
        if (last && lvl > last.level) {
          const [sub, next] = grabIndented(lines, i, last.level);
          last.sub = (last.sub || []).concat(sub);
          i = next;
          continue;
        }
        break;
      }
      items.push({ level: indentLevel(m[1]), checked: m[2].toLowerCase() === 'x', text: m[3] });
      i += 1;
      continue;
    }
    if ((m = BULLET_RE.exec(line))) {
      if (kind !== 'bullet') {
        const lvl = indentLevel(m[1]);
        const last = items[items.length - 1];
        if (last && lvl > last.level) {
          const [sub, next] = grabIndented(lines, i, last.level);
          last.sub = (last.sub || []).concat(sub);
          i = next;
          continue;
        }
        break;
      }
      items.push({ level: indentLevel(m[1]), text: m[2] });
      i += 1;
      continue;
    }
    if ((m = ORDERED_RE.exec(line))) {
      if (kind !== 'ordered') {
        const lvl = indentLevel(m[1]);
        const last = items[items.length - 1];
        if (last && lvl > last.level) {
          const [sub, next] = grabIndented(lines, i, last.level);
          last.sub = (last.sub || []).concat(sub);
          i = next;
          continue;
        }
        break;
      }
      items.push({ level: indentLevel(m[1]), text: m[2] });
      i += 1;
      continue;
    }
    // 续行：缩进 2 空格以上的普通文本接在上一条后面（md 里长段落会折行）
    if (items.length && /^\s{2,}\S/.test(line)) {
      const last = items[items.length - 1];
      const trimmed = line.trim();
      /*
       * v1.3.4.1（需求：列表下嵌套的引述 / 代码块 / 段落要保持下级）
       * 缩进行如果是「块级起始语法」，就不能并进上一条的文本 ——
       * 收进 sub，交给 buildList 用 mdToDoc 解析成真正的子块挂到 listItem 里。
       */
      /*
       * v1.3.4.2（需求：列表下级可以放图片 / 文件 / 引述 / 代码块且保存后保持层级）
       * 这里判断「这一行是不是一个独立块的开始」。漏掉图片（`![`）与分隔线时，
       * 它们会被当成上一项文字的续行拼进去 —— 表现就是刷新后图片跑到列表外、
       * 或 `> 引述` 变成 `66666 > 引述` 这样一行。
       */
      const isBlockStart = /^(>|```|~~~|:::)/.test(trimmed)
        || /^#{1,6}\s/.test(trimmed)
        || /^<[a-z!/]/i.test(trimmed)
        || /^\|/.test(trimmed)
        || /^!\[/.test(trimmed)
        || /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed);
      if (isBlockStart) {
        const [sub, next] = grabIndented(lines, i, last.level);
        last.sub = (last.sub || []).concat(sub);
        // v1.3.4.2：缩进不够时 grabIndented 会原地返回，必须自己前进一步，否则死循环
        i = next > i ? next : i + 1;
        continue;
      }
      last.text += ` ${trimmed}`;
      i += 1;
      continue;
    }
    // 列表项内部的空行后面若还是列表，继续；否则结束
    if (!line.trim() && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const last = items[items.length - 1];
      const nextIndent = indentLevel((/^\s*/.exec(nextLine) || [''])[0]);
      /*
       * v1.3.4.2（需求：列表下级的文字 / 图片 / 文件等保存后保持格式）
       * 空行后跟着「比当前项缩进更深」的内容 → 属于本项的子块（标准松散列表写法）。
       * 这里必须在「下一行是不是列表」之前判断：图片、纯文字都不匹配列表正则，
       * 以前会直接 break，把子块甩到列表外面变成顶层内容。
       */
      if (last && nextLine.trim() && nextIndent > last.level) {
        const [sub, next] = grabIndented(lines, i, last.level);
        if (sub.length) {
          last.sub = (last.sub || []).concat(sub);
          i = next > i ? next : i + 1;
          continue;
        }
      }
      if (TASK_RE.test(nextLine) || BULLET_RE.test(nextLine) || ORDERED_RE.test(nextLine)) {
        i += 1;
        continue;
      }
    }
    break;
  }
  const node = buildList(kind, items);
  return [node, i];
}

/** md → ProseMirror doc */
export function mdToDoc(md) {
  // 块 ID 是注解不是正文，先剥掉再解析（否则编辑器里会显示 ^blk_xxxxxxxx）
  const src = stripBlockIds(md);
  const lines = src.split('\n');
  const content = [];
  let i = 0;
  // 段内折行：攒一批普通行，遇到空行 / 特殊块再收口
  let para = [];
  const flushPara = () => {
    if (!para.length) return;
    const text = para.join('\n');
    // 段内换行用 hardBreak 保留用户的行结构（Tiptap 的段落没有软换行）
    const parts = text.split('\n');
    const inline = [];
    parts.forEach((line, idx) => {
      if (idx > 0) inline.push({ type: 'hardBreak' });
      /*
       * 去掉行尾空白再解析：`hardBreak` 序列化成两个空格 + 换行，
       * 这两个空格如果被当正文读进来，下次序列化又加一遍 —— 每保存一次就多两个空格，
       * 正文会肉眼可见地「越长越歪」。行尾空白在 md 里本来也没有语义。
       */
      inline.push(...parseInline(line.replace(/[ \t]+$/, '')));
    });
    content.push({ type: 'paragraph', content: normalizeInline(inline) });
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    // 代码围栏
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushPara();
      const mark = fence[1];
      const lang = fence[2] || '';
      const body = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${mark}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳过收尾围栏（没闭合也不报错，按「到文末」处理）
      content.push({ type: 'codeBlock', attrs: { language: lang || null }, content: body.length ? [{ type: 'text', text: body.join('\n') }] : undefined });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      i += 1;
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara();
      content.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: normalizeInline(parseInline(heading[2])),
      });
      i += 1;
      continue;
    }
    if (HR_RE.test(line)) {
      flushPara();
      content.push({ type: 'horizontalRule' });
      i += 1;
      continue;
    }
    // ── v1.3.5.1：GitHub 风格提示块 `> [!IMPORTANT]` → callout 节点 ──
    if (GITHUB_ALERT_RE.test(line)) {
      flushPara();
      const m = GITHUB_ALERT_RE.exec(line);
      const rawType = String(m?.[1] || 'NOTE').toUpperCase();
      const type = GITHUB_ALERT_TYPE[rawType] || 'info';
      const body = [];
      i += 1;
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        body.push(lines[i].replace(QUOTE_RE, ''));
        i += 1;
      }
      const inner = mdToDoc(body.join('\n'));
      content.push({
        type: 'callout',
        // v1.3.5.2：rawType 一起存下来，`[!xxx]` 里的 xxx 允许用户改成任意文字
        attrs: { type, tag: rawType },
        content: inner.content.length ? inner.content : [{ type: 'paragraph' }],
      });
      continue;
    }
    if (QUOTE_RE.test(line)) {
      flushPara();
      const body = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        body.push(lines[i].replace(QUOTE_RE, ''));
        i += 1;
      }
      // 引述里可以再有列表 / 标题：递归解析，引述块本身是 container
      const inner = mdToDoc(body.join('\n'));
      content.push({ type: 'blockquote', content: inner.content.length ? inner.content : [{ type: 'paragraph' }] });
      continue;
    }
    if (IMAGE_LINE_RE.test(line)) {
      flushPara();
      const m = IMAGE_LINE_RE.exec(line);
      const attrs = { src: m[2], alt: m[1] };
      // 尾部 `{width=600}` → 图片节点宽度（v1.3.1 拖拽改尺寸写的就是它）
      const w = /width\s*=\s*(\d+)/.exec(m[3] || '');
      if (w) attrs.width = Number(w[1]);
      // v1.3.4.1：高度与宽度同一套尾部属性块写法
      const h = /height\s*=\s*(\d+)/.exec(m[3] || '');
      if (h) attrs.height = Number(h[1]);
      // v1.3.1.2：图片也能左 / 中 / 右 —— 与段落对齐同一套值
      const al = /align\s*=\s*(left|center|right)/i.exec(m[3] || '');
      if (al) attrs.align = al[1].toLowerCase();
      content.push({ type: 'image', attrs });
      i += 1;
      continue;
    }
    // ── v1.3.1.1：段级对齐 `<p align="center">…</p>` ──
    {
      const alignMatch = P_ALIGN_RE.exec(line);
      if (alignMatch) {
        flushPara();
        content.push({
          type: 'paragraph',
          attrs: { align: alignMatch[1].toLowerCase() },
          content: normalizeInline(parseInline(alignMatch[2] || '')),
        });
        i += 1;
        continue;
      }
    }
    // ── v1.3.1.2：HTML 块 `:::html` … `:::`（内容是原样 HTML，渲染时走白名单） ──
    if (HTML_OPEN_RE.test(line)) {
      flushPara();
      const body = [];
      i += 1;
      while (i < lines.length && !CALLOUT_CLOSE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      content.push({ type: 'htmlBlock', attrs: { html: body.join('\n') } });
      continue;
    }
    // ── v1.3.1.2：网页嵌入 `:::iframe{src="…" height="420"}` … `:::` ──
    if (IFRAME_OPEN_RE.test(line)) {
      flushPara();
      const m = IFRAME_OPEN_RE.exec(line);
      const src = attrOf(m?.[1] || '', 'src');
      const height = Number((/height\s*=\s*"?(\d+)/i.exec(m?.[1] || '') || [])[1]) || 420;
      const width = Number((/width\s*=\s*"?(\d+)/i.exec(m?.[1] || '') || [])[1]) || 0;
      while (i < lines.length && !CALLOUT_CLOSE_RE.test(lines[i])) i += 1;
      i += 1;
      if (src) content.push({ type: 'iframe', attrs: { src, height, width: width || null } });
      continue;
    }
    // ── v1.3.5.1：页签块 `::: tabs` … `:::`（必须排在 callout 前，否则被宽松围栏抢走） ──
    if (TABS_OPEN_RE.test(line)) {
      flushPara();
      const body = [];
      i += 1;
      while (i < lines.length && !CALLOUT_CLOSE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // 吃掉收尾 :::
      const tabs = [];
      let cur = null;
      body.forEach((raw) => {
        const m = TAB_HEAD_RE.exec(raw);
        if (m) {
          cur = { title: String(m[1] || '').trim(), active: /^@tab:active/i.test(String(raw).trim()), lines: [] };
          tabs.push(cur);
          return;
        }
        if (cur) cur.lines.push(raw);
      });
      const clean = tabs
        .map((t) => ({
          title: t.title,
          active: !!t.active,
          content: t.lines.join('\n').trim(),
        }))
        .filter((t) => t.title);
      /*
       * v1.3.5.2：页签块从「JSON attrs 的 atom 节点」改成 content 结构
       * （tabsBlock > tabItem+），这样每个页签的正文都是真正的块，光标能直接编辑。
       */
      const items = (clean.length ? clean : [{ title: '页签 1', active: true, content: '' }]).map((t) => {
        const inner = mdToDoc(t.content);
        return {
          type: 'tabItem',
          attrs: { title: t.title, active: !!t.active },
          content: inner.content.length ? inner.content : [{ type: 'paragraph' }],
        };
      });
      content.push({ type: 'tabsBlock', content: items });
      continue;
    }
    // ── v1.3.5.1：数学公式块 `$$` … `$$` ──
    if (MATH_FENCE_RE.test(line)) {
      flushPara();
      const body = [];
      i += 1;
      while (i < lines.length && !MATH_FENCE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // 吃掉收尾 $$
      content.push({ type: 'mathBlock', attrs: { formula: body.join('\n').trim() } });
      continue;
    }
    // ── v1.3.1：提示块 `:::callout{type=info}` … `:::` ──
    if (CALLOUT_OPEN_RE.test(line) || (CALLOUT_OPEN_LOOSE_RE.test(line) && !CALLOUT_CLOSE_RE.test(line))) {
      flushPara();
      const m = CALLOUT_OPEN_RE.test(line) ? CALLOUT_OPEN_RE.exec(line) : CALLOUT_OPEN_LOOSE_RE.exec(line);
      const type = (/type\s*=\s*([\w-]+)/.exec(m?.[1] || m?.[2] || '') || [])[1] || 'info';
      const body = [];
      i += 1;
      while (i < lines.length && !CALLOUT_CLOSE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // 吃掉收尾 :::
      const inner = mdToDoc(body.join('\n'));
      content.push({
        type: 'callout',
        attrs: { type: String(type || 'info').toLowerCase() },
        content: inner.content.length ? inner.content : [{ type: 'paragraph' }],
      });
      continue;
    }
    // ── v1.3.1：视频 / 音频（独占一行的 html） ──
    if (MEDIA_LINE_RE.test(line)) {
      flushPara();
      const m = MEDIA_LINE_RE.exec(line);
      const kind = m[1].toLowerCase();
      const src = attrOf(m[2], 'src');
      if (src) {
        /*
         * v1.3.3.2：宽度 / 对齐跟着标签属性一起读回来。
         * 老笔记没有这两个属性 → 保持自动宽度（null），不改变原样。
         */
        const w = Number(attrOf(m[2], 'width')) || 0;
        const h = Number(attrOf(m[2], 'height')) || 0;
        const al = /align\s*=\s*"?(left|center|right)"?/i.exec(m[2] || '');
        const attrs = { src, poster: attrOf(m[2], 'poster') || '' };
        if (w > 0) attrs.width = w;
        if (h > 0) attrs.height = h;
        if (al) attrs.align = al[1].toLowerCase();
        content.push({ type: kind, attrs });
      } else {
        // 没有 src 就当成普通文本，绝不悄悄丢掉一行
        content.push({ type: 'paragraph', content: [{ type: 'text', text: line.trim() }] });
      }
      i += 1;
      continue;
    }
    // ── v1.3.1：附件（独占一行的 a.gh-file） ──
    if (FILE_LINE_RE.test(line)) {
      flushPara();
      const m = FILE_LINE_RE.exec(line);
      content.push({
        type: 'fileAttachment',
        attrs: {
          href: attrOf(m[1], 'href'),
          name: unescapeMd(String(m[2] || '').trim()) || '附件',
        },
      });
      i += 1;
      continue;
    }
    /*
     * v1.3.3.2：独占一行的 `![[file:…]]`（含可选宽度）显式收成一个「只含附件」的段落。
     *
     * 附件节点是**行内**原子（解析侧本来就把 token 放在段落里），所以这里不能
     * 直接 push 一个块节点 —— 那会让 schema 对不上。包成段落既保持了「独占一行」
     * 的块级观感（前后有空行），序列化回来也还是同一行。
     */
    {
      const fm = /^\s*!\[\[file:([^|\]]+)(?:\|([^\]]*))?\]\]\s*(?:\{([^}]*)\})?\s*$/.exec(line);
      if (fm) {
        flushPara();
        const attrs = { href: fm[1], name: String(fm[2] || '附件').trim() || '附件' };
        const w = /width\s*=\s*(\d+)/.exec(fm[3] || '');
        const h = /height\s*=\s*(\d+)/.exec(fm[3] || '');
        if (w) attrs.width = Number(w[1]);
        if (h) attrs.height = Number(h[1]);
        content.push({ type: 'paragraph', content: [{ type: 'fileAttachment', attrs }] });
        i += 1;
        continue;
      }
    }
    // ── v1.3.1：GFM 表格（表头 + 分隔行 + 若干数据行） ──
    if (isTableRow(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      flushPara();
      const splitRow = (s) =>
        String(s)
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
      const aligns = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':');
        const r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
      });
      const headCells = splitRow(line).map((text, idx) => ({
        type: 'tableHeader',
        attrs: { align: aligns[idx] || null },
        content: [{ type: 'paragraph', content: normalizeInline(parseInline(text)) }],
      }));
      const rows = [{ type: 'tableRow', content: headCells }];
      i += 2;
      while (i < lines.length && isTableRow(lines[i]) && lines[i].trim()) {
        const cells = splitRow(lines[i]).map((text, idx) => ({
          type: 'tableCell',
          attrs: { align: aligns[idx] || null },
          content: [{ type: 'paragraph', content: normalizeInline(parseInline(text)) }],
        }));
        rows.push({ type: 'tableRow', content: cells });
        i += 1;
      }
      /*
       * v1.3.7：表格尺寸元数据
       * 管道表格语法本身没有宽度 / 行高，改尺寸只能在表格后附一行 HTML 注释：
       *   <!--gh-table:{"w":680,"h":320,"cols":[120,200],"rows":[40,null]}-->
       * 注释在预览里不可见，也不影响第三方 md 查看器。
       */
      const tableNode = { type: 'table', content: rows };
      const metaLine = String(lines[i] || '').trim();
      const metaMatch = /^<!--gh-table:(\{.*\})-->(?:\s+\^blk_[0-9a-f]{8})?$/.exec(metaLine);
      if (metaMatch) {
        try {
          const meta = JSON.parse(metaMatch[1]);
          const w = Number(meta.w) || 0;
          const h = Number(meta.h) || 0;
          if (w || h) tableNode.attrs = { tableSize: `${w || ''}x${h || ''}` };
          if (Array.isArray(meta.rows)) {
            rows.forEach((row, idx) => {
              const rh = Number(meta.rows[idx]) || 0;
              if (rh > 0) row.attrs = { ...(row.attrs || {}), rowHeight: rh };
            });
          }
          if (Array.isArray(meta.cols) || w) {
            /* 宽度以列宽之和为准：按 meta.w 等比缩放，Table 重绘时才不会被改回去 */
            /* v1.3.8：列数按 colspan 展开后的网格列算，合并单元格也不会错位 */
            const gridCount = (row) => (row.content || []).reduce(
              (n, cell) => n + Math.max(1, Number(cell.attrs?.colspan) || 1),
              0,
            );
            const nCols = Math.max(1, gridCount(rows[0]));
            const raw = Array.from({ length: nCols }, (_, idx) => Number(meta.cols?.[idx]) || 0);
            const sum = raw.reduce((a, b) => a + b, 0);
            let widths = raw;
            if (w > 0) {
              const base = sum > 0 ? raw : new Array(nCols).fill(1);
              const unit = w / base.reduce((a, b) => a + b, 0);
              widths = base.map((x) => Math.max(30, Math.round(x * unit)));
              widths[widths.length - 1] += w - widths.reduce((a, b) => a + b, 0);
            }
            rows.forEach((row) => {
              let col = 0;
              (row.content || []).forEach((cell) => {
                const span = Math.max(1, Number(cell.attrs?.colspan) || 1);
                const slice = widths.slice(col, col + span);
                if (slice.length && slice.every((n) => n > 0)) {
                  cell.attrs = { ...(cell.attrs || {}), colwidth: slice };
                }
                col += span;
              });
            });
          }
        } catch (e) { /* 元数据坏了就当没有，不影响正文 */ }
        i += 1;
      }
      content.push(tableNode);
      continue;
    }
    if (TASK_RE.test(line)) {
      flushPara();
      const [node, next] = collectList(lines, i, 'task');
      if (node) content.push(node);
      i = next;
      continue;
    }
    if (BULLET_RE.test(line)) {
      flushPara();
      const [node, next] = collectList(lines, i, 'bullet');
      if (node) content.push(node);
      i = next;
      continue;
    }
    if (ORDERED_RE.test(line)) {
      flushPara();
      const [node, next] = collectList(lines, i, 'ordered');
      if (node) content.push(node);
      i = next;
      continue;
    }
    // 普通文本行（表格行也走这里 —— v1.3 不支持表格，宁可降级成文本也不丢内容）
    para.push(line.trim() === '' ? '' : line);
    i += 1;
  }
  flushPara();
  if (!content.length) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

// ============================================================
//  反向：doc → md
// ============================================================

/** 行首若长得像块级语法，加反斜杠转义，避免下次解析被当成标题 / 列表 */
function escapeLineStart(text) {
  return String(text || '').replace(/^(\s*)(#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/, '$1\\$2');
}

function inlineToMd(nodes = []) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'hardBreak') {
      // v1.3.1.2：写成实体 <br>，预览与第三方查看器都稳定识别
      out.push('<br>');
      continue;
    }
    if (n.type === 'annotation') {
      out.push(`<sup class="gh-ann" data-note="${encodeAnnNote(n.attrs?.note || '')}">?</sup>`);
      continue;
    }
    if (n.type === 'image') {
      out.push(`![${n.attrs?.alt || ''}](${n.attrs?.src || ''})`);
      continue;
    }
    /*
     * v1.3.1.2：附件在行内被解析出来（`![[file:…]]` 是行内原子），
     * 但它的序列化分支写在块级 switch 里 —— 少了这一段，行内附件会被整段丢掉。
     */
    if (n.type === 'fileAttachment') {
      const href = String(n.attrs?.href || '');
      const name = String(n.attrs?.name || '附件').replace(/[|\]]/g, ' ');
      const w = Number(n.attrs?.width) || 0;
      const h = Number(n.attrs?.height) || 0;
      const bits = [];
      if (w > 0) bits.push(`width=${Math.round(w)}`);
      if (h > 0) bits.push(`height=${Math.round(h)}`);
      out.push(`![[file:${href}|${name}]]${bits.length ? `{${bits.join(' ')}}` : ''}`);
      continue;
    }
    if (n.type === 'noteRef' || n.type === 'noteEmbed') {
      const bang = n.type === 'noteEmbed' ? '!' : '';
      const blk = n.attrs?.blockId ? `#blk:${n.attrs.blockId}` : '';
      const label = n.attrs?.label ? `|${n.attrs.label}` : '';
      out.push(`${bang}[[note:${n.attrs?.noteId || ''}${blk}${label}]]`);
      continue;
    }
    if (n.type === 'blockRef') {
      out.push(`((${n.attrs?.blockId || ''}))`);
      continue;
    }
    if (n.type !== 'text') continue;
    let t = unescapeMd(n.text || '');
    const marks = n.marks || [];
    const has = (x) => marks.some((m) => m.type === x);
    /*
     * 顺序：内层语义（字号 / 颜色 / 下划线 / 高亮）先包，再加粗体与斜体。
     * v1.3.1.2 补上了 underline 与 highlight —— 之前它们在序列化里没有分支，
     * 保存一次就被悄悄吞掉（编辑器看着有、重开就没了）。
     */
    const fs = marks.find((m) => m.type === 'fontSize');
    if (fs?.attrs?.size) t = `<span class="gh-fs-${fs.attrs.size}">${t}</span>`;
    const color = marks.find((m) => m.type === 'textColor');
    if (color?.attrs?.color) t = `<span class="gh-c-${color.attrs.color}">${t}</span>`;
    if (has('underline')) t = `<u>${t}</u>`;
    if (has('highlight')) t = `==${t}==`;
    if (has('code')) t = `\`${t}\``;
    if (has('bold')) t = `**${t}**`;
    if (has('italic')) t = `*${t}*`;
    if (has('strike')) t = `~~${t}~~`;
    const link = marks.find((m) => m.type === 'link');
    if (link?.attrs?.href) t = `[${t}](${link.attrs.href})`;
    out.push(t);
  }
  return out.join('');
}

function listItemToMd(item, kind, depth, index) {
  // 缩进 = 层级 × 2 空格（depth 已经是「当前项所在层」，不要再 +1，
  // 否则第一层就有 2 空格缩进，下次解析会被当成嵌套、整段列表错位）
  const pad = '  '.repeat(depth);
  const parts = (item.content || []).filter(Boolean);
  const first = parts[0];
  const text = first && first.type === 'paragraph' ? inlineToMd(first.content) : '';
  const bullet =
    kind === 'ordered' ? `${index + 1}. ` : kind === 'task' ? `- [${item.attrs?.checked ? 'x' : ' '}] ` : '- ';
  const lines = [`${pad}${bullet}${escapeLineStart(text)}`];
  /*
   * v1.3.4.1（需求：列表下嵌套的其他内容保存后变成平级）
   *
   * 上一版对子块直接 `lines.push(sub)`，子块没有任何缩进 —— 存成 md 以后
   * 「列表项下的引述 / 代码块 / 段落」全都跑到顶层，重新打开就散架了。
   * 现在按思源的写法给每个子块整体加一层缩进（depth + 1 级，每级 2 空格）；
   * 子列表本身在 blockToMd 里已经按 depth+1 排好，不再重复加。
   */
  for (const child of parts.slice(1)) {
    const sub = blockToMd(child, depth + 1);
    if (!sub) continue;
    const isSubList = child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList';
    if (isSubList) {
      lines.push(sub);
    } else {
      const subPad = '  '.repeat(depth + 1);
      const wrapped = sub.split('\n').map((l) => (l.trim() ? subPad + l : l)).join('\n');
      /*
       * v1.3.4.2（需求：列表下级的文字 / 图片 / 文件 / 引述等保存后保持格式）
       * 非列表子块前留一个空行，写成 markdown 的「松散列表」：
       * 不留空行时，缩进的纯文字会被并进上一项的文字里（`- 二级 我是子内容`），
       * 图片也会因为缺少块边界而被当成行内元素合并到同一段。
       */
      lines.push('');
      lines.push(wrapped);
    }
  }
  return lines.join('\n');
}

function blockToMd(node, depth = 0) {
  switch (node.type) {
    case 'paragraph': {
      const text = inlineToMd(node.content).split('\n').map(escapeLineStart).join('\n');
      const align = String(node.attrs?.align || '');
      // v1.3.1.1：有对齐就落成 `<p align="...">`，否则保持最朴素的段落
      return align ? `<p align="${align}">${text}</p>` : text;
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      /*
       * v1.3.1.1：标题**不做对齐**。
       * md 的标题语法没有对齐位，硬塞 HTML 会让「md 是真源」这条破功
       * （其它查看器看到一个带属性的 span，本系统再解析回来还得写特例）。
       * 对齐只给段落 —— 段落在 md 里本来就可以用 `<p align>` 表达。
       */
      return `${'#'.repeat(level)} ${inlineToMd(node.content)}`;
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const kind = node.type === 'bulletList' ? 'bullet' : node.type === 'orderedList' ? 'ordered' : 'task';
      return (node.content || []).map((item, idx) => listItemToMd(item, kind, depth, idx)).join('\n');
    }
    case 'blockquote': {
      const inner = (node.content || []).map((c) => blockToMd(c, depth)).join('\n\n');
      // 空行不写入 —— 硬换行会产生只含两个空格的空行，加前缀后会变成 `>` 空引用行，
      // 下一次解析又多出一段，往返就不稳定了（引用里的换行靠 `> ` 前缀本身表达）
      return inner
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => `> ${l}`)
        .join('\n');
    }
    case 'codeBlock': {
      const lang = String(node.attrs?.language || '');
      const text = (node.content || []).map((c) => c.text || '').join('');
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case 'horizontalRule':
      return '---';
    case 'image': {
      /*
       * 宽度与对齐都写进 md 的尾部属性块：`{width=600 align=center}`。
       * v1.3.1.2：对齐也要能持久化 —— 用户把图居中，重新打开不能又回到左边。
       */
      const w = Number(node.attrs?.width) || 0;
      const h = Number(node.attrs?.height) || 0;
      const al = String(node.attrs?.align || '');
      const parts = [];
      if (w > 0) parts.push(`width=${Math.round(w)}`);
      if (h > 0) parts.push(`height=${Math.round(h)}`);
      if (al) parts.push(`align=${al}`);
      const tail = parts.length ? `{${parts.join(' ')}}` : '';
      return `![${node.attrs?.alt || ''}](${node.attrs?.src || ''})${tail}`;
    }
    // ── v1.3.1 新增块 ──
    /*
     * v1.3.3.2：视频 / 音频 / 附件也能拖框改大小，宽度同样要能落进 md。
     *   视频 / 音频 → HTML 属性 width / align（DOMPurify 白名单放行，预览一致）
     *   附件       → 尾部属性块 `{width=320}`，与图片 `{width=600}` 同一套写法
     */
    case 'video':
    case 'audio': {
      const w = Number(node.attrs?.width) || 0;
      const h = Number(node.attrs?.height) || 0;
      const al = String(node.attrs?.align || '');
      const extra = `${w > 0 ? ` width="${Math.round(w)}"` : ''}${h > 0 ? ` height="${Math.round(h)}"` : ''}${al ? ` align="${al}"` : ''}`;
      return `<${node.type} src="${node.attrs?.src || ''}"${extra} controls></${node.type}>`;
    }
    case 'fileAttachment': {
      /*
       * v1.3.1.2（需求：插入的附件不该是一坨 html a 标签）
       *
       * 换成 `![[file:地址|显示名]]`：和 `![[note:…]]` 是同一套写法，
       * 一眼能看出「这是一张卡片式的附件引用」，也方便以后统一做悬浮预览。
       * 解析侧仍然兼容老的 `<a class="gh-file">` —— 旧笔记不会因为这次改动丢附件。
       */
      const name = String(node.attrs?.name || '附件').replace(/[|\]]/g, ' ');
      const w = Number(node.attrs?.width) || 0;
      const h = Number(node.attrs?.height) || 0;
      const bits = [];
      if (w > 0) bits.push(`width=${Math.round(w)}`);
      if (h > 0) bits.push(`height=${Math.round(h)}`);
      const tail = bits.length ? `{${bits.join(' ')}}` : '';
      return `![[file:${node.attrs?.href || ''}|${name}]]${tail}`;
    }
    case 'htmlBlock': {
      // 空内容也留围栏，避免往返时整块消失
      return `:::html\n${String(node.attrs?.html || '')}\n:::`;
    }
    case 'iframe': {
      const src = String(node.attrs?.src || '');
      const h = Math.max(120, Number(node.attrs?.height) || 420);
      const w = Number(node.attrs?.width) || 0;
      return `:::iframe{src="${src}" height="${h}"${w > 0 ? ` width="${Math.round(w)}"` : ''}}\n:::`;
    }
    case 'mathBlock': {
      // 公式按原样写回，空公式也保留围栏，避免解析回来变成段落
      return `$$\n${String(node.attrs?.formula || '').trim()}\n$$`;
    }
    case 'tabsBlock': {
      // v1.3.5.2：content 结构（tabItem+），逐个子节点写回 `@tab 标题` + 正文
      const items = (node.content || []).filter((c) => c && c.type === 'tabItem');
      const parts = items.map((t) => {
        const tag = t.attrs && t.attrs.active ? '@tab:active' : '@tab';
        const title = String((t.attrs && t.attrs.title) || '').trim() || '页签';
        const body = (t.content || []).map((c) => blockToMd(c, depth)).join('\n\n').trim();
        return `${tag} ${title}\n\n${body}`;
      });
      return `::: tabs\n\n${parts.join('\n\n')}\n\n:::`;
    }
    /* tabItem 只在 tabsBlock 内部出现；单独序列化时按普通块拼回去（防御性分支） */
    case 'tabItem': {
      return (node.content || []).map((c) => blockToMd(c, depth)).join('\n\n');
    }
    case 'callout': {
      /*
       * v1.3.5.1：统一写成 GitHub 风格 `> [!TAG]`（需求指定的源码格式）。
       * 旧的 `:::callout{type=...}` 输入仍由 mdToDoc 兼容解析，所以已有内容
       * 保存一次后平滑换成新格式，不会丢内容、也不会往返抖动。
       */
      const type = String(node.attrs?.type || 'info');
      // v1.3.5.2：优先用用户自定义的标签文字，没改过才回落到类型的默认映射
      const tag = String(node.attrs?.tag || '').trim() || GITHUB_ALERT_TAG[type] || 'NOTE';
      const inner = (node.content || []).map((c) => blockToMd(c, depth)).join('\n\n');
      const body = String(inner || '')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => `> ${l}`)
        .join('\n');
      return `> [!${tag}]${body ? `\n${body}` : ''}`;
    }
    case 'table': {
      const rows = (node.content || []).filter((r) => r.type === 'tableRow');
      if (!rows.length) return '';
      const cellText = (cell) =>
        (cell.content || [])
          .map((c) => inlineToMd(c.content))
          .join(' ')
          .replace(/\|/g, '\\|')
          .trim();
      const lines = rows.map((row) => `| ${(row.content || []).map(cellText).join(' | ')} |`);
      const cols = Math.max(...rows.map((r) => (r.content || []).length), 1);
      // 分隔行带对齐：md 里 `:---:` = 居中，`---:` = 右对齐
      const alignOf = (row, idx) => (row?.content?.[idx]?.attrs?.align || null);
      const sep = Array.from({ length: cols }, (_, idx) => {
        const a = alignOf(rows[0], idx);
        return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---';
      });
      lines.splice(1, 0, `| ${sep.join(' | ')} |`);
      const md = lines.join('\n');
      /* v1.3.7：把表格 / 行 / 列尺寸写进一行注释，重新打开还能还原 */
      const meta = {};
      const size = /^\s*(\d+)?\s*x\s*(\d+)?\s*$/.exec(String(node.attrs?.tableSize || ''));
      /*
       * v1.3.8：列宽按 colspan 展开成网格列。
       * 旧写法只看第一行每个单元格的 colwidth[0]，合并单元格的表格会被写成
       * 少几列 / 宽度对不上，重开后被当成「没有列宽」，整表又铺满 100%。
       */
      const gridWidths = [];
      (rows[0].content || []).forEach((cell) => {
        const span = Math.max(1, Number(cell.attrs?.colspan) || 1);
        const cw = Array.isArray(cell.attrs?.colwidth) ? cell.attrs.colwidth : [];
        for (let j = 0; j < span; j += 1) {
          gridWidths.push(Number(cw[j]) || Number(cw[0]) || 0);
        }
      });
      const colSum = gridWidths.reduce((a, b) => a + b, 0);
      if (size && (size[1] || size[2])) {
        if (size[1]) meta.w = Number(size[1]);
        if (size[2]) meta.h = Number(size[2]);
      }
      if (colSum > 0) {
        if (!meta.w) meta.w = colSum;
        meta.cols = gridWidths.map((n) => n || null);
      }
      const rowHeights = rows.map((r) => Number(r.attrs?.rowHeight) || 0);
      if (rowHeights.some(Boolean)) meta.rows = rowHeights.map((n) => n || null);
      return Object.keys(meta).length ? `${md}\n<!--gh-table:${JSON.stringify(meta)}-->` : md;
    }
    case 'hardBreak':
      return '';
    default: {
      // 未知块（以后的表格 / 公式）：把里面的文字捞出来，绝不静默丢弃
      const text = collectText(node);
      return text || '';
    }
  }
}

function collectText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (!node.content) return '';
  return node.content.map(collectText).join('');
}

/** ProseMirror doc → md（末尾不带换行：md 是本值的规范形态，多余空白会让 diff 变脏） */
export function docToMd(doc) {
  if (!doc || !Array.isArray(doc.content)) return '';
  return doc.content
    .map((n) => blockToMd(n))
    .filter((s) => s !== null && s !== undefined)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

// ============================================================
//  渲染（预览模式 / 以后的公开页共用）
// ============================================================

/**
 * 允许的标签 / 属性白名单。
 *
 * 为什么用白名单而不是「默认全过再拉黑 script」：md 渲染的结果会进 innerHTML，
 * 只要漏一个属性就可能是存储型 XSS（`<img src=x onerror=...>`）。
 * 白名单的默认语义是「没写的一律去掉」，漏配的后果是「样式少了一点」而不是「被注入」。
 */
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'del', 's', 'u', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div',
    // 任务列表 `- [ ]` 在预览/只读渲染里是 <input type="checkbox">，不放行整块复选框会消失
    'input',
    // v1.3.1：视频 / 音频块在预览里要能直接播
    'video', 'audio', 'source',
    // v1.3.1.2：HTML 块里常用的语义标签 + 网页嵌入
    'mark', 'sup', 'sub', 'figure', 'figcaption', 'details', 'summary', 'iframe',
  ],
  /*
   * id 必须放行：背景墙纸 mixin 用 `getElementById('bg1'/'bg2')` 取节点，
   * 剥掉 id 会让整套背景轮播失效（v1.3.0 收口 v-html 时踩到）。
   * DOMPurify 默认开启 SANITIZE_DOM，会挡掉 id/name 覆盖内建属性的 DOM clobbering，
   * 所以放行 id 仍然安全。
   */
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'class', 'target', 'rel', 'colspan', 'rowspan',
    'id', 'type', 'checked', 'disabled',
    // 媒体：controls / poster / download 是播放与下载的必需属性
    'controls', 'poster', 'download', 'preload', 'align',
    // v1.3.1.2：iframe 的尺寸与惰性加载属性
    'loading', 'referrerpolicy', 'frameborder', 'allowfullscreen', 'width', 'height',
    // v1.3.5.1：style 只作为「钩子过滤的输入」放行，真正允许的值见下方 uponSanitizeAttribute
    'style',
  ],
  // 只允许 http/https/相对地址，挡掉 javascript: 与 data:text/html
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  ADD_ATTR: ['target'],
  // 外链一律新窗口 + noopener，避免 window.opener 被反向控制
  FORBID_ATTR: ['onerror', 'onload', 'onclick'],
};

/*
 * style 的「唯一放行口径」（v1.3.3.2）。
 *
 * 附件卡片可以被拖框改宽度，而这个宽度在预览 / 只读渲染里没有别的表达方式
 * （a 元素不吃 width 属性）。与其为了一个宽度整体放开 style（那等于把
 * `style="background:url(javascript:…)"` 这类口子也打开），不如只认白名单形状：
 * 仅 .gh-file 上的 `width:Npx` / `max-width:Npx`，其余 style 一律丢弃。
 */
if (typeof DOMPurify.addHook === 'function') {
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName !== 'style') return;
    const v = String(data.attrValue || '').trim();
    let ok =
      node && node.classList && node.classList.contains('gh-file') &&
      /^(max-)?width:\s*\d{1,4}px$/i.test(v);
    /*
     * v1.3.5.1：KaTeX 的公式排版全靠 inline style（height / top / vertical-align …），
     * 一律剥掉公式会散架。只对 .katex 容器内的节点放行，且样式值必须是
     * 「属性名:值;」这种纯排版写法，不许出现 url() / expression / javascript: /
     * @import / 标签字符，避免把这里开成 XSS 口子。
     */
    if (!ok && node && typeof node.closest === 'function' && node.closest('.katex')) {
      ok = !/url\s*\(|expression|javascript:|@import|[<>]|\\/i.test(v)
        && /^[\w-]+\s*:\s*[^;:]+(;\s*[\w-]+\s*:\s*[^;:]+)*;?\s*$/.test(v);
    }
    if (!ok) {
      data.keepAttr = false;
      data.attrValue = '';
    }
  });
}

marked.setOptions({ gfm: true, breaks: false });

/** md → 安全 HTML（预览模式 / 以后的公开页都走这里，禁止绕过） */
/**
 * 把 `:::html` / `:::iframe` 围栏抽出来换成占位符，交给 marked 之后的原样注入。
 *
 * 为什么不直接让 marked 渲染：marked 只认 CommonMark，不认识 ::: 围栏，
 * 会把整段当普通段落并用 `:::` 开头（还会把里面的 HTML 当行内 HTML 处理，
 * 结果是被 <p> 包住、块级 div 嵌套非法）。抽出来自己做，边界最清楚。
 */
function extractFences(md) {
  const blocks = [];
  const lines = String(md || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (HTML_OPEN_RE.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !CALLOUT_CLOSE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'html', html: body.join('\n') });
      out.push('', `@@GHBLOCK${blocks.length - 1}@@`, '');
      continue;
    }
    if (IFRAME_OPEN_RE.test(line)) {
      const m = IFRAME_OPEN_RE.exec(line);
      const src = attrOf(m?.[1] || '', 'src');
      const height = Number((/height\s*=\s*"?([0-9]+)/i.exec(m?.[1] || '') || [])[1]) || 420;
      while (i < lines.length && !CALLOUT_CLOSE_RE.test(lines[i])) i += 1;
      blocks.push({ type: 'iframe', src, height });
      out.push('', `@@GHBLOCK${blocks.length - 1}@@`, '');
      continue;
    }
    /*
     * v1.3.5.1：数学公式块 —— marked 会把 `$$` 当普通文本，先用 KaTeX 渲染成 HTML。
     * throwOnError:false 保证写错的公式只显示红字，不会让整篇预览崩掉。
     */
    if (MATH_FENCE_RE.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !MATH_FENCE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      const formula = body.join('\n').trim();
      let rendered = '';
      try {
        rendered = katex.renderToString(formula, { displayMode: true, throwOnError: false, output: 'html' });
      } catch (e) {
        rendered = `<span class="gh-math-error">${formula.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))}</span>`;
      }
      blocks.push({ type: 'math', html: `<div class="gh-math">${rendered}</div>` });
      out.push('', `@@GHBLOCK${blocks.length - 1}@@`, '');
      continue;
    }
    /*
     * v1.3.5.1：页签块 —— 预览是静态 HTML，用 radio + label 做无 JS 的切换。
     * 每个块用 blocks 下标生成唯一 name / id，同页多个页签块互不串台。
     */
    if (TABS_OPEN_RE.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !CALLOUT_CLOSE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      const tabs = [];
      let cur = null;
      body.forEach((raw) => {
        const m = TAB_HEAD_RE.exec(raw);
        if (m) {
          cur = { title: String(m[1] || '').trim(), active: /^@tab:active/i.test(String(raw).trim()), lines: [] };
          tabs.push(cur);
          return;
        }
        if (cur) cur.lines.push(raw);
      });
      const escH = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const uid = blocks.length;
      const activeIdx = Math.max(0, tabs.findIndex((t) => t.active));
      const inputs = tabs.map((_t, idx) => `<input type="radio" name="gh-tabs-${uid}" id="gh-tab-${uid}-${idx}"${idx === activeIdx ? ' checked' : ''}>`).join('');
      const heads = tabs.map((t, idx) => `<label class="gh-tabs-label" for="gh-tab-${uid}-${idx}">${escH(t.title)}</label>`).join('');
      const panels = tabs.map((t, idx) => `<div class="gh-tabs-panel" data-panel="${idx}">${String(marked.parse(String(t.lines.join('\n').trim() || ''), { async: false }) || '')}</div>`).join('');
      blocks.push({
        type: 'tabs',
        html: `<div class="gh-tabs">${inputs}<div class="gh-tabs-head">${heads}</div><div class="gh-tabs-panels">${panels}</div></div>`,
      });
      out.push('', `@@GHBLOCK${blocks.length - 1}@@`, '');
      continue;
    }
    /*
     * v1.3.5.1：GitHub 风格提示块在预览里也要有「醒目提示」的样子。
     * marked 只会把 `> [!IMPORTANT]` 渲染成普通引用（还带着方括号文本），
     * 所以先整块抽出来换成占位符，正文单独过 marked，再包一层 callout 外壳。
     */
    if (GITHUB_ALERT_RE.test(line)) {
      const m = GITHUB_ALERT_RE.exec(line);
      const rawType = String(m?.[1] || 'NOTE').toUpperCase();
      const type = GITHUB_ALERT_TYPE[rawType] || 'info';
      const body = [];
      i += 1;
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        body.push(lines[i].replace(QUOTE_RE, ''));
        i += 1;
      }
      i -= 1; // 循环停在第一个非「>」行上，回退一步交给 for 的 i += 1
      const innerHtml = String(marked.parse(body.join('\n'), { async: false }) || '');
      blocks.push({
        type: 'callout',
        html: `<div class="gh-callout gh-callout-${type}" data-callout="${type}"><div class="gh-callout-title">${rawType}</div><div class="gh-callout-body">${innerHtml}</div></div>`,
      });
      out.push('', `@@GHBLOCK${blocks.length - 1}@@`, '');
      continue;
    }
    out.push(line);
  }
  return { text: out.join('\n'), blocks };
}

export function renderMarkdownSafe(md) {
  // 预览同样要剥块 ID：把 ^blk_x 原样渲染出来对读者毫无意义
  const extracted = extractFences(stripBlockIds(md));
  /*
   * 附件（v1.3.1.2）：`![[file:地址|名称]]` 在正文里是原子引用，
   * 预览里要落成「可下载的附件卡片」（<a class="gh-file">）。
   * 先换占位符，避免 marked 把它当普通文本、也避免文件名里的字符破坏 md 结构。
   */
  const files = [];
  // v1.3.3.2：尾部 `{width=N}` 要一起吃掉，否则预览里会多出一段 `{width=320}` 文字
  const textWithFiles = extracted.text.replace(/!\[\[file:([^|\]]+)(?:\|([^\]]*))?\]\](\{width=\d+\})?/g, (_m, href, name, wtail) => {
    const w = /width\s*=\s*(\d+)/.exec(wtail || '');
    files.push({ href: String(href || ''), name: String(name || '附件'), width: w ? Number(w[1]) : 0 });
    return `@@GHFILE${files.length - 1}@@`;
  });
  const blocks = extracted.blocks;
  let html = String(marked.parse(textWithFiles, { async: false }) || '');
  /*
   * 占位符替换：marked 会给独立成段的占位符包一层 <p>，先连 <p> 一起换掉，
   * 避免出现 `<p><div>…</div></p>` 这种非法嵌套（浏览器会自动闭合，但样式会飘）。
   */
  blocks.forEach((b, i) => {
    const ph = `@@GHBLOCK${i}@@`;
    const rendered =
      b.type === 'iframe'
        ? /^https?:\/\//i.test(b.src)
          ? `<div class="gh-iframe-wrap"><iframe src="${b.src}" loading="lazy" referrerpolicy="no-referrer" frameborder="0" style="height:${Math.max(120, b.height)}px"></iframe></div>`
          : ''
        : b.html;
    html = html.replace(new RegExp(`<p>\\s*${ph}\\s*</p>`, 'g'), rendered);
    html = html.replace(new RegExp(ph, 'g'), rendered);
  });
  // 附件占位符 → 可点击的下载卡片（名字里的尖括号等要转义，否则会撕坏标签）
  const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  files.forEach((f, i) => {
    // v1.3.3.2：有宽度就写成行内 style —— 预览是静态 HTML，没有手柄可用
    const style = f.width > 0 ? ` style="width:${Math.round(f.width)}px"` : '';
    const a = `<a class="gh-file" href="${esc(f.href)}"${style} download>${esc(f.name)}</a>`;
    html = html.replace(new RegExp(`@@GHFILE${i}@@`, 'g'), a);
  });
  // 最后整体过一遍白名单：HTML 块里的 <script> / on* 属性在这一步被剥掉
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}

/** 任意 HTML → 安全 HTML（历史内容 / 第三方片段进 innerHTML 前统一过一遍） */
export function sanitizeHtml(html) {
  return DOMPurify.sanitize(String(html ?? ''), PURIFY_CONFIG);
}

/** md → 纯文本（列表摘要的前端兜底，口径与后端 memo.util.plainTextOf 一致） */
export function plainTextOf(md) {
  return stripBlockIds(md)
    .replace(/```[\s\S]*?```/g, ' ')
    // v1.3.1.2：HTML 块 / 网页嵌入不是正文，摘要里不出现
    .replace(/^:::\s*(?:html|iframe)[\s\S]*?^:::\s*$/gm, ' ')
    // v1.3.7：批注上标、图片尺寸、附件/笔记引用、块引用、裸 HTML 都不是正文
    .replace(/<sup class="gh-ann"[^>]*>[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[\[file:([^|\]]+)(?:\|([^\]]*))?\]\](\{[^}]*\})?/g, '$2')
    .replace(/!?\[\[note:[^\]]*\]\]/g, ' ')
    .replace(/\(\(blk_[0-9a-f]{8}\)\)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g, ' ')
    .replace(/\[\]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    // v1.3.5.1：提示块的类型标签不是正文，摘要里不出现 `[!IMPORTANT]`
    .replace(/^\s*\[![A-Z][A-Z0-9_-]*\]\s*$/gim, ' ')
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/\s+([。，、；：！？])/g, '$1')
    .trim();
}

/** md → 一行摘要 */
export function excerptOf(md, max = 140) {
  const t = plainTextOf(md);
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
