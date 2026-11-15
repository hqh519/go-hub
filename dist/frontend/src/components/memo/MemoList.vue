<template>
    <!--
        笔记列表（v1.3.0）
        ----------------------------------------------------------------------------
        中栏：当前目录下的笔记。列表接口**不含正文**（后端 select 投影），
        摘要与字数都是保存时算好写进 metas 的冗余值 —— 一屏几十篇也不会把几万字正文拉下来。
    -->
    <div class="ml-root">
        <div class="ml-head">
            <div class="ml-search">
                <font-awesome-icon icon="search" class="ml-search-icon" />
                <input
                    v-model="search"
                    class="ml-search-input"
                    :placeholder="$t('memo.searchPlaceholder')"
                    @input="onSearchInput"
                />
                <button v-if="search" type="button" class="ml-search-clear" @click="clearSearch">
                    <font-awesome-icon icon="times" />
                </button>
            </div>
            <button v-if="!isTrash" type="button" class="ml-new" :title="$t('memo.newNote')" @click="$emit('create')">
                <font-awesome-icon icon="plus" />
            </button>
        </div>

        <div ref="scrollEl" class="ml-list" @scroll="onScroll">
            <div v-if="loading && !notes.length" class="ml-empty">
                <font-awesome-icon icon="spinner" spin />
            </div>
            <template v-else-if="notes.length">
                <div
                    v-for="n in notes"
                    :key="n.id"
                    class="ml-item"
                    :class="{ 'is-active': n.id === activeId }"
                    @click="$emit('select', n.id)"
                >
                    <div class="ml-item-main">
                        <div class="ml-item-title">{{ n.title || $t('memo.untitled') }}</div>
                        <div v-if="n.excerpt" class="ml-item-excerpt">{{ n.excerpt }}</div>
                        <div class="ml-item-meta">
                            <span>{{ formatTime(n.updatedAt) }}</span>
                            <span v-if="n.charCount">· {{ $t('memo.charUnit', { n: n.charCount }) }}</span>
                        </div>
                    </div>
                    <el-dropdown trigger="click" class="ml-item-more" @command="(cmd) => onCommand(cmd, n)" @click.stop>
                        <button type="button" class="ml-more-btn" @click.stop>
                            <font-awesome-icon icon="ellipsis-h" />
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <template v-if="isTrash">
                                    <el-dropdown-item command="restore">{{ $t('memo.restore') }}</el-dropdown-item>
                                    <el-dropdown-item command="purge" divided>{{ $t('memo.purge') }}</el-dropdown-item>
                                </template>
                                <template v-else>
                                    <el-dropdown-item command="move" :disabled="!folders.length">{{ $t('memo.moveTo') }}</el-dropdown-item>
                                    <el-dropdown-item command="trash" divided>{{ $t('memo.toTrash') }}</el-dropdown-item>
                                </template>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </div>
                <div v-if="loadingMore" class="ml-more">
                    <font-awesome-icon icon="spinner" spin />
                </div>
                <div v-else-if="notes.length < total" class="ml-more-btn-row">
                    <button type="button" class="ml-load-more" @click="loadMore">{{ $t('memo.loadMore') }}</button>
                </div>
            </template>
            <div v-else class="ml-empty">
                <font-awesome-icon icon="file-lines" class="ml-empty-icon" />
                <p class="ml-empty-title">{{ isTrash ? $t('memo.trashEmpty') : $t('memo.empty') }}</p>
                <p v-if="!isTrash" class="ml-empty-tip">{{ $t('memo.emptyTip') }}</p>
            </div>
        </div>

        <!-- 移动到目录 -->
        <el-dialog v-model="moveVisible" :title="$t('memo.moveTo')" width="360px" append-to-body>
            <el-tree
                :data="moveTree"
                node-key="id"
                :props="{ label: 'name', children: 'children' }"
                :expand-on-click-node="false"
                highlight-current
                :empty-text="$t('memo.noFolder')"
                @node-click="onMovePick"
            />
            <p class="ml-move-hint">{{ $t('memo.moveHint') }}</p>
        </el-dialog>
    </div>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus';
import { fetchNotes, moveNote, trashNote, restoreNote, purgeNote } from '@/utils/memoApi';
import { buildTree } from '@/utils/memoTree';

const PAGE_SIZE = 50;

export default {
    name: 'MemoList',
    props: {
        folderId: { type: String, default: '' },
        activeId: { type: String, default: '' },
        folders: { type: Array, default: () => [] },
    },
    emits: ['select', 'create', 'changed'],
    data() {
        return {
            notes: [],
            total: 0,
            page: 1,
            loading: false,
            loadingMore: false,
            search: '',
            searchTimer: null,
            moveVisible: false,
            moveTarget: null,
        };
    },
    computed: {
        isTrash() {
            return this.folderId === '__trash';
        },
        moveTree() {
            // 「未归档」作为树的一个正常节点参与选择，id 用空串表示
            return [{ id: '', name: this.$t('memo.unfiled'), total: '', children: buildTree(this.folders) }];
        },
    },
    watch: {
        folderId() {
            this.page = 1;
            this.load();
        },
    },
    mounted() {
        this.load();
    },
    methods: {
        async load(append = false) {
            if (append) this.loadingMore = true;
            else this.loading = true;
            try {
                const r = await fetchNotes({
                    folderId: this.folderId,
                    search: this.search,
                    status: this.isTrash ? 'deleted' : '',
                    page: this.page,
                    pageSize: PAGE_SIZE,
                });
                const list = r?.list || [];
                this.notes = append ? [...this.notes, ...list] : list;
                this.total = Number(r?.total) || 0;
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.loadFail'));
            } finally {
                this.loading = false;
                this.loadingMore = false;
            }
        },
        reload() {
            this.page = 1;
            return this.load();
        },
        loadMore() {
            if (this.loadingMore) return;
            this.page += 1;
            this.load(true);
        },
        onScroll() {
            // 列表本身有滚动条，滑到底自动续一页；后端按 updatedAt 排序，不会重复
            const el = this.$refs.scrollEl;
            if (!el || this.loading || this.loadingMore) return;
            if (this.notes.length >= this.total) return;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) this.loadMore();
        },
        onSearchInput() {
            if (this.searchTimer) clearTimeout(this.searchTimer);
            this.searchTimer = setTimeout(() => {
                this.page = 1;
                this.load();
            }, 300);
        },
        clearSearch() {
            this.search = '';
            this.page = 1;
            this.load();
        },
        formatTime(ts) {
            const t = Number(ts) || 0;
            if (!t) return '';
            const d = new Date(t);
            const now = new Date();
            const sameYear = d.getFullYear() === now.getFullYear();
            const pad = (n) => String(n).padStart(2, '0');
            return sameYear
                ? `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
                : `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
        },
        onCommand(cmd, note) {
            if (cmd === 'move') {
                this.moveTarget = note;
                this.moveVisible = true;
                return;
            }
            if (cmd === 'trash') return this.doTrash(note);
            if (cmd === 'restore') return this.doRestore(note);
            if (cmd === 'purge') return this.doPurge(note);
        },
        async onMovePick(node) {
            if (!this.moveTarget) return;
            try {
                await moveNote(this.moveTarget.id, node.id || '');
                this.moveVisible = false;
                this.$emit('changed');
                await this.reload();
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.saveFail'));
            }
        },
        async doTrash(note) {
            try {
                await ElMessageBox.confirm(this.$t('memo.trashTip', { title: note.title || this.$t('memo.untitled') }), this.$t('memo.toTrash'), {
                    type: 'warning',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                });
            } catch (e) {
                return;
            }
            try {
                await trashNote(note.id);
                this.$emit('changed', { removed: note.id });
                await this.reload();
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.saveFail'));
            }
        },
        async doRestore(note) {
            try {
                await restoreNote(note.id);
                this.$emit('changed');
                await this.reload();
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.saveFail'));
            }
        },
        async doPurge(note) {
            try {
                await ElMessageBox.confirm(this.$t('memo.purgeTip'), this.$t('memo.purge'), {
                    type: 'error',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                });
            } catch (e) {
                return;
            }
            try {
                await purgeNote(note.id);
                this.$emit('changed', { removed: note.id });
                await this.reload();
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.saveFail'));
            }
        },
        /** 编辑器保存后回填列表项（避免每 1.5 秒自动保存就重拉整页） */
        patchItem(patch) {
            const hit = this.notes.find((n) => n.id === patch.id);
            if (!hit) return;
            if (patch.title !== undefined) hit.title = patch.title;
            if (patch.updatedAt) hit.updatedAt = patch.updatedAt;
            if (patch.charCount !== undefined) hit.charCount = patch.charCount;
        },
        prependItem(item) {
            this.notes = [item, ...this.notes];
            this.total += 1;
        },
    },
};
</script>

<style scoped>
.ml-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}
.ml-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--el-border-color-lighter);
}
.ml-search {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--el-fill-color-light);
}
.ml-search-icon {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.ml-search-input {
    flex: 1 1 auto;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 13px;
    color: var(--el-text-color-primary);
}
.ml-search-clear {
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 11px;
    color: var(--el-text-color-secondary);
    padding: 0;
}
.ml-new {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: var(--el-color-primary);
    color: #fff;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
}
.ml-new:hover {
    background: var(--el-color-primary-dark-2);
}
.ml-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 4px 6px 20px;
}
.ml-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 8px 8px;
    border-radius: 6px;
    cursor: pointer;
}
.ml-item:hover {
    background: var(--el-fill-color-light);
}
.ml-item.is-active {
    background: var(--el-color-primary-light-9);
}
.ml-item-main {
    flex: 1 1 auto;
    min-width: 0;
}
.ml-item-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ml-item-excerpt {
    margin-top: 3px;
    font-size: 12px;
    line-height: 1.55;
    color: var(--el-text-color-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.ml-item-meta {
    margin-top: 4px;
    font-size: 11px;
    color: var(--el-text-color-placeholder);
    display: flex;
    gap: 6px;
}
.ml-item-more {
    flex: 0 0 auto;
    opacity: 0;
}
.ml-item:hover .ml-item-more,
.ml-item.is-active .ml-item-more {
    opacity: 1;
}
.ml-more-btn {
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--el-text-color-secondary);
    padding: 2px;
    font-size: 12px;
}
.ml-empty {
    padding: 48px 16px;
    text-align: center;
    color: var(--el-text-color-secondary);
}
.ml-empty-icon {
    font-size: 28px;
    opacity: 0.5;
}
.ml-empty-title {
    margin: 10px 0 4px;
    font-size: 13px;
}
.ml-empty-tip {
    margin: 0;
    font-size: 12px;
    opacity: 0.75;
}
.ml-more,
.ml-more-btn-row {
    padding: 10px;
    text-align: center;
}
.ml-load-more {
    border: none;
    background: transparent;
    color: var(--el-color-primary);
    font-size: 12px;
    cursor: pointer;
}
.ml-move-hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
</style>
