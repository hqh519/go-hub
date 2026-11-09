/**
 * 页面「自动复活」守护（v3.0.0，v1.0.6 增强，v1.1.0 再增强）
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
 *   · 标签页从后台回到前台（visibilitychange）→ 多轮检测是否空白 → 复活
 *   · Page Lifecycle 的 resume（Chrome 冻结后唤醒）→ 同上
 *   · bfcache 恢复（pageshow persisted）→ 同上
 *   · 首屏守护：挂载 9s 后仍空白 → 复活
 *
 * v1.1.0 修正了三个「有时能活、有时不活」的漏点：
 *   ① 恢复瞬间 `document.readyState` 往往还不是 complete，旧实现直接 return 且不再重试 ——
 *      这一次机会就永久错过。现在改为**多轮检测**（1.2s / 3s / 6s），任意一轮空白都算数；
 *   ② 旧实现只在会话里复活 3 次，用完之后再白屏也不会自动刷新了（只能手刷）。
 *      现在改成「10 分钟滑窗内最多 3 次」：页面正常跑满 2 分钟就把计数清零，
 *      既有防「服务端真挂了」的无限刷新保护，又不会一次用完就永久失效；
 *   ③ 恢复后如果入口请求一直挂着（页面停在加载态），会长时间空白而首屏守护早已过期。
 *      现在恢复后额外布一个 9s 看门狗，仍然空白就重载。
 */

const REVIVE_KEY = 'gohub:lastReviveAt';
const REVIVE_COUNT_KEY = 'gohub:reviveCount';
const REVIVE_WINDOW_KEY = 'gohub:reviveWindowAt';

/** 两次复活的最小间隔（防止刷新风暴） */
const MIN_GAP_MS = 60 * 1000;
/** 单个滑窗内最多复活次数 */
const MAX_TIMES = 3;
/** 滑窗长度：超过这个时间，计数重新开始 */
const WINDOW_MS = 10 * 60 * 1000;
/** 页面连续正常这么久 → 视为「已经稳定」，把计数清零 */
const HEALTHY_RESET_MS = 2 * 60 * 1000;

/** 隐藏超过这个时长，恢复时第一轮（1.2s）就可以判复活，不必等确认轮 */
const LONG_HIDDEN_MS = 30 * 1000;
/** 恢复后的多轮检测时间点（毫秒） */
const RESUME_CHECKS = [1200, 3000, 6000];
/** 恢复后的看门狗：仍空白就重载 */
const RESUME_WATCHDOG_MS = 9000;

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
 * 当前滑窗内已复活次数。
 * 窗口过期（距窗口起点超过 WINDOW_MS）→ 归零重开，避免「用满 3 次就再也不复活」。
 */
function countInWindow(now) {
    const windowAt = readNum(REVIVE_WINDOW_KEY);
    if (!windowAt || now - windowAt > WINDOW_MS) {
        writeNum(REVIVE_WINDOW_KEY, now);
        writeNum(REVIVE_COUNT_KEY, 0);
        return 0;
    }
    return readNum(REVIVE_COUNT_KEY);
}

/**
 * 重新加载页面（带防抖 / 滑窗次数上限）。
 * 返回 true 表示本次确实发起了刷新。
 */
export function revivePage(reason) {
    if (typeof window === 'undefined') return false;
    const now = Date.now();
    if (now - readNum(REVIVE_KEY) < MIN_GAP_MS) return false;
    const used = countInWindow(now);
    if (used >= MAX_TIMES) return false;
    writeNum(REVIVE_KEY, now);
    writeNum(REVIVE_COUNT_KEY, used + 1);
    try {
        // eslint-disable-next-line no-console
        console.warn('[page-revive] 页面未正常渲染，自动重新加载：' + reason);
    } catch (e) { /* 忽略 */ }
    try {
        window.location.reload();
    } catch (e) {
        return false;
    }
    return true;
}

/** 记录本次页面被隐藏的时刻（用于判断「睡了多久」） */
let hiddenAt = 0;
/** 恢复后的定时器（重新隐藏时要清掉，避免在后台瞎判） */
const pendingTimers = [];

function clearPendingTimers() {
    while (pendingTimers.length) {
        const id = pendingTimers.pop();
        try { window.clearTimeout(id); } catch (e) { /* 忽略 */ }
    }
}

/**
 * 从后台回到前台后检查（v1.1.0：多轮）。
 *
 * 三轮检测的意义：
 *   · 恢复瞬间浏览器往往还在「解冻 / 重新拉资源」，`readyState` 不是 complete，
 *     旧实现在这里 return 就再也不检查了 —— 这正是「有时不自动激活」的主因；
 *   · 第一轮（1.2s）只在「确实睡了很久」时才直接判复活，短暂切标签页不误伤；
 *   · 第二、三轮（3s / 6s）作为确认轮：仍然空白就复活（刷新前 60s 防抖会兜住重复）。
 */
function checkAfterResume(reason) {
    if (document.hidden) return;
    // 多个事件（visibilitychange / resume / pageshow）可能几乎同时到，先清掉上一轮的定时器
    clearPendingTimers();
    const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
    const rounds = RESUME_CHECKS.length;
    RESUME_CHECKS.forEach((delay, index) => {
        const id = window.setTimeout(() => {
            if (document.hidden) return;
            if (document.readyState !== 'complete') {
                // 还在加载：交给后面的确认轮，不要在这里放弃
                return;
            }
            if (!isAppBlank()) return;
            // 第一轮：只有「睡了 30s 以上」才立刻复活，否则等确认轮
            if (index === 0 && hiddenFor < LONG_HIDDEN_MS) return;
            revivePage(`${reason}#${index + 1}/${rounds}`);
        }, delay);
        pendingTimers.push(id);
    });

    /*
     * 恢复后的看门狗：入口请求挂死时页面会长时间停在「空白 / 加载态」，
     * 首屏守护（9s，装机时启动）早就过去了，这里补一次。
     */
    const watchdog = window.setTimeout(() => {
        if (document.hidden) return;
        if (isAppBlank()) revivePage('resume-watchdog');
    }, RESUME_WATCHDOG_MS);
    pendingTimers.push(watchdog);
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

    /*
     * 3) 从后台回到前台（v1.1.0：记录隐藏时长 + 多轮检测）。
     *    隐藏时顺手清掉上一轮的定时器，避免「刚回到前台又切走」时在后台误判。
     */
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            hiddenAt = Date.now();
            clearPendingTimers();
            return;
        }
        checkAfterResume('visible-blank');
        // 一次可见周期的检查做完就把隐藏时刻清掉，避免下次拿旧时长误判
        window.setTimeout(() => { if (!document.hidden) hiddenAt = 0; }, RESUME_WATCHDOG_MS + 1000);
    });

    /*
     * 4) Page Lifecycle：Chrome 会把闲置标签页 freeze 掉，唤醒时派发 resume
     *    （不一定伴随 visibilitychange，尤其是「关闭浏览器再打开」的恢复路径）。
     */
    document.addEventListener('resume', () => {
        if (document.hidden) return;
        checkAfterResume('lifecycle-resume');
    });

    // 5) bfcache 恢复（手机端「返回」回来时常见）
    window.addEventListener('pageshow', (event) => {
        if (!event.persisted) return;
        checkAfterResume('pageshow-blank');
    });

    // 6) 首屏守护：9s 后仍空白，说明挂载链路挂住了
    window.setTimeout(() => {
        if (isAppBlank()) revivePage('boot-blank');
    }, 9000);

    /*
     * 7) v1.1.0：健康心跳 —— 页面稳定运行满 2 分钟就把「复活次数」清零。
     *    这样「一天里多次休眠」的场景不会被 3 次上限卡死，
     *    而真出故障（2 分钟内反复白屏）时仍然受滑窗限流保护。
     */
    window.setInterval(() => {
        if (document.hidden) return;
        const last = readNum(REVIVE_KEY);
        if (!last) return;
        if (Date.now() - last < HEALTHY_RESET_MS) return;
        if (isAppBlank()) return;
        writeNum(REVIVE_COUNT_KEY, 0);
        writeNum(REVIVE_WINDOW_KEY, Date.now());
    }, 30 * 1000);
}
