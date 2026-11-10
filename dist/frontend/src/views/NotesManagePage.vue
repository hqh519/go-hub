<template>
    <!--
        笔记管理（v1.2.0 首发热身：瞬间）
        ----------------------------------------------------------------------------
        v1.1.2 版式（对照需求逐条落实）：
          第一行 = 页面切换下拉（底部含「切换实例」）+ 搜索 / 标签管理 / 刷新 / 回收站 / 发布 / 更多菜单
          第二行 = 类型标签页（全部 / 瞬间 / 待办 / 导航 / 文章 / 收集）+ 媒体类型 + 排序

        几个刻意的设计：
          · 搜索在桌面端是输入框、在移动端是一个图标，点开才在下面展开一行（需求原文）；
          · 发布按钮的文案跟着「当前类型」变（发布瞬间 / 添加待办 / 添加导航 / 发布文章 / 添加收集）；
          · 标签管理不是弹窗，而是和「回收站」一样的页面模式 ——
            这样功能栏的分类切换天然可用（需求：切到哪个分类就管哪一类的标签）；
          · 移动端左右滑动内容区可循环切换类型（到头继续滑就回到另一端）。
    -->
    <div
        class="nt-page"
        ref="page"
        :class="{ 'has-instance-badge': instanceSeq > 0 }"
        :style="instanceBadgeStyle"
    >
        <!-- 第一行顶栏 -->
        <header
            ref="topbarRef"
            class="nt-topbar"
            :class="{ 'is-hidden': topbarHidden, 'is-solid': topbarSolid, 'is-search-open': isMobile && mobileSearchOpen }"
        >
            <div class="nt-topbar-left">
                <DashboardTabs active-tab="notes">
                    <!--
                        实例切换收进「页面切换」下拉的底部 —— 与图床管理页（/dashboard）完全一致：
                        下拉尾部一条分隔线 + 一条「切换实例」，切换后按钮名称后（移动端悬浮在右上角）显示序号。
                    -->
                    <template #extra-item="{ close }">
                        <div class="page-option-sep" aria-hidden="true"></div>
                        <button
                            type="button"
                            class="page-option admin-page-instance-option"
                            @click.stop="openInstanceFromPageSwitch(close)"
                        >
                            <span v-if="instanceSeq > 0" class="admin-page-instance-seq">{{ instanceSeq }}</span>
                            <font-awesome-icon v-else icon="server" class="admin-page-instance-icon" />
                            <span class="admin-page-instance-text">{{ $t('instancePicker.title') }}</span>
                        </button>
                    </template>
                </DashboardTabs>
            </div>

            <div class="nt-topbar-right">
                <!-- 搜索：桌面端直接是输入框 -->
                <el-input
                    v-if="!isMobile"
                    v-model="search"
                    class="nt-search"
                    size="small"
                    clearable
                    :placeholder="$t('notes.searchPlaceholder')"
                    @keyup.enter="reload"
                    @clear="reload"
                >
                    <template #suffix>
                        <font-awesome-icon icon="search" class="nt-search-icon" @click="reload" />
                    </template>
                </el-input>
                <!-- 移动端：图标 → 点开在下面展开一行搜索框 -->
                <button
                    v-else
                    type="button"
                    class="nt-icon-btn"
                    :class="{ 'is-on': mobileSearchOpen }"
                    :title="$t('notes.searchPlaceholder')"
                    @click="toggleMobileSearch"
                >
                    <font-awesome-icon icon="search" />
                </button>

                <button
                    type="button"
                    class="nt-icon-btn"
                    :class="{ 'is-on': tagMode }"
                    :title="$t('notes.tagAdmin')"
                    @click="toggleTagMode"
                >
                    <font-awesome-icon icon="tags" />
                </button>
                <button type="button" class="nt-icon-btn" :title="$t('notes.refresh')" @click="refreshList">
                    <font-awesome-icon icon="sync" :class="{ 'fa-spin': loading }" />
                </button>
                <button
                    type="button"
                    class="nt-icon-btn"
                    :class="{ 'is-on': trashMode }"
                    :title="$t('notes.trash')"
                    @click="toggleTrash"
                >
                    <font-awesome-icon icon="trash-alt" />
                </button>

                <button type="button" class="nt-publish-btn" :title="publishLabel" @click="openPublish">
                    <font-awesome-icon icon="plus" class="nt-publish-icon" />
                    <span class="nt-publish-text">{{ publishLabel }}</span>
                </button>

                <!-- 更多菜单：我的账户 / 系统管理 / 笔记设置 / 分隔 / 退出登录 / 配色模式切换 -->
                <el-dropdown trigger="click" placement="bottom-end" @command="onMoreCommand">
                    <button type="button" class="nt-icon-btn" :title="$t('notes.more')" :aria-label="$t('notes.more')">
                        <font-awesome-icon icon="ellipsis-v" />
                    </button>
                    <template #dropdown>
                        <el-dropdown-menu>
                            <el-dropdown-item command="account">
                                <font-awesome-icon icon="user" class="nt-menu-icon" />{{ $t('dashboard.myAccount') }}
                            </el-dropdown-item>
                            <el-dropdown-item v-if="isAdmin" command="system">
                                <font-awesome-icon icon="cogs" class="nt-menu-icon" />{{ $t('dashboard.systemManage') }}
                            </el-dropdown-item>
                            <!-- v1.1.2.1：笔记设置（按用户保存），放在「退出登录」上一行 -->
                            <el-dropdown-item command="noteSettings">
                                <font-awesome-icon icon="sliders-h" class="nt-menu-icon" />{{ $t('notes.settings') }}
                            </el-dropdown-item>
                            <el-dropdown-item command="logout" divided>
                                <font-awesome-icon icon="sign-out-alt" class="nt-menu-icon" />{{ $t('dashboard.logout') }}
                            </el-dropdown-item>
                            <el-dropdown-item command="theme">
                                <font-awesome-icon :icon="themeIcon" class="nt-menu-icon" />{{ themeText }}
                            </el-dropdown-item>
                        </el-dropdown-menu>
                    </template>
                </el-dropdown>
            </div>

            <!-- 移动端展开的搜索行（再点一次搜索图标：清空 + 收起） -->
            <div v-if="isMobile && mobileSearchOpen" class="nt-msearch">
                <el-input
                    ref="mobileSearchInput"
                    v-model="search"
                    size="small"
                    clearable
                    :placeholder="$t('notes.searchPlaceholder')"
                    @keyup.enter="reload"
                    @clear="reload"
                >
                    <template #prefix>
                        <font-awesome-icon icon="search" class="nt-search-icon" />
                    </template>
                </el-input>
            </div>
        </header>

        <!-- 第二行工具栏 -->
        <div ref="toolbarRef" class="nt-toolbar" :class="{ 'is-hidden': topbarHidden, 'is-solid': topbarSolid }">
            <div class="nt-types" role="tablist">
                <button
                    v-for="t in typeTabs"
                    :key="t.value"
                    type="button"
                    role="tab"
                    class="nt-type"
                    :class="{ 'is-active': kind === t.value }"
                    :aria-selected="kind === t.value"
                    @click="switchKind(t.value)"
                >{{ $t(t.label) }}</button>
            </div>
            <div class="nt-tools">
                <el-select v-model="mediaKind" class="nt-media" size="small" @change="reload">
                    <el-option :label="$t('notes.mediaAll')" value="" />
                    <el-option :label="$t('notes.mediaText')" value="text" />
                    <el-option :label="$t('notes.mediaImage')" value="image" />
                    <el-option :label="$t('notes.mediaVideo')" value="video" />
                    <el-option :label="$t('notes.mediaAudio')" value="audio" />
                    <el-option :label="$t('notes.mediaMixed')" value="mixed" />
                </el-select>
                <el-select v-model="sortValue" class="nt-sort" size="small" @change="reload">
                    <el-option v-for="s in sortOptions" :key="s.value" :label="$t(s.label)" :value="s.value" />
                </el-select>
                <!-- 标签筛选态：让用户一眼看出「现在列表是按标签过滤的」，并给一个快捷清除 -->
                <button v-if="tagId && !tagMode" type="button" class="nt-filter-chip" @click="clearTagFilter">
                    <font-awesome-icon icon="tag" class="nt-filter-icon" />#{{ tagName }}
                    <font-awesome-icon icon="times" class="nt-filter-close" />
                </button>
            </div>
        </div>

        <!-- 内容区（移动端在这里左右滑动切类型） -->
        <main
            class="nt-main"
            @touchstart.passive="onMainTouchStart"
            @touchmove.passive="onMainTouchMove"
            @touchend.passive="onMainTouchEnd"
            @touchcancel.passive="onMainTouchEnd"
        >
            <!-- 标签管理模式：内容区整体换成标签管理（分类栏照旧可用） -->
            <NoteTagPanel
                v-if="tagMode"
                ref="tagPanel"
                :instance-id="instanceId"
                :kind="kind"
                @changed="reload"
            />

            <template v-else>
                <div v-if="loading && !list.length" class="nt-loading">
                    <font-awesome-icon icon="spinner" spin />
                    <span>{{ $t('notes.loading') }}</span>
                </div>

                <div v-else-if="!list.length" class="nt-empty">
                    <font-awesome-icon :icon="emptyIcon" class="nt-empty-icon" />
                    <p class="nt-empty-title">{{ emptyTitle }}</p>
                    <p class="nt-empty-tip">{{ emptyTip }}</p>
                    <button v-if="canPublishCurrent" type="button" class="nt-empty-btn" @click="openPublish">
                        {{ publishLabel }}
                    </button>
                </div>

                <div v-else class="nt-list">
                    <MomentCard
                        v-for="n in list"
                        :key="n.id"
                        :ref="`card-${n.id}`"
                        :note="n"
                        @preview="(i) => openPreview(n, i)"
                        @edit="openEdit"
                        @delete="confirmDelete"
                        @restore="confirmRestore"
                        @purge="confirmPurge"
                        @tag-click="onTagClick"
                    />
                </div>

                <div v-if="list.length" class="nt-more">
                    <el-button v-if="hasMore" size="small" :loading="loading" @click="loadMore">
                        {{ $t('notes.loadMore') }}
                    </el-button>
                    <span v-else class="nt-end">{{ $t('notes.listEnd', { n: total }) }}</span>
                </div>
            </template>
        </main>

        <!-- 发布 / 编辑 -->
        <MomentPublishDialog
            v-model="publishVisible"
            :note="editing"
            :instance-id="instanceId"
            @saved="onSaved"
        />

        <!-- 笔记设置（v1.1.2.1）：按实例保存，改完立刻作用到列表里的附件区 -->
        <NoteSettingsDialog v-model="settingsVisible" :instance-id="instanceId" />

        <!-- 附件灯箱：一屏 9 个只是列表形态，这里能翻完该瞬间的全部附件 -->
        <MediaPreviewOverlay
            v-if="previewItems.length"
            v-model="previewVisible"
            :items="previewItems"
            :start-index="previewIndex"
            :show-detail="true"
            :detail-open="detailVisible"
            @detail="openFileDetail"
            @record-detail="openFileDetail"
            @close-detail="detailVisible = false"
        />

        <!-- 文件详情（与图床文件管理页同一个组件；标签/黑白名单是文件页专属，这里关掉） -->
        <FileDetailDialog
            v-model="detailVisible"
            :file="detailFile"
            :file-link="detailFileLink"
            :show-advanced="false"
            @metadata-updated="onDetailMetadata"
        />

        <!-- 实例切换（与 /dashboard 同一套交互） -->
        <el-dialog
            v-model="showInstanceDialog"
            :title="$t('instancePicker.title')"
            :width="dialogWidth"
            append-to-body
            align-center
            class="instance-switch-dialog"
        >
            <div class="instance-switch-list">
                <button
                    type="button"
                    class="instance-switch-item"
                    :class="{ 'is-active': !instanceId }"
                    @click="switchInstanceTo('')"
                >
                    <span class="instance-switch-icon"><font-awesome-icon icon="server" /></span>
                    <span class="instance-switch-name">{{ $t('instancePicker.defaultInstance') }}</span>
                    <font-awesome-icon v-if="!instanceId" icon="check" class="instance-switch-check" />
                </button>
                <button
                    v-for="ins in instances"
                    :key="'sw-' + ins.id"
                    type="button"
                    class="instance-switch-item"
                    :class="{ 'is-active': String(instanceId) === String(ins.id) }"
                    @click="switchInstanceTo(ins.id)"
                >
                    <span class="instance-switch-seq">{{ instanceSeqOf(ins) }}</span>
                    <span class="instance-switch-name">{{ ins.name }}</span>
                    <span v-if="ins.note" class="instance-switch-note">{{ ins.note }}</span>
                    <font-awesome-icon
                        v-if="String(instanceId) === String(ins.id)"
                        icon="check"
                        class="instance-switch-check"
                    />
                </button>
                <div v-if="!instances.length" class="instance-switch-empty">
                    {{ $t('instancePicker.empty') }}
                </div>
            </div>
            <div class="instance-switch-footer">
                <button type="button" class="instance-switch-manage" @click="openInstanceManagement">
                    {{ $t('instancePicker.manage') }}
                </button>
            </div>
        </el-dialog>
    </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import DashboardTabs from '@/components/DashboardTabs.vue';
import MediaPreviewOverlay from '@/components/dashboard/MediaPreviewOverlay.vue';
import FileDetailDialog from '@/components/dashboard/FileDetailDialog.vue';
import MomentCard from '@/components/notes/MomentCard.vue';
import MomentPublishDialog from '@/components/notes/MomentPublishDialog.vue';
import NoteTagPanel from '@/components/notes/NoteTagPanel.vue';
import NoteSettingsDialog from '@/components/notes/NoteSettingsDialog.vue';
import { extOf, formatSize } from '@/utils/notes';
import { loadNoteSettings, applyCachedSettings } from '@/utils/noteSettings';
import { writeThemeCookie } from '@/utils/themeCookie';
import { registerLayer, unregisterLayer } from '@/utils/layerStack';

const PAGE_SIZE = 20;
/** 桌面端：离开顶部多少像素后允许隐藏两行栏 */
const SCROLL_HIDE_PX = 60;
/** 移动端：阈值调小（需求：轻滚一点就收起两行） */
const SCROLL_HIDE_PX_MOBILE = 12;
/** 移动端触发隐藏/显示所需的最小位移（越小越灵敏） */
const SCROLL_DELTA_MOBILE = 1;
const SCROLL_DELTA_DESKTOP = 6;
/** 移动端左右滑动切类型的判定：水平位移阈值 + 与垂直分量的比例 */
const SWIPE_MIN_PX = 60;
const SWIPE_RATIO = 1.5;
/** 屏幕边缘这几十像素交给系统「返回」手势，不参与切类型 */
const SWIPE_EDGE_PX = 30;

/** 类型轮播顺序：与功能栏一致，用于左右滑动循环 */
const KIND_CYCLE = ['', 'moment', 'todo', 'nav', 'article', 'collection'];

export default {
    name: 'NotesManagePage',
    components: {
        DashboardTabs,
        MediaPreviewOverlay,
        FileDetailDialog,
        MomentCard,
        MomentPublishDialog,
        NoteTagPanel,
        NoteSettingsDialog
    },
    data() {
        return {
            kind: '',
            mediaKind: '',
            // 标签筛选（点卡片上的 #标签 触发）
            tagId: '',
            tagName: '',
            search: '',
            mobileSearchOpen: false,
            // 排序：只保留第二行这一处（第一行不放排序，避免两套控件打架）
            sortKey: 'createdAt',
            sortOrder: 'desc',
            trashMode: false,
            // 标签管理模式（与回收站同一层面的页面模式）
            tagMode: false,
            instanceId: '',
            instances: [],
            showInstanceDialog: false,
            list: [],
            total: 0,
            page: 1,
            loading: false,
            publishVisible: false,
            // v1.1.2.1：笔记设置弹窗（更多菜单 → 笔记设置）
            settingsVisible: false,
            editing: null,
            previewVisible: false,
            previewItems: [],
            previewIndex: 0,
            detailVisible: false,
            detailFile: null,
            detailFileLink: '',
            topbarHidden: false,
            topbarSolid: false,
            lastScrollTop: 0,
            isMobile: typeof window !== 'undefined' ? window.innerWidth <= 768 : false,
            topRO: null,
            swipeX: null,
            swipeY: null
        };
    },
    computed: {
        typeTabs() {
            return [
                { value: '', label: 'notes.typeAll' },
                { value: 'moment', label: 'notes.typeMoment' },
                { value: 'todo', label: 'notes.typeTodo' },
                { value: 'nav', label: 'notes.typeNav' },
                { value: 'article', label: 'notes.typeArticle' },
                { value: 'collection', label: 'notes.typeCollection' }
            ];
        },
        sortOptions() {
            return [
                { value: 'newest', label: 'notes.sortNewest' },
                { value: 'oldest', label: 'notes.sortOldest' },
                { value: 'updated', label: 'notes.sortUpdated' }
            ];
        },
        sortValue: {
            get() {
                return `${this.sortKey === 'updatedAt' ? 'updated' : this.sortOrder === 'asc' ? 'oldest' : 'newest'}`;
            },
            set(v) {
                if (v === 'oldest') {
                    this.sortKey = 'createdAt';
                    this.sortOrder = 'asc';
                } else if (v === 'updated') {
                    this.sortKey = 'updatedAt';
                    this.sortOrder = 'desc';
                } else {
                    this.sortKey = 'createdAt';
                    this.sortOrder = 'desc';
                }
            }
        },
        hasMore() {
            return this.list.length < this.total;
        },
        /** 发布按钮文案随当前类型变化（需求原文） */
        publishLabel() {
            const map = {
                '': 'notes.publishMoment',
                moment: 'notes.publishMoment',
                todo: 'notes.addTodo',
                nav: 'notes.addNav',
                article: 'notes.publishArticle',
                collection: 'notes.addCollection'
            };
            return this.$t(map[this.kind] || 'notes.publishMoment');
        },
        /** 目前只有「瞬间」实装，其它类型的编辑页还没做 */
        canPublishCurrent() {
            return this.kind === '' || this.kind === 'moment';
        },
        emptyIcon() {
            if (this.trashMode) return 'trash-alt';
            if (this.kind && this.kind !== 'moment') return 'inbox';
            return 'book';
        },
        emptyTitle() {
            if (this.trashMode) return this.$t('notes.trashEmpty');
            if (this.kind && this.kind !== 'moment') return this.$t('notes.typeNotReady');
            if (this.search || this.mediaKind) return this.$t('notes.noMatch');
            return this.$t('notes.emptyTitle');
        },
        emptyTip() {
            if (this.kind && this.kind !== 'moment' && !this.trashMode) return this.$t('notes.typeNotReadyTip');
            return this.$t('notes.emptyTip');
        },
        isAdmin() {
            return this.$store.getters.isAdminRole === true;
        },
        /** 当前实例的创建序号（默认实例 = 0，不显示角标） */
        instanceSeq() {
            if (!this.instanceId) return 0;
            const hit = this.instances.find((i) => String(i.id) === String(this.instanceId));
            if (!hit) return 0;
            const idx = Number(hit.index);
            if (Number.isFinite(idx) && idx > 0) return idx;
            const pos = this.instances.findIndex((i) => String(i.id) === String(this.instanceId));
            return pos >= 0 ? pos + 1 : 0;
        },
        /** 序号用带圈数字：①-⑳，超过就退回 (21) 这种写法 */
        instanceBadgeStyle() {
            const n = this.instanceSeq;
            if (!n) return null;
            const circled = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
            const text = n <= circled.length ? circled[n - 1] : `(${n})`;
            return { '--instance-seq': `"${text}"` };
        },
        themeIcon() {
            const mode = this.themeMode;
            if (mode === 'auto') return 'circle-half-stroke';
            return this.$store.getters.useDarkMode ? 'sun' : 'moon';
        },
        themeMode() {
            if (!this.$store.getters.cusDarkMode) return 'auto';
            return this.$store.getters.useDarkMode ? 'dark' : 'light';
        },
        themeText() {
            // 与顶栏更多菜单一致：显示「点了之后会切到哪个模式」
            if (this.themeMode === 'auto') return this.$t('theme.lightMode');
            if (this.themeMode === 'light') return this.$t('theme.darkMode');
            return this.$t('theme.autoMode');
        },
        dialogWidth() {
            return typeof window !== 'undefined' && window.innerWidth < 768 ? '92%' : '480px';
        }
    },
    watch: {
        isMobile(v) {
            if (!v) this.mobileSearchOpen = false;
            this.$nextTick(this.syncTopHeights);
        }
    },
    created() {
        this.instanceId = this.readInstanceId();
        /*
         * v1.1.2.1：笔记设置（附件区大小 / 位置），按实例隔离。
         * 先同步贴 Cookie 缓存（首屏就是最终尺寸，不闪），再向服务端要最新值。
         */
        this.applyInstanceSettings();
    },
    watch: {
        /*
         * v1.1.2：灯箱 + 详情页叠加时的「逐层关闭」。
         * 灯箱打开时已往 layerStack 登记了 'media-viewer'，详情弹窗是后开的，
         * 必须也登记一层才会排在栈顶 —— 否则移动端边缘滑动会直接把灯箱关掉、
         * 详情还挂在屏幕上，与需求「先关详情、再关灯箱」相反。
         * esc:false 让 Element Plus 自己处理 Esc（它的处理更聪明：下拉展开、
         * 输入法候选未结束时只收下拉不关弹窗）。
         */
        detailVisible(v) {
            if (v) {
                registerLayer('note-file-detail', () => { this.detailVisible = false; }, { esc: false });
            } else {
                unregisterLayer('note-file-detail');
            }
        },
    },
    async mounted() {
        window.addEventListener('scroll', this.onPageScroll, true);
        window.addEventListener('resize', this.onWindowResize);
        this.syncTopHeights();
        // 顶栏 / 工具栏高度会随内容变化（搜索行展开、类型标签换行），用 ResizeObserver 盯着最省心
        if (typeof ResizeObserver !== 'undefined') {
            this.topRO = new ResizeObserver(() => this.syncTopHeights());
            if (this.$refs.topbarRef) this.topRO.observe(this.$refs.topbarRef);
            if (this.$refs.toolbarRef) this.topRO.observe(this.$refs.toolbarRef);
        }
        await this.loadInstances();
        await this.reload();
        this.syncTopHeights();
    },
    beforeUnmount() {
        window.removeEventListener('scroll', this.onPageScroll, true);
        window.removeEventListener('resize', this.onWindowResize);
        if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
        // 页面卸载时兜底摘掉详情层，避免残留导致下一次返回被「吃掉」
        unregisterLayer('note-file-detail');
        if (this.topRO) {
            this.topRO.disconnect();
            this.topRO = null;
        }
    },
    methods: {
        /* ── 实例 ───────────────────────────────────────────────── */
        readInstanceId() {
            try {
                return localStorage.getItem('gohub_instance_id') || '';
            } catch (e) {
                return '';
            }
        },
        async loadInstances() {
            try {
                const res = await fetchWithAuth('/api/instances');
                const data = await res.json().catch(() => []);
                this.instances = Array.isArray(data) ? data : [];
            } catch (e) {
                this.instances = [];
            }
        },
        instanceSeqOf(ins) {
            const idx = Number(ins.index);
            if (Number.isFinite(idx) && idx > 0) return idx;
            const pos = this.instances.findIndex((i) => i.id === ins.id);
            return pos >= 0 ? pos + 1 : 0;
        },
        openInstanceFromPageSwitch(closeFn) {
            this.showInstanceDialog = true;
            if (typeof closeFn === 'function') closeFn();
        },
        switchInstanceTo(id) {
            this.showInstanceDialog = false;
            this.instanceId = id == null ? '' : id;
            this.applyInstance();
        },
        applyInstance() {
            // 与「图床文件管理」共用同一个存储键 —— 在这里切实例，文件管理页也跟着切
            try {
                localStorage.setItem('gohub_instance_id', this.instanceId || '');
            } catch (e) {
                /* 忽略隐私模式写入失败 */
            }
            this.tagId = '';
            this.tagName = '';
            // v1.1.2.1：笔记设置按实例隔离 —— 先同步贴上新实例的缓存尺寸，再向服务端要最新值
            this.applyInstanceSettings();
            this.$message.success(this.$t('instancePicker.switchSuccess'));
            this.reload();
        },
        /**
         * 应用当前实例的笔记设置：
         *   · applyCachedSettings 是同步的，先把 Cookie 里这个实例的尺寸摆上去（首屏不闪）；
         *   · loadNoteSettings 异步拿服务端的最新值（别的设备可能改过）。
         */
        applyInstanceSettings() {
            applyCachedSettings(this.instanceId);
            loadNoteSettings(this.instanceId);
        },
        async openInstanceManagement() {
            const username = this.$store.getters.sessionUser || '';
            let url = '/customerConfig';
            try {
                const res = await fetchWithAuth('/api/manage/users', { method: 'GET' });
                const list = res.ok ? await res.json() : [];
                const hit = (Array.isArray(list) ? list : []).find((u) => u && u.username === username);
                if (hit && hit.id) url = `/customerConfig/edit/${encodeURIComponent(hit.id)}?anchor=instances`;
            } catch (e) {
                /* 取不到主键就退回用户管理列表 */
            }
            window.open(url, '_blank', 'noopener');
        },

        /* ── 顶栏动作 ───────────────────────────────────────────── */
        toggleMobileSearch() {
            this.mobileSearchOpen = !this.mobileSearchOpen;
            if (this.mobileSearchOpen) {
                // 展开：聚焦输入框，不立刻搜索（用户还没输入）
                this.$nextTick(() => {
                    const el = this.$refs.mobileSearchInput;
                    const input = el && (el.input || el.$el?.querySelector('input'));
                    if (input && typeof input.focus === 'function') input.focus();
                });
            } else {
                // 收起：清空内容并重新加载（需求：再次点击会清空搜索框内容并隐藏）
                this.search = '';
                this.reload();
            }
        },
        onMoreCommand(cmd) {
            if (cmd === 'account') {
                window.open('/customerConfig', '_blank', 'noopener');
                return;
            }
            if (cmd === 'system') {
                window.open('/systemConfig#status', '_blank', 'noopener');
                return;
            }
            // v1.1.2.1：笔记设置（按用户保存：附件区大小 / 位置）
            if (cmd === 'noteSettings') {
                this.settingsVisible = true;
                return;
            }
            if (cmd === 'logout') {
                this.logout();
                return;
            }
            if (cmd === 'theme') this.cycleTheme();
        },
        logout() {
            fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authType: 'admin' })
            }).finally(() => {
                this.$store.commit('setAdminLoggedIn', false);
                this.$router.push('/adminLogin');
            });
        },
        /** 配色模式三态循环：跟随系统 → 浅色 → 深色 → 跟随系统 */
        cycleTheme() {
            if (this.themeMode === 'auto') {
                this.$store.commit('setCusDarkMode', true);
                this.$store.commit('setUseDarkMode', false);
                writeThemeCookie('light');
            } else if (this.themeMode === 'light') {
                this.$store.commit('setCusDarkMode', true);
                this.$store.commit('setUseDarkMode', true);
                writeThemeCookie('dark');
            } else {
                this.$store.commit('setCusDarkMode', false);
                writeThemeCookie('auto');
            }
        },

        /* ── 列表 ───────────────────────────────────────────────── */
        switchKind(v) {
            if (this.kind === v) return;
            this.kind = v;
            if (this.tagMode) return; // 标签管理模式由面板自己按 kind 过滤
            this.reload();
        },
        /** 移动端左右滑动循环切换类型 */
        cycleKind(dir) {
            const cur = KIND_CYCLE.indexOf(this.kind);
            const base = cur < 0 ? 0 : cur;
            const next = (base + dir + KIND_CYCLE.length) % KIND_CYCLE.length;
            this.switchKind(KIND_CYCLE[next]);
        },
        onMainTouchStart(e) {
            this.swipeX = null;
            if (!this.isMobile) return;
            // 弹层打开时不响应（灯箱 / 详情 / 发布 / 留言 / 实例弹窗 / 笔记设置）
            if (this.previewVisible || this.publishVisible || this.showInstanceDialog || this.settingsVisible) return;
            const t = e.touches && e.touches[0];
            if (!t) return;
            const w = window.innerWidth;
            // 屏幕两端留给系统返回手势
            if (t.clientX <= SWIPE_EDGE_PX || t.clientX >= w - SWIPE_EDGE_PX) return;
            // 横向可滚动的控件（类型栏）与表单控件不参与
            const el = e.target;
            if (el && el.closest && el.closest('.nt-types, .no-hswipe-guard, input, textarea, .el-select')) return;
            this.swipeX = t.clientX;
            this.swipeY = t.clientY;
        },
        onMainTouchMove(e) {
            if (this.swipeX === null) return;
            const t = e.touches && e.touches[0];
            if (!t) return;
            // 明显是纵向滚动 → 直接放弃这次手势，避免滑到一半突然切了类型
            const dy = Math.abs(t.clientY - this.swipeY);
            const dx = Math.abs(t.clientX - this.swipeX);
            if (dy > 24 && dy > dx) this.swipeX = null;
        },
        onMainTouchEnd(e) {
            if (this.swipeX === null) return;
            const x0 = this.swipeX;
            const y0 = this.swipeY;
            this.swipeX = null;
            const t = (e.changedTouches && e.changedTouches[0]) || null;
            if (!t) return;
            const dx = t.clientX - x0;
            const dy = t.clientY - y0;
            if (Math.abs(dx) < SWIPE_MIN_PX) return;
            if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
            // 左滑 → 下一个类型；右滑 → 上一个类型（到头/到尾都循环）
            this.cycleKind(dx < 0 ? 1 : -1);
        },
        toggleTagMode() {
            this.tagMode = !this.tagMode;
            if (this.tagMode) {
                // 标签管理和回收站是两个互斥的页面模式
                this.trashMode = false;
                this.tagId = '';
                this.tagName = '';
            }
        },
        toggleTrash() {
            this.trashMode = !this.trashMode;
            if (this.trashMode) this.tagMode = false;
            this.reload();
        },
        clearTagFilter() {
            this.tagId = '';
            this.tagName = '';
            this.page = 1;
            this.fetchList(true);
        },
        onTagClick(tag) {
            // 点标签 = 按标签筛选；再点同一个标签 = 取消筛选
            this.search = '';
            this.mediaKind = '';
            this.tagMode = false;
            if (this.tagId === tag.id) {
                this.tagId = '';
                this.tagName = '';
            } else {
                this.tagId = tag.id;
                this.tagName = tag.name;
            }
            this.page = 1;
            return this.fetchList(true);
        },
        buildQuery() {
            const qs = new URLSearchParams();
            qs.set('page', String(this.page));
            qs.set('pageSize', String(PAGE_SIZE));
            qs.set('instanceId', this.instanceId || '');
            qs.set('sort', this.sortKey);
            qs.set('order', this.sortOrder);
            if (this.kind) qs.set('kind', this.kind);
            if (this.mediaKind) qs.set('mediaKind', this.mediaKind);
            if (this.search.trim()) qs.set('search', this.search.trim());
            if (this.tagId) qs.set('tagId', this.tagId);
            if (this.trashMode) qs.set('status', 'deleted');
            return qs;
        },
        reload() {
            this.page = 1;
            this.tagId = '';
            this.tagName = '';
            return this.fetchList(true);
        },
        /**
         * 「刷新」按钮（v1.1.2 修复）：
         * 旧实现直接复用 reload()，而 reload() 会顺手清掉标签筛选 —— 用户点了以为没反应
         * （筛选被悄悄重置、列表看起来"没变"）。这里改成只重拉当前条件下的第一页：
         * 清空列表、给出 loading、保留搜索/筛选/排序，行为与「刷新」两个字一致。
         */
        async refreshList() {
            if (this.tagMode) {
                // 标签管理模式下刷新交给面板自己（它有自己的刷新按钮与数据源）
                const panel = this.$refs.tagPanel;
                if (panel && typeof panel.load === 'function') return panel.load();
                return;
            }
            this.page = 1;
            this.list = [];
            this.total = 0;
            return this.fetchList(true);
        },
        loadMore() {
            if (this.loading || !this.hasMore) return;
            this.page += 1;
            return this.fetchList(false);
        },
        async fetchList(reset) {
            this.loading = true;
            try {
                const qs = this.buildQuery();
                const res = await fetchWithAuth(`/api/notes/list?${qs.toString()}`);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || 'load failed');
                const rows = Array.isArray(data.list) ? data.list : [];
                this.total = Number(data.total) || 0;
                this.list = reset ? rows : this.list.concat(rows);
            } catch (e) {
                this.$message.error(this.$t('notes.loadFail'));
            } finally {
                this.loading = false;
            }
        },
        /* ── 发布 / 编辑 ────────────────────────────────────────── */
        openPublish() {
            if (!this.canPublishCurrent) {
                this.$message.warning(this.$t('notes.typeNotReadyTip'));
                return;
            }
            this.editing = null;
            this.publishVisible = true;
        },
        openEdit(note) {
            this.editing = note;
            this.publishVisible = true;
        },
        onSaved() {
            this.reload();
        },

        /* ── 删除 / 恢复 / 彻底删除 ─────────────────────────────── */
        async confirmDelete(note) {
            try {
                await this.$confirm(this.$t('notes.deleteConfirm'), this.$t('notes.deleteTitle'), {
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    type: 'warning'
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(`/api/notes/${encodeURIComponent(note.id)}`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('notes.deletedOk'));
                this.reload();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },
        async confirmRestore(note) {
            try {
                const res = await fetchWithAuth(`/api/notes/${encodeURIComponent(note.id)}/restore`, { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('notes.restoredOk'));
                this.reload();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },
        async confirmPurge(note) {
            try {
                await this.$confirm(this.$t('notes.purgeConfirm'), this.$t('notes.purge'), {
                    confirmButtonText: this.$t('notes.purge'),
                    cancelButtonText: this.$t('common.cancel'),
                    type: 'error'
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(`/api/notes/${encodeURIComponent(note.id)}/purge`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('notes.purgedOk'));
                this.reload();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },

        /* ── 灯箱 / 文件详情 ────────────────────────────────────── */
        openPreview(note, index) {
            const assets = (note.assets || []).filter(Boolean);
            if (!assets.length) return;
            this.previewItems = assets.map((a) => ({
                // key 用 File_ID（= /file/<name> 的标识），灯箱的「详情」事件带回来的就是它
                key: a.name || a.fileId,
                name: a.originalName || a.name,
                url: a.url,
                kind: a.mediaKind === 'file' ? 'other' : a.mediaKind,
                ext: extOf(a.originalName || a.name),
                sizeText: formatSize(a.size),
                user: '',
                recordId: a.fileId || ''
            }));
            this.previewIndex = Math.min(index, this.previewItems.length - 1);
            this.previewVisible = true;
        },
        /** 灯箱右上角「详情」/ 移动端下拉 → 打开文件详情（与图床文件管理页同一个弹窗） */
        async openFileDetail(payload) {
            const key = (payload && (payload.key || payload.name)) || '';
            if (!key) return;
            this.detailFile = { name: key, metadata: {} };
            this.detailFileLink = (payload && payload.url) || '';
            this.detailVisible = true;
            try {
                const res = await fetchWithAuth(`/api/manage/metadata/${encodeURIComponent(key)}`);
                const json = await res.json().catch(() => ({}));
                const data = (json && json.data) || {};
                if (data.metadata) {
                    this.detailFile = { name: data.name || key, metadata: data.metadata };
                }
            } catch (e) {
                /* 拿不到元数据也把弹窗开着，用户点「刷新」还能再试 */
            }
        },
        onDetailMetadata(name, metadata) {
            if (!this.detailFile) return;
            this.detailFile = { ...this.detailFile, metadata: { ...(this.detailFile.metadata || {}), ...(metadata || {}) } };
        },

        /* ── 顶栏吸顶 ───────────────────────────────────────────── */
        onPageScroll() {
            const top = window.scrollY || document.documentElement.scrollTop || 0;
            this.topbarSolid = top > 8;
            const hidePx = this.isMobile ? SCROLL_HIDE_PX_MOBILE : SCROLL_HIDE_PX;
            const delta = this.isMobile ? SCROLL_DELTA_MOBILE : SCROLL_DELTA_DESKTOP;
            if (top > hidePx && top > this.lastScrollTop + delta) {
                this.topbarHidden = true;
            } else if (top < this.lastScrollTop - delta || top < Math.min(40, hidePx)) {
                this.topbarHidden = false;
            }
            this.lastScrollTop = top;
        },
        /**
         * 把两行固定栏的实测高度写进 --nt-topbar-h / --nt-toolbar-h。
         * 内容区留白与第二行的 top 都取这两个值，改布局就只剩一处要维护。
         */
        syncTopHeights() {
            const root = this.$el;
            if (!root || !root.style) return;
            const topH = this.$refs.topbarRef ? this.$refs.topbarRef.offsetHeight : 0;
            const toolH = this.$refs.toolbarRef ? this.$refs.toolbarRef.offsetHeight : 0;
            if (topH) root.style.setProperty('--nt-topbar-h', `${topH}px`);
            if (toolH) root.style.setProperty('--nt-toolbar-h', `${toolH}px`);
        },
        onWindowResize() {
            this.isMobile = window.innerWidth <= 768;
            this.syncTopHeights();
            if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
            this.resizeTimer = window.setTimeout(() => {
                // 宽度变化 → 行高与换行都会变，重新判定每张卡的「全文」按钮
                for (const key of Object.keys(this.$refs || {})) {
                    if (!key.startsWith('card-')) continue;
                    const ref = this.$refs[key];
                    const card = Array.isArray(ref) ? ref[0] : ref;
                    if (card && typeof card.measure === 'function') card.measure();
                }
            }, 200);
        }
    }
};
</script>

<style scoped>
.nt-page {
    box-sizing: border-box;
    min-height: 100vh;
    /*
     * 顶部两行都是 fixed，高度会随「搜索行展开 / 类型标签换行」变化，
     * 所以留白不写死，由 syncTopHeights() 把实测高度写进这两个自定义属性。
     */
    padding-top: calc(var(--nt-topbar-h, 60px) + var(--nt-toolbar-h, 44px) + 8px);
    background: var(--note-page-bg, transparent);
    /*
     * 全局 #app 上有一条历史遗留的 `text-align: center`（图床首页居中标题用），
     * 会被继承下来把瞬间正文也居中 —— 正文必须是左对齐，这里在页面根部复位一次。
     */
    text-align: left;
}

/* ── 第一行 ─────────────────────────────────────────────── */
.nt-topbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 8px 16px;
    background: var(--glass-bg);
    border-bottom: 1px solid var(--glass-border);
    backdrop-filter: blur(var(--glass-backdrop-blur, 10px));
    -webkit-backdrop-filter: blur(var(--glass-backdrop-blur, 10px));
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.nt-topbar.is-solid {
    background: var(--toolbar-solid-bg, #FAFAFB);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
}

.nt-topbar.is-hidden {
    transform: translateY(-100%);
}

/*
 * 第二行在第一行下面，只上移自身高度的话会停在第一行原来的位置露出来 ——
 * 必须把第一行的高度一起减掉，两行才会整体滑出屏幕。
 *
 * v1.1.2：补上 transform 过渡。之前只有第一行有 transition，
 * 移动端第二行是「瞬间跳走」，观感与第一行完全不同（需求点名的那个不对劲）。
 */
.nt-toolbar {
    position: fixed;
    top: var(--nt-topbar-h, 60px);
    left: 0;
    right: 0;
    z-index: 39;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    padding: 6px 16px 8px;
    background: var(--glass-bg);
    border-bottom: 1px solid var(--glass-border);
    backdrop-filter: blur(var(--glass-backdrop-blur, 10px));
    -webkit-backdrop-filter: blur(var(--glass-backdrop-blur, 10px));
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.nt-toolbar.is-solid {
    background: var(--toolbar-solid-bg, #FAFAFB);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
}

.nt-toolbar.is-hidden {
    transform: translateY(calc(-1 * var(--nt-topbar-h, 60px) - 100%));
}

.nt-topbar-left,
.nt-topbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: wrap;
}

.nt-topbar-right {
    flex-wrap: nowrap;
}

/* 移动端展开的搜索行：整行占满，顶栏高度自动变高（ResizeObserver 会重新写入 --nt-topbar-h） */
.nt-msearch {
    flex: 1 1 100%;
    order: 3;
}

.nt-search {
    width: 190px;
}

.nt-search-icon {
    cursor: pointer;
    opacity: 0.6;
}

.nt-publish-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border: none;
    border-radius: 9px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: filter 0.15s ease;
}

.nt-publish-btn:hover {
    filter: brightness(1.08);
}

.nt-publish-icon {
    font-size: 12px;
}

.nt-menu-icon {
    margin-right: 6px;
    font-size: 12px;
    opacity: 0.8;
}

/* ── 第二行工具栏 ───────────────────────────────────────── */
.nt-types {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: 10px;
    background: var(--note-tabs-bg, rgba(127, 127, 127, 0.1));
    overflow-x: auto;
    max-width: 100%;
    scrollbar-width: none;
}

.nt-types::-webkit-scrollbar {
    display: none;
}

.nt-type {
    padding: 4px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 13px;
    font-family: inherit;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.18s ease, color 0.18s ease;
}

.nt-type:hover {
    color: var(--el-color-primary);
}

.nt-type.is-active {
    background: var(--note-tab-active-bg, #fff);
    color: var(--el-color-primary);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.nt-tools {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
}

.nt-media {
    width: 108px;
}

.nt-sort {
    width: 118px;
}

.nt-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 12px;
    cursor: pointer;
    flex: 0 0 auto;
}

.nt-icon-btn:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary);
}

.nt-icon-btn.is-on {
    color: #fff;
    background: var(--el-color-primary);
    border-color: var(--el-color-primary);
}

.nt-icon-btn.is-on.is-danger {
    background: var(--el-color-danger);
    border-color: var(--el-color-danger);
}

/* 标签筛选 chip */
.nt-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border: 1px solid var(--el-color-primary);
    border-radius: 999px;
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.1));
    color: var(--el-color-primary);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
}

.nt-filter-icon {
    font-size: 10px;
}

.nt-filter-close {
    font-size: 9px;
    opacity: 0.75;
}

/* ── 内容 ───────────────────────────────────────────────── */
.nt-main {
    box-sizing: border-box;
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    padding: 14px 16px 40px;
}

.nt-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

/*
 * v1.1.2.2「分割线样式」：最后一条不再画分割线，否则列表末尾会多出一道悬空的线。
 * （卡片自己是不知道「我是不是最后一个」的，所以这条规则放在列表页）
 */
.nt-list :deep(.mc.is-divider:last-child) {
    border-bottom: none;
}

.nt-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 80px 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

.nt-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 80px 10px;
    text-align: center;
}

.nt-empty-icon {
    font-size: 34px;
    color: var(--el-text-color-placeholder);
    margin-bottom: 6px;
}

.nt-empty-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--el-text-color-regular);
}

.nt-empty-tip {
    margin: 0;
    font-size: 12.5px;
    color: var(--el-text-color-secondary);
    max-width: 420px;
    line-height: 1.7;
}

.nt-empty-btn {
    margin-top: 10px;
    padding: 7px 16px;
    border: 1px solid var(--el-color-primary);
    border-radius: 9px;
    background: transparent;
    color: var(--el-color-primary);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
}

.nt-empty-btn:hover {
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.1));
}

.nt-more {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px 0 6px;
}

.nt-end {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

/* ── 页面切换下拉里的「切换实例」条目（与 /dashboard 同款外观） ── */
.nt-page :deep(.page-option-sep) {
    flex: 0 0 auto;
    height: 1px;
    margin: 6px 4px;
    background: var(--el-border-color-lighter);
    opacity: 0.9;
}

.nt-page :deep(.admin-page-instance-option) {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    box-sizing: border-box;
    height: var(--page-option-height, 37px);
    padding: 0 12px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: var(--page-option-font-size, 15px);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
}

.nt-page :deep(.admin-page-instance-option:hover) {
    color: var(--el-color-primary);
}

.nt-page :deep(.admin-page-instance-seq) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
}

.nt-page :deep(.admin-page-instance-icon) {
    font-size: 13px;
    opacity: 0.8;
}

/*
 * 实例序号角标：桌面端跟在「页面切换」按钮名称后面；
 * 移动端按钮很窄，改为悬浮在图标右上角（与 /dashboard 完全一致）。
 */
.nt-page.has-instance-badge :deep(.page-option.is-current .page-switcher-title::after) {
    content: var(--instance-seq, "");
    margin-left: 4px;
    font-size: 0.72em;
    font-weight: 700;
    line-height: 1;
    color: var(--tabs-switcher-accent-color, var(--el-color-primary));
    vertical-align: 1px;
}

@media (max-width: 768px) {
    .nt-topbar {
        padding: 6px 8px;
        gap: 6px;
        flex-wrap: nowrap;
    }

    /* 搜索行展开时必须允许换行，否则它会被挤成一条窄缝 */
    .nt-topbar.is-search-open {
        flex-wrap: wrap;
    }

    .nt-topbar-left {
        flex: 1 1 auto;
        flex-wrap: nowrap;
        /* 之前这里是 hidden —— 下拉菜单一展开就被裁掉，看起来像被下面的栏目盖住了 */
        overflow: visible;
        min-width: 0;
    }

    .nt-topbar-right {
        flex: 0 0 auto;
        gap: 4px;
    }

    /* 手机上发布按钮只留图标，避免把顶栏撑爆 */
    .nt-publish-text {
        display: none;
    }

    .nt-publish-btn {
        padding: 7px 10px;
    }

    .nt-toolbar {
        padding: 6px 8px;
        gap: 6px;
    }

    .nt-types {
        flex: 1 1 100%;
        max-width: 100%;
    }

    .nt-tools {
        flex: 1 1 100%;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 6px;
    }

    .nt-media {
        grid-column: 1 / 2;
        width: auto;
        min-width: 0;
    }

    .nt-sort {
        grid-column: 2 / 3;
        width: auto;
        min-width: 0;
    }

    .nt-filter-chip {
        grid-column: 1 / 3;
        justify-self: start;
    }

    .nt-main {
        padding: 10px 8px 30px;
    }

    .nt-list {
        gap: 8px;
    }

    .nt-page.has-instance-badge :deep(.page-option.is-current) {
        position: relative;
    }

    .nt-page.has-instance-badge :deep(.page-option.is-current .page-switcher-title::after) {
        content: none;
    }

    .nt-page.has-instance-badge :deep(.page-option.is-current::after) {
        content: var(--instance-seq, "");
        position: absolute;
        z-index: 2;
        top: 1px;
        right: 18px;
        min-width: 14px;
        padding: 0 3px;
        border-radius: 999px;
        background: var(--el-color-primary);
        color: #fff;
        font-size: 9px;
        font-weight: 700;
        line-height: 14px;
        text-align: center;
    }
}

@media (prefers-reduced-motion: reduce) {
    .nt-topbar,
    .nt-toolbar {
        transition: none;
    }
}

/* ── 实例切换弹窗（与 /dashboard 同款） ─────────────────── */
.instance-switch-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 56vh;
    overflow-y: auto;
}

.instance-switch-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 10px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-family: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
}

.instance-switch-item:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
}

.instance-switch-item.is-active {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.1));
    color: var(--el-color-primary);
}

.instance-switch-icon {
    font-size: 12px;
    opacity: 0.8;
}

.instance-switch-seq {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
}

.instance-switch-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.instance-switch-note {
    font-size: 11px;
    color: var(--el-text-color-secondary);
}

.instance-switch-check {
    color: var(--el-color-primary);
}

.instance-switch-empty {
    padding: 24px 0;
    text-align: center;
    font-size: 12.5px;
    color: var(--el-text-color-secondary);
}

.instance-switch-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
}

.instance-switch-manage {
    padding: 4px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--el-color-primary);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
}

.instance-switch-manage:hover {
    text-decoration: underline;
}
</style>
