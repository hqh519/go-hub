<template>
    <!--
        待办管理页（v1.4.0）—— /todo
        ----------------------------------------------------------------------------
        三栏：左分类目录 / 中待办列表 / 右编辑区（需求：参考记事页复刻左栏与中栏）。

        中栏按 joplin 的文章列表风格：标题前一个勾选框表示整篇完成，标题后一圈
        「正文待办项完成率」—— 完成率不是看那个勾，而是数正文里 `- [ ]` / `- [x]`
        各有几条，所以一篇待办可以「大项完成、子项还剩一半」。

        右侧编辑区与文章编辑页是**同一个组件**（ArticleEditPanel），
        模块一个不少：标题 / 摘要 / 封面 / 备注 / 正文 / 页签 / 标签 / 分类。

        移动端：目录进抽屉，列表与编辑两级切换（与记事页同一套处理）。
    -->
    <div
        class="tp-page"
        :class="{ 'is-mobile': isMobile, 'is-topbar-hidden': barsHidden, 'has-instance-badge': instanceSeq > 0 }"
        :style="instanceBadgeStyle"
    >
        <div class="tp-topbar">
            <DashboardTabs active-tab="todo" />
            <div class="tp-topbar-right">
                <button type="button" class="tp-publish-btn" @click="createTodo">
                    <font-awesome-icon icon="plus" class="tp-publish-icon" />
                    <span class="tp-publish-text">{{ $t('article.newTodo') }}</span>
                </button>
                <button v-if="isMobile && selectedId" type="button" class="tp-icon-btn" :title="$t('common.back')" @click="backToList">
                    <font-awesome-icon icon="chevron-left" />
                </button>
                <button type="button" class="tp-icon-btn" :title="$t('article.refresh')" @click="reloadAll">
                    <font-awesome-icon icon="sync" />
                </button>
            </div>
        </div>

        <div class="tp-cols">
            <aside
                v-show="!isMobile || (!selectedId && showTree)"
                class="tp-col tp-col-tree"
                :style="isMobile ? null : { flexBasis: `${treeWidth}px`, maxWidth: `${treeWidth}px` }"
            >
                <ArticleFolderTree
                    ref="tree"
                    type="todo"
                    :active="activeFolder"
                    :instance-id="instanceId"
                    @select="onPickFolder"
                    @loaded="onTreeLoaded"
                    @changed="onTreeChanged"
                />
                <span v-if="!isMobile" class="tp-resizer" :title="$t('memo.treeResize')" @pointerdown.prevent="startResize('tree', $event)"></span>
            </aside>

            <section
                v-show="!isMobile || !selectedId"
                class="tp-col tp-col-list"
                :style="isMobile ? null : { flexBasis: `${listWidth}px`, maxWidth: `${listWidth}px` }"
            >
                <div v-if="isMobile" class="tp-mobile-bar">
                    <button type="button" class="tp-mobile-btn" @click="showTree = true">
                        <font-awesome-icon icon="folder-tree" />
                        <span>{{ currentFolderName }}</span>
                    </button>
                </div>
                <ArticleListPanel
                    ref="list"
                    type="todo"
                    :folder-id="activeFolder"
                    :active-id="selectedId"
                    :instance-id="instanceId"
                    :compact="listWidth < 560"
                    @edit="openTodo"
                    @create="createTodo"
                    @changed="onListChanged"
                />
                <span v-if="!isMobile" class="tp-resizer" :title="$t('memo.treeResize')" @pointerdown.prevent="startResize('list', $event)"></span>
            </section>

            <main class="tp-col tp-col-editor" v-show="!isMobile || !!selectedId">
                <ArticleEditPanel
                    ref="panel"
                    :article-id="selectedId"
                    type="todo"
                    embedded
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
import { createArticle, setArticleInstance, articleError } from '@/utils/articleApi';
import { fetchEditorConfig } from '@/utils/articleEditorConfig';
import { ensureInstanceUnlocked } from '@/utils/instanceSwitch';
import axios from '@/utils/axios';

export default {
    name: 'TodoPage',
    components: { DashboardTabs, ArticleFolderTree, ArticleListPanel, ArticleEditPanel },
    data() {
        return {
            isMobile: false,
            instance: '',
            instances: [],
            activeFolder: '__all',
            folders: [],
            selectedId: '',
            showTree: false,
            treeWidth: 200,
            listWidth: 360,
            editorConfig: { toolbarLines: [] },
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
            if (this.activeFolder === '__all') return this.$t('article.allTodos');
            if (this.activeFolder === '__unfiled') return this.$t('article.unfiled');
            if (this.activeFolder === '__trash') return this.$t('memo.trash');
            return this.folders.find((f) => f.id === this.activeFolder)?.name || this.$t('article.allTodos');
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
        this.restoreWidths();
        this.fetchInstances();
        this.editorConfig = await fetchEditorConfig(this.instance);
        const id = String(this.$route?.query?.id || '');
        if (id) this.openTodo(id);
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
        /** v1.4.1：量顶栏真实高度写进 --tp-tb-h */
        measureTopbarHeight() {
            const bar = this.$el && this.$el.querySelector ? this.$el.querySelector('.tp-topbar') : null;
            if (!bar) return;
            const h = bar.offsetHeight;
            if (h > 0 && this._tpBarH !== h) {
                this._tpBarH = h;
                this.$el.style.setProperty('--tp-tb-h', `${h}px`);
            }
        },
        onTreeLoaded({ nodes }) {
            this.folders = Array.isArray(nodes) ? nodes : [];
        },
        onPickFolder(id) {
            this.activeFolder = String(id || '__all');
            if (this.isMobile) this.showTree = false;
            // 回收站里选中一篇没有意义（列表只给恢复 / 彻底删除），顺手退出编辑态
            if (this.activeFolder === '__trash') this.selectedId = '';
        },
        onTreeChanged() {
            this.$refs.list?.reload?.();
        },
        onListChanged() {
            this.$refs.tree?.reload?.();
        },
        onEditorChanged() {
            // 列表里的完成率 / 标题随保存刷新（只刷列表，不动编辑器）
            this.$refs.list?.reload?.();
            this.$refs.tree?.reload?.();
        },
        openTodo(id) {
            if (!id) return;
            // 切到另一篇之前，先把当前这篇没落库的改动写掉
            this.$refs.panel?.flushNow?.();
            this.selectedId = String(id);
            if (this.$route?.query?.id !== id) {
                this.$router.replace({ path: '/todo', query: { ...this.$route.query, id } }).catch(() => {});
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
                this.$router.replace({ path: '/todo', query: q }).catch(() => {});
            }
        },
        reloadAll() {
            this.$refs.tree?.reload?.();
            this.$refs.list?.reload?.();
        },
        async createTodo() {
            const folderId = this.activeFolder.startsWith('__') ? '' : this.activeFolder;
            try {
                /*
                 * v1.4.1（需求）：
                 *  · 标题自动填「待办 YYYY-MM-DD」
                 *  · 待办没有草稿态，新建即发布（后端对 type=todo 的默认值也是 published）
                 */
                const d = new Date();
                const p2 = (n) => String(n).padStart(2, '0');
                const title = `待办 ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
                const r = await createArticle({ type: 'todo', folderId, title, status: 'published' });
                if (!r?.id) throw new Error(this.$t('article.saveFail'));
                this.openTodo(r.id);
                this.$refs.list?.reload?.();
                this.$refs.tree?.reload?.();
            } catch (e) {
                ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
            }
        },
        /* 两处拖拽宽度（树栏 / 列表栏），与记事页同一套记忆方式 */
        restoreWidths() {
            const t = Number(localStorage.getItem('gohub_todo_tree_w') || 0);
            if (t >= 150 && t <= 360) this.treeWidth = t;
            const l = Number(localStorage.getItem('gohub_todo_list_w') || 0);
            if (l >= 240 && l <= 560) this.listWidth = l;
        },
        startResize(which, ev) {
            const isTree = which === 'tree';
            const startX = ev?.clientX ?? 0;
            const base = isTree ? this.treeWidth : this.listWidth;
            const min = isTree ? 150 : 240;
            const max = isTree ? 360 : 560;
            const move = (e) => {
                const w = Math.min(max, Math.max(min, base + (e.clientX - startX)));
                if (isTree) this.treeWidth = w;
                else this.listWidth = w;
            };
            const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                try {
                    localStorage.setItem(isTree ? 'gohub_todo_tree_w' : 'gohub_todo_list_w', String(isTree ? this.treeWidth : this.listWidth));
                } catch (e) {
                    /* 忽略 */
                }
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        },
        async fetchInstances() {
            try {
                const res = await axios.get('/api/instances');
                const list = Array.isArray(res.data) ? res.data : [];
                this.instances = [...list].sort((a, b) => (new Date(a.createdAt).getTime() || 0) - (new Date(b.createdAt).getTime() || 0));
            } catch (e) {
                this.instances = [];
            }
        },
    },
};
</script>

<style scoped>
.tp-page {
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
.tp-topbar {
    flex: 0 0 auto;
    position: relative;
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: var(--el-bg-color);
    border-bottom: 1px solid var(--el-border-color-lighter);
    /* v1.4.1（需求）：移动端上滚收起顶栏，高度按 JS 量的 --tp-tb-h 精确上移 */
    transition: margin-top 0.18s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.14s linear;
}
.tp-page.is-topbar-hidden .tp-topbar {
    margin-top: calc(-1 * var(--tp-tb-h, 49px) - 1px);
    opacity: 0;
    pointer-events: none;
}
.tp-topbar-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 5px;
}
.tp-publish-btn {
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
.tp-publish-btn:hover {
    filter: brightness(1.06);
}
.tp-icon-btn {
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-regular);
    cursor: pointer;
    font-size: 13px;
}
.tp-icon-btn:hover {
    background: var(--el-fill-color);
    color: var(--el-color-primary);
}
.tp-cols {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    gap: 1px;
    background: var(--el-border-color-lighter);
}
.tp-col {
    position: relative;
    background: var(--el-bg-color);
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}
.tp-col-tree {
    flex: 0 0 auto;
}
.tp-col-list {
    flex: 0 0 auto;
    min-width: 0;
}
.tp-col-editor {
    flex: 1 1 auto;
    min-width: 0;
}
.tp-resizer {
    position: absolute;
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 5;
}
.tp-mobile-bar {
    flex: 0 0 auto;
    padding: 6px 10px;
    border-bottom: 1px solid var(--el-border-color-lighter);
}
.tp-mobile-btn {
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

@media (max-width: 900px) {
    .tp-publish-text {
        display: none;
    }
    .tp-publish-btn {
        width: 32px;
        padding: 0;
        justify-content: center;
    }
    .tp-col-tree,
    .tp-col-list,
    .tp-col-editor {
        flex: 1 1 100% !important;
        max-width: none !important;
    }
}
</style>
