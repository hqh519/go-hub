<template>
    <!--
        文件引用明细页（v1.1.2）
        ----------------------------------------------------------------------------
        入口：文件详情 →「文件引用」右侧的「查看」按钮（新标签页打开）。
        为什么单独一页而不是弹窗：
          · 需求明确「在新标签页跳到另外一个页面查看」；
          · 引用明细可能很长，单独一页可以自由滚动、复制、对比，也不会挤占详情弹窗。
        数据：GET /api/manage/api/file-refs/<File_ID>（只读，登录可见，普通用户限本人文件）。
    -->
    <div class="fr-page">
        <header class="fr-header">
            <button type="button" class="fr-back" @click="goBack">
                <font-awesome-icon icon="arrow-left" />
                <span>{{ $t('common.back') }}</span>
            </button>
            <h1 class="fr-title">{{ $t('fileRef.title') }}</h1>
            <button type="button" class="fr-refresh" :title="$t('notes.refresh')" @click="load">
                <font-awesome-icon icon="sync" :class="{ 'fa-spin': loading }" />
            </button>
        </header>

        <section class="fr-file">
            <div class="fr-file-name" :title="data.originalName || data.name">{{ data.originalName || data.name || '—' }}</div>
            <div class="fr-file-meta">
                <!--
                    v1.1.5：两个统计并排输出 —— 引用(xx) | 共用(xx)，与详情页保持同一口径。
                    引用 = 被笔记 / 目录共享引用；共用 = 同一个实体文件被几条记录共用（删除统计）。
                -->
                <span class="fr-chip-pair">
                    <span class="fr-chip">{{ $t('fileRef.chipRef', { n: data.count || 0 }) }}</span>
                    <span class="fr-chip-divider">|</span>
                    <span class="fr-chip is-share">{{ $t('fileRef.chipShare', { n: data.sharedCount || 0 }) }}</span>
                </span>
                <span v-if="data.count" class="fr-chip is-sub">
                    {{ $t('fileRef.breakdown', { note: data.noteCount || 0, share: data.shareCount || 0 }) }}
                </span>
                <span class="fr-id">{{ data.name }}</span>
            </div>
        </section>

        <div v-if="loading && !data.count && !data.sharedCount" class="fr-loading">
            <font-awesome-icon icon="spinner" spin />
            <span>{{ $t('notes.loading') }}</span>
        </div>

        <div v-else-if="errorText" class="fr-empty is-error">{{ errorText }}</div>

        <template v-else>
            <!-- 引用明细（谁在用这个文件） -->
            <section class="fr-block">
                <h2 class="fr-block-title">
                    {{ $t('fileRef.sectionRefs') }}
                    <span class="fr-block-count">({{ data.count || 0 }})</span>
                </h2>
                <div v-if="!list.length" class="fr-block-empty">
                    <font-awesome-icon icon="inbox" class="fr-empty-icon" />
                    <p>{{ $t('fileRef.empty') }}</p>
                </div>
                <ul v-else class="fr-list">
                    <li v-for="(r, i) in list" :key="(r.noteId || r.shareId || i) + '-' + r.source" class="fr-item">
                        <div class="fr-item-main">
                            <span class="fr-item-title">{{ r.title || $t('fileRef.untitled') }}</span>
                            <span class="fr-item-badges">
                                <!-- v1.1.2.1：先标来源（笔记 / 分享），再标具体类型 -->
                                <span class="fr-badge" :class="r.source === 'share' ? 'is-soft' : 'is-strong'">
                                    {{ r.source === 'share' ? $t('fileRef.sourceShare') : $t('fileRef.sourceNote') }}
                                </span>
                                <span class="fr-badge">{{ kindLabel(r) }}</span>
                                <span v-if="r.status === 'deleted'" class="fr-badge is-danger">{{ $t('fileRef.inTrash') }}</span>
                            </span>
                        </div>
                        <div class="fr-item-sub">
                            <span>{{ formatTime(r.createdAt) }}</span>
                            <span v-if="r.author" class="fr-dot">·</span>
                            <span v-if="r.author">{{ r.author }}</span>
                        </div>
                    </li>
                </ul>
            </section>

            <!--
                v1.1.5：共用明细（删除统计）——
                同一个实体文件被复制成了几条记录、分别落在哪个用户的哪个实例里。
                只有当「共用数 > 0」时才出现（单份文件没有共用关系，显示空区反而添噪）。
            -->
            <section v-if="sharedList.length" class="fr-block">
                <h2 class="fr-block-title">
                    {{ $t('fileRef.sectionShared') }}
                    <span class="fr-block-count">({{ data.sharedCount || 0 }})</span>
                    <span class="fr-block-hint">{{ $t('fileRef.sectionSharedHint') }}</span>
                </h2>
                <ul class="fr-list">
                    <li v-for="(m, i) in sharedList" :key="m.fileId || i" class="fr-item">
                        <div class="fr-item-main">
                            <span class="fr-item-title">{{ m.originalName || m.name }}</span>
                            <span class="fr-item-badges">
                                <span class="fr-badge is-strong">{{ m.instanceName || $t('fileManager.instanceDefault') }}</span>
                                <span v-if="m.status === 'deleted'" class="fr-badge is-danger">{{ $t('fileRef.inTrash') }}</span>
                                <span v-if="m.clonedFromMe" class="fr-badge is-soft">{{ $t('fileRef.copyFromMe') }}</span>
                            </span>
                        </div>
                        <div class="fr-item-sub">
                            <span v-if="m.uploader">{{ m.uploader }}</span>
                            <span v-if="m.uploader" class="fr-dot">·</span>
                            <span class="fr-mono">{{ m.name }}</span>
                        </div>
                    </li>
                </ul>
            </section>
        </template>
    </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import { formatMomentTime } from '@/utils/notes';

export default {
    name: 'FileRefsPage',
    data() {
        return {
            loading: false,
            errorText: '',
            data: { name: '', originalName: '', count: 0, sharedCount: 0, shared: [], list: [] }
        };
    },
    computed: {
        list() {
            return Array.isArray(this.data.list) ? this.data.list : [];
        },
        /** v1.1.5：共用清单（同实体对象还被哪些记录 / 实例用着） */
        sharedList() {
            return Array.isArray(this.data.shared) ? this.data.shared : [];
        },
        fileName() {
            return String(this.$route.query.name || '');
        },
        /**
         * v1.1.7：当前实例 —— 引用明细只允许查本实例下的文件。
         * 优先用地址栏带的 instanceId（从文件详情跳过来时带的），否则读本地实例记忆。
         */
        instanceId() {
            const fromQuery = this.$route.query.instanceId;
            if (typeof fromQuery === 'string') return fromQuery;
            try {
                return localStorage.getItem('gohub_instance_id') || '';
            } catch (e) {
                return '';
            }
        }
    },
    mounted() {
        this.load();
    },
    methods: {
        async load() {
            if (!this.fileName) {
                this.errorText = this.$t('fileRef.missingName');
                return;
            }
            this.loading = true;
            this.errorText = '';
            try {
                /*
                 * v1.1.5：路径修正 —— 后端真实路由是 `/api/manage/api/file-refs/*`
                 * （挂载在 @Controller('api/manage') 里，装饰器内又写了 api/file-refs）。
                 * 之前这里写的是 `/api/file-refs/*`，一直 404，
                 * 表现就是「引用明细页永远显示没有被引用」。
                 */
                const qs = new URLSearchParams({ instanceId: String(this.instanceId ?? '') });
                const res = await fetchWithAuth(
                    `/api/manage/api/file-refs/${encodeURIComponent(this.fileName)}?${qs.toString()}`
                );
                const json = await res.json().catch(() => ({}));
                if (!res.ok || json.success === false) throw new Error(json.message || this.$t('fileRef.loadFail'));
                this.data = json.data || { name: '', originalName: '', count: 0, sharedCount: 0, shared: [], list: [] };
            } catch (e) {
                this.errorText = e.message || this.$t('fileRef.loadFail');
            } finally {
                this.loading = false;
            }
        },
        kindLabel(r) {
            // 分享行：kind 是 cate / tag，翻译成「目录分享 / 标签分享」
            if (r && r.source === 'share') {
                return r.kind === 'tag' ? this.$t('fileRef.shareTag') : this.$t('fileRef.shareCate');
            }
            const kind = r && r.kind;
            const map = {
                moment: 'notes.typeMoment',
                article: 'notes.typeArticle',
                collection: 'notes.typeCollection',
                nav: 'notes.typeNav',
                todo: 'notes.typeTodo'
            };
            return map[kind] ? this.$t(map[kind]) : (kind || '—');
        },
        formatTime(ts) {
            return formatMomentTime(ts, (k) => this.$t(k));
        },
        goBack() {
            if (window.history.length > 1) window.history.back();
            else this.$router.push('/post');
        }
    }
};
</script>

<style scoped>
.fr-page {
    box-sizing: border-box;
    min-height: 100vh;
    padding: 24px clamp(16px, 4vw, 48px) 64px;
    text-align: left;
    background: var(--bg-color, transparent);
}

.fr-header {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 860px;
    margin: 0 auto 16px;
}

.fr-back,
.fr-refresh {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--glass-border, var(--el-border-color));
    border-radius: 9px;
    background: var(--glass-bg, transparent);
    color: var(--el-text-color-regular);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
}

.fr-title {
    flex: 1 1 auto;
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: var(--admin-container-color, var(--el-text-color-primary));
}

.fr-file {
    max-width: 860px;
    margin: 0 auto 14px;
    padding: 14px 16px;
    border: 1px solid var(--glass-border, var(--el-border-color-lighter));
    border-radius: 14px;
    background: var(--glass-bg, var(--el-bg-color));
}

.fr-file-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--admin-container-color, var(--el-text-color-primary));
    word-break: break-all;
}

.fr-file-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
    flex-wrap: wrap;
}

.fr-chip {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.12));
    color: var(--el-color-primary);
    font-size: 12px;
}

.fr-id {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    word-break: break-all;
}

/* v1.1.2.1：来源小计用浅色 chip，避免和总数抢视线 */
.fr-chip.is-sub {
    background: var(--el-fill-color-light, rgba(127, 127, 127, 0.12));
    color: var(--el-text-color-regular);
}

/* v1.1.5：引用(xx) | 共用(xx) —— 两个统计并排，共用用绿色区分（它代表「还有几份」而不是「被谁用着」） */
.fr-chip-pair {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.fr-chip.is-share {
    background: var(--el-color-success-light-9, rgba(103, 194, 58, 0.12));
    color: var(--el-color-success);
}

.fr-chip-divider {
    color: var(--el-text-color-placeholder);
    font-size: 12px;
}

/* 分区：引用明细 / 共用明细 */
.fr-block {
    max-width: 860px;
    margin: 0 auto 18px;
}

.fr-block-title {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--admin-container-color, var(--el-text-color-primary));
}

.fr-block-count {
    font-weight: 400;
    color: var(--el-text-color-secondary);
}

.fr-block-hint {
    margin-left: 4px;
    font-size: 11px;
    font-weight: 400;
    color: var(--el-text-color-secondary);
}

.fr-block-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 22px 0;
    border: 1px dashed var(--glass-border, var(--el-border-color-lighter));
    border-radius: 12px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

.fr-block-empty p {
    margin: 0;
}

.fr-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    word-break: break-all;
    opacity: 0.8;
}

.fr-list {
    max-width: 860px;
    margin: 0 auto;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.fr-item {
    padding: 12px 14px;
    border: 1px solid var(--glass-border, var(--el-border-color-lighter));
    border-radius: 12px;
    background: var(--glass-bg, var(--el-bg-color));
}

.fr-item-main {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.fr-item-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--admin-container-color, var(--el-text-color-primary));
}

.fr-item-badges {
    display: inline-flex;
    gap: 6px;
}

.fr-badge {
    padding: 1px 7px;
    border-radius: 6px;
    background: var(--el-fill-color-light, rgba(127, 127, 127, 0.12));
    color: var(--el-text-color-regular);
    font-size: 11px;
}

.fr-badge.is-danger {
    background: var(--el-color-danger-light-9, rgba(245, 108, 108, 0.12));
    color: var(--el-color-danger);
}

/* 强引用（笔记）标实心，弱引用（分享）标浅色 —— 一眼分得出「删了会坏」和「只是被分享」 */
.fr-badge.is-strong {
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.12));
    color: var(--el-color-primary);
}

.fr-badge.is-soft {
    background: var(--el-color-success-light-9, rgba(103, 194, 58, 0.12));
    color: var(--el-color-success);
}

.fr-item-sub {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.fr-loading,
.fr-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    max-width: 860px;
    margin: 40px auto 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

.fr-empty.is-error {
    color: var(--el-color-danger);
}

.fr-empty-icon {
    font-size: 26px;
    opacity: 0.5;
}
</style>
