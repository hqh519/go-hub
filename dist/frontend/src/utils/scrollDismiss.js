/**
 * 滚动收起浮层（v1.1.3）
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
 * 注意：监听用 capture=true，并且同时监听 window —— 后台的滚动容器不止一个
 * （window、内容区 .nt-main、列表自身都可能滚），冒泡阶段收不全。
 */

/** 让 Element Plus 认为「用户点了外部」，从而收起所有打开的 popper */
export function dismissElementPoppers() {
    if (typeof document === 'undefined') return;
    try {
        document.body.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window })
        );
    } catch (e) {
        /* 极老的浏览器没有 MouseEvent 构造器，直接放弃（下拉仍能靠点外部关闭） */
    }
}

/**
 * 绑定「滚动即收起」。
 *
 * @param {Function} onDismiss 收起动作（自己有关闭方法的组件传自己的关闭函数）
 * @returns {Function} 解绑函数 —— 一定要在浮层关闭 / 组件卸载时调用，否则监听会越积越多
 */
export function bindScrollDismiss(onDismiss) {
    if (typeof window === 'undefined') return () => {};
    let done = false;
    const handler = () => {
        if (done) return;
        done = true;
        // 先解绑再执行：收起动作本身可能触发一次滚动（例如 popper 关闭后的布局回流）
        unbind();
        if (typeof onDismiss === 'function') onDismiss();
        else dismissElementPoppers();
    };
    const unbind = () => {
        window.removeEventListener('scroll', handler, true);
        done = true;
    };
    window.addEventListener('scroll', handler, { capture: true, passive: true });
    return unbind;
}
