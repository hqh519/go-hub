/**
 * 笔记设置（v1.1.2.1 起，v1.1.2.2 扩充，v1.1.2.3 调默认值）
 * ----------------------------------------------------------------------------
 * 【按实例】存在服务端：`settings` 表 key = `note-settings:<实例 id>`。
 * 同一个实例里的人看到同一套附件区布局，换到另一个实例就是另一套 ——
 * 与文件 / 标签 / 笔记的实例隔离口径完全一致。
 *
 * v1.1.2.2 在「瞬间设置」里新增两项：
 *   · layoutStyle：边框样式（带边框卡片）/ 分割线样式（去边框 + 条目间分割线）
 *   · attachRows ：附件最多加载几行（1 / 2 / 3，每行 3 个）
 *
 * v1.1.2.3 把出厂默认与「恢复默认」统一成：
 *   指定比例 / 35% / 左对齐 / 分割线样式 / 加载两行（最多 6 个），
 * 并把附件高度口径换成需求原文那张表（单图 80%、一行 2/3 个 70%/60%、
 * 两行 80%、三行 100%，按**实际显示个数**取系数）。
 *
 * 为什么用模块级 reactive 而不是 props 逐层传：
 *   · 使用方是 MomentGrid —— 它挂在每一张卡片上，一页可能有 20 个实例，
 *     从页面 → 列表 → 卡片 → 网格传四层 props 没有意义；
 *   · 设置在页面停留期间可能被用户改（设置弹窗开着、后面列表要跟着变），
 *     reactive 对象能直接触发所有网格重算，不需要刷新列表。
 *
 * 再加一份 Cookie 缓存：
 *   · 服务端是异步的 —— 页面加载时列表先渲染、设置后到，会用「默认布局」先画一遍
 *     再跳成用户设定的尺寸（肉眼可见的抖动）；
 *   · Cookie 是同步可读的，`created()` 里调一次 applyCachedSettings(instanceId)
 *     就能在首次渲染前把尺寸摆好，一次计算都不用等；
 *   · 顺带把设置页的「示例换算」结果也存进去（p = [三行, 两行, 一行的像素高]），
 *     比例和视口高度都没变时直接显示，不必重算。
 *   · 服务端仍然是唯一事实来源：Cookie 只负责「首屏不闪」，请求回来后照样覆盖。
 *
 * 关于「页面高度」的口径：用 `window.innerHeight`（可视区高度）。
 * 需求里「附件总高度占页面高度的 35%」说的就是「一眼看到的页面」，不是某个容器的高度。
 */
import { reactive, ref } from 'vue';
import fetchWithAuth from './fetchWithAuth';

/**
 * 瞬间设置的出厂默认值（v1.1.2.3）：
 * 指定比例 / 35% / 左对齐 / 分割线样式 / 加载两行。
 * 「恢复默认」按钮也回到这一组 —— 两处永远同一份，不做两份默认值。
 */
export const DEFAULT_MOMENT_SETTINGS = {
    attachSize: 'custom', // custom（指定比例）| default（自动比例）
    attachRatio: 35, // 百分比，5 ~ 80
    attachAlign: 'left', // left | center
    layoutStyle: 'divider', // divider（分割线样式）| default（边框样式）
    attachRows: 2 // 1 | 2 | 3 —— 附件最多加载几行
};

export const ATTACH_RATIO_MIN = 5;
export const ATTACH_RATIO_MAX = 80;

/** 附件最多加载几行（每行 3 个）—— 与后端 MOMENT_ATTACH_ROWS 一致 */
export const ATTACH_ROWS_OPTIONS = [1, 2, 3];

/**
 * 显示个数 → 折算系数（与后端 `attachHeightFactorOf` 完全一致，改一处必须改两处）：
 *   一行 1 个       = 设定比例 x 80%
 *   一行 2 个       = 设定比例 x 70%
 *   一行 3 个       = 设定比例 x 60%
 *   两行 4 ~ 6 个   = 设定比例 x 80%
 *   三行 7 个及以上 = 设定比例 x 100%
 *
 * 口径是「实际显示个数」：设置里限定了最多加载几行，被截断的不占高度。
 */
export function attachHeightFactor(count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n <= 1) return 0.8;
    if (n === 2) return 0.7;
    if (n === 3) return 0.6;
    if (n <= 6) return 0.8;
    return 1;
}

/**
 * v1.1.2.3：单个附件的折算系数（80%）。
 * 单附件按**原图宽高比**加载，总高度 = 页面高度 x 设定比例 x 80%。
 * 与后端 `MOMENT_ATTACH_SINGLE_FACTOR` 保持一致。
 */
export const ATTACH_SINGLE_FACTOR = 0.8;

/** 「自动比例」布局下单个附件的宽度占卡片宽度的比例（沿用既有观感，v1.1.2.3 未改） */
export const SINGLE_DEFAULT_WIDTH = 0.62;

/**
 * 「自动比例」布局下单图的高度上限（占视口高度）。
 * 自动比例没有「用户设定占比」可依，只能给一个观感上的封顶 ——
 * 否则一张 9:16 的竖图按 62% 宽度铺开会有 800px 高，直接顶满一屏。
 */
export const SINGLE_DEFAULT_MAX_RATIO = 0.45;

/** 附件格间距（与 MomentGrid 的 `.mg { gap }` 一致，算总高度时要把间距扣掉） */
export const ATTACH_GAP = 3;

/** 全局设置对象：模板里直接读 `noteSettings.moment.attachRatio` */
export const noteSettings = reactive({
    moment: { ...DEFAULT_MOMENT_SETTINGS }
});

/** 当前设置属于哪个实例（切换实例时用它对账，避免把 A 的尺寸用到 B 上） */
export const noteSettingsInstanceId = ref('');

/** 是否已经从服务端拿到过设置（没拿到之前一切按默认值 / Cookie 渲染） */
export const noteSettingsReady = ref(false);

/**
 * 把任意脏数据收敛成合法的瞬间设置（与后端 normalizeMomentSettings 等价）。
 * v1.1.2.3：只在**键缺失或非法**时落新的出厂默认 —— 用户明确存过的值
 * （哪怕是旧默认 default / center / default / 3）原样保留，升级不会顶掉人家改过的设置。
 */
export function normalizeMomentSettings(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const size = o.attachSize === 'default' ? 'default' : 'custom';
    const align = o.attachAlign === 'center' ? 'center' : 'left';
    let ratio = Number(o.attachRatio);
    if (!Number.isFinite(ratio) || ratio <= 0) ratio = DEFAULT_MOMENT_SETTINGS.attachRatio;
    ratio = Math.min(ATTACH_RATIO_MAX, Math.max(ATTACH_RATIO_MIN, Math.round(ratio * 10) / 10));
    const layoutStyle = o.layoutStyle === 'default' ? 'default' : 'divider';
    const rowsNum = Math.round(Number(o.attachRows));
    const attachRows = ATTACH_ROWS_OPTIONS.includes(rowsNum) ? rowsNum : 2;
    return { attachSize: size, attachRatio: ratio, attachAlign: align, layoutStyle, attachRows };
}

/* ── Cookie 缓存 ────────────────────────────────────────────────────────── */

const SETTINGS_COOKIE_KEY = 'gohub_note_settings';
const SETTINGS_COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // 半年
/** Cookie 总长要留在 4KB 以内，这里留足余量；超了就不写（只是丢缓存，不影响功能） */
const COOKIE_MAX_LENGTH = 3000;
/** 最多缓存几个实例的设置（实例多到几十个时不要把 Cookie 撑爆） */
const COOKIE_MAX_INSTANCES = 8;

/** 默认实例（空 id）在 Cookie 里用 ~default 表示，避免出现空对象键 */
function instanceKeyOf(instanceId) {
    const id = String(instanceId || '').trim();
    return id || '~default';
}

function readCookie() {
    if (typeof document === 'undefined') return null;
    const hit = document.cookie
        .split(';')
        .map((item) => item.trim())
        .find((item) => item.startsWith(SETTINGS_COOKIE_KEY + '='));
    if (!hit) return null;
    const raw = hit.slice(SETTINGS_COOKIE_KEY.length + 1);
    if (!raw) return null;
    try {
        const o = JSON.parse(decodeURIComponent(raw));
        return o && typeof o === 'object' ? o : null;
    } catch {
        return null; // 手工改坏 / 版本不兼容：当作没有缓存
    }
}

function writeCookie(patch) {
    if (typeof document === 'undefined') return;
    const next = { ...(readCookie() || {}), ...patch };
    let encoded = '';
    try {
        encoded = encodeURIComponent(JSON.stringify(next));
    } catch {
        return;
    }
    if (encoded.length > COOKIE_MAX_LENGTH) return;
    document.cookie = `${SETTINGS_COOKIE_KEY}=${encoded}; path=/; max-age=${SETTINGS_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** 把某个实例的设置写进 Cookie（多实例共用一份 Cookie，按 d[实例] 分组） */
function cacheSettings(instanceId, momentSettings) {
    const c = readCookie() || {};
    const map = c.d && typeof c.d === 'object' ? { ...c.d } : {};
    const key = instanceKeyOf(instanceId);
    // 先删后插：让「最近用过的实例」排在最后，裁剪时优先丢最久没用的
    delete map[key];
    map[key] = { ...momentSettings };
    const keys = Object.keys(map);
    while (keys.length > COOKIE_MAX_INSTANCES) {
        delete map[keys.shift()];
    }
    writeCookie({ d: map });
}

/**
 * 同步贴上某个实例的缓存设置。
 * 在 `created()` 里调用 —— 此时还没渲染，所以首屏的附件区就是最终尺寸，不会闪一下再变。
 * 没有缓存时用默认值（不残留上一个实例的设置）。
 */
export function applyCachedSettings(instanceId) {
    const c = readCookie();
    const cached = c && c.d ? c.d[instanceKeyOf(instanceId)] : null;
    noteSettingsInstanceId.value = String(instanceId || '');
    noteSettings.moment = normalizeMomentSettings(cached || {});
    noteSettingsReady.value = Boolean(cached);
    return noteSettings;
}

/** 把服务端返回的一整份设置写进全局对象（未知分类原样保留，便于以后扩展） */
export function applyNoteSettings(raw, instanceId) {
    const o = raw && typeof raw === 'object' ? raw : {};
    noteSettings.moment = normalizeMomentSettings(o.moment);
    for (const key of Object.keys(o)) {
        if (key === 'moment') continue;
        noteSettings[key] = o[key];
    }
    noteSettingsInstanceId.value = String(instanceId || '');
    noteSettingsReady.value = true;
    // 同步落一份 Cookie：下次刷新时 created() 里就能拿到，首屏不闪
    cacheSettings(instanceId, noteSettings.moment);
}

/**
 * 读取某个实例的笔记设置。
 * 失败（网络异常 / 未登录）时保持当前值（通常是 Cookie 缓存），不影响笔记本身的使用。
 */
export async function loadNoteSettings(instanceId) {
    const id = String(instanceId || '');
    try {
        const qs = new URLSearchParams({ instanceId: id });
        const res = await fetchWithAuth(`/api/notes/settings?${qs.toString()}`);
        const json = await res.json().catch(() => null);
        if (res.ok && json && json.success !== false && json.data) {
            // 请求期间用户可能已经切到别的实例 —— 丢掉过期响应，不要把 A 的尺寸写到 B 上
            if (noteSettingsInstanceId.value !== id) return noteSettings;
            applyNoteSettings(json.data, id);
        }
    } catch {
        /* 网络异常：保持 Cookie 里的值 / 默认值 */
    }
    return noteSettings;
}

/** 保存（合并式）：只传要改的分类，返回服务端收敛后的完整设置 */
export async function saveNoteSettings(instanceId, patch) {
    const res = await fetchWithAuth('/api/notes/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(patch || {}), instanceId: String(instanceId || '') })
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.success === false) {
        throw new Error((json && json.message) || 'save failed');
    }
    applyNoteSettings(json.data, instanceId);
    return json.data;
}

/**
 * 读设置页示例换算的缓存。
 * 只有「比例」和「视口高度」都没变时才可信 —— 高度变了数字就不对了，必须重算。
 *
 * @returns {number[]|null} [三行高, 两行高, 一行高]（单位 px）
 */
export function readPreviewCache(ratio, vh) {
    const c = readCookie();
    if (!c || !Array.isArray(c.p) || c.p.length !== 3) return null;
    if (Number(c.r) !== Number(ratio)) return null;
    if (Number(c.vh) !== Number(vh)) return null;
    const out = c.p.map((n) => Number(n));
    return out.every((n) => Number.isFinite(n) && n > 0) ? out : null;
}

/** 写示例换算缓存（值没变就不重复写 Cookie，避免每次重算都产生一次写操作） */
export function writePreviewCache(ratio, vh, heights) {
    const c = readCookie();
    const same =
        c &&
        Number(c.r) === Number(ratio) &&
        Number(c.vh) === Number(vh) &&
        Array.isArray(c.p) &&
        c.p.length === heights.length &&
        c.p.every((n, i) => Number(n) === Number(heights[i]));
    if (same) return;
    writeCookie({ r: Number(ratio), vh: Number(vh), p: heights.map((n) => Math.round(Number(n) || 0)) });
}

/* ── 可视区高度 ────────────────────────────────────────────────────────── */

/**
 * 响应式可视区高度。移动端地址栏收起/展开会改变 innerHeight，
 * 所以监听 resize 用 rAF 合并，避免一次旋转触发几十次重算。
 */
export const viewportHeight = ref(typeof window === 'undefined' ? 800 : window.innerHeight);

let heightBound = false;
function bindViewportHeight() {
    if (heightBound || typeof window === 'undefined') return;
    heightBound = true;
    let raf = 0;
    window.addEventListener(
        'resize',
        () => {
            if (raf) return;
            raf = window.requestAnimationFrame(() => {
                raf = 0;
                viewportHeight.value = window.innerHeight;
            });
        },
        { passive: true }
    );
}

/**
 * 纯函数版高度预算：给定设置对象算尺寸，不碰全局状态。
 * 设置页的「实时预览」要用它 —— 在 computed 里改全局 reactive 会形成读写依赖环，
 * 所以必须有一条不产生副作用的计算路径。
 *
 * 口径（v1.1.2.3，需求原文表格）：
 *   · 总高 = 可视区高度 x 设定比例 x 个数系数（见 attachHeightFactor）；
 *   · 格子 1:1 → 行高即格宽；
 *   · **宽度不够就按宽度收**：算出的一行总宽超过可用宽度时，用可用宽度反推格宽，
 *     格子仍然是 1:1（需求：「如果页面的加载区宽度小于计算出来的附件的总宽度，
 *     则按页面加载区宽度来调整附件的宽度」）。
 *
 * @param {number} count 实际显示的附件数
 * @param {number} cols  列数
 * @param {{attachSize?:string, attachRatio?:number}} setting 用哪份设置
 * @param {number} vh    可视区高度（默认取当前值）
 * @param {number} [avail] 可用宽度（px，默认 0 = 不做宽度收敛，按 CSS min() 兜底）
 */
export function budgetOf(count, cols, setting, vh, avail) {
    const n = Number(count) || 0;
    if (n <= 0) return null;
    const s = setting || noteSettings.moment;
    if (s.attachSize !== 'custom') return null;
    const colCount = Math.max(1, Number(cols) || 1);
    const height = Number(vh) || viewportHeight.value;
    const ratio = Number(s.attachRatio) || DEFAULT_MOMENT_SETTINGS.attachRatio;

    const rowCount = Math.max(1, Math.ceil(n / colCount));
    const rows = Math.min(3, rowCount);
    // v1.1.2.3：系数按「实际显示个数」取，不再按行数取
    const factor = attachHeightFactor(n);
    const total = (height * ratio) / 100 * factor;
    // 扣掉行间距后平分给每一行 —— 格子是 1:1，所以「行高」就是「格宽」
    let cell = Math.max(40, (total - ATTACH_GAP * (rows - 1)) / rows);
    // 宽度收敛：一行放不下时按可用宽度反推
    const availW = Number(avail) || 0;
    if (availW > 0) {
        const maxCell = (availW - ATTACH_GAP * (colCount - 1)) / colCount;
        if (maxCell > 0 && cell > maxCell) cell = Math.max(24, maxCell);
    }
    return {
        cell,
        rows,
        cols: colCount,
        width: cell * colCount + ATTACH_GAP * (colCount - 1),
        height: cell * rows + ATTACH_GAP * (rows - 1)
    };
}

/**
 * 单附件预算（v1.1.2.3）：不按 1:1，按**原图宽高比**算。
 *
 *   · 「指定比例」→ 高度 = 可视区高度 x 设定比例 x 80%，宽度 = 高度 x 宽高比；
 *   · 「自动比例」→ 沿用「宽度约卡片 62%」的既有观感（v1.1.2.3 明确要求这条不变），
 *                   高度由宽高比反推，并用 45% 视口高度封顶；
 *   · 两种模式都再做一次「宽度不超过可用宽度」的收敛。
 *
 * @param {{attachSize?:string, attachRatio?:number}} setting
 * @param {number} vh     可视区高度
 * @param {number} avail  可用宽度（px）
 * @param {number} aspect 原图宽高比（width / height），未知时按 4:3
 */
export function singleBudgetOf(setting, vh, avail, aspect) {
    const s = setting || noteSettings.moment;
    const height = Number(vh) || viewportHeight.value;
    const a = Number(aspect) > 0 ? Number(aspect) : 4 / 3;
    const availW = Number(avail) || 0;
    const ratio = Number(s.attachRatio) || DEFAULT_MOMENT_SETTINGS.attachRatio;

    let h;
    if (s.attachSize === 'custom') {
        h = (height * ratio) / 100 * ATTACH_SINGLE_FACTOR;
    } else if (availW > 0) {
        h = (availW * SINGLE_DEFAULT_WIDTH) / a;
        h = Math.min(h, height * SINGLE_DEFAULT_MAX_RATIO);
    } else {
        h = (height * ratio) / 100 * ATTACH_SINGLE_FACTOR;
    }
    let w = h * a;
    if (availW > 0 && w > availW) {
        w = availW;
        h = w / a;
    }
    return {
        single: true,
        aspect: a,
        width: Math.max(32, Math.round(w)),
        height: Math.max(32, Math.round(h))
    };
}

/**
 * 附件区高度预算（px）—— 用全局设置算。
 *
 * @param {number} count 实际显示的附件数（已按「加载几行」截断）
 * @param {number} cols  列数
 * @param {number} [avail] 可用宽度（px）
 * @returns {{ cell: number, rows: number, width: number, height: number } | null}
 *          null = 用「默认」布局，调用方不要加任何尺寸样式
 */
export function attachBudget(count, cols, avail) {
    return budgetOf(count, cols, noteSettings.moment, undefined, avail);
}

/** 单附件预算（用全局设置 + 当前视口） */
export function singleBudget(avail, aspect) {
    return singleBudgetOf(noteSettings.moment, viewportHeight.value, avail, aspect);
}

/** 绑定一次 resize 监听（模块加载即生效，不需要组件手动调） */
bindViewportHeight();
