<template>
    <div class="container">
        <AdminHeader active-tab="superAdmin" />
        <div class="main-container">
            <el-card class="super-card">
                <template #header>
                    <div class="super-card-header">
                        <font-awesome-icon icon="user-shield" class="super-icon"/>
                        <span>{{ $t('login.superTitle') }}</span>
                    </div>
                </template>
                <p class="super-tip">{{ $t('superAdmin.tip') }}</p>
                <el-form label-position="top" class="super-form">
                    <el-form-item :label="$t('login.newAdminUsername')">
                        <el-input v-model="username" :placeholder="$t('superAdmin.usernamePlaceholder')" clearable />
                    </el-form-item>
                    <el-form-item :label="$t('login.newAdminPassword')">
                        <el-input v-model="password" type="password" show-password :placeholder="$t('superAdmin.passwordPlaceholder')" clearable />
                    </el-form-item>
                    <el-form-item>
                        <el-button type="primary" :loading="saving" @click="submit">{{ $t('common.save') }}</el-button>
                        <el-button @click="logout">{{ $t('dashboard.logout') }}</el-button>
                    </el-form-item>
                </el-form>
            </el-card>
        </div>
    </div>
</template>

<script>
import axios from '@/utils/axios';
import AdminHeader from '@/components/dashboard/AdminHeader.vue';
import backgroundManager from '@/mixins/backgroundManager';

/**
 * 超级管理员页 —— 仅用于「初始管理员密码遗忘后找回」。
 *
 * 超级管理员由 docker .env 的 SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD 定义，
 * 后台无法修改/删除；登录后仅能修改管理员的用户名与密码，不暴露任何其它管理功能。
 */
export default {
    name: 'SuperAdmin',
    mixins: [backgroundManager],
    components: { AdminHeader },
    data() {
        return { username: '', password: '', saving: false };
    },
    mounted() {
        this.initializeBackground('adminBkImg', '.container', false, true);
    },
    methods: {
        async submit() {
            if (!this.username && !this.password) {
                this.$message.warning(this.$t('superAdmin.needInput'));
                return;
            }
            this.saving = true;
            try {
                const res = await axios.post('/api/auth/superUpdateAdmin', {
                    username: this.username,
                    password: this.password
                }, { withCredentials: true });
                if (res.data?.success) {
                    this.$message.success(this.$t('login.superUpdateSuccess'));
                    this.username = '';
                    this.password = '';
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.saving = false;
            }
        },
        logout() {
            axios.post('/api/auth/logout', {}, { withCredentials: true }).finally(() => {
                this.$store.commit('clearSession');
                this.$router.push('/login');
            });
        }
    }
};
</script>

<style scoped src="@/styles/admin-common.css"></style>
<style scoped>
.container {
    background: var(--admin-container-bg-color);
    min-height: 100vh;
    color: var(--admin-container-color);
}
.main-container {
    display: flex;
    justify-content: center;
    margin-top: 40px;
    padding: 0 16px;
}
.super-card {
    width: 100%;
    max-width: 520px;
    border-radius: 16px;
    border: 1px solid var(--glass-border);
    background: var(--glass-bg) !important;
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
}
.super-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 16px;
    font-weight: 600;
}
.super-icon {
    color: var(--primary-color);
}
.super-tip {
    margin: 0 0 18px;
    font-size: 13px;
    line-height: 1.7;
    color: var(--text-color-secondary, #666);
}
</style>
