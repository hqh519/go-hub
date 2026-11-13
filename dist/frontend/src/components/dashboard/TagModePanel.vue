<template>
    <!--
        v3.0.0：标签管理模式面板
        ---------------------------------------------------------------
        「筛选」后面的「标签管理」按钮切进来后，文件列表区隐藏、这里接管主区域：
          · 顶部：标题 + 搜索（本地过滤）+ 排序切换（创建时间 / 名称 / 文件数量）+ 排序方向 + 退出
          · 列表：桌面端一行 3 张卡片（移动端单列），卡片 = 标签名 + 文件数 + 多选框 + 「⋮」属性入口
          · 多选：勾选标签后底部出现悬浮批量菜单（批量删除 / 合并）
          · 属性页（⋮）：标签名 → 备注 → 标签对外分享（+密码+时限）→ 删除标签
        全部请求都带 instanceId（空串 = 默认实例）。
        v3.0.0：移除全部「标签加密」相关 UI（加密不再参与外链鉴权）。
    -->
    <div class="tag-mode-panel">
        <div class="tag-mode-toolbar">
            <div class="tag-mode-title">
                <font-awesome-icon icon="tags" class="tag-mode-title-icon"/>
                <span>{{ $t('fileManager.tagModeTitle') }}</span>
            </div>
            <!-- 搜索框：仅本地过滤标签名，输入即过滤 -->
            <el-input
                v-model="search"
                size="small"
                clearable
                class="tag-mode-search"
                :placeholder="$t('fileManager.tagSearchPlaceholder')"
            >
                <template #prefix>
                    <font-awesome-icon icon="search" class="tag-mode-search-icon"/>
                </template>
            </el-input>
            <div class="tag-mode-toolbar-right">
                <el-radio-group :model-value="sort" size="small" class="tag-sort-group" @change="setSort">
                    <el-radio-button label="createdAt">{{ $t('fileManager.tagSortCreated') }}</el-radio-button>
                    <el-radio-button label="name">{{ $t('fileManager.tagSortName') }}</el-radio-button>
                    <el-radio-button label="count">{{ $t('fileManager.tagSortCount') }}</el-radio-button>
                </el-radio-group>
                <button type="button" class="tag-sort-order" :title="orderTitle" @click="toggleOrder">
                    <font-awesome-icon :icon="order === 'asc' ? 'arrow-up' : 'arrow-down'"/>
                    <span>{{ order === 'asc' ? $t('fileManager.tagSortAsc') : $t('fileManager.tagSortDesc') }}</span>
                </button>
                <el-button size="small" class="tag-mode-refresh" :loading="loading" @click="load">
                    <font-awesome-icon icon="sync"/>
                    <span class="tag-mode-btn-text">{{ $t('dashboard.refreshFiles') }}</span>
                </el-button>
                <el-button size="small" class="tag-mode-exit" @click="$emit('close')">
                    <font-awesome-icon icon="times"/>
                    <span class="tag-mode-btn-text">{{ $t('fileManager.tagModeExit') }}</span>
                </el-button>
            </div>
        </div>

        <div v-loading="loading" class="tag-mode-list">
            <div v-if="!loading && tags.length === 0" class="tag-mode-empty">
                <font-awesome-icon icon="tags" class="tag-mode-empty-icon"/>
                <p>{{ $t('fileManager.tagModeEmpty') }}</p>
            </div>
            <div v-else-if="!loading && filteredTags.length === 0" class="tag-mode-empty">
                <font-awesome-icon icon="search" class="tag-mode-empty-icon"/>
                <p>{{ $t('fileManager.tagSearchEmpty') }}</p>
            </div>
            <!-- v3.0.0：桌面端一行 3 个的卡片网格（移动端单列） -->
            <div v-else class="tag-mode-grid">
                <div
                    v-for="tag in filteredTags"
                    :key="tag.id"
                    class="tag-mode-card"
                    :class="{ 'is-selected': selectedIds.includes(tag.id) }"
                >
                    <div class="tag-mode-card-main">
                        <el-checkbox
                            :model-value="selectedIds.includes(tag.id)"
                            class="tag-mode-check"
                            @change="toggleSelect(tag.id)"
                        />
                        <!-- v3.0.0（第三轮）：标签名与数量合并为一行「名称 (数量)」，不再单独占一行 -->
                        <span class="tag-mode-name" :title="tag.name" @click="toggleSelect(tag.id)">
                            <span class="tag-mode-name-text">{{ tag.name }}</span>
                            <span class="tag-mode-count">({{ tag.count }})</span>
                        </span>
                        <el-dropdown
                            trigger="click"
                            class="tag-mode-menu"
                            @command="(cmd) => handleMenuCommand(cmd, tag)"
                        >
                            <button type="button" class="tag-mode-menu-btn" :aria-label="$t('fileManager.tagProps')" @click.stop>
                                <font-awesome-icon icon="ellipsis-v"/>
                            </button>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item command="props">
                                        <font-awesome-icon icon="edit" class="tag-menu-ico"/>
                                        <span>{{ $t('fileManager.tagProps') }}</span>
                                    </el-dropdown-item>
                                    <el-dropdown-item command="merge">
                                        <font-awesome-icon icon="code-branch" class="tag-menu-ico"/>
                                        <span>{{ $t('fileManager.tagBatchMerge') }}</span>
                                    </el-dropdown-item>
                                    <!-- v3.0.0：拆分标签（合并之后） -->
                                    <el-dropdown-item command="split">
                                        <font-awesome-icon icon="cut" class="tag-menu-ico"/>
                                        <span>{{ $t('fileManager.tagSplit') }}</span>
                                    </el-dropdown-item>
                                    <el-dropdown-item command="delete" divided>
                                        <span class="tag-menu-danger">{{ $t('common.delete') }}</span>
                                    </el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>
                    </div>
                </div>
            </div>
        </div>

        <!-- 多选后的批量菜单：v3.0.0 改为悬浮条（与文件管理模式的批量操作栏一致） -->
        <transition name="tag-batch">
            <div v-if="selectedIds.length > 0" class="tag-batch-bar">
                <button type="button" class="tag-batch-clear" :aria-label="$t('dashboard.clearSelection')" @click="selectedIds = []">
                    <font-awesome-icon icon="times"/>
                </button>
                <span class="tag-batch-count">{{ $t('fileManager.tagSelected', { count: selectedIds.length }) }}</span>
                <span class="tag-batch-divider"></span>
                <el-button size="small" type="primary" plain @click="openMergeFromSelection">
                    {{ $t('fileManager.tagBatchMerge') }}
                </el-button>
                <el-button size="small" type="danger" plain @click="batchDelete">
                    {{ $t('fileManager.tagBatchDelete') }}
                </el-button>
            </div>
        </transition>

        <!-- 属性面板：改名 / 备注 / 对外分享 / 删除 -->
        <el-dialog
            v-model="showProps"
            :title="$t('fileManager.tagProps')"
            :width="dialogWidth"
            append-to-body
            class="tag-props-dialog"
        >
            <div v-if="activeTag" class="tag-props-body">
                <div class="tag-props-section">
                    <div class="tag-props-label">{{ $t('fileManager.tagRename') }}</div>
                    <div class="tag-props-row">
                        <el-input
                            v-model="renameValue"
                            size="default"
                            maxlength="64"
                            :placeholder="$t('fileManager.tagRenamePlaceholder')"
                            @keyup.enter="saveAll"
                        />
                    </div>
                </div>

                <!-- v3.0.0：标签对外分享（无权限时整块不显示） -->
                <div v-if="shareAllowed" class="tag-props-section">
                    <div class="tag-props-label tag-props-label-row">
                        <span>{{ $t('fileManager.tagShare') }}</span>
                        <el-tooltip :content="$t('fileManager.tagShareHint')" placement="top" effect="dark">
                            <button type="button" class="tag-props-help" :aria-label="$t('fileManager.tagShareHint')">
                                <font-awesome-icon icon="question-circle"/>
                            </button>
                        </el-tooltip>
                    </div>
                    <div class="tag-props-row">
                        <el-switch
                            v-model="shareOn"
                            :loading="shareSaving"
                            :disabled="shareLoading"
                            @change="onShareToggle"
                        />
                        <span class="tag-props-switch-text">{{ shareOn ? $t('fileManager.tagShareOn') : $t('fileManager.tagShareOff') }}</span>
                    </div>
                    <template v-if="shareOn">
                        <div class="tag-props-sub">
                            <div class="tag-props-label">{{ $t('fileManager.sharePassword') }}</div>
                            <div class="tag-props-row">
                                <el-input
                                    v-model="sharePassword"
                                    type="password"
                                    show-password
                                    clearable
                                    :placeholder="$t('fileManager.sharePasswordPlaceholder')"
                                    @input="sharePasswordDirty = true"
                                    @clear="sharePasswordDirty = true"
                                />
                                <el-button v-if="shareRecord && shareRecord.encrypted" :loading="shareSaving" @click="clearSharePassword">
                                    {{ $t('fileManager.sharePasswordClear') }}
                                </el-button>
                            </div>
                        </div>
                        <div class="tag-props-sub">
                            <div class="tag-props-label">{{ $t('fileManager.shareExpire') }}</div>
                            <div class="tag-props-row">
                                <el-select v-model="shareExpireMode" class="tag-props-select">
                                    <el-option value="never" :label="$t('fileManager.shareExpireNever')"/>
                                    <el-option value="1d" :label="$t('fileManager.shareExpire1d')"/>
                                    <el-option value="7d" :label="$t('fileManager.shareExpire7d')"/>
                                    <el-option value="30d" :label="$t('fileManager.shareExpire30d')"/>
                                    <el-option value="custom" :label="$t('fileManager.shareExpireCustom')"/>
                                </el-select>
                                <el-date-picker
                                    v-if="shareExpireMode === 'custom'"
                                    v-model="shareExpireAt"
                                    type="datetime"
                                    class="tag-props-date"
                                    :popper-class="datePopperClass"
                                    value-format="YYYY-MM-DDTHH:mm:ss"
                                    :placeholder="$t('fileManager.shareExpireCustom')"
                                />
                            </div>
                        </div>

                    </template>
                </div>

                <!-- v3.0.0：备注（仅自己可见） -->
                <div class="tag-props-section">
                    <div class="tag-props-label">{{ $t('fileManager.tagNote') }}</div>
                    <el-input
                        v-model="noteValue"
                        type="textarea"
                        :rows="3"
                        maxlength="1000"
                        show-word-limit
                        :placeholder="$t('fileManager.tagNotePlaceholder')"
                    />
                    <div class="tag-props-row">
                        <span class="tag-props-hint tag-props-hint-inline">{{ $t('fileManager.tagNoteHint') }}</span>
                    </div>
                </div>

            </div>
            <template #footer>
                <!-- v3.0.0：属性页统一一个保存按钮（改名 / 对外分享 / 备注一起保存），放在「关闭」之后 -->
                <el-button @click="showProps = false">{{ $t('common.close') }}</el-button>
                <el-button type="primary" :loading="saving || shareSaving || noteSaving" @click="saveAll">
                    {{ $t('common.save') }}
                </el-button>
            </template>
        </el-dialog>

        <!-- 合并标签 -->
        <el-dialog
            v-model="showMerge"
            :title="$t('fileManager.tagBatchMerge')"
            :width="dialogWidth"
            append-to-body
            class="tag-merge-dialog"
        >
            <div class="tag-merge-body">
                <div class="tag-props-hint">{{ $t('fileManager.tagMergeHint', { count: mergeSourceIds.length }) }}</div>
                <el-radio-group v-model="mergeMode" class="tag-merge-mode">
                    <el-radio label="existing">{{ $t('fileManager.tagMergeExisting') }}</el-radio>
                    <el-radio label="new">{{ $t('fileManager.tagMergeNew') }}</el-radio>
                </el-radio-group>
                <el-select
                    v-if="mergeMode === 'existing'"
                    v-model="mergeTargetId"
                    :placeholder="$t('fileManager.tagMergeTarget')"
                    filterable
                    class="tag-merge-select"
                >
                    <el-option
                        v-for="t in mergeTargetCandidates"
                        :key="t.id"
                        :label="`${t.name} (${t.count})`"
                        :value="t.id"
                    />
                </el-select>
                <el-input
                    v-else
                    v-model="mergeTargetName"
                    :placeholder="$t('fileManager.tagMergePlaceholder')"
                    maxlength="64"
                />
            </div>
            <template #footer>
                <el-button @click="showMerge = false">{{ $t('common.cancel') }}</el-button>
                <el-button type="primary" :loading="saving" :disabled="!canMerge" @click="doMerge">
                    {{ $t('common.confirm') }}
                </el-button>
            </template>
        </el-dialog>

        <!-- v3.0.0：拆分标签 -->
        <el-dialog
            v-model="showSplit"
            :title="$t('fileManager.tagSplit')"
            :width="dialogWidth"
            append-to-body
            class="tag-split-dialog"
        >
            <div class="tag-merge-body">
                <div class="tag-props-hint">
                    {{ $t('fileManager.tagSplitHint', { name: splitSourceName, count: splitSourceCount }) }}
                </div>
                <el-input
                    v-model="splitText"
                    type="textarea"
                    :rows="3"
                    :placeholder="$t('fileManager.tagSplitPlaceholder')"
                />
            </div>
            <template #footer>
                <el-button @click="showSplit = false">{{ $t('common.cancel') }}</el-button>
                <el-button type="primary" :loading="splitting" :disabled="!splitNames.length" @click="doSplit">
                    {{ $t('common.confirm') }}
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import { bindDialogLayers, trackMessageBox } from '@/utils/layerStack';

/**
 * v3.0.0 标签管理模式面板
 * 依赖后端：GET /api/tags/manage、PATCH/DELETE /api/tags/:id、
 *          POST /api/tags/merge、POST /api/tags/:id/split、
 *          POST/PATCH /api/shares（标签对外分享）
 */
export default {
    name: 'TagModePanel',
    props: {
        /** 当前实例 id（空串 = 默认实例）—— 所有标签请求都带上它 */
        instanceId: { type: String, default: '' }
    },
    emits: ['close', 'changed'],
    data() {
        return {
            tags: [],
            loading: false,
            saving: false,
            sort: 'createdAt',
            order: 'desc',
            selectedIds: [],
            /** v3.0.0：本地搜索（标签名） */
            search: '',
            showProps: false,
            activeTag: null,
            renameValue: '',
            /** v3.0.0：标签备注（后端 PATCH 需支持 note 才会真正落库） */
            noteValue: '',
            noteSaving: false,
            /* ---------- v3.0.0：标签对外分享 ---------- */
            shareAllowed: false,
            shareLoading: false,
            shareSaving: false,
            shareOn: false,
            shareRecord: null,
            sharePassword: '',
            sharePasswordDirty: false,
            shareExpireMode: 'never',
            shareExpireAt: '',
            showMerge: false,
            mergeMode: 'existing',
            mergeSourceIds: [],
            mergeTargetId: '',
            mergeTargetName: '',
            /* ---------- v3.0.0：拆分标签 ---------- */
            showSplit: false,
            splitting: false,
            splitText: '',
            splitSource: null,
            splitSourceName: '',
            splitSourceCount: 0
        };
    },
    computed: {
        dialogWidth() {
            return window.innerWidth <= 768 ? '92%' : '460px';
        },
        orderTitle() {
            return this.order === 'asc' ? this.$t('fileManager.tagSortAsc') : this.$t('fileManager.tagSortDesc');
        },
        /** 合并目标候选：排除被合并的源标签 */
        mergeTargetCandidates() {
            return this.tags.filter((t) => !this.mergeSourceIds.includes(t.id));
        },
        canMerge() {
            if (!this.mergeSourceIds.length) return false;
            if (this.mergeMode === 'existing') return !!this.mergeTargetId;
            return !!this.mergeTargetName.trim();
        },
        /** 输入即过滤（标签名，忽略大小写） */
        filteredTags() {
            const kw = String(this.search || '').trim().toLowerCase();
            if (!kw) return this.tags;
            return this.tags.filter((t) => String(t.name || '').toLowerCase().includes(kw));
        },
        /** 移动端日期选择面板居中（桌面端保持默认定位） */
        datePopperClass() {
            return window.innerWidth <= 768 ? 'tag-share-date-popper tag-share-date-popper--center' : 'tag-share-date-popper';
        },
        /** 拆分输入：逗号 / 换行 / 分号 分隔，去空去重 */
        splitNames() {
            const raw = String(this.splitText || '')
                .split(/[\n,，;；]+/)
                .map((s) => s.trim())
                .filter(Boolean);
            return Array.from(new Set(raw));
        },
        /** 提交给 /api/shares 的到期时间（'' = 不限时） */
        shareExpireIso() {
            const mode = this.shareExpireMode;
            if (mode === 'never') return '';
            if (mode === 'custom') {
                if (!this.shareExpireAt) return '';
                const d = new Date(this.shareExpireAt);
                return Number.isNaN(d.getTime()) ? '' : d.toISOString();
            }
            const days = { '1d': 1, '7d': 7, '30d': 30 }[mode] || 0;
            if (!days) return '';
            return new Date(Date.now() + days * 86400000).toISOString();
        }
    },
    watch: {
        instanceId() {
            this.selectedIds = [];
            this.load();
        }
    },
    mounted() {
        this.load();
        this.loadSharePermission();
        /*
         * v1.1.9.2：标签属性 / 合并 / 拆分三个弹窗纳入层叠监测
         * （标签管理模式下 Esc / 边缘横滑先关最上面那一层）。
         */
        this._unbindLayerDialogs = bindDialogLayers(this, {
            showProps: 'tag-props',
            showMerge: 'tag-merge',
            showSplit: 'tag-split'
        });
    },
    beforeUnmount() {
        if (this._unbindLayerDialogs) {
            this._unbindLayerDialogs();
            this._unbindLayerDialogs = null;
        }
    },
    methods: {
        /** GET /api/tags/manage?instanceId=&sort=&order= */
        async load() {
            this.loading = true;
            try {
                const url = `/api/tags/manage?instanceId=${encodeURIComponent(this.instanceId || '')}`
                    + `&sort=${encodeURIComponent(this.sort)}&order=${encodeURIComponent(this.order)}`;
                const res = await fetchWithAuth(url, { method: 'GET' });
                const json = await res.json().catch(() => ({}));
                const list = Array.isArray(json?.data) ? json.data : [];
                this.tags = list;
                // 已删除的标签从选中集合里剔除
                const ids = new Set(list.map((t) => t.id));
                this.selectedIds = this.selectedIds.filter((id) => ids.has(id));
            } catch (e) {
                this.tags = [];
            } finally {
                this.loading = false;
            }
        },
        setSort(value) {
            this.sort = value;
            this.load();
        },
        toggleOrder() {
            this.order = this.order === 'asc' ? 'desc' : 'asc';
            this.load();
        },
        toggleSelect(id) {
            const i = this.selectedIds.indexOf(id);
            if (i === -1) this.selectedIds.push(id);
            else this.selectedIds.splice(i, 1);
        },
        handleMenuCommand(cmd, tag) {
            if (cmd === 'props') {
                this.openProps(tag);
            } else if (cmd === 'merge') {
                this.selectedIds = [tag.id];
                this.openMergeFromSelection(tag);
            } else if (cmd === 'split') {
                this.openSplit(tag);
            } else if (cmd === 'delete') {
                this.deleteTag(tag);
            }
        },
        openProps(tag) {
            this.activeTag = tag;
            this.renameValue = tag.name;
            this.noteValue = String(tag.note || '');
            this.resetShareState();
            this.showProps = true;
            if (this.shareAllowed) this.loadTagShare(tag);
        },
        resetShareState() {
            this.shareOn = false;
            this.shareRecord = null;
            this.sharePassword = '';
            this.sharePasswordDirty = false;
            this.shareExpireMode = 'never';
            this.shareExpireAt = '';
            this.shareLoading = false;
            this.shareSaving = false;
        },
        /**
         * 对外分享权限：/api/auth/sessionCheck 若下发 shareEnabled 则据此判断，
         * 否则（当前后端未下发）按「仅管理员显示对外分享」处理。
         */
        async loadSharePermission() {
            try {
                const res = await fetchWithAuth('/api/auth/sessionCheck', { method: 'GET' });
                const json = await res.json().catch(() => ({}));
                const role = json?.role || this.$store?.state?.sessionRole;
                const isAdmin = role === 'admin' || role === 'super';
                const raw = json?.shareEnabled ?? json?.data?.shareEnabled ?? json?.profile?.shareEnabled;
                this.shareAllowed = typeof raw === 'boolean' ? raw : isAdmin;
            } catch (e) {
                const role = this.$store?.state?.sessionRole;
                this.shareAllowed = role === 'admin' || role === 'super';
            }
        },
        /** GET /api/shares?type=tag → 找到该标签已有的分享记录 */
        async loadTagShare(tag) {
            this.shareLoading = true;
            try {
                const params = new URLSearchParams();
                params.set('type', 'tag');
                params.set('instanceId', this.instanceId || '');
                params.set('keyword', tag.name);
                params.set('pageSize', '200');
                const res = await fetchWithAuth(`/api/shares?${params.toString()}`, { method: 'GET' });
                const json = await res.json().catch(() => ({}));
                const list = Array.isArray(json?.data) ? json.data : [];
                const row = list.find((r) => r && r.type === 'tag' && r.target === tag.name) || null;
                this.shareRecord = row;
                this.shareOn = !!row?.enabled;
                this.sharePassword = '';
                this.sharePasswordDirty = false;
                this.shareExpireMode = row?.expireAt ? 'custom' : 'never';
                this.shareExpireAt = row?.expireAt || '';
            } catch (e) {
                this.shareRecord = null;
            } finally {
                this.shareLoading = false;
            }
        },
        /** POST /api/shares（upsert：同 owner+实例+类型+target 只保留一条） */
        async postShare(body) {
            const res = await fetchWithAuth('/api/shares', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json?.success === false) throw new Error(json?.error || json?.message || 'failed');
            return json.data;
        },
        /** PATCH /api/shares/:id */
        async patchShare(id, body) {
            const res = await fetchWithAuth(`/api/shares/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json?.success === false) throw new Error(json?.error || json?.message || 'failed');
            return json.data;
        },
        /** 开关：开启 → POST（新建/复用）；关闭 → PATCH enabled:false（保留记录） */
        async onShareToggle(val) {
            const tag = this.activeTag;
            if (!tag) return;
            this.shareSaving = true;
            try {
                let row;
                if (val) {
                    row = await this.postShare({
                        type: 'tag',
                        target: tag.name,
                        tagId: tag.id,
                        instanceId: this.instanceId || '',
                        enabled: true
                    });
                } else if (this.shareRecord?.id) {
                    row = await this.patchShare(this.shareRecord.id, { enabled: false });
                } else {
                    row = await this.postShare({
                        type: 'tag',
                        target: tag.name,
                        tagId: tag.id,
                        instanceId: this.instanceId || '',
                        enabled: false
                    });
                }
                if (row) this.shareRecord = row;
                this.shareOn = !!row?.enabled;
                this.$message.success(this.$t('common.success'));
            } catch (e) {
                // 失败回滚开关
                this.shareOn = !val;
                this.$message.error(e?.message || this.$t('fileManager.tagShareFailed'));
            } finally {
                this.shareSaving = false;
            }
        },
        /** 保存密码 / 时限（走 POST upsert，密码仅在有改动时提交） */
        async saveShareOptions() {
            const tag = this.activeTag;
            if (!tag) return;
            this.shareSaving = true;
            try {
                const body = {
                    type: 'tag',
                    target: tag.name,
                    tagId: tag.id,
                    instanceId: this.instanceId || '',
                    enabled: true,
                    expireAt: this.shareExpireIso
                };
                if (this.sharePasswordDirty) body.password = String(this.sharePassword || '');
                const row = await this.postShare(body);
                if (row) this.shareRecord = row;
                this.sharePasswordDirty = false;
                this.sharePassword = '';
                this.shareExpireMode = row?.expireAt ? 'custom' : 'never';
                this.shareExpireAt = row?.expireAt || '';
                this.$message.success(this.$t('fileManager.tagShareSaved'));
            } catch (e) {
                this.$message.error(e?.message || this.$t('fileManager.tagShareFailed'));
            } finally {
                this.shareSaving = false;
            }
        },
        /** 清除访问密码（password 传空串） */
        async clearSharePassword() {
            const tag = this.activeTag;
            if (!tag) return;
            this.shareSaving = true;
            try {
                const row = this.shareRecord?.id
                    ? await this.patchShare(this.shareRecord.id, { password: '' })
                    : await this.postShare({
                        type: 'tag',
                        target: tag.name,
                        tagId: tag.id,
                        instanceId: this.instanceId || '',
                        enabled: true,
                        password: ''
                    });
                if (row) this.shareRecord = row;
                this.sharePassword = '';
                this.sharePasswordDirty = false;
                this.$message.success(this.$t('common.success'));
            } catch (e) {
                this.$message.error(e?.message || this.$t('fileManager.tagShareFailed'));
            } finally {
                this.shareSaving = false;
            }
        },
        /** PATCH /api/tags/:id { name } */
        /**
         * v3.0.0：属性页统一保存 —— 一次提交改名 / 对外分享选项 / 备注。
         * 顺序很重要：先改名（activeTag.name 变了），再按新名提交分享，最后写备注。
         * 各项内部自带「无变更则跳过」判断，不会产生多余请求。
         */
        async saveAll() {
            if (this.saving || this.shareSaving || this.noteSaving) return;
            const tag = this.activeTag;
            if (!tag) return;
            const oldName = String(tag.name || '');
            const oldNote = String(tag.note || '');
            await this.saveRename();
            // 分享：开启状态下统一提交一次（密码仅在改动时提交，时限按当前选择）
            if (this.shareOn) await this.saveShareOptions();
            // 备注：有变化才提交（空串也提交，允许清空）
            if (String(this.noteValue || '') !== oldNote) await this.saveNote();
            if (String(this.renameValue || '').trim() === oldName && String(this.noteValue || '') === oldNote && !this.shareOn) {
                this.$message.success(this.$t('common.success'));
            }
        },
        async saveRename() {
            const tag = this.activeTag;
            const name = String(this.renameValue || '').trim();
            if (!tag || !name || name === tag.name) return;
            this.saving = true;
            try {
                const res = await fetchWithAuth(`/api/tags/${encodeURIComponent(tag.id)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                const json = await res.json().catch(() => ({}));
                if (json?.success === false) throw new Error(json?.message || 'failed');
                this.$message.success(this.$t('common.success'));
                this.activeTag = { ...tag, name };
                this.$emit('changed');
                await this.load();
            } catch (e) {
                this.$message.error(e?.message || this.$t('common.failed'));
            } finally {
                this.saving = false;
            }
        },
        /**
         * PATCH /api/tags/:id { note } —— v3.0.0 新增。
         * 注意：当前后端 tagUpdate 只接收 name / password，note 需后端补充支持才会落库。
         */
        async saveNote() {
            const tag = this.activeTag;
            if (!tag) return;
            this.noteSaving = true;
            try {
                const res = await fetchWithAuth(`/api/tags/${encodeURIComponent(tag.id)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note: String(this.noteValue || '') })
                });
                const json = await res.json().catch(() => ({}));
                if (json?.success === false) throw new Error(json?.message || 'failed');
                this.activeTag = { ...tag, note: String(this.noteValue || '') };
                this.$message.success(this.$t('fileManager.tagNoteSaved'));
                this.$emit('changed');
            } catch (e) {
                this.$message.error(e?.message || this.$t('common.failed'));
            } finally {
                this.noteSaving = false;
            }
        },
        /** DELETE /api/tags/:id —— 只删标签与关联，不删文件 */
        deleteTag(tag) {
            if (!tag) return;
            trackMessageBox('tag-delete', this.$confirm(
                this.$t('fileManager.tagDeleteConfirm', { name: tag.name }),
                this.$t('fileManager.tagDelete'),
                { confirmButtonText: this.$t('common.delete'), cancelButtonText: this.$t('common.cancel'), type: 'warning' }
            )).then(async () => {
                try {
                    const res = await fetchWithAuth(`/api/tags/${encodeURIComponent(tag.id)}`, { method: 'DELETE' });
                    const json = await res.json().catch(() => ({}));
                    if (json?.success === false) throw new Error(json?.message || 'failed');
                    this.$message.success(this.$t('common.success'));
                    this.showProps = false;
                    this.$emit('changed');
                    await this.load();
                } catch (e) {
                    this.$message.error(e?.message || this.$t('common.failed'));
                }
            }).catch(() => {});
        },
        batchDelete() {
            const ids = [...this.selectedIds];
            if (!ids.length) return;
            trackMessageBox('tag-batch-delete', this.$confirm(
                this.$t('fileManager.tagBatchDeleteConfirm', { count: ids.length }),
                this.$t('fileManager.tagBatchDelete'),
                { confirmButtonText: this.$t('common.delete'), cancelButtonText: this.$t('common.cancel'), type: 'warning' }
            )).then(async () => {
                try {
                    for (const id of ids) {
                        await fetchWithAuth(`/api/tags/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    }
                    this.$message.success(this.$t('common.success'));
                    this.selectedIds = [];
                    this.$emit('changed');
                    await this.load();
                } catch (e) {
                    this.$message.error(e?.message || this.$t('common.failed'));
                }
            }).catch(() => {});
        },
        openMergeFromSelection(tag) {
            this.mergeSourceIds = tag ? [tag.id] : [...this.selectedIds];
            if (this.mergeSourceIds.length < 1) return;
            this.mergeMode = 'existing';
            this.mergeTargetId = '';
            this.mergeTargetName = '';
            this.showMerge = true;
        },
        /** POST /api/tags/merge { sourceIds, targetId | targetName } */
        async doMerge() {
            if (!this.canMerge) return;
            this.saving = true;
            try {
                const body = { sourceIds: [...this.mergeSourceIds] };
                if (this.mergeMode === 'existing') body.targetId = this.mergeTargetId;
                else body.targetName = this.mergeTargetName.trim();
                const res = await fetchWithAuth('/api/tags/merge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const json = await res.json().catch(() => ({}));
                if (json?.success === false) throw new Error(json?.message || 'failed');
                this.$message.success(this.$t('common.success'));
                this.showMerge = false;
                this.selectedIds = [];
                this.$emit('changed');
                await this.load();
            } catch (e) {
                this.$message.error(e?.message || this.$t('common.failed'));
            } finally {
                this.saving = false;
            }
        },
        /** v3.0.0：打开拆分弹窗 */
        openSplit(tag) {
            if (!tag) return;
            this.splitSource = tag;
            this.splitSourceName = tag.name;
            this.splitSourceCount = tag.count || 0;
            this.splitText = '';
            this.showSplit = true;
        },
        /** POST /api/tags/:id/split { names } */
        async doSplit() {
            const tag = this.splitSource;
            const names = this.splitNames;
            if (!tag || !names.length) return;
            this.splitting = true;
            try {
                const res = await fetchWithAuth(`/api/tags/${encodeURIComponent(tag.id)}/split`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ names })
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || json?.success === false) throw new Error(json?.error || json?.message || 'failed');
                const created = Array.isArray(json?.created) ? json.created : [];
                this.$message.success(this.$t('fileManager.tagSplitDone', { count: created.length || names.length }));
                this.showSplit = false;
                this.$emit('changed');
                await this.load();
            } catch (e) {
                this.$message.error(e?.message || this.$t('fileManager.tagSplitFailed'));
            } finally {
                this.splitting = false;
            }
        }
    }
};
</script>

<style scoped>
.tag-mode-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 10px 24px;
    min-height: 50vh;
}
.tag-mode-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 12px;
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    background: var(--glass-bg);
}
.tag-mode-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--admin-container-color);
}
.tag-mode-title-icon {
    color: var(--primary-color-accent, var(--el-color-primary));
}
/* v3.0.0：搜索框 —— 与文件管理页搜索框同款（圆角胶囊 + 玻璃底） */
.tag-mode-search {
    width: 220px;
    max-width: 100%;
}
.tag-mode-search :deep(.el-input__wrapper) {
    border-radius: 20px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
}
.tag-mode-search :deep(.el-input__wrapper.is-focus) {
    border-color: var(--glass-border-hover);
}
.tag-mode-search-icon {
    font-size: 12px;
    color: var(--el-text-color-placeholder);
}
.tag-mode-toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    flex-wrap: wrap;
}
/* v3.0.0：「退出」按钮加高亮背景（桌面 + 移动端一致，视觉上更醒目） */
.tag-mode-exit.el-button {
    background: color-mix(in srgb, var(--el-color-danger, #f56c6c) 12%, transparent);
    border-color: color-mix(in srgb, var(--el-color-danger, #f56c6c) 45%, transparent);
    color: var(--el-color-danger, #f56c6c);
    font-weight: 500;
}
.tag-mode-exit.el-button:hover,
.tag-mode-exit.el-button:focus {
    background: color-mix(in srgb, var(--el-color-danger, #f56c6c) 20%, transparent);
    border-color: var(--el-color-danger, #f56c6c);
    color: var(--el-color-danger, #f56c6c);
}
.tag-sort-order {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: color 0.16s ease, border-color 0.2s ease;
}
.tag-sort-order:hover {
    border-color: var(--glass-border-hover);
    color: var(--primary-color-accent, var(--el-color-primary));
}
.tag-mode-list {
    min-height: 120px;
}
/* v3.0.0：桌面端一行 3 个卡片，移动端单列 */
.tag-mode-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
}
.tag-mode-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 8px 12px;
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    background: var(--toolbar-button-bg-color);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.tag-mode-card.is-selected {
    border-color: var(--el-color-primary);
    box-shadow: 0 0 0 1px var(--el-color-primary);
}
.tag-mode-card-main {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
.tag-mode-check {
    flex: 0 0 auto;
}
.tag-mode-name {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 4px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    color: var(--upload-text-color);
}
/* v3.0.0（第三轮）：名称过长时只截断名称本身，数量「(12)」始终完整可见 */
.tag-mode-name-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tag-mode-count {
    flex: 0 0 auto;
    font-size: 12px;
    font-weight: 400;
    color: var(--el-text-color-secondary);
}
.tag-mode-menu-btn {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-secondary);
    cursor: pointer;
    transition: color 0.16s ease, background-color 0.2s ease;
}
.tag-mode-menu-btn:hover {
    color: var(--primary-color-accent, var(--el-color-primary));
    background: var(--el-fill-color-light);
}
.tag-mode-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 60px 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}
.tag-mode-empty-icon {
    font-size: 34px;
    opacity: 0.35;
}
/* v3.0.0：批量栏改为悬浮条（与文件管理模式的批量操作栏一致） */
.tag-batch-bar {
    position: fixed;
    left: 50%;
    bottom: max(42px, calc(36px + env(safe-area-inset-bottom)));
    transform: translateX(-50%);
    z-index: 1200;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(720px, calc(100vw - 32px));
    padding: 8px 12px;
    border: 1px solid var(--admin-batch-toolbar-border, var(--glass-border));
    border-radius: 18px;
    background: var(--admin-batch-toolbar-bg, var(--glass-bg));
    box-shadow: var(--admin-batch-toolbar-shadow, var(--glass-shadow));
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
}
.tag-batch-clear {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 10px;
    background: var(--admin-batch-action-bg, transparent);
    color: var(--admin-batch-clear-color, var(--el-text-color-secondary));
    cursor: pointer;
    transition: border-color 0.2s ease, color 0.2s ease;
}
.tag-batch-clear:hover {
    border-color: var(--glass-border-hover);
    color: var(--primary-color-accent, var(--el-color-primary));
}
.tag-batch-count {
    font-size: 12px;
    font-weight: 600;
    color: var(--primary-color-accent, var(--el-color-primary));
    white-space: nowrap;
}
.tag-batch-divider {
    width: 1px;
    height: 22px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--admin-batch-toolbar-border, var(--glass-border));
    opacity: 0.78;
}
.tag-batch-enter-active,
.tag-batch-leave-active {
    transition: opacity 0.22s ease, transform 0.26s cubic-bezier(0.22, 1, 0.36, 1);
}
.tag-batch-enter-from,
.tag-batch-leave-to {
    opacity: 0;
    transform: translateX(-50%) translateY(12px);
}
.tag-batch-enter-to,
.tag-batch-leave-from {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}
.tag-props-body,
.tag-merge-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.tag-props-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.tag-props-sub {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-left: 10px;
    border-left: 2px solid var(--el-border-color-lighter);
}
.tag-props-label {
    font-size: 12px;
    font-weight: 600;
    opacity: 0.75;
}
.tag-props-label-row {
    display: flex;
    align-items: center;
    gap: 6px;
}
.tag-props-help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--el-text-color-placeholder);
    font-size: 12px;
    cursor: pointer;
}
.tag-props-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.tag-props-row-end {
    justify-content: flex-end;
}
.tag-props-select {
    flex: 1 1 140px;
    min-width: 0;
}
.tag-props-date {
    flex: 1 1 180px;
    min-width: 0;
}
.tag-props-switch-text {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.tag-props-hint {
    font-size: 11px;
    opacity: 0.6;
    line-height: 1.5;
}
.tag-props-hint-inline {
    flex: 1 1 auto;
    min-width: 120px;
}
.tag-merge-mode {
    display: flex;
    gap: 16px;
}
.tag-merge-select {
    width: 100%;
}
.tag-menu-ico {
    width: 1em;
    margin-right: 8px;
}
.tag-menu-danger {
    color: var(--el-color-danger);
}
@media (max-width: 768px) {
    .tag-mode-panel {
        padding: 4px 2px 20px;
    }
    .tag-mode-search {
        width: 100%;
    }
    .tag-mode-toolbar-right {
        width: 100%;
        margin-left: 0;
    }
    /* v3.0.0：移动端「退出」保留文字（刷新仍为纯图标，避免占满一行） */
    .tag-mode-refresh .tag-mode-btn-text {
        display: none;
    }
    /* 移动端保持单列 */
    .tag-mode-grid {
        grid-template-columns: minmax(0, 1fr);
        gap: 8px;
    }
    .tag-batch-bar {
        bottom: max(38px, calc(32px + env(safe-area-inset-bottom)));
        width: max-content;
        max-width: calc(100vw - 24px);
        gap: 6px;
        padding: 6px 10px;
        border-radius: 16px;
    }
}
</style>

<style>
/* v3.0.0：标签分享「截止时间」面板在移动端居中显示。
   面板被 teleport 到 body，scoped 样式无法命中，因此放在全局样式块里。 */
.tag-share-date-popper--center.el-popper {
    position: fixed !important;
    left: 50% !important;
    top: 50% !important;
    right: auto !important;
    bottom: auto !important;
    transform: translate(-50%, -50%) !important;
    margin: 0 !important;
    max-width: 94vw;
}
.tag-share-date-popper--center .el-picker-panel {
    max-width: 94vw;
}
@media (max-width: 768px) {
    .tag-share-date-popper--center .el-date-picker.has-sidebar {
        width: min(92vw, 340px) !important;
    }
}
</style>
