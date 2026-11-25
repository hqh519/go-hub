/**
 * 文章板块 · 纯函数工具（v1.4.0）
 * ----------------------------------------------------------------------------
 * 只放三件与「文章内容怎么算」有关的事，全部纯函数，前后端口径一致：
 *
 *   1) 类型归一 —— article / todo / nav 三种类型共用一张表，非法值一律回落 article；
 *   2) 待办完成率 —— 需求要求「检测正文中共有几个待办项、完成了几个」，
 *      这里按 markdown 任务列表语法统计，代码块内的示例不算（不能把教程里的
 *      `- [ ]` 当成真的待办）；
 *   3) 摘要兜底 —— 用户没填摘要时，从正文首段推一段，列表不留空；
 *      v1.4.1.1 起待办再往前一步：先取正文任务项名称当简介。
 */
import { plainTextOf, countMemoWords, stripBlockIds } from '../notes/memo.util';

/** 三种文章类型（导航本期只留位，不开放新建入口） */
export const ARTICLE_TYPES = ['article', 'todo', 'nav'] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

/** 单篇最多页签数（需求「无限增加」，实际按存储与列表体验设一个很高的上限） */
export const MAX_ARTICLE_TABS = 30;
/** 单个页签名长度 */
export const MAX_TAB_TITLE = 40;
/** 标题 / 摘要 / 备注长度上限 */
export const MAX_ARTICLE_TITLE = 200;
export const MAX_ARTICLE_EXCERPT = 500;
export const MAX_ARTICLE_NOTE = 2000;
/** 单个页签正文长度上限（字符） */
export const MAX_TAB_CONTENT = 500_000;

/** 类型归一：非法 / 空值一律按普通文章处理 */
export function normalizeArticleType(raw: unknown): ArticleType {
  const t = String(raw ?? '').trim();
  return (ARTICLE_TYPES as readonly string[]).includes(t) ? (t as ArticleType) : 'article';
}

/** 文章状态归一：只认 draft / published / deleted */
export function normalizeArticleStatus(raw: unknown): 'draft' | 'published' | 'deleted' {
  const s = String(raw ?? '').trim();
  if (s === 'published' || s === 'deleted') return s;
  return 'draft';
}

/**
 * 统计正文里的待办项。
 *
 * 语法：`- [ ] 标题` / `- [x] 标题`（有序列表 `1. [ ]` 同样算）。
 * 代码围栏（``` / ~~~）里的内容整段跳过 —— 教程里贴的任务列表示例不是真的待办。
 *
 * 返回 { total, done }：done 只数 `[x]` / `[X]`。
 */
export function countTodoTasks(md: unknown): { total: number; done: number } {
  const text = stripBlockIds(md) || '';
  let total = 0;
  let done = 0;
  let inFence = false;
  let fenceMark = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const fence = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (fence) {
      const mark = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceMark = mark;
      } else if (mark === fenceMark) {
        inFence = false;
        fenceMark = '';
      }
      continue;
    }
    if (inFence) continue;
    /*
     * 允许 `- [ ]` 与 `- [x]`，方括号后可以没有空格（`- [x]做完` 也是合法任务行，
     * 编辑器导出时偶尔会省略那个空格）。
     */
    const m = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s*/.exec(line);
    if (!m) continue;
    // 形如 `- [ ]` 后面什么都没有的空任务不计入（用户在敲格式时的中间态）
    if (!line.slice(m[0].length).trim()) continue;
    total += 1;
    if (m[1] === 'x' || m[1] === 'X') done += 1;
  }
  return { total, done };
}

/**
 * v1.4.1.1（需求：列表简介要过滤源码、文件等非文本）：
 * 把「看得见但读不出句子」的东西先剔掉 —— 代码围栏整段、附件 / 文件引用。
 * 图片与链接交给 plainTextOf 继续降级成 alt / 文字。
 */
function dropNonText(md: unknown): string {
  const src = stripBlockIds(String(md ?? ''));
  const kept: string[] = [];
  let inFence = false;
  let fenceMark = '';
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const fence = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (fence) {
      const mark = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceMark = mark;
      } else if (mark === fenceMark) {
        inFence = false;
        fenceMark = '';
      }
      continue;
    }
    if (inFence) continue;
    // `![[file:xxx|名称]]` / `[[file:xxx]]`：附件不是正文，名称也不进摘要
    kept.push(line.replace(/!?\[\[file:[^\]]*\]\](\{[^}]*\})?/g, ' '));
  }
  return kept.join('\n');
}

/** 摘要兜底：正文首段纯文本，最多 max 字（代码与附件不算正文） */
export function excerptOfArticle(md: unknown, max = 140): string {
  const text = plainTextOf(dropNonText(md)).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * v1.4.1.1（需求）：待办列表的简介优先看「正文里的任务项名称」。
 *
 * 没有手填摘要时，任务列表的项目名本身就是这篇待办的提纲，
 * 比正文首段更像简介；一条都没有（用户在正文里没写任务）时才回落到正文。
 * 代码围栏里的 `- [ ]` 依然不算（同 countTodoTasks 的口径）。
 */
export function todoNamesOfArticle(md: unknown, max = 140): string {
  const text = stripBlockIds(String(md ?? '')) || '';
  const names: string[] = [];
  let inFence = false;
  let fenceMark = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const fence = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (fence) {
      const mark = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceMark = mark;
      } else if (mark === fenceMark) {
        inFence = false;
        fenceMark = '';
      }
      continue;
    }
    if (inFence) continue;
    if (!/^\s*(?:[-*+]|\d+[.)])\s+\[(?:[ xX])\]\s*\S/.test(line)) continue;
    // 复用 plainTextOf 剥掉 `- [ ]`、加粗、行内代码等标记，只留项目名
    const name = plainTextOf(line).replace(/\s+/g, ' ').trim();
    if (name) names.push(name);
  }
  if (!names.length) return '';
  const joined = names.join(' · ');
  return joined.length > max ? `${joined.slice(0, max)}…` : joined;
}

/** 正文字数（与记事页同一套口径：汉字 + 字母） */
export function countArticleWords(md: unknown): number {
  return countMemoWords(md);
}
