<template>
    <div>
        <FileDetailDialog
            v-model="visible"
            :file="innerFile"
            :fileLink="detail.fileLink"
            :urls="detail.urls"
            :showAdvanced="true"
            @download="handleDownload"
            @tagManagement="openTagDialog"
            @block="applyListType('block')"
            @white="applyListType('white')"
            @delete="handleDelete"
            @metadataUpdated="handleMetadataUpdated"
            @fileRenamed="handleFileRenamed"
        />

        <!-- 标签管理：与「文件管理」「历史记录」共用同一弹窗 -->
        <TagManagementDialog
            v-model="showTagDialog"
            :fileId="currentTagFile"
            :fileMetadata="innerFile?.metadata || {}"
        />
    </div>
</template>

<script>
import FileDetailDialog from '@/components/dashboard/FileDetailDialog.vue'
import TagManagementDialog from '@/components/dashboard/TagManagementDialog.vue'
import { buildFileDetail } from '@/utils/fileDetail'
import fetchWithAuth from '@/utils/fetchWithAuth'

/**
 * 全站统一的「文件详情」入口组件。
 *
 * 任何页面（上传页 / 文件管理 / 历史记录 / 系统状态…）只要：
 *   <FileDetailUnified v-model="show" :file="{ name, metadata }" @deleted="..." />
 * 调出的详情页就完全一致：同一模板（FileDetailDialog）、同一数据构造（buildFileDetail）、
 * 同一套按钮（下载 / 标签管理 / 黑名单 / 白名单 / 删除 / 编辑 / 重命名 / 重定向）、
 * 同一套权限（弹窗内部按会话角色判断，管理员与普通用户各自一致）。
 *
 * 事件：
 *   deleted(fileId)                 文件已在详情里被删除（父层同步移除列表项）
 *   metadataUpdated(fileId, patch)  元数据被修改（父层可同步列表）
 *   fileRenamed(oldId, newId, meta) File_ID 被重命名（父层可同步列表）
 */
export default {
    name: 'FileDetailUnified',
    components: { FileDetailDialog, TagManagementDialog },
    props: {
        modelValue: { type: Boolean, default: false },
        /** 文件记录 { name, metadata }，与 buildFileDetail 的入参一致 */
        file: { type: Object, default: null }
    },
    emits: ['update:modelValue', 'deleted', 'metadataUpdated', 'fileRenamed'],
    data() {
        return {
            innerFile: null,
            showTagDialog: false,
            currentTagFile: ''
        }
    },
    computed: {
        /**
         * v1.0.0：当前浏览实例（localStorage gohub_instance_id，'' = 默认实例）。
         * 删除接口现在要求限定实例，避免在 A 实例删除时把 B 实例的同名文件一起软删。
         */
        detailInstanceId() {
            try { return localStorage.getItem('gohub_instance_id') || '' } catch (e) { return '' }
        },
        visible: {
            get() { return this.modelValue },
            set(val) { this.$emit('update:modelValue', val) }
        },
        /** 详情数据：与文件管理 / 历史记录共用 buildFileDetail 的同一套构造逻辑 */
        detail() {
            return buildFileDetail(this.innerFile, { previewMode: 'admin' })
        }
    },
    watch: {
        file: {
            immediate: true,
            handler(val) {
                this.innerFile = val ? { name: val.name, metadata: { ...(val.metadata || {}) } } : null
            }
        }
    },
    methods: {
        /** 下载：走文件链接直接下载（与文件管理一致） */
        handleDownload() {
            const name = this.innerFile?.name
            if (!name) return
            const link = document.createElement('a')
            link.href = this.detail.fileLink || `/file/${encodeURIComponent(name)}`
            link.download = name
            link.click()
        },
        openTagDialog() {
            if (!this.innerFile?.name) return
            this.currentTagFile = this.innerFile.name
            this.showTagDialog = true
        },
        /**
         * 黑名单 / 白名单：确认 → 写文件元数据 ListType（Block / White）→ 就地更新访问状态。
         * 说明：这是「文件级」名单，与「安全设置」里的 IP 黑白名单不是同一套接口 ——
         * 此前误调 GET /api/manage/block|white/<文件ID>（那是按 IP 的接口，且只支持 POST/DELETE），
         * 必然 404，所以界面上一直提示「失败」。
         */
        applyListType(action) {
            const fileId = this.innerFile?.name
            if (!fileId) return
            const listType = action === 'block' ? 'Block' : 'White'
            const successKey = action === 'block' ? 'dashboard.blockSuccess' : 'dashboard.whiteSuccess'
            const failKey = action === 'block' ? 'dashboard.blockFailed' : 'dashboard.whiteFailed'
            this.$confirm(
                this.$t(action === 'block' ? 'dashboard.blockConfirm' : 'dashboard.whiteConfirm'),
                this.$t('dashboard.deleteConfirmTitle'),
                {
                    confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
                    cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
                    type: 'warning'
                }
            )
                .then(() =>
                    fetchWithAuth(`/api/manage/metadata/${encodeURIComponent(fileId)}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ListType: listType })
                    }).then((response) => {
                        if (!response.ok) return Promise.reject(new Error('Request failed'))
                        this.patchMetadata(fileId, { ListType: listType })
                        this.$message.success(this.$t(successKey))
                    })
                )
                .catch((e) => {
                    if (e !== 'cancel' && e !== 'close') this.$message.error(this.$t(failKey))
                })
        },
        /** 删除：确认后调删除接口（软删除 + 清理各渠道副本），并通知父层 */
        handleDelete() {
            const fileId = this.innerFile?.name
            if (!fileId) return
            this.$confirm(
                this.$t('uploadHistory.deleteConfirmMessage'),
                this.$t('uploadHistory.clearConfirmTitle'),
                {
                    confirmButtonText: this.$t('uploadHistory.clearConfirmOk'),
                    cancelButtonText: this.$t('uploadHistory.clearConfirmCancel'),
                    type: 'warning'
                }
            )
                .then(async () => {
                    const res = await fetchWithAuth(`/api/manage/delete/${encodeURIComponent(fileId)}?folder=false&instanceId=${encodeURIComponent(this.detailInstanceId)}`, { method: 'DELETE' })
                    if (!res.ok) throw new Error('Request failed')
                    this.$message.success(this.$t('dashboard.deleteSuccess'))
                    this.visible = false
                    this.$emit('deleted', fileId)
                })
                .catch((e) => {
                    if (e !== 'cancel' && e !== 'close') this.$message.error(this.$t('dashboard.deleteFailed'))
                })
        },
        patchMetadata(fileId, patch) {
            if (this.innerFile && this.innerFile.name === fileId) {
                this.innerFile = { ...this.innerFile, metadata: { ...this.innerFile.metadata, ...patch } }
            }
            this.$emit('metadataUpdated', fileId, patch)
        },
        handleMetadataUpdated(fileId, metadata) {
            this.patchMetadata(fileId, metadata || {})
        },
        handleFileRenamed(oldFileId, newFileId, metadata) {
            const patch = metadata || {}
            if (this.innerFile && this.innerFile.name === oldFileId) {
                this.innerFile = { ...this.innerFile, name: newFileId, metadata: { ...this.innerFile.metadata, ...patch } }
            }
            this.$emit('fileRenamed', oldFileId, newFileId, patch)
        }
    }
}
</script>
