<template>
    <div class="page-footer" v-if="!disableFooter">
        <p class="footer-line">
            <span>© 2024-{{ thisYear }} Powered by</span>
            <!-- 页脚自定义代码：后台「页脚设置 → 页脚传送门链接」，支持 HTML / JS（如统计代码） -->
            <span v-if="footerCode" ref="footerCodeHost" class="footer-custom-code"></span>
        </p>
    </div>
</template>

<script>
import { mapGetters } from 'vuex'

export default {
    name: 'Footer',
    computed: {
        ...mapGetters(['userConfig']),
        /** 页脚自定义代码（HTML / JS），由后台「页脚设置」配置 */
        footerCode() {
            return String(this.userConfig?.footerLink || '').trim()
        },
        thisYear() {
            return new Date().getFullYear()
        },
        disableFooter() {
            return this.userConfig?.disableFooter || false
        }
    },
    watch: {
        footerCode() {
            this.$nextTick(() => this.mountFooterCode())
        }
    },
    mounted() {
        this.mountFooterCode()
    },
    methods: {
        /**
         * 挂载页脚自定义代码：
         * 直接 innerHTML 插入即可渲染 HTML；但 v-html / innerHTML 都不会执行 <script>，
         * 这里手动重建 script 节点，让统计代码等 JS 片段正常生效。
         */
        mountFooterCode() {
            const host = this.$refs.footerCodeHost
            if (!host) return
            host.innerHTML = this.footerCode
            const scripts = Array.from(host.querySelectorAll('script'))
            for (const old of scripts) {
                const s = document.createElement('script')
                for (const attr of Array.from(old.attributes)) s.setAttribute(attr.name, attr.value)
                s.text = old.textContent
                old.parentNode.replaceChild(s, old)
            }
        }
    }
}
</script>

<style scoped>
.page-footer {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100vw;
    color: var(--page-footer-text-color);
    font-size: large;
    user-select: none;
}
.footer-line {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0 2px;
    margin: 0;
    line-height: 1.6;
}
@media (max-width: 768px) {
    .page-footer {
        font-size: small;
    }
}
/* 页脚署名（图床名称与图标已于 v1.8.0 移除，仅保留 Powered by 与自定义代码） */

/*
 * 页脚自定义代码（传送门链接 / 统计代码）容器：
 * 颜色与字号严格继承「Powered by」所在行的样式，超链接不带下划线（v2.0.0），
 * 鼠标悬浮时变为蓝色，避免默认浏览器蓝色链接把页脚视觉打散。
 */
.footer-custom-code {
    display: inline;
    color: inherit;
    font-size: inherit;
    margin-left: 6px;
}

.footer-custom-code :deep(a) {
    color: inherit;
    font-size: inherit;
    text-decoration: none;
    transition: color 0.2s ease;
}

.footer-custom-code :deep(a:hover) {
    color: #409eff;
}
</style>
