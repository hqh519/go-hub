/**
 * 笔记块解析器（v1.3.1 · v1.5.0 计划）
 * ----------------------------------------------------------------------------
 * 把一份 md 拆成「块列表」，写入 note_blocks_index；顺手提取引用关系写 note_links。
 *
 * 三条必须守住的规则：
 *
 * 1) **这是派生物**：结果完全由 md 决定，删表重跑必须得到同一批 blockId。
 *    所以 blockId 一律「有标记用标记、没标记用内容哈希」，绝不用随机数。
 *
 * 2) **代码围栏内不识别任何标记**（`^blk_` 与 `[[` 都不认）——
 *    代码块里的内容是用户代码，动了就是改人家代码。
 *
 * 3) **认领优先于新发**：保存时先看旧索引里有没有同 contentHash 的块，
 *    有就沿用它的 blockId。这样「把一段话删了又粘回来」引用不会断。
 *    这一步在 service 层做（需要读旧索引），本文件只负责解析出 hash。
 *
 * 与前端 `utils/markdown.js` 的块划分口径必须一致，否则索引与编辑器看到的不是一回事。
 */
import { createHash } from 'crypto';
import { splitFences } from './memo.util';

export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'listItem'
  | 'blockquote'
  | 'codeBlock'
  | 'table'
  | 'image'
  | 'video'
  | 'audio'
  | 'fileAttachment'
  | 'callout';

export interface ParsedBlock {
  blockId: string;
  blockType: BlockType;
  parentBlockId: string;
  blockOrder: number;
  depth: number;
  plainText: string;
  contentHash: string;
  headingLevel: number;
  /** md 里本来就带 `^blk_` 标记（这种 id 不许被认领逻辑改写） */
  explicit: boolean;
}

export interface ParsedLink {
  targetNoteId: string;
  targetBlockId: string;
  linkType: 'note' | 'block' | 'embed';
  excerpt: string;
}

/** 行尾块 ID：` ^blk_1a2b3c4d` */
const BLOCK_ID_RE = /[ \t]+\^blk_([0-9a-f]{8})[ \t]*$/;
/** 标题 */
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*)$/;
/** 列表：任务 / 无序 / 有序 */
const TASK_RE = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\s*)\d+[.)]\s+(.*)$/;
/** 围栏 */
const FENCE_RE = /^\s{0,3}(```|~~~)/;
/** callout 围栏 */
const CALLOUT_OPEN_RE = /^\s*:::\s*callout\s*(?:\{([^}]*)\})?\s*$/i;
const CALLOUT_CLOSE_RE = /^\s*:::\s*$/;
/** 独占一行的媒体 / 附件 / 图片 */
const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(\s*([^)\s]+)/;
const MEDIA_LINE_RE = /^\s*<(video|audio)\b([^>]*)>/i;
const FILE_LINE_RE = /^\s*<a\b([^>]*class="gh-file"[^>]*)>(.*?)<\/a>\s*$/i;
/** 表格行 */
const isTableRow = (line: string) => /\|/.test(line) && !FENCE_RE.test(line);

/** `[[note:id]]` / `[[note:id|标题]]` / `![[note:id#blk:bid]]` / `((blk_xxx))` */
const NOTE_REF_RE = /(!?)\[\[note:([A-Za-z0-9_-]+)(?:#blk:(blk_[0-9a-f]{8}))?(?:\|([^\]]*))?\]\]/g;
const BLOCK_REF_RE = /\(\((blk_[0-9a-f]{8})\)\)/g;

/** 缩进 → 层级（2 空格一层，4 空格也认） */
function indentLevel(spaces: string): number {
    const n = String(spaces || '').replace(/\t/g, '  ').length;
    return Math.floor(n / 2);
}

/** 内容哈希：与 withBlockIds 同一口径，用于「认领旧 ID」 */
function hashOf(text: string, nth: number): string {
    return createHash('sha1').update(`${text}#${nth}`).digest('hex').slice(0, 12);
}

/** 去掉 md 语法，只留给人看的文字（块预览、搜索都用它） */
function textOf(raw: string): string {
    return String(raw || '')
        .replace(/[ \t]+\^blk_[0-9a-f]{8}[ \t]*$/gm, '') // 行尾块 ID
        .replace(/^\s*:::\s*callout\b[^\n]*$/gm, '') // callout 围栏行
        .replace(/^\s*:::\s*$/gm, '') // callout 收尾
        .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, '') // 表格分隔行
        .replace(/\|/g, ' ') // 表格竖线
        .replace(/^\s{0,3}(```|~~~)[\w+-]*$/gm, '') // 代码围栏行
        .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '') // 任务标记
        .replace(/^\s*[-*+]\s+/gm, '') // 无序列表符号
        .replace(/^\s*\d+[.)]\s+/gm, '') // 有序列表符号
        .replace(/^\s{0,3}#{1,6}\s*/gm, '') // 标题井号
        .replace(/^\s{0,3}>\s?/gm, '') // 引用符号
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[\[note:([A-Za-z0-9_-]+)(?:#blk:(?:blk_[0-9a-f]{8}))?(?:\|([^\]]*))?\]\]/g, (_m, _id, label) => label || '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        .replace(/~~(.*?)~~/g, '$1')
        .replace(/\(\(blk_[0-9a-f]{8}\)\)/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * md → 块列表。
 *
 * 块粒度：一个标题 / 一段（连续普通行）/ 一个列表项 / 一个引用段 /
 * 一个代码块 / 一张表 / 一个媒体或附件 / 一个 callout（含其内部块）。
 */
export function parseBlocks(md: string): ParsedBlock[] {
    const rows = splitFences(String(md ?? ''));
    const blocks: ParsedBlock[] = [];
    const seen = new Map<string, number>();
    let order = 0;

    /** 列表栈：{ indent, blockId } —— 用来给子项找父块 */
    const listStack: { indent: number; blockId: string }[] = [];
    /** callout 栈（支持嵌套） */
    const calloutStack: { blockId: string; depth: number }[] = [];

    const push = (
        blockType: BlockType,
        rawText: string,
        opts: { explicitId?: string; depth?: number; parent?: string; headingLevel?: number } = {},
    ) => {
        const text = textOf(rawText);
        const key = text;
        const nth = seen.get(key) ?? 0;
        seen.set(key, nth + 1);
        const contentHash = hashOf(key || `empty-${order}`, nth);
        const explicit = !!opts.explicitId;
        const blockId = opts.explicitId || `blk_${contentHash.slice(0, 8)}`;
        const parent = opts.parent ?? (calloutStack.length ? calloutStack[calloutStack.length - 1].blockId : '');
        const depth = opts.depth ?? (calloutStack.length ? calloutStack[calloutStack.length - 1].depth : 0);
        blocks.push({
            blockId,
            blockType,
            parentBlockId: parent,
            blockOrder: order,
            depth,
            plainText: text,
            contentHash,
            headingLevel: opts.headingLevel ?? 0,
            explicit,
        });
        order += 1;
        return blockId;
    };

    /** 取行尾标记（仅围栏外） */
    const explicitIdOf = (line: string): string => {
        const m = BLOCK_ID_RE.exec(line);
        return m ? `blk_${m[1]}` : '';
    };

    let i = 0;
    let para: string[] = [];
    /** 段落里出现过的块 ID（取第一个，作为整段的显式 ID） */
    let paraId = '';
    const flushPara = () => {
        if (!para.length) return;
        push('paragraph', para.join('\n'), { explicitId: paraId || undefined });
        para = [];
        paraId = '';
    };

    while (i < rows.length) {
        const { text: line, inFence } = rows[i];
        /*
         * 结构判定一律在「剥掉行尾块 ID」的版本上做。
         * 正文是真源，ID 是附在行尾的注解 —— 不剥就会把
         * `:::callout{type=tip} ^blk_1a2b3c4d` 认成普通段落（v1.3.1 踩过）。
         */
        const bare = line.replace(BLOCK_ID_RE, '');
        const raw = line;

        // ── 代码围栏：整块聚合成一个块，内部不识别任何标记 ──
        if (inFence || FENCE_RE.test(bare)) {
            flushPara();
            const body: string[] = [line];
            i += 1;
            while (i < rows.length && (rows[i].inFence || FENCE_RE.test(rows[i].text))) {
                body.push(rows[i].text);
                i += 1;
                if (FENCE_RE.test(rows[i - 1].text) && body.length > 1) break;
            }
            push('codeBlock', body.join('\n'));
            continue;
        }

        if (!bare.trim()) {
            flushPara();
            i += 1;
            continue;
        }

        // ── callout ──
        if (CALLOUT_OPEN_RE.test(bare)) {
            flushPara();
            const id = push('callout', bare, { explicitId: explicitIdOf(raw) || undefined });
            calloutStack.push({ blockId: id, depth: calloutStack.length + 1 });
            i += 1;
            continue;
        }
        if (CALLOUT_CLOSE_RE.test(bare) && calloutStack.length) {
            flushPara();
            calloutStack.pop();
            i += 1;
            continue;
        }

        // ── 标题 ──
        const h = HEADING_RE.exec(bare);
        if (h) {
            flushPara();
            push('heading', h[2], { explicitId: explicitIdOf(raw) || undefined, headingLevel: h[1].length });
            listStack.length = 0;
            i += 1;
            continue;
        }

        // ── 任务 / 无序 / 有序列表 ──
        const task = TASK_RE.exec(bare);
        const bullet = task ? null : BULLET_RE.exec(bare);
        const ordered = task || bullet ? null : ORDERED_RE.exec(bare);
        if (task || bullet || ordered) {
            flushPara();
            const spaces = (task || bullet || ordered)![1];
            const indent = indentLevel(spaces);
            // 找到同级或更浅的父：栈里最后一项缩进必须更小
            while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
            const parentId = listStack.length
                ? listStack[listStack.length - 1].blockId
                : calloutStack.length
                  ? calloutStack[calloutStack.length - 1].blockId
                  : '';
            const depth = listStack.length + (calloutStack.length ? calloutStack.length : 0);
            const id = push('listItem', bare, {
                explicitId: explicitIdOf(raw) || undefined,
                parent: parentId,
                depth,
            });
            listStack.push({ indent, blockId: id });
            i += 1;
            continue;
        }

        // ── 引用 ──
        if (/^\s{0,3}>\s?/.test(bare)) {
            flushPara();
            const body: string[] = [];
            while (i < rows.length && /^\s{0,3}>\s?/.test(rows[i].text) && !rows[i].inFence) {
                body.push(rows[i].text.replace(/^\s{0,3}>\s?/, ''));
                i += 1;
            }
            push('blockquote', body.join('\n'), { explicitId: explicitIdOf(body[0] || '') || undefined });
            continue;
        }

        // ── 表格：连续 | 行聚合成一个块 ──
        /*
         * 只有当「第二行是分隔行」时才认表格。
         * 只看「行里有没有 |」会把正文也吞进去 ——
         * `参见 [[note:x|标题]] 和 ((blk_1a2b3c4d))` 这种一行里带竖线的句子，
         * 之前就被整段当成表格了。判不出来的落回普通段落，一个字符都不丢。
         */
        if (isTableRow(bare)) {
            const body: string[] = [];
            let j = i;
            while (j < rows.length && isTableRow(rows[j].text) && !rows[j].inFence) {
                body.push(rows[j].text.replace(BLOCK_ID_RE, ''));
                j += 1;
            }
            const sepLine = body[1] || '';
            const isTable = body.length >= 2 && /-/.test(sepLine) && /^\s*\|?[\s:|-]+\|?\s*$/.test(sepLine);
            if (isTable) {
                flushPara();
                push('table', body.join('\n'), { explicitId: explicitIdOf(raw) || undefined });
                i = j;
                continue;
            }
            // 不是表格：不 continue，往下走会落进普通段落分支
        }

        // ── 图片 ──
        if (IMAGE_LINE_RE.test(bare)) {
            flushPara();
            const m = IMAGE_LINE_RE.exec(bare)!;
            push('image', m[1] || m[2] || '', { explicitId: explicitIdOf(raw) || undefined });
            i += 1;
            continue;
        }

        // ── 视频 / 音频 ──
        const media = MEDIA_LINE_RE.exec(bare);
        if (media) {
            flushPara();
            push(media[1].toLowerCase() === 'video' ? 'video' : 'audio', bare, {
                explicitId: explicitIdOf(raw) || undefined,
            });
            i += 1;
            continue;
        }

        // ── 附件 ──
        if (FILE_LINE_RE.test(bare)) {
            flushPara();
            const m = FILE_LINE_RE.exec(bare)!;
            push('fileAttachment', m[2], { explicitId: explicitIdOf(raw) || undefined });
            i += 1;
            continue;
        }

        // ── 普通行：攒段 ──
        para.push(bare);
        if (!paraId) paraId = explicitIdOf(raw);
        i += 1;
    }
    flushPara();
    return blocks;
}

/**
 * 从 md 里提取引用关系。
 * `[[note:id]]` = 引用整篇；`[[note:id#blk:bid]]` / `![[…]]` = 引用块 / 嵌入块；
 * `((blk_xxx))` = 块引用。代码围栏内不认。
 */
export function parseLinks(md: string): ParsedLink[] {
    const out: ParsedLink[] = [];
    const rows = splitFences(String(md ?? ''));
    const text = rows.filter((r) => !r.inFence).map((r) => r.text).join('\n');

    for (const m of text.matchAll(NOTE_REF_RE)) {
        const embed = m[1] === '!';
        const targetNoteId = m[2];
        const targetBlockId = m[3] || '';
        const excerpt = String(m[4] || '').slice(0, 200);
        out.push({
            targetNoteId,
            targetBlockId,
            linkType: embed ? 'embed' : targetBlockId ? 'block' : 'note',
            excerpt,
        });
    }
    for (const m of text.matchAll(BLOCK_REF_RE)) {
        out.push({ targetNoteId: '', targetBlockId: m[1], linkType: 'block', excerpt: '' });
    }
    return out;
}
