<template>
    <header class="admin-header-spacer" :class="{ 'has-search': !!$slots.search }" :style="{ '--admin-header-reserved-space': reservedSpace }">
        <!-- v3.0.0（R4）：外观常驻「带边框 + 半透明背景 + 宽度内缩」；仅保留滚动方向显隐 -->
        <!--
            v3.0.0（R9 修复）：pointerdown 时若顶栏正处于「上滑/下滑」过渡动画中，
            立即跳到最终位置（.is-snap 禁用过渡），避免点击落在移动中的元素上 ——
            否则动画期间按下的手指与元素位置错开，click 不触发，表现就是
            「页面切换等顶栏按钮经常失灵、要点两次」。
        -->
        <div
            ref="headerContent"
            class="admin-header-content"
            :class="{ 'is-scroll-hidden': scrollHidden, 'is-snap': snapHeader, 'is-solid': headerScrolled }"
            @pointerdown.capture="snapHeaderNow"
        >
            <DashboardTabs :active-tab="activeTab">
                <!-- v3.0.0（R17）：页面切换改成弹窗后，页面的附加条目（切换实例）改用插槽注入 -->
                <template v-if="$slots['page-extra']" #extra-item="slotProps">
                    <slot name="page-extra" v-bind="slotProps" />
                </template>
            </DashboardTabs>
            <!-- v3.0.0：页面切换下拉框后面的「附加工具位」（文件管理页用来放「实例」下拉框） -->
            <div v-if="$slots['header-extra']" class="admin-header-extra">
                <slot name="header-extra" />
            </div>
            <div class="admin-header-tools">
                <div v-if="$slots.search" class="admin-header-search">
                    <slot name="search" />
                </div>
                <AdminHeaderActions
                    :show-link-format="showLinkFormat"
                    :disable-tooltip="isMobile"
                    :is-mobile="isMobile"
                    :inline-actions="inlineActions"
                    @link-format="$emit('link-format')"
                    @logout="handleLogout"
                    @tag-management="$emit('tag-management')"
                />
            </div>
        </div>
    </header>
</template>

<script>
import DashboardTabs from '@/components/DashboardTabs.vue';
import AdminHeaderActions from './AdminHeaderActions.vue';
import { OverlayScrollbars } from 'overlayscrollbars';

export default {
    name: 'AdminHeader',
    components: { DashboardTabs, AdminHeaderActions },
    props: {
        activeTab: { type: String, default: 'dashboard' },
        showLinkFormat: Boolean,
        /*
         * v3.0.0：页面已在自己的工具栏里放了「标签管理 / 声音切换 / 链接格式」图标按钮，
         * 传 true 可让移动端「更多菜单」不再重复列出这三项。
         */
        inlineActions: Boolean
    },
    // v3.0.0：移动端更多菜单「标签管理」透传给页面
    emits: ['link-format', 'tag-management'],
    data() {
        return {
            // v20261027：移动端判定阈值 768 → 1024 —— 平板（含竖屏）同样使用
            // 「第一行右侧按钮组 + 更多菜单 / 第二行搜索框 + 筛选」的紧凑顶栏
            isMobile: window.innerWidth <= 1024,
            reservedSpace: null,
            // v3.0.0（R11c）：页面已滚动（离开顶部）→ 顶栏背框改为不透明（去除玻璃透明与背景模糊）
            headerScrolled: false,
            // v3.0.0（R4）：向下滚 → 顶栏上滑隐藏；向上滚 → 立刻显示（桌面/移动端同一套行为）
            scrollHidden: false,
            // v3.0.0（R9 修复）：顶栏显隐动画期间的「立即就位」标记（见 snapHeaderNow）
            snapHeader: false,
            // 上一次显隐状态切换时间（用于判断动画是否在进行中）
            lastToggleAt: 0,
            lastScrollY: 0
        };
    },
    methods: {
        getHeaderScrollElements() {
            return OverlayScrollbars(document.body)?.elements();
        },
        /**
         * 顶栏滚动显隐（只控制「上滑隐藏 / 下滑显示」，不再改动宽度、内边距与背景）：
         *   页面向上滚动 → 显示
         *   页面向下滚动（且已离开顶部 40px）→ 隐藏
         * 页面本身不可滚动（内容不足一屏）时永远显示。
         */
        updateScrollHidden(y) {
            const delta = y - this.lastScrollY;
            // 小于 2px 的抖动不改变状态，避免触控板惯性滚动时顶栏闪烁
            if (Math.abs(delta) < 2) return;
            this.lastScrollY = y;
            const next = !(y <= 40 || delta < 0);
            if (next !== this.scrollHidden) {
                this.scrollHidden = next;
                // v3.0.0（R9 修复）：记录动画起点，供 snapHeaderNow 判断「正在动画中」
                this.lastToggleAt = Date.now();
            }
        },
        /**
         * v3.0.0（R9 修复）：手指 / 鼠标按在顶栏上的瞬间，若显隐过渡动画正在进行
         * （280ms 内切换过显隐状态），立即跳到最终位置 —— 禁用一帧过渡，
         * 让随后的 click 命中静止的按钮，而不是滑到一半的顶栏（点击被吞 → 要点两次）。
         */
        snapHeaderNow() {
            if (Date.now() - this.lastToggleAt > 320) return;
            this.snapHeader = true;
            // 强制浏览器应用「无过渡」样式并就位，动画结束后恢复过渡
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.snapHeader = false;
                });
            });
        },
        /**
         * v3.0.0（R11c）：当前页面滚动位置 —— 兼容 OverlayScrollbars 接管（viewport 元素）与原生滚动，
         * 原来只读 scrollingElement，OS 接管时恒为 0，导致「已滚动」状态永远不成立。
         */
        currentScrollY() {
            const elements = this.getHeaderScrollElements();
            let y = Math.max(0, elements?.scrollOffsetElement?.scrollTop || 0);
            if (!y) y = Math.max(0, (document.scrollingElement || document.documentElement)?.scrollTop || 0);
            if (!y) y = Math.max(0, window.scrollY || 0);
            if (!y) y = Math.max(0, document.body?.scrollTop || 0);
            return y;
        },
        syncScrollState() {
            const y = this.currentScrollY();
            this.updateScrollHidden(y);
            /*
             * v3.0.0（R11c）：离开顶部（> 8px）即判定为「吸附 / 浮层」状态 ——
             * 顶栏背框去掉玻璃半透明与背景模糊，改为完全不透明，避免下方内容透出。
             * 状态同时写到 <html>，供各页面（含自己）做样式联动。
             */
            const scrolled = y > 8;
            if (scrolled !== this.headerScrolled) this.headerScrolled = scrolled;
            document.documentElement.classList.toggle('admin-header-scrolled', scrolled);
            /*
             * v3.0.0（R4）：把顶栏显隐状态同步到 <html>，供页面内的吸顶条（文件管理页第二行）
             * 跟随 —— 顶栏隐藏时吸顶条顶到最上方，顶栏出现时贴回顶栏下方。
             */
            document.documentElement.classList.toggle('admin-header-hidden', this.scrollHidden);
            // 通知页面里的吸顶条立即重算位置（避免它读到上一帧的状态）
            window.dispatchEvent(new CustomEvent('gohub:header-toggle', { detail: { hidden: this.scrollHidden } }));
        },
        handleHeaderScroll(event) {
            const elements = this.getHeaderScrollElements();
            // 弹窗、表格等内部滚动不改变页面顶栏。
            if (![document, window, document.scrollingElement, elements?.scrollEventElement, elements?.scrollOffsetElement].includes(event.target)) return;
            if (this.headerScrollFrame !== null) return;
            this.headerScrollFrame = requestAnimationFrame(() => {
                this.headerScrollFrame = null;
                this.syncScrollState();
            });
        },
        updateViewport() {
            // v20261027：与 isMobile 初始值同步，阈值 768 → 1024（平板也走紧凑顶栏）
            this.isMobile = window.innerWidth <= 1024;
            this.measureReservedSpace();
        },
        measureReservedSpace() {
            const header = this.$refs.headerContent;
            const space = `${header.offsetTop + header.offsetHeight + 12}px`;
            this.reservedSpace = space;
            // v3.0.0（R4）：同一份占位高度写到 <html>，页面内吸顶条据此贴在顶栏下方
            document.documentElement.style.setProperty('--admin-header-space', space);
        },
        handleLogout() {
            const url = '/api/auth/logout';
            fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authType: 'admin' })
            }).finally(() => {
                this.$store.commit('setAdminLoggedIn', false);
                this.$router.push('/adminLogin');
            });
        }
    },
    mounted() {
        this.headerScrollFrame = null;
        this.syncScrollState();
        document.addEventListener('scroll', this.handleHeaderScroll, { capture: true, passive: true });
        this.measureReservedSpace();
        this.headerResizeObserver = new ResizeObserver(this.measureReservedSpace);
        this.headerResizeObserver.observe(this.$refs.headerContent);
        window.addEventListener('resize', this.updateViewport, { passive: true });
    },
    beforeUnmount() {
        document.removeEventListener('scroll', this.handleHeaderScroll, true);
        if (this.headerScrollFrame !== null) cancelAnimationFrame(this.headerScrollFrame);
        // 清理挂到 <html> 上的共享状态与变量，避免影响其他页面
        document.documentElement.classList.remove('admin-header-hidden');
        document.documentElement.style.removeProperty('--admin-header-space');
        this.headerResizeObserver.disconnect();
        window.removeEventListener('resize', this.updateViewport);
    }
};
</script>

<style scoped>
.admin-header-spacer {
    height: 60px;
    flex: 0 0 auto;
}

.admin-header-tools {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
    margin-left: auto;
}

.admin-header-search {
    display: flex;
    align-items: center;
    min-width: 0;
}

/* v3.0.0：页面切换下拉框右侧的附加工具位（实例下拉框） */
.admin-header-extra {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    min-width: 0;
}

.admin-header-search :deep(.filter-trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--admin-header-action-size, 32px);
    height: var(--admin-header-action-size, 32px);
    font-size: var(--admin-header-action-font-size, 20px);
}

.admin-header-search :deep(.filter-trigger .header-icon) {
    width: 1em;
    height: 1em;
    font-size: inherit;
}

.admin-header-search :deep(.filter-badge) {
    display: inline-flex;
    align-items: center;
}

/*
 * v2.8.5：两行布局断点 1024 → 1023 —— 平板横屏（宽 1024 起）改回 PC 单行布局，
 *          平板竖屏（768）与手机继续使用两行紧凑布局：
 *   第一行右侧：标签筛选 / 刷新 / 回收站 / 更多菜单（靠右对齐）
 *   第二行：搜索框（宽度 90%）+ 筛选按钮（跟在搜索框后面）
 */
@media (max-width: 1023px) {
    .admin-header-spacer {
        height: var(--admin-header-reserved-space, 76px);
    }

    .admin-header-spacer.has-search {
        height: var(--admin-header-reserved-space, 114px);
    }

    /*
     * v2.6.0 #302：搜索区打平（display: contents），
     * 让 标签/刷新/回收站 上移到第一行（与「更多菜单」同行），
     * 搜索框 + 筛选留在第二行且搜索框加长（flex 占满剩余宽度）。
     * v2.8.0 #C16：标签/刷新/回收站 三个按钮靠拢到右侧「更多菜单」旁边
     * （第一个按钮 margin-left:auto 整组推右，「更多菜单」不再独自推右）。
     */
    .admin-header-search {
        display: contents;
    }

    .admin-header-content :deep(.search-area) {
        display: contents;
    }

    /* 第一行右侧组：标签 / 刷新 / 回收站（margin-left:auto 只加在第一个，整组靠右） */
    .admin-header-content :deep(.tag-filter-badge) {
        order: 1;
        margin-left: auto;
    }

    .admin-header-content :deep(.refresh-files-btn) {
        order: 1;
    }

    /* 第二行：搜索框 + 筛选按钮（跟在「更多菜单」下一行）。
       v20261027：flex-basis 用 calc(90% - 46px) —— 46px = 筛选按钮 32px + 间距 14px。
       平板宽度下一行能装下所有元素，basis:auto 不会换行，用大基数强制搜索框
       独占第二行；手机窄屏下搜索框自动收缩，保证筛选按钮始终与搜索框同行
       （第二行整体 ≈ 90% 宽度：搜索框占满 90%，剩余位置给筛选按钮）。 */
    .admin-header-content :deep(.search-card) {
        order: 4;
        flex: 1 1 calc(90% - 46px);
        min-width: 0;
        max-width: 90%;
    }

    .admin-header-content :deep(.search-card :deep(.el-input)) {
        width: 100%;
    }

    /*
     * v2.9.0：移动端顶行改为「搜索 筛选 刷新 回收站 更多」五个按钮紧挨、整组靠右：
     *   搜索按钮负责把整组推到右边（margin-left:auto），其余按钮只保留极小间距；
     *   搜索框展开时独占下面一行（order 4）。
     */
    .admin-header-content :deep(.search-area .mobile-search-trigger) {
        order: 1;
        flex: 0 0 auto;
        /* v3.0.0：五个按钮（搜索/筛选/刷新/回收站/更多）间距统一交给 .search-area 的 gap */
        margin-left: auto;
        margin-right: 0;
    }

    .admin-header-content :deep(.search-area .filter-trigger) {
        order: 1;
        flex: 0 0 auto;
        margin-left: 0;
        margin-right: 0;
    }

    /*
     * v3.0.0：按钮条的容器（搜索/筛选/标签管理/刷新/回收站/声音/链接格式）——
     * v3.0.0（R5）：在移动端它是 .admin-header-content 的直接 flex 子项
     * （.admin-header-tools / .admin-header-search 都是 display:contents），
     * 必须允许收缩（flex:1 1 auto + min-width:0）并在自身宽度内横向滑动，
     * 这样「页面切换」固定在左、「更多菜单」固定在右，中间条永不把更多菜单挤出屏幕。
     */
    .admin-header-content :deep(.search-actions) {
        flex: 1 1 auto;
        min-width: 0;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-x: contain;
        scrollbar-width: none;
    }
    .admin-header-content :deep(.search-actions)::-webkit-scrollbar {
        display: none;
    }
    .admin-header-actions {
        flex: 0 0 auto;
        margin-left: 0;
    }

    /*
     * v3.0.0（R5）：移动端顶行严格单行 —— 左侧「页面切换」、中间按钮条、右侧「更多菜单」
     * 必须同一行，中间按钮条在两者之间横向滑动，绝不换行。
     *   · 容器 nowrap，避免宽屏（平板竖屏）时被挤到第二行；
     *   · .admin-header-tools / .admin-header-search 允许收缩（min-width:0）并且不换行，
     *     否则中间条会被内容顶开；
     *   · 搜索框展开时改为绝对定位悬浮在顶栏下方（见 AdminDashBoard 的 .search-card 规则），
     *     不再挤在同一行里。
     */
    .admin-header-content {
        flex-wrap: nowrap;
    }

    .admin-header-tools {
        flex: 1 1 auto;
        min-width: 0;
        flex-wrap: nowrap;
        gap: 6px;
    }

    .admin-header-search {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
    }

    .admin-header-actions {
        flex: 0 0 auto;
    }

    .admin-header-content :deep(.search-area > *:not(.search-card):not(.search-actions):not(.tag-filter-badge):not(.refresh-files-btn):not(.dashboard-header-buttons):not(.filter-trigger):not(.mobile-search-trigger)) {
        order: 4;
        flex: 0 0 auto;
        margin-left: 8px;
    }

    /*
     * v2.8.8：后台文件管理顶栏「刷新 / 回收站 / 声音」整组靠右。
     * 之前这三个按钮和「更多菜单」之间没有任何推右元素（本页没有标签筛选按钮），
     * 移动端会挤在顶行中间。这里用 margin-left:auto 把整组连同其后的
     * 「更多菜单」一起顶到右侧，形成「…… 刷新 回收站 声音 更多」的右对齐排列。
     */
    .admin-header-content :deep(.search-area .dashboard-header-buttons) {
        order: 2;
        margin-left: 0;
        display: flex;
        align-items: center;
        /* v3.0.0：组内间距与外层 gap 一致（6px），整组「搜索/筛选/刷新/回收站/更多」间距处处相等 */
        gap: 6px;
    }

    /* 容器内已有 6px 间距，去掉按钮自带的 2px 左边距，避免桌面/移动端间距不一致 */
    .admin-header-content :deep(.dashboard-header-buttons .refresh-files-btn) {
        margin-left: 0;
    }

    .admin-header-tools {
        display: contents;
    }

    .admin-header-content :deep(.admin-header-actions) {
        order: 3;
        margin-left: 0;
        /* v2.8.0 #C16：去掉 margin-left:auto —— 整组靠右由搜索按钮的 auto 负责 */
    }

    /*
     * v3.0.0（R4）：顶栏几何值固定后，这里只保留「上滑隐藏」的位移过渡；
     * 不再关闭 transition，否则移动端/平板隐藏时会瞬移而桌面端是滑动，两端不一致。
     */
    .admin-header-content {
        --admin-header-gutter: 4px;
        width: calc(100% - 8px);
        transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .admin-header-content::before {
        transition: none;
    }
}

.admin-header-content {
    /*
     * v3.0.0（R4）：顶栏不再跟随滚动 —— 直接把原「滚动到底」时的几何参数写死：
     *   宽度内缩量 = clamp(12px, 2.5vw, 48px)，左右内边距 = clamp(12px, 1.5vw, 24px)，
     *   并去掉 width / padding 的过渡，静态呈现「略缩小 + 带边框 + 半透明背景」。
     */
    --admin-header-gutter: clamp(12px, 2.5vw, 48px);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
    min-height: 45px;
    padding: 10px clamp(12px, 1.5vw, 24px);
    position: fixed;
    top: 8px;
    left: 50%;
    width: calc(100% - var(--admin-header-gutter) * 2);
    z-index: 2001;
    border: 1px solid transparent;
    border-radius: 16px;
    transform: translateX(-50%);
    /* 仅保留「上滑隐藏 / 下滑显示」的位移过渡；宽度与内边距恒定，不做动画 */
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

/* 向下滚动时顶栏整体上滑隐藏（占位高度由 spacer 保留，内容不跳动） */
.admin-header-content.is-scroll-hidden {
    transform: translate(-50%, calc(-100% - 14px));
    pointer-events: none;
}

/* v3.0.0（R9 修复）：显隐动画进行中指针按下 → 立即跳到最终位置（见 snapHeaderNow） */
.admin-header-content.is-snap {
    transition: none !important;
}

/* 背景常显（不再随滚动淡入），文字、控件和下拉菜单始终保持清晰。 */
.admin-header-content::before {
    content: "";
    position: absolute;
    inset: -1px;
    z-index: -1;
    pointer-events: none;
    border: 1px solid var(--glass-border);
    border-radius: inherit;
    background: var(--glass-bg);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.08);
    backdrop-filter: blur(var(--glass-backdrop-blur)) saturate(1.4);
    -webkit-backdrop-filter: blur(var(--glass-backdrop-blur)) saturate(1.4);
    opacity: 1;
}

/*
 * v3.0.0（R11c）：页面滚动后（顶栏浮在内容上方）背框改为完全不透明 ——
 * 去掉玻璃半透明与背景模糊，避免下方文件/文字透出来干扰阅读；
 * 回到页面顶部后自动恢复玻璃质感。桌面端与移动端一致。
 */
.admin-header-content.is-solid::before {
    background: var(--toolbar-solid-bg, #FAFAFB);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
}

/* v2.8.5：紧凑顶栏的尺寸/换行参数覆盖手机与平板竖屏（≤1023） */
@media (max-width: 1023px) {
    .admin-header-content {
        /* v3.0.0（R4）：原「滚动到 1」时的内缩量 12px 固定下来 */
        --admin-header-gutter: 12px;
        --admin-header-action-size: 32px;
        --admin-header-action-font-size: 17px;
        --admin-header-action-gap: 4px;
        /* v3.0.0（R5）：顶行严格单行（页面切换 + 可滑动按钮条 + 更多菜单），
           搜索框展开时改为悬浮在顶栏下方，不再占第二行 */
        flex-wrap: nowrap;
        top: 6px;
        padding: 6px 8px;
        gap: 4px 6px;
        border-radius: 14px;
    }

    /* v3.0.0（R4）：背景常显，不再有「滚动前无 / 滚动后有」两态 */
    .admin-header-content::before {
        opacity: 1;
        transition: none;
    }
}

@media (max-width: 768px) {
    /*
     * v3.0.0（R4）：移动端改为与桌面端完全一致 —— 顶栏固定在顶部（fixed），
     * 向下滚动上滑隐藏、向上滚动立刻显示；不再随页面内容一起滚走。
     * 宽度/内边距沿用上面的固定值，不做任何几何动画。
     * v3.0.0（R6）：外框内边距收紧 —— 上下各 -3px（6 → 3），左右各 -6px（8 → 2）。
     */
    .admin-header-content {
        position: fixed;
        --admin-header-gutter: 4px;
        /* v1.0.8：移动端顶栏贴顶 —— 距屏幕顶部 2px（原 6px） */
        top: 2px;
        /* v3.0.0（R7）：内边距各减 2px（上下 3 → 1、左右 2 → 0），移动端顶栏更紧凑 */
        padding: 1px 0;
    }
}

@media (max-width: 360px) {
    .admin-header-content {
        --admin-header-action-size: 30px;
        --admin-header-action-gap: 2px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .admin-header-content,
    .admin-header-content::before {
        transition: none;
    }
}
</style>
