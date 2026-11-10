import { createRouter, createWebHistory } from 'vue-router'
import { h, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import store from '../store'
import axios from '@/utils/axios'
import i18n from '@/locales'
import { OverlayScrollbars } from 'overlayscrollbars'

/**
 * 两步验证门禁（v202610221824，v2.3.0 扩展；v2.6.0 改造）。
 *
 * 触发时机：账户启用了 2FA，但本次会话尚未验证、或「后端会话有效期」已过。
 * 此时登录态仍然有效（前端页可正常用），只是进后台需要补一次验证。
 *
 * v2.6.0 变化：
 *   · 输入框不做任何字符 / 长度限制（后台匹对验证，输入什么就送什么）；
 *   · 弹窗内新增「邮箱验证」按钮 —— 点击发 6 位字母数字验证码到账户邮箱，
 *     并提示「已发送验证码，请前往 abc***@126.com 邮箱查看」；
 *   · 点取消 → 直接回前端首页（移动端返回键关闭时例外：只终止导航不跳转）；
 */
const promptTotp = async () => {
  // 「邮箱验证」按钮的发送状态（VNode 闭包内读写）
  const sending = ref(false)
  const sendEmailCode = async () => {
    if (sending.value) return
    sending.value = true
    try {
      const res = await axios.post('/api/auth/email/send', {}, { withCredentials: true })
      if (res.data?.success) {
        const email = res.data?.data?.email || ''
        ElMessage.success(
          email
            ? i18n.global.t('login.emailCodeSentTo', { email })
            : (res.data.message || i18n.global.t('login.emailCodeSent')),
        )
      } else {
        ElMessage.error(res.data?.message || i18n.global.t('login.emailCodeSentFailed'))
      }
    } catch (e) {
      ElMessage.error(e?.response?.data?.message || i18n.global.t('login.emailCodeSentFailed'))
    } finally {
      sending.value = false
    }
  }
  // 提示文案 + 内嵌「邮箱验证」按钮（ElMessageBox.message 支持 VNode）
  const messageVNode = () =>
    h('div', { class: 'totp-prompt-box' }, [
      h('p', { style: 'margin:0 0 10px;line-height:1.6;' }, i18n.global.t('login.totpPrompt')),
      h(
        'button',
        {
          type: 'button',
          class: 'totp-email-btn',
          disabled: sending.value,
          onClick: sendEmailCode,
        },
        sending.value ? i18n.global.t('login.emailCodeSending') : i18n.global.t('login.emailCodeBtn'),
      ),
    ])

  // 最多 5 次机会：每次输错都重新弹框，不打断登录态
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let value = ''
    try {
      const res = await ElMessageBox.prompt(
        messageVNode(),
        i18n.global.t('login.totpTitle'),
        {
          confirmButtonText: i18n.global.t('common.confirm'),
          cancelButtonText: i18n.global.t('common.cancel'),
          // v2.6.0：不做字符 / 数量限制 —— 后台匹对验证
          inputPlaceholder: i18n.global.t('login.totpPlaceholder'),
          closeOnClickModal: false,
        },
      )
      value = res.value
    } catch (e) {
      // 取消 / 关闭弹窗：交给调用方决定「回首页」
      return { ok: false, canceled: true }
    }
    if (!String(value || '').trim()) {
      ElMessage.warning(i18n.global.t('login.totpEmpty'))
      continue
    }
    try {
      await axios.post('/api/auth/totp/verify', { code: value }, { withCredentials: true })
      sessionProbeCache.at = 0
      sessionProbeCache.data = null
      return { ok: true, canceled: false }
    } catch (e) {
      // 关键：这里不清会话、不跳登录页，只提示 + 重新弹框
      const msg = e?.response?.data?.message || i18n.global.t('login.totpInvalid')
      ElMessage.error(msg)
    }
  }
  return { ok: false, canceled: false }
}

/**
 * 2FA 结果落地到导航：
 *   通过       → 放行
 *   取消       → 直接回前端首页（v2.6.0）
 *   多次输错   → 停在当前页，登录态保留
 *
 * v2.6.0（#300）：移动端「返回键关弹窗」时不回首页 ——
 * 返回键关闭（backGuard 打标记，500ms 内）只终止本次导航（next(false)），
 * 不能同时关弹窗又执行页面回退/重定向。
 */
const settleTotp = (result, to, from, next) => {
  if (result.ok) return next()
  if (!result.canceled) return next(false)
  let backClosed = false
  try {
    const at = window.__gohubBackGuardAt || 0
    backClosed = at > 0 && Date.now() - at < 500
  } catch (e) {
    backClosed = false
  }
  if (backClosed) return next(false)
  // 用户主动点取消：回前端首页
  return next({ path: '/' })
}

/** 若需要 2FA，则弹框；返回 { ok, canceled } */
const ensureTotp = async (data) => {
  if (!data?.valid || !data?.totpRequired) return { ok: true, canceled: false }
  return promptTotp()
}

/** 守卫里统一的收口：既要 2FA 结果，也要正确的重定向语义 */
const guardWithTotp = (data, to, from, next) => {
  ensureTotp(data).then(result => settleTotp(result, to, from, next))
}

/**
 * 统一的会话探测（所有守卫共用）：
 * - 短 TTL 缓存：30 秒内的重复导航不再等待网络往返，切换分类瞬时完成；
 * - 8 秒超时：后端瞬时繁忙时不再长时间挂起（表现为「点击切换没反应」）；
 * - 请求失败时回退最近一次缓存，避免偶发网络抖动把已登录用户踢回登录页。
 */
const SESSION_TTL = 30 * 1000
const sessionProbeCache = { at: 0, data: null }

/** 本地已知会话（登录后由 setSession 写入 vuex，并持久化到 localStorage） */
const knownSession = () => {
  const role = store.state.sessionRole
  if (!role) return null
  return { role, username: store.state.sessionUser || '' }
}

const probeSession = async () => {
  if (sessionProbeCache.data && Date.now() - sessionProbeCache.at < SESSION_TTL) {
    return { data: sessionProbeCache.data }
  }
  try {
    const res = await axios.get('/api/auth/sessionCheck', { withCredentials: true, timeout: 8000 })
    sessionProbeCache.at = Date.now()
    sessionProbeCache.data = res.data || {}
    return res
  } catch (e) {
    if (sessionProbeCache.data) return { data: sessionProbeCache.data }
    throw e
  }
}

/**
 * 后台静默刷新会话（不阻塞导航）。
 * 本地已有角色时直接用本地角色放行，同时异步跟服务端核对一次：
 * 只有「服务端明确说未登录且确实要求登录」时才把用户送回登录页。
 * 这样即便后端瞬时繁忙 / 网络抖动，点击分类切换也一定会立刻生效。
 */
let sessionRefreshing = false
const refreshSessionSilently = () => {
  if (sessionRefreshing) return
  sessionRefreshing = true
  axios
    .get('/api/auth/sessionCheck', { withCredentials: true, timeout: 8000 })
    .then((res) => {
      const data = res.data || {}
      sessionProbeCache.at = Date.now()
      sessionProbeCache.data = data
      const info = applySession(data)
      const required = info.adminRequired || info.userRequired
      if (!info.valid && required) {
        store.commit('clearSession')
        ElMessage.error(i18n.global.t('login.authRequired'))
        router.replace({ name: 'login' }).catch(() => {})
      }
    })
    .catch(() => {
      /* 网络异常时保持本地会话，不打扰用户 */
    })
    .finally(() => {
      sessionRefreshing = false
    })
}

/** 把 sessionCheck 的返回写入 vuex，返回归一化后的会话信息 */
function applySession(data) {
  const info = {
    role: data.role || null,
    username: data.username || null,
    isSuper: data.role === 'super',
    isAdmin: data.role === 'admin' || data.role === 'super',
    canEdit: data.canEdit !== false,
    canDelete: data.canDelete !== false,
    valid: !!data.valid,
    adminRequired: !!data.adminRequired,
    userRequired: !!data.userRequired,
    // 当前用户头像（前端左上角 logo 优先用它）
    avatarUrl: data.profile?.avatarUrl || '',
    totpRequired: !!data.totpRequired,
  }
  store.commit('setSession', info)
  return info
}

/**
 * 普通页面守卫：配置了账户（userRequired）时必须登录；
 * 未配置任何账户时保持免登录（保留「清空密码 = 免登录」的能力）。
 */
const userAuthGuard = (to, from, next) => {
  // 本地已有会话：直接放行，后台再跟服务端核对（不阻塞页面切换）
  if (knownSession()) {
    refreshSessionSilently()
    return next()
  }
  probeSession().then(res => {
    const data = res.data || {}
    const info = applySession(data)

    if (!info.userRequired || info.valid) return next()

    if (to.name !== 'login') {
      if (store.state.userLoggedIn) ElMessage.error(i18n.global.t('login.authRequired'))
      next({ name: 'login' })
    } else {
      next()
    }
  }).catch(() => {
    if (to.name !== 'login') {
      if (store.state.userLoggedIn) ElMessage.error(i18n.global.t('login.authRequired'))
      next({ name: 'login' })
    } else {
      next()
    }
  })
}

/**
 * 文件管理 / 历史记录守卫：管理员与普通用户都可进入，
 * 具体可见范围由后端按账户隔离（普通用户只看自身文件）。
 */
const manageAuthGuard = (to, from, next) => {
  const known = knownSession()
  if (known) {
    refreshSessionSilently()
    return next()
  }
  probeSession().then(res => {
    const data = res.data || {}
    const info = applySession(data)

    if (info.valid) {
      // 后台页需要 2FA：先补验证码，通过后再放行
      guardWithTotp(data, to, from, next)
      return
    }

    if (to.name !== 'login') {
      if (store.state.userLoggedIn) ElMessage.error(i18n.global.t('login.authRequired'))
      next({ name: 'login' })
    } else {
      next()
    }
  }).catch(() => {
    if (to.name !== 'login') next({ name: 'login' })
    else next()
  })
}

/**
 * 管理员守卫：仅 admin / super 可进（系统管理 / 用户管理 / 网页设置）。
 * 普通用户已登录时会被送回文件管理页并提示无权限；
 * 超级管理员（仅用于找回管理员账户）会被送到专用的超级管理员页。
 */
const adminAuthGuard = (to, from, next) => {
  const known = knownSession()
  if (known) {
    refreshSessionSilently()
    if (known.role === 'super') return next({ name: 'superAdmin' })
    if (known.role === 'admin') return next()
    ElMessage.error(i18n.global.t('login.adminRequired'))
    return next({ name: 'dashboard' })
  }
  probeSession().then(res => {
    const data = res.data || {}
    const info = applySession(data)

    if (info.role === 'super') return next({ name: 'superAdmin' })
    if (info.role === 'admin') {
      guardWithTotp(data, to, from, next)
      return
    }

    if (info.valid) {
      ElMessage.error(i18n.global.t('login.adminRequired'))
      return next({ name: 'dashboard' })
    }

    if (store.state.userLoggedIn) ElMessage.error(i18n.global.t('login.authRequired'))
    next({ name: 'login' })
  }).catch(() => {
    next({ name: 'login' })
  })
}

/** 超级管理员守卫：仅 super 可进（管理员账户找回） */
const superAuthGuard = (to, from, next) => {
  const known = knownSession()
  if (known) {
    refreshSessionSilently()
    if (known.role === 'super') return next()
    return next({ name: 'dashboard' })
  }
  probeSession().then(res => {
    const data = res.data || {}
    const info = applySession(data)
    if (info.role === 'super') return next()
    if (info.valid) return next({ name: 'dashboard' })
    next({ name: 'login' })
  }).catch(() => {
    next({ name: 'login' })
  })
}

/**
 * 用户管理守卫：管理员与普通用户都可进入。
 * 普通用户进页后只显示「自己这一条账户」并允许改密码 ——
 * 其余功能（创建用户 / 权限开关 / 主备渠道 / 归集统计 / 删除）由页面按角色隐藏，
 * 后端接口同样按角色做二次校验（页面隐藏只是体验，后端才是真正的权限边界）。
 */
const userManageGuard = (to, from, next) => {
  const known = knownSession()
  if (known) {
    refreshSessionSilently()
    if (known.role === 'super') return next({ name: 'superAdmin' })
    return next()
  }
  probeSession().then(res => {
    const data = res.data || {}
    const info = applySession(data)

    // 超级管理员专用页优先
    if (info.role === 'super') return next({ name: 'superAdmin' })
    if (info.valid) {
      guardWithTotp(data, to, from, next)
      return
    }

    if (store.state.userLoggedIn) ElMessage.error(i18n.global.t('login.authRequired'))
    next({ name: 'login' })
  }).catch(() => {
    next({ name: 'login' })
  })
}

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/UploadHome.vue'),
    beforeEnter: userAuthGuard
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/Login.vue')
  },
  {
    // v2.6.0：忘记密码的邮件重置页（公开访问；token 一次性、10 分钟有效）
    path: '/reset-password',
    name: 'resetPassword',
    component: () => import('../views/ResetPassword.vue')
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('../views/AdminDashBoard.vue'),
    beforeEnter: manageAuthGuard
  },
  {
    path: '/customerConfig',
    name: 'customerConfig',
    component: () => import('../views/CustomerConfig.vue'),
    beforeEnter: userManageGuard
  },
  {
    // 用户编辑独立页（v202610221824）：从「用户管理 → 编辑」跳转，
    // 承载头像裁剪 / 邮箱 / 两步验证 / 会话有效期 / 渠道授权 / 用户公告等设置项。
    path: '/customerConfig/edit/:id',
    name: 'userEdit',
    component: () => import('../views/UserEditPage.vue'),
    beforeEnter: userManageGuard
  },
  {
    path: '/systemConfig',
    name: 'systemConfig',
    component: () => import('../views/SystemConfig.vue'),
    beforeEnter: adminAuthGuard
  },
  {
    path: '/manage/history',
    name: 'history',
    component: () => import('../views/HistoryPage.vue'),
    beforeEnter: manageAuthGuard
  },
  {
    // v1.1.1：笔记管理（「瞬间」便签式笔记）。
    // 守卫沿用后台页（manageAuthGuard）—— 管理员与普通用户都能进，
    // 普通用户只看/改自己的瞬间，管理员在实例内看全部；实例隔离由后端按 instanceId 兜底。
    path: '/notes',
    name: 'notes',
    component: () => import('../views/NotesManagePage.vue'),
    beforeEnter: manageAuthGuard
  },
  {
    // v1.1.2：文件引用明细页（文件详情 →「文件引用」→ 查看，新标签页打开）。
    // 只读页，登录即可访问；具体文件能不能看由后端按上传者 / 管理员判定。
    path: '/file-refs',
    name: 'fileRefs',
    component: () => import('../views/FileRefsPage.vue'),
    beforeEnter: manageAuthGuard
  },
  {
    // 访问记录管理（v2.3.0）：系统状态页的「访问记录」块与「访问次数」统计块
    // 都以新标签打开本页；仅管理员可进。
    path: '/manage/access',
    name: 'accessLog',
    component: () => import('../views/AccessLogPage.vue'),
    beforeEnter: adminAuthGuard
  },
  {
    path: '/superAdmin',
    name: 'superAdmin',
    component: () => import('../views/SuperAdmin.vue'),
    beforeEnter: superAuthGuard
  },
  {
    path: '/docs',
    name: 'docs',
    component: () => import('../views/DocsPage.vue')
  },
  // v2.8.0：/changelog 版本修改日志页已移除 —— 日志改为 md 文件随仓库 docs/ 目录分发，
  // 系统状态页「系统版本」直接跳转 GitHub Releases。
  // 旧入口兼容：统一账户体系下只有一个登录页
  {
    path: '/adminLogin',
    name: 'adminLogin',
    redirect: { name: 'login' },
  },
  {
    path: '/blockimg',
    name: 'blockimg',
    component: () => import('../views/BlockImage.vue'),
  },
  {
    path: '/whiteliston',
    name: 'whiteliston',
    component: () => import('../views/WhiteListOn.vue'),
  },
  {
    /*
     * v3.0.0：本地文件（只读浏览 + 一键上传到图床）。
     * 守卫沿用后台页（userManageGuard）—— 管理员与普通用户都能进，
     * 具体能看到哪些「本地文件」渠道由后端按渠道授权名单隔离。
     */
    path: '/localFiles',
    name: 'localFiles',
    component: () => import('../views/LocalFilesPage.vue'),
    beforeEnter: userManageGuard
  },
  {
    // v3.0.0：分享记录页 —— 系统设置「访客图库」与用户编辑页「对外分享」都以新标签打开本页。
    // 必须放在 /browse/:dir* 之前，否则会被通配路由吞掉。
    // 守卫沿用其它后台页（userManageGuard）：管理员与普通用户都可进，可见范围由后端按角色隔离。
    path: '/share-records',
    name: 'shareRecords',
    component: () => import('../views/ShareRecordsPage.vue'),
    beforeEnter: userManageGuard
  },
  {
    path: '/browse/:dir*',
    name: 'publicBrowse',
    component: () => import('../views/PublicBrowse.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'notFound',
    component: () => import('../views/NotFound.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (!['dashboard', 'customerConfig', 'systemConfig'].includes(to.name)) return false
    if (to.path === from.path && (to.name !== 'systemConfig' || to.hash === from.hash)) return false

    const position = { ...(savedPosition || { left: 0, top: 0 }), behavior: 'instant' }
    const scroller = OverlayScrollbars(document.body)?.elements().scrollOffsetElement
    if (scroller && scroller !== document.scrollingElement) {
      scroller.scrollTo(position)
      return false
    }
    return position
  }
})

/*
 * v3.0.0：路由懒加载 chunk 拉取失败（部署更新后旧标签页仍持有旧哈希文件名，
 * 或长时间闲置后被浏览器回收、恢复瞬间网络未就绪）时，整页重新加载一次。
 * 只在确认是「chunk 加载失败」时触发，其它导航错误保持原样抛出。
 */
router.onError((error) => {
  const message = String((error && error.message) || error || '')
  const isChunkError =
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Importing a module script failed/i.test(message)
  if (!isChunkError) return
  try {
    // eslint-disable-next-line no-console
    console.warn('[router] 懒加载资源失效，正在重新加载页面：' + message)
    window.location.reload()
  } catch (e) { /* 忽略 */ }
})

export default router
