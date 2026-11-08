<template>
    <div class="security-settings" v-loading="loading">
        <!-- 一级设置：认证管理 -->
        <div class="first-settings">
            <h3 class="first-title">{{ $t('sysSecurity.authManagement') }}</h3>

            <!-- v2.3.0：原来那句「用户端上传密码 / 管理端账号密码已移至用户管理」的迁移提示已移除
                 （迁移早已完成，留着只是噪音）。账户信息统一在「用户管理 → 编辑用户」维护。 -->

            <!-- ================= 邮箱配置（v2.3.0）=================
                 放在 API Token 之前：它是「邮箱验证 / 两步验证验证码 / 关闭 2FA」的前置依赖，
                 属于认证体系的基础设施，先配置它再谈 Token。 -->
            <h4 class="second-title mail-title">{{ $t('sysSecurity.mailConfig') }}
                <el-tooltip :content="$t('sysSecurity.mailConfigTooltip')" placement="top" raw-content>
                    <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                </el-tooltip>
                <el-tag
                    size="small"
                    :type="mailSettings.ready ? 'success' : 'info'"
                    effect="plain"
                    class="mail-status-tag"
                >{{ mailSettings.ready ? $t('sysSecurity.mailReady') : $t('sysSecurity.mailNotReady') }}</el-tag>
            </h4>
            <el-form :model="mailSettings" label-width="140px" :disabled="saving" class="mail-form">
                <el-form-item :label="$t('sysSecurity.mailEnabled')">
                    <el-switch v-model="mailSettings.enabled"/>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.mailHost')">
                    <el-input v-model="mailSettings.host" placeholder="smtp.qq.com"/>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.mailPort')">
                    <el-input-number v-model="mailSettings.port" :min="1" :max="65535" controls-position="right" class="mail-port"/>
                    <span class="mail-hint">{{ $t('sysSecurity.mailPortHint') }}</span>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.mailSecure')">
                    <el-switch v-model="mailSettings.secure"/>
                    <span class="mail-hint">{{ mailSettings.secure ? $t('sysSecurity.mailSecureOn') : $t('sysSecurity.mailSecureOff') }}</span>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.mailUser')">
                    <el-input v-model="mailSettings.user" placeholder="noreply@example.com"/>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.mailPass')">
                    <el-input
                        v-model="mailSettings.pass"
                        type="password"
                        show-password
                        :placeholder="mailSettings._hasPassword ? $t('sysSecurity.mailPassKeep') : $t('sysSecurity.mailPassPlaceholder')"
                    />
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.mailFromName')">
                    <el-input v-model="mailSettings.fromName" placeholder="GoHub"/>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.mailFromAddress')">
                    <el-input v-model="mailSettings.fromAddress" :placeholder="$t('sysSecurity.mailFromAddressHint')"/>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.mailReplyTo')">
                    <el-input v-model="mailSettings.replyTo" :placeholder="$t('sysSecurity.mailReplyToHint')"/>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.mailTest')">
                    <div class="mail-test-row">
                        <el-input v-model="mailTestTo" :placeholder="$t('sysSecurity.mailTestToPlaceholder')"/>
                        <el-button plain size="small" :loading="mailBusy" @click="verifyMail">{{ $t('sysSecurity.mailVerify') }}</el-button>
                        <el-button type="primary" plain size="small" :loading="mailBusy" @click="sendTestMail">{{ $t('sysSecurity.mailSendTest') }}</el-button>
                    </div>
                    <p class="mail-hint block">{{ $t('sysSecurity.mailTestHint') }}</p>
                </el-form-item>
            </el-form>

            <h4 class="second-title token-title">{{ $t('sysSecurity.apiTokenManagement') }}
                <a class="token-actions">
                    <el-button type="primary" size="small" @click="showCreateTokenDialog = true" circle>
                        <font-awesome-icon icon="plus"/>
                    </el-button>
                </a>
            </h4>
            <div class="token-table-container">
                <el-table 
                    :data="apiTokens" 
                    class="token-table"
                    v-loading="tokenLoading"
                >
                    <el-table-column prop="name" :label="$t('sysSecurity.tokenName')" header-align="center">
                        <template #default="scope">
                            <div class="table-cell-content">{{ scope.row.name }}</div>
                        </template>
                    </el-table-column>
                    <el-table-column :label="$t('sysSecurity.tokenType')" header-align="center" width="120">
                        <template #default="scope">
                            <div class="table-cell-content">
                                <el-tag :type="scope.row.type === 's3' ? 'warning' : 'primary'" size="small" effect="plain">
                                    {{ scope.row.type === 's3' ? $t('sysSecurity.typeS3') : $t('sysSecurity.typeWeb') }}
                                </el-tag>
                            </div>
                        </template>
                    </el-table-column>
                    <el-table-column prop="token" :label="$t('sysSecurity.tokenValue')" header-align="center" min-width="240">
                        <template #default="scope">
                            <!-- 凭据默认打码，点小眼睛才显示；复制按钮始终可复制完整值 -->
                            <div class="table-cell-content token-cell">
                                <span class="token-display" :title="isRevealed(scope.row) ? tokenDisplay(scope.row) : ''">
                                    {{ isRevealed(scope.row) ? tokenDisplay(scope.row) : maskToken(tokenDisplay(scope.row)) }}
                                </span>
                                <el-button class="inline-copy-btn" size="small" text @click="toggleReveal(scope.row)">
                                    <font-awesome-icon :icon="isRevealed(scope.row) ? 'eye-slash' : 'eye'"/>
                                </el-button>
                                <el-button class="inline-copy-btn" size="small" text @click="copyValue(tokenDisplay(scope.row))">
                                    <font-awesome-icon icon="copy"/>
                                </el-button>
                            </div>
                        </template>
                    </el-table-column>
                    <el-table-column prop="permissions" :label="$t('sysSecurity.permissions')" header-align="center">
                        <template #default="scope">
                            <div class="table-cell-content">
                                <el-tag 
                                    v-for="perm in scope.row.permissions" 
                                    :key="perm" 
                                    size="small" 
                                    class="permission-tag"
                                >
                                    {{ getPermissionText(perm) }}
                                </el-tag>
                            </div>
                        </template>
                    </el-table-column>
                    <el-table-column prop="createdAt" :label="$t('sysSecurity.createdAt')" header-align="center">
                        <template #default="scope">
                            <div class="table-cell-content">{{ formatDate(scope.row.createdAt) }}</div>
                        </template>
                    </el-table-column>
                    <el-table-column :label="$t('sysSecurity.status')" header-align="center" width="90">
                        <template #default="scope">
                            <div class="table-cell-content">
                                <el-tag
                                    :type="getTokenStatus(scope.row.expiresAt).status === 'active' ? 'success' : 'danger'"
                                    size="small"
                                >
                                    {{ getTokenStatus(scope.row.expiresAt).label }}
                                </el-tag>
                            </div>
                        </template>
                    </el-table-column>
                    <el-table-column :label="$t('sysSecurity.expiresAt')" header-align="center">
                        <template #default="scope">
                            <div class="table-cell-content">{{ getTokenStatus(scope.row.expiresAt).expiresText }}</div>
                        </template>
                    </el-table-column>
                    <!-- 操作列：移动端不固定，与其他列一起左右滚动 -->
                    <el-table-column :label="$t('sysSecurity.operation')" :fixed="windowWidth <= 768 ? false : 'right'" header-align="center" width="210">
                        <template #default="scope">
                            <div class="table-cell-content action-buttons">
                                <el-button class="action-button" size="small" @click="showCredential(scope.row)">{{ $t('sysSecurity.viewCredential') }}</el-button>
                                <el-button class="action-button" size="small" @click="editToken(scope.row)">{{ $t('sysSecurity.editBtn') }}</el-button>
                                <el-button class="action-button" size="small" type="danger" @click="deleteToken(scope.row.id)">{{ $t('sysSecurity.deleteBtn') }}</el-button>
                            </div>
                        </template>
                    </el-table-column>
                </el-table>
            </div>

            <!--
                对外 WebDAV 服务（原「其他设置」页迁移至此，紧随 API Token 管理之下）。
                v1.0.6 重构后：纯网盘，不再走图床上传链路 ——
                  · 账号 = 普通用户的账户名；密码 = 该账户在「WebDAV 管理」里创建的渠道访问密钥；
                  · 文件原样落到 webdav/{账户名}/{存储路径}，不改名/不压缩/不转码/不转 WebP；
                  · 不限文件类型与单文件大小，也不进「图床文件」和「历史记录」；
                  · 管理员账户禁止使用；关闭本开关 = 全局停用。
            -->
            <h4 class="second-title">{{ $t('sysOthers.webdav') }}
                <el-tooltip placement="top" raw-content>
                    <template #content>
                        <div style="max-width: 340px; line-height: 1.7;" v-html="$t('sysOthers.webdavTooltip')"></div>
                    </template>
                    <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                </el-tooltip>
            </h4>
            <el-form :model="webdavSettings" label-width="120px" :disabled="saving">
                <el-form-item :label="$t('sysOthers.enable')">
                    <el-switch v-model="webdavSettings.enabled"></el-switch>
                </el-form-item>
                <!--
                    v1.0.6：删掉「根目录前缀」与「只读模式」两项 ——
                    重构后挂载点固定为 /dav/，每个账户的每个渠道各占一个子目录；
                    网盘按标准协议必然可写，再加只读开关只会让人误以为上传失败是 bug。
                -->
                <el-form-item :label="$t('sysOthers.webdavAddress')">
                    <el-input :model-value="webdavAddress" readonly>
                        <template #append>
                            <el-button @click="copyWebdavAddress">{{ $t('sysOthers.copy') }}</el-button>
                        </template>
                    </el-input>
                </el-form-item>
                <!-- 访问域名：与「API 接入信息」取同一个来源（自定义访问域名 > 默认URL前缀 > 本站） -->
                <el-form-item :label="$t('sysOthers.webdavAccessDomain')">
                    <el-input :model-value="webdavAccessDomain" readonly>
                        <template #append>
                            <el-button @click="copyWebdavAccessDomain">{{ $t('sysOthers.copy') }}</el-button>
                        </template>
                    </el-input>
                </el-form-item>
                <!-- 统一说明（账号来源 + 渠道来源 + 类型/大小限制开关）：
                     直接并入上方表单框内，不再单独占一个提示框 -->
                <el-form-item>
                    <div class="webdav-note">{{ $t('sysOthers.webdavAccountNote') }}</div>
                </el-form-item>
            </el-form>
        </div>

        <!-- 一级设置：上传管理 -->
        <div class="first-settings">
            <h3 class="first-title">{{ $t('sysSecurity.uploadManagement') }}</h3>            
            <h4 class="second-title">{{ $t('sysSecurity.imageReview') }}
                <el-tooltip :content="$t('sysSecurity.imageReviewTooltip')" placement="top">
                    <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                </el-tooltip>
            </h4>         
            <el-form :model="uploadSettings.moderate" label-width="120px" :disabled="saving">
                <el-form-item :label="$t('sysSecurity.enableReview')">
                    <el-switch v-model="uploadSettings.moderate.enabled"/>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.reviewChannel')">
                    <el-select v-model="uploadSettings.moderate.channel" :placeholder="$t('sysSecurity.reviewChannelPlaceholder')">
                        <el-option label="moderatecontent.com" value="moderatecontent.com"></el-option>
                        <el-option label="nsfwjs" value="nsfwjs"></el-option>
                    </el-select>
                </el-form-item>
                <el-form-item v-if="uploadSettings.moderate.channel === 'moderatecontent.com'" :label="$t('sysSecurity.apiKey')">
                    <el-input v-model="uploadSettings.moderate.moderateContentApiKey"/>
                </el-form-item>
                <el-form-item v-if="uploadSettings.moderate.channel === 'nsfwjs'" :label="$t('sysSecurity.apiPath')">
                    <el-input v-model="uploadSettings.moderate.nsfwApiPath" placeholder="https://nsfwjs.your.domain"/>
                </el-form-item>
            </el-form>

            <h4 class="second-title">{{ $t('sysSecurity.ipQuery') }}
                <el-tooltip :content="$t('sysSecurity.ipQueryTooltip')" placement="top">
                    <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                </el-tooltip>
            </h4>
            <el-form :model="uploadSettings.ipQuery" label-width="120px" :disabled="saving">
                <el-form-item :label="$t('sysSecurity.enableIpQuery')">
                    <el-switch v-model="uploadSettings.ipQuery.enabled"/>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.ipQueryChannel')">
                    <el-select v-model="uploadSettings.ipQuery.channel" :placeholder="$t('sysSecurity.ipQueryChannelPlaceholder')">
                        <el-option :label="$t('sysSecurity.ipQueryChannelIpApi')" value="ipApi"></el-option>
                        <el-option :label="$t('sysSecurity.ipQueryChannelLocal')" value="local"></el-option>
                        <el-option :label="$t('sysSecurity.customApi')" value="customApi"></el-option>
                    </el-select>
                </el-form-item>
                <!-- v2.6.0 #301：本地数据包（qqwry.dat）上传与状态 -->
                <template v-if="uploadSettings.ipQuery.channel === 'local'">
                    <el-form-item :label="$t('sysSecurity.ipQueryDatFile')">
                        <div class="ipquery-dat-box">
                            <el-upload
                                action=""
                                accept=".dat"
                                :show-file-list="false"
                                :http-request="uploadQqwryDat"
                                :disabled="datUploading"
                            >
                                <el-button type="primary" plain :loading="datUploading">
                                    <font-awesome-icon icon="upload" style="margin-right: 5px;"/>
                                    <span>{{ $t('sysSecurity.ipQueryDatUpload') }}</span>
                                </el-button>
                            </el-upload>
                            <div class="ipquery-dat-status">
                                <span v-if="datStatus.exists">
                                    {{ $t('sysSecurity.ipQueryDatStatus', {
                                        records: Number(datStatus.records || 0).toLocaleString(),
                                        size: (Number(datStatus.sizeBytes || 0) / 1048576).toFixed(1)
                                    }) }}
                                </span>
                                <span v-else class="ipquery-dat-missing">{{ $t('sysSecurity.ipQueryDatMissing') }}</span>
                            </div>
                        </div>
                    </el-form-item>
                </template>
                <!-- v2.6.0 #301：显示格式（全系统 IP 归属地展示统一走这里） -->
                <el-form-item :label="$t('sysSecurity.ipDisplayFormat')">
                    <el-select v-model="uploadSettings.ipQuery.displayFormat">
                        <el-option :label="$t('sysSecurity.ipDispIpFirst')" value="ipFirst"></el-option>
                        <el-option :label="$t('sysSecurity.ipDispAddressFirst')" value="addressFirst"></el-option>
                        <el-option :label="$t('sysSecurity.ipDispIpThenAddress')" value="ipThenAddress"></el-option>
                        <el-option :label="$t('sysSecurity.ipDispAddressThenIp')" value="addressThenIp"></el-option>
                    </el-select>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.ipRegionFormat')">
                    <el-select v-model="uploadSettings.ipQuery.regionFormat">
                        <el-option :label="$t('sysSecurity.ipRegionProvinceArea')" value="provinceArea"></el-option>
                        <el-option :label="$t('sysSecurity.ipRegionProvince')" value="province"></el-option>
                        <el-option :label="$t('sysSecurity.ipRegionArea')" value="area"></el-option>
                    </el-select>
                </el-form-item>
                <template v-if="uploadSettings.ipQuery.channel === 'customApi'">
                    <el-form-item :label="$t('sysSecurity.apiPath')">
                        <el-input
                            v-model="uploadSettings.ipQuery.customApi.url"
                            placeholder="https://api.example.com/ip"
                        />
                    </el-form-item>
                    <el-form-item :label="$t('sysSecurity.queryParams')">
                        <div class="query-param-list">
                            <div
                                v-for="(param, index) in uploadSettings.ipQuery.customApi.params"
                                :key="index"
                                class="query-param-row"
                            >
                                <el-input
                                    v-model="param.key"
                                    :placeholder="$t('sysSecurity.paramNamePlaceholder')"
                                />
                                <el-input
                                    v-model="param.value"
                                    :placeholder="$t('sysSecurity.paramValuePlaceholder')"
                                />
                                <el-button
                                    type="danger"
                                    plain
                                    circle
                                    @click="removeIpQueryParam(index)"
                                    :disabled="uploadSettings.ipQuery.customApi.params.length <= 1"
                                >
                                    <font-awesome-icon icon="trash-alt"/>
                                </el-button>
                            </div>
                            <el-button type="primary" plain @click="addIpQueryParam">
                                <font-awesome-icon icon="plus"/>
                                <span>{{ $t('sysSecurity.addQueryParam') }}</span>
                            </el-button>
                        </div>
                    </el-form-item>
                    <el-form-item>
                        <template #label>
                            {{ $t('sysSecurity.responseFields') }}
                            <el-tooltip :content="$t('sysSecurity.responseFieldsTip')" placement="top">
                                <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                            </el-tooltip>
                        </template>
                        <div class="query-param-list">
                            <div
                                v-for="(field, index) in uploadSettings.ipQuery.customApi.responseFields"
                                :key="index"
                                class="response-field-row"
                            >
                                <el-input
                                    v-model="uploadSettings.ipQuery.customApi.responseFields[index]"
                                    :placeholder="$t('sysSecurity.responseFieldPathPlaceholder')"
                                />
                                <el-button
                                    plain
                                    circle
                                    @click="moveIpQueryResponseField(index, -1)"
                                    :disabled="index === 0"
                                >
                                    <font-awesome-icon icon="arrow-up"/>
                                </el-button>
                                <el-button
                                    plain
                                    circle
                                    @click="moveIpQueryResponseField(index, 1)"
                                    :disabled="index === uploadSettings.ipQuery.customApi.responseFields.length - 1"
                                >
                                    <font-awesome-icon icon="arrow-down"/>
                                </el-button>
                                <el-button
                                    type="danger"
                                    plain
                                    circle
                                    @click="removeIpQueryResponseField(index)"
                                >
                                    <font-awesome-icon icon="trash-alt"/>
                                </el-button>
                            </div>
                            <el-button type="primary" plain @click="addIpQueryResponseField">
                                <font-awesome-icon icon="plus"/>
                                <span>{{ $t('sysSecurity.addResponseField') }}</span>
                            </el-button>
                        </div>
                    </el-form-item>
                </template>
            </el-form>
        </div>

        <!-- 一级设置：访问管理 -->
        <div class="first-settings">
            <h3 class="first-title">{{ $t('sysSecurity.accessManagement') }}</h3>

            <!-- v2.3.0：放行域名移到「白名单模式」下方 —— 它只对白名单模式生效，
                 放在前面会让人误以为是独立的外链总开关。 -->
            <h4 class="second-title">{{ $t('sysSecurity.whiteListMode') }}</h4>
            <el-form :model="accessSettings" :rules="accessRules" ref="accessForm" label-width="120px" :disabled="saving">
                <el-form-item>
                    <template #label>
                        {{ $t('sysSecurity.enableWhiteList') }}
                        <el-tooltip :content="$t('sysSecurity.enableWhiteListTooltip')" placement="top" raw-content>
                            <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                        </el-tooltip>
                    </template>
                    <el-switch v-model="accessSettings.whiteListMode"/>
                </el-form-item>
                <!-- 放行域名：仅当白名单模式开启时才有意义，这里直接跟随开关禁用 -->
                <el-form-item :class="{ 'is-muted': !accessSettings.whiteListMode }">
                    <template #label>
                        {{ $t('sysSecurity.allowedDomains') }}
                        <el-tooltip :content="$t('sysSecurity.allowedDomainsTooltip')" placement="top" raw-content>
                            <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                        </el-tooltip>
                    </template>
                    <!-- 一行一条域名（带端口），后端按行拆分后做「域名 + 端口」精确匹配 -->
                    <el-input
                        v-model="accessSettings.allowedDomains"
                        type="textarea"
                        :autosize="{ minRows: 4, maxRows: 12 }"
                        :disabled="saving || !accessSettings.whiteListMode"
                        :placeholder="$t('sysSecurity.allowedDomainsPlaceholder')"
                    />
                </el-form-item>
            </el-form>

            <!-- ================= 失效文件替换地址（v2.3.0）=================
                 覆盖「无权限 / 不存在 / 未开放 / 已过期」等所有打不开的情况：
                   image    → 直接下发这张图片（链接不变，内容变成替换图）
                   redirect → 302 跳到该链接 -->
            <h4 class="second-title">{{ $t('sysSecurity.fallbackTitle') }}
                <el-tooltip :content="$t('sysSecurity.fallbackTooltip')" placement="top" raw-content>
                    <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                </el-tooltip>
            </h4>
            <el-form :model="accessSettings" label-width="120px" :disabled="saving">
                <el-form-item :label="$t('sysSecurity.fallbackEnabled')">
                    <el-switch v-model="accessSettings.fallbackEnabled"/>
                </el-form-item>
                <template v-if="accessSettings.fallbackEnabled">
                    <el-form-item :label="$t('sysSecurity.fallbackType')">
                        <el-radio-group v-model="accessSettings.fallbackType">
                            <el-radio-button label="image">{{ $t('sysSecurity.fallbackTypeImage') }}</el-radio-button>
                            <el-radio-button label="redirect">{{ $t('sysSecurity.fallbackTypeRedirect') }}</el-radio-button>
                        </el-radio-group>
                    </el-form-item>
                    <el-form-item :label="$t('sysSecurity.fallbackUrl')">
                        <el-input
                            v-model="accessSettings.fallbackUrl"
                            :placeholder="accessSettings.fallbackType === 'image' ? $t('sysSecurity.fallbackUrlImagePlaceholder') : $t('sysSecurity.fallbackUrlRedirectPlaceholder')"
                        />
                        <p class="mail-hint block">{{ $t('sysSecurity.fallbackUrlHint') }}</p>
                    </el-form-item>
                </template>
            </el-form>

            <h4 class="second-title">{{ $t('sysSecurity.sessionSecurityPolicy') }}</h4>
            <el-form :model="accessSettings" label-width="120px" :disabled="saving">
                <el-form-item>
                    <template #label>
                        {{ $t('sysSecurity.secureMode') }}
                        <el-tooltip :content="$t('sysSecurity.secureModeTooltip')" placement="top">
                            <font-awesome-icon icon="question-circle" style="margin-left: 5px; cursor: pointer;"/>
                        </el-tooltip>
                    </template>
                    <el-switch v-model="accessSettings.sessionSecure"/>
                </el-form-item>
            </el-form>
        </div>

        <!-- 悬浮保存按钮 -->
        <FloatingSaveButton :show="!loading" :loading="saving" :dirty="hasUnsavedChanges" @click="saveSettings" />

        <!-- 创建Token对话框 -->
        <el-dialog v-model="showCreateTokenDialog" :title="$t('sysSecurity.createTokenTitle')" :width="dialogWidth">
            <el-form :model="newToken" :rules="tokenRules" ref="tokenForm" label-width="100px">
                <el-form-item :label="$t('sysSecurity.tokenType')">
                    <el-radio-group v-model="newToken.type" class="token-type-group">
                        <el-radio-button label="web">
                            <font-awesome-icon icon="globe" class="token-type-icon"/>
                            {{ $t('sysSecurity.typeWeb') }}
                        </el-radio-button>
                        <el-radio-button label="s3">
                            <font-awesome-icon icon="database" class="token-type-icon"/>
                            {{ $t('sysSecurity.typeS3') }}
                        </el-radio-button>
                    </el-radio-group>
                    <div class="token-type-desc">
                        {{ newToken.type === 's3' ? $t('sysSecurity.typeS3Desc') : $t('sysSecurity.typeWebDesc') }}
                    </div>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.tokenNameLabel')" prop="name">
                    <el-input v-model="newToken.name" :placeholder="$t('sysSecurity.tokenNamePlaceholder')"/>
                </el-form-item>
                <!--
                    S3 的「区域 Region」不再让用户配置：服务端不校验 Region 取值，
                    接入信息里统一提示使用 us-east-1 即可，减少一个必填但无意义的配置项。
                -->
                <el-form-item :label="$t('sysSecurity.permissionsLabel')" prop="permissions">
                    <el-checkbox-group v-model="newToken.permissions">
                        <el-checkbox label="upload">{{ $t('sysSecurity.permUpload') }}</el-checkbox>
                        <el-checkbox label="delete">{{ $t('sysSecurity.permDelete') }}</el-checkbox>
                        <el-checkbox label="list">{{ $t('sysSecurity.permList') }}</el-checkbox>
                        <el-checkbox label="manage">{{ $t('sysSecurity.permManage') }}</el-checkbox>
                    </el-checkbox-group>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.advancedDefaults')">
                    <div class="token-defaults">
                        <div class="token-defaults-tip">{{ $t('sysSecurity.advancedDefaultsTip') }}</div>
                        <el-input v-model="newToken.defaultCategory" :placeholder="$t('sysSecurity.defaultCategoryPlaceholder')">
                            <template #prepend>{{ $t('sysSecurity.defaultCategory') }}</template>
                        </el-input>
                        <!-- v3.0.0（R18）：默认分类目录支持占位符，点击直接插入 -->
                        <div class="token-folder-tip">
                            <span class="token-folder-tip-label">{{ $t('sysSecurity.folderPlaceholderTip') }}</span>
                            <code
                                v-for="ph in folderPlaceholders"
                                :key="'new-' + ph.text"
                                class="token-folder-chip"
                                :title="ph.hint"
                                @click="insertFolderPlaceholder('new', ph.text)"
                            >{{ ph.text }}</code>
                        </div>
                        <div class="token-default-field">
                            <span class="token-default-label">{{ $t('sysSecurity.defaultBucket') }}</span>
                            <ChannelSelect v-model="newToken.defaultBucket" kind="main"/>
                        </div>
                        <div class="token-default-field">
                            <span class="token-default-label">{{ $t('sysSecurity.defaultBackup') }}</span>
                            <!-- 备份渠道下拉：统一由 ChannelSelect 提供
                                 默认（'' = 跟随全局）→ none（不备份）→ 各存储渠道 -->
                            <ChannelSelect v-model="newToken.defaultBackup" kind="backup"/>
                        </div>
                    </div>
                </el-form-item>
                <!-- 类型和大小限制：开启（默认）→ 该 Token 传入的文件受「允许上传格式 + 单文件大小上限」约束；
                     关闭 → 跳过这两项限制。Web 通用与 S3 协议两种 Token 均适用 -->
                <el-form-item :label="$t('sysSecurity.enforceLimits')">
                    <div class="token-limit-field">
                        <el-switch v-model="newToken.enforceLimits"/>
                        <el-tooltip :content="$t('sysSecurity.enforceLimitsTooltip')" placement="top" :show-after="600">
                            <span class="token-limit-tip">{{ $t('sysSecurity.enforceLimitsHint') }}</span>
                        </el-tooltip>
                    </div>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.neverExpire')">
                    <el-switch v-model="newToken.neverExpire" @change="onCreateNeverExpireChange"/>
                </el-form-item>
                <el-form-item v-if="!newToken.neverExpire" :label="$t('sysSecurity.validPeriod')" prop="expirationValue">
                    <div style="display: flex; gap: 10px; width: 100%;">
                        <el-input-number v-model="newToken.expirationValue" :min="1" :step="1" controls-position="right" style="flex: 1;"/>
                        <el-select v-model="newToken.expirationUnit" style="width: 100px;">
                            <el-option v-for="opt in timeUnitOptions" :key="opt.value" :label="$t(opt.labelKey)" :value="opt.value"/>
                        </el-select>
                    </div>
                </el-form-item>
                <el-form-item v-if="!newToken.neverExpire" :label="$t('sysSecurity.autoDeleteOnExpire')">
                    <el-switch v-model="newToken.autoDelete"/>
                </el-form-item>
            </el-form>
            <template #footer>
                <span class="dialog-footer">
                    <el-button @click="showCreateTokenDialog = false">{{ $t('common.cancel') }}</el-button>
                    <el-button type="primary" @click="createToken">{{ $t('sysSecurity.createBtn') }}</el-button>
                </span>
            </template>
        </el-dialog>

        <!-- 编辑Token对话框 -->
        <el-dialog v-model="showEditTokenDialog" :title="$t('sysSecurity.editTokenTitle')" :width="dialogWidth">
            <el-form :model="editingToken" :rules="editTokenRules" ref="editTokenForm" label-width="100px">
                <el-form-item :label="$t('sysSecurity.tokenNameLabel')">
                    <el-input v-model="editingToken.name"/>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.tokenType')">
                    <el-tag size="small" effect="plain" :type="editingToken.type === 's3' ? 'warning' : 'primary'">
                        {{ editingToken.type === 's3' ? $t('sysSecurity.typeS3') : $t('sysSecurity.typeWeb') }}
                    </el-tag>
                </el-form-item>
                <!-- S3 的「区域 Region」固定 us-east-1（见接入信息），不再单独配置 -->
                <el-form-item :label="$t('sysSecurity.permissionsLabel')" prop="permissions">
                    <el-checkbox-group v-model="editingToken.permissions">
                        <el-checkbox label="upload">{{ $t('sysSecurity.permUpload') }}</el-checkbox>
                        <el-checkbox label="delete">{{ $t('sysSecurity.permDelete') }}</el-checkbox>
                        <el-checkbox label="list">{{ $t('sysSecurity.permList') }}</el-checkbox>
                        <el-checkbox label="manage">{{ $t('sysSecurity.permManage') }}</el-checkbox>
                    </el-checkbox-group>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.advancedDefaults')">
                    <div class="token-defaults">
                        <div class="token-defaults-tip">{{ $t('sysSecurity.advancedDefaultsTip') }}</div>
                        <el-input v-model="editingToken.defaultCategory" :placeholder="$t('sysSecurity.defaultCategoryPlaceholder')">
                            <template #prepend>{{ $t('sysSecurity.defaultCategory') }}</template>
                        </el-input>
                        <!-- v3.0.0（R18）：默认分类目录支持占位符，点击直接插入 -->
                        <div class="token-folder-tip">
                            <span class="token-folder-tip-label">{{ $t('sysSecurity.folderPlaceholderTip') }}</span>
                            <code
                                v-for="ph in folderPlaceholders"
                                :key="'edit-' + ph.text"
                                class="token-folder-chip"
                                :title="ph.hint"
                                @click="insertFolderPlaceholder('edit', ph.text)"
                            >{{ ph.text }}</code>
                        </div>
                        <div class="token-default-field">
                            <span class="token-default-label">{{ $t('sysSecurity.defaultBucket') }}</span>
                            <ChannelSelect v-model="editingToken.defaultBucket" kind="main"/>
                        </div>
                        <div class="token-default-field">
                            <span class="token-default-label">{{ $t('sysSecurity.defaultBackup') }}</span>
                            <!-- 备份渠道下拉：统一由 ChannelSelect 提供
                                 默认（'' = 跟随全局）→ none（不备份）→ 各存储渠道 -->
                            <ChannelSelect v-model="editingToken.defaultBackup" kind="backup"/>
                        </div>
                    </div>
                </el-form-item>
                <!-- 类型和大小限制：开启（默认）→ 该 Token 传入的文件受「允许上传格式 + 单文件大小上限」约束；
                     关闭 → 跳过这两项限制。Web 通用与 S3 协议两种 Token 均适用 -->
                <el-form-item :label="$t('sysSecurity.enforceLimits')">
                    <div class="token-limit-field">
                        <el-switch v-model="editingToken.enforceLimits"/>
                        <el-tooltip :content="$t('sysSecurity.enforceLimitsTooltip')" placement="top" :show-after="600">
                            <span class="token-limit-tip">{{ $t('sysSecurity.enforceLimitsHint') }}</span>
                        </el-tooltip>
                    </div>
                </el-form-item>
                <el-form-item :label="$t('sysSecurity.neverExpire')">
                    <el-switch v-model="editingToken.neverExpire" @change="onEditNeverExpireChange"/>
                </el-form-item>
                <el-form-item v-if="!editingToken.neverExpire" :label="$t('sysSecurity.validPeriod')" prop="expirationValue">
                    <div style="display: flex; gap: 10px; width: 100%;">
                        <el-input-number v-model="editingToken.expirationValue" :min="1" :step="1" controls-position="right" style="flex: 1;"/>
                        <el-select v-model="editingToken.expirationUnit" style="width: 100px;">
                            <el-option v-for="opt in timeUnitOptions" :key="opt.value" :label="$t(opt.labelKey)" :value="opt.value"/>
                        </el-select>
                    </div>
                </el-form-item>
                <el-form-item v-if="!editingToken.neverExpire" :label="$t('sysSecurity.autoDeleteOnExpire')">
                    <el-switch v-model="editingToken.autoDelete"/>
                </el-form-item>
            </el-form>
            <template #footer>
                <span class="dialog-footer">
                    <el-button @click="showEditTokenDialog = false">{{ $t('common.cancel') }}</el-button>
                    <el-button type="primary" @click="updateToken">{{ $t('sysSecurity.updateBtn') }}</el-button>
                </span>
            </template>
        </el-dialog>

        <!-- Token创建成功对话框 -->
        <el-dialog v-model="showTokenResultDialog" :title="$t('sysSecurity.tokenCreatedTitle')" :width="dialogWidth">
            <div class="token-result">
                <p class="token-result-tip">
                    <font-awesome-icon icon="check" style="margin-right: 5px;"/>
                    {{ $t('sysSecurity.tokenCreatedWarning') }}
                </p>
                <el-form label-width="110px">
                    <el-form-item :label="$t('sysSecurity.tokenNameLabel')">
                        <span>{{ createdToken.name }}</span>
                    </el-form-item>
                    <el-form-item :label="$t('sysSecurity.tokenType')">
                        <el-tag size="small" effect="plain" :type="createdToken.type === 's3' ? 'warning' : 'primary'">
                            {{ createdToken.type === 's3' ? $t('sysSecurity.typeS3') : $t('sysSecurity.typeWeb') }}
                        </el-tag>
                    </el-form-item>
                </el-form>
                <TokenCredentialCard :token="createdToken" @copy="copyValue"/>
            </div>
            <template #footer>
                <span class="dialog-footer">
                    <el-button type="primary" @click="showTokenResultDialog = false">{{ $t('sysSecurity.savedBtn') }}</el-button>
                </span>
            </template>
        </el-dialog>

        <!-- 已有 Token 的接入信息（凭据长期可查看、可复制） -->
        <el-dialog v-model="showCredentialDialog" :title="$t('sysSecurity.credentialTitle')" :width="dialogWidth">
            <div class="token-result">
                <el-form label-width="110px">
                    <el-form-item :label="$t('sysSecurity.tokenNameLabel')">
                        <span>{{ credentialToken.name }}</span>
                    </el-form-item>
                    <el-form-item :label="$t('sysSecurity.tokenType')">
                        <el-tag size="small" effect="plain" :type="credentialToken.type === 's3' ? 'warning' : 'primary'">
                            {{ credentialToken.type === 's3' ? $t('sysSecurity.typeS3') : $t('sysSecurity.typeWeb') }}
                        </el-tag>
                    </el-form-item>
                </el-form>
                <TokenCredentialCard :token="credentialToken" @copy="copyValue"/>
                <p class="token-result-tip token-result-tip--muted">{{ $t('sysSecurity.credentialKeptTip') }}</p>
            </div>
            <template #footer>
                <span class="dialog-footer">
                    <el-button @click="showCredentialDialog = false">{{ $t('common.close') }}</el-button>
                </span>
            </template>
        </el-dialog>
    </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import FloatingSaveButton from '@/components/FloatingSaveButton.vue';
import TokenCredentialCard from '@/components/config/TokenCredentialCard.vue';
import { resolveAccessDomain } from '@/utils/accessDomain';
import ChannelSelect from '@/components/config/ChannelSelect.vue';
import { computeExpiresAt, getTokenStatus } from '@/utils/tokenExpiration';
import { copyText } from '@/utils/clipboard';
import unsavedSettings from '@/mixins/unsavedSettings';

export default {
mixins: [unsavedSettings],
components: {
    FloatingSaveButton,
    TokenCredentialCard,
    ChannelSelect
},
data() {
    return {
        windowWidth: window.innerWidth,
        authSettings: {
            user: {},
            admin: {}
        },
        uploadSettings: {
            moderate: {},
            ipQuery: {
                enabled: false,
                channel: 'customApi',
                // v2.6.0 #301：显示格式 / 地区格式（全系统 IP 归属地展示统一走这里）
                displayFormat: 'ipFirst',
                regionFormat: 'provinceArea',
                customApi: {
                    url: '',
                    params: [{ key: 'ip', value: '{ip}' }],
                    responseFields: []
                }
            }
        },
        // v2.6.0 #301：qqwry.dat 数据包状态与上传
        datStatus: { exists: false, records: 0, sizeBytes: 0, error: '' },
        datUploading: false,
        accessSettings: {},
        // 对外 WebDAV（原「其他设置」页的区块迁移到本页）：
        // 数据仍存在 sysConfig 的 others 分区（others.webdav），保存时整段回写
        webdavSettings: { enabled: false, rootPath: '', readonly: false },
        othersSnapshot: null,
        /*
         * 发信邮箱（v2.3.0）
         * 配置本体存在 security.mail 段，跟随本页「悬浮保存」一起写回；
         * _hasPassword 表示库里已存密码（此时输入框留空 = 不修改）；
         * ready 由后端算好（enabled && host && port && user）。
         */
        mailSettings: {
            enabled: false,
            host: '',
            port: 465,
            secure: true,
            user: '',
            pass: '',
            fromName: 'GoHub',
            fromAddress: '',
            replyTo: '',
            _hasPassword: false,
            ready: false
        },
        mailTestTo: '',
        mailBusy: false,
        apiTokens: [], // API Token列表
        revealedTokens: {}, // Token 明文显示开关（按 Token id；默认全部隐藏，点小眼睛显示）
        // 加载状态
        loading: true,
        saving: false,
        tokenLoading: false,

        // 修改密码相关
        oriUserPassword: '', // 原上传密码
        oriAdminPassword: '', // 原管理端密码

        showUserPassConfirm: false, // 显示用户密码确认框
        showAdminPassConfirm: false, // 显示管理密码确认框
        clearUserPassword: false, // 清除用户密码开关
        clearAdminPassword: false, // 清除管理密码开关

        // Token对话框相关
        showCreateTokenDialog: false,
        showEditTokenDialog: false,
        showTokenResultDialog: false,
        // 已有 Token 的接入信息（凭据一直可查看、可复制）
        showCredentialDialog: false,
        credentialToken: {},

        timeUnitOptions: [
            { labelKey: 'sysSecurity.timeUnitSeconds', value: 's' },
            { labelKey: 'sysSecurity.timeUnitMinutes', value: 'm' },
            { labelKey: 'sysSecurity.timeUnitHours', value: 'h' },
            { labelKey: 'sysSecurity.timeUnitDays', value: 'd' },
            { labelKey: 'sysSecurity.timeUnitMonths', value: 'M' },
            { labelKey: 'sysSecurity.timeUnitYears', value: 'Y' }
        ],
        newToken: {
            // web = 外部自定义 Web 通道接入；s3 = 外部 S3 客户端直传
            type: 'web',
            name: '',
            owner: '',
            region: 'us-east-1',
            defaultCategory: '',
            defaultBucket: '',
            defaultBackup: '',
            permissions: [],
            neverExpire: true,
            expirationValue: 1,
            expirationUnit: 'd',
            autoDelete: false,
            // 类型和大小限制（默认开启）
            enforceLimits: true
        },
        editingToken: {
            id: '',
            name: '',
            type: 'web',
            region: 'us-east-1',
            defaultCategory: '',
            defaultBucket: '',
            defaultBackup: '',
            owner: '',
            permissions: [],
            neverExpire: true,
            expirationValue: 1,
            expirationUnit: 'd',
            autoDelete: false,
            // 类型和大小限制（默认开启）
            enforceLimits: true
        },
        createdToken: {
            name: '',
            type: 'web',
            token: '',
            endpoint: '',
            accessKey: '',
            secretKey: '',
            region: '',
            defaultBucket: '',
            defaultBackup: '',
            defaultCategory: ''
        }
    };
},
computed: {
    /**
     * v3.0.0（R18）：Token「默认分类目录」支持的占位符。
     * text 是原样插入输入框的占位符字面量（不走 i18n，避免被当成插值变量）。
     */
    folderPlaceholders() {
        return [
            { text: '{tokenName}', hint: this.$t('sysSecurity.phTokenName') },
            { text: '{user}', hint: this.$t('sysSecurity.phUser') },
            { text: '{y}', hint: this.$t('sysSecurity.phYear') },
            { text: '{m}', hint: this.$t('sysSecurity.phMonth') },
            { text: '{d}', hint: this.$t('sysSecurity.phDay') }
        ];
    },
    editableSettings() {
        return {
            auth: {
                user: { authCode: this.authSettings.user.authCode },
                admin: { adminUsername: this.authSettings.admin.adminUsername, adminPassword: this.authSettings.admin.adminPassword }
            },
            upload: this.uploadSettings,
            access: this.accessSettings,
            // 发信邮箱参与脏值判断（不含 _hasPassword / ready 这类瞬时状态）
            mail: {
                enabled: this.mailSettings.enabled,
                host: this.mailSettings.host,
                port: this.mailSettings.port,
                secure: this.mailSettings.secure,
                user: this.mailSettings.user,
                pass: this.mailSettings.pass,
                fromName: this.mailSettings.fromName,
                fromAddress: this.mailSettings.fromAddress,
                replyTo: this.mailSettings.replyTo
            },
            // 对外 WebDAV 也参与脏值判断
            webdav: this.webdavSettings,
            clearUserPassword: this.clearUserPassword,
            clearAdminPassword: this.clearAdminPassword
        };
    },
    dialogWidth() {
        return window.innerWidth > 768 ? '50%' : '90%';
    },
    /**
     * WebDAV 挂载地址（按当前浏览器地址推导；反代时以其对外域名为准）。
     * v1.0.6：挂载点固定 /dav/ —— 客户端在这里填「账户名 + 渠道访问密钥」，
     * 后端按密钥反查出这个密钥属于哪个渠道，于是同一个人可以挂多个盘。
     */
    webdavAddress() {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        return `${origin}/dav/`;
    },
    /**
     * 访问域名 —— 与「API 接入信息」取同一个来源（utils/accessDomain）：
     * 上传设置的「自定义访问域名」> 页面设置「默认URL前缀」> 本站 /file/。
     */
    webdavAccessDomain() {
        return resolveAccessDomain({
            userConfig: this.$store?.getters?.userConfig,
            origin: typeof window !== 'undefined' ? window.location.origin : ''
        });
    },
    userPassRules() {
        return {
            authCode: [
                { validator: (rule, value, callback) => {
                    const urlReservedChars = ['%', '&', '?', '#', '/'];
                    const hasReservedChar = urlReservedChars.some(char => value && value.includes(char));
                    if (hasReservedChar) {
                        callback(new Error(this.$t('sysSecurity.passwordUrlReserved')));
                    } else {
                        callback();
                    }
                }, trigger: 'blur' }
            ],
            confirmNewUserPassword: [
                { validator: (rule, value, callback) => {
                    if (!value) {
                        callback(new Error(this.$t('sysSecurity.confirmUploadPassword')));
                    } else if (value !== this.authSettings.user.authCode) {
                        callback(new Error(this.$t('sysSecurity.passwordMismatch')));
                    } else {
                        callback();
                    }
                }, trigger: 'blur' }
            ]
        };
    },
    adminPassRules() {
        return {
            confirmNewAdminPassword: [
                { validator: (rule, value, callback) => {
                    if (!value) {
                        callback(new Error(this.$t('sysSecurity.confirmAdminPassword')));
                    } else if (value !== this.authSettings.admin.adminPassword) {
                        callback(new Error(this.$t('sysSecurity.passwordMismatch')));
                    } else {
                        callback();
                    }
                }, trigger: 'blur' }
            ]
        };
    },
    accessRules() {
        const validateSessionMaxAge = (rule, value, callback) => {
            if (!Number.isInteger(value) || value < 1 || value > 3650) {
                callback(new Error(this.$t('sysSecurity.sessionMaxAgeInvalid')));
            } else {
                callback();
            }
        };
        const validateImageTransformAllowedSizes = (rule, value, callback) => {
            if (!this.accessSettings.imageTransformEnabled || !value || !value.trim()) {
                callback();
                return;
            }

            const sizes = value.split(',').map(size => size.trim().toLowerCase()).filter(Boolean);
            const valid = sizes.every(size => {
                const match = size.match(/^(auto|[1-9]\d*)x(auto|[1-9]\d*)$/);
                if (!match || (match[1] === 'auto' && match[2] === 'auto')) return false;
                return match.slice(1).every(dimension => dimension === 'auto' || Number(dimension) <= 4096);
            });

            if (!valid) {
                callback(new Error(this.$t('sysSecurity.imageTransformAllowedSizesInvalid')));
            } else {
                callback();
            }
        };

        return {
            userSessionMaxAge: [
                { validator: validateSessionMaxAge, trigger: 'change' }
            ],
            adminSessionMaxAge: [
                { validator: validateSessionMaxAge, trigger: 'change' }
            ],
            imageTransformAllowedSizes: [
                { validator: validateImageTransformAllowedSizes, trigger: ['blur', 'change'] }
            ]
        };
    },
    tokenRules() {
        return {
            name: [
                { required: true, message: this.$t('sysSecurity.tokenNameRequired'), trigger: 'blur' }
            ],
            permissions: [
                { required: true, message: this.$t('sysSecurity.permissionsRequired'), trigger: 'change' }
            ],
            expirationValue: [
                { validator: (rule, value, callback) => {
                    if (!this.newToken.neverExpire && (!value || value <= 0)) {
                        callback(new Error(this.$t('sysSecurity.validPeriodRequired')));
                    } else {
                        callback();
                    }
                }, trigger: 'blur' }
            ]
        };
    },
    editTokenRules() {
        return {
            permissions: [
                { required: true, message: this.$t('sysSecurity.permissionsRequired'), trigger: 'change' }
            ],
            expirationValue: [
                { validator: (rule, value, callback) => {
                    if (!this.editingToken.neverExpire && (!value || value <= 0)) {
                        callback(new Error(this.$t('sysSecurity.validPeriodRequired')));
                    } else {
                        callback();
                    }
                }, trigger: 'blur' }
            ]
        };
    },
},
methods: {
    /**
     * v3.0.0（R18）：把占位符追加到「默认分类目录」输入框。
     * 已有内容且不以 / 结尾时自动补一个分隔斜杠。
     */
    insertFolderPlaceholder(which, placeholder) {
        const target = which === 'new' ? this.newToken : this.editingToken;
        if (!target) return;
        const current = String(target.defaultCategory || '');
        if (!current) {
            target.defaultCategory = placeholder;
            return;
        }
        target.defaultCategory = current.endsWith('/') ? current + placeholder : `${current}/${placeholder}`;
    },
    normalizeIpQuerySettings(settings = {}) {
        const ipQuery = settings.ipQuery || {};
        const customApi = ipQuery.customApi || {};
        const params = Array.isArray(customApi.params) && customApi.params.length > 0
            ? customApi.params.map(param => ({
                key: param?.key || '',
                value: param?.value || ''
            }))
            : [{ key: 'ip', value: '{ip}' }];
        const responseFields = Array.isArray(customApi.responseFields)
            ? customApi.responseFields.map(field => {
                if (typeof field === 'string') return field;
                return field?.path || '';
            })
            : [];

        return {
            ...settings,
            moderate: settings.moderate || {},
            ipQuery: {
                enabled: ipQuery.enabled ?? false,
                channel: ipQuery.channel || 'customApi',
                displayFormat: ipQuery.displayFormat || 'ipFirst',
                regionFormat: ipQuery.regionFormat || 'provinceArea',
                customApi: {
                    url: customApi.url || '',
                    params,
                    responseFields
                }
            }
        };
    },
    /** v2.6.0 #301：qqwry.dat 状态查询 */
    async fetchIpQueryDatStatus() {
        try {
            const res = await fetchWithAuth('/api/manage/security/ip-query/dat');
            const json = await res.json().catch(() => ({}));
            if (json?.success && json.data) {
                this.datStatus = { exists: !!json.data.exists, records: json.data.records || 0, sizeBytes: json.data.sizeBytes || 0, error: json.data.error || '' };
            }
        } catch {
            /* 状态获取失败不打断页面 */
        }
    },
    /** v2.6.0 #301：上传 qqwry.dat（原始字节直传） */
    async uploadQqwryDat({ file }) {
        if (this.datUploading) return;
        this.datUploading = true;
        try {
            const res = await fetchWithAuth('/api/manage/security/ip-query/dat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: file
            });
            const json = await res.json().catch(() => ({}));
            if (json?.success) {
                this.$message.success(this.$t('sysSecurity.ipQueryDatUploaded', {
                    records: Number(json.data?.records || 0).toLocaleString()
                }));
                await this.fetchIpQueryDatStatus();
            } else {
                this.$message.error(json?.message || this.$t('floatingSave.failed'));
                console.error('[security] qqwry.dat 上传失败:', json?.message);
            }
        } catch (e) {
            console.error('[security] qqwry.dat 上传异常:', e);
            this.$message.error(this.$t('floatingSave.failed'));
        } finally {
            this.datUploading = false;
        }
    },
    addIpQueryParam() {
        this.uploadSettings.ipQuery.customApi.params.push({ key: '', value: '' });
    },
    removeIpQueryParam(index) {
        if (this.uploadSettings.ipQuery.customApi.params.length <= 1) return;
        this.uploadSettings.ipQuery.customApi.params.splice(index, 1);
    },
    addIpQueryResponseField() {
        this.uploadSettings.ipQuery.customApi.responseFields.push('');
    },
    removeIpQueryResponseField(index) {
        this.uploadSettings.ipQuery.customApi.responseFields.splice(index, 1);
    },
    moveIpQueryResponseField(index, direction) {
        const fields = this.uploadSettings.ipQuery.customApi.responseFields;
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= fields.length) return;
        const [field] = fields.splice(index, 1);
        fields.splice(targetIndex, 0, field);
    },
    handleUserPassInput() {
        if (this.authSettings.user.authCode !== this.oriUserPassword) {
            this.showUserPassConfirm = true;
        } else {
            this.showUserPassConfirm = false;
        }
    },
    handleAdminPassInput() {
        if (this.authSettings.admin.adminPassword !== this.oriAdminPassword) {
            this.showAdminPassConfirm = true;
        } else {
            this.showAdminPassConfirm = false;
        }
    },
    handleClearUserPassword(checked) {
        if (checked) {
            this.authSettings.user.authCode = '';
            this.showUserPassConfirm = false;
        }
    },
    handleClearAdminPassword(checked) {
        if (checked) {
            this.authSettings.admin.adminPassword = '';
            this.authSettings.admin.adminUsername = '';
            this.showAdminPassConfirm = false;
        }
    },
    
    // Token相关方法
    getPermissionText(permission) {
        const permissionMap = {
            'upload': this.$t('sysSecurity.permUpload'),
            'delete': this.$t('sysSecurity.permDelete'), 
            'list': this.$t('sysSecurity.permList'),
            'manage': this.$t('sysSecurity.permManage')
        };
        return permissionMap[permission] || permission;
    },
    
    formatDate(dateString) {
        return new Date(dateString).toLocaleString('zh-CN');
    },
    
    /** 表格里展示的「凭据」：web 用 Token，s3 用 AccessKey（其余字段在「接入信息」里看） */
    tokenDisplay(row) {
        if (!row) return '';
        if (row.type === 's3') return row.accessKey || ''
        return row.token || ''
    },
    /** 凭据遮罩：默认隐藏，点小眼睛才显示（避免旁观者/截屏泄露） */
    maskToken(value) {
        const v = String(value || '');
        if (v.length <= 10) return '••••••••';
        return `${v.slice(0, 6)}••••••${v.slice(-4)}`;
    },
    isRevealed(row) {
        return !!this.revealedTokens[row?.id];
    },
    toggleReveal(row) {
        const id = row?.id;
        if (!id) return;
        this.revealedTokens = { ...this.revealedTokens, [id]: !this.revealedTokens[id] };
    },
    /** 通用复制（带统一提示） */
    async copyValue(text) {
        if (!text) return
        const ok = await copyText(String(text))
        this.$message({
            type: ok ? 'success' : 'error',
            message: this.$t(ok ? 'sysSecurity.copySuccess' : 'sysSecurity.copyFailed')
        })
    },
    copyToken() {
        this.copyValue(this.createdToken.token)
    },
    /** 打开已有 Token 的接入信息（凭据长期可查看、可复制） */
    showCredential(row) {
        this.credentialToken = { ...row }
        this.showCredentialDialog = true
    },

    /* ---------------- 发信邮箱（v2.3.0） ---------------- */

    /** 读取脱敏后的邮箱配置（pass 恒为空，hasPass 表示库里已存密码） */
    async loadMailConfig() {
        try {
            const res = await fetchWithAuth('/api/manage/mail');
            const body = await res.json().catch(() => ({}));
            const d = body?.data || {};
            this.mailSettings = {
                enabled: d.enabled === true,
                host: d.host || '',
                port: Number(d.port) || 465,
                secure: d.secure !== false,
                user: d.user || '',
                pass: '',
                fromName: d.fromName || 'GoHub',
                fromAddress: d.fromAddress || '',
                replyTo: d.replyTo || '',
                _hasPassword: d.hasPass === true,
                ready: d.ready === true
            };
        } catch {
            /* 读不到就保持默认值（不影响其它设置项的编辑与保存） */
        }
    },

    /** 组装「表单当前值」（自检/测试邮件用，不必先保存也能测当前填写内容） */
    mailFormPayload() {
        return {
            enabled: this.mailSettings.enabled === true,
            host: String(this.mailSettings.host || '').trim(),
            port: Number(this.mailSettings.port) || 465,
            secure: this.mailSettings.secure !== false,
            user: String(this.mailSettings.user || '').trim(),
            // 留空 = 用库中已存密码（后端回退逻辑）
            pass: String(this.mailSettings.pass || ''),
            fromName: String(this.mailSettings.fromName || '').trim(),
            fromAddress: String(this.mailSettings.fromAddress || '').trim(),
            replyTo: String(this.mailSettings.replyTo || '').trim()
        };
    },

    /** SMTP 连通性自检（v2.4.0：携带表单当前值，未保存也能测） */
    async verifyMail() {
        this.mailBusy = true;
        try {
            const res = await fetchWithAuth('/api/manage/mail/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mail: this.mailFormPayload() })
            });
            const body = await res.json().catch(() => ({}));
            if (body?.success) this.$message.success(body.message || this.$t('sysSecurity.mailVerifyOk'));
            else this.$message.error(body?.message || this.$t('sysSecurity.mailVerifyFailed'));
        } catch (e) {
            this.$message.error(e?.message || this.$t('sysSecurity.mailVerifyFailed'));
        } finally {
            this.mailBusy = false;
        }
    },

    /** 发一封测试邮件 */
    async sendTestMail() {
        const to = String(this.mailTestTo || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
            this.$message.warning(this.$t('sysSecurity.mailTestToPlaceholder'));
            return;
        }
        this.mailBusy = true;
        try {
            const res = await fetchWithAuth('/api/manage/mail/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to, mail: this.mailFormPayload() })
            });
            const body = await res.json().catch(() => ({}));
            if (body?.success) this.$message.success(body.message || this.$t('sysSecurity.mailSent'));
            else this.$message.error(body?.message || this.$t('sysSecurity.mailSendFailed'));
        } catch (e) {
            this.$message.error(e?.message || this.$t('sysSecurity.mailSendFailed'));
        } finally {
            this.mailBusy = false;
        }
    },

    async loadApiTokens() {
        this.tokenLoading = true;
        try {
            const response = await fetchWithAuth('/api/manage/apiTokens');
            const data = await response.json();
            this.apiTokens = data.tokens || [];
        } catch (error) {
            this.$message.error(this.$t('sysSecurity.tokenListFailed'));
        } finally {
            this.tokenLoading = false;
        }
    },

    createToken() {
        this.$refs.tokenForm.validate(async (valid) => {
            if (!valid) return;
            
            try {
                let expiresAt = null;
                let autoDelete = false;
                if (!this.newToken.neverExpire) {
                    expiresAt = computeExpiresAt(new Date(), this.newToken.expirationValue, this.newToken.expirationUnit);
                    autoDelete = this.newToken.autoDelete;
                }

                // 归属账户交给后端决定：统一落到「安全设置」里的真实管理员账号，
                // 前端不再写死 'admin'（否则文件会归集到一个不存在的账户下）
                const response = await fetchWithAuth('/api/manage/apiTokens', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: this.newToken.name,
                        type: this.newToken.type,
                        region: this.newToken.region,
                        defaultCategory: this.newToken.defaultCategory,
                        defaultBucket: this.newToken.defaultBucket,
                        defaultBackup: this.newToken.defaultBackup,
                        permissions: this.newToken.permissions,
                        expiresAt,
                        autoDelete,
                        // 类型和大小限制（web / s3 两种 Token 通用）
                        enforceLimits: this.newToken.enforceLimits !== false
                    })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    const d = data.data || {};
                    this.createdToken = {
                        name: d.name || this.newToken.name,
                        type: d.type || this.newToken.type,
                        token: d.token || '',
                        endpoint: d.endpoint || '',
                        accessKey: d.accessKey || '',
                        secretKey: d.secretKey || '',
                        region: d.region || '',
                        defaultCategory: this.newToken.defaultCategory,
                        defaultBucket: this.newToken.defaultBucket,
                        defaultBackup: this.newToken.defaultBackup
                    };
                    this.showCreateTokenDialog = false;
                    this.showTokenResultDialog = true;
                    this.newToken = {
                        type: 'web', name: '', owner: '', region: 'us-east-1',
                        defaultCategory: '', defaultBucket: '', defaultBackup: '',
                        permissions: [], neverExpire: true, expirationValue: 1, expirationUnit: 'd', autoDelete: false,
                        enforceLimits: true
                    };
                    await this.loadApiTokens();
                    this.$message.success(this.$t('sysSecurity.tokenCreateSuccess'));
                } else {
                    this.$message.error(data.error || this.$t('sysSecurity.tokenCreateFailed'));
                }
            } catch (error) {
                this.$message.error(this.$t('sysSecurity.tokenCreateFailed'));
            }
        });
    },
    
    editToken(token) {
        const hasExpiration = token.expiresAt !== null && token.expiresAt !== undefined;
        this.editingToken = {
            id: token.id,
            name: token.name,
            type: token.type || 'web',
            region: token.region || 'us-east-1',
            defaultCategory: token.defaultCategory || '',
            defaultBucket: token.defaultBucket || '',
            defaultBackup: token.defaultBackup || '',
            owner: token.owner,
            permissions: [...token.permissions],
            neverExpire: !hasExpiration,
            expirationValue: 1,
            expirationUnit: 'd',
            autoDelete: token.autoDelete || false,
            // 类型和大小限制：历史数据缺该字段时按「开启」处理
            enforceLimits: token.enforceLimits !== false
        };
        this.showEditTokenDialog = true;
    },
    
    updateToken() {
        this.$refs.editTokenForm.validate(async (valid) => {
            if (!valid) return;
            
            try {
                let expiresAt = null;
                let autoDelete = false;
                if (!this.editingToken.neverExpire) {
                    expiresAt = computeExpiresAt(new Date(), this.editingToken.expirationValue, this.editingToken.expirationUnit);
                    autoDelete = this.editingToken.autoDelete;
                }
                
                const response = await fetchWithAuth('/api/manage/apiTokens', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        tokenId: this.editingToken.id,
                        name: this.editingToken.name,
                        region: this.editingToken.region,
                        defaultCategory: this.editingToken.defaultCategory,
                        defaultBucket: this.editingToken.defaultBucket,
                        defaultBackup: this.editingToken.defaultBackup,
                        permissions: this.editingToken.permissions,
                        expiresAt,
                        autoDelete,
                        // 类型和大小限制（web / s3 两种 Token 通用）
                        enforceLimits: this.editingToken.enforceLimits !== false
                    })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    this.showEditTokenDialog = false;
                    await this.loadApiTokens();
                    this.$message.success(this.$t('sysSecurity.tokenUpdateSuccess'));
                } else {
                    this.$message.error(data.error || this.$t('sysSecurity.tokenUpdateFailed'));
                }
            } catch (error) {
                this.$message.error(this.$t('sysSecurity.tokenUpdateFailed'));
            }
        });
    },
    
    async deleteToken(tokenId) {
        try {
            await this.$confirm(this.$t('sysSecurity.tokenDeleteConfirm'), this.$t('sysSecurity.tokenDeleteConfirmTitle'), {
                confirmButtonText: this.$t('sysSecurity.tokenDeleteConfirmOk'),
                cancelButtonText: this.$t('sysSecurity.tokenDeleteConfirmCancel'),
                type: 'warning'
            });
            
            const response = await fetchWithAuth(`/api/manage/apiTokens?id=${tokenId}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            
            if (response.ok) {
                await this.loadApiTokens();
                this.$message.success(this.$t('sysSecurity.tokenDeleteSuccess'));
            } else {
                this.$message.error(data.error || this.$t('sysSecurity.tokenDeleteFailed'));
            }
        } catch (error) {
            if (error !== 'cancel') {
                this.$message.error(this.$t('sysSecurity.tokenDeleteFailed'));
            }
        }
    },
    
    async copyToken() {
        // 统一剪贴板兼容层：navigator.clipboard 不可用（http / 老浏览器）时自动降级
        const ok = await copyText(this.createdToken.token);
        if (ok) this.$message.success(this.$t('sysSecurity.tokenCopied'));
        else this.$message.error(this.$t('sysSecurity.copyFailed'));
    },
    
    onCreateNeverExpireChange(val) {
        if (val) {
            this.newToken.autoDelete = false;
        }
    },
    
    onEditNeverExpireChange(val) {
        if (val) {
            this.editingToken.autoDelete = false;
        }
    },
    
    handleWindowResize() {
        this.windowWidth = window.innerWidth;
    },
    getTokenStatus(expiresAt) {
        return getTokenStatus(expiresAt);
    },
    
    /** 复制 WebDAV 挂载地址（统一走剪贴板兼容层） */
    async copyWebdavAddress() {
        const text = this.webdavAddress;
        const ok = await copyText(text);
        if (ok) this.$message.success(this.$t('sysOthers.copySuccess'));
        else this.$message.warning(text);
    },
    /** 复制对外访问域名 */
    async copyWebdavAccessDomain() {
        const text = this.webdavAccessDomain;
        const ok = await copyText(text);
        if (ok) this.$message.success(this.$t('sysOthers.copySuccess'));
        else this.$message.warning(text);
    },
    /**
     * 保存「对外 WebDAV」—— 配置存放在 sysConfig 的 others 分区。
     * 带着进入页面时读到的 others 快照一起提交（后端还会深合并），
     * 因此只改 webdav 这一段也不会影响遥测 / 随机图 / 公开画廊等其它字段。
     */
    async saveWebdavSettings() {
        const base = (this.othersSnapshot && typeof this.othersSnapshot === 'object')
            ? this.othersSnapshot
            : {};
        const payload = { ...base, webdav: { ...this.webdavSettings } };
        const res = await fetchWithAuth('/api/manage/sysConfig/others', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(this.$t('floatingSave.failed'));
        this.othersSnapshot = payload;
    },
    saveSettings() {
        if (this.saving) return;
        this.saving = true;
        // 所有表单的Promise数组
        let validationPromises = [];

        // v2.5.0 修复：认证字段（上传密码 / 管理员账号密码）已下线，
        // userPassForm / adminPassForm 两个表单随之移除 —— 这里再 validate 不存在的
        // ref 会抛 TypeError 被 catch 捕获，表现为「保存失败，请重试」假报错。
        // 现在只校验仍然存在的「会话安全策略」表单。
        // 验证会话安全策略表单
        validationPromises.push(new Promise((resolve) => {
            this.$refs.accessForm.validate((valid) => {
                resolve(valid);
            });
        }));

        // 等待所有验证完成
        return Promise.all(validationPromises).then((results) => {
            const isValid = results.every(valid => valid);

            if (!isValid) {
                return;
            }

            // v202610221824：认证字段（上传密码 / 管理员账号密码）已下线，
            // 这里不再提交 auth 段 —— 不传后端就保持原值，避免误清历史口令。
            const settings = JSON.parse(JSON.stringify({
                upload: this.uploadSettings,
                access: this.accessSettings,
                // 发信邮箱（v2.3.0）：pass 留空 = 不修改，_clear = 显式清除；
                // 这里只挑真实字段，_hasPassword / ready 是纯前端状态，不能写进库。
                mail: {
                    enabled: this.mailSettings.enabled,
                    host: this.mailSettings.host,
                    port: this.mailSettings.port,
                    secure: this.mailSettings.secure,
                    user: this.mailSettings.user,
                    pass: this.mailSettings.pass,
                    fromName: this.mailSettings.fromName,
                    fromAddress: this.mailSettings.fromAddress,
                    replyTo: this.mailSettings.replyTo
                }
            }));
            return fetchWithAuth('/api/manage/sysConfig/security', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settings)
            }).then(res => {
                if (!res.ok) throw new Error(this.$t('floatingSave.failed'));
                return res.json();
            }).then((data) => {
                // 管理端密码变更后，当前会话已被清除，需要重新登录
                if (data.adminPasswordChanged) {
                    this.markSettingsSaved();
                    const msg = this.$t('sysSecurity.adminPasswordChangedRelogin');
                    this.$message.warning(msg);
                    setTimeout(() => {
                        this.$store.commit('setAdminLoggedIn', false);
                        this.$router.push('/adminLogin');
                    }, 1500);
                    return;
                }

                // 「对外 WebDAV」的配置在 others 分区，跟随本次保存一起写回
                return this.saveWebdavSettings().then(() => {
                    this.$message.success(this.$t('sysSecurity.settingsSaved'));
                    // 发信邮箱：密码已加密落库，前端立刻清空并标记「已设置」，
                    // ready 同步刷新（否则徽章要等下次进页面才变）
                    if (this.mailSettings.pass) this.mailSettings._hasPassword = true;
                    this.mailSettings.pass = '';
                    this.mailSettings.ready = !!(
                        this.mailSettings.enabled &&
                        this.mailSettings.host &&
                        this.mailSettings.port &&
                        this.mailSettings.user
                    );
                    // 保存成功后重置密码字段为空（后端已处理）
                    this.authSettings.user.authCode = '';
                    this.authSettings.admin.adminPassword = '';
                    this.authSettings.user.confirmNewUserPassword = '';
                    this.authSettings.admin.confirmNewAdminPassword = '';
                    this.oriUserPassword = '';
                    this.oriAdminPassword = '';
                    this.markSettingsSaved();
                });
            });
        }).catch(() => {
            this.$message.error(this.$t('floatingSave.failed'));
        }).finally(() => {
            this.saving = false;
        });
    }
},
mounted() {
    // 注意：这里曾出现「两个 mounted()」（对象字面量重复键 → 后者覆盖前者），
    // 导致加载配置的 mounted 从未执行，页面永远停在 v-loading 转圈。
    // 现在合并为一个：先挂 resize 监听，再加载配置。
    window.addEventListener('resize', this.handleWindowResize);
    this.loading = true;
    // v2.6.0 #301：qqwry.dat 数据包状态
    this.fetchIpQueryDatStatus();
    // 获取上传设置
    Promise.all([
        fetchWithAuth('/api/manage/sysConfig/security').then((response) => response.json()),
        // 对外 WebDAV 的配置存在 others 分区，一并取回（保存时整段回写）
        fetchWithAuth('/api/manage/sysConfig/others').then((response) => response.json()).catch(() => null)
    ]).then(async ([data, others]) => {
        this.authSettings = data.auth;
        this.uploadSettings = this.normalizeIpQuerySettings(data.upload);
        this.accessSettings = {
            imageTransformEnabled: false,
            imageTransformAllowedSizes: '',
            ...data.access
        };

        // 对外 WebDAV（原「其他设置」页区块）：老存档可能没有该段，补默认值
        this.othersSnapshot = others && typeof others === 'object' ? others : null;
        const webdav = this.othersSnapshot?.webdav || {};
        this.webdavSettings = {
            enabled: webdav.enabled === true,
            rootPath: String(webdav.rootPath || ''),
            readonly: webdav.readonly === true
        };

        // 密码从后端返回为空（安全考虑），记录原始空值
        this.oriUserPassword = '';
        this.oriAdminPassword = '';
        this.authSettings.user.confirmNewUserPassword = '';
        this.authSettings.admin.confirmNewAdminPassword = '';
        // 发信邮箱（脱敏读取）必须在 markSettingsSaved 之前完成，
        // 否则刚加载完就被判定为「有未保存修改」，悬浮保存按钮会一直亮着。
        await this.loadMailConfig();
        await this.$nextTick();
        this.markSettingsSaved();
        
        // 加载API Token列表
        this.loadApiTokens();
        // 注：Token 的「默认存储渠道 / 默认备份渠道」下拉已改为通用 <ChannelSelect>，
        // 渠道列表由该组件内部按会话缓存拉取，这里不再需要单独预取。
    })
    .catch(() => {
        // 配置加载失败也要结束 loading，否则页面一直转圈无法操作
        this.$message.error(this.$t('floatingSave.failed'));
    })
    .finally(() => {
        this.loading = false;
    });
},
beforeUnmount() {
    window.removeEventListener('resize', this.handleWindowResize);
}
};
</script>

<style scoped>
.security-settings {
    min-height: 500px;
}

.first-settings {
    margin-bottom: 40px;
}

.first-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 2px solid var(--el-color-primary-light-7);
}

.second-title {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: start;
    margin-left: 0;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--el-border-color-lighter);
}

/* 对外 WebDAV 统一说明（账号来源 / 渠道来源 / 不受类型与大小限制） *//* WebDAV 统一说明：已并入上方表单框内，不再自带背景 / 边框（否则视觉上多一层框） */
.webdav-note {
    width: 100%;
    font-size: 13px;
    line-height: 1.75;
    color: var(--el-text-color-secondary);
}

/* 表单样式 - 上下排列左对齐(对齐系统状态卡片风格,无 hover 动效) */
.first-settings :deep(.el-form) {
    padding: 20px 24px;
    background-color: var(--glass-bg) !important;
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border-radius: 16px;
    border: 1px solid var(--glass-border);
    margin-bottom: 20px;
    box-shadow: var(--glass-shadow);
}

.first-settings :deep(.el-form-item) {
    margin-bottom: 20px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
}

.first-settings :deep(.el-form-item:last-child) {
    margin-bottom: 0;
}

.first-settings :deep(.el-form-item__label) {
    text-align: left;
    padding-bottom: 8px;
    font-weight: 500;
    color: var(--el-text-color-primary);
    width: auto !important;
    display: flex;
    align-items: center;
    gap: 5px;
}

.first-settings :deep(.el-form-item__content) {
    width: 100%;
    max-width: 400px;
    margin-left: 0 !important;
}

.first-settings :deep(.el-input) {
    width: 100%;
}

.first-settings :deep(.el-select) {
    width: 100%;
}

.first-settings :deep(.el-switch) {
    --el-switch-on-color: var(--el-color-primary);
}

.form-item-hint {
    display: inline-block;
    margin-left: 8px;
    font-size: 14px;
    color: var(--el-text-color-regular);
    line-height: 32px;
    vertical-align: middle;
}

.query-param-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
}

/* v2.6.0 #301：qqwry.dat 上传与状态 */
.ipquery-dat-box {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}

.ipquery-dat-status {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.ipquery-dat-missing {
    color: var(--el-color-warning);
}

.query-param-row {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(160px, 1.4fr) auto;
    gap: 8px;
    align-items: center;
    width: 100%;
}

.response-field-row {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) auto auto auto;
    gap: 4px;
    align-items: center;
    width: 100%;
}

.response-field-row :deep(.el-button + .el-button) {
    margin-left: 0;
}

.token-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.token-actions {
    margin-left: 5px;
}

.token-table-container {
    display: flex;
    justify-content: center;
    margin-top: 20px;
    width: 100%;
    /* 关键：移动端媒体查询里加了左右 padding，content-box 会让整块宽出 2×padding，
       表现为「右侧留白比左侧小、表格整体偏右」。锁成 border-box 后左右严格对称。 */
    box-sizing: border-box;
    overflow: hidden;
}

.token-table {
    width: 100%;
    /* v2.8.7b：背景改为毛玻璃卡片（var(--glass-bg) + blur），与上下模块（邮箱配置等 el-form 卡片）观感一致 */
    border-radius: 16px !important;
    overflow: hidden;
    box-shadow: var(--glass-shadow);
    background-color: var(--glass-bg) !important;
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border: 1px solid var(--glass-border);
}

.token-table :deep(.el-table__header-wrapper) {
    border-radius: 16px 16px 0 0;
}

.token-table :deep(.el-table__body-wrapper) {
    border-radius: 0 0 16px 16px;
    background: transparent;
}

.token-table :deep(.el-table) {
    border-radius: 16px;
    background: transparent;
}

.token-table :deep(.el-table__header) {
    background-color: color-mix(in srgb, var(--el-text-color-primary) 4%, transparent);
}

.token-table :deep(.el-table th) {
    background-color: color-mix(in srgb, var(--el-text-color-primary) 4%, transparent) !important;
    border-bottom: 1px solid var(--glass-border);
    text-align: center;
}

.token-table :deep(.el-table td) {
    background-color: transparent !important;
    border-bottom: 1px solid var(--glass-border);
}
html.dark .token-table :deep(.el-table th) {
    background-color: color-mix(in srgb, var(--el-text-color-primary) 5%, transparent) !important;
}
html.dark .token-table :deep(.el-table td) {
    border-bottom: 1px solid var(--glass-border);
}

.token-table :deep(.el-table__row:hover td) {
    background-color: color-mix(in srgb, var(--el-text-color-primary) 3%, transparent) !important;
}
html.dark .token-table :deep(.el-table__row:hover td) {
    background-color: color-mix(in srgb, var(--el-text-color-primary) 5%, transparent) !important;
}

.token-table :deep(.el-table__row:last-child td) {
    border-bottom: none;
}

.table-cell-content {
    display: flex;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 4px;
    min-height: 40px;
    text-align: center;
}

.action-buttons {
    gap: 8px;
}

.action-button {
    margin-left: 0;
}

.permission-tag {
    margin: 2px !important;
}

.token-display {
    font-family: 'Courier New', monospace;
    background-color: var(--text-bg-color);
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 12px;
    word-break: break-all;
    text-align: center;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* 响应式布局 */
@media (max-width: 768px) {
    .first-settings :deep(.el-form) {
        padding: 12px 15px;
    }
    
    .first-settings :deep(.el-form-item__content) {
        max-width: 100%;
    }

    .query-param-row {
        grid-template-columns: 1fr;
    }

    .response-field-row {
        grid-template-columns: 1fr auto auto auto;
    }
    
    .token-table-container {
        /* v2.7.0：与下方「对外 WebDAV」模块左右边距一致（去掉额外 padding） */
        padding: 0;
    }
    
    .table-cell-content {
        padding: 6px 2px;
        min-height: 36px;
    }
    
    .token-display {
        font-size: 11px;
        padding: 3px 6px;
    }
}

@media (max-width: 480px) {
    .token-table-container {
        padding: 0;
    }
    
    .table-cell-content {
        padding: 4px 2px;
        min-height: 32px;
        font-size: 12px;
    }
    
    .action-buttons .el-button {
        padding: 4px 8px;
        font-size: 12px;
    }
    
    .permission-tag {
        font-size: 11px;
        padding: 0 4px;
        height: 20px;
        line-height: 20px;
    }
}

.token-result {
    padding: 10px 0;
}

.token-result .el-form-item {
    margin-bottom: 14px;
}

/* 创建成功 / 接入信息弹窗里的提示行 */
.token-result-tip {
    margin: 0 0 14px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--primary-color-accent, var(--el-color-primary));
    background: color-mix(in srgb, var(--primary-color, #2563EB) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--primary-color, #2563EB) 24%, transparent);
}
.token-result-tip--muted {
    margin-top: 12px;
    color: var(--el-text-color-secondary);
    background: color-mix(in srgb, var(--el-text-color-primary) 4%, transparent);
    border-color: var(--glass-border, rgba(128, 128, 128, 0.22));
}

/* ---- Token 类型选择 ---- */
.token-type-group {
    display: flex;
    gap: 8px;
}
.token-type-icon {
    margin-right: 6px;
}
.token-type-desc {
    margin-top: 6px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
}

/* ---- 默认上传参数（多行输入，铺满表单） ---- */
.token-defaults {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
}
/* 渠道下拉：左侧固定标签 + 右侧选择器，与「其他设置 → 对外 WebDAV」的渠道选择保持一致的观感 */
.token-default-field {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
}
.token-default-label {
    flex: 0 0 84px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.token-defaults-tip {
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
}
/* 「类型和大小限制」：开关 + 说明文字同一行，说明作为 tooltip 触发器 */
.token-limit-field {
    display: flex;
    align-items: center;
    gap: 10px;
}
.token-limit-tip {
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
    cursor: help;
    border-bottom: 1px dashed var(--el-border-color);
}
.token-defaults :deep(.el-input-group__prepend) {
    padding: 0 8px;
    font-size: 12px;
    white-space: nowrap;
}
/* v3.0.0（R18）默认分类目录的占位符提示：一行小字 + 可点击的 code 片段 */
.token-folder-tip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    line-height: 1.4;
}
.token-folder-tip-label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.token-folder-chip {
    padding: 1px 6px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 4px;
    background: var(--el-fill-color-lighter);
    color: var(--el-color-primary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    cursor: pointer;
    user-select: none;
    transition: border-color 0.16s ease, background-color 0.16s ease;
}
.token-folder-chip:hover {
    border-color: var(--el-color-primary-light-5);
    background: var(--el-color-primary-light-9);
}

/* ---- 列表里的凭据单元格 + 行内复制 ---- */
.token-cell {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}
.token-cell .token-display {
    /* flex-basis 固定为 0：打码值 / 明文值长度不同也不会改变这一格的宽度，
       点小眼睛前后输入框（凭据框）宽度完全一致，右侧两个按钮不会左右跳。 */
    flex: 1 1 0;
    width: 0;
    min-width: 0;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    word-break: normal;
}
.inline-copy-btn {
    flex: 0 0 auto;
    padding: 2px 6px;
    height: auto;
}

.dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
}

/* 确认密码框的动画效果 */
.fade-slide-enter-active, .fade-slide-leave-active {
    transition: all 0.3s ease-in-out;
}

.fade-slide-enter-from {
    opacity: 0;
    transform: translateY(-10px);
}

.fade-slide-leave-to {
    opacity: 0;
    transform: translateY(-10px);
}

.fade-slide-enter-to, .fade-slide-leave-from {
    opacity: 1;
    transform: translateY(0);
}

:deep(.el-dialog) {
    border-radius: 12px;
    background-color: var(--dialog-bg-color);
    border: 1px solid var(--glass-border);
    box-shadow: var(--dialog-box-shadow);
}

/* ===== 发信邮箱（v2.3.0） ===== */
.mail-title {
    flex-wrap: wrap;
}

.mail-status-tag {
    margin-left: auto;
    font-weight: 400;
}

.mail-form {
    max-width: 720px;
}

.mail-port {
    width: 140px;
}

.mail-hint {
    margin-left: 10px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    line-height: 1.5;
}

.mail-hint.block {
    display: block;
    margin: 4px 0 0;
}

.mail-test-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    width: 100%;
}

.mail-test-row .el-input {
    max-width: 260px;
}

/* 白名单未开启时，「放行域名」整体降权（仍然可编辑，但明确它当前不生效） */
.is-muted {
    opacity: 0.55;
}

@media (max-width: 768px) {
    .mail-status-tag {
        margin-left: 0;
    }

    .mail-test-row .el-input {
        max-width: 100%;
        width: 100%;
    }
}
</style>
