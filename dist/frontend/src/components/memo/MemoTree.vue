<template>
    <!--
        目录栏（v1.3.0）
        ----------------------------------------------------------------------------
        无限层级靠 `memo_folders.parentId` 自引用，这里用 el-tree 渲染 ——
        拖拽换层级、展开折叠、键盘导航都是它自带的，自己写一棵树要重做一遍还不稳。
        「全部笔记 / 未归档」是两个伪节点，不参与拖拽，只作为筛选入口。
    -->
    <div class="mt-root">
        <div class="mt-head">
            <span class="mt-title">{{ $t('memo.folders') }}</span>
            <button type="button" class="mt-add" :title="$t('memo.newFolder')" @click="createFolder('')">
                <font-awesome-icon icon="plus" />
            </button>
        </div>

        <div class="mt-pseudo">
            <button
                type="button"
                class="mt-pseudo-item"
                :class="{ 'is-active': active === '' }"
                @click="pick('')"
            >
                <font-awesome-icon icon="book" />
                <span class="mt-name">{{ $t('memo.allNotes') }}</span>
                <span class="mt-count">{{ total }}</span>
            </button>
            <button
                type="button"
                class="mt-pseudo-item"
                :class="{ 'is-active': active === '__root' }"
                @click="pick('__root')"
            >
                <font-awesome-icon icon="inbox" />
                <span class="mt-name">{{ $t('memo.unfiled') }}</span>
                <span class="mt-count">{{ unfiled }}</span>
            </button>
            <button
                type="button"
                class="mt-pseudo-item"
                :class="{ 'is-active': active === '__trash' }"
                @click="pick('__trash')"
            >
                <font-awesome-icon icon="trash" />
                <span class="mt-name">{{ $t('memo.trash') }}</span>
            </button>
        </div>

        <div class="mt-tree">
            <el-tree
                ref="tree"
                :data="treeData"
                node-key="id"
                :indent="0"
                :props="{ label: 'name', children: 'children' }"
                :expand-on-click-node="false"
                :current-node-key="currentKey"
                highlight-current
                draggable
                :allow-drop="allowDrop"
                :empty-text="$t('memo.noFolder')"
                @node-click="onNodeClick"
                @node-drop="onNodeDrop"
            >
                <template #default="{ data }">
                    <div class="mt-node" :class="{ 'is-current': data.id === active }">
                        <!-- v1.3.2：选中底色只包住「图标 + 名称」，不再铺满整行（三角形不染色） -->
                        <span class="mt-node-main">
                            <font-awesome-icon :icon="data.children && data.children.length ? 'folder-open' : 'folder'" class="mt-node-icon" />
                            <span class="mt-name" :title="data.name">{{ data.name }}</span>
                        </span>
                        <!-- v1.3.2（需求）：自身笔记数 / 含所有子目录的总数 -->
                        <span class="mt-count">{{ data.count }}/{{ data.total }}</span>
                        <el-dropdown trigger="click" class="mt-node-more" @command="(cmd) => onCommand(cmd, data)" @click.stop>
                            <!-- v1.3.4.2（需求）：目录后面的「更多」改成竖三点 -->
                            <button type="button" class="mt-more-btn" @click.stop>
                                <font-awesome-icon icon="ellipsis-v" />
                            </button>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item command="child">{{ $t('memo.newChildFolder') }}</el-dropdown-item>
                                    <el-dropdown-item command="rename">{{ $t('memo.rename') }}</el-dropdown-item>
                                    <el-dropdown-item command="delete" divided>{{ $t('memo.deleteFolder') }}</el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>
                    </div>
                </template>
            </el-tree>
        </div>
    </div>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus';
import { fetchFolders, createFolder, updateFolder, deleteFolder } from '@/utils/memoApi';
import { buildTree } from '@/utils/memoTree';

export default {
    name: 'MemoTree',
    props: {
        /** 当前选中的筛选键：'' 全部 / '__root' 未归档 / '__trash' 回收站 / 目录 id */
        active: { type: String, default: '' },
        instanceId: { type: String, default: '' },
    },
    emits: ['update:active', 'loaded'],
    data() {
        return {
            folders: [],
            unfiled: 0,
            total: 0,
        };
    },
    computed: {
        treeData() {
            return buildTree(this.folders);
        },
        currentKey() {
            return this.active && !this.active.startsWith('__') ? this.active : undefined;
        },
    },
    mounted() {
        this.load();
    },
    methods: {
        async load() {
            try {
                const r = await fetchFolders();
                this.folders = r?.folders || [];
                this.unfiled = Number(r?.unfiled) || 0;
                this.total = this.folders.reduce((s, f) => s + (Number(f.count) || 0), 0) + this.unfiled;
                this.$emit('loaded', { folders: this.folders, unfiled: this.unfiled, total: this.total });
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.loadFail'));
            }
        },
        pick(key) {
            this.$emit('update:active', key);
        },
        onNodeClick(data) {
            this.pick(data.id);
        },
        /** 只允许拖到目录内部（改父子），不允许「插到两项之间」——同级顺序本版不做拖拽排序 */
        allowDrop(dragNode, dropNode, type) {
            return type === 'inner' && dragNode.data.id !== dropNode.data.id;
        },
        async onNodeDrop(dragNode, dropNode) {
            try {
                await updateFolder(dragNode.data.id, { parentId: dropNode.data.id });
                await this.load();
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.saveFail'));
                await this.load();
            }
        },
        async createFolder(parentId) {
            let name = '';
            try {
                const r = await ElMessageBox.prompt(this.$t('memo.folderNameTip'), this.$t('memo.newFolder'), {
                    inputPlaceholder: this.$t('memo.folderNamePlaceholder'),
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    inputValidator: (v) => (String(v || '').trim() ? true : this.$t('memo.folderNameRequired')),
                });
                name = String(r.value || '').trim();
            } catch (e) {
                return;
            }
            try {
                const folder = await createFolder({ name, parentId });
                await this.load();
                if (folder?.id) this.pick(folder.id);
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.saveFail'));
            }
        },
        async onCommand(cmd, data) {
            if (cmd === 'child') return this.createFolder(data.id);
            if (cmd === 'rename') return this.rename(data);
            if (cmd === 'delete') return this.remove(data);
        },
        async rename(data) {
            let name = '';
            try {
                const r = await ElMessageBox.prompt(this.$t('memo.folderNameTip'), this.$t('memo.rename'), {
                    inputValue: data.name,
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                });
                name = String(r.value || '').trim();
            } catch (e) {
                return;
            }
            if (!name || name === data.name) return;
            try {
                await updateFolder(data.id, { name });
                await this.load();
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.saveFail'));
            }
        },
        async remove(data) {
            try {
                await ElMessageBox.confirm(this.$t('memo.deleteFolderTip', { name: data.name }), this.$t('memo.deleteFolder'), {
                    type: 'warning',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                });
            } catch (e) {
                return;
            }
            try {
                const r = await deleteFolder(data.id);
                if (this.active === data.id) this.pick('');
                await this.load();
                if (r && (r.movedNotes || r.movedFolders)) {
                    ElMessage.success(this.$t('memo.deleteFolderMoved', { notes: r.movedNotes || 0 }));
                }
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
}
.mt-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 6px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.mt-title {
    font-weight: 600;
    letter-spacing: 0.5px;
}
.mt-add {
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--el-text-color-secondary);
    padding: 2px 4px;
    border-radius: 4px;
}
.mt-add:hover {
    color: var(--el-color-primary);
    background: var(--el-fill-color);
}
.mt-pseudo {
    padding: 0 6px 6px;
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.mt-pseudo-item {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    background: transparent;
    border-radius: 5px;
    font-size: 13px;
    color: var(--el-text-color-regular);
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
.mt-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mt-count {
    flex: 0 0 auto;
    /* v1.3.3.2：计数与「更多」一起靠右成一列，目录名再长也不会把按钮挤到中间 */
    margin-left: auto;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    opacity: 0.6;
}
.mt-tree {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 0 6px 12px;
    /* v1.3.1.2（需求）：目录名称一律靠左 —— 显式声明，避免被上层 text-align 带偏 */
    text-align: left;
}
.mt-tree :deep(.el-tree-node__content) {
    text-align: left;
    justify-content: flex-start;
}
.mt-tree :deep(.el-tree-node__label) {
    text-align: left;
    width: 100%;
}
/*
 * ── v1.3.1.1（需求）：目录缩进减半 + 关系线 ─────────────────────────
 *
 * 缩进从 el-tree 自带的 16px 改成 **8px**，并且不再用它的 padding-left，
 * 而是给每一层「子节点容器」加 8px 左内边距 —— 好处是 DOM 的嵌套本身就累积出
 * 层级缩进，CSS 不需要知道「当前是第几级」，也就能把竖线画在固定位置：
 *   · 竖线 = 子容器左内边距的中线（left: 4px），从父项中心往下一路延伸；
 *   · 横枝 = 每个子项左侧 8px 的一小段，指向自己的图标。
 * 如果用 el-tree 的 padding-left 实现，缩进落在 content 上、容器仍在 0，
 * 竖线的位置就得按层级算，纯 CSS 做不到。
 */
.mt-tree :deep(.el-tree-node__children) {
    position: relative;
    /*
     * v1.3.3.3（需求：上下级缩进减少一半，关系线落在三角按钮正下方）
     *
     * 实测：el-tree 的三角是 24px 宽（12px 图标 + 左右各 6px padding），
     * 相对行首中心在 12px 处。上一版缩进 20px，子项离父项太远、层级一多就吃不消。
     * 现在缩进收到 10px（正好一半），竖线也放到 10px ——
     * 与三角中心只差 2px，视觉上就是「从三角正下方垂下来」，
     * 并且与子项内容左缘对齐，不再需要一段横向小枝。
     */
    padding-left: 10px;
}
.mt-tree :deep(.el-tree-node__children)::before {
    content: '';
    position: absolute;
    left: 10px;
    top: 0;
    /* 最后一项的下半行不需要竖线，留出行高的一半 */
    bottom: 13px;
    width: 1px;
    background: var(--el-border-color-lighter, #e4e7ed);
}

.mt-node {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    width: 100%;
    padding-right: 4px;
    font-size: 13px;
    text-align: left;
}
/* v1.3.2：选中底色只作用于「图标 + 名称」这一小段 */
.mt-node-main {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 2px 6px;
    margin-left: -6px;
    border-radius: 6px;
}
.mt-node.is-current .mt-node-main {
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.12));
}
/* el-tree 自带的 highlight-current 会把整行（含三角形）染色，这里关掉 */
.mt-tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
    background: transparent;
}
.mt-node-icon {
    flex: 0 0 auto;
    width: 12px;
    opacity: 0.7;
}
/* v1.3.3.2（需求）：更多按钮排在目录名右侧、整体靠右对齐 */
.mt-node-more {
    flex: 0 0 auto;
    opacity: 0;
    transition: opacity 0.15s;
}
.mt-node:hover .mt-node-more {
    opacity: 1;
}
/*
 * v1.3.1：移动端常显「…」按钮。
 * 触屏没有 hover，原来靠 :hover 才出现的菜单按钮在手机上永远不会显示 ——
 * 表现就是「每个目录上没法再建子目录」。这里在窄屏/触屏下让它常驻。
 */
@media (max-width: 900px), (hover: none) {
    .mt-node-more {
        opacity: 1;
    }
}
.mt-more-btn {
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--el-text-color-secondary);
    padding: 0 2px;
    font-size: 12px;
}
/* el-tree 的默认行高偏大，这里压紧一点，一屏能多放几个目录 */
:deep(.el-tree-node__content) {
    height: 30px;
    border-radius: 5px;
}
</style>
