<template>
    <div class="admin-login-redirect">
        <font-awesome-icon icon="spinner" spin class="spin-icon" />
    </div>
</template>

<script>
/**
 * 兼容旧入口：旧的「管理端登录」页已废弃。
 *
 * 统一账户体系下只有一个登录页（/login），管理员与普通用户共用同一套
 * 用户名 + 密码。任何指向 /adminLogin 的旧链接都会被静默重定向到 /login。
 */
export default {
    name: 'AdminLogin',
    created() {
        this.$router.replace({ name: 'login' });
    }
}
</script>

<style scoped>
.admin-login-redirect {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: var(--admin-container-bg-color, var(--bg-color));
}
.spin-icon {
    font-size: 2rem;
    color: var(--primary-color);
}
</style>
