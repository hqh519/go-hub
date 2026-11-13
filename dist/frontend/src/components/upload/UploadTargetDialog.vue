<template>
    <!--
        v1.0.7：统一的「上传目标配置」弹窗。
        原先这套「目标渠道 / 归属实例 / 上传目录」的选择只存在于「本地文件」页的上传弹窗里，
        视频灯箱的抓拍图上传只能走后端默认值（主渠道 + 默认实例 + 默认目录）。
        现在把它抽成组件，两处（以及以后任何需要上传的地方）共用同一套交互与校验：
          · 选项由组件自己拉（渠道 = 存储渠道列表，实例 = /api/instances），
            调用方只需要接 @confirm({ channelId, instanceId, uploadFolder })。
          · 不接收 z-index：**由 EP 全局 zIndex 管理器分配**。

        v1.0.8 修正（用户反馈「抓拍图弹窗里目标渠道/归属实例下拉框展不开」）：
          之前调用方给弹窗硬传 z-index: 3400，而弹窗里的 el-select 下拉浮层是 teleport 到
          body 的 popper，它的 z-index 走 EP 的 useZIndex 递增（基准 3210，open 时取 3211…3200+）。
          两者不同源 → 浮层 3211 被弹窗 3400 盖住，看起来就是「点开下拉框但什么都看不到」。
          现在整个链路都交给 EP 管理器：弹窗先 open 拿 nextZIndex()，浮层后 open 再拿更大的值，
          天然永远在弹窗之上；灯箱固定 3200 只作背景层，3210+ 的弹窗本来就压得住它。
    -->
    <!--
        v1.1.7：只能靠按钮或 Esc 关闭（需求原文）。
        点遮罩关掉容易误触 —— 这是个带表单的弹窗，误关一次就得把渠道 / 实例 / 目录
        重新选一遍，所以直接禁掉点遮罩关闭。
    -->
    <el-dialog
        v-model="visible"
        :title="title || $t('localFiles.uploadToBed')"
        :width="dialogWidth"
        append-to-body
        :close-on-click-modal="false"
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
            <!--
                v1.1.9.1（需求）：
                  · 「上传目录」输入框左侧加目录选择器，可直接从当前实例的目录树里挑；
                    与首页右下角「上传设置」里的那个是同一个组件、同一套交互。
                  · 输入框换成 DirectorySuggestionInput —— 光标进入即列出「最近用过的目录」，
                    输入时给出目录树里的同名候选；失焦/回车把当前值记进本地历史
                    （history-key 与上传设置共用，两处互相看得见）。
            -->
            <el-form-item :label="$t('localFiles.uploadFolder')">
                <div class="ut-folder-row">
                    <DirectoryTreePicker
                        :current-directory="form.uploadFolder"
                        :instance-id="form.instanceId || ''"
                        source="upload"
                        @select="handleFolderSelect"
                    >
                        <template #trigger>
                            <el-button class="ut-folder-btn" :title="$t('directoryTree.selectDirectory')">
                                <font-awesome-icon icon="folder-tree" />
                            </el-button>
                        </template>
                    </DirectoryTreePicker>
                    <DirectorySuggestionInput
                        v-model="form.uploadFolder"
                        :placeholder="$t('localFiles.uploadFolderPlaceholder')"
                        history-key="gohub:recent:uploadFolder"
                        class="ut-folder-input"
                    />
                </div>
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
import DirectoryTreePicker from '@/components/DirectoryTreePicker.vue';
import DirectorySuggestionInput from '@/components/DirectorySuggestionInput.vue';
import { bindDialogLayers } from '@/utils/layerStack';

/** v1.1.9.2：每个「上传到图床」实例一个层 id（同一页面可能有多个） */
let uploadTargetSeq = 0;

export default {
    name: 'UploadTargetDialog',
    components: { DirectoryTreePicker, DirectorySuggestionInput },
    props: {
        modelValue: { type: Boolean, default: false },
        /** 上传进行中：按钮转圈并禁止重复提交 */
        busy: { type: Boolean, default: false },
        /** 自定义标题（不传则用「上传到图床」） */
        title: { type: String, default: '' },
        /** 弹窗下方的一行说明（如「本次将上传 3 个文件」） */
        hint: { type: String, default: '' },
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
        /** 目录树选中：统一成「/a/b」形式（与目录树按钮在别处的口径一致） */
        handleFolderSelect(path) {
            const val = path ? `/${String(path).replace(/^\/+/, '')}` : '';
            this.form.uploadFolder = val;
        },
        confirm() {
            if (this.busy) return;
            this.$emit('confirm', {
                channelId: this.form.channelId || '',
                instanceId: this.form.instanceId || '',
                uploadFolder: String(this.form.uploadFolder || '').trim()
            });
        }
    },
    mounted() {
        /*
         * v1.1.9.2：「上传到图床」弹窗纳入层叠监测。
         * 本组件会在瞬间编辑页、首页、本地文件页等多处实例化，层 id 必须带序号，
         * 否则后打开的实例会把先打开的顶掉（那一层就再也关不掉了）。
         */
        uploadTargetSeq += 1;
        this._layerId = `upload-target-${uploadTargetSeq}`;
        this._unbindLayers = bindDialogLayers(this, {
            visible: { id: this._layerId, close: () => { this.visible = false; } }
        });
    },
    beforeUnmount() {
        if (this._unbindLayers) {
            this._unbindLayers();
            this._unbindLayers = null;
        }
    }
};
</script>

<style scoped>
/* v1.1.9.1：目录选择器 + 输入框同一行；输入框吃掉剩余宽度 */
.ut-folder-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
}

.ut-folder-row .ut-folder-btn {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.ut-folder-row .ut-folder-input {
    flex: 1 1 auto;
    min-width: 0;
}

.ut-hint {
    margin: 4px 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
}
</style>
