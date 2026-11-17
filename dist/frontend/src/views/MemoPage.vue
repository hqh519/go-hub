<template>
    <!--
        笔记管理页（v1.3.0）—— /memo
        ----------------------------------------------------------------------------
        三栏：左目录 / 中列表 / 右编辑器。
        移动端（<=900px）改成「列表 → 编辑」两级，目录放进抽屉：
        硬塞三栏在手机上每栏只有 100px 宽，谁也看不清。
    -->
    <div
        ref="pageEl"
        class="memo-page"
        :class="[
            { 'is-mobile': isMobile, 'is-topbar-hidden': topbarHidden },
            pageThemeClass,
        ]"
    >
        <div class="memo-topbar">
            <DashboardTabs active-tab="memo">
                <!--
                    v1.3.1.1（需求）：页面切换下拉尾部加「切换实例」，
                    与「我的发布」/「瞬间管理」完全一致（同一条 .page-option + 序号角标）。
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
            <div class="memo-topbar-right">
                <!--
                    v1.3.1.1：移动端编辑态原来靠顶栏下面那一条「返回 + 标题」回去，
                    那条已被需求移除，所以把「返回列表」收进顶栏右侧 —— 不然手机上
                    进到编辑器就再也回不到列表了。
                -->
                <button
                    v-if="isMobile && editingId"
                    type="button"
                    class="memo-icon-btn"
                    :title="$t('common.back')"
                    @click="backToList"
                >
                    <font-awesome-icon icon="chevron-left" />
                </button>
                <button v-if="isMobile" type="button" class="memo-icon-btn" :title="$t('memo.folders')" @click="treeDrawer = true">
                    <font-awesome-icon icon="folder-tree" />
                </button>
                <button type="button" class="memo-icon-btn" :title="$t('memo.newNote')" @click="createNote">
                    <font-awesome-icon icon="plus" />
                </button>
                <button type="button" class="memo-icon-btn" :title="$t('memo.editorSettings')" @click="openSettings">
                    <font-awesome-icon icon="cogs" />
                </button>
            </div>
        </div>

        <div class="memo-cols">
            <!-- 左：目录 -->
            <aside
                v-if="!isMobile"
                class="memo-col memo-col-tree"
                :style="{ flexBasis: `${treeWidth}px`, maxWidth: `${treeWidth}px` }"
            >
                <MemoTree v-model:active="activeFolder" :instance-id="instanceId" @loaded="onTreeLoaded" />
                <!--
                    v1.3.3（需求）：桌面端目录栏可以拖边框改宽度。
                    宽度存 localStorage，下次进来还是上次的宽度。
                -->
                <span
                    class="memo-tree-resizer"
                    :title="$t('memo.treeResize')"
                    @pointerdown.prevent="startTreeResize"
                ></span>
            </aside>

            <!-- 中：列表 -->
            <section v-show="!isMobile || !editingId" class="memo-col memo-col-list">
                <MemoList
                    ref="list"
                    :folder-id="activeFolder"
                    :active-id="selectedId"
                    :folders="folders"
                    @select="openNote"
                    @create="createNote"
                    @changed="onListChanged"
                />
            </section>

            <!-- 右：编辑器 -->
            <main v-show="!isMobile || editingId" class="memo-col memo-col-editor">
                <!-- v1.3.1.1（需求）：移动端这里原来有一条「返回 + 标题」的横条，已移除 -->
                <MemoEditor
                    v-if="currentNote"
                    ref="editor"
                    :note="currentNote"
                    :instance-id="instanceId"
                    :toolbar-config="editorSettings.toolbarLines"
                    :editor-config="editorSettings"
                    @saved="onSaved"
                    @publish-moment="onPublishMoment"
                    @reload="reloadNote"
                    @open-note="openNote"
                />
                <div v-else class="memo-blank">
                    <font-awesome-icon icon="file-lines" class="memo-blank-icon" />
                    <p class="memo-blank-title">{{ $t('memo.pickOrCreate') }}</p>
                    <button type="button" class="memo-blank-btn" @click="createNote">
                        {{ $t('memo.newNote') }}
                    </button>
                </div>
            </main>
        </div>

        <!-- 移动端目录抽屉（v1.3.1：78% → 90%，目录名长了也能看全） -->
        <el-drawer v-if="isMobile" v-model="treeDrawer" direction="ltr" size="90%" :with-header="false">
            <MemoTree v-model:active="activeFolderDrawer" :instance-id="instanceId" @loaded="onTreeLoaded" />
        </el-drawer>

        <!--
            v1.3.1.2（需求：选中文字「发布到瞬间」）——
            复用发布中心的同一个弹窗，发布完关掉就回到编辑器，不发生页面跳转。
        -->
        <MomentPublishDialog
            v-model="momentDlgVisible"
            :instance-id="instanceId"
            :preset-content="momentDraft"
            @saved="onMomentSaved"
        />

        <!-- v1.3.1.1：切换实例弹窗（与「我的发布」/「瞬间管理」同一个组件） -->
        <InstanceSwitchDialog
            v-model="showInstanceDialog"
            :instance-id="instanceId"
            :instances="instances"
            @switch="switchInstanceTo"
            @manage="openInstanceManagement"
        />

        <!-- 编辑器设置 -->
        <el-dialog v-model="settingsVisible" :title="$t('memo.editorSettings')" width="560px" append-to-body class="memo-settings-dialog">
            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.toolbarConfig') }}</label>
                <p class="ms-tip">{{ $t('memo.toolbarTip') }}</p>
                <textarea v-model="settingsDraft.toolbar" class="ms-textarea" rows="5" spellcheck="false"></textarea>
                <!--
                    v1.3.2（需求）：可用工具改为可点击 —— 点一下复制工具名，
                    并在最下方显示刚复制的是哪一个（方便直接粘进上面的配置框）。
                -->
                <p class="ms-tip ms-avail">{{ $t('memo.toolbarAvail') }}：</p>
                <div class="ms-token-list">
                    <button
                        v-for="tk in availableToolList"
                        :key="'tk-' + tk"
                        type="button"
                        class="ms-token"
                        @click="copyToken(tk)"
                    >{{ tk }}</button>
                </div>
                <p class="ms-copied">{{ copiedTool ? $t('memo.tokenCopied', { name: copiedTool }) : $t('memo.tokenCopyTip') }}</p>
            </div>
            <!--
                v1.3.1.2（需求）：「输入工具配置」改名「光标工具栏配置」，
                「/菜单工具配置」改名「/命令菜单配置」。
                改名不是整齐癖 —— 前者现在真的是跟着光标走的一条工具栏，
                后者弹出的就是一个命令清单（含分隔线），名字跟实物对上才好互相指代。
            -->
            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.inputToolsConfig') }}</label>
                <p class="ms-tip">{{ $t('memo.inputToolsTip') }}</p>
                <textarea v-model="settingsDraft.inputTools" class="ms-textarea" rows="3" spellcheck="false"></textarea>
            </div>
            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.slashToolsConfig') }}</label>
                <p class="ms-tip">{{ $t('memo.slashToolsTip') }}</p>
                <textarea v-model="settingsDraft.slashTools" class="ms-textarea" rows="4" spellcheck="false"></textarea>
            </div>
            <!-- v1.3.2（需求）：右键与各类选中对象的工具配置 -->
            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.ctxToolsConfig') }}</label>
                <p class="ms-tip">{{ $t('memo.ctxToolsTip') }}</p>
                <textarea v-model="settingsDraft.rightClickTools" class="ms-textarea" rows="3" spellcheck="false"></textarea>
            </div>
            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.selTextToolsConfig') }}</label>
                <p class="ms-tip">{{ $t('memo.selToolsTip') }}</p>
                <textarea v-model="settingsDraft.selectionTools" class="ms-textarea" rows="3" spellcheck="false"></textarea>
            </div>
            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.selImageToolsConfig') }}</label>
                <textarea v-model="settingsDraft.selectImageTools" class="ms-textarea" rows="2" spellcheck="false"></textarea>
            </div>
            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.selVideoToolsConfig') }}</label>
                <textarea v-model="settingsDraft.selectVideoTools" class="ms-textarea" rows="2" spellcheck="false"></textarea>
            </div>
            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.selAudioToolsConfig') }}</label>
                <textarea v-model="settingsDraft.selectAudioTools" class="ms-textarea" rows="2" spellcheck="false"></textarea>
            </div>
            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.selFileToolsConfig') }}</label>
                <textarea v-model="settingsDraft.selectFileTools" class="ms-textarea" rows="2" spellcheck="false"></textarea>
            </div>
            <!--
                v1.3.2（需求）：原来的 H1-H6 数字输入框太小，改成多行 CSS。
                选择器会自动限定在编辑器正文区（.me-wysiwyg）内，不会污染全站样式。
            -->
            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.styleTitle') }}</label>
                <p class="ms-tip">{{ $t('memo.styleCssTip') }}</p>
                <textarea
                    v-model="settingsDraft.customCss"
                    class="ms-textarea ms-css-textarea"
                    rows="6"
                    spellcheck="false"
                    :placeholder="cssPlaceholder"
                ></textarea>
            </div>

            <!-- v1.3.1.2：滚动吸附（PC / 移动端各自独立） -->
            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.stickyTitle') }}</label>
                <p class="ms-tip">{{ $t('memo.stickyTip') }}</p>
                <div class="ms-sticky-table">
                    <div class="ms-sticky-head">
                        <span></span>
                        <span>{{ $t('memo.stickyPc') }}</span>
                        <span>{{ $t('memo.stickyMobile') }}</span>
                    </div>
                    <div v-for="row in stickyRows" :key="`st-${row.key}`" class="ms-sticky-row">
                        <span class="ms-sticky-name">{{ $t(row.label) }}</span>
                        <el-switch v-model="settingsDraft.sticky.pc[row.key]" size="small" />
                        <el-switch v-model="settingsDraft.sticky.m[row.key]" size="small" />
                    </div>
                </div>
            </div>
            <div class="ms-field ms-row">
                <div>
                    <label class="ms-label">{{ $t('memo.colorMode') }}</label>
                    <p class="ms-tip">{{ $t('memo.colorModeTip') }}</p>
                </div>
                <el-select v-model="settingsDraft.theme" style="width: 140px">
                    <el-option :label="$t('memo.themeAuto')" value="auto" />
                    <el-option :label="$t('memo.themeLight')" value="light" />
                    <el-option :label="$t('memo.themeDark')" value="dark" />
                </el-select>
            </div>
            <div class="ms-field ms-row">
                <div>
                    <label class="ms-label">{{ $t('memo.historyInterval') }}</label>
                    <p class="ms-tip">{{ $t('memo.historyIntervalTip') }}</p>
                </div>
                <el-input-number v-model="settingsDraft.historyInterval" :min="1" :max="120" :step="1" controls-position="right" style="width: 140px" />
            </div>
            <div class="ms-field ms-row">
                <div>
                    <label class="ms-label">{{ $t('memo.blockIds') }}</label>
                    <p class="ms-tip">{{ $t('memo.blockIdsTip') }}</p>
                </div>
                <el-switch v-model="settingsDraft.blockIds" />
            </div>
            <p class="ms-tip ms-owner">{{ $t('memo.settingsPerUser') }}</p>
            <template #footer>
                <el-button @click="settingsVisible = false">{{ $t('common.cancel') }}</el-button>
                <el-button type="primary" :loading="settingsSaving" @click="saveSettings">{{ $t('common.confirm') }}</el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script>
import { ElMessage } from 'element-plus';
import axios from '@/utils/axios';
import DashboardTabs from '@/components/DashboardTabs.vue';
import InstanceSwitchDialog from '@/components/InstanceSwitchDialog.vue';
import MomentPublishDialog from '@/components/notes/MomentPublishDialog.vue';
import MemoTree from '@/components/memo/MemoTree.vue';
import MemoList from '@/components/memo/MemoList.vue';
import MemoEditor from '@/components/memo/MemoEditor.vue';
import { DEFAULT_TOOLBAR_LINES, TOOLBAR_TOKENS } from '@/utils/memoEditorConfig';
import { setMemoInstance, fetchNote, createNote as apiCreateNote, memoError } from '@/utils/memoApi';
import { excerptOf } from '@/utils/markdown';
import { ensureInstanceUnlocked, revokeInstanceUnlock } from '@/utils/instanceSwitch';
import { setEmptyStackBackHandler } from '@/utils/layerStack';

export default {
    name: 'MemoPage',
    components: { DashboardTabs, MemoTree, MemoList, MemoEditor, InstanceSwitchDialog, MomentPublishDialog },
    data() {
        return {
            isMobile: false,
            /** 当前实例（'' = 默认实例），口径同其它后台页 */
            instance: '',
            /** '' 全部 / '__root' 未归档 / '__trash' 回收站 / 目录 id */
            activeFolder: '',
            folders: [],
            selectedId: '',
            currentNote: null,
            treeDrawer: false,
            settingsVisible: false,
            /** v1.3.2：刚复制的工具名（显示在可用工具列表最下方） */
            copiedTool: '',
            settingsSaving: false,
            editorSettings: {
                toolbarLines: DEFAULT_TOOLBAR_LINES.slice(),
                blockIds: false,
                // v1.3.1.1：配色 / 输入工具 / 斜杠菜单 / 历史间隔（与后端 normalizeEditorSettings 同结构）
                theme: 'auto',
                inputLines: [],
                slashLines: [],
                historyInterval: 3,
                // v1.3.1.2：样式与吸附默认值
                styles: { h1: 1.75, h2: 1.45, h3: 1.24, h4: 1.1, h5: 1, h6: 0.94, lineHeight: 1.75 },
                sticky: {
                    pc: { toolbar: false, title: false, aux: false },
                    m: { toolbar: false, title: false, aux: false },
                },
            },
            settingsDraft: {
                toolbar: '',
                blockIds: false,
                theme: 'auto',
                inputTools: '',
                slashTools: '',
                rightClickTools: '',
                selectionTools: '',
                selectImageTools: '',
                selectVideoTools: '',
                selectAudioTools: '',
                selectFileTools: '',
                historyInterval: 3,
                /* v1.3.1.2：标题与正文样式 */
                styles: { h1: 1.75, h2: 1.45, h3: 1.24, h4: 1.1, h5: 1, h6: 0.94, lineHeight: 1.75, customCss: '' },
                /* v1.3.2：自定义 CSS（草稿层单独放一份，确认后才写回 styles.customCss） */
                customCss: '',
                /* v1.3.1.2：PC / 移动端各自的吸附开关，默认全关 */
                sticky: {
                    pc: { toolbar: false, title: false, aux: false },
                    m: { toolbar: false, title: false, aux: false },
                },
            },
            /** 吸附表格的行定义（三行 × 两列终端） */
            stickyRows: [
                { key: 'toolbar', label: 'memo.stickyToolbar' },
                { key: 'title', label: 'memo.stickyTitleBar' },
                { key: 'aux', label: 'memo.stickyAux' },
            ],
            /* v1.3.1.2：从编辑器「发布到瞬间」带过去的正文 */
            momentDlgVisible: false,
            momentDraft: '',
            /* ── v1.3.1.1：切换实例 + 顶栏随滚动显隐 ── */
            showInstanceDialog: false,
            instances: [],
            topbarHidden: false,
            lastScrollTop: 0,
            /** v1.3.3：左侧目录栏宽度（桌面端可拖拽） */
            treeWidth: 210,
        };
    },
    computed: {
        /** v1.3.2：CSS 示例（不放 i18n —— 花括号会被当成插值占位符） */
        cssPlaceholder() {
            return 'h1 { font-size: 1.9em; color: #1f2937 }\np { line-height: 1.9 }';
        },
        /** v1.3.2：可用工具改成数组渲染，点一下即可复制 */
        availableToolList() {
            return Array.isArray(TOOLBAR_TOKENS) ? TOOLBAR_TOKENS : [];
        },

        /** 设置页里展示的「可用工具名」，与编辑器里的工具表同源，避免写死一份会漂移的文案 */
        availableTokens() {
            return TOOLBAR_TOKENS.join(' ');
        },
        instanceId() {
            /*
             * 实例 id 与其它后台页同一口径：读 localStorage 里「切换实例」写下的值。
             * 不放进 vuex —— 现有项目就是这么做的（见 NotesManagePage.readInstanceId），
             * 这里额外读一次 localStorage 是为了跨标签页切换实例后刷新生效。
             */
            return this.instance || '';
        },
        /** 抽屉里选目录 = 直接改同一个 activeFolder（避免两份状态不同步） */
        activeFolderDrawer: {
            get() {
                return this.activeFolder;
            },
            set(v) {
                this.activeFolder = v;
                this.treeDrawer = false;
            },
        },
        editingId() {
            return this.currentNote?.id || '';
        },
        /**
         * v1.3.1.2（需求）：配色模式选白天 / 黑夜时，笔记管理页的目录栏、列表栏、顶部栏
         * 也要一起跟着变 —— 只改编辑器会出现「正文是黑的、两边是白的」的割裂感。
         *
         * 「跟随全局」返回空串，页面继续用全站主题变量（不干预）。
         */
        pageThemeClass() {
            const t = this.editorSettings?.theme;
            if (t === 'light') return 'page-theme-light';
            if (t === 'dark') return 'page-theme-dark';
            return '';
        },
        /** 当前实例在「创建时间升序」里的序号（1-based；默认实例为 0，不显示角标） */
        instanceSeq() {
            const cur = String(this.instanceId || '');
            if (!cur) return 0;
            const idx = this.instances.findIndex((i) => String(i.id) === cur);
            return idx >= 0 ? idx + 1 : 0;
        },
    },
    watch: {
        activeFolder() {
            // 换目录时把编辑器清空：否则右栏显示的还是上一个目录里的笔记
            this.currentNote = null;
            this.selectedId = '';
        },
    },
    async mounted() {
        this.restoreTreeWidth();
        this.syncViewport();
        window.addEventListener('resize', this.syncViewport);
        /*
         * v1.3.1（需求）：移动端笔记编辑页禁止「屏幕边缘横滑 → 退出页面」。
         *
         * edgeSwipeGuard 把边缘横滑判成返回手势后，会先关浮层栈；栈里没有层时
         * 走这里的兜底。笔记页的兜底语义是：编辑中 → 回列表（一步，符合预期），
         * 已在列表 → 直接吃掉这次返回，**不再退回首页**。
         * 返回 true 表示「这次返回已被消费」，页面不会真的退出去。
         */
        setEmptyStackBackHandler(() => {
            if (this.isMobile && this.editingId) {
                this.backToList();
                return true;
            }
            return true;
        });
        try {
            this.instance = localStorage.getItem('gohub_instance_id') || '';
        } catch (e) {
            this.instance = '';
        }
        // 不 await：实例锁的解锁弹窗可能等用户输入，等它会拖慢整页首屏
        ensureInstanceUnlocked(this.instance).catch(() => {});
        setMemoInstance(this.instance);
        // v1.3.1.1：顶栏随滚动显隐 —— 用捕获阶段监听，滚动发生在列表/编辑器内部也能收到
        this.$nextTick(() => {
            const el = this.$refs.pageEl;
            if (el) el.addEventListener('scroll', this.onPageScroll, true);
        });
        this.fetchInstances();
        await this.loadSettings();
        // 深链：/memo?id=xxx 直接打开某篇（分享链接、刷新后恢复）
        const id = String(this.$route?.query?.id || '');
        if (id) await this.openNote(id);
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.syncViewport);
        const el = this.$refs.pageEl;
        if (el) el.removeEventListener('scroll', this.onPageScroll, true);
        // 兜底是全局单例，离开页面必须摘掉 —— 否则别的页面按 Esc 会莫名其妙没反应
        setEmptyStackBackHandler(null);
    },
    methods: {
        syncViewport() {
            this.isMobile = window.innerWidth <= 900;
        },
        onTreeLoaded(payload) {
            this.folders = payload?.folders || [];
        },
        async openNote(id) {
            if (!id) return;
            this.selectedId = id;
            try {
                const note = await fetchNote(id);
                // 详情里的 contentFormat 老数据是 ''（瞬间纯文本），笔记一律 markdown
                this.currentNote = note;
                if (this.$route?.query?.id !== id) {
                    this.$router.replace({ path: '/memo', query: { ...this.$route.query, id } }).catch(() => {});
                }
            } catch (e) {
                ElMessage.error(memoError(e).message || this.$t('memo.loadFail'));
            }
        },
        async reloadNote(id) {
            if (!id) return;
            const note = await fetchNote(id).catch(() => null);
            if (note) this.currentNote = note;
        },
        backToList() {
            this.currentNote = null;
            this.selectedId = '';
            if (this.$route?.query?.id) {
                const q = { ...this.$route.query };
                delete q.id;
                this.$router.replace({ path: '/memo', query: q }).catch(() => {});
            }
        },
        /* ── v1.3.1.1：切换实例（复刻「我的发布」） ───────────────── */

        /** 拉本人可见的实例列表（不含默认实例），按创建时间升序 —— 与瞬间页同一口径 */
        async fetchInstances() {
            try {
                const res = await axios.get('/api/instances');
                const list = Array.isArray(res.data) ? res.data : [];
                this.instances = [...list].sort((a, b) => {
                    const ta = new Date(a.createdAt).getTime() || 0;
                    const tb = new Date(b.createdAt).getTime() || 0;
                    return ta - tb;
                });
            } catch (e) {
                this.instances = [];
            }
        },
        openInstanceFromPageSwitch(closeFn) {
            this.showInstanceDialog = true;
            if (typeof closeFn === 'function') closeFn();
        },
        /**
         * 切换实例。
         *
         * 与「我的发布」完全一致：先过切换密码守卫 → 作废离开实例的通行证 →
         * 写 localStorage → 整页重载（所有与实例相关的数据重新按新实例拉一遍，
         * 不做「局部刷新」，避免漏掉某处缓存导致串实例）。
         */
        async switchInstanceTo(id) {
            const next = id == null ? '' : String(id);
            if (next === this.instanceId) {
                this.showInstanceDialog = false;
                return;
            }
            const ok = await ensureInstanceUnlocked(next);
            if (!ok) return;
            await revokeInstanceUnlock(this.instanceId);
            try {
                localStorage.setItem('gohub_instance_id', next);
            } catch (e) {
                /* 隐私模式忽略 */
            }
            this.instance = next;
            this.showInstanceDialog = false;
            this.$message.success(this.$t('instancePicker.switchSuccess'));
            setTimeout(() => window.location.reload(), 600);
        },
        /** 「实例管理」→ 用户编辑页的实例管理锚点（与瞬间页同一入口） */
        async openInstanceManagement() {
            const win = window.open('about:blank', '_blank');
            let url = '/customerConfig';
            try {
                const res = await axios.get('/api/manage/users');
                const list = Array.isArray(res.data) ? res.data : [];
                const me = this.$store?.getters?.sessionUser || '';
                const hit = me ? list.find((u) => u && u.username === me) : null;
                if (hit && hit.id !== undefined && hit.id !== null && hit.id !== '') {
                    url = `/customerConfig/edit/${encodeURIComponent(hit.id)}?anchor=instances`;
                }
            } catch (e) {
                /* 取不到就退回用户管理列表 */
            }
            try {
                win.location.href = url;
            } catch (e) {
                window.open(url, '_blank', 'noopener');
            }
        },
        /**
         * 顶栏随滚动显隐：下滑超过阈值收起，上滑立即展开。
         *
         * 滚动事件来自子容器（列表 / 编辑器正文），用捕获阶段统一收口；
         * `scroll` 不冒泡，但捕获阶段可以看到 —— 这是不往每个子组件塞回调的最小代价。
         */
        onPageScroll(e) {
            const el = e.target;
            if (!el || typeof el.scrollTop !== 'number') return;
            /*
             * v1.3.1.2（需求：滚到底部时顶部工具栏一直闪烁跳动）
             *
             * 原因是「收/展顶栏」本身会改变内容高度：顶栏收起 → 视口里的内容整体上移
             * → 浏览器把 scrollTop 夹回去 → 又触发一次 scroll 事件、方向与刚才相反
             * → 顶栏展开 → 高度再变……滚到最底部（或内容刚好够高）时这个循环会一直转，
             * 表现就是顶栏反复抽动。
             *
             * 三条刹车：
             *   1) 到底了就不再隐/显（底部本来就没有更多内容，收起毫无意义）；
             *   2) 每次切换后 400ms 内忽略事件，掐断震荡回路；
             *   3) 容器不可滚（内容比视口短）时直接不参与。
             */
            if (el.scrollHeight - el.clientHeight < 80) {
                if (this.topbarHidden) this.topbarHidden = false;
                return;
            }
            const top = el.scrollTop;
            const atBottom = el.scrollHeight - el.clientHeight - top <= 48;
            const last = el.__memoLastTop ?? 0;
            el.__memoLastTop = top;
            if (atBottom) {
                // 到底：一律展开，并记住当前方向，避免下一帧再判一次
                if (this.topbarHidden) this.topbarHidden = false;
                return;
            }
            if (Date.now() - (this._topbarLock || 0) < 400) return;
            if (Math.abs(top - last) < 8) return;
            if (top <= 40) {
                if (this.topbarHidden) this.topbarHidden = false;
                return;
            }
            const next = top > last;
            if (next !== this.topbarHidden) {
                this.topbarHidden = next;
                this._topbarLock = Date.now();
            }
        },
        /* ── v1.3.1.2：编辑器「发布到瞬间」 ─────────────────────── */
        onPublishMoment(text) {
            this.momentDraft = String(text || '');
            this.momentDlgVisible = true;
        },
        onMomentSaved() {
            this.momentDlgVisible = false;
            this.momentDraft = '';
            ElMessage.success(this.$t('memo.publishToMomentDone'));
        },

        async createNote() {
            try {
                const folderId = this.activeFolder && !this.activeFolder.startsWith('__') ? this.activeFolder : '';
                const r = await apiCreateNote({ title: '', content: '', folderId });
                if (!r?.id) throw new Error(this.$t('memo.saveFail'));
                // 立刻把新笔记塞进列表顶部，再打开它 —— 不重拉整页，体感是「点了就出现」
                this.$refs.list?.prependItem({
                    id: r.id,
                    title: '',
                    excerpt: '',
                    folderId,
                    charCount: 0,
                    version: r.version || 1,
                    status: 'published',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });
                await this.openNote(r.id);
            } catch (e) {
                ElMessage.error(memoError(e).message || this.$t('memo.saveFail'));
            }
        },
        onSaved(patch) {
            this.$refs.list?.patchItem(patch);
            if (this.currentNote) {
                this.currentNote.title = patch.title;
                // 保存成功后同步 version，避免下一次自动保存又被判成冲突
                this.currentNote.version = patch.version;
            }
        },
        onListChanged(payload) {
            if (payload?.removed && payload.removed === this.selectedId) {
                this.currentNote = null;
                this.selectedId = '';
            }
        },

        // ---------------- 编辑器设置 ----------------

        restoreTreeWidth() {
            try {
                const raw = Number(localStorage.getItem('gohub_memo_tree_width'));
                if (raw && raw >= 160 && raw <= 420) this.treeWidth = Math.round(raw);
            } catch (e) {
                /* 忽略 */
            }
        },
        async loadSettings() {
            try {
                const res = await axios.get('/api/notes/settings', { params: { instanceId: this.instanceId } });
                const editor = res?.data?.data?.editor || {};
                const lines = Array.isArray(editor.toolbarLines) && editor.toolbarLines.length
                    ? editor.toolbarLines.map((x) => String(x || ''))
                    : DEFAULT_TOOLBAR_LINES.slice();
                this.editorSettings = {
                    toolbarLines: lines,
                    blockIds: editor.blockIds === true,
                    theme: editor.theme === 'light' || editor.theme === 'dark' ? editor.theme : 'auto',
                    inputLines: Array.isArray(editor.inputLines) ? editor.inputLines.map((x) => String(x || '')) : [],
                    slashLines: Array.isArray(editor.slashLines) ? editor.slashLines.map((x) => String(x || '')) : [],
                    rightClickLines: Array.isArray(editor.rightClickLines) ? editor.rightClickLines.map((x) => String(x || '')) : [],
                    selectionLines: Array.isArray(editor.selectionLines) ? editor.selectionLines.map((x) => String(x || '')) : [],
                    selectImageLines: Array.isArray(editor.selectImageLines) ? editor.selectImageLines.map((x) => String(x || '')) : [],
                    selectVideoLines: Array.isArray(editor.selectVideoLines) ? editor.selectVideoLines.map((x) => String(x || '')) : [],
                    selectAudioLines: Array.isArray(editor.selectAudioLines) ? editor.selectAudioLines.map((x) => String(x || '')) : [],
                    selectFileLines: Array.isArray(editor.selectFileLines) ? editor.selectFileLines.map((x) => String(x || '')) : [],
                    historyInterval: Number(editor.historyInterval) > 0 ? Number(editor.historyInterval) : 3,
                    // v1.3.1.2：样式（后端已归一）
                    styles: {
                        h1: Number(editor?.styles?.h1) || 1.75,
                        h2: Number(editor?.styles?.h2) || 1.45,
                        h3: Number(editor?.styles?.h3) || 1.24,
                        h4: Number(editor?.styles?.h4) || 1.1,
                        h5: Number(editor?.styles?.h5) || 1,
                        h6: Number(editor?.styles?.h6) || 0.94,
                        lineHeight: Number(editor?.styles?.lineHeight) || 1.75,
                        customCss: String(editor?.styles?.customCss || ''),
                    },
                    // v1.3.1.2：吸附配置（后端已归一并保证结构完整，这里再兜一层）
                    sticky: {
                        pc: {
                            toolbar: !!editor?.sticky?.pc?.toolbar,
                            title: !!editor?.sticky?.pc?.title,
                            aux: !!editor?.sticky?.pc?.aux,
                        },
                        m: {
                            toolbar: !!editor?.sticky?.m?.toolbar,
                            title: !!editor?.sticky?.m?.title,
                            aux: !!editor?.sticky?.m?.aux,
                        },
                    },
                };
            } catch (e) {
                // 读不到就用默认值，不打扰用户
                this.editorSettings = {
                    toolbarLines: DEFAULT_TOOLBAR_LINES.slice(),
                    blockIds: false,
                    theme: 'auto',
                    inputLines: [],
                    slashLines: [],
                    rightClickLines: [],
                    selectionLines: [],
                    selectImageLines: [],
                    selectVideoLines: [],
                    selectAudioLines: [],
                    selectFileLines: [],
                    historyInterval: 3,
                    styles: { h1: 1.75, h2: 1.45, h3: 1.24, h4: 1.1, h5: 1, h6: 0.94, lineHeight: 1.75, customCss: '' },
                    sticky: {
                        pc: { toolbar: false, title: false, aux: false },
                        m: { toolbar: false, title: false, aux: false },
                    },
                };
            }
        },
        /** v1.3.3：拖动目录栏右边框改宽度 */
        startTreeResize(e) {
            const startX = e.clientX || 0;
            const startW = this.treeWidth;
            const move = (ev) => {
                const dx = (ev.clientX || 0) - startX;
                this.treeWidth = Math.round(Math.min(420, Math.max(160, startW + dx)));
            };
            const up = () => {
                document.removeEventListener('pointermove', move, true);
                document.removeEventListener('pointerup', up, true);
                document.body.classList.remove('is-col-resizing');
                try {
                    localStorage.setItem('gohub_memo_tree_width', String(this.treeWidth));
                } catch (err) {
                    /* 隐私模式忽略 */
                }
            };
            document.body.classList.add('is-col-resizing');
            document.addEventListener('pointermove', move, true);
            document.addEventListener('pointerup', up, true);
        },
        openSettings() {
            this.settingsDraft = {
                toolbar: this.editorSettings.toolbarLines.join('\n'),
                blockIds: this.editorSettings.blockIds,
                theme: this.editorSettings.theme || 'auto',
                inputTools: (this.editorSettings.inputLines || []).join('\n'),
                slashTools: (this.editorSettings.slashLines || []).join('\n'),
                rightClickTools: (this.editorSettings.rightClickLines || []).join('\n'),
                selectionTools: (this.editorSettings.selectionLines || []).join('\n'),
                selectImageTools: (this.editorSettings.selectImageLines || []).join('\n'),
                selectVideoTools: (this.editorSettings.selectVideoLines || []).join('\n'),
                selectAudioTools: (this.editorSettings.selectAudioLines || []).join('\n'),
                selectFileTools: (this.editorSettings.selectFileLines || []).join('\n'),
                historyInterval: this.editorSettings.historyInterval || 3,
                customCss: String(this.editorSettings.styles?.customCss || ''),
                styles: JSON.parse(JSON.stringify(this.editorSettings.styles || {
                    h1: 1.75, h2: 1.45, h3: 1.24, h4: 1.1, h5: 1, h6: 0.94, lineHeight: 1.75, customCss: '',
                })),
                // 深拷贝：弹窗里改开关不能立刻影响编辑器，点「确定」才生效
                sticky: JSON.parse(JSON.stringify(this.editorSettings.sticky || {
                    pc: { toolbar: false, title: false, aux: false },
                    m: { toolbar: false, title: false, aux: false },
                })),
            };
            this.settingsVisible = true;
        },
        /** v1.3.2：点工具名 → 复制，并在列表下方回显 */
        async copyToken(name) {
            const text = String(name || '');
            if (!text) return;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(text);
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                }
                this.copiedTool = text;
            } catch (e) {
                this.copiedTool = text;
            }
        },
        async saveSettings() {
            const lines = String(this.settingsDraft.toolbar || '')
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .slice(0, 4);
            this.settingsSaving = true;
            const splitLines = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);
            const editor = {
                toolbarLines: lines.length ? lines : DEFAULT_TOOLBAR_LINES.slice(),
                blockIds: !!this.settingsDraft.blockIds,
                theme: ['auto', 'light', 'dark'].includes(this.settingsDraft.theme) ? this.settingsDraft.theme : 'auto',
                inputLines: splitLines(this.settingsDraft.inputTools).slice(0, 8),
                slashLines: splitLines(this.settingsDraft.slashTools).slice(0, 12),
                rightClickLines: splitLines(this.settingsDraft.rightClickTools).slice(0, 12),
                selectionLines: splitLines(this.settingsDraft.selectionTools).slice(0, 12),
                selectImageLines: splitLines(this.settingsDraft.selectImageTools).slice(0, 8),
                selectVideoLines: splitLines(this.settingsDraft.selectVideoTools).slice(0, 8),
                selectAudioLines: splitLines(this.settingsDraft.selectAudioTools).slice(0, 8),
                selectFileLines: splitLines(this.settingsDraft.selectFileTools).slice(0, 8),
                historyInterval: Math.min(120, Math.max(1, Number(this.settingsDraft.historyInterval) || 3)),
                styles: {
                    ...JSON.parse(JSON.stringify(this.settingsDraft.styles || {
                        h1: 1.75, h2: 1.45, h3: 1.24, h4: 1.1, h5: 1, h6: 0.94, lineHeight: 1.75, customCss: '',
                    })),
                    // v1.3.2：CSS 在草稿里是顶层字段，落库要挂回 styles 下
                    customCss: String(this.settingsDraft.customCss || '').slice(0, 4000),
                },
                sticky: JSON.parse(JSON.stringify(this.settingsDraft.sticky || {
                    pc: { toolbar: false, title: false, aux: false },
                    m: { toolbar: false, title: false, aux: false },
                })),
            };
            try {
                await axios.put('/api/notes/settings', {
                    instanceId: this.instanceId,
                    editor,
                });
                this.editorSettings = { ...editor };
                this.settingsVisible = false;
                ElMessage.success(this.$t('memo.settingsSaved'));
            } catch (e) {
                ElMessage.error(e?.response?.data?.message || this.$t('memo.saveFail'));
            } finally {
                this.settingsSaving = false;
            }
        },
    },
};
</script>

<style scoped>
.memo-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    background: var(--el-bg-color-page);
    overflow: hidden;
}
.memo-topbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: var(--el-bg-color);
    border-bottom: 1px solid var(--el-border-color-lighter);
}
/* ── v1.3.1.2：配色模式联动整页（仅笔记管理页） ───────────────────
   只在编辑器设置选了白天 / 黑夜时挂类；「跟随全局」不加类，走全站变量。
   覆盖的是页面骨架用到的那几个变量 —— 目录栏、列表栏、顶栏、分隔线、hover 底色，
   这样三栏与编辑器不会一半黑一半白。 */
.memo-page.page-theme-dark {
    --el-bg-color: #16181d;
    --el-bg-color-page: #101216;
    --el-bg-color-overlay: #1f2228;
    --el-fill-color-blank: #16181d;
    --el-fill-color-light: #23262d;
    --el-fill-color-lighter: #1b1e24;
    --el-text-color-primary: #e6e8ec;
    --el-text-color-regular: #c3c7cf;
    --el-text-color-secondary: #8f96a3;
    --el-text-color-placeholder: #6b7280;
    --el-border-color: #2f333b;
    --el-border-color-light: #2a2e36;
    --el-border-color-lighter: #262a31;
    background: var(--el-bg-color-page);
}
.memo-page.page-theme-light {
    --el-bg-color: #ffffff;
    --el-bg-color-page: #f6f7f9;
    --el-bg-color-overlay: #ffffff;
    --el-fill-color-blank: #ffffff;
    --el-fill-color-light: #f2f3f5;
    --el-fill-color-lighter: #f7f8fa;
    --el-text-color-primary: #1f2329;
    --el-text-color-regular: #4b5563;
    --el-text-color-secondary: #6b7280;
    --el-border-color: #dcdfe6;
    --el-border-color-lighter: #e8eaee;
    background: var(--el-bg-color-page);
}

/* ── v1.3.1.1：顶栏随滚动显隐（下滑收起，上滑展开） ───────────── */
.memo-topbar {
    /*
     * v1.3.1.2（需求：左上角页面切换按钮层级不够、被遮挡）
     *
     * 上一版用 `overflow: hidden` + `max-height` 收起顶栏，副作用是把页面切换的
     * 下拉面板一起裁掉了 —— 面板是绝对定位、要溢出顶栏往下展开，于是被裁成一条缝，
     * 看起来就是「层级不够、被下面的列表盖住」。
     *
     * 现在改成用**负 margin 上移**收起：不需要裁剪，面板可以正常溢出；
     * 顶栏本身加 position/z-index，保证面板压在目录栏与列表栏之上。
     */
    position: relative;
    z-index: 60;
    overflow: visible;
    transition: margin-top 0.22s ease, opacity 0.18s ease;
}
.memo-page.is-topbar-hidden .memo-topbar {
    /* 收起：整行上移自身高度（含 padding 与边框约 55px），下面的三栏随之上提 */
    margin-top: -55px;
    opacity: 0;
    pointer-events: none;
}

/* ── 页面切换下拉里的「切换实例」条目（与瞬间管理页 / 图床管理页同款） ── */
.memo-page :deep(.page-option-sep) {
    flex: 0 0 auto;
    height: 1px;
    margin: 6px 4px;
    background: var(--el-border-color-lighter);
    opacity: 0.9;
}
.memo-page :deep(.admin-page-instance-option) {
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
.memo-page :deep(.admin-page-instance-option:hover) {
    color: var(--el-color-primary);
}
.memo-page :deep(.admin-page-instance-seq) {
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
.memo-page :deep(.admin-page-instance-icon) {
    font-size: 13px;
    opacity: 0.75;
}

.memo-topbar-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
}
.memo-icon-btn {
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-regular);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
}
.memo-icon-btn:hover {
    background: var(--el-fill-color);
    color: var(--el-color-primary);
}
.memo-cols {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    gap: 1px;
    background: var(--el-border-color-lighter);
}
.memo-col {
    background: var(--el-bg-color);
    min-height: 0;
    overflow: hidden;
}
.memo-col-tree {
    position: relative;
    /* v1.3.3：宽度由 treeWidth 行内样式覆盖，这里只是首帧兜底 */
    flex: 0 0 210px;
    max-width: 210px;
}
.memo-tree-resizer {
    position: absolute;
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    z-index: 5;
    cursor: col-resize;
    background: transparent;
}
.memo-tree-resizer:hover {
    background: var(--el-color-primary-light-7);
}
:global(body.is-col-resizing) {
    cursor: col-resize;
    user-select: none;
}
.memo-col-list {
    flex: 0 0 280px;
    max-width: 280px;
    border-left: 1px solid var(--el-border-color-lighter);
}
.memo-col-editor {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
}
.memo-blank {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--el-text-color-secondary);
}
.memo-blank-icon {
    font-size: 30px;
    opacity: 0.4;
}
.memo-blank-title {
    margin: 0;
    font-size: 13px;
}
.memo-blank-btn {
    padding: 6px 14px;
    border: none;
    border-radius: 6px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 13px;
    cursor: pointer;
}

/* 移动端：列表与编辑器互斥铺满 */
.memo-page.is-mobile .memo-cols {
    display: block;
}
.memo-page.is-mobile .memo-col-list,
.memo-page.is-mobile .memo-col-editor {
    max-width: none;
    width: 100%;
    height: 100%;
    border-left: none;
}
.memo-mobile-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--el-border-color-lighter);
}
.memo-mobile-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 设置弹窗 */
.ms-field {
    margin-bottom: 18px;
}
.ms-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}
.ms-label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    margin-bottom: 4px;
}
.ms-tip {
    margin: 0 0 6px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
}
/* v1.3.1.2：标题 / 正文样式网格 */
.ms-style-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
}
.ms-style-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--el-text-color-regular);
}
.ms-style-item > span {
    flex: 0 0 34px;
}
.ms-style-item :deep(.el-input-number) {
    flex: 1 1 auto;
    width: 100%;
}

/* v1.3.1.2：吸附开关表格（3 行 × PC / 移动端 两列） */
.ms-sticky-table {
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    overflow: hidden;
}
.ms-sticky-head,
.ms-sticky-row {
    display: grid;
    grid-template-columns: 1fr 72px 72px;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    font-size: 12.5px;
}
.ms-sticky-head {
    background: var(--el-fill-color-light);
    color: var(--el-text-color-secondary);
    font-size: 12px;
    text-align: center;
}
.ms-sticky-head > span:first-child {
    text-align: left;
}
.ms-sticky-row + .ms-sticky-row {
    border-top: 1px solid var(--el-border-color-lighter);
}
.ms-sticky-name {
    color: var(--el-text-color-regular);
}
.ms-sticky-row :deep(.el-switch) {
    justify-self: center;
}

/* v1.3.1.2：吸附开关表格（3 行 × PC / 移动端 两列） */
.ms-sticky-table {
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    overflow: hidden;
}
.ms-sticky-head,
.ms-sticky-row {
    display: grid;
    grid-template-columns: 1fr 72px 72px;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    font-size: 12.5px;
}
.ms-sticky-head {
    background: var(--el-fill-color-light);
    color: var(--el-text-color-secondary);
    font-size: 12px;
    text-align: center;
}
.ms-sticky-head > span:first-child {
    text-align: left;
}
.ms-sticky-row + .ms-sticky-row {
    border-top: 1px solid var(--el-border-color-lighter);
}
.ms-sticky-name {
    color: var(--el-text-color-regular);
}
.ms-sticky-row :deep(.el-switch) {
    justify-self: center;
}

.ms-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--el-border-color);
    border-radius: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--el-text-color-primary);
    background: var(--el-fill-color-blank);
    outline: none;
    resize: vertical;
}
.ms-textarea:focus {
    border-color: var(--el-color-primary);
}
.ms-avail code {
    font-size: 11px;
    word-break: break-all;
    opacity: 0.85;
}

/* v1.3.2：可用工具改成可点击的 chip，点一下就复制 */
.ms-token-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-height: 132px;
    overflow-y: auto;
    padding: 6px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    background: var(--el-fill-color-lighter);
}
.ms-token {
    padding: 2px 7px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 5px;
    background: var(--el-bg-color);
    color: var(--el-text-color-regular);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11.5px;
    line-height: 1.6;
    cursor: pointer;
}
.ms-token:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
}
.ms-copied {
    margin: 6px 0 0;
    font-size: 11.5px;
    color: var(--el-text-color-secondary);
}
.ms-css-textarea {
    min-height: 120px;
    line-height: 1.6;
}
</style>
