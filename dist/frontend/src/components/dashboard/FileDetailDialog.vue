<template>
    <el-dialog
        :title="$t('fileDetail.title')"
        v-model="visible"
        :width="dialogWidth"
        ref="detailDialog"
        class="gohub-layer-file-detail"
        data-gohub-layer="file-detail"
        @closed="stopAllMedia"
    >
        <!--
            v1.0.5：标题栏加「刷新」图标 —— 不关弹窗重新拉一次这个文件的元数据。
            典型场景：在别处改了标签 / 渠道 / 备注，回到这个弹窗不想关掉重开。
        -->
        <template #header>
            <div class="detail-header">
                <span class="detail-header-title">{{ $t('fileDetail.title') }}</span>
                <button
                    type="button"
                    class="detail-header-refresh"
                    :class="{ 'is-spinning': refreshing }"
                    :title="$t('fileDetail.refresh')"
                    :aria-label="$t('fileDetail.refresh')"
                    :disabled="refreshing"
                    @click="reloadDetail"
                >
                    <font-awesome-icon icon="sync"/>
                </button>
            </div>
        </template>
        <!-- 详情内容统一包一层：任一加载值超过 80 字符时整体字号降一号 -->
        <div class="detail-body" :class="{ 'detail-compact': hasLongValue }">
        <!-- v3.0.0：下载按钮移到下方「二维码 / 分享」同一行的最后面（见 preview-toolbar） -->
        <!-- v3.0.0（R12）：只读共享 → 顶部一行按钮整行不渲染（不只是逐个隐藏） -->
        <div class="detail-actions" v-if="!readonlyShared">
            <!--
                v3.0.0：顶行按钮顺序统一为 ——
                标签 → 黑名单 → 白名单 → 编辑 → 重命名 → 删除 → 限时 → 加密 → 重定向
                （二维码 / 分享 / 下载 保留在下方另一行；回收站只保留「恢复 / 彻底删除」）
                标签管理 / 黑名单 / 白名单属于「文件管理」页的批量能力：
                其它页面（如历史记录）复用本详情弹窗时可通过 showAdvanced=false 隐藏它们。
                普通用户还须拥有「可编辑」权限，否则不加载这些按钮（后端同样校验）。
            -->
            <el-button v-if="showAdvanced && !isEditing && canEditAction && !trashMode" type="primary" @click="$emit('tagManagement')" round size="small" class="detail-action">
                <font-awesome-icon icon="tags" style="margin-right: 3px;"></font-awesome-icon> {{ $t('fileDetail.tags') }}
            </el-button>
            <!-- v2.6.0 #303：黑白名单 toggle —— 已在名单时按钮变「移出」，再点恢复 None -->
            <el-button v-if="showAdvanced && !isEditing && canEditAction && !trashMode" :type="isBlocked ? 'danger' : 'primary'" @click="$emit('block')" round size="small" class="detail-action">
                <font-awesome-icon icon="ban" style="margin-right: 3px;"></font-awesome-icon> {{ isBlocked ? $t('fileDetail.removeFromBlacklist') : $t('fileDetail.blacklist') }}
            </el-button>
            <el-button v-if="showAdvanced && !isEditing && canEditAction && !trashMode" :type="isWhitelisted ? 'success' : 'primary'" @click="$emit('white')" round size="small" class="detail-action">
                <font-awesome-icon icon="shield-alt" style="margin-right: 3px;"></font-awesome-icon> {{ isWhitelisted ? $t('fileDetail.removeFromWhitelist') : $t('fileDetail.whitelist') }}
            </el-button>
            <el-button type="warning" @click="startEdit()" round size="small" class="detail-action" v-if="!isEditing && canEditAction && !trashMode">
                <font-awesome-icon icon="edit" style="margin-right: 3px;"></font-awesome-icon> {{ $t('fileDetail.edit') }}
            </el-button>
            <el-button type="info" @click="openRenameDialog()" round size="small" class="detail-action" v-if="!isEditing && canEditAction && !trashMode">
                <font-awesome-icon icon="i-cursor" style="margin-right: 3px;"></font-awesome-icon> {{ $t('fileDetail.rename') }}
            </el-button>
            <!-- 回收站模式：删除按钮替换为「恢复」+「彻底删除」 -->
            <template v-if="trashMode">
                <!--
                    v1.0.1：恢复 / 彻底删除执行期间按钮转圈并禁用 ——
                    回收站操作常在详情弹窗里发起，卡片上的遮罩被弹窗盖住，用户看不到任何反馈。
                -->
                <el-button type="success" @click="$emit('restore')" round size="small" class="detail-action" v-if="canDeleteAction" :loading="trashBusy" :disabled="trashBusy">
                    <font-awesome-icon v-if="!trashBusy" icon="undo" style="margin-right: 3px;"></font-awesome-icon>
                    {{ trashBusy ? $t('dashboard.trashProcessing') : $t('fileDetail.restoreBtn') }}
                </el-button>
                <el-button type="danger" @click="$emit('purge')" round size="small" class="detail-action" v-if="canDeleteAction" :loading="trashBusy" :disabled="trashBusy">
                    <font-awesome-icon v-if="!trashBusy" icon="trash-alt" style="margin-right: 3px;"></font-awesome-icon>
                    {{ trashBusy ? $t('dashboard.trashProcessing') : $t('fileDetail.purgeBtn') }}
                </el-button>
            </template>
            <!-- 删除：须拥有「可删除」权限，否则不加载删除按钮 -->
            <el-button v-if="!trashMode && !isEditing && canDeleteAction" type="danger" @click="$emit('delete')" round size="small" class="detail-action">
                <font-awesome-icon icon="trash-alt" style="margin-right: 3px;"></font-awesome-icon> {{ $t('fileDetail.deleteBtn') }}
            </el-button>
            <!-- 限时：设置链接有效期（到时外链自动 410，旧链接同样失效） -->
            <el-button type="warning" plain @click="openExpiryDialog()" round size="small" class="detail-action" v-if="!isEditing && canEditAction && !trashMode && noteLoaded">
                <font-awesome-icon icon="clock" style="margin-right: 3px;"></font-awesome-icon> {{ $t('fileDetail.expiryButton') }}
            </el-button>
            <!-- v3.0.0：文件级加密 —— 已加密时按钮为激活态，弹窗内可改密码 / 清除密码 -->
            <el-button
                :type="fileEncrypted ? 'success' : 'info'"
                :plain="!fileEncrypted"
                @click="openPasswordDialog()"
                round
                size="small"
                class="detail-action"
                v-if="!isEditing && canEditAction && !trashMode && noteLoaded"
            >
                <font-awesome-icon :icon="fileEncrypted ? 'shield-alt' : 'key'" style="margin-right: 3px;"></font-awesome-icon>
                {{ fileEncrypted ? $t('fileDetail.encryptOn') : $t('fileDetail.encrypt') }}
            </el-button>
            <!-- 重定向：用自定义链接替换真实文件源（清空即恢复渠道直链） -->
            <el-button type="primary" plain @click="openRedirectDialog()" round size="small" class="detail-action" v-if="!isEditing && canEditAction && !trashMode">
                <font-awesome-icon icon="exchange-alt" style="margin-right: 3px;"></font-awesome-icon> {{ $t('dashboard.redirect') }}
            </el-button>
            <el-button type="success" @click="saveMetadata()" round size="small" class="detail-action" v-if="isEditing" :loading="editSaving">
                <font-awesome-icon icon="save" style="margin-right: 3px;" v-if="!editSaving"></font-awesome-icon> {{ $t('fileDetail.save') }}
            </el-button>
            <el-button @click="cancelEdit()" round size="small" class="detail-action" v-if="isEditing">
                {{ $t('fileDetail.cancel') }}
            </el-button>
        </div>
        <!--
            签发外链（v2.3.0）：从「嵌在页面里的一排标签」改成独立模块 ——
            外层有边框与底色，内部可左右滑动（窄屏也能一行看完所有格式）。
        -->
        <div class="link-block">
            <el-tabs v-model="activeTab" @tab-click="handleTabClick">
                <el-tab-pane :label="$t('fileDetail.originUrl')" name="originUrl">
                    <el-input v-model="urls.originUrl" readonly @click="handleUrlClick"></el-input>
                </el-tab-pane>
                <el-tab-pane label="Markdown" name="mdUrl">
                    <el-input v-model="urls.mdUrl" readonly @click="handleUrlClick"></el-input>
                </el-tab-pane>
                <el-tab-pane label="HTML" name="htmlUrl">
                    <el-input v-model="urls.htmlUrl" readonly @click="handleUrlClick"></el-input>
                </el-tab-pane>
                <el-tab-pane label="BBCode" name="bbUrl">
                    <el-input v-model="urls.bbUrl" readonly @click="handleUrlClick"></el-input>
                </el-tab-pane>
                <el-tab-pane label="TG File ID" v-if="file?.metadata?.TgFileId" name="tgId">
                    <el-input v-model="urls.tgId" readonly @click="handleUrlClick"></el-input>
                </el-tab-pane>
                <el-tab-pane label="S3 Location" v-if="file?.metadata?.S3Location" name="s3Location">
                    <el-input v-model="urls.S3Location" readonly @click="handleUrlClick"></el-input>
                </el-tab-pane>
                <el-tab-pane label="S3 CDN URL" v-if="file?.metadata?.S3CdnFileUrl" name="s3CdnFileUrl">
                    <el-input v-model="urls.S3CdnFileUrl" readonly @click="handleUrlClick"></el-input>
                </el-tab-pane>
            </el-tabs>
        </div>

        <!--
            v3.0.0（R8）：评分 / 等级 —— 点星 / 点心直接存库（FileRecord.rating / level 列）。
            评分 = 五颗星（v3.0.0 R14 起取消半星，点一次一星）；等级 = 五个爱心（1-5，默认空心）。
            权限（v3.0.0 R14 放宽）：作者本人 / 管理员 / 可编辑共享目录的接收方（canRate）。
        -->
        <div class="detail-rating" v-if="!trashMode">
            <div class="detail-rating-row">
                <span class="detail-rating-label">{{ $t('fileDetail.ratingLabel') }}</span>
                <el-rate
                    v-model="ratingValue"
                    :disabled="!canRate"
                    :clearable="true"
                    @change="saveRatingLevel"
                />
                <span class="detail-rating-value">{{ ratingValue > 0 ? ratingValue : $t('fileDetail.ratingNone') }}</span>
            </div>
            <div class="detail-rating-row">
                <span class="detail-rating-label">{{ $t('fileDetail.levelLabel') }}</span>
                <!-- 等级 = 五个爱心（1-5 整数）：默认空心灰，选中（有评级值）后变红色实心 -->
                <span class="detail-level-stars" :class="{ 'is-disabled': !canRate }">
                    <button
                        v-for="i in 5"
                        :key="'lv-' + i"
                        type="button"
                        class="detail-level-heart"
                        :class="{ 'is-on': levelValue >= i, 'is-hover': canRate && levelHover >= i }"
                        :disabled="!canRate"
                        :aria-label="$t('fileDetail.levelLabel') + ' ' + i"
                        @click="setLevel(i)"
                        @mouseenter="levelHover = i"
                        @mouseleave="levelHover = 0"
                    >
                        <!-- v3.0.0（R14）：未选中 = 空心（far/heart），选中 = 实心（heart，红色） -->
                        <font-awesome-icon :icon="levelValue >= i ? 'heart' : ['far', 'heart']" />
                    </button>
                </span>
                <span class="detail-rating-value">{{ levelValue > 0 ? levelValue : $t('fileDetail.levelNone') }}</span>
            </div>
            <div v-if="!canRate" class="detail-rating-hint">{{ $t('fileDetail.ratingReadonlyHint') }}</div>
        </div>
        <!-- 文件预览区域 -->
        <div class="preview-section">
            <!-- 二维码不再单开标签页：直接在这个「文件加载区域」里替换文件显示（v2.3.0） -->
            <div class="preview-toolbar">
                <el-button
                    size="small"
                    :type="showQr ? 'primary' : 'default'"
                    plain
                    @click="toggleQr"
                >
                    <font-awesome-icon icon="qrcode" class="preview-toolbar-icon" />{{ $t('fileDetail.qrCode') }}
                </el-button>
                <!-- v3.0.0：分享 —— 二维码 + 可选信息卡片，可保存为图片 -->
                <el-button size="small" plain class="preview-toolbar-share" @click="openShareDialog">
                    <font-awesome-icon icon="share-alt" class="preview-toolbar-icon" />{{ $t('fileDetail.share') }}
                </el-button>
                <!-- v3.0.0：二维码区的「手机扫码即可打开…」长句已整句移除，只保留二维码本身 -->
                <!--
                    v3.0.0（R10）：「源」按钮 —— 显示「文件加载域名 + 固化地址」
                    （代理模式=内网通信域名，重定向模式=公开访问域名），点击复制。
                    存储渠道 / 备份渠道两项另用「公开访问域名」，供对外分享。
                -->
                <el-button
                    v-if="!isEditing && !trashMode && storageSourceUrl"
                    size="small"
                    plain
                    class="preview-toolbar-source"
                    :title="storageSourceUrl"
                    @click="openSourceDialog"
                >
                    <font-awesome-icon icon="link" class="preview-toolbar-icon" />{{ $t('fileDetail.sourceUrl') }}
                </el-button>
                <!-- v3.0.0：下载按钮从顶部左侧移到这里，排在最后并靠右；
                     v3.0.0（R5）：样式与前面的「二维码」按钮完全一致（plain + small + 同圆角/内边距） -->
                <el-button
                    v-if="!isEditing && !trashMode"
                    class="preview-toolbar-download"
                    size="small"
                    plain
                    @click="$emit('download')"
                >
                    <font-awesome-icon icon="download" class="preview-toolbar-icon" />{{ $t('fileDetail.download') }}
                </el-button>
                <!--
                    v3.0.0（R14）：声音开关。
                    v1.0.6：位置从「整排按钮最后」移到「下载」正后方 ——
                    它是播放相关的控件，跟下载挨着比跟「转存 / 裁剪 / 转码」挨着更符合直觉。
                    同一份全局状态（store.globalVideoMuted），统一控制预览浮层视频、详情页视频与音频。
                -->
                <el-button
                    v-if="!isEditing && !trashMode && (isVideo || isAudio)"
                    class="preview-toolbar-mute"
                    :class="{ 'is-active': !videoMuted }"
                    size="small"
                    plain
                    :title="videoMuted ? $t('dashboard.videoMutedOn') : $t('dashboard.videoMutedOff')"
                    :aria-label="videoMuted ? $t('dashboard.videoMutedOn') : $t('dashboard.videoMutedOff')"
                    @click="toggleMediaSound"
                >
                    <font-awesome-icon :icon="videoMuted ? 'volume-mute' : 'volume-up'" class="preview-toolbar-icon" />
                </el-button>
                <!--
                    v1.0.3：转存按钮（紧跟「下载」之后）——
                    当前在本地存储渠道时显示「存异地」，否则显示「转本地」。
                    只换渠道与跟随变化的数据，文件名 / 类型 / 分类 / 标签 / 外链全部不变。
                -->
                <el-button
                    v-if="!isEditing && !trashMode"
                    class="preview-toolbar-convert"
                    size="small"
                    plain
                    :loading="convertLoading"
                    @click="openConvertDialog"
                >
                    <font-awesome-icon icon="right-left" class="preview-toolbar-icon" />{{ convertDirectionLabel }}
                </el-button>
                <!--
                    v1.0.5：原位媒体编辑（仅本地存储渠道的主副本可用，后端 media/info 探测后才显示）。
                    原位 = 磁盘路径、文件名、扩展名都不变，因此已经发出去的外链全部继续有效。
                    图片 → 裁剪 / 压缩 / 转WebP；视频 → 转码 / 压缩；音频 → 压缩。
                -->
                <template v-if="mediaReady && !isEditing && canEditAction && !trashMode">
                    <el-button
                        v-if="mediaInfo.canCrop"
                        class="preview-toolbar-media"
                        size="small"
                        plain
                        :loading="cropLoading"
                        :disabled="mediaBusy"
                        @click="openMediaCrop()"
                    >
                        <font-awesome-icon v-if="!cropLoading" icon="crop" class="preview-toolbar-icon" />{{ $t('fileDetail.mediaCrop') }}
                    </el-button>
                    <el-button
                        v-if="mediaInfo.canCompress"
                        class="preview-toolbar-media"
                        size="small"
                        plain
                        :disabled="mediaBusy"
                        @click="openCompressDialog()"
                    >
                        <font-awesome-icon icon="compress-alt" class="preview-toolbar-icon" />{{ $t('fileDetail.mediaCompress') }}
                    </el-button>
                    <el-button
                        v-if="mediaInfo.canWebp"
                        class="preview-toolbar-media"
                        size="small"
                        plain
                        :disabled="mediaBusy"
                        @click="openWebpDialog()"
                    >
                        <font-awesome-icon icon="file-image" class="preview-toolbar-icon" />{{ $t('fileDetail.mediaWebp') }}
                    </el-button>
                    <el-button
                        v-if="mediaInfo.canTranscode"
                        class="preview-toolbar-media"
                        size="small"
                        plain
                        :loading="transcodeBusy"
                        :disabled="mediaBusy"
                        @click="doTranscode()"
                    >
                        <font-awesome-icon v-if="!transcodeBusy" icon="film" class="preview-toolbar-icon" />{{ $t('fileDetail.mediaTranscode') }}
                    </el-button>
                </template>
            </div>
            <div class="preview-content" :class="{ 'is-qr': showQr }">
                <!-- v2.4.0：二维码改为真实 <img> 渲染（见 QRCodeBox），
                     移动端长按 = 浏览器原生菜单（识别/保存），PC 右键 = 浏览器原生菜单，
                     不再挂任何自定义右键/长按菜单 -->
                <template v-if="showQr">
                    <QRCodeBox :value="qrValue" :size="qrSize" :empty-text="$t('fileDetail.qrEmpty')" />
                </template>
                <template v-else>
                    <!-- v2.8.7b：视频始终静音起播（修复开启声音模式后长时间不出画面），可播放后再按全局开关设置声音；关闭弹窗时暂停 -->
                    <!-- v2.8.7c：mediaMounted 控制 —— 关闭弹窗即销毁媒体元素（彻底停止播放、
                         不会再被后台缓冲的 canplay 触发复活），重新打开时重建元素并主动起播 -->
                    <video v-if="isVideo && mediaMounted" ref="detailVideo" :src="fileLink" muted loop class="video-preview" @click="openImageLink" @canplay="startDetailVideo"></video>
                    <audio v-else-if="isAudio && mediaMounted" ref="detailAudio" :src="fileLink" controls class="audio-preview" :muted="videoMuted" @canplay="startDetailAudio"></audio>
                    <el-image
                        v-else-if="isImage"
                        :src="fileLink"
                        fit="contain"
                        class="image-preview"
                        title="在新标签页打开"
                        @click="openImageLink"
                    ></el-image>
                    <font-awesome-icon v-else icon="file" class="file-icon-detail"></font-awesome-icon>
                </template>
            </div>
        </div>
        <!--
            v3.0.0：缩略图与文件信息之间的分隔行 —— 有效期以「细信息条」的形式压在这条线上，
            原「有效期」独立行已移除，不再重复出现。
        -->
        <div class="detail-divider-bar">
            <span class="detail-divider-label">{{ $t('fileDetail.expiryCurrent') }}</span>
            <span class="detail-divider-value" :class="{ 'is-expired': expiryExpired }">{{ expiryBarText }}</span>
        </div>
        <!-- 详细信息 -->
        <el-descriptions border :column="descColumn">
            <el-descriptions-item :label="$t('fileDetail.fileNameLabel')">
                <el-input v-if="isEditing" v-model="editForm.FileName" size="small" :placeholder="$t('fileDetail.fileNamePlaceholder')"></el-input>
                <span v-else>{{ file?.metadata?.FileName || file?.name }}</span>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('fileDetail.fileType')">
                <el-input v-if="isEditing" v-model="editForm.FileType" size="small" :placeholder="$t('fileDetail.fileTypePlaceholder')"></el-input>
                <span v-else>{{ fileTypeDisplay }}</span>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('fileDetail.fileSizeLabel')">
                <!-- 悬停看「原文件大小 / 压缩后大小」详情 -->
                <el-tooltip v-if="fileSizeTooltip" placement="top" raw-content>
                    <template #content>
                        <div class="size-tooltip">{{ fileSizeTooltip }}</div>
                    </template>
                    <span class="size-value">{{ fileSizeDisplay }}</span>
                </el-tooltip>
                <span v-else>{{ fileSizeDisplay }}</span>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('fileDetail.imageDimensions')">
                <div v-if="imageDimensions" style="display: flex; align-items: center; gap: 6px;">
                    <span>{{ file?.metadata?.Width }} × {{ file?.metadata?.Height }}</span>
                    <el-tag size="small" type="info" style="display: inline-flex; align-items: center; justify-content: center;">{{ orientationIcon }}</el-tag>
                </div>
                <span v-else style="color: var(--el-text-color-secondary);">{{ $t('fileDetail.noDimensions') }}</span>
            </el-descriptions-item>
            <!-- 文件分类：编辑态下可重新选择（等价于文件管理的「移动」），非编辑态只读展示 -->
            <el-descriptions-item :label="$t('fileDetail.fileCategory')">
                <el-select
                    v-if="isEditing"
                    v-model="editForm.Directory"
                    size="small"
                    class="detail-folder-select"
                    filterable
                    allow-create
                    default-first-option
                    :loading="folderLoading"
                    :placeholder="$t('fileDetail.fileCategoryPlaceholder')"
                >
                    <el-option :label="$t('fileDetail.rootCategory')" value="" />
                    <el-option v-for="p in folderOptions" :key="p" :label="p" :value="p" />
                </el-select>
                <template v-else>
                    <!-- 点击分类值 → 跳到文件管理页的对应分类目录 -->
                    <a
                        v-if="file?.metadata?.Directory"
                        href="#"
                        class="detail-jump-link"
                        :title="$t('fileDetail.jumpToCategory')"
                        @click.prevent="jumpToFolder"
                    >{{ file.metadata.Directory }}</a>
                    <span v-else style="color: var(--el-text-color-secondary);">{{ $t('fileDetail.noCategory') }}</span>
                </template>
            </el-descriptions-item>
            <!-- v3.0.0：加载项顺序 —— 文件标签在「文件状态」之前 -->
            <el-descriptions-item :label="$t('fileDetail.fileTags')">
                <div v-if="file?.metadata?.Tags && file?.metadata?.Tags.length > 0" style="display: flex; flex-wrap: wrap; gap: 5px;">
                    <!-- 点击标签 → 跳到文件管理页并按该标签筛选 -->
                    <el-tag
                        v-for="tag in file?.metadata?.Tags"
                        :key="tag"
                        size="small"
                        class="detail-tag-link"
                        :title="$t('fileDetail.jumpToTag')"
                        @click="jumpToTag(tag)"
                    >{{ tag }}</el-tag>
                </div>
                <span v-else style="color: var(--el-text-color-secondary);">{{ $t('fileDetail.noTags') }}</span>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('fileDetail.accessStatusAndReview')">
                <el-tag size="small" :type="accessTagType" style="margin-right: 6px;">{{ accessType }}</el-tag>
                <span>{{ file?.metadata?.Label || $t('fileDetail.noTags') }}</span>
            </el-descriptions-item>
            <!-- v3.0.0：所属实例（取文件数据的 instanceId → GET /api/instances 映射「实例名（序号）」，空串 = 默认） -->
            <el-descriptions-item :label="$t('fileDetail.instanceLabel')">
                <el-tag size="small" :type="currentInstanceId ? 'primary' : 'info'">{{ instanceDisplay }}</el-tag>
            </el-descriptions-item>
            <!-- 「存储渠道」与「备份渠道」同一行，存储在前；值可点击打开该文件对应渠道的直链，右侧可复制该直链 -->
            <el-descriptions-item :label="$t('fileDetail.storageChannel')">
                <div class="channel-row">
                    <a v-if="storageChannelUrl" class="channel-link" :href="storageChannelUrl" target="_blank" rel="noopener noreferrer" :title="storageChannelUrl">
                        <el-tag size="small" type="info">{{ file?.metadata?.Channel || $t('fileDetail.unknown') }}</el-tag>
                        <span class="channel-name">{{ file?.metadata?.ChannelName || '-' }}</span>
                    </a>
                    <span v-else class="channel-link is-static" :title="$t('fileDetail.channelNoPublicUrl')">
                        <el-tag size="small" type="info">{{ file?.metadata?.Channel || $t('fileDetail.unknown') }}</el-tag>
                        <span class="channel-name">{{ file?.metadata?.ChannelName || '-' }}</span>
                    </span>
                    <el-button
                        v-if="storageChannelUrl"
                        size="small"
                        text
                        class="channel-copy-btn"
                        :title="$t('fileDetail.copyChannelUrl')"
                        @click="copyChannelUrl(storageChannelUrl)"
                    >
                        <font-awesome-icon icon="copy"></font-awesome-icon>
                    </el-button>
                </div>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('fileDetail.backupChannels')">
                <div v-if="backupChannelList.length > 0" style="display: flex; flex-wrap: wrap; gap: 6px;">
                    <div v-for="(b, idx) in backupChannelList" :key="idx" class="channel-row">
                        <!--
                            v2.5.0：备份渠道格式与「存储渠道」统一 ——
                            渠道类型保持原有带背景块的 tag（warning 底色不变），渠道名改为纯文本。
                        -->
                        <a
                            v-if="channelFileUrl(b.id, b.url, b.type)"
                            class="channel-link"
                            :href="channelFileUrl(b.id, b.url, b.type)"
                            target="_blank"
                            rel="noopener noreferrer"
                            :title="channelFileUrl(b.id, b.url, b.type)"
                        >
                            <el-tag size="small" type="warning">{{ b.label }}</el-tag>
                            <span class="channel-name">{{ b.name || '-' }}</span>
                        </a>
                        <!-- v3.0.0（R15）：无对外直链时渲染为纯文本，避免空 href / 内网地址 -->
                        <span v-else class="channel-link is-static" :title="$t('fileDetail.channelNoPublicUrl')">
                            <el-tag size="small" type="warning">{{ b.label }}</el-tag>
                            <span class="channel-name">{{ b.name || '-' }}</span>
                        </span>
                        <el-button
                            v-if="channelFileUrl(b.id, b.url, b.type)"
                            size="small"
                            text
                            class="channel-copy-btn"
                            :title="$t('fileDetail.copyChannelUrl')"
                            @click="copyChannelUrl(channelFileUrl(b.id, b.url, b.type))"
                        >
                            <font-awesome-icon icon="copy"></font-awesome-icon>
                        </el-button>
                    </div>
                </div>
                <span v-else style="color: var(--el-text-color-secondary);">{{ $t('fileDetail.noBackup') }}</span>
            </el-descriptions-item>
            <!-- 上传用户：记录该文件由哪个账户上传 -->
            <el-descriptions-item :label="$t('dashboard.uploadUser')">{{ file?.metadata?.UploadUser || $t('fileDetail.unknown') }}</el-descriptions-item>
            <!-- 上传渠道：Default（历史网页上传）/ Upload（文件模式）/ Fetch（链接模式）/ WebDAV / API-Web / API-S3 -->
            <el-descriptions-item :label="$t('fileDetail.uploadChannel')">{{ uploadSourceLabel(file?.metadata?.UploadSource) }}</el-descriptions-item>
            <!-- 上传时长 / 上传速度：由后端记录的「开始 → 落库」时间差与文件体积算出 -->
            <el-descriptions-item :label="$t('fileDetail.uploadDuration')">{{ uploadDurationText }}</el-descriptions-item>
            <el-descriptions-item :label="$t('fileDetail.uploadSpeed')">{{ uploadSpeedText }}</el-descriptions-item>
            <!-- v3.0.0：「IP 归属地」更名为「上传 IP」—— 值仍是 IP，归属地文本保留在括号里 -->
            <el-descriptions-item :label="$t('fileDetail.uploadIpLabel')">
                <span :class="{ 'ip-display-multiline': String(uploadIpText || '').includes('\n') }">{{ uploadIpText }}</span>
            </el-descriptions-item>
            <!-- v2.7.0：「访问次数」—— 后端 serializeFile 已下发 metadata.Views -->
            <el-descriptions-item :label="$t('fileDetail.views')">{{ Number(file?.metadata?.Views) || 0 }}</el-descriptions-item>
            <!-- v3.0.0（第三轮）：上传时间 / MD5 排在「访问次数」之后、「文件加密」之前 -->
            <el-descriptions-item :label="$t('fileDetail.uploadTimeLabel')">{{ uploadTime }}</el-descriptions-item>
            <!-- MD5 紧随「上传时间」之后 -->
            <el-descriptions-item :label="$t('fileDetail.md5')">
                <span class="md5-value" :title="file?.metadata?.MD5">{{ file?.metadata?.MD5 || $t('fileDetail.unknown') }}</span>
            </el-descriptions-item>
            <!-- v3.0.0：文件加密（密码以 SHA-256 存储、不可逆，只显示是否已设置，不显示明文） -->
            <el-descriptions-item :label="$t('fileDetail.fileEncryptLabel')">
                <div class="detail-encrypt-row">
                    <el-tag size="small" :type="fileEncrypted ? 'success' : 'info'">{{ fileEncrypted ? $t('fileDetail.encryptOn') : $t('fileDetail.encryptOff') }}</el-tag>
                    <span v-if="fileEncrypted" class="detail-encrypt-hint">{{ $t('fileDetail.encryptHashHint') }}</span>
                </div>
            </el-descriptions-item>
            <!-- 重定向状态：单独占满一整行（放在加密项之后） -->
            <el-descriptions-item :label="$t('dashboard.redirect')" :span="descColumn">
                <a v-if="file?.metadata?.RedirectUrl" class="channel-link" :href="file.metadata.RedirectUrl" target="_blank" rel="noopener noreferrer" :title="file.metadata.RedirectUrl">
                    <el-tag size="small" type="success">{{ $t('dashboard.redirectSet') }}</el-tag>
                    <span class="channel-name">{{ file.metadata.RedirectUrl }}</span>
                </a>
                <span v-else style="color: var(--el-text-color-secondary);">{{ $t('dashboard.filterRedirectNo') }}</span>
            </el-descriptions-item>

            <!--
                v3.0.0：文件处理记录 —— 按「失败 → 重试 → WebP → 压缩 → 转码」分组渲染，
                每组内为「label + value」信息行；整组无数据时隐藏，保持清爽。
                数据源：metas.ProcessEvent（旧记录只有部分字段也能正常显示）。
            -->
            <el-descriptions-item v-if="processGroups.length > 0" :label="$t('fileDetail.processEvent')" :span="descColumn">
                <div class="process-groups">
                    <div v-for="group in processGroups" :key="group.key" class="process-group">
                        <div class="process-group-title">{{ group.title }}</div>
                        <div class="process-group-rows">
                            <div v-for="row in group.rows" :key="row.label" class="process-group-row">
                                <span class="process-group-label">{{ row.label }}</span>
                                <span class="process-group-value">{{ row.value }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </el-descriptions-item>
        </el-descriptions>
        <!-- 备注：仅上传者本人可见可改，后端也只对作者下发该字段 -->
        <div class="detail-note" v-if="noteVisible && !trashMode">
            <div class="detail-note-head">
                <span class="detail-note-title">{{ $t('fileDetail.noteTitle') }}</span>
                <span class="detail-note-hint">{{ $t('fileDetail.noteHint') }}</span>
            </div>
            <el-input
                v-model="noteText"
                type="textarea"
                :rows="3"
                maxlength="4000"
                show-word-limit
                :placeholder="$t('fileDetail.notePlaceholder')"
            />
            <div class="detail-note-actions">
                <el-button size="small" type="primary" :loading="noteSaving" @click="saveNote">{{ $t('common.save') }}</el-button>
            </div>
        </div>
        <!-- 重命名弹窗 -->
        <el-dialog
            v-model="showRenameDialog"
            :title="$t('fileDetail.renameTitle')"
            :width="dialogWidth"
            append-to-body
        >
            <el-form @submit.prevent="submitRename">
                <!-- 历史名称（v2.3.0）：改过的 File Name 很容易「改不回去」，
                     这里常显「原始名称 / 上一次名称」，并支持一键回填。 -->
                <div class="rename-history">
                    <div class="rename-history-row">
                        <span class="rename-history-label">{{ $t('fileDetail.renameFirstName') }}</span>
                        <code class="rename-history-value">{{ file?.metadata?.FileFirstName || file?.name || '-' }}</code>
                        <el-button
                            v-if="file?.metadata?.FileFirstName && file?.metadata?.FileFirstName !== file?.name"
                            link
                            type="primary"
                            size="small"
                            @click="fillRename(file.metadata.FileFirstName)"
                        >{{ $t('fileDetail.renameUseThis') }}</el-button>
                    </div>
                    <div class="rename-history-row">
                        <span class="rename-history-label">{{ $t('fileDetail.renamePrevName') }}</span>
                        <code class="rename-history-value">{{ file?.metadata?.FilePrevName || $t('fileDetail.renamePrevNone') }}</code>
                        <el-button
                            v-if="file?.metadata?.FilePrevName"
                            link
                            type="primary"
                            size="small"
                            @click="fillRename(file.metadata.FilePrevName)"
                        >{{ $t('fileDetail.renameUseThis') }}</el-button>
                    </div>
                </div>
                <el-form-item :label="$t('fileDetail.renameLabel')" :error="renameValidation.error">
                    <div class="rename-input-row">
                        <!-- v2.9.0：只读 —— 不允许手动输入，只能点「生成名称」按钮生成 48 位随机值 -->
                        <el-input
                            v-model="renameForm.newFileId"
                            :placeholder="$t('fileDetail.renameReadonlyPlaceholder')"
                            readonly
                            @input="validateRenameInput"
                        ></el-input>
                        <!-- 按系统命名规则生成新名（仅预填输入框，不写库；确认重命名后才落库） -->
                        <el-button
                            type="primary"
                            plain
                            size="small"
                            class="rename-generate-btn"
                            :loading="renameGenerating"
                            @click="generateRenameName"
                        >{{ $t('fileDetail.renameGenerate') }}</el-button>
                    </div>
                    <div class="rename-readonly-hint">{{ $t('fileDetail.renameReadonlyHint') }}</div>
                </el-form-item>
            </el-form>
            <template #footer>
                <el-button @click="closeRenameDialog()">{{ $t('fileDetail.renameCancel') }}</el-button>
                <el-button type="primary" @click="submitRename()" :loading="renameSaving" :disabled="!renameValidation.valid">{{ $t('fileDetail.renameConfirm') }}</el-button>
            </template>
        </el-dialog>
        <!-- 重定向弹窗 -->
        <el-dialog
            v-model="showRedirectDialog"
            :title="$t('dashboard.redirect')"
            :width="dialogWidth"
            append-to-body
        >
            <el-form @submit.prevent="submitRedirect">
                <el-form-item :label="$t('fileDetail.redirectTarget')">
                    <el-input v-model="redirectForm.url" :placeholder="$t('dashboard.redirectPlaceholder')" clearable></el-input>
                </el-form-item>
                <div class="redirect-tip">{{ $t('fileDetail.redirectTip') }}</div>
            </el-form>
            <template #footer>
                <el-button @click="showRedirectDialog = false">{{ $t('common.cancel') }}</el-button>
                <el-button @click="submitRedirect(true)" :loading="redirectSaving" :disabled="!file?.metadata?.RedirectUrl">{{ $t('dashboard.redirectClear') }}</el-button>
                <el-button type="primary" @click="submitRedirect(false)" :loading="redirectSaving">{{ $t('common.save') }}</el-button>
            </template>
        </el-dialog>
        <!-- 限时弹窗：永久 / 有效时长 / 指定截止时间 -->
        <el-dialog v-model="showExpiryDialog" :title="$t('fileDetail.expiryTitle')" :width="dialogWidth" append-to-body>
            <el-radio-group v-model="expiryForm.mode" class="expiry-modes">
                <el-radio label="forever">{{ $t('fileDetail.expiryForever') }}</el-radio>
                <el-radio label="duration">{{ $t('fileDetail.expiryDuration') }}</el-radio>
                <el-radio label="datetime">{{ $t('fileDetail.expiryDatetime') }}</el-radio>
            </el-radio-group>
            <div v-if="expiryForm.mode === 'duration'" class="expiry-row">
                <el-input-number v-model="expiryForm.amount" :min="1" :max="9999" controls-position="right" />
                <el-select v-model="expiryForm.unit" style="width: 110px; margin-left: 8px;">
                    <el-option :label="$t('fileDetail.expiryUnitMinute')" value="m" />
                    <el-option :label="$t('fileDetail.expiryUnitHour')" value="h" />
                    <el-option :label="$t('fileDetail.expiryUnitDay')" value="d" />
                </el-select>
            </div>
            <div v-if="expiryForm.mode === 'datetime'" class="expiry-row">
                <!-- v3.0.0：移动端截止时间选择改为居中弹层（面板固定居中、不被输入框裁切），桌面端保持现状 -->
                <el-date-picker
                    v-model="expiryForm.at"
                    type="datetime"
                    :placeholder="$t('fileDetail.expiryDatetime')"
                    value-format="YYYY-MM-DDTHH:mm:ss"
                    :teleported="true"
                    :popper-class="expiryPickerPopperClass"
                    style="width: 100%;"
                />
            </div>
            <div class="redirect-tip">{{ $t('fileDetail.expiryTip') }}</div>
            <template #footer>
                <el-button @click="showExpiryDialog = false">{{ $t('common.cancel') }}</el-button>
                <el-button type="primary" :loading="expirySaving" @click="submitExpiry">{{ $t('common.save') }}</el-button>
            </template>
        </el-dialog>
        <!-- v3.0.0：文件加密弹窗（设置 / 修改 / 清除访问密码） -->
        <el-dialog v-model="showPasswordDialog" :title="$t('fileDetail.encryptTitle')" :width="dialogWidth" append-to-body>
            <div class="encrypt-status">
                <span class="encrypt-status-label">{{ $t('fileDetail.encryptStatus') }}</span>
                <el-tag size="small" :type="fileEncrypted ? 'success' : 'info'">{{ fileEncrypted ? $t('fileDetail.encryptOn') : $t('fileDetail.encryptOff') }}</el-tag>
            </div>
            <!--
                v3.0.0：输入框与后缀区改成 flex 布局（输入框 flex:1 + min-width:0），
                后缀按钮不会再被输入框压住；窄屏自动换到下一行。
            -->
            <div class="encrypt-field">
                <div class="encrypt-field-main">
                    <el-input
                        class="encrypt-input"
                        v-model="passwordForm.password"
                        type="password"
                        show-password
                        clearable
                        :placeholder="$t('fileDetail.encryptPlaceholder')"
                        @keyup.enter="submitPassword"
                    >
                        <template #prefix><font-awesome-icon icon="key" /></template>
                    </el-input>
                    <el-button
                        v-if="fileEncrypted"
                        class="encrypt-clear-btn"
                        :loading="passwordSaving"
                        @click="submitPassword(true)"
                    >{{ $t('fileDetail.encryptClear') }}</el-button>
                </div>
                <div class="encrypt-field-hint">{{ $t('fileDetail.encryptHint') }}</div>
            </div>
            <template #footer>
                <el-button @click="showPasswordDialog = false">{{ $t('common.cancel') }}</el-button>
                <el-button type="primary" :loading="passwordSaving" @click="submitPassword(false)">{{ $t('common.save') }}</el-button>
            </template>
        </el-dialog>
        <!-- v3.0.0：分享卡片弹窗 -->
        <ShareDialog
            v-model="showShareDialog"
            :file="file"
            :fileLink="fileLink"
            :qrValue="qrValue"
            :urls="urls"
        />
        <!--
            v1.0.3：转存弹窗（转本地 / 转异地）。
            append-to-body + 独立 z-index：必须盖在详情弹窗之上。
            只做两件事：选目标渠道（转本地还要选保留/删除源件），点确定执行。
        -->
        <el-dialog
            v-model="showConvertDialog"
            :title="convertDirection === 'to-local' ? $t('fileDetail.convertToLocal') : $t('fileDetail.convertToRemote')"
            width="460px"
            append-to-body
            class="convert-dialog"
        >
            <div v-loading="convertLoading" class="convert-body">
                <div class="convert-row">
                    <span class="convert-label">{{ $t('fileDetail.convertCurrent') }}</span>
                    <span class="convert-value">{{ convertCurrentChannel }}</span>
                </div>
                <div class="convert-row is-column">
                    <span class="convert-label">{{ $t('fileDetail.convertTarget') }}</span>
                    <el-select
                        v-model="convertChannelId"
                        :placeholder="$t('fileDetail.convertTargetPlaceholder')"
                        style="width: 100%"
                        filterable
                    >
                        <el-option
                            v-for="ch in convertChannels"
                            :key="ch.id"
                            :label="ch.name"
                            :value="ch.id"
                        >
                            <span>{{ ch.name }}</span>
                            <span class="convert-option-type">{{ ch.type }}</span>
                        </el-option>
                    </el-select>
                </div>
                <!-- 第三方 → 本地才需要选「保留源件 / 删除源件」；默认不选，必须二选一 -->
                <div v-if="convertDirection === 'to-local'" class="convert-row is-column">
                    <span class="convert-label">{{ $t('fileDetail.convertSourceMode') }}</span>
                    <el-radio-group v-model="convertDeleteSource" class="convert-radio">
                        <el-radio :label="false">{{ $t('fileDetail.convertKeepSource') }}</el-radio>
                        <el-radio :label="true" :disabled="!convertCanDeleteSource">
                            {{ $t('fileDetail.convertDeleteSource') }}
                        </el-radio>
                    </el-radio-group>
                    <p v-if="!convertCanDeleteSource" class="convert-hint is-warn">
                        {{ $t('fileDetail.convertDeleteForbidden') }}
                    </p>
                </div>
                <p v-else class="convert-hint">{{ $t('fileDetail.convertRemoteHint') }}</p>
                <p v-if="convertDirection === 'to-local'" class="convert-hint">
                    {{ $t('fileDetail.convertKeepHint') }}
                </p>
            </div>
            <template #footer>
                <el-button @click="showConvertDialog = false">{{ $t('common.cancel') }}</el-button>
                <el-button
                    type="primary"
                    :loading="convertLoading"
                    :disabled="!convertChannelId || (convertDirection === 'to-local' && convertDeleteSource === null)"
                    @click="submitConvert"
                >{{ $t('fileDetail.convertConfirm') }}</el-button>
            </template>
        </el-dialog>

        <!-- ============================================================
             v1.0.5：原位媒体编辑的三个弹窗（裁剪 / 压缩 / 转WebP）
             ============================================================ -->

        <!-- 裁剪：复用上传页的裁剪组件（含旋转方向），裁好后回传结果图 -->
        <ImageCropDialog
            v-model="showCropDialog"
            :file="cropFile"
            :file-name="cropFileName"
            @done="onMediaCropped"
        />

        <el-dialog
            v-model="showCompressDialog"
            :title="$t('fileDetail.compressTitle')"
            width="440px"
            append-to-body
            class="gohub-media-dialog"
        >
            <div class="media-dialog-body">
                <p class="media-dialog-text">{{ $t('fileDetail.compressIntro') }}</p>
                <div class="media-percent-row">
                    <el-slider v-model="compressPercent" :min="10" :max="95" :step="5" show-stops style="flex: 1" />
                    <span class="media-percent-value">{{ compressPercent }}%</span>
                </div>
                <!-- v1.0.6：先摆事实（当前多大），再给预期（压完约多大），顺序上更好理解 -->
                <p class="media-dialog-hint">
                    {{ $t('fileDetail.compressCurrentSize', { size: formatBytes(mediaInfo && mediaInfo.size) }) }}
                </p>
                <p class="media-dialog-hint">
                    {{ $t('fileDetail.compressEstimate', { size: estimatedCompressSize }) }}
                </p>
                <p v-if="mediaInfo && mediaInfo.compressedBefore" class="media-dialog-hint is-warn is-loud">
                    {{ $t('fileDetail.compressAgainWarn') }}
                </p>
                <p class="media-dialog-hint">{{ $t('fileDetail.compressKeepName') }}</p>
            </div>
            <template #footer>
                <el-button :disabled="compressState === 'running'" @click="showCompressDialog = false">{{ $t('common.cancel') }}</el-button>
                <el-button
                    type="primary"
                    :loading="compressState === 'running'"
                    :disabled="compressState !== 'idle'"
                    @click="doCompress(false)"
                >{{ compressButtonText }}</el-button>
            </template>
        </el-dialog>

        <el-dialog
            v-model="showWebpDialog"
            :title="$t('fileDetail.webpTitle')"
            width="440px"
            append-to-body
            class="gohub-media-dialog"
        >
            <div class="media-dialog-body">
                <p class="media-dialog-text">{{ $t('fileDetail.webpIntro') }}</p>
                <el-radio-group v-model="webpMode" class="media-radio">
                    <el-radio label="lossy">{{ $t('fileDetail.webpLossy') }}</el-radio>
                    <el-radio label="lossless">{{ $t('fileDetail.webpLossless') }}</el-radio>
                </el-radio-group>
                <p class="media-dialog-hint">{{ $t('fileDetail.webpKeepName') }}</p>
            </div>
            <template #footer>
                <el-button @click="showWebpDialog = false">{{ $t('common.cancel') }}</el-button>
                <el-button type="primary" :loading="mediaBusy" @click="doWebp()">{{ $t('fileDetail.webpConfirm') }}</el-button>
            </template>
        </el-dialog>

        <!--
            v1.0.6：「源」地址弹窗。
            原来点一下就直接复制，用户既看不到复制了什么、也无法只复制其中一段（比如只取文件名）。
            改成先展示完整地址、由用户自己决定复制，地址本身放在只读文本框里，可以随意选中。
        -->
        <el-dialog
            v-model="showSourceDialog"
            :title="$t('fileDetail.sourceUrl')"
            width="560px"
            append-to-body
            class="gohub-media-dialog"
        >
            <div class="media-dialog-body">
                <p class="media-dialog-hint">{{ $t('fileDetail.sourceDialogHint') }}</p>
                <el-input
                    :model-value="storageSourceUrl"
                    type="textarea"
                    :autosize="{ minRows: 2, maxRows: 6 }"
                    readonly
                    class="source-url-textarea"
                />
            </div>
            <template #footer>
                <el-button @click="showSourceDialog = false">{{ $t('common.close') }}</el-button>
                <el-button type="primary" @click="copyStorageSource">{{ $t('common.copy') }}</el-button>
            </template>
        </el-dialog>
        </div>
    </el-dialog>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus';
import fetchWithAuth from '@/utils/fetchWithAuth';
import { validateFileId } from '@/utils/fileIdValidator';
import { copyText } from '@/utils/clipboard';
import { fileLink } from '@/utils/fileLink';
import QRCodeBox from '@/components/common/QRCodeBox.vue';
import ShareDialog from '@/components/dashboard/ShareDialog.vue';
import ImageCropDialog from '@/components/upload/ImageCropDialog.vue';

export default {
    name: 'FileDetailDialog',
    components: { QRCodeBox, ShareDialog, ImageCropDialog },
    props: {
        modelValue: { type: Boolean, default: false },
        file: { type: Object, default: null },
        fileLink: { type: String, default: '' },
        urls: { type: Object, default: () => ({ originUrl: '', mdUrl: '', htmlUrl: '', bbUrl: '', tgId: '', S3Location: '', S3CdnFileUrl: '' }) },
        /**
         * 是否显示「标签管理 / 黑名单 / 白名单」这三个文件管理页专属动作。
         * 历史记录等页面复用本弹窗时传 false（这些动作依赖文件管理页的批量能力）。
         */
        showAdvanced: { type: Boolean, default: true },
        /** 回收站模式：隐藏普通编辑动作，只显示「恢复 / 彻底删除」 */
        trashMode: { type: Boolean, default: false },
        /** v1.0.1：回收站恢复 / 彻底删除执行中（按钮转圈 + 禁用，与软删除的转圈反馈一致） */
        trashBusy: { type: Boolean, default: false },
    },
    emits: ['update:modelValue', 'download', 'tagManagement', 'block', 'white', 'delete', 'restore', 'purge', 'metadataUpdated', 'fileRenamed'],
    watch: {
        /** v2.8.7c：弹窗开着时切换了文件（同一实例复用）—— 重建媒体并重新起播 */
        fileLink() {
            if (!this.visible) return;
            this.mediaMounted = true;
            this.mediaAutoStarted = false;
            this.$nextTick(() => {
                this.startDetailVideo();
                this.startDetailAudio();
            });
        },
        /** v3.0.0：同一实例换文件时，子状态一并回到初始（不再沿用上一个文件的展开态） */
        'file.name'(val, oldVal) {
            if (!this.visible || !val || val === oldVal) return;
            this.resetDetailState();
        },
        visible(val) {
            if (val) {
                /*
                 * v1.0.6：先把图片本身拉起来，再发那两个「探测类」请求。
                 * 详情页比灯箱慢的根本原因不在 URL（两边用的是同一个 getFileLink），
                 * 而在加载时序：弹窗一打开就并发 loadConvertOptions + loadMediaInfo，
                 * 同域并发被浏览器排队，真正要看的图反而排在后面。
                 * 这里先踢一脚图片（Image() 会命中浏览器缓存，随后 <el-image> 直接复用），
                 * 并让两个探测请求挪到图片之后，看图不再被接口挤占带宽。
                 */
                this.prefetchPreview();
                // v1.0.3：打开详情即确认「转本地 / 转异地」按钮该显示哪个（一次轻量查询）
                this.loadConvertOptions();
                // v1.0.5：探测能否原位编辑（裁剪 / 压缩 / 转WebP / 转码）
                this.loadMediaInfo();
            }
            if (!val) {
                // v3.0.0：关闭弹窗时退出编辑状态
                this.isEditing = false;
                this.editSaving = false;
                this.noteLoaded = false;
                this.noteVisible = false;
                this.noteText = '';
                this.expiryAt = 0;
                this.showQr = false;
                // v2.8.7c：关闭弹窗先暂停、再销毁媒体元素 —— 彻底结束视频 / 音频，
                // 不留后台元素等 canplay / 重渲染把它再拉起来
                this.pauseDetailMedia();
                // v3.0.0：关闭瞬间再兜底扫一遍（暂停 + 清 src），确保没有声音继续播放
                this.stopAllMedia();
                this.mediaMounted = false;
                return;
            }
            // v2.8.7c：打开时重建媒体元素并主动起播（元素是新的，canplay 一定会再次触发，
            // 修复「关闭后再打开同一个详情页视频不加载」）
            this.mediaMounted = true;
            this.mediaAutoStarted = false;
            this.$nextTick(() => {
                this.startDetailVideo();
                this.startDetailAudio();
            });
            // v3.0.0：每次打开都回到全新初始状态（已移除「打开记忆」）
            this.resetDetailState();
            // 打开时补拉一次元数据：限时截止时间 / 作者备注只在详情接口下发
            this.loadExtraMeta();
            // v3.0.0：「所属实例」需要实例名 + 序号，按需拉一次列表（失败不影响详情）
            this.loadInstances();
        }
    },
    data() {
        return {
            // v1.0.5：标题栏「刷新」是否进行中（按钮转圈 + 防重复点击）
            refreshing: false,
            /*
             * v1.0.5：原位媒体编辑。
             * mediaInfo 由后端 media/info 探测得出（是否本地主副本 / 图片还是视频 / 是否已是 WebP），
             * 前端不自己按扩展名猜 —— 猜错就会出现「点了按钮后端拒绝」的体验。
             */
            mediaInfo: null,
            mediaBusy: false,
            // 裁剪
            showCropDialog: false,
            cropFile: null,
            cropFileName: '',
            cropLoading: false,
            // 压缩
            showCompressDialog: false,
            // v1.0.6：默认比例改到 75%（原来 60%，大多数场景 75% 是画质与体积的平衡点）
            compressPercent: 75,
            /**
             * 压缩按钮三态（v1.0.6）：
             *   idle    → 显示「开始压缩」，可点
             *   running → 显示「正在压缩」，禁用
             *   done    → 显示「已完成」，禁用（弹窗稍后自动关闭，用户能看到结果）
             */
            compressState: 'idle',
            // 转 WebP
            showWebpDialog: false,
            webpMode: 'lossy',
            // 转码
            transcodeBusy: false,
            /** v1.0.6：「源」地址弹窗（展示 + 复制，替代原来的一点即复制） */
            showSourceDialog: false,
            // v3.0.0：文件级加密（状态来自详情接口的 metas.AccessPasswordHash）
            fileEncrypted: false,
            showPasswordDialog: false,
            passwordForm: { password: '' },
            passwordSaving: false,
            // v3.0.0：分享卡片弹窗
            showShareDialog: false,
            /*
             * v1.0.3：转存（本地 ↔ 第三方）——
             * direction 由后端按「当前主副本所在渠道类型」判定：
             *   to-remote = 当前在本地存储渠道，按钮显示「转异地」
             *   to-local  = 当前在第三方渠道，按钮显示「转本地」
             */
            showConvertDialog: false,
            convertLoading: false,
            convertDirection: 'to-remote',
            convertCurrentChannel: '',
            convertChannels: [],
            convertChannelId: '',
            // null = 还没选（转本地时必须二选一才能提交）
            convertDeleteSource: null,
            convertCanDeleteSource: true,
            // v3.0.0：「所属实例」行 —— GET /api/instances 的缓存（同一会话内只拉一次）
            instances: [],
            instancesLoaded: false,
            instancesLoading: false,
            // v2.8.7c：媒体元素挂载开关 —— 只在弹窗打开时渲染 video / audio，
            // 关闭即销毁（彻底停止播放、杜绝后台复活），重开重建保证重新加载
            mediaMounted: false,
            // v2.8.7c：每次打开只自动起播一次（canplay 会随缓冲多次触发，不设防会把
            // 用户手动暂停的视频再拉起来）
            mediaAutoStarted: false,
            activeTab: 'originUrl',
            // v3.0.0（R8）：评分（0-5，半星）/ 等级（0-5 爱心）—— 打开弹窗时从 metadata 回填
            ratingValue: 0,
            levelValue: 0,
            levelHover: 0,
            ratingSaving: false,
            isEditing: false,
            editForm: {
                FileName: '',
                FileType: '',
                Directory: ''
            },
            editSaving: false,
            // 编辑态「文件分类」下拉的可选目录（来自 /api/directoryTree）
            folderOptions: [],
            folderLoading: false,
            showRenameDialog: false,
            renameForm: {
                newFileId: ''
            },
            renameValidation: {
                valid: true,
                error: ''
            },
            renameSaving: false,
            // v2.8.9：「生成名称」请求中
            renameGenerating: false,
            // 二维码：直接替换「文件加载区域」里的文件（v2.3.0；v2.4.0 移除自定义长按菜单）
            showQr: false,
            // 重定向
            showRedirectDialog: false,
            redirectForm: { url: '' },
            redirectSaving: false,
            // 限时（v2.1.0）
            showExpiryDialog: false,
            expirySaving: false,
            expiryAt: 0,
            expiryForm: { mode: 'forever', amount: 24, unit: 'h', at: '' },
            // 备注（v2.1.0）：仅作者可见，noteVisible 由接口是否下发 Note 决定
            noteLoaded: false,
            noteVisible: false,
            noteText: '',
            noteSaving: false
        }
    },
    computed: {
        /** v1.0.5：媒体编辑按钮的显示总闸 —— 只有后端确认「可原位编辑」才整组出现 */
        mediaReady() {
            return !!(this.mediaInfo && (this.mediaInfo.canCrop || this.mediaInfo.canCompress || this.mediaInfo.canWebp || this.mediaInfo.canTranscode));
        },
        /** v1.0.5：按百分比估算压缩后体积（只做展示，实际以处理结果为准） */
        estimatedCompressSize() {
            const size = Number(this.mediaInfo?.size) || 0;
            if (!size) return '—';
            const bytes = Math.round((size * this.compressPercent) / 100);
            if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
            if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
            return `${bytes} B`;
        },
        /** v1.0.6：压缩按钮三态文案（开始压缩 / 正在压缩 / 已完成） */
        compressButtonText() {
            if (this.compressState === 'running') return this.$t('fileDetail.compressRunning');
            if (this.compressState === 'done') return this.$t('fileDetail.compressDone');
            return this.$t('fileDetail.compressConfirm');
        },
        /** v1.0.3：转存按钮文案 —— 当前在本地渠道就「转异地」，否则「转本地」 */
        convertDirectionLabel() {
            return this.convertDirection === 'to-local'
                ? this.$t('fileDetail.convertToLocal')
                : this.$t('fileDetail.convertToRemote');
        },
        /** v2.8.7：全局视频静音开关（文件管理右上角按钮；本弹窗被多页面共用，取不到 store 时默认静音） */
        videoMuted() {
            return this.$store ? this.$store.state.globalVideoMuted : true;
        },
        /** 二维码内容：优先用签发外链（原始链接），没有则退回当前文件链接 */
        qrValue() {
            return String(this.urls?.originUrl || this.fileLink || '').trim();
        },
        visible: {
            get() { return this.modelValue; },
            set(val) { this.$emit('update:modelValue', val); }
        },
        dialogWidth() {
            // v1.0.6：移动端由 95% 调到 96% —— 左右留白再收窄一点，内容区更宽（需求指定）
            return window.innerWidth < 768 ? '96%' : '900px';
        },
        /** 二维码渲染尺寸：v2.8.2 起固定 200x200 */
        qrSize() {
            return 200;
        },
        /**
         * 详情表列数：窄屏 1 列、宽屏 2 列。
         * 同时作为「重定向」整行占位的 span 值（让它单独占满一行）。
         */
        descColumn() {
            return window.innerWidth < 768 ? 1 : 2;
        },
        /** 是否管理员（管理员不受普通用户的编辑/删除开关约束） */
        isAdminRole() {
            return this.$store?.getters?.isAdminRole === true;
        },
        /** 可编辑：可改文件信息 / 加标签 / 重命名 / 设置重定向 */
        canEditAction() {
            /*
             * v3.0.0（R9）：别人共享给我的「只读」目录 → 不加载任何编辑类按钮
             * （标签 / 黑白名单 / 编辑 / 重命名 / 限时 / 加密 / 重定向），与批量口径一致。
             * v3.0.0（R12）：这条判定前置到管理员豁免之前 —— 只读是共享归属者设定的语义，
             * 任何接收方（含管理员账号）都不应绕过。
             */
            const f = this.file || {};
            if (f.shared && !f.sharedSelf && f.sharedPerm === 'readonly') return false;
            if (this.isAdminRole) return true;
            return this.$store?.getters?.canEdit !== false;
        },
        /**
         * v3.0.0（R12）：是否「别人共享给我且只读」。
         * 用真值判断而不是 canEditAction —— 管理员虽然不受普通开关约束，
         * 但共享目录的只读语义对任何接收方都成立，顶部动作行应整行不渲染。
         */
        readonlyShared() {
            const f = this.file || {};
            return !!(f.shared && !f.sharedSelf && f.sharedPerm === 'readonly');
        },
        /**
         * v3.0.0（R14）：评分 / 评级可编辑 ——
         * 作者本人或管理员（noteVisible，由详情接口是否下发 Note 决定），
         * 或「别人共享给我且权限为可编辑」的目录接收方（后端 canRate 同口径）。
         */
        canRate() {
            if (this.noteVisible) return true;
            const f = this.file || {};
            return !!(f.shared && !f.sharedSelf && f.sharedPerm === 'edit');
        },
        /** 可删除：v3.0.0（R9）别人共享给我的目录（只读或编辑）→ 一律不加载删除按钮 */
        canDeleteAction() {            const f = this.file || {};
            // v3.0.0（R12）：共享接收方（含管理员账号）一律看不到删除 —— 归属者内容不可被接收方删除
            if (f.shared && !f.sharedSelf) return false;
            if (this.isAdminRole) return true;
            return this.$store?.getters?.canDelete !== false;
        },
        /**
         * 详情里所有「加载值」的文本。
         * 用于「任一值超过 80 字符则整体字号自动降一号」的判断。
         */
        detailTextValues() {
            const m = this.file?.metadata || {};
            const tags = Array.isArray(m.Tags) ? m.Tags : [];
            const values = [
                m.FileName,
                m.FileType,
                m.FileExt,
                m.MD5,
                m.Channel,
                m.ChannelName,
                m.UploadAddress,
                m.UploadIP,
                m.IpDisplay,
                m.UploadUser,
                m.UploadSource,
                m.Directory,
                m.RedirectUrl,
                this.fileSizeDisplay,
                this.storageChannelUrl,
                ...this.backupChannelList.map((b) => `${b.label || ''}/${b.name || ''}`),
                ...tags,
                this.urls?.originUrl,
                this.urls?.mdUrl,
                this.urls?.htmlUrl,
                this.urls?.bbUrl,
                this.urls?.tgId,
                this.urls?.S3Location,
                this.urls?.S3CdnFileUrl,
                this.fileLink,
            ];
            return values.filter((v) => v !== undefined && v !== null && v !== '').map((v) => String(v));
        },
        /** 是否存在超长值（> 80 字符）—— 是则详情整体字号降一号 */
        hasLongValue() {
            return this.detailTextValues.some((v) => v.length > 80);
        },
        isVideo() {
            // 先通过 content-type 判断
            const fileType = this.file?.metadata?.FileType?.toLowerCase() || '';
            if (fileType.includes('video')) return true;
            // 再通过文件后缀判断
            const name = this.file?.name?.toLowerCase() || '';
            return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov') || name.endsWith('.avi');
        },
        isAudio() {
            // 先通过 content-type 判断
            const fileType = this.file?.metadata?.FileType?.toLowerCase() || '';
            if (fileType.includes('audio')) return true;
            // 再通过文件后缀判断
            const name = this.file?.name?.toLowerCase() || '';
            return name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.ogg') || name.endsWith('.flac');
        },
        /** 备份渠道列表（metadata.BackupChannels：[{id, label, name}]） */
        backupChannelList() {
            const list = this.file?.metadata?.BackupChannels;
            return Array.isArray(list) ? list : [];
        },
        /** 限时是否已过期 */
        expiryExpired() {
            return this.expiryAt > 0 && Date.now() > this.expiryAt;
        },
        /**
         * v3.0.0：分隔行上的有效期文案 —— 永久 / 「yyyy-MM-dd HH:mm 到期」/「已过期（…）」。
         * 「有效期」已从加载项里移除，只在这里出现一次。
         */
        expiryBarText() {
            if (!this.expiryAt) return this.$t('fileDetail.expiryNever');
            const d = new Date(this.expiryAt);
            const pad = (n) => String(n).padStart(2, '0');
            const text = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
            return this.expiryExpired
                ? `${this.$t('fileDetail.expiryExpired')}（${text}）`
                : this.$t('fileDetail.expiryDueFormat', { time: text });
        },
        /**
         * v3.0.0：当前文件所属实例 id。
         * 优先取文件数据自带的 instanceId（后端补字段后即生效）；
         * 缺失时退回「当前浏览实例」（localStorage gohub_instance_id，'' = 默认实例）。
         */
        currentInstanceId() {
            const m = this.file?.metadata || {};
            let raw = m.InstanceId;
            if (raw === undefined || raw === null) raw = m.instanceId;
            if (raw === undefined || raw === null) raw = this.file?.instanceId;
            if (raw !== undefined && raw !== null) return String(raw);
            try {
                return String(localStorage.getItem('gohub_instance_id') || '');
            } catch {
                return '';
            }
        },
        /** v3.0.0：「实例名（序号）」；空串显示「默认」 */
        instanceDisplay() {
            const id = this.currentInstanceId;
            if (!id) return this.$t('fileDetail.instanceDefault');
            const hit = (this.instances || []).find((it) => String(it?.id) === id);
            if (!hit) return id;
            const name = String(hit.name || id);
            const index = hit.index === undefined || hit.index === null ? '' : String(hit.index);
            return index ? this.$t('fileDetail.instanceNameWithIndex', { name, index }) : name;
        },
        /**
         * v3.0.0：「上传 IP」—— 值仍然是 IP，归属地文本保留在括号里。
         * 优先用结构化的 UploadIP / UploadAddress；缺失时从 IpDisplay 里把 IP 抠出来。
         */
        uploadIpText() {
            const m = this.file?.metadata || {};
            const raw = String(m.IpDisplay || '').trim();
            let ip = String(m.UploadIP || '').trim();
            const address = String(m.UploadAddress || '').trim();
            if (!ip && raw) {
                const hit = /(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,})/.exec(raw);
                if (hit) ip = hit[1];
            }
            if (!ip && !address) return raw || this.$t('fileDetail.unknown');
            if (!ip) return address;
            if (!address || address === ip) return ip;
            return `${ip}（${address}）`;
        },
        /** 文件类型展示值：MIME / 扩展名，如 image/jpeg / jpeg */
        fileTypeDisplay() {
            const type = this.file?.metadata?.FileType;
            const ext = this.file?.metadata?.FileExt;
            if (type && ext) return `${type} / ${ext}`;
            return type || ext || this.$t('fileDetail.unknown');
        },
        /** 当前文件主渠道（存储渠道）的真实直链 —— 无法构造时回退本站代理地址 */
        storageChannelUrl() {
            const direct = this.file?.metadata?.StorageUrl;
            if (direct) return String(direct);
            /*
             * v3.0.0（R15）：只有「本地存储」渠道的对外地址就是本站外链。
             * 其它渠道（尤其 immich：serverUrl 常是内网 / 容器名）拿不到公开访问域名时
             * 一律不回退本站地址 —— 本站本身也常是内网 IP，
             * 否则就会出现「存储渠道显示内网域名」的问题。
             */
            return this.channelFileUrl(
                this.file?.metadata?.ChannelId,
                '',
                this.file?.metadata?.ChannelType,
            );
        },
        isImage() {
            // 先通过 content-type 判断
            const fileType = this.file?.metadata?.FileType?.toLowerCase() || '';
            if (fileType.includes('image')) return true;
            // 再通过文件后缀判断
            const name = this.file?.name?.toLowerCase() || '';
            return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || 
                   name.endsWith('.gif') || name.endsWith('.webp') || name.endsWith('.svg') || 
                   name.endsWith('.bmp') || name.endsWith('.avif') || name.endsWith('.heic') || name.endsWith('.heif');
        },
        uploadTime() {
            if (this.file?.metadata?.TimeStamp) {
                return new Date(this.file.metadata.TimeStamp).toLocaleString();
            }
            return this.$t('fileDetail.unknown');
        },
        accessType() {
            // 回收站里的文件（软删除）优先显示「已删除」
            if (this.file?.status === 'deleted' || this.file?.metadata?.Status === 'deleted') {
                return this.$t('fileDetail.accessDeleted');
            }
            const listType = this.file?.metadata?.ListType;
            const label = this.file?.metadata?.Label;
            if (listType === 'White') return this.$t('fileDetail.accessNormalWhitelist');
            if (listType === 'Block') return this.$t('fileDetail.accessBlockedBlacklist');
            if (label === 'adult') return this.$t('fileDetail.accessBlockedReview');
            return this.$t('fileDetail.accessNormal');
        },
        /** v2.6.0 #303：黑白名单 toggle 状态（决定按钮文案与颜色） */
        isBlocked() {
            return this.file?.metadata?.ListType === 'Block';
        },
        isWhitelisted() {
            return this.file?.metadata?.ListType === 'White';
        },
        /** 上传时长：毫秒 → 「x.x 秒 / m 分 s 秒」；无记录时显示「未知」 */
        uploadDurationText() {
            const ms = Number(this.file?.metadata?.UploadDurationMs) || 0;
            if (!ms) return this.$t('fileDetail.unknown');
            if (ms < 1000) return `${ms} ms`;
            const sec = ms / 1000;
            if (sec < 60) return `${sec.toFixed(1)} s`;
            const m = Math.floor(sec / 60);
            const s = Math.round(sec % 60);
            return `${m} min ${s} s`;
        },
        /** 上传速度：MB/s（后端按「文件体积 ÷ 时长」算好下发） */
        uploadSpeedText() {
            const speed = Number(this.file?.metadata?.UploadSpeedMBps) || 0;
            const ms = Number(this.file?.metadata?.UploadDurationMs) || 0;
            // 有明确时长但速度被四舍五入成 0（小文件）→ 显示「< 0.01」，别误报为未知
            if (!speed) {
                if (ms > 0) return '< 0.01 MB/s';
                return this.$t('fileDetail.unknown');
            }
            return `${speed.toFixed(2)} MB/s`;
        },
        accessTagType() {
            if (this.file?.status === 'deleted' || this.file?.metadata?.Status === 'deleted') return 'info';
            const listType = this.file?.metadata?.ListType;
            const label = this.file?.metadata?.Label;
            if (listType === 'White') return 'success';
            if (listType === 'Block') return 'danger';
            if (label === 'adult') return 'danger';
            return 'success';
        },
        /**
         * v3.0.0：把 metas.ProcessEvent 拆成「失败 → 重试 → WebP → 压缩 → 转码」分组，
         * 每组内是「label + value」信息行。整组无数据时隐藏，旧记录字段缺失也能兼容。
         */
        processGroups() {
            const ev = this.file?.metadata?.ProcessEvent;
            if (!ev || typeof ev !== 'object') return [];
            const t = (k, p) => this.$t(k, p);
            const groups = [];
            const yesNo = (v) => (v ? t('fileDetail.processYes') : t('fileDetail.processNo'));
            /**
             * 压缩的 reason 是后端下发的语义值，必须翻译成可读文案，不能直接渲染英文代码：
             *   off       = 未开启压缩功能
             *   webp      = 已走 WebP 转换因此跳过压缩
             *   threshold = 未达压缩阈值 / 判定不值得压缩
             *   ''        = 正常压缩（已压缩）
             */
            const compressReasonText = (reason) => {
                const r = String(reason || '').trim();
                if (r === 'off') return t('fileDetail.processCompressOff');
                if (r === 'webp') return t('fileDetail.processCompressSkipWebp');
                if (r === 'threshold') return t('fileDetail.processCompressSkipThreshold');
                // v3.0.0（R8）：音频 / 视频走后置队列，跳过原因见 detail 行
                if (r === 'media') return t('fileDetail.processCompressSkipMedia');
                return r; // 旧记录里可能是自由文本，原样展示
            };
            /** 压缩组的「是否触发」：区分未开启 / 因 WebP 跳过 / 未达阈值 / 后置队列放弃 / 已压缩 */
            const compressTriggerText = (c) => {
                const r = String(c.reason || '').trim();
                if (r === 'off') return t('fileDetail.processCompressOff');
                if (r === 'webp') return t('fileDetail.processCompressSkipWebp');
                if (r === 'threshold') return t('fileDetail.processCompressSkipThreshold');
                if (r === 'media') return t('fileDetail.processCompressSkipMedia');
                if (c.enabled === false) return t('fileDetail.processCompressOff');
                if (c.status === 'done' || c.status === 'failed') return t('fileDetail.processCompressTriggered');
                if (c.status === 'skipped') return t('fileDetail.processCompressSkippedGeneric');
                return t('fileDetail.processNotExecuted');
            };
            /**
             * done / skipped / failed → 「完成 / 放弃 / 失败（原因）」。
             * mapReason=true 时把 reason 里的语义 code 翻译成可读文案（压缩组用）。
             */
            const resultText = (obj, mapReason = false) => {
                if (!obj || !obj.status) return t('fileDetail.processNotExecuted');
                const base = obj.status === 'done'
                    ? t('fileDetail.processResultDone')
                    : obj.status === 'failed'
                        ? t('fileDetail.processResultFailed')
                        : t('fileDetail.processResultSkipped');
                const raw = String(obj.reason || '').trim();
                const reason = mapReason ? compressReasonText(raw) : raw;
                return reason && obj.status !== 'done' ? `${base}（${reason}）` : base;
            };
            /** 毫秒 → 「x.x 秒」 */
            const seconds = (ms) => {
                const n = Number(ms);
                if (!Number.isFinite(n) || n <= 0) return '-';
                return `${(n / 1000).toFixed(1)} ${t('fileDetail.processSecondUnit')}`;
            };
            const sizeText = (bytes) => {
                const n = Number(bytes) || 0;
                return n > 0 ? this.formatBytes(n) : '-';
            };

            // ① 失败（次数 / 原因）
            const failRows = [];
            const failCount = Number(ev.failCount) || 0;
            if (failCount > 0) {
                failRows.push({ label: t('fileDetail.processFailCount'), value: t('fileDetail.processTimesUnit', { n: failCount }) });
            }
            if (ev.failReason) {
                failRows.push({ label: t('fileDetail.processFailReasonLabel'), value: String(ev.failReason) });
            }
            if (failRows.length) groups.push({ key: 'fail', title: t('fileDetail.processGroupFail'), rows: failRows });

            // ② 重试（次数 / 自动切换渠道）
            const retryRows = [];
            const retries = Number(ev.retries) || 0;
            if (retries > 0) {
                retryRows.push({ label: t('fileDetail.processRetryCount'), value: t('fileDetail.processTimesUnit', { n: retries }) });
            }
            if (ev.switchedTo) {
                retryRows.push({ label: t('fileDetail.processSwitchedTo'), value: String(ev.switchedTo) });
            }
            if (retryRows.length) groups.push({ key: 'retry', title: t('fileDetail.processGroupRetry'), rows: retryRows });

            // ③ WebP（是否启用 / 无损或有损 / 结果 / 转换后大小）
            if (ev.webp && typeof ev.webp === 'object') {
                const w = ev.webp;
                groups.push({
                    key: 'webp',
                    title: t('fileDetail.processGroupWebp'),
                    rows: [
                        { label: t('fileDetail.processEnabled'), value: yesNo(w.enabled) },
                        {
                            label: t('fileDetail.processWebpMode'),
                            value: w.mode === 'lossless'
                                ? t('fileDetail.processWebpLossless')
                                : w.mode === 'lossy'
                                    ? t('fileDetail.processWebpLossy')
                                    : '-',
                        },
                        { label: t('fileDetail.processResult'), value: resultText(w) },
                        { label: t('fileDetail.processConvertedSize'), value: sizeText(w.size) },
                    ],
                });
            }

            // ④ 压缩（是否触发 / 时长 / 结果 / 压缩后大小）
            if (ev.compress && typeof ev.compress === 'object') {
                const c = ev.compress;
                groups.push({
                    key: 'compress',
                    title: t('fileDetail.processGroupCompress'),
                    rows: [
                        { label: t('fileDetail.processTriggered'), value: compressTriggerText(c) },
                        { label: t('fileDetail.processDuration'), value: c.status === 'done' ? seconds(c.ms) : t('fileDetail.processNotExecuted') },
                        {
                            label: t('fileDetail.processResult'),
                            // v3.0.0：没有执行结果时明确写「未执行压缩功能」，与「是否触发」区分开
                            value: c.status ? resultText(c, true) : t('fileDetail.sourceResultNotExecuted'),
                        },
                        { label: t('fileDetail.processCompressedSize'), value: sizeText(c.size) },
                        // v3.0.0（R8）：音频/视频后置处理放弃压缩的具体原因（未装 ffmpeg / 超时 / 资源不足…）
                        ...(c.detail ? [{ label: t('fileDetail.processSkipDetail'), value: String(c.detail) }] : []),
                    ],
                });
            }

            // ⑤ 转码（仅视频；启用 / 时长 / 结果）
            if (ev.transcode && typeof ev.transcode === 'object' && (this.isVideo || ev.transcode.enabled)) {
                const tr = ev.transcode;
                groups.push({
                    key: 'transcode',
                    title: t('fileDetail.processGroupTranscode'),
                    rows: [
                        { label: t('fileDetail.processEnabled'), value: yesNo(tr.enabled) },
                        { label: t('fileDetail.processDuration'), value: tr.status === 'done' ? seconds(tr.ms) : t('fileDetail.processNotExecuted') },
                        { label: t('fileDetail.processResult'), value: resultText(tr) },
                    ],
                });
            } else if (this.isVideo && groups.length) {
                // 视频但没有转码记录：明确告知未执行
                groups.push({
                    key: 'transcode',
                    title: t('fileDetail.processGroupTranscode'),
                    rows: [{ label: t('fileDetail.processResult'), value: t('fileDetail.processNotExecuted') }],
                });
            }

            return groups;
        },
        /** v3.0.0：仅移动端把截止时间面板改成居中弹层（桌面端保持现状） */
        expiryPickerPopperClass() {
            return window.innerWidth < 768 ? 'expiry-date-popper expiry-date-popper--center' : '';
        },
        /**
         * v3.0.0（R10）：签发链接背后的「源地址」——「文件加载域名 + 固化地址」。
         *
         * 与 StorageUrl（公开访问域名，给外部分享用）刻意区分：
         *   · 代理模式下后端从「内网通信域名」取流，这里展示的正是那条真实取流地址；
         *   · 便于排查「外链打不开到底是域名问题还是存储问题」。
         */
        storageSourceUrl() {
            const meta = this.file?.metadata || {};
            /*
             * v1.0.5：主副本在本地存储渠道时，「源」直接给磁盘上的物理地址
             * （绝对路径 + 真实落盘文件名），而不是本站签发的外链 ——
             * 排查「文件到底存在哪儿」时这才是有效信息。
             * 非本地渠道没有 LocalPath，继续沿用加载地址 / 存储直链。
             */
            if (meta.LocalPath) return String(meta.LocalPath);
            /*
             * 本地存储渠道没有「渠道直链」（后端 buildDirectUrl 返回 null），
             * 它的「源」就是本站签发地址本身（外链访问域名 + /file/...），
             * 因此最后回退 fileLink，保证本地文件的「源」按钮同样可用。
             */
            return String(meta.LoadUrl || meta.StorageUrl || this.fileLink || '');
        },
        /** v1.0.5：当前「源」是不是本地磁盘路径（决定按钮文案与图标） */
        sourceIsLocalPath() {
            return !!(this.file?.metadata || {}).LocalPath;
        },
        imageDimensions() {
            const width = this.file?.metadata?.Width;
            const height = this.file?.metadata?.Height;
            if (width && height) return true;
            return null;
        },
        orientationIcon() {
            const width = this.file?.metadata?.Width;
            const height = this.file?.metadata?.Height;
            if (!width || !height) return '';
            const ratio = width / height;
            if (ratio > 1.1) return this.$t('fileDetail.orientationLandscape');
            if (ratio < 0.9) return this.$t('fileDetail.orientationPortrait');
            return this.$t('fileDetail.orientationSquare');
        },
        /**
         * 文件大小：`初始大小 / 当前大小`（如 `1016.00 KB / 56.11 KB`）。
         * 未被压缩（两者相同）或没有初始大小时，只展示当前大小。
         */
        fileSizeDisplay() {
            const sizeBytes = Number(this.file?.metadata?.FileSizeBytes) || 0;
            const originalBytes = Number(this.file?.metadata?.FileSizeOriginalBytes) || sizeBytes;
            if (sizeBytes > 0) {
                const current = this.formatBytes(sizeBytes);
                if (originalBytes > 0 && originalBytes !== sizeBytes) {
                    return `${this.formatBytes(originalBytes)} / ${current}`;
                }
                return current;
            }
            const sizeText = this.file?.metadata?.FileSize;
            return sizeText || this.$t('fileDetail.unknown');
        },
        /**
         * 文件大小的悬停提示（v2.3.0）：
         * 「原文件大小：X / 压缩后大小：Y」—— 未压缩时两个值相同，明确告知而不是留空。
         */
        fileSizeTooltip() {
            const sizeBytes = Number(this.file?.metadata?.FileSizeBytes) || 0;
            const originalBytes = Number(this.file?.metadata?.FileSizeOriginalBytes) || sizeBytes;
            if (!sizeBytes) return '';
            const original = this.formatBytes(originalBytes);
            const current = this.formatBytes(sizeBytes);
            const compressed = originalBytes > sizeBytes;
            return [
                `${this.$t('fileDetail.originalSize')}：${original}`,
                `${compressed ? this.$t('fileDetail.compressedSize') : this.$t('fileDetail.currentSize')}：${current}`,
            ].join('\n');
        }
    },
    methods: {
        /**
         * v1.0.3：读取转存候选（当前渠道类型 + 可选目标渠道）。
         * 失败时静默隐藏按钮（详情页其它功能不受影响）。
         */
        async loadConvertOptions() {
            const key = String(this.file?.name || '');
            if (!key || this.trashMode) {
                this.convertChannels = [];
                return;
            }
            try {
                const resp = await fetchWithAuth(`/api/manage/convert/options/${encodeURIComponent(key)}`);
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || data?.success === false) {
                    this.convertChannels = [];
                    return;
                }
                this.convertDirection = data.direction === 'to-local' ? 'to-local' : 'to-remote';
                this.convertCurrentChannel = data.currentChannel?.name
                    ? `${data.currentChannel.name}（${data.currentChannel.type}）`
                    : '—';
                this.convertChannels = Array.isArray(data.channels) ? data.channels : [];
                this.convertCanDeleteSource = data.canDeleteSource !== false;
            } catch (e) {
                this.convertChannels = [];
            }
        },
        /** 打开转存弹窗：每次重新拉一次候选，避免渠道刚增删过导致选到停用渠道 */
        async openConvertDialog() {
            if (this.convertLoading) return;
            await this.loadConvertOptions();
            if (!this.convertChannels.length) {
                ElMessage.warning(this.$t('fileDetail.convertNoChannel'));
                return;
            }
            this.convertChannelId = '';
            this.convertDeleteSource = null;
            this.showConvertDialog = true;
        },
        /** 执行转存 */
        async submitConvert() {
            const key = String(this.file?.name || '');
            if (!key || !this.convertChannelId) return;
            /*
             * 转本地必须明确「保留源件 / 删除源件」（默认留空，不预选），
             * 避免误点导致源文件被删。
             */
            if (this.convertDirection === 'to-local' && this.convertDeleteSource === null) {
                ElMessage.warning(this.$t('fileDetail.convertSourceRequired'));
                return;
            }
            this.convertLoading = true;
            try {
                const resp = await fetchWithAuth('/api/manage/convert', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: key,
                        channelId: this.convertChannelId,
                        deleteSource: this.convertDeleteSource === true
                    })
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || data?.success === false) {
                    throw new Error(data?.message || this.$t('fileDetail.convertFailed'));
                }
                this.showConvertDialog = false;
                ElMessage.success(this.$t('fileDetail.convertSuccess', { channel: data.channelName || '' }));
                // 让父级刷新列表行（渠道列 / 渠道类型都会变）
                this.$emit('metadataUpdated');
            } catch (e) {
                ElMessage.error(e?.message || this.$t('fileDetail.convertFailed'));
            } finally {
                this.convertLoading = false;
            }
        },

        /**
         * 上传渠道展示名（v2.8.6）：
         *   Default = 历史网页上传 ｜ Upload = 文件模式 ｜ Fetch = 链接模式转存
         *   WebDAV / API-Web / API-S3 = 对外通道
         * 未知值原样返回，避免历史数据被吞掉。
         */
        /** v2.8.9：处理耗时格式化 —— 小于 1 秒用 ms，其余用 s（保留一位小数） */
        formatProcessMs(ms) {
            const n = Number(ms);
            if (!Number.isFinite(n) || n <= 0) return '-';
            return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`;
        },
        /* ---------------- v3.0.0：详情弹窗初始状态 ---------------- */
        /** 详情弹窗的滚动容器（.el-dialog__body） */
        detailBodyEl() {
            const root = this.$refs.detailDialog?.$el;
            /*
             * v3.0.0（R19）修复：el-dialog 走 teleport 时 $el 可能是注释占位节点，
             * 注释节点没有 querySelector → 每次打开详情都抛
             * 「xx.querySelector is not a function」，滚动复位随之失效。
             * 这里先确认是元素节点，取不到时再从当前可见弹窗兜底。
             */
            const body = root && root.nodeType === 1 ? root.querySelector('.el-dialog__body') : null;
            return body || document.querySelector('.el-dialog .el-dialog__body');
        },
        /**
         * v3.0.0：移除「打开记忆」—— 每次打开详情都回到全新的初始状态
         * （二维码收起 / 标签页回到「原始链接」/ 滚动回顶部），
         * 既不读取也不写入 sessionStorage，避免复用旧文件的展开状态造成困惑。
         */
        resetDetailState() {
            this.showQr = false;
            this.activeTab = 'originUrl';
            this.showShareDialog = false;
            // v1.0.5：媒体编辑的弹窗与探测结果一并回到初始（换了文件就不该沿用上一个文件的能力）
            this.mediaInfo = null;
            this.mediaBusy = false;
            this.showCropDialog = false;
            this.cropFile = null;
            this.showCompressDialog = false;
            this.compressState = 'idle';
            this.showWebpDialog = false;
            this.transcodeBusy = false;
            this.showSourceDialog = false;
            // v3.0.0（R8）：评分 / 等级回到当前文件的库值
            this.ratingValue = Number(this.file?.metadata?.Rating) || 0;
            this.levelValue = Number(this.file?.metadata?.Level) || 0;
            this.levelHover = 0;
            this.$nextTick(() => {
                this.$nextTick(() => {
                    const el = this.detailBodyEl();
                    if (el) el.scrollTop = 0;
                });
            });
        },
        /* ---------------- v3.0.0（R8）：评分 / 等级 ---------------- */
        /**
         * v3.0.0（R14）：声音开关（视频 / 音频共用）——
         * 切换 store 的 globalVideoMuted，视频与音频的 muted 都跟随该状态；
         * 切换后立即同步当前正在播放的媒体元素，不必关闭重开详情。
         */
        toggleMediaSound() {
            const next = !this.videoMuted;
            this.$store?.commit?.('setGlobalVideoMuted', next);
            const v = this.$refs.detailVideo;
            if (v) v.muted = next;
            const a = this.$refs.detailAudio;
            if (a) a.muted = next;
        },
        /** 点第 i 颗心：再点同一个取消（0 = 未设等级），立即存库 */
        setLevel(i) {
            this.levelValue = this.levelValue === i ? 0 : i;
            this.saveRatingLevel();
        },
        /** 评分（el-rate 半星）/ 等级（爱心）变化 → PATCH metadata 直接存库 */
        async saveRatingLevel() {
            const name = this.file?.name;
            if (!name) return;
            this.ratingSaving = true;
            try {
                const res = await fetchWithAuth(`/api/manage/metadata/${encodeURIComponent(name)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ Rating: Number(this.ratingValue) || 0, Level: Number(this.levelValue) || 0 })
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || json.success === false) throw new Error(json.message || this.$t('fileDetail.metadataSaveFailed'));
                if (json?.data?.metadata) {
                    if (this.file) this.file.metadata = { ...this.file.metadata, ...(json.data.metadata.Rating !== undefined ? { Rating: json.data.metadata.Rating, Level: json.data.metadata.Level } : {}) };
                }
                this.$emit('metadataUpdated', name, { Rating: Number(this.ratingValue) || 0, Level: Number(this.levelValue) || 0 });
                ElMessage.success(this.$t('fileDetail.ratingSaved'));
            } catch (err) {
                ElMessage.error(err.message || this.$t('fileDetail.metadataSaveFailed'));
            } finally {
                this.ratingSaving = false;
            }
        },
        /* ---------------- v3.0.0：文件级加密 ---------------- */
        openPasswordDialog() {
            this.passwordForm.password = '';
            this.showPasswordDialog = true;
        },
        /** clear=true → 清除密码；否则设置 / 修改 */
        async submitPassword(clear = false) {
            const name = this.file?.name;
            if (!name) return;
            const password = clear ? '' : String(this.passwordForm.password || '').trim();
            if (!clear && !password) {
                ElMessage.warning(this.$t('fileDetail.encryptRequired'));
                return;
            }
            this.passwordSaving = true;
            try {
                const res = await fetchWithAuth(`/api/manage/${encodeURIComponent(name)}/password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password }),
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || json.success === false) throw new Error(json.message || this.$t('fileDetail.encryptFailed'));
                this.fileEncrypted = !!password;
                if (this.file?.metadata) this.file.metadata.Encrypted = this.fileEncrypted;
                this.passwordForm.password = '';
                this.showPasswordDialog = false;
                ElMessage.success(password ? this.$t('fileDetail.encryptSaved') : this.$t('fileDetail.encryptCleared'));
            } catch (err) {
                ElMessage.error(err.message || this.$t('fileDetail.encryptFailed'));
            } finally {
                this.passwordSaving = false;
            }
        },
        /** v3.0.0：打开分享卡片弹窗 */
        openShareDialog() {
            this.showShareDialog = true;
        },
        /**
         * v3.0.0：「所属实例」—— GET /api/instances 返回数组，每项含 id / name / index（1-based 序号）。
         * 同一会话内只需拉一次；失败时静默降级（仍显示实例 id 或「默认」）。
         */
        async loadInstances() {
            if (this.instancesLoaded || this.instancesLoading) return;
            this.instancesLoading = true;
            try {
                const res = await fetchWithAuth('/api/instances', { method: 'GET' });
                const json = await res.json().catch(() => []);
                const list = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
                this.instances = list;
                this.instancesLoaded = true;
            } catch {
                this.instances = [];
            } finally {
                this.instancesLoading = false;
            }
        },
        uploadSourceLabel(raw) {
            const key = String(raw || 'Default');
            const map = {
                Default: 'filter.uploadSourceDefault',
                Upload: 'filter.uploadSourceUpload',
                Fetch: 'filter.uploadSourceFetch',
                WebDAV: 'filter.uploadSourceWebdav',
                'API-Web': 'filter.uploadSourceApiWeb',
                'API-S3': 'filter.uploadSourceApiS3',
                // v2.8.9：登记文件（只登记外链、不搬文件）
                Record: 'filter.uploadSourceRecord'
            };
            return map[key] ? this.$t(map[key]) : key;
        },
        /**
         * 补拉详情接口：拿到「限时截止时间」与「作者备注」。
         * 列表接口为了性能与隐私不下发这两项，所以每次打开弹窗按需取一次。
         */
        /**
         * v1.0.5：标题栏「刷新」—— 不关闭弹窗，重新拉当前文件的元数据。
         *
         * 只做三件事：
         *   1) 重新取 /api/manage/metadata/:name，把整份 metadata 回抛给父级
         *      （父级 handleMetadataUpdated 会同时更新列表行与本弹窗的 file prop）；
         *   2) 重新拉备注 / 限时 / 加密状态与「转存」候选；
         *   3) 媒体元素重新起播（和切换文件时同一套逻辑，避免旧的 src 缓存）。
         * 编辑态不打断：正在编辑时不刷新，防止把未保存的输入冲掉。
         */
        async reloadDetail(silent = false) {
            if (this.refreshing) return;
            const name = this.file?.name;
            if (!name) return;
            this.refreshing = true;
            try {
                const res = await fetchWithAuth(`/api/manage/metadata/${encodeURIComponent(name)}`);
                const json = await res.json().catch(() => ({}));
                const data = json?.data || {};
                const metadata = data?.metadata || {};
                if (metadata && Object.keys(metadata).length) {
                    this.$emit('metadataUpdated', name, metadata);
                }
                await this.loadExtraMeta();
                await this.loadConvertOptions();
                // v1.0.5：媒体能力可能变了（例如刚转成 WebP 就不能再转 WebP）
                await this.loadMediaInfo();
                this.mediaAutoStarted = false;
                this.$nextTick(() => {
                    this.startDetailVideo();
                    this.startDetailAudio();
                });
                // silent：调用方自己已经弹过「处理完成」，不再重复提示「已刷新」
                if (!silent) ElMessage.success(this.$t('fileDetail.refreshed'));
            } catch {
                if (!silent) ElMessage.warning(this.$t('fileDetail.refreshFailed'));
            } finally {
                this.refreshing = false;
            }
        },

        /* ==================================================================
         * v1.0.5：原位媒体编辑（裁剪 / 压缩 / 转WebP / 转码）
         *
         * 共同前提：后端 media/info 判定「主副本在本地存储渠道」。
         * 处理成功后文件路径 / 文件名 / 扩展名都不变，因此外链全部继续有效；
         * 这里只需要刷新一次详情，把新的体积 / 宽高 / MD5 显示出来。
         * ================================================================== */

        /**
         * v1.0.6：打开详情时立刻预取预览资源。
         *
         * 灯箱之所以「一滑就有」，是因为列表页早就把同一地址的图缓存住了；
         * 详情页每次都是冷启动，还要和两个探测接口抢同一批连接。
         * 这里在弹窗动画期间就用 Image() 起一次请求，等 <el-image> 渲染时直接读缓存。
         * 视频同理 —— 只预取元数据，别把整段视频拉下来。
         */
        prefetchPreview() {
            const url = String(this.fileLink || '');
            if (!url) return;
            try {
                if (this.isImage) {
                    const img = new Image();
                    img.decoding = 'async';
                    img.src = url;
                } else if (this.isVideo) {
                    const v = document.createElement('video');
                    v.preload = 'metadata';
                    v.src = url;
                }
            } catch (e) {
                /* 预取失败无所谓，正常渲染路径照旧 */
            }
        },
        async loadMediaInfo() {
            this.mediaInfo = null;
            const key = String(this.file?.name || '');
            if (!key || this.trashMode || this.readonlyShared) return;
            try {
                const res = await fetchWithAuth(`/api/manage/media/info/${encodeURIComponent(key)}`);
                const json = await res.json().catch(() => ({}));
                this.mediaInfo = json?.success ? json.data : null;
            } catch {
                this.mediaInfo = null;
            }
        },

        /** 裁剪：先把当前图片取回本地，交给裁剪组件（组件内含旋转方向与自由框选） */
        async openMediaCrop() {
            const key = String(this.file?.name || '');
            if (!key || this.cropLoading) return;
            this.cropLoading = true;
            try {
                const url = this.urls?.originUrl || this.fileLink;
                if (!url) throw new Error('no-url');
                // 注意：这里不能走 fetchWithAuth —— 它会补 /api 前缀，把图片地址改坏
                const res = await fetch(url, { credentials: 'include' });
                if (!res.ok) throw new Error(`http-${res.status}`);
                const blob = await res.blob();
                const ext = String(this.mediaInfo?.ext || 'png').toLowerCase();
                const mime = blob.type || (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);
                this.cropFileName = `${key}.${ext}`;
                this.cropFile = new File([blob], this.cropFileName, { type: mime, lastModified: Date.now() });
                this.showCropDialog = true;
            } catch {
                ElMessage.error(this.$t('fileDetail.mediaCropLoadFailed'));
            } finally {
                this.cropLoading = false;
            }
        },

        /** 裁剪组件回调：把结果图以 multipart 传回，服务端按原扩展名重新编码并原位落盘 */
        async onMediaCropped(file) {
            this.showCropDialog = false;
            this.cropFile = null;
            const key = String(this.file?.name || '');
            if (!key || !file) return;
            this.mediaBusy = true;
            ElMessage.info(this.$t('fileDetail.mediaProcessing'));
            try {
                const fd = new FormData();
                fd.append('id', key);
                fd.append('file', file, file.name);
                const res = await fetchWithAuth('/api/manage/media/crop', { method: 'POST', body: fd, headers: {} });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || json?.success === false) throw new Error(json?.message || this.$t('fileDetail.mediaCropFailed'));
                ElMessage.success(this.$t('fileDetail.mediaCropDone'));
                await this.reloadDetail(true);
            } catch (e) {
                ElMessage.error(e?.message || this.$t('fileDetail.mediaCropFailed'));
            } finally {
                this.mediaBusy = false;
            }
        },

        openCompressDialog() {
            this.compressPercent = 75;
            this.compressState = 'idle';
            this.showCompressDialog = true;
        },

        /**
         * 压缩。已压缩过的文件后端会回 needConfirm，这里弹二次确认后带 confirm=1 重试。
         * 视频 / 音频可能跑很久，因此处理期间整组按钮禁用（mediaBusy）。
         *
         * v1.0.6：按钮改成三态（idle → running → done）。
         * 完成后不立刻关弹窗，先让按钮停在「已完成」，用户能看清这次操作确实结束了；
         * 900ms 后再关闭并刷新详情 —— 直接关掉会让人怀疑「到底压没压」。
         */
        async doCompress(confirmed) {
            const key = String(this.file?.name || '');
            if (!key || this.mediaBusy) return;
            this.mediaBusy = true;
            this.compressState = 'running';
            try {
                const res = await fetchWithAuth('/api/manage/media/compress', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: key, percent: this.compressPercent, confirm: confirmed ? 1 : 0 }),
                });
                const json = await res.json().catch(() => ({}));
                if (json?.needConfirm) {
                    this.mediaBusy = false;
                    this.compressState = 'idle';
                    try {
                        await ElMessageBox.confirm(json.message, this.$t('fileDetail.compressAgainTitle'), {
                            confirmButtonText: this.$t('common.confirm'),
                            cancelButtonText: this.$t('common.cancel'),
                            type: 'warning',
                        });
                    } catch {
                        return; // 用户取消
                    }
                    return this.doCompress(true);
                }
                if (!res.ok || json?.success === false) throw new Error(json?.message || this.$t('fileDetail.mediaCompressFailed'));
                this.compressState = 'done';
                ElMessage.success(this.$t('fileDetail.mediaCompressDone'));
                await this.reloadDetail(true);
                setTimeout(() => {
                    this.showCompressDialog = false;
                    this.compressState = 'idle';
                }, 900);
            } catch (e) {
                this.compressState = 'idle';
                ElMessage.error(e?.message || this.$t('fileDetail.mediaCompressFailed'));
            } finally {
                this.mediaBusy = false;
            }
        },

        openWebpDialog() {
            this.webpMode = 'lossy';
            this.showWebpDialog = true;
        },

        async doWebp() {
            const key = String(this.file?.name || '');
            if (!key || this.mediaBusy) return;
            this.mediaBusy = true;
            try {
                const res = await fetchWithAuth('/api/manage/media/webp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: key, mode: this.webpMode }),
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || json?.success === false) throw new Error(json?.message || this.$t('fileDetail.mediaWebpFailed'));
                this.showWebpDialog = false;
                ElMessage.success(this.$t('fileDetail.mediaWebpDone'));
                await this.reloadDetail(true);
            } catch (e) {
                ElMessage.error(e?.message || this.$t('fileDetail.mediaWebpFailed'));
            } finally {
                this.mediaBusy = false;
            }
        },

        /** 转码：先确认（耗时可能很长），后端会先探测编码，已是浏览器可播的直接拒绝 */
        async doTranscode() {
            const key = String(this.file?.name || '');
            if (!key || this.transcodeBusy) return;
            /*
             * v1.0.6：把当前视频的编码直接写进确认框。
             * 之前只有一句「会重编码为 H.264」，用户看不到源编码 —— H.265 / ProRes 该转，
             * H.264 转了纯属白折腾，得让他先看见再决定。
             */
            const codecLabel = String(this.mediaInfo?.videoCodecLabel || this.mediaInfo?.videoCodec || '');
            const hasCodec = !!codecLabel;
            try {
                await ElMessageBox.confirm(
                    hasCodec
                        ? this.$t('fileDetail.transcodeConfirmTextCodec', { codec: codecLabel })
                        : this.$t('fileDetail.transcodeConfirmText'),
                    this.$t('fileDetail.transcodeConfirmTitle'),
                    {
                        confirmButtonText: this.$t('common.confirm'),
                        cancelButtonText: this.$t('common.cancel'),
                        type: 'warning',
                        dangerouslyUseHTMLString: hasCodec,
                    },
                );
            } catch {
                return;
            }
            this.transcodeBusy = true;
            try {
                const res = await fetchWithAuth('/api/manage/media/transcode', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: key }),
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || json?.success === false) throw new Error(json?.message || this.$t('fileDetail.mediaTranscodeFailed'));
                ElMessage.success(this.$t('fileDetail.mediaTranscodeDone'));
                await this.reloadDetail(true);
            } catch (e) {
                ElMessage.error(e?.message || this.$t('fileDetail.mediaTranscodeFailed'));
            } finally {
                this.transcodeBusy = false;
            }
        },

        async loadExtraMeta() {
            this.noteLoaded = false;
            this.noteVisible = false;
            this.noteText = '';
            this.expiryAt = 0;
            this.fileEncrypted = false;
            const name = this.file?.name;
            if (!name) {
                this.noteLoaded = true;
                return;
            }
            try {
                const res = await fetchWithAuth(`/api/manage/metadata/${encodeURIComponent(name)}`);
                const json = await res.json().catch(() => ({}));
                const data = json?.data || {};
                this.expiryAt = Number(data?.metadata?.LinkExpiresAt || data?.LinkExpiresAt || 0) || 0;
                // v3.0.0：文件级加密状态 —— 详情接口回传原始 metas 字符串，里面有 AccessPasswordHash
                let encrypted = false;
                try {
                    const metas = typeof data?.metas === 'string' ? JSON.parse(data.metas) : (data?.metas || {});
                    encrypted = !!metas?.AccessPasswordHash;
                } catch {
                    encrypted = false;
                }
                this.fileEncrypted = encrypted || data?.metadata?.Encrypted === true;
                if (data.Note !== undefined) {
                    this.noteVisible = true;
                    this.noteText = String(data.Note || '');
                }
            } catch {
                /* 拉取失败不影响详情展示 */
            } finally {
                this.noteLoaded = true;
            }
        },
        openExpiryDialog() {
            if (this.expiryAt > Date.now()) {
                const d = new Date(this.expiryAt);
                const pad = (n) => String(n).padStart(2, '0');
                this.expiryForm.mode = 'datetime';
                this.expiryForm.at = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            } else {
                this.expiryForm.mode = 'forever';
                this.expiryForm.amount = 24;
                this.expiryForm.unit = 'h';
                this.expiryForm.at = '';
            }
            this.showExpiryDialog = true;
        },
        async submitExpiry() {
            const name = this.file?.name;
            if (!name) return;
            const body = {};
            if (this.expiryForm.mode === 'forever') {
                body.clear = true;
            } else if (this.expiryForm.mode === 'duration') {
                const mult = { m: 60, h: 3600, d: 86400 }[this.expiryForm.unit] || 60;
                const amount = Number(this.expiryForm.amount) || 0;
                if (amount <= 0) {
                    ElMessage.warning(this.$t('fileDetail.expiryInvalid'));
                    return;
                }
                body.seconds = amount * mult;
            } else {
                if (!this.expiryForm.at) {
                    ElMessage.warning(this.$t('fileDetail.expiryInvalid'));
                    return;
                }
                body.expiresAt = this.expiryForm.at;
            }
            this.expirySaving = true;
            try {
                const res = await fetchWithAuth(`/api/manage/expiry/${encodeURIComponent(name)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || json.success === false) throw new Error(json.message || this.$t('fileDetail.metadataSaveFailed'));
                this.expiryAt = Number(json?.data?.LinkExpiresAt || 0) || 0;
                if (this.file?.metadata) this.file.metadata.LinkExpiresAt = this.expiryAt;
                this.showExpiryDialog = false;
                this.$emit('metadataUpdated', name, { LinkExpiresAt: this.expiryAt });
                ElMessage.success(this.$t('fileDetail.expirySaved'));
            } catch (err) {
                ElMessage.error(err.message || this.$t('fileDetail.metadataSaveFailed'));
            } finally {
                this.expirySaving = false;
            }
        },
        /** 保存作者备注（仅作者本人可见；后端也只接受作者写入） */
        async saveNote() {
            const name = this.file?.name;
            if (!name) return;
            this.noteSaving = true;
            try {
                const res = await fetchWithAuth(`/api/manage/metadata/${encodeURIComponent(name)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ Note: this.noteText })
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || json.success === false) throw new Error(json.message || this.$t('fileDetail.metadataSaveFailed'));
                if (json?.data?.note !== undefined) this.noteText = String(json.data.note || '');
                ElMessage.success(this.$t('fileDetail.noteSaved'));
            } catch (err) {
                ElMessage.error(err.message || this.$t('fileDetail.metadataSaveFailed'));
            } finally {
                this.noteSaving = false;
            }
        },
        handleVideoClick(e) {
            const video = e.target;
            if (video.paused) video.play();
            else video.pause();
        },
        /**
         * v2.8.7b：详情视频起播策略 —— 始终先静音起播（浏览器 autoplay 策略对静音放行，
         * 修复「开启声音模式后详情视频长时间不出画面」），可播放后再按全局开关设置声音。
         * v2.8.7c：弹窗已关闭时直接返回（canplay 可能在关闭后因后台缓冲再次触发，
         * 不设防会把刚关掉的video重新拉起来）。
         */
        startDetailVideo() {
            const el = this.$refs.detailVideo;
            if (!el || !this.visible || this.mediaAutoStarted) return;
            this.mediaAutoStarted = true;
            el.muted = true;
            const p = el.play();
            if (p && typeof p.then === 'function') {
                p.then(() => { if (this.visible) el.muted = this.videoMuted; })
                 .catch(() => { console.log('[fileDetail] 详情视频自动播放被浏览器策略拒绝，等待用户手动播放'); });
            }
        },
        /** v2.8.7b：音频自动播放（unmuted autoplay 被浏览器策略拒绝时静默降级，用户可手点 controls 播放） */
        startDetailAudio() {
            const el = this.$refs.detailAudio;
            if (!el || !this.visible || this.mediaAutoStarted) return;
            this.mediaAutoStarted = true;
            const p = el.play();
            if (p && typeof p.catch === 'function') p.catch(() => { console.log('[fileDetail] 详情音频自动播放被浏览器策略拒绝，等待用户手动播放'); });
        },
        /** v2.8.7c：关闭详情弹窗时暂停正在播放的视频 / 音频（随后元素即被销毁） */
        pauseDetailMedia() {
            const v = this.$refs.detailVideo;
            if (v && !v.paused) v.pause();
            const a = this.$refs.detailAudio;
            if (a && !a.paused) a.pause();
        },
        /**
         * v3.0.0（第三轮）：关闭详情页后彻底停掉视频 / 音频。
         * 只靠 refs + mediaMounted 在部分关闭路径下不够（弹窗关闭有 ~300ms 过渡，元素仍在
         * DOM 里；refs 也可能因重建而指向新元素）→ 关闭动画结束时再扫一遍弹窗内的媒体元素，
         * 暂停 + 归零 + 清 src + load()，确保退出后不会还有声音在后台继续放。
         */
        stopAllMedia() {
            const root = this.$refs.detailDialog && this.$refs.detailDialog.$el;
            const nodes = [];
            if (root && root.querySelectorAll) nodes.push(...root.querySelectorAll('video, audio'));
            // 详情页里拉起的媒体预览层（若有）一并回收
            document.querySelectorAll('.media-preview-overlay video, .media-preview-overlay audio').forEach((el) => nodes.push(el));
            nodes.forEach((el) => {
                try {
                    el.pause();
                    el.currentTime = 0;
                    el.removeAttribute('src');
                    el.load();
                } catch (err) {
                    /* 老浏览器 / 已被销毁的元素：忽略即可 */
                }
            });
        },
        handleTabClick() {},
        /**
         * v1.0.6：「源」按钮 —— 打开弹窗展示签发链接背后的源地址（存储渠道内的真实直链），
         * 由用户自己确认后再复制。没有源地址时按钮不渲染（见模板 v-if）。
         */
        openSourceDialog() {
            if (!this.storageSourceUrl) return;
            this.showSourceDialog = true;
        },
        async copyStorageSource() {
            const url = this.storageSourceUrl;
            if (!url) return;
            const ok = await copyText(url);
            if (ok) {
                ElMessage.success(this.$t('fileDetail.sourceUrlCopied'));
                this.showSourceDialog = false;
            } else {
                ElMessage.warning(this.$t('fileDetail.copyFailed'));
            }
        },
        async handleUrlClick(e) {
            const input = e.target;
            input.select();
            const ok = await copyText(input.value);
            ElMessage[ok ? 'success' : 'warning'](this.$t(ok ? 'fileDetail.linkCopied' : 'dashboard.copyFailed'));
        },
        /**
         * 复制某个渠道下该文件的真实直链。
         * 这是「文件源链接」（对象存储 / WebDAV 里的原始地址），不是本站签发的外链：
         * 直接对外公布会绕过本站的访问控制、限时与统计，所以复制时明确提示一次。
         */
        async copyChannelUrl(url) {
            if (!url) return;
            const ok = await copyText(String(url));
            if (ok) {
                ElMessage.warning({
                    message: this.$t('fileDetail.sourceLinkWarning'),
                    duration: 6000,
                    showClose: true,
                });
            } else {
                ElMessage.warning(this.$t('dashboard.copyFailed'));
            }
        },
        openImageLink() {
            if (this.fileLink) {
                window.open(this.fileLink, '_blank');
            }
        },

        /* ---------------- 二维码（v2.4.0：只保留切换显示，长按/右键交给浏览器原生菜单） ---------------- */
        toggleQr() {
            this.showQr = !this.showQr;
        },
        /**
         * 生成「指定渠道下这个文件的真实直链」。
         *   1) 优先用后端算好的渠道内真实地址（S3 对象 URL / WebDAV 真实路径 / 自定义原始外链）
         *   2) 拿不到时回退本站 /file/:name?channel=<渠道ID>（代理或 302，仍是该渠道的资源）
         */
        /**
         * 渠道直链 → 可点击地址。
         * v3.0.0（R15）：直链缺失时只对「本地存储」渠道回退本站外链
         * （本地文件本来就没有独立域名，本站地址就是它的对外地址）。
         * 其它渠道没有公开访问域名时返回空串 → 该行渲染为纯文本，
         * 不出现任何内网 / 容器名地址。
         */
        channelFileUrl(channelId, directUrl, channelType) {
            if (directUrl) return String(directUrl);
            if (String(channelType || '') !== 'local') return '';
            const name = this.file?.name;
            if (!name || !channelId) return '';
            // 全站统一出口（自定义访问域名优先）
            return `${fileLink(name)}?channel=${encodeURIComponent(channelId)}`;
        },
        /** 字节 → 可读体积（与后端 formatSize 保持一致） */
        formatBytes(bytes) {
            const n = Number(bytes) || 0;
            if (n <= 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            let v = n;
            let i = 0;
            while (v >= 1024 && i < units.length - 1) {
                v /= 1024;
                i += 1;
            }
            return `${i === 0 ? v : v.toFixed(2)} ${units[i]}`;
        },
        /**
         * 跳到「文件管理」的对应分类目录 —— 新标签页打开。
         * 用 URL query（?folder=…）传参，替代 sessionStorage（sessionStorage 不跨标签页）。
         */
        jumpToFolder() {
            const dir = String(this.file?.metadata?.Directory || '').replace(/^\/+|\/+$/g, '');
            const url = `/dashboard${dir ? `?folder=${encodeURIComponent(`${dir}/`)}` : ''}`;
            this.visible = false;
            window.open(url, '_blank');
        },
        /** 跳到「文件管理」并按该标签筛选 —— 新标签页打开（?tag=…） */
        jumpToTag(tag) {
            const name = String(tag || '').trim();
            if (!name) return;
            this.visible = false;
            window.open(`/dashboard?tag=${encodeURIComponent(name)}`, '_blank');
        },
        startEdit() {
            this.editForm.FileName = this.file?.metadata?.FileName || '';
            this.editForm.FileType = this.file?.metadata?.FileType || '';
            // 分类目录：去掉尾部斜杠（与后端 folder 字段一致）
            this.editForm.Directory = String(this.file?.metadata?.Directory || '').replace(/\/+$/, '');
            this.isEditing = true;
            this.loadFolderOptions();
        },
        /** 拉取可选的分类目录（目录树 → 扁平路径列表）
         *  v3.0.0：带上当前实例 id（?instanceId=），只显示该实例下的目录，避免选到别的实例目录。
         *  注意接口前缀：目录树挂在 /api 根下（不是 /api/manage），
         *  用错路径会 404，表现为「编辑时分类下拉是空的、选不到已有目录」。 */
        async loadFolderOptions() {
            this.folderLoading = true;
            try {
                const instanceId = this.currentInstanceId || '';
                const res = await fetchWithAuth(`/api/directoryTree?instanceId=${encodeURIComponent(instanceId)}`);
                const json = await res.json().catch(() => ({}));
                const out = [];
                const walk = (node, prefix) => {
                    for (const child of node?.children || []) {
                        const path = prefix ? `${prefix}/${child.name}` : child.name;
                        out.push(path);
                        walk(child, path);
                    }
                };
                walk(json?.tree || {}, '');
                this.folderOptions = Array.from(new Set(out)).sort();
            } catch {
                this.folderOptions = [];
            } finally {
                this.folderLoading = false;
            }
        },
        cancelEdit() {
            this.isEditing = false;
            this.editForm.FileName = this.file?.metadata?.FileName || '';
            this.editForm.FileType = this.file?.metadata?.FileType || '';
            this.editForm.Directory = String(this.file?.metadata?.Directory || '').replace(/\/+$/, '');
            this.editSaving = false;
        },
        async saveMetadata() {
            this.editSaving = true;
            try {
                const fileId = this.file.name;
                const response = await fetchWithAuth(`/api/manage/metadata/${fileId}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        FileName: this.editForm.FileName,
                        FileType: this.editForm.FileType,
                        Directory: this.editForm.Directory
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    ElMessage.success(this.$t('fileDetail.metadataSaved'));
                    this.isEditing = false;
                    /*
                     * 关键：立刻把新值写回本地的 file.metadata。
                     * 之前只 emit 给父组件，父组件若没就地改写同一个对象，
                     * 弹窗下方的「文件标题 / 文件类型」就会停在旧值，必须刷新页面才更新。
                     */
                    if (this.file?.metadata) {
                        if (data?.metadata?.FileName !== undefined) {
                            this.file.metadata.FileName = data.metadata.FileName;
                        } else if (this.editForm.FileName) {
                            this.file.metadata.FileName = this.editForm.FileName;
                        }
                        if (data?.metadata?.FileType !== undefined) {
                            this.file.metadata.FileType = data.metadata.FileType;
                        } else if (this.editForm.FileType !== undefined) {
                            this.file.metadata.FileType = this.editForm.FileType;
                        }
                        if (data?.metadata?.Directory !== undefined) {
                            this.file.metadata.Directory = data.metadata.Directory;
                        }
                    }
                    this.$emit('metadataUpdated', fileId, data.metadata || {});
                } else {
                    const error = await response.json().catch(() => ({}));
                    throw new Error(error.message || this.$t('fileDetail.metadataSaveFailed'));
                }
            } catch (error) {
                console.error('Error saving metadata:', error);
                ElMessage.error(error.message || this.$t('fileDetail.metadataSaveFailed'));
            } finally {
                this.editSaving = false;
            }
        },
        openRenameDialog() {
            this.renameForm.newFileId = this.file?.name || '';
            this.renameValidation = { valid: true, error: '' };
            this.showRenameDialog = true;
        },
        /** 把「原始名称 / 上一次名称」一键回填到输入框，并立刻校验 */
        fillRename(name) {
            if (!name) return;
            this.renameForm.newFileId = String(name);
            this.validateRenameInput();
        },
        /**
         * v2.9.0：「生成名称」—— 调后端生成 48 位「大小写 + 数字」随机 File_ID
         * （后端已与库中已有 name 去重），仅预填输入框；点「确认重命名」才写库。
         */
        async generateRenameName() {
            if (this.renameGenerating) return;
            this.renameGenerating = true;
            try {
                const response = await fetchWithAuth('/api/manage/rename/generate', { method: 'GET' });
                const data = await response.json().catch(() => ({}));
                if (response.ok && data.success && data.name) {
                    this.renameForm.newFileId = data.name;
                    this.validateRenameInput();
                } else {
                    throw new Error(data.message || this.$t('common.failed'));
                }
            } catch (error) {
                ElMessage.error(error.message || this.$t('common.failed'));
            } finally {
                this.renameGenerating = false;
            }
        },
        /** 打开重定向弹窗，回显当前重定向地址 */
        openRedirectDialog() {
            this.redirectForm.url = this.file?.metadata?.RedirectUrl || '';
            this.showRedirectDialog = true;
        },
        /** 保存 / 清除重定向（clear=true 时清空并恢复渠道直链） */
        async submitRedirect(clear = false) {
            this.redirectSaving = true;
            try {
                const url = clear ? '' : String(this.redirectForm.url || '').trim();
                const fileId = this.file.name;
                const response = await fetchWithAuth(`/api/manage/files/redirect/${fileId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });
                const data = await response.json().catch(() => ({}));
                if (response.ok && data.success) {
                    ElMessage.success(url ? this.$t('dashboard.redirectSaved') : this.$t('dashboard.redirectCleared'));
                    this.showRedirectDialog = false;
                    // 同步到当前详情对象，避免需重新打开才生效
                    if (this.file?.metadata) {
                        this.file.metadata.RedirectUrl = url;
                    }
                    this.$emit('metadataUpdated', fileId, { ...(this.file?.metadata || {}), RedirectUrl: url });
                } else {
                    throw new Error(data.message || this.$t('common.failed'));
                }
            } catch (error) {
                ElMessage.error(error.message || this.$t('common.failed'));
            } finally {
                this.redirectSaving = false;
            }
        },
        closeRenameDialog() {
            this.showRenameDialog = false;
            this.renameForm.newFileId = '';
            this.renameValidation = { valid: true, error: '' };
        },
        validateRenameInput() {
            const result = validateFileId(this.renameForm.newFileId, this.file?.name || '');
            this.renameValidation = {
                valid: result.valid,
                error: result.error || ''
            };
        },
        async submitRename() {
            if (this.renameSaving) return;

            // Validate input first
            this.validateRenameInput();
            if (!this.renameValidation.valid) {
                return;
            }

            this.renameSaving = true;
            try {
                const oldFileId = this.file.name;
                const response = await fetchWithAuth(`/api/manage/rename/${oldFileId}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ newFileId: this.renameForm.newFileId })
                });

                if (response.ok) {
                    const data = await response.json();
                    ElMessage.success(this.$t('fileDetail.renameSuccess'));
                    this.showRenameDialog = false;
                    this.$emit('fileRenamed', oldFileId, this.renameForm.newFileId, data.metadata);
                } else if (response.status === 409) {
                    // Conflict — target File_ID already exists
                    this.renameValidation = {
                        valid: false,
                        error: this.$t('fileDetail.renameConflict')
                    };
                } else {
                    const error = await response.json().catch(() => ({}));
                    throw new Error(error.message || this.$t('fileDetail.renameFailed'));
                }
            } catch (error) {
                console.error('Error renaming file:', error);
                ElMessage.error(error.message || this.$t('fileDetail.renameFailed'));
            } finally {
                this.renameSaving = false;
            }
        }
    }
}
</script>

<style scoped>
/* v1.0.5：标题栏「详情」+ 刷新图标 */
.detail-header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
.detail-header-title {
    font-size: 16px;
    line-height: 1.4;
    font-weight: 600;
    color: var(--el-text-color-primary);
}
.detail-header-refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-secondary);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
}
.detail-header-refresh:hover:not(:disabled) {
    background: var(--el-fill-color-light);
    color: var(--el-color-primary);
}
.detail-header-refresh:disabled {
    cursor: default;
    opacity: 0.75;
}
/* 刷新中：图标匀速转，给一个「确实在跑」的反馈 */
.detail-header-refresh.is-spinning :deep(svg) {
    animation: detail-refresh-spin 0.9s linear infinite;
}
@keyframes detail-refresh-spin {
    to { transform: rotate(360deg); }
}

/* ===== v1.0.5：原位媒体编辑弹窗（压缩 / 转WebP） ===== */
.media-dialog-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.media-dialog-text {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--el-text-color-regular);
}

.media-dialog-hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
}

.media-dialog-hint.is-warn {
    color: var(--el-color-warning);
}
/* v1.0.6：二次压缩的警告要更醒目 —— 比普通提示大 2 号（12px → 14px） */
.media-dialog-hint.is-loud {
    font-size: 14px;
    font-weight: 600;
}
/* v1.0.6：「源」地址用等宽字体，长路径里的斜杠和文件名更容易核对 */
.source-url-textarea :deep(.el-textarea__inner) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.6;
    word-break: break-all;
}

.media-percent-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 6px;
}

.media-percent-value {
    min-width: 44px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-size: 13px;
    color: var(--el-text-color-primary);
}

.media-radio {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
}
/* v2.8.9：重命名输入框 + 「生成名称」按钮同行 */
.rename-input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
}
.rename-input-row .el-input {
    flex: 1 1 auto;
    min-width: 0;
}
.rename-generate-btn {
    flex: 0 0 auto;
}
/* v2.9.0：只读说明 */
.rename-readonly-hint {
    margin-top: 6px;
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.6;
    white-space: normal;
}

/* v2.8.9：处理记录 —— 单行展示，超出省略，悬停看全文 */
.process-event-line {
    display: block;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 12px;
    color: var(--el-text-color-regular);
}
/* v3.0.0：处理记录分组（label + value 信息行，与详情现有信息行一致） */
.process-groups {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    min-width: 0;
}
.process-group {
    min-width: 0;
}
.process-group-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    margin-bottom: 2px;
}
.process-group-rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.process-group-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    line-height: 1.6;
    min-width: 0;
}
.process-group-label {
    flex: 0 0 auto;
    color: var(--el-text-color-secondary);
}
.process-group-label::after {
    content: '：';
}
.process-group-value {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--el-text-color-regular);
    word-break: break-all;
}
/* v3.0.0：加密弹窗状态行 */
.encrypt-status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 13px;
}
.encrypt-status-label {
    color: var(--el-text-color-regular);
}
/* v3.0.0（R5）：下载按钮只保留「靠右」，尺寸 / 颜色 / 背景 / 圆角全部交给 el-button 默认
   （与前面的「二维码」按钮同为 size=small + plain，视觉完全一致） */
.preview-toolbar-download {
    margin-left: auto;
}
/* v3.0.0：分享 / 源 按钮左右外边距调小（与兄弟按钮间距 4px） */
.preview-toolbar-share,
.preview-toolbar-source {
    margin-left: 0;
    margin-right: 0;
}
/* v1.0.3：转存按钮（排在下载前面，样式与同排其它 plain 小按钮一致） */
.preview-toolbar-convert {
    margin-left: 0;
}
/* v1.0.3：转存弹窗 */
.convert-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 60px;
}
.convert-row {
    display: flex;
    align-items: center;
    gap: 10px;
}
.convert-row.is-column {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
}
.convert-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-regular);
    flex: none;
}
.convert-value {
    font-size: 13px;
    color: var(--el-text-color-primary);
    word-break: break-all;
}
.convert-option-type {
    float: right;
    margin-left: 12px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.convert-radio {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
}
.convert-hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
}
.convert-hint.is-warn {
    color: var(--el-color-warning);
}
/* v2.6.0 #301：换行格式（ip␤归属地）按多行展示 */
.ip-display-multiline {
    white-space: pre-line;
    word-break: break-all;
}

/* 二维码标签页 */
.qr-pane {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 8px 0 4px;
}
.qr-hint {
    margin: 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    text-align: center;
    line-height: 1.5;
}
/* 详情内容容器：值超长时整体字号降一号 */
.detail-body.detail-compact .detail-action,
.detail-body.detail-compact :deep(.el-descriptions__label),
.detail-body.detail-compact :deep(.el-descriptions__content),
.detail-body.detail-compact :deep(.el-input__inner),
.detail-body.detail-compact :deep(.el-tabs__item) {
    font-size: 13px;
}
.detail-body.detail-compact :deep(.el-descriptions__content .el-tag),
.detail-body.detail-compact :deep(.el-descriptions__label.el-tag) {
    font-size: 12px;
}
.detail-actions {
    display: flex;
    justify-content: flex-start;
    margin-bottom: 10px;
    flex-wrap: wrap;
    gap: 8px;
}
.detail-action {
    margin-left: 0 !important;
}
.video-preview {
    width: 100%;
    max-width: 400px;
    max-height: 300px;
    border-radius: 8px;
    cursor: pointer;
    object-fit: contain;
}
.audio-preview {
    width: 100%;
    max-width: 400px;
    border-radius: 8px;
}
.image-preview {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 300px;
    border-radius: 8px;
    cursor: pointer;
}
.image-preview :deep(img) {
    max-width: 100%;
    max-height: 300px;
    object-fit: contain;
}
.file-icon-detail {
    font-size: 64px;
    color: var(--el-text-color-secondary);
}
.preview-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 15px;
    padding: 12px;
    background: var(--el-fill-color-light);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    min-height: 60px;
}
/* 预览区顶部：二维码切换（v2.3.0，二维码直接替换文件显示） */
.preview-toolbar {
    display: flex;
    align-items: center;
    /* v3.0.0：按钮间距 10px → 6px（「分享」左右外边距收小） */
    gap: 6px;
    flex-wrap: wrap;
}
/* v3.0.0：按钮自身左右外边距清零 —— el-button 相邻默认各带 margin，会和 gap 叠成更大的间距 */
.preview-toolbar :deep(.el-button + .el-button) {
    margin-left: 0;
}
.preview-toolbar > *:not(.preview-toolbar-download) {
    margin-left: 0;
    margin-right: 0;
}
.preview-toolbar-icon {
    margin-right: 4px;
}
/*
 * v3.0.0（R7）：移动端「二维码 / 分享 / 源 / 下载」固定一行 ——
 * 宽度不够时整行左右滑动（隐藏滚动条），不再折成两行把预览区顶下去。
 * 下载按钮同时取消 margin-left:auto（否则会把整行撑开、第一屏看不见）。
 */
@media (max-width: 768px) {
    .preview-toolbar {
        flex-wrap: nowrap;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-x: contain;
        scrollbar-width: none;
        padding-bottom: 2px;
    }
    .preview-toolbar::-webkit-scrollbar {
        display: none;
    }
    .preview-toolbar > * {
        flex: 0 0 auto;
        margin-left: 0;
        margin-right: 0;
    }
    .preview-toolbar-download {
        margin-left: 0;
    }
}
.preview-content {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
}
/* 二维码态：给个白色底座，避免深色主题下扫不出来 */
.preview-content.is-qr {
    padding: 10px 0;
    cursor: context-menu;
}
/* 「文件大小」悬停提示：两行文本 */
.size-tooltip {
    white-space: pre-line;
    line-height: 1.6;
}
.size-value {
    cursor: help;
}
/* 重命名弹窗里的历史名称 */
.rename-history {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 14px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--el-fill-color-light);
    border: 1px dashed var(--el-border-color-lighter);
}
.rename-history-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 12px;
}
.rename-history-label {
    color: var(--el-text-color-secondary);
    flex-shrink: 0;
}
.rename-history-value {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    word-break: break-all;
    opacity: 0.9;
}
:deep(.el-descriptions__content) {
    word-break: break-all;
    word-wrap: break-word;
}
:deep(.el-descriptions__content .el-tag) {
    vertical-align: middle;
}
:deep(.el-descriptions__content .el-tag + span) {
    vertical-align: middle;
}
:deep(.el-descriptions__label) {
    width: 120px !important;
    min-width: 100px !important;
    max-width: 120px !important;
}
:deep(.el-descriptions__body table) {
    table-layout: fixed;
}
.md5-value {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    word-break: break-all;
}
/* 存储渠道 / 备份渠道：值可点击，直接打开该文件在对应渠道上的直链 */
.channel-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: inherit;
    text-decoration: none;
    vertical-align: middle;
    max-width: 100%;
}
.channel-link:not(.is-static) {
    cursor: pointer;
}
.channel-link:not(.is-static):hover .channel-name {
    text-decoration: underline;
    color: var(--el-color-primary);
}
.channel-link .channel-name {
    word-break: break-all;
}
/* 渠道行：链接 + 复制按钮 */
.channel-row {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
}

/* 详情里可点击的「文件分类」值：跳转到文件管理的对应目录 */
.detail-jump-link {
    color: var(--el-color-primary);
    text-decoration: none;
    word-break: break-all;
    cursor: pointer;
}
.detail-jump-link:hover {
    text-decoration: underline;
}

/* 详情里的标签：点击按该标签筛选文件 */
.detail-tag-link {
    cursor: pointer;
}
.detail-tag-link:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary);
}
.channel-copy-btn {
    padding: 2px 4px;
    height: auto;
    color: var(--el-text-color-secondary);
}
.channel-copy-btn:hover {
    color: var(--el-color-primary);
}
/* 重定向说明 */
.redirect-tip {
    margin: -6px 0 0 100px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
}
/* 编辑态的「文件分类」下拉：与其它详情值对齐 */
.detail-folder-select {
    width: 100%;
}

/* v3.0.0：缩略图与文件信息之间的分隔行 —— 有效期以细信息条的形式压在这条线上 */
.detail-divider-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin: 2px 0 10px;
    padding: 7px 2px 0;
    border-top: 1px solid var(--el-border-color-lighter);
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
}
.detail-divider-label {
    color: var(--el-text-color-regular);
}
.detail-divider-label::after {
    content: '：';
}
.detail-divider-value.is-expired {
    color: var(--el-color-danger);
}
/* v3.0.0：详情里的「文件加密」行 */
.detail-encrypt-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
}
.detail-encrypt-hint {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
/* v3.0.0：加密弹窗 —— 输入框与后缀区 flex 布局，后缀不再被输入框遮挡 */
.encrypt-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
}
.encrypt-field-main {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
.encrypt-field-main .encrypt-input {
    flex: 1 1 200px;
    min-width: 0;
}
.encrypt-clear-btn {
    flex: 0 0 auto;
    margin-left: 0 !important;
}
.encrypt-field-hint {
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
    word-break: break-word;
}
/* 作者备注区 */
/*
 * v3.0.0（R8）：评分 / 等级行 —— 备注块上方，星（半星）与心两行。
 */
.detail-rating {
    margin-top: 14px;
    padding: 10px 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.detail-rating-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 26px;
}
.detail-rating-label {
    flex: 0 0 auto;
    width: 44px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.detail-rating-value {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.detail-rating-hint {
    font-size: 11px;
    color: var(--el-text-color-placeholder);
}
/*
 * v3.0.0（R9）：五个爱心（FA heart）与上一行 el-rate 星星「每颗对齐每颗」——
 * 几何参数完全照抄 el-rate：图标 18px（--el-rate-icon-size）、间距 6px（--el-rate-icon-margin），
 * 两行 label 同宽（44px），因此五颗图标逐列对齐。
 * v3.0.0（R12）：补齐 el-rate 最后一颗星自带的 6px 右边距 ——
 * el-rate 每个星项都有 margin-right，总宽 5×18+5×6=120；爱心行只有 4×6 间距（114），
 * 导致两行「值文本」横向错位 6px，这里补同样的右边距对齐。
 */
.detail-level-stars {
    display: inline-flex;
    align-items: center;
    gap: var(--el-rate-icon-margin, 6px);
    margin-right: var(--el-rate-icon-margin, 6px);
}
.detail-level-heart {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--el-rate-icon-size, 18px);
    height: var(--el-rate-icon-size, 18px);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--el-rate-void-color, var(--el-border-color-darker));
    font-size: var(--el-rate-icon-size, 18px);
    line-height: 1;
    cursor: pointer;
    transition: color 0.12s ease, transform 0.12s ease;
}
.detail-level-heart.is-hover,
.detail-level-heart.is-on {
    color: var(--el-color-danger, #f56c6c);
}
.detail-level-heart.is-hover:not(.is-on) {
    transform: scale(1.12);
}
.detail-level-stars.is-disabled .detail-level-heart {
    cursor: default;
}

.detail-note {
    margin-top: 4px;
    padding: 10px 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    background: var(--el-fill-color-lighter);
}
.detail-note-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 6px;
}
.detail-note-title {
    font-weight: 600;
    font-size: 13px;
    color: var(--el-text-color-primary);
}
.detail-note-hint {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.detail-note-actions {
    margin-top: 8px;
    text-align: right;
}
.detail-note-muted {
    color: var(--el-text-color-secondary);
}
/* 限时弹窗 */
.expiry-modes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-bottom: 12px;
}
.expiry-row {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
}

/* 签发外链：独立模块（v2.3.0）—— 外框 + 内可左右滑动 */
.link-block {
    margin-bottom: 10px;
    padding: 10px 12px 0;
    border-radius: 10px;
    border: 1px solid var(--glass-border);
    background: color-mix(in srgb, var(--el-text-color-primary) 4%, transparent);
}
.link-block :deep(.el-tabs__header) {
    margin-bottom: 8px;
}
.link-block :deep(.el-tabs__nav-wrap) {
    overflow: visible;
}
/* 标签行独立横向滚动：手机 / 窄窗口都能一行滑完所有格式 */
.link-block :deep(.el-tabs__nav-scroll) {
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
}
.link-block :deep(.el-tabs__nav-scroll)::-webkit-scrollbar {
    display: none;
}
.link-block :deep(.el-tabs__nav) {
    flex-wrap: nowrap;
    transform: none !important;
}
.link-block :deep(.el-tabs__item) {
    flex: 0 0 auto;
    padding: 0 12px;
    white-space: nowrap;
}

@media (max-width: 768px) {
    .detail-actions {
        justify-content: center;
    }
    .link-block {
        padding: 8px 8px 0;
    }
    /* v3.0.0：窄屏把加密弹窗的后缀按钮换到输入框下方一行，彻底避免遮挡 */
    .encrypt-field-main {
        flex-direction: column;
        align-items: stretch;
    }
    .encrypt-field-main .encrypt-input {
        flex: 1 1 auto;
    }
    .encrypt-clear-btn {
        width: 100%;
    }
}
</style>

<style>
/* v3.0.0：移动端「截止时间」选择面板居中显示。
   面板被 teleport 到 body，scoped 样式无法命中，因此放在全局样式块里。 */
.expiry-date-popper--center.el-popper {
    position: fixed !important;
    left: 50% !important;
    top: 50% !important;
    right: auto !important;
    bottom: auto !important;
    transform: translate(-50%, -50%) !important;
    margin: 0 !important;
    max-width: 94vw;
}
.expiry-date-popper--center .el-picker-panel {
    max-width: 94vw;
}
@media (max-width: 768px) {
    .expiry-date-popper--center .el-date-picker.has-sidebar {
        width: min(92vw, 340px) !important;
    }
}
</style>
