<template>
    <!--
        v3.0.0：批量「限时 / 加密 / 重定向」三合一处理页（页签顺序：限时 → 加密 → 重定向）
        · 限时   POST /api/manage/batch/expiry   { ids, linkExpiresAt: ISO | '' }
        · 加密   POST /api/manage/batch/password { ids, password | '' }（'' = 清除）
        · 重定向 POST /api/manage/batch/redirect { ids, redirectUrl | '' }
        三个入口按钮打开同一个组件，只决定默认停在哪个页签（initialMode）。
        v3.0.0（第三轮）：窗口标题由「限时 / 重定向」类文案统一改为「批量设置」。
    -->
    <el-dialog
        :model-value="modelValue"
        :title="$t('fileManager.batchSettingsTitle')"
        :width="dialogWidth"
        append-to-body
        align-center
        class="batch-expiry-dialog"
        @update:model-value="$emit('update:modelValue', $event)"
        @open="syncInitialMode"
    >
        <el-tabs v-model="tab" class="batch-expiry-tabs">
            <!-- ── 限时 ─────────────────────────────────────── -->
            <el-tab-pane name="expiry" :label="$t('fileManager.batchExpiry')">
                <div class="be-body">
                    <div class="be-hint">{{ $t('fileManager.expiryHint', { count: ids.length }) }}</div>
                    <div class="be-presets">
                        <button
                            v-for="p in presets"
                            :key="p.value"
                            type="button"
                            class="be-chip"
                            :class="{ 'is-active': preset === p.value }"
                            @click="applyPreset(p.value)"
                        >{{ p.label }}</button>
                    </div>
                    <el-date-picker
                        v-model="expiresAt"
                        type="datetime"
                        :placeholder="$t('fileManager.expiryPick')"
                        :disabled="preset === 'permanent'"
                        class="be-picker"
                        value-format="YYYY-MM-DDTHH:mm:ss"
                        popper-class="batch-expiry-picker-popper"
                        :teleported="true"
                    />
                    <div class="be-hint be-hint-muted">
                        {{ preset === 'permanent' ? $t('fileManager.expiryPermanentHint') : $t('fileManager.expiryHintMuted') }}
                    </div>
                </div>
            </el-tab-pane>

            <!-- ── 加密（v3.0.0 新增） ───────────────────────── -->
            <el-tab-pane name="password" :label="$t('fileManager.batchPassword')">
                <div class="be-body">
                    <div class="be-hint">{{ $t('fileManager.passwordHint', { count: ids.length }) }}</div>
                    <el-input
                        v-model="password"
                        type="password"
                        show-password
                        clearable
                        maxlength="64"
                        :placeholder="$t('fileManager.passwordPlaceholder')"
                    />
                    <div class="be-hint be-hint-muted">{{ $t('fileManager.passwordMuted') }}</div>
                    <div class="be-encrypted-tip">
                        <font-awesome-icon icon="key" class="be-encrypted-icon"/>
                        <span>{{ $t('fileManager.passwordEncryptedHint') }}</span>
                    </div>
                </div>
            </el-tab-pane>

            <!-- ── 重定向 ───────────────────────────────────── -->
            <el-tab-pane name="redirect" :label="$t('fileManager.batchRedirect')">
                <div class="be-body">
                    <div class="be-hint">{{ $t('fileManager.redirectHint', { count: ids.length }) }}</div>
                    <el-input
                        v-model="redirectUrl"
                        :placeholder="$t('fileManager.redirectPlaceholder')"
                        clearable
                    />
                    <div class="be-hint be-hint-muted">{{ $t('fileManager.redirectMuted') }}</div>
                </div>
            </el-tab-pane>
        </el-tabs>

        <template #footer>
            <el-button @click="$emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
            <el-button type="primary" :loading="loading" @click="submit">{{ $t('common.confirm') }}</el-button>
        </template>
    </el-dialog>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';

/** v3.0.0：三个页签的取值（与后端接口一一对应） */
const MODES = ['expiry', 'redirect', 'password'];

export default {
    name: 'BatchExpiryDialog',
    props: {
        modelValue: { type: Boolean, default: false },
        /** 选中文件的 File_ID 列表 */
        ids: { type: Array, default: () => [] },
        /** 打开时预设的页签：'expiry' | 'redirect' | 'password' */
        initialMode: { type: String, default: 'expiry' },
        /** v3.0.0：同 initialMode 的别名（按 mode 传入同样生效） */
        mode: { type: String, default: '' }
    },
    emits: ['update:modelValue', 'done'],
    data() {
        return {
            tab: 'expiry',
            preset: '7d',
            expiresAt: '',
            redirectUrl: '',
            password: '',
            loading: false
        };
    },
    computed: {
        dialogWidth() {
            return window.innerWidth <= 768 ? '92%' : '480px';
        },
        presets() {
            return [
                { value: '1d', label: this.$t('fileManager.expiry1d'), days: 1 },
                { value: '7d', label: this.$t('fileManager.expiry7d'), days: 7 },
                { value: '30d', label: this.$t('fileManager.expiry30d'), days: 30 },
                { value: 'permanent', label: this.$t('fileManager.expiryPermanent') }
            ];
        }
    },
    watch: {
        preset() {
            this.syncPresetDate();
        }
    },
    methods: {
        /** 打开时：按 mode / initialMode 定位页签，并清空上一次的输入 */
        syncInitialMode() {
            // mode 优先（显式给 mode 时以它为准），其次 initialMode，最后落到「限时」
            const wanted = MODES.includes(this.mode)
                ? this.mode
                : (MODES.includes(this.initialMode) ? this.initialMode : 'expiry');
            this.tab = wanted;
            this.preset = '7d';
            this.redirectUrl = '';
            this.password = '';
            this.syncPresetDate();
        },
        applyPreset(value) {
            this.preset = value;
            this.syncPresetDate();
        },
        /** 快捷项 → 具体时间（永久 = 清空 linkExpiresAt） */
        syncPresetDate() {
            if (this.preset === 'permanent') {
                this.expiresAt = '';
                return;
            }
            const hit = this.presets.find((p) => p.value === this.preset);
            if (!hit || !hit.days) return;
            const d = new Date(Date.now() + hit.days * 86400000);
            const p = (n) => String(n).padStart(2, '0');
            this.expiresAt = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        },
        async submit() {
            if (!this.ids.length) return;
            this.loading = true;
            try {
                const map = {
                    expiry: {
                        url: '/api/manage/batch/expiry',
                        body: { ids: [...this.ids], linkExpiresAt: this.preset === 'permanent' ? '' : (this.expiresAt || '') }
                    },
                    redirect: {
                        url: '/api/manage/batch/redirect',
                        body: { ids: [...this.ids], redirectUrl: String(this.redirectUrl || '').trim() }
                    },
                    // v3.0.0：加密 —— '' 表示清除已设置的密码
                    password: {
                        url: '/api/manage/batch/password',
                        body: { ids: [...this.ids], password: String(this.password || '') }
                    }
                };
                const target = map[this.tab] || map.expiry;
                const res = await fetchWithAuth(target.url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(target.body)
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
.be-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 4px;
}
.be-hint {
    font-size: 12px;
    line-height: 1.6;
    opacity: 0.75;
}
.be-hint-muted {
    font-size: 11px;
    opacity: 0.55;
}
.be-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.be-chip {
    padding: 5px 14px;
    font-size: 12px;
    border-radius: 8px;
    border: 1px solid var(--glass-border, rgba(128, 128, 128, 0.3));
    background: transparent;
    color: inherit;
    cursor: pointer;
    transition: all 0.18s ease;
}
.be-chip:hover {
    border-color: var(--primary-color-accent, var(--el-color-primary));
}
.be-chip.is-active {
    background: color-mix(in srgb, var(--primary-color, var(--el-color-primary)) 16%, transparent);
    border-color: var(--primary-color-accent, var(--el-color-primary));
    color: var(--primary-color-accent, var(--el-color-primary));
}
.be-picker {
    width: 100%;
}
/* v3.0.0：加密页签的「已加密」提示条 */
.be-encrypted-tip {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--el-border-color-lighter);
    background: var(--el-fill-color-light);
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.85;
}
.be-encrypted-icon {
    width: 12px;
    margin-top: 2px;
    color: var(--el-color-warning);
}
</style>

<style>
/*
 * v3.0.0：移动端日期时间选择必须居中弹层 ——
 * el-date-picker 的 popper 默认贴在输入框下方定位，弹窗内空间不足时会被裁切；
 * 移动端这里统一改成「屏幕居中、固定定位」，桌面端保持原有下拉位置。
 */
@media (max-width: 768px) {
    .batch-expiry-picker-popper.el-picker__popper {
        position: fixed !important;
        top: 50% !important;
        left: 50% !important;
        right: auto !important;
        bottom: auto !important;
        margin: 0 !important;
        transform: translate(-50%, -50%) !important;
        max-width: 94vw;
    }
    .batch-expiry-picker-popper .el-picker-panel {
        max-width: 94vw;
    }
}

/* 三合一处理页在移动端固定 92% 宽（align-center 负责垂直居中） */
@media (max-width: 768px) {
    .batch-expiry-dialog.el-dialog {
        width: 92% !important;
        max-width: 92vw;
        margin: 0 auto;
    }
}
</style>
