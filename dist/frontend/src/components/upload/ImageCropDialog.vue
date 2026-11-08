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
            <!--
                v1.0.5：旋转方向 —— 手机上拍的竖图经常带着 EXIF 方向，进到裁剪页是歪的。
                每次都从**原始文件**重新渲染（而不是在上一次结果上叠 90°），
                这样连点四次回到 0° 不会有任何画质损失。
            -->
            <div class="crop-rotate">
                <el-button size="small" :disabled="rotating" :title="$t('uploadCrop.rotateLeft')" @click="rotate(-1)">
                    <font-awesome-icon icon="undo" style="margin-right: 3px;"></font-awesome-icon>{{ $t('uploadCrop.rotateLeft') }}
                </el-button>
                <el-button size="small" :disabled="rotating" :title="$t('uploadCrop.rotateRight')" @click="rotate(1)">
                    <font-awesome-icon icon="redo" style="margin-right: 3px;"></font-awesome-icon>{{ $t('uploadCrop.rotateRight') }}
                </el-button>
                <span class="crop-angle">{{ rotation }}°</span>
                <el-button size="small" text :disabled="rotating || rotation === 0" @click="resetRotation">{{ $t('uploadCrop.rotateReset') }}</el-button>
            </div>
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
            /**
             * v1.0.5：原始文件的对象 URL。
             * 旋转时永远从它重新渲染，保证「转四次回到原位」不会累积重新编码的画质损失。
             */
            rawUrl: '',
            /** 当前旋转角度（0 / 90 / 180 / 270，顺时针） */
            rotation: 0,
            rotating: false,
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
            if (this.objectUrl && this.objectUrl.startsWith('blob:') && this.objectUrl !== this.rawUrl) {
                URL.revokeObjectURL(this.objectUrl);
            }
            if (this.rawUrl && this.rawUrl.startsWith('blob:')) URL.revokeObjectURL(this.rawUrl);
            this.objectUrl = '';
            this.rawUrl = '';
        },
        loadImage() {
            this.cleanupUrl();
            if (!this.file) return;
            this.rawUrl = URL.createObjectURL(this.file);
            this.objectUrl = this.rawUrl;
            this.rotation = 0;
            this.natural = { w: 0, h: 0 };
            /*
             * v1.0.7：默认选区 = 整张图（不是原来的 80% 居中框）。
             * 大多数人是进来「只转个方向」的，原来的 0.1/0.1/0.8/0.8 会让一次
             * 旋转-保存变成「顺手裁掉四周 10%」，属于典型的误操作。
             * 现在不主动框选就不会裁到任何像素；要裁剪自己拖四角。
             */
            this.sel = { x: 0, y: 0, w: 1, h: 1 };
        },
        /**
         * 旋转 90°（dir = -1 逆时针 / 1 顺时针）。
         * 渲染源始终是 rawUrl，rotation 是「绝对角度」而非增量 —— 连点不会糊。
         */
        async rotate(dir) {
            if (!this.rawUrl || this.rotating) return;
            this.rotation = (this.rotation + (dir > 0 ? 90 : 270)) % 360;
            if (this.rotation === 0) {
                // 回到原位：直接用原图，重新编码这一步都省掉
                if (this.objectUrl !== this.rawUrl) URL.revokeObjectURL(this.objectUrl);
                this.objectUrl = this.rawUrl;
                return;
            }
            this.rotating = true;
            try {
                const url = await this.renderRotated(this.rotation);
                if (!url) return;
                if (this.objectUrl && this.objectUrl !== this.rawUrl) URL.revokeObjectURL(this.objectUrl);
                this.objectUrl = url;
            } finally {
                this.rotating = false;
            }
        },
        /** 把原图按 angle 旋转后画到 canvas，返回新的 blob URL */
        renderRotated(angle) {
            return new Promise((resolve) => {
                const base = new Image();
                base.onload = () => {
                    const w = base.naturalWidth;
                    const h = base.naturalHeight;
                    const swap = angle === 90 || angle === 270;
                    const canvas = document.createElement('canvas');
                    canvas.width = swap ? h : w;
                    canvas.height = swap ? w : h;
                    const ctx = canvas.getContext('2d');
                    ctx.translate(canvas.width / 2, canvas.height / 2);
                    ctx.rotate((angle * Math.PI) / 180);
                    ctx.drawImage(base, -w / 2, -h / 2, w, h);
                    // png / webp 保透明；其余走 jpeg 高质量
                    const keepAlpha = /png|webp|gif/i.test(this.file?.type || '');
                    canvas.toBlob(
                        (blob) => resolve(blob ? URL.createObjectURL(blob) : ''),
                        keepAlpha ? 'image/png' : 'image/jpeg',
                        0.96,
                    );
                };
                base.onerror = () => resolve('');
                base.src = this.rawUrl;
            });
        },
        resetRotation() {
            if (this.rotation === 0) return;
            this.rotation = 0;
            if (this.objectUrl && this.objectUrl !== this.rawUrl) URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = this.rawUrl;
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
            // v1.0.7：重置 = 回到整图选区（与打开时的默认一致）
            this.sel = { x: 0, y: 0, w: 1, h: 1 };
        },
        /** v1.0.7：当前选区是否等于整张图（此时「保存」等于不裁剪） */
        isFullSelection() {
            const s = this.sel;
            return s.x <= 0.002 && s.y <= 0.002 && s.w >= 0.996 && s.h >= 0.996;
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
        /**
         * v1.0.7：把「已旋转的 blob URL」变回 File —— 只转方向时直接上传它，不重绘。
         * 文件名沿用原名的基名 + blob 实际类型对应的扩展名。
         */
        async rotatedFile() {
            if (!this.objectUrl || this.objectUrl === this.rawUrl) return null;
            try {
                const r = await fetch(this.objectUrl);
                const blob = await r.blob();
                const mime = blob.type || this.file?.type || 'image/jpeg';
                const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
                const raw = String(this.file?.name || this.fileName || 'image');
                const base = raw.replace(/\.[^.]+$/, '') || 'image';
                return new File([blob], `${base}.${ext}`, { type: mime, lastModified: Date.now() });
            } catch {
                return null;
            }
        },
        /** 按选区在原图上裁切，生成新的 File */
        async confirm() {
            const img = this.$refs.img;
            const size = this.outputSize;
            if (!img || !size) return;
            this.exporting = true;
            try {
                /*
                 * v1.0.7：选区就是整图时不走 canvas —— 直接交出「原文件」或「已旋转的那份」。
                 * 原因：canvas 重绘对 jpg 是有损的（哪怕质量 0.94），只转个方向却掉画质
                 * 完全没必要；png/webp 也会被重新编码一遍、体积变大。
                 */
                if (this.isFullSelection()) {
                    const src = this.rotation === 0 ? this.file : await this.rotatedFile();
                    if (src) {
                        this.$emit('done', src);
                        this.$emit('update:modelValue', false);
                        return;
                    }
                    // 拿不到（极少见，blob 被回收）→ 落回 canvas 路径，至少能保存
                }

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
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 10px;
}

/* v1.0.5：旋转方向一组按钮（左转 / 右转 / 当前角度 / 复位） */
.crop-rotate {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
}

.crop-rotate .el-button + .el-button {
    margin-left: 0;
}

.crop-angle {
    min-width: 38px;
    text-align: center;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--el-text-color-secondary);
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
