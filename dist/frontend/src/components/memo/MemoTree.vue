<template>
    <!--
        文档树（v1.3.9.1，原「记事树」）
        ----------------------------------------------------------------------------
        模型从「目录 + 笔记」合并成「文档节点」：每个节点本身就是一篇笔记，
        同时可以无限嵌套子笔记。树是一次拉全的扁平数组，前端按 parentId 组树。

        5 个一级节点（笔记 / 日记 / 札记 / 灵感 / 模板）由服务端保证存在，
        这里只负责展示与打标：不可拖拽、不可改名、不可删除。

        v1.3.9.1 新增：
          · 顶部「一键收起/展开全部层级」+「节点设置」；
          · 每个目录节点前的「收起/展开当前子树」；
          · 更多菜单：新建子页（同类型直建）、移动、升级；
          · 节点设置（行高 / 关系线 / 目录图标 / 各类型页图标）。
    -->
    <div class="mt-root">
        <div class="mt-head">
            <span class="mt-title">{{ $t('memo.treeTitle') }}</span>
            <div class="mt-head-actions">
                <!-- 一键收起 / 展开全部层级 -->
                <button
                    type="button"
                    class="mt-add"
                    :title="allExpanded ? $t('memo.collapseAll') : $t('memo.expandAll')"
                    @click="toggleAll"
                >
                    <font-awesome-icon :icon="allExpanded ? 'angles-up' : 'angles-down'" />
                </button>
                <!-- 节点设置 -->
                <button type="button" class="mt-add" :title="$t('memo.nodeSettings')" @click="openNodeSettings">
                    <font-awesome-icon icon="sliders-h" />
                </button>
                <!--
                    v1.3.9.1（需求）：回收站从树底部移到顶部栏「节点设置」右侧，改成图标形式。
                    进入回收站时按钮保持高亮，与树里原来的「回收站」条目同一语义。
                -->
                <button
                    type="button"
                    class="mt-add"
                    :class="{ 'is-trash-active': active === '__trash' }"
                    :title="$t('memo.trash')"
                    @click="$emit('trash')"
                >
                    <font-awesome-icon icon="trash" />
                </button>
            </div>
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

        <div
            class="mt-tree"
            :class="{ 'show-lines': settings.showLines }"
            :style="{ '--mt-row-h': settings.rowHeight + 'px' }"
        >
            <el-tree
                :key="treeKey"
                ref="tree"
                :data="treeData"
                node-key="id"
                :indent="0"
                :props="{ label: 'title', children: 'children' }"
                :expand-on-click-node="false"
                :default-expanded-keys="defaultExpanded"
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
                <template #default="{ node, data }">
                    <div class="mt-node" :class="{ 'is-current': data.id === active, 'is-system': data.isSystem }">
                        <span class="mt-node-main" @click.stop="onNodeClick(data)">
                            <font-awesome-icon :icon="iconOf(data)" class="mt-node-icon" />
                            <span class="mt-name" :title="data.title">{{ data.title || $t('memo.untitled') }}</span>
                        </span>
                        <!-- 子孙总数：空节点不显示，避免一排 0 抢注意力 -->
                        <span v-if="data.totalCount" class="mt-count">{{ data.totalCount }}</span>
                        <!-- 目录节点：一键收起 / 展开当前目录下全部子级（放在「更多菜单」前） -->
                        <button
                            v-if="hasChildren(data)"
                            type="button"
                            class="mt-node-act"
                            :title="node.expanded ? $t('memo.collapseChildren') : $t('memo.expandChildren')"
                            @click.stop="toggleSubtree(data, node)"
                        >
                            <font-awesome-icon :icon="node.expanded ? 'angles-up' : 'angles-down'" />
                        </button>
                        <el-dropdown
                            trigger="click"
                            class="mt-node-more"
                            :class="{ 'is-leaf': !hasChildren(data) }"
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
                                    <el-dropdown-item command="move" :disabled="data.isSystem">
                                        {{ $t('memo.moveNode') }}
                                    </el-dropdown-item>
                                    <el-dropdown-item command="promote" :disabled="data.isSystem || !data.parentId">
                                        {{ $t('memo.promoteNode') }}
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

        <!-- ============ 节点设置 ============ -->
        <el-dialog
            v-model="nodeSettingsVisible"
            :title="$t('memo.nodeSettingsTitle')"
            width="480px"
            append-to-body
            class="mt-settings-dialog"
        >
            <div class="mts-row">
                <label class="mts-label">{{ $t('memo.nodeRowHeight') }}</label>
                <el-input-number v-model="settingsDraft.rowHeight" :min="22" :max="64" :step="2" controls-position="right" size="small" />
                <span class="mts-unit">px</span>
            </div>
            <div class="mts-row">
                <label class="mts-label">{{ $t('memo.nodeShowLines') }}</label>
                <el-switch v-model="settingsDraft.showLines" size="small" />
            </div>
            <div class="mts-section-title">{{ $t('memo.nodeFolderIcon') }}</div>
            <el-select v-model="settingsDraft.folderIcon" size="small" class="mts-select">
                <!--
                    v1.3.9.1（需求）：选中值也要显示出图标来，不要只显示名称。
                    空串会被 el-select 当成「未选择」而显示 placeholder，所以草稿层用
                    DEFAULT_PICK 这个哨兵值代表「默认图标」，保存时再转回空串。
                -->
                <template #label>
                    <span class="mts-opt">
                        <font-awesome-icon :icon="iconOfDraft(settingsDraft.folderIcon, 'folder-open')" />
                        {{ settingsDraft.folderIcon === DEFAULT_PICK ? $t('memo.nodeDefaultIcon') : settingsDraft.folderIcon }}
                    </span>
                </template>
                <el-option :label="$t('memo.nodeDefaultIcon')" :value="DEFAULT_PICK">
                    <span class="mts-opt"><font-awesome-icon icon="folder-open" /> {{ $t('memo.nodeDefaultIcon') }}</span>
                </el-option>
                <el-option v-for="ic in iconChoices" :key="'f-' + ic" :label="ic" :value="ic">
                    <span class="mts-opt"><font-awesome-icon :icon="ic" /> {{ ic }}</span>
                </el-option>
            </el-select>
            <div class="mts-section-title">{{ $t('memo.nodeTypeIconSection') }}</div>
            <div v-for="d in docTypes" :key="'ti-' + d.key" class="mts-row">
                <label class="mts-label">{{ $t(d.label) }}</label>
                <el-select v-model="settingsDraft.typeIcons[d.key]" size="small" class="mts-select">
                    <template #label>
                        <span class="mts-opt">
                            <font-awesome-icon :icon="iconOfDraft(settingsDraft.typeIcons[d.key], d.icon)" />
                            {{ settingsDraft.typeIcons[d.key] === DEFAULT_PICK ? $t('memo.nodeDefaultIcon') : settingsDraft.typeIcons[d.key] }}
                        </span>
                    </template>
                    <el-option :label="$t('memo.nodeDefaultIcon')" :value="DEFAULT_PICK">
                        <span class="mts-opt"><font-awesome-icon :icon="d.icon" /> {{ $t('memo.nodeDefaultIcon') }}</span>
                    </el-option>
                    <el-option v-for="ic in iconChoices" :key="'t-' + d.key + '-' + ic" :label="ic" :value="ic">
                        <span class="mts-opt"><font-awesome-icon :icon="ic" /> {{ ic }}</span>
                    </el-option>
                </el-select>
            </div>
            <template #footer>
                <el-button size="small" @click="nodeSettingsVisible = false">{{ $t('common.cancel') }}</el-button>
                <el-button size="small" type="primary" :loading="nodeSettingsSaving" @click="saveNodeSettingsDlg">
                    {{ $t('common.confirm') }}
                </el-button>
            </template>
        </el-dialog>

        <!-- ============ 移动到其他节点 ============ -->
        <el-dialog
            v-model="moveVisible"
            :title="$t('memo.moveTitle')"
            width="420px"
            append-to-body
            class="mt-move-dialog"
        >
            <p class="mt-move-tip">{{ $t('memo.moveTip') }}</p>
            <el-select v-model="moveTargetId" size="small" class="mt-move-select" :placeholder="$t('memo.movePick')">
                <el-option :label="$t('memo.moveRoot')" value="" />
                <el-option
                    v-for="c in moveCandidates"
                    :key="'mv-' + c.id"
                    :label="c.label"
                    :value="c.id"
                />
            </el-select>
            <template #footer>
                <el-button size="small" @click="moveVisible = false">{{ $t('common.cancel') }}</el-button>
                <el-button size="small" type="primary" :loading="moveSaving" @click="confirmMove">
                    {{ $t('common.confirm') }}
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus';
import {
    fetchTree, fetchNodeSettings, saveNodeSettings as apiSaveNodeSettings,
    renameNode, moveNode, reorderNodes, promoteNode, trashNote,
} from '@/utils/memoApi';
import {
    DOC_TYPES, ICON_CHOICES, DEFAULT_NODE_SETTINGS, normalizeNodeSettings, iconForNode,
} from '@/utils/memoNodeSettings';

export default {
    name: 'MemoTree',
    props: {
        /** 当前选中的节点 id；'__trash' 表示回收站 */
        active: { type: String, default: '' },
        instanceId: { type: String, default: '' },
    },
    emits: ['select', 'create', 'create-child', 'changed', 'trash', 'loaded', 'node-settings-changed'],
    data() {
        return {
            nodes: [],
            roots: [],
            search: '',
            /** 传给 el-tree 的静态 default-expanded-keys（只在重建时生效，不做响应式受控） */
            defaultExpanded: [],
            /** 记住用户手动展开的层级（reload 后恢复） */
            openKeys: [],
            /** 强制重建树用的 key：改动展开集合时 +1，让 default-expanded-keys 精确生效 */
            treeKey: 0,
            treeInited: false,
            /** 节点设置 */
            settings: { ...DEFAULT_NODE_SETTINGS, typeIcons: { ...DEFAULT_NODE_SETTINGS.typeIcons } },
            nodeSettingsVisible: false,
            nodeSettingsSaving: false,
            settingsDraft: { ...DEFAULT_NODE_SETTINGS, typeIcons: { ...DEFAULT_NODE_SETTINGS.typeIcons } },
            /** 草稿里代表「默认图标」的哨兵值（空串会被 el-select 当成未选择而显示 placeholder） */
            DEFAULT_PICK: '__default__',
            /** 移动 */
            moveVisible: false,
            moveSaving: false,
            moveTargetId: '',
            moveNode: null,
            docTypes: DOC_TYPES,
            iconChoices: ICON_CHOICES.filter(Boolean),
        };
    },
    computed: {
        currentKey() {
            return this.active && this.active !== '__trash' ? this.active : undefined;
        },
        /**
         * 是否处于「已展开」态 —— 决定顶部按钮下一次是收起还是展开。
         * v1.3.9.1（需求）：只要有一个节点目录处于打开状态，按钮就显示已展开模式
         * （点击一键收起全部层级）；全部收起后再点击才是一键展开。
         */
        allExpanded() {
            const parents = this.nodes.filter((n) => this.childrenOf(n.id).length);
            if (!parents.length) return false;
            return parents.some((n) => this.openKeys.includes(n.id));
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
        /** 移动弹窗的候选节点（排除自身及整棵子树，避免形成环） */
        moveCandidates() {
            const moving = this.moveNode;
            const excluded = moving ? new Set(this.subtreeIdsOf(moving.id)) : new Set();
            const byId = new Map(this.nodes.map((n) => [n.id, n]));
            const pathOf = (n) => {
                const parts = [String(n.title || this.$t('memo.untitled'))];
                let p = String(n.parentId || '');
                let guard = 0;
                while (p && byId.has(p) && guard < 200) {
                    parts.unshift(String(byId.get(p).title || this.$t('memo.untitled')));
                    p = String(byId.get(p).parentId || '');
                    guard += 1;
                }
                return parts.join(' / ');
            };
            return this.nodes
                .filter((n) => !excluded.has(n.id))
                .map((n) => ({ id: n.id, label: pathOf(n) }))
                .sort((a, b) => a.label.localeCompare(b.label, 'zh'));
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
        /** 子节点 id 列表（按扁平 nodes 算） */
        childrenOf(id) {
            return this.nodes.filter((n) => String(n.parentId || '') === String(id));
        },
        /** 含自身的整棵子树 id 列表 */
        subtreeIdsOf(id) {
            const out = new Set([String(id)]);
            let changed = true;
            let guard = 0;
            while (changed && guard < 200) {
                changed = false;
                guard += 1;
                for (const n of this.nodes) {
                    const pid = String(n.parentId || '');
                    if (out.has(pid) && !out.has(n.id)) {
                        out.add(n.id);
                        changed = true;
                    }
                }
            }
            return [...out];
        },
        hasChildren(data) {
            return (Array.isArray(data.children) && data.children.length > 0) || this.childrenOf(data.id).length > 0;
        },
        iconOf(n) {
            return iconForNode(n, this.settings);
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
            // 系统节点按 笔记/日记/札记/灵感/模板 的固定顺序排，其余按 sort
            const order = { 笔记: 0, 日记: 1, 札记: 2, 灵感: 3, 模板: 4 };
            roots.sort((a, b) => {
                const ai = a.isSystem ? order[a.title] ?? 9 : 99;
                const bi = b.isSystem ? order[b.title] ?? 9 : 99;
                if (ai !== bi) return ai - bi;
                return sortFn(a, b);
            });
            return roots;
        },
        /** 用「重建树」的方式精确设置展开集合，避免受控 default-expanded-keys 抖动 */
        applyExpandedKeys(keys) {
            this.openKeys = [...new Set(keys)];
            this.defaultExpanded = this.openKeys.slice();
            this.treeKey += 1;
        },
        async reload() {
            try {
                const [r, s] = await Promise.all([fetchTree(), fetchNodeSettings().catch(() => null)]);
                this.nodes = Array.isArray(r?.nodes) ? r.nodes : [];
                this.roots = Array.isArray(r?.roots) ? r.roots : [];
                if (s) {
                    this.settings = normalizeNodeSettings(s);
                    this.$emit('node-settings-changed', this.settings);
                }
                if (!this.treeInited) {
                    this.treeInited = true;
                    this.openKeys = this.roots.map((x) => x.id).filter(Boolean);
                }
                this.defaultExpanded = this.openKeys.slice();
                this.treeKey += 1;
                this.$emit('loaded', { nodes: this.nodes, roots: this.roots, nodeSettings: this.settings });
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.loadFail'));
            }
        },
        onExpand(data) {
            if (data?.id && !this.openKeys.includes(data.id)) this.openKeys.push(data.id);
        },
        onCollapse(data) {
            this.openKeys = this.openKeys.filter((id) => id !== data?.id);
        },
        /**
         * 直接改 el-tree 内部节点的 expanded（带 collapse-transition 过渡），
         * 不再重建整棵树 —— v1.3.9.1（需求）：一键收起 / 展开的动作要柔和，
         * 重建树的方式是「整棵瞬间消失 / 出现」，观感生硬且会把滚动位置打回去。
         */
        setSubtreeExpanded(ids, expanded) {
            const store = this.$refs.tree && this.$refs.tree.store;
            if (!store || !store.nodesMap) return false;
            const walk = (id) => {
                const nm = store.nodesMap[id];
                if (nm) nm.expanded = expanded;
                for (const c of this.childrenOf(id)) walk(c.id);
            };
            for (const id of ids) walk(id);
            return true;
        },
        /** 一键收起 / 展开全部层级 */
        toggleAll() {
            if (this.allExpanded) {
                const parents = this.nodes.filter((n) => this.childrenOf(n.id).length).map((n) => n.id);
                if (!this.setSubtreeExpanded(parents, false)) this.applyExpandedKeys([]);
                this.openKeys = [];
            } else {
                const all = this.nodes.map((n) => n.id);
                if (!this.setSubtreeExpanded(all, true)) this.applyExpandedKeys(all);
                this.openKeys = [...all];
            }
        },
        /** 一键收起 / 展开当前目录下的全部子级（v1.3.9.1：改为过渡动画，不再重建树） */
        toggleSubtree(data, node) {
            const ids = this.subtreeIdsOf(data.id);
            const isOpen = !!(node && node.expanded);
            if (!this.setSubtreeExpanded([data.id], !isOpen)) {
                // 取不到 tree store（极端时序）时退回重建方式，保证功能不失效
                if (isOpen) this.applyExpandedKeys(this.openKeys.filter((id) => !ids.includes(id)));
                else this.applyExpandedKeys([...this.openKeys, ...ids]);
                return;
            }
            if (isOpen) this.openKeys = this.openKeys.filter((id) => !ids.includes(id));
            else this.openKeys = [...new Set([...this.openKeys, ...ids])];
        },
        /** 新建 / 跳转后把目标节点的祖先链展开，否则它藏在收起的层级里看不见 */
        revealNode(id) {
            const byId = new Map(this.nodes.map((n) => [n.id, n]));
            const add = [];
            let cur = byId.get(id)?.parentId || '';
            let guard = 0;
            while (cur && guard < 500) {
                add.push(cur);
                cur = byId.get(cur)?.parentId || '';
                guard += 1;
            }
            const need = add.filter((x) => !this.openKeys.includes(x));
            if (need.length) this.applyExpandedKeys([...this.openKeys, ...need]);
        },
        applyFilter() {
            // 搜索时把所有保留节点临时展开，保证命中项与祖先链都可见
            if (this.search.trim()) {
                this.defaultExpanded = this.nodes.map((n) => n.id);
            } else {
                this.defaultExpanded = this.openKeys.slice();
            }
            this.treeKey += 1;
            this.$nextTick(() => {
                const el = this.$refs.tree;
                if (el && el.setCurrentKey) el.setCurrentKey(this.currentKey);
            });
        },
        clearSearch() {
            this.search = '';
            this.applyFilter();
        },
        onNodeClick(data) {
            this.$emit('select', data.id);
        },
        allowDrag(node) {
            return !node.data.isSystem;
        },
        allowDrop(dragNode, dropNode, type) {
            if (!dragNode || !dropNode) return false;
            let p = dropNode;
            while (p) {
                if (p.data && p.data.id === dragNode.data.id) return false;
                p = p.parent;
            }
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
                const container = type === 'inner' ? dropNode : dropNode.parent;
                const siblings = (container && container.childNodes ? container.childNodes : [])
                    .map((x) => x.data && x.data.id)
                    .filter(Boolean);
                if (siblings.length) await reorderNodes(parentId, siblings);
                await this.reload();
                this.$emit('changed', { docTypeChanged: true });
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.saveFail'));
                await this.reload();
            }
        },
        onCommand(cmd, data) {
            if (cmd === 'child') return this.$emit('create-child', { id: data.id, docType: data.docType });
            if (cmd === 'rename') return this.doRename(data);
            if (cmd === 'move') return this.openMove(data);
            if (cmd === 'promote') return this.doPromote(data);
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
        /** 移动：弹窗选目标节点，确定后由后端重算文档类型 */
        openMove(node) {
            this.moveNode = node;
            this.moveTargetId = String(node.parentId || '');
            this.moveVisible = true;
        },
        async confirmMove() {
            if (!this.moveNode) return;
            if (this.moveTargetId === this.moveNode.id) {
                ElMessage.warning(this.$t('memo.moveSelfDenied'));
                return;
            }
            this.moveSaving = true;
            try {
                await moveNode(this.moveNode.id, { parentId: this.moveTargetId });
                this.moveVisible = false;
                await this.reload();
                this.$emit('changed', { docTypeChanged: true });
                ElMessage.success(this.$t('memo.moveDone'));
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.saveFail'));
            } finally {
                this.moveSaving = false;
            }
        },
        /** 升级：层级上升一级（后端同步重算类型） */
        async doPromote(node) {
            try {
                await ElMessageBox.confirm(
                    this.$t('memo.promoteTip', { title: node.title || this.$t('memo.untitled') }),
                    this.$t('memo.promoteNode'),
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
                await promoteNode(node.id);
                await this.reload();
                this.$emit('changed', { docTypeChanged: true });
                ElMessage.success(this.$t('memo.promoteDone'));
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
        // ---------------- 节点设置 ----------------
        /** 下拉里「默认」项显示的图标：哨兵 / 空值都退回该类型的默认图标 */
        iconOfDraft(icon, fallback) {
            return !icon || icon === this.DEFAULT_PICK ? fallback : icon;
        },
        openNodeSettings() {
            const s = this.settings;
            const typeIcons = {};
            for (const d of DOC_TYPES) typeIcons[d.key] = (s.typeIcons && s.typeIcons[d.key]) || this.DEFAULT_PICK;
            this.settingsDraft = {
                rowHeight: s.rowHeight,
                showLines: s.showLines,
                folderIcon: s.folderIcon || this.DEFAULT_PICK,
                typeIcons,
            };
            this.nodeSettingsVisible = true;
        },
        async saveNodeSettingsDlg() {
            this.nodeSettingsSaving = true;
            try {
                const d = this.settingsDraft;
                const typeIcons = {};
                for (const t of DOC_TYPES) {
                    const v = d.typeIcons[t.key];
                    typeIcons[t.key] = !v || v === this.DEFAULT_PICK ? '' : v;
                }
                const saved = await apiSaveNodeSettings({
                    rowHeight: d.rowHeight,
                    showLines: d.showLines,
                    folderIcon: !d.folderIcon || d.folderIcon === this.DEFAULT_PICK ? '' : d.folderIcon,
                    typeIcons,
                });
                this.settings = normalizeNodeSettings(saved);
                this.$emit('node-settings-changed', this.settings);
                // 行高 / 关系线 / 图标变了，重建一次树让新设置完整生效
                this.defaultExpanded = this.openKeys.slice();
                this.treeKey += 1;
                this.nodeSettingsVisible = false;
                ElMessage.success(this.$t('memo.nodeSettingsSaved'));
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.saveFail'));
            } finally {
                this.nodeSettingsSaving = false;
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
.mt-head-actions {
    display: inline-flex;
    align-items: center;
    gap: 5px;
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
.mt-add-primary {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
}
.mt-add-primary:hover {
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
    /* v1.3.9.1：滚动条出现 / 消失不再挤压行宽，避免滚动到边界时横向抖动 */
    scrollbar-gutter: stable;
    padding: 0 4px 12px;
}
/* 行高设置 */
.mt-tree :deep(.el-tree-node__content) {
    height: var(--mt-row-h, 32px);
}
/*
 * v1.3.9.1（需求）：层级缩进调小 + 关系线结构重做（保持虚线）。
 * 原生 indent 不再使用（:indent="0"），每层缩进改由容器 margin + 行首短虚线控制
 * （合计约 20px/层，比旧版 el-tree 默认的 16+24 小一半）；
 * 关系线 = 每个直接子节点左缘一条竖虚线（贯穿到该子树末尾，
 * 最后一个直接子节点只画到行中心），每行再从竖线接一段水平短虚线到行首 ——
 * 即参考图中的「直角折线」结构。
 */
.mt-tree :deep(.el-tree-node) {
    position: relative;
}
/* 行首展开箭头收紧：默认 padding 6px + 12px 字号把每行左缘撑出 24px 空白 */
.mt-tree :deep(.el-tree-node__expand-icon) {
    padding: 2px 3px;
    font-size: 11px;
    margin-right: 1px;
}
.mt-tree :deep(.el-tree-node__children) {
    margin-left: 8px;
    position: relative;
}
/* 竖虚线：挂在每个直接子节点上（el-tree-node 高度含其子树） */
.mt-tree.show-lines :deep(.el-tree-node__children > .el-tree-node)::before {
    content: '';
    position: absolute;
    left: 4px;
    top: 0;
    height: 100%;
    border-left: 1px dashed var(--el-border-color);
    pointer-events: none;
}
/* 最后一个直接子节点：竖线只画到它第一行的中心（转角终点） */
.mt-tree.show-lines :deep(.el-tree-node__children > .el-tree-node:last-child)::before {
    height: calc(var(--mt-row-h, 32px) / 2);
}
/* 水平短虚线：从竖线位置接到行首（跨过竖线，自然衔接成直角折线） */
.mt-tree.show-lines :deep(.el-tree-node__children > .el-tree-node > .el-tree-node__content)::before {
    content: '';
    flex: 0 0 auto;
    width: 8px;
    margin-left: 1px;
    margin-right: 2px;
    border-top: 1px dashed var(--el-border-color);
    pointer-events: none;
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
    cursor: pointer;
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
.mt-node-act {
    flex: 0 0 auto;
    margin-left: auto;
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 1px 3px;
    font-size: 10px;
    color: var(--el-text-color-secondary);
    opacity: 0;
}
.mt-node:hover .mt-node-act,
.mt-node.is-current .mt-node-act {
    opacity: 1;
}
.mt-node-act:hover {
    color: var(--el-color-primary);
}
.mt-node-more {
    flex: 0 0 auto;
    margin-left: 2px;
    opacity: 0;
}
/*
 * v1.3.9.1（需求）：叶子节点的「更多菜单」也要像目录节点那样显示在行末（靠右对齐）。
 * 目录行靠 mt-node-act 的 auto margin 推到右侧；叶子行没有该按钮，由 is-leaf 补上。
 */
.mt-node-more.is-leaf {
    margin-left: auto;
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
/* v1.3.9.1：顶部栏回收站按钮的激活态（从树底部移上来后保留高亮语义） */
.mt-add.is-trash-active {
    background: var(--el-color-primary);
    color: #fff;
}
/* 移动端：操作按钮常显（没有 hover） */
@media (hover: none) {
    .mt-node-more,
    .mt-node-act {
        opacity: 1;
    }
}

/* 节点设置弹窗 */
.mts-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
}
.mts-label {
    width: 128px;
    flex: 0 0 auto;
    font-size: 12.5px;
    color: var(--el-text-color-regular);
}
.mts-unit {
    font-size: 11px;
    color: var(--el-text-color-secondary);
}
.mts-section-title {
    margin: 16px 0 8px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    border-top: 1px solid var(--el-border-color-lighter);
    padding-top: 12px;
}
.mts-select {
    flex: 1 1 auto;
    min-width: 0;
}
.mts-opt {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
}
.mt-move-tip {
    margin: 0 0 10px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
}
.mt-move-select {
    width: 100%;
}
</style>
