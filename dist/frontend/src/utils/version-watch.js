/**
 * 版本更新守卫（v1.3.6）
 *
 * 背景：系统更新后，已经打开的标签页仍跑着旧的前端产物；用户不手动清缓存时，
 * 看不到新功能，甚至旧的哈希 chunk 已被清理而报错。
 *
 * 做法：不依赖「版本号」这种需要人工同步的字段，而是直接比较**入口脚本文件名**——
 *   · Vite 产物带内容哈希，重新构建后 index.html 引用的 index-xxxx.js 一定会变；
 *   · 定时 / 回到前台时用 no-store 拉一次首页 HTML，取出入口脚本名与当前页面比较；
 *   · 不一致就 reload 一次（HTML 已改为 no-store，刷新必然拿到新入口）。
 *
 * 防打扰：
 *   · 只在页面可见时检查；
 *   · 两次自动刷新至少间隔 60 秒，避免异常情况下刷新风暴；
 *   · 首次检查延迟 20 秒，不和首屏加载抢带宽。
 */

const CHECK_DELAY_MS = 20 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MIN_RELOAD_GAP_MS = 60 * 1000;
const RELOAD_KEY = 'gohub:lastAutoReload';

const ENTRY_RE = /assets\/index-[A-Za-z0-9_-]+\.js/;

/** 当前页面实际加载的入口脚本名 */
function currentEntry() {
    const script = document.querySelector('script[type="module"][src*="/assets/"]');
    const src = script ? String(script.getAttribute('src') || '') : '';
    const m = ENTRY_RE.exec(src);
    return m ? m[0] : '';
}

function entryOfHtml(html) {
    const m = ENTRY_RE.exec(String(html || ''));
    return m ? m[0] : '';
}

function reloadOnce() {
    let last = 0;
    try {
        last = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0) || 0;
    } catch (e) { /* 隐私模式忽略 */ }
    if (Date.now() - last < MIN_RELOAD_GAP_MS) return;
    try {
        window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch (e) { /* ignore */ }
    window.location.reload();
}

async function check() {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    const mine = currentEntry();
    if (!mine) return;
    try {
        const res = await fetch(`/?__v=${Date.now()}`, {
            cache: 'no-store',
            headers: { Accept: 'text/html' },
        });
        if (!res.ok) return;
        const next = entryOfHtml(await res.text());
        if (next && next !== mine) reloadOnce();
    } catch (e) {
        /* 网络抖动忽略，下一轮再试 */
    }
}

export function setupVersionWatch() {
    if (typeof window === 'undefined') return;
    setTimeout(check, CHECK_DELAY_MS);
    setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') setTimeout(check, 800);
    });
}
