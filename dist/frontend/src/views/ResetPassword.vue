<template>
    <div class="reset-page">
        <div class="reset-card">
            <h1 class="reset-title">{{ $t('reset.title') }}</h1>
            <template v-if="done">
                <p class="reset-message">{{ $t('reset.done') }}</p>
                <el-button type="primary" class="reset-submit" @click="goLogin">{{ $t('reset.goLogin') }}</el-button>
            </template>
            <template v-else>
                <p class="reset-hint">{{ $t('reset.hint') }}</p>
                <el-input
                    v-model="password"
                    type="password"
                    show-password
                    :placeholder="$t('reset.newPassword')"
                    class="reset-input"
                    clearable
                />
                <el-input
                    v-model="password2"
                    type="password"
                    show-password
                    :placeholder="$t('reset.confirmPassword')"
                    class="reset-input"
                    clearable
                    @keyup.enter="submit"
                />
                <el-button
                    type="primary"
                    class="reset-submit"
                    :loading="busy"
                    :disabled="!token"
                    @click="submit"
                >
                    {{ $t('reset.submit') }}
                </el-button>
                <p v-if="!token" class="reset-error">{{ $t('reset.noToken') }}</p>
            </template>
        </div>
    </div>
</template>

<script>
import axios from '@/utils/axios';

/**
 * v2.6.0：忘记密码 → 邮件重置链接落地页（/reset-password?token=...）。
 * 公开访问；token 一次性、10 分钟有效（后端校验）。
 */
export default {
    name: 'ResetPasswordView',
    data() {
        return {
            token: this.$route.query?.token || '',
            password: '',
            password2: '',
            busy: false,
            done: false
        };
    },
    methods: {
        goLogin() {
            this.$router.replace({ name: 'login' });
        },
        async submit() {
            if (!this.password || this.password.length < 4) {
                this.$message.warning(this.$t('reset.tooShort'));
                return;
            }
            if (this.password !== this.password2) {
                this.$message.warning(this.$t('reset.mismatch'));
                return;
            }
            this.busy = true;
            try {
                const res = await axios.post(
                    '/api/auth/password/reset',
                    { token: this.token, password: this.password },
                    { withCredentials: true },
                );
                if (res.data?.success) {
                    this.$message.success(res.data.message || this.$t('reset.done'));
                    this.done = true;
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.busy = false;
            }
        }
    }
};
</script>

<style scoped>
.reset-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--admin-container-bg-color, var(--bg-color));
    padding: 20px;
    box-sizing: border-box;
}
.reset-card {
    width: 420px;
    max-width: 92vw;
    border-radius: 12px;
    background-color: var(--glass-bg);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border: 1px solid var(--glass-border);
    padding: 36px 32px;
    box-sizing: border-box;
}
.reset-title {
    margin: 0 0 14px;
    font-size: 1.4rem;
    text-align: center;
    color: var(--text-color);
}
.reset-hint,
.reset-message {
    margin: 0 0 16px;
    font-size: 13px;
    color: var(--text-color-secondary, #909399);
    line-height: 1.7;
    text-align: center;
}
.reset-input {
    margin-bottom: 14px;
}
.reset-submit {
    width: 100%;
    height: 44px;
    font-size: 1rem;
    font-weight: 600;
    border-radius: 10px;
}
.reset-error {
    margin: 12px 0 0;
    color: var(--el-color-danger, #f56c6c);
    font-size: 13px;
    text-align: center;
}
</style>
