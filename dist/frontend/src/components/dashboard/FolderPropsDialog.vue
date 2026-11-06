<template>
    <!--
        v3.0.0：文件夹属性弹窗（供文件管理 / 文件夹卡片调用）。
        props：visible / folderPath / folderName / instanceId
        emits：update:visible / close / saved
        接口：GET /api/folders/meta、POST /api/folders/meta、DELETE /api/folders/meta、
              GET/POST /api/shares（目录对外分享）

        v3.0.0 字段顺序：名称 → 所属文件加密 → 共享给用户 → 目录对外分享（+密码+时限）→ 备注（最后）
    -->
    <el-dialog
        v-model="innerVisible"
        :title="$t('folderProps.title')"
        :width="dialogWidth"
        align-center
        append-to-body
        class="folder-props-dialog"
        @close="handleClose"
    >
        <div class="folder-props-body" v-loading="loading">
            <div class="folder-path-line">
                <span class="folder-path-label">{{ $t('folderProps.pathLabel') }}</span>
                <code class="folder-path-value">{{ folderPath || '/' }}</code>
            </div>

            <el-form label-position="top" class="folder-props-form">
                <!-- 显示名 -->
                <el-form-item :label="$t('folderProps.nameLabel')">
                    <el-input
                        v-model="form.name"
                        :placeholder="namePlaceholder"
                        maxlength="120"
                        clearable
                    />
                    <div class="folder-props-hint">{{ $t('folderProps.nameHint') }}</div>
                </el-form-item>

                <!-- 所属文件加密（v3.0.0 已下线：文件外链密码只认文件自身，目录级加密不再生效） -->

                <!-- 共享给用户（v3.0.0 R8：改为「开关 + 用户选择 + 只读/编辑权限」） -->
                <el-form-item :label="$t('folderProps.shareLabel')">
                    <div class="folder-props-switch-row">
                        <el-switch v-model="form.shareEnabled" />
                        <span class="folder-props-switch-text">{{ form.shareEnabled ? $t('folderProps.shareOn') : $t('folderProps.shareOff') }}</span>
                    </div>
                    <template v-if="form.shareEnabled">
                        <el-select
                            v-model="form.sharedUsers"
                            multiple
                            filterable
                            clearable
                            class="folder-props-select folder-props-share-users"
                            :loading="userLoading"
                            :placeholder="$t('folderProps.sharePlaceholder')"
                        >
                            <el-option
                                v-for="u in userOptions"
                                :key="u.username"
                                :label="u.nickname && u.nickname !== u.username ? `${u.nickname}（${u.username}）` : u.username"
                                :value="u.username"
                            />
                        </el-select>
                        <el-radio-group v-model="form.sharedPerm" class="folder-props-perm">
                            <!-- v3.0.0（R14）：只读前置（默认选项即只读，避免误给编辑权限） -->
                            <el-radio value="readonly">{{ $t('folderProps.permReadonly') }}</el-radio>
                            <el-radio value="edit">{{ $t('folderProps.permEdit') }}</el-radio>
                        </el-radio-group>
                        <div class="folder-props-hint">{{ $t('folderProps.sharePermHint') }}</div>
                    </template>
                </el-form-item>

                <!-- 目录对外分享（无权限时整行不显示） -->
                <el-form-item v-if="shareAllowed" :label="$t('folderProps.galleryLabel')">
                    <div class="folder-props-switch-row">
                        <el-switch v-model="form.gallery" :disabled="shareLoading" />
                        <span class="folder-props-switch-text">{{ form.gallery ? $t('folderProps.galleryOn') : $t('folderProps.galleryOff') }}</span>
                        <el-tooltip :content="$t('folderProps.galleryHint')" placement="top" effect="dark">
                            <button type="button" class="folder-props-help" :aria-label="$t('folderProps.galleryHint')">
                                <font-awesome-icon icon="question-circle" />
                            </button>
                        </el-tooltip>
                    </div>
                    <template v-if="form.gallery">
                        <!-- 访问密码：留空 = 保持/不设，清除按钮置空 -->
                        <div class="folder-props-sub">
                            <div class="folder-props-sub-label">{{ $t('folderProps.publicPassword') }}</div>
                            <div class="folder-props-sub-row">
                                <el-input
                                    v-model="sharePassword"
                                    type="password"
                                    show-password
                                    clearable
                                    class="folder-props-select"
                                    :placeholder="$t('folderProps.publicPasswordPlaceholder')"
                                    @input="sharePasswordTouched = true"
                                    @clear="sharePasswordTouched = true"
                                />
                                <el-button v-if="shareRecord && shareRecord.encrypted" :disabled="saving" @click="clearSharePassword">
                                    {{ $t('folderProps.publicPasswordClear') }}
                                </el-button>
                            </div>
                        </div>
                        <!-- 时限 -->
                        <div class="folder-props-sub">
                            <div class="folder-props-sub-label">{{ $t('folderProps.publicExpire') }}</div>
                            <div class="folder-props-sub-row">
                                <el-select v-model="expireMode" class="folder-props-select">
                                    <el-option value="never" :label="$t('folderProps.publicExpireNever')" />
                                    <el-option value="1d" :label="$t('folderProps.publicExpire1d')" />
                                    <el-option value="7d" :label="$t('folderProps.publicExpire7d')" />
                                    <el-option value="30d" :label="$t('folderProps.publicExpire30d')" />
                                    <el-option value="custom" :label="$t('folderProps.publicExpireCustom')" />
                                </el-select>
                                <el-date-picker
                                    v-if="expireMode === 'custom'"
                                    v-model="expireAt"
                                    type="datetime"
                                    class="folder-props-date"
                                    :popper-class="datePopperClass"
                                    value-format="YYYY-MM-DDTHH:mm:ss"
                                    :placeholder="$t('folderProps.publicExpireCustom')"
                                />
                            </div>
                        </div>
                    </template>
                </el-form-item>

                <!-- 备注（v3.0.0 移到最后） -->
                <el-form-item :label="$t('folderProps.noteLabel')">
                    <el-input
                        v-model="form.note"
                        type="textarea"
                        :rows="3"
                        maxlength="4000"
                        show-word-limit
                        :placeholder="$t('folderProps.notePlaceholder')"
                    />
                    <div class="folder-props-hint">{{ $t('folderProps.noteHint') }}</div>
                </el-form-item>
            </el-form>
        </div>

        <template #footer>
            <div class="folder-props-footer">
                <el-button
                    v-if="exists"
                    type="danger"
                    text
                    class="folder-props-clear"
                    :loading="clearing"
                    @click="handleClear"
                >{{ $t('folderProps.clear') }}</el-button>
                <div class="folder-props-footer-right">
                    <el-button @click="handleClose">{{ $t('common.cancel') }}</el-button>
                    <el-button type="primary" :loading="saving" @click="handleSave">{{ $t('common.save') }}</el-button>
                </div>
            </div>
        </template>
    </el-dialog>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus';
import fetchWithAuth from '@/utils/fetchWithAuth';

export default {
    name: 'FolderPropsDialog',
    props: {
        visible: { type: Boolean, default: false },
        folderPath: { type: String, default: '' },
        folderName: { type: String, default: '' },
        instanceId: { type: String, default: '' },
    },
    emits: ['update:visible', 'close', 'saved'],
    data() {
        return {
            loading: false,
            saving: false,
            clearing: false,
            exists: false,
            userLoading: false,
            userOptions: [],
            /* v3.0.0：目录对外分享 */
            shareAllowed: false,
            shareLoading: false,
            shareRecord: null,
            sharePassword: '',
            sharePasswordTouched: false,
            expireMode: 'never',
            expireAt: '',
            form: {
                name: '',
                encrypt: false,
                password: '',
                encrypted: false,
                note: '',
                shareEnabled: false,
                sharedUsers: [],
                // v3.0.0（R12）：开启「共享给用户」后默认权限为「只读」
                sharedPerm: 'readonly',
                gallery: false,
            },
        };
    },
    computed: {
        innerVisible: {
            get() { return this.visible; },
            set(val) { this.$emit('update:visible', val); },
        },
        dialogWidth() {
            return window.innerWidth < 768 ? '92%' : '520px';
        },
        /** 留空时用路径末段作为显示名 */
        pathLeaf() {
            const parts = String(this.folderPath || '').split('/').filter(Boolean);
            return parts.length ? parts[parts.length - 1] : '';
        },
        namePlaceholder() {
            return this.folderName || this.pathLeaf || this.$t('folderProps.namePlaceholder');
        },
        /** 移动端截止时间面板居中（桌面端保持默认定位） */
        datePopperClass() {
            return window.innerWidth < 768
                ? 'folder-share-date-popper folder-share-date-popper--center'
                : 'folder-share-date-popper';
        },
        /** 提交给 /api/shares 的到期时间（'' = 不限时） */
        shareExpireIso() {
            const mode = this.expireMode;
            if (mode === 'never') return '';
            if (mode === 'custom') {
                if (!this.expireAt) return '';
                const d = new Date(this.expireAt);
                return Number.isNaN(d.getTime()) ? '' : d.toISOString();
            }
            const days = { '1d': 1, '7d': 7, '30d': 30 }[mode] || 0;
            if (!days) return '';
            return new Date(Date.now() + days * 86400000).toISOString();
        },
    },
    watch: {
        visible(val) {
            if (val) {
                this.resetForm();
                this.loadSharePermission();
                this.loadMeta();
                this.loadUsers();
            }
        },
    },
    methods: {
        resetForm() {
            this.exists = false;
            this.shareRecord = null;
            this.sharePassword = '';
            this.sharePasswordTouched = false;
            this.expireMode = 'never';
            this.expireAt = '';
            this.form = {
                name: this.folderName || '',
                encrypt: false,
                password: '',
                encrypted: false,
                note: '',
                shareEnabled: false,
                sharedUsers: [],
                sharedPerm: 'readonly',
                gallery: false,
            };
        },
        /**
         * 对外分享权限：/api/auth/sessionCheck 若下发 shareEnabled 则据此判断，
         * 否则（当前后端未下发）按「仅管理员显示对外分享」处理。
         */
        async loadSharePermission() {
            try {
                const res = await fetchWithAuth('/api/auth/sessionCheck', { method: 'GET' });
                const json = await res.json().catch(() => ({}));
                const role = json?.role || this.$store?.state?.sessionRole;
                const isAdmin = role === 'admin' || role === 'super';
                const raw = json?.shareEnabled ?? json?.data?.shareEnabled ?? json?.profile?.shareEnabled;
                this.shareAllowed = typeof raw === 'boolean' ? raw : isAdmin;
            } catch {
                const role = this.$store?.state?.sessionRole;
                this.shareAllowed = role === 'admin' || role === 'super';
            }
        },
        /** 打开时读取目录属性并回填 */
        async loadMeta() {
            this.loading = true;
            try {
                const params = new URLSearchParams();
                params.set('path', this.folderPath);
                if (this.instanceId) params.set('instanceId', this.instanceId);
                const res = await fetchWithAuth(`/api/folders/meta?${params.toString()}`);
                const json = await res.json().catch(() => ({}));
                const meta = json?.exists ? (json.meta || {}) : {};
                this.exists = !!json?.exists;
                this.form.name = String(meta.displayName || this.folderName || '');
                this.form.encrypted = !!meta.encrypted;
                this.form.encrypt = !!meta.encrypted;
                this.form.password = '';
                this.form.note = String(meta.note || '');
                this.form.sharedUsers = Array.isArray(meta.sharedUsers) ? [...meta.sharedUsers] : [];
                // v3.0.0（R8）：共享开关 = 已选用户数 > 0；权限按后端值回填（edit / readonly）
                // v3.0.0（R14）：后端未存权限时兜底为「只读」（与选项顺序一致）
                this.form.shareEnabled = this.form.sharedUsers.length > 0;
                this.form.sharedPerm = meta.sharedPerm === 'edit' ? 'edit' : 'readonly';
                this.form.gallery = !!meta.gallery;
                // v3.0.0：对外分享以 ShareLink 为准（旧 gallery 布尔仅作兜底）
                if (this.shareAllowed) await this.loadShare();
            } catch {
                ElMessage.error(this.$t('folderProps.loadFailed'));
            } finally {
                this.loading = false;
            }
        },
        /** GET /api/shares?type=cate → 该目录已有的分享记录 */
        async loadShare() {
            this.shareLoading = true;
            try {
                const params = new URLSearchParams();
                params.set('type', 'cate');
                params.set('instanceId', this.instanceId || '');
                params.set('pageSize', '200');
                const res = await fetchWithAuth(`/api/shares?${params.toString()}`, { method: 'GET' });
                const json = await res.json().catch(() => ({}));
                const list = Array.isArray(json?.data) ? json.data : [];
                const target = String(this.folderPath || '');
                const row = list.find((r) => r && r.type === 'cate' && String(r.target || '') === target) || null;
                this.shareRecord = row;
                if (row) {
                    this.form.gallery = !!row.enabled;
                    this.expireMode = row.expireAt ? 'custom' : 'never';
                    this.expireAt = row.expireAt || '';
                }
                this.sharePassword = '';
                this.sharePasswordTouched = false;
            } catch {
                this.shareRecord = null;
            } finally {
                this.shareLoading = false;
            }
        },
        /** POST /api/shares（upsert：同 owner+实例+类型+target 只保留一条） */
        async upsertShare(body) {
            const res = await fetchWithAuth('/api/shares', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.success === false) throw new Error(json.error || json.message || this.$t('folderProps.shareSaveFailed'));
            return json.data;
        },
        /** 清除访问密码：password 传空串 */
        async clearSharePassword() {
            const target = String(this.folderPath || '');
            this.sharePassword = '';
            this.sharePasswordTouched = true;
            try {
                const row = await this.upsertShare({
                    type: 'cate',
                    target,
                    instanceId: this.instanceId || '',
                    enabled: !!this.form.gallery,
                    password: '',
                });
                if (row) this.shareRecord = row;
                ElMessage.success(this.$t('common.success'));
            } catch (err) {
                ElMessage.error(err.message || this.$t('folderProps.shareSaveFailed'));
            }
        },
        /** 共享用户候选（沿用后台用户管理的精简列表接口） */
        async loadUsers() {
            if (this.userOptions.length) return;
            this.userLoading = true;
            try {
                const res = await fetchWithAuth('/api/manage/users/options', { method: 'GET' });
                if (!res.ok) throw new Error();
                const list = await res.json();
                this.userOptions = (Array.isArray(list) ? list : [])
                    .filter((u) => u && u.username)
                    .map((u) => ({ username: String(u.username), nickname: String(u.nickname || '') }));
            } catch {
                this.userOptions = [];
            } finally {
                this.userLoading = false;
            }
        },
        async handleSave() {
            if (!this.folderPath) return;
            this.saving = true;
            try {
                const body = {
                    path: this.folderPath,
                    // 留空 → 用路径末段作为显示名
                    name: String(this.form.name || '').trim() || this.pathLeaf,
                    note: String(this.form.note || ''),
                    // v3.0.0（R8）：共享开关关闭 = 清空共享用户；权限一并提交
                    sharedUsers: this.form.shareEnabled ? this.form.sharedUsers : [],
                    sharedPerm: this.form.sharedPerm === 'readonly' ? 'readonly' : 'edit',
                    gallery: !!this.form.gallery,
                };
                if (this.instanceId) body.instanceId = this.instanceId;
                // v3.0.0：目录级加密已下线（文件外链密码只认文件自身），这里不再提交 password

                const res = await fetchWithAuth('/api/folders/meta', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || json.success === false) throw new Error(json.message || this.$t('folderProps.saveFailed'));
                this.exists = true;
                this.form.password = '';

                // v3.0.0：目录对外分享写入 ShareLink（密码 / 时限 / 启停）
                // 仅「已分享」或「已有分享记录」时才写，避免给没分享过的目录凭空建禁用记录
                if (this.shareAllowed && (this.form.gallery || this.shareRecord)) {
                    const shareBody = {
                        type: 'cate',
                        target: String(this.folderPath || ''),
                        instanceId: this.instanceId || '',
                        enabled: !!this.form.gallery,
                    };
                    if (this.form.gallery) shareBody.expireAt = this.shareExpireIso;
                    if (this.sharePasswordTouched) shareBody.password = String(this.sharePassword || '');
                    try {
                        const row = await this.upsertShare(shareBody);
                        if (row) this.shareRecord = row;
                        this.sharePasswordTouched = false;
                        this.sharePassword = '';
                    } catch (shareErr) {
                        // 属性已保存，但分享设置失败：提示后保持弹窗打开，方便重试
                        this.$emit('saved', json.meta || body);
                        ElMessage.error(shareErr.message || this.$t('folderProps.shareSaveFailed'));
                        return;
                    }
                }

                ElMessage.success(this.$t('folderProps.saved'));
                this.$emit('saved', json.meta || body);
                this.innerVisible = false;
            } catch (err) {
                ElMessage.error(err.message || this.$t('folderProps.saveFailed'));
            } finally {
                this.saving = false;
            }
        },
        /** 清除属性（二次确认）：删掉目录的全部属性并移出访客图库 */
        async handleClear() {
            if (!this.folderPath) return;
            try {
                await ElMessageBox.confirm(
                    this.$t('folderProps.clearConfirmMessage'),
                    this.$t('folderProps.clearConfirmTitle'),
                    {
                        confirmButtonText: this.$t('folderProps.clearConfirmOk'),
                        cancelButtonText: this.$t('common.cancel'),
                        type: 'warning',
                    },
                );
            } catch {
                return;
            }
            this.clearing = true;
            try {
                const params = new URLSearchParams();
                params.set('path', this.folderPath);
                if (this.instanceId) params.set('instanceId', this.instanceId);
                const res = await fetchWithAuth(`/api/folders/meta?${params.toString()}`, { method: 'DELETE' });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || json.success === false) throw new Error(json.message || this.$t('folderProps.clearFailed'));
                ElMessage.success(this.$t('folderProps.clearSuccess'));
                this.$emit('saved', null);
                this.innerVisible = false;
            } catch (err) {
                ElMessage.error(err.message || this.$t('folderProps.clearFailed'));
            } finally {
                this.clearing = false;
            }
        },
        handleClose() {
            this.innerVisible = false;
            this.$emit('close');
        },
    },
};
</script>

<style scoped>
.folder-props-body {
    max-height: 62vh;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    padding-right: 2px;
}
.folder-path-line {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    font-size: 12px;
    min-width: 0;
}
.folder-path-label {
    flex: 0 0 auto;
    color: var(--el-text-color-secondary);
}
.folder-path-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    color: var(--el-text-color-regular);
}
.folder-props-form :deep(.el-form-item) {
    margin-bottom: 16px;
}
.folder-props-form :deep(.el-form-item__label) {
    padding-bottom: 4px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
}
.folder-props-switch-row {
    display: flex;
    align-items: center;
    gap: 10px;
}
.folder-props-switch-text {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.folder-props-help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--el-text-color-placeholder);
    font-size: 12px;
    cursor: pointer;
}
.folder-props-password {
    margin-top: 8px;
}
.folder-props-select {
    width: 100%;
}
/* v3.0.0（R8）：共享用户选择与权限单选（开关打开后显示） */
.folder-props-share-users {
    margin-top: 8px;
}
.folder-props-perm {
    margin-top: 8px;
    display: flex;
}
/* v3.0.0：对外分享的密码 / 时限子区块 */
.folder-props-sub {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
    padding-left: 10px;
    border-left: 2px solid var(--el-border-color-lighter);
    width: 100%;
}
.folder-props-sub-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
}
.folder-props-sub-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.folder-props-sub-row .folder-props-select {
    flex: 1 1 150px;
    min-width: 0;
    width: auto;
}
.folder-props-date {
    flex: 1 1 180px;
    min-width: 0;
}
.folder-props-hint {
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
}
.folder-props-hint-warn {
    color: var(--el-color-warning);
}
.folder-props-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
}
.folder-props-footer-right {
    display: flex;
    gap: 8px;
    margin-left: auto;
}
.folder-props-clear {
    padding-left: 0;
}
@media (max-width: 768px) {
    .folder-props-body {
        max-height: 55vh;
    }
}
</style>

<style>
/* v3.0.0：目录分享「截止时间」面板在移动端居中显示。
   面板被 teleport 到 body，scoped 样式无法命中，因此放在全局样式块里。 */
.folder-share-date-popper--center.el-popper {
    position: fixed !important;
    left: 50% !important;
    top: 50% !important;
    right: auto !important;
    bottom: auto !important;
    transform: translate(-50%, -50%) !important;
    margin: 0 !important;
    max-width: 94vw;
}
.folder-share-date-popper--center .el-picker-panel {
    max-width: 94vw;
}
@media (max-width: 768px) {
    .folder-share-date-popper--center .el-date-picker.has-sidebar {
        width: min(92vw, 340px) !important;
    }
}
</style>
