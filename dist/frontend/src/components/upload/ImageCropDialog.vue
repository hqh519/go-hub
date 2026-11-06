<template>
    <el-dialog
        :model-value="modelValue"
        :title="$t('uploadCrop.title')"
        :fullscreen="isMobile"
        :width="dialogWidth"
        append-to-body
        destroy-on-close
        class="image-crop-dialog"
        @update:model-value="$emit('update:modelValue', $event)"
        @opened="onOpened"
    >
        <div
            ref="stage"
            class="crop-stage"
            @pointerdown="onPointerDown($event, null)"
        >
            <img
                ref="img"
                :src="objectUrl"
                class="crop-img"
                draggable="false"
                @load="onImgLoad"
            />
            <!-- 选区：拖动内部平移，拖四角改大小，空白处拖动重新框选 -->
            <div
                v-if="sel.w > 0 && sel.h > 0"
                class="crop-selection"
                :style="selectionStyle"
                @pointerdown.stop="onPointerDown($event, 'move')"
            >
                <span
                    v-for="corner in corners"
                    :key="corner"
                    class="crop-handle"
                    :class="`is-${corner}`"
                    @pointerdown.stop="onPointerDown($event, corner)"
                ></span>
            </div>
        </div>

        <div class="crop-tools">
            <span class="crop-size" v-if="outputSize">{{ $t('uploadCrop.outputSize', { w: outputSize.w, h: outputSize.h }) }}</span>
            <el-button size="small" text @click="resetSelection">{{ $t('uploadCrop.reset') }}</el-button>
        </div>
        <p class="crop-hint">{{ $t('uploadCrop.hint') }}</p>

        <template #footer>
            <el-button @click="$emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
            <el-button type="primary" :loading="exporting" :disabled="!canCrop" @click="confirm">
                {{ $t('uploadCrop.confirm') }}
            </el-button>
        </template>
    </el-dialog>
</template>

<script>
/**
 * 图片裁剪（v2.3.0）—— 上传列表里「剪刀」按钮打开的裁剪页。
 *
 * 与 AvatarCropper 的区别：那个只做正方形头像，这里要裁任意矩形，
 * 所以用「自由框选」：在图上拖出选区、拖四角改大小、拖选区内部平移。
 * 确认后在浏览器里按原图分辨率裁切，生成新的 File 交给上传队列，
 * 原图不会被上传，也不会有任何额外的服务端处理。
 *
 * v2.4.0：
 *   1) 弹窗改全屏（移动端 fullscreen；PC 大尺寸），裁剪操作区更大更好拖；
 *   2) 交互从 mouse/touch 双轨改为 Pointer Events 统一处理 ——
 *      旧实现移动端四角选点经常失效（touchstart 被 prevent 后拖动流不稳定），
 *      Pointer Events + setPointerCapture 在移动端与 PC 表现完全一致。
 */
export default {
    name: 'ImageCropDialog',
    props: {
        modelValue: { type: Boolean, default: false },
        /** 待裁剪的 File（也允许直接给 blob URL 字符串 + name） */
        file: { type: File, default: null },
        /** 备用文件名（file 为空时用于生成结果文件名） */
        fileName: { type: String, default: '' },
    },
    emits: ['update:modelValue', 'done'],
    data() {
        return {
            objectUrl: '',
            natural: { w: 0, h: 0 },
            /** 图片在舞台内的实际绘制区域（px） */
            disp: { left: 0, top: 0, w: 0, h: 0 },
            /** 选区：相对图片的归一化坐标 0~1 */
            sel: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
            drag: null,
            exporting: false,
            corners: ['nw', 'ne', 'sw', 'se'],
            /** 移动端全屏（mount 时判定一次即可） */
            isMobile: typeof window !== 'undefined' && window.innerWidth <= 768,
        };
    },
    computed: {
        dialogWidth() {
            return this.isMobile ? '100%' : '92%';
        },
        visible: {
            get() { return this.modelValue; },
            set(v) { this.$emit('update:modelValue', v); },
        },
        selectionStyle() {
            const d = this.disp;
            const s = this.sel;
            if (!d.w || !d.h) return { display: 'none' };
            return {
                left: `${d.left + s.x * d.w}px`,
                top: `${d.top + s.y * d.h}px`,
                width: `${s.w * d.w}px`,
                height: `${s.h * d.h}px`,
            };
        },
        outputSize() {
            const n = this.natural;
            const s = this.sel;
            if (!n.w || !n.h) return null;
            const w = Math.max(1, Math.round(s.w * n.w));
            const h = Math.max(1, Math.round(s.h * n.h));
            return { w, h };
        },
        canCrop() {
            return !!(this.outputSize && this.objectUrl);
        },
    },
    watch: {
        file() { this.loadImage(); },
        modelValue(v) {
            if (v) this.loadImage();
            else this.cleanupUrl();
        },
    },
    beforeUnmount() {
        this.cleanupUrl();
        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerUp);
    },
    methods: {
        handleResize() {
            this.measure();
        },
        cleanupUrl() {
            if (this.objectUrl && this.objectUrl.startsWith('blob:')) URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = '';
        },
        loadImage() {
            this.cleanupUrl();
            if (!this.file) return;
            this.objectUrl = URL.createObjectURL(this.file);
            this.natural = { w: 0, h: 0 };
            this.sel = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
        },
        onOpened() {
            this.onImgLoad();
            window.addEventListener('resize', this.handleResize);
        },
        onImgLoad() {
            const img = this.$refs.img;
            if (img?.naturalWidth) {
                this.natural = { w: img.naturalWidth, h: img.naturalHeight };
            }
            this.measure();
        },
        /** 计算图片在舞台里的 contain 显示区域 */
        measure() {
            const stage = this.$refs.stage;
            const img = this.$refs.img;
            if (!stage || !img || !img.naturalWidth) return;
            const sw = stage.clientWidth;
            const sh = stage.clientHeight || Math.round(sw * 0.62);
            const scale = Math.min(sw / img.naturalWidth, sh / img.naturalHeight);
            const w = img.naturalWidth * scale;
            const h = img.naturalHeight * scale;
            this.disp = { left: (sw - w) / 2, top: (sh - h) / 2, w, h };
        },
        resetSelection() {
            this.sel = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
        },
        /** 指针坐标 → 图片归一化坐标（Pointer Events 自带 clientX/Y，鼠标触控统一） */
        toNorm(evt) {
            const stage = this.$refs.stage;
            const rect = stage.getBoundingClientRect();
            const d = this.disp;
            const x = (evt.clientX - rect.left - d.left) / (d.w || 1);
            const y = (evt.clientY - rect.top - d.top) / (d.h || 1);
            return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
        },
        onPointerDown(evt, mode) {
            if (!this.disp.w) return;
            if (evt.cancelable) evt.preventDefault();
            const p = this.toNorm(evt);
            const s = { ...this.sel };
            this.drag = { mode, startX: p.x, startY: p.y, origin: s };
            if (!mode) {
                // 空白处按下：从该点开始重新框选
                this.sel = { x: p.x, y: p.y, w: 0, h: 0 };
            }
            // 捕获指针：后续 move/up 即使移出元素也持续派发给该元素所在的流
            try { evt.currentTarget?.setPointerCapture?.(evt.pointerId); } catch { /* 忽略 */ }
            window.addEventListener('pointermove', this.onPointerMove);
            window.addEventListener('pointerup', this.onPointerUp);
            window.addEventListener('pointercancel', this.onPointerUp);
        },
        onPointerMove(evt) {
            if (!this.drag) return;
            if (evt.cancelable) evt.preventDefault();
            const p = this.toNorm(evt);
            const { mode, origin, startX, startY } = this.drag;
            const dx = p.x - startX;
            const dy = p.y - startY;

            if (!mode) {
                // 新建选区：从起点拖到当前点
                const x = Math.min(startX, p.x);
                const y = Math.min(startY, p.y);
                this.sel = { x, y, w: Math.abs(dx), h: Math.abs(dy) };
                return;
            }
            if (mode === 'move') {
                const w = origin.w;
                const h = origin.h;
                const x = Math.min(1 - w, Math.max(0, origin.x + dx));
                const y = Math.min(1 - h, Math.max(0, origin.y + dy));
                this.sel = { x, y, w, h };
                return;
            }
            // 四角缩放
            let left = origin.x;
            let top = origin.y;
            let right = origin.x + origin.w;
            let bottom = origin.y + origin.h;
            if (mode.includes('w')) left = Math.min(right - 0.02, Math.max(0, origin.x + dx));
            if (mode.includes('n')) top = Math.min(bottom - 0.02, Math.max(0, origin.y + dy));
            if (mode.includes('e')) right = Math.max(left + 0.02, Math.min(1, origin.x + origin.w + dx));
            if (mode.includes('s')) bottom = Math.max(top + 0.02, Math.min(1, origin.y + origin.h + dy));
            this.sel = { x: left, y: top, w: right - left, h: bottom - top };
        },
        onPointerUp() {
            this.drag = null;
            window.removeEventListener('pointermove', this.onPointerMove);
            window.removeEventListener('pointerup', this.onPointerUp);
            window.removeEventListener('pointercancel', this.onPointerUp);
        },
        /** 按选区在原图上裁切，生成新的 File */
        async confirm() {
            const img = this.$refs.img;
            const size = this.outputSize;
            if (!img || !size) return;
            this.exporting = true;
            try {
                const canvas = document.createElement('canvas');
                canvas.width = size.w;
                canvas.height = size.h;
                const ctx = canvas.getContext('2d');
                const n = this.natural;
                const s = this.sel;
                // png / webp 保留透明通道；jpg 之类先铺白底
                const keepAlpha = /png|webp|gif/i.test(this.file?.type || '') || /\.(png|webp|gif)$/i.test(this.fileName || '');
                if (!keepAlpha) {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, size.w, size.h);
                }
                ctx.drawImage(
                    img,
                    Math.round(s.x * n.w),
                    Math.round(s.y * n.h),
                    Math.round(s.w * n.w),
                    Math.round(s.h * n.h),
                    0,
                    0,
                    size.w,
                    size.h,
                );
                const mime = keepAlpha ? 'image/png' : 'image/jpeg';
                const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, 0.94));
                if (!blob) throw new Error('toBlob failed');
                const ext = keepAlpha ? 'png' : 'jpg';
                const raw = String(this.file?.name || this.fileName || 'image');
                const base = raw.replace(/\.[^.]+$/, '') || 'image';
                const cropped = new File([blob], `${base}.${ext}`, { type: mime, lastModified: Date.now() });
                this.$emit('done', cropped);
                this.$emit('update:modelValue', false);
            } catch (e) {
                this.$message?.error?.(this.$t('uploadCrop.failed'));
            } finally {
                this.exporting = false;
            }
        },
    },
};
</script>

<style scoped>
.crop-stage {
    position: relative;
    width: 100%;
    /* v2.4.0：全屏化后操作区按视口高度撑开（弹窗头尾/工具行预留约 240px） */
    height: calc(100vh - 240px);
    min-height: 320px;
    border-radius: 10px;
    overflow: hidden;
    background: #1f2430;
    touch-action: none;
    user-select: none;
    cursor: crosshair;
}

.crop-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
}

.crop-selection {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--el-color-primary, #409eff);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
    cursor: move;
}

.crop-handle {
    position: absolute;
    width: 14px;
    height: 14px;
    border-radius: 2px;
    background: var(--el-color-primary, #409eff);
    border: 2px solid #fff;
    box-sizing: border-box;
}

.crop-handle.is-nw { left: -7px; top: -7px; cursor: nwse-resize; }
.crop-handle.is-ne { right: -7px; top: -7px; cursor: nesw-resize; }
.crop-handle.is-sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
.crop-handle.is-se { right: -7px; bottom: -7px; cursor: nwse-resize; }

.crop-tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 10px;
}

.crop-size {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.crop-hint {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
}

/* 移动端全屏：舞台吃掉 header/footer/工具行之外的全部空间；选点加大易触 */
@media (max-width: 768px) {
    .crop-stage {
        height: calc(100dvh - 250px);
        min-height: 260px;
        border-radius: 8px;
    }
    .crop-handle {
        width: 20px;
        height: 20px;
    }
    .crop-handle.is-nw { left: -10px; top: -10px; }
    .crop-handle.is-ne { right: -10px; top: -10px; }
    .crop-handle.is-sw { left: -10px; bottom: -10px; }
    .crop-handle.is-se { right: -10px; bottom: -10px; }
}
</style>
