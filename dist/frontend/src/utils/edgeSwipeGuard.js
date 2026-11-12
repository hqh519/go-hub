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
 *
 * v1.1.7：把「从边缘起手」放到最高优先级 —— 边缘 28px 是系统返回手势的专属区域，
 * 只要不是「本来就能横滚的容器」或「横滑就是它功能的控件（滑块 / 走马灯 / 标签条）」，
 * 一律吃掉。以前从边缘起手、又刚好落在输入框/开关上时会放行，于是那几下还是会退回上一页。
 *
 * v1.1.8：边缘横滑不再只是「吃掉」，它还承担「关闭层叠页面」的语义 ——
 * 判明确实是一次返回手势之后调 layerStack.closePageOrder()，按层级从大到小关掉一层
 * （灯箱上面还压着文件详情，就只关详情；再滑一次才关灯箱）。全站统一由这里驱动，
 * 页面 / 组件不需要各自监听 touch。
 */

import { closePageOrder, hasOpenLayer } from './layerStack'

/** 触发区宽度：从这条边缘带起手，位移门槛降到 MIN_DECIDE_PX */
const EDGE_PX = 28
/** 判定方向前的最小位移，避免手指微抖就下结论 */
const MIN_DECIDE_PX = 6
/** 非边缘起手的横滑门槛：位移要够大才算「用户真的在横滑」 */
const PAGE_DECIDE_PX = 24
/** 非边缘起手时，横向分量至少是纵向的多少倍才认定为横滑 */
const HORIZONTAL_RATIO = 1.5
/**
 * v1.1.8：判为「返回手势」并关掉一层浮层所需的朝内位移。
 * 与灯箱原来的 64px 取同一个值 —— 阈值太小，翻页 / 拖动缩略图时抬手就误关弹窗。
 */
const BACK_TRIGGER_PX = 64

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
 * 「横滑就是它本身的功能」的控件：滑块拖动、走马灯翻页、标签条横滚都属于这一类，
 * 即使起手位置落在屏幕边缘也必须放行，否则滑块从左边拖不动。
 */
const DRAG_CONTROL_SELECTOR = [
    '[role="slider"]',
    '.el-slider',
    '.el-carousel',
    '.el-tabs__nav-wrap',
    '.el-scrollbar__wrap',
    '.mv-thumbs',
    '.no-hswipe-guard',
].join(',')

/**
 * 只是「可能用到横滑」的控件：输入框选词、下拉、开关。
 * 页面中部的横滑放行；**从屏幕边缘起手的不放行** ——
 * 边缘那一条带是系统返回手势的专属区域，v1.1.7 起一律优先保护「不后退」。
 */
const SOFT_CONTROL_SELECTOR = [
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '.el-input',
    '.el-textarea',
    '.el-select',
    '.el-switch',
    '.el-checkbox',
    '.el-radio',
    '.el-date-editor',
    '.el-autocomplete',
].join(',')

/**
 * @param {Element} target 起手处元素
 * @param {boolean} fromEdge 是否从屏幕边缘起手
 */
function isControl(target, fromEdge) {
    if (!target || !target.closest) return false
    try {
        if (target.closest(DRAG_CONTROL_SELECTOR)) return true
        if (!fromEdge && target.closest(SOFT_CONTROL_SELECTOR)) return true
        return false
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
    /*
     * v1.1.8：这次手势是否算「返回手势」（从边缘起手 + 朝内横向滑动 + 已吃掉默认行为）。
     * 抬手时如果位移够了就关掉一层浮层；一次手势只关一层，不重复触发。
     */
    let backGesture = false
    let lastDx = 0

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
        backGesture = false
        lastDx = 0
        startX = t.clientX
        startY = t.clientY
        startTarget = e.target
        fromEdge = t.clientX <= EDGE_PX || t.clientX >= w - EDGE_PX
    }, { capture: true, passive: true })

    window.addEventListener('touchmove', (e) => {
        if (!active || !e.touches || e.touches.length !== 1) return

        if (decided) {
            if (blocking) {
                /*
                 * v1.1.8 修正：**每次移动都要更新位移**。
                 * 原来只在「下结论」那一帧记一次 lastDx（那时位移才 6~14px），
                 * 之后所有 touchmove 都在这里提前 return，抬手时 lastDx 还停在 14px，
                 * 永远够不到 BACK_TRIGGER_PX(64) —— 真实用户滑得再远也关不掉浮层。
                 */
                lastDx = e.touches[0].clientX - startX
                if (e.cancelable) e.preventDefault()
            }
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
        if (canScrollHorizontally(startTarget, dx) || isControl(startTarget, fromEdge)) {
            decided = true
            blocking = false
            return
        }

        decided = true
        blocking = true
        // v1.1.8：记录这是一次「返回手势」——抬手时按层叠顺序关一层
        backGesture = fromEdge
        lastDx = dx
        // 到这里说明是「横滑」：吃掉这次手势，浏览器不再执行返回 / 不再画伸缩动画
        if (e.cancelable) e.preventDefault()
    }, { capture: true, passive: false })

    const stop = () => {
        /*
         * v1.1.8：边缘横滑抬手 → 关掉最上面一层浮层（灯箱 / 详情页 / 弹窗…）。
         * 顺序由 layerStack.closePageOrder() 按层级决定，一次只关一层：
         * 灯箱上压着文件详情时先关详情，再滑一次才轮到灯箱。
         * 没有浮层时保持原样（什么都不做）—— 页面顶部已经由 overscroll 兜住，
         * 不能在这里自己 history.back()，否则会误退页面。
         */
        if (backGesture && hasOpenLayer() && Math.abs(lastDx) >= BACK_TRIGGER_PX) {
            closePageOrder()
        }
        active = false
        decided = false
        blocking = false
        backGesture = false
        lastDx = 0
    }
    window.addEventListener('touchend', stop, { capture: true, passive: true })
    window.addEventListener('touchcancel', stop, { capture: true, passive: true })

    /*
     * 双指缩放 / 多指手势一律不参与：touchstart 里 touches.length !== 1 已经把
     * active 置 false，这里不用额外处理（保留注释说明为什么不做双指判断）。
     */
}
