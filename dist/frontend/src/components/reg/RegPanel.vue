<template>
    <!--
        v1.3.5.10 登记流水账（/post → 登记类目）
        ----------------------------------------------------------------------------
        以「流水账」方式按发生时间倒序显示；支持按条目 / 标签 / 时间范围 / 关键词筛选。
        卡片结构与瞬间内容区对齐：
          · 时间行 → 条目行（@条目 + 上次金额 / 天数）→ 标题 → 详情（超出显示「全文」）
            → 附件缩略图（超出一行显示 +N，点开系统灯箱）→ 标签行（行末「更多」菜单）；
          · 编辑 / 删除收进「更多」菜单，不再常驻两个按钮。
    -->
    <section class="reg-panel">
        <div class="reg-toolbar">
            <el-select
                v-model="filterTracker"
                size="small"
                clearable
                filterable
                class="reg-filter-marker"
                :placeholder="$t('reg.allMarkers')"
            >
                <el-option v-for="t in trackers" :key="t.id" :label="t.name" :value="t.name">
                    <span class="reg-opt-name">{{ t.name }}</span>
                    <span class="reg-opt-count">{{ t.count }}</span>
                </el-option>
            </el-select>
            <!-- v1.3.5.10：标签筛选入口（后端早就支持 tag 参数，一直没接界面） -->
            <el-select
                v-model="filterTag"
                size="small"
                clearable
                filterable
                class="reg-filter-tag"
                :placeholder="$t('reg.legendTagsPh')"
            >
                <el-option v-for="t in tagOptions" :key="t" :label="t" :value="t" />
            </el-select>
            <el-select v-model="range" size="small" class="reg-filter-range">
                <el-option :label="$t('reg.rangeAll')" value="all" />
                <el-option :label="$t('reg.rangeMonth')" value="month" />
                <el-option :label="$t('reg.rangeYear')" value="year" />
            </el-select>
            <el-input
                v-model="keyword"
                size="small"
                clearable
                class="reg-filter-kw"
                :placeholder="$t('reg.searchPh')"
                @keyup.enter="reload(1)"
            >
                <template #prefix><font-awesome-icon icon="search" class="reg-kw-icon" /></template>
            </el-input>
            <!-- v1.3.7：刷新按钮移除（顶栏已有刷新，避免重复） -->
            <!-- v1.3.6：导入 / 下载模板移除，原位置改为导出当前实例的登记数据 -->
            <el-button v-if="!trashMode" size="small" :loading="exporting" @click="exportCsv">
                <font-awesome-icon icon="download" class="reg-add-icon" />{{ $t('reg.export') }}
            </el-button>
        </div>

        <div v-if="trashMode" class="reg-trash-banner" role="status">
            <font-awesome-icon icon="trash-alt" class="reg-trash-icon" />
            <span>{{ $t('reg.trashBanner') }}</span>
        </div>

        <div v-loading="loading" class="reg-list">
            <div v-if="!loading && !list.length" class="reg-empty">
                <font-awesome-icon icon="clipboard-list" class="reg-empty-icon" />
                <p>{{ $t('reg.empty') }}</p>
            </div>
            <article v-for="item in list" :key="item.id" class="reg-item">
                <div class="reg-item-main">
                    <div class="reg-item-head">
                        <span class="reg-item-time">{{ fmtTime(item.occurredAt) }}</span>
                        <span v-if="item.placeName" class="reg-item-place">
                            <font-awesome-icon icon="location-dot" />{{ item.placeName }}
                        </span>
                        <span class="reg-item-amount" :class="amountClass(item)">{{ fmtAmount(item) }}</span>
                    </div>

                    <!-- v1.3.5.10：条目挪到时间行的下一行，并带上「上次 … / … 天前」 -->
                    <!-- v1.3.6：点条目前往 /reg?tracker=条目名（新标签页）；不加粗 -->
                    <div class="reg-item-sub">
                        <a
                            v-if="!trashMode"
                            class="reg-item-marker"
                            :href="regUrl(item)"
                            target="_blank"
                            rel="noopener"
                        >@{{ item.trackerName }}</a>
                        <span v-else class="reg-item-marker">@{{ item.trackerName }}</span>
                        <span v-if="!trashMode && item.prev" class="reg-item-prev">
                            ({{ $t('reg.lastTime', { amount: fmtPrev(item), days: prevDays(item) }) }})
                        </span>
                    </div>

                    <p v-if="item.title" class="reg-item-title">{{ item.title }}</p>

                    <!-- 详情：超过高度显示「全文」，点开变「收起」（同瞬间内容区） -->
                    <div
                        v-if="item.event"
                        class="reg-item-event-wrap"
                        :class="{ 'is-clamped': !expanded[item.id] && overflow[item.id] }"
                    >
                        <p
                            :ref="'ev-' + item.id"
                            class="reg-item-event"
                            :class="{ 'is-clamped': !expanded[item.id] }"
                        >{{ item.event }}</p>
                        <button
                            v-if="overflow[item.id] || expanded[item.id]"
                            type="button"
                            class="reg-full-toggle"
                            @click="toggleFull(item)"
                        >{{ expanded[item.id] ? $t('notes.collapse') : $t('notes.showFull') }}</button>
                    </div>

                    <!-- 附件缩略图：桌面一行 10 个、移动 6 个，最后一个叠 +N -->
                    <div v-if="visibleFiles(item).length" class="reg-item-files">
                        <button
                            v-for="(f, fi) in visibleFiles(item)"
                            :key="f.fileId + '-' + fi"
                            type="button"
                            class="reg-item-file"
                            :title="f.originalName || f.name || ''"
                            @click.stop="openPreview(item, fi)"
                        >
                            <img
                                v-if="posterOf(f)"
                                :src="posterOf(f)"
                                class="reg-item-file-img"
                                :class="{ 'is-contain': f.mediaKind === 'video' }"
                                alt=""
                                loading="lazy"
                            />
                            <span v-else class="reg-item-file-cover">
                                <font-awesome-icon :icon="fileIcon(f.mediaKind)" />
                            </span>
                            <span v-if="f.mediaKind === 'video'" class="reg-item-file-play">
                                <font-awesome-icon icon="play" />
                            </span>
                            <span
                                v-if="hiddenCount(item) && fi === visibleFiles(item).length - 1"
                                class="reg-item-file-more"
                            >+{{ hiddenCount(item) }}</span>
                        </button>
                    </div>

                    <!-- 标签行：复用瞬间的胶囊样式，点标签直接筛选；末尾「更多」菜单 -->
                    <div class="reg-item-meta">
                        <span v-if="item.subjectName">{{ $t('reg.fieldSubject') }}：{{ item.subjectName }}</span>
                        <span v-if="item.relatedName">{{ $t('reg.fieldRelated') }}：{{ item.relatedName }}</span>
                        <span v-if="item.tags && item.tags.length" class="reg-item-tags">
                            <button
                                v-for="t in item.tags"
                                :key="t"
                                type="button"
                                class="reg-tag"
                                @click.stop="filterByTag(t)"
                            >#{{ t }}</button>
                        </span>
                        <el-dropdown
                            trigger="click"
                            placement="top-end"
                            class="reg-more"
                            @command="(cmd) => onCommand(cmd, item)"
                        >
                            <button type="button" class="reg-act reg-more-btn" :title="$t('notes.more')" @click.stop>
                                <font-awesome-icon icon="ellipsis-h" />
                            </button>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <template v-if="trashMode">
                                        <el-dropdown-item command="restore">
                                            <font-awesome-icon icon="undo" class="reg-menu-icon" />{{ $t('notes.restore') }}
                                        </el-dropdown-item>
                                        <el-dropdown-item command="purge" divided>
                                            <font-awesome-icon icon="trash" class="reg-menu-icon is-danger" />{{ $t('notes.purge') }}
                                        </el-dropdown-item>
                                    </template>
                                    <template v-else>
                                        <el-dropdown-item command="edit">
                                            <font-awesome-icon icon="pen-to-square" class="reg-menu-icon" />{{ $t('notes.edit') }}
                                        </el-dropdown-item>
                                        <el-dropdown-item command="delete" divided>
                                            <font-awesome-icon icon="trash" class="reg-menu-icon is-danger" />{{ $t('notes.delete') }}
                                        </el-dropdown-item>
                                    </template>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>
                    </div>
                </div>
            </article>
        </div>

        <div v-if="total > pageSize" class="reg-pager">
            <el-button size="small" :disabled="page <= 1" @click="reload(page - 1)">{{ $t('reg.prev') }}</el-button>
            <span class="reg-pager-info">{{ page }} / {{ Math.ceil(total / pageSize) }}（{{ total }}）</span>
            <el-button size="small" :disabled="page >= Math.ceil(total / pageSize)" @click="reload(page + 1)">{{ $t('reg.next') }}</el-button>
        </div>

        <!-- 系统灯箱：与瞬间内容区同一个组件（右上角详情、移动端下滑进详情） -->
        <MediaPreviewOverlay
            v-if="previewItems.length"
            v-model="previewVisible"
            :items="previewItems"
            :start-index="previewIndex"
            :show-detail="true"
            :record-detail="true"
            :detail-open="detailVisible"
            @detail="openFileDetail"
            @record-detail="openFileDetail"
            @close-detail="detailVisible = false"
        />

        <FileDetailDialog
            v-model="detailVisible"
            :file="detailFile"
            :file-link="detailFileLink"
            :urls="detailUrls"
            @download="onDetailDownload"
            @delete="onDetailDelete"
            @metadata-updated="onDetailMetadata"
        />

        <RegEntryDialog
            v-model="dialogVisible"
            :instance-id="instanceId"
            :entry="editing"
            @saved="onSaved"
        />
    </section>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import RegEntryDialog from './RegEntryDialog.vue';
import MediaPreviewOverlay from '@/components/dashboard/MediaPreviewOverlay.vue';
import FileDetailDialog from '@/components/dashboard/FileDetailDialog.vue';
import { extOf, formatSize } from '@/utils/notes';
import { buildFileDetail } from '@/utils/fileDetail';
import { videoPoster } from '@/utils/videoPoster';

export default {
    name: 'RegPanel',
    components: { RegEntryDialog, MediaPreviewOverlay, FileDetailDialog },
    props: {
        instanceId: { type: String, default: '' },
        /* v1.3.6：回收站模式（只列已删除，操作改为恢复 / 彻底删除） */
        trashMode: { type: Boolean, default: false },
    },
    emits: ['changed'],
    data() {
        return {
            list: [],
            trackers: [],
            tagOptions: [],
            total: 0,
            page: 1,
            pageSize: 20,
            loading: false,
            filterTracker: '',
            filterTag: '',
            range: 'all',
            keyword: '',
            dialogVisible: false,
            editing: null,
            exporting: false,
            /* 一行最多几个附件：桌面 10 / 移动 6（尺寸不变，超出叠 +N） */
            narrow: false,
            /* 视频首帧：fileId → dataURL */
            posters: {},
            /* 详情「全文 / 收起」：按条目 id 记 */
            expanded: {},
            overflow: {},
            /* 灯箱 */
            previewVisible: false,
            previewItems: [],
            previewIndex: 0,
            /* 文件详情 */
            detailVisible: false,
            detailFile: null,
            detailFileLink: '',
            detailUrls: null,
        };
    },
    computed: {
        maxFiles() {
            return this.narrow ? 6 : 10;
        },
    },
    watch: {
        instanceId() { this.reload(1); this.loadTrackers(); this.loadTags(); },
        trashMode() { this.reload(1); },
        filterTracker() { this.reload(1); },
        filterTag() { this.reload(1); },
        range() { this.reload(1); },
    },
    mounted() {
        this.syncNarrow();
        window.addEventListener('resize', this.syncNarrow);
        this.reload(1);
        this.loadTrackers();
        this.loadTags();
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.syncNarrow);
    },
    methods: {
        syncNarrow() {
            this.narrow = typeof window !== 'undefined' && window.innerWidth <= 768;
        },
        fileIcon(kind) {
            if (kind === 'video') return 'film';
            if (kind === 'audio') return 'music';
            return 'file';
        },
        /** 图片直接用后端缩略图；视频用浏览器抽的首帧 */
        posterOf(f) {
            if (!f) return '';
            if (f.mediaKind === 'image') return f.thumbUrl || f.url || '';
            if (f.mediaKind === 'video') return this.posters[f.fileId] || '';
            return '';
        },
        /** 列表里的视频抽首帧（按 fileId 缓存，抽不到就显示胶片图标） */
        loadPosters() {
            const seen = new Set();
            for (const item of this.list) {
                for (const f of item.attachmentViews || []) {
                    if (f.mediaKind !== 'video' || this.posters[f.fileId] || seen.has(f.fileId)) continue;
                    seen.add(f.fileId);
                    videoPoster(f.url).then((dataUrl) => {
                        if (dataUrl) this.posters = { ...this.posters, [f.fileId]: dataUrl };
                    }).catch(() => {});
                }
            }
        },
        /** 一行只放 maxFiles 个，剩下的在最后一格叠 +N */
        visibleFiles(item) {
            return ((item && item.attachmentViews) || []).slice(0, this.maxFiles);
        },
        hiddenCount(item) {
            const n = ((item && item.attachmentViews) || []).length;
            return n > this.maxFiles ? n - this.maxFiles : 0;
        },
        rangeQuery() {
            const now = new Date();
            if (this.range === 'month') {
                return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime() };
            }
            if (this.range === 'year') {
                return { from: new Date(now.getFullYear(), 0, 1).getTime() };
            }
            return {};
        },
        async loadTags() {
            try {
                const qs = new URLSearchParams({ instanceId: this.instanceId || '' });
                const res = await fetchWithAuth(`/api/reg/tag-candidates?${qs.toString()}`);
                const data = await res.json().catch(() => []);
                this.tagOptions = Array.isArray(data) ? data : [];
            } catch (e) {
                this.tagOptions = [];
            }
        },
        async loadTrackers() {
            try {
                const qs = new URLSearchParams({ instanceId: this.instanceId || '' });
                const res = await fetchWithAuth(`/api/reg/trackers?${qs.toString()}`);
                const data = await res.json().catch(() => []);
                this.trackers = Array.isArray(data) ? data : [];
            } catch (e) {
                this.trackers = [];
            }
        },
        async reload(page) {
            this.loading = true;
            this.page = Math.max(1, Number(page) || 1);
            try {
                const qs = new URLSearchParams({
                    instanceId: this.instanceId || '',
                    page: String(this.page),
                    pageSize: String(this.pageSize),
                });
                if (this.trashMode) qs.set('trash', '1');
                if (this.filterTracker) qs.set('trackerName', this.filterTracker);
                if (this.filterTag) qs.set('tag', this.filterTag);
                if (this.keyword.trim()) qs.set('keyword', this.keyword.trim());
                const rq = this.rangeQuery();
                if (rq.from) qs.set('from', String(rq.from));
                const res = await fetchWithAuth(`/api/reg/entries?${qs.toString()}`);
                const data = await res.json().catch(() => ({}));
                this.list = Array.isArray(data.list) ? data.list : [];
                this.total = Number(data.total) || 0;
                this.$nextTick(() => {
                    this.measureEvents();
                    this.loadPosters();
                });
            } catch (e) {
                this.list = [];
                this.total = 0;
            } finally {
                this.loading = false;
            }
        },
        /**
         * 「全文」判定：折叠态下量 scrollHeight 与 max-height。
         * 量不到布局（还没渲染）时不动结论，避免刷新瞬间把所有卡片都标成溢出。
         */
        measureEvents() {
            const rows = this.list || [];
            const next = { ...this.overflow };
            for (const item of rows) {
                if (this.expanded[item.id]) continue;
                const el = this.$refs['ev-' + item.id];
                const node = Array.isArray(el) ? el[0] : el;
                if (!node || !node.clientHeight) continue;
                next[item.id] = node.scrollHeight > node.clientHeight + 2;
            }
            this.overflow = next;
        },
        toggleFull(item) {
            this.expanded = { ...this.expanded, [item.id]: !this.expanded[item.id] };
            this.$nextTick(this.measureEvents);
        },
        openEdit(item) {
            this.editing = item;
            this.dialogVisible = true;
        },
        onCommand(cmd, item) {
            if (cmd === 'edit') this.openEdit(item);
            else if (cmd === 'delete') this.remove(item);
            else if (cmd === 'restore') this.restore(item);
            else if (cmd === 'purge') this.purge(item);
        },
        /** v1.3.6：删除 = 移入回收站（软删除） */
        async remove(item) {
            try {
                await this.$confirm(this.$t('reg.trashConfirm'), this.$t('common.delete'), {
                    type: 'warning',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(`/api/reg/entries/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('reg.trashOk'));
                this.reload(this.page);
                this.loadTrackers();
                this.$emit('changed');
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },
        /** v1.3.6：从回收站恢复 */
        async restore(item) {
            try {
                const res = await fetchWithAuth(`/api/reg/entries/${encodeURIComponent(item.id)}/restore`, { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('reg.restoreOk'));
                this.reload(this.page);
                this.$emit('changed');
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },
        /** v1.3.6：彻底删除（不可恢复） */
        async purge(item) {
            try {
                await this.$confirm(this.$t('reg.purgeConfirm'), this.$t('notes.purge'), {
                    type: 'warning',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(`/api/reg/entries/${encodeURIComponent(item.id)}/purge`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('reg.purgeOk'));
                this.reload(this.page);
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },
        /** v1.3.6：导出当前实例的登记数据（17 列 CSV） */
        async exportCsv() {
            this.exporting = true;
            try {
                const qs = new URLSearchParams({ instanceId: this.instanceId || '' });
                const res = await fetchWithAuth(`/api/reg/export?${qs.toString()}`);
                if (!res.ok) throw new Error(this.$t('common.failed'));
                const text = await res.text();
                const body = text.includes('\n') && text.indexOf('\n') > 2 ? text : `${text}\r\n`;
                const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const d = new Date();
                const pad = (n) => String(n).padStart(2, '0');
                const a = document.createElement('a');
                a.href = url;
                a.download = `登记数据-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 2000);
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            } finally {
                this.exporting = false;
            }
        },
        /** 条目名 → /reg?tracker=名称（新标签页） */
        regUrl(item) {
            const name = String((item && item.trackerName) || '');
            try {
                return this.$router.resolve({ path: '/reg', query: { tracker: name } }).href;
            } catch (e) {
                return `/reg?tracker=${encodeURIComponent(name)}`;
            }
        },
        /** 点标签 = 按标签筛选 */
        filterByTag(tag) {
            this.filterTag = String(tag || '');
            this.reload(1);
        },
        /* ── 灯箱 / 文件详情（与瞬间内容区同口径） ── */
        openPreview(item, index) {
            const files = (item.attachmentViews || []).filter(Boolean);
            if (!files.length) return;
            this.previewItems = files.map((a) => ({
                key: a.name || a.fileId,
                name: a.originalName || a.name,
                url: a.url,
                kind: a.mediaKind === 'file' ? 'other' : a.mediaKind,
                ext: extOf(a.originalName || a.name),
                sizeText: formatSize(a.size),
                user: '',
                recordId: a.fileId || '',
            }));
            this.previewIndex = Math.min(index, this.previewItems.length - 1);
            this.previewVisible = true;
        },
        applyDetailFile(file) {
            const built = buildFileDetail(file);
            this.detailFile = built.file;
            this.detailFileLink = built.fileLink;
            this.detailUrls = built.urls;
        },
        async openFileDetail(payload) {
            const key = (payload && (payload.key || payload.name)) || '';
            if (!key) return;
            this.applyDetailFile({ name: key, metadata: {} });
            this.detailVisible = true;
            try {
                const res = await fetchWithAuth(`/api/manage/metadata/${encodeURIComponent(key)}`);
                const json = await res.json().catch(() => ({}));
                const data = (json && json.data) || {};
                if (data.metadata) this.applyDetailFile({ name: data.name || key, metadata: data.metadata });
            } catch (e) {
                /* 拿不到元数据也把弹窗开着 */
            }
        },
        onDetailMetadata(payload) {
            const key = this.detailFile && this.detailFile.name;
            if (!key || !payload) return;
            this.applyDetailFile({ name: key, metadata: payload.metadata || payload });
        },
        onDetailDownload() {
            const url = this.detailUrls && this.detailUrls.originUrl;
            if (!url) return;
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        },
        async onDetailDelete() {
            const key = this.detailFile && this.detailFile.name;
            if (!key) return;
            try {
                await this.$confirm(this.$t('dashboard.deleteConfirm'), this.$t('notes.deleteTitle'), {
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    type: 'warning',
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(
                    `/api/manage/delete/${encodeURIComponent(key)}?instanceId=${encodeURIComponent(this.instanceId || '')}`,
                    { method: 'GET' },
                );
                if (!res.ok) throw new Error(this.$t('common.failed'));
                this.$message.success(this.$t('dashboard.deleteSuccess'));
                this.detailVisible = false;
                this.reload(this.page);
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },
        onSaved() {
            this.reload(this.page);
            this.loadTrackers();
            this.$emit('changed');
        },
        fmtTime(ms) {
            const d = new Date(Number(ms) || 0);
            if (!Number.isFinite(d.getTime())) return '';
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        },
        /** 数值前的正负号由「性质」决定；无性质就不加号，颜色也另算 */
        fmtAmount(item) {
            const n = Number(item.amount) * (Number(item.quantity) || 1);
            const v = Number.isFinite(n) ? n : 0;
            const dir = Number(item.direction) || 0;
            const abs = Math.abs(v);
            const sign = dir === 1 ? '+' : (dir === -1 ? '-' : '');
            const unit = item.unit ? ` ${item.unit}${item.portion ? `/${item.portion}` : ''}` : '';
            return `${sign}${sign ? abs : v}${unit}`;
        },
        amountClass(item) {
            const dir = Number(item.direction) || 0;
            if (dir === 1) return 'is-pos';
            if (dir === -1) return 'is-neg';
            return 'is-plain';
        },
        /** 「上次 4500 元 / 43 天前」里的金额（上一条 × 份量 + 当时的单位） */
        fmtPrev(item) {
            const p = item && item.prev;
            if (!p) return '';
            const v = Number(p.value) || 0;
            const unit = p.unit ? ` ${p.unit}${p.portion ? `/${p.portion}` : ''}` : '';
            return `${v}${unit}`;
        },
        prevDays(item) {
            const p = item && item.prev;
            if (!p) return 0;
            const d = Math.floor((Number(item.occurredAt) - Number(p.occurredAt)) / 86400000);
            return Math.max(0, d);
        },
    },
};
</script>

<style scoped>
.reg-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 2px 2px 24px;
}

.reg-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 10px;
    border: 1px solid var(--note-card-border, var(--glass-border));
    border-radius: 10px;
    background: var(--glass-bg);
}

.reg-filter-marker {
    width: 170px;
}

.reg-filter-tag {
    width: 150px;
}

.reg-filter-range {
    width: 108px;
}

.reg-filter-kw {
    width: 180px;
}

.reg-kw-icon {
    font-size: 12px;
    opacity: 0.6;
}

.reg-add-icon {
    margin-right: 5px;
}

/* v1.3.6：回收站提示条（与发布中心回收站同一观感） */
.reg-trash-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--el-color-danger-light-7, rgba(245, 108, 108, 0.35));
    border-radius: 10px;
    background: var(--el-color-danger-light-9, rgba(245, 108, 108, 0.08));
    color: var(--el-color-danger);
    font-size: 12.5px;
}

.reg-trash-icon {
    font-size: 13px;
}

.reg-opt-name {
    margin-right: 8px;
}

.reg-opt-count {
    float: right;
    font-size: 11px;
    color: var(--el-text-color-secondary);
}

.reg-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 120px;
}

.reg-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 60px 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

.reg-empty-icon {
    font-size: 32px;
    opacity: 0.35;
}

.reg-item {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--note-card-border, var(--glass-border));
    border-radius: 10px;
    background: var(--note-card-bg, var(--el-bg-color));
}

.reg-item-main {
    flex: 1 1 auto;
    min-width: 0;
}

.reg-item-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.reg-item-place svg {
    margin-right: 3px;
    opacity: 0.7;
}

/*
 * v1.3.5.10：数值颜色 —— 有「+」红色、有「-」绿色，
 * 没有符号的用正文色（与红绿都不同色），避免三种情况混成两种颜色。
 */
.reg-item-amount {
    margin-left: auto;
    font-size: 14px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
}

.reg-item-amount.is-pos {
    color: var(--el-color-danger);
}

.reg-item-amount.is-neg {
    color: var(--el-color-success);
}

.reg-item-amount.is-plain {
    /* v1.3.6：既无 + 也无 - 的数值固定为 #646464，和红/绿都不撞色 */
    color: #646464;
}

/* 条目行（时间行的下一行） */
.reg-item-sub {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 3px;
    font-size: 12.5px;
    color: var(--el-text-color-secondary);
    line-height: 1.5;
}

.reg-item-marker {
    color: var(--el-color-primary);
    /* v1.3.6：条目名称不加粗；可点击跳转 /reg?tracker=名称 */
    font-weight: 400;
    text-decoration: none;
}

a.reg-item-marker:hover {
    text-decoration: underline;
}

.reg-item-prev {
    color: var(--el-text-color-secondary);
}

.reg-item-title {
    margin: 4px 0 0;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--el-text-color-primary);
}

.reg-item-event-wrap {
    position: relative;
    margin-top: 4px;
}

.reg-item-event {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--el-text-color-regular);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

/* 折叠：最多 6 行左右，超出由「全文」按钮展开 */
.reg-item-event.is-clamped {
    max-height: 124px;
    overflow: hidden;
}

/*
 * v1.3.6：「全文」贴在最后一行内容的末尾（右下角）。
 * 折叠态绝对定位并用渐变遮住背后的文字；展开后回到正文末尾、右对齐。
 */
.reg-full-toggle {
    margin-top: 2px;
    padding: 0 6px;
    border: none;
    border-radius: 6px;
    background: var(--el-fill-color, rgba(127, 127, 127, 0.12));
    color: var(--el-color-primary);
    font-size: 12px;
    font-family: inherit;
    line-height: 1.6;
    cursor: pointer;
}

.reg-item-event-wrap.is-clamped .reg-full-toggle {
    position: absolute;
    right: 0;
    bottom: 0;
    margin: 0;
    padding-left: 22px;
    border-radius: 0 0 6px 0;
    background:
        linear-gradient(90deg, transparent 0, var(--note-card-bg, var(--el-bg-color)) 22px);
}

.reg-item-event-wrap:not(.is-clamped) .reg-full-toggle {
    display: block;
    margin-left: auto;
}

.reg-full-toggle:hover {
    text-decoration: underline;
}

/* 附件缩略图：一行，尺寸固定 1:1，超出部分在最后一格叠 +N */
.reg-item-files {
    display: flex;
    gap: 6px;
    margin-top: 8px;
    overflow: hidden;
}

.reg-item-file {
    position: relative;
    flex: 0 0 auto;
    width: 54px;
    height: 54px;
    padding: 0;
    border: none;
    border-radius: 7px;
    overflow: hidden;
    background: var(--note-cell-bg, rgba(127, 127, 127, 0.12));
    cursor: pointer;
}

.reg-item-file-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.reg-item-file-img.is-contain {
    object-fit: contain;
    background: #000;
}

.reg-item-file-cover {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--el-text-color-secondary);
    font-size: 17px;
}

.reg-item-file-play {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 13px;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
    pointer-events: none;
}

.reg-item-file-more {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
}

.reg-item-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 6px;
    font-size: 11.5px;
    color: var(--el-text-color-secondary);
}

.reg-item-tags {
    display: inline-flex;
    gap: 6px;
    flex-wrap: wrap;
}

/* v1.3.6：标签复用瞬间的胶囊样式，可点击筛选 */
.reg-tag {
    padding: 1px 7px;
    border: none;
    border-radius: 999px;
    background: var(--note-tag-bg, rgba(127, 127, 127, 0.12));
    color: var(--note-tag-color, var(--el-text-color-regular));
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
}

.reg-tag:hover {
    color: var(--el-color-primary);
}

/* 「更多」按钮贴在标签行末尾 */
.reg-more {
    margin-left: auto;
}

.reg-act {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-secondary);
    cursor: pointer;
}

.reg-act:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary-light-5);
}

.reg-more-btn {
    padding: 0;
}

.reg-menu-icon {
    margin-right: 6px;
    font-size: 12px;
    opacity: 0.8;
}

.reg-menu-icon.is-danger {
    color: var(--el-color-danger);
}

.reg-pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 0;
}

.reg-pager-info {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

@media (max-width: 768px) {
    .reg-filter-marker,
    .reg-filter-tag,
    .reg-filter-kw {
        width: 100%;
    }

    .reg-filter-range {
        width: 120px;
    }

    .reg-add-btn {
        margin-left: 0;
    }

    .reg-item-file {
        width: 48px;
        height: 48px;
    }
}
</style>
