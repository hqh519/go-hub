<template>
    <!-- 登录页背景图统一取「管理端设置 → 登录页背景图」（adminLoginBkImg）：
         客户端设置里的同名项已移除，避免两处配置互相打架 -->
    <BaseLogin
        :title="loginTitle"
        :fields="loginFields"
        :submit-text="$t('login.submit')"
        background-key="adminLoginBkImg"
        :is-admin="false"
        :loading="isLoading"
        @submit="handleLogin"
    />
</template>

<script>
import axios from '@/utils/axios'
import { mapGetters } from 'vuex'
import BaseLogin from '@/components/BaseLogin.vue'

/**
 * 统一登录页 —— 用户名 + 密码。
 *
 * 账户体系只有一套：管理员、普通用户、超级管理员都从这里登录。
 * 登录成功后按后端返回的 role 分流：
 *   - admin / super → 进入后台「文件管理」(/dashboard)
 *   - user          → 进入前台上传页 (/)
 */
export default {
    data() {
        return {
            isLoading: false,
            loginFields: []
        }
    },
    computed: {
        ...mapGetters(['userConfig']),
        ownerName() {
            return this.userConfig?.ownerName || 'GoHub'
        },
        loginTitle() {
            // 登录页标题只显示图床名称，不再加「登录到 …」前后缀
            return this.ownerName
        }
    },
    components: {
        BaseLogin
    },
    created() {
        this.updateLoginFields();
    },
    watch: {
        '$i18n.locale'() {
            this.updateLoginFields();
        }
    },
    methods: {
        updateLoginFields() {
            this.loginFields = [
                {
                    key: 'username',
                    label: this.$t('login.username'),
                    placeholder: this.$t('login.usernamePlaceholder'),
                    type: 'text',
                    icon: 'User'
                },
                {
                    key: 'password',
                    label: this.$t('login.password'),
                    placeholder: this.$t('login.adminPasswordPlaceholder'),
                    type: 'password',
                    showPassword: true,
                    icon: 'Lock'
                }
            ];
        },
        async handleLogin(formData) {
            const { username, password } = formData;
            if (!username || !password) {
                this.$message.error(this.$t('login.failed'));
                return;
            }

            this.isLoading = true;

            const minDelayPromise = new Promise(resolve => setTimeout(resolve, 500));
            const loginPromise = axios.post('/api/auth/login', {
                username,
                password
            }, {
                withCredentials: true
            }).then(res => ({ res })).catch(err => ({ err }));

            try {
                const [result] = await Promise.all([loginPromise, minDelayPromise]);

                if (result.res && result.res.status === 200) {
                    const info = (result.res.data && result.res.data.data) || {};
                    // 会话 Token 已通过 HttpOnly Cookie 由后端设置
                    this.$store.commit('setSession', {
                        role: info.role,
                        username: info.username || username,
                        isSuper: info.role === 'super',
                        isAdmin: info.role === 'admin' || info.role === 'super',
                        valid: true
                    });
                    this.$store.dispatch('fetchUserConfig');
                    /*
                     * v202610221824：登录成功后统一回前端页（上传页），不再把管理员
                     * 直接丢进后台。后台入口由导航进入；启用了两步验证的账户在
                     * 打开后台页面时才会弹动态码输入框（见全局 2FA 门禁）。
                     * 超级管理员是「找回管理员」的专用入口，仍直达其页面。
                     */
                    if (info.role === 'super') {
                        this.$router.push('/superAdmin');
                    } else {
                        this.$router.push('/');
                    }
                    this.$message.success(this.$t('login.success'));
                } else {
                    this.isLoading = false;
                    const status = result.err?.response?.status;
                    if (status === 401) {
                        this.$message.error(this.$t('login.adminFailed'));
                    } else {
                        this.$message.error(this.$t('login.failed'));
                    }
                }
            } catch (err) {
                this.isLoading = false;
                this.$message.error(this.$t('login.systemError'));
            }
        }
    }
}
</script>

<style scoped>
</style>
