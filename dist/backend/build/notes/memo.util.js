"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOCK_ID_PREFIX = void 0;
exports.splitFences = splitFences;
exports.stripBlockIds = stripBlockIds;
exports.withBlockIds = withBlockIds;
exports.plainTextOf = plainTextOf;
exports.excerptOf = excerptOf;
exports.countMemoChars = countMemoChars;
exports.countMemoWords = countMemoWords;
exports.titleFromContent = titleFromContent;
const crypto_1 = require("crypto");
exports.BLOCK_ID_PREFIX = 'blk_';
const BLOCK_ID_RE = /[ \t]+\^blk_[0-9a-f]{8}[ \t]*$/;
function isFence(line) {
    return /^\s{0,3}(```|~~~)/.test(line);
}
function splitFences(md) {
    const out = [];
    let inFence = false;
    for (const line of String(md ?? '').split('\n')) {
        if (isFence(line)) {
            out.push({ text: line, inFence });
            inFence = !inFence;
            continue;
        }
        out.push({ text: line, inFence });
    }
    return out;
}
function stripBlockIds(md) {
    const lines = splitFences(String(md ?? ''));
    return lines
        .map((row) => (row.inFence ? row.text : row.text.replace(BLOCK_ID_RE, '')))
        .join('\n');
}
function isBlockLine(line) {
    const t = line.trim();
    if (!t)
        return false;
    if (isFence(line))
        return false;
    if (/^([-*_])(\s*\1){2,}$/.test(t))
        return false;
    if (/^\|?[\s:|-]+\|?$/.test(t))
        return false;
    return true;
}
function withBlockIds(md) {
    const lines = splitFences(String(md ?? ''));
    const seen = new Map();
    const out = [];
    const tableRows = new Set();
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].inFence || !looksLikeTableRow(lines[i].text))
            continue;
        let j = i;
        while (j < lines.length && !lines[j].inFence && looksLikeTableRow(lines[j].text))
            j += 1;
        const run = lines.slice(i, j).map((r) => r.text.replace(BLOCK_ID_RE, ''));
        if (run.length >= 2 && isTableSep(run[1])) {
            for (let k = i; k < j; k += 1)
                tableRows.add(k);
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
        if (/^<!--gh-table:/.test(bare.trim())) {
            out.push(bare);
            continue;
        }
        const prev = i > 0 ? lines[i - 1] : null;
        const isBrContinuation = !!prev
            && !prev.inFence
            && /<br\s*\/?>$/.test(prev.text.replace(BLOCK_ID_RE, '').replace(/[ \t]+$/, ''));
        if (isBrContinuation || tableRows.has(i) || !isBlockLine(bare)) {
            out.push(bare);
            continue;
        }
        const key = bare.trim();
        const nth = seen.get(key) ?? 0;
        seen.set(key, nth + 1);
        const hash = (0, crypto_1.createHash)('sha1').update(`${key}#${nth}`).digest('hex').slice(0, 8);
        out.push(`${bare.replace(/[ \t]+$/, '')} ^${exports.BLOCK_ID_PREFIX}${hash}`);
    }
    return out.join('\n');
}
function looksLikeTableRow(line) {
    return line.includes('|') && !isFence(line);
}
function isTableSep(line) {
    return line.includes('-') && /^\s*\|?[\s:|-]+\|?\s*$/.test(line);
}
function plainTextOf(md) {
    const src = stripBlockIds(String(md ?? ''));
    const lines = [];
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
        if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-'))
            continue;
        let t = line
            .replace(/^\s{0,3}#{1,6}\s*/, '')
            .replace(/^\s{0,3}>\s?/, '')
            .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/, '')
            .replace(/^\s*[-*+]\s+/, '')
            .replace(/^\s*\d+[.)]\s+/, '')
            .replace(/^\s*\|/, '')
            .replace(/\|\s*$/, '')
            .replace(/\|/g, ' ');
        t = t
            .replace(/<sup class="gh-ann"[^>]*>[\s\S]*?<\/sup>/gi, ' ')
            .replace(/!\[\[file:([^|\]]+)(?:\|([^\]]*))?\]\](\{[^}]*\})?/g, '$2')
            .replace(/!?\[\[note:[^\]]*\]\]/g, ' ')
            .replace(/\(\(blk_[0-9a-f]{8}\)\)/g, ' ')
            .replace(/!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g, ' ')
            .replace(/\[\]/g, ' ')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
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
        .replace(/\s+([。，、；：！？])/g, '$1')
        .trim();
}
function excerptOf(md, max = 140) {
    const text = plainTextOf(md).replace(/\s+/g, ' ').trim();
    if (!text)
        return '';
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
function countMemoChars(md) {
    const text = stripBlockIds(plainTextOf(md));
    let n = 0;
    for (const ch of text) {
        if (!/\s/.test(ch))
            n += 1;
    }
    return n;
}
function countMemoWords(md) {
    const text = stripBlockIds(plainTextOf(md));
    const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const en = (text.match(/[a-zA-Z]/g) || []).length;
    return cn + en;
}
function titleFromContent(md, max = 40) {
    const text = plainTextOf(md);
    if (!text)
        return '';
    const first = text.split('\n').map((s) => s.trim()).find(Boolean) || '';
    return first.length > max ? `${first.slice(0, max)}…` : first;
}
