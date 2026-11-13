/**
 * 灯箱背景透明度（v1.2.0）
 *
 * 配置位置：系统管理 → 其他设置 → 「其他」模块 → 灯箱透明度
 * 存储位置：sysConfig 的 others 分区 → `viewer.opacity`（与 autoTag 同级）
 * 生效范围：所有文件灯箱（MediaPreviewOverlay）的背景遮罩。
 *
 * 为什么单独抽一个模块：
 *   灯箱组件在「图床管理 / 挂载管理 / 发布中心」三个页面各挂一份，
 *   如果每个实例都自己去请求一次配置，切页面就会重复打接口。
 *   这里做模块级缓存 —— 全站只请求一次，配置页保存后通过自定义事件广播新值。
 */

import fetchWithAuth from '@/utils/fetchWithAuth';

/** 默认值：需求规定「默认留空时的值为 0.9」 */
export const DEFAULT_LIGHTBOX_OPACITY = 0.9;

/** 配置变更广播事件名（设置页保存 → 灯箱实时跟随） */
export const LIGHTBOX_OPACITY_EVENT = 'gohub:lightbox-opacity';

/** 已加载的值；null 表示「还没问过后端」 */
let cached = null;
/** 正在进行的请求（并发调用共用同一个 Promise） */
let pending = null;

/**
 * 归一化配置值。
 * 接受 0～1 的小数（也容忍 "0.85" 这种字符串）；
 * 空值 / 非法值 / NaN 一律回落 0.9 —— 与后端默认值保持一致。
 */
export function normalizeOpacity(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return DEFAULT_LIGHTBOX_OPACITY;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_LIGHTBOX_OPACITY;
    if (n <= 0) return 0;
    if (n >= 1) return 1;
    // 两位小数足够（0.85 / 0.9 / 0.75），避免浮点尾数写进 style
    return Math.round(n * 100) / 100;
}

/** 同步取当前值（未加载过时返回默认值 —— 首屏不会闪一下全透明） */
export function getLightboxOpacity() {
    return cached === null ? DEFAULT_LIGHTBOX_OPACITY : cached;
}

/**
 * 读取配置（带缓存）。
 * @param {boolean} [force] 强制重新请求（配置页保存后用）
 * @returns {Promise<number>}
 */
export async function loadLightboxOpacity(force = false) {
    if (!force) {
        if (cached !== null) return cached;
        if (pending) return pending;
    }
    pending = (async () => {
        try {
            const res = await fetchWithAuth('/api/manage/sysConfig/others');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            cached = normalizeOpacity(json && json.viewer ? json.viewer.opacity : undefined);
        } catch (e) {
            // 拿不到配置不是致命错误：保持旧值（首次则用默认值）
            if (cached === null) cached = DEFAULT_LIGHTBOX_OPACITY;
        }
        return cached;
    })();
    try {
        return await pending;
    } finally {
        pending = null;
    }
}

/**
 * 设置并广播（设置页保存成功后调用）→ 已挂载的灯箱立即跟随，不用刷新页面。
 * @returns {number} 归一化后的值
 */
export function setLightboxOpacity(value) {
    cached = normalizeOpacity(value);
    try {
        window.dispatchEvent(new CustomEvent(LIGHTBOX_OPACITY_EVENT, { detail: cached }));
    } catch (e) {
        /* 极老浏览器没有 CustomEvent 构造器：忽略，下次打开灯箱仍会走缓存值 */
    }
    return cached;
}

/**
 * 订阅变更，返回取消订阅函数。
 * @param {(value:number)=>void} handler
 */
export function onLightboxOpacityChange(handler) {
    if (typeof handler !== 'function') return () => {};
    const listener = (e) => {
        const v = e && e.detail;
        handler(typeof v === 'number' ? v : getLightboxOpacity());
    };
    window.addEventListener(LIGHTBOX_OPACITY_EVENT, listener);
    return () => window.removeEventListener(LIGHTBOX_OPACITY_EVENT, listener);
}
