import fetchWithAuth from '@/utils/fetchWithAuth';

/**
 * 存储渠道下拉选项的【统一数据源】。
 *
 * 背景：Token 编辑、用户管理编辑用户、上传页「上传设置」三处都需要
 * 「选一个存储渠道 / 备份渠道」，此前各自拉取渠道列表、各自拼 <el-option>，
 * 结果三处的哨兵值（空值 / none）语义与排序都不一致，用户很容易选错。
 *
 * 现在统一：
 *   1) fetchStorageChannels()  —— 拉取渠道列表（会话内缓存，避免每个组件各请求一次）
 *   2) buildChannelOptions()   —— 按类型生成下拉选项（默认项 / none / 具体渠道）
 *   3) <ChannelSelect>         —— 直接用上面两项的通用下拉组件
 *
 * 约定（与后端 StorageChannelService 完全一致）：
 *   - 选项**值一律是渠道 ID**（6 位 code），渠道名只是给人看的标识；
 *   - `''`     = 「默认」—— 值为空，跟随全局设置（由 getStorageChannel 解析）
 *   - `'none'` = 明确「不备份」，仅备份渠道下拉有此项
 */

/** 渠道列表缓存（同一会话内只拉一次；force=true 强制刷新） */
let channelCache = null;
let channelCacheAt = 0;
let inflight = null;
/**
 * 缓存有效期（v2.8.6）。
 *
 * 之前的实现是「整个会话只拉一次」，于是在后台把某个渠道的启用开关关掉、
 * 再回到上传页打开「上传设置」时，下拉里仍然保留着那个已停用的渠道
 * （SPA 内跳转不会重新挂载模块，缓存一直活着）。
 * 现在改为短 TTL：超过 TTL 自动重拉；后台增删改渠道时还会主动
 * `invalidateStorageChannels()`，两条路一起保证「下拉里永远没有停用渠道」。
 */
const CHANNEL_CACHE_TTL = 15 * 1000;

/**
 * 渠道类型编号 —— 与后端 `CHANNEL_TYPE_CODE` 完全一致（排序用，与渠道 code 无关）：
 *   easyimages 100 / lsky 110 / immich 120 / minio 130 / r2 140 / s3 150
 *   cos 160 / aliyun(ali) 170 / webdav 180 / custom 190 / local 999
 */
export const CHANNEL_TYPE_CODE = {
    easyimages: 100,
    lsky: 110,
    immich: 120,
    minio: 130,
    r2: 140,
    s3: 150,
    cos: 160,
    aliyun: 170,
    webdav: 180,
    custom: 190,
    local: 999,
    // v3.0.0：本地文件（只读浏览）—— 排在所有本地存储之后
    localfiles: 1000,
};

/** 取渠道类型编号（未知类型排最后） */
export function channelTypeCode(type) {
    return CHANNEL_TYPE_CODE[type] ?? 998;
}

/**
 * 拉取渠道列表并归一化为 `[{ id, code, name, type, typeCode }]`。
 *
 * 数据源用**公开接口** `/api/channels`（返回按类型分组）：
 * 它对管理员返回全部渠道，对普通用户只返回「被授权的渠道」（v2.7.0 起本地存储同规则），
 * 因此上传设置里的渠道下拉天然只列出用户有权使用的渠道（v202610221824）。
 * （旧实现打的是 `/api/manage/channels`，普通用户会 403，下拉永远是空的。）
 *
 * 拉取失败时返回空数组（不抛错，避免阻塞设置页渲染）。
 */
export async function fetchStorageChannels(force = false) {
    const fresh = channelCache && Date.now() - channelCacheAt < CHANNEL_CACHE_TTL;
    if (fresh && !force) return channelCache;
    if (inflight && !force) return inflight;
    inflight = fetchWithAuth('/api/channels')
        .then((resp) => (resp && resp.ok ? resp.json() : null))
        .then((grouped) => {
            const list = [];
            for (const [type, arr] of Object.entries(grouped || {})) {
                for (const c of (arr || [])) {
                    // 值统一用 code（渠道 ID）；个别历史数据没有 code 时回退主键
                    const value = c.code || c.id || '';
                    if (!value) continue;
                    /*
                     * v2.8.6：停用渠道一律不出现在下拉里。
                     * 后端 /api/channels 已经按 enabled=true 过滤，这里再兜一层 ——
                     * 任何来源（旧缓存 / 反向代理缓存 / 未来新增的接口）带来的停用渠道
                     * 都不会被渲染成可选项。
                     */
                    if (c.enabled === false) continue;
                    /*
                     * v3.0.0：本地文件渠道（localfiles）只用于「本地文件」页浏览，
                     * 不参与上传 —— 所有上传渠道下拉（上传设置 / 备份渠道 / Token）都要排除它。
                     */
                    if ((c.type || type) === 'localfiles') continue;
                    list.push({
                        id: value,
                        code: c.code || value,
                        name: c.name || '',
                        type: c.type || type,
                        // 渠道类型编号（后端下发；缺失时按类型名兜底）
                        typeCode: Number(c.typeCode) || (CHANNEL_TYPE_CODE[c.type || type] || 998),
                        /*
                         * v1.0.5：主 / 备标记随列表一起下发 ——
                         * 上传「目标渠道」下拉要排除备份渠道（备份渠道只做本份镜像，
                         * 后端也会拒绝把它当转存 / 上传目标）。
                         */
                        isMain: c.isMain === true,
                        isBackup: c.isBackup === true,
                        backupPool: c.backupPool === true,
                    });
                }
            }
            channelCache = list;
            channelCacheAt = Date.now();
            return list;
        })
        .catch(() => [])
        .finally(() => {
            inflight = null;
        });
    return inflight;
}

/** 清空渠道缓存（渠道列表发生增删改后调用 —— 后台改完立即生效，不用刷新页面） */
export function invalidateStorageChannels() {
    channelCache = null;
    channelCacheAt = 0;
}

/** 渠道展示名：`渠道ID · 渠道名（类型）` */
export function channelLabel(ch) {
    const id = ch.code || ch.id || '';
    const name = ch.name || '';
    const type = ch.type || '';
    const head = id ? `${id} · ${name}` : name;
    return type ? `${head}（${type}）` : head;
}

/**
 * 生成渠道下拉选项。
 *
 * @param {Array} channels  渠道列表（fetchStorageChannels 的返回值）
 * @param {Object} opts
 *   - kind: 'main' | 'backup'
 *       main   → 顶部「默认」，随后是各存储渠道
 *       backup → 顶部「默认」，随后是「none（不备份）」，再是各存储渠道
 *   - defaultLabel / noneLabel: 自定义文案（默认取 i18n）
 *   - t: i18n 函数（$t），组件里传入
 * @returns {Array<{value:string,label:string,type:string,icon:string}>}
 */
export function buildChannelOptions(channels, opts = {}) {
    const { kind = 'main', t = null } = opts;
    const tr = (key, fallback) => (typeof t === 'function' ? t(key) : fallback);
    const list = Array.isArray(channels) ? channels : [];

    const out = [];
    // 1) 「默认」——值为空串，表示跟随全局设置（后端 getStorageChannel 解析）
    out.push({
        value: '',
        label: opts.defaultLabel || tr('channelSelect.defaultOption', '默认（跟随全局设置）'),
        type: '',
        icon: 'cog',
    });
    // 2) 备份渠道额外提供「none」——明确拒绝备份
    if (kind === 'backup') {
        out.push({
            value: 'none',
            label: opts.noneLabel || tr('sysSecurity.defaultBackupNone', 'none（不备份）'),
            type: '',
            icon: 'ban',
        });
    }
    // 3) 具体渠道（统一排序：类型编号升序 → name a→z，保证三处顺序一致）
    const sorted = [...list].sort((a, b) => {
        const ta = Number(a.typeCode) || channelTypeCode(a.type);
        const tb = Number(b.typeCode) || channelTypeCode(b.type);
        if (ta !== tb) return ta - tb;
        return String(a.name).localeCompare(String(b.name));
    });
    for (const ch of sorted) {
        out.push({ value: ch.code || ch.id, label: channelLabel(ch), type: ch.type || '', icon: '' });
    }
    return out;
}

/** 把渠道 ID 解析成展示串（用于「当前默认渠道」徽标） */
export function resolveChannelLabel(ch) {
    if (!ch) return '';
    const name = ch.name || '';
    return ch.code ? `${ch.code} · ${name}` : name;
}
