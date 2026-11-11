<template>
    <div class="admin-header-actions">
        <!-- v2.6.0 #302：移动端收纳为单个「更多菜单」（白天黑夜 / 语言 / 链接格式 / 退出登录） -->
        <template v-if="isMobile">
            <!-- v1.1.4：移动端展开后「页面一滚动就自动收起」（见 utils/scrollDismiss.js） -->
            <el-dropdown
                ref="mobileMore"
                trigger="click"
                popper-class="admin-more-menu-popper"
                @command="handleMoreCommand"
                @visible-change="(v) => onMoreVisibleChange(v, 'mobile')"
            >
                <button class="admin-header-control" type="button" :aria-label="$t('login.moreMenu')">
                    <font-awesome-icon icon="ellipsis-v" />
                </button>
                <template #dropdown>
                    <div class="el-dropdown-menu modern-dropdown-menu admin-more-menu" role="group" :aria-label="$t('login.moreMenu')">
                        <!--
                            v3.0.0（R5）：「标签管理」「声音切换」是文件管理页专用项，
                            其它页面不再渲染（文件管理页本身已改成顶栏图标按钮，inline-actions=true）。
                        -->
                        <button type="button" class="el-dropdown-menu__item" @click="handleMoreCommand('theme')">
                            <font-awesome-icon :icon="themeIcon" class="admin-more-menu-ico" />
                            <span>{{ themeText }}</span>
                        </button>
                        <!-- v3.0.0（R5）：原「声音切换」菜单项已移除（文件管理页用顶栏图标按钮，其它页不需要） -->
                        <button type="button" class="el-dropdown-menu__item" @click="handleMoreCommand('lang')">
                            <font-awesome-icon icon="globe" class="admin-more-menu-ico" />
                            <span>{{ langText }}</span>
                        </button>
                        <!-- v1.0.5：语言切换后面依次是「我的账户」「系统管理」（仅管理员） -->
                        <button type="button" class="el-dropdown-menu__item" @click="handleMoreCommand('account')">
                            <font-awesome-icon icon="user" class="admin-more-menu-ico" />
                            <span>{{ $t('dashboard.myAccount') }}</span>
                        </button>
                        <button v-if="isAdmin" type="button" class="el-dropdown-menu__item" @click="handleMoreCommand('system')">
                            <font-awesome-icon icon="cogs" class="admin-more-menu-ico" />
                            <span>{{ $t('dashboard.systemManage') }}</span>
                        </button>
                        <button v-if="showLinkFormat" type="button" class="el-dropdown-menu__item" @click="handleMoreCommand('link')">
                            <font-awesome-icon icon="link" class="admin-more-menu-ico" />
                            <span>{{ $t('dashboard.linkFormat') }}</span>
                        </button>
                        <div class="admin-more-menu-sep"></div>
                        <button type="button" class="el-dropdown-menu__item is-logout" @click="handleMoreCommand('logout')">
                            <font-awesome-icon icon="sign-out-alt" class="admin-more-menu-ico" />
                            <span>{{ $t('dashboard.logout') }}</span>
                        </button>
                    </div>
                </template>
            </el-dropdown>
        </template>
        <!-- 桌面端：链接格式（可选）+ 主题切换 + 「更多菜单」（语言切换 / 退出登录，文字条目） -->
        <template v-else>
            <el-tooltip v-if="showLinkFormat" :disabled="disableTooltip" :content="$t('dashboard.linkFormat')" placement="bottom" :show-after="1000">
                <button class="admin-header-control" type="button" :aria-label="$t('dashboard.linkFormat')" @click="$emit('link-format')">
                    <font-awesome-icon icon="link" />
                </button>
            </el-tooltip>
            <AdminToggleDark class="admin-header-control" />
            <!--
                v3.0.0（R5）：桌面端末尾新增「更多菜单」（复刻首页右上角同款）——
                「语言切换」「退出登录」以文字条目收进菜单，工具栏不再各占一个图标位。
            -->
            <el-dropdown
                ref="desktopMore"
                trigger="click"
                popper-class="admin-more-menu-popper"
                @command="handleMoreCommand"
                @visible-change="(v) => onMoreVisibleChange(v, 'desktop')"
            >
                <button class="admin-header-control" type="button" :aria-label="$t('login.moreMenu')">
                    <font-awesome-icon icon="ellipsis-v" />
                </button>
                <template #dropdown>
                    <div class="el-dropdown-menu modern-dropdown-menu admin-more-menu" role="group" :aria-label="$t('login.moreMenu')">
                        <button type="button" class="el-dropdown-menu__item admin-more-menu-text" @click="handleMoreCommand('lang')">
                            <span>{{ langText }}</span>
                        </button>
                        <button type="button" class="el-dropdown-menu__item admin-more-menu-text" @click="handleMoreCommand('account')">
                            <span>{{ $t('dashboard.myAccount') }}</span>
                        </button>
                        <button v-if="isAdmin" type="button" class="el-dropdown-menu__item admin-more-menu-text" @click="handleMoreCommand('system')">
                            <span>{{ $t('dashboard.systemManage') }}</span>
                        </button>
                        <div class="admin-more-menu-sep"></div>
                        <button type="button" class="el-dropdown-menu__item is-logout admin-more-menu-text" @click="handleMoreCommand('logout')">
                            <span>{{ $t('dashboard.logout') }}</span>
                        </button>
                    </div>
                </template>
            </el-dropdown>
        </template>
    </div>
</template>

<script>
import AdminToggleDark from './AdminToggleDark.vue';
import { setLocale } from '@/locales';
import { writeThemeCookie } from '@/utils/themeCookie';
import { bindScrollDismiss } from '@/utils/scrollDismiss';

export default {
    name: 'AdminHeaderActions',
    components: { AdminToggleDark },
    props: {
        showLinkFormat: Boolean,
        disableTooltip: Boolean,
        // v2.6.0 #302：移动端把四个按钮收进「更多菜单」
        isMobile: Boolean,
        // v3.0.0：页面工具栏里已有「标签管理 / 声音切换 / 链接格式」图标按钮 → 更多菜单不再重复
        inlineActions: Boolean
    },
    // v3.0.0：移动端更多菜单里的「标签管理」转发给文件管理页
    emits: ['link-format', 'logout', 'tag-management'],
    computed: {
        /** v1.0.5：「系统管理」菜单项仅管理员可见 */
        isAdmin() {
            return this.$store.getters.isAdminRole === true;
        },
        /** 主题三态：auto（跟随系统）/ light / dark */
        themeMode() {
            if (!this.$store.getters.cusDarkMode) return 'auto';
            return this.$store.getters.useDarkMode ? 'dark' : 'light';
        },
        themeIcon() {
            // 显示下一个模式的图标（与登录页更多菜单一致）
            if (this.themeMode === 'auto') return 'sun';
            if (this.themeMode === 'light') return 'moon';
            return 'adjust';
        },
        themeText() {
            if (this.themeMode === 'auto') return this.$t('theme.lightMode');
            if (this.themeMode === 'light') return this.$t('theme.darkMode');
            return this.$t('theme.autoMode');
        },
        langText() {
            return this.$i18n.locale === 'zh-CN' ? 'English' : '中文';
        },
        /* v3.0.0（R14）：声音开关迁到文件详情页（下载按钮后面），移动端更多菜单不再提供该项 */
    },
    methods: {
        /**
         * v1.1.4：右上角「更多菜单」展开后，页面一滚动（含手指拖动）就收起。
         * 移动端与桌面端是两个 el-dropdown 实例，各自绑定、各自解绑。
         */
        onMoreVisibleChange(open, which) {
            if (open) {
                if (this._moreUnbind) return;
                this._moreUnbind = bindScrollDismiss(() => {
                    const dd = this.$refs[which === 'mobile' ? 'mobileMore' : 'desktopMore'];
                    if (dd && typeof dd.handleClose === 'function') dd.handleClose();
                });
            } else {
                this.releaseMoreDismiss();
            }
        },
        releaseMoreDismiss() {
            if (this._moreUnbind) {
                this._moreUnbind();
                this._moreUnbind = null;
            }
        },
        handleMoreCommand(cmd) {
            if (cmd === 'theme') {
                // 与 AdminToggleDark 相同的三态循环：亮色 -> 暗色 -> 跟随系统
                if (!this.$store.getters.cusDarkMode) {
                    this.$store.commit('setCusDarkMode', true);
                    this.$store.commit('setUseDarkMode', false);
                    writeThemeCookie('light');
                } else if (!this.$store.getters.useDarkMode) {
                    this.$store.commit('setCusDarkMode', true);
                    this.$store.commit('setUseDarkMode', true);
                    writeThemeCookie('dark');
                } else {
                    this.$store.commit('setCusDarkMode', false);
                    writeThemeCookie('auto');
                }
                return;
            }
            if (cmd === 'lang') {
                setLocale(this.$i18n.locale === 'zh-CN' ? 'en' : 'zh-CN');
                return;
            }
            if (cmd === 'account') {
                // v1.0.5：「我的账户」→ 新标签页打开个性化设置，不打断当前管理页
                const url = this.$router.resolve({ name: 'customerConfig' }).href;
                window.open(url, '_blank', 'noopener');
                return;
            }
            if (cmd === 'system') {
                // v1.0.5：「系统管理」→ 新标签页直接落在「系统状态」分区
                const url = this.$router.resolve({ name: 'systemConfig', hash: '#status' }).href;
                window.open(url, '_blank', 'noopener');
                return;
            }
            if (cmd === 'tagManage') {
                // v3.0.0：移动端更多菜单 → 标签管理模式（与 PC 工具栏按钮同一入口）
                this.$emit('tag-management');
                return;
            }
            if (cmd === 'link') {
                this.$emit('link-format');
                return;
            }
            if (cmd === 'logout') {
                this.$emit('logout');
            }
        }
    },
    beforeUnmount() {
        // v1.1.4：卸载时一定要解绑，否则滚动监听会留在 window 上越积越多
        this.releaseMoreDismiss();
    }
};
</script>

<style scoped>
.admin-header-actions {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    /* v3.0.0：与工具栏按钮间距统一为 6px（原来 8px，和 .search-area 的 6px 不一致） */
    gap: var(--admin-header-action-gap, 6px);
}

.admin-header-control,
.admin-header-actions :deep(#themeToggle) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    box-sizing: border-box;
    width: var(--admin-header-action-size, 32px);
    height: var(--admin-header-action-size, 32px);
    padding: 0;
    border: 0;
    /* v3.0.0：圆角与工具栏按钮（筛选/刷新/回收站…）一致 */
    border-radius: 8px;
    color: var(--admin-theme-toggle-color);
    background: transparent !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    font-size: var(--admin-header-action-font-size, 20px);
    cursor: pointer;
    transition: color 0.2s ease;
    --lang-icon-size: 1em;
    --lang-icon-color: currentColor;
}

.admin-header-control:hover {
    color: var(--primary-color-accent);
}

.admin-header-control:focus-visible {
    outline: 2px solid var(--primary-color-accent);
    outline-offset: 2px;
}

.admin-header-actions :deep(.theme_toggle_svg),
.admin-header-actions :deep(.auto-icon) {
    width: 1em;
    height: 1em;
    font-size: inherit !important;
}

/* v2.6.0 #302：更多菜单条目 */
.admin-more-menu {
    min-width: 140px;
}

.admin-more-menu-ico {
    width: 1em;
    text-align: center;
    margin-right: 8px;
}
/* v3.0.0：纯文字菜单条目（如移动端「标签管理」），左侧不预留图标位 */
.admin-more-menu .admin-more-menu-text {
    padding-left: 20px;
}

.admin-more-menu-sep {
    height: 1px;
    margin: 4px 0;
    background: var(--el-border-color-lighter);
}

.admin-more-menu .is-logout {
    color: var(--el-color-danger);
}

@media (prefers-reduced-motion: reduce) {
    .admin-header-control,
    .admin-header-actions :deep(#themeToggle) {
        transition: none;
    }
}
</style>
