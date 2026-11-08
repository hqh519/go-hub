<template>
    <div class="upload-form" :class="{'upload-form-busy': fileList.length}">
        <textarea
            ref="clipboardPasteReceiver"
            class="clipboard-paste-receiver"
            tabindex="-1"
            aria-hidden="true"
        ></textarea>
        <!--
            v3.0.0：移动端（hover:none 触屏设备）在操作区左右滑动可切换「文件 / 链接」模式：
            向右滑 = 文件模式、向左滑 = 链接模式；桌面端不绑定手势、行为不变。
        -->
        <div
            class="upload-card-wrapper"
            :class="{ 'swipe-fade': swipeFeedback }"
            @mousemove="handleUploadCardMouseMove"
            @mouseleave="handleUploadCardMouseLeave"
            @drop.capture.stop.prevent="handleDrop"
            @touchstart.passive="handleMethodSwipeStart"
            @touchend.passive="handleMethodSwipeEnd"
        >
            <div class="upload-card-glow" ref="uploadCardGlow"></div>
            <!-- 默认上传模式：结构与「链接」模式一一对应
                 .upload-card（外层大框）= 链接模式 .upload-card
                 .default-card（虚线卡片）= 链接模式 .paste-card
                 .el-upload-dragger（拖拽区）= 链接模式 .upload-card-textarea
                 .default-upload-actions（自动上传开关）= 链接模式 .paste-card-actions -->
            <div
                v-if="uploadMethod === 'default'"
                class="upload-card"
            >
                <div
                    class="default-card"
                    :class="{'is-uploading': uploading, 'upload-card-busy': fileList.length, 'swipe-fade': swipeFeedback}"
                >
                    <el-upload
                        class="default-upload-dragger"
                        drag
                        multiple
                        :accept="acceptAttr"
                        :http-request="uploadFile"
                        :onSuccess="handleSuccess"
                        :on-error="handleError"
                        :before-upload="beforeUpload"
                        :on-progress="handleProgress"
                        :file-list="fileList"
                        :show-file-list="false"
                        >
                        <el-icon class="el-icon--upload" :class="{'upload-list-busy': fileList.length}">
                            <svg class="upload-plus-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" aria-hidden="true">
                                <path d="M12 7v10"/>
                                <path d="M7 12h10"/>
                            </svg>
                        </el-icon>
                        <div class="upload-prompt-row">
                            <div class="el-upload__text" :class="{'upload-list-busy': fileList.length}" v-html="$t('upload.dragUploadText', { pasteShortcut })"></div>
                            <el-tooltip :disabled="disableTooltip" :content="$t('upload.selectFolderUpload')" placement="top" :show-after="1000">
                                <button
                                    type="button"
                                    class="folder-upload-icon-button"
                                    :class="{'upload-list-busy': fileList.length}"
                                    :aria-label="$t('upload.selectFolderUpload')"
                                    @click.stop.prevent="openFolderPicker"
                                >
                                    <font-awesome-icon icon="folder-open" />
                                </button>
                            </el-tooltip>
                        </div>
                    </el-upload>
                    <!-- 底部操作行：与「链接」模式的 转存/外链 同一方位（虚线卡片内右下角）。
                         @click.stop 阻止冒泡到 el-upload 的拖拽区，避免点开关时弹出文件选择框 -->
                    <div class="default-upload-actions" @click.stop>
                        <el-button
                            v-if="!autoUpload"
                            type="primary"
                            size="small"
                            class="paste-card-upload-button manual-upload-button"
                            :disabled="!fileList.some(item => item.status === 'waiting')"
                            @click.stop="startManualUpload"
                        >
                            <font-awesome-icon icon="upload" class="manual-upload-icon"/>
                            {{ $t('uploadForm.uploadNow') }}
                        </el-button>
                        <!-- 开关文案固定为「自动」（不再随状态变成「手动」）；
                             点文字也能切换，扩大触控热区 -->
                        <div class="default-upload-switch">
                            <span class="auto-upload-switch-control" @click.stop>
                                <el-switch
                                    :model-value="autoUpload"
                                    @update:model-value="$emit('update:autoUpload', $event)"
                                    class="auto-upload-switch"
                                />
                            </span>
                            <span
                                class="auto-upload-switch-label"
                                role="switch"
                                :aria-checked="autoUpload ? 'true' : 'false'"
                                @click.stop="toggleAutoUpload"
                            >{{ $t('uploadForm.autoUpload') }}</span>
                        </div>
                    </div>
                </div>
            </div>
            <input
                ref="folderInput"
                class="folder-upload-input"
                type="file"
                webkitdirectory
                directory
                multiple
                @change="handleFolderSelection"
            />
        </div>
        <div
            v-if="uploadMethod === 'paste'"
            class="upload-card"
            @touchstart.passive="handleMethodSwipeStart"
            @touchend.passive="handleMethodSwipeEnd"
        >
            <el-card
                class="paste-card"
                :class="{'is-uploading': uploading, 'upload-card-busy': fileList.length, 'swipe-fade': swipeFeedback}"
            >
                <el-input
                    v-model="pastedUrls"
                    class="upload-card-textarea"
                    :placeholder="$t('upload.pasteUrlPlaceholder')"
                    type="textarea"
                    :rows="fileList.length ? 4 : 14"
                />
                <div class="paste-card-actions">
                    <!-- v2.8.2：上传按钮常驻渲染，外链模式用 visibility 隐藏但保留占位，
                         避免右侧转存/外链模块整体左移；功能与文件模式的「上传」一致 ——
                         只负责把已拉取就绪的待上传条目提交上传 -->
                    <el-button
                        class="paste-card-upload-button paste-card-start-button"
                        :class="{ 'is-hidden': pasteUploadMethod === 'external' }"
                        type="primary"
                        :size="pasteCardMethodButtonSize"
                        :disabled="!fileList.some(item => item.status === 'waiting' && (item.rawFile || item.stagedId))"
                        @click="startManualUpload"
                    >
                        {{ $t('uploadForm.uploadNow') }}
                    </el-button>
                    <!-- v2.8.2：转存 / 外链去掉分段模块，改为两个独立按钮，单击即一键完成：
                         转存 = 检测输入框 → 提取有效链接 → 拉取文件 → 加载到列表待编辑/裁剪；
                         外链 = 检测输入框 → 提取有效链接 → 生成外链格式加载到列表 -->
                    <div class="paste-card-method-btns">
                        <el-button
                            class="paste-card-upload-button paste-card-method-btn"
                            :class="{ 'is-active': pasteUploadMethod === 'save' }"
                            type="primary"
                            plain
                            :size="pasteCardMethodButtonSize"
                            @click="handlePasteSave"
                        >
                            {{ $t('upload.pasteSave') }}
                        </el-button>
                        <!--
                            v1.0.6：「外链」收进「其他」下拉，下拉里依次是「下载」「外链」。
                            桌面端悬停「其他」即展开（不用先点一下），触屏设备改成点击展开
                            —— 触屏没有 hover，用 hover 触发会变成「点了没反应」。
                        -->
                        <el-dropdown
                            class="paste-card-other"
                            :trigger="otherMenuTrigger"
                            placement="bottom-end"
                            @command="handleOtherMenuCommand"
                        >
                            <el-button
                                class="paste-card-upload-button paste-card-method-btn"
                                :class="{ 'is-active': pasteUploadMethod === 'external' }"
                                type="primary"
                                plain
                                :size="pasteCardMethodButtonSize"
                            >
                                {{ $t('upload.pasteOther') }}
                                <font-awesome-icon icon="chevron-down" style="margin-left: 4px; font-size: 10px;"/>
                            </el-button>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item command="download">
                                        <font-awesome-icon icon="download" style="width: 14px; margin-right: 6px;"/>
                                        {{ $t('upload.downloadLinks') }}
                                    </el-dropdown-item>
                                    <el-dropdown-item command="external">
                                        <font-awesome-icon icon="link" style="width: 14px; margin-right: 6px;"/>
                                        {{ $t('upload.pasteExternal') }}
                                    </el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>
                    </div>
                </div>
            </el-card>
        </div>
        <el-card class="upload-list-card" :class="{'upload-list-busy': fileList.length}">
            <div class="upload-list-container">
                <el-scrollbar @scroll="handleScroll" ref="scrollContainer">
                    <div class="upload-list-dashboard" :class="{ 'list-scrolled': listScrolled }">
                        <el-text class="upload-list-dashboard-title">
                            <el-icon><List /></el-icon>{{ uploadingCount + waitingCount }}
                            <el-icon><Checked /></el-icon>{{ uploadSuccessCount }}
                            <el-icon><Failed /></el-icon>{{ uploadErrorCount }}
                        </el-text>
                        <div class="upload-list-dashboard-action">
                            <div class="modern-action-group">
                                <!--
                                    v2.7.0：「文件压缩」改为与自动重试同款的下拉开关 ——
                                    点图标展开「压缩文件 + 开关」，点开关切换（customerCompress，
                                    与「上传设置」弹窗里的开关双向同步不变）。
                                    v2.8.8：后台「文件压缩」总开关关闭时整个按钮不渲染。
                                -->
                                <el-tooltip v-if="compressEnabled" :disabled="disableTooltip" :content="$t('upload.fileCompress')" placement="top" :show-after="1000">
                                    <el-dropdown>
                                        <button
                                            type="button"
                                            class="modern-action-btn modern-action-btn-compress"
                                            :class="{ 'is-active': customerCompress }"
                                            :aria-pressed="customerCompress"
                                            :aria-label="$t('upload.fileCompress')"
                                        >
                                            <font-awesome-icon :icon="customerCompress ? 'compress-alt' : 'expand-alt'" />
                                        </button>
                                        <template #dropdown>
                                            <el-dropdown-menu class="modern-dropdown-menu">
                                                <el-dropdown-item>
                                                    <div class="modern-dropdown-item-content">
                                                        <span>{{ $t('upload.fileCompress') }}</span>
                                                        <el-switch
                                                            :model-value="customerCompress"
                                                            @update:model-value="$emit('update:customerCompress', $event)"
                                                            size="small"
                                                        />
                                                    </div>
                                                </el-dropdown-item>
                                            </el-dropdown-menu>
                                        </template>
                                    </el-dropdown>
                                </el-tooltip>
                                <!--
                                    v2.8.9： 「转换为WebP」移到「文件压缩」正后方，交互与文件压缩一致
                                    （点图标展开「转换为WebP + 开关」）；后台总开关关闭时整颗按钮不加载。
                                -->
                                <el-tooltip v-if="webpEnabled" :disabled="disableTooltip" :content="$t('upload.convertToWebp')" placement="top" :show-after="1000">
                                    <el-dropdown>
                                        <button
                                            type="button"
                                            class="modern-action-btn modern-action-btn-webp"
                                            :class="{ 'is-active': convertToWebp }"
                                            :aria-pressed="convertToWebp"
                                            :aria-label="$t('upload.convertToWebp')"
                                        >
                                            <font-awesome-icon icon="file-image" />
                                        </button>
                                        <template #dropdown>
                                            <el-dropdown-menu class="modern-dropdown-menu">
                                                <el-dropdown-item>
                                                    <div class="modern-dropdown-item-content">
                                                        <span>{{ $t('upload.convertToWebp') }}</span>
                                                        <el-switch
                                                            :model-value="convertToWebp"
                                                            @update:model-value="$emit('update:convertToWebp', $event)"
                                                            size="small"
                                                        />
                                                    </div>
                                                </el-dropdown-item>
                                            </el-dropdown-menu>
                                        </template>
                                    </el-dropdown>
                                </el-tooltip>
                                <el-tooltip :disabled="disableTooltip" :content="$t('upload.copyAll')" placement="top" :show-after="1000">
                                    <el-dropdown trigger="hover" @command="copyAll">
                                        <button
                                            type="button"
                                            class="modern-action-btn modern-action-btn-copy"
                                            :aria-label="`${$t('upload.copyAll')} (${defaultCopyFormat.label})`"
                                            @click="copyAll()"
                                        >
                                            <font-awesome-icon icon="copy" />
                                            <!-- v2.3.0：复制按钮上的格式角标（Url / M / H / B）已移除 -->
                                        </button>
                                        <template #dropdown>
                                            <el-dropdown-menu class="modern-dropdown-menu">
                                                <el-dropdown-item
                                                    v-for="format in alternativeCopyFormats"
                                                    :key="format.value"
                                                    :command="format.value"
                                                    :class="{ 'copy-format-active': format.value === selectedUrlForm }"
                                                >
                                                    <font-awesome-icon :icon="format.icon" class="copy-format-icon" aria-hidden="true" />
                                                    {{ format.label }}
                                                    <font-awesome-icon
                                                        v-if="format.value === selectedUrlForm"
                                                        icon="check"
                                                        class="copy-format-check"
                                                        aria-hidden="true"
                                                    />
                                                </el-dropdown-item>
                                            </el-dropdown-menu>
                                        </template>
                                    </el-dropdown>
                                </el-tooltip>
                                <!--
                                    v2.8.9：顶栏「失败重试」图标按钮移除 —— 自动重试开关已迁后台
                                    （其他设置 → 上传相关配置 → 失败自动重试），前台不再保留该入口。
                                    失败项仍可在列表内单独重试，无需顶栏按钮。
                                -->
                                <el-tooltip :disabled="disableTooltip" :content="$t('upload.clearList')" placement="top" :show-after="1000">
                                    <el-dropdown>
                                        <button class="modern-action-btn modern-action-btn-danger">
                                            <font-awesome-icon icon="trash-alt" />
                                        </button>
                                        <template #dropdown>
                                            <el-dropdown-menu class="modern-dropdown-menu">
                                                <el-dropdown-item @click="clearFileList">{{ $t('upload.clearAll') }}</el-dropdown-item>
                                                <el-dropdown-item @click="clearSuccessList">{{ $t('upload.clearUploaded') }}</el-dropdown-item>
                                                <!-- v2.7.0：清空链接输入框（原链接输入框旁的独立清空按钮迁到这里） -->
                                                <el-dropdown-item @click="clearPasteInput">{{ $t('upload.clearPasteInput') }}</el-dropdown-item>
                                            </el-dropdown-menu>
                                        </template>
                                    </el-dropdown>
                                </el-tooltip>
                            </div>
                        </div>
                    </div>
                    <UploadFileItem
                        v-for="file in fileList.slice().reverse()"
                        :key="file.uid"
                        :file="file"
                        :manualMode="!autoUpload || uploadMethod !== 'default'"
                        @copy="handleCopy"
                        @remove="handleRemove"
                        @detail="handleDetail"
                        @crop="handleCrop"
                        @preview-error="handlePreviewError"
                    />
                </el-scrollbar>
            </div>
        </el-card>

        <!--
          上传完成 → 点击列表里的文件名 → 调出「文件详情」。
          全站统一入口：components/dashboard/FileDetailUnified.vue（内部 = FileDetailDialog 模板
          + buildFileDetail 数据构造 + 标签/黑白名单/删除/重命名/重定向等同一套按钮与权限）。
          数据加载统一走 utils/fileDetailLoader.loadFileDetail()。
        -->
        <FileDetailUnified
            v-model="showDetail"
            :file="detailFile"
            @deleted="handleDetailDeleted"
            @fileRenamed="handleDetailFileRenamed"
        />

        <!-- 裁剪（v2.3.0）：手动上传模式下点列表里的剪刀按钮打开 -->
        <ImageCropDialog
            v-model="showCrop"
            :file="cropTarget?.rawFile || null"
            :fileName="cropTarget?.name || ''"
            @done="applyCrop"
        />
    </div>
</template>

<script>
import axios from '@/utils/axios'
import * as imageConversion from 'image-conversion'
import { mapGetters } from 'vuex'
import { buildFileUrls, updateFileListUrls, getUrlByFormat } from '@/utils/upload/urlBuilder'
import {
    collectFilesFromDataTransferItems,
    filesToUploadEntries,
    getRelativeDirectory,
    joinUploadFolder
} from '@/utils/upload/directoryTraversal'
import UploadFileItem from '@/components/upload/UploadFileItem.vue'
import ImageCropDialog from '@/components/upload/ImageCropDialog.vue'
import FileDetailUnified from '@/components/dashboard/FileDetailUnified.vue'
import { loadFileDetail } from '@/utils/fileDetailLoader'
import { copyText } from '@/utils/clipboard'
import { fileLink, getLinkPrefix } from '@/utils/fileLink'
// v2.5.0（v20261023-2）：链接模式输入框自动从脏文本中提取有效 URL
import { extractUrlsFromText } from '@/utils/urlExtract'
import { parseExtList } from '@/utils/upload/compressExtensions'
// v3.0.0：上传前刷新配置时失效渠道列表缓存
import { invalidateStorageChannels } from '@/utils/storageChannels'

const COPY_FORMATS = [
    { value: 'url', label: 'URL', initial: 'Url', icon: 'link' },
    { value: 'md', label: 'Markdown', initial: 'M', icon: 'code' },
    { value: 'html', label: 'HTML', initial: 'H', icon: 'code-branch' },
    { value: 'ubb', label: 'BBCode', initial: 'B', icon: 'quote-right' }
]

export default {
name: 'UploadForm',
components: {
    UploadFileItem,
    ImageCropDialog,
    FileDetailUnified
},
props: {
    selectedUrlForm: {
        type: String,
        default: 'url',
        required: false
    },
    customerCompress: {
        type: Boolean,
        default: true,
        required: false
    },
    compressBar: {
        type: Number,
        default: 5,
        required: false
    },
    serverCompress: {
        type: Boolean,
        default: true,
        required: false
    },
    uploadChannel: {
        type: String,
        default: 'cos',
        required: false
    },
    channelName: {
        type: String,
        default: '',
        required: false
    },
    uploadNameType: {
        type: String,
        default: 'default',
        required: false
    },
    useCustomUrl: {
        type: String,
        default: 'false',
        required: false
    },
    customUrlPrefix: {
        type: String,
        default: '',
        required: false
    },
    autoRetry: {
        type: Boolean,
        default: true,
        required: false
    },
    /**
     * v2.8.9：失败重试次数（后台「失败自动重试 → 失败重试次数」）：
     *   0 = 不限制（一直重试到全部成功）；正数 = 达到该轮次后停止重试，失败项留在列表里。
     */
    retryTimes: {
        type: Number,
        default: 3,
        required: false
    },
    /**
     * v3.0.0（R11）：前端并发数（后台「其他设置 → 上传相关配置 → 前端并发数」）。
     * 浏览器同时上传的文件数；留空默认 3，后端已夹在 1~10。
     */
    uploadConcurrency: {
        type: Number,
        default: 3,
        required: false
    },
    /**
     * v2.8.9：前台上传设置「其他 → 失败自动重试」开关（只管前台上传 / 链接转存）。
     * 仅在后台总开关开启时才可见；后台关闭时忽略该值（整条链路都不自动重试）。
     */
    localAutoRetry: {
        type: Boolean,
        default: true,
        required: false
    },
    urlPrefix: {
        type: String,
        default: '',
        required: false
    },
    uploadMethod: {
        type: String,
        default: 'default',
        required: false
    },
    uploadFolder: {
        type: String,
        default: '',
        required: false
    },
    convertToWebp: {
        type: Boolean,
        default: false,
        required: false
    },
    /** v2.8.8：后台「文件压缩」总开关 —— 关闭时顶栏压缩按钮不渲染 */
    compressEnabled: {
        type: Boolean,
        default: true,
        required: false
    },
    /** v2.8.8：后台「WebP转换」总开关 —— 关闭时顶栏「转换为WebP」按钮不渲染 */
    webpEnabled: {
        type: Boolean,
        default: false,
        required: false
    },
    /**
     * v2.8.8：本次上传的视频兼容转码选择。
     *    ''    → 跟随全局（默认，刷新后回到这个状态）
     *    'on'  → 强制转码
     *    'off' → 不转码
     * 只有账户策略被管理员设为「用户决定」时，上传设置里才会出现这个下拉。
     */
    transcodeChoice: {
        type: String,
        default: '',
        required: false
    },
    /** 自动上传：关闭后文件仅入列，需点击「上传」手动触发（可先改文件名） */
    autoUpload: {
        type: Boolean,
        default: true,
        required: false
    },
    /**
     * 备份渠道（由「上传设置」里的备份渠道下拉决定）：
     *   ''      → 跟随全局默认备份渠道（后端 getStorageChannel 解析）
     *   'none'  → 本次不备份
     *   渠道 ID → 写入该备份渠道
     * 已不再使用「是否备份」开关。
     */
    backupChannel: {
        type: String,
        default: '',
        required: false
    },
    /**
     * v3.0.0（R8）：归属实例（来自上传设置弹窗「归属实例」下拉）——
     *   ''            = 跟随当前实例（localStorage gohub_instance_id）
     *   '__default__' = 强制默认实例（instanceId 参数传 ''）
     *   其它值        = 强制上传到该实例（instanceId 参数传该值）
     */
    instanceId: {
        type: String,
        default: '',
        required: false
    },
    /** 压缩期望：压到原体积的百分比（10-100） */
    compressPercent: {
        type: Number,
        default: 80,
        required: false
    },
    /**
     * 上传限制的「本次覆盖」值（来自上传设置弹窗）：
     *   limitExtensions —— 逗号分隔的扩展名，如 'jpg,png,mp4'；空 = 跟随后台
     *   limitMaxSizeMB  —— 单文件大小上限（MB）；0 / 空 = 跟随后台
     *   limitCompressExts —— 禁止压缩的格式（逗号分隔）；空 = 不做排除，全部按规则压缩
     * 只存在内存里，刷新页面即恢复后台全局设置。
     */
    limitExtensions: {
        type: String,
        default: '',
        required: false
    },
    limitMaxSizeMB: {
        type: Number,
        default: 0,
        required: false
    },
    /** 禁止压缩格式（本次覆盖，逗号分隔；空 = 不排除任何格式） */
    limitCompressExts: {
        type: String,
        default: '',
        required: false
    }
},
emits: ['update:autoUpload', 'update:customerCompress', 'update:convertToWebp', 'update:localAutoRetry', 'changeMethod'],
data() {
    return {
        fileList: [],
        uploading: false,
        maxUploading: 6,
        exceptionList: [],
        listScrolled: false,
        fileListLength: 0,
        localUidCounter: 0,
        pastedUrls: '',
        /**
         * v1.0.6：「其他」下拉的触发方式。
         * 桌面端悬停展开（少点一次），触屏设备必须改成点击 —— 触屏没有 hover，
         * 用 hover 触发等于「点了没反应」。mounted 里按 (hover: none) 覆盖。
         */
        otherMenuTrigger: 'hover',
        pasteUploadMethod: 'save',
        // 失败文件自动重试相关（对齐 CloudFlare-ImgBed 的机制）：
        //   单个文件失败 → 不阻塞，继续上传后面排队的文件；
        //   一波（轮）上传结束后 → 回到失败队列，整队再循环一轮；
        //   一直循环到全部成功（开关关闭则停在手动重试）。
        autoReUpload: true,
        retryTimer: null, // 兼容保留：旧的自动重试定时器引用（现已不用）
        retryDelay: 12000, // 两轮重试之间的等待时间（毫秒）
        retryRound: 0, // 已进行的失败重试轮次（用于提示文案）
        roundTimer: null, // 下一轮重试的调度定时器
        retryLoopActive: false, // 失败重试循环是否正在进行
        // 每轮重试开始前重新解析出的「生效上传参数」，null = 直接用 props/默认值
        liveParams: null,
        // 批量上传并发控制（v3.0.0 R11：由后台「前端并发数」动态控制，默认 3）
        uploadQueue: [], // 等待上传的文件队列
        activeUploads: 0, // 当前正在上传的文件数
        maxConcurrentUploads: 3, // 最大并发上传数
        // 取消上传控制
        abortControllers: new Map(), // 存储每个文件的 AbortController
        pasteFocusTarget: null,
        // 手动上传模式（autoUpload=false）时，点击「上传」按钮临时置位，绕过入列拦截
        forcedUpload: false,
        // 文件详情弹窗（点击上传列表里的文件名打开）
        showDetail: false,
        detailFile: null,
        // 裁剪（v2.3.0）：手动上传模式下，点待上传图片右侧剪刀按钮打开裁剪页
        showCrop: false,
        cropTarget: null,
        // v3.0.0：移动端滑动切换模式后的淡入反馈（短暂置位触发 CSS 动画）
        swipeFeedback: false,
        // v3.0.0：当前是否为触屏设备（hover:none）—— 仅移动端启用滑动切换
        isTouchDevice: typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            && window.matchMedia('(hover: none)').matches,
    }
},
watch: {
    fileList: {
        handler() {
            if (this.fileList.length > this.fileListLength) {
                this.$nextTick(() => {
                    setTimeout(() => {
                        if (this.$refs.scrollContainer) {
                            // this.$refs.scrollContainer.setScrollTop(this.$refs.scrollContainer.wrapRef.scrollHeight) // 滚动到底部
                            this.$refs.scrollContainer.setScrollTop(0) // 滚动到顶部
                        }
                    }, 100)
                })
            }
            this.fileListLength = this.fileList.length
        },
        deep: true
    },
    useCustomUrl: {
        handler() {
            updateFileListUrls(this.fileList, this.rootUrl)
        },
        immediate: true
    },
    customUrlPrefix: {
        handler() {
            if (this.useCustomUrl === 'true') {
                updateFileListUrls(this.fileList, this.rootUrl)
            }
        },
        immediate: true
    },
    /*
     * v2.8.8：自动重试改由后台「其他设置 → 上传相关配置 → 自动重试」统一控制，
     * 前台不再持久化本地开关 —— 因此这里不再向 store 写值。
     */
    /**
     * 用户在上传页当场改了上传参数（渠道 / 目录 / 命名 / 备份…）时，
     * 丢掉重试轮次缓存下来的参数快照，立刻回落到最新的 props。
     */
    uploadChannel() { this.liveParams = null },
    channelName() { this.liveParams = null },
    backupChannel() { this.liveParams = null },
    uploadFolder() { this.liveParams = null },
    uploadNameType() { this.liveParams = null },
    compressPercent() { this.liveParams = null },
    urlPrefix() { this.liveParams = null },
    /** 文件数或状态变化 → 重新观察 + 重新量一次列表区高度（最多显示 3 个） */
    listSignature() {
        this.$nextTick(() => {
            this.observeUploadList()
            this.updateUploadListHeight()
        })
    },
    // v3.0.0：以下两个监听原先在文件里第二个重复的 watch 块中 ——
    // JS 对象字面量重复键后者覆盖前者，导致第一个 watch 块（fileList /
    // liveParams 重置等）整体失效。合并进同一块恢复全部监听。
    // v2.8.9：前台上传设置里的「失败自动重试」开关 → 立即影响本页的重试循环
    localAutoRetry(val) {
        this.autoReUpload = this.autoRetry !== false && val !== false
    },
    autoRetry(val) {
        this.autoReUpload = val !== false && this.localAutoRetry !== false
    }
},
computed: {
    ...mapGetters([
        'storeAutoReUpload',
        'userConfig'
    ]),
    /**
     * 上传设置弹窗里「本次生效」的允许格式（解析后的数组）。
     * 支持 `jpg,png` / `.jpg, .png` / 空格分隔；非法/空 → 返回空数组（跟随后台）。
     */
    localExtensions() {
        if (!this.limitExtensions) return []
        const list = String(this.limitExtensions)
            .split(/[,，\s]+/)
            .map((e) => e.trim().replace(/^\./, '').toLowerCase())
            .filter((e) => /^[a-z0-9]{1,10}$/.test(e))
        return Array.from(new Set(list))
    },
    /** 允许的上传扩展名（上传设置里的本次覆盖优先，其次系统设置，最后兜底） */
    allowedExtensions() {
        if (this.localExtensions.length) return this.localExtensions
        const v = this.userConfig?.allowedExtensions
        return Array.isArray(v) && v.length
            ? v
            : ['jpg', 'png', 'gif', 'jpeg', 'webp', 'bmp', 'mp4', 'webm', 'mov', 'm4v', 'mp3', 'm4a', 'aac', 'ogg']
    },
    /**
     * 允许压缩的格式（v2.8.5）：
     * v2.8.5：上传设置里的「禁止压缩格式」清单 —— 清单内的格式跳过压缩、原样上传；
     * 留空则所有可压缩格式（内置 COMPRESSIBLE_EXTENSIONS）都按规则压缩。
     */
    compressExcludedExts() {
        return parseExtList(this.limitCompressExts)
    },
    /** 单文件大小上限（MB）：上传设置覆盖优先，其次系统设置，默认 1024 */
    maxUploadSizeMB() {
        const local = Number(this.limitMaxSizeMB)
        if (Number.isFinite(local) && local > 0) return local
        const v = Number(this.userConfig?.maxUploadSizeMB)
        return Number.isFinite(v) && v > 0 ? v : 1024
    },
    /** 文件选择器 accept 属性（与服务端白名单保持一致） */
    acceptAttr() {
        return this.allowedExtensions.map((e) => '.' + e).join(',')
    },
    /**
     * 列表区高度自适应用的「签名」：文件数 + 每个文件的状态。
     * 状态变化（上传中 → 完成）会改变条目高度（多了外链行），需要重新量一次。
     */
    listSignature() {
        return this.fileList.length + '|' + this.fileList.map((i) => i.status).join(',')
    },
    defaultCopyFormat() {
        return COPY_FORMATS.find(format => format.value === this.selectedUrlForm) || COPY_FORMATS[0]
    },
    alternativeCopyFormats() {
        /*
         * v202610221824：下拉里列出「全部」格式（含当前默认格式）。
         * 原先把当前格式从下拉里过滤掉，导致用户在下拉里看不到 URL 这一项，
         * 只能靠按钮右下角那个小小的 "u" 猜当前是什么格式。
         */
        return COPY_FORMATS
    },
    uploadSuccessCount() {
        return this.fileList.filter(item => item.status === 'done' || item.status === 'success').length
    },
    uploadErrorCount() {
        return this.fileList.filter(item => item.status === 'exception').length
    },
    uploadingCount() {
        return this.fileList.filter(item => item.status === 'uploading').length
    },
    waitingCount() {
        return this.uploadQueue.length
    },
    /**
     * 当前「生效的」上传参数。
     * 默认直接用 props（用户在页面上选的）；每轮失败重试开始前会用
     * refreshUploadParams() 重新解析一次并写进 liveParams，使后台的改动
     * （默认存储渠道 / 备份渠道 / 上传目录 / 命名方式 / 外链前缀…）
     * 能在下一轮循环时生效 —— 对齐 CloudFlare-ImgBed 的机制。
     */
    effParams() {
        const p = this.liveParams || {}
        const pick = (key, fallback) => (p[key] === undefined || p[key] === null ? fallback : p[key])
        return {
            uploadChannel: pick('uploadChannel', this.uploadChannel),
            channelName: pick('channelName', this.channelName),
            uploadNameType: pick('uploadNameType', this.uploadNameType),
            uploadFolder: pick('uploadFolder', this.uploadFolder),
            backupChannel: pick('backupChannel', this.backupChannel),
            compressPercent: pick('compressPercent', this.compressPercent),
            autoRetry: pick('autoRetry', this.autoRetry),
            linkPrefix: p.linkPrefix || this.urlPrefix || getLinkPrefix()
        }
    },
    urlSize() {
        // 移动端为small
        return window.innerWidth < 768 ? 'small' : 'default'
    },
    disableTooltip() {
        return window.innerWidth < 768
    },
    pasteShortcut() {
        const platform = navigator.userAgentData?.platform || navigator.platform || ''
        return /mac|iphone|ipad|ipod/i.test(platform) ? 'Cmd + V' : 'Ctrl + V'
    },
    rootUrl() {
        // 启用「自定义链接格式」时用其自定义前缀；否则走全站统一出口（自定义访问域名优先）
        if (this.useCustomUrl === 'true') {
            const p = String(this.customUrlPrefix || '')
            return p && !p.endsWith('/') ? `${p}/` : p
        }
        return this.effParams.linkPrefix || this.urlPrefix || getLinkPrefix()
    },
    pasteCardMethodButtonSize() {
        if (this.fileList.length) {
            return 'small'
        } else {
            return window.innerWidth < 768 ? 'small' : 'medium'
        }
    }
},
created() {
    // 非响应式的内部句柄（放 data 里会被 Proxy 包一层，没必要）
    this._heightRaf = null
    this._listRO = null
    // v3.0.0：滑动切换 / 上传前刷新参数的内部句柄
    this._swipeStart = null
    this._swipeFeedbackTimer = null
    this._refreshControlsInFlight = false
},
// v3.0.0：原第二个重复的 watch 块已合并进上方唯一的 watch（见 listSignature 之后的说明）
mounted() {
    // v1.0.6：触屏设备（无 hover 能力）把「其他」下拉改成点击展开
    try {
        if (window.matchMedia && window.matchMedia('(hover: none)').matches) {
            this.otherMenuTrigger = 'click'
        }
    } catch (e) { /* 老浏览器忽略 */ }
    document.addEventListener('paste', this.handlePaste)
    document.addEventListener('keydown', this.handlePasteShortcut)
    // v2.8.9：后台总开关（autoRetry）与前台开关（localAutoRetry）同时开启才自动重试
    this.autoReUpload = this.autoRetry !== false && this.localAutoRetry !== false
    // v3.0.0（R11）：并发数由后台配置下发（留空 3，范围 1~10）
    this.maxConcurrentUploads = Math.min(10, Math.max(1, Number(this.uploadConcurrency) || 3))
    window.addEventListener('resize', this.updateUploadListHeight)
    // 高度自适应：先挂观察器，再量一次（列表可能是带着历史文件重新挂载的）
    this.$nextTick(() => {
        this.observeUploadList()
        this.updateUploadListHeight()
    })
},
beforeUnmount() {
    document.removeEventListener('paste', this.handlePaste)
    document.removeEventListener('keydown', this.handlePasteShortcut)
    window.removeEventListener('resize', this.updateUploadListHeight)
    this.disconnectUploadListObserver()
    if (this._heightRaf) {
        cancelAnimationFrame(this._heightRaf)
        this._heightRaf = null
    }
    // v3.0.0：清理滑动反馈定时器
    if (this._swipeFeedbackTimer) {
        clearTimeout(this._swipeFeedbackTimer)
        this._swipeFeedbackTimer = null
    }
    // 清理状态
    if (this.roundTimer) {
        clearTimeout(this.roundTimer)
        this.roundTimer = null
    }
    if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
    }
    this.retryLoopActive = false
    this.exceptionList = []
    this.uploadQueue = []
    this.fileList = []
    this.activeUploads = 0
},
methods: {
    /**
     * 统一的附加上传参数：
     *   compressPercent —— 压缩期望百分比（前端上传设置优先，0 表示交给后端默认）
     *   backupChannel   —— 备份渠道（'' 跟随全局 / 'none' 不备份 / 渠道 ID）
     *   originalSize    —— 压缩/转码前的初始字节数，供详情页展示「初始大小 / 当前大小」
     * 统一取 effParams（每轮重试前会重新解析），保证下一轮用的是最新参数。
     */
    extraUploadParams(file) {
        const uid = file?.file?.uid ?? file?.uid
        const item = this.fileList.find(i => i.uid === uid)
        const originalSize = (item && item.originalSize) || file?.file?.size || 0
        const p = this.effParams
        /*
         * 上传来源（v2.8.6）：后端落库 FileRecord.uploadSource。
         *   「文件」模式 → Upload ｜「链接」模式转存 → Fetch
         * 只影响后台「上传接口」统计与筛选，不影响渠道选择。
         */
        const source = this.uploadMethod === 'paste' ? 'Fetch' : 'Upload'
        /*
         * v2.8.8：视频兼容转码选择（仅「用户决定」策略下才有值）。
         * 空值不传 —— 后端按账户策略/全局开关决定。
         */
        const transcode = this.transcodeChoice === 'on' || this.transcodeChoice === 'off'
            ? '&videoTranscode=' + (this.transcodeChoice === 'on' ? 'true' : 'false')
            : ''
        /*
         * v2.8.8：「上传限制」（允许格式 / 单文件大小）已从上传设置里移除，
         * 统一由后台「上传相关配置」与「用户管理 → 单文件大小限制」决定，前端不再传覆盖值。
         */
        /*
         * v2.8.9：把「处理事件」所需的上下文一并带给后端，落库到 FileRecord.metas.ProcessEvent：
         *   retryRound —— 该文件已经历的失败重试轮次
         *   failReason —— 上一次失败的原因（用于详情页展示失败原因）
         *   webpSkip   —— 需要转 WebP 但未转换的原因（转换失败/超时/不支持的格式）
         */
        const retryRound = Number(item?.retryRound) || 0
        const failReason = item?.failReason
            ? '&failReason=' + encodeURIComponent(String(item.failReason).slice(0, 200))
            : ''
        const webpSkip = item?.webpSkip
            ? '&webpSkip=' + encodeURIComponent(String(item.webpSkip).slice(0, 100))
            : ''
        /*
         * v3.0.0：
         *   instanceId —— 实例隔离：来自 localStorage（gohub_instance_id），'' = 默认实例；
         *   webpMode   —— 最终 WebP 编码模式（follow 展开为后台全局值，缺失按 lossless），
         *                 由后端记录到处理事件（FileRecord.metas.ProcessEvent）。
         * v3.0.0 修复：webpMode 只对图片文件携带 —— 非图片（视频/音频/文档）不传，
         * 后端据此不会把「WebP 已转换」记到非图片文件上，也不会因 WebP 标记忽略压缩。
         */
        const itemFile = item?.file || item?.rawFile || null
        const itemExt = String(itemFile?.name || item?.name || '').split('.').pop()?.toLowerCase() || ''
        const itemIsImage = String(itemFile?.type || '').startsWith('image/') ||
            ['jpg', 'jpeg', 'jfif', 'png', 'gif', 'webp', 'bmp', 'avif'].includes(itemExt)
        return '&compressPercent=' + (p.compressPercent || 0) +
            '&backupChannel=' + encodeURIComponent(p.backupChannel || '') +
            '&instanceId=' + encodeURIComponent(this.getCurrentInstanceId()) +
            (itemIsImage ? '&webpMode=' + this.getFinalWebpMode() : '') +
            '&originalSize=' + originalSize +
            '&uploadSource=' + source + transcode +
            '&retryRound=' + retryRound + failReason + webpSkip
    },
    /**
     * v3.0.0：当前实例 ID（localStorage gohub_instance_id；'' = 默认实例）。
     * 单文件上传 / 分块 init+merge / 链接转存暂存提交（uploadStagedItem）统一经过
     * extraUploadParams，自动全部带上。
     * v3.0.0（R8）：上传设置「归属实例」选中非空值时覆盖 localStorage：
     * '__default__' = 强制默认实例；其它 = 强制该实例。
     */
    getCurrentInstanceId() {
        const owner = String(this.instanceId || '')
        if (owner === '__default__') return ''
        if (owner) return owner
        try {
            return localStorage.getItem('gohub_instance_id') || ''
        } catch (e) {
            return ''
        }
    },
    /**
     * v3.0.0：本次上传实际生效的 WebP 编码模式。
     * 上传设置里选「跟随全局」（follow）→ 用后台 webpMode（缺失按 lossless）；
     * 本地选择了 lossless / lossy → 覆盖后台值。
     */
    getFinalWebpMode() {
        let pref = 'follow'
        try { pref = localStorage.getItem('gohub_webp_mode') || 'follow' } catch (e) { /* 忽略 */ }
        if (pref === 'lossless' || pref === 'lossy') return pref
        return this.userConfig?.webpMode === 'lossy' ? 'lossy' : 'lossless'
    },
    /**
     * 列表区高度自适应（v2.0.0 重新设计）：
     * 基础方案改为纯 CSS —— 卡片 height:auto 由内容撑开，内容可见性不再依赖 JS；
     * JS 只负责一件事：把滚动封顶值 --upload-list-max-h 实测成「头部 + 3 个条目」，
     * 让「超过 3 个出滚动条」的阈值贴合真实条目高度（条目高度可变：上传中只有进度条、
     * 完成后多外链行、视频缩略图最高 110px）。
     * JS 失效（老浏览器）时封顶回落 58vh，内容依旧完整可见/可滚 —— 任何环境都不会裁掉内容。
     */
    updateUploadListHeight() {
        if (this._heightRaf) cancelAnimationFrame(this._heightRaf)
        this._heightRaf = requestAnimationFrame(() => {
            this._heightRaf = null
            this.measureUploadListHeight()
        })
    },
    /** 实测「头部 + 最多 3 个条目」写入 --upload-list-max-h；量不到则恢复 CSS 兜底 */
    measureUploadListHeight() {
        const root = this.$el
        if (!root) return
        const view = this.$refs.scrollContainer?.$el?.querySelector('.el-scrollbar__view')
        if (!view) {
            root.style.removeProperty('--upload-list-max-h')
            return
        }
        const header = view.querySelector('.upload-list-dashboard')
        // 列表是倒序渲染的（最新在最上），从上往下取前 3 个即可
        const items = Array.from(view.querySelectorAll('.upload-list-item')).slice(0, 3)
        if (!items.length) {
            root.style.removeProperty('--upload-list-max-h')
            return
        }
        let h = header ? header.offsetHeight : 0
        items.forEach((el) => {
            const style = window.getComputedStyle(el)
            h += el.offsetHeight +
                (parseFloat(style.marginTop) || 0) +
                (parseFloat(style.marginBottom) || 0)
        })
        // 少量余量：避免第 3 条底部边距被 max-height 精确裁掉、或恰好压出一像素滚动条
        h += 6
        root.style.setProperty('--upload-list-max-h', h + 'px')
    },
    /** 重新挂 ResizeObserver（条目增删后要重新 observe 新元素） */
    observeUploadList() {
        this.disconnectUploadListObserver()
        if (typeof ResizeObserver === 'undefined') return
        const view = this.$refs.scrollContainer?.$el?.querySelector('.el-scrollbar__view')
        if (!view) return
        this._listRO = new ResizeObserver(() => this.updateUploadListHeight())
        // 容器 + 头部 + 每个条目：任一尺寸变化（缩略图加载、状态行出现）都重量一次
        this._listRO.observe(view)
        const header = view.querySelector('.upload-list-dashboard')
        if (header) this._listRO.observe(header)
        view.querySelectorAll('.upload-list-item').forEach((el) => this._listRO.observe(el))
    },
    disconnectUploadListObserver() {
        if (this._listRO) {
            this._listRO.disconnect()
            this._listRO = null
        }
    },
    /**
     * 点「自动」文字也能切换开关（扩大触控热区）。
     * 文案固定显示「自动」，不再随状态变成「手动」，避免用户误以为是两个不同功能。
     */
    toggleAutoUpload() {
        this.$emit('update:autoUpload', !this.autoUpload)
    },
        /* ────────────── v3.0.0：移动端左右滑动切换「文件 / 链接」模式 ──────────────
         * 仅触屏设备（matchMedia('(hover: none)')）启用。
         * v3.0.0（R15）：改为「轮回切换」—— 每次水平滑动都切到下一个模式，
         * 同方向连续滑动会一直循环（文件 → 链接 → 文件 …），不再因「已经是目标模式」而失效。
         * 阈值 60px；滑动期间垂直位移大于水平位移视为页面滚动，不触发切换。
         * 切换通过 changeMethod 事件交给父组件 setUploadMethod（同步标签页/store/i18n 文案），
         * 并给一张短促的淡入动画作视觉反馈。桌面端完全不绑定逻辑，行为不变。
         */
        handleMethodSwipeStart(e) {
            if (!this.isTouchDevice) return
            const t = e.changedTouches && e.changedTouches[0]
            if (!t) return
            this._swipeStart = { x: t.clientX, y: t.clientY }
        },
        handleMethodSwipeEnd(e) {
            if (!this.isTouchDevice) return
            const start = this._swipeStart
            this._swipeStart = null
            if (!start) return
            const t = e.changedTouches && e.changedTouches[0]
            if (!t) return
            const SWIPE_THRESHOLD = 60
            const dx = t.clientX - start.x
            const dy = t.clientY - start.y
            // 水平位移不够、或垂直位移更大（在滚动页面）→ 不切换，避免与页面滚动冲突
            if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dy) > Math.abs(dx)) return
            // 轮回：无论向左还是向右，都切到「另一个」模式
            const target = this.uploadMethod === 'default' ? 'paste' : 'default'
            this.$emit('changeMethod', target)
            // 轻量视觉反馈：卡片淡入一下
            this.swipeFeedback = false
            this.$nextTick(() => {
                this.swipeFeedback = true
                if (this._swipeFeedbackTimer) clearTimeout(this._swipeFeedbackTimer)
                this._swipeFeedbackTimer = setTimeout(() => { this.swipeFeedback = false }, 450)
            })
        },
    /**
     * v3.0.0：点击「上传 / 转存」前重新拉取一遍所有可能影响上传的控制参数。
     *
     * 覆盖范围（一次点击只刷一次，_refreshControlsInFlight 防重入）：
     *   · GET /api/userConfig（store fetchUserConfig）—— 服务端按最新配置实时解析：
     *     文件压缩开关/阈值/百分比（defaultCustomerCompress/defaultCompressBar/defaultCompressQuality）、
     *     禁止压缩格式、存储渠道（channelName 留空时由后端按最新主渠道解析）、备份渠道、
     *     允许上传格式、单文件大小上限（maxUploadSizeMB）、失败自动重试（autoRetry/retryTimes）、
     *     WebP 转换开关（webpEnabled）与全局模式（webpMode）、链接格式（defaultUrlForm/urlPrefix）、
     *     视频转码（videoTranscode* 与账户级 transcodePolicy）、默认命名方式、默认上传目录；
     *     刷新后本组件的 allowedExtensions / maxUploadSizeMB 等 computed 与父组件的
     *     compressEnabled / webpEnabled / transcodePolicy 等 computed 会自动跟随更新。
     *   · 渠道列表缓存失效（invalidateStorageChannels）—— 下次渠道下拉重新拉取；
     *     用户已选渠道（channelName/backupChannel props）不重置。
     *   · liveParams 回写：命名方式 / 外链前缀取最新值；上传目录以用户当前输入为准，
     *     仅当用户没输入且后台 defaultUploadFolder 有值时才采用最新默认目录。
     *   · 用户已选的文件列表、压缩开关等本地会话设置一律不动。
     * 失败（断网等）不阻断上传：console.warn 后沿用现有值继续。
     */
    async refreshUploadControls() {
        if (this._refreshControlsInFlight) return
        this._refreshControlsInFlight = true
        try {
            let cfg = this.userConfig
            await this.$store.dispatch('fetchUserConfig')
            cfg = this.$store.getters.userConfig || cfg
            // 渠道列表缓存失效：下次打开渠道下拉时重新拉 /api/channels
            invalidateStorageChannels()
            // v3.0.0（R11）：并发数跟随后台最新配置（管理员改了不用等用户刷新页面）
            if (cfg) {
                const n = Number(cfg.uploadConcurrency)
                this.maxConcurrentUploads = Number.isFinite(n) && n > 0 ? Math.min(10, Math.max(1, Math.floor(n))) : 3
            }
            // 用户没输入目录、且后台配置了默认上传目录 → 本次采用最新默认目录
            const latestFolder = this.uploadFolder ||
                (cfg && cfg.defaultUploadFolder ? String(cfg.defaultUploadFolder) : '')
            this.liveParams = {
                // 渠道相关保留用户本次会话的选择（空串 = 后端按最新配置解析）
                uploadChannel: this.uploadChannel,
                channelName: this.channelName,
                backupChannel: this.backupChannel,
                uploadFolder: latestFolder,
                uploadNameType:
                    this.$store.getters.storeUploadNameType ||
                    (cfg && cfg.defaultUploadNameType) ||
                    'default',
                compressPercent: this.compressPercent,
                autoRetry: cfg ? cfg.autoRetry !== false : this.autoRetry,
                linkPrefix: getLinkPrefix()
            }
        } catch (e) {
            console.warn('[upload] 上传前刷新配置失败，沿用当前设置继续上传:', e)
        } finally {
            this._refreshControlsInFlight = false
        }
    },
    /** 手动上传：把列表里所有等待中的文件一次性发出（可先改过文件名） */
    /**
     * 手动上传：把列表里所有等待中的文件发出。
     * v2.8.3：
     *   · 文件模式：此时才做压缩（用户已改好名 / 裁好图）；
     *   · 链接模式：转存条目直接提交（可能是 rawFile，也可能是服务端暂存 stagingId）。
     */
    async startManualUpload() {
        // v3.0.0：上传前先重新拉取一遍全部上传控制参数（一次点击只刷一次，失败不阻断）
        await this.refreshUploadControls()
        const pending = this.fileList.filter(item => item.status === 'waiting' && (item.rawFile || item.stagedId))
        if (!pending.length) {
            this.$message({ type: 'info', message: this.$t('uploadForm.noPendingFiles') })
            return
        }
        pending.forEach(item => {
            item.editableName = false
            // 链接转存的大文件：文件已在服务端磁盘，只提交 stagingId，浏览器不再传一遍
            if (item.stagedId) {
                this.uploadStagedItem(item)
                return
            }
            item.status = 'uploading'
            const raw = item.rawFile
            if (!raw) return
            // 用户可能改过文件名：按新名字重新构造 File（仍在浏览器内存）
            let fileToUpload = raw
            const desiredName = item.name
            if (desiredName && desiredName !== raw.name) {
                try {
                    fileToUpload = new File([raw], desiredName, { type: raw.type })
                } catch (e) {
                    fileToUpload = raw
                }
                fileToUpload.uid = raw.uid
                fileToUpload.uploadFolder = raw.uploadFolder
                fileToUpload.uploadRelativePath = desiredName
            }
            this.forcedUpload = true
            this.uploadFile({
                file: fileToUpload,
                onProgress: (evt) => this.handleProgress(evt),
                onSuccess: (response, file) => this.handleSuccess(response, file),
                onError: (error, file) => this.handleError(error, file)
            })
            this.forcedUpload = false
        })
    },

    /**
     * v2.8.3：提交「链接转存暂存文件」。
     * 后端已经把远端文件流式下载到临时目录，这里只发一个很小的请求
     * （stagingId + 新文件名 + 压缩开关），由服务端压缩后直接写存储渠道。
     */
    uploadStagedItem(item) {
        item.editableName = false
        item.status = 'uploading'
        item.progreess = 10
        item.compressing = !!item.serverCompress
        const uploadChannel = item.uploadChannel || this.effParams.uploadChannel
        // v2.8.9：不再覆盖后端「自动切换」策略 —— 传 autoSwitch 会使后台配置失效，统一交由后台决定
        const uploadNameType = this.effParams.uploadNameType
        // v3.0.0（R14）：转存条目也按点击上传时的最新目录提交
        const targetUploadFolder = this.liveUploadFolder(item)
        const formData = new FormData()
        formData.append('stagingId', item.stagedId)
        formData.append('originalFileName', item.name)
        axios({
            url: '/upload' +
                '?serverCompress=' + (item.serverCompress ? 'true' : 'false') +
                '&uploadChannel=' + uploadChannel +
                (this.channelName ? '&channelName=' + encodeURIComponent(this.channelName) : '') +
                '&uploadNameType=' + uploadNameType +
                '&uploadFolder=' + encodeURIComponent(targetUploadFolder) +
                this.extraUploadParams({ uid: item.uid }),
            method: 'post',
            data: formData,
            withAuthCode: true,
            onUploadProgress: (evt) => {
                // 请求体很小，进度只用于让 UI 有反馈；真正耗时在服务端压缩/写渠道
                const pct = Math.min(90, Math.round((evt.loaded / Math.max(1, evt.total)) * 90))
                item.progreess = Math.max(10, pct)
            }
        }).then(res => {
            item.compressing = false
            this.handleSuccess(res, { uid: item.uid, name: item.name })
        }).catch(err => {
            item.compressing = false
            this.handleError(err, { uid: item.uid, name: item.name })
        })
    },

    createLocalUid() {
        this.localUidCounter += 1
        return `local-${Date.now()}-${this.localUidCounter}`
    },
    applyUploadPath(file, relativePath = file.name) {
        const normalizedRelativePath = String(relativePath || file.name).replace(/\\/g, '/').replace(/^\/+/, '')
        file.uploadRelativePath = normalizedRelativePath
        file.uploadFolder = joinUploadFolder(this.uploadFolder, getRelativeDirectory(normalizedRelativePath))
        return file
    },
    copyUploadPath(sourceFile, targetFile) {
        targetFile.uploadRelativePath = sourceFile.uploadRelativePath || sourceFile.name
        targetFile.uploadFolder = sourceFile.uploadFolder ?? this.uploadFolder
        return targetFile
    },
    getFileUploadFolder(file) {
        const fileItem = this.fileList.find(item => item.uid === file.file.uid)
        return this.liveUploadFolder(fileItem || file.file)
    },
    /**
     * v3.0.0（R14）：目标目录一律按「当前」右上角目录输入框实时计算。
     * 场景：用户先选好文件、再改右上角目录，点「上传」时应按最新目录分类
     * （原实现用的是入列时缓存的 item.uploadFolder，改目录后不生效）。
     * 拖入文件夹时保留其相对层级（子目录仍挂在新目录下面）。
     */
    liveUploadFolder(item) {
        const rel = String(item?.uploadRelativePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
        const base = this.uploadFolder || this.effParams.uploadFolder || ''
        return rel ? joinUploadFolder(base, getRelativeDirectory(rel)) : base
    },
    createUploadRequest(file) {
        return {
            file,
            onProgress: (evt) => this.handleProgress(evt),
            onSuccess: (response, uploadedFile) => this.handleSuccess(response, uploadedFile),
            onError: (error, uploadedFile) => this.handleError(error, uploadedFile)
        }
    },
    async uploadLocalEntries(entries) {
        // 逐个文件独立处理：某个文件在预处理阶段失败（压缩异常、超限、类型不合法…）
        // 只跳过它自己并给出提示，不影响同一批里的其它文件继续上传。
        await Promise.allSettled(entries.map(async ({ file, relativePath }) => {
            try {
                file.uid = this.createLocalUid()
                this.applyUploadPath(file, relativePath)
                const processedFile = await this.beforeUpload(file)
                if (processedFile instanceof File) {
                    this.uploadFile(this.createUploadRequest(processedFile))
                }
            } catch (err) {
                this.$message.error(
                    this.$t('uploadForm.batchEntryFailed', { name: this.truncateFilename(file.name) })
                )
            }
        }))
    },
    openFolderPicker() {
        this.$refs.folderInput?.click()
    },
    async handleFolderSelection(event) {
        const entries = filesToUploadEntries(event.target.files)
        event.target.value = ''
        await this.uploadLocalEntries(entries)
    },
    async handleDrop(event) {
        const dataTransfer = event.dataTransfer
        if (!dataTransfer) return

        const entries = dataTransfer.items?.length
            ? await collectFilesFromDataTransferItems(dataTransfer.items)
            : filesToUploadEntries(dataTransfer.files)

        if (entries.length) await this.uploadLocalEntries(entries)
    },
    // 文件名中间截断，保留前缀和扩展名
    truncateFilename(filename, maxLength = 20) {
        if (!filename || filename.length <= maxLength) {
            return filename
        }
        const lastDotIndex = filename.lastIndexOf('.')
        let name, ext
        if (lastDotIndex > 0) {
            name = filename.substring(0, lastDotIndex)
            ext = filename.substring(lastDotIndex)
        } else {
            name = filename
            ext = ''
        }
        // 保留扩展名和部分前后缀
        const keepEnd = ext.length + 4 // 扩展名 + 4个字符
        const keepStart = maxLength - keepEnd - 3 // 3个字符留给...
        if (keepStart <= 0) {
            return filename.substring(0, maxLength - 3) + '...'
        }
        return name.substring(0, keepStart) + '...' + name.slice(-4) + ext
    },
    async uploadFile(file) {
        const pendingItem = this.fileList.find(item => item.uid === file.file.uid)
        // 如果fileList中不存在该文件，说明已被删除，直接返回
        if (!pendingItem) {
            return
        }

        /*
         * 手动上传模式：关闭「自动上传」后文件仅入列等待，用户点「上传」才真正发送
         * （可先改文件名）。外链条目例外 —— 它不产生任何网络请求，只是把已经生成好的
         * 外链格式标记为完成，若也被这道闸门拦住，点「外链」后条目会一直停在等待中，
         * 表现为「列表里显示了文件，但没有外链格式」（v2.8.5 修复）。
         */
        if (!this.autoUpload && !this.forcedUpload && pendingItem.uploadChannel !== 'external') {
            pendingItem.status = 'waiting'
            pendingItem.editableName = true
            return
        }

        // 并发控制：如果当前上传数已达上限，加入队列等待
        if (this.activeUploads >= this.maxConcurrentUploads) {
            this.uploadQueue.push(file)
            const waitingItem = this.fileList.find(item => item.uid === file.file.uid)
            if (waitingItem) waitingItem.status = 'waiting'
            return
        }

        const fileItem = this.fileList.find(item => item.uid === file.file.uid)

        /*
         * v2.8.3：压缩后置到「真正要发出去」的这一刻 ——
         * 手动模式此时用户已经改好名、裁好图；自动模式则选完立即走到这里。
         * 处理结果只替换本次上传用的 File，列表条目仍指向原始 rawFile（可重试）。
         */
        let actualFile = file.file
        if (fileItem && fileItem.uploadChannel !== 'external') {
            fileItem.compressing = true
            try {
                const prepared = await this.prepareUploadFile(file.file)
                actualFile = prepared.file
                fileItem.serverCompress = prepared.serverCompress
                if (actualFile.name && actualFile.name !== fileItem.name) {
                    fileItem.name = actualFile.name
                }
            } catch (err) {
                fileItem.compressing = false
                fileItem.status = 'exception'
                this.$message.error(this.$t('uploadForm.uploadFailed', { name: this.truncateFilename(file.file.name) }))
                console.error('[upload] 上传前预处理失败:', err)
                return
            }
            fileItem.compressing = false
        }

        // 开始上传，增加计数
        this.activeUploads++
        const uploadingItem = this.fileList.find(item => item.uid === file.file.uid)
        if (uploadingItem) uploadingItem.status = 'uploading'

        const uploadChannel = fileItem?.uploadChannel || this.effParams.uploadChannel
        const next = { ...file, file: actualFile }

        // 如果上传渠道为外链，走服务端拉取
        if (uploadChannel === 'external') {
            this.uploadSingleFile(next)
            return
        }

        // 所有存储渠道统一走 /upload：小文件单次上传，大文件自动分块
        const CHUNK_THRESHOLD = 20 * 1024 * 1024 // 20MB
        if (actualFile.size > CHUNK_THRESHOLD) {
            this.uploadFileInChunks(next)
        } else {
            this.uploadSingleFile(next)
        }
    },
    // 处理上传队列中的下一个文件
    processUploadQueue() {
        // 如果队列为空或已达并发上限，不处理
        if (this.uploadQueue.length === 0 || this.activeUploads >= this.maxConcurrentUploads) {
            return
        }
        
        // 从队列中取出下一个文件并上传
        const nextFile = this.uploadQueue.shift()
        if (nextFile && this.fileList.find(item => item.uid === nextFile.file.uid)) {
            this.uploadFile(nextFile)
        } else {
            // 如果文件已被删除，继续处理下一个
            this.processUploadQueue()
        }
    },
    // 上传完成后的清理工作（成功或失败都调用）
    onUploadComplete() {
        this.activeUploads = Math.max(0, this.activeUploads - 1)

        // 处理队列中的下一个文件 —— 某个文件失败/成功都不会阻塞后面排队的文件
        this.processUploadQueue()

        // 一波（轮）结束：既没有在传的、也没有排队的 →
        //   · 还有失败文件 → 回到失败队列，整队再循环一轮（重试前会重新拉取上传参数）
        //   · 全部成功     → 收尾
        if (this.activeUploads === 0 && this.uploadQueue.length === 0) {
            this.uploading = false
            this.maybeStartRetryRound()
        }
    },

    /* ────────────────── 失败文件「循环回炉」重试 ──────────────────
     * 机制（对齐 CloudFlare-ImgBed）：
     *   1) 批量上传时某个文件失败 → 只把它记进 exceptionList，然后立刻继续上传
     *      后面排队的文件，不阻塞整条队列；
     *   2) 一波全部结束（activeUploads === 0 且 uploadQueue 为空）后，如果
     *      exceptionList 里还有失败文件，就整队再循环一轮；
     *   3) 每轮开始前都会 refreshUploadParams() 重新获取一遍上传参数
     *      （默认存储渠道 / 备份渠道 / 上传目录 / 命名方式 / 外链前缀…），
     *      所以重试期间在后台改了配置，下一轮就会按新参数上传；
     *   4) 一直循环到全部成功；关闭「自动重试」开关则停在失败状态等手动重试。
     */
    /** 一波结束后判断是否要开启下一轮重试 */
    maybeStartRetryRound() {
        if (this.roundTimer) return // 已排定下一轮，避免重复触发
        if (!this.exceptionList.length) {
            this.retryRound = 0
            this.retryLoopActive = false
            return
        }
        if (!this.autoReUpload) {
            // 关闭自动重试：失败文件保留在列表里，等用户点「重试」或打开开关
            this.retryLoopActive = false
            return
        }
        // v2.8.9：重试次数上限（0 = 不限制）—— 达到后台设定的轮次后停止，失败项留在列表
        const maxRounds = Number(this.retryTimes) || 0
        if (maxRounds > 0 && this.retryRound >= maxRounds) {
            this.retryLoopActive = false
            this.$message({
                type: 'error',
                message: this.$t('uploadForm.retryLimitReached', {
                    round: this.retryRound,
                    count: this.exceptionList.length
                })
            })
            return
        }

        this.retryLoopActive = true
        this.retryRound += 1
        const round = this.retryRound
        const count = this.exceptionList.length
        const waitSec = Math.max(1, Math.round(this.retryDelay / 1000))

        this.$message({
            type: 'warning',
            message: this.$t('uploadForm.retryRoundScheduled', { round, count, sec: waitSec })
        })

        this.roundTimer = setTimeout(async () => {
            this.roundTimer = null
            if (!this.autoReUpload || !this.exceptionList.length) {
                this.retryLoopActive = false
                return
            }
            // 关键：每轮开始前重新获取一遍上传参数，让后台的改动在下一轮生效
            await this.refreshUploadParams()
            this.startRetryRound()
        }, this.retryDelay)
    },
    /** 取出失败队列，按最新参数重新入队上传 */
    startRetryRound() {
        const files = [...this.exceptionList]
        this.exceptionList = []
        if (!files.length) {
            this.retryLoopActive = false
            return
        }
        this.uploading = true
        files.forEach(req => {
            const item = this.fileList.find(i => i.uid === req.file.uid)
            if (!item) return // 已被用户删除，跳过
            // v2.8.7：被幂等拦截的条目（后端确认该文件早已上传成功）不参与重试，
            // 否则每轮重试都会再撞一次「已上传完成」，永远循环
            if (item.dupBlocked) return
            item.progreess = 0
            item.status = 'uploading'
            // v2.8.9：记下该文件已进入第几轮重试，随请求上报（详情页「处理事件」）
            item.retryRound = this.retryRound
            // 重试属于「本轮用户已发起的上传」，不受手动上传模式的入列拦截
            this.enqueueUploadRequest(req)
        })
    },
    /** 重新入队 / 直接上传一个上传请求（绕过「手动上传」模式的等待拦截） */
    enqueueUploadRequest(req) {
        const saved = this.forcedUpload
        this.forcedUpload = true
        try {
            this.uploadFile(req)
        } finally {
            this.forcedUpload = saved
        }
    },
    /**
     * 重新获取一遍上传相关的全部参数。
     *   · /api/userConfig —— 主渠道 / 备份渠道 / 自定义访问域名（外链前缀）/
     *     允许的扩展名 / 单文件大小上限 / 默认命名方式（后端按最新配置实时解析）
     *   · 本地设置（Vuex 持久化的用户偏好）—— 命名方式、压缩、上传方式…
     * 结果写进 liveParams，effParams 随即生效。
     */
    async refreshUploadParams() {
        let cfg = this.userConfig
        try {
            await this.$store.dispatch('fetchUserConfig')
            cfg = this.$store.getters.userConfig || cfg
        } catch (e) {
            // 拉取失败（断网等）沿用旧值，不影响继续重试
            console.warn('[upload] 重新获取上传参数失败，沿用上一轮参数:', e)
        }

        this.liveParams = {
            // 渠道相关一律传空串/具体值：空串 = 由后端按「最新」配置实时解析
            // （全局主渠道、账户指定渠道、全局备份渠道），所以后台改渠道下一轮立即生效
            uploadChannel: this.uploadChannel,
            channelName: this.channelName,
            backupChannel: this.backupChannel,
            uploadFolder: this.uploadFolder,
            uploadNameType:
                this.$store.getters.storeUploadNameType ||
                cfg?.defaultUploadNameType ||
                'default',
            compressPercent: this.compressPercent,
            autoRetry: this.autoRetry,
            linkPrefix: getLinkPrefix()
        }

        // 失败文件的上传目录按最新基础目录重算（保留其所在子目录）
        this.retargetPendingUploads(this.exceptionList)
    },
    /** 按最新基础上传目录重算待重试文件的目标目录 */
    retargetPendingUploads(list) {
        const base = this.uploadFolder
        ;(list || []).forEach(req => {
            const item = this.fileList.find(i => i.uid === req.file.uid)
            if (!item) return
            const rel = item.uploadRelativePath || item.name
            item.uploadFolder = joinUploadFolder(base, getRelativeDirectory(rel))
            if (req.file && item.uploadFolder !== undefined) {
                req.file.uploadFolder = item.uploadFolder
            }
        })
    },
    // 单文件上传
    async uploadSingleFile(file) {
        const fileItem = this.fileList.find(item => item.uid === file.file.uid)
        if (!fileItem) return // 文件已被删除
        
        const needServerCompress = fileItem.serverCompress
        const uploadChannel = fileItem.uploadChannel || this.effParams.uploadChannel
        // v2.8.9：不再覆盖后端「自动切换」策略 —— 传 autoSwitch 会使后台配置失效，统一交由后台决定
        const uploadNameType = uploadChannel === 'external' ? 'default' : this.effParams.uploadNameType
        const targetUploadFolder = this.getFileUploadFolder(file)
        
        // 外链模式：仅记录链接，不实际上传文件
        if (uploadChannel === 'external') {
            file.onSuccess({ data: [{ src: file.file.url }] }, file.file)
            this.onUploadComplete()
            return
        }

        // 创建 AbortController 用于取消上传
        const abortController = new AbortController()
        this.abortControllers.set(file.file.uid, abortController)
        
        const formData = new FormData()
        formData.append('file', file.file)

        axios({
            url: '/upload' + 
                '?serverCompress=' + needServerCompress + 
                '&uploadChannel=' + uploadChannel +
                (this.channelName ? '&channelName=' + encodeURIComponent(this.channelName) : '') +
                '&uploadNameType=' + uploadNameType + 
                '&uploadFolder=' + encodeURIComponent(targetUploadFolder) + this.extraUploadParams(file),
            method: 'post',
            data: formData,
            withAuthCode: true,
            signal: abortController.signal, // 添加取消信号
            onUploadProgress: (progressEvent) => {
                const percentCompleted = Math.round((progressEvent.loaded / progressEvent.total) * 100)
                file.onProgress({ percent: percentCompleted, file: file.file })
            }
        }).then(res => {
            file.onSuccess(res, file.file)
        }).catch(err => {
            // 如果是取消操作，不加入异常列表
            if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
                console.log('上传已取消:', file.file.name)
                return
            }
            if (err.response && err.response.status !== 401) {
                this.exceptionList.push(file)
                file.onError(err, file.file)
            } else if (!err.response) {
                // 网络错误（如 ERR_HTTP2_PROTOCOL_ERROR），也加入异常列表
                this.exceptionList.push(file)
                file.onError(err, file.file)
            }
        }).finally(() => {
            // 清理 AbortController
            this.abortControllers.delete(file.file.uid)
            // 调用并发控制的完成回调
            this.onUploadComplete()
        })
    },
    // 分块上传
    async uploadFileInChunks(file) {
        const fileItem = this.fileList.find(item => item.uid === file.file.uid)
        if (!fileItem) return // 文件已被删除
        
        const uploadChannel = fileItem.uploadChannel || this.effParams.uploadChannel
        
        // 创建 AbortController 用于取消上传
        const abortController = new AbortController()
        this.abortControllers.set(file.file.uid, abortController)
        
        // 统一使用 16MB 分块
        const CHUNK_SIZE = 16 * 1024 * 1024
        
        const fileSize = file.file.size
        const fileType = file.file.type || 'application/octet-stream'
        const totalChunks = Math.ceil(fileSize / CHUNK_SIZE)
        // v2.8.3：稳定指纹 —— 刷新页面/失败重试时命中同一会话，已传分片不再重传
        const uploadKey = fileItem.uploadKey || `${file.file.name}|${fileSize}|${file.file.lastModified || 0}|${fileType}`
        fileItem.uploadKey = uploadKey
        
        const needServerCompress = fileItem.serverCompress
        // v2.8.9：不再覆盖后端「自动切换」策略 —— 传 autoSwitch 会使后台配置失效，统一交由后台决定
        const uploadNameType = uploadChannel === 'external' ? 'default' : this.effParams.uploadNameType
        const targetUploadFolder = this.getFileUploadFolder(file)

        try {
            // 第一步：初始化分块上传，获取uploadId
            const initFormData = new FormData()
            initFormData.append('originalFileName', file.file.name)
            initFormData.append('originalFileType', fileType)
            initFormData.append('totalChunks', totalChunks.toString())
            initFormData.append('fileSize', String(fileSize))
            initFormData.append('uploadKey', uploadKey)

            const initResponse = await axios({
                url: '/upload' + 
                    '?serverCompress=' + needServerCompress + 
                    '&uploadChannel=' + uploadChannel + 
                    (this.channelName ? '&channelName=' + encodeURIComponent(this.channelName) : '') +
                    '&uploadNameType=' + uploadNameType + 
                    '&uploadFolder=' + encodeURIComponent(targetUploadFolder) + this.extraUploadParams(file) +
                    '&initChunked=true',
                method: 'post',
                data: initFormData,
                withAuthCode: true
            })

            if (!initResponse.data.success) {
                // v2.8.7：completed=true 表示该文件其实早已上传成功（旧会话已完成），
                // 后端拒绝重传 —— 不要进失败重试队列（否则会无限循环提示）
                if (initResponse.data.completed) {
                    const dupItem = this.fileList.find(item => item.uid === file.file.uid)
                    if (dupItem) {
                        dupItem.status = 'exception'
                        dupItem.dupBlocked = true
                        dupItem.compressing = false
                    }
                    this.$message({
                        type: 'warning',
                        message: this.$t('uploadForm.alreadyUploaded', { name: this.truncateFilename(file.file.name) }),
                        duration: 5000
                    })
                    console.warn('[upload] 幂等拦截：该文件已上传完成，跳过重传', file.file.name)
                } else {
                    throw new Error(this.$t('uploadForm.chunkInitFailed') + ': ' + initResponse.data.message)
                }
                return
            }

            // v2.8.7：后端命中「已完成会话」并直接返还上次的上传结果 → 不再重传，直接按成功处理
            if (initResponse.data.completed && Array.isArray(initResponse.data.result)) {
                console.log('[upload] 幂等命中：该文件已上传成功，直接复用已有结果', file.file.name)
                file.onSuccess({ data: initResponse.data.result }, file.file)
                return
            }

            const uploadId = initResponse.data.uploadId
            // 断点续传：后端返回已完整收到的分片下标
            const alreadyReceived = new Set((initResponse.data.received || []).map(x => x.index))
            console.log('分块上传初始化成功，uploadId:', uploadId, '已收分片:', alreadyReceived.size)

            // 记录 totalChunks 和 uploadId 到文件项，用于后续清理
            const itemRef = this.fileList.find(item => item.uid === file.file.uid)
            if (itemRef) {
                itemRef.totalChunks = totalChunks
                itemRef.uploadId = uploadId
                // 分块上传：100% 之后是「合并」而不是压缩，进度条不要误报「压缩中」
                itemRef.chunkedUpload = true
            }

            // 第二步：并发上传所有分块（大文件 4 并发，小文件 3；16MB/片）
            const maxConcurrency = fileSize > 100 * 1024 * 1024 ? 4 : 3
            const chunkProgress = new Array(totalChunks).fill(0)
            for (const idx of alreadyReceived) {
                if (idx >= 0 && idx < totalChunks) chunkProgress[idx] = 100
            }
            const reportResumeProgress = () => {
                const pct = Math.round(chunkProgress.reduce((a, b) => a + b, 0) / totalChunks)
                file.onProgress({ percent: pct, file: file.file })
            }
            if (alreadyReceived.size) reportResumeProgress()
            let nextChunkIndex = 0
            let hasError = false
            let errorMsg = ''
            let isCancelled = false // 标记是否被取消

            const uploadChunk = async (chunkIndex) => {
                if (hasError || isCancelled) return

                const start = chunkIndex * CHUNK_SIZE
                const end = Math.min(start + CHUNK_SIZE, fileSize)
                const chunk = file.file.slice(start, end)
                
                const formData = new FormData()
                formData.append('file', chunk, `${file.file.name}.part${chunkIndex.toString().padStart(3, '0')}`)
                formData.append('chunkIndex', chunkIndex.toString())
                formData.append('totalChunks', totalChunks.toString())
                formData.append('uploadId', uploadId)
                formData.append('originalFileName', file.file.name)
                formData.append('originalFileType', fileType)

                let retryCount = 0
                const maxRetries = 3

                while (retryCount < maxRetries) {
                    if (hasError || isCancelled) return
                    try {
                        await axios({
                            url: '/upload' + 
                                '?serverCompress=' + needServerCompress + 
                                '&uploadChannel=' + uploadChannel + 
                                (this.channelName ? '&channelName=' + encodeURIComponent(this.channelName) : '') +
                                '&uploadNameType=' + uploadNameType + 
                                '&uploadFolder=' + encodeURIComponent(targetUploadFolder) + this.extraUploadParams(file) +
                                '&chunked=true',
                            method: 'post',
                            data: formData,
                            withAuthCode: true,
                            signal: abortController.signal, // 添加取消信号
                            onUploadProgress: (progressEvent) => {
                                if (hasError || isCancelled) return
                                const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100)
                                chunkProgress[chunkIndex] = percent
                                const totalPercent = Math.round(chunkProgress.reduce((a, b) => a + b, 0) / totalChunks)
                                file.onProgress({ percent: totalPercent, file: file.file })
                            }
                        })
                        return // Success
                    } catch (err) {
                        // 如果是取消操作，直接返回
                        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
                            isCancelled = true
                            console.log('分块上传已取消:', file.file.name)
                            return
                        }
                        retryCount++
                        console.warn(`分块 ${chunkIndex + 1}/${totalChunks} 上传失败 (重试 ${retryCount}/${maxRetries}):`, err)
                        if (retryCount >= maxRetries) {
                            hasError = true
                            errorMsg = `分块 ${chunkIndex + 1}/${totalChunks} 上传失败: ${err.message}`
                            throw new Error(errorMsg)
                        }
                        // 等待后重试
                        await new Promise(resolve => setTimeout(resolve, 2000 * retryCount))
                    }
                }
            }

            // 创建并发池
            const pool = []
            for (let i = 0; i < maxConcurrency; i++) {
                pool.push((async () => {
                    while (nextChunkIndex < totalChunks && !hasError && !isCancelled) {
                        const currentIndex = nextChunkIndex++
                        // 已收到的分片直接跳过（续传）
                        if (alreadyReceived.has(currentIndex)) continue
                        try {
                            await uploadChunk(currentIndex)
                        } catch (e) {
                            if (!isCancelled) {
                                hasError = true
                                errorMsg = e.message
                            }
                            break
                        }
                    }
                })())
            }

            await Promise.all(pool)

            // 如果被取消，直接返回
            if (isCancelled) {
                console.log('分块上传已取消，跳过合并步骤')
                return
            }

            if (hasError) {
                throw new Error(errorMsg || this.$t('uploadForm.uploadError'))
            }

            // 第三步：所有分块上传完成，发送合并请求
            // v2.8.7：合并提示只弹一条（重试不再叠加），成功/失败后精确关闭这条
            const mergeItem = this.fileList.find(item => item.uid === file.file.uid)
            if (mergeItem && mergeItem._mergeToast && mergeItem._mergeToast.close) {
                try { mergeItem._mergeToast.close() } catch (e) { /* 忽略 */ }
                mergeItem._mergeToast = null
            }
            const mergeToast = this.$message({
                type: 'info',
                message: this.$t('uploadForm.chunkMerging'),
                duration: 0 // 不自动关闭
            })
            if (mergeItem) mergeItem._mergeToast = mergeToast
            // 合并阶段后端会顺带压缩（仅「文件压缩」开关开启 + 视频/音频）：
            // v2.4.0 只在真的会压缩时才打「压缩中」标识，开关关闭不再误显
            if (fileItem && needServerCompress) fileItem.compressing = true

            const mergeFormData = new FormData()
            mergeFormData.append('uploadId', uploadId)
            mergeFormData.append('totalChunks', totalChunks.toString())
            mergeFormData.append('originalFileName', file.file.name)
            mergeFormData.append('originalFileType', fileType)

            const mergeRequest = () => axios({
                url: '/upload' + 
                    '?serverCompress=' + needServerCompress + 
                    '&uploadChannel=' + uploadChannel + 
                    (this.channelName ? '&channelName=' + encodeURIComponent(this.channelName) : '') +
                    '&uploadNameType=' + uploadNameType + 
                    '&uploadFolder=' + encodeURIComponent(targetUploadFolder) + this.extraUploadParams(file) +
                    '&chunked=true&merge=true',
                method: 'post',
                data: mergeFormData,
                withAuthCode: true
            })
            /*
             * v2.8.3：合并 = 服务端拼接 + 写渠道（v2.8.8 起压缩/转码已挪到上传成功之后，
             * 合并本身很快），耗时最长也最容易碰到网络抖动。
             *
             * v2.8.8 关键修复：后端遇到**同一会话的重复合并**会返回 400
             * 「该文件正在合并中，请耐心等待，不要重复提交」。这**不是失败** ——
             * 说明上一次合并还在跑（上一版会把 ffmpeg 也塞进合并，能跑几十分钟，
             * 于是前端每次重试都被拒，表现成「合并后一直失败」）。
             * 现在遇到这个 400 改为轮询会话状态等结果，不再当失败处理、也不再盲目重试。
             */
            let response
            try {
                response = await mergeRequest()
            } catch (e) {
                const status = e?.response?.status
                const msg = String(e?.response?.data?.message || '')
                if (status === 400 && msg.includes('正在合并中')) {
                    console.log('[upload] 合并仍在进行中，改为轮询等待结果:', file.file.name)
                    response = await this.waitForMergeResult(uploadId, file.file.name)
                } else {
                    // 其它错误（网络抖动 / 代理超时）：分片在服务端保留 24h，重试不会重传文件
                    await new Promise(r => setTimeout(r, 3000))
                    response = await mergeRequest()
                }
            }
            // 关闭合并提示（v2.8.7：精确关闭本条，不再 closeAll 误伤其它提示）
            try {
                const doneItem = this.fileList.find(item => item.uid === file.file.uid)
                if (doneItem && doneItem._mergeToast && doneItem._mergeToast.close) {
                    doneItem._mergeToast.close()
                    doneItem._mergeToast = null
                }
            } catch (e) { /* 忽略 */ }

            // 同步处理完成
            file.onSuccess(response, file.file)
        } catch (err) {
            // 如果是取消操作，不加入异常列表
            if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
                console.log('分块上传已取消:', file.file.name)
                return
            }
            
            console.error('分块上传失败:', err)
            
            // v2.8.3：失败不删服务端分片 —— 保留 24h，用户重试时可直接续传/重合并；
            // 只有用户主动移除条目或清空列表才删（见 releaseItem / clearFileList）。
            const failedItem = this.fileList.find(item => item.uid === file.file.uid)
            if (failedItem) failedItem.keepSessionOnError = true
            // v2.8.7：失败也要关掉「正在合并」的长驻提示
            if (failedItem && failedItem._mergeToast && failedItem._mergeToast.close) {
                try { failedItem._mergeToast.close() } catch (e) { /* 忽略 */ }
                failedItem._mergeToast = null
            }
            
            if (err.response && err.response.status !== 401) {
                this.exceptionList.push(file)
                file.onError(err, file.file)
            } else if (!err.response) {
                // 网络错误，也加入异常列表
                this.exceptionList.push(file)
                file.onError(err, file.file)
            }
        } finally {
            // 清理 AbortController
            this.abortControllers.delete(file.file.uid)
            // 合并/压缩结束（成功或失败）都撤掉「压缩中」标识
            const item = this.fileList.find(i => i.uid === file.file.uid)
            if (item) item.compressing = false
            // 调用并发控制的完成回调
            this.onUploadComplete()
        }
    },
    /**
     * v2.8.8：轮询「合并结果」。
     *
     * 触发条件：合并请求返回 400「正在合并中」—— 说明服务端还有一次合并/写渠道在跑。
     * 这里每 3~15 秒查一次 GET /upload?session=true&uploadId=…，直到：
     *   · completed + result → 直接当作上传成功返回（结构与合并响应一致）；
     *   · 会话被清理（gone）→ 抛错让用户重新上传；
     *   · 超过 10 分钟 → 抛超时错误（服务端仍会继续跑，用户可以稍后到文件管理确认）。
     */
    async waitForMergeResult(uploadId, fileName) {
        const deadline = Date.now() + 10 * 60 * 1000
        let delay = 3000
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, delay))
            delay = Math.min(delay + 2000, 15000)
            let data
            try {
                const res = await axios({
                    url: '/upload?session=true&uploadId=' + encodeURIComponent(uploadId),
                    method: 'get',
                    withAuthCode: true
                })
                data = res.data || {}
            } catch (e) {
                // 网络抖动（代理重启、移动网络切换）不判失败，继续等
                console.warn('[upload] 查询合并状态失败，继续等待:', e?.message || e)
                continue
            }
            if (data.gone) throw new Error(data.message || this.$t('uploadForm.mergeExpired'))
            if (data.completed && Array.isArray(data.result)) {
                console.log('[upload] 轮询命中合并结果:', fileName)
                return { data: data.result }
            }
        }
        throw new Error(this.$t('uploadForm.mergeTimeout', { name: fileName }))
    },

    // 缩略图最终加载失败：只记录日志。
    // 早期实现会把 file.url 直接替换成 404 占位图，导致列表里 `<a :href="file.url">`
    // 的分享链接也被一起改写（用户看到「缩略图和真实链接对不上」）。
    // 现在占位逻辑收在 UploadFileItem 内部，真实链接始终保留。
    handlePreviewError(file) {
        console.warn('[upload] 缩略图加载失败（已保留真实链接）:', file?.url)
    },

    /* ────────────── 上传完成 → 点击文件名 → 文件详情 ──────────────
     * 与后台「文件管理」「历史记录」共用同一弹窗（FileDetailDialog）+ 同一套
     * 数据构造器（utils/fileDetail.buildFileDetail），字段/预览/复制行为完全一致。
     * 上传列表只有 File_ID，缺少 MD5 / 尺寸 / 渠道等元信息，所以打开时用
     * /api/manage/metadata/<File_ID> 取一次完整 metadata 再渲染。
     */
    async handleDetail(file) {
        if (!file) return
        const fileId = file.srcID || file.name
        if (!fileId) return

        // 先用本地已知信息把弹窗秒开，随后走统一加载器补齐全量详情
        this.detailFile = { name: fileId, metadata: file.metadata || {} }
        this.showDetail = true

        try {
            const detail = await loadFileDetail(fileId, { record: this.detailFile, refresh: true })
            if (!detail) {
                this.$message({ type: 'warning', message: this.$t('uploadForm.detailNotFound') })
                // 查不到记录就关掉，避免弹出一个空详情
                if (this.detailFile && this.detailFile.name === fileId) this.showDetail = false
                return
            }
            // 用户可能已关掉弹窗、或又点了别的文件 —— 避免串数据
            if (!this.showDetail || !this.detailFile || this.detailFile.name !== fileId) return
            this.detailFile = detail.file
        } catch (e) {
            console.warn('[upload] 获取文件详情失败:', e)
            this.$message({ type: 'error', message: this.$t('uploadForm.detailLoadFailed') })
        }
    },
    /** 统一详情组件里删除了文件：同步把这条从上传列表移除 */
    handleDetailDeleted(fileId) {
        if (!fileId) return
        const item = this.fileList.find(i => i.srcID === fileId || i.name === fileId)
        if (item) this.handleRemove(item)
    },
    /** 统一详情组件里重命名了 File_ID：同步上传列表项的 srcID */
    handleDetailFileRenamed(oldFileId, newFileId) {
        const item = this.fileList.find(i => i.srcID === oldFileId)
        if (item) item.srcID = newFileId
    },

    /**
     * 手动上传模式下点「剪刀」（v2.3.0）：
     * 图片来源是待上传列表里的本地 File，打开裁剪弹窗，裁剪结果直接替换待上传文件。
     */
    handleCrop(file) {
        if (!file || !file.rawFile) return
        if (file.status !== 'waiting') {
            this.$message({ type: 'info', message: this.$t('uploadCrop.onlyWaiting') })
            return
        }
        this.cropTarget = file
        this.showCrop = true
    },
    /**
     * 裁剪完成：用裁后的 File 顶掉原来那条待上传项（原图不会上传）。
     *  - uid 必须沿用原条目，uploadFile 里的进度/目录查找都靠 uid 定位
     *  - name 保留「子目录前缀」，只替换文件名，避免文件夹批量上传时丢失层级
     *  - originalSize 记成裁剪后的体积：它表示「将要上传的文件」的初始大小，
     *    这样详情里的「原文件大小 / 压缩后大小」对比才准确
     */
    applyCrop(cropped) {
        const target = this.cropTarget
        this.cropTarget = null
        if (!target || !cropped) return
        const oldRaw = target.rawFile
        const oldName = String(target.name || '')
        const dir = oldName.includes('/') ? oldName.slice(0, oldName.lastIndexOf('/') + 1) : ''
        const displayName = dir + cropped.name
        if (target.url && String(target.url).startsWith('blob:')) {
            URL.revokeObjectURL(target.url)
        }
        cropped.uid = oldRaw?.uid || target.uid || this.createLocalUid()
        cropped.uploadFolder = oldRaw?.uploadFolder ?? target.uploadFolder
        cropped.uploadRelativePath = displayName
        target.rawFile = cropped
        target.name = displayName
        target.originalSize = cropped.size
        target.url = URL.createObjectURL(cropped)
        target.cropped = true
        this.$message({ type: 'success', message: this.$t('uploadCrop.done') })
    },

    /**
     * v2.8.3：释放单个条目占用的资源。
     *   · 预览用的 blob: URL 必须 revoke，否则整个页面生命周期内都占着内存
     *   · 未完成的分片会话 → 让后端删掉（避免磁盘留 24h）
     *   · 未上传的链接暂存 → 让后端删掉
     *   · rawFile 置空，让浏览器 GC 回收文件字节
     */
    releaseItem(file) {
        if (!file) return
        // v2.8.7：条目移除时顺手关掉它的「正在合并」长驻提示
        if (file._mergeToast && file._mergeToast.close) {
            try { file._mergeToast.close() } catch (e) { /* 忽略 */ }
            file._mergeToast = null
        }
        try {
            if (file.url && String(file.url).startsWith('blob:')) URL.revokeObjectURL(file.url)
        } catch (e) { /* 忽略 */ }
        if (file.uploadId && file.chunkedUpload) {
            this.cleanupUploadResources(file.uploadId, file.totalChunks)
                .catch(() => undefined)
        }
        if (file.stagedId) {
            const stagingId = file.stagedId
            axios.post('/api/staging/delete', { stagingId }, { withAuthCode: true }).catch(() => undefined)
            file.stagedId = null
        }
        file.rawFile = null
    },

    handleRemove(file) {
        // 如果文件正在上传，取消上传
        if (this.abortControllers.has(file.uid)) {
            this.abortControllers.get(file.uid).abort()
            this.abortControllers.delete(file.uid)
        }
        // 从上传队列中移除（如果在等待中）
        this.uploadQueue = this.uploadQueue.filter(item => item.file.uid !== file.uid)
        // 释放 blob / 分片会话 / 暂存文件后再移除
        this.releaseItem(file)
        // 从文件列表中移除
        this.fileList = this.fileList.filter(item => item.uid !== file.uid)
        this.$message({
            type: 'info',
            message: this.$t('uploadForm.deleted', { name: this.truncateFilename(file.name) })
        })
    },

    // 清理上传资源
    async cleanupUploadResources(uploadId, totalChunks = 0) {
        try {
            await axios({
                url: `/upload?cleanup=true&uploadId=${uploadId}&totalChunks=${totalChunks}`,
                method: 'get',
                withAuthCode: true,
                timeout: 5000
            })
            console.log(`清理上传资源成功: ${uploadId}`)
        } catch (error) {
            console.warn('清理上传资源失败:', error)
        }
    },
    handleSuccess(response, file) {
        const fileItem = this.fileList.find(item => item.uid === file.uid)
        if (!fileItem) return // 文件已被删除
        const oldPreviewUrl = fileItem.url
        
        try {     
            // 对上传渠道为外链的，不修改链接
            const uploadChannel = fileItem.uploadChannel || this.effParams.uploadChannel
            if (uploadChannel !== 'external') {
                // 防御：响应缺失（例如 el-upload 在未真正发请求时回调 onSuccess）时不要打失败标记
                if (!response || !response.data || !response.data[0]) {
                    console.warn('[upload] handleSuccess 收到空响应，已忽略')
                    fileItem.status = 'waiting'
                    fileItem.editableName = true
                    return
                }
                // 从response.data[0].src中去除/file/前缀
                // 后端 src 现在是「全站统一出口」的完整外链（可能带自定义域名），
                // 这里统一取出 File_ID；同时兼容旧的相对形态 /file/xxx
                const rawSrc = String(response.data[0].src || '')
                const srcID = (rawSrc.includes('/file/') ? rawSrc.split('/file/')[1] : rawSrc).replace(/^\/+/, '')
                // 全站统一出口（自定义访问域名优先）
                fileItem.url = fileLink(srcID)
                // 后端上传响应只回 { src, name }，用 name 推断扩展名补到外链末尾
                const metaForUrl = { FileName: (response.data[0] && response.data[0].name) || file.name }
                const urls = buildFileUrls(srcID, file.name, this.rootUrl, metaForUrl)
                Object.assign(fileItem, urls)
                fileItem.srcID = srcID
            }
            fileItem.progreess = 100
            fileItem.status = 'success'
            
            // Save to history
            this.saveToHistory(fileItem)

            this.$message({
                type: 'success',
                message: this.$t('uploadForm.uploadSuccess', { name: this.truncateFilename(file.name) })
            })
            // v2.8.3：上传成功后释放浏览器内存 —— 预览 blob 已无用，原始 File 也不再需要；
            // 暂存文件清掉引用但不发删除请求（异步备份可能还在读，交给 2h TTL）
            try {
                if (oldPreviewUrl && String(oldPreviewUrl).startsWith('blob:')) URL.revokeObjectURL(oldPreviewUrl)
            } catch (e) { /* 忽略 */ }
            fileItem.rawFile = null
            fileItem.stagedId = null
            setTimeout(() => {
                const item = this.fileList.find(item => item.uid === file.uid)
                if (item) item.status = 'done'
            }, 1000)
        } catch (error) {
            this.$message.error(this.$t('uploadForm.uploadFailed', { name: this.truncateFilename(file.name) }))
            fileItem.status = 'exception'
        }
        // 注意：并发控制的 onUploadComplete 已在各上传方法的 finally 中调用
    },
    /**
     * v2.9.0：把「登记文件」成功的记录追加到上传列表。
     *
     * 场景：前台首页点「登记文件」把一条已在存储上的文件登记进系统后，
     * 用户期望立刻在下方文件列表里看到这条记录（而不是刷新页面）。
     *
     * 入参 data 来自 POST /api/record 的 data：
     *   { id, name, size, mime, md5, channel, src }
     * 其中 id = File_ID，src = 服务端签发的统一出口外链。
     *
     * 注意：登记文件不经过上传管线，所以直接给 status='done'，
     * 且不带 rawFile / stagedId（「清空」「上传」都不会碰它）。
     */
    addRecordedFile(data) {
        const srcID = String((data && data.id) || '').trim();
        if (!srcID) return false;
        // 去重：同一条登记记录不重复入列
        if (this.fileList.some(item => item.srcID === srcID)) return false;
        const name = String((data && data.name) || srcID);
        const extMatch = /\.([A-Za-z0-9]{1,12})$/.exec(name);
        const metadata = {
            FileName: name,
            FileExt: extMatch ? extMatch[1].toLowerCase() : '',
            FileSize: Number(data && data.size) || 0,
            FileMime: String((data && data.mime) || ''),
            ChannelName: String((data && data.channel) || ''),
            UploadSource: 'Record'
        };
        const urls = buildFileUrls(srcID, name, this.rootUrl, metadata);
        this.fileList.push({
            uid: `record-${srcID}-${Date.now()}`,
            name,
            // 预览优先用服务端签发的地址（已带扩展名，图片能直接出缩略图）
            url: String((data && data.src) || '') || fileLink(srcID),
            status: 'done',
            progreess: 100,
            serverCompress: false,
            uploadChannel: 'record',
            retryCount: 0,
            editableName: false,
            isRecorded: true,
            srcID,
            metadata,
            ...urls
        });
        return true;
    },
    saveToHistory(fileItem) {
        try {
            const history = JSON.parse(localStorage.getItem('uploadHistory') || '[]')
            const newRecord = {
                name: fileItem.name,
                url: fileItem.finalURL,
                time: Date.now(),
                type: fileItem.name.split('.').pop().toLowerCase()
            }
            history.push(newRecord)
            localStorage.setItem('uploadHistory', JSON.stringify(history))
        } catch (e) {
            console.error('Failed to save history', e)
        }
    },
    handleError(err, file) {
        const fileItem = this.fileList.find(item => item.uid === file.uid)
        if (!fileItem) return // 文件已被删除

        /*
         * v2.8.9：记下失败原因（详情页「处理事件」用）。
         * 后端异常一般是 { message: string | string[] }，网络异常只有 err.message。
         */
        const data = err && err.response && err.response.data
        const rawReason = (data && (data.message || data.error)) || (err && err.message) || '未知错误'
        fileItem.failReason = Array.isArray(rawReason) ? rawReason.join('；') : String(rawReason)

        this.$message.error(this.$t('uploadForm.uploadFailed', { name: this.truncateFilename(file.name) }))
        fileItem.status = 'exception'

        // 不做逐文件定时重试：失败文件已经记进 exceptionList，
        // 等「这一波」上传全部结束后由 onUploadComplete → maybeStartRetryRound
        // 统一回到失败队列循环重试（这样才不会被某个文件的定时器打断后续文件）。
        // 注意：并发控制的 onUploadComplete 已在各上传方法的 finally 中调用
    },
    async handleCopy(file) {
        const status = this.fileList.find(item => item.uid === file.uid).status
        if (status !== 'done' && status !== 'success') {
            this.$message({ type: 'warning', message: this.$t('uploadForm.fileNotUploaded') })
            return
        }
        const ok = await copyText(getUrlByFormat(file, this.selectedUrlForm))
        this.$message({
            type: ok ? 'success' : 'warning',
            message: this.$t(ok ? 'uploadForm.copySuccess' : 'uploadForm.copyFailed')
        })
    },
    /**
     * 上传文件校验：后缀白名单 + 内容签名（magic bytes）双重校验。
     * 目的：拦住「改后缀绕过白名单」的文件（如 exe 改名成 .png）。
     * 返回 { ok, message }；签名无法判定时按「放行」处理，避免误伤新格式。
     */
    async checkFileAcceptable(file) {
        const name = file.name || ''
        const ext = (name.split('.').pop() || '').toLowerCase()
        if (!ext) {
            return { ok: false, message: `无法识别文件类型：${name}（缺少扩展名）` }
        }
        if (!this.allowedExtensions.includes(ext)) {
            return {
                ok: false,
                message: `不支持的格式 .${ext}，允许的格式：${this.allowedExtensions.join(' / ')}`
            }
        }
        /*
         * v3.0.0：只校验扩展名（+ 后端的大小/白名单），不再用魔数拒绝。
         * 背景：MP3 常见以 0xFFFB 帧同步开头（没有 ID3 头）、VBR / 转封装过的
         * mp3 / m4a / mov 头部也常被判成「不符」，导致明明允许的格式被拒。
         * 这里保留一次签名探测，仅在控制台留痕，便于排查，绝不阻断上传。
         */
        try {
            const expected = await this.signatureMatches(file, ext)
            if (expected === false) {
                const realExt = await this.detectImageSignature(file)
                console.warn(
                    `[upload] 扩展名与签名不一致（仅记录，已放行）：${name} 声明 .${ext}` +
                    (realExt ? `，实际内容疑似 .${realExt}` : ''),
                )
            }
        } catch (e) {
            /* 读取文件头失败同样放行 */
        }
        return { ok: true, message: '' }
    },

    /** v2.8.2：按文件头魔数识别真实图片格式，非已知图片签名返回 null */
    async detectImageSignature(file) {
        let head
        try {
            head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
        } catch {
            return null
        }
        if (head.length < 12) return null
        const hex = Array.from(head).map((b) => b.toString(16).padStart(2, '0')).join('')
        const ascii = (s, e) => String.fromCharCode(...head.slice(s, e))
        if (hex.startsWith('ffd8ff')) return 'jpg'
        if (hex.startsWith('89504e47')) return 'png'
        if (ascii(0, 4) === 'GIF8') return 'gif'
        if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
        if (hex.startsWith('424d')) return 'bmp'
        return null
    },

    /** 读取文件头并比对已知魔数；返回 true=匹配 / false=不匹配 / null=未知格式不判定 */
    async signatureMatches(file, ext) {
        let head
        try {
            head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
        } catch {
            return null
        }
        if (head.length < 4) return null
        const hex = Array.from(head).map((b) => b.toString(16).padStart(2, '0')).join('')
        const ascii = (s, e) => String.fromCharCode(...head.slice(s, e))
        const a4 = ascii(0, 4)
        const b4 = ascii(4, 8)

        switch (ext) {
            case 'jpg':
            case 'jpeg':
                return hex.startsWith('ffd8ff')
            case 'png':
                return hex.startsWith('89504e47')
            case 'gif':
                return a4 === 'GIF8'
            case 'webp':
                return a4 === 'RIFF' && ascii(8, 12) === 'WEBP'
            case 'bmp':
                return a4 === 'BM\x00\x00' || hex.startsWith('424d')
            case 'webm':
                return hex.startsWith('1a45dfa3')
            case 'ogg':
                return a4 === 'OggS'
            case 'mp4':
            case 'm4v':
            case 'm4a':
                return b4 === 'ftyp'
            case 'mov':
                return b4 === 'ftyp' || ['moov', 'mdat', 'free', 'wide'].includes(b4)
            case 'aac':
                return /^fff[019]/.test(hex)
            case 'mp3':
                return hex.startsWith('494433') || /^ff[ef][0-9a-f]/.test(hex)
            default:
                return null
        }
    },

    /**
     * v2.8.3：选择文件时只做「校验 + 入列」，不再压缩。
     * 手动模式：先让用户改名/裁剪，点「上传」时才在 prepareUploadFile 里压缩；
     * 自动模式：uploadFile 里压缩后立刻上传（不需要改名/裁剪步骤）。
     */
    beforeUpload(file) {
        return new Promise(async (resolve, reject) => {
            try {
                // 扩展名白名单 + magic bytes 双重校验（先按原始文件校验）
                const extCheck = await this.checkFileAcceptable(file)
                if (!extCheck.ok) {
                    this.$message.error(extCheck.message)
                    return reject(extCheck.message)
                }
                // 单文件上限（上传设置里的临时值优先，其次后台全局设置，默认 200MB）
                const MAX_UPLOAD_MB = this.maxUploadSizeMB
                if (file.size / 1024 / 1024 > MAX_UPLOAD_MB) {
                    this.$message.error(`${file.name} 超过 ${MAX_UPLOAD_MB}MB 上限，请到上传设置或后台调大限制`)
                    return reject(this.$t('uploadForm.fileSizeTooLarge'))
                }
                const manual = !this.autoUpload || this.uploadMethod !== 'default'
                this.fileList.push({
                    uid: file.uid,
                    name: file.uploadRelativePath || file.name,
                    // 保留原始 File 引用：手动模式改名/裁剪后仍以它为源
                    rawFile: file,
                    originalSize: file.size,
                    url: URL.createObjectURL(file),
                    finalURL: '',
                    mdURL: '',
                    htmlURL: '',
                    ubbURL: '',
                    srcID: '',
                    status: manual ? 'waiting' : 'uploading',
                    editableName: manual,
                    progreess: 0,
                    serverCompress: false,
                    uploadFolder: file.uploadFolder ?? this.uploadFolder,
                    retryCount: 0,
                    compressing: false,
                })
                /*
                 * v2.8.3 修复：手动模式必须让 el-upload 直接「取消本次上传」——
                 * 条目已经由上面 push 进 fileList，若这里 resolve(file) 放行，
                 * el-upload 会照常调用 http-request → uploadFile 里的手动门控直接 return
                 * （不发请求）→ el-upload 拿到 resolved 的 Promise 后回调 onSuccess(undefined)
                 * → handleSuccess 读 response.data 抛错 → 条目被打成「上传失败」。
                 * 返回 false 后 el-upload 只把内部临时条目丢掉（show-file-list=false，看不到）。
                 */
                resolve(manual ? false : file)
            } catch (err) {
                reject(err)
            }
        })
    },

    /**
     * v2.8.3：上传前预处理（在「点上传」或「自动上传」时执行）——
     * 先把用户改好的名字/裁剪结果作为输入，再做 WebP 转换与压缩：
     *   · gif：一律跳过（动图压缩会丢帧）
     *   · png：交给服务端 sharp 重编码（保透明），客户端 canvas 转 JPEG 会丢透明
     *   · jpg/jpeg：客户端压缩（省带宽），压不动保留原图
     *   · 视频/音频：标记 serverCompress，由后端 ffmpeg 处理（大文件走磁盘路径）
     * 返回 { file, serverCompress }，失败一律降级为原文件，绝不阻断上传。
     */
    async prepareUploadFile(file) {
        /*
         * v3.0.0：压缩与 WebP 的先后顺序（保持现有「先 WebP → 已转则跳过压缩」不变）：
         * WebP 是专用图片编码，通常比 image-conversion 的通用重编码（JPEG）更省体积，
         * 且一步到位 —— 先转 WebP 可避免「压完再转」的二次画质损失与重复计算；
         * 只有当 WebP 被放弃（产物更大 / 转换失败 / 不支持的格式）时才走压缩路径。
         */
        let processed = file
        let convertedToWebp = false
        const canConvertToWebp = this.convertToWebp &&
            file.type.includes('image') &&
            !file.type.includes('webp') &&
            !file.type.includes('gif') &&
            !file.type.includes('svg')
        if (canConvertToWebp) {
            /*
             * v2.8.9：WebP 转换失败或超过 300 秒 → 自动放弃本次转换，仍用原文件上传；
             * 放弃原因记到条目上，随上传请求带给后端写进「处理事件」，详情页可见。
             * v3.0.0：转换模式取「上传设置 → WebP转换模式」展开后的最终值
             * （follow = 后台 webpMode，缺省 lossless）。
             */
            let webpTimer = null
            try {
                const convertedFile = await Promise.race([
                    this.convertImageToWebp(file, this.getFinalWebpMode()),
                    new Promise((_, reject) => {
                        webpTimer = setTimeout(
                            () => reject(new Error(this.$t('uploadForm.webpTimeout'))),
                            300000
                        )
                    })
                ])
                if (convertedFile) {
                    /*
                     * v3.0.0：WebP 回退 —— 产物比原文件更大时放弃 WebP，
                     * 继续用原文件（转换本身失败了不如不转），并记录跳过原因。
                     */
                    if (convertedFile.size > file.size) {
                        console.warn('[upload] WebP 产物比原文件更大，放弃转换、保留原文件:', file.name)
                        this.markWebpSkip(file, this.$t('uploadForm.webpLarger'))
                    } else {
                        processed = convertedFile
                        convertedToWebp = true
                    }
                } else {
                    this.markWebpSkip(file, this.$t('uploadForm.webpUnsupported'))
                }
            } catch (err) {
                console.warn('WebP转换失败，放弃转换并使用原文件:', err)
                this.markWebpSkip(file, (err && err.message) || this.$t('uploadForm.webpFailed'))
            } finally {
                if (webpTimer) clearTimeout(webpTimer)
            }
        }

        const ext = (processed.name.split('.').pop() || '').toLowerCase()
        const isImage = String(processed.type || '').startsWith('image/')
        const isGif = processed.type === 'image/gif' || ext === 'gif'
        // v2.8.5：禁止压缩格式闸门 —— 命中清单 → 原样上传，不做 WebP 之外的任何处理
        const extExcluded = this.compressExcludedExts.includes(ext)
        let serverCompress = false

        if (this.customerCompress && !isGif && !extExcluded) {
            if (isImage) {
                // 已转 WebP：本身已是压缩产物，不再二次压缩
                if (!convertedToWebp && processed.size / 1024 / 1024 > this.compressBar) {
                    if (['png', 'webp', 'avif'].includes(ext)) {
                        // 保透明 / 避免 canvas 丢 alpha → 交给后端 sharp
                        serverCompress = true
                    } else {
                        try {
                            const pct = Math.min(100, Math.max(10, Number(this.compressPercent) || 80))
                            const targetKB = Math.max(1, Math.round((processed.size / 1024) * (pct / 100)))
                            const res = await imageConversion.compressAccurately(processed, targetKB)
                            /*
                             * v3.0.0：只接受「压得更小」的结果 —— res.size < processed.size
                             * 保留现有逻辑；压缩产物反而更大时（低质量重编码不划算）不替换，
                             * 继续用原文件上传。
                             */
                            if (res && res.size < processed.size && this.allowedExtensions.includes('jpg')) {
                                // image-conversion 固定输出 JPEG：扩展名必须同步成 .jpg，
                                // 否则后端魔数校验会判「内容与扩展名不符」
                                const base = String(processed.name).replace(/\.[^.]+$/, '') || 'image'
                                const jpegName = `${base}.jpg`
                                const asJpeg = new File([res], jpegName, { type: 'image/jpeg' })
                                asJpeg.uid = file.uid
                                this.copyUploadPath(processed, asJpeg)
                                asJpeg.uploadRelativePath = jpegName
                                asJpeg.uploadFolder = joinUploadFolder(
                                    this.uploadFolder,
                                    getRelativeDirectory(jpegName)
                                )
                                processed = asJpeg
                            }
                        } catch (err) {
                            console.warn('本地压缩失败，改为服务端压缩:', err)
                            serverCompress = true
                        }
                    }
                }
            } else {
                // 视频 / 音频：客户端压不了，交给后端（大文件按磁盘路径处理）
                serverCompress = true
            }
        }
        return { file: processed, serverCompress }
    },

    /** v2.8.9：记录「未转换为 WebP」的原因，随上传请求带给后端（详情页「处理事件」展示） */
    markWebpSkip(file, reason) {
        const uid = file?.uid
        const item = this.fileList.find(i => i.uid === uid)
        if (item) item.webpSkip = reason
    },
    handleProgress(event) {
        const fileItem = this.fileList.find(item => item.uid === event.file.uid)
        if (fileItem) {
            fileItem.progreess = event.percent
        }
    },
    async copyAll(format = this.selectedUrlForm) {
        const urls = this.fileList
            .filter(item => item.status === 'done' || item.status === 'success')
            .map(item => getUrlByFormat(item, format))
            .join('\n')
        const ok = await copyText(urls)
        this.$message({
            type: ok ? 'success' : 'warning',
            message: this.$t(ok ? 'uploadForm.copyAllSuccess' : 'uploadForm.copyFailed')
        })
    },
    clearFileList() {
        if (this.fileList.length > 0) {
            // 取消所有正在上传的文件
            this.abortControllers.forEach((controller, uid) => {
                controller.abort()
            })
            this.abortControllers.clear()
            // 停止失败重试循环（定时器 + 失败队列）
            if (this.roundTimer) {
                clearTimeout(this.roundTimer)
                this.roundTimer = null
            }
            this.retryLoopActive = false
            this.retryRound = 0
            this.exceptionList = []
            // 清空上传队列
            this.uploadQueue = []
            // 释放所有条目的 blob / 分片会话 / 暂存文件
            this.fileList.forEach(item => this.releaseItem(item))
            // 清空文件列表
            this.fileList = []
            this.$message({
                type: 'success',
                message: this.$t('uploadForm.fileListCleared')
            })
        } else {
            this.$message({
                type: 'info',
                message: this.$t('uploadForm.fileListEmpty')
            })
        }
    },
    clearSuccessList() {
        if (this.uploadSuccessCount > 0) {
            this.fileList
                .filter(item => item.status === 'done' || item.status === 'success')
                .forEach(item => this.releaseItem(item))
            this.fileList = this.fileList.filter(item => item.status !== 'done' && item.status !== 'success')
            this.$message({
                type: 'success',
                message: this.$t('uploadForm.successFilesCleared')
            })
        } else {
            this.$message({
                type: 'info',
                message: this.$t('uploadForm.successFilesEmpty')
            })
        }
    },
    /** v2.7.0：清空链接输入框（原「一键清空」按钮逻辑迁入列表右上角删除图标下拉） */
    clearPasteInput() {
        if (this.pastedUrls) {
            this.pastedUrls = ''
            this.$message({ type: 'success', message: this.$t('upload.pasteInputCleared') })
        } else {
            this.$message({ type: 'info', message: this.$t('upload.pasteInputEmpty') })
        }
    },
    isEditablePasteTarget(target) {
        const element = target?.nodeType === Node.TEXT_NODE ? target.parentElement : target
        if (!element) return false

        const tagName = element.tagName
        return tagName === 'INPUT'
            || tagName === 'TEXTAREA'
            || element.isContentEditable
            || Boolean(element.closest?.('[contenteditable="true"]'))
    },
    handlePasteShortcut(event) {
        const isPasteShortcut = (event.ctrlKey || event.metaKey)
            && !event.altKey
            && String(event.key).toLowerCase() === 'v'
        if (!isPasteShortcut || this.isEditablePasteTarget(event.target)) return

        const receiver = this.$refs.clipboardPasteReceiver
        if (!receiver) return

        this.pasteFocusTarget = document.activeElement
        receiver.value = ''
        try {
            receiver.focus({ preventScroll: true })
        } catch {
            receiver.focus()
        }
    },
    releasePasteReceiver(target) {
        const receiver = this.$refs.clipboardPasteReceiver
        if (!receiver || target !== receiver) return

        receiver.value = ''
        const focusTarget = this.pasteFocusTarget
        this.pasteFocusTarget = null
        setTimeout(() => {
            if (focusTarget?.isConnected && typeof focusTarget.focus === 'function') {
                try {
                    focusTarget.focus({ preventScroll: true })
                } catch {
                    focusTarget.focus()
                }
            } else {
                receiver.blur()
            }
            if (document.activeElement === receiver) receiver.blur()
        }, 0)
    },
    async handlePaste(event) {
        // 当粘贴位置是文本框时，不执行该操作
        const isPasteReceiver = event.target === this.$refs.clipboardPasteReceiver
        if (!isPasteReceiver && this.isEditablePasteTarget(event.target)) {
            return
        }
        const clipboardData = event.clipboardData
        if (!clipboardData) {
            this.releasePasteReceiver(event.target)
            return
        }

        const items = Array.from(clipboardData.items || [])
        const fileItems = items.filter(item => item.kind === 'file')
        const stringItems = items.filter(item => item.kind === 'string')
        const fileEntries = filesToUploadEntries(clipboardData.files || [])

        if (isPasteReceiver) event.preventDefault()
        this.releasePasteReceiver(event.target)

        if (fileEntries.length > 0 || fileItems.length > 0) {
            event.preventDefault()
            let entries = []
            if (fileItems.length) {
                try {
                    entries = await collectFilesFromDataTransferItems(fileItems)
                } catch (error) {
                    console.warn('Failed to parse clipboard items, falling back to clipboard files:', error)
                }
            }
            // Safari may expose file items without supporting their entry APIs.
            if (!entries.length) entries = fileEntries
            if (entries.length) await this.uploadLocalEntries(entries)
        }

        if (stringItems.length > 0) {
            /*
             * v2.8.5：链接模式下，页面级 Ctrl+V 粘贴的文本一律并入输入框，
             * 与「在输入框内粘贴」行为一致 —— 修复 Chrome 等浏览器里
             * 「粘贴后点外链却生成不了外链格式」的问题（原实现无条件走
             * uploadFromUrl 即转存拉取，绕过了外链模式，输入框始终是空的，
             * 此时点「外链」只会提示没有待处理条目）。转存/外链统一由
             * 对应按钮基于输入框内容执行，跨浏览器行为一致。
             * 文件模式维持原「Ctrl+V 直接拉取上传」行为不变。
             */
            if (this.uploadMethod === 'paste') {
                const text = clipboardData.getData('text/plain') || '';
                if (text) {
                    this.pastedUrls = this.pastedUrls ? this.pastedUrls + '\n' + text : text;
                }
            } else {
                this.uploadFromUrl(stringItems);
            }
        }
    },
    /**
     * v2.6.0：切换「文件压缩」开关（列表栏压缩按钮）。
     * customerCompress 是 props —— 不直接改，向父组件发 update 事件；
     * 父组件（UploadHome）用 v-model:customerCompress 接住后，
     * 上传设置弹窗里的「文件压缩」开关与这里是同一个值，天然双向同步。
     */
    /**
     * v2.7.0：「上传」按钮改为「提取」—— 只解析输入框里的有效链接并加入
     * 文件列表（等待上传状态，不自动上传；等待中可改名，图片条目可裁剪）。
     * 实际上传由左侧新增的「上传」按钮（startPasteUpload）执行。
     */
    handleExtractPasteUrls() {
        /*
         * 沿用 v2.5.0 的脏文本提取：文案 / 表情 / HTML 混排时自动挑出有效 URL。
         */
        const validUrls = extractUrlsFromText(this.pastedUrls);
        if (!validUrls.length) {
            this.$message({
                type: 'warning',
                message: this.$t('upload.noValidUrlFound')
            });
            return;
        }
        // 去重：列表里已有同链接的条目不再重复添加
        const existing = new Set(this.fileList.map(item => item.srcID || item.url).filter(Boolean));
        let added = 0;
        validUrls.forEach((url, i) => {
            if (existing.has(url)) return;
            added += 1;
            if (this.pasteUploadMethod === 'external') {
                // 外链格式与参考实现（CloudFlare-ImgBed）完全一致：html 带 width=100%
                const fileName = url.split('/').pop();
                this.fileList.push({
                    uid: Date.now() + i,
                    name: fileName,
                    url: url,
                    finalURL: url,
                    mdURL: `![${fileName}](${url})`,
                    htmlURL: `<img src="${url}" alt="${fileName}" width=100% />`,
                    ubbURL: `[img]${url}[/img]`,
                    srcID: url,
                    status: 'waiting',
                    progreess: 0,
                    serverCompress: false,
                    uploadChannel: 'external',
                    retryCount: 0,
                    editableName: true,
                });
            } else {
                // 转存：远端链接占位条目，「上传」时交给 uploadFromUrl 服务端拉取
                this.fileList.push({
                    uid: Date.now() + i,
                    name: url.split('/').pop() || url,
                    url: '',
                    srcID: url,
                    status: 'waiting',
                    progreess: 0,
                    serverCompress: false,
                    uploadChannel: 'save',
                    retryCount: 0,
                    isRemoteUrl: true,
                    editableName: true,
                });
            }
        });
        if (added > 0) {
            this.$message({ type: 'success', message: this.$t('upload.extractedCount', { count: added }) });
        } else {
            this.$message({ type: 'info', message: this.$t('upload.extractNoNew') });
        }
    },
    /**
     * v20261027：「转存」一步到位 —— 点击后直接把远端文件拉取到本地，
     * 列表里只出现「已带真实文件（rawFile）」的条目，不再有先入列的占位条目；
     * 之后点「上传」就是纯本地提交，不会二次拉取。
     * （旧实现先入列占位再调 beforeUpload 回填，而 beforeUpload 内部自己会
     *   pushFileToQueue 入列一条真实条目 —— 占位 + 真实两条共存且 uid 相同，
     *   这就是「转存出双份加载项、点上传还重新拉一遍」的根因。）
     * 校验不通过（类型不允许/拉取失败）的条目不会留在列表里。
     */
    async handlePasteSave() {
        // v3.0.0：转存（拉取后待上传/直接提交）前先刷新一遍上传控制参数
        await this.refreshUploadControls()
        this.pasteUploadMethod = 'save';
        const validUrls = extractUrlsFromText(this.pastedUrls);
        if (!validUrls.length) {
            this.$message({ type: 'warning', message: this.$t('upload.noValidUrlFound') });
            return;
        }
        // 去重：列表里已有同链接（srcID）的条目不再重复拉取；
        // 输入框内部完全相同的链接也只保留一条（重复转存同链接没有意义）
        const existing = new Set(this.fileList.map(item => item.srcID || item.url).filter(Boolean));
        const uniqueUrls = Array.from(new Set(validUrls));
        const dupInInput = validUrls.length - uniqueUrls.length;
        const newUrls = uniqueUrls.filter(url => !existing.has(url));
        const dupInList = uniqueUrls.length - newUrls.length;
        const skippedDup = dupInInput + dupInList;
        if (skippedDup > 0) {
            // 明确告知「消失的文件」去哪了：重复链接被自动跳过（可感知，不静默）
            this.$message({ type: 'info', message: this.$t('upload.pasteDuplicateSkipped', { count: skippedDup }) });
        }
        if (!newUrls.length) {
            return;
        }
        // 拉取期间给出可感知的加载提示（拉取完成后关闭）
        const loadingMsg = this.$message({
            type: 'info',
            message: this.$t('upload.pasteFetching', { count: newUrls.length }),
            duration: 0
        });
        let okCount = 0;
        try {
            // 并行拉取；每个链接独立处理，单个失败不影响其它链接
            const results = await Promise.allSettled(newUrls.map((url, i) =>
                this.fetchRemoteFile(url, this.createLocalUid() + '-' + i)
            ));
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                if (r.status === 'rejected') {
                    this.warnUrlRequestFailed(r.reason);
                    continue;
                }
                const payload = r.value;
                try {
                    if (payload.kind === 'staged') {
                        /*
                         * 大文件 / 音视频：文件已在服务端磁盘，浏览器只拿到 stagingId。
                         * 仍然以 waiting 条目出现在列表里（可改名；非图片无裁剪），
                         * 点「上传」时由后端直接压缩 + 写渠道，不再经过浏览器。
                         */
                        this.fileList.push({
                            uid: this.createLocalUid(),
                            name: payload.name,
                            rawFile: null,
                            stagedId: payload.stagingId,
                            originalSize: payload.size,
                            size: payload.size,
                            // 预览仍用远端地址（不占本地内存）；非图片不会渲染缩略图
                            url: payload.sourceUrl || '',
                            finalURL: '', mdURL: '', htmlURL: '', ubbURL: '',
                            srcID: newUrls[i],
                            status: 'waiting',
                            progreess: 0,
                            editableName: true,
                            serverCompress: this.customerCompress && !String(payload.mime || '').startsWith('image/'),
                            uploadFolder: this.uploadFolder,
                            retryCount: 0,
                            compressing: false,
                            isStaged: true,
                        });
                        okCount += 1;
                        continue;
                    }
                    const file = payload.file;
                    // beforeUpload 只做校验 + 入列（压缩延后到点「上传」时）
                    await this.beforeUpload(file);
                    // v2.8.6b 修复：手动模式 beforeUpload resolve false（v2.8.3 契约），
                    // 旧代码 `processed instanceof File` 恒为假 → srcID 从未写入 →
                    // 「列表里已有同链接不再重复拉取」的去重彻底失效，重复转存会无限堆积条目。
                    // 改为按 uid 直接找回条目（beforeUpload 失败会 reject，走 catch 不会到这里）
                    const item = this.fileList.find(f => f.uid === file.uid);
                    if (item) {
                        // 链接模式固定「手动上传」语义：等待用户点「上传」。
                        // 注意：不要设置 uploadChannel —— 上传时会把它作为渠道名
                        // 发给后端，必须沿用全局所选渠道（与文件模式条目一致）；
                        // 这里只记录 srcID 供再次转存同链接时去重。
                        item.status = 'waiting';
                        item.editableName = true;
                        item.srcID = newUrls[i];
                        okCount += 1;
                    }
                } catch (e) {
                    // beforeUpload 内部已弹过具体错误提示，这里只记录便于排查
                    console.error('[转存] 文件校验未通过:', e);
                }
            }
        } finally {
            loadingMsg.close();
        }
        if (okCount > 0) {
            this.$message({ type: 'success', message: this.$t('upload.extractedCount', { count: okCount }) });
        }
    },
    /**
     * v2.8.2：「外链」独立按钮 —— 一键完成输入框检测 → 有效链接提取 →
     * 逐条生成外链格式（md/html/ubb）加载到列表并立即完成。
     */
    /** v1.0.6：「其他」下拉的菜单分发（下载 / 外链） */
    handleOtherMenuCommand(command) {
        if (command === 'download') {
            this.downloadPastedLinks();
            return;
        }
        if (command === 'external') {
            this.handlePasteExternal();
        }
    },
    /**
     * v1.0.6：「其他 → 下载」——把链接输入框里的链接下载到本地。
     *
     * 优先 fetch 成 Blob 再存盘：这样跨域图片也能真的落到本地
     * （直接给 <a download> 一个跨域地址，浏览器会忽略 download 属性、改成跳转预览）。
     * v1.0.7：fetch 被 CORS 挡住时不再 `window.open`（那正是「点了下载反而跳到文件页面」的原因），
     * 改为交给本站 `/api/manage/download` 中转 —— 同源请求 + attachment 头，必然落到本地。
     */
    async downloadPastedLinks() {
        const urls = extractUrlsFromText(this.pastedUrls);
        if (!urls.length) {
            this.$message({ type: 'info', message: this.$t('upload.noValidLink') });
            return;
        }
        let okCount = 0;
        for (let i = 0; i < urls.length; i += 1) {
            const url = urls[i];
            const name = this.guessDownloadName(url, i);
            try {
                const res = await fetch(url, { credentials: 'omit' });
                if (!res.ok) throw new Error(String(res.status));
                const blob = await res.blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = name;
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                okCount += 1;
            } catch {
                // 跨域 / 需鉴权 / 服务端不允许：走本站中转（同源 + attachment，浏览器直接存盘）
                const a = document.createElement('a');
                a.href = `/api/manage/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                okCount += 1;
            }
            // 多个链接之间留点间隔，避免被浏览器判定为批量下载而拦截
            if (i < urls.length - 1) await new Promise((r) => window.setTimeout(r, 300));
        }
        if (okCount > 0) {
            this.$message({ type: 'success', message: this.$t('upload.downloadLinksDone', { n: okCount }) });
        }
    },
    /** 从 URL 猜一个像样的文件名（路径最后一段；取不到就用序号） */
    guessDownloadName(url, index) {
        try {
            const u = new URL(url);
            const seg = decodeURIComponent((u.pathname || '').split('/').filter(Boolean).pop() || '');
            if (seg) return seg;
        } catch {
            /* 非法 URL：走下面的兜底 */
        }
        return `download-${index + 1}`;
    },
    handlePasteExternal() {
        this.pasteUploadMethod = 'external';
        this.handleExtractPasteUrls();
        // 提取出的外链条目立即按外链通道完成（无需再点上传）
        this.startPasteUpload(true);
    },
    /**
     * v2.7.0：链接模式的「上传」按钮 —— 把等待中的链接条目按当前方式处理
     * （外链条目直接记录为成功外链；转存条目走服务端拉取），行为对齐文件模式的上传。
     * v2.8.0：新增 onlyExternal 参数 —— 外链按钮自动完成时只处理外链条目。
     */
    startPasteUpload(onlyExternal = false) {
        // v3.0.0：链接模式「上传」前先刷新一遍上传控制参数（一次点击只刷一次，失败不阻断）
        this.refreshUploadControls().then(() => {
            this._doStartPasteUpload(onlyExternal)
        })
    },
    async _doStartPasteUpload(onlyExternal = false) {
        const pending = this.fileList.filter(item => item.status === 'waiting'
            && (item.uploadChannel === 'external' || (!onlyExternal && item.isRemoteUrl)));
        if (!pending.length) {
            // v2.8.5：外链按钮重复点击时输入框已无新链接，属正常操作，
            // 不再弹「没有等待上传的文件」提示；「上传」按钮保留该提示。
            if (!onlyExternal) {
                this.$message({ type: 'info', message: this.$t('uploadForm.noPendingFiles') });
            }
            return;
        }
        // 外链条目：标记上传中并走 external 通道（不实际上传，仅记录外链）
        pending.forEach(item => {
            if (item.uploadChannel !== 'external') return;
            item.editableName = false;
            item.status = 'uploading';
            const mock = new File([], item.name, { type: 'text/plain' });
            mock.uid = item.uid;
            mock.url = item.url;
            this.uploadFile({
                file: mock,
                onProgress: (evt) => this.handleProgress(evt),
                onSuccess: (response, file) => this.handleSuccess(response, file),
                onError: (error, file) => this.handleError(error, file)
            });
        });
        // 转存条目：移除占位条目后交给 uploadFromUrl（它会重新入列并走服务端拉取）
        const saveUrls = pending.filter(item => item.isRemoteUrl).map(item => item.srcID);
        if (saveUrls.length) {
            const urlSet = new Set(saveUrls);
            this.fileList = this.fileList.filter(item => !item.isRemoteUrl || !urlSet.has(item.srcID));
            this.uploadFromUrl(saveUrls.map(url => ({
                kind: 'string',
                getAsString: (callback) => { callback(url); }
            })));
        }
    },
    uploadFromUrl(items) {
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'string') {
                items[i].getAsString((text) => {
                    /*
                     * v2.5.0：剪贴板字符串同样改为「脏文本自动提取 URL」——
                     * 复制到的内容带有文案/表情/HTML 时也能挑出链接；若文本是
                     * 视频播放页（B 站 / 知乎 / og:video 页面等），后端 fetchRes
                     * 会自动解析出真实视频地址再回传字节流。
                     * v2.8.2：拉取逻辑抽到 fetchRemoteFile（转存按钮共用）。
                     */
                    const extractedUrls = extractUrlsFromText(text);
                    for (let ui = 0; ui < extractedUrls.length; ui++) {
                        const pastedUrl = extractedUrls[ui];
                        this.fetchRemoteFile(pastedUrl, Date.now() + i * 10000 + ui)
                            .then((payload) => {
                                if (payload.kind === 'staged') {
                                    // 大文件已暂存服务端：入列等待用户点「上传」
                                    this.fileList.push({
                                        uid: this.createLocalUid(),
                                        name: payload.name,
                                        rawFile: null,
                                        stagedId: payload.stagingId,
                                        originalSize: payload.size,
                                        size: payload.size,
                                        url: payload.sourceUrl || '',
                                        finalURL: '', mdURL: '', htmlURL: '', ubbURL: '',
                                        srcID: pastedUrl,
                                        status: 'waiting',
                                        progreess: 0,
                                        editableName: true,
                                        serverCompress: this.customerCompress && !String(payload.mime || '').startsWith('image/'),
                                        uploadFolder: this.uploadFolder,
                                        retryCount: 0,
                                        compressing: false,
                                        isStaged: true,
                                    });
                                    this.$message({ type: 'info', message: this.$t('upload.pasteStagedHint') });
                                    return;
                                }
                                const file = payload.file;
                                // 接收beforeUpload的Promise对象
                                const checkResult = this.beforeUpload(file);
                                if (checkResult instanceof Promise) {
                                    checkResult.then((newFile) => {
                                        if (newFile instanceof File) {
                                            this.uploadFile({ file: newFile,
                                                onProgress: (evt) => this.handleProgress(evt),
                                                onSuccess: (response, file) => this.handleSuccess(response, file),
                                                onError: (error, file) => this.handleError(error, file) });
                                        }
                                    }).catch((err) => {
                                        console.log(err);
                                    });
                                }
                            })
                            .catch(async (error) => this.warnUrlRequestFailed(error));
                    }
                });
            }
        }
    },
    /**
     * v2.8.2：远端链接拉取为 File（转存按钮与剪贴板流程共用）。
     * 成功 resolve(File)；失败 reject(Error(detail))，detail 已解出后端 JSON 错误信息。
     */
    fetchRemoteFile(pastedUrl, uidSeed) {
        // v3.0.0：链接转存（服务端拉取/暂存）同样带上当前实例 ID（'' = 默认实例）
        return axios.post('/api/fetchRes?instanceId=' + encodeURIComponent(this.getCurrentInstanceId()), { url: pastedUrl }, {
            responseType: 'blob',
            withAuthCode: true
        }).then(async response => {
            // 兼容 200/201：NestJS 的 POST 默认返回 201，判定过窄会误报「URL地址请求失败」
            if (response.status !== 200 && response.status !== 201) {
                throw new Error(`HTTP ${response.status}`);
            }
            // v2.8.3：大文件/音视频由后端直接暂存到磁盘，这里收到的是 JSON（stagingId）
            const contentType = String(response.headers['content-type'] || '');
            if (contentType.includes('application/json')) {
                let payload = null;
                try {
                    payload = JSON.parse(await response.data.text());
                } catch (e) {
                    throw new Error('转存返回了无法解析的响应');
                }
                if (!payload || !payload.success) {
                    throw new Error((payload && payload.message) || '拉取失败');
                }
                if (!payload.staged) throw new Error((payload && payload.message) || '拉取失败');
                return {
                    kind: 'staged',
                    stagingId: payload.stagingId,
                    name: payload.name,
                    size: payload.size,
                    mime: payload.mime,
                    sourceUrl: pastedUrl
                };
            }
            let fileName = '';
            // 提取文件名
            const disposition = response.headers['content-disposition'];
            if (disposition) {
                const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                const filenameStarRegex = /filename\*\s*=\s*UTF-8''([^;\n]*)/; // 处理 filename*

                let matches = filenameRegex.exec(disposition);
                if (matches != null && matches[1]) {
                    fileName = matches[1].replace(/['"]/g, '');
                    // 尝试解码
                    try {
                        fileName = decodeURIComponent(fileName);
                    } catch (e) {
                        fileName = '';
                    }
                }
                if (fileName === '') {
                    matches = filenameStarRegex.exec(disposition); // 匹配 filename*
                    if (matches != null && matches[1]) {
                        fileName = decodeURIComponent(matches[1]);
                    }
                }
            }
            // 尝试从URL中提取文件名
            if (fileName === '') {
                const url = new URL(pastedUrl);
                fileName = url.pathname.split('/').pop();
            }
            // 未提取到文件名，使用默认文件名
            if (fileName === '') {
                const url = new URL(pastedUrl);
                let extension = url.pathname.split('.').pop();
                // 未能从URL提取有效后缀，使用bin作为默认后缀
                if (!extension || extension === '' || extension.length > 10) {
                    extension = 'bin';
                }
                fileName = 'PastedFile' + Date.now() + '.' + extension;
            }
            const blob = response.data;
            const file = new File([blob], fileName, { type: blob.type });
            // uid 唯一性：一次粘贴提取出多条链接时由调用方传入偏移种子
            file.uid = uidSeed;
            return { kind: 'file', file };
        }).catch(async (error) => {
            if (error instanceof Error && /^HTTP /.test(error.message)) throw error;
            // 失败时后端返回的是 JSON 错误体；响应类型为 blob，需先解出文本再抛出
            let detail = error?.response?.status ? `HTTP ${error.response.status}` : (error?.message || '');
            const data = error?.response?.data;
            if (data instanceof Blob) {
                try {
                    const j = JSON.parse(await data.text());
                    if (j && j.message) detail = j.message;
                } catch (e) {
                    /* 非 JSON 响应体，保持原提示 */
                }
            }
            throw new Error(detail);
        });
    },
    warnUrlRequestFailed(error) {
        const detail = error instanceof Error ? error.message : String(error || '');
        this.$message({
            type: 'warning',
            message: detail
                ? `${this.$t('uploadForm.urlRequestFailed')}：${detail}`
                : this.$t('uploadForm.urlRequestFailed')
        });
    },
    handleScroll(event) {
        this.listScrolled = event.scrollTop > 0 && this.fileList.length > 0
    },
    retryError() {
        if (!this.exceptionList.length) {
            this.$message({
                type: 'info',
                message: this.$t('uploadForm.noFailedFiles')
            })
            return
        }
        // 手动重试：取消已排定的自动轮次，立刻用最新上传参数重来一轮
        if (this.roundTimer) {
            clearTimeout(this.roundTimer)
            this.roundTimer = null
        }
        this.retryRound = 0
        this.refreshUploadParams().finally(() => this.startRetryRound())
    },
    handleAutoRetryChange(val) {
        this.$message({
            type: val ? 'success' : 'info',
            message: val ? this.$t('uploadForm.autoRetryOn') : this.$t('uploadForm.autoRetryOff')
        });
        
        if (val) {
            // 打开开关时，如果已经有失败文件就立刻开始循环重试
            if (this.exceptionList.length > 0) this.maybeStartRetryRound()
        } else {
            // 关闭开关：停掉已排定的下一轮
            if (this.roundTimer) {
                clearTimeout(this.roundTimer)
                this.roundTimer = null
            }
            this.retryLoopActive = false
        }
    },
    /**
     * 将图片转换为 WebP 格式。
     * v3.0.0：新增 mode 参数 ——
     *   'lossless' 无损转换：quality = 1（canvas.toBlob('image/webp', 1)，画质不变）；
     *   'lossy'    有损压缩：quality ≈ 0.8（沿用现有压缩质量思路，体积更小）。
     * 其余取值按 lossless 处理。
     */
    async convertImageToWebp(file, mode = 'lossless') {
        const webpQuality = mode === 'lossy' ? 0.8 : 1
        return new Promise((resolve, reject) => {
            // 不支持转换的格式直接返回 null
            if (file.type.includes('gif') || file.type.includes('svg') || file.type.includes('webp')) {
                resolve(null)
                return
            }
            
            const img = new Image()
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')
            
            img.onload = () => {
                canvas.width = img.width
                canvas.height = img.height
                ctx.drawImage(img, 0, 0)
                
                canvas.toBlob((blob) => {
                    if (blob) {
                        // 修改文件名：将原扩展名替换为 .webp
                        const originalName = file.name
                        const lastDotIndex = originalName.lastIndexOf('.')
                        const newName = lastDotIndex > 0 
                            ? originalName.substring(0, lastDotIndex) + '.webp'
                            : originalName + '.webp'
                        
                        const webpFile = new File([blob], newName, { type: 'image/webp' })
                        webpFile.uid = file.uid
                        this.copyUploadPath(file, webpFile)
                        resolve(webpFile)
                    } else {
                        reject(new Error('WebP 转换失败'))
                    }
                    
                    // 清理
                    URL.revokeObjectURL(img.src)
                }, 'image/webp', webpQuality) // v3.0.0：无损=1 / 有损=0.8
            }
            
            img.onerror = () => {
                URL.revokeObjectURL(img.src)
                reject(new Error(this.$t('uploadForm.imageLoadFailed')))
            }
            
            img.src = URL.createObjectURL(file)
        })
    },
    // 拖拽上传卡片鼠标移动事件 - 悬浮光斑效果
    handleUploadCardMouseMove(e) {
        const glow = this.$refs.uploadCardGlow;
        if (!glow) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        glow.style.opacity = '1';
        glow.style.left = x + 'px';
        glow.style.top = y + 'px';
    },
    // 拖拽上传卡片鼠标离开事件
    handleUploadCardMouseLeave() {
        const glow = this.$refs.uploadCardGlow;
        if (!glow) return;
        glow.style.opacity = '0';
    },
},
beforeDestroy() {
    // 清理定时器
    if (this.retryTimer) {
        clearTimeout(this.retryTimer);
    }
    if (this.roundTimer) {
        clearTimeout(this.roundTimer);
    }
}
}
</script>

<style scoped> 
@property --border-angle {
    syntax: '<angle>';
    initial-value: 0deg;
    inherits: false;
}

@keyframes borderRotate {
    0% {
        --border-angle: 0deg;
    }
    100% {
        --border-angle: 360deg;
    }
}
.upload-form {
    --upload-card-height: 45vh;
    --upload-card-busy-height: 17vh;
    --upload-list-height: 7vh;
    /* v20261028：列表区最小收缩高度 = 顶行功能栏的高度下限。
       空列表卡片固定 7vh，在矮视口（手机 / 矮窗口）下会小于顶栏的 44/52px 下限，
       导致顶行功能栏被 overflow:hidden 裁掉 —— 卡片一律不得矮于顶栏。 */
    --upload-list-min: max(var(--upload-list-height), 44px);
    --upload-list-inner-height: var(--upload-list-height);
    /* 列表区封顶高度（滚动阈值）：默认 58vh 兜底；
       JS 会按「头部 + 3 个条目」实测后覆盖（--upload-list-max-h），
       JS 完全失效时也只影响封顶精确度，不影响内容可见（height:auto 由内容撑开）。 */
    --upload-list-max-h: 58vh;
    /* 收缩态铺满视口时，顶部（Logo / 标题 / 默认·链接标签页）与底部页脚的预留高度。
       调大 = 列表区整体变矮、离页脚更远；调小 = 列表区更高、更贴近页脚。 */
    --upload-home-reserved: 200px;
    --upload-list-gap: 10px;
    --upload-list-radius: 15px;
    --upload-card-vertical-padding: 40px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    height: calc(var(--upload-card-height) + var(--upload-list-min) + var(--upload-list-gap) + var(--upload-card-vertical-padding));
}
/* 有文件（列表展开）：外层不再用视口高度硬撑，改由内容自然撑开。
   （v2.0.0：不再用 :has() —— 部分浏览器不支持导致 PC 端列表区被裁；
   改为组件根 class 绑定，所有浏览器行为一致。） */
.upload-form.upload-form-busy {
    height: auto;
}
/* 列表卡片：高度 = 内容自适应；滚动条由内部 el-scrollbar 的 max-height 触发。
   v20261028：min-height 不再覆盖基础规则 —— 两种状态共用「不得矮于顶行功能栏」的下限 */
.upload-list-card.upload-list-busy {
    flex: 0 0 auto;
    height: auto;
}
.upload-list-card {
    width: 55vw;
    height: var(--upload-list-height);
    min-height: var(--upload-list-min);
    margin-top: var(--upload-list-gap);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-radius: var(--upload-list-radius);
    background-color: var(--glass-bg) !important;
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow) !important;
    transition: height 0.3s ease;
    overflow: hidden;
}

/* 默认模式底部操作行（自动上传开关 / 手动上传按钮）：
   与「链接」模式的 paste-card-actions 同构 —— 位于虚线卡片内部底部，
   开关在右下角（转存/外链 的方位），手动上传按钮在左下角（上传 的方位）。
   position+z-index：保证操作行永远压在拖拽区之上 —— 列表区有文件、卡片收缩时
   拖拽区的内容可能外溢，不能让它盖住按钮把点击吞掉（点了变成弹文件选择框）。 */
.default-upload-actions {
    position: relative;
    z-index: 5;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    width: 50vw;
    max-width: 100%;
    box-sizing: border-box;
    margin-top: 16px;
}
/* 手动上传按钮：对齐链接模式左下角的「上传」按钮（右侧留给自动上传开关） */
.default-upload-actions .manual-upload-button {
    margin-right: auto;
    height: 38px;
    min-width: 92px;
    padding: 0 18px;
    border-radius: 10px !important;
    font-size: 14px;
    font-weight: 600;
}
.default-upload-actions .manual-upload-icon {
    margin-right: 6px;
}
/* 自动上传开关：套一层与 转存/外链 分段控件同款的玻璃胶囊，视觉方位一致 */
.default-upload-switch {
    height: 38px;
    box-sizing: border-box;
    padding: 3px 12px 3px 14px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
}
/* 开关只保留右侧单一文案（开启/关闭都显示「自动」） */
.auto-upload-switch-label {
    font-size: 13px;
    line-height: 1;
    color: var(--text-color-secondary, #666);
    white-space: nowrap;
    /* 文案本身也是开关热区（点击可切换），必须给出手型光标 */
    cursor: pointer;
    user-select: none;
}
/* 有文件（列表展开）时整体收缩，操作行间距同步压缩（与 paste-card-actions 的 busy 态一致） */
.upload-card-busy .default-upload-actions {
    margin-top: 10px;
    gap: 10px;
}
.upload-card-busy .default-upload-actions .manual-upload-button,
.upload-card-busy .default-upload-switch {
    height: 32px;
}
@media (max-width: 768px) {
    .default-upload-actions {
        margin-top: 6px;
        gap: 8px;
    }
    .default-upload-actions .manual-upload-button {
        height: 30px;
        min-width: 60px;
        padding: 0 12px;
        font-size: 12px;
        border-radius: 8px !important;
    }
    .default-upload-switch {
        height: 30px;
        padding: 2px 10px 2px 12px;
    }
    .default-upload-switch :deep(.el-switch__label) {
        font-size: 12px;
    }
}
.upload-list-card :deep(.el-card__body) {
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
}
.upload-list-container {
    width: 100%;
    height: 100%;
    overflow: hidden;
}
@media (max-width: 768px) {
    /* v20261028：手机端顶行功能栏下限 52px（与 .upload-list-dashboard 移动端下限一致），
       空列表卡片固定 7vh 在矮视口下会裁掉顶栏 —— 卡片最小高度跟顶栏对齐 */
    .upload-form {
        --upload-list-min: max(var(--upload-list-height), 52px);
    }
    .upload-list-card {
        width: 70vw;
    }
}
.upload-list-card.upload-list-busy {
    height: auto;
}

/* busy 态滚动控制：内容 ≤ 封顶值时卡片由内容撑开（自适应）；
   超过封顶值（≈3 个条目）时 el-scrollbar 内部出滚动条。
   max-height 挂在 wrap 上 —— el-scrollbar 的 height:100% 在 height:auto 父级里
   无法建立滚动约束，必须直接约束 wrap。 */
.upload-form .upload-list-card.upload-list-busy :deep(.el-scrollbar) {
    height: auto;
}
.upload-form .upload-list-card.upload-list-busy :deep(.el-scrollbar__wrap) {
    max-height: var(--upload-list-max-h);
}

.upload-list-card:not(.upload-list-busy) :deep(.el-scrollbar__view) {
    height: 100%;
}

/* 拖拽上传卡片包装器 - 用于悬浮光斑效果 */
.upload-card-wrapper {
    position: relative;
    overflow: visible;
}

.folder-upload-input {
    display: none;
}

.clipboard-paste-receiver {
    position: fixed;
    top: 0;
    left: -9999px;
    width: 1px;
    height: 1px;
    padding: 0;
    border: 0;
    opacity: 0;
    pointer-events: none;
}

.upload-prompt-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    max-width: calc(100% - 24px);
    min-width: 0;
}

.folder-upload-icon-button {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    box-sizing: border-box;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-secondary);
    line-height: 1;
    cursor: pointer;
    transition: color 0.2s ease, background-color 0.2s ease;
}

.folder-upload-icon-button :deep(svg) {
    display: block;
    width: 15px;
    height: 15px;
    transform: translateY(1px);
}

.folder-upload-icon-button:hover {
    color: var(--primary-color-accent);
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
}

.folder-upload-icon-button:focus-visible {
    outline: none;
    color: var(--primary-color-accent);
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
}

.folder-upload-icon-button.upload-list-busy {
    width: 24px;
    height: 24px;
    border-radius: 7px;
}

.folder-upload-icon-button.upload-list-busy :deep(svg) {
    width: 13px;
    height: 13px;
}

@media (max-width: 768px) {
    .upload-prompt-row {
        gap: 2px;
        max-width: calc(100% - 12px);
    }

    .folder-upload-icon-button {
        width: 22px;
        height: 22px;
        border-radius: 6px;
    }

    .folder-upload-icon-button.upload-list-busy {
        width: 20px;
        height: 20px;
    }

    .folder-upload-icon-button :deep(svg) {
        width: 12px;
        height: 12px;
        transform: none;
    }

    .folder-upload-icon-button.upload-list-busy :deep(svg) {
        width: 11px;
        height: 11px;
    }
}

/* 悬浮光斑效果 */
.upload-card-glow {
    position: absolute;
    width: 200px;
    height: 200px;
    border-radius: 50%;
    background: var(--upload-card-hover-glow-bg);
    pointer-events: none;
    transform: translate(-50%, -50%);
    opacity: 0;
    transition: opacity 0.3s ease;
    z-index: 10;
}

.upload-card {
    width: 55vw;
    padding: 20px;
    background: none;
}
@media (max-width: 768px) {
    .upload-card {
        width: 70vw;
    }
}
/* ============================================================
   默认模式：尺寸 / 定位 / 距离 完全照抄「链接」模式
   ─ 外层 .upload-card      ↔ 链接模式外层大框（55vw + 20px 内边距）
   ─ 内层 .default-card      ↔ .paste-card（45vh 虚线卡片・glass 底）
   ─ .default-upload-dragger ↔ .upload-card-textarea（50vw × 70%，busy 收缩 50%）
   ─ .default-upload-actions ↔ .paste-card-actions（margin-top 16px，右下角方位）
   两种模式的内容组（70% 输入/拖拽区 + 16px 间距 + 操作行）结构逐项相同，
   均由卡片 justify-content:center 垂直居中，因此高度、比例、间距、方位完全一致。
   ============================================================ */
.default-card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    height: var(--upload-card-height);
    border-radius: 15px;
    border: var(--el-upload-dragger-border);
    box-shadow: none;
    opacity: 0.7;
    background-color: var(--el-upload-dragger-bg-color);
    transition: all 0.3s ease;
    box-sizing: border-box;
    position: relative;
}
.default-card:hover {
    opacity: 0.8;
    box-shadow: var(--el-upload-dragger-hover-box-shadow);
}
/* 有文件（列表展开）时卡片整体收缩，与链接模式的 .upload-card-busy.paste-card 对齐。
   v2.8.0：vh 高度在移动端软键盘弹出（视口骤缩）时会把卡片压得失真，加 px 兜底。
   v2.8.5：最小收缩高度 150 → 135（下调 10%），内容超出时区域内部滚动。 */
.upload-card-busy.default-card {
    height: var(--upload-card-busy-height);
    min-height: 135px;
    overflow-y: auto;
}

/* 上传时的边缘流光旋转效果（与 .paste-card.is-uploading 完全一致） */
.default-card.is-uploading {
    border-color: transparent !important;
    overflow: visible;
}
.default-card.is-uploading::before {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 15px;
    padding: 2px;
    background: conic-gradient(
        from var(--border-angle),
        transparent 0deg,
        transparent 30deg,
        var(--upload-card-effect-color, #2563EB) 60deg,
        var(--upload-card-effect-highlight-color, color-mix(in srgb, var(--upload-card-effect-color, #2563EB) 70%, white)) 90deg,
        transparent 120deg,
        transparent 180deg,
        var(--upload-card-effect-highlight-color, color-mix(in srgb, var(--upload-card-effect-color, #2563EB) 70%, white)) 210deg,
        var(--upload-card-effect-color, #2563EB) 240deg,
        transparent 270deg,
        transparent 360deg
    );
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask-composite: exclude;
    animation: borderRotate 2s linear infinite;
    pointer-events: none;
    z-index: 1;
}

/* el-upload 根节点：与链接模式的 .upload-card-textarea 完全同构 ——
   固定占卡片高度的 70%（busy 收缩态 50%），随内容组一起被 .default-card 的
   justify-content:center 垂直居中。不再用 flex:1 撑满剩余空间：
   之前拖拽区「70% × 剩余空间」导致它比链接模式输入框矮一截，
   且与底部操作行之间多出一段空白、收缩时内容外溢盖住按钮。
   min-height:0 + overflow:hidden 把拖拽区外溢内容裁在自身区域内。 */
.default-upload-dragger {
    flex: 0 0 auto;
    height: 70%;
    min-height: 0;
    width: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
}
/* 有文件（列表展开）时收缩到 50%，与 .upload-card-busy .upload-card-textarea 一致 */
.upload-card-busy .default-upload-dragger {
    height: 50%;
}
/* 收缩态隐去左右边框：卡片压矮后拖拽区两侧只剩两条竖线，视觉上很突兀（上下边框本就不可见）。
   hover 规则会重设 border-color，这里用更具体的选择器一并压住，避免鼠标经过时又冒出来。 */
.upload-card-busy .default-upload-dragger :deep(.el-upload-dragger),
.upload-card-busy .default-upload-dragger :deep(.el-upload-dragger:hover) {
    border-left-color: transparent;
    border-right-color: transparent;
}
/* 拖拽区本体：尺寸 / 圆角 / 底色对齐链接模式的输入框（宽度沿用原写法 50vw） */
:deep(.el-upload-dragger)  {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    width: 50vw;
    height: 100%;
    border-radius: 16px;
    background: color-mix(in srgb, var(--primary-color) 4%, var(--glass-bg));
    border: 1px solid var(--glass-border);
    box-shadow: none;
    box-sizing: border-box;
    overflow: hidden;
    transition: height 0.3s ease, background-color 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
}
/* 悬停 / 拖入高亮只调边框与底色，不再改透明度 —— 透明度由外层 .default-card 统一控制 */
:deep(.el-upload-dragger:hover) {
    background: color-mix(in srgb, var(--primary-color) 6%, var(--glass-bg));
    border-color: var(--glass-border-hover);
    box-shadow: none;
}
:deep(.el-upload-dragger.is-dragover) {
    background: color-mix(in srgb, var(--primary-color) 7%, var(--glass-bg));
    border-color: color-mix(in srgb, var(--primary-color) 45%, var(--glass-border));
    box-shadow: none;
}
.is-uploading :deep(.el-upload-dragger) {
    border-color: transparent !important;
}

.el-upload__text {
    font-weight: bold;
    font-size: medium;
    user-select: none;
    transition: all 0.3s ease;
}
.el-upload__text.upload-list-busy {
    font-size: small;
}
@media (max-width: 768px) {
    .el-upload__text,
    .el-upload__text.upload-list-busy {
        font-size: 12px;
    }
}
.el-icon--upload {
    font-size: 100px;
    transition: font-size 0.3s ease;
    color: #60A5FA;
}
html.dark .el-icon--upload {
    color: #6B6B73;
}
.el-upload__text :deep(em) {
    color: #1D4ED8;
}
html.dark .el-upload__text :deep(em) {
    color: #93C5FD;
}
/* 收缩态（列表有文件）隐藏 "+"：卡片只剩一半高，"+" 挤在里面显得溢出；
   展开时正常显示，与链接模式收缩态只有小号输入框的观感一致 */
.el-icon--upload.upload-list-busy {
    display: none;
}
@media (max-width: 768px) {
    .el-icon--upload {
        font-size: 50px;
    }
}

.paste-card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    height: var(--upload-card-height);
    border-radius: 15px;
    border: var(--el-upload-dragger-border);
    box-shadow: none;
    opacity: 0.7;
    background-color: var(--el-upload-dragger-bg-color);
    transition: all 0.3s ease;
    box-sizing: border-box;
}
.paste-card:hover {
    opacity: 0.8;
    box-shadow: var(--el-upload-dragger-hover-box-shadow);
}

/* 粘贴卡片上传时的边缘流光效果 */
.paste-card.is-uploading {
    position: relative;
    border-color: transparent !important;
    overflow: visible;
}

.paste-card.is-uploading::before {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 15px;
    padding: 2px;
    background: conic-gradient(
        from var(--border-angle),
        transparent 0deg,
        transparent 30deg,
        var(--upload-card-effect-color, #2563EB) 60deg,
        var(--upload-card-effect-highlight-color, color-mix(in srgb, var(--upload-card-effect-color, #2563EB) 70%, white)) 90deg,
        transparent 120deg,
        transparent 180deg,
        var(--upload-card-effect-highlight-color, color-mix(in srgb, var(--upload-card-effect-color, #2563EB) 70%, white)) 210deg,
        var(--upload-card-effect-color, #2563EB) 240deg,
        transparent 270deg,
        transparent 360deg
    );
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask-composite: exclude;
    animation: borderRotate 2s linear infinite;
    pointer-events: none;
    z-index: 1;
}

.paste-card :deep(.el-card__body) {
    padding: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}
.upload-card-busy.paste-card {
    /* v20261028：固定 17vh + overflow-y:auto 会把「输入框 96px 下限 + 按钮行」裁出
       滚动条/切边（17vh < 内容高时）。改为 height:auto 由内容撑开：收缩效果靠
       min-height 17vh 保留，任何视口下都不出现内部滚动条、不遮挡输入框和按钮。 */
    height: auto;
    min-height: var(--upload-card-busy-height);
    overflow: visible;
}
.upload-card-textarea {
    width: 50vw;
    height: 70%;
    border-radius: 16px;
    background: color-mix(in srgb, var(--primary-color) 4%, var(--glass-bg));
    /* v2.8.6b：边框改由 ::after 覆盖层绘制 —— 收缩态下 1px 实体边框的顶边
       会被合成层吞掉显示不出来（左右/下正常）；::after 绝对定位 + z-index
       恒在最上层，配合 top:2px 让四条边任意状态都可见（见下方说明） */
    box-shadow: none;
    transition: background-color 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
    box-sizing: border-box;
    display: flex;
    position: relative;
    overflow: hidden;
}
.upload-card-textarea::after {
    content: '';
    position: absolute;
    /* top:2px —— 收缩态下该区域的合成层会把顶部 0~2px 的绘制吞掉
       （wrapper 边框/outline/::after 顶边均不可见，实测偏移），
       顶边线下移 2px 即稳定显示；其余三边正常贴边 */
    top: 2px;
    right: 0;
    bottom: 0;
    left: 0;
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    box-sizing: border-box;
    pointer-events: none;
    z-index: 2;
    transition: border-color 0.22s ease;
}
.upload-card-busy .upload-card-textarea {
    /* v20261028：50% + min 96px 在矮卡里会裁掉 rows=4 的内层输入框上下边框；
       改为高度跟随内层内容（rows=4），卡片随内容撑开，永不再裁 */
    height: auto;
    min-height: 96px;
}

.upload-card-textarea:hover {
    background: color-mix(in srgb, var(--primary-color) 6%, var(--glass-bg));
}
.upload-card-textarea:hover::after {
    border-color: var(--glass-border-hover);
}

.upload-card-textarea:focus-within {
    background: color-mix(in srgb, var(--primary-color) 7%, var(--glass-bg));
}
.upload-card-textarea:focus-within::after {
    border-color: color-mix(in srgb, var(--primary-color) 45%, var(--glass-border));
}

.upload-card-textarea :deep(.el-textarea__inner) {
    border-radius: 16px;
    background: transparent;
    transition: color 0.2s ease, background-color 0.2s ease;
    resize: none;
    border: none;
    box-shadow: none !important;
    padding: 16px 20px;
    font-size: 14px;
    line-height: 1.6;
    color: var(--el-text-color-primary);
}

.upload-card-textarea :deep(.el-textarea__inner::placeholder) {
    color: var(--el-text-color-placeholder);
    font-weight: 400;
    opacity: 0.7;
}

.upload-card-textarea :deep(.el-textarea__inner:focus) {
    background: transparent;
    box-shadow: none !important;
}

/* Modern Scrollbar Styles */
.upload-card-textarea ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}

.upload-card-textarea ::-webkit-scrollbar-track {
    background: transparent;
    border-radius: 6px;
    margin: 8px;
}

.upload-card-textarea ::-webkit-scrollbar-thumb {
    background: rgba(37, 99, 235, 0.5);
    border-radius: 6px;
    transition: background 0.3s ease;
}

.upload-card-textarea ::-webkit-scrollbar-thumb:hover {
    background: rgba(37, 99, 235, 0.7);
}
.paste-card-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: nowrap;
    width: 50vw;
    max-width: 100%;
    box-sizing: border-box;
    gap: 12px;
    margin-top: 16px;
}

/* 粘贴上传操作区：延续全站克制的主题按钮风格 */
.paste-card-upload-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-width: 92px;
    height: 38px;
    padding: 0 18px;
    border-radius: 10px !important;
    font-weight: 600;
    font-size: 14px;
    line-height: 1;
    letter-spacing: 0.04em;
    white-space: nowrap;
    cursor: pointer;
    color: var(--primary-color-accent, var(--el-color-primary)) !important;
    background: color-mix(in srgb, var(--primary-color, #2563EB) 10%, transparent) !important;
    border: 1px solid color-mix(in srgb, var(--primary-color, #2563EB) 36%, var(--glass-border, rgba(128, 128, 128, 0.25))) !important;
    box-shadow: none;
    transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease !important;
}

.paste-card-upload-button:hover {
    color: var(--primary-color-accent, var(--el-color-primary)) !important;
    background: color-mix(in srgb, var(--primary-color, #2563EB) 14%, transparent) !important;
    border-color: color-mix(in srgb, var(--primary-color, #2563EB) 52%, var(--glass-border, rgba(128, 128, 128, 0.25))) !important;
    transform: translateY(-1px);
    box-shadow: none;
}

.paste-card-upload-button:focus-visible {
    color: var(--primary-color-accent, var(--el-color-primary)) !important;
    background: color-mix(in srgb, var(--primary-color, #2563EB) 14%, transparent) !important;
    border-color: color-mix(in srgb, var(--primary-color, #2563EB) 52%, var(--glass-border, rgba(128, 128, 128, 0.25))) !important;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color, #2563EB) 14%, transparent) !important;
}

.paste-card-upload-button:active {
    transform: translateY(0);
    background: color-mix(in srgb, var(--primary-color, #2563EB) 18%, transparent) !important;
}

.paste-card-upload-button.is-disabled,
.paste-card-upload-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none !important;
}

/* 上传状态下缩小按钮 */
.upload-card-busy .paste-card-upload-button {
    min-width: 72px;
    height: 32px;
    border-radius: 8px !important;
    font-size: 13px;
    letter-spacing: 0.02em;
}

/* v2.8.2：外链模式下「上传」按钮隐藏但保留占位 —— 转存/外链模块不因上传按钮消失而左移 */
.paste-card-start-button.is-hidden {
    visibility: hidden;
    pointer-events: none;
}

/* v2.8.2：转存 / 外链两个独立按钮（去掉分段模块外壳，与上传按钮同款风格） */
.paste-card-method-btns {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    gap: 8px;
}

.paste-card-method-btn {
    /* 未激活：与上传按钮同底色；激活：填充主题色以示当前通道 */
    background: color-mix(in srgb, var(--primary-color, #2563EB) 10%, transparent) !important;
}

/* v2.8.5：点击「转存 / 外链」后不再填充主题色底（去掉点击背景色），
   保持与未点击时一致的基础外观，仅保留极轻的边框强调 */
.paste-card-method-btn.is-active,
.paste-card-method-btn.is-active:hover,
.paste-card-method-btn:active {
    color: var(--primary-color-accent, var(--el-color-primary)) !important;
    background: color-mix(in srgb, var(--primary-color, #2563EB) 10%, transparent) !important;
    border-color: color-mix(in srgb, var(--primary-color, #2563EB) 52%, var(--glass-border, rgba(128, 128, 128, 0.25))) !important;
}
.paste-card-method-btn:active {
    transform: translateY(0) !important;
}

.upload-card-busy .paste-card-method-btns {
    gap: 6px;
}

.upload-card-busy .paste-card-actions {
    margin-top: 10px;
}

/* 转存 / 外链分段选择（v2.8.2 起弃用，保留样式避免历史回退误伤；新布局见下方 method-btns） */
.paste-card-method-group {
    position: relative;
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    width: 158px;
    height: 38px;
    box-sizing: border-box;
    gap: 2px;
    padding: 3px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    overflow: hidden;
    user-select: none;
}

.paste-card-method-group::before {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: calc((100% - 8px) / 2);
    height: calc(100% - 6px);
    border-radius: 7px;
    background: color-mix(in srgb, var(--primary-color, #2563EB) 14%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color, #2563EB) 42%, var(--glass-border, rgba(128, 128, 128, 0.25))) inset;
    transform: translateX(0);
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: none;
}

.paste-card-method-group.is-external::before {
    transform: translateX(calc(100% + 2px));
}

.paste-card-method-button {
    position: relative;
    z-index: 1;
    display: inline-flex;
    flex: 1 1 0;
    align-items: center;
    justify-content: center;
    min-width: 0;
    height: 30px;
    box-sizing: border-box;
    padding: 0 14px;
    margin: 0;
    border: none;
    border-radius: 7px;
    outline: none;
    background: transparent;
    font-family: inherit;
    font-weight: 500;
    font-size: 13px;
    line-height: 1;
    white-space: nowrap;
    color: var(--el-text-color-secondary, var(--upload-text-color, #6b7280));
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    /* 三按钮（上传 / 转存 / 外链）统一动效：颜色、位移、底色、焦点环都参与过渡 */
    transition:
        color 0.2s ease,
        background-color 0.2s ease,
        transform 0.18s cubic-bezier(0.4, 0, 0.2, 1),
        box-shadow 0.2s ease;
}

.paste-card-method-button:hover {
    color: var(--primary-color-accent, var(--el-color-primary));
    background: color-mix(in srgb, var(--primary-color, #2563EB) 8%, transparent);
    transform: translateY(-1px);
}

.paste-card-method-button:active {
    transform: translateY(1px) scale(0.98);
    background: color-mix(in srgb, var(--primary-color, #2563EB) 16%, transparent);
    transition-duration: 0.08s;
}

/* 选中态：PC 端此前只有 hover / 按下的瞬时反馈，等鼠标移开就看不出「当前选的是哪个」；
   这里把选中底色固定下来并加深一档，PC 与移动端（触摸时）观感一致。 */
.paste-card-method-button.is-active {
    font-weight: 600;
    color: var(--primary-color-accent, var(--el-color-primary));
    background: color-mix(in srgb, var(--primary-color, #2563EB) 16%, transparent);
    box-shadow:
        inset 0 0 0 1px color-mix(in srgb, var(--primary-color, #2563EB) 24%, var(--glass-border, rgba(128, 128, 128, 0.25))),
        0 1px 6px color-mix(in srgb, var(--primary-color, #2563EB) 16%, transparent);
    /* 切换时轻微「弹」一下，滑块位移与文字高亮同步 */
    animation: pasteMethodPop 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* 选中的按钮在鼠标悬停时继续加深，避免被 hover 的浅底色冲淡 */
.paste-card-method-button.is-active:hover {
    background: color-mix(in srgb, var(--primary-color, #2563EB) 22%, transparent);
    color: var(--primary-color-accent, var(--el-color-primary));
}

@keyframes pasteMethodPop {
    0% { transform: scale(0.94); }
    60% { transform: scale(1.03); }
    100% { transform: scale(1); }
}

.paste-card-method-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-color, #2563EB) 28%, transparent);
    color: var(--primary-color-accent, var(--el-color-primary));
}

/* Mobile responsive for paste card */
@media (max-width: 768px) {
    .paste-card {
        height: var(--upload-card-height);
        min-height: 0;
        max-height: var(--upload-card-height);
        padding: 6px;
        border-radius: 12px;
    }

    .upload-card-busy.paste-card {
        height: var(--upload-card-busy-height);
        /* v2.8.2：收缩下限与「文件」模式外层区域一致（原 min-height:0 会被软键盘压没）
           v2.8.5：150 → 135（与文件模式同步下调 10%） */
        min-height: 135px;
        max-height: var(--upload-card-busy-height);
        padding: 5px;
    }

    .upload-card-textarea {
        margin-top: 4px;
        width: calc(100% - 4px) !important;
        min-height: 0;
        flex-shrink: 1;
        /* v2.8.2：内层输入框跟随外层比例收缩，自身不产生滚动条 */
        overflow: hidden;
    }

    .upload-card-busy .upload-card-textarea {
        /* busy 收缩态：允许压到 0 由 flex 分配，按钮行 flex:0 0 auto 保住可见 */
        min-height: 0 !important;
    }

    /* v2.4.0：移动端链接模式按钮行（上传/转存/外链）居中——
       卡片固定高 + body 垂直居中会把剩余空间全堆在按钮行下方，
       看起来「贴着输入框」。改为顶对齐 + 输入框 flex 撑满，
       按钮行上方 8px（margin-top）、下方 8px（margin-bottom 2px + 卡片 padding 6px），上下对称 */
    .paste-card :deep(.el-card__body) {
        justify-content: flex-start;
    }
    .paste-card .upload-card-textarea {
        flex: 1 1 auto;
        height: auto;
    }
    .paste-card-actions {
        margin-bottom: 2px;
    }
    .upload-card-busy.paste-card .paste-card-actions {
        margin-bottom: 2px;
    }

    .upload-card-textarea :deep(.el-textarea__inner) {
        height: 100%;
        min-height: 0 !important;
        box-sizing: border-box;
        border-radius: 10px;
        padding: 8px 10px;
        font-size: 12px;
    }

    .paste-card-actions {
        flex: 0 0 auto;
        /* v2.8.5：按钮行宽对齐输入框（输入框为 calc(100% - 4px)），
           上传按钮左缘对齐输入框左边框、外链按钮右缘对齐右边框 */
        width: calc(100% - 4px) !important;
        margin-left: auto;
        margin-right: auto;
        margin-top: 8px;
        gap: 6px;
    }

    .paste-card-upload-button {
        height: 28px;
        min-width: 56px;
        border-radius: 7px !important;
        font-size: 11px;
        letter-spacing: 0.02em;
        padding: 0 10px;
    }

    .upload-card-busy .paste-card-upload-button {
        height: 28px;
        min-width: 56px;
        border-radius: 7px !important;
        font-size: 11px;
    }

    .upload-card-busy .paste-card-actions {
        margin-top: 8px;
    }

    .paste-card-method-group {
        width: 112px;
        height: 28px;
        padding: 2px;
        border-radius: 8px;
    }

    .paste-card-method-group::before {
        top: 2px;
        left: 2px;
        width: calc((100% - 6px) / 2);
        height: calc(100% - 4px);
        border-radius: 6px;
    }

    .paste-card-method-button {
        height: 22px;
        padding: 0 8px;
        font-size: 10px;
        border-radius: 6px;
    }
}

/* ============================================================
   v2.8.6：PC 收缩态（列表有文件）「链接 / 文件」两模式统一
   ─ 问题①：收缩态卡片高度由内容撑开且无内边距，输入框上边框与外层虚线上边贴在一起；
   ─ 问题②：链接模式卡高 ≈167px、文件模式卡高 = max(17vh,135px) ≈135px，
            切换模式时整块区域高度跳变。
   方案：两模式共用 --upload-card-busy-h（max(17vh,168px)）+ 12px 内边距，
   内层（输入框 / 拖拽区）一律 flex:1 撑满剩余高度 —— 高度天然一致，
   输入框与虚线框之间也留出了间隔；输入框下限约 3 行（1.6 × 14px 三行 + 上下 16px 内边距）。
   仅作用于桌面端：移动端沿用既有 135px 下限 + 5px 内边距的调优结果。
   ============================================================ */
@media (min-width: 769px) {
    .upload-form {
        /* 12 + 12 内边距 + 约 101px 输入框 + 10px 间距 + 32px 按钮行 ≈ 167 → 取整 168 */
        --upload-card-busy-h: max(var(--upload-card-busy-height), 168px);
        --upload-card-busy-padding: 12px;
    }

    .upload-card-busy.default-card,
    .upload-card-busy.paste-card {
        height: var(--upload-card-busy-h);
        min-height: 0;
        padding: var(--upload-card-busy-padding);
        overflow: hidden;
    }

    .upload-card-busy .default-upload-dragger,
    .upload-card-busy .upload-card-textarea {
        flex: 1 1 auto;
        height: auto;
        min-height: 0;
    }

    /* 输入框高度下限 ≈ 3 行可见文本，卡片再矮也不会把边框裁掉 */
    .upload-card-busy .upload-card-textarea {
        min-height: calc(3 * 1.6 * 14px + 34px);
    }

    /* 容器撑满后，内层 textarea 跟着拉伸填满（flex 默认 align-items:stretch） */
    .upload-card-busy .upload-card-textarea :deep(.el-textarea__inner) {
        height: 100%;
        min-height: 0;
        box-sizing: border-box;
    }
}

.upload-list-dashboard {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: var(--upload-list-inner-height);
    /*
     * v20261027：顶栏高度下限 = 默认（无文件）状态整卡的高度（--upload-list-height），
     * 且不允许 flex 收缩 —— 无论列表内条目多少/多挤，顶栏都不会被压到比
     * 「没有文件时」更矮（max() 兼顾极矮视口下的 44px 绝对下限）。
     */
    min-height: max(var(--upload-list-height), 44px);
    flex-shrink: 0;
    padding: 0 15px;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--glass-bg);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border: 1px solid var(--glass-border);
    border-radius: var(--upload-list-radius);
    box-shadow: var(--glass-shadow);
    opacity: 0.7;
}

/* 收缩态直接跟随卡片内容区，避免固定 vh 与边框产生亚像素误差 */
.upload-list-card:not(.upload-list-busy) .upload-list-dashboard {
    height: 100%;
}

/*
 * v2.8.5：移动端软键盘弹出时（视觉视口骤缩，7vh 会变得极小），
 * 列表顶行功能栏不再被压小 —— 保持默认加载状态的高度，压缩/复制/重试/删除完整可见。
 */
@media (max-width: 768px) {
    .upload-list-dashboard {
        min-height: 52px;
        height: auto;
        padding: 4px 10px;
    }
    .upload-list-dashboard-action {
        flex-shrink: 0;
    }
}

/* Enhanced Starry Sky Effect */
:deep(.el-upload-dragger) {
    position: relative;
    overflow: hidden;
}

/* Layer 1: Distant stars (Small, slow, dense) */
:deep(.el-upload-dragger::before) {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
        radial-gradient(2px 2px at 10% 10%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 20% 30%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 30% 10%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 40% 30%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 50% 10%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 60% 30%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 70% 10%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 80% 30%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 90% 10%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2px 2px at 15% 70%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0);
    background-size: 200px 200px;
    opacity: 0;
    z-index: 0;
    transition: opacity 0.6s ease;
}

/* Layer 2: Close stars (Larger, faster, sparse) */
:deep(.el-upload-dragger::after) {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
        radial-gradient(3px 3px at 15% 15%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(3px 3px at 50% 50%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(3px 3px at 85% 85%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2.5px 2.5px at 35% 65%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0),
        radial-gradient(2.5px 2.5px at 65% 35%, var(--upload-card-effect-color, #2563EB) 50%, transparent 0);
    background-size: 150px 150px;
    opacity: 0;
    z-index: 0;
    transition: opacity 0.6s ease;
}

.upload-card:hover :deep(.el-upload-dragger::before) {
    opacity: 0.3;
    animation: starScroll 60s linear infinite;
}

.upload-card:hover :deep(.el-upload-dragger::after) {
    opacity: 0.6;
    animation: starScroll 40s linear infinite, starPulse 4s ease-in-out infinite;
}

@keyframes starScroll {
    from { background-position: 0 0; }
    to { background-position: 100px 100px; }
}

@keyframes starPulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 0.3; }
}

/* ============================================
   Modern Action Button Group Styles
   ============================================ */
.modern-action-group {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 44px;
    box-sizing: border-box;
    padding: 5px;
    background: var(--glass-bg);
    border-radius: 12px;
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
}

.modern-action-group:hover {
    background: var(--glass-bg);
    border-color: var(--glass-border);
    box-shadow: var(--glass-shadow);
}

.modern-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border: none;
    border-radius: 13px;
    background: var(--upload-action-btn-bg);
    color: var(--upload-action-btn-color);
    cursor: pointer;
    transition: background-color 0.22s ease, color 0.22s ease, box-shadow 0.22s ease, transform 0.22s ease;
    font-size: 14px;
    box-shadow: var(--upload-action-btn-shadow);
    position: relative;
    overflow: hidden;
    outline: none !important;
}

.modern-action-btn:focus,
.modern-action-btn:focus-visible {
    outline: none !important;
}

.modern-action-btn::before {
    content: '';
    position: absolute;
    inset: 2px;
    border-radius: 11px;
    background: currentColor;
    opacity: 0;
    transition: opacity 0.22s ease;
}

.modern-action-btn:hover {
    background: var(--upload-action-btn-hover-bg);
    box-shadow: var(--upload-action-btn-hover-shadow);
}

.modern-action-btn:hover::before {
    opacity: 0.08;
}

.modern-action-btn:active {
    transform: translateY(0) scale(0.97);
    box-shadow: var(--upload-action-btn-active-shadow);
}

.modern-action-btn-copy {
    color: var(--upload-action-copy-color);
}

/* v2.9.0：文件压缩开关按钮 —— 关闭时灰色（默认操作色），开启时图标蓝色高亮。
   之前关闭态用的是 --upload-action-copy-color（= 主色，本身就是蓝色），
   开关切换时颜色几乎没变化，看起来像「配色没生效」。 */
.modern-action-btn-compress {
    color: var(--upload-action-btn-color);
}
.modern-action-btn-compress.is-active {
    color: var(--el-color-primary, #409eff);
    background: var(--el-color-primary-light-9, #ecf5ff);
}

/* v2.9.0：「转为WebP」开关按钮 —— 与文件压缩同一套配色：关闭灰、开启蓝 */
.modern-action-btn-webp {
    color: var(--upload-action-btn-color);
}
.modern-action-btn-webp.is-active {
    color: var(--el-color-primary, #409eff);
    background: var(--el-color-primary-light-9, #ecf5ff);
}

.copy-format-badge {
    position: absolute;
    right: 3px;
    bottom: 2px;
    font-size: 8px;
    font-weight: 700;
    line-height: 10px;
    pointer-events: none;
}
/* 下拉里标记「当前默认格式」 */
.copy-format-active {
    font-weight: 600;
}
.copy-format-check {
    margin-left: 6px;
    font-size: 11px;
    color: var(--el-color-primary, #409eff);
}

.modern-action-btn-retry {
    color: var(--upload-action-retry-color);
}

.modern-action-btn-danger {
    color: var(--upload-action-danger-color);
    background: var(--upload-action-danger-bg);
}

.modern-action-btn-danger:hover {
    background: var(--upload-action-danger-hover-bg);
    box-shadow: var(--upload-action-danger-hover-shadow);
}

/* Dropdown Menu Styles */
.copy-format-icon {
    width: 16px;
    margin-right: 8px;
    flex-shrink: 0;
}

.modern-dropdown-item-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 12px;
    padding: 4px 0;
}

.modern-dropdown-item-content span {
    font-weight: 500;
    color: var(--el-text-color-primary);
}

/* ============================================
   Dashboard Title Enhancement
   ============================================ */
.upload-list-dashboard-title {
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    box-sizing: border-box;
    padding: 0 14px;
    background: var(--dashboard-title-bg, rgba(37, 99, 235, 0.06));
    border: none;
    border-radius: 12px;
    color: var(--el-text-color-primary);
}

.upload-list-dashboard-title .el-icon {
    font-size: 16px;
    margin-right: 4px;
    opacity: 0.85;
}

/* ============================================
   Mobile Responsive Styles
   ============================================ */
@media (max-width: 768px) {
    .modern-action-group {
        height: 34px;
        gap: 2px;
        padding: 2px;
        border-radius: 9px;
    }

    .modern-action-btn {
        width: 28px;
        height: 28px;
        border-radius: 7px;
        font-size: 11px;
    }

    .upload-list-dashboard-title {
        height: 34px;
        font-size: 11px;
        padding: 0 7px;
        border-radius: 9px;
    }

    .upload-list-dashboard-title .el-icon {
        font-size: 13px;
        margin-right: 1px;
    }

    /* 移动端:上传列表顶栏缩窄 padding,确保完整展示不溢出 */
    .upload-list-dashboard {
        padding: 0 6px;
        gap: 4px;
        /* v2.4.0：移动端顶部栏取消粘滞，跟随列表内容一起滚动 */
        position: static;
    }
    /* 标题块可收缩,避免挤爆操作按钮 */
    .upload-list-dashboard-title {
        gap: 3px;
        min-width: 0;
        flex-shrink: 1;
        overflow: hidden;
    }
    /* 操作组保持完整不被压缩 */
    .upload-list-dashboard-action {
        flex-shrink: 0;
    }
}

/* 可用高度较小的桌面视口：让收缩列表与内部工具栏保持舒适留白。 */
@media (min-width: 769px) and (max-height: 1050px) {
    .upload-list-dashboard {
        padding: 0 12px;
    }
    .modern-action-group,
    .upload-list-dashboard-title {
        height: 34px;
    }

    .modern-action-group {
        gap: 3px;
        padding: 3px;
        border-radius: 10px;
    }

    .modern-action-btn {
        width: 28px;
        height: 28px;
        border-radius: 8px;
        font-size: 12px;
    }

    .upload-list-dashboard-title {
        padding: 0 10px;
        border-radius: 10px;
        font-size: 13px;
    }
}

/* ── v3.0.0：移动端滑动切换模式后的轻量视觉反馈（淡入一次） ── */
.swipe-fade {
    animation: swipeFadeIn 0.45s ease;
}
@keyframes swipeFadeIn {
    from { opacity: 0.35; }
    to { opacity: 1; }
}

</style>
