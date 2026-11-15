"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBlocks = parseBlocks;
exports.parseLinks = parseLinks;
const crypto_1 = require("crypto");
const memo_util_1 = require("./memo.util");
const BLOCK_ID_RE = /[ \t]+\^blk_([0-9a-f]{8})[ \t]*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*)$/;
const TASK_RE = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\s*)\d+[.)]\s+(.*)$/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;
const CALLOUT_OPEN_RE = /^\s*:::\s*callout\s*(?:\{([^}]*)\})?\s*$/i;
const CALLOUT_CLOSE_RE = /^\s*:::\s*$/;
const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(\s*([^)\s]+)/;
const MEDIA_LINE_RE = /^\s*<(video|audio)\b([^>]*)>/i;
const FILE_LINE_RE = /^\s*<a\b([^>]*class="gh-file"[^>]*)>(.*?)<\/a>\s*$/i;
const isTableRow = (line) => /\|/.test(line) && !FENCE_RE.test(line);
const NOTE_REF_RE = /(!?)\[\[note:([A-Za-z0-9_-]+)(?:#blk:(blk_[0-9a-f]{8}))?(?:\|([^\]]*))?\]\]/g;
const BLOCK_REF_RE = /\(\((blk_[0-9a-f]{8})\)\)/g;
function indentLevel(spaces) {
    const n = String(spaces || '').replace(/\t/g, '  ').length;
    return Math.floor(n / 2);
}
function hashOf(text, nth) {
    return (0, crypto_1.createHash)('sha1').update(`${text}#${nth}`).digest('hex').slice(0, 12);
}
function textOf(raw) {
    return String(raw || '')
        .replace(/[ \t]+\^blk_[0-9a-f]{8}[ \t]*$/gm, '')
        .replace(/^\s*:::\s*callout\b[^\n]*$/gm, '')
        .replace(/^\s*:::\s*$/gm, '')
        .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, '')
        .replace(/\|/g, ' ')
        .replace(/^\s{0,3}(```|~~~)[\w+-]*$/gm, '')
        .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+[.)]\s+/gm, '')
        .replace(/^\s{0,3}#{1,6}\s*/gm, '')
        .replace(/^\s{0,3}>\s?/gm, '')
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
function parseBlocks(md) {
    const rows = (0, memo_util_1.splitFences)(String(md ?? ''));
    const blocks = [];
    const seen = new Map();
    let order = 0;
    const listStack = [];
    const calloutStack = [];
    const push = (blockType, rawText, opts = {}) => {
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
    const explicitIdOf = (line) => {
        const m = BLOCK_ID_RE.exec(line);
        return m ? `blk_${m[1]}` : '';
    };
    let i = 0;
    let para = [];
    let paraId = '';
    const flushPara = () => {
        if (!para.length)
            return;
        push('paragraph', para.join('\n'), { explicitId: paraId || undefined });
        para = [];
        paraId = '';
    };
    while (i < rows.length) {
        const { text: line, inFence } = rows[i];
        const bare = line.replace(BLOCK_ID_RE, '');
        const raw = line;
        if (inFence || FENCE_RE.test(bare)) {
            flushPara();
            const body = [line];
            i += 1;
            while (i < rows.length && (rows[i].inFence || FENCE_RE.test(rows[i].text))) {
                body.push(rows[i].text);
                i += 1;
                if (FENCE_RE.test(rows[i - 1].text) && body.length > 1)
                    break;
            }
            push('codeBlock', body.join('\n'));
            continue;
        }
        if (!bare.trim()) {
            flushPara();
            i += 1;
            continue;
        }
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
        const h = HEADING_RE.exec(bare);
        if (h) {
            flushPara();
            push('heading', h[2], { explicitId: explicitIdOf(raw) || undefined, headingLevel: h[1].length });
            listStack.length = 0;
            i += 1;
            continue;
        }
        const task = TASK_RE.exec(bare);
        const bullet = task ? null : BULLET_RE.exec(bare);
        const ordered = task || bullet ? null : ORDERED_RE.exec(bare);
        if (task || bullet || ordered) {
            flushPara();
            const spaces = (task || bullet || ordered)[1];
            const indent = indentLevel(spaces);
            while (listStack.length && listStack[listStack.length - 1].indent >= indent)
                listStack.pop();
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
        if (/^\s{0,3}>\s?/.test(bare)) {
            flushPara();
            const body = [];
            while (i < rows.length && /^\s{0,3}>\s?/.test(rows[i].text) && !rows[i].inFence) {
                body.push(rows[i].text.replace(/^\s{0,3}>\s?/, ''));
                i += 1;
            }
            push('blockquote', body.join('\n'), { explicitId: explicitIdOf(body[0] || '') || undefined });
            continue;
        }
        if (isTableRow(bare)) {
            const body = [];
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
        }
        if (IMAGE_LINE_RE.test(bare)) {
            flushPara();
            const m = IMAGE_LINE_RE.exec(bare);
            push('image', m[1] || m[2] || '', { explicitId: explicitIdOf(raw) || undefined });
            i += 1;
            continue;
        }
        const media = MEDIA_LINE_RE.exec(bare);
        if (media) {
            flushPara();
            push(media[1].toLowerCase() === 'video' ? 'video' : 'audio', bare, {
                explicitId: explicitIdOf(raw) || undefined,
            });
            i += 1;
            continue;
        }
        if (FILE_LINE_RE.test(bare)) {
            flushPara();
            const m = FILE_LINE_RE.exec(bare);
            push('fileAttachment', m[2], { explicitId: explicitIdOf(raw) || undefined });
            i += 1;
            continue;
        }
        para.push(bare);
        if (!paraId)
            paraId = explicitIdOf(raw);
        i += 1;
    }
    flushPara();
    return blocks;
}
function parseLinks(md) {
    const out = [];
    const rows = (0, memo_util_1.splitFences)(String(md ?? ''));
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
