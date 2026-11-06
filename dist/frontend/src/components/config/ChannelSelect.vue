<template>
    <el-select
        :model-value="modelValue"
        @update:model-value="$emit('update:modelValue', $event)"
        :placeholder="resolvedPlaceholder"
        :disabled="disabled"
        :loading="loading"
        class="channel-select"
        :style="{ width: width }"
    >
        <el-option
            v-for="opt in options"
            :key="`${kind}-${opt.value}`"
            :label="opt.label"
            :value="opt.value"
        >
            <span class="channel-option-row" :class="{ 'is-sentinel': !opt.type }">
                <ChannelIcon v-if="opt.type" :type="opt.type" class="channel-icon"/>
                <font-awesome-icon v-else :icon="opt.icon || 'cog'" class="channel-icon"/>
                <span>{{ opt.label }}</span>
            </span>
        </el-option>
    </el-select>
</template>

<script>
import ChannelIcon from '@/components/icons/ChannelIcon.vue';
import { fetchStorageChannels, buildChannelOptions } from '@/utils/storageChannels';

/**
 * 通用「渠道下拉框」—— 存储渠道 / 备份渠道共用同一个组件。
 *
 * 用法：
 *   <ChannelSelect v-model="token.defaultBucket" kind="main" />    存储渠道
 *   <ChannelSelect v-model="token.defaultBackup" kind="backup" />  备份渠道（额外含 none）
 *
 * 选项语义（值为渠道 ID；两个哨兵值由后端 StorageChannelService 解析）：
 *   - ''      「默认」—— 跟随全局设置
 *   - 'none'  不备份（仅备份渠道）
 *
 * 这样做的好处：Token 编辑、用户管理编辑用户、上传页上传设置三处的
 * 渠道下拉完全一致，不会再出现「三处排序/哨兵值不一样、选错渠道」的问题。
 */
export default {
    name: 'ChannelSelect',
    components: { ChannelIcon },
    props: {
        modelValue: { type: String, default: '' },
        /** 'main' = 存储渠道；'backup' = 备份渠道（多一个 none 项） */
        kind: { type: String, default: 'main' },
        disabled: { type: Boolean, default: false },
        placeholder: { type: String, default: '' },
        width: { type: String, default: '100%' }
    },
    emits: ['update:modelValue', 'change'],
    data() {
        return { channels: [], loading: false };
    },
    computed: {
        options() {
            return buildChannelOptions(this.channels, { kind: this.kind, t: this.$t });
        },
        resolvedPlaceholder() {
            return this.placeholder || this.$t('channelSelect.defaultOption');
        }
    },
    watch: {
        modelValue: {
            immediate: false,
            handler(val) {
                this.$emit('change', val);
            }
        }
    },
    async mounted() {
        this.loading = true;
        try {
            this.channels = await fetchStorageChannels();
        } finally {
            this.loading = false;
        }
    }
};
</script>

<style scoped>
.channel-select {
    width: 100%;
}

.channel-option-row {
    display: flex;
    align-items: center;
    gap: 6px;
}

.channel-option-row .channel-icon {
    width: 18px;
    text-align: center;
    flex-shrink: 0;
}

/* 哨兵项（默认 / none）弱化显示，与真实渠道区分开 */
.channel-option-row.is-sentinel {
    color: var(--el-text-color-secondary);
}
</style>
