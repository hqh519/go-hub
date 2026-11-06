/**
 * 访问记录上报（v2.3.0）。
 *
 * 后台「访问记录」有两条采集路径，互不重叠：
 *   1) 站内 SPA 页面 —— 由这里在路由切换后上报，能拿到「停留时长」和「跳转链接」；
 *   2) 文件外链 /file/*、/random —— 前端拿不到这些请求，由后端中间件直接落库（main.ts）。
 *
 * 关键取舍：
 *   · 只上报「路径 + 标题 + 来路」，IP / UA / 设备信息全部由服务端从请求头取，
 *     前端传什么都不采信，避免被伪造刷库；
 *   · 停留时长用 sendBeacon 发（页面隐藏 / 路由切换时），因为此时普通 fetch
 *     很容易被浏览器在卸载过程中掐断；
 *   · 任何异常都吞掉 —— 访问统计是旁路功能，绝不能影响正常使用。
 */
import router from '@/router'

/** 当前这次访问：服务端返回的记录 id + 进入时间 */
let current = { id: '', at: 0, path: '' }
/** 上一条页面地址（用于 derive 来路） */
let lastReferer = ''

const API_VISIT = '/api/access/visit'
const API_STAY = '/api/access/stay'

/** 判断这个路径值不值得记录（与后端 shouldRecordPath 保持一致的口径） */
const IGNORED = /^\/(api|dav|s3|dev|assets|static|_nuxt|@vite|node_modules)(\/|$)/i
const STATIC_EXT = /\.(js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|mp4|webm|mp3|json|txt|xml|webmanifest)$/i

export function shouldTrack(path) {
  const p = String(path || '')
  if (!p || p === '/favicon.ico') return false
  if (IGNORED.test(p)) return false
  if (STATIC_EXT.test(p)) return false
  return true
}

/** 结束当前这次访问：回填停留时长（只回填一次） */
function flushStay() {
  const { id, at } = current
  if (!id || !at) return
  const stayMs = Math.max(0, Date.now() - at)
  // 立刻清空，避免同一次访问被重复回填
  current = { id: '', at: 0, path: '' }
  const payload = JSON.stringify({ id, stayMs })
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' })
      if (navigator.sendBeacon(API_STAY, blob)) return
    }
  } catch {
    /* 落到下面的 fetch */
  }
  try {
    fetch(API_STAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      credentials: 'include',
    }).catch(() => {})
  } catch {
    /* 忽略 */
  }
}

/** 上报一次页面访问 */
async function reportVisit(to) {
  const path = String(to?.path || '')
  if (!shouldTrack(path)) return
  const title = String(document.title || '').slice(0, 200)
  try {
    const res = await fetch(API_VISIT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ path, title, referer: lastReferer }),
    })
    if (!res.ok) return
    const data = await res.json().catch(() => null)
    const id = data?.data?.id || data?.id || ''
    current = { id, at: Date.now(), path }
  } catch {
    /* 忽略 */
  }
}

/**
 * 挂载访问上报。
 * 在 main.js 里（路由挂载之后）调用一次即可。
 */
export function setupAccessTracker() {
  router.afterEach((to, from) => {
    // 先结算上一页的停留时长，再上报新页面
    flushStay()
    // 来路取上一页地址：站外进入时用 document.referrer
    lastReferer = from?.fullPath
      ? window.location.origin + from.fullPath
      : String(document.referrer || '')
    // 等标题被页面改完再上报（很多页面在 mounted 里改 document.title）
    window.setTimeout(() => reportVisit(to), 600)
  })

  // 页面隐藏 / 卸载时结算停留时长
  const onHide = () => {
    if (document.visibilityState === 'hidden') flushStay()
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', flushStay)
}
