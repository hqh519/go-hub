<template>
    <!--
        记事树（v1.3.9，原「目录栏」）
        ----------------------------------------------------------------------------
        模型从「目录 + 笔记」合并成「文档节点」：每个节点本身就是一篇笔记，
        同时可以无限嵌套子笔记。树是一次拉全的扁平数组，前端按 parentId 组树 ——
        逐层懒加载会让「展开到第 5 层」变成 5 次请求，拖拽跨层移动还得额外刷新。

        4 个一级节点（笔记 / 日记 / 札记 / 灵感）由服务端保证存在，
        这里只负责展示与打标：不可拖拽、不可改名、不可删除。
    -->
    <div class="mt-root">
        <div class="mt-head">
            <span class="mt-title">{{ $t('memo.treeTitle') }}</span>
            <button type="button" class="mt-add" :title="$t('memo.newNote')" @click="$emit('create')">
                <font-awesome-icon icon="plus" />
            </button>
        </div>

        <div class="mt-search">
            <font-awesome-icon icon="search" class="mt-search-icon" />
            <input
                v-model="search"
                class="mt-search-input"
                type="text"
                :placeholder="$t('memo.searchPlaceholder')"
                @input="applyFilter"
            />
            <button v-if="search" type="button" class="mt-search-clear" @click="clearSearch">
                <font-awesome-icon icon="times" />
            </button>
        </div>

        <div class="mt-tree">
            <el-tree
                ref="tree"
                :data="treeData"
                node-key="id"
                :indent="14"
                :props="{ label: 'title', children: 'children' }"
                :expand-on-click-node="false"
                :default-expanded-keys="expandedKeys"
                :current-node-key="currentKey"
                highlight-current
                draggable
                :allow-drag="allowDrag"
                :allow-drop="allowDrop"
                :empty-text="$t('memo.empty')"
                @node-click="onNodeClick"
                @node-drop="onNodeDrop"
                @node-expand="onExpand"
                @node-collapse="onCollapse"
            >
                <template #default="{ data }">
                    <div class="mt-node" :class="{ 'is-current': data.id === active, 'is-system': data.isSystem }">
                        <span class="mt-node-main">
                            <font-awesome-icon :icon="iconOf(data)" class="mt-node-icon" />
                            <span class="mt-name" :title="data.title">{{ data.title || $t('memo.untitled') }}</span>
                        </span>
                        <!-- 子孙总数：空节点不显示，避免一排 0 抢注意力 -->
                        <span v-if="data.totalCount" class="mt-count">{{ data.totalCount }}</span>
                        <el-dropdown
                            trigger="click"
                            class="mt-node-more"
                            @command="(cmd) => onCommand(cmd, data)"
                            @click.stop
                        >
                            <button type="button" class="mt-more-btn" @click.stop>
                                <font-awesome-icon icon="ellipsis-v" />
                            </button>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item command="child">{{ $t('memo.newChildNote') }}</el-dropdown-item>
                                    <el-dropdown-item command="rename" :disabled="data.isSystem">
                                        {{ $t('memo.rename') }}
                                    </el-dropdown-item>
                                    <el-dropdown-item command="delete" divided :disabled="data.isSystem">
                                        {{ $t('memo.deleteNode') }}
                                    </el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>
                    </div>
                </template>
            </el-tree>
        </div>

        <div class="mt-foot">
            <button
                type="button"
                class="mt-pseudo-item"
                :class="{ 'is-active': active === '__trash' }"
                @click="$emit('trash')"
            >
                <font-awesome-icon icon="trash" />
                <span class="mt-name">{{ $t('memo.trash') }}</span>
            </button>
        </div>
    </div>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus';
import { fetchTree, renameNode, moveNode, reorderNodes, trashNote } from '@/utils/memoApi';

/** 系统一级节点的图标（按标题；标题由服务端固定，不会漂移） */
const SYSTEM_ICON = {
    笔记: 'book',
    日记: 'calendar',
    札记: 'edit',
    灵感: 'bolt',
};

export default {
    name: 'MemoTree',
    props: {
        /** 当前选中的节点 id；'__trash' 表示回收站 */
        active: { type: String, default: '' },
        instanceId: { type: String, default: '' },
    },
    emits: ['select', 'create', 'create-child', 'changed', 'trash', 'loaded'],
    data() {
        return {
            nodes: [],
            roots: [],
            search: '',
            /** 默认展开 4 个系统一级节点，进来就能看到各类下的结构 */
            expandedKeys: [],
            /** v1.3.9：记住用户手动展开的层级，reload 后不会被收回 */
            openKeys: [],
            treeInited: false,
        };
    },
    computed: {
        currentKey() {
            return this.active && this.active !== '__trash' ? this.active : undefined;
        },
        /** 搜索时只保留「命中的节点 + 它的祖先链」 */
        treeData() {
            const keyword = this.search.trim().toLowerCase();
            if (!keyword) return this.buildTree();
            const hit = new Set();
            for (const n of this.nodes) {
                if (String(n.title || '').toLowerCase().includes(keyword)) hit.add(n.id);
            }
            const keep = new Set(hit);
            const byId = new Map(this.nodes.map((n) => [n.id, n]));
            for (const id of hit) {
                let p = byId.get(id)?.parentId || '';
                let guard = 0;
                while (p && !keep.has(p) && byId.has(p) && guard < 500) {
                    keep.add(p);
                    p = byId.get(p).parentId || '';
                    guard += 1;
                }
            }
            return this.buildTree(this.nodes.filter((n) => keep.has(n.id)));
        },
    },
    watch: {
        instanceId() {
            this.reload();
        },
    },
    mounted() {
        this.reload();
    },
    methods: {
        /** 节点图标：系统节点各有专属图标，普通节点按「有没有子节点」区分文档 / 目录 */
        iconOf(n) {
            if (n.isSystem) return SYSTEM_ICON[n.title] || 'book';
            return n.children && n.children.length ? 'folder-open' : 'file-lines';
        },
        buildTree(source) {
            const list = (source || this.nodes).slice();
            const byParent = new Map();
            for (const n of list) {
                const key = n.parentId || '';
                if (!byParent.has(key)) byParent.set(key, []);
                byParent.get(key).push(n);
            }
            const sortFn = (a, b) => (a.sort || 0) - (b.sort || 0) || (a.createdAt || 0) - (b.createdAt || 0);
            const make = (parentId, depth) => {
                const rows = (byParent.get(parentId) || []).slice().sort(sortFn);
                return rows.map((n) => ({
                    ...n,
                    children: depth < 60 ? make(n.id, depth + 1) : [],
                }));
            };
            const roots = make('', 0);
            // 系统节点按 笔记/日记/札记/灵感 的固定顺序排，其余按 sort
            const order = { 笔记: 0, 日记: 1, 札记: 2, 灵感: 3 };
            roots.sort((a, b) => {
                const ai = a.isSystem ? order[a.title] ?? 9 : 99;
                const bi = b.isSystem ? order[b.title] ?? 9 : 99;
                if (ai !== bi) return ai - bi;
                return sortFn(a, b);
            });
            return roots;
        },
        async reload() {
            try {
                const r = await fetchTree();
                this.nodes = Array.isArray(r?.nodes) ? r.nodes : [];
                this.roots = Array.isArray(r?.roots) ? r.roots : [];
                if (!this.treeInited) {
                    this.treeInited = true;
                    this.openKeys = this.roots.map((x) => x.id).filter(Boolean);
                }
                this.expandedKeys = this.openKeys.slice();
                this.$emit('loaded', { nodes: this.nodes, roots: this.roots });
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.loadFail'));
            }
        },
        onExpand(data) {
            if (data?.id && !this.openKeys.includes(data.id)) this.openKeys.push(data.id);
            this.expandedKeys = this.openKeys.slice();
        },
        onCollapse(data) {
            this.openKeys = this.openKeys.filter((id) => id !== data?.id);
            this.expandedKeys = this.openKeys.slice();
        },
        /** 新建 / 跳转后把目标节点的祖先链展开，否则它藏在收起的层级里看不见 */
        revealNode(id) {
            const byId = new Map(this.nodes.map((n) => [n.id, n]));
            let cur = byId.get(id)?.parentId || '';
            let guard = 0;
            while (cur && guard < 500) {
                if (!this.openKeys.includes(cur)) this.openKeys.push(cur);
                cur = byId.get(cur)?.parentId || '';
                guard += 1;
            }
            this.expandedKeys = this.openKeys.slice();
        },
        applyFilter() {
            // 过滤在 computed 里做，这里只需要让当前选中项保持高亮
            this.$nextTick(() => {
                const el = this.$refs.tree;
                if (el && el.setCurrentKey) el.setCurrentKey(this.currentKey);
            });
        },
        clearSearch() {
            this.search = '';
        },
        onNodeClick(data) {
            this.$emit('select', data.id);
        },
        allowDrag(node) {
            // 4 个固定一级节点不可拖动（服务端也会拒绝，这里只是别让用户白拖）
            return !node.data.isSystem;
        },
        allowDrop(dragNode, dropNode, type) {
            if (!dragNode || !dropNode) return false;
            // 不能拖到自己的子孙下（后端也有环检测，这里先挡一层）
            let p = dropNode;
            while (p) {
                if (p.data && p.data.id === dragNode.data.id) return false;
                p = p.parent;
            }
            // 系统节点只能作为「容器」接收子节点，不能把别的节点排到它前面/后面
            if (dropNode.data.isSystem && type !== 'inner') return false;
            return true;
        },
        async onNodeDrop(dragNode, dropNode, type) {
            const dragId = dragNode?.data?.id;
            if (!dragId) return;
            const parentId = type === 'inner' ? dropNode.data.id : (dropNode.parent?.data?.id || '');
            try {
                if (String(dragNode.data.parentId || '') !== String(parentId || '') || type === 'inner') {
                    await moveNode(dragId, { parentId });
                }
                /*
                 * 落位后把该层级的新顺序整体提交一次：只改 parentId 的话，
                 * 服务端会把节点排到末尾 —— 用户拖到中间却看到它跳到最下面。
                 */
                const container = type === 'inner' ? dropNode : dropNode.parent;
                const siblings = (container && container.childNodes ? container.childNodes : [])
                    .map((x) => x.data && x.data.id)
                    .filter(Boolean);
                if (siblings.length) await reorderNodes(parentId, siblings);
                await this.reload();
                this.$emit('changed');
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.saveFail'));
                await this.reload();
            }
        },
        onCommand(cmd, data) {
            if (cmd === 'child') return this.$emit('create-child', data.id);
            if (cmd === 'rename') return this.doRename(data);
            if (cmd === 'delete') return this.doDelete(data);
        },
        async doRename(node) {
            let value = '';
            try {
                const r = await ElMessageBox.prompt(this.$t('memo.renameTip'), this.$t('memo.rename'), {
                    inputValue: node.title || '',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    inputValidator: (v) => (String(v || '').trim() ? true : this.$t('memo.nameRequired')),
                });
                value = String(r?.value || '').trim();
            } catch (e) {
                return;
            }
            if (!value || value === node.title) return;
            try {
                await renameNode(node.id, value);
                await this.reload();
                this.$emit('changed');
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.saveFail'));
            }
        },
        async doDelete(node) {
            try {
                await ElMessageBox.confirm(
                    this.$t('memo.deleteNodeTip', { title: node.title || this.$t('memo.untitled') }),
                    this.$t('memo.deleteNode'),
                    {
                        type: 'warning',
                        confirmButtonText: this.$t('common.confirm'),
                        cancelButtonText: this.$t('common.cancel'),
                    },
                );
            } catch (e) {
                return;
            }
            try {
                await trashNote(node.id);
                await this.reload();
                this.$emit('changed', { removed: node.id });
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.saveFail'));
            }
        },
    },
};
</script>

<style scoped>
.mt-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    text-align: left;
}
.mt-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px 6px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.mt-title {
    font-weight: 600;
}
.mt-add {
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 5px;
    background: var(--el-fill-color);
    color: var(--el-text-color-regular);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
}
.mt-add:hover {
    background: var(--el-color-primary);
    color: #fff;
}
.mt-search {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 8px 6px;
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--el-fill-color-light);
}
.mt-search-icon {
    font-size: 11px;
    color: var(--el-text-color-secondary);
}
.mt-search-input {
    flex: 1 1 auto;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 12.5px;
    color: var(--el-text-color-primary);
}
.mt-search-clear {
    border: none;
    background: transparent;
    padding: 0;
    cursor: pointer;
    font-size: 10px;
    color: var(--el-text-color-secondary);
}
.mt-tree {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    overscroll-behavior-y: contain;
    padding: 0 4px 12px;
}
.mt-node {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    min-width: 0;
    padding-right: 2px;
    font-size: 13px;
}
.mt-node-main {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    flex: 0 1 auto;
}
.mt-node-icon {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--el-text-color-secondary);
}
.mt-node.is-system .mt-node-icon {
    color: var(--el-color-primary);
}
.mt-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mt-node.is-current .mt-name {
    font-weight: 600;
}
.mt-count {
    flex: 0 0 auto;
    margin-left: 2px;
    font-size: 10.5px;
    color: var(--el-text-color-placeholder);
}
.mt-node-more {
    flex: 0 0 auto;
    margin-left: auto;
    opacity: 0;
}
.mt-node:hover .mt-node-more,
.mt-node.is-current .mt-node-more {
    opacity: 1;
}
.mt-more-btn {
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 1px 3px;
    font-size: 11px;
    color: var(--el-text-color-secondary);
}
.mt-foot {
    flex: 0 0 auto;
    padding: 6px 8px 10px;
    border-top: 1px solid var(--el-border-color-lighter);
}
.mt-pseudo-item {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
}
.mt-pseudo-item:hover {
    background: var(--el-fill-color-light);
}
.mt-pseudo-item.is-active {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
}
/* 移动端：更多按钮常显（没有 hover） */
@media (hover: none) {
    .mt-node-more {
        opacity: 1;
    }
}
</style>
