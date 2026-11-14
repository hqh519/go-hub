"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDuplicateFile = isDuplicateFile;
exports.dedupCandidateWhere = dedupCandidateWhere;
const norm = (s) => String(s || '').trim().toLowerCase();
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
function isDuplicateFile(probe, rec) {
    const md5 = norm(probe.md5);
    if (!md5 || !num(probe.size))
        return false;
    const actualSize = num(rec.size);
    const actualMd5 = norm(rec.md5);
    const size = num(probe.size);
    const edited = !!rec.editedAt;
    if (!edited) {
        const originSize = num(rec.originalSize) || actualSize;
        const originMd5 = norm(rec.originalMd5) || actualMd5;
        if (originMd5 && size === originSize && md5 === originMd5)
            return true;
    }
    if (actualMd5 && size === actualSize && md5 === actualMd5)
        return true;
    return false;
}
function dedupCandidateWhere(md5) {
    const v = String(md5 || '').trim();
    if (!v)
        return [];
    return [{ md5: v }, { originalMd5: v }];
}
