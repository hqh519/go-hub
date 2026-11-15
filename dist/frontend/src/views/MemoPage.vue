<template>
    <!--
        笔记管理页（v1.3.0）—— /memo
        ----------------------------------------------------------------------------
        三栏：左目录 / 中列表 / 右编辑器。
        移动端（<=900px）改成「列表 → 编辑」两级，目录放进抽屉：
        硬塞三栏在手机上每栏只有 100px 宽，谁也看不清。
    -->
    <div class="memo-page" :class="{ 'is-mobile': isMobile }">
        <div class="memo-topbar">
            <DashboardTabs active-tab="memo" />
            <div class="memo-topbar-right">
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
                <div v-if="isMobile && editingId" class="memo-mobile-bar">
                    <button type="button" class="memo-icon-btn" @click="backToList">
                        <font-awesome-icon icon="chevron-left" />
                    </button>
                    <span class="memo-mobile-title">{{ currentNote?.title || $t('memo.untitled') }}</span>
                </div>
                <MemoEditor
                    v-if="currentNote"
                    ref="editor"
                    :note="currentNote"
                    :instance-id="instanceId"
                    :toolbar-config="editorSettings.toolbarLines"
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
            <div class="ms-field ms-row">
                <div>
                    <label class="ms-label">{{ $t('memo.blockIds') }}</label>
                    <p class="ms-tip">{{ $t('memo.blockIdsTip') }}</p>
                </div>
                <el-switch v-model="settingsDraft.blockIds" />
            </div>
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
import MemoTree from '@/components/memo/MemoTree.vue';
import MemoList from '@/components/memo/MemoList.vue';
import MemoEditor from '@/components/memo/MemoEditor.vue';
import { DEFAULT_TOOLBAR_LINES, TOOLBAR_TOKENS } from '@/utils/memoEditorConfig';
import { setMemoInstance, fetchNote, createNote as apiCreateNote, memoError } from '@/utils/memoApi';
import { excerptOf } from '@/utils/markdown';
import { ensureInstanceUnlocked } from '@/utils/instanceSwitch';
import { setEmptyStackBackHandler } from '@/utils/layerStack';

export default {
    name: 'MemoPage',
    components: { DashboardTabs, MemoTree, MemoList, MemoEditor },
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
            editorSettings: { toolbarLines: DEFAULT_TOOLBAR_LINES.slice(), blockIds: false },
            settingsDraft: { toolbar: '', blockIds: false },
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
        await this.loadSettings();
        // 深链：/memo?id=xxx 直接打开某篇（分享链接、刷新后恢复）
        const id = String(this.$route?.query?.id || '');
        if (id) await this.openNote(id);
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.syncViewport);
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
                this.editorSettings = { toolbarLines: lines, blockIds: editor.blockIds === true };
            } catch (e) {
                // 读不到就用默认值，不打扰用户
                this.editorSettings = { toolbarLines: DEFAULT_TOOLBAR_LINES.slice(), blockIds: false };
            }
        },
        openSettings() {
            this.settingsDraft = {
                toolbar: this.editorSettings.toolbarLines.join('\n'),
                blockIds: this.editorSettings.blockIds,
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
            try {
                await axios.put('/api/notes/settings', {
                    instanceId: this.instanceId,
                    editor: { toolbarLines: lines.length ? lines : DEFAULT_TOOLBAR_LINES.slice(), blockIds: !!this.settingsDraft.blockIds },
                });
                this.editorSettings = {
                    toolbarLines: lines.length ? lines : DEFAULT_TOOLBAR_LINES.slice(),
                    blockIds: !!this.settingsDraft.blockIds,
                };
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
