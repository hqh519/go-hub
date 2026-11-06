<template>
    <!--
        v2.5.0（v20261023-2）：卡片改为「上下两部分」结构，样式对齐历史记录页封面：
          上 = 缩略图（悬浮时：左上渠道/备份简称、右上选择圆圈、中间 复制/打开/移动、下方中间 访问次数）
          下 = 文件信息（文件名 + 时间/大小 + 上传用户）
        行为不变：点击封面 / 文件名 = 打开文件详情；批量选择仍走页面下方操作栏。
    -->
    <div
        class="file-card"
        :class="{ 'is-selected': localSelected, 'is-force-select': showSelect, 'is-deleting': deleting }"
        @contextmenu.prevent
        @touchstart="$emit('touchstart', $event)"
        @touchend="$emit('touchend', $event)"
        @touchmove="$emit('touchmove', $event)"
    >
        <!-- v3.0.0（R12，需求 43）：删除中 → 整卡遮罩 + 转圈 -->
        <div v-if="deleting" class="card-deleting-mask" role="status" aria-live="polite">
            <span class="card-deleting-spinner"></span>
            <span class="card-deleting-text">{{ deletingLabel || $t('dashboard.deletingHint') }}</span>
        </div>
        <!-- 上半部分：缩略图（v2.9.0：点击打开媒体预览 —— 图片灯箱 / 视频 / 音频 / 通用弹窗） -->
        <div class="card-preview" @click="$emit('previewMedia', item)">
            <!-- 文件夹（v3.0.0 R14：回收站里的已删除文件夹条目复用本卡片外观） -->
            <div v-if="isFolderItem" class="file-preview folder-card-preview">
                <div class="file-icon-wrapper">
                    <font-awesome-icon icon="folder" class="file-icon"/>
                    <span class="file-ext">{{ $t('fileManager.folder') || 'folder' }}</span>
                </div>
            </div>

            <!-- 视频预览 -->
            <template v-else-if="isVideo">
                <div v-if="videoLoading" class="skeleton-wrapper"></div>
                <div v-else-if="videoError" class="error-wrapper">
                    <font-awesome-icon icon="exclamation-triangle" class="error-icon"/>
                    <span class="error-text">{{ $t('dashboard.loadFailed') }}</span>
                </div>
                <video
                    v-show="!videoLoading && !videoError"
                    :src="fileLink"
                    muted
                    loop
                    preload="metadata"
                    class="video-preview"
                    @mouseenter="handleVideoHover($event, true)"
                    @mouseleave="handleVideoHover($event, false)"
                    @loadeddata="videoLoading = false"
                    @error="handleVideoError"
                ></video>
            </template>

            <!-- 音频预览 -->
            <div v-else-if="isAudio" class="file-preview audio-card-preview">
                <font-awesome-icon icon="music" class="file-icon audio-icon"/>
            </div>

            <!-- 图片预览 -->
            <el-image
                v-else-if="isImage"
                :src="imageThumb"
                fit="cover"
                lazy
                decoding="async"
                class="image-preview"
            >
                <template #placeholder>
                    <div class="skeleton-wrapper"></div>
                </template>
                <template #error>
                    <div class="error-wrapper">
                        <font-awesome-icon icon="image" class="error-icon"/>
                        <span class="error-text">{{ $t('dashboard.loadFailed') }}</span>
                    </div>
                </template>
            </el-image>

            <!-- 其他文件 -->
            <div v-else class="file-preview">
                <div class="file-icon-wrapper">
                    <font-awesome-icon icon="file" class="file-icon"/>
                    <span class="file-ext">{{ item.metadata?.FileExt || 'file' }}</span>
                </div>
            </div>

            <!-- 悬浮层：渠道标识 / 选择 / 操作 / 访问次数 -->
            <div class="card-overlay">
                <div class="overlay-top">
                    <div class="card-tags">
                        <span
                            class="channel-tag"
                            :class="{ 'is-block': item.metadata?.ListType === 'Block' || item.metadata?.Label === 'adult' }"
                            :title="channelTag"
                        >{{ channelTag }}</span>
                        <span
                            v-for="(bk, i) in backupTags"
                            :key="'backup-' + i"
                            class="backup-tag"
                            :title="bk.full"
                        >{{ bk.short }}</span>
                    </div>
                </div>

                <div v-if="!isFolderItem" class="overlay-actions" @click.stop>
                    <el-tooltip :disabled="disableTooltip" :content="$t('dashboard.copyLink')" placement="top" :show-after="600">
                        <button class="overlay-btn" @click.stop="$emit('copy')">
                            <font-awesome-icon icon="copy"></font-awesome-icon>
                        </button>
                    </el-tooltip>
                    <el-tooltip :disabled="disableTooltip" :content="$t('dashboard.openLink')" placement="top" :show-after="600">
                        <button class="overlay-btn" @click.stop="$emit('openLink')">
                            <font-awesome-icon icon="external-link-alt"></font-awesome-icon>
                        </button>
                    </el-tooltip>
                </div>

                <div class="card-views-badge" :title="$t('dashboard.views')">
                    <font-awesome-icon icon="eye" class="card-views-icon"></font-awesome-icon>
                    <span>{{ viewsCount }}</span>
                </div>
            </div>

            <!--
                v2.8.5：选择圆圈从悬浮层移出来单独定位 —— 悬浮层整体 opacity 0，
                选中项即使鼠标不在卡片上也要能看见勾选状态，只能脱离悬浮层。
                v3.0.0（R8）：只读共享文件不可选中（隐藏选择圆圈）。
            -->
            <el-checkbox
                v-if="!sharedReadonly"
                v-model="localSelected"
                class="card-select"
                @click.stop
                @change="$emit('update:selected', localSelected)"
            ></el-checkbox>
        </div>

        <!-- 下半部分：文件信息（与历史记录卡片一致） -->
        <div class="card-info" @click="$emit('detail')">
            <!-- v2.7.0：文件名中间省略（与历史记录/列表视图同规则：头部与扩展名恒可见） -->
            <div class="file-name" :title="fullName">
                <span class="name-start">{{ nameParts.start }}</span><span class="name-end">{{ nameParts.end }}</span>
            </div>
            <div class="card-meta">
                <span class="upload-time">{{ uploadDate }}</span>
                <span class="upload-size">{{ fileSizeDisplay }}</span>
            </div>
            <!--
                v3.0.0（R9）：第三行左侧改为「评分（星）/ 级别（爱心）」——
                原预览小眼睛及悬停预览浮层已整体移除；
                评分 / 级别值 > 0 时把数字叠在图标中间，0 = 空图标（未评分 / 未评级）。
            -->
            <div class="card-footer">
                <div class="card-rating-level">
                    <span
                        class="rating-level-icon is-star"
                        :class="{ 'has-value': itemRating > 0 }"
                        :title="$t('filter.ratingLabel')"
                    >
                        <!-- v3.0.0（R12）：图标恒为空心（regular），有分值时数字叠在中间 -->
                        <font-awesome-icon :icon="['far', 'star']"></font-awesome-icon>
                        <b v-if="itemRating > 0" class="rating-level-num">{{ itemRating }}</b>
                    </span>
                    <span
                        class="rating-level-icon is-heart"
                        :class="{ 'has-value': itemLevel > 0 }"
                        :title="$t('filter.levelLabel')"
                    >
                        <font-awesome-icon :icon="['far', 'heart']"></font-awesome-icon>
                        <b v-if="itemLevel > 0" class="rating-level-num">{{ itemLevel }}</b>
                    </span>
                </div>
                <span v-if="uploadUser" class="upload-user" :title="uploadUser">
                    <font-awesome-icon icon="user" />
                    {{ uploadUser }}
                </span>
                <!-- v3.0.0：「共享」标识（发起方显示「你的共享文件」，接收方显示「由 X 共享给你」） -->
                <span
                    v-if="item.shared"
                    class="shared-badge"
                    :title="item.sharedSelf ? $t('fileManager.sharedBadgeSelfTitle') : $t('fileManager.sharedBadgeTitle', { owner: item.sharedOwner || '' })"
                >{{ $t('fileManager.sharedBadge') }}</span>
            </div>
        </div>
    </div>
</template>

<script>
import { splitFileName } from '../../utils/fileName';
import { thumbUrl } from '../../utils/thumb';
export default {
    name: 'FileCard',
    props: {
        item: { type: Object, required: true },
        selected: { type: Boolean, default: false },
        fileLink: { type: String, required: true },
        previewSrcList: { type: Array, default: () => [] },
        disableTooltip: { type: Boolean, default: false },
        /** v3.0.0：列表里已有文件被选中 → 所有卡片都常显右上角勾选框 */
        showSelect: { type: Boolean, default: false },
        // v3.0.0（R8）：是否「别人共享给我且为只读」—— 不可选中（隐藏选择圆圈）
        sharedReadonly: { type: Boolean, default: false },
        /** v3.0.0（R12）：正在删除（显示转圈遮罩） */
        deleting: { type: Boolean, default: false },
        /** v3.0.0（R12）：遮罩文案（默认「正在删除…」） */
        deletingLabel: { type: String, default: '' }
    },
    emits: ['update:selected', 'detail', 'previewMedia', 'openLink', 'copy', 'move', 'delete', 'download', 'touchstart', 'touchend', 'touchmove'],
    data() {
        return {
            localSelected: this.selected,
            videoLoading: true,
            videoError: false
        }
    },
    computed: {
        /** v3.0.0（R14）：回收站里的已删除文件夹条目（复用文件卡片外观，图标显示为文件夹） */
        isFolderItem() {
            return !!(this.item?.isFolder || this.item?.metadata?.FileType === 'folder');
        },
        /** v3.0.0（R9）：评分（星）与级别（爱心）数值 —— 0 = 未评分 / 未评级（显示空图标） */
        itemRating() {
            return Number(this.item?.metadata?.Rating) || 0;
        },
        itemLevel() {
            return Number(this.item?.metadata?.Level) || 0;
        },
        /** 主渠道简称：由后端 metadata.ChannelShort 统一下发（COS / OSS / EI / LS / IM / MI / R2 / S3 / WD / DIY） */
        channelTag() {
            return this.item.metadata?.ChannelShort || this.item.channelTag || '';
        },
        /** 被访问次数（外链真实访问累计；管理端预览不计） */
        viewsCount() {
            return Number(this.item.metadata?.Views || 0);
        },
        /** 备份渠道标识（有备份才显示）：只显示渠道简称，不再带「备份」二字 */
        backupTags() {
            const list = this.item.metadata?.BackupChannels;
            if (!Array.isArray(list)) return [];
            return list
                .map((b) => {
                    const label = b.label || '';
                    const name = b.name || '';
                    return {
                        short: b.short || label || name,
                        full: label && name ? `${label} / ${name}` : name || label
                    };
                })
                .filter((b) => b.short);
        },
        isVideo() {
            // 先通过 content-type 判断
            const fileType = this.item.metadata?.FileType?.toLowerCase() || '';
            if (fileType.includes('video')) return true;
            // 再通过文件后缀判断
            const name = this.item.name?.toLowerCase() || '';
            return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov') || name.endsWith('.avi');
        },
        isAudio() {
            // 先通过 content-type 判断
            const fileType = this.item.metadata?.FileType?.toLowerCase() || '';
            if (fileType.includes('audio')) return true;
            // 再通过文件后缀判断
            const name = this.item.name?.toLowerCase() || '';
            return name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.ogg') || name.endsWith('.flac');
        },
        isImage() {
            // 先通过 content-type 判断
            const fileType = this.item.metadata?.FileType?.toLowerCase() || '';
            if (fileType.includes('image')) return true;
            // 再通过文件后缀判断
            const name = this.item.name?.toLowerCase() || '';
            return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') ||
                   name.endsWith('.gif') || name.endsWith('.webp') || name.endsWith('.svg') ||
                   name.endsWith('.bmp') || name.endsWith('.avif') || name.endsWith('.heic') || name.endsWith('.heif');
        },
        /** 完整文件名（仅取最后一段），用于 title 悬浮提示 */
        fullName() {
            const fileName = this.item.metadata?.FileName || this.item.name || '';
            const parts = fileName.split('/');
            return parts[parts.length - 1];
        },
        /**
         * 卡片上显示的文件名：太长时**保留头尾、中间省略**
         * （`cover-2026-10-18.png` → `cover-2…10-18.png`）。
         */
        displayName() {
            const full = this.fullName;
            const max = 20;
            if (full.length <= max) return full;
            const keepEnd = 9;               // 尾部（含扩展名）
            const keepStart = max - keepEnd - 1; // 中间省略号占 1 个字符
            if (keepStart <= 3) return `${full.slice(0, max - 1)}…`;
            return `${full.slice(0, keepStart)}…${full.slice(-keepEnd)}`;
        },
        /** v2.8.6：文件名中间省略（统一走 splitFileName：任何宽度都是「开头…结尾」） */
        nameParts() {
            return splitFileName(this.fullName || '');
        },
        /** 上传日期（与历史记录一致：年-月-日） */
        uploadDate() {
            const ts = this.item.metadata?.TimeStamp;
            if (!ts) return '-';
            const d = new Date(Number(ts));
            if (!Number.isFinite(d.getTime())) return '-';
            const p = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        },
        /** 文件大小展示（与列表视图同一口径） */
        fileSizeDisplay() {
            const sizeBytes = this.item.metadata?.FileSizeBytes;
            const sizeMB = this.item.metadata?.FileSize;
            if (sizeBytes) {
                if (sizeBytes < 1024) return `${sizeBytes} B`;
                if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
                return `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`;
            }
            if (sizeMB) return `${sizeMB} MB`;
            return '-';
        },
        /**
         * v3.0.0（R10）：后台卡片缩略图 —— 走本站 /file 代理 + thumb 参数。
         * 卡片尺寸约 200~300px，取 320 宽足够清晰，体积比原图小一个数量级。
         */
        imageThumb() {
            return thumbUrl(this.fileLink, 320);
        },
        /** 上传用户（账户名；未登录上传为空） */
        uploadUser() {
            return this.item.metadata?.UploadUser || '';
        }
    },
    watch: {
        selected(val) {
            this.localSelected = val;
        },
        fileLink() {
            // 链接变化时重置加载状态
            this.videoLoading = true;
            this.videoError = false;
        }
    },
    beforeUnmount() {
        /* v3.0.0（R9）：预览小眼睛已移除，长按计时器清理不再需要 */
    },
    methods: {
        handleVideoError() {
            this.videoLoading = false;
            this.videoError = true;
        },
        handleVideoHover(e, isEnter) {
            const video = e.target;
            if (isEnter) {
                video.play().catch(() => {});
            } else {
                video.pause();
                video.currentTime = 0;
            }
        }
    }
}
</script>

<style scoped>
/* ── 卡片整体：上下两部分（对齐历史记录 grid-item）────────────────── */
.file-card {
    box-sizing: border-box;
    width: 100%;
    position: relative;
    background: var(--toolbar-button-bg-color);
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--glass-border);
    box-shadow: var(--toolbar-button-shadow);
    transition: box-shadow 0.3s ease;
    content-visibility: auto;
    contain: layout paint style;
    contain-intrinsic-size: 220px;
    cursor: pointer;
}
.file-card:hover {
    box-shadow: var(--toolbar-button-shadow-hover);
}
.file-card.is-selected {
    border-color: var(--el-color-primary);
    box-shadow: 0 0 0 1px var(--el-color-primary);
}
/* v3.0.0（R12，需求 43）：删除中遮罩 + 转圈 */
.card-deleting-mask {
    position: absolute;
    inset: 0;
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: rgba(0, 0, 0, 0.42);
    backdrop-filter: blur(1px);
    color: #fff;
    font-size: 12px;
    cursor: progress;
}
.card-deleting-spinner {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    animation: card-deleting-spin 0.8s linear infinite;
}
@keyframes card-deleting-spin {
    to { transform: rotate(360deg); }
}

/* ── 上半部分：缩略图 ──────────────────────────────────────────── */
.card-preview {
    height: 150px;
    position: relative;
    background: var(--el-fill-color-light);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
}
.image-preview,
.video-preview {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    filter: var(--image-preview-filter);
}
.video-preview {
    cursor: pointer;
}
.file-preview {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    height: 100%;
}
.file-icon-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    font-size: 42px;
    color: var(--theme-toggle-color);
    opacity: 0.6;
}
.file-ext {
    font-size: 12px;
    text-transform: uppercase;
}
.file-icon {
    opacity: 0.6;
    font-size: clamp(40px, 4vw, 64px);
    transition: transform 0.4s ease;
}
.audio-icon {
    color: var(--el-color-primary);
    opacity: 0.8;
}

/* ── 悬浮层 ───────────────────────────────────────────────────── */
.card-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    opacity: 0;
    transition: opacity 0.25s ease;
    pointer-events: none;
}
.file-card:hover .card-overlay,
.file-card:focus-within .card-overlay {
    opacity: 1;
    pointer-events: auto;
}
/* v2.6.0：左上角渠道图标与右上角选择按钮「同水平」—— 垂直居中对齐 + 减小上边距 */
.overlay-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 4px 8px;
}
.card-tags {
    display: flex;
    gap: 5px;
    align-items: center;
    min-width: 0;
    flex-wrap: wrap;
}
/* 渠道简称角标：沿用原卡片配色（绿=主渠道，橙=备份，红=拦截） */
.channel-tag {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    background-color: rgba(34, 139, 34, 0.6);
    color: rgba(255, 255, 255, 0.95);
    border: 1px solid rgba(34, 139, 34, 0.7);
}
.channel-tag.is-block {
    background-color: rgba(220, 53, 69, 0.6);
    border-color: rgba(220, 53, 69, 0.7);
}
.backup-tag {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    background-color: rgba(230, 162, 60, 0.62);
    color: rgba(255, 255, 255, 0.96);
    border: 1px solid rgba(230, 162, 60, 0.72);
}
/* v2.7.0：选择圆圈恒靠右上 —— 绝对定位，不依赖悬浮层的 flex 布局（
   移动端隐藏渠道角标后 checkbox 也不会掉到左上角，与文件夹卡片行为一致） */
/* v2.8.5：选中态必须始终可见（不依赖鼠标悬浮），未选中仍保持「悬浮才出现」 */
.card-select {
    position: absolute;
    top: 5px;
    right: 8px;
    z-index: 3;
    margin: 0;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.25s ease;
}
.file-card:hover .card-select,
.file-card:focus-within .card-select,
.file-card.is-selected .card-select,
/* v3.0.0：只要列表里有一个文件被选中，其余卡片也常显勾选框（批量操作更直观） */
.file-card.is-force-select .card-select {
    opacity: 1;
    pointer-events: auto;
}
/* v2.8.0：手机端/平板端下选择圆圈整体上移 4px（PC 端保持不动） */
@media (max-width: 1199px) {
    .card-select {
        top: 1px;
    }
}
.card-select :deep(.el-checkbox__inner) {
    /* v3.0.0（R14）：卡片右上角选中按钮调大一点（16 → 18px） */
    width: 18px !important;
    min-width: 18px;
    height: 18px !important;
    min-height: 18px;
    border-radius: 50% !important;
    /* v2.8.0：未选中时圆圈内部透明（不填充白色） */
    background: transparent;
    /* v2.7.0：去掉白色描边覆盖，圆圈颜色与文件夹卡片的选择按钮一致（默认描边） */
}
/* v2.8.5：选中时恢复主题色填充（transparent 规则会按级联顺序盖掉 EP 选中态默认背景） */
.card-select :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
    background-color: var(--el-color-primary);
    border-color: var(--el-color-primary);
}
/* v2.8.5：选中态对勾保持白色可见 */
.card-select :deep(.el-checkbox__input.is-checked .el-checkbox__inner::after) {
    border-color: #fff;
}
/* 中间：复制 / 打开 / 移动 */
.overlay-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
}
.overlay-btn {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 50%;
    background: var(--el-color-primary);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    transition: transform 0.2s ease, background 0.2s ease;
}
.overlay-btn:hover {
    transform: scale(1.1);
    filter: brightness(1.1);
}
.overlay-btn:active {
    transform: scale(0.95);
}
/* 下方中间：访问次数（小眼睛 + 数字）；v2.6.0 下方边距 +1px */
.card-views-badge {
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 9px;
    margin-bottom: 1px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.5;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    white-space: nowrap;
}
.card-views-icon {
    font-size: 10px;
    opacity: 0.9;
}

/* ── 下半部分：文件信息（对齐历史记录 grid-info）────────────────── */
.card-info {
    padding: 10px 12px;
    background: var(--toolbar-button-bg-color);
}
.file-name {
    font-size: 13px;
    font-weight: 500;
    /* v2.7.0：中间省略 —— start 可收缩出省略号，end（含扩展名）固定可见（同历史记录） */
    display: flex;
    align-items: baseline;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    margin-bottom: 6px;
    color: var(--upload-text-color);
}
.name-start {
    flex-shrink: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.name-end {
    flex-shrink: 0;
    white-space: nowrap;
}
.card-meta {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    opacity: 0.65;
    color: var(--upload-text-color);
}
/* v3.0.0（R9）：第三行 —— 左：评分（星）/ 级别（爱心），右：上传用户（原预览小眼睛已移除） */
.card-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 18px;
    margin-top: 4px;
}
/* 评分 / 级别图标组：默认灰色空图标，有值时点亮并把数字叠在图标中间 */
.card-rating-level {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    /*
     * v3.0.0（R19）：与上一行「上传日期 / 文件大小」(.card-meta) 保持完全一致 ——
     * 同色 + 同透明度（0.65），不再比日期行更抢眼。
     */
    color: var(--upload-text-color);
    opacity: 0.65;
}
.rating-level-icon {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    font-size: 13px;
    line-height: 1;
    /* v3.0.0（R14）：有值/无值统一使用与用户名相同的颜色（不再点亮金黄 / 红色） */
    color: var(--upload-text-color);
}
.rating-level-num {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    /* v3.0.0（R19）：数字比图标小一号（8px → 7px），且不再加粗 */
    font-size: 7px;
    font-weight: 400;
    font-style: normal;
    line-height: 1;
    /*
     * v3.0.0（R15）：数字改用与文件名一致的正文色 ——
     * 之前固定 #fff，白天模式下卡片信息区是浅底，白色数字几乎看不见。
     * 光晕改成卡片底色，保证叠在空心图标上仍然清晰。
     */
    color: var(--upload-text-color);
    text-shadow: 0 0 2px var(--toolbar-button-bg-color), 0 0 3px var(--toolbar-button-bg-color);
    pointer-events: none;
}
.upload-user {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    font-size: 12px;
    opacity: 0.7;
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--upload-text-color);
}
/* v3.0.0（第三轮）：右下角「共享」标识 —— 与上传用户同一行、居最右，尺寸沿用同一行的 12px 信息级 */
.shared-badge {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 11px;
    line-height: 17px;
    white-space: nowrap;
    color: var(--primary-color, #2563EB);
    background: color-mix(in srgb, var(--primary-color, #2563EB) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--primary-color, #2563EB) 30%, transparent);
}

/* 骨架图加载动画 */
@keyframes skeleton-shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}
.skeleton-wrapper {
    width: 100%;
    height: 100%;
    background: linear-gradient(
        90deg,
        var(--skeleton-bg-color) 25%,
        color-mix(in srgb, var(--skeleton-bg-color) 70%, var(--skeleton-shimmer-color)) 50%,
        var(--skeleton-bg-color) 75%
    );
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s ease-in-out infinite;
}
/* 加载失败提示 */
.error-wrapper {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--skeleton-bg-color);
    gap: 8px;
}
.error-icon {
    font-size: 32px;
    color: var(--el-color-warning);
    opacity: 0.7;
}
.error-text {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

/* ── 移动端：无 hover —— 标识/选择常显，操作与访问次数隐藏 ────────── */
@media (max-width: 768px) {
    .card-preview {
        height: 130px;
    }
    .file-card {
        contain-intrinsic-size: 190px;
    }
    .card-overlay {
        opacity: 1;
        background: transparent;
        pointer-events: none;
        justify-content: flex-start;
    }
    .overlay-actions,
    .card-views-badge {
        display: none;
    }
    /* v2.6.0：移动端封面左上角不显示存储/备份渠道图标 */
    .card-tags {
        display: none;
    }
    /* v2.6.0：选择按钮与渠道图标同水平（同步收紧上边距 + 垂直居中） */
    .overlay-top {
        align-items: center;
        padding: 3px 6px;
    }
    .card-info {
        padding: 8px 10px;
    }
}
</style>
