<template>
    <!--
        v1.3.5.3 登记流水账（/post → 登记类目）
        ----------------------------------------------------------------------------
        以「流水账」方式按发生时间倒序显示；支持按标记 / 时间范围 / 关键词筛选，
        以及新增、编辑、删除。数据全部来自 /api/reg/entries。
    -->
    <section class="reg-panel">
        <div class="reg-toolbar">
            <el-select
                v-model="filterTracker"
                size="small"
                clearable
                filterable
                class="reg-filter-marker"
                :placeholder="$t('reg.allMarkers')"
            >
                <el-option v-for="t in trackers" :key="t.id" :label="t.name" :value="t.name">
                    <span class="reg-opt-name">{{ t.name }}</span>
                    <span class="reg-opt-count">{{ t.count }}</span>
                </el-option>
            </el-select>
            <el-select v-model="range" size="small" class="reg-filter-range">
                <el-option :label="$t('reg.rangeAll')" value="all" />
                <el-option :label="$t('reg.rangeMonth')" value="month" />
                <el-option :label="$t('reg.rangeYear')" value="year" />
            </el-select>
            <el-input
                v-model="keyword"
                size="small"
                clearable
                class="reg-filter-kw"
                :placeholder="$t('reg.searchPh')"
                @keyup.enter="reload(1)"
            >
                <template #prefix><font-awesome-icon icon="search" class="reg-kw-icon" /></template>
            </el-input>
            <el-button size="small" :loading="loading" @click="reload(1)">
                <font-awesome-icon icon="sync" />
            </el-button>
            <el-button size="small" :loading="importing" @click="triggerImport">
                <font-awesome-icon icon="upload" class="reg-add-icon" />{{ $t('reg.import') }}
            </el-button>
            <!-- v1.3.5.9：导入模板下载（表头与导入解析用的列名一致） -->
            <el-button size="small" @click="downloadTemplate">
                <font-awesome-icon icon="download" class="reg-add-icon" />{{ $t('reg.templateDownload') }}
            </el-button>
            <input
                ref="importInput"
                type="file"
                accept=".csv,text/csv"
                class="reg-import-input"
                @change="onImportFile"
            />
            <el-button size="small" type="primary" class="reg-add-btn" @click="openCreate">
                <font-awesome-icon icon="plus" class="reg-add-icon" />{{ $t('reg.addEntry') }}
            </el-button>
        </div>

        <div v-loading="loading" class="reg-list">
            <div v-if="!loading && !list.length" class="reg-empty">
                <font-awesome-icon icon="clipboard-list" class="reg-empty-icon" />
                <p>{{ $t('reg.empty') }}</p>
            </div>
            <article v-for="item in list" :key="item.id" class="reg-item">
                <div class="reg-item-main">
                    <div class="reg-item-head">
                        <span class="reg-item-time">{{ fmtTime(item.occurredAt) }}</span>
                        <span class="reg-item-marker">@{{ item.trackerName }}</span>
                        <span v-if="item.placeName" class="reg-item-place">
                            <font-awesome-icon icon="location-dot" />{{ item.placeName }}
                        </span>
                        <span class="reg-item-amount" :class="{ 'is-neg': isNegative(item) }">
                            {{ fmtAmount(item) }}
                        </span>
                    </div>
                    <p v-if="item.title" class="reg-item-title">{{ item.title }}</p>
                    <p v-if="item.event" class="reg-item-event">{{ item.event }}</p>
                    <!-- v1.3.5.9：附件缩略图在详情下一行（标签行上方），只加载一行 -->
                    <div v-if="visibleFiles(item).length" class="reg-item-files">
                        <div
                            v-for="(f, fi) in visibleFiles(item)"
                            :key="f.fileId + '-' + fi"
                            class="reg-item-file"
                            :title="f.originalName || f.name || ''"
                        >
                            <el-image
                                v-if="f.mediaKind === 'image' && (f.thumbUrl || f.url)"
                                class="reg-item-file-img"
                                :src="f.thumbUrl || f.url"
                                :preview-src-list="[f.url || f.thumbUrl]"
                                fit="cover"
                                preview-teleported
                            />
                            <span v-else class="reg-item-file-cover">
                                <font-awesome-icon :icon="fileIcon(f.mediaKind)" />
                            </span>
                        </div>
                    </div>
                    <div class="reg-item-meta">
                        <span v-if="item.subjectName">{{ $t('reg.fieldSubject') }}：{{ item.subjectName }}</span>
                        <span v-if="item.relatedName">{{ $t('reg.fieldRelated') }}：{{ item.relatedName }}</span>
                        <span v-if="(item.attachments || []).length > maxFiles">
                            <font-awesome-icon icon="paperclip" />{{ item.attachments.length }}
                        </span>
                        <span v-if="item.tags && item.tags.length" class="reg-item-tags">
                            <span v-for="t in item.tags" :key="t" class="reg-tag">#{{ t }}</span>
                        </span>
                    </div>
                </div>
                <div class="reg-item-actions">
                    <button type="button" class="reg-act" :title="$t('common.edit')" @click="openEdit(item)">
                        <font-awesome-icon icon="pen-to-square" />
                    </button>
                    <button type="button" class="reg-act is-danger" :title="$t('common.delete')" @click="remove(item)">
                        <font-awesome-icon icon="trash" />
                    </button>
                </div>
            </article>
        </div>

        <div v-if="total > pageSize" class="reg-pager">
            <el-button size="small" :disabled="page <= 1" @click="reload(page - 1)">{{ $t('reg.prev') }}</el-button>
            <span class="reg-pager-info">{{ page }} / {{ Math.ceil(total / pageSize) }}（{{ total }}）</span>
            <el-button size="small" :disabled="page >= Math.ceil(total / pageSize)" @click="reload(page + 1)">{{ $t('reg.next') }}</el-button>
        </div>

        <RegEntryDialog
            v-model="dialogVisible"
            :instance-id="instanceId"
            :entry="editing"
            @saved="onSaved"
        />
    </section>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import RegEntryDialog from './RegEntryDialog.vue';

export default {
    name: 'RegPanel',
    components: { RegEntryDialog },
    props: {
        instanceId: { type: String, default: '' },
    },
    emits: ['changed'],
    data() {
        return {
            list: [],
            trackers: [],
            total: 0,
            page: 1,
            pageSize: 20,
            loading: false,
            filterTracker: '',
            range: 'all',
            keyword: '',
            dialogVisible: false,
            editing: null,
            importing: false,
            /* v1.3.5.9：一行最多几个附件缩略图（桌面 8 / 移动 4） */
            narrow: false,
        };
    },
    watch: {
        instanceId() { this.reload(1); },
        filterTracker() { this.reload(1); },
        range() { this.reload(1); },
    },
    computed: {
        maxFiles() {
            return this.narrow ? 4 : 8;
        },
    },
    mounted() {
        this.syncNarrow();
        window.addEventListener('resize', this.syncNarrow);
        this.reload(1);
        this.loadTrackers();
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.syncNarrow);
    },
    methods: {
        syncNarrow() {
            this.narrow = typeof window !== 'undefined' && window.innerWidth <= 768;
        },
        /** 只取一行：桌面 8 个、移动 4 个；尺寸固定，不随数量变化 */
        visibleFiles(item) {
            const list = (item && item.attachmentViews) || [];
            return list.slice(0, this.maxFiles);
        },
        fileIcon(kind) {
            if (kind === 'video') return 'film';
            if (kind === 'audio') return 'music';
            return 'file';
        },
        /**
         * v1.3.5.9：下载导入模板。
         * 表头与 mapImportRow 认的列名一致，另存成 CSV（带 BOM，Excel 直接能开）。
         */
        downloadTemplate() {
            const heads = ['条目', '发生时间', '登记数值', '份量', '单位', '分母', '标题', '详情', '发生人', '关联人', '地点'];
            const csv = `${heads.join(',')}\r\n`;
            const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = '登记导入模板.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            this.$message.success(this.$t('reg.templateSaved'));
        },
        rangeQuery() {
            const now = new Date();
            if (this.range === 'month') {
                return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime() };
            }
            if (this.range === 'year') {
                return { from: new Date(now.getFullYear(), 0, 1).getTime() };
            }
            return {};
        },
        async loadTrackers() {
            try {
                const qs = new URLSearchParams({ instanceId: this.instanceId || '' });
                const res = await fetchWithAuth(`/api/reg/trackers?${qs.toString()}`);
                const data = await res.json().catch(() => []);
                this.trackers = Array.isArray(data) ? data : [];
            } catch (e) {
                this.trackers = [];
            }
        },
        async reload(page) {
            this.loading = true;
            this.page = Math.max(1, Number(page) || 1);
            try {
                const qs = new URLSearchParams({
                    instanceId: this.instanceId || '',
                    page: String(this.page),
                    pageSize: String(this.pageSize),
                });
                if (this.filterTracker) qs.set('trackerName', this.filterTracker);
                if (this.keyword.trim()) qs.set('keyword', this.keyword.trim());
                const rq = this.rangeQuery();
                if (rq.from) qs.set('from', String(rq.from));
                const res = await fetchWithAuth(`/api/reg/entries?${qs.toString()}`);
                const data = await res.json().catch(() => ({}));
                this.list = Array.isArray(data.list) ? data.list : [];
                this.total = Number(data.total) || 0;
            } catch (e) {
                this.list = [];
                this.total = 0;
            } finally {
                this.loading = false;
            }
        },
        openCreate() {
            this.editing = null;
            this.dialogVisible = true;
        },
        openEdit(item) {
            this.editing = item;
            this.dialogVisible = true;
        },
        async remove(item) {
            try {
                await this.$confirm(this.$t('reg.deleteConfirm'), this.$t('common.delete'), {
                    type: 'warning',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(`/api/reg/entries/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('reg.deleteOk'));
                this.reload(this.page);
                this.loadTrackers();
                this.$emit('changed');
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },
        triggerImport() {
            const input = this.$refs.importInput;
            if (!input) return;
            input.value = '';
            input.click();
        },
        /**
         * v1.3.5.3：Excel / CSV 导入（P1）。
         * Excel 另存为 CSV 后即可导入；第一行是表头，列名支持中英文别名。
         * 逐行交给后端 /api/reg/import，失败行会回报行号，不整批回滚。
         */
        async onImportFile(e) {
            const file = e && e.target && e.target.files ? e.target.files[0] : null;
            if (!file) return;
            this.importing = true;
            try {
                const text = await file.text();
                const table = this.parseCsv(text);
                this._importHeads = (table[0] || []).map((h) => String(h || '').trim());
                const rows = table.slice(1).map((r) => this.mapImportRow(r)).filter(Boolean);
                if (!rows.length) {
                    this.$message.warning(this.$t('reg.importEmpty'));
                    return;
                }
                const res = await fetchWithAuth('/api/reg/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ instanceId: this.instanceId || '', rows }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                const ok = Number(data.ok) || 0;
                const failed = Array.isArray(data.failed) ? data.failed.length : 0;
                this.$message.success(this.$t('reg.importOk', { ok, failed }));
                this.reload(1);
                this.loadTrackers();
                this.$emit('changed');
            } catch (err) {
                this.$message.error(err.message || this.$t('common.failed'));
            } finally {
                this.importing = false;
                if (e && e.target) e.target.value = '';
            }
        },
        /** 极简 CSV 解析：支持双引号包裹的字段与逗号转义（Excel 另存 CSV 的常见形态） */
        parseCsv(text) {
            const src = String(text || '').replace(/^\uFEFF/, '');
            const rows = [];
            let row = [];
            let cell = '';
            let quoted = false;
            for (let i = 0; i < src.length; i += 1) {
                const ch = src[i];
                if (quoted) {
                    if (ch === '"' && src[i + 1] === '"') {
                        cell += '"';
                        i += 1;
                    } else if (ch === '"') {
                        quoted = false;
                    } else {
                        cell += ch;
                    }
                    continue;
                }
                if (ch === '"') {
                    quoted = true;
                } else if (ch === ',') {
                    row.push(cell);
                    cell = '';
                } else if (ch === '\n') {
                    row.push(cell);
                    rows.push(row);
                    row = [];
                    cell = '';
                } else if (ch !== '\r') {
                    cell += ch;
                }
            }
            if (cell || row.length) {
                row.push(cell);
                rows.push(row);
            }
            return rows.filter((r) => r.some((c) => String(c || '').trim()));
        },
        mapImportRow(cells) {
            const heads = this._importHeads;
            const pick = (names) => {
                for (const n of names) {
                    const idx = heads.indexOf(n);
                    if (idx >= 0) return String(cells[idx] || '').trim();
                }
                return '';
            };
            const markerName = pick(['条目', '条目名', '标记', '标记名', 'tracker', 'trackerName', 'marker', 'markerName']);
            const dateRaw = pick(['时间', '发生时间', '日期', 'occurredAt', 'date']);
            const amountRaw = pick(['登记数值', '数值', '金额', 'amount', 'value']);
            if (!markerName || !dateRaw || amountRaw === '') return null;
            const ms = Date.parse(dateRaw.replace(/\//g, '-'));
            const amount = Number(String(amountRaw).replace(/[,\s]/g, ''));
            if (!Number.isFinite(ms) || !Number.isFinite(amount)) return null;
            const qtyRaw = pick(['数量', 'quantity']);
            const quantity = qtyRaw === '' ? 1 : Number(String(qtyRaw).replace(/[,\s]/g, ''));
            return {
                markerName,
                trackerName: markerName,
                occurredAt: ms,
                amount,
                quantity: Number.isFinite(quantity) && quantity !== 0 ? quantity : 1,
                unit: pick(['单位', 'unit']),
                title: pick(['标题', 'title']),
                event: pick(['详情', '事件', '登记事件', 'event']),
                subjectName: pick(['发生人', 'subjectName']),
                relatedName: pick(['关联人', 'relatedName']),
                placeName: pick(['地点', 'placeName']),
                portion: pick(['分母', 'portion']),
            };
        },
        onSaved() {
            this.reload(this.page);
            this.loadTrackers();
            this.$emit('changed');
        },
        fmtTime(ms) {
            const d = new Date(Number(ms) || 0);
            if (!Number.isFinite(d.getTime())) return '';
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        },
        /**
         * v1.3.5.9：数值前的正负号由「性质」决定 ——
         *   性质 1 → "+"，性质 -1 → "-"，性质 0 → 不加号（原样显示）。
         * 数值本身已经按性质取了符号，这里取绝对值再拼号，避免出现 "--100"。
         */
        fmtAmount(item) {
            const n = Number(item.amount) * (Number(item.quantity) || 1);
            const v = Number.isFinite(n) ? n : 0;
            const dir = Number(item.direction) || 0;
            const abs = Math.abs(v);
            const sign = dir === 1 ? '+' : (dir === -1 ? '-' : '');
            /* v1.3.5.7：单位 + 分母一起显示（元/升） */
            const unit = item.unit ? ` ${item.unit}${item.portion ? `/${item.portion}` : ''}` : '';
            return `${sign}${sign ? abs : v}${unit}`;
        },
        /** 负数着色也按性质判断（性质 0 时看数值本身） */
        isNegative(item) {
            const dir = Number(item.direction) || 0;
            if (dir === 1) return false;
            if (dir === -1) return true;
            return Number(item.amount) < 0;
        },
    },
};
</script>

<style scoped>
.reg-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 2px 2px 24px;
}

.reg-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 10px;
    border: 1px solid var(--note-card-border, var(--glass-border));
    border-radius: 10px;
    background: var(--glass-bg);
}

.reg-filter-marker {
    width: 190px;
}

.reg-filter-range {
    width: 108px;
}

.reg-filter-kw {
    width: 200px;
}

.reg-kw-icon {
    font-size: 12px;
    opacity: 0.6;
}

.reg-add-btn {
    margin-left: auto;
}

.reg-add-icon {
    margin-right: 5px;
}

.reg-import-input {
    display: none;
}

.reg-opt-name {
    margin-right: 8px;
}

.reg-opt-count {
    float: right;
    font-size: 11px;
    color: var(--el-text-color-secondary);
}

.reg-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 120px;
}

.reg-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 60px 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

.reg-empty-icon {
    font-size: 32px;
    opacity: 0.35;
}

.reg-item {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--note-card-border, var(--glass-border));
    border-radius: 10px;
    background: var(--note-card-bg, var(--el-bg-color));
}

.reg-item-main {
    flex: 1 1 auto;
    min-width: 0;
}

.reg-item-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.reg-item-marker {
    color: var(--el-color-primary);
    font-weight: 600;
}

.reg-item-place svg {
    margin-right: 3px;
    opacity: 0.7;
}

.reg-item-amount {
    margin-left: auto;
    font-size: 14px;
    font-weight: 700;
    color: var(--el-color-danger);
    font-variant-numeric: tabular-nums;
}

.reg-item-amount.is-neg {
    color: var(--el-color-success);
}

.reg-item-title {
    margin: 4px 0 0;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--el-text-color-primary);
}

.reg-item-event {
    margin: 4px 0 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--el-text-color-regular);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

/* v1.3.5.9：附件缩略图画在详情下面一行（桌面 8 个 / 移动 4 个，尺寸固定 1:1） */
.reg-item-files {
    display: flex;
    gap: 6px;
    margin-top: 8px;
    overflow: hidden;
}

.reg-item-file {
    flex: 0 0 auto;
    width: 54px;
    height: 54px;
    border-radius: 7px;
    overflow: hidden;
    background: var(--note-cell-bg, rgba(127, 127, 127, 0.12));
}

.reg-item-file-img {
    width: 100%;
    height: 100%;
    display: block;
}

.reg-item-file-img :deep(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.reg-item-file-cover {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--el-text-color-secondary);
    font-size: 17px;
}

.reg-item-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 6px;
    font-size: 11.5px;
    color: var(--el-text-color-secondary);
}

.reg-item-tags {
    display: inline-flex;
    gap: 6px;
    flex-wrap: wrap;
}

.reg-tag {
    color: var(--el-color-primary);
}

.reg-item-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 0 0 auto;
}

.reg-act {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-secondary);
    cursor: pointer;
}

.reg-act:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary-light-5);
}

.reg-act.is-danger:hover {
    color: var(--el-color-danger);
    border-color: var(--el-color-danger-light-5);
}

.reg-pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 0;
}

.reg-pager-info {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

@media (max-width: 768px) {
    .reg-item-file {
        width: 48px;
        height: 48px;
    }

    .reg-filter-marker,
    .reg-filter-kw {
        width: 100%;
    }

    .reg-filter-range {
        width: 120px;
    }

    .reg-add-btn {
        margin-left: 0;
    }
}
</style>
