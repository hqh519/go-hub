/**
 * 全站横滑手势屏蔽（v1.0.0 起，v1.0.9 扩到整页）
 *
 * 现象：手指横滑时，浏览器/系统把这次手势当成「返回上一页」，并在屏幕边缘
 * 渲染一段拉动伸缩的预览动画。灯箱因为整层 touch-action 受限看不到；
 * 页面背景、上传操作区（尤其是首页「文件」模式那块大触区）就会露出来。
 *
 * 为什么不在页面 / 弹窗上一律写 touch-action: pan-y：
 *   touch-action 的可用手势是「元素自身与其所有祖先的交集」。
 *   一旦祖先写了 pan-y，内部横向滑动条即使声明 pan-x 也没用（交集为空），
 *   文件管理页顶部的按钮条、面包屑工具条、筛选弹窗的标签页都会滑不动。
 *
 * 所以统一在 JS 里拦：
 *   · 边缘起手（EDGE_PX 内）且横向占主导 → 直接吃掉，浏览器不再预览返回动作；
 *   · 非边缘起手 → 只有「明显是横滑」时才拦（位移 ≥ PAGE_DECIDE_PX 且横向分量
 *     至少是纵向的 1.5 倍），这样纵向滚动永远不会被误判 —— 这是 v1.0.9 的关键约束：
 *     上一次全站滚不动，就是横滑判定太宽松，把「略带横向抖动的纵向滚动」也吃了。
 *   · 起手处本身就能继续横向滚动（工具条 / 缩略图带），或者是表单控件
 *     （滑块 / 输入框 / 开关），一律放行。
 */

/** 触发区宽度：从这条边缘带起手，位移门槛降到 MIN_DECIDE_PX */
const EDGE_PX = 28
/** 判定方向前的最小位移，避免手指微抖就下结论 */
const MIN_DECIDE_PX = 6
/** 非边缘起手的横滑门槛：位移要够大才算「用户真的在横滑」 */
const PAGE_DECIDE_PX = 24
/** 非边缘起手时，横向分量至少是纵向的多少倍才认定为横滑 */
const HORIZONTAL_RATIO = 1.5

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

/**
 * 表单控件 / 自带横滑语义的组件：横滑是它们的功能，不能拦。
 * （滑块拖动、输入框选择文本、标签页横向滚动都属于这一类）
 */
const CONTROL_SELECTOR = [
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[role="slider"]',
    '.el-slider',
    '.el-input',
    '.el-textarea',
    '.el-select',
    '.el-switch',
    '.el-checkbox',
    '.el-radio',
    '.el-carousel',
    '.el-tabs__nav-wrap',
    '.el-scrollbar__wrap',
    '.mv-thumbs',
    '.no-hswipe-guard',
].join(',')

function isControl(target) {
    try {
        return !!(target && target.closest && target.closest(CONTROL_SELECTOR))
    } catch (e) {
        return false
    }
}

let installed = false

export function setupEdgeSwipeGuard() {
    if (installed || typeof window === 'undefined') return
    installed = true

    let active = false
    // 是否已经对这次手势下过结论（避免每帧重复判定）
    let decided = false
    // 结论：「吃掉这次手势」= true
    let blocking = false
    let startX = 0
    let startY = 0
    let fromEdge = false
    // 起手处元素：判定「能不能横向滚动 / 是不是控件」必须用它，不能用 touchmove 时的 e.target
    let startTarget = null

    window.addEventListener('touchstart', (e) => {
        if (!isMobile() || !e.touches || e.touches.length !== 1) {
            active = false
            blocking = false
            decided = false
            return
        }
        const t = e.touches[0]
        const w = window.innerWidth
        active = true
        decided = false
        blocking = false
        startX = t.clientX
        startY = t.clientY
        startTarget = e.target
        fromEdge = t.clientX <= EDGE_PX || t.clientX >= w - EDGE_PX
    }, { capture: true, passive: true })

    window.addEventListener('touchmove', (e) => {
        if (!active || !e.touches || e.touches.length !== 1) return

        if (decided) {
            if (blocking && e.cancelable) e.preventDefault()
            return
        }

        const t = e.touches[0]
        const dx = t.clientX - startX
        const dy = t.clientY - startY
        const adx = Math.abs(dx)
        const ady = Math.abs(dy)
        if (adx < MIN_DECIDE_PX && ady < MIN_DECIDE_PX) return

        // 纵向占主导 → 交给页面正常滚动，本次手势不再参与判定
        if (ady >= adx) {
            decided = true
            blocking = false
            return
        }

        // 横滑门槛：边缘起手放宽（返回手势本来就是从边缘开始），页面中部要更明确
        if (adx < (fromEdge ? MIN_DECIDE_PX : PAGE_DECIDE_PX)) return
        // 中部起手且「斜着滑」→ 按滚动处理，不拦（防止把纵向滚动吃掉）
        if (!fromEdge && adx < ady * HORIZONTAL_RATIO) {
            decided = true
            blocking = false
            return
        }

        // 起手处本来就能横向滚动（工具条 / 标签页 / 缩略图带）：放行
        if (canScrollHorizontally(startTarget, dx) || isControl(startTarget)) {
            decided = true
            blocking = false
            return
        }

        decided = true
        blocking = true
        // 到这里说明是「横滑」：吃掉这次手势，浏览器不再执行返回 / 不再画伸缩动画
        if (e.cancelable) e.preventDefault()
    }, { capture: true, passive: false })

    const stop = () => {
        active = false
        decided = false
        blocking = false
    }
    window.addEventListener('touchend', stop, { capture: true, passive: true })
    window.addEventListener('touchcancel', stop, { capture: true, passive: true })

    /*
     * 双指缩放 / 多指手势一律不参与：touchstart 里 touches.length !== 1 已经把
     * active 置 false，这里不用额外处理（保留注释说明为什么不做双指判断）。
     */
}
