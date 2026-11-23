<template>
    <!--
        文章管理页（v1.4.0）—— /article
        ----------------------------------------------------------------------------
        两栏：左栏分类目录 / 右栏博客式文章列表（需求：左栏复刻记事页，右栏参考博客后台）。

        为什么编辑是独立页（/article/edit/:id）而不是像记事页那样塞在右栏：
        文章的模块区（标题 / 摘要 / 封面 / 备注 / 正文 / 页签 / 标签 / 分类）比一篇
        纯文档多得多，右栏宽度下「页签竖排 + 正文」会被挤成两列窄条；
        独立页能把模块区铺满、正文和页签都留足空间。列表页因此只负责浏览与筛选。
    -->
    <div
        class="ap-page"
        :class="{ 'is-mobile': isMobile, 'is-topbar-hidden': barsHidden, 'has-instance-badge': instanceSeq > 0 }"
        :style="instanceBadgeStyle"
    >
        <div class="ap-topbar">
            <DashboardTabs active-tab="article">
                <template #extra-item="{ close }">
                    <div class="page-option-sep" aria-hidden="true"></div>
                    <button
                        type="button"
                        class="page-option admin-page-instance-option"
                        @click.stop="openInstanceFromPageSwitch(close)"
                    >
                        <span v-if="instanceSeq > 0" class="admin-page-instance-seq">{{ instanceSeq }}</span>
                        <font-awesome-icon v-else icon="server" class="admin-page-instance-icon" />
                        <span class="admin-page-instance-text">{{ $t('instancePicker.title') }}</span>
                    </button>
                </template>
            </DashboardTabs>
            <div class="ap-topbar-right">
                <button type="button" class="ap-publish-btn" @click="createArticle()">
                    <font-awesome-icon icon="plus" class="ap-publish-icon" />
                    <span class="ap-publish-text">{{ $t('article.newArticle') }}</span>
                </button>
                <button type="button" class="ap-icon-btn" :title="$t('article.refresh')" @click="reloadAll">
                    <font-awesome-icon icon="sync" />
                </button>
            </div>
        </div>

        <div class="ap-cols">
            <aside
                v-show="!isMobile || (!selectedId && showTree)"
                class="ap-col ap-col-tree"
                :style="isMobile ? null : { flexBasis: `${treeWidth}px`, maxWidth: `${treeWidth}px` }"
            >
                <ArticleFolderTree
                    ref="tree"
                    type="article"
                    :active="activeFolder"
                    :instance-id="instanceId"
                    @select="onPickFolder"
                    @loaded="onTreeLoaded"
                    @changed="onTreeChanged"
                />
                <span v-if="!isMobile" class="ap-tree-resizer" :title="$t('memo.treeResize')" @pointerdown.prevent="startTreeResize"></span>
            </aside>

            <!--
                v1.4.1（需求）：右栏在「列表」与「编辑」之间切换，不再跳独立页。
                桌面端点全部文章 / 某个分类 → 右栏回到列表；点文章（或列表里的编辑）→ 右栏变编辑页。
                移动端与待办页一致：列表与编辑二级切换，目录进抽屉。
            -->
            <main class="ap-col ap-col-list" v-show="!selectedId">
                <!-- 移动端：目录开关 + 当前分类名 -->
                <div v-if="isMobile" class="ap-mobile-bar">
                    <button type="button" class="ap-mobile-btn" @click="showTree = !showTree">
                        <font-awesome-icon icon="folder-tree" />
                        <span>{{ currentFolderName }}</span>
                    </button>
                </div>
                <ArticleListPanel
                    ref="list"
                    type="article"
                    :folder-id="activeFolder"
                    :active-id="selectedId"
                    :instance-id="instanceId"
                    @edit="openEditor"
                    @create="createArticle()"
                    @changed="onListChanged"
                />
            </main>

            <main class="ap-col ap-col-editor" v-show="!!selectedId">
                <ArticleEditPanel
                    ref="panel"
                    :article-id="selectedId"
                    type="article"
                    :instance-id="instanceId"
                    :folders="folders"
                    :toolbar-config="editorConfig.toolbarLines || []"
                    :editor-config="editorConfig"
                    @close="backToList"
                    @changed="onEditorChanged"
                    @bars-hidden="barsHidden = $event"
                />
            </main>
        </div>
    </div>
</template>

<script>
import { ElMessage } from 'element-plus';
import DashboardTabs from '@/components/DashboardTabs.vue';
import ArticleFolderTree from '@/components/article/ArticleFolderTree.vue';
import ArticleListPanel from '@/components/article/ArticleListPanel.vue';
import ArticleEditPanel from '@/components/article/ArticleEditPanel.vue';
import { createArticle as apiCreateArticle, setArticleInstance, articleError } from '@/utils/articleApi';
import { fetchEditorConfig } from '@/utils/articleEditorConfig';
import { ensureInstanceUnlocked, revokeInstanceUnlock } from '@/utils/instanceSwitch';
import axios from '@/utils/axios';

export default {
    name: 'ArticlePage',
    components: { DashboardTabs, ArticleFolderTree, ArticleListPanel, ArticleEditPanel },
    data() {
        return {
            isMobile: false,
            instance: '',
            instances: [],
            /** '__all' / '__unfiled' / '__trash' / 分类 id */
            activeFolder: '__all',
            folders: [],
            /** v1.4.1：右栏正在编辑的文章 id（空 = 右栏显示列表） */
            selectedId: '',
            editorConfig: { toolbarLines: [] },
            showTree: false,
            treeWidth: 224,
            showInstanceDialog: false,
            /** v1.4.1：移动端滚动时收起顶栏（由编辑面板的滚动判定驱动） */
            barsHidden: false,
        };
    },
    computed: {
        instanceId() {
            return this.instance || '';
        },
        instanceSeq() {
            const cur = String(this.instanceId || '');
            if (!cur) return 0;
            const idx = this.instances.findIndex((i) => String(i.id) === cur);
            return idx >= 0 ? idx + 1 : 0;
        },
        instanceBadgeStyle() {
            const n = this.instanceSeq;
            if (!n) return null;
            const circled = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
            const text = n <= circled.length ? circled[n - 1] : `(${n})`;
            return { '--instance-seq': `"${text}"` };
        },
        currentFolderName() {
            if (this.activeFolder === '__all') return this.$t('article.allArticles');
            if (this.activeFolder === '__unfiled') return this.$t('article.unfiled');
            if (this.activeFolder === '__trash') return this.$t('memo.trash');
            return this.folders.find((f) => f.id === this.activeFolder)?.name || this.$t('article.allArticles');
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
        this.restoreTreeWidth();
        this.fetchInstances();
        this.editorConfig = await fetchEditorConfig(this.instance);
        const q = this.$route?.query || {};
        if (q.folder) this.activeFolder = String(q.folder);
        if (q.id) this.openEditor(String(q.id));
        this.$nextTick(this.measureTopbarHeight);
    },
    updated() {
        this.measureTopbarHeight();
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.syncViewport);
        // 离开页面（切路由）也要把编辑中的内容写掉
        this.$refs.panel?.flushNow?.();
    },
    methods: {
        syncViewport() {
            this.isMobile = window.innerWidth <= 900;
            if (!this.isMobile) this.barsHidden = false;
        },
        /** v1.4.1：量顶栏真实高度写进 --ap-tb-h，收起时按它精确上移 */
        measureTopbarHeight() {
            const bar = this.$el && this.$el.querySelector ? this.$el.querySelector('.ap-topbar') : null;
            if (!bar) return;
            const h = bar.offsetHeight;
            if (h > 0 && this._apBarH !== h) {
                this._apBarH = h;
                this.$el.style.setProperty('--ap-tb-h', `${h}px`);
            }
        },
        onTreeLoaded({ nodes }) {
            this.folders = Array.isArray(nodes) ? nodes : [];
        },
        onPickFolder(id) {
            this.activeFolder = String(id || '__all');
            if (this.isMobile) this.showTree = false;
            /*
             * v1.4.1（需求）：点「全部文章 / 未分类 / 某个分类」时右栏回到列表 ——
             * 切换目录的意图本来就是「看这个目录里的东西」，再留着上一篇的编辑页很怪。
             */
            this.selectedId = '';
            const q = { ...(this.$route?.query || {}) };
            if (q.folder || q.id) {
                delete q.folder;
                delete q.id;
                this.$router.replace({ path: '/article', query: q }).catch(() => {});
            }
        },
        onTreeChanged() {
            this.$refs.list?.reload?.();
        },
        onListChanged() {
            this.$refs.tree?.reload?.();
        },
        onEditorChanged() {
            // 标题 / 完成率变了，列表与目录计数跟着刷新（不碰编辑器自身）
            this.$refs.list?.reload?.();
            this.$refs.tree?.reload?.();
        },
        reloadAll() {
            this.$refs.tree?.reload?.();
            this.$refs.list?.reload?.();
        },
        /* v1.4.1：右栏内编辑（与待办页同一套：selectedId 决定右栏显示列表还是编辑） */
        openEditor(id) {
            if (!id) return;
            // 切换文章前先把上一篇没落库的改动写掉，避免「点了别的条目，上一篇白改」
            this.$refs.panel?.flushNow?.();
            this.selectedId = String(id);
            if (String(this.$route?.query?.id || '') !== String(id)) {
                this.$router.replace({ path: '/article', query: { ...this.$route.query, id } }).catch(() => {});
            }
        },
        backToList() {
            // 回列表前把这一篇没落库的改动写掉（自动保存有 0.8~1.5s 空窗）
            this.$refs.panel?.flushNow?.();
            this.selectedId = '';
            // 回到列表：顶栏必须露出来，否则用户看不到页面切换 / 新建
            this.barsHidden = false;
            if (this.$route?.query?.id) {
                const q = { ...this.$route.query };
                delete q.id;
                this.$router.replace({ path: '/article', query: q }).catch(() => {});
            }
            this.$refs.list?.reload?.();
        },
        /**
         * 新建文章：先在当前分类下建一篇空稿，再在右栏打开。
         * 不在列表里塞一条「临时行」——文章必须落库才有 id，页签 / 标签都挂在 id 上。
         */
        async createArticle() {
            const folderId = this.activeFolder.startsWith('__') ? '' : this.activeFolder;
            try {
                const r = await apiCreateArticle({ type: 'article', folderId, title: '' });
                if (!r?.id) throw new Error(this.$t('article.saveFail'));
                this.openEditor(r.id);
            } catch (e) {
                ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
            }
        },
        /* 树栏宽度（与记事页同一套：拖一次记住，刷新还原） */
        restoreTreeWidth() {
            const n = Number(localStorage.getItem('gohub_article_tree_w') || 0);
            if (n >= 160 && n <= 420) this.treeWidth = n;
        },
        startTreeResize(ev) {
            const startX = ev.clientX;
            const startW = this.treeWidth;
            const move = (e) => {
                const w = Math.min(420, Math.max(160, startW + (e.clientX - startX)));
                this.treeWidth = w;
            };
            const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                try {
                    localStorage.setItem('gohub_article_tree_w', String(this.treeWidth));
                } catch (e) {
                    /* 隐私模式忽略 */
                }
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        },
        /* 实例 */
        async fetchInstances() {
            try {
                const res = await axios.get('/api/instances');
                const list = Array.isArray(res.data) ? res.data : [];
                this.instances = [...list].sort((a, b) => (new Date(a.createdAt).getTime() || 0) - (new Date(b.createdAt).getTime() || 0));
            } catch (e) {
                this.instances = [];
            }
        },
        openInstanceFromPageSwitch(closeFn) {
            if (typeof closeFn === 'function') closeFn();
            // 文章页不内嵌切换弹窗：与其它页一致地跳「用户编辑 → 实例管理」入口
            this.openInstanceManagement();
        },
        async openInstanceManagement() {
            const win = window.open('about:blank', '_blank');
            let url = '/customerConfig';
            try {
                const res = await axios.get('/api/manage/users');
                const list = Array.isArray(res.data) ? res.data : [];
                const me = this.$store?.getters?.sessionUser || '';
                const hit = me ? list.find((u) => u && u.username === me) : null;
                if (hit && hit.id) url = `/customerConfig/edit/${encodeURIComponent(hit.id)}?anchor=instances`;
            } catch (e) {
                /* 取不到就退回用户管理列表 */
            }
            try {
                win.location.href = url;
            } catch (e) {
                window.open(url, '_blank', 'noopener');
            }
        },
        async switchInstanceTo(id) {
            const next = id == null ? '' : String(id);
            if (next === this.instanceId) return;
            const ok = await ensureInstanceUnlocked(next);
            if (!ok) return;
            await revokeInstanceUnlock(this.instanceId);
            try {
                localStorage.setItem('gohub_instance_id', next);
            } catch (e) {
                /* 忽略 */
            }
            window.location.reload();
        },
    },
};
</script>

<style scoped>
.ap-page {
    display: flex;
    /* 全站后台有若干处 text-align: center 的继承，这里显式归左，避免列表文字居中 */
    text-align: left;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    background: var(--el-bg-color-page);
    overflow: hidden;
    overscroll-behavior: none;
}
.ap-topbar {
    flex: 0 0 auto;
    position: relative;
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: var(--el-bg-color);
    border-bottom: 1px solid var(--el-border-color-lighter);
    /* v1.4.1（需求）：移动端上滚收起顶栏；高度用 JS 量的 --ap-tb-h 精确上移 */
    transition: margin-top 0.18s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.14s linear;
}
.ap-page.is-topbar-hidden .ap-topbar {
    margin-top: calc(-1 * var(--ap-tb-h, 49px) - 1px);
    opacity: 0;
    pointer-events: none;
}
.ap-topbar-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
}
.ap-publish-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 13px;
    border: none;
    border-radius: 9px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
}
.ap-publish-btn:hover {
    filter: brightness(1.06);
}
.ap-publish-icon {
    font-size: 12px;
}
.ap-icon-btn {
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-regular);
    cursor: pointer;
    font-size: 13px;
}
.ap-icon-btn:hover {
    background: var(--el-fill-color);
    color: var(--el-color-primary);
}
.ap-cols {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    gap: 1px;
    background: var(--el-border-color-lighter);
}
.ap-col {
    background: var(--el-bg-color);
    min-height: 0;
    overflow: hidden;
}
.ap-col-tree {
    position: relative;
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
}
.ap-col-list {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
}
/* v1.4.1：右栏编辑区（与列表同一块地，互相切换） */
.ap-col-editor {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--el-border-color-lighter);
}
.ap-tree-resizer {
    position: absolute;
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 5;
}
.ap-mobile-bar {
    flex: 0 0 auto;
    padding: 6px 10px;
    border-bottom: 1px solid var(--el-border-color-lighter);
}
.ap-mobile-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-bg-color);
    color: var(--el-text-color-regular);
    font-size: 12.5px;
    cursor: pointer;
}
.ap-page :deep(.page-option-sep) {
    flex: 0 0 auto;
    height: 1px;
    margin: 6px 4px;
    background: var(--el-border-color-lighter);
}
.ap-page :deep(.admin-page-instance-option) {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    box-sizing: border-box;
    height: var(--page-option-height, 37px);
    padding: 0 12px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: var(--page-option-font-size, 15px);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
}
.ap-page :deep(.admin-page-instance-seq) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
}

@media (max-width: 900px) {
    .ap-publish-text {
        display: none;
    }
    .ap-publish-btn {
        width: 32px;
        padding: 0;
        justify-content: center;
    }
    .ap-col-tree {
        flex: 1 1 100% !important;
        max-width: none !important;
    }
    .ap-col-list {
        flex: 1 1 100%;
    }
    .ap-col-editor {
        flex: 1 1 100%;
        border-left: none;
    }
}
</style>
