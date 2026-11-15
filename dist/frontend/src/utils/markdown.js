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
/** 提示块围栏：`:::callout{type=info}` … `:::` */
const CALLOUT_OPEN_RE = /^\s*:::\s*callout\s*(?:\{([^}]*)\})?\s*$/i;
const CALLOUT_OPEN_LOOSE_RE = /^\s*:::\s*([a-z][\w-]*)\s*(?:\{([^}]*)\})?\s*$/i;
const CALLOUT_CLOSE_RE = /^\s*:::\s*$/;
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
          const subDoc = mdToDoc(e.sub.join('\n'));
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
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) break;
    const m = /^(\s*)/.exec(line);
    const ind = indentLevel(m ? m[1] : '');
    if (ind <= baseIndent) break;
    out.push(line);
    i += 1;
  }
  return [out, i];
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
      items[items.length - 1].text += ` ${line.trim()}`;
      i += 1;
      continue;
    }
    // 列表项内部的空行后面若还是列表，继续；否则结束
    if (!line.trim() && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
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
        content.push({
          type: kind,
          attrs: { src, poster: attrOf(m[2], 'poster') || '' },
        });
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
      content.push({ type: 'table', content: rows });
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
      out.push('  \n');
      continue;
    }
    if (n.type === 'image') {
      out.push(`![${n.attrs?.alt || ''}](${n.attrs?.src || ''})`);
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
  for (const child of parts.slice(1)) {
    const sub = blockToMd(child, depth + 1);
    if (sub) lines.push(sub);
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
      // 宽度写进 md：`{width=600}`。没有宽度时保持最朴素的 `![](src)`
      const w = Number(node.attrs?.width) || 0;
      const tail = w > 0 ? `{width=${Math.round(w)}}` : '';
      return `![${node.attrs?.alt || ''}](${node.attrs?.src || ''})${tail}`;
    }
    // ── v1.3.1 新增块 ──
    case 'video':
      return `<video src="${node.attrs?.src || ''}" controls></video>`;
    case 'audio':
      return `<audio src="${node.attrs?.src || ''}" controls></audio>`;
    case 'fileAttachment':
      return `<a href="${node.attrs?.href || ''}" class="gh-file" download>${String(node.attrs?.name || '附件').replace(/</g, '&lt;')}</a>`;
    case 'callout': {
      const type = String(node.attrs?.type || 'info');
      const inner = (node.content || []).map((c) => blockToMd(c, depth)).join('\n\n');
      // 内容空也要留一行，否则 `:::callout\n:::` 解析回来是个没有段落的容器，ProseMirror 会补空段落、往返抖动
      return `:::callout{type=${type}}\n${inner || ''}\n:::`;
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
      return lines.join('\n');
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
  ],
  // 只允许 http/https/相对地址，挡掉 javascript: 与 data:text/html
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  ADD_ATTR: ['target'],
  // 外链一律新窗口 + noopener，避免 window.opener 被反向控制
  FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
};

marked.setOptions({ gfm: true, breaks: false });

/** md → 安全 HTML（预览模式 / 以后的公开页都走这里，禁止绕过） */
export function renderMarkdownSafe(md) {
  // 预览同样要剥块 ID：把 ^blk_x 原样渲染出来对读者毫无意义
  const raw = marked.parse(stripBlockIds(md), { async: false });
  return DOMPurify.sanitize(String(raw || ''), PURIFY_CONFIG);
}

/** 任意 HTML → 安全 HTML（历史内容 / 第三方片段进 innerHTML 前统一过一遍） */
export function sanitizeHtml(html) {
  return DOMPurify.sanitize(String(html ?? ''), PURIFY_CONFIG);
}

/** md → 纯文本（列表摘要的前端兜底，口径与后端 memo.util.plainTextOf 一致） */
export function plainTextOf(md) {
  return stripBlockIds(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** md → 一行摘要 */
export function excerptOf(md, max = 140) {
  const t = plainTextOf(md);
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
