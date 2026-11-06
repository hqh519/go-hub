<template>
  <el-config-provider :locale="elementLocale">
    <router-view/>
    <el-dialog
      v-model="adminAuthWarningVisible"
      :title="$t('adminAuthWarning.title')"
      :width="'min(480px, 90vw)'"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <el-alert
        :title="$t('adminAuthWarning.message')"
        type="warning"
        show-icon
        :closable="false"
        class="admin-auth-warning-message"
      />
      <template #footer>
        <el-button @click="openSecuritySettings">{{ $t('adminAuthWarning.configure') }}</el-button>
        <el-button type="primary" @click="$store.commit('dismissAdminAuthWarning')">{{ $t('adminAuthWarning.close') }}</el-button>
      </template>
    </el-dialog>
  </el-config-provider>
</template>

<script>
import { mapGetters } from 'vuex'
import { OverlayScrollbars } from 'overlayscrollbars'
import zhCnLocale from 'element-plus/es/locale/lang/zh-cn'
import enLocale from 'element-plus/es/locale/lang/en'

export default {
  data() {
    return {
      osInstance: null,
      imageViewerObserver: null
    }
  },
  computed: {
    adminAuthWarningVisible: {
      get() { return this.$store.state.adminAuthWarningVisible },
      set(value) { if (!value) this.$store.commit('dismissAdminAuthWarning') }
    },
    ...mapGetters(['userConfig', 'useDarkMode']),
    elementLocale() {
      return this.$i18n.locale === 'zh-CN' ? zhCnLocale : enLocale
    }
  },
  mounted() {
    // 初始化 OverlayScrollbars 悬浮滚动条
    this.$nextTick(() => {
      this.initOverlayScrollbars()
      this.setupImageViewerObserver()
    })
    this.setupPageActivation()
  },
  beforeUnmount() {
    // 清理 MutationObserver
    if (this.imageViewerObserver) {
      this.imageViewerObserver.disconnect()
    }
  },
  watch: {
  },
  methods: {
    /**
     * 页面「自动激活」（v202610221824）。
     *
     * 问题：浏览器标签页长时间挂着、或关掉再打开（含 bfcache 前进后退），
     * 页面回来时是「冻结」时的样子 —— 数据不刷新，偶发还是一片空白，只能手动刷新。
     * 解决：重新可见 / bfcache 恢复 / 窗口聚焦时，
     *   1) 重拉一次用户配置（主题、语言、公告等全局状态）；
     *   2) 派发 gohub:activate 事件，各页面按需重新加载自己的数据；
     *   3) bfcache 恢复时重建 OverlayScrollbars（实例会随页面冻结失效）。
     * 30 秒节流：只是切一下标签页不会造成接口风暴。
     */
    setupPageActivation() {
      let lastActive = 0
      const activate = (reason) => {
        if (document.hidden) return
        const now = Date.now()
        if (reason !== 'pageshow' && now - lastActive < 30 * 1000) return
        lastActive = now
        this.$store.dispatch('fetchUserConfig').catch(() => {})
        window.dispatchEvent(new CustomEvent('gohub:activate', { detail: { reason } }))
        if (reason === 'pageshow') {
          // bfcache 恢复：滚动条实例已失效，重建一次（触屏设备不启用 OS，跳过）
          try {
            const touchOnly = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
            if (!touchOnly && OverlayScrollbars.valid(document.body)) {
              this.osInstance = OverlayScrollbars(document.body)
            }
          } catch (e) {
            /* 忽略：滚动条重建失败不影响业务 */
          }
        }
      }
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) activate('visible')
      })
      window.addEventListener('pageshow', (e) => {
        if (e.persisted) activate('pageshow')
      })
      window.addEventListener('focus', () => activate('focus'))
    },
    openSecuritySettings() {
      this.$store.commit('dismissAdminAuthWarning')
      this.$router.push('/systemConfig#security')
    },
    initOverlayScrollbars() {
      try {
        /*
         * v20261027：触屏设备（手机 / 平板）不启用 OverlayScrollbars ——
         * 移动端浏览器滚动时自带系统级悬浮指示条，OS 再画一条就是「双滚动条」；
         * 且触屏上 OS 的悬浮条无法拖拽、收益为零。改为直接用原生滚动
         * （原生滚动条已由 global.css 全局隐藏，移动端只剩系统瞬时指示条，只有一条）。
         * 桌面端维持 OS 悬浮滚动条不变。
         */
        const touchOnly = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
        if (touchOnly) {
          console.log('OverlayScrollbars skipped on touch device (native scroll)')
          return
        }
        // 检查是否已经初始化
        if (OverlayScrollbars.valid(document.body)) {
          this.osInstance = OverlayScrollbars(document.body)
          return
        }

        // 应用到 body 实现全局悬浮滚动条
        this.osInstance = OverlayScrollbars(document.body, {
          scrollbars: {
            theme: 'os-theme-dark',
            visibility: 'auto',
            autoHide: 'scroll',
            autoHideDelay: 600,
            dragScroll: true,
            clickScroll: true
          },
          overflow: {
            x: 'hidden',
            y: 'scroll'
          }
        })
        console.log('OverlayScrollbars initialized successfully')
      } catch (error) {
        console.error('Failed to initialize OverlayScrollbars:', error)
      }
    },
    setupImageViewerObserver() {
      // 监听图片预览器的打开/关闭，动态控制 OverlayScrollbars
      this.imageViewerObserver = new MutationObserver((mutations) => {
        const imageViewer = document.querySelector('.el-image-viewer__wrapper')
        if (imageViewer) {
          // 图片预览器打开，禁用滚动
          if (this.osInstance) {
            this.osInstance.options({ overflow: { x: 'hidden', y: 'hidden' } })
          }
        } else {
          // 图片预览器关闭，恢复滚动
          if (this.osInstance) {
            this.osInstance.options({ overflow: { x: 'hidden', y: 'scroll' } })
          }
        }
      })
      
      this.imageViewerObserver.observe(document.body, {
        childList: true,
        subtree: true
      })
    }
  }
}
</script>

<style scoped>
.admin-auth-warning-message {
  text-align: left;
  border: 1px solid var(--el-color-warning-light-5);
  background-color: var(--el-color-warning-light-9);
  padding: 16px;
}
.admin-auth-warning-message :deep(.el-alert__title) {
  text-align: left;
  font-size: 15px;
  line-height: 1.7;
}
</style>
