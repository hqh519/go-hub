<template>
    <el-dialog :title="$t('uploadSettings.title')" v-model="visible" :width="dialogWidth" class="settings-dialog settings-dialog-scope upload-settings-dialog">
        <!-- 上传渠道 -->
        <div class="dialog-section">
            <div class="section-header">
                <span class="section-title">{{ $t('uploadSettings.uploadChannel') }}</span>
                <el-tooltip :content="$t('uploadSettings.channelSelectTooltip')" placement="top" raw-content>
                    <font-awesome-icon icon="question-circle" class="section-help-icon"/>
                </el-tooltip>
            </div>
            <div class="section-content">
                <!--
                    渠道选择不再二级联动（原先「选类型 → 再选渠道」）：
                    直接用一个渠道下拉列出全部渠道，与 Token 编辑 / 用户管理编辑用户
                    共用同一个 ChannelSelect 组件。选项顶部为「默认」——
                    值为空 = 跟随全局设置（由后端 getStorageChannel 解析）。
                -->
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('uploadSettings.channelName') }}
                        <span
                            v-if="defaultChannelLabel"
                            class="default-channel-badge"
                            :title="defaultChannelLabel"
                        >{{ $t('uploadSettings.currentDefaultChannel') }}：{{ defaultChannelLabel }}</span>
                    </span>
                    <ChannelSelect
                        :key="'main-' + channelRefreshKey"
                        :model-value="channelName"
                        @update:model-value="$emit('update:channelName', $event)"
                        kind="main"
                        class="setting-input"
                    />
                </div>
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('uploadSettings.backupChannel') }}
                        <span
                            v-if="defaultBackupChannelLabel"
                            class="default-channel-badge"
                            :title="defaultBackupChannelLabel"
                        >{{ $t('uploadSettings.currentDefaultChannel') }}：{{ defaultBackupChannelLabel }}</span>
                    </span>
                    <!-- 备份渠道：默认为空 = 跟随全局；none = 明确不备份。
                         不再用「是否备份」开关控制 —— 由这个下拉本身表达。 -->
                    <ChannelSelect
                        :key="'backup-' + channelRefreshKey"
                        :model-value="backupChannel"
                        @update:model-value="$emit('update:backupChannel', $event)"
                        kind="backup"
                        class="setting-input"
                    />
                </div>
                <!--
                    v3.0.0（R8）：归属实例 —— 位于「备份渠道」下方。
                    选择后本次会话的上传（含分块 / 链接转存）都存入所选实例：
                      '' = 跟随当前实例（左上角头像切换的实例）；
                      '__default__' = 默认实例；其它 = 具体实例。
                    仅本次会话生效（刷新/重进页面自动回到「跟随当前实例」）。
                -->
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('uploadSettings.ownerInstance') }}
                        <el-tooltip :content="$t('uploadSettings.ownerInstanceTooltip')" placement="top" raw-content>
                            <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                        </el-tooltip>
                    </span>
                    <el-select
                        :model-value="uploadInstanceId"
                        @update:model-value="$emit('update:uploadInstanceId', $event)"
                        class="setting-input"
                    >
                        <el-option :label="$t('uploadSettings.ownerInstanceFollow')" value="" />
                        <el-option :label="$t('instancePicker.defaultInstance')" value="__default__" />
                        <el-option v-for="inst in instances" :key="inst.id" :label="inst.name" :value="String(inst.id)" />
                    </el-select>
                </div>
                <div class="setting-item">
                    <span class="setting-label">{{ $t('uploadSettings.uploadDirectory') }}</span>
                    <!--
                        v3.0.0（R12）：原来在首页右下角快捷栏的「目录树选择」按钮迁到这里 ——
                        直接摆在「上传目录」输入框前面，不再占用首页悬浮按钮（用户要求）。
                        只在后台开启「上传目录选项」时出现（与后端 showDirectorySuggestions 同口径）。
                    -->
                    <div class="folder-input-row">
                        <DirectoryTreePicker
                            v-if="directoryPickerEnabled"
                            :current-directory="uploadFolder"
                            source="upload"
                            @select="handleDirectorySelect"
                        >
                            <template #trigger>
                                <!-- v1.0.0：按需求去掉「从目录树选择上传目录」悬浮提示，只保留图标按钮 -->
                                <el-button class="folder-picker-button">
                                    <font-awesome-icon icon="folder-tree" />
                                </el-button>
                            </template>
                        </DirectoryTreePicker>
                        <!--
                            v1.0.0：输入过程不再逐字符保存 —— 编辑时只写本地草稿 folderDraft，
                            失焦（@blur）/回车才算一次保存，避免「每敲一个字就存一次 + 弹一次提示」。
                        -->
                        <el-input
                            :model-value="folderDraft"
                            @update:model-value="folderDraft = $event"
                            @focus="folderEditing = true"
                            @blur="commitFolder"
                            :placeholder="$t('uploadSettings.uploadDirectoryPlaceholder')"
                            autocomplete="on"
                            class="setting-input"
                        ></el-input>
                    </div>
                </div>
                <!--
                    v2.8.8：「自动重试」开关已迁到后台（其他设置 → 上传相关配置），
                    前台不再提供；「文件命名方式」也去掉，一律按后台「默认命名方式」执行。
                -->
            </div>
        </div>

        <!-- 客户端预处理 -->
        <div class="dialog-section">
            <div class="section-header">
                <span class="section-title">{{ $t('uploadSettings.filePreprocess') }}</span>
                <el-tooltip :content="$t('uploadSettings.filePreprocessTooltip')" placement="top">
                    <font-awesome-icon icon="question-circle" class="section-help-icon"/>
                </el-tooltip>
            </div>
            <div class="section-content">
                <!--
                    v2.8.8：视频兼容转码 —— 仅当管理员把该账户设为「用户决定」时出现，
                    选项为「跟随全局 / 禁用 / 启用」；刷新页面自动回到「跟随全局」。
                -->
                <div class="setting-item" v-if="transcodePolicy === 'user'">
                    <span class="setting-label">
                        {{ $t('uploadSettings.videoTranscode') }}
                        <el-tooltip :content="transcodeTooltip" placement="top" raw-content>
                            <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                        </el-tooltip>
                    </span>
                    <el-select
                        :model-value="transcodeChoice"
                        @update:model-value="$emit('update:transcodeChoice', $event)"
                        class="setting-input"
                    >
                        <el-option :label="$t('uploadSettings.transcodeInherit')" value="" />
                        <el-option :label="$t('uploadSettings.transcodeOff')" value="off" />
                        <el-option :label="$t('uploadSettings.transcodeOn')" value="on" />
                    </el-select>
                </div>
                <!--
                    v3.0.0：WebP 转换模式 —— 位于「视频兼容转码」选项下一行；
                    仅当后台 WebP 总开关（webpEnabled）开启时显示。
                    值持久化在 localStorage（gohub_webp_mode）：
                      follow   = 跟随全局（用后台 webpMode，缺失按 lossless）
                      lossless = 无损转换（quality = 1）
                      lossy    = 有损压缩（quality ≈ 0.8）
                -->
                <div class="setting-item" v-if="webpEnabled">
                    <span class="setting-label">
                        {{ $t('uploadSettings.webpMode') }}
                        <el-tooltip :content="$t('uploadSettings.webpModeTooltip')" placement="top" raw-content>
                            <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                        </el-tooltip>
                    </span>
                    <el-select v-model="webpMode" class="setting-input">
                        <el-option :label="$t('uploadSettings.webpModeFollow')" value="follow" />
                        <el-option :label="$t('uploadSettings.webpModeLossless')" value="lossless" />
                        <el-option :label="$t('uploadSettings.webpModeLossy')" value="lossy" />
                    </el-select>
                </div>
                <!-- 文件压缩总开关关闭时，压缩相关设置整体不显示（后台「文件压缩」） -->
                <template v-if="compressEnabled">
                    <div class="setting-item">
                        <span class="setting-label">{{ $t('uploadSettings.fileCompress') }}</span>
                        <el-switch :model-value="customerCompress" @update:model-value="$emit('update:customerCompress', $event)" />
                    </div>
                    <div class="setting-item slider-item" v-if="customerCompress">
                        <span class="setting-label">
                            {{ $t('uploadSettings.compressThreshold') }}
                            <el-tooltip :content="$t('uploadSettings.compressThresholdTooltip')" placement="top">
                                <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                            </el-tooltip>
                        </span>
                        <div class="slider-wrapper">
                            <el-slider :model-value="compressBar" @update:model-value="$emit('update:compressBar', $event)" :min="1" :max="20" :format-tooltip="(value) => `${value} MB`"/>
                            <div class="slider-input-wrapper">
                                <el-input-number :model-value="compressBar" @update:model-value="$emit('update:compressBar', $event)" :min="1" :max="20" :step="1" :value-on-clear="1" class="slider-input" controls-position="right"/>
                                <span class="slider-unit">MB</span>
                            </div>
                        </div>
                    </div>
                    <!-- 压缩期望值：改为「压到原体积的百分比」 -->
                    <div class="setting-item slider-item" v-if="customerCompress">
                        <span class="setting-label">
                            {{ $t('uploadSettings.compressPercent') }}
                            <el-tooltip :content="$t('uploadSettings.compressPercentTooltip')" placement="top" raw-content>
                                <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                            </el-tooltip>
                        </span>
                        <div class="slider-wrapper">
                            <el-slider :model-value="compressPercent" @update:model-value="$emit('update:compressPercent', $event)" :min="10" :max="100" :step="5" :format-tooltip="(value) => `${value}%`"/>
                            <div class="slider-input-wrapper">
                                <el-input-number :model-value="compressPercent" @update:model-value="$emit('update:compressPercent', $event)" :min="10" :max="100" :step="5" :value-on-clear="80" class="slider-input" controls-position="right"/>
                                <span class="slider-unit">%</span>
                            </div>
                        </div>
                    </div>
                    <!--
                        v2.8.5：原「允许压缩格式」改为「禁止压缩格式」，并挪到「压缩百分比」之后。
                        语义反转：清单内的格式跳过压缩、原样上传；不在清单内的按现有规则压缩。
                    -->
                    <div class="setting-item" v-if="customerCompress">
                        <span class="setting-label">
                            {{ $t('uploadSettings.compressExcludeExtensions') }}
                            <el-tooltip :content="compressExcludeTooltip" placement="top" raw-content>
                                <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                            </el-tooltip>
                        </span>
                        <!--
                            v1.0.0：同「上传目录」—— 输入时只改本地草稿 extsDraft，
                            失焦 / 回车 / 点清空按钮时才提交保存。
                        -->
                        <el-input
                            :model-value="extsDraft"
                            @update:model-value="extsDraft = $event"
                            @focus="extsEditing = true"
                            @blur="commitExts"
                            @clear="commitExts('')"
                            :placeholder="$t('uploadSettings.compressExcludeExtensionsPlaceholder')"
                            clearable
                            class="setting-input"
                        />
                    </div>
                </template>
            </div>
        </div>

        <!--
            v2.8.9：「其他」模块 —— 仅在后台「失败自动重试」总开关开启时出现；
            这里的开关只作用于前台上传 / 链接转存，不影响 WebDAV / API。
        -->
        <div class="dialog-section" v-if="autoRetryEnabled">
            <div class="section-header">
                <span class="section-title">{{ $t('uploadSettings.other') }}</span>
                <el-tooltip :content="$t('uploadSettings.otherTooltip')" placement="top" raw-content>
                    <font-awesome-icon icon="question-circle" class="section-help-icon"/>
                </el-tooltip>
            </div>
            <div class="section-content">
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('uploadSettings.autoRetry') }}
                        <el-tooltip :content="$t('uploadSettings.autoRetryTooltip')" placement="top" raw-content>
                            <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                        </el-tooltip>
                    </span>
                    <el-switch
                        :model-value="localAutoRetry"
                        @update:model-value="$emit('update:localAutoRetry', $event)"
                    />
                </div>
            </div>
        </div>

        <!--
            v2.8.8：
              · 「上传限制」（允许格式 / 单文件大小上限）整体移除，改由后台「上传相关配置」
                与「用户管理 → 单文件大小限制」统一控制；
              · 「文件命名方式」移除，一律按后台「默认命名方式」执行。
        -->

        <!--
            v2.5.0：移除底部「所有设置修改后立即生效，无需保存」提示与「完成」按钮
            —— 自动保存早已生效，右上角关闭按钮（show-close 已恢复）即可关窗。
        -->
    </el-dialog>
</template>

<script>
import ChannelSelect from '@/components/config/ChannelSelect.vue';
import DirectoryTreePicker from '@/components/DirectoryTreePicker.vue';
import { resolveChannelLabel, invalidateStorageChannels } from '@/utils/storageChannels';
import { COMPRESSIBLE_EXTENSIONS } from '@/utils/upload/compressExtensions';

export default {
    name: 'UploadSettingsDialog',
    components: {
        ChannelSelect,
        DirectoryTreePicker
    },
    props: {
        modelValue: { type: Boolean, default: false },
        /** v3.0.0（R12）：后台是否开启「上传目录选项」—— 关闭时目录树按钮一并隐藏 */
        directoryPickerEnabled: { type: Boolean, default: true },
        /** 存储渠道 ID（'' = 默认 / 跟随全局设置） */
        channelName: { type: String, default: '' },
        /** 备份渠道 ID（'' = 跟随全局；'none' = 不备份） */
        backupChannel: { type: String, default: '' },
        /** v3.0.0（R8）：归属实例（'' = 跟随当前实例；'__default__' = 默认实例；其它 = 实例 ID） */
        uploadInstanceId: { type: String, default: '' },
        /** v3.0.0（R8）：实例列表（GET /api/instances，不含默认实例）—— 供归属实例下拉 */
        instances: { type: Array, default: () => [] },
        /** 当前生效的默认主存储渠道（{ id, code, name, type }）—— 仅用于展示落点 */
        defaultChannel: { type: Object, default: null },
        /** 当前生效的默认备份渠道（{ id, code, name, type }）—— 仅用于展示落点 */
        defaultBackupChannel: { type: Object, default: null },
        uploadFolder: { type: String, default: '' },
        customerCompress: { type: Boolean, default: true },
        compressBar: { type: Number, default: 5 },
        compressPercent: { type: Number, default: 80 },
        serverCompress: { type: Boolean, default: true },
        /** 允许压缩格式覆盖（本次覆盖，逗号分隔；空 = 用内置可压缩清单） */
        limitCompressExts: { type: String, default: '' },
        /** v2.8.8：后台「文件压缩」总开关 —— 关闭时下面所有压缩设置都不显示 */
        compressEnabled: { type: Boolean, default: true },
        /** v2.8.8：该账户的视频兼容转码策略（inherit/off/on/user） */
        transcodePolicy: { type: String, default: 'inherit' },
        /** v2.8.8：用户自己选的转码档位（'' = 跟随全局 / 'off' / 'on'），仅 user 策略下有效 */
        transcodeChoice: { type: String, default: '' },
        /** v2.8.8：后台全局「视频兼容转码」当前值（展示「跟随全局」的实际效果） */
        transcodeGlobal: { type: Boolean, default: true },
        /** v2.8.9：后台「失败自动重试」总开关 —— 关闭时「其他」模块整体不显示 */
        autoRetryEnabled: { type: Boolean, default: true },
        /** v2.8.9：前台「失败自动重试」开关（只管前台上传 / 链接转存） */
        localAutoRetry: { type: Boolean, default: true },
        /** v3.0.0：后台「WebP转换」总开关 —— 开启时才显示「WebP转换模式」下拉 */
        webpEnabled: { type: Boolean, default: false }
    },
    emits: [
        'update:modelValue',
        'update:channelName',
        'update:backupChannel',
        'update:uploadInstanceId',
        'update:uploadFolder',
        'update:customerCompress',
        'update:compressBar',
        'update:compressPercent',
        'update:serverCompress',
        'update:limitCompressExts',
        'update:transcodeChoice',
        'update:localAutoRetry'
    ],
    data() {
        return {
            /*
             * 渠道下拉刷新令牌（v2.8.6）：
             * 每次打开弹窗 +1，配合 ChannelSelect 的 :key 让下拉重新挂载、
             * 重新拉一次 /api/channels —— 后台刚停用的渠道不会残留在这个下拉里。
             */
            channelRefreshKey: 0,
            /*
             * v3.0.0：WebP 转换模式（follow / lossless / lossy）。
             * 持久化在 localStorage（gohub_webp_mode），默认 follow = 跟随全局。
             */
            webpMode: (() => {
                try { return localStorage.getItem('gohub_webp_mode') || 'follow' } catch (e) { return 'follow' }
            })(),
            /*
             * v1.0.0：文本框的本地草稿。
             * 原来 el-input 直接 @update:model-value 往父组件抛，父组件 watch 立刻写 store ——
             * 每敲一个字符就持久化一次，还会连带触发一次「保存成功」提示。
             * 现在输入只写草稿，失焦 / 回车 / 清空时才提交，一个字段一次保存。
             */
            folderDraft: '',
            extsDraft: '',
            // 正在编辑标记：编辑期间外部值变化不回填草稿，避免打断输入
            folderEditing: false,
            extsEditing: false
        };
    },
    watch: {
        /*
         * v2.8.6：弹窗打开时强制刷新渠道列表。
         * 场景：管理员在后台关掉某个渠道的启用开关，然后回到上传页打开「上传设置」，
         * 之前这里会继续显示那个已停用的渠道（模块级缓存没失效）。
         */
        visible(val) {
            if (!val) {
                // v1.0.0：关窗时把还没失焦的草稿补提交，避免「输了没点别处就关窗」丢内容
                this.commitFolder()
                this.commitExts()
                return;
            }
            invalidateStorageChannels();
            this.channelRefreshKey += 1;
            // 打开时用当前生效值回填草稿
            this.folderDraft = this.uploadFolder || ''
            this.extsDraft = this.limitCompressExts || ''
        },
        // v1.0.0：外部值变化（目录树选择 / 父组件回滚）时同步草稿，编辑中不打断；
        // 提交（失焦）后父组件值变化才弹「保存成功」，即一次编辑只提示一次。
        uploadFolder(val) {
            if (!this.folderEditing) this.folderDraft = val || ''
            this.notifySaved()
        },
        limitCompressExts(val) {
            if (!this.extsEditing) this.extsDraft = val || ''
            this.notifySaved()
        },
        /*
         * v2.4.0：其它设置项（开关 / 滑块 / 下拉）发生变化 → 自动保存 + 弹「保存成功」提示。
         * 滑杆拖动会连续触发，这里 600ms 防抖合并成一条提示。
         */
        channelName() { this.notifySaved() },
        backupChannel() { this.notifySaved() },
        uploadInstanceId() { this.notifySaved() },
        customerCompress() { this.notifySaved() },
        compressBar() { this.notifySaved() },
        compressPercent() { this.notifySaved() },
        transcodeChoice() { this.notifySaved() },
        // v3.0.0：WebP 转换模式变化 → 写回 localStorage（跟随全局/无损/有损）
        webpMode(val) {
            try { localStorage.setItem('gohub_webp_mode', val) } catch (e) { /* 隐私模式忽略 */ }
            this.notifySaved()
        }
    },
    methods: {
        /** 防抖弹出「保存成功」提示（600ms 内的连续变更只弹一次）；
         *  仅在弹窗打开期间生效，避免页面初始化回填配置时误弹 */
        notifySaved() {
            if (!this.modelValue) return
            if (this._savedToastTimer) clearTimeout(this._savedToastTimer)
            this._savedToastTimer = setTimeout(() => {
                this._savedToastTimer = null
                try {
                    this.$message.success(this.$t('uploadSettings.savedToast'))
                } catch (e) { /* 弹窗关闭瞬间可能拿不到实例，忽略 */ }
            }, 600)
        },
        /**
         * v1.0.0：提交「上传目录」草稿（失焦 / 回车 / 关窗时调用）。
         * 只有值真的变了才 emit，父组件因此只保存一次；自动补前导 `/`（与旧行为一致）。
         */
        commitFolder() {
            this.folderEditing = false
            let val = this.folderDraft || ''
            if (val && !val.startsWith('/')) val = '/' + val
            this.folderDraft = val
            if (val !== (this.uploadFolder || '')) this.$emit('update:uploadFolder', val)
        },
        /**
         * v1.0.0：提交「禁止压缩格式」草稿。
         * 传入 force 时用传入值（清空按钮场景），否则用草稿值。
         */
        commitExts(force) {
            this.extsEditing = false
            const val = typeof force === 'string' ? force : (this.extsDraft || '')
            this.extsDraft = val
            if (val !== (this.limitCompressExts || '')) this.$emit('update:limitCompressExts', val)
        },
        /** v3.0.0（R12）：目录树选择 → 直接写入上传目录（与首页原快捷栏行为一致） */
        handleDirectorySelect(path) {
            const val = path ? `/${String(path).replace(/^\/+/, '')}` : '';
            this.$emit('update:uploadFolder', val)
        }
    },
    computed: {
        visible: {
            get() { return this.modelValue },
            set(val) { this.$emit('update:modelValue', val) }
        },
        /** 当前默认主渠道展示串（未配置时为空 → 不显示徽标） */
        defaultChannelLabel() {
            return resolveChannelLabel(this.defaultChannel)
        },
        /** 当前默认备份渠道展示串 */
        defaultBackupChannelLabel() {
            return resolveChannelLabel(this.defaultBackupChannel)
        },
        dialogWidth() {
            return window.innerWidth > 768 ? '50%' : '90%'
        },
        /** 视频兼容转码说明：把「跟随全局」的实际状态也写出来，避免用户猜 */
        transcodeTooltip() {
            return this.$t('uploadSettings.videoTranscodeTooltip', {
                global: this.transcodeGlobal ? this.$t('common.enabled') : this.$t('common.disabled')
            })
        },
        /** 允许压缩格式 tooltip：带上内置清单，方便对照填写 */
        compressExcludeTooltip() {
            return this.$t('uploadSettings.compressExcludeExtensionsTooltip', {
                list: COMPRESSIBLE_EXTENSIONS.join(',')
            })
        }
    }
}
</script>

<style src="@/styles/settings-dialog.css"></style>
<style scoped>
/* v3.0.0（R12）：上传目录行 —— 目录树按钮在输入框前面并排 */
.folder-input-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    /* v3.0.0（R14）：桌面端「目录树按钮 + 输入框」整组靠右对齐（与其它设置项输入框右边缘对齐） */
    flex: 0 0 auto;
    margin-left: auto;
    max-width: 290px;
}
.folder-input-row .folder-picker-button {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.folder-input-row .setting-input {
    flex: 1 1 auto;
    width: 250px;
    max-width: 250px;
    min-width: 0;
}
/* v3.0.0（R14）：手机端设置项改为上下结构，目录行恢复整行宽度 */
@media (max-width: 768px) {
    .folder-input-row {
        width: 100%;
        max-width: none;
        margin-left: 0;
    }
}
.channel-option-row {
    display: flex;
    align-items: center;
    gap: 6px;
}

.channel-option-row .channel-icon {
    width: 18px;
    text-align: center;
    flex-shrink: 0;
}

.channel-option-row.default-option {
    color: var(--el-text-color-secondary);
}

/* 「渠道名称」后面的当前默认主渠道徽标（跟随主渠道时给个可见的落点） */
.default-channel-badge {
    display: inline-block;
    max-width: 230px;
    margin-left: 6px;
    padding: 1px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--primary-color, #409eff) 14%, transparent);
    color: var(--primary-color, #409eff);
    font-size: 12px;
    font-weight: 500;
    line-height: 18px;
    vertical-align: middle;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.slider-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
}.slider-wrapper {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
}

.slider-wrapper .el-slider {
    flex: 1;
    min-width: 0;
}

.slider-input {
    width: 96px !important;
    flex-shrink: 0;
}

.slider-input :deep(.el-input__inner) {
    text-align: center;
}

.slider-input-wrapper {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
}

.slider-unit {
    font-size: 13px;
    font-weight: 500;
    color: var(--el-text-color-secondary);
}

/* 「单文件大小上限」输入框 + MB 单位 */
/* v2.8.5：MB 单位挪进输入框 suffix，宽度完全交给 .setting-input（与「允许的上传格式」一致） */
.limit-size-input :deep(.el-input__suffix) {
    color: var(--el-text-color-secondary);
    font-size: 13px;
    font-weight: 500;
}

.limit-size-unit {
    font-size: 13px;
    font-weight: 500;
    color: var(--el-text-color-secondary);
}

/* v2.5.0：底部提示条与「完成」按钮已移除（自动保存），相关样式一并清理 */
</style>
