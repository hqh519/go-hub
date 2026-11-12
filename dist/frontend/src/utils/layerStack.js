/**
 * 统一浮层栈（v1.0.0）
 *
 * 解决的问题：
 *   灯箱（MediaPreviewOverlay）和 Element Plus 弹窗（文件详情页等）原先各自往历史里压
 *   自己的「哨兵」，两边都监听 popstate。一次返回会被两套逻辑同时消费 —— 结果灯箱和
 *   叠在它上面的详情页一起关掉。
 *
 * 现在的约定：
 *   · 每一层浮层在打开时 registerLayer(id, close)，关闭时 unregisterLayer(id)；
 *   · 移动端：**整个栈只压一条历史哨兵**。一次返回只调用栈顶那一层的 close()，
 *     关完若还有层就把哨兵补回去，保证下一次返回仍然是「关一层」而不是退出页面；
 *   · 桌面端：一个 keydown 捕获监听接管 Esc，同样只关栈顶一层，并阻止事件继续冒泡，
 *     避免 Element Plus 自己的 close-on-press-escape 再关一次。
 *
 * 栈顺序 = 注册顺序。后注册的在上面（灯箱先开、详情页后开 → 详情页在栈顶）。
 */

const MOBILE_MAX_WIDTH = 768

/**
 * 层列表：[{ id, close, esc, z, seq }]
 *   · seq = 注册序号（越大越晚打开）；
 *   · z   = 可选层级值（不传就 0），排序时先比 z 再比 seq ——
 *           Element Plus 弹窗的 z-index 是动态自增的，调用方拿得到就传进来，
 *           拿不到时「后打开的在上」这个默认口径与实际叠放顺序一致。
 */
const layers = []
/** 注册序号自增器 */
let seqCounter = 0

/** 历史里是否已经放了哨兵条目（移动端） */
let sentinel = false
/** 正在自己退哨兵，忽略随之而来的 popstate */
let selfPopping = false
/** 正在由本模块关闭某一层，用于忽略它内部再派发的 Esc */
let closing = false
/** 归还哨兵的延时句柄（见 schedulePopSentinel） */
let popTimer = null
let installed = false

/**
 * 是否需要接管「返回键」—— 统一按「触屏优先」判断。
 *
 * v1.0.4 修正：旧实现只看 `innerWidth <= 768`，而页面的「返回键回上一级目录」
 * 用的是 `matchMedia('(hover: none)')`。两套口径在三种设备上打架：
 *   · iPad（1024）、横屏手机（844）、折叠屏展开（884）—— 手里全是手指操作，
 *     浮层栈判定「桌面」→ 不压哨兵；页面判定「触屏」→ 接管返回键；
 *   · 结果就是「移动端没修好」：浮层开着按返回，灯箱不动、目录却退了一级，
 *     再按一次直接离开页面。
 * 现在与页面同口径：hover:none 一律算触屏，小屏触屏设备（触屏笔记本的平板模式）也算，
 * 桌面（有精确指针且屏宽）仍然只在按 Esc 时接管。
 */
export function isTouchLayout() {
    try {
        if (window.matchMedia && window.matchMedia('(hover: none)').matches) return true
        if (navigator.maxTouchPoints > 0 && window.innerWidth <= MOBILE_MAX_WIDTH) return true
        return window.innerWidth <= MOBILE_MAX_WIDTH
    } catch (e) {
        return false
    }
}

function pushSentinel() {
    if (sentinel || !isTouchLayout()) return
    try {
        window.history.pushState({ __gohubLayer: 1 }, '', window.location.href)
        sentinel = true
    } catch (e) {
        // 隐私模式 / 异常环境：退化为不做返回键接管
        sentinel = false
    }
}

function popSentinel() {
    if (!sentinel) return
    sentinel = false
    selfPopping = true
    /*
     * 页面自己也有 popstate 处理器（例如文件管理页的「返回上一级目录」）。
     * 这里退哨兵是程序触发的，必须打时间戳让页面在 500ms 内忽略掉这次 popstate，
     * 否则关掉浮层会顺带回上一级目录。沿用旧的全局键名，兼容既有判断。
     */
    try { window.__gohubMediaViewerPopAt = Date.now() } catch (e) { /* 忽略 */ }
    try {
        window.history.back()
    } catch (e) {
        selfPopping = false
    }
}

/**
 * 延时归还哨兵。
 * 「关掉一个浮层、紧接着又打开另一个」很常见（弹窗里点按钮换到另一个弹窗），
 * 如果一空栈就立刻 history.back()，会在两次打开之间多退一条历史，
 * 之后按返回就可能直接退出页面。这里给一个短延时窗口，窗口内又压了新层就作废。
 */
function schedulePopSentinel() {
    if (popTimer) window.clearTimeout(popTimer)
    popTimer = window.setTimeout(() => {
        popTimer = null
        if (!layers.length) popSentinel()
    }, 120)
}

function cancelPopSentinel() {
    if (!popTimer) return
    window.clearTimeout(popTimer)
    popTimer = null
}

/**
 * 按「层级从大到小」排好的层（栈顶在前）。
 *
 * v1.1.8（需求：closePageOrder）：用户要求关闭顺序按层级数值判断，而不是凭
 * 「谁先注册」。两条口径同时保留：
 *   ① 有 z-index 的按 z 排 —— Element Plus 每次打开弹窗都会自增 zIndex，最可靠；
 *   ② 都没报 z 的按注册顺序排（后打开的在上），这与灯箱/详情页的实际叠放完全一致。
 * 稳定排序：z 相同再比 seq，避免「同 z 的两层顺序随机」。
 */
function orderedLayers() {
    return layers
        .slice()
        .sort((a, b) => (b.z - a.z) || (b.seq - a.seq))
}

/** 当前最上面一层 */
function topLayer() {
    const list = orderedLayers()
    return list.length ? list[0] : null
}

/** 关掉栈顶一层；返回是否真的关掉了 */
function closeTop() {
    const top = topLayer()
    if (!top) return false
    closing = true
    try {
        top.close()
    } catch (e) {
        /* 单层关闭抛错不应影响栈本身 */
    }
    // 关闭动作通常是异步的（弹窗有动画），下一帧再放开重入保护
    window.setTimeout(() => { closing = false }, 0)
    return true
}

/**
 * 关闭「当前最上面的一层」—— 全站层叠页面的统一出口。
 *
 * v1.1.8 新增（需求原文：「创建一个 closePageOrder 函数，专门用来处理边缘滑动时
 * 关闭层叠页面顺序」）。任何页面都不必再自己判断「该关弹窗还是关灯箱」：
 *   · 移动端：边缘横滑（edgeSwipeGuard 判定为返回手势）→ 调一次，关一层；
 *   · 桌面端：Esc（本文件已经接管）→ 同样走这里。
 *
 * @param {{ silent?: boolean }} [opts] silent:true 时就算没有层也不回报（默认返回 false）
 * @returns {boolean} 是否真的关掉了一层
 */
export function closePageOrder(opts) {
    if (!layers.length) {
        if (!(opts && opts.silent)) closing = false
        return false
    }
    return closeTop()
}

/** 当前是否存在任何层叠页面（灯箱 / 弹窗 / 抽屉…） */
export function hasOpenLayer() {
    return layers.length > 0
}

function install() {
    if (installed || typeof window === 'undefined') return
    installed = true

    /* ── 移动端：返回键 / 边缘滑动返回 ───────────────────────── */
    window.addEventListener('popstate', () => {
        if (selfPopping) {
            selfPopping = false
            return
        }
        // 不是本模块压的哨兵被退（例如页面自己的目录历史）：不理会
        if (!sentinel) return
        sentinel = false
        if (!closeTop()) return
        /*
         * 告诉页面「这次返回已被浮层消费」：浮层关掉的瞬间 hasOpenFloatingLayer()
         * 就变 false 了，不打这个时间戳页面会把它当成自己的返回键，顺手回上一级目录。
         */
        try { window.__gohubBackGuardAt = Date.now() } catch (e) { /* 忽略 */ }
        // 关掉一层后若下面还有层，把哨兵补回来（多层逐层关闭）
        window.setTimeout(() => {
            if (layers.length) pushSentinel()
        }, 80)
    })

    /* ── 桌面端：Esc 只关最上面一层 ──────────────────────────── */
    document.addEventListener('keydown', (e) => {
        if (closing) return
        if (e.key !== 'Escape' && e.keyCode !== 27) return
        if (!layers.length) return
        const top = topLayer()
        if (!top) return
        /*
         * Element Plus 弹窗自己就吃 Esc（close-on-press-escape），而且它的处理更聪明：
         * 下拉框展开、输入法候选未结束时只收下拉不关弹窗。这类层标注 esc:false，
         * 交给组件原生处理，我们只在自定义层（灯箱等）上接管 Esc。
         */
        if (top.esc === false) return
        // 阻止组件自己的 Esc 处理再关一次下层
        e.preventDefault()
        e.stopPropagation()
        closeTop()
    }, true)

    /*
     * 布局切换时校正哨兵（v1.0.4）：
     *   · 桌面 → 触屏布局（平板转向、窗口拉窄、折叠屏合上）：如果已经有浮层开着，
     *     立刻补一条哨兵，否则接下来的返回键会直接退页面；
     *   · 触屏 → 桌面布局：把哨兵还回去，避免历史里留一条永远用不到的条目。
     */
    const syncSentinelByLayout = () => {
        if (!layers.length) return
        if (isTouchLayout()) pushSentinel()
        else if (sentinel) popSentinel()
    }
    window.addEventListener('resize', syncSentinelByLayout)
    window.addEventListener('orientationchange', syncSentinelByLayout)
}

/**
 * 注册一层浮层。
 * 重复注册同一个 id 时以最后一次为准（幂等，避免组件重复触发生成重复层）。
 *
 * @param {string} id     层标识
 * @param {Function} close 关闭该层的回调
 * @param {{ esc?: boolean }} [opts] esc:false 表示这层的 Esc 交给组件自己处理
 */
export function registerLayer(id, close, opts) {
    if (typeof window === 'undefined') return
    install()
    const i = layers.findIndex((l) => l.id === id)
    if (i >= 0) layers.splice(i, 1)
    layers.push({
        id,
        close,
        esc: !(opts && opts.esc === false),
        // v1.1.8：允许调用方上报层级（z-index），未上报时按注册顺序排
        z: Number(opts && opts.z) || 0,
        seq: ++seqCounter
    })
    // 新层压上来了：取消可能正在等待的「归还哨兵」
    cancelPopSentinel()
    pushSentinel()
}

/** 注销一层（组件自己关闭 / 卸载时调用） */
export function unregisterLayer(id) {
    const i = layers.findIndex((l) => l.id === id)
    if (i >= 0) layers.splice(i, 1)
    // 全部关完才归还哨兵，否则用户下次要按两下返回才有反应
    if (!layers.length) schedulePopSentinel()
}

/** 该层是否仍注册着 */
export function hasLayer(id) {
    return layers.some((l) => l.id === id)
}

/** 当前栈顶的 id（无层时返回空串） */
export function topLayerId() {
    const top = topLayer()
    return top ? top.id : ''
}

/** 当前层数 */
export function layerCount() {
    return layers.length
}
