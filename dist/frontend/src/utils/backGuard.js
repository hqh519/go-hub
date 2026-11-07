/**
 * 弹窗逐层返回（v1.0.0 重写）
 *
 * 需求：
 *   · 移动端任何页面打开弹窗时，返回键 / 边缘滑动返回先关最上面那一层，没有浮层才真的返回；
 *   · 叠了多层（例：灯箱上再开文件详情页）时，一次只关一层，从上往下一层层关；
 *   · 桌面端按 Esc 同样只关最上面一层。
 *
 * 实现（v1.0.0 起不再自己压历史哨兵，统一交给 utils/layerStack.js）：
 *   1) 用 MutationObserver 盯 body 的直接子节点 —— Element Plus 的弹窗 / 抽屉 /
 *      消息框都会把自己的 `.el-overlay` 挂在 body 上；
 *   2) 每个可见的 `.el-overlay` 往浮层栈登记一层，close 回调 = 点它自己的关闭按钮
 *      （没有关闭按钮时派发一次 Esc 让组件按自身逻辑收场）；
 *   3) 浮层消失（DOM 移除 / 不可见）时注销那一层；
 *   4) 历史哨兵、popstate 消费、Esc 分层，全部由 layerStack 统一处理 ——
 *      这也是修「返回键把灯箱和详情页一起关掉」的关键：以前两边各压一条哨兵，
 *      一次返回被两套逻辑同时消费。
 */

import { isTouchLayout, registerLayer, unregisterLayer } from './layerStack'

/** body 下所有还显示着的 Element Plus 浮层（弹窗 / 抽屉 / MessageBox） */
function visibleOverlays() {
    const list = Array.from(document.querySelectorAll('.el-overlay'))
    return list.filter((el) => {
        if (!el || !el.isConnected) return false
        /*
         * v1.0.3：已经由组件自己显式登记过的浮层，这里**不再重复登记**。
         *
         * 以前「灯箱里打开文件详情」会有两层记录指向同一个弹窗：
         *   ① AdminDashBoard 在 watcher 里 registerLayer('file-detail', …)
         *   ② 本文件的 MutationObserver 又给它登记了一个 overlay:N
         * 栈就变成 [media-viewer, file-detail, overlay:N]，栈顶是 overlay:N ——
         * 移动端返回时走的是「点关闭按钮 / 派发 Esc」这条兜底路径（有时弹窗没有
         * 可点的关闭按钮，于是这次返回被白白消费掉），表现就是「有时能关、有时关不掉」。
         * 现在带 data-gohub-layer 标记的弹窗只由组件自己登记，栈顺序恒为
         * [灯箱, 详情页]，一次返回稳定关一层。
         */
        if (el.querySelector('[data-gohub-layer]')) return false
        const style = window.getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        // 关闭动画期间仍留在 DOM 里，用是否有渲染盒子兜底
        return el.getClientRects().length > 0
    })
}

/** 关掉指定浮层：优先点它自己的关闭按钮，其次发一次 ESC */
function closeOverlay(el) {
    if (!el || !el.isConnected) return
    const btn = el.querySelector(
        '.el-dialog__headerbtn, .el-message-box__headerbtn, .el-drawer__close-btn, .el-dialog__close'
    )
    if (btn) {
        btn.click()
        return
    }
    /*
     * 没有关闭按钮（如 :show-close="false"）：请 Element Plus 按 ESC 逻辑处理。
     * v1.0.3：事件必须派发到**弹窗元素本身**—— Element Plus 的 Esc 监听挂在
     * dialog / overlay 上，派发到 document 时事件不会向下传播，等于什么都没发生
     * （「按了返回没反应」的另一半原因）。这里先在弹窗内派发，再兜底到 document。
     */
    const target = el.querySelector('.el-dialog, .el-drawer, .el-message-box') || el
    const evt = new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true
    })
    target.dispatchEvent(evt)
}

let installed = false

export function setupBackGuard() {
    if (installed || typeof window === 'undefined') return
    installed = true

    /** el 元素 → 浮层栈里的 id */
    const tracked = new Map()
    let seq = 0

    const sync = () => {
        // 桌面端同样需要登记（Esc 分层要用），但哨兵只在移动端压，layerStack 内部判断
        const list = visibleOverlays()

        // 新出现的浮层：登记一层
        list.forEach((el) => {
            if (tracked.has(el)) return
            const id = `overlay:${++seq}`
            tracked.set(el, id)
            // esc:false —— Esc 交给 Element Plus 自己处理（它会先收下拉框再关弹窗）
            registerLayer(id, () => closeOverlay(el), { esc: false })
        })

        // 已经消失的浮层：注销
        Array.from(tracked.keys()).forEach((el) => {
            if (list.indexOf(el) !== -1) return
            const id = tracked.get(el)
            tracked.delete(el)
            unregisterLayer(id)
        })
    }

    // 浮层都是 append 到 body，只在 body 直接子节点增删时同步
    const observer = new MutationObserver(() => {
        // 让出本次 DOM 变更，避免读到动画中间态
        window.setTimeout(sync, 0)
    })
    observer.observe(document.body, { childList: true })

    // 首屏可能已经有弹窗（例如强制公告），补一次
    window.setTimeout(sync, 200)

    /*
     * 首屏可能已经有弹窗（例如强制公告）或已经是触屏布局：
     * 补登记一次，让返回键立刻可用（v1.0.4：判断口径与 layerStack 统一为 isTouchLayout）。
     */
    if (isTouchLayout()) window.setTimeout(sync, 400)
}
