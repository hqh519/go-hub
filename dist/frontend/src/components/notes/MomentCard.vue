<template>
    <!--
        单条瞬间卡片（朋友圈式）
        ----------------------------------------------------------------------------
        文本截断规则（需求）：
          · 无附件 → 最多 10 行
          · 有附件 → 最多 5 行
          · 超出才显示「全文 / 收起」

        为什么必须用 JS 量一次：
          `-webkit-line-clamp` 只能「截断」，它**不会告诉我们到底有没有溢出**。
          只靠 CSS 会出现两种错：要么所有卡片都显示「全文」（很难看），
          要么真溢出了却不显示（内容看不到）。所以挂载后解除 clamp 量一次 scrollHeight，
          再决定是否需要这个按钮。
    -->
    <article class="mc" :class="{ 'is-deleted': note.status === 'deleted' }">
        <!-- 头部：时间 + 心情 + 天气 + 位置 + 可见性 -->
        <header class="mc-head">
            <!-- 标题：编辑页自动填「日期 + 时间」，用户可改；没填标题就退化成时间 -->
            <span class="mc-time">{{ note.title || timeText }}</span>
            <span v-if="note.title" class="mc-time-sub">{{ timeText }}</span>
            <span v-if="moodEmoji" class="mc-chip" :title="moodTitle">{{ moodEmoji }}</span>
            <span v-if="weatherEmoji" class="mc-chip" :title="weatherTitle">{{ weatherEmoji }}</span>
            <span v-if="note.moment && note.moment.location" class="mc-loc">
                <font-awesome-icon icon="globe" class="mc-loc-icon" />{{ note.moment.location }}
            </span>
            <span v-if="note.visibility === 'public'" class="mc-public">
                {{ $t('notes.publicBadge') }}
            </span>
            <span class="mc-spacer"></span>
            <span v-if="note.moment && note.moment.mediaKind !== 'text'" class="mc-media-kind">
                {{ mediaKindText }}
            </span>
        </header>

        <!-- 正文（纯文本，不做 md 渲染；Vue 插值天然转义，不存在 XSS） -->
        <div
            v-if="note.content"
            ref="body"
            class="mc-body"
            :class="{ 'is-clamp': !expanded }"
            :style="{ '--mc-lines': maxLines }"
        >{{ note.content }}</div>

        <button
            v-if="overflow"
            type="button"
            class="mc-toggle"
            @click.stop="expanded = !expanded"
        >
            {{ expanded ? $t('notes.collapse') : $t('notes.showFull') }}
        </button>

        <!-- 附件九宫格：超过 9 个只显示 9 个 + 「+N」，点开灯箱看全部 -->
        <MomentGrid
            v-if="assets.length"
            :assets="assets"
            @preview="(i) => $emit('preview', i)"
        />

        <!-- 底部：标签 + 操作 -->
        <footer class="mc-foot">
            <div class="mc-tags">
                <button
                    v-for="t in note.tags"
                    :key="t.id"
                    type="button"
                    class="mc-tag"
                    @click.stop="$emit('tag-click', t)"
                >#{{ t.name }}</button>
            </div>
            <div class="mc-actions">
                <template v-if="note.status === 'deleted'">
                    <button type="button" class="mc-act is-primary" :title="$t('notes.restore')" @click.stop="$emit('restore', note)">
                        <font-awesome-icon icon="undo" /><span class="mc-act-text">{{ $t('notes.restore') }}</span>
                    </button>
                    <button type="button" class="mc-act is-danger" :title="$t('notes.purge')" @click.stop="$emit('purge', note)">
                        <font-awesome-icon icon="trash-alt" /><span class="mc-act-text">{{ $t('notes.purge') }}</span>
                    </button>
                </template>
                <template v-else>
                    <button type="button" class="mc-act" :title="$t('notes.edit')" @click.stop="$emit('edit', note)">
                        <font-awesome-icon icon="edit" /><span class="mc-act-text">{{ $t('notes.edit') }}</span>
                    </button>
                    <button type="button" class="mc-act is-danger" :title="$t('notes.delete')" @click.stop="$emit('delete', note)">
                        <font-awesome-icon icon="trash-alt" /><span class="mc-act-text">{{ $t('notes.delete') }}</span>
                    </button>
                </template>
            </div>
        </footer>
    </article>
</template>

<script>
import MomentGrid from './MomentGrid.vue';
import { MOOD_OPTIONS, WEATHER_OPTIONS, emojiOfMood, emojiOfWeather, formatMomentTime } from '@/utils/notes';

export default {
    name: 'MomentCard',
    components: { MomentGrid },
    props: {
        note: { type: Object, required: true }
    },
    emits: ['preview', 'edit', 'delete', 'restore', 'purge', 'tag-click'],
    data() {
        return {
            // 正文是否被折叠（用户可以点「全文」展开）
            expanded: false,
            // 正文是否真的溢出（决定要不要显示「全文」按钮）
            overflow: false
        };
    },
    computed: {
        assets() {
            return (this.note && this.note.assets) || [];
        },
        /** 有附件 → 5 行；无附件 → 10 行 */
        maxLines() {
            return this.assets.length ? 5 : 10;
        },
        timeText() {
            return formatMomentTime(this.note.publishedAt || this.note.createdAt, (k) => this.$t(k));
        },
        moodEmoji() {
            return emojiOfMood(this.note.moment && this.note.moment.mood);
        },
        weatherEmoji() {
            return emojiOfWeather(this.note.moment && this.note.moment.weather);
        },
        moodTitle() {
            const hit = MOOD_OPTIONS.find((m) => m.value === (this.note.moment && this.note.moment.mood));
            return hit ? this.$t(hit.label) : '';
        },
        weatherTitle() {
            const hit = WEATHER_OPTIONS.find((m) => m.value === (this.note.moment && this.note.moment.weather));
            return hit ? this.$t(hit.label) : '';
        },
        mediaKindText() {
            const k = (this.note.moment && this.note.moment.mediaKind) || 'text';
            const map = {
                image: 'notes.mediaImage',
                video: 'notes.mediaVideo',
                audio: 'notes.mediaAudio',
                mixed: 'notes.mediaMixed'
            };
            return map[k] ? this.$t(map[k]) : '';
        }
    },
    watch: {
        /** 正文或附件变化后重新判定溢出（附件数决定行数上限） */
        'note.content'() {
            this.$nextTick(this.measure);
        },
        'assets.length'() {
            this.$nextTick(this.measure);
        },
        expanded(v) {
            // 展开时不必再量；收起后恢复真实状态
            if (!v) this.$nextTick(this.measure);
        }
    },
    mounted() {
        // 等字体 / 布局稳定后再量，避免首屏量到错误的行高
        this.$nextTick(() => {
            this.measure();
            window.setTimeout(this.measure, 300);
        });
    },
    methods: {
        /**
         * 量一次「不截断时的真实高度」，和「N 行的高度」比较。
         * 直接改 DOM class 而不是先改 data，是为了避免多次渲染抖动；
         * 量完立刻恢复，Vue 随后会按 :class 重新渲染。
         */
        measure() {
            const el = this.$refs.body;
            if (!el) {
                this.overflow = false;
                return;
            }
            const hadClamp = el.classList.contains('is-clamp');
            if (hadClamp) el.classList.remove('is-clamp');
            const full = el.scrollHeight;
            const cs = window.getComputedStyle(el);
            let lineHeight = parseFloat(cs.lineHeight);
            if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
                lineHeight = (parseFloat(cs.fontSize) || 14) * 1.7;
            }
            if (hadClamp) el.classList.add('is-clamp');
            // +2px 容差：行高取整 / 亚像素会让「刚好 N 行」差 1px
            this.overflow = full > lineHeight * this.maxLines + 2;
        }
    }
};
</script>

<style scoped>
.mc {
    box-sizing: border-box;
    padding: 14px 16px 10px;
    border-radius: 12px;
    background: var(--note-card-bg, var(--admin-container-bg-color, #fff));
    border: 1px solid var(--note-card-border, var(--glass-border, rgba(127, 127, 127, 0.16)));
    box-shadow: var(--note-card-shadow, 0 1px 2px rgba(0, 0, 0, 0.03));
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
}

.mc:hover {
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.07);
}

.mc.is-deleted {
    opacity: 0.72;
}

.mc-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--note-muted, var(--el-text-color-secondary));
}

.mc-time {
    font-weight: 600;
    color: var(--el-text-color-regular);
}

.mc-time-sub {
    font-size: 11px;
    opacity: 0.65;
}

.mc-chip {
    font-size: 14px;
    line-height: 1;
}

.mc-loc {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.mc-loc-icon {
    font-size: 10px;
    opacity: 0.7;
}

.mc-public {
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--note-public-bg, rgba(64, 158, 255, 0.14));
    color: var(--note-public-color, #2f7bd6);
    font-size: 11px;
}

.mc-spacer {
    flex: 1 1 auto;
}

.mc-media-kind {
    font-size: 11px;
    opacity: 0.65;
}

.mc-body {
    font-size: 14.5px;
    line-height: 1.75;
    color: var(--el-text-color-primary);
    /* 纯文本：保留用户输入的换行与连续空格 */
    white-space: pre-wrap;
    word-break: break-word;
}

.mc-body.is-clamp {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--mc-lines, 10);
    overflow: hidden;
}

.mc-toggle {
    margin-top: 4px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--el-color-primary);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
}

.mc-toggle:hover {
    text-decoration: underline;
}

.mc-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 10px;
    flex-wrap: wrap;
}

.mc-tags {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
}

.mc-tag {
    padding: 1px 7px;
    border: none;
    border-radius: 999px;
    background: var(--note-tag-bg, rgba(127, 127, 127, 0.12));
    color: var(--note-tag-color, var(--el-text-color-regular));
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
}

.mc-tag:hover {
    color: var(--el-color-primary);
}

.mc-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
}

.mc-act {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--note-muted, var(--el-text-color-secondary));
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
}

.mc-act:hover {
    background: var(--note-act-hover, rgba(127, 127, 127, 0.12));
    color: var(--el-color-primary);
}

.mc-act.is-danger:hover {
    background: rgba(245, 108, 108, 0.12);
    color: var(--el-color-danger);
}

.mc-act.is-primary:hover {
    background: rgba(103, 194, 58, 0.14);
    color: var(--el-color-success);
}

@media (max-width: 768px) {
    .mc {
        padding: 12px 12px 8px;
        border-radius: 10px;
    }

    .mc-body {
        font-size: 14px;
        line-height: 1.7;
    }

    /* 手机上操作按钮只留图标，避免挤占一行 */
    .mc-act-text {
        display: none;
    }

    .mc-act {
        padding: 5px 7px;
        font-size: 13px;
    }
}
</style>
