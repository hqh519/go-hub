/**
 * 页面自动激活 mixin（v202610221824）。
 *
 * App.vue 在「标签页重新可见 / bfcache 恢复 / 窗口聚焦」时派发
 * `gohub:activate` 事件；需要拉取数据的页面引入本 mixin 并实现
 * `onPageActivate(reason)` 即可在回到页面时自动刷新，不必手动按 F5。
 *
 * 用法：
 *   mixins: [backgroundManager, pageActivation]
 *   methods: {
 *     onPageActivate() { this.loadUsers() }
 *   }
 */
export default {
    mounted() {
        this.__pageActivateHandler = (evt) => {
            if (typeof this.onPageActivate === 'function') {
                try {
                    this.onPageActivate(evt?.detail?.reason || 'visible');
                } catch (e) {
                    console.warn('[pageActivation] 刷新失败:', e);
                }
            }
        };
        window.addEventListener('gohub:activate', this.__pageActivateHandler);
    },
    beforeUnmount() {
        if (this.__pageActivateHandler) {
            window.removeEventListener('gohub:activate', this.__pageActivateHandler);
            this.__pageActivateHandler = null;
        }
    },
};
