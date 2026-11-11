/**
 * 上传目标（渠道 / 实例 / 目录）与上传动作的通用封装（v1.1.2）
 * ----------------------------------------------------------------------------
 * 需求原文：「上传到图床的目标渠道、归属实例、上传目录选择页最好做成一个通用函数，
 * 然后在本地文件上传、灯箱上传、瞬间附件上传，以及其他所有需要上传的都直接调用这个函数」。
 *
 * 拆成两层：
 *   1) 选择页本身 = components/upload/UploadTargetDialog.vue（同一个组件，各处共用）；
 *   2) 这一层负责「默认值 + 真正发请求」：
 *        · defaultUploadFolder(kind)  → /notes/瞬间/2026/11（按传入模板生成，打开弹窗时自动填）
 *        · uploadOne(file, target)    → POST /upload（带渠道 / 实例 / 目录 / 来源）
 *        · importUrlToBed(url, target)→ 链接提取：先让服务端拉取（/api/fetchRes），
 *          拿到字节流或服务端暂存 id 后再走 /upload 落库，最终返回与 uploadOne 相同的结构
 *
 * 为什么默认目录按「年 / 月」分：同一个月的内容聚在一个目录里，后台按目录翻找时最直观，
 * 也不会像按日分那样把目录树拉得很长。
 */

/**
 * 各板块的默认目录前缀（以后文章/待办要用时，在这里加一行即可）。
 * v1.1.4：统一收进 `/notes` 之下 —— 笔记类内容与图床其它文件分开存放，
 * 目录形如 `/notes/瞬间/2026/11`。
 */
const FOLDER_PREFIX = {
    moment: '/notes/瞬间',
    article: '/notes/文章',
    todo: '/notes/待办',
    nav: '/notes/导航',
    collection: '/notes/收集'
};

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 生成默认上传目录：`/notes/瞬间/2026/11`。
 * @param {string} kindP reset 板块标识（moment / article …），未知板块回退到 /瞬间
 * @param {Date} [now] 便于测试注入时间
 */
export function defaultUploadFolder(kind = 'moment', now = new Date()) {
    const prefix = FOLDER_PREFIX[kind] || FOLDER_PREFIX.moment;
    return `${prefix}/${now.getFullYear()}/${pad2(now.getMonth() + 1)}`;
}

/**
 * 打开上传目标弹窗时用的回填值。
 * 每次都按「当前时间」重新算 —— 跨月后不会还填着上个月的目录。
 */
export function defaultUploadPrefill(kind = 'moment', extra = {}) {
    return { channelId: '', instanceId: '', uploadFolder: defaultUploadFolder(kind), ...extra };
}

function buildUploadQuery(target = {}, extra = {}) {
    const qs = new URLSearchParams();
    if (target.channelId) qs.set('channelId', target.channelId);
    if (target.instanceId) qs.set('instanceId', target.instanceId);
    if (target.uploadFolder) qs.set('uploadFolder', target.uploadFolder);
    // 来源用于文件详情「上传方式」：附件上传 = Attachment
    if (extra.source) qs.set('uploadSource', extra.source);
    for (const [k, v] of Object.entries(extra)) {
        if (k === 'source' || v === undefined || v === null || v === '') continue;
        qs.set(k, String(v));
    }
    return qs.toString();
}

/**
 * 上传单个文件。
 * @returns {Promise<{ id: string, src: string, name: string, channelId?: string }>}
 *   注意 `id` 是 **File_ID**（/file/<name> 的标识），不是 files.id；
 *   后端创建笔记时会两种都识别（见 notes.service.resolveAssetFiles）。
 */
export async function uploadOne(file, target = {}, extra = {}) {
    const qs = buildUploadQuery(target, extra);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/upload${qs ? `?${qs}` : ''}`, {
        method: 'POST',
        body: fd,
        credentials: 'include'
    });
    const arr = await res.json().catch(() => null);
    const hit = Array.isArray(arr) ? arr[0] : null;
    if (!res.ok || !hit || !hit.id) {
        const msg = (hit && hit.message) || '上传失败';
        throw new Error(msg);
    }
    return hit;
}

/** 提交「服务端暂存」的文件（链接提取的大文件走这条，浏览器不再传一遍字节） */
export async function uploadStaged(stagingId, originalFileName, target = {}, extra = {}) {
    const qs = buildUploadQuery(target, { ...extra, stagingId: undefined });
    const fd = new FormData();
    fd.append('stagingId', stagingId);
    if (originalFileName) fd.append('originalFileName', originalFileName);
    const res = await fetch(`/upload${qs ? `?${qs}` : ''}`, {
        method: 'POST',
        body: fd,
        credentials: 'include'
    });
    const arr = await res.json().catch(() => null);
    const hit = Array.isArray(arr) ? arr[0] : null;
    if (!res.ok || !hit || !hit.id) throw new Error((hit && hit.message) || '转存失败');
    return hit;
}

/**
 * 链接提取（把远端地址的文件转存进图床）。
 *
 * 与首页「链接」模式同一套服务端能力（/api/fetchRes）：
 *   · 小文件 → 直接回字节流，这里包成 File 再走 /upload；
 *   · 大文件 / 音视频 → 服务端落到暂存目录，回 { staged, stagingId }，这里只提交 stagingId。
 */
export async function importUrlToBed(url, target = {}, extra = {}) {
    const raw = String(url || '').trim();
    if (!raw) throw new Error('请填写链接地址');
    let res;
    try {
        res = await fetch(`/api/fetchRes?instanceId=${encodeURIComponent(target.instanceId || '')}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: raw }),
            credentials: 'include'
        });
    } catch (e) {
        throw new Error('链接请求失败，请检查地址或稍后再试');
    }
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `拉取失败（HTTP ${res.status}）`);
    }
    const contentType = String(res.headers.get('content-type') || '');
    if (contentType.includes('application/json')) {
        const payload = await res.json().catch(() => null);
        if (!payload || !payload.staged || !payload.stagingId) {
            throw new Error((payload && payload.message) || '转存失败');
        }
        return uploadStaged(payload.stagingId, payload.name || '', target, extra);
    }
    const blob = await res.blob();
    // 文件名：优先读 Content-Disposition，其次用 URL 末段
    let name = '';
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    if (m) name = decodeURIComponent(m[1]);
    if (!name) {
        try {
            name = decodeURIComponent(new URL(raw).pathname.split('/').pop() || '');
        } catch (e) {
            name = '';
        }
    }
    if (!name) name = `link-${Date.now()}`;
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    return uploadOne(file, target, extra);
}
