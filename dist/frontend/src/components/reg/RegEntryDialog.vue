<template>
    <!--
        v1.3.5.8 登记提交表单
        ----------------------------------------------------------------------------
        一套通用表单兼容各种登记，字段顺序按本轮需求给的参考图排：
          标题 / 详情 / 地点 / 发生时间·起始时间·截止时间 / 条目 /
          类型·性质 / 数值·份量 / 单位·分母·币种 / 发生人·关联人 / 标签
        · 「条目」是登记自己的身份表（reg_trackers），选中已有条目即锁定类型 / 单位 / 分母；
        · 「性质」v1.3.5.9 起落每条登记自己的 reg_entries.direction（不随条目冻结）；
        · 「标签」走全站共用的 tags 表；
        · 附件缩略图在按钮行上方（与瞬间编辑页同一套样式），`x 个附件` 放在底部「取消」左侧。
    -->
    <el-dialog
        v-model="visible"
        :title="isEdit ? $t('reg.editTitle') : $t('reg.addTitle')"
        :width="dialogWidth"
        append-to-body
        class="reg-dialog"
        @opened="scrollToTop"
        @closed="onClosed"
    >
        <!--
            v1.3.5.7（需求：标题输入框要能被浏览器记忆）：
            用真正的 <form autocomplete="on"> 包一层，标题输入框带 name —— 浏览器
            才会把它当表单字段记进「上次输入过的值」。保存按钮走 requestSubmit()，
            这样点保存时表单是真的提交了一次（而不是纯 JS 发请求）。
        -->
        <form ref="regForm" class="reg-body" autocomplete="on" @submit.prevent="submit">
            <div class="reg-grid">
                <!-- 标题 -->
                <div class="reg-cell reg-span-6">
                    <span class="reg-cell-label">{{ $t('reg.fieldTitle') }}</span>
                    <el-input
                        v-model="form.title"
                        class="reg-plain"
                        name="reg-entry-title"
                        autocomplete="on"
                        maxlength="120"
                        :placeholder="$t('reg.fieldTitlePh')"
                        @keydown.enter.prevent
                    />
                </div>

                <!-- 详情：内容超出后自动增高，最高不超过视口 30% -->
                <div class="reg-cell reg-span-6">
                    <span class="reg-cell-label">{{ $t('reg.fieldDetail') }}</span>
                    <el-input
                        v-model="form.event"
                        class="reg-plain reg-detail"
                        type="textarea"
                        :autosize="{ minRows: 4 }"
                        maxlength="1000"
                        :placeholder="$t('reg.fieldDetailPh')"
                    />
                </div>

                <!-- 地点 -->
                <div class="reg-cell reg-span-6">
                    <span class="reg-cell-label">{{ $t('reg.fieldPlace') }}</span>
                    <el-autocomplete
                        v-model="form.placeName"
                        class="reg-plain"
                        :fetch-suggestions="(q, cb) => suggestFrom('places', q, cb)"
                        :placeholder="$t('reg.fieldPlacePh')"
                        clearable
                        maxlength="80"
                    />
                </div>

                <!-- 发生时间 / 起始时间 / 截止时间 -->
                <div class="reg-cell reg-span-2">
                    <span class="reg-cell-label">{{ $t('reg.fieldTime') }} <em>*</em></span>
                    <el-date-picker
                        v-model="form.occurredAt"
                        type="datetime"
                        class="reg-plain reg-date"
                        :popper-class="datePopperClass"
                        :clearable="false"
                        :placeholder="$t('reg.fieldTime')"
                    />
                    <!-- 登记时间：提交时落库，只读展示，任何入口都不允许改 -->
                    <span v-if="isEdit" class="reg-cell-hint">
                        {{ $t('reg.fieldCreatedAt') }} {{ fmtTime(form.createdAt) }}
                    </span>
                </div>
                <div class="reg-cell reg-span-2">
                    <span class="reg-cell-label">{{ $t('reg.fieldStartAt') }}</span>
                    <el-date-picker
                        v-model="form.startAt"
                        type="datetime"
                        class="reg-plain reg-date"
                        :popper-class="datePopperClass"
                        clearable
                        :placeholder="$t('reg.fieldOptional')"
                    />
                </div>
                <div class="reg-cell reg-span-2">
                    <span class="reg-cell-label">{{ $t('reg.fieldDueAt') }}</span>
                    <el-date-picker
                        v-model="form.dueAt"
                        type="datetime"
                        class="reg-plain reg-date"
                        :popper-class="datePopperClass"
                        clearable
                        :placeholder="$t('reg.fieldOptional')"
                    />
                </div>

                <!-- 条目 -->
                <div class="reg-cell reg-span-6">
                    <span class="reg-cell-label">{{ $t('reg.fieldItem') }} <em>*</em></span>
                    <el-autocomplete
                        v-model="form.trackerName"
                        class="reg-plain"
                        :fetch-suggestions="queryTracker"
                        :trigger-on-focus="true"
                        :placeholder="$t('reg.fieldItemPh')"
                        clearable
                        maxlength="80"
                        @select="onTrackerPicked"
                        @blur="lockByTrackerName"
                    />
                </div>

                <!-- 类型 / 性质 -->
                <div class="reg-cell reg-span-3">
                    <span class="reg-cell-label">{{ $t('reg.fieldType') }}</span>
                    <el-select v-model="form.valueType" class="reg-plain reg-full" :disabled="locked">
                        <el-option v-for="t in valueTypes" :key="t.value" :label="$t(t.label)" :value="t.value" />
                    </el-select>
                </div>
                <div class="reg-cell reg-span-3">
                    <span class="reg-cell-label">{{ $t('reg.fieldNature') }}</span>
                    <!-- v1.3.5.9：性质属于这条登记，不跟条目冻结 -->
                    <el-select v-model="form.direction" class="reg-plain reg-full">
                        <el-option v-for="n in natures" :key="n.value" :label="$t(n.label)" :value="n.value" />
                    </el-select>
                </div>

                <!-- 数值 / 份量 -->
                <div class="reg-cell reg-span-3">
                    <span class="reg-cell-label">{{ $t('reg.fieldAmount') }} <em>*</em></span>
                    <el-input
                        v-model="form.amount"
                        class="reg-plain"
                        :placeholder="$t('reg.fieldAmountPh')"
                        inputmode="decimal"
                        @input="onAmountInput"
                        @keydown.enter.prevent
                    />
                </div>
                <div class="reg-cell reg-span-3">
                    <span class="reg-cell-label">{{ $t('reg.fieldQuantity') }}</span>
                    <el-input
                        v-model="form.quantity"
                        class="reg-plain"
                        inputmode="decimal"
                        :placeholder="$t('reg.fieldQuantityPh')"
                        @keydown.enter.prevent
                    />
                </div>

                <!-- 单位 / 分母 / 币种 -->
                <div class="reg-cell reg-span-2">
                    <span class="reg-cell-label">{{ $t('reg.fieldUnit') }}</span>
                    <el-autocomplete
                        v-model="form.unit"
                        class="reg-plain"
                        :fetch-suggestions="(q, cb) => suggestFrom('units', q, cb)"
                        :placeholder="$t('reg.fieldUnitPh')"
                        :disabled="locked"
                        clearable
                        maxlength="24"
                    />
                </div>
                <div class="reg-cell reg-span-2">
                    <span class="reg-cell-label">{{ $t('reg.fieldPortion') }}</span>
                    <el-autocomplete
                        v-model="form.portion"
                        class="reg-plain"
                        :fetch-suggestions="(q, cb) => suggestFrom('portions', q, cb)"
                        :placeholder="$t('reg.fieldPortionPh')"
                        :disabled="locked"
                        clearable
                        maxlength="32"
                    />
                </div>
                <div class="reg-cell reg-span-2">
                    <span class="reg-cell-label">{{ $t('reg.fieldCurrency') }}</span>
                    <el-select v-model="form.currency" class="reg-plain reg-full">
                        <el-option :label="$t('reg.currencyNone')" value="NONE" />
                        <el-option :label="$t('reg.currencyCny')" value="CNY" />
                        <el-option :label="$t('reg.currencyUsd')" value="USD" />
                    </el-select>
                </div>

                <!-- 发生人 / 关联人 -->
                <div class="reg-cell reg-span-3">
                    <span class="reg-cell-label">{{ $t('reg.fieldSubject') }}</span>
                    <el-autocomplete
                        v-model="form.subjectName"
                        class="reg-plain"
                        :fetch-suggestions="(q, cb) => suggestFrom('subjects', q, cb)"
                        :placeholder="$t('reg.fieldSubjectPh')"
                        clearable
                        maxlength="40"
                    />
                </div>
                <div class="reg-cell reg-span-3">
                    <span class="reg-cell-label">{{ $t('reg.fieldRelated') }}</span>
                    <el-autocomplete
                        v-model="form.relatedName"
                        class="reg-plain"
                        :fetch-suggestions="(q, cb) => suggestFrom('related', q, cb)"
                        :placeholder="$t('reg.fieldRelatedPh')"
                        clearable
                        maxlength="40"
                    />
                </div>

                <!-- 标签：空格与回车都能确认 -->
                <div class="reg-cell reg-span-6">
                    <span class="reg-cell-label">{{ $t('reg.fieldTags') }}</span>
                    <el-select
                        v-model="form.tags"
                        class="reg-plain reg-full"
                        multiple
                        filterable
                        allow-create
                        default-first-option
                        :reserve-keyword="false"
                        :placeholder="$t('reg.fieldTagsPh')"
                        @keydown="onTagKeydown"
                    >
                        <el-option v-for="t in tagOptions" :key="t" :label="t" :value="t" />
                    </el-select>
                </div>
            </div>

            <!--
                v1.3.5.9：附件改成缩略图网格，放在按钮行【上方】。
                加载方式与瞬间编辑页一致：后端给 url / thumbUrl / mediaKind，
                图片直接显示缩略图，视频 / 音频 / 其它给图标 + 文件名。
            -->
            <div v-if="attachmentViews.length" class="reg-assets">
                <div v-for="(a, i) in attachmentViews" :key="a.fileId + '-' + i" class="reg-asset">
                    <el-image
                        v-if="a.mediaKind === 'image' && (a.thumbUrl || a.url)"
                        class="reg-asset-img"
                        :src="a.thumbUrl || a.url"
                        :preview-src-list="[a.url || a.thumbUrl]"
                        fit="cover"
                        preview-teleported
                    />
                    <span v-else class="reg-asset-cover">
                        <font-awesome-icon :icon="a.mediaKind === 'video' ? 'film' : (a.mediaKind === 'audio' ? 'music' : 'file')" />
                        <span class="reg-asset-name">{{ a.originalName || a.name || a.fileId }}</span>
                    </span>
                    <button type="button" class="reg-asset-del" :title="$t('common.delete')" @click.stop="removeAttachment(i)">
                        <font-awesome-icon icon="times" />
                    </button>
                </div>
            </div>

            <!--
                v1.3.5.8：附件四按钮移到表格外（需求：不要显示在边框内）。
                移动端一行不换行，靠左右滑动查看（左右外边距收小）。
            -->
            <div class="reg-file-btns">
                <el-button size="small" @click="pickerVisible = true">
                    <font-awesome-icon icon="images" class="reg-btn-icon" />{{ $t('reg.selectFile') }}
                </el-button>
                <el-button size="small" :loading="uploading" @click="pickLocalFile">
                    <font-awesome-icon icon="upload" class="reg-btn-icon" />{{ $t('notes.uploadLocal') }}
                </el-button>
                <el-button size="small" :loading="uploading" @click="extractLink">
                    <font-awesome-icon icon="link" class="reg-btn-icon" />{{ $t('reg.btnLinkData') }}
                </el-button>
                <el-button size="small" @click="openDocPicker">
                    <font-awesome-icon icon="file-lines" class="reg-btn-icon" />{{ $t('reg.btnMountDoc') }}
                </el-button>
                <input ref="fileInput" type="file" class="reg-file-input" multiple @change="onLocalFilesChosen" />
            </div>
            <div v-if="docTitle" class="reg-attach-list">
                <span class="reg-attach-item">
                    <font-awesome-icon icon="file-lines" class="reg-attach-icon" />
                    <span class="reg-attach-name">{{ docTitle }}</span>
                    <button type="button" class="reg-attach-del" @click="clearDoc">×</button>
                </span>
            </div>
        </form>

        <template #footer>
            <div class="reg-footer">
                <!-- v1.3.5.8：附件数量放在「取消」左侧，没有附件时不显示 -->
                <span v-if="form.attachments.length" class="reg-attach-count">
                    {{ $t('reg.attachCount', { n: form.attachments.length }) }}
                </span>
                <el-button size="small" @click="visible = false">{{ $t('common.cancel') }}</el-button>
                <el-button size="small" type="primary" :loading="saving" @click="requestSubmit">{{ $t('common.save') }}</el-button>
            </div>
        </template>

        <FilePickerDialog v-model="pickerVisible" :instance-id="instanceId" @confirm="onPickedFiles" />

        <!-- 本地上传 / 链接提取共用的目标选择（与瞬间发布页同一个组件） -->
        <UploadTargetDialog
            v-model="targetVisible"
            :busy="uploading"
            :hint="uploadHint"
            :prefill="uploadPrefill"
            @confirm="onTargetConfirm"
        />

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
import UploadTargetDialog from '@/components/upload/UploadTargetDialog.vue';
import { defaultUploadFolder, uploadOne, importUrlToBed } from '@/utils/uploadTarget';

const VALUE_TYPES = [
    { value: 'flow', label: 'reg.typeFlow' },
    { value: 'stock', label: 'reg.typeStock' },
    { value: 'count', label: 'reg.typeCount' },
    { value: 'duration', label: 'reg.typeDuration' },
    { value: 'ratio', label: 'reg.typeRatio' },
    { value: 'price', label: 'reg.typePrice' },
];

/** v1.3.5.8：性质（落 reg_trackers.direction） */
const NATURES = [
    { value: 0, label: 'reg.natureNone' },
    { value: -1, label: 'reg.natureExpense' },
    { value: 1, label: 'reg.natureIncome' },
];

const emptyForm = () => ({
    id: '',
    trackerId: '',
    trackerName: '',
    /* v1.3.5.9：之前漏了这个键，编辑态还漏了回填，标题才会「填了却看不到」 */
    title: '',
    valueType: 'flow',
    /* 性质：0 无 / -1 减出 / 1 增进 */
    direction: 0,
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
    /* v1.3.5.8：币种默认「无」（'NONE' 只是表单哨兵，落库写成空串） */
    currency: 'NONE',
    tags: [],
    attachments: [],
    docNoteId: '',
    /* 登记时间：提交时由后端落库，前端只做只读展示 */
    createdAt: 0,
});

/** 每个提交字段都去首尾空格（需求原文点名了标题 / 条目 / 发生人 / 关联人 / 单位 / 分母） */
const trimText = (v) => String(v === undefined || v === null ? '' : v).trim();

export default {
    name: 'RegEntryDialog',
    components: { FilePickerDialog, UploadTargetDialog },
    props: {
        modelValue: { type: Boolean, default: false },
        instanceId: { type: String, default: '' },
        /** 编辑时传入一条登记（含 id）；新建为 null */
        entry: { type: Object, default: null },
        /** 新建时预设的条目名（从某个条目点「添加登记」） */
        presetTracker: { type: String, default: '' },
        /** 旧属性名，保留兼容 */
        presetMarker: { type: String, default: '' },
    },
    emits: ['update:modelValue', 'saved'],
    data() {
        return {
            form: emptyForm(),
            valueTypes: VALUE_TYPES,
            natures: NATURES,
            saving: false,
            uploading: false,
            locked: false,
            /** 条目候选还没拉回来之前不联动，避免把编辑态的口径冲掉 */
            ready: false,
            trackers: [],
            trackerCache: {},
            candidates: { places: [], subjects: [], related: [], units: [], portions: [], tags: [] },
            pickerVisible: false,
            /** v1.3.5.9：附件视图（与瞬间编辑页同形：fileId / url / thumbUrl / mediaKind） */
            attachmentViews: [],
            /** 附件 id → 视图，选文件 / 上传 / 编辑回填时缓存，避免重复请求 */
            attachMap: {},
            targetVisible: false,
            uploadPrefill: {},
            uploadHint: '',
            pendingFiles: [],
            pendingLink: '',
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
        dialogWidth() { return window.innerWidth <= 480 ? '94%' : '660px'; },
        filteredDocs() {
            const q = String(this.docKeyword || '').trim().toLowerCase();
            if (!q) return this.docList;
            return this.docList.filter((d) => String(d.title || '').toLowerCase().includes(q));
        },
        unitOptions() { return this.candidates.units || []; },
        portionOptions() { return this.candidates.portions || []; },
        tagOptions() { return this.candidates.tags || []; },
    },
    watch: {
        modelValue(v) {
            if (v) this.init();
        },
        /*
         * 不挂 @input：el-autocomplete 并不会把内部输入透传成组件的 input 事件，
         * 监听 v-model 的变化才是唯一可靠的入口（手输、下拉选择、清空都会走到）。
         */
        'form.trackerName'() {
            if (this.ready) this.onTrackerInput();
        },
        /**
         * v1.3.5.9：性质决定数值符号。
         *   1（收入）→ 只能正数；-1（支出）→ 只能负数；0（无）→ 想填什么填什么。
         * 切性质时把已经输入的数值直接掰过来（需求点名的行为）。
         */
        'form.direction'() {
            this.syncAmountSign();
        },
    },
    methods: {
        async init() {
            this.form = emptyForm();
            this.locked = false;
            this.ready = false;
            this.attachMap = {};
            this.attachmentViews = [];
            this.docTitle = '';
            this.pendingFiles = [];
            this.pendingLink = '';
            if (this.entry && this.entry.id) {
                const e = this.entry;
                const tracker = e.tracker || null;
                this.form = {
                    id: e.id,
                    trackerId: e.trackerId || (tracker ? tracker.id : '') || '',
                    trackerName: e.trackerName || (tracker ? tracker.name : '') || '',
                    valueType: e.valueType || (tracker ? tracker.valueType : '') || 'flow',
                    /* v1.3.5.9：性质读这条记录自己的（老数据可能没给，回落 0） */
                    direction: [-1, 0, 1].includes(Number(e.direction)) ? Number(e.direction) : 0,
                    /* v1.3.5.9 修复：编辑态一直漏了 title，导致「填写了标题，点修改却是空的」 */
                    title: e.title || '',
                    event: e.event || '',
                    occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date(),
                    startAt: e.startAt ? new Date(e.startAt) : null,
                    dueAt: e.dueAt ? new Date(e.dueAt) : null,
                    subjectName: e.subjectName || '',
                    relatedName: e.relatedName || '',
                    placeName: e.placeName || '',
                    amount: e.amount === 0 || e.amount ? String(Math.round(Number(e.amount) * 10000) / 10000) : '',
                    quantity: e.quantity === 0 || e.quantity ? String(e.quantity) : '1',
                    unit: e.unit || (tracker ? tracker.unit : '') || '',
                    portion: e.portion || (tracker ? tracker.portion : '') || '',
                    currency: e.currency ? String(e.currency) : 'NONE',
                    tags: Array.isArray(e.tags) ? e.tags.slice() : [],
                    attachments: Array.isArray(e.attachments) ? e.attachments.slice() : [],
                    docNoteId: e.docNoteId || '',
                    createdAt: Number(e.createdAt) || 0,
                };
                /* 编辑态：口径本来就是这一条条目的，直接锁住，但不用条目的值覆盖记录里的快照 */
                this.locked = !!this.form.trackerId;
                /* v1.3.5.9：列表接口已经把附件解析成视图（含缩略图），直接放进缓存 */
                for (const a of Array.isArray(e.attachmentViews) ? e.attachmentViews : []) {
                    if (a && a.fileId) this.attachMap[a.fileId] = a;
                }
                this.loadAttachmentViews();
                if (e.docNoteId) this.docTitle = e.docTitle || e.docNoteId;
            } else {
                const preset = String(this.presetTracker || this.presetMarker || '').trim();
                if (preset) {
                    this.form.trackerName = preset;
                    this.lockByTrackerName();
                }
            }
            await Promise.all([this.loadTrackers(), this.loadCandidates()]);
            this.ready = true;
            if (!this.isEdit && this.form.trackerName) this.lockByTrackerName();
            this.scrollToTop();
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
                if (data) {
                    this.candidates = {
                        places: [], subjects: [], related: [], units: [], portions: [], tags: [], ...data,
                    };
                }
            } catch (e) {
                /* 候选失败不阻断表单 */
            }
        },
        /**
         * v1.3.5.9：把 attachments（files.id 数组）映射成可渲染的视图。
         * 缓存里没有的（例如从旧列表进来的、只存了 id 的老数据）再向后端补一次；
         * 拿不到也不报错 —— 退化成「第 n 个附件」的文件图标，不让表单崩。
         */
        loadAttachmentViews() {
            const ids = (this.form.attachments || []).slice(0, 30);
            this.attachmentViews = ids.map((id, i) => this.attachMap[id] || {
                fileId: id,
                url: '',
                thumbUrl: '',
                name: '',
                originalName: this.$t('reg.attachFallback', { n: i + 1 }),
                mediaKind: 'file',
            });
            const missing = ids.filter((id) => !this.attachMap[id]);
            if (missing.length) this.fetchAttachmentViews(missing);
        },
        async fetchAttachmentViews(ids) {
            try {
                const qs = new URLSearchParams({ ids: ids.join(',') });
                const res = await fetchWithAuth(`/api/reg/attachments?${qs.toString()}`);
                const list = await res.json().catch(() => []);
                for (const a of Array.isArray(list) ? list : []) {
                    if (a && a.fileId) this.attachMap[a.fileId] = a;
                }
                const cur = (this.form.attachments || []).slice(0, 30);
                this.attachmentViews = cur.map((id, i) => this.attachMap[id] || {
                    fileId: id,
                    url: '',
                    thumbUrl: '',
                    originalName: this.$t('reg.attachFallback', { n: i + 1 }),
                    mediaKind: 'file',
                });
            } catch (e) {
                /* 补图失败就保留占位 */
            }
        },
        /* ── 条目 ─────────────────────────────────────────────── */
        /** 条目候选：登记自己的条目表（按最近使用排序，后端已排好） */
        async queryTracker(q, cb) {
            const key = String(q || '').trim().toLowerCase();
            if (this.trackerCache[key]) {
                cb(this.trackerCache[key]);
                return;
            }
            const list = this.trackers
                .filter((t) => !key || String(t.name || '').toLowerCase().includes(key))
                .slice(0, 20)
                .map((t) => ({ value: t.name, tracker: t }));
            this.trackerCache[key] = list;
            cb(list);
        },
        onTrackerPicked(item) {
            if (item && item.tracker) this.applyTracker(item.tracker);
        },
        /** 手输名称恰好等于已有条目时也锁定口径；改成别的名字则解锁 */
        onTrackerInput() {
            const name = trimText(this.form.trackerName);
            const hit = this.trackers.find((t) => String(t.name) === name);
            if (hit) {
                if (hit.id !== this.form.trackerId) this.applyTracker(hit);
                return;
            }
            this.form.trackerId = '';
            this.locked = false;
        },
        lockByTrackerName() {
            const name = trimText(this.form.trackerName);
            if (!name) {
                this.form.trackerId = '';
                this.locked = false;
                return;
            }
            const hit = this.trackers.find((t) => String(t.name) === name);
            if (hit) {
                if (hit.id !== this.form.trackerId) this.applyTracker(hit);
                return;
            }
            this.form.trackerId = '';
            this.locked = false;
        },
        /**
         * 选中已有条目 → 类型 / 单位 / 分母全部锁定，使用该条目已定的口径。
         * （需求：选到已有条目时不许在表单里自定义，要改去「条目管理」改根源）
         */
        applyTracker(t) {
            if (!t) return;
            this.form.trackerId = t.id || '';
            this.form.trackerName = t.name || this.form.trackerName;
            this.form.valueType = t.valueType || 'flow';
            /* v1.3.5.9：性质不再跟随条目（它是每条登记自己的事） */
            this.form.unit = t.unit || '';
            this.form.portion = t.portion || '';
            this.locked = true;
        },
        /* ── 其它候选 ─────────────────────────────────────────── */
        suggestFrom(key, q, cb) {
            const kw = String(q || '').trim().toLowerCase();
            const arr = (this.candidates && this.candidates[key]) || [];
            cb(arr.filter((v) => !kw || String(v).toLowerCase().includes(kw)).slice(0, 20).map((v) => ({ value: v })));
        },
        /* ── 附件：选择文件 / 本地上传 / 链接提取 ──────────────── */
        onPickedFiles(files) {
            for (const f of files || []) {
                const id = String(f.id || f.src || '');
                if (!id) continue;
                this.cacheAttachment({
                    fileId: id,
                    url: String(f.url || f.src || ''),
                    thumbUrl: String(f.thumbUrl || ''),
                    name: String(f.name || ''),
                    originalName: String(f.originalName || f.name || ''),
                    mime: String(f.mime || ''),
                    mediaKind: String(f.mediaKind || ''),
                });
            }
            const ids = (files || []).map((f) => String(f.id || f.src || '')).filter(Boolean);
            const set = new Set([...(this.form.attachments || []), ...ids]);
            this.form.attachments = Array.from(set).slice(0, 30);
            this.loadAttachmentViews();
        },
        /** 缓存一条附件视图；mediaKind 缺失时按 mime 猜（后端没给就是本地选的旧数据） */
        cacheAttachment(view) {
            if (!view || !view.fileId) return;
            const kind = view.mediaKind || this.kindOfMime(view.mime);
            this.attachMap[view.fileId] = {
                ...view,
                mediaKind: kind,
                thumbUrl: view.thumbUrl || (kind === 'image' ? view.url : ''),
            };
        },
        kindOfMime(mime) {
            const m = String(mime || '').toLowerCase();
            if (!m) return 'file';
            if (m.startsWith('image/')) return 'image';
            if (m.startsWith('video/')) return 'video';
            if (m.startsWith('audio/')) return 'audio';
            return 'file';
        },
        /**
         * v1.3.5.9：登记数值输入约束 —— 最多 4 位小数，并按性质限制正负。
         * 直接写回 form.amount（el-input 的 @input 拿到的就是当前字符串）。
         */
        onAmountInput(v) {
            let str = String(v === undefined || v === null ? '' : v);
            const neg = str.trim().startsWith('-');
            str = str.replace(/[^\d.]/g, '');
            /* 只留第一个小数点，小数最多 4 位 */
            const dot = str.indexOf('.');
            if (dot >= 0) {
                str = `${str.slice(0, dot)}.${str.slice(dot + 1).replace(/\./g, '').slice(0, 4)}`;
            }
            const dir = Number(this.form.direction) || 0;
            let next = str;
            if (dir === 1) next = str;
            else if (dir === -1) next = str ? `-${str}` : (neg ? '-' : '');
            else next = `${neg && str ? '-' : ''}${str}`;
            if (next !== v) this.form.amount = next;
        },
        /** 切换性质时把已输入的数值掰到对应符号 */
        syncAmountSign() {
            const raw = String(this.form.amount === undefined || this.form.amount === null ? '' : this.form.amount).trim();
            if (!raw || raw === '-' || raw === '+') return;
            const n = Number(raw.replace(/[,\s]/g, ''));
            if (!Number.isFinite(n)) return;
            const dir = Number(this.form.direction) || 0;
            if (dir === 1 && n < 0) this.form.amount = String(Math.abs(n));
            else if (dir === -1 && n > 0) this.form.amount = `-${Math.abs(n)}`;
        },
        /** v1.3.5.9：每次打开都回到顶部（标题位置），别停在上次滚到的地方 */
        scrollToTop() {
            this.$nextTick(() => {
                const f = this.$refs.regForm;
                if (f && typeof f.scrollTop === 'number') f.scrollTop = 0;
                const body = this.$el && this.$el.querySelector ? this.$el.querySelector('.reg-body') : null;
                if (body) body.scrollTop = 0;
            });
        },
        removeAttachment(i) {
            const list = this.form.attachments.slice();
            list.splice(i, 1);
            this.form.attachments = list;
            this.loadAttachmentViews();
        },
        prepareTarget() {
            this.uploadPrefill = {
                channelId: '',
                instanceId: this.instanceId || '',
                uploadFolder: defaultUploadFolder('register'),
                uploadSource: 'Attachment',
            };
        },
        pickLocalFile() {
            this.$refs.fileInput && this.$refs.fileInput.click();
        },
        onLocalFilesChosen(e) {
            const files = Array.from((e.target && e.target.files) || []);
            e.target.value = '';
            if (!files.length) return;
            this.pendingLink = '';
            this.pendingFiles = files;
            this.uploadHint = this.$t('reg.uploadHint', { n: files.length });
            this.prepareTarget();
            this.targetVisible = true;
        },
        extractLink() {
            this.$prompt(this.$t('notes.linkTip'), this.$t('notes.linkExtract'), {
                confirmButtonText: this.$t('notes.linkTransfer'),
                cancelButtonText: this.$t('common.cancel'),
                inputPlaceholder: 'https://example.com/a.jpg',
                inputType: 'textarea',
                inputAttributes: { rows: 4 },
                inputValidator: (v) => {
                    const s = String(v || '').trim();
                    if (!s) return this.$t('notes.linkEmpty');
                    if (!/^https?:\/\//i.test(s)) return this.$t('notes.linkInvalid');
                    return true;
                },
            })
                .then(({ value }) => {
                    this.pendingFiles = [];
                    this.pendingLink = String(value || '').trim();
                    this.uploadHint = '';
                    this.prepareTarget();
                    this.targetVisible = true;
                })
                .catch(() => {});
        },
        async onTargetConfirm(target) {
            this.targetVisible = false;
            if (this.pendingLink) return this.transferLink(target);
            return this.uploadLocalFiles(target);
        },
        async transferLink(target) {
            const url = this.pendingLink;
            this.pendingLink = '';
            if (!url) return;
            this.uploading = true;
            try {
                const hit = await importUrlToBed(url, target, { source: 'Attachment' });
                this.addAttachmentFromBed(hit);
                this.$message.success(this.$t('notes.linkOk'));
            } catch (e) {
                this.$message.error(this.$t('notes.linkFail', { msg: e.message || '' }));
            } finally {
                this.uploading = false;
            }
        },
        /** 串行上传：避免同时打满带宽，也让失败数可读 */
        async uploadLocalFiles(target) {
            const files = this.pendingFiles.slice();
            this.pendingFiles = [];
            if (!files.length) return;
            this.uploading = true;
            let ok = 0;
            let fail = 0;
            for (const f of files) {
                try {
                    const hit = await uploadOne(f, target, { source: 'Attachment' });
                    this.addAttachmentFromBed({ ...hit, originalName: hit.originalName || f.name || '' });
                    ok += 1;
                } catch (err) {
                    fail += 1;
                }
            }
            this.uploading = false;
            if (fail) this.$message.error(this.$t('notes.uploadPartial', { ok, fail }));
            else if (ok) this.$message.success(this.$t('notes.uploadOk', { n: ok }));
        },
        addAttachmentFromBed(hit) {
            const id = String((hit && (hit.fileId || hit.id)) || '');
            if (!id) return;
            const src = String((hit && (hit.src || hit.url)) || '');
            this.cacheAttachment({
                fileId: id,
                url: src,
                thumbUrl: String((hit && hit.thumbUrl) || ''),
                name: String((hit && hit.name) || ''),
                originalName: String((hit && hit.originalName) || (hit && hit.name) || ''),
                mime: String((hit && (hit.mime || hit.type)) || ''),
                mediaKind: String((hit && hit.mediaKind) || ''),
            });
            const set = new Set([...(this.form.attachments || []), id]);
            this.form.attachments = Array.from(set).slice(0, 30);
            this.loadAttachmentViews();
        },
        /* ── 文档 ─────────────────────────────────────────────── */
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
        /* ── 标签：空格 = 回车 ─────────────────────────────────── */
        onTagKeydown(e) {
            if (!e || (e.key !== ' ' && e.key !== 'Spacebar' && e.keyCode !== 32)) return;
            // 中文输入法组字时空格是选字键，绝不能抢
            if (e.isComposing) return;
            const el = e.target;
            if (!el || el.tagName !== 'INPUT') return;
            if (!String(el.value || '').trim()) return;
            e.preventDefault();
            e.stopPropagation();
            el.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true,
                }),
            );
        },
        /* ── 提交 ─────────────────────────────────────────────── */
        /** 点「保存」→ 先让浏览器真的提交一次表单（记忆历史值），再由 submit() 校验入库 */
        requestSubmit() {
            const f = this.$refs.regForm;
            if (f && typeof f.requestSubmit === 'function') f.requestSubmit();
            else this.submit();
        },
        async submit() {
            /* v1.3.5.9：条目 / 发生时间 / 登记数值三项必填（数值可以填 0，但不能空着） */
            const trackerName = trimText(this.form.trackerName);
            if (!trackerName) {
                this.$message.warning(this.$t('reg.itemRequired'));
                return;
            }
            if (!this.form.occurredAt) {
                this.$message.warning(this.$t('reg.timeRequired'));
                return;
            }
            const amountRaw = trimText(this.form.amount);
            if (amountRaw === '' || amountRaw === '-' || amountRaw === '+') {
                this.$message.warning(this.$t('reg.amountRequired'));
                return;
            }
            const amountNum = Number(amountRaw.replace(/[,\s]/g, ''));
            if (!Number.isFinite(amountNum)) {
                this.$message.warning(this.$t('reg.amountInvalid'));
                return;
            }
            /* v1.3.5.9：支持 4 位小数（多余的截掉，不让浮点尾巴进库） */
            const amount = Math.round(amountNum * 10000) / 10000;
            const qtyRaw = trimText(this.form.quantity);
            const quantity = qtyRaw === '' ? 1 : Number(qtyRaw.replace(/[,\s]/g, ''));
            if (!Number.isFinite(quantity) || quantity === 0) {
                this.$message.warning(this.$t('reg.quantityInvalid'));
                return;
            }
            this.saving = true;
            try {
                const body = {
                    trackerId: this.form.trackerId || '',
                    trackerName,
                    valueType: this.form.valueType,
                    direction: Number(this.form.direction) || 0,
                    unit: trimText(this.form.unit),
                    portion: trimText(this.form.portion),
                    instanceId: this.instanceId || '',
                    title: trimText(this.form.title),
                    event: trimText(this.form.event),
                    occurredAt: this.form.occurredAt ? new Date(this.form.occurredAt).getTime() : Date.now(),
                    startAt: this.form.startAt ? new Date(this.form.startAt).getTime() : null,
                    dueAt: this.form.dueAt ? new Date(this.form.dueAt).getTime() : null,
                    subjectName: trimText(this.form.subjectName),
                    relatedName: trimText(this.form.relatedName),
                    placeName: trimText(this.form.placeName),
                    amount,
                    quantity,
                    currency: this.form.currency === 'NONE' ? '' : (this.form.currency || ''),
                    tags: (this.form.tags || []).map((t) => trimText(t)).filter(Boolean),
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
        fmtTime(ms) {
            const d = new Date(Number(ms) || 0);
            if (!ms || !Number.isFinite(d.getTime())) return '—';
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        },
        onClosed() {
            this.form = emptyForm();
            this.trackerCache = {};
            this.pendingFiles = [];
            this.pendingLink = '';
        },
    },
};
</script>

<style scoped>
.reg-body {
    max-height: 68vh;
    overflow-y: auto;
    /* v1.3.5.9：移动端只允许附件按钮行自己横向滑动，页面本身不许左右晃 */
    overflow-x: hidden;
    text-align: left;
}

/*
 * v1.3.5.7：按参考图改成「表格化」布局 —— 6 列栅格，整行 span 6、
 * 两列 span 3、三列 span 2。单元格自己画右边框 / 下边框，容器画上 + 左，
 * 拼出来就是整张表格，且不会出现 2px 的重叠线。
 */
.reg-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    border-top: 1px solid var(--el-border-color);
    border-left: 1px solid var(--el-border-color);
    border-radius: 8px;
    overflow: hidden;
}

.reg-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 6px 10px 8px;
    border-right: 1px solid var(--el-border-color);
    border-bottom: 1px solid var(--el-border-color);
    transition: background 0.15s ease;
}

.reg-cell:focus-within {
    background: var(--el-fill-color-lighter);
}

.reg-span-6 { grid-column: span 6; }
.reg-span-3 { grid-column: span 3; }
.reg-span-2 { grid-column: span 2; }

.reg-cell-label {
    font-size: 12px;
    line-height: 16px;
    color: var(--el-text-color-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.reg-cell-label em {
    color: var(--el-color-danger);
    font-style: normal;
}

.reg-cell-hint {
    margin-top: 2px;
    font-size: 11px;
    color: var(--el-text-color-placeholder);
    font-variant-numeric: tabular-nums;
}

.reg-full {
    width: 100%;
}

/* 表格里的输入框去掉自己的边框，只留单元格的表格线（与参考图一致） */
.reg-plain {
    width: 100%;
}

/*
 * 注意：这里必须挂在 .reg-cell 上，不能挂在 .reg-plain 上 ——
 * el-autocomplete / el-date-picker 是「透传 attrs」的组件，class 落到了根节点，
 * 但作用域 id（data-v-xxx）没有跟着落下去，`.reg-plain[data-v]` 选择器会全部失配，
 * 结果自动完成框和时间框还留着自带的边框与白底。挂在原生 div 的 .reg-cell 上才稳定。
 */
.reg-cell :deep(.el-input__wrapper),
.reg-cell :deep(.el-select__wrapper) {
    padding: 0 2px;
    background: transparent;
    box-shadow: none !important;
}

.reg-cell :deep(.el-input__inner),
.reg-cell :deep(.el-select__placeholder),
.reg-cell :deep(.el-select__selected-item) {
    font-size: 13px;
    color: var(--el-text-color-primary);
}

/* 详情：内容超出后自动增高，最高 30vh（超出部分内部滚动） */
.reg-cell :deep(.el-textarea__inner) {
    padding: 0 2px;
    background: transparent;
    box-shadow: none !important;
    resize: none;
    font-size: 13px;
    line-height: 1.6;
    max-height: 30vh;
    overflow-y: auto;
}

/* v1.3.5.8：附件按钮在表格外，默认换行排列 */
.reg-file-btns {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 10px;
}

.reg-file-input {
    display: none;
}

.reg-btn-icon {
    margin-right: 5px;
}

.reg-attach-icon {
    color: var(--el-color-primary);
}

.reg-attach-count,
.reg-doc-name {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* v1.3.5.9：附件缩略图（复刻瞬间编辑页：88px 正方形、圆角 8、铺满裁切） */
.reg-assets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
}

.reg-asset {
    position: relative;
    width: 88px;
    height: 88px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--note-cell-bg, rgba(127, 127, 127, 0.12));
}

.reg-asset-img {
    width: 100%;
    height: 100%;
    display: block;
}

.reg-asset-img :deep(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.reg-asset-cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 100%;
    height: 100%;
    padding: 6px;
    box-sizing: border-box;
    color: var(--el-text-color-secondary);
    font-size: 16px;
}

.reg-asset-name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    text-align: center;
    word-break: break-all;
    font-size: 10.5px;
    line-height: 1.35;
}

.reg-asset-del {
    position: absolute;
    top: 2px;
    right: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 9px;
    line-height: 1;
    cursor: pointer;
}

.reg-attach-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
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
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
}

/* v1.3.5.8：附件数量靠左，按钮仍在右侧 */
.reg-footer .reg-attach-count {
    margin-right: auto;
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

/* 窄屏：两列 / 三列并排会让输入框只剩几十像素，统一改成整行 */
@media (max-width: 560px) {
    .reg-span-3,
    .reg-span-2 {
        grid-column: span 6;
    }

    .reg-body {
        max-height: 72vh;
    }

    /*
     * v1.3.5.8：附件按钮在移动端必须保持一行（选择文件 / 本地上传 / 链接数据 / 挂载文档），
     * 不换行、可左右滑动；左右边距收小以多挤出一截可视宽度。
     */
    .reg-file-btns {
        flex-wrap: nowrap;
        overflow-x: auto;
        overflow-y: hidden;
        gap: 6px;
        margin-inline: -2px;
        padding: 0 2px 2px;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
    }

    .reg-file-btns::-webkit-scrollbar {
        display: none;
    }

    .reg-file-btns :deep(.el-button) {
        flex: 0 0 auto;
        margin-left: 0;
        padding: 7px 10px;
    }

    /* 移动端缩略图略小，一行能放下 4 个 */
    .reg-asset {
        width: 72px;
        height: 72px;
    }
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
