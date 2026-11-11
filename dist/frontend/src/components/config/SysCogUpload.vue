<template>
    <div class="upload-settings" v-loading="loading">
        <!-- 存储通用设置：外链分发 + 主备渠道 + 去重等存储相关全局配置 -->
        <div class="page-header">
            <h3 class="first-title">存储通用设置</h3>
        </div>

        <!-- 外链分发设置：模式 + 访问源一键切换 -->
        <div class="storage-bar">
            <div class="storage-row">
                <div class="mb-item">
                    <span class="mb-label">外链模式</span>
                    <el-radio-group
                        :model-value="storage.linkMode"
                        size="small"
                        @change="(v) => saveStorage({ linkMode: v })"
                    >
                        <el-radio-button label="proxy">代理模式</el-radio-button>
                        <el-radio-button label="redirect">302 重定向</el-radio-button>
                    </el-radio-group>
                    <el-tooltip placement="top" raw-content>
                        <template #content>
                            <div style="max-width: min(360px, 78vw); line-height: 1.7;">
                                <b>代理模式（默认）</b>：服务端拉取上游字节并转发，外链地址恒定不变，<br>
                                支持 Range 断点/拖动播放，上游故障可自动降级。<br>
                                <b>302 重定向</b>：由浏览器直接访问上游图床，服务端流量最小。
                            </div>
                        </template>
                        <font-awesome-icon icon="question-circle" class="help-icon"/>
                    </el-tooltip>
                </div>
                <div class="mb-item">
                    <span class="mb-label">当前访问源</span>
                    <el-radio-group
                        :model-value="storage.accessChannel"
                        size="small"
                        :disabled="!backupChannel"
                        @change="(v) => saveStorage({ accessChannel: v })"
                    >
                        <el-radio-button label="main">主渠道</el-radio-button>
                        <el-radio-button label="backup">备份渠道</el-radio-button>
                    </el-radio-group>
                    <span class="mb-hint">切换后所有存量外链立即生效</span>
                </div>
                <div class="mb-item mb-right">
                    <el-button size="small" text type="primary" @click="showProxyConfig = !showProxyConfig">
                        <font-awesome-icon icon="sliders-h" style="margin-right: 4px;"/>代理参数
                    </el-button>
                </div>
            </div>

            <div class="storage-row">
                <div class="mb-item">
                    <span class="mb-label">主渠道（同步上传）</span>
                    <template v-if="mainChannel">
                        <ChannelIcon :type="mainChannel.type" class="mb-icon"/>
                        <span class="mb-name">{{ mainChannel.name }}</span>
                        <el-tag size="small" type="success">启用中</el-tag>
                    </template>
                    <span v-else class="mb-empty">未设置</span>
                </div>
                <div class="mb-item">
                    <span class="mb-label">备份渠道（异步双写）</span>
                    <template v-if="backupChannel">
                        <ChannelIcon :type="backupChannel.type" class="mb-icon"/>
                        <span class="mb-name">{{ backupChannel.name }}</span>
                        <el-tag size="small" type="warning">已启用</el-tag>
                    </template>
                    <span v-else class="mb-empty">未设置（不启用双写）</span>
                </div>
            </div>

            <!-- v2.4.0：备用库预览（只读，可展开下拉查看）—— 自定义访问域名的上一行 -->
            <div class="storage-row">
                <div class="mb-item domain-item">
                    <span class="mb-label">备用库预览</span>
                    <!--
                        v2.5.0：去掉 disabled —— 冻结状态下拉无法展开，用户看不到池内渠道。
                        仍保持只读语义：选择动作会被还原并提示真正的设置入口（key 强制重渲染）。
                    -->
                    <el-select
                        :key="poolPreviewKey"
                        :model-value="backupPoolIds"
                        multiple
                        collapse-tags
                        size="small"
                        class="domain-input pool-preview-select"
                        placeholder="未设置备用库"
                        @change="onPoolPreviewChange"
                    >
                        <el-option
                            v-for="c in backupPoolChannels"
                            :key="c.id"
                            :label="`${c.code} · ${c.name}`"
                            :value="c.id"
                        />
                    </el-select>
                    <el-tooltip placement="top" raw-content>
                        <template #content>
                            <div style="max-width: min(360px, 78vw); line-height: 1.7;">
                                只读展示哪些渠道被设为了「备用库」（主渠道上传失败时的轮换池）。<br>
                                设置入口：下方渠道卡片的操作菜单里「设为备用库 / 取消备用库」。
                            </div>
                        </template>
                        <font-awesome-icon icon="question-circle" class="help-icon"/>
                    </el-tooltip>
                </div>
            </div>

            <div class="storage-row">
                <div class="mb-item domain-item">
                    <span class="mb-label">外链访问域名</span>
                    <el-input
                        v-model="storage.customDomain"
                        size="small"
                        placeholder="https://img.example.com（留空则使用动态浏览域名）"
                        clearable
                        class="domain-input"
                        @change="saveStorage({ customDomain: storage.customDomain })"
                    />
                    <el-tooltip placement="top" raw-content>
                        <template #content>
                            <div style="max-width: min(360px, 78vw); line-height: 1.7;">
                                全站文件外链的签发域名统一使用该配置，例如 <b>https://img.example.com/file/xxx.png</b>。<br>
                                留空则使用「动态浏览域名」（优先 <b>X-Forwarded-Host</b>，其次 <b>Host</b>，最后 localhost）。<br>
                                只影响本站签发的外链，<b>不会</b>覆盖各存储渠道自己的「公开访问域名」。
                            </div>
                        </template>
                        <font-awesome-icon icon="question-circle" class="help-icon"/>
                    </el-tooltip>
                </div>
            </div>

            <div class="storage-row">
                <div class="mb-item">
                    <span class="mb-label">上传去重</span>
                    <el-switch
                        :model-value="storage.dedupEnabled"
                        @change="(v) => saveStorage({ dedupEnabled: v })"
                    />
                    <span class="mb-hint">开启后：先比文件大小（快速过滤），大小一致再比 MD5（精确校验），重复文件不再上传、直接返回已有外链</span>
                </div>
                <div class="mb-item mb-right"></div>
            </div>

            <div class="storage-row">
                <div class="mb-item">
                    <span class="mb-label">{{ $t('sysUpload.dedupScope') }}</span>
                    <el-radio-group
                        :model-value="storage.dedupScope"
                        size="small"
                        :disabled="!storage.dedupEnabled"
                        @change="(v) => saveStorage({ dedupScope: v })"
                    >
                        <el-radio-button label="all">{{ $t('sysUpload.dedupScopeAll') }}</el-radio-button>
                        <el-radio-button label="channelType">{{ $t('sysUpload.dedupScopeChannelType') }}</el-radio-button>
                        <el-radio-button label="channel">{{ $t('sysUpload.dedupScopeChannel') }}</el-radio-button>
                    </el-radio-group>
                    <el-tooltip placement="top" raw-content>
                        <template #content>
                            <div style="max-width: min(420px, 78vw); line-height: 1.7;" v-html="$t('sysUpload.dedupScopeTip')"></div>
                        </template>
                        <font-awesome-icon icon="question-circle" class="help-icon"/>
                    </el-tooltip>
                </div>
            </div>

            <div v-if="showProxyConfig" class="storage-row proxy-config">
                <div class="mb-item">
                    <span class="mb-label">上游超时</span>
                    <el-input-number v-model="storage.proxyTimeoutMs" :min="1000" :max="120000" :step="1000" size="small" controls-position="right"/>
                    <span class="mb-hint">毫秒</span>
                </div>
                <div class="mb-item">
                    <span class="mb-label">客户端缓存</span>
                    <el-input-number v-model="storage.proxyCacheSeconds" :min="0" :max="31536000" :step="3600" size="small" controls-position="right"/>
                    <span class="mb-hint">秒（0 = 不缓存）</span>
                </div>
                <div class="mb-item mb-right">
                    <el-button size="small" type="primary" @click="saveStorage({ proxyTimeoutMs: storage.proxyTimeoutMs, proxyCacheSeconds: storage.proxyCacheSeconds })">保存参数</el-button>
                </div>
            </div>
        </div>

        <!-- 存储渠道管理：渠道分组列表（每类可折叠） -->
        <div class="page-header channel-section-header">
            <h3 class="first-title">
                存储渠道管理
                <el-tooltip placement="right" raw-content>
                    <template #content>
                        <div style="max-width: min(420px, 78vw); line-height: 1.7;">
                            支持 10 类渠道：EasyImages、Lsky Pro、腾讯云 COS、阿里云 OSS、Immich、MinIO、<br>
                            Cloudflare R2、S3 兼容存储、WebDAV、自定义 Web 通道。<br>
                            其中 <b>腾讯云 COS / 阿里云 OSS / MinIO / R2 / S3 / WebDAV / Immich 走各自专属通道</b>；<br>
                            EasyImages / Lsky Pro / 自定义 Web 通道 走<b>通用 HTTP 上传适配器</b>（按预设字段自动适配）。<br>
                            可指定 1 个<b>主渠道</b>（同步上传）与 1 个<b>备份渠道</b>（异步上传，不阻塞响应）。
                        </div>
                    </template>
                    <font-awesome-icon icon="question-circle" class="help-icon"/>
                </el-tooltip>
            </h3>
            <div class="header-actions">
                <CustomSelect
                    v-model="channelFilter"
                    :options="filterOptions"
                    placeholder="按渠道类型筛选"
                    width="180px"
                />
            </div>
        </div>
        <el-divider class="channel-section-divider"/>

        <!-- 渠道卡片列表 - 按类型分组 -->
        <div v-for="channelType in filteredChannels" :key="channelType.value" class="channel-group">
            <div class="group-header">
                <div class="group-title">
                    <ChannelIcon :type="channelType.value" class="group-icon"/>
                    <span>{{ channelType.label }}</span>
                    <el-tag size="small" type="info" class="channel-count">
                        {{ getChannelList(channelType.value).length }}
                    </el-tag>
                    <!-- v3.0.0（R8）：本地存储 / 本地文件 显示「本地通道」，其余类型保持「专属通道」 -->
                    <el-tag v-if="channelType.dedicated && isLocalType(channelType.value)" size="small" type="primary" effect="plain" :title="$t('sysUpload.localChannel')">{{ $t('sysUpload.localChannel') }}</el-tag>
                    <el-tag v-else-if="channelType.dedicated" size="small" type="primary" effect="plain" :title="$t('sysUpload.dedicatedChannel')">{{ $t('sysUpload.dedicatedChannel') }}</el-tag>
                    <el-tooltip v-else-if="channelType.generic" :content="$t('sysUpload.genericChannelTip')" placement="top" raw-content>
                        <el-tag size="small" type="info" effect="plain">{{ $t('sysUpload.genericChannel') }}</el-tag>
                    </el-tooltip>
                </div>
                <!-- 收缩按钮：折叠/展开该分类下的渠道列表 -->
                <el-button
                    class="group-collapse-btn"
                    text
                    size="small"
                    :title="isGroupCollapsed(channelType.value) ? '展开' : '收缩'"
                    @click="toggleGroup(channelType.value)"
                >
                    <font-awesome-icon :icon="isGroupCollapsed(channelType.value) ? 'chevron-down' : 'chevron-up'"/>
                </el-button>
            </div>

            <!-- 渠道卡片网格 -->
            <div class="channel-cards" v-if="getChannelList(channelType.value).length > 0" v-show="!isGroupCollapsed(channelType.value)">
                <div
                    v-for="channel in getChannelList(channelType.value)"
                    :key="channel.id"
                    class="channel-card"
                    :class="[channelType.value, { 'disabled': !channel.enabled }]"
                >
                    <div class="card-header">
                        <div class="card-title">
                            <span class="channel-name">{{ channel.name }}</span>
                        </div>
                        <el-switch
                            :model-value="channel.enabled"
                            size="small"
                            @change="(val) => toggleChannelEnabled(channel, val)"
                        />
                    </div>
                    <div class="card-body">
                        <div class="card-info">
                            <div
                                v-for="[k, label] in summaryKeys(channelType.value)"
                                :key="k"
                                class="info-item"
                                v-show="channel.config?.[k]"
                            >
                                <font-awesome-icon icon="link" class="info-icon"/>
                                <span class="info-text" :title="channel.config?.[k]">{{ label }}: {{ channel.config?.[k] }}</span>
                            </div>
                            <div v-if="channel.config?.remark" class="info-item">
                                <font-awesome-icon icon="comment-dots" class="info-icon"/>
                                <span class="info-text" :title="channel.config.remark">备注: {{ channel.config.remark }}</span>
                            </div>
                        </div>
                        <!-- 容量显示 -->
                        <div v-if="channel.quota?.enabled" class="quota-mini">
                            <el-progress
                                :percentage="quotaPct(channel)"
                                :status="quotaStatus(channel)"
                                :stroke-width="6"
                            />
                            <span class="quota-text">{{ quotaText(channel) }}</span>
                        </div>
                        <!--
                            v2.3.0：主渠道 / 备份渠道 / 备用库 三个标记从卡片标题右侧
                            统一挪到内容摘要区最后一行，全部一起展示（可同时存在多个）。
                        -->
                        <div class="card-status-row">
                            <el-tag v-if="channel.isMain" size="small" type="success" effect="light">主渠道</el-tag>
                            <el-tag v-if="channel.isBackup" size="small" type="warning" effect="light">备份渠道</el-tag>
                            <el-tag v-if="channel.backupPool" size="small" type="info" effect="light">备用库</el-tag>
                            <el-tag
                                v-if="!channel.isMain && !channel.isBackup && !channel.backupPool"
                                size="small"
                                type="info"
                                effect="plain"
                                class="is-plain"
                            >普通渠道</el-tag>
                        </div>
                    </div>
                    <div class="card-actions">
                        <!--
                            v2.8.6：卡片上的「测试」按钮已移除（连接测试统一收在「详情 / 编辑」弹窗里），
                            释放出来的宽度让「详情 / 编辑 / 授权 / 更多」四个按钮稳定排在同一行。
                        -->
                        <el-button text type="primary" size="small" @click="openDetailDialog(channelType.value, channel)">
                            <font-awesome-icon icon="eye" style="margin-right: 3px;"/>详情
                        </el-button>
                        <el-button text type="primary" size="small" @click="openEditDialog(channelType.value, channel)">
                            <font-awesome-icon icon="edit" style="margin-right: 3px;"/>编辑
                        </el-button>
                        <!--
                            v2.6.0：本地存储渠道也开放「授权」设置（名单为空 = 全员可用兜底，非空 = 仅勾选账户）
                            v1.0.5：本地文件渠道同样纳入授权体系 ——
                            名单为空时普通用户看不到「本地文件」入口，勾选后仅名单内账户可见。
                        -->
                        <el-button
                            text
                            type="primary"
                            size="small"
                            @click="openAuthDialog(channel)"
                        >
                            <font-awesome-icon icon="user-cog" style="margin-right: 3px;"/>授权
                        </el-button>
                        <el-dropdown trigger="click" @command="(cmd) => handleCardCommand(cmd, channel)">
                            <el-button text type="primary" size="small">
                                <font-awesome-icon icon="ellipsis-h" style="margin-right: 3px;"/>更多
                            </el-button>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <!-- v3.0.0：本地文件渠道不参与上传，不提供主/备渠道标记 -->
                                    <el-dropdown-item v-if="channel.type !== 'localfiles'" command="setMain" :disabled="channel.isMain">
                                        <font-awesome-icon icon="star" style="margin-right: 6px;"/>设为主渠道
                                    </el-dropdown-item>
                                    <el-dropdown-item v-if="channel.type !== 'localfiles'" command="setBackup" :disabled="channel.isBackup">
                                        <font-awesome-icon icon="copy" style="margin-right: 6px;"/>设为备份渠道
                                    </el-dropdown-item>
                                    <el-dropdown-item v-if="channel.type !== 'localfiles'" command="togglePool">
                                        <font-awesome-icon icon="database" style="margin-right: 6px;"/>{{ channel.backupPool ? '取消备用库' : '设为备用库' }}
                                    </el-dropdown-item>
                                    <el-dropdown-item
                                        command="clearFlag"
                                        :disabled="!channel.isMain && !channel.isBackup"
                                    >
                                        <font-awesome-icon icon="times" style="margin-right: 6px;"/>取消主/备标记
                                    </el-dropdown-item>
                                    <el-dropdown-item divided command="delete" :disabled="channel.type === 'local'">
                                        <span style="color: var(--el-color-danger);">
                                            <font-awesome-icon icon="trash-alt" style="margin-right: 6px;"/>{{ channel.type === 'local' ? '内置渠道不可删除' : '删除渠道' }}
                                        </span>
                                    </el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>
                    </div>
                </div>
            </div>
            <div v-else class="empty-tip" v-show="!isGroupCollapsed(channelType.value)">
                <font-awesome-icon icon="inbox" class="empty-icon"/>
                <span>暂无 {{ channelType.label }} 渠道</span>
            </div>
        </div>

        <!-- 用户授权弹窗：勾选哪些账户可以使用该渠道 -->
        <el-dialog
            v-model="showAuthDialog"
            :title="`用户授权 - ${authChannel?.name || ''}`"
            class="channel-dialog auth-dialog"
            width="560px"
        >
            <div class="auth-tip">
                <font-awesome-icon icon="info-circle" style="margin-right: 6px;"/>
                仅被勾选的账户能在自己的上传设置里看到并使用该渠道；管理员不受限制，始终可用。
                <template v-if="authChannel?.type === 'local'">内置本地存储渠道自 v2.7.0 起与其它渠道规则完全一致：名单为空时普通用户不可见（管理员不受限），勾选后仅名单内账户可用。</template>
                <template v-else-if="authChannel?.type === 'localfiles'">挂载文件渠道：名单为空时普通用户在左栏看不到「挂载管理」入口；勾选后，名单内账户可浏览该渠道下的目录，并在「挂载管理」页把文件上传到图床。</template>
            </div>
            <!--
                v1.0.6：「自动授权所有用户」开关。
                打开后该渠道对全体账户开放，**包括以后新建的账户**（不用再回来勾一遍）。
                内置本地存储渠道（999999）恒为打开且锁定 —— 每个用户的默认本地目录都挂在它下面。
            -->
            <div class="auth-all-row">
                <el-switch v-model="authAll" :disabled="authAllLocked || authLoading"/>
                <div class="auth-all-text">
                    <div class="auth-all-title">自动授权所有用户</div>
                    <div class="auth-all-desc">
                        打开后对所有账户开放（含以后新建的账户）；关闭时只对下方勾选的账户开放。
                        <template v-if="authAllLocked">
                            <br><b>内置本地存储渠道必须对所有账户开放，此开关不可关闭。</b>
                        </template>
                    </div>
                </div>
            </div>
            <div v-loading="authLoading" class="auth-body">
                <el-checkbox-group v-model="authSelected" v-if="authUsers.length">
                    <el-checkbox
                        v-for="u in authUsers"
                        :key="u.username"
                        :label="u.username"
                        class="auth-item"
                    >
                        <span class="auth-name">{{ u.nickname || u.username }}</span>
                        <span class="auth-account">{{ u.username }}</span>
                        <el-tag v-if="u.role === 'admin' || u.role === 'super'" size="small" type="success" effect="plain">管理员</el-tag>
                    </el-checkbox>
                </el-checkbox-group>
                <div v-else class="auth-empty">暂无其它账户，可先在「用户管理」里创建账户。</div>
            </div>
            <template #footer>
                <el-button @click="showAuthDialog = false">取消</el-button>
                <el-button type="primary" :loading="authSaving" @click="saveAuth">保存授权</el-button>
            </template>
        </el-dialog>

        <!-- 添加渠道弹窗 -->
        <el-dialog
            v-model="showAddDialog"
            title="添加存储渠道"
            class="channel-dialog"
            destroy-on-close
            @closed="resetAddForm"
        >
            <el-form :model="newChannel" label-position="top" ref="addForm" :rules="formRules">
                <el-form-item label="渠道类型" prop="type">
                    <el-select v-model="newChannel.type" placeholder="请选择渠道类型" style="width: 100%;" @change="onChannelTypeChange">
                        <el-option v-for="ch in addableChannels" :key="ch.value" :label="ch.label" :value="ch.value">
                            <span class="channel-type-option">
                                <ChannelIcon :type="ch.value" class="select-option-icon"/>
                                <span>{{ ch.label }}</span>
                                <el-tag v-if="ch.dedicated && isLocalType(ch.value)" size="small" type="primary" effect="plain" style="margin-left: 6px;">{{ $t('sysUpload.localChannel') }}</el-tag>
                                <el-tag v-else-if="ch.dedicated" size="small" type="primary" effect="plain" style="margin-left: 6px;">{{ $t('sysUpload.dedicatedChannel') }}</el-tag>
                                <el-tag v-else-if="ch.generic" size="small" type="info" effect="plain" style="margin-left: 6px;">{{ $t('sysUpload.genericChannel') }}</el-tag>
                            </span>
                        </el-option>
                    </el-select>
                </el-form-item>
                <el-form-item label="渠道名称" prop="name">
                    <el-input v-model="newChannel.name" placeholder="仅支持中英文、数字、下划线、连字符"/>
                    <!-- v3.0.0（R8）：本地文件渠道的用途提示（添加页） -->
                    <div v-if="newChannel.type === 'localfiles'" class="localfiles-purpose-hint">
                        本渠道不能存储，是用于在挂载管理中浏览挂载目录所用，请在此设置需要浏览的目录（含宿主机映射目录）
                    </div>
                    <template #label>
                        <span>渠道名称</span>
                        <el-tooltip content="名称不能重复（重名会拒绝保存）；保存后仍可修改，改完请在保存时留意是否重名。备份渠道需与主渠道不同账户" placement="top">
                            <font-awesome-icon icon="exclamation-triangle" class="inline-warning-icon"/>
                        </el-tooltip>
                    </template>
                </el-form-item>

                <!-- 动态字段 -->
                <template v-if="newChannel.type">
                    <div v-if="currentTypeTip" class="form-warning" style="margin-top: 0;">
                        <font-awesome-icon icon="info-circle" style="margin-right: 6px;"/>
                        <span>{{ currentTypeTip }}</span>
                    </div>
                    <ChannelFields
                        :fields="currentFields"
                        :model="newChannel.config"
                    />
                    <!-- v3.0.0：本地渠道的备注走契约字段 note（在 ChannelFields 内渲染），隐藏通用 remark 输入框 -->
                    <el-form-item v-if="!isLocalDialog" label="备注（可选）">
                        <el-input
                            v-model="newChannel.config.remark"
                            type="textarea"
                            :autosize="{ minRows: 2, maxRows: 5 }"
                            placeholder="给这个渠道写点备注，例如：用途、密钥归属、到期时间等"
                        />
                    </el-form-item>
                    <div class="form-hint-bar">
                        <span class="hint-text">建议先「测试连接」确认配置可用，再保存。</span>
                        <el-button v-if="newChannel.type !== 'localfiles'" size="small" :loading="testing" @click="testDraft">测试连接</el-button>
                    </div>
                    <div v-if="testResult" class="test-result" :class="testResult.success ? 'ok' : 'fail'">
                        <font-awesome-icon :icon="testResult.success ? 'check-circle' : 'times-circle'" style="margin-right: 6px;"/>
                        <span>{{ testResult.message }}</span>
                        <a v-if="testResult.url" :href="testResult.url" target="_blank" rel="noreferrer" style="margin-left: 8px;">查看直链</a>
                    </div>
                </template>
            </el-form>
            <template #footer>
                <el-button @click="showAddDialog = false">取消</el-button>
                <el-button type="primary" :loading="saving" @click="confirmAddChannel">确认添加</el-button>
            </template>
        </el-dialog>

        <!-- 详情弹窗 -->
        <el-dialog v-model="showDetailDialog" :title="`渠道详情 - ${currentChannel?.name || ''}`" class="channel-dialog">
            <el-descriptions :column="1" border class="channel-details">
                <el-descriptions-item label="渠道名称">{{ currentChannel?.name }}</el-descriptions-item>
                <el-descriptions-item label="渠道 ID">
                    <div class="channel-id-row">
                        <span class="channel-id-value">{{ currentChannel?.code || '-' }}</span>
                        <el-button text size="small" :disabled="!currentChannel?.code" @click="copyChannelId(currentChannel.code)">
                            <font-awesome-icon icon="copy"/>
                        </el-button>
                    </div>
                </el-descriptions-item>
                <el-descriptions-item label="渠道类型">{{ getChannelTypeLabel(currentChannelType) }}</el-descriptions-item>
                <el-descriptions-item label="状态">
                    <el-tag :type="currentChannel?.enabled ? 'success' : 'info'">
                        {{ currentChannel?.enabled ? '已启用' : '已禁用' }}
                    </el-tag>
                    <el-tag v-if="currentChannel?.isMain" type="success" style="margin-left: 6px;">主渠道</el-tag>
                    <el-tag v-if="currentChannel?.isBackup" type="warning" style="margin-left: 6px;">备份渠道</el-tag>
                </el-descriptions-item>
                <el-descriptions-item
                    v-for="f in detailFields"
                    :key="f.key"
                    :label="f.label"
                >
                    <el-input
                        v-if="f.type === 'textarea'"
                        :model-value="displayConfigValue(f)"
                        type="textarea"
                        :autosize="{ minRows: 2 }"
                        readonly
                    />
                    <span v-else>{{ displayConfigValue(f) }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="备注">
                    <span v-if="currentChannel?.config?.remark" style="white-space: pre-wrap;">{{ currentChannel.config.remark }}</span>
                    <span v-else style="color: var(--el-text-color-secondary);">无</span>
                </el-descriptions-item>
            </el-descriptions>
            <template #footer>
                <el-button @click="showDetailDialog = false">关闭</el-button>
                <el-button v-if="currentChannel?.type !== 'localfiles'" @click="testChannel(currentChannel)">测试连接</el-button>
                <el-button type="primary" @click="openEditFromDetail">编辑</el-button>
            </template>
        </el-dialog>

        <!-- 编辑弹窗 -->
        <el-dialog v-model="showEditDialog" :title="`编辑渠道 - ${editChannel?.name || ''}`" class="channel-dialog" destroy-on-close>
            <el-form label-position="top">
                <el-form-item label="渠道 ID">
                    <!-- 渠道 ID = 6 位 code，API Token / S3 协议的 bucket、外链 ?channel= 都用它 -->
                    <div class="channel-id-row">
                        <span class="channel-id-value" :title="editChannel.code">{{ editChannel.code || '-' }}</span>
                        <el-button text size="small" :disabled="!editChannel.code" @click="copyChannelId(editChannel.code)">
                            <font-awesome-icon icon="copy"/>
                        </el-button>
                    </div>
                </el-form-item>
                <el-form-item label="渠道名称">
                    <el-input v-model="editChannel.name" placeholder="仅支持中英文、数字、下划线、连字符"/>
                    <!-- v3.0.0（R8）：本地文件渠道的用途提示（编辑页） -->
                    <div v-if="editChannel.type === 'localfiles'" class="localfiles-purpose-hint">
                        本渠道不能存储，是用于在挂载管理中浏览挂载目录所用，请在此设置需要浏览的目录（含宿主机映射目录）
                    </div>
                    <div class="form-hint-bar form-hint-bar--inline">
                        <span class="hint-text">名称可以修改；保存时会校验是否与其它渠道重名，重名无法保存。</span>
                    </div>
                </el-form-item>
                <el-form-item label="启用该渠道">
                    <el-switch v-model="editChannel.enabled"/>
                </el-form-item>
                <ChannelFields
                    :fields="currentFields"
                    :model="editChannel.config"
                />
                <!-- v3.0.0：本地渠道的备注走契约字段 note（在 ChannelFields 内渲染），隐藏通用 remark 输入框 -->
                <el-form-item v-if="!isLocalDialog" label="备注（可选）">
                    <el-input
                        v-model="editChannel.config.remark"
                        type="textarea"
                        :autosize="{ minRows: 2, maxRows: 5 }"
                        placeholder="给这个渠道写点备注，例如：用途、密钥归属、到期时间等"
                    />
                </el-form-item>
                <div class="form-hint-bar">
                    <span class="hint-text">密钥留空或显示 **** 表示不修改原值。</span>
                    <el-button v-if="editChannel.type !== 'localfiles'" size="small" :loading="testing" @click="testEditChannel">测试连接</el-button>
                </div>
                <div v-if="testResult" class="test-result" :class="testResult.success ? 'ok' : 'fail'">
                    <font-awesome-icon :icon="testResult.success ? 'check-circle' : 'times-circle'" style="margin-right: 6px;"/>
                    <span>{{ testResult.message }}</span>
                </div>
            </el-form>
            <template #footer>
                <el-button @click="showEditDialog = false">取消</el-button>
                <el-button type="primary" :loading="saving" @click="confirmEditChannel">保存修改</el-button>
            </template>
        </el-dialog>

        <!--
            v1.1.4：「添加渠道」从页头按钮改成右下角圆形悬浮按钮（固定定位，不随页面滚动）。
            默认只显示「+」号；桌面端鼠标移上去自动展开文字（移动端保持圆形，避免误触）。
        -->
        <div class="channel-fab-wrap">
            <button
                type="button"
                class="channel-fab"
                :title="'添加渠道'"
                :aria-label="'添加渠道'"
                @click="openAddDialog"
            >
                <font-awesome-icon icon="plus" class="channel-fab-icon"/>
                <span class="channel-fab-text">添加渠道</span>
            </button>
        </div>
    </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import ChannelIcon from '@/components/icons/ChannelIcon.vue';
import ChannelFields from './ChannelFields.vue';
import CustomSelect from './CustomSelect.vue';
import { CHANNEL_TYPES, ADDABLE_CHANNEL_TYPES, SUMMARY_KEYS, TYPE_TIPS, fieldsOf, buildDefaults, buildDefaultsFrom, visibleFields, LOCAL_CHANNEL_CODE, LOCAL_FILES_CHANNEL_CODE, LOCAL_BUILTIN_FIELDS, LOCAL_CUSTOM_FIELDS, LOCAL_FILES_BUILTIN_FIELDS } from './channel-schema';
import { copyText } from '@/utils/clipboard';
import { invalidateStorageChannels } from '@/utils/storageChannels';

export default {
    name: 'SysCogUpload',
    components: {
        ChannelIcon,
        ChannelFields,
        CustomSelect
    },
    data() {
        return {
            channelFilter: '',
            channels: CHANNEL_TYPES,

            // 每个渠道分类的折叠状态（key = 渠道类型 value）
            collapsedGroups: {},

            // 按类型分组的渠道数据（来自 /api/manage/channels）
            groups: {},

            // 外链分发设置（/api/manage/storage）
            storage: {
                linkMode: 'proxy',
                accessChannel: 'main',
                proxyTimeoutMs: 15000,
                proxyCacheSeconds: 86400,
                dedupEnabled: false,
                dedupScope: 'all',
                customDomain: ''
            },
            showProxyConfig: false,

            showAddDialog: false,
            showDetailDialog: false,
            showEditDialog: false,

            // v2.5.0：备用库预览下拉还原用的重渲染 key（只读预览，误选后强制复位）
            poolPreviewKey: 0,

            currentChannelType: '',
            currentChannel: null,
            editChannel: { name: '', enabled: true, config: {} },

            newChannel: { type: '', name: '', config: {} },

            testing: false,
            testResult: null,
            saving: false,
            loading: false,

            // 用户授权弹窗
            showAuthDialog: false,
            authChannel: null,
            authUsers: [],
            authSelected: [],
            /** v1.0.6：自动授权所有用户（内置本地存储渠道恒 true 且禁止关闭） */
            authAll: false,
            authAllLocked: false,
            authLoading: false,
            authSaving: false,

            formRules: {
                type: [{ required: true, message: '请选择渠道类型', trigger: 'change' }],
                name: [
                    { required: true, message: '请输入渠道名称', trigger: 'blur' },
                    { pattern: /^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/, message: '仅支持中英文、数字、下划线、连字符', trigger: 'blur' }
                ]
            }
        };
    },
    computed: {
        /** 「添加渠道」可选的类型 —— 系统内置的本地存储不允许再新建。
         *  v3.0.0（R5）：按 typeCode 升序渲染，「本地文件」(1000) 因此排在「本地存储」(998) 之后。 */
        addableChannels() {
            return [...ADDABLE_CHANNEL_TYPES].sort((a, b) => (a.typeCode || 0) - (b.typeCode || 0));
        },
        filterOptions() {
            return [
                { value: '', label: '全部类型' },
                ...this.channels.map((ch) => ({ value: ch.value, label: ch.label, channelType: ch.value }))
            ];
        },
        filteredChannels() {
            if (!this.channelFilter) return this.channels;
            return this.channels.filter((ch) => ch.value === this.channelFilter);
        },
        allChannels() {
            const out = [];
            for (const t of this.channels) {
                for (const c of (this.groups[t.value] || [])) out.push(c);
            }
            return out;
        },
        mainChannel() {
            return this.allChannels.find((c) => c.isMain) || null;
        },
        backupChannel() {
            return this.allChannels.find((c) => c.isBackup) || null;
        },
        /** v2.4.0：被设为「备用库」的渠道列表（只读预览） */
        backupPoolChannels() {
            return this.allChannels.filter((c) => c.backupPool);
        },
        backupPoolIds() {
            return this.backupPoolChannels.map((c) => c.id);
        },        currentFields() {
            const type = this.showAddDialog ? this.newChannel.type : this.currentChannelType;
            if (!type) return [];
            /*
             * v3.0.0：本地存储渠道按上下文区分字段 ——
             *   · 添加渠道 → 自定义本地渠道（rootPath / hostPath ...）；
             *   · 编辑 / 详情 → code=999999 用内置字段（prefixPath 固定 uploads/_user），其余 code 用自定义字段。
             */
            if (type === 'local') {
                if (this.showAddDialog) return LOCAL_CUSTOM_FIELDS();
                const channel = this.showEditDialog ? this.editChannel : this.currentChannel;
                return (channel?.code === LOCAL_CHANNEL_CODE)
                    ? this.lockDefaultLocalFields(LOCAL_BUILTIN_FIELDS())
                    : LOCAL_CUSTOM_FIELDS();
            }
            /*
             * v3.0.0（R11）：内置「本地文件」渠道（999990）的浏览目录由系统生成、
             * 后端强制固定为 uploads —— 编辑页做成只读，避免「改了但没生效」的误解。
             * 自建的本地文件渠道仍走可编辑字段。
             */
            if (type === 'localfiles' && !this.showAddDialog) {
                const channel = this.showEditDialog ? this.editChannel : this.currentChannel;
                return channel?.code === LOCAL_FILES_CHANNEL_CODE ? LOCAL_FILES_BUILTIN_FIELDS() : fieldsOf(type);
            }
            return fieldsOf(type);
        },
        /** v3.0.0：当前弹窗是否为本地渠道（本地渠道的备注走契约字段 note，不用通用 remark 输入框） */
        isLocalDialog() {
            const type = this.showAddDialog ? this.newChannel.type : this.currentChannelType;
            return type === 'local';
        },
        detailFields() {
            // 「启用容量限制」未开启时不展示容量上限 / 告警阈值
            return visibleFields(this.currentFields, this.currentChannel?.config);
        },
        currentTypeTip() {
            return TYPE_TIPS[this.newChannel.type] || '';
        }
    },
    methods: {
        /**
         * v1.0.6：内置本地存储渠道（999999）的「自定义存储前缀 / 自定义文件命名」置灰。
         *
         * 这条渠道承载的是每个用户的默认本地目录 uploads/{用户名}/999999：
         * 前缀或命名模板一旦被改，全站新上传文件的落盘路径会整体偏移，
         * 已有文件再也按原路径找不到，「本地文件」页里的默认加载项也会指向空目录。
         * 后端 PUT 里同样强制沿用原值，这里置灰只是让用户提前知道改不了。
         */
        lockDefaultLocalFields(fields) {
            const locked = ['objectPrefix', 'nameTemplate'];
            return (fields || []).map((f) =>
                locked.includes(f.key)
                    ? {
                          ...f,
                          fixed: true,
                          tip: `内置默认渠道固定使用默认配置，不可修改。${f.tip || ''}`,
                      }
                    : f,
            );
        },
        /**
         * v3.0.0（R8）：本地存储 / 本地文件 两类渠道的「专属通道」标签改显「本地通道」
         */
        isLocalType(type) {
            return type === 'local' || type === 'localfiles';
        },
        /**
         * v2.5.0：备用库预览下拉只读 —— 用户误点选项时还原选中态并提示真正入口。
         * 下拉本身可展开查看池内渠道（v2.4.0 的 disabled 冻结态无法展开，已移除）。
         */
        onPoolPreviewChange() {
            this.poolPreviewKey += 1
            this.$message({
                type: 'info',
                message: '备用库为只读预览；设置入口：渠道卡片操作菜单里的「设为备用库 / 取消备用库」',
                duration: 2500
            })
        },
        /** 渠道分类折叠 / 展开 */
        isGroupCollapsed(type) {
            return this.collapsedGroups[type] === true
        },
        toggleGroup(type) {
            this.collapsedGroups = { ...this.collapsedGroups, [type]: !this.collapsedGroups[type] }
        },
        getChannelList(type) {
            return this.groups[type] || [];
        },
        getChannelTypeLabel(type) {
            const ch = this.channels.find((c) => c.value === type);
            return ch ? ch.label : type;
        },
        summaryKeys(type) {
            return SUMMARY_KEYS[type] || [];
        },
        displayConfigValue(f) {
            const v = this.currentChannel?.config?.[f.key];
            if (v === undefined || v === null || v === '') return '未设置';
            if (f.type === 'switch') return v === 'true' ? '是' : '否';
            return v;
        },

        /* ------------ 数据加载 ------------ */
        async loadChannels() {
            this.loading = true;
            /*
             * v2.8.6：渠道列表有增删改时同步清掉「上传页渠道下拉」的模块级缓存，
             * 让停用的渠道立刻从前台上传设置的「存储渠道选择」里消失（无需刷新页面）。
             */
            invalidateStorageChannels();
            try {
                const resp = await fetchWithAuth('/api/manage/channels');
                if (resp.ok) {
                    const data = await resp.json();
                    const next = {};
                    for (const t of this.channels) next[t.value] = data[t.value] || [];
                    this.groups = next;
                }
            } catch (e) {
                console.error('加载渠道失败', e);
            } finally {
                this.loading = false;
            }
        },

        /* ------------ 外链分发设置 ------------ */
        async loadStorage() {
            try {
                const resp = await fetchWithAuth('/api/manage/storage');
                if (resp.ok) {
                    const d = await resp.json();
                    this.storage = {
                        linkMode: d.linkMode || 'proxy',
                        accessChannel: d.accessChannel || 'main',
                        proxyTimeoutMs: d.proxyTimeoutMs ?? 15000,
                        proxyCacheSeconds: d.proxyCacheSeconds ?? 86400,
                        dedupEnabled: d.dedupEnabled === true,
                        // v2.8.7b：all / channelType（同一渠道类型内）/ channel（同一渠道名称内）
                        dedupScope: d.dedupScope === 'channelType' ? 'channelType' : d.dedupScope === 'channel' ? 'channel' : 'all',
                        customDomain: d.customDomain || ''
                    };
                }
            } catch (e) {
                console.error('加载分发设置失败', e);
            }
        },
        async saveStorage(patch) {
            try {
                const resp = await fetchWithAuth('/api/manage/storage', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(patch)
                });
                const d = await resp.json();
                if (d.success) {
                    Object.assign(this.storage, patch);
                    this.$message.success('已生效');
                } else {
                    this.$message.error(d.message || '保存失败');
                }
            } catch (e) {
                this.$message.error('保存失败：' + e.message);
            }
        },

        /* ------------ 表单 ------------ */
        openAddDialog() {
            this.resetAddForm();
            this.showAddDialog = true;
        },
        resetAddForm() {
            this.newChannel = { type: '', name: '', config: {} };
            this.testResult = null;
        },
        onChannelTypeChange(type) {
            // v3.0.0：本地存储在「添加渠道」里代表自定义本地渠道，默认值按其字段生成
            this.newChannel.config = type === 'local'
                ? buildDefaultsFrom(LOCAL_CUSTOM_FIELDS())
                : buildDefaults(type);
            this.testResult = null;
        },
        /**
         * v1.0.9：本地存储渠道「自定义存储前缀」的一级目录禁止以 "_" 开头。
         *
         * 口径与后端 validateObjectPrefix 完全一致：先去掉开头的 "/"（用户常写成 /a/b），
         * 再看首字符是不是 "_"。磁盘上 `_user` / `_avatars` / `_ipdata` 都是系统保留目录，
         * 允许用户自定义到这些名字下会污染其它链路的数据。
         * 返回 true = 通过；不通过时这里已经弹过提示，调用方直接 return。
         */
        checkObjectPrefix(type, config) {
            if (type !== 'local') return true;
            const raw = String((config && config.objectPrefix) || '').trim().replace(/^\/+/, '');
            if (!raw.startsWith('_')) return true;
            this.$message.error(
                '「自定义存储前缀」的一级目录不能以 "_" 开头（_user / _avatars / _ipdata 是系统保留目录），请换一个名字',
            );
            return false;
        },
        collectConfig(model) {
            // 全部转换为字符串，布尔转 'true'/'false'（与后端适配器约定一致）
            const out = {};
            for (const [k, v] of Object.entries(model || {})) {
                if (v === undefined || v === null) continue;
                if (typeof v === 'boolean') out[k] = v ? 'true' : 'false';
                else out[k] = String(v);
            }
            return out;
        },

        async confirmAddChannel() {
            this.$refs.addForm.validate(async (valid) => {
                if (!valid) return;
                // v1.0.9：一级目录禁止以 "_" 开头（系统保留目录名）
                if (!this.checkObjectPrefix(this.newChannel.type, this.newChannel.config)) return;
                this.saving = true;
                try {
                    const resp = await fetchWithAuth('/api/manage/channels', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: this.newChannel.name,
                            type: this.newChannel.type,
                            config: this.collectConfig(this.newChannel.config)
                        })
                    });
                    const data = await resp.json();
                    if (data.success) {
                        this.$message.success('渠道添加成功');
                        this.showAddDialog = false;
                        await this.loadChannels();
                    } else {
                        this.$message.error(data.message || '添加失败');
                    }
                } catch (e) {
                    this.$message.error('添加失败：' + e.message);
                } finally {
                    this.saving = false;
                }
            });
        },

        openDetailDialog(type, channel) {
            this.currentChannelType = type;
            this.currentChannel = channel;
            this.showDetailDialog = true;
        },
        async         openEditDialog(type, channel) {
            this.currentChannelType = type;
            // v3.0.0：本地渠道按 code 区分内置 / 自定义字段集
            // v3.0.0（R11）：内置本地文件渠道（999990）用只读字段集
            const fields = type === 'local'
                ? (channel?.code === LOCAL_CHANNEL_CODE ? LOCAL_BUILTIN_FIELDS() : LOCAL_CUSTOM_FIELDS())
                : (type === 'localfiles' && channel?.code === LOCAL_FILES_CHANNEL_CODE ? LOCAL_FILES_BUILTIN_FIELDS() : null);
            this.editChannel = {
                id: channel.id,
                code: channel.code || '',
                name: channel.name,
                enabled: channel.enabled,
                config: this.normalizeForEdit(type, channel.config || {}, fields)
            };
            this.testResult = null;
            this.showEditDialog = true;
            /*
             * 列表接口出于安全只回脱敏值（形如 AKID****1234），「小眼睛」点开看到的也只是掩码。
             * 这里单独取一次明文回填，让凭据在编辑弹窗里真正完整可见。
             * 拉取失败不影响编辑：表单保持脱敏值，保存时后端会跳过含 **** 的字段（不覆盖原密文）。
             */
            try {
                const resp = await fetchWithAuth(`/api/manage/channels/${channel.id}/plain`);
                const data = await resp.json();
                if (data && data.success && data.config) {
                    const plain = this.normalizeForEdit(type, data.config, fields);
                    Object.keys(plain).forEach((k) => { this.editChannel.config[k] = plain[k]; });
                }
            } catch (e) {
                /* 明文拉取失败：保持脱敏值即可 */
            }
        },
        async copyChannelId(code) {
            if (!code) return;
            const ok = await copyText(String(code));
            this.$message({ type: ok ? 'success' : 'error', message: ok ? '已复制渠道 ID' : '复制失败，请手动选择复制' });
        },
        openEditFromDetail() {
            this.showDetailDialog = false;
            this.openEditDialog(this.currentChannelType, this.currentChannel);
        },
        /** 回填编辑表单：switch 字段转为布尔，缺省字段补默认值。
         *  v3.0.0：fields 可选 —— 本地渠道等需要按上下文（内置 / 自定义）指定字段集。 */
        normalizeForEdit(type, config, fields) {
            const list = fields || fieldsOf(type);
            const out = { ...config };
            for (const f of list) {
                if (f.type === 'switch') {
                    out[f.key] = out[f.key] === true || out[f.key] === 'true';
                } else if (out[f.key] === undefined) {
                    out[f.key] = f.def !== undefined ? f.def : '';
                }
            }
            /*
             * v3.0.0（R8）：本地文件渠道「浏览目录」多目录兼容 ——
             * 旧配置只有 rootPath 单目录时自动预填成 rootPaths（一行一个），
             * 保存后配置即迁移为 rootPaths；未保存也不影响后端（rootPath 仍可用）。
             * v3.0.0（R11）：后端存的是 JSON 数组，textarea 需要的是换行字符串 ——
             * 早先直接 String(array) 会把多目录拼成 "/data,/mnt" 塞进一个输入框。
             */
            if (type === 'localfiles') {
                let list = [];
                if (Array.isArray(out.rootPaths)) {
                    list = out.rootPaths.map((v) => String(v || '').trim());
                } else if (typeof out.rootPaths === 'string') {
                    list = out.rootPaths.split(/\r?\n/).map((s) => s.trim());
                }
                list = list.filter(Boolean);
                if (!list.length && out.rootPath) list = [String(out.rootPath).trim()];
                out.rootPaths = list.join('\n');
            }
            return out;
        },

        async confirmEditChannel() {
            // v1.0.9：先做前缀一级目录校验，不合格直接挡在提交前
            if (!this.checkObjectPrefix(this.currentChannelType, this.editChannel.config)) return;
            this.saving = true;
            try {
                const payload = {
                    name: this.editChannel.name,
                    enabled: this.editChannel.enabled,
                    config: this.collectConfig(this.editChannel.config)
                };
                let data = await this.putChannel(payload);
                /*
                 * v1.0.2：本地存储渠道改了「存储地址（容器内路径）」时后端要求管理员密码二次确认
                 * （防止随手改成一个未被映射的路径，导致容器重建后文件全丢）。
                 */
                if (data && data.needAdminPassword) {
                    let pwd = '';
                    try {
                        const r = await this.$prompt(
                            data.message || '修改「存储地址（容器内路径）」需要验证管理员密码',
                            '安全验证',
                            {
                                confirmButtonText: '确认修改',
                                cancelButtonText: '取消',
                                inputType: 'password',
                                inputPlaceholder: '请输入当前管理员密码',
                                inputValidator: (v) => (!!String(v || '').trim() || '请输入管理员密码')
                            }
                        );
                        pwd = String(r.value || '');
                    } catch {
                        return; // 用户取消 → 什么都不做
                    }
                    data = await this.putChannel({ ...payload, adminPassword: pwd });
                }
                if (data.success) {
                    this.$message.success('保存成功');
                    this.showEditDialog = false;
                    await this.loadChannels();
                } else {
                    this.$message.error(data.message || '保存失败');
                }
            } catch (e) {
                this.$message.error('保存失败：' + e.message);
            } finally {
                this.saving = false;
            }
        },

        /** v1.0.2：更新渠道（抽出来便于「需要密码 → 带密码重试」复用） */
        async putChannel(payload) {
            const resp = await fetchWithAuth(`/api/manage/channels/${this.editChannel.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return resp.json();
        },

        /* ------------ 渠道操作 ------------ */
        async toggleChannelEnabled(channel, enabled) {
            await this.patchChannel(channel.id, { enabled });
        },
        async handleCardCommand(cmd, channel) {
            if (cmd === 'setMain') return this.patchChannel(channel.id, { isMain: true, isBackup: false });
            if (cmd === 'setBackup') return this.patchChannel(channel.id, { isBackup: true, isMain: false });
            if (cmd === 'togglePool') return this.togglePool(channel);
            if (cmd === 'clearFlag') return this.patchChannel(channel.id, { isMain: false, isBackup: false });
            if (cmd === 'delete') return this.deleteChannel(channel);
        },

        /* ------------ 备用库（主渠道失败时的轮换池） ------------ */
        async togglePool(channel) {
            const enabled = !channel.backupPool;
            try {
                const resp = await fetchWithAuth(`/api/manage/channels/${channel.id}/pool`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled })
                });
                const data = await resp.json();
                if (data.success) {
                    this.$message.success(
                        enabled
                            ? `已设为备用库（当前共 ${data.data?.count ?? 1} 个）：主渠道上传失败时会轮流切换到这里`
                            : '已取消备用库'
                    );
                    await this.loadChannels();
                } else {
                    this.$message.error(data.message || '操作失败');
                }
            } catch (e) {
                this.$message.error('操作失败：' + e.message);
            }
        },

        /* ------------ 用户授权 ------------ */
        async openAuthDialog(channel) {
            this.authChannel = channel;
            this.authUsers = [];
            this.authSelected = [];
            this.authAll = false;
            this.authAllLocked = false;
            this.showAuthDialog = true;
            this.authLoading = true;
            try {
                const resp = await fetchWithAuth(`/api/manage/channels/${channel.id}/authorize`);
                const data = await resp.json();
                if (data.success) {
                    this.authUsers = data.data?.users || [];
                    this.authSelected = data.data?.authorizedUsers || [];
                    this.authAll = data.data?.authAll === true;
                    this.authAllLocked = data.data?.authAllLocked === true;
                } else {
                    this.$message.error(data.message || '加载授权名单失败');
                }
            } catch (e) {
                this.$message.error('加载授权名单失败：' + e.message);
            } finally {
                this.authLoading = false;
            }
        },
        async saveAuth() {
            if (!this.authChannel) return;
            this.authSaving = true;
            try {
                const resp = await fetchWithAuth(`/api/manage/channels/${this.authChannel.id}/authorize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usernames: this.authSelected, authAll: this.authAll })
                });
                const data = await resp.json();
                if (data.success) {
                    this.$message.success('授权已保存');
                    this.showAuthDialog = false;
                } else {
                    this.$message.error(data.message || '保存失败');
                }
            } catch (e) {
                this.$message.error('保存失败：' + e.message);
            } finally {
                this.authSaving = false;
            }
        },
        async patchChannel(id, patch) {
            try {
                const resp = await fetchWithAuth(`/api/manage/channels/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(patch)
                });
                const data = await resp.json();
                if (data.success) {
                    await this.loadChannels();
                } else {
                    this.$message.error(data.message || '操作失败');
                }
            } catch (e) {
                this.$message.error('操作失败：' + e.message);
            }
        },
        deleteChannel(channel) {
            this.$confirm(
                `确定删除渠道「${channel.name}」吗？若该渠道仍有文件副本将无法删除。`,
                '删除确认',
                { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
            ).then(async () => {
                try {
                    const resp = await fetchWithAuth(`/api/manage/channels/${channel.id}`, { method: 'DELETE' });
                    const data = await resp.json();
                    if (data.success) {
                        this.$message.success('已删除');
                        await this.loadChannels();
                    } else {
                        this.$message.error(data.message || '删除失败');
                    }
                } catch (e) {
                    this.$message.error('删除失败：' + e.message);
                }
            }).catch(() => {});
        },

        /* ------------ 连通性测试 ------------ */
        async runTest(payload) {
            this.testing = true;
            this.testResult = null;
            try {
                const resp = await fetchWithAuth('/api/manage/channels/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await resp.json();
                this.testResult = {
                    success: !!data.success,
                    message: data.message || (data.success ? '连接正常' : '连接失败'),
                    url: data.data?.url || ''
                };
            } catch (e) {
                this.testResult = { success: false, message: '测试失败：' + e.message, url: '' };
            } finally {
                this.testing = false;
            }
        },
        testDraft() {
            if (!this.newChannel.type) return this.$message.warning('请先选择渠道类型');
            return this.runTest({
                type: this.newChannel.type,
                config: this.collectConfig(this.newChannel.config)
            });
        },
        testEditChannel() {
            return this.runTest({
                id: this.editChannel.id,
                type: this.currentChannelType,
                config: this.collectConfig(this.editChannel.config)
            });
        },
        testChannel(channel) {
            if (!channel) return;
            return this.runTest({ id: channel.id, type: channel.type, config: {} });
        },

        /* ------------ 容量展示（由后端返回的 quota 字段驱动） ------------ */
        quotaPct(channel) {
            const used = Number(channel.quota?.usedMB || 0) / 1024;
            const limit = Number(channel.quota?.limitGB || 10) || 10;
            return Math.min(100, Math.round((used / limit) * 1000) / 10);
        },
        quotaStatus(channel) {
            const p = this.quotaPct(channel);
            const threshold = Number(channel.quota?.threshold || 95);
            if (p >= threshold) return 'exception';
            if (p >= 80) return 'warning';
            return 'success';
        },
        quotaText(channel) {
            const used = Number(channel.quota?.usedMB || 0) / 1024;
            const limit = Number(channel.quota?.limitGB || 10) || 10;
            return `${used.toFixed(2)} / ${limit} GB`;
        }
    },
    mounted() {
        this.loadChannels();
        this.loadStorage();
    }
};
</script>

<style scoped>
.upload-settings {
    min-height: 500px;
    overflow-x: hidden;
}

/*
 * v1.1.4：右下角「添加渠道」悬浮按钮。
 * 默认圆形只露 + 号；桌面（有精确指针）hover 时向右展开成胶囊并显示文字。
 * 因为锚在 right，宽度变大时向左生长，不会顶到屏幕外。
 */
.channel-fab-wrap {
    position: fixed;
    right: 28px;
    bottom: 28px;
    z-index: 30;
}

.channel-fab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 52px;
    min-width: 52px;
    padding: 0 15px;
    border: none;
    border-radius: 26px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 14px;
    font-family: inherit;
    cursor: pointer;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.2);
    transition: background-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.channel-fab:hover {
    background: var(--el-color-primary-light-3);
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.24);
}

.channel-fab:active {
    transform: scale(0.96);
}

.channel-fab-icon {
    font-size: 16px;
}

/* 文字默认收起（宽 0 + 透明），桌面 hover 才展开 */
.channel-fab-text {
    display: inline-block;
    max-width: 0;
    margin-left: 0;
    opacity: 0;
    overflow: hidden;
    white-space: nowrap;
    transition: max-width 0.22s ease, opacity 0.18s ease, margin-left 0.22s ease;
}

@media (hover: hover) and (pointer: fine) {
    .channel-fab:hover .channel-fab-text {
        max-width: 6em;
        margin-left: 8px;
        opacity: 1;
    }
}

@media (max-width: 768px) {
    .channel-fab-wrap {
        right: 16px;
        bottom: calc(18px + env(safe-area-inset-bottom));
    }

    .channel-fab {
        height: 48px;
        min-width: 48px;
        border-radius: 24px;
        padding: 0 14px;
    }
}

/* 页面头部 */
.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 18px;
    flex-wrap: wrap;
    gap: 12px;
}

.first-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 20px;
    font-weight: 600;
}

.help-icon {
    cursor: pointer;
    color: var(--el-text-color-secondary);
    font-size: 14px;
}

.inline-warning-icon {
    color: var(--el-text-color-secondary);
    cursor: pointer;
    font-size: 13px;
    margin-left: 6px;
    transition: color 0.2s;
}

.inline-warning-icon:hover {
    color: var(--el-color-primary);
}

.add-btn {
    border-radius: 8px;
    transition: background-color 0.2s ease, border-color 0.2s ease;
}

.header-actions {
    display: flex;
    gap: 12px;
    align-items: center;
}

.header-actions :deep(.el-button) {
    border-radius: 8px;
}

/* 外链分发设置条 */
.storage-bar {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 24px;
    padding: 14px 20px;
    border-radius: 14px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
}

.storage-row {
    display: flex;
    align-items: center;
    gap: 22px;
    flex-wrap: wrap;
}

.storage-row.proxy-config {
    padding-top: 10px;
    border-top: 1px dashed var(--el-border-color-lighter);
}

.mb-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    min-width: 0;
}

.mb-item.mb-right {
    margin-left: auto;
}

.mb-label {
    color: var(--el-text-color-secondary);
    flex-shrink: 0;
}

.mb-icon {
    font-size: 18px;
}

/* 自定义访问域名：原先 flex:1 1 320px 会把输入框拉满整行，框体过长、右侧留白突兀；
   这里收窄为固定宽度，窄屏（移动端）时再退回整行撑满。 */
.domain-item {
    flex: 0 1 auto;
    min-width: 0;
}

.domain-item .domain-input {
    width: 240px;
}

@media (max-width: 768px) {
    .domain-item {
        flex: 1 1 100%;
        width: 100%;
    }

    .domain-item .domain-input {
        width: 100%;
    }
}

/* v2.4.0：备用库预览（只读多选框）—— 与域名输入框同宽同位 */
.pool-preview-select {
    max-width: 320px;
}

.pool-preview-select :deep(.el-tag) {
    max-width: 130px;
}

.pool-preview-select :deep(.el-select__wrapper.is-disabled) {
    cursor: default;
}

.mb-name {
    font-weight: 600;
    color: var(--el-text-color-primary);
}

.mb-empty {
    color: var(--el-text-color-placeholder);
}

.mb-hint {
    font-size: 12px;
    color: var(--el-text-color-placeholder);
}

/* 渠道分组 */
.channel-group {
    margin-bottom: 32px;
    background: var(--glass-bg);
    border-radius: 16px;
    border: 1px solid var(--glass-border);
    overflow: hidden;
    box-shadow: var(--glass-shadow);
}

.group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    background: var(--glass-header-bg);
    border-bottom: 1px solid var(--glass-header-border);
}

/* 分类标题栏右侧的收缩按钮 */
.group-collapse-btn {
    flex: 0 0 auto;
    color: var(--el-text-color-secondary);
    padding: 4px 8px;
}
.group-collapse-btn:hover {
    color: var(--primary-color);
}

/* 「存储渠道管理」分区标题与分割线 */
.channel-section-header {
    margin-top: 26px;
}
.channel-section-divider {
    margin: 0 0 18px;
}

.group-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 16px;
    font-weight: 600;
    color: var(--el-text-color-primary);
}

.group-icon {
    font-size: 20px;
}

.channel-count {
    font-size: 12px;
}

/* 渠道卡片网格 */
.channel-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
    padding: 20px;
}

.channel-card {
    background: var(--glass-bg);
    border-radius: 10px;
    border: 1px solid var(--glass-border);
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
    box-shadow: var(--glass-shadow);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
}

.channel-card.disabled {
    opacity: 0.6;
    background: var(--el-fill-color-lighter);
}

.card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    background: var(--glass-header-bg);
    border-bottom: 1px solid var(--glass-header-border);
}

.card-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}

.channel-name {
    font-weight: 600;
    font-size: 14px;
    color: var(--el-text-color-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 150px;
}

.card-body {
    padding: 14px 16px;
    min-height: 60px;
    text-align: left;
}

.card-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
    width: 100%;
    overflow: hidden;
}

.info-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--el-text-color-secondary);
    min-width: 0;
    width: 100%;
    max-width: 100%;
}

.info-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
    text-align: left;
}

.info-icon {
    width: 14px;
    flex-shrink: 0;
    color: var(--el-text-color-placeholder);
}

.quota-mini {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px dashed var(--el-border-color-lighter);
}

.quota-mini :deep(.el-progress) {
    margin-bottom: 4px;
}

.quota-text {
    font-size: 11px;
    color: var(--el-text-color-secondary);
}

/* v2.3.0：主/备/备用库标记统一落在摘要区最后一行 */
.card-status-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed var(--el-border-color-lighter);
    width: 100%;
}

.card-status-row .el-tag {
    flex-shrink: 0;
}

.card-status-row .el-tag.is-plain {
    color: var(--el-text-color-secondary);
}

.card-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 2px;
    padding: 10px 16px;
    border-top: 1px solid var(--glass-header-border);
    background: var(--glass-header-bg);
    margin-top: auto;
    /* v2.8.6：详情/编辑/授权/更多 固定一行 —— 不换行，按钮按需压缩内边距 */
    flex-wrap: nowrap;
    min-width: 0;
}

/* 按钮文字不折行；宽度不够时只压缩内边距，四个按钮始终同一行 */
.card-actions :deep(.el-button) {
    padding-left: 8px;
    padding-right: 8px;
    flex: 0 1 auto;
    min-width: 0;
    white-space: nowrap;
}

.card-actions :deep(.el-dropdown) {
    flex: 0 0 auto;
}

.empty-tip {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 36px 20px;
    color: var(--el-text-color-placeholder);
    gap: 12px;
}

/* ---------- 用户授权弹窗 ---------- */
.auth-tip {
    display: flex;
    align-items: flex-start;
    font-size: 13px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
    background: var(--el-fill-color-lighter);
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 12px;
}

/* v1.0.6：「自动授权所有用户」开关行 —— 与下面的账户勾选列表视觉上分开 */
.auth-all-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 12px;
    margin-bottom: 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
}

.auth-all-text {
    flex: 1;
    min-width: 0;
    line-height: 1.6;
}

.auth-all-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
}

.auth-all-desc {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.auth-body {
    max-height: 46vh;
    overflow-y: auto;
    min-height: 80px;
}

.auth-body :deep(.el-checkbox-group) {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.auth-item {
    display: flex;
    align-items: center;
    height: auto;
    padding: 7px 4px;
    margin-right: 0;
    border-radius: 6px;
}

.auth-item:hover {
    background: var(--el-fill-color-light);
}

.auth-name {
    margin-right: 8px;
}

.auth-account {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    margin-right: 8px;
}

.auth-empty {
    padding: 24px 0;
    text-align: center;
    color: var(--el-text-color-placeholder);
    font-size: 13px;
}

.empty-icon {
    font-size: 30px;
}

.channel-type-option {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    line-height: 1;
}

.select-option-icon {
    width: 16px;
    height: 16px;
    font-size: 16px;
    text-align: center;
}

.form-warning {
    padding: 10px 14px;
    font-size: 13px;
    color: var(--el-color-warning);
    background: var(--el-color-warning-light-9);
    border-radius: 6px;
    border-left: 3px solid var(--el-color-warning);
    margin-bottom: 14px;
    line-height: 1.6;
}

.form-hint-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 4px;
    margin-bottom: 12px;
    padding: 10px 14px;
    border-radius: 8px;
    background: var(--el-fill-color-light);
    border: 1px dashed var(--el-border-color);
}

/* v3.0.0（R8）：本地文件渠道「渠道名称」下方的用途提示（添加 / 编辑页共用） */
.localfiles-purpose-hint {
    width: 100%;
    margin-top: 6px;
    padding: 8px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--el-color-warning) 12%, var(--el-fill-color-light));
    border: 1px dashed color-mix(in srgb, var(--el-color-warning) 55%, transparent);
    color: var(--el-text-color-regular);
    font-size: 12px;
    line-height: 1.6;
    box-sizing: border-box;
}

/* 表单项内的小提示（不占独立一行） */
.form-hint-bar--inline {
    margin: 6px 0 0;
    padding: 0;
    border: none;
    background: none;
    justify-content: flex-start;
}
.form-hint-bar--inline .hint-text {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

/* 渠道 ID（6 位 code）：只读展示 + 复制 */
.channel-id-row {
    display: flex;
    align-items: center;
    gap: 6px;
}
.channel-id-value {
    font-family: 'Courier New', monospace;
    font-size: 13px;
    letter-spacing: 1px;
    padding: 2px 8px;
    border-radius: 6px;
    background: var(--el-fill-color-light);
    color: var(--el-text-color-primary);
    user-select: all;
}

.hint-text {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.test-result {
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.6;
    word-break: break-all;
}

.test-result.ok {
    color: var(--el-color-success);
    background: var(--el-color-success-light-9);
    border-left: 3px solid var(--el-color-success);
}

.test-result.fail {
    color: var(--el-color-danger);
    background: var(--el-color-danger-light-9);
    border-left: 3px solid var(--el-color-danger);
}

:deep(.channel-details .el-descriptions__table) {
    table-layout: fixed;
    width: 100%;
}

:deep(.channel-details .el-descriptions__label) {
    width: 34%;
}

:deep(.channel-details .el-descriptions__cell) {
    overflow-wrap: anywhere;
    word-break: break-word;
}

:deep(.channel-dialog) {
    width: 620px !important;
    max-width: 92vw !important;
}

/* 平板端：卡片密度随可用宽度调整（桌面端保持 auto-fill 300px 基准） */
@media (min-width: 769px) and (max-width: 1199px) {
    .channel-cards {
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 14px;
        padding: 16px;
    }

    .page-header {
        gap: 10px;
    }

    .storage-bar {
        padding: 12px 16px;
    }

    .storage-row {
        gap: 16px;
    }
}

@media (max-width: 768px) {
    .page-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .header-actions {
        width: 100%;
    }

    .header-actions > * {
        flex: 1 1 auto;
        min-width: 0;
    }

    .first-title {
        font-size: 17px;
        line-height: 1.45;
        align-items: flex-start;
    }

    .channel-cards {
        grid-template-columns: 1fr;
        padding: 12px;
    }

    .group-header {
        flex-direction: column;
        gap: 12px;
        align-items: flex-start;
    }

    /* 分发设置条：窄屏改为纵向堆叠，避免标签与控件相互挤压换行 */
    .storage-bar {
        padding: 12px 14px;
        gap: 10px;
    }

    .storage-row {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
    }

    .mb-item {
        flex-wrap: wrap;
        row-gap: 6px;
    }

    .mb-item.mb-right {
        margin-left: 0;
    }

    .storage-row.proxy-config .mb-item {
        justify-content: space-between;
    }

    /* 卡片操作区：左对齐并允许换行，避免「更多」被挤出卡片 */
    .card-actions {
        justify-content: flex-start;
        padding: 10px 12px;
    }

    .channel-name {
        max-width: none;
        flex: 1;
    }

    :deep(.channel-dialog) {
        width: 92vw !important;
    }
}

@media (max-width: 480px) {
    .channel-cards {
        padding: 10px;
        gap: 12px;
    }

    .group-title {
        font-size: 15px;
        flex-wrap: wrap;
        row-gap: 6px;
    }

    .card-header,
    .card-body {
        padding: 12px;
    }

    /* 极窄屏下「测试/详情/编辑/更多」两行排布 */
    .card-actions {
        gap: 2px;
    }

    .card-actions :deep(.el-button) {
        padding-left: 6px;
        padding-right: 6px;
    }
}
</style>
