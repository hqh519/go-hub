/**
 * 滚动收起浮层（v1.1.3 首发，v1.1.4 增强）
 * ----------------------------------------------------------------------------
 * 需求：移动端后台的几类下拉页（类型选择、排序、右上角更多菜单、左上角页面切换、
 * 目录路径选择…）在用户滚动页面时要自动隐藏。
 *
 * 为什么不是每个组件自己写一遍：
 *   这些都是 Element Plus 的 popper（el-select / el-dropdown），它们的开关状态
 *   由组件内部管理，对外只暴露 visible-change。外层能做的只有两件事：
 *     1) 滚动时把「打开」这件事收回去；
 *     2) 对于不给自己提供 close 方法的（el-select 就是），模拟一次「点击外部」——
 *        Element Plus 的 ClickOutside 指令监听的是 document 上的 mousedown，
 *        在 body 上派发一次就能让 popper 收起，效果与用户点空白处一致。
 *
 * v1.1.4 改了什么（用户反馈「滚动页面下拉页不收起」）：
 *   ① 只监听 `scroll` 在 iOS / Safari 上是不够的 —— 手指拖动期间 `scroll` 事件
 *     不会派发，要等惯性滚动停下来才补发一次，表现为「下拉页一直挂着，松手才消失」。
 *     所以补上 `touchmove`（纵向位移 ≥ 6px 才算真在滚页面）与 `wheel`。
 *   ② 手指落在下拉页**自己**里面的滑动（长列表滚动到底、点选条目时的手抖）不能算数，
 *     否则用户根本没法在下拉页里挑选项；用 `.el-popper` 祖先判定排除掉。
 *   ③ 刚展开的 60ms 内不响应 —— Element Plus 打开 popper 时会做一次定位 / 内部
 *     scrollIntoView，个别浏览器会连带触发页面级 scroll，不加这层保护会「开了就关」。
 *
 * 监听用 capture=true，并且同时监听 window —— 后台的滚动容器不止一个
 * （window、内容区 .nt-main、列表自身都可能滚），冒泡阶段收不全。
 */

/** 下拉页自身的容器（手指/滚轮落在这些里面时不收起） */
const POPPER_SELECTOR = '.el-popper, .el-select-dropdown, .el-dropdown__popper, .el-picker-panel, .el-cascader__dropdown';

/** 手指纵向上滑多少像素才算「在滚页面」而不是手抖 */
const TOUCH_SLOP = 6;

/** 展开后多久内不响应（毫秒），避开 Element Plus 自己的定位 / scrollIntoView */
const OPEN_GUARD_MS = 60;

function isInsidePopper(target) {
    const el = target && target.nodeType === 3 ? target.parentElement : target;
    if (!el || typeof el.closest !== 'function') return false;
    try {
        return !!el.closest(POPPER_SELECTOR);
    } catch (e) {
        return false;
    }
}

/** 让 Element Plus 认为「用户点了外部」，从而收起所有打开的 popper */
export function dismissElementPoppers() {
    if (typeof document === 'undefined') return;
    /*
     * v1.1.4：Element Plus 2.4+ 的点击外部判定已经从 mousedown 换成 pointerdown
     * （内部用 @vueuse/core 的 onClickOutside），只派发 mousedown 在新版本上完全不生效 ——
     * 实测「类型 / 排序」下拉滚动后不收起就是栽在这里。
     * 两个都派发：老版本认 mousedown，新版本认 pointerdown，互不影响。
     */
    const fire = (name, Ctor) => {
        try {
            document.body.dispatchEvent(new Ctor(name, { bubbles: true, cancelable: true, view: window }));
        } catch (e) {
            /* 浏览器不支持该构造器就跳过 */
        }
    };
    if (typeof window.PointerEvent === 'function') fire('pointerdown', window.PointerEvent);
    fire('mousedown', window.MouseEvent);
}

/**
 * 绑定「滚动即收起」。
 *
 * @param {Function} onDismiss 收起动作（自己有关闭方法的组件传自己的关闭函数）
 * @returns {Function} 解绑函数 —— 一定要在浮层关闭 / 组件卸载时调用，否则监听会越积越多
 */
export function bindScrollDismiss(onDismiss) {
    if (typeof window === 'undefined') return () => {};
    const openedAt = Date.now();
    let done = false;
    let touchStartY = null;

    const fire = () => {
        if (done) return;
        if (Date.now() - openedAt < OPEN_GUARD_MS) return;
        done = true;
        // 先解绑再执行：收起动作本身可能触发一次滚动（例如 popper 关闭后的布局回流）
        unbind();
        if (typeof onDismiss === 'function') onDismiss();
        else dismissElementPoppers();
    };

    // ① 滚动（桌面端滚轮滚动、安卓、以及 iOS 惯性结束后补发的那一次）
    const onScroll = (e) => {
        if (isInsidePopper(e.target)) return;
        fire();
    };

    // ② 手指拖动（iOS 惯性期间不派发 scroll，靠这个及时收起）
    const onTouchStart = (e) => {
        const t = e.touches && e.touches[0];
        touchStartY = t ? t.clientY : null;
    };
    const onTouchMove = (e) => {
        if (touchStartY == null) return;
        if (isInsidePopper(e.target)) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        if (Math.abs(t.clientY - touchStartY) < TOUCH_SLOP) return;
        touchStartY = null;
        fire();
    };

    // ③ 桌面端鼠标滚轮（部分嵌套滚动容器不冒泡到 window，capture 才收得到）
    const onWheel = (e) => {
        if (isInsidePopper(e.target)) return;
        fire();
    };

    // 重复调用是安全的（removeEventListener 对不存在的监听无副作用）
    const unbind = () => {
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('touchstart', onTouchStart, true);
        window.removeEventListener('touchmove', onTouchMove, true);
        window.removeEventListener('wheel', onWheel, true);
        touchStartY = null;
        done = true;
    };

    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    // touchmove 必须是 non-passive 之外也无所谓 —— 我们只读不阻止默认行为
    window.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return unbind;
}
