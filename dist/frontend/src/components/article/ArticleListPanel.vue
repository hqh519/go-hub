<template>
    <!--
        文章 / 待办列表（v1.4.0）
        ----------------------------------------------------------------------------
        右栏「博客列表式」文章管理（需求：参考博客后台的文章列表，不直接复刻）。

        一条记录 = 封面缩略 + 标题 + 两行摘要 + 分类 / 作者 / 浏览 / 评论 / 日期 / 字数，
        右侧是操作区（编辑 + 更多菜单）。待办变体在前面多一个整篇勾选框，
        后面多一圈「正文待办项完成率」，其余完全一致 —— 两者本就是同一张表。
    -->
    <div class="alp-root" :class="{ 'is-compact': compact }">
        <div v-if="!hideToolbar" class="alp-toolbar">
            <div class="alp-search">
                <font-awesome-icon icon="search" class="alp-search-icon" />
                <input
                    v-model="search"
                    class="alp-search-input"
                    type="text"
                    :placeholder="type === 'todo' ? $t('article.searchTodo') : $t('article.searchArticle')"
                    @keyup.enter="reload"
                />
                <button v-if="search" type="button" class="alp-search-clear" @click="clearSearch">
                    <font-awesome-icon icon="times" />
                </button>
            </div>
            <el-select v-model="status" class="alp-select" size="small" @change="reload">
                <el-option :label="$t('article.statusAll')" value="" />
                <el-option :label="$t('article.statusDraft')" value="draft" />
                <el-option :label="$t('article.statusPublished')" value="published" />
            </el-select>
            <el-select v-model="sort" class="alp-select alp-select-sort" size="small" @change="reload">
                <el-option :label="$t('article.sortUpdated')" value="updated" />
                <el-option :label="$t('article.sortCreated')" value="created" />
                <el-option :label="$t('article.sortTitle')" value="title" />
            </el-select>
            <button type="button" class="alp-icon-btn" :title="$t('memo.reload')" @click="reload">
                <font-awesome-icon icon="sync" />
            </button>
        </div>

        <div v-if="trashMode" class="alp-banner" role="status">
            <font-awesome-icon icon="trash-alt" class="alp-banner-icon" />
            <span>{{ $t('article.trashBanner') }}</span>
        </div>

        <div class="alp-list">
            <div v-if="loading && !list.length" class="alp-state">
                <font-awesome-icon icon="spinner" spin />
                <span>{{ $t('article.loading') }}</span>
            </div>
            <div v-else-if="!list.length" class="alp-state alp-empty">
                <font-awesome-icon :icon="type === 'todo' ? 'list-check' : 'file-lines'" class="alp-empty-icon" />
                <p class="alp-empty-title">{{ trashMode ? $t('article.trashEmpty') : emptyTitle }}</p>
                <p class="alp-empty-tip">{{ trashMode ? $t('article.trashEmptyTip') : emptyTip }}</p>
                <button v-if="!trashMode" type="button" class="alp-empty-btn" @click="$emit('create')">
                    <font-awesome-icon icon="plus" /> {{ type === 'todo' ? $t('article.newTodo') : $t('article.newArticle') }}
                </button>
            </div>

            <template v-else>
                <div
                    v-for="item in list"
                    :key="item.id"
                    class="alp-item"
                    :data-id="item.id"
                    :class="{ 'is-active': item.id === activeId, 'is-done': type === 'todo' && item.done }"
                    @click="openItem(item)"
                >
                    <!-- 待办：整篇勾选框（需求：每个标题名称前面有一个勾选框） -->
                    <span
                        v-if="type === 'todo' && !trashMode"
                        class="alp-check"
                        :class="{ 'is-checked': item.done }"
                        role="checkbox"
                        :aria-checked="item.done ? 'true' : 'false'"
                        :title="item.done ? $t('article.markUndone') : $t('article.markDone')"
                        @click.stop="toggleDone(item)"
                    >
                        <font-awesome-icon v-if="item.done" icon="check" />
                    </span>

                    <div class="alp-cover" :class="{ 'is-empty': !item.coverName }">
                        <img v-if="item.coverName" :src="coverUrl(item)" :alt="item.title || ''" loading="lazy" />
                        <font-awesome-icon v-else :icon="type === 'todo' ? 'list-check' : 'file-lines'" />
                    </div>

                    <div class="alp-main">
                        <div class="alp-title-row">
                            <span class="alp-title" :title="item.title">{{ item.title || $t('article.untitled') }}</span>
                            <span v-if="item.status === 'draft'" class="alp-badge">{{ $t('article.statusDraft') }}</span>
                            <span v-if="item.tags && item.tags.length" class="alp-tags">
                                <span v-for="t in item.tags.slice(0, 3)" :key="t" class="alp-tag">#{{ t }}</span>
                            </span>
                        </div>
                        <p class="alp-excerpt">{{ item.excerpt || $t('article.noExcerpt') }}</p>
                        <div class="alp-meta">
                            <span v-if="item.folderName" class="alp-meta-item alp-folder">
                                <font-awesome-icon icon="folder" />{{ item.folderName }}
                            </span>
                            <span class="alp-meta-item">
                                <font-awesome-icon icon="user" />{{ item.author || '—' }}
                            </span>
                            <span class="alp-meta-item">
                                <font-awesome-icon icon="eye" />{{ item.views || 0 }}
                            </span>
                            <span class="alp-meta-item">
                                <font-awesome-icon icon="comment" />{{ item.comments || 0 }}
                            </span>
                            <span class="alp-meta-item">
                                <font-awesome-icon icon="clock" />{{ fmtTime(item.updatedAt) }}
                            </span>
                            <span class="alp-meta-item">
                                <font-awesome-icon icon="font" />{{ $t('article.wordCount', { n: item.wordCount || 0 }) }}
                            </span>
                        </div>
                    </div>

                    <!-- 待办：正文待办项完成率 -->
                    <div v-if="type === 'todo'" class="alp-progress" :title="progressTitle(item)">
                        <svg class="alp-ring" viewBox="0 0 36 36" aria-hidden="true">
                            <circle class="alp-ring-bg" cx="18" cy="18" r="15.5" />
                            <circle
                                class="alp-ring-fg"
                                cx="18"
                                cy="18"
                                r="15.5"
                                :stroke-dasharray="`${ringDash(item)} 97.39`"
                            />
                        </svg>
                        <span class="alp-ring-text">
                            <b>{{ rateOf(item) }}</b><i>%</i>
                        </span>
                    </div>

                    <div class="alp-actions" @click.stop>
                        <template v-if="trashMode">
                            <button type="button" class="alp-btn" @click="restore(item)">
                                {{ $t('article.restore') }}
                            </button>
                            <button type="button" class="alp-btn is-danger" @click="purge(item)">
                                {{ $t('article.purge') }}
                            </button>
                        </template>
                        <template v-else>
                            <button type="button" class="alp-btn is-primary" @click="$emit('edit', item.id)">
                                {{ $t('article.edit') }}
                            </button>
                            <el-dropdown trigger="click" @command="(cmd) => onCommand(cmd, item)" @click.stop>
                                <button type="button" class="alp-icon-btn" @click.stop>
                                    <font-awesome-icon icon="ellipsis-v" />
                                </button>
                                <template #dropdown>
                                    <el-dropdown-menu>
                                        <el-dropdown-item command="togglePublish">
                                            {{ item.status === 'published' ? $t('article.unpublish') : $t('article.publish') }}
                                        </el-dropdown-item>
                                        <el-dropdown-item command="delete" divided>{{ $t('article.delete') }}</el-dropdown-item>
                                    </el-dropdown-menu>
                                </template>
                            </el-dropdown>
                        </template>
                    </div>
                </div>
            </template>
        </div>

        <div v-if="list.length && hasMore" class="alp-more">
            <el-button size="small" :loading="loading" @click="loadMore">{{ $t('notes.loadMore') }}</el-button>
        </div>
        <div v-else-if="list.length" class="alp-end">{{ $t('article.endOfList') }}</div>
    </div>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus';
import { fetchArticles, updateArticle, deleteArticle, restoreArticle, purgeArticle, articleError } from '@/utils/articleApi';

export default {
    name: 'ArticleListPanel',
    props: {
        type: { type: String, default: 'article' },
        /** '__all' / '__unfiled' / '__trash' / 分类 id */
        folderId: { type: String, default: '__all' },
        activeId: { type: String, default: '' },
        instanceId: { type: String, default: '' },
        /** 外部搜索词（/post 的顶栏搜索框驱动时用；自带工具条会同时隐藏） */
        searchText: { type: String, default: '' },
        /** true = 隐藏自带的搜索 / 状态 / 排序行（由宿主页面提供） */
        hideToolbar: { type: Boolean, default: false },
        /**
         * true = 窄栏紧凑版（/todo 的中栏只有 300 多像素）。
         * 横排的「封面 + 标题 + 摘要 + 完成率 + 操作」在 330px 里会被挤成一列字，
         * 紧凑版改成：勾选框左上、完成率右上、标题与摘要在中间、操作悬浮右下。
         */
        compact: { type: Boolean, default: false },
    },
    emits: ['edit', 'create', 'changed', 'loaded'],
    data() {
        return {
            list: [],
            total: 0,
            page: 1,
            pageSize: 30,
            loading: false,
            hasMore: false,
            search: '',
            status: '',
            sort: 'updated',
        };
    },
    computed: {
        trashMode() {
            return this.folderId === '__trash';
        },
        emptyTitle() {
            return this.type === 'todo' ? this.$t('article.emptyTodos') : this.$t('article.emptyArticles');
        },
        emptyTip() {
            return this.type === 'todo' ? this.$t('article.emptyTodosTip') : this.$t('article.emptyArticlesTip');
        },
    },
    watch: {
        folderId() {
            this.reload();
        },
        searchText(v) {
            if (String(this.search) === String(v || '')) return;
            this.search = String(v || '');
            this.reload();
        },
        hideToolbar(v) {
            // 由宿主提供搜索时，列表内的搜索框不再参与，避免两处过滤互相覆盖
            if (v) this.search = '';
        },
        type() {
            this.reload();
        },
    },
    mounted() {
        this.reload();
    },
    methods: {
        fmtTime(ts) {
            const n = Number(ts) || 0;
            if (!n) return '—';
            const d = new Date(n);
            const p = (x) => String(x).padStart(2, '0');
            const now = new Date();
            const sameYear = d.getFullYear() === now.getFullYear();
            return sameYear
                ? `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
                : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        },
        coverUrl(item) {
            if (!item?.coverName) return '';
            return `/file/${encodeURIComponent(item.coverName)}`;
        },
        /** 完成率：正文待办项「已完成 / 总数」 */
        rateOf(item) {
            const total = Number(item?.todoTotal) || 0;
            const done = Number(item?.todoDone) || 0;
            if (!total) return 0;
            return Math.round((done / total) * 100);
        },
        ringDash(item) {
            const r = 15.5;
            const c = 2 * Math.PI * r;
            return ((this.rateOf(item) / 100) * c).toFixed(2);
        },
        progressTitle(item) {
            return this.$t('article.progressTip', { done: item.todoDone || 0, total: item.todoTotal || 0 });
        },
        async reload() {
            this.page = 1;
            await this.fetch(true);
        },
        async loadMore() {
            if (this.loading) return;
            this.page += 1;
            await this.fetch(false);
        },
        async fetch(reset) {
            this.loading = true;
            try {
                const params = {
                    type: this.type,
                    folderId: this.folderId,
                    status: this.trashMode ? 'deleted' : this.status,
                    search: this.search,
                    sort: this.sort,
                    page: this.page,
                    pageSize: this.pageSize,
                };
                const r = await fetchArticles(params);
                const rows = Array.isArray(r?.list) ? r.list : [];
                this.list = reset ? rows : this.list.concat(rows);
                this.total = Number(r?.total) || 0;
                this.hasMore = !!r?.hasMore;
                this.$emit('loaded', { total: this.total });
            } catch (e) {
                if (reset) this.list = [];
                ElMessage.error(articleError(e).message || this.$t('article.loadFail'));
            } finally {
                this.loading = false;
            }
        },
        clearSearch() {
            this.search = '';
            this.reload();
        },
        openItem(item) {
            if (this.trashMode) return;
            this.$emit('edit', item.id);
        },
        async toggleDone(item) {
            const next = !item.done;
            item.done = next;
            try {
                const r = await updateArticle(item.id, { done: next });
                if (r?.version) item.version = r.version;
                this.$emit('changed');
            } catch (e) {
                item.done = !next;
                ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
            }
        },
        async onCommand(cmd, item) {
            if (cmd === 'togglePublish') {
                const next = item.status === 'published' ? 'draft' : 'published';
                try {
                    const r = await updateArticle(item.id, { status: next });
                    item.status = r?.status || next;
                    ElMessage.success(next === 'published' ? this.$t('article.published') : this.$t('article.unpublished'));
                    this.$emit('changed');
                } catch (e) {
                    ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
                }
                return;
            }
            if (cmd === 'delete') {
                try {
                    await ElMessageBox.confirm(
                        this.$t('article.deleteTip', { title: item.title || this.$t('article.untitled') }),
                        this.$t('article.delete'),
                        { type: 'warning', confirmButtonText: this.$t('common.confirm'), cancelButtonText: this.$t('common.cancel') },
                    );
                } catch (e) {
                    return;
                }
                try {
                    await deleteArticle(item.id);
                    ElMessage.success(this.$t('article.deleted'));
                    this.reload();
                    this.$emit('changed');
                } catch (e) {
                    ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
                }
            }
        },
        async restore(item) {
            try {
                await restoreArticle(item.id);
                ElMessage.success(this.$t('article.restored'));
                this.reload();
                this.$emit('changed');
            } catch (e) {
                ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
            }
        },
        async purge(item) {
            try {
                await ElMessageBox.confirm(
                    this.$t('article.purgeTip', { title: item.title || this.$t('article.untitled') }),
                    this.$t('article.purge'),
                    { type: 'warning', confirmButtonText: this.$t('common.confirm'), cancelButtonText: this.$t('common.cancel') },
                );
            } catch (e) {
                return;
            }
            try {
                await purgeArticle(item.id);
                ElMessage.success(this.$t('article.purged'));
                this.reload();
                this.$emit('changed');
            } catch (e) {
                ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
            }
        },
    },
};
</script>

<style scoped>
.alp-root {
    display: flex;
    /* 全站后台有若干处 text-align: center 的继承，这里显式归左，避免列表文字居中 */
    text-align: left;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--el-bg-color);
}
.alp-toolbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--el-border-color-lighter);
}
.alp-search {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 10px;
    border-radius: 8px;
    background: var(--el-fill-color-light);
}
.alp-search-icon {
    font-size: 12px;
    color: var(--el-text-color-placeholder);
}
.alp-search-input {
    flex: 1 1 auto;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 13px;
    color: var(--el-text-color-primary);
}
.alp-search-clear {
    border: none;
    background: transparent;
    color: var(--el-text-color-placeholder);
    cursor: pointer;
}
.alp-select {
    width: 96px;
    flex: 0 0 auto;
}
.alp-select-sort {
    width: 104px;
}
.alp-icon-btn {
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-regular);
    cursor: pointer;
    font-size: 13px;
}
.alp-icon-btn:hover {
    background: var(--el-fill-color);
    color: var(--el-color-primary);
}
.alp-banner {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 14px 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--el-color-danger-light-9);
    color: var(--el-color-danger);
    font-size: 12.5px;
}
.alp-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 8px 14px 4px;
    overscroll-behavior: contain;
}
.alp-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 80px 20px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}
.alp-empty-icon {
    font-size: 30px;
    opacity: 0.35;
}
.alp-empty-title {
    margin: 4px 0 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-regular);
}
.alp-empty-tip {
    margin: 0;
    font-size: 12.5px;
    color: var(--el-text-color-placeholder);
}
.alp-empty-btn {
    margin-top: 8px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 14px;
    border: none;
    border-radius: 8px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 12.5px;
    cursor: pointer;
}
.alp-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 10px;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.15s;
}
.alp-item + .alp-item {
    border-top: 1px solid var(--el-border-color-lighter);
}
.alp-item:hover {
    background: var(--el-fill-color-light);
}
.alp-item.is-active {
    background: var(--el-color-primary-light-9);
}
.alp-item.is-done .alp-title {
    color: var(--el-text-color-secondary);
    text-decoration: line-through;
}
.alp-check {
    flex: 0 0 auto;
    margin-top: 20px;
    width: 17px;
    height: 17px;
    border: 1.6px solid var(--el-border-color);
    border-radius: 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 10px;
    transition: all 0.15s;
}
.alp-check:hover {
    border-color: var(--el-color-primary);
}
.alp-check.is-checked {
    background: var(--el-color-success);
    border-color: var(--el-color-success);
}
.alp-cover {
    flex: 0 0 auto;
    width: 96px;
    height: 64px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--el-fill-color-light);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--el-text-color-placeholder);
    font-size: 18px;
}
.alp-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.alp-main {
    flex: 1 1 auto;
    min-width: 0;
}
.alp-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}
.alp-title {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.alp-badge {
    flex: 0 0 auto;
    padding: 0 6px;
    height: 18px;
    line-height: 18px;
    border-radius: 5px;
    background: var(--el-color-warning-light-9);
    color: var(--el-color-warning);
    font-size: 11px;
}
.alp-tags {
    flex: 0 0 auto;
    display: inline-flex;
    gap: 4px;
    overflow: hidden;
}
.alp-tag {
    font-size: 11px;
    color: var(--el-color-primary);
    opacity: 0.85;
    white-space: nowrap;
}
.alp-excerpt {
    margin: 4px 0 0;
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.alp-meta {
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 11.5px;
    color: var(--el-text-color-placeholder);
}
.alp-meta-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
.alp-folder {
    color: var(--el-color-primary);
    opacity: 0.85;
}
.alp-progress {
    position: relative;
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    margin-top: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
}
.alp-ring {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
}
.alp-ring-bg {
    fill: none;
    stroke: var(--el-fill-color-dark);
    stroke-width: 3.4;
}
.alp-ring-fg {
    fill: none;
    stroke: var(--el-color-success);
    stroke-width: 3.4;
    stroke-linecap: round;
    transition: stroke-dasharray 0.3s;
}
.alp-ring-text {
    position: relative;
    font-size: 10px;
    color: var(--el-text-color-regular);
    font-variant-numeric: tabular-nums;
}
.alp-ring-text b {
    font-weight: 600;
}
.alp-ring-text i {
    font-style: normal;
    font-size: 8px;
    opacity: 0.7;
}
.alp-actions {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 12px;
}
.alp-btn {
    height: 27px;
    padding: 0 11px;
    border: 1px solid var(--el-border-color);
    border-radius: 7px;
    background: var(--el-bg-color);
    color: var(--el-text-color-regular);
    font-size: 12px;
    cursor: pointer;
}
.alp-btn:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
}
.alp-btn.is-primary {
    border-color: transparent;
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    font-weight: 600;
}
.alp-btn.is-primary:hover {
    background: var(--el-color-primary);
    color: #fff;
}
.alp-btn.is-danger:hover {
    border-color: var(--el-color-danger);
    color: var(--el-color-danger);
}
.alp-more {
    flex: 0 0 auto;
    display: flex;
    justify-content: center;
    padding: 8px 0 14px;
}
.alp-end {
    flex: 0 0 auto;
    padding: 6px 0 14px;
    text-align: center;
    font-size: 11.5px;
    color: var(--el-text-color-placeholder);
}

/* ── v1.4.0：窄栏紧凑版（/todo 中栏） ───────────────────────── */
.alp-root.is-compact .alp-toolbar {
    gap: 6px;
    padding: 8px 10px;
}
.alp-root.is-compact .alp-select {
    width: 84px;
}
.alp-root.is-compact .alp-select-sort {
    display: none;
}
.alp-root.is-compact .alp-list {
    padding: 6px 8px 2px;
}
.alp-root.is-compact .alp-item {
    display: block;
    position: relative;
    padding: 10px 10px 9px;
}
.alp-root.is-compact .alp-cover {
    display: none;
}
.alp-root.is-compact .alp-check {
    position: absolute;
    left: 9px;
    top: 12px;
    margin: 0;
}
.alp-root.is-compact .alp-main {
    padding-left: 23px;
    padding-right: 38px;
}
.alp-root.is-compact .alp-title {
    font-size: 13.5px;
}
.alp-root.is-compact .alp-badge {
    height: 16px;
    line-height: 16px;
    font-size: 10px;
}
.alp-root.is-compact .alp-tags {
    display: none;
}
.alp-root.is-compact .alp-excerpt {
    margin-top: 3px;
    font-size: 12px;
    -webkit-line-clamp: 2;
}
.alp-root.is-compact .alp-meta {
    margin-top: 5px;
    gap: 9px;
    font-size: 11px;
    overflow: hidden;
    white-space: nowrap;
}
.alp-root.is-compact .alp-meta-item:nth-child(n + 4) {
    display: none;
}
.alp-root.is-compact .alp-progress {
    position: absolute;
    right: 8px;
    top: 9px;
    width: 32px;
    height: 32px;
    margin: 0;
}
.alp-root.is-compact .alp-ring-text {
    font-size: 9.5px;
}
/* 窄栏里 40% 的「%」会顶到圆环外沿，只留数字 */
.alp-root.is-compact .alp-ring-text i {
    display: none;
}
.alp-root.is-compact .alp-actions {
    position: absolute;
    right: 4px;
    bottom: 3px;
    margin: 0;
    opacity: 0;
    transition: opacity 0.15s;
}
.alp-root.is-compact .alp-item:hover .alp-actions {
    opacity: 1;
}
.alp-root.is-compact .alp-actions .alp-btn {
    height: 23px;
    padding: 0 8px;
    font-size: 11.5px;
}
.alp-root.is-compact .alp-actions .alp-icon-btn {
    width: 23px;
    height: 23px;
}
.alp-root.is-compact .alp-end,
.alp-root.is-compact .alp-more {
    padding-top: 6px;
}

@media (max-width: 900px) {
    .alp-toolbar {
        flex-wrap: wrap;
        padding: 8px 10px;
    }
    .alp-search {
        flex: 1 1 100%;
    }
    .alp-select-sort {
        display: none;
    }
    .alp-list {
        padding: 6px 8px 4px;
    }
    .alp-cover {
        width: 64px;
        height: 52px;
    }
    .alp-meta {
        gap: 8px;
    }
    /* 手机上只留「作者 + 时间」，浏览 / 评论 / 字数在小屏上只会让那一行折成两排 */
    .alp-meta-item:nth-child(n + 3) {
        display: none;
    }
    .alp-progress {
        width: 34px;
        height: 34px;
    }
}
</style>
