"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TAB_CONTENT = exports.MAX_ARTICLE_NOTE = exports.MAX_ARTICLE_EXCERPT = exports.MAX_ARTICLE_TITLE = exports.MAX_TAB_TITLE = exports.MAX_ARTICLE_TABS = exports.ARTICLE_TYPES = void 0;
exports.normalizeArticleType = normalizeArticleType;
exports.normalizeArticleStatus = normalizeArticleStatus;
exports.countTodoTasks = countTodoTasks;
exports.excerptOfArticle = excerptOfArticle;
exports.todoNamesOfArticle = todoNamesOfArticle;
exports.countArticleWords = countArticleWords;
const memo_util_1 = require("../notes/memo.util");
exports.ARTICLE_TYPES = ['article', 'todo', 'nav'];
exports.MAX_ARTICLE_TABS = 30;
exports.MAX_TAB_TITLE = 40;
exports.MAX_ARTICLE_TITLE = 200;
exports.MAX_ARTICLE_EXCERPT = 500;
exports.MAX_ARTICLE_NOTE = 2000;
exports.MAX_TAB_CONTENT = 500_000;
function normalizeArticleType(raw) {
    const t = String(raw ?? '').trim();
    return exports.ARTICLE_TYPES.includes(t) ? t : 'article';
}
function normalizeArticleStatus(raw) {
    const s = String(raw ?? '').trim();
    if (s === 'published' || s === 'deleted')
        return s;
    return 'draft';
}
function countTodoTasks(md) {
    const text = (0, memo_util_1.stripBlockIds)(md) || '';
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
            }
            else if (mark === fenceMark) {
                inFence = false;
                fenceMark = '';
            }
            continue;
        }
        if (inFence)
            continue;
        const m = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s*/.exec(line);
        if (!m)
            continue;
        if (!line.slice(m[0].length).trim())
            continue;
        total += 1;
        if (m[1] === 'x' || m[1] === 'X')
            done += 1;
    }
    return { total, done };
}
function dropNonText(md) {
    const src = (0, memo_util_1.stripBlockIds)(String(md ?? ''));
    const kept = [];
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
            }
            else if (mark === fenceMark) {
                inFence = false;
                fenceMark = '';
            }
            continue;
        }
        if (inFence)
            continue;
        kept.push(line.replace(/!?\[\[file:[^\]]*\]\](\{[^}]*\})?/g, ' '));
    }
    return kept.join('\n');
}
function excerptOfArticle(md, max = 140) {
    const text = (0, memo_util_1.plainTextOf)(dropNonText(md)).replace(/\s+/g, ' ').trim();
    if (!text)
        return '';
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
function todoNamesOfArticle(md, max = 140) {
    const text = (0, memo_util_1.stripBlockIds)(String(md ?? '')) || '';
    const names = [];
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
            }
            else if (mark === fenceMark) {
                inFence = false;
                fenceMark = '';
            }
            continue;
        }
        if (inFence)
            continue;
        if (!/^\s*(?:[-*+]|\d+[.)])\s+\[(?:[ xX])\]\s*\S/.test(line))
            continue;
        const name = (0, memo_util_1.plainTextOf)(line).replace(/\s+/g, ' ').trim();
        if (name)
            names.push(name);
    }
    if (!names.length)
        return '';
    const joined = names.join(' · ');
    return joined.length > max ? `${joined.slice(0, max)}…` : joined;
}
function countArticleWords(md) {
    return (0, memo_util_1.countMemoWords)(md);
}
