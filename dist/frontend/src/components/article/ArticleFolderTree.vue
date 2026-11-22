<template>
    <!--
        文章分类树（v1.4.0）
        ----------------------------------------------------------------------------
        传统的文件夹结构：文章与待办各有一棵独立的树（后端按 type 分开）。

        结构对照记事页左栏（需求：可以直接复刻 /memo 的左栏）：
          · 顶部标题 + 「新建分类」+「全部收起 / 展开」；
          · 搜索框；
          · 固定两项「全部 / 未分类」——它们不是真实目录，用 __all / __unfiled 表示；
          · 树本身可拖拽换位、可拖进别的分类（同级排序与移动都走同一个接口）；
          · 底部「回收站」。
    -->
    <div class="aft-root">
        <div class="aft-head">
            <span class="aft-title">{{ type === 'todo' ? $t('article.todoTreeTitle') : $t('article.treeTitle') }}</span>
            <div class="aft-head-actions">
                <button
                    type="button"
                    class="aft-head-btn"
                    :title="allExpanded ? $t('memo.collapseAll') : $t('memo.expandAll')"
                    @click="toggleAll"
                >
                    <font-awesome-icon :icon="allExpanded ? 'angles-up' : 'angles-down'" />
                </button>
                <button type="button" class="aft-head-btn" :title="$t('article.newFolder')" @click="createRoot">
                    <font-awesome-icon icon="folder-plus" />
                </button>
            </div>
        </div>

        <div class="aft-search">
            <font-awesome-icon icon="search" class="aft-search-icon" />
            <input
                v-model="search"
                class="aft-search-input"
                type="text"
                :placeholder="$t('article.searchFolder')"
                @input="applyFilter"
            />
            <button v-if="search" type="button" class="aft-search-clear" @click="clearSearch">
                <font-awesome-icon icon="times" />
            </button>
        </div>

        <div class="aft-fixed">
            <button
                type="button"
                class="aft-fixed-item"
                :class="{ 'is-active': active === '__all' }"
                @click="$emit('select', '__all')"
            >
                <font-awesome-icon :icon="type === 'todo' ? 'list-check' : 'file-lines'" class="aft-fixed-icon" />
                <span class="aft-fixed-name">{{ type === 'todo' ? $t('article.allTodos') : $t('article.allArticles') }}</span>
                <span v-if="total" class="aft-count">{{ total }}</span>
            </button>
            <button
                type="button"
                class="aft-fixed-item"
                :class="{ 'is-active': active === '__unfiled' }"
                @click="$emit('select', '__unfiled')"
            >
                <font-awesome-icon icon="folder-open" class="aft-fixed-icon" />
                <span class="aft-fixed-name">{{ $t('article.unfiled') }}</span>
                <span v-if="unfiled" class="aft-count">{{ unfiled }}</span>
            </button>
        </div>

        <div class="aft-tree">
            <el-tree
                ref="tree"
                :data="treeData"
                node-key="id"
                :indent="0"
                :props="{ label: 'name', children: 'children' }"
                :expand-on-click-node="false"
                :default-expanded-keys="expandedKeys"
                :current-node-key="active"
                :filter-node-method="filterNode"
                highlight-current
                draggable
                :allow-drop="allowDrop"
                :empty-text="$t('article.emptyFolder')"
                @node-click="onNodeClick"
                @node-drop="onNodeDrop"
            >
                <template #default="{ node, data }">
                    <div class="aft-node" :class="{ 'is-current': data.id === active }">
                        <span class="aft-node-main" @click.stop="onNodeClick(data)">
                            <font-awesome-icon
                                :icon="node.expanded && hasChildren(data) ? 'folder-open' : 'folder'"
                                class="aft-node-icon"
                            />
                            <span class="aft-node-name" :title="data.name">{{ data.name }}</span>
                        </span>
                        <span v-if="data.totalCount" class="aft-count">{{ data.totalCount }}</span>
                        <el-dropdown
                            trigger="click"
                            class="aft-node-more"
                            @command="(cmd) => onCommand(cmd, data)"
                            @click.stop
                        >
                            <button type="button" class="aft-more-btn" @click.stop>
                                <font-awesome-icon icon="ellipsis-v" />
                            </button>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item command="child">{{ $t('article.newSubFolder') }}</el-dropdown-item>
                                    <el-dropdown-item command="rename">{{ $t('article.renameFolder') }}</el-dropdown-item>
                                    <el-dropdown-item command="delete" divided>{{ $t('article.deleteFolder') }}</el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>
                    </div>
                </template>
            </el-tree>
        </div>

        <div class="aft-foot">
            <button
                type="button"
                class="aft-trash"
                :class="{ 'is-active': active === '__trash' }"
                @click="$emit('select', '__trash')"
            >
                <font-awesome-icon icon="trash" />
                <span>{{ $t('memo.trash') }}</span>
            </button>
        </div>
    </div>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus';
import { fetchFolders, createFolder, updateFolder, deleteFolder, reorderFolders, articleError } from '@/utils/articleApi';

export default {
    name: 'ArticleFolderTree',
    props: {
        /** article | todo —— 两套分类树互不相干 */
        type: { type: String, default: 'article' },
        /** 当前选中：'__all' / '__unfiled' / '__trash' / 分类 id */
        active: { type: String, default: '__all' },
        instanceId: { type: String, default: '' },
    },
    emits: ['select', 'loaded', 'changed'],
    data() {
        return {
            nodes: [],
            unfiled: 0,
            total: 0,
            search: '',
            expandedKeys: [],
            allExpanded: false,
        };
    },
    computed: {
        treeData() {
            const byParent = new Map();
            for (const n of this.nodes) {
                const p = n.parentId || '';
                if (!byParent.has(p)) byParent.set(p, []);
                byParent.get(p).push({ ...n, children: [] });
            }
            const build = (pid) => {
                const list = byParent.get(pid) || [];
                return list.map((n) => ({ ...n, children: build(n.id) }));
            };
            return build('');
        },
    },
    watch: {
        type() {
            this.reload();
        },
    },
    mounted() {
        this.reload();
    },
    methods: {
        hasChildren(data) {
            return Array.isArray(data.children) && data.children.length > 0;
        },
        async reload() {
            try {
                const r = await fetchFolders(this.type);
                this.nodes = Array.isArray(r?.nodes) ? r.nodes : [];
                this.unfiled = Number(r?.unfiled) || 0;
                this.total = Number(r?.total) || 0;
                this.$emit('loaded', { nodes: this.nodes, unfiled: this.unfiled, total: this.total });
            } catch (e) {
                this.nodes = [];
                ElMessage.error(articleError(e).message || this.$t('article.loadFail'));
            }
        },
        onNodeClick(data) {
            if (!data?.id) return;
            this.$emit('select', String(data.id));
        },
        applyFilter() {
            this.$refs.tree?.filter?.(this.search);
        },
        filterNode(value, data) {
            if (!value) return true;
            return String(data.name || '').toLowerCase().includes(String(value).toLowerCase());
        },
        clearSearch() {
            this.search = '';
            this.applyFilter();
        },
        toggleAll() {
            this.allExpanded = !this.allExpanded;
            if (this.allExpanded) {
                this.expandedKeys = this.nodes.map((n) => n.id);
                // el-tree 的 default-expanded-keys 只在初始化时生效，这里逐个展开
                this.$nextTick(() => {
                    const store = this.$refs.tree?.store;
                    if (store) this.nodes.forEach((n) => store.nodesMap?.[n.id] && (store.nodesMap[n.id].expanded = true));
                });
            } else {
                this.expandedKeys = [];
                this.$nextTick(() => {
                    const store = this.$refs.tree?.store;
                    if (store) this.nodes.forEach((n) => store.nodesMap?.[n.id] && (store.nodesMap[n.id].expanded = false));
                });
            }
        },
        async createRoot() {
            await this.promptCreate('');
        },
        async promptCreate(parentId) {
            let name = '';
            try {
                const r = await ElMessageBox.prompt(this.$t('article.folderNameTip'), this.$t('article.newFolder'), {
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    inputPlaceholder: this.$t('article.folderNamePlaceholder'),
                    inputValue: '',
                });
                name = String(r.value || '').trim();
            } catch (e) {
                return;
            }
            if (!name) return;
            try {
                const r = await createFolder({ type: this.type, name, parentId: parentId || '' });
                await this.reload();
                this.$emit('changed');
                if (r?.id) this.$emit('select', String(r.id));
                ElMessage.success(this.$t('article.folderCreated'));
            } catch (e) {
                ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
            }
        },
        async onCommand(cmd, data) {
            if (cmd === 'child') return this.promptCreate(data.id);
            if (cmd === 'rename') {
                let name = '';
                try {
                    const r = await ElMessageBox.prompt(this.$t('article.folderNameTip'), this.$t('article.renameFolder'), {
                        confirmButtonText: this.$t('common.confirm'),
                        cancelButtonText: this.$t('common.cancel'),
                        inputValue: data.name,
                    });
                    name = String(r.value || '').trim();
                } catch (e) {
                    return;
                }
                if (!name || name === data.name) return;
                try {
                    await updateFolder(data.id, { name, type: this.type });
                    await this.reload();
                    this.$emit('changed');
                } catch (e) {
                    ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
                }
                return;
            }
            if (cmd === 'delete') {
                try {
                    await ElMessageBox.confirm(this.$t('article.deleteFolderTip', { name: data.name }), this.$t('article.deleteFolder'), {
                        type: 'warning',
                        confirmButtonText: this.$t('common.confirm'),
                        cancelButtonText: this.$t('common.cancel'),
                    });
                } catch (e) {
                    return;
                }
                try {
                    await deleteFolder(data.id, this.type);
                    if (this.active === data.id) this.$emit('select', '__all');
                    await this.reload();
                    this.$emit('changed');
                    ElMessage.success(this.$t('article.folderDeleted'));
                } catch (e) {
                    ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
                }
            }
        },
        async onNodeDrop(dragging, drop, type) {
            /*
             * 拖拽的两件事：
             *   · inner  → 移动进目标分类（改 parentId，排到末尾）；
             *   · before / after → 同级换位（改 sort）。
             * 服务端对「挂到自己子孙下」有防环校验，前端这里不做重复判断。
             */
            const dragId = String(dragging?.data?.id || '');
            const dropId = String(drop?.data?.id || '');
            if (!dragId || !dropId) return;
            try {
                if (type === 'inner') {
                    await updateFolder(dragId, { parentId: dropId, type: this.type });
                } else {
                    const parentId = String(drop?.data?.parentId || '');
                    const siblings = this.nodes
                        .filter((n) => String(n.parentId || '') === parentId && n.id !== dragId)
                        .map((n) => String(n.id));
                    const at = siblings.indexOf(dropId);
                    const ids = siblings.slice();
                    ids.splice(type === 'before' ? Math.max(0, at) : at + 1, 0, dragId);
                    await reorderFolders({ type: this.type, parentId, ids });
                }
                await this.reload();
                this.$emit('changed');
            } catch (e) {
                ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
                await this.reload();
            }
        },
        allowDrop() {
            // 不做前端限制：防环由服务端判断，前端拦反而会让「拖回根级」变得不可能
            return true;
        },
    },
};
</script>

<style scoped>
.aft-root {
    display: flex;
    /* 全站后台有若干处 text-align: center 的继承，这里显式归左，避免列表文字居中 */
    text-align: left;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--el-bg-color);
}
.aft-head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px 6px;
}
.aft-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--el-text-color-primary);
    letter-spacing: 0.02em;
}
.aft-head-actions {
    margin-left: auto;
    display: flex;
    gap: 2px;
}
.aft-head-btn {
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 12px;
    cursor: pointer;
}
.aft-head-btn:hover {
    background: var(--el-fill-color);
    color: var(--el-color-primary);
}
.aft-search {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 10px 6px;
    padding: 0 8px;
    height: 28px;
    border-radius: 8px;
    background: var(--el-fill-color-light);
}
.aft-search-icon {
    font-size: 11px;
    color: var(--el-text-color-placeholder);
}
.aft-search-input {
    flex: 1 1 auto;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 12.5px;
    color: var(--el-text-color-primary);
}
.aft-search-clear {
    border: none;
    background: transparent;
    color: var(--el-text-color-placeholder);
    cursor: pointer;
    font-size: 11px;
}
.aft-fixed {
    flex: 0 0 auto;
    padding: 0 8px 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.aft-fixed-item {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
}
.aft-fixed-item:hover {
    background: var(--el-fill-color-light);
}
.aft-fixed-item.is-active {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    font-weight: 600;
}
.aft-fixed-icon {
    font-size: 12px;
    opacity: 0.8;
}
.aft-fixed-name {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.aft-count {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--el-text-color-placeholder);
    font-variant-numeric: tabular-nums;
}
.aft-tree {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 0 6px 8px;
    overscroll-behavior: contain;
}
.aft-tree :deep(.el-tree) {
    background: transparent;
}
.aft-tree :deep(.el-tree-node__content) {
    height: 30px;
    border-radius: 7px;
}
.aft-tree :deep(.el-tree-node__content:hover) {
    background: var(--el-fill-color-light);
}
.aft-tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
    background: var(--el-color-primary-light-9);
}
.aft-node {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    min-width: 0;
    padding-right: 4px;
}
.aft-node-main {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    flex: 1 1 auto;
    padding-left: 4px;
}
.aft-node-icon {
    flex: 0 0 auto;
    font-size: 12.5px;
    color: var(--el-color-primary);
    opacity: 0.85;
}
.aft-node-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    color: var(--el-text-color-primary);
}
.aft-node.is-current .aft-node-name {
    color: var(--el-color-primary);
    font-weight: 600;
}
.aft-more-btn {
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--el-text-color-placeholder);
    cursor: pointer;
    font-size: 11px;
    opacity: 0;
}
.aft-node:hover .aft-more-btn {
    opacity: 1;
}
.aft-more-btn:hover {
    background: var(--el-fill-color);
    color: var(--el-color-primary);
}
.aft-foot {
    flex: 0 0 auto;
    padding: 6px 10px 8px;
    border-top: 1px solid var(--el-border-color-lighter);
}
.aft-trash {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 12.5px;
    cursor: pointer;
}
.aft-trash:hover {
    background: var(--el-fill-color-light);
    color: var(--el-color-danger);
}
.aft-trash.is-active {
    background: var(--el-color-danger-light-9);
    color: var(--el-color-danger);
    font-weight: 600;
}
</style>
