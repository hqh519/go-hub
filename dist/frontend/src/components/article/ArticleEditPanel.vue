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
    <div class="aep-root" :class="{ 'is-embedded': embedded, 'is-bar-hidden': barsHidden }">
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
                    <!--
                        v1.4.1.1（需求）：待办要有「截止时间」。
                        模块区在待办里默认收起，所以这个控件放在收起也不会消失的标题行上，
                        而不是塞进下面的表单 —— 免得用户要先展开模块才找得到。
                    -->
                    <div v-if="type === 'todo'" class="aep-due" :class="{ 'is-urgent': dueLeft && dueLeft.urgent, 'is-overdue': dueLeft && dueLeft.overdue }">
                        <font-awesome-icon icon="calendar-day" class="aep-due-icon" />
                        <el-date-picker
                            v-model="dueAtModel"
                            class="aep-due-picker"
                            type="datetime"
                            size="small"
                            :placeholder="$t('article.dueAtPlaceholder')"
                            :teleported="true"
                        />
                        <span v-if="dueLeft" class="aep-due-left">{{ dueLeft.text }}</span>
                    </div>
                    <span class="aep-meta-hint">{{ $t('article.autosaveHint') }}</span>
                </div>
                <div v-show="!metaCollapsed" class="aep-meta-body">
                    <!-- v1.4.1.1：待办的标题由编辑器渲染（工具栏下一行），这里只在文章里出现 -->
                    <input
                        v-if="type !== 'todo'"
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
                        <!-- v1.4.1.1：待办的标签行由编辑器渲染（与笔记一致），这里只在文章里出现 -->
                        <div v-if="type !== 'todo'" class="aep-field">
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
                        :hide-head="type !== 'todo'"
                        :api="editorApi"
                        @saved="onEditorSaved"
                        @dirty="onEditorDirty"
                    />
                </div>
                <!--
                    v1.4.1（需求）：桌面端页签栏可以拖动左边框改宽度。
                    宽度写进 localStorage，下次进来还是上次的宽度。
                -->
                <aside
                    class="aep-tabs"
                    :class="{ 'is-mobile': isMobile }"
                    :style="isMobile ? null : { flexBasis: `${tabsWidth}px`, width: `${tabsWidth}px` }"
                >
                    <span
                        v-if="!isMobile"
                        class="aep-tabs-resizer"
                        :title="$t('article.resizeTabs')"
                        @pointerdown.prevent="startTabsResize"
                    ></span>
                    <div class="aep-tabs-head">
                        <span>{{ $t('article.tabs') }}</span>
                        <!-- 移动端把「+」放到列表末尾（需求），桌面端仍留在标题右侧 -->
                        <button v-if="!isMobile" type="button" class="aep-tabs-add" :title="$t('article.addTab')" @click="addTab">
                            <font-awesome-icon icon="plus" />
                        </button>
                    </div>
                    <div class="aep-tabs-list">
                        <div
                            v-for="(t, i) in tabs"
                            :key="t.id || `tab-${i}`"
                            class="aep-tab"
                            :class="{ 'is-active': i === activeTab }"
                            @click="onTabClick(i)"
                            @touchstart.passive="onTabPressStart(i, $event)"
                            @touchmove.passive="onTabPressMove($event)"
                            @touchend="onTabPressEnd"
                            @touchcancel="onTabPressEnd"
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
                            <!--
                                v1.4.1（需求）：移动端不出小叉，改为长按页签弹菜单；
                                正文（第一个页签）无论哪个终端都不允许删除。
                            -->
                            <button
                                v-if="i > 0 && tabs.length > 1 && !isMobile"
                                type="button"
                                class="aep-tab-x"
                                :title="$t('article.deleteTab')"
                                @click.stop="removeTab(i)"
                            >
                                <font-awesome-icon icon="times" />
                            </button>
                        </div>
                        <!-- v1.4.1（需求）：移动端新增页签按钮排在最末尾 -->
                        <button
                            v-if="isMobile"
                            type="button"
                            class="aep-tab aep-tab-add-end"
                            :title="$t('article.addTab')"
                            :aria-label="$t('article.addTab')"
                            @click.stop="addTab"
                        >
                            <!-- v1.4.1.1（需求）：移动端只要图标，不带文字 -->
                            <font-awesome-icon icon="plus" />
                        </button>
                    </div>
                    <p class="aep-tabs-tip">{{ isMobile ? $t('article.tabTipMobile') : $t('article.tabTip') }}</p>
                </aside>
            </div>

            <!-- v1.4.1：移动端长按页签弹出的操作菜单（重命名 / 删除） -->
            <div v-if="tabMenu.open" class="aep-sheet-mask" @click.self="closeTabMenu" @touchmove.prevent>
                <div class="aep-sheet">
                    <p class="aep-sheet-title">{{ tabs[tabMenu.index]?.title || $t('article.untitledTab') }}</p>
                    <button type="button" class="aep-sheet-item" @click="menuRenameTab">
                        <font-awesome-icon icon="pen" />
                        <span>{{ $t('article.renameTab') }}</span>
                    </button>
                    <button
                        v-if="tabMenu.index > 0 && tabs.length > 1"
                        type="button"
                        class="aep-sheet-item is-danger"
                        @click="menuDeleteTab"
                    >
                        <font-awesome-icon icon="trash" />
                        <span>{{ $t('article.deleteTab') }}</span>
                    </button>
                    <p v-else class="aep-sheet-note">{{ $t('article.bodyTabLocked') }}</p>
                    <button type="button" class="aep-sheet-item is-cancel" @click="closeTabMenu">
                        {{ $t('common.cancel') }}
                    </button>
                </div>
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
                /* v1.4.1.1：待办编辑区标题栏的心情 / 天气 / 标记（与笔记同一套 key） */
                mood: '',
                moodName: '',
                weather: '',
                weatherName: '',
                markerName: '',
                /* v1.4.1.1：截止时间（毫秒时间戳，0 = 不设截止） */
                dueAt: 0,
            },
            version: 1,
            /** v1.4.1.1：待办编辑区的「保存时间」用（编辑器的元信息行要显示） */
            articleUpdatedAt: 0,
            /** v1.4.1.1：截止时间的「剩几天」基准 —— 需求要求用发布时间算 */
            articlePublishedAt: 0,
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
            /**
             * v1.4.1：页签保存的串行锁。正文自动保存（1.5s）与元信息保存（0.8s）
             * 共用同一个 version，两个请求同时飞出去必然有一个 409；
             * 排队后第二笔会等第一笔回来、用新版本号再发，不会自相残杀。
             */
            tabSaveLock: null,
            /** v1.4.1：移动端长按页签的操作菜单 */
            tabMenu: { open: false, index: -1 },
            pressTimer: null,
            pressFired: false,
            pressStart: { x: 0, y: 0 },
            /**
             * v1.4.1：文章被删掉之后不要再往服务端写。
             * 删除后组件会卸载，卸载钩子里的 flushNow 如果照常提交，
             * 会把带着 status=published 的元信息写回已软删的行 —— 等于把文章复活。
             */
            closedByDelete: false,
            /** v1.4.1：桌面端页签栏宽度（可拖动，记住上次） */
            tabsWidth: 128,
            /**
             * v1.4.1（需求：移动端上滚隐藏「顶部栏 / 返回列表栏」）：
             * 只有手机上才启用；桌面端保持常显，避免多一坨会动的像素。
             */
            barsHidden: false,
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
         * v1.4.1.1（需求）：待办的截止时间。
         * 表单里存毫秒时间戳（0 = 未设），选择器要 Date，故用带 setter 的计算属性转一道。
         */
        dueAtModel: {
            get() {
                return this.form.dueAt ? new Date(this.form.dueAt) : null;
            },
            set(v) {
                const ts = v ? new Date(v).getTime() : 0;
                this.form.dueAt = Number.isFinite(ts) && ts > 0 ? ts : 0;
                this.onMetaInput();
            },
        },
        /**
         * 剩余时间提示：与列表同一口径（截止时间 - 发布时间），
         * 不足 1 天按「剩几时」，过期只留「已逾期」。
         */
        dueLeft() {
            const due = Number(this.form.dueAt) || 0;
            if (!due) return null;
            const base = this.articlePublishedAt || Date.now();
            const diff = due - base;
            if (diff < 0) return { text: this.$t('article.dueOverdue'), overdue: true, urgent: false };
            const days = Math.floor(diff / 86400000);
            if (days >= 1) return { text: this.$t('article.dueDays', { n: days }), overdue: false, urgent: false };
            const hours = Math.max(1, Math.floor(diff / 3600000));
            return { text: this.$t('article.dueHours', { n: hours }), overdue: false, urgent: true };
        },
        /**
         * 给编辑器的接口注入（v1.4.0）：
         * 编辑器以为自己在「保存一篇笔记」，实际落到「保存当前页签」——
         * 标题不在这里改（由上方标题模块单独保存），反链与历史本版关闭。
         */
        editorApi() {
            return {
                backlinks: false,
                /*
                 * v1.4.1.1（需求）：待办的标题栏要显示「历史版本」。
                 * 文章没有历史表，点开是空列表（接口 404 已被 loadHistory 吞掉），
                 * 所以只在待办里放出来，避免文章页多一个点了没反应的按钮。
                 */
                history: this.type === 'todo',
                saveNote: async (_id, payload) => {
                    /*
                     * 编辑器以为自己在「保存一篇笔记」，实际接到「保存整批页签」上：
                     * 当前页签用编辑器刚吐出来的正文，其它页签原样带回。
                     * 走 persistTabs 而不是直接发请求，是为了和手动保存 / 元信息保存
                     * 排在同一条队列里 —— 两笔同版本请求同时飞，必有一笔 409。
                     */
                    const cur = this.tabs[this.activeTab];
                    if (cur && payload && typeof payload.content === 'string') cur.content = payload.content;
                    /*
                     * v1.4.1.1：待办的标题 / 心情 / 天气 / 标记由编辑器那一行改，
                     * 但落库位置是 articles（不是 notes）。这里把它们同步回 form，
                     * 先走一次元信息保存，再保存页签 —— 两笔都在同一条队列上，不会撞版本。
                     */
                    if (this.type === 'todo' && payload) {
                        let metaDirty = false;
                        if (typeof payload.title === 'string' && payload.title !== this.form.title) {
                            this.form.title = payload.title;
                            metaDirty = true;
                        }
                        if (typeof payload.mood === 'string' && (payload.mood !== this.form.mood || String(payload.moodName || '') !== this.form.moodName)) {
                            this.form.mood = payload.mood;
                            this.form.moodName = String(payload.moodName || '');
                            metaDirty = true;
                        }
                        if (typeof payload.weather === 'string' && (payload.weather !== this.form.weather || String(payload.weatherName || '') !== this.form.weatherName)) {
                            this.form.weather = payload.weather;
                            this.form.weatherName = String(payload.weatherName || '');
                            metaDirty = true;
                        }
                        if (typeof payload.markerName === 'string' && payload.markerName !== this.form.markerName) {
                            this.form.markerName = payload.markerName;
                            metaDirty = true;
                        }
                        if (metaDirty) {
                            this.dirty = true;
                            await this.flushMeta();
                        }
                    }
                    const r = await this.persistTabs();
                    return { version: r?.version, updatedAt: r?.updatedAt };
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
        /*
         * v1.4.1.1（需求：待办编辑区改成笔记样式）：
         * 标题已经在编辑器的工具栏下一行，模块区只剩摘要 / 备注 / 封面 / 分类，
         * 默认收起，打开待办第一眼就是「工具栏 → 标题 → 正文」。
         */
        if (this.type === 'todo') this.metaCollapsed = true;
        this.restoreTabsWidth();
        window.addEventListener('resize', this.syncViewport);
        window.addEventListener('beforeunload', this.flushOnLeave);
        /* v1.4.1：正文滚动容器在编辑器内部，scroll 不冒泡 —— 用捕获阶段统一收 */
        this.$el.addEventListener('scroll', this.onPanelScroll, true);
        this.measureBarHeight();
    },
    updated() {
        this.measureBarHeight();
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.syncViewport);
        window.removeEventListener('beforeunload', this.flushOnLeave);
        this.$el.removeEventListener('scroll', this.onPanelScroll, true);
        this.stopTabsResize();
        // 组件没了，页面顶栏也不能继续藏着
        this.$emit('bars-hidden', false);
        // 离开页面把没落库的东西写掉 —— 自动保存虽快，切页往往就在 800ms 内
        this.flushNow();
    },
    methods: {
        syncViewport() {
            this.isMobile = window.innerWidth <= 900;
            if (!this.isMobile) this.setBarsHidden(false);
        },
        /* ── v1.4.1：桌面端页签栏拖动改宽 ───────────────────── */
        restoreTabsWidth() {
            try {
                const v = parseInt(localStorage.getItem('gohub_article_tabs_w') || '', 10);
                if (v >= 96 && v <= 380) this.tabsWidth = v;
            } catch (e) {
                /* 隐私模式下 localStorage 会抛，忽略即可 */
            }
        },
        startTabsResize(e) {
            if (this.isMobile) return;
            const startX = e.clientX;
            const startW = this.tabsWidth;
            const move = (ev) => {
                // 页签栏贴在右边：往左拖 = 变宽
                this.tabsWidth = Math.round(Math.min(380, Math.max(96, startW + (startX - ev.clientX))));
            };
            const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', up);
                this._barResizeOff = null;
                try {
                    localStorage.setItem('gohub_article_tabs_w', String(this.tabsWidth));
                } catch (e2) {
                    /* 忽略 */
                }
            };
            this.stopTabsResize();
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
            window.addEventListener('pointercancel', up);
            this._barResizeOff = up;
        },
        stopTabsResize() {
            if (!this._barResizeOff) return;
            try {
                this._barResizeOff();
            } catch (e) {
                /* 忽略 */
            }
            this._barResizeOff = null;
        },
        /**
         * v1.4.1（需求：移动端上滚隐藏顶部栏 / 返回列表栏）
         * 与记事页顶栏同一套判定：忽略横向容器、可滚范围过小的容器；
         * 反向位移、切换后一瞬的 clamp 位移都当噪声丢掉，避免顶栏来回闪。
         */
        onPanelScroll(e) {
            if (!this.isMobile) return;
            const el = e.target;
            if (!el || typeof el.scrollTop !== 'number') return;
            const scrollX = el.scrollWidth - el.clientWidth;
            const scrollY = el.scrollHeight - el.clientHeight;
            if (scrollX > 4 && scrollY < 80) return;
            const top = el.scrollTop;
            if (scrollY < 120) {
                if (top < 50 && (!this._barSwitchAt || Date.now() - this._barSwitchAt > 400)) this.setBarsHidden(false);
                return;
            }
            const last = typeof el.__aepLastTop === 'number' ? el.__aepLastTop : top;
            el.__aepLastTop = top;
            const delta = top - last;
            if (Math.abs(delta) < 4) return;
            const barH = this._aepBarH || 44;
            if (Date.now() - (this._barSwitchAt || 0) < 260 && Math.abs(delta) <= barH + 40) return;
            const TURN_AT = 12;
            if (delta > 0) {
                const atBottom = scrollY - top <= 48;
                if (atBottom || top >= TURN_AT) this.setBarsHidden(true);
                return;
            }
            if (top < TURN_AT) this.setBarsHidden(false);
        },
        setBarsHidden(v) {
            const next = this.isMobile ? !!v : false;
            if (this.barsHidden === next) {
                this.$emit('bars-hidden', next);
                return;
            }
            const now = Date.now();
            if (this._barSwitchAt && now - this._barSwitchAt < 320) return;
            this.barsHidden = next;
            this._barSwitchAt = now;
            this.$emit('bars-hidden', next);
        },
        /** 顶栏真实高度写进 --aep-bar-h，收起时按它精确上移（否则会留一条细线） */
        measureBarHeight() {
            const bar = this.$el && this.$el.querySelector ? this.$el.querySelector('.aep-bar') : null;
            if (!bar) return;
            const h = bar.offsetHeight;
            if (h > 0 && this._aepBarH !== h) {
                this._aepBarH = h;
                this.$el.style.setProperty('--aep-bar-h', `${h}px`);
            }
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
                mood: '',
                moodName: '',
                weather: '',
                weatherName: '',
                markerName: '',
                /* v1.4.1.1：截止时间（毫秒时间戳，0 = 不设截止） */
                dueAt: 0,
            };
            this.tabs = [];
            this.activeTab = 0;
            this.editorNote = null;
            this.tags = [];
            this.version = 1;
            this.articleUpdatedAt = 0;
            this.articlePublishedAt = 0;
            this.wordCount = 0;
            this.todoTotal = 0;
            this.todoDone = 0;
        },
        async load() {
            if (!this.articleId) return;
            this.loading = true;
            /* v1.4.1：换到另一篇时把「已删除」标记复位，否则新的一篇永远存不上 */
            this.closedByDelete = false;
            // 换文档回到顶部语义：顶栏先露出来
            this.setBarsHidden(false);
            try {
                const id = this.articleId;
                const a = await fetchArticle(id);
                // 请求在飞的时候用户又切了另一篇 —— 丢掉这次结果，避免把旧内容灌进新页
                if (this.articleId !== id) return;
                this.form = {
                    title: String(a?.title || ''),
                    excerpt: String(a?.excerpt || ''),
                    note: String(a?.note || ''),
                    coverFileId: String(a?.coverFileId || ''),
                    coverName: String(a?.coverName || ''),
                    folderId: String(a?.folderId || ''),
                    status: String(a?.status || 'draft'),
                    done: !!a?.done,
                    // v1.4.1.1：待办标题栏字段（文章不用，但一并带上不影响）
                    mood: String(a?.mood || ''),
                    moodName: String(a?.moodName || ''),
                    weather: String(a?.weather || ''),
                    weatherName: String(a?.weatherName || ''),
                    markerName: String(a?.markerName || ''),
                    // v1.4.1.1：截止时间（0 = 不设截止）
                    dueAt: Number(a?.dueAt) || 0,
                };
                this.version = Number(a?.version) || 1;
                this.articleUpdatedAt = Number(a?.updatedAt) || 0;
                this.articlePublishedAt = Number(a?.publishedAt) || Number(a?.createdAt) || 0;
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
            /*
             * v1.4.1.1（需求）：待办编辑区改成与笔记一样 —— 标题由编辑器自己渲染
             * （工具栏下一行），所以这里把文章标题传进去，而不是页签名。
             * 文章仍走 hideHead，标题留在上方模块区，行为不变。
             */
            const isTodo = this.type === 'todo';
            this.editorNote = {
                id: this.articleId,
                title: isTodo ? String(this.form.title || '') : t.title || '',
                content: String(t.content || ''),
                version: this.version,
                updatedAt: this.articleUpdatedAt,
                mood: isTodo ? String(this.form.mood || '') : '',
                moodName: isTodo ? String(this.form.moodName || '') : '',
                weather: isTodo ? String(this.form.weather || '') : '',
                weatherName: isTodo ? String(this.form.weatherName || '') : '',
                markerName: isTodo ? String(this.form.markerName || '') : '',
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
        /* ── v1.4.1：页签点按 / 长按菜单 ───────────────────── */
        onTabClick(i) {
            // 长按刚弹过菜单，这一下 click 是手指抬起带出来的，不要再切页
            if (this.pressFired) {
                this.pressFired = false;
                return;
            }
            this.switchTab(i);
        },
        onTabPressStart(i, e) {
            if (!this.isMobile) return;
            const t = (e.touches && e.touches[0]) || null;
            this.pressStart = { x: t ? t.clientX : 0, y: t ? t.clientY : 0 };
            this.pressFired = false;
            clearTimeout(this.pressTimer);
            this.pressTimer = setTimeout(() => {
                this.pressFired = true;
                this.openTabMenu(i);
            }, 520);
        },
        onTabPressMove(e) {
            if (!this.pressTimer) return;
            const t = (e.touches && e.touches[0]) || null;
            if (!t) return;
            // 手指在滑动（想滚动页签栏）就取消长按
            if (Math.abs(t.clientX - this.pressStart.x) > 10 || Math.abs(t.clientY - this.pressStart.y) > 10) {
                this.onTabPressEnd();
            }
        },
        onTabPressEnd() {
            clearTimeout(this.pressTimer);
            this.pressTimer = null;
        },
        openTabMenu(i) {
            if (i < 0 || i >= this.tabs.length) return;
            if (this.editingTab === i) return;
            this.tabMenu = { open: true, index: i };
        },
        closeTabMenu() {
            this.tabMenu = { open: false, index: -1 };
        },
        menuRenameTab() {
            const i = this.tabMenu.index;
            this.closeTabMenu();
            if (i >= 0) this.startRename(i);
        },
        async menuDeleteTab() {
            const i = this.tabMenu.index;
            this.closeTabMenu();
            if (i > 0) await this.removeTab(i, true);
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
        async removeTab(i, skipConfirm) {
            if (this.tabs.length <= 1) {
                ElMessage.warning(this.$t('article.keepOneTab'));
                return;
            }
            // 移动端长按菜单已经确认过一次，这里不再弹第二个框
            if (!skipConfirm) {
                try {
                    await ElMessageBox.confirm(
                        this.$t('article.deleteTabTip', { name: this.tabs[i]?.title || '' }),
                        this.$t('article.deleteTab'),
                        { type: 'warning', confirmButtonText: this.$t('common.confirm'), cancelButtonText: this.$t('common.cancel') },
                    );
                } catch (e) {
                    return;
                }
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
            if (!this.articleId || !this.dirty || this.closedByDelete) return true;
            const metaId = this.articleId;
            /*
             * v1.4.1：与页签保存排同一条队列。
             * 元信息（0.8s 防抖）与正文自动保存（1.5s）各有各的定时器，
             * 两个定时器撞在一起就会同时拿同一个 version 发两笔请求，必有一笔 409。
             * 排队后第二笔等第一笔回来、带着新版本号再发，从源头避免自相残杀。
             */
            const prev = this.tabSaveLock || Promise.resolve();
            let release;
            this.tabSaveLock = new Promise((r) => (release = r));
            try {
                await prev.catch(() => {});
                if (!this.dirty || this.closedByDelete || this.articleId !== metaId) return true;
                const payload = {
                    title: this.form.title,
                    excerpt: this.form.excerpt,
                    note: this.form.note,
                    coverFileId: this.form.coverFileId,
                    folderId: this.form.folderId,
                    status: this.form.status,
                    version: this.version,
                };
                /* v1.4.1.1：待办标题栏的心情 / 天气 / 标记也走这一笔保存 */
                if (this.type === 'todo') {
                    payload.mood = this.form.mood;
                    payload.moodName = this.form.moodName;
                    payload.weather = this.form.weather;
                    payload.weatherName = this.form.weatherName;
                    payload.markerName = this.form.markerName;
                    payload.dueAt = this.form.dueAt;
                }
                try {
                    const r = await updateArticle(metaId, payload);
                    if (this.articleId !== metaId) return true; // 期间切了文章，不回写状态
                    this.version = Number(r?.version) || this.version;
                    this.dirty = false;
                    this.$emit('changed');
                    this.$emit('saved', { id: this.articleId, title: this.form.title });
                    return true;
                } catch (e) {
                    const err = articleError(e);
                    if (err.conflict) {
                        // 外部（另一标签页 / 另一端）改过：取最新版本重试一次，不打断用户
                        try {
                            const a = await fetchArticle(metaId);
                            this.version = Number(a?.version) || this.version;
                            const r2 = await updateArticle(metaId, { ...payload, version: this.version });
                            this.version = Number(r2?.version) || this.version;
                            this.dirty = false;
                            this.$emit('changed');
                            return true;
                        } catch (e2) {
                            ElMessage.error(articleError(e2).message || this.$t('article.saveFail'));
                            return false;
                        }
                    }
                    ElMessage.error(err.message || this.$t('article.saveFail'));
                    return false;
                }
            } finally {
                release();
            }
        },
        /**
         * v1.4.1：页签保存的唯一入口 —— 串行 + 冲突重试。
         *
         * 之前「保存有时无效」的三个根因都在这里：
         *   1. 编辑器自动保存与手动保存各发一笔、同一个 version → 后到的那笔 409，
         *      而 409 的错误被 catch 掉只弹个 toast，正文其实没落库；
         *   2. 冲突后没有重试，用户刷新就回到旧版本；
         *   3. 保存按钮不看结果，失败了照样弹「已保存」。
         * 现在：所有页签保存排进同一条队列，冲突时取最新版本再提交一次，
         * 失败如实返回 false，由调用方决定要不要报错。
         */
        async persistTabs() {
            if (this.closedByDelete) return null;
            const prev = this.tabSaveLock || Promise.resolve();
            let release;
            this.tabSaveLock = new Promise((r) => (release = r));
            try {
                await prev.catch(() => {});
                const tabId = this.articleId;
                if (!tabId || this.closedByDelete) return null;
                this.captureActiveTab();
                const built = () =>
                    this.tabs.map((t) => ({ id: t.id || '', title: t.title || '', content: String(t.content || '') }));
                const put = async () => {
                    const r = await saveArticleTabs(tabId, { tabs: built(), version: this.version });
                    // 请求在飞时切到了另一篇：结果丢掉，别把旧编号的页签回填到新文章
                    if (this.articleId === tabId) this.applyTabsFromServer(r);
                    return r;
                };
                try {
                    return await put();
                } catch (e) {
                    const err = articleError(e);
                    if (!err.conflict) throw err;
                    // 取服务端最新版本号后重试一次：正文以本地为准（用户正在编辑的就是它）
                    try {
                        const a = await fetchArticle(tabId);
                        this.version = Number(a?.version) || this.version;
                    } catch (e2) {
                        /* 拿不到版本就按原版本再试一次 */
                    }
                    return await put();
                }
            } finally {
                release();
            }
        },
        /** 保存页签（正文 + 顺序 + 页签名）；quiet = 由 saveAll 统一提示，不各自弹 toast */
        async saveTabsNow(quiet = false) {
            if (!this.articleId) return false;
            try {
                await this.persistTabs();
                return true;
            } catch (e) {
                if (!quiet) ElMessage.error(articleError(e).message || this.$t('article.saveFail'));
                return false;
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
            if (this.saving) return;
            this.saving = true;
            try {
                /*
                 * v1.4.1（保存无效的修复）：
                 *   1. 先掐掉还挂着的两处防抖（元信息 0.8s / 编辑器 1.5s）——
                 *      否则它们会在手动保存之后又发一笔旧版本号的请求；
                 *   2. 编辑器正在保存时等它落地，它的回调会把 version 更新到最新；
                 *   3. 两步都拿到明确结果，只有都成功才提示「已保存」。
                 */
                if (this.metaTimer) {
                    clearTimeout(this.metaTimer);
                    this.metaTimer = null;
                }
                const ed = this.$refs.editor;
                if (ed && ed.saveTimer) {
                    clearTimeout(ed.saveTimer);
                    ed.saveTimer = null;
                }
                await this.waitEditorIdle(ed);

                const okMeta = await this.flushMeta();
                const okTabs = await this.saveTabsNow(true);
                if (okMeta && okTabs) {
                    this.editorDirty = false;
                    this.$emit('changed');
                    ElMessage.success(this.$t('article.savedOk'));
                } else {
                    // 明确告诉用户没存上，而不是弹一个「已保存」让他放心去刷新
                    ElMessage.error(this.$t('article.saveFail'));
                }
            } finally {
                this.saving = false;
            }
        },
        /** 等编辑器把在飞的那笔保存跑完（最多 3 秒，避免异常时一直卡住） */
        async waitEditorIdle(ed) {
            if (!ed || !ed.saving) return;
            for (let i = 0; i < 50 && ed.saving; i += 1) {
                await new Promise((r) => setTimeout(r, 60));
            }
        },
        /**
         * v1.4.1：把当前这篇没落库的改动立刻写掉。
         * 页面在「切换到另一篇 / 返回列表 / 换分类」之前调用它 ——
         * 自动保存再快也有 0.8~1.5s 的空窗，正好在这时切走就会丢最后一笔。
         */
        async flushNow() {
            if (!this.articleId || this.closedByDelete) return;
            if (this.metaTimer) {
                clearTimeout(this.metaTimer);
                this.metaTimer = null;
            }
            const ed = this.$refs.editor;
            if (ed && ed.saveTimer) {
                clearTimeout(ed.saveTimer);
                ed.saveTimer = null;
            }
            await this.waitEditorIdle(ed);
            this.captureActiveTab();
            await this.flushMeta();
            await this.saveTabsNow(true);
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
            const ok = await this.flushMeta();
            // v1.4.1：失败就别报「已发布」，否则用户以为上线了，刷新还是草稿
            if (!ok) return;
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
                this.closedByDelete = true;
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
    /* v1.4.1（需求）：移动端上滚收起顶栏，动画与记事页顶栏保持一致 */
    transition: margin-top 0.18s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.14s linear;
}
.aep-root.is-bar-hidden .aep-bar {
    margin-top: calc(-1 * var(--aep-bar-h, 44px) - 1px);
    opacity: 0;
    pointer-events: none;
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
/* v1.4.1.1（需求）：待办截止时间 —— 放在模块标题行，收起模块也看得见 */
.aep-due {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}
.aep-due-icon {
    font-size: 11px;
    color: var(--el-text-color-placeholder);
}
.aep-due-picker {
    width: 176px;
}
.aep-due-picker .el-input__wrapper {
    box-shadow: none;
    background: var(--el-fill-color-light);
}
.aep-due-picker .el-input__inner {
    font-size: 12px;
}
.aep-due-left {
    flex: 0 0 auto;
    padding: 0 7px;
    height: 20px;
    line-height: 20px;
    border-radius: 5px;
    background: var(--el-fill-color-light);
    color: var(--el-text-color-secondary);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.aep-due.is-urgent .aep-due-left {
    background: var(--el-color-warning-light-9);
    color: var(--el-color-warning);
}
.aep-due.is-overdue .aep-due-left {
    background: var(--el-color-danger-light-9);
    color: var(--el-color-danger);
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
    position: relative;
    flex: 0 0 128px;
    width: 128px;
    border-left: 1px solid var(--el-border-color-lighter);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--el-fill-color-lighter);
}
/* v1.4.1：拖动条压在页签栏左边缘，命中区比视觉线宽一些，好抓 */
.aep-tabs-resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 8px;
    transform: translateX(-4px);
    cursor: col-resize;
    z-index: 3;
}
.aep-tabs-resizer::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 2px;
    width: 1px;
    background: transparent;
    transition: background 0.15s;
}
.aep-tabs-resizer:hover::after {
    background: var(--el-color-primary-light-5);
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
/* v1.4.1：移动端排在页签末尾的「新增页签」 */
/* v1.4.1.1（需求）：移动端的「新增页签」只留图标，做成与页签同高的方形虚线按钮 */
.aep-tab-add-end {
    flex: 0 0 auto;
    justify-content: center;
    gap: 0;
    width: 40px;
    min-width: 40px;
    padding: 0;
    border: 1px dashed var(--el-border-color);
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 12px;
}
.aep-tab-add-end:hover {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
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
    /* v1.4.1.1：手机上模块标题行只留「模块 + 截止时间」，提示与剩余徽标让位 */
    .aep-meta-hint {
        display: none;
    }
    .aep-due-picker {
        width: 148px;
    }
    .aep-due-left {
        padding: 0 5px;
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
