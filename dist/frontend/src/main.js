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
 * 主题一律以右上角切换按钮为准（亮 / 暗 / 自动三态），
 * 其中「自动」态按 19:00—07:00 + 系统深色偏好判断。
 * 老库存量配置里即使还有 autoDarkMode=true 也不再读取。
 */
const NIGHT_START_HOUR = 19;
const NIGHT_END_HOUR = 7;

/** 按 19:00—07:00 判断当前是否属于夜间 */
const isNightNow = () => {
    const hour = new Date().getHours();
    return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
};

const initDarkModeClass = () => {
    const htmlElement = document.documentElement;
    let isDarkMode;

    if (store.state.cusDarkMode && store.state.useDarkMode !== null) {
        // 用户手动设置了亮色 / 暗色
        isDarkMode = store.state.useDarkMode;
    } else {
        // 自动态：跟随系统深色偏好，系统为亮色时再按 19:00—07:00 判断
        isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches || isNightNow();
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
const presetSiteTitle = (userConfig) => {
    document.title = userConfig?.siteTitle || 'GoHub';
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
    });

    /*
     * 跨过 19:00 / 07:00 这个时间点时页面不会自己重载，所以定时（每分钟）
     * 以及「标签页重新可见」时各重算一次主题 —— 长时间挂着的页面也能自动切换。
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
