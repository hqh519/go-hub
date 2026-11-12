import fetchWithAuth from '@/utils/fetchWithAuth';

/**
 * v1.1.6：文件浏览记录上报
 *
 * 需求口径：**只有通过文件灯箱打开浏览的文件**才记录，且记录的时刻是「关闭灯箱的那一刻」。
 * 文件详情页、直接点外链、渠道直链访问都不记录（那些走的是 views 访问计数）。
 *
 * 调用点：
 *   · 图床管理（AdminDashBoard.vue）→ <MediaPreviewOverlay @viewed="...">
 *   · 笔记管理（NotesManagePage.vue）→ 同上
 * 两处都只在「灯箱关闭」事件里调一次，ids 是本次关闭前在灯箱里翻到过的全部文件。
 *
 * 后端：POST /api/manage/browse { ids } → 把命中记录的 lastViewedAt 写成服务器当前时刻。
 * ids 兼容 FileRecord.id 与 File_ID（笔记附件里只带 name），后端用 OR 一起匹配。
 *
 * 失败静默：浏览记录属于「锦上添花」的统计，写不进去也不能打断用户操作，
 * 只在控制台留一行警告（方便排查权限 / 网络问题）。
 */
export default async function recordBrowse(ids) {
    const list = Array.from(new Set((Array.isArray(ids) ? ids : []).map((v) => String(v || '').trim()).filter(Boolean)));
    if (!list.length) return;
    try {
        await fetchWithAuth('/api/manage/browse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: list })
        });
    } catch (err) {
        console.warn('[browse] 浏览记录上报失败：', err && err.message ? err.message : err);
    }
}
