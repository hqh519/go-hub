<template>
    <!--
        「选择文件」面板（v1.1.3 改版）
        ----------------------------------------------------------------------------
        两种数据源（在文件分类的上一行切换）：
          · 图床文件 —— 默认。走 /api/notes/files（只读接口，按实例与账户收窄）；
            搜索框内嵌「搜索范围」+ 后面跟一个筛选按钮，两者都复刻图床管理页；
          · 挂载文件 —— 走 /api/localfiles/*（与 /localFiles 页同一数据源），
            可按目录浏览；选中后点「上传到图床」→ 先弹目标渠道/归属实例/上传目录，
            确认后上传并直接回流到瞬间编辑页的附件里。

        数据源差异只在「取数 + 提交」两处，网格、小眼睛、类型筛选是共用的。
    -->
    <el-dialog
        v-model="visible"
        :title="$t('notes.pickFileTitle')"
        :width="dialogWidth"
        append-to-body
        class="file-picker-dialog"
        @open="onOpen"
        @closed="onClosed"
    >
        <!-- 数据源切换：按需求放在「文件分类」的上一行 -->
        <div class="np-source">
            <button
                type="button"
                class="np-source-btn"
                :class="{ 'is-active': source === 'bed' }"
                @click="switchSource('bed')"
            >
                <font-awesome-icon icon="images" />{{ $t('notes.pickSourceBed') }}
            </button>
            <button
                type="button"
                class="np-source-btn"
                :class="{ 'is-active': source === 'mount' }"
                @click="switchSource('mount')"
            >
                <font-awesome-icon icon="folder-open" />{{ $t('notes.pickSourceMount') }}
            </button>

            <!--
                v1.2.1（需求）：数据源右侧补一个排序按钮，下拉结构与图床管理页的排序一致
                （升序 / 降序 + 按时间 / 大小 / 名称 / 类型四项带勾选）。
                排序对两种数据源都生效 —— 各自下推到后端，翻页后顺序才对。
            -->
            <el-dropdown
                class="np-sort-drop"
                trigger="click"
                placement="bottom-end"
                @command="onSortField"
            >
                <button type="button" class="np-sort-btn" :title="$t('notes.pickSort')">
                    <font-awesome-icon :icon="sortOrder === 'desc' ? 'sort-amount-down' : 'sort-amount-up'" />
                </button>
                <template #dropdown>
                    <el-dropdown-menu class="sort-dropdown-menu">
                        <div class="sort-order-wrapper">
                            <el-radio-group v-model="sortOrder" size="small" @change="onSortOrder">
                                <el-radio-button label="asc">{{ $t('dashboard.sortAsc') }}</el-radio-button>
                                <el-radio-button label="desc">{{ $t('dashboard.sortDesc') }}</el-radio-button>
                            </el-radio-group>
                        </div>
                        <el-divider class="sort-divider" />
                        <el-dropdown-item
                            v-for="o in pickSortOptions"
                            :key="o.value"
                            :command="o.value"
                            :class="{ 'is-selected': sortField === o.value }"
                        >
                            <span>{{ $t(o.label) }}</span>
                            <font-awesome-icon v-if="sortField === o.value" icon="check" class="sort-field-check" />
                        </el-dropdown-item>
                    </el-dropdown-menu>
                </template>
            </el-dropdown>
        </div>

        <div class="np-toolbar">
            <div class="np-tabs" role="tablist">
                <button
                    v-for="t in typeTabs"
                    :key="t.value"
                    type="button"
                    role="tab"
                    class="np-tab"
                    :class="{ 'is-active': type === t.value }"
                    :aria-selected="type === t.value"
                    @click="switchType(t.value)"
                >{{ $t(t.label) }}</button>
            </div>

            <!-- 图床文件：搜索卡片（范围内嵌）+ 筛选按钮 —— 复刻图床管理页顶栏 -->
            <div v-if="source === 'bed'" class="np-search-wrap">
                <div class="np-search-card">
                    <el-input
                        v-model="search"
                        size="small"
                        :placeholder="$t('notes.pickFileSearch')"
                        enterkeyhint="search"
                        @keyup.enter="reload"
                    >
                        <template #prefix>
                            <el-select
                                v-model="searchScope"
                                size="small"
                                class="np-search-type"
                                popper-class="compact-select-popper"
                                @change="reload"
                            >
                                <el-option
                                    v-for="opt in searchScopeOptions"
                                    :key="opt.value"
                                    :label="opt.label"
                                    :value="opt.value"
                                />
                            </el-select>
                            <span class="np-search-sep" aria-hidden="true"></span>
                        </template>
                        <template #suffix>
                            <button
                                v-if="search.length > 0"
                                type="button"
                                class="np-search-clear"
                                :aria-label="$t('dashboard.clearSearch')"
                                @mousedown.prevent
                                @click.stop="clearSearch"
                            >
                                <font-awesome-icon icon="times" />
                            </button>
                            <button
                                type="button"
                                class="np-search-trigger"
                                :aria-label="$t('notes.pickFileSearch')"
                                @mousedown.prevent
                                @click="reload"
                            >
                                <font-awesome-icon icon="search" class="np-search-icon" />
                            </button>
                        </template>
                    </el-input>
                </div>
                <span
                    class="np-filter-btn"
                    :class="{ 'is-active': activeFilterCount > 0 }"
                    role="button"
                    tabindex="0"
                    :title="$t('notes.pickFilter')"
                    :aria-label="$t('notes.pickFilter')"
                    @click="openFilter"
                    @keydown.enter="openFilter"
                >
                    <el-badge :value="activeFilterCount" :hidden="activeFilterCount === 0">
                        <font-awesome-icon icon="filter" />
                    </el-badge>
                </span>
            </div>

            <!-- 挂载文件：普通搜索框（挂载列表本身就是一次目录枚举，用不上范围/筛选） -->
            <el-input
                v-else
                v-model="mountSearch"
                class="np-search"
                size="small"
                clearable
                :placeholder="$t('notes.pickFileSearch')"
                @keyup.enter="applyMountFilter"
                @clear="applyMountFilter"
            >
                <template #suffix>
                    <font-awesome-icon icon="search" class="np-search-icon" @click="applyMountFilter" />
                </template>
            </el-input>
        </div>

        <!-- 挂载文件：渠道 + 目录路径（图床文件模式没有目录概念，不占位） -->
        <div v-if="source === 'mount'" class="np-mount-bar">
            <el-select
                v-if="mountChannels.length > 1"
                v-model="mountChannelId"
                size="small"
                class="np-mount-channel"
                @change="onMountChannelChange"
            >
                <el-option v-for="c in mountChannels" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
            <button
                v-if="mountDir"
                type="button"
                class="np-crumb-btn"
                :title="$t('notes.pickMountUp')"
                @click="enterDir(parentDir)"
            >
                <font-awesome-icon icon="arrow-up" />
            </button>
            <div class="np-crumb">
                <button type="button" class="np-crumb-item" @click="enterDir('')">
                    {{ $t('notes.pickMountRoot') }}
                </button>
                <template v-for="(seg, i) in crumbSegs" :key="i">
                    <span class="np-crumb-sep">/</span>
                    <button type="button" class="np-crumb-item" @click="enterDir(crumbPathUpTo(i))">{{ seg }}</button>
                </template>
            </div>
        </div>

        <div ref="bodyEl" class="np-body" v-loading="loading && !list.length" @scroll.passive="onScroll">
            <div v-if="emptyNow" class="np-empty">
                <font-awesome-icon :icon="emptyIcon" class="np-empty-icon" />
                <p>{{ source === 'mount' ? $t('notes.pickMountEmpty') : $t('notes.pickFileEmpty') }}</p>
            </div>
            <div v-else class="np-grid">
                <!-- 挂载文件：子目录排在最前（点进去继续翻） -->
                <button
                    v-for="d in mountDirsFiltered"
                    :key="'dir-' + d.name"
                    type="button"
                    class="np-cell np-cell-dir"
                    :title="d.name"
                    @click="enterDir(joinPath(mountDir, d.name))"
                >
                    <span class="np-cover">
                        <font-awesome-icon icon="folder" class="np-cover-icon" />
                        <span class="np-cover-name">{{ d.name }}</span>
                    </span>
                </button>

                <button
                    v-for="f in visibleList"
                    :key="keyOf(f)"
                    type="button"
                    class="np-cell"
                    :class="{ 'is-picked': !!pickedMap[keyOf(f)], 'is-disabled': isExcluded(f) }"
                    :disabled="isExcluded(f)"
                    :title="displayName(f)"
                    @click="toggle(f)"
                >
                    <!-- 视频：用 <video preload=metadata> 取首帧（挂载侧）或前端抽帧（图床侧） -->
                    <video
                        v-if="source === 'mount' && f.mediaKind === 'video'"
                        :src="coverOf(f) + '#t=0.5'"
                        class="np-img"
                        preload="metadata"
                        muted
                        playsinline
                        tabindex="-1"
                    ></video>
                    <!--
                        图床侧视频：posters[f.id] 是前端用 canvas 抽出来的**首帧图片**（data:image/jpeg），
                        必须用 <img> 渲染。v1.1.6 之前这里写成了 <video>，把 JPEG 塞进视频元素，
                        浏览器解码失败 → 整个格子空白，表现为「图床文件下的视频没有缩略图」。
                    -->
                    <img
                        v-else-if="source === 'bed' && f.mediaKind === 'video' && posters[f.id]"
                        :src="posters[f.id]"
                        class="np-img"
                        loading="lazy"
                        alt=""
                    />
                    <img
                        v-else-if="coverOf(f) && !f.broken"
                        :src="coverOf(f)"
                        class="np-img"
                        loading="lazy"
                        alt=""
                        @error="onCoverError(f)"
                    />
                    <span v-else class="np-cover">
                        <font-awesome-icon :icon="iconOf(f)" class="np-cover-icon" />
                        <span class="np-cover-name">{{ displayName(f) }}</span>
                    </span>

                    <span v-if="f.mediaKind === 'video' && coverOf(f)" class="np-play">
                        <font-awesome-icon icon="play" />
                    </span>

                    <!-- 小眼睛：按住 / 悬停预览（图片、视频、音频都有） -->
                    <span
                        v-if="previewable(f)"
                        class="np-eye no-hswipe-guard"
                        role="button"
                        :aria-label="$t('notes.pickPreviewHold')"
                        @click.stop.prevent
                        @mousedown.stop.prevent
                        @mouseenter.stop="openPreview(f, $event)"
                        @mouseleave.stop="closePreview"
                        @touchstart.stop.prevent="eyeTouchStart(f, $event)"
                        @touchmove.stop="eyeTouchMove"
                        @touchend.stop.prevent="eyeTouchEnd"
                        @touchcancel.stop.prevent="eyeTouchEnd"
                        @contextmenu.prevent
                    >
                        <font-awesome-icon icon="eye" />
                    </span>

                    <span v-if="pickedMap[keyOf(f)]" class="np-check">
                        <font-awesome-icon icon="check" />
                    </span>
                    <span v-if="isExcluded(f)" class="np-added">{{ $t('notes.pickFileAdded') }}</span>
                </button>
            </div>

            <p v-if="loading && list.length" class="np-end">{{ $t('notes.loading') }}</p>
            <p v-else-if="!hasMore && list.length" class="np-end">{{ $t('notes.pickFileEnd', { n: total }) }}</p>
        </div>

        <template #footer>
            <div class="np-footer">
                <span class="np-count">{{ $t('notes.pickFilePicked', { n: picked.length }) }}</span>
                <div class="np-footer-btns">
                    <el-button size="small" @click="visible = false">{{ $t('common.cancel') }}</el-button>
                    <el-button
                        v-if="source === 'mount'"
                        size="small"
                        type="primary"
                        :disabled="!picked.length"
                        :loading="uploading"
                        @click="openUploadTarget"
                    >
                        {{ uploading ? $t('notes.pickUploading') : $t('notes.pickUploadToBed') }}
                    </el-button>
                    <el-button
                        v-else
                        size="small"
                        type="primary"
                        :disabled="!picked.length"
                        @click="confirm"
                    >
                        {{ $t('notes.pickFileConfirm') }}
                    </el-button>
                </div>
            </div>
        </template>

        <!-- 预览浮层：teleport 到 body，按文件比例 + 四周余量自动选方位 -->
        <teleport to="body">
            <div v-if="preview.visible" class="np-preview" :style="previewStyle" aria-hidden="true">
                <div class="np-preview-head" :title="preview.name">
                    <span class="np-preview-name">{{ preview.name }}</span>
                </div>
                <div class="np-preview-stage" :style="{ height: preview.h + 'px' }">
                    <video
                        v-if="preview.type === 'video'"
                        ref="previewVideo"
                        :src="preview.src"
                        class="np-preview-media"
                        autoplay
                        loop
                        playsinline
                    ></video>
                    <audio
                        v-else-if="preview.type === 'audio'"
                        ref="previewAudio"
                        :src="preview.src"
                        autoplay
                    ></audio>
                    <span v-if="preview.type === 'audio'" class="np-preview-audio-face">
                        <font-awesome-icon icon="music" class="np-preview-audio-icon" />
                        <span class="np-preview-audio-hint">{{ $t('notes.mediaAudio') }}</span>
                    </span>
                    <img v-else-if="preview.type === 'image'" :src="preview.src" class="np-preview-media" alt="" decoding="async" />
                </div>
            </div>
        </teleport>

        <!-- 筛选：直接复用图床管理页的筛选弹窗，范围天然一致 -->
        <FilterDialog
            v-if="source === 'bed'"
            v-model="filterVisible"
            v-model:filters="filters"
            :channelNameOptions="channelNameOptions"
            :tagOptions="filterTagOptions"
            @change="onFilterChange"
        />

        <!-- 上传到图床：目标渠道 / 归属实例 / 上传目录（归属实例默认当前实例） -->
        <UploadTargetDialog
            v-model="uploadTargetVisible"
            :busy="uploading"
            :hint="uploadHint"
            :prefill="uploadPrefill"
            @confirm="doUpload"
        />
    </el-dialog>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import { formatSize } from '@/utils/notes';
import { videoPoster } from '@/utils/videoPoster';
import {
    readPickMemory,
    savePickMemory,
    readBedCache,
    writeBedCache,
    readMountCache,
    writeMountCache
} from '@/utils/notePickCache';
import { fileManager } from '@/utils/fileManager';
import { CHANNEL_TYPES } from '@/components/config/channel-schema';
import { fetchStorageChannels } from '@/utils/storageChannels';
import FilterDialog from '@/components/dashboard/FilterDialog.vue';
import UploadTargetDialog from '@/components/upload/UploadTargetDialog.vue';
import { defaultUploadFolder } from '@/utils/uploadTarget';
import { bindDialogLayers } from '@/utils/layerStack';

/** 预览浮层最长边 */
const PREVIEW_MAX = 300;
/** 预览浮层最短边（极端长图 / 长条视频不至于变成一条线） */
const PREVIEW_MIN = 96;
/** 浮层与视口边缘的安全距离 */
const PREVIEW_MARGIN = 8;
/** 浮层与小眼睛按钮的间距（保证「不遮盖按钮」是硬约束，不靠运气） */
const PREVIEW_GAP = 10;
/** 浮层标题行高度（文件名） */
const PREVIEW_HEAD_H = 26;
/** 触屏长按多久算「按住预览」 */
const EYE_PRESS_MS = 300;
/** 距底部多少像素开始预加载下一页 */
const SCROLL_TRIGGER = 160;
/** 挂载目录一次最多拉多少页（每页 200）—— 防止超大目录把弹窗拖死 */
const MOUNT_MAX_PAGES = 5;

/** 图床管理页筛选的默认值（与 AdminDashBoard 完全一致，否则角标数量对不上） */
function emptyFilters() {
    return {
        accessStatus: [],
        listType: [],
        label: [],
        fileType: [],
        channel: [],
        channelName: [],
        backup: [],
        redirect: [],
        tags: [],
        tagNames: [],
        tagMode: 'and',
        datePreset: '',
        dateFrom: '',
        dateTo: '',
        sizePreset: '',
        sizeMin: 0,
        sizeMax: 0,
        sizeUnit: 'MB',
        sizeMode: 'actual',
        validity: [],
        nameChanged: [],
        // v1.2.1：剪辑状态 / MD5 变化（与图床管理筛选同一套口径）
        edited: [],
        md5Changed: [],
        userNames: [],
        shareScope: '',
        matchMode: 'and',
        dimPreset: '',
        widthMin: 0,
        widthMax: 0,
        heightMin: 0,
        heightMax: 0,
        ratingMin: null,
        ratingMax: null,
        levelMin: null,
        levelMax: null
    };
}

export default {
    name: 'FilePickerDialog',
    components: { FilterDialog, UploadTargetDialog },
    props: {
        modelValue: { type: Boolean, default: false },
        instanceId: { type: String, default: '' },
        /** 已经加进瞬间的文件 id —— 不允许重复选（后端也有唯一约束兜底） */
        excludeIds: { type: Array, default: () => [] },
        /**
         * v1.2.1：从这里「上传到图床」的文件，上传来源记什么。
         * 面板目前只服务内容发布，所以默认就是 Attachment（文件详情显示「附件上传」）；
         * 以后别处复用时显式传别的值即可。
         */
        uploadSource: { type: String, default: 'Attachment' }
    },
    emits: ['update:modelValue', 'confirm'],
    data() {
        return {
            /** 数据源：bed = 图床文件（默认），mount = 挂载文件 */
            source: 'bed',
            /*
             * v1.2.1（需求）：初始分类由「图片」改为「全部」。
             * 真正的默认值在 readPickMemory 里兜底，这里只是首帧值；
             * 打开面板时会被 restoreMemory() 用浏览器记忆覆盖。
             */
            type: 'all',
            /* v1.2.1（需求）：排序（两种数据源共用同一套设置） */
            sortField: 'time',
            sortOrder: 'desc',
            search: '',
            searchScope: 'all',
            list: [],
            total: 0,
            page: 1,
            pageSize: 24,
            loading: false,
            picked: [],
            loaded: false,
            /** 视频首帧：id -> dataURL */
            posters: {},
            preview: {
                visible: false,
                src: '',
                type: 'image',
                name: '',
                w: PREVIEW_MAX,
                h: PREVIEW_MAX,
                left: 0,
                top: 0
            },
            /* ── 筛选（图床文件模式） ── */
            filters: emptyFilters(),
            filterVisible: false,
            filterTagOptions: [],
            channelNameOptions: [],
            _filtersLoaded: false,
            /* ── 挂载文件模式 ── */
            mountChannels: [],
            mountChannelId: '',
            mountDir: '',
            mountAll: [],
            mountDirs: [],
            mountSearch: '',
            mountKeyword: '',
            mountVisible: 60,
            /* ── 上传到图床 ── */
            uploadTargetVisible: false,
            uploading: false,
            uploadPrefill: { channelId: '', instanceId: '', uploadFolder: '' }
        };
    },
    computed: {
        /** 排序是否还是出厂值（时间倒序）—— 列表缓存按这个条件才允许读写 */
        isDefaultSort() {
            return this.sortField === 'time' && this.sortOrder === 'desc';
        },
        /** 图床侧排序字段 → 挂载侧字段名（挂载的「时间」是文件系统的 mtime） */
        mountSortKey() {
            if (this.sortField === 'size') return 'size';
            if (this.sortField === 'name') return 'name';
            if (this.sortField === 'type') return 'type';
            return 'mtime';
        },
        /** 排序下拉的四个字段（与图床管理页同一套排序能力，只是收窄成四项） */
        pickSortOptions() {
            return [
                { value: 'time', label: 'notes.pickSortTime' },
                { value: 'size', label: 'notes.pickSortSize' },
                { value: 'name', label: 'notes.pickSortName' },
                { value: 'type', label: 'notes.pickSortType' }
            ];
        },
        visible: {
            get() {
                return this.modelValue;
            },
            set(v) {
                this.$emit('update:modelValue', v);
            }
        },
        /** v1.1.7：移动端宽度 94% → 98%（与编辑页一致），高度在全局样式里按 98vh 处理 */
        dialogWidth() {
            return window.innerWidth < 768 ? '98%' : '860px';
        },
        typeTabs() {
            return [
                /*
                 * v1.1.8（需求）：「图片」前面增加「全部」，一次看到所有类型的文件。
                 * 取值 'all' 时后端不传 type（等于不加 mime 前缀限制），挂载模式也不做过滤。
                 */
                { value: 'all', label: 'notes.pickAll' },
                { value: 'image', label: 'notes.mediaImage' },
                { value: 'video', label: 'notes.mediaVideo' },
                { value: 'audio', label: 'notes.mediaAudio' },
                { value: 'other', label: 'notes.mediaOther' }
            ];
        },
        /** 搜索范围 —— 与图床管理页同一套选项（需求：需要有一样的范围） */
        searchScopeOptions() {
            return [
                { value: 'all', label: this.$t('dashboard.searchTypeAll') },
                { value: 'title', label: this.$t('dashboard.searchTypeTitle') },
                { value: 'tag', label: this.$t('dashboard.searchTypeTag') },
                { value: 'category', label: this.$t('dashboard.searchTypeCategory') },
                { value: 'user', label: this.$t('dashboard.searchTypeUser') },
                { value: 'note', label: this.$t('dashboard.searchTypeNote') },
                { value: 'other', label: this.$t('dashboard.searchTypeOther') }
            ];
        },
        emptyIcon() {
            if (this.type === 'all') return 'folder-open';
            if (this.type === 'video') return 'film';
            if (this.type === 'audio') return 'music';
            if (this.type === 'other') return 'file';
            return 'images';
        },
        excluded() {
            return (this.excludeIds || []).map(String);
        },
        pickedMap() {
            const map = {};
            for (const f of this.picked) map[this.keyOf(f)] = true;
            return map;
        },
        hasMore() {
            return this.list.length < this.total;
        },
        /** 挂载模式：本目录内按类型 / 关键词客户端过滤（目录项单独放前面） */
        mountFilesFiltered() {
            const kw = this.mountKeyword.trim().toLowerCase();
            return (this.mountAll || []).filter((f) => {
                if (kw && !String(f.name || '').toLowerCase().includes(kw)) return false;
                // v1.1.8：「全部」不做类型过滤
                if (this.type === 'all') return true;
                if (this.type === 'image') return f.type === 'image';
                if (this.type === 'video') return f.type === 'video';
                if (this.type === 'audio') return f.type === 'audio';
                // 「其他」= 图 / 视 / 音之外（pdf、文本、压缩包…）
                return f.type !== 'image' && f.type !== 'video' && f.type !== 'audio';
            });
        },
        mountDirsFiltered() {
            const kw = this.mountKeyword.trim().toLowerCase();
            return (this.mountDirs || [])
                .map((d) => (typeof d === 'string' ? { name: d } : d))
                .filter((d) => d && d.name)
                .filter((d) => !kw || String(d.name).toLowerCase().includes(kw));
        },
        /** 网格实际渲染的条目（挂载模式自己控增量；图床模式直接用后端分页结果） */
        visibleList() {
            if (this.source !== 'mount') return this.list;
            return this.mountFilesFiltered.slice(0, this.mountVisible);
        },
        emptyNow() {
            if (this.loading) return false;
            if (this.source === 'mount') return !this.visibleList.length && !this.mountDirsFiltered.length;
            return !this.list.length;
        },
        crumbSegs() {
            return String(this.mountDir || '').split('/').filter(Boolean);
        },
        parentDir() {
            const segs = this.crumbSegs;
            return segs.slice(0, Math.max(0, segs.length - 1)).join('/');
        },
        /** 已生效的筛选条件数量（= 图床管理页那个角标） */
        activeFilterCount() {
            const f = this.filters;
            let n = 0;
            const arrKeys = [
                'accessStatus', 'listType', 'label', 'fileType', 'channel', 'channelName',
                'backup', 'redirect', 'tags', 'tagNames', 'userNames', 'validity', 'nameChanged',
                // v1.2.1：剪辑 / MD5 变化（筛选弹窗新增的两组）
                'edited', 'md5Changed'
            ];
            for (const k of arrKeys) n += (f[k] || []).length;
            if (f.shareScope) n += 1;
            if (f.matchMode === 'any') n += 1;
            if (f.dateFrom || f.dateTo) n += 1;
            if ((Number(f.sizeMin) || 0) > 0 || (Number(f.sizeMax) || 0) > 0 || f.sizeMode === 'original') n += 1;
            if (f.dimPreset) n += 1;
            if ((Number(f.widthMin) || 0) > 0 || (Number(f.widthMax) || 0) > 0
                || (Number(f.heightMin) || 0) > 0 || (Number(f.heightMax) || 0) > 0) n += 1;
            if (f.ratingMin !== null || f.ratingMax !== null || f.levelMin !== null || f.levelMax !== null) n += 1;
            return n;
        },
        previewStyle() {
            return {
                left: `${this.preview.left}px`,
                top: `${this.preview.top}px`,
                width: `${this.preview.w}px`
            };
        },
        uploadHint() {
            return this.picked.length
                ? this.$t('notes.pickFilePicked', { n: this.picked.length })
                : '';
        }
    },
    methods: {
        formatSize,

        /* ── 通用小工具 ─────────────────────────────────────────── */
        /** 图床行有 id，挂载行只有 path —— 统一成一个 key */
        keyOf(f) {
            return String(f.id || f.path || '');
        },
        displayName(f) {
            return f.originalName || f.name || '';
        },
        isExcluded(f) {
            if (this.source !== 'bed') return false;
            return this.excluded.includes(String(f.id));
        },
        previewable(f) {
            return f.mediaKind === 'image' || f.mediaKind === 'video' || f.mediaKind === 'audio';
        },
        joinPath(dir, name) {
            return dir ? `${dir}/${name}` : String(name);
        },
        crumbPathUpTo(i) {
            return this.crumbSegs.slice(0, i + 1).join('/');
        },
        iconOf(f) {
            const kind = f.mediaKind || f.type;
            if (kind === 'image') return 'images';
            if (kind === 'video') return 'film';
            if (kind === 'audio') return 'music';
            if (f.fileType === 'pdf' || kind === 'pdf') return 'file-pdf';
            if (f.fileType === 'txt' || kind === 'text') return 'file-alt';
            return 'file';
        },
        /** 格子封面：图床侧用后端缩略图 / 前端抽帧；挂载侧用预览接口 */
        coverOf(f) {
            if (this.source === 'mount') {
                if (f.mediaKind === 'image' || f.mediaKind === 'video') return this.mountPreviewUrl(f);
                return '';
            }
            if (f.mediaKind === 'image') return f.thumbUrl || f.url || '';
            if (f.mediaKind === 'video') return this.posters[f.id] || '';
            return '';
        },
        mountPreviewUrl(f) {
            return `/api/localfiles/preview?channelId=${encodeURIComponent(this.mountChannelId)}&path=${encodeURIComponent(f.path)}`;
        },
        onCoverError(f) {
            // 挂载侧文件可能已被外部删除；图床侧缩略图偶发失败 —— 都退回「图标卡」，别显示破图
            f.broken = true;
        },

        /* ── 打开 / 关闭 ───────────────────────────────────────── */
        onOpen() {
            /*
             * v1.1.7：进入面板时恢复「上次停在哪里」（数据源 / 类型 / 挂载渠道 / 目录），
             * 并先把上次的取数结果铺上，再在后台刷新 —— 这样打开就是满屏内容，
             * 不用对着空白格子等一次网络往返；刷新回来照样覆盖，不会拿到过期数据。
             */
            this.restoreMemory();
            this.loaded = true;
            // v1.2.1：非默认排序时不读缓存 —— 缓存里存的是默认顺序，贴上来会先闪一屏错序
            if (this.source === 'bed') {
                const cached = this.isDefaultSort ? readBedCache(this.instanceId, this.type) : null;
                if (cached && !this.search.trim()) {
                    this.list = cached.list;
                    this.total = cached.total;
                    this.page = 1;
                    this.$nextTick(() => this.loadPosters());
                }
                this.reload(true);
            } else {
                const cached = this.isDefaultSort
                    ? readMountCache(this.instanceId, this.mountChannelId, this.mountDir)
                    : null;
                if (cached) {
                    this.mountAll = cached.files;
                    this.mountDirs = cached.dirs;
                    this.total = cached.files.length;
                    this.mountVisible = 60;
                }
                this.loadMount(true);
            }
        },
        /** 把本地记忆贴到当前状态上（初始化一次，之后由用户操作驱动更新） */
        restoreMemory() {
            const m = readPickMemory(this.instanceId);
            this.source = m.source;
            this.type = m.type;
            this.sortField = m.sortField;
            this.sortOrder = m.sortOrder;
            this.mountChannelId = m.mountChannelId;
            this.mountDir = m.mountDir;
            this.picked = [];
            this.list = [];
            this.total = 0;
            this.mountAll = [];
            this.mountDirs = [];
        },
        /** 记住当前停在哪里（切数据源 / 切类型 / 换排序 / 换渠道 / 进目录时各调一次） */
        rememberPosition() {
            savePickMemory(this.instanceId, {
                source: this.source,
                type: this.type,
                mountChannelId: this.mountChannelId,
                mountDir: this.mountDir,
                sortField: this.sortField,
                sortOrder: this.sortOrder
            });
        },
        onClosed() {
            // 每次关闭都清掉待选状态与预览，避免下次打开还挂着上一轮
            this.picked = [];
            this.closePreview();
            this.uploadTargetVisible = false;
        },

        /* ── 数据源切换 ─────────────────────────────────────────── */
        switchSource(v) {
            if (this.source === v) return;
            this.source = v;
            this.picked = [];
            this.closePreview();
            this.list = [];
            this.total = 0;
            this.rememberPosition();
            if (v === 'bed') this.reload();
            else this.loadMount(true);
        },
        switchType(v) {
            if (this.type === v) return;
            this.type = v;
            this.rememberPosition();
            this.closePreview();
            this.mountVisible = 60;
            if (this.source === 'bed') this.reload();
        },
        /* ── 排序（v1.2.1） ─────────────────────────────────────── */
        /**
         * 换排序字段。两种数据源都重新取数：
         * 图床是服务端分页，不重取就只排了当前页；挂载是整目录取回，也要重排一次。
         */
        onSortField(field) {
            if (this.sortField === field) return;
            this.sortField = field;
            this.applySort();
        },
        /** 切换升 / 降序 */
        onSortOrder(order) {
            const next = order === 'asc' ? 'asc' : 'desc';
            if (this.sortOrder === next) return;
            this.sortOrder = next;
            this.applySort();
        },
        applySort() {
            this.rememberPosition();
            this.closePreview();
            this.mountVisible = 60;
            if (this.source === 'bed') this.reload();
            else this.loadMount(true);
        },

        /* ── 图床文件：取数 ─────────────────────────────────────── */
        /**
         * 重新取数。
         * @param {boolean} keep  true = 不清空当前列表（用于「先用缓存铺屏、再后台刷新」），
         *                        false / 缺省 = 清空后重新取（切换类型 / 搜索时用）
         */
        reload(keep) {
            if (this.source !== 'bed') return;
            this.page = 1;
            if (!keep) {
                this.list = [];
                this.total = 0;
            }
            return this.fetch(true);
        },
        loadMore() {
            if (this.loading || !this.hasMore) return;
            this.page += 1;
            return this.fetch(false);
        },
        /** 滚动到底自动加载（阈值留 160px，滚到底之前就开始拉，观感上不会卡一下） */
        onScroll() {
            // 挂载模式是客户端增量：滚到底就把渲染条数 +60
            if (this.source === 'mount') {
                const el = this.$refs.bodyEl;
                if (!el) return;
                const rest = el.scrollHeight - el.scrollTop - el.clientHeight;
                if (rest < SCROLL_TRIGGER && this.mountVisible < this.mountFilesFiltered.length) {
                    this.mountVisible += 60;
                }
                return;
            }
            const el = this.$refs.bodyEl;
            if (!el) return;
            if (!this.hasMore || this.loading) return;
            const rest = el.scrollHeight - el.scrollTop - el.clientHeight;
            if (rest < SCROLL_TRIGGER) this.loadMore();
        },
        clearSearch() {
            this.search = '';
            this.reload();
        },
        async fetch(reset) {
            this.loading = true;
            try {
                const qs = new URLSearchParams();
                qs.set('page', String(this.page));
                qs.set('pageSize', String(this.pageSize));
                qs.set('instanceId', this.instanceId || '');
                // v1.1.8：「全部」= 不加类型限制，别把 all 当 mime 前缀发给后端
                if (this.type && this.type !== 'all') qs.set('type', this.type);
                /*
                 * v1.2.1（需求）：排序下推到后端。
                 * 不能在前端排 —— 图床是服务端分页的，前端只能排到「当前已加载的几页」，
                 * 一翻页顺序就断，用户看到的是「排了但没排干净」。
                 */
                qs.set('sortBy', this.sortField);
                qs.set('order', this.sortOrder);
                if (this.search.trim()) qs.set('search', this.search.trim());
                // 搜索范围 / 筛选：与图床管理页同名同义，后端同一份求值实现
                if (this.searchScope && this.searchScope !== 'all') qs.set('searchType', this.searchScope);
                const extra = fileManager.buildFilterParams(this.filters);
                const res = await fetchWithAuth(`/api/notes/files?${qs.toString()}${extra || ''}`);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || 'load failed');
                const rows = Array.isArray(data.list) ? data.list : [];
                this.total = Number(data.total) || 0;
                this.list = reset ? rows : this.list.concat(rows);
                // v1.1.7：只在「第一页 + 无搜索词 + 无额外筛选」时落缓存，否则缓存会串味
                // v1.2.1：排序不是默认值时也不落 —— 缓存按「类型」存，不区分排序，
                //          存进去下次按默认排序打开会闪一下错顺序
                if (reset && !this.search.trim() && !fileManager.buildFilterParams(this.filters) && this.isDefaultSort) {
                    writeBedCache(this.instanceId, this.type, this.list, this.total);
                }
                this.$nextTick(() => {
                    // 一页填不满时继续拉，否则「滚动加载」在宽屏上永远不会再触发
                    this.fillViewport();
                    this.loadPosters();
                });
            } catch (e) {
                this.$message.error(this.$t('notes.pickFileLoadFail'));
            } finally {
                this.loading = false;
            }
        },
        /** 首屏内容不足一屏时自动补下一页（多数是「其他」这种稀疏分类才会遇到） */
        fillViewport() {
            const el = this.$refs.bodyEl;
            if (!el || !this.hasMore || this.loading) return;
            if (el.scrollHeight <= el.clientHeight + SCROLL_TRIGGER) this.loadMore();
        },
        /** 给列表里的视频抽首帧（videoPoster 内部并发限 2 + 按 URL 缓存） */
        loadPosters() {
            for (const f of this.list) {
                if (f.mediaKind !== 'video' || this.posters[f.id]) continue;
                const url = f.url || '';
                if (!url) continue;
                videoPoster(url).then((dataUrl) => {
                    if (!dataUrl) return;
                    this.posters = { ...this.posters, [f.id]: dataUrl };
                });
            }
        },

        /* ── 筛选（图床文件模式） ───────────────────────────────── */
        openFilter() {
            this.filterVisible = true;
            this.loadFilterOptions();
        },
        async loadFilterOptions() {
            try {
                const [tagsRes, channels] = await Promise.all([
                    fetchWithAuth(`/api/tags/manage?instanceId=${encodeURIComponent(this.instanceId || '')}&sort=createdAt&order=desc`),
                    fetchStorageChannels().catch(() => [])
                ]);
                const json = await tagsRes.json().catch(() => ({}));
                this.filterTagOptions = Array.isArray(json?.data)
                    ? json.data.map((t) => ({ name: t.name, count: Number(t.count) || 0, createdAt: t.createdAt }))
                    : [];
                const typeLabels = {};
                for (const t of CHANNEL_TYPES) typeLabels[t.value] = t.label;
                this.channelNameOptions = (Array.isArray(channels) ? channels : []).map((c) => ({
                    name: c.name,
                    type: c.type,
                    typeLabel: typeLabels[c.type] || c.type
                }));
            } catch (e) {
                /* 选项拉不到不影响主流程，筛选弹窗里对应分区会自行隐藏 */
            }
        },
        onFilterChange() {
            this.reload();
        },

        /* ── 挂载文件：取数 ─────────────────────────────────────── */
        async loadMount(reset) {
            this.loading = true;
            try {
                if (!this.mountChannels.length) {
                    const res = await fetchWithAuth('/api/localfiles/channels');
                    const json = await res.json().catch(() => ({}));
                    this.mountChannels = Array.isArray(json.data) ? json.data : [];
                    if (this.mountChannels.length && !this.mountChannelId) {
                        this.mountChannelId = this.mountChannels[0].id;
                    }
                }
                if (!this.mountChannelId) {
                    this.mountAll = [];
                    this.mountDirs = [];
                    this.total = 0;
                    return;
                }
                if (reset) {
                    this.mountAll = [];
                    this.mountDirs = [];
                    this.mountVisible = 60;
                }
                // 目录枚举：一页 200，最多拉 MOUNT_MAX_PAGES 页，够选文件用了
                let page = 1;
                let all = [];
                let dirs = [];
                let total = 0;
                while (page <= MOUNT_MAX_PAGES) {
                    const qs = new URLSearchParams({
                        channelId: this.mountChannelId,
                        dir: this.mountDir || '',
                        page: String(page),
                        pageSize: '200',
                        type: '',
                        // v1.2.1：排序与图床文件共用同一套设置，挂载侧字段名映射一下
                        // （时间是文件系统的 mtime，不是上传时间）
                        sort: this.mountSortKey,
                        order: this.sortOrder,
                        search: ''
                    });
                    const res = await fetchWithAuth(`/api/localfiles/list?${qs.toString()}`);
                    const json = await res.json().catch(() => ({}));
                    if (!json.success) throw new Error(json.message || 'load failed');
                    const data = json.data || {};
                    const entries = Array.isArray(data.entries) ? data.entries : [];
                    dirs = Array.isArray(data.dirs) ? data.dirs : [];
                    total = Number(data.total) || 0;
                    all = all.concat(
                        entries
                            .filter((e) => e.kind === 'file')
                            .map((e) => ({ ...e, mediaKind: e.type === 'pdf' || e.type === 'text' ? 'other' : e.type }))
                    );
                    if (all.length >= total || !entries.length) break;
                    page += 1;
                }
                this.mountAll = all;
                this.mountDirs = dirs;
                this.total = all.length;
                // v1.1.7：记住这次的结果，下次进同一渠道 + 目录先拿它铺屏
                // v1.2.1：非默认排序时不落缓存（缓存键不含排序，存了顺序就是错的）
                if (this.isDefaultSort) {
                    writeMountCache(this.instanceId, this.mountChannelId, this.mountDir, all, dirs);
                }
            } catch (e) {
                this.mountAll = [];
                this.mountDirs = [];
                this.total = 0;
                this.$message.error(this.$t('notes.pickFileLoadFail'));
            } finally {
                this.loading = false;
            }
        },
        onMountChannelChange() {
            this.mountDir = '';
            this.picked = [];
            this.rememberPosition();
            this.loadMount(true);
        },
        enterDir(dir) {
            this.mountDir = dir || '';
            this.mountVisible = 60;
            this.closePreview();
            this.rememberPosition();
            this.loadMount(true);
        },
        applyMountFilter() {
            this.mountKeyword = this.mountSearch || '';
            this.mountVisible = 60;
        },

        /* ── 选择 ───────────────────────────────────────────────── */
        toggle(f) {
            if (this.isExcluded(f)) return;
            const key = this.keyOf(f);
            const idx = this.picked.findIndex((x) => this.keyOf(x) === key);
            if (idx >= 0) this.picked.splice(idx, 1);
            else this.picked.push(f);
        },
        confirm() {
            this.$emit('confirm', this.picked.slice());
            this.visible = false;
        },

        /* ── 挂载文件 → 上传到图床 ──────────────────────────────── */
        openUploadTarget() {
            if (!this.picked.length) return;
            // 归属实例默认当前实例（需求：当前页面处于什么实例就定位到什么实例）
            this.uploadPrefill = {
                channelId: '',
                instanceId: this.instanceId || '',
                // v1.1.4：默认目录改成 /notes/瞬间/{年}/{月}（与发布瞬间的本地上传同一口径）
                uploadFolder: defaultUploadFolder('moment')
            };
            this.uploadTargetVisible = true;
        },
        async doUpload(payload) {
            if (!this.picked.length) return;
            this.uploading = true;
            try {
                const res = await fetchWithAuth('/api/localfiles/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        channelId: this.mountChannelId,
                        paths: this.picked.map((f) => f.path),
                        targetChannelId: payload?.channelId || '',
                        // 没手选实例时仍然落到当前实例，避免上传到别的实例里去
                        instanceId: payload?.instanceId || this.instanceId || '',
                        uploadFolder: payload?.uploadFolder || '',
                        /*
                         * v1.2.1（需求）：这条链路之前没带来源，后端写死 Default，
                         * 于是「发布笔记 → 选择文件 → 挂载文件 → 上传到图床」的附件
                         * 在文件详情里显示成「默认」。这里补上，与另外两条附件路径同口径。
                         */
                        uploadSource: this.uploadSource
                    })
                });
                const json = await res.json().catch(() => ({}));
                if (!json.success) throw new Error(json.message || 'upload failed');
                const results = Array.isArray(json.data) ? json.data : [];
                const ok = results.filter((r) => r.success && r.id);
                if (!ok.length) {
                    this.$message.error(this.$t('notes.pickUploadNone'));
                    return;
                }
                /*
                 * 上传结果只有 { path, name, success, id }，没有 mime / url。
                 * id 就是 File_ID（= files.name），所以 /file/<id> 直接可取；
                 * mime 用挂载行的 type 反推即可满足 mediaKind 判定。
                 */
                const byPath = new Map(this.picked.map((f) => [f.path, f]));
                const files = ok.map((r) => {
                    const src = byPath.get(r.path) || {};
                    const kind = src.type || 'other';
                    return {
                        id: r.id,
                        name: r.id,
                        originalName: r.name || src.name || '',
                        mime: kind === 'image' ? 'image/*'
                            : kind === 'video' ? 'video/*'
                                : kind === 'audio' ? 'audio/*'
                                    : 'application/octet-stream',
                        mediaKind: kind === 'image' || kind === 'video' || kind === 'audio' ? kind : 'other',
                        size: Number(src.size) || 0,
                        url: `/file/${encodeURIComponent(r.id)}`,
                        src: `/file/${encodeURIComponent(r.id)}`
                    };
                });
                this.uploadTargetVisible = false;
                this.$message.success(this.$t('notes.pickUploadDone', { n: files.length }));
                this.$emit('confirm', files);
                this.picked = [];
                this.visible = false;
            } catch (e) {
                this.$message.error(this.$t('notes.pickUploadNone'));
            } finally {
                this.uploading = false;
            }
        },

        /* ── 小眼睛：按住预览 ───────────────────────────────────── */
        /**
         * 预览比例探测。
         *   · 图片直接用**缩略图**尺寸（缩略图是按宽度等比缩的，比例与原图一致，
         *     而且刚在网格里加载过 → 命中浏览器缓存，几乎零延迟）；
         *   · 视频只能读元数据（preload=metadata，不算整个文件）；
         *   · 音频没有画面比例，返回 0 走固定尺寸。
         */
        probeRatio(f) {
            const kind = f.mediaKind;
            if (kind === 'audio') return Promise.resolve(0);
            const key = this.keyOf(f);
            if (this._ratioCache && this._ratioCache[key]) return Promise.resolve(this._ratioCache[key]);
            const src = kind === 'image' ? (f.thumbUrl || f.url || '') : (f.url || '');
            if (!src) return Promise.resolve(0);
            const cache = (v) => {
                this._ratioCache = this._ratioCache || {};
                this._ratioCache[key] = v;
                return v;
            };
            return new Promise((resolve) => {
                let done = false;
                const finish = (v) => {
                    if (done) return;
                    done = true;
                    resolve(cache(v));
                };
                // 探测不到就按当前默认比例（正方形）兜底，不能一直等
                const timer = setTimeout(() => finish(0), 1500);
                if (kind === 'image') {
                    const img = new Image();
                    img.onload = () => {
                        clearTimeout(timer);
                        const w = img.naturalWidth || 0;
                        const h = img.naturalHeight || 0;
                        finish(w && h ? w / h : 0);
                    };
                    img.onerror = () => {
                        clearTimeout(timer);
                        finish(0);
                    };
                    img.src = src;
                } else {
                    const v = document.createElement('video');
                    v.preload = 'metadata';
                    v.muted = true;
                    v.onloadedmetadata = () => {
                        clearTimeout(timer);
                        const w = v.videoWidth || 0;
                        const h = v.videoHeight || 0;
                        v.removeAttribute('src');
                        finish(w && h ? w / h : 0);
                    };
                    v.onerror = () => {
                        clearTimeout(timer);
                        finish(0);
                    };
                    v.src = src;
                }
            });
        },
        async openPreview(f, e) {
            if (!this.previewable(f)) return;
            /*
             * v1.1.4：图片优先用**缩略图**（该格子刚在网格里加载过，命中浏览器缓存，按住即出）；
             * 原图即便已缓存，元件也要重新 decode 一遍大图，手机上是肉眼可见的延迟。
             * 小眼睛只是「看一眼」的快速预览，用缩略图完全够。
             */
            const src = f.mediaKind === 'audio'
                ? (f.url || this.mountPreviewUrl(f))
                : (this.source === 'mount' ? this.mountPreviewUrl(f) : (f.thumbUrl || f.url || ''));
            if (!src) return;
            // 锚点：眼睛按钮自身的矩形（不是鼠标位置），浮层贴着眼睛弹出
            const rect = e && e.currentTarget && e.currentTarget.getBoundingClientRect
                ? e.currentTarget.getBoundingClientRect()
                : this._eyeRect;
            this._eyeRect = rect;
            this._previewSrc = src;
            const ratio = await this.probeRatio(f);
            // 探测期间用户可能已经松手 / 移到别的格子
            if (this._previewSrc !== src) return;
            this.showPreview(f, src, rect, ratio);
        },
        /**
         * 摆位：先按文件比例算浮层尺寸，再比较四周剩余空间，
         * 挑「装得下且余量最大」的那个方位 —— 保证浮层整体在按钮之外，不压住小眼睛。
         */
        showPreview(f, src, rect, ratio) {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            let w = PREVIEW_MAX;
            let h = PREVIEW_MAX;
            if (ratio && Number.isFinite(ratio) && ratio > 0) {
                if (ratio >= 1) {
                    w = PREVIEW_MAX;
                    h = Math.max(PREVIEW_MIN, Math.round(PREVIEW_MAX / ratio));
                } else {
                    h = PREVIEW_MAX;
                    w = Math.max(PREVIEW_MIN, Math.round(PREVIEW_MAX * ratio));
                }
            } else if (f.mediaKind === 'audio') {
                w = 260;
                h = 96;
            }
            // 视口装不下时按视口收
            w = Math.min(w, vw - PREVIEW_MARGIN * 2);
            h = Math.min(h, vh - PREVIEW_MARGIN * 2);
            const boxH = h + PREVIEW_HEAD_H;

            let left = (vw - w) / 2;
            let top = (vh - boxH) / 2;
            if (rect) {
                const space = {
                    right: vw - rect.right - PREVIEW_GAP - PREVIEW_MARGIN,
                    left: rect.left - PREVIEW_GAP - PREVIEW_MARGIN,
                    bottom: vh - rect.bottom - PREVIEW_GAP - PREVIEW_MARGIN,
                    top: rect.top - PREVIEW_GAP - PREVIEW_MARGIN
                };
                // 该方位「宽度方向」够不够（左右比宽，上下比高）
                const fits = {
                    right: space.right >= w,
                    left: space.left >= w,
                    bottom: space.bottom >= boxH,
                    top: space.top >= boxH
                };
                const sides = ['right', 'left', 'bottom', 'top'];
                const able = sides.filter((s) => fits[s]).sort((a, b) => space[b] - space[a]);
                const side = able[0] || sides.slice().sort((a, b) => space[b] - space[a])[0];
                if (side === 'right') {
                    left = rect.right + PREVIEW_GAP;
                    top = rect.top + rect.height / 2 - boxH / 2;
                } else if (side === 'left') {
                    left = rect.left - PREVIEW_GAP - w;
                    top = rect.top + rect.height / 2 - boxH / 2;
                } else if (side === 'bottom') {
                    top = rect.bottom + PREVIEW_GAP;
                    left = rect.left + rect.width / 2 - w / 2;
                } else {
                    top = rect.top - PREVIEW_GAP - boxH;
                    left = rect.left + rect.width / 2 - w / 2;
                }
            }
            // 最后统一夹进视口
            left = Math.min(Math.max(PREVIEW_MARGIN, left), Math.max(PREVIEW_MARGIN, vw - w - PREVIEW_MARGIN));
            top = Math.min(Math.max(PREVIEW_MARGIN, top), Math.max(PREVIEW_MARGIN, vh - boxH - PREVIEW_MARGIN));

            this.preview = {
                visible: true,
                src,
                type: f.mediaKind === 'video' ? 'video' : (f.mediaKind === 'audio' ? 'audio' : 'image'),
                name: this.displayName(f),
                w,
                h,
                left: Math.round(left),
                top: Math.round(top)
            };
            // 视频 / 音频：DOM 出来之后显式 play() 一次（带声音），
            // 浏览器若因自动播放策略拒绝，静默重试一次静音版（至少能看画面）。
            this.$nextTick(() => this.startPlayback());
        },
        startPlayback() {
            const el = this.$refs.previewVideo || this.$refs.previewAudio;
            if (!el) return;
            const p = el.play();
            if (p && typeof p.catch === 'function') {
                p.catch(() => {
                    try {
                        el.muted = true;
                        el.play();
                    } catch (e) {
                        /* 忽略 */
                    }
                });
            }
        },
        closePreview() {
            this.clearEyeTimer();
            this._previewSrc = '';
            if (!this.preview.visible) return;
            this.preview = { ...this.preview, visible: false };
        },
        eyeTouchStart(f, e) {
            this.clearEyeTimer();
            const touch = (e.touches && e.touches[0]) || e;
            this._eyeX = touch.clientX || 0;
            this._eyeY = touch.clientY || 0;
            // currentTarget 在事件派发结束后会被置空，必须在定时器外先取好
            const rect = e.currentTarget ? e.currentTarget.getBoundingClientRect() : null;
            this._eyeRect = rect;
            this._eyeFile = f;
            this._eyeTimer = setTimeout(() => {
                this._eyeTimer = null;
                this.openPreview(this._eyeFile, { currentTarget: { getBoundingClientRect: () => this._eyeRect } });
            }, EYE_PRESS_MS);
        },
        eyeTouchMove(e) {
            // 手指明显滑动（>10px）视为要滚动列表，取消长按；微抖不取消
            const touch = e.touches && e.touches[0];
            if (!touch || typeof this._eyeX !== 'number') return;
            const dx = touch.clientX - this._eyeX;
            const dy = touch.clientY - this._eyeY;
            if (dx * dx + dy * dy > 100) {
                this.clearEyeTimer();
                this.closePreview();
            }
        },
        eyeTouchEnd() {
            this.clearEyeTimer();
            this.closePreview();
        },
        clearEyeTimer() {
            if (this._eyeTimer) {
                clearTimeout(this._eyeTimer);
                this._eyeTimer = null;
            }
        }
    },
    beforeUnmount() {
        this.clearEyeTimer();
        if (this._unbindLayerDialogs) {
            this._unbindLayerDialogs();
            this._unbindLayerDialogs = null;
        }
    },
    mounted() {
        /*
         * v1.1.9.2：选择文件弹窗纳入层叠监测。
         * 它上面还会压「筛选」（FilterDialog 自己登记）和
         * 「上传到图床 → 选择目录」（UploadTargetDialog / DirectoryTreePicker 自己登记），
         * 这里只管自己这一层，从右到左关闭时顺序才正确。
         */
        this._unbindLayerDialogs = bindDialogLayers(this, {
            visible: { id: 'note-file-picker', close: () => { this.visible = false; } }
        });
    },
    watch: {
        visible(v) {
            if (!v) {
                this.picked = [];
                this.closePreview();
            }
        }
    }
};
</script>

<style scoped>
/* 数据源切换（文件分类的上一行） */
.np-source {
    display: flex;
    gap: 8px;
    flex: 0 0 auto;
    margin-bottom: 8px;
}

.np-source-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 14px;
    border: 1px solid var(--el-border-color, #dcdfe6);
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
}

.np-source-btn.is-active {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.1));
    color: var(--el-color-primary);
    font-weight: 600;
}

/*
 * v1.2.1（需求）：排序按钮贴在数据源这一行的最右。
 * 尺寸与 .np-source-btn 同高（33px = 5 + 5 内边距 + 21 行高 + 2 边框），
 * 只保留图标、去掉文字，免得和两个数据源按钮抢注意力。
 */
.np-sort-drop {
    margin-left: auto;
}

.np-sort-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 33px;
    padding: 0;
    border: 1px solid var(--el-border-color, #dcdfe6);
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;
}

.np-sort-btn:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
}

/*
 * 下拉面板的样式与图床管理页完全一致（那边是 scoped，下拉又被 teleport 到 body，
 * 所以不能指望复用，这里照抄一份同口径的规则）。
 */
.np-sort-drop + .el-popper .sort-dropdown-menu,
.sort-dropdown-menu {
    min-width: 205px;
}
.sort-order-wrapper {
    padding: 0 12px;
    text-align: center;
}

.sort-divider {
    margin: 8px 0 !important;
}

.sort-dropdown-menu :deep(.el-dropdown-menu__item) {
    justify-content: space-between;
}

.sort-dropdown-menu :deep(.el-dropdown-menu__item.is-selected) {
    color: var(--primary-color-accent, var(--el-color-primary));
}

.sort-field-check {
    width: 12px;
    margin-left: 16px;
}

.np-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 8px;
    flex: 0 0 auto;
}

.np-tabs {
    display: inline-flex;
    gap: 4px;
    padding: 3px;
    border-radius: 9px;
    background: var(--note-tabs-bg, rgba(127, 127, 127, 0.1));
}

.np-tab {
    padding: 4px 12px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
}

.np-tab.is-active {
    background: var(--note-tab-active-bg, #fff);
    color: var(--el-color-primary);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* 图床文件模式：搜索卡片 + 筛选按钮 */
.np-search-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 1 360px;
    min-width: 0;
}

.np-search-card {
    flex: 1 1 auto;
    min-width: 0;
    transition: flex-basis 0.2s ease;
}

.np-search-card :deep(.el-input__wrapper) {
    border-radius: 9px;
}

/* 点击后自动变宽一点（对齐图床管理页的手感） */
.np-search-card:focus-within {
    flex-basis: 300px;
}

.np-search-type {
    width: 78px;
    flex: 0 0 auto;
}

.np-search-type :deep(.el-select__wrapper) {
    box-shadow: none !important;
    background: transparent;
    padding-left: 0;
    padding-right: 0;
    min-height: 22px;
}

.np-search-type :deep(.el-select__selected-item) {
    font-size: 12px;
}

.np-search-sep {
    width: 1px;
    height: 12px;
    margin: 0 4px 0 2px;
    background: var(--el-border-color, #dcdfe6);
    flex: 0 0 auto;
}

.np-search-clear,
.np-search-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 11px;
    cursor: pointer;
}

.np-search-trigger:hover {
    color: var(--el-color-primary);
}

.np-filter-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex: 0 0 auto;
    border-radius: 8px;
    border: 1px solid var(--el-border-color, #dcdfe6);
    color: var(--el-text-color-regular);
    font-size: 12px;
    cursor: pointer;
}

.np-filter-btn:hover,
.np-filter-btn.is-active {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary);
}

.np-search {
    width: 220px;
}

.np-search-icon {
    cursor: pointer;
    opacity: 0.6;
}

/* 挂载文件：渠道 + 目录路径 */
.np-mount-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    margin-bottom: 8px;
    min-width: 0;
}

.np-mount-channel {
    width: 150px;
    flex: 0 0 auto;
}

.np-crumb-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex: 0 0 auto;
    border: 1px solid var(--el-border-color, #dcdfe6);
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 10px;
    cursor: pointer;
}

.np-crumb {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
    white-space: nowrap;
    font-size: 12px;
}

.np-crumb-item {
    padding: 2px 5px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--el-color-primary);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
}

.np-crumb-item:hover {
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.1));
}

.np-crumb-sep {
    color: var(--el-text-color-secondary);
}

/* 内容区自己滚：弹窗整体 96vh 高，滚动只发生在这一层 */
.np-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-right: 2px;
}

.np-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    gap: 8px;
}

.np-cell {
    position: relative;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    overflow: hidden;
    background: var(--note-cell-bg, rgba(127, 127, 127, 0.1));
    aspect-ratio: 1 / 1;
    cursor: pointer;
    font: inherit;
    color: inherit;
}

.np-cell-dir {
    border-color: var(--el-border-color-lighter, #ebeef5);
}

.np-cell.is-picked {
    border-color: var(--el-color-primary);
    box-shadow: 0 0 0 2px var(--el-color-primary-light-7, rgba(64, 158, 255, 0.3));
}

.np-cell.is-disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.np-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.np-cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 100%;
    height: 100%;
    padding: 6px;
    box-sizing: border-box;
    color: var(--note-cover-color, #6b7280);
}

.np-cover-icon {
    font-size: 18px;
}

.np-cover-name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    width: 100%;
    font-size: 11px;
    line-height: 1.3;
    text-align: center;
    word-break: break-all;
}

/* 视频角标 */
.np-play {
    position: absolute;
    left: 50%;
    top: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    margin: -13px 0 0 -13px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
    font-size: 10px;
    pointer-events: none;
}

/* 小眼睛：左下角，半透明，悬停/按下时变实 */
.np-eye {
    position: absolute;
    left: 4px;
    bottom: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
    font-size: 10px;
    cursor: pointer;
    opacity: 0.75;
    transition: opacity 0.15s ease, background 0.15s ease;
    /* 长按不要触发系统菜单 / 文本选择 */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    touch-action: none;
}

.np-eye:hover,
.np-eye:active {
    opacity: 1;
    background: var(--el-color-primary);
}

.np-check {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 10px;
}

.np-added {
    position: absolute;
    left: 4px;
    bottom: 4px;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 10px;
}

.np-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 48px 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

.np-empty-icon {
    font-size: 26px;
    opacity: 0.5;
}

.np-end {
    margin: 12px 0 2px;
    text-align: center;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.np-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
}

.np-count {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.np-footer-btns {
    display: flex;
    gap: 8px;
    margin-left: auto;
}

@media (max-width: 768px) {
    .np-search,
    .np-search-wrap {
        width: 100%;
        flex-basis: auto;
    }

    .np-grid {
        grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
        gap: 6px;
    }
}
</style>

<style>
/* 预览浮层：挂到 body 上，必须全局样式 */
.np-preview {
    position: fixed;
    /*
     * v1.1.9：4000 → 4600。
     * App.vue 把 Element Plus 的 z-index 基准从 2000 提到了 4000（为了让文件详情等弹窗
     * 稳定盖在 z-index 3200 的文件灯箱之上）。本组件自身就是 EP 弹窗、叠加在「发布瞬间」
     * 弹窗之上，实际层级已经是 4000 + 累积值 —— 预览浮层若还写死 4000，就会被**自己的
     * 弹窗**盖住，鼠标悬停缩略图时看不到预览。这里固定压在 EP 弹窗之上。
     */
    z-index: 4600;
    display: flex;
    flex-direction: column;
    padding: 6px;
    box-sizing: border-box;
    border-radius: 10px;
    background: rgba(20, 20, 20, 0.86);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    animation: np-preview-in 0.12s ease-out;
}

/* 顶部文件名（需求：预览时在顶部显示文件名称） */
.np-preview-head {
    height: 26px;
    flex: 0 0 26px;
    display: flex;
    align-items: center;
    padding: 0 4px;
    min-width: 0;
}

.np-preview-name {
    display: block;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    line-height: 1.2;
    color: #fff;
}

.np-preview-stage {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 6px;
    background: #0b0b0b;
}

.np-preview-media {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 6px;
    display: block;
}

.np-preview-audio {
    width: 0;
    height: 0;
    opacity: 0;
}

.np-preview-audio-face {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    color: #fff;
}

.np-preview-audio-icon {
    font-size: 22px;
    opacity: 0.85;
}

.np-preview-audio-hint {
    font-size: 11px;
    opacity: 0.6;
}

@keyframes np-preview-in {
    from {
        opacity: 0;
        transform: scale(0.96);
    }

    to {
        opacity: 1;
        transform: scale(1);
    }
}

/*
 * 弹窗本体：高度 = 窗口 96%（需求）。
 * same trick as MomentPublishDialog —— flex 纵向布局，头部/底部固定，
 * body 撑满剩余空间并作为滚动容器。
 */
.el-dialog.file-picker-dialog {
    display: flex;
    flex-direction: column;
    height: 96vh;
    max-height: 96vh;
    margin: 2vh auto;
}

.el-dialog.file-picker-dialog .el-dialog__header {
    flex: 0 0 auto;
}

.el-dialog.file-picker-dialog .el-dialog__body {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    padding-top: 6px;
    padding-bottom: 6px;
}

.el-dialog.file-picker-dialog .el-dialog__footer {
    flex: 0 0 auto;
}

/* v1.1.7：移动端宽高一起改为 98%（宽度在 dialogWidth 里给，这里补高度） */
@media (max-width: 768px) {
    .el-dialog.file-picker-dialog {
        height: 98vh;
        max-height: 98vh;
        margin: 1vh auto;
    }
}
</style>
