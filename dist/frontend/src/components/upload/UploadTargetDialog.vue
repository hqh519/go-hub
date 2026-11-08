<template>
    <!--
        v1.0.7：统一的「上传目标配置」弹窗。
        原先这套「目标渠道 / 归属实例 / 上传目录」的选择只存在于「本地文件」页的上传弹窗里，
        视频灯箱的抓拍图上传只能走后端默认值（主渠道 + 默认实例 + 默认目录）。
        现在把它抽成组件，两处（以及以后任何需要上传的地方）共用同一套交互与校验：
          · 选项由组件自己拉（渠道 = /api/locals… 的存储渠道列表，实例 = /api/instances），
            调用方只需要接 @confirm({ channelId, instanceId, uploadFolder })。
          · zIndex 可传：从灯箱里打开时必须抬到 3400，否则会被 3200 的灯箱盖住。
    -->
    <el-dialog
        v-model="visible"
        :title="title || $t('localFiles.uploadToBed')"
        :width="dialogWidth"
        append-to-body
        :z-index="zIndex"
        @open="onOpen"
    >
        <el-form label-position="top">
            <el-form-item :label="$t('localFiles.targetChannel')">
                <el-select
                    v-model="form.channelId"
                    :placeholder="$t('localFiles.targetChannelDefault')"
                    clearable
                    style="width: 100%;"
                    popper-class="lf-upload-select-popper"
                >
                    <el-option v-for="c in channels" :key="c.id" :label="channelLabel(c)" :value="c.id" />
                </el-select>
            </el-form-item>
            <el-form-item :label="$t('localFiles.instance')">
                <el-select v-model="form.instanceId" clearable style="width: 100%;" popper-class="lf-upload-select-popper">
                    <el-option :label="$t('localFiles.instanceDefault')" value="" />
                    <el-option v-for="ins in instances" :key="ins.id" :label="instanceLabel(ins)" :value="ins.id" />
                </el-select>
            </el-form-item>
            <el-form-item :label="$t('localFiles.uploadFolder')">
                <el-input v-model="form.uploadFolder" :placeholder="$t('localFiles.uploadFolderPlaceholder')" />
            </el-form-item>
        </el-form>
        <p v-if="hint" class="ut-hint">{{ hint }}</p>
        <template #footer>
            <el-button :disabled="busy" @click="visible = false">{{ $t('common.cancel') }}</el-button>
            <el-button type="primary" :loading="busy" @click="confirm">{{ $t('localFiles.startUpload') }}</el-button>
        </template>
    </el-dialog>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import { fetchStorageChannels, channelLabel } from '@/utils/storageChannels';

export default {
    name: 'UploadTargetDialog',
    props: {
        modelValue: { type: Boolean, default: false },
        /** 上传进行中：按钮转圈并禁止重复提交 */
        busy: { type: Boolean, default: false },
        /** 自定义标题（不传则用「上传到图床」） */
        title: { type: String, default: '' },
        /** 弹窗下方的一行说明（如「本次将上传 3 个文件」） */
        hint: { type: String, default: '' },
        /** 从灯箱里打开时传 3400（灯箱固定 3200） */
        zIndex: { type: Number, default: undefined },
        /** 回填值：{ channelId, instanceId, uploadFolder } */
        prefill: { type: Object, default: () => ({}) }
    },
    data() {
        return {
            form: { channelId: '', instanceId: '', uploadFolder: '' },
            channels: [],
            instances: [],
            loaded: false
        };
    },
    computed: {
        visible: {
            get() { return this.modelValue; },
            set(v) { this.$emit('update:modelValue', v); }
        },
        dialogWidth() {
            return window.innerWidth < 768 ? '92%' : '560px';
        }
    },
    methods: {
        channelLabel,
        instanceLabel(ins) {
            const idx = Number(ins.index) || 0;
            return idx > 0 ? this.$t('localFiles.instanceWithIndex', { name: ins.name, index: idx }) : ins.name;
        },
        async onOpen() {
            // 回填放在打开时做，保证「上次选的渠道/实例/目录」被带出来
            this.form = {
                channelId: String(this.prefill?.channelId || ''),
                instanceId: String(this.prefill?.instanceId || ''),
                uploadFolder: String(this.prefill?.uploadFolder || '')
            };
            if (this.loaded) return;
            this.loaded = true;
            try {
                const list = await fetchStorageChannels();
                this.channels = Array.isArray(list) ? list : [];
            } catch (e) {
                this.channels = [];
            }
            try {
                const res = await fetchWithAuth('/api/instances');
                const json = await res.json().catch(() => []);
                this.instances = Array.isArray(json) ? json : [];
            } catch (e) {
                this.instances = [];
            }
        },
        confirm() {
            if (this.busy) return;
            this.$emit('confirm', {
                channelId: this.form.channelId || '',
                instanceId: this.form.instanceId || '',
                uploadFolder: String(this.form.uploadFolder || '').trim()
            });
        }
    }
};
</script>

<style scoped>
.ut-hint {
    margin: 4px 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
}
</style>
