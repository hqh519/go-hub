<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="420px"
    append-to-body
    destroy-on-close
    @update:model-value="$emit('update:modelValue', $event)"
    @opened="onOpened"
  >
    <div class="cropper-wrap">
      <div
        ref="stage"
        class="cropper-stage"
        @mousedown.prevent="startDrag"
        @touchstart.prevent="startDrag"
      >
        <canvas ref="canvas" :width="size" :height="size"></canvas>
        <div class="cropper-mask"></div>
      </div>
      <div class="cropper-tools">
        <font-awesome-icon icon="search-minus" class="zoom-icon" />
        <el-slider v-model="zoom" :min="1" :max="3" :step="0.01" class="zoom-slider" @input="draw" />
        <font-awesome-icon icon="search-plus" class="zoom-icon" />
      </div>
      <p class="cropper-hint">{{ hint }}</p>
    </div>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="exporting" @click="confirm">{{ $t('common.confirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<script>
/**
 * 头像在线裁剪（正方形）。
 *
 * 交互：图片默认按「铺满裁剪框」缩放，可拖动调整位置、滑块缩放，
 * 确认后在浏览器里生成 size×size 的 webp/jpeg，直接作为上传的 File 交给后端。
 * 这样避免把原图（可能几 MB）传上去再裁，也保证头像永远是正方形。
 */
export default {
    name: 'AvatarCropper',
    props: {
        modelValue: { type: Boolean, default: false },
        file: { type: File, default: null },
        /** 输出边长（px），与后端 AVATAR_SIZE 保持一致 */
        size: { type: Number, default: 256 },
        title: { type: String, default: '裁剪头像' },
        hint: { type: String, default: '' },
    },
    emits: ['update:modelValue', 'done'],
    data() {
        return {
            img: null,
            zoom: 1,
            ox: 0,
            oy: 0,
            dragging: false,
            dragStart: { x: 0, y: 0 },
            dragOrigin: { x: 0, y: 0 },
            exporting: false,
            objectUrl: '',
        };
    },
    watch: {
        file() { this.loadImage(); },
        modelValue(v) { if (v) this.loadImage(); },
    },
    beforeUnmount() {
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    },
    methods: {
        loadImage() {
            if (!this.file) return;
            if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = URL.createObjectURL(this.file);
            const img = new Image();
            img.onload = () => {
                this.img = img;
                this.zoom = 1;
                this.ox = 0;
                this.oy = 0;
                this.draw();
            };
            img.src = this.objectUrl;
        },
        onOpened() {
            if (!this.img) this.loadImage();
            else this.draw();
        },
        /** 计算当前缩放下的绘制参数，并把偏移限制在「始终铺满裁剪框」范围内 */
        geometry() {
            const S = this.size;
            const img = this.img;
            if (!img) return null;
            const base = Math.max(S / img.width, S / img.height);
            const scale = base * this.zoom;
            const dw = img.width * scale;
            const dh = img.height * scale;
            // 偏移范围：图片边缘不能进入裁剪框内部
            const minX = S - dw;
            const minY = S - dh;
            const dx = Math.min(0, Math.max(minX, S / 2 - dw / 2 + this.ox));
            const dy = Math.min(0, Math.max(minY, S / 2 - dh / 2 + this.oy));
            return { dx, dy, dw, dh };
        },
        draw() {
            const canvas = this.$refs.canvas;
            const g = this.geometry();
            if (!canvas || !g) return;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, this.size, this.size);
            ctx.fillStyle = '#f2f3f5';
            ctx.fillRect(0, 0, this.size, this.size);
            ctx.drawImage(this.img, g.dx, g.dy, g.dw, g.dh);
        },
        pointOf(evt) {
            const rect = this.$refs.stage.getBoundingClientRect();
            const p = evt.touches ? evt.touches[0] : evt;
            return {
                x: (p.clientX - rect.left) * (this.size / rect.width),
                y: (p.clientY - rect.top) * (this.size / rect.height),
            };
        },
        startDrag(evt) {
            if (!this.img) return;
            this.dragging = true;
            const p = this.pointOf(evt);
            this.dragStart = p;
            this.dragOrigin = { x: this.ox, y: this.oy };
            window.addEventListener('mousemove', this.onDrag);
            window.addEventListener('mouseup', this.endDrag);
            window.addEventListener('touchmove', this.onDrag, { passive: false });
            window.addEventListener('touchend', this.endDrag);
        },
        onDrag(evt) {
            if (!this.dragging) return;
            if (evt.cancelable) evt.preventDefault();
            const p = this.pointOf(evt);
            this.ox = this.dragOrigin.x + (p.x - this.dragStart.x);
            this.oy = this.dragOrigin.y + (p.y - this.dragStart.y);
            this.draw();
        },
        endDrag() {
            this.dragging = false;
            window.removeEventListener('mousemove', this.onDrag);
            window.removeEventListener('mouseup', this.endDrag);
            window.removeEventListener('touchmove', this.onDrag);
            window.removeEventListener('touchend', this.endDrag);
        },
        async confirm() {
            const g = this.geometry();
            if (!g || !this.img) return;
            this.exporting = true;
            try {
                const out = document.createElement('canvas');
                out.width = this.size;
                out.height = this.size;
                const ctx = out.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, this.size, this.size);
                ctx.drawImage(this.img, g.dx, g.dy, g.dw, g.dh);
                const blob = await new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/webp', 0.92));
                const finalBlob = blob || (await new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/jpeg', 0.92)));
                const ext = finalBlob?.type === 'image/webp' ? 'webp' : 'jpg';
                const base = String(this.file?.name || 'avatar').replace(/\.[^.]+$/, '');
                const cropped = new File([finalBlob], `${base}-avatar.${ext}`, { type: finalBlob.type });
                this.$emit('done', cropped);
                this.$emit('update:modelValue', false);
            } catch (e) {
                this.$message?.error?.('裁剪失败，请重试');
            } finally {
                this.exporting = false;
            }
        },
    },
};
</script>

<style scoped>
.cropper-wrap { display: flex; flex-direction: column; align-items: center; }
.cropper-stage {
    position: relative;
    width: 256px;
    height: 256px;
    border-radius: 8px;
    overflow: hidden;
    cursor: move;
    background: var(--el-fill-color-light, #f2f3f5);
    touch-action: none;
}
.cropper-stage canvas { display: block; width: 100%; height: 100%; }
/* 中间提示用的十字 / 圆形遮罩：仅视觉参考，不影响导出的方形结果 */
.cropper-mask {
    position: absolute;
    inset: 0;
    border-radius: 8px;
    box-shadow: inset 0 0 0 2px rgba(64, 158, 255, 0.9);
    pointer-events: none;
}
.cropper-tools {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 256px;
    margin-top: 14px;
}
.zoom-slider { flex: 1; }
.zoom-icon { color: var(--el-text-color-secondary, #909399); font-size: 13px; }
.cropper-hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--el-text-color-secondary, #909399);
}
</style>
