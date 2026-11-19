<template>
    <!--
        我的发布页 · 标签管理（v1.1.2；v1.3.5.1 复刻 /dashboard 结构）
        ----------------------------------------------------------------------------
        需求：在「我的发布页」顶栏点「标签管理」进入页面模式（与回收站同层），
          · 分类栏照旧可用，切到哪个分类就只加载该分类用到的标签；
          · 「广场」不是数据库里的 kind，按需求「不加载标签」；
          · 结构 / 布局 / 样式直接复刻图床管理页(/dashboard) TagModePanel：
            顶部工具栏（标题 + 搜索 + 排序 + 刷新 + 退出）、一行 3 张的卡片网格、
            多选后的悬浮批量栏、卡片「⋮」→ 属性弹窗。

        数据：GET /api/notes/tag-admin?instanceId=&kind=
              v1.3.5.1 起【必须带 kind】。后端 tagAdmin() 会按 kind 决定 Tag.type
              （moment → 'moment'，其余 → 'note'）并按 kindCounts 过滤；
              不带 kind 时后端回落 type='note'，瞬间标签（type='moment'）永远查不出来，
              这就是以往「点击标签管理没能加载出标签」的根因。
        写入：复用图床那三套标签接口（merge / split / PATCH / DELETE），
              后端按 Tag.type 自动分流到 note_tags，前端不需要额外区分。
    -->
    <div class="tag-mode-panel">
        <div class="tag-mode-toolbar">
            <div class="tag-mode-title">
                <font-awesome-icon icon="tags" class="tag-mode-title-icon" />
                <span>{{ $t('notes.tagAdminTitle') }}</span>
                <span class="tag-count">{{ list.length }}</span>
            </div>
            <!-- 搜索框：仅本地过滤标签名，输入即过滤 -->
            <el-input
                v-model="search"
                size="small"
                clearable
                class="tag-mode-search"
                :placeholder="$t('notes.tagSearch')"
            >
                <template #prefix>
                    <font-awesome-icon icon="search" class="tag-mode-search-icon" />
                </template>
            </el-input>
            <div class="tag-mode-toolbar-right">
                <el-radio-group :model-value="sort" size="small" class="tag-sort-group" @change="setSort">
                    <el-radio-button label="createdAt">{{ $t('fileManager.tagSortCreated') }}</el-radio-button>
                    <el-radio-button label="name">{{ $t('fileManager.tagSortName') }}</el-radio-button>
                    <el-radio-button label="count">{{ $t('fileManager.tagSortCount') }}</el-radio-button>
                </el-radio-group>
                <button type="button" class="tag-sort-order" :title="orderTitle" @click="toggleOrder">
                    <font-awesome-icon :icon="order === 'asc' ? 'arrow-up' : 'arrow-down'" />
                    <span>{{ orderTitle }}</span>
                </button>
                <el-button size="small" class="tag-mode-refresh" :loading="loading" @click="load">
                    <font-awesome-icon icon="sync" />
                    <span class="tag-mode-btn-text">{{ $t('dashboard.refreshFiles') }}</span>
                </el-button>
                <el-button size="small" class="tag-mode-exit" @click="$emit('close')">
                    <font-awesome-icon icon="times" />
                    <span class="tag-mode-btn-text">{{ $t('fileManager.tagModeExit') }}</span>
                </el-button>
            </div>
        </div>

        <div v-loading="loading" class="tag-mode-list">
            <!-- 广场：按需求不加载标签，也不发请求 -->
            <div v-if="!loading && disabledKind" class="tag-mode-empty">
                <font-awesome-icon icon="tags" class="tag-mode-empty-icon" />
                <p>{{ $t('notes.tagSquareNoTags') }}</p>
            </div>
            <div v-else-if="!loading && !list.length" class="tag-mode-empty">
                <font-awesome-icon icon="tags" class="tag-mode-empty-icon" />
                <p>{{ $t('notes.tagNoData') }}</p>
            </div>
            <div v-else-if="!loading && !filtered.length" class="tag-mode-empty">
                <font-awesome-icon icon="search" class="tag-mode-empty-icon" />
                <p>{{ $t('fileManager.tagSearchEmpty') }}</p>
            </div>
            <!-- 桌面端一行 3 个的卡片网格（移动端单列） -->
            <div v-else class="tag-mode-grid">
                <div
                    v-for="t in filtered"
                    :key="t.id"
                    class="tag-mode-card"
                    :class="{ 'is-selected': selectedIds.includes(t.id) }"
                >
                    <div class="tag-mode-card-main">
                        <el-checkbox
                            :model-value="selectedIds.includes(t.id)"
                            class="tag-mode-check"
                            @change="(v) => toggleSelect(t.id, v)"
                        />
                        <span class="tag-mode-name" :title="t.name" @click="openProps(t)">
                            <span class="tag-mode-name-text">#{{ t.name }}</span>
                            <span class="tag-mode-count">({{ displayCount(t) }})</span>
                        </span>
                        <el-dropdown
                            trigger="click"
                            class="tag-mode-menu"
                            @command="(cmd) => handleMenuCommand(cmd, t)"
                        >
                            <button type="button" class="tag-mode-menu-btn" :aria-label="$t('fileManager.tagProps')" @click.stop>
                                <font-awesome-icon icon="ellipsis-v" />
                            </button>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item command="props">
                                        <font-awesome-icon icon="edit" class="tag-menu-ico" />
                                        <span>{{ $t('fileManager.tagProps') }}</span>
                                    </el-dropdown-item>
                                    <el-dropdown-item command="split">
                                        <font-awesome-icon icon="cut" class="tag-menu-ico" />
                                        <span>{{ $t('notes.tagSplit') }}</span>
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

        <!-- 多选后的批量菜单：与 /dashboard 同款悬浮条 -->
        <transition name="tag-batch">
            <div v-if="selectedIds.length > 0" class="tag-batch-bar">
                <button type="button" class="tag-batch-clear" :aria-label="$t('dashboard.clearSelection')" @click="selectedIds = []">
                    <font-awesome-icon icon="times" />
                </button>
                <span class="tag-batch-count">{{ $t('fileManager.tagSelected', { count: selectedIds.length }) }}</span>
                <span class="tag-batch-divider"></span>
                <el-button size="small" type="primary" plain :disabled="selectedIds.length < 2" @click="openMerge">
                    {{ $t('notes.tagMerge') }}
                </el-button>
            </div>
        </transition>

        <!-- 属性页：改名 / 备注 / 拆分 / 删除，与 /dashboard 的 tag-props-dialog 同款 -->
        <el-dialog
            v-model="showProps"
            :title="$t('fileManager.tagProps')"
            :width="dialogWidth"
            append-to-body
            class="tag-props-dialog"
        >
            <div v-if="active" class="tag-props-body">
                <div class="tag-props-section">
                    <div class="tag-props-label">{{ $t('notes.tagRename') }}</div>
                    <el-input v-model="form.name" size="default" maxlength="60" />
                </div>
                <div class="tag-props-section">
                    <div class="tag-props-label">{{ $t('notes.tagRemark') }}</div>
                    <el-input
                        v-model="form.note"
                        type="textarea"
                        :rows="3"
                        maxlength="500"
                        show-word-limit
                        :placeholder="$t('notes.tagRemarkPlaceholder')"
                    />
                </div>
            </div>
            <template #footer>
                <el-button @click="showProps = false">{{ $t('common.close') }}</el-button>
                <el-button @click="openSplit">{{ $t('notes.tagSplit') }}</el-button>
                <el-button type="danger" plain @click="removeActive">{{ $t('notes.tagDelete') }}</el-button>
                <el-button type="primary" :loading="saving" @click="save">{{ $t('common.save') }}</el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';

export default {
    name: 'NoteTagPanel',
    props: {
        instanceId: { type: String, default: '' },
        /** 当前功能栏分类：moment / todo / nav / article / collection / memo / square */
        kind: { type: String, default: '' }
    },
    emits: ['changed', 'close'],
    data() {
        return {
            list: [],
            loading: false,
            search: '',
            /** v1.3.5.1：与 /dashboard 标签管理同款排序 */
            sort: 'createdAt',
            order: 'desc',
            activeId: '',
            selectedIds: [],
            showProps: false,
            form: { name: '', note: '' },
            saving: false
        };
    },
    computed: {
        /**
         * v1.3.5.1：分类过滤交给后端 —— moment / note 是两套 Tag.type，
         * 前端拿一份全量数据没法同时覆盖；这里只做本地搜索 + 排序。
         */
        filtered() {
            const q = this.search.trim().toLowerCase();
            const rows = this.list.filter((t) => {
                if (!q) return true;
                return String(t.name || '').toLowerCase().includes(q);
            });
            const dir = this.order === 'asc' ? 1 : -1;
            return rows.slice().sort((a, b) => {
                if (this.sort === 'name') {
                    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN') * dir;
                }
                const av = Number(this.sort === 'count' ? (a.count || 0) : (a.createdAt || 0));
                const bv = Number(this.sort === 'count' ? (b.count || 0) : (b.createdAt || 0));
                return (av - bv) * dir;
            });
        },
        active() {
            return this.list.find((t) => t.id === this.activeId) || null;
        },
        /** 广场不是数据库里的 kind，按需求「不加载标签」 */
        disabledKind() {
            return this.kind === 'square';
        },
        orderTitle() {
            return this.$t(this.order === 'asc' ? 'fileManager.tagSortAsc' : 'fileManager.tagSortDesc');
        },
        dialogWidth() {
            return window.innerWidth <= 480 ? '92%' : '460px';
        }
    },
    watch: {
        /** 切分类必须重新拉：moment 与 note 是两套 Tag.type，旧数据不能复用 */
        kind() {
            this.selectedIds = [];
            this.activeId = '';
            this.form = { name: '', note: '' };
            this.showProps = false;
            this.load();
        },
        instanceId() {
            this.selectedIds = [];
            this.activeId = '';
            this.form = { name: '', note: '' };
            this.showProps = false;
            this.load();
        }
    },
    mounted() {
        this.load();
    },
    methods: {
        setSort(v) {
            this.sort = v;
        },
        toggleOrder() {
            this.order = this.order === 'asc' ? 'desc' : 'asc';
        },
        displayCount(t) {
            // 后端已按当前 kind 把 count 换算成该类目下的使用次数
            return Number(t.count || 0);
        },
        async load() {
            /* 广场：不加载标签、不发请求，直接给空态 */
            if (this.disabledKind) {
                this.list = [];
                this.selectedIds = [];
                this.activeId = '';
                this.loading = false;
                return;
            }
            this.loading = true;
            try {
                const qs = new URLSearchParams();
                qs.set('instanceId', this.instanceId || '');
                // 关键：带上真实类目，后端据此选 Tag.type（瞬间 = moment）
                if (this.kind) qs.set('kind', this.kind);
                const res = await fetchWithAuth(`/api/notes/tag-admin?${qs.toString()}`);
                const data = await res.json().catch(() => []);
                this.list = Array.isArray(data) ? data : [];
                // 列表变短后，已选中 / 正在编辑的标签可能已经不在了 —— 清理一下
                this.selectedIds = this.selectedIds.filter((id) => this.list.some((t) => t.id === id));
                if (this.activeId && !this.list.some((t) => t.id === this.activeId)) {
                    this.activeId = '';
                    this.form = { name: '', note: '' };
                    this.showProps = false;
                }
            } catch (e) {
                this.$message.error(this.$t('notes.tagLoadFail'));
            } finally {
                this.loading = false;
            }
        },
        select(t) {
            this.activeId = t.id;
            this.form = { name: t.name, note: t.note || '' };
        },
        openProps(t) {
            this.select(t);
            this.showProps = true;
        },
        handleMenuCommand(cmd, t) {
            if (cmd === 'props') this.openProps(t);
            else if (cmd === 'split') { this.select(t); this.openSplit(); }
            else if (cmd === 'delete') { this.select(t); this.removeActive(); }
        },
        toggleSelect(id, on) {
            if (on) {
                if (!this.selectedIds.includes(id)) this.selectedIds = this.selectedIds.concat(id);
            } else {
                this.selectedIds = this.selectedIds.filter((x) => x !== id);
            }
        },
        async save() {
            if (!this.active) return;
            const name = String(this.form.name || '').trim();
            if (!name) {
                this.$message.warning(this.$t('notes.tagNameRequired'));
                return;
            }
            this.saving = true;
            try {
                const res = await fetchWithAuth(`/api/tags/${encodeURIComponent(this.active.id)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, note: String(this.form.note || '') })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('notes.tagSaveOk'));
                this.showProps = false;
                await this.load();
                this.$emit('changed');
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            } finally {
                this.saving = false;
            }
        },
        openMerge() {
            const ids = this.selectedIds.slice();
            if (ids.length < 2) {
                this.$message.warning(this.$t('notes.tagMinTwo'));
                return;
            }
            const picked = this.list.filter((t) => ids.includes(t.id));
            // 目标标签：默认取第一个；用户也可以直接输入一个新名字（等于「全部并到一个新标签」）
            this.$prompt(this.$t('notes.tagMergeTip'), this.$t('notes.tagMergeTitle'), {
                confirmButtonText: this.$t('notes.tagMerge'),
                cancelButtonText: this.$t('common.cancel'),
                inputValue: picked[0] ? picked[0].name : '',
                inputPlaceholder: this.$t('notes.tagMergeTarget'),
                inputValidator: (v) => (String(v || '').trim() ? true : this.$t('notes.tagNameRequired'))
            })
                .then(async ({ value }) => {
                    const targetName = String(value || '').trim();
                    const targetId = (picked.find((t) => t.name === targetName) || {}).id || '';
                    try {
                        const res = await fetchWithAuth('/api/tags/merge', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                sourceIds: ids,
                                ...(targetId ? { targetId } : { targetName })
                            })
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                        this.$message.success(this.$t('notes.tagMergeOk'));
                        this.selectedIds = [];
                        this.activeId = '';
                        this.form = { name: '', note: '' };
                        await this.load();
                        this.$emit('changed');
                    } catch (e) {
                        this.$message.error(e.message || this.$t('common.failed'));
                    }
                })
                .catch(() => {});
        },
        openSplit() {
            if (!this.active) return;
            const tag = this.active;
            this.$prompt(this.$t('notes.tagSplitTip', { name: tag.name }), this.$t('notes.tagSplitTitle'), {
                confirmButtonText: this.$t('notes.tagSplit'),
                cancelButtonText: this.$t('common.cancel'),
                inputPlaceholder: '北京, 出差',
                inputValidator: (v) => {
                    const names = String(v || '')
                        .split(/[,，\s]+/)
                        .map((s) => s.trim())
                        .filter(Boolean);
                    if (!names.length) return this.$t('notes.tagNameRequired');
                    return true;
                }
            })
                .then(async ({ value }) => {
                    const names = String(value || '')
                        .split(/[,，\s]+/)
                        .map((s) => s.trim())
                        .filter(Boolean);
                    try {
                        const res = await fetchWithAuth(`/api/tags/${encodeURIComponent(tag.id)}/split`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ names })
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                        this.$message.success(this.$t('notes.tagSplitOk'));
                        this.showProps = false;
                        await this.load();
                        this.$emit('changed');
                    } catch (e) {
                        this.$message.error(e.message || this.$t('common.failed'));
                    }
                })
                .catch(() => {});
        },
        async removeActive() {
            if (!this.active) return;
            const tag = this.active;
            try {
                await this.$confirm(this.$t('notes.tagDeleteConfirm', { name: tag.name }), this.$t('notes.tagDelete'), {
                    type: 'warning',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel')
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(`/api/tags/${encodeURIComponent(tag.id)}`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('notes.tagDeletedOk'));
                this.activeId = '';
                this.form = { name: '', note: '' };
                this.showProps = false;
                this.selectedIds = this.selectedIds.filter((x) => x !== tag.id);
                await this.load();
                this.$emit('changed');
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        }
    }
};
</script>

<style scoped>
/*
 * v1.3.5.1：结构 / 布局 / 样式直接复刻 /dashboard 的 TagModePanel.vue。
 * 同一套 CSS 变量（--glass-* / --admin-batch-*），因此明暗主题与图床页完全一致。
 */
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

.tag-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 22px;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--note-tags-bg, rgba(127, 127, 127, 0.14));
    font-size: 11px;
    color: var(--el-text-color-secondary);
}

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

.tag-menu-ico {
    margin-right: 7px;
    font-size: 12px;
    opacity: 0.75;
}

.tag-menu-danger {
    color: var(--el-color-danger, #f56c6c);
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

/* 批量栏：与图床标签管理 / 文件批量操作栏同一套悬浮条 */
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

/* 属性弹窗 */
.tag-props-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    text-align: left;
}

.tag-props-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.tag-props-label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

@media (max-width: 768px) {
    .tag-mode-grid {
        grid-template-columns: minmax(0, 1fr);
    }

    .tag-mode-search {
        width: 100%;
    }

    .tag-mode-btn-text {
        display: none;
    }
}
</style>
