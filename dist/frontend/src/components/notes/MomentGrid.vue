<template>
    <!--
        瞬间附件排版
        ----------------------------------------------------------------------------
        数量与列数：
          · 无附件 → 不渲染本组件
          · 1 个   → 单张，**按原图宽高比**（v1.1.2.2 起不再 1:1 裁切）
          · 2 个   → 一行两个
          · 3 个   → 一行三个
          · 4 个   → 2 x 2（上行两个、下行两个）
          · 5-9 个 → 三列自动换行
          · 超过「加载几行 x 3」→ 最后一格叠「+N」，点开灯箱看全部

        尺寸口径（v1.1.2.3，需求原文表格）：
          · 单附件：高度 = 视口高度 x 设定比例 x 80%，宽度 = 高度 x 原图宽高比；
            「自动比例」下则沿用「宽度约 62%」，高度由宽高比反推（并用 45% 视口高封顶）。
          · 2 个及以上：总高 = 视口高度 x 设定比例 x 个数系数
            （2 个 70%、3 个 60%、4~6 个 80%、7 个以上 100%），
            格宽 = 由高度反推的正方形边长；**一行放不下就按可用宽度收**，收完仍是 1:1。
          · 可用宽度由父节点（卡片）实测，不靠猜：卡片宽度变了（窗口缩放、
            移动端抽屉）会通过 ResizeObserver 重新算。

        其它：
          · 音频没有画面 → 图标卡（音乐图标 + 文件名 + 时长）；
          · 视频不内联播放（preload="none" 仍会加载元数据，一屏几十个就是几十个请求），
            统一用「首帧缩略图 + 播放角标」的封面卡，点开才在灯箱里播。
    -->
    <div
        class="mg"
        :class="[
            `mg-count-${visibleCount}`,
            {
                'is-single': isSingle,
                'is-divider': divider,
                'is-grid4': items.length === 4,
                'is-custom': !!multiBudget,
                'is-sized': !!singleBudget,
                'is-left': alignLeft,
                'is-center': !alignLeft && (!!multiBudget || !!singleBudget)
            }
        ]"
        :style="gridStyle"
    >
        <button
            v-for="(it, i) in items"
            :key="it.fileId || i"
            type="button"
            class="mg-cell"
            :class="`is-${it.mediaKind}`"
            :style="cellStyle"
            :aria-label="it.originalName || it.name"
            @click.stop="$emit('preview', i)"
        >
            <!-- 图片：统一用后端给的缩略图（sharp 缩放 + 长缓存），首屏流量降一个数量级 -->
            <img
                v-if="it.mediaKind === 'image'"
                :src="it.thumbUrl || it.url"
                :alt="it.originalName || ''"
                class="mg-img"
                :class="{ 'is-contain': !!singleBudget }"
                loading="lazy"
                decoding="async"
                :data-src="it.thumbUrl || it.url"
                @load="onImgLoad($event, it)"
                @error="onImgError($event, it)"
            />

            <!--
                视频：封面卡（不加载视频本体）。
                用浏览器抽首帧当缩略图（utils/videoPoster，按 URL 缓存、并发限 2），
                抽不到时退回「图标 + 文件名」的封面卡；抽到了就在正中压一个小播放图标。
            -->
            <span v-else-if="it.mediaKind === 'video'" class="mg-cover is-video" :class="{ 'has-poster': !!posters[it.fileId || it.url] }">
                <img
                    v-if="posters[it.fileId || it.url]"
                    :src="posters[it.fileId || it.url]"
                    class="mg-img"
                    :class="{ 'is-contain': !!singleBudget }"
                    alt=""
                    loading="lazy"
                />
                <span class="mg-play" :class="{ 'is-overlay': !!posters[it.fileId || it.url] }">
                    <font-awesome-icon icon="play" class="mg-play-icon" />
                </span>
                <span v-if="!posters[it.fileId || it.url]" class="mg-cover-name">{{ it.originalName || it.name }}</span>
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

            <!-- 超出「加载几行」的部分：最后一格叠「+N」 -->
            <span v-if="hiddenCount && i === items.length - 1" class="mg-more">+{{ hiddenCount }}</span>
        </button>
    </div>
</template>

<script>
import { GRID_MAX } from '@/utils/notes';
import { videoPoster } from '@/utils/videoPoster';
import { noteSettings, attachBudget, singleBudget, ATTACH_ROWS_OPTIONS } from '@/utils/noteSettings';

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

/** 兜底宽高比：拿不到原图尺寸时按 4:3 —— 宁可保守也不能让单图占满一屏 */
const FALLBACK_ASPECT = 4 / 3;

export default {
    name: 'MomentGrid',
    props: {
        /** [{ fileId, url, thumbUrl, originalName, name, mediaKind, mime }] */
        assets: { type: Array, default: () => [] },
        /** v1.1.6：内容排版为「分割线样式」时，附件不要圆角、间距收到 2px */
        divider: { type: Boolean, default: false }
    },
    emits: ['preview'],
    data() {
        return {
            // fileId → 时长文本（'' = 探测失败，不显示）
            durations: {},
            // fileId / url → 视频首帧（dataURL，'' = 抽帧失败）
            posters: {},
            // v1.1.2.2：附件 key → 原图宽高比（width / height），单图排版用
            aspects: {},
            // 父节点（卡片）的可用宽度，单图 / 宽度收敛都要用
            availWidth: 0
        };
    },
    computed: {
        /** 「加载几行」→ 最多显示几个（每行 3 个，且不超过九宫格上限） */
        maxItems() {
            const rows = ATTACH_ROWS_OPTIONS.includes(noteSettings.moment.attachRows)
                ? noteSettings.moment.attachRows
                : 3;
            return Math.min(GRID_MAX, rows * 3);
        },
        items() {
            return (this.assets || []).filter(Boolean).slice(0, this.maxItems);
        },
        visibleCount() {
            const n = this.items.length;
            if (n <= 1) return n;
            if (n === 2) return 2;
            return 3;
        },
        /** 被折叠的附件数量（最后一格显示 +N） */
        hiddenCount() {
            return Math.max(0, (this.assets || []).length - this.maxItems);
        },
        isSingle() {
            return this.items.length === 1;
        },
        /** 单图的原图宽高比（拿到真实尺寸前用 4:3，拿到后立刻校正） */
        singleAspect() {
            const it = this.items[0];
            if (!it) return FALLBACK_ASPECT;
            const a = this.aspects[it.fileId || it.url];
            return Number(a) > 0 ? Number(a) : FALLBACK_ASPECT;
        },
        /**
         * 列数（决定「几行」）。
         *   · 1 个 → 1 列；2 个 → 2 列；3 个 → 3 列；
         *   · 正好 4 个 → 2 列（上行两个、下行两个）；
         *   · 其余（5 ~ 9）→ 3 列自动换行。
         */
        cols() {
            const n = this.items.length;
            if (n <= 1) return 1;
            if (n === 2) return 2;
            if (n === 3) return 3;
            if (n === 4) return 2;
            return 3;
        },
        /**
         * 单附件预算：按原图宽高比排，高度来自设置（详见 utils/noteSettings 的 singleBudgetOf）。
         * 非单图时返回 null。
         */
        singleBudget() {
            if (!this.isSingle) return null;
            return singleBudget(this.availWidth, this.singleAspect);
        },
        /**
         * 多附件预算。返回 null = 用户选了「默认」且不是单图，保持既有布局，
         * 此时不给任何内联尺寸，连类名都不加（见模板里的 is-custom）。
         */
        multiBudget() {
            if (this.isSingle) return null;
            return attachBudget(this.items.length, this.cols, this.availWidth);
        },
        alignLeft() {
            return noteSettings.moment.attachAlign === 'left';
        },
        gridStyle() {
            const b = this.singleBudget;
            if (b) return { width: `${b.width}px` };
            const m = this.multiBudget;
            if (!m) return {};
            return {
                '--mg-cols': String(this.cols),
                // min() 兜底：万一没测到可用宽度（首帧），也不会撑破卡片
                width: `min(${Math.round(m.width)}px, 100%)`
            };
        },
        /** 单图：高度由预算定，宽度铺满网格（网格宽度 = 预算宽度） */
        cellStyle() {
            const b = this.singleBudget;
            return b ? { height: `${b.height}px` } : {};
        }
    },
    watch: {
        'items.length'() {
            this.probeAudios();
            this.loadPosters();
        },
        /** 设置里改「加载几行」后，新露出来的附件要补探测 */
        maxItems() {
            this.probeAudios();
            this.loadPosters();
        }
    },
    mounted() {
        this.measureAvail();
        this.bindResize();
        this.probeAudios();
        this.loadPosters();
    },
    beforeUnmount() {
        if (this.ro) {
            this.ro.disconnect();
            this.ro = null;
        }
        window.removeEventListener('resize', this.onWindowResize);
    },
    methods: {
        /**
         * 量父节点的**内容宽度**（clientWidth 含 padding，要减掉），
         * 用它做「宽度不够就收缩」的依据。
         * 监听父节点而不是自己：自己的宽度是算出来的，监听自己会形成回路。
         */
        measureAvail() {
            const el = this.$el;
            const parent = el && el.parentElement;
            if (!parent) return;
            const cs = window.getComputedStyle(parent);
            const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
            const w = parent.clientWidth - pad;
            if (!(w > 0)) return;
            if (Math.abs(w - this.availWidth) > 1) this.availWidth = w;
        },
        bindResize() {
            const parent = this.$el && this.$el.parentElement;
            if (parent && typeof ResizeObserver !== 'undefined') {
                this.ro = new ResizeObserver(() => this.measureAvail());
                this.ro.observe(parent);
            }
            // ResizeObserver 在老浏览器 / 某些嵌套布局下可能不触发，window resize 兜底
            window.addEventListener('resize', this.onWindowResize, { passive: true });
        },
        onWindowResize() {
            this.measureAvail();
        },
        /** 图片加载完拿到原图宽高比 —— 单图据此排版（首帧先按 4:3，加载后校正） */
        onImgLoad(e, it) {
            const el = e && e.target;
            if (!el || !el.naturalWidth || !el.naturalHeight) return;
            const key = (it && (it.fileId || it.url)) || '';
            if (!key) return;
            const a = el.naturalWidth / el.naturalHeight;
            if (Math.abs((this.aspects[key] || 0) - a) > 0.001) this.aspects[key] = a;
        },
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
        /** 为视频格抽首帧（一屏最多 9 格，工具内部已限并发 2 并缓存结果） */
        loadPosters() {
            for (const it of this.items) {
                if (it.mediaKind !== 'video' || !it.url) continue;
                const key = it.fileId || it.url;
                if (this.posters[key] !== undefined) continue;
                videoPoster(it.url).then((dataUrl) => {
                    this.posters[key] = dataUrl || '';
                    // 单视频也要按原视频比例排：拿首帧的尺寸当宽高比
                    if (dataUrl && !this.aspects[key]) {
                        const probe = new Image();
                        probe.onload = () => {
                            if (probe.naturalWidth && probe.naturalHeight) {
                                this.aspects[key] = probe.naturalWidth / probe.naturalHeight;
                            }
                        };
                        probe.src = dataUrl;
                    }
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
         * 缩略图加载失败的处理（v1.1.3 分三级，专治「偶尔加载失败、刷新又正常」）：
         *   ① 先**原样重试一次**：这类偶发失败多是并发太高 / 连接被掐，不是文件坏了，
         *      隔一帧再请求同一地址，绝大多数能成；
         *   ② 还不行就退回原图（有些格式 sharp 缩不了，后端会直接给原文件；
         *      远端渠道不支持 ?thumb= 时原图是唯一可用的）；
         *   ③ 原图也失败就留空，由卡片的封面样式兜住，不再反复重试刷屏。
         */
        onImgError(e, it) {
            const el = e && e.target;
            if (!el) return;
            const retries = Number(el.dataset.retry || '0');
            if (retries < 1) {
                el.dataset.retry = String(retries + 1);
                // 隔一帧再加一个防缓存参数重试，避免命中上一次的失败结果
                window.setTimeout(() => {
                    const base = el.dataset.src || el.src;
                    if (!base) return;
                    try {
                        const u = new URL(base, window.location.origin);
                        u.searchParams.set('_r', String(Date.now()));
                        el.src = u.toString();
                    } catch (err) {
                        el.src = base;
                    }
                }, 260);
                return;
            }
            const fallback = it.url || '';
            if (fallback && el.dataset.fallback !== '1') {
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
    /*
     * v1.1.9.3（需求）：两种排版样式的附件间隔统一为 2px（分割线样式原来是 1px）。
     * 取值必须与 utils/noteSettings.js 的 attachGapOf() 完全一致 ——
     * 那边用它扣间距算格子尺寸，这里用它排版，差 1px 就会让最后一行对不齐。
     */
    gap: 2px;
    margin-top: 10px;
    /* 卡片本身已被 .nt-main 收在 760px 内，九宫格直接铺满卡片宽度 ——
       再卡一个 520px 会在右边留出一道明显空白，看起来像没对齐 */
    max-width: 100%;
}

/*
 * v1.1.6：分割线样式下的附件 —— 圆角归零。
 * v1.1.9.3：间距 1px → 2px（与边框线样式一致，需求原文）。
 */
.mg.is-divider {
    gap: 2px;
}

.mg.is-divider .mg-cell {
    border-radius: 0;
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

/*
 * 正好 4 个附件时按「上行两个、下行两个」排。
 * 仍然沿用正方形格子，只是列数从 3 改成 2 —— 每格更大，四张图的观感更整齐。
 */
.mg.is-grid4 {
    grid-template-columns: repeat(2, 1fr);
}

/*
 * 「附件加载区域大小 = 指定比例」
 * 宽度已由内联样式 `width: min(Xpx, 100%)` 定死，这里只按列数均分，
 * 格子再靠 aspect-ratio: 1/1 反向锁定行高 —— 于是
 * 「三行共占页面 30%」这个约束自动成立，不需要 JS 逐格算高。
 */
.mg.is-custom {
    grid-template-columns: repeat(var(--mg-cols, 3), minmax(0, 1fr));
}

/* 自定义尺寸下所有格子一律正方形（默认布局里单图是 4:3，必须覆盖） */
.mg.is-custom .mg-cell,
.mg.is-custom.is-single .mg-cell {
    aspect-ratio: 1 / 1;
}

/*
 * v1.1.2.2 单附件：按原图宽高比排。
 * 宽度由内联样式给定（= 预算宽度），高度由内联样式给定，画面上不再裁切。
 */
.mg.is-sized {
    min-width: 0;
    width: auto;
}

.mg.is-sized .mg-cell {
    aspect-ratio: auto;
}

/* 单图里的图片用 contain：极端比例（超宽全景 / 超高长图）也不会被裁掉 */
.mg-img.is-contain {
    object-fit: contain;
}

/* 位置：默认居中（块本身窄于卡片时才看得出效果），左对齐则与正文左边缘对齐 */
.mg.is-center {
    margin-left: auto;
    margin-right: auto;
}

.mg.is-left {
    margin-left: 0;
    margin-right: 0;
}

/* 单图：默认居中（宽度由预算决定，不再固定 62%） */
.mg.is-single {
    margin-left: auto;
    margin-right: auto;
}

/* 左对齐要压过上面的 .is-single（同权重时后写的赢，所以这里加一级 specificity） */
.mg.is-left.is-single {
    margin-left: 0;
    margin-right: 0;
}

.mg-cell {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    /* v1.1.2.3：每个附件的圆角 5px → 3px；v1.1.8：边框线样式下回到 3px（分割线样式仍为 0） */
    border-radius: 3px;
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

/* 有预算时高度由内联样式给，不能再被 4:3 规则盖掉 */
.mg.is-single.is-sized .mg-cell {
    aspect-ratio: auto;
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

/*
 * v1.1.4：抽到首帧的视频格 —— 去掉封面卡的 6px 内边距与灰色底，
 * 否则缩略图四周会露出一圈「边框 / 背景框」（需求：视频不要边框）。
 */
.mg-cover.is-video.has-poster {
    padding: 0;
    background: transparent;
}

.mg-cover.is-video.has-poster .mg-img {
    object-fit: cover;
}

.mg-cover.is-audio {
    background: var(--note-audio-bg, rgba(99, 132, 255, 0.12));
    color: var(--note-audio-color, #4b6bdc);
}

.mg-cover-icon {
    font-size: 20px;
}

/* 播放图标 —— 无缩略图时居中当封面图标；有缩略图时压在半透明圆底上 */
.mg-play {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.42);
    color: #fff;
}

.mg-play.is-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    /* 需求：图标不用太大，一眼看出是视频即可 */
    width: 30px;
    height: 30px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    pointer-events: none;
}

.mg-play-icon {
    font-size: 12px;
    /* 播放三角视觉重心偏左，右移 1px 更居中 */
    transform: translateX(1px);
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

    .mg-cover-icon {
        font-size: 17px;
    }

    .mg-cover-name {
        font-size: 10px;
    }
}
</style>
