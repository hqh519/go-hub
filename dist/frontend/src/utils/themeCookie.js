/*
 * v2.8.5 主题模式 Cookie（替代 storage 事件实时同步）。
 *
 * 任何页面切换主题（亮 / 暗 / 自动）时把三态写入 Cookie；
 * 其它页面刷新加载时优先按 Cookie 决定主题 —— 不做跨标签页实时回灌，
 * 避免与 vuex-persistedstate 的写入互相触发形成死循环（页面闪烁卡顿的根因）。
 */
const THEME_COOKIE_KEY = 'gohub_theme';
// 一年内有效，覆盖足够长的使用周期
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** 读取主题 Cookie：'dark' | 'light' | 'auto'，无则返回 null */
export function readThemeCookie() {
    const match = document.cookie
        .split(';')
        .map(item => item.trim())
        .find(item => item.startsWith(THEME_COOKIE_KEY + '='));
    if (!match) return null;
    const value = match.slice(THEME_COOKIE_KEY.length + 1);
    return ['dark', 'light', 'auto'].includes(value) ? value : null;
}

/** 写入主题 Cookie（path=/ 保证全站可读） */
export function writeThemeCookie(mode) {
    if (!['dark', 'light', 'auto'].includes(mode)) return;
    document.cookie = `${THEME_COOKIE_KEY}=${mode}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}
