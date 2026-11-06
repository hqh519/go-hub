<template>
    <div class="channel-fields">
        <el-form-item
            v-for="field in renderedFields"
            :key="field.key"
            :required="!!field.required"
        >
            <template #label>
                <span>{{ field.label }}</span>
                <el-tooltip v-if="field.tip" :content="field.tip" placement="top">
                    <font-awesome-icon icon="question-circle" class="inline-help-icon"/>
                </el-tooltip>
                <!-- v3.0.0：占位符快插按钮（对象前缀 → 渠道ID/用户名/年/月/日；自定义命名 → 文件名/UUID/MD5/时间戳/扩展名） -->
                <span v-if="field.quick" class="quick-keys">
                    <template v-if="field.quick === 'prefix'">
                        <el-button
                            v-for="b in QUICK_PREFIX"
                            :key="b.val"
                            size="small"
                            link
                            type="primary"
                            @click.prevent="appendQuick(field, b.val)"
                        >{{ $t(b.label) }}</el-button>
                    </template>
                    <template v-else-if="field.quick === 'name'">
                        <el-button
                            v-for="b in QUICK_NAME"
                            :key="b.val"
                            size="small"
                            link
                            type="primary"
                            @click.prevent="appendQuick(field, b.val)"
                        >{{ $t(b.label) }}</el-button>
                    </template>
                </span>
            </template>

            <!-- 开关 -->
            <el-switch v-if="field.type === 'switch'" v-model="model[field.key]"/>

            <!-- 下拉选择 -->
            <el-select
                v-else-if="field.type === 'select'"
                v-model="model[field.key]"
                :placeholder="field.placeholder"
                style="width: 100%; max-width: 320px;"
            >
                <el-option
                    v-for="opt in (field.options || [])"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                />
            </el-select>

            <!-- v3.0.0：带常用路径建议的可输入下拉（自定义本地渠道的存储地址）
                 v3.0.0（R8）：textarea 类型优先（浏览目录多行输入不走这里） -->
            <el-select
                v-else-if="field.suggest && field.type !== 'textarea'"
                v-model="model[field.key]"
                filterable
                allow-create
                default-first-option
                :placeholder="field.placeholder"
                style="width: 100%; max-width: 320px;"
            >
                <el-option v-for="s in field.suggest" :key="s" :label="s" :value="s"/>
            </el-select>

            <!-- 数字 -->
            <el-input-number
                v-else-if="field.type === 'number'"
                v-model="model[field.key]"
                :min="field.min"
                :max="field.max"
                :step="field.step ?? 1"
                :precision="field.precision"
                controls-position="right"
            />

            <!-- 多行文本（v3.0.0 R11：field.fixed=true 时只读，如内置本地文件渠道的浏览目录） -->
            <el-input
                v-else-if="field.type === 'textarea'"
                v-model="model[field.key]"
                type="textarea"
                :autosize="{ minRows: 2 }"
                :placeholder="field.placeholder"
                :disabled="!!field.fixed"
            />

            <!-- 密码 -->
            <el-input
                v-else-if="field.type === 'password'"
                v-model="model[field.key]"
                type="password"
                show-password
                autocomplete="new-password"
                :placeholder="field.placeholder"
            />

            <!-- 普通文本（v3.0.0：field.fixed=true 时只读，如内置本地渠道的 uploads）
                 v3.0.0（R11）：不设置 autocomplete="off" —— 存储地址这类输入允许浏览器历史补全 -->
            <el-input
                v-else
                v-model="model[field.key]"
                :placeholder="field.placeholder"
                :disabled="!!field.fixed"
                autocomplete="on"
            />
        </el-form-item>
    </div>
</template>

<script>
/**
 * 渠道配置动态字段渲染器。
 * 由 channel-schema.js 的字段定义驱动，避免为 9 种渠道手写 9 套表单。
 * 支持字段级 showWhen 联动（例如「启用容量限制」未开启时隐藏容量上限 / 告警阈值）。
 */
import { visibleFields } from './channel-schema';

/** v3.0.0：占位符快插按钮定义（追加到输入框已有内容末尾）
 *  v3.0.0（R9）：前缀按钮补齐「渠道ID / 用户名 / 域名」，统一带前导斜杠；
 *                命名按钮首位加「哈希」（{hash}），并把 {uuid} 标注为「唯一编号」。
 *  v3.0.0（R11）：前缀按钮定为「渠道ID / 用户名 / 年份 / 月份 / 日期」五项，
 *                去掉 {domain}（域名本就随渠道配置变化，不该固化进存储路径）；{user} 取当前用户名。 */
const QUICK_PREFIX = [
    { label: 'systemConfig.quickChannelId', val: '/{ID}' },
    { label: 'systemConfig.quickUser', val: '/{user}' },
    { label: 'systemConfig.quickYear', val: '/{y}' },
    { label: 'systemConfig.quickMonth', val: '/{m}' },
    { label: 'systemConfig.quickDay', val: '/{d}' }
];
const QUICK_NAME = [
    { label: 'systemConfig.quickHash', val: '{hash}' },
    { label: 'systemConfig.quickFilename', val: '{filename}' },
    { label: 'systemConfig.quickUuid', val: '{uuid}' },
    { label: 'systemConfig.quickMd5', val: '{md5}' },
    { label: 'systemConfig.quickTimestamp', val: '{timestamp}' },
    { label: 'systemConfig.quickExt', val: '.{ext}' }
];

export default {
    name: 'ChannelFields',
    props: {
        fields: { type: Array, default: () => [] },
        model: { type: Object, required: true }
    },
    data() {
        return { QUICK_PREFIX, QUICK_NAME };
    },
    computed: {
        renderedFields() {
            return visibleFields(this.fields, this.model);
        }
    },
    methods: {
        /** 把占位符追加到该输入框已有内容末尾（不覆盖已有值） */
        appendQuick(field, token) {
            const cur = String(this.model[field.key] ?? '');
            this.model[field.key] = cur + token;
        }
    }
};
</script>

<style scoped>
.channel-fields :deep(.el-input-number) {
    /* Element Plus 默认 150px，在表单里宽度不统一；统一为「最多 320px、窄屏撑满」 */
    width: 100%;
    max-width: 320px;
}

@media (max-width: 768px) {
    .channel-fields :deep(.el-input-number) {
        max-width: none;
    }
}

.inline-help-icon {
    color: var(--el-text-color-secondary);
    cursor: pointer;
    font-size: 13px;
    margin-left: 6px;
    transition: color 0.2s;
}

.inline-help-icon:hover {
    color: var(--el-color-primary);
}

/* v3.0.0：占位符快插按钮 —— 跟在设置项名称后面，可换行不影响输入区对齐 */
.quick-keys {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px 6px;
    margin-left: 10px;
}

.quick-keys :deep(.el-button) {
    padding: 0;
    height: auto;
    font-size: 12px;
}
</style>
