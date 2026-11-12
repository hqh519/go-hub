<template>
    <div class="directory-tree-picker">
        <!-- 桌面端 Popover 模式 -->
        <el-popover
            v-if="isDesktop"
            v-model:visible="popoverVisible"
            placement="bottom-start"
            :width="320"
            trigger="click"
            popper-class="directory-tree-popover"
            :show-arrow="true"
            :hide-after="0"
            :show-after="50"
            transition="el-zoom-in-top"
        >
            <template #reference>
                <span class="popover-trigger-wrapper" @click.stop>
                    <slot name="trigger"></slot>
                </span>
            </template>
            <div class="tree-container" v-loading="loading">
                <div v-if="error" class="error-state">
                    <font-awesome-icon icon="exclamation-circle" class="error-icon" />
                    <span class="error-text">{{ error }}</span>
                    <el-button type="primary" size="small" @click="fetchDirectoryTree">
                        {{ $t('directoryTree.retry') }}
                    </el-button>
                </div>
                <el-tree
                    v-else
                    ref="treeRef"
                    :data="treeData"
                    :props="treeProps"
                    node-key="path"
                    :default-expand-all="false"
                    :expand-on-click-node="false"
                    :highlight-current="true"
                    :current-node-key="currentDirectory"
                    class="directory-tree"
                    @node-click="handleNodeClick"
                >
                    <template #default="{ node, data }">
                        <span class="tree-node" :class="{ 'is-current': data.path === currentDirectory }">
                            <font-awesome-icon :icon="node.expanded ? 'folder-open' : 'folder'" class="folder-icon" />
                            <span class="node-label">{{ data.name }}</span>
                        </span>
                    </template>
                </el-tree>
            </div>
        </el-popover>

        <!-- 移动端居中 Dialog 模式（原先的底部抽屉会显示在屏幕下方，改为窗口居中弹窗） -->
        <template v-else>
            <span class="drawer-trigger-wrapper" @click="openDrawer">
                <slot name="trigger"></slot>
            </span>
            <!--
                移动端居中弹窗。
                v3.0.0（R17）修复「目录选择弹窗被上传设置 / 登记文件弹窗盖住」：
                这里原来写死 :z-index="3000"。Element Plus 的弹窗是 nextZIndex() 递增分配，
                外层弹窗在这个会话里开过几次之后早就累积到 3000 以上，
                固定值反而被压在下面。去掉固定值，交给 EP 按打开顺序分配 ——
                后打开的目录弹窗必然高于先打开的外层弹窗。
            -->
            <el-dialog
                v-model="drawerVisible"
                width="86%"
                append-to-body
                align-center
                :title="$t('directoryTree.selectDirectory')"
                class="directory-tree-dialog"
            >
                <div class="tree-container" v-loading="loading">
                    <div v-if="error" class="error-state">
                        <font-awesome-icon icon="exclamation-circle" class="error-icon" />
                        <span class="error-text">{{ error }}</span>
                        <el-button type="primary" size="small" @click="fetchDirectoryTree">
                            {{ $t('directoryTree.retry') }}
                        </el-button>
                    </div>
                    <el-tree
                        v-else
                        ref="treeRefMobile"
                        :data="treeData"
                        :props="treeProps"
                        node-key="path"
                        :default-expand-all="false"
                        :expand-on-click-node="false"
                        :highlight-current="true"
                        :current-node-key="currentDirectory"
                        class="directory-tree mobile-tree"
                        @node-click="handleNodeClick"
                    >
                        <template #default="{ node, data }">
                            <span class="tree-node" :class="{ 'is-current': data.path === currentDirectory }">
                                <font-awesome-icon :icon="node.expanded ? 'folder-open' : 'folder'" class="folder-icon" />
                                <span class="node-label">{{ data.name }}</span>
                            </span>
                        </template>
                    </el-tree>
                </div>
            </el-dialog>
        </template>
    </div>
</template>

<script>
import axios from '@/utils/axios';
import fetchWithAuth from '@/utils/fetchWithAuth';
import { bindDialogLayers } from '@/utils/layerStack';

/*
 * v1.1.9.1：目录选择弹窗也要进层叠栈（需求：登记文件 / 上传设置里的「目录选择弹出页」
 * 需要显示在宿主弹窗的上上层，并且要能被 closePageOrder 先关掉）。
 * 同一个页面可能有多个目录选择器（上传设置、登记文件、批量移动…），
 * 所以层 id 必须按实例区分，不能写死一个常量。
 */
let pickerSeq = 0;

export default {
    name: 'DirectoryTreePicker',
    props: {
        currentDirectory: {
            type: String,
            default: ''
        },
        source: {
            type: String,
            default: 'upload',
            validator: (value) => ['upload', 'admin'].includes(value)
        },
        /**
         * v1.0.0：目录树所属实例。
         * 不传（null）时自动读取当前浏览实例（localStorage gohub_instance_id，'' = 默认实例），
         * 保证「A 实例的目录不会出现在 B 实例的目录树里」。
         */
        instanceId: {
            type: String,
            default: null
        }
    },
    data() {
        return {
            popoverVisible: false,
            drawerVisible: false,
            treeData: [],
            loading: false,
            error: '',
            treeProps: {
                children: 'children',
                label: 'name'
            },
            windowWidth: window.innerWidth
        };
    },
    computed: {
        /** v1.0.0：实际使用的实例 ID —— 显式传入优先，否则取当前浏览实例 */
        effectiveInstanceId() {
            if (this.instanceId !== null && this.instanceId !== undefined) return String(this.instanceId)
            try { return localStorage.getItem('gohub_instance_id') || '' } catch (e) { return '' }
        },
        isDesktop() {
            /* v2.8.0：平板（≤1024px）也使用居中弹窗 —— 原 769px 起走 popover，
               平板上弹出层贴着按钮、不在页面窗口居中，与手机端体验不一致 */
            return this.windowWidth >= 1025;
        }
    },
    watch: {
        popoverVisible(newVal) {
            if (newVal) {
                this.fetchDirectoryTree();
            } else {
                // 弹窗关闭后延迟折叠所有节点，避免下次打开时出现折叠动画
                setTimeout(() => {
                    if (!this.popoverVisible && this.$refs.treeRef) {
                        const store = this.$refs.treeRef.store;
                        for (const key in store.nodesMap) {
                            store.nodesMap[key].expanded = false;
                        }
                    }
                }, 200);
            }
        },
        drawerVisible(newVal) {
            if (newVal) {
                this.fetchDirectoryTree();
            } else {
                // 抽屉关闭后延迟折叠所有节点
                setTimeout(() => {
                    if (!this.drawerVisible && this.$refs.treeRefMobile) {
                        const store = this.$refs.treeRefMobile.store;
                        for (const key in store.nodesMap) {
                            store.nodesMap[key].expanded = false;
                        }
                    }
                }, 300);
            }
        },
        currentDirectory(newVal) {
            this.$nextTick(() => {
                if (this.$refs.treeRef && newVal) {
                    this.$refs.treeRef.setCurrentKey(newVal);
                }
                if (this.$refs.treeRefMobile && newVal) {
                    this.$refs.treeRefMobile.setCurrentKey(newVal);
                }
            });
        }
    },
    mounted() {
        window.addEventListener('resize', this.handleResize);
        /*
         * v1.1.9.1：桌面端是 popover、移动/平板端是居中 dialog，两套各登记一次，
         * 谁开着谁就在栈里；关闭动作分别落到各自的开关上。
         */
        pickerSeq += 1;
        this._layerId = `directory-tree-${pickerSeq}`;
        this._unbindLayers = bindDialogLayers(this, {
            popoverVisible: { id: `${this._layerId}-popover`, close: () => { this.popoverVisible = false; } },
            drawerVisible: { id: `${this._layerId}-dialog`, close: () => { this.drawerVisible = false; } }
        });
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.handleResize);
        if (this._unbindLayers) {
            this._unbindLayers();
            this._unbindLayers = null;
        }
    },
    methods: {
        handleResize() {
            this.windowWidth = window.innerWidth;
        },
        openDrawer() {
            this.drawerVisible = true;
        },
        /**
         * v3.0.0（R14）：单次请求目录树 —— 失败时抛错（带 status，便于上层区分 401）。
         * 移动端弹窗模式与桌面端 Popover 模式共用同一份实现，避免两份逻辑不一致。
         */
        async requestDirectoryTree() {
            // v1.0.0：带上当前实例，只拉该实例下的目录
            const q = `?instanceId=${encodeURIComponent(this.effectiveInstanceId)}`;
            if (this.source === 'admin') {
                const response = await fetchWithAuth(`/api/directoryTree${q}`, { method: 'GET' });
                if (!response.ok) {
                    const err = new Error(`HTTP ${response.status}`);
                    err.status = response.status;
                    throw err;
                }
                return await response.json();
            }
            const response = await axios.get(`/api/directoryTree${q}`, {
                // 移动端弱网：请求超时 20s（默认无超时，容易一直转圈）
                timeout: 20000,
            });
            return response.data;
        },
        async fetchDirectoryTree() {
            this.loading = true;
            this.error = '';

            try {
                let data;
                try {
                    data = await this.requestDirectoryTree();
                } catch (first) {
                    /*
                     * v3.0.0（R14）：移动端偶发「加载目录树失败」——
                     * 弱网/切后台回来时首个请求容易直接失败（Network Error），
                     * 这里等待 400ms 自动重试一次，再失败才提示；401 不重试。
                     */
                    const status = first?.status ?? first?.response?.status;
                    if (status === 401) throw first;
                    await new Promise((resolve) => setTimeout(resolve, 400));
                    data = await this.requestDirectoryTree();
                }

                if (data && data.tree) {
                    this.treeData = [data.tree];
                } else {
                    this.treeData = [];
                }
                /*
                 * v3.0.0（R14）：根节点默认展开 ——
                 * 之前在移动端打开弹窗只看到一个「/」，容易被误认为没加载出来。
                 */
                this.$nextTick(() => {
                    const tree = this.$refs.treeRef || this.$refs.treeRefMobile;
                    if (!tree || !this.treeData.length) return;
                    const rootPath = this.treeData[0].path ?? '';
                    const rootNode = typeof tree.getNode === 'function' ? tree.getNode(rootPath) : null;
                    if (rootNode) rootNode.expanded = true;
                    if (this.currentDirectory) tree.setCurrentKey(this.currentDirectory);
                });
            } catch (err) {
                const status = err?.status ?? err?.response?.status;
                // v3.0.0（R14）：失败原因进控制台（移动端可在远程调试里看到），便于定位
                console.error(`[directoryTree] 加载失败 status=${status || 'network'}`, err);
                if (status === 401) {
                    this.error = this.$t('directoryTree.authFailed');
                } else if (status) {
                    this.error = `${this.$t('directoryTree.serverError')}（HTTP ${status}）`;
                } else {
                    this.error = this.$t('directoryTree.loadFailed');
                }
            } finally {
                this.loading = false;
            }
        },
        handleNodeClick(data) {
            let path = data.path;
            if (path && !path.startsWith('/')) {
                path = '/' + path;
            } else if (!path) {
                path = '/';
            }
            this.$emit('select', path);
            this.popoverVisible = false;
            this.drawerVisible = false;
        }
    }
};
</script>

<style scoped>
.directory-tree-picker {
    display: inline-block;
}

.popover-trigger-wrapper,
.drawer-trigger-wrapper {
    display: inline-block;
}

.tree-container {
    min-height: 200px;
    max-height: 400px;
    overflow-y: auto;
    padding: 8px;
}

.directory-tree {
    background: transparent;
    --el-tree-node-hover-bg-color: var(--el-fill-color-light);
}

.directory-tree :deep(.el-tree-node__content) {
    height: 44px;
    padding: 0 8px;
    border-radius: 8px;
    transition: all 0.2s ease;
}

.directory-tree :deep(.el-tree-node__content:hover) {
    background-color: var(--el-fill-color-light);
}

.directory-tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
    background-color: var(--el-color-primary-light-9);
}

.tree-node {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    width: 100%;
    min-height: 36px;
}

.tree-node.is-current {
    color: var(--el-color-primary);
    font-weight: 500;
}

html.dark .tree-node.is-current .node-label {
    color: var(--primary-color-accent);
}

.folder-icon {
    color: var(--el-color-warning);
    font-size: 16px;
    flex-shrink: 0;
}

.node-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.mobile-tree :deep(.el-tree-node__content) {
    height: 48px;
    padding: 0 12px;
}

.mobile-tree .tree-node {
    min-height: 40px;
}

.error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px 20px;
    text-align: center;
}

.error-icon {
    font-size: 32px;
    color: var(--el-color-danger);
}

.error-text {
    color: var(--el-text-color-secondary);
    font-size: 14px;
}

.tree-container :deep(.el-loading-mask) {
    border-radius: 8px;
}
</style>

<style>
.directory-tree-popover {
    padding: 0 !important;
}

/* 加速 popover 动画 */
.el-zoom-in-top-enter-active.directory-tree-popover,
.el-zoom-in-top-leave-active.directory-tree-popover {
    transition: transform 0.15s ease-out, opacity 0.15s ease-out !important;
}

.directory-tree-drawer {
    border-radius: 16px 16px 0 0 !important;
}

/* 移动端居中弹窗：限制最大高度并让树区域可滚动 */
.directory-tree-dialog {
    max-width: 360px;
    border-radius: 14px !important;
}

.directory-tree-dialog .el-dialog__body {
    padding-top: 8px;
}

.directory-tree-dialog .tree-container {
    max-height: 52vh;
}

.directory-tree-drawer .el-drawer__header {
    margin-bottom: 0;
    padding: 16px 20px;
    border-bottom: 1px solid var(--el-border-color-lighter);
}

.directory-tree-drawer .el-drawer__body {
    padding: 0;
}
</style>
