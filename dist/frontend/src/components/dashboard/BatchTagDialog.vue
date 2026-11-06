<template>
    <el-dialog
        :title="$t('batchTag.title')"
        v-model="visible"
        :width="dialogWidth"
        :before-close="beforeClose"
        @close="handleClose"
    >
        <div class="tag-dialog-content batch-tag-container">
            <div class="tag-file-summary"><font-awesome-icon icon="images" /><span>{{ $t('batchTag.selectedFiles', { count: fileCount }) }}</span></div>
            <el-alert v-if="pendingIndexIds.length" :title="$t('tagManagement.indexPending')" type="warning" show-icon :closable="false">
                <el-button size="small" :loading="loading" :disabled="aiBusy" @click="repairIndex"><font-awesome-icon icon="redo" /> {{ $t('aiTags.retry') }}</el-button>
            </el-alert>
            <el-tabs v-model="activeTab" class="tag-operation-tabs" :before-leave="beforeTabChange">
                <el-tab-pane name="add">
                    <template #label><span class="tag-tab-label"><font-awesome-icon icon="plus" /><span>{{ $t('batchTag.addTab') }}</span></span></template>
                    <section class="tag-section">
                        <div class="tag-section-header">
                            <span class="tag-section-icon"><font-awesome-icon icon="tags" /></span>
                            <h4>{{ $t('batchTag.pendingTags') }}</h4>
                            <div class="tag-section-actions">
                                <span class="tag-count">{{ tagsToAdd.length }}</span>
                                <el-tooltip :content="$t('batchTag.addDescription', { count: fileCount })" placement="top">
                                    <button type="button" class="tag-help-button" :aria-label="$t('batchTag.addDescription', { count: fileCount })"><font-awesome-icon icon="question-circle" /></button>
                                </el-tooltip>
                            </div>
                        </div>
                        <div class="tag-select-section">
                            <div class="tag-select-label">{{ $t('batchTag.existingTags') }}</div>
                            <!-- v3.0.0：待添加标签多选区 —— 打开时由 /api/tags/manage 填充已存在标签，可多选、可搜索、可新建 -->
                            <el-select
                                v-model="tagsToAdd"
                                multiple
                                filterable
                                allow-create
                                default-first-option
                                clearable
                                class="batch-tag-select"
                                :loading="tagOptionsLoading"
                                :disabled="loading || aiBusy"
                                :placeholder="$t('batchTag.selectPlaceholder')"
                            >
                                <el-option v-for="opt in tagOptions" :key="opt.name" :label="opt.name" :value="opt.name">
                                    <span class="batch-tag-option">
                                        <span class="batch-tag-option-name">{{ opt.name }}</span>
                                        <span class="batch-tag-option-count">{{ opt.count }}</span>
                                    </span>
                                </el-option>
                            </el-select>
                            <div class="tag-select-hint">{{ $t('batchTag.selectHint') }}</div>
                        </div>
                        <div class="input-section">
                            <div class="tag-input-row">
                                <el-input v-model="inputTag" :disabled="loading || aiBusy" :placeholder="$t('batchTag.inputPlaceholder')" @keyup.enter="handleAddInputTag" @input="handleInputChange" clearable>
                                    <template #prefix><font-awesome-icon icon="hashtag" /></template>
                                </el-input>
                                <el-button class="tag-add-button" type="primary" :disabled="loading || aiBusy || !inputTag.trim()" :aria-label="$t('batchTag.addTab')" @click="handleAddInputTag"><font-awesome-icon icon="plus" /></el-button>
                            </div>
                            <div v-if="showSuggestions && suggestions.length" class="suggestions-panel">
                                <button v-for="tag in suggestions" :key="tag" type="button" class="suggestion-item" :disabled="loading || aiBusy" @click="selectSuggestion(tag)"><font-awesome-icon icon="hashtag" /><span>{{ tag }}</span></button>
                            </div>
                        </div>
                        <div v-if="!tagsToAdd.length" class="empty-message"><font-awesome-icon icon="tag" /><span>{{ $t('batchTag.noPendingTags') }}</span></div>
                        <div class="action-buttons"><el-button type="primary" @click="executeAddTags" :loading="loading" :disabled="!tagsToAdd.length || !fileCount"><font-awesome-icon v-if="!loading" icon="plus" />{{ $t('batchTag.addToAllFiles') }}</el-button></div>
                    </section>
                </el-tab-pane>
                <el-tab-pane name="remove">
                    <template #label><span class="tag-tab-label"><font-awesome-icon icon="minus" /><span>{{ $t('batchTag.removeTab') }}</span></span></template>
                    <section class="tag-section">
                        <div class="tag-section-header">
                            <span class="tag-section-icon muted"><font-awesome-icon icon="tags" /></span>
                            <h4>{{ $t('batchTag.commonTags') }}</h4>
                            <div class="tag-section-actions">
                                <span class="tag-count">{{ commonTags.length }}</span>
                                <el-tooltip :content="$t('batchTag.removeDescription')" placement="top">
                                    <button type="button" class="tag-help-button" :aria-label="$t('batchTag.removeDescription')"><font-awesome-icon icon="question-circle" /></button>
                                </el-tooltip>
                            </div>
                        </div>
                        <div v-if="commonTags.length" class="tags-container">
                            <el-tag v-for="tag in commonTags" :key="tag" :closable="!loading && !aiBusy" @close="handleRemoveCommonTag(tag)" class="tag-chip" type="warning" round>{{ tag }}</el-tag>
                        </div>
                        <div v-else class="empty-message"><font-awesome-icon icon="tag" /><span>{{ $t('batchTag.noCommonTags') }}</span></div>
                    </section>
                </el-tab-pane>
                <el-tab-pane name="clear">
                    <template #label><span class="tag-tab-label"><font-awesome-icon icon="trash-alt" /><span>{{ $t('batchTag.clearTab') }}</span></span></template>
                    <section class="tag-section tag-danger-section">
                        <div class="tag-section-header">
                            <span class="tag-section-icon danger"><font-awesome-icon icon="trash-alt" /></span>
                            <h4>{{ $t('batchTag.clearTab') }}</h4>
                        </div>
                        <el-alert :title="$t('batchTag.clearWarningDesc')" type="warning" :closable="false" show-icon />
                        <div class="action-buttons"><el-button type="danger" @click="handleClearAllTags" :loading="loading" :disabled="!fileCount"><font-awesome-icon v-if="!loading" icon="trash-alt" />{{ $t('batchTag.confirmClearAll') }}</el-button></div>
                    </section>
                </el-tab-pane>
                <el-tab-pane name="ai" lazy>
                    <template #label><span class="tag-tab-label"><AIIcon /><span>{{ $t('aiTags.tab') }}</span></span></template>
                    <AITagPanel v-if="visible" :files="selectedFilesOnly" :disabled="loading" @busy="aiBusy = $event" @applied="handleAIResults" />
                </el-tab-pane>
            </el-tabs>
        </div>
    </el-dialog>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus';
import fetchWithAuth from '@/utils/fetchWithAuth';
import AITagPanel from './AITagPanel.vue';
import AIIcon from '@/components/icons/AIIcon.vue';

export default {
    name: 'BatchTagDialog',
    components: { AITagPanel, AIIcon },
    props: {
        modelValue: {
            type: Boolean,
            default: false
        },
        selectedFiles: {
            type: Array,
            required: true,
            default: () => []
        }
    },
    emits: ['update:modelValue', 'tagsUpdated'],
    data() {
        return {
            activeTab: 'add',
            inputTag: '',
            tagsToAdd: [],
            commonTags: [],
            suggestions: [],
            showSuggestions: false,
            loading: false,
            pendingIndexIds: [],
            aiBusy: false,
            debounceTimer: null,
            // v3.0.0：已存在标签（/api/tags/manage），用于「待添加标签」多选
            tagOptions: [],
            tagOptionsLoading: false
        };
    },
    computed: {
        /**
         * v1.0.0：当前浏览实例（localStorage gohub_instance_id，'' = 默认实例）。
         * 「待添加标签」与输入联想都只在当前实例 + 当前账户范围内加载。
         */
        instanceId() {
            try { return localStorage.getItem('gohub_instance_id') || ''; } catch (e) { return ''; }
        },
        visible: {
            get() {
                return this.modelValue;
            },
            set(val) {
                this.$emit('update:modelValue', val);
            }
        },
        dialogWidth() {
            return 'min(600px, 90vw)';
        },
        selectedFilesOnly() {
            // 排除文件夹，只保留文件
            return this.selectedFiles.filter(file => !file.isFolder);
        },
        fileCount() {
            return this.selectedFilesOnly.length;
        },
        fileIds() {
            return this.selectedFilesOnly.map(file => file.name);
        }
    },
    watch: {
        visible(newVal) {
            if (newVal) {
                this.loadCommonTags();
                this.loadTagOptions();
            } else {
                this.resetData();
            }
        },
        activeTab(newTab) {
            if (newTab === 'remove') {
                this.loadCommonTags();
            }
        }
    },
    beforeUnmount() { clearTimeout(this.debounceTimer); },
    methods: {
        beforeClose(done) { if (!this.aiBusy && !this.loading) done(); },
        beforeTabChange() { return !this.aiBusy && !this.loading; },
        handleAIResults(results) { this.updateSavedTags(results); },
        updateSavedTags(results) {
            const pending = new Set(this.pendingIndexIds);
            for (const result of results) {
                if (result.saved) {
                    if (result.indexPending) pending.add(result.fileId); else pending.delete(result.fileId);
                }
            }
            this.pendingIndexIds = [...pending];
            this.$emit('tagsUpdated', results);
            this.loadCommonTags(results);
        },
        finishTagOperation(data, successKey) {
            /*
             * v3.0.0（R17）：后端返回结构做兜底。
             * 曾出现「提示失败、实际已经加上标签」：接口返回 { success, count } 没有 results，
             * updateSavedTags(undefined) 里 for...of 抛 TypeError → 被上层 catch 当成失败。
             * 现在后端已按约定返回 results；这里再补一层防御，任何缺字段都不再抛异常。
             */
            const results = Array.isArray(data?.results) ? data.results : [];
            const updatedRaw = Number(data?.updated);
            const updated = Number.isFinite(updatedRaw)
                ? updatedRaw
                : results.filter(result => result && result.saved).length;
            this.updateSavedTags(results);
            // v3.0.0：标签使用数变化后刷新「已存在标签」列表
            this.loadTagOptions();
            if (data && data.success) {
                ElMessage.success(this.$t(successKey, { count: updated }));
            } else {
                ElMessage.warning(this.$t('batchTag.partialSave', {
                    saved: results.filter(result => result.saved && !result.indexPending).length,
                    total: results.length
                }));
            }
            return !!(data && data.success);
        },
        async repairIndex() {
            if (this.loading || this.aiBusy) return;
            this.loading = true;
            try {
                const response = await fetchWithAuth('/api/manage/tags/batch', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fileIds: this.pendingIndexIds, tags: [], action: 'add', repairIndexIds: this.pendingIndexIds })
                });
                if (!response.ok) throw new Error();
                this.finishTagOperation(await response.json(), 'batchTag.addSuccess');
            } catch { ElMessage.error(this.$t('batchTag.addFailed')); }
            finally { this.loading = false; }
        },
        resetData() {
            this.tagsToAdd = [];
            this.inputTag = '';
            this.showSuggestions = false;
            this.activeTab = 'add';
            this.pendingIndexIds = [];
        },

        loadCommonTags(results = []) {
            const updates = new Map(results.filter(result => result.saved).map(result => [result.fileId, result.tags]));
            const allTags = this.selectedFilesOnly.map(file => updates.get(file.name) || file.metadata?.Tags || []);
            this.commonTags = allTags.length ? allTags[0].filter(tag => allTags.every(tags => tags.includes(tag))) : [];
        },

        /**
         * v3.0.0：加载「已存在标签」—— 修复「待添加标签」加载不到的问题。
         * 数据源 GET /api/tags/manage?instanceId=（当前实例的全部标签 + 使用数）。
         * v1.0.0：instanceId 原来写死成空串（永远只取默认实例），改为跟随当前实例。
         */
        async loadTagOptions() {
            this.tagOptionsLoading = true;
            try {
                const res = await fetchWithAuth(`/api/tags/manage?instanceId=${encodeURIComponent(this.instanceId)}`);
                const json = await res.json().catch(() => ({}));
                const list = Array.isArray(json?.data) ? json.data : [];
                this.tagOptions = list
                    .filter((t) => t && t.name)
                    .map((t) => ({ name: String(t.name), count: Number(t.count) || 0, encrypted: !!t.encrypted }));
            } catch (error) {
                console.error('Error loading tag options:', error);
                this.tagOptions = [];
            } finally {
                this.tagOptionsLoading = false;
            }
        },

        handleInputChange() {
            clearTimeout(this.debounceTimer);

            if (!this.inputTag || this.inputTag.trim().length === 0) {
                this.showSuggestions = false;
                return;
            }

            this.debounceTimer = setTimeout(() => {
                this.fetchSuggestions();
            }, 300);
        },

        async fetchSuggestions() {
            try {
                const prefix = this.inputTag.trim().toLowerCase();
                const response = await fetchWithAuth(
                    `/api/manage/tags/autocomplete?prefix=${encodeURIComponent(prefix)}&limit=10&instanceId=${encodeURIComponent(this.instanceId)}`,
                    { method: 'GET' }
                );

                if (response.ok) {
                    const data = await response.json();
                    this.suggestions = (data.tags || []).filter(tag => !this.tagsToAdd.includes(tag));
                    this.showSuggestions = this.suggestions.length > 0;
                }
            } catch (error) {
                console.error('Error fetching suggestions:', error);
            }
        },

        selectSuggestion(tag) {
            this.inputTag = tag;
            this.showSuggestions = false;
            this.handleAddInputTag();
        },

        handleAddInputTag() {
            if (this.loading || this.aiBusy) return;
            const tag = this.inputTag.trim();

            if (!tag) {
                return;
            }

            if (this.tagsToAdd.includes(tag)) {
                ElMessage.warning(this.$t('batchTag.tagAlreadyInList'));
                this.inputTag = '';
                this.showSuggestions = false;
                return;
            }

            this.tagsToAdd.push(tag);
            this.inputTag = '';
            this.showSuggestions = false;
        },

        removeFromToAdd(tag) {
            if (this.loading || this.aiBusy) return;
            const index = this.tagsToAdd.indexOf(tag);
            if (index > -1) {
                this.tagsToAdd.splice(index, 1);
            }
        },

        async executeAddTags() {
            if (this.loading || this.aiBusy) return;
            if (this.tagsToAdd.length === 0) {
                ElMessage.warning(this.$t('batchTag.pleaseAddTags'));
                return;
            }

            this.loading = true;

            try {
                const response = await fetchWithAuth('/api/manage/tags/batch', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        fileIds: this.fileIds,
                        repairIndexIds: this.pendingIndexIds,
                        action: 'add',
                        tags: this.tagsToAdd
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    if (this.finishTagOperation(data, 'batchTag.addSuccess')) this.tagsToAdd = [];
                } else {
                    throw new Error(this.$t('batchTag.addFailed'));
                }
            } catch (error) {
                console.error('Error adding tags:', error);
                ElMessage.error(this.$t('batchTag.addFailed'));
            } finally {
                this.loading = false;
            }
        },

        async handleRemoveCommonTag(tag) {
            if (this.loading || this.aiBusy) return;
            this.loading = true;

            try {
                const response = await fetchWithAuth('/api/manage/tags/batch', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        fileIds: this.fileIds,
                        repairIndexIds: this.pendingIndexIds,
                        action: 'remove',
                        tags: [tag]
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    this.finishTagOperation(data, 'batchTag.removeSuccess');
                } else {
                    throw new Error(this.$t('batchTag.removeFailed'));
                }
            } catch (error) {
                console.error('Error removing tag:', error);
                ElMessage.error(this.$t('batchTag.removeFailed'));
            } finally {
                this.loading = false;
            }
        },

        handleClearAllTags() {
            if (this.loading || this.aiBusy) return;
            ElMessageBox.confirm(
                this.$t('batchTag.clearConfirmMessage', { count: this.fileCount }),
                this.$t('batchTag.clearConfirmTitle'),
                {
                    confirmButtonText: this.$t('batchTag.clearConfirmOk'),
                    cancelButtonText: this.$t('batchTag.clearConfirmCancel'),
                    type: 'warning'
                }
            ).then(() => {
                this.executeClearTags();
            }).catch(() => {
                ElMessage.info(this.$t('batchTag.clearCancelled'));
            });
        },

        async executeClearTags() {
            if (this.loading || this.aiBusy) return;
            this.loading = true;

            try {
                const response = await fetchWithAuth('/api/manage/tags/batch', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        fileIds: this.fileIds,
                        repairIndexIds: this.pendingIndexIds,
                        action: 'set',
                        tags: []
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    this.finishTagOperation(data, 'batchTag.clearSuccess');
                } else {
                    throw new Error(this.$t('batchTag.clearFailed'));
                }
            } catch (error) {
                console.error('Error clearing tags:', error);
                ElMessage.error(this.$t('batchTag.clearFailed'));
            } finally {
                this.loading = false;
            }
        },

        handleClose() {
            if (this.aiBusy || this.loading) return;
            this.visible = false;
        }
    }
};
</script>

<style scoped src="@/styles/tag-dialog.css"></style>
<style scoped>
/* v3.0.0：「待添加标签」多选区 */
.tag-select-section {
    margin-bottom: 14px;
}
.tag-select-label {
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--el-text-color-primary);
}
.batch-tag-select {
    width: 100%;
}
.batch-tag-select :deep(.el-select__wrapper) {
    min-height: 36px;
    border-radius: 9px;
    background: var(--dialog-control-bg-color, var(--el-bg-color));
}
.tag-select-hint {
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
}
.batch-tag-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
.batch-tag-option-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}
.batch-tag-option-count {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    font-variant-numeric: tabular-nums;
}
</style>
