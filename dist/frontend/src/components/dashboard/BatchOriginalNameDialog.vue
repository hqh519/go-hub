<template>
    <!--
        v3.0.0：批量「编辑原名」
        POST /api/manage/batch/original-name { ids, mode, find?, replace?, value?, ext? }
        五种模式与后端一致：replace 查找替换 / rewrite 重写 / prepend 前缀 / append 后缀 / ext 改扩展名。
    -->
    <el-dialog
        :model-value="modelValue"
        :title="$t('fileManager.editOriginalName')"
        :width="dialogWidth"
        append-to-body
        class="batch-original-name-dialog"
        @update:model-value="$emit('update:modelValue', $event)"
        @open="reset"
    >
        <div class="bon-body">
            <div class="bon-hint">{{ $t('fileManager.originalNameHint', { count: ids.length }) }}</div>
            <el-radio-group v-model="mode" class="bon-modes">
                <el-radio-button label="replace">{{ $t('fileManager.nameModeReplace') }}</el-radio-button>
                <el-radio-button label="rewrite">{{ $t('fileManager.nameModeRewrite') }}</el-radio-button>
                <el-radio-button label="prepend">{{ $t('fileManager.nameModePrepend') }}</el-radio-button>
                <el-radio-button label="append">{{ $t('fileManager.nameModeAppend') }}</el-radio-button>
                <el-radio-button label="ext">{{ $t('fileManager.nameModeExt') }}</el-radio-button>
            </el-radio-group>

            <!--
                v3.0.0：前四种模式后端只改「主名」，扩展名原样保留；
                改扩展名是下方独立的 ext 模式（单独提交 mode='ext'）。
            -->
            <div v-if="mode !== 'ext'" class="bon-hint bon-hint-muted">{{ $t('fileManager.originalNameExtHint') }}</div>

            <div v-if="mode === 'replace'" class="bon-row">
                <el-input v-model="find" :placeholder="$t('fileManager.nameFind')" />
                <span class="bon-arrow">→</span>
                <el-input v-model="replace" :placeholder="$t('fileManager.nameReplace')" />
            </div>
            <div v-else-if="mode === 'ext'" class="bon-row">
                <el-input v-model="ext" :placeholder="$t('fileManager.nameExtPlaceholder')" />
            </div>
            <div v-else class="bon-row">
                <el-input v-model="value" :placeholder="valuePlaceholder" />
            </div>

            <div class="bon-hint bon-hint-muted">{{ modeHint }}</div>
        </div>
        <template #footer>
            <el-button @click="$emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
            <el-button type="primary" :loading="loading" :disabled="!canSubmit" @click="submit">
                {{ $t('common.confirm') }}
            </el-button>
        </template>
    </el-dialog>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';

export default {
    name: 'BatchOriginalNameDialog',
    props: {
        modelValue: { type: Boolean, default: false },
        /** 选中文件的 File_ID 列表 */
        ids: { type: Array, default: () => [] }
    },
    emits: ['update:modelValue', 'done'],
    data() {
        return {
            mode: 'replace',
            find: '',
            replace: '',
            value: '',
            ext: '',
            loading: false
        };
    },
    computed: {
        dialogWidth() {
            return window.innerWidth <= 768 ? '92%' : '520px';
        },
        valuePlaceholder() {
            if (this.mode === 'rewrite') return this.$t('fileManager.nameRewritePlaceholder');
            if (this.mode === 'prepend') return this.$t('fileManager.namePrependPlaceholder');
            return this.$t('fileManager.nameAppendPlaceholder');
        },
        modeHint() {
            const map = {
                replace: 'fileManager.nameModeReplaceHint',
                rewrite: 'fileManager.nameModeRewriteHint',
                prepend: 'fileManager.nameModePrependHint',
                append: 'fileManager.nameModeAppendHint',
                ext: 'fileManager.nameModeExtHint'
            };
            return this.$t(map[this.mode]);
        },
        canSubmit() {
            if (!this.ids.length) return false;
            if (this.mode === 'replace') return !!this.find;
            if (this.mode === 'ext') return !!this.ext.trim();
            return !!this.value.trim();
        }
    },
    methods: {
        reset() {
            this.mode = 'replace';
            this.find = '';
            this.replace = '';
            this.value = '';
            this.ext = '';
        },
        async submit() {
            if (!this.canSubmit) return;
            this.loading = true;
            try {
                const body = { ids: [...this.ids], mode: this.mode };
                if (this.mode === 'replace') {
                    body.find = this.find;
                    body.replace = this.replace;
                } else if (this.mode === 'ext') {
                    body.ext = this.ext.trim();
                } else {
                    body.value = this.value.trim();
                }
                const res = await fetchWithAuth('/api/manage/batch/original-name', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const json = await res.json().catch(() => ({}));
                if (json?.success === false) throw new Error(json?.message || 'failed');
                const updated = Number(json?.updated || 0);
                const failed = Array.isArray(json?.failed) ? json.failed.length : 0;
                if (failed > 0) this.$message.warning(this.$t('fileManager.batchPartial', { ok: updated, fail: failed }));
                else this.$message.success(this.$t('fileManager.batchDone', { count: updated }));
                this.$emit('update:modelValue', false);
                this.$emit('done');
            } catch (e) {
                this.$message.error(e?.message || this.$t('common.failed'));
            } finally {
                this.loading = false;
            }
        }
    }
};
</script>

<style scoped>
.bon-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.bon-hint {
    font-size: 12px;
    line-height: 1.6;
    opacity: 0.75;
}
.bon-hint-muted {
    opacity: 0.55;
    font-size: 11px;
}
.bon-modes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.bon-row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.bon-arrow {
    flex: 0 0 auto;
    opacity: 0.55;
}
</style>
