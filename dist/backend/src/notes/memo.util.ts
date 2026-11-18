/**
 * 笔记（memo）· 纯函数工具（v1.3.0）
 * ----------------------------------------------------------------------------
 * 这里只放三件与「正文怎么算」有关的事，全部是纯函数，方便单测与前后端对齐：
 *
 *   1) 摘要 / 字数 —— 列表页不拉全文靠的就是这两个冗余值；
 *   2) 块 ID —— `^blk_xxxxxxxx` 行尾标记的写入与剥除（v1.5 才解析，但必须现在就开始写，
 *      否则以后是「回填全量历史内容」而不是「接上解析器」）；
 *   3) 纯文本化 —— 公开页、搜索、复制粘贴统一从这里出。
 *
 * 为什么块 ID 由内容哈希推导而不是随机：
 *   随机 ID 需要一个「块 → ID」的持久映射表，md 一旦被外部工具改动（导入、手改），
 *   映射就全错；哈希推导是幂等的 —— 同一段内容在任何机器上算出的 ID 都一样，
 *   正文本身携带 ID，md 依然是唯一真源。代价是「改字就会换 ID」，
 *   这一条由 v1.5 的 contentHash 认领机制解决（同哈希认领旧 ID）。
 */
import { createHash } from 'crypto';

/** 块 ID 前缀（与 `docs/规划/编辑器分期方案.md` §10.3 一致） */
export const BLOCK_ID_PREFIX = 'blk_';

/**
 * 行尾块 ID 标记：`^blk_1a2b3c4d`
 *
 * 必须限制在「行尾」，且前面要有空白 —— 否则正文里恰好写到 `a^blk_x` 会被误剥。
 * 只认十六进制，长度固定 8，避免把用户写的 `^blk_hello` 当成标记。
 */
const BLOCK_ID_RE = /[ \t]+\^blk_[0-9a-f]{8}[ \t]*$/;

/** 判断某一行是不是代码围栏的开关（``` 或 ~~~） */
function isFence(line: string): boolean {
  return /^\s{0,3}(```|~~~)/.test(line);
}

/**
 * 把 md 拆成「代码围栏内 / 外」两段。
 *
 * 块 ID 只在围栏外识别 —— 代码块里的 `^blk_xxx` 是示例文本，动了就是改用户代码。
 * 这是 §10.3 三条配套规则里的第三条。
 */
export function splitFences(md: string): { text: string; inFence: boolean }[] {
  const out: { text: string; inFence: boolean }[] = [];
  let inFence = false;
  for (const line of String(md ?? '').split('\n')) {
    if (isFence(line)) {
      // 围栏行本身归「外面」，但它之后的内容翻面（含围栏行自身不参与 ID 计算）
      out.push({ text: line, inFence });
      inFence = !inFence;
      continue;
    }
    out.push({ text: line, inFence });
  }
  return out;
}

/** 剥掉行尾的块 ID 标记（渲染出口 / 复制粘贴 / 摘要统一走这里） */
export function stripBlockIds(md: unknown): string {
  const lines = splitFences(String(md ?? ''));
  return lines
    .map((row) => (row.inFence ? row.text : row.text.replace(BLOCK_ID_RE, '')))
    .join('\n');
}

/** 一行是否「值得带块 ID」：空行、围栏线、表格分隔线、纯分隔符不带 */
function isBlockLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (isFence(line)) return false;
  // 水平分割线 / 表格分隔线 / 只由符号构成的装饰行
  if (/^([-*_])(\s*\1){2,}$/.test(t)) return false;
  if (/^\|?[\s:|-]+\|?$/.test(t)) return false;
  return true;
}

/**
 * 给每一行「内容块」补上块 ID。
 *
 * 规则（§10.3）：
 *   · 先剥掉已有的标记再重算 —— 幂等，同一份内容反复保存不会堆积；
 *   · ID = `blk_` + sha1(归一化文本 + #第几次出现) 前 8 位；
 *   · 代码围栏内一律不动；
 *   · 空行 / 分隔线不加（它们不是「块」）；
 *   · 表格行不加 —— 加了以后 `^blk_x` 会落进单元格文字里，
 *     导出 / 第三方渲染器会把它当正文显示出来。表格的块 ID 走「内容哈希派生」。
 */
export function withBlockIds(md: unknown): string {
  const lines = splitFences(String(md ?? ''));
  const seen = new Map<string, number>();
  const out: string[] = [];

  // 先标出「整段表格」的行号，这些行不参与注入
  const tableRows = new Set<number>();
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].inFence || !looksLikeTableRow(lines[i].text)) continue;
    let j = i;
    while (j < lines.length && !lines[j].inFence && looksLikeTableRow(lines[j].text)) j += 1;
    const run = lines.slice(i, j).map((r) => r.text.replace(BLOCK_ID_RE, ''));
    // 只有「第二行是分隔行」才算真表格，否则只是一段带竖线的正文
    if (run.length >= 2 && isTableSep(run[1])) {
      for (let k = i; k < j; k += 1) tableRows.add(k);
    }
    i = j - 1;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const row = lines[i];
    if (row.inFence) {
      out.push(row.text);
      continue;
    }
    const bare = row.text.replace(BLOCK_ID_RE, '');
    if (tableRows.has(i) || !isBlockLine(bare)) {
      out.push(bare);
      continue;
    }
    const key = bare.trim();
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    const hash = createHash('sha1').update(`${key}#${nth}`).digest('hex').slice(0, 8);
    out.push(`${bare.replace(/[ \t]+$/, '')} ^${BLOCK_ID_PREFIX}${hash}`);
  }
  return out.join('\n');
}

/** 行里带竖线、且不是围栏行 —— 表格候选 */
function looksLikeTableRow(line: string): boolean {
  return line.includes('|') && !isFence(line);
}

/** 表格分隔行：`| --- | :--: |` */
function isTableSep(line: string): boolean {
  return line.includes('-') && /^\s*\|?[\s:|-]+\|?\s*$/.test(line);
}

/**
 * md → 纯文本（摘要、字数、搜索都用它）。
 *
 * 只做「去语法」不做「排版」：
 *   · 去掉块 ID、标题井号、列表符号、引用符号、任务框；
 *   · 图片 / 链接保留可见文字（图片保留 alt）；
 *   · 代码围栏只留内容，不留 ```
 *   · 表格保留单元格文字，去掉分隔行。
 * 刻意不追求完美 —— 它的用途是「给人看一行摘要」，不是渲染。
 */
export function plainTextOf(md: unknown): string {
  const src = stripBlockIds(String(md ?? ''));
  const lines: string[] = [];
  let inFence = false;
  for (const line of src.split('\n')) {
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      lines.push(line);
      continue;
    }
    // 表格分隔行（|---|:--:|）整行丢掉
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')) continue;
    let t = line
      .replace(/^\s{0,3}#{1,6}\s*/, '') // 标题
      .replace(/^\s{0,3}>\s?/, '') // 引用
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '') // 任务
      .replace(/^\s*[-*+]\s+/, '') // 无序列表
      .replace(/^\s*\d+[.)]\s+/, '') // 有序列表
      .replace(/^\s*\|/, '') // 表格首尾竖线
      .replace(/\|\s*$/, '')
      .replace(/\|/g, ' ');
    // 图片 ![alt](url) → alt；链接 [text](url) → text
    t = t
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1');
    lines.push(t);
  }
  return lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 列表页摘要：取纯文本前 n 个字符。
 * 空白压缩成单空格 —— 摘要是一行，不能把换行带进列表。
 */
export function excerptOf(md: unknown, max = 140): string {
  const text = plainTextOf(md).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 正文字数（不含空白）。
 *
 * 口径与瞬间的 `countTextChars` **不同**：瞬间只数汉字/字母/数字，
 * 笔记要显示「多少字」的体感值，标点也算阅读量的一部分，所以这里只排除空白与块 ID。
 * 两套口径各自独立、互不覆盖 —— 不要为了「统一」把瞬间的规则改掉。
 */
export function countMemoChars(md: unknown): number {
  const text = stripBlockIds(plainTextOf(md));
  let n = 0;
  for (const ch of text) {
    if (!/\s/.test(ch)) n += 1;
  }
  return n;
}

/**
 * v1.3.4.2（需求：笔记列表的「N 字」要统计字数，不是字符数）
 *
 * 口径与编辑器顶部辅助栏的「字数」完全一致：**汉字 + 字母**。
 * 数字、标点、空白都不计入，所以同一篇笔记的字数一定小于等于 countMemoChars。
 * 两者并存：wordCount 给列表展示，charCount 继续留给历史记录与旧数据兜底。
 */
export function countMemoWords(md: unknown): number {
  const text = stripBlockIds(plainTextOf(md));
  const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = (text.match(/[a-zA-Z]/g) || []).length;
  return cn + en;
}

/** 从正文首行推一个标题（新建笔记没填标题时给列表一个可读的名字） */
export function titleFromContent(md: unknown, max = 40): string {
  const text = plainTextOf(md);
  if (!text) return '';
  const first = text.split('\n').map((s) => s.trim()).find(Boolean) || '';
  return first.length > max ? `${first.slice(0, max)}…` : first;
}
