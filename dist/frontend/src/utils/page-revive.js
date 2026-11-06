/**
 * 页面「自动复活」守护（v3.0.0）
 *
 * 背景：浏览器标签页长时间闲置（尤其是手机息屏 / 电脑睡眠）后重新打开时，
 * 偶发出现「整页空白、什么都不加载」：
 *   1) 标签页被浏览器回收（tab discard），恢复时重新加载；
 *   2) 恢复瞬间网络尚未就绪 / 服务端连接池正忙，
 *      入口请求（/api/userConfig）或路由懒加载 chunk 一直挂住或直接失败；
 *   3) 懒加载 chunk 的文件名带哈希，部署更新后旧标签页手里的旧 chunk 404。
 *
 * 处理原则：**只在页面确实是空白 / 挂死时**才重新加载，
 * 正常页面绝不触发，避免打扰用户（不改变任何既有功能与交互）。
 *
 * 触发点：
 *   · vite:preloadError（懒加载 chunk 拉取失败）→ 立即复活
 *   · 标签页从后台回到前台（visibilitychange）→ 检测是否空白 → 复活
 *   · bfcache 恢复（pageshow persisted）→ 同上
 *   · 首屏守护：挂载 12s 后仍空白 → 复活
 *
 * 防抖：同一次会话 60s 内最多复活一次、总计最多 3 次，
 * 避免「服务端真的挂了」时无限刷新。
 */

const REVIVE_KEY = 'gohub:lastReviveAt';
const REVIVE_COUNT_KEY = 'gohub:reviveCount';
const MIN_GAP_MS = 60 * 1000;
const MAX_TIMES = 3;

function readNum(key) {
    try {
        return Number(window.sessionStorage.getItem(key) || 0) || 0;
    } catch (e) {
        return 0;
    }
}

function writeNum(key, value) {
    try {
        window.sessionStorage.setItem(key, String(value));
    } catch (e) { /* 隐私模式忽略 */ }
}

/** 应用根节点是否「什么都没渲染出来」 */
export function isAppBlank() {
    const root = document.getElementById('app');
    if (!root) return true;
    if (root.children.length === 0) return true;
    const text = (root.textContent || '').trim();
    if (text) return false;
    // 有子节点但没有任何文字：看图是否有实际占位高度（纯图标页也算已渲染）
    const rect = root.getBoundingClientRect();
    return rect.height <= 1 && rect.width <= 1;
}

/**
 * 重新加载页面（带防抖 / 次数上限）。
 * 返回 true 表示本次确实发起了刷新。
 */
export function revivePage(reason) {
    if (typeof window === 'undefined') return false;
    const now = Date.now();
    if (now - readNum(REVIVE_KEY) < MIN_GAP_MS) return false;
    if (readNum(REVIVE_COUNT_KEY) >= MAX_TIMES) return false;
    writeNum(REVIVE_KEY, now);
    writeNum(REVIVE_COUNT_KEY, readNum(REVIVE_COUNT_KEY) + 1);
    try {
        // eslint-disable-next-line no-console
        console.warn('[page-revive] 页面未正常渲染，自动重新加载：' + reason);
    } catch (e) { /* 忽略 */ }
    window.location.reload();
    return true;
}

/**
 * 安装守护。必须在应用挂载之前调用（main.js 顶部），
 * 这样「入口请求挂死导致始终没挂载」也能被 12s 守护兜住。
 */
export function setupPageRevive() {
    if (typeof window === 'undefined') return;

    // 1) 懒加载 chunk 失败（部署更新 / 长时间闲置后离线）
    window.addEventListener('vite:preloadError', (event) => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        revivePage('preload-error');
    });

    // 2) 从后台回到前台：只检查一次，等一个渲染帧后再判断
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        window.setTimeout(() => {
            if (isAppBlank()) revivePage('visible-blank');
        }, 800);
    });

    // 3) bfcache 恢复（手机端「返回」回来时常见）
    window.addEventListener('pageshow', (event) => {
        if (!event.persisted) return;
        window.setTimeout(() => {
            if (isAppBlank()) revivePage('pageshow-blank');
        }, 800);
    });

    // 4) 首屏守护：12s 后仍空白，说明挂载链路挂住了
    window.setTimeout(() => {
        if (isAppBlank()) revivePage('boot-blank');
    }, 12000);
}
