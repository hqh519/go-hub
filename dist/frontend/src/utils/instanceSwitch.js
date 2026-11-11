/**
 * 实例「切换密码」守卫（v1.1.3）
 * ----------------------------------------------------------------------------
 * 需求：
 *   · 实例属性页可以给实例设一个切换密码（账户密码 / 两步验证动态码 / 自定义密码）；
 *   · 启用后，每次从首页、图床管理页、笔记管理页切换到该实例都要先验证；
 *   · **任意一个页面验证过之后，其他页面刷新时不再重复验证**。
 *
 * 「不重复验证」这件事由后端负责：验证通过后后端在进程内给当前账户种一张
 * 12 小时通行证（/api/instances/:id/switch-lock 会返回 locked=false）。
 * 所以这里每次切实例只要问一句「要不要拦」，需要拦才弹框，
 * 三个页面共用同一个函数，行为天然一致。
 */
import { ElMessage, ElMessageBox } from 'element-plus';
import i18n from '@/locales';
import fetchWithAuth from '@/utils/fetchWithAuth';

const t = (k, o) => i18n.global.t(k, o || {});

/**
 * 确保可以切换到目标实例。
 * @param {string} instanceId 目标实例 id（空串 = 默认实例，默认实例不参与切换密码）
 * @returns {Promise<boolean>} true = 可以切；false = 用户取消或验证失败后放弃
 */
export async function ensureInstanceUnlocked(instanceId) {
    const id = String(instanceId || '');
    // 默认实例没有实例记录，也就无从配置切换密码
    if (!id) return true;

    let state = null;
    try {
        const res = await fetchWithAuth(`/api/instances/${encodeURIComponent(id)}/switch-lock`);
        if (!res.ok) return true; // 接口异常不应该把用户堵在门外
        state = await res.json().catch(() => null);
    } catch (e) {
        return true;
    }
    if (!state || !state.locked) return true;

    const isTotp = state.mode === 'totp';
    const hint = isTotp
        ? t('instanceSwitch.totpHint')
        : state.mode === 'account'
            ? t('instanceSwitch.accountHint')
            : t('instanceSwitch.customHint');

    // 验证失败不关弹窗，让用户改一下再试；点取消才放弃
    for (;;) {
        let value = '';
        try {
            const r = await ElMessageBox.prompt(hint, t('instanceSwitch.title'), {
                confirmButtonText: t('common.confirm'),
                cancelButtonText: t('common.cancel'),
                inputType: isTotp ? 'text' : 'password',
                inputPlaceholder: isTotp ? '123456' : '••••••',
                closeOnClickModal: false,
                inputValidator: (v) => (String(v || '').trim() ? true : t('instanceSwitch.needValue'))
            });
            value = r && r.value != null ? String(r.value) : '';
        } catch (e) {
            return false;
        }

        try {
            const res = await fetchWithAuth(`/api/instances/${encodeURIComponent(id)}/verify-switch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(isTotp ? { code: value.trim() } : { password: value })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data && data.ok) return true;
            ElMessage.error(data.error || data.message || t('instanceSwitch.fail'));
        } catch (e) {
            ElMessage.error(t('instanceSwitch.fail'));
            return false;
        }
    }
}

export default { ensureInstanceUnlocked };
