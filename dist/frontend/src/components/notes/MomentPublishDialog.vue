<template>
    <!--
        发布 / 编辑瞬间（v1.1.2 改版）
        ----------------------------------------------------------------------------
        结构：
          标题（自动填「日期 + 星期」）→ 心情 / 天气 / 位置
          → 纯文本正文（1000 字上限，只数中文 / 字母 / 数字）
          → 附件九宫格（可删、可拖拽排序、可箭头微调）→ 标签 / 可见性 → 发布

        v1.1.2 变更点（对照需求）：
          · 弹窗高度 = 窗口 96%，正文输入框吃掉中间多出来的空间
          · 标题默认值去掉「时间点」，只剩 `2026-11-10 周二`
          · 点心情 / 天气图标时在下方浮出中文名称，2 秒后自动消失；
            同时把名称（moodName / weatherName）随发布写进数据表，供以后筛选统计
          · 正文上限 500 → 1000（口径不变：标点 / 符号 / 数字以外的…… 都按字符计）
          · 「位置」输入框保留，并升级成「带历史记忆的输入框」——
            发布过的地点会记在浏览器里，下次点开输入框就能从最近的记录里挑
          · 「从图床选择」→「图床选择」
          · 「本地上传」后面新增「链接提取」：填直链 → 转存 → 选目标渠道 / 实例 / 目录
          · 关闭（含 Esc / 点遮罩）后把未发布的内容留在浏览器里，下次打开自动恢复

        「添加附件」三条路径，最终都落到同一个 assets 数组：
          ① 图床选择：FilePickerDialog（走 /api/notes/files，只读）
          ② 本地上传：选文件 → UploadTargetDialog → uploadOne()
          ③ 链接提取：填链接 → UploadTargetDialog → importUrlToBed()
        ／②③ 都带 `uploadSource=Attachment`，文件详情里能看到「附件上传」这个来源。
    -->
    <el-dialog
        v-model="visible"
        :title="isEdit ? $t('notes.editTitle') : $t('notes.publishTitle')"
        :width="dialogWidth"
        append-to-body
        class="moment-publish-dialog"
        :close-on-click-modal="false"
        @open="onOpen"
        @closed="onClosed"
    >
        <div class="mp-body">
            <!-- 草稿恢复提示：只在「新建 + 有草稿」时出现一次 -->
            <div v-if="draftRestored" class="mp-draft-tip">
                <font-awesome-icon icon="history" class="mp-draft-icon" />
                <span class="mp-draft-text">{{ $t('notes.draftRestored') }}</span>
                <button type="button" class="mp-draft-act" @click="discardDraft">{{ $t('notes.draftDiscard') }}</button>
                <button type="button" class="mp-draft-close" :title="$t('common.close')" @click="draftRestored = false">
                    <font-awesome-icon icon="times" />
                </button>
            </div>

            <!-- 标题：自动填「日期 + 星期」（可改） -->
            <el-input
                ref="titleInput"
                v-model="form.title"
                class="mp-title"
                :placeholder="$t('notes.titlePlaceholder')"
                maxlength="80"
            />

            <!--
                心情 / 天气（v1.1.3）
                ------------------------------------------------------------------
                桌面端 / 平板：一行图标，点一下在**图标上方**浮出名称（2 秒后淡出）；
                手机端（< 768px，不含平板）：换成两个下拉页 —— 心情在左、天气在右，
                未选时的占位文字分别是「设置心情」「设置天气」，展开后每一项都是「图标 + 名称」。
                两套控件的值都绑定 form.mood / form.weather，提交时一并把中文名称
                （moodName / weatherName）写进数据表，做筛选统计时不用再翻译枚举值。
            -->
            <div class="mp-meta-mobile">
                <el-select
                    v-model="form.mood"
                    class="mp-meta-select"
                    size="small"
                    clearable
                    :placeholder="$t('notes.setMood')"
                    popper-class="mp-meta-popper"
                >
                    <el-option v-for="m in moodOptions" :key="'mm-' + m.value" :label="nameOf(m)" :value="m.value">
                        <span class="mp-opt">
                            <span class="mp-opt-emoji">{{ m.emoji }}</span>
                            <span class="mp-opt-name">{{ nameOf(m) }}</span>
                        </span>
                    </el-option>
                </el-select>
                <el-select
                    v-model="form.weather"
                    class="mp-meta-select"
                    size="small"
                    clearable
                    :placeholder="$t('notes.setWeather')"
                    popper-class="mp-meta-popper"
                >
                    <el-option v-for="w in weatherOptions" :key="'mw-' + w.value" :label="nameOf(w)" :value="w.value">
                        <span class="mp-opt">
                            <span class="mp-opt-emoji">{{ w.emoji }}</span>
                            <span class="mp-opt-name">{{ nameOf(w) }}</span>
                        </span>
                    </el-option>
                </el-select>
            </div>

            <div class="mp-meta-row mp-meta-desktop">
                <div class="mp-picker">
                    <span v-for="m in moodOptions" :key="m.value" class="mp-emoji-wrap">
                        <button
                            type="button"
                            class="mp-emoji"
                            :class="{ 'is-active': form.mood === m.value }"
                            :aria-label="nameOf(m)"
                            @click="toggleMood(m)"
                        >{{ m.emoji }}</button>
                        <transition name="mp-tip">
                            <span v-if="tipKey === 'mood:' + m.value" class="mp-name-tip">{{ nameOf(m) }}</span>
                        </transition>
                    </span>
                </div>
                <div class="mp-picker">
                    <span v-for="w in weatherOptions" :key="w.value" class="mp-emoji-wrap">
                        <button
                            type="button"
                            class="mp-emoji"
                            :class="{ 'is-active': form.weather === w.value }"
                            :aria-label="nameOf(w)"
                            @click="toggleWeather(w)"
                        >{{ w.emoji }}</button>
                        <transition name="mp-tip">
                            <span v-if="tipKey === 'weather:' + w.value" class="mp-name-tip">{{ nameOf(w) }}</span>
                        </transition>
                    </span>
                </div>
            </div>

            <!-- 位置：保留输入框，并记住最近输入过的地点，下次可直接挑（需求：浏览器记忆） -->
            <el-autocomplete
                v-model="form.location"
                class="mp-location"
                size="small"
                :fetch-suggestions="queryLocation"
                :placeholder="$t('notes.locationPlaceholder')"
                :trigger-on-focus="true"
                clearable
                maxlength="80"
                popper-class="mp-location-popper"
            >
                <template #prefix>
                    <font-awesome-icon icon="globe" class="mp-location-icon" />
                </template>
            </el-autocomplete>

            <!-- 正文（吃掉剩余空间） -->
            <div class="mp-editor-wrap">
                <textarea
                    ref="textarea"
                    v-model="form.content"
                    class="mp-textarea"
                    :placeholder="$t('notes.contentPlaceholder')"
                ></textarea>
                <div class="mp-counter" :class="{ 'is-over': charCount > maxChars }">
                    {{ charCount }} / {{ maxChars }}
                </div>
            </div>

            <!-- 已选附件 -->
            <div v-if="assets.length" class="mp-assets">
                <div
                    v-for="(a, i) in assets"
                    :key="a.fileId + '-' + i"
                    class="mp-asset"
                    :class="{ 'is-dragging': dragIndex === i, 'is-pressable': longPressDragging }"
                    :data-asset-index="i"
                    draggable="true"
                    @dragstart="onDragStart(i, $event)"
                    @dragover.prevent="onDragOver(i)"
                    @dragend="onDragEnd"
                    @drop.prevent="onDrop(i)"
                    @pointerdown="onAssetPointerDown(i, $event)"
                    @pointermove="onAssetPointerMove($event)"
                    @pointerup="onAssetPointerUp"
                    @pointercancel="onAssetPointerUp"
                >
                    <img v-if="a.mediaKind === 'image'" :src="a.thumbUrl || a.url" class="mp-asset-img" alt="" />
                    <span v-else class="mp-asset-cover">
                        <font-awesome-icon :icon="a.mediaKind === 'video' ? 'film' : (a.mediaKind === 'audio' ? 'music' : 'file')" />
                        <span class="mp-asset-name">{{ a.originalName }}</span>
                    </span>
                    <button type="button" class="mp-asset-del" :title="$t('notes.removeAsset')" @click.stop="removeAsset(i)">
                        <font-awesome-icon icon="times" />
                    </button>
                    <!-- 触屏没有拖拽手柄，用左右微调按钮（桌面端也保留，作为无障碍替代） -->
                    <span class="mp-asset-move">
                        <button type="button" :disabled="i === 0" :title="$t('notes.moveLeft')" @click.stop="moveAsset(i, -1)">◀</button>
                        <button type="button" :disabled="i === assets.length - 1" :title="$t('notes.moveRight')" @click.stop="moveAsset(i, 1)">▶</button>
                    </span>
                    <span v-if="i === 0 && assets.length > 1" class="mp-asset-cover-tag">{{ $t('notes.coverBadge') }}</span>
                    <!-- v1.1.3：触屏用户可以长按任意附件拖动换位（桌面端直接拖） -->
                    <span v-if="longPressDragging && dragIndex === i" class="mp-asset-drag-hint">
                        <font-awesome-icon icon="arrows-alt" />
                    </span>
                </div>
            </div>

            <!-- 添加附件：图床选择 / 本地上传 / 链接提取 -->
            <div class="mp-add-row">
                <el-button size="small" :loading="uploading" @click="openPicker">
                    <font-awesome-icon icon="images" class="mp-btn-icon" />{{ $t('notes.addFromBed') }}
                </el-button>
                <el-button size="small" :loading="uploading" @click="pickLocalFile">
                    <font-awesome-icon icon="upload" class="mp-btn-icon" />{{ $t('notes.uploadLocal') }}
                </el-button>
                <el-button size="small" :loading="uploading" @click="extractLink">
                    <font-awesome-icon icon="link" class="mp-btn-icon" />{{ $t('notes.linkExtract') }}
                </el-button>
                <span v-if="assets.length" class="mp-asset-count">
                    {{ $t('notes.assetCount', { n: assets.length }) }}
                </span>
                <input
                    ref="fileInput"
                    type="file"
                    class="mp-file-input"
                    multiple
                    accept="image/*,video/*,audio/*"
                    @change="onLocalFilesChosen"
                />
            </div>

            <!-- 标签 -->
            <div class="mp-tags-row">
                <el-select
                    v-model="form.tagNames"
                    class="mp-tags"
                    size="small"
                    multiple
                    filterable
                    allow-create
                    default-first-option
                    :reserve-keyword="false"
                    :placeholder="$t('notes.tagPlaceholder')"
                >
                    <el-option v-for="t in tagOptions" :key="t.id" :label="t.name" :value="t.name">
                        <span class="mp-tag-opt">{{ t.name }}</span>
                        <span class="mp-tag-count">{{ t.count }}</span>
                    </el-option>
                </el-select>
                <el-select v-model="form.visibility" class="mp-visibility" size="small">
                    <el-option :label="$t('notes.visibilityPrivate')" value="private" />
                    <el-option :label="$t('notes.visibilityPublic')" value="public" />
                </el-select>
            </div>
        </div>

        <template #footer>
            <div class="mp-footer">
                <span class="mp-tip">{{ footerTip }}</span>
                <div class="mp-footer-btns">
                    <el-button size="small" @click="visible = false">{{ $t('common.cancel') }}</el-button>
                    <el-button
                        size="small"
                        type="primary"
                        :loading="submitting"
                        :disabled="!canSubmit"
                        @click="submit"
                    >{{ isEdit ? $t('common.save') : $t('notes.publish') }}</el-button>
                </div>
            </div>
        </template>

        <!-- 图床选择 -->
        <FilePickerDialog
            v-model="pickerVisible"
            :instance-id="instanceId"
            :exclude-ids="pickedFileIds"
            @confirm="onPicked"
        />

        <!-- 上传目标：本地上传 / 链接提取共用同一个通用弹窗 -->
        <UploadTargetDialog
            v-model="targetVisible"
            :busy="uploading"
            :hint="uploadHint"
            :prefill="uploadPrefill"
            @confirm="onTargetConfirm"
        />
    </el-dialog>
</template>

<script>
import thumbUrl from '@/utils/thumb';
import fetchWithAuth from '@/utils/fetchWithAuth';
import UploadTargetDialog from '@/components/upload/UploadTargetDialog.vue';
import FilePickerDialog from './FilePickerDialog.vue';
import { defaultUploadFolder, uploadOne, importUrlToBed } from '@/utils/uploadTarget';
import {
    MOOD_OPTIONS,
    WEATHER_OPTIONS,
    MOMENT_MAX_CHARS,
    MAX_ASSETS_PER_NOTE,
    countTextChars,
    mediaKindOfMime
} from '@/utils/notes';

/**
 * 标题默认值：`2026-11-10 周二`。
 * v1.1.2 按需求去掉了「时间点」（时分），只留日期与星期 ——
 * 瞬间本来就是按天归档的内容，标题带时分反而更难扫。
 */
function defaultTitle() {
    return titleOf(Date.now());
}

/** 同一个格式，按指定时间生成（草稿里记着「当时」的标题，用来判断是否需要刷新） */
function titleOf(ts) {
    const d = new Date(Number(ts) || Date.now());
    const pad = (v) => String(v).padStart(2, '0');
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 周${week}`;
}

/** 草稿键：按实例隔离，切实例不会串内容 */
const draftKeyOf = (instanceId) => `gohub:note-draft:moment:${instanceId || 'default'}`;

/**
 * 位置记忆键（v1.1.2）：
 * 发布成功时把地点记进浏览器，下次打开编辑页点位置输入框就能直接挑最近的记录。
 * 同样按实例隔离 —— 不同实例往往是不同站点/不同用途，地点列表混在一起没有意义。
 */
const locationKeyOf = (instanceId) => `gohub:note-locations:${instanceId || 'default'}`;
/** 最多记多少个地点（太多反而不好挑） */
const LOCATION_MAX = 20;

/** 心情 / 天气名称提示的显示时长（需求：2 秒后消失） */
const NAME_TIP_MS = 2000;

export default {
    name: 'MomentPublishDialog',
    components: { UploadTargetDialog, FilePickerDialog },
    props: {
        modelValue: { type: Boolean, default: false },
        /** 编辑时传入原始笔记对象；新建时为 null */
        note: { type: Object, default: null },
        instanceId: { type: String, default: '' }
    },
    emits: ['update:modelValue', 'saved'],
    data() {
        return {
            form: {
                title: '',
                content: '',
                mood: '',
                weather: '',
                location: '',
                visibility: 'private',
                tagNames: []
            },
            // 已选附件（顺序即九宫格顺序）
            assets: [],
            tagOptions: [],
            maxChars: MOMENT_MAX_CHARS,
            submitting: false,
            uploading: false,
            pickerVisible: false,
            targetVisible: false,
            /** 上传目标回填值（打开弹窗前按当前时间生成，跨月不会还填上个月） */
            uploadPrefill: { channelId: '', instanceId: '', uploadFolder: '' },
            /** 待上传的本地文件 */
            pendingFiles: [],
            /** 待转存的链接（与 pendingFiles 二选一） */
            pendingLink: '',
            dragIndex: -1,
            moodOptions: MOOD_OPTIONS,
            weatherOptions: WEATHER_OPTIONS,
            // v1.1.3：触屏长按拖动排序
            longPressDragging: false,
            /** 当前浮出名称的图标：「mood:happy」 */
            tipKey: '',
            /** 最近用过的地点（位置输入框的记忆，存在浏览器里） */
            locationHistory: [],
            /** 本次打开是否恢复过草稿 */
            draftRestored: false
        };
    },
    computed: {
        visible: {
            get() {
                return this.modelValue;
            },
            set(v) {
                this.$emit('update:modelValue', v);
            }
        },
        dialogWidth() {
            return window.innerWidth < 768 ? '94%' : '640px';
        },
        isEdit() {
            return !!(this.note && this.note.id);
        },
        charCount() {
            return countTextChars(this.form.content);
        },
        canSubmit() {
            if (this.submitting || this.uploading) return false;
            if (this.charCount > this.maxChars) return false;
            // 允许「只有附件没有文字」，但不能两者都空
            return !!this.form.content.trim() || this.assets.length > 0;
        },
        footerTip() {
            if (this.charCount > this.maxChars) {
                return this.$t('notes.charOver', { n: this.charCount - this.maxChars });
            }
            if (!this.form.content.trim() && !this.assets.length) {
                return this.$t('notes.needContent');
            }
            return '';
        },
        pickedFileIds() {
            // 排除已经加进来的（后端按 files.id 或 File_ID 都能识别，两个都排除一次更稳）
            return this.assets.map((a) => a.fileId);
        },
        uploadHint() {
            if (this.pendingLink) return this.$t('notes.linkUploading');
            return this.pendingFiles.length > 1
                ? this.$t('notes.uploadingFiles', { n: this.pendingFiles.length })
                : '';
        }
    },
    watch: {
        visible(v) {
            if (v) this.$nextTick(() => this.$refs.textarea && this.$refs.textarea.focus());
        },
        /* 草稿自动保存：改什么都记一笔（防抖 400ms），关掉浏览器也不丢 */
        'form.title': 'scheduleSave',
        'form.content': 'scheduleSave',
        'form.mood': 'scheduleSave',
        'form.weather': 'scheduleSave',
        'form.location': 'scheduleSave',
        'form.visibility': 'scheduleSave',
        'form.tagNames': {
            deep: true,
            handler: 'scheduleSave'
        },
        assets: {
            deep: true,
            handler: 'scheduleSave'
        }
    },
    beforeUnmount() {
        // v1.1.3：长按计时器必须清掉，否则弹窗关了还会在 320ms 后改一次状态
        if (this._pressTimer) {
            window.clearTimeout(this._pressTimer);
            this._pressTimer = null;
        }
    },
    methods: {
        /** 心情 / 天气的中文（当前语言）名称 */
        nameOf(opt) {
            try {
                const v = this.$t(opt.label);
                return v && v !== opt.label ? v : opt.emoji;
            } catch (e) {
                return opt.emoji;
            }
        },

        /* ── 生命周期 ───────────────────────────────────────────── */
        async onOpen() {
            this.skipDraftSave = false;
            this.draftRestored = false;
            this.reset();
            this.loadLocationHistory();
            if (this.isEdit) {
                this.fillFromNote(this.note);
            } else {
                this.restoreDraft();
            }
            this.loadTags();
        },
        onClosed() {
            // 关闭（含 Esc / 点遮罩 / 点取消）都留草稿；只有「发布成功」才跳过
            if (!this.skipDraftSave) this.saveDraft();
            this.skipDraftSave = false;
            this.pendingFiles = [];
            this.pendingLink = '';
            this.dragIndex = -1;
            this.clearNameTip();
        },
        reset() {
            this.form = {
                title: defaultTitle(),
                content: '',
                mood: '',
                weather: '',
                location: '',
                visibility: 'private',
                tagNames: []
            };
            this.assets = [];
        },
        /** 编辑态回填：标题从历史数据取（老数据没有标题就按当天生成） */
        fillFromNote(note) {
            const m = note.moment || {};
            this.form = {
                title: (note.title || '').trim() || defaultTitle(),
                content: note.content || '',
                mood: m.mood || '',
                weather: m.weather || '',
                location: m.location || '',
                visibility: note.visibility || 'private',
                tagNames: (note.tags || []).map((t) => t.name)
            };
            this.assets = (note.assets || []).map((a) => ({
                fileId: a.fileId,
                url: a.url,
                thumbUrl: a.thumbUrl,
                originalName: a.originalName,
                name: a.name,
                mime: a.mime,
                mediaKind: a.mediaKind,
                size: a.size
            }));
        },

        /* ── 草稿（浏览器记忆） ─────────────────────────────────── */
        scheduleSave() {
            if (!this.visible || this.isEdit || this.skipDraftSave) return;
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this.saveDraft(), 400);
        },
        saveDraft() {
            if (!this.visible || this.isEdit) return;
            try {
                const empty = !this.form.content.trim() && !this.assets.length && !this.form.tagNames.length;
                if (empty) {
                    window.localStorage.removeItem(draftKeyOf(this.instanceId));
                    return;
                }
                const payload = {
                    title: this.form.title,
                    content: this.form.content,
                    mood: this.form.mood,
                    weather: this.form.weather,
                    location: this.form.location,
                    visibility: this.form.visibility,
                    tagNames: this.form.tagNames,
                    assets: this.assets,
                    savedAt: Date.now()
                };
                window.localStorage.setItem(draftKeyOf(this.instanceId), JSON.stringify(payload));
            } catch (e) {
                /* 隐私模式 / 配额满：草稿是锦上添花，失败不该拦住发布 */
            }
        },
        restoreDraft() {
            let raw = '';
            try {
                raw = window.localStorage.getItem(draftKeyOf(this.instanceId)) || '';
            } catch (e) {
                raw = '';
            }
            if (!raw) return;
            let d = null;
            try {
                d = JSON.parse(raw);
            } catch (e) {
                d = null;
            }
            if (!d || (!String(d.content || '').trim() && !(d.assets || []).length)) {
                this.clearDraftStorage();
                return;
            }
            this.form = {
                // 标题留空或还是「草稿当时」的自动值时，按当前日期重算，避免草稿标题过期
                title: d.title && d.title !== titleOf(d.savedAt) ? d.title : defaultTitle(),
                content: d.content || '',
                mood: d.mood || '',
                weather: d.weather || '',
                location: d.location || '',
                visibility: d.visibility || 'private',
                tagNames: Array.isArray(d.tagNames) ? d.tagNames : []
            };
            this.assets = Array.isArray(d.assets) ? d.assets : [];
            this.draftRestored = true;
        },
        clearDraftStorage() {
            try {
                window.localStorage.removeItem(draftKeyOf(this.instanceId));
            } catch (e) {
                /* 忽略 */
            }
        },
        /** 提示条上的「丢弃」：连内容一起清掉，等于重新写 */
        discardDraft() {
            this.clearDraftStorage();
            this.reset();
            this.draftRestored = false;
            this.$nextTick(() => this.$refs.textarea && this.$refs.textarea.focus());
        },

        /* ── 位置记忆 ───────────────────────────────────────────── */
        loadLocationHistory() {
            try {
                const raw = window.localStorage.getItem(locationKeyOf(this.instanceId)) || '[]';
                const arr = JSON.parse(raw);
                this.locationHistory = Array.isArray(arr)
                    ? arr.filter((x) => typeof x === 'string' && x.trim()).slice(0, LOCATION_MAX)
                    : [];
            } catch (e) {
                this.locationHistory = [];
            }
        },
        /** el-autocomplete 的建议源：输入即按关键字过滤，不输入就按最近顺序全列出来 */
        queryLocation(queryString, cb) {
            const q = String(queryString || '').trim().toLowerCase();
            const pool = this.locationHistory;
            const hit = q ? pool.filter((x) => x.toLowerCase().includes(q)) : pool;
            cb(hit.map((v) => ({ value: v })));
        },
        /** 发布成功后记一笔（最近的排前面、同名去重、最多 LOCATION_MAX 条） */
        rememberLocation(v) {
            const val = String(v || '').trim();
            if (!val) return;
            const next = [val, ...this.locationHistory.filter((x) => x !== val)].slice(0, LOCATION_MAX);
            this.locationHistory = next;
            try {
                window.localStorage.setItem(locationKeyOf(this.instanceId), JSON.stringify(next));
            } catch (e) {
                /* 隐私模式 / 配额满：记不住就算了，不影响发布 */
            }
        },

        async loadTags() {
            try {
                const res = await fetchWithAuth(`/api/notes/tags?instanceId=${encodeURIComponent(this.instanceId || '')}`);
                const data = await res.json().catch(() => []);
                this.tagOptions = Array.isArray(data) ? data : [];
            } catch (e) {
                this.tagOptions = [];
            }
        },

        /* ── 心情 / 天气：名称提示 ─────────────────────────────── */
        showNameTip(kind, value) {
            this.tipKey = `${kind}:${value}`;
            clearTimeout(this._tipTimer);
            this._tipTimer = setTimeout(() => {
                this.tipKey = '';
            }, NAME_TIP_MS);
        },
        clearNameTip() {
            clearTimeout(this._tipTimer);
            this.tipKey = '';
        },
        toggleMood(opt) {
            this.showNameTip('mood', opt.value);
            this.form.mood = this.form.mood === opt.value ? '' : opt.value;
        },
        toggleWeather(opt) {
            this.showNameTip('weather', opt.value);
            this.form.weather = this.form.weather === opt.value ? '' : opt.value;
        },

        /* ── 附件：增删排序 ─────────────────────────────────────── */
        openPicker() {
            if (this.assets.length >= MAX_ASSETS_PER_NOTE) {
                this.$message.warning(this.$t('notes.assetLimit', { n: MAX_ASSETS_PER_NOTE }));
                return;
            }
            this.pickerVisible = true;
        },
        onPicked(files) {
            for (const f of files) {
                if (this.assets.length >= MAX_ASSETS_PER_NOTE) break;
                if (this.assets.some((a) => a.fileId === f.id)) continue;
                this.assets.push(this.assetFromBed(f));
            }
        },
        /** 图床返回项 → 附件结构（三处上传路径统一这一份映射） */
        assetFromBed(hit, fallbackSize) {
            const mime = hit.mime || hit.type || '';
            const kind = hit.mediaKind || mediaKindOfMime(mime);
            return {
                // 注意：/upload 返回的 id 是 File_ID（name），后端创建瞬间时会自动解析成 files.id
                fileId: hit.id,
                url: hit.src || hit.url || '',
                thumbUrl: kind === 'image' ? thumbUrl(hit.src || hit.url, 320) : (hit.src || hit.url || ''),
                originalName: hit.originalName || hit.name || '',
                name: hit.name || '',
                mime,
                mediaKind: kind,
                size: Number(hit.size) || Number(fallbackSize) || 0
            };
        },
        removeAsset(i) {
            this.assets.splice(i, 1);
        },
        moveAsset(i, delta) {
            const j = i + delta;
            if (j < 0 || j >= this.assets.length) return;
            const list = this.assets.slice();
            const [item] = list.splice(i, 1);
            list.splice(j, 0, item);
            this.assets = list;
        },
        onDragStart(i, e) {
            this.dragIndex = i;
            try {
                e.dataTransfer.effectAllowed = 'move';
                // Firefox 需要设置数据才会真正开始拖拽
                e.dataTransfer.setData('text/plain', String(i));
            } catch (err) {
                /* 忽略 */
            }
        },
        onDragOver(i) {
            if (this.dragIndex < 0 || this.dragIndex === i) return;
            this.moveAsset(this.dragIndex, i - this.dragIndex);
            this.dragIndex = i;
        },
        onDrop() {
            this.dragIndex = -1;
        },
        onDragEnd() {
            this.dragIndex = -1;
        },

        /* ── 触屏长按拖动排序（v1.1.3） ─────────────────────────
         * 桌面端用原生 HTML5 拖拽（上面那三个方法）；
         * 触屏没有 dragstart，改成「按住 320ms → 跟随手指 → 经过谁就换到谁的位置」。
         * 移动超过 8px 视为「用户在滚动」，立刻取消计时，不会误触。
         */
        onAssetPointerDown(i, e) {
            // 鼠标走原生拖拽，不重复处理
            if (e.pointerType === 'mouse') return;
            const el = e.currentTarget;
            this._pressStart = { x: e.clientX, y: e.clientY };
            this._pressTarget = el;
            this._pressTimer = window.setTimeout(() => {
                this._pressTimer = null;
                this.longPressDragging = true;
                this.dragIndex = i;
                // 轻微振动反馈（支持才震，iOS 不支持就静默）
                if (navigator.vibrate) navigator.vibrate(8);
                try {
                    el.setPointerCapture(e.pointerId);
                } catch (err) {
                    /* 老浏览器忽略 */
                }
                // 长按之后要阻止页面跟着滚
                if (el.style) el.style.touchAction = 'none';
            }, 320);
        },
        onAssetPointerMove(e) {
            if (this._pressTimer && this._pressStart) {
                const dx = Math.abs(e.clientX - this._pressStart.x);
                const dy = Math.abs(e.clientY - this._pressStart.y);
                if (dx > 8 || dy > 8) {
                    window.clearTimeout(this._pressTimer);
                    this._pressTimer = null;
                }
            }
            if (!this.longPressDragging || this.dragIndex < 0) return;
            // 手指下的元素 → 是哪一个附件格
            const hit = document.elementFromPoint(e.clientX, e.clientY);
            const target = hit && hit.closest ? hit.closest('.mp-asset') : null;
            if (!target) return;
            const to = Number(target.getAttribute('data-asset-index'));
            if (!Number.isFinite(to) || to === this.dragIndex) return;
            this.moveAsset(this.dragIndex, to - this.dragIndex);
            this.dragIndex = to;
        },
        onAssetPointerUp() {
            if (this._pressTimer) {
                window.clearTimeout(this._pressTimer);
                this._pressTimer = null;
            }
            if (this._pressTarget && this._pressTarget.style) this._pressTarget.style.touchAction = '';
            this._pressTarget = null;
            this.longPressDragging = false;
            this.dragIndex = -1;
        },

        /* ── 上传目标（通用弹窗） ───────────────────────────────── */
        /** 打开前重算默认目录：/瞬间/2026/11 */
        prepareTarget() {
            this.uploadPrefill = {
                channelId: '',
                instanceId: this.instanceId || '',
                uploadFolder: defaultUploadFolder('moment')
            };
        },

        /* ① 本地上传 */
        pickLocalFile() {
            this.$refs.fileInput && this.$refs.fileInput.click();
        },
        onLocalFilesChosen(e) {
            const files = Array.from((e.target && e.target.files) || []);
            e.target.value = '';
            if (!files.length) return;
            // 超出上限的部分直接丢掉，避免用户白等
            const room = MAX_ASSETS_PER_NOTE - this.assets.length;
            if (room <= 0) {
                this.$message.warning(this.$t('notes.assetLimit', { n: MAX_ASSETS_PER_NOTE }));
                return;
            }
            this.pendingLink = '';
            this.pendingFiles = files.slice(0, room);
            this.prepareTarget();
            this.targetVisible = true;
        },

        /* ② 链接提取 */
        extractLink() {
            if (this.assets.length >= MAX_ASSETS_PER_NOTE) {
                this.$message.warning(this.$t('notes.assetLimit', { n: MAX_ASSETS_PER_NOTE }));
                return;
            }
            this.$prompt(this.$t('notes.linkTip'), this.$t('notes.linkExtract'), {
                confirmButtonText: this.$t('notes.linkTransfer'),
                cancelButtonText: this.$t('common.cancel'),
                inputPlaceholder: 'https://example.com/a.jpg',
                inputType: 'textarea',
                inputValidator: (v) => {
                    const s = String(v || '').trim();
                    if (!s) return this.$t('notes.linkEmpty');
                    if (!/^https?:\/\//i.test(s)) return this.$t('notes.linkInvalid');
                    return true;
                }
            })
                .then(({ value }) => {
                    this.pendingFiles = [];
                    this.pendingLink = String(value || '').trim();
                    this.prepareTarget();
                    this.targetVisible = true;
                })
                .catch(() => {});
        },

        /** 上传目标确认后：分「本地文件」与「链接转存」两条路 */
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
                this.assets.push(this.assetFromBed(hit));
                this.$message.success(this.$t('notes.linkOk'));
            } catch (e) {
                this.$message.error(this.$t('notes.linkFail', { msg: e.message || '' }));
            } finally {
                this.uploading = false;
            }
        },
        /** 本地文件串行上传：避免同时打满带宽，也让进度可读 */
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
                    this.assets.push(this.assetFromBed({ ...hit, mime: f.type || '' }, f.size));
                    ok += 1;
                } catch (err) {
                    fail += 1;
                }
            }
            this.uploading = false;
            if (fail) this.$message.error(this.$t('notes.uploadPartial', { ok, fail }));
            else if (ok) this.$message.success(this.$t('notes.uploadOk', { n: ok }));
        },

        /* ── 提交 ───────────────────────────────────────────────── */
        async submit() {
            if (!this.canSubmit) return;
            this.submitting = true;
            try {
                const moodOpt = MOOD_OPTIONS.find((m) => m.value === this.form.mood);
                const weatherOpt = WEATHER_OPTIONS.find((w) => w.value === this.form.weather);
                const body = {
                    content: this.form.content,
                    mood: this.form.mood,
                    // 名称快照：枚举值以后可能增删，名称独立存一列，筛选统计都不会因为改图标而错乱
                    moodName: moodOpt ? this.nameOf(moodOpt) : '',
                    weather: this.form.weather,
                    weatherName: weatherOpt ? this.nameOf(weatherOpt) : '',
                    location: this.form.location,
                    visibility: this.form.visibility,
                    assetIds: this.assets.map((a) => a.fileId),
                    tagNames: this.form.tagNames,
                    instanceId: this.instanceId || '',
                    // 标题暂存在 metas（本版瞬间不落 title 列，文章版本才需要）
                    title: this.form.title
                };
                const url = this.isEdit ? `/api/notes/${encodeURIComponent(this.note.id)}` : '/api/notes';
                const res = await fetchWithAuth(url, {
                    method: this.isEdit ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                // 发布成功 → 把地点记进浏览器，下次打开可直选
                this.rememberLocation(this.form.location);
                // 发布成功 → 草稿作废，别再恢复出「已经发过」的内容
                this.clearDraftStorage();
                this.skipDraftSave = true;
                this.$message.success(this.isEdit ? this.$t('notes.saveOk') : this.$t('notes.publishOk'));
                this.visible = false;
                // 带上 id：调用方（比如首页「记录」页）据此把刚发布的这一条拉回来展示
                this.$emit('saved', { id: data.id || '', edit: this.isEdit });
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            } finally {
                this.submitting = false;
            }
        }
    }
};
</script>

<style scoped>
.mp-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1 1 auto;
    min-height: 0;
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-right: 2px;
}

/* ── 草稿提示 ─────────────────────────────────────────────── */
.mp-draft-tip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.1));
    color: var(--el-color-primary);
    font-size: 12px;
    flex: 0 0 auto;
}

.mp-draft-icon {
    font-size: 12px;
}

.mp-draft-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.mp-draft-act {
    padding: 2px 8px;
    border: 1px solid currentColor;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
}

.mp-draft-act:hover {
    background: var(--el-color-primary-light-8, rgba(64, 158, 255, 0.2));
}

.mp-draft-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    font-size: 10px;
    opacity: 0.7;
    cursor: pointer;
}

.mp-draft-close:hover {
    opacity: 1;
}

/* ── 标题 ─────────────────────────────────────────────────── */
.mp-title {
    flex: 0 0 auto;
}

.mp-title :deep(.el-input__inner) {
    font-size: 16px;
    font-weight: 600;
}

/* ── 心情 / 天气 ──────────────────────────────────────────── */
.mp-meta-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    flex: 0 0 auto;
}

.mp-picker {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 4px;
    border-radius: 8px;
    background: var(--note-tabs-bg, rgba(127, 127, 127, 0.08));
}

/* 每个图标自带一个定位容器，名称提示相对它浮出 */
.mp-emoji-wrap {
    position: relative;
    display: inline-flex;
}

.mp-emoji {
    padding: 2px 4px;
    border: none;
    border-radius: 6px;
    background: transparent;
    font-size: 16px;
    line-height: 1.2;
    cursor: pointer;
    filter: grayscale(0.7);
    opacity: 0.6;
    transition: all 0.15s ease;
}

.mp-emoji:hover {
    opacity: 1;
    filter: none;
}

/*
 * 选中态（v1.1.3）：底色明显加深 + 描边 + 轻微投影。
 * 原来只有 16% 透明度的蓝底，在深色 / 浅色主题下都太淡，用户点完看不出选没选中。
 */
.mp-emoji.is-active {
    background: var(--note-emoji-active, rgba(64, 158, 255, 0.34));
    box-shadow: inset 0 0 0 1.5px var(--el-color-primary), 0 1px 4px rgba(64, 158, 255, 0.28);
    opacity: 1;
    filter: none;
    transform: scale(1.1);
}

/*
 * 名称提示（v1.1.3）：从「图标正下方」改到**图标正上方**（需求原文）。
 * 位置用 bottom: calc(100% + 4px) —— 直接用负 top 在图标高低不一时会飘。
 */
.mp-name-tip {
    position: absolute;
    bottom: calc(100% + 4px);
    top: auto;
    left: 50%;
    transform: translateX(-50%);
    z-index: 8;
    padding: 2px 7px;
    border: 1px solid var(--el-border-color-light, rgba(127, 127, 127, 0.2));
    border-radius: 6px;
    background: var(--el-bg-color-overlay, #fff);
    color: var(--el-text-color-primary);
    font-size: 11px;
    line-height: 1.5;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.14);
    pointer-events: none;
}

.mp-tip-enter-active,
.mp-tip-leave-active {
    transition: opacity 0.18s ease, transform 0.18s ease;
}

.mp-tip-enter-from,
.mp-tip-leave-to {
    opacity: 0;
    transform: translateX(-50%) translateY(-3px);
}

/* ── 位置 ─────────────────────────────────────────────────── */
.mp-location {
    max-width: 280px;
    flex: 0 0 auto;
}

.mp-location-icon {
    font-size: 12px;
    opacity: 0.6;
}

/* ── 正文 ─────────────────────────────────────────────────── */
.mp-editor-wrap {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    min-height: 150px;
}

.mp-textarea {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-height: 150px;
    padding: 10px 12px 26px;
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: 14px;
    line-height: 1.7;
    resize: none;
    outline: none;
    transition: border-color 0.2s ease;
}

.mp-textarea:focus {
    border-color: var(--el-color-primary);
}

.mp-counter {
    position: absolute;
    right: 10px;
    bottom: 6px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    pointer-events: none;
}

.mp-counter.is-over {
    color: var(--el-color-danger);
    font-weight: 600;
}

/* ── 附件 ─────────────────────────────────────────────────── */
.mp-assets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex: 0 0 auto;
}

.mp-asset {
    position: relative;
    width: 88px;
    height: 88px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--note-cell-bg, rgba(127, 127, 127, 0.12));
    cursor: grab;
}

.mp-asset.is-dragging {
    opacity: 0.5;
}

.mp-asset-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.mp-asset-cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    width: 100%;
    height: 100%;
    padding: 6px;
    box-sizing: border-box;
    color: var(--el-text-color-secondary);
    font-size: 11px;
}

.mp-asset-name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    text-align: center;
    word-break: break-all;
}

.mp-asset-del {
    position: absolute;
    top: 2px;
    right: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 10px;
    cursor: pointer;
}

.mp-asset-del:hover {
    background: var(--el-color-danger);
}

.mp-asset-move {
    position: absolute;
    left: 2px;
    bottom: 2px;
    display: flex;
    gap: 2px;
}

.mp-asset-move button {
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.5);
    color: #fff;
    font-size: 8px;
    line-height: 1;
    cursor: pointer;
}

.mp-asset-move button:disabled {
    opacity: 0.3;
    cursor: default;
}

.mp-asset-cover-tag {
    position: absolute;
    left: 2px;
    top: 2px;
    padding: 0 4px;
    border-radius: 3px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 10px;
}

.mp-add-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    flex: 0 0 auto;
}

.mp-btn-icon {
    margin-right: 4px;
    font-size: 12px;
}

.mp-asset-count {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.mp-file-input {
    display: none;
}

/* ── 标签 / 可见性 ────────────────────────────────────────── */
.mp-tags-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    flex: 0 0 auto;
}

.mp-tags {
    flex: 1 1 220px;
    min-width: 180px;
}

.mp-visibility {
    width: 110px;
}

.mp-tag-opt {
    float: left;
}

.mp-tag-count {
    float: right;
    color: var(--el-text-color-secondary);
    font-size: 12px;
}

/* ── 底部 ─────────────────────────────────────────────────── */
.mp-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
}

.mp-tip {
    font-size: 12px;
    color: var(--el-color-danger);
}

.mp-footer-btns {
    display: flex;
    gap: 8px;
    margin-left: auto;
}

/* ── 心情 / 天气的手机版下拉（v1.1.3） ───────────────────────── */
.mp-meta-mobile {
    display: none;
    gap: 8px;
    flex: 0 0 auto;
}

.mp-meta-select {
    flex: 1 1 0;
    min-width: 0;
}

.mp-opt {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

.mp-opt-emoji {
    font-size: 16px;
    line-height: 1;
}

.mp-opt-name {
    font-size: 13px;
}

/* 长按拖动时的「抓手」角标 */
.mp-asset-drag-hint {
    position: absolute;
    inset: auto 0 0 0;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 16px;
    border-radius: 0 0 8px 8px;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
    font-size: 10px;
    pointer-events: none;
}

.mp-asset.is-pressable {
    /* 长按后不再让浏览器滚动页面，手指才能稳定拖动 */
    touch-action: none;
}

@media (max-width: 767.98px) {
    /*
     * 手机（不含平板）：心情 / 天气改成两个下拉页，一行两个 —— 左边心情、右边天气。
     * 图标行在手机上隐藏（20 个图标挤成两行，指头点不准）。
     */
    .mp-meta-mobile {
        display: flex;
    }

    .mp-meta-desktop {
        display: none;
    }

    /*
     * 「选择文件 / 本地上传 / 链接提取」三个按钮：左右外边距收小 + 横向可滑动，
     * 保证在窄屏上仍然是**一行**（需求原文）。
     */
    .mp-add-row {
        flex-wrap: nowrap;
        gap: 6px;
        overflow-x: auto;
        margin: 2px -4px;
        padding: 2px 4px;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
    }

    .mp-add-row::-webkit-scrollbar {
        display: none;
    }

    .mp-add-row :deep(.el-button) {
        margin-left: 0 !important;
        flex: 0 0 auto;
        padding: 6px 9px;
        font-size: 12px;
    }

    .mp-asset-count {
        flex: 0 0 auto;
        white-space: nowrap;
    }
}

@media (max-width: 768px) {
    .mp-editor-wrap,
    .mp-textarea {
        min-height: 130px;
    }

    .mp-asset {
        width: 72px;
        height: 72px;
    }

    /* 手机上位置输入框独占一行，给足宽度方便看历史地点 */
    .mp-location {
        max-width: 100%;
        width: 100%;
    }
}
</style>

<style>
/*
 * 弹窗本体样式（非 scoped）
 * ----------------------------------------------------------------------------
 * el-dialog 的内容节点由 Element Plus 自己的组件渲染，且通过 teleport 挂到 body，
 * scoped 样式里的 :deep() 找不到宿主节点，所以这一段必须放到全局块里，
 * 只用 `.el-dialog.moment-publish-dialog` 这个双重类名限定范围，不会外溢到别的弹窗。
 *
 * 需求：编辑页高度 = 窗口的 96%。
 * 做法：把 dialog 变成纵向 flex，头部/底部固定，body 撑满剩余空间，
 * 再让内部 .mp-body 与正文输入框逐级 flex:1 —— 多出来的高度全部给主输入框。
 */
.el-dialog.moment-publish-dialog {
    display: flex;
    flex-direction: column;
    height: 96vh;
    max-height: 96vh;
    margin: 2vh auto;
}

.el-dialog.moment-publish-dialog .el-dialog__header {
    flex: 0 0 auto;
}

.el-dialog.moment-publish-dialog .el-dialog__body {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    padding-top: 6px;
    padding-bottom: 6px;
}

.el-dialog.moment-publish-dialog .el-dialog__footer {
    flex: 0 0 auto;
}
</style>
