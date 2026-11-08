/**
 * 页面「自动复活」守护（v3.0.0，v1.0.6 增强）
 *
 * 背景：浏览器标签页长时间闲置（尤其是手机息屏 / 电脑睡眠 / 关闭浏览器后再打开）后
 * 重新回来时，偶发出现「整页空白、什么都不加载」：
 *   1) 标签页被浏览器回收（tab discard / freeze），恢复时重新加载；
 *   2) 恢复瞬间网络尚未就绪 / 服务端连接池正忙，
 *      入口请求（/api/userConfig）或路由懒加载 chunk 一直挂住或直接失败；
 *   3) 懒加载 chunk 的文件名带哈希，部署更新后旧标签页手里的旧 chunk 404。
 *
 * 处理原则：**只在页面确实是空白 / 挂死时**才重新加载，
 * 正常页面绝不触发，避免打扰用户（不改变任何既有功能与交互）。
 *
 * 触发点：
 *   · vite:preloadError（懒加载 chunk 拉取失败）→ 立即复活
 *   · window error / unhandledrejection 里出现「动态导入失败」→ 立即复活
 *   · 标签页从后台回到前台（visibilitychange）→ 检测是否空白 → 复活
 *   · Page Lifecycle 的 resume（Chrome 冻结后唤醒）→ 同上
 *   · bfcache 恢复（pageshow persisted）→ 同上
 *   · 首屏守护：挂载 9s 后仍空白 → 复活
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

/**
 * 应用根节点是否「什么都没渲染出来」。
 *
 * v1.0.6 修正：旧实现只看 `#app` 有没有子节点和文字 ——
 * 组件树挂载成功但渲染出来是个空壳（router-view 里啥也没有）时，
 * 子节点存在、文字为空，于是被判成「已渲染」，白屏永远不会被复活。
 * 现在的判定顺序：
 *   1. 没有任何子节点 → 空白；
 *   2. 有任何文字 → 有内容（绝大多数页面走这里）；
 *   3. 没文字但有 img / svg / canvas / video / iframe 且根节点有实际高度 → 有内容（纯图标页）；
 *   4. 其余一律按空白处理（空壳 DOM）。
 */
export function isAppBlank() {
    const root = document.getElementById('app');
    if (!root) return true;
    if (root.children.length === 0) return true;
    if ((root.textContent || '').trim()) return false;
    if (root.querySelector('img, svg, canvas, video, iframe, picture')) {
        const rect = root.getBoundingClientRect();
        return rect.height <= 1 && rect.width <= 1;
    }
    // 只有空壳 DOM：挂载了但什么也没画出来
    return true;
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
 * 从后台回到前台后检查一次。
 *
 * 加了两道保护，避免「其实只是网慢」时误刷新：
 *   · 文档还没加载完（readyState ≠ complete）→ 不判，等下一次时机；
 *   · 等 1.2s 让恢复后的渲染跑起来再判。
 */
function checkAfterResume(reason) {
    window.setTimeout(() => {
        if (document.readyState !== 'complete') return;
        if (isAppBlank()) revivePage(reason);
    }, 1200);
}

/**
 * 安装守护。必须在应用挂载之前调用（main.js 顶部），
 * 这样「入口请求挂死导致始终没挂载」也能被首屏守护兜住。
 */
export function setupPageRevive() {
    if (typeof window === 'undefined') return;

    // 1) 懒加载 chunk 失败（部署更新 / 长时间闲置后离线）
    window.addEventListener('vite:preloadError', (event) => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        revivePage('preload-error');
    });

    /*
     * 2) 动态导入失败的兜底（v1.0.6）。
     * 有些浏览器不派发 vite:preloadError，但会把
     * 「Failed to fetch dynamically imported module」抛成 error / unhandledrejection。
     */
    const isDynamicImportError = (text) =>
        /dynamically imported module|Importing a module script failed|Loading chunk \d+ failed/i.test(String(text || ''));
    window.addEventListener('error', (event) => {
        const msg = event?.message || event?.error?.message || '';
        if (isDynamicImportError(msg)) revivePage('dynamic-import-error');
    });
    window.addEventListener('unhandledrejection', (event) => {
        const reason = event?.reason;
        const msg = reason && (reason.message || reason);
        if (isDynamicImportError(msg)) revivePage('dynamic-import-rejection');
    });

    // 3) 从后台回到前台：只检查一次，等一个渲染帧后再判断
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        checkAfterResume('visible-blank');
    });

    /*
     * 4) Page Lifecycle：Chrome 会把闲置标签页 freeze 掉，唤醒时派发 resume
     *    （不一定伴随 visibilitychange，尤其是「关闭浏览器再打开」的恢复路径）。
     */
    document.addEventListener('resume', () => checkAfterResume('lifecycle-resume'));

    // 5) bfcache 恢复（手机端「返回」回来时常见）
    window.addEventListener('pageshow', (event) => {
        if (!event.persisted) return;
        checkAfterResume('pageshow-blank');
    });

    // 6) 首屏守护：9s 后仍空白，说明挂载链路挂住了
    window.setTimeout(() => {
        if (isAppBlank()) revivePage('boot-blank');
    }, 9000);
}
