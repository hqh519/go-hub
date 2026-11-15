<template>
    <!--
        实例切换弹窗（v1.3.1.1）
        ----------------------------------------------------------------------------
        从「瞬间管理」页内联的那一份抽出来，供笔记管理页复用 —— 需求要求笔记管理页的
        「切换实例」与「我的发布」完全一致：位置在下拉尾部、弹窗样式、切换后的行为都照搬，
        所以做成同一个组件，不各写一遍（各写一遍必然慢慢走样）。

        交互与「我的发布」一致：
          · 列表 = 默认实例 + 本人创建 / 加入的实例（按创建时间升序编号）；
          · 点一条 → 触发 switch 事件（父组件负责验证切换密码 + 落盘 + 重载数据）；
          · 底部「实例管理」→ 打开用户编辑页的实例管理锚点。
    -->
    <el-dialog
        :model-value="modelValue"
        :title="$t('instancePicker.title')"
        width="420px"
        append-to-body
        align-center
        class="instance-switch-dialog"
        @update:model-value="$emit('update:modelValue', $event)"
    >
        <div class="instance-switch-list">
            <button
                type="button"
                class="instance-switch-item"
                :class="{ 'is-active': !instanceId }"
                @click="$emit('switch', '')"
            >
                <span class="instance-switch-icon"><font-awesome-icon icon="server" /></span>
                <span class="instance-switch-name">{{ $t('instancePicker.defaultInstance') }}</span>
                <font-awesome-icon v-if="!instanceId" icon="check" class="instance-switch-check" />
            </button>
            <button
                v-for="ins in instances"
                :key="'sw-' + ins.id"
                type="button"
                class="instance-switch-item"
                :class="{ 'is-active': String(instanceId) === String(ins.id) }"
                @click="$emit('switch', ins.id)"
            >
                <span class="instance-switch-seq">{{ seqOf(ins) }}</span>
                <span class="instance-switch-name">{{ ins.name }}</span>
                <span v-if="ins.note" class="instance-switch-note">{{ ins.note }}</span>
                <font-awesome-icon
                    v-if="String(instanceId) === String(ins.id)"
                    icon="check"
                    class="instance-switch-check"
                />
            </button>
            <div v-if="!instances.length" class="instance-switch-empty">
                {{ $t('instancePicker.empty') }}
            </div>
        </div>
        <div class="instance-switch-footer">
            <button type="button" class="instance-switch-manage" @click="$emit('manage')">
                {{ $t('instancePicker.manage') }}
            </button>
        </div>
    </el-dialog>
</template>

<script>
export default {
    name: 'InstanceSwitchDialog',
    props: {
        modelValue: { type: Boolean, default: false },
        /** 当前实例 id（空 = 默认实例） */
        instanceId: { type: String, default: '' },
        /** 实例列表（不含默认实例，已按创建时间升序） */
        instances: { type: Array, default: () => [] },
    },
    emits: ['update:modelValue', 'switch', 'manage'],
    methods: {
        /** 序号 = 在「创建时间升序」里的位置（1-based），与头像角标、页面切换下拉同一口径 */
        seqOf(ins) {
            if (Number.isFinite(Number(ins?.index)) && Number(ins.index) > 0) return Number(ins.index);
            const pos = this.instances.findIndex((i) => i && i.id === ins.id);
            return pos >= 0 ? pos + 1 : 0;
        },
    },
};
</script>

<style scoped>
.instance-switch-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 56vh;
    overflow-y: auto;
}
.instance-switch-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 10px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-family: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
}
.instance-switch-item:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
}
.instance-switch-item.is-active {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.1));
    color: var(--el-color-primary);
}
.instance-switch-icon {
    font-size: 12px;
    opacity: 0.8;
}
.instance-switch-seq {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
}
.instance-switch-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.instance-switch-note {
    font-size: 11px;
    color: var(--el-text-color-secondary);
}
.instance-switch-check {
    color: var(--el-color-primary);
}
.instance-switch-empty {
    padding: 24px 0;
    text-align: center;
    font-size: 12.5px;
    color: var(--el-text-color-secondary);
}
.instance-switch-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
}
.instance-switch-manage {
    padding: 4px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--el-color-primary);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
}
.instance-switch-manage:hover {
    text-decoration: underline;
}
</style>
