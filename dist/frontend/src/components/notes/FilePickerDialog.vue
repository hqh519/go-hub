<template>
    <!--
        「图床选择」文件选择器（v1.1.2 改版）
        ----------------------------------------------------------------------------
        为什么不直接复用后台文件管理页：
          · 那个页面带目录树、批量操作、拖拽移动、回收站……对本场景全是噪声；
          · 这里只需要「按类型筛 + 搜索 + 点选」，一个弹窗就能装下。
        数据走 /api/notes/files（只读接口，按实例与账户收窄），
        **不改动图床任何既有接口**。

        v1.1.2 变更点（对照需求）：
          · 弹窗高度 = 窗口 96%，内容区自己滚，不再把整页顶出去
          · 滚动到底自动加载下一页，去掉「加载更多」按钮
          · 视频格加载首帧缩略图（前端 <video> + canvas 抽帧，见 utils/videoPoster）
          · 缩略图左下角加「小眼睛」：按住出预览、放开关闭
            （PC 悬停即出；触屏长按 300ms 出，参考 go-imgbed-2.9.0 的交互）
          · 类型去掉「全部」，改成 图片 / 视频 / 音频 / 其他，默认停在「图片」
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
            <el-input
                v-model="search"
                class="np-search"
                size="small"
                clearable
                :placeholder="$t('notes.pickFileSearch')"
                @keyup.enter="reload"
                @clear="reload"
            >
                <template #suffix>
                    <font-awesome-icon icon="search" class="np-search-icon" @click="reload" />
                </template>
            </el-input>
        </div>

        <div ref="bodyEl" class="np-body" v-loading="loading && !list.length" @scroll.passive="onScroll">
            <div v-if="!list.length && !loading" class="np-empty">
                <font-awesome-icon :icon="emptyIcon" class="np-empty-icon" />
                <p>{{ $t('notes.pickFileEmpty') }}</p>
            </div>
            <div v-else class="np-grid">
                <button
                    v-for="f in list"
                    :key="f.id"
                    type="button"
                    class="np-cell"
                    :class="{ 'is-picked': pickedMap[f.id], 'is-disabled': excluded.includes(f.id) }"
                    :disabled="excluded.includes(f.id)"
                    :title="f.originalName"
                    @click="toggle(f)"
                >
                    <!--
                        图片 / 视频都优先显示缩略图；
                        加载失败（文件已被删除 / 抽帧不支持）时退回图标卡，
                        否则整格是一个破图标，看起来像页面坏了。
                    -->
                    <img
                        v-if="coverOf(f) && !f.broken"
                        :src="coverOf(f)"
                        class="np-img"
                        loading="lazy"
                        alt=""
                        @error="f.broken = true"
                    />
                    <span v-else class="np-cover">
                        <font-awesome-icon :icon="iconOf(f)" class="np-cover-icon" />
                        <span class="np-cover-name">{{ f.originalName }}</span>
                    </span>

                    <!-- 视频：缩略图上压一个播放角标，一眼能和图片区分 -->
                    <span v-if="f.mediaKind === 'video' && coverOf(f)" class="np-play">
                        <font-awesome-icon icon="play" />
                    </span>

                    <!-- 小眼睛：按住加载预览，放开关闭 -->
                    <span
                        v-if="f.mediaKind === 'image' || f.mediaKind === 'video'"
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

                    <span v-if="pickedMap[f.id]" class="np-check">
                        <font-awesome-icon icon="check" />
                    </span>
                    <span v-if="excluded.includes(f.id)" class="np-added">{{ $t('notes.pickFileAdded') }}</span>
                </button>
            </div>

            <!-- 滚动到底自动加载：这里只留状态文案，不再占一个按钮 -->
            <p v-if="loading && list.length" class="np-end">{{ $t('notes.loading') }}</p>
            <p v-else-if="!hasMore && list.length" class="np-end">{{ $t('notes.pickFileEnd', { n: total }) }}</p>
        </div>

        <template #footer>
            <div class="np-footer">
                <span class="np-count">{{ $t('notes.pickFilePicked', { n: picked.length }) }}</span>
                <div class="np-footer-btns">
                    <el-button size="small" @click="visible = false">{{ $t('common.cancel') }}</el-button>
                    <el-button size="small" type="primary" :disabled="!picked.length" @click="confirm">
                        {{ $t('notes.pickFileConfirm') }}
                    </el-button>
                </div>
            </div>
        </template>

        <!-- 预览浮层：teleport 到 body，position: fixed，跟着小眼睛走 -->
        <teleport to="body">
            <div v-if="preview.visible" class="np-preview" :style="previewStyle" aria-hidden="true">
                <video
                    v-if="preview.type === 'video'"
                    :src="preview.src"
                    class="np-preview-media"
                    autoplay
                    muted
                    loop
                    playsinline
                ></video>
                <img v-else :src="preview.src" class="np-preview-media" alt="" decoding="async" />
            </div>
        </teleport>
    </el-dialog>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import { formatSize } from '@/utils/notes';
import { videoPoster } from '@/utils/videoPoster';

/** 预览浮层边长（正方形画布，media 用 object-fit: contain 装进去） */
const PREVIEW_SIZE = 300;
/** 触屏长按多久算「按住预览」 */
const EYE_PRESS_MS = 300;
/** 距底部多少像素开始预加载下一页 */
const SCROLL_TRIGGER = 160;

export default {
    name: 'FilePickerDialog',
    props: {
        modelValue: { type: Boolean, default: false },
        instanceId: { type: String, default: '' },
        /** 已经加进瞬间的文件 id —— 不允许重复选（后端也有唯一约束兜底） */
        excludeIds: { type: Array, default: () => [] }
    },
    emits: ['update:modelValue', 'confirm'],
    data() {
        return {
            // 默认「图片」：绝大多数场景就是找图，少点一次
            type: 'image',
            search: '',
            list: [],
            total: 0,
            page: 1,
            pageSize: 24,
            loading: false,
            picked: [],
            loaded: false,
            /** 视频首帧：id -> dataURL */
            posters: {},
            preview: { visible: false, src: '', type: 'image', left: 0, top: 0 }
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
            return window.innerWidth < 768 ? '94%' : '820px';
        },
        typeTabs() {
            return [
                { value: 'image', label: 'notes.mediaImage' },
                { value: 'video', label: 'notes.mediaVideo' },
                { value: 'audio', label: 'notes.mediaAudio' },
                { value: 'other', label: 'notes.mediaOther' }
            ];
        },
        emptyIcon() {
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
            for (const f of this.picked) map[f.id] = true;
            return map;
        },
        hasMore() {
            return this.list.length < this.total;
        },
        previewStyle() {
            return {
                left: `${this.preview.left}px`,
                top: `${this.preview.top}px`,
                width: `${PREVIEW_SIZE}px`,
                height: `${PREVIEW_SIZE}px`
            };
        }
    },
    methods: {
        formatSize,
        iconOf(f) {
            if (f.mediaKind === 'image') return 'images';
            if (f.mediaKind === 'video') return 'film';
            if (f.mediaKind === 'audio') return 'music';
            if (f.fileType === 'pdf') return 'file-pdf';
            if (f.fileType === 'txt') return 'file-alt';
            return 'file';
        },
        /** 格子封面：图片用后端缩略图，视频用前端抽出的首帧 */
        coverOf(f) {
            if (f.mediaKind === 'image') return f.thumbUrl || f.url || '';
            if (f.mediaKind === 'video') return this.posters[f.id] || '';
            return '';
        },

        /* ── 打开 / 关闭 ───────────────────────────────────────── */
        onOpen() {
            if (this.loaded) return;
            this.loaded = true;
            this.reload();
        },
        onClosed() {
            // 每次关闭都清掉待选状态与预览，避免下次打开还挂着上一轮
            this.picked = [];
            this.closePreview();
        },

        /* ── 数据 ───────────────────────────────────────────────── */
        switchType(v) {
            if (this.type === v) return;
            this.type = v;
            this.closePreview();
            this.reload();
        },
        reload() {
            this.page = 1;
            this.list = [];
            this.total = 0;
            return this.fetch(true);
        },
        loadMore() {
            if (this.loading || !this.hasMore) return;
            this.page += 1;
            return this.fetch(false);
        },
        /** 滚动到底自动加载（阈值留 160px，滚到底之前就开始拉，观感上不会卡一下） */
        onScroll() {
            const el = this.$refs.bodyEl;
            if (!el) return;
            if (!this.hasMore || this.loading) return;
            const rest = el.scrollHeight - el.scrollTop - el.clientHeight;
            if (rest < SCROLL_TRIGGER) this.loadMore();
        },
        async fetch(reset) {
            this.loading = true;
            try {
                const qs = new URLSearchParams();
                qs.set('page', String(this.page));
                qs.set('pageSize', String(this.pageSize));
                qs.set('instanceId', this.instanceId || '');
                if (this.type) qs.set('type', this.type);
                if (this.search.trim()) qs.set('search', this.search.trim());
                const res = await fetchWithAuth(`/api/notes/files?${qs.toString()}`);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || 'load failed');
                const rows = Array.isArray(data.list) ? data.list : [];
                this.total = Number(data.total) || 0;
                this.list = reset ? rows : this.list.concat(rows);
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

        /* ── 选择 ───────────────────────────────────────────────── */
        toggle(f) {
            if (this.excluded.includes(f.id)) return;
            const idx = this.picked.findIndex((x) => x.id === f.id);
            if (idx >= 0) this.picked.splice(idx, 1);
            else this.picked.push(f);
        },
        confirm() {
            this.$emit('confirm', this.picked.slice());
            this.visible = false;
        },

        /* ── 小眼睛：按住预览 ───────────────────────────────────── */
        openPreview(f, e) {
            const src = f.mediaKind === 'video' ? (f.url || '') : (f.url || f.thumbUrl || '');
            if (!src) return;
            // 锚点：眼睛按钮自身的矩形（不是鼠标位置），浮层贴着眼睛弹出
            const rect = e && e.currentTarget ? e.currentTarget.getBoundingClientRect() : null;
            let left = 8;
            let top = 8;
            if (rect) {
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                // 右边放不下就放左边，两边都放不下就居中
                if (rect.right + 12 + PREVIEW_SIZE <= vw - 8) left = rect.right + 12;
                else if (rect.left - 12 - PREVIEW_SIZE >= 8) left = rect.left - 12 - PREVIEW_SIZE;
                else left = Math.max(8, (vw - PREVIEW_SIZE) / 2);
                top = rect.top + rect.height / 2 - PREVIEW_SIZE / 2;
                top = Math.min(Math.max(8, top), Math.max(8, vh - PREVIEW_SIZE - 8));
            }
            this.preview = {
                visible: true,
                src,
                type: f.mediaKind === 'video' ? 'video' : 'image',
                left,
                top
            };
        },
        closePreview() {
            this.clearEyeTimer();
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
.np-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 10px;
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

.np-search {
    width: 220px;
}

.np-search-icon {
    cursor: pointer;
    opacity: 0.6;
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
    .np-search {
        width: 100%;
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
    z-index: 4000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    box-sizing: border-box;
    border-radius: 10px;
    background: rgba(20, 20, 20, 0.82);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    animation: np-preview-in 0.12s ease-out;
}

.np-preview-media {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 6px;
    display: block;
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
</style>
