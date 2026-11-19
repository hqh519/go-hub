<template>
    <!--
        v1.3.5.3 登记提交表单（P0）
        ----------------------------------------------------------------------------
        一套通用表单兼容各种登记：标题 / 标记 / 类型 / 发生人 / 关联人 / 三个时间 /
        地点 / 事件 / 数值 / 数量 / 单位 / 份量 / 备注 / 标签 / 附件 / 文档。
        选择已有「标记」时会锁定类型与单位（同一标记的统计口径必须一致）。
    -->
    <el-dialog
        v-model="visible"
        :title="isEdit ? $t('reg.editTitle') : $t('reg.addTitle')"
        :width="dialogWidth"
        append-to-body
        class="reg-dialog"
        @closed="onClosed"
    >
        <div class="reg-body">
            <label class="reg-field">
                <span class="reg-label">{{ $t('reg.fieldTitle') }}</span>
                <el-input v-model="form.title" size="small" maxlength="120" :placeholder="$t('reg.fieldTitlePh')" />
            </label>

            <div class="reg-row">
                <label class="reg-field reg-col">
                    <span class="reg-label">{{ $t('reg.fieldMarker') }} <em>*</em></span>
                    <el-autocomplete
                        v-model="form.markerName"
                        size="small"
                        class="reg-marker"
                        :fetch-suggestions="queryMarker"
                        :placeholder="$t('reg.fieldMarkerPh')"
                        :trigger-on-focus="true"
                        clearable
                        maxlength="80"
                        @select="onMarkerPicked"
                        @blur="lockByMarkerName"
                    />
                </label>
                <label class="reg-field reg-col">
                    <span class="reg-label">{{ $t('reg.fieldType') }}</span>
                    <el-select v-model="form.valueType" size="small" :disabled="locked" class="reg-full">
                        <el-option v-for="t in valueTypes" :key="t.value" :label="$t(t.label)" :value="t.value" />
                    </el-select>
                </label>
            </div>

            <div class="reg-row">
                <label class="reg-field reg-col">
                    <span class="reg-label">{{ $t('reg.fieldSubject') }}</span>
                    <el-autocomplete
                        v-model="form.subjectName"
                        size="small"
                        class="reg-full"
                        :fetch-suggestions="(q, cb) => suggestFrom('subjects', q, cb)"
                        :placeholder="$t('reg.fieldSubjectPh')"
                        clearable
                        maxlength="40"
                    />
                </label>
                <label class="reg-field reg-col">
                    <span class="reg-label">{{ $t('reg.fieldRelated') }}</span>
                    <el-autocomplete
                        v-model="form.relatedName"
                        size="small"
                        class="reg-full"
                        :fetch-suggestions="(q, cb) => suggestFrom('related', q, cb)"
                        :placeholder="$t('reg.fieldRelatedPh')"
                        clearable
                        maxlength="40"
                    />
                </label>
            </div>

            <div class="reg-row">
                <label class="reg-field reg-col">
                    <span class="reg-label">{{ $t('reg.fieldOccurredAt') }} <em>*</em></span>
                    <el-date-picker
                        v-model="form.occurredAt"
                        type="datetime"
                        size="small"
                        class="reg-full"
                        :popper-class="datePopperClass"
                        :placeholder="$t('reg.fieldOccurredAt')"
                    />
                </label>
                <label class="reg-field reg-col">
                    <span class="reg-label">{{ $t('reg.fieldPlace') }}</span>
                    <el-autocomplete
                        v-model="form.placeName"
                        size="small"
                        class="reg-full"
                        :fetch-suggestions="(q, cb) => suggestFrom('places', q, cb)"
                        :placeholder="$t('reg.fieldPlacePh')"
                        clearable
                        maxlength="80"
                    />
                </label>
            </div>

            <div class="reg-row">
                <label class="reg-field reg-col">
                    <span class="reg-label">{{ $t('reg.fieldStartAt') }}</span>
                    <el-date-picker
                        v-model="form.startAt"
                        type="datetime"
                        size="small"
                        class="reg-full"
                        :popper-class="datePopperClass"
                        clearable
                        :placeholder="$t('reg.fieldOptional')"
                    />
                </label>
                <label class="reg-field reg-col">
                    <span class="reg-label">{{ $t('reg.fieldDueAt') }}</span>
                    <el-date-picker
                        v-model="form.dueAt"
                        type="datetime"
                        size="small"
                        class="reg-full"
                        :popper-class="datePopperClass"
                        clearable
                        :placeholder="$t('reg.fieldOptional')"
                    />
                </label>
            </div>

            <label class="reg-field">
                <span class="reg-label">{{ $t('reg.fieldEvent') }}</span>
                <el-input
                    v-model="form.event"
                    type="textarea"
                    :rows="3"
                    maxlength="1000"
                    show-word-limit
                    :placeholder="$t('reg.fieldEventPh')"
                />
            </label>

            <div class="reg-row reg-row-nums">
                <label class="reg-field reg-col">
                    <span class="reg-label">{{ $t('reg.fieldAmount') }} <em>*</em></span>
                    <el-input v-model="form.amount" size="small" class="reg-full" :placeholder="$t('reg.fieldAmountPh')" inputmode="decimal" />
                </label>
                <label class="reg-field reg-col reg-col-qty">
                    <span class="reg-label">{{ $t('reg.fieldQuantity') }}</span>
                    <el-input v-model="form.quantity" size="small" class="reg-full" inputmode="decimal" />
                </label>
                <label class="reg-field reg-col reg-col-unit">
                    <span class="reg-label">{{ $t('reg.fieldUnit') }}</span>
                    <el-select
                        v-model="form.unit"
                        size="small"
                        class="reg-full"
                        filterable
                        allow-create
                        default-first-option
                        :disabled="locked"
                        :placeholder="$t('reg.fieldUnitPh')"
                    >
                        <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
                    </el-select>
                </label>
            </div>

            <div class="reg-row">
                <label class="reg-field reg-col">
                    <span class="reg-label">{{ $t('reg.fieldPortion') }}</span>
                    <el-input v-model="form.portion" size="small" class="reg-full" maxlength="32" :placeholder="$t('reg.fieldPortionPh')" />
                </label>
                <label class="reg-field reg-col">
                    <span class="reg-label">{{ $t('reg.fieldCurrency') }}</span>
                    <el-select v-model="form.currency" size="small" class="reg-full">
                        <el-option :label="$t('reg.currencyCny')" value="CNY" />
                        <el-option :label="$t('reg.currencyUsd')" value="USD" />
                    </el-select>
                </label>
            </div>

            <label class="reg-field">
                <span class="reg-label">{{ $t('reg.fieldTags') }}</span>
                <el-select
                    v-model="form.tags"
                    class="reg-full"
                    size="small"
                    multiple
                    filterable
                    allow-create
                    default-first-option
                    :reserve-keyword="false"
                    :placeholder="$t('reg.fieldTagsPh')"
                >
                    <el-option v-for="t in tagOptions" :key="t" :label="t" :value="t" />
                </el-select>
            </label>

            <label class="reg-field">
                <span class="reg-label">{{ $t('reg.fieldNote') }}</span>
                <el-input v-model="form.note" type="textarea" :rows="2" maxlength="500" :placeholder="$t('reg.fieldNotePh')" />
            </label>

            <div class="reg-field">
                <span class="reg-label">{{ $t('reg.fieldAttachments') }}</span>
                <div class="reg-attach-row">
                    <el-button size="small" @click="pickerVisible = true">
                        <font-awesome-icon icon="images" class="reg-btn-icon" />{{ $t('reg.addAttachment') }}
                    </el-button>
                    <span class="reg-attach-count">{{ $t('reg.attachCount', { n: form.attachments.length }) }}</span>
                </div>
                <div v-if="form.attachments.length" class="reg-attach-list">
                    <span v-for="(a, i) in attachmentViews" :key="a.id + '-' + i" class="reg-attach-item">
                        <span class="reg-attach-name">{{ a.name || a.id }}</span>
                        <button type="button" class="reg-attach-del" @click="removeAttachment(i)">×</button>
                    </span>
                </div>
            </div>

            <div class="reg-field">
                <span class="reg-label">{{ $t('reg.fieldDoc') }}</span>
                <div class="reg-attach-row">
                    <el-button size="small" @click="openDocPicker">
                        <font-awesome-icon icon="file-lines" class="reg-btn-icon" />{{ $t('reg.addDoc') }}
                    </el-button>
                    <span v-if="docTitle" class="reg-doc-name">{{ docTitle }}</span>
                    <button v-if="form.docNoteId" type="button" class="reg-doc-clear" @click="clearDoc">×</button>
                </div>
            </div>
        </div>

        <template #footer>
            <div class="reg-footer">
                <el-button size="small" @click="visible = false">{{ $t('common.cancel') }}</el-button>
                <el-button size="small" type="primary" :loading="saving" @click="submit">{{ $t('common.save') }}</el-button>
            </div>
        </template>

        <FilePickerDialog v-model="pickerVisible" :instance-id="instanceId" @confirm="onPickedFiles" />

        <!-- 挂载文档：从笔记里挑一篇 -->
        <el-dialog v-model="docPickerVisible" :title="$t('reg.addDoc')" width="460px" append-to-body class="reg-doc-dialog">
            <el-input v-model="docKeyword" size="small" clearable :placeholder="$t('reg.searchDoc')" />
            <div v-loading="docLoading" class="reg-doc-list">
                <button
                    v-for="d in filteredDocs"
                    :key="d.id"
                    type="button"
                    class="reg-doc-item"
                    @click="pickDoc(d)"
                >
                    <font-awesome-icon icon="file-lines" class="reg-doc-icon" />
                    <span class="reg-doc-title">{{ d.title || $t('reg.untitled') }}</span>
                </button>
                <p v-if="!docLoading && !filteredDocs.length" class="reg-doc-empty">{{ $t('reg.noDoc') }}</p>
            </div>
        </el-dialog>
    </el-dialog>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import FilePickerDialog from '@/components/notes/FilePickerDialog.vue';

const VALUE_TYPES = [
    { value: 'flow', label: 'reg.typeFlow' },
    { value: 'stock', label: 'reg.typeStock' },
    { value: 'count', label: 'reg.typeCount' },
    { value: 'duration', label: 'reg.typeDuration' },
    { value: 'ratio', label: 'reg.typeRatio' },
    { value: 'price', label: 'reg.typePrice' },
];

const emptyForm = () => ({
    id: '',
    title: '',
    markerName: '',
    valueType: 'flow',
    event: '',
    occurredAt: Date.now(),
    startAt: null,
    dueAt: null,
    subjectName: '',
    relatedName: '',
    placeName: '',
    amount: '',
    quantity: '1',
    unit: '',
    portion: '',
    currency: 'CNY',
    note: '',
    tags: [],
    attachments: [],
    docNoteId: '',
});

export default {
    name: 'RegEntryDialog',
    components: { FilePickerDialog },
    props: {
        modelValue: { type: Boolean, default: false },
        instanceId: { type: String, default: '' },
        /** 编辑时传入一条登记（含 id）；新建为 null */
        entry: { type: Object, default: null },
        /** 新建时预设的标记名（从某个标记点「添加登记」） */
        presetMarker: { type: String, default: '' },
    },
    emits: ['update:modelValue', 'saved'],
    data() {
        return {
            form: emptyForm(),
            valueTypes: VALUE_TYPES,
            saving: false,
            locked: false,
            trackers: [],
            markerCache: {},
            candidates: { places: [], subjects: [], related: [], units: [], tags: [] },
            pickerVisible: false,
            attachmentViews: [],
            /** v1.3.5.3：附件 id → 名称（选文件时缓存，避免额外请求） */
            attachmentNames: {},
            docPickerVisible: false,
            docLoading: false,
            docKeyword: '',
            docList: [],
            docTitle: '',
            datePopperClass: 'reg-date-popper--center',
        };
    },
    computed: {
        visible: {
            get() { return this.modelValue; },
            set(v) { this.$emit('update:modelValue', v); },
        },
        isEdit() { return !!(this.entry && this.entry.id); },
        dialogWidth() { return window.innerWidth <= 480 ? '94%' : '620px'; },
        filteredDocs() {
            const q = String(this.docKeyword || '').trim().toLowerCase();
            if (!q) return this.docList;
            return this.docList.filter((d) => String(d.title || '').toLowerCase().includes(q));
        },
        unitOptions() {
            const set = new Set(this.candidates.units || []);
            if (this.form.unit) set.add(this.form.unit);
            return Array.from(set);
        },
        tagOptions() { return this.candidates.tags || []; },
    },
    watch: {
        modelValue(v) {
            if (v) this.init();
        },
    },
    methods: {
        async init() {
            this.form = emptyForm();
            this.locked = false;
            this.attachmentNames = {};
            this.attachmentViews = [];
            this.docTitle = '';
            if (this.entry && this.entry.id) {
                const e = this.entry;
                this.form = {
                    id: e.id,
                    title: e.title || '',
                    markerName: e.markerName || '',
                    valueType: e.valueType || 'flow',
                    event: e.event || '',
                    occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date(),
                    startAt: e.startAt ? new Date(e.startAt) : null,
                    dueAt: e.dueAt ? new Date(e.dueAt) : null,
                    subjectName: e.subjectName || '',
                    relatedName: e.relatedName || '',
                    placeName: e.placeName || '',
                    amount: e.amount === 0 || e.amount ? String(e.amount) : '',
                    quantity: e.quantity === 0 || e.quantity ? String(e.quantity) : '1',
                    unit: e.unit || '',
                    portion: e.portion || '',
                    currency: e.currency || 'CNY',
                    note: e.note || '',
                    tags: Array.isArray(e.tags) ? e.tags.slice() : [],
                    attachments: Array.isArray(e.attachments) ? e.attachments.slice() : [],
                    docNoteId: e.docNoteId || '',
                };
                this.locked = true;
                this.loadAttachmentViews();
                if (e.docNoteId) this.docTitle = e.docTitle || e.docNoteId;
            } else if (this.presetMarker) {
                this.form.markerName = this.presetMarker;
                this.lockByMarkerName();
            }
            await Promise.all([this.loadTrackers(), this.loadCandidates()]);
            if (this.form.markerName) this.lockByMarkerName();
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
        async loadCandidates() {
            try {
                const qs = new URLSearchParams({ instanceId: this.instanceId || '' });
                const res = await fetchWithAuth(`/api/reg/candidates?${qs.toString()}`);
                const data = await res.json().catch(() => null);
                if (data) this.candidates = { places: [], subjects: [], related: [], units: [], tags: [], ...data };
            } catch (e) {
                /* 候选失败不阻断表单 */
            }
        },
        loadAttachmentViews() {
            /* 不再额外请求：名称在「选文件」时缓存；编辑旧数据时显示序号即可 */
            this.attachmentViews = (this.form.attachments || []).slice(0, 30).map((id, i) => ({
                id,
                name: this.attachmentNames[id] || this.$t('reg.attachFallback', { n: i + 1 }),
            }));
        },
        /** 标记候选：历史登记项 + markers 表（kind=register） */
        async queryMarker(q, cb) {
            const key = String(q || '').trim().toLowerCase();
            if (this.markerCache[key]) {
                cb(this.markerCache[key]);
                return;
            }
            const list = this.trackers
                .filter((t) => !key || String(t.name || '').toLowerCase().includes(key))
                .slice(0, 20)
                .map((t) => ({ value: t.name, tracker: t }));
            this.markerCache[key] = list;
            cb(list);
        },
        onMarkerPicked(item) {
            if (item && item.tracker) this.applyTracker(item.tracker);
        },
        /** 手输名称恰好等于已有标记时也要锁定口径 */
        lockByMarkerName() {
            const name = String(this.form.markerName || '').trim();
            if (!name) {
                this.locked = false;
                return;
            }
            const hit = this.trackers.find((t) => String(t.name) === name);
            if (hit) this.applyTracker(hit);
        },
        applyTracker(t) {
            this.locked = true;
            this.form.valueType = t.valueType || 'flow';
            this.form.unit = t.unit || this.form.unit;
        },
        suggestFrom(key, q, cb) {
            const kw = String(q || '').trim().toLowerCase();
            const arr = (this.candidates && this.candidates[key]) || [];
            cb(arr.filter((v) => !kw || String(v).toLowerCase().includes(kw)).slice(0, 20).map((v) => ({ value: v })));
        },
        onPickedFiles(files) {
            for (const f of files || []) {
                const id = String(f.id || f.src || '');
                if (!id) continue;
                this.attachmentNames[id] = String(f.originalName || f.name || '');
            }
            const ids = (files || []).map((f) => String(f.id || f.src || '')).filter(Boolean);
            const set = new Set([...(this.form.attachments || []), ...ids]);
            this.form.attachments = Array.from(set).slice(0, 30);
            this.loadAttachmentViews();
        },
        removeAttachment(i) {
            const list = this.form.attachments.slice();
            list.splice(i, 1);
            this.form.attachments = list;
            this.loadAttachmentViews();
        },
        async openDocPicker() {
            this.docPickerVisible = true;
            if (this.docList.length) return;
            this.docLoading = true;
            try {
                const qs = new URLSearchParams({ kind: 'memo', instanceId: this.instanceId || '', page: '1', pageSize: '100' });
                const res = await fetchWithAuth(`/api/notes/list?${qs.toString()}`);
                const data = await res.json().catch(() => ({}));
                const rows = Array.isArray(data) ? data : data.list || [];
                this.docList = rows.map((r) => ({ id: r.id, title: r.title || '' }));
            } catch (e) {
                this.docList = [];
            } finally {
                this.docLoading = false;
            }
        },
        pickDoc(d) {
            this.form.docNoteId = d.id;
            this.docTitle = d.title || d.id;
            this.docPickerVisible = false;
        },
        clearDoc() {
            this.form.docNoteId = '';
            this.docTitle = '';
        },
        async submit() {
            const markerName = String(this.form.markerName || '').trim();
            if (!markerName) {
                this.$message.warning(this.$t('reg.markerRequired'));
                return;
            }
            const amount = Number(String(this.form.amount).replace(/[,\s]/g, ''));
            if (!Number.isFinite(amount)) {
                this.$message.warning(this.$t('reg.amountInvalid'));
                return;
            }
            const quantity = String(this.form.quantity).trim() === '' ? 1 : Number(String(this.form.quantity).replace(/[,\s]/g, ''));
            if (!Number.isFinite(quantity) || quantity === 0) {
                this.$message.warning(this.$t('reg.quantityInvalid'));
                return;
            }
            this.saving = true;
            try {
                const body = {
                    trackerName: markerName,
                    markerName,
                    valueType: this.form.valueType,
                    unit: this.form.unit,
                    instanceId: this.instanceId || '',
                    title: this.form.title,
                    event: this.form.event,
                    occurredAt: this.form.occurredAt ? new Date(this.form.occurredAt).getTime() : Date.now(),
                    startAt: this.form.startAt ? new Date(this.form.startAt).getTime() : null,
                    dueAt: this.form.dueAt ? new Date(this.form.dueAt).getTime() : null,
                    subjectName: this.form.subjectName,
                    relatedName: this.form.relatedName,
                    placeName: this.form.placeName,
                    amount,
                    quantity,
                    portion: this.form.portion,
                    currency: this.form.currency,
                    note: this.form.note,
                    tags: this.form.tags,
                    attachments: this.form.attachments,
                    docNoteId: this.form.docNoteId,
                };
                const url = this.isEdit ? `/api/reg/entries/${encodeURIComponent(this.form.id)}` : '/api/reg/entries';
                const res = await fetchWithAuth(url, {
                    method: this.isEdit ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.isEdit ? this.$t('reg.saveOk') : this.$t('reg.addOk'));
                this.visible = false;
                this.$emit('saved', { id: data.id || '', edit: this.isEdit });
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            } finally {
                this.saving = false;
            }
        },
        onClosed() {
            this.form = emptyForm();
            this.markerCache = {};
        },
    },
};
</script>

<style scoped>
.reg-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 68vh;
    overflow-y: auto;
    padding-right: 2px;
    text-align: left;
}

.reg-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.reg-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
}

.reg-col {
    flex: 1 1 200px;
    min-width: 0;
}

.reg-row-nums .reg-col {
    flex: 1 1 140px;
}

.reg-col-qty {
    flex: 0 1 110px;
}

.reg-col-unit {
    flex: 0 1 140px;
}

.reg-full {
    width: 100%;
}

.reg-label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.reg-label em {
    color: var(--el-color-danger);
    font-style: normal;
}

.reg-marker {
    width: 100%;
}

.reg-attach-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.reg-btn-icon {
    margin-right: 5px;
}

.reg-attach-count,
.reg-doc-name {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.reg-attach-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
}

.reg-attach-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    padding: 3px 8px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    font-size: 12px;
    color: var(--el-text-color-regular);
}

.reg-attach-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.reg-attach-del,
.reg-doc-clear {
    border: 0;
    background: transparent;
    color: var(--el-text-color-secondary);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
}

.reg-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}

.reg-doc-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 46vh;
    overflow-y: auto;
    margin-top: 10px;
}

.reg-doc-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-regular);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
}

.reg-doc-item:hover {
    background: var(--el-fill-color-light);
}

.reg-doc-icon {
    color: var(--el-color-primary);
}

.reg-doc-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.reg-doc-empty {
    padding: 24px 0;
    text-align: center;
    font-size: 12.5px;
    color: var(--el-text-color-secondary);
}
</style>

<style>
/* v1.3.5.3：移动端三个时间选择器都居中显示（与文件详情的截止时间同口径） */
.reg-date-popper--center.el-popper {
    position: fixed !important;
    left: 50% !important;
    top: 50% !important;
    right: auto !important;
    bottom: auto !important;
    transform: translate(-50%, -50%) !important;
    margin: 0 !important;
    max-width: 94vw;
}
</style>
