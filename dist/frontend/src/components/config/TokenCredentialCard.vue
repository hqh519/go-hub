<template>
    <div class="cred-card">
        <!-- ============ S3 协议：可直接填进任意 S3 客户端 ============ -->
        <template v-if="isS3">
            <div class="cred-section-title">{{ $t('sysSecurity.s3ConfigTitle') }}</div>
            <div class="cred-rows">
                <div v-for="row in s3Rows" :key="row.label" class="cred-row">
                    <span class="cred-label">{{ row.label }}</span>
                    <span class="cred-value" :title="row.value">{{ row.value }}</span>
                    <el-button class="cred-copy" size="small" text @click="$emit('copy', row.value)">
                        <font-awesome-icon icon="copy"/>
                    </el-button>
                </div>
            </div>
            <!-- 客户端「自定义域名 / 访问域名」该填什么：填成本前缀后，客户端自己拼的地址才会命中本站签发链接 -->
            <div class="cred-rows">
                <div class="cred-row">
                    <span class="cred-label">{{ $t('sysSecurity.customDomainLabel') }}</span>
                    <span class="cred-value cred-value--strong" :title="linkPrefix">{{ linkPrefix }}</span>
                    <el-button class="cred-copy" size="small" text @click="$emit('copy', linkPrefix)">
                        <font-awesome-icon icon="copy"/>
                    </el-button>
                </div>
            </div>
            <div class="cred-tip">{{ $t('sysSecurity.s3BucketAutoTip') }}</div>
            <div class="cred-tip">{{ $t('sysSecurity.s3ConfigTip') }}</div>
            <div class="cred-section-title">{{ $t('sysSecurity.uploadApi') }}</div>
            <pre class="cred-code">{{ s3Snippet }}</pre>
        </template>

        <!-- ============ Web 通用：自定义 Web 通道接入 ============ -->
        <template v-else>
            <div class="cred-section-title">{{ $t('sysSecurity.webUsageTitle') }}</div>
            <div class="cred-rows">
                <div class="cred-row">
                    <span class="cred-label">{{ $t('sysSecurity.uploadApi') }}</span>
                    <span class="cred-value">{{ uploadApi }}</span>
                    <el-button class="cred-copy" size="small" text @click="$emit('copy', uploadApi)">
                        <font-awesome-icon icon="copy"/>
                    </el-button>
                </div>
                <div class="cred-row">
                    <span class="cred-label">Token</span>
                    <span class="cred-value cred-value--strong" :title="revealed ? token.token : ''">
                        {{ revealed ? token.token : maskToken(token.token) }}
                    </span>
                    <el-button class="cred-copy" size="small" text @click="revealed = !revealed">
                        <font-awesome-icon :icon="revealed ? 'eye-slash' : 'eye'"/>
                    </el-button>
                    <el-button class="cred-copy" size="small" text @click="$emit('copy', token.token)">
                        <font-awesome-icon icon="copy"/>
                    </el-button>
                </div>
                <!-- PicList / PicGo「自定义 Web 图床」必填的两项：文件字段名 + 返回链接在 JSON 里的路径 -->
                <div class="cred-row">
                    <span class="cred-label">{{ $t('sysSecurity.postParamName') }}</span>
                    <span class="cred-value cred-value--strong">file</span>
                    <el-button class="cred-copy" size="small" text @click="$emit('copy', 'file')">
                        <font-awesome-icon icon="copy"/>
                    </el-button>
                </div>
                <div class="cred-row">
                    <span class="cred-label">{{ $t('sysSecurity.jsonPath') }}</span>
                    <span class="cred-value cred-value--strong">data.url</span>
                    <el-button class="cred-copy" size="small" text @click="$emit('copy', 'data.url')">
                        <font-awesome-icon icon="copy"/>
                    </el-button>
                </div>
                <!-- PicList 的「自定义域名」留空即可；若必填，填下面这个前缀，返回地址会与本站签发链接一致 -->
                <div class="cred-row">
                    <span class="cred-label">{{ $t('sysSecurity.customDomainLabel') }}</span>
                    <span class="cred-value cred-value--strong" :title="linkPrefix">{{ linkPrefix }}</span>
                    <el-button class="cred-copy" size="small" text @click="$emit('copy', linkPrefix)">
                        <font-awesome-icon icon="copy"/>
                    </el-button>
                </div>
            </div>
            <div class="cred-tip">{{ $t('sysSecurity.webJsonPathTip') }}</div>
            <div class="cred-tip">{{ $t('sysSecurity.webUsageTip') }}</div>
            <pre class="cred-code">{{ webSnippet }}</pre>
        </template>
    </div>
</template>

<script>
import { resolveAccessDomain } from '@/utils/accessDomain';

/**
 * Token 接入信息卡片 —— 「S3 协议 / Web 通用」两类 Token 的凭据与接入示例。
 * 所有字段都一直可见、可复制（父组件只负责弹提示，文本由这里给出）。
 */
export default {
    name: 'TokenCredentialCard',
    props: {
        token: { type: Object, required: true }
    },
    emits: ['copy'],
    data() {
        return { revealed: false }
    },
    methods: {
        maskToken(value) {
            const v = String(value || '');
            if (v.length <= 10) return '••••••••';
            return `${v.slice(0, 6)}••••••${v.slice(-4)}`;
        }
    },
    computed: {
        isS3() {
            return this.token.type === 's3'
        },
        uploadApi() {
            const origin = this.token.endpoint
                ? String(this.token.endpoint).replace(/\/s3\/?$/, '')
                : (typeof window !== 'undefined' ? window.location.origin : '')
            return `${origin}/api/token/upload`
        },
        /**
         * 客户端里应填的「自定义域名 / 访问域名」前缀。
         *
         * 与全站文件链接、以及安全设置「对外 WebDAV → 访问域名」取同一个来源
         * （见 utils/accessDomain，统一出口，避免各处算法漂移）。
         */
        linkPrefix() {
            return resolveAccessDomain({
                userConfig: this.$store?.getters?.userConfig,
                origin: typeof window !== 'undefined' ? window.location.origin : '',
                endpoint: this.token.endpoint,
            })
        },
        s3Rows() {
            return [
                { label: this.$t('sysSecurity.endpoint'), value: this.token.endpoint || '' },
                { label: this.$t('sysSecurity.accessKey'), value: this.token.accessKey || '' },
                { label: this.$t('sysSecurity.secretKey'), value: this.token.secretKey || '' },
                // Region 由系统统一定义为 us-east-1，无需用户配置
                { label: this.$t('sysSecurity.regionLabel'), value: 'us-east-1' },
                // Bucket 可填渠道 ID（6 位）/ auto / 留空：auto 与留空都落到该 Token 的默认存储渠道
                { label: this.$t('sysSecurity.bucketLabel'), value: this.token.defaultBucket || 'auto' },
                { label: this.$t('sysSecurity.pathStyleLabel'), value: this.$t('sysSecurity.pathStyleValue') }
            ]
        },
        s3Snippet() {
            const ep = this.token.endpoint || '<本站域名>/s3'
            const bucket = this.token.defaultBucket || '<渠道ID（6位）>'
            return [
                '# 任意 S3 客户端都可用（示例：aws cli / rclone / PicList-S3）',
                '# 注意：bucket 只认【渠道 ID】（存储渠道列表里的 6 位 ID），渠道名不参与匹配',
                '# Region 固定填 us-east-1（系统统一，无需另行配置）',
                '# 上传成功后响应头会带 GoHub 的签发链接（Location / x-gohub-url）',
                '# PicList 等客户端自拼地址时，「自定义域名」请填上面的访问域名，否则会是 404 地址',
                `aws configure set aws_access_key_id ${this.token.accessKey || '<AccessKey>'}`,
                `aws configure set aws_secret_access_key ${this.token.secretKey || '<SecretKey>'}`,
                'aws configure set region us-east-1',
                `aws s3 cp ./photo.jpg s3://${bucket}/photo.jpg --endpoint-url ${ep}`
            ].join('\n')
        },
        webSnippet() {
            const body = {
                token: this.token.token || '<Token>',
                username: '<用户名（可选）>',
                userstore: 'true',
                compress: 'true',
                compressPercent: '80',
                nameType: 'default',
                autoRetry: 'true'
            }
            return [
                `POST ${this.uploadApi}`,
                'Authorization: Bearer ' + (this.token.token || '<Token>'),
                '',
                '# multipart 表单字段（file 与 url 二选一）；下面除 token 外都是可选字段：',
                JSON.stringify(body, null, 2),
                '',
                '# 压缩（v2.8.5 补充）：',
                '#   compress=true 或 1  → 服务端压缩（图片走 sharp、视频/音频走 ffmpeg；gif 自动跳过）',
                '#   compress 不传或其它值 → 原样上传，不受后台「默认开启压缩」影响（Web 通用通道只认本参数）',
                '#   compressPercent      → 压缩到原体积的百分比（10-100），不传用后台默认值',
                '',
                '# 其它可选字段：',
                '#   nameType  → default / index / origin / short（命名方式，不传用后台默认）',
                '#   autoRetry → true / 1 时主渠道失败自动切备用渠道',
                '',
                '# 存储渠道优先级（v1.8.0）：',
                '#   传了 username 且 userstore 不为 false → 用该账户在「用户管理」里绑定的存储/备份渠道，文件归属该账户',
                '#   否则 → 本 Token 上配置的存储/备份渠道 → 后台「上传设置」里的全局默认渠道',
            ].join('\n')
        }
    }
}
</script>

<style scoped>
.cred-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.cred-section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    margin-top: 4px;
}
.cred-rows {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--glass-border, rgba(128, 128, 128, 0.25));
    border-radius: 10px;
    overflow: hidden;
}
.cred-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px 6px 12px;
    border-bottom: 1px solid var(--glass-border, rgba(128, 128, 128, 0.18));
    background: color-mix(in srgb, var(--primary-color, #2563EB) 3%, transparent);
}
.cred-row:last-child {
    border-bottom: none;
}
.cred-label {
    flex: 0 0 96px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.cred-value {
    flex: 1 1 auto;
    min-width: 0;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    color: var(--el-text-color-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: all;
}
.cred-value--strong {
    font-weight: 600;
}
.cred-copy {
    flex: 0 0 auto;
    padding: 2px 6px;
}
.cred-tip {
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
}
.cred-code {
    margin: 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--primary-color, #2563EB) 5%, transparent);
    border: 1px solid var(--glass-border, rgba(128, 128, 128, 0.22));
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-primary);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 260px;
    overflow: auto;
}
</style>
