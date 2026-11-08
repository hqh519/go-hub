<template>
    <!--
      登记文件（v2.8.8）

      场景：文件早就通过别的方式放到了对象存储 / 图床（CDN、NAS、别的图床），
      只想让 GoHub 里有一条可管理、可签发的记录，不想再传一遍。
      这里只填「文件源地址」等少量信息，类型 / 大小 / MD5 / IP 归属地 / 上传时间
      全部由服务端探测与自动写入。

      入口：
        · 前台上传页右下角（「上传设置」按钮上方）
        · 后台文件管理页「新建目录」按钮右侧
      两处共用本组件，样式沿用 settings-dialog 系列，跟其它设置弹窗完全一致。
    -->
    <el-dialog
        :title="$t('recordFile.title')"
        v-model="visible"
        :width="dialogWidth"
        class="settings-dialog settings-dialog-scope record-file-dialog"
        append-to-body
    >
        <div class="dialog-section">
            <div class="section-header">
                <span class="section-title">{{ $t('recordFile.basicSection') }}</span>
                <el-tooltip :content="$t('recordFile.basicTooltip')" placement="top" raw-content>
                    <font-awesome-icon icon="question-circle" class="section-help-icon"/>
                </el-tooltip>
            </div>
            <div class="section-content">
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('recordFile.sourceUrl') }}
                        <span class="required-mark">*</span>
                    </span>
                    <!-- v3.0.0（R16）：源地址通常很长，单独放宽（其它字段仍用默认宽度） -->
                    <el-input
                        v-model.trim="form.sourceUrl"
                        :placeholder="$t('recordFile.sourceUrlPlaceholder')"
                        clearable
                        class="setting-input record-source-input"
                    />
                </div>
                <!--
                    v3.0.0：「存储渠道」移到「文件源地址」的下一行
                    （顺序：文件源地址 → 存储渠道 → 文件名称 → 扩展名 → 分类目录 → 备注）。
                -->
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('recordFile.channel') }}
                        <span class="required-mark">*</span>
                    </span>
                    <el-select
                        v-model="form.channelId"
                        :placeholder="$t('recordFile.channelPlaceholder')"
                        :loading="channelsLoading"
                        class="setting-input"
                    >
                        <el-option
                            v-for="c in channelOptions"
                            :key="c.id"
                            :label="`${c.name}（${c.code}）`"
                            :value="c.id"
                        />
                    </el-select>
                </div>
                <div class="setting-item">
                    <span class="setting-label">{{ $t('recordFile.fileName') }}</span>
                    <el-input
                        v-model.trim="form.originalName"
                        :placeholder="$t('recordFile.fileNamePlaceholder')"
                        clearable
                        class="setting-input"
                    />
                </div>
                <!--
                    v2.8.9：扩展名 —— 源地址不带扩展名时（Immich 这类 /api/assets/xxx）用它补类型；
                    源地址本身带扩展名时以后者为准（后端 upload.service.registerFile 已按此优先级处理）。
                -->
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('recordFile.extension') }}
                        <el-tooltip :content="$t('recordFile.extensionTooltip')" placement="top" raw-content>
                            <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                        </el-tooltip>
                    </span>
                    <!-- v3.0.0（R16）：扩展名收窄为固定宽度（文件分类与之等宽） -->
                    <el-input
                        v-model.trim="form.extension"
                        :placeholder="$t('recordFile.extensionPlaceholder')"
                        clearable
                        class="setting-input record-ext-input"
                    />
                </div>
                <!--
                    v2.9.0：文件分类
                      · 留空 → 后端落「登记文件/年/月」（upload.service.registerFile 兜底）
                      · 后台从文件管理页打开时，父级把当前所在目录传进 initialFolder 自动填充
                -->
                <div class="setting-item">
                    <span class="setting-label">
                        {{ $t('recordFile.folder') }}
                        <el-tooltip :content="folderDefaultHint" placement="top" raw-content>
                            <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                        </el-tooltip>
                    </span>
                    <!--
                        v3.0.0（R16）：文件分类左侧加「目录选择」按钮 ——
                        与首页「上传设置」里的目录树选择完全同一套交互（同一个组件、同一数据源）；
                        输入框收窄到与「扩展名」等宽。
                    -->
                    <div class="record-folder-row">
                        <DirectoryTreePicker
                            :current-directory="form.folder"
                            source="upload"
                            @select="handleFolderPick"
                        >
                            <template #trigger>
                                <!-- v1.0.0：按需求去掉「从目录树选择上传目录」悬浮提示，只保留图标按钮 -->
                                <el-button class="record-folder-btn">
                                    <font-awesome-icon icon="folder-tree" />
                                </el-button>
                            </template>
                        </DirectoryTreePicker>
                        <DirectorySuggestionInput
                            v-model="form.folder"
                            :placeholder="$t('recordFile.folderPlaceholder')"
                            history-key="gohub:recent:recordFolder"
                            class="record-folder-input"
                            @update:model-value="rememberFolder"
                        />
                    </div>
                </div>
                <div class="setting-item record-note-item">
                    <span class="setting-label">{{ $t('recordFile.note') }}</span>
                    <el-input
                        v-model="form.note"
                        type="textarea"
                        :rows="3"
                        maxlength="2000"
                        show-word-limit
                        :placeholder="$t('recordFile.notePlaceholder')"
                    />
                </div>
            </div>
        </div>

        <!--
            v3.0.0：「自动写入（无需填写）」说明块整块移除（标题 + 清单 + 非管理员提示
            及相关样式一并清理），只保留上方实际表单字段。
        -->

        <div class="dialog-action">
            <el-button @click="visible = false">{{ $t('common.cancel') }}</el-button>
            <el-button type="primary" class="confirm-btn" :loading="submitting" @click="submit">
                {{ $t('recordFile.submit') }}
            </el-button>
        </div>
    </el-dialog>
</template>

<script>
import DirectorySuggestionInput from '@/components/DirectorySuggestionInput.vue'
import DirectoryTreePicker from '@/components/DirectoryTreePicker.vue'
import fetchWithAuth from '@/utils/fetchWithAuth'
import { fetchStorageChannels } from '@/utils/storageChannels'

/*
 * v3.0.0（R16）：「文件分类」记忆 ——
 * 关闭弹窗再打开仍记得上次填的分类，但**刷新页面即清空**。
 * 用模块级变量而不是 localStorage / sessionStorage：后两者都会跨刷新存活。
 */
let rememberedFolder = ''

export default {
    name: 'RecordFileDialog',
    components: { DirectorySuggestionInput, DirectoryTreePicker },
    props: {
        modelValue: { type: Boolean, default: false },
        isAdmin: { type: Boolean, default: true },
        // v2.9.0：后台从文件管理页打开时，把当前所在目录代入「文件分类」
        initialFolder: { type: String, default: '' }
    },
    emits: ['update:modelValue', 'registered'],
    data() {
        return {
            form: { sourceUrl: '', originalName: '', extension: '', channelId: '', folder: '', note: '' },
            channels: [],
            channelsLoading: false,
            submitting: false
        }
    },
    computed: {
        visible: {
            get() { return this.modelValue },
            set(val) { this.$emit('update:modelValue', val) }
        },
        dialogWidth() {
            return window.innerWidth > 768 ? '50%' : '90%'
        },
        channelOptions() {
            // 只列「启用中」的渠道：已停用的渠道不该再接收新记录
            return this.channels.filter(c => c.enabled !== false)
        },
        folderDefaultHint() {
            // 提示里直接给出「留空会落到哪」，用当前年月算实例，避免用户猜
            const now = new Date()
            const month = String(now.getMonth() + 1).padStart(2, '0')
            return this.$t('recordFile.folderTooltip', {
                path: `登记文件/${now.getFullYear()}/${month}`
            })
        }
    },
    watch: {
        async modelValue(val) {
            if (!val) return
            // 每次打开重置表单，只保留上次选的渠道；目录按父级传入值初始化
            this.form = {
                sourceUrl: '',
                originalName: '',
                extension: '',
                channelId: this.form.channelId,
                // v3.0.0（R16）：父级明确传入目录（后台按当前目录登记）优先，否则回填上次记忆值
                folder: this.initialFolder || rememberedFolder,
                note: ''
            }
            await this.loadChannels()
        }
    },
    methods: {
        async loadChannels() {
            this.channelsLoading = true
            try {
                this.channels = await fetchStorageChannels(true)
            } catch (e) {
                this.channels = []
            } finally {
                this.channelsLoading = false
            }
        },
        async submit() {
            if (this.submitting) return
            if (!this.form.sourceUrl) {
                this.$message.warning(this.$t('recordFile.sourceUrlRequired'))
                return
            }
            if (!/^https?:\/\//i.test(this.form.sourceUrl)) {
                this.$message.warning(this.$t('recordFile.sourceUrlInvalid'))
                return
            }
            if (!this.form.channelId) {
                this.$message.warning(this.$t('recordFile.channelRequired'))
                return
            }
            this.submitting = true
            try {
                const res = await fetchWithAuth('/api/record', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // v2.8.9：扩展名去点、转小写后再提交（后端也会兜底清洗）
                    // v3.0.0：登记文件同样写入当前实例（gohub_instance_id，'' = 默认实例）
                    body: JSON.stringify({
                        ...this.form,
                        instanceId: (() => {
                            try { return localStorage.getItem('gohub_instance_id') || '' } catch (e) { return '' }
                        })(),
                        extension: String(this.form.extension || '').replace(/^\.+/, '').toLowerCase()
                    })
                })
                const data = await res.json().catch(() => ({}))
                if (!res.ok || !data.success) {
                    this.$message.error(data.message || this.$t('recordFile.failed'))
                    return
                }
                const size = Number(data.data?.size) || 0
                this.$message.success(
                    this.$t('recordFile.success', {
                        name: data.data?.name || this.form.originalName,
                        size: this.formatSize(size)
                    })
                )
                this.$emit('registered', data.data || {})
                // v3.0.0（R16）：登记成功后记住本次分类（必须在重置表单之前取，否则拿到的是空串）
                this.rememberFolder(this.form.folder)
                this.form = {
                    sourceUrl: '',
                    originalName: '',
                    extension: '',
                    channelId: this.form.channelId,
                    folder: '',
                    note: ''
                }
                this.visible = false
            } catch (e) {
                this.$message.error(this.$t('recordFile.failed'))
            } finally {
                this.submitting = false
            }
        },
        /** v3.0.0（R16）：目录树选择回调（与首页上传设置同款） */
        handleFolderPick(path) {
            this.form.folder = path || ''
            this.rememberFolder(this.form.folder)
        },
        /** v3.0.0（R16）：记住当前分类（刷新页面清除） */
        rememberFolder(val) {
            rememberedFolder = String(val || '')
        },
        formatSize(bytes) {
            const n = Number(bytes) || 0
            if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
            if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
            if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
            return `${n} B`
        }
    }
}
</script>

<style scoped>
.required-mark {
    color: var(--el-color-danger);
    margin-left: 2px;
}

/* v3.0.0（R16）：源地址加长；扩展名与文件分类等宽 */
.record-source-input {
    width: 74% !important;
    max-width: 560px !important;
}
.record-ext-input {
    width: 180px !important;
    max-width: 180px !important;
    flex: 0 0 180px;
}
.record-folder-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
}
.record-folder-row .record-folder-btn {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.record-folder-row .record-folder-input {
    width: 180px;
    max-width: 180px;
    flex: 0 0 180px;
}
@media (max-width: 768px) {
    .record-source-input,
    .record-ext-input,
    .record-folder-row .record-folder-input {
        width: 100% !important;
        max-width: none !important;
        flex: 1 1 auto;
    }
    .record-folder-row {
        width: 100%;
    }
}

.record-note-item {
    align-items: flex-start;
}

.record-note-item .setting-label {
    padding-top: 6px;
}

/* v3.0.0：「自动写入（无需填写）」说明块已移除，其样式（record-auto-list /
   record-auto-icon / record-alert）一并清理。 */
</style>
