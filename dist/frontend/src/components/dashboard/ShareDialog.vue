<template>
    <!--
        v3.0.0：分享卡片弹窗。
        卡片按 3:4 竖屏排版（900×1200 白底）：顶部标题 → 中部二维码（居中）→ 分隔线 → 底部内容区。
        底部内容区左侧是缩略图（图片用原图，视频取首帧封面），右侧是名称 / 类型 / 大小。
        右下角「保存」用 canvas 把整张卡片画成图片下载（share-<文件ID>.png）。
    -->
    <el-dialog
        v-model="visible"
        :title="$t('share.title')"
        :width="dialogWidth"
        align-center
        append-to-body
        class="share-dialog"
        @close="$emit('close')"
    >
        <!-- 顶部勾选项：取消勾选的项不渲染到分隔线下方 -->
        <div class="share-options">
            <el-checkbox v-model="options.title">{{ $t('share.optionTitle') }}</el-checkbox>
            <el-checkbox v-model="options.thumb">{{ $t('share.optionThumb') }}</el-checkbox>
            <el-checkbox v-model="options.type">{{ $t('share.optionType') }}</el-checkbox>
            <el-checkbox v-model="options.size">{{ $t('share.optionSize') }}</el-checkbox>
        </div>

        <div class="share-card">
            <div class="share-card-title">{{ $t('share.cardTitle') }}</div>
            <div class="share-qr">
                <QRCodeBox ref="qrBox" :value="qrValue" :size="180" :empty-text="$t('fileDetail.qrEmpty')" />
            </div>
            <div class="share-divider"></div>
            <div class="share-info">
                <div v-if="options.thumb" class="share-thumb-wrap">
                    <!-- 视频使用 canvas 截取的首帧封面（dataURL），跨域失败则退化为图标 -->
                    <img
                        v-if="thumbPreview"
                        class="share-thumb"
                        :src="thumbPreview"
                        alt=""
                        @error="thumbError = true"
                    />
                    <div v-else class="share-thumb share-thumb-fallback">
                        <!-- v3.0.0：图标库里没有 video 图标，统一用 file 图标 + 扩展名区分 -->
                        <font-awesome-icon icon="file" />
                        <span>{{ extText }}</span>
                    </div>
                    <div v-if="isVideo && videoCoverFailed" class="share-thumb-hint">{{ $t('share.videoCoverFailed') }}</div>
                </div>
                <div class="share-meta">
                    <div v-if="options.title" class="share-name">{{ displayName }}</div>
                    <div v-if="options.type" class="share-line">
                        <span class="share-line-label">{{ $t('share.type') }}</span>
                        <span class="share-line-value">{{ typeText }}</span>
                    </div>
                    <div v-if="options.size" class="share-line">
                        <span class="share-line-label">{{ $t('share.size') }}</span>
                        <span class="share-line-value">{{ sizeText }}</span>
                    </div>
                </div>
            </div>
        </div>

        <template #footer>
            <el-button @click="visible = false">{{ $t('common.close') }}</el-button>
            <el-button type="primary" :loading="saving" @click="saveImage">
                <font-awesome-icon v-if="!saving" icon="download" style="margin-right: 4px;"></font-awesome-icon>
                {{ $t('share.save') }}
            </el-button>
        </template>
    </el-dialog>
</template>

<script>
import { ElMessage } from 'element-plus';
import QRCodeBox from '@/components/common/QRCodeBox.vue';

/** 分享图逻辑尺寸：3:4 竖屏，scale=2 导出 900×1200 */
const CARD_W = 450;
const CARD_H = 600;
const CARD_SCALE = 2;
const CARD_PAD = 30;
/** 卡片内缩略图边长（逻辑像素；×2 即导出图里的 240px） */
const THUMB_SIZE = 120;

export default {
    name: 'ShareDialog',
    components: { QRCodeBox },
    props: {
        modelValue: { type: Boolean, default: false },
        /** 文件记录 { name, metadata } */
        file: { type: Object, default: null },
        /** 预览地址（后台内部地址，缩略图 / 视频封面用） */
        fileLink: { type: String, default: '' },
        /** 二维码内容（签发外链） */
        qrValue: { type: String, default: '' },
        /** 签发外链各格式（本组件暂未使用，保持与详情弹窗接线一致） */
        urls: { type: Object, default: () => ({}) },
    },
    emits: ['update:modelValue', 'close'],
    data() {
        return {
            // 勾选项：默认全勾
            options: { title: true, thumb: true, type: true, size: true },
            saving: false,
            thumbError: false,
            // v3.0.0：视频首帧封面（canvas 截取的 dataURL）与截取失败标记
            videoCover: '',
            videoCoverFailed: false,
        };
    },
    computed: {
        visible: {
            get() { return this.modelValue; },
            set(val) { this.$emit('update:modelValue', val); },
        },
        dialogWidth() {
            return window.innerWidth < 768 ? '92%' : '460px';
        },
        meta() {
            return this.file?.metadata || {};
        },
        /** 文件显示名（优先 FileName，其次 File_ID） */
        displayName() {
            return String(this.meta.FileName || this.file?.name || '-');
        },
        /** 扩展名（小写，无点） */
        extText() {
            const ext = String(this.meta.FileExt || '').replace(/^\./, '').toLowerCase();
            if (ext) return ext;
            const m = /\.([A-Za-z0-9]{1,12})$/.exec(String(this.meta.FileName || this.file?.name || ''));
            return m ? m[1].toLowerCase() : 'file';
        },
        isImage() {
            const type = String(this.meta.FileType || '').toLowerCase();
            if (type.includes('image')) return true;
            return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic', 'heif'].includes(this.extText);
        },
        /** v3.0.0：视频判定（MIME 优先，其次扩展名） */
        isVideo() {
            const type = String(this.meta.FileType || '').toLowerCase();
            if (type.includes('video')) return true;
            return ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'ogv'].includes(this.extText);
        },
        thumbSrc() {
            return this.fileLink || '';
        },
        /** 预览用缩略图：图片用原图、视频用首帧封面，其它 / 失败时为空（走占位图标） */
        thumbPreview() {
            if (this.thumbError) return '';
            if (this.isVideo) return this.videoCover || '';
            if (this.isImage) return this.thumbSrc;
            return '';
        },
        typeText() {
            const type = String(this.meta.FileType || '').trim();
            if (type) return type;
            return this.extText ? this.extText.toUpperCase() : '-';
        },
        sizeText() {
            const bytes = Number(this.meta.FileSizeBytes) || 0;
            if (bytes > 0) return this.formatBytes(bytes);
            return String(this.meta.FileSize || '-');
        },
    },
    watch: {
        modelValue(val) {
            if (val) {
                this.thumbError = false;
                this.saving = false;
                this.videoCover = '';
                this.videoCoverFailed = false;
                if (this.isVideo) this.captureVideoCover();
            }
        },
        /** 弹窗开着时切换到另一个文件：重新取封面 */
        fileLink() {
            if (!this.visible) return;
            this.videoCover = '';
            this.videoCoverFailed = false;
            if (this.isVideo) this.captureVideoCover();
        },
    },
    methods: {
        formatBytes(bytes) {
            const n = Number(bytes) || 0;
            if (n <= 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            let v = n;
            let i = 0;
            while (v >= 1024 && i < units.length - 1) {
                v /= 1024;
                i += 1;
            }
            return `${i === 0 ? v : v.toFixed(2)} ${units[i]}`;
        },
        /**
         * v3.0.0：视频缩略图 —— 用隐藏的 <video> 加载首帧（currentTime=0.1）后 canvas 截取。
         * 跨域 / 解码失败时置 videoCoverFailed，界面上退化成占位图标 + 提示，不会出现破图。
         */
        async captureVideoCover() {
            this.videoCover = '';
            this.videoCoverFailed = false;
            const src = this.fileLink;
            if (!src) {
                this.videoCoverFailed = true;
                return;
            }
            const video = document.createElement('video');
            video.crossOrigin = 'anonymous';
            video.preload = 'auto';
            video.muted = true;
            video.playsInline = true;
            video.setAttribute('playsinline', '');
            video.setAttribute('muted', '');
            video.style.cssText = 'position:fixed;left:-99999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
            document.body.appendChild(video);
            const cleanup = () => {
                try { video.pause(); } catch { /* 忽略 */ }
                video.removeAttribute('src');
                try { video.load(); } catch { /* 忽略 */ }
                if (video.parentNode) video.parentNode.removeChild(video);
            };
            try {
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('video load timeout')), 8000);
                    video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
                    video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('video load error')); }, { once: true });
                    video.src = src;
                    try { video.load(); } catch { /* 忽略 */ }
                });
                // 首帧：跳到 0.1s（0s 常常还没有画面）
                await new Promise((resolve) => {
                    const timer = setTimeout(resolve, 2500);
                    video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
                    try { video.currentTime = 0.1; } catch { clearTimeout(timer); resolve(); }
                });
                const vw = Number(video.videoWidth) || 0;
                const vh = Number(video.videoHeight) || 0;
                if (!vw || !vh) throw new Error('video frame unavailable');
                const side = Math.min(vw, vh);
                const canvas = document.createElement('canvas');
                canvas.width = 480;
                canvas.height = 480;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#f2f3f5';
                ctx.fillRect(0, 0, 480, 480);
                ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, 480, 480);
                this.videoCover = canvas.toDataURL('image/png');
            } catch (err) {
                // 跨域污染 / 编码不支持：退化为占位图标 + 提示
                console.warn('[share] 视频封面截取失败:', err);
                this.videoCoverFailed = true;
            } finally {
                cleanup();
            }
        },
        /** 加载图片（跨域图加 crossOrigin，失败不阻塞） */
        loadImage(src) {
            return new Promise((resolve) => {
                if (!src) {
                    resolve(null);
                    return;
                }
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = src;
            });
        },
        /** 文本按宽度折行，超出 maxLines 用省略号 */
        wrapText(ctx, text, maxWidth, maxLines = 2) {
            const chars = Array.from(String(text || ''));
            const lines = [];
            let line = '';
            for (const ch of chars) {
                if (ctx.measureText(line + ch).width > maxWidth && line) {
                    lines.push(line);
                    line = ch;
                    if (lines.length === maxLines) break;
                } else {
                    line += ch;
                }
            }
            if (lines.length < maxLines && line) lines.push(line);
            const total = lines.join('');
            if (lines.length === maxLines && total.length < chars.length) {
                let last = lines[maxLines - 1];
                while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
                lines[maxLines - 1] = `${last}…`;
            }
            return lines;
        },
        /** 把当前分享卡片按 3:4 竖屏画成 PNG（900×1200）并下载 */
        async saveImage() {
            if (this.saving) return;
            this.saving = true;
            try {
                const canvas = document.createElement('canvas');
                canvas.width = CARD_W * CARD_SCALE;
                canvas.height = CARD_H * CARD_SCALE;
                const ctx = canvas.getContext('2d');
                ctx.scale(CARD_SCALE, CARD_SCALE);
                // 白底
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, CARD_W, CARD_H);

                // 顶部标题
                ctx.fillStyle = '#303133';
                ctx.font = '600 20px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(this.$t('share.cardTitle')), CARD_W / 2, 56);

                // 中部二维码（居中）
                const qrSize = 200;
                const qrY = 102;
                const qrData = this.$refs.qrBox?.toDataURL() || '';
                if (qrData) {
                    const qrImg = await this.loadImage(qrData);
                    if (qrImg) ctx.drawImage(qrImg, (CARD_W - qrSize) / 2, qrY, qrSize, qrSize);
                }

                // 分隔线
                const dividerY = qrY + qrSize + 32;
                ctx.strokeStyle = '#e4e7ed';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(CARD_PAD, dividerY + 0.5);
                ctx.lineTo(CARD_W - CARD_PAD, dividerY + 0.5);
                ctx.stroke();

                // 底部内容区：左缩略图（导出图里 240px）+ 右名称 / 类型 / 大小
                const contentY = dividerY + 34;
                let textX = CARD_PAD;
                if (this.options.thumb) {
                    if (this.isVideo && this.videoCover) {
                        const cover = await this.loadImage(this.videoCover);
                        if (cover) this.drawCover(ctx, cover, CARD_PAD, contentY, THUMB_SIZE, THUMB_SIZE);
                        else this.drawThumbFallback(ctx, CARD_PAD, contentY, THUMB_SIZE);
                    } else if (this.isImage && !this.thumbError) {
                        const img = await this.loadImage(this.thumbSrc);
                        if (img) this.drawCover(ctx, img, CARD_PAD, contentY, THUMB_SIZE, THUMB_SIZE);
                        else this.drawThumbFallback(ctx, CARD_PAD, contentY, THUMB_SIZE);
                    } else {
                        this.drawThumbFallback(ctx, CARD_PAD, contentY, THUMB_SIZE);
                    }
                    textX = CARD_PAD + THUMB_SIZE + 18;
                }

                const textWidth = CARD_W - CARD_PAD - textX;
                let ty = contentY + 4;
                ctx.textAlign = 'start';
                ctx.textBaseline = 'top';
                if (this.options.title) {
                    ctx.fillStyle = '#303133';
                    ctx.font = '600 16px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
                    const lines = this.wrapText(ctx, this.displayName, textWidth, 3);
                    for (const line of lines) {
                        ctx.fillText(line, textX, ty);
                        ty += 22;
                    }
                    ty += 8;
                }
                if (this.options.type) {
                    ctx.fillStyle = '#909399';
                    ctx.font = '13px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
                    ctx.fillText(`${this.$t('share.type')} ${this.typeText}`, textX, ty);
                    ty += 22;
                }
                if (this.options.size) {
                    ctx.fillStyle = '#909399';
                    ctx.font = '13px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
                    ctx.fillText(`${this.$t('share.size')} ${this.sizeText}`, textX, ty);
                }

                const dataUrl = canvas.toDataURL('image/png');
                const link = document.createElement('a');
                link.href = dataUrl;
                link.download = `share-${this.file?.name || 'file'}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                ElMessage.success(this.$t('share.saveSuccess'));
            } catch (err) {
                // 图片跨域污染 canvas 时 toDataURL 会抛 SecurityError
                console.warn('[share] 生成分享图片失败:', err);
                ElMessage.error(this.$t('share.saveFailed'));
            } finally {
                this.saving = false;
            }
        },
        /** 等比裁剪铺满（cover） */
        drawCover(ctx, img, x, y, w, h) {
            const iw = img.width || w;
            const ih = img.height || h;
            const ratio = Math.max(w / iw, h / ih);
            const sw = w / ratio;
            const sh = h / ratio;
            ctx.save();
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(x, y, w, h, 8) : ctx.rect(x, y, w, h);
            ctx.clip();
            ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
            ctx.restore();
        },
        /** 非图片 / 视频封面失败 / 缩略图加载失败：画一个浅灰占位块 + 扩展名 */
        drawThumbFallback(ctx, x, y, size) {
            ctx.fillStyle = '#f2f3f5';
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(x, y, size, size, 8) : ctx.rect(x, y, size, size);
            ctx.fill();
            ctx.fillStyle = '#909399';
            ctx.font = '600 16px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(this.extText || 'file').toUpperCase().slice(0, 8), x + size / 2, y + size / 2);
            ctx.textAlign = 'start';
            ctx.textBaseline = 'top';
        },
    },
};
</script>

<style scoped>
.share-options {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-bottom: 14px;
}
/* v3.0.0：卡片按 3:4 竖屏（导出 900×1200 白底）排布 */
.share-card {
    width: min(100%, 360px);
    margin: 0 auto;
    aspect-ratio: 3 / 4;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px 16px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 12px;
    background: #ffffff;
    color: #303133;
    overflow: hidden;
}
.share-card-title {
    flex: 0 0 auto;
    text-align: center;
    font-size: 15px;
    font-weight: 600;
    color: #303133;
    line-height: 1.4;
}
.share-qr {
    flex: 0 0 auto;
    display: flex;
    justify-content: center;
}
.share-divider {
    flex: 0 0 auto;
    height: 1px;
    margin: 2px 4px;
    background: #e4e7ed;
}
.share-info {
    flex: 1 1 auto;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    min-height: 0;
    min-width: 0;
}
.share-thumb-wrap {
    flex: 0 0 auto;
    min-width: 0;
}
.share-thumb {
    display: block;
    width: 96px;
    height: 96px;
    border-radius: 8px;
    object-fit: cover;
    background: #f2f3f5;
}
.share-thumb-fallback {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: #909399;
    font-size: 12px;
}
.share-thumb-fallback :deep(svg) {
    font-size: 28px;
}
.share-thumb-hint {
    max-width: 96px;
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.4;
    color: #909399;
    word-break: break-all;
}
.share-meta {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 2px;
}
.share-name {
    font-size: 14px;
    font-weight: 600;
    color: #303133;
    line-height: 1.5;
    word-break: break-all;
}
.share-line {
    display: flex;
    gap: 8px;
    font-size: 12px;
    line-height: 1.5;
    min-width: 0;
}
.share-line-label {
    flex: 0 0 auto;
    color: #909399;
}
.share-line-value {
    flex: 1 1 auto;
    min-width: 0;
    color: #606266;
    word-break: break-all;
}
@media (max-width: 768px) {
    .share-card {
        width: 100%;
        padding: 14px 12px;
    }
    .share-thumb,
    .share-thumb-fallback {
        width: 80px;
        height: 80px;
    }
    .share-thumb-hint {
        max-width: 80px;
    }
}
</style>
