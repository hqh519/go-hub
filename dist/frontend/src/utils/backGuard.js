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

import { registerLayer, unregisterLayer } from './layerStack'

const MOBILE_MAX_WIDTH = 768

function isMobile() {
    try {
        return window.innerWidth <= MOBILE_MAX_WIDTH
    } catch (e) {
        return false
    }
}

/** body 下所有还显示着的 Element Plus 浮层（弹窗 / 抽屉 / MessageBox） */
function visibleOverlays() {
    const list = Array.from(document.querySelectorAll('.el-overlay'))
    return list.filter((el) => {
        if (!el || !el.isConnected) return false
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
    // 没有关闭按钮（如 :show-close="false"）：请 Element Plus 按 ESC 逻辑处理，
    // 组件显式关掉了 ESC（close-on-press-escape=false）时它不会响应，
    // 这种弹窗本身就是"必须处理完才能走"，返回键不生效是预期行为。
    const evt = new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true
    })
    document.dispatchEvent(evt)
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
     * 视口从桌面拉窄到移动端时补登记一遍哨兵；反之则归还。
     * 只在移动端布局下才需要，桌面端 layerStack 内部已跳过。
     */
    if (isMobile()) window.setTimeout(sync, 400)
}
