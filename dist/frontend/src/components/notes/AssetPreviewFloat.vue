<template>
    <!--
        v1.3.3（需求）：瞬间编辑页的小眼睛预览，要和「选择文件」弹窗里的完全一致。
        为了不复制一份会漂移的实现，这里把那段浮层抽成独立组件：
        同样的尺寸策略（最长边 300）、同样的贴边方位选择、同样的头部文件名与动画。
    -->
    <teleport to="body">
        <div v-if="visible" class="np-preview" :style="boxStyle" aria-hidden="true">
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
/** 浮层最长边（与 FilePickerDialog 同一口径） */
const PREVIEW_MAX = 300;
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
        return { w: PREVIEW_MAX, h: PREVIEW_MAX, left: 0, top: 0 };
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
            if (v) this.layout();
        },
        src() {
            if (this.visible) this.layout();
        }
    },
    mounted() {
        if (this.visible) this.layout();
    },
    methods: {
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
            const anchor = this.anchor;
            const ratio = await this.probeRatio();
            if (!this.visible) return;

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
            } else if (this.type === 'audio') {
                w = 260;
                h = 96;
            } else if (this.type === 'file') {
                w = 240;
                h = 120;
            }
            w = Math.min(w, vw - PREVIEW_MARGIN * 2);
            h = Math.min(h, vh - PREVIEW_MARGIN * 2);
            const boxH = h + PREVIEW_HEAD_H;

            let left = (vw - w) / 2;
            let top = (vh - boxH) / 2;
            if (anchor) {
                const space = {
                    right: vw - anchor.right - PREVIEW_GAP - PREVIEW_MARGIN,
                    left: anchor.left - PREVIEW_GAP - PREVIEW_MARGIN,
                    bottom: vh - anchor.bottom - PREVIEW_GAP - PREVIEW_MARGIN,
                    top: anchor.top - PREVIEW_GAP - PREVIEW_MARGIN
                };
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
                    left = anchor.right + PREVIEW_GAP;
                    top = anchor.top + anchor.height / 2 - boxH / 2;
                } else if (side === 'left') {
                    left = anchor.left - PREVIEW_GAP - w;
                    top = anchor.top + anchor.height / 2 - boxH / 2;
                } else if (side === 'bottom') {
                    top = anchor.bottom + PREVIEW_GAP;
                    left = anchor.left + anchor.width / 2 - w / 2;
                } else {
                    top = anchor.top - PREVIEW_GAP - boxH;
                    left = anchor.left + anchor.width / 2 - w / 2;
                }
            }
            left = Math.min(Math.max(PREVIEW_MARGIN, left), Math.max(PREVIEW_MARGIN, vw - w - PREVIEW_MARGIN));
            top = Math.min(Math.max(PREVIEW_MARGIN, top), Math.max(PREVIEW_MARGIN, vh - boxH - PREVIEW_MARGIN));

            this.w = Math.round(w);
            this.h = Math.round(h);
            this.left = Math.round(left);
            this.top = Math.round(top);
            this.$nextTick(() => this.startPlayback());
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
