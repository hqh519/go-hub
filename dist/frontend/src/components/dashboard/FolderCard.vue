<template>
    <!--
        v2.5.0（v20261023-2）：文件夹卡片同样改为「上下两部分」：
          上 = 文件夹图标（悬浮时右上角选择圆圈 + 操作按钮）
          下 = 文件夹名称 + 子文件夹 / 文件数量统计
        行为不变：点击进入文件夹；批量选择仍走页面下方操作栏。
    -->
    <div
        class="folder-card"
        :class="{ 'is-selected': localSelected, 'is-deleting': deleting, 'is-force-select': showSelect }"
        @contextmenu.prevent
        @touchstart="$emit('touchstart', $event)"
        @touchend="$emit('touchend', $event)"
        @touchmove="$emit('touchmove', $event)"
    >
        <!-- v3.0.0（R12，需求 43）：删除中 → 整卡遮罩 + 转圈，避免重复点击 -->
        <div v-if="deleting" class="card-deleting-mask" role="status" aria-live="polite">
            <span class="card-deleting-spinner"></span>
            <span class="card-deleting-text">{{ deletingLabel || $t('dashboard.deletingHint') }}</span>
        </div>
        <!-- 上半部分：文件夹图标 -->
        <div class="folder-preview" @click="$emit('enter')">
            <font-awesome-icon icon="folder-open" class="folder-icon-svg"/>
            <!--
                v1.0.2：恢复文件夹可选中（上一版禁选是因为移动/删除不生效，根因已修复）。
                圆圈与文件卡片一致：绝对定位右上角、选中态恒显、只读共享目录不可选。
            -->
            <el-checkbox
                v-if="!sharedReadonly"
                v-model="localSelected"
                class="card-select"
                @click.stop
                @change="$emit('update:selected', localSelected)"
            ></el-checkbox>
            <!-- 悬浮层：操作按钮（复制链接 / 移动） -->
            <div class="folder-overlay">
                <div v-if="showActions" class="overlay-actions" @click.stop>
                    <el-tooltip :disabled="disableTooltip" :content="$t('dashboard.copyLink')" placement="top" :show-after="600">
                        <button class="overlay-btn" @click.stop="$emit('copy')">
                            <font-awesome-icon icon="copy"></font-awesome-icon>
                        </button>
                    </el-tooltip>
                    <el-tooltip :disabled="disableTooltip" :content="$t('dashboard.moveFile')" placement="top" :show-after="600">
                        <button class="overlay-btn" @click.stop="$emit('move')">
                            <font-awesome-icon icon="file-export"></font-awesome-icon>
                        </button>
                    </el-tooltip>
                    <!-- v2.8.7：文件夹卡片悬浮层移除「删除」按钮（删除走批量操作栏 / 列表视图，避免悬浮误触） -->
                </div>
            </div>
        </div>

        <!-- 下半部分：名称 + 数量统计 + 创建用户（v2.6.0 第三行）
             v3.0.0：点名称 = 打开「目录属性」，进入目录改为点上方文件夹图标 / 空白区域
             v3.0.0（R8）：只读共享目录没有「属性」入口（详情按钮隐藏），点名称改为进入目录 -->
        <div class="card-info" @click="sharedReadonly ? $emit('enter') : $emit('props')">
            <div class="file-name" :title="sharedReadonly ? folderName : (folderName + ' · ' + $t('fileManager.folderPropsHint'))">
                <span class="name-start">{{ folderNameParts.start }}</span><span class="name-end">{{ folderNameParts.end }}</span>
                <!-- v3.0.0（R14）：名称右侧的「属性」提示图标已按需求移除（点名称仍打开属性面板） -->
            </div>
            <div class="folder-stats">
                <template v-if="statsText">{{ statsText }}</template>
                <template v-else>-</template>
            </div>
            <div class="folder-creator" :title="$t('dashboard.folderCreator')">
                <font-awesome-icon icon="user" />
                {{ creatorName || '-' }}
                <!-- v3.0.0：共享标识 —— 共享目录本身与其下所有子目录都显示（所有可查看者可见） -->
                <span
                    v-if="shared"
                    class="shared-badge"
                    :title="sharedSelf ? $t('fileManager.sharedBadgeSelfTitle') : $t('fileManager.sharedBadgeTitle', { owner: sharedOwner || '' })"
                >{{ $t('fileManager.sharedBadge') }}</span>
            </div>
        </div>
    </div>
</template>

<script>
import { splitFileName } from '../../utils/fileName';
export default {
    name: 'FolderCard',
    props: {
        name: { type: String, required: true },
        selected: { type: Boolean, default: false },
        showActions: { type: Boolean, default: true },
        disableTooltip: { type: Boolean, default: false },
        /** v2.5.0：该文件夹的统计 { folders, files }（后端 /list 的 directoryStats 下发） */
        folderStats: { type: Object, default: null },
        /** v3.0.0：目录是否处于「共享」状态（共享者与所有被共享者都显示标识） */
        shared: { type: Boolean, default: false },
        /** 共享目录的归属者（标识 tooltip 展示） */
        sharedOwner: { type: String, default: '' },
        // v3.0.0（R5）：是否「我共享出去的」（提示文案与接收方不同）
        sharedSelf: { type: Boolean, default: false },
        // v3.0.0（R8）：是否「别人共享给我且为只读」—— 隐藏属性入口（详情按钮）、不可选中
        sharedReadonly: { type: Boolean, default: false },
        /**
         * v3.0.0（R12）：目录属性里自定义的「目录名称」。
         * 只影响展示，真实路径仍是 name（进入目录 / 复制链接都用 name）。
         */
        displayName: { type: String, default: '' },
        /** v3.0.0（R12）：正在删除（显示转圈遮罩） */
        deleting: { type: Boolean, default: false },
        /** v3.0.0（R12）：遮罩文案（默认「正在删除…」，回收站里传「正在处理…」） */
        deletingLabel: { type: String, default: '' },
        /**
         * v3.0.0（R14）：强制显示右上角选择圆圈。
         * 场景：列表中已有任意一个文件夹被选中时，其余文件夹也把圆圈显示出来，
         * 避免用户必须逐个悬浮才能看到可选项。
         */
        showSelect: { type: Boolean, default: false }
    },
    // v3.0.0：新增 props（目录属性）
    emits: ['update:selected', 'enter', 'props', 'copy', 'move', 'delete', 'touchstart', 'touchend', 'touchmove'],
    data() {
        return {
            localSelected: this.selected
        }
    },
    computed: {
        folderName() {
            // v3.0.0（R12）：优先用目录属性里的自定义名称（改名后立即生效）
            if (this.displayName) return this.displayName;
            const parts = this.name.split('/').filter(Boolean);
            return parts[parts.length - 1] || this.name;
        },
        /**
         * v2.8.0：文件夹名中间省略（与 FileCard 文件名同规则）：
         * ≤24 全显，否则保留头部与尾部各 12 字符，中段由 CSS 按宽度自动省略。
         */
        /* v2.8.6：文件夹名中间省略统一口径 */
        folderNameParts() {
            return splitFileName(this.folderName || '');
        },
        /** 「X 个子文件夹 · Y 个文件」；统计缺失时显示占位 */
        statsText() {
            const s = this.folderStats;
            if (!s || (s.folders === undefined && s.files === undefined)) return '';
            return this.$t('dashboard.folderStat', {
                folders: Number(s.folders || 0),
                files: Number(s.files || 0)
            });
        },
        /** v2.6.0：创建用户名（后端 directoryStats.creator = 文件夹内最早文件的上传者） */
        creatorName() {
            return this.folderStats?.creator || '';
        }
    },
    watch: {
        selected(val) {
            this.localSelected = val;
        }
    }
}
</script>

<style scoped>
/* ── 卡片整体：与 FileCard 同构 ───────────────────────────────── */
.folder-card {
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
.folder-card:hover {
    box-shadow: var(--toolbar-button-shadow-hover);
}
.folder-card.is-selected {
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

/* ── 上半部分：文件夹图标 ─────────────────────────────────────── */
.folder-preview {
    height: 150px;
    position: relative;
    background: var(--el-fill-color-light);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: var(--el-color-primary);
}
.folder-icon-svg {
    font-size: clamp(40px, 4vw, 64px);
    transition: transform 0.4s ease;
    opacity: 0.85;
}
.folder-card:hover .folder-icon-svg {
    transform: scale(1.06);
}

/* 悬浮层 */
.folder-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    opacity: 0;
    transition: opacity 0.25s ease;
    pointer-events: none;
}
.folder-card:hover .folder-overlay,
.folder-card:focus-within .folder-overlay {
    opacity: 1;
    pointer-events: auto;
}
/* v1.0.2：恢复选择圆圈 —— 与 FileCard 完全同一套定位与配色 */
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
.folder-card:hover .card-select,
.folder-card:focus-within .card-select,
.folder-card.is-selected .card-select,
/* 列表里已有一个文件夹被选中 → 其余文件夹也常显圆圈（批量操作更直观） */
.folder-card.is-force-select .card-select {
    opacity: 1;
    pointer-events: auto;
}
@media (max-width: 1199px) {
    .card-select {
        top: 1px;
    }
}
.card-select :deep(.el-checkbox__inner) {
    width: 18px !important;
    min-width: 18px;
    height: 18px !important;
    min-height: 18px;
    border-radius: 50% !important;
    background: transparent;
}
.card-select :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
    background-color: var(--el-color-primary);
    border-color: var(--el-color-primary);
}
.card-select :deep(.el-checkbox__input.is-checked .el-checkbox__inner::after) {
    border-color: #fff;
}
.overlay-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding-bottom: 12px;
    /* 上方 overlay-top 已移除，靠 margin-top:auto 把操作按钮压到卡片底部 */
    margin-top: auto;
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
.overlay-btn.is-danger {
    background: var(--el-color-danger);
}
.overlay-btn:hover {
    transform: scale(1.1);
    filter: brightness(1.1);
}
.overlay-btn:active {
    transform: scale(0.95);
}

/* ── 下半部分：名称 + 统计 ────────────────────────────────────── */
.card-info {
    padding: 10px 12px;
    background: var(--toolbar-button-bg-color);
}
.file-name {
    font-size: 13px;
    font-weight: 500;
    display: flex;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    margin-bottom: 6px;
    color: var(--upload-text-color);
}
/* v2.8.0：中间省略 —— start 可收缩省略，end 固定保留（含尾部） */
.file-name .name-start {
    flex-shrink: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.file-name .name-end {
    flex-shrink: 0;
    white-space: nowrap;
}
/* v3.0.0：名称右侧的「属性」提示图标 —— 点名称即打开目录属性面板 */
.file-name .name-props-icon {
    flex: 0 0 auto;
    margin-left: 6px;
    font-size: 11px;
    opacity: 0.5;
    transition: opacity 0.2s ease, color 0.2s ease;
}
.card-info:hover .name-props-icon {
    opacity: 1;
    color: var(--primary-color-accent, var(--el-color-primary));
}
.folder-stats {
    font-size: 12px;
    opacity: 0.65;
    color: var(--upload-text-color);
}
/* v2.6.0：第三行 —— 创建用户名（与 FileCard 的 upload-user 同款样式，保证卡片等高） */
.folder-creator {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    opacity: 0.7;
    margin-top: 4px;
    max-width: 100%;
    overflow: hidden;
    color: var(--upload-text-color);
}
/* v3.0.0：共享标识 —— 与文件卡片同款，靠行尾展示 */
.folder-creator .shared-badge {
    flex: 0 0 auto;
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 11px;
    line-height: 17px;
    white-space: nowrap;
    opacity: 1;
    color: var(--primary-color, #2563EB);
    background: color-mix(in srgb, var(--primary-color, #2563EB) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--primary-color, #2563EB) 30%, transparent);
}

/* ── 移动端：无 hover —— 选择常显，操作隐藏 ───────────────────── */
@media (max-width: 768px) {
    .folder-preview {
        height: 130px;
    }
    .folder-card {
        contain-intrinsic-size: 190px;
    }
    .folder-overlay {
        opacity: 1;
        pointer-events: none;
        justify-content: flex-start;
    }
    .overlay-actions {
        display: none;
    }
    .card-info {
        padding: 8px 10px;
    }
}
</style>
