<template>
    <!--
        v2.8.5：后台文件管理「悬停预览大图」浮层（仅 PC）。
        - 视频自动播放（静音循环），图片按原始比例展示
        - v2.8.6b：锚定定位 —— 传入眼睛按钮矩形（anchor）时，浮层贴着眼睛弹出，
          自动比较 上/下/左/右 四个方向的可视空间，哪边大放哪边，且永不覆盖眼睛；
          PC 悬停与移动端长按都走这一套
        - 未传 anchor 时保持旧行为：跟随鼠标智能左右定位
        - 媒体比例未知（未加载完成）时按 90vh 高度占位，加载后按真实比例收敛
        - 地址与卡片/列表缩略图同源（/file/xxx?from=admin），浏览器缓存复用
    -->
    <teleport to="body">
        <div
            v-if="visible"
            ref="popupRef"
            class="hover-preview-popup"
            :style="popupStyle"
        >
            <video
                v-if="type === 'video'"
                ref="videoEl"
                :src="src"
                autoplay
                muted
                loop
                class="hover-preview-media"
                @loadedmetadata="onMediaLoad"
                @canplay="startVideo"
            ></video>
            <img
                v-else
                :src="src"
                class="hover-preview-media"
                decoding="async"
                @load="onMediaLoad"
            />
        </div>
    </teleport>
</template>

<script>
export default {
    name: 'HoverPreview',
    props: {
        visible: { type: Boolean, default: false },
        // 锚点（鼠标位置，视口坐标）
        x: { type: Number, default: 0 },
        y: { type: Number, default: 0 },
        src: { type: String, default: '' },
        type: { type: String, default: 'image' }, // 'image' | 'video'
        // v2.8.6：触屏长按预览 —— 浮层居中显示（不再跟随手指位置，避免贴边）
        touch: { type: Boolean, default: false },
        // v2.8.6b：锚定矩形（眼睛按钮 getBoundingClientRect 的 JSON）
        // { left, top, right, bottom, width, height } —— 传入后走「贴眼四向择大」定位
        anchor: { type: Object, default: null },
    },
    data() {
        return {
            ratio: null, // 加载完成后算出的宽高比（w/h），null = 比例未知
        };
    },
    computed: {
        /** v2.8.7：跟随文件管理右上角的全局视频静音开关（Vuex 持久化） */
        videoMuted() {
            return this.$store ? this.$store.state.globalVideoMuted : true;
        },
        popupStyle() {
            const innerW = window.innerWidth;
            const innerH = window.innerHeight;
            const maxH = innerH * 0.9;
            const maxW = innerW * 0.9;
            let w = null;
            let h = maxH; // 比例未知 → 高 90vh，宽度自适应内容
            if (this.ratio) {
                h = Math.min(maxH, innerH - 16);
                w = h * this.ratio;
                if (w > maxW) {
                    w = maxW;
                    h = w / this.ratio;
                }
            }
            if (this.anchor) {
                return this.anchoredStyle(innerW, innerH, maxW, w, h);
            }
            if (this.touch) {
                // 触屏（无锚点兜底）：始终居中，尺寸按 90% 视口收敛
                const style = {
                    top: `${Math.max((innerH - h) / 2, 8)}px`,
                    left: `${Math.max((innerW - (w === null ? maxW : w)) / 2, 8)}px`,
                    height: `${h}px`,
                };
                if (w !== null) style.width = `${w}px`;
                else style.maxWidth = `${maxW}px`;
                return style;
            }
            // 智能左右：锚点在左半屏 → 浮层放右侧；否则放左侧
            const onRight = this.x <= innerW / 2;
            const gap = 18;
            let left;
            if (onRight) {
                left = Math.min(this.x + gap, innerW - (w || 320) - 8);
            } else if (w !== null) {
                left = Math.max(this.x - gap - w, 8);
            } else {
                // 宽度未知时用 transform 兜底
                left = Math.max(this.x - gap, 8);
            }
            const top = Math.min(Math.max(this.y - h / 2, 8), innerH - h - 8);
            const style = {
                top: `${top}px`,
                left: `${left}px`,
                height: `${h}px`,
            };
            if (w !== null) style.width = `${w}px`;
            else style.maxWidth = `${maxW}px`;
            if (!onRight && w === null) style.transform = 'translateX(-100%)';
            return style;
        },
    },
    watch: {
        // 切换文件时重置比例，回到「比例未知」的 90vh 占位
        src() {
            this.ratio = null;
        },
        visible(v) {
            if (!v) {
                this.ratio = null;
                // v2.8.7b：预览浮层消失时同步暂停视频，不允许关掉后继续播放
                this.pauseVideo();
            }
        },
        // v2.8.7b：静音开关切换时实时应用到已挂载的 video 元素
        videoMuted(v) {
            const el = this.$refs.videoEl;
            if (!el) return;
            el.muted = v;
            // 关掉静音后若视频处于暂停（此前被浏览器策略拦下），补一次播放
            if (!v && el.paused) el.play().catch(() => { el.muted = true; });
        },
    },
    methods: {
        onMediaLoad(e) {
            const el = e.target;
            const w = el.videoWidth || el.naturalWidth;
            const h = el.videoHeight || el.naturalHeight;
            if (w && h) this.ratio = w / h;
        },
        /**
         * v2.8.7b：视频起播策略 —— 始终先以静音起播（浏览器 autoplay 策略对静音视频放行，
         * 修复「开启声音模式后预览视频长时间不出画面」），可播放后再按全局开关设置声音。
         * play() 被拒（极端场景）时回退静音重试，保证有画面。
         */
        startVideo() {
            const el = this.$refs.videoEl;
            if (!el) return;
            el.muted = true;
            const p = el.play();
            if (p && typeof p.then === 'function') {
                p.then(() => { el.muted = this.videoMuted; }).catch(() => {});
            }
        },
        pauseVideo() {
            const el = this.$refs.videoEl;
            if (el && !el.paused) el.pause();
        },
        /**
         * v2.8.6b：贴眼四向择大定位。
         * 先比较眼睛矩形四周 上/下/左/右 的可视空间选一侧，
         * 再把浮层尺寸收缩到该侧的可用空间内（保持宽高比），
         * 与眼睛保持 gap 间距 —— 任何视口下都贴着眼弹出且不覆盖眼睛。
         */
        anchoredStyle(innerW, innerH, maxW, w, h) {
            const a = this.anchor;
            const gap = 10;
            const edge = 8;
            const centerX = (a.left + a.right) / 2;
            const centerY = (a.top + a.bottom) / 2;
            const space = {
                top: a.top,
                bottom: innerH - a.bottom,
                left: a.left,
                right: innerW - a.right,
            };
            // 选空间最大的一侧
            let side = 'right';
            let best = -1;
            for (const key of ['right', 'bottom', 'top', 'left']) {
                if (space[key] > best) {
                    best = space[key];
                    side = key;
                }
            }
            // 该侧的可用绘制区域（扣除 gap 与视口留边）
            const availW = side === 'left'
                ? a.left - gap - edge
                : side === 'right'
                    ? innerW - edge - gap - a.right
                    : innerW - edge * 2;
            const availH = side === 'top'
                ? a.top - gap - edge
                : side === 'bottom'
                    ? innerH - edge - gap - a.bottom
                    : innerH - edge * 2;
            // 尺寸收缩：比例已知按比例缩放进可用区域；未知则直接取可用区域（封顶 90% 视口）
            let outW;
            let outH;
            if (w !== null) {
                const scale = Math.min(availW / w, availH / h, 1);
                outW = w * scale;
                outH = h * scale;
            } else {
                outH = Math.min(innerH * 0.9, availH);
                outW = Math.min(innerW * 0.9, availW, outH * 1.35);
            }
            let top;
            let left;
            if (side === 'top') {
                top = a.top - gap - outH;
                left = Math.min(Math.max(centerX - outW / 2, edge), innerW - outW - edge);
            } else if (side === 'bottom') {
                top = a.bottom + gap;
                left = Math.min(Math.max(centerX - outW / 2, edge), innerW - outW - edge);
            } else if (side === 'left') {
                left = a.left - gap - outW;
                top = Math.min(Math.max(centerY - outH / 2, edge), innerH - outH - edge);
            } else {
                left = a.right + gap;
                top = Math.min(Math.max(centerY - outH / 2, edge), innerH - outH - edge);
            }
            return {
                top: `${top}px`,
                left: `${left}px`,
                height: `${outH}px`,
                width: `${outW}px`,
            };
        },
    },
};
</script>

<style scoped>
.hover-preview-popup {
    position: fixed;
    z-index: 3600;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--el-bg-color, #fff);
    border: 1px solid var(--el-border-color-light, #e4e7ed);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: var(--el-box-shadow-light, 0 4px 16px rgba(0, 0, 0, 0.18));
    pointer-events: none; /* 纯展示浮层：不挡鼠标，避免与锚点 hover 互相打架 */
}
.hover-preview-media {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
}
</style>
