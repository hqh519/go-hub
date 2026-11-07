/**
 * 移动端边缘横滑屏蔽（v1.0.0）
 *
 * 现象：手指从屏幕左右边缘起手横滑时，WebKit / Chromium 会把它当成「返回上一页」手势，
 * 并在屏幕边缘渲染一段伸缩拉动动画。图片 / 视频灯箱因为整层是 touch-action:pan-y，
 * 浏览器不会启动这个手势，所以看不到动画；页面背景和一些弹窗没有这层限制，就会露出来。
 *
 * 为什么不在页面 / 弹窗上也直接写 touch-action:pan-y：
 *   touch-action 的可用手势是「元素自身与其所有祖先的交集」。
 *   一旦祖先写了 pan-y，内部横向滑动条即使声明 pan-x 也没用（交集为空），
 *   文件管理页顶部的按钮条、面包屑工具条、筛选弹窗的标签页都会滑不动。
 *
 * 所以这里只在「手势起点落在屏幕边缘 EDGE_PX 内」且「横向位移占主导」时
 * preventDefault，让浏览器放弃这次返回手势预览；纵向滚动与页面内横向滚动条不受影响。
 * 起手处如果本身是一个还能继续横向滚动的容器，直接放行。
 */

/** 触发区宽度：只有从这条边缘带起手才算「边缘手势」 */
const EDGE_PX = 16
/** 判定方向前的最小位移，避免手指微抖就下结论 */
const DECIDE_PX = 6

/**
 * v1.0.4：与 layerStack / 页面导航统一「触屏优先」口径。
 * 旧实现只看 innerWidth <= 768，于是 iPad、横屏手机、折叠屏展开时
 * 边缘横滑不会被拦，浏览器直接执行返回 —— 灯箱还开着，页面却退了。
 */
function isMobile() {
    try {
        if (window.matchMedia && window.matchMedia('(hover: none)').matches) return true
        if (navigator.maxTouchPoints > 0 && window.innerWidth <= 768) return true
        return window.innerWidth <= 768
    } catch (e) {
        return false
    }
}

/**
 * 起点元素是否处在一个「还能朝该方向继续横向滚动」的容器里。
 * dir > 0：手指向右滑（内容需要还能向左滚才有意义）
 */
function canScrollHorizontally(target, dir) {
    let el = target
    while (el && el !== document.body && el.nodeType === 1) {
        const style = window.getComputedStyle(el)
        const ox = style.overflowX
        if ((ox === 'auto' || ox === 'scroll')) {
            const max = el.scrollWidth - el.clientWidth
            if (max > 1) {
                if (dir > 0 ? el.scrollLeft > 0 : el.scrollLeft < max) return true
            }
        }
        el = el.parentElement
    }
    return false
}

let installed = false

export function setupEdgeSwipeGuard() {
    if (installed || typeof window === 'undefined') return
    installed = true

    let active = false
    let decided = false
    let startX = 0
    let startY = 0

    window.addEventListener('touchstart', (e) => {
        if (!isMobile() || !e.touches || e.touches.length !== 1) {
            active = false
            return
        }
        const t = e.touches[0]
        const w = window.innerWidth
        active = t.clientX <= EDGE_PX || t.clientX >= w - EDGE_PX
        startX = t.clientX
        startY = t.clientY
        decided = false
    }, { capture: true, passive: true })

    window.addEventListener('touchmove', (e) => {
        if (!active || !e.touches || e.touches.length !== 1) return
        const t = e.touches[0]
        const dx = t.clientX - startX
        const dy = t.clientY - startY
        if (!decided) {
            if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return
            decided = true
            // 纵向手势：交给页面正常滚动
            if (Math.abs(dy) >= Math.abs(dx)) {
                active = false
                return
            }
            // 起手处本来就能横向滚动（工具条 / 标签页）：放行
            if (canScrollHorizontally(e.target, dx)) {
                active = false
                return
            }
        }
        // 到这里说明是「边缘起手的横滑」：吃掉这次手势，浏览器不再预览返回动作
        if (e.cancelable) e.preventDefault()
    }, { capture: true, passive: false })

    const stop = () => {
        active = false
        decided = false
    }
    window.addEventListener('touchend', stop, { capture: true, passive: true })
    window.addEventListener('touchcancel', stop, { capture: true, passive: true })
}
