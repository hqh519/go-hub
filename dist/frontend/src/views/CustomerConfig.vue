<template>
    <div class="container">
        <AdminHeader active-tab="customerConfig" />
        <div class="main-container">
            <!-- ========== 模块切换：用户账户管理 / 归集统计（普通用户只能看自己的归集） ========== -->
            <div class="module-switch">
                <el-radio-group v-model="activeModule" size="small">
                    <el-radio-button label="accounts">
                        <font-awesome-icon icon="user-cog" class="collect-icon"/>{{ $t('userManage.moduleAccounts') }}
                    </el-radio-button>
                    <el-radio-button label="collect">
                        <font-awesome-icon icon="chart-bar" class="collect-icon"/>{{ $t('userManage.moduleCollect') }}
                    </el-radio-button>
                </el-radio-group>
            </div>

            <!-- ============================================================
                 模块一：用户账户管理
                 账户的创建 / 权限 / 禁用 / 改密 / 主备渠道 都在这里，
                 不再混在「按用户账户归集」这个统计功能下面。
                 普通用户进本页：只看到自己这一条账户记录 + 修改密码，其余全部隐藏。
                 ============================================================ -->
            <template v-if="activeModule === 'accounts'">
                <div class="collect-switch">
                    <span class="module-hint" v-if="isAdminRole">{{ $t('userManage.accountsHint') }}</span>
                    <el-button v-if="isAdminRole" type="primary" size="small" class="create-user-btn" @click="openCreateDialog">
                        <font-awesome-icon icon="user-plus" class="create-icon"/>{{ $t('userManage.createUser') }}
                    </el-button>
                </div>

                <el-table
                    :data="userRows"
                    row-key="id"
                    class="main-table"
                    table-layout="fixed"
                    v-loading="loading"
                >
                    <el-table-column :label="$t('userManage.username')" min-width="130" prop="username"></el-table-column>
                    <el-table-column :label="$t('userManage.nickname')" min-width="110" prop="nickname"></el-table-column>
                    <el-table-column :label="$t('userManage.role')" width="110" align="center">
                        <template #default="{ row }">
                            <el-tag size="small" :type="row.role === 'admin' ? 'danger' : 'info'">
                                {{ row.role === 'admin' ? $t('userManage.roleAdmin') : $t('userManage.roleUser') }}
                            </el-tag>
                        </template>
                    </el-table-column>
                    <el-table-column v-if="isAdminRole" :label="$t('userManage.enabled')" width="90" align="center">
                        <template #default="{ row }">
                            <el-switch
                                v-model="row.enabled"
                                :disabled="row.role === 'admin' || row.orphan"
                                @change="toggleField(row, 'enabled', $event)"
                            />
                        </template>
                    </el-table-column>
                    <el-table-column v-if="isAdminRole" :label="$t('userManage.canEdit')" width="90" align="center">
                        <template #default="{ row }">
                            <el-switch
                                v-model="row.canEdit"
                                :disabled="row.role === 'admin' || row.orphan"
                                @change="toggleField(row, 'canEdit', $event)"
                            />
                        </template>
                    </el-table-column>
                    <el-table-column v-if="isAdminRole" :label="$t('userManage.canDelete')" width="90" align="center">
                        <template #default="{ row }">
                            <el-switch
                                v-model="row.canDelete"
                                :disabled="row.role === 'admin' || row.orphan"
                                @change="toggleField(row, 'canDelete', $event)"
                            />
                        </template>
                    </el-table-column>
                    <!-- 链接权限：关闭后该账户上传的文件外链（/file/*）对外不可访问 -->
                    <el-table-column v-if="isAdminRole" :label="$t('userManage.linkPermission')" width="110" align="center">
                        <template #default="{ row }">
                            <el-tooltip :content="$t('userManage.linkPermissionTooltip')" placement="top" :show-after="500">
                                <el-switch
                                    v-model="row.linkEnabled"
                                    :disabled="row.role === 'admin' || row.orphan"
                                    @change="toggleField(row, 'linkEnabled', $event)"
                                />
                            </el-tooltip>
                        </template>
                    </el-table-column>
                    <!--
                        v3.0.0（第三轮）：原「类型和大小限制」列移除，换成「分享权限」——
                        控制该账户能否创建对外分享（文件 / 标签）；管理员恒为开启。
                        单个账户仍可在「编辑账户」页里设置上传类型与大小限制。
                    -->
                    <el-table-column v-if="isAdminRole" :label="$t('userManage.sharePermission')" width="110" align="center">
                        <template #default="{ row }">
                            <el-tooltip :content="$t('userManage.sharePermissionTooltip')" placement="top" :show-after="600">
                                <el-switch
                                    v-model="row.shareEnabled"
                                    :disabled="row.role === 'admin' || row.orphan"
                                    @change="toggleField(row, 'shareEnabled', $event)"
                                />
                            </el-tooltip>
                        </template>
                    </el-table-column>
                    <!-- 主渠道 / 备份渠道：管理员看全部账户，普通用户只看到自己账户绑定的渠道值 -->
                    <el-table-column :label="$t('userManage.mainChannel')" min-width="150">
                        <template #default="{ row }">
                            <span class="channel-text">{{ row.mainChannelName || $t('userManage.followGlobal') }}</span>
                        </template>
                    </el-table-column>
                    <el-table-column :label="$t('userManage.backupChannel')" min-width="150">
                        <template #default="{ row }">
                            <span class="channel-text">{{ row.backupChannelName || $t('userManage.followGlobal') }}</span>
                        </template>
                    </el-table-column>
                    <!-- 操作列：移动端不固定，与其他列一起左右滚动。
                         v2.6.0：「重置密码」「修改密码」按钮移除 —— 改密码统一收口到用户编辑页 -->
                    <el-table-column :label="$t('userManage.actions')" :width="isAdminRole ? 130 : 90" :fixed="isMobile ? false : 'right'" align="center">
                        <template #default="{ row }">
                            <template v-if="isAdminRole">
                                <el-button link type="primary" size="small" :disabled="row.orphan" @click="openEditDialog(row)">{{ $t('userManage.manage') }}</el-button>
                                <el-button
                                    link
                                    type="danger"
                                    size="small"
                                    :disabled="row.role === 'admin' || row.orphan"
                                    @click="removeUser(row)"
                                >{{ $t('common.delete') }}</el-button>
                            </template>
                            <!-- 普通用户：只留「编辑」（进用户编辑页，可改昵称/密码/邮箱/2FA 等） -->
                            <template v-else>
                                <el-button link type="primary" size="small" :disabled="row.orphan" @click="openEditDialog(row)">{{ $t('userManage.manage') }}</el-button>
                            </template>
                        </template>
                    </el-table-column>
                </el-table>

                <!-- ============================================================
                     用户公告（v202610221824）
                     管理员：多行文本框（10 行）可直接编辑发布，支持 HTML；
                     普通用户：只读渲染在列表下方，用于接收管理员通知。
                     ============================================================ -->
                <div class="notice-block">
                    <template v-if="isAdminRole">
                        <div class="notice-head">
                            <span class="notice-title">{{ $t('userManage.noticeTitle') }}</span>
                            <span class="notice-hint">{{ $t('userEdit.noticeHint') }}</span>
                        </div>
                        <el-input
                            v-model="noticeText"
                            type="textarea"
                            :rows="10"
                            :placeholder="$t('userEdit.noticePlaceholder')"
                            class="notice-textarea"
                        />
                        <div class="notice-footer">
                            <el-button type="primary" plain size="small" :loading="noticeSaving" @click="saveNotice">
                                {{ $t('userEdit.noticeSave') }}
                            </el-button>
                            <span class="notice-hint">{{ $t('userEdit.noticeSupportHtml') }}</span>
                        </div>
                    </template>
                    <template v-else>
                        <div class="notice-head">
                            <span class="notice-title">{{ $t('userManage.noticeTitle') }}</span>
                        </div>
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <div v-if="noticeText" class="notice-body" v-html="noticeText"></div>
                        <div v-else class="notice-empty">{{ $t('userManage.noticeEmpty') }}</div>
                    </template>
                </div>
            </template>

            <!-- ============================================================
                 模块二：归集统计
                 结构对齐「按 IP 归集」：只做统计，点行展开看该归集下的文件列表。
                 普通用户能进，但只看到自己账户的归集（后端已按会话过滤）。
                 ============================================================ -->
            <template v-else>
                <div class="collect-switch">
                    <el-radio-group v-model="collectMode" size="small" @change="handleCollectModeChange">
                        <el-radio-button label="user">
                            <font-awesome-icon icon="user" class="collect-icon"/>{{ $t('userManage.byUser') }}
                        </el-radio-button>
                        <el-radio-button label="ip" v-if="isAdminRole">
                            <font-awesome-icon icon="network-wired" class="collect-icon"/>{{ $t('userManage.byIp') }}
                        </el-radio-button>
                    </el-radio-group>
                    <span class="module-hint">{{ isAdminRole ? $t('userManage.collectHint') : $t('userManage.collectHintSelf') }}</span>
                </div>

                <!-- 按用户账户归集 -->
                <el-table
                    v-if="collectMode === 'user'"
                    :data="userCollectRows"
                    row-key="id"
                    class="main-table"
                    table-layout="fixed"
                    v-loading="loading"
                    @expand-change="handleUserExpandChange"
                >
                    <el-table-column type="expand" width="48">
                        <template #default="props">
                            <div style="margin: 8px;">
                                <h3 style="text-align: center;">{{ $t('customerConfig.uploadFileList') }}</h3>
                                <el-table
                                    :data="props.row.data"
                                    style="width: 100%"
                                    :default-sort="{ prop: 'metadata.TimeStamp', order: 'descending' }"
                                    table-layout="fixed"
                                    :max-height="400"
                                    v-loading="props.row.filesLoading"
                                >
                                    <el-table-column prop="metadata.FileName" :label="$t('customerConfig.fileNameCol')"></el-table-column>
                                    <el-table-column :label="$t('customerConfig.filePreview')">
                                        <template #default="{ row }">
                                            <el-image v-if="row.metadata?.FileType?.includes('image')" :src="fileUrl(row)" fit="cover" lazy style="width: 100px; height: 100px; cursor: pointer;" @click="openCollectDetail(row)"></el-image>
                                            <video v-else-if="row.metadata?.FileType?.includes('video')" :src="fileUrl(row)" controls style="width: 100px; height: 100px; cursor: pointer;" @click="openCollectDetail(row)"></video>
                                            <div v-else style="width: 100px; height: 100px; display: flex; justify-content: center; align-items: center; cursor: pointer;" @click="openCollectDetail(row)">
                                                <font-awesome-icon icon="file" style="font-size: 2em;"></font-awesome-icon>
                                            </div>
                                        </template>
                                    </el-table-column>
                                    <!-- 上传渠道：按「每个文件」取值（metadata.UploadSource），
                                         位置在上传时间前一列（需求：不要在折叠汇总行上显示） -->
                                    <el-table-column :label="$t('userManage.uploadChannels')" min-width="110">
                                        <template #default="{ row }">
                                            <el-tag size="small" effect="plain">{{ row.metadata?.UploadSource || 'Default' }}</el-tag>
                                        </template>
                                    </el-table-column>
                                    <el-table-column
                                        :label="$t('customerConfig.uploadTimeCol')"
                                        prop="metadata.TimeStamp"
                                        sortable
                                        :sort-method="sortByTimestamp">
                                        <template #default="row">
                                            {{ formatTimeStamp(row.row.metadata.TimeStamp) }}
                                        </template>
                                    </el-table-column>
                                </el-table>
                            </div>
                        </template>
                    </el-table-column>
                    <el-table-column :label="$t('userManage.username')" min-width="150" prop="username">
                        <template #default="{ row }">
                            {{ row.username }}
                            <el-tag v-if="row.orphan" size="small" type="info" style="margin-left: 6px;">{{ $t('userManage.noAccount') }}</el-tag>
                        </template>
                    </el-table-column>
                    <el-table-column :label="$t('userManage.nickname')" min-width="130" prop="nickname"></el-table-column>
                    <el-table-column :label="$t('userManage.fileCount')" width="110" align="center" sortable :sort-method="(a, b) => (a.fileCount || 0) - (b.fileCount || 0)">
                        <template #default="{ row }">{{ row.fileCount || 0 }}</template>
                    </el-table-column>
                    <el-table-column :label="$t('userManage.usedSize')" width="130" align="center" sortable :sort-method="(a, b) => (a.usedSize || 0) - (b.usedSize || 0)">
                        <template #default="{ row }">{{ formatSize(row.usedSize || 0) }}</template>
                    </el-table-column>
                    <!-- 「上传渠道」不在汇总行显示（改到展开后的每个文件行，见内层表格） -->
                    <el-table-column :label="$t('userManage.lastUpload')" min-width="170">
                        <template #default="{ row }">{{ row.lastAt ? formatTimeStamp(row.lastAt) : '—' }}</template>
                    </el-table-column>
                    <!-- v3.0.0：「查看记录」—— 新标签打开历史记录页，并只加载该用户的上传记录 -->
                    <el-table-column :label="$t('userManage.viewRecords')" width="112" align="center">
                        <template #default="{ row }">
                            <el-button
                                v-if="row.username"
                                link
                                type="primary"
                                size="small"
                                @click="viewUserRecords(row.username)"
                            >{{ $t('userManage.viewRecords') }}</el-button>
                        </template>
                    </el-table-column>
                </el-table>

                <!-- 按 IP 归集（原有视图） -->
                <el-table
                    v-else
                    :data="paginatedData"
                    :default-sort="{ prop: 'count', order: 'descending' }"
                    row-key="ip"
                    class="main-table"
                    table-layout="fixed"
                    v-loading="loading"
                    @expand-change="handleExpandChange"
                >
                    <el-table-column type="expand" width="48">
                        <template v-slot="props">
                            <div style="margin: 8px;">
                                <h3 style="text-align: center;">{{ $t('customerConfig.uploadFileList') }}</h3>
                                <el-table :data="props.row.data" style="width: 100%" :default-sort="{ prop: 'metadata.TimeStamp', order: 'descending' }" table-layout="fixed" :max-height="400" v-loading="props.row.filesLoading">
                                    <el-table-column prop="metadata.FileName" :label="$t('customerConfig.fileNameCol')"></el-table-column>
                                    <el-table-column :label="$t('customerConfig.filePreview')">
                                        <template v-slot="{ row }">
                                            <el-image v-if="row.metadata?.FileType?.includes('image')" :src="fileUrl(row)" fit="cover" lazy style="width: 100px; height: 100px; cursor: pointer;" @click="openCollectDetail(row)"></el-image>
                                            <video v-else-if="row.metadata?.FileType?.includes('video')" :src="fileUrl(row)" controls style="width: 100px; height: 100px; cursor: pointer;" @click="openCollectDetail(row)"></video>
                                            <div v-else style="width: 100px; height: 100px; display: flex; justify-content: center; align-items: center; cursor: pointer;" @click="openCollectDetail(row)">
                                                <font-awesome-icon icon="file" style="font-size: 2em;"></font-awesome-icon>
                                            </div>
                                        </template>
                                    </el-table-column>
                                    <!-- 上传渠道：按「每个文件」取值（metadata.UploadSource），
                                         位置在上传时间前一列（需求：不要在折叠汇总行上显示） -->
                                    <el-table-column :label="$t('userManage.uploadChannels')" min-width="110">
                                        <template v-slot="{ row }">
                                            <el-tag size="small" effect="plain">{{ row.metadata?.UploadSource || 'Default' }}</el-tag>
                                        </template>
                                    </el-table-column>
                                    <el-table-column
                                        :label="$t('customerConfig.uploadTimeCol')"
                                        prop="metadata.TimeStamp"
                                        sortable
                                        :sort-method="sortByTimestamp">
                                        <template v-slot="{ row }">
                                            {{ formatTimeStamp(row.metadata.TimeStamp) }}
                                        </template>
                                    </el-table-column>
                                </el-table>
                            </div>
                        </template>
                    </el-table-column>
                    <el-table-column :label="$t('fileDetail.ipDisplayLabel')" min-width="280">
                        <template v-slot="{ row }">
                            <span :class="{ 'ip-display-cell-multiline': String(row.display || '').includes('\n') }">{{ row.display || (row.address ? `${row.address}(${row.ip})` : row.ip) }}</span>
                        </template>
                    </el-table-column>
                    <el-table-column prop="count" :label="$t('customerConfig.uploadCount')" sortable min-width="110"></el-table-column>
                    <!-- 「上传渠道」不在汇总行显示（改到展开后的每个文件行，见内层表格） -->
                    <el-table-column :label="$t('customerConfig.allowUpload')" :fixed="allowUploadColumnFixed" :width="allowUploadColumnWidth" align="center">
                        <template v-slot="{ row }">
                            <el-switch
                                class="allow-upload-switch"
                                v-model="row.enable"
                                :active-text="$t('customerConfig.allow')"
                                :inactive-text="$t('customerConfig.deny')"
                                @change="handleSwitchEnable(row)"
                            >
                            </el-switch>
                        </template>
                    </el-table-column>
                </el-table>
            </template>

            <!-- 分页组件（仅 IP 视图） -->
            <div class="pagination-container" v-if="activeModule === 'collect' && collectMode === 'ip'">
                <div class="pagination-center">
                    <el-pagination
                        background
                        layout="prev, pager, next"
                        :total="dealedData.length"
                        :current-page="currentPage"
                        :page-size="pageSize"
                        :pager-count="pagerCount"
                        @current-change="handlePageChange"
                    ></el-pagination>
                    <el-button v-if="currentPage === Math.ceil(dealedData.length / pageSize)" type="primary" @click="loadMoreData" :loading="loading" class="load-more">{{ $t('customerConfig.loadMore') }}</el-button>
                </div>
            </div>
        </div>

        <!-- 创建 / 编辑用户 -->
        <el-dialog v-model="showUserDialog" :title="editingUser ? $t('userManage.editUser') : $t('userManage.createUser')" :width="dialogWidth">
            <el-form :model="userForm" :rules="userRules" ref="userFormRef" label-position="top">
                <el-form-item :label="$t('userManage.username')" prop="username">
                    <el-input ref="usernameInput" v-model="userForm.username" :disabled="!!editingUser" :placeholder="$t('userManage.usernamePlaceholder')" />
                </el-form-item>
                <el-form-item :label="$t('userManage.nickname')">
                    <el-input v-model="userForm.nickname" :placeholder="$t('userManage.nicknamePlaceholder')" />
                </el-form-item>
                <el-form-item v-if="!editingUser" :label="$t('userManage.password')" prop="password">
                    <el-input v-model="userForm.password" type="password" show-password :placeholder="$t('userManage.passwordPlaceholder')" />
                </el-form-item>
                <el-form-item :label="$t('userManage.mainChannel')">
                    <!-- 存储渠道下拉：与 Token 编辑、上传设置共用同一个 ChannelSelect -->
                    <ChannelSelect v-model="userForm.mainChannelId" kind="main" class="full-width"/>
                </el-form-item>
                <el-form-item :label="$t('userManage.backupChannel')">
                    <ChannelSelect v-model="userForm.backupChannelId" kind="backup" class="full-width"/>
                </el-form-item>
                <!-- 管理备注（v2.1.0）：仅管理员可见，普通用户接口不下发 -->
                <el-form-item v-if="isAdminRole">
                    <template #label>
                        <span>{{ $t('userManage.adminNote') }}
                            <span class="admin-note-hint">{{ $t('userManage.adminNoteHint') }}</span>
                        </span>
                    </template>
                    <el-input
                        v-model="userForm.adminNote"
                        type="textarea"
                        :rows="3"
                        maxlength="4000"
                        show-word-limit
                        :placeholder="$t('userManage.adminNotePlaceholder')"
                    />
                </el-form-item>
                <el-form-item :label="$t('userManage.permissions')">
                    <div class="permission-row">
                        <span>{{ $t('userManage.canEdit') }}<el-switch v-model="userForm.canEdit" /></span>
                        <span>{{ $t('userManage.canDelete') }}<el-switch v-model="userForm.canDelete" /></span>
                        <span>{{ $t('userManage.linkPermission') }}<el-switch v-model="userForm.linkEnabled" /></span>
                        <span>{{ $t('userManage.enabled') }}<el-switch v-model="userForm.enabled" /></span>
                        <!-- 类型和大小限制：开启（默认）→ 该用户上传受「允许上传格式 + 单文件大小上限」约束；
                             关闭 → 跳过这两项限制（前端上传、WebDAV 均按本账户此开关生效） -->
                        <span class="permission-hint">
                            {{ $t('userManage.enforceLimits') }}
                            <el-switch v-model="userForm.enforceLimits" />
                            <el-tooltip :content="$t('userManage.enforceLimitsTooltip')" placement="top" :show-after="600">
                                <font-awesome-icon icon="circle-question" class="permission-hint-icon"/>
                            </el-tooltip>
                        </span>
                    </div>
                </el-form-item>
            </el-form>
            <template #footer>
                <el-button @click="showUserDialog = false">{{ $t('common.cancel') }}</el-button>
                <el-button type="primary" :loading="savingUser" @click="submitUser">{{ $t('common.save') }}</el-button>
            </template>
        </el-dialog>

        <!-- v2.6.0：重置/修改密码弹窗已移除 —— 改密码统一在用户编辑页（含身份验证） -->

        <!-- 归集统计：点击文件封面调出文件详情（与文件管理页同一弹窗，隐藏批量动作） -->
        <FileDetailDialog
            v-model="showCollectDetail"
            :file="collectDetailFile"
            :fileLink="fileUrl(collectDetailFile)"
            :urls="{}"
            :showAdvanced="false"
        />
    </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import axios from '@/utils/axios';
import AdminHeader from '@/components/dashboard/AdminHeader.vue';
import ChannelSelect from '@/components/config/ChannelSelect.vue';
import FileDetailDialog from '@/components/dashboard/FileDetailDialog.vue';
import backgroundManager from '@/mixins/backgroundManager';
import pageActivation from '@/mixins/pageActivation';
import { fileLink } from '@/utils/fileLink';

const CHANNEL_TYPE_LABELS = {
    cos: 'Tencent', minio: 'MinIO', r2: 'R2', s3: 'S3',
    easyimages: 'Easy', lsky: 'Lsky', webdav: 'WebDAV',
    immich: 'Immich', custom: 'External'
};

/**
 * 用户管理页。
 *
 * 两个互相独立的模块：
 *   1) 用户账户管理 —— 账户的创建 / 权限 / 禁用 / 改密 / 主备渠道（只在管理员后台用）
 *   2) 归集统计     —— 按「用户账户」或「上传 IP」统计上传文件数与占用空间，
 *                      与「按 IP 归集」同构：点行首箭头展开该归集下的文件列表
 * 后台创建的用户一律普通用户，仅管理员可进入本页。
 */
export default {
    name: 'CustomerConfig',
    mixins: [backgroundManager, pageActivation],
    data() {
        return {
            // 'accounts'（用户账户管理） | 'collect'（归集统计）
            activeModule: 'accounts',

            // —— 用户账户视图 ——
            userRows: [],
            collectUsers: {},
            // 归集统计：点击文件封面调出文件详情弹窗
            showCollectDetail: false,
            collectDetailFile: null,
            showUserDialog: false,
            editingUser: null,
            userForm: {
                username: '', nickname: '', password: '',
                mainChannelId: '', backupChannelId: '',
                canEdit: true, canDelete: true, linkEnabled: true, enabled: true, enforceLimits: true
            },
            savingUser: false,
            // v2.6.0：重置/修改密码与改昵称弹窗已移除，统一走用户编辑页
            // 用户公告（管理员可编辑，普通用户只读）
            noticeText: '',
            noticeSaving: false,

            // —— 归集统计视图 ——
            collectMode: 'user',

            // —— IP 视图（原有） ——
            dealedData: [],
            blockipList: [],
            loading: false,
            viewportWidth: window.innerWidth,
            currentPage: 1,
            pageSize: 10,
        };
    },
    components: { AdminHeader, ChannelSelect, FileDetailDialog },
    computed: {
        /** 是否管理员（admin / super）—— 普通用户只开放「看自己 + 改密码」 */
        isAdminRole() {
            return this.$store?.getters?.isAdminRole === true;
        },
        isMobile() { return this.viewportWidth < 768; },
        pagerCount() { return this.isMobile ? 3 : 7; },
        allowUploadColumnFixed() { return false; },
        allowUploadColumnWidth() { return this.isMobile ? 96 : 170; },
        dialogWidth() { return this.isMobile ? '92%' : '520px'; },
        /** 归集统计（按用户账户）：只保留统计字段，按文件数倒序 */
        userCollectRows() {
            return [...this.userRows].sort((a, b) => (b.fileCount || 0) - (a.fileCount || 0));
        },
        /** 创建用户表单校验：用户名 / 密码必填（错误直接显示在对应输入框下方） */
        userRules() {
            return {
                username: [
                    { required: true, message: this.$t('userManage.usernameRequired'), trigger: 'blur' },
                    {
                        validator: (rule, value, callback) => {
                            const v = String(value || '').trim();
                            if (!v) return callback();
                            if (!/^[A-Za-z0-9_.@-]{2,32}$/.test(v)) return callback(new Error(this.$t('userManage.usernameInvalid')));
                            return callback();
                        },
                        trigger: 'blur',
                    },
                ],
                password: [
                    { required: true, message: this.$t('userManage.passwordRequired'), trigger: 'blur' },
                    { min: 4, message: this.$t('userManage.passwordTooShort'), trigger: 'blur' },
                ],
            };
        },
        paginatedData() {
            const start = (this.currentPage - 1) * this.pageSize;
            return this.dealedData.slice(start, start + this.pageSize);
        },
    },
    methods: {
    /**
     * v3.0.0：按用户收集 →「查看记录」
     * 新标签打开历史记录页，用 ?user= 只加载该账户的上传记录
     * （历史记录页已移除用户下拉框，这是管理员查看他人记录的唯一入口）。
     */
    viewUserRecords(username) {
      if (!username) return;
      const { href } = this.$router.resolve({ path: '/manage/history', query: { user: username } });
      window.open(href, '_blank', 'noopener');
    },
        typeLabel(t) { return CHANNEL_TYPE_LABELS[t] || t; },
        formatSize(bytes) {
            if (!bytes) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            let i = 0; let v = bytes;
            while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
            return `${v.toFixed(v >= 100 || i === 0 ? 0 : 2)} ${units[i]}`;
        },
        /**
         * 文件外链（统一出口：自定义访问域名 → 页面设置前缀 → 本站 /file/）。
         * 注意：归集接口返回的是 { name, metadata }，File_ID 在 name 上（不是 id）。
         */
        fileUrl(row) {
            const name = row?.name || row?.id || '';
            const ext = row?.metadata?.FileExt ? `.${row.metadata.FileExt}` : '';
            return fileLink(name, ext);
        },
        /** 归集统计：点击文件封面 → 文件详情弹窗（复用文件管理页的同一弹窗组件） */
        openCollectDetail(row) {
            if (!row?.name) return;
            this.collectDetailFile = row;
            this.showCollectDetail = true;
        },

        // ========== 数据加载 ==========
        /* 渠道下拉数据已改为通用 <ChannelSelect> 组件内部按会话缓存拉取，
           这里不再需要单独维护 channelOptions（见 utils/storageChannels.js）。 */
        async loadUsers() {
            this.loading = true;
            try {
                /*
                 * 归集统计：后端已允许普通用户访问（只返回其自身账户的汇总），
                 * 所以管理员与普通用户走同一条链路；差异只体现在数据范围上。
                 */
                const [usersRes, collectRes] = await Promise.all([
                    fetchWithAuth('/api/manage/users', { method: 'GET' }).then(r => r.json()),
                    fetchWithAuth('/api/manage/users/collect?mode=user', { method: 'GET' }).then(r => r.json()).catch(() => ({})),
                ]);
                const collect = {};
                for (const it of (collectRes?.items || [])) collect[it.key] = it;
                this.collectUsers = collect;
                this.userRows = (Array.isArray(usersRes) ? usersRes : []).map(u => ({
                    ...u,
                    ...this.newCollectSlot(),
                    fileCount: collect[u.username]?.count || 0,
                    usedSize: collect[u.username]?.size || 0,
                    lastAt: collect[u.username]?.lastAt || 0,
                    uploadSources: collect[u.username]?.uploadSources || [],
                }));
                // 兜底：把「有文件但没有对应账户」的归属值也列出来（仅管理员可见）
                // （例如管理员账户上传的、或早期用认证码上传归到 'user' 的文件），
                // 否则这些文件的统计在「按用户账户归集」里完全看不到。
                if (!this.isAdminRole) return;
                const known = new Set(this.userRows.map((r) => r.username));
                for (const it of Object.values(collect)) {
                    if (!it.key || known.has(it.key)) continue;
                    this.userRows.push({
                        ...this.newCollectSlot(),
                        id: `__orphan__${it.key}`,
                        username: it.key,
                        nickname: this.$t('userManage.noAccount'),
                        role: 'user',
                        enabled: false,
                        canEdit: false,
                        canDelete: false,
                        orphan: true,
                        mainChannelId: '',
                        backupChannelId: '',
                        mainChannelName: '',
                        backupChannelName: '',
                        fileCount: it.count || 0,
                        usedSize: it.size || 0,
                        lastAt: it.lastAt || 0,
                        uploadSources: it.uploadSources || [],
                    });
                }
            } catch (e) {
                this.$message.error(this.$t('customerConfig.syncError'));
            } finally {
                this.loading = false;
            }
        },
        /** 展开行所需的文件列表槽位（重载用户时一并重置，避免显示上一轮的缓存） */
        newCollectSlot() {
            return { data: [], filesLoaded: false, filesLoading: false };
        },

        // ========== 视图切换 ==========
        handleCollectModeChange(mode) {
            if (mode === 'user') this.loadUsers();
            else this.loadIpList();
        },

        // ========== 用户账户操作 ==========
        openCreateDialog() {
            this.editingUser = null;
            this.userForm = {
                username: '', nickname: '', password: '', adminNote: '',
                mainChannelId: '', backupChannelId: '',
                canEdit: true, canDelete: true, linkEnabled: true, enabled: true, enforceLimits: true
            };
            this.showUserDialog = true;
            this.$nextTick(() => {
                this.$refs.userFormRef?.clearValidate?.();
                this.$refs.usernameInput?.focus?.();
            });
        },
        /*
         * 编辑账户 → 独立页面（v202610221824）。
         * 原来用弹窗，但设置项已经多到弹窗装不下（头像/邮箱/2FA/会话/渠道/备注/公告），
         * 改成 /customerConfig/edit/:id，层级更清楚，也不受弹窗高度限制。
         */
        openEditDialog(row) {
            if (!row?.id) return;
            this.$router.push({ name: 'userEdit', params: { id: row.id } });
        },
        async submitUser() {
            // 非编辑态：走表单校验，错误直接显示在用户名 / 密码输入框下方
            if (!this.editingUser) {
                const ok = await new Promise((resolve) => {
                    const form = this.$refs.userFormRef;
                    if (!form) return resolve(true);
                    form.validate((valid) => resolve(!!valid));
                });
                if (!ok) {
                    this.$message.warning(this.$t('userManage.needUsernamePassword'));
                    return;
                }
            }
            this.savingUser = true;
            try {
                let res;
                if (this.editingUser) {
                    res = await axios.put(`/api/manage/users/${this.editingUser.id}`, {
                        nickname: this.userForm.nickname,
                        adminNote: this.userForm.adminNote,
                        mainChannelId: this.userForm.mainChannelId,
                        backupChannelId: this.userForm.backupChannelId,
                        canEdit: this.userForm.canEdit,
                        canDelete: this.userForm.canDelete,
                        linkEnabled: this.userForm.linkEnabled,
                        enabled: this.userForm.enabled,
                        enforceLimits: this.userForm.enforceLimits,
                    }, { withCredentials: true });
                } else {
                    res = await axios.post('/api/manage/users', {
                        username: this.userForm.username,
                        password: this.userForm.password,
                        nickname: this.userForm.nickname,
                        adminNote: this.userForm.adminNote,
                        mainChannelId: this.userForm.mainChannelId,
                        backupChannelId: this.userForm.backupChannelId,
                        canEdit: this.userForm.canEdit,
                        canDelete: this.userForm.canDelete,
                        linkEnabled: this.userForm.linkEnabled,
                        enabled: this.userForm.enabled,
                        enforceLimits: this.userForm.enforceLimits,
                    }, { withCredentials: true });
                }
                if (res.data?.success) {
                    this.$message.success(this.$t('common.success'));
                    this.showUserDialog = false;
                    await this.loadUsers();
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.savingUser = false;
            }
        },
        async toggleField(row, field, value) {
            try {
                await axios.put(`/api/manage/users/${row.id}`, { [field]: value }, { withCredentials: true });
            } catch (e) {
                row[field] = !value;
                this.$message.error(this.$t('common.failed'));
            }
        },
        // v2.6.0：openPasswordDialog / submitPassword / openProfileDialog / submitProfile 已移除
        // —— 改密码统一在用户编辑页（带原密码/邮箱验证码/2FA 三选一验证），改资料直接进编辑页
        async removeUser(row) {            try {
                await this.$confirm(this.$t('userManage.deleteConfirm', { name: row.username }), this.$t('common.warning'), {
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    type: 'warning',
                });
            } catch { return; }
            try {
                const res = await axios.delete(`/api/manage/users/${row.id}`, { withCredentials: true });
                if (res.data?.success) {
                    this.$message.success(this.$t('common.success'));
                    await this.loadUsers();
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            }
        },

        // ========== 归集展开（用户账户） ==========
        /** 展开某账户：拉取该账户名下的文件列表（按用户名归集，与 IP 视图同构） */
        async handleUserExpandChange(row, expandedRows) {
            if (!expandedRows.some(item => item.id === row.id) || row.filesLoaded || row.filesLoading) return;
            row.filesLoading = true;
            try {
                const response = await fetchWithAuth(
                    `/api/manage/cusConfig/files?uploader=${encodeURIComponent(row.username)}&count=${row.fileCount || 100}`,
                    { method: 'GET' }
                );
                const result = await response.json();
                row.data = (result.data || []).sort(this.sortByTimestamp).reverse();
                row.filesLoaded = true;
            } catch (err) {
                this.$message.error(this.$t('customerConfig.loadError'));
            } finally {
                row.filesLoading = false;
            }
        },

        // ========== IP 视图（原有逻辑） ==========
        formatTimeStamp(timeStamp) {
            return new Date(timeStamp).toLocaleString();
        },
        sortByTimestamp(a, b) {
            return new Date(a.metadata.TimeStamp) - new Date(b.metadata.TimeStamp);
        },
        async handleSwitchEnable(row) {
            const ip = row.ip;
            const enable = row.enable;
            if (enable) {
                this.blockipList = this.blockipList.filter(item => item !== ip);
                await fetchWithAuth('/api/manage/cusConfig/whiteip', { method: 'POST', body: ip });
            } else {
                this.blockipList.push(ip);
                await fetchWithAuth('/api/manage/cusConfig/blockip', { method: 'POST', body: ip });
            }
        },
        handlePageChange(page) {
            this.currentPage = page;
            if (page === Math.ceil(this.dealedData.length / this.pageSize)) this.loadMoreData();
        },
        async handleExpandChange(row, expandedRows) {
            if (!expandedRows.some(item => item.ip === row.ip) || row.filesLoaded || row.filesLoading) return;
            row.filesLoading = true;
            try {
                const response = await fetchWithAuth(`/api/manage/cusConfig/files?ip=${encodeURIComponent(row.ip)}&count=${row.count}`, { method: 'GET' });
                const result = await response.json();
                row.data = (result.data || []).sort(this.sortByTimestamp).reverse();
                row.filesLoaded = true;
            } catch (err) {
                this.$message.error(this.$t('customerConfig.loadError'));
            } finally {
                row.filesLoading = false;
            }
        },
        loadMoreData() {
            this.loading = true;
            const start = this.dealedData.length;
            Promise.all([
                fetchWithAuth(`/api/manage/cusConfig/list?start=${start}&count=20`, { method: 'GET' }).then(r => r.json()),
                fetchWithAuth('/api/manage/users/collect?mode=ip', { method: 'GET' }).then(r => r.json()).catch(() => ({})),
            ])
                .then(([result, collectJson]) => {
                    const channelByIp = {};
                    for (const it of (collectJson?.items || [])) channelByIp[it.key] = it.uploadSources || [];
                    this.dealedData = this.dealedData.concat(result.map(item => ({
                        ip: item.ip,
                        address: item.address,
                        display: item.display || '',
                        count: item.count,
                        uploadSources: channelByIp[item.ip] || [],
                        data: [],
                        filesLoaded: false,
                        filesLoading: false,
                        enable: !this.blockipList.includes(item.ip),
                    })));
                })
                .catch(() => this.$message.error(this.$t('customerConfig.loadError')))
                .finally(() => { this.loading = false; });
        },
        loadIpList() {
            this.loading = true;
            fetchWithAuth('/api/manage/cusConfig/list?count=20', { method: 'GET' })
                .then(response => response.json())
                .then(async result => {
                    const blockipListRes = await fetchWithAuth('/api/manage/cusConfig/blockipList', { method: 'GET' });
                    this.blockipList = (await blockipListRes.text()).split(',');
                    // 「上传渠道」列：按 IP 聚合的渠道集合来自 collect?mode=ip（按 ip 对齐补充）
                    let channelByIp = {};
                    try {
                        const collectRes = await fetchWithAuth('/api/manage/users/collect?mode=ip', { method: 'GET' });
                        const collectJson = await collectRes.json();
                        for (const it of (collectJson?.items || [])) channelByIp[it.key] = it.uploadSources || [];
                    } catch { /* 渠道列加载失败不阻断列表 */ }
                    this.dealedData = result.map(item => ({
                        ip: item.ip,
                        address: item.address,
                        display: item.display || '',
                        count: item.count,
                        uploadSources: channelByIp[item.ip] || [],
                        data: [],
                        filesLoaded: false,
                        filesLoading: false,
                        enable: !this.blockipList.includes(item.ip),
                    }));
                })
                .catch((err) => {
                    if (err.message !== 'Unauthorized') this.$message.error(this.$t('customerConfig.syncError'));
                })
                .finally(() => { this.loading = false; });
        },
        handleResize() { this.viewportWidth = window.innerWidth; },

        /** 页面重新可见时自动刷新（避免长时间挂着回来看到空列表） */
        onPageActivate() {
            this.loadUsers();
            this.loadNotice();
            if (this.activeModule === 'collect' && this.collectMode === 'ip') this.loadIpList();
        },

        /* ---------------- 用户公告 ---------------- */
        async loadNotice() {
            try {
                const res = await axios.get('/api/manage/users/notice', { withCredentials: true });
                this.noticeText = res.data?.success ? (res.data.data?.content || '') : '';
            } catch {
                this.noticeText = '';
            }
        },
        async saveNotice() {
            this.noticeSaving = true;
            try {
                const res = await axios.post('/api/manage/users/notice', { content: this.noticeText }, { withCredentials: true });
                if (res.data?.success) this.$message.success(this.$t('common.success'));
                else this.$message.error(res.data?.message || this.$t('common.failed'));
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.noticeSaving = false;
            }
        },
    },
    mounted() {
        window.addEventListener('resize', this.handleResize);
        this.initializeBackground('adminBkImg', '.container', false, true);
        this.loadUsers();
        this.loadNotice();
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.handleResize);
    }
};
</script>

<style scoped src="@/styles/admin-common.css"></style>
<style scoped>
.admin-note-hint {
    font-size: 12px;
    font-weight: 400;
    color: var(--el-text-color-secondary);
    margin-left: 6px;
}
/* 用户公告区块（列表下方）
 * 宽度规则与 .main-table 完全一致（95% + max-width 1400px 居中）；
 * box-sizing:border-box 必须显式声明 —— 否则左右各 18px 内边距会把 95% 撑成
 * 「95% + 36px」，在窄屏上溢出容器，视觉上也不再居中（v2.3.0 修复）。 */
.notice-block {
    width: 95%;
    max-width: 1400px;
    box-sizing: border-box;
    margin: 16px auto 24px;
    padding: 16px 18px;
    border-radius: 16px;
    border: 1px solid var(--glass-border);
    background: var(--glass-bg);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    box-shadow: var(--glass-shadow);
}
.notice-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 10px;
}
.notice-title { font-size: 14px; font-weight: 600; }
.notice-hint {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    font-weight: 400;
    line-height: 1.5;
}
.notice-textarea { width: 100%; }
.notice-footer {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
}
.notice-body {
    font-size: 14px;
    line-height: 1.75;
    word-break: break-word;
}
.notice-empty {
    font-size: 13px;
    color: var(--el-text-color-secondary);
}
.main-table {
    width: 95%;
    max-width: 1400px;
    /* 与公告块同一套盒模型，95% 宽 + 1px 边框才不会各自算各自的 */
    box-sizing: border-box;
    border-radius: 16px;
    box-shadow: var(--glass-shadow);
    min-height: 420px;
    overflow: hidden;
    border: 1px solid var(--glass-border);
    background: var(--glass-bg) !important;
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
}

.main-table :deep(.el-table__inner-wrapper),
.main-table :deep(.el-table__header-wrapper),
.main-table :deep(.el-table__body-wrapper),
.main-table :deep(.el-table__row),
.main-table :deep(.el-table__row td) {
    background: transparent !important;
}
.main-table :deep(.el-table__header th) {
    background: transparent !important;
}
.main-table :deep(.el-table__row:hover td) {
    background: var(--glass-header-bg) !important;
}
.main-table :deep(.el-table__expanded-cell) {
    background: var(--glass-header-bg) !important;
}

.container {
    background: var(--admin-container-bg-color);
    min-height: 100vh;
    font-family: 'Arial', sans-serif;
    color: var(--admin-container-color);
    margin: 0;
    padding: 0;
}

.main-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 32px;
}

/* 模块切换（用户账户管理 / 归集统计） */
.module-switch {
    width: 95%;
    max-width: 1400px;
    display: flex;
    align-items: center;
    margin-bottom: 14px;
}

.collect-switch {
    width: 95%;
    max-width: 1400px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
}

.module-hint {
    flex: 1 1 auto;
    min-width: 0;
    text-align: right;
    font-size: 13px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
}
.collect-icon, .create-icon {
    margin-right: 6px;
}

.channel-text {
    font-size: 13px;
    color: var(--admin-container-color);
}

.permission-row {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
}
.permission-row > span {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
}
/* 「类型和大小限制」：换行展示，并带说明图标（悬停看完整含义） */
.permission-row > span.permission-hint {
    flex-basis: 100%;
    gap: 6px;
}
.permission-hint-icon {
    color: var(--text-color-secondary, #909399);
    cursor: help;
    font-size: 13px;
}
.full-width {
    width: 100%;
}

@media (max-width: 768px) {
    .main-container {
        margin-top: 12px;
    }
    .module-switch,
    .collect-switch {
        flex-direction: column;
        align-items: stretch;
    }
    .module-hint {
        text-align: left;
    }
    .create-user-btn {
        width: 100%;
    }
    .allow-upload-switch :deep(.el-switch__label) {
        display: none;
    }
    .main-table :deep(.el-table-fixed-column--right),
    .main-table :deep(.el-table__fixed-right-patch) {
        background: var(--glass-bg) !important;
        backdrop-filter: blur(20px) saturate(1.4);
        -webkit-backdrop-filter: blur(20px) saturate(1.4);
    }
    .main-table :deep(.el-table__body-wrapper .el-table__row td.el-table-fixed-column--right) {
        background: var(--glass-bg) !important;
        backdrop-filter: blur(20px) saturate(1.4);
        -webkit-backdrop-filter: blur(20px) saturate(1.4);
    }
    .main-table :deep(.el-table__header-wrapper .el-table-fixed-column--right),
    .main-table :deep(.el-table__body-wrapper .el-table__row:hover .el-table-fixed-column--right) {
        background: var(--glass-header-bg) !important;
        backdrop-filter: blur(20px) saturate(1.4);
        -webkit-backdrop-filter: blur(20px) saturate(1.4);
    }
}
</style>
