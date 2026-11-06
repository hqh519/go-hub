<template>
    <span
        v-bind="$attrs"
        :class="['channel-icon-wrapper', `channel-brand-${type}`, { 'is-badge': showBadge }]"
        :title="label"
    >
        <!-- 通用字符占位徽标：不使用第三方品牌 SVG，避免商标/资源依赖 -->
        <span v-if="showBadge" class="channel-badge-text">{{ badge }}</span>
        <!-- 兜底：未识别的渠道类型走通用服务器图标 -->
        <font-awesome-icon v-else :icon="fontAwesomeIcon"/>
    </span>
</template>

<script>
/**
 * 渠道图标占位组件
 * 说明：按产品要求，渠道图标统一用「字符徽标 + 品牌色」的方式占位，
 * 不再内置各第三方图床的商标 SVG，避免商标与静态资源依赖。
 * 渠道类型（10 种）：
 *   cos         腾讯云 COS
 *   aliyun      阿里云 OSS
 *   minio       MinIO
 *   r2          Cloudflare R2
 *   s3          S3 兼容存储
 *   easyimages  EasyImages 简单图床
 *   lsky        Lsky Pro 兰空图床
 *   webdav      WebDAV
 *   immich      Immich
 *   custom      自定义 Web 存储
 */
const CHANNEL_BADGE = {
    cos: 'COS',
    aliyun: 'OSS',
    minio: 'MI',
    r2: 'R2',
    s3: 'S3',
    easyimages: 'EI',
    lsky: 'LS',
    webdav: 'WD',
    immich: 'IM',
    custom: 'DIY',
    local: 'LCL',
    // v3.0.0（R7）：本地文件渠道的简称统一用「File」
    localfiles: 'File'
};

const CHANNEL_LABEL = {
    cos: '腾讯云 COS',
    aliyun: '阿里云 OSS',
    minio: 'MinIO',
    r2: 'Cloudflare R2',
    s3: 'S3 兼容存储',
    easyimages: 'EasyImages 简单图床',
    lsky: 'Lsky Pro 兰空图床',
    webdav: 'WebDAV',
    immich: 'Immich',
    custom: '自定义 Web 存储',
    local: '本地存储',
    localfiles: '本地文件'
};

export default {
    name: 'ChannelIcon',
    inheritAttrs: false,
    props: {
        type: {
            type: String,
            required: true
        }
    },
    computed: {
        showBadge() {
            return Boolean(CHANNEL_BADGE[this.type]);
        },
        badge() {
            return CHANNEL_BADGE[this.type] || '?';
        },
        label() {
            return CHANNEL_LABEL[this.type] || this.type;
        },
        fontAwesomeIcon() {
            return 'server';
        }
    }
};
</script>

<style scoped>
.channel-icon-wrapper {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
}

.channel-svg-icon,
.channel-icon-wrapper :deep(svg) {
    width: 1em;
    height: 1em;
    fill: currentColor;
}

/* 字符徽标：自动适配字号，宽度随内容自适应（支持「自定义」这类中文双字） */
.channel-icon-wrapper.is-badge {
    padding: 0 0.28em;
    min-width: 1.6em;
    height: 1.6em;
    border-radius: 0.3em;
    background: currentColor;
    box-sizing: border-box;
}

.channel-badge-text {
    font-size: 0.58em;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #fff;
    transform: scale(1);
    white-space: nowrap;
}

/* 品牌色（用于徽标底色 / 图标颜色） */
.channel-icon-wrapper.channel-brand-cos { color: #006eff; }
.channel-icon-wrapper.channel-brand-aliyun { color: #ff6a00; }
.channel-icon-wrapper.channel-brand-minio { color: #c72c48; }
.channel-icon-wrapper.channel-brand-r2 { color: #f38020; }
.channel-icon-wrapper.channel-brand-s3 { color: #569a31; }
.channel-icon-wrapper.channel-brand-easyimages { color: #4a90d9; }
.channel-icon-wrapper.channel-brand-lsky { color: #7b68ee; }
.channel-icon-wrapper.channel-brand-webdav { color: #14b8a6; }
.channel-icon-wrapper.channel-brand-immich { color: #4250af; }
.channel-icon-wrapper.channel-brand-custom { color: #8c939d; }
/* v3.0.0（R8）：本地存储此前没有品牌色，徽标底色随 currentColor ——
   夜间模式下继承浅色文字 → 白底白字看不见，这里固定为双模式都可读的深灰蓝 */
.channel-icon-wrapper.channel-brand-local { color: #475569; }
.channel-icon-wrapper.channel-brand-localfiles { color: #6b7280; }
</style>
