<template>
    <!--
        记事浏览面板（v1.4.0）—— 用在「我的发布 → 笔记」分类
        ----------------------------------------------------------------------------
        需求：在 /post 的「笔记」分类下加载记事管理里的内容，用于日常浏览、快速创建与进入编辑。

        版式刻意做成「卡片墙」而不是列表：记事是文档，标题长短差异大，
        卡片能同时容纳 2 行摘要与日期 / 字数，扫一眼就知道是哪篇；
        点卡片直接跳到 /memo?id=，那边才是真正的编辑环境（三栏工作台）。
    -->
    <div class="mbp-root">
        <div v-if="!list.length && loading" class="mbp-state">
            <font-awesome-icon icon="spinner" spin />
            <span>{{ $t('article.loading') }}</span>
        </div>
        <div v-else-if="!list.length" class="mbp-state">
            <font-awesome-icon icon="file-lines" class="mbp-empty-icon" />
            <p class="mbp-empty-title">{{ $t('postMemo.empty') }}</p>
            <p class="mbp-empty-tip">{{ $t('postMemo.emptyTip') }}</p>
            <button type="button" class="mbp-create" @click="$emit('create')">
                <font-awesome-icon icon="plus" />{{ $t('memo.createNote') }}
            </button>
        </div>

        <template v-else>
            <div class="mbp-grid">
                <button
                    v-for="n in list"
                    :key="n.id"
                    type="button"
                    class="mbp-card"
                    @click="$emit('open', n.id)"
                >
                    <div class="mbp-card-top">
                        <font-awesome-icon icon="file-lines" class="mbp-card-icon" />
                        <span class="mbp-card-title" :title="n.title">{{ n.title || $t('memo.untitled') }}</span>
                    </div>
                    <p class="mbp-card-excerpt">{{ n.excerpt || $t('article.noExcerpt') }}</p>
                    <div class="mbp-card-meta">
                        <span>{{ fmtTime(n.updatedAt) }}</span>
                        <span>{{ $t('article.wordCount', { n: n.wordCount || 0 }) }}</span>
                    </div>
                </button>
            </div>
            <div v-if="hasMore" class="mbp-more">
                <el-button size="small" :loading="loading" @click="loadMore">{{ $t('notes.loadMore') }}</el-button>
            </div>
        </template>
    </div>
</template>

<script>
import { ElMessage } from 'element-plus';
import { fetchNotes, memoError } from '@/utils/memoApi';

const PAGE_SIZE = 48;

export default {
    name: 'MemoBrowsePanel',
    props: {
        /** 外部搜索词（由发布页顶栏输入框驱动） */
        search: { type: String, default: '' },
        instanceId: { type: String, default: '' },
    },
    emits: ['open', 'create', 'changed'],
    data() {
        return {
            list: [],
            total: 0,
            page: 1,
            hasMore: false,
            loading: false,
        };
    },
    watch: {
        search() {
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
            return d.getFullYear() === new Date().getFullYear()
                ? `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
                : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        },
        reload() {
            this.page = 1;
            return this.fetch(true);
        },
        loadMore() {
            if (this.loading || !this.hasMore) return;
            this.page += 1;
            return this.fetch(false);
        },
        async fetch(reset) {
            this.loading = true;
            try {
                const r = await fetchNotes({
                    page: this.page,
                    pageSize: PAGE_SIZE,
                    search: this.search,
                    instanceId: this.instanceId,
                });
                const rows = Array.isArray(r?.list) ? r.list : [];
                this.list = reset ? rows : this.list.concat(rows);
                this.total = Number(r?.total) || 0;
                this.hasMore = this.page * PAGE_SIZE < this.total;
            } catch (e) {
                if (reset) this.list = [];
                ElMessage.error(memoError(e).message || this.$t('article.loadFail'));
            } finally {
                this.loading = false;
            }
        },
    },
};
</script>

<style scoped>
.mbp-root {
    flex: 1 1 auto;
    /* 全站后台有若干处 text-align: center 的继承，这里显式归左，避免列表文字居中 */
    text-align: left;
    min-height: 0;
    overflow: auto;
    padding: 12px 16px 18px;
    overscroll-behavior: contain;
}
.mbp-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 80px 20px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}
.mbp-empty-icon {
    font-size: 30px;
    opacity: 0.35;
}
.mbp-empty-title {
    margin: 4px 0 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-regular);
}
.mbp-empty-tip {
    margin: 0;
    font-size: 12.5px;
    color: var(--el-text-color-placeholder);
}
.mbp-create {
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
.mbp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 10px;
}
.mbp-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 116px;
    padding: 12px 13px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 11px;
    background: var(--el-bg-color);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.mbp-card:hover {
    border-color: var(--el-color-primary-light-5);
    box-shadow: 0 4px 14px rgb(0 0 0 / 6%);
    transform: translateY(-1px);
}
.mbp-card-top {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
}
.mbp-card-icon {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--el-color-primary);
    opacity: 0.85;
}
.mbp-card-title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mbp-card-excerpt {
    margin: 0;
    font-size: 12px;
    line-height: 1.65;
    color: var(--el-text-color-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.mbp-card-meta {
    margin-top: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: var(--el-text-color-placeholder);
}
.mbp-more {
    display: flex;
    justify-content: center;
    padding: 14px 0 4px;
}

@media (max-width: 900px) {
    .mbp-root {
        padding: 10px 10px 16px;
    }
    .mbp-grid {
        grid-template-columns: 1fr;
    }
}
</style>
