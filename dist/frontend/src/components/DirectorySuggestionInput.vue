<template>
    <div class="directory-suggestion-input" ref="wrapperRef">
        <el-input
            ref="inputRef"
            v-model="inputValue"
            :placeholder="placeholder"
            name="gohub-upload-folder"
            autocomplete="on"
            @focus="handleFocus"
            @blur="handleBlur"
            @input="handleInput"
        />
        <div
            v-show="dropdownVisible && suggestions.length > 0"
            class="suggestion-dropdown"
        >
            <ul class="suggestion-list">
                <li
                    v-for="(item, index) in suggestions"
                    :key="index"
                    class="suggestion-item"
                    :title="item.value"
                    @mousedown.prevent="selectItem(item)"
                >
                    {{ item.value }}
                </li>
            </ul>
        </div>
    </div>
</template>

<script>
import axios from '@/utils/axios'

export default {
    name: 'DirectorySuggestionInput',
    props: {
        modelValue: { type: String, default: '' },
        placeholder: { type: String, default: '' },
        /**
         * v1.0.6：「最近使用过的目录」localStorage 键。
         * 不同输入框各用各的键，避免把「上传目录」的历史串到「文件分类」里。
         */
        historyKey: { type: String, default: 'gohub:recent:dirs' }
    },
    emits: ['update:modelValue', 'focus', 'blur', 'select'],
    data() {
        return {
            directoryTreeRoot: null,
            directoryTreeLoaded: false,
            directoryTreeLoading: false,
            directoryChildrenMap: {},
            focusTime: null,
            dropdownVisible: false,
            isFocused: false,
            suggestions: [],
            /** v1.0.6：最近用过的几个目录（本地持久化，光标进入即排在建议最前面） */
            recentList: []
        }
    },
    computed: {
        inputValue: {
            get() { return this.modelValue },
            set(val) { this.$emit('update:modelValue', val) }
        }
    },
    watch: {
        modelValue() {
            // 外部修改 modelValue 时也刷新建议
            if (this.isFocused) {
                this.refreshSuggestions()
            }
        }
    },
    methods: {
        handleFocus() {
            this.isFocused = true
            this.focusTime = Date.now()
            // v1.0.6：先把本地记下的「最近用过」读出来，光标进去就能直接选
            this.loadRecent()
            this.ensureDirectoryTreeLoaded()
            this.$emit('focus')
            setTimeout(() => {
                if (this.isFocused) {
                    this.refreshSuggestions()
                    this.dropdownVisible = true
                }
            }, 500)
        },
        handleBlur() {
            this.isFocused = false
            this.dropdownVisible = false
            // v1.0.6：失焦即视为「用过这个目录」，记进最近列表
            this.pushRecent(this.modelValue)
            this.$emit('blur')
        },
        handleInput(val) {
            // val 是 el-input @input 事件传来的最新值
            this.$nextTick(() => {
                this.refreshSuggestions()
                if (this.isFocused) {
                    this.dropdownVisible = true
                }
            })
        },
        selectItem(item) {
            const path = item.value
            this.inputValue = path
            this.pushRecent(path)
            this.$emit('select', path)
            const normalizedPath = this.normalizeDirectoryPath(path)
            const children = this.directoryChildrenMap[normalizedPath]
            if (children && children.length > 0) {
                this.$nextTick(() => {
                    this.refreshSuggestions()
                    this.dropdownVisible = true
                    this.$refs.inputRef?.focus()
                })
            } else {
                this.dropdownVisible = false
            }
        },
        refreshSuggestions() {
            this.suggestions = this.getDirectorySuggestions(this.modelValue || '')
        },
        normalizeDirectoryPath(path) {
            if (!path) return '/'
            let normalized = path
            if (!normalized.startsWith('/')) normalized = '/' + normalized
            if (normalized !== '/' && !normalized.endsWith('/')) normalized += '/'
            return normalized
        },
        buildDirectoryChildrenMap(treeRoot) {
            const map = {}
            const walk = (node) => {
                const parentPath = this.normalizeDirectoryPath(node.path)
                const children = Array.isArray(node.children) ? node.children : []
                map[parentPath] = children.map((child) => ({
                    name: child.name,
                    path: this.normalizeDirectoryPath(child.path)
                }))
                children.forEach(walk)
            }
            walk(treeRoot)
            this.directoryChildrenMap = map
        },
        async ensureDirectoryTreeLoaded() {
            if (this.directoryTreeLoaded || this.directoryTreeLoading) return
            this.directoryTreeLoading = true
            try {
                const response = await axios.get('/api/directoryTree', { withAuthCode: true })
                const tree = response?.data?.tree
                if (tree) {
                    this.directoryTreeRoot = tree
                    this.buildDirectoryChildrenMap(tree)
                    this.directoryTreeLoaded = true
                }
            } catch (error) {
                console.error('Failed to load directory tree for autocomplete:', error)
            } finally {
                this.directoryTreeLoading = false
            }
        },
        parseDirectoryQuery(value) {
            const normalizedInput = value && value.startsWith('/') ? value : `/${value || ''}`
            const raw = normalizedInput.slice(1)
            const parts = raw.split('/')
            const segmentInput = parts[parts.length - 1] || ''
            const parentSegments = parts.slice(0, -1).filter(Boolean)
            const parentPath = parentSegments.length > 0 ? `/${parentSegments.join('/')}/` : '/'
            return { segmentInput, parentPath }
        },
        getDirectorySuggestions(queryString) {
            const fromTree = this.getTreeSuggestions(queryString)
            /*
             * v1.0.6：把「最近使用过的目录」排在前面。
             * 目录树可能很深，用户常用的其实就是那两三个 —— 每次都要从头点进去太麻烦。
             * 输入了关键字时也按包含关系过滤，避免历史项盖住精确匹配。
             */
            const keyword = String(queryString || '').trim().toLowerCase()
            const recent = this.recentList
                .filter((v) => v && v !== queryString)
                .filter((v) => !keyword || v.toLowerCase().includes(keyword))
                .slice(0, 5)
                .map((v) => ({ value: v }))
            if (!recent.length) return fromTree
            const seen = new Set(recent.map((r) => r.value))
            return [...recent, ...fromTree.filter((r) => !seen.has(r.value))].slice(0, 10)
        },
        /** v1.0.6：读取最近使用的目录（容错：脏数据按空处理） */
        loadRecent() {
            try {
                const raw = localStorage.getItem(this.historyKey)
                const arr = raw ? JSON.parse(raw) : []
                this.recentList = Array.isArray(arr) ? arr.map((v) => String(v || '')).filter(Boolean) : []
            } catch {
                this.recentList = []
            }
        },
        /** v1.0.6：记一个目录进「最近使用」（去重、最新的排最前、最多留 8 条） */
        pushRecent(value) {
            const v = String(value || '').trim()
            if (!v) return
            try {
                const raw = localStorage.getItem(this.historyKey)
                const arr = raw ? JSON.parse(raw) : []
                const list = Array.isArray(arr) ? arr.map((x) => String(x || '')).filter(Boolean) : []
                const next = [v, ...list.filter((x) => x !== v)].slice(0, 8)
                localStorage.setItem(this.historyKey, JSON.stringify(next))
                this.recentList = next
            } catch {
                /* 隐私模式 / 配额满：静默忽略，不影响输入 */
            }
        },
        getTreeSuggestions(queryString) {
            const { segmentInput, parentPath } = this.parseDirectoryQuery(queryString)
            const parentChildren = this.directoryChildrenMap[parentPath] || []
            if (!segmentInput) {
                return parentChildren.slice(0, 10).map((item) => ({ value: item.path }))
            }
            const keyword = segmentInput.toLowerCase()
            return parentChildren
                .filter((item) => item.name.toLowerCase().startsWith(keyword))
                .slice(0, 10)
                .map((item) => ({ value: item.path }))
        }
    }
}
</script>

<style scoped>
.directory-suggestion-input {
    width: 100%;
    height: 100%;
    position: relative;
}
.suggestion-dropdown {
    position: absolute;
    top: calc(100% + 10px);
    left: 0;
    width: 100%;
    z-index: 9999;
    border-radius: 12px;
    border: 1px solid var(--glass-border);
    background-color: var(--popper-bg-color);
    box-shadow: var(--popper-shadow);
    padding: 6px 0;
    overflow: hidden;
}
.suggestion-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 260px;
    overflow-y: auto;
}
.suggestion-item {
    padding: 8px 16px;
    font-size: 13px;
    border-radius: 6px;
    margin: 2px 6px;
    cursor: pointer;
    transition: background-color 0.2s ease;
    text-align: left;
    color: var(--el-text-color-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.suggestion-item:hover {
    background-color: var(--el-fill-color-light);
}
</style>
