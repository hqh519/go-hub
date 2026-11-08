<template>
  <div class="container">
    <AdminHeader active-tab="customerConfig" />
    <div class="main-container edit-page">
      <div class="page-head">
        <el-button link class="back-btn" @click="goBack">
          <font-awesome-icon icon="arrow-left" class="back-icon" />{{ $t('userEdit.back') }}
        </el-button>
        <span class="page-title">{{ $t('userEdit.title') }}</span>
        <el-tag v-if="!isSelf" size="small" type="warning">{{ $t('userEdit.adminEditing') }}</el-tag>
      </div>

      <div v-loading="loading">
        <!-- ================= 基本信息 ================= -->
        <el-card shadow="never" class="edit-card">
          <template #header><span class="card-title">{{ $t('userEdit.basic') }}</span></template>

          <div class="avatar-row">
            <div class="avatar-preview">
              <img v-if="avatarSrc" :src="avatarSrc" :alt="form.username" />
              <span v-else class="avatar-fallback">{{ avatarInitial }}</span>
            </div>
            <div class="avatar-actions">
              <el-button size="small" :loading="avatarUploading" @click="pickAvatar">
                {{ avatarSrc ? $t('userEdit.changeAvatar') : $t('userEdit.uploadAvatar') }}
              </el-button>
              <el-button v-if="avatarSrc" size="small" text type="danger" @click="removeAvatar">
                {{ $t('userEdit.removeAvatar') }}
              </el-button>
              <p class="hint">{{ $t('userEdit.avatarHint') }}</p>
            </div>
            <input ref="avatarInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden-input" @change="onAvatarPicked" />
          </div>

          <el-form :model="form" label-position="top" class="edit-form">
            <!--
              v3.0.0（R16）：账户自定义背景图 —— 紧贴头像下方一行两个输入框。
              格式 `["图片地址1","图片地址2"]`，可填多张，每次刷新随机取一张；
              留空 = 跟随「系统管理 → 网页设置」里的同名背景图。
            -->
            <div class="bkimg-row">
              <el-form-item :label="$t('userEdit.uploadBkImg')" class="bkimg-item">
                <el-input
                  v-model="form.uploadBkImg"
                  type="textarea"
                  :rows="2"
                  maxlength="4000"
                  :placeholder="bkImgPlaceholder"
                  class="bkimg-input"
                />
              </el-form-item>
              <el-form-item :label="$t('userEdit.adminBkImg')" class="bkimg-item">
                <el-input
                  v-model="form.adminBkImg"
                  type="textarea"
                  :rows="2"
                  maxlength="4000"
                  :placeholder="bkImgPlaceholder"
                  class="bkimg-input"
                />
              </el-form-item>
            </div>
            <p class="hint bkimg-hint">{{ $t('userEdit.bkImgHint') }}</p>

            <el-form-item :label="$t('userManage.username')">
              <el-input v-model="form.username" maxlength="32" :placeholder="$t('userManage.usernamePlaceholder')" />
              <p class="hint">{{ $t('userEdit.usernameHint') }}</p>
            </el-form-item>
            <el-form-item :label="$t('userManage.nickname')">
              <el-input v-model="form.nickname" maxlength="60" :placeholder="$t('userManage.nicknamePlaceholder')" />
            </el-form-item>
            <el-form-item :label="$t('userEdit.email')">
              <div class="email-row">
                <el-input
                  v-model="form.email"
                  maxlength="120"
                  :disabled="emailVerified"
                  :placeholder="$t('userEdit.emailPlaceholder')"
                  class="email-input"
                />
                <el-tag v-if="emailVerified" size="small" type="success" effect="plain" class="email-tag">
                  <font-awesome-icon icon="check" class="email-tag-icon" />{{ $t('userEdit.emailVerified') }}
                </el-tag>
                <!-- 未验证 → 发码验证；已验证 → 只允许先「更换邮箱」再重新验证 -->
                <el-tooltip v-if="!emailVerified" :disabled="mailReady" :content="$t('userEdit.mailNotReady')" placement="top">
                  <span>
                    <el-button
                      size="small"
                      type="primary"
                      plain
                      :loading="emailBusy"
                      :disabled="!mailReady"
                      @click="openEmailVerify"
                    >{{ $t('userEdit.verifyEmail') }}</el-button>
                  </span>
                </el-tooltip>
                <el-button v-else size="small" text type="warning" @click="resetEmailVerified">
                  {{ $t('userEdit.changeEmail') }}
                </el-button>
              </div>
              <p class="hint">{{ emailVerified ? $t('userEdit.emailVerifiedHint') : $t('userEdit.emailVerifyHint') }}</p>
            </el-form-item>
            <el-form-item :label="$t('userEdit.password')">
              <el-input v-model="form.password" type="password" show-password :placeholder="$t('userEdit.passwordPlaceholder')" />
            </el-form-item>
            <!--
              v2.6.0：修改密码必须验证身份
              · 本人 → 原密码 / 邮箱验证码 / 2FA 动态码 三选一
              · 管理员改他人 → 输入管理员自己的密码
            -->
            <el-form-item v-if="form.password" :label="$t('userEdit.pwdVerifyLabel')">
              <template v-if="isAdminRole && !isSelf">
                <el-input
                  v-model="adminPassword"
                  type="password"
                  show-password
                  :placeholder="$t('userEdit.adminPasswordPlaceholder')"
                  class="pwd-verify-input"
                />
                <p class="hint">{{ $t('userEdit.adminPasswordHint') }}</p>
              </template>
              <template v-else>
                <!--
                  v3.0.0（R12）：原来「原密码 / 邮箱验证 / 两步验证」是三个单选 + 各自输入框，
                  现在合并为**一个输入框** —— 后端会自动识别填的是哪一种凭据：
                    · 与当前密码一致 → 按原密码通过；
                    · 6 位数字且邮箱已验证 → 按邮箱验证码校验；
                    · 6 位数字且已启用两步验证 → 按 2FA 动态码校验。
                  邮箱验证码仍需先点右侧「发送验证码」，按钮只在该账户已验证邮箱时出现。
                -->
                <div class="code-row pwd-verify-row">
                  <el-input
                    v-model="pwdVerifyCode"
                    :placeholder="$t('userEdit.pwdVerifyMergedPlaceholder')"
                    clearable
                    class="pwd-verify-input"
                    @keyup.enter="save"
                  />
                  <el-button
                    v-if="detail.emailVerified"
                    size="small"
                    :loading="pwdEmailBusy"
                    :disabled="!mailReady"
                    @click="sendPwdChangeCode"
                  >{{ $t('userEdit.pwdSendCode') }}</el-button>
                </div>
                <p class="hint">{{ $t('userEdit.pwdVerifyHint') }}</p>
              </template>
            </el-form-item>
          </el-form>
        </el-card>

        <!-- ================= 会话有效期 ================= -->
        <el-card shadow="never" class="edit-card">
          <template #header><span class="card-title">{{ $t('userEdit.session') }}</span></template>
          <el-form label-position="top" class="edit-form">
            <el-form-item :label="$t('userEdit.frontSession')">
              <el-input-number v-model="form.frontSessionDays" :min="0" :max="3650" :step="1" controls-position="right" class="num-input" />
              <span class="unit">{{ $t('userEdit.days') }}</span>
              <p class="hint">{{ $t('userEdit.frontSessionHint') }}</p>
            </el-form-item>
            <el-form-item :label="$t('userEdit.backSession')">
              <el-input-number v-model="form.backSessionDays" :min="0" :max="3650" :step="1" controls-position="right" class="num-input" />
              <span class="unit">{{ $t('userEdit.days') }}</span>
              <p class="hint">{{ $t('userEdit.backSessionHint') }}</p>
            </el-form-item>
          </el-form>
        </el-card>

        <!-- ================= 两步验证 ================= -->
        <el-card shadow="never" class="edit-card">
          <template #header>
            <span class="card-title">{{ $t('userEdit.totp') }}</span>
            <el-tag size="small" :type="detail.totpEnabled ? 'success' : 'info'" class="card-tag">
              {{ detail.totpEnabled ? $t('userEdit.totpOn') : $t('userEdit.totpOff') }}
            </el-tag>
            <el-tag
              v-if="detail.totpEnabled && recoveryCount"
              size="small"
              type="warning"
              effect="plain"
              class="card-tag"
            >{{ $t('userEdit.recoveryLeft', { count: recoveryCount }) }}</el-tag>
          </template>

          <div v-if="!detail.totpEnabled">
            <p class="hint block">{{ $t('userEdit.totpHint') }}</p>
            <!-- 未验证邮箱不允许启用：邮箱是「验证器丢失」时唯一的自助找回通道 -->
            <el-alert
              v-if="!emailVerified"
              :title="$t('userEdit.totpNeedEmail')"
              type="warning"
              :closable="false"
              show-icon
              class="totp-alert"
            />
            <el-button
              v-if="!totpSetupData"
              type="primary"
              plain
              size="small"
              :loading="totpBusy"
              :disabled="!emailVerified"
              @click="startTotpSetup"
            >{{ $t('userEdit.totpEnable') }}</el-button>
            <div v-else class="totp-setup">
              <div class="totp-qr">
                <QRCodeBox :value="totpSetupData.uri" :size="190" />
              </div>
              <div class="totp-steps">
                <p>{{ $t('userEdit.totpStep1') }}</p>
                <p class="secret-line">
                  <span class="secret-label">{{ $t('userEdit.totpSecret') }}</span>
                  <code>{{ totpSetupData.secret }}</code>
                </p>
                <p>{{ $t('userEdit.totpStep2') }}</p>
                <div class="code-row">
                  <el-input v-model="totpCode" maxlength="6" placeholder="000000" class="code-input" @keyup.enter="enableTotp" />
                  <el-button type="primary" :loading="totpBusy" @click="enableTotp">{{ $t('userEdit.totpConfirm') }}</el-button>
                  <el-button text @click="cancelTotpSetup">{{ $t('common.cancel') }}</el-button>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="totp-on-box">
            <p class="hint block">{{ $t('userEdit.totpEnabledHint') }}</p>
            <div class="code-row">
              <el-input v-model="totpCode" maxlength="6" placeholder="000000" class="code-input" />
              <el-button type="danger" plain :loading="totpBusy" @click="disableTotp">{{ $t('userEdit.totpDisable') }}</el-button>
              <el-button link type="primary" size="small" @click="regenerateRecovery">
                {{ $t('userEdit.regenRecovery') }}
              </el-button>
            </div>

            <!-- 恢复码：库里只存摘要，明文只在启用 / 重新生成时显示一次 -->
            <div class="forgot-box">
              <div class="forgot-head">
                <span class="forgot-title">{{ $t('userEdit.forgotTotp') }}</span>
                <span class="hint">{{ $t('userEdit.forgotTotpHint') }}</span>
              </div>
              <div class="code-row">
                <el-button size="small" :loading="disableBusy" @click="sendDisableCode">
                  {{ $t('userEdit.sendDisableCode') }}
                </el-button>
                <!-- v2.6.0：验证码为 6 位字母数字（不区分大小写），验证码/恢复码二选一 -->
                <el-input v-model="disableEmailCode" maxlength="6" :placeholder="$t('userEdit.emailCodePlaceholder')" class="code-input" />
                <el-input v-model="disableRecoveryCode" :placeholder="$t('userEdit.recoveryPlaceholder')" class="recovery-input" />
                <el-button type="danger" plain size="small" :loading="disableBusy" @click="disableTotpByFallback">
                  {{ $t('userEdit.totpDisable') }}
                </el-button>
              </div>
            </div>
          </div>
        </el-card>

        <!-- ================= 存储渠道（本人也能改，仅限已授权渠道）================= -->
        <el-card shadow="never" class="edit-card">
          <template #header><span class="card-title">{{ $t('userEdit.channels') }}</span></template>
          <el-form label-position="top" class="edit-form channel-form">
            <el-form-item :label="$t('userManage.mainChannel')">
              <el-select v-model="mainChannelModel" class="full-width">
                <!-- 首位「默认(跟随全局)」：清空该账户的个人设置，回到系统主渠道 -->
                <el-option :label="$t('userEdit.channelFollowGlobal')" value="__default__" />
                <el-option v-for="c in channelOptions" :key="c.id" :label="`${c.code} · ${c.name}`" :value="c.id" />
              </el-select>
              <p class="hint">{{ $t('userEdit.channelHint') }}</p>
            </el-form-item>
            <el-form-item :label="$t('userManage.backupChannel')">
              <el-select v-model="backupChannelModel" class="full-width">
                <el-option :label="$t('userEdit.channelFollowGlobal')" value="__default__" />
                <!-- 第二位「none(不备份)」：明确表示该账户上传的文件不做备份写 -->
                <el-option :label="$t('userEdit.channelNone')" value="none" />
                <el-option v-for="c in channelOptions" :key="c.id" :label="`${c.code} · ${c.name}`" :value="c.id" />
              </el-select>
              <p class="hint">{{ $t('userEdit.backupChannelHint') }}</p>
            </el-form-item>
          </el-form>
        </el-card>

        <!-- ================= 实例管理（v3.0.0：创建 / 加入 / 邀请 / 改名 / 删除） ================= -->
        <!-- v3.0.0：id="instances" 供外部（文件管理 →「实例管理」）以 ?anchor=instances 直接定位本区块 -->
        <el-card
          id="instances"
          shadow="never"
          class="edit-card"
          :class="{ 'is-anchor-highlight': anchorHighlight }"
        >
          <template #header><span class="card-title">{{ $t('userEdit.instanceTitle') }}</span></template>
          <div class="instance-actions">
            <el-button size="small" @click="openJoinInstance">{{ $t('userEdit.instanceJoin') }}</el-button>
            <el-button size="small" type="primary" plain @click="openCreateInstance">{{ $t('userEdit.instanceCreate') }}</el-button>
          </div>
          <el-table v-if="orderedInstances.length" :data="orderedInstances" size="small" class="instance-table">
            <!-- v3.0.0：名称前带创建序号（1-based，用接口下发的 index），整行展示「1 · 工作库」 -->
            <el-table-column :label="$t('userEdit.instanceName')" min-width="180">
              <template #default="{ row }">
                <span class="instance-label">{{ instanceSeq(row) }} · {{ row.name }}</span>
              </template>
            </el-table-column>
            <el-table-column :label="$t('userEdit.instanceCreatedAt')" min-width="150">
              <template #default="{ row }">{{ formatInstanceTime(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column :label="$t('userEdit.instanceMembers')" width="90" align="center">
              <template #default="{ row }">{{ Number(row.memberCount ?? 1) }}</template>
            </el-table-column>
            <el-table-column :label="$t('userEdit.instanceActions')" width="190">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openInviteDialog(row)">{{ $t('userEdit.instanceInvite') }}</el-button>
                <el-button link type="primary" size="small" @click="openRenameInstance(row)">{{ $t('userEdit.instanceRename') }}</el-button>
                <el-button link type="danger" size="small" @click="deleteInstance(row)">{{ $t('userEdit.instanceDelete') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <p v-else class="hint">{{ $t('userEdit.instanceEmpty') }}</p>
          <p class="hint">{{ $t('userEdit.instanceHint') }}</p>
        </el-card>

        <!--
          ================= WebDAV 管理（v1.0.6） =================
          出现条件（两个都要满足）：
            · 「系统管理 → 安全设置 → 对外 WebDAV」的全局开关是开的；
            · 管理员在下方「管理员操作」里给该账户开了「启用 WebDAV 功能」。
          管理员账户永远看不到本模块（后端也禁止管理员使用 WebDAV）。
        -->
        <el-card v-if="isPlainUserAccount" id="webdav" shadow="never" class="edit-card">
          <template #header>
            <span class="card-title">{{ $t('userEdit.webdavTitle') }}</span>
            <el-tag size="small" type="info" class="card-tag">
              {{ $t('userEdit.webdavQuota', { n: webdavChannels.length, max: webdavMax }) }}
            </el-tag>
          </template>
          <!--
              v1.0.7：把「为什么模块/功能用不了」直接写在卡片里。
              之前卡片靠三层条件（普通用户 + 全局开关 + 本账户授权）同时为真才渲染，
              任何一层不满足都整卡消失，管理员只能猜。
              现在卡片恒显示，缺哪一层就提示哪一层。
          -->
          <!--
              v1.0.8：「缺哪一层」的提示**只给管理员看**。
              普通用户进自己的账户页时，系统开关状态与他无关（也读不到），
              只需知道自己能不能建、能建几个即可，不必看到管理侧的配置提示。
          -->
          <template v-if="!isSelf">
            <p v-if="!webdavGlobalEnabled" class="hint webdav-blocked-hint">
              <font-awesome-icon icon="exclamation-circle" /> {{ $t('userEdit.webdavGlobalOff') }}
            </p>
            <p v-else-if="!form.webdavEnabled" class="hint webdav-blocked-hint">
              <font-awesome-icon icon="exclamation-circle" /> {{ $t('userEdit.webdavAccountOff') }}
            </p>
          </template>
          <div class="instance-actions">
            <el-button size="small" type="primary" plain :disabled="webdavFull || !webdavModuleVisible" @click="openCreateWebdav">
              {{ $t('userEdit.webdavCreate') }}
            </el-button>
            <el-button size="small" @click="copyWebdavMount">
              <font-awesome-icon icon="copy" class="share-btn-icon" />{{ $t('userEdit.webdavMountCopy') }}
            </el-button>
          </div>
          <p class="hint webdav-mount-hint">
            {{ $t('userEdit.webdavMountHint', { address: webdavMountAddress, user: form.username || '—' }) }}
          </p>
          <el-table v-if="webdavChannels.length" :data="webdavChannels" size="small" class="instance-table">
            <el-table-column :label="$t('userEdit.webdavName')" min-width="130">
              <template #default="{ row }">
                <span class="instance-label">{{ row.name }}</span>
              </template>
            </el-table-column>
            <el-table-column :label="$t('userEdit.webdavPath')" min-width="140">
              <template #default="{ row }"><code class="webdav-path">/{{ row.path }}</code></template>
            </el-table-column>
            <el-table-column :label="$t('userEdit.webdavKey')" min-width="175">
              <template #default="{ row }">
                <span class="webdav-key-cell">
                  <code>{{ row.accessKey }}</code>
                  <el-button link size="small" :title="$t('userEdit.webdavCopy')" @click="copyWebdavKey(row)">
                    <font-awesome-icon icon="copy" />
                  </el-button>
                </span>
              </template>
            </el-table-column>
            <el-table-column :label="$t('userEdit.webdavNote')" min-width="110">
              <template #default="{ row }">
                <span :title="row.note || ''">{{ row.note || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column :label="$t('userEdit.instanceActions')" width="215">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openEditWebdav(row)">{{ $t('userEdit.webdavEdit') }}</el-button>
                <el-button link type="primary" size="small" @click="regenWebdavKey(row)">{{ $t('userEdit.webdavKeyRegen') }}</el-button>
                <el-button link type="danger" size="small" @click="deleteWebdav(row)">{{ $t('userEdit.instanceDelete') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <p v-else class="hint">{{ $t('userEdit.webdavEmpty') }}</p>
          <p class="hint">{{ $t('userEdit.webdavHint') }}</p>
        </el-card>

        <!--
          ================= 对外分享（v3.0.0） =================
          · 普通用户视角：只有该账户 shareEnabled === true 才显示本模块（管理员始终可见，便于开启）；
          · 开关直接调用户保存接口（PUT /api/manage/users/:id，payload 带 shareEnabled）；
          · 「查看分享记录」新标签打开 /share-records?username=<该用户名>。
        -->
        <el-card v-if="shareModuleVisible" shadow="never" class="edit-card">
          <template #header>
            <span class="card-title">{{ $t('userEdit.shareTitle') }}</span>
            <el-tag size="small" :type="form.shareEnabled ? 'success' : 'info'" class="card-tag">
              {{ form.shareEnabled ? $t('userEdit.shareOn') : $t('userEdit.shareOff') }}
            </el-tag>
          </template>
          <div class="share-row">
            <span class="switch-item">{{ $t('userEdit.shareEnable') }}<el-switch v-model="form.shareEnabled" :loading="shareSaving" @change="onShareEnabledChange" /></span>
            <el-button size="small" type="primary" plain @click="openShareRecords">
              <font-awesome-icon icon="share-alt" class="share-btn-icon" />{{ $t('userEdit.shareRecordsBtn') }}
            </el-button>
          </div>
          <p class="hint">{{ $t('userEdit.shareHint') }}</p>
        </el-card>

        <!-- ================= 管理员操作（仅管理员；v2.4.0 移到存储渠道之后）================= -->
        <el-card v-if="isAdminRole" shadow="never" class="edit-card">
          <template #header><span class="card-title">{{ $t('userEdit.adminActions') }}</span></template>
          <div class="switch-grid">
            <span class="switch-item">{{ $t('userManage.enabled') }}<el-switch v-model="form.enabled" /></span>
            <span class="switch-item">{{ $t('userManage.canEdit') }}<el-switch v-model="form.canEdit" /></span>
            <span class="switch-item">{{ $t('userManage.canDelete') }}<el-switch v-model="form.canDelete" /></span>
            <span class="switch-item">{{ $t('userManage.linkPermission') }}<el-switch v-model="form.linkEnabled" /></span>
            <!-- v3.0.0：分享权限 —— 开启后该用户可把目录 / 标签对外分享，普通用户的编辑页才会出现「对外分享」模块 -->
            <span class="switch-item">{{ $t('userManage.sharePermission') }}<el-switch v-model="form.shareEnabled" /></span>
            <!-- v2.8.8：「类型和大小限制」开关已移除 —— 上传限制统一由「单文件大小限制」（下方）与后台全局配置决定 -->
          </div>

          <!--
            v2.8.8：账户级上传策略（两项都只对本账户生效，留空/跟随全局时用后台配置）
              · 视频兼容转码：跟随全局 / 禁用 / 启用 / 用户决定
                  「用户决定」= 允许该账户在前台上传设置里自己选，且每次刷新复位为跟随全局
              · 单文件大小限制：留空 = 跟随后台「上传相关配置」里的全局上限
          -->
          <el-form label-position="top" class="edit-form account-policy-form">
            <el-form-item :label="$t('userEdit.transcodePolicy')">
              <el-select v-model="form.transcodePolicy" class="full-width">
                <el-option :label="$t('userEdit.transcodeInherit')" value="inherit" />
                <el-option :label="$t('userEdit.transcodeOff')" value="off" />
                <el-option :label="$t('userEdit.transcodeOn')" value="on" />
                <el-option :label="$t('userEdit.transcodeUser')" value="user" />
              </el-select>
              <p class="hint">{{ $t('userEdit.transcodePolicyHint') }}</p>
            </el-form-item>
            <el-form-item :label="$t('userEdit.maxFileSize')">
              <!-- 0 / 留空 = 跟随全局；输入即生效于该账户的全部上传入口 -->
              <el-input
                v-model.number="form.maxFileSizeMB"
                type="number"
                min="0"
                :placeholder="$t('userEdit.maxFileSizePlaceholder')"
                class="full-width"
              >
                <template #append>MB</template>
              </el-input>
              <p class="hint">{{ $t('userEdit.maxFileSizeHint') }}</p>
            </el-form-item>
          </el-form>
          <!--
            v1.0.6：对外 WebDAV 授权（放在「管理备注」上一行）。
            打开后才在下面展开「允许创建数量」，该账户的「WebDAV 管理」模块才会出现
            （还要求「系统管理 → 安全设置 → 对外 WebDAV」的全局开关是开的）。
            管理员账户一律不可用 —— 需求约定 WebDAV 只能通过普通用户启用。
          -->
          <div class="webdav-enable-block">
            <div class="webdav-enable-row">
              <span class="switch-item">{{ $t('userEdit.webdavEnable') }}<el-switch v-model="form.webdavEnabled" :disabled="!isPlainUserAccount" /></span>
              <span v-if="!isPlainUserAccount" class="hint inline">{{ $t('userEdit.webdavAdminBlocked') }}</span>
            </div>
            <div v-if="form.webdavEnabled && isPlainUserAccount" class="webdav-max-row">
              <span class="admin-note-label">{{ $t('userEdit.webdavMaxLabel') }}</span>
              <el-input-number v-model="form.webdavMax" :min="1" :max="50" :step="1" size="small" />
              <span class="hint inline">{{ $t('userEdit.webdavMaxHint') }}</span>
            </div>
          </div>
          <!-- v2.4.0：管理备注输入框换到名称下一行（不再与标签同行） -->
          <div class="admin-note-block">
            <span class="admin-note-label">{{ $t('userManage.adminNote') }}</span>
            <el-input v-model="form.adminNote" type="textarea" :rows="3" maxlength="4000" show-word-limit :placeholder="$t('userManage.adminNotePlaceholder')" />
            <p class="hint">{{ $t('userManage.adminNoteHint') }}</p>
          </div>
        </el-card>

      </div>
    </div>

    <!--
      v1.0.0：保存入口改为右下角悬浮按钮，与「系统管理 → 网页设置」(/systemConfig#page) 完全一致
      （同一个 FloatingSaveButton 组件，桌面端与移动端样式自动统一）。
      原来底部那条 .save-bar（取消 + 保存）整体去掉 —— 取消/返回走页头左上角的「返回」按钮。
    -->
    <FloatingSaveButton :show="!loading" :loading="saving" @click="save" />

    <AvatarCropper
      v-model="showCropper"
      :file="cropFile"
      :size="256"
      :title="$t('userEdit.cropTitle')"
      :hint="$t('userEdit.cropHint')"
      @done="uploadCroppedAvatar"
    />

    <!-- 邮箱验证：发送验证码 → 回填校验 → 通过后锁定邮箱 -->
    <el-dialog v-model="showEmailDialog" :title="$t('userEdit.verifyEmail')" :width="dialogWidth" append-to-body>
      <p class="hint block">{{ $t('userEdit.emailCodeSentTo', { email: pendingEmail }) }}</p>
      <div class="code-row">
        <el-input v-model="emailCode" maxlength="6" placeholder="000000" class="code-input" @keyup.enter="verifyEmail" />
        <el-button type="primary" :loading="emailBusy" @click="verifyEmail">{{ $t('userEdit.verifyEmailOk') }}</el-button>
      </div>
      <div class="resend-row">
        <el-button link size="small" :disabled="resendLeft > 0 || emailBusy" @click="sendEmailCode">
          {{ resendLeft > 0 ? $t('userEdit.resendIn', { count: resendLeft }) : $t('userEdit.resendCode') }}
        </el-button>
      </div>
      <template #footer>
        <el-button @click="showEmailDialog = false">{{ $t('common.cancel') }}</el-button>
      </template>
    </el-dialog>

    <!-- v3.0.0：创建实例 -->
    <el-dialog v-model="showCreateInstance" :title="$t('userEdit.instanceCreate')" :width="dialogWidth" append-to-body>
      <el-form label-position="top">
        <el-form-item :label="$t('userEdit.instanceName')" required>
          <el-input v-model="newInstance.name" maxlength="32" :placeholder="$t('userEdit.instanceNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('userEdit.instanceNote')">
          <el-input v-model="newInstance.note" type="textarea" :rows="2" maxlength="200" :placeholder="$t('userEdit.instanceNotePlaceholder')" />
          <p class="hint">{{ $t('userEdit.instanceNoteHint') }}</p>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateInstance = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="instanceBusy" @click="createInstance">{{ $t('common.confirm') }}</el-button>
      </template>
    </el-dialog>

    <!-- v1.0.6：创建 / 编辑 WebDAV 渠道 -->
    <el-dialog
      v-model="showWebdavDialog"
      :title="webdavEditing ? $t('userEdit.webdavEditTitle') : $t('userEdit.webdavCreate')"
      :width="dialogWidth"
      append-to-body
    >
      <el-form label-position="top" @submit.prevent>
        <el-form-item :label="$t('userEdit.webdavName')" required>
          <el-input v-model="webdavForm.name" maxlength="32" :placeholder="$t('userEdit.webdavNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('userEdit.webdavPath')" :required="!webdavEditing">
          <el-input v-model="webdavForm.path" :disabled="webdavEditing" :placeholder="$t('userEdit.webdavPathPlaceholder')" />
          <p class="hint">{{ webdavEditing ? $t('userEdit.webdavPathLocked') : $t('userEdit.webdavPathHint') }}</p>
        </el-form-item>
        <!-- 访问密钥：新建时自动生成 16 位随机串（可改可重生成）；建好后只能「重新生成」，不再手改 -->
        <el-form-item :label="$t('userEdit.webdavKey')" :required="!webdavEditing">
          <div class="webdav-key-row">
            <el-input v-model="webdavForm.accessKey" :disabled="webdavEditing" maxlength="64" />
            <el-button v-if="!webdavEditing" size="small" @click="regenWebdavFormKey">{{ $t('userEdit.webdavKeyRegen') }}</el-button>
          </div>
          <p class="hint">{{ $t('userEdit.webdavKeyHint') }}</p>
        </el-form-item>
        <el-form-item :label="$t('userEdit.webdavNote')">
          <el-input v-model="webdavForm.note" type="textarea" :rows="2" maxlength="200" :placeholder="$t('userEdit.webdavNotePlaceholder')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showWebdavDialog = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="webdavBusy" @click="saveWebdav">{{ $t('common.confirm') }}</el-button>
      </template>
    </el-dialog>

    <!-- v3.0.0：加入实例（用户名 + 8 位邀请码 双验证） -->
    <el-dialog v-model="showJoinInstance" :title="$t('userEdit.instanceJoin')" :width="dialogWidth" append-to-body>
      <el-form label-position="top" @submit.prevent>
        <el-form-item :label="$t('userEdit.joinUsername')" required>
          <el-input
            v-model="joinUsername"
            maxlength="32"
            :placeholder="$t('userEdit.joinUsernamePlaceholder')"
            @keyup.enter="joinInstance"
          />
        </el-form-item>
        <el-form-item :label="$t('userEdit.joinCodePlaceholder')" required>
          <el-input
            v-model="joinCode"
            maxlength="8"
            :placeholder="$t('userEdit.joinCodePlaceholder')"
            @keyup.enter="joinInstance"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showJoinInstance = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="instanceBusy" @click="joinInstance">{{ $t('common.confirm') }}</el-button>
      </template>
    </el-dialog>

    <!-- v3.0.0：邀请管理（生成 / 复制邀请码、关闭邀请）
         v3.0.0（第三轮）：打开只回显已有邀请码，必须点「生成邀请码」才生成；
         邀请码生成后长期有效，直到「关闭邀请」或再次「重新生成」 -->
    <el-dialog v-model="showInviteDialog" :title="$t('userEdit.inviteTitle', { name: inviteTarget?.name || '' })" :width="dialogWidth" append-to-body>
      <div class="invite-box">
        <p class="hint block">{{ $t('userEdit.inviteHint') }}</p>
        <div class="code-row">
          <code class="invite-code">{{ inviteCode || $t('userEdit.inviteNotGenerated') }}</code>
          <el-button size="small" :disabled="!inviteCode" @click="copyInviteCode">{{ $t('userEdit.inviteCopy') }}</el-button>
          <el-button size="small" type="primary" plain :loading="instanceBusy" @click="regenerateInvite">
            {{ inviteCode ? $t('userEdit.inviteRegen') : $t('userEdit.inviteGenerate') }}
          </el-button>
          <el-button size="small" type="danger" plain :disabled="!inviteCode" :loading="instanceBusy" @click="closeInvite">{{ $t('userEdit.inviteClose') }}</el-button>
        </div>
      </div>
      <template #footer>
        <el-button @click="showInviteDialog = false">{{ $t('common.close') }}</el-button>
      </template>
    </el-dialog>

    <!-- 恢复码：只在启用 / 重新生成后显示这一次，库里只留摘要 -->
    <el-dialog v-model="showRecoveryDialog" :title="$t('userEdit.recoveryTitle')" :width="dialogWidth" append-to-body>
      <el-alert :title="$t('userEdit.recoveryOnce')" type="warning" :closable="false" show-icon class="recovery-alert" />
      <div class="recovery-grid">
        <code v-for="code in recoveryCodes" :key="code">{{ code }}</code>
      </div>
      <template #footer>
        <!-- v2.6.0：「我已保存」改为「复制全部」—— 一键复制所有恢复码并关闭窗口 -->
        <el-button type="primary" @click="copyRecoveryCodes">{{ $t('userEdit.recoveryCopyAll') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import axios from '@/utils/axios';
import AdminHeader from '@/components/dashboard/AdminHeader.vue';
import AvatarCropper from '@/components/user/AvatarCropper.vue';
import QRCodeBox from '@/components/common/QRCodeBox.vue';
import FloatingSaveButton from '@/components/FloatingSaveButton.vue';
import backgroundManager from '@/mixins/backgroundManager';
import { copyText } from '@/utils/clipboard';

/**
 * 用户编辑独立页（v202610221824）。
 *
 * 为什么从弹窗改成页面：这里要放用户名/邮箱/头像裁剪/两步验证/会话有效期/
 * 渠道授权/管理备注/用户公告等一大批设置项，弹窗已经装不下也看不清层级。
 *
 * 权限：管理员可编辑任意账户；普通用户进来只能编辑自己这一条，
 * 「权限 / 渠道 / 管理备注 / 用户公告」卡片对普通用户整体隐藏（后端同样会拒绝）。
 */
export default {
    name: 'UserEditPage',
    mixins: [backgroundManager],
    components: { AdminHeader, AvatarCropper, QRCodeBox, FloatingSaveButton },
    data() {
        return {
            loading: false,
            saving: false,
            userId: '',
            detail: {},
            form: {
                username: '',
                nickname: '',
                email: '',
                password: '',
                frontSessionDays: 7,
                backSessionDays: 7,
                enabled: true,
                canEdit: true,
                canDelete: true,
                linkEnabled: true,
                enforceLimits: true,
                // v2.8.8：账户级上传策略
                transcodePolicy: 'inherit',
                maxFileSizeMB: 0,
                mainChannelId: '',
                backupChannelId: '',
                adminNote: '',
                // v3.0.0：对外分享权限（后端 User.shareEnabled，缺省 false）
                shareEnabled: false,
                // v3.0.0（R16）：账户自定义背景图（JSON 数组字符串，空串 = 跟随系统设置）
                uploadBkImg: '',
                adminBkImg: '',
                // v1.0.6：对外 WebDAV 授权（管理员操作 → 启用 WebDAV 功能 / 允许创建数量）
                webdavEnabled: false,
                webdavMax: 2,
            },
            channelOptions: [],
            // 头像
            avatarSrc: '',
            cropFile: null,
            showCropper: false,
            avatarUploading: false,
            // 2FA
            totpSetupData: null,
            totpCode: '',
            totpBusy: false,
            disableBusy: false,
            disableEmailCode: '',
            disableRecoveryCode: '',
            // 恢复码（一次性展示）
            recoveryCodes: [],
            showRecoveryDialog: false,
            // 邮箱验证
            emailVerified: false,
            // 发信邮箱是否已配置（未配置时「验证邮箱」不可用）
            mailReady: false,
            emailBusy: false,
            showEmailDialog: false,
            pendingEmail: '',
            emailCode: '',
            resendLeft: 0,
            resendTimer: null,
            // v3.0.0：实例管理
            instances: [],
            showCreateInstance: false,
            newInstance: { name: '', note: '' },
            showJoinInstance: false,
            joinCode: '',
            // v3.0.0：加入实例时的用户名（与邀请码双验证）
            joinUsername: '',
            showInviteDialog: false,
            inviteTarget: null,
            inviteCode: '',
            instanceBusy: false,
            // v1.0.6：WebDAV 管理（全局开关 + 该账户的渠道列表 + 新建/编辑弹窗）
            webdavGlobalEnabled: false,
            webdavChannels: [],
            webdavBusy: false,
            showWebdavDialog: false,
            /** 非空 = 编辑（只改名称 / 备注）；null = 新建 */
            webdavEditing: null,
            webdavForm: { name: '', path: '/', accessKey: '', note: '' },
            // v3.0.0：对外分享（开关即时保存 + 锚点滚动高亮）
            shareSaving: false,
            anchorHighlight: false,
            // v2.6.0：修改密码身份验证（本人三选一 / 管理员改他人需管理员密码）
            // v3.0.0（R12）：三选一合并为一个输入框，由后端自动识别凭据类型
            pwdVerifyCode: '',
            pwdEmailBusy: false,
            adminPassword: '',
        };
    },
    computed: {
        /** v3.0.0（R16）：背景图输入框占位符（提示格式） */
        bkImgPlaceholder() {
            return '["https://example.com/bg1.jpg", "https://example.com/bg2.jpg"]';
        },
        isAdminRole() {
            return this.$store?.getters?.isAdminRole === true;
        },
        currentUser() {
            return this.$store?.state?.sessionUser || '';
        },
        isSelf() {
            return this.form.username && this.form.username === this.currentUser;
        },
        /** v1.0.6：是否普通用户账户（管理员账户禁止使用 WebDAV） */
        isPlainUserAccount() {
            return (this.detail?.role || 'user') === 'user';
        },
        /**
         * v1.0.6：WebDAV 管理模块是否展示 —— 三个条件同时满足：
         *   · 是普通用户账户；· 安全设置里的「对外 WebDAV」全局开关打开；
         *   · 管理员在「管理员操作」里给该账户开了「启用 WebDAV 功能」。
         */
        webdavModuleVisible() {
            return this.isPlainUserAccount && this.webdavGlobalEnabled && this.form.webdavEnabled === true;
        },
        /**
         * v1.0.8：创建渠道的地址。
         * 本人视图走 `/api/webdav-self`（普通用户没有 manage 权限，之前 403 一律被当成
         * 「总开关没打开」）；管理员编辑他人时仍走 `/api/manage/users/:id/webdav`。
         */
        webdavCreateUrl() {
            return this.isSelf
                ? '/api/webdav-self'
                : `/api/manage/users/${encodeURIComponent(this.userId)}/webdav`;
        },
        /** 已建满配额（创建按钮置灰） */
        webdavFull() {
            return this.webdavChannels.length >= Math.max(1, Number(this.webdavMax) || 2);
        },
        /** 挂载地址：WebDAV 客户端里填这个（协议 http/https 按当前页面来） */
        webdavMountAddress() {
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            return `${origin}/dav/`;
        },
        avatarInitial() {
            const n = String(this.form.nickname || this.form.username || '?').trim();
            return n ? n.slice(0, 1).toUpperCase() : '?';
        },
        /** 剩余可用恢复码数量（由后端 detail 下发，启用 2FA 后 > 0） */
        recoveryCount() {
            return Number(this.detail?.recoveryCount || 0);
        },
        dialogWidth() {
            return window.innerWidth <= 768 ? '92%' : '520px';
        },
        /** v3.0.0：实例列表按创建时间升序（接口已按 createdAt 升序下发，这里再兜一次底） */
        orderedInstances() {
            return [...(this.instances || [])].sort((a, b) => {
                const ia = Number(a?.index) || 0;
                const ib = Number(b?.index) || 0;
                if (ia && ib && ia !== ib) return ia - ib;
                return new Date(a?.createdAt || 0).getTime() - new Date(b?.createdAt || 0).getTime();
            });
        },
        /**
         * v3.0.0：「对外分享」模块可见性
         *   · 管理员：始终可见（便于给该账户开启分享权限）；
         *   · 普通用户：仅当该账户 shareEnabled === true 时渲染。
         */
        shareModuleVisible() {
            return this.isAdminRole || this.form.shareEnabled === true;
        },
        /*
         * 渠道下拉的两个「特殊值」。
         * el-select 把空字符串当成「未选择」而显示 placeholder，所以这里用 __default__ 作为
         * 「默认(跟随全局)」的哨兵值，写回表单时再还原成空串（后端语义：空 = 跟随全局）。
         */
        mainChannelModel: {
            get() { return this.form.mainChannelId || '__default__'; },
            set(v) { this.form.mainChannelId = v === '__default__' ? '' : v; },
        },
        backupChannelModel: {
            get() { return this.form.backupChannelId || '__default__'; },
            set(v) { this.form.backupChannelId = v === '__default__' ? '' : v; },
        },
    },
    beforeUnmount() {
        if (this.resendTimer) window.clearInterval(this.resendTimer);
    },
    mounted() {
        this.userId = this.$route.params.id;
        this.load();
        /*
         * v3.0.0（R16）：本页也使用和后台其它页面一样的「背景图」样式 ——
         * 取 userConfig.adminBkImg（账户自定义优先，否则系统「网页设置 → 管理页背景图」）。
         */
        this.$nextTick(() => {
            try { this.initializeBackground('adminBkImg', '.container', false, true); } catch (e) { /* 忽略 */ }
        });
    },
    methods: {
        /**
         * v3.0.0（R16）：背景图格式校验 ——
         * 允许空串（跟随系统）、JSON 数组、单个 URL；返回错误文案或空串。
         */
        validateBkImg(raw) {
            const text = String(raw || '').trim();
            if (!text) return '';
            if (text.startsWith('[')) {
                try {
                    const arr = JSON.parse(text);
                    if (!Array.isArray(arr)) return 'bad';
                    if (arr.some((x) => typeof x !== 'string')) return 'bad';
                } catch (e) {
                    return 'bad';
                }
            }
            return '';
        },
        goBack() {
            this.$router.push({ name: 'customerConfig' });
        },
        async load() {
            this.loading = true;
            try {
                const res = await axios.get(`/api/manage/users/${encodeURIComponent(this.userId)}`, { withCredentials: true });
                if (!res.data?.success) {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                    return;
                }
                const d = res.data.data || {};
                this.detail = d;
                this.form = {
                    username: d.username || '',
                    nickname: d.nickname || '',
                    email: d.email || '',
                    password: '',
                    frontSessionDays: d.frontSessionDays ?? 7,
                    backSessionDays: d.backSessionDays ?? 7,
                    enabled: d.enabled !== false,
                    canEdit: d.canEdit !== false,
                    canDelete: d.canDelete !== false,
                    linkEnabled: d.linkEnabled !== false,
                    enforceLimits: d.enforceLimits !== false,
                    // v2.8.8：账户级上传策略（后端已返回，老账户默认 inherit / 0）
                    transcodePolicy: d.transcodePolicy || 'inherit',
                    maxFileSizeMB: Number(d.maxFileSizeMB) || 0,
                    mainChannelId: d.mainChannelId || '',
                    backupChannelId: d.backupChannelId || '',
                    adminNote: d.adminNote || '',
                    // v3.0.0：对外分享权限（老库 / 老接口没有该字段 → 视为关闭）
                    shareEnabled: d.shareEnabled === true,
                    // v3.0.0（R16）：账户自定义背景图
                    uploadBkImg: d.uploadBkImg || '',
                    adminBkImg: d.adminBkImg || '',
                    // v1.0.6：对外 WebDAV 授权（老库 / 老接口没有这两个字段）
                    webdavEnabled: d.webdavEnabled === true,
                    webdavMax: Number(d.webdavMax) || 2,
                };
                this.avatarSrc = d.avatarUrl || '';
                // 邮箱验证状态（已验证 → 输入框锁定，显示「已验证」）
                this.emailVerified = d.emailVerified === true;
                this.detail = { ...d, emailVerified: this.emailVerified };
                // 渠道下拉：管理员可看任意账户，普通用户只能看自己已授权的渠道
                await Promise.all([this.loadChannels(), this.loadMailReady()]);
                // v3.0.0：实例列表（表单用户名就绪后再拉）
                await this.loadInstances();
                // v1.0.6：WebDAV —— 先取全局开关（决定模块是否出现），再取该账户的渠道
                // v1.0.8：本人视图走自助接口（普通用户没有 /api/manage/* 权限）
                await this.reloadWebdav();
                // v3.0.0：?anchor=instances / #instances → 滚动到「实例管理」并高亮一下
                this.scrollToAnchor();
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.loading = false;
            }
        },
        /** 发信邮箱是否已配置（决定「验证邮箱」按钮是否可用） */
        async loadMailReady() {
            try {
                const res = await axios.get('/api/manage/mail', { withCredentials: true });
                this.mailReady = !!(res.data?.success ? res.data.data?.ready : false);
            } catch {
                this.mailReady = false;
            }
        },
        /** 只加载「该账户获授权」的渠道（管理员可为任意账户查看）
         *  v3.0.0（R8）：过滤掉「本地文件」渠道 —— 它不参与存储，主 / 备渠道里不应出现 */
        async loadChannels() {
            try {
                const res = await axios.get('/api/manage/channels/allowed/list', {
                    params: { username: this.form.username },
                    withCredentials: true,
                });
                const list = res.data?.success ? (res.data.data || []) : [];
                this.channelOptions = list.filter((c) => (c.type || '') !== 'localfiles');
            } catch {
                this.channelOptions = [];
            }
        },
        /* ---------------- WebDAV 管理（v1.0.6） ---------------- */
        /** 16 位随机访问密钥（大小写字母 + 数字），与后端生成规则保持一致 */
        genAccessKey() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let out = '';
            const buf = new Uint8Array(16);
            if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
                window.crypto.getRandomValues(buf);
                for (let i = 0; i < 16; i += 1) out += chars[buf[i] % chars.length];
            } else {
                for (let i = 0; i < 16; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
            }
            return out;
        },
        /**
         * v1.0.8：本人视图 —— 一次拿全（总开关 + 我的授权 + 我的渠道）。
         *
         * 之前普通用户打开自己的账户页，前端读的是 `/api/manage/sysConfig/others`（AdminGuard），
         * 必然 403；catch 里把 webdavGlobalEnabled 置 false，页面就永远显示
         * 「系统管理 → 安全设置里的『对外 WebDAV』总开关还没打开」——而管理员进同一页却正常。
         * 现在本人一律走 `/api/webdav-self`，后端只回该账户自己的数据 + 一个总开关布尔值。
         */
        async loadWebdavSelf() {
            try {
                const res = await axios.get('/api/webdav-self', { withCredentials: true });
                const d = res.data?.success ? (res.data.data || {}) : {};
                this.webdavGlobalEnabled = d.globalEnabled === true;
                this.webdavMax = Number(d.max) || 2;
                this.webdavChannels = Array.isArray(d.channels) ? d.channels : [];
            } catch {
                this.webdavGlobalEnabled = false;
                this.webdavChannels = [];
            }
        },
        /** 按「本人 / 管理员」两条链路重新加载 WebDAV 数据（创建、删除后都调它） */
        async reloadWebdav() {
            if (this.isSelf) return this.loadWebdavSelf();
            await this.loadWebdavGlobal();
            return this.loadWebdav();
        },
        /**
         * 单条渠道的操作地址（改名称 / 轮换密钥 / 删除）。
         * 本人 → `/api/webdav-self/:id`；管理员 → `/api/manage/webdav/:id`。
         */
        webdavItemUrl(id) {
            const safe = encodeURIComponent(id);
            return this.isSelf ? `/api/webdav-self/${safe}` : `/api/manage/webdav/${safe}`;
        },
        /** 全局开关：安全设置里的「对外 WebDAV」是否启用（配置存在 sysConfig 的 others 分区） */
        async loadWebdavGlobal() {
            try {
                const res = await axios.get('/api/manage/sysConfig/others', { withCredentials: true });
                const cfg = res.data || {};
                // v1.0.7：布尔与字符串两种存法都认（老库 / 手改配置里出现 'true' 时不再误判为关闭）
                const flag = cfg?.webdav?.enabled;
                this.webdavGlobalEnabled = flag === true || String(flag) === 'true';
            } catch {
                this.webdavGlobalEnabled = false;
            }
        },
        /** 该账户的 WebDAV 渠道列表（管理员接口，附带配额） */
        async loadWebdav() {
            try {
                const res = await axios.get(`/api/manage/users/${encodeURIComponent(this.userId)}/webdav`, { withCredentials: true });
                const d = res.data?.success ? (res.data.data || {}) : {};
                this.webdavChannels = Array.isArray(d.channels) ? d.channels : [];
                this.webdavMax = Number(d.max) || 2;
            } catch {
                this.webdavChannels = [];
            }
        },
        openCreateWebdav() {
            if (this.webdavFull) {
                this.$message.warning(this.$t('userEdit.webdavMaxReached', { max: this.webdavMax }));
                return;
            }
            this.webdavEditing = null;
            this.webdavForm = { name: '', path: '', accessKey: this.genAccessKey(), note: '' };
            this.showWebdavDialog = true;
        },
        /** 编辑：只允许改名称与备注（存储路径与密钥一经保存不再手改） */
        openEditWebdav(row) {
            this.webdavEditing = row;
            this.webdavForm = {
                name: row.name || '',
                path: row.path || '',
                accessKey: row.accessKey || '',
                note: row.note || '',
            };
            this.showWebdavDialog = true;
        },
        regenWebdavFormKey() {
            this.webdavForm.accessKey = this.genAccessKey();
        },
        async saveWebdav() {
            const name = String(this.webdavForm.name || '').trim();
            if (!name) {
                this.$message.warning(this.$t('userEdit.webdavNameRequired'));
                return;
            }
            this.webdavBusy = true;
            try {
                if (this.webdavEditing) {
                    const res = await axios.patch(
                        this.webdavItemUrl(this.webdavEditing.id),
                        { name, note: this.webdavForm.note },
                        { withCredentials: true },
                    );
                    if (!res.data?.success) {
                        this.$message.error(res.data?.message || this.$t('common.failed'));
                        return;
                    }
                    this.$message.success(this.$t('userEdit.webdavSaved'));
                } else {
                    const path = String(this.webdavForm.path || '').trim();
                    if (!path) {
                        this.$message.warning(this.$t('userEdit.webdavPathRequired'));
                        return;
                    }
                    const res = await axios.post(
                        this.webdavCreateUrl,
                        { name, path, accessKey: String(this.webdavForm.accessKey || '').trim(), note: this.webdavForm.note },
                        { withCredentials: true },
                    );
                    if (!res.data?.success) {
                        this.$message.error(res.data?.message || this.$t('common.failed'));
                        return;
                    }
                    this.$message.success(this.$t('userEdit.webdavCreated'));
                }
                this.showWebdavDialog = false;
                this.webdavEditing = null;
                await this.reloadWebdav();
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.webdavBusy = false;
            }
        },
        /** 重新生成访问密钥（旧密钥立即失效，已挂载的客户端需要改成新密钥） */
        async regenWebdavKey(row) {
            try {
                await this.$confirm(this.$t('userEdit.webdavKeyRegenConfirm', { name: row.name }), this.$t('userEdit.webdavKeyRegen'), {
                    type: 'warning',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                });
            } catch {
                return;
            }
            try {
                const res = await axios.post(`${this.webdavItemUrl(row.id)}/key`, {}, { withCredentials: true });
                if (!res.data?.success) {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                    return;
                }
                const key = res.data.data?.accessKey || '';
                this.webdavChannels = this.webdavChannels.map((c) => (c.id === row.id ? { ...c, accessKey: key } : c));
                const ok = await copyText(key);
                this.$message.success(ok ? this.$t('userEdit.webdavKeyRegenOkCopied') : this.$t('userEdit.webdavKeyRegenOk'));
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            }
        },
        async deleteWebdav(row) {
            try {
                await this.$confirm(this.$t('userEdit.webdavDeleteConfirm', { name: row.name }), this.$t('userEdit.instanceDelete'), {
                    type: 'warning',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                });
            } catch {
                return;
            }
            try {
                const res = await axios.delete(this.webdavItemUrl(row.id), { withCredentials: true });
                if (!res.data?.success) {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                    return;
                }
                this.$message.success(this.$t('userEdit.webdavDeleted'));
                await this.loadWebdav();
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            }
        },
        async copyWebdavKey(row) {
            const ok = await copyText(String(row?.accessKey || ''));
            if (ok) this.$message.success(this.$t('userEdit.webdavCopied'));
            else this.$message.warning(String(row?.accessKey || ''));
        },
        async copyWebdavMount() {
            const text = this.$t('userEdit.webdavMountText', {
                address: this.webdavMountAddress,
                user: this.form.username || '',
            });
            const ok = await copyText(text);
            if (ok) this.$message.success(this.$t('userEdit.webdavCopied'));
            else this.$message.warning(text);
        },
        /* ---------------- 实例管理（v3.0.0） ---------------- */
        /**
         * 实例接口统一追加 username 参数：管理员在用户编辑页操作「该用户」的实例。
         * 当前后端实例接口按「当前登录用户」处理，暂不支持 username —— 参数先带上，
         * 后端支持 ?username= 后自动生效（详见交付说明）。
         */
        instanceUrl(path) {
            const u = String(this.form.username || '').trim();
            if (!u || this.isSelf) return path;
            return `${path}${path.includes('?') ? '&' : '?'}username=${encodeURIComponent(u)}`;
        },
        /** 实例接口的错误文案（后端 {error} / {message} 兜底） */
        instanceErr(e, fallback) {
            return e?.response?.data?.error || e?.response?.data?.message || fallback;
        },
        formatInstanceTime(v) {
            const d = new Date(v);
            return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
        },
        /**
         * v3.0.0：实例创建序号（1-based）。
         * 优先用 /api/instances 下发的 index，缺失时回落到「按 createdAt 升序」的列表位置。
         */
        instanceSeq(row) {
            const idx = Number(row?.index);
            if (Number.isFinite(idx) && idx > 0) return idx;
            const pos = this.orderedInstances.findIndex((i) => i.id === row?.id);
            return pos >= 0 ? pos + 1 : 0;
        },
        /**
         * v3.0.0：锚点定位 —— 文件管理页「实例管理」按钮以
         * /customerConfig/edit/:id?anchor=instances（或 #instances）打开本页，
         * 加载完成后滚动到该区块并短暂高亮。
         */
        scrollToAnchor() {
            const q = this.$route?.query || {};
            const hash = String(this.$route?.hash || '').replace(/^#/, '');
            if (q.anchor !== 'instances' && hash !== 'instances') return;
            this.$nextTick(() => {
                window.setTimeout(() => {
                    const el = document.getElementById('instances');
                    if (!el) return;
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    this.anchorHighlight = true;
                    window.setTimeout(() => { this.anchorHighlight = false; }, 2000);
                }, 120);
            });
        },
        /* ---------------- 对外分享（v3.0.0） ---------------- */
        /** 新标签打开分享记录页（带上当前账户名，管理员进页即有过滤条件） */
        openShareRecords() {
            const u = String(this.form.username || '').trim();
            const url = u ? `/share-records?username=${encodeURIComponent(u)}` : '/share-records';
            window.open(url, '_blank', 'noopener');
        },
        /** 开关即时保存：PUT /api/manage/users/:id（payload 只需 shareEnabled） */
        async onShareEnabledChange(next) {
            const val = next === true;
            this.shareSaving = true;
            try {
                const res = await axios.put(
                    `/api/manage/users/${encodeURIComponent(this.userId)}`,
                    { shareEnabled: val },
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.detail = { ...this.detail, shareEnabled: val };
                    this.$message.success(val ? this.$t('userEdit.shareEnabledOn') : this.$t('userEdit.shareEnabledOff'));
                } else {
                    this.form.shareEnabled = !val;
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.form.shareEnabled = !val;
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.shareSaving = false;
            }
        },
        async loadInstances() {
            try {
                const res = await axios.get(this.instanceUrl('/api/instances'), { withCredentials: true });
                this.instances = Array.isArray(res.data) ? res.data : [];
            } catch {
                this.instances = [];
            }
        },
        openCreateInstance() {
            this.newInstance = { name: '', note: '' };
            this.showCreateInstance = true;
        },
        async createInstance() {
            const name = String(this.newInstance.name || '').trim();
            if (!name) {
                this.$message.warning(this.$t('userEdit.instanceNameRequired'));
                return;
            }
            // 客户端先查重（同一创建者下同名后端也会拒绝）
            if (this.instances.some((i) => i.name === name)) {
                this.$message.warning(this.$t('userEdit.instanceNameDup'));
                return;
            }
            this.instanceBusy = true;
            try {
                const res = await axios.post(
                    this.instanceUrl('/api/instances'),
                    { name, note: String(this.newInstance.note || '') },
                    { withCredentials: true },
                );
                const item = res.data && res.data.id ? res.data : null;
                if (item && !this.instances.some((i) => i.id === item.id)) this.instances.push(item);
                this.showCreateInstance = false;
                this.$message.success(this.$t('userEdit.instanceCreated'));
            } catch (e) {
                this.$message.error(this.instanceErr(e, this.$t('common.failed')));
            } finally {
                this.instanceBusy = false;
            }
        },
        openJoinInstance() {
            this.joinCode = '';
            // v3.0.0：双验证 —— 用户名默认填当前登录账户（可改，后端会校验必须与登录账户一致）
            this.joinUsername = this.$store?.getters?.sessionUser || '';
            this.showJoinInstance = true;
        },
        async joinInstance() {
            const username = String(this.joinUsername || '').trim();
            const code = String(this.joinCode || '').trim();
            if (!username) {
                this.$message.warning(this.$t('userEdit.joinUsernameRequired'));
                return;
            }
            if (code.length !== 8) {
                this.$message.warning(this.$t('userEdit.joinCodeInvalid'));
                return;
            }
            this.instanceBusy = true;
            try {
                const res = await axios.post(
                    this.instanceUrl('/api/instances/join'),
                    { username, code },
                    { withCredentials: true },
                );
                const item = res.data && res.data.id ? res.data : null;
                if (item && !this.instances.some((i) => i.id === item.id)) this.instances.push(item);
                this.showJoinInstance = false;
                this.$message.success(this.$t('userEdit.instanceJoined', { name: item?.name || '' }));
            } catch (e) {
                this.$message.error(this.instanceErr(e, this.$t('common.failed')));
            } finally {
                this.instanceBusy = false;
            }
        },
        async openInviteDialog(row) {
            this.inviteTarget = row;
            this.inviteCode = '';
            this.showInviteDialog = true;
            /*
             * v3.0.0（第三轮）：打开只「读取」已有邀请码，不再顺手生成一枚 ——
             * 生成是明确动作，得用户点「生成邀请码」。
             */
            await this.loadInvite();
        },
        /** 读取当前邀请码（不生成）；失败不打扰用户，按「尚未生成」展示 */
        async loadInvite() {
            if (!this.inviteTarget) return;
            this.instanceBusy = true;
            try {
                const res = await axios.get(
                    this.instanceUrl(`/api/instances/${encodeURIComponent(this.inviteTarget.id)}/invite`),
                    { withCredentials: true },
                );
                this.inviteCode = res.data?.inviteCode || '';
            } catch (e) {
                this.inviteCode = '';
            } finally {
                this.instanceBusy = false;
            }
        },
        /** 生成 / 重新生成 8 位邀请码（生成后长期有效，除非关闭或再次重新生成） */
        async regenerateInvite(silent = false) {
            if (!this.inviteTarget) return;
            this.instanceBusy = true;
            try {
                const res = await axios.post(
                    this.instanceUrl(`/api/instances/${encodeURIComponent(this.inviteTarget.id)}/invite`),
                    {},
                    { withCredentials: true },
                );
                this.inviteCode = res.data?.inviteCode || '';
                if (!silent) this.$message.success(this.$t('userEdit.inviteRegenOk'));
            } catch (e) {
                this.$message.error(this.instanceErr(e, this.$t('common.failed')));
            } finally {
                this.instanceBusy = false;
            }
        },
        async copyInviteCode() {
            if (!this.inviteCode) return;
            const ok = await copyText(this.inviteCode);
            if (ok) this.$message.success(this.$t('userEdit.inviteCopied'));
            else this.$message.warning(this.inviteCode);
        },
        /** 关闭邀请：邀请码置空，之后持旧码无法再加入 */
        async closeInvite() {
            if (!this.inviteTarget) return;
            this.instanceBusy = true;
            try {
                await axios.delete(
                    this.instanceUrl(`/api/instances/${encodeURIComponent(this.inviteTarget.id)}/invite`),
                    { withCredentials: true },
                );
                this.inviteCode = '';
                this.$message.success(this.$t('userEdit.inviteClosedOk'));
            } catch (e) {
                this.$message.error(this.instanceErr(e, this.$t('common.failed')));
            } finally {
                this.instanceBusy = false;
            }
        },
        openRenameInstance(row) {
            this.$prompt(this.$t('userEdit.renameHint'), this.$t('userEdit.instanceRename'), {
                inputValue: row.name,
                inputPattern: /\S+/,
                inputErrorMessage: this.$t('userEdit.instanceNameRequired'),
                confirmButtonText: this.$t('common.confirm'),
                cancelButtonText: this.$t('common.cancel'),
            })
                .then(async ({ value }) => {
                    const name = String(value || '').trim();
                    if (!name || name === row.name) return;
                    this.instanceBusy = true;
                    try {
                        const res = await axios.patch(
                            this.instanceUrl(`/api/instances/${encodeURIComponent(row.id)}`),
                            { name },
                            { withCredentials: true },
                        );
                        const idx = this.instances.findIndex((i) => i.id === row.id);
                        if (idx > -1 && res.data && res.data.id) this.instances.splice(idx, 1, res.data);
                        else if (idx > -1) this.instances[idx].name = name;
                        this.$message.success(this.$t('common.success'));
                    } catch (e) {
                        this.$message.error(this.instanceErr(e, this.$t('common.failed')));
                    } finally {
                        this.instanceBusy = false;
                    }
                })
                .catch(() => {});
        },
        /** 删除实例：实例下仍有文件（含回收站）时后端拒绝，错误文案原样展示 */
        deleteInstance(row) {
            this.$confirm(
                this.$t('userEdit.instanceDeleteConfirm', { name: row.name }),
                this.$t('common.warning'),
                {
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    type: 'warning',
                },
            )
                .then(async () => {
                    this.instanceBusy = true;
                    try {
                        await axios.delete(
                            this.instanceUrl(`/api/instances/${encodeURIComponent(row.id)}`),
                            { withCredentials: true },
                        );
                        this.instances = this.instances.filter((i) => i.id !== row.id);
                        this.$message.success(this.$t('userEdit.instanceDeleted'));
                    } catch (e) {
                        this.$message.error(this.instanceErr(e, this.$t('common.failed')));
                    } finally {
                        this.instanceBusy = false;
                    }
                })
                .catch(() => {});
        },

        /* ---------------- 邮箱验证（v2.3.0） ---------------- */

        /** 打开验证弹窗：先发码（发到当前填写的地址） */
        async openEmailVerify() {
            const email = String(this.form.email || '').trim();
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                this.$message.warning(this.$t('userEdit.emailPlaceholder'));
                return;
            }
            this.pendingEmail = email;
            this.emailCode = '';
            this.showEmailDialog = true;
            await this.sendEmailCode();
        },

        /** 发送 / 重新发送验证码（60 秒倒计时与后端限流保持一致） */
        async sendEmailCode() {
            if (this.emailBusy) return;
            this.emailBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/email/send-code`,
                    { email: this.pendingEmail || String(this.form.email || '').trim() },
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.$message.success(res.data.message || this.$t('userEdit.emailCodeSent'));
                    this.startResendCountdown();
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.emailBusy = false;
            }
        },

        startResendCountdown() {
            this.resendLeft = 60;
            if (this.resendTimer) window.clearInterval(this.resendTimer);
            this.resendTimer = window.setInterval(() => {
                this.resendLeft = Math.max(0, this.resendLeft - 1);
                if (this.resendLeft === 0 && this.resendTimer) {
                    window.clearInterval(this.resendTimer);
                    this.resendTimer = null;
                }
            }, 1000);
        },

        /** 提交验证码：通过后后端会写入邮箱并置 emailVerified
         *  v3.0.0（R8）：校验放开为 6 位字母数字（此前只认数字，字母验证码会被前端拦下） */
        async verifyEmail() {
            if (!/^[0-9A-Za-z]{6}$/.test(String(this.emailCode || ''))) {
                this.$message.warning(this.$t('userEdit.emailCodeInvalid'));
                return;
            }
            this.emailBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/email/verify`,
                    { email: this.pendingEmail, code: this.emailCode },
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.$message.success(this.$t('userEdit.emailVerifiedOk'));
                    this.emailVerified = true;
                    this.detail.emailVerified = true;
                    this.form.email = res.data.data?.email || this.pendingEmail;
                    this.showEmailDialog = false;
                    this.emailCode = '';
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.emailBusy = false;
            }
        },

        /** 更换邮箱：先取消已验证状态（2FA 开启时后端会拒绝，需先关 2FA） */
        async resetEmailVerified() {
            try {
                await this.$confirm(this.$t('userEdit.changeEmailConfirm'), this.$t('common.warning'), {
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    type: 'warning',
                });
            } catch {
                return;
            }
            try {
                const res = await axios.delete(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/email/verified`,
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.emailVerified = false;
                    this.detail.emailVerified = false;
                    this.$message.success(res.data.message || this.$t('common.success'));
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            }
        },

        /** v2.6.0：修改密码 —— 发送「修改密码验证码」到账户邮箱（本人或管理员） */
        async sendPwdChangeCode() {
            this.pwdEmailBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/password/send-code`,
                    {},
                    { withCredentials: true },
                );
                if (res.data?.success) this.$message.success(res.data.message || this.$t('userEdit.emailCodeSent'));
                else this.$message.error(res.data?.message || this.$t('common.failed'));
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.pwdEmailBusy = false;
            }
        },

        /**
         * v3.0.0（R12）：改密后强制注销 —— 清服务端 Cookie + 清前端会话 + 回登录页。
         * 用 replace 而不是 push，避免用户按返回键又回到已失效的编辑页。
         */
        async forceRelogin() {
            this.$message.success(this.$t('userEdit.pwdChangedRelogin'));
            try {
                await axios.post('/api/auth/logout', { authType: 'admin' }, { withCredentials: true });
            } catch {
                /* 登出接口失败也要继续清本地会话 */
            }
            try {
                this.$store.commit('clearSession');
            } catch {
                /* 老版本 store 没有 clearSession 时忽略 */
            }
            this.$router.replace('/login').catch(() => { window.location.href = '/login'; });
        },

        async save() {
            if (!String(this.form.username || '').trim()) {                this.$message.warning(this.$t('userManage.usernameRequired'));
                return;
            }
            if (this.form.password && this.form.password.length < 4) {
                this.$message.warning(this.$t('userManage.passwordTooShort'));
                return;
            }
            // v2.6.0：改密必须带身份验证凭据
            if (this.form.password) {
                if (this.isAdminRole && !this.isSelf) {
                    if (!String(this.adminPassword || '')) {
                        this.$message.warning(this.$t('userEdit.adminPasswordPlaceholder'));
                        return;
                    }
                } else {
                    // v3.0.0（R12）：合并输入框 —— 原密码 / 邮箱验证码 / 2FA 动态码都填这一格
                    if (!String(this.pwdVerifyCode || '').trim()) {
                        this.$message.warning(this.$t('userEdit.pwdVerifyRequired'));
                        return;
                    }
                }
            }
            this.saving = true;
            try {
                const payload = {
                    username: this.form.username,
                    nickname: this.form.nickname,
                    email: this.form.email,
                    frontSessionDays: this.form.frontSessionDays,
                    backSessionDays: this.form.backSessionDays,
                };
                if (this.form.password) {
                    payload.password = this.form.password;
                    if (this.isAdminRole && !this.isSelf) {
                        payload.adminPassword = this.adminPassword;
                    } else {
                        // v3.0.0（R12）：统一凭据字段，后端按内容自动识别类型
                        payload.verifyCode = this.pwdVerifyCode;
                    }
                }
                /*
                 * 主/备渠道：本人也能改（v2.3.0），后端会校验「只能选该账户已授权的渠道」，
                 * 'none'（不备份）是唯一不需要授权的例外值。
                 */
                payload.mainChannelId = this.form.mainChannelId;
                payload.backupChannelId = this.form.backupChannelId;
                // v3.0.0：对外分享权限（管理员与本人都在保存时带上，避免后端按缺省 false 覆盖）
                payload.shareEnabled = this.form.shareEnabled === true;
                /*
                 * v3.0.0（R16）：账户自定义背景图（本人与管理员都可保存）。
                 * 前端先做一次格式校验，避免把半截 JSON 提交上去。
                 */
                const bkErr = this.validateBkImg(this.form.uploadBkImg) || this.validateBkImg(this.form.adminBkImg);
                if (bkErr) {
                    this.saving = false;
                    this.$message.warning(this.$t('userEdit.bkImgInvalid'));
                    return;
                }
                payload.uploadBkImg = String(this.form.uploadBkImg || '').trim();
                payload.adminBkImg = String(this.form.adminBkImg || '').trim();
                if (this.isAdminRole) {
                    Object.assign(payload, {
                        enabled: this.form.enabled,
                        canEdit: this.form.canEdit,
                        canDelete: this.form.canDelete,
                        linkEnabled: this.form.linkEnabled,
                        // v2.8.8：账户级上传策略
                        transcodePolicy: this.form.transcodePolicy || 'inherit',
                        maxFileSizeMB: Number(this.form.maxFileSizeMB) || 0,
                        adminNote: this.form.adminNote,
                        // v1.0.6：对外 WebDAV 授权（后端对管理员账户会强制钳成 false）
                        webdavEnabled: this.form.webdavEnabled === true,
                        webdavMax: Math.max(1, Number(this.form.webdavMax) || 2),
                    });
                }
                const res = await axios.put(`/api/manage/users/${encodeURIComponent(this.userId)}`, payload, { withCredentials: true });
                if (res.data?.success) {
                    const passwordChanged = !!payload.password;
                    this.detail = { ...this.detail, ...this.form };
                    this.form.password = '';
                    // v2.6.0：清掉本次的身份验证凭据
                    this.pwdVerifyCode = '';
                    this.adminPassword = '';
                    /*
                     * v3.0.0（R16）：背景图改完立即生效 ——
                     * 重拉 userConfig（后端已把账户背景图覆盖进 uploadBkImg/adminBkImg），
                     * 再按新配置重绘本页背景。
                     */
                    if (this.isSelf) {
                        this.$store.dispatch('fetchUserConfig')
                            .then(() => {
                                try { this.initializeBackground('adminBkImg', '.container', false, true); } catch (e) { /* 忽略 */ }
                            })
                            .catch(() => {});
                    }
                    /*
                     * v3.0.0（R12）：改密后强制注销 —— 旧会话仍然携带旧凭据，
                     * 继续留在后台属于安全隐患。本人改密 → 立即登出并回登录页；
                     * 管理员改「他人」密码 → 提示该账户需重新登录（其浏览器会话不受本页控制）。
                     */
                    if (passwordChanged && this.isSelf) {
                        await this.forceRelogin();
                        return;
                    }
                    this.$message.success(this.$t('common.success'));
                    if (passwordChanged) {
                        this.$message.info(this.$t('userEdit.pwdChangedRelogin'));
                    }
                    // 改了自己的用户名 → 会话里的用户名已失效，提示重新登录
                    if (this.isSelf && payload.username !== this.currentUser) {
                        this.$message.info(this.$t('userEdit.reloginHint'));
                    }
                    /*
                     * v1.0.0：保存成功后回到「用户管理」列表页（需求）。
                     * 原来停在本页重新 load()，保存完没有任何下一步反馈，
                     * 用户容易以为没生效而反复点保存。
                     */
                    this.goBack();
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.saving = false;
            }
        },

        /* ---------------- 头像 ---------------- */
        pickAvatar() {
            this.$refs.avatarInput?.click();
        },
        onAvatarPicked(evt) {
            const file = evt.target.files?.[0];
            evt.target.value = '';
            if (!file) return;
            if (!/^image\//.test(file.type)) {
                this.$message.warning(this.$t('userEdit.avatarTypeError'));
                return;
            }
            this.cropFile = file;
            this.showCropper = true;
        },
        async uploadCroppedAvatar(file) {
            const fd = new FormData();
            fd.append('file', file);
            this.avatarUploading = true;
            try {
                const res = await axios.post(`/api/manage/users/${encodeURIComponent(this.userId)}/avatar`, fd, {
                    withCredentials: true,
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
                if (res.data?.success) {
                    this.avatarSrc = res.data.data?.avatarUrl || '';
                    this.detail.avatar = res.data.data?.avatar || '';
                    this.$message.success(this.$t('common.success'));
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.avatarUploading = false;
            }
        },
        async removeAvatar() {
            try {
                const res = await axios.delete(`/api/manage/users/${encodeURIComponent(this.userId)}/avatar`, { withCredentials: true });
                if (res.data?.success) {
                    this.avatarSrc = '';
                    this.detail.avatar = '';
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            }
        },

        /* ---------------- 两步验证 ---------------- */
        async startTotpSetup() {
            this.totpBusy = true;
            try {
                const res = await axios.post(`/api/manage/users/${encodeURIComponent(this.userId)}/totp/setup`, {}, { withCredentials: true });
                if (res.data?.success) {
                    this.totpSetupData = res.data.data;
                    this.totpCode = '';
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.totpBusy = false;
            }
        },
        cancelTotpSetup() {
            this.totpSetupData = null;
            this.totpCode = '';
        },
        async enableTotp() {
            if (!/^\d{6}$/.test(String(this.totpCode || ''))) {
                this.$message.warning(this.$t('userEdit.totpCodeInvalid'));
                return;
            }
            this.totpBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/totp/enable`,
                    { code: this.totpCode },
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.$message.success(this.$t('userEdit.totpEnabledOk'));
                    this.totpSetupData = null;
                    this.totpCode = '';
                    this.detail.totpEnabled = true;
                    // 恢复码只返回这一次 —— 立刻弹窗让用户抄下来
                    const codes = res.data.data?.recoveryCodes || [];
                    if (codes.length) {
                        this.recoveryCodes = codes;
                        this.showRecoveryDialog = true;
                    }
                    await this.load();
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.totpBusy = false;
            }
        },
        async disableTotp() {
            this.totpBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/totp/disable`,
                    { code: this.totpCode },
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.$message.success(this.$t('common.success'));
                    this.detail.totpEnabled = false;
                    this.totpCode = '';
                    this.disableEmailCode = '';
                    this.disableRecoveryCode = '';
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.totpBusy = false;
            }
        },

        /**
         * v2.6.0：恢复码弹窗「复制全部」—— 一键复制所有恢复码（每行一枚）
         * 并自动关闭窗口；复制失败时给出降级提示（弹窗不关闭，用户可手动选择）。
         */
        async copyRecoveryCodes() {
            const text = (this.recoveryCodes || []).join('\n');
            if (!text) return;
            let ok = false;
            try {
                await navigator.clipboard.writeText(text);
                ok = true;
            } catch {
                // 非安全上下文（http）下 clipboard API 不可用 → execCommand 降级
                try {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    ok = document.execCommand('copy');
                    document.body.removeChild(ta);
                } catch {
                    ok = false;
                }
            }
            if (ok) {
                this.$message.success(this.$t('userEdit.recoveryCopied'));
                this.showRecoveryDialog = false;
            } else {
                this.$message.error(this.$t('userEdit.recoveryCopyFailed'));
            }
        },

        /** 重新生成恢复码（需当前动态码；旧码全部作废） */
        async regenerateRecovery() {
            if (!/^\d{6}$/.test(String(this.totpCode || ''))) {
                this.$message.warning(this.$t('userEdit.totpCodeInvalid'));
                return;
            }
            this.totpBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/totp/recovery`,
                    { code: this.totpCode },
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.recoveryCodes = res.data.data?.recoveryCodes || [];
                    this.showRecoveryDialog = true;
                    await this.load();
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.totpBusy = false;
            }
        },

        /** 忘记验证器：发送「关闭两步验证」邮箱验证码 */
        async sendDisableCode() {
            this.disableBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/totp/disable-code`,
                    {},
                    { withCredentials: true },
                );
                if (res.data?.success) this.$message.success(res.data.message || this.$t('userEdit.emailCodeSent'));
                else this.$message.error(res.data?.message || this.$t('common.failed'));
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.disableBusy = false;
            }
        },

        /**
         * 忘记验证器：邮箱验证码 或 一枚恢复码（v2.6.0 起任一即可）→ 关闭两步验证
         */
        async disableTotpByFallback() {
            const emailCode = String(this.disableEmailCode || '').trim();
            const recoveryCode = String(this.disableRecoveryCode || '').trim();
            if (!emailCode && !recoveryCode) {
                this.$message.warning(this.$t('userEdit.disableEitherHint'));
                return;
            }
            this.disableBusy = true;
            try {
                const res = await axios.post(
                    `/api/manage/users/${encodeURIComponent(this.userId)}/totp/disable-fallback`,
                    { emailCode, recoveryCode },
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.$message.success(res.data.message || this.$t('common.success'));
                    this.disableEmailCode = '';
                    this.disableRecoveryCode = '';
                    await this.load();
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.disableBusy = false;
            }
        },
    },
};
</script>

<style scoped>
/*
 * 宽度对齐「用户管理」列表（v2.3.0）：
 * 列表页的 .main-table / .module-switch 都是 width:95% + max-width:1400px 居中，
 * 编辑页此前没有任何宽度约束（铺满整屏），两者并排切换时观感不一致。
 */
.edit-page {
    width: 95%;
    max-width: 1400px;
    margin: 32px auto 0;
    padding-bottom: 90px;
    box-sizing: border-box;
}
.page-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
    flex-wrap: wrap;
}
.back-btn { font-size: 14px; }
.back-icon { margin-right: 6px; }
.page-title { font-size: 17px; font-weight: 600; }
.edit-card { margin-bottom: 14px; }
.card-title { font-weight: 600; font-size: 14px; }
.card-tag { margin-left: 8px; }
.avatar-row { display: flex; align-items: center; gap: 16px; margin-bottom: 18px; }
/*
 * v3.0.0（R16）：账户自定义背景图 —— 头像下方一行两个输入框，
 * 宽屏并排，窄屏自动堆叠；输入框用等宽字体方便核对 JSON 格式。
 */
.bkimg-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 14px;
}
.bkimg-item {
    min-width: 0;
}
.bkimg-input :deep(.el-textarea__inner) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
}
.bkimg-hint {
    margin: -4px 0 14px;
}
@media (max-width: 768px) {
    .bkimg-row {
        grid-template-columns: minmax(0, 1fr);
    }
}
.avatar-preview {
    width: 84px;
    height: 84px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--el-fill-color-light, #f2f3f5);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.avatar-preview img { width: 100%; height: 100%; object-fit: cover; }
.avatar-fallback { font-size: 30px; color: var(--el-text-color-secondary, #909399); }
.avatar-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.hidden-input { display: none; }
.edit-form { max-width: 520px; }
.num-input { width: 160px; }
.unit { margin-left: 8px; color: var(--el-text-color-secondary, #909399); font-size: 13px; }
.hint { margin: 4px 0 0; font-size: 12px; color: var(--el-text-color-secondary, #909399); line-height: 1.5; }
.hint.block { margin: 0 0 10px; }
.switch-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 26px;
    margin-bottom: 16px;
}
.switch-item { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
/* v2.8.8：账户级上传策略（视频兼容转码 / 单文件大小限制）—— 与「存储渠道」同款两列布局 */
.account-policy-form { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 4px; }
.account-policy-form .el-form-item { flex: 1; min-width: 220px; }
.channel-form { display: flex; gap: 16px; flex-wrap: wrap; }
.channel-form .el-form-item { flex: 1; min-width: 220px; }
.full-width { width: 100%; }
/*
 * v1.0.6：对外 WebDAV 授权（管理员操作里，「管理备注」上一行）。
 * 开关关闭时整段只有一行，打开后才在下面展开「允许创建数量」。
 */
.webdav-enable-block { margin: 4px 0 14px; display: flex; flex-direction: column; gap: 10px; }
.webdav-enable-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.webdav-max-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.hint.inline { margin: 0; }
/* v1.0.6：WebDAV 管理模块 */
.webdav-mount-hint { margin: 0 0 12px; word-break: break-all; }
/* v1.0.7：卡片内的「为什么用不了」提示（全局开关未开 / 账户未授权） */
.webdav-blocked-hint {
    margin: 0 0 12px;
    padding: 6px 10px;
    border-left: 3px solid var(--el-color-warning);
    background: var(--el-color-warning-light-9);
    color: var(--el-color-warning);
    border-radius: 2px;
    line-height: 1.6;
}
.webdav-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    background: var(--el-fill-color-light, #f5f7fa);
    padding: 1px 6px;
    border-radius: 4px;
}
.webdav-key-cell { display: inline-flex; align-items: center; gap: 6px; }
.webdav-key-cell code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    letter-spacing: 0.4px;
}
.webdav-key-row { display: flex; gap: 8px; align-items: center; width: 100%; }
.webdav-key-row .el-input { flex: 1; }
/* v2.4.0：管理备注 —— 名称在上、输入框另起一行 */
.admin-note-block { margin-top: 4px; display: flex; flex-direction: column; gap: 8px; }
.admin-note-label { font-size: 14px; color: var(--el-text-color-primary); }
.notice-input { max-width: 720px; }
.notice-actions { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.totp-setup { display: flex; gap: 22px; flex-wrap: wrap; align-items: flex-start; }
.totp-qr { padding: 6px; background: #fff; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; }
.totp-steps { flex: 1; min-width: 240px; font-size: 13px; line-height: 1.7; }
.secret-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.secret-label { color: var(--el-text-color-secondary, #909399); }
.secret-line code {
    background: var(--el-fill-color-light, #f5f7fa);
    padding: 2px 8px;
    border-radius: 4px;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    letter-spacing: 1px;
    word-break: break-all;
}
.code-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.code-input { width: 130px; }
.totp-on-box { max-width: 520px; }
.email-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; width: 100%; }
.email-input { flex: 1; min-width: 200px; }
.email-tag { display: inline-flex; align-items: center; gap: 4px; }
.email-tag-icon { font-size: 11px; }
.totp-alert { margin-bottom: 10px; max-width: 620px; }
.forgot-box {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px dashed var(--el-border-color-lighter, #ebeef5);
}
.forgot-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.forgot-title { font-size: 13px; font-weight: 600; }
.recovery-input { width: 170px; }
/* v2.6.0：修改密码身份验证 */
/* v3.0.0（R12）：三个输入框合并成一行（输入框 + 发送验证码按钮） */
.pwd-verify-row { display: flex; align-items: center; gap: 8px; width: 100%; max-width: 480px; }
.pwd-verify-row .pwd-verify-input { flex: 1 1 auto; max-width: none; }
.pwd-verify-input { max-width: 360px; }
.recovery-alert { margin-bottom: 14px; }
.recovery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-top: 6px;
}
.recovery-grid code {
    display: block;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--el-fill-color-light, #f5f7fa);
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 14px;
    letter-spacing: 1px;
    text-align: center;
}
.resend-row { margin-top: 10px; }
/* v3.0.0：实例管理模块 */
.instance-actions { display: flex; gap: 10px; margin-bottom: 12px; }
.instance-table { width: 100%; margin-bottom: 8px; }
/*
 * v3.0.0：实例列表行高调高（原先 el-table size="small" 行高偏挤，序号 + 名称看不清楚）。
 * 单元格 padding 提到 12px 14px，行最小高度 52px。
 */
.instance-table :deep(.el-table__row) { height: 52px; }
.instance-table :deep(.el-table__row > td.el-table__cell) { padding: 12px 14px; }
.instance-table :deep(.el-table__header th.el-table__cell) { padding: 10px 14px; }
.instance-table :deep(.cell) { line-height: 22px; }
/* 「1 · 工作库」整行展示：序号 + 名称在同一行，超长省略 */
.instance-label {
    display: inline-block;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: middle;
}
/* v3.0.0：锚点定位到本区块时的高亮（2 秒后自动褪去） */
.edit-card.is-anchor-highlight {
    box-shadow: 0 0 0 2px var(--el-color-primary), var(--el-box-shadow-light);
    transition: box-shadow 0.3s ease;
}
/* v3.0.0：对外分享模块 */
.share-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-bottom: 6px; }
.share-btn-icon { margin-right: 6px; }
/* v3.0.0（R5）：加入实例的邀请码输入框改为与用户名输入框同宽（原 max-width:240px 已移除） */
.invite-box { display: flex; flex-direction: column; gap: 8px; }
.invite-code {
    padding: 6px 12px;
    border-radius: 8px;
    background: var(--el-fill-color-light, #f5f7fa);
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 18px;
    letter-spacing: 3px;
    user-select: all;
}
/*
 * v3.0.0（R14）：保存按钮改为「悬浮在右下角」——
 * 原来是一条 sticky 底栏通栏铺开，滚动到页面底部才看到；
 * 现在固定悬浮，任何位置都能直接保存（与后台系统设置的悬浮保存按钮观感一致）。
 */
.save-bar {
    position: fixed;
    right: 20px;
    bottom: calc(20px + env(safe-area-inset-bottom, 0px));
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 999px;
    background: var(--el-bg-color, #fff);
    border: 1px solid var(--el-border-color-lighter);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
}
.save-bar .el-button {
    margin-left: 0;
}
@media (max-width: 768px) {
    .avatar-row { flex-direction: column; align-items: flex-start; }
    .channel-form { flex-direction: column; }
    /* v3.0.0：实例表格移动端不变形 —— 收窄内边距、序号与名称保持单行省略，横向溢出交给表格自滚动 */
    .instance-table :deep(.el-table__row) { height: 48px; }
    .instance-table :deep(.el-table__row > td.el-table__cell) { padding: 10px 8px; }
    .instance-table :deep(.el-table__header th.el-table__cell) { padding: 8px; }
    .instance-table :deep(.cell) { font-size: 12px; }
    .share-row { align-items: flex-start; flex-direction: column; gap: 10px; }
}
</style>
