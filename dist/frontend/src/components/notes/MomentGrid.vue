<template>
    <!--
        瞬间附件排版（九宫格）
        ----------------------------------------------------------------------------
        需求（docs/规划/GoHub笔记板块-瞬间.md）：
          · 无附件 → 不渲染本组件
          · 1 个   → 单张大图，居中，高度约等于九宫格
          · 2 个   → 一行两个，各占一半
          · 3 个   → 一行三个
          · 4-9 个 → 三列自动换行（4 = 3+1、5 = 3+2、7 = 3+3+1…）
          · 超过 9 → 只显示前 9 个，第 9 格叠「+N」，点开灯箱看全部

        实现要点：
          · 4-6 与 7-9 是**同一套代码** —— grid 自动换行，最后一行不满就靠左，
            不需要为「7 个也显示 3 行」写特例；
          · 格子用 aspect-ratio 固定正方形，图片 object-fit: cover，任何数量都不变形；
          · 音频没有画面 → 图标卡（音乐图标 + 文件名 + 时长），不参与图片比例计算逻辑；
          · 视频不内联播放（preload="none" 会被浏览器加载元数据，一屏几十个就是几十个请求），
            统一用「播放角标 + 文件名」的封面卡，点开才在灯箱里播。
    -->
    <div class="mg" :class="[`mg-count-${visibleCount}`, { 'is-single': items.length === 1 }]">
        <button
            v-for="(it, i) in items"
            :key="it.fileId || i"
            type="button"
            class="mg-cell"
            :class="`is-${it.mediaKind}`"
            :aria-label="it.originalName || it.name"
            @click.stop="$emit('preview', i)"
        >
            <!-- 图片：统一用后端给的缩略图（sharp 缩放 + 长缓存），首屏流量降一个数量级 -->
            <img
                v-if="it.mediaKind === 'image'"
                :src="it.thumbUrl || it.url"
                :alt="it.originalName || ''"
                class="mg-img"
                loading="lazy"
                decoding="async"
                @error="onImgError($event, it)"
            />

            <!-- 视频：封面卡（不加载视频本体） -->
            <span v-else-if="it.mediaKind === 'video'" class="mg-cover">
                <font-awesome-icon icon="play" class="mg-cover-icon" />
                <span class="mg-cover-name">{{ it.originalName || it.name }}</span>
            </span>

            <!-- 音频：图标卡 + 时长（时长由浏览器读元数据，读不到就只显示图标和名字） -->
            <span v-else-if="it.mediaKind === 'audio'" class="mg-cover is-audio">
                <font-awesome-icon icon="music" class="mg-cover-icon" />
                <span class="mg-cover-name">{{ it.originalName || it.name }}</span>
                <span v-if="durations[it.fileId]" class="mg-cover-meta">{{ durations[it.fileId] }}</span>
            </span>

            <!-- 其它（pdf / 文本 / 压缩包…）：文件图标卡 -->
            <span v-else class="mg-cover is-file">
                <font-awesome-icon :icon="fileIcon(it)" class="mg-cover-icon" />
                <span class="mg-cover-name">{{ it.originalName || it.name }}</span>
            </span>

            <!-- 超过 9 个：最后一格叠「+N」 -->
            <span v-if="hiddenCount && i === items.length - 1" class="mg-more">+{{ hiddenCount }}</span>
        </button>
    </div>
</template>

<script>
import { GRID_MAX } from '@/utils/notes';

/**
 * 音频时长探测：浏览器读元数据即可，不需要后端存字段。
 * 结果按 URL 缓存（同一附件在列表里出现多次也只探测一次），并发限制 3，
 * 避免一屏几十个音频同时发请求。
 */
const durationCache = new Map();
let probing = 0;
const probeQueue = [];

function runProbe() {
    if (probing >= 3 || !probeQueue.length) return;
    const job = probeQueue.shift();
    probing += 1;
    const audio = document.createElement('audio');
    let done = false;
    const finish = (text) => {
        if (done) return;
        done = true;
        probing -= 1;
        durationCache.set(job.url, text);
        job.resolve(text);
        runProbe();
    };
    audio.preload = 'metadata';
    audio.src = job.url;
    audio.addEventListener('loadedmetadata', () => {
        const sec = Number(audio.duration);
        finish(Number.isFinite(sec) && sec > 0 ? formatDuration(sec) : '');
        audio.src = '';
    });
    audio.addEventListener('error', () => finish(''));
    // 8 秒兜底：网络差时不至于永远占着并发位
    window.setTimeout(() => finish(''), 8000);
}

function probeDuration(url) {
    const key = String(url || '');
    if (!key) return Promise.resolve('');
    if (durationCache.has(key)) return Promise.resolve(durationCache.get(key));
    return new Promise((resolve) => {
        probeQueue.push({ url: key, resolve });
        runProbe();
    });
}

function formatDuration(sec) {
    const s = Math.round(sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
}

export default {
    name: 'MomentGrid',
    props: {
        /** [{ fileId, url, thumbUrl, originalName, name, mediaKind, mime }] */
        assets: { type: Array, default: () => [] }
    },
    emits: ['preview'],
    data() {
        return {
            // fileId → 时长文本（'' = 探测失败，不显示）
            durations: {}
        };
    },
    computed: {
        /** 最多显示 9 个 */
        items() {
            return (this.assets || []).filter(Boolean).slice(0, GRID_MAX);
        },
        visibleCount() {
            const n = this.items.length;
            if (n <= 1) return n;
            if (n === 2) return 2;
            return 3;
        },
        /** 被折叠的附件数量（第 9 格显示 +N） */
        hiddenCount() {
            return Math.max(0, (this.assets || []).length - GRID_MAX);
        }
    },
    watch: {
        'items.length'() {
            this.probeAudios();
        }
    },
    mounted() {
        this.probeAudios();
    },
    methods: {
        /** 只为音频格子探测时长（图片/视频不需要） */
        probeAudios() {
            for (const it of this.items) {
                if (it.mediaKind !== 'audio' || !it.url) continue;
                if (this.durations[it.fileId] !== undefined) continue;
                probeDuration(it.url).then((text) => {
                    // Vue 3 是 Proxy 响应式，直接赋值新 key 即可触发更新（没有 Vue 2 的 $set）
                    if (text) this.durations[it.fileId] = text;
                });
            }
        },
        fileIcon(it) {
            const mime = String(it.mime || '');
            const ext = String(it.originalName || '').split('.').pop().toLowerCase();
            if (mime === 'application/pdf' || ext === 'pdf') return 'file-pdf';
            if (['txt', 'md', 'json', 'csv', 'log', 'yml', 'yaml', 'xml'].includes(ext)) return 'file-alt';
            return 'file';
        },
        /**
         * 缩略图加载失败时退回原图。
         * 有些格式（如 svg / 超大 gif）sharp 不能缩放，后端会返回原文件 —— 但若
         * 远端渠道本身不支持 ?thumb=，第一次请求可能失败，这里至少让原图顶上来。
         */
        onImgError(e, it) {
            const el = e && e.target;
            if (!el) return;
            const fallback = it.url || '';
            if (fallback && el.src !== fallback && el.dataset.fallback !== '1') {
                el.dataset.fallback = '1';
                el.src = fallback;
            }
        }
    }
};
</script>

<style scoped>
.mg {
    display: grid;
    gap: 4px;
    margin-top: 10px;
    /* 卡片本身已被 .nt-main 收在 760px 内，九宫格直接铺满卡片宽度 ——
       再卡一个 520px 会在右边留出一道明显空白，看起来像没对齐 */
    max-width: 100%;
}

.mg-count-1 {
    grid-template-columns: 1fr;
}

.mg-count-2 {
    grid-template-columns: repeat(2, 1fr);
}

.mg-count-3 {
    grid-template-columns: repeat(3, 1fr);
}

/* 单图：居中，宽度约 62%，高度按 4:3 —— 与「高度约等于九宫格」的观感一致 */
.mg.is-single {
    width: 62%;
    min-width: 160px;
    /* 需求：单图居中（宽度只有 62%，不居中的话会贴在左边） */
    margin-left: auto;
    margin-right: auto;
}

.mg-cell {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    border-radius: 8px;
    overflow: hidden;
    background: var(--note-cell-bg, rgba(127, 127, 127, 0.1));
    aspect-ratio: 1 / 1;
    cursor: zoom-in;
    font: inherit;
    color: inherit;
}

.mg.is-single .mg-cell {
    aspect-ratio: 4 / 3;
}

.mg-cell:focus-visible {
    outline: 2px solid var(--el-color-primary);
    outline-offset: 2px;
}

.mg-img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

/* 非图片格：封面卡（视频 / 音频 / 其它文件） */
.mg-cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: 6px;
    background: var(--note-cover-bg, rgba(127, 127, 127, 0.14));
    color: var(--note-cover-color, #6b7280);
}

.mg-cover.is-audio {
    background: var(--note-audio-bg, rgba(99, 132, 255, 0.12));
    color: var(--note-audio-color, #4b6bdc);
}

.mg-cover-icon {
    font-size: 20px;
}

.mg-cover-name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    max-width: 100%;
    font-size: 11px;
    line-height: 1.3;
    text-align: center;
    word-break: break-all;
}

.mg-cover-meta {
    font-size: 11px;
    opacity: 0.75;
}

/* 「+N」角标 */
.mg-more {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
    font-size: 20px;
    font-weight: 600;
    letter-spacing: 0.5px;
}

@media (max-width: 768px) {
    .mg {
        max-width: 100%;
    }

    .mg.is-single {
        width: 68%;
    }

    .mg-cover-icon {
        font-size: 17px;
    }

    .mg-cover-name {
        font-size: 10px;
    }
}
</style>
