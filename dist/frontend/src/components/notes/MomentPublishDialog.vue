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

            <!--
                v1.1.8（需求原文「把瞬间编辑的标题输入框和功能移除不要」）：
                瞬间不再有标题，输入框整块删掉。历史数据的 title 列保留不动
                （编辑老瞬间时原样带回，不会因为这次改动丢数据），但界面不再展示、也不再让改。
            -->

            <!--
                心情 / 天气（v1.1.3）
                ------------------------------------------------------------------
                全终端统一为「一行图标直选」：
                  · 点一下切换选中（再点一次取消），选中后图标上方浮出名称，2 秒淡出；
                  · 桌面端鼠标悬停图标也会浮出名称（v1.1.6，需求原文）；
                  · 手机端不再使用下拉框（v1.1.6 改回图标直选），图标区按屏幕宽度自动换行，
                    触控区放大到 32px，避免「挤成两行点不准」。
                两套控件的值都绑定 form.mood / form.weather，提交时一并把中文名称
                （moodName / weatherName）写进数据表，做筛选统计时不用再翻译枚举值。
            -->
            <div class="mp-meta-row mp-meta-desktop">
                <div class="mp-picker">
                    <!--
                        v1.1.9.1（需求：提示名称被顶部标题区遮挡）
                        名称提示不再渲染在图标内部：编辑页正文区（.mp-body）是滚动容器，
                        向上浮出的提示会被它裁掉（实测整块被切在可视区之外）。
                        现在改成「唯一一个 teleport 到 body 的浮层」（见文件末尾），
                        用 fixed 定位跟随当前图标 —— 既不会被裁，也不会被标题区盖住。
                    -->
                    <span
                        v-for="m in moodOptions"
                        :key="m.value"
                        class="mp-emoji-wrap"
                        @mouseenter="onNameEnter('mood:' + m.value, $event)"
                        @mouseleave="clearHover('mood:' + m.value)"
                    >
                        <button
                            type="button"
                            class="mp-emoji"
                            :class="{ 'is-active': form.mood === m.value }"
                            :aria-label="nameOf(m)"
                            :title="nameOf(m)"
                            @click="toggleMood(m, $event)"
                        >{{ m.emoji }}</button>
                    </span>
                </div>
                <div class="mp-picker">
                    <span
                        v-for="w in weatherOptions"
                        :key="w.value"
                        class="mp-emoji-wrap"
                        @mouseenter="onNameEnter('weather:' + w.value, $event)"
                        @mouseleave="clearHover('weather:' + w.value)"
                    >
                        <button
                            type="button"
                            class="mp-emoji"
                            :class="{ 'is-active': form.weather === w.value }"
                            :aria-label="nameOf(w)"
                            :title="nameOf(w)"
                            @click="toggleWeather(w, $event)"
                        >{{ w.emoji }}</button>
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
                    <font-awesome-icon icon="location-dot" class="mp-location-icon" />
                </template>
            </el-autocomplete>

            <!-- 正文（吃掉剩余空间） -->
            <div class="mp-editor-wrap">
                <textarea
                    ref="textarea"
                    v-model="form.content"
                    class="mp-textarea"
                    :placeholder="$t('notes.contentPlaceholder')"
                    @pointerup="syncEditorHeight"
                    @keyup="syncEditorHeight"
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
                <!--
                    v1.1.7：这里的「x 个附件」挪到页脚「取消」按钮左侧了（需求原文），
                    与「文件上传中」共用同一个位置 —— 上传时显示上传中，平时显示附件数。
                -->
                <!--
                    v1.1.4：不再限制 accept —— 手机相册 / 文件管理器只会按 accept 过滤，
                    填 image/*,video/*,audio/* 时很多机型干脆只列出图片，视频与其它文件
                    根本选不到。瞬间附件本来就支持任意文件类型，这里直接放开。
                -->
                <input
                    ref="fileInput"
                    type="file"
                    class="mp-file-input"
                    multiple
                    @change="onLocalFilesChosen"
                />
            </div>

            <!-- 标签 -->
            <div class="mp-tags-row">
                <!--
                    v1.1.7：
                      · placement="top" —— 下拉一律向上展开。标签行在编辑页最下方，
                        向下弹会被「取消 / 发布」按钮挡住，条目少的时候也一样。
                      · @keydown 接管空格 —— 与回车同效，把当前输入变成标签。
                -->
                <el-select
                    v-model="form.tagNames"
                    class="mp-tags"
                    size="small"
                    multiple
                    filterable
                    allow-create
                    default-first-option
                    placement="top"
                    :reserve-keyword="false"
                    :placeholder="$t('notes.tagPlaceholder')"
                    @keydown="onTagKeydown"
                >
                    <el-option v-for="t in tagOptions" :key="t.id" :label="t.name" :value="t.name">
                        <span class="mp-tag-opt">{{ t.name }}</span>
                        <span class="mp-tag-count">{{ t.count }}</span>
                    </el-option>
                </el-select>
                <!--
                    v1.1.9.4（需求）：「仅自己可见」改名「私密」，并在它下方新增「指定」。
                    私密 = 只有作者自己能看到（仍出现在「发布中心 → 瞬间」里）；
                    公开 = 同时出现在「瞬间」和「广场」，所有登录账户可看可留言；
                    指定 = 只给被指定的账户看（名单管理随后续版本提供，本版等同于更严格的私密）。
                -->
                <el-select v-model="form.visibility" class="mp-visibility" size="small">
                    <el-option :label="$t('notes.visibilityPrivate')" value="private" />
                    <el-option :label="$t('notes.visibilitySpecified')" value="specified" />
                    <el-option :label="$t('notes.visibilityPublic')" value="public" />
                </el-select>
            </div>
            <p v-if="form.visibility === 'specified'" class="mp-visibility-hint">
                {{ $t('notes.visibilitySpecifiedTip') }}
            </p>
        </div>

        <template #footer>
            <div class="mp-footer">
                <span class="mp-tip">{{ footerTip }}</span>
                <div class="mp-footer-btns">
                    <!--
                        v1.1.7：「取消」按钮左侧固定一个状态位 ——
                        上传中显示「文件上传中」并带旋转图标（与「本地上传」按钮同款）。
                        v1.1.9.3（需求）：这个位置改成「永远有内容」：
                          · 正文与附件都空 → 「写点什么，或发个照片」；
                          · 正文或附件有内容 → 「x 个附件」。
                    -->
                    <span
                        class="mp-attach-tip"
                        :class="{ 'is-empty': !uploading && !hasDraftContent }"
                    >
                        <font-awesome-icon v-if="uploading" icon="spinner" spin class="mp-attach-spin" />
                        {{ attachHintText }}
                    </span>
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

        <!--
            v1.1.9.1：心情 / 天气的名称提示 —— 全页唯一一个浮层，teleport 到 body。
            放在 el-dialog 里也没关系（Teleport 会把真实节点挂到 body 上），
            fixed 定位 + 高 z-index，既逃出了正文区的滚动裁切，也压得住标题区。
        -->
        <Teleport to="body">
            <transition name="mp-tip">
                <span v-if="tipText" class="mp-name-tip is-floating" :style="tipStyle">{{ tipText }}</span>
            </transition>
        </Teleport>
    </el-dialog>
</template>

<script>
import thumbUrl from '@/utils/thumb';
import fetchWithAuth from '@/utils/fetchWithAuth';
import UploadTargetDialog from '@/components/upload/UploadTargetDialog.vue';
import FilePickerDialog from './FilePickerDialog.vue';
import { defaultUploadFolder, uploadOne, importUrlToBed } from '@/utils/uploadTarget';
import { bindDialogLayers } from '@/utils/layerStack';
import {
    MOOD_OPTIONS,
    WEATHER_OPTIONS,
    MOMENT_MAX_CHARS,
    MAX_ASSETS_PER_NOTE,
    countTextChars,
    mediaKindOfMime
} from '@/utils/notes';

/*
 * v1.1.7：标题不再自动填「日期 + 星期」，defaultTitle / titleOf 两个helper 一并移除。
 * 卡片上标题为空时本来就会退回显示发布时间，所以留空不影响列表观感。
 */

/** 草稿键：按实例隔离，切实例不会串内容 */
const draftKeyOf = (instanceId) => `gohub:note-draft:moment:${instanceId || 'default'}`;

/**
 * v1.1.7：位置候选改成「数据表里的历史记录」，不再用浏览器 localStorage。
 *
 * 旧实现把地点写进本地存储，于是换设备 / 换浏览器就全丢了，也不跟着实例走。
 * 现在直接问后端 `GET /api/notes/locations`（只查当前账户 + 当前实例的瞬间），
 * 光标进入输入框时给最近的记录，敲字时按关键字过滤 —— 与标签输入框一样的交互。
 *
 * 候选结果按「查询词」缓存在本次弹窗生命周期内：同一个词来回删改不必重复请求，
 * 弹窗一关就清空（数据可能已经被别的设备改过）。
 */
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
            /** v1.1.6：鼠标悬停中的图标（桌面端悬停即显示名称，移走即收起） */
            hoverKey: '',
            /** v1.1.9.1：提示浮层的锚点（图标矩形的中心 x + 顶边 y），null = 还没定位过 */
            tipAnchor: null,
            /** 最近用过的地点（位置输入框的记忆，存在浏览器里） */
            // v1.1.7：位置候选（来自数据表），按查询词做一层会话内缓存
            locationCache: {},
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
        /**
         * v1.1.7：移动端宽度 94% → 98%（需求原文：宽高一起改 98%）。
         * 高度在样式表里按 98vh 处理，两端同改才算「一起」。
         */
        dialogWidth() {
            return window.innerWidth < 768 ? '98%' : '640px';
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
        /** v1.1.9.3：草稿里是否有内容（正文有字 或 有附件） */
        hasDraftContent() {
            return !!String(this.form.content || '').trim() || this.assets.length > 0;
        },
        /**
         * v1.1.9.3（需求）：「取消」按钮左侧的状态文案 ——
         *   上传中 → 「文件上传中」；
         *   有内容 → 「x 个附件」；
         *   全空   → 「写点什么，或发个照片」。
         */
        attachHintText() {
            if (this.uploading) return this.$t('notes.uploadingHint');
            if (this.hasDraftContent) return this.$t('notes.assetCount', { n: this.assets.length });
            return this.$t('notes.needContent');
        },
        footerTip() {
            /*
             * v1.1.7：「文件上传中」已经挪到「取消」左侧（与附件数共用那个位置），
             * 这里不再重复报一遍，只在字数超限时提示。
             */
            if (this.charCount > this.maxChars) {
                return this.$t('notes.charOver', { n: this.charCount - this.maxChars });
            }
            // v1.1.6：「写点什么，或发个照片」这句常驻提示已移除（需求原文），
            // 输入框内的 placeholder 保留，所以这里不再兜底任何文案。
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
        },
        /**
         * v1.1.9.1：当前该显示哪个名称提示。
         * 点击后的 2 秒提示（tipKey）优先，其次才是鼠标悬停项（hoverKey）。
         */
        tipText() {
            const key = this.tipKey || this.hoverKey;
            return key ? this.nameOfKey(key) : '';
        },
        /** 提示浮层的定位：图标上沿往上 4px，水平居中（配合 .is-floating 的 translate） */
        tipStyle() {
            const a = this.tipAnchor;
            if (!a) return { display: 'none' };
            return { left: `${a.cx}px`, top: `${a.top}px` };
        }
    },
    watch: {
        visible(v) {
            if (v) {
                this.$nextTick(() => this.$refs.textarea && this.$refs.textarea.focus());
            } else {
                // v1.1.9.1：关窗顺手收掉名称提示，避免浮层留在 body 上
                this.clearNameTip();
                this.hoverKey = '';
            }
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
    /*
     * v1.1.9.1：瞬间编辑页也登记成一层。
     * 它是覆盖整屏的表单弹窗，里面还会再开「链接提取」输入框 / 上传目标 / 图床选择，
     * 登记之后「先关里层、再关编辑页」的顺序才和视觉层级一致。
     */
    mounted() {
        this._layerUnbind = bindDialogLayers(this, {
            visible: { id: 'moment-publish', close: () => { this.visible = false; } }
        });
    },
    beforeUnmount() {
        // v1.1.3：长按计时器必须清掉，否则弹窗关了还会在 320ms 后改一次状态
        if (this._pressTimer) {
            window.clearTimeout(this._pressTimer);
            this._pressTimer = null;
        }
        if (this._layerUnbind) {
            this._layerUnbind();
            this._layerUnbind = null;
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
            // v1.1.7：位置候选每次打开都重新问后端，缓存只在本次弹窗内有效
            this.locationCache = {};
            if (this.isEdit) {
                this.fillFromNote(this.note);
            } else {
                this.restoreDraft();
            }
            this.loadTags();
            // v1.1.7：上次拉伸过的高度不要带到下一次
            this.$nextTick(() => this.resetEditorHeight());
        },
        /**
         * v1.1.7：正文输入框允许用户从右下角自由拉伸。
         * 原生 resize 只改 textarea 自己的行内高度，父容器不会跟着变高 ——
         * 后面的附件 / 标签就会压到输入框上。这里在松手（或打字）后把父容器的
         * min-height 同步成实际高度；低于默认下限时清空，交还给样式表的 45vh。
         */
        syncEditorHeight() {
            const el = this.$refs.textarea;
            const wrap = el && el.parentElement;
            if (!el || !wrap) return;
            const base = Math.max(180, window.innerHeight * 0.45);
            const h = el.offsetHeight;
            wrap.style.minHeight = h > base + 1 ? `${Math.round(h)}px` : '';
        },
        /** 重新打开弹窗时把上一次拉伸留下的行内高度清掉，回到 45vh 起点 */
        resetEditorHeight() {
            const el = this.$refs.textarea;
            if (el) el.style.height = '';
            const wrap = el && el.parentElement;
            if (wrap) wrap.style.minHeight = '';
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
                /* v1.1.7：新建时不再自动填标题（需求原文），交给用户自己写 */
                title: '',
                content: '',
                mood: '',
                weather: '',
                location: '',
                visibility: 'private',
                tagNames: []
            };
            this.assets = [];
        },
        /** 编辑态回填：标题照历史数据取；没有就留空（v1.1.7 起不再按当天生成） */
        fillFromNote(note) {
            const m = note.moment || {};
            this.form = {
                title: (note.title || '').trim(),
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
                // v1.1.7：标题由用户自己写，草稿里是什么就是什么（不再按日期重算）
                title: d.title || '',
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

        /* ── 位置候选（v1.1.7：数据表） ─────────────────────────────── */
        /**
         * el-autocomplete 的建议源。
         *   空串 = 光标刚进输入框，给「最近的记录」；
         *   有内容 = 按关键字在数据表里查同类记录。
         * 只查当前账户 + 当前实例，与标签输入框同一套隔离口径。
         */
        async queryLocation(queryString, cb) {
            const q = String(queryString || '').trim();
            const key = q.toLowerCase();
            if (this.locationCache[key]) {
                cb(this.locationCache[key]);
                return;
            }
            try {
                const params = new URLSearchParams({ instanceId: this.instanceId || '' });
                if (q) params.set('q', q);
                const res = await fetchWithAuth(`/api/notes/locations?${params.toString()}`);
                const data = await res.json().catch(() => []);
                const rows = Array.isArray(data) ? data : data.list || [];
                const list = rows
                    .filter((v) => typeof v === 'string' && v.trim())
                    .slice(0, LOCATION_MAX)
                    .map((v) => ({ value: v }));
                this.locationCache[key] = list;
                cb(list);
            } catch (e) {
                cb([]);
            }
        },

        /**
         * v1.1.7：标签输入框里按空格 = 按回车。
         *
         * el-select 的 allow-create 只在「回车」时把输入内容变成标签，空格会被当成普通字符
         * 输进筛选框（这也是英文标签名里的合法字符）。需求点名要空格也能成词，
         * 这里在输入框为空/纯空格时保持原样，有内容时拦下空格并合成一次回车事件，
         * 让 Element Plus 自己走「创建标签」那条原有逻辑 —— 不另外复制一份实现。
         */
        onTagKeydown(e) {
            if (!e || (e.key !== ' ' && e.key !== 'Spacebar' && e.keyCode !== 32)) return;
            // 中文输入法正在组字：空格是选字键，绝不能抢
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
                    cancelable: true
                })
            );
        },

        async loadTags() {            try {
                const res = await fetchWithAuth(`/api/notes/tags?instanceId=${encodeURIComponent(this.instanceId || '')}`);
                const data = await res.json().catch(() => []);
                this.tagOptions = Array.isArray(data) ? data : [];
            } catch (e) {
                this.tagOptions = [];
            }
        },

        /* ── 心情 / 天气：名称提示 ─────────────────────────────── */
        /** v1.1.6：点击后的 2 秒提示与鼠标悬停提示共用一套浮层 */
        tipVisible(key) {
            return this.tipKey === key || this.hoverKey === key;
        },
        clearHover(key) {
            if (this.hoverKey === key) this.hoverKey = '';
        },
        /** 「mood:happy」→ 对应中文名称（找不到就返回空串，浮层自动不显示） */
        nameOfKey(key) {
            const i = String(key || '').indexOf(':');
            if (i < 0) return '';
            const kind = key.slice(0, i);
            const value = key.slice(i + 1);
            const list = kind === 'mood' ? this.moodOptions : (kind === 'weather' ? this.weatherOptions : []);
            const opt = list.find((o) => o.value === value);
            return opt ? this.nameOf(opt) : '';
        },
        /**
         * v1.1.9.1：把提示浮层钉在这个图标上方。
         * 浮层是 fixed 定位的（挂在 body 上），所以必须记下图标此刻的视口坐标；
         * 用 getBoundingClientRect 而不是 offsetTop —— 正文区是滚动容器，offset 系不可靠。
         */
        anchorTip(el) {
            if (!el || typeof el.getBoundingClientRect !== 'function') return;
            const r = el.getBoundingClientRect();
            this.tipAnchor = { cx: Math.round(r.left + r.width / 2), top: Math.round(r.top - 4) };
        },
        /** 悬停：记显示项 + 钉住位置 */
        onNameEnter(key, e) {
            this.hoverKey = key;
            this.anchorTip(e && e.currentTarget);
        },
        showNameTip(kind, value, el) {
            this.tipKey = `${kind}:${value}`;
            this.anchorTip(el);
            clearTimeout(this._tipTimer);
            this._tipTimer = setTimeout(() => {
                this.tipKey = '';
            }, NAME_TIP_MS);
        },
        clearNameTip() {
            clearTimeout(this._tipTimer);
            this.tipKey = '';
        },
        toggleMood(opt, e) {
            this.showNameTip('mood', opt.value, e && e.currentTarget);
            this.form.mood = this.form.mood === opt.value ? '' : opt.value;
        },
        toggleWeather(opt, e) {
            this.showNameTip('weather', opt.value, e && e.currentTarget);
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
                /*
                 * v1.1.7：在上次「2 行 → 4 行」的基础上再 +2 行（4 行 → 6 行）。
                 * rows 走 inputAttributes 透传给原生 textarea；customClass 兜底，
                 * 以防 Element Plus 版本差异导致 rows 没落到元素上（样式见 .mp-link-prompt）。
                 */
                inputAttributes: { rows: 6 },
                customClass: 'mp-link-prompt',
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
    /* v1.1.4：只有「图床选择 / 本地上传 / 链接提取」那一行可以左右滑 ——
       body 一律禁止横向滚动，避免整页跟着手指左右晃 */
    overflow-x: hidden;
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

/*
 * v1.1.8：标题输入框已移除，.mp-title 的两条样式一并删掉
 * （留着只会是「找不到使用者的死样式」）。
 */

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
 *
 * v1.1.9.1（需求：提示名称被顶部标题区遮挡）：
 * 原来它是图标内部的绝对定位元素，而图标所在的正文档区是滚动容器 —— 向上浮出的
 * 那 23px 整个落在容器的裁切区之外，实测完全看不见（不是被标题盖住，是被裁掉）。
 * 现在它被 teleport 到 body，用 fixed 定位钉在图标上方：不参与任何裁剪，
 * 也不会被标题区、正文区盖住。z-index 取 6100（弹窗基准 4000，确认框 6200 之下）。
 */
.mp-name-tip {
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

/* 浮层定位（v1.1.9.1）：left/top 由 tipStyle 给出，这里的 translate 负责「水平居中 + 整体上移自身高度」 */
.mp-name-tip.is-floating {
    position: fixed;
    bottom: auto;
    left: 0;
    top: 0;
    transform: translate(-50%, -100%);
    z-index: 6100;
}

.mp-tip-enter-active,
.mp-tip-leave-active {
    transition: opacity 0.18s ease, transform 0.18s ease;
}

.mp-tip-enter-from.mp-name-tip.is-floating,
.mp-tip-leave-to.mp-name-tip.is-floating {
    opacity: 0;
    transform: translate(-50%, -100%) translateY(3px);
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
    /*
     * v1.1.7：正文区最小收缩高度 30vh → 45vh（需求原文）。
     * 矮屏（横屏手机 / 分屏）按 180px 兜底，否则 45vh 会小到没法写字。
     */
    min-height: max(180px, 45vh);
}

.mp-textarea {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    /* v1.1.7：收缩下限与父容器一致 —— 视口 45%，保底 180px */
    min-height: max(180px, 45vh);
    padding: 10px 12px 26px;
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: 14px;
    line-height: 1.7;
    /* v1.1.7：右下角可以自由上下拉伸（需求原文）——拖完由 syncEditorHeight 把容器一起撑开 */
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

/*
 * v1.1.7：原来跟在「链接提取」后面的「x 个附件」提示，
 * 现在与「文件上传中」共用页脚「取消」左侧这个状态位。
 */
.mp-attach-tip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-right: 2px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
}

.mp-attach-spin {
    font-size: 11px;
    color: var(--el-color-primary);
}

/* v1.1.9.3：草稿为空时这句是「引导语」而不是状态，弱化一档（不抢「发布」按钮的注意力） */
.mp-attach-tip.is-empty {
    opacity: 0.65;
    font-style: italic;
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

/* v1.1.9.4：选了「指定」时给一行说明，避免用户以为它会自动挑人 */
.mp-visibility-hint {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
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
    align-items: center;
    gap: 8px;
    margin-left: auto;
}

/* ── 心情 / 天气（v1.1.6 起全终端统一为图标直选，手机版下拉已移除） ── */

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
     * v1.1.6：手机端也改回「图标直选」（需求原文，撤掉 v1.1.3 的两个下拉框）。
     * 窄屏上 20 个图标必然放不下一行，所以让心情 / 天气两组各自换行，
     * 并把单个图标的触控区从 ~24px 放大到 32px，避免「挤成一团点不准」。
     */
    .mp-meta-row {
        gap: 6px;
    }

    .mp-picker {
        flex-wrap: wrap;
        gap: 2px;
        padding: 3px 4px;
    }

    .mp-emoji {
        min-width: 32px;
        height: 32px;
        padding: 0 4px;
        font-size: 17px;
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

    /* v1.1.7：附件数 / 上传中提示已挪进页脚，这里不再需要单独占位规则 */
}

@media (max-width: 768px) {
    /* v1.1.7：移动端同样按视口 45% 起算（原来压到 130px，与桌面端口径不一致） */
    .mp-editor-wrap,
    .mp-textarea {
        min-height: max(160px, 45vh);
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

/*
 * 「链接提取」输入框高度（v1.1.6 引入，v1.1.7 再加两行）。
 * $prompt 的 MessageBox 同样 teleport 到 body，scoped 样式够不着，只能放全局块，
 * 用 customClass 里的 mp-link-prompt 限定范围（只影响这一个弹窗）。
 * 单行 14px * 1.7 ≈ 24px：4 行 ≈ 96px（v1.1.6）→ 6 行 ≈ 144px（v1.1.7，再 +2 行）。
 */
.mp-link-prompt .el-textarea__inner {
    min-height: 144px;
    line-height: 1.7;
}
.el-dialog.moment-publish-dialog {
    display: flex;
    flex-direction: column;
    height: 96vh;
    max-height: 96vh;
    margin: 2vh auto;
}

.el-dialog.moment-publish-dialog .el-dialog__header {
    flex: 0 0 auto;
    /*
     * v1.1.9.1（需求：顶部标题行整块高度减 10px）
     * 全局把 .el-dialog__header 的 padding 统一改成了「16px 20px !important」，
     * 这里用 !important + 更高特异性把下内边距压回 6px：16 → 6 正好 -10px。
     */
    padding-bottom: 6px !important;
}

.el-dialog.moment-publish-dialog .el-dialog__body {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    /* v1.1.4：弹窗内容区禁止横向滚动 —— 页面上只允许三个按钮那一行左右滑 */
    overflow-x: hidden;
    padding-top: 6px;
    padding-bottom: 6px;
}

.el-dialog.moment-publish-dialog .el-dialog__footer {
    flex: 0 0 auto;
    /* v1.1.9.1（需求：底部发布按钮所在行整块高度减 10px）12 → 2，正好 -10px */
    padding-top: 2px !important;
}

/*
 * v1.1.7：移动端「发布 / 编辑瞬间」弹窗宽高一起改为 98%。
 * 宽度改在 dialogWidth（98%）；Element Plus 会把 width 写成内联样式，
 * 所以这里只补高度，不再用 !important 抢宽度。
 */
@media (max-width: 768px) {
    .el-dialog.moment-publish-dialog {
        height: 98vh;
        max-height: 98vh;
        margin: 1vh auto;
    }
}
</style>
