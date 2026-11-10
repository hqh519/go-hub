<template>
    <!--
        笔记标签管理（v1.1.2）
        ----------------------------------------------------------------------------
        需求：在笔记管理页顶栏点「标签管理」进入一个「标签管理模式」，
          · 仍可用功能栏的分类（全部 / 瞬间 / 待办 / 导航 / 文章 / 收集）切换 —— 切到哪个分类就只列该分类下用到的标签；
          · 复刻图床「标签管理」的能力：合并、拆分、属性管理（改名、备注）。

        为什么做成"页面模式"而不是弹窗：
          需求写的是「进入标签管理页面…类似回收站模式下的可以切换管理」，
          而回收站就是本页的一个模式（同一套顶栏 / 分类栏，只换内容区）。
          做成模式后，分类切换天然可用，不用把分类栏复制一份到弹窗里。

        数据：GET /api/notes/tag-admin?instanceId=&kind=
              （返回每个标签的总次数与各分类次数，切分类时前端直接读 kindCounts，不用重新请求）
        写入：复用图床那三套标签接口（merge / split / PATCH / DELETE），
              后端按 Tag.type 自动分流到 note_tags，前端不需要额外区分。
    -->
    <section class="tg">
        <header class="tg-head">
            <div class="tg-head-left">
                <font-awesome-icon icon="tags" class="tg-head-icon" />
                <span class="tg-head-title">{{ $t('notes.tagAdminTitle') }}</span>
                <span class="tg-head-count">{{ list.length }}</span>
            </div>
            <div class="tg-head-right">
                <el-input
                    v-model="search"
                    class="tg-search"
                    size="small"
                    clearable
                    :placeholder="$t('notes.tagSearch')"
                />
                <el-button size="small" :disabled="selectedIds.length < 2" @click="openMerge">
                    {{ $t('notes.tagMerge') }}
                </el-button>
                <el-button size="small" :loading="loading" @click="load">
                    <font-awesome-icon icon="sync" />
                </el-button>
            </div>
        </header>

        <div v-if="loading && !list.length" class="tg-empty">{{ $t('notes.loading') }}</div>
        <div v-else-if="!list.length" class="tg-empty">
            <font-awesome-icon icon="tags" class="tg-empty-icon" />
            <p>{{ $t('notes.tagNoData') }}</p>
        </div>

        <div v-else class="tg-body">
            <!-- 左：标签列表（可多选用于合并） -->
            <ul class="tg-list">
                <li
                    v-for="t in filtered"
                    :key="t.id"
                    class="tg-item"
                    :class="{ 'is-active': activeId === t.id }"
                    @click="select(t)"
                >
                    <el-checkbox
                        class="tg-check"
                        :model-value="selectedIds.includes(t.id)"
                        @click.stop
                        @change="(v) => toggleSelect(t.id, v)"
                    />
                    <span class="tg-name">#{{ t.name }}</span>
                    <span class="tg-usage">{{ $t('notes.tagUsage', { n: displayCount(t) }) }}</span>
                    <span v-if="t.note" class="tg-note-dot" :title="t.note"></span>
                </li>
            </ul>

            <!-- 右：属性管理 -->
            <div class="tg-detail">
                <template v-if="active">
                    <div class="tg-detail-head">
                        <span class="tg-detail-title">#{{ active.name }}</span>
                        <span class="tg-detail-usage">{{ $t('notes.tagUsage', { n: displayCount(active) }) }}</span>
                    </div>
                    <label class="tg-field">
                        <span class="tg-label">{{ $t('notes.tagRename') }}</span>
                        <el-input v-model="form.name" size="small" maxlength="60" />
                    </label>
                    <label class="tg-field">
                        <span class="tg-label">{{ $t('notes.tagRemark') }}</span>
                        <el-input
                            v-model="form.note"
                            type="textarea"
                            :rows="3"
                            maxlength="500"
                            :placeholder="$t('notes.tagRemarkPlaceholder')"
                        />
                    </label>
                    <div class="tg-detail-actions">
                        <el-button size="small" type="primary" :loading="saving" @click="save">
                            {{ $t('common.save') }}
                        </el-button>
                        <el-button size="small" @click="openSplit">{{ $t('notes.tagSplit') }}</el-button>
                        <el-button size="small" type="danger" plain @click="removeActive">
                            {{ $t('notes.tagDelete') }}
                        </el-button>
                    </div>
                </template>
                <div v-else class="tg-detail-empty">{{ $t('notes.tagSelectHint') }}</div>
            </div>
        </div>
    </section>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';

export default {
    name: 'NoteTagPanel',
    props: {
        instanceId: { type: String, default: '' },
        /** 当前功能栏分类：'' = 全部，moment / todo / nav / article / collection */
        kind: { type: String, default: '' }
    },
    emits: ['changed'],
    data() {
        return {
            list: [],
            loading: false,
            search: '',
            activeId: '',
            selectedIds: [],
            form: { name: '', note: '' },
            saving: false
        };
    },
    computed: {
        filtered() {
            // 分类过滤在前端做：后端已经把每个标签在各分类下的次数（kindCounts）一起给了，
            // 切分类就不用再请求一次，也不会出现「切过去列表短暂空白」。
            const q = this.search.trim().toLowerCase();
            return this.list.filter((t) => {
                if (!this.matchesKind(t)) return false;
                if (!q) return true;
                return String(t.name || '').toLowerCase().includes(q);
            });
        },
        active() {
            return this.list.find((t) => t.id === this.activeId) || null;
        }
    },
    watch: {
        /** 切换分类时只影响「显示哪些标签」，不重新拉数据 —— kindCounts 已经在手里了 */
        kind() {
            this.selectedIds = [];
            const stillVisible = this.list.some((t) => t.id === this.activeId && this.matchesKind(t));
            if (!stillVisible) {
                this.activeId = '';
                this.form = { name: '', note: '' };
            }
        },
        instanceId() {
            this.selectedIds = [];
            this.activeId = '';
            this.form = { name: '', note: '' };
            this.load();
        }
    },
    mounted() {
        this.load();
    },
    methods: {
        matchesKind(t) {
            if (!this.kind) return true;
            return Number((t.kindCounts || {})[this.kind] || 0) > 0;
        },
        displayCount(t) {
            // 全部 → 总次数；具体分类 → 该分类下的次数
            return this.kind ? Number((t.kindCounts || {})[this.kind] || 0) : Number(t.count || 0);
        },
        async load() {
            this.loading = true;
            try {
                const qs = new URLSearchParams();
                qs.set('instanceId', this.instanceId || '');
                // 不带 kind：一次拿全，切分类由前端过滤（见 filtered）
                const res = await fetchWithAuth(`/api/notes/tag-admin?${qs.toString()}`);
                const data = await res.json().catch(() => []);
                this.list = Array.isArray(data) ? data : [];
                // 分类切换后列表会变短，已选中的标签可能已经不在了 —— 清理一下
                this.selectedIds = this.selectedIds.filter((id) => this.list.some((t) => t.id === id));
                if (this.activeId && !this.list.some((t) => t.id === this.activeId)) {
                    this.activeId = '';
                    this.form = { name: '', note: '' };
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
.tg {
    box-sizing: border-box;
    width: 100%;
}

.tg-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 10px;
}

.tg-head-left {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--el-text-color-regular);
}

.tg-head-icon {
    font-size: 13px;
    opacity: 0.7;
}

.tg-head-title {
    font-weight: 600;
}

.tg-head-count {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--note-tags-bg, rgba(127, 127, 127, 0.14));
    font-size: 11px;
    line-height: 18px;
    color: var(--el-text-color-secondary);
}

.tg-head-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
}

.tg-search {
    width: 180px;
}

.tg-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 60px 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

.tg-empty-icon {
    font-size: 26px;
    opacity: 0.45;
}

.tg-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 300px);
    gap: 12px;
    align-items: start;
}

.tg-list {
    margin: 0;
    padding: 6px;
    list-style: none;
    border: 1px solid var(--note-card-border, var(--glass-border, rgba(127, 127, 127, 0.16)));
    border-radius: 10px;
    max-height: 60vh;
    overflow-y: auto;
    overscroll-behavior: contain;
}

.tg-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    color: var(--el-text-color-regular);
}

.tg-item:hover {
    background: rgba(127, 127, 127, 0.08);
}

.tg-item.is-active {
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.12));
    color: var(--el-color-primary);
}

.tg-check {
    flex: 0 0 auto;
}

.tg-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tg-usage {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--el-text-color-secondary);
}

.tg-note-dot {
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--el-color-warning, #e6a23c);
}

.tg-detail {
    padding: 10px;
    border: 1px solid var(--note-card-border, var(--glass-border, rgba(127, 127, 127, 0.16)));
    border-radius: 10px;
}

.tg-detail-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 10px;
}

.tg-detail-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    word-break: break-all;
}

.tg-detail-usage {
    font-size: 11px;
    color: var(--el-text-color-secondary);
}

.tg-field {
    display: block;
    margin-bottom: 10px;
}

.tg-label {
    display: block;
    margin-bottom: 4px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.tg-detail-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
}

.tg-detail-empty {
    padding: 40px 6px;
    text-align: center;
    font-size: 12.5px;
    color: var(--el-text-color-secondary);
}

@media (max-width: 768px) {
    .tg-body {
        grid-template-columns: minmax(0, 1fr);
    }

    .tg-list {
        max-height: 40vh;
    }

    .tg-search {
        width: 130px;
    }
}
</style>
