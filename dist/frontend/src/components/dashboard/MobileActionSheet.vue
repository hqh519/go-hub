<template>
    <Teleport to="body">
        <Transition name="bottom-sheet">
            <div v-if="modelValue" class="bottom-sheet-overlay" @click="close">
                <div class="bottom-sheet" @click.stop>
                    <div class="bottom-sheet-header">
                        <div class="bottom-sheet-handle"></div>
                        <span class="bottom-sheet-title">{{ title }}</span>
                    </div>
                    <div class="bottom-sheet-content">
                        <!-- v3.0.0：选择文件（进入多选并选中该文件），文件与文件夹都提供
                             v3.0.0（R8）：只读共享条目不可选中 → 隐藏 -->
                        <div v-if="!sharedReadonly" class="bottom-sheet-item" @click="handleAction('select')">
                            <font-awesome-icon icon="check-square" class="bottom-sheet-icon"></font-awesome-icon>
                            <span>{{ $t('fileManager.selectFile') }}</span>
                        </div>
                        <!-- 文件操作 -->
                        <template v-if="!isFolder">
                            <div class="bottom-sheet-item" @click="handleAction('detail')">
                                <font-awesome-icon icon="info-circle" class="bottom-sheet-icon"></font-awesome-icon>
                                <span>{{ $t('mobileAction.viewDetail') }}</span>
                            </div>
                            <div class="bottom-sheet-item" @click="handleAction('copy')">
                                <font-awesome-icon icon="copy" class="bottom-sheet-icon"></font-awesome-icon>
                                <span>{{ $t('mobileAction.copyLink') }}</span>
                            </div>
                            <div class="bottom-sheet-item" @click="handleAction('download')">
                                <font-awesome-icon icon="download" class="bottom-sheet-icon"></font-awesome-icon>
                                <span>{{ $t('mobileAction.downloadFile') }}</span>
                            </div>
                            <div class="bottom-sheet-item" @click="handleAction('move')">
                                <font-awesome-icon icon="file-export" class="bottom-sheet-icon"></font-awesome-icon>
                                <span>{{ $t('mobileAction.moveFile') }}</span>
                            </div>
                            <div class="bottom-sheet-item" @click="handleAction('tag')">
                                <font-awesome-icon icon="tags" class="bottom-sheet-icon"></font-awesome-icon>
                                <span>{{ $t('mobileAction.tagManagement') }}</span>
                            </div>
                        </template>
                        <!-- 文件夹操作 -->
                        <template v-else>
                            <div class="bottom-sheet-item" @click="handleAction('folderCopy')">
                                <font-awesome-icon icon="copy" class="bottom-sheet-icon"></font-awesome-icon>
                                <span>{{ $t('mobileAction.copyLink') }}</span>
                            </div>
                            <div class="bottom-sheet-item" @click="handleAction('move')">
                                <font-awesome-icon icon="file-export" class="bottom-sheet-icon"></font-awesome-icon>
                                <span>{{ $t('mobileAction.moveFolder') }}</span>
                            </div>
                        </template>
                        <!-- 删除操作
                             v3.0.0（R8）：共享（别人共享给我的，无论只读/编辑）一律不可删除 → 隐藏 -->
                        <div v-if="!sharedNoDelete" class="bottom-sheet-item bottom-sheet-danger" @click="handleAction('delete')">
                            <font-awesome-icon icon="trash-alt" class="bottom-sheet-icon"></font-awesome-icon>
                            <span>{{ isFolder ? $t('mobileAction.deleteFolder') : $t('mobileAction.deleteFile') }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script>
export default {
    name: 'MobileActionSheet',
    props: {
        modelValue: { type: Boolean, default: false },
        title: { type: String, default: '' },
        isFolder: { type: Boolean, default: false },
        // v3.0.0（R8）：只读共享（别人共享给我且权限只读）—— 隐藏「选择」
        sharedReadonly: { type: Boolean, default: false },
        // v3.0.0（R8）：别人共享给我的（无论只读/编辑）—— 一律隐藏「删除」
        sharedNoDelete: { type: Boolean, default: false }
    },
    emits: ['update:modelValue', 'action'],
    data() {
        return {
            /*
             * v1.1.9.4：面板打开的时刻。
             * 长按 500ms 弹面板，手指一抬起，浏览器会在抬起点的元素上补一次 click ——
             * 那个元素此刻正是刚渲染出来的 .bottom-sheet-overlay，
             * 于是「长按弹出 → 松手瞬间又被遮罩关掉」，用户完全看不到菜单。
             * 这里给一个很短的静默窗（350ms），期间遮罩点击不生效；
             * 人手不可能在 350ms 内既长按又去点遮罩，所以不会影响正常关闭。
             */
            openedAt: 0
        };
    },
    watch: {
        modelValue(v) {
            if (v) this.openedAt = Date.now();
        }
    },
    methods: {
        close() {
            if (Date.now() - this.openedAt < 350) return;
            this.$emit('update:modelValue', false);
        },
        handleAction(action) {
            this.$emit('action', action);
            // 选项是真实点击，不受静默窗限制 —— 直接关闭
            this.$emit('update:modelValue', false);
        }
    }
}
</script>

<style scoped>
.bottom-sheet-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 9999;
    display: flex;
    align-items: flex-end;
    justify-content: center;
}
.bottom-sheet {
    width: 100%;
    max-width: 100%;
    background: var(--mobile-action-sheet-bg);
    border-radius: 20px 20px 0 0;
    max-height: 70vh;
    overflow: hidden;
    box-shadow: none;
    border-top: 1px solid var(--mobile-action-sheet-border);
}
html.dark .bottom-sheet {
    box-shadow: none;
}
.bottom-sheet-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--el-border-color-lighter);
}
.bottom-sheet-handle {
    width: 40px;
    height: 4px;
    background: var(--el-border-color);
    border-radius: 2px;
}
.bottom-sheet-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    text-align: center;
    max-width: 80%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.bottom-sheet-content {
    padding: 12px 16px;
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.bottom-sheet-item {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 20px;
    border-radius: 14px;
    cursor: pointer;
    transition: all 0.2s ease;
    background: var(--mobile-action-sheet-item-bg);
    color: var(--el-text-color-primary);
}
.bottom-sheet-item:active {
    transform: scale(0.98);
    background: var(--mobile-action-sheet-item-active-bg);
}
.bottom-sheet-icon {
    font-size: 20px;
    width: 28px;
    text-align: center;
    color: var(--primary-color-accent);
}
.bottom-sheet-danger {
    color: var(--el-color-danger);
}
.bottom-sheet-danger .bottom-sheet-icon {
    color: var(--el-color-danger);
}
/* 动画 */
.bottom-sheet-enter-active { transition: all 0.3s ease-out; }
.bottom-sheet-leave-active { transition: all 0.2s ease-in; }
.bottom-sheet-enter-active .bottom-sheet { animation: slideUp 0.3s ease-out; }
.bottom-sheet-leave-active .bottom-sheet { animation: slideDown 0.2s ease-in; }
.bottom-sheet-enter-from, .bottom-sheet-leave-to { opacity: 0; }
.bottom-sheet-enter-from .bottom-sheet, .bottom-sheet-leave-to .bottom-sheet { transform: translateY(100%); }
@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
</style>
