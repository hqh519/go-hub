/**
 * v2.8.6：文件名「中间省略」统一口径
 *
 * 全站（文件卡片 / 列表视图 / 收藏夹卡片 / 历史记录 / 公开浏览）统一使用本函数切分，
 * 配合模板里的双 span 方案：
 *   <span class="name-start">{{ parts.start }}</span><span class="name-end">{{ parts.end }}</span>
 * —— start 可收缩并出省略号，end 固定不换行，因此任何宽度下都是「开头…结尾」，
 *    不会出现「只显示开头、后半全没了」的观感。
 *
 * 旧实现（≤24 字符直接返回 end:''）在窄卡片里会退化成纯尾部省略，
 * 与本轮修复目标不一致，故统一改为：不论长短名一律切分，仅按长度决定尾部留几个字符。
 */
const MIN_START = 4;  // 头部至少保留 4 个字符（避免只剩省略号）
const MIN_END = 4;    // 尾部至少保留 4 个字符（覆盖 .png / .jpeg 之类扩展名）
const MAX_END = 12;   // 尾部最多 12 个字符
const NO_SPLIT_LEN = 6; // 极短名字不切分（切了反而更难看）

export function splitFileName(name) {
    const full = String(name == null ? '' : name);
    if (!full) return { start: '', end: '' };
    if (full.length <= NO_SPLIT_LEN) return { start: full, end: '' };
    // 尾部约占四成，夹在 [MIN_END, MAX_END] 之间；头部至少留 MIN_START
    let endLen = Math.round(full.length * 0.4);
    if (endLen < MIN_END) endLen = MIN_END;
    if (endLen > MAX_END) endLen = MAX_END;
    if (full.length - endLen < MIN_START) endLen = full.length - MIN_START;
    if (endLen <= 0) return { start: full, end: '' };
    return { start: full.slice(0, full.length - endLen), end: full.slice(-endLen) };
}

export default splitFileName;
