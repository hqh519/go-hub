<template>
    <!--
        文章编辑页（v1.4.0）—— /article/edit/:id
        ----------------------------------------------------------------------------
        整页承载文章的全部模块：标题 / 摘要 / 封面 / 分类 / 标签 / 备注 / 正文 / 页签。
        模块区与编辑器都在 ArticleEditPanel 里，与待办页右栏共用同一个组件 ——
        需求明确「待办页文章页有什么就得有什么」，两处各写一遍必然慢慢长歪。
    -->
    <div class="aep-page" :class="{ 'is-mobile': isMobile }">
        <div class="aep-topbar">
            <DashboardTabs active-tab="article" />
            <div class="aep-topbar-right">
                <button type="button" class="aep-icon-btn" :title="$t('article.backToList')" @click="goList">
                    <font-awesome-icon icon="list" />
                </button>
            </div>
        </div>
        <div class="aep-body">
            <ArticleEditPanel
                :article-id="articleId"
                type="article"
                :instance-id="instanceId"
                :folders="folders"
                :toolbar-config="editorConfig.toolbarLines || []"
                :editor-config="editorConfig"
                @close="goList"
                @changed="onChanged"
            />
        </div>
    </div>
</template>

<script>
import DashboardTabs from '@/components/DashboardTabs.vue';
import ArticleEditPanel from '@/components/article/ArticleEditPanel.vue';
import { fetchFolders, setArticleInstance } from '@/utils/articleApi';
import { fetchEditorConfig } from '@/utils/articleEditorConfig';
import { ensureInstanceUnlocked } from '@/utils/instanceSwitch';

export default {
    name: 'ArticleEditPage',
    components: { DashboardTabs, ArticleEditPanel },
    data() {
        return {
            isMobile: false,
            instance: '',
            folders: [],
            editorConfig: { toolbarLines: [] },
        };
    },
    computed: {
        instanceId() {
            return this.instance || '';
        },
        articleId() {
            return String(this.$route?.params?.id || '');
        },
    },
    async mounted() {
        this.syncViewport();
        window.addEventListener('resize', this.syncViewport);
        try {
            this.instance = localStorage.getItem('gohub_instance_id') || '';
        } catch (e) {
            this.instance = '';
        }
        ensureInstanceUnlocked(this.instance).catch(() => {});
        setArticleInstance(this.instance);
        this.editorConfig = await fetchEditorConfig(this.instance);
        await this.loadFolders();
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.syncViewport);
    },
    methods: {
        syncViewport() {
            this.isMobile = window.innerWidth <= 900;
        },
        async loadFolders() {
            try {
                const r = await fetchFolders('article');
                this.folders = Array.isArray(r?.nodes) ? r.nodes : [];
            } catch (e) {
                this.folders = [];
            }
        },
        goList() {
            this.$router.push('/article');
        },
        onChanged() {
            // 标题改了要让返回后的列表立刻反映：列表页每次进入都会重拉，这里不用做额外同步
        },
    },
};
</script>

<style scoped>
.aep-page {
    display: flex;
    /* 全站后台有若干处 text-align: center 的继承，这里显式归左，避免列表文字居中 */
    text-align: left;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    background: var(--el-bg-color-page);
    overflow: hidden;
}
.aep-topbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: var(--el-bg-color);
    border-bottom: 1px solid var(--el-border-color-lighter);
}
.aep-topbar-right {
    margin-left: auto;
    display: flex;
    gap: 4px;
}
.aep-icon-btn {
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-regular);
    cursor: pointer;
    font-size: 13px;
}
.aep-icon-btn:hover {
    background: var(--el-fill-color);
    color: var(--el-color-primary);
}
.aep-body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    background: var(--el-bg-color);
}
.aep-body > * {
    flex: 1 1 auto;
    min-width: 0;
}
</style>
