<template>
    <!--
        笔记设置（v1.1.2.1 起，v1.1.2.2 / v1.1.2.3 扩充）
        ----------------------------------------------------------------------------
        · 入口：笔记管理页右上角「更多菜单」→ 笔记设置（在「退出登录」上一行）
        · 按**实例**保存：存服务端 `settings` 表 key = `note-settings:<实例 id>`，
          同一实例里的所有人共用一套，切换实例就是另一套，互不影响
        · 分类：瞬间 / 待办 / 导航 / 文章 / 收集 —— 目前只实现「瞬间设置」，
          其余分类保留入口但标「即将开放」，不做假的空白面板

        「瞬间设置」的四个配置项（v1.1.2.3 默认值已调整）：
          1) 附件加载区域大小：指定比例（默认）/ 自动比例
             —— 指定比例下再填「附件占页面最高比例」，默认 35%
          2) 附件加载位置：左对齐（默认）/ 居中显示
          3) 内容排版样式：分割线样式（默认）/ 边框样式
          4) 附件数量加载：加载两行（最多 6 个，默认）/ 三行 / 一行

        单选顺序按「当前默认项排第一」排，用户一眼看到的就是当前生效的那一项。
    -->
    <el-dialog
        v-model="visible"
        :title="$t('notes.settingsTitle')"
        :width="dialogWidth"
        class="note-settings-dialog"
        append-to-body
        destroy-on-close
        @closed="onClosed"
    >
        <div class="ns-body">
            <!-- 分类导航 -->
            <nav class="ns-nav">
                <button
                    v-for="cat in categories"
                    :key="cat.key"
                    type="button"
                    class="ns-nav-item"
                    :class="{ 'is-active': cat.key === active, 'is-disabled': !cat.ready }"
                    :disabled="!cat.ready"
                    @click="active = cat.key"
                >
                    <font-awesome-icon :icon="cat.icon" class="ns-nav-icon" />
                    <span class="ns-nav-text">{{ $t(cat.label) }}</span>
                    <span v-if="!cat.ready" class="ns-nav-soon">{{ $t('notes.settingsSoon') }}</span>
                </button>
            </nav>

            <!-- 通用设置（v1.1.7：排在「瞬间设置」前面，所有笔记类型共用） -->
            <section v-if="active === 'general'" class="ns-panel">
                <p class="ns-scope">{{ $t('notes.settingsScope') }}</p>

                <!-- 1. 页面加载设置 -->
                <div class="ns-field">
                    <div class="ns-label">{{ $t('notes.pageLoad') }}</div>
                    <el-radio-group v-model="form.pageLoad" class="ns-radios">
                        <el-radio value="auto">{{ $t('notes.pageLoadAuto') }}</el-radio>
                        <el-radio value="manual">{{ $t('notes.pageLoadManual') }}</el-radio>
                    </el-radio-group>
                    <p class="ns-tip">{{ $t('notes.pageLoadTip') }}</p>
                </div>

                <el-divider class="ns-divider" />

                <!-- 2. 字体大小设置 -->
                <div class="ns-field">
                    <div class="ns-label">{{ $t('notes.fontSize') }}</div>
                    <div class="ns-sub">
                        <div class="ns-sub-row is-font">
                            <span class="ns-sub-label">{{ $t('notes.fontSizeLabel') }}</span>
                            <el-slider
                                v-model="form.fontSize"
                                class="ns-font-slider"
                                :min="fontMin"
                                :max="fontMax"
                                :step="fontStep"
                                :show-tooltip="false"
                            />
                            <span class="ns-font-value">{{ form.fontSize }} px</span>
                        </div>
                        <!-- 实时预览：只预览正文，避免用户以为标题也会跟着变 -->
                        <p
                            class="ns-tip ns-preview ns-font-preview"
                            :style="{ fontSize: form.fontSize + 'px', lineHeight: 1.75 }"
                        >
                            {{ $t('notes.fontSizePreview') }}
                        </p>
                    </div>
                    <p class="ns-tip">{{ $t('notes.fontSizeTip') }}</p>
                </div>

                <el-divider class="ns-divider" />

                <!--
                    3. 笔记页背景图（v1.1.8 新增）
                    与「系统管理 → 网页设置 → 管理页背景图」同一套机制：
                    存多行文本、多张时刷新随机一张、只在日间模式生效。
                    这里**不做即时预览** —— 背景图属于整页观感，在设置弹窗里预览看不出效果，
                    反而会遮住表单。保存后回到列表即可看到。
                -->
                <div class="ns-field">
                    <div class="ns-label">{{ $t('notes.pageBg') }}</div>
                    <el-input
                        v-model="form.pageBg"
                        type="textarea"
                        class="ns-page-bg-input"
                        :rows="3"
                        :placeholder="$t('notes.pageBgPlaceholder')"
                        spellcheck="false"
                    />
                    <p class="ns-tip">{{ $t('notes.pageBgTip') }}</p>
                </div>
            </section>

            <!-- 瞬间设置 -->
            <section v-else-if="active === 'moment'" class="ns-panel">
                <p class="ns-scope">{{ $t('notes.settingsScope') }}</p>
                <!-- 1. 附件区大小 -->
                <div class="ns-field">
                    <div class="ns-label">{{ $t('notes.attachSize') }}</div>
                    <el-radio-group v-model="form.attachSize" class="ns-radios">
                        <el-radio value="custom">{{ $t('notes.attachSizeCustom') }}</el-radio>
                        <el-radio value="default">{{ $t('notes.attachSizeDefault') }}</el-radio>
                    </el-radio-group>
                    <p class="ns-tip">{{ $t('notes.attachSizeTip') }}</p>

                    <!-- 子级：占页面最高比例（只在选了「指定比例」时出现） -->
                    <div v-if="form.attachSize === 'custom'" class="ns-sub">
                        <div class="ns-sub-row">
                            <span class="ns-sub-label">{{ $t('notes.attachRatio') }}</span>
                            <el-input-number
                                v-model="form.attachRatio"
                                :min="ratioMin"
                                :max="ratioMax"
                                :step="1"
                                :precision="0"
                                controls-position="right"
                                size="small"
                                class="ns-ratio-input"
                            />
                            <span class="ns-ratio-unit">%</span>
                        </div>
                        <p class="ns-tip">{{ $t('notes.attachRatioTip', { min: ratioMin, max: ratioMax }) }}</p>
                        <!-- 实时换算：让用户填之前就知道效果，不用保存后回列表试。
                             结果按「比例 + 视口高度」缓存在 Cookie 里，同一窗口尺寸下再次打开直接显示。 -->
                        <p class="ns-tip ns-preview">
                            {{ $t('notes.attachPreview', { vh: viewportPx, h3: preview[0], h2: preview[1], h1: preview[2] }) }}
                        </p>
                        <p class="ns-tip ns-preview ns-preview-sub">
                            {{ $t('notes.attachPreviewSingle', { vh: viewportPx, h: previewSingle }) }}
                        </p>
                    </div>
                </div>

                <el-divider class="ns-divider" />

                <!-- 2. 附件区位置 -->
                <div class="ns-field">
                    <div class="ns-label">{{ $t('notes.attachAlign') }}</div>
                    <el-radio-group v-model="form.attachAlign" class="ns-radios">
                        <el-radio value="left">{{ $t('notes.attachAlignLeft') }}</el-radio>
                        <el-radio value="center">{{ $t('notes.attachAlignCenter') }}</el-radio>
                    </el-radio-group>
                    <p class="ns-tip">{{ $t('notes.attachAlignTip') }}</p>
                </div>

                <el-divider class="ns-divider" />

                <!-- 3. 内容排版样式 -->
                <div class="ns-field">
                    <div class="ns-label">{{ $t('notes.layoutStyle') }}</div>
                    <el-radio-group v-model="form.layoutStyle" class="ns-radios">
                        <el-radio value="divider">{{ $t('notes.layoutDivider') }}</el-radio>
                        <el-radio value="default">{{ $t('notes.layoutDefault') }}</el-radio>
                    </el-radio-group>
                    <p class="ns-tip">{{ $t('notes.layoutStyleTip') }}</p>
                </div>

                <el-divider class="ns-divider" />

                <!-- 4. 附件数量加载 -->
                <div class="ns-field">
                    <div class="ns-label">{{ $t('notes.attachRows') }}</div>
                    <el-radio-group v-model="form.attachRows" class="ns-radios">
                        <el-radio :value="2">{{ $t('notes.attachRows2') }}</el-radio>
                        <el-radio :value="3">{{ $t('notes.attachRows3') }}</el-radio>
                        <el-radio :value="1">{{ $t('notes.attachRows1') }}</el-radio>
                    </el-radio-group>
                    <p class="ns-tip">{{ $t('notes.attachRowsTip') }}</p>
                </div>
            </section>

            <!-- 未开放分类（按钮本身已禁用，这里只是双保险） -->
            <section v-else class="ns-panel ns-panel-empty">
                <p>{{ $t('notes.settingsSoon') }}</p>
            </section>
        </div>

        <template #footer>
            <div class="ns-foot">
                <el-button size="small" :disabled="saving" @click="resetToDefault">
                    {{ $t('notes.settingsReset') }}
                </el-button>
                <span class="ns-foot-spacer"></span>
                <el-button size="small" :disabled="saving" @click="visible = false">
                    {{ $t('common.cancel') }}
                </el-button>
                <el-button size="small" type="primary" :loading="saving" @click="save">
                    {{ $t('common.save') }}
                </el-button>
            </div>
        </template>
    </el-dialog>
</template>

<script>
import {
    noteSettings,
    DEFAULT_GENERAL_SETTINGS,
    DEFAULT_MOMENT_SETTINGS,
    NOTE_FONT_SIZE_MIN,
    NOTE_FONT_SIZE_MAX,
    NOTE_FONT_SIZE_STEP,
    saveNoteSettings,
    budgetOf,
    singleBudgetOf,
    viewportHeight,
    readPreviewCache,
    writePreviewCache,
    ATTACH_RATIO_MIN,
    ATTACH_RATIO_MAX,
    normalizePageBg
} from '@/utils/noteSettings';
import { bindDialogLayers } from '@/utils/layerStack';

/** 分类定稿后不再变，直接常量放外面（避免每次渲染重建数组） */
const CATEGORIES = [
    // v1.1.7：新增「通用设置」，排在「瞬间设置」前面
    { key: 'general', label: 'notes.settingsGeneral', icon: 'sliders-h', ready: true },
    { key: 'moment', label: 'notes.settingsMoment', icon: 'bolt', ready: true },
    { key: 'todo', label: 'notes.settingsTodo', icon: 'check-square', ready: false },
    { key: 'nav', label: 'notes.settingsNav', icon: 'compass', ready: false },
    { key: 'article', label: 'notes.settingsArticle', icon: 'file-alt', ready: false },
    { key: 'collection', label: 'notes.settingsCollection', icon: 'layer-group', ready: false }
];

export default {
    name: 'NoteSettingsDialog',
    props: {
        modelValue: { type: Boolean, default: false },
        /** 当前实例：设置按实例隔离，保存时必须带上 */
        instanceId: { type: String, default: '' }
    },
    emits: ['update:modelValue', 'saved'],
    data() {
        return {
            active: 'general',
            saving: false,
            // 表单用副本：点「取消」直接丢弃，不会把半改的设置漏到列表上
            form: { ...DEFAULT_GENERAL_SETTINGS, ...DEFAULT_MOMENT_SETTINGS },
            ratioMin: ATTACH_RATIO_MIN,
            ratioMax: ATTACH_RATIO_MAX,
            fontMin: NOTE_FONT_SIZE_MIN,
            fontMax: NOTE_FONT_SIZE_MAX,
            fontStep: NOTE_FONT_SIZE_STEP
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
        categories() {
            return CATEGORIES;
        },
        dialogWidth() {
            return window.innerWidth <= 768 ? '92vw' : '640px';
        },
        /** 示例换算用的视口高度（取整只为显示好看，计算仍用精确值） */
        viewportPx() {
            return Math.round(viewportHeight.value);
        },
        /**
         * 三行 / 两行 / 一行的实际像素高。
         *
         * 优先读 Cookie 缓存（键 = 比例 + 视口高度）：这两个值没变，结果必然一样，
         * 没必要每次打开设置页都重算一遍；变了就重算并回写缓存。
         * 计算复用 budgetOf（纯函数），保证「预览里看到的」与「列表里渲染的」
         * 是同一套算法 —— 不在这里复制一份公式，复制迟早会跟实现跑偏。
         */
        preview() {
            const ratio = Number(this.form.attachRatio) || DEFAULT_MOMENT_SETTINGS.attachRatio;
            const vh = viewportHeight.value;
            const cached = readPreviewCache(ratio, vh);
            if (cached) return cached;

            const setting = { attachSize: 'custom', attachRatio: ratio, attachAlign: this.form.attachAlign };
            // 9 个 → 3 行、6 个 → 2 行、3 个 → 1 行（都用 3 列口径，与列表一致）
            const samples = [
                { count: 9, cols: 3 },
                { count: 6, cols: 3 },
                { count: 3, cols: 3 }
            ];
            const heights = samples.map((it) => {
                const b = budgetOf(it.count, it.cols, setting, vh);
                return b ? Math.round(b.height) : 0;
            });
            writePreviewCache(ratio, vh, heights);
            return heights;
        },
        /**
         * 单个附件的高度（v1.1.2.3：总高 = 视口高度 x 比例 x 80%）。
         * 高度与宽高比无关（宽度才随比例变），所以这里只报高度即可。
         */
        previewSingle() {
            const ratio = Number(this.form.attachRatio) || DEFAULT_MOMENT_SETTINGS.attachRatio;
            const b = singleBudgetOf({ attachSize: 'custom', attachRatio: ratio }, viewportHeight.value, 0, 4 / 3);
            return b ? b.height : 0;
        }
    },
    watch: {
        modelValue(v) {
            if (v) this.syncFromStore();
        }
    },
    /*
     * v1.1.9.1（需求：笔记管理中的笔记设置弹出页要纳入 closePageOrder / hasOpenLayer 层叠监测）
     * 它是 el-dialog、开关来自 prop，所以关闭动作走 $emit('update:modelValue', false)。
     */
    mounted() {
        this._unbindLayers = bindDialogLayers(this, {
            modelValue: { id: 'note-settings', close: () => this.$emit('update:modelValue', false) }
        });
    },
    beforeUnmount() {
        if (this._unbindLayers) {
            this._unbindLayers();
            this._unbindLayers = null;
        }
    },
    methods: {
        /** 打开时把全局设置拷进表单（全局值可能已被别的标签页改过） */
        syncFromStore() {
            this.active = 'general';
            this.form = {
                ...DEFAULT_GENERAL_SETTINGS,
                ...DEFAULT_MOMENT_SETTINGS,
                ...(noteSettings.general || {}),
                ...(noteSettings.moment || {})
            };
        },
        resetToDefault() {
            this.form = { ...DEFAULT_GENERAL_SETTINGS, ...DEFAULT_MOMENT_SETTINGS };
        },
        async save() {
            if (this.saving) return;
            this.saving = true;
            try {
                await saveNoteSettings(this.instanceId, {
                    general: {
                        pageLoad: this.form.pageLoad === 'manual' ? 'manual' : 'auto',
                        fontSize: Number(this.form.fontSize) || DEFAULT_GENERAL_SETTINGS.fontSize,
                        // v1.1.8：背景图先在前端收敛成 `["url1","url2"]`，脏地址直接丢掉
                        pageBg: normalizePageBg(this.form.pageBg)
                    },
                    moment: {
                        attachSize: this.form.attachSize,
                        attachRatio: Number(this.form.attachRatio) || DEFAULT_MOMENT_SETTINGS.attachRatio,
                        attachAlign: this.form.attachAlign,
                        layoutStyle: this.form.layoutStyle,
                        attachRows: Number(this.form.attachRows) || 3
                    }
                });
                this.$message.success(this.$t('notes.settingsSaved'));
                this.$emit('saved', { ...noteSettings.moment });
                this.visible = false;
            } catch (e) {
                this.$message.error(this.$t('notes.settingsSaveFail', { msg: (e && e.message) || '' }));
            } finally {
                this.saving = false;
            }
        },
        onClosed() {
            this.saving = false;
        }
    }
};
</script>

<style scoped>
.ns-body {
    display: flex;
    gap: 14px;
    min-height: 320px;
}

/* 左侧分类 */
.ns-nav {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 0 0 150px;
    padding-right: 12px;
    border-right: 1px solid var(--el-border-color-lighter);
}

.ns-nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-regular);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.18s, color 0.18s;
}

.ns-nav-item:hover:not(.is-disabled) {
    background: var(--el-fill-color-light);
}

.ns-nav-item.is-active {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    font-weight: 600;
}

.ns-nav-item.is-disabled {
    color: var(--el-text-color-disabled);
    cursor: not-allowed;
}

.ns-nav-icon {
    width: 14px;
    font-size: 13px;
}

.ns-nav-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ns-nav-soon {
    flex: 0 0 auto;
    padding: 0 4px;
    border-radius: 6px;
    background: var(--el-fill-color);
    color: var(--el-text-color-disabled);
    font-size: 10px;
    font-weight: 400;
    line-height: 16px;
}

/* 右侧面板 */
.ns-panel {
    flex: 1 1 auto;
    min-width: 0;
}

.ns-panel-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

/* 作用域说明：提醒用户「设置按实例隔离」 */
.ns-scope {
    margin: 0 0 14px;
    padding: 7px 10px;
    border-radius: 6px;
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    font-size: 12px;
    line-height: 1.5;
}

.ns-field + .ns-field {
    margin-top: 4px;
}

.ns-label {
    margin-bottom: 8px;
    color: var(--el-text-color-primary);
    font-size: 13px;
    font-weight: 600;
}

.ns-radios {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
}

.ns-tip {
    margin: 8px 0 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.6;
}

.ns-sub {
    margin-top: 12px;
    padding: 12px;
    border-radius: 8px;
    background: var(--el-fill-color-lighter);
}

.ns-sub-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.ns-sub-label {
    font-size: 13px;
    color: var(--el-text-color-regular);
}

.ns-ratio-input {
    width: 110px;
}

.ns-ratio-unit {
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

/* v1.1.7：字号行的标签不许换行（宽度被滑块挤时会出现「正文 / 大小」两行） */
.ns-sub-row.is-font .ns-sub-label {
    flex: 0 0 auto;
    white-space: nowrap;
}

/* v1.1.7：字体大小设置 —— 滑块占满剩余宽度，右侧固定显示当前 px */
.ns-font-slider {
    flex: 1 1 auto;
    min-width: 120px;
    margin: 0 4px;
}

.ns-font-value {
    flex: 0 0 auto;
    min-width: 52px;
    color: var(--el-text-color-regular);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: right;
}

/* 字号预览块：底色沿用 .ns-preview，这里只压掉上下抖动 */
.ns-font-preview {
    margin-top: 10px;
    white-space: pre-wrap;
    word-break: break-word;
}

.ns-preview {
    margin-top: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-regular);
}

.ns-divider {
    margin: 18px 0;
}

/*
 * v1.1.8：背景图输入框用等宽字体 —— 里面填的是 `["url1","url2"]` 这种带引号逗号的串，
 * 等宽比比例字体好核对，也能让用户一眼看出自己有没有漏引号。
 */
.ns-page-bg-input :deep(.el-textarea__inner) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.7;
    overflow-wrap: anywhere;
}

/* 第二个预览块（单个附件）与上面那条连在一起，去掉多余的间距感 */
.ns-preview + .ns-preview-sub {
    margin-top: 6px;
}

.ns-foot {
    display: flex;
    align-items: center;
    gap: 8px;
}

.ns-foot-spacer {
    flex: 1 1 auto;
}

@media (max-width: 768px) {
    .ns-body {
        flex-direction: column;
        min-height: 0;
    }

    /* 移动端分类改成横向可滚的胶囊条，不占高度 */
    .ns-nav {
        flex: 0 0 auto;
        flex-direction: row;
        gap: 6px;
        overflow-x: auto;
        padding: 0 0 10px;
        border-right: none;
        border-bottom: 1px solid var(--el-border-color-lighter);
    }

    .ns-nav-item {
        width: auto;
        flex: 0 0 auto;
        padding: 6px 10px;
        border: 1px solid var(--el-border-color-lighter);
        border-radius: 999px;
        white-space: nowrap;
    }

    .ns-nav-soon {
        display: none;
    }

    .ns-foot {
        flex-wrap: wrap;
    }
}
</style>

<style>
/*
 * el-dialog 的正文节点由 Element Plus 自己的 ElDialogContent 渲染并 teleport 到 body，
 * scoped 的 :deep() 找不到宿主 —— 弹窗本体样式必须放非 scoped 全局块，
 * 并且用 `.el-dialog.xxx` 双类名限定，避免命中其它弹窗（这是 v1.1.2 踩过的坑）。
 */
.el-dialog.note-settings-dialog .el-dialog__body {
    padding-top: 6px;
}
</style>
