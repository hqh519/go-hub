<template>
    <!--
        v1.3.3（需求）：瞬间编辑页的小眼睛预览，要和「选择文件」弹窗里的完全一致。
        为了不复制一份会漂移的实现，这里把那段浮层抽成独立组件：
        同样的尺寸策略（最长边 300）、同样的贴边方位选择、同样的头部文件名与动画。
    -->
    <teleport to="body">
        <div
            v-if="visible"
            class="np-preview"
            :class="{ 'is-positioned': positioned }"
            :style="boxStyle"
            aria-hidden="true"
        >
            <div class="np-preview-head" :title="name">
                <span class="np-preview-name">{{ name }}</span>
            </div>
            <div class="np-preview-stage" :style="{ height: h + 'px' }">
                <video
                    v-if="type === 'video'"
                    ref="videoEl"
                    :src="src"
                    class="np-preview-media"
                    autoplay
                    loop
                    playsinline
                ></video>
                <audio v-else-if="type === 'audio'" ref="audioEl" :src="src" autoplay></audio>
                <span v-if="type === 'audio'" class="np-preview-audio-face">
                    <font-awesome-icon icon="music" class="np-preview-audio-icon" />
                    <span class="np-preview-audio-hint">{{ $t('notes.mediaAudio') }}</span>
                </span>
                <img v-else-if="type === 'image'" :src="src" class="np-preview-media" alt="" decoding="async" />
                <span v-else class="np-preview-audio-face">
                    <font-awesome-icon icon="file" class="np-preview-audio-icon" />
                    <span class="np-preview-audio-hint">{{ name }}</span>
                </span>
            </div>
        </div>
    </teleport>
</template>

<script>
/**
 * v1.3.4.2（需求：长按预览的框要大一些，参考旧版图床管理页的小眼睛）
 *
 * 旧版 HoverPreview 的策略是「高度优先、最长 90% 视口」；
 * 这里沿用同一口径，同时保留一个桌面端的绝对上限，避免大屏上夸张。
 */
const PREVIEW_MAX = 760;
const PREVIEW_VIEWPORT = 0.9;
const PREVIEW_MIN = 120;
const PREVIEW_MARGIN = 8;
const PREVIEW_GAP = 8;
const PREVIEW_HEAD_H = 26;

export default {
    name: 'AssetPreviewFloat',
    props: {
        visible: { type: Boolean, default: false },
        /** 预览地址（图片优先缩略图，视频/音频用原地址） */
        src: { type: String, default: '' },
        /** image / video / audio / file */
        kind: { type: String, default: 'image' },
        name: { type: String, default: '' },
        /** 锚点：小眼睛按钮的 getBoundingClientRect() 快照 */
        anchor: { type: Object, default: null }
    },
    data() {
        return {
            w: PREVIEW_MAX,
            h: PREVIEW_MAX,
            left: 0,
            top: 0,
            /*
             * v1.3.5（需求：桌面端长按预览会先闪一下再跳到正确位置）
             * 几何算完之前元素虽然存在，但不许显形（CSS 里 opacity/visibility 兜着）。
             * 之前是 v-if 一挂载就按 data 里的 760×760 @ (0,0) 上屏，
             * 再等 probeRatio() 异步量完才跳过去，所以会看到一次「大框在左上角闪一下」。
             */
            positioned: false
        };
    },
    computed: {
        type() {
            if (this.kind === 'video') return 'video';
            if (this.kind === 'audio') return 'audio';
            if (this.kind === 'file') return 'file';
            return 'image';
        },
        boxStyle() {
            return {
                left: `${this.left}px`,
                top: `${this.top}px`,
                width: `${this.w}px`
            };
        }
    },
    watch: {
        visible(v) {
            if (v) {
                // 每次重新打开都重新等一次定位：沿用上一次的坐标会先闪一下旧位置
                this.positioned = false;
                this.scheduleLayout();
            } else {
                this.positioned = false;
                // v1.3.4.2：浮层一关就停掉音视频，绝不能留到后台继续播
                this.pauseMedia();
            }
        },
        src() {
            if (this.visible) this.scheduleLayout();
        }
    },
    mounted() {
        if (this.visible) this.scheduleLayout();
    },
    methods: {
        /**
         * v1.3.5：visible / src / anchor 常常在同一批更新里一起变化，
         * 逐个 watch 各跑一次 layout 会算两遍并让浮层跳两次；合到一次 nextTick。
         */
        scheduleLayout() {
            if (this._layoutQueued) return;
            this._layoutQueued = true;
            this.$nextTick(() => {
                this._layoutQueued = false;
                if (this.visible) this.layout();
            });
        },
        /** 探测宽高比；失败返回 0（按正方形兜底，不能一直等） */
        probeRatio() {
            const src = this.src;
            if (!src || this.type === 'audio' || this.type === 'file') return Promise.resolve(0);
            return new Promise((resolve) => {
                let done = false;
                const finish = (v) => {
                    if (done) return;
                    done = true;
                    resolve(v || 0);
                };
                const timer = setTimeout(() => finish(0), 1500);
                if (this.type === 'image') {
                    const img = new Image();
                    img.onload = () => {
                        clearTimeout(timer);
                        finish(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0);
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
        async layout() {
            /*
             * v1.3.5：probeRatio() 是异步的（要等图片/视频元数据），
             * 期间可能又有一次 layout 进来。用序号只认最后一次，
             * 否则先算完的旧结果会把新结果覆盖回去，表现成「定好位又跳一下」。
             */
            const seq = (this._layoutSeq || 0) + 1;
            this._layoutSeq = seq;
            const anchor = this.anchor;
            const ratio = await this.probeRatio();
            if (seq !== this._layoutSeq || !this.visible) return;

            const vw = window.innerWidth;
            const vh = window.innerHeight;
            /*
             * v1.3.4.2（需求：预览框要更大）
             * 旧版（图床管理页的小眼睛）是「高度优先、最长 90% 视口」；
             * 这里照同一套来：先按 90vh 定高、按真实比例算宽，宽超 90vw 再反算。
             * 之前固定 360 的正方形，横图只能显示成 360×202，手机上尤其小。
             */
            const maxW = Math.max(200, Math.round(Math.min(vw * PREVIEW_VIEWPORT, PREVIEW_MAX)));
            const maxH = Math.max(140, Math.round(vh * PREVIEW_VIEWPORT) - PREVIEW_HEAD_H);
            let w;
            let h;
            if (ratio && Number.isFinite(ratio) && ratio > 0) {
                h = maxH;
                w = Math.round(h * ratio);
                if (w > maxW) {
                    w = maxW;
                    h = Math.round(w / ratio);
                }
                // 极端长图 / 长条横幅：保证两个方向都还有可见面积
                if (w < PREVIEW_MIN) {
                    w = PREVIEW_MIN;
                    h = Math.max(PREVIEW_MIN, Math.round(w / ratio));
                }
                if (h < PREVIEW_MIN) {
                    h = PREVIEW_MIN;
                    w = Math.max(PREVIEW_MIN, Math.round(h * ratio));
                }
            } else if (this.type === 'audio') {
                w = Math.min(420, maxW);
                h = 96;
            } else if (this.type === 'file') {
                w = Math.min(420, maxW);
                h = Math.max(160, Math.round(w * 0.6));
            } else {
                // 比例未知（图片还没加载出来）：给一个偏大的方框，加载完会再收敛
                w = Math.min(maxW, 520);
                h = Math.min(maxH, 520);
            }
            w = Math.min(w, maxW);
            h = Math.min(h, maxH);

            let left = (vw - w) / 2;
            let top = (vh - h - PREVIEW_HEAD_H) / 2;
            if (anchor) {
                /*
                 * 贴着眼睛四向择大（与旧版 anchoredStyle 一致）：
                 * 先选空间最大的一侧，再把浮层缩进该侧可用区域，保证不覆盖小眼睛、
                 * 也不越出视口。空间不足时宁可缩小，也不翻到更窄的一侧。
                 */
                const space = {
                    right: vw - anchor.right - PREVIEW_GAP - PREVIEW_MARGIN,
                    left: anchor.left - PREVIEW_GAP - PREVIEW_MARGIN,
                    bottom: vh - anchor.bottom - PREVIEW_GAP - PREVIEW_MARGIN,
                    top: anchor.top - PREVIEW_GAP - PREVIEW_MARGIN
                };
                const sides = ['right', 'bottom', 'top', 'left'];
                let side = sides[0];
                let best = -Infinity;
                for (const s of sides) {
                    if (space[s] > best) {
                        best = space[s];
                        side = s;
                    }
                }
                const availW = (side === 'left' || side === 'right')
                    ? Math.max(80, space[side])
                    : Math.max(80, vw - PREVIEW_MARGIN * 2);
                const availH = (side === 'top' || side === 'bottom')
                    ? Math.max(80, space[side])
                    : Math.max(80, vh - PREVIEW_MARGIN * 2);
                const scale = Math.min(1, availW / Math.max(1, w), availH / Math.max(1, h + PREVIEW_HEAD_H));
                w = Math.round(w * scale);
                h = Math.round(h * scale);
                if (side === 'right') {
                    left = anchor.right + PREVIEW_GAP;
                    top = anchor.top + anchor.height / 2 - (h + PREVIEW_HEAD_H) / 2;
                } else if (side === 'left') {
                    left = anchor.left - PREVIEW_GAP - w;
                    top = anchor.top + anchor.height / 2 - (h + PREVIEW_HEAD_H) / 2;
                } else if (side === 'bottom') {
                    top = anchor.bottom + PREVIEW_GAP;
                    left = anchor.left + anchor.width / 2 - w / 2;
                } else {
                    top = anchor.top - PREVIEW_GAP - (h + PREVIEW_HEAD_H);
                    left = anchor.left + anchor.width / 2 - w / 2;
                }
            }
            const boxH = h + PREVIEW_HEAD_H;
            left = Math.min(Math.max(PREVIEW_MARGIN, left), Math.max(PREVIEW_MARGIN, vw - w - PREVIEW_MARGIN));
            top = Math.min(Math.max(PREVIEW_MARGIN, top), Math.max(PREVIEW_MARGIN, vh - boxH - PREVIEW_MARGIN));

            this.w = Math.round(w);
            this.h = Math.round(h);
            this.left = Math.round(left);
            this.top = Math.round(top);
            /*
             * v1.3.5：几何全部写进去之后才允许显形。
             * 这一行与 CSS 的 .is-positioned 配合，是「不闪烁」的关键：
             * 元素在定位期间 opacity:0 / visibility:hidden，用户永远看不到中间态。
             */
            this.positioned = true;
            this.$nextTick(() => this.startPlayback());
        },
        /**
         * v1.3.4.2：停掉预览里的媒体。
         * 除了 pause，还把 currentTime 归零 —— 下次长按同一附件时从头播，
         * 而不是接着上一次的进度继续（用户预期是一次新的预览）。
         */
        pauseMedia() {
            const v = this.$refs.videoEl;
            const a = this.$refs.audioEl;
            for (const el of [v, a]) {
                if (!el) continue;
                try {
                    if (!el.paused) el.pause();
                    el.currentTime = 0;
                } catch (e) {
                    /* 元素已卸载 / 元数据未就绪时忽略 */
                }
            }
        },
        startPlayback() {
            const el = this.$refs.videoEl || this.$refs.audioEl;
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
        }
    }
};
</script>

<style scoped>
/* 与 FilePickerDialog 的 .np-preview 完全一致（同一套尺寸与观感） */
.np-preview {
    position: fixed;
    z-index: 5200;
    display: flex;
    flex-direction: column;
    padding: 6px;
    box-sizing: border-box;
    border-radius: 10px;
    background: rgba(20, 20, 20, 0.86);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    /*
     * v1.3.5（需求：桌面端长按预览会闪烁）
     * 定位完成前保持不可见：此时元素尺寸/坐标还是初始的 760×760 @ (0,0)，
     * 一旦上屏就是「左上角闪一个大框」。is-positioned 由 layout() 算完后置位。
     */
    opacity: 0;
    visibility: hidden;
}

/* 定位完成才显形，并只在这一次播放淡入动画 */
.np-preview.is-positioned {
    opacity: 1;
    visibility: visible;
    animation: np-preview-in 0.12s ease-out;
}

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

/* 铺满整个预览舞台（等比不变形）—— 缩略图尺寸偏小时也能看清 */
.np-preview-media {
    width: 100%;
    height: 100%;
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
    padding: 0 8px;
    text-align: center;
}

.np-preview-audio-icon {
    font-size: 22px;
    opacity: 0.85;
}

.np-preview-audio-hint {
    font-size: 11px;
    opacity: 0.6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
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
</style>
