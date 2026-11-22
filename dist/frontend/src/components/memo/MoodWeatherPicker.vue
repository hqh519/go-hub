<template>
    <!--
        心情 / 天气选择器（v1.3.9.1）
        ----------------------------------------------------------------------------
        与「发布瞬间」编辑页共用 @/utils/notes.js 里的 MOOD_OPTIONS / WEATHER_OPTIONS
        —— 同一套图标（emoji）与同一套名称（i18n label），这就是需求里说的
        「把这套图标和名称做成公共复用，以后需要设置心情和天气的都使用这套图标」。

        组件只负责展示与选择，不直接写库：选中后把 {field, value, name} 抛给父组件，
        由父组件随笔记保存一起提交（名称存 notes.moodName / weatherName）。
        值为空时按需求「默认为第一个」展示第一个选项（开心 / 晴），但不主动落库。
    -->
    <span class="mwp-root">
        <el-popover
            v-model:visible="moodPop"
            trigger="click"
            placement="bottom-start"
            :width="popWidth"
            popper-class="mwp-popper"
        >
            <template #reference>
                <button type="button" class="mwp-btn" :title="`${$t('memo.moodTitle')}：${moodLabel}`" @click.stop>
                    <span class="mwp-emoji">{{ moodEmoji }}</span>
                </button>
            </template>
            <div class="mwp-head">{{ $t('memo.moodTitle') }}</div>
            <div class="mwp-grid">
                <button
                    v-for="o in moodOptions"
                    :key="'m-' + o.value"
                    type="button"
                    class="mwp-opt"
                    :class="{ 'is-active': effectiveMood === o.value }"
                    @click="pick('mood', o)"
                >
                    <span class="mwp-opt-emoji">{{ o.emoji }}</span>
                    <span class="mwp-opt-name">{{ $t(o.label) }}</span>
                </button>
            </div>
        </el-popover>

        <el-popover
            v-model:visible="weatherPop"
            trigger="click"
            placement="bottom-start"
            :width="popWidth"
            popper-class="mwp-popper"
        >
            <template #reference>
                <button type="button" class="mwp-btn" :title="`${$t('memo.weatherTitle')}：${weatherLabel}`" @click.stop>
                    <span class="mwp-emoji">{{ weatherEmoji }}</span>
                </button>
            </template>
            <div class="mwp-head">{{ $t('memo.weatherTitle') }}</div>
            <div class="mwp-grid">
                <button
                    v-for="o in weatherOptions"
                    :key="'w-' + o.value"
                    type="button"
                    class="mwp-opt"
                    :class="{ 'is-active': effectiveWeather === o.value }"
                    @click="pick('weather', o)"
                >
                    <span class="mwp-opt-emoji">{{ o.emoji }}</span>
                    <span class="mwp-opt-name">{{ $t(o.label) }}</span>
                </button>
            </div>
        </el-popover>
    </span>
</template>

<script>
import { MOOD_OPTIONS, WEATHER_OPTIONS, emojiOfMood, emojiOfWeather } from '@/utils/notes';

/** 供父组件按枚举值取名称（保存 moodName / weatherName 时用） */
export function moodWeatherNames() {
    return {
        mood: Object.fromEntries(MOOD_OPTIONS.map((o) => [o.value, o.label])),
        weather: Object.fromEntries(WEATHER_OPTIONS.map((o) => [o.value, o.label])),
    };
}

export default {
    name: 'MoodWeatherPicker',
    props: {
        mood: { type: String, default: '' },
        weather: { type: String, default: '' },
    },
    emits: ['change'],
    data() {
        return {
            moodPop: false,
            weatherPop: false,
            moodOptions: MOOD_OPTIONS,
            weatherOptions: WEATHER_OPTIONS,
        };
    },
    computed: {
        popWidth() {
            // 移动端收窄一点，避免 7 个图标的弹层顶到屏幕外
            return typeof window !== 'undefined' && window.innerWidth <= 500 ? 240 : 288;
        },
        effectiveMood() {
            return this.mood || this.moodOptions[0].value;
        },
        effectiveWeather() {
            return this.weather || this.weatherOptions[0].value;
        },
        moodEmoji() {
            return emojiOfMood(this.effectiveMood) || this.moodOptions[0].emoji;
        },
        weatherEmoji() {
            return emojiOfWeather(this.effectiveWeather) || this.weatherOptions[0].emoji;
        },
        moodLabel() {
            const o = this.moodOptions.find((x) => x.value === this.effectiveMood);
            return o ? this.$t(o.label) : '';
        },
        weatherLabel() {
            const o = this.weatherOptions.find((x) => x.value === this.effectiveWeather);
            return o ? this.$t(o.label) : '';
        },
    },
    methods: {
        pick(field, opt) {
            if (field === 'mood') this.moodPop = false;
            else this.weatherPop = false;
            this.$emit('change', { field, value: opt.value, name: this.$t(opt.label) });
        },
    },
};
</script>

<style scoped>
.mwp-root {
    display: inline-flex;
    align-items: center;
    gap: 2px;
}
.mwp-btn {
    width: 24px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
}
.mwp-btn:hover {
    background: var(--el-fill-color);
}
.mwp-emoji {
    font-size: 14px;
    line-height: 1;
}
.mwp-head {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
}
.mwp-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
}
.mwp-opt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 6px 2px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    background: var(--el-bg-color);
    cursor: pointer;
}
.mwp-opt:hover {
    border-color: var(--el-color-primary);
}
.mwp-opt.is-active {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
}
.mwp-opt-emoji {
    font-size: 17px;
    line-height: 1.2;
}
.mwp-opt-name {
    font-size: 10.5px;
    color: var(--el-text-color-regular);
    white-space: nowrap;
}
</style>
