<template>
    <div class="move-file-dialog-wrapper">
        <!--
            v3.0.0：桌面端与移动端统一用居中弹窗（align-center），
            移动端宽度 92% 且内容区可滚动 —— 修复此前移动端垂直/水平偏移、树区域溢出的问题。
        -->
        <el-dialog
            v-model="dialogVisible"
            :title="dialogTitle"
            :width="dialogWidth"
            align-center
            :show-close="true"
            class="move-dialog"
            @close="handleClose"
        >
            <div class="move-dialog-content">
                <!--
                    v3.0.0 第一步：选择接收实例（仅批量移动且存在其它实例时出现）
                    · 列出「默认 + 各实例」，名称前带创建序号（默认实例不带序号）；
                    · 默认选中当前实例；选定后进入第二步选目录（只能选目标实例下的目录）。
                -->
                <div v-if="step === 'instance'" class="move-step-instance">
                    <div class="move-dialog-hint">{{ $t('fileManager.movePickInstanceHint') }}</div>
                    <div class="move-instance-list" v-loading="instancesLoading">
                        <button
                            type="button"
                            class="move-instance-item"
                            :class="{ 'is-active': targetInstanceId === '' }"
                            @click="pickInstance('')"
                        >
                            <font-awesome-icon icon="server" class="move-instance-icon"/>
                            <span class="move-instance-name">{{ $t('fileManager.instanceDefault') }}</span>
                            <font-awesome-icon v-if="targetInstanceId === ''" icon="check" class="move-instance-check"/>
                        </button>
                        <button
                            v-for="ins in instances"
                            :key="'mv-ins-' + ins.id"
                            type="button"
                            class="move-instance-item"
                            :class="{ 'is-active': String(targetInstanceId) === String(ins.id) }"
                            @click="pickInstance(ins.id)"
                        >
                            <span class="move-instance-seq">{{ instanceSeq(ins) }}</span>
                            <span class="move-instance-name">{{ ins.name }}</span>
                            <font-awesome-icon
                                v-if="String(targetInstanceId) === String(ins.id)"
                                icon="check"
                                class="move-instance-check"
                            />
                        </button>
                    </div>

                    <!--
                        v1.1.5：在「选择接收实例」下方增加「移动 / 复制」二选一。
                        · 默认**不选**（moveMode = ''），必须选一个才能点「下一步」；
                        · 移动 = 沿用原有语义，源实例不再保留这份数据；
                        · 复制 = 源记录留在原处，目标实例里多出一份（新外链，共用同一个实体文件），
                          于是两边互为「删除统计」，最后一份删掉时才真正删远端文件。
                    -->
                    <div class="move-mode-block">
                        <div class="move-mode-title">
                            <span>{{ $t('fileManager.moveModeTitle') }}</span>
                            <span class="move-mode-required">*</span>
                        </div>
                        <div class="move-mode-list">
                            <button
                                type="button"
                                class="move-mode-item"
                                :class="{ 'is-active': moveMode === 'move' }"
                                @click="pickMode('move')"
                            >
                                <font-awesome-icon icon="arrows-alt" class="move-mode-icon" />
                                <span class="move-mode-name">{{ $t('dashboard.move') }}</span>
                                <span class="move-mode-desc">{{ $t('fileManager.moveModeMoveHint') }}</span>
                                <font-awesome-icon v-if="moveMode === 'move'" icon="check" class="move-instance-check" />
                            </button>
                            <button
                                type="button"
                                class="move-mode-item"
                                :class="{ 'is-active': moveMode === 'copy' }"
                                @click="pickMode('copy')"
                            >
                                <font-awesome-icon icon="copy" class="move-mode-icon" />
                                <span class="move-mode-name">{{ $t('dashboard.copy') }}</span>
                                <span class="move-mode-desc">{{ $t('fileManager.moveModeCopyHint') }}</span>
                                <font-awesome-icon v-if="moveMode === 'copy'" icon="check" class="move-instance-check" />
                            </button>
                        </div>
                        <!-- 未选择时的内联提示（按钮同时禁用，避免出现「点了没反应」） -->
                        <p v-if="!moveMode" class="move-mode-tip">{{ $t('fileManager.moveModeRequired') }}</p>
                        <p v-else class="move-mode-tip is-chosen">
                            {{ moveMode === 'copy' ? $t('fileManager.moveModeCopyChosen') : $t('fileManager.moveModeMoveChosen') }}
                        </p>
                    </div>
                </div>

                <!-- 第二步：选择目标目录 -->
                <template v-else>
                    <div v-if="showInstancePicker" class="move-instance-current">
                        <span class="move-instance-current-label">{{ $t('fileManager.movePickInstance') }}</span>
                        <span class="move-instance-current-name">{{ currentInstanceLabel }}</span>
                        <!-- v1.1.5：把上一步选的「移动 / 复制」也带到这里，避免用户忘了自己在做什么 -->
                        <span class="move-mode-badge" :class="moveMode === 'copy' ? 'is-copy' : 'is-move'">
                            {{ moveMode === 'copy' ? $t('dashboard.copy') : $t('dashboard.move') }}
                        </span>
                        <el-button text size="small" class="move-step-back" @click="step = 'instance'">
                            {{ $t('fileManager.movePickInstanceChange') }}
                        </el-button>
                    </div>
                    <div class="move-path-input-container">
                        <el-input
                            v-model="targetPath"
                            :placeholder="$t('moveFile.targetPlaceholder')"
                            class="move-path-input"
                        >
                            <template #prepend>{{ $t('moveFile.targetDirectory') }}</template>
                        </el-input>
                        <!-- 桌面端（非跨实例流程）：目录树选择器 -->
                        <DirectoryTreePicker
                            v-if="!useEmbeddedTree"
                            :current-directory="currentDirectory"
                            source="admin"
                            @select="handleDirectorySelect"
                        >
                            <template #trigger>
                                <el-button class="directory-picker-trigger">
                                    <font-awesome-icon icon="folder-tree" />
                                </el-button>
                            </template>
                        </DirectoryTreePicker>
                        <!-- 移动端 / 跨实例流程：内嵌目录树（按目标实例拉取） -->
                        <el-button v-else class="directory-picker-trigger" @click="showTreePicker = !showTreePicker">
                            <font-awesome-icon icon="folder-tree" />
                        </el-button>
                    </div>
                    <p class="move-dialog-hint">{{ useEmbeddedTree ? $t('moveFile.hintMobile') : $t('moveFile.hint') }}</p>

                    <!-- 内嵌目录树（独立滚动区，不撑破弹窗） -->
                    <div v-if="useEmbeddedTree && showTreePicker" class="embedded-tree-section">
                        <div class="tree-section-header">
                            <span class="tree-section-title">{{ $t('moveFile.selectDirectory') }}</span>
                            <el-button text @click="showTreePicker = false">
                                <font-awesome-icon icon="times" />
                            </el-button>
                        </div>
                        <div class="tree-container" v-loading="treeLoading">
                            <div v-if="treeError" class="error-state">
                                <font-awesome-icon icon="exclamation-circle" class="error-icon" />
                                <span class="error-text">{{ treeError }}</span>
                                <el-button type="primary" size="small" @click="fetchDirectoryTree">
                                    {{ $t('moveFile.retry') }}
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
                                @node-click="handleTreeNodeClick"
                            >
                                <template #default="{ node, data }">
                                    <span class="tree-node" :class="{ 'is-current': data.path === currentDirectory }">
                                        <font-awesome-icon :icon="node.expanded ? 'folder-open' : 'folder'" class="folder-icon" />
                                        <span class="node-label">{{ data.name }}</span>
                                    </span>
                                </template>
                            </el-tree>
                        </div>
                    </div>
                </template>
            </div>
            <template #footer>
                <span class="dialog-footer">
                    <el-button @click="handleClose">{{ $t('moveFile.cancel') }}</el-button>
                    <el-button
                        v-if="step === 'instance'"
                        type="primary"
                        :disabled="instancesLoading || !moveMode"
                        @click="goDirectoryStep"
                    >{{ $t('fileManager.moveNextStep') }}</el-button>
                    <el-button
                        v-else
                        type="primary"
                        :loading="loading"
                        @click="handleConfirm"
                    >{{ $t('moveFile.confirm') }}</el-button>
                </span>
            </template>
        </el-dialog>
    </div>
</template>

<script>
import DirectoryTreePicker from '@/components/DirectoryTreePicker.vue';
import fetchWithAuth from '@/utils/fetchWithAuth';

export default {
    name: 'MoveFileDialog',
    components: {
        DirectoryTreePicker
    },
    props: {
        modelValue: {
            type: Boolean,
            default: false
        },
        currentDirectory: {
            type: String,
            default: ''
        },
        isBatchMove: {
            type: Boolean,
            default: false
        },
        initialPath: {
            type: String,
            default: '/'
        },
        /**
         * v3.0.0：是否先走「选择接收实例」这一步（批量移动时由页面开启）。
         * 默认 false = 保持原行为（选定文件直接选目录），其它调用点不受影响。
         */
        showInstancePicker: {
            type: Boolean,
            default: false
        },
        /** v3.0.0：当前所在实例 id（空串 = 默认实例），作为第一步的默认选中项 */
        instanceId: {
            type: String,
            default: ''
        }
    },
    emits: ['update:modelValue', 'confirm', 'close'],
    data() {
        return {
            targetPath: '/',
            loading: false,
            windowWidth: window.innerWidth,
            // v3.0.0：跨实例流程的当前步骤：instance（选实例）| directory（选目录）
            step: 'directory',
            instances: [],
            instancesLoading: false,
            targetInstanceId: '',
            /**
             * v1.1.5：「移动 / 复制」二选一。
             * 空串 = 还没选（默认态，必须选一个才能进入下一步），
             * 'move' = 沿用原语义（源实例不再保留），'copy' = 目标实例多一份（源记录留着）。
             */
            moveMode: '',
            // 内嵌树相关
            showTreePicker: false,
            treeData: [],
            treeLoading: false,
            treeError: '',
            treeProps: {
                children: 'children',
                label: 'name'
            }
        };
    },
    computed: {
        dialogVisible: {
            get() {
                return this.modelValue;
            },
            set(val) {
                this.$emit('update:modelValue', val);
            }
        },
        isDesktop() {
            return this.windowWidth > 768;
        },
        /** v3.0.0：移动端 92% 宽、桌面端固定 500px */
        dialogWidth() {
            return this.isDesktop ? '500px' : '92%';
        },
        dialogTitle() {
            if (this.step === 'instance') return this.$t('fileManager.movePickInstance');
            // v1.1.5：选了「复制」时标题同步换成复制，别让弹窗标题和实际操作不一致
            if (this.moveMode === 'copy') {
                return this.isBatchMove ? this.$t('moveFile.batchCopyTitle') : this.$t('moveFile.copyTitle');
            }
            return this.isBatchMove ? this.$t('moveFile.batchTitle') : this.$t('moveFile.title');
        },
        /** 移动端或跨实例流程都走内嵌树（桌面端的 DirectoryTreePicker 不支持指定实例） */
        useEmbeddedTree() {
            return !this.isDesktop || this.showInstancePicker;
        },
        /** 第一步标题里的「所选 N 个文件」 */
        currentInstanceLabel() {
            if (!this.targetInstanceId) return this.$t('fileManager.instanceDefault');
            const hit = this.instances.find((i) => String(i.id) === String(this.targetInstanceId));
            return hit ? hit.name : this.$t('fileManager.instanceDefault');
        }
    },
    watch: {
        modelValue(newVal) {
            if (newVal) {
                // v3.0.0：每次打开都重新走两步，不记忆上次选择
                this.targetPath = this.initialPath || '/';
                this.showTreePicker = false;
                this.treeData = [];
                this.treeError = '';
                this.targetInstanceId = String(this.instanceId || '');
                // v1.1.5：每次打开都回到「未选择」态，强制用户重新确认走移动还是复制
                this.moveMode = '';
                if (this.showInstancePicker) {
                    // 先停在「选择接收实例」，拉回列表后若只有默认实例会自动跳到目录步骤
                    this.step = 'instance';
                    this.loadInstances();
                } else {
                    this.step = 'directory';
                }
            }
        },
        showTreePicker(newVal) {
            if (newVal && this.useEmbeddedTree) {
                this.fetchDirectoryTree();
            }
        }
    },
    mounted() {
        window.addEventListener('resize', this.handleResize);
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.handleResize);
    },
    methods: {
        handleResize() {
            this.windowWidth = window.innerWidth;
        },
        /** v3.0.0：实例创建序号（后端 index 为 1-based；缺省时按列表顺序） */
        instanceSeq(ins) {
            const idx = Number(ins?.index);
            if (Number.isFinite(idx) && idx > 0) return idx;
            const pos = this.instances.findIndex((i) => String(i.id) === String(ins?.id));
            return pos >= 0 ? pos + 1 : 0;
        },
        /** v3.0.0：拉取实例列表（只有默认实例时直接跳过第一步） */
        async loadInstances() {
            this.instancesLoading = true;
            try {
                const res = await fetchWithAuth('/api/instances', { method: 'GET' });
                const list = res.ok ? await res.json() : [];
                this.instances = (Array.isArray(list) ? list : []).slice().sort((a, b) => {
                    const ia = Number(a?.index) || 0;
                    const ib = Number(b?.index) || 0;
                    if (ia !== ib) return ia - ib;
                    const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return ta - tb;
                });
            } catch (e) {
                this.instances = [];
            } finally {
                this.instancesLoading = false;
                /*
                 * v1.1.5：不再「只有默认实例时自动跳目录」——
                 * 因为这一步现在还要选「移动 / 复制」，跳过就等于替用户做了决定。
                 * 没有其它实例时列表里仍有「默认实例」一项可选，行为不受影响。
                 */
                this.step = this.showInstancePicker ? 'instance' : 'directory';
            }
        },
        pickInstance(id) {
            this.targetInstanceId = String(id || '');
        },
        /** v1.1.5：选择操作方式（'move' | 'copy'），再点一次可取消回到未选态 */
        pickMode(mode) {
            this.moveMode = this.moveMode === mode ? '' : mode;
        },
        goDirectoryStep() {
            // 双保险：按钮本身已禁用，这里再挡一次「未选操作方式」
            if (!this.moveMode) return;
            this.step = 'directory';
            this.treeData = [];
            this.treeError = '';
            // 选定实例后直接展开内嵌目录树（watch showTreePicker → 按目标实例拉树）
            if (this.useEmbeddedTree) {
                if (this.showTreePicker) this.fetchDirectoryTree();
                else this.showTreePicker = true;
            }
        },
        handleDirectorySelect(path) {
            this.targetPath = path;
        },
        handleConfirm() {
            /*
             * v1.1.5：第三个参数 = 操作方式（'move' | 'copy'）。
             * 旧调用点只声明两个参数，多传一个不会破坏它们（JS 直接忽略）。
             */
            const instance = this.showInstancePicker ? String(this.targetInstanceId || '') : String(this.instanceId || '');
            const mode = this.showInstancePicker ? (this.moveMode || 'move') : 'move';
            this.$emit('confirm', this.targetPath, instance, mode);
        },
        handleClose() {
            this.$emit('update:modelValue', false);
            this.$emit('close');
        },
        /** 内嵌树：按目标实例拉取整棵目录树 */
        async fetchDirectoryTree() {
            this.treeLoading = true;
            this.treeError = '';

            try {
                const targetInstance = this.showInstancePicker ? String(this.targetInstanceId || '') : String(this.instanceId || '');
                const response = await fetchWithAuth(
                    `/api/directoryTree?instanceId=${encodeURIComponent(targetInstance)}`,
                    { method: 'GET' }
                );

                if (!response.ok) {
                    if (response.status === 401) {
                        this.treeError = this.$t('moveFile.authFailed');
                    } else {
                        this.treeError = this.$t('moveFile.serverError');
                    }
                    return;
                }
                const data = await response.json();

                if (data.tree) {
                    this.treeData = [data.tree];
                } else {
                    this.treeData = [];
                }
            } catch (err) {
                console.error('Failed to fetch directory tree:', err);
                this.treeError = this.$t('moveFile.loadTreeFailed');
            } finally {
                this.treeLoading = false;
            }
        },
        handleTreeNodeClick(data) {
            let path = data.path;
            if (path && !path.startsWith('/')) {
                path = '/' + path;
            } else if (!path) {
                path = '/';
            }
            this.targetPath = path;
            this.showTreePicker = false;
        }
    }
};
</script>

<style scoped>
/* v3.0.0：弹窗内容区结构（桌面 / 移动共用） */
.move-dialog-content {
    padding: 0;
    max-height: 60vh;
    overflow-y: auto;
    overscroll-behavior-y: contain;
}

.move-path-input-container {
    display: flex;
    align-items: center;
    gap: 10px;
}

.move-path-input {
    flex: 1;
    min-width: 0;
}

.directory-picker-trigger {
    flex-shrink: 0;
}

.move-dialog-hint {
    margin-top: 12px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

/* v3.0.0：第一步「选择接收实例」 */
.move-step-instance {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.move-instance-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 46vh;
    overflow-y: auto;
}

.move-instance-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    padding: 9px 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.18s ease, background-color 0.18s ease;
}

.move-instance-item:hover {
    border-color: var(--el-border-color);
}

.move-instance-item.is-active {
    border-color: var(--primary-color-accent, var(--el-color-primary));
    background: color-mix(in srgb, var(--primary-color, var(--el-color-primary)) 10%, transparent);
    color: var(--primary-color-accent, var(--el-color-primary));
}

.move-instance-icon {
    width: 12px;
    opacity: 0.75;
}

.move-instance-seq {
    flex: 0 0 auto;
    min-width: 18px;
    font-size: 11px;
    font-weight: 600;
    opacity: 0.65;
}

.move-instance-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.move-instance-check {
    width: 12px;
    flex: 0 0 auto;
}

/* v1.1.5：「移动 / 复制」二选一 */
.move-mode-block {
    margin-top: 4px;
    padding-top: 12px;
    border-top: 1px dashed var(--el-border-color-lighter);
}

.move-mode-title {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 600;
}

.move-mode-required {
    color: var(--el-color-danger);
    font-weight: 700;
}

.move-mode-list {
    display: flex;
    gap: 8px;
}

.move-mode-item {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
        'icon name check'
        '.    desc desc';
    align-items: center;
    gap: 2px 6px;
    flex: 1 1 0;
    min-width: 0;
    box-sizing: border-box;
    padding: 9px 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.18s ease, background-color 0.18s ease;
}

.move-mode-item:hover {
    border-color: var(--el-border-color);
}

.move-mode-item.is-active {
    border-color: var(--primary-color-accent, var(--el-color-primary));
    background: color-mix(in srgb, var(--primary-color, var(--el-color-primary)) 10%, transparent);
    color: var(--primary-color-accent, var(--el-color-primary));
}

.move-mode-icon {
    grid-area: icon;
    width: 12px;
    opacity: 0.75;
}

.move-mode-name {
    grid-area: name;
    font-weight: 600;
}

.move-mode-item .move-instance-check {
    grid-area: check;
}

.move-mode-desc {
    grid-area: desc;
    /* 描述文字跟随主题色会显得太抢眼，这里降到次要色，白色卡片上依然清晰 */
    opacity: 0.7;
    font-size: 11px;
    line-height: 1.45;
    white-space: normal;
    word-break: break-word;
}

.move-mode-tip {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--el-color-danger);
}

.move-mode-tip.is-chosen {
    color: var(--el-text-color-secondary);
}

/* 第二步顶部的小徽标：标明本次是移动还是复制 */
.move-mode-badge {
    flex: 0 0 auto;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
    line-height: 1.5;
    font-weight: 600;
}

.move-mode-badge.is-move {
    color: var(--el-color-warning);
    background: color-mix(in srgb, var(--el-color-warning) 14%, transparent);
}

.move-mode-badge.is-copy {
    color: var(--el-color-success);
    background: color-mix(in srgb, var(--el-color-success) 14%, transparent);
}

/* 第二步顶部：当前选择的接收实例 + 「重新选择」 */
.move-instance-current {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--el-fill-color-light);
    font-size: 12px;
}

.move-instance-current-label {
    opacity: 0.65;
}

.move-instance-current-name {
    font-weight: 600;
}

.move-step-back {
    margin-left: auto;
}

/* 内嵌目录树样式 */
.embedded-tree-section {
    margin-top: 16px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    overflow: hidden;
}

.tree-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: var(--el-fill-color-light);
    border-bottom: 1px solid var(--el-border-color-lighter);
}

.tree-section-title {
    font-size: 14px;
    font-weight: 500;
}

.tree-container {
    min-height: 200px;
    max-height: 300px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 8px;
}

.directory-tree {
    background: transparent;
}

.directory-tree :deep(.el-tree-node__content) {
    height: 44px;
    padding: 0 8px;
    border-radius: 8px;
}

.tree-node {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    width: 100%;
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
}

.node-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

.dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
}
</style>

<style>
/* v3.0.0：移动端弹窗 92% 宽 + 水平居中（align-center 负责垂直居中） */
.move-dialog.el-dialog {
    margin: 0 auto;
}
@media (max-width: 768px) {
    .move-dialog.el-dialog {
        width: 92% !important;
        max-width: 92vw;
        margin: 0 auto;
    }
    .move-dialog .el-dialog__body {
        padding: 16px !important;
    }
    .move-dialog .tree-container {
        max-height: 46vh;
    }
}
</style>
