<template>
    <!--
        文章 / 待办编辑面板（v1.4.0）
        ----------------------------------------------------------------------------
        一屏承载需求列出的全部模块：
          标题 / 摘要 / 封面图片 / 分类 / 标签 / 备注   ← 纯文本或选择器，不加载编辑器
          正文 + 页签                                  ← 复用记事编辑器（MemoEditor）

        页签按需求放在正文右侧，做成竖向切换条：点一下就换一页正文（水平切换风格），
        双击页签名改名，底部「+」新增，页签名右侧小叉删除（至少要留一页）。

        /article/edit/:id 是独立整页；/todo 把它嵌在右栏（embedded），
        两处共用这一个组件，避免两个页面各写一遍模块区。
    -->
    <div class="aep-root" :class="{ 'is-embedded': embedded }">
        <header class="aep-bar">
            <button v-if="!embedded" type="button" class="aep-back" @click="$emit('close')">
                <font-awesome-icon icon="chevron-left" />
                <span>{{ $t('article.backToList') }}</span>
            </button>
            <span class="aep-bar-title">
                {{ type === 'todo' ? $t('article.todoEdit') : $t('article.articleEdit') }}
            </span>
            <span class="aep-state" :class="stateClass">{{ stateText }}</span>
            <div v-if="articleId" class="aep-bar-stats">
                <span class="aep-stat-item">{{ $t('article.wordCount', { n: wordCount || 0 }) }}</span>
                <span v-if="type === 'todo'" class="aep-stat-item aep-stat-todo">
                    {{ $t('article.todoStat', { done: todoDone || 0, total: todoTotal || 0 }) }}
                </span>
            </div>
            <div v-if="articleId" class="aep-bar-actions">
                <button type="button" class="aep-btn" :title="$t('article.saveNow')" @click="saveAll">
                    <font-awesome-icon icon="save" />
                    <span class="aep-btn-text">{{ $t('article.saveNow') }}</span>
                </button>
                <button type="button" class="aep-btn" @click="togglePublish">
                    <font-awesome-icon :icon="form.status === 'published' ? 'eye-slash' : 'upload'" />
                    <span class="aep-btn-text">{{ form.status === 'published' ? $t('article.unpublish') : $t('article.publish') }}</span>
                </button>
                <button type="button" class="aep-btn is-danger" :title="$t('article.delete')" @click="remove">
                    <font-awesome-icon icon="trash" />
                </button>
            </div>
        </header>

        <div v-if="loading" class="aep-loading">
            <font-awesome-icon icon="spinner" spin />
            <span>{{ $t('article.loading') }}</span>
        </div>

        <template v-else-if="articleId">
            <!-- 模块区：标题 / 摘要 / 封面 / 分类 / 标签 / 备注 -->
            <div class="aep-meta" :class="{ 'is-collapsed': metaCollapsed }">
                <div class="aep-meta-head">
                    <button type="button" class="aep-meta-toggle" @click="metaCollapsed = !metaCollapsed">
                        <font-awesome-icon :icon="metaCollapsed ? 'chevron-down' : 'chevron-up'" />
                        <span>{{ $t('article.modules') }}</span>
                    </button>
                    <span class="aep-meta-hint">{{ $t('article.autosaveHint') }}</span>
                </div>
                <div v-show="!metaCollapsed" class="aep-meta-body">
                    <input
                        v-model="form.title"
                        class="aep-title"
                        type="text"
                        maxlength="200"
                        :placeholder="$t('article.titlePlaceholder')"
                        @input="onMetaInput"
                    />
                    <button
                        v-if="isMobile"
                        type="button"
                        class="aep-more-fields"
                        @click="fieldsOpen = !fieldsOpen"
                    >
                        <font-awesome-icon :icon="fieldsOpen ? 'chevron-up' : 'chevron-down'" />
                        {{ fieldsOpen ? $t('article.hideFields') : $t('article.moreFields') }}
                    </button>
                    <div v-if="fieldsOpen || !isMobile" class="aep-grid">
                        <label class="aep-field aep-field-wide">
                            <span class="aep-label">{{ $t('article.excerpt') }}</span>
                            <textarea
                                v-model="form.excerpt"
                                class="aep-textarea"
                                rows="2"
                                maxlength="500"
                                :placeholder="$t('article.excerptPlaceholder')"
                                @input="onMetaInput"
                            ></textarea>
                        </label>
                        <label class="aep-field aep-field-wide">
                            <span class="aep-label">{{ $t('article.note') }}</span>
                            <textarea
                                v-model="form.note"
                                class="aep-textarea"
                                rows="2"
                                maxlength="2000"
                                :placeholder="$t('article.notePlaceholder')"
                                @input="onMetaInput"
                            ></textarea>
                        </label>
                    </div>
                    <div v-if="fieldsOpen || !isMobile" class="aep-grid aep-grid-3">
                        <div class="aep-field">
                            <span class="aep-label">{{ $t('article.cover') }}</span>
                            <div class="aep-cover">
                                <button type="button" class="aep-cover-box" @click="pickerVisible = true">
                                    <img v-if="coverUrl" :src="coverUrl" alt="" />
                                    <span v-else class="aep-cover-empty">
                                        <font-awesome-icon icon="image" />
                                        <i>{{ $t('article.pickCover') }}</i>
                                    </span>
                                </button>
                                <div class="aep-cover-actions">
                                    <button type="button" class="aep-mini" @click="pickerVisible = true">{{ $t('article.choose') }}</button>
                                    <button v-if="form.coverFileId" type="button" class="aep-mini is-danger" @click="clearCover">
                                        {{ $t('article.remove') }}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <label class="aep-field">
                            <span class="aep-label">{{ $t('article.category') }}</span>
                            <el-select
                                v-model="form.folderId"
                                class="aep-select"
                                size="small"
                                :placeholder="$t('article.unfiled')"
                                @change="onMetaInput"
                            >
                                <el-option :label="$t('article.unfiled')" value="" />
                                <el-option v-for="o in folderOptions" :key="o.id" :label="o.label" :value="o.id" />
                            </el-select>
                        </label>
                        <div class="aep-field">
                            <span class="aep-label">{{ $t('article.tags') }}</span>
                            <div class="aep-tags">
                                <span v-for="(t, i) in tags" :key="`${t}-${i}`" class="aep-tag">
                                    #{{ t }}
                                    <button type="button" class="aep-tag-x" @click="removeTag(i)">
                                        <font-awesome-icon icon="times" />
                                    </button>
                                </span>
                                <input
                                    v-model="tagInput"
                                    class="aep-tag-input"
                                    type="text"
                                    :placeholder="tags.length ? '' : $t('article.tagPlaceholder')"
                                    @keydown.enter.prevent="commitTag"
                                    @keydown.space.prevent="commitTag"
                                    @blur="commitTag"
                                    @focus="loadTagCandidates"
                                />
                            </div>
                            <div v-if="tagSuggest.length" class="aep-tag-suggest">
                                <button
                                    v-for="c in tagSuggest"
                                    :key="c.id"
                                    type="button"
                                    class="aep-tag-sug"
                                    @mousedown.prevent="pickTag(c.name)"
                                >#{{ c.name }}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 正文 + 右侧页签 -->
            <div class="aep-work">
                <div class="aep-editor">
                    <MemoEditor
                        v-if="editorNote"
                        ref="editor"
                        :note="editorNote"
                        :instance-id="instanceId"
                        :toolbar-config="toolbarConfig"
                        :editor-config="editorConfig"
                        hide-head
                        :api="editorApi"
                        @saved="onEditorSaved"
                        @dirty="onEditorDirty"
                    />
                </div>
                <aside class="aep-tabs" :class="{ 'is-mobile': isMobile }">
                    <div class="aep-tabs-head">
                        <span>{{ $t('article.tabs') }}</span>
                        <button type="button" class="aep-tabs-add" :title="$t('article.addTab')" @click="addTab">
                            <font-awesome-icon icon="plus" />
                        </button>
                    </div>
                    <div class="aep-tabs-list">
                        <div
                            v-for="(t, i) in tabs"
                            :key="t.id || `tab-${i}`"
                            class="aep-tab"
                            :class="{ 'is-active': i === activeTab }"
                            @click="switchTab(i)"
                        >
                            <span v-if="editingTab !== i" class="aep-tab-name" :title="t.title" @dblclick.stop="startRename(i)">
                                {{ t.title || $t('article.untitledTab') }}
                            </span>
                            <input
                                v-else
                                ref="tabInput"
                                v-model="tabDraft"
                                class="aep-tab-input"
                                maxlength="40"
                                @keydown.enter.prevent="finishRename(i)"
                                @blur="finishRename(i)"
                                @click.stop
                            />
                            <button
                                v-if="tabs.length > 1"
                                type="button"
                                class="aep-tab-x"
                                :title="$t('article.deleteTab')"
                                @click.stop="removeTab(i)"
                            >
                                <font-awesome-icon icon="times" />
                            </button>
                        </div>
                    </div>
                    <p class="aep-tabs-tip">{{ $t('article.tabTip') }}</p>
                </aside>
            </div>

            <FilePickerDialog v-model="pickerVisible" :instance-id="instanceId" @confirm="onCoverPicked" />
        </template>

        <div v-else-if="!loading" class="aep-empty">
            <font-awesome-icon :icon="type === 'todo' ? 'list-check' : 'file-lines'" />
            <p>{{ type === 'todo' ? $t('article.pickTodo') : $t('article.pickArticle') }}</p>
        </div>
    </div>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus';
import MemoEditor from '@/components/memo/MemoEditor.vue';
import FilePickerDialog from '@/components/notes/FilePickerDialog.vue';
import {
    fetchArticle,
    updateArticle,
    saveArticleTabs,
    saveArticleTags,
    fetchArticleTagCandidates,
    deleteArticle,
    articleError,
} from '@/utils/articleApi';
import { DEFAULT_TOOLBAR_LINES } from '@/utils/memoEditorConfig';

let tabSeq = 0;

export default {
    name: 'ArticleEditPanel',
    components: { MemoEditor, FilePickerDialog },
    props: {
        /** 文章 id（空 = 未选中，显示占位） */
        articleId: { type: String, default: '' },
        type: { type: String, default: 'article' },
        instanceId: { type: String, default: '' },
        /** 分类扁平数组（由页面传入，避免每个面板各拉一次） */
        folders: { type: Array, default: () => [] },
        /** 嵌在 /todo 右栏时为 true：去掉返回按钮、压缩间距 */
        embedded: { type: Boolean, default: false },
        /** 编辑器工具栏 / 设置（与记事页同一份用户配置） */
        toolbarConfig: { type: Array, default: () => DEFAULT_TOOLBAR_LINES },
        editorConfig: { type: Object, default: () => ({}) },
    },
    emits: ['close', 'changed', 'saved'],
    data() {
        return {
            loading: false,
            metaCollapsed: false,
            /**
             * v1.4.0：摘要 / 封面 / 分类 / 标签这一大块在手机上默认收起。
             * 标题必须始终可见（不然连改标题都要先点开），所以它不在这块里。
             */
            fieldsOpen: true,
            isMobile: false,
            form: {
                title: '',
                excerpt: '',
                note: '',
                coverFileId: '',
                coverName: '',
                folderId: '',
                status: 'draft',
                done: false,
            },
            version: 1,
            wordCount: 0,
            todoTotal: 0,
            todoDone: 0,
            tabs: [],
            activeTab: 0,
            /** 交给编辑器的「一篇」：只在加载 / 切页签时整体替换，避免打字时被回灌 */
            editorNote: null,
            tabSeq: 0,
            editingTab: -1,
            tabDraft: '',
            tags: [],
            tagInput: '',
            tagCandidates: [],
            pickerVisible: false,
            dirty: false,
            editorDirty: false,
            saving: false,
            metaTimer: null,
            tagTimer: null,
        };
    },
    computed: {
        coverUrl() {
            if (!this.form.coverName) return '';
            return `/file/${encodeURIComponent(this.form.coverName)}`;
        },
        folderOptions() {
            // 平铺成「缩进 + 名称」，比 tree-select 更省一次展开操作，窄栏里也不挤
            const byParent = new Map();
            for (const f of this.folders) {
                const p = String(f.parentId || '');
                if (!byParent.has(p)) byParent.set(p, []);
                byParent.get(p).push(f);
            }
            const out = [];
            const walk = (pid, depth) => {
                for (const f of byParent.get(pid) || []) {
                    out.push({ id: String(f.id), label: `${'　'.repeat(depth)}${depth ? '└ ' : ''}${f.name}` });
                    walk(String(f.id), depth + 1);
                }
            };
            walk('', 0);
            return out;
        },
        tagSuggest() {
            const kw = String(this.tagInput || '').trim().toLowerCase();
            return this.tagCandidates
                .filter((c) => !this.tags.includes(c.name))
                .filter((c) => (!kw ? true : String(c.name).toLowerCase().includes(kw)))
                .slice(0, 8);
        },
        stateText() {
            if (this.saving) return this.$t('memo.saving');
            if (this.dirty || this.editorDirty) return this.$t('memo.unsaved');
            return this.$t('memo.saved');
        },
        stateClass() {
            if (this.saving) return 'is-saving';
            if (this.dirty || this.editorDirty) return 'is-dirty';
            return 'is-saved';
        },
        /**
         * 给编辑器的接口注入（v1.4.0）：
         * 编辑器以为自己在「保存一篇笔记」，实际落到「保存当前页签」——
         * 标题不在这里改（由上方标题模块单独保存），反链与历史本版关闭。
         */
        editorApi() {
            return {
                backlinks: false,
                history: false,
                saveNote: async (_id, payload) => {
                    const put = async () => {
                        const tabs = this.tabs.map((t, i) => ({
                            id: t.id || '',
                            title: t.title || '',
                            content: i === this.activeTab ? String(payload?.content ?? '') : String(t.content || ''),
                        }));
                        const r = await saveArticleTabs(this.articleId, { tabs, version: this.version });
                        this.applyTabsFromServer(r);
                        return { version: r?.version, updatedAt: r?.updatedAt };
                    };
                    try {
                        return await put();
                    } catch (e) {
                        const err = articleError(e);
                        // 正文保存和元信息保存共用 version，偶尔会撞车。
                        // 记事页撞车可以弹「覆盖/放弃」，文章页没有第二个副本，
                        // 直接取一次最新版本号静默重试，避免正文白写。
                        if (!err.conflict) throw err;
                        try {
                            const fresh = await fetchArticle(this.articleId);
                            this.version = Number(fresh?.version) || this.version;
                        } catch (_) {
                            /* 取不到就按原版本再试一次 */
                        }
                        return await put();
                    }
                },
                fetchNoteTags: async () => ({ tags: this.tags.map((name) => ({ name })) }),
                saveNoteTags: async (_id, names) => {
                    const r = await saveArticleTags(this.articleId, names);
                    this.tags = Array.isArray(r?.tags) ? r.tags : names;
                    return { tags: this.tags.map((name) => ({ name })) };
                },
            };
        },
    },
    watch: {
        articleId: {
            immediate: true,
            handler(id) {
                if (id) this.load();
                else this.resetAll();
            },
        },
    },
    mounted() {
        this.syncViewport();
        // 手机上先把「摘要 / 封面 / 分类 / 标签」收起来，把高度让给正文
        if (this.isMobile) this.fieldsOpen = false;
        window.addEventListener('resize', this.syncViewport);
        window.addEventListener('beforeunload', this.flushOnLeave);
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.syncViewport);
        window.removeEventListener('beforeunload', this.flushOnLeave);
        // 离开页面把没落库的东西写掉 —— 自动保存虽快，切页往往就在 800ms 内
        this.flushMeta();
    },
    methods: {
        syncViewport() {
            this.isMobile = window.innerWidth <= 900;
        },
        flushOnLeave() {
            this.flushMeta();
        },
        resetAll() {
            this.form = {
                title: '',
                excerpt: '',
                note: '',
                coverFileId: '',
                coverName: '',
                folderId: '',
                status: 'draft',
                done: false,
            };
            this.tabs = [];
            this.activeTab = 0;
            this.editorNote = null;
            this.tags = [];
            this.version = 1;
            this.wordCount = 0;
            this.todoTotal = 0;
            this.todoDone = 0;
        },
        async load() {
            if (!this.articleId) return;
            this.loading = true;
            try {
                const a = await fetchArticle(this.articleId);
                this.form = {
                    title: String(a?.title || ''),
                    excerpt: String(a?.excerpt || ''),
                    note: String(a?.note || ''),
                    coverFileId: String(a?.coverFileId || ''),
                    coverName: String(a?.coverName || ''),
                    folderId: String(a?.folderId || ''),
                    status: String(a?.status || 'draft'),
                    done: !!a?.done,
                };
                this.version = Number(a?.version) || 1;
                this.wordCount = Number(a?.wordCount) || 0;
                this.todoTotal = Number(a?.todoTotal) || 0;
                this.todoDone = Number(a?.todoDone) || 0;
                this.tabs = (Array.isArray(a?.tabs) ? a.tabs : []).map((t, i) => ({
                    id: String(t.id || ''),
                    title: String(t.title || `页签 ${i + 1}`),
                    content: String(t.content || ''),
                }));
                if (!this.tabs.length) this.tabs = [{ id: '', title: this.$t('article.defaultTab'), content: '' }];
                this.tags = Array.isArray(a?.tags) ? a.tags.slice() : [];
                this.activeTab = 0;
                this.mountEditor();
                this.dirty = false;
                this.editorDirty = false;
            } catch (e) {
                ElMessage.error(articleError(e).message || this.$t('article.loadFail'));
                this.resetAll();
            } finally {
                this.loading = false;
            }
        },
        /**
         * 挂载 / 重挂编辑器。
         * 每次都换一个新对象：编辑器 watch note 的引用，只有换了对象才会重新灌正文。
         * 用 seq 兜住「切到内容相同的另一个页签」这种情况（对象不同也一定会重灌）。
         */
        mountEditor() {
            const t = this.tabs[this.activeTab] || { title: '', content: '' };
            tabSeq += 1;
            this.editorNote = {
                id: this.articleId,
                title: t.title || '',
                content: String(t.content || ''),
                version: this.version,
                updatedAt: 0,
                seq: tabSeq,
            };
        },
        /** 把编辑器里最新的正文收进当前页签（切页签 / 保存前都要先做） */
        captureActiveTab() {
            const ed = this.$refs.editor;
            if (!ed || typeof ed.currentMd !== 'function') return;
            const md = ed.currentMd();
            const t = this.tabs[this.activeTab];
            if (t) t.content = md;
        },
        switchTab(i) {
            if (i === this.activeTab || i < 0 || i >= this.tabs.length) return;
            this.captureActiveTab();
            // 编辑器还有排队的自动保存：清掉，避免它拿新页签的正文去写旧页签
            const ed = this.$refs.editor;
            if (ed && ed.saveTimer) {
                clearTimeout(ed.saveTimer);
                ed.saveTimer = null;
            }
            this.activeTab = i;
            this.mountEditor();
        },
        addTab() {
            if (this.tabs.length >= 30) {
                ElMessage.warning(this.$t('article.tabLimit'));
                return;
            }
            this.captureActiveTab();
            this.tabs.push({ id: '', title: this.$t('article.newTabName', { n: this.tabs.length + 1 }), content: '' });
            this.activeTab = this.tabs.length - 1;
            this.mountEditor();
            this.dirty = true;
            this.markDirty();
        },
        async removeTab(i) {
            if (this.tabs.length <= 1) {
                ElMessage.warning(this.$t('article.keepOneTab'));
                return;
            }
            try {
                await ElMessageBox.confirm(
                    this.$t('article.deleteTabTip', { name: this.tabs[i]?.title || '' }),
                    this.$t('article.deleteTab'),
                    { type: 'warning', confirmButtonText: this.$t('common.confirm'), cancelButtonText: this.$t('common.cancel') },
                );
            } catch (e) {
                return;
            }
            this.captureActiveTab();
            this.tabs.splice(i, 1);
            if (this.activeTab >= this.tabs.length) this.activeTab = this.tabs.length - 1;
            else if (i < this.activeTab) this.activeTab -= 1;
            this.mountEditor();
            this.markDirty();
            await this.saveTabsNow();
        },
        startRename(i) {
            this.editingTab = i;
            this.tabDraft = this.tabs[i]?.title || '';
            this.$nextTick(() => {
                const el = Array.isArray(this.$refs.tabInput) ? this.$refs.tabInput[0] : this.$refs.tabInput;
                el?.focus?.();
                el?.select?.();
            });
        },
        finishRename(i) {
            if (this.editingTab !== i) return;
            const name = String(this.tabDraft || '').trim();
            if (name && name !== this.tabs[i].title) {
                this.tabs[i].title = name.slice(0, 40);
                this.markDirty();
                this.saveTabsNow();
            }
            this.editingTab = -1;
        },
        /* ── 保存 ───────────────────────────────────────────── */
        markDirty() {
            this.dirty = true;
            this.scheduleMeta();
        },
        onMetaInput() {
            this.dirty = true;
            this.scheduleMeta();
        },
        scheduleMeta() {
            if (this.metaTimer) clearTimeout(this.metaTimer);
            this.metaTimer = setTimeout(() => this.flushMeta(), 800);
        },
        async flushMeta() {
            if (this.metaTimer) {
                clearTimeout(this.metaTimer);
                this.metaTimer = null;
            }
            if (!this.articleId || !this.dirty) return;
            const payload = {
                title: this.form.title,
                excerpt: this.form.excerpt,
                note: this.form.note,
                coverFileId: this.form.coverFileId,
                folderId: this.form.folderId,
                status: this.form.status,
                version: this.version,
            };
            try {
                const r = await updateArticle(this.articleId, payload);
                this.version = Number(r?.version) || this.version;
                this.dirty = false;
                this.$emit('changed');
                this.$emit('saved', { id: this.articleId, title: this.form.title });
            } catch (e) {
                const err = articleError(e);
                if (err.conflict) {
                    // 自己两条保存路径撞车（元信息 vs 页签）：拿到最新版本重试一次，不打断用户
                    try {
                        const a = await fetchArticle(this.articleId);
                        this.version = Number(a?.version) || this.version;
                        const r2 = await updateArticle(this.articleId, { ...payload, version: this.version });
                        this.version = Number(r2?.version) || this.version;
                        this.dirty = false;
                        this.$emit('changed');
                        return;
                    } catch (e2) {
                        ElMessage.error(articleError(e2).message || this.$t('article.saveFail'));
                        return;
                    }
                }
                ElMessage.error(err.message || this.$t('article.saveFail'));
            }
        },
        /** 保存页签（正文 + 顺序 + 页签名） */
        async saveTabsNow() {
            if (!this.articleId) return;
            this.captureActiveTab();
            const tabs = this.tabs.map((t) => ({ id: t.id || '', title: t.title || '', content: String(t.content || '') }));
            try {
                const r = await saveArticleTabs(this.articleId, { tabs, version: this.version });
                this.applyTabsFromServer(r);
            } catch (e) {
                ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
            }
        },
        /** 服务端回来的页签：只回填 id 与统计，不碰编辑器里正在编辑的正文 */
        applyTabsFromServer(r) {
            this.version = Number(r?.version) || this.version;
            this.wordCount = Number(r?.wordCount) || this.wordCount;
            this.todoTotal = Number(r?.todoTotal) || 0;
            this.todoDone = Number(r?.todoDone) || 0;
            const rows = Array.isArray(r?.tabs) ? r.tabs : [];
            if (rows.length === this.tabs.length) {
                this.tabs = rows.map((t, i) => ({
                    id: String(t.id || ''),
                    title: String(t.title || this.tabs[i]?.title || ''),
                    content: i === this.activeTab ? String(this.tabs[i]?.content ?? '') : String(t.content || ''),
                }));
            } else {
                this.tabs = rows.map((t) => ({ id: String(t.id || ''), title: String(t.title || ''), content: String(t.content || '') }));
                if (this.activeTab >= this.tabs.length) this.activeTab = 0;
            }
            this.$emit('changed');
        },
        async saveAll() {
            this.saving = true;
            try {
                await this.flushMeta();
                await this.saveTabsNow();
                // 编辑器里的正文也清一次脏标记，顶部状态才回到「已保存」
                this.editorDirty = false;
                ElMessage.success(this.$t('article.savedOk'));
            } finally {
                this.saving = false;
            }
        },
        onEditorSaved() {
            this.editorDirty = false;
            this.$emit('changed');
        },
        onEditorDirty(v) {
            this.editorDirty = !!v;
        },
        /* ── 其它模块 ───────────────────────────────────────── */
        async togglePublish() {
            const next = this.form.status === 'published' ? 'draft' : 'published';
            this.form.status = next;
            this.dirty = true;
            await this.flushMeta();
            ElMessage.success(next === 'published' ? this.$t('article.published') : this.$t('article.unpublished'));
        },
        async remove() {
            try {
                await ElMessageBox.confirm(
                    this.$t('article.deleteTip', { title: this.form.title || this.$t('article.untitled') }),
                    this.$t('article.delete'),
                    { type: 'warning', confirmButtonText: this.$t('common.confirm'), cancelButtonText: this.$t('common.cancel') },
                );
            } catch (e) {
                return;
            }
            try {
                await deleteArticle(this.articleId);
                ElMessage.success(this.$t('article.deleted'));
                this.$emit('changed');
                this.$emit('close');
            } catch (e) {
                ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
            }
        },
        onCoverPicked(files) {
            const list = Array.isArray(files) ? files : [];
            const f = list[0];
            if (!f) return;
            this.form.coverFileId = String(f.id || f.fileId || '');
            this.form.coverName = String(f.name || '');
            this.dirty = true;
            this.flushMeta();
        },
        clearCover() {
            this.form.coverFileId = '';
            this.form.coverName = '';
            this.dirty = true;
            this.flushMeta();
        },
        async commitTag() {
            const name = String(this.tagInput || '').trim().replace(/^#+/, '').slice(0, 20);
            this.tagInput = '';
            if (!name) return;
            if (this.tags.includes(name)) return;
            if (this.tags.length >= 20) return;
            this.tags.push(name);
            await this.saveTags();
        },
        pickTag(name) {
            this.tagInput = '';
            if (!name || this.tags.includes(name)) return;
            this.tags.push(name);
            this.saveTags();
        },
        removeTag(i) {
            this.tags.splice(i, 1);
            this.saveTags();
        },
        async saveTags() {
            if (!this.articleId) return;
            try {
                const r = await saveArticleTags(this.articleId, this.tags.slice());
                this.tags = Array.isArray(r?.tags) ? r.tags : this.tags;
                this.$emit('changed');
            } catch (e) {
                ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
            }
        },
        async loadTagCandidates() {
            try {
                const r = await fetchArticleTagCandidates(this.type);
                this.tagCandidates = Array.isArray(r) ? r : [];
            } catch (e) {
                this.tagCandidates = [];
            }
        },
    },
};
</script>

<style scoped>
.aep-root {
    display: flex;
    /* 全站后台有若干处 text-align: center 的继承，这里显式归左，避免列表文字居中 */
    text-align: left;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--el-bg-color);
}
.aep-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--el-border-color-lighter);
}
.aep-back {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 28px;
    padding: 0 8px 0 4px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 12.5px;
    cursor: pointer;
}
.aep-back:hover {
    background: var(--el-fill-color);
    color: var(--el-color-primary);
}
.aep-bar-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--el-text-color-primary);
}
.aep-state {
    font-size: 11.5px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--el-fill-color-light);
    color: var(--el-text-color-secondary);
}
.aep-state.is-dirty {
    background: var(--el-color-warning-light-9);
    color: var(--el-color-warning);
}
.aep-state.is-saved {
    background: var(--el-color-success-light-9);
    color: var(--el-color-success);
}
.aep-bar-stats {
    display: flex;
    gap: 10px;
    font-size: 11.5px;
    color: var(--el-text-color-placeholder);
}
.aep-bar-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 5px;
}
.aep-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--el-border-color);
    border-radius: 7px;
    background: var(--el-bg-color);
    color: var(--el-text-color-regular);
    font-size: 12px;
    cursor: pointer;
}
.aep-btn:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
}
.aep-btn.is-danger:hover {
    border-color: var(--el-color-danger);
    color: var(--el-color-danger);
}
.aep-loading {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}
.aep-meta {
    flex: 0 0 auto;
    padding: 8px 14px 10px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    background: var(--el-bg-color);
}
.aep-meta.is-collapsed {
    padding-bottom: 4px;
}
.aep-meta-head {
    display: flex;
    align-items: center;
    gap: 10px;
}
.aep-meta-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: none;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 11.5px;
    cursor: pointer;
    padding: 2px 0;
}
.aep-meta-toggle:hover {
    color: var(--el-color-primary);
}
.aep-meta-hint {
    margin-left: auto;
    font-size: 11px;
    color: var(--el-text-color-placeholder);
}
.aep-meta-body {
    margin-top: 6px;
}
.aep-title {
    width: 100%;
    box-sizing: border-box;
    height: 40px;
    padding: 0 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 9px;
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-primary);
    font-size: 17px;
    font-weight: 700;
    outline: none;
}
.aep-title:focus {
    border-color: var(--el-color-primary);
}
.aep-more-fields {
    margin-top: 8px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 10px;
    border: 1px dashed var(--el-border-color);
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 11.5px;
    cursor: pointer;
}
.aep-more-fields:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
}
.aep-grid {
    margin-top: 8px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
}
.aep-grid-3 {
    grid-template-columns: minmax(200px, 1.1fr) minmax(150px, 0.8fr) minmax(180px, 1fr);
}
.aep-field {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}
.aep-label {
    font-size: 11.5px;
    color: var(--el-text-color-secondary);
}
.aep-textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    padding: 6px 9px;
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-primary);
    font-size: 12.5px;
    line-height: 1.6;
    font-family: inherit;
    resize: vertical;
    outline: none;
}
.aep-textarea:focus {
    border-color: var(--el-color-primary);
}
.aep-select {
    width: 100%;
}
.aep-cover {
    display: flex;
    align-items: center;
    gap: 8px;
}
.aep-cover-box {
    flex: 0 0 auto;
    width: 92px;
    height: 56px;
    border: 1px dashed var(--el-border-color);
    border-radius: 8px;
    background: var(--el-fill-color-lighter);
    color: var(--el-text-color-placeholder);
    overflow: hidden;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
}
.aep-cover-box img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.aep-cover-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    font-size: 14px;
}
.aep-cover-empty i {
    font-style: normal;
    font-size: 10.5px;
}
.aep-cover-actions {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.aep-mini {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    background: var(--el-bg-color);
    color: var(--el-text-color-regular);
    font-size: 11.5px;
    cursor: pointer;
}
.aep-mini:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
}
.aep-mini.is-danger:hover {
    border-color: var(--el-color-danger);
    color: var(--el-color-danger);
}
.aep-tags {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
    min-height: 30px;
    padding: 3px 6px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-fill-color-blank);
}
.aep-tag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 21px;
    padding: 0 6px;
    border-radius: 5px;
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    font-size: 11.5px;
}
.aep-tag-x {
    border: none;
    background: transparent;
    color: inherit;
    font-size: 9px;
    cursor: pointer;
    padding: 0;
    opacity: 0.7;
}
.aep-tag-input {
    flex: 1 1 80px;
    min-width: 60px;
    border: none;
    outline: none;
    background: transparent;
    font-size: 12px;
    color: var(--el-text-color-primary);
}
.aep-tag-suggest {
    position: absolute;
    z-index: 10;
    margin-top: 2px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-bg-color-overlay);
    box-shadow: var(--el-box-shadow-light);
}
.aep-tag-sug {
    border: none;
    border-radius: 5px;
    background: var(--el-fill-color-light);
    color: var(--el-text-color-regular);
    font-size: 11.5px;
    padding: 2px 6px;
    cursor: pointer;
}
.aep-tag-sug:hover {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
}
.aep-work {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
}
.aep-editor {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    display: flex;
}
.aep-editor > * {
    flex: 1 1 auto;
    min-width: 0;
}
.aep-tabs {
    flex: 0 0 128px;
    width: 128px;
    border-left: 1px solid var(--el-border-color-lighter);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--el-fill-color-lighter);
}
.aep-tabs-head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px 4px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
}
.aep-tabs-add {
    margin-left: auto;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--el-text-color-regular);
    cursor: pointer;
    font-size: 10px;
}
.aep-tabs-add:hover {
    background: var(--el-fill-color);
    color: var(--el-color-primary);
}
.aep-tabs-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 2px 6px;
    overscroll-behavior: contain;
}
.aep-tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 30px;
    padding: 0 8px;
    margin-bottom: 2px;
    border-radius: 7px;
    color: var(--el-text-color-regular);
    font-size: 12px;
    cursor: pointer;
}
.aep-tab:hover {
    background: var(--el-fill-color);
}
.aep-tab.is-active {
    background: var(--el-bg-color);
    color: var(--el-color-primary);
    font-weight: 600;
    box-shadow: inset 2px 0 0 var(--el-color-primary);
}
.aep-tab-name {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.aep-tab-input {
    flex: 1 1 auto;
    min-width: 0;
    border: 1px solid var(--el-color-primary);
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 12px;
    outline: none;
    background: var(--el-bg-color);
    color: var(--el-text-color-primary);
}
.aep-tab-x {
    flex: 0 0 auto;
    border: none;
    background: transparent;
    color: var(--el-text-color-placeholder);
    font-size: 9px;
    cursor: pointer;
    opacity: 0;
}
.aep-tab:hover .aep-tab-x {
    opacity: 1;
}
.aep-tab-x:hover {
    color: var(--el-color-danger);
}
.aep-tabs-tip {
    flex: 0 0 auto;
    margin: 0;
    padding: 6px 10px 8px;
    font-size: 10.5px;
    line-height: 1.5;
    color: var(--el-text-color-placeholder);
}
.aep-empty {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--el-text-color-placeholder);
    font-size: 13px;
}
.aep-empty :deep(svg) {
    font-size: 30px;
    opacity: 0.35;
}

@media (max-width: 900px) {
    .aep-bar {
        flex-wrap: wrap;
        gap: 6px;
        padding: 6px 10px;
    }
    .aep-bar-stats {
        display: none;
    }
    .aep-btn-text {
        display: none;
    }
    .aep-meta {
        padding: 6px 10px 8px;
    }
    .aep-grid-3 {
        grid-template-columns: 1fr;
    }
    .aep-work {
        flex-direction: column-reverse;
    }
    .aep-tabs {
        flex: 0 0 auto;
        width: 100%;
        border-left: none;
        border-bottom: 1px solid var(--el-border-color-lighter);
        flex-direction: row;
        align-items: center;
    }
    .aep-tabs-head {
        padding: 4px 8px;
    }
    .aep-tabs-list {
        display: flex;
        gap: 4px;
        overflow-x: auto;
        padding: 4px 6px;
    }
    .aep-tab {
        margin-bottom: 0;
        white-space: nowrap;
    }
    .aep-tabs-tip {
        display: none;
    }
}
</style>
