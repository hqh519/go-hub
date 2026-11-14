/**
 * 「选择文件」面板的本地记忆（v1.1.7）
 * ----------------------------------------------------------------------------
 * 需求原文三件事，本质是同一份本地记忆：
 *   ① 记住上次打开的数据源 / 文件类型 / 挂载渠道与目录（下次进来直接落在那儿）；
 *   ② 记住上次的取数结果，下次进入先拿缓存铺一屏、再在后台刷新，
 *      不要每次都白屏等一次网络往返；
 *   ③ 缓存要按实例隔离 —— 不同实例的文件列表完全不同，串了就是错数据。
 *
 * 为什么用 localStorage 而不是服务端：这纯粹是「这台设备的浏览手感」，
 * 换设备重新预热一次完全没有代价，放服务端反而多一次请求、还得多维护一张表。
 *
 * 容量口径：图床列表每个类型最多留 60 条、挂载目录最多留 200 条，
 * 整个键超过 500KB 就不写（只丢缓存，不影响功能）。
 */

const STORE_KEY = (instanceId) => `gohub:note-pick:${instanceId || 'default'}`;

/** 缓存最长可用 1 天：再久的东西基本必然是过期的，直接当没有 */
const MAX_AGE = 24 * 60 * 60 * 1000;

/**
 * 记忆结构版本（v1.2.2）
 * ----------------------------------------------------------------------------
 * 为什么要加：v1.2.1 把「首次进入的默认分类」从「图片」改成「全部」，
 * 但老浏览器的 localStorage 里存着 v1.1.x 时期写下的 `type: 'image'` ——
 * 那个值不是用户主动选的，是旧版默认值被 rememberPosition 顺手存下来的。
 * 结果就是升级后仍旧默认停在「图片」，看起来像"改了没生效"。
 *
 * 处理：没有版本号（或版本更低）的旧记忆，只丢弃 `type` 这一项，其余
 * （数据源 / 排序 / 挂载目录）照旧保留 —— 那些确实是用户的操作结果。
 */
const MEMORY_VERSION = 2;

const BED_MAX_ITEMS = 60;
const MOUNT_MAX_ITEMS = 200;
const MAX_BYTES = 500 * 1024;

function readAll(instanceId) {
    try {
        const raw = window.localStorage.getItem(STORE_KEY(instanceId));
        if (!raw) return null;
        const o = JSON.parse(raw);
        return o && typeof o === 'object' ? o : null;
    } catch {
        return null;
    }
}

function writeAll(instanceId, next) {
    try {
        const raw = JSON.stringify(next);
        // 中文文件名多，长度按字节粗估即可；超了就不写，宁可少一层缓存也不要把 localStorage 撑爆
        if (raw.length > MAX_BYTES) return;
        window.localStorage.setItem(STORE_KEY(instanceId), raw);
    } catch {
        /* 隐私模式 / 配额满：记不住就算了 */
    }
}

/** 读「上次停在哪里」：{ source, type, mountChannelId, mountDir, sortField, sortOrder } */
export function readPickMemory(instanceId) {
    const o = readAll(instanceId);
    const m = (o && o.memory) || {};
    // v1.2.2：旧版记忆里的 type 是「旧默认值」不是「用户选择」，一律作废重来
    const staleType = (Number(m.v) || 0) < MEMORY_VERSION;
    return {
        source: m.source === 'mount' ? 'mount' : 'bed',
        // v1.1.8：新增「全部」分类，白名单里也要带上，否则记住的 all 会被改回 image
        // v1.2.1（需求）：首次进入的默认分类由「图片」改为「全部」；有记忆时照记忆来
        // v1.2.2：记忆结构升级前的 type 不可信，直接按「全部」处理
        type: !staleType && ['all', 'image', 'video', 'audio', 'other'].includes(m.type) ? m.type : 'all',
        mountChannelId: String(m.mountChannelId || ''),
        mountDir: String(m.mountDir || ''),
        // v1.2.1（需求）：选文件器加了排序，一并记住
        sortField: ['time', 'size', 'name', 'type'].includes(m.sortField) ? m.sortField : 'time',
        sortOrder: m.sortOrder === 'asc' ? 'asc' : 'desc'
    };
}

/** 记「上次停在哪里」（合并式：只传变的字段） */
export function savePickMemory(instanceId, patch) {
    const o = readAll(instanceId) || {};
    o.memory = { ...readPickMemory(instanceId), ...(patch || {}), v: MEMORY_VERSION };
    writeAll(instanceId, o);
}

function fresh(entry) {
    return entry && Array.isArray(entry.list) && Date.now() - Number(entry.at || 0) < MAX_AGE;
}

/** 图床模式的列表缓存（按类型分开，切换类型不会互相覆盖） */
export function readBedCache(instanceId, type) {
    const o = readAll(instanceId);
    const entry = o && o.bed ? o.bed[type] : null;
    return fresh(entry) ? { list: entry.list, total: Number(entry.total) || entry.list.length } : null;
}

export function writeBedCache(instanceId, type, list, total) {
    const o = readAll(instanceId) || {};
    o.bed = o.bed && typeof o.bed === 'object' ? o.bed : {};
    o.bed[type] = {
        list: (list || []).slice(0, BED_MAX_ITEMS),
        total: Number(total) || 0,
        at: Date.now()
    };
    writeAll(instanceId, o);
}

/** 挂载模式的列表缓存（键 = 渠道 + 目录，切目录就是一格新缓存） */
function mountKey(channelId, dir) {
    return `${channelId || ''}|${dir || ''}`;
}

export function readMountCache(instanceId, channelId, dir) {
    const o = readAll(instanceId);
    const entry = o && o.mount ? o.mount[mountKey(channelId, dir)] : null;
    if (!entry || Date.now() - Number(entry.at || 0) >= MAX_AGE) return null;
    return {
        files: Array.isArray(entry.files) ? entry.files : [],
        dirs: Array.isArray(entry.dirs) ? entry.dirs : []
    };
}

export function writeMountCache(instanceId, channelId, dir, files, dirs) {
    const o = readAll(instanceId) || {};
    o.mount = o.mount && typeof o.mount === 'object' ? o.mount : {};
    // 只留最近 6 个目录：再多对「下次进来更快」没有帮助，只会把 localStorage 撑大
    const key = mountKey(channelId, dir);
    delete o.mount[key];
    o.mount[key] = {
        files: (files || []).slice(0, MOUNT_MAX_ITEMS),
        dirs: dirs || [],
        at: Date.now()
    };
    const keys = Object.keys(o.mount);
    while (keys.length > 6) delete o.mount[keys.shift()];
    writeAll(instanceId, o);
}
