<template>
    <div class="container">
    <div class="upload-home">
        <!-- 桌面端按钮 -->
        <ToggleDark class="toggle-dark-button desktop-only"/>
        <!--
            注意：这里直接把 el-button 作为 el-dropdown 的触发元素。
            早前在 el-button 外面又套了一层 el-tooltip，导致 dropdown 的点击事件
            被内层 tooltip 吞掉、菜单无法展开 —— 提示改用原生 title 属性。
        -->
        <el-dropdown class="more-dropdown desktop-only" trigger="click" @command="handleDesktopMenuCommand">
            <el-button class="more-button" :title="$t('upload.moreMenu')" :aria-label="$t('upload.moreMenu')">
                <font-awesome-icon icon="ellipsis-v" size="lg"/>
            </el-button>
            <template #dropdown>
                <el-dropdown-menu>
                    <el-dropdown-item command="showHistory">
                        <font-awesome-icon icon="history" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.history') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="showAnnouncement" :disabled="!announcementAvailable">
                        <font-awesome-icon icon="bullhorn" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.announcement') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="toggleLanguage">
                        <font-awesome-icon icon="globe" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $i18n.locale === 'zh-CN' ? 'English' : '简体中文' }}
                    </el-dropdown-item>
                    <el-dropdown-item v-if="isAdminRole" command="systemManage">
                        <font-awesome-icon icon="cogs" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.systemManage') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="viewDocs">
                        <font-awesome-icon icon="book" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.viewDocs') }}
                    </el-dropdown-item>
                    <!-- v2.7.0：退出登录迁入右上角更多菜单（文字模式，原右下角快捷栏入口移除） -->
                    <el-dropdown-item command="logout" divided class="menu-item-logout">
                        <font-awesome-icon icon="sign-out-alt" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.logout') }}
                    </el-dropdown-item>
                </el-dropdown-menu>
            </template>
        </el-dropdown>
        <!-- v2.8.9：后台关闭「上传目录选项」时，右上角目录输入框整体隐藏 -->
        <div
            v-if="showDirectorySuggestions"
            class="upload-folder-container"
            :class="{ 'no-announcement': !announcementAvailable, 'is-active': isFolderInputActive }"
        >
            <div class="upload-folder" :class="{ 'active': isFolderInputActive }">
                <DirectorySuggestionInput
                    v-if="showDirectorySuggestions"
                    v-model="uploadFolder"
                    class="inner-folder-input"
                    :placeholder="$t('upload.folderPlaceholder')"
                    @focus="handleFolderInputFocus"
                    @blur="handleFolderInputBlur"
                    @select="handleDirectorySelect"
                />
                <el-input
                    v-else
                    class="inner-folder-input"
                    v-model="uploadFolder"
                    :placeholder="$t('upload.folderPlaceholder')"
                    autocomplete="on"
                    @focus="handleFolderInputFocus"
                    @blur="handleFolderInputBlur"
                />
            </div>
            <!-- v3.0.0（R12）：目录树选择按钮现在位于「上传设置 → 上传目录」输入框前面 -->
        </div>
        <!-- 上传方式切换：由上「上传框上方」的标签页承担（原右上角按钮已迁移） -->

        <!-- 移动端更多按钮 -->
        <el-dropdown class="mobile-more-dropdown mobile-only" trigger="click" @command="handleMobileMenuCommand">
            <!-- 图标按钮：无障碍名称交给 aria-label（原 .visually-hidden 文本类未定义样式，
                 移动端会把它当普通文字渲染，直接把图标挤出行外，故移除） -->
            <el-button class="mobile-more-button" :aria-label="$t('upload.moreMenu')">
                <font-awesome-icon icon="ellipsis-v" size="lg"/>
            </el-button>
            <template #dropdown>
                <el-dropdown-menu>
                    <el-dropdown-item command="toggleTheme">
                        <font-awesome-icon :icon="getThemeIcon()" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ getThemeText() }}
                    </el-dropdown-item>
                    <el-dropdown-item command="showHistory">
                        <font-awesome-icon icon="history" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.history') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="showAnnouncement" :disabled="!announcementAvailable">
                        <font-awesome-icon icon="bullhorn" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.announcement') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="toggleLanguage">
                        <font-awesome-icon icon="globe" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $i18n.locale === 'zh-CN' ? 'English' : '简体中文' }}
                    </el-dropdown-item>
                    <el-dropdown-item v-if="isAdminRole" command="systemManage">
                        <font-awesome-icon icon="cogs" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.systemManage') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="viewDocs">
                        <font-awesome-icon icon="book" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.viewDocs') }}
                    </el-dropdown-item>
                    <!-- v2.7.0：退出登录迁入右上角更多菜单（移动端同款文字项） -->
                    <el-dropdown-item command="logout" divided class="menu-item-logout">
                        <font-awesome-icon icon="sign-out-alt" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('upload.logout') }}
                    </el-dropdown-item>
                </el-dropdown-menu>
            </template>
        </el-dropdown>
        <div
            class="quick-toolbar"
            :class="{ 'is-expanded': isQuickToolbarOpen }"
            @mouseleave="handleQuickToolbarLeave"
        >
            <div class="quick-toolbar-actions">
                <div class="quick-toolbar-actions-inner">
                    <!-- v2.7.0：退出登录已迁至右上角「更多菜单」（文字模式），快捷栏不再保留 -->
                    <el-tooltip :disabled="disableTooltip || !isQuickToolbarOpen" :content="$t('upload.manageFiles')" placement="left" :hide-after="0" :show-after="1000">
                        <el-button class="quick-toolbar-button" @click="handleQuickToolbarCommand('manage')">
                            <font-awesome-icon icon="folder" class="quick-toolbar-icon"/>
                        </el-button>
                    </el-tooltip>
                    <!--
                        v3.0.0（R12）：「选择目录」按钮已迁入「上传设置 → 上传目录」输入框前面
                        （用户要求把右下角的目录树选择移到上传目录输入框前），
                        快捷栏不再保留这个按钮。
                    -->
                    <el-tooltip :disabled="disableTooltip || !isQuickToolbarOpen" :content="$t('upload.linkFormat')" placement="left" :hide-after="0" :show-after="1000">
                        <el-button class="quick-toolbar-button" @click="handleQuickToolbarCommand('linkFormat')">
                            <font-awesome-icon icon="link" class="quick-toolbar-icon"/>
                        </el-button>
                    </el-tooltip>
                    <!--
                        v3.0.0（R12）：移动端「拍摄」按钮移进这个隐藏区（点击右下角箭头才展开），
                        不再常驻悬浮栏上，避免误触；桌面端本来就不显示（快捷栏里没有相机入口）。
                    -->
                    <el-tooltip :disabled="disableTooltip || !isQuickToolbarOpen" :content="$t('upload.takePhoto')" placement="left" :hide-after="0" :show-after="1000">
                        <el-button class="quick-toolbar-button quick-toolbar-camera" @click="openCamera">
                            <font-awesome-icon icon="camera" class="quick-toolbar-icon"/>
                        </el-button>
                    </el-tooltip>
                </div>
            </div>
            <!--
                v3.0.0（R8）：移动端「拍照」按钮 —— 点击调起相机拍照。
                v3.0.0（R12）：已移入上面的快捷栏隐藏区（点箭头展开时才显示）。
            -->
            <!-- v2.8.8：「登记文件」入口，位于「上传设置」正上方（同一快捷栏，同一按钮样式） -->
            <el-tooltip :disabled="disableTooltip" :content="$t('upload.recordFile')" placement="left" :hide-after="0" :show-after="1000">
                <el-button class="quick-toolbar-button" @click="openRecordDialog">
                    <font-awesome-icon icon="file-circle-plus" class="quick-toolbar-icon"/>
                </el-button>
            </el-tooltip>
            <el-tooltip :disabled="disableTooltip" :content="$t('upload.settings')" placement="left" :hide-after="0" :show-after="1000">
                <el-button class="quick-toolbar-button quick-toolbar-settings" @click="openCompressDialog">
                    <font-awesome-icon icon="cloud-upload" class="quick-toolbar-icon"/>
                    <!-- v3.0.0（R9）：上传设置选了「归属实例」后，按钮右上角显示所选实例序号（默认实例 = 0） -->
                    <span v-if="uploadSettingsBadge !== null" class="settings-instance-badge">{{ uploadSettingsBadge }}</span>
                </el-button>
            </el-tooltip>
            <el-tooltip :disabled="disableTooltip" :content="$t('upload.moreActions')" placement="left" :hide-after="0" :show-after="1000">
                <el-button
                    class="quick-toolbar-button quick-toolbar-more"
                    :class="{ 'is-active': isQuickToolbarOpen }"
                    :aria-expanded="isQuickToolbarOpen"
                    @mouseenter="handleQuickToolbarMoreEnter"
                    @click="toggleQuickToolbar"
                >
                    <font-awesome-icon icon="chevron-down" class="quick-toolbar-icon quick-toolbar-toggle-icon"/>
                </el-button>
            </el-tooltip>
        </div>
        <!-- v3.0.0（R8）：拍照用的隐藏 input（capture 调起系统相机；视觉上不可见、不占位） -->
        <input
            ref="cameraInput"
            type="file"
            accept="image/*"
            capture="environment"
            class="camera-input-hidden"
            @change="handleCameraCapture"
        />
        <!--
            v3.0.0（R8.1）：拍照弹窗 —— 用 getUserMedia 做实时预览后拍照。
            桌面浏览器会忽略 input 的 capture 属性（直接弹文件选择），所以不能只靠
            <input capture>；这里优先真实摄像头，失败/不可用时再退回系统相机。
        -->
        <el-dialog
            v-model="showCameraDialog"
            :title="$t('upload.cameraTitle')"
            class="camera-dialog"
            width="min(560px, 94vw)"
            append-to-body
            destroy-on-close
            :close-on-click-modal="false"
            @closed="stopCamera"
        >
            <div class="camera-stage" @click="toggleCameraUi">
                <video ref="cameraVideo" class="camera-video" autoplay playsinline muted></video>
                <div v-if="cameraStarting" class="camera-mask">{{ $t('upload.cameraStarting') }}</div>
                <div v-else-if="cameraError" class="camera-mask is-error">{{ cameraError }}</div>
            </div>
            <!--
                v3.0.0（R9）：移动端「拍摄」等操作按钮放进隐藏区域 —— 默认收起，
                点击画面显示 / 再点收起（沉浸式取景，避免误触）；桌面端不受影响始终显示。
            -->
            <div class="camera-actions" :class="{ 'is-ui-hidden': !cameraUiVisible }">
                <el-button @click="openSystemCamera">
                    <font-awesome-icon icon="camera" class="camera-action-icon"/>{{ $t('upload.cameraSystem') }}
                </el-button>
                <el-button :disabled="!cameraReady" @click="switchCamera">
                    <font-awesome-icon icon="sync-alt" class="camera-action-icon"/>{{ $t('upload.cameraSwitch') }}
                </el-button>
                <el-button type="primary" :disabled="!cameraReady" @click="capturePhoto">
                    <font-awesome-icon icon="camera" class="camera-action-icon"/>{{ $t('upload.cameraCapture') }}
                </el-button>
                <!-- v3.0.0（R14）：支持连拍 —— 拍完不再自动关窗，点「完成」才关闭摄像头 -->
                <el-button @click="closeCameraDialog">
                    <font-awesome-icon icon="check" class="camera-action-icon"/>{{ $t('upload.cameraDone') }}
                </el-button>
            </div>
        </el-dialog>
        <!--
            v3.0.0：左上角头像 logo —— 点击弹出「切换实例」弹窗（不再直接跳转用户管理）；
            右上角序号角标 = 按实例创建时间升序的序号（默认实例不显示，第一个创建的实例 = 1）。
            @click.capture.prevent 在捕获阶段拦截 <a> 默认导航（Logo.vue 为公共组件不改）。
        -->
        <div class="logo-instance-wrap" :title="$t('instancePicker.title')" @click.capture.prevent="openInstanceDialog">
            <Logo position="static" href="/customerConfig" target="_blank" :useConfigLink="false"/>
            <span v-if="instanceBadgeNumber" class="instance-badge">{{ instanceBadgeNumber }}</span>
        </div>
        <div class="header">
            <h1 class="title">
                <span class="title-crayon-text" aria-hidden="true">{{ ownerName }}</span>
                <!-- v2.6.0：移除图床名称的跳转链接（仅去 <a>，样式不变） -->
                <span class="title-base-text">
                    <span class="main-title">{{ ownerName }}</span>
                </span>
            </h1>
        </div>
        <!-- 上传方式标签页（原右上角切换按钮迁移至此，位于上传框上方） -->
        <div class="upload-stack">
        <div class="upload-method-tabs" role="tablist" :aria-label="$t('upload.switchUploadMethod')">
            <button
                type="button"
                role="tab"
                class="upload-method-tab"
                :class="{ 'is-active': uploadMethod === 'default' }"
                :aria-selected="uploadMethod === 'default'"
                @click="setUploadMethod('default')"
            >
                <font-awesome-icon icon="folder-open" class="upload-method-tab-icon"/>
                <span>{{ $t('upload.defaultTab') }}</span>
            </button>
            <button
                type="button"
                role="tab"
                class="upload-method-tab"
                :class="{ 'is-active': uploadMethod === 'paste' }"
                :aria-selected="uploadMethod === 'paste'"
                @click="setUploadMethod('paste')"
            >
                <font-awesome-icon icon="link" class="upload-method-tab-icon"/>
                <span>{{ $t('upload.linkTab') }}</span>
            </button>
        </div>
        <!-- v2.8.9：convertToWebp 改用 v-model —— 原先只传 prop 未监听 update 事件，顶栏「转为WebP」开关点不动 -->
        <UploadForm
            ref="uploadForm"
            :selectedUrlForm="selectedUrlForm"
            v-model:customerCompress="customerCompress"
            :compressBar="compressBar"
            :serverCompress="serverCompress"
            :uploadChannel="uploadChannel"
            :channelName="channelName"
            :uploadNameType="uploadNameType"
            :useCustomUrl="useCustomUrl"
            :customUrlPrefix="customUrlPrefix"
            :autoRetry="autoRetry"
            :urlPrefix="urlPrefix"
            :uploadMethod="uploadMethod"
            :uploadFolder="uploadFolder"
            v-model:convertToWebp="convertToWebp"
            :autoUpload="autoUpload"
            @update:autoUpload="autoUpload = $event"
            :backupChannel="backupChannel"
            :instanceId="uploadInstanceId"
            :compressPercent="compressPercent"
            :limitCompressExts="limitCompressExts"
            :compressEnabled="compressEnabled"
            :webpEnabled="webpEnabled"
            :transcodeChoice="transcodeChoice"
            :retryTimes="retryTimes"
            :uploadConcurrency="uploadConcurrency"
            :localAutoRetry="localAutoRetry"
            @update:localAutoRetry="localAutoRetry = $event"
            @changeMethod="setUploadMethod"
            class="upload"
        />
        </div>
        <el-dialog :title="$t('settings.linkFormatTitle')" v-model="showUrlDialog" :width="dialogWidth" :show-close="false" class="settings-dialog settings-dialog-scope">
            <div class="dialog-section">
                <div class="section-header">
                    <span class="section-title">{{ $t('settings.defaultCopyLink') }}</span>
                </div>
                <div class="section-content">
                    <el-radio-group v-model="selectedUrlForm" @change="changeUrlForm" class="radio-card-group grid-2x2">
                        <el-radio value="url" class="radio-card">
                            <font-awesome-icon icon="link" class="radio-icon"/>
                            <span>{{ $t('settings.rawLink') }}</span>
                        </el-radio>
                        <el-radio value="md" class="radio-card">
                            <font-awesome-icon icon="code" class="radio-icon"/>
                            <span>MarkDown</span>
                        </el-radio>
                        <el-radio value="html" class="radio-card">
                            <font-awesome-icon icon="code-branch" class="radio-icon"/>
                            <span>HTML</span>
                        </el-radio>
                        <el-radio value="ubb" class="radio-card">
                            <font-awesome-icon icon="quote-right" class="radio-icon"/>
                            <span>BBCode</span>
                        </el-radio>
                    </el-radio-group>
                </div>
            </div>
            
            <div class="dialog-section">
                <div class="section-header">
                    <span class="section-title">{{ $t('settings.customLink') }}</span>
                    <el-tooltip :content="$t('settings.customLinkTooltip')" placement="top" raw-content>
                        <font-awesome-icon icon="question-circle" class="section-help-icon"/>
                    </el-tooltip>
                </div>
                <div class="section-content">
                    <div class="setting-item">
                        <span class="setting-label">{{ $t('settings.enableCustom') }}</span>
                        <el-switch v-model="useCustomUrl" active-value="true" inactive-value="false" />
                    </div>
                    <div class="setting-item" v-if="useCustomUrl === 'true'">
                        <span class="setting-label">{{ $t('settings.customPrefix') }}</span>
                        <el-input v-model="customUrlPrefix" :placeholder="$t('settings.customPrefixPlaceholder')" class="setting-input"/>
                    </div>
                </div>
            </div>
            
            <div class="dialog-action">
                <el-button type="primary" @click="showUrlDialog = false" class="confirm-btn">{{ $t('settings.confirm') }}</el-button>
            </div>
        </el-dialog>
        <UploadSettingsDialog
            v-model="showCompressDialog"
            v-model:channelName="channelName"
            v-model:backupChannel="backupChannel"
            v-model:uploadInstanceId="uploadInstanceId"
            :instances="instances"
            :defaultChannel="defaultChannelInfo"
            :defaultBackupChannel="defaultBackupChannelInfo"
            v-model:uploadFolder="uploadFolder"
            :directoryPickerEnabled="showDirectorySuggestions"
            v-model:customerCompress="customerCompress"
            v-model:compressBar="compressBar"
            v-model:compressPercent="compressPercent"
            v-model:serverCompress="serverCompress"
            v-model:limitCompressExts="limitCompressExts"
            :compressEnabled="compressEnabled"
            :transcodePolicy="transcodePolicy"
            v-model:transcodeChoice="transcodeChoice"
            :transcodeGlobal="transcodeGlobal"
            :autoRetryEnabled="autoRetryEnabled"
            v-model:localAutoRetry="localAutoRetry"
            :webpEnabled="webpEnabled"
        />
        <!-- v2.8.8：登记文件弹窗（与「上传设置」同尺寸同风格） -->
        <RecordFileDialog
            v-model="showRecordDialog"
            :isAdmin="isAdminRole"
            @registered="handleRecorded"
        />
    </div>
    <Footer class="footer"/>
    <!-- v3.0.0：切换实例弹窗（点击左上角头像打开；默认实例永远第一项） -->
    <el-dialog :title="$t('instancePicker.title')" v-model="showInstanceDialog" :width="dialogWidth" center class="instance-picker-dialog">
        <div class="instance-list">
            <div
                class="instance-item"
                :class="{ 'is-active': currentInstanceId === '' }"
                @click="switchInstance('')"
            >
                <span class="instance-name">{{ $t('instancePicker.defaultInstance') }}</span>
                <font-awesome-icon v-if="currentInstanceId === ''" icon="check" class="instance-check"/>
            </div>
            <div
                v-for="(inst, idx) in instances"
                :key="inst.id"
                class="instance-item"
                :class="{ 'is-active': String(currentInstanceId) === String(inst.id) }"
                @click="switchInstance(inst.id)"
            >
                <!-- v3.0.0（第三轮）：实例名称前加序号（与头像角标、后台「页面切换」用同一套 1-based 序号）；默认实例不显示序号 -->
                <span class="instance-seq">{{ idx + 1 }}</span>
                <span class="instance-name">{{ inst.name }}</span>
                <span v-if="inst.note" class="instance-note">{{ inst.note }}</span>
                <font-awesome-icon
                    v-if="String(currentInstanceId) === String(inst.id)"
                    icon="check"
                    class="instance-check"
                />
            </div>
            <div v-if="!instances.length" class="instance-empty">{{ $t('instancePicker.empty') }}</div>
        </div>
        <!-- v3.0.0：弹窗下方并排两个文字链接（次要样式）→ 用户管理 / 当前账户的实例管理 -->
        <div class="instance-dialog-links">
            <el-button link class="instance-dialog-link" @click="openUserManagement">
                {{ $t('instancePicker.userManage') }}
            </el-button>
            <span class="instance-dialog-link-sep" aria-hidden="true"></span>
            <el-button link class="instance-dialog-link" @click="openInstanceManagement">
                {{ $t('instancePicker.manage') }}
            </el-button>
        </div>
    </el-dialog>
    <el-dialog :title="$t('upload.announcementTitle')" v-model="showAnnouncementDialog" :width="dialogWidth" :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false" center>
        <div v-html="announcementContent"></div>
        <template #footer>
            <span class="dialog-footer">
                <el-button type="primary" @click="acknowledgeAnnouncement">{{ $t('upload.announcementAck') }}</el-button>
            </span>
        </template>
    </el-dialog>
    </div>
</template>

<script>
import UploadForm from '@/components/upload/UploadForm.vue'
import Footer from '@/components/Footer.vue'
import ToggleDark from '@/components/ToggleDark.vue'
import Logo from '@/components/Logo.vue'
import { setLocale } from '@/locales'
import { writeThemeCookie } from '@/utils/themeCookie'
import UploadSettingsDialog from '@/components/upload/UploadSettingsDialog.vue'
import RecordFileDialog from '@/components/upload/RecordFileDialog.vue'
import DirectoryTreePicker from '@/components/DirectoryTreePicker.vue'
import DirectorySuggestionInput from '@/components/DirectorySuggestionInput.vue'
import backgroundManager from '@/mixins/backgroundManager'
import pageActivation from '@/mixins/pageActivation'
import axios from '@/utils/axios'
import { ref } from 'vue'
import { mapGetters } from 'vuex'
import { validateFolderPath } from '@/utils/pathValidator'
import { getLinkPrefix } from '@/utils/fileLink'
import { filesToUploadEntries } from '@/utils/upload/directoryTraversal'

export default {
    name: 'UploadHome',
    mixins: [backgroundManager, pageActivation],
    data() {
        return {
            selectedUrlForm: ref(''),
            showUrlDialog: false,
            showCompressDialog: false,
            customerCompress: true, //上传前压缩
            compressBar: 5, //压缩阈值（MB）
            convertToWebp: false, //转换为WebP格式
            serverCompress: true, //服务器端压缩
            uploadChannel: '', //上传渠道（仅保留 'external' 外链上传特殊值）
            channelName: '', //指定的存储渠道 ID（'' = 默认，跟随全局）
            backupChannel: '', //备份渠道 ID（'' = 跟随全局；'none' = 不备份）
            uploadInstanceId: '', // v3.0.0（R8）归属实例（'' = 跟随当前实例；'__default__' = 默认实例；其它 = 实例 ID），仅本次会话生效
            // v3.0.0（R8.1）：拍照弹窗状态 —— 优先用 getUserMedia 实时预览，失败才回退系统相机 input
            showCameraDialog: false,
            cameraStream: null,
            cameraFacing: 'environment', // environment=后置 / user=前置
            cameraUiVisible: true, // v3.0.0（R9）：拍摄界面操作按钮可见性（移动端默认收起，点击画面唤出）
            cameraReady: false,
            cameraStarting: false,
            cameraError: '',
            uploadNameType: '', //上传文件命名方式
            customUrlPrefix: '', //自定义链接前缀
            useCustomUrl: 'false', //是否启用自定义链接格式
            autoRetry: true, //失败自动切换（v2.8.8：值来自后台「上传相关配置 → 自动重试」）
            localAutoRetry: true, // v2.8.9：前台「失败自动重试」开关（上传设置 → 其他，只管上传/转存）
            compressPercent: 80, //压缩期望百分比（压到原体积的 x%）
            limitCompressExts: '', // 允许压缩格式覆盖（仅本次页面生效，刷新清空）
            transcodeChoice: '', // 视频兼容转码（'' 跟随全局 / 'on' / 'off'），仅「用户决定」策略下可见
            showRecordDialog: false, // 「登记文件」弹窗
            customDomain: '', //自定义访问域名（所有文件链接统一使用）
            autoUpload: localStorage.getItem('gohub_autoUpload') !== '0', //自动上传（记忆模式：记住上次选择，刷新不重置）
            useDefaultWallPaper: false,
            uploadMethod: 'default', //上传方式
            uploadFolder: '', // 上传文件夹
            isFolderInputActive: false,
            isQuickToolbarOpen: false,
            isQuickToolbarPinned: false,
            showAnnouncementDialog: false, // 控制公告弹窗的显示
            announcementContent: '', // 公告内容
            displayedAnnouncementRefreshAt: null, // 当前弹窗所展示的公告版本
            themeMode: 'auto', // 主题模式：light, dark, auto
            // ── v3.0.0：实例切换 ──
            showInstanceDialog: false, // 「切换实例」弹窗
            instances: [], // 实例列表（按创建时间升序；空 = 只有默认实例）
            currentInstanceId: (() => {
                try { return localStorage.getItem('gohub_instance_id') || '' } catch (e) { return '' }
            })(), // 当前实例（'' = 默认）
            instanceBadgeNumber: 0, // 头像右下角序号角标（默认实例 = 0 不显示）
        }
    },
    watch: {
        // 自动/手动切换记忆：用户选了「手动」后刷新页面仍保持手动
        autoUpload(val) {
            try { localStorage.setItem('gohub_autoUpload', val ? '1' : '0'); } catch (e) { /* 隐私模式忽略 */ }
        },
        customerCompress(val) {
            this.updateCompressConfig('customerCompress', val)
        },
        // v2.8.9：前台「失败自动重试」开关记忆到本地配置
        localAutoRetry(val) {
            this.updateCompressConfig('localAutoRetry', val)
        },
        compressBar(val) {
            // 确保值在有效范围内
            if (val === null || val === undefined || val < 1) {
                this.compressBar = 1
                return
            }
            this.updateCompressConfig('compressBar', val)
        },
        compressPercent(val) {
            let v = Number(val)
            if (!Number.isFinite(v)) v = 80
            v = Math.min(100, Math.max(10, Math.round(v)))
            if (v !== val) {
                this.compressPercent = v
                return
            }
            this.updateCompressConfig('compressPercent', v)
        },
        serverCompress(val) {
            this.updateCompressConfig('serverCompress', val)
        },
        convertToWebp(val) {
            this.updateCompressConfig('convertToWebp', val)
        },
        uploadChannel(val) {
            // uploadChannel 仅保留 'external'（链接上传）特殊值；
            // 常规上传一律由 channelName（默认为主渠道）决定
            this.updateStoreUploadChannel(val)
        },
        channelName(val) {
            // 确保清空时保存空字符串而不是null
            this.$store.commit('setStoreChannelName', val || '')
        },
        backupChannel() {
            // 备份渠道只在本次会话内生效（刷新后回到「默认」），无需持久化
        },
        uploadNameType(val) {
            this.updateStoreUploadNameType(val)
        },
        customUrlPrefix(val) {
            this.$store.commit('setCustomUrlSettings', { key: 'customUrlPrefix', value: val })
        },
        useCustomUrl(val) {
            this.$store.commit('setCustomUrlSettings', { key: 'useCustomUrl', value: val })
        },
        /*
         * v2.8.8：自动重试改由后台统一配置，前台不再持久化 —— 移除写 store 的副作用。
         */
        uploadFolder(val) {
            // 实时输入时用非 strict 模式，不检查末尾的单独 . 以允许继续输入如 .123
            if (this.validateUploadFolder(val, false)) {
                // 非 strict 通过后，再用 strict 模式静默检查，只有完全合法才更新 store
                const strictResult = validateFolderPath(val, { strict: true })
                if (strictResult.valid) {
                    this.$store.commit('setStoreUploadFolder', val)
                }
                // strict 不通过时不更新 store，等失焦时提示并回滚
            } else {
                this.$nextTick(() => {
                    this.uploadFolder = this.storeUploadFolder
                })
            }
        }
    },
    computed: {
        ...mapGetters(['userConfig', 'uploadCopyUrlForm', 'compressConfig', 'storeUploadChannel', 'storeChannelName', 'storeUploadNameType', 'customUrlSettings', 'storeAutoRetry', 'storeUploadMethod', 'storeUploadFolder', 'isAdminRole', 'sessionUser']),
        ownerName() {
            return this.userConfig?.ownerName || 'GoHub'
        },
        /**
         * v3.0.0（R9）：「上传设置」按钮右上角的实例序号角标 ——
         *   未选归属实例（跟随当前）→ null（不显示）；
         *   选「默认实例」(__default__) → 0；
         *   选具体实例 → 该实例按创建时间升序的序号（1 起）。
         */
        uploadSettingsBadge() {
            const v = String(this.uploadInstanceId || '')
            if (!v) return null
            if (v === '__default__') return 0
            const idx = this.instances.findIndex(i => String(i.id) === v)
            return idx >= 0 ? idx + 1 : 0
        },
        /**
         * 当前「生效的」主存储渠道 —— 统一取后端 getStorageChannel(账户, 'main') 的结果：
         *   登录账户在「用户管理」里指定了主渠道 → 用指定的；
         *   未指定 → 后台「上传设置」里的全局主渠道。
         * 上传设置里「存储渠道」选「默认」时，用它把实际落点显示出来。
         */
        defaultChannelInfo() {
            return this.userConfig?.mainChannel || this.userConfig?.defaultChannel || null
        },
        /** 当前「生效的」备份渠道 —— 同样来自 getStorageChannel(账户, 'backup') */
        defaultBackupChannelInfo() {
            return this.userConfig?.backupChannel || null
        },
        /** 标题链接：指向本站（页脚的传送门语义已由「页脚设置 → 页脚自定义代码」承担） */
        siteLink() {
            return '/'
        },
        dialogWidth() {
            return window.innerWidth > 768 ? '50%' : '90%'
        },
        disableTooltip() {
            return window.innerWidth < 768
        },
        urlPrefix() {
            // 全站统一出口：后端已按「自定义访问域名 > 默认URL前缀 > 本站 /file/」算好
            return getLinkPrefix()
        },
        announcementAvailable() {
            return !!this.userConfig?.announcement
        },
        // 是否显示目录候选项（从 userConfig 获取）
        showDirectorySuggestions() {
            return this.userConfig?.showDirectorySuggestions ?? false
        },
        /** v2.8.8：后台「文件压缩」总开关（关闭时前台所有压缩入口都不显示） */
        compressEnabled() {
            return this.userConfig?.compressEnabled !== false
        },
        /** v2.8.8：后台「WebP转换」总开关（关闭时顶栏「转换为WebP」按钮不加载） */
        webpEnabled() {
            return this.userConfig?.webpEnabled === true
        },
        /** v2.8.8：账户级视频兼容转码策略（inherit/off/on/user） */
        transcodePolicy() {
            return this.userConfig?.transcodePolicy || 'inherit'
        },
        /** v2.8.8：后台全局「视频兼容转码」当前值（给「跟随全局」展示实际效果） */
        transcodeGlobal() {
            return this.userConfig?.transcodeGlobal !== false
        },
        /** v2.8.9：后台「失败自动重试」总开关 —— 关闭时前台「其他」模块与自动重试一起关掉 */
        autoRetryEnabled() {
            return this.userConfig?.autoRetry !== false
        },
        /** v2.8.9：失败重试次数上限（后台配置；0 = 不限制；空 = 3） */
        retryTimes() {
            const raw = this.userConfig?.retryTimes
            if (raw === undefined || raw === null || raw === '') return 3
            const n = Number(raw)
            return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3
        },
        /** v3.0.0（R11）：前端并发数（后台「上传相关配置 → 前端并发数」；留空 = 3，范围 1~10） */
        uploadConcurrency() {
            const raw = this.userConfig?.uploadConcurrency
            const n = Number(raw)
            if (!Number.isFinite(n) || n <= 0) return 3
            return Math.min(10, Math.max(1, Math.floor(n)))
        }
    },
    beforeUnmount() {
        // 离开上传页时释放摄像头，避免指示灯常亮
        this.stopCamera()
    },
    mounted() {
        // 初始化背景图，启用自动创建元素
        this.initializeBackground('uploadBkImg', '.container', true, true)

        // 读取用户选择的链接格式（优先用户本地偏好，其次系统默认）
        this.selectedUrlForm = this.uploadCopyUrlForm || this.userConfig?.defaultUrlForm || 'url'
        // 读取用户选择的压缩设置（优先用户设置，其次系统默认配置）
        this.customerCompress = this.compressEnabled
            ? (this.compressConfig.customerCompress ?? this.parseBoolean(this.userConfig?.defaultCustomerCompress, true))
            : false
        // 压缩期望：百分比（前端设置优先，其次后台默认，兜底 80）
        this.compressPercent = this.compressConfig.compressPercent ?? this.parseNumber(this.userConfig?.defaultCompressQuality, 80)
        if (!(this.compressPercent >= 10 && this.compressPercent <= 100)) this.compressPercent = 80
        this.compressBar = this.compressConfig.compressBar ?? this.parseNumber(this.userConfig?.defaultCompressBar, 5)
        this.serverCompress = this.compressConfig.serverCompress ?? true
        // v2.8.8：WebP 转换以「后台 WebP转换 总开关」为前提，关闭时强制不转换
        this.convertToWebp = this.webpEnabled &&
            (this.compressConfig.convertToWebp ?? this.parseBoolean(this.userConfig?.defaultConvertToWebp, false))
        // 读取用户选择的上传渠道：上传渠道仅保留外链特殊值，常规上传走默认主渠道
        this.uploadChannel = ''
        // 页面刷新后一律复位为「默认」渠道（主图床）；
        // 手动选择的渠道只在本次会话内生效
        this.channelName = ''
        // 备份渠道同样复位为「默认」（跟随全局备份渠道，而不是 none/不备份）
        this.backupChannel = ''
        // v3.0.0（R8）：归属实例复位为「跟随当前实例」（仅本次会话生效，不持久化）
        this.uploadInstanceId = ''
        // 失败自动切换（v2.8.8：跟随后台「上传相关配置 → 自动重试」，前台不再有开关）
        this.autoRetry = this.userConfig?.autoRetry !== false
        // v2.8.9：前台「失败自动重试」开关（上传设置 → 其他），只管前台上传 / 链接转存
        this.localAutoRetry = this.compressConfig.localAutoRetry ?? true
        // 读取用户选择的上传文件命名方式
        this.uploadNameType = this.storeUploadNameType || this.userConfig?.defaultUploadNameType || 'default'
        // 读取用户自定义链接格式
        this.customUrlPrefix = this.customUrlSettings.customUrlPrefix
        this.useCustomUrl = this.customUrlSettings.useCustomUrl
        // 自定义访问域名来自后台「上传设置」的全局配置（前端不再单独保存）
        this.customDomain = this.userConfig?.customDomain || ''
        // 读取用户偏好的上传方式
        this.uploadMethod = this.storeUploadMethod
        // 上传目录：页面刷新后一律清空（右上角输入框与右下角「上传设置」里的同名项都不保留上次的值）
        this.uploadFolder = ''
        this.$store.commit('setStoreUploadFolder', '')

        // 从 Vuex store 读取主题模式状态
        const cusDarkMode = this.$store.getters.cusDarkMode
        const useDarkMode = this.$store.getters.useDarkMode
        
        if (!cusDarkMode) {
            this.themeMode = 'auto'
        } else if (useDarkMode) {
            this.themeMode = 'dark'
        } else {
            this.themeMode = 'light'
        }

        // v2.8.8：视频兼容转码选择每次刷新都复位为「跟随全局」（需求要求）
        this.transcodeChoice = ''

        // v3.0.0：拉取实例列表（GET /api/instances，不含默认实例），算头像右下角序号角标
        this.fetchInstances()

        this.showAnnouncementIfNeeded()
    },
    components: {
        UploadForm,
        Footer,
        ToggleDark,
        Logo,
        UploadSettingsDialog,
        RecordFileDialog,
        DirectoryTreePicker,
        DirectorySuggestionInput
    },
    methods: {
        /**
         * 页面重新可见 / bfcache 恢复时自动激活：
         * 重新拉用户配置（渠道授权、上传设置、主题等都可能在此期间被管理员改过）。
         * 上传中的文件不打断，只刷新配置。
         */
        onPageActivate() {
            this.$store.dispatch('fetchUserConfig').catch(() => {});
        },
        // 验证上传文件夹路径的合法性
        validateUploadFolder(path, strict = true) {
            // 自动补全前导 /
            if (path && !path.startsWith('/')) {
                path = '/' + path
                this.uploadFolder = path
            }
            const result = validateFolderPath(path, { strict })
            if (!result.valid) {
                this.$message.error(result.error)
                return false
            }
            return true
        },
        handleFolderInputFocus() {
            this.isFolderInputActive = true
        },
        handleFolderInputBlur() {
            this.isFolderInputActive = false
            // 失焦时自动补全前导 /
            if (this.uploadFolder && !this.uploadFolder.startsWith('/')) {
                this.uploadFolder = '/' + this.uploadFolder
            }
            // 失焦时做完整校验（包括末尾单独的 .）
            if (!this.validateUploadFolder(this.uploadFolder, true)) {
                this.$nextTick(() => {
                    this.uploadFolder = this.storeUploadFolder
                })
            }
        },
        handleManage() {
            // 右下角「文件管理」：新标签打开后台文件管理页，不打断当前上传
            window.open('/dashboard', '_blank', 'noopener')
        },
        /** 更多菜单 → 系统管理：新标签打开系统状态页 */
        openSystemManage() {
            window.open('/systemConfig#status', '_blank', 'noopener')
        },
        // 解析布尔值
        parseBoolean(value, defaultValue) {
            if (value === undefined || value === null) return defaultValue
            if (typeof value === 'boolean') return value
            if (typeof value === 'string') return value === 'true'
            return defaultValue
        },
        // 解析数字
        parseNumber(value, defaultValue) {
            if (value === undefined || value === null) return defaultValue
            const num = parseFloat(value)
            return isNaN(num) ? defaultValue : num
        },
        openUrlDialog() {
            this.showUrlDialog = true
        },
        handleLogout() {
            axios.post('/api/auth/logout', { authType: 'user' }, { withCredentials: true }).finally(() => {
                this.$store.commit('setUserLoggedIn', false);
                this.$router.push('/login')
                this.$message.success(this.$t('upload.logoutSuccess'))
            })
        },
        changeUrlForm() {
            this.$store.commit('setUploadCopyUrlForm', this.selectedUrlForm)
        },
        /**
         * v3.0.0（R8.1）：拍照 ——
         * 桌面浏览器会忽略 <input capture>（直接弹文件选择、根本不开相机），
         * 因此优先用 getUserMedia 打开真实摄像头做预览；
         * 仅当浏览器不支持 / 非 HTTPS 时，才回退到系统相机（移动端会直接开相机）。
         */
        openCamera() {
            const md = window.navigator?.mediaDevices
            const secure = window.isSecureContext
                || ['localhost', '127.0.0.1'].includes(window.location.hostname)
            // v3.0.0（R9）：每次打开拍照弹窗都回到后置摄像头（刷新 / 重开都从 environment 起步），
            // 操作按钮回到隐藏态（移动端点击画面唤出）
            this.cameraFacing = 'environment'
            this.cameraUiVisible = false
            if (!md || typeof md.getUserMedia !== 'function' || !secure) {
                this.cameraReady = false
                this.cameraError = this.$t('upload.cameraInsecure')
                this.showCameraDialog = true
                return
            }
            this.cameraError = ''
            this.cameraReady = false
            this.showCameraDialog = true
            this.startCamera()
        },
        /** v3.0.0（R9）：移动端点击取景画面 → 显示 / 收起底部操作按钮 */
        toggleCameraUi() {
            this.cameraUiVisible = !this.cameraUiVisible
        },
        /**
         * 启动（或重启）摄像头流，绑到弹窗里的 video 上。
         * v3.0.0（R14）三处修正：
         *  1) 手机竖屏改按 3:4（宽<高）申请画面，取景框与成片都是 4:3 竖屏；
         *  2) 显式把 zoom 复位到 1 倍、focusMode 用 continuous —— 部分安卓机型
         *     默认带数字变焦，画面会被拉近（用户反馈「焦距不对」）；
         *  3) 停止旧流后等一小会儿再申请，并对 NotAllowed/NotReadable 自动重试一次 ——
         *     原来切换镜头/二次拍摄时立刻重新申请，会被浏览器判定为并发占用而报
         *     「权限不被允许」（实际是设备忙）。
         */
        async startCamera() {
            this.stopCamera()
            this.cameraStarting = true
            // 竖屏（窄屏）申请 3:4，桌面宽屏保持 16:9
            const portrait = window.innerWidth <= 768
            const base = {
                facingMode: { ideal: this.cameraFacing },
                width: { ideal: portrait ? 1080 : 1920 },
                height: { ideal: portrait ? 1440 : 1080 },
            }
            const full = {
                ...base,
                aspectRatio: { ideal: portrait ? 3 / 4 : 16 / 9 },
                // 非标准约束：不支持的浏览器会忽略（ideal 不会抛错）
                zoom: { ideal: 1 },
                focusMode: { ideal: 'continuous' },
            }
            const open = async (constraints) =>
                navigator.mediaDevices.getUserMedia({ video: constraints, audio: false })
            try {
                // 旧流释放需要一点时间，立刻申请容易被判定为设备忙
                await new Promise((r) => setTimeout(r, 240))
                let stream
                try {
                    stream = await open(full)
                } catch (first) {
                    const name = String(first?.name || '')
                    if (name === 'OverconstrainedError' || name === 'TypeError') {
                        // 机型不支持 zoom / focusMode / aspectRatio → 退回基础约束
                        stream = await open(base)
                    } else if (name === 'NotAllowedError' || name === 'NotReadableError' || name === 'AbortError') {
                        // 设备还没释放（切镜头最常见）→ 再等 700ms 重试一次
                        await new Promise((r) => setTimeout(r, 700))
                        stream = await open(base)
                    } else {
                        throw first
                    }
                }
                this.cameraStream = stream
                /*
                 * v3.0.0（R17）：强制回到 1 倍焦距。
                 * 上面只写了 zoom: { ideal: 1 } —— 按规范 ideal 只是「偏好」，
                 * 不少安卓机型 / 浏览器会直接忽略，默认停在 2x / 3x 的数字变焦上
                 * （用户看到的就是「打开摄像头画面被拉得特别近」）。
                 * 这里读一次 track 的 capabilities.zoom，再用 applyConstraints 把
                 * zoom 落到最小档（= 1 倍光学视角）—— 支持 zoom 的设备一定生效。
                 */
                await this.applyOneXZoom(stream)
                // el-dialog 首次打开时内容刚渲染，等一帧再取 ref
                await this.$nextTick()
                await new Promise((r) => requestAnimationFrame(() => r()))
                const el = this.$refs.cameraVideo
                if (!el) {
                    this.cameraError = this.$t('upload.cameraFailed')
                    this.stopCamera()
                    return
                }
                el.srcObject = stream
                try { await el.play() } catch (e) { /* 自动播放被拦时用户点一下画面即可 */ }
                this.cameraReady = true
            } catch (err) {
                this.cameraError = this.cameraErrorText(err)
            } finally {
                this.cameraStarting = false
            }
        },
        /**
         * v3.0.0（R17）：把摄像头强制拉回 1 倍焦距。
         * capabilities.zoom 在部分实现里是数字（旧规范），多数是 { min, max, step }。
         * 取「1 倍」时不能直接用 1 —— 有的设备最小档不是 1（少数从 0.5 起），
         * 这里以 1 为基准夹到 [min, max] 区间，保证既不会大于 1 倍、也不会越界报错。
         */
        async applyOneXZoom(stream) {
            try {
                const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null
                if (!track || typeof track.getCapabilities !== 'function') return
                const caps = track.getCapabilities()
                const zoom = caps && caps.zoom
                if (zoom === undefined || zoom === null) return
                const min = typeof zoom === 'number' ? zoom : Number(zoom.min)
                const max = typeof zoom === 'number' ? zoom : Number(zoom.max)
                if (!Number.isFinite(min) || !Number.isFinite(max)) return
                const target = Math.min(Math.max(1, min), max)
                await track.applyConstraints({ advanced: [{ zoom: target }] })
            } catch (e) {
                // 设备不支持 advanced zoom / 已被其它页面占用：保持当前画面即可
            }
        },
        /** 摄像头错误 → 人话 */
        cameraErrorText(err) {            const name = String(err?.name || '')
            if (name === 'NotAllowedError' || name === 'SecurityError') return this.$t('upload.cameraDenied')
            if (name === 'NotFoundError' || name === 'OverconstrainedError') return this.$t('upload.cameraNotFound')
            return this.$t('upload.cameraFailed')
        },
        /** v3.0.0（R14）：关闭拍照弹窗（连拍结束后点「完成」） */
        closeCameraDialog() {
            this.showCameraDialog = false
            this.stopCamera()
        },
        /** 停止流并释放摄像头（弹窗关闭 / 组件卸载 / 切换镜头前调用） */
        stopCamera() {
            const s = this.cameraStream
            if (s) {
                try { s.getTracks().forEach((t) => t.stop()) } catch (e) { /* 忽略 */ }
            }
            this.cameraStream = null
            this.cameraReady = false
        },
        /** 前置 / 后置切换 */
        switchCamera() {
            this.cameraFacing = this.cameraFacing === 'environment' ? 'user' : 'environment'
            this.startCamera()
        },
        /** 回退到系统相机 / 文件选择（移动端会直接打开相机） */
        openSystemCamera() {
            this.showCameraDialog = false
            this.$refs.cameraInput?.click()
        },
        /**
         * 把当前画面截成 JPEG，走统一上传管线。
         * v3.0.0（R14）：
         *  · 按取景框可见比例（手机 3:4 竖屏）居中裁剪，成片 = 所见即所得；
         *  · 拍完不关窗（连拍），用户点「完成」再关闭 —— 之前每次拍完都关闭弹窗，
         *    再拍又要重新申请摄像头，手机上就会报「权限不被允许」。
         */
        async capturePhoto() {
            const el = this.$refs.cameraVideo
            if (!el || !el.videoWidth) {
                this.$message.warning(this.$t('upload.cameraNotReady'))
                return
            }
            const vw = el.videoWidth
            const vh = el.videoHeight
            const portrait = window.innerWidth <= 768
            const targetRatio = portrait ? 3 / 4 : el.clientWidth && el.clientHeight ? el.clientWidth / el.clientHeight : 4 / 3
            let sw = vw
            let sh = Math.round(vw / targetRatio)
            if (sh > vh) {
                sh = vh
                sw = Math.round(vh * targetRatio)
            }
            const sx = Math.round((vw - sw) / 2)
            const sy = Math.round((vh - sh) / 2)
            const canvas = document.createElement('canvas')
            canvas.width = sw
            canvas.height = sh
            const ctx = canvas.getContext('2d')
            ctx.drawImage(el, sx, sy, sw, sh, 0, 0, sw, sh)
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
            if (!blob) {
                this.$message.error(this.$t('upload.cameraFailed'))
                return
            }
            const d = new Date()
            const pad = (n) => String(n).padStart(2, '0')
            const name = `photo-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`
            const file = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
            // v3.0.0（R14）：保持摄像头开着，可连续拍照；关闭交给「完成」/右上角 ×
            this.$message.success(this.$t('upload.cameraCaptured'))
            // 与「选文件 / 系统相机」完全同一条管线：自动模式立即上传、手动模式进等待区
            await this.$refs.uploadForm?.uploadLocalEntries(filesToUploadEntries([file]))
        },
        /**
         * v3.0.0（R8）：拍照完成 ——
         * 把相机返回的图片按标准本地文件管线送进待上传区
         * （走 UploadForm.uploadLocalEntries：压缩/WebP/重命名等规则全部一致；
         * 自动模式立即上传，手动模式进列表等待用户点「上传」）。
         */
        async handleCameraCapture(event) {
            const entries = filesToUploadEntries(event.target.files || [])
            event.target.value = ''
            if (!entries.length) return
            await this.$refs.uploadForm?.uploadLocalEntries(entries)
        },
        /**
         * 登记文件（v2.8.8）
         * 打开「登记文件」弹窗：把一个已经存在于对象存储 / 别处的文件
         * 登记进系统（不重复上传，只建记录）。仅登录用户可用。
         */
        openRecordDialog() {
            if (!this.sessionUser) {
                this.$message.warning(this.$t('recordFile.needLogin'))
                return
            }
            this.showRecordDialog = true
        },
        /**
         * 登记成功（v2.9.0）
         * 除了关闭弹窗，把这条登记记录直接追加进下方文件列表（带服务端签发的外链），
         * 用户不用刷新页面就能复制/查看；重复登记同一条会由列表自身去重。
         */
        handleRecorded(data) {
            // 成功提示由 RecordFileDialog 自己弹（带文件名与大小），这里只负责收尾
            this.showRecordDialog = false
            const form = this.$refs.uploadForm
            if (form && typeof form.addRecordedFile === 'function') {
                form.addRecordedFile(data || {})
            }
        },

        openCompressDialog() {
            this.showCompressDialog = true
        },
        updateCompressConfig(key, value) {
            this.$store.commit('setCompressConfig', { key, value })
        },
        updateStoreUploadChannel(value) {
            this.$store.commit('setStoreUploadChannel', value)
        },
        updateStoreUploadNameType(value) {
            this.$store.commit('setStoreUploadNameType', value)
        },
        handleQuickToolbarMoreEnter() {
            this.isQuickToolbarOpen = true
        },
        handleQuickToolbarLeave() {
            if (!this.isQuickToolbarPinned) {
                this.isQuickToolbarOpen = false
            }
        },
        toggleQuickToolbar() {
            this.isQuickToolbarPinned = !this.isQuickToolbarPinned
            this.isQuickToolbarOpen = this.isQuickToolbarPinned
        },
        closeQuickToolbar() {
            this.isQuickToolbarPinned = false
            this.isQuickToolbarOpen = false
        },
        handleQuickToolbarCommand(command) {
            this.closeQuickToolbar()
            if (command === 'linkFormat') {
                this.openUrlDialog()
            } else if (command === 'manage') {
                this.handleManage()
            } else if (command === 'logout') {
                this.handleLogout()
            }
        },
        handleChangeUploadMethod() {
            this.uploadMethod = this.uploadMethod === 'default'? 'paste' : 'default'
            this.$store.commit('setUploadMethod', this.uploadMethod)
        },
        /** 上传方式标签页切换（默认 / 链接） */
        setUploadMethod(method) {
            if (method !== 'default' && method !== 'paste') return
            this.uploadMethod = method
            this.$store.commit('setUploadMethod', method)
        },
        handleMobileMenuCommand(command) {
            if (command === 'toggleTheme') {
                // 循环切换：auto -> light -> dark -> auto
                if (this.themeMode === 'auto') {
                    // 切换到亮色
                    this.themeMode = 'light'
                    this.$store.commit('setCusDarkMode', true)
                    this.$store.commit('setUseDarkMode', false)
                    writeThemeCookie('light')
                } else if (this.themeMode === 'light') {
                    // 切换到暗色
                    this.themeMode = 'dark'
                    this.$store.commit('setCusDarkMode', true)
                    this.$store.commit('setUseDarkMode', true)
                    writeThemeCookie('dark')
                } else {
                    // 切换到自动
                    this.themeMode = 'auto'
                    this.$store.commit('setCusDarkMode', false)
                    writeThemeCookie('auto')
                }
            } else if (command === 'viewDocs') {
                this.openDocsPage()
            } else if (command === 'showHistory') {
                this.openHistoryPage()
            } else if (command === 'showAnnouncement') {
                this.handleShowAnnouncement()
            } else if (command === 'toggleLanguage') {
                const next = this.$i18n.locale === 'zh-CN' ? 'en' : 'zh-CN'
                setLocale(next)
            } else if (command === 'systemManage') {
                this.openSystemManage()
            } else if (command === 'logout') {
                // v2.7.0：更多菜单里的退出登录（与原右下角快捷栏同一逻辑）
                this.handleLogout()
            }
        },
        handleDesktopMenuCommand(command) {
            if (command === 'viewDocs') {
                this.openDocsPage()
            } else if (command === 'showHistory') {
                this.openHistoryPage()
            } else if (command === 'showAnnouncement') {
                this.handleShowAnnouncement()
            } else if (command === 'toggleLanguage') {
                const next = this.$i18n.locale === 'zh-CN' ? 'en' : 'zh-CN'
                setLocale(next)
            } else if (command === 'systemManage') {
                this.openSystemManage()
            } else if (command === 'logout') {
                // v2.7.0：更多菜单里的退出登录（桌面端）
                this.handleLogout()
            }
        },
        /** 「上传记录 / 历史记录」已合并为同一页：新标签打开 /manage/history */
        openHistoryPage() {
            const url = this.$router.resolve({ name: 'history' }).href
            window.open(url, '_blank', 'noopener')
        },
        /** 「查看文档」→ 内置文档说明页（新标签打开，不打断当前上传） */
        openDocsPage() {
            const url = this.$router.resolve({ name: 'docs' }).href
            window.open(url, '_blank', 'noopener')
        },
        getThemeIcon() {
            // 显示下一个模式的图标
            if (this.themeMode === 'auto') return 'sun'  // auto -> light
            if (this.themeMode === 'light') return 'moon'  // light -> dark
            return 'adjust'  // dark -> auto
        },
        getThemeText() {
            // 显示下一个模式的文字
            if (this.themeMode === 'auto') return this.$t('theme.lightMode')
            if (this.themeMode === 'light') return this.$t('theme.darkMode')
            return this.$t('theme.autoMode')
        },
        handleShowAnnouncement() {
            const announcement = this.userConfig?.announcement
            if (announcement) {
                this.openAnnouncement(announcement)
            } else {
                this.$message.info(this.$t('upload.noAnnouncement'))
            }
        },
        getAnnouncementRefreshAt() {
            const refreshAt = Number(this.userConfig?.announcementRefreshAt)
            return Number.isFinite(refreshAt) && refreshAt > 0 ? refreshAt : null
        },
        openAnnouncement(announcement) {
            this.announcementContent = announcement
            this.displayedAnnouncementRefreshAt = this.getAnnouncementRefreshAt()
            this.showAnnouncementDialog = true
        },
        showAnnouncementIfNeeded() {
            const announcement = this.userConfig?.announcement
            if (!announcement) return

            const refreshAt = this.getAnnouncementRefreshAt()
            if (refreshAt) {
                const acknowledgedRefreshAt = Number(localStorage.getItem('announcementAcknowledgedRefreshAt'))
                if (!Number.isFinite(acknowledgedRefreshAt) || refreshAt > acknowledgedRefreshAt) {
                    this.openAnnouncement(announcement)
                }
                return
            }

            // 尚未产生刷新时间的旧公告在升级后再展示一次，确认后使用新版时间标记。
            if (!localStorage.getItem('announcementAcknowledgedAt')) {
                this.openAnnouncement(announcement)
            }
        },
        acknowledgeAnnouncement() {
            localStorage.setItem('announcementAcknowledgedAt', String(Date.now()))

            if (this.displayedAnnouncementRefreshAt) {
                localStorage.setItem(
                    'announcementAcknowledgedRefreshAt',
                    String(this.displayedAnnouncementRefreshAt)
                )
            }

            this.showAnnouncementDialog = false
        },
        // 处理目录选择
        handleDirectorySelect(path) {
            // 填入选择的目录路径
            this.uploadFolder = path
            // 触发路径验证逻辑
            if (this.validateUploadFolder(path, true)) {
                this.$store.commit('setStoreUploadFolder', path)
            }
        },
        /* ────────────── v3.0.0：实例切换（头像 logo 弹窗） ────────────── */
        /**
         * 拉取当前用户的实例列表（GET /api/instances，不含默认实例；空列表 = 只有默认实例）。
         * 按创建时间升序排序：第一个创建的实例 = 1，头像角标显示该序号（默认实例不显示）。
         */
        async fetchInstances() {
            try {
                const res = await axios.get('/api/instances')
                const list = Array.isArray(res.data) ? res.data : []
                this.instances = [...list].sort((a, b) => {
                    const ta = new Date(a.createdAt).getTime() || 0
                    const tb = new Date(b.createdAt).getTime() || 0
                    return ta - tb
                })
                // 角标 = 当前实例在「创建时间升序」中的序号；默认实例或未找到 = 0（不显示）
                const cur = this.currentInstanceId
                const idx = this.instances.findIndex(i => String(i.id) === String(cur))
                this.instanceBadgeNumber = cur && idx >= 0 ? idx + 1 : 0
            } catch (e) {
                console.warn('[upload] 获取实例列表失败:', e)
                this.instances = []
                this.instanceBadgeNumber = 0
            }
        },
        /** 点击头像 → 打开「切换实例」弹窗 */
        openInstanceDialog() {
            this.showInstanceDialog = true
        },
        /**
         * 切换实例：写入 localStorage（gohub_instance_id，'' = 默认），
         * 提示后刷新页面，让文件列表 / 标签等所有与实例相关的数据按新实例重新加载。
         */
        switchInstance(id) {
            const val = id == null ? '' : String(id)
            if (val === this.currentInstanceId) {
                this.showInstanceDialog = false
                return
            }
            try { localStorage.setItem('gohub_instance_id', val) } catch (e) { /* 隐私模式忽略 */ }
            this.currentInstanceId = val
            this.showInstanceDialog = false
            this.$message.success(this.$t('instancePicker.switchSuccess'))
            setTimeout(() => { window.location.reload() }, 600)
        },
        /* ────── v3.0.0：实例弹窗底部链接（用户管理 / 实例管理） ────── */
        /** 「用户管理」→ 新标签打开用户管理列表页 */
        openUserManagement() {
            window.open('/customerConfig', '_blank', 'noopener')
        },
        /**
         * 「实例管理」→ 新标签打开「当前账户的用户编辑页 · 实例管理」锚点。
         * 本工程用户编辑页路由是 /customerConfig/edit/:id（:id 为账户主键），
         * 因此先按当前登录名在 /api/manage/users 里定位主键；取不到时退回用户管理列表并提示。
         * 注意：先同步开窗再 await，避免浏览器把异步后的 window.open 当弹窗拦截。
         */
        async openInstanceManagement() {
            const win = window.open('about:blank', '_blank')
            const username = this.sessionUser || ''
            let url = '/customerConfig'
            let fallback = false
            try {
                const res = await axios.get('/api/manage/users')
                const list = Array.isArray(res.data) ? res.data : []
                const hit = username ? list.find((u) => u && u.username === username) : null
                if (hit && hit.id !== undefined && hit.id !== null && hit.id !== '') {
                    url = `/customerConfig/edit/${encodeURIComponent(hit.id)}?anchor=instances`
                } else {
                    fallback = true
                }
            } catch (e) {
                fallback = true
            }
            if (win && !win.closed) {
                win.location.href = url
            } else {
                window.open(url, '_blank', 'noopener')
            }
            if (fallback) this.$message.warning(this.$t('instancePicker.instanceFallback'))
        }
    }
}
</script>

<style scoped>
.container {
    background: var(--bg-color);
    min-height: 100vh;
}

/* 定义顺时针和逆时针旋转动画 */
.rotate {
    animation: spin 2s ease-in-out; /* 动画时长为2秒，执行一次 */
}

/* 定义放大缩小动画 */
.scale {
    animation: scale 0.5s ease-in-out; /* 动画时长为0.5秒，执行一次 */
}

/* 关键帧：先顺时针旋转，再逆时针旋转 */
@keyframes spin {
    0% {
        transform: rotate(0deg); /* 初始位置 */
    }
    25% {
        transform: rotate(5deg); /* 顺时针旋转20度 */
    }
    50% {
        transform: rotate(0deg); /* 顺时针旋转回到初始位置 */
    }
    75% {
        transform: rotate(-3deg); /* 逆时针旋转20度 */
    }
    100% {
        transform: rotate(0deg); /* 逆时针旋转回到初始位置 */
    }
}

@keyframes streamer {
    0% {
        background-position: 200% center;
    }
    100% {
        background-position: -200% center;
    }
}


/* 关键帧：旋转抖动 */
@keyframes rotate-shake {
    0% {
        transform: rotate(0deg); /* 初始位置 */
    }
    50% {
        transform: rotate(10deg); /* 旋转10度 */
    }
    100% {
        transform: rotate(0deg); /* 回到初始位置 */
    }
}

/* 关键帧：左右抖动 */
@keyframes shake {
    0% {
        transform: translateX(0); /* 初始位置 */
    }
    50% {
        transform: translateX(-1px); /* 向右移动3像素 */
    }
    100% {
        transform: translateX(0); /* 回到初始位置 */
    }
}

/* 关键帧：放大缩小 */
@keyframes scale {
    0% {
        transform: scale(1); /* 初始大小 */
    }
    50% {
        transform: scale(1.1); /* 放大到1.2倍 */
    }
    100% {
        transform: scale(1); /* 回到初始大小 */
    }
}


/* 桌面端和移动端显示控制 */
.desktop-only {
    display: inline-block;
}
.mobile-only {
    display: none;
}
@media (max-width: 768px) {
    .desktop-only {
        display: none !important;
    }
    .mobile-only {
        display: flex !important;
    }
}

.toggle-dark-button {
    width: 2.5rem;
    height: 2.5rem;
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    align-items: center;
    border: 1px solid var(--glass-border);
    transition: background-color 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
    background-color: var(--glass-bg);
    box-shadow: none;
    border-radius: 12px;
    position: fixed;
    top: 30px;
    right: 80px;
    padding: 0;
}
.more-dropdown {
    position: fixed;
    top: 30px;
    right: 30px;
    z-index: 100;
}
.more-dropdown .more-button {
    width: 2.5rem;
    height: 2.5rem;
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    align-items: center;
    border: 1px solid var(--glass-border);
    transition: background-color 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
    background-color: var(--glass-bg);
    box-shadow: none;
    color: var(--theme-toggle-color);
    border-radius: 12px;
    outline: none;
    padding: 0;
}
.more-dropdown .more-button:hover {
    transform: scale(1.05);
    border-color: var(--glass-border-hover);
}

.upload-method-button {
    width: 2.5rem;
    height: 2.5rem;
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    align-items: center;
    border: 1px solid var(--glass-border);
    transition: background-color 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
    background-color: var(--glass-bg);
    box-shadow: none;
    color: var(--theme-toggle-color);
    border-radius: 12px;
    position: fixed;
    top: 30px;
    right: 130px;
    outline: none;
    padding: 0;
}
@media (max-width: 768px) {
    .upload-method-button {
        width: 2rem;
        height: 2rem;
    }
}
.upload-method-icon {
    outline: none;
}
/* 右上角工具按钮内的图标统一尺寸(与 ToggleDark 的 1.5em 对齐) */
.more-button .svg-inline--fa,
.upload-method-button .svg-inline--fa {
    font-size: 1.5em;
}
.directory-tree-trigger .svg-inline--fa {
    font-size: 1.2em;
}

/* 移动端更多按钮 */
.mobile-more-dropdown {
    position: fixed;
    top: 30px;
    right: 18px;
    z-index: 100;
}
.mobile-more-button {
    width: 2rem;
    height: 2rem;
    display: flex;
    justify-content: center;
    align-items: center;
    border: 1px solid var(--glass-border);
    transition: background-color 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
    background-color: var(--glass-bg);
    box-shadow: none;
    color: var(--theme-toggle-color);
    border-radius: 12px;
    outline: none;
    padding: 0;
}
.mobile-more-button:hover {
    transform: scale(1.05);
    border-color: var(--glass-border-hover);
}

/* 移动端「更多」按钮：与左侧按钮同尺寸同水平线，并补上按下反馈动效 */
@media (max-width: 768px) {
    .mobile-more-dropdown {
        /* 与左侧「上传目录」输入框严格对齐：
           输入框容器 top:30px、高 2rem(32px) → 中心 46px；本按钮高 2rem(32px) → top = 46 - 16 = 30px。 */
        top: 30px;
        right: 14px;
    }
    .mobile-more-button {
        /* 与左侧「目录选择」按钮同为 2rem，避免显得偏大 */
        width: 2rem;
        height: 2rem;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
    }
    .mobile-more-button:active {
        transform: scale(0.94);
        border-color: var(--glass-border-hover);
    }
    .mobile-more-button .svg-inline--fa {
        font-size: 1.15em;
    }
}

/* 上传文件输入框容器样式 */
.upload-folder-container {
    display: flex;
    align-items: center;
    position: fixed;
    top: 30px;
    /* 右侧只留「主题切换（right:80px）+ 更多（right:30px）」两个按钮的宽度，
       原「切换上传方式」按钮已移到上传框上方，这里不再预留它的空位 */
    right: 130px;
    z-index: 100;
}
.upload-folder-container.no-announcement {
    right: 130px;
}
@media (max-width: 768px) {
    .upload-folder-container {
        /* 与右侧「更多」按钮之间的间距收紧一点点（原 58px → 54px，留 8px 呼吸） */
        right: 54px;
    }
    .upload-folder-container.no-announcement {
        right: 54px;
    }

    /* 聚焦时容器保持原位，输入框只向左扩展，
       不再整体居中跳位（避免「目录选择」按钮与「更多菜单」之间跳出空位） */
    .upload-folder.active {
        width: min(64vw, 232px);
    }
}

/* 上传文件输入框样式 */
.upload-folder {
    width: 100px;
    height: 2.5rem;
    border-radius: 12px;
    display: flex;
    align-items: center;
    box-sizing: border-box;
    transition: all 0.3s ease, width 0.4s ease;
}
.upload-folder.active {
    width: 200px;
}
@media (max-width: 768px) {
    .upload-folder {
        width: 80px;
        height: 2rem;
    }
    .upload-folder.active {
        width: 120px;
    }
}

/* 目录树触发按钮 */
.directory-tree-trigger {
    width: 2.5rem;
    height: 2.5rem;
    display: flex;
    justify-content: center;
    align-items: center;
    box-sizing: border-box;
    border: 1px solid var(--glass-border);
    margin-left: 10px;
    background-color: var(--glass-bg);
    box-shadow: var(--glass-shadow);
    color: var(--theme-toggle-color);
    border-radius: 12px;
    outline: none;
    cursor: pointer;
    transition: background-color 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
}
.directory-tree-trigger:hover {
    border-color: var(--glass-border-hover);
    transform: scale(1.05);
}
@media (max-width: 768px) {
    .directory-tree-trigger {
        width: 2rem;
        height: 2rem;
        /* 「上传目录」输入框与「上传分类」按钮之间的间距：10px → 6px */
        margin-left: 6px;
    }
    .directory-tree-trigger .svg-inline--fa {
        font-size: 1.1em;
    }
}

.upload-folder :deep(.inner-folder-input) {
    width: 100%;
    height: 100%;
}

.upload-folder :deep(.el-input) {
    height: 100%;
    box-sizing: border-box;
}

.upload-folder :deep(.el-input__wrapper) {
    border-radius: 12px;
    background-color: var(--glass-bg);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    box-shadow: var(--glass-shadow);
    border: 1px solid var(--glass-border);
    height: 100%;
    padding: 0 10px;
    box-sizing: border-box;
    transition: background-color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease !important;
}
.upload-folder :deep(.el-input__wrapper:hover) {
    background-color: color-mix(in srgb, var(--el-fill-color-blank) 85%, transparent);
    border-color: var(--glass-border-hover);
}
html.dark .upload-folder :deep(.el-input__wrapper:hover) {
    background-color: color-mix(in srgb, var(--el-bg-color) 88%, transparent);
    border-color: var(--glass-border-hover);
}

.upload-folder :deep(.el-input__wrapper.is-focus),
.upload-folder :deep(.el-input__wrapper:focus-within) {
    border-color: var(--glass-border);
    box-shadow: var(--glass-shadow) !important;
}

.quick-toolbar {
    --quick-toolbar-size: 2.5rem;
    --quick-toolbar-button-size: calc(var(--quick-toolbar-size) - 6px);

    position: fixed;
    bottom: 50px;
    right: 30px;
    width: var(--quick-toolbar-size);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    z-index: 200;
    padding: 3px;
    border-radius: 999px;
    border: 1px solid var(--glass-border);
    background-color: var(--glass-bg);
    box-shadow: none;
    transition: background-color 0.24s ease, border-color 0.24s ease;
}
.toggle-dark-button,
.more-dropdown .more-button,
.upload-method-button,
.mobile-more-button,
.directory-tree-trigger,
.quick-toolbar {
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
}

.quick-toolbar-button {
    width: var(--quick-toolbar-button-size);
    height: var(--quick-toolbar-button-size);
    border: none;
    transition: transform 0.22s ease, background-color 0.22s ease, box-shadow 0.22s ease, color 0.22s ease;
    margin-left: 0;
    padding: 0;
    border-radius: 999px;
    background-color: transparent;
    box-shadow: none;
    color: var(--toolbar-button-color);
    outline: none;
}
/*
 * v3.0.0（R9）：「上传设置」按钮右上角的归属实例序号角标 ——
 * 选了「默认实例」显示 0，选了具体实例显示创建序号（1 起），未选不显示。
 */
.quick-toolbar-settings {
    position: relative;
}
.settings-instance-badge {
    position: absolute;
    top: -2px;
    right: -2px;
    z-index: 2;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    pointer-events: none;
}
.quick-toolbar-actions {
    display: grid;
    grid-template-rows: 0fr;
    width: 100%;
    margin-bottom: 0;
    opacity: 0;
    pointer-events: none;
    transform: translateY(12px);
    transform-origin: bottom center;
    transition:
        grid-template-rows 0.52s cubic-bezier(0.16, 1, 0.3, 1),
        margin-bottom 0.52s cubic-bezier(0.16, 1, 0.3, 1),
        opacity 0.32s ease,
        transform 0.52s cubic-bezier(0.16, 1, 0.3, 1);
}
.quick-toolbar.is-expanded .quick-toolbar-actions {
    grid-template-rows: 1fr;
    margin-bottom: 4px;
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
}
.quick-toolbar-actions-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-height: 0;
    overflow: hidden;
}
.quick-toolbar-more.is-active {
    background-color: var(--upload-action-btn-hover-bg);
    box-shadow: var(--upload-action-btn-shadow);
}
.quick-toolbar-more {
    margin-top: 4px;
}
.quick-toolbar-icon {
    font-size: 16px;
}
.quick-toolbar-toggle-icon {
    transform: rotate(180deg);
    transition: transform 0.32s ease;
}
.quick-toolbar-more.is-active .quick-toolbar-toggle-icon {
    transform: rotate(0deg);
}

/* 按钮悬停效果 */
.info-container:hover,
.quick-toolbar-button:hover {
    transform: scale(1.05);
    background-color: var(--upload-action-btn-hover-bg);
    box-shadow: var(--upload-action-btn-hover-shadow);
}
.quick-toolbar:hover {
    border-color: var(--glass-border-hover);
}
.quick-toolbar-button:hover {
    transform: none;
}
/*
 * v3.0.0（R8）：移动端「拍照」按钮 ——
 *   · 桌面隐藏（display:none），≤768px 才显示（登记文件上方、同款圆形按钮）；
 *   · 隐藏的相机 input 视觉不可见且不占位，只作为 capture 调起系统相机的载体。
 */
.quick-toolbar-camera {
    display: none;
}
.camera-input-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    opacity: 0;
    pointer-events: none;
}
/* v3.0.0（R8.1）：拍照弹窗 —— 实时预览 + 快门
   v3.0.0（R12）：整块迁到 styles/global.css（含移动端整屏与快门隐藏区）*/
/* v3.0.0（R12）：移动端整屏 / 快门隐藏区已统一搬到 styles/global.css ——
   这里的选择器会被 Vue 加上 [data-v-x]，命中不了 Element Plus 自己渲染的
   .el-dialog__body / .el-dialog__header，原先写在这里等于没生效。 */
.toggle-dark-button:hover,
.upload-method-button:hover {
    transform: scale(1.05);
    border-color: var(--glass-border-hover);
}
.upload-folder:hover :deep(.el-input__wrapper) {
    background-color: color-mix(in srgb, var(--el-fill-color-blank) 85%, transparent);
    border-color: var(--glass-border-hover);
}
html.dark .upload-folder:hover :deep(.el-input__wrapper) {
    background-color: color-mix(in srgb, var(--el-bg-color) 88%, transparent);
    border-color: var(--glass-border-hover);
}

@media (max-width: 768px) {
    .quick-toolbar {
        --quick-toolbar-size: 2rem;
        --quick-toolbar-button-size: calc(var(--quick-toolbar-size) - 4px);

        /* 右侧边距调小一点点（18px → 12px），与顶部「更多」按钮视觉更齐 */
        right: 12px;
        bottom: max(72px, calc(6vh + 20px + env(safe-area-inset-bottom)));
        padding: 2px;
    }
    .quick-toolbar-actions {
        margin-bottom: 0;
    }
    .quick-toolbar.is-expanded .quick-toolbar-actions {
        margin-bottom: 3px;
    }
    .quick-toolbar-actions-inner {
        gap: 2px;
    }
    .quick-toolbar-more {
        margin-top: 3px;
    }
    .quick-toolbar-icon {
        font-size: 14px;
    }
    /* 移动端显示「拍照」按钮（登记文件上方） */
    .quick-toolbar-camera {
        display: inline-flex;
    }
}


:deep(.el-dialog) {
    border-radius: 12px;
    border: 1px solid var(--glass-border);
    background-color: var(--dialog-bg-color);
    box-shadow: var(--dialog-box-shadow);
}
.dialog-action {
    display: flex;
    justify-content: center;
    margin-top: 20px;
}


.header {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 15px;
    margin-top: 5vh;
    color: var(--upload-header-color);
    user-select: none;
    text-decoration: none;
    position: relative;
    top: -3vh;
    transition: all 0.3s ease;
}
.title {
    font-size: 2.25rem;
    font-weight: 400;
    font-family: 'Pacifico', 'Noto Sans SC', sans-serif;
    color: var(--upload-title-text-color);
    text-shadow: var(--upload-title-text-shadow);
    position: relative;
    isolation: isolate;
    padding-bottom: 8px;
    cursor: pointer;
    transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), filter 0.25s ease;
    animation: float 4s ease-in-out infinite;
    letter-spacing: 3px;
}
.title:hover {
    transform: scale(1.08);
    filter: drop-shadow(0 0 20px var(--upload-title-hover-glow));
}
.title::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    z-index: 0;
    width: 0;
    height: 3px;
    background: var(--upload-title-underline-bg);
    border-radius: 3px;
    transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: var(--upload-title-underline-shadow);
}
.title:hover::after {
    width: 80%;
}

.main-title {
    color: var(--upload-main-title-color);
    text-decoration: none;
    display: inline-block;
    position: relative;
    filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.3));
}

.title-base-text {
    position: relative;
    z-index: 1;
    display: inline-block;
    transition: opacity 0.16s ease;
}

.title:hover .title-base-text {
    opacity: 0;
}

.title:hover {
    text-shadow: none;
}

.title-crayon-text {
    position: absolute;
    left: 50%;
    top: -1px;
    z-index: 2;
    width: max-content;
    pointer-events: none;
    white-space: nowrap;
    color: var(--upload-title-crayon-deep, #1D2129);
    opacity: 0;
    -webkit-text-stroke: 0.35px var(--upload-title-crayon-edge);
    text-shadow:
        -1.2px 0.4px 0 var(--upload-title-crayon-burr),
        0.9px -0.7px 0 rgba(255, 255, 255, 0.24),
        1.5px 0.5px 0 var(--upload-title-crayon-dust),
        -1.7px -0.6px 0 var(--upload-title-crayon-dust);
    transform: translateX(-50%) rotate(-0.8deg);
    transform-origin: left 68%;
    clip-path: inset(-10px 100% -24px -10px);
    filter: saturate(1.08) contrast(1.06);
}

.title:hover .title-crayon-text {
    animation:
        crayonWrite 0.82s steps(18, end) forwards,
        crayonScratch 0.16s steps(2, end) 0.82s 3;
}



/* 漂浮动画 */
@keyframes float {
    0%, 100% {
        transform: translateY(0);
    }
    50% {
        transform: translateY(-5px);
    }
}

@keyframes crayonWrite {
    0% {
        opacity: 0;
        clip-path: inset(-10px 100% -24px -10px);
    }
    12% {
        opacity: 0.92;
    }
    32% {
        clip-path: inset(-10px 68% -24px -10px);
    }
    47% {
        clip-path: inset(-10px 52% -24px -10px);
    }
    63% {
        clip-path: inset(-10px 34% -24px -10px);
    }
    78% {
        clip-path: inset(-10px 18% -24px -10px);
    }
    100% {
        opacity: 0.92;
        clip-path: inset(-10px -10px -24px -10px);
    }
}

@keyframes crayonScratch {
    0%, 100% {
        transform: translateX(-50%) rotate(-0.8deg);
    }
    50% {
        transform: translateX(calc(-50% + 1px)) rotate(-0.45deg);
    }
}

@media (max-width: 768px) {
    .title {
        font-size: 1.4rem;
        letter-spacing: 0.75px;
    }
    .title:hover {
        transform: scale(1.05);
    }
}

.upload-home {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 94vh;
    background-color: transparent;
}

/* ── 顶部栏定位（v2.3.0 吸顶 → v2.4.0 移动端取消）────────────────────────
 * PC 端保持 fixed 挂视口；移动端改为 absolute 跟随页面滚动（上下都随内容滚走）。
 */
.toggle-dark-button,
.more-dropdown,
.mobile-more-dropdown {
    z-index: 900;
}
.upload-home :deep(.logo-link) {
    z-index: 901;
}
/* ── v3.0.0：头像 logo 实例切换包装（定位接管，Logo 组件本身不改） ── */
.logo-instance-wrap {
    position: fixed;
    top: 20px;
    left: 20px;
    z-index: 902;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.logo-instance-wrap :deep(.logo-link) {
    position: static;
    z-index: auto;
    display: inline-block;
}
/* 角标：与系统其它数字徽标一致的小红点（v3.0.0：改到头像右上角，默认实例不显示） */
.instance-badge {
    position: absolute;
    right: -4px;
    top: -4px;
    min-width: 16px;
    height: 16px;
    box-sizing: border-box;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--el-color-danger, #f56c6c);
    color: #fff;
    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
    text-align: center;
    border: 2px solid var(--bg-color, #fff);
    pointer-events: none;
    z-index: 1;
}
/* v3.0.0（R7）：移动端头像角标整体下移 2px（贴着头像更居中） */
@media (max-width: 768px) {
    .instance-badge {
        top: -2px;
    }
}
/* 切换实例弹窗列表 */
.instance-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.instance-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-radius: 10px;
    border: 1px solid var(--glass-border);
    background: var(--glass-bg);
    cursor: pointer;
    transition: border-color 0.2s ease, background-color 0.2s ease, transform 0.2s ease;
    min-width: 0;
}
.instance-item:hover {
    border-color: var(--glass-border-hover);
    transform: translateY(-1px);
}
.instance-item.is-active {
    border-color: color-mix(in srgb, var(--primary-color, #409eff) 55%, var(--glass-border));
    background: color-mix(in srgb, var(--primary-color, #409eff) 8%, var(--glass-bg));
}
.instance-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
}
/* v3.0.0（第三轮）：实例名称前的序号（默认实例没有序号） */
.instance-seq {
    flex: 0 0 auto;
    min-width: 20px;
    height: 20px;
    box-sizing: border-box;
    padding: 0 5px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    color: var(--el-text-color-secondary);
    background: color-mix(in srgb, var(--el-text-color-secondary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--el-text-color-secondary) 24%, transparent);
}
.instance-item.is-active .instance-seq {
    color: var(--primary-color, #409eff);
    background: color-mix(in srgb, var(--primary-color, #409eff) 12%, transparent);
    border-color: color-mix(in srgb, var(--primary-color, #409eff) 30%, transparent);
}
.instance-note {
    flex: 1;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.instance-check {
    margin-left: auto;
    color: var(--primary-color, #409eff);
    flex-shrink: 0;
}
.instance-empty {
    padding: 16px;
    text-align: center;
    font-size: 13px;
    color: var(--el-text-color-secondary);
}
/* v3.0.0：弹窗底部两个文字链接（并排居中，次要文字按钮） */
.instance-dialog-links {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--glass-border);
}
.instance-dialog-link {
    font-size: 13px;
    font-weight: 500;
    color: var(--el-text-color-secondary);
    padding: 0;
    height: auto;
}
.instance-dialog-link:hover {
    color: var(--primary-color, #409eff);
}
.instance-dialog-link-sep {
    width: 1px;
    height: 12px;
    background: var(--glass-border);
}
@media (max-width: 768px) {
    /*
     * v3.0.0：移动端头像不再悬浮 —— 由 fixed 改为 absolute（相对 .upload-home）。
     * 页面滚动时头像随内容一起滚走，不再一直贴在视口左上角；坐标沿用原移动端取值。
     * 桌面端保持 fixed（见上方 .logo-instance-wrap 主规则），仅在此断点内覆盖。
     */
    .logo-instance-wrap {
        position: absolute;
        top: calc(16px + env(safe-area-inset-top, 0px));
        left: calc(16px + env(safe-area-inset-left, 0px));
    }
    /* 原移动端规则把 .logo-link 固定到视口，包装后由外层定位，内层改回静态 */
    .logo-instance-wrap :deep(.logo-link) {
        position: static !important;
        top: auto;
        left: auto;
    }
    .instance-item {
        padding: 10px 12px;
    }
}
@media (max-width: 768px) {
    /* v2.4.0：移动端顶部栏不再粘滞 —— fixed 改 absolute，随页面一起滚动 */
    .upload-home {
        position: relative;
    }
    .mobile-more-dropdown,
    .upload-folder-container {
        position: absolute;
    }
    /*
     * v2.6.0：修复「移动端左上角 LOGO 不显示」——
     * 旧方案把 .logo-link 与 .logo--fixed 同时改 absolute，img 与 <a> 形成嵌套定位
     * 且 static 位置在 flex 居中布局里不可控（实测 LOGO 整个不落在可视区）。
     * v3.0.0：头像改为随页面滚动（不悬浮）—— 定位统一交给外层 .logo-instance-wrap
     * （absolute，相对 .upload-home），内层 <a> 与 img 一律回到静态流式布局，
     * 避免二级 fixed 又把头像钉在视口上。
     */
    .upload-home :deep(.logo-link) {
        position: static;
        top: auto;
        left: auto;
        display: inline-block;
    }
    .upload-home :deep(.logo--fixed) {
        position: static;
    }
    .mobile-more-dropdown {
        top: calc(30px + env(safe-area-inset-top, 0px));
        right: calc(14px + env(safe-area-inset-right, 0px));
    }
}
/* 上传区整体（标签页 + 上传框）作为一个纵向栈，统一保持原有的视觉上移 */
.upload-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    top: -3vh;
}

/* 上传方式标签页：位于上传框上方，默认 / 链接 */
.upload-method-tabs {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    margin-bottom: 10px;
    border-radius: 12px;
    border: 1px solid var(--glass-border);
    background: var(--glass-bg);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
}
.upload-method-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 20px;
    border: none;
    border-radius: 9px;
    background: transparent;
    color: var(--text-color-secondary, #666);
    font-size: 14px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background-color 0.25s ease, color 0.25s ease, transform 0.25s ease;
}
.upload-method-tab:hover {
    color: var(--primary-color);
}
/* 点击/聚焦后不显示浏览器默认聚焦边框 */
.upload-method-tab:focus,
.upload-method-tab:focus-visible,
.upload-method-tab:active {
    outline: none;
    box-shadow: none;
}
.upload-method-tab.is-active {
    color: #fff;
    background: var(--primary-color);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}
.upload-method-tab.is-active:focus,
.upload-method-tab.is-active:focus-visible {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}
.upload-method-tab-icon {
    font-size: 14px;
}
@media (max-width: 768px) {
    .upload-stack {
        top: -3.8vh;
    }
    .upload-method-tabs {
        /* v2.7.0：切换模块与下方操作区的间距调小一点（原 10px）
           v2.8.6：再减半 4px → 2px（手机上一屏更紧凑，切换按钮更贴近虚线框） */
        margin-bottom: 2px;
    }
    .upload-method-tab {
        padding: 6px 14px;
        font-size: 13px;
    }
}

/* v2.8.0：平板（769-1024px）同步收紧「文件/链接」切换模块与操作区的间距 */
@media (min-width: 769px) and (max-width: 1024px) {
    .upload-method-tabs {
        margin-bottom: 4px;
    }
}

.upload {
    margin-bottom: 5px;
    position: relative;
    top: 0;
}

@media (max-width: 768px) {
    .header {
        padding: 5px 15px 2px;
        top: -2.5vh;
    }
    .title {
        margin: 0.4em 0;
        padding-bottom: 0.45em;
        line-height: 1.2;
    }
    .upload {
        top: 0;
    }
}

/* 可用高度较小的桌面视口：减少标题占用和上传区上方留白。 */
@media (min-width: 769px) and (max-height: 1050px) {
    .header {
        padding: 8px 15px;
        margin-top: 3vh;
        top: -2vh;
    }

    .title {
        margin: 0.45em 0;
        padding-bottom: 0.45em;
        font-size: 1.875rem;
        line-height: 1.2;
        letter-spacing: 2px;
    }

    .upload {
        top: -2.5vh;
    }
}

.footer {
    height: 6vh;
}
</style>
