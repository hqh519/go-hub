<template>
    <div class="upload-list-item">
        <a :href="file.url" target="_blank" class="upload-list-item-preview">
            <!-- 视频 -->
            <video
                v-if="isVideo(file.name)"
                style="width: 10vw; border-radius: 4px;"
                autoplay
                muted
                playsinline
                loop
            >
                <source :src="file.url" type="video/mp4" />
                Your browser does not support the video tag.
            </video>
            <!-- 图片 -->
            <img
                v-else-if="isImage(file.name)"
                style="width: 10vw; border-radius: 4px;"
                :src="thumbSrc"
                @error="onThumbError"
            />
            <!-- 其他文件 -->
            <div v-else style="width: 10vw; border-radius: 4px;">
                <font-awesome-icon icon="file" class="file-icon"></font-awesome-icon>
            </div>
        </a>
        <div class="upload-list-item-content">
            <div class="upload-list-item-name-wrapper">
                <!-- 手动上传模式（等待中）允许先改文件名，点「上传」后按新名上传 -->
                <el-input
                    v-if="file.status === 'waiting' && file.editableName"
                    v-model="file.name"
                    class="upload-list-item-name-input"
                    size="small"
                    :placeholder="$t('uploadForm.fileNamePlaceholder')"
                />
                <el-text
                    v-else-if="canOpenDetail"
                    class="upload-list-item-name is-clickable"
                    truncated
                    :title="$t('fileDetail.title')"
                    @click.stop="$emit('detail', file)"
                >{{ truncateFilename(file.name) }}</el-text>
                <el-text v-else class="upload-list-item-name" truncated>{{ truncateFilename(file.name) }}</el-text>
            </div>
            <div class="upload-list-item-url" v-if="file.status==='done'">
                <div class="upload-list-item-url-row">
                    <el-input v-model="file.finalURL" readonly @click="selectAllText" :size="urlSize">
                        <template #prepend>URL</template>
                    </el-input>
                    <el-input v-model="file.mdURL" readonly @click="selectAllText" :size="urlSize">
                        <template #prepend>MarkDown</template>
                    </el-input>
                </div>
                <div class="upload-list-item-url-row">
                    <el-input v-model="file.htmlURL" readonly @click="selectAllText" :size="urlSize">
                        <template #prepend>HTML</template>
                    </el-input>
                    <el-input v-model="file.ubbURL" readonly @click="selectAllText" :size="urlSize">
                        <template #prepend>BBCode</template>
                    </el-input>
                </div>
            </div>
            <div class="upload-list-item-progress" v-else>
                <!--
                    v2.3.0：「压缩中」标识放在进度条前面。
                    字节发完（100%）到后端返回之间，压缩（图片/视频/音频）和分块合并都在这一段空窗里，
                    不提示的话用户只看到一个卡在 100% 的进度条，会以为卡死了。
                -->
                <span v-if="showsCompressing" class="upload-item-compressing">
                    <font-awesome-icon icon="spinner" spin />
                    {{ $t('uploadForm.compressing') }}
                </span>
                <el-progress class="upload-item-bar" :percentage="file.progreess" :status="file.status" :show-text="false"/>
                <!-- 文件大小：进度条旁直接展示，无需额外读取（来自本地 File 对象），不增加等待 -->
                <span v-if="fileSizeText" class="upload-item-size">{{ fileSizeText }}</span>
            </div>
        </div>
        <div class="upload-list-item-action">
            <!--
                手动上传模式 + 图片：把「复制链接」换成「裁剪」（v2.3.0）。
                待上传的图片此时还没有链接可复制，裁剪才是当前真正有用的动作；
                其余情况（非图片 / 自动上传 / 已上传完成）保持原样。
            -->
            <button
                v-if="canCrop"
                class="modern-file-action-btn modern-file-action-btn-primary"
                :title="$t('uploadCrop.openCrop')"
                @click="$emit('crop', file)"
            >
                <font-awesome-icon icon="cut" />
            </button>
            <button
                v-else
                class="modern-file-action-btn modern-file-action-btn-primary"
                @click="$emit('copy', file)"
            >
                <el-icon><Link /></el-icon>
            </button>
            <button class="modern-file-action-btn modern-file-action-btn-danger" @click="$emit('remove', file)">
                <el-icon><Delete /></el-icon>
            </button>
        </div>
    </div>
</template>

<script>
import { Link, Delete } from '@element-plus/icons-vue'
import { copyText } from '@/utils/clipboard'
import { COMPRESSIBLE_EXTENSIONS } from '@/utils/upload/compressExtensions'
import img404 from '@/assets/404.png'

const IMAGE_EXTENSIONS = [
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'ico', 'avif', 'heic',
    'jfif', 'pjpeg', 'pjp', 'raw', 'cr2', 'nef', 'dng', 'eps', 'ai', 'emf', 'wmf'
]
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mkv']

export default {
    name: 'UploadFileItem',
    components: { Link, Delete },
    props: {
        file: { type: Object, required: true },
        /** 手动上传模式（待上传列表）：图片会显示「裁剪」按钮而不是「复制链接」 */
        manualMode: { type: Boolean, default: false }
    },
    emits: ['copy', 'remove', 'preview-error', 'detail', 'crop'],
    data() {
        return {
            /**
             * 缩略图加载失败状态。
             * 这里刻意**不去改 file.url** —— file.url 同时是列表里
             * `<a :href="file.url">` 的分享链接，一旦被替换成占位图，
             * 用户就会看到「缩略图是 404 图、跟真实链接对不上」的现象。
             * 失败只影响 <img> 自己，链接始终保持真实地址。
             */
            thumbBroken: false,
            thumbRetry: 0
        }
    },
    computed: {
        /**
         * 是否显示「裁剪」按钮：
         *   手动上传（还没开始传）+ 图片 + 本地还留着原始 File。
         * 自动上传模式下一进来就开始传了，裁剪会打乱进度，因此不出现。
         */
        canCrop() {
            const f = this.file || {}
            if (!this.manualMode) return false
            if (f.status !== 'waiting') return false
            if (!f.rawFile) return false
            return this.isImage(String(f.name || ''))
        },
        urlSize() {
            return window.innerWidth < 768 ? 'small' : 'default'
        },
        /**
         * 是否显示「压缩中」：
         *   1) 明确置位（前端本地压缩 / 分块合并阶段自己标记）；
         *   2) 单请求上传且进度已 100%、文件属于可压缩媒体 —— 此时字节发完了，
         *      后端正在压（图片走 sharp、视频音频走 ffmpeg），进度条会静止不动。
         * 分块上传不走第 2 条：它的 100% 之后是「合并分块」，不是压缩。
         */
        showsCompressing() {
            const f = this.file || {}
            if (f.compressing) return true
            if (f.status !== 'uploading') return false
            if (f.chunkedUpload) return false
            if (Number(f.progreess) < 100) return false
            // v2.4.0：只有「文件压缩」开关开启、确实会进行服务端压缩的条目（serverCompress=true）
            // 才显示「压缩中」—— 开关关闭时上传全程不再出现该提示
            if (f.serverCompress !== true) return false
            return this.isCompressible(String(f.name || ''))
        },
        /** 文件大小文案：优先取压缩/转码前的初始大小，其次本地 File 对象大小 */
        fileSizeText() {
            const bytes = Number(
                (this.file && (this.file.originalSize || (this.file.file && this.file.file.size))) || 0
            )
            if (!Number.isFinite(bytes) || bytes <= 0) return ''
            const units = ['B', 'KB', 'MB', 'GB', 'TB']
            let i = 0
            let v = bytes
            while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
            return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
        },
        /**
         * 文件名是否可点开「文件详情」。
         * 只有真正落库成功的文件才有详情可查（上传中 / 失败的文件后端没有记录）；
         * 「仅保存外链」的条目本地没有 File_ID，也一并排除。
         * 外链模式没有 srcID，用文件名兜底查询。
         */
        canOpenDetail() {
            const f = this.file || {}
            if (f.status !== 'done' && f.status !== 'success') return false
            // 「仅保存外链」的条目 srcID 直接是外部 URL，后端没有落库记录，跳过
            if (typeof f.srcID === 'string' && /^https?:\/\//i.test(f.srcID)) return false
            return !!(f.srcID || f.name)
        },
        /**
         * 缩略图实际使用的地址：
         *   1) 正常情况直接用 file.url；
         *   2) 首次加载失败 → 带 `_r=N` 缓存击穿参数重试（后台代理/上游图床偶发 502 时很有效）；
         *   3) 重试仍失败 → 落回 404 占位图（仅缩略图，不动真实链接）。
         * 注意 blob: 本地预览地址不能加 query，只能原样使用。
         */
        thumbSrc() {
            const url = this.file && this.file.url
            if (!url) return img404
            if (this.thumbBroken) return img404
            if (!this.thumbRetry) return url
            if (!/^https?:/i.test(url)) return url
            return url + (url.includes('?') ? '&' : '?') + '_r=' + this.thumbRetry
        }
    },
    watch: {
        // file.url 变化（本地预览 → 服务端链接）时重置失败状态，避免误伤新地址
        'file.url'() {
            this.thumbBroken = false
            this.thumbRetry = 0
        }
    },
    methods: {
        isImage(fileName) {
            const ext = fileName.split('.').pop().toLowerCase()
            return IMAGE_EXTENSIONS.includes(ext)
        },
        /**
         * 后端 common/compress.ts 能压的格式（gif 会丢帧、svg/heic/tiff/bmp 等一律跳过）。
         * 只有这些格式在 100% 之后才可能停在「压缩中」，其它文件按原样落库。
         */
        isCompressible(fileName) {
            const ext = String(fileName || '').split('.').pop().toLowerCase()
            return COMPRESSIBLE_EXTENSIONS.includes(ext)
        },
        onThumbError() {
            const url = (this.file && this.file.url) || ''
            // 本地 blob 预览失败没有重试意义，直接落占位图
            if (!/^https?:/i.test(url)) {
                this.thumbBroken = true
                this.$emit('preview-error', this.file)
                return
            }
            if (this.thumbRetry < 2) {
                this.thumbRetry += 1
                return
            }
            this.thumbBroken = true
            this.$emit('preview-error', this.file)
        },
        isVideo(fileName) {
            const ext = fileName.split('.').pop().toLowerCase()
            return VIDEO_EXTENSIONS.includes(ext)
        },
        truncateFilename(filename, maxLength = 20) {
            if (!filename || filename.length <= maxLength) return filename
            const lastDotIndex = filename.lastIndexOf('.')
            let name, ext
            if (lastDotIndex > 0) {
                name = filename.substring(0, lastDotIndex)
                ext = filename.substring(lastDotIndex)
            } else {
                name = filename
                ext = ''
            }
            const keepEnd = ext.length + 4
            const keepStart = maxLength - keepEnd - 3
            if (keepStart <= 0) return filename.substring(0, maxLength - 3) + '...'
            return name.substring(0, keepStart) + '...' + name.slice(-4) + ext
        },
        async selectAllText(event) {
            // 统一走兼容层：老旧浏览器 / http 环境下自动降级为 execCommand
            const ok = await copyText(event.target.value)
            this.$message({
                type: ok ? 'success' : 'error',
                message: this.$t(ok ? 'uploadForm.copySuccess' : 'uploadForm.copyFailed')
            })
        }
    }
}
</script>

<style scoped>
.upload-list-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 6px 10px;
    border: 1px solid var(--upload-list-item-border-color, rgba(37, 99, 235, 0.1));
    padding: 7px 12px;
    border-radius: 16px;
    background-color: var(--glass-bg) !important;
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    box-shadow: none;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.upload-list-item:hover {
    border-color: var(--upload-list-item-hover-border, rgba(37, 99, 235, 0.25));
    box-shadow: none;
}
.upload-list-item-content {
    display: flex;
    flex-direction: column;
    margin-left: 10px;
}
.upload-list-item-action {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
}
.upload-list-item-url-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    width: 38vw;
    gap: 8px;
    margin-bottom: 4px;
}
.upload-list-item-url-row:last-child {
    margin-bottom: 0;
}
.upload-list-item-url {
    display: flex;
    flex-direction: column;
}
/* 预览缩略图：限制最大高度（宽 10vw 由模板内联样式控制），
   高图按比例裁切填充，避免个别竖图把整条条目撑得过高 */
.upload-list-item-preview {
    display: block;
    flex: 0 0 auto;
    line-height: 0;
    /* 缩略图圆角：4px（与上传列表整体小圆角风格一致） */
    border-radius: 4px;
    overflow: hidden;
}
.upload-list-item-preview img,
.upload-list-item-preview video {
    max-height: 110px;
    object-fit: cover;
}
.file-icon {
    font-size: 30px;
    color: var(--upload-list-file-icon-color);
}

/* Name Wrapper */
.upload-list-item-name-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 5px 12px;
    background: var(--file-name-bg, rgba(37, 99, 235, 0.05));
    border-radius: 10px;
    margin-bottom: 6px;
    border: 1px solid var(--file-name-border, rgba(37, 99, 235, 0.12));
    transition: all 0.3s ease;
}
.upload-list-item-name-wrapper:hover {
    background: var(--file-name-hover-bg, rgba(37, 99, 235, 0.09));
    border-color: var(--file-name-hover-border, rgba(37, 99, 235, 0.2));
}
.upload-list-item-name {
    font-size: 14px;
    font-weight: 600;
    max-width: 28vw;
    color: var(--el-text-color-primary);
    letter-spacing: 0.3px;
    text-align: center;
}
/* 上传完成后文件名可点击 → 调出「文件详情」（与后台文件管理同一弹窗） */
.upload-list-item-name.is-clickable {
    cursor: pointer;
    transition: color 0.2s ease;
}
.upload-list-item-name.is-clickable:hover {
    color: var(--el-color-primary);
    text-decoration: underline;
    text-underline-offset: 3px;
}

.upload-list-item-name-input {
    width: 22vw;
    max-width: 260px;
}
.upload-list-item-name-input :deep(.el-input__wrapper) {
    border-radius: 8px;
}
.upload-list-item-name-input :deep(.el-input__inner) {
    font-size: 13px;
    font-weight: 600;
    text-align: center;
}
@media (max-width: 768px) {
    .upload-list-item-name-input {
        width: 32vw;
    }
}

/* Progress Bar */
.upload-list-item-progress {
    margin-top: 6px;
    width: 28vw;
    padding: 3px 8px;
    background: var(--progress-wrapper-bg, rgba(37, 99, 235, 0.04));
    border-radius: 12px;
    border: 1px solid var(--progress-wrapper-border, rgba(37, 99, 235, 0.1));
    display: flex;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
}
.upload-list-item-progress .upload-item-bar {
    flex: 1;
    min-width: 0;
}
/* 进度条旁的文件大小 */
.upload-item-size {
    flex: 0 0 auto;
    font-size: 11px;
    line-height: 1;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}
/* 「压缩中」标识：进度条前面，胶囊状，带旋转图标 */
.upload-item-compressing {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 11px;
    line-height: 16px;
    font-weight: 500;
    white-space: nowrap;
    color: var(--el-color-primary);
    background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);
}
.upload-list-item-progress :deep(.el-progress) {
    --el-color-primary: var(--primary-color);
}
.upload-list-item-progress :deep(.el-progress-bar) {
    padding-right: 0;
    margin-right: 0;
}
.upload-list-item-progress :deep(.el-progress-bar__outer) {
    height: 8px !important;
    border-radius: 8px;
    background: var(--progress-outer-bg, rgba(0, 0, 0, 0.045));
    box-shadow: none;
    overflow: hidden;
}
.upload-list-item-progress :deep(.el-progress-bar__inner) {
    border-radius: 8px;
    background: var(--primary-color) !important;
    box-shadow: none;
    position: relative;
    overflow: hidden;
    transition: width 0.3s ease;
}
.upload-list-item-progress :deep(.el-progress-bar__inner::after) {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(255, 255, 255, 0.12);
    pointer-events: none;
}
.upload-list-item-progress :deep(.el-progress-bar__inner::before) {
    content: '';
    position: absolute;
    top: 0; left: -100%; width: 300%; height: 100%;
    background: repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255, 255, 255, 0.15) 8px, rgba(255, 255, 255, 0.15) 16px);
    animation: progressStripes 1s linear infinite;
}
.upload-list-item-progress :deep(.el-progress.is-success .el-progress-bar__inner) {
    background: #16A34A !important;
    background-size: 200% 100%;
    box-shadow: none;
    animation: none;
}
.upload-list-item-progress :deep(.el-progress.is-success .el-progress-bar__inner::before),
.upload-list-item-progress :deep(.el-progress.is-success .el-progress-bar__inner::after) {
    animation: none;
    background: none;
}
.upload-list-item-progress :deep(.el-progress.is-exception .el-progress-bar__inner) {
    background: #DC2626 !important;
    background-size: 200% 100%;
    box-shadow: none;
    animation: none;
}
.upload-list-item-progress :deep(.el-progress.is-exception .el-progress-bar__inner::before),
.upload-list-item-progress :deep(.el-progress.is-exception .el-progress-bar__inner::after) {
    animation: none;
    background: none;
}
@keyframes progressStripes {
    0% { transform: translateX(0); }
    100% { transform: translateX(22.627px); }
}
/* URL Input Styles */
.upload-list-item-url :deep(.el-input) {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.upload-list-item-url :deep(.el-input__wrapper) {
    border-radius: 10px;
    box-shadow: none;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    background: var(--el-fill-color-blank);
    border: 1px solid var(--el-border-color-lighter);
    overflow: hidden;
    position: relative;
    padding: 0;
}
.upload-list-item-url :deep(.el-input-group > .el-input__wrapper) {
    border-radius: 0 9px 9px 0 !important;
}
.upload-list-item-url :deep(.el-input__wrapper:hover) {
    box-shadow: none;
    border-color: var(--el-color-primary-light-5);
}
.upload-list-item-url :deep(.el-input__wrapper.is-focus) {
    box-shadow: none;
    border-color: var(--el-color-primary);
}
.upload-list-item-url :deep(.el-input__wrapper.is-focus::before) {
    content: '';
    position: absolute;
    top: 0; left: -100%; width: 100%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(37, 99, 235, 0.08), transparent);
    animation: shimmer 2s infinite;
    z-index: 0;
}
@keyframes shimmer {
    0% { left: -100%; }
    100% { left: 100%; }
}
.upload-list-item-url :deep(.el-input__inner) {
    font-size: 13px;
    font-family: 'Courier New', Monaco, monospace;
    color: var(--el-text-color-regular);
    transition: all 0.3s ease;
    padding-left: 12px;
    position: relative;
    z-index: 1;
    border-radius: 0 10px 10px 0;
}
.upload-list-item-url :deep(.el-input__inner::selection) {
    background-color: var(--el-color-primary-light-7);
}
html.dark .upload-list-item-url :deep(.el-input-group__prepend) {
    color: var(--primary-color-accent);
}
.upload-list-item-url :deep(.el-input-group__prepend) {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    font-weight: 600;
    font-size: 12px;
    border: none;
    padding: 0 14px;
    margin: 0;
    border-radius: 9px 0 0 9px;
    box-shadow: none;
    transition: all 0.3s ease;
    letter-spacing: 0.5px;
    position: relative;
    z-index: 1;
}
.upload-list-item-url :deep(.el-input-group__prepend::after) {
    content: '';
    position: absolute;
    right: 0; top: 50%;
    transform: translateY(-50%);
    height: 60%; width: 1px;
    background: var(--el-color-primary-light-7);
    opacity: 0.3;
    transition: all 0.3s ease;
}
.upload-list-item-url :deep(.el-input:hover .el-input-group__prepend) {
    background: var(--el-color-primary-light-8);
}
.upload-list-item-url :deep(.el-input:hover .el-input-group__prepend::after) {
    opacity: 0.5;
}
.upload-list-item-url :deep(.el-input.is-focus .el-input-group__prepend) {
    background: var(--el-color-primary);
    color: white;
    animation: prependPulse 2s ease-in-out infinite;
}
.upload-list-item-url :deep(.el-input.is-focus .el-input-group__prepend::after) {
    background: rgba(255, 255, 255, 0.3);
    opacity: 1;
}
@keyframes prependPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.95; }
}

/* File Action Buttons */
.modern-file-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 10px;
    background: var(--upload-action-btn-bg);
    color: var(--upload-action-btn-color);
    box-shadow: var(--upload-action-btn-shadow);
    cursor: pointer;
    transition: background-color 0.22s ease, color 0.22s ease, transform 0.22s ease;
    font-size: 16px;
    position: relative;
    overflow: hidden;
    margin: 4px 0;
    outline: none;
}
.modern-file-action-btn::before {
    content: '';
    position: absolute;
    inset: 2px;
    border-radius: 8px;
    background: currentColor;
    opacity: 0;
    transition: opacity 0.22s ease;
}
.modern-file-action-btn:hover {
    background: var(--upload-action-btn-hover-bg);
}
.modern-file-action-btn:hover::before {
    opacity: 0.08;
}
.modern-file-action-btn:active {
    transform: scale(0.96);
}
.modern-file-action-btn-primary {
    color: var(--upload-action-copy-color);
}
.modern-file-action-btn-danger {
    color: var(--upload-action-danger-color);
    background: var(--upload-action-danger-bg);
}
.modern-file-action-btn-danger:hover {
    background: var(--upload-action-danger-hover-bg);
}

/* Mobile */
@media (max-width: 768px) {
    .upload-list-item {
        margin: 5px 6px;
        padding: 7px 8px;
        border-radius: 12px;
    }
    .upload-list-item-content {
        margin-left: 2px;
    }
    .upload-list-item-action {
        gap: 3px;
    }
    .upload-list-item-url-row {
        width: 42vw;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 4px;
    }
    .upload-list-item-progress {
        width: 32vw;
        margin-top: 5px;
        padding: 2px 5px;
        border-radius: 9px;
    }
    .upload-list-item-progress :deep(.el-progress-bar__outer) {
        height: 6px !important;
    }
    .upload-item-compressing {
        font-size: 10px;
        padding: 0 5px;
        gap: 3px;
    }
    .upload-item-compressing svg {
        width: 9px;
        height: 9px;
    }
    .upload-list-item-url :deep(.el-input__wrapper) {
        border-radius: 7px;
    }
    .upload-list-item-url :deep(.el-input__inner) {
        font-size: 10px;
        padding-left: 8px;
    }
    .upload-list-item-url :deep(.el-input-group__prepend) {
        font-size: 9px;
        padding: 0 6px;
        border-radius: 7px 0 0 7px;
    }
    .modern-file-action-btn {
        width: 26px;
        height: 26px;
        margin: 2px 0;
        border-radius: 8px;
        font-size: 12px;
    }
    .upload-list-item-name-wrapper {
        padding: 3px 8px;
        margin-bottom: 5px;
        border-radius: 7px;
    }
    .upload-list-item-name {
        font-size: 11px;
        width: 32vw;
    }
}
</style>
