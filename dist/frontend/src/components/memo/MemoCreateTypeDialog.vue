<template>
    <!--
        v1.3.9.1：添加记事类型选择弹窗（公共组件）。
        三处入口共用同一份 UI 与创建逻辑：
          · 记事管理页（/memo）顶部「添加记事」按钮；
          · 首页「发布」模式的「笔记」按钮；
          · 「我的发布」页的「笔记」分类按钮。
        5 种类型各有默认标题与默认落点（后端 createNode 负责，前端只传 type / parentId）。
        需求：首页与「我的发布」的入口在选择类型并创建后，
        由调用方决定怎么打开编辑页（新标签页 window.open('/memo?id=xxx')），
        组件只负责「选类型 → 创建 → emit('created', 结果)」。
    -->
    <el-dialog
        :model-value="modelValue"
        :title="$t('memo.createTitle')"
        width="440px"
        append-to-body
        class="memo-create-dialog"
        @update:model-value="(v) => $emit('update:modelValue', v)"
    >
        <p class="memo-create-tip">{{ parentId ? $t('memo.createChildTip') : $t('memo.createTip') }}</p>
        <div class="memo-create-list">
            <button
                v-for="t in createTypes"
                :key="t.key"
                type="button"
                class="memo-create-item"
                :disabled="creating"
                @click="doCreate(t.key)"
            >
                <font-awesome-icon :icon="t.icon" class="memo-create-icon" />
                <span class="memo-create-body">
                    <span class="memo-create-name">{{ $t(t.label) }}</span>
                    <span class="memo-create-desc">{{ $t(t.desc) }}</span>
                </span>
            </button>
        </div>
    </el-dialog>
</template>

<script>
import { ElMessage } from 'element-plus';
import { createNode as apiCreateNode, memoError } from '@/utils/memoApi';

export default {
    name: 'MemoCreateTypeDialog',
    props: {
        /** 弹窗显隐（v-model） */
        modelValue: { type: Boolean, default: false },
        /** 非空 = 在该节点下新建子文档（同类型直建场景用） */
        parentId: { type: String, default: '' },
    },
    emits: ['update:modelValue', 'created'],
    data() {
        return {
            creating: false,
            createTypes: [
                { key: 'note', icon: 'book', label: 'memo.typeNote', desc: 'memo.typeNoteDesc' },
                { key: 'diary', icon: 'calendar', label: 'memo.typeDiary', desc: 'memo.typeDiaryDesc' },
                { key: 'journal', icon: 'edit', label: 'memo.typeJournal', desc: 'memo.typeJournalDesc' },
                { key: 'inspiration', icon: 'bolt', label: 'memo.typeInspiration', desc: 'memo.typeInspirationDesc' },
                // v1.3.9.1：模板分类，默认落到 /模板，供编辑器「导入模板」使用
                { key: 'template', icon: 'clone', label: 'memo.typeTemplate', desc: 'memo.typeTemplateDesc' },
            ],
        };
    },
    methods: {
        async doCreate(type) {
            if (this.creating) return;
            this.creating = true;
            try {
                const r = await apiCreateNode({ type, parentId: this.parentId || '' });
                if (!r?.id) throw new Error(this.$t('memo.saveFail'));
                this.$emit('update:modelValue', false);
                this.$emit('created', r);
                // 同名日记已存在时后端直接返回已有日记，提示口径由调用方区分
                ElMessage.success(r?.existed ? this.$t('memo.openedExistingDiary') : this.$t('memo.created'));
            } catch (e) {
                ElMessage.error(memoError(e).message || this.$t('memo.saveFail'));
            } finally {
                this.creating = false;
            }
        },
    },
};
</script>

<!-- 样式跟组件走：三个入口页共用同一份（scoped 保证不外泄） -->
<style scoped>
.memo-create-tip {
    margin: 0 0 10px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
}
.memo-create-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.memo-create-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-bg-color);
    cursor: pointer;
    text-align: left;
}
.memo-create-item:hover {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
}
.memo-create-item:disabled {
    opacity: 0.6;
    cursor: default;
}
.memo-create-icon {
    flex: 0 0 auto;
    width: 18px;
    font-size: 15px;
    color: var(--el-color-primary);
    text-align: center;
}
.memo-create-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.memo-create-name {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--el-text-color-primary);
}
.memo-create-desc {
    font-size: 11.5px;
    color: var(--el-text-color-secondary);
}
</style>
