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
    <div class="me-root" :class="[`theme-${editorTheme}`, { 'is-float-open': anyFloatOpen }]" :style="styleVars">
        <!--
            v1.3.1.2（需求：滚动吸附可配置）
            工具栏、标题栏、辅助栏（版本/时间/字数那一行）都挪进滚动容器 `.me-body`，
            每一块各自按设置决定 position: sticky 还是普通跟随滚动。
            默认全部不吸附 —— 与需求「默认为关闭状态」一致。
        -->
        <div ref="bodyEl" class="me-body" @contextmenu="onContextMenu" @click="onBodyClick" @scroll.passive="onBodyScroll">
            <!-- 工具栏：按设置里的行配置渲染，`|` 生成分隔线 -->
            <div
                ref="toolbarWrap"
                class="me-toolbar-wrap"
                :class="{ 'is-sticky': isStickyNow('toolbar') }"
                :style="{ top: stickyTop('toolbar') }"
            >
                <div v-for="(line, li) in toolbarLines" :key="`tl-${li}`" class="me-toolbar">
                    <template v-for="(token, ti) in line" :key="`${li}-${ti}`">
                        <span
                            v-if="token === '|'"
                            class="me-sep"
                            :data-ti="ti"
                            :class="{ 'is-tb-hidden': isTbHidden(li, ti) }"
                        ></span>
                        <!--
                            工具组：配置里写 `[组名 bold italic]` 时，这一整组渲染成一个下拉按钮，
                            点开才是组内工具。v1.3.1.2 起组名可自定义（第一个词是组名）。
                        -->
                        <el-dropdown
                            v-else-if="isGroupToken(token)"
                            :trigger="isTouchUi ? 'click' : 'hover'"
                            :show-timeout="80"
                            :hide-timeout="120"
                            placement="bottom-start"
                            popper-class="me-tb-popper"
                            @command="(cmd) => runTool(cmd)"
                        >
                            <button
                                type="button"
                                class="me-btn me-btn-group"
                                :title="groupLabel(token)"
                                :data-ti="ti"
                                :class="{ 'is-tb-hidden': isTbHidden(li, ti) }"
                                @mousedown.prevent
                            >
                                <span class="me-group-name">{{ groupLabel(token) }}</span>
                                <font-awesome-icon icon="caret-down" class="me-group-caret" />
                            </button>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item v-for="g in groupTools(token)" :key="`g-${li}-${ti}-${g}`" :command="g">
                                        <font-awesome-icon v-if="toolsOf(g) && toolsOf(g).icon" :icon="toolsOf(g).icon" class="me-group-icon" />
                                        <span class="me-group-label">{{ toolsOf(g) ? $t(toolsOf(g).label) : g }}</span>
                                    </el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>
                        <!-- v1.3.4：字号 / 颜色 / 列表转换在工具栏里是「按钮 + 下拉」 -->
                        <el-dropdown
                            v-else-if="toolDropdown(token)"
                            :trigger="isTouchUi ? 'click' : 'hover'"
                            :show-timeout="60"
                            :hide-timeout="140"
                            placement="bottom-start"
                            popper-class="me-tb-popper"
                            @command="(c) => runDropdownTool(token, c)"
                        >
                            <button
                                type="button"
                                class="me-btn me-btn-dd"
                                :data-ti="ti"
                                :class="{ 'is-tb-hidden': isTbHidden(li, ti) }"
                                :title="$t(toolsOf(token) ? toolsOf(token).label : token)"
                                @mousedown.prevent
                            >
                                <font-awesome-icon v-if="toolsOf(token) && toolsOf(token).icon" :icon="toolsOf(token).icon" />
                                <font-awesome-icon icon="caret-down" class="me-dd-caret" />
                            </button>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item
                                        v-for="d in toolDropdown(token).items"
                                        :key="`dd-${d.command}`"
                                        :command="d.command"
                                        :divided="!!d.divided"
                                        :class="{ 'is-active': token === 'listConvert' && d.command === currentListType() }"
                                    >
                                        <span v-if="d.dot" class="me-color-dot" :class="`is-${d.dot}`"></span>{{ $t(d.label) }}
                                    </el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>
                        <button
                            v-else-if="toolsOf(token)"
                            type="button"
                            class="me-btn"
                            :data-ti="ti"
                            :class="{
                                'is-active': toolsOf(token).active ? toolsOf(token).active(editor) : false,
                                'is-tb-hidden': isTbHidden(li, ti),
                            }"
                            :title="token === 'foldAll' && foldAllActive ? $t('memo.toolUnfoldAll') : $t(toolsOf(token).label)"
                            @mousedown.prevent
                            @click="runTool(token, $event)"
                        >
                            <span v-if="token.startsWith('h') && /^h[1-6]$/.test(token)" class="me-hlabel">{{ token.toUpperCase() }}</span>
                            <span v-else-if="token === 'undo'" class="me-svg-icon" v-html="svgUndo"></span>
                            <span v-else-if="token === 'redo'" class="me-svg-icon" v-html="svgRedo"></span>
                            <span v-else-if="toolsOf(token).svgKey" class="me-svg-icon" v-html="svgOf(token)"></span>
                            <span v-else-if="toolsOf(token).glyph" class="me-glyph-tool">{{ toolsOf(token).glyph }}</span>
                            <!-- v1.3.3.3（需求）：折叠全部后按钮变成「展开全部」（向下箭头） -->
                            <font-awesome-icon
                                v-else-if="token === 'foldAll'"
                                :icon="foldAllActive ? 'angles-down' : 'angles-up'"
                            />
                            <font-awesome-icon v-else-if="toolsOf(token).icon" :icon="toolsOf(token).icon" />
                        </button>
                    </template>
                    <!--
                        v1.3.2（需求）：桌面端工具放不下时，在行末固定一个下拉箭头，
                        点开就是被挤出可视区的那些工具（移动端仍然横滑，不折叠）。
                    -->
                    <el-dropdown
                        v-if="toolbarOverflowTools[li] && toolbarOverflowTools[li].length"
                        :trigger="isTouchUi ? 'click' : 'hover'"
                        :show-timeout="60"
                        :hide-timeout="120"
                        placement="bottom-end"
                        class="me-toolbar-more"
                        popper-class="me-tb-popper"
                        @command="(cmd) => runTool(cmd)"
                    >
                        <button type="button" class="me-btn" :title="$t('memo.toolbarMore')" @mousedown.prevent>
                            <font-awesome-icon icon="caret-down" />
                            <span class="me-more-count">{{ toolbarOverflowTools[li].length }}</span>
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item v-for="g in toolbarOverflowTools[li]" :key="`ov-${li}-${g}`" :command="g">
                                    <font-awesome-icon v-if="toolsOf(g) && toolsOf(g).icon" :icon="toolsOf(g).icon" class="me-group-icon" />
                                    <span class="me-group-label">{{ toolsOf(g) ? $t(toolsOf(g).label) : g }}</span>
                                </el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                    <!-- 每行末尾都跟一组固定的「视图 / 保存」，它不属于可配置工具 -->
                    <span class="me-grow"></span>
                    <template v-if="li === toolbarLines.length - 1">
                        <!--
                            v1.3.4（需求）：移动端把「编辑/源码/预览」钉在行末，横滑时不动。
                            sticky 在横向滚动容器里就是干这个的：正常位置在末尾，
                            滑到左边时它仍贴在可视区右边缘。保存按钮已移到顶部栏。
                        -->
                        <span class="me-mode-tail">
                        <!-- v1.3.2（需求）：三个模式按钮合并成一个文字下拉框 -->
                        <!-- v1.3.3.3（需求）：鼠标移到按钮上就展开下拉 -->
                        <el-dropdown
                            :trigger="isTouchUi ? 'click' : 'hover'"
                            :show-timeout="60"
                            :hide-timeout="120"
                            placement="bottom-end"
                            popper-class="me-tb-popper"
                            @command="setMode"
                        >
                            <button type="button" class="me-btn me-mode-btn" :title="$t('memo.modeLabel')" @mousedown.prevent>
                                <span class="me-mode-text">{{ modeLabel }}</span>
                                <font-awesome-icon icon="caret-down" class="me-mode-caret" />
                            </button>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item command="wysiwyg" :class="{ 'is-active': mode === 'wysiwyg' }">{{ $t('memo.modeLive') }}</el-dropdown-item>
                                    <el-dropdown-item command="source" :class="{ 'is-active': mode === 'source' }">{{ $t('memo.modeSource') }}</el-dropdown-item>
                                    <el-dropdown-item command="preview" :class="{ 'is-active': mode === 'preview' }">{{ $t('memo.modePreview') }}</el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>
                        </span>
                    </template>
                </div>
            </div>

            <!-- 标题行 / 元信息行 / 标签行：三块各自独立决定是否吸附 -->
            <div class="me-head">
                <div
                    class="me-title-row"
                    :class="{ 'is-sticky': isStickyNow('title') }"
                    :style="{ top: stickyTop('title') }"
                >
                    <input
                        v-model="title"
                        class="me-title"
                        :placeholder="$t('memo.untitled')"
                        maxlength="200"
                        @input="onTitleInput"
                    />
                    <!--
                        v1.3.3.3（需求）：标题行最右侧固定一个「返回顶部」按钮。
                        用固定定位外的 flex 末位 + margin-left:auto 实现「固定在最靠右」，
                        不随工具栏折行或标题长短漂移。
                    -->
                    <button
                        type="button"
                        class="me-title-top"
                        :title="$t('memo.backTop')"
                        @mousedown.prevent
                        @click="scrollBodyToTop"
                    >
                        <font-awesome-icon icon="arrow-up" />
                    </button>
                </div>
                <!-- v1.3.3.2：辅助栏不再参与吸附（需求已移除该开关），保持普通跟随滚动 -->
                <div class="me-meta">
                    <button type="button" class="me-meta-btn" :title="$t('memo.historyOpen')" @click="openHistory">
                        <font-awesome-icon icon="history" class="me-meta-icon" />
                        {{ $t('memo.versionNo', { n: version || 1 }) }}
                    </button>
                    <span class="me-meta-item">
                        <font-awesome-icon icon="clock" class="me-meta-icon" />
                        {{ updatedText }}
                    </span>
                    <!--
                        v1.3.4.1（需求）：字数 / 字符按新口径统计。
                        「字数」= 汉字 + 字母；「字符」= 总字符数（所有字符都统计）。
                    -->
                    <span class="me-meta-item">{{ $t('memo.wordCount', { n: wordCount }) }}</span>
                    <span class="me-meta-item">{{ $t('memo.charCountAll', { n: charCount }) }}</span>
                    <span class="me-status">
                        <span v-if="saving" class="me-status-text">{{ $t('memo.saving') }}</span>
                        <span v-else-if="dirty" class="me-status-text is-dirty">{{ $t('memo.unsaved') }}</span>
                        <span v-else class="me-status-text">{{ $t('memo.saved') }}</span>
                    </span>
                </div>
                <!-- 标签行：交互与瞬间发布页一致（输入即查候选，空格 / 回车成标签） -->
                <div class="me-tags">
                    <span v-for="(t, i) in tags" :key="`tg-${t.name}-${i}`" class="me-tag">
                        {{ t.name }}
                        <button type="button" class="me-tag-x" @click="removeTag(i)">
                            <font-awesome-icon icon="times" />
                        </button>
                    </span>
                    <input
                        v-model="tagInput"
                        class="me-tag-input"
                        :placeholder="tags.length ? '' : $t('memo.tagPlaceholder')"
                        @keydown.enter.prevent="commitTag"
                        @keydown.space.prevent="commitTag"
                        @keydown.delete="onTagBackspace"
                        @input="onTagInput"
                        @focus="loadTagCandidates"
                        @blur="onTagBlur"
                    />
                    <div v-if="tagCandidates.length" class="me-tag-suggest">
                        <button
                            v-for="c in tagCandidates"
                            :key="`tc-${c.id}`"
                            type="button"
                            class="me-tag-sug-item"
                            @mousedown.prevent="pickTag(c.name)"
                        >{{ c.name }}</button>
                    </div>
                </div>
            </div>

            <!--
                v1.3.3.2（需求）：左侧行号栏改成「按块矩形算坐标」的覆盖层。
                ------------------------------------------------------------------
                原来每个块前面插一个零宽 widget（Decoration.widget），由 ProseMirror
                跟着文档走。它对段落很好用，但遇到块级原子节点（图片 / 视频 / 文件 /
                分割线 / 表格）就会「站到块的上一行」—— widget 落在了节点边界上，
                渲染位置在块之前，视觉上就是「图片其实是第 3 行，行号 3 却浮在它上方」。
                现在统一改成：遍历顶层块 → 取每块自己 DOM 的矩形 → 用 top 绝对定位。
                段落按首行居中，原子块贴块顶，**永远正对**，也不再有 widget 的边界问题。
            -->
            <div v-if="gutterRows.length" class="me-gutter-layer" aria-hidden="true">
                <div
                    v-for="row in gutterRows"
                    :key="`gut-${row.pos}`"
                    class="me-gutter-row"
                    :class="{ 'is-heading': row.level > 0 }"
                    :data-pos="row.pos"
                    :data-no="row.no"
                    :style="{ top: `${row.top}px` }"
                >
                    <!--
                        v1.3.4.1（需求：行号始终在行级栏第二列）
                        没有折叠按钮的行也要保留第一列的占位（视觉上隐藏），
                        否则行号会滑到第一列，整列数字左右错落。
                    -->
                    <button
                        type="button"
                        class="me-gutter-fold"
                        :class="{ 'is-folded': row.folded, 'is-hidden': !row.foldable }"
                        :title="row.folded ? $t('memo.unfoldTitle') : $t('memo.foldTitle')"
                        @mousedown.prevent
                        @click.stop="row.foldable && toggleFoldAt(row.pos)"
                    >
                        <font-awesome-icon :icon="row.folded ? 'caret-right' : 'caret-down'" />
                    </button>
                    <button
                        type="button"
                        class="me-gutter-no"
                        :title="$t('memo.gutterMenu')"
                        @mousedown.prevent
                        @click.stop="openGutter(row.pos, row.type, $event.currentTarget)"
                    >{{ row.no }}</button>
                </div>
                <!--
                    v1.3.4（需求）：任意层级的列表项都能折叠自己的下级。
                    按钮落在该项「符号」的位置上（普通列表 = 圆点中心，任务列表 = 勾选框中心），
                    平时透明，鼠标移到符号上才出现 —— 不干扰正文阅读。
                -->
                <div
                    v-for="row in listFoldRows"
                    :key="`lf-${row.key}`"
                    class="me-listfold-row"
                    :class="{ 'is-folded': row.folded }"
                    :style="{ left: `${row.left}px`, top: `${row.top}px` }"
                >
                    <button
                        type="button"
                        class="me-listfold-btn"
                        :title="row.folded ? $t('memo.unfoldTitle') : $t('memo.listFold')"
                        @mousedown.prevent
                        @click.stop="toggleListFold(row.key)"
                    >
                        <font-awesome-icon :icon="row.folded ? 'caret-right' : 'caret-down'" />
                    </button>
                </div>
            </div>

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
        <div class="me-backlinks" :class="{ 'is-open': backlinksOpen, 'is-kb-hidden': kbOpen }">
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
        <!--
            v1.3.1.1（需求）：上传按钮不再限图片，也不直接上传 ——
            选完文件先弹「上传到图床」面板（选渠道 / 实例 / 目录），确认后才真正上传。
        -->
        <input ref="anyFileInput" type="file" multiple hidden @change="onAnyFileChange" />

        <UploadTargetDialog
            v-model="uploadTargetVisible"
            :busy="uploadBusy"
            :prefill="uploadPrefill"
            :title="$t('memo.uploadToBed')"
            :hint="$t('memo.uploadHint', { n: pendingUploadFiles.length })"
            @confirm="confirmUploadTarget"
        />

        <!-- 斜杠菜单 -->
        <Teleport to="body">
            <div v-if="slash.open" ref="slashEl" class="me-slash" :style="slash.style" @mousedown.prevent>
                <template v-for="(cmd, i) in slash.items" :key="cmd.id">
                    <div v-if="cmd.separator" class="me-slash-sep"></div>
                    <!--
                        v1.3.2（需求）：`/` 菜单支持 [组名 a b] 工具组 ——
                        鼠标移上去在右侧展开二级菜单，点组名本身不执行任何命令。
                        v1.3.3.2（实测修复：二级菜单怎么都打不开）
                        它原来绝对定位在 .me-slash-item 里，而 .me-slash 有
                        overflow: auto —— 超出父级的二级菜单被整块裁掉，
                        看起来就是「移上去 / 点一下都没反应」。
                        现在二级菜单 Teleport 到 body、position: fixed，
                        位置按组名那一行的矩形实时算，右侧放不下就翻到左侧。
                    -->
                    <div
                        v-else-if="cmd.group"
                        class="me-slash-item me-slash-group"
                        :class="{ 'is-active': i === slash.index }"
                        @mouseenter="onSlashGroupHover(i, cmd, $event)"
                        @click="onSlashGroupHover(i, cmd, $event)"
                    >
                        <font-awesome-icon icon="folder" class="me-slash-icon" />
                        <span class="me-slash-label">{{ cmd.label }}</span>
                        <font-awesome-icon icon="caret-right" class="me-slash-caret" />
                    </div>
                    <div
                        v-else
                        class="me-slash-item"
                        :class="{ 'is-active': i === slash.index }"
                        @mouseenter="slash.index = i; slash.sub = null"
                        @click="applySlash(cmd)"
                    >
                    <span v-if="cmd.svgKey" class="me-svg-icon me-slash-icon" v-html="svgOf(cmd.id)"></span>
                    <span v-else-if="cmd.glyph" class="me-glyph-tool me-slash-icon">{{ cmd.glyph }}</span>
                    <font-awesome-icon v-else :icon="cmd.icon" class="me-slash-icon" />
                    <span class="me-slash-label">{{ $t(cmd.label) }}</span>
                        <span class="me-slash-hint">{{ cmd.hint }}</span>
                    </div>
                </template>
                <div v-if="!slash.items.length" class="me-slash-empty">{{ $t('memo.slashEmpty') }}</div>
            </div>
        </Teleport>

        <!-- `/` 菜单的工具组二级菜单（v1.3.3.2：独立浮层，不受父级 overflow 裁切） -->
        <Teleport to="body">
            <div
                v-if="slash.open && slash.sub && slash.sub.items.length"
                class="me-slash-sub"
                :style="slash.subStyle"
                @mousedown.prevent
            >
                <div
                    v-for="c in slash.sub.items"
                    :key="'sub-' + c.id"
                    class="me-slash-item"
                    @click.stop="applySlash(c)"
                >
                    <span v-if="c.svgKey" class="me-svg-icon me-slash-icon" v-html="svgOf(c.id)"></span>
                    <span v-else-if="c.glyph" class="me-glyph-tool me-slash-icon">{{ c.glyph }}</span>
                    <font-awesome-icon v-else-if="c.icon" :icon="c.icon" class="me-slash-icon" />
                    <span class="me-slash-label">{{ $t(c.label) }}</span>
                    <span class="me-slash-hint">{{ c.hint }}</span>
                </div>
            </div>
        </Teleport>

        <!-- 引用搜索：`[[` 搜文档，`((` 搜块（块引用为两级菜单） -->
        <Teleport to="body">
            <div v-if="ref.open" class="me-slash me-ref" :style="ref.style" @mousedown.prevent>
                <div class="me-ref-head">
                    <!-- v1.3.4.1：块引用二级页可以返回一级 -->
                    <button
                        v-if="ref.mode === 'block' && ref.level === 'blocks'"
                        type="button"
                        class="me-ref-back"
                        :title="$t('memo.refBack')"
                        @click.stop="refBackToNotes"
                    >‹</button>
                    <span class="me-ref-head-text">{{ refHeadText }}</span>
                </div>
                <div class="me-ref-list">
                    <div
                        v-for="(it, i) in ref.items"
                        :key="`rf-${it.id}-${i}`"
                        class="me-slash-item"
                        :class="{ 'is-active': i === ref.index }"
                        @mouseenter="ref.index = i"
                        @click="applyRef(it)"
                    >
                        <span class="me-ref-label">{{ it.label }}</span>
                        <span class="me-slash-hint">{{ it.hint }}</span>
                        <font-awesome-icon
                            v-if="ref.mode === 'block' && ref.level === 'notes'"
                            icon="caret-right"
                            class="me-ref-caret"
                        />
                    </div>
                    <div v-if="ref.loading" class="me-slash-empty">{{ $t('memo.hoverLoading') }}</div>
                    <div v-else-if="!ref.items.length" class="me-slash-empty">{{ $t('memo.refEmpty') }}</div>
                </div>
            </div>
        </Teleport>

        <!-- 选中浮层 -->
        <Teleport to="body">
            <!--
                v1.3.1.2（需求）：选中文本时的浮层，按飞书那套顺序排 ——
                标题▾ / 对齐▾ | 加粗 删除线 斜体 下划线 链接 行代码 | 字号▾ 颜色▾ | 批注 发布到瞬间。
            -->
            <!--
                v1.3.3（需求）：选中浮层也改成配置驱动。
                「设置 → 选中文本工具配置」里填什么就渲染什么，没填用内置默认。
                标题 / 对齐 / 字号 / 颜色是复合控件，用保留名 heading / align / fontSize / textColor 表示。
            -->
            <div v-if="bubble.open" ref="bubbleEl" class="me-bubble" :style="bubble.style" @mousedown.prevent>
                <template v-for="(it, i) in selItems" :key="`sel-${i}`">
                    <span v-if="it.sep" class="me-bub-sep"></span>
                    <!--
                        v1.3.4（需求：选中文本工具组加载不出来）
                        `[组名 bold italic]` 先被整体解析成一个 group 项，再在这里渲染成下拉；
                        桌面端 hover 即展开（Element Plus 的 trigger=hover），移动端点击展开。
                    -->
                    <el-dropdown
                        v-else-if="it.group"
                        :trigger="isTouchUi ? 'click' : 'hover'"
                        :show-timeout="60"
                        :hide-timeout="140"
                        placement="top-start"
                        @command="(c) => runTool(c)"
                    >
                        <button type="button" class="me-bub-btn me-bub-dd" :title="it.name">
                            <span class="me-bub-group">{{ it.name }}</span>
                            <font-awesome-icon icon="caret-down" class="me-bub-caret" />
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item v-for="g in it.items" :key="`selg-${g}`" :command="g">
                                    <font-awesome-icon v-if="toolsOf(g) && toolsOf(g).icon" :icon="toolsOf(g).icon" class="me-group-icon" />
                                    <span class="me-group-label">{{ toolsOf(g) ? $t(toolsOf(g).label) : g }}</span>
                                </el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                    <el-dropdown v-else-if="it.id === 'heading'" :trigger="isTouchUi ? 'click' : 'hover'" :show-timeout="60" :hide-timeout="140" placement="top-start" @command="(c) => runTool(c)">
                        <button type="button" class="me-bub-btn me-bub-dd" :title="$t('memo.bubHeading')">
                            <span class="me-bub-head">H</span>
                            <font-awesome-icon icon="caret-down" class="me-bub-caret" />
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item command="h1">H1</el-dropdown-item>
                                <el-dropdown-item command="h2">H2</el-dropdown-item>
                                <el-dropdown-item command="h3">H3</el-dropdown-item>
                                <el-dropdown-item command="h4">H4</el-dropdown-item>
                                <el-dropdown-item command="h5">H5</el-dropdown-item>
                                <el-dropdown-item command="h6">H6</el-dropdown-item>
                                <el-dropdown-item command="paragraph" divided>{{ $t('memo.bubParagraph') }}</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                    <el-dropdown v-else-if="it.id === 'align'" :trigger="isTouchUi ? 'click' : 'hover'" :show-timeout="60" :hide-timeout="140" placement="top-start" @command="(c) => runTool(c)">
                        <button type="button" class="me-bub-btn me-bub-dd" :title="$t('memo.bubAlign')">
                            <font-awesome-icon icon="align-left" />
                            <font-awesome-icon icon="caret-down" class="me-bub-caret" />
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item command="alignLeft">{{ $t('memo.toolAlignLeft') }}</el-dropdown-item>
                                <el-dropdown-item command="alignCenter">{{ $t('memo.toolAlignCenter') }}</el-dropdown-item>
                                <el-dropdown-item command="alignRight">{{ $t('memo.toolAlignRight') }}</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                    <el-dropdown v-else-if="it.id === 'fontSize'" :trigger="isTouchUi ? 'click' : 'hover'" :show-timeout="60" :hide-timeout="140" placement="top-start" @command="setFontSize">
                        <button type="button" class="me-bub-btn me-bub-dd" :title="$t('memo.bubFontSize')">
                            <span class="me-bub-font">A</span>
                            <font-awesome-icon icon="caret-down" class="me-bub-caret" />
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item command="s">{{ $t('memo.fontSmall') }}</el-dropdown-item>
                                <el-dropdown-item command="m">{{ $t('memo.fontNormal') }}</el-dropdown-item>
                                <el-dropdown-item command="l">{{ $t('memo.fontLarge') }}</el-dropdown-item>
                                <el-dropdown-item command="clear" divided>{{ $t('memo.fontDefault') }}</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                    <el-dropdown v-else-if="it.id === 'textColor'" :trigger="isTouchUi ? 'click' : 'hover'" :show-timeout="60" :hide-timeout="140" placement="top-start" @command="setTextColor">
                        <button type="button" class="me-bub-btn me-bub-dd" :title="$t('memo.bubColor')">
                            <!-- v1.3.3.3（需求：颜色按钮没有图标）—— 一个带色条的 A，一眼看出是文字颜色 -->
                            <span class="me-bub-color-a">A</span>
                            <span class="me-bub-color-preview"></span>
                            <font-awesome-icon icon="caret-down" class="me-bub-caret" />
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item v-for="c in TEXT_COLORS" :key="`c-${c}`" :command="c">
                                    <span class="me-color-dot" :class="`is-${c}`"></span>{{ $t(`memo.color_${c}`) }}
                                </el-dropdown-item>
                                <el-dropdown-item command="clear" divided>{{ $t('memo.colorClear') }}</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                    <button
                        v-else-if="it.id === 'publish'"
                        type="button"
                        class="me-bub-btn"
                        :title="$t('memo.publishToMoment')"
                        @click="publishSelectionToMoment"
                    >
                        <font-awesome-icon icon="paper-plane" />
                    </button>
                    <button
                        v-else
                        type="button"
                        class="me-bub-btn"
                        :class="{ 'is-on': isToolActive(it.id) }"
                        :title="it.label ? $t(it.label) : it.id"
                        @click="runTool(it.id)"
                    >
                        <span v-if="bubLetter(it.id)" class="me-bub-letter">{{ bubLetter(it.id) }}</span>
                        <span v-else-if="it.svgKey" class="me-svg-icon" v-html="svgOf(it.id)"></span>
                        <span v-else-if="it.glyph" class="me-glyph-tool">{{ it.glyph }}</span>
                        <font-awesome-icon v-else-if="it.icon" :icon="it.icon" />
                        <span v-else>{{ it.id }}</span>
                    </button>
                </template>
            </div>

            <!--
                v1.3.3（需求）：选中图片 / 视频 / 音频 / 附件时的工具带。
                工具来自「设置 → 选中图片/视频/音频/文件工具配置」，未配置用内置默认。
            -->
            <div v-if="mediaBar.open" class="me-bubble me-mediabar" :style="mediaBar.style" @mousedown.prevent>
                <template v-for="(it, i) in mediaTools" :key="`mb-${i}`">
                    <span v-if="it.sep" class="me-bub-sep"></span>
                    <!-- v1.3.4.1：宽度 / 高度快捷设置下拉 -->
                    <el-dropdown
                        v-else-if="it.dropdown"
                        :trigger="isTouchUi ? 'click' : 'hover'"
                        :show-timeout="60"
                        :hide-timeout="140"
                        placement="top-start"
                        @command="(p) => setMediaSizePercent(it.id === 'sizeHeight' ? 'h' : 'w', p)"
                    >
                        <button type="button" class="me-bub-btn" :title="it.label ? $t(it.label) : it.id">
                            <font-awesome-icon :icon="it.icon" />
                            <font-awesome-icon icon="caret-down" class="me-bub-caret" />
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item v-for="p in it.dropdown" :key="`sz-${p}`" :command="p">{{ p }}%</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                    <button
                        v-else
                        type="button"
                        class="me-bub-btn"
                        :title="it.label ? $t(it.label) : it.id"
                        @click="runTool(it.id)"
                    >
                        <font-awesome-icon :icon="it.icon" />
                    </button>
                </template>
            </div>

            <!-- 引用悬停预览（v1.3.1.2） -->
            <div v-if="hoverCard.open" class="me-hovercard" :class="{ 'is-above': hoverCard.above, 'is-below': !hoverCard.above }" :style="{ left: `${hoverCard.x}px`, top: `${hoverCard.y}px` }">
                <!-- v1.3.4.1（需求）：卡片带箭头，指回被悬停的引用名称块 -->
                <span class="me-hovercard-arrow" aria-hidden="true"></span>
                <div class="me-hovercard-title">{{ hoverCard.title }}</div>
                <div class="me-hovercard-text">{{ hoverCard.loading ? $t('memo.hoverLoading') : (hoverCard.text || $t('memo.hoverEmpty')) }}</div>
            </div>

            <!--
                表格操作条（v1.3.1.2）：光标落在任意单元格里就浮在表格上方。
                比工具栏里的「表格组」更顺手 —— 眼睛在表格上，手不用回去找按钮。
            -->
            <div
                v-if="tableBar.open"
                class="me-tablebar"
                :class="{ 'is-below': !tableBar.above }"
                :style="tableBar.style"
                @mousedown.prevent
            >
                <span class="me-tablebar-arrow" aria-hidden="true"></span>
                <button type="button" class="me-bub-btn" :title="$t('memo.tblAddRowBefore')" @click="runTool('tableAddRowBefore')"><font-awesome-icon icon="arrow-up" /></button>
                <button type="button" class="me-bub-btn" :title="$t('memo.tblAddRow')" @click="runTool('tableAddRow')"><font-awesome-icon icon="arrow-down" /></button>
                <button type="button" class="me-bub-btn" :title="$t('memo.tblAddColBefore')" @click="runTool('tableAddColBefore')"><font-awesome-icon icon="arrow-left" /></button>
                <button type="button" class="me-bub-btn" :title="$t('memo.tblAddCol')" @click="runTool('tableAddCol')"><font-awesome-icon icon="arrow-right" /></button>
                <span class="me-bub-sep"></span>
                <button type="button" class="me-bub-btn" :title="$t('memo.tblDelRow')" @click="runTool('tableDelRow')"><font-awesome-icon icon="minus" /></button>
                <button type="button" class="me-bub-btn" :title="$t('memo.tblDelCol')" @click="runTool('tableDelCol')"><font-awesome-icon icon="columns" /></button>
                <span class="me-bub-sep"></span>
                <button type="button" class="me-bub-btn" :title="$t('memo.tblMerge')" @click="runTool('tableMerge')"><font-awesome-icon icon="compress" /></button>
                <button type="button" class="me-bub-btn" :title="$t('memo.tblSplit')" @click="runTool('tableSplit')"><font-awesome-icon icon="expand" /></button>
                <button type="button" class="me-bub-btn" :title="$t('memo.tblDelete')" @click="runTool('tableDelete')"><font-awesome-icon icon="trash" /></button>
            </div>

            <!-- 右键 / 长按菜单（v1.3.1.2） -->
            <div
                v-if="ctxMenu.open"
                class="me-ctx"
                :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
                @mousedown.stop
            >
                <!--
                    v1.3.3（需求）：右键菜单不再写死 —— 按「设置 → 右键菜单工具配置」渲染。
                    配置为空时用内置默认（空白处=粘贴类，段落=复制/剪切/删除/批注/链接）。
                -->
                <template v-for="(item, i) in ctxMenuItems" :key="`ctx-${i}`">
                    <div v-if="item.sep" class="me-ctx-sep"></div>
                    <button v-else type="button" class="me-ctx-item" @click="runCtx(item)">
                        <font-awesome-icon v-if="item.icon" :icon="item.icon" class="me-ctx-icon" />
                        <span>{{ $t(item.label) }}</span>
                        <span v-if="item.hint" class="me-ctx-key">{{ item.hint }}</span>
                    </button>
                </template>
            </div>

            <!--
                左侧行级栏的块操作菜单
                v1.3.4.2（需求）：复制/剪切/删除改成「复制块/剪切块/删除块」，
                「删除块」后加「清除格式」，末尾加「在下方插入换行」。
            -->
            <div
                v-if="gutterMenu.open"
                class="me-ctx me-gutter-menu"
                :style="{ left: `${gutterMenu.x}px`, top: `${gutterMenu.y}px` }"
                @mousedown.stop
            >
                <button type="button" class="me-ctx-item" @click="gutterAction('copyId')">
                    <font-awesome-icon icon="hashtag" class="me-ctx-icon" /><span>{{ $t('memo.gutterCopyId') }}</span>
                </button>
                <button type="button" class="me-ctx-item" @click="gutterAction('copy')">
                    <font-awesome-icon icon="copy" class="me-ctx-icon" /><span>{{ $t('memo.gutterCopyBlock') }}</span>
                </button>
                <button type="button" class="me-ctx-item" @click="gutterAction('cut')">
                    <font-awesome-icon icon="scissors" class="me-ctx-icon" /><span>{{ $t('memo.gutterCutBlock') }}</span>
                </button>
                <button type="button" class="me-ctx-item" @click="gutterAction('delete')">
                    <font-awesome-icon icon="trash" class="me-ctx-icon" /><span>{{ $t('memo.gutterDeleteBlock') }}</span>
                </button>
                <button type="button" class="me-ctx-item" @click="gutterAction('clearFormat')">
                    <font-awesome-icon icon="eraser" class="me-ctx-icon" /><span>{{ $t('memo.gutterClearFormat') }}</span>
                </button>
                <div class="me-ctx-sep"></div>
                <button type="button" class="me-ctx-item" @click="gutterAction('insertAfter')">
                    <font-awesome-icon icon="plus" class="me-ctx-icon" /><span>{{ $t('memo.gutterInsertAfter') }}</span>
                </button>
                <button type="button" class="me-ctx-item" @click="gutterAction('insertBreak')">
                    <font-awesome-icon icon="arrow-down" class="me-ctx-icon" /><span>{{ $t('memo.gutterInsertBreak') }}</span>
                </button>
            </div>

            <!-- 插入表格数量选择（v1.3.1.2） -->
            <div v-if="tablePicker.open" class="me-tablepicker-mask" @click.self="tablePicker.open = false">
                <div class="me-tablepicker">
                    <div class="me-tablepicker-grid" @mouseleave="tablePicker.hover = null">
                        <button
                            v-for="n in 100"
                            :key="`tp-${n}`"
                            type="button"
                            class="me-tablepicker-cell"
                            :class="{ 'is-on': tablePicker.hover && ((Math.ceil(n / 10) <= tablePicker.hover.r) && ((n - 1) % 10 < tablePicker.hover.c)) }"
                            @mouseenter="tablePicker.hover = { r: Math.ceil(n / 10), c: ((n - 1) % 10) + 1 }"
                            @click="insertTableAt(tablePicker.hover || { r: 1, c: 1 })"
                        ></button>
                    </div>
                    <div class="me-tablepicker-tip">
                        {{ tablePicker.hover ? `${tablePicker.hover.r} × ${tablePicker.hover.c}` : $t('memo.tablePickerTip') }}
                    </div>
                </div>
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

        <!--
            v1.3.3.3（需求）：列表 / 标题末尾的行级操作条。
            ------------------------------------------------------------------
            光标停在列表项或标题的**文字末尾**时，在光标上方浮出一行操作：
              · 列表：增加缩进 / 减少缩进 / 增加一行 / 删除本行 / 复制内容块 / 清除格式；
              · 标题：折叠展开 / h2~h6 / 段落。
            这类操作都是「对当前这一整行」，放工具栏里反而要先回顶部找按钮。
        -->
        <Teleport to="body">
            <div
                v-if="lineBar.open"
                class="me-linebar"
                :class="{ 'is-list': lineBar.kind === 'list', 'is-fresh': lineBar.fresh }"
                :style="lineBar.style"
                @mousedown.prevent
            >
                <div class="me-linebar-scroll">
                    <template v-if="lineBar.kind === 'list'">
                        <!--
                            v1.3.4（需求）：列表行末菜单最前面加「转换」。
                            鼠标移上去展开下拉，选任务 / 无序 / 有序 —— 转换的是**同级整段列表**，
                            不是光标那一行（ProseMirror 里同级项本来就同属一个 list 节点）。
                        -->
                        <el-dropdown
                            :trigger="'click'"
                            :show-timeout="60"
                            :hide-timeout="140"
                            placement="top-start"
                            @command="lineAction"
                        >
                            <button type="button" class="me-btn me-lb-convert" :title="$t('memo.toolListConvert')">
                                <font-awesome-icon icon="right-left" />
                                <span>{{ $t('memo.toolListConvert') }}</span>
                                <font-awesome-icon icon="caret-down" class="me-lb-caret" />
                            </button>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item command="convert:taskList">{{ $t('memo.toolTask') }}</el-dropdown-item>
                                    <el-dropdown-item command="convert:bulletList">{{ $t('memo.toolBullet') }}</el-dropdown-item>
                                    <el-dropdown-item command="convert:orderedList">{{ $t('memo.toolOrdered') }}</el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>
                        <span class="me-sep"></span>
                        <button type="button" class="me-btn" :title="$t('memo.listAddIndent')" @click="lineAction('indent')">
                            <font-awesome-icon icon="indent" />
                        </button>
                        <button type="button" class="me-btn" :title="$t('memo.listDelIndent')" @click="lineAction('outdent')">
                            <font-awesome-icon icon="outdent" />
                        </button>
                        <span class="me-sep"></span>
                        <button type="button" class="me-btn" :title="$t('memo.listAddRow')" @click="lineAction('addRow')">
                            <font-awesome-icon icon="plus" />
                        </button>
                        <button type="button" class="me-btn" :title="$t('memo.listDelRow')" @click="lineAction('delRow')">
                            <font-awesome-icon icon="minus" />
                        </button>
                        <span class="me-sep"></span>
                        <button type="button" class="me-btn" :title="$t('memo.listCopyBlock')" @click="lineAction('copyBlock')">
                            <font-awesome-icon icon="copy" />
                        </button>
                        <button type="button" class="me-btn" :title="$t('memo.listClearFormat')" @click="lineAction('clearFormat')">
                            <font-awesome-icon icon="eraser" />
                        </button>
                    </template>
                    <template v-else>
                        <button
                            type="button"
                            class="me-btn"
                            :title="lineBar.folded ? $t('memo.headUnfold') : $t('memo.headFold')"
                            @click="lineAction('fold')"
                        >
                            <font-awesome-icon :icon="lineBar.folded ? 'angles-down' : 'angles-up'" />
                        </button>
                        <span class="me-sep"></span>
                        <button
                            v-for="lv in 5"
                            :key="`lb-h${lv + 1}`"
                            type="button"
                            class="me-btn me-hbtn"
                            :class="{ 'is-active': lineBar.level === lv + 1 }"
                            :title="`H${lv + 1}`"
                            @click="lineAction('h' + (lv + 1))"
                        >
                            <span class="me-hlabel">H{{ lv + 1 }}</span>
                        </button>
                        <span class="me-sep"></span>
                        <button type="button" class="me-btn" :title="$t('memo.bubParagraph')" @click="lineAction('paragraph')">
                            <font-awesome-icon icon="paragraph" />
                        </button>
                    </template>
                </div>
                <span class="me-linebar-arrow" aria-hidden="true"></span>
            </div>
        </Teleport>

        <!--
            光标工具栏（v1.3.1.2）
            · 与光标同一行，左侧一个指向光标的小三角 —— 一眼看出「这条是对当前这一行的」；
            · 移动端可左右滑动（工具再多也不会换行把正文顶下去）；
            · 支持 [组名 a b] 工具组，点开是下拉页；
            · 随光标所在行滚动（updateInputBar 在滚动时重算位置）。
        -->
        <Teleport to="body">
            <div
                v-if="inputBar.open && inputTools.length"
                class="me-inputbar"
                :style="inputBar.style"
                @mousedown.prevent
            >
                <span class="me-inputbar-arrow" aria-hidden="true"></span>
                <div class="me-inputbar-scroll">
                    <template v-for="(t, ti) in inputTools" :key="`ib-${ti}`">
                        <el-dropdown
                            v-if="isGroupToken(t)"
                            :trigger="isTouchUi ? 'click' : 'hover'"
                            :show-timeout="60"
                            :hide-timeout="120"
                            placement="bottom-start"
                            @command="(cmd) => runTool(cmd)"
                        >
                            <button type="button" class="me-btn me-btn-group" @mousedown.prevent>
                                <span class="me-group-name">{{ groupLabel(t) }}</span>
                                <font-awesome-icon icon="caret-down" class="me-group-caret" />
                            </button>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item v-for="g in groupTools(t)" :key="`ibg-${ti}-${g}`" :command="g">
                                        <font-awesome-icon v-if="toolsOf(g) && toolsOf(g).icon" :icon="toolsOf(g).icon" class="me-group-icon" />
                                        <span class="me-group-label">{{ toolsOf(g) ? $t(toolsOf(g).label) : g }}</span>
                                    </el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>
                        <button
                            v-else-if="toolsOf(t)"
                            type="button"
                            class="me-btn"
                            :title="$t(toolsOf(t).label)"
                            @click="runTool(t, $event)"
                        >
                            <span v-if="/^h[1-6]$/.test(t)" class="me-hlabel">{{ t.toUpperCase() }}</span>
                            <span v-else-if="t === 'undo'" class="me-svg-icon" v-html="svgUndo"></span>
                            <span v-else-if="t === 'redo'" class="me-svg-icon" v-html="svgRedo"></span>
                            <span v-else-if="toolsOf(t).svgKey" class="me-svg-icon" v-html="svgOf(t)"></span>
                            <span v-else-if="toolsOf(t).glyph" class="me-glyph-tool">{{ toolsOf(t).glyph }}</span>
                            <font-awesome-icon v-else-if="toolsOf(t).icon" :icon="toolsOf(t).icon" />
                        </button>
                    </template>
                </div>
            </div>
        </Teleport>

        <!-- 工具栏按钮名称浮层（点击后 2 秒消失） -->
        <Teleport to="body">
            <div
                v-if="toolTip.show"
                class="me-tooltip"
                :style="{ left: `${toolTip.left}px`, top: `${toolTip.top}px` }"
            >{{ toolTip.text }}</div>
        </Teleport>

        <!-- 表情 / 符号面板（v1.3.1.2） -->
        <el-dialog
            v-model="insertPanelVisible"
            :title="insertPanelTab === 'emoji' ? $t('memo.emojiTitle') : $t('memo.symbolTitle')"
            width="560px"
            append-to-body
            class="me-glyph-dialog"
        >
            <div class="me-glyph">
                <div class="me-glyph-side">
                    <button
                        v-for="(g, gi) in insertPanelGroups()"
                        :key="`gg-${g.key}`"
                        type="button"
                        class="me-glyph-cat"
                        :class="{ 'is-active': !insertPanelQuery && gi === insertPanelCat }"
                        @click="insertPanelCat = gi; insertPanelQuery = ''"
                    >{{ $t(g.label) }}</button>
                </div>
                <div class="me-glyph-main">
                    <input v-model="insertPanelQuery" class="me-glyph-search" :placeholder="$t('memo.glyphSearch')" />
                    <div class="me-glyph-grid">
                        <button
                            v-for="(ch, ci) in insertPanelItems()"
                            :key="`gl-${ci}`"
                            type="button"
                            class="me-glyph-item"
                            @click="insertGlyph(ch)"
                        >{{ ch }}</button>
                    </div>
                    <div v-if="!insertPanelItems().length" class="me-glyph-empty">{{ $t('memo.glyphEmpty') }}</div>
                </div>
            </div>
            <template #footer>
                <el-button @click="insertPanelVisible = false">{{ $t('common.close') }}</el-button>
            </template>
        </el-dialog>

        <!-- 查找替换（v1.3.1.2） -->
        <!--
            v1.3.3.3（需求：增加「查找」按钮与查找定位）
            改成非模态 + 可拖动：定位到某一处时要能同时看见正文，
            模态遮罩会把编辑区整块盖住，等于「定位了但看不见」。
        -->
        <el-dialog
            v-model="findDlg.visible"
            :title="$t('memo.toolFindReplace')"
            width="480px"
            append-to-body
            :modal="false"
            :close-on-click-modal="false"
            draggable
            class="me-find-dialog"
        >
            <div class="me-find">
                <el-input v-model="findDlg.find" :placeholder="$t('memo.findWhat')" clearable @input="countMatches" />
                <el-input v-model="findDlg.replace" :placeholder="$t('memo.replaceWith')" clearable />
                <p class="me-find-tip">
                    <span v-if="findDlg.count">{{ $t('memo.findCount', { n: findDlg.count }) }}</span>
                    <span v-else>{{ findDlg.tip || $t('memo.findHint') }}</span>
                </p>
            </div>
            <template #footer>
                <el-button size="small" type="primary" plain @click="findNext">{{ $t('memo.findNext') }}</el-button>
                <el-button size="small" @click="countMatches">{{ $t('memo.findCountBtn') }}</el-button>
                <el-button size="small" @click="replaceOne">{{ $t('memo.replaceOne') }}</el-button>
                <el-button size="small" type="primary" @click="replaceAll">{{ $t('memo.replaceAll') }}</el-button>
                <el-button size="small" @click="findDlg.visible = false">{{ $t('common.close') }}</el-button>
            </template>
        </el-dialog>

        <!-- HTML ↔ MD（v1.3.1.2） -->
        <el-dialog v-model="htmlDlg.visible" :title="$t('memo.toolHtmlMd')" append-to-body class="me-htmlmd-dialog">
            <div class="me-htmlmd">
                <div class="me-htmlmd-col">
                    <label class="me-htmlmd-label">HTML</label>
                    <textarea v-model="htmlDlg.html" class="me-htmlmd-text" spellcheck="false" placeholder="<h1>标题</h1>"></textarea>
                </div>
                <div class="me-htmlmd-col">
                    <label class="me-htmlmd-label">Markdown</label>
                    <textarea v-model="htmlDlg.md" class="me-htmlmd-text" spellcheck="false" placeholder="# 标题"></textarea>
                </div>
            </div>
            <template #footer>
                <el-button size="small" @click="htmlToMdNow">{{ $t('memo.htmlToMd') }}</el-button>
                <el-button size="small" @click="mdToHtmlNow">{{ $t('memo.mdToHtml') }}</el-button>
                <el-button size="small" type="primary" plain @click="applyHtmlMdToEditor">{{ $t('memo.applyToEditor') }}</el-button>
                <el-button size="small" @click="htmlDlg.visible = false">{{ $t('common.close') }}</el-button>
            </template>
        </el-dialog>

        <!--
            v1.3.3.3（需求）：创建子文档并引用。
            弹出一个小笔记页（标题 + 正文），确认后：
              1) 在当前笔记的**同一目录**下创建这篇笔记；
              2) 把它的引用插到刚才的光标位置。
            光标位置先存下来 —— 弹窗期间焦点离开编辑器，选区会变。
        -->
        <el-dialog
            v-model="subDoc.visible"
            :title="$t('memo.subDoc')"
            :width="isMobileViewport ? '98vw' : '80vw'"
            top="1vh"
            append-to-body
            class="me-subdoc-dialog"
        >
            <p class="me-subdoc-hint">{{ $t('memo.subDocHint') }}</p>
            <el-input v-model="subDoc.title" :placeholder="$t('memo.subDocTitle')" maxlength="200" />
            <textarea
                v-model="subDoc.content"
                class="me-subdoc-text"
                spellcheck="false"
            ></textarea>
            <template #footer>
                <el-button @click="subDoc.visible = false">{{ $t('common.cancel') }}</el-button>
                <el-button type="primary" :loading="subDoc.busy" @click="createSubDoc">{{ $t('memo.subDocCreate') }}</el-button>
            </template>
        </el-dialog>

        <!-- HTML 块（v1.3.1.2） -->
        <el-dialog v-model="htmlBlockDlg.visible" :title="$t('memo.toolHtmlBlock')" width="720px" append-to-body>
            <textarea
                v-model="htmlBlockDlg.html"
                class="me-htmlmd-text"
                rows="12"
                spellcheck="false"
                placeholder="<div style='color:#e06c75'>任意 HTML</div>"
            ></textarea>
            <p class="me-find-tip">{{ $t('memo.htmlBlockTip') }}</p>
            <template #footer>
                <el-button size="small" @click="htmlBlockDlg.visible = false">{{ $t('common.cancel') }}</el-button>
                <el-button size="small" type="primary" @click="saveHtmlBlock">{{ $t('common.confirm') }}</el-button>
            </template>
        </el-dialog>

        <!-- 历史记录（点击版本号打开） -->
        <el-dialog
            v-model="historyVisible"
            :title="$t('memo.historyTitle')"
            width="98vw"
            top="1vh"
            append-to-body
            class="me-history-dialog"
        >
            <!--
                v1.3.2（需求）：移动端左侧列表改成顶部下拉框。
                桌面端仍然左右分栏，各自独立滚动。
            -->
            <div v-if="isMobileViewport" class="me-hist-mobile">
                <el-select
                    v-model="historySelectedId"
                    class="me-hist-select"
                    size="small"
                    :placeholder="$t('memo.historyPick')"
                    @change="onHistorySelect"
                >
                    <el-option
                        v-for="h in historyItems"
                        :key="'hm-' + h.id"
                        :value="h.id"
                        :label="formatHistoryTime(h.createdAt) + ' · v' + h.version"
                    />
                </el-select>
            </div>
            <div class="me-hist-wrap" :class="{ 'is-mobile': isMobileViewport }">
                <div v-if="!isMobileViewport" class="me-hist-list" v-loading="historyLoading">
                    <button
                        v-for="h in historyItems"
                        :key="h.id"
                        type="button"
                        class="me-hist-item"
                        :class="{ 'is-active': historyPreview && historyPreview.id === h.id }"
                        @click="viewHistory(h)"
                    >
                        <span class="me-hist-time">{{ formatHistoryTime(h.createdAt) }}</span>
                        <span class="me-hist-meta">v{{ h.version }} · {{ h.charCount }}{{ $t('memo.charUnit') }}</span>
                        <span class="me-hist-title">{{ h.title || $t('memo.untitled') }}</span>
                    </button>
                    <div v-if="!historyItems.length && !historyLoading" class="me-hist-empty">
                        {{ $t('memo.historyEmpty') }}
                    </div>
                </div>
                <div class="me-hist-preview">
                    <template v-if="historyPreview">
                        <div class="me-hist-preview-head">
                            <span>{{ formatHistoryTime(historyPreview.createdAt) }}</span>
                            <el-button size="small" type="primary" plain @click="restoreHistoryItem(historyPreview)">
                                {{ $t('memo.historyRestore') }}
                            </el-button>
                        </div>
                        <div class="me-hist-preview-body gh-md" v-safe-html="renderHistoryPreview"></div>
                    </template>
                    <div v-else class="me-hist-empty">{{ $t('memo.historyPick') }}</div>
                </div>
            </div>
            <template #footer>
                <span class="me-hist-tip">{{ $t('memo.historyTip', { n: 100 }) }}</span>
                <el-button @click="historyVisible = false">{{ $t('common.close') }}</el-button>
            </template>
        </el-dialog>

        <!-- 图床选文件 -->
        <FilePickerDialog
            v-model="pickerVisible"
            :instance-id="instanceId"
            @confirm="onPicked"
        />

        <!--
            v1.3.3.2（需求）：选中文件 → 菜单里的「预览 / 文件详情」
            预览走全站媒体灯箱（图片 / 视频 / 音频 / 其它各有一套形态），
            详情走全站统一详情弹窗（FileDetailUnified）。
        -->
        <!--
            v1.3.3.3（需求：灯箱右上角要显示「详情」，下滑也要能进详情）
            show-detail 打开顶栏入口；items 里带上 recordId 后，
            移动端下拉手势会优先走「已落库文件详情」（见 MediaPreviewOverlay 的手势分支）。
        -->
        <MediaPreviewOverlay
            v-model="lightbox.open"
            :items="lightbox.items"
            :start-index="lightbox.index"
            :show-detail="true"
            @detail="onLightboxDetail"
            @record-detail="onLightboxDetail"
        />
        <FileDetailUnified v-model="fileDlg.open" :file="fileDlg.file" />
    </div>
</template>

<script>
import { markRaw } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { Node, Mark, Extension, mergeAttributes } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
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
import TableHeader from '@tiptap/extension-table-header';
import CodeBlock from '@tiptap/extension-code-block';
import { ElMessage, ElMessageBox } from 'element-plus';
import FilePickerDialog from '@/components/notes/FilePickerDialog.vue';
import UploadTargetDialog from '@/components/upload/UploadTargetDialog.vue';
/*
 * v1.3.3.2（需求：选中文件 → 预览 / 文件详情）
 * 复用全站同一套灯箱与详情页，不另做一套「笔记专用预览」——
 * 两套并存的话，用户在笔记里看到的操作与文件管理里不一致，还会各修一遍。
 */
import MediaPreviewOverlay from '@/components/dashboard/MediaPreviewOverlay.vue';
import FileDetailUnified from '@/components/dashboard/FileDetailUnified.vue';
import { loadFileDetail } from '@/utils/fileDetailLoader';
import { docToMd, mdToDoc, renderMarkdownSafe, plainTextOf } from '@/utils/markdown';
import {
    saveNote,
    createNote as apiCreateNote,
    memoError,
    fetchNotes,
    fetchNote,
    fetchNoteBlocks,
    fetchBacklinks,
    resolveBlock,
    fetchNoteTags,
    saveNoteTags,
    fetchTagCandidates,
    fetchNoteHistory,
    fetchNoteHistoryItem,
    restoreNoteHistory,
    pushNoteHistory,
} from '@/utils/memoApi';
import { uploadOne, defaultUploadFolder, importUrlToBed } from '@/utils/uploadTarget';
import { mediaKindOfMime } from '@/utils/notes';
import { DEFAULT_TOOLBAR_LINES } from '@/utils/memoEditorConfig';
import DOMPurify from 'dompurify';
import { htmlToMd } from '@/utils/htmlToMd';

/**
 * v1.3.3：按文件名猜 MIME。
 *
 * 链接提取的转存接口在「服务端直接回字节流」这条路径上不带 mime，
 * 视频 / 音频 / 图片要按媒体类型插入，只能靠后缀兜一层；
 * 仍然猜不出时才落成 `![[file:…]]` 附件。
 *
 * 注意：上一版这个方法在调用处被引用、但定义没有落进文件，
 * 表现为点「开始上传」后弹 `guessMimeByName is not defined`，
 * 文件其实已经传进图床，只是插入被这一步打断。
 */
function guessMimeByName(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    if (!m) return '';
    const ext = m[1].toLowerCase();
    const map = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
        webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
        mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', ogv: 'video/ogg',
        mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac',
        pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', md: 'text/markdown'
    };
    return map[ext] || '';
}

/*
 * v1.3.3.2：左侧行号栏不再用 Decoration.widget。
 *
 * 老做法是「每个块前插一个零宽 widget，由 ProseMirror 跟着文档走」。它对段落没问题，
 * 但块级原子节点（图片 / 视频 / 文件 / 分割线 / 表格）的边界上插 widget，渲染位置会
 * 落到块的**上一行** —— 用户看到的就是「图片其实是第 3 行，行号 3 却浮在它上方」。
 * 现在改成 syncGutter()：遍历顶层块 → 取块自己的 DOM 矩形 → 绝对定位覆盖层，
 * 段落按首行居中、原子块贴块顶，位置永远与块正对。
 */

/**
 * 字号 / 文字颜色（v1.3.1.2）。
 *
 * 两者都只做「有限预设」而不是自由取值：
 *   · 字号 s / m / l 三档（小 / 正常 / 大），颜色 7 个常用色；
 *   · 落进 md 是 span + class（见 markdown.js），不用 style —— 白名单会剥 style；
 *   · 预设有限，往返才稳定；自由取值在 md 里没有可移植的写法。
 */
const FontSize = Mark.create({
    name: 'fontSize',
    addAttributes() {
        return {
            size: {
                default: 'm',
                parseHTML: (el) => {
                    const m = /gh-fs-(s|m|l)/.exec(el.getAttribute('class') || '');
                    return m ? m[1] : 'm';
                },
                renderHTML: (attrs) => ({ class: `gh-fs-${attrs.size || 'm'}` }),
            },
        };
    },
    parseHTML() {
        return [{ tag: 'span[class*="gh-fs-"]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes(HTMLAttributes)];
    },
});

const TextColor = Mark.create({
    name: 'textColor',
    addAttributes() {
        return {
            color: {
                default: 'gray',
                parseHTML: (el) => {
                    const m = /gh-c-([a-z]+)/.exec(el.getAttribute('class') || '');
                    return m ? m[1] : 'gray';
                },
                renderHTML: (attrs) => ({ class: `gh-c-${attrs.color || 'gray'}` }),
            },
        };
    },
    parseHTML() {
        return [{ tag: 'span[class*="gh-c-"]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes(HTMLAttributes)];
    },
});

/**
 * 段落 / 标题对齐（v1.3.1.1）。
 *
 * 没用官方的 @tiptap/extension-text-align：它写的是行内 `style="text-align:..."`，
 * 而全站预览走 DOMPurify 白名单、`style` 在禁用清单里 —— 预览会和编辑态不一致。
 * 这里改用 HTML 的 `align` 属性（白名单放行），md 侧对应 `<p align="center">…</p>`，
 * 往返稳定，且在别的 markdown 查看器里也能看出对齐。
 */
const BlockAlign = Extension.create({
    name: 'blockAlign',
    addGlobalAttributes() {
        return [
            {
                types: ['paragraph', 'heading'],
                attributes: {
                    align: {
                        default: null,
                        parseHTML: (el) => el.getAttribute('align') || null,
                        renderHTML: (attrs) => (attrs.align ? { align: attrs.align } : {}),
                    },
                },
            },
        ];
    },
});

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
            /* v1.3.4.1：高度属性，供选中菜单的「高度」下拉使用 */
            height: {
                default: null,
                parseHTML: (el) => Number(el.getAttribute('height')) || null,
                renderHTML: (attrs) => (attrs.height ? { height: Math.round(Number(attrs.height)) } : {}),
            },
            /*
             * v1.3.1.2（需求：对齐工具要对文件生效）：
             * 图片也带一个 align —— 值域与段落对齐一致（left / center / right）。
             * 存在 align 属性上而不是 style：预览走 DOMPurify 白名单，style 被禁。
             */
            align: {
                default: null,
                parseHTML: (el) => el.getAttribute('align') || null,
                renderHTML: (attrs) => (attrs.align ? { align: attrs.align } : {}),
            },
        };
    },
});

/**
 * v1.3.1 新增的三个自定义块（视频 / 音频 / 附件）。
 *
 * 为什么自己写而不是装扩展：
 *   · 官方没有 video / audio 节点；
 *   · 附件要能落成 md 里的 `![[file:…]]`，属性名与序列化规则必须和
 *     utils/markdown.js 完全对齐，第三方扩展的 HTML 规则不受我们控制。
 * 三个都是 atom（不可编辑内部），md 里各占一行，往返稳定。
 *
 * v1.3.3.2（需求：视频/音频/文件也要能选中、能被拖动框缩放）
 *   ① 三者的 `width` 属性都写进 md：
 *        视频 / 音频 → `<video src="…" width="480" controls>`（HTML 属性，白名单放行）
 *        附件       → `![[file:地址|名称]]{width=320}`（尾部属性块，与图片同一套写法）
 *   ② 三者都加 NodeView：点一下就是 NodeSelection（否则 <video controls> 的
 *      原生控件会把点击吃掉，永远选不中），选中后由 .me-imgbox 那套手柄统一缩放；
 *   ③ 附件从 block 改成 **inline** 原子 —— 解析侧本来就把它放在段落里，
 *      声明成 block 会让 `![[file:…]]` 这一行在装载时对不上 schema。
 */
/** 媒体节点的宽度属性（三者共用同一套 parse/render，避免三份实现漂移） */
const mediaWidthAttr = {
    width: {
        default: null,
        parseHTML: (el) => Number(el.getAttribute('width')) || null,
        renderHTML: (attrs) => (attrs.width ? { width: Math.round(Number(attrs.width)) } : {}),
    },
    /* v1.3.4.1：高度也进属性，宽高下拉才可持久化 */
    height: {
        default: null,
        parseHTML: (el) => Number(el.getAttribute('height')) || null,
        renderHTML: (attrs) => (attrs.height ? { height: Math.round(Number(attrs.height)) } : {}),
    },
    /** 与图片同一套对齐值（left / center / right），落成 HTML 的 align 属性 */
    align: {
        default: null,
        parseHTML: (el) => el.getAttribute('align') || null,
        renderHTML: (attrs) => (attrs.align ? { align: attrs.align } : {}),
    },
};

/**
 * 点击即选中节点（NodeSelection）。
 *
 * `stopEvent` 返回 false 表示「这个事件交给我处理」，PM 不会吞掉它；
 * 但 <video> 的原生控件（播放 / 进度条）必须继续可用，所以只有点击
 * 控件以外的地方才切成节点选区。
 */
const MEDIA_NODE_NAMES = ['image', 'video', 'audio', 'fileAttachment'];

/** v1.3.3.3：可折叠的列表类型（折叠时只收下级列表） */
const LIST_NODE_NAMES = ['bulletList', 'orderedList', 'taskList'];

/**
 * 选中「点中的那个媒体节点」，返回它的文档位置；没点中返回 -1。
 *
 * 两条路都试，谁先成功用谁：
 *   1) 用被点元素的 DOM 反查位置（posAtDOM）—— 对行内原子（附件卡片）最准；
 *   2) 用鼠标坐标反查（posAtCoords）—— 图片这种块级叶子节点用它稳。
 * 只靠坐标会在「行内原子」上算到段落边界，结果是点附件变成落光标；
 * 只靠 posAtDOM 又会在部分块级节点上拿到 +1 的偏移，所以两条一起。
 */
function selectMediaNode(view, el, event) {
    const isMedia = (pos) => {
        if (typeof pos !== 'number' || pos < 0) return null;
        const n = view.state.doc.nodeAt(pos);
        return n && MEDIA_NODE_NAMES.includes(n.type.name) ? n : null;
    };
    const commit = (pos) => {
        try {
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
            return pos;
        } catch (e) {
            return -1;
        }
    };
    if (el) {
        try {
            const p0 = view.posAtDOM(el, 0);
            if (isMedia(p0)) return commit(p0);
            if (isMedia(p0 + 1)) return commit(p0 + 1);
        } catch (e) {
        }
    }
    if (event && typeof event.clientX === 'number') {
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (at) {
            if (isMedia(at.pos)) return commit(at.pos);
            if (isMedia(at.pos - 1)) return commit(at.pos - 1);
        }
    }
    return -1;
}

function mediaSelectOnClick(view, el, event) {
    const pos = selectMediaNode(view, el, event);
    if (pos < 0) return;
    /*
     * v1.3.3.2：程序内 dispatch 设的选区，Tiptap 不一定派发 selectionUpdate
     * （实测首次点击媒体节点时完全不发），所以额外抛一个 DOM 事件让组件自己去同步浮层。
     */
    try {
        (el || view.dom).dispatchEvent(new CustomEvent('gohub:media-select', { bubbles: true }));
    } catch (e) {
        /* 忽略 */
    }
}

const Video = Node.create({
    name: 'video',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes() {
        return { src: { default: '' }, poster: { default: '' }, ...mediaWidthAttr };
    },
    parseHTML() {
        return [{ tag: 'video[src]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['video', mergeAttributes(HTMLAttributes, { controls: 'true', class: 'gh-video' })];
    },
    addNodeView() {
        return ({ node, getPos, view }) => {
            const video = document.createElement('video');
            video.controls = true;
            video.className = 'gh-video';
            video.src = String(node.attrs.src || '');
            if (node.attrs.poster) video.poster = String(node.attrs.poster);
            /*
             * v1.3.4（修拖缩放手柄时视频抖动 / 不按比例）：
             *   · src 只在真的变了才重新赋值 —— 每次 update 都赋同一个地址也会触发重新加载；
             *   · 元数据到了以后把宽高比写进 aspect-ratio，改宽度时高度自动跟随。
             */
            video.addEventListener('loadedmetadata', () => {
                if (video.videoWidth && video.videoHeight) {
                    video.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
                }
            });
            const apply = (n) => {
                const src = String(n.attrs.src || '');
                if (video.getAttribute('src') !== src) video.src = src;
                if (n.attrs.width) video.setAttribute('width', String(Math.round(Number(n.attrs.width))));
                else video.removeAttribute('width');
                /* v1.3.4.1：高度下拉也要落到 DOM（height 在 DOMPurify 白名单里，可随 md 往返） */
                if (n.attrs.height) video.setAttribute('height', String(Math.round(Number(n.attrs.height))));
                else video.removeAttribute('height');
                if (n.attrs.align) video.setAttribute('align', String(n.attrs.align));
                else video.removeAttribute('align');
            };
            apply(node);
            /*
             * 点视频本体（不是控件条）→ 选中该节点。
             * v1.3.3.3（需求：移动端选不中视频）
             * 手机上点 <video> 常常不派发 click —— 原生控件接管了这次点击，
             * 或者浏览器把「点一下」当成「唤出控件」。这里补 touchend：
             * 只认画面区（底部 35% 是进度条/播放键），抬手即选中。
             */
            const pickOnVideo = (ev) => {
                const r = video.getBoundingClientRect();
                const barZone = Math.min(56, r.height * 0.35);
                if (ev.clientY > r.bottom - barZone) return; // 点在原生控件上，别抢
                mediaSelectOnClick(view, video, ev);
            };
            video.addEventListener('click', pickOnVideo);
            video.addEventListener('touchend', (ev) => {
                const t = (ev.changedTouches && ev.changedTouches[0]) || ev;
                pickOnVideo({ clientX: t.clientX, clientY: t.clientY, target: video });
            }, { passive: true });
            return { dom: video, update: (n) => (n.type.name === 'video' ? (apply(n), true) : false) };
        };
    },
});

const Audio = Node.create({
    name: 'audio',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes() {
        return { src: { default: '' }, ...mediaWidthAttr };
    },
    parseHTML() {
        return [{ tag: 'audio[src]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['audio', mergeAttributes(HTMLAttributes, { controls: 'true', class: 'gh-audio' })];
    },
    addNodeView() {
        return ({ node, getPos, view }) => {
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.className = 'gh-audio';
            audio.src = String(node.attrs.src || '');
            const apply = (n) => {
                audio.src = String(n.attrs.src || '');
                if (n.attrs.width) {
                    // 音频条的宽度只能走行内 style（它没有 width 属性），
                    // 但编辑器里的 style 不参与 md 序列化，落库仍然是 width=N
                    audio.style.width = `${Math.round(Number(n.attrs.width))}px`;
                } else {
                    audio.style.width = '';
                }
                /* v1.3.4.1：音频没有 height 属性，走行内 style；md 侧仍写 height="N" */
                if (n.attrs.height) audio.style.height = `${Math.round(Number(n.attrs.height))}px`;
                else audio.style.height = '';
                if (n.attrs.align) audio.setAttribute('align', String(n.attrs.align));
                else audio.removeAttribute('align');
            };
            apply(node);
            const pickOnAudio = (ev) => {
                const r = audio.getBoundingClientRect();
                if (ev.clientY > r.bottom - Math.min(40, r.height * 0.5)) return;
                mediaSelectOnClick(view, audio, ev);
            };
            audio.addEventListener('click', pickOnAudio);
            audio.addEventListener('touchend', (ev) => {
                const t = (ev.changedTouches && ev.changedTouches[0]) || ev;
                pickOnAudio({ clientX: t.clientX, clientY: t.clientY, target: audio });
            }, { passive: true });
            return { dom: audio, update: (n) => (n.type.name === 'audio' ? (apply(n), true) : false) };
        };
    },
});

/**
 * HTML 块（v1.3.1.2）。
 *
 * md 里用 `:::html … :::` 围栏存原始 HTML；编辑器里渲染的是**净化后**的结果
 * （DOMPurify，和预览走同一套白名单），所以块里写 <script> 之类不会被执行。
 * contentEditable=false：这是「块」，不是可编辑文本，要改就点按钮进弹窗改源码。
 */
const HtmlBlock = Node.create({
    name: 'htmlBlock',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes() {
        return { html: { default: '' } };
    },
    parseHTML() {
        return [{ tag: 'div[data-html-block]' }];
    },
    addNodeView() {
        return ({ node }) => {
            /*
             * v1.3.4（需求）：HTML 块补一条标题行（与代码块同款）。
             * 左侧折叠按钮 + 「HTML 块」提示，右侧编辑按钮 —— 块本身仍然原子、
             * contentEditable=false，改内容走弹窗，所以标题行不会污染文档结构。
             */
            const wrap = document.createElement('div');
            wrap.className = 'gh-html-block-wrap';
            wrap.setAttribute('data-html-block', 'true');

            const bar = document.createElement('div');
            bar.className = 'gh-html-bar';
            bar.contentEditable = 'false';

            const fold = document.createElement('button');
            fold.type = 'button';
            fold.className = 'gh-cb-btn gh-html-fold';
            fold.title = '折叠 / 展开';
            fold.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

            const label = document.createElement('span');
            label.className = 'gh-html-label';
            label.textContent = 'HTML 块';

            const grow = document.createElement('span');
            grow.className = 'gh-cb-grow';

            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'gh-cb-btn gh-html-edit';
            edit.title = '编辑';
            edit.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

            bar.appendChild(fold);
            bar.appendChild(label);
            bar.appendChild(grow);
            bar.appendChild(edit);

            const body = document.createElement('div');
            body.className = 'gh-html-block';
            body.contentEditable = 'false';
            const paint = (html) => {
                body.innerHTML = DOMPurify.sanitize(String(html || ''), { ADD_ATTR: ['align', 'target'] });
                if (!body.innerHTML.trim()) body.innerHTML = '<span class="gh-html-empty">HTML 块（空）</span>';
            };
            paint(node.attrs.html);

            wrap.appendChild(bar);
            wrap.appendChild(body);

            const stop = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
            };
            fold.addEventListener('mousedown', stop);
            edit.addEventListener('mousedown', stop);
            fold.addEventListener('click', (ev) => {
                ev.preventDefault();
                wrap.classList.toggle('is-collapsed');
            });
            edit.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                wrap.dispatchEvent(new CustomEvent('gohub:html-edit', { bubbles: true }));
            });

            return {
                dom: wrap,
                update(next) {
                    if (next.type.name !== 'htmlBlock') return false;
                    paint(next.attrs.html);
                    return true;
                },
                ignoreMutation: () => true,
            };
        };
    },
});

/**
 * 网页嵌入（v1.3.1.2）。
 *
 * md 里是 `:::iframe{src="…" height="420"}`。只允许 http/https：
 * javascript: / data: 的 src 一律拒绝（否则别人点开你的笔记就会被执行脚本）。
 */
const IframeBlock = Node.create({
    name: 'iframe',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes() {
        /* v1.3.4.1：新增 width，配合标题栏拖动缩放持久化 */
        return { src: { default: '' }, height: { default: 420 }, width: { default: null } };
    },
    parseHTML() {
        return [{ tag: 'div[data-embed-iframe]' }];
    },
    /*
     * v1.3.4.1（需求）：网页嵌入改成「带标题栏的内容块」——
     * 折叠按钮 + 「网页嵌入块」提示 + 编辑按钮；点标题栏选中块并显示缩放手柄。
     */
    addNodeView() {
        return ({ node, getPos, view }) => {
            const wrap = document.createElement('div');
            wrap.className = 'gh-iframe-wrap';
            wrap.setAttribute('data-embed-iframe', 'true');
            wrap.contentEditable = 'false';
            let cur = node;

            const bar = document.createElement('div');
            bar.className = 'gh-iframe-bar';
            const fold = document.createElement('button');
            fold.type = 'button';
            fold.className = 'gh-cb-btn gh-iframe-fold';
            fold.title = '折叠 / 展开';
            fold.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
            const label = document.createElement('span');
            label.className = 'gh-iframe-label';
            label.textContent = '网页嵌入块';
            const grow = document.createElement('span');
            grow.className = 'gh-cb-grow';
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'gh-cb-btn gh-iframe-edit';
            edit.title = '编辑';
            edit.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
            bar.appendChild(fold);
            bar.appendChild(label);
            bar.appendChild(grow);
            bar.appendChild(edit);

            const body = document.createElement('div');
            body.className = 'gh-iframe-body';
            const handle = document.createElement('span');
            handle.className = 'gh-iframe-resize';
            handle.title = '拖动改变大小';

            let frame = null;
            const build = (attrs) => {
                const s = String(attrs.src || '');
                if (!/^https?:\/\//i.test(s)) {
                    body.innerHTML = '<span class="gh-html-empty">嵌入地址无效（只支持 http/https）</span>';
                    return;
                }
                if (!frame) {
                    frame = document.createElement('iframe');
                    frame.loading = 'lazy';
                    frame.referrerPolicy = 'no-referrer';
                    body.innerHTML = '';
                    body.appendChild(frame);
                    body.appendChild(handle);
                }
                frame.src = s;
                frame.style.height = `${Math.max(120, Number(attrs.height) || 420)}px`;
                if (Number(attrs.width) > 0) frame.style.width = `${Math.max(200, Number(attrs.width))}px`;
                else frame.style.width = '';
            };
            /*
             * v1.3.4.2（需求：插入网页嵌入后内容框里加载不出来）
             * 上一版写的是 build(node) —— 形参叫 attrs，读的却是 attrs.src，
             * 而 node.src 恒为 undefined，于是每次都走「地址无效」分支：
             * iframe 从没被创建，缩放手柄也没 append 进来。这里统一传 node.attrs。
             */
            build(node.attrs);

            const commit = (w, h) => {
                const pos = typeof getPos === 'function' ? getPos() : null;
                if (typeof pos !== 'number' || !view) return;
                try {
                    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
                        ...cur.attrs,
                        width: Math.round(w),
                        height: Math.round(h),
                    }));
                } catch (e) { /* 忽略 */ }
            };
            let drag = null;
            const onMove = (ev) => {
                if (!drag || !frame) return;
                const w = Math.max(240, drag.w + (ev.clientX - drag.x));
                const h = Math.max(120, drag.h + (ev.clientY - drag.y));
                frame.style.width = `${w}px`;
                frame.style.height = `${h}px`;
            };
            const onUp = () => {
                document.removeEventListener('pointermove', onMove);
                if (!drag || !frame) return;
                const rect = frame.getBoundingClientRect();
                const w = parseFloat(frame.style.width) || rect.width;
                const h = parseFloat(frame.style.height) || rect.height;
                drag = null;
                commit(w, h);
            };
            handle.addEventListener('pointerdown', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (!frame) return;
                const r = frame.getBoundingClientRect();
                drag = { x: ev.clientX, y: ev.clientY, w: r.width, h: r.height };
                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', onUp, { once: true });
            });

            const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
            fold.addEventListener('mousedown', stop);
            edit.addEventListener('mousedown', stop);
            fold.addEventListener('click', (ev) => {
                ev.preventDefault();
                wrap.classList.toggle('is-collapsed');
            });
            edit.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                wrap.dispatchEvent(new CustomEvent('gohub:iframe-config', { bubbles: true }));
            });
            /* 点标题栏：选中块并显示缩放手柄 */
            bar.addEventListener('click', (ev) => {
                ev.preventDefault();
                wrap.classList.add('is-selected');
                const pos = typeof getPos === 'function' ? getPos() : null;
                if (typeof pos === 'number' && view) {
                    try {
                        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
                    } catch (e) { /* 忽略 */ }
                }
            });

            wrap.appendChild(bar);
            wrap.appendChild(body);

            return {
                dom: wrap,
                update(updated) {
                    if (updated.type.name !== 'iframe') return false;
                    cur = updated;
                    // v1.3.4.2：与首次 build 同一口径，传 attrs 而不是节点
                    build(updated.attrs);
                    return true;
                },
            };
        };
    },
});

const FileAttachment = Node.create({
    name: 'fileAttachment',
    /*
     * v1.3.3.2：从 block 改成 inline 原子。
     *
     * md 里它本来就是「一句话里的一个 token」（`![[file:地址|名称]]`），
     * utils/markdown.js 的解析侧也把它放进段落里；声明成 block 会让这类笔记
     * 在装载时对不上 schema（段落里不允许放块节点），只能被降级成纯文本。
     * 同时它现在也要能被选中 + 缩放，与 video / audio 用同一套手柄。
     */
    group: 'inline',
    inline: true,
    atom: true,
    draggable: true,
    addAttributes() {
        return { href: { default: '' }, name: { default: '' }, ...mediaWidthAttr };
    },
    parseHTML() {
        return [{ tag: 'a.gh-file' }];
    },
    renderHTML({ node, HTMLAttributes }) {
        return [
            'a',
            mergeAttributes(HTMLAttributes, {
                class: 'gh-file',
                href: node.attrs.href || '',
                download: '',
                target: '_blank',
                rel: 'noopener noreferrer',
            }),
            `📎 ${node.attrs.name || '附件'}`,
        ];
    },
    addNodeView() {
        return ({ node, getPos, view }) => {
            const a = document.createElement('a');
            a.className = 'gh-file';
            a.setAttribute('download', '');
            a.setAttribute('rel', 'noopener noreferrer');
            const apply = (n) => {
                a.href = String(n.attrs.href || '');
                a.textContent = `📎 ${n.attrs.name || '附件'}`;
                a.title = String(n.attrs.name || '附件');
                if (n.attrs.width) {
                    a.style.width = `${Math.round(Number(n.attrs.width))}px`;
                    a.classList.add('is-sized');
                } else {
                    a.style.width = '';
                    a.classList.remove('is-sized');
                }
            };
            apply(node);
            /*
             * 编辑器里点附件：不跳转，改成「选中这个节点」——
             * 否则一点就离开当前笔记，正在写的草稿还没保存。
             * Ctrl / Cmd + 点击才真的打开。
             */
            /*
             * v1.3.3.2：附件卡片用 mousedown 选中，而不是 click。
             *
             * 它是 atom 节点，ProseMirror 会给 DOM 挂 draggable="true"；
             * 在可拖拽元素上按下鼠标会进入拖拽手势，浏览器随后**不再派发 click**，
             * 于是「点附件」永远选不中（只落一个光标）。
             * mousedown 一定会到，preventDefault 又顺手掐掉原生拖拽与跳转。
             */
            a.addEventListener('mousedown', (ev) => {
                if (ev.ctrlKey || ev.metaKey) return; // 交给浏览器在新标签打开
                ev.preventDefault();
                ev.stopPropagation();
                mediaSelectOnClick(view, a, ev);
            });
            a.addEventListener('click', (ev) => {
                // 兜底：拦掉默认的「下载 / 打开」，选中已在 mousedown 完成
                if (ev.ctrlKey || ev.metaKey) return;
                ev.preventDefault();
            });
            return { dom: a, update: (n) => (n.type.name === 'fileAttachment' ? (apply(n), true) : false) };
        };
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
    /*
     * v1.3.1.2（需求：![[note#blk]] 要能看到内容，而不是一个占位卡）
     *
     * 惰性渲染：只有滚到可见时才去请求源块（一页里可能嵌了十几处，
     * 全量预取等于把整库拉一遍）。取到的是纯文本摘要 —— 后端 blocks 表
     * 只存 plainText，不做「把源块当子文档渲染」，避免递归引用把编辑器拖死。
     */
    addNodeView() {
        return ({ node }) => {
            const dom = document.createElement('span');
            dom.className = 'gh-noteembed is-loading';
            dom.contentEditable = 'false';
            dom.dataset.noteId = node.attrs.noteId || '';
            dom.dataset.blockId = node.attrs.blockId || '';
            const label = node.attrs.label || '嵌入内容';
            dom.innerHTML = `<span class="gh-embed-head">⤵ ${label}</span><span class="gh-embed-body">滚动到可见时加载…</span>`;

            let done = false;
            const load = async () => {
                if (done) return;
                done = true;
                const body = dom.querySelector('.gh-embed-body');
                try {
                    if (node.attrs.blockId) {
                        const r = await resolveBlock(node.attrs.blockId);
                        if (body) body.textContent = String(r?.plainText || '（源块为空）');
                    } else {
                        const r = await fetchNote(node.attrs.noteId);
                        const note = r?.note || r || {};
                        if (body) body.textContent = String(note.excerpt || plainTextOf(note.content || '').slice(0, 220) || '（源笔记为空）');
                    }
                    dom.classList.remove('is-loading');
                } catch (e) {
                    if (body) body.textContent = '（源内容已删除或无权访问）';
                    dom.classList.add('is-error');
                }
            };
            if (typeof IntersectionObserver !== 'undefined') {
                const io = new IntersectionObserver((entries) => {
                    if (entries.some((en) => en.isIntersecting)) {
                        io.disconnect();
                        load();
                    }
                }, { rootMargin: '120px' });
                io.observe(dom);
                dom.__io = io;
            } else {
                load();
            }
            return {
                dom,
                destroy: () => dom.__io && dom.__io.disconnect(),
            };
        };
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
    /*
     * v1.3.4.1（需求）：块引用插入后改成「带标题栏的内容框」——
     * 左侧折叠按钮 + 「块内容引用」提示，右侧「编辑」跳回源笔记并定位。
     * NodeView 在模块作用域拿不到组件实例，跳转靠自定义事件冒泡上去。
     */
    addNodeView() {
        return ({ node, getPos, view }) => {
            const wrap = document.createElement('span');
            wrap.className = 'gh-blockref-card';
            wrap.setAttribute('data-block-ref', 'true');
            wrap.setAttribute('data-block-id', node.attrs.blockId || '');
            wrap.contentEditable = 'false';

            const bar = document.createElement('span');
            bar.className = 'gh-br-bar';
            const fold = document.createElement('button');
            fold.type = 'button';
            fold.className = 'gh-cb-btn gh-br-fold';
            fold.title = '折叠 / 展开';
            fold.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
            const label = document.createElement('span');
            label.className = 'gh-br-label';
            label.textContent = '块内容引用';
            /*
             * v1.3.4.2（需求）：内容框第一行要显示「所引用块的笔记来源标题」。
             * resolveBlock 已经返回 noteTitle，这里单列一个 span 显示，
             * 超长时由 CSS 省略，不挤掉右侧的编辑按钮。
             */
            const source = document.createElement('span');
            source.className = 'gh-br-source';
            const grow = document.createElement('span');
            grow.className = 'gh-cb-grow';
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'gh-cb-btn gh-br-edit';
            edit.title = '更换引用块';
            edit.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
            bar.appendChild(fold);
            bar.appendChild(label);
            bar.appendChild(source);
            bar.appendChild(grow);
            bar.appendChild(edit);

            const body = document.createElement('span');
            body.className = 'gh-br-body';
            body.textContent = '加载中…';

            wrap.appendChild(bar);
            wrap.appendChild(body);

            const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
            fold.addEventListener('mousedown', stop);
            edit.addEventListener('mousedown', stop);
            fold.addEventListener('click', (ev) => {
                ev.preventDefault();
                wrap.classList.toggle('is-collapsed');
            });
            /*
             * v1.3.4.2（需求）：这里的「编辑」由「跳回源笔记」改为「更换引用块」。
             * 组件收到事件后打开两级引用面板，选完块直接把本节点的 blockId 换掉。
             */
            edit.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                wrap.dispatchEvent(new CustomEvent('gohub:blockref-change', { bubbles: true }));
            });
            /* 点标题栏：选中这个行内原子，方便整块删除 / 键盘操作 */
            bar.addEventListener('click', (ev) => {
                if (ev.target === edit || ev.target === fold) return;
                const pos = typeof getPos === 'function' ? getPos() : null;
                if (typeof pos === 'number' && view) {
                    try {
                        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
                    } catch (e) { /* 忽略 */ }
                }
            });

            /* 连续更换时只认最后一次请求的返回，避免旧请求把新内容盖回去 */
            let seq = 0;
            const load = async () => {
                const mine = ++seq;
                const blockId = String(node.attrs.blockId || '');
                try {
                    const r = await resolveBlock(blockId);
                    if (mine !== seq) return;
                    source.textContent = r?.noteTitle ? `· ${r.noteTitle}` : '';
                    body.textContent = String(r?.plainText || '（源块为空）');
                } catch (e) {
                    if (mine !== seq) return;
                    source.textContent = '';
                    body.textContent = '（源内容已删除或无权访问）';
                }
            };
            load();

            return {
                dom: wrap,
                update(next) {
                    if (next.type.name !== 'blockRef') return false;
                    if (next.attrs.blockId !== node.attrs.blockId) {
                        node = next;
                        wrap.setAttribute('data-block-id', next.attrs.blockId || '');
                        load();
                    }
                    return true;
                },
            };
        };
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

/*
 * 标题折叠（v1.3.3.2 改为 DOM 类实现）。
 *
 * 原来用 ProseMirror 的 node decoration 加 class（display:none）。问题在于：
 * 「折叠状态」不在文档里，只存在组件的一个 Set 里，切换后要发一个**空事务**
 * 让装饰重算 —— 实测这一步在很多情况下不会真的触发重算（PM 对无变化的
 * 事务会走快速路径），表现就是「点了折叠按钮，按钮变了，内容没折」。
 * 现在改成在 syncGutter() 里直接给块 DOM 挂 .gh-fold-hidden（见该函数），
 * 折叠区间与行号栏用同一份遍历逻辑，两者永远一致。
 */

/**
 * 工具栏工具表。
 * 每一项只描述「长什么样 + 点了做什么」，具体渲染哪一行、哪几个由设置里的字符串决定。
 * 这样「设置页改工具栏」就是改一个数组，不需要动模板。
 */
/**
 * v1.3.2（需求：粘贴拆成独立工具）
 *
 * 浏览器的富文本剪贴板只能通过 paste 事件拿到，按钮里退一步用
 * navigator.clipboard.read()（支持时）/ readText()：拿到 text/html 就按 HTML 插，
 * 拿不到就按纯文本插。escaped 会把 HTML 当普通文字插进去（写教程时要展示源码）。
 */
async function pasteFromClipboard(editor, mode) {
    if (!editor) return;
    let html = '';
    let text = '';
    try {
        if (navigator.clipboard && navigator.clipboard.read) {
            const items = await navigator.clipboard.read();
            for (const it of items) {
                if (it.types.includes('text/html')) html = await (await it.getType('text/html')).text();
                if (it.types.includes('text/plain')) text = await (await it.getType('text/plain')).text();
                if (html || text) break;
            }
        }
        if (!html && !text && navigator.clipboard && navigator.clipboard.readText) {
            text = await navigator.clipboard.readText();
        }
    } catch (e) {
        return;
    }
    const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (mode === 'rich') {
        editor.chain().focus().insertContent(html || esc(text).replace(/\n/g, '<br>')).run();
    } else if (mode === 'keep') {
        editor.chain().focus().insertContent(String(text || html).split(/\n/).map((l) => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] }))).run();
    } else if (mode === 'escaped') {
        editor.chain().focus().insertContent(esc(html || text)).run();
    } else {
        editor.chain().focus().insertContent(esc(text)).run();
    }
}

/**
 * v1.3.3（需求）：右键菜单动作表。
 *
 * id 同时也是「编辑器设置 → 右键菜单工具配置」里可以填的工具名，
 * 所以这张表既是渲染清单，也是配置白名单。kinds 决定该动作在哪种上下文出现：
 *   empty     —— 空白处右键（粘贴类）
 *   text      —— 选中文本时（剪切/复制/删除/批注）
 *   paragraph —— 段落里（额外给「链接」）
 */
const CTX_ACTIONS = {
    paste: { icon: 'clipboard', label: 'memo.ctxPaste', hint: 'Ctrl+V', call: 'ctxPasteRich', kinds: ['empty'] },
    pasteKeep: { icon: 'clipboard', label: 'memo.ctxPasteKeep', call: 'ctxPasteKeep', kinds: ['empty'] },
    pastePlain: { icon: 'paste', label: 'memo.ctxPastePlain', hint: 'Ctrl+Shift+V', call: 'ctxPastePlain', kinds: ['empty'] },
    pasteEscaped: { icon: 'code', label: 'memo.ctxPasteEscaped', call: 'ctxPasteEscaped', kinds: ['empty'] },
    selectAll: { icon: 'object-group', label: 'memo.ctxSelectAll', hint: 'Ctrl+A', call: 'ctxSelectAll', kinds: ['empty', 'paragraph'] },
    copy: { icon: 'copy', label: 'memo.ctxCopy', hint: 'Ctrl+C', call: 'ctxCopy', kinds: ['text', 'paragraph'] },
    cut: { icon: 'scissors', label: 'memo.ctxCut', hint: 'Ctrl+X', call: 'ctxCut', kinds: ['text', 'paragraph'] },
    delete: { icon: 'trash', label: 'memo.ctxDelete', call: 'ctxDelete', kinds: ['text', 'paragraph'] },
    annotate: { icon: 'comment-dots', label: 'memo.ctxAnnotate', call: 'ctxAnnotate', kinds: ['text', 'paragraph'] },
    link: { icon: 'link', label: 'memo.ctxLink', call: 'ctxLink', kinds: ['paragraph'] }
};

/** v1.3.3：媒体选中条的默认工具（可被设置里对应配置覆盖） */
const MEDIA_DEFAULT = {
    /* v1.3.4.1（需求）：尺寸按钮后面新增「宽度」「高度」两个百分比下拉 */
    image: ['mediaPreview', 'mediaDetail', '|', 'alignLeft', 'alignCenter', 'alignRight', '|', 'imgSizeCycle', 'sizeWidth', 'sizeHeight', '|', 'deleteNode'],
    video: ['mediaPreview', 'mediaDetail', '|', 'alignLeft', 'alignCenter', 'alignRight', '|', 'imgSizeCycle', 'sizeWidth', 'sizeHeight', '|', 'deleteNode'],
    audio: ['mediaPreview', 'mediaDetail', '|', 'alignLeft', 'alignCenter', 'alignRight', '|', 'imgSizeCycle', 'sizeWidth', 'sizeHeight', '|', 'deleteNode'],
    file: ['mediaPreview', 'mediaDetail', '|', 'alignLeft', 'alignCenter', 'alignRight', '|', 'imgSizeCycle', 'sizeWidth', 'sizeHeight', '|', 'deleteNode']
};

/** v1.3.3：选中浮层的保留名（复合控件 / 非 TOOLS 动作） */
const SEL_RESERVED = ['heading', 'align', 'fontSize', 'textColor', 'publish'];

/**
 * v1.3.4：把配置文本切成「工具 / 分隔线 / 工具组」。
 *
 * 上一版所有配置都直接 `split(/\s+/)`，`[组名 bold italic]` 会被切成
 * `[组名`、`bold`、`italic]` 三个残缺 token，组自然就消失了 ——
 * 这正是「选中文本工具配置里写了工具组却加载不出来」的原因。
 */
function splitToolTokens(raw) {
    const s = String(raw || '');
    const out = [];
    let buf = '';
    let inGroup = false;
    for (const ch of s) {
        if (ch === '[' && !inGroup) {
            if (buf.trim()) out.push(buf.trim());
            buf = '';
            inGroup = true;
            continue;
        }
        if (ch === ']' && inGroup) {
            const body = buf.trim();
            if (body) out.push(`[${body}]`);
            buf = '';
            inGroup = false;
            continue;
        }
        if (!inGroup && /\s/.test(ch)) {
            if (buf.trim()) out.push(buf.trim());
            buf = '';
            continue;
        }
        buf += ch;
    }
    if (buf.trim()) out.push(inGroup ? `[${buf.trim()}]` : buf.trim());
    return out;
}

/** 解析 `[组名 a b]` → { name, items }；不是组返回 null */
function parseGroupToken(token) {
    const m = /^\[(.+)\]$/.exec(String(token || '').trim());
    if (!m) return null;
    const parts = m[1].split(/\s+/).filter(Boolean);
    const name = parts.shift() || '';
    const items = parts.filter((id) => !!TOOLS[id]);
    return items.length ? { name: name || items[0], items } : null;
}

const SEL_DEFAULT = [
    'heading', 'align', '|', 'bold', 'strike', 'italic', 'underline', 'link', 'code',
    '|', 'fontSize', 'textColor', '|', 'annotate', 'publish'
];

const CTX_DEFAULT = {
    empty: ['paste', 'pasteKeep', 'pastePlain', 'pasteEscaped', '|', 'selectAll'],
    text: ['copy', 'cut', 'delete', 'annotate', '|', 'bold', 'italic', 'underline', 'strike'],
    paragraph: ['copy', 'cut', 'delete', 'annotate', '|', 'link', '|', 'bold', 'italic', 'underline']
};

/** v1.3.3.2：当前选中的媒体节点名（图片 / 视频 / 音频 / 附件），否则空串 */
function mediaSelectionName(editor) {
    if (!editor) return '';
    const sel = editor.state.selection;
    if (!sel || !sel.node) return '';
    const n = sel.node.type && sel.node.type.name;
    return ['image', 'video', 'audio', 'fileAttachment'].includes(n) ? n : '';
}

/**
 * 媒体节点与段落共用的对齐实现。
 * 选中媒体时改节点自身的 align（落成尾部属性 / HTML 属性），否则改段落。
 */
/**
 * v1.3.3.3（需求：四种媒体都要能左中右对齐）
 *
 * 图片 / 视频 / 音频是块级原子：给节点写 align，CSS 用 auto 外边距定位。
 * 附件（fileAttachment）是**行内**原子，位置由所在段落决定 ——
 * 只给节点写 align 在视觉上没有效果，所以额外把父段落一起对齐。
 */
function applyBlockAlign(editor, align) {
    const name = mediaSelectionName(editor);
    if (!name) return editor.chain().focus().updateAttributes('paragraph', { align }).run();
    const chain = editor.chain().focus().updateAttributes(name, { align });
    if (name === 'fileAttachment') chain.updateAttributes('paragraph', { align });
    return chain.run();
}

/**
 * v1.3.3.3（需求：代码块要有「收起展开 / 代码类型 / 自动换行 / 复制」）
 *
 * 为什么用 NodeView 而不是在工具栏里堆按钮：
 *   这些操作都是**针对某一个代码块**的，按钮离得越近越好；堆到顶部工具栏里
 *   就得先记住「现在改的是哪一块」。NodeView 只在渲染层包一层壳，
 *   文档结构仍然是标准的 codeBlock —— md 往返（```lang）完全不受影响。
 *
 * 三个注意点：
 *   · contentDOM 必须交给 <code>（PM 只在这个节点里改文本，壳里的按钮不被碰）；
 *   · 按钮栏设 contenteditable=false 并吞掉 mousedown，否则点一下就把光标塞进代码里；
 *   · ignoreMutation 要放过壳上的变化，否则点一下按钮 PM 就认为「文档脏了」。
 */
const CODE_LANGS = ['text', 'js', 'ts', 'json', 'html', 'css', 'bash', 'sql', 'python', 'java', 'go', 'rust', 'yaml', 'markdown'];

const CodeBlockView = CodeBlock.extend({
    addNodeView() {
        return ({ node, editor, getPos }) => {
            const wrap = document.createElement('div');
            wrap.className = 'gh-codeblock';
            const bar = document.createElement('div');
            bar.className = 'gh-cb-bar';
            bar.contentEditable = 'false';

            const fold = document.createElement('button');
            fold.type = 'button';
            fold.className = 'gh-cb-btn gh-cb-fold';
            fold.title = '折叠 / 展开';
            fold.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

            /*
             * v1.3.4（需求）：代码类型下拉框挪到左侧，原来那个「代码类型」文字标签去掉。
             * 顺序变成：折叠 / 类型下拉 / 弹性空白 / 换行 / 复制。
             */
            const sel = document.createElement('select');
            sel.className = 'gh-cb-select';
            sel.title = '代码类型';
            CODE_LANGS.forEach((v) => {
                const o = document.createElement('option');
                o.value = v;
                o.textContent = v;
                sel.appendChild(o);
            });

            const grow = document.createElement('span');
            grow.className = 'gh-cb-grow';

            const wrapBtn = document.createElement('button');
            wrapBtn.type = 'button';
            wrapBtn.className = 'gh-cb-btn gh-cb-wrapbtn';
            wrapBtn.title = '自动换行';
            // v1.3.4（需求）：图标改成文字
            wrapBtn.textContent = '换行';

            const copy = document.createElement('button');
            copy.type = 'button';
            copy.className = 'gh-cb-btn gh-cb-copy';
            copy.title = '复制代码';
            // v1.3.4（需求）：图标改成文字
            copy.textContent = '复制';

            bar.appendChild(fold);
            bar.appendChild(sel);
            bar.appendChild(grow);
            bar.appendChild(wrapBtn);
            bar.appendChild(copy);

            const pre = document.createElement('pre');
            // 同时带上 gh-code-block：原有样式里有针对它的高特异性规则，带上才能被下面的规则接管
            pre.className = 'gh-cb-pre gh-code-block';
            const code = document.createElement('code');
            pre.appendChild(code);
            /*
             * v1.3.4（需求）：代码块左侧行号列。
             * 行号是纯装饰层（contenteditable=false），绝对定位在 pre 左边；
             * 正文的 padding-left 让出这一列，编辑光标不会跑到行号上。
             */
            const lines = document.createElement('div');
            lines.className = 'gh-cb-lines';
            lines.contentEditable = 'false';
            /*
             * 行号层挂在**外壳**上而不是 pre 里：pre 的 contentDOM 由 ProseMirror 管，
             * 往里塞兄弟节点会被它在重渲染时清掉（实测行号一直是空的）。
             * 外壳是 NodeView 自己的 DOM，PM 不碰。
             */
            wrap.appendChild(bar);
            wrap.appendChild(pre);
            wrap.appendChild(lines);

            let cur = node;
            let linesRaf = 0;
            const renderLines = () => {
                /*
                 * v1.3.4.1（需求）：换行模式也要显示行号。
                 * 折行后逻辑行与视觉行对不上是事实，但用户需要「看得出这一行是逻辑行」，
                 * 所以在行号左侧再补一列换行标识（↵），标出每个逻辑行换行符的位置。
                 */
                let cs;
                try {
                    // 行高取 pre 的：code 上还有一条全局「行内代码」样式（font-size 0.92em），
                    // 拿它算会差 1~2px，越往下越明显。
                    cs = window.getComputedStyle(pre);
                } catch (e) {
                    return;
                }
                let lh = parseFloat(cs.lineHeight);
                if (!Number.isFinite(lh) || lh <= 0) lh = (parseFloat(cs.fontSize) || 13) * 1.5;
                const n = Math.max(1, String(code.textContent || '').split('\n').length);
                if (lines.childElementCount !== n) {
                    lines.innerHTML = '';
                    const frag = document.createDocumentFragment();
                    for (let i = 1; i <= n; i += 1) {
                        const sp = document.createElement('span');
                        /* v1.3.4.1：第一列换行标识（仅换行模式可见），第二列行号 */
                        const lf = document.createElement('i');
                        lf.className = 'gh-cb-lf';
                        lf.textContent = '↵';
                        const num = document.createElement('b');
                        num.className = 'gh-cb-ln';
                        num.textContent = String(i);
                        sp.appendChild(lf);
                        sp.appendChild(num);
                        frag.appendChild(sp);
                    }
                    lines.appendChild(frag);
                }
                lines.style.lineHeight = `${lh}px`;
                const barH = bar.getBoundingClientRect().height || 28;
                /*
                 * 顶部内边距要取 **pre** 的，不是 code 的 —— 代码块的内边距在 pre 上，
                 * 取 code 会得到 0，行号整体上移一行（第一行没有号、最后一行多一个号）。
                 */
                const prePad = parseFloat(window.getComputedStyle(pre).paddingTop) || 0;
                lines.style.top = `${barH + prePad}px`;
            };
            const scheduleLines = () => {
                if (linesRaf) return;
                linesRaf = requestAnimationFrame(() => {
                    linesRaf = 0;
                    renderLines();
                });
                /*
                 * 某些环境（后台标签页 / 无头浏览器）rAF 会被节流甚至不派发，
                 * 行号就一直是空的。补一个 120ms 的兜底：只要还是空的就再算一次。
                 * 行号是纯展示，重复计算没有副作用。
                 */
                setTimeout(() => {
                    if (linesRaf) {
                        cancelAnimationFrame(linesRaf);
                        linesRaf = 0;
                    }
                    renderLines();
                }, 120);
            };
            const sync = () => {
                const l = String(cur.attrs?.language || 'text') || 'text';
                sel.value = CODE_LANGS.includes(l) ? l : 'text';
                scheduleLines();
            };
            sync();

            const stop = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
            };
            fold.addEventListener('mousedown', stop);
            wrapBtn.addEventListener('mousedown', stop);
            copy.addEventListener('mousedown', stop);
            sel.addEventListener('mousedown', (ev) => ev.stopPropagation());
            sel.addEventListener('change', () => {
                const v = sel.value;
                const pos = typeof getPos === 'function' ? getPos() : null;
                if (typeof pos !== 'number') return;
                editor.chain().focus().command(({ tr }) => {
                    tr.setNodeMarkup(pos, undefined, { ...cur.attrs, language: v === 'text' ? null : v });
                    return true;
                }).run();
                sync();
            });
            fold.addEventListener('click', (ev) => {
                ev.preventDefault();
                wrap.classList.toggle('is-collapsed');
            });
            wrapBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                wrap.classList.toggle('is-wrap');
                scheduleLines();
            });
            copy.addEventListener('click', (ev) => {
                ev.preventDefault();
                const text = code.textContent || '';
                const done = () => {
                    copy.classList.add('is-ok');
                    window.setTimeout(() => copy.classList.remove('is-ok'), 1200);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(done).catch(done);
                } else {
                    try {
                        const ta = document.createElement('textarea');
                        ta.value = text;
                        ta.style.cssText = 'position:fixed;left:-9999px';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                    } catch (e) {
                        /* 忽略 */
                    }
                    done();
                }
            });

            return {
                dom: wrap,
                contentDOM: code,
                update(next) {
                    if (next.type !== cur.type) return false;
                    cur = next;
                    sync();
                    return true;
                },
                ignoreMutation(m) {
                    /*
                     * v1.3.4：行号层会频繁改 DOM（重建 span / 改 style）。
                     * 不把这些变化挡掉，ProseMirror 会认为「节点被外部改动」→ 重建 NodeView →
                     * 又触发一次行号渲染，形成死循环（实测 7 秒内 594 次）。
                     */
                    if (m.type === 'attributes') return true;
                    return m.target === wrap || m.target === bar || m.target === lines;
                },
            };
        };
    },
});

const TOOLS = {
    bold: { icon: 'bold', label: 'memo.toolBold', run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e && e.isActive('bold') },
    italic: { icon: 'italic', label: 'memo.toolItalic', run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e && e.isActive('italic') },
    strike: { icon: 'strikethrough', label: 'memo.toolStrike', run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e && e.isActive('strike') },
    underline: { icon: 'underline', label: 'memo.toolUnderline', run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e && e.isActive('underline') },
    /* v1.3.3.3（需求）：行内代码图标改成 `< >` */
    code: { svgKey: 'svgAngle', label: 'memo.toolCode', run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e && e.isActive('code') },
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
    /* v1.3.3.3（需求）：代码块图标改成 `{}` */
    codeBlock: { svgKey: 'svgBraces', label: 'memo.toolCodeBlock', run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e && e.isActive('codeBlock') },
    hr: { icon: 'minus', label: 'memo.toolHr', run: (e) => e.chain().focus().setHorizontalRule().run() },
    link: { icon: 'link', label: 'memo.toolLink', run: null, active: (e) => e && e.isActive('link') },
    image: { icon: 'image', label: 'memo.toolImage', run: null },
    /** v1.3.1.1：上传（任意类型；先选目标再上传） */
    upload: { icon: 'upload', label: 'memo.toolUpload', run: null },
    /* ── v1.3.1.1 需求新增：对齐 / 缩进 / 换行 / 段落 / 链接提取 ── */
    alignLeft: {
        icon: 'align-left',
        label: 'memo.toolAlignLeft',
        /*
         * v1.3.1.2（需求：对齐要对文件生效）
         * v1.3.3.2：从「只认图片」扩到全部媒体节点（视频 / 音频 / 附件同权）。
         */
        run: (e) => applyBlockAlign(e, null),
        active: (e) => {
            if (!e) return false;
            const n = mediaSelectionName(e);
            return n ? e.isActive(n, { align: null }) : e.isActive('paragraph', { align: null });
        },
    },
    alignCenter: {
        icon: 'align-center',
        label: 'memo.toolAlignCenter',
        run: (e) => applyBlockAlign(e, 'center'),
        active: (e) => {
            if (!e) return false;
            const n = mediaSelectionName(e);
            return n ? e.isActive(n, { align: 'center' }) : e.isActive('paragraph', { align: 'center' });
        },
    },
    alignRight: {
        icon: 'align-right',
        label: 'memo.toolAlignRight',
        run: (e) => applyBlockAlign(e, 'right'),
        active: (e) => {
            if (!e) return false;
            const n = mediaSelectionName(e);
            return n ? e.isActive(n, { align: 'right' }) : e.isActive('paragraph', { align: 'right' });
        },
    },
    indent: {
        icon: 'indent',
        label: 'memo.toolIndent',
        /*
         * v1.3.1.2（需求）：列表里是 sinkListItem（md 有对应层级）；
         * 不在列表里时改成「Tab 缩进」—— 在段落开头插两个全角空格。
         *
         * 为什么不用真正的 \t：markdown 里行首的制表符（或 4 个半角空格）表示
         * **代码块**，存一次再读回来，普通段落就变成代码块了。全角空格是普通字符，
         * 往返稳定，而且中文排版本来就用它做首行缩进。
         */
        run: (e) => {
            /*
             * v1.3.3.3（需求：缩进时列表图标要跟着变成子列表）
             * 任务列表的节点名是 taskItem，不是 listItem —— 只判 listItem 时，
             * 任务列表里按缩进会走「插两个全角空格」那条分支，结果是
             * 文字缩进了、前面的勾选框还在原地。这里两个都认。
             */
            if (e.isActive('taskItem')) return e.chain().focus().sinkListItem('taskItem').run();
            if (e.isActive('listItem')) return e.chain().focus().sinkListItem('listItem').run();
            const { $from } = e.state.selection;
            return e.chain().focus().insertContentAt($from.start(), '\u3000\u3000').run();
        },
    },
    outdent: {
        icon: 'outdent',
        label: 'memo.toolOutdent',
        run: (e) => {
            if (e.isActive('taskItem')) return e.chain().focus().liftListItem('taskItem').run();
            if (e.isActive('listItem')) return e.chain().focus().liftListItem('listItem').run();
            const { $from } = e.state.selection;
            const start = $from.start();
            const head = e.state.doc.textBetween(start, Math.min(start + 2, $from.end()), '');
            if (head.startsWith('\u3000\u3000')) return e.chain().focus().deleteRange({ from: start, to: start + 2 }).run();
            if (head.startsWith('\u3000')) return e.chain().focus().deleteRange({ from: start, to: start + 1 }).run();
            return e.chain().focus().run();
        },
    },
    hardBreak: { icon: 'arrow-turn-down', label: 'memo.toolLineBreak', run: (e) => e.chain().focus().setHardBreak().run() },
    /* v1.3.2（需求）：把「下方插入空行」提成独立工具 */
    insertLineBelow: {
        icon: 'arrow-down',
        label: 'memo.toolInsertLineBelow',
        run: (e) => {
            const { $from } = e.state.selection;
            let pos = $from.pos;
            try {
                pos = $from.after(1);
            } catch (err) {
                pos = $from.pos;
            }
            e.chain().focus().insertContentAt(pos, { type: 'paragraph' }).run();
        },
    },
    /* v1.3.2（需求）：粘贴的四种模式拆成独立工具 */
    paste: { icon: 'paste', label: 'memo.toolPaste', run: (e) => pasteFromClipboard(e, 'rich') },
    pasteKeep: { icon: 'clipboard', label: 'memo.toolPasteKeep', run: (e) => pasteFromClipboard(e, 'keep') },
    pastePlain: { icon: 'paste', label: 'memo.toolPastePlain', run: (e) => pasteFromClipboard(e, 'plain') },
    /* v1.3.3.3（需求）：转义粘贴换成「页面 + <>」的图标，与行内代码区分开 */
    pasteEscaped: { icon: 'file-code', label: 'memo.toolPasteEscaped', run: (e) => pasteFromClipboard(e, 'escaped') },
    paragraph: { icon: 'paragraph', label: 'memo.toolParagraph', run: (e) => e.chain().focus().setParagraph().unsetAllMarks().run() },
    linkExtract: { icon: 'cloud-arrow-down', label: 'memo.toolLinkExtract', run: null },
    /* 表格操作（需求：插入后要能加/删行列、合并拆分） */
    tableAddRow: { icon: 'plus', label: 'memo.tblAddRow', run: (e) => e.chain().focus().addRowAfter().run() },
    tableAddCol: { icon: 'plus', label: 'memo.tblAddCol', run: (e) => e.chain().focus().addColumnAfter().run() },
    tableDelRow: { icon: 'minus', label: 'memo.tblDelRow', run: (e) => e.chain().focus().deleteRow().run() },
    tableDelCol: { icon: 'minus', label: 'memo.tblDelCol', run: (e) => e.chain().focus().deleteColumn().run() },
    tableMerge: { icon: 'compress-alt', label: 'memo.tblMerge', run: (e) => e.chain().focus().mergeCells().run() },
    tableSplit: { icon: 'expand', label: 'memo.tblSplit', run: (e) => e.chain().focus().splitCell().run() },
    tableDelete: { icon: 'trash', label: 'memo.tblDelete', run: (e) => e.chain().focus().deleteTable().run() },
    file: { icon: 'folder-open', label: 'memo.toolFile', run: null },
    /*
     * v1.3.1 新增工具。
     * table / callout / video / audio / filePick 都由 runTool 里特判（需要弹窗或追问参数），
     * 这里 run 留 null 表示「不进通用分支」。
     */
    /* v1.3.1.2：点「表格」先弹行列数量选择页（需求），不再固定插 3×3 */
    table: { icon: 'table', label: 'memo.toolTable', run: null },
    tableAddRowBefore: { icon: 'arrow-up', label: 'memo.tblAddRowBefore', run: (e) => e.chain().focus().addRowBefore().run() },
    tableAddColBefore: { icon: 'arrow-left', label: 'memo.tblAddColBefore', run: (e) => e.chain().focus().addColumnBefore().run() },
    callout: { icon: 'circle-info', label: 'memo.toolCallout', run: null },
    video: { icon: 'file-video', label: 'memo.toolVideo', run: null },
    audio: { icon: 'file-audio', label: 'memo.toolAudio', run: null },
    highlight: { icon: 'highlighter', label: 'memo.toolHighlight', run: (e) => e.chain().focus().toggleHighlight().run(), active: (e) => e && e.isActive('highlight') },
    outline: { icon: 'list', label: 'memo.toolOutline', run: null },
    foldAll: { icon: 'angles-up', label: 'memo.toolFoldAll', run: null },
    clear: { icon: 'eraser', label: 'memo.toolClear', run: (e) => e.chain().focus().unsetAllMarks().clearNodes().run() },
    undo: { icon: 'undo', label: 'memo.toolUndo', run: (e) => e.chain().focus().undo().run() },
    redo: { icon: 'redo', label: 'memo.toolRedo', run: (e) => e.chain().focus().redo().run() },

    /* ── v1.3.1.2 需求新增 ─────────────────────────────────────── */

    /** 选中光标所在行（整个段落文本块，不含前后空行） */
    selectLine: {
        icon: 'i-cursor',
        label: 'memo.toolSelectLine',
        run: (e) => {
            const { $from } = e.state.selection;
            const from = $from.start();
            const to = $from.end();
            return e.chain().focus().setTextSelection({ from, to }).run();
        },
    },
    /** 全选 */
    /* v1.3.3.3（需求）：全选换成「虚线选择框 + 方块」 */
    selectAll: { svgKey: 'svgSelectAll', label: 'memo.toolSelectAll', run: (e) => e.chain().focus().selectAll().run() },
    /* 日期 / 时间：各格式一个独立工具，点击即插入到光标处 */
    dateYmd: { icon: 'calendar-day', label: 'memo.toolDateYmd', run: null },
    dateSlash: { icon: 'calendar-day', label: 'memo.toolDateSlash', run: null },
    dateDash: { icon: 'calendar-day', label: 'memo.toolDateDash', run: null },
    dateCn: { icon: 'calendar-day', label: 'memo.toolDateCn', run: null },
    timeHms: { icon: 'clock', label: 'memo.toolTimeHms', run: null },
    /* 表情 / 符号面板 */
    emoji: { icon: 'face-smile', label: 'memo.toolEmoji', run: null },
    /* v1.3.3.3（需求）：符号工具图标直接用 Ω */
    symbol: { glyph: '\u03a9', label: 'memo.toolSymbol', run: null },
    /* 网页嵌入 */
    iframe: { icon: 'window-maximize', label: 'memo.toolIframe', run: null },
    /* 查找替换 */
    findReplace: { icon: 'magnifying-glass', label: 'memo.toolFindReplace', run: null },
    /* HTML ↔ MD 互转 / HTML 块 */
    htmlMd: { icon: 'right-left', label: 'memo.toolHtmlMd', run: null },
    /* v1.3.3.3（需求）：HTML 块换成「页面 + </>」 */
    htmlBlock: { svgKey: 'svgHtml', label: 'memo.toolHtmlBlock', run: null },
    /* 批注（选中文本后添加） */
    annotate: { icon: 'comment-dots', label: 'memo.toolAnnotate', run: null },
    /* v1.3.3.3（需求）：新建子文档并把引用插到当前光标处 */
    subDoc: { icon: 'file-circle-plus', label: 'memo.subDoc', run: null },
    /* v1.3.3（需求）：媒体选中条用的两个通用动作 */
    imgSizeCycle: {
        icon: 'up-right-and-down-left-from-center',
        label: 'memo.toolImgSize',
        run: (e) => {
            if (!e) return;
            // v1.3.3.2：四种媒体节点都能循环尺寸，不再只认图片
            const name = mediaSelectionName(e);
            if (!name) return;
            const cur = Number(e.state.selection.node.attrs.width) || 0;
            // 自动 → 600 → 400 → 260 → 自动
            const next = !cur ? 600 : (cur > 500 ? 400 : (cur > 320 ? 260 : 0));
            e.chain().focus().updateAttributes(name, { width: next || null }).run();
        }
    },
    /* v1.3.3.2（需求）：选中任意文件都能「灯箱预览」与「打开文件详情」 */
    mediaPreview: { icon: 'eye', label: 'memo.toolMediaPreview', run: null },
    mediaDetail: { icon: 'circle-info', label: 'memo.toolFileDetail', run: null },
    /* v1.3.4.1（需求）：选中文件的宽度 / 高度快捷设置（下拉百分比） */
    sizeWidth: { icon: 'arrows-left-right', label: 'memo.toolMediaWidth', run: null },
    sizeHeight: { icon: 'arrows-up-down', label: 'memo.toolMediaHeight', run: null },
    deleteNode: {
        icon: 'trash',
        label: 'memo.ctxDelete',
        run: (e) => e && e.chain().focus().deleteSelection().run()
    },
    /*
     * v1.3.4（需求：把这几项提取成独立工具，可配进工具栏 / 光标栏 / 右键菜单）
     * fontSize / textColor / listConvert 在工具栏里渲染成下拉（见 TOOL_DROPDOWNS）；
     * publish 是普通按钮，直接把当前选中文字发到瞬间。
     */
    fontSize: { icon: 'font', label: 'memo.bubFontSize', run: null },
    textColor: { icon: 'paintbrush', label: 'memo.bubColor', run: null },
    publish: { icon: 'paper-plane', label: 'memo.publishToMoment', run: null },
    listConvert: { icon: 'right-left', label: 'memo.toolListConvert', run: null },
};

/**
 * 每个工具在「/命令菜单」里的快捷键 / 语法提示（最右侧那一列）。
 * 没有条目的工具就不显示提示，菜单仍然完整 —— 这正是上一版丢工具的反面：
 * 上版只把「菜单表」里存在的那十几个渲染出来，配置里写了别的就静默丢弃。
 */
const TOOL_HINTS = {
    bold: 'Ctrl+B',
    italic: 'Ctrl+I',
    underline: 'Ctrl+U',
    strike: '~~',
    code: '`',
    highlight: '==',
    h1: '#',
    h2: '##',
    h3: '###',
    h4: '####',
    h5: '#####',
    h6: '######',
    bulletList: '-',
    orderedList: '1.',
    taskList: '[ ]',
    blockquote: '>',
    codeBlock: '```',
    hr: '---',
    table: '|',
    callout: ':::',
    link: 'Ctrl+K',
    selectLine: 'Shift+Home',
    selectAll: 'Ctrl+A',
    dateYmd: 'YYYYMMDD',
    dateSlash: 'YYYY/MM/DD',
    dateDash: 'YYYY-MM-DD',
    dateCn: 'YYYY年MM月DD日',
    timeHms: 'hh:mm:ss',
    findReplace: 'Ctrl+F',
};

/**
 * 表情面板的数据（v1.3.1.2）。
 *
 * 分组的写法照搬飞书那套分类（符号 / 人类 / 自然 / 食物 / 活动 / 地点 / 物件 / 旗帜），
 * 但只放「常用 + 一看就懂」的那几十个 —— 塞几百个进去，面板要滚很久反而更难找。
 * 全部是纯文本字符，插入后就是正文的一部分，不依赖任何图片资源。
 */
const EMOJI_GROUPS = [
    { key: 'symbol', label: 'memo.emojiSymbol', items: ['❤️', '💔', '💯', '✅', '❌', '⚠️', '❗', '❓', '➕', '➖', '⭐', '🔥', '💡', '🎉', '🎊', '🔔', '🔒', '🔑', '📌', '🏷️', '♻️', '⏰', '💤', '💬'] },
    { key: 'people', label: 'memo.emojiPeople', items: ['😀', '😄', '😁', '😆', '😅', '😂', '🙂', '😉', '😊', '😍', '😘', '😜', '🤔', '🤨', '😐', '😴', '😪', '😷', '🤒', '🤕', '😎', '🥳', '😭', '😤', '😡', '🥺', '😱', '🤯', '🙏', '👍', '👎', '👏', '🙌', '💪', '🤝', '👀'] },
    { key: 'nature', label: 'memo.emojiNature', items: ['🌱', '🌿', '🍀', '🌵', '🌴', '🌳', '🌲', '🍁', '🍂', '🌷', '🌹', '🌺', '🌸', '🌻', '🌼', '🌙', '⭐', '🌟', '☀️', '⛅', '☁️', '🌧️', '⛈️', '❄️', '🌈', '🌊', '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯'] },
    { key: 'food', label: 'memo.emojiFood', items: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🥦', '🌽', '🥕', '🍞', '🧀', '🍗', '🍔', '🍟', '🍕', '🍜', '🍚', '🍣', '🍰', '🍪', '🍫', '☕', '🍵', '🥤', '🍺'] },
    { key: 'activity', label: 'memo.emojiActivity', items: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏓', '🏸', '🥊', '🎯', '🎮', '🎲', '🎸', '🎹', '🎤', '🎧', '🎬', '📷', '✈️', '🚗', '🚲', '🏃', '🧘', '🏆'] },
    { key: 'place', label: 'memo.emojiPlace', items: ['🏠', '🏢', '🏫', '🏥', '🏦', '🏨', '🏪', '🏭', '🗼', '🏰', '⛪', '🕌', '🌉', '🗻', '🏖️', '🏕️', '🚉', '🚇', '🗺️', '🧭'] },
    { key: 'object', label: 'memo.emojiObject', items: ['💻', '🖥️', '⌨️', '🖱️', '📱', '☎️', '📞', '📠', '📺', '📻', '💾', '💿', '📀', '🎥', '📖', '📚', '📝', '✏️', '🖊️', '📎', '📐', '📏', '✂️', '🗑️', '🔧', '🔨', '⚙️', '🧰', '💰', '💳', '🎁', '📦'] },
    { key: 'flag', label: 'memo.emojiFlag', items: ['🏳️', '🏴', '🏁', '🚩', '🎌', '🏳️‍🌈'] },
];

/**
 * 符号面板的数据（v1.3.1.2）。
 * 与表情面板同一套 UI，只是内容换成「写文档真正会用到」的符号：
 * 箭头、数学、标点、货币、图形、序号。
 */
const SYMBOL_GROUPS = [
    { key: 'arrow', label: 'memo.symArrow', items: ['←', '→', '↑', '↓', '↔', '↕', '⇐', '⇒', '⇑', '⇓', '⇔', '↩', '↪', '⟵', '⟶', '⤴', '⤵', '⇢', '⇠'] },
    { key: 'math', label: 'memo.symMath', items: ['±', '×', '÷', '≈', '≠', '≤', '≥', '∞', '√', '∑', '∏', '∫', '∂', '∆', '∈', '∉', '⊂', '⊃', '∪', '∩', '∴', '∵', '°', '′', '″', '‰', '%', '‱'] },
    { key: 'punct', label: 'memo.symPunct', items: ['·', '•', '…', '、', '。', '，', '；', '：', '？', '！', '“', '”', '‘', '’', '「', '」', '『', '』', '《', '》', '〈', '〉', '【', '】', '〔', '〕', '—', '–', '~', '‖', '§', '¶'] },
    { key: 'currency', label: 'memo.symCurrency', items: ['¥', '$', '€', '£', '₩', '₽', '₹', '฿', '¢', '₿'] },
    { key: 'shape', label: 'memo.symShape', items: ['■', '□', '▪', '▫', '▲', '△', '▼', '▽', '◆', '◇', '○', '●', '◎', '★', '☆', '✓', '✔', '✗', '✘', '☑', '☐', '☒', '⌘', '⚑', '⚐'] },
    { key: 'number', label: 'memo.symNumber', items: ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ'] },
];

/** 文字颜色预设（v1.3.1.2）：与 markdown.js 的 gh-c-* 类一一对应 */
const TEXT_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

/**
 * v1.3.4：工具栏里的「下拉型工具」。
 *
 * 字号 / 文字颜色 / 列表转换本质是「一个按钮 + 一组选项」，
 * 做成普通按钮只能执行其中一个固定值。这里声明成下拉，
 * 工具栏与光标工具栏共用同一份定义；列表行末菜单复用同一套命令。
 */
const TOOL_DROPDOWNS = {
    fontSize: {
        items: [
            { command: 's', label: 'memo.fontSmall' },
            { command: 'm', label: 'memo.fontNormal' },
            { command: 'l', label: 'memo.fontLarge' },
            { command: 'clear', label: 'memo.fontDefault', divided: true },
        ],
    },
    textColor: {
        items: [
            ...TEXT_COLORS.map((c) => ({ command: c, label: `memo.color_${c}`, dot: c })),
            { command: 'clear', label: 'memo.colorClear', divided: true },
        ],
    },
    listConvert: {
        items: [
            { command: 'taskList', label: 'memo.toolTask' },
            { command: 'bulletList', label: 'memo.toolBullet' },
            { command: 'orderedList', label: 'memo.toolOrdered' },
        ],
    },
};

/**
 * 撤销 / 重做用的两枚箭头（v1.3.1.2 需求给了参考图）。
 *
 * FontAwesome 的 fa-undo / fa-redo 是实心钩形，与需求里的细线箭头不一样；
 * 这里内联 SVG（形状取自 Lucide 的 undo-2 / redo-2，ISC 许可），
 * 用 currentColor 描边，禁用态 / 深色模式都自动跟着走。
 */
const SVG_UNDO =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
/* 代码块图标（v1.3.1.2 需求参考图：圆角方框里一个 >_ ）—— FontAwesome 没有同款，内联一个 */
const SVG_CODE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7.5 10 2.2 2.2-2.2 2.2"/><path d="M12.5 14.5h4"/></svg>';
/*
 * v1.3.3.3：这批图标 FontAwesome 没有同款，统一内联（尺寸/线宽与既有 SVG 一致）。
 *   · SVG_BRACES     代码块   `{}`
 *   · SVG_ANGLE      行内代码 `< >`
 *   · SVG_HTML       HTML块   页面轮廓 + `</>`
 *   · SVG_SELECT_ALL 全选     虚线选择框 + 实心方块
 */
const SVG_BRACES =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.5c-1.7 0-2.6.9-2.6 2.6v2.3c0 1.3-.6 2-1.9 2.1v.9c1.3.1 1.9.8 1.9 2.1v2.4c0 1.7.9 2.6 2.6 2.6"/><path d="M15 4.5c1.7 0 2.6.9 2.6 2.6v2.3c0 1.3.6 2 1.9 2.1v.9c-1.3.1-1.9.8-1.9 2.1v2.4c0 1.7-.9 2.6-2.6 2.6"/></svg>';
const SVG_ANGLE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 7-5 5 5 5"/><path d="m15 7 5 5-5 5"/></svg>';
const SVG_HTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m10.5 12-1.6 2 1.6 2"/><path d="m14 12 1.6 2-1.6 2"/></svg>';
const SVG_SELECT_ALL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5.6A1.6 1.6 0 0 1 5.6 4H7"/><path d="M10 4h1.6"/><path d="M14.4 4H16"/><path d="M19 7V5.6A1.6 1.6 0 0 0 17.4 4H17"/><path d="M20 10v1.4"/><path d="M20 14.6V16"/><path d="M17 20h1.4A1.6 1.6 0 0 0 20 18.4V18"/><path d="M13.6 20H12"/><path d="M9 20H7.6A1.6 1.6 0 0 1 6 18.4V18"/><path d="M4 15v-1.4"/><path d="M4 10.6V10"/><rect x="9" y="9" width="6.5" height="6.5" rx="1"/></svg>';
const SVG_REDO =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>';

function slashCmdOf(id) {
    return {
        id,
        icon: TOOLS[id].icon || '',
        /* v1.3.3.3：内联图标 / 字形图标的工具，斜杠菜单也要跟着显示，不能空着 */
        svgKey: TOOLS[id].svgKey || '',
        glyph: TOOLS[id].glyph || '',
        label: TOOLS[id].label,
        hint: TOOL_HINTS[id] || '',
        separator: false,
    };
}

/**
 * 默认斜杠菜单的分组与顺序（v1.3.4.2 需求）。
 *
 * 没有配置 `/命令菜单配置` 时，原来直接按 TOOLS 的书写顺序铺开 ——
 * 那是「代码里的定义顺序」，不是「用户找工具的顺序」：加粗后面跟着 h1，
 * 隔很远才是斜体，同类工具散落各处。这里按使用频次与功能聚类重排：
 *   1) 行内文字格式（最高频）
 *   2) 标题与段落
 *   3) 列表与缩进
 *   4) 插入内容（媒体 / 文件 / 表格 / 代码 / 嵌入）
 *   5) 对齐与换行
 *   6) 引用、大纲与查找
 * 未在这里点名的工具不会被丢掉 —— 它们会分组追加到末尾（默认必须加载全部工具）。
 */
const SLASH_DEFAULT_GROUPS = [
    ['bold', 'italic', 'underline', 'strike', 'highlight', 'code', 'link'],
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'paragraph', 'blockquote', 'callout', 'hr'],
    ['bulletList', 'orderedList', 'taskList', 'indent', 'outdent'],
    ['image', 'upload', 'file', 'video', 'audio', 'linkExtract', 'iframe', 'table', 'codeBlock'],
    ['alignLeft', 'alignCenter', 'alignRight', 'hardBreak', 'insertLineBelow'],
    ['subDoc', 'outline', 'foldAll', 'findReplace'],
];

/** 由 TOOLS 生成完整的命令清单（默认顺序见 SLASH_DEFAULT_GROUPS） */
const SLASH_COMMANDS = (() => {
    const out = [];
    const used = new Set();
    for (const ids of SLASH_DEFAULT_GROUPS) {
        const valid = ids.filter((id) => TOOLS[id] && !used.has(id));
        if (!valid.length) continue;
        if (out.length) out.push({ id: `__sep_${out.length}`, separator: true });
        for (const id of valid) {
            used.add(id);
            out.push(slashCmdOf(id));
        }
    }
    const rest = Object.keys(TOOLS).filter((id) => !used.has(id));
    if (rest.length) {
        out.push({ id: '__sep_rest', separator: true });
        for (const id of rest) out.push(slashCmdOf(id));
    }
    return out;
})();

/**
 * 工具栏配置行 → { scope, text }
 *   `pc=h1 h2 | bold`  → { scope: 'pc', text: 'h1 h2 | bold' }
 *   `[bold italic]`    → { scope: '',   text: '[bold italic]' }
 */
function splitScope(line) {
    const m = /^(pc|m)\s*=\s*([\s\S]*)$/i.exec(String(line || '').trim());
    if (m) return { scope: m[1].toLowerCase(), text: m[2] };
    return { scope: '', text: String(line || '').trim() };
}

/**
 * 一行工具配置 → token 数组。
 *
 * v1.3.1.2（需求）：工具组格式改为 `[组名 tool1 tool2]` ——
 * 方括号里**第一个词是组名**（只作按钮显示名，不参与工具解析），后面才是组内工具。
 * 解析结果从「字符串数组」变成 `{ group, tools }` 对象，模板按 typeof 区分。
 * 组内的 `|` 直接丢掉（下拉菜单里再画分隔线意义不大）。
 */
function parseToolTokens(text) {
    const out = [];
    const src = String(text || '');
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (ch === '[') {
            const end = src.indexOf(']', i);
            if (end < 0) break;
            const inner = src.slice(i + 1, end).split(/\s+/).filter((x) => x && x !== '|');
            if (inner.length > 1) {
                out.push({ group: inner[0], tools: inner.slice(1) });
            } else if (inner.length === 1) {
                // 只有一个词 = 只有组名、没有工具，没意义；退化成单个工具（兼容老写法误用）
                out.push(inner[0]);
            }
            i = end + 1;
            continue;
        }
        if (/\s/.test(ch)) {
            i += 1;
            continue;
        }
        let j = i;
        while (j < src.length && !/[\s\[]/.test(src[j])) j += 1;
        const token = src.slice(i, j);
        if (token) out.push(token);
        i = j;
    }
    return out;
}

/** 斜杠菜单命令表 */
export default {
    name: 'MemoEditor',
    components: { EditorContent, FilePickerDialog, UploadTargetDialog, MediaPreviewOverlay, FileDetailUnified },
    props: {
        /** 笔记详情（含 id / content / version）；null = 还没选中 */
        note: { type: Object, default: null },
        instanceId: { type: String, default: '' },
        /** 工具栏行配置（来自编辑器设置） */
        toolbarConfig: { type: Array, default: () => DEFAULT_TOOLBAR_LINES },
        /**
         * v1.3.1.1：编辑器设置全集（配色 / 输入工具 / 斜杠菜单 / 历史间隔）。
         * 单独一个 prop 而不是继续摊平，是因为它整体来自「笔记设置」的同一次请求，
         * 拆成多个 prop 反而要在页面里维护多份默认值。
         */
        editorConfig: { type: Object, default: () => ({}) },
    },
    emits: ['saved', 'dirty', 'request-settings', 'open-note', 'publish-moment'],
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
            slash: { open: false, style: {}, index: 0, items: [], from: 0, to: 0, query: '', sub: null, subStyle: {} },
            bubble: { open: false, style: {}, from: null, to: null },
            /** v1.3.3：选中图片 / 视频 / 音频 / 附件时浮出的工具条 */
            mediaBar: { open: false, style: {}, kind: 'image' },
            /** v1.3.3.2：选中媒体的灯箱（复用全站 MediaPreviewOverlay） */
            lightbox: { open: false, items: [], index: 0 },
            /** v1.3.3.2：文件详情弹窗（复用全站 FileDetailUnified） */
            fileDlg: { open: false, file: null },
            /** 大纲浮窗（v1.3.1）：按需求做成悬浮弹窗，不做占位侧边栏 */
            outline: { open: false, items: [] },
            /**
             * 引用搜索（v1.3.1 · v1.5.0 计划）：
             * `[[` 搜文档、`((` 搜块。两者共用一个面板，靠 mode 区分。
             */
            ref: { open: false, mode: '', level: 'list', noteId: '', noteTitle: '', query: '', items: [], index: 0, style: {}, loading: false, replacePos: null },
            // 上传中的图片占位：避免连点多次上传把同一张图插两遍
            uploading: false,
            /** 反向链接面板（v1.5.0）：默认收起，避免把正文顶下去 */
            backlinks: [],
            backlinksOpen: false,
            /** v1.3.2：移动端软键盘是否弹起（用于收起反向链接栏） */
            kbOpen: false,
            /** 图片缩放手柄浮层（v1.4.0） */
            imgBox: { open: false, boxStyle: {}, width: 0, pos: 0, nodeW: 0 },
            /* ── v1.3.1.1：标题区元信息 + 标签 + 历史记录 ── */
            /** 上次保存时间（用于「更新时间」展示） */
            updatedAt: 0,
            /** 只数中文与英文（不含数字 / 标点 / 符号 / 表情） */
            wordCount: 0,
            tags: [],
            tagInput: '',
            tagCandidates: [],
            /** 历史记录弹窗 */
            historyVisible: false,
            historyLoading: false,
            historyItems: [],
            historyPreview: null,
            /** v1.3.2：移动端历史下拉框的当前项 */
            historySelectedId: '',
            /** 历史快照定时器（间隔来自设置，分钟） */
            historyTimer: null,
            /** 上次压历史时的正文，用来判断「真的变了」 */
            lastHistoryMd: '',
            /**
             * v1.3.1.2：历史脏标记。
             *
             * 原来 maybePushHistory() 用的是 `dirty`（正文自动保存用的那面旗），
             * 但自动保存每次写完就把 dirty 清成 false —— 历史定时器（分钟级）几乎
             * 永远看不到 dirty=true，于是「历史记录不会自动保存」。
             * 现在单独一面旗：编辑就置位，压完快照才清。
             */
            historyDirty: false,
            /** 工具栏按钮名称浮层（点击后显示 2 秒） */
            toolTip: { show: false, text: '', left: 0, top: 0 },
            /* v1.3.1.2：撤销 / 重做的内联图标（见 SVG_UNDO 注释） */
            svgUndo: SVG_UNDO,
            svgRedo: SVG_REDO,
            svgCode: SVG_CODE,
            svgBraces: SVG_BRACES,
            svgAngle: SVG_ANGLE,
            svgHtml: SVG_HTML,
            svgSelectAll: SVG_SELECT_ALL,
            /* v1.3.1.2：左侧行级栏菜单 */
            gutterMenu: { open: false, x: 0, y: 0, pos: 0, type: '' },
            /** v1.3.3.2：左侧行号栏的每一行（按块矩形算出的绝对位置） */
            gutterRows: [],
            /**
             * v1.3.4：列表项自己的折叠按钮（每个有下级的 li 一个）。
             * 与行号栏分开存：行号是「顶层块」的，这个是「任意层级 li」的。
             */
            listFoldRows: [],
            /** v1.3.3.3：折叠状态的版本号（_folds 是非响应式 Set，靠它触发 computed 重算） */
            foldsRev: 0,
            /* v1.3.1.2：引用悬停预览 */
            hoverCard: { open: false, x: 0, y: 0, title: '', text: '', loading: false },
            /* v1.3.1.2：浮层 / 右键菜单 / 表格 */
            TEXT_COLORS,
            tableBar: { open: false, above: true, style: {} },
            ctxMenu: { open: false, x: 0, y: 0, kind: 'text' },
            /** v1.3.2：桌面端每行工具栏的第一个溢出下标（li → ti） */
            toolbarOverflow: {},
            /** v1.3.2：每行被折叠的工具 id 列表 */
            toolbarOverflowTools: {},
            /** v1.3.2：回滚（滚向顶部）时，未开启吸附的栏也临时吸住 */
            reverseSticky: false,
            tablePicker: { open: false, hover: { r: 3, c: 3 } },
            /* ── v1.3.1.2：表情 / 符号面板 ── */
            insertPanelVisible: false,
            insertPanelTab: 'emoji',
            insertPanelCat: 0,
            insertPanelQuery: '',
            emojiGroups: EMOJI_GROUPS,
            symbolGroups: SYMBOL_GROUPS,
            /* ── 查找替换 ── */
            findDlg: { visible: false, find: '', replace: '', count: 0, tip: '', index: 0 },
            /** v1.3.3.3：创建子文档（pos 是发起时的光标位置） */
            subDoc: { visible: false, title: '', content: '', busy: false, pos: 0, blockStart: -1, offset: 0 },
            /* ── HTML ↔ MD 互转 ── */
            htmlDlg: { visible: false, html: '', md: '' },
            /* ── HTML 块 ── */
            htmlBlockDlg: { visible: false, html: '' },
            /** 输入工具条（光标停在空行时浮在光标上方） */
            inputBar: { open: false, style: {} },
            /** v1.3.3.3（需求）：列表 / 标题末尾的行级操作条 */
            lineBar: { open: false, kind: '', style: {}, folded: false, level: 0 },
            /** 上传面板（v1.3.1.1）：选完文件后先问目标渠道 / 实例 / 目录 */
            uploadTargetVisible: false,
            /** v1.3.2：上传目标弹窗的默认值（目录固定 /notes/memo/年/月） */
            uploadPrefill: { channelId: '', instanceId: '', uploadFolder: '' },
            uploadBusy: false,
            pendingUploadFiles: [],
            /** 'files' = 本地上传 | 'url' = 链接提取（共用同一个目标面板） */
            uploadMode: 'files',
            pendingLinkUrl: '',
            /** 8 个把手：四角 + 四边（nw / n / ne / e / se / s / sw / w） */
            imgHandles: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'],
        };
    },
    computed: {
        /**
         * H1-H6 字号与正文行高（v1.3.1.2「样式设置页」）。
         *
         * 样式表里本来就用 `var(--gh-h1-size, 1.75em)` 这套变量，这里只是把
         * 用户设置写进去 —— 所以「可视化设置」不需要改任何一条样式规则，
         * 也不存在「设置页与真实渲染两套口径」的问题。
         */
        styleVars() {
            const st = this.editorConfig?.styles || {};
            const v = (x, d) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : d);
            return {
                '--gh-h1-size': `${v(st.h1, 1.75)}em`,
                '--gh-h2-size': `${v(st.h2, 1.45)}em`,
                '--gh-h3-size': `${v(st.h3, 1.24)}em`,
                '--gh-h4-size': `${v(st.h4, 1.1)}em`,
                '--gh-h5-size': `${v(st.h5, 1)}em`,
                '--gh-h6-size': `${v(st.h6, 0.94)}em`,
                '--gh-line-height': `${v(st.lineHeight, 1.75)}`,
            };
        },
        /**
         * v1.3.3（需求）：右键菜单的渲染清单。
         * 配置过就按配置（未知 id 静默忽略），没配置按上下文用内置默认。
         */
        ctxMenuItems() {
            const kind = this.ctxMenu.kind || 'text';
            const raw = (this.editorConfig?.rightClickLines || []).join(' ').trim();
            const tokens = raw
                ? raw.split(/\s+/).filter(Boolean)
                : (CTX_DEFAULT[kind] || CTX_DEFAULT.text).slice();
            const out = [];
            let lastSep = true;
            tokens.forEach((id) => {
                if (id === '|') {
                    if (!lastSep) {
                        out.push({ sep: true });
                        lastSep = true;
                    }
                    return;
                }
                const meta = CTX_ACTIONS[id];
                if (meta) {
                    if (!(meta.kinds || []).includes(kind)) return;
                    out.push({ id, ...meta });
                    lastSep = false;
                    return;
                }
                const tool = TOOLS[id];
                if (tool) {
                    out.push({ id, icon: tool.icon, svgKey: tool.svgKey || '', glyph: tool.glyph || '', label: tool.label, tool: true });
                    lastSep = false;
                }
            });
            while (out.length && out[out.length - 1].sep) out.pop();
            return out;
        },
        /**
         * v1.3.3（需求）：媒体选中条的工具清单。
         * 按 kind 取对应配置（selectImageLines / selectVideoLines / …），空则用默认。
         */
        mediaTools() {
            /*
             * v1.3.4（需求）：媒体选中条不再读「设置 → 选中图片/视频/音频/文件工具配置」，
             * 统一用内置默认。四个配置项已从设置页移除 —— 留着读取逻辑只会让人以为
             * 改了配置还有用。
             */
            const kind = this.mediaBar.kind || 'image';
            const tokens = (MEDIA_DEFAULT[kind] || MEDIA_DEFAULT.file).slice();
            const out = [];
            let lastSep = true;
            tokens.forEach((id) => {
                if (id === '|') {
                    if (!lastSep) {
                        out.push({ sep: true });
                        lastSep = true;
                    }
                    return;
                }
                const tool = TOOLS[id];
                if (!tool) return;
                /*
                 * v1.3.4.1（需求）：宽度 / 高度下拉，选项 10% / 20% / 40% / 60% / 80% / 90% / 100%，
                 * 百分比相对编辑区宽 / 高换算成像素。
                 */
                if (id === 'sizeWidth' || id === 'sizeHeight') {
                    out.push({
                        id,
                        icon: tool.icon,
                        label: tool.label,
                        dropdown: [10, 20, 40, 60, 80, 90, 100],
                        tool: true,
                    });
                    lastSep = false;
                    return;
                }
                out.push({
                    id,
                    icon: tool.icon,
                    svgKey: tool.svgKey || '',
                    glyph: tool.glyph || '',
                    label: tool.label,
                    tool: true,
                });
                lastSep = false;
            });
            while (out.length && out[out.length - 1].sep) out.pop();
            return out;
        },
        /**
         * v1.3.3（需求）：选中浮层的渲染清单。
         * 保留名：heading / align / fontSize / textColor / annotate / publish；
         * 其余按 TOOLS 里的工具 id 渲染（未知 id 静默忽略）。
         */
        selItems() {
            const raw = (this.editorConfig?.selectionLines || []).join(' ').trim();
            const tokens = raw ? splitToolTokens(raw) : SEL_DEFAULT.slice();
            const out = [];
            let lastSep = true;
            tokens.forEach((id) => {
                if (id === '|') {
                    if (!lastSep) {
                        out.push({ sep: true });
                        lastSep = true;
                    }
                    return;
                }
                const group = parseGroupToken(id);
                if (group) {
                    out.push({ group: true, name: group.name, items: group.items });
                    lastSep = false;
                    return;
                }
                if (SEL_RESERVED.includes(id)) {
                    out.push({ id });
                    lastSep = false;
                    return;
                }
                const tool = TOOLS[id];
                if (tool) {
                    out.push({ id, icon: tool.icon, svgKey: tool.svgKey || '', glyph: tool.glyph || '', label: tool.label, tool: true });
                    lastSep = false;
                }
            });
            while (out.length && out[out.length - 1].sep) out.pop();
            return out;
        },
        /** v1.3.4.1：引用面板标题（块引用两级各显示不同文案） */
        refHeadText() {
            if (this.ref.mode === 'note') return this.$t('memo.refNote');
            if (this.ref.level === 'blocks') return this.ref.noteTitle || this.$t('memo.currentNote');
            return `${this.$t('memo.refBlock')} · ${this.$t('memo.pickNote')}`;
        },
        /** v1.3.2：模式下拉框上显示的文字 */
        modeLabel() {
            if (this.mode === 'source') return this.$t('memo.modeSource');
            if (this.mode === 'preview') return this.$t('memo.modePreview');
            return this.$t('memo.modeLive');
        },
        /**
         * v1.3.4（需求）：是否有悬浮菜单开着。
         *
         * 工具栏 / 标题栏 / 反向链接需要在这些时候临时抬到浮层之上
         * （否则 h 标题菜单、列表菜单、选中菜单会盖住它们）。
         * 只在需要时抬，平时保持普通层级 —— 不影响 Element Plus 的弹窗层。
         */
        anyFloatOpen() {
            return !!(
                this.bubble.open ||
                this.mediaBar.open ||
                this.slash.open ||
                this.ref.open ||
                this.lineBar.open ||
                this.inputBar.open ||
                this.gutterMenu.open ||
                this.tableBar.open ||
                this.ctxMenu.open
            );
        },
        /**
         * 当前生效的吸附配置（按终端取 pc / m 那一组）。
         *
         * v1.3.3.2（需求）：移除「辅助栏」吸附 —— 版本/时间/字数那一行不再参与吸附，
         * 只剩工具栏与标题栏两个开关。
         */
        /**
         * v1.3.3.3（需求）：是否已经「全部折叠」。
         * 判据不是「有任意折叠」—— 手动折了一节也算有；必须是所有标题都在折叠集合里，
         * 这时工具栏按钮才应该变成「展开全部」（向下箭头）。
         */
        foldAllActive() {
            /*
             * _folds 是个 Set（非响应式），改它不会让 computed 重算 ——
             * 先读一下 foldsRev 这个计数器，把依赖挂上去。
             */
            void this.foldsRev;
            const set = this._folds;
            if (!set || !set.size) return false;
            const ed = this.editor;
            if (!ed) return false;
            let total = 0;
            let folded = 0;
            ed.state.doc.forEach((node, offset) => {
                if (node.type.name !== 'heading') return;
                total += 1;
                if (set.has(offset)) folded += 1;
            });
            return total > 0 && folded === total;
        },
        stickyCfg() {
            const all = this.editorConfig?.sticky;
            const key = this.isMobileViewport ? 'm' : 'pc';
            const one = (all && all[key]) || {};
            return {
                toolbar: one.toolbar === true,
                title: one.title === true,
            };
        },
        /** 触屏设备（与瞬间发布页同一判据：三项取或） */
        isTouchDevice() {
            if (typeof window === 'undefined') return false;
            const mq = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
            return (navigator.maxTouchPoints || 0) > 0 || mq('(hover: none)') || mq('(pointer: coarse)');
        },
        /**
         * v1.3.3.1（实测修复）：把「布局口径」和「交互口径」拆开。
         *
         * 原来只有 isMobileViewport，且判定里含「是否触摸」：
         *   · 触摸屏笔记本（maxTouchPoints > 0，但用鼠标）会被当成移动端；
         *   · 无指针设备的环境（headless / 部分远程桌面）`(pointer: coarse)` 命中，
         *     1280px 宽也被判成移动端。
         * 结果就是工具栏永不折叠、历史弹窗永远走移动端布局。
         *
         * 现在：
         *   · isMobileViewport = **只看宽度**（布局用：折叠、弹窗分栏、吸附取 pc/m）
         *   · isTouchUi       = 是否触摸（交互用：工具组 hover/click、长按）
         */
        isMobileViewport() {
            return typeof window !== 'undefined' && window.innerWidth <= 900;
        },
        isTouchUi() {
            return typeof this.isTouchDevice === 'function' ? this.isTouchDevice() : !!this.isTouchDevice;
        },
        /** 生效的配色：light / dark；auto 时跟随 html 上的 dark 类（全站主题） */
        editorTheme() {
            const t = String(this.editorConfig?.theme || 'auto');
            if (t === 'light' || t === 'dark') return t;
            const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
            return dark ? 'dark' : 'light';
        },
        /** 历史预览渲染（走同一套 marked + DOMPurify） */
        renderHistoryPreview() {
            return renderMarkdownSafe(String(this.historyPreview?.content || ''));
        },
        /** 更新时间文案（没保存过就不显示具体时间） */
        updatedText() {
            if (!this.updatedAt) return '—';
            const d = new Date(Number(this.updatedAt));
            if (!Number.isFinite(d.getTime())) return '—';
            const pad = (n) => String(n).padStart(2, '0');
            const now = new Date();
            const sameDay = d.toDateString() === now.toDateString();
            const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
            return sameDay ? hm : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
        },
        /**
         * 工具栏行解析（v1.3.1.1）。
         *
         * 支持三件事：
         *   1) 行首 `pc=` / `m=` —— 该行只在桌面端 / 移动端出现（不写 = 两端都出现）；
         *   2) `[a b c]` 工具组 —— 渲染成一个下拉按钮，点开是组内工具；
         *   3) `|` 分隔线，行为不变。
         * 解析结果里 group 是一个数组，模板按 token 是字符串还是数组分别渲染。
         */
        toolbarLines() {
            const cfg = Array.isArray(this.toolbarConfig) && this.toolbarConfig.length ? this.toolbarConfig : DEFAULT_TOOLBAR_LINES;
            const device = this.isMobileViewport ? 'm' : 'pc';
            const out = [];
            for (const raw of cfg) {
                const { scope, text } = splitScope(String(raw || ''));
                if (scope && scope !== device) continue;
                const tokens = parseToolTokens(text);
                if (tokens.length) out.push(tokens);
            }
            return out;
        },
        /** 输入工具：光标在空行时展示的按钮（同样支持 pc=/m= 与工具组） */
        inputTools() {
            const lines = Array.isArray(this.editorConfig?.inputLines) ? this.editorConfig.inputLines : [];
            if (!lines.length) return [];
            const device = this.isMobileViewport ? 'm' : 'pc';
            const out = [];
            for (const raw of lines) {
                const { scope, text } = splitScope(String(raw || ''));
                if (scope && scope !== device) continue;
                for (const t of parseToolTokens(text)) {
                    // v1.3.1.2：光标栏同样支持 [组名 a b] 工具组
                    if (this.isGroupToken(t)) {
                        const tools = this.groupTools(t);
                        if (tools.length) out.push({ group: t.group, tools });
                        continue;
                    }
                    if (typeof t === 'string' && t !== '|' && this.toolsOf(t)) out.push(t);
                }
            }
            return out;
        },
        /** `/` 菜单数据源：配置了就用配置（支持 |），没配置用内置表 */
        slashSource() {
            const lines = Array.isArray(this.editorConfig?.slashLines) ? this.editorConfig.slashLines : [];
            if (!lines.length) return SLASH_COMMANDS;
            const device = this.isMobileViewport ? 'm' : 'pc';
            const out = [];
            for (const raw of lines) {
                const { scope, text } = splitScope(String(raw || ''));
                if (scope && scope !== device) continue;
                for (const token of parseToolTokens(text)) {
                    if (token === '|') {
                        out.push({ id: '__sep__', separator: true });
                        continue;
                    }
                    if (token && typeof token === 'object' && Array.isArray(token.tools)) {
                        const tools = token.tools.map((id) => SLASH_COMMANDS.find((c) => c.id === id)).filter(Boolean);
                        if (tools.length) {
                            out.push({
                                id: `__group__:${token.group}`,
                                group: true,
                                label: token.group,
                                groupName: token.group,
                                tools,
                            });
                        }
                        continue;
                    }
                    const cmd = SLASH_COMMANDS.find((c) => c.id === token);
                    if (cmd) out.push(cmd);
                }
            }
            // 一条有效命令都没有（比如全写错了）就回退内置表，别让菜单空着
            return out.some((c) => !c.separator) ? out : SLASH_COMMANDS;
        },
    },
    watch: {
        note: {
            immediate: true,
            handler(note) {
                this.applyNote(note);
                this.loadBacklinks();
                this.loadNoteTags();
            },
        },
        mode(next, prev) {
            this.switchMode(prev, next);
        },
        /* v1.3.2：工具配置变了要重新量一次溢出（宽度不变，但按钮数量变了） */
        toolbarLines: {
            deep: true,
            handler() {
                this.$nextTick(() => this.measureToolbar());
            },
        },
        'editorConfig.styles.customCss': {
            handler() {
                this.applyCustomCss();
            },
        },
    },
    mounted() {
        this.createEditor();
        this.applyCustomCss();
        this.$nextTick(() => {
            this.measureToolbar();
            /*
             * v1.3.3.2：首帧渲染完成后排版号栏（之后由 update / 滚动 / resize 触发）。
             * 这里连补两帧：首帧时编辑器刚挂载、部分块的布局还没算出来，
             * 只量一次会得到「一行行号都没有」的空结果（实测踩到）。
             */
            this.syncGutter();
            requestAnimationFrame(() => this.syncGutter());
            // 媒体（图片 / 视频）加载完成后块高会变，用观察器兜住这次位移
            this.setupGutterObserver();
            /*
             * v1.3.3.1（实测修复）：只靠 window resize 触发不够 ——
             * 目录栏拖宽、列表折叠、编辑器首帧布局完成都不会派发 resize，
             * 工具栏实际已经溢出但永远不会折叠。直接观察工具栏自身尺寸。
             */
            this.setupToolbarObserver();
        });
        // Ctrl/Cmd + S 保存（浏览器默认的「保存网页」在这里没有意义）
        this.onKeydownGlobal = (e) => {
            // v1.3.2（需求）：Esc 收起所有编辑区浮层
            if (String(e.key) === 'Escape') {
                this.closeRef();
                this.closeSlash();
                this.closeCtxMenu();
                this.bubble.open = false;
                this.tableBar.open = false;
                this.gutterMenu = { open: false };
                this.lineBar = { open: false, kind: '', style: {}, folded: false, level: 0 };
                return;
            }
            if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
                e.preventDefault();
                this.saveNow();
            }
        };
        window.addEventListener('keydown', this.onKeydownGlobal);
        // 点空白 / 按 Esc 都要收起右键菜单
        this.onGlobalPointer = (e) => {
            const el = e.target;
            const hit = (sel) => !!(el && el.closest && el.closest(sel));
            if (this.ctxMenu.open && !hit('.me-ctx')) this.closeCtxMenu();
            /*
             * v1.3.2（需求）：点别处要收起 gutter 菜单 / `/` 菜单 / `[[` 面板。
             * 点到 gutter 按钮本身时不算「别处」—— 它的 click 才负责开关。
             */
            if (this.gutterMenu.open && !hit('.me-gutter-menu') && !hit('.me-gutter-no') && !hit('.me-gutter-fold')) this.closeGutter();
            if (!hit('.me-slash') && !hit('.me-slash-sub') && !hit('.me-wysiwyg')) {
                if (this.ref.open) this.closeRef();
                if (this.slash.open) this.closeSlash();
            }
            /*
             * v1.3.3.2：选中浮层 / 媒体工具条的关闭条件。
             *
             * 之前靠编辑器 onBlur 关，结果移动端点浮层里的下拉框就失焦 → 浮层消失。
             * 现在改成「点到浮层、编辑器、下拉浮层之外」才关：
             * 点在浮层自己的按钮 / 下拉菜单里一律不动，键盘收起也不动。
             */
            const inFloatUi =
                hit('.me-wysiwyg') || hit('.me-bubble') || hit('.me-mediabar') || hit('.me-inputbar') ||
                hit('.el-popper') || hit('.el-dropdown') || hit('.me-toolbar-wrap') || hit('.me-title-row') ||
                hit('.me-meta') || hit('.me-tags');
            if (!inFloatUi) {
                if (this.bubble.open) this.bubble.open = false;
                if (this.mediaBar.open) this.mediaBar = { open: false, style: {}, kind: 'image' };
            }
        };
        window.addEventListener('pointerdown', this.onGlobalPointer, true);
        /*
         * 引用悬停预览（v1.3.1.2）：
         * 鼠标停在 `[[note:…]]` / `((blk_…))` 上 350ms 后浮出一张小卡，
         * 显示源笔记标题与摘要 / 源块内容。移开就收，点一下仍然走原来的跳转。
         */
        this.onHoverStart = (e) => {
            const el = e.target && e.target.closest && e.target.closest('.gh-noteref, .gh-blockref');
            if (!el) return;
            clearTimeout(this._hoverTimer);
            const rect = el.getBoundingClientRect();
            this._hoverTimer = setTimeout(() => this.loadHoverCard(el, rect), 350);
        };
        this.onHoverEnd = (e) => {
            const el = e.target && e.target.closest && e.target.closest('.gh-noteref, .gh-blockref');
            if (!el) return;
            clearTimeout(this._hoverTimer);
            if (this.hoverCard.open) this.hoverCard = { ...this.hoverCard, open: false };
        };
        const body = this.$refs.bodyEl;
        if (body) {
            body.addEventListener('mouseover', this.onHoverStart);
            body.addEventListener('mouseout', this.onHoverEnd);
            // v1.3.3：嵌入块里的齿轮 → 弹设置
            this.onIframeConfig = (e) => {
                const wrap = e.target && e.target.closest && e.target.closest('.gh-iframe-wrap');
                if (wrap) this.editIframe(wrap);
            };
            body.addEventListener('gohub:iframe-config', this.onIframeConfig);
            /*
             * v1.3.4：HTML 块标题行的「编辑」按钮。
             * NodeView 在模块作用域拿不到组件实例，靠自定义事件冒泡上来，
             * 再用 posAtDOM 反查节点位置（与 iframe 设置同一套做法）。
             */
            this.onHtmlEdit = (e) => {
                const wrap = e.target && e.target.closest && e.target.closest('.gh-html-block-wrap');
                if (!wrap || !this.editor) return;
                let pos = -1;
                try {
                    pos = this.editor.view.posAtDOM(wrap, 0);
                } catch (err) {
                    pos = -1;
                }
                // posAtDOM 在不同结构下可能给到「节点前」或「节点内」，两种都试一下
                if (pos >= 0) {
                    const n = this.editor.state.doc.nodeAt(pos);
                    if (!n || n.type.name !== 'htmlBlock') {
                        const before = this.editor.state.doc.nodeAt(pos - 1);
                        if (before && before.type.name === 'htmlBlock') pos -= 1;
                    }
                }
                if (pos >= 0) this.openHtmlBlock(pos);
            };
            body.addEventListener('gohub:html-edit', this.onHtmlEdit);
            /*
             * v1.3.4.2（需求）：块引用内容框的「编辑」改为「更换引用块」。
             * NodeView 拿不到组件实例，事件冒泡上来后再用 posAtDOM 反查位置
             * （与 onHtmlEdit 一致，节点前 / 节点内两种偏移都试）。
             */
            this.onBlockRefChange = (e) => {
                const card = e.target && e.target.closest && e.target.closest('.gh-blockref-card');
                if (!card || !this.editor) return;
                let pos = -1;
                try {
                    pos = this.editor.view.posAtDOM(card, 0);
                } catch (err) {
                    return;
                }
                let node = this.editor.state.doc.nodeAt(pos);
                if (!node || node.type.name !== 'blockRef') {
                    const before = this.editor.state.doc.nodeAt(pos - 1);
                    if (before && before.type.name === 'blockRef') {
                        pos -= 1;
                        node = before;
                    }
                }
                if (!node || node.type.name !== 'blockRef') return;
                this.openBlockRefPicker(pos);
            };
            body.addEventListener('gohub:blockref-change', this.onBlockRefChange);
            // v1.3.3.2：媒体节点被选中后的统一同步口（见 mediaSelectOnClick 注释）
            this.onMediaSelectPing = () => this.$nextTick(() => this.onSelectionChange());
            body.addEventListener('gohub:media-select', this.onMediaSelectPing);
            /*
             * v1.3.4.1（需求：移动端块代码按回车不换行）
             * 软键盘的 Enter 往往只派发 beforeinput（insertLineBreak / insertParagraph），
             * 不派发 keydown，Tiptap 的代码块因此收不到这次换行。
             * 触摸设备上在 codeBlock 内补一刀，手动插入 \n。
             */
            this.onCodeBeforeInput = (e) => {
                if (!this.isTouchUi) return;
                if (!e || (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph')) return;
                if (!this.editor || !this.editor.isActive('codeBlock')) return;
                e.preventDefault();
                this.editor.chain().focus().insertContent('\n').run();
                this.onEditorUpdate();
            };
            body.addEventListener('beforeinput', this.onCodeBeforeInput, true);
            /*
             * v1.3.4.2（需求：勾选上级任务时，下级任务列表也要一起勾选）
             *
             * Tiptap 的 TaskItem 只改它自己的 checked，不会向下联动。
             * 这里在 change 冒泡后（Tiptap 已把当前项写好）收集该 taskItem 的
             * 所有后代 taskItem，统一写成同一个 checked 值。
             */
            this.onTaskCheck = (e) => {
                const input = e.target;
                if (!input || input.type !== 'checkbox' || this._taskSync) return;
                const li = input.closest && input.closest('li[data-checked]');
                if (!li || !this.editor) return;
                const checked = !!input.checked;
                let pos = -1;
                try {
                    pos = this.editor.view.posAtDOM(li, 0);
                } catch (err) {
                    return;
                }
                let node = this.editor.state.doc.nodeAt(pos);
                if (!node || node.type.name !== 'taskItem') {
                    const before = this.editor.state.doc.nodeAt(pos - 1);
                    if (before && before.type.name === 'taskItem') {
                        pos -= 1;
                        node = before;
                    }
                }
                if (!node || node.type.name !== 'taskItem') return;
                const targets = [];
                node.descendants((child, rel) => {
                    if (child.type.name === 'taskItem') targets.push(pos + 1 + rel);
                });
                if (!targets.length) return;
                const tr = this.editor.state.tr;
                let changed = false;
                for (const at of targets) {
                    const n = tr.doc.nodeAt(at);
                    if (!n || n.type.name !== 'taskItem') continue;
                    if (!!n.attrs.checked === checked) continue;
                    tr.setNodeMarkup(at, undefined, { ...n.attrs, checked });
                    changed = true;
                }
                if (!changed) return;
                this._taskSync = true;
                this.editor.view.dispatch(tr);
                this._taskSync = false;
                this.onEditorUpdate();
            };
            body.addEventListener('change', this.onTaskCheck);
        }
        /*
         * 手柄与光标工具栏都用绝对/固定坐标，滚动或改窗口大小都得重算位置。
         * v1.3.1.2：光标工具栏也要跟着光标所在行滚 —— 否则页面滚了它却钉在原地，
         * 看起来像一条与正文无关的浮条。scroll 不冒泡，但捕获阶段能收到，
         * 所以一个 window 级 capture 监听就覆盖了编辑器内部容器的滚动。
         */
        this.onViewportChange = (e) => {
            this.syncImgBox();
            this.updateInputBar();
            // v1.3.3.2：滚动 / 改窗口大小都要让浮层跟着内容走（需求）
            if (e && (e.type === 'scroll' || e.type === 'resize')) {
                this.repositionFloats();
                this.scheduleGutter();
            }
            /*
             * v1.3.2（需求）：移动端键盘弹出时把「反向链接」栏收起来，
             * 键盘收起再显示。用可见视口高度相对历史最大值的跌幅判断，
             * 比监听 focus 可靠（部分浏览器焦点在 ProseMirror 内部节点上）。
             */
            if (this.isMobileViewport && typeof window !== 'undefined') {
                const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
                if (!this._maxVh || vh > this._maxVh) this._maxVh = vh;
                const nextKb = vh > 0 && vh < this._maxVh * 0.75;
                if (this.kbOpen !== nextKb) this.kbOpen = nextKb;
            }
            // v1.3.2：窗口宽度变了要重新算工具栏溢出（滚动事件不重算，太频繁）
            if (e && e.type === 'resize') {
                /*
                 * v1.3.3.3（实测修复）：上一版这里混进了「断开工具栏观察器」的一段代码 ——
                 * 每次窗口 resize 都会把 ResizeObserver 断掉且不再重建，
                 * 于是改一次窗口大小以后工具栏就再也不折叠了。
                 * 这里只保留「防抖重量一次」，观察器本身在 setupToolbarObserver 里维护。
                 */
                clearTimeout(this._tbMeasureTimer);
                this._tbMeasureTimer = setTimeout(() => this.measureToolbar(), 200);
            }
        };
        window.addEventListener('resize', this.onViewportChange);
        window.addEventListener('scroll', this.onViewportChange, true);
    },
    beforeUnmount() {
        window.removeEventListener('keydown', this.onKeydownGlobal);
        if (this.onGlobalPointer) window.removeEventListener('pointerdown', this.onGlobalPointer, true);
        clearTimeout(this._hoverTimer);
        const body = this.$refs.bodyEl;
        if (body && this.onHoverStart) {
            body.removeEventListener('mouseover', this.onHoverStart);
            body.removeEventListener('mouseout', this.onHoverEnd);
            if (this.onMediaSelectPing) body.removeEventListener('gohub:media-select', this.onMediaSelectPing);
            if (this.onCodeBeforeInput) body.removeEventListener('beforeinput', this.onCodeBeforeInput, true);
            if (this.onBlockRefChange) body.removeEventListener('gohub:blockref-change', this.onBlockRefChange);
            if (this.onTaskCheck) body.removeEventListener('change', this.onTaskCheck);
        }
        window.removeEventListener('resize', this.onViewportChange);
        window.removeEventListener('scroll', this.onViewportChange, true);
        if (this._gutterRaf) cancelAnimationFrame(this._gutterRaf);
        this._gutterRaf = null;
        /*
         * v1.3.4：折叠用的样式表挂在 document.head，是全局的。
         * 离开编辑器（切笔记 / 离开页面）必须清空，否则下一条笔记会被上一轮的
         * nth-child 规则误伤（表现为「打开另一篇，某几段直接不见了」）。
         */
        if (this._foldStyleEl) {
            this._foldStyleEl.textContent = '';
            this._foldStyleEl = null;
        }
        if (this._listFoldStyleEl) {
            this._listFoldStyleEl.textContent = '';
            this._listFoldStyleEl = null;
        }
        if (this._gutterRO) {
            this._gutterRO.disconnect();
            this._gutterRO = null;
        }
        const _body = this.$refs.bodyEl;
        if (_body && this._gutterLoad) {
            _body.removeEventListener('load', this._gutterLoad, true);
            _body.removeEventListener('loadedmetadata', this._gutterLoad, true);
            this._gutterLoad = null;
        }
        if (this.saveTimer) clearTimeout(this.saveTimer);
        if (this._cssEl && this._cssEl.parentNode) this._cssEl.parentNode.removeChild(this._cssEl);
        this._cssEl = null;
        if (this._foldStyleEl && this._foldStyleEl.parentNode) this._foldStyleEl.parentNode.removeChild(this._foldStyleEl);
        this._foldStyleEl = null;
        clearTimeout(this._tbMeasureTimer);
        if (this._tagBlurTimer) clearTimeout(this._tagBlurTimer);
        this.stopHistoryTimer();
        if (this._tagTimer) clearTimeout(this._tagTimer);
        if (this._tipTimer) clearTimeout(this._tipTimer);
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
        /**
         * v1.3.2 / v1.3.3：把设置里的自定义 CSS 限定在正文区内。
         *
         * v1.3.3 修过一次特异性：scoped 样式编译成 `.me-wysiwyg[data-v] .gh-editor-content h1`（0,3,1），
         * 注入的全局规则只有（0,2,1），永远打不过内置样式。前缀加 #app 提到（1,3,1）。
         *
         * 注意：这是**方法**，不是 computed —— 之前误放进 computed，
         * 结果 `this.applyCustomCss()` 直接抛 "is not a function"，设置页保存后整块逻辑断在这里。
         */
        applyCustomCss() {
            const raw = String(this.editorConfig?.styles?.customCss || '').trim();
            if (!this._cssEl) {
                this._cssEl = document.createElement('style');
                this._cssEl.setAttribute('data-memo-custom', '1');
                document.head.appendChild(this._cssEl);
            }
            if (!raw) {
                this._cssEl.textContent = '';
                return;
            }
            /*
             * 只给「普通选择器」加作用域前缀；@media / @supports 这类块原样保留 ——
             * 它们内部的规则由用户自己保证不越界（设置页的提示里也写了）。
             */
            /*
             * v1.3.3（需求：设置里的标题/正文样式不生效）
             *
             * 根因是**特异性**：本组件的样式是 scoped，编译后变成
             * `.me-wysiwyg[data-v-xxx] .gh-editor-content h1`（0,3,1）；
             * 而注入的全局规则只有 `.me-wysiwyg .gh-editor-content h1`（0,2,1），
             * 永远打不过内置规则，看起来就是「设置了没反应」。
             * 前面加一个 #app（id 选择器，1,3,1）稳定压过 scoped 规则。
             */
            const scope = '#app .me-wysiwyg .gh-editor-content';
            const scoped = String(raw).replace(/(^|})\s*([^{}@]+)\{/g, (m, pre, sel) => {
                const list = String(sel)
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .map((x) => `${scope} ${x}`)
                    .join(', ');
                return `${pre} ${list} {`;
            });
            this._cssEl.textContent = scoped;
        },

        // ---------------- 初始化 ----------------

        createEditor() {
            // 折叠位置集合：普通 Set（不给 Vue 代理，插件每帧读它）
            this._folds = new Set();
            // v1.3.4：列表项折叠（key = :nth-child 路径），与标题折叠分开两套
            this._listFolds = new Set();
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
                        // v1.3.3.3：代码块改用自定义 NodeView（见 CodeBlockView）
                        codeBlock: false,
                    }),
                    CodeBlockView.configure({ HTMLAttributes: { class: 'gh-code-block' } }),
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
                    // v1.3.1.2：HTML 块 / 网页嵌入 / 字号 / 颜色
                    HtmlBlock,
                    IframeBlock,
                    FontSize,
                    TextColor,
                    // v1.3.1.2：左侧行级栏（点开块操作菜单）
                    // v1.3.3.2：改为覆盖层定位（syncGutter），不再往文档里插 widget
                    // v1.3.1.1：段落 / 标题对齐（align 属性版）
                    BlockAlign,
                    // v1.5.0 引用类行内原子节点
                    NoteRef,
                    NoteEmbed,
                    BlockRef,
                ],
                content: this.docOf(this.note?.content || ''),
                editorProps: {
                    attributes: { class: 'gh-editor-content' },
                    handleKeyDown: (view, event) => this.onEditorKeyDown(view, event),
                    handleClick: (view, pos, event) => this.onEditorClick(view, pos, event),
                    handleTextInput: (view, from, to, text) => this.onEditorTextInput(view, from, to, text),
                    handlePaste: (view, event) => this.onEditorPaste(view, event),
                    handleDrop: (view, event) => this.onEditorDrop(view, event),
                },
                onUpdate: () => this.onEditorUpdate(),
                onSelectionUpdate: () => this.onSelectionChange(),
                /*
                 * v1.3.3.2（需求：移动端点开字号 / 颜色下拉框后，键盘收起下拉框也没了）
                 *
                 * 根因就是这一行：移动端点下拉按钮 → 编辑器失焦 → onBlur 立刻把
                 * 选中浮层收掉，挂在浮层上的 el-dropdown 自然跟着消失，
                 * 于是「字号 / 颜色」在手机上永远点不到第二层。
                 * 现在浮层只由「选区变化」和「点到浮层与编辑器之外」来关，
                 * 失焦不再等于收起 —— 键盘收起也不再误伤。
                 */
                onBlur: () => {},
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
            /*
             * v1.3.4：换篇时清空折叠状态。
             * 折叠是按「文档位置 / nth-child 路径」记的，换一篇后这些位置全是别人的，
             * 不清就会出现「打开新笔记，某些段落凭空消失」。
             */
            if (id !== this._noteId) {
                this._noteId = id;
                if (this._folds) this._folds.clear();
                if (this._listFolds) this._listFolds.clear();
                if (this._foldStyleEl) this._foldStyleEl.textContent = '';
                this.applyListFoldCss();
                this.foldsRev = (this.foldsRev || 0) + 1;
            }
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
            this.charCount = this.countChars(md);
            this.updatedAt = Number(note.updatedAt) || 0;
            this.updateWordCount(md);
            // 换篇时重置历史节流「上次快照」，否则新篇第一分钟不会记历史
            this.lastHistoryMd = md;
            this.startHistoryTimer();
            this.dirty = false;
            if (this.editor) this.editor.commands.setContent(this.docOf(md), { emitUpdate: false });
            if (this.sourceView) this.sourceView.dispatch({ changes: { from: 0, to: this.sourceView.state.doc.length, insert: md } });
            // v1.3.3.2：换篇后行号栏要按新内容重排（否则还停在上一篇的行数上）
            this.$nextTick(() => {
                this.syncGutter();
                requestAnimationFrame(() => this.syncGutter());
            });
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
            this.lineBar = { open: false, kind: '', style: {}, folded: false, level: 0 };
            if (next === this.mode) return;
            this.mode = next;
            // v1.3.3.2：行号栏只在实时模式存在；切换后要重算（切回来时 DOM 刚重建）
            this.$nextTick(() => this.syncGutter());
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
            this.charCount = this.countChars(md);
            this.markDirty();
        },

        /**
         * v1.3.3.2（实测修复）：刚打开的笔记，第一次直接点图片 / 视频 / 附件选不中。
         *
         * 原因：ProseMirror 的「点原子节点 → NodeSelection」只在 view 已有焦点时执行
         * （`handleClick` 里第一句就是 `if (!view.hasFocus()) return`）。用户从列表点进笔记、
         * 第一下就点图片时，编辑器还没有焦点，这一下只是「获得焦点」，选区仍是折叠光标，
         * 于是没有任何选中反馈 —— 要再点一次才行。
         *
         * 做法：点在媒体节点上时，先让 ProseMirror 走完它自己的 click 流程，再在下一个
         * 微任务里把选区改成该节点的 NodeSelection。之所以「延后一步」而不是直接返回 true
         * 拦下：PM 在 click 之后还会做一次选区同步，直接拦会被覆盖回折叠光标（实测）。
         *
         * 两个例外必须放过，否则会抢走原生交互：
         *   · 视频 / 音频底部的控制条 —— 那是播放 / 进度条，点了要能播；
         *   · 附件的 Ctrl / Cmd + 点击 —— 那是「在新标签打开」。
         */
        onEditorClick(view, pos, event) {
            const t = event && event.target;
            const el = t && t.closest ? t.closest('img, video, audio, a.gh-file') : null;
            if (!el) return false;
            if (el.tagName === 'A' && (event.ctrlKey || event.metaKey)) return false;
            if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
                const r = el.getBoundingClientRect();
                const zone = Math.min(56, r.height * 0.35);
                if (event.clientY > r.bottom - zone) return false;
            }
            /*
             * 延后一步再设选区：ProseMirror 在 click 之后还会做一次选区同步，
             * 直接在这里 dispatch 会被覆盖回折叠光标（实测）。
             */
            setTimeout(() => {
                const ed = this.editor;
                if (!ed) return;
                const v = ed.view;
                const at = selectMediaNode(v, el, event);
                if (at < 0) return;
                try {
                    v.dom.dispatchEvent(new CustomEvent('gohub:media-select', { bubbles: true }));
                } catch (e) {
                    /* 忽略 */
                }
            }, 0);
            return false;
        },

        onEditorUpdate() {
            const md = this.currentMd();
            this.lastMd = md;
            this.charCount = this.countChars(md);
            this.updateWordCount(md);
            // v1.3.1.2：内容变了就记一笔，历史定时器据此决定要不要压快照
            this.historyDirty = true;
            this.updateSlash();
            this.updateRef();
            this.updateInputBar();
            /*
             * 编辑即展开全部折叠。
             * 折叠状态存的是文档位置（pos），编辑后位置全变 —— 不清理就会出现
             * 「明明没折叠，内容却看不见」。折叠只服务阅读，不参与编辑。
             */
            if (this._folds && this._folds.size) {
                this._folds.clear();
            }
            // v1.3.3.2：块变了，行号栏要跟着重排
            this.scheduleGutter();
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

        // ---------------- 标签（v1.3.1.1） ----------------

        async loadNoteTags() {
            const id = this.note?.id;
            if (!id) {
                this.tags = [];
                return;
            }
            try {
                const r = await fetchNoteTags(id);
                this.tags = Array.isArray(r?.tags) ? r.tags : [];
            } catch (e) {
                this.tags = [];
            }
        },
        /** 输入即查候选（与瞬间发布页同一套交互：只管当前输入词，不做全量拉取） */
        onTagInput() {
            if (this._tagTimer) clearTimeout(this._tagTimer);
            this._tagTimer = setTimeout(() => this.loadTagCandidates(), 200);
        },
        async loadTagCandidates() {
            const kw = String(this.tagInput || '').trim();
            try {
                const r = await fetchTagCandidates(kw);
                const list = Array.isArray(r?.tags) ? r.tags : [];
                // 已选中的不再出现在候选里
                this.tagCandidates = list.filter((c) => !this.tags.some((t) => t.name === c.name));
            } catch (e) {
                this.tagCandidates = [];
            }
        },
        /** 空格 / 回车都算确认；空串忽略；重复忽略 */
        /** v1.3.2（需求）：标签输入框失焦后收起候选下拉 */
        onTagBlur() {
            if (this._tagBlurTimer) clearTimeout(this._tagBlurTimer);
            this._tagBlurTimer = setTimeout(() => {
                this.tagCandidates = [];
                this._tagBlurTimer = null;
            }, 120);
        },
        commitTag() {
            const name = String(this.tagInput || '').trim().replace(/\s+/g, ' ').slice(0, 20);
            this.tagInput = '';
            this.tagCandidates = [];
            if (!name) return;
            if (this.tags.some((t) => t.name === name)) return;
            if (this.tags.length >= 20) return;
            this.tags = [...this.tags, { id: '', name }];
            this.saveTags();
        },
        pickTag(name) {
            this.tagInput = name;
            this.commitTag();
        },
        removeTag(index) {
            this.tags = this.tags.filter((_, i) => i !== index);
            this.saveTags();
        },
        /** 输入框为空时按退格删掉最后一个标签（常见交互，省一次点小叉） */
        onTagBackspace() {
            if (String(this.tagInput || '').length) return;
            if (!this.tags.length) return;
            this.removeTag(this.tags.length - 1);
        },
        async saveTags() {
            const id = this.note?.id;
            if (!id) return;
            try {
                const r = await saveNoteTags(id, this.tags.map((t) => t.name));
                this.tags = Array.isArray(r?.tags) ? r.tags : this.tags;
            } catch (e) {
                ElMessage.error(this.$t('memo.saveFail'));
            }
        },

        // ---------------- 历史记录（v1.3.1.1） ----------------

        formatHistoryTime(ts) {
            const n = Number(ts) || 0;
            if (!n) return '—';
            const d = new Date(n);
            const pad = (x) => String(x).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        },
        async openHistory() {
            this.historyVisible = true;
            this.historyPreview = null;
            this.historySelectedId = '';
            await this.loadHistory();
        },
        async loadHistory() {
            const id = this.note?.id;
            if (!id) return;
            this.historyLoading = true;
            try {
                const r = await fetchNoteHistory(id);
                this.historyItems = Array.isArray(r?.items) ? r.items : [];
            } catch (e) {
                this.historyItems = [];
            } finally {
                this.historyLoading = false;
            }
        },
        async viewHistory(item) {
            const id = this.note?.id;
            if (!id || !item?.id) return;
            this.historySelectedId = item.id;
            try {
                this.historyPreview = await fetchNoteHistoryItem(id, item.id);
            } catch (e) {
                ElMessage.error(this.$t('memo.historyLoadFail'));
            }
        },
        /** v1.3.2：移动端下拉框选版本 */
        onHistorySelect(hid) {
            const hit = (this.historyItems || []).find((h) => h.id === hid);
            if (hit) this.viewHistory(hit);
        },
        async restoreHistoryItem(item) {
            const id = this.note?.id;
            if (!id || !item?.id) return;
            try {
                await ElMessageBox.confirm(
                    this.$t('memo.historyRestoreConfirm'),
                    this.$t('memo.historyRestore'),
                    { type: 'warning', confirmButtonText: this.$t('common.confirm'), cancelButtonText: this.$t('common.cancel') },
                );
            } catch (e) {
                return;
            }
            try {
                const r = await restoreNoteHistory(id, item.id);
                this.version = Number(r?.version) || this.version + 1;
                this.updatedAt = Number(r?.updatedAt) || Date.now();
                this.dirty = false;
                this.applyContent(String(r?.content || ''));
                this.historyVisible = false;
                ElMessage.success(this.$t('memo.historyRestored'));
                await this.loadBacklinks();
            } catch (e) {
                ElMessage.error(this.$t('memo.saveFail'));
            }
        },
        /**
         * 历史快照定时器。
         *
         * 间隔来自「笔记设置 → 历史保存间隔」（分钟）。这里不跟「自动保存正文」共用一个
         * 节流器：正文保存是秒级、历史是分钟级，混在一起会让历史表几分钟就塞满 100 条。
         */
        startHistoryTimer() {
            this.stopHistoryTimer();
            const minutes = Math.max(1, Number(this.editorConfig?.historyInterval) || 3);
            this.historyTimer = setInterval(() => this.maybePushHistory(), minutes * 60 * 1000);
        },
        stopHistoryTimer() {
            if (this.historyTimer) {
                clearInterval(this.historyTimer);
                this.historyTimer = null;
            }
        },
        async maybePushHistory() {
            const id = this.note?.id;
            if (!id) return;
            /*
             * v1.3.1.2：判据从「dirty」改成「正文与上次快照不同」。
             *
             * dirty 是正文自动保存用的旗子，保存成功立刻被清掉，分钟级的定时器
             * 几乎不可能撞上它是 true 的时刻 —— 这就是「历史好像不会自动保存」的真因。
             * 现在直接比对正文：内容真变了才写，没变不写，既不空转刷表也不漏。
             */
            const md = this.currentMd();
            if (!md.trim()) return;
            if (md === this.lastHistoryMd) return;
            this.lastHistoryMd = md;
            this.historyDirty = false;
            try {
                await pushNoteHistory(id, { title: this.title, content: md, version: this.version });
            } catch (e) {
                /* 历史写失败不影响正文 */
            }
        },
        /**
         * v1.3.4：正文总字符数 —— 与后端 countMemoChars / 列表里的「N 字」同一口径：
         * 先转纯文本（剥掉 md 语法、块 ID、图片地址），再去掉所有空白。
         * 这样「字数」在编辑器顶部与列表里永远显示同一个数。
         */
        countChars(md) {
            /*
             * v1.3.4.1：「字符」= 总字符数，所有字符都统计。
             * 与「字数」（同一份纯文本里只数汉字 + 字母）共用 plainTextOf 的结果，
             * 不再剔除空白 / 标点 / 数字，保证字符数 >= 字数。
             */
            return plainTextOf(md).length;
        },
        /**
         * v1.3.4：字符数 = 汉字 + 字母。
         *
         * 原来直接在**原始 md** 上匹配字母，链接地址（https/example/com）、
         * 代码块里的英文、html 标签全被算进来，于是出现过「字符比字数还多」的怪现象。
         * 现在统一在纯文本上数，数字 / 标点 / 空白都不计。
         */
        updateWordCount(md) {
            const s = plainTextOf(md);
            const cn = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
            const en = (s.match(/[a-zA-Z]/g) || []).length;
            this.wordCount = cn + en;
        },

        /**
         * 吸附时各行的 top 偏移。
         *
         * sticky 元素互相叠加时不会自动错开 —— 上面一行吸住了，下面一行必须让出它的高度，
         * 否则会盖在一起。这里按「上面有哪些行也在吸附」累加：
         *   工具栏 35px（min-height 34 + 1px 分隔），标题行 40px。
         * 数值与下方的 CSS 尺寸同步维护（改了高度记得一起改这两个常量）。
         */
        /**
         * v1.3.3.2（需求：重排吸附矩阵，并移除辅助栏）
         *
         * 按需求给的 6 行表格落成规则（1 = 工具栏开关开，2 = 工具栏开关关；
         * 后缀 .1 = 标题栏开关开，.2 = 标题栏开关关）：
         *
         *   正滚（向下）: 工具栏 = 开关；标题栏 = 开关
         *   回滚（向上）: 工具栏 = 吸住；标题栏 = 吸住（贴工具栏最后一行下方）
         *
         * 于是六种组合都落在同一段代码里：
         *   1 / 1.1  正滚两行都吸，回滚两行都吸
         *   1.2      正滚只有工具栏，回滚两行都吸
         *   2.1      正滚只有标题栏（贴顶），回滚两行都吸
         *   2.2      正滚都不吸，回滚两行都吸
         */
        isStickyNow(which) {
            const cfg = this.stickyCfg || {};
            if (this.reverseSticky) return true;      // 回滚：工具栏与标题栏都吸住
            return cfg[which] === true;               // 正滚：完全按设置
        },
        stickyHeight(which) {
            const host = this.$refs.bodyEl;
            if (host) {
                const sel = which === 'toolbar' ? '.me-toolbar-wrap' : (which === 'title' ? '.me-title-row' : '.me-meta');
                const el = host.querySelector(sel);
                if (el && el.offsetHeight) return el.offsetHeight;
            }
            return which === 'toolbar' ? 35 : 40;
        },
        stickyTop(which) {
            // 标题栏永远贴在「工具栏最后一行下方」；工具栏不吸时从 0 起算
            if (which === 'title') {
                return this.isStickyNow('toolbar') ? `${this.stickyHeight('toolbar')}px` : '0px';
            }
            return '0px';
        },
        /** token 是不是工具组（`[组名 a b]` 解析出来的对象） */
        /**
         * v1.3.2（需求）：关闭吸附不代表永不吸附 ——
         * 往上滚（scrollTop 变大）时不吸，往下回滚（scrollTop 变小）时临时吸住，
         * 回到它自己的原始位置后由 sticky 自动脱离。CSS 只负责"吸"，方向由这个类控制。
         */
        /**
         * 取某个工具的内联 SVG（toolsOf 里用 svgKey 指到 data 上的那份字符串）。
         * 不直接用 v-html="svgBraces" 之类：模板里要按 token 动态取，写死一处就要改四处。
         */
        svgOf(token) {
            const t = this.toolsOf(token);
            const key = t && t.svgKey;
            return key ? (this[key] || '') : '';
        },
        /** v1.3.3.3（需求）：标题行右侧「返回顶部」——平滑滚回编辑区顶部 */
        scrollBodyToTop() {
            const el = this.$refs.bodyEl;
            if (!el) return;
            try {
                el.scrollTo({ top: 0, behavior: 'smooth' });
            } catch (e) {
                el.scrollTop = 0;
            }
        },
        onBodyScroll(e) {
            const el = e && e.target;
            if (!el) return;
            /*
             * v1.3.3.2（需求：选中文本菜单 / 选中文件菜单 / `/` 命令菜单都要跟随页面滚动）
             * 统一交给 repositionFloats：按存下来的文档位置重算视口坐标，
             * 以鼠标点为锚的右键 / 行号菜单按滚动量等距平移。
             */
            this.repositionFloats();
            // v1.3.3.2：行号栏是绝对定位的覆盖层，滚动要跟着重排
            this.scheduleGutter();
            // v1.3.3（需求）：光标工具栏跟随页面滚动，始终贴在光标那一行
            if (this.inputBar.open) this.updateInputBar();
            // v1.3.3.3：行末操作条同样要跟着滚
            if (this.lineBar.open) this.syncLineMenu();
            /*
             * v1.3.3.3（需求：回滚时工具栏 / 标题栏一直闪烁）
             *
             * 原因不是「吸附算错了」，而是**方向判据太灵敏**：
             * 上一版用 `top < last - 1` 判回滚，滚动时相邻两次事件的位移常常只有 1~2px，
             * 甚至因为布局微调出现「+1 / -1 / +1」的抖动 —— 于是 reverseSticky
             * 在每帧里反复翻转，所有开启吸附的行跟着反复吸住/松开，看起来就是狂闪。
             *
             * 现在改成带**滞回**的方向判定：
             *   · 同向位移累加；
             *   · 反向位移先清掉累计（视为掉头），再从 0 开始计；
             *   · 累计到 14px 才真正切换状态，切换后清零。
             * 1~2px 的抖动永远翻不动它，而用户真的换方向时 14px 立刻就切。
             */
            const top = el.scrollTop || 0;
            const prev = this._lastScrollTop || 0;
            const delta = top - prev;
            this._lastScrollTop = top;
            if (top <= 4) {
                // 已经在顶部：不存在「回滚吸附」的意义，直接复位
                this._stkAcc = 0;
                if (this.reverseSticky) this.reverseSticky = false;
                return;
            }
            const acc = this._stkAcc || 0;
            this._stkAcc = (acc > 0 && delta < 0) || (acc < 0 && delta > 0) ? delta : acc + delta;
            const TH = 14;
            if (this._stkAcc <= -TH) {
                this._stkAcc = 0;
                if (!this.reverseSticky) this.reverseSticky = true;
            } else if (this._stkAcc >= TH) {
                this._stkAcc = 0;
                if (this.reverseSticky) this.reverseSticky = false;
            }
        },
        /** v1.3.2：该工具是否被折叠进行末下拉 */
        isTbHidden(li, ti) {
            const start = this.toolbarOverflow[li];
            return typeof start === 'number' && ti >= start;
        },
        /**
         * v1.3.2：测量每一行工具栏，把超出可视宽度的工具折叠进行末下拉。
         * 只在桌面端做；移动端保留横滑（手指滑动比点两层菜单快）。
         */
        /** v1.3.3.1：观察工具栏尺寸，变化即重算溢出（rAF 合并多次回调） */
        setupToolbarObserver() {
            const wrap = this.$refs.toolbarWrap;
            if (!wrap || typeof ResizeObserver === 'undefined') return;
            if (this._tbRO) this._tbRO.disconnect();
            this._tbRO = new ResizeObserver(() => {
                if (this._tbRaf) cancelAnimationFrame(this._tbRaf);
                this._tbRaf = requestAnimationFrame(() => {
                    this._tbRaf = null;
                    this.measureToolbar();
                });
            });
            this._tbRO.observe(wrap);
        },
        measureToolbar() {
            if (this.isMobileViewport) {
                this.toolbarOverflow = {};
                this.toolbarOverflowTools = {};
                return;
            }
            const wrap = this.$refs.toolbarWrap;
            if (!wrap) return;
            const nextOverflow = {};
            const nextTools = {};
            Array.from(wrap.querySelectorAll('.me-toolbar')).forEach((lineEl, li) => {
                const tokens = this.toolbarLines[li] || [];
                /*
                 * v1.3.3.1（实测修复）：不能在原 DOM 上「先移除隐藏类再量」——
                 * 移除后触发的是上一帧的布局，量完又立刻隐藏，第二次测量读到的
                 * 就是残缺宽度，结果 first 反复变化：下拉里有工具、原按钮却没隐掉。
                 * 改成克隆一份到屏幕外（强制全部显示、同宽），在克隆上量。
                 */
                const clone = lineEl.cloneNode(true);
                clone.style.cssText = `position:absolute;top:-9999px;left:0;visibility:hidden;pointer-events:none;width:${lineEl.clientWidth}px;display:flex;flex-wrap:nowrap;overflow:visible`;
                clone.querySelectorAll('.is-tb-hidden').forEach((el) => el.classList.remove('is-tb-hidden'));
                document.body.appendChild(clone);
                const cells = Array.from(clone.querySelectorAll('[data-ti]'));
                const limit = lineEl.clientWidth - 38;
                let first = -1;
                cells.forEach((c) => {
                    const ti = Number(c.dataset.ti);
                    if (first < 0 && c.offsetLeft + c.offsetWidth > limit) first = ti;
                });
                document.body.removeChild(clone);
                if (first < 0) return;
                const ids = [];
                tokens.forEach((tk, ti) => {
                    if (ti < first || tk === '|') return;
                    if (this.isGroupToken(tk)) ids.push(...this.groupTools(tk));
                    else if (this.toolsOf(tk)) ids.push(tk);
                });
                if (!ids.length) return;
                nextOverflow[li] = first;
                nextTools[li] = ids;
            });
            this.toolbarOverflow = nextOverflow;
            this.toolbarOverflowTools = nextTools;

        },
        isGroupToken(token) {
            return !!token && typeof token === 'object' && Array.isArray(token.tools);
        },
        groupLabel(token) {
            return (token && token.group) || this.$t('memo.toolGroup');
        },
        groupTools(token) {
            return (token && Array.isArray(token.tools) ? token.tools : []).filter((t) => !!this.toolsOf(t));
        },

        /**
         * 点击工具栏按钮时在按钮上方显示名称，2 秒后消失（需求）。
         * 用浮层而不是只靠原生 title：title 要悬停才出、且出现在鼠标旁，
         * 移动端更是完全不显示。
         */
        showToolName(token, evt) {
            const el = evt?.currentTarget;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const label = this.toolsOf(token)?.label;
            this.toolTip = {
                show: true,
                text: label ? this.$t(label) : token,
                left: Math.round(rect.left + rect.width / 2),
                top: Math.round(rect.top - 8),
            };
            if (this._tipTimer) clearTimeout(this._tipTimer);
            this._tipTimer = setTimeout(() => {
                this.toolTip = { ...this.toolTip, show: false };
            }, 2000);
        },

        // ---------------- 图片缩放（v1.4.0） ----------------

        /**
         * 把 8 个手柄对齐到当前选中的媒体节点矩形上。
         *
         * v1.3.3.2（需求）：图片之外，视频 / 音频 / 附件也要能被选中并拖框缩放，
         * 所以这里从「只认 image」扩展成「认四种媒体节点」，几何算法完全一致。
         * 每次选择变化 / 滚动 / 窗口尺寸变化都要重算 —— 用的是绝对坐标，
         * 不重算就会出现「图片已经滚走了，手柄还钉在原地」。
         */
        syncImgBox() {
            const empty = { open: false, boxStyle: {}, width: 0, pos: 0, nodeW: 0, kind: '' };
            const ed = this.editor;
            const host = this.$refs.bodyEl;
            if (!ed || this.mode !== 'wysiwyg' || !host) {
                if (this.imgBox.open) this.imgBox = empty;
                return;
            }
            const sel = ed.state.selection;
            const MEDIA_NODES = ['image', 'video', 'audio', 'fileAttachment'];
            if (!(sel instanceof NodeSelection) || !MEDIA_NODES.includes(sel.node.type.name)) {
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
                kind: sel.node.type.name,
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
            // v1.3.3.2：宽度写到「当前选中的那个媒体节点」上（图片 / 视频 / 音频 / 附件）
            const nodeName = this.imgBox.kind || 'image';
            const sign = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0;
            const ed = this.editor;
            let dom = null;
            try {
                dom = ed && ed.view.nodeDOM(pos);
            } catch (e) {
                dom = null;
            }
            /*
             * v1.3.4（修移动端视频拖缩放手柄时画面抖动闪烁）：
             * 拖的过程中**不写文档**，只改元素的 style.width —— 写文档会让视频节点
             * 重新渲染、重新加载 src，每帧一次就是闪烁；而且比例也会被重置。
             * 松手时才真正 updateAttributes 落库（md 里 `{width=N}`）。
             */
            const paint = (w) => {
                if (dom && dom.style) dom.style.width = `${w}px`;
                this.imgBox = { ...this.imgBox, width: w, nodeW: w };
            };
            const onMove = (e) => {
                const p = e.touches?.[0] || e.changedTouches?.[0] || e;
                const dx = (Number(p.clientX) || 0) - startX;
                const dy = (Number(p.clientY) || 0) - startY;
                const raw = sign ? startW + sign * dx : startW + dy;
                const w = Math.max(80, Math.min(2400, Math.round(raw)));
                if (this._imgRaf) return;
                this._imgRaf = requestAnimationFrame(() => {
                    this._imgRaf = 0;
                    paint(w);
                    this.syncImgBox();
                });
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('touchmove', onMove);
                window.removeEventListener('touchend', onUp);
                if (this._imgRaf) {
                    cancelAnimationFrame(this._imgRaf);
                    this._imgRaf = 0;
                }
                if (!ed) return;
                const w = Math.max(80, Math.min(2400, Number(this.imgBox.width) || startW));
                ed.chain()
                    .setNodeSelection(pos)
                    .updateAttributes(nodeName, { width: w })
                    .setMeta('addToHistory', false)
                    .run();
                this.markDirty();
                this.syncImgBox();
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchmove', onMove, { passive: false });
            window.addEventListener('touchend', onUp);
        },

        /** 把一段 md 灌进当前视图（恢复历史 / 冲突解决共用） */
        applyContent(md) {
            const text = String(md || '');
            this.lastMd = text;
            this.charCount = this.countChars(text);
            this.updateWordCount(text);
            if (this.editor) this.editor.commands.setContent(this.docOf(text), { emitUpdate: false });
            if (this.sourceView) {
                this.sourceView.dispatch({
                    changes: { from: 0, to: this.sourceView.state.doc.length, insert: text },
                });
            }
            this.previewHtml = renderMarkdownSafe(text);
        },

        /** 标题也算「内容变过」—— 历史快照要能还原标题 */
        onTitleInput() {
            this.historyDirty = true;
            this.scheduleSave();
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
                    // v1.3.4.2：列表显示「字数」，保存后一并回填
                    wordCount: this.wordCount,
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

        /** v1.3.4：某个工具是不是下拉型（字号 / 颜色 / 列表转换） */
        toolDropdown(token) {
            return TOOL_DROPDOWNS[token] || null;
        },
        /** 光标当前所在列表的类型（给「转换」下拉打勾） */
        currentListType() {
            const ed = this.editor;
            if (!ed) return '';
            if (ed.isActive('taskList')) return 'taskList';
            if (ed.isActive('orderedList')) return 'orderedList';
            if (ed.isActive('bulletList')) return 'bulletList';
            return '';
        },
        runDropdownTool(token, cmd) {
            if (token === 'fontSize') return this.setFontSize(cmd);
            if (token === 'textColor') return this.setTextColor(cmd);
            if (token === 'listConvert') return this.convertListAtCursor(cmd);
        },

        async runTool(token, evt) {
            const tool = TOOLS[token];
            if (!tool) return;
            // 需求：点击顶部按钮时在按钮上方显示名称，2 秒后消失
            if (evt) this.showToolName(token, evt);
            if (token === 'link') return this.insertLink();
            /*
             * v1.3.4.1（需求）：image / video / audio 工具改为「打开对应灯箱，
             * 浏览当前编辑区里的所有同类文件」；上传 / 插入仍走 upload / file 入口。
             */
            if (token === 'image') return this.openEditorLightbox('image');
            if (token === 'video') return this.openEditorLightbox('video');
            if (token === 'audio') return this.openEditorLightbox('audio');
            if (token === 'upload') return this.openUploadPicker();
            if (token === 'linkExtract') return this.extractLink();
            if (token === 'file') {
                // 选文件弹窗：落地类型由文件自身的 mime 决定
                this.pickerVisible = true;
                return;
            }
            if (token === 'callout') return this.insertCallout();
            // v1.3.1.2：插入表格先问行列数（需求给了参考图），不再固定 3×3
            if (token === 'table') {
                this.tablePicker = { open: true, hover: { r: 3, c: 3 } };
                return;
            }
            /* v1.3.1.2：日期 / 时间 / 表情 / 符号 / 嵌入 / 查找替换 / HTML */
            if (token.startsWith('date') || token === 'timeHms') return this.insertDateTime(token);
            if (token === 'emoji' || token === 'symbol') return this.openInsertPanel(token === 'emoji' ? 'emoji' : 'symbol');
            if (token === 'iframe') return this.promptIframe();
            if (token === 'findReplace') return this.openFindReplace();
            if (token === 'htmlMd') return this.openHtmlMd();
            if (token === 'htmlBlock') return this.openHtmlBlock();
            if (token === 'annotate') return this.annotateSelection();
            if (token === 'subDoc') return this.openSubDoc();
            if (token === 'publish') return this.publishSelectionToMoment();
            /*
             * v1.3.4：这三个工具在工具栏里是下拉（选了具体值）；
             * 配到 / 菜单、右键菜单这类「点一下就执行」的位置时按顺序轮换，
             * 至少保证点得动，而不是静默什么都不发生。
             */
            if (token === 'fontSize') {
                const cur = String(this.editor?.getAttributes('fontSize')?.size || '');
                const next = cur === 's' ? 'm' : cur === 'm' ? 'l' : cur === 'l' ? 'clear' : 's';
                return this.setFontSize(next);
            }
            if (token === 'textColor') {
                const cur = String(this.editor?.getAttributes('textColor')?.color || '');
                const i = TEXT_COLORS.indexOf(cur);
                const next = i < 0 ? TEXT_COLORS[0] : i + 1 < TEXT_COLORS.length ? TEXT_COLORS[i + 1] : 'clear';
                return this.setTextColor(next);
            }
            if (token === 'listConvert') {
                const order = ['taskList', 'bulletList', 'orderedList'];
                const cur = this.currentListType();
                const next = order[(order.indexOf(cur) + 1) % order.length];
                return this.convertListAtCursor(next);
            }
            if (token === 'mediaPreview') return this.openMediaPreview();
            if (token === 'mediaDetail') return this.openMediaDetail();
            if (token === 'outline') return this.openOutline();
            if (token === 'foldAll') return this.toggleFoldAll();
            if (!this.editor) return;
            if (this.mode !== 'wysiwyg') this.mode = 'wysiwyg';
            tool.run(this.editor);
            this.onEditorUpdate();
            /*
             * v1.3.3（需求：文件对齐后选框不跟随）
             *
             * 对齐改的是节点属性，选区没变 → 不会触发 selectionChange，
             * 选框就停在旧位置。工具执行完主动重算一次几何。
             */
            this.$nextTick(() => {
                this.syncImgBox();
                this.syncMediaBar();
                this.syncTableBar();
            });
        },

        // ---------------- v1.3.1.2：左侧行级栏 ----------------

        /**
         * 重算左侧行号栏的位置（v1.3.3.2 重写）。
         *
         * 每个顶层块 → 它自己的 DOM 矩形 → 换算成「相对 .me-body 内容原点」的 top：
         *   · 文本块：让行号对准**首行**的垂直中心（不是块顶，否则标题行号会偏上）；
         *   · 原子块（图片 / 视频 / 音频 / 附件 / 分割线 / 嵌入）：贴块顶 2px；
         *   · 折叠后被隐藏的块不出现（高度为 0，直接跳过）。
         * 位置用 rAF 合并，滚动 / 输入 / 折叠都只跑一次。
         */
        syncGutter() {
            const ed = this.editor;
            const host = this.$refs.bodyEl;
            if (!ed || this.mode !== 'wysiwyg' || !host) {
                if (this.gutterRows.length) this.gutterRows = [];
                if (this.listFoldRows.length) this.listFoldRows = [];
                return;
            }
            const dom = ed.view.dom;
            if (!dom) return;
            const hostRect = host.getBoundingClientRect();
            let lh = 24;
            try {
                const cs = window.getComputedStyle(dom);
                const n = parseFloat(cs.lineHeight);
                if (Number.isFinite(n) && n > 0) lh = n;
            } catch (e) {
                /* 用默认值 */
            }
            const rows = [];
            const folds = this._folds || new Set();
            /*
             * 折叠区间与行号栏共用同一次遍历（v1.3.3.2）：
             * 折叠某个标题 = 从它的下一个块开始，到下一个同级/更高级标题之前，
             * 一律挂 .gh-fold-hidden（display:none，不改文档结构、不动 md）。
             * 这样「按钮状态 / 行号 / 实际隐藏的块」三者永远不会各算一套。
             */
            let skipLevel = 0;
            let childIdx = 0;
            const hiddenIdx = [];
            const foldedListIdx = [];
            ed.state.doc.forEach((node, offset) => {
                childIdx += 1; // 与 .gh-editor-content 的子元素一一对应
                const level = node.type.name === 'heading' ? Number(node.attrs.level) || 1 : 0;
                const isList = LIST_NODE_NAMES.includes(node.type.name);
                if (skipLevel && level > 0 && level <= skipLevel) skipLevel = 0;
                const shouldHide = skipLevel > 0;
                if (!shouldHide && level > 0 && folds.has(offset)) skipLevel = level;
                if (shouldHide) hiddenIdx.push(childIdx);
                /*
                 * v1.3.3.3（需求）：列表也能折叠 —— 折的是「列表内部的下级列表」，
                 * 不是整块。隐藏规则交给 applyFoldCss 生成，
                 * 这里只记下「第几个块是折叠状态的列表」。
                 */
                const listFolded = !shouldHide && isList && folds.has(offset);
                if (listFolded) foldedListIdx.push(childIdx);
                let el = null;
                try {
                    el = ed.view.nodeDOM(offset);
                } catch (err) {
                    el = null;
                }
                if (!el || typeof el.getBoundingClientRect !== 'function') return;
                if (shouldHide) return; // 隐藏的块不占行号
                const r = el.getBoundingClientRect();
                if (!r.height && !r.width) return;
                const isText = node.isTextblock;
                const top = r.top - hostRect.top + host.scrollTop;
                const firstLine = Math.min(r.height, lh);
                const y = isText ? top + Math.max(0, (firstLine - 20) / 2) : top + 2;
                rows.push({
                    pos: offset,
                    /*
                     * 行号在「确认要画」之后才递增：折叠隐藏 / 零高度的块不占号，
                     * 否则会出现「6 之后直接跳到 8」这种断号。
                     */
                    no: rows.length + 1,
                    type: node.type.name,
                    level,
                    /*
                     * v1.3.4.1（需求）：行级栏第一列只保留标题的折叠箭头；
                     * 列表的任意层级折叠按钮统一由下方的 listFoldRows 画在第一列。
                     */
                    foldable: level > 0,
                    folded: level > 0 && folds.has(offset),
                    top: Math.round(y),
                });
            });
            this.gutterRows = rows;
            /*
             * v1.3.4：列表项折叠按钮。
             * 直接扫 DOM（li 有直接子 ul/ol 才算「有下级」），比再走一遍文档更省，
             * 也天然覆盖任务列表（它的子列表在 li > div 里，不影响判断 li 本身）。
             */
            const foldsSet = this._folds || new Set();
            void foldsSet;
            const listSet = this._listFolds || new Set();
            const listRows = [];
            try {
                const lis = dom.querySelectorAll('li');
                lis.forEach((li) => {
                    const sub = Array.from(li.children).find((c) => c.tagName === 'UL' || c.tagName === 'OL')
                        || Array.from(li.querySelectorAll(':scope > div > ul, :scope > div > ol'))[0];
                    if (!sub) return;
                    const key = this.domSelectorPath(li, dom);
                    if (!key) return;
                    const r = li.getBoundingClientRect();
                    if (!r.height) return;
                    const firstLine = Math.min(r.height, lh);
                    listRows.push({
                        key,
                        folded: listSet.has(key),
                        /*
                         * v1.3.4.1（需求）：所有列表的任意层级折叠按钮统一放到
                         * 行级栏第一列（行号的左侧），不再压住列表符号 / 勾选框。
                         */
                        left: 0,
                        top: Math.round(r.top - hostRect.top + host.scrollTop + firstLine / 2 - 8),
                    });
                });
            } catch (e) {
                /* 结构异常时不影响行号 */
            }
            this.listFoldRows = listRows;
            this.applyFoldCss(hiddenIdx, foldedListIdx);
        },

        /**
         * v1.3.3.2：折叠的「隐藏」改用一张动态样式表实现。
         *
         * 为什么不直接给块加 class / 行内 display：ProseMirror 会监听自己的 DOM，
         * 发现它有没管理的属性变化就按自己的节点定义**重渲染**那个节点，
         * 我们加的 class 随即被抹掉（实测：加完 300ms 就没了，内容根本没折）。
         * 样式表是文档级的东西，PM 完全不碰，而且 nth-child 的下标正好等于块的序号，
         * 与 syncGutter 同一次遍历算出来的区间天然一致。
         */
        applyFoldCss(indexes, listIndexes) {
            if (!this._foldStyleEl) {
                const el = document.createElement('style');
                el.id = 'gohub-memo-fold-css';
                document.head.appendChild(el);
                this._foldStyleEl = el;
            }
            const parts = [];
            const sel = (indexes || []).map((n) => `.gh-editor-content > *:nth-child(${n})`).join(',');
            if (sel) parts.push(`${sel}{display:none !important}`);
            /*
             * 列表折叠：只收掉「二级及以下」的列表，一级项照常显示。
             * 同时把上级 li 的 marker 缩进一起算进去 —— 只隐藏子列表会留下一段空白，
             * 看起来像「折了一半」。
             */
            (listIndexes || []).forEach((n) => {
                const root = `.gh-editor-content > *:nth-child(${n})`;
                parts.push(`${root} ul ul,${root} ul ol,${root} ol ul,${root} ol ol{display:none !important}`);
            });
            this._foldStyleEl.textContent = parts.join('\n');
        },

        /**
         * v1.3.4：某个 DOM 元素在正文里的 :nth-child 路径。
         *
         * 用它当折叠状态的 key 和 CSS 选择器 —— ProseMirror 不允许我们往 li 上挂
         * 自定义 class（下一次重渲染就抹掉），只能靠结构路径定位。
         */
        domSelectorPath(el, root) {
            const parts = [];
            let cur = el;
            let guard = 0;
            while (cur && cur !== root && cur.parentElement && guard < 80) {
                guard += 1;
                const idx = Array.from(cur.parentElement.children).indexOf(cur) + 1;
                if (idx <= 0) return '';
                parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${idx})`);
                cur = cur.parentElement;
            }
            if (cur !== root || !parts.length) return '';
            return `.gh-editor-content > ${parts.join(' > ')}`;
        },
        /** v1.3.4：折叠 / 展开某个列表项的**所有下级** */
        toggleListFold(key) {
            if (!this._listFolds) this._listFolds = new Set();
            if (this._listFolds.has(key)) this._listFolds.delete(key);
            else this._listFolds.add(key);
            this.applyListFoldCss();
            this.syncGutter();
        },
        applyListFoldCss() {
            if (!this._listFoldStyleEl) {
                const el = document.createElement('style');
                el.id = 'gohub-memo-listfold-css';
                document.head.appendChild(el);
                this._listFoldStyleEl = el;
            }
            const rules = [];
            (this._listFolds || new Set()).forEach((key) => {
                /*
                 * 两种结构都要覆盖：
                 *   · 普通列表：子列表是 li 的直接子元素；
                 *   · 任务列表：子列表在 li > div 里。
                 * 用后代选择器会把更深层的列表一起收掉 —— 正是「收起所有下级」要的效果。
                 */
                rules.push(`${key} > ul,${key} > ol,${key} > div > ul,${key} > div > ol{display:none !important}`);
            });
            this._listFoldStyleEl.textContent = rules.join('\n');
        },
        /** rAF 合并：滚动与输入都会频繁触发，没必要每次同步重排 */
        scheduleGutter() {
            if (this._gutterRaf) return;
            this._gutterRaf = requestAnimationFrame(() => {
                this._gutterRaf = null;
                this.syncGutter();
                // v1.3.4.1：媒体加载完成 / 内容变化后，按默认尺寸规则补算显示宽度
                this.applyDefaultMediaSize();
            });
        },

        /**
         * v1.3.3.2：行号栏的「布局变化」观察器。
         *
         * 为什么必须有：图片 / 视频的尺寸是**异步**出来的（图片解码、视频读元数据），
         * 首帧量到的块高是占位高度，等媒体加载完，下面所有块都整体下移 ——
         * 行号却停在旧位置，看起来就是「越往下越对不上」。
         * 这里同时盯两件事：正文容器的尺寸变化（ResizeObserver）与媒体加载完成（load 捕获）。
         */
        setupGutterObserver() {
            const body = this.$refs.bodyEl;
            if (!body) return;
            if (this._gutterRO) this._gutterRO.disconnect();
            if (typeof ResizeObserver !== 'undefined') {
                this._gutterRO = new ResizeObserver(() => this.scheduleGutter());
                const content = body.querySelector('.gh-editor-content');
                if (content) this._gutterRO.observe(content);
            }
            if (!this._gutterLoad) {
                this._gutterLoad = () => this.scheduleGutter();
                // 捕获阶段：img / video 的 load 不冒泡
                body.addEventListener('load', this._gutterLoad, true);
                body.addEventListener('loadedmetadata', this._gutterLoad, true);
            }
        },

        openGutter(pos, type, el) {
            const rect = el.getBoundingClientRect();
            /*
             * v1.3.3.2（需求）：行号菜单打开时把光标工具栏收起来。
             * 记一次滚动基准，菜单随页面滚动等距平移（repositionFloats）。
             */
            this._floatScrollTop = (this.$refs.bodyEl && this.$refs.bodyEl.scrollTop) || 0;
            /*
             * v1.3.4（需求）：菜单显示在「上下空间更大」的那一侧。
             * 先按估算高度摆一次（避免首帧闪到屏幕外），nextTick 量到真实高度再校正。
             */
            const estimateH = 5 * 31 + 30;
            const below = window.innerHeight - rect.bottom;
            const above = rect.top;
            // 需求：哪边空间大就显示在哪边（不是「放不下才翻」）
            const openUp = above > below;
            const x = Math.round(rect.right + 6);
            const y = Math.round(openUp ? Math.max(8, rect.bottom - estimateH) : Math.min(rect.top, window.innerHeight - estimateH - 8));
            this.gutterMenu = {
                open: true,
                x,
                y,
                pos,
                type,
                up: openUp,
                aTop: rect.top,
                aBottom: rect.bottom,
                aLeft: rect.left,
                aRight: rect.right,
            };
            this.$nextTick(() => this.placeGutterMenu());
            if (this.inputBar.open) this.inputBar = { open: false, style: {} };
            // 顺手把光标放进这个块，后续操作（删除 / 批注）以它为目标
            this.editor?.chain().focus().setTextSelection(pos + 1).run();
        },
        /** v1.3.4：按真实 DOM 尺寸校正行号菜单的位置，保证整块都在视口内 */
        placeGutterMenu() {
            if (!this.gutterMenu.open) return;
            const el = document.querySelector('.me-gutter-menu');
            if (!el) return;
            const r = el.getBoundingClientRect();
            const m = this.gutterMenu;
            const vh = window.innerHeight;
            const vw = window.innerWidth;
            let y = m.aTop;
            // 上方空间更大 → 贴着按钮底边往上展开（真实高度量到后再校正一次）
            if (m.aTop > vh - m.aBottom) y = m.aBottom - r.height;
            y = Math.max(8, Math.min(y, vh - r.height - 8));
            let x = m.aRight + 6;
            if (x + r.width > vw - 8) x = Math.max(8, m.aLeft - r.width - 6);
            if (Math.abs(y - this.gutterMenu.y) > 1 || Math.abs(x - this.gutterMenu.x) > 1) {
                this.gutterMenu = { ...this.gutterMenu, x: Math.round(x), y: Math.round(y) };
            }
        },
        closeGutter() {
            if (this.gutterMenu.open) this.gutterMenu = { ...this.gutterMenu, open: false };
        },
        /** 取当前块的 NodeSelection（块级原子节点用 NodeSelection，文本块用文本选区） */
        selectBlockAt(pos) {
            const ed = this.editor;
            if (!ed) return;
            const node = ed.state.doc.nodeAt(pos);
            if (!node) return;
            if (node.isAtom || node.isLeaf) {
                ed.chain().focus().setNodeSelection(pos).run();
            } else {
                ed.chain().focus().setTextSelection(pos + 1).run();
            }
        },
        gutterAction(action) {
            const ed = this.editor;
            const pos = this.gutterMenu.pos;
            this.closeGutter();
            if (!ed) return;
            const node = ed.state.doc.nodeAt(pos);
            if (!node) return;
            // v1.3.3.3（需求）：复制块 ID 不需要选中块，先处理掉
            if (action === 'copyId') {
                this.copyBlockId(pos, node);
                return;
            }
            this.selectBlockAt(pos);
            if (action === 'copy') {
                try {
                    document.execCommand('copy');
                } catch (e) {
                    /* 忽略 */
                }
                return;
            }
            if (action === 'cut') {
                try {
                    document.execCommand('cut');
                } catch (e) {
                    /* 忽略 */
                }
                return;
            }
            if (action === 'delete') {
                ed.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
            } else if (action === 'clearFormat') {
                /*
                 * v1.3.4.2（需求）：块菜单里加「清除格式」。
                 * 只清行内标记（加粗/斜体/下划线/颜色/字号等），保留块本身的结构 ——
                 * 在块操作菜单里点「清除格式」的预期是「把这坨文字洗回朴素」，
                 * 不是把标题降级成段落、把列表拆散（那是 clearNodes 的副作用）。
                 */
                const from = pos + 1;
                const to = Math.max(from, pos + node.nodeSize - 1);
                if (!node.isAtom && to > from) {
                    ed.chain().focus().setTextSelection({ from, to }).unsetAllMarks().run();
                }
            } else if (action === 'insertBreak') {
                /* v1.3.4.2（需求）：在块下方插入一个换行，并把光标落到新行上 */
                const at = pos + node.nodeSize;
                ed.chain()
                    .focus()
                    .insertContentAt(at, { type: 'paragraph' })
                    .setTextSelection(at + 1)
                    .run();
            } else if (action === 'duplicate') {
                ed.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run();
            } else if (action === 'insertAfter') {
                ed.chain().focus().insertContentAt(pos + node.nodeSize, { type: 'paragraph' }).run();
            } else if (action === 'annotate') {
                this.annotateSelection();
                return;
            }
            this.onEditorUpdate();
        },

        /**
         * v1.3.3.3（需求）：复制当前块的 ID。
         *
         * 块 ID 由后端在建索引时算出来（`blk_` + 内容哈希前 8 位），前端不重算哈希 ——
         * 重算一份等于把同一套规则维护两次，改一处就错位。这里直接问后端的块索引：
         * 「这篇笔记里 plainText 等于当前块文本的块」，同名多份时按出现顺序取第 k 个。
         * 索引还没生成（刚写的新笔记、还没保存）时明确提示，不复制一个假 ID 出去。
         */
        async copyBlockId(pos, node) {
            const noteId = this.note && (this.note.id || this.note.noteId);
            if (!noteId) {
                ElMessage.warning(this.$t('memo.gutterCopyIdNoNote'));
                return;
            }
            const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
            const copied = async (val) => {
                try {
                    await navigator.clipboard.writeText(val);
                } catch (e) {
                    try {
                        const ta = document.createElement('textarea');
                        ta.value = val;
                        ta.style.cssText = 'position:fixed;left:-9999px';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                    } catch (err) {
                        ElMessage.error(this.$t('memo.gutterCopyFailed'));
                        return;
                    }
                }
                ElMessage.success(this.$t('memo.gutterCopyIdDone', { id: val }));
            };
            let blocks = [];
            try {
                const r = await fetchNoteBlocks(noteId);
                blocks = Array.isArray(r?.blocks) ? r.blocks : [];
            } catch (e) {
                blocks = [];
            }
            if (!blocks.length) {
                ElMessage.warning(this.$t('memo.gutterCopyIdNoIndex'));
                return;
            }
            /* 当前块之前、同样文本的块有几个 —— 用来在同名块里定位自己 */
            const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
            let nth = 0;
            const editor = this.editor;
            if (editor) {
                editor.state.doc.forEach((n, offset) => {
                    if (offset >= pos) return;
                    if (norm(n.textContent) === text) nth += 1;
                });
            }
            const same = blocks.filter((b) => norm(b.plainText) === text);
            const hit = same[nth] || same[0];
            if (!hit || !hit.blockId) {
                ElMessage.warning(this.$t('memo.gutterCopyIdNotFound'));
                return;
            }
            await copied(`((${hit.blockId}))`);
        },

        /** v1.3.3：改嵌入块的地址与高度（两步输入，避免做一个只为两行的表单弹窗） */
        async editIframe(wrap) {
            const ed = this.editor;
            if (!ed) return;
            let pos = -1;
            try {
                pos = ed.view.posAtDOM(wrap, 0);
            } catch (e) {
                return;
            }
            /*
             * v1.3.4.2（需求：点「编辑」没反应）
             * posAtDOM 在不同结构下可能返回「节点前」也可能返回「节点内」。
             * 上一版写死 pos -= 1，一旦它本来就在节点内，减去 1 就落到前一个块上，
             * nodeAt 校验不通过便静默 return —— 表现就是按钮点了完全没反应。
             * 与 onHtmlEdit 一致：两个位置都试一次。
             */
            let node = ed.state.doc.nodeAt(pos);
            if (!node || node.type.name !== 'iframe') {
                const before = ed.state.doc.nodeAt(pos - 1);
                if (before && before.type.name === 'iframe') {
                    pos -= 1;
                    node = before;
                }
            }
            if (!node || node.type.name !== 'iframe') return;
            try {
                const r1 = await ElMessageBox.prompt(this.$t('memo.iframeUrlPrompt'), this.$t('memo.iframeSettings'), {
                    inputValue: String(node.attrs.src || ''),
                    inputPlaceholder: 'https://…',
                    inputValidator: (v) => (/^https?:\/\//i.test(String(v || '').trim()) ? true : this.$t('memo.linkInvalid')),
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel')
                });
                const r2 = await ElMessageBox.prompt(this.$t('memo.iframeHeightPrompt'), this.$t('memo.iframeSettings'), {
                    inputValue: String(node.attrs.height || 420),
                    inputPattern: /^\d{2,4}$/,
                    inputErrorMessage: this.$t('memo.iframeHeightInvalid'),
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel')
                });
                ed.chain()
                    .focus()
                    .command(({ tr }) => {
                        tr.setNodeMarkup(pos, undefined, {
                            ...node.attrs,
                            src: String(r1.value || '').trim(),
                            height: Math.min(2000, Math.max(120, Number(r2.value) || 420))
                        });
                        return true;
                    })
                    .run();
                this.onEditorUpdate();
            } catch (e) {
                /* 取消 */
            }
        },

        // ---------------- v1.3.1.2：引用悬停预览 ----------------

        async loadHoverCard(el, rect) {
            const noteId = el.getAttribute('data-note-id') || '';
            const blockId = el.getAttribute('data-block-id') || '';
            if (!noteId && !blockId) return;
            /*
             * v1.3.3（需求）：`[[` 悬停预览按「上下哪边空间大」决定方位。
             * 卡片高度按 158 估（标题一行 + 正文 3 行 + 内边距），上下都不够时贴视口边。
             */
            const CARD_W = 300;
            const CARD_H = 158;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const spaceBelow = vh - rect.bottom - 8;
            const spaceAbove = rect.top - 8;
            const above = spaceAbove > spaceBelow && spaceAbove > 120;
            const x = Math.max(8, Math.min(rect.left, vw - CARD_W - 8));
            const y = above
                ? Math.max(8, Math.min(rect.top - CARD_H - 8, vh - CARD_H - 8))
                : Math.min(rect.bottom + 8, vh - CARD_H - 8);
            this.hoverCard = { open: true, x, y, above, title: '', text: '', loading: true };
            try {
                if (blockId) {
                    const r = await resolveBlock(blockId);
                    this.hoverCard = {
                        open: true,
                        x,
                        y,
                        above,
                        title: r?.noteTitle || this.$t('memo.blockRefTitle'),
                        text: String(r?.plainText || '').slice(0, 260),
                        loading: false,
                    };
                } else {
                    const r = await fetchNote(noteId);
                    const note = r?.note || r || {};
                    this.hoverCard = {
                        open: true,
                        x,
                        y,
                        above,
                        title: note.title || this.$t('memo.untitled'),
                        text: String(note.excerpt || plainTextOf(note.content || '')).slice(0, 260),
                        loading: false,
                    };
                }
            } catch (e) {
                this.hoverCard = { ...this.hoverCard, loading: false, text: this.$t('memo.hoverFail') };
            }
        },

        // ---------------- v1.3.1.2：日期 / 表情 / 符号 ----------------

        /**
         * 插入日期 / 时间文本。
         *
         * 五种格式各做一个独立工具（需求点名），这里按 token 出字符串。
         * 全部用「本地时间」—— 用户要的是他墙上时钟的那一刻，不是 UTC。
         */
        insertDateTime(token) {
            const ed = this.editor;
            if (!ed) return;
            const d = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const y = d.getFullYear();
            const m = pad(d.getMonth() + 1);
            const day = pad(d.getDate());
            const map = {
                dateYmd: `${y}${m}${day}`,
                dateSlash: `${y}/${m}/${day}`,
                dateDash: `${y}-${m}-${day}`,
                dateCn: `${y}年${m}月${day}日`,
                timeHms: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
            };
            const text = map[token];
            if (!text) return;
            if (this.mode !== 'wysiwyg') this.mode = 'wysiwyg';
            ed.chain().focus().insertContent(text).run();
            this.onEditorUpdate();
        },

        openInsertPanel(tab) {
            this.insertPanelTab = tab;
            this.insertPanelCat = 0;
            this.insertPanelQuery = '';
            this.insertPanelVisible = true;
        },
        /** 当前面板的分组表 */
        insertPanelGroups() {
            return this.insertPanelTab === 'emoji' ? this.emojiGroups : this.symbolGroups;
        },
        /** 当前分类下（或搜索结果里）的符号列表 */
        insertPanelItems() {
            const q = String(this.insertPanelQuery || '').trim();
            if (q) {
                // 搜索时不分类：把两套数据全铺开，反正用户已经知道要什么
                const all = [...this.emojiGroups, ...this.symbolGroups].flatMap((g) => g.items);
                return Array.from(new Set(all)).filter((x) => x.includes(q));
            }
            const groups = this.insertPanelGroups();
            const g = groups[Math.min(this.insertPanelCat, groups.length - 1)];
            return g ? g.items : [];
        },
        insertGlyph(ch) {
            const ed = this.editor;
            if (!ed) return;
            if (this.mode !== 'wysiwyg') this.mode = 'wysiwyg';
            ed.chain().focus().insertContent(String(ch || '')).run();
            this.onEditorUpdate();
            /*
             * v1.3.3.3（需求：插入后要关掉面板）
             * 上一版是「连续插几个表情是常态」所以故意不关 —— 但面板是居中大弹窗，
             * 插完不关就得手动关一次才能看见插入结果，反而更绕。
             * 表情本身还能用输入法直接打，面板按需再开。
             */
            this.insertPanelVisible = false;
        },

        // ---------------- v1.3.1.2：网页嵌入 / HTML 块 ----------------

        async promptIframe() {
            if (!this.editor) return;
            let url = '';
            try {
                const r = await ElMessageBox.prompt(this.$t('memo.iframeTip'), this.$t('memo.toolIframe'), {
                    inputPlaceholder: 'https://example.com',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    inputValidator: (v) => (/^https?:\/\//i.test(String(v || '').trim()) ? true : this.$t('memo.linkInvalid')),
                });
                url = String(r?.value || '').trim();
            } catch (e) {
                return;
            }
            if (!url) return;
            if (this.mode !== 'wysiwyg') this.mode = 'wysiwyg';
            this.editor.chain().focus().insertContent({ type: 'iframe', attrs: { src: url, height: 420 } }).run();
            this.onEditorUpdate();
        },
        openHtmlBlock(pos) {
            const ed = this.editor;
            if (!ed) return;
            // v1.3.4：从标题行的「编辑」进来时直接带节点位置，不依赖光标
            if (typeof pos === 'number' && pos >= 0) {
                const n = ed.state.doc.nodeAt(pos);
                if (n && n.type.name === 'htmlBlock') {
                    this.htmlBlockDlg = { visible: true, html: String(n.attrs.html || ''), pos };
                    return;
                }
            }
            const { $from } = ed.state.selection;
            const cur = $from.parent.type.name;
            this.htmlBlockDlg = {
                visible: true,
                html: cur === 'htmlBlock' ? String($from.parent.attrs.html || '') : '',
                pos: cur === 'htmlBlock' ? $from.before($from.depth) : -1,
            };
        },
        saveHtmlBlock() {
            if (!this.editor) return;
            const html = String(this.htmlBlockDlg.html || '');
            if (this.mode !== 'wysiwyg') this.mode = 'wysiwyg';
            const pos = Number(this.htmlBlockDlg.pos);
            if (pos >= 0 && this.editor.state.doc.nodeAt(pos)?.type.name === 'htmlBlock') {
                this.editor.chain().focus().command(({ tr }) => {
                    tr.setNodeMarkup(pos, undefined, { html });
                    return true;
                }).run();
            } else if (this.editor.isActive('htmlBlock')) {
                // 光标就在 HTML 块里：直接改这一块
                this.editor.chain().focus().updateAttributes('htmlBlock', { html }).run();
            } else {
                this.editor
                    .chain()
                    .focus()
                    .insertContent([{ type: 'htmlBlock', attrs: { html } }, { type: 'paragraph' }])
                    .run();
            }
            this.htmlBlockDlg.visible = false;
            this.onEditorUpdate();
        },

        // ---------------- v1.3.1.2：查找替换 ----------------

        openFindReplace() {
            this.findDlg = { visible: true, find: '', replace: '', count: 0, tip: '', index: 0 };
        },
        /** 收集所有匹配（文本节点内逐个扫，跨节点的不算 —— 那种情况极少且会切坏标记） */
        findMatches() {
            const q = String(this.findDlg.find || '');
            if (!q || !this.editor) return [];
            const out = [];
            this.editor.state.doc.descendants((node, pos) => {
                if (!node.isText) return;
                const text = node.text || '';
                let idx = text.indexOf(q);
                while (idx >= 0) {
                    out.push({ from: pos + idx, to: pos + idx + q.length });
                    idx = text.indexOf(q, idx + q.length);
                }
            });
            return out;
        },
        countMatches() {
            const n = this.findMatches().length;
            this.findDlg.count = n;
            this.findDlg.tip = n ? '' : this.$t('memo.findNone');
            return n;
        },
        /**
         * v1.3.3.3（需求）：查找定位 —— 从当前光标往后找下一个匹配，选中并滚到可见处。
         * 找完一圈就从头再来；同时把「第 i / n 项」显示在提示行里。
         */
        findNext() {
            const ed = this.editor;
            if (!ed) return;
            const list = this.findMatches();
            this.findDlg.count = list.length;
            if (!list.length) {
                this.findDlg.tip = this.$t('memo.findNoResult');
                return;
            }
            const cur = ed.state.selection.to;
            let idx = list.findIndex((m) => m.from >= cur);
            if (idx < 0) idx = 0;
            const hit = list[idx];
            ed.chain().focus().setTextSelection({ from: hit.from, to: hit.to }).scrollIntoView().run();
            this.findDlg.index = idx + 1;
            this.findDlg.tip = this.$t('memo.findCount', { i: idx + 1, n: list.length });
            /*
             * 重新聚焦到弹窗里的输入框：定位只是「把光标放过去」，
             * 用户可以接着按查找看下一处，不必再点回输入框。
             */
            const input = document.querySelector('.me-find-dialog input');
            if (input) input.focus({ preventScroll: true });
        },
        replaceOne() {
            const list = this.findMatches();
            if (!list.length) {
                this.countMatches();
                return;
            }
            const { from, to } = list[0];
            this.editor.chain().focus().insertContentAt({ from, to }, String(this.findDlg.replace || '')).run();
            this.onEditorUpdate();
            this.countMatches();
        },
        replaceAll() {
            const list = this.findMatches();
            if (!list.length) {
                this.countMatches();
                return;
            }
            const text = String(this.findDlg.replace || '');
            // 从后往前替换：前面的位置不会被后面的编辑推偏
            for (let i = list.length - 1; i >= 0; i -= 1) {
                this.editor.chain().insertContentAt({ from: list[i].from, to: list[i].to }, text).run();
            }
            this.onEditorUpdate();
            this.findDlg.count = 0;
            ElMessage.success(this.$t('memo.replaceDone', { n: list.length }));
        },

        /** v1.3.3.3（需求）：打开「新建子页面」弹窗，并记住当前光标 */
        openSubDoc() {
            const ed = this.editor;
            if (!ed) return;
            /*
             * v1.3.4（修「创建成功却没引用到光标处」）：
             * 点工具栏 / 菜单时编辑器可能已经失焦，selection 被重置成文档开头（pos=1），
             * 直接读它就会把引用插到文首。这里优先用失焦前记下的最后一个光标位置。
             * v1.3.4.2：再额外记住「父块起点 + 段内偏移」，插入失败时可以用它重算，
             * 不依赖一个可能已经失效的绝对位置。
             */
            const { $from } = ed.state.selection;
            const from = $from.pos;
            const useFallback = from <= 1 && this._lastSelFrom > 1;
            const pos = useFallback ? this._lastSelFrom : from;
            let blockStart = -1;
            let offset = 0;
            if (!useFallback) {
                try {
                    blockStart = $from.before($from.depth);
                    offset = $from.parentOffset;
                } catch (e) {
                    blockStart = -1;
                    offset = 0;
                }
            }
            this.subDoc = { visible: true, title: '', content: '', busy: false, pos, blockStart, offset };
        },
        /** 创建子文档 → 在当前笔记同目录下建一篇 → 把引用插到刚才的光标处 */
        async createSubDoc() {
            if (this.subDoc.busy) return;
            const title = String(this.subDoc.title || '').trim();
            if (!title) {
                ElMessage.warning(this.$t('memo.subDocTitle'));
                return;
            }
            this.subDoc.busy = true;
            try {
                const folderId = String(this.note?.folderId || '');
                const r = await apiCreateNote({ title, content: String(this.subDoc.content || ''), folderId });
                if (!r?.id) throw new Error('create failed');
                const ed = this.editor;
                const max = ed.state.doc.content.size;
                const atom = { type: 'noteRef', attrs: { noteId: r.id, blockId: null, label: title } };
                /*
                 * v1.3.4.2（需求：创建成功后引用没插到光标处）
                 * 绝对位置可能因为弹窗期间文档变动而失效，直接 fallback 到文末就会
                 * 让人以为「引用没插进去」。这里按优先级逐个尝试：
                 *   1) 打开弹窗时的光标位置；
                 *   2) 父块起点 + 当时的段内偏移（重算，位置失效也能回到原段落）；
                 *   3) 当前选区；
                 *   4) 父块开头；
                 *   5) 文档末尾（最后的兜底）。
                 * 不再调用 .focus()：focus 会把失焦后被重置的选区写回去，反而添乱。
                 */
                const clamp = (v) => Math.min(Math.max(1, Number(v) || 1), max);
                const tryInsert = (at) => {
                    const p = clamp(at);
                    try {
                        return ed.chain().insertContentAt(p, atom).run();
                    } catch (e) {
                        return false;
                    }
                };
                const candidates = [this.subDoc.pos];
                if (Number(this.subDoc.blockStart) >= 0) {
                    candidates.push(Number(this.subDoc.blockStart) + 1 + (Number(this.subDoc.offset) || 0));
                    candidates.push(Number(this.subDoc.blockStart) + 1);
                }
                candidates.push(ed.state.selection.from);
                candidates.push(max - 1);
                let ok = false;
                for (const c of candidates) {
                    if (c === null || c === undefined) continue;
                    if (tryInsert(c)) {
                        ok = true;
                        break;
                    }
                }
                if (!ok) throw new Error(this.$t('memo.saveFail'));
                this.onEditorUpdate();
                this.subDoc = { visible: false, title: '', content: '', busy: false, pos: 0, blockStart: -1, offset: 0 };
                ElMessage.success(this.$t('memo.subDocDone'));
                // 让父页面刷新目录/列表（新笔记要出现在列表里）
                this.$emit('reload', this.note?.id || '');
            } catch (e) {
                this.subDoc.busy = false;
                ElMessage.error(memoError(e).message || this.$t('memo.saveFail'));
            }
        },

        // ---------------- v1.3.1.2：HTML ↔ MD ----------------

        openHtmlMd() {
            // 进来先把「当前正文」放进左边，省得用户再复制一遍
            this.htmlDlg = { visible: true, html: '', md: this.currentMd() };
        },
        htmlToMdNow() {
            const html = String(this.htmlDlg.html || '').trim();
            if (!html) return;
            this.htmlDlg.md = htmlToMd(html);
        },
        mdToHtmlNow() {
            const md = String(this.htmlDlg.md || '');
            if (!md.trim()) return;
            this.htmlDlg.html = renderMarkdownSafe(md);
        },
        applyHtmlMdToEditor() {
            const md = String(this.htmlDlg.md || '');
            this.applyContent(md);
            this.historyDirty = true;
            this.dirty = true;
            this.htmlDlg.visible = false;
            this.onEditorUpdate();
        },

        // ---------------- v1.3.1.2：批注 ----------------

        /**
         * 给选中的内容加批注。
         *
         * 实现方式是「在被批注的块后面插一个 comment 类型的提示块」，里面放原文摘录 + 批注：
         * markdown 侧不需要任何新语法（复用 :::callout），别的 md 查看器也能读，
         * 而且批注天然不会污染正文字符数。
         */
        async annotateSelection() {
            const ed = this.editor;
            if (!ed) return;
            const { from, to, empty } = ed.state.selection;
            const quoted = empty ? '' : ed.state.doc.textBetween(from, to, ' ').trim().slice(0, 300);
            let note = '';
            try {
                const r = await ElMessageBox.prompt(this.$t('memo.annotateTip'), this.$t('memo.toolAnnotate'), {
                    inputType: 'textarea',
                    inputPlaceholder: this.$t('memo.annotatePlaceholder'),
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                });
                note = String(r?.value || '').trim();
            } catch (e) {
                return;
            }
            if (!note) return;
            if (this.mode !== 'wysiwyg') this.mode = 'wysiwyg';
            const quoteMd = quoted ? `> ${quoted}\n\n` : '';
            const node = {
                type: 'callout',
                attrs: { type: 'comment' },
                content: [
                    { type: 'paragraph', content: [{ type: 'text', text: quoteMd ? `批注对象：${quoted}` : '批注' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: note }] },
                ],
            };
            ed.chain().focus().insertContentAt(to, [node, { type: 'paragraph' }]).run();
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

        /**
         * 图床选文件回来。
         *
         * v1.3.1.1 加固（需求：插入文件仍然显示不出来）：
         *   · id 逐个兜底（id / fileId / name / path）—— 不同数据源给的字段名不一样，
         *     原来只认 id，取不到就 `continue`，表现就是「选了文件但什么都没插进去」；
         *   · 地址优先用条目自带的 url/src，没有才拼 /file/<id>；
         *   · 块级节点用 insertContentAt 插到「当前块之后」，并在后面补一个空段落 ——
         *     直接 insertContent 在段尾插入时，块原子节点有时会被并进段落里，
         *     渲染出来是行内的一个小链接，看着就像「没加载出来」。
         */
        onPicked(files) {
            if (!this.editor) return;
            const list = Array.isArray(files) ? files : [];
            if (!list.length) return;
            const ed = this.editor;
            if (this.mode !== 'wysiwyg') this.mode = 'wysiwyg';
            for (const f of list) {
                const id = String(f?.id || f?.fileId || f?.name || f?.path || '');
                const rawUrl = String(f?.url || f?.src || '');
                const src = rawUrl || (id ? `/file/${encodeURIComponent(id)}` : '');
                if (!src) continue;
                const mime = String(f.mime || f.type || '');
                const name = String(f.originalName || f.fileName || f.name || id || '附件');
                const kind = f.mediaKind === 'other' ? 'file' : f.mediaKind || mediaKindOfMime(mime);
                try {
                    if (kind === 'image') {
                        ed.chain().focus().setImage({ src, alt: name }).run();
                        continue;
                    }
                    const node =
                        kind === 'video'
                            ? { type: 'video', attrs: { src, poster: '' } }
                            : kind === 'audio'
                              ? { type: 'audio', attrs: { src } }
                              : { type: 'fileAttachment', attrs: { href: src, name } };
                    // 插到当前块之后，并补一个空段落收尾，保证块级节点独占一行
                    const at = ed.state.selection.to;
                    ed.chain()
                        .focus()
                        .insertContentAt(at, [node, { type: 'paragraph' }])
                        .run();
                } catch (e) {
                    console.warn('[memo] 插入文件失败', e);
                    ElMessage.error(this.$t('memo.insertFileFail'));
                }
            }
            this.onEditorUpdate();
        },

        /* ---------------- 上传（v1.3.1.1） ---------------- */

        /** 打开「任意类型」文件选择框（不设 accept，图片/PDF/压缩包都能选） */
        openUploadPicker() {
            const el = this.$refs.anyFileInput;
            if (!el) return;
            el.value = '';
            el.click();
        },
        /** v1.3.2（需求）：每次打开都按当前月份回填 /notes/memo/年/月 */
        openUploadTarget() {
            this.uploadPrefill = {
                channelId: '',
                instanceId: this.instanceId || '',
                uploadFolder: defaultUploadFolder('memo'),
            };
            this.uploadTargetVisible = true;
        },
        onAnyFileChange(event) {
            const files = Array.from(event?.target?.files || []);
            if (event?.target) event.target.value = '';
            if (!files.length) return;
            this.pendingUploadFiles = files;
            // 需求：选完文件先调出「上传到图床」面板，确认后才上传
            this.openUploadTarget();
        },
        /**
         * 链接提取（需求：与瞬间编辑页的链接提取一致）。
         * 填直链 → 弹「上传到图床」面板 → 转存 → 把结果插到光标处。
         */
        async extractLink() {
            let url = '';
            try {
                const r = await ElMessageBox.prompt(this.$t('memo.linkExtractTip'), this.$t('memo.toolLinkExtract'), {
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    inputPlaceholder: 'https://…',
                    inputValidator: (v) => (/^https?:\/\//i.test(String(v || '').trim()) ? true : this.$t('memo.linkInvalid')),
                });
                url = String(r?.value || '').trim();
            } catch (e) {
                return;
            }
            if (!url) return;
            this.pendingLinkUrl = url;
            this.pendingUploadFiles = [];
            this.uploadMode = 'url';
            this.openUploadTarget();
        },

        /** 面板确认：按选定的渠道 / 实例 / 目录逐个上传，再插到光标处 */
        async confirmUploadTarget(target) {
            if (this.uploadMode === 'url') {
                this.uploadBusy = true;
                try {
                    const hit = await importUrlToBed(this.pendingLinkUrl, target || {});
                    const id = String(hit?.id || hit?.name || '');
                    if (id) {
                        /*
                         * v1.3.2（需求：链接提取要把图片 / 视频 / 音频按媒体插入，
                         * 而不是一律当附件）
                         *
                         * 转存接口不一定回 mime，这里按文件名后缀兜一层；
                         * 仍然判不出类型时才落成 ![[file:...]] 附件。
                         */
                        const nm = String(hit?.originalName || hit?.name || id);
                        const mime = String(hit?.mime || hit?.type || guessMimeByName(nm) || '');
                        this.onPicked([{ id, name: nm, mime }]);
                    }
                    this.uploadTargetVisible = false;
                    this.pendingLinkUrl = '';
                    this.uploadMode = 'files';
                } catch (e) {
                    ElMessage.error(e?.message || this.$t('memo.uploadFail'));
                } finally {
                    this.uploadBusy = false;
                }
                return;
            }
            const files = this.pendingUploadFiles.slice();
            if (!files.length) return;
            this.uploadBusy = true;
            const inserted = [];
            try {
                for (const f of files) {
                    try {
                        const hit = await uploadOne(f, target || {});
                        if (hit?.id) {
                            inserted.push({
                                id: String(hit.id),
                                name: f.name,
                                mime: f.type,
                                size: f.size,
                            });
                        }
                    } catch (e) {
                        ElMessage.error(`${f.name}：${e?.message || this.$t('memo.uploadFail')}`);
                    }
                }
                if (inserted.length) this.onPicked(inserted);
                this.uploadTargetVisible = false;
                this.pendingUploadFiles = [];
            } finally {
                this.uploadBusy = false;
            }
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
         * 输入时的快捷转换（v1.3.1.1 需求）。
         *
         * 处理中文输入法下敲出来的记号，StarterKit 自带的 input rule 只认半角 `-` `>`，
         * 用户打完「【】」或「》」再敲空格是敲不出任务列表 / 引述的。
         * 这里在「空格」落下的瞬间看光标前两个字符，命中就删掉记号并套上对应结构。
         */
        onEditorTextInput(view, from, to, text) {
            if (text !== ' ' || from !== to) return false;
            const { state } = view;
            const $from = state.doc.resolve(from);
            if (!$from.parent.isTextblock) return false;
            const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 2), $from.parentOffset, '\n', '\n');
            const chain = this.editor?.chain().focus();
            if (!chain) return false;
            if (before === '【】') {
                chain.deleteRange({ from: from - 2, to: from }).toggleTaskList().run();
                return true;
            }
            /*
             * v1.3.3.3（需求）：`《》` + 空格 → 行内代码。
             * 必须排在 `》` 前面：中文输入法里打「书名号」是一对，
             * 若先命中 `》` 的单字符规则，就变成引述块了。
             */
            if (before === '《》' || before === '<>') {
                chain.deleteRange({ from: from - 2, to: from }).toggleCode().run();
                return true;
            }
            if (before === '》') {
                chain.deleteRange({ from: from - 1, to: from }).toggleBlockquote().run();
                return true;
            }
            /*
             * v1.3.3.3（需求）：`{}` + 空格 → 块代码。
             * 同理，中文输入法下花括号是｛｝，两种都收。
             */
            if (before === '{}' || before === '｛｝') {
                chain.deleteRange({ from: from - 2, to: from }).toggleCodeBlock().run();
                return true;
            }
            /*
             * v1.3.3.3（需求）：`:::`（或全角`：：：`）+ 空格 → 提示块。
             * 三个字符要用 textBetween 单独取，不能和上面的两字符判断共用 before。
             */
            {
                const three = $from.parent.textBetween(Math.max(0, $from.parentOffset - 3), $from.parentOffset, '\n', '\n');
                if (three === ':::' || three === '：：：') {
                    chain.deleteRange({ from: from - 3, to: from }).run();
                    this.insertCallout();
                    return true;
                }
            }
            /*
             * `··` → 行内代码：把它换成一个反引号，后面的反引号闭合由用户继续输入，
             * 等于把中文输入法下打不出反引号的场景兜住。
             */
            if (before === '··') {
                chain.insertContentAt({ from: from - 2, to: from }, '`').run();
                return true;
            }
            return false;
        },

        /**
         * 右键 / 长按菜单（v1.3.1.2 需求）。
         *
         * 一定是「自己画一个」而不是放行原生菜单：编辑区里的操作（批注、超链接、
         * 粘贴为纯文本…）原生菜单里根本没有，放行只会挡住我们自己的浮层。
         * 标题 / 标签输入框仍然放行 —— 那里要用系统的粘贴与输入法。
         *
         * 菜单内容按「有没有选中」分两套：
         *   · 有选中：复制 / 剪切 / 删除 / 批注（+ 段落才有超链接）；
         *   · 没选中：粘贴 / 粘贴并保留格式 / 粘贴为纯文本 / 粘贴转义文本 / 全选。
         */
        onContextMenu(event) {
            const tag = String(event?.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea') return true;
            event.preventDefault();
            if (!this.editor || this.mode !== 'wysiwyg') return false;
            const sel = this.editor.state.selection;
            /*
             * v1.3.3（需求）：只要选中有内容，右键 / 长按一律不弹「编辑菜单」，
             * 交给选中浮层（复制/剪切/加粗…）。桌面端原来还会弹一份重复的右键菜单，
             * 两套菜单同时出现既挤又容易点错。
             */
            if (!sel.empty) {
                this.closeCtxMenu();
                this.$nextTick(() => this.onSelectionChange());
                return false;
            }
            let kind = 'empty';
            if (!sel.empty) {
                // 「段落」与「标题 / 文件 / 其他」在需求里只在「有没有超链接」上有差别
                kind = this.editor.isActive('paragraph') ? 'paragraph' : 'other';
            }
            /*
             * v1.3.2（需求）：菜单以「一行」显示在光标所在行的上方。
             * 先按条目数估个高度，放不下就翻到光标下方 —— 顶部边缘右键时不至于被裁掉。
             */
            const menuH = 46;
            const x = Math.min(event.clientX || 0, Math.max(8, window.innerWidth - 190));
            let y = (event.clientY || 0) - menuH - 10;
            if (y < 8) y = Math.min((event.clientY || 0) + 18, Math.max(8, window.innerHeight - menuH));
            // v1.3.4（需求）：右键菜单弹出时，其它浮层一律收起，避免叠成一堆
            this.closeAllFloats('ctx');
            // v1.3.3.2：菜单是 fixed 定位的，滚动时要按差值跟着走
            this._floatScrollTop = (this.$refs.bodyEl && this.$refs.bodyEl.scrollTop) || 0;
            this.ctxMenu = { open: true, x, y, kind };
            return false;
        },
        /**
         * v1.3.4：统一收起浮层。
         *
         * 以前每个浮层各自判断「点别处要关」，右键时只关了 ctx 自己，
         * 于是右键菜单会和标题菜单 / 选中菜单 / 光标工具栏叠在一起。
         * 这里给一个唯一出口，`except` 用来保留刚打开的那一个。
         */
        closeAllFloats(except = '') {
            if (except !== 'bubble' && this.bubble.open) this.bubble = { ...this.bubble, open: false };
            if (except !== 'media' && this.mediaBar.open) this.mediaBar = { ...this.mediaBar, open: false };
            if (except !== 'slash' && this.slash.open) this.closeSlash();
            if (except !== 'ref' && this.ref.open) this.closeRef();
            if (except !== 'line' && this.lineBar.open) this.lineBar = { ...this.lineBar, open: false };
            if (except !== 'input' && this.inputBar.open) this.inputBar = { ...this.inputBar, open: false };
            if (except !== 'gutter' && this.gutterMenu.open) this.closeGutter();
            if (except !== 'table' && this.tableBar.open) this.tableBar = { ...this.tableBar, open: false };
            if (except !== 'picker' && this.tablePicker.open) this.tablePicker = { ...this.tablePicker, open: false };
            if (except !== 'hover' && this.hoverCard.open) this.hoverCard = { ...this.hoverCard, open: false };
        },
        closeCtxMenu() {
            if (this.ctxMenu.open) this.ctxMenu = { ...this.ctxMenu, open: false };
        },
        /** v1.3.3：浮层里 B / I / U / S 用字母更直观 */
        bubLetter(id) {
            return { bold: 'B', italic: 'I', underline: 'U', strike: 'S' }[id] || '';
        },
        isToolActive(id) {
            const tool = TOOLS[id];
            return !!(tool && tool.active && tool.active(this.editor));
        },
        /** v1.3.3：按 id 执行右键菜单项（编辑工具走 runTool，其余走动作表） */
        runCtx(item) {
            if (!item || item.sep) return;
            if (item.tool) return this.runTool(item.id);
            const fn = item.call && this[item.call];
            if (typeof fn === 'function') return fn.call(this);
        },
        ctxPasteRich() {
            return this.ctxPaste('rich');
        },
        ctxPasteKeep() {
            return this.ctxPaste('keep');
        },
        ctxPastePlain() {
            return this.ctxPaste('plain');
        },
        ctxPasteEscaped() {
            return this.ctxPaste('escaped');
        },
        ctxCopy() {
            this.closeCtxMenu();
            try {
                document.execCommand('copy');
            } catch (e) {
                /* 浏览器不给就算了，用户还可以用快捷键 */
            }
        },
        ctxCut() {
            this.closeCtxMenu();
            try {
                document.execCommand('cut');
            } catch (e) {
                /* 同上 */
            }
        },
        ctxDelete() {
            this.closeCtxMenu();
            const ed = this.editor;
            if (!ed) return;
            const { from, to } = ed.state.selection;
            ed.chain().focus().deleteRange({ from, to }).run();
            this.onEditorUpdate();
        },
        ctxAnnotate() {
            this.closeCtxMenu();
            this.annotateSelection();
        },
        ctxLink() {
            this.closeCtxMenu();
            this.insertLink();
        },
        ctxSelectAll() {
            this.closeCtxMenu();
            this.editor?.chain().focus().selectAll().run();
        },
        /**
         * 粘贴类操作。
         *
         * rich  = 交给浏览器原生 paste（保留源格式），这里直接放行 Ctrl+V 的效果；
         * keep  = 读剪贴板 HTML → htmlToMd（结构与格式都尽量保留）；
         * plain = 只读纯文本；
         * escaped = 纯文本 + 把 md 记号转义（想「原样」贴一段 md 时用）。
         */
        async ctxPaste(mode) {
            this.closeCtxMenu();
            const ed = this.editor;
            if (!ed) return;
            ed.chain().focus().run();
            if (mode === 'rich') {
                // 原生粘贴需要一次真实用户手势，这里退化成 keep，避免「点了没反应」
                return this.ctxPaste('keep');
            }
            try {
                if (mode === 'keep' && navigator.clipboard?.read) {
                    const items = await navigator.clipboard.read();
                    for (const it of items) {
                        if (it.types.includes('text/html')) {
                            const blob = await it.getType('text/html');
                            const html = await blob.text();
                            ed.chain().focus().insertContent(htmlToMd(html)).run();
                            this.onEditorUpdate();
                            return;
                        }
                    }
                    const text = await navigator.clipboard.readText();
                    ed.chain().focus().insertContent(text).run();
                    this.onEditorUpdate();
                    return;
                }
                const text = await navigator.clipboard.readText();
                if (!text) return;
                const out =
                    mode === 'escaped'
                        ? text.replace(/([\\`*_{}\[\]()#+\-.!|>~=])/g, '\\$1')
                        : text;
                ed.chain().focus().insertContent(out).run();
                this.onEditorUpdate();
            } catch (e) {
                ElMessage.warning(this.$t('memo.clipboardDenied'));
            }
        },

        // ---------------- v1.3.1.2：字号 / 颜色 / 表格 / 发布 ----------------

        setFontSize(size) {
            const ed = this.editor;
            if (!ed) return;
            if (size === 'clear') {
                ed.chain().focus().unsetMark('fontSize').run();
            } else {
                ed.chain().focus().setMark('fontSize', { size }).run();
            }
            this.onEditorUpdate();
        },
        setTextColor(color) {
            const ed = this.editor;
            if (!ed) return;
            if (color === 'clear') {
                ed.chain().focus().unsetMark('textColor').run();
            } else {
                ed.chain().focus().setMark('textColor', { color }).run();
            }
            this.onEditorUpdate();
        },
        /** 表格操作条的显隐与定位：光标在表格里就浮在表格上方 */
        syncTableBar() {
            const ed = this.editor;
            if (!ed || this.mode !== 'wysiwyg' || !ed.isActive('table')) {
                if (this.tableBar.open) this.tableBar = { open: false, style: {} };
                return;
            }
            try {
                const { from } = ed.state.selection;
                /*
                 * v1.3.2（需求）：表格操作条贴在表格第一行上方 / 最后一行下方，
                 * 哪边在可视区就放哪边，并用箭头指向表格。
                 */
                const at = ed.view.domAtPos(from);
                let el = at && at.node;
                if (el && el.nodeType === 3) el = el.parentElement;
                const table = el && el.closest ? el.closest('table') : null;
                const r = table ? table.getBoundingClientRect() : null;
                if (r) {
                    const above = r.top > 64;
                    const left = Math.max(8, Math.min(r.left, window.innerWidth - 320));
                    this.tableBar = {
                        open: true,
                        above,
                        style: {
                            left: `${Math.round(left)}px`,
                            top: `${Math.round(above ? r.top - 42 : r.bottom + 8)}px`,
                        },
                    };
                } else {
                    const coords = ed.view.coordsAtPos(from);
                    this.tableBar = {
                        open: true,
                        above: true,
                        style: {
                            left: `${Math.round(Math.max(8, coords.left))}px`,
                            top: `${Math.round(Math.max(8, coords.top - 40))}px`,
                        },
                    };
                }
            } catch (e) {
                this.tableBar = { open: false, style: {} };
            }
        },
        insertTableAt(pos) {
            const rows = Math.max(1, Math.min(10, Number(pos?.r) || 3));
            const cols = Math.max(1, Math.min(10, Number(pos?.c) || 3));
            this.tablePicker.open = false;
            if (!this.editor) return;
            if (this.mode !== 'wysiwyg') this.mode = 'wysiwyg';
            this.editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
            this.onEditorUpdate();
        },
        /** 把选中的文字带去瞬间发布页（发布完回到编辑器，不跳页） */
        publishSelectionToMoment() {
            const ed = this.editor;
            if (!ed) return;
            const { from, to, empty } = ed.state.selection;
            const text = empty ? '' : ed.state.doc.textBetween(from, to, '\n').trim();
            if (!text) {
                ElMessage.warning(this.$t('memo.publishNeedSelection'));
                return;
            }
            /*
             * v1.3.3.3（需求）：点「发布到瞬间」时同时把选中内容复制到剪贴板。
             * 发布弹窗里的正文是另一套输入框（富文本 md → 纯文本会丢格式），
             * 用户常常还想把原文粘到别处；顺手复制一份最省事。
             */
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).catch(() => {});
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.cssText = 'position:fixed;left:-9999px';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                }
            } catch (e) {
                /* 复制失败不影响发布 */
            }
            this.$emit('publish-moment', text);
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
            /*
             * v1.3.3.2：折叠状态不在文档里，不需要发事务 —— 直接重排行号栏，
             * 隐藏类由 syncGutter 一并挂到块 DOM 上（见该函数）。
             */
            this.foldsRev += 1;
            this.syncGutter();
        },

        /** 点标题左侧的折叠标记：只折叠这一节 */
        toggleFoldAt(pos) {
            const ed = this.editor;
            if (!ed) return;
            const set = this._folds || (this._folds = new Set());
            if (set.has(pos)) set.delete(pos);
            else set.add(pos);
            this.foldsRev += 1;
            this.syncGutter();
        },

        // ---------------- 引用搜索：`[[` 文档 / `((` 块 ----------------

        closeRef() {
            if (this.ref.open) this.ref = { ...this.ref, open: false, items: [], index: 0, mode: '', replacePos: null };
        },

        /**
         * v1.3.4.2（需求）：引用面板按上下可用空间更大的一侧展开。
         *
         * 需求原文是「判断上方和下方哪里的位置空间更大，然后显示在更大的那个位置区域」，
         * 所以这里直接比大小，不再像斜杠菜单那样只在下方放不下时才翻上去。
         * 之前固定向下（coords.bottom + 6），光标落在视口下半部分时面板会被裁掉。
         */
        refStyleAt(pos) {
            const ed = this.editor;
            if (!ed) return {};
            let c;
            try {
                c = ed.view.coordsAtPos(pos);
            } catch (e) {
                return {};
            }
            const below = window.innerHeight - c.bottom;
            const above = c.top;
            const openUp = above > below;
            return openUp
                ? { left: `${Math.round(c.left)}px`, bottom: `${Math.round(window.innerHeight - c.top + 6)}px` }
                : { left: `${Math.round(c.left)}px`, top: `${Math.round(c.bottom + 6)}px` };
        },

        /**
         * v1.3.4.2（需求）：从块引用内容框的「编辑」进入 —— 打开两级面板，
         * 选完块后替换该节点的 blockId，而不是在光标处再插一个引用。
         */
        openBlockRefPicker(pos) {
            const ed = this.editor;
            if (!ed) return;
            this.closeAllFloats('ref');
            this.ref = {
                ...this.ref,
                open: true,
                mode: 'block',
                level: 'notes',
                noteId: '',
                noteTitle: '',
                items: [],
                index: 0,
                query: '',
                loading: true,
                pos,
                replacePos: pos,
                style: this.refStyleAt(pos),
            };
            this.searchRef();
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
            /*
             * v1.3.3.3（需求：输入`【【`也要调出查找引用）
             * 中文输入法下打两个半角方括号很别扭，全角【【才是自然输入；
             * 两种都认，插入的仍然是标准的 [[note:…]]。
             */
            const mNote = /\[\[([^\]\n]*)$/.exec(before) || /【【([^】\n]*)$/.exec(before);
            /* v1.3.4.1（需求）：输入「（（」也要触发块引用 */
            const mBlock = /\(\(([^)\n]*)$/.exec(before) || /（（([^）\n]*)$/.exec(before);
            const mode = mNote ? 'note' : mBlock ? 'block' : '';
            if (!mode) return this.closeRef();
            this.closeSlash();
            const query = (mNote ? mNote[1] : mBlock[1]) || '';
            /*
             * v1.3.4.2（需求）：引用面板按上下空间择大展开（原来固定朝下）。
             */
            const style = this.refStyleAt($from.pos);
            /*
             * v1.3.4.1：块引用先进入「笔记一级」（level=notes），
             * 点某个笔记标题后再进「块二级」（level=blocks）。
             */
            this.ref = {
                ...this.ref,
                open: true,
                mode,
                level: mode === 'block' ? 'notes' : 'list',
                noteId: '',
                noteTitle: '',
                items: [],
                index: 0,
                loading: true,
                query,
                pos: $from.pos,
                /* 输入触发的面板永远是「插入」，不能带着上一次「更换块」的目标 */
                replacePos: null,
                style,
            };
            // 输入即搜：300ms 防抖，避免每个字符打一次接口
            if (this._refTimer) clearTimeout(this._refTimer);
            this._refTimer = setTimeout(() => this.searchRef(), 220);
        },

        async searchRef() {
            const { mode, level, noteId, query } = this.ref;
            if (!mode) return;
            const kw = String(query || '').trim().toLowerCase();
            try {
                /*
                 * v1.3.4.1（需求）：笔记引用默认加载**全部**笔记（面板可上下滚动），
                 * 不再只取前 8 条。
                 */
                if (mode === 'note') {
                    const r = await fetchNotes({ search: String(query || '').trim(), pageSize: 200 });
                    const items = (r?.items || r?.list || [])
                        .filter((n) => n.id !== this.note?.id)
                        .map((n) => ({
                            id: n.id,
                            label: n.title || this.$t('memo.untitled'),
                            hint: n.excerpt || '',
                            insert: `[[note:${n.id}|${n.title || this.$t('memo.untitled')}]]`,
                        }));
                    this.ref = { ...this.ref, items, index: 0, loading: false };
                    return;
                }
                /* 块引用一级：所有笔记标题，第一条固定为「当前笔记」 */
                if (level === 'notes') {
                    const r = await fetchNotes({ search: String(query || '').trim(), pageSize: 200 });
                    const list = r?.items || r?.list || [];
                    const current = this.note
                        ? [{ id: this.note.id, label: this.$t('memo.currentNote'), hint: '', current: true }]
                        : [];
                    const others = list
                        .filter((n) => n.id !== this.note?.id)
                        .map((n) => ({ id: n.id, label: n.title || this.$t('memo.untitled'), hint: '', current: false }));
                    this.ref = { ...this.ref, items: current.concat(others), index: 0, loading: false };
                    return;
                }
                /* 块引用二级：该笔记下的所有内容块 */
                const id = noteId || this.note?.id;
                if (!id) return this.closeRef();
                const r = await fetchNoteBlocks(id);
                const items = (r?.blocks || [])
                    .filter((b) => (kw ? String(b.plainText || '').toLowerCase().includes(kw) : true))
                    .map((b) => ({
                        id: b.blockId,
                        label: String(b.plainText || b.blockType || '').slice(0, 80),
                        hint: b.blockType,
                        insert: `((${b.blockId}))`,
                    }));
                this.ref = { ...this.ref, items, index: 0, loading: false };
            } catch (e) {
                this.ref = { ...this.ref, items: [], index: 0, loading: false };
            }
        },

        /** v1.3.4.1：块引用二级 → 返回一级（笔记列表） */
        refBackToNotes() {
            this.ref = { ...this.ref, level: 'notes', noteId: '', noteTitle: '', items: [], index: 0, loading: true };
            this.searchRef();
        },

        /** v1.3.4.1：进入某篇笔记的块列表（块引用二级） */
        async loadBlockRefItems(noteId, noteTitle) {
            const id = noteId || this.note?.id;
            if (!id) return;
            this.ref = {
                ...this.ref,
                level: 'blocks',
                noteId: id,
                noteTitle: String(noteTitle || this.$t('memo.currentNote')),
                items: [],
                index: 0,
                loading: true,
            };
            await this.searchRef();
        },

        applyRef(item) {
            const ed = this.editor;
            if (!ed || !item) return;
            const mode = this.ref.mode;
            /*
             * v1.3.4.1（需求）：块引用是两级菜单 ——
             * 一级点笔记标题只是「进二级看块」，不插入；二级点块才真正插入。
             */
            if (mode === 'block' && this.ref.level === 'notes') {
                this.loadBlockRefItems(item.id, item.label);
                return;
            }
            /*
             * v1.3.4.2（需求）：从「块内容引用框」的编辑按钮进来时，选完块是**替换**
             * 该节点引用的块，不是在光标处再插一个引用。
             */
            if (mode === 'block' && this.ref.level === 'blocks' && this.ref.replacePos != null) {
                const pos = Number(this.ref.replacePos);
                this.closeRef();
                if (!Number.isFinite(pos) || pos < 0) return;
                try {
                    ed.chain().focus().command(({ tr }) => {
                        tr.setNodeMarkup(pos, undefined, { blockId: String(item.id || '') });
                        return true;
                    }).run();
                    this.onEditorUpdate();
                } catch (e) {
                    /* 节点已被删除 / 位置失效：静默放弃，不插入新内容 */
                }
                return;
            }
            const query = String(this.ref.query || '');
            this.closeRef();
            /*
             * v1.3.2（需求）：选中后要清掉刚才输入的 `[[`（以及查询词），
             * 并且**立刻**换成引用节点，不再等下一次刷新。
             * 旧实现是 insertContent('[[note:..]]') —— 插进去的是一段纯文本，
             * 只有重新打开笔记走 mdToDoc 时才会变成 gh-noteref，所以看起来"没生效"。
             */
            const { $from } = ed.state.selection;
            const from = Math.max(0, $from.pos - 2 - query.length);
            const node = mode === 'block'
                ? { type: 'blockRef', attrs: { blockId: String(item.id || '') } }
                : {
                    type: 'noteRef',
                    attrs: { noteId: String(item.id || ''), blockId: null, label: String(item.label || '') },
                };
            ed.chain()
                .focus()
                .deleteRange({ from, to: $from.pos })
                .insertContent(node)
                .run();
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
                if (event.key === 'Escape' || event.key === 'ArrowLeft') {
                    if (this.ref.mode === 'block' && this.ref.level === 'blocks') {
                        this.refBackToNotes();
                    } else {
                        this.closeRef();
                    }
                    return true;
                }
            }
            /*
             * v1.3.3.3（需求：列表里按 Tab 不会缩进）
             *
             * 实时模式里 Tab 默认被浏览器拿去做焦点切换，ProseMirror 不会自己缩进；
             * 这里显式接管：
             *   · 列表项 → 变成子列表（sinkListItem），Shift+Tab 回上一级；
             *   · 代码块 → 插入两个空格（代码里 Tab 就该是缩进）；
             *   · 表格 → 跳到下一个单元格（与 Excel 一致）；
             *   · 其它位置 → 吃掉 Tab，避免焦点跳到页面其它按钮上。
             */
            /*
             * v1.3.3.3（需求：点中图片/视频等文件后，光标要落在文件的右侧）
             * 块级原子节点被选中时没有「文本光标」，按左右键默认会把光标丢到下一行开头。
             * 这里显式接管：右键 → 落在节点之后，左键 → 落在节点之前，
             * 连续按右键还能顺着往后移动。
             */
            if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && this.mode === 'wysiwyg') {
                const ed = this.editor;
                const sel = ed && ed.state.selection;
                if (sel instanceof NodeSelection && MEDIA_NODE_NAMES.includes(sel.node.type.name)) {
                    const to = event.key === 'ArrowRight' ? sel.to : sel.from;
                    const target = Math.min(Math.max(1, to), ed.state.doc.content.size);
                    ed.chain().focus().setTextSelection(target).run();
                    return true;
                }
            }
            /*
             * v1.3.4（需求：列表回车后按删除键，去掉列表图标但保留在列表内部）
             *
             * 原生行为是把这一项整个「抬出」列表（变成列表外面的段落），
             * 用户要的是「变成上一项的下级内容块」—— 也就是 listItem 里
             * 再插一个 paragraph。做法：删掉这个空项，在上一个 li 的末尾插段落。
             */
            if (event.key === 'Backspace' && this.mode === 'wysiwyg' && !event.shiftKey) {
                const ed = this.editor;
                if (!ed) return false;
                const { $from, empty } = ed.state.selection;
                if (!empty) return false;
                const inList = ed.isActive('listItem') || ed.isActive('taskItem');
                if (!inList) return false;
                if ($from.parent.content.size !== 0) return false;
                const item = this.currentListItem();
                if (!item) return false;
                // 只处理「光标在列表项的第一个段落里」
                if ($from.depth - 1 !== item.depth) return false;
                const $item = ed.state.doc.resolve(item.pos);
                if ($item.index() === 0) return false;
                const tr = ed.state.tr;
                const size = item.node.nodeSize;
                try {
                    tr.delete(item.pos, item.pos + size);
                    const para = ed.schema.nodes.paragraph.createAndFill();
                    tr.insert(item.pos - 1, para);
                    tr.setSelection(TextSelection.near(tr.doc.resolve(item.pos)));
                    ed.view.dispatch(tr);
                    ed.view.focus();
                    this.onEditorUpdate();
                } catch (e) {
                    return false;
                }
                return true;
            }
            if (event.key === 'Tab' && this.mode === 'wysiwyg') {
                const ed = this.editor;
                if (!ed) return false;
                const inTable = ed.isActive('table');
                if (inTable) {
                    ed.chain().focus()[event.shiftKey ? 'goToPreviousCell' : 'goToNextCell']().run();
                    return true;
                }
                if (ed.isActive('codeBlock')) {
                    ed.chain().focus().insertContent('  ').run();
                    return true;
                }
                if (ed.isActive('taskItem')) {
                    ed.chain().focus()[event.shiftKey ? 'liftListItem' : 'sinkListItem']('taskItem').run();
                    this.onEditorUpdate();
                    return true;
                }
                if (ed.isActive('listItem')) {
                    ed.chain().focus()[event.shiftKey ? 'liftListItem' : 'sinkListItem']('listItem').run();
                    this.onEditorUpdate();
                    return true;
                }
                /*
                 * 其它位置不抢 Tab：内容区里 Tab 本来就该把焦点交给下一个控件，
                 * 吃掉它会让键盘用户困在编辑器里出不来。
                 */
                return false;
            }
            if (this.slash.open) {
                /*
                 * v1.3.1.1：菜单里可能有分隔线，上下键要跳过它们，
                 * 否则会出现「高亮停在一条线上、回车没反应」。
                 */
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    const step = event.key === 'ArrowDown' ? 1 : -1;
                    const n = this.slash.items.length;
                    if (!n) return true;
                    let i = this.slash.index;
                    for (let k = 0; k < n; k += 1) {
                        i = (i + step + n) % n;
                        if (!this.slash.items[i]?.separator) break;
                    }
                    this.slash.index = i;
                    return true;
                }
                if (event.key === 'Enter') {
                    const cmd = this.slash.items[this.slash.index];
                    if (cmd && !cmd.separator) {
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

        /**
         * 输入工具条定位（v1.3.1.1 需求）。
         *
         * 仅在「光标停在空段落」时出现 —— 有内容时不打扰写作。
         * 浮动而不是吸附在顶部，是因为需求给的参考图就是「贴着光标上方」的样子。
         */
        /**
         * v1.3.3.3：列表 / 标题「行末」操作条的显隐与定位。
         *
         * 判据三条（缺一不可，否则会到处乱浮）：
         *   1) 必须是折叠光标（有选区就让选中浮层去做事）；
         *   2) 光标必须在该文本块的**最末尾**（$from.pos >= $from.end()）；
         *   3) 所在块是标题，或所在行属于列表项（listItem / taskItem）。
         * 位置取光标坐标往上抬 —— 需求要求「显示在光标上方」，
         * 具体高度交给 CSS 的 translateY(-100%)，不用先渲染再测。
         */
        syncLineMenu() {
            const wasOpen = this.lineBar.open;
            const close = () => {
                if (this.lineBar.open) this.lineBar = { open: false, kind: '', style: {}, folded: false, level: 0 };
            };
            const ed = this.editor;
            if (!ed || this.mode !== 'wysiwyg') return close();
            if (this.gutterMenu.open) return close();
            const { state } = ed;
            const { $from, empty } = state.selection;
            if (!empty) return close();
            if ($from.pos < $from.end()) return close();
            /*
             * v1.3.4.1（需求）：只有标识没有内容时不显示行末菜单。
             * 刚敲完 `- [ ]` / `- ` / `##` 时块里是空的，必须输入了实际内容、
             * 且光标停在内容行末，才显示列表 / 标题菜单。
             */
            if (!String($from.parent.textContent || '').trim()) return close();
            const isHeading = $from.parent.type.name === 'heading';
            const inList = ed.isActive('listItem') || ed.isActive('taskItem');
            if (!isHeading && !inList) return close();
            const coords = ed.view.coordsAtPos($from.pos);
            const bodyW = (this.$refs.bodyEl && this.$refs.bodyEl.clientWidth) || window.innerWidth;
            const barW = isHeading ? 268 : 320;
            const left = Math.max(8, Math.min(coords.left, window.innerWidth - barW - 8));
            let folded = false;
            let level = 0;
            if (isHeading) {
                const pos = this.headingPosOf($from);
                folded = pos >= 0 && !!this._folds && this._folds.has(pos);
                level = Number($from.parent.attrs.level) || 0;
            }
            this.lineBar = {
                open: true,
                kind: isHeading ? 'heading' : 'list',
                folded,
                level,
                /*
                 * v1.3.4：刚出现的前 320ms 不吃鼠标。
                 * 这条菜单就浮在光标上方，指针往往正好落在「转换」按钮上，
                 * hover 触发会立刻把下拉展开并抢走焦点 —— 接着敲键盘就全打在按钮上。
                 * 先让指针穿过去，用户真的移进来时再触发。
                 */
                fresh: !wasOpen,
                style: {
                    left: `${Math.round(left)}px`,
                    top: `${Math.round(Math.max(8, coords.top - 6))}px`,
                    maxWidth: `${Math.round(Math.max(180, bodyW * 0.7))}px`,
                },
            };
            if (!wasOpen) {
                setTimeout(() => {
                    if (this.lineBar.open && this.lineBar.fresh) this.lineBar = { ...this.lineBar, fresh: false };
                }, 320);
            }
        },
        /** 光标所在标题块在文档里的位置（找不到返回 -1） */
        headingPosOf($from) {
            for (let d = $from.depth; d > 0; d -= 1) {
                if ($from.node(d).type.name === 'heading') return $from.before(d);
            }
            return -1;
        },
        /** 光标所在列表项的位置与节点（找不到返回 null） */
        currentListItem() {
            const ed = this.editor;
            if (!ed) return null;
            const { $from } = ed.state.selection;
            for (let d = $from.depth; d > 0; d -= 1) {
                const node = $from.node(d);
                if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
                    return { pos: $from.before(d), node, depth: d };
                }
            }
            return null;
        },
        /** 行末操作条的动作分发 */
        lineAction(action) {
            const ed = this.editor;
            if (!ed) return;
            if (this.lineBar.kind === 'heading') {
                if (action === 'fold') {
                    const { $from } = ed.state.selection;
                    const pos = this.headingPosOf($from);
                    if (pos >= 0) {
                        this.toggleFoldAt(pos);
                        /*
                         * v1.3.4.2（需求：折叠后按钮要变成向下箭头）
                         * lineBar.folded 只在 syncLineMenu 里算，折叠本身不发文档事务，
                         * 菜单不会重建，按钮就一直是「向上」。这里折完立刻同步一次状态。
                         */
                        if (this.lineBar.kind === 'heading') {
                            this.lineBar = { ...this.lineBar, folded: !!(this._folds && this._folds.has(pos)) };
                        }
                    }
                    return;
                }
                const level = /^h([2-6])$/.exec(action);
                if (level) {
                    ed.chain().focus().setHeading({ level: Number(level[1]) }).run();
                } else if (action === 'paragraph') {
                    ed.chain().focus().setParagraph().unsetAllMarks().run();
                }
                this.onEditorUpdate();
                return;
            }
            if (action.startsWith('convert:')) return this.convertListAtCursor(action.slice(8));
            if (action === 'indent') return this.runTool('indent');
            if (action === 'outdent') return this.runTool('outdent');
            if (action === 'clearFormat') return this.runTool('clear');
            const item = this.currentListItem();
            if (!item) return;
            if (action === 'addRow') {
                /*
                 * 增加一行：在当前项末尾 splitListItem —— 这是 ProseMirror 给列表的
                 * 原生语义，任务列表（taskItem）同样支持，缩进层级也会自动继承。
                 */
                const name = item.node.type.name;
                ed.chain().focus().splitListItem(name).run();
                this.onEditorUpdate();
                return;
            }
            if (action === 'delRow') {
                ed.chain().focus().deleteRange({ from: item.pos, to: item.pos + item.node.nodeSize }).run();
                this.onEditorUpdate();
                return;
            }
            if (action === 'copyBlock') {
                this.selectBlockAt(item.pos);
                try {
                    document.execCommand('copy');
                } catch (e) {
                    /* 忽略 */
                }
                ElMessage.success(this.$t('memo.listCopyDone'));
                return;
            }
        },

        /**
         * v1.3.4（需求）：任务 / 无序 / 有序列表互相转换。
         *
         * 转换的是光标所在的**整个同级列表**（一个 bulletList / orderedList / taskList 节点
         * 里本来就装着一整段同级项）。做法是原地换掉 list 节点本身：
         *   · 每个 item 的子内容原样搬过去（段落 / 图片 / 子列表都不丢）；
         *   · 转成任务列表时保留 checked（bullet/ordered 没有这个属性，默认 false）；
         *   · 换完把光标放回第一项的文字里，用户能继续敲字。
         */
        convertListAtCursor(target) {
            const ed = this.editor;
            if (!ed || !['bulletList', 'orderedList', 'taskList'].includes(target)) return;
            const { $from } = ed.state.selection;
            let depth = -1;
            for (let d = $from.depth; d > 0; d -= 1) {
                if (['bulletList', 'orderedList', 'taskList'].includes($from.node(d).type.name)) {
                    depth = d;
                    break;
                }
            }
            if (depth < 0) return;
            const list = $from.node(depth);
            if (list.type.name === target) return;
            const pos = $from.before(depth);
            const itemType = target === 'taskList' ? 'taskItem' : 'listItem';
            const items = [];
            list.forEach((item) => {
                items.push({
                    type: itemType,
                    attrs: target === 'taskList' ? { checked: !!item.attrs.checked } : {},
                    content: item.content ? item.content.toJSON() : [{ type: 'paragraph' }],
                });
            });
            let next;
            try {
                next = ed.schema.nodeFromJSON({ type: target, content: items });
            } catch (e) {
                ElMessage.error(this.$t('memo.saveFail'));
                return;
            }
            const tr = ed.state.tr.replaceWith(pos, pos + list.nodeSize, next);
            try {
                tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2)));
            } catch (e) {
                /* 选不中就算了，至少结构已经换掉 */
            }
            ed.view.dispatch(tr);
            ed.view.focus();
            this.onEditorUpdate();
            this.syncLineMenu();
        },

        updateInputBar() {
            const ed = this.editor;
            if (!ed || this.mode !== 'wysiwyg') {
                if (this.inputBar.open) this.inputBar = { open: false, style: {} };
                return;
            }
            if (!this.inputTools.length) {
                if (this.inputBar.open) this.inputBar = { open: false, style: {} };
                return;
            }
            const { state } = ed;
            const { $from, empty } = state.selection;
            /*
             * v1.3.3（需求）：光标工具栏不要出现在表格里 ——
             * 表格有自己的操作条，两条浮层叠在同一个单元格上会互相挡。
             */
            if (ed.isActive('table')) {
                if (this.inputBar.open) this.inputBar = { open: false, style: {} };
                return;
            }
            /*
             * v1.3.3.2（需求）：行号菜单打开时隐藏光标工具栏。
             * 行号点击会把光标塞进那个块；如果那正好是个空段落，
             * updateInputBar 会立刻把工具条又浮出来，两个浮层叠在一起。
             */
            if (this.gutterMenu.open) {
                if (this.inputBar.open) this.inputBar = { open: false, style: {} };
                return;
            }
            /*
             * v1.3.4.1（需求）：光标工具菜单栏只出现在「完全没有内容的空行」。
             * 只要当前行有任意内容（空格、源码标识 `- [ ]` / `- ` / `##`、文本…），
             * 或光标处在内容块里（列表项 / 任务项 / 标题 / 引述 / 代码块 / 表格 / 提示块），
             * 都不显示。原先只判断「paragraph 且 content.size===0」，
             * 在空列表项、空标题里也会弹出来。
             */
            const parent = $from.parent;
            const hasAnyText = String(parent.textContent || '').length > 0;
            let inContentBlock = false;
            for (let d = $from.depth; d > 0; d -= 1) {
                const nm = $from.node(d).type.name;
                if (['listItem', 'taskItem', 'heading', 'blockquote', 'codeBlock', 'table', 'tableRow', 'tableCell', 'tableHeader', 'callout'].includes(nm)) {
                    inContentBlock = true;
                    break;
                }
            }
            const isEmptyLine = empty && parent.type.name === 'paragraph'
                && parent.content.size === 0 && !hasAnyText && !inContentBlock;
            if (!isEmptyLine) {
                if (this.inputBar.open) this.inputBar = { open: false, style: {} };
                return;
            }
            const coords = ed.view.coordsAtPos($from.pos);
            /*
             * 与光标同一行：top 取行的上沿再往下 3px，让工具条垂直居中于这一行；
             * left 让出光标本身与左箭头的位置（+14px）。
             * 右边贴到窗口时把整条往左推，避免出屏（宽度先用经验值 320 兜，真实宽度由 CSS 决定）。
             */
            /*
             * v1.3.2（需求）：
             *   · 箭头与光标间距再拉开 10px（14 → 24）；
             *   · 最大宽度不超过编辑区宽度的 60%；
             *   · 垂直方向让工具条中心对齐光标所在行的中心，箭头才不会偏下。
             * v1.3.3.2（需求）：左侧再让开 5px（24 → 29），箭头不压住行首光标。
             */
            const edW = (this.$refs.bodyEl && this.$refs.bodyEl.clientWidth) || window.innerWidth;
            const maxW = Math.max(160, Math.round(edW * 0.6));
            const barW = Math.min(maxW, 560, Math.max(200, this.inputTools.length * 30 + 16));
            /*
             * v1.3.4.1（需求）：桌面端菜单栏距光标再拉开 15px（29 → 44），
             * 移动端拉开 5px（29 → 34）。只改水平间距，垂直仍与光标同一行居中。
             * v1.3.4.2（需求）：桌面端再拉开 20px（44 → 64）。
             */
            const cursorGap = this.isMobileViewport ? 34 : 64;
            const left = Math.max(8, Math.min(coords.left + cursorGap, window.innerWidth - barW - 8));
            const lineCenter = (coords.top + coords.bottom) / 2;
            this.inputBar = {
                open: true,
                style: {
                    left: `${Math.round(left)}px`,
                    top: `${Math.round(lineCenter - 17)}px`,
                    maxWidth: `${maxW}px`,
                },
            };
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
            /*
             * v1.3.1.1：菜单内容来自「/菜单工具配置」（slashSource）。
             * 分隔线只在没有查询词时保留 —— 搜索状态下夹一条线会让结果看着像断了。
             */
            const base = this.slashSource || SLASH_COMMANDS;
            const items = base.filter((c) => {
                if (c.separator) return !query;
                if (!query) return true;
                if (c.group) {
                    const name = String(c.label || '').toLowerCase();
                    if (name.includes(query)) return true;
                    return (c.tools || []).some((t) =>
                        this.$t(t.label).toLowerCase().includes(query) || String(t.id).toLowerCase().includes(query),
                    );
                }
                return this.$t(c.label).toLowerCase().includes(query) || String(c.id).toLowerCase().includes(query);
            });
            const coords = ed.view.coordsAtPos($from.pos);
            /*
             * v1.3.1.1（需求）：按上下剩余空间决定菜单朝下还是朝上展开。
             * 估算高度 = 条目数 × 32 + 内边距，取大的那一边；两边都不够时仍然朝下，
             * 由 CSS 的 max-height + overflow 出滚动条（不会顶出屏幕）。
             */
            const estHeight = Math.min(360, Math.max(120, items.length * 34 + 16));
            const spaceBelow = window.innerHeight - coords.bottom;
            const openUp = spaceBelow < estHeight && coords.top > spaceBelow;
            this.slash = {
                open: true,
                sub: null,
                index: Math.min(this.slash.index, Math.max(0, items.length - 1)),
                items,
                /*
                 * v1.3.1.2（需求：执行命令后要把 / 字符一起清掉）
                 *
                 * 这里原来算的是 `pos - (len - 1)`，只盖住查询词、没盖住那个 `/` ——
                 * 于是每次用命令都会在正文里留一个孤零零的斜杠。
                 * textBefore 是「行首到光标」的全部文本（= `/` + 查询词），
                 * 整段长度才是要删掉的范围。
                 */
                from: $from.pos - textBefore.length,
                to: $from.pos,
                query,
                style: openUp
                    ? {
                        left: `${Math.round(coords.left)}px`,
                        bottom: `${Math.round(window.innerHeight - coords.top + 6)}px`,
                        maxHeight: `${Math.round(Math.min(estHeight, Math.max(120, coords.top - 12)))}px`,
                    }
                    : {
                        left: `${Math.round(coords.left)}px`,
                        top: `${Math.round(coords.bottom + 6)}px`,
                        maxHeight: `${Math.round(Math.min(estHeight, Math.max(120, spaceBelow - 12)))}px`,
                    },
            };
        },

        closeSlash() {
            if (this.slash.sub) this.slash = { ...this.slash, sub: null, subStyle: {} };
            if (this.slash.open) this.slash = { ...this.slash, open: false, items: [], index: 0, sub: null, subStyle: {} };
        },

        /**
         * v1.3.3：展开 `/` 菜单里的工具组二级菜单。
         *
         * 上一版只在模板里绑了 openSlashGroup，方法本身没有落进 methods
         * （插入位置被另一次改动覆盖），于是 hover / click 都抛
         * "t.openSlashGroup is not a function" —— 这是二级菜单打不开的第一个原因。
         *
         * v1.3.3.2：第二个原因是裁剪 —— 二级菜单绝对定位在 .me-slash-item 里，
         * 而 .me-slash 是 overflow:auto 的滚动容器，超出父级的部分被整块裁掉，
         * 表现成「鼠标移上去 / 点一下都没反应」（其实展开了，只是看不见）。
         * 现在二级菜单 Teleport 到 body 并 position:fixed，位置按组名那一行的
         * 矩形实时算：右侧放不下就翻到左侧，上边越界就往下夹。
         */
        openSlashGroup(cmd, evOrIndex) {
            if (!cmd || !cmd.group) return;
            this.slash = {
                ...this.slash,
                sub: { id: cmd.id, items: cmd.tools || [] },
                subStyle: this.slashSubStyle(evOrIndex),
            };
        },
        /** 鼠标悬停 / 点击组名时的统一入口（先高亮再展开） */
        onSlashGroupHover(index, cmd, ev) {
            if (this.slash.index !== index) this.slash.index = index;
            if (this.slash.sub && this.slash.sub.id === cmd.id) return; // 已经开着，别重复算
            this.openSlashGroup(cmd, ev);
        },
        /** 二级菜单的 fixed 坐标：贴组名右侧，放不下翻左侧 */
        slashSubStyle(evOrIndex) {
            let el = null;
            if (evOrIndex && evOrIndex.currentTarget) el = evOrIndex.currentTarget;
            else if (typeof evOrIndex === 'number') {
                const host = this.$refs.slashEl;
                const rows = host ? host.querySelectorAll('.me-slash-item') : [];
                el = rows[evOrIndex] || null;
            }
            const w = 200;
            if (!el) return { left: '8px', top: '8px', minWidth: `${w}px` };
            const r = el.getBoundingClientRect();
            const toLeft = r.right + 4 + w > window.innerWidth - 8;
            const left = toLeft ? Math.max(8, r.left - w - 4) : r.right + 4;
            const top = Math.min(Math.max(8, r.top - 4), Math.max(8, window.innerHeight - 72));
            return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, minWidth: `${w}px` };
        },

        async applySlash(cmd) {
            if (cmd && cmd.group) {
                // 键盘回车展开组时没有鼠标事件，按条目下标反查那一行的矩形
                const idx = (this.slash.items || []).findIndex((x) => x && x.id === cmd.id);
                return this.openSlashGroup(cmd, idx >= 0 ? idx : undefined);
            }
            const ed = this.editor;
            if (!ed || !cmd || cmd.separator) return;
            const { from, to } = this.slash;
            this.closeSlash();
            // 先删掉「/查询词」再执行命令 —— 否则命令会把斜杠当成正文留在块里
            ed.chain().focus().deleteRange({ from, to }).run();
            /*
             * v1.3.1.2：统一走 runTool。
             *
             * 菜单项现在由 TOOLS 生成，条目上**没有** run 方法（只有工具表里有），
             * 原来这里直接 `cmd.run(ed)` 会对绝大多数工具抛 "cmd.run is not a function"。
             * 交给 runTool 还顺带把「需要弹窗的工具」（图片 / 文件 / 表格 / 表情…）
             * 走同一条分派，不用在菜单里再抄一遍特判。
             */
            this.runTool(cmd.id);
        },

        /**
         * v1.3.3.2：媒体工具条定位（可从滚动回调重复调用）。
         * 以节点矩形为锚，水平居中于节点、垂直贴在节点上方；上方不够就翻到下方。
         */
        placeMediaBar(pos, kind) {
            const ed = this.editor;
            if (!ed) return;
            /*
             * 正常情况下用节点自己的矩形定位。但 nodeDOM 在边界位置（例如媒体就是文档
             * 第一个块、pos = 0）会返回 null，这时退化成「光标坐标」定位 ——
             * 位置略粗，但不会出现「选中了却没有工具条」。
             */
            let r = null;
            const dom = ed.view.nodeDOM(pos);
            if (dom && typeof dom.getBoundingClientRect === 'function') r = dom.getBoundingClientRect();
            if (!r || (!r.width && !r.height)) {
                try {
                    const c = ed.view.coordsAtPos(Math.max(1, pos));
                    r = { left: c.left, right: c.left, top: c.top, bottom: c.bottom, width: 0, height: c.bottom - c.top };
                } catch (e) {
                    return;
                }
            }
            const width = Math.min(360, Math.max(180, this.mediaTools.length * 32));
            const center = r.left + r.width / 2;
            const left = Math.min(Math.max(8, center - width / 2), Math.max(8, window.innerWidth - width - 8));
            const above = r.top - 44 >= 8;
            this.mediaBar = {
                open: true,
                kind,
                pos,
                style: {
                    left: `${Math.round(left)}px`,
                    top: `${Math.round(above ? r.top - 44 : Math.min(r.bottom + 8, window.innerHeight - 48))}px`,
                },
            };
        },

        /**
         * v1.3.3（需求）：选中图片 / 视频 / 音频 / 附件时，浮出一条工具带。
         * 视频 / 音频 / 附件在文档里都是 fileAttachment 节点，按 href 扩展名区分。
         */
        syncMediaBar() {
            const empty = { open: false, style: {}, kind: 'image' };
            const ed = this.editor;
            const host = this.$refs.bodyEl;
            if (!ed || this.mode !== 'wysiwyg' || !host) {
                if (this.mediaBar.open) this.mediaBar = empty;
                return;
            }
            const sel = ed.state.selection;
            if (!(sel instanceof NodeSelection)) {
                if (this.mediaBar.open) this.mediaBar = empty;
                return;
            }
            const name = sel.node.type.name;
            let kind = '';
            if (name === 'image') kind = 'image';
            else if (name === 'fileAttachment') {
                const ext = (/\.([a-z0-9]+)(?:$|[?#])/i.exec(String(sel.node.attrs.href || '')) || [])[1] || '';
                const e = ext.toLowerCase();
                if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(e)) kind = 'video';
                else if (['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'].includes(e)) kind = 'audio';
                else kind = 'file';
            } else if (name === 'video') kind = 'video';
            else if (name === 'audio') kind = 'audio';
            if (!kind) {
                if (this.mediaBar.open) this.mediaBar = empty;
                return;
            }
            const dom = ed.view.nodeDOM(sel.from);
            if (!dom || typeof dom.getBoundingClientRect !== 'function') {
                this.mediaBar = empty;
                return;
            }
            this.placeMediaBar(sel.from, kind);
        },
        /** v1.3.3.2：取当前选中的媒体节点（图片 / 视频 / 音频 / 附件），没有则 null */
        selectedMedia() {
            const ed = this.editor;
            if (!ed) return null;
            const sel = ed.state.selection;
            if (!(sel instanceof NodeSelection)) return null;
            const name = sel.node.type.name;
            if (!['image', 'video', 'audio', 'fileAttachment'].includes(name)) return null;
            const src = name === 'fileAttachment'
                ? String(sel.node.attrs.href || '')
                : String(sel.node.attrs.src || '');
            if (!src) return null;
            const label = name === 'fileAttachment'
                ? String(sel.node.attrs.name || '')
                : (name === 'image' ? String(sel.node.attrs.alt || '') : '');
            return { name, src, label };
        },

        /** `…/file/2026/08/xxx.png` → `2026/08/xxx.png`（本站文件标识） */
        fileIdOfSrc(src) {
            const m = /\/file\/(.+?)(?:[?#]|$)/.exec(String(src || ''));
            return m ? decodeURIComponent(m[1]) : '';
        },

        /**
         * v1.3.4.1（需求）：编辑区媒体默认尺寸。
         * 高度超过编辑区 50% → 按 50% 显示；否则宽度超过编辑区 80% → 按 80%；
         * 都没超就按原尺寸。手动设置过 width 的节点不干预（用户设的优先）。
         */
        applyDefaultMediaSize() {
            const host = this.$refs.bodyEl;
            const dom = this.editor && this.editor.view && this.editor.view.dom;
            if (!host || !dom) return;
            const maxW = host.clientWidth * 0.8;
            const maxH = host.clientHeight * 0.5;
            if (maxW <= 0 || maxH <= 0) return;
            dom.querySelectorAll('img, video').forEach((el) => {
                /* 手动设过宽或高的节点都交给属性本身，默认尺寸规则不插手 */
                if (el.hasAttribute('width') || el.hasAttribute('height')) {
                    el.style.removeProperty('width');
                    el.style.removeProperty('height');
                    return;
                }
                const nw = Number(el.naturalWidth || el.videoWidth || 0);
                const nh = Number(el.naturalHeight || el.videoHeight || 0);
                if (!nw || !nh) return;
                let w = nw;
                if (nh > maxH) w = nw * (maxH / nh);
                else if (nw > maxW) w = maxW;
                el.style.width = `${Math.round(w)}px`;
                el.style.height = 'auto';
            });
        },

        /**
         * v1.3.4.1（需求）：打开编辑区某一类文件的灯箱，收集当前文档里所有同类。
         * 从工具栏进入从第一个开始；点某个文件进入定位到那一个。
         */
        openEditorLightbox(kind, focusPos = null) {
            const ed = this.editor;
            if (!ed) return;
            const found = [];
            ed.state.doc.descendants((node, pos) => {
                if (node.type.name === kind) found.push({ node, pos });
            });
            if (!found.length) return;
            const items = found.map(({ node }) => {
                const src = String(node.attrs.src || '');
                const ext = (/\.([a-z0-9]+)(?:$|[?#])/i.exec(src) || [])[1]?.toLowerCase() || '';
                const fileName = String(node.attrs.alt || '')
                    || decodeURIComponent(String(src).split('/').pop() || '') || '文件';
                return { key: src, name: fileName, url: src, kind, ext, recordId: this.fileIdOfSrc(src) };
            });
            let index = 0;
            if (typeof focusPos === 'number') {
                const i = found.findIndex((f) => f.pos === focusPos);
                if (i >= 0) index = i;
            }
            this.lightbox = { open: true, items, index };
        },

        /** v1.3.4.1：按编辑区尺寸的百分比设置当前选中媒体的宽 / 高 */
        setMediaSizePercent(axis, pct) {
            const ed = this.editor;
            if (!ed) return;
            const name = mediaSelectionName(ed);
            if (!name) return;
            const host = this.$refs.bodyEl;
            const base = axis === 'h'
                ? ((host && host.clientHeight) || window.innerHeight)
                : ((host && host.clientWidth) || window.innerWidth);
            const val = Math.max(20, Math.round(base * (Number(pct) || 0) / 100));
            ed.chain().focus().updateAttributes(name, { [axis === 'h' ? 'height' : 'width']: val }).run();
            this.onEditorUpdate();
        },

        /** v1.3.3.2（需求）：选中文件 → 灯箱预览（复用全站媒体预览浮层） */
        openMediaPreview() {
            const m = this.selectedMedia();
            if (!m) return;
            /*
             * v1.3.4.1（需求）：图片 / 视频 / 音频的灯箱收集**编辑区所有同类**，
             * 不再只显示当前这一个；普通文件仍按单条打开。
             */
            if (m.name === 'image' || m.name === 'video' || m.name === 'audio') {
                const pos = this.editor ? this.editor.state.selection.from : null;
                return this.openEditorLightbox(m.name, pos);
            }
            const ext = (/\.([a-z0-9]+)(?:$|[?#])/i.exec(m.src) || [])[1]?.toLowerCase() || '';
            const VIDEO = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
            const AUDIO = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'];
            const TEXT = ['txt', 'md', 'markdown', 'json', 'csv', 'log', 'yml', 'yaml'];
            let kind = 'other';
            if (m.name === 'image') kind = 'image';
            else if (m.name === 'video') kind = 'video';
            else if (m.name === 'audio') kind = 'audio';
            else if (ext === 'pdf') kind = 'pdf';
            else if (VIDEO.includes(ext)) kind = 'video';
            else if (AUDIO.includes(ext)) kind = 'audio';
            else if (TEXT.includes(ext)) kind = 'text';
            const fileName = m.label || decodeURIComponent(String(m.src).split('/').pop() || '') || '文件';
            const recordId = this.fileIdOfSrc(m.src);
            const item = { key: m.src, name: fileName, url: m.src, kind, ext, recordId };
            this.lightbox = { open: true, items: [item], index: 0 };
        },

        /** v1.3.3.3：灯箱顶栏「详情」/ 移动端下滑 → 打开同一个文件详情页 */
        onLightboxDetail() {
            this.openMediaDetail();
        },

        /**
         * v1.3.3.2（需求）：选中文件 → 文件详情。
         *
         * 先按本站文件标识拉一次元数据（大小 / 渠道 / 上传者才对得上），
         * 拉不到（外部链接、老文件）就用「只有文件名」的最小记录兜底 ——
         * 详情页至少能给出链接与下载，不会点了没反应。
         */
        async openMediaDetail() {
            const m = this.selectedMedia();
            if (!m) return;
            const id = this.fileIdOfSrc(m.src);
            const fallbackName = m.label || decodeURIComponent(String(m.src).split('/').pop() || '') || '文件';
            this.fileDlg = { open: true, file: { name: id || fallbackName, metadata: {} } };
            if (!id) return;
            try {
                const r = await loadFileDetail(id, { record: { name: id }, refresh: true });
                if (r?.file) this.fileDlg = { open: true, file: r.file };
            } catch (e) {
                /* 详情拿不到就停在兜底记录上，不打断用户 */
            }
        },

        /**
         * v1.3.3.2：文本浮层的位置计算（可从滚动回调重复调用）。
         *
         * 需求：①浮层要跟随页面滚动；②左侧不能溢出编辑区左缘。
         * 宽度只能渲染后量（配置里的工具数决定宽度），所以先按中心点摆，
         * 下一帧再用实测宽度夹一次 —— 只夹左缘会让右侧溢出，两头都夹。
         */
        placeSelBubble(from, to) {
            const ed = this.editor;
            if (!ed) return;
            let start;
            let end;
            try {
                start = ed.view.coordsAtPos(from);
                end = ed.view.coordsAtPos(to);
            } catch (e) {
                return;
            }
            const top = Math.min(start.top, end.top) - 46;
            const center = (start.left + end.right) / 2;
            this.bubble = {
                open: true,
                from,
                to,
                style: {
                    left: `${Math.round(center)}px`,
                    top: `${Math.max(8, Math.round(top))}px`,
                    transform: 'translateX(-50%)',
                },
            };
            this.$nextTick(() => this.clampSelBubble());
        },

        /** 用实测宽度把浮层夹进「编辑区左缘 ~ 视口右缘」之间 */
        clampSelBubble() {
            const el = this.$refs.bubbleEl;
            if (!el || !this.bubble.open) return;
            const w = el.offsetWidth || 0;
            if (!w) return;
            const host = this.$refs.bodyEl;
            const hostLeft = host ? host.getBoundingClientRect().left : 0;
            const minCenter = Math.max(8, hostLeft + 4) + w / 2;
            const maxCenter = window.innerWidth - 8 - w / 2;
            const cur = parseFloat(String(this.bubble.style.left || '0')) || 0;
            const next = Math.min(Math.max(cur, minCenter), Math.max(minCenter, maxCenter));
            if (Math.abs(next - cur) > 0.5) {
                this.bubble = { ...this.bubble, style: { ...this.bubble.style, left: `${Math.round(next)}px` } };
            }
        },

        /**
         * v1.3.3.2：页面滚动 / 窗口尺寸变化时，把所有「跟着内容走」的浮层重算一遍。
         *
         * 它们都是 position: fixed + 打开时算死的视口坐标，不重算就会「内容滚走了、
         * 菜单还钉在原地」。右键菜单 / 行号菜单是以鼠标点为锚的，没有文档位置概念，
         * 只要按滚动量做等距平移即可。
         */
        repositionFloats() {
            const ed = this.editor;
            const host = this.$refs.bodyEl;
            if (!ed || !host) return;
            if (this.bubble.open && typeof this.bubble.from === 'number') {
                try {
                    const c = ed.view.coordsAtPos(this.bubble.from);
                    const top = Math.max(8, Math.round(c.top - 46));
                    if (this.bubble.style.top !== `${top}px`) {
                        this.bubble = { ...this.bubble, style: { ...this.bubble.style, top: `${top}px` } };
                    }
                } catch (e) {
                    this.bubble = { ...this.bubble, open: false };
                }
            }
            if (this.mediaBar.open && typeof this.mediaBar.pos === 'number') {
                this.placeMediaBar(this.mediaBar.pos, this.mediaBar.kind);
            }
            if (this.slash.open && typeof this.slash.to === 'number') {
                try {
                    const c = ed.view.coordsAtPos(this.slash.to);
                    const st = this.slash.style || {};
                    const next = st.top
                        ? { top: `${Math.round(c.bottom + 6)}px` }
                        : { bottom: `${Math.round(window.innerHeight - c.top + 6)}px` };
                    this.slash = { ...this.slash, style: { ...st, ...next } };
                } catch (e) {
                    /* 位置失效就不动 */
                }
            }
            if (this.ref.open && typeof this.ref.pos === 'number') {
                try {
                    // v1.3.4.2：滚动时也按上下空间重新择向
                    this.ref = { ...this.ref, style: this.refStyleAt(this.ref.pos) };
                } catch (e) {
                    /* 忽略 */
                }
            }
            const dy = (host.scrollTop || 0) - (this._floatScrollTop || 0);
            if (dy) {
                const shift = (st, key) => {
                    if (!st || typeof st[key] !== 'number') return st;
                    return { ...st, [key]: st[key] - dy };
                };
                if (this.ctxMenu.open) this.ctxMenu = shift(this.ctxMenu, 'y');
                if (this.gutterMenu.open) this.gutterMenu = shift(this.gutterMenu, 'y');
            }
            this._floatScrollTop = host.scrollTop || 0;
            if (this.tableBar.open) this.syncTableBar();
        },

        /** 选中非空时在选区上方显示浮层；位置手算，不用 Tiptap 内置 BubbleMenu */
        onSelectionChange() {
            /*
             * v1.3.4：记住最后一个有效光标位置。
             * 弹窗 / 工具栏按钮抢走焦点后，编辑器 selection 会被重置到文首，
             * 「创建子页并引用」就会把引用插到第一段前面 —— 这里留一份兜底。
             */
            const live = this.editor && this.mode === 'wysiwyg' ? this.editor.state.selection : null;
            if (live && live.from > 1) this._lastSelFrom = live.from;
            // 图片被选中时浮出缩放手柄；其它情况一律收起
            this.syncImgBox();
            this.syncMediaBar();
            this.updateInputBar();
            this.syncTableBar();
            // v1.3.3.3：列表 / 标题末尾的行级操作条
            this.syncLineMenu();
            const ed = this.editor;
            if (!ed || this.mode !== 'wysiwyg') {
                this.bubble.open = false;
                return;
            }
            const { state } = ed;
            const sel = state.selection;
            const { from, to, empty } = sel;
            /*
             * v1.3.2（需求：点别处 / 移到别处后 `[[` 与 `/` 浮层还在）
             * 选区一变就重新判断触发器；光标离开 `[[查询` 或行首 `/` 时自然关闭。
             */
            this.updateRef();
            this.updateSlash();
            /*
             * v1.3.3.2（需求：只有真正选中**文本**时才出文本菜单）
             *
             * 之前只判 `!empty`，而选中图片 / 视频 / 文件是 NodeSelection
             * （from 与 to 差 1、empty=false），于是选中一张图会同时冒出
             * 「文本格式菜单 + 媒体工具条」两套浮层。
             * 这里改成：必须是 TextSelection、且区间里真的有文字。
             */
            if (empty || !(sel instanceof TextSelection)) {
                this.bubble.open = false;
                return;
            }
            const picked = state.doc.textBetween(from, to, '\n', '\n');
            if (!picked || !picked.trim()) {
                this.bubble.open = false;
                return;
            }
            /*
             * v1.3.3.3（需求：内容块是 h 标题时选中文本不显示工具栏）
             * 标题的字号/颜色由「样式设置」统一决定，单段标题不需要逐个调格式；
             * 更重要的是浮层会挡住标题本身，选个标题名想复制都看不见。
             */
            if (ed.isActive('heading')) {
                this.bubble.open = false;
                return;
            }
            this._floatScrollTop = (this.$refs.bodyEl && this.$refs.bodyEl.scrollTop) || 0;
            this.placeSelBubble(from, to);
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
/*
 * v1.3.1.1（需求）：标题 / 元信息 / 标签三块都放在滚动容器顶部，**不吸附**。
 * 标题独占一行（块级），下面两行分别是时间信息与标签。
 */
.me-head {
    /*
     * v1.3.2（需求：标题栏 / 附属栏开启吸附后行为异常）
     *
     * 根因：sticky 元素只能在自己**父元素的高度范围内**吸住。三行原来都包在
     * `.me-head` 里，而 `.me-head` 只有这三行高 —— 一滚过它，标题就被"顶"走了，
     * 看起来像"没吸住"或"吸一下就跑了"。
     * display: contents 让三行直接成为滚动容器（.me-body）的子项，
     * 吸住范围就变成整篇正文；原来的内边距/间距改由每个子块自己承担。
     */
    display: contents;
}
.me-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    /*
     * v1.3.2（需求）：元信息行上下的分隔线间距要均匀，且只保留上面一条。
     * display: contents 之后内边距要自己补；上下都取 6px，视觉上正好居中。
     * v1.3.3.2：标签行改成上下等距（原来只有下边 10px，看着像"吊"在上面）。
     */
    /* v1.3.4.1（需求）：这一行左右内边距与标签行完全一致（4px 16px），内容区更宽 */
    padding: 4px 16px;
    border-top: 1px solid var(--el-border-color-lighter);
    border-bottom: 0;
}
.me-meta-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
}
.me-meta-icon {
    font-size: 11px;
    opacity: 0.7;
}
.me-meta-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 999px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-family: inherit;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
}
.me-meta-btn:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
}
/* 标签行：与瞬间发布页同一套观感（圆角小胶囊 + 内嵌输入） */
.me-tags {
    position: relative;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    /* v1.3.4（需求）：标签行高度在上一版基础上 -4px，标签仍靠 align-items 垂直居中 */
    min-height: 0;
    padding: 4px 16px;
    border-bottom: 1px solid var(--el-border-color-lighter);
}
.me-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 4px 0 8px;
    border-radius: 999px;
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    font-size: 12px;
    line-height: 1;
}
.me-tag-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    font-size: 9px;
    cursor: pointer;
    opacity: 0.7;
}
.me-tag-x:hover {
    opacity: 1;
    background: var(--el-color-primary-light-7);
}
.me-tag-input {
    flex: 1 1 120px;
    min-width: 90px;
    height: 22px;
    border: none;
    outline: none;
    background: transparent;
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: 12px;
}
.me-tag-input::placeholder {
    color: var(--el-text-color-placeholder);
}
.me-tag-suggest {
    position: absolute;
    z-index: 8;
    top: 28px;
    left: 0;
    display: flex;
    flex-direction: column;
    min-width: 160px;
    max-height: 200px;
    overflow: auto;
    padding: 4px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-bg-color-overlay);
    box-shadow: var(--el-box-shadow-light);
}
.me-tag-sug-item {
    padding: 5px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-family: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
}
.me-tag-sug-item:hover {
    background: var(--el-fill-color-light);
    color: var(--el-color-primary);
}

/*
 * 光标工具栏（v1.3.1.2 重做）
 * 贴着光标所在行显示：左侧一枚指向左边的小三角，指的就是光标位置。
 * 与光标「同一行」靠 top 对齐实现（见 updateInputBar），这里只负责外观。
 */
.me-inputbar {
    position: fixed;
    z-index: 2500;
    display: flex;
    align-items: center;
    max-width: calc(100vw - 20px);
    padding: 3px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 9px;
    background: var(--el-bg-color-overlay);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
}
/* 左指三角：旋转一个方块，只露左边那一半 */
.me-inputbar-arrow {
    position: absolute;
    /* v1.3.2：箭头仍贴在工具条左侧（工具条整体已右移 10px，间距随之加大） */
    left: -5px;
    top: 50%;
    width: 9px;
    height: 9px;
    margin-top: -4.5px;
    background: var(--el-bg-color-overlay);
    border-left: 1px solid var(--el-border-color-lighter);
    border-bottom: 1px solid var(--el-border-color-lighter);
    transform: rotate(45deg);
    border-radius: 1px;
}
/* 工具多了横向滑动，不换行 —— 换行会把正文往下顶，破坏「同行」的观感 */
.me-inputbar-scroll {
    display: flex;
    align-items: center;
    gap: 2px;
    /* v1.3.2：宽度上限由 JS 按编辑区 60% 写在 .me-inputbar 上 */
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
}
.me-inputbar-scroll::-webkit-scrollbar {
    display: none;
}
.me-inputbar .me-btn {
    flex: 0 0 auto;
}
/* 工具组下拉按钮：v1.3.1.2 起显示组名 + 倒三角（不再是 …） */
.me-glyph-tool {
    display: inline-block;
    min-width: 14px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
    text-align: center;
}
.me-svg-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
}
.me-svg-icon :deep(svg) {
    width: 100%;
    height: 100%;
}
/*
 * v1.3.3.2（需求：工具组名称被挤压成 30px）
 * `.me-btn` 的 width:30px 写在文件后面，与 `.me-btn-group` 同特异性但更晚生效，
 * 组名「表格工具」被硬塞进 30px。这里提高一级特异性，宽度按文字长度自适应。
 */
.me-btn.me-btn-group {
    width: auto;
    min-width: 30px;
    padding: 0 7px;
    gap: 3px;
}
.me-group-name {
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
}
.me-group-caret {
    font-size: 9px;
    opacity: 0.65;
}
.me-group-icon {
    width: 14px;
    font-size: 12px;
    opacity: 0.8;
}
.me-group-label {
    margin-left: 6px;
    font-size: 13px;
}
/* 斜杠菜单分隔线 */
.me-slash-group {
    position: relative;
}
.me-slash-caret {
    margin-left: auto;
    font-size: 10px;
    opacity: 0.6;
}
/* v1.3.3.2：工具组二级菜单改成独立浮层（fixed），不再被父级 overflow 裁掉 */
.me-slash-sub {
    position: fixed;
    /* v1.3.4.1：二级菜单跟着主菜单一起抬层 */
    z-index: 3502;
    min-width: 200px;
    max-height: 320px;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--el-border-color-light);
    border-radius: 9px;
    background: var(--el-bg-color-overlay);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}
.me-slash-sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--el-border-color-lighter);
}

/*
 * 编辑器独立配色（v1.3.1.1）
 * 「跟随全局」时不加这个类，直接用全站主题变量；选白天 / 黑夜才挂上对应类。
 * 只覆盖编辑器真正用到的几个变量，避免和全站主题互相打架。
 */
.me-root.theme-dark {
    --el-bg-color: #16181d;
    --el-bg-color-overlay: #1f2228;
    --el-bg-color-page: #101216;
    --el-fill-color-blank: #16181d;
    --el-fill-color-light: #23262d;
    --el-text-color-primary: #e6e8ec;
    --el-text-color-regular: #c3c7cf;
    --el-text-color-secondary: #8f96a3;
    --el-text-color-placeholder: #6b7280;
    --el-border-color: #2f333b;
    --el-border-color-lighter: #262a31;
    background: var(--el-bg-color);
    color: var(--el-text-color-primary);
}
.me-root.theme-light {
    --el-bg-color: #ffffff;
    --el-bg-color-overlay: #ffffff;
    --el-fill-color-blank: #ffffff;
    --el-text-color-primary: #1f2329;
    --el-text-color-regular: #4b5563;
    --el-text-color-secondary: #6b7280;
    background: var(--el-bg-color);
    color: var(--el-text-color-primary);
}

/* 工具栏按钮名称浮层（点击后 2 秒消失） */
.me-tooltip {
    position: fixed;
    z-index: 3000;
    transform: translate(-50%, -100%);
    padding: 4px 8px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.78);
    color: #fff;
    font-size: 12px;
    line-height: 1.2;
    white-space: nowrap;
    pointer-events: none;
}

/* ── 表情 / 符号面板（v1.3.1.2） ───────────────────────────── */
.me-glyph {
    display: flex;
    gap: 12px;
    height: 340px;
}
.me-glyph-side {
    flex: 0 0 104px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
    border-right: 1px solid var(--el-border-color-lighter);
    padding-right: 8px;
}
.me-glyph-cat {
    padding: 6px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-family: inherit;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
}
.me-glyph-cat:hover {
    background: var(--el-fill-color-light);
}
.me-glyph-cat.is-active {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    font-weight: 600;
}
.me-glyph-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.me-glyph-search {
    width: 100%;
    box-sizing: border-box;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--el-border-color);
    border-radius: 6px;
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: 13px;
    outline: none;
}
.me-glyph-grid {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
    gap: 4px;
    align-content: start;
}
.me-glyph-item {
    height: 34px;
    border: none;
    border-radius: 6px;
    background: transparent;
    font-size: 19px;
    line-height: 1;
    cursor: pointer;
}
.me-glyph-item:hover {
    background: var(--el-fill-color-light);
}
.me-glyph-empty {
    padding: 20px;
    text-align: center;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

/* ── 查找替换（v1.3.1.2） ─────────────────────────────────── */
.me-find {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.me-find-tip {
    margin: 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

/* ── HTML ↔ MD / HTML 块（v1.3.1.2） ──────────────────────── */
.me-htmlmd {
    display: flex;
    gap: 10px;
    height: 56vh;
}
.me-htmlmd-col {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.me-htmlmd-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
}
.me-htmlmd-text {
    flex: 1 1 auto;
    min-height: 120px;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--el-border-color);
    border-radius: 6px;
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-primary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.6;
    resize: none;
    outline: none;
}

/* ── HTML 块 / 网页嵌入在编辑区里的样子 ───────────────────── */
/* v1.3.4：HTML 块外面加一层「标题行 + 内容」的壳，与代码块同一套观感 */
.me-wysiwyg :deep(.gh-html-block-wrap) {
    margin: 0.7em 0;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-fill-color-lighter);
    overflow: hidden;
}
.me-wysiwyg :deep(.gh-html-bar) {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 6px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    background: var(--el-fill-color-light);
    font-size: 11px;
    color: var(--el-text-color-secondary);
    user-select: none;
}
.me-wysiwyg :deep(.gh-html-label) {
    font-size: 11px;
    letter-spacing: 0.2px;
    opacity: 0.85;
}
.me-wysiwyg :deep(.gh-html-edit) {
    width: auto;
    padding: 0 4px;
}
.me-wysiwyg :deep(.gh-html-block) {
    padding: 10px 12px;
}
.me-wysiwyg :deep(.gh-html-block-wrap.is-collapsed .gh-html-block) {
    display: none;
}
.me-wysiwyg :deep(.gh-html-block-wrap.is-collapsed .gh-html-fold svg) {
    transform: rotate(-90deg);
}
.me-wysiwyg :deep(.gh-html-fold svg) {
    transition: transform 0.15s ease;
}
/*
 * v1.3.3（需求）：HTML / MD 互转页改成视口 98%，移动端上下布局。
 * 桌面左右对照、移动端上 HTML 下 MD —— 横向放两栏在手机上每栏只剩 150px，没法看。
 */
/* v1.3.3.1：这两条 dialog 规则移到文件末尾的非 scoped 块（根节点没有 data-v） */
.me-htmlmd {
    display: flex;
    gap: 10px;
    width: 100%;
    /* v1.3.3.3：撑满弹窗剩余高度，输入框才能「按页面自适应」 */
    flex: 1 1 auto;
    height: 100%;
    min-height: 0;
}
.me-htmlmd-col {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.me-htmlmd-label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.me-htmlmd-text {
    flex: 1 1 auto;
    /* v1.3.3.3：桌面端不再写死 200px 下限，交给容器高度 */
    min-height: 0;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-fill-color-lighter);
    color: var(--el-text-color-primary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px;
    line-height: 1.6;
    resize: none;
}
@media (max-width: 900px) {
    .me-htmlmd {
        flex-direction: column;
    }
    .me-htmlmd-text {
        min-height: 0;
    }
}

.me-wysiwyg :deep(.gh-iframe-config) {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 3;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--el-border-color-light);
    border-radius: 6px;
    background: var(--el-bg-color-overlay);
    color: var(--el-text-color-regular);
    font-size: 13px;
    line-height: 22px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease;
}
.me-wysiwyg :deep(.gh-iframe-wrap:hover .gh-iframe-config) {
    opacity: 1;
}

.me-wysiwyg :deep(.gh-iframe-wrap) {
    /* v1.3.3：齿轮按钮绝对定位，容器必须有定位上下文 */
    position: relative;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    overflow: hidden;
}
.me-wysiwyg :deep(.gh-iframe-wrap iframe) {
    display: block;
    width: 100%;
    border: 0;
}
.me-wysiwyg :deep(.gh-html-empty) {
    color: var(--el-text-color-placeholder);
    font-size: 12px;
}

/* 历史记录弹窗 */
/*
 * v1.3.1.2（需求）：历史弹窗占视口 98%（宽 98vw 由 el-dialog 的 width 给）。
 * 高度这里算：100vh - 顶部 1vh - 标题行 - 底部按钮行，粗略扣 110px，
 * 再把弹窗自身限制成 98vh，就不会顶出屏幕、也不需要页面滚。
 */
/*
 * v1.3.2（需求：历史弹窗宽高改为视口 98%，左右两栏各自独立滚动）
 *
 * 原来的 `.me-history-dialog .el-dialog__body` 没有 `:deep()` —— scoped 样式会把
 * 选择器编译成 `.el-dialog__body[data-v-xxx]`，而 Dialog 的 body 是 Element Plus
 * 自己的节点，不带这个属性，于是那条高度规则从来没生效过：弹窗高度由内容撑，
 * 列表和预览就跟着整个 body 一起滚。
 * 现在用 :deep() 真正把 body 变成 flex 容器，两栏各自 overflow。
 */
/* v1.3.3.1：这两条 dialog 规则移到文件末尾的非 scoped 块（根节点没有 data-v） */
.me-hist-mobile {
    padding-bottom: 8px;
}
.me-hist-select {
    width: 100%;
}
.me-hist-wrap {
    display: flex;
    gap: 12px;
    height: 100%;
    min-height: 0;
}
.me-hist-wrap.is-mobile {
    flex-direction: column;
}
.me-hist-list {
    flex: 0 0 260px;
    max-width: 260px;
    min-height: 0;
    overflow-y: auto;
    border-right: 1px solid var(--el-border-color-lighter);
    padding-right: 8px;
}
.me-hist-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 6px 8px;
    margin-bottom: 4px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    font-family: inherit;
    cursor: pointer;
}
.me-hist-item:hover {
    background: var(--el-fill-color-light);
}
.me-hist-item.is-active {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
}
.me-hist-time {
    font-size: 12px;
    color: var(--el-text-color-primary);
    font-variant-numeric: tabular-nums;
}
.me-hist-meta {
    font-size: 11px;
    color: var(--el-text-color-secondary);
}
.me-hist-title {
    font-size: 11px;
    color: var(--el-text-color-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.me-hist-preview {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
}
.me-hist-preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 6px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.me-hist-preview-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 8px 10px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-fill-color-blank);
    font-size: 13px;
    line-height: 1.7;
}
.me-hist-empty {
    padding: 24px 8px;
    text-align: center;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.me-hist-tip {
    margin-right: auto;
    font-size: 12px;
    color: var(--el-text-color-secondary);
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
    /* v1.3.3.3：行高锁 26px，与 .me-title-row 的 30px 高配合做到垂直居中 */
    line-height: 26px;
    height: 26px;
    padding: 0;
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
    /* v1.3.1.2：工具栏进了滚动容器，默认随内容滚走（设置里可改成吸附） */
    background: var(--el-bg-color);
}

/* ── v1.3.1.2：滚动吸附（工具栏 / 标题栏 / 辅助栏，可分别开关） ─────────
   sticky 的 top 由 stickyTop() 逐个算好写在行内 style 上（上面一行吸住时，
   下面一行要让出它的高度，否则会叠在一起）。这里只负责吸住时的观感：
   压住正文、给底色、补一条分隔线。 */
.me-toolbar-wrap.is-sticky,
.me-title-row.is-sticky,
.me-meta.is-sticky,
.me-toolbar-wrap.is-sticky,
.me-title-row.is-sticky,
.me-meta.is-sticky {
    position: sticky;
    z-index: 6;
    background: var(--el-bg-color);
}
/* 工具栏永远压在最上层；标题其次，附属栏最低（需求：工具栏层级最高） */
.me-toolbar-wrap.is-sticky,
.me-toolbar-wrap.is-sticky {
    z-index: 9;
}
.me-title-row.is-sticky,
.me-title-row.is-sticky {
    z-index: 8;
}
.me-meta.is-sticky,
.me-meta.is-sticky {
    z-index: 7;
}
/*
 * v1.3.4（需求：工具栏 / 标题栏 / 反向链接的层级要高于所有悬浮菜单）
 *
 * 悬浮菜单（标题菜单、列表菜单、选中菜单、光标工具栏…）都是 Teleport 到 body、
 * z-index 2500~3200；工具栏只在本地 z-index 9，必然被盖。
 * 这里只在「有菜单开着」时把它们抬到 3300，平时不动 —— 否则 Element Plus 的
 * 模态弹窗（z-index 2000 级）会被压到工具栏下面。
 * 工具栏自己的下拉浮层用 .me-tb-popper 抬到 3400。
 */
/*
 * v1.3.4.1（需求：悬浮菜单一打开，工具栏 / 标题栏就失去吸附）
 * 上一版为了抬层级给这三个元素统一写了 `position: relative`，
 * 结果把 `.is-sticky` 的 `position: sticky` 覆盖掉了 —— 菜单一开吸附立刻失效。
 * 现在只对「当前没在吸附」的元素补 relative，吸住的那两个保留 sticky，
 * 只抬 z-index，吸附与层级两不误。
 */
.me-root.is-float-open .me-toolbar-wrap:not(.is-sticky),
.me-root.is-float-open .me-title-row:not(.is-sticky) {
    position: relative;
}
.me-root.is-float-open .me-toolbar-wrap,
.me-root.is-float-open .me-title-row,
.me-root.is-float-open .me-backlinks {
    z-index: 3300;
}
.me-root.is-float-open .me-title-row {
    z-index: 3295;
}
/* 下拉浮层是 Teleport 到 body 的，scoped 选择器够不着，必须 :global */
:global(.el-popper.me-tb-popper) {
    z-index: 3400 !important;
}
.me-tooltip {
    z-index: 3400;
}
.me-title-row {
    display: flex;
    align-items: center;
    /*
     * v1.3.4（需求）：标题行高度在上一版 30px 基础上 +4px。
     * 高度变了但文字仍然是 flex 居中 + 26px 行高，所以「标题垂直居中」不受影响。
     */
    /* v1.3.4.1（需求）：标题行行高改为 40px，flex 垂直居中不变 */
    height: 40px;
    padding: 0 16px;
}
.me-title-row.is-sticky {
    /* 标题吸住时补一条极淡的分隔，否则正文会「贴着」标题滑过去 */
    box-shadow: inset 0 -1px 0 var(--el-border-color-lighter);
    height: 40px;
    min-height: 40px;
}
/* 返回顶部按钮：钉在标题行最右侧 */
.me-title-top {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    margin-left: 8px;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
}
.me-title-top:hover {
    background: var(--el-fill-color-light);
    color: var(--el-color-primary);
}
.me-meta.is-sticky,
.me-meta.is-sticky {
    /* v1.3.2：下分隔线已由 .me-tags 承担，这里不再画一条 */
    box-shadow: none;
    padding-bottom: 6px;
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
/*
 * v1.3.4（需求）：移动端工具栏每行左右各 2px；标题行左右各 3px。
 * 桌面端仍保留 8/16px —— 手机屏幕窄，边距每多 1px 都是正文可用宽度。
 */
@media (max-width: 900px) {
    .me-toolbar-wrap {
        padding: 0 2px;
    }
    .me-title-row,
    .me-tags {
        padding-left: 3px;
        padding-right: 3px;
    }
}
/*
 * v1.3.4（需求）：移动端把「编辑/源码/预览」固定在工具栏可视区最右侧。
 * .me-toolbar 是横向滚动容器，sticky right 让它随滚动钉在行尾；
 * 底色用来遮住从它下面滑过去的工具。
 */
.me-mode-tail {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
}
@media (max-width: 900px) {
    .me-mode-tail {
        position: sticky;
        right: 0;
        margin-left: auto;
        padding-left: 4px;
        background: var(--el-bg-color);
        z-index: 2;
    }
}
/* v1.3.4：下拉型工具按钮（字号 / 颜色 / 转换）右侧的小三角 */
.me-btn.me-btn-dd {
    width: auto;
    min-width: 30px;
    padding: 0 4px;
    gap: 1px;
}
.me-dd-caret {
    font-size: 8px;
    opacity: 0.6;
}
/* v1.3.2：桌面端溢出折叠 —— 被折叠的工具从行里移除，改从行末下拉里点 */
.me-toolbar .is-tb-hidden {
    display: none !important;
}
.me-toolbar-more .me-btn {
    width: auto;
    padding: 0 5px;
    gap: 2px;
}
.me-more-count {
    font-size: 10px;
    opacity: 0.7;
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
.me-mode-btn {
    width: auto;
    padding: 0 7px;
    gap: 4px;
}
.me-mode-text {
    font-size: 12px;
}
.me-mode-caret {
    font-size: 10px;
    opacity: 0.65;
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
    /*
     * v1.3.3.3（需求：滚到底部不要继续拉动页面、露出底部背景层）
     * overscroll-behavior 关掉「滚动链」：滚到编辑区底部就停住，
     * 不再把外面的页面一起拖动（移动端那层橡皮筋会把背景拉出来）。
     */
    overscroll-behavior-y: contain;
}
.me-wysiwyg {
    height: 100%;
}
.me-source {
    height: 100%;
    overflow: auto;
    overscroll-behavior-y: contain;
    /* v1.3.1.2（需求）：源码模式内容左对齐（CM6 默认会用 text-align: inherit） */
    text-align: left;
}
.me-source :deep(.cm-editor),
.me-source :deep(.cm-content),
.me-source :deep(.cm-line) {
    text-align: left;
}
.me-preview {
    min-height: 100%;
    padding: 12px 16px 60px;
    overflow-wrap: anywhere;
}

/* 浮层 */
.me-slash {
    position: fixed;
    /* v1.3.4.1：斜杠 / 引用面板层级抬到工具栏、标题栏之上，弹出时才有足够显示空间 */
    z-index: 3500;
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
/* v1.3.4.1：引用面板层级同样抬到工具栏 / 标题栏之上 */
.me-slash.me-ref {
    z-index: 3501;
}
.me-mediabar {
    z-index: 3001;
}

.me-bubble {
    position: fixed;
    z-index: 3000;
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 2px;
    padding: 3px;
    border-radius: 7px;
    background: var(--el-bg-color-overlay);
    border: 1px solid var(--el-border-color-light);
    box-shadow: var(--el-box-shadow-light);
}
/* v1.3.2（需求）：移动端所有悬浮工具栏最宽不超过编辑区的 70%，超出横滑 */
@media (max-width: 900px), (hover: none) {
    .me-bubble,
    .me-tablebar {
        max-width: 70%;
        overflow-x: auto;
        scrollbar-width: none;
    }
    .me-bubble::-webkit-scrollbar,
    .me-tablebar::-webkit-scrollbar {
        display: none;
    }
    .me-inputbar {
        max-width: 70%;
    }
    .me-inputbar-scroll {
        max-width: 100%;
        min-width: 0;
    }
}
.me-bub-sep {
    width: 1px;
    height: 16px;
    margin: 0 3px;
    background: var(--el-border-color-lighter);
}
.me-bub-dd {
    /*
     * v1.3.3.3（需求：下拉三角被挤到下一行）
     * 原来按钮宽度固定、内边距只有 4px，内容一多（图标 + 三角）就换行。
     * 现在宽度随内容自适应，且行内不换行。
     */
    width: auto;
    min-width: 0;
    padding: 0 5px;
    gap: 3px;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
}
/* 文字颜色按钮里的「A」 */
.me-bub-color-a {
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
}
.me-bub-caret {
    font-size: 8px;
    opacity: 0.6;
}
/* v1.3.4：选中浮层里的工具组（组名 + 倒三角） */
.me-bub-group {
    max-width: 72px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
}
.me-bub-t {
    font-size: 13px;
    font-weight: 600;
}
.me-bub-font {
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
}
.me-bub-color-preview {
    width: 13px;
    height: 3px;
    border-radius: 2px;
    background: linear-gradient(90deg, #e04f4f, #f0a020, #2f9e44, #2563eb, #7048e8);
}
.me-color-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
    border-radius: 50%;
    vertical-align: middle;
}
.me-color-dot.is-red { background: #e04f4f; }
.me-color-dot.is-orange { background: #f08c00; }
.me-color-dot.is-yellow { background: #c9a227; }
.me-color-dot.is-green { background: #2f9e44; }
.me-color-dot.is-blue { background: #2563eb; }
.me-color-dot.is-purple { background: #7048e8; }
.me-color-dot.is-gray { background: #868e96; }

/* 引用悬停预览 */
.me-hovercard {
    position: fixed;
    z-index: 2950;
    width: 300px;
    padding: 10px 12px;
    border: 1px solid var(--el-border-color-light);
    border-radius: 10px;
    background: var(--el-bg-color-overlay);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    pointer-events: none;
}
.me-hovercard-title {
    margin-bottom: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.me-hovercard-text {
    font-size: 12.5px;
    line-height: 1.65;
    color: var(--el-text-color-regular);
    max-height: 120px;
    overflow: hidden;
}

/* 嵌入块（惰性渲染） */
.me-wysiwyg :deep(.gh-noteembed) {
    display: block;
    margin: 0.5em 0;
    padding: 8px 10px;
    border-left: 3px solid var(--el-color-primary-light-5);
    border-radius: 0 6px 6px 0;
    background: var(--el-fill-color-lighter);
    font-size: 13px;
    line-height: 1.65;
}
.me-wysiwyg :deep(.gh-noteembed .gh-embed-head) {
    display: block;
    margin-bottom: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--el-color-primary);
}
.me-wysiwyg :deep(.gh-noteembed .gh-embed-body) {
    color: var(--el-text-color-regular);
    white-space: pre-wrap;
}
.me-wysiwyg :deep(.gh-noteembed.is-error) {
    border-left-color: var(--el-color-danger);
}

/* 表格操作条：与选区浮层同一套观感，浮在表格上方 */
.me-tablebar-arrow {
    position: absolute;
    left: 18px;
    bottom: -5px;
    width: 9px;
    height: 9px;
    background: var(--el-bg-color-overlay);
    border-right: 1px solid var(--el-border-color-light);
    border-bottom: 1px solid var(--el-border-color-light);
    transform: rotate(45deg);
}
.me-tablebar.is-below .me-tablebar-arrow {
    bottom: auto;
    top: -5px;
    border-right: none;
    border-bottom: none;
    border-left: 1px solid var(--el-border-color-light);
    border-top: 1px solid var(--el-border-color-light);
}
.me-tablebar {
    position: fixed;
    z-index: 2900;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--el-border-color-light);
    border-radius: 7px;
    background: var(--el-bg-color-overlay);
    box-shadow: var(--el-box-shadow-light);
}

/* 左侧行号栏（v1.3.3.2）：绝对定位覆盖层，按块矩形逐行摆放 */
/* v1.3.3.3：列表 / 标题末尾的行级操作条（浮在光标上方） */
.me-linebar {
    position: fixed;
    z-index: 3100;
    display: flex;
    align-items: center;
    padding: 3px;
    border: 1px solid var(--el-border-color-light);
    border-radius: 8px;
    background: var(--el-bg-color-overlay);
    box-shadow: var(--el-box-shadow-light);
    /* 贴光标上方：用自身高度整体上移，省掉一次「先渲染再测量」 */
    transform: translateY(-100%);
}
/* v1.3.4：刚出现时让指针穿过去，避免「菜单浮在指针下 → hover 展开下拉 → 抢焦点」 */
.me-linebar.is-fresh {
    pointer-events: none;
}
.me-linebar-scroll {
    display: flex;
    align-items: center;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: none;
}
.me-linebar-scroll::-webkit-scrollbar {
    display: none;
}
.me-linebar .me-btn {
    width: 26px;
    height: 26px;
    border-radius: 5px;
}
.me-linebar .me-hbtn {
    width: 26px;
}
/* v1.3.4：「转换」是文字按钮，宽度按内容自适应 */
.me-linebar .me-btn.me-lb-convert {
    width: auto;
    padding: 0 6px;
    gap: 3px;
    font-size: 12px;
}
.me-lb-caret {
    font-size: 8px;
    opacity: 0.6;
}
/* 指向光标的小三角 */
.me-linebar-arrow {
    position: absolute;
    left: 14px;
    bottom: -5px;
    width: 8px;
    height: 8px;
    background: var(--el-bg-color-overlay);
    border-right: 1px solid var(--el-border-color-light);
    border-bottom: 1px solid var(--el-border-color-light);
    transform: rotate(45deg);
}
@media (max-width: 900px) {
    .me-linebar {
        max-width: 92vw;
    }
}

.me-gutter-layer {
    position: absolute;
    left: 0;
    top: 0;
    width: 46px;
    height: 0;
    z-index: 4;
    pointer-events: none;
}
.me-gutter-row {
    position: absolute;
    left: 0;
    display: flex;
    align-items: center;
    /* v1.3.4（需求）：折叠按钮贴住编辑区左边缘，间隔 0 */
    justify-content: flex-start;
    gap: 2px;
    width: 46px;
    height: 20px;
    padding: 0;
}
.me-gutter-fold {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--el-text-color-placeholder);
    font-size: 9px;
    line-height: 1;
    cursor: pointer;
    pointer-events: auto;
    /*
     * v1.3.3.3（需求）：行号常显以后，折叠箭头也跟着常显（低透明度），
     * 否则「有列表能折」这件事没人知道。悬停整行时提亮。
     */
    opacity: 0.5;
    transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.me-gutter-fold.is-folded {
    opacity: 1;
    color: var(--el-color-primary);
}
/* v1.3.4.1：没有折叠功能的行保留第一列占位（隐藏但占位），行号永远是第二列 */
.me-gutter-fold.is-hidden {
    visibility: hidden;
    pointer-events: none;
}
.me-gutter-no {
    flex: 0 0 auto;
    width: 22px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--el-text-color-placeholder);
    font-size: 10px;
    line-height: 20px;
    font-variant-numeric: tabular-nums;
    /* v1.3.3.3（需求）：行号水平居中，不再靠右 */
    text-align: center;
    cursor: pointer;
    pointer-events: auto;
    /* v1.3.3.3（需求）：行号常显，不再随鼠标进出显隐 */
    opacity: 0.75;
    transition: opacity 0.12s ease, background 0.12s ease;
}
/* 悬停时略微提亮（常显状态下的可交互提示） */
.me-gutter-row:hover .me-gutter-no {
    opacity: 1;
}
.me-gutter-row:hover .me-gutter-fold {
    opacity: 1;
}
.me-gutter-no:hover {
    /* v1.3.3.3（需求）：鼠标移到行号上时块操作按钮的底色更深一点 */
    background: var(--el-fill-color-dark);
    color: var(--el-color-primary);
    opacity: 1;
}
.me-gutter-fold:hover {
    background: var(--el-fill-color-dark);
    color: var(--el-color-primary);
    opacity: 1;
}
/* v1.3.3.2：移动端列宽收窄（行号已常显，与桌面同一套规则） */
@media (max-width: 900px) {
    .me-gutter-layer,
    .me-gutter-row {
        width: 40px;
    }
    .me-gutter-no {
        opacity: 0.7;
    }
}
.me-gutter-menu {
    min-width: 140px;
}
/*
 * v1.3.4：列表项自己的折叠按钮。
 * 位置由 syncGutter 按每个 li 的符号中心算好（绝对定位在行号覆盖层里）。
 * 平时完全透明，鼠标移到符号上才出现 —— 不抢正文的注意力，也不挡点选。
 */
.me-listfold-row {
    position: absolute;
    /* v1.3.4.1：贴合行级栏第一列宽度 */
    width: 14px;
    height: 16px;
    pointer-events: auto;
}
.me-listfold-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: var(--el-bg-color);
    color: var(--el-text-color-secondary);
    font-size: 9px;
    line-height: 1;
    cursor: pointer;
    /* v1.3.4：默认半透明常显 —— 「有下级」一眼可见；悬停提亮 */
    opacity: 0.55;
    transition: opacity 0.12s ease, color 0.12s ease;
}
.me-listfold-row:hover .me-listfold-btn {
    opacity: 1;
}
.me-listfold-row.is-folded .me-listfold-btn {
    opacity: 1;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
}
.me-listfold-btn:hover {
    color: var(--el-color-primary);
    background: var(--el-fill-color-dark);
}

/* 右键 / 长按菜单 */
.me-ctx {
    position: fixed;
    z-index: 3100;
    display: flex;
    /* v1.3.4.2（需求）：移动端长按弹出的右键菜单也改成竖版 */
    flex-direction: column;
    align-items: stretch;
    gap: 1px;
    min-width: 168px;
    /* 竖版后按内容宽度收敛，最多 78% 视口宽；纵向超长时自己滚 */
    max-width: min(78vw, 260px);
    max-height: min(70vh, 420px);
    overflow-x: hidden;
    overflow-y: auto;
    padding: 5px;
    border: 1px solid var(--el-border-color-light);
    border-radius: 10px;
    background: var(--el-bg-color-overlay);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    scrollbar-width: none;
}
.me-ctx::-webkit-scrollbar {
    display: none;
}
/*
 * v1.3.3.3（需求）：桌面端右键菜单改回竖版列表。
 * 上一版为了移动端窄屏把菜单压成一条横带，桌面上「一长条」既不好扫读、
 * 也与选中文字浮层的观感割裂。桌面回到竖排（图标 + 文字 + 右侧快捷键），
 * 移动端仍是横带（竖排会顶到屏幕外）。
 */
@media (min-width: 901px) and (hover: hover) {
    .me-ctx {
        flex-direction: column;
        align-items: stretch;
        gap: 1px;
        min-width: 168px;
        max-width: min(320px, 40vw);
        overflow-x: visible;
        overflow-y: auto;
        max-height: 70vh;
        padding: 4px;
    }
    /* 竖排时竖向分隔线 */
    .me-ctx > .me-ctx-sep {
        width: auto;
        height: 1px;
        margin: 3px 6px;
    }
    .me-ctx-item {
        width: 100%;
        justify-content: flex-start;
    }
}
.me-ctx-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: auto;
    flex: 0 0 auto;
    white-space: nowrap;
    /* v1.3.3.3（需求）：字号改小，与选中文字浮层一致（13 → 12px） */
    padding: 5px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: 12px;
    line-height: 18px;
    text-align: left;
    cursor: pointer;
}
.me-ctx-item:hover {
    background: var(--el-fill-color-light);
    color: var(--el-color-primary);
}
.me-ctx-icon {
    width: 14px;
    font-size: 12px;
    opacity: 0.8;
}
.me-ctx-key {
    margin-left: auto;
    font-size: 11px;
    color: var(--el-text-color-secondary);
}
.me-ctx-sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--el-border-color-lighter);
}
/*
 * v1.3.4（需求：移动端行号菜单改竖版）
 * 右键菜单在移动端仍是一条横带（长按弹出的复制/粘贴用横排更顺），
 * 但行号菜单是「对某一行做操作」，竖排才能一眼扫完五项。
 * 用 .me-ctx.me-gutter-menu 提高特异性，压过 .me-ctx 的横排规则。
 */
.me-ctx.me-gutter-menu {
    flex-direction: column;
    align-items: stretch;
    gap: 1px;
    min-width: 150px;
    max-width: min(240px, 76vw);
    max-height: 60vh;
    overflow-x: visible;
    overflow-y: auto;
    padding: 4px;
}
.me-ctx.me-gutter-menu > .me-ctx-item {
    width: 100%;
    justify-content: flex-start;
}
.me-ctx.me-gutter-menu > .me-ctx-sep {
    width: auto;
    height: 1px;
    margin: 3px 6px;
}

/* 插入表格数量选择 */
.me-tablepicker-mask {
    position: fixed;
    inset: 0;
    z-index: 3200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.18);
}
.me-tablepicker {
    padding: 12px;
    border-radius: 12px;
    background: var(--el-bg-color-overlay);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
}
.me-tablepicker-grid {
    display: grid;
    grid-template-columns: repeat(10, 20px);
    grid-auto-rows: 20px;
    gap: 3px;
}
.me-tablepicker-cell {
    width: 20px;
    height: 20px;
    border: 1px solid var(--el-border-color);
    border-radius: 3px;
    background: var(--el-fill-color-blank);
    cursor: pointer;
    padding: 0;
}
.me-tablepicker-cell.is-on {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-8);
}
.me-tablepicker-tip {
    margin-top: 8px;
    text-align: center;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

/* 字号 / 颜色（编辑器与预览各写一份，保证两边一致） */
.me-wysiwyg :deep(.gh-fs-s), .me-preview :deep(.gh-fs-s) { font-size: 0.86em; }
.me-wysiwyg :deep(.gh-fs-m), .me-preview :deep(.gh-fs-m) { font-size: 1em; }
.me-wysiwyg :deep(.gh-fs-l), .me-preview :deep(.gh-fs-l) { font-size: 1.18em; }
.me-wysiwyg :deep(.gh-c-red), .me-preview :deep(.gh-c-red) { color: #e04f4f; }
.me-wysiwyg :deep(.gh-c-orange), .me-preview :deep(.gh-c-orange) { color: #f08c00; }
.me-wysiwyg :deep(.gh-c-yellow), .me-preview :deep(.gh-c-yellow) { color: #c9a227; }
.me-wysiwyg :deep(.gh-c-green), .me-preview :deep(.gh-c-green) { color: #2f9e44; }
.me-wysiwyg :deep(.gh-c-blue), .me-preview :deep(.gh-c-blue) { color: #2563eb; }
.me-wysiwyg :deep(.gh-c-purple), .me-preview :deep(.gh-c-purple) { color: #7048e8; }
.me-wysiwyg :deep(.gh-c-gray), .me-preview :deep(.gh-c-gray) { color: #868e96; }

.me-bub-btn {
    width: 28px;
    height: 26px;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
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
    /*
     * v1.3.3.2（需求：行号要正对内容块）：
     * 左侧留出 46px 给行号栏（0~46px），正文从 46px 起 —— 行号与文字互不重叠，
     * 行号也不会因为负偏移被 .me-body 的 overflow 裁掉。移动端收窄到 40px。
     */
    padding: 14px 18px 80px 46px;
    min-height: 100%;
    font-size: 15px;
    /* v1.3.1.2：行高来自「样式设置」，没设置时还是 1.78 */
    line-height: var(--gh-line-height, 1.78);
    color: var(--el-text-color-primary);
    overflow-wrap: anywhere;
    outline: none;
}
@media (max-width: 900px) {
    .me-wysiwyg :deep(.gh-editor-content),
    .me-preview {
        padding-left: 40px;
    }
}

.me-wysiwyg :deep(.gh-editor-content) > * + *,
.me-preview > * + * {
    margin-top: 0.7em;
}

/* 标题：字号/字重/间距全部走 CSS 变量，v1.4 的样式设置页直接改这些变量即可 */
/*
 * v1.3.3.2（需求：标题上方间隔比下方大）
 * 原来 h1 是 `1.1em 0 0.5em` —— 上 1.1em、下 0.5em，视觉上标题"飘"在段落之间。
 * 现在上下取同一个值（0.5em 一档），标题与上下文的呼吸感一致。
 */
.me-wysiwyg :deep(.gh-editor-content h1),
.me-preview :deep(h1) {
    font-size: var(--gh-h1-size, 1.75em);
    color: var(--gh-h1-color, inherit);
    font-weight: 700;
    line-height: 1.35;
    margin: 0.5em 0;
}
.me-wysiwyg :deep(.gh-editor-content h2),
.me-preview :deep(h2) {
    font-size: var(--gh-h2-size, 1.45em);
    color: var(--gh-h2-color, inherit);
    font-weight: 700;
    line-height: 1.38;
    margin: 0.45em 0;
}
.me-wysiwyg :deep(.gh-editor-content h3),
.me-preview :deep(h3) {
    font-size: var(--gh-h3-size, 1.24em);
    color: var(--gh-h3-color, inherit);
    font-weight: 600;
    /* v1.3.3.2：上下间距取同值（原来 0.9/0.4 上重下轻） */
    margin: 0.4em 0;
}
.me-wysiwyg :deep(.gh-editor-content h4),
.me-preview :deep(h4) {
    font-size: var(--gh-h4-size, 1.1em);
    color: var(--gh-h4-color, inherit);
    font-weight: 600;
    margin: 0.35em 0;
}
.me-wysiwyg :deep(.gh-editor-content h5),
.me-preview :deep(h5) {
    font-size: var(--gh-h5-size, 1em);
    color: var(--gh-h5-color, inherit);
    font-weight: 600;
    margin: 0.3em 0;
}
.me-wysiwyg :deep(.gh-editor-content h6),
.me-preview :deep(h6) {
    font-size: var(--gh-h6-size, 0.94em);
    color: var(--gh-h6-color, var(--el-text-color-secondary));
    font-weight: 600;
    margin: 0.3em 0;
}

/* 列表：缩进与层级线（层级线用伪元素，不引第三方） */
.me-wysiwyg :deep(.gh-editor-content ul),
.me-wysiwyg :deep(.gh-editor-content ol),
.me-preview :deep(ul, ol) {
    padding-left: 1.55em;
    margin: 0.5em 0;
}
/*
 * v1.3.4（需求：列表层级线只保留竖线，且对齐上级图标正下方）
 * ---------------------------------------------------------------------------
 * 上一版是「border-left + li::before 横枝」，横枝在视觉上把每一行都连到竖线，
 * 层级一多就像表格。现在：
 *   · 竖线画在**有下级的 li** 上（::after），从父项符号中心垂直往下；
 *   · 横枝全部去掉；
 *   · 位置按父项符号算：普通列表 -0.75em，任务列表 0.42em（勾选框中心）。
 */
.me-wysiwyg :deep(.gh-editor-content ul ul),
.me-wysiwyg :deep(.gh-editor-content ul ol),
.me-wysiwyg :deep(.gh-editor-content ol ul),
.me-wysiwyg :deep(.gh-editor-content ol ol) {
    position: relative;
    margin-left: 0;
    padding-left: 1.25em;
    border-left: none;
}
.me-wysiwyg :deep(.gh-editor-content li:has(> ul)),
.me-wysiwyg :deep(.gh-editor-content li:has(> ol)),
.me-wysiwyg :deep(.gh-editor-content li:has(> div > ul)),
.me-wysiwyg :deep(.gh-editor-content li:has(> div > ol)) {
    position: relative;
}
.me-wysiwyg :deep(.gh-editor-content li:has(> ul))::after,
.me-wysiwyg :deep(.gh-editor-content li:has(> ol))::after,
.me-wysiwyg :deep(.gh-editor-content li:has(> div > ul))::after,
.me-wysiwyg :deep(.gh-editor-content li:has(> div > ol))::after {
    content: '';
    position: absolute;
    left: -0.75em;
    top: 1.15em;
    bottom: 0.65em;
    width: 1px;
    background: var(--el-border-color);
    pointer-events: none;
}
/* 任务列表的符号是勾选框，中心在 li 内部 ~0.42em，不是外部圆点 */
.me-wysiwyg :deep(.gh-editor-content ul[data-type='taskList'] li:has(> div > ul))::after,
.me-wysiwyg :deep(.gh-editor-content ul[data-type='taskList'] li:has(> div > ol))::after {
    left: 0.42em;
    /*
     * v1.3.4.2（需求：关系线末尾要与最后一个内容齐平）
     * li 的高度还包着子列表的 margin-bottom(0.5em) 与末项 margin(0.18em)，
     * 原来的 0.65em 会让线尾多出一小截。把这段空隙补掉，线就停在最后一行内容下沿。
     */
    bottom: 1.05em;
}
/* 有序列表的数字比圆点宽，竖线再往左一点才对得上数字中心 */
.me-wysiwyg :deep(.gh-editor-content ol > li:has(> ul))::after,
.me-wysiwyg :deep(.gh-editor-content ol > li:has(> ol))::after {
    left: -0.75em;
}
/*
 * v1.3.4.1（需求：任务列表上下级层叠在同一位置）
 * ---------------------------------------------------------------------------
 * 上一版把任务项里的子列表整体左移 1.5em，为的是让子弹点对齐层级竖线；
 * 但任务列表的 li 是 flex 布局，子列表在内容 div 里再往左移就会压到父项
 * 的文字上，多级任务看起来像叠在同一列。这里去掉负外边距，子列表沿用上面
 * 「嵌套列表」的通用规则（margin-left: 0 / padding-left: 1.25em），每一级
 * 都实打实向右让出一格，层级不再重叠。层级竖线仍由 li::after 按勾选框中心
 * （left: 0.42em）绘制，不受这条改动影响。
 */
.me-wysiwyg :deep(.gh-editor-content ul[data-type='taskList'] li > div > ul),
.me-wysiwyg :deep(.gh-editor-content ul[data-type='taskList'] li > div > ol) {
    margin-left: 0;
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
/*
 * v1.3.1.2（需求：勾选框比文字高，没在同一行）
 *
 * 原来是「label 加 margin-top: 0.28em」这种目测偏移 —— 字号或行高一变就错位。
 * 现在让 label 撑满一行的高度、内部垂直居中：勾选框永远落在第一行的中线上，
 * 与文字基线对齐，换字号也不会跑。
 */
.me-wysiwyg :deep(.gh-editor-content ul[data-type='taskList'] li > label) {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    /*
     * v1.3.4（需求：勾选框比文字高一点点）
     * 原来写死 1.7em，而正文行高是 1.78em —— 差 0.08em，勾选框的中心比第一行文字
     * 的中心高约 1px。现在直接跟着正文行高变量走，字号 / 行高怎么改都同一条中线。
     */
    height: calc(1em * var(--gh-line-height, 1.78));
    margin: 0;
}
.me-wysiwyg :deep(.gh-editor-content ul[data-type='taskList'] li > label input) {
    margin: 0;
}
/* v1.3.2（需求：勾选框 / 文字 / 行号三者仍不在一条线上） */
.me-wysiwyg :deep(.gh-editor-content ul[data-type='taskList'] li > div) {
    flex: 1 1 auto;
    min-width: 0;
}
.me-wysiwyg :deep(.gh-editor-content ul[data-type='taskList'] li > div > p:first-child) {
    margin-top: 0;
}
/*
 * v1.3.4（需求）：已完成任务加删除线，取消勾选自动消失。
 * 挂在 li[data-checked] 的**内容容器**上：text-decoration 会作用到所有行内后代，
 * 所以下级列表 / 图片说明里的文字也一起划掉，不用逐层写选择器。
 */
.me-wysiwyg :deep(.gh-editor-content ul[data-type='taskList'] li[data-checked='true'] > div) {
    text-decoration: line-through;
    color: var(--el-text-color-secondary);
}
/* 子任务自己的勾选框不要跟着变灰（它是控件，不是正文） */
.me-wysiwyg :deep(.gh-editor-content ul[data-type='taskList'] li[data-checked='true'] li > label),
.me-wysiwyg :deep(.gh-editor-content ul[data-type='taskList'] li[data-checked='true'] li > div > p) {
    text-decoration: line-through;
}
.me-preview :deep(ul:has(input[type='checkbox']) li) {
    align-items: center;
}
.me-preview :deep(ul:has(input[type='checkbox']) li > input[type='checkbox']) {
    margin: 0 0.4em 0 0;
}

/* v1.3.3.3：创建子文档弹窗 */
.me-subdoc-hint {
    margin: 0 0 10px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.me-subdoc-text {
    width: 100%;
    box-sizing: border-box;
    height: 180px;
    margin-top: 10px;
    padding: 8px 10px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-fill-color-lighter);
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.7;
    resize: vertical;
    outline: none;
}

/* ── v1.3.3.3：代码块（带操作栏） ─────────────────────────────── */
.me-wysiwyg :deep(.gh-codeblock) {
    position: relative;
    margin: 0.7em 0;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-fill-color-lighter);
    overflow: hidden;
}
.me-wysiwyg :deep(.gh-editor-content .gh-cb-bar) {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 6px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    background: var(--el-fill-color-light);
    /* 亮色/深色都保持低对比，别抢代码的注意力 */
    font-size: 11px;
    color: var(--el-text-color-secondary);
    user-select: none;
}
.me-wysiwyg :deep(.gh-cb-lang) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    text-transform: lowercase;
    opacity: 0.85;
}
.me-wysiwyg :deep(.gh-cb-grow) {
    flex: 1 1 auto;
}
/* v1.3.4（需求）：换行 / 复制改成文字按钮，宽度按文字自适应 */
.me-wysiwyg :deep(.gh-cb-btn.gh-cb-wrapbtn),
.me-wysiwyg :deep(.gh-cb-btn.gh-cb-copy) {
    width: auto;
    min-width: 20px;
    padding: 0 4px;
    font-size: 11px;
}
/* 需求：两个按钮之间的间距各加 3px */
.me-wysiwyg :deep(.gh-cb-wrapbtn) {
    margin-right: 3px;
}
.me-wysiwyg :deep(.gh-cb-copy) {
    margin-left: 3px;
}
.me-wysiwyg :deep(.gh-cb-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
}
.me-wysiwyg :deep(.gh-cb-btn:hover) {
    background: var(--el-fill-color-dark);
    color: var(--el-color-primary);
}
.me-wysiwyg :deep(.gh-cb-btn.is-ok) {
    color: var(--el-color-success);
}
.me-wysiwyg :deep(.gh-cb-select) {
    height: 20px;
    padding: 0 2px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 11px;
    cursor: pointer;
}
.me-wysiwyg :deep(.gh-cb-select:hover) {
    border-color: var(--el-border-color-light);
    background: var(--el-bg-color);
}
.me-wysiwyg :deep(.gh-editor-content .gh-cb-pre) {
    position: relative;
    margin: 0;
    /* v1.3.4：左右内边距各 +4px；左侧再让出 38px 给行号列 */
    padding: 10px 16px 10px 42px;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.6;
    /* 去掉原来 codeBlock 的灰底，外壳已经给了 */
    background: transparent;
    white-space: pre;
    tab-size: 4;
}
/* v1.3.4：代码块行号列（纯展示，不参与选中） */
.me-wysiwyg :deep(.gh-cb-lines) {
    position: absolute;
    left: 0;
    top: 10px;
    width: 34px;
    padding-right: 6px;
    text-align: right;
    color: var(--el-text-color-placeholder);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    opacity: 0.7;
    user-select: none;
    pointer-events: none;
}
.me-wysiwyg :deep(.gh-cb-lines > span) {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
}
/* v1.3.4.1：行号列第一列的换行标识（只在换行模式出现） */
.me-wysiwyg :deep(.gh-cb-lf) {
    display: none;
    width: 12px;
    text-align: center;
    font-style: normal;
    font-size: 10px;
    opacity: 0.55;
}
.me-wysiwyg :deep(.gh-codeblock.is-wrap .gh-cb-lf) {
    display: inline-block;
}
.me-wysiwyg :deep(.gh-cb-ln) {
    font-weight: 400;
    min-width: 16px;
    text-align: right;
}
/*
 * v1.3.4.1（需求）：换行模式仍保留行号列，并额外让出 12px 给换行标识。
 * 非换行：padding-left 42px / 行号列 34px；
 * 换行：  padding-left 54px / 行号列 46px。
 */
.me-wysiwyg :deep(.gh-codeblock.is-wrap .gh-cb-pre) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    padding-left: 54px;
}
.me-wysiwyg :deep(.gh-codeblock.is-wrap .gh-cb-lines) {
    display: block;
    width: 46px;
}
/* 收起：只留操作栏 */
.me-wysiwyg :deep(.gh-editor-content .gh-codeblock.is-collapsed .gh-cb-pre) {
    display: none;
}
.me-wysiwyg :deep(.gh-editor-content .gh-codeblock.is-collapsed .gh-cb-lines) {
    display: none;
}
.me-wysiwyg :deep(.gh-codeblock.is-collapsed .gh-cb-fold svg) {
    transform: rotate(-90deg);
}
.me-wysiwyg :deep(.gh-cb-fold svg) {
    transition: transform 0.15s ease;
}
/* 原有 codeBlock 的样式还留在 .gh-code-block 上，这里把外边距与底色让给新外壳。
   v1.3.4：不再重置 padding —— 32px 行号列与 16px 内边距都在 .gh-cb-pre 上，
   这条规则写在后面、特异性又相同，会把它们一起压成 0（实测代码贴左边框）。 */
.me-wysiwyg :deep(.gh-editor-content pre.gh-code-block) {
    margin: 0;
    background: transparent;
}

/* 引述 */
.me-wysiwyg :deep(.gh-editor-content blockquote),
.me-preview :deep(blockquote) {
    /*
     * v1.3.4.1（需求）：行高降为 p 行高的 2 倍；去掉上下内边距，
     * 让左侧竖线从行号处起算、不再高出行号。
     */
    margin: 0.2em 0;
    padding: 0 0 0 0.95em;
    line-height: calc(var(--gh-line-height, 1.75) * 2);
    /* v1.3.4（需求）：去掉底色，左侧竖条加宽一点点 */
    border-left: 4px solid var(--el-color-primary-light-5);
    color: var(--el-text-color-regular);
    background: transparent;
    border-radius: 0;
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
    /* v1.3.1.2（需求）：编辑区里的图片 / 视频不要圆角，保持「内容原样」 */
    border-radius: 0;
    display: block;
}
/* 图片 / 视频的对齐（v1.3.1.2）：与段落对齐同一套值 */
.me-wysiwyg :deep(.gh-editor-content img[align='center']),
.me-preview :deep(img[align='center']) {
    margin-left: auto;
    margin-right: auto;
}
.me-wysiwyg :deep(.gh-editor-content img[align='right']),
.me-preview :deep(img[align='right']) {
    margin-left: auto;
    margin-right: 0;
}
.me-wysiwyg :deep(.gh-editor-content img[align='left']),
.me-preview :deep(img[align='left']) {
    margin-left: 0;
    margin-right: auto;
}
.me-wysiwyg :deep(.gh-editor-content video),
.me-preview :deep(video) {
    border-radius: 0;
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
    /* v1.3.3.3（需求）：视频不要圆角 —— 这条规则特异性比 `video` 高，之前一直压着它 */
    border-radius: 0;
    margin: 0.7em 0;
    background: #000;
}
/* v1.3.3.3（需求）：视频 / 音频 / 附件也要能左中右对齐 */
.me-wysiwyg :deep(.gh-editor-content .gh-video[align='center']),
.me-wysiwyg :deep(.gh-editor-content .gh-audio[align='center']) {
    margin-left: auto;
    margin-right: auto;
}
.me-wysiwyg :deep(.gh-editor-content .gh-video[align='right']),
.me-wysiwyg :deep(.gh-editor-content .gh-audio[align='right']) {
    margin-left: auto;
    margin-right: 0;
}
.me-wysiwyg :deep(.gh-editor-content .gh-video[align='left']),
.me-wysiwyg :deep(.gh-editor-content .gh-audio[align='left']) {
    margin-left: 0;
    margin-right: auto;
}
.me-wysiwyg :deep(.gh-editor-content .gh-audio),
.me-preview :deep(.gh-audio) {
    display: block;
    width: 100%;
    margin: 0.7em 0;
}
.me-wysiwyg :deep(.gh-editor-content .gh-file),
.me-preview :deep(.gh-file) {
    /*
     * v1.3.3.3：附件是**行内**原子（md 里就是句子中的一个 token），
     * 必须保持 inline-flex —— 改成 block/flex 会让它在句子里强制换行。
     * 它的左中右对齐靠「父段落一起对齐」实现（见 TOOLS.align* 注释）。
     */
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
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.4px;
    color: var(--el-text-color-secondary);
}
/* v1.3.4.1：引用面板两级导航 */
.me-ref-back {
    flex: 0 0 auto;
    padding: 0 3px;
    border: none;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
}
.me-ref-back:hover { color: var(--el-color-primary); }
.me-ref-head-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.me-ref-list { max-height: 300px; overflow-y: auto; }
.me-ref-caret { flex: 0 0 auto; margin-left: auto; font-size: 9px; opacity: 0.5; }
/* v1.3.4.1：引用悬浮卡箭头 */
.me-hovercard-arrow {
    position: absolute;
    width: 10px;
    height: 10px;
    background: var(--el-bg-color-overlay);
    border: 1px solid var(--el-border-color-light);
    transform: rotate(45deg);
}
.me-hovercard.is-below .me-hovercard-arrow {
    top: -6px;
    left: 18px;
    border-right: none;
    border-bottom: none;
}
.me-hovercard.is-above .me-hovercard-arrow {
    bottom: -6px;
    left: 18px;
    border-left: none;
    border-top: none;
}
/* v1.3.4.1：块引用内容框 */
/* v1.3.4.2（需求：上下各多一行空白、没对齐行号）——根因是 inline 节点里放 block 元素，
   浏览器会给它补匿名行盒；改成 inline-block + 满宽，行盒高度就等于卡片高度。 */
.me-wysiwyg :deep(.gh-blockref-card) {
    display: inline-block;
    vertical-align: top;
    width: 100%;
    margin: 0;
    box-sizing: border-box;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-fill-color-lighter);
    overflow: hidden;
}
.me-wysiwyg :deep(.gh-br-bar) {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    background: var(--el-fill-color);
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.me-wysiwyg :deep(.gh-br-label) { flex: 0 0 auto; }
/* v1.3.4.2：第一行的来源笔记标题，超长省略，不挤掉右侧按钮 */
.me-wysiwyg :deep(.gh-br-source) {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.8;
}
.me-wysiwyg :deep(.gh-br-body) {
    display: block;
    padding: 6px 10px;
    font-size: 0.95em;
    color: var(--el-text-color-regular);
    white-space: pre-wrap;
}
.me-wysiwyg :deep(.gh-blockref-card.is-collapsed .gh-br-body) { display: none; }
.me-wysiwyg :deep(.gh-blockref-card.is-collapsed .gh-br-fold svg) { transform: rotate(-90deg); }
/* v1.3.4.1：网页嵌入块标题栏与缩放手柄 */
.me-wysiwyg :deep(.gh-iframe-bar) {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    background: var(--el-fill-color);
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.me-wysiwyg :deep(.gh-iframe-label) { flex: 0 0 auto; }
.me-wysiwyg :deep(.gh-iframe-body) { position: relative; }
.me-wysiwyg :deep(.gh-iframe-wrap.is-collapsed .gh-iframe-body) { display: none; }
.me-wysiwyg :deep(.gh-iframe-wrap.is-collapsed .gh-iframe-fold svg) { transform: rotate(-90deg); }
.me-wysiwyg :deep(.gh-iframe-resize) {
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 14px;
    height: 14px;
    border-right: 2px solid var(--el-color-primary);
    border-bottom: 2px solid var(--el-color-primary);
    cursor: nwse-resize;
    opacity: 0;
    transition: opacity 0.12s ease;
}
.me-wysiwyg :deep(.gh-iframe-wrap.is-selected) { outline: 1px dashed var(--el-color-primary); }
.me-wysiwyg :deep(.gh-iframe-wrap.is-selected .gh-iframe-resize) { opacity: 1; }
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
    /* v1.3.4：触屏拖手柄时不要让浏览器把手势当成滚动 —— 会一顿一顿地抖 */
    touch-action: none;
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
.me-backlinks.is-kb-hidden {
    display: none;
}
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

<style>
/*
 * v1.3.3.1（实测修复）：Element Plus 的 el-dialog 根节点不带父组件的 data-v，
 * scoped 里的 `.me-history-dialog` / `.me-htmlmd-dialog` 规则永远匹配不到，
 * 表现是「历史弹窗高度只有 284px、互转页不铺满」。
 * 这里用非 scoped 块承接。注意不能用 `#app` 做前缀：dialog 被 teleport 到 body，
 * 根本不在 #app 的子树里，加了前缀反而一条都匹配不到（这就是第一次没生效的原因）。
 */
.me-history-dialog {
    max-width: 98vw;
    height: 98vh;
    max-height: 98vh !important;
    margin: 1vh auto !important;
    display: flex;
    flex-direction: column;
}
.me-history-dialog .el-dialog__body {
    flex: 1 1 auto;
    min-height: 0;
    height: auto;
    padding-top: 8px;
    padding-bottom: 8px;
    box-sizing: border-box;
    overflow: hidden;
}
.me-history-dialog .el-dialog__header,
.me-history-dialog .el-dialog__footer {
    flex: 0 0 auto;
}

/*
 * v1.3.3.3（需求：互转页移动端宽度不对、桌面端输入框要按页面自适应）
 *   · 宽高统一按**视口 98%** 算，并且显式给 el-dialog 的 --el-dialog-width，
 *     否则 Element Plus 内部还按组件上传的 50% 算一次，移动端就会横向溢出；
 *   · body 撑满剩余高度，里面的两栏再各自 flex 撑满 —— 输入框自然跟着页面变高。
 */
.me-htmlmd-dialog {
    --el-dialog-width: 98vw;
    width: 98vw !important;
    max-width: 98vw;
    height: 98vh;
    max-height: 98vh !important;
    margin: 1vh auto !important;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
}
.me-htmlmd-dialog .el-dialog__body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    padding: 8px 10px;
    box-sizing: border-box;
    overflow: hidden;
}
.me-htmlmd-dialog .el-dialog__footer {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
}
@media (max-width: 900px) {
    .me-htmlmd-dialog {
        --el-dialog-width: 98vw;
        width: 98vw !important;
        max-width: 98vw;
        height: 98vh !important;
        max-height: 98vh !important;
        margin: 1vh auto !important;
    }
    .me-htmlmd-dialog .el-dialog__body {
        padding: 6px;
    }
    .me-htmlmd-dialog .el-dialog__header {
        padding: 10px 12px;
    }
}

/* v1.3.4（需求）：创建子页弹窗 —— 桌面 80vw × 98vh，移动端 98vw × 98vh */
.me-subdoc-dialog {
    --el-dialog-width: 80vw;
    width: 80vw !important;
    max-width: 80vw;
    height: 98vh !important;
    max-height: 98vh !important;
    margin: 1vh auto !important;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
}
.me-subdoc-dialog .el-dialog__body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow: hidden;
}
.me-subdoc-dialog .me-subdoc-text {
    flex: 1 1 auto;
    height: auto;
    min-height: 120px;
    margin-top: 10px;
    resize: none;
}
.me-subdoc-dialog .el-dialog__footer {
    flex: 0 0 auto;
}
@media (max-width: 900px) {
    .me-subdoc-dialog {
        --el-dialog-width: 98vw;
        width: 98vw !important;
        max-width: 98vw;
        height: 98vh !important;
        max-height: 98vh !important;
    }
}
</style>
