<template>
    <!--
        编辑器设置弹窗（v1.4.1）
        ----------------------------------------------------------------------------
        从记事管理页里那份设置搬出来，做成独立组件，供「编辑器工具栏最后一格」调用 ——
        需求要求任何编辑器的工具栏里都能打开设置，而文章 / 待办编辑页并没有记事页那套外壳。

        关键点：保存时把「读到的完整设置」和「本次改动的字段」合并后整体提交。
        后端 normalizeEditorSettings 对缺省字段会填默认值，只提交半份会把用户
        其它没在这一屏里改的配置（比如选中图片工具）悄悄清空。
    -->
    <el-dialog
        v-model="visible"
        :title="$t('memo.editorSettings')"
        width="560px"
        append-to-body
        class="memo-settings-dialog me-settings-dlg"
        @open="onOpen"
    >
        <div v-loading="loading">
            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.toolbarConfig') }}</label>
                <p class="ms-tip">{{ $t('memo.toolbarTip') }}</p>
                <textarea v-model="draft.toolbar" class="ms-textarea" rows="5" spellcheck="false"></textarea>
                <p class="ms-tip ms-token-title">{{ $t('memo.toolbarAvail') }}：</p>
                <p class="ms-token-text">{{ availableTokens }}</p>
            </div>

            <!-- v1.4.1（需求）：回车插入实体换行 -->
            <div class="ms-field ms-row">
                <div>
                    <label class="ms-label">{{ $t('memo.hardBreakOnEnter') }}</label>
                    <p class="ms-tip">{{ $t('memo.hardBreakOnEnterTip') }}</p>
                </div>
                <el-switch v-model="draft.hardBreakOnEnter" />
            </div>

            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.inputToolsConfig') }}</label>
                <p class="ms-tip">{{ $t('memo.inputToolsTip') }}</p>
                <textarea v-model="draft.inputTools" class="ms-textarea" rows="3" spellcheck="false"></textarea>
            </div>

            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.slashToolsConfig') }}</label>
                <p class="ms-tip">{{ $t('memo.slashToolsTip') }}</p>
                <textarea v-model="draft.slashTools" class="ms-textarea" rows="4" spellcheck="false"></textarea>
            </div>

            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.ctxToolsConfig') }}</label>
                <p class="ms-tip">{{ $t('memo.ctxToolsTip') }}</p>
                <textarea v-model="draft.rightClickTools" class="ms-textarea" rows="3" spellcheck="false"></textarea>
            </div>

            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.selTextToolsConfig') }}</label>
                <p class="ms-tip">{{ $t('memo.selToolsTip') }}</p>
                <textarea v-model="draft.selectionTools" class="ms-textarea" rows="3" spellcheck="false"></textarea>
            </div>

            <!-- v1.4.1（需求）：这组改名「编辑区样式设置」，并加入编辑区背景色 -->
            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.styleTitle') }}</label>
                <p class="ms-tip">{{ $t('memo.styleCssTip') }}</p>
                <textarea
                    v-model="draft.customCss"
                    class="ms-textarea ms-css-textarea"
                    rows="6"
                    spellcheck="false"
                    :placeholder="cssPlaceholder"
                ></textarea>
            </div>
            <div class="ms-field ms-row">
                <div>
                    <label class="ms-label">{{ $t('memo.editorBgColor') }}</label>
                    <p class="ms-tip">{{ $t('memo.editorBgColorTip') }}</p>
                </div>
                <div class="ms-color-pick">
                    <el-color-picker v-model="draft.bgColor" size="small" :predefine="bgPresets" />
                    <button v-if="draft.bgColor" type="button" class="ms-color-reset" @click="draft.bgColor = ''">
                        {{ $t('memo.editorBgReset') }}
                    </button>
                </div>
            </div>

            <div class="ms-field">
                <label class="ms-label">{{ $t('memo.stickyTitle') }}</label>
                <p class="ms-tip">{{ $t('memo.stickyTip') }}</p>
                <div class="ms-sticky-table">
                    <div class="ms-sticky-head">
                        <span></span>
                        <span>{{ $t('memo.stickyPc') }}</span>
                        <span>{{ $t('memo.stickyMobile') }}</span>
                    </div>
                    <div v-for="row in stickyRows" :key="`st-${row.key}`" class="ms-sticky-row">
                        <span class="ms-sticky-name">{{ $t(row.label) }}</span>
                        <el-switch v-model="draft.sticky.pc[row.key]" size="small" />
                        <el-switch v-model="draft.sticky.m[row.key]" size="small" />
                    </div>
                </div>
            </div>

            <div class="ms-field ms-row">
                <div>
                    <label class="ms-label">{{ $t('memo.colorMode') }}</label>
                    <p class="ms-tip">{{ $t('memo.colorModeTip') }}</p>
                </div>
                <el-select v-model="draft.theme" style="width: 140px">
                    <el-option :label="$t('memo.themeAuto')" value="auto" />
                    <el-option :label="$t('memo.themeLight')" value="light" />
                    <el-option :label="$t('memo.themeDark')" value="dark" />
                </el-select>
            </div>

            <div class="ms-field ms-row">
                <div>
                    <label class="ms-label">{{ $t('memo.historyInterval') }}</label>
                    <p class="ms-tip">{{ $t('memo.historyIntervalTip') }}</p>
                </div>
                <el-input-number
                    v-model="draft.historyInterval"
                    :min="1"
                    :max="120"
                    :step="1"
                    controls-position="right"
                    style="width: 140px"
                />
            </div>

            <div class="ms-field ms-row">
                <div>
                    <label class="ms-label">{{ $t('memo.blockIds') }}</label>
                    <p class="ms-tip">{{ $t('memo.blockIdsTip') }}</p>
                </div>
                <el-switch v-model="draft.blockIds" />
            </div>
        </div>

        <template #footer>
            <el-button @click="visible = false">{{ $t('common.cancel') }}</el-button>
            <el-button type="primary" :loading="saving" @click="save">{{ $t('common.confirm') }}</el-button>
        </template>
    </el-dialog>
</template>

<script>
import { ElMessage } from 'element-plus';
import axios from '@/utils/axios';
import { DEFAULT_TOOLBAR_LINES, TOOLBAR_TOKENS, DEFAULT_CUSTOM_CSS, DEFAULT_STICKY } from '@/utils/memoEditorConfig';

/** 与后端 DEFAULT_EDITOR_STYLES 对齐（只用于兜底，正常都以接口返回为准） */
const FALLBACK_STYLES = {
    h1: 1.75,
    h2: 1.45,
    h3: 1.24,
    h4: 1.1,
    h5: 1,
    h6: 0.94,
    lineHeight: 1.75,
    customCss: DEFAULT_CUSTOM_CSS,
    bgColor: '',
};

const splitLines = (v) =>
    String(v || '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);

export default {
    name: 'EditorSettingsDialog',
    props: {
        modelValue: { type: Boolean, default: false },
        instanceId: { type: String, default: '' },
        /** 打开时先拿它兜底，接口回来再覆盖（离线 / 接口挂了也能改） */
        editorConfig: { type: Object, default: () => ({}) },
    },
    emits: ['update:modelValue', 'saved'],
    data() {
        return {
            loading: false,
            saving: false,
            /** 接口返回的完整设置，保存时作为底稿合并 */
            raw: null,
            draft: {
                toolbar: '',
                blockIds: false,
                theme: 'auto',
                inputTools: '',
                slashTools: '',
                rightClickTools: '',
                selectionTools: '',
                historyInterval: 3,
                hardBreakOnEnter: false,
                customCss: '',
                bgColor: '',
                sticky: JSON.parse(JSON.stringify(DEFAULT_STICKY)),
            },
            stickyRows: [
                { key: 'toolbar', label: 'memo.stickyToolbar' },
                { key: 'title', label: 'memo.stickyTitleBar' },
            ],
            bgPresets: ['#C7EDCC', '#FFFFFF', '#FBF3E4', '#E8F1FB', '#F2F3F5'],
        };
    },
    computed: {
        visible: {
            get() {
                return this.modelValue;
            },
            set(v) {
                this.$emit('update:modelValue', v);
            },
        },
        availableTokens() {
            return (Array.isArray(TOOLBAR_TOKENS) ? TOOLBAR_TOKENS : []).join(' ');
        },
        cssPlaceholder() {
            return 'h1 { font-size: 1.9em; color: #1f2937 }\np { line-height: 1.9 }';
        },
    },
    methods: {
        async onOpen() {
            this.loading = true;
            try {
                const res = await axios.get('/api/notes/settings', { params: { instanceId: this.instanceId } });
                const ed = res?.data?.data?.editor;
                this.raw = ed && typeof ed === 'object' ? JSON.parse(JSON.stringify(ed)) : null;
            } catch (e) {
                this.raw = null;
            }
            this.fillDraft(this.raw || this.editorConfig || {});
            this.loading = false;
        },
        fillDraft(ed) {
            const styles = { ...FALLBACK_STYLES, ...(ed.styles || {}) };
            this.draft = {
                toolbar: (Array.isArray(ed.toolbarLines) && ed.toolbarLines.length
                    ? ed.toolbarLines
                    : DEFAULT_TOOLBAR_LINES
                ).join('\n'),
                blockIds: !!ed.blockIds,
                theme: ['auto', 'light', 'dark'].includes(ed.theme) ? ed.theme : 'auto',
                inputTools: (ed.inputLines || []).join('\n'),
                slashTools: (ed.slashLines || []).join('\n'),
                rightClickTools: (ed.rightClickLines || []).join('\n'),
                selectionTools: (ed.selectionLines || []).join('\n'),
                historyInterval: Number(ed.historyInterval) || 3,
                hardBreakOnEnter: ed.hardBreakOnEnter === true,
                customCss: String(styles.customCss || ''),
                bgColor: String(styles.bgColor || ''),
                sticky: JSON.parse(JSON.stringify(ed.sticky || DEFAULT_STICKY)),
            };
        },
        async save() {
            this.saving = true;
            const lines = splitLines(this.draft.toolbar);
            const base = this.raw || this.editorConfig || {};
            const styles = { ...FALLBACK_STYLES, ...(base.styles || {}), customCss: String(this.draft.customCss || ''), bgColor: String(this.draft.bgColor || '') };
            const editor = {
                ...base,
                toolbarLines: lines.length ? lines : DEFAULT_TOOLBAR_LINES.slice(),
                blockIds: !!this.draft.blockIds,
                theme: ['auto', 'light', 'dark'].includes(this.draft.theme) ? this.draft.theme : 'auto',
                inputLines: splitLines(this.draft.inputTools).slice(0, 8),
                slashLines: splitLines(this.draft.slashTools).slice(0, 12),
                rightClickLines: splitLines(this.draft.rightClickTools).slice(0, 12),
                selectionLines: splitLines(this.draft.selectionTools).slice(0, 12),
                historyInterval: Math.min(120, Math.max(1, Number(this.draft.historyInterval) || 3)),
                hardBreakOnEnter: !!this.draft.hardBreakOnEnter,
                styles,
                sticky: JSON.parse(JSON.stringify(this.draft.sticky || DEFAULT_STICKY)),
            };
            try {
                await axios.put('/api/notes/settings', { instanceId: this.instanceId, editor });
                this.raw = JSON.parse(JSON.stringify(editor));
                this.$emit('saved', editor);
                this.visible = false;
                ElMessage.success(this.$t('memo.settingsSaved'));
            } catch (e) {
                ElMessage.error(e?.response?.data?.message || this.$t('memo.saveFail'));
            } finally {
                this.saving = false;
            }
        },
    },
};
</script>

<style scoped>
/* 与记事页的设置面板同款排版（原样式在 MemoPage 里是 scoped，这里独立一份） */
.ms-field {
    margin-bottom: 18px;
    text-align: left;
}
.ms-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}
.ms-label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    margin-bottom: 4px;
}
.ms-tip {
    margin: 0 0 6px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
}
.ms-token-title {
    margin-top: 8px;
}
.ms-token-text {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.7;
    color: var(--el-text-color-placeholder);
    word-break: break-all;
}
.ms-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    background: var(--el-bg-color);
    color: var(--el-text-color-primary);
    font-size: 12.5px;
    line-height: 1.6;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    resize: vertical;
    outline: none;
}
.ms-textarea:focus {
    border-color: var(--el-color-primary);
}
.ms-css-textarea {
    min-height: 110px;
}
.ms-sticky-table {
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    overflow: hidden;
}
.ms-sticky-head,
.ms-sticky-row {
    display: grid;
    grid-template-columns: 1fr 72px 72px;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    font-size: 12.5px;
}
.ms-sticky-head {
    background: var(--el-fill-color-light);
    color: var(--el-text-color-secondary);
    font-size: 12px;
    text-align: center;
}
.ms-sticky-head > span:first-child {
    text-align: left;
}
.ms-sticky-row + .ms-sticky-row {
    border-top: 1px solid var(--el-border-color-lighter);
}
.ms-sticky-name {
    color: var(--el-text-color-regular);
}
.ms-sticky-row :deep(.el-switch) {
    justify-self: center;
}
.ms-color-pick {
    display: flex;
    align-items: center;
    gap: 8px;
}
.ms-color-reset {
    border: none;
    background: transparent;
    color: var(--el-color-primary);
    font-size: 12px;
    cursor: pointer;
    padding: 0;
}
</style>
