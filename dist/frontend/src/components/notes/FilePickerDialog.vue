<template>
    <!--
        「从图床选择」文件选择器
        ----------------------------------------------------------------------------
        为什么不直接复用后台文件管理页：
          · 那个页面带目录树、批量操作、拖拽移动、回收站……对本场景全是噪声；
          · 这里只需要「按类型筛 + 搜索 + 点选」，一个弹窗就能装下。
        数据走 /api/notes/files（只读接口，按实例与账户收窄），
        **不改动图床任何既有接口**。
    -->
    <el-dialog
        v-model="visible"
        :title="$t('notes.pickFileTitle')"
        :width="dialogWidth"
        append-to-body
        class="note-picker-dialog"
        @open="onOpen"
    >
        <div class="np-toolbar">
            <div class="np-tabs" role="tablist">
                <button
                    v-for="t in typeTabs"
                    :key="t.value"
                    type="button"
                    role="tab"
                    class="np-tab"
                    :class="{ 'is-active': type === t.value }"
                    :aria-selected="type === t.value"
                    @click="switchType(t.value)"
                >{{ $t(t.label) }}</button>
            </div>
            <el-input
                v-model="search"
                class="np-search"
                size="small"
                clearable
                :placeholder="$t('notes.pickFileSearch')"
                @keyup.enter="reload"
                @clear="reload"
            >
                <template #suffix>
                    <font-awesome-icon icon="search" class="np-search-icon" @click="reload" />
                </template>
            </el-input>
        </div>

        <div class="np-body" v-loading="loading">
            <div v-if="!list.length && !loading" class="np-empty">
                <font-awesome-icon icon="images" class="np-empty-icon" />
                <p>{{ $t('notes.pickFileEmpty') }}</p>
            </div>
            <div v-else class="np-grid">
                <button
                    v-for="f in list"
                    :key="f.id"
                    type="button"
                    class="np-cell"
                    :class="{ 'is-picked': pickedMap[f.id], 'is-disabled': excluded.includes(f.id) }"
                    :disabled="excluded.includes(f.id)"
                    :title="f.originalName"
                    @click="toggle(f)"
                >
                    <!--
                        图片加载失败（文件已被删除 / 缩略图通道不可用）时退回图标卡，
                        否则整格是一个破图标，看起来像页面坏了。
                    -->
                    <img
                        v-if="f.mediaKind === 'image' && !f.broken"
                        :src="f.thumbUrl || f.url"
                        class="np-img"
                        loading="lazy"
                        alt=""
                        @error="f.broken = true"
                    />
                    <span v-else class="np-cover">
                        <font-awesome-icon :icon="iconOf(f)" class="np-cover-icon" />
                        <span class="np-cover-name">{{ f.originalName }}</span>
                    </span>
                    <span v-if="pickedMap[f.id]" class="np-check">
                        <font-awesome-icon icon="check" />
                    </span>
                    <span v-if="excluded.includes(f.id)" class="np-added">{{ $t('notes.pickFileAdded') }}</span>
                </button>
            </div>

            <div v-if="hasMore" class="np-more">
                <el-button size="small" :loading="loading" @click="loadMore">{{ $t('notes.pickFileMore') }}</el-button>
            </div>
            <p v-else-if="list.length" class="np-end">{{ $t('notes.pickFileEnd', { n: total }) }}</p>
        </div>

        <template #footer>
            <div class="np-footer">
                <span class="np-count">{{ $t('notes.pickFilePicked', { n: picked.length }) }}</span>
                <div class="np-footer-btns">
                    <el-button size="small" @click="visible = false">{{ $t('common.cancel') }}</el-button>
                    <el-button size="small" type="primary" :disabled="!picked.length" @click="confirm">
                        {{ $t('notes.pickFileConfirm') }}
                    </el-button>
                </div>
            </div>
        </template>
    </el-dialog>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import { formatSize } from '@/utils/notes';

export default {
    name: 'FilePickerDialog',
    props: {
        modelValue: { type: Boolean, default: false },
        instanceId: { type: String, default: '' },
        /** 已经加进瞬间的文件 id —— 不允许重复选（后端也有唯一约束兜底） */
        excludeIds: { type: Array, default: () => [] }
    },
    emits: ['update:modelValue', 'confirm'],
    data() {
        return {
            type: '',
            search: '',
            list: [],
            total: 0,
            page: 1,
            pageSize: 24,
            loading: false,
            picked: [],
            loaded: false
        };
    },
    computed: {
        visible: {
            get() {
                return this.modelValue;
            },
            set(v) {
                this.$emit('update:modelValue', v);
            }
        },
        dialogWidth() {
            return window.innerWidth < 768 ? '94%' : '760px';
        },
        typeTabs() {
            return [
                { value: '', label: 'notes.mediaAll' },
                { value: 'image', label: 'notes.mediaImage' },
                { value: 'video', label: 'notes.mediaVideo' },
                { value: 'audio', label: 'notes.mediaAudio' }
            ];
        },
        excluded() {
            return (this.excludeIds || []).map(String);
        },
        pickedMap() {
            const map = {};
            for (const f of this.picked) map[f.id] = true;
            return map;
        },
        hasMore() {
            return this.list.length < this.total;
        }
    },
    methods: {
        formatSize,
        iconOf(f) {
            if (f.mediaKind === 'image') return 'images';
            if (f.mediaKind === 'video') return 'film';
            if (f.mediaKind === 'audio') return 'music';
            if (f.fileType === 'pdf') return 'file-pdf';
            if (f.fileType === 'txt') return 'file-alt';
            return 'file';
        },
        onOpen() {
            if (this.loaded) return;
            this.loaded = true;
            this.reload();
        },
        switchType(v) {
            if (this.type === v) return;
            this.type = v;
            this.reload();
        },
        reload() {
            this.page = 1;
            this.list = [];
            this.total = 0;
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
                const qs = new URLSearchParams();
                qs.set('page', String(this.page));
                qs.set('pageSize', String(this.pageSize));
                qs.set('instanceId', this.instanceId || '');
                if (this.type) qs.set('type', this.type);
                if (this.search.trim()) qs.set('search', this.search.trim());
                const res = await fetchWithAuth(`/api/notes/files?${qs.toString()}`);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || 'load failed');
                const rows = Array.isArray(data.list) ? data.list : [];
                this.total = Number(data.total) || 0;
                this.list = reset ? rows : this.list.concat(rows);
            } catch (e) {
                this.$message.error(this.$t('notes.pickFileLoadFail'));
            } finally {
                this.loading = false;
            }
        },
        toggle(f) {
            if (this.excluded.includes(f.id)) return;
            const idx = this.picked.findIndex((x) => x.id === f.id);
            if (idx >= 0) this.picked.splice(idx, 1);
            else this.picked.push(f);
        },
        confirm() {
            this.$emit('confirm', this.picked.slice());
            this.visible = false;
        }
    },
    watch: {
        visible(v) {
            // 每次关闭都清掉待选状态，避免下次打开还挂着上一轮
            if (!v) this.picked = [];
        }
    }
};
</script>

<style scoped>
.np-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 10px;
}

.np-tabs {
    display: inline-flex;
    gap: 4px;
    padding: 3px;
    border-radius: 9px;
    background: var(--note-tabs-bg, rgba(127, 127, 127, 0.1));
}

.np-tab {
    padding: 4px 12px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
}

.np-tab.is-active {
    background: var(--note-tab-active-bg, #fff);
    color: var(--el-color-primary);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.np-search {
    width: 220px;
}

.np-search-icon {
    cursor: pointer;
    opacity: 0.6;
}

.np-body {
    min-height: 220px;
    max-height: 52vh;
    overflow-y: auto;
    overscroll-behavior: contain;
}

.np-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 8px;
}

.np-cell {
    position: relative;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    overflow: hidden;
    background: var(--note-cell-bg, rgba(127, 127, 127, 0.1));
    aspect-ratio: 1 / 1;
    cursor: pointer;
    font: inherit;
    color: inherit;
}

.np-cell.is-picked {
    border-color: var(--el-color-primary);
    box-shadow: 0 0 0 2px var(--el-color-primary-light-7, rgba(64, 158, 255, 0.3));
}

.np-cell.is-disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.np-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.np-cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 100%;
    height: 100%;
    padding: 6px;
    box-sizing: border-box;
    color: var(--note-cover-color, #6b7280);
}

.np-cover-icon {
    font-size: 18px;
}

.np-cover-name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    width: 100%;
    font-size: 11px;
    line-height: 1.3;
    text-align: center;
    word-break: break-all;
}

.np-check {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 10px;
}

.np-added {
    position: absolute;
    left: 4px;
    bottom: 4px;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 10px;
}

.np-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 48px 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

.np-empty-icon {
    font-size: 26px;
    opacity: 0.5;
}

.np-more {
    display: flex;
    justify-content: center;
    padding: 12px 0 4px;
}

.np-end {
    margin: 12px 0 2px;
    text-align: center;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.np-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
}

.np-count {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.np-footer-btns {
    display: flex;
    gap: 8px;
    margin-left: auto;
}

@media (max-width: 768px) {
    .np-search {
        width: 100%;
    }

    .np-grid {
        grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
        gap: 6px;
    }
}
</style>
