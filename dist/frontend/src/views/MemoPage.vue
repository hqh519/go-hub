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
        :class="{ 'is-mobile': isMobile, 'is-topbar-hidden': topbarHidden }"
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
            <aside v-if="!isMobile" class="memo-col memo-col-tree">
                <MemoTree v-model:active="activeFolder" :instance-id="instanceId" @loaded="onTreeLoaded" />
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
                <p class="ms-tip ms-avail">
                    {{ $t('memo.toolbarAvail') }}：<code>{{ availableTokens }}</code>
                </p>
            </div>
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
    components: { DashboardTabs, MemoTree, MemoList, MemoEditor, InstanceSwitchDialog },
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
            settingsSaving: false,
            editorSettings: {
                toolbarLines: DEFAULT_TOOLBAR_LINES.slice(),
                blockIds: false,
                // v1.3.1.1：配色 / 输入工具 / 斜杠菜单 / 历史间隔（与后端 normalizeEditorSettings 同结构）
                theme: 'auto',
                inputLines: [],
                slashLines: [],
                historyInterval: 3,
            },
            settingsDraft: {
                toolbar: '',
                blockIds: false,
                theme: 'auto',
                inputTools: '',
                slashTools: '',
                historyInterval: 3,
            },
            /* ── v1.3.1.1：切换实例 + 顶栏随滚动显隐 ── */
            showInstanceDialog: false,
            instances: [],
            topbarHidden: false,
            lastScrollTop: 0,
        };
    },
    computed: {
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
            const top = el.scrollTop;
            const last = el.__memoLastTop ?? 0;
            if (Math.abs(top - last) < 8) return;
            el.__memoLastTop = top;
            // 顶部 40px 内一律展开，避免刚滚一点就抖
            if (top <= 40) {
                this.topbarHidden = false;
                return;
            }
            this.topbarHidden = top > last;
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
                    historyInterval: Number(editor.historyInterval) > 0 ? Number(editor.historyInterval) : 3,
                };
            } catch (e) {
                // 读不到就用默认值，不打扰用户
                this.editorSettings = {
                    toolbarLines: DEFAULT_TOOLBAR_LINES.slice(),
                    blockIds: false,
                    theme: 'auto',
                    inputLines: [],
                    slashLines: [],
                    historyInterval: 3,
                };
            }
        },
        openSettings() {
            this.settingsDraft = {
                toolbar: this.editorSettings.toolbarLines.join('\n'),
                blockIds: this.editorSettings.blockIds,
                theme: this.editorSettings.theme || 'auto',
                inputTools: (this.editorSettings.inputLines || []).join('\n'),
                slashTools: (this.editorSettings.slashLines || []).join('\n'),
                historyInterval: this.editorSettings.historyInterval || 3,
            };
            this.settingsVisible = true;
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
                historyInterval: Math.min(120, Math.max(1, Number(this.settingsDraft.historyInterval) || 3)),
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
/* ── v1.3.1.1：顶栏随滚动显隐（下滑收起，上滑展开） ───────────── */
.memo-topbar {
    /*
     * 用 max-height 收起来而不是 transform：transform 只是视觉上移走，
     * 列表区上方仍留着一条与页面底色不同的空带，看着像「页面坏了」。
     * 收起时 padding / 边框一起归零，三栏就能顶到窗口最上面。
     */
    overflow: hidden;
    max-height: 64px;
    transition: max-height 0.22s ease, padding 0.22s ease, opacity 0.18s ease;
}
.memo-page.is-topbar-hidden .memo-topbar {
    max-height: 0;
    padding-top: 0;
    padding-bottom: 0;
    opacity: 0;
    border-bottom-color: transparent;
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
    flex: 0 0 210px;
    max-width: 210px;
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
</style>
