<template>
    <div class="tabs">
        <!--
            v3.0.0（R18）：恢复 origin 的下拉样式（当前页按钮 + 展开的背景板 + 悬停高亮条），
            不再使用居中弹窗。只重做了「点击命中」这一层：
              · 菜单项除了 click，还会在 pointerdown（按下的瞬间）就执行跳转 ——
                页面里跑长任务 / 长时间停留后，EP 弹层、列表重渲染可能让
                「按下」与「抬起」之间元素被替换，浏览器就不会再派发 click，
                表现就是「怎么点都没反应」。pointerdown 不受影响。
              · 跳转带 4 秒兜底：路由 push 迟迟不生效就直接 location.assign。
        -->
        <div
            class="page-switcher"
            :class="{ 'is-open': isPageMenuOpen }"
            :style="{ '--page-menu-count': inactivePageOptions.length }"
            role="navigation"
            @click.stop
            @pointerdown.stop
        >
            <div class="page-switcher-sheet" role="menu" @click.stop>
                <button
                    class="page-option is-current"
                    type="button"
                    role="menuitem"
                    aria-current="page"
                    :aria-expanded="isPageMenuOpen"
                    @click.stop="togglePageMenu"
                >
                    <font-awesome-icon :icon="activePageOption.icon" class="page-option-icon"></font-awesome-icon>
                    <span class="page-switcher-title">{{ $t(activePageOption.label) }}</span>
                    <font-awesome-icon
                        icon="chevron-down"
                        class="page-switcher-arrow"
                    ></font-awesome-icon>
                </button>
                <div
                    class="page-option-list"
                    @mouseleave="clearHoveredPageOption"
                    @pointerdown="handleListPointerDown"
                >
                    <span
                        class="page-option-highlight"
                        :class="{ 'is-visible': isPageOptionHighlightVisible }"
                        :style="{ '--hovered-option-index': hoveredPageOptionIndex }"
                        aria-hidden="true"
                    ></span>
                    <button
                        v-for="(option, index) in inactivePageOptions"
                        :key="option.name"
                        class="page-option"
                        type="button"
                        role="menuitem"
                        :data-page="option.name"
                        @mouseenter="setHoveredPageOption(index)"
                        @click.stop="handlePageOptionClick(option.name)"
                    >
                        <font-awesome-icon :icon="option.icon" class="page-option-icon"></font-awesome-icon>
                        <span class="page-switcher-title">{{ $t(option.label) }}</span>
                    </button>
                    <!--
                        附加条目插槽：文件管理页用它注入「切换实例」。
                        原来靠 <Teleport defer to=".page-option-list"> 追加，现在改成插槽，
                        样式仍是下拉里的一条 .page-option，视觉与旧版一致。
                    -->
                    <slot name="extra-item" :close="closePageMenu"></slot>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';

export default {
    name: 'DashboardTabs',
    props: {
        activeTab: {
            type: String,
            default: 'dashboard'
        }
    },
    data() {
        return {
            isPageMenuOpen: false,
            hoveredPageOptionIndex: 0,
            isPageOptionHighlightVisible: false,
            // v3.0.0：本地文件页只对「管理员 + 被授权该渠道的普通用户」可见，
            // 可见性以后端 /api/localfiles/channels 的实际返回为准（返回空 = 无权/无渠道）
            hasLocalFiles: false
        }
    },
    mounted() {
        this.hoverCloseTimer = null;
        document.addEventListener('click', this.handleDocumentClick);
        document.addEventListener('keydown', this.handleKeydown);
        this.loadLocalFilesAccess();
    },
    watch: {
        /** 路由切换后（含浏览器前进后退）菜单必须自动收起 */
        activeTab() {
            this.closePageMenu();
        },
    },
    computed: {
        isAdminRole() {
            return this.$store.getters.isAdminRole === true;
        },
        pageOptions() {
            // 「文件管理 / 用户管理 / 文件上传」对所有登录账户可见；
            // 「用户管理」普通用户也能进 —— 但页内只显示自己的账户并能改密码，
            // 创建用户 / 权限开关 / 主备渠道 / 归集统计 / 删除均仅管理员可见。
            // 「系统管理」仅管理员可见。
            const base = [
                { name: 'dashboard', icon: 'images', label: 'dashboardTabs.fileManagement' },
                // v1.1.1：笔记管理（「瞬间」便签式笔记）—— 排在「文件管理」之后
                { name: 'notes', icon: 'note-sticky', label: 'dashboardTabs.notesManagement' },
            ];
            // 「本地文件」页：管理员恒显示（页面内会提示「还没有本地文件渠道」）；
            // 普通用户仅在存在被授权的本地文件渠道时显示
            if (this.isAdminRole || this.hasLocalFiles) {
                base.push({ name: 'localFiles', icon: 'folder-tree', label: 'dashboardTabs.localFiles' });
            }
            base.push({ name: 'customerConfig', icon: 'user-cog', label: 'dashboardTabs.userManagement' });
            if (this.isAdminRole) {
                base.push({ name: 'systemConfig', icon: 'cogs', label: 'dashboardTabs.systemSettings' });
            }
            base.push({ name: '', icon: 'upload', label: 'dashboardTabs.fileUpload' });
            return base;
        },
        activePageOption() {
            return this.pageOptions.find(option => option.name === this.activeTab) || this.pageOptions[0];
        },
        inactivePageOptions() {
            return this.pageOptions.filter(option => option.name !== this.activePageOption.name);
        }
    },
    methods: {
        /** 探测本地文件页可见性：接口只返回当前账户可见且已启用的渠道 */
        async loadLocalFilesAccess() {
            try {
                const res = await fetchWithAuth('/api/localfiles/channels');
                const json = await res.json().catch(() => ({}));
                const list = json && json.success && Array.isArray(json.data) ? json.data : [];
                this.hasLocalFiles = list.length > 0;
            } catch (e) {
                this.hasLocalFiles = false;
            }
        },
        handleDocumentClick(event) {
            if (this.$el?.contains(event.target)) {
                return;
            }
            this.closePageMenu();
        },
        handleKeydown(event) {
            if (event.key === 'Escape' && this.isPageMenuOpen) {
                this.closePageMenu();
            }
        },
        /**
         * 菜单项「按下即跳转」（v3.0.0 R18）。
         *
         * 老问题的成因：click 需要「按下」和「抬起」落在同一个元素上才会派发。
         * 后台顶栏会随筛选 / 批量操作 / 图片加载不断重渲染，页面跑长任务时
         * 主线程还会被占住 —— 这期间元素被替换或事件被丢掉，click 就永远不来了，
         * 表现就是「下拉里怎么点都没反应，只有切换实例（另一个弹窗）有反应」。
         * pointerdown 在按下的那一帧就派发，不受后续重渲染影响。
         */
        handleListPointerDown(event) {
            // 只处理主键 / 触摸
            if (event && typeof event.button === 'number' && event.button !== 0) return;
            const target = event && event.target;
            const item = target && target.closest ? target.closest('.page-option[data-page]') : null;
            if (!item) return;
            event.preventDefault();
            event.stopPropagation();
            this.navigateToPage(item.getAttribute('data-page'));
        },
        /** 点击兜底（键盘 Enter / 空格、以及设备不派发 pointerdown 的极端情况） */
        handlePageOptionClick(tab) {
            this.navigateToPage(tab);
        },
        navigateToPage(tab) {
            const now = Date.now();
            // pointerdown 与 click 会先后触发同一目标，这里做去重
            if (this._navAt && now - this._navAt < 900 && this._navTarget === tab) return;
            this._navAt = now;
            this._navTarget = tab;

            const target = tab ? `/${tab}` : '/';
            this.closePageMenu();
            if (this.$route.path === target) return;
            this.setHoveredPageOption(0);

            // 兜底：路由 push 4 秒内既没成功也没让路径变化 → 整页跳转，保证「点了就一定换页」
            let settled = false;
            const fallback = window.setTimeout(() => {
                if (settled) return;
                if (this.$route.path === target) return;
                window.location.assign(target);
            }, 4000);
            const done = () => {
                settled = true;
                window.clearTimeout(fallback);
            };
            this.$router.push(target).then(done).catch(() => {
                done();
                if (this.$route.path !== target) window.location.assign(target);
            });
        },
        setHoveredPageOption(index) {
            this.hoveredPageOptionIndex = index;
            this.isPageOptionHighlightVisible = true;
        },
        clearHoveredPageOption() {
            this.isPageOptionHighlightVisible = false;
        },
        openPageMenu() {
            this.isPageMenuOpen = true;
        },
        togglePageMenu() {
            this.isPageMenuOpen = !this.isPageMenuOpen;
            if (!this.isPageMenuOpen) this.clearHoveredPageOption();
        },
        cancelHoverClose() {
            if (this.hoverCloseTimer) {
                clearTimeout(this.hoverCloseTimer);
                this.hoverCloseTimer = null;
            }
        },
        closePageMenu() {
            this.cancelHoverClose();
            this.isPageMenuOpen = false;
            this.clearHoveredPageOption();
        }
    },
    beforeUnmount() {
        this.cancelHoverClose();
        document.removeEventListener('click', this.handleDocumentClick);
        document.removeEventListener('keydown', this.handleKeydown);
    }
}
</script>

<style scoped>
.tabs {
    --page-option-height: 37px;
    --page-option-font-size: 15px;
    --page-current-height: 37px;
    --page-current-font-size: 1.1em;
    --page-sheet-padding: 4px;
    --page-menu-top: calc(var(--page-current-height) + var(--page-sheet-padding) * 2);
    display: flex;
    align-items: center;
    justify-content: center;
}

.page-switcher {
    position: relative;
    display: flex;
    align-items: center;
    height: 44px;
    overflow: visible;
}

/* 菜单展开时必须压住顶栏其它按钮 / 页面内容，否则点击会落到下面那层 */
.page-switcher.is-open {
    z-index: 1200;
}

.page-switcher-sheet {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    padding: var(--page-sheet-padding);
    border: 1px solid transparent;
    border-radius: 14px;
    box-sizing: border-box;
    background-color: transparent;
    overflow: visible;
}

.page-switcher-sheet::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 0;
    height: calc(var(--page-menu-top) + var(--page-menu-count) * var(--page-option-height) + var(--page-sheet-padding));
    border: 1px solid var(--tabs-switcher-border-color);
    border-radius: 14px;
    background: var(--tabs-dropdown-popper-bg-color);
    box-shadow: var(--tabs-dropdown-popper-shadow);
    opacity: 0;
    transform: translateY(-4px) scaleY(0.72);
    transform-origin: top center;
    pointer-events: none;
    transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
    will-change: opacity, transform;
}

.page-switcher.is-open .page-switcher-sheet::before {
    opacity: 1;
    transform: translateY(0) scaleY(1);
    pointer-events: auto;
}

.page-switcher-title {
    line-height: 1;
}

.page-switcher-arrow {
    margin-left: auto;
    font-size: 0.75em;
    color: var(--tabs-switcher-accent-color);
    transition: transform 0.3s ease;
}

.page-switcher.is-open .page-switcher-arrow {
    transform: rotate(180deg);
}

.page-option {
    position: relative;
    z-index: 1;
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    box-sizing: border-box;
    gap: 7px;
    width: 100%;
    min-width: 148px;
    height: var(--page-option-height);
    padding: 0 12px;
    border: none;
    border-radius: 10px;
    color: var(--admin-container-color);
    background: transparent;
    font-size: var(--page-option-font-size);
    font-weight: 600;
    font-family: inherit;
    white-space: nowrap;
    cursor: pointer;
    /* 触屏上避免 300ms 双指缩放等待，按下即刻响应 */
    touch-action: manipulation;
}

.page-option-list {
    position: absolute;
    top: var(--page-menu-top);
    left: calc(var(--page-sheet-padding) + 1px);
    right: calc(var(--page-sheet-padding) + 1px);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-9px) scaleY(0.86);
    transform-origin: top center;
    transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}

.page-option-list .page-option {
    position: relative;
    z-index: 1;
    width: 100%;
}

.page-option-highlight {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 0;
    height: var(--page-option-height);
    border-radius: 10px;
    background: var(--tabs-switcher-hover-bg);
    opacity: 0;
    pointer-events: none;
    transform: translateY(calc(var(--hovered-option-index) * var(--page-option-height)));
    transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}

.page-option-highlight.is-visible {
    opacity: 1;
}

.page-switcher.is-open .page-option-list {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0) scaleY(1);
}

.page-option.is-current {
    height: var(--page-current-height);
    gap: 8px;
    padding: 0 14px;
    color: var(--tabs-switcher-current-color);
    background: var(--tabs-switcher-current-bg);
    border: 1px solid var(--tabs-switcher-current-border-color);
    box-shadow: none;
    font-size: var(--page-current-font-size);
    font-weight: bold;
    line-height: 1.15;
}

.page-option.is-current > .page-option-icon {
    width: 17px;
    font-size: 1.05em;
}

.page-option.is-current > .page-option-icon,
.page-option.is-current > .page-switcher-title,
.page-option.is-current > .page-switcher-arrow {
    translate: 0 1px;
}

.page-option:hover {
    color: var(--tabs-switcher-accent-color);
    background-color: transparent;
}

.page-option.is-current:hover {
    color: var(--tabs-switcher-current-color);
    background: var(--tabs-switcher-current-bg);
}

.page-option-icon {
    width: 16px;
    color: var(--tabs-switcher-accent-color);
}

/* 移动端适配 */
@media (max-width: 768px) {
    .tabs {
        --page-option-height: 32px;
        --page-option-font-size: 12px;
        --page-current-height: 32px;
        --page-current-font-size: 14px;
    }

    .page-switcher-title {
        max-width: 4.8em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .page-switcher-sheet {
        width: max-content;
        max-width: calc(100vw - 96px);
    }

    .page-switcher-sheet::before {
        transform: translateY(-3px) scaleY(0.72);
    }

    .page-option {
        justify-content: flex-start;
        min-width: 0;
        padding: 0 10px;
        gap: 6px;
    }

    .page-option-icon {
        width: 15px;
    }

    .page-option-list {
        transform: translateY(-8px) scaleY(0.86);
    }

    .page-option.is-current {
        gap: 5px;
        padding: 0 10px;
    }

    .page-option.is-current > .page-option-icon {
        width: 16px;
    }

    .page-option.is-current > .page-switcher-arrow {
        margin-left: 4px;
    }
}

@media (max-width: 360px) {
    .page-switcher-title {
        max-width: 4em;
    }
}

@media (prefers-reduced-motion: reduce) {
    .page-switcher-sheet::before,
    .page-option-list,
    .page-option-highlight {
        transition: none;
    }
}
</style>
