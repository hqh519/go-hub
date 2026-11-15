<template>
    <!--
        笔记编辑器（v1.3.0）
        ----------------------------------------------------------------------------
        三种模式共存于同一个组件，共享同一份 md：
          · wysiwyg（实时）：Tiptap 3 富文本，所见即所得；
          · source （源码）：CodeMirror 6，直接改 md；
          · preview（预览）：marked + DOMPurify 渲染成只读 HTML。

        「md 是真源」的落地方式：任何一次切换 / 保存都先取当前视图的 md，
        再把它喂给另一个视图 —— 富文本里的 JSON 只是派生缓存，从不单独落库。
    -->
    <div class="me-root">
        <!-- 标题区 -->
        <div class="me-head">
            <input
                v-model="title"
                class="me-title"
                :placeholder="$t('memo.untitled')"
                maxlength="200"
                @input="scheduleSave"
            />
            <div class="me-status">
                <span v-if="saving" class="me-status-text">{{ $t('memo.saving') }}</span>
                <span v-else-if="dirty" class="me-status-text is-dirty">{{ $t('memo.unsaved') }}</span>
                <span v-else class="me-status-text">{{ $t('memo.saved') }}</span>
                <span class="me-chars">{{ charCount }}</span>
            </div>
        </div>

        <!-- 工具栏：按设置里的行配置渲染，`|` 生成分隔线 -->
        <div class="me-toolbar-wrap">
            <div v-for="(line, li) in toolbarLines" :key="`tl-${li}`" class="me-toolbar">
                <template v-for="(token, ti) in line" :key="`${li}-${ti}`">
                    <span v-if="token === '|'" class="me-sep"></span>
                    <button
                        v-else-if="toolsOf(token)"
                        type="button"
                        class="me-btn"
                        :class="{ 'is-active': toolsOf(token).active ? toolsOf(token).active(editor) : false }"
                        :title="$t(toolsOf(token).label)"
                        @mousedown.prevent
                        @click="runTool(token)"
                    >
                        <span v-if="token.startsWith('h') && /^h[1-6]$/.test(token)" class="me-hlabel">{{ token.toUpperCase() }}</span>
                        <font-awesome-icon v-else-if="toolsOf(token).icon" :icon="toolsOf(token).icon" />
                    </button>
                </template>
                <!-- 每行末尾都跟一组固定的「视图 / 保存」，它不属于可配置工具 -->
                <span class="me-grow"></span>
                <template v-if="li === toolbarLines.length - 1">
                    <button type="button" class="me-btn" :class="{ 'is-active': mode === 'wysiwyg' }" :title="$t('memo.modeLive')" @mousedown.prevent @click="setMode('wysiwyg')">
                        <font-awesome-icon icon="pen-to-square" />
                    </button>
                    <button type="button" class="me-btn" :class="{ 'is-active': mode === 'source' }" :title="$t('memo.modeSource')" @mousedown.prevent @click="setMode('source')">
                        <font-awesome-icon icon="code" />
                    </button>
                    <button type="button" class="me-btn" :class="{ 'is-active': mode === 'preview' }" :title="$t('memo.modePreview')" @mousedown.prevent @click="setMode('preview')">
                        <font-awesome-icon icon="eye" />
                    </button>
                    <button type="button" class="me-btn" :title="$t('memo.save')" @mousedown.prevent @click="saveNow">
                        <font-awesome-icon icon="save" />
                    </button>
                </template>
            </div>
        </div>

        <!-- 编辑区 -->
        <div ref="bodyEl" class="me-body" @contextmenu="onContextMenu" @click="onBodyClick">
            <EditorContent v-show="mode === 'wysiwyg'" :editor="editor" class="me-wysiwyg" />
            <div v-show="mode === 'source'" ref="sourceEl" class="me-source"></div>
            <!-- 预览：内容来自 renderMarkdownSafe（marked + DOMPurify 白名单） -->
            <div v-show="mode === 'preview'" class="me-preview gh-md" v-safe-html="previewHtml"></div>

            <!--
                图片缩放手柄（v1.4.0）：8 个方向的把手浮在选中的图片上方。
                用绝对定位浮层而不是 NodeView，是为了不干预图片节点本身的
                HTML 结构 —— 图片在 md 里必须保持一行 `![alt](src){width=N}`，
                一旦套上 div 包裹层，序列化就得写特例，往返容易失真。
            -->
            <div v-if="imgBox.open" class="me-imgbox" :style="imgBox.boxStyle" @mousedown.stop @click.stop>
                <span
                    v-for="dir in imgHandles"
                    :key="dir"
                    class="me-imghandle"
                    :class="`is-${dir}`"
                    :title="$t('memo.imgResize')"
                    @mousedown.prevent.stop="startImgDrag(dir, $event)"
                    @touchstart.prevent.stop="startImgDrag(dir, $event)"
                ></span>
                <span class="me-imgsize">{{ imgBox.width }}px</span>
            </div>
        </div>

        <!-- 反向链接（v1.5.0）：哪些笔记引用了本篇 -->
        <div class="me-backlinks" :class="{ 'is-open': backlinksOpen }">
            <button type="button" class="me-bl-head" @click="backlinksOpen = !backlinksOpen">
                <font-awesome-icon icon="link" class="me-bl-icon" />
                <span class="me-bl-title">{{ $t('memo.backlinks') }}</span>
                <span class="me-bl-count">{{ backlinks.length }}</span>
                <font-awesome-icon :icon="backlinksOpen ? 'chevron-up' : 'chevron-down'" class="me-bl-caret" />
            </button>
            <div v-if="backlinksOpen" class="me-bl-list">
                <button
                    v-for="(b, i) in backlinks"
                    :key="`${b.noteId}-${i}`"
                    type="button"
                    class="me-bl-item"
                    @click="openRefNote(b.noteId)"
                >
                    <span class="me-bl-name">{{ b.noteTitle || $t('memo.untitled') }}</span>
                    <span v-if="b.blockId" class="me-bl-tag">{{ $t('memo.refBlock') }}</span>
                    <span v-if="b.excerpt" class="me-bl-excerpt">{{ b.excerpt }}</span>
                </button>
                <div v-if="!backlinks.length" class="me-bl-empty">{{ $t('memo.backlinksEmpty') }}</div>
            </div>
        </div>

        <!--
            选图用的隐藏 input。
            v1.3.0 的工具栏「图片」按钮直接调 uploadImage() 而没传文件，
            函数第一行 `if (!file) return` 就返回了 —— 点上去毫无反应。
            现在按钮只负责触发它。
        -->
        <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFileInputChange" />

        <!-- 斜杠菜单 -->
        <Teleport to="body">
            <div v-if="slash.open" class="me-slash" :style="slash.style" @mousedown.prevent>
                <div
                    v-for="(cmd, i) in slash.items"
                    :key="cmd.id"
                    class="me-slash-item"
                    :class="{ 'is-active': i === slash.index }"
                    @mouseenter="slash.index = i"
                    @click="applySlash(cmd)"
                >
                    <font-awesome-icon :icon="cmd.icon" class="me-slash-icon" />
                    <span class="me-slash-label">{{ $t(cmd.label) }}</span>
                    <span class="me-slash-hint">{{ cmd.hint }}</span>
                </div>
                <div v-if="!slash.items.length" class="me-slash-empty">{{ $t('memo.slashEmpty') }}</div>
            </div>
        </Teleport>

        <!-- 引用搜索：`[[` 搜文档，`((` 搜块 -->
        <Teleport to="body">
            <div v-if="ref.open" class="me-slash me-ref" :style="ref.style" @mousedown.prevent>
                <div class="me-ref-head">{{ ref.mode === 'note' ? $t('memo.refNote') : $t('memo.refBlock') }}</div>
                <div
                    v-for="(it, i) in ref.items"
                    :key="it.id"
                    class="me-slash-item"
                    :class="{ 'is-active': i === ref.index }"
                    @mouseenter="ref.index = i"
                    @click="applyRef(it)"
                >
                    <span class="me-ref-label">{{ it.label }}</span>
                    <span class="me-slash-hint">{{ it.hint }}</span>
                </div>
                <div v-if="!ref.items.length" class="me-slash-empty">{{ $t('memo.refEmpty') }}</div>
            </div>
        </Teleport>

        <!-- 选中浮层 -->
        <Teleport to="body">
            <div v-if="bubble.open" class="me-bubble" :style="bubble.style" @mousedown.prevent>
                <button type="button" class="me-bub-btn" :class="{ 'is-on': editor && editor.isActive('bold') }" @click="runTool('bold')"><b>B</b></button>
                <button type="button" class="me-bub-btn" :class="{ 'is-on': editor && editor.isActive('italic') }" @click="runTool('italic')"><i>I</i></button>
                <button type="button" class="me-bub-btn" :class="{ 'is-on': editor && editor.isActive('strike') }" @click="runTool('strike')"><s>S</s></button>
                <button type="button" class="me-bub-btn" :class="{ 'is-on': editor && editor.isActive('code') }" @click="runTool('code')"><font-awesome-icon icon="code" /></button>
                <button type="button" class="me-bub-btn" :class="{ 'is-on': editor && editor.isActive('link') }" @click="runTool('link')"><font-awesome-icon icon="link" /></button>
            </div>
        </Teleport>

        <!-- 大纲浮窗（v1.3.1，需求明确不做侧边栏） -->
        <Teleport to="body">
            <div v-if="outline.open" class="me-outline-mask" @click.self="outline.open = false">
                <div class="me-outline">
                    <div class="me-outline-head">
                        <span class="me-outline-title">{{ $t('memo.outline') }}</span>
                        <button type="button" class="me-btn" :title="$t('common.close')" @click="outline.open = false">
                            <font-awesome-icon icon="times" />
                        </button>
                    </div>
                    <div class="me-outline-list">
                        <button
                            v-for="(it, i) in outline.items"
                            :key="i"
                            type="button"
                            class="me-outline-item"
                            :style="{ paddingLeft: `${(it.level - 1) * 14 + 12}px` }"
                            @click="jumpToHeading(it.pos)"
                        >
                            <span class="me-outline-tag">H{{ it.level }}</span>
                            <span class="me-outline-text">{{ it.text }}</span>
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>

        <!-- 图床选文件 -->
        <FilePickerDialog
            v-model="pickerVisible"
            :instance-id="instanceId"
            @confirm="onPicked"
        />
    </div>
</template>

<script>
import { markRaw } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
// v3 的 extension-table 只有具名导出（没有 default），行/单元格/表头三个子包仍是 default
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';import { ElMessage, ElMessageBox } from 'element-plus';
import FilePickerDialog from '@/components/notes/FilePickerDialog.vue';
import { docToMd, mdToDoc, renderMarkdownSafe, plainTextOf } from '@/utils/markdown';
import { saveNote, memoError, fetchNotes, fetchNoteBlocks, fetchBacklinks, resolveBlock } from '@/utils/memoApi';
import { uploadOne, defaultUploadFolder } from '@/utils/uploadTarget';
import { mediaKindOfMime } from '@/utils/notes';
import { DEFAULT_TOOLBAR_LINES } from '@/utils/memoEditorConfig';

/**
 * 图片扩一个 `width`（v1.4.0）。
 *
 * 官方 Image 只有 src/alt/title —— 拖拽改大小后的宽度必须有地方存。
 * 存 HTML 属性 `width` 而不是行内 style：白名单禁 style，而 `width`
 * 在 DOMPurify 默认白名单里，预览与导出都能原样保留。
 * md 侧对应 `![alt](src){width=600}`（见 utils/markdown.js）。
 */
const ImageWithWidth = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            width: {
                default: null,
                parseHTML: (el) => Number(el.getAttribute('width')) || null,
                renderHTML: (attrs) => (attrs.width ? { width: Math.round(Number(attrs.width)) } : {}),
            },
        };
    },
});

/**
 * v1.3.1 新增的三个自定义块（视频 / 音频 / 附件）。
 *
 * 为什么自己写而不是装扩展：
 *   · 官方没有 video / audio 节点；
 *   · 附件要能落成 md 里的 `<a class="gh-file">`，属性名与序列化规则必须和
 *     utils/markdown.js 完全对齐，第三方扩展的 HTML 规则不受我们控制。
 * 三个都是 atom（不可编辑内部），md 里各占一行，往返稳定。
 */
const Video = Node.create({
    name: 'video',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes() {
        return { src: { default: '' }, poster: { default: '' } };
    },
    parseHTML() {
        return [{ tag: 'video[src]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['video', mergeAttributes(HTMLAttributes, { controls: 'true', class: 'gh-video' })];
    },
});

const Audio = Node.create({
    name: 'audio',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes() {
        return { src: { default: '' } };
    },
    parseHTML() {
        return [{ tag: 'audio[src]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['audio', mergeAttributes(HTMLAttributes, { controls: 'true', class: 'gh-audio' })];
    },
});

const FileAttachment = Node.create({
    name: 'fileAttachment',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes() {
        return { href: { default: '' }, name: { default: '' } };
    },
    parseHTML() {
        return [{ tag: 'a.gh-file' }];
    },
    renderHTML({ node }) {
        return [
            'a',
            {
                class: 'gh-file',
                href: node.attrs.href || '',
                download: '',
                target: '_blank',
                rel: 'noopener noreferrer',
            },
            `📎 ${node.attrs.name || '附件'}`,
        ];
    },
});

/**
 * 引用类行内原子节点（v1.5.0）。
 *
 * 为什么做成 atom 而不是普通文字：引用一旦是文字，用户随手在中间插一个字
 * 就会把 `[[note:abc]]` 拆坏，引用直接失效；atom 在文档里是一个整体，
 * 只能整块删/整块选，序列化回 md 时一字不差。
 *
 * 三个节点对应 md 的三种写法：
 *   · noteRef   ← `[[note:id]]` / `|标题` / `#blk:bid`
 *   · noteEmbed ← `![[…]]`（嵌入，多一个感叹号）
 *   · blockRef  ← `((blk_xxxxxxxx))`
 */
const NoteRef = Node.create({
    name: 'noteRef',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
        return { noteId: { default: '' }, blockId: { default: null }, label: { default: '' } };
    },
    parseHTML() {
        return [{ tag: 'span.gh-noteref' }];
    },
    renderHTML({ node }) {
        const label = node.attrs.label || (node.attrs.blockId ? '◆ 块引用' : '↗ 引用');
        return [
            'span',
            {
                class: 'gh-noteref',
                'data-note-id': node.attrs.noteId || '',
                'data-block-id': node.attrs.blockId || '',
                title: node.attrs.blockId ? '块引用（点开源笔记）' : '笔记引用（点开源笔记）',
            },
            label || '↗ 引用',
        ];
    },
});

const NoteEmbed = Node.create({
    name: 'noteEmbed',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
        return { noteId: { default: '' }, blockId: { default: null }, label: { default: '' } };
    },
    parseHTML() {
        return [{ tag: 'span.gh-noteembed' }];
    },
    renderHTML({ node }) {
        return [
            'span',
            {
                class: 'gh-noteembed',
                'data-note-id': node.attrs.noteId || '',
                'data-block-id': node.attrs.blockId || '',
                title: '嵌入引用',
            },
            `⤵ ${node.attrs.label || '嵌入内容'}`,
        ];
    },
});

const BlockRef = Node.create({
    name: 'blockRef',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
        return { blockId: { default: '' } };
    },
    parseHTML() {
        return [{ tag: 'span.gh-blockref' }];
    },
    renderHTML({ node }) {
        return ['span', { class: 'gh-blockref', 'data-block-id': node.attrs.blockId || '' }, '◆ 块引用'];
    },
});

/**
 * 提示块（callout）—— 容器块，里面可以放任意块。
 * 用 `data-callout` 而不是 class 做识别，class 留给样式、可能被用户改。
 */
const Callout = Node.create({
    name: 'callout',
    group: 'block',
    content: 'block+',
    defining: true,
    addAttributes() {
        return { type: { default: 'info' } };
    },
    parseHTML() {
        return [{ tag: 'div[data-callout]' }];
    },
    renderHTML({ node, HTMLAttributes }) {
        const type = String(node.attrs.type || 'info');
        return [
            'div',
            mergeAttributes(HTMLAttributes, {
                'data-callout': type,
                class: `gh-callout gh-callout-${type}`,
            }),
            0,
        ];
    },
});

/**
 * 表格单元格 / 表头各扩一个 `align`。
 *
 * 官方扩展只认 colspan/rowspan/colwidth，没有对齐属性 —— 而 md 的 `:---:`
 * 就是对齐信息，不加这个属性，一次保存就会把表格对齐吃掉（往返丢格式）。
 * 存储用 `align` 属性而不是 style：白名单里 style 是被禁的。
 */
const alignAttribute = {
    align: {
        default: null,
        parseHTML: (el) => el.getAttribute('align'),
        renderHTML: (attrs) => (attrs.align ? { align: attrs.align } : {}),
    },
};
const CellWithAlign = TableCell.extend({
    addAttributes() {
        return { ...this.parent?.(), ...alignAttribute };
    },
});
const HeaderWithAlign = TableHeader.extend({
    addAttributes() {
        return { ...this.parent?.(), ...alignAttribute };
    },
});

/**
 * 标题折叠插件（v1.3.1）。
 *
 * 折叠区间 = 从该标题的下一个块开始，到「下一个同级或更高级标题」之前。
 * 隐藏方式用 node decoration 加 class（display:none），**不改文档结构** ——
 * 一旦真把内容从文档里摘出去，用户在这段隐藏区里打字就会串到别处，
 * 而且保存时的 md 会缺内容，属于「看着折叠了、其实内容没了」的灾难。
 *
 * 折叠状态不跟随文档位置映射：任何一次编辑都清空折叠（见 onEditorUpdate）。
 * 折叠只是阅读辅助，编辑时自动展开最不容易出错。
 */
const foldKey = new PluginKey('memoFold');
function createFoldPlugin(getFolds) {
    return new Plugin({
        key: foldKey,
        props: {
            decorations(state) {
                const folds = getFolds();
                if (!folds || !folds.size) return null;
                const decos = [];
                let skipLevel = 0;
                state.doc.forEach((node, offset) => {
                    const isHeading = node.type.name === 'heading';
                    const level = isHeading ? Number(node.attrs.level) || 1 : 0;
                    // 遇到同级或更高级标题 → 折叠区间到此为止
                    if (skipLevel && isHeading && level <= skipLevel) skipLevel = 0;
                    if (skipLevel) {
                        decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'gh-fold-hidden' }));
                    } else if (isHeading && folds.has(offset)) {
                        skipLevel = level;
                        decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'gh-fold-title' }));
                    }
                });
                return DecorationSet.create(state.doc, decos);
            },
        },
    });
}

/**
 * 工具栏工具表。
 * 每一项只描述「长什么样 + 点了做什么」，具体渲染哪一行、哪几个由设置里的字符串决定。
 * 这样「设置页改工具栏」就是改一个数组，不需要动模板。
 */
const TOOLS = {
    bold: { icon: 'bold', label: 'memo.toolBold', run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e && e.isActive('bold') },
    italic: { icon: 'italic', label: 'memo.toolItalic', run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e && e.isActive('italic') },
    strike: { icon: 'strikethrough', label: 'memo.toolStrike', run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e && e.isActive('strike') },
    underline: { icon: 'underline', label: 'memo.toolUnderline', run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e && e.isActive('underline') },
    code: { icon: 'code', label: 'memo.toolCode', run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e && e.isActive('code') },
    h1: { label: 'memo.toolH1', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e && e.isActive('heading', { level: 1 }) },
    h2: { label: 'memo.toolH2', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e && e.isActive('heading', { level: 2 }) },
    h3: { label: 'memo.toolH3', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e && e.isActive('heading', { level: 3 }) },
    h4: { label: 'memo.toolH4', run: (e) => e.chain().focus().toggleHeading({ level: 4 }).run(), active: (e) => e && e.isActive('heading', { level: 4 }) },
    h5: { label: 'memo.toolH5', run: (e) => e.chain().focus().toggleHeading({ level: 5 }).run(), active: (e) => e && e.isActive('heading', { level: 5 }) },
    h6: { label: 'memo.toolH6', run: (e) => e.chain().focus().toggleHeading({ level: 6 }).run(), active: (e) => e && e.isActive('heading', { level: 6 }) },
    bulletList: { icon: 'list-ul', label: 'memo.toolBullet', run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e && e.isActive('bulletList') },
    orderedList: { icon: 'list-ol', label: 'memo.toolOrdered', run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e && e.isActive('orderedList') },
    taskList: { icon: 'check-square', label: 'memo.toolTask', run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e && e.isActive('taskList') },
    blockquote: { icon: 'quote-right', label: 'memo.toolQuote', run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e && e.isActive('blockquote') },
    codeBlock: { icon: 'terminal', label: 'memo.toolCodeBlock', run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e && e.isActive('codeBlock') },
    hr: { icon: 'minus', label: 'memo.toolHr', run: (e) => e.chain().focus().setHorizontalRule().run() },
    link: { icon: 'link', label: 'memo.toolLink', run: null, active: (e) => e && e.isActive('link') },
    image: { icon: 'image', label: 'memo.toolImage', run: null },
    file: { icon: 'folder-open', label: 'memo.toolFile', run: null },
    /*
     * v1.3.1 新增工具。
     * table / callout / video / audio / filePick 都由 runTool 里特判（需要弹窗或追问参数），
     * 这里 run 留 null 表示「不进通用分支」。
     */
    table: { icon: 'table', label: 'memo.toolTable', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    callout: { icon: 'circle-info', label: 'memo.toolCallout', run: null },
    video: { icon: 'file-video', label: 'memo.toolVideo', run: null },
    audio: { icon: 'file-audio', label: 'memo.toolAudio', run: null },
    highlight: { icon: 'highlighter', label: 'memo.toolHighlight', run: (e) => e.chain().focus().toggleHighlight().run(), active: (e) => e && e.isActive('highlight') },
    outline: { icon: 'list', label: 'memo.toolOutline', run: null },
    foldAll: { icon: 'compress', label: 'memo.toolFoldAll', run: null },
    clear: { icon: 'eraser', label: 'memo.toolClear', run: (e) => e.chain().focus().unsetAllMarks().clearNodes().run() },
    undo: { icon: 'undo', label: 'memo.toolUndo', run: (e) => e.chain().focus().undo().run() },
    redo: { icon: 'redo', label: 'memo.toolRedo', run: (e) => e.chain().focus().redo().run() },
};

/** 斜杠菜单命令表 */
const SLASH_COMMANDS = [
    { id: 'h1', icon: 'heading', label: 'memo.toolH1', hint: '#', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
    { id: 'h2', icon: 'heading', label: 'memo.toolH2', hint: '##', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { id: 'h3', icon: 'heading', label: 'memo.toolH3', hint: '###', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
    { id: 'bulletList', icon: 'list-ul', label: 'memo.toolBullet', hint: '-', run: (e) => e.chain().focus().toggleBulletList().run() },
    { id: 'orderedList', icon: 'list-ol', label: 'memo.toolOrdered', hint: '1.', run: (e) => e.chain().focus().toggleOrderedList().run() },
    { id: 'taskList', icon: 'check-square', label: 'memo.toolTask', hint: '[ ]', run: (e) => e.chain().focus().toggleTaskList().run() },
    { id: 'blockquote', icon: 'quote-right', label: 'memo.toolQuote', hint: '>', run: (e) => e.chain().focus().toggleBlockquote().run() },
    { id: 'codeBlock', icon: 'terminal', label: 'memo.toolCodeBlock', hint: '```', run: (e) => e.chain().focus().toggleCodeBlock().run() },
    { id: 'hr', icon: 'minus', label: 'memo.toolHr', hint: '---', run: (e) => e.chain().focus().setHorizontalRule().run() },
    { id: 'table', icon: 'table', label: 'memo.toolTable', hint: '|', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: 'callout', icon: 'circle-info', label: 'memo.toolCallout', hint: ':::', run: null },
    { id: 'image', icon: 'image', label: 'memo.toolImage', hint: '', run: null },
    { id: 'file', icon: 'folder-open', label: 'memo.toolFile', hint: '', run: null },
    { id: 'video', icon: 'file-video', label: 'memo.toolVideo', hint: '', run: null },
];

export default {
    name: 'MemoEditor',
    components: { EditorContent, FilePickerDialog },
    props: {
        /** 笔记详情（含 id / content / version）；null = 还没选中 */
        note: { type: Object, default: null },
        instanceId: { type: String, default: '' },
        /** 工具栏行配置（来自编辑器设置） */
        toolbarConfig: { type: Array, default: () => DEFAULT_TOOLBAR_LINES },
    },
    emits: ['saved', 'dirty', 'request-settings', 'open-note'],
    data() {
        return {
            editor: null,
            mode: 'wysiwyg',
            title: '',
            version: 0,
            dirty: false,
            saving: false,
            pendingSave: false,
            charCount: 0,
            pickerVisible: false,
            sourceView: null,
            saveTimer: null,
            previewHtml: '',
            slash: { open: false, style: {}, index: 0, items: [], from: 0, to: 0, query: '' },
            bubble: { open: false, style: {} },
            /** 大纲浮窗（v1.3.1）：按需求做成悬浮弹窗，不做占位侧边栏 */
            outline: { open: false, items: [] },
            /**
             * 引用搜索（v1.3.1 · v1.5.0 计划）：
             * `[[` 搜文档、`((` 搜块。两者共用一个面板，靠 mode 区分。
             */
            ref: { open: false, mode: '', query: '', items: [], index: 0, style: {} },
            // 上传中的图片占位：避免连点多次上传把同一张图插两遍
            uploading: false,
            /** 反向链接面板（v1.5.0）：默认收起，避免把正文顶下去 */
            backlinks: [],
            backlinksOpen: false,
            /** 图片缩放手柄浮层（v1.4.0） */
            imgBox: { open: false, boxStyle: {}, width: 0, pos: 0, nodeW: 0 },
            /** 8 个把手：四角 + 四边（nw / n / ne / e / se / s / sw / w） */
            imgHandles: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'],
        };
    },
    computed: {
        toolbarLines() {
            const cfg = Array.isArray(this.toolbarConfig) && this.toolbarConfig.length ? this.toolbarConfig : DEFAULT_TOOLBAR_LINES;
            return cfg
                .map((line) => String(line || '').split(/\s+/).filter(Boolean))
                .filter((line) => line.length);
        },
    },
    watch: {
        note: {
            immediate: true,
            handler(note) {
                this.applyNote(note);
                this.loadBacklinks();
            },
        },
        mode(next, prev) {
            this.switchMode(prev, next);
        },
    },
    mounted() {
        this.createEditor();
        // Ctrl/Cmd + S 保存（浏览器默认的「保存网页」在这里没有意义）
        this.onKeydownGlobal = (e) => {
            if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
                e.preventDefault();
                this.saveNow();
            }
        };
        window.addEventListener('keydown', this.onKeydownGlobal);
        // 手柄用绝对坐标，滚动/改窗口大小都得重算位置
        this.onViewportChange = () => this.syncImgBox();
        window.addEventListener('resize', this.onViewportChange);
        window.addEventListener('scroll', this.onViewportChange, true);
    },
    beforeUnmount() {
        window.removeEventListener('keydown', this.onKeydownGlobal);
        window.removeEventListener('resize', this.onViewportChange);
        window.removeEventListener('scroll', this.onViewportChange, true);
        if (this.saveTimer) clearTimeout(this.saveTimer);
        if (this.sourceView) {
            this.sourceView.destroy();
            this.sourceView = null;
        }
        if (this.editor) {
            this.editor.destroy();
            this.editor = null;
        }
    },
    methods: {
        // ---------------- 初始化 ----------------

        createEditor() {
            // 折叠位置集合：普通 Set（不给 Vue 代理，插件每帧读它）
            this._folds = new Set();
            // markRaw：Tiptap 实例内部大量依赖「同一对象引用」，被 reactive 包一层会出怪问题
            this.editor = markRaw(new Editor({
                extensions: [
                    StarterKit.configure({
                        // 链接单独配置：点击不跳转（编辑态误触会把内容顶走），仅 Ctrl+点击打开
                        link: {
                            openOnClick: false,
                            autolink: true,
                            HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
                        },
                        codeBlock: { HTMLAttributes: { class: 'gh-code-block' } },
                    }),
                    ImageWithWidth.configure({ inline: false, allowBase64: false }),
                    TaskList,
                    TaskItem.configure({ nested: true }),
                    Placeholder.configure({ placeholder: this.$t('memo.placeholder') }),
                    // v1.3.1：下划线（StarterKit v3 不含，之前点按钮会「没反应」）
                    Underline,
                    Highlight.configure({ multicolor: false }),
                    // 表格：单元格/表头各扩一个 align 属性，md 的 `:---:` 才能往返
                    Table.configure({ resizable: false, HTMLAttributes: { class: 'gh-table' } }),
                    TableRow,
                    CellWithAlign,
                    HeaderWithAlign,
                    // v1.3.1 自定义块
                    Video,
                    Audio,
                    FileAttachment,
                    Callout,
                    // v1.5.0 引用类行内原子节点
                    NoteRef,
                    NoteEmbed,
                    BlockRef,
                    // 标题折叠（装饰层，不动文档结构）
                    createFoldPlugin(() => this._folds),
                ],
                content: this.docOf(this.note?.content || ''),
                editorProps: {
                    attributes: { class: 'gh-editor-content' },
                    handleKeyDown: (view, event) => this.onEditorKeyDown(view, event),
                    handlePaste: (view, event) => this.onEditorPaste(view, event),
                    handleDrop: (view, event) => this.onEditorDrop(view, event),
                },
                onUpdate: () => this.onEditorUpdate(),
                onSelectionUpdate: () => this.onSelectionChange(),
                onBlur: () => {
                    this.bubble.open = false;
                },
            }));
        },

        docOf(md) {
            try {
                return mdToDoc(md || '');
            } catch (e) {
                // 解析失败：宁可显示成纯文本，也不要把 md 覆盖掉
                return mdToDoc(String(md || '').replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&'));
            }
        },

        applyNote(note) {
            const id = note?.id || '';
            if (!id) {
                this.title = '';
                this.version = 0;
                this.charCount = 0;
                this.editor?.commands.clearContent(true);
                return;
            }
            this.title = String(note.title || '');
            this.version = Number(note.version) || 1;
            const md = String(note.content || '');
            this.charCount = plainTextOf(md).length;
            this.dirty = false;
            if (this.editor) this.editor.commands.setContent(this.docOf(md), { emitUpdate: false });
            if (this.sourceView) this.sourceView.dispatch({ changes: { from: 0, to: this.sourceView.state.doc.length, insert: md } });
            this.$emit('dirty', false);
        },

        // ---------------- 模式切换 ----------------

        /** 当前视图对应的 md —— 所有出口（保存 / 预览 / 切源码）都走它 */
        currentMd() {
            if (this.mode === 'source') {
                return this.sourceView ? this.sourceView.state.doc.toString() : '';
            }
            return this.editor ? docToMd(this.editor.getJSON()) : '';
        },

        setMode(next) {
            if (next === this.mode) return;
            this.mode = next;
        },

        async switchMode(prev, next) {
            // 先把「上一个视图」的内容取成 md，再灌给新视图 —— 顺序不能反
            let md = '';
            if (prev === 'source') {
                md = this.sourceView ? this.sourceView.state.doc.toString() : this.currentMdFallback();
            } else if (prev === 'preview') {
                md = this.lastMd;
            } else {
                md = this.editor ? docToMd(this.editor.getJSON()) : '';
            }
            this.lastMd = md;
            if (next === 'source') {
                await this.mountSource(md);
            } else if (next === 'wysiwyg') {
                this.editor.commands.setContent(this.docOf(md), { emitUpdate: false });
            } else {
                this.previewHtml = renderMarkdownSafe(md);
            }
        },

        currentMdFallback() {
            return this.lastMd || '';
        },

        async mountSource(md) {
            // CodeMirror 6 是懒加载的：只有真的切到源码模式才把 ~350KB 拉下来
            const [{ EditorView, basicSetup }, { markdown }] = await Promise.all([
                import('codemirror'),
                import('@codemirror/lang-markdown'),
            ]);
            const host = this.$refs.sourceEl;
            if (!host) return;
            if (this.sourceView) this.sourceView.destroy();
            this.sourceView = markRaw(new EditorView({
                doc: md,
                parent: host,
                extensions: [
                    basicSetup,
                    markdown(),
                    EditorView.theme({
                        '&': { height: '100%', fontSize: '14px' },
                        '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.7' },
                        '.cm-content': { padding: '8px 4px 40px' },
                    }),
                    EditorView.updateListener.of((u) => {
                        if (u.docChanged) {
                            this.onSourceChange();
                        }
                    }),
                ],
            }));
            this.sourceView.focus();
        },

        onSourceChange() {
            const md = this.currentMd();
            this.lastMd = md;
            this.charCount = plainTextOf(md).length;
            this.markDirty();
        },

        onEditorUpdate() {
            const md = this.currentMd();
            this.lastMd = md;
            this.charCount = plainTextOf(md).length;
            this.updateSlash();
            this.updateRef();
            /*
             * 编辑即展开全部折叠。
             * 折叠状态存的是文档位置（pos），编辑后位置全变 —— 不清理就会出现
             * 「明明没折叠，内容却看不见」。折叠只服务阅读，不参与编辑。
             */
            if (this._folds && this._folds.size) {
                this._folds.clear();
            }
            this.markDirty();
        },

        markDirty() {
            this.dirty = true;
            this.$emit('dirty', true);
            this.scheduleSave();
        },

        // ---------------- 保存 ----------------

        scheduleSave() {
            if (this.saveTimer) clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(() => this.saveNow(), 1500);
        },

        // ---------------- 引用与反链（v1.5.0） ----------------

        /** 当前这一篇被谁引用了（整篇 / 本篇某个块） */
        async loadBacklinks() {
            const id = this.note?.id;
            if (!id) {
                this.backlinks = [];
                return;
            }
            try {
                const r = await fetchBacklinks(id);
                this.backlinks = Array.isArray(r?.backlinks) ? r.backlinks : [];
            } catch (e) {
                // 反链是辅助信息，拉不到就当没有 —— 绝不能因为它挡住正文
                this.backlinks = [];
            }
        },

        /** 点正文里的引用（noteRef / noteEmbed / blockRef）跳转 */
        onBodyClick(ev) {
            const el = ev.target?.closest?.('.gh-noteref, .gh-noteembed, .gh-blockref');
            if (!el) return;
            const noteId = el.getAttribute('data-note-id') || '';
            const blockId = el.getAttribute('data-block-id') || '';
            if (noteId) {
                this.openRefNote(noteId);
                return;
            }
            if (blockId) this.openBlockRef(blockId);
        },

        /** 只有块 ID 时先反查它属于哪篇笔记 */
        async openBlockRef(blockId) {
            try {
                const r = await resolveBlock(blockId);
                if (r?.noteId) this.openRefNote(r.noteId);
                else ElMessage.info(this.$t('memo.refEmpty'));
            } catch (e) {
                ElMessage.info(this.$t('memo.refEmpty'));
            }
        },

        openRefNote(noteId) {
            if (!noteId) return;
            // 指向自己就不折腾了（切走再切回来会把正在编辑的草稿丢掉）
            if (noteId === this.note?.id) return;
            this.$emit('open-note', noteId);
        },

        // ---------------- 图片缩放（v1.4.0） ----------------

        /**
         * 把 8 个手柄对齐到当前选中图片的矩形上。
         * 每次选择变化 / 滚动 / 窗口尺寸变化都要重算 —— 用的是绝对坐标，
         * 不重算就会出现「图片已经滚走了，手柄还钉在原地」。
         */
        syncImgBox() {
            const empty = { open: false, boxStyle: {}, width: 0, pos: 0, nodeW: 0 };
            const ed = this.editor;
            const host = this.$refs.bodyEl;
            if (!ed || this.mode !== 'wysiwyg' || !host) {
                if (this.imgBox.open) this.imgBox = empty;
                return;
            }
            const sel = ed.state.selection;
            if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'image') {
                if (this.imgBox.open) this.imgBox = empty;
                return;
            }
            const dom = ed.view.nodeDOM(sel.from);
            if (!dom || typeof dom.getBoundingClientRect !== 'function') {
                this.imgBox = empty;
                return;
            }
            const r = dom.getBoundingClientRect();
            const h = host.getBoundingClientRect();
            this.imgBox = {
                open: true,
                pos: sel.from,
                width: Math.round(r.width),
                nodeW: Number(sel.node.attrs.width) || Math.round(r.width),
                boxStyle: {
                    left: `${Math.round(r.left - h.left + host.scrollLeft)}px`,
                    top: `${Math.round(r.top - h.top + host.scrollTop)}px`,
                    width: `${Math.round(r.width)}px`,
                    height: `${Math.round(r.height)}px`,
                },
            };
        },

        /**
         * 拖动某个手柄改宽度。
         *
         * 只有宽度会落库（md 里就是 `{width=N}`），高度按原始比例自动跟随：
         * 单独存高度在 md 里没有位置可放，存了也留不住，不如直接锁比例。
         * 上下两个把手因此也用「纵向位移」换算成宽度变化 —— 手感仍然是「拉大拉小」。
         */
        startImgDrag(dir, ev) {
            const point = ev.touches?.[0] || ev.changedTouches?.[0] || ev;
            const startX = Number(point.clientX) || 0;
            const startY = Number(point.clientY) || 0;
            const startW = this.imgBox.nodeW || this.imgBox.width || 200;
            const pos = this.imgBox.pos;
            const sign = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0;
            const apply = (w) => {
                const ed = this.editor;
                if (!ed) return;
                // addToHistory:false —— 拖一次不该在撤销栈里留几十步
                ed.chain()
                    .setNodeSelection(pos)
                    .updateAttributes('image', { width: w })
                    .setMeta('addToHistory', false)
                    .run();
                this.imgBox = { ...this.imgBox, width: w, nodeW: w };
                this.syncImgBox();
            };
            const onMove = (e) => {
                const p = e.touches?.[0] || e.changedTouches?.[0] || e;
                const dx = (Number(p.clientX) || 0) - startX;
                const dy = (Number(p.clientY) || 0) - startY;
                const raw = sign ? startW + sign * dx : startW + dy;
                apply(Math.max(80, Math.min(2400, Math.round(raw))));
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('touchmove', onMove);
                window.removeEventListener('touchend', onUp);
                this.markDirty();
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchmove', onMove, { passive: false });
            window.addEventListener('touchend', onUp);
        },

        async saveNow() {
            if (!this.note?.id) return;
            if (this.saving) {
                this.pendingSave = true;
                return;
            }
            this.saving = true;
            const md = this.currentMd();
            this.lastMd = md;
            try {
                const r = await saveNote(this.note.id, {
                    title: this.title,
                    content: md,
                    version: this.version,
                });
                this.version = Number(r?.version) || this.version + 1;
                this.dirty = false;
                this.$emit('dirty', false);
                this.$emit('saved', {
                    id: this.note.id,
                    title: this.title || '',
                    version: this.version,
                    updatedAt: r?.updatedAt || Date.now(),
                    charCount: this.charCount,
                });
                // 正文里的引用可能变了，反链要跟着刷新（失败也不影响保存）
                this.loadBacklinks();
            } catch (e) {
                const err = memoError(e);
                if (err.conflict) {
                    this.saving = false;
                    await this.resolveConflict(err);
                    return;
                }
                ElMessage.error(err.message || this.$t('memo.saveFail'));
            } finally {
                this.saving = false;
                if (this.pendingSave) {
                    this.pendingSave = false;
                    this.scheduleSave();
                }
            }
        },

        /**
         * 版本冲突：绝不静默覆盖。
         * 用户有两个选择 —— 用本地的覆盖服务端，或放弃本地重新加载。
         * 默认动作是「放弃」，因为覆盖会真的丢掉另一端刚写的内容。
         */
        async resolveConflict(err) {
            try {
                await ElMessageBox.confirm(
                    this.$t('memo.conflictTip'),
                    this.$t('memo.conflictTitle'),
                    {
                        confirmButtonText: this.$t('memo.conflictOverwrite'),
                        cancelButtonText: this.$t('memo.conflictReload'),
                        type: 'warning',
                    },
                );
                // 覆盖：带服务端最新 version 再存一次
                this.version = Number(err.version) || this.version;
                await this.saveNow();
            } catch (e) {
                this.$emit('reload', this.note?.id);
            }
        },

        // ---------------- 工具栏 ----------------

        toolsOf(token) {
            return TOOLS[token] || null;
        },

        async runTool(token) {
            const tool = TOOLS[token];
            if (!tool) return;
            if (token === 'link') return this.insertLink();
            if (token === 'image') return this.openImagePicker();
            if (token === 'file' || token === 'video' || token === 'audio') {
                // 三个入口共用一个选文件弹窗，落地类型由文件自身的 mime 决定
                this.pickerVisible = true;
                return;
            }
            if (token === 'callout') return this.insertCallout();
            if (token === 'outline') return this.openOutline();
            if (token === 'foldAll') return this.toggleFoldAll();
            if (!this.editor) return;
            if (this.mode !== 'wysiwyg') this.mode = 'wysiwyg';
            tool.run(this.editor);
            this.onEditorUpdate();
        },

        async insertLink() {
            if (!this.editor) return;
            let href = '';
            try {
                const cur = this.editor.getAttributes('link')?.href || '';
                const r = await ElMessageBox.prompt(this.$t('memo.linkTip'), this.$t('memo.toolLink'), {
                    inputValue: cur,
                    inputPlaceholder: 'https://',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                });
                href = String(r.value || '').trim();
            } catch (e) {
                return;
            }
            if (!href) {
                this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
                return;
            }
            // 只认 http(s) / mailto / 站内相对地址，挡掉 javascript: 之类的协议
            if (!/^(https?:\/\/|mailto:|tel:|\/)/i.test(href)) href = `https://${href}`;
            this.editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
            this.onEditorUpdate();
        },

        /** 粘贴 / 拖拽 / 选图 三条上传路径统一走这里 */
        async uploadImage(file) {
            if (!file || this.uploading) return;
            if (!/^image\//i.test(file.type || '')) {
                ElMessage.warning(this.$t('memo.onlyImage'));
                return;
            }
            this.uploading = true;
            const notice = ElMessage({ message: this.$t('memo.uploading'), duration: 0 });
            try {
                const hit = await uploadOne(file, { uploadFolder: defaultUploadFolder('memo'), instanceId: this.instanceId }, { source: 'Attachment' });
                // 存相对地址：换域名 / 换渠道后历史笔记不会挂图（笔记只存引用，不存绝对 URL）
                const src = `/file/${encodeURIComponent(hit.id)}`;
                if (this.editor) this.editor.chain().focus().setImage({ src, alt: hit.name || '' }).run();
                this.onEditorUpdate();
            } catch (e) {
                ElMessage.error(e?.message || this.$t('memo.uploadFail'));
            } finally {
                notice.close();
                this.uploading = false;
            }
        },

        onPicked(files) {
            if (!this.editor) return;
            const list = Array.isArray(files) ? files : [];
            if (!list.length) return;
            const ed = this.editor;
            for (const f of list) {
                const id = String(f?.id || '');
                if (!id) continue;
                const src = `/file/${encodeURIComponent(id)}`;
                const mime = String(f.mime || f.type || '');
                const name = String(f.originalName || f.name || '');
                const kind = f.mediaKind || mediaKindOfMime(mime);
                if (kind === 'image') {
                    ed.chain().focus().setImage({ src, alt: name }).run();
                } else if (kind === 'video') {
                    ed.chain().focus().insertContent({ type: 'video', attrs: { src, poster: '' } }).run();
                } else if (kind === 'audio') {
                    ed.chain().focus().insertContent({ type: 'audio', attrs: { src } }).run();
                } else {
                    ed.chain().focus().insertContent({ type: 'fileAttachment', attrs: { href: src, name: name || id } }).run();
                }
            }
            this.onEditorUpdate();
        },

        /** 工具栏「图片」：打开系统选图框（v1.3.0 缺的就是这一步） */
        openImagePicker() {
            const el = this.$refs.fileInput;
            if (!el) return;
            // 先清空 value：同一个文件连选两次也要能触发 change
            el.value = '';
            el.click();
        },

        async onFileInputChange(event) {
            const files = Array.from(event?.target?.files || []);
            if (event?.target) event.target.value = '';
            // 串行上传：并行会把带宽打满，而且插入顺序会乱
            for (const f of files) {
                await this.uploadImage(f);
            }
        },

        /**
         * 屏蔽浏览器原生右键菜单（v1.3.1 需求）。
         *
         * 只挡「编辑区里有文字被选中」的情况：这时候用户想要的是编辑器的操作，
         * 而弹出来的是「复制/检查/翻译」那一套，既挡视线又容易误点。
         * 没有选中时保留原生菜单 —— 用户可能真的要用「粘贴」「检查」。
         */
        onContextMenu(event) {
            const sel = window.getSelection?.();
            const hasSel = !!(sel && String(sel.toString() || '').trim());
            if (hasSel || this.bubble.open) {
                event.preventDefault();
                return false;
            }
            return true;
        },

        // ---------------- v1.3.1 新增块与视图 ----------------

        /**
         * 插入提示块。
         *
         * 类型先落 info，插进去之后点提示块左上角的类型标签循环切换
         * （info → tip → warning → danger）。不用「先弹窗选类型」：
         * 多一次弹窗就多一次打断，而类型本身是随时可改的。
         */
        insertCallout() {
            const ed = this.editor;
            if (!ed) return;
            if (this.mode !== 'wysiwyg') this.mode = 'wysiwyg';
            ed.chain()
                .focus()
                .insertContent({ type: 'callout', attrs: { type: 'info' }, content: [{ type: 'paragraph' }] })
                .run();
            this.onEditorUpdate();
        },

        /** 点提示块的类型标签：轮换 info → tip → warning → danger */
        cycleCallout() {
            /*
             * 暂不提供点击切换（v1.3.1）。
             * 类型是 callout 唯一的属性，换成 UI 就要在节点里塞一个静态子元素，
             * 而重新解析 md 时子元素会被丢弃，往返容易出岔子。
             * 需要的用户可以在源码模式直接改 `:::callout{type=warning}` —— 那本来就是真源。
             */
        },

        /** 大纲浮窗：扫一遍顶层标题，点一条跳过去 */
        openOutline() {
            const ed = this.editor;
            if (!ed) return;
            const items = [];
            ed.state.doc.forEach((node, offset) => {
                if (node.type.name === 'heading') {
                    items.push({
                        level: Number(node.attrs.level) || 1,
                        text: node.textContent || this.$t('memo.untitled'),
                        pos: offset,
                    });
                }
            });
            if (!items.length) {
                ElMessage.info(this.$t('memo.outlineEmpty'));
                return;
            }
            this.outline = { open: true, items };
        },

        jumpToHeading(pos) {
            const ed = this.editor;
            if (!ed) return;
            this.outline.open = false;
            // +1 进入标题节点内部，否则光标会停在节点边界上
            ed.chain().focus().setTextSelection(Math.min(pos + 1, ed.state.doc.content.size)).run();
        },

        /** 一键折叠 / 展开所有标题 */
        toggleFoldAll() {
            const ed = this.editor;
            if (!ed) return;
            const set = this._folds || (this._folds = new Set());
            if (set.size) {
                set.clear();
            } else {
                let count = 0;
                ed.state.doc.forEach((node, offset) => {
                    if (node.type.name === 'heading') {
                        set.add(offset);
                        count += 1;
                    }
                });
                if (!count) {
                    ElMessage.info(this.$t('memo.outlineEmpty'));
                    return;
                }
            }
            // 空事务：只为让 decorations 重算，不产生文档变更（不会标脏、不会触发保存）
            ed.view.dispatch(ed.state.tr);
        },

        /** 点标题左侧的折叠标记：只折叠这一节 */
        toggleFoldAt(pos) {
            const ed = this.editor;
            if (!ed) return;
            const set = this._folds || (this._folds = new Set());
            if (set.has(pos)) set.delete(pos);
            else set.add(pos);
            ed.view.dispatch(ed.state.tr);
        },

        // ---------------- 引用搜索：`[[` 文档 / `((` 块 ----------------

        closeRef() {
            if (this.ref.open) this.ref = { ...this.ref, open: false, items: [], index: 0, mode: '' };
        },

        /**
         * 检测光标前的 `[[查询词` / `((查询词`。
         *
         * 与斜杠菜单分开实现：斜杠只在「行首」生效，而引用可以出现在句子中间
         * （「参见 [[xxx]]」）。两者同时打开会互相抢键盘，所以这里开启时先关斜杠。
         */
        updateRef() {
            const ed = this.editor;
            if (!ed || this.mode !== 'wysiwyg') return this.closeRef();
            const { $from, empty } = ed.state.selection;
            if (!empty) return this.closeRef();
            const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
            const mNote = /\[\[([^\]\n]*)$/.exec(before);
            const mBlock = /\(\(([^)\n]*)$/.exec(before);
            const mode = mNote ? 'note' : mBlock ? 'block' : '';
            if (!mode) return this.closeRef();
            this.closeSlash();
            const query = (mNote ? mNote[1] : mBlock[1]) || '';
            const coords = ed.view.coordsAtPos($from.pos);
            const style = { left: `${Math.round(coords.left)}px`, top: `${Math.round(coords.bottom + 6)}px` };
            this.ref = { ...this.ref, open: true, mode, query, style };
            // 输入即搜：300ms 防抖，避免每个字符打一次接口
            if (this._refTimer) clearTimeout(this._refTimer);
            this._refTimer = setTimeout(() => this.searchRef(), 220);
        },

        async searchRef() {
            const { mode, query } = this.ref;
            if (!mode) return;
            const kw = String(query || '').trim().toLowerCase();
            try {
                if (mode === 'note') {
                    const r = await fetchNotes({ search: String(query || '').trim(), pageSize: 8 });
                    const items = (r?.items || r?.list || [])
                        .filter((n) => n.id !== this.note?.id)
                        .map((n) => ({
                            id: n.id,
                            label: n.title || this.$t('memo.untitled'),
                            hint: n.excerpt || '',
                            insert: `[[note:${n.id}|${n.title || this.$t('memo.untitled')}]]`,
                        }));
                    this.ref = { ...this.ref, items, index: 0 };
                } else {
                    // 块搜索：只搜本篇（跨篇块搜索需要全库扫描，等反链面板做完再说）
                    const id = this.note?.id;
                    if (!id) return this.closeRef();
                    const r = await fetchNoteBlocks(id);
                    const items = (r?.blocks || [])
                        .filter((b) => (kw ? String(b.plainText || '').toLowerCase().includes(kw) : true))
                        .slice(0, 8)
                        .map((b) => ({
                            id: b.blockId,
                            label: b.plainText || b.blockType,
                            hint: b.blockType,
                            insert: `((${b.blockId}))`,
                        }));
                    this.ref = { ...this.ref, items, index: 0 };
                }
            } catch (e) {
                this.ref = { ...this.ref, items: [], index: 0 };
            }
        },

        applyRef(item) {
            const ed = this.editor;
            if (!ed || !item) return;
            this.closeRef();
            ed.chain().focus().insertContent(item.insert).run();
            this.onEditorUpdate();
        },

        // ---------------- 富文本事件 ----------------

        onEditorPaste(view, event) {
            const items = Array.from(event.clipboardData?.files || []);
            const img = items.find((f) => /^image\//i.test(f.type));
            if (!img) return false;
            event.preventDefault();
            this.uploadImage(img);
            return true;
        },

        onEditorDrop(view, event) {
            const files = Array.from(event.dataTransfer?.files || []);
            const img = files.find((f) => /^image\//i.test(f.type));
            if (!img) return false;
            event.preventDefault();
            this.uploadImage(img);
            return true;
        },

        /** 斜杠菜单 / 浮层的键盘交互：打开时必须先吃掉上下键与回车 */
        onEditorKeyDown(view, event) {
            // 引用面板优先：它是「输入中」状态，上下键必须归它
            if (this.ref.open) {
                const n = Math.max(1, this.ref.items.length);
                if (event.key === 'ArrowDown') {
                    this.ref = { ...this.ref, index: (this.ref.index + 1) % n };
                    return true;
                }
                if (event.key === 'ArrowUp') {
                    this.ref = { ...this.ref, index: (this.ref.index - 1 + n) % n };
                    return true;
                }
                if (event.key === 'Enter') {
                    const item = this.ref.items[this.ref.index];
                    if (item) {
                        this.applyRef(item);
                        return true;
                    }
                }
                if (event.key === 'Escape') {
                    this.closeRef();
                    return true;
                }
            }
            if (this.slash.open) {
                if (event.key === 'ArrowDown') {
                    this.slash.index = (this.slash.index + 1) % Math.max(1, this.slash.items.length);
                    return true;
                }
                if (event.key === 'ArrowUp') {
                    const n = Math.max(1, this.slash.items.length);
                    this.slash.index = (this.slash.index - 1 + n) % n;
                    return true;
                }
                if (event.key === 'Enter') {
                    const cmd = this.slash.items[this.slash.index];
                    if (cmd) {
                        this.applySlash(cmd);
                        return true;
                    }
                }
                if (event.key === 'Escape') {
                    this.closeSlash();
                    return true;
                }
            }
            return false;
        },

        /** 光标处若是「行首一个 / 加查询词」，就展开菜单 */
        updateSlash() {
            const ed = this.editor;
            if (!ed || this.mode !== 'wysiwyg') return this.closeSlash();
            const { state } = ed;
            const { $from, empty } = state.selection;
            if (!empty || $from.parent.type.name !== 'paragraph') return this.closeSlash();
            const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
            const m = /^\/([^\s/]*)$/.exec(textBefore);
            if (!m) return this.closeSlash();
            const query = m[1].toLowerCase();
            const items = SLASH_COMMANDS.filter((c) => !query || this.$t(c.label).toLowerCase().includes(query) || c.id.toLowerCase().includes(query));
            const coords = ed.view.coordsAtPos($from.pos);
            this.slash = {
                open: true,
                index: Math.min(this.slash.index, Math.max(0, items.length - 1)),
                items,
                from: $from.pos - (textBefore.length - 1),
                to: $from.pos,
                query,
                style: {
                    left: `${Math.round(coords.left)}px`,
                    top: `${Math.round(coords.bottom + 6)}px`,
                },
            };
        },

        closeSlash() {
            if (this.slash.open) this.slash = { ...this.slash, open: false, items: [], index: 0 };
        },

        async applySlash(cmd) {
            const ed = this.editor;
            if (!ed || !cmd) return;
            const { from, to } = this.slash;
            this.closeSlash();
            // 先删掉「/查询词」再执行命令 —— 否则命令会把斜杠当成正文留在块里
            ed.chain().focus().deleteRange({ from, to }).run();
            if (cmd.id === 'image') return this.openImagePicker();
            if (cmd.id === 'file' || cmd.id === 'video') {
                this.pickerVisible = true;
                return;
            }
            if (cmd.id === 'callout') return this.insertCallout();
            cmd.run(ed);
            this.onEditorUpdate();
        },

        /** 选中非空时在选区上方显示浮层；位置手算，不用 Tiptap 内置 BubbleMenu */
        onSelectionChange() {
            // 图片被选中时浮出缩放手柄；其它情况一律收起
            this.syncImgBox();
            const ed = this.editor;
            if (!ed || this.mode !== 'wysiwyg') {
                this.bubble.open = false;
                return;
            }
            const { state } = ed;
            const { from, to, empty } = state.selection;
            if (empty) {
                this.bubble.open = false;
                return;
            }
            const start = ed.view.coordsAtPos(from);
            const end = ed.view.coordsAtPos(to);
            const top = Math.min(start.top, end.top) - 46;
            const left = (start.left + end.right) / 2;
            this.bubble = {
                open: true,
                style: {
                    left: `${Math.round(left)}px`,
                    top: `${Math.max(8, Math.round(top))}px`,
                    transform: 'translateX(-50%)',
                },
            };
        },
    },
};
</script>

<style scoped>
.me-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--el-bg-color);
}

/* 标题 */
.me-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px 6px;
}
.me-title {
    flex: 1 1 auto;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 19px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    line-height: 1.4;
}
.me-title::placeholder {
    color: var(--el-text-color-placeholder);
    font-weight: 500;
}
.me-status {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.me-status-text.is-dirty {
    color: var(--el-color-warning);
}
.me-chars {
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
}

/* 工具栏 */
.me-toolbar-wrap {
    border-bottom: 1px solid var(--el-border-color-lighter);
    padding: 0 8px;
}
.me-toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 34px;
    /* 移动端横滑；桌面端放不下时同样可滑，不裁掉任何工具 */
    overflow-x: auto;
    scrollbar-width: none;
}
.me-toolbar::-webkit-scrollbar {
    display: none;
}
.me-btn {
    flex: 0 0 auto;
    width: 30px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    border-radius: 5px;
    color: var(--el-text-color-regular);
    font-size: 13px;
    cursor: pointer;
}
.me-btn:hover {
    background: var(--el-fill-color);
    color: var(--el-color-primary);
}
.me-btn.is-active {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
}
.me-hlabel {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
}
.me-sep {
    flex: 0 0 auto;
    width: 1px;
    height: 16px;
    margin: 0 5px;
    background: var(--el-border-color);
}
.me-grow {
    flex: 1 1 auto;
}

/* 编辑区 */
.me-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    position: relative;
}
.me-wysiwyg {
    height: 100%;
}
.me-source {
    height: 100%;
    overflow: auto;
}
.me-preview {
    min-height: 100%;
    padding: 12px 16px 60px;
    overflow-wrap: anywhere;
}

/* 浮层 */
.me-slash {
    position: fixed;
    z-index: 3000;
    width: 220px;
    max-height: 280px;
    overflow: auto;
    padding: 4px;
    border-radius: 8px;
    background: var(--el-bg-color-overlay);
    border: 1px solid var(--el-border-color-light);
    box-shadow: var(--el-box-shadow-light);
}
.me-slash-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 5px;
    font-size: 13px;
    cursor: pointer;
    color: var(--el-text-color-regular);
}
.me-slash-item.is-active {
    background: var(--el-fill-color-light);
    color: var(--el-color-primary);
}
.me-slash-icon {
    width: 14px;
    flex: 0 0 auto;
}
.me-slash-label {
    flex: 1 1 auto;
}
.me-slash-hint {
    font-size: 11px;
    opacity: 0.6;
    font-family: ui-monospace, monospace;
}
.me-slash-empty {
    padding: 12px;
    text-align: center;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.me-bubble {
    position: fixed;
    z-index: 3000;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 7px;
    background: var(--el-bg-color-overlay);
    border: 1px solid var(--el-border-color-light);
    box-shadow: var(--el-box-shadow-light);
}
.me-bub-btn {
    width: 28px;
    height: 26px;
    border: none;
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    color: var(--el-text-color-regular);
    font-size: 13px;
}
.me-bub-btn:hover,
.me-bub-btn.is-on {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
}

/* ============================================================
 *  内容排版（v1.3.1）
 *  ------------------------------------------------------------
 *  之前这里一条规则都没有：编辑区是浏览器默认样式，段落贴边、标题和正文一样大，
 *  看起来「没有排版」。整套样式只作用在编辑区与预览区内部，
 *  不改全站任何既有元素。
 * ============================================================ */

.me-wysiwyg :deep(.gh-editor-content),
.me-preview {
    /* 需求：编辑区内容一律左对齐，不居中、不两端对齐 */
    text-align: left;
    padding: 14px 18px 80px;
    min-height: 100%;
    font-size: 15px;
    line-height: 1.78;
    color: var(--el-text-color-primary);
    overflow-wrap: anywhere;
    outline: none;
}

.me-wysiwyg :deep(.gh-editor-content) > * + *,
.me-preview > * + * {
    margin-top: 0.7em;
}

/* 标题：字号/字重/间距全部走 CSS 变量，v1.4 的样式设置页直接改这些变量即可 */
.me-wysiwyg :deep(.gh-editor-content h1),
.me-preview :deep(h1) {
    font-size: var(--gh-h1-size, 1.75em);
    color: var(--gh-h1-color, inherit);
    font-weight: 700;
    line-height: 1.35;
    margin: 1.1em 0 0.5em;
}
.me-wysiwyg :deep(.gh-editor-content h2),
.me-preview :deep(h2) {
    font-size: var(--gh-h2-size, 1.45em);
    color: var(--gh-h2-color, inherit);
    font-weight: 700;
    line-height: 1.38;
    margin: 1em 0 0.45em;
}
.me-wysiwyg :deep(.gh-editor-content h3),
.me-preview :deep(h3) {
    font-size: var(--gh-h3-size, 1.24em);
    color: var(--gh-h3-color, inherit);
    font-weight: 600;
    margin: 0.9em 0 0.4em;
}
.me-wysiwyg :deep(.gh-editor-content h4),
.me-preview :deep(h4) {
    font-size: var(--gh-h4-size, 1.1em);
    color: var(--gh-h4-color, inherit);
    font-weight: 600;
    margin: 0.85em 0 0.35em;
}
.me-wysiwyg :deep(.gh-editor-content h5),
.me-preview :deep(h5) {
    font-size: var(--gh-h5-size, 1em);
    color: var(--gh-h5-color, inherit);
    font-weight: 600;
    margin: 0.8em 0 0.3em;
}
.me-wysiwyg :deep(.gh-editor-content h6),
.me-preview :deep(h6) {
    font-size: var(--gh-h6-size, 0.94em);
    color: var(--gh-h6-color, var(--el-text-color-secondary));
    font-weight: 600;
    margin: 0.8em 0 0.3em;
}

/* 列表：缩进与层级线（层级线用伪元素，不引第三方） */
.me-wysiwyg :deep(.gh-editor-content ul),
.me-wysiwyg :deep(.gh-editor-content ol),
.me-preview :deep(ul, ol) {
    padding-left: 1.55em;
    margin: 0.5em 0;
}
.me-wysiwyg :deep(.gh-editor-content li),
.me-preview :deep(li) {
    margin: 0.18em 0;
}
.me-wysiwyg :deep(.gh-editor-content li > p),
.me-preview :deep(li > p) {
    margin: 0;
}
/* 任务列表 */
.me-wysiwyg :deep(.gh-editor-content ul[data-type='taskList']),
.me-preview :deep(ul:has(input[type='checkbox'])) {
    list-style: none;
    padding-left: 0.2em;
}
.me-wysiwyg :deep(.gh-editor-content ul[data-type='taskList'] li),
.me-preview :deep(ul:has(input[type='checkbox']) li) {
    display: flex;
    align-items: flex-start;
    gap: 0.5em;
}
.me-wysiwyg :deep(.gh-editor-content ul[data-type='taskList'] li > label),
.me-preview :deep(ul:has(input[type='checkbox']) li) {
    flex: 0 0 auto;
    margin-top: 0.28em;
}

/* 引述 */
.me-wysiwyg :deep(.gh-editor-content blockquote),
.me-preview :deep(blockquote) {
    margin: 0.7em 0;
    padding: 0.35em 0 0.35em 0.95em;
    border-left: 3px solid var(--el-color-primary-light-5);
    color: var(--el-text-color-regular);
    background: var(--el-fill-color-lighter);
    border-radius: 0 4px 4px 0;
}

/* 行内代码 / 代码块 */
.me-wysiwyg :deep(.gh-editor-content code),
.me-preview :deep(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.92em;
    padding: 0.15em 0.35em;
    border-radius: 4px;
    background: var(--el-fill-color);
    color: var(--el-color-danger);
}
.me-wysiwyg :deep(.gh-editor-content pre),
.me-preview :deep(pre) {
    margin: 0.7em 0;
    padding: 12px 14px;
    border-radius: 8px;
    background: var(--el-fill-color-dark);
    overflow-x: auto;
    line-height: 1.6;
}
.me-wysiwyg :deep(.gh-editor-content pre code),
.me-preview :deep(pre code) {
    padding: 0;
    background: transparent;
    color: var(--el-text-color-primary);
    font-size: 0.9em;
}

/* 链接 */
.me-wysiwyg :deep(.gh-editor-content a),
.me-preview :deep(a) {
    color: var(--el-color-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
}

/* 分割线 */
.me-wysiwyg :deep(.gh-editor-content hr),
.me-preview :deep(hr) {
    margin: 1.4em 0;
    border: none;
    border-top: 1px solid var(--el-border-color);
}

/* 图片 */
.me-wysiwyg :deep(.gh-editor-content img),
.me-preview :deep(img) {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
    display: block;
}
/* 拖拽改过尺寸的图：宽度写在 style 上，这里只保证不溢出 */
.me-wysiwyg :deep(.gh-editor-content img.ProseMirror-selectednode) {
    outline: 2px solid var(--el-color-primary);
    outline-offset: 2px;
}

/* 表格 */
.me-wysiwyg :deep(.gh-editor-content table),
.me-preview :deep(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.7em 0;
    font-size: 0.96em;
    table-layout: fixed;
}
.me-wysiwyg :deep(.gh-editor-content th),
.me-wysiwyg :deep(.gh-editor-content td),
.me-preview :deep(th, td) {
    border: 1px solid var(--el-border-color);
    padding: 6px 9px;
    vertical-align: top;
    position: relative;
}
.me-wysiwyg :deep(.gh-editor-content th),
.me-preview :deep(th) {
    background: var(--el-fill-color-light);
    font-weight: 600;
}
/* 对齐（md 的 :---: 存在 align 属性上） */
.me-wysiwyg :deep(.gh-editor-content [align='center']),
.me-preview :deep([align='center']) {
    text-align: center;
}
.me-wysiwyg :deep(.gh-editor-content [align='right']),
.me-preview :deep([align='right']) {
    text-align: right;
}
/* 表格被选中时的提示色 */
.me-wysiwyg :deep(.gh-editor-content .selectedCell::after) {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--el-color-primary-light-9);
    opacity: 0.6;
    pointer-events: none;
}

/* 视频 / 音频 / 附件（v1.3.1 自定义节点） */
.me-wysiwyg :deep(.gh-editor-content .gh-video),
.me-preview :deep(.gh-video) {
    display: block;
    max-width: 100%;
    border-radius: 8px;
    margin: 0.7em 0;
    background: #000;
}
.me-wysiwyg :deep(.gh-editor-content .gh-audio),
.me-preview :deep(.gh-audio) {
    display: block;
    width: 100%;
    margin: 0.7em 0;
}
.me-wysiwyg :deep(.gh-editor-content .gh-file),
.me-preview :deep(.gh-file) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 7px;
    border: 1px solid var(--el-border-color-light);
    background: var(--el-fill-color-lighter);
    color: var(--el-text-color-primary);
    text-decoration: none;
    font-size: 0.95em;
    margin: 0.35em 0;
}
.me-wysiwyg :deep(.gh-editor-content .gh-file:hover) {
    border-color: var(--el-color-primary-light-5);
    color: var(--el-color-primary);
}

/* 提示块（callout）：四种类型只改左边框与底色 */
.me-wysiwyg :deep(.gh-editor-content .gh-callout),
.me-preview :deep(.gh-callout) {
    margin: 0.8em 0;
    padding: 10px 14px;
    border-radius: 8px;
    border-left: 3px solid var(--el-color-primary);
    background: var(--el-color-primary-light-9);
}
.me-wysiwyg :deep(.gh-editor-content .gh-callout > * + *),
.me-preview :deep(.gh-callout > * + *) {
    margin-top: 0.45em;
}
.me-wysiwyg :deep(.gh-editor-content .gh-callout-tip),
.me-preview :deep(.gh-callout-tip) {
    border-left-color: var(--el-color-success);
    background: var(--el-color-success-light-9);
}
.me-wysiwyg :deep(.gh-editor-content .gh-callout-warning),
.me-preview :deep(.gh-callout-warning) {
    border-left-color: var(--el-color-warning);
    background: var(--el-color-warning-light-9);
}
.me-wysiwyg :deep(.gh-editor-content .gh-callout-danger),
.me-preview :deep(.gh-callout-danger) {
    border-left-color: var(--el-color-danger);
    background: var(--el-color-danger-light-9);
}

/* 占位提示 */
.me-wysiwyg :deep(.ProseMirror p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
    color: var(--el-text-color-placeholder);
}

/* 标题折叠（装饰 class，由 foldPlugin 挂上来） */
.me-wysiwyg :deep(.gh-fold-hidden) {
    display: none !important;
}
.me-wysiwyg :deep(.gh-fold-title) {
    position: relative;
}
.me-wysiwyg :deep(.gh-fold-title)::after {
    content: '⋯';
    position: absolute;
    right: 0;
    top: 0.15em;
    font-size: 0.8em;
    color: var(--el-text-color-placeholder);
    letter-spacing: 1px;
}

/* 大纲浮窗 */
.me-outline-mask {
    position: fixed;
    inset: 0;
    z-index: 3100;
    background: rgba(0, 0, 0, 0.18);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 8vh;
}
.me-outline {
    width: min(520px, 88vw);
    max-height: 74vh;
    display: flex;
    flex-direction: column;
    background: var(--el-bg-color-overlay);
    border: 1px solid var(--el-border-color-light);
    border-radius: 10px;
    box-shadow: var(--el-box-shadow);
    overflow: hidden;
}
.me-outline-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px 8px 14px;
    border-bottom: 1px solid var(--el-border-color-lighter);
}
.me-outline-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
}
.me-outline-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 6px;
}
.me-outline-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: transparent;
    border-radius: 5px;
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    color: var(--el-text-color-regular);
}
.me-outline-item:hover {
    background: var(--el-fill-color-light);
    color: var(--el-color-primary);
}
.me-outline-tag {
    flex: 0 0 auto;
    font-size: 10px;
    font-family: ui-monospace, monospace;
    opacity: 0.55;
}
.me-outline-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 引用搜索面板（复用 me-slash 的容器样式） */
.me-ref {
    width: 280px;
    max-height: 320px;
}
.me-ref-head {
    padding: 6px 8px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.4px;
    color: var(--el-text-color-secondary);
}
.me-ref-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ============================================================
   引用类行内原子（v1.5.0）
   ============================================================ */
.me-wysiwyg :deep(.gh-noteref),
.me-wysiwyg :deep(.gh-noteembed),
.me-wysiwyg :deep(.gh-blockref) {
    display: inline;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 0.94em;
    line-height: 1.5;
    cursor: pointer;
    white-space: nowrap;
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    border: 1px solid var(--el-color-primary-light-7);
}
.me-wysiwyg :deep(.gh-noteref:hover),
.me-wysiwyg :deep(.gh-noteembed:hover),
.me-wysiwyg :deep(.gh-blockref:hover) {
    background: var(--el-color-primary-light-8);
}
.me-wysiwyg :deep(.gh-noteembed) {
    background: var(--el-color-warning-light-9);
    color: var(--el-color-warning-dark-2);
    border-color: var(--el-color-warning-light-7);
}
.me-wysiwyg :deep(.gh-blockref) {
    font-family: ui-monospace, monospace;
    font-size: 0.9em;
}
/* 引用原子被选中时给个明确的框，否则 atom 选中态几乎看不见 */
.me-wysiwyg :deep(.ProseMirror-selectednode.gh-noteref),
.me-wysiwyg :deep(.ProseMirror-selectednode.gh-noteembed),
.me-wysiwyg :deep(.ProseMirror-selectednode.gh-blockref) {
    outline: 2px solid var(--el-color-primary-light-5);
    outline-offset: 1px;
}

/* ============================================================
   图片缩放手柄（v1.4.0）
   ============================================================ */
.me-imgbox {
    position: absolute;
    pointer-events: none;
    outline: 2px solid var(--el-color-primary-light-5);
    outline-offset: 0;
    border-radius: 2px;
    z-index: 6;
}
.me-imghandle {
    position: absolute;
    width: 10px;
    height: 10px;
    background: var(--el-bg-color);
    border: 2px solid var(--el-color-primary);
    border-radius: 2px;
    pointer-events: auto;
    box-sizing: border-box;
}
.me-imghandle.is-nw { left: -5px; top: -5px; cursor: nwse-resize; }
.me-imghandle.is-n  { left: 50%; top: -5px; margin-left: -5px; cursor: ns-resize; }
.me-imghandle.is-ne { right: -5px; top: -5px; cursor: nesw-resize; }
.me-imghandle.is-e  { right: -5px; top: 50%; margin-top: -5px; cursor: ew-resize; }
.me-imghandle.is-se { right: -5px; bottom: -5px; cursor: nwse-resize; }
.me-imghandle.is-s  { left: 50%; bottom: -5px; margin-left: -5px; cursor: ns-resize; }
.me-imghandle.is-sw { left: -5px; bottom: -5px; cursor: nesw-resize; }
.me-imghandle.is-w  { left: -5px; top: 50%; margin-top: -5px; cursor: ew-resize; }
/* 触屏上 10px 抓不住，放大可点区域但不改变视觉大小 */
@media (hover: none) {
    .me-imghandle::after {
        content: '';
        position: absolute;
        inset: -8px;
    }
}
.me-imgsize {
    position: absolute;
    left: 50%;
    bottom: -26px;
    transform: translateX(-50%);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-family: ui-monospace, monospace;
    white-space: nowrap;
    color: var(--el-color-white);
    background: rgba(0, 0, 0, 0.62);
    pointer-events: none;
}

/* ============================================================
   反向链接面板（v1.5.0）
   ============================================================ */
.me-backlinks {
    flex: 0 0 auto;
    border-top: 1px solid var(--el-border-color-lighter);
    background: var(--el-fill-color-blank);
}
.me-bl-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    border: 0;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 12px;
    cursor: pointer;
}
.me-bl-head:hover {
    background: var(--el-fill-color-light);
}
.me-bl-icon {
    font-size: 11px;
    opacity: 0.7;
}
.me-bl-title {
    font-weight: 600;
}
.me-bl-count {
    min-width: 16px;
    padding: 0 5px;
    border-radius: 8px;
    font-size: 11px;
    text-align: center;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
}
.me-bl-caret {
    margin-left: auto;
    font-size: 11px;
    opacity: 0.6;
}
.me-bl-list {
    max-height: 168px;
    overflow: auto;
    padding: 0 6px 6px;
}
.me-bl-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    padding: 5px 6px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    text-align: left;
    font-size: 12px;
    color: var(--el-text-color-regular);
    cursor: pointer;
}
.me-bl-item:hover {
    background: var(--el-fill-color-light);
    color: var(--el-color-primary);
}
.me-bl-name {
    flex: 0 1 auto;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
}
.me-bl-tag {
    flex: 0 0 auto;
    padding: 0 4px;
    border-radius: 3px;
    font-size: 10px;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
}
.me-bl-excerpt {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--el-text-color-secondary);
}
.me-bl-empty {
    padding: 6px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
</style>
