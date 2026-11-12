import { createApp } from 'vue'
import { createHead } from '@vueuse/head'; // 导入 createHead
import ElementPlus, { messageConfig } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'

import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import fontAwesomeIcons from './utils/fontawesomeIcons';

import App from './App.vue'
import router from './router'
import store from './store'
import i18n, { initializeLocale } from './locales'
// 访问记录上报（v2.3.0）：站内页面访问 + 停留时长
import { setupAccessTracker } from './utils/accessTracker'
// 移动端返回键优先关弹窗（v2.3.0；v1.0.0 改为统一浮层栈，一次只关最上面一层）
import { setupBackGuard } from './utils/backGuard'
// v1.0.0：屏蔽移动端「屏幕边缘横滑 → 返回」的伸缩拉动动画
import { setupEdgeSwipeGuard } from './utils/edgeSwipeGuard'
// 主题模式 Cookie（v2.8.5：跨页面主题同步走 Cookie，页面刷新时生效）
import { readThemeCookie } from './utils/themeCookie'
// v3.0.0：长时间闲置 / 标签页被回收后重新访问时的「自动复活」守护
import { setupPageRevive } from './utils/page-revive'
// v1.1.6：网站标题占位符（{host} / {user} / {pagename}）
import { resolveSiteTitle } from './utils/siteTitle'

import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/global.css'
import './styles/responsive.css'

// OverlayScrollbars 悬浮滚动条
import 'overlayscrollbars/overlayscrollbars.css'


library.add(...fontAwesomeIcons);

// v3.0.0：必须在挂载之前装好 —— 入口请求挂死导致始终没挂载时也要能自愈
setupPageRevive();

// 保留首条消息的顶部间距，同时允许 Element Plus 动态计算后续消息的位置。
messageConfig.offset = 30;

const app = createApp(App);
const head = createHead(); // 创建 head 对象

app.component('font-awesome-icon', FontAwesomeIcon);
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component)
}

/**
 * 主题初始化。
 *
 * v2.4.0：「夜间/白天强制切换」（autoDarkMode）已按需求移除 ——
 * 主题一律以右上角切换按钮为准（亮 / 暗 / 自动三态）。
 *
 * v1.0.3：「自动」态改为按【网页设置 → 白天/夜间切换时间】判断，
 * 不再跟随系统深色偏好。区间内 = 白天，区间外 = 夜间；
 * 配置留空时用默认 07:00—19:00（07:00 切白天、19:00 切夜间）。
 * 因此同一台设备不论系统主题如何，全站观感一致，也方便统一运营。
 */
// v1.1.6：默认切换时间由 08:00—20:00 调整为 07:00—19:00
const DEFAULT_DAY_START = '07:00';
const DEFAULT_DAY_END = '19:00';

/** 把 "H:MM" / "8点" / "8" 归一化成当天分钟数；非法返回 null */
const parseClock = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return null;
    const m = s.match(/^(\d{1,2})\s*[:：点时.]?\s*(\d{0,2})/);
    if (!m) return null;
    const h = Math.min(23, Math.max(0, Number(m[1]) || 0));
    const mi = Math.min(59, Math.max(0, Number(m[2]) || 0));
    return h * 60 + mi;
};

/**
 * 解析「白天/夜间切换时间」配置。
 * 兼容三种写法（都是同一件事：几点切白天、几点切夜间）：
 *   ["07:00":"19:00"]  —— 后台输入框的默认展示形态
 *   07:00-19:00 / 07:00~19:00 / 07:00 19:00 / 07:00,19:00
 * 解析不出来时回落到默认 07:00—19:00。
 */
const parseDayNightRange = (raw) => {
    const text = String(raw || '');
    const clocks = text.match(/\d{1,2}\s*[:：点时.]?\s*\d{0,2}/g) || [];
    const nums = clocks.map(parseClock).filter((n) => n !== null);
    const start = nums.length >= 1 ? nums[0] : parseClock(DEFAULT_DAY_START);
    const end = nums.length >= 2 ? nums[1] : parseClock(DEFAULT_DAY_END);
    if (start === null || end === null || start === end) {
        return { start: parseClock(DEFAULT_DAY_START), end: parseClock(DEFAULT_DAY_END) };
    }
    return { start, end };
};

/** 当前是否属于「白天」（按网页设置里的时间段；跨零点区间也支持） */
const isDaytimeNow = () => {
    const raw = store.getters.userConfig?.themeAutoRange;
    const { start, end } = parseDayNightRange(raw);
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    if (start < end) return cur >= start && cur < end;
    // 跨零点（如 20:00—06:00 表示白天在夜里）：反过来判断
    return cur >= start || cur < end;
};

const initDarkModeClass = () => {
    const htmlElement = document.documentElement;
    let isDarkMode;

    if (store.state.cusDarkMode && store.state.useDarkMode !== null) {
        // 用户手动设置了亮色 / 暗色
        isDarkMode = store.state.useDarkMode;
    } else {
        // 自动态：按「白天/夜间切换时间」判断（v1.0.3，不再跟随系统偏好）
        isDarkMode = !isDaytimeNow();
        store.commit('setUseDarkMode', isDarkMode);
    }

    if (isDarkMode) {
        htmlElement.classList.add('dark');
    } else {
        htmlElement.classList.remove('dark');
    }
};

const applyDarkModeClass = (isDarkMode) => {
    const htmlElement = document.documentElement;
    if (isDarkMode) {
        htmlElement.classList.add('dark');
    } else {
        htmlElement.classList.remove('dark');
    }
};

// 预设网站标题的函数
/*
 * v1.1.6：标题支持占位符（{host} / {user} / {pagename}），因此每次都要按
 * 「当前域名 + 当前登录用户 + 当前页面路径」重新解析，不能再简单写死一个字符串。
 * 下面这个缓存用来避免「同一份结果反复写 document.title」引起的无意义变更。
 */
let lastAppliedTitle = '';
const presetSiteTitle = (userConfig) => {
    const title = resolveSiteTitle(userConfig?.siteTitle, {
        user: store.getters.sessionUser || '',
        path: router.currentRoute?.value?.path || (typeof window !== 'undefined' ? window.location.pathname : '/')
    });
    if (title === lastAppliedTitle) return;
    lastAppliedTitle = title;
    document.title = title;
};

// 预设和更新网站图标的函数
const presetSiteIcon = (isDarkMode, userConfig) => {
    // 同时更改 icon apple-touch-icon 和 mask-icon
    const existingIcons = document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]');
    existingIcons.forEach(icon => icon.remove());

    const iconLink = document.createElement('link');
    const appleIconLink = document.createElement('link');
    const maskIconLink = document.createElement('link');
    iconLink.rel = 'icon';
    appleIconLink.rel = 'apple-touch-icon';
    maskIconLink.rel = 'mask-icon';

    if (isDarkMode) {
        iconLink.href = userConfig?.siteIcon || '/static/media/logo-dark.png';
        appleIconLink.href = userConfig?.siteIcon || '/static/media/logo-dark.png';
        maskIconLink.href = userConfig?.siteIcon || '/static/media/logo-dark.png';
    } else {
        iconLink.href = userConfig?.siteIcon || '/static/media/logo.png';
        appleIconLink.href = userConfig?.siteIcon || '/static/media/logo.png';
        maskIconLink.href = userConfig?.siteIcon || '/static/media/logo.png';
    }

    document.head.appendChild(iconLink);
    document.head.appendChild(appleIconLink);
    document.head.appendChild(maskIconLink);
};

/*
 * v3.0.0：入口配置请求加上「兜底超时」。
 * 原先 store.dispatch('fetchUserConfig') 一旦挂住（长时间闲置后网络未就绪、
 * 服务端连接池繁忙），.then 永远不执行 → 应用永远不挂载 → 整页空白。
 * 现在 8 秒拿不到配置就先用默认配置挂载，后续真实配置回来会响应式更新。
 */
const bootConfig = store.dispatch('fetchUserConfig');
/*
 * v1.0.3：配置可能晚于「6 秒兜底」才回来（此时上面已经按默认 07:00—19:00 挂载）。
 * 拿到真实「白天/夜间切换时间」后再算一次，避免用户在后台改了时间却要等下一次刷新。
 */
bootConfig.then(() => {
    if (!store.state.cusDarkMode) initDarkModeClass();
}).catch(() => {});
const bootTimeout = new Promise((resolve) => {
    window.setTimeout(() => resolve('boot-timeout'), 6000);
});

Promise.race([bootConfig, bootTimeout]).then(() => {
    // 优先恢复用户选择；没有持久化选择时使用网页默认语言
    initializeLocale(store.getters.userConfig?.defaultLanguage);

    /*
     * v2.8.5：主题模式以 Cookie 为准（用户在任意页面切换时写入）。
     * Cookie 存在则覆盖本地持久化的旧选择；不存在（首次访问 / 清了 Cookie）
     * 时沿用 localStorage 里 vuex-persistedstate 保存的上次选择，向后兼容。
     */
    const cookieTheme = readThemeCookie();
    if (cookieTheme === 'dark') {
        store.commit('setCusDarkMode', true);
        store.commit('setUseDarkMode', true);
    } else if (cookieTheme === 'light') {
        store.commit('setCusDarkMode', true);
        store.commit('setUseDarkMode', false);
    } else if (cookieTheme === 'auto') {
        store.commit('setCusDarkMode', false);
        store.commit('setUseDarkMode', null);
    }

    // 初始化时应用 dark 模式
    initDarkModeClass();

    // 预设网站标题和图标
    presetSiteTitle(store.getters.userConfig);
    presetSiteIcon(store.state.useDarkMode, store.getters.userConfig);

    // 监听 useDarkMode 和 cusDarkMode 的变化
    store.subscribe((mutation, state) => {
        if (mutation.type === 'setUseDarkMode' && store.state.cusDarkMode) {
            applyDarkModeClass(state.useDarkMode);
            // 同时更新网站图标
            presetSiteIcon(state.useDarkMode, store.getters.userConfig);
        }

        // 监听 cusDarkMode 变化，当设置为 false 时重新初始化
        if (mutation.type === 'setCusDarkMode' && !mutation.payload) {
            // 切换到跟随系统模式，重新初始化
            initDarkModeClass();
            // 同时更新网站图标
            presetSiteIcon(store.state.useDarkMode, store.getters.userConfig);
        }

        /*
         * v1.1.6：标题里的 {user} / {pagename} 依赖登录态与配置，
         * 登录、登出、配置刷新后都要重算一次（未登录时这两个占位符解析为空）。
         */
        if (mutation.type === 'setSession' || mutation.type === 'clearSession' || mutation.type === 'setUserConfig') {
            presetSiteTitle(store.getters.userConfig);
        }
    });

    /*
     * v1.0.3：跨过「白天/夜间切换时间」的两个时间点时页面不会自己重载，
     * 所以定时（每分钟）以及「标签页重新可见」时各重算一次主题 —— 长时间挂着的页面也能自动切换。
     */
    const refreshThemeByTime = () => {
        if (!store.state.cusDarkMode) initDarkModeClass();
    };
    setInterval(refreshThemeByTime, 60 * 1000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshThemeByTime();
    });

    // v3.0.0（R9-F）：EP 全局 zIndex 基准提到 3210 —— 媒体灯箱固定 z-index 3200，
    // 弹层（详情弹窗 / MessageBox / message）从 3211 起递增，才能叠在灯箱上层
    // （详情按钮开详情不关灯箱、抓拍上传确认框都依赖这一点）。
    app.use(store).use(router).use(ElementPlus, { zIndex: 3210 }).use(i18n).mount('#app');

    /*
     * v1.1.6：每切一个页面重算标题 —— 占位符 {pagename} 才能跟着页面名变
     * （/dashboard → 图床管理、/notes → 笔记管理 …；未登录时不显示页面名）。
     */
    router.afterEach(() => {
        presetSiteTitle(store.getters.userConfig);
    });
    presetSiteTitle(store.getters.userConfig);

    /*
     * 访问记录上报（v2.3.0）。
     * 必须放在 router 挂载之后：它 hook 的是 router.afterEach，注册越早越好，
     * 但只有 mount 之后首次导航才会真正触发，因此这里是最稳的位置。
     */
    setupAccessTracker();

    /*
     * 移动端返回键优先关弹窗（v2.3.0）：
     * 有浮层时返回键只关最上面那一层，没有浮层才真的返回上一页。
     * v1.0.0：弹窗与灯箱共用同一个浮层栈，桌面端 Esc 也按同一顺序逐层关闭。
     */
    setupBackGuard();

    /* v1.0.0：移动端屏幕边缘横滑不再触发「返回」伸缩动画 */
    setupEdgeSwipeGuard();
}).catch(error => {
    console.error('Failed to load user configuration:', error);
    initializeLocale();
    app.use(store).use(router).use(ElementPlus, { zIndex: 3210 }).use(i18n).use(head).mount('#app');
    setupBackGuard();
    setupEdgeSwipeGuard();
})
