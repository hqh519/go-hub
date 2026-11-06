<template>
<div class="sidebar-container" ref="sidebar" :class="{ 'is-collapsed': isCollapse, 'is-mobile-open': mobileOpen }" :style="sidebarStyle">
    <div class="menu-list">
        <div
            v-for="item in menuItems"
            :key="item.index"
            class="menu-item"
            :class="{ 'is-active': activeIndex === item.index }"
            @click="handleSelect(item.index)"
        >
            <span class="menu-icon">
                <font-awesome-icon :icon="item.icon" class="menu-glyph" />
            </span>
            <span class="menu-text">{{ $t(item.titleKey) }}</span>
        </div>
    </div>

    <div class="toggle-button" @click="toggleCollapse">
        <font-awesome-icon :icon="isCollapse ? 'angle-double-right' : 'angle-double-left'"></font-awesome-icon>
    </div>
</div>

<!--
    v2.5.0（v20261023-2）：移动端边缘小按钮 ——
    导航条默认整体藏在屏幕外，屏幕左缘只露 15px 宽的小按钮（垂直居中）；
    点击小按钮 → 导航条滑入；点击屏幕任意位置 / 滚动页面 → 导航条收回。
    小按钮自身：默认显示；页面上滚（往深处看）时隐藏、下滚（往回看）时显示（页面顶部恒显示）。
-->
<button
    v-if="isMobileViewport"
    type="button"
    class="mobile-edge-handle"
    :class="{ 'is-hidden': handleHidden || mobileOpen }"
    :aria-label="$t('sysConfigTabs.systemStatus')"
    @click.stop="openMobileNav"
>
    <font-awesome-icon icon="angle-double-right" class="edge-handle-icon"></font-awesome-icon>
</button>
</template>

<script>
export default {
name: 'SysConfigTabs',
props: {
    activeIndex: {
        type: String,
        default: 'status'
    },
    isCollapse: {
        type: Boolean,
        default: false
    }
},
data() {
    return {
        expandedWidth: null,
        isMobileViewport: false,
        // v2.5.0：移动端导航条展开态（默认收起到屏幕外）
        mobileOpen: false,
        // v2.5.0：移动端边缘小按钮隐藏态（上滚隐藏、下滚显示，页面顶部恒显示）
        handleHidden: false,
        lastScrollY: 0,
        menuItems: [
            { index: 'status', icon: 'chart-bar', titleKey: 'sysConfigTabs.systemStatus' },
            { index: 'upload', icon: 'cloud-upload', titleKey: 'sysConfigTabs.uploadSettings' },
            { index: 'security', icon: 'shield', titleKey: 'sysConfigTabs.securitySettings' },
            { index: 'page', icon: 'pager', titleKey: 'sysConfigTabs.pageSettings' },
            { index: 'others', icon: 'cog', titleKey: 'sysConfigTabs.otherSettings' },
            { index: 'logs', icon: 'list', titleKey: 'sysConfigTabs.systemLogs' }
        ]
    };
},
computed: {
    collapsedWidth() {
        return window.innerWidth <= 768 ? 50 : 56;
    },
    sidebarStyle() {
        if (this.isCollapse) {
            return { width: this.collapsedWidth + 'px' };
        }
        return this.expandedWidth ? { width: this.expandedWidth + 'px' } : {};
    }
},
watch: {
    '$i18n.locale'() {
        this.$nextTick(() => this.measureWidth());
    },
    mobileOpen(val) {
        // 展开期间绑定「点击任意处关闭」；收起时解绑
        if (val) {
            document.addEventListener('pointerdown', this.onDocPointerDown, true);
        } else {
            document.removeEventListener('pointerdown', this.onDocPointerDown, true);
        }
    }
},
methods: {
    toggleCollapse() {
        this.$emit('update:isCollapse', !this.isCollapse);
    },
    checkMobile() {
        // ≤768（手机/手机横屏）：折叠侧边栏，只留图标
        // 769–1023（平板竖屏/小平板）：内容区过窄，同样默认折叠以让出约 100px
        const isNarrow = window.innerWidth <= 1023;
        this.$emit('update:isCollapse', isNarrow);
        this.isMobileViewport = window.innerWidth <= 768;
        if (!this.isMobileViewport) {
            this.mobileOpen = false;
            this.handleHidden = false;
        }
    },
    /** v2.5.0：移动端点边缘小按钮 → 导航条滑入 */
    openMobileNav() {
        this.mobileOpen = true;
    },
    /** v2.5.0：导航条展开期间，点击屏幕任意位置（导航条之外）→ 收回 */
    onDocPointerDown(e) {
        const sidebar = this.$refs.sidebar;
        if (sidebar && (sidebar === e.target || sidebar.contains(e.target))) return;
        this.mobileOpen = false;
    },
    handleSelect(index) {
        this.$emit('update:activeIndex', index);
        // 移动端：选中后立即收回导航条
        if (this.isMobileViewport) this.mobileOpen = false;
    },
    handlePageScroll() {
        if (window.innerWidth > 768) {
            this.handleHidden = false;
            this.lastScrollY = window.scrollY;
            return;
        }
        const y = window.scrollY;
        const delta = y - this.lastScrollY;
        // 滚动页面 → 导航条收回
        if (this.mobileOpen && Math.abs(delta) >= 2) this.mobileOpen = false;
        // v2.6.0：边缘小按钮方向修正 —— 页面上滚（往深处看，delta>0）→ 隐藏；下滚（往回看，delta<0）→ 显示；页面顶部恒显示
        if (Math.abs(delta) >= 2 || y <= 40) {
            this.handleHidden = !(y <= 40 || delta < 0);
        }
        this.lastScrollY = y;
    },
    measureWidth() {
        const el = this.$refs.sidebar;
        if (!el) return;
        // Temporarily expand to measure natural content width
        const prevWidth = el.style.width;
        const prevTransition = el.style.transition;
        const wasCollapsed = el.classList.contains('is-collapsed');
        el.style.transition = 'none';
        if (wasCollapsed) {
            el.classList.remove('is-collapsed');
        }
        el.style.width = 'auto';
        // Force reflow to apply changes
        void el.offsetWidth;
        const natural = el.scrollWidth;
        // Restore original state
        el.style.width = prevWidth;
        if (wasCollapsed) {
            el.classList.add('is-collapsed');
        }
        void el.offsetWidth;
        el.style.transition = prevTransition;
        this.expandedWidth = natural;
    },
},
mounted() {
    this.checkMobile();
    this.$nextTick(() => this.measureWidth());
    window.addEventListener('resize', this.checkMobile);
    window.addEventListener('scroll', this.handlePageScroll, { passive: true });
},
beforeUnmount() {
    window.removeEventListener('resize', this.checkMobile);
    window.removeEventListener('scroll', this.handlePageScroll);
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
}
};
</script>

<style scoped>
.sidebar-container {
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 50%;
    left: 8px;
    transform: translateY(-50%);
    z-index: 2001;
    max-width: 200px;
    /* macOS 风格毛玻璃效果 */
    background: var(--glass-bg);
    backdrop-filter: blur(12px) saturate(1.4);
    -webkit-backdrop-filter: blur(12px) saturate(1.4);
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    box-shadow: none;
    transition: width 0.3s ease, box-shadow 0.3s ease, transform 0.28s ease;
    overflow: hidden;
}

/* 移动端滚动显隐（v2.5.0 起由 .is-mobile-open / 边缘小按钮机制取代） */
.sidebar-container.is-collapsed {
    width: 56px;
}

.menu-list {
    padding: 8px;
}

.menu-item {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 0 12px 0 0;
    height: 42px;
    box-sizing: border-box;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease;
    color: var(--admin-container-color, #333);
    gap: 0;
    overflow: hidden;
}

.menu-item:hover {
    background: color-mix(in srgb, var(--el-text-color-primary) 6%, transparent);
}

html.dark .menu-item:hover {
    background: color-mix(in srgb, var(--el-text-color-primary) 10%, transparent);
}

.menu-item.is-active {
    background: color-mix(in srgb, var(--primary-color) 20%, transparent);
    color: var(--primary-color);
}

html.dark .menu-item.is-active {
    background: color-mix(in srgb, var(--primary-color) 30%, transparent);
    color: var(--el-text-color-primary);
}

.menu-icon {
    display: grid;
    place-items: center;
    width: 40px;
    min-width: 40px;
    height: 20px;
    font-size: 16px;
    flex-shrink: 0;
    line-height: 1;
}

.menu-icon > .menu-glyph {
    display: block;
    width: 16px;
    height: 16px;
}

.menu-text {
    display: flex;
    align-items: center;
    height: 20px;
    line-height: 20px;
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    opacity: 1;
    transition: opacity 0.2s ease 0.05s, max-width 0.25s ease;
}

.sidebar-container.is-collapsed .menu-text {
    opacity: 0;
    max-width: 0;
    transition: opacity 0.1s ease, max-width 0.2s ease;
}

/* 收起态：图标在剩余空间内严格居中，保证图标左右间距一致 */
.sidebar-container.is-collapsed .menu-item {
    justify-content: center;
    padding: 0;
}

.sidebar-container.is-collapsed .menu-icon {
    width: 32px;
    min-width: 32px;
}

.toggle-button {
    padding: 12px;
    text-align: center;
    cursor: pointer;
    border-top: 1px solid color-mix(in srgb, var(--el-text-color-primary) 8%, transparent);
    transition: all 0.2s ease;
    color: var(--admin-container-color, #333);
}

html.dark .toggle-button {
    border-top: 1px solid color-mix(in srgb, var(--el-text-color-primary) 8%, transparent);
}

.toggle-button:hover {
    background: color-mix(in srgb, var(--el-text-color-primary) 10%, transparent);
}

html.dark .toggle-button:hover {
    background: color-mix(in srgb, var(--el-text-color-primary) 6%, transparent);
}

/* 移动端：默认整体滑出屏幕外（.is-mobile-open 时滑入），由边缘小按钮唤起 */
@media (max-width: 768px) {
    .sidebar-container {
        left: 2px;
        max-width: 150px;
        border-radius: 12px;
        transform: translateY(-50%) translateX(calc(-100% - 24px));
        pointer-events: none;
    }

    .sidebar-container.is-mobile-open {
        transform: translateY(-50%) translateX(0);
        pointer-events: auto;
    }

    /* 展开时强制显示文字（忽略折叠态），并用自然宽度 */
    .sidebar-container.is-mobile-open {
        width: auto !important;
        max-width: 160px;
    }

    .sidebar-container.is-mobile-open .menu-text {
        opacity: 1;
        max-width: 120px;
    }

    .sidebar-container.is-mobile-open .menu-item {
        justify-content: flex-start;
        padding: 0 10px 0 0;
    }

    .sidebar-container.is-mobile-open .menu-icon {
        width: 30px;
        min-width: 30px;
    }

    /* 折叠按钮在移动端无意义（导航条由小按钮唤起/自动收回） */
    .toggle-button {
        display: none;
    }
}

/* ── 移动端边缘小按钮：贴屏幕左缘，露 15px 宽，垂直居中 ───────────── */
.mobile-edge-handle {
    display: none;
}

@media (max-width: 768px) {
    .mobile-edge-handle {
        display: flex;
        align-items: center;
        justify-content: center;
        position: fixed;
        top: 50%;
        left: 0;
        width: 15px;
        height: 64px;
        padding: 0;
        transform: translateY(-50%);
        z-index: 2002;
        border: 1px solid var(--glass-border);
        border-left: none;
        border-radius: 0 10px 10px 0;
        background: var(--glass-bg);
        backdrop-filter: blur(12px) saturate(1.4);
        -webkit-backdrop-filter: blur(12px) saturate(1.4);
        color: var(--admin-container-color, #333);
        cursor: pointer;
        transition: transform 0.25s ease, opacity 0.25s ease;
    }

    .mobile-edge-handle .edge-handle-icon {
        font-size: 10px;
    }

    /* 上滚隐藏（或导航条展开期间） */
    .mobile-edge-handle.is-hidden {
        transform: translateY(-50%) translateX(-110%);
        opacity: 0;
        pointer-events: none;
    }
}
</style>
