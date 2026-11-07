import store from '@/store'
import router from '@/router'

let isRedirecting = false;

/**
 * v1.0.2：401 不再直接判定「会话过期」。
 *
 * 用户反馈「有效期设了 90 天，一天还是被登出好几次」。原因是这里把**任何** 401
 * 都当成会话失效，立刻清登录态并跳登录页：
 *   · 某个接口因为 2FA 未验证 / 权限不足返回 401；
 *   · 多标签页里有一条请求撞上后端重启的窗口；
 *   · 并发请求中先回来的那条 401，其余其实还正常。
 * 这些情况下会话其实还在，却被强制踢回登录页。
 *
 * 现在改为「先问服务端再决定」：拿到 401 后调一次 /api/auth/sessionCheck，
 * 只有服务端明确返回 valid=false 才清登录态；否则把 401 正常交给调用方处理。
 */
async function sessionReallyInvalid() {
    try {
        const resp = await fetch('/api/auth/sessionCheck', { credentials: 'include' });
        if (!resp.ok) return false; // 服务端异常（重启中 / 5xx）→ 保守认为会话还在
        const data = await resp.json().catch(() => null);
        if (!data || data.success === false) return false;
        return data.valid === false;
    } catch {
        // 网络错误 → 不能据此登出
        return false;
    }
}

export default async function fetchWithAuth(url, options = {}) {
    // GoHub：统一补齐 /api 前缀（若调用方已带则保持不变）
    if (!url.startsWith('/api')) url = `/api${url}`;

    // 确保包含凭据（HttpOnly Cookie 会自动携带）
    options.credentials = 'include';

    options.headers = {
        ...options.headers,
    };

    const response = await fetch(url, options);

    if (response.status === 401 && !isRedirecting) {
        // 二次确认：真的是会话没了才跳登录页
        if (await sessionReallyInvalid()) {
            isRedirecting = true;
            store.commit('setAdminLoggedIn', false);
            // 静默跳转登录页，不弹出错误提示（路由守卫负责认证 UX）
            router.push('/adminLogin').finally(() => {
                isRedirecting = false;
            });
        }
    }

    return response;
}
