<template>
    <!--
        发布 / 编辑瞬间
        ----------------------------------------------------------------------------
        结构（对齐需求）：
          标题输入框（自动填日期时间）→ 心情 / 天气 / 位置 → 纯文本正文（500 字上限）
          → 附件九宫格预览（可删、可拖拽排序、可箭头微调）→ 标签 → 可见性 → 发布

        「添加附件」两条路径：
          ① 从图床选：打开 FilePickerDialog（走 /api/notes/files，只读）
          ② 本地上传：选文件 → UploadTargetDialog（目标渠道/实例/目录）→ POST /upload
             → 拿到 File_ID 直接入列（后端创建时会把它解析成 files.id 落库）

        字数：只数汉字 / 字母 / 数字，与后端 countTextChars 完全同一套规则。
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
            <!-- 标题：自动填日期时间（可改），下方是心情 / 天气 / 位置 -->
            <el-input
                ref="titleInput"
                v-model="form.title"
                class="mp-title"
                :placeholder="$t('notes.titlePlaceholder')"
                maxlength="80"
            />
            <div class="mp-meta-row">
                <div class="mp-picker">
                    <button
                        v-for="m in moodOptions"
                        :key="m.value"
                        type="button"
                        class="mp-emoji"
                        :class="{ 'is-active': form.mood === m.value }"
                        :title="$t(m.label)"
                        @click="toggleMood(m.value)"
                    >{{ m.emoji }}</button>
                </div>
                <div class="mp-picker">
                    <button
                        v-for="w in weatherOptions"
                        :key="w.value"
                        type="button"
                        class="mp-emoji"
                        :class="{ 'is-active': form.weather === w.value }"
                        :title="$t(w.label)"
                        @click="toggleWeather(w.value)"
                    >{{ w.emoji }}</button>
                </div>
            </div>
            <el-input
                v-model="form.location"
                class="mp-location"
                size="small"
                :placeholder="$t('notes.locationPlaceholder')"
                maxlength="80"
            >
                <template #prefix>
                    <font-awesome-icon icon="globe" class="mp-location-icon" />
                </template>
            </el-input>

            <!-- 正文 -->
            <div class="mp-editor-wrap">
                <textarea
                    ref="textarea"
                    v-model="form.content"
                    class="mp-textarea"
                    :placeholder="$t('notes.contentPlaceholder')"
                    rows="6"
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
                    :class="{ 'is-dragging': dragIndex === i }"
                    draggable="true"
                    @dragstart="onDragStart(i, $event)"
                    @dragover.prevent="onDragOver(i)"
                    @dragend="onDragEnd"
                    @drop.prevent="onDrop(i)"
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
                </div>
            </div>

            <!-- 添加附件 -->
            <div class="mp-add-row">
                <el-button size="small" :loading="uploading" @click="openPicker">
                    <font-awesome-icon icon="images" class="mp-btn-icon" />{{ $t('notes.addFromBed') }}
                </el-button>
                <el-button size="small" :loading="uploading" @click="pickLocalFile">
                    <font-awesome-icon icon="upload" class="mp-btn-icon" />{{ $t('notes.uploadLocal') }}
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

        <!-- 从图床选 -->
        <FilePickerDialog
            v-model="pickerVisible"
            :instance-id="instanceId"
            :exclude-ids="pickedFileIds"
            @confirm="onPicked"
        />

        <!-- 本地上传：目标渠道 / 实例 / 目录（复用现成组件，不重写一套） -->
        <UploadTargetDialog
            v-model="targetVisible"
            :busy="uploading"
            :hint="uploadHint"
            @confirm="onTargetConfirm"
        />
    </el-dialog>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import thumbUrl from '@/utils/thumb';
import UploadTargetDialog from '@/components/upload/UploadTargetDialog.vue';
import FilePickerDialog from './FilePickerDialog.vue';
import {
    MOOD_OPTIONS,
    WEATHER_OPTIONS,
    MOMENT_MAX_CHARS,
    MAX_ASSETS_PER_NOTE,
    countTextChars,
    formatSize,
    mediaKindOfMime
} from '@/utils/notes';

/** 标题默认值：日期 + 时间（需求：进入编辑页自动填充） */
function defaultTitle() {
    const d = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 周${week} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
            pendingFiles: [],
            dragIndex: -1,
            moodOptions: MOOD_OPTIONS,
            weatherOptions: WEATHER_OPTIONS
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
            return window.innerWidth < 768 ? '94%' : '620px';
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
            return this.pendingFiles.length > 1
                ? this.$t('notes.uploadingFiles', { n: this.pendingFiles.length })
                : '';
        }
    },
    watch: {
        visible(v) {
            if (v) this.$nextTick(() => this.$refs.textarea && this.$refs.textarea.focus());
        }
    },
    methods: {
        async onOpen() {
            this.reset();
            if (this.isEdit) {
                this.fillFromNote(this.note);
            }
            this.loadTags();
        },
        onClosed() {
            this.assets = [];
            this.pendingFiles = [];
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
        /** 编辑态回填：标题从 metas 里取（历史数据没有就按时间生成） */
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
        async loadTags() {
            try {
                const res = await fetchWithAuth(`/api/notes/tags?instanceId=${encodeURIComponent(this.instanceId || '')}`);
                const data = await res.json().catch(() => []);
                this.tagOptions = Array.isArray(data) ? data : [];
            } catch (e) {
                this.tagOptions = [];
            }
        },
        toggleMood(v) {
            this.form.mood = this.form.mood === v ? '' : v;
        },
        toggleWeather(v) {
            this.form.weather = this.form.weather === v ? '' : v;
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
                this.assets.push({
                    fileId: f.id,
                    url: f.url,
                    thumbUrl: f.thumbUrl,
                    originalName: f.originalName,
                    name: f.name,
                    mime: f.mime,
                    mediaKind: f.mediaKind,
                    size: f.size
                });
            }
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

        /* ── 本地上传 ───────────────────────────────────────────── */
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
            this.pendingFiles = files.slice(0, room);
            this.targetVisible = true;
        },
        /** 上传目标确认后逐个上传（串行：避免同时打满带宽，也让进度可读） */
        async onTargetConfirm(target) {
            this.targetVisible = false;
            const files = this.pendingFiles.slice();
            this.pendingFiles = [];
            if (!files.length) return;
            this.uploading = true;
            let ok = 0;
            let fail = 0;
            for (const f of files) {
                try {
                    const qs = new URLSearchParams();
                    if (target.channelId) qs.set('channelId', target.channelId);
                    if (target.instanceId) qs.set('instanceId', target.instanceId);
                    if (target.uploadFolder) qs.set('uploadFolder', target.uploadFolder);
                    const fd = new FormData();
                    fd.append('file', f);
                    const res = await fetch(`/upload${qs.toString() ? `?${qs}` : ''}`, {
                        method: 'POST',
                        body: fd,
                        credentials: 'include'
                    });
                    const arr = await res.json().catch(() => null);
                    const hit = Array.isArray(arr) ? arr[0] : null;
                    if (!res.ok || !hit || !hit.id) throw new Error('upload failed');
                    const mime = f.type || '';
                    const kind = mediaKindOfMime(mime);
                    this.assets.push({
                        // 注意：/upload 返回的 id 是 File_ID（name），后端创建瞬间时会自动解析成 files.id
                        fileId: hit.id,
                        url: hit.src || '',
                        thumbUrl: kind === 'image' ? thumbUrl(hit.src, 320) : (hit.src || ''),
                        originalName: hit.name || f.name,
                        name: hit.name || f.name,
                        mime,
                        mediaKind: kind,
                        size: f.size
                    });
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
                const body = {
                    content: this.form.content,
                    mood: this.form.mood,
                    weather: this.form.weather,
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
                this.$message.success(this.isEdit ? this.$t('notes.saveOk') : this.$t('notes.publishOk'));
                this.visible = false;
                this.$emit('saved');
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
    max-height: 66vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-right: 2px;
}

.mp-title :deep(.el-input__inner) {
    font-size: 16px;
    font-weight: 600;
}

.mp-meta-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

.mp-picker {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 4px;
    border-radius: 8px;
    background: var(--note-tabs-bg, rgba(127, 127, 127, 0.08));
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

.mp-emoji.is-active {
    background: var(--note-emoji-active, rgba(64, 158, 255, 0.16));
    opacity: 1;
    filter: none;
    transform: scale(1.06);
}

.mp-location {
    max-width: 260px;
}

.mp-location-icon {
    font-size: 12px;
    opacity: 0.6;
}

.mp-editor-wrap {
    position: relative;
}

.mp-textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 120px;
    padding: 10px 12px 26px;
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: 14px;
    line-height: 1.7;
    resize: vertical;
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

.mp-assets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
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

.mp-tags-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
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

@media (max-width: 768px) {
    .mp-body {
        max-height: 60vh;
    }

    .mp-asset {
        width: 72px;
        height: 72px;
    }

    .mp-location {
        max-width: 100%;
        width: 100%;
    }
}
</style>
