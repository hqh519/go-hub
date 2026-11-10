<template>
    <!--
        笔记管理（v1.2.0 首发热身：瞬间）
        ----------------------------------------------------------------------------
        版式对齐「图床文件管理」：
          第一行 = 页面切换下拉 + 实例选择 + 发布按钮
          第二行 = 类型标签页 + 搜索 + 媒体类型 + 排序（**只保留这一处排序**，第一行不放排序，
                   避免两个排序控件互相打架）+ 回收站 + 刷新

        说明：本版只有「瞬间」是实装类型，其余标签页（待办 / 导航 / 文章 / 收集）
        先占位 —— 点进去是空状态 + 一句「该类型尚未开放」，接口用同一个 kind 参数，
        以后实装时不用回头改这里。
    -->
    <div class="nt-page" ref="page">
        <!-- 第一行顶栏 -->
        <header ref="topbarRef" class="nt-topbar" :class="{ 'is-hidden': topbarHidden, 'is-solid': topbarSolid }">
            <div class="nt-topbar-left">
                <DashboardTabs active-tab="notes" />
                <el-select
                    v-if="instances.length"
                    v-model="instanceId"
                    class="nt-instance"
                    size="small"
                    :title="$t('notes.instanceLabel')"
                    @change="onInstanceChange"
                >
                    <el-option :label="$t('notes.instanceDefault')" value="" />
                    <el-option
                        v-for="ins in instances"
                        :key="ins.id"
                        :label="instanceLabel(ins)"
                        :value="ins.id"
                    />
                </el-select>
            </div>
            <div class="nt-topbar-right">
                <button type="button" class="nt-publish-btn" @click="openPublish">
                    <font-awesome-icon icon="plus" class="nt-publish-icon" />
                    <span>{{ $t('notes.publishMoment') }}</span>
                </button>
            </div>
        </header>

        <!-- 第二行工具栏 -->
        <div ref="toolbarRef" class="nt-toolbar" :class="{ 'is-hidden': topbarHidden, 'is-solid': topbarSolid }">
            <div class="nt-types" role="tablist">
                <button
                    v-for="t in typeTabs"
                    :key="t.value"
                    type="button"
                    role="tab"
                    class="nt-type"
                    :class="{ 'is-active': kind === t.value }"
                    :aria-selected="kind === t.value"
                    @click="switchKind(t.value)"
                >{{ $t(t.label) }}</button>
            </div>
            <div class="nt-tools">
                <el-input
                    v-model="search"
                    class="nt-search"
                    size="small"
                    clearable
                    :placeholder="$t('notes.searchPlaceholder')"
                    @keyup.enter="reload"
                    @clear="reload"
                >
                    <template #suffix>
                        <font-awesome-icon icon="search" class="nt-search-icon" @click="reload" />
                    </template>
                </el-input>
                <el-select v-model="mediaKind" class="nt-media" size="small" @change="reload">
                    <el-option :label="$t('notes.mediaAll')" value="" />
                    <el-option :label="$t('notes.mediaText')" value="text" />
                    <el-option :label="$t('notes.mediaImage')" value="image" />
                    <el-option :label="$t('notes.mediaVideo')" value="video" />
                    <el-option :label="$t('notes.mediaAudio')" value="audio" />
                    <el-option :label="$t('notes.mediaMixed')" value="mixed" />
                </el-select>
                <el-select v-model="sortValue" class="nt-sort" size="small" @change="reload">
                    <el-option v-for="s in sortOptions" :key="s.value" :label="$t(s.label)" :value="s.value" />
                </el-select>
                <button
                    type="button"
                    class="nt-icon-btn"
                    :class="{ 'is-on': trashMode }"
                    :title="$t('notes.trash')"
                    @click="toggleTrash"
                >
                    <font-awesome-icon icon="trash-alt" />
                </button>
                <button type="button" class="nt-icon-btn" :title="$t('notes.refresh')" @click="reload">
                    <font-awesome-icon icon="sync" :class="{ 'fa-spin': loading }" />
                </button>
            </div>
        </div>

        <!-- 内容区 -->
        <main class="nt-main">
            <div v-if="loading && !list.length" class="nt-loading">
                <font-awesome-icon icon="spinner" spin />
                <span>{{ $t('notes.loading') }}</span>
            </div>

            <div v-else-if="!list.length" class="nt-empty">
                <font-awesome-icon :icon="emptyIcon" class="nt-empty-icon" />
                <p class="nt-empty-title">{{ emptyTitle }}</p>
                <p class="nt-empty-tip">{{ emptyTip }}</p>
                <button v-if="(!trashMode && kind === '') || kind === 'moment'" type="button" class="nt-empty-btn" @click="openPublish">
                    {{ $t('notes.publishMoment') }}
                </button>
            </div>

            <div v-else class="nt-list">
                <MomentCard
                    v-for="n in list"
                    :key="n.id"
                    :ref="`card-${n.id}`"
                    :note="n"
                    @preview="(i) => openPreview(n, i)"
                    @edit="openEdit"
                    @delete="confirmDelete"
                    @restore="confirmRestore"
                    @purge="confirmPurge"
                    @tag-click="onTagClick"
                />
            </div>

            <div v-if="list.length" class="nt-more">
                <el-button v-if="hasMore" size="small" :loading="loading" @click="loadMore">
                    {{ $t('notes.loadMore') }}
                </el-button>
                <span v-else class="nt-end">{{ $t('notes.listEnd', { n: total }) }}</span>
            </div>
        </main>

        <!-- 发布 / 编辑 -->
        <MomentPublishDialog
            v-model="publishVisible"
            :note="editing"
            :instance-id="instanceId"
            @saved="onSaved"
        />

        <!-- 附件灯箱：一屏 9 个只是列表形态，这里能翻完该瞬间的全部附件 -->
        <MediaPreviewOverlay
            v-if="previewItems.length"
            v-model="previewVisible"
            :items="previewItems"
            :start-index="previewIndex"
        />
    </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import DashboardTabs from '@/components/DashboardTabs.vue';
import MediaPreviewOverlay from '@/components/dashboard/MediaPreviewOverlay.vue';
import MomentCard from '@/components/notes/MomentCard.vue';
import MomentPublishDialog from '@/components/notes/MomentPublishDialog.vue';
import { extOf, formatSize } from '@/utils/notes';

const PAGE_SIZE = 20;
/** 滚动遮挡顶栏的判定阈值 */
const SCROLL_HIDE_PX = 60;

export default {
    name: 'NotesManagePage',
    components: { DashboardTabs, MediaPreviewOverlay, MomentCard, MomentPublishDialog },
    data() {
        return {
            kind: '',
            mediaKind: '',
            // 标签筛选（点卡片上的 #标签 触发）
            tagId: '',
            tagName: '',
            search: '',
            // 排序：只保留第二行这一处（第一行不放排序，避免两套控件打架）
            sortKey: 'createdAt',
            sortOrder: 'desc',
            trashMode: false,
            instanceId: '',
            instances: [],
            list: [],
            total: 0,
            page: 1,
            loading: false,
            publishVisible: false,
            editing: null,
            previewVisible: false,
            previewItems: [],
            previewIndex: 0,
            topbarHidden: false,
            topbarSolid: false,
            lastScrollTop: 0,
            topRO: null
        };
    },
    computed: {
        typeTabs() {
            return [
                { value: '', label: 'notes.typeAll' },
                { value: 'moment', label: 'notes.typeMoment' },
                { value: 'todo', label: 'notes.typeTodo' },
                { value: 'nav', label: 'notes.typeNav' },
                { value: 'article', label: 'notes.typeArticle' },
                { value: 'collection', label: 'notes.typeCollection' }
            ];
        },
        sortOptions() {
            return [
                { value: 'newest', label: 'notes.sortNewest' },
                { value: 'oldest', label: 'notes.sortOldest' },
                { value: 'updated', label: 'notes.sortUpdated' }
            ];
        },
        sortValue: {
            get() {
                return `${this.sortKey === 'updatedAt' ? 'updated' : this.sortOrder === 'asc' ? 'oldest' : 'newest'}`;
            },
            set(v) {
                if (v === 'oldest') {
                    this.sortKey = 'createdAt';
                    this.sortOrder = 'asc';
                } else if (v === 'updated') {
                    this.sortKey = 'updatedAt';
                    this.sortOrder = 'desc';
                } else {
                    this.sortKey = 'createdAt';
                    this.sortOrder = 'desc';
                }
            }
        },
        hasMore() {
            return this.list.length < this.total;
        },
        emptyIcon() {
            if (this.trashMode) return 'trash-alt';
            if (this.kind && this.kind !== 'moment') return 'inbox';
            return 'book';
        },
        emptyTitle() {
            if (this.trashMode) return this.$t('notes.trashEmpty');
            if (this.kind && this.kind !== 'moment') return this.$t('notes.typeNotReady');
            if (this.search || this.mediaKind) return this.$t('notes.noMatch');
            return this.$t('notes.emptyTitle');
        },
        emptyTip() {
            if (this.kind && this.kind !== 'moment' && !this.trashMode) return this.$t('notes.typeNotReadyTip');
            return this.$t('notes.emptyTip');
        }
    },
    created() {
        this.instanceId = this.readInstanceId();
    },
    async mounted() {
        window.addEventListener('scroll', this.onPageScroll, true);
        window.addEventListener('resize', this.onWindowResize);
        this.resizeBound = true;
        this.syncTopHeights();
        // 顶栏 / 工具栏高度会随内容变化（实例下拉出现、类型标签换行、手机上工具行换行），
        // 用 ResizeObserver 盯着，比在十几个地方手动调 syncTopHeights 靠谱。
        if (typeof ResizeObserver !== 'undefined') {
            this.topRO = new ResizeObserver(() => this.syncTopHeights());
            if (this.$refs.topbarRef) this.topRO.observe(this.$refs.topbarRef);
            if (this.$refs.toolbarRef) this.topRO.observe(this.$refs.toolbarRef);
        }
        await this.loadInstances();
        await this.reload();
        this.syncTopHeights();
    },
    beforeUnmount() {
        window.removeEventListener('scroll', this.onPageScroll, true);
        if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
        this.resizeBound && window.removeEventListener('resize', this.onWindowResize);
        if (this.topRO) { this.topRO.disconnect(); this.topRO = null; }
    },
    methods: {
        /* ── 实例 ───────────────────────────────────────────────── */
        readInstanceId() {
            try {
                return localStorage.getItem('gohub_instance_id') || '';
            } catch (e) {
                return '';
            }
        },
        async loadInstances() {
            try {
                const res = await fetchWithAuth('/api/instances');
                const data = await res.json().catch(() => []);
                this.instances = Array.isArray(data) ? data : [];
            } catch (e) {
                this.instances = [];
            }
        },
        instanceLabel(ins) {
            const idx = Number(ins.index) || 0;
            return idx > 0 ? this.$t('localFiles.instanceWithIndex', { name: ins.name, index: idx }) : ins.name;
        },
        onInstanceChange() {
            // 与「图床文件管理」共用同一个存储键 —— 在这里切实例，文件管理页也跟着切
            try {
                localStorage.setItem('gohub_instance_id', this.instanceId || '');
            } catch (e) {
                /* 忽略隐私模式写入失败 */
            }
            this.reload();
        },

        /* ── 列表 ───────────────────────────────────────────────── */
        switchKind(v) {
            if (this.kind === v) return;
            this.kind = v;
            this.reload();
        },
        toggleTrash() {
            this.trashMode = !this.trashMode;
            this.reload();
        },
        onTagClick(tag) {
            // 点标签 = 按标签筛选；再点同一个标签 = 取消筛选
            this.search = '';
            this.mediaKind = '';
            if (this.tagId === tag.id) {
                this.tagId = '';
                this.tagName = '';
            } else {
                this.tagId = tag.id;
                this.tagName = tag.name;
            }
            this.page = 1;
            return this.fetchList(true);
        },
        buildQuery() {
            const qs = new URLSearchParams();
            qs.set('page', String(this.page));
            qs.set('pageSize', String(PAGE_SIZE));
            qs.set('instanceId', this.instanceId || '');
            qs.set('sort', this.sortKey);
            qs.set('order', this.sortOrder);
            if (this.kind) qs.set('kind', this.kind);
            if (this.mediaKind) qs.set('mediaKind', this.mediaKind);
            if (this.search.trim()) qs.set('search', this.search.trim());
            if (this.tagId) qs.set('tagId', this.tagId);
            if (this.trashMode) qs.set('status', 'deleted');
            return qs;
        },
        reload() {
            this.page = 1;
            this.tagId = '';
            this.tagName = '';
            return this.fetchList(true);
        },
        loadMore() {
            if (this.loading || !this.hasMore) return;
            this.page += 1;
            return this.fetchList(false);
        },
        async fetchList(reset) {
            this.loading = true;
            try {
                const qs = this.buildQuery();
                const res = await fetchWithAuth(`/api/notes/list?${qs.toString()}`);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || 'load failed');
                const rows = Array.isArray(data.list) ? data.list : [];
                this.total = Number(data.total) || 0;
                this.list = reset ? rows : this.list.concat(rows);
            } catch (e) {
                this.$message.error(this.$t('notes.loadFail'));
            } finally {
                this.loading = false;
            }
        },
        /* ── 发布 / 编辑 ────────────────────────────────────────── */
        openPublish() {
            this.editing = null;
            this.publishVisible = true;
        },
        openEdit(note) {
            this.editing = note;
            this.publishVisible = true;
        },
        onSaved() {
            this.reload();
        },

        /* ── 删除 / 恢复 / 彻底删除 ─────────────────────────────── */
        async confirmDelete(note) {
            try {
                await this.$confirm(this.$t('notes.deleteConfirm'), this.$t('notes.deleteTitle'), {
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    type: 'warning'
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(`/api/notes/${encodeURIComponent(note.id)}`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('notes.deletedOk'));
                this.reload();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },
        async confirmRestore(note) {
            try {
                const res = await fetchWithAuth(`/api/notes/${encodeURIComponent(note.id)}/restore`, { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('notes.restoredOk'));
                this.reload();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },
        async confirmPurge(note) {
            try {
                await this.$confirm(this.$t('notes.purgeConfirm'), this.$t('notes.purge'), {
                    confirmButtonText: this.$t('notes.purge'),
                    cancelButtonText: this.$t('common.cancel'),
                    type: 'error'
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(`/api/notes/${encodeURIComponent(note.id)}/purge`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('notes.purgedOk'));
                this.reload();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },

        /* ── 灯箱 ───────────────────────────────────────────────── */
        openPreview(note, index) {
            const assets = (note.assets || []).filter(Boolean);
            if (!assets.length) return;
            this.previewItems = assets.map((a) => ({
                key: a.fileId,
                name: a.originalName || a.name,
                url: a.url,
                kind: a.mediaKind === 'file' ? 'other' : a.mediaKind,
                ext: extOf(a.originalName || a.name),
                sizeText: formatSize(a.size),
                user: '',
                recordId: ''
            }));
            this.previewIndex = Math.min(index, this.previewItems.length - 1);
            this.previewVisible = true;
        },

        /* ── 顶栏吸顶 ───────────────────────────────────────────── */
        onPageScroll() {
            const top = window.scrollY || document.documentElement.scrollTop || 0;
            this.topbarSolid = top > 8;
            if (top > SCROLL_HIDE_PX && top > this.lastScrollTop + 6) {
                this.topbarHidden = true;
            } else if (top < this.lastScrollTop - 6 || top < 40) {
                this.topbarHidden = false;
            }
            this.lastScrollTop = top;
        },
        /**
         * 把两行固定栏的实测高度写进 --nt-topbar-h / --nt-toolbar-h。
         * 内容区留白与第二行的 top 都取这两个值，改布局就只剩一处要维护。
         */
        syncTopHeights() {
            const root = this.$el;
            if (!root || !root.style) return;
            const topH = this.$refs.topbarRef ? this.$refs.topbarRef.offsetHeight : 0;
            const toolH = this.$refs.toolbarRef ? this.$refs.toolbarRef.offsetHeight : 0;
            if (topH) root.style.setProperty('--nt-topbar-h', `${topH}px`);
            if (toolH) root.style.setProperty('--nt-toolbar-h', `${toolH}px`);
        },
        onWindowResize() {
            this.syncTopHeights();
            if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
            this.resizeTimer = window.setTimeout(() => {
                // 宽度变化 → 行高与换行都会变，重新判定每张卡的「全文」按钮
                for (const key of Object.keys(this.$refs || {})) {
                    if (!key.startsWith('card-')) continue;
                    const ref = this.$refs[key];
                    const card = Array.isArray(ref) ? ref[0] : ref;
                    if (card && typeof card.measure === 'function') card.measure();
                }
            }, 200);
        }
    }
};
</script>

<style scoped>
.nt-page {
    box-sizing: border-box;
    min-height: 100vh;
    /*
     * 顶部两行都是 fixed，高度会随「实例下拉 / 类型标签 / 工具行换行」变化，
     * 所以留白不写死，由 syncTopHeights() 把实测高度写进这两个自定义属性。
     */
    padding-top: calc(var(--nt-topbar-h, 60px) + var(--nt-toolbar-h, 44px) + 8px);
    background: var(--note-page-bg, transparent);
    /*
     * 全局 #app 上有一条历史遗留的 `text-align: center`（图床首页居中标题用），
     * 会被继承下来把瞬间正文也居中 —— 正文必须是左对齐，这里在页面根部复位一次。
     * 不去改 #app 本身：那条样式还被前台首页依赖，动它风险大于收益。
     */
    text-align: left;
}

/* ── 第一行 ─────────────────────────────────────────────── */
.nt-topbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 8px 16px;
    background: var(--glass-bg);
    border-bottom: 1px solid var(--glass-border);
    backdrop-filter: blur(var(--glass-backdrop-blur, 10px));
    -webkit-backdrop-filter: blur(var(--glass-backdrop-blur, 10px));
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.nt-topbar.is-solid {
    background: var(--toolbar-solid-bg, #FAFAFB);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
}

.nt-topbar.is-hidden {
    transform: translateY(-100%);
}

/*
 * 第二行在第一行下面，只上移自身高度的话会停在第一行原来的位置露出来 ——
 * 必须把第一行的高度一起减掉，两行才会整体滑出屏幕。
 */
.nt-toolbar.is-hidden {
    transform: translateY(calc(-1 * var(--nt-topbar-h, 60px) - 100%));
}

.nt-topbar-left,
.nt-topbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: wrap;
}

.nt-instance {
    width: 150px;
}

.nt-publish-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border: none;
    border-radius: 9px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: filter 0.15s ease;
}

.nt-publish-btn:hover {
    filter: brightness(1.08);
}

.nt-publish-icon {
    font-size: 12px;
}

/* ── 第二行工具栏 ───────────────────────────────────────── */
.nt-toolbar {
    position: fixed;
    top: var(--nt-topbar-h, 60px);
    left: 0;
    right: 0;
    z-index: 39;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    padding: 6px 16px 8px;
    background: var(--glass-bg);
    border-bottom: 1px solid var(--glass-border);
    backdrop-filter: blur(var(--glass-backdrop-blur, 10px));
    -webkit-backdrop-filter: blur(var(--glass-backdrop-blur, 10px));
}

.nt-types {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: 10px;
    background: var(--note-tabs-bg, rgba(127, 127, 127, 0.1));
    overflow-x: auto;
    max-width: 100%;
    scrollbar-width: none;
}

.nt-types::-webkit-scrollbar {
    display: none;
}

.nt-type {
    padding: 4px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 13px;
    font-family: inherit;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.18s ease, color 0.18s ease;
}

.nt-type:hover {
    color: var(--el-color-primary);
}

.nt-type.is-active {
    background: var(--note-tab-active-bg, #fff);
    color: var(--el-color-primary);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.nt-tools {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
}

.nt-search {
    width: 190px;
}

.nt-search-icon {
    cursor: pointer;
    opacity: 0.6;
}

.nt-media {
    width: 108px;
}

.nt-sort {
    width: 118px;
}

.nt-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 12px;
    cursor: pointer;
}

.nt-icon-btn:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary);
}

.nt-icon-btn.is-on {
    color: #fff;
    background: var(--el-color-danger);
    border-color: var(--el-color-danger);
}

/* ── 内容 ───────────────────────────────────────────────── */
.nt-main {
    box-sizing: border-box;
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    padding: 14px 16px 40px;
}

.nt-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.nt-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 80px 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

.nt-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 80px 10px;
    text-align: center;
}

.nt-empty-icon {
    font-size: 34px;
    color: var(--el-text-color-placeholder);
    margin-bottom: 6px;
}

.nt-empty-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--el-text-color-regular);
}

.nt-empty-tip {
    margin: 0;
    font-size: 12.5px;
    color: var(--el-text-color-secondary);
    max-width: 420px;
    line-height: 1.7;
}

.nt-empty-btn {
    margin-top: 10px;
    padding: 7px 16px;
    border: 1px solid var(--el-color-primary);
    border-radius: 9px;
    background: transparent;
    color: var(--el-color-primary);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
}

.nt-empty-btn:hover {
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.1));
}

.nt-more {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px 0 6px;
}

.nt-end {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

/* ── 移动端 ─────────────────────────────────────────────── */
@media (max-width: 768px) {
    .nt-topbar {
        padding: 6px 8px;
        gap: 6px;
        flex-wrap: nowrap;
    }

    .nt-topbar-left {
        flex: 1 1 auto;
        flex-wrap: nowrap;
        overflow: hidden;
    }

    .nt-instance {
        width: 110px;
    }

    .nt-publish-btn span {
        display: none;
    }

    .nt-publish-btn {
        padding: 7px 10px;
    }

    .nt-toolbar {
        padding: 6px 8px;
        gap: 6px;
    }

    .nt-types {
        flex: 1 1 100%;
        max-width: 100%;
    }

    /*
     * 手机上一行放不下 4 个控件。原来是横向滚动 —— 回收站 / 刷新被推到屏幕外，
     * 用户根本不知道有这个功能。这里用固定两行的网格，位置完全确定：
     *   第一行：搜索（占两列）        + 回收站 + 刷新
     *   第二行：媒体类型（占一半）    + 排序
     */
    .nt-tools {
        flex: 1 1 100%;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto;
        gap: 6px;
        overflow: visible;
    }

    .nt-search {
        grid-column: 1 / 3;
        grid-row: 1;
        width: auto;
        min-width: 0;
    }

    .nt-tools > .nt-icon-btn:first-of-type {
        grid-column: 3;
        grid-row: 1;
    }

    .nt-tools > .nt-icon-btn:last-of-type {
        grid-column: 4;
        grid-row: 1;
    }

    .nt-media {
        grid-column: 1 / 2;
        grid-row: 2;
        width: auto;
        min-width: 0;
    }

    .nt-sort {
        grid-column: 2 / 5;
        grid-row: 2;
        width: auto;
        min-width: 0;
    }

    .nt-main {
        padding: 10px 8px 30px;
    }

    .nt-list {
        gap: 8px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .nt-topbar {
        transition: none;
    }
}
</style>
