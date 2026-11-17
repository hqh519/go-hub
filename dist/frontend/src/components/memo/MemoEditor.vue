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
    <div class="me-root" :class="`theme-${editorTheme}`" :style="styleVars">
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
                        <button
                            v-else-if="toolsOf(token)"
                            type="button"
                            class="me-btn"
                            :data-ti="ti"
                            :class="{
                                'is-active': toolsOf(token).active ? toolsOf(token).active(editor) : false,
                                'is-tb-hidden': isTbHidden(li, ti),
                            }"
                            :title="$t(toolsOf(token).label)"
                            @mousedown.prevent
                            @click="runTool(token, $event)"
                        >
                            <span v-if="token.startsWith('h') && /^h[1-6]$/.test(token)" class="me-hlabel">{{ token.toUpperCase() }}</span>
                            <span v-else-if="token === 'undo'" class="me-svg-icon" v-html="svgUndo"></span>
                            <span v-else-if="token === 'redo'" class="me-svg-icon" v-html="svgRedo"></span>
                            <span v-else-if="token === 'codeBlock'" class="me-svg-icon" v-html="svgCode"></span>
                            <font-awesome-icon v-else-if="toolsOf(token).icon" :icon="toolsOf(token).icon" />
                        </button>
                    </template>
                    <!--
                        v1.3.2（需求）：桌面端工具放不下时，在行末固定一个下拉箭头，
                        点开就是被挤出可视区的那些工具（移动端仍然横滑，不折叠）。
                    -->
                    <el-dropdown
                        v-if="toolbarOverflowTools[li] && toolbarOverflowTools[li].length"
                        trigger="click"
                        placement="bottom-end"
                        class="me-toolbar-more"
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
                        <!-- v1.3.2（需求）：三个模式按钮合并成一个文字下拉框 -->
                        <el-dropdown trigger="click" placement="bottom-end" @command="setMode">
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
                        <button type="button" class="me-btn" :title="$t('memo.save')" @mousedown.prevent @click="saveNow">
                            <font-awesome-icon icon="save" />
                        </button>
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
                </div>
                <div
                    class="me-meta"
                    :class="{ 'is-sticky': isStickyNow('aux') }"
                    :style="{ top: stickyTop('aux') }"
                >
                    <button type="button" class="me-meta-btn" :title="$t('memo.historyOpen')" @click="openHistory">
                        <font-awesome-icon icon="history" class="me-meta-icon" />
                        {{ $t('memo.versionNo', { n: version || 1 }) }}
                    </button>
                    <span class="me-meta-item">
                        <font-awesome-icon icon="clock" class="me-meta-icon" />
                        {{ updatedText }}
                    </span>
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
            <div v-if="slash.open" class="me-slash" :style="slash.style" @mousedown.prevent>
                <template v-for="(cmd, i) in slash.items" :key="cmd.id">
                    <div v-if="cmd.separator" class="me-slash-sep"></div>
                    <!--
                        v1.3.2（需求）：`/` 菜单支持 [组名 a b] 工具组 ——
                        鼠标移上去在右侧展开二级菜单，点组名本身不执行任何命令。
                    -->
                    <div
                        v-else-if="cmd.group"
                        class="me-slash-item me-slash-group"
                        :class="{ 'is-active': i === slash.index }"
                        @mouseenter="slash.index = i; openSlashGroup(cmd)"
                        @click="openSlashGroup(cmd)"
                    >
                        <font-awesome-icon icon="folder" class="me-slash-icon" />
                        <span class="me-slash-label">{{ cmd.label }}</span>
                        <font-awesome-icon icon="caret-right" class="me-slash-caret" />
                        <div v-if="slash.sub && slash.sub.id === cmd.id" class="me-slash-sub" @click.stop>
                            <div
                                v-for="c in slash.sub.items"
                                :key="'sub-' + c.id"
                                class="me-slash-item"
                                @click.stop="applySlash(c)"
                            >
                                <font-awesome-icon v-if="c.icon" :icon="c.icon" class="me-slash-icon" />
                                <span class="me-slash-label">{{ $t(c.label) }}</span>
                                <span class="me-slash-hint">{{ c.hint }}</span>
                            </div>
                        </div>
                    </div>
                    <div
                        v-else
                        class="me-slash-item"
                        :class="{ 'is-active': i === slash.index }"
                        @mouseenter="slash.index = i; slash.sub = null"
                        @click="applySlash(cmd)"
                    >
                    <font-awesome-icon :icon="cmd.icon" class="me-slash-icon" />
                    <span class="me-slash-label">{{ $t(cmd.label) }}</span>
                        <span class="me-slash-hint">{{ cmd.hint }}</span>
                    </div>
                </template>
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
            <!--
                v1.3.1.2（需求）：选中文本时的浮层，按飞书那套顺序排 ——
                标题▾ / 对齐▾ | 加粗 删除线 斜体 下划线 链接 行代码 | 字号▾ 颜色▾ | 批注 发布到瞬间。
            -->
            <!--
                v1.3.3（需求）：选中浮层也改成配置驱动。
                「设置 → 选中文本工具配置」里填什么就渲染什么，没填用内置默认。
                标题 / 对齐 / 字号 / 颜色是复合控件，用保留名 heading / align / fontSize / textColor 表示。
            -->
            <div v-if="bubble.open" class="me-bubble" :style="bubble.style" @mousedown.prevent>
                <template v-for="(it, i) in selItems" :key="`sel-${i}`">
                    <span v-if="it.sep" class="me-bub-sep"></span>
                    <el-dropdown v-else-if="it.id === 'heading'" trigger="click" placement="top-start" @command="(c) => runTool(c)">
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
                    <el-dropdown v-else-if="it.id === 'align'" trigger="click" placement="top-start" @command="(c) => runTool(c)">
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
                    <el-dropdown v-else-if="it.id === 'fontSize'" trigger="click" placement="top-start" @command="setFontSize">
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
                    <el-dropdown v-else-if="it.id === 'textColor'" trigger="click" placement="top-start" @command="setTextColor">
                        <button type="button" class="me-bub-btn me-bub-dd" :title="$t('memo.bubColor')">
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
            <div v-if="hoverCard.open" class="me-hovercard" :style="{ left: `${hoverCard.x}px`, top: `${hoverCard.y}px` }">
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

            <!-- 左侧行级栏的块操作菜单（v1.3.1.2） -->
            <div
                v-if="gutterMenu.open"
                class="me-ctx me-gutter-menu"
                :style="{ left: `${gutterMenu.x}px`, top: `${gutterMenu.y}px` }"
                @mousedown.stop
            >
                <button type="button" class="me-ctx-item" @click="gutterAction('copy')">
                    <font-awesome-icon icon="copy" class="me-ctx-icon" /><span>{{ $t('memo.ctxCopy') }}</span>
                </button>
                <button type="button" class="me-ctx-item" @click="gutterAction('cut')">
                    <font-awesome-icon icon="scissors" class="me-ctx-icon" /><span>{{ $t('memo.ctxCut') }}</span>
                </button>
                <button type="button" class="me-ctx-item" @click="gutterAction('delete')">
                    <font-awesome-icon icon="trash" class="me-ctx-icon" /><span>{{ $t('memo.ctxDelete') }}</span>
                </button>
                <button type="button" class="me-ctx-item" @click="gutterAction('duplicate')">
                    <font-awesome-icon icon="clone" class="me-ctx-icon" /><span>{{ $t('memo.gutterDuplicate') }}</span>
                </button>
                <button type="button" class="me-ctx-item" @click="gutterAction('insertAfter')">
                    <font-awesome-icon icon="plus" class="me-ctx-icon" /><span>{{ $t('memo.gutterInsertAfter') }}</span>
                </button>
                <div class="me-ctx-sep"></div>
                <button type="button" class="me-ctx-item" @click="gutterAction('annotate')">
                    <font-awesome-icon icon="comment-dots" class="me-ctx-icon" /><span>{{ $t('memo.ctxAnnotate') }}</span>
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
                            trigger="click"
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
                            <span v-else-if="t === 'codeBlock'" class="me-svg-icon" v-html="svgCode"></span>
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
        <el-dialog v-model="findDlg.visible" :title="$t('memo.toolFindReplace')" width="480px" append-to-body>
            <div class="me-find">
                <el-input v-model="findDlg.find" :placeholder="$t('memo.findWhat')" clearable @input="countMatches" />
                <el-input v-model="findDlg.replace" :placeholder="$t('memo.replaceWith')" clearable />
                <p class="me-find-tip">
                    <span v-if="findDlg.count">{{ $t('memo.findCount', { n: findDlg.count }) }}</span>
                    <span v-else>{{ findDlg.tip || $t('memo.findHint') }}</span>
                </p>
            </div>
            <template #footer>
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
    </div>
</template>

<script>
import { markRaw } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { Node, Mark, Extension, mergeAttributes } from '@tiptap/core';
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
import UploadTargetDialog from '@/components/upload/UploadTargetDialog.vue';
import { docToMd, mdToDoc, renderMarkdownSafe, plainTextOf } from '@/utils/markdown';
import {
    saveNote,
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

/**
 * 左侧行级栏（gutter，v1.3.1.2）。
 *
 * 每个顶层块的开头放一个零宽的 widget，里面是一枚「⠿」小按钮 ——
 * 它不占布局（width: 0），绝对定位挂在正文左侧，所以不会把文字挤歪。
 * 点它选中该块并弹出块操作菜单（复制 / 剪切 / 删除 / 上下插入空行 / 加批注）。
 *
 * 为什么用 widget 而不是鼠标位置算：
 *   算坐标要在每次滚动、每次输入、每次折叠时重算，稍微漏一次就会「指示器错行」；
 *   widget 由 ProseMirror 自己跟着文档走，永远贴着自己那个块。
 */
const BlockGutter = Extension.create({
    name: 'blockGutter',
    addOptions() {
        return { onOpen: null };
    },
    addProseMirrorPlugins() {
        const opts = this.options;
        return [
            new Plugin({
                key: new PluginKey('blockGutter'),
                props: {
                    decorations(state) {
                        const decos = [];
                        /* v1.3.2（需求）：用行号代替 ⠿ 图标，点击行为不变 */
                        let lineNo = 0;
                        state.doc.forEach((node, offset) => {
                            lineNo += 1;
                            const wrap = document.createElement('span');
                            wrap.className = 'gh-gutter';
                            wrap.contentEditable = 'false';
                            const btn = document.createElement('button');
                            btn.type = 'button';
                            btn.className = 'gh-gutter-btn';
                            btn.title = '块操作';
                            btn.textContent = String(lineNo);
                            btn.addEventListener('mousedown', (e) => e.preventDefault());
                            btn.addEventListener('click', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (typeof opts.onOpen === 'function') {
                                    opts.onOpen(offset, node.type.name, btn);
                                }
                            });
                            wrap.appendChild(btn);
                            decos.push(Decoration.widget(offset + 1, wrap, { side: -1 }));
                        });
                        return DecorationSet.create(state.doc, decos);
                    },
                },
            }),
        ];
    },
});

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
            const dom = document.createElement('div');
            dom.className = 'gh-html-block';
            dom.setAttribute('data-html-block', 'true');
            dom.contentEditable = 'false';
            dom.innerHTML = DOMPurify.sanitize(String(node.attrs.html || ''), {
                ADD_ATTR: ['align', 'target'],
            });
            if (!dom.innerHTML.trim()) {
                dom.innerHTML = '<span class="gh-html-empty">HTML 块（空）</span>';
            }
            return { dom };
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
        return { src: { default: '' }, height: { default: 420 } };
    },
    parseHTML() {
        return [{ tag: 'div[data-embed-iframe]' }];
    },
    addNodeView() {
        return ({ node }) => {
            const wrap = document.createElement('div');
            wrap.className = 'gh-iframe-wrap';
            wrap.setAttribute('data-embed-iframe', 'true');
            wrap.contentEditable = 'false';
            const src = String(node.attrs.src || '');
            if (!/^https?:\/\//i.test(src)) {
                wrap.innerHTML = '<span class="gh-html-empty">嵌入地址无效（只支持 http/https）</span>';
                return { dom: wrap };
            }
            const frame = document.createElement('iframe');
            frame.src = src;
            frame.loading = 'lazy';
            frame.referrerPolicy = 'no-referrer';
            frame.style.height = `${Math.max(120, Number(node.attrs.height) || 420)}px`;
            wrap.appendChild(frame);
            /*
             * v1.3.3（需求）：嵌入区里加一个设置按钮，可以改地址与高度。
             * NodeView 在模块作用域拿不到组件实例，这里靠自定义事件冒泡给编辑器，
             * 由组件弹表单并用 posAtDOM 反查节点位置。
             */
            const gear = document.createElement('button');
            gear.type = 'button';
            gear.className = 'gh-iframe-config';
            gear.title = '嵌入设置';
            gear.textContent = '⚙';
            gear.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                wrap.dispatchEvent(new CustomEvent('gohub:iframe-config', { bubbles: true }));
            });
            wrap.appendChild(gear);
            return {
                dom: wrap,
                update(updated) {
                    if (updated.type.name !== 'iframe') return false;
                    const next = String(updated.attrs.src || '');
                    if (!/^https?:\/\//i.test(next)) return false;
                    frame.src = next;
                    frame.style.height = `${Math.max(120, Number(updated.attrs.height) || 420)}px`;
                    return true;
                }
            };
        };
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
    image: ['alignLeft', 'alignCenter', 'alignRight', '|', 'imgSizeCycle', '|', 'deleteNode'],
    video: ['alignLeft', 'alignCenter', 'alignRight', '|', 'deleteNode'],
    audio: ['alignLeft', 'alignCenter', 'alignRight', '|', 'deleteNode'],
    file: ['alignLeft', 'alignCenter', 'alignRight', '|', 'deleteNode']
};

/** v1.3.3：选中浮层的保留名（复合控件 / 非 TOOLS 动作） */
const SEL_RESERVED = ['heading', 'align', 'fontSize', 'textColor', 'publish'];
const SEL_DEFAULT = [
    'heading', 'align', '|', 'bold', 'strike', 'italic', 'underline', 'link', 'code',
    '|', 'fontSize', 'textColor', '|', 'annotate', 'publish'
];

const CTX_DEFAULT = {
    empty: ['paste', 'pasteKeep', 'pastePlain', 'pasteEscaped', '|', 'selectAll'],
    text: ['copy', 'cut', 'delete', 'annotate', '|', 'bold', 'italic', 'underline', 'strike'],
    paragraph: ['copy', 'cut', 'delete', 'annotate', '|', 'link', '|', 'bold', 'italic', 'underline']
};

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
    codeBlock: { icon: '', label: 'memo.toolCodeBlock', run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e && e.isActive('codeBlock') },
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
         * v1.3.1.2（需求：对齐要对文件生效）：
         * 选中图片（NodeSelection）时改图片的 align，否则改段落的 align。
         * 两者用同一套值，序列化分别落成图片尾部的 {align=...} 与段落的 <p align=...>。
         */
        run: (e) => {
            const sel = e.state.selection;
            if (sel && sel.node && sel.node.type.name === 'image') {
                return e.chain().focus().updateAttributes('image', { align: null }).run();
            }
            return e.chain().focus().updateAttributes('paragraph', { align: null }).run();
        },
        active: (e) => e && (e.isActive('paragraph', { align: null }) || e.isActive('image', { align: null })),
    },
    alignCenter: {
        icon: 'align-center',
        label: 'memo.toolAlignCenter',
        /*
         * v1.3.1.2（需求：对齐要对文件生效）：
         * 选中图片（NodeSelection）时改图片的 align，否则改段落的 align。
         * 两者用同一套值，序列化分别落成图片尾部的 {align=...} 与段落的 <p align=...>。
         */
        run: (e) => {
            const sel = e.state.selection;
            if (sel && sel.node && sel.node.type.name === 'image') {
                return e.chain().focus().updateAttributes('image', { align: 'center' }).run();
            }
            return e.chain().focus().updateAttributes('paragraph', { align: 'center' }).run();
        },
        active: (e) => e && (e.isActive('paragraph', { align: 'center' }) || e.isActive('image', { align: 'center' })),
    },
    alignRight: {
        icon: 'align-right',
        label: 'memo.toolAlignRight',
        /*
         * v1.3.1.2（需求：对齐要对文件生效）：
         * 选中图片（NodeSelection）时改图片的 align，否则改段落的 align。
         * 两者用同一套值，序列化分别落成图片尾部的 {align=...} 与段落的 <p align=...>。
         */
        run: (e) => {
            const sel = e.state.selection;
            if (sel && sel.node && sel.node.type.name === 'image') {
                return e.chain().focus().updateAttributes('image', { align: 'right' }).run();
            }
            return e.chain().focus().updateAttributes('paragraph', { align: 'right' }).run();
        },
        active: (e) => e && (e.isActive('paragraph', { align: 'right' }) || e.isActive('image', { align: 'right' })),
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
            if (e.isActive('listItem')) return e.chain().focus().sinkListItem('listItem').run();
            const { $from } = e.state.selection;
            return e.chain().focus().insertContentAt($from.start(), '\u3000\u3000').run();
        },
    },
    outdent: {
        icon: 'outdent',
        label: 'memo.toolOutdent',
        run: (e) => {
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
    pasteEscaped: { icon: 'code', label: 'memo.toolPasteEscaped', run: (e) => pasteFromClipboard(e, 'escaped') },
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
    selectAll: { icon: 'object-group', label: 'memo.toolSelectAll', run: (e) => e.chain().focus().selectAll().run() },
    /* 日期 / 时间：各格式一个独立工具，点击即插入到光标处 */
    dateYmd: { icon: 'calendar-day', label: 'memo.toolDateYmd', run: null },
    dateSlash: { icon: 'calendar-day', label: 'memo.toolDateSlash', run: null },
    dateDash: { icon: 'calendar-day', label: 'memo.toolDateDash', run: null },
    dateCn: { icon: 'calendar-day', label: 'memo.toolDateCn', run: null },
    timeHms: { icon: 'clock', label: 'memo.toolTimeHms', run: null },
    /* 表情 / 符号面板 */
    emoji: { icon: 'face-smile', label: 'memo.toolEmoji', run: null },
    symbol: { icon: 'font', label: 'memo.toolSymbol', run: null },
    /* 网页嵌入 */
    iframe: { icon: 'window-maximize', label: 'memo.toolIframe', run: null },
    /* 查找替换 */
    findReplace: { icon: 'magnifying-glass', label: 'memo.toolFindReplace', run: null },
    /* HTML ↔ MD 互转 / HTML 块 */
    htmlMd: { icon: 'right-left', label: 'memo.toolHtmlMd', run: null },
    htmlBlock: { icon: 'file-code', label: 'memo.toolHtmlBlock', run: null },
    /* 批注（选中文本后添加） */
    annotate: { icon: 'comment-dots', label: 'memo.toolAnnotate', run: null },
    /* v1.3.3（需求）：媒体选中条用的两个通用动作 */
    imgSizeCycle: {
        icon: 'up-right-and-down-left-from-center',
        label: 'memo.toolImgSize',
        run: (e) => {
            if (!e) return;
            const sel = e.state.selection;
            const node = sel && sel.node;
            if (!node || node.type.name !== 'image') return;
            const cur = Number(node.attrs.width) || 0;
            // 自动 → 600 → 400 → 260 → 自动
            const next = !cur ? 600 : (cur > 500 ? 400 : (cur > 320 ? 260 : 0));
            e.chain().focus().updateAttributes('image', { width: next || null }).run();
        }
    },
    deleteNode: {
        icon: 'trash',
        label: 'memo.ctxDelete',
        run: (e) => e && e.chain().focus().deleteSelection().run()
    },
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
const SVG_REDO =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>';

/** 由 TOOLS 生成完整的命令清单（顺序即 TOOLS 的书写顺序，工具表就是唯一真源） */
const SLASH_COMMANDS = Object.keys(TOOLS).map((id) => ({
    id,
    icon: TOOLS[id].icon || '',
    label: TOOLS[id].label,
    hint: TOOL_HINTS[id] || '',
    separator: false,
}));

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
    components: { EditorContent, FilePickerDialog, UploadTargetDialog },
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
            slash: { open: false, style: {}, index: 0, items: [], from: 0, to: 0, query: '' },
            bubble: { open: false, style: {} },
            /** v1.3.3：选中图片 / 视频 / 音频 / 附件时浮出的工具条 */
            mediaBar: { open: false, style: {}, kind: 'image' },
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
            /* v1.3.1.2：左侧行级栏菜单 */
            gutterMenu: { open: false, x: 0, y: 0, pos: 0, type: '' },
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
            findDlg: { visible: false, find: '', replace: '', count: 0, tip: '' },
            /* ── HTML ↔ MD 互转 ── */
            htmlDlg: { visible: false, html: '', md: '' },
            /* ── HTML 块 ── */
            htmlBlockDlg: { visible: false, html: '' },
            /** 输入工具条（光标停在空行时浮在光标上方） */
            inputBar: { open: false, style: {} },
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
                    out.push({ id, icon: tool.icon, label: tool.label, tool: true });
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
            const kind = this.mediaBar.kind || 'image';
            const keyMap = {
                image: 'selectImageLines',
                video: 'selectVideoLines',
                audio: 'selectAudioLines',
                file: 'selectFileLines'
            };
            const raw = (this.editorConfig?.[keyMap[kind]] || []).join(' ').trim();
            const tokens = raw ? raw.split(/\s+/).filter(Boolean) : (MEDIA_DEFAULT[kind] || MEDIA_DEFAULT.file).slice();
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
                if (tool) {
                    out.push({ id, icon: tool.icon, label: tool.label, tool: true });
                    lastSep = false;
                }
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
            const tokens = raw ? raw.split(/\s+/).filter(Boolean) : SEL_DEFAULT.slice();
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
                if (SEL_RESERVED.includes(id)) {
                    out.push({ id });
                    lastSep = false;
                    return;
                }
                const tool = TOOLS[id];
                if (tool) {
                    out.push({ id, icon: tool.icon, label: tool.label, tool: true });
                    lastSep = false;
                }
            });
            while (out.length && out[out.length - 1].sep) out.pop();
            return out;
        },
        /** v1.3.2：模式下拉框上显示的文字 */
        modeLabel() {
            if (this.mode === 'source') return this.$t('memo.modeSource');
            if (this.mode === 'preview') return this.$t('memo.modePreview');
            return this.$t('memo.modeLive');
        },
        /** 当前生效的吸附配置（按终端取 pc / m 那一组，缺省全部 false） */
        stickyCfg() {
            const all = this.editorConfig?.sticky;
            const key = this.isMobileViewport ? 'm' : 'pc';
            const one = (all && all[key]) || {};
            return {
                toolbar: one.toolbar === true,
                title: one.title === true,
                aux: one.aux === true,
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
            if (this.gutterMenu.open && !hit('.me-gutter-menu') && !hit('.gh-gutter-btn')) this.closeGutter();
            if (!hit('.me-slash') && !hit('.me-wysiwyg')) {
                if (this.ref.open) this.closeRef();
                if (this.slash.open) this.closeSlash();
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
                clearTimeout(this._tbMeasureTimer);
        if (this._tbRaf) cancelAnimationFrame(this._tbRaf);
        if (this._tbRO) {
            this._tbRO.disconnect();
            this._tbRO = null;
        }
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
        }
        window.removeEventListener('resize', this.onViewportChange);
        window.removeEventListener('scroll', this.onViewportChange, true);
        if (this.saveTimer) clearTimeout(this.saveTimer);
        if (this._cssEl && this._cssEl.parentNode) this._cssEl.parentNode.removeChild(this._cssEl);
        this._cssEl = null;
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
                    // v1.3.1.2：HTML 块 / 网页嵌入 / 字号 / 颜色
                    HtmlBlock,
                    IframeBlock,
                    FontSize,
                    TextColor,
                    // v1.3.1.2：左侧行级栏（点开块操作菜单）
                    BlockGutter.configure({ onOpen: (pos, type, el) => this.openGutter(pos, type, el) }),
                    // v1.3.1.1：段落 / 标题对齐（align 属性版）
                    BlockAlign,
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
                    handleTextInput: (view, from, to, text) => this.onEditorTextInput(view, from, to, text),
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
            this.updatedAt = Number(note.updatedAt) || 0;
            this.updateWordCount(md);
            // 换篇时重置历史节流「上次快照」，否则新篇第一分钟不会记历史
            this.lastHistoryMd = md;
            this.startHistoryTimer();
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
        /** 字数：只数中文汉字 + 英文字母（需求原文：不含数字、标点、表情、符号） */
        updateWordCount(md) {
            const s = String(md || '');
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
         * v1.3.3（需求）：吸附矩阵 16 行的统一口径。
         *
         * 正滚：是否吸附完全按设置（工具栏 / 标题栏 / 附属栏各自独立）。
         * 回滚：未开启的栏也临时吸住，回到自己的原始位置后自动脱离。
         * top 偏移按「前面所有当前正在吸附的行」高度累加 —— 所以
         *   · 工具栏吸住时，标题栏贴它最后一行下方；
         *   · 标题栏不吸时，附属栏直接贴工具栏下方（表格 1.2.1 / 1.2.2）；
         *   · 三行都不吸时，谁先吸谁贴顶（表格 2.x）。
         */
        isStickyNow(which) {
            const cfg = this.stickyCfg || {};
            if (cfg[which]) return true;
            return !!this.reverseSticky;
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
            const order = ['toolbar', 'title', 'aux'];
            let top = 0;
            for (const k of order) {
                if (k === which) break;
                if (this.isStickyNow(k)) top += this.stickyHeight(k);
            }
            return `${top}px`;
        },
        /** token 是不是工具组（`[组名 a b]` 解析出来的对象） */
        /**
         * v1.3.2（需求）：关闭吸附不代表永不吸附 ——
         * 往上滚（scrollTop 变大）时不吸，往下回滚（scrollTop 变小）时临时吸住，
         * 回到它自己的原始位置后由 sticky 自动脱离。CSS 只负责"吸"，方向由这个类控制。
         */
        onBodyScroll(e) {
            const el = e && e.target;
            if (!el) return;
            // v1.3.3（需求）：光标工具栏跟随页面滚动，始终贴在光标那一行
            if (this.inputBar.open) this.updateInputBar();
            const top = el.scrollTop || 0;
            const back = top < (this._lastScrollTop || 0) - 1;
            this._lastScrollTop = top;
            if (this.reverseSticky !== back) this.reverseSticky = back;
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

        /** 把一段 md 灌进当前视图（恢复历史 / 冲突解决共用） */
        applyContent(md) {
            const text = String(md || '');
            this.lastMd = text;
            this.charCount = plainTextOf(text).length;
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

        async runTool(token, evt) {
            const tool = TOOLS[token];
            if (!tool) return;
            // 需求：点击顶部按钮时在按钮上方显示名称，2 秒后消失
            if (evt) this.showToolName(token, evt);
            if (token === 'link') return this.insertLink();
            // v1.3.2（需求）：图片工具也要先调出「上传到图床」选择页，不再直接弹文件选择
            if (token === 'image') return this.openUploadPicker();
            if (token === 'upload') return this.openUploadPicker();
            if (token === 'linkExtract') return this.extractLink();
            if (token === 'file' || token === 'video' || token === 'audio') {
                // 三个入口共用一个选文件弹窗，落地类型由文件自身的 mime 决定
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

        openGutter(pos, type, el) {
            const rect = el.getBoundingClientRect();
            this.gutterMenu = {
                open: true,
                x: Math.round(rect.right + 6),
                y: Math.round(rect.top),
                pos,
                type,
            };
            // 顺手把光标放进这个块，后续操作（删除 / 批注）以它为目标
            this.editor?.chain().focus().setTextSelection(pos + 1).run();
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

        /** v1.3.3：改嵌入块的地址与高度（两步输入，避免做一个只为两行的表单弹窗） */
        async editIframe(wrap) {
            const ed = this.editor;
            if (!ed) return;
            let pos = -1;
            try {
                pos = ed.view.posAtDOM(wrap, 0);
                pos -= 1;
            } catch (e) {
                return;
            }
            const node = ed.state.doc.nodeAt(pos);
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
            this.hoverCard = { open: true, x, y, title: '', text: '', loading: true };
            try {
                if (blockId) {
                    const r = await resolveBlock(blockId);
                    this.hoverCard = {
                        open: true,
                        x,
                        y,
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
            // 面板不关：连续插几个表情是常态
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
        openHtmlBlock() {
            const { $from } = this.editor?.state?.selection || {};
            const cur = $from ? $from.parent.type.name : '';
            this.htmlBlockDlg = { visible: true, html: cur === 'htmlBlock' ? String($from.parent.attrs.html || '') : '' };
        },
        saveHtmlBlock() {
            if (!this.editor) return;
            const html = String(this.htmlBlockDlg.html || '');
            if (this.mode !== 'wysiwyg') this.mode = 'wysiwyg';
            const { $from } = this.editor.state.selection;
            if ($from.parent.type.name === 'htmlBlock') {
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
            this.findDlg = { visible: true, find: '', replace: '', count: 0, tip: '' };
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
            if (before === '》') {
                chain.deleteRange({ from: from - 1, to: from }).toggleBlockquote().run();
                return true;
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
            this.ctxMenu = { open: true, x, y, kind };
            return false;
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
            const mode = this.ref.mode;
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
                if (event.key === 'Escape') {
                    this.closeRef();
                    return true;
                }
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
            const isEmptyLine = empty && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0;
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
             */
            const edW = (this.$refs.bodyEl && this.$refs.bodyEl.clientWidth) || window.innerWidth;
            const maxW = Math.max(160, Math.round(edW * 0.6));
            const barW = Math.min(maxW, 560, Math.max(200, this.inputTools.length * 30 + 16));
            const left = Math.max(8, Math.min(coords.left + 24, window.innerWidth - barW - 8));
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
            if (this.slash.sub) this.slash = { ...this.slash, sub: null };
            if (this.slash.open) this.slash = { ...this.slash, open: false, items: [], index: 0 };
        },

        /**
         * v1.3.3：展开 `/` 菜单里的工具组二级菜单。
         *
         * 上一版只在模板里绑了 openSlashGroup，方法本身没有落进 methods
         * （插入位置被另一次改动覆盖），于是 hover / click 都抛
         * "t.openSlashGroup is not a function" —— 这就是二级菜单打不开的真正原因。
         */
        openSlashGroup(cmd) {
            if (!cmd || !cmd.group) return;
            this.slash = { ...this.slash, sub: { id: cmd.id, items: cmd.tools || [] } };
        },

        async applySlash(cmd) {
            if (cmd && cmd.group) return this.openSlashGroup(cmd);
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
            }
            if (!kind) {
                if (this.mediaBar.open) this.mediaBar = empty;
                return;
            }
            const dom = ed.view.nodeDOM(sel.from);
            if (!dom || typeof dom.getBoundingClientRect !== 'function') {
                this.mediaBar = empty;
                return;
            }
            const r = dom.getBoundingClientRect();
            const h = host.getBoundingClientRect();
            const width = Math.min(360, Math.max(180, this.mediaTools.length * 32));
            const center = r.left + r.width / 2;
            const left = Math.min(Math.max(8, center - width / 2), window.innerWidth - width - 8);
            this.mediaBar = {
                open: true,
                kind,
                style: {
                    left: `${Math.round(left)}px`,
                    top: `${Math.round(Math.max(8, r.top - 44))}px`
                }
            };
        },
        /** 选中非空时在选区上方显示浮层；位置手算，不用 Tiptap 内置 BubbleMenu */
        onSelectionChange() {
            // 图片被选中时浮出缩放手柄；其它情况一律收起
            this.syncImgBox();
            this.syncMediaBar();
            this.updateInputBar();
            this.syncTableBar();
            const ed = this.editor;
            if (!ed || this.mode !== 'wysiwyg') {
                this.bubble.open = false;
                return;
            }
            const { state } = ed;
            const { from, to, empty } = state.selection;
            /*
             * v1.3.2（需求：点别处 / 移到别处后 `[[` 与 `/` 浮层还在）
             * 选区一变就重新判断触发器；光标离开 `[[查询` 或行首 `/` 时自然关闭。
             */
            this.updateRef();
            this.updateSlash();
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
     */
    padding: 6px 16px;
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
    min-height: 26px;
    /* v1.3.2（需求）：标签行下方补一条分隔线，与上方元信息行的线形成上下呼应 */
    padding: 0 16px 10px;
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
.me-btn-group {
    width: auto;
    padding: 0 6px;
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
/* v1.3.2：工具组二级菜单，贴在组名右侧 */
.me-slash-sub {
    position: absolute;
    left: calc(100% + 4px);
    top: -4px;
    z-index: 2;
    min-width: 170px;
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
.me-wysiwyg :deep(.gh-html-block) {
    padding: 10px 12px;
    border: 1px dashed var(--el-border-color);
    border-radius: 8px;
    background: var(--el-fill-color-lighter);
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
    min-height: 200px;
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
.me-title-row {
    display: flex;
    align-items: center;
    /* v1.3.2：原 .me-head 的内边距下放（display: contents 后它不再产生盒子） */
    padding: 12px 16px 0;
}
.me-title-row.is-sticky {
    /* 标题吸住时补一条极淡的分隔，否则正文会「贴着」标题滑过去 */
    box-shadow: inset 0 -1px 0 var(--el-border-color-lighter);
    min-height: 40px;
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
}
.me-wysiwyg {
    height: 100%;
}
.me-source {
    height: 100%;
    overflow: auto;
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
.me-mediabar {
    z-index: 3001;
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
    width: auto;
    padding: 0 4px;
    gap: 2px;
}
.me-bub-caret {
    font-size: 8px;
    opacity: 0.6;
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

/* 左侧行级栏（gutter）：零宽 widget，按钮绝对定位挂在正文左侧 */
.me-wysiwyg :deep(.gh-gutter) {
    display: inline-block;
    width: 0;
    /* v1.3.2：行号按块首行的行高定位，任务列表 / 标题也不会上下错位 */
    height: 1.7em;
    position: relative;
    vertical-align: top;
}
.me-wysiwyg :deep(.gh-gutter-btn) {
    position: absolute;
    left: -25px;
    top: 50%;
    transform: translateY(-50%);
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--el-text-color-placeholder);
    font-size: 10px;
    line-height: 20px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s ease, background 0.12s ease;
}
.me-wysiwyg :deep(.gh-editor-content):hover .gh-gutter-btn,
.me-wysiwyg :deep(.gh-gutter-btn:hover) {
    opacity: 1;
}
.me-wysiwyg :deep(.gh-gutter-btn:hover) {
    background: var(--el-fill-color);
    color: var(--el-color-primary);
}
/* v1.3.2（需求）：移动端也显示行号（原来直接隐藏） */
@media (max-width: 900px) {
    .me-wysiwyg :deep(.gh-gutter-btn) {
        display: block;
        opacity: 0.65;
        left: -20px;
        font-size: 9px;
    }
}
.me-gutter-menu {
    min-width: 150px;
}

/* 右键 / 长按菜单 */
.me-ctx {
    position: fixed;
    z-index: 3100;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 2px;
    min-width: 0;
    /* v1.3.2（需求）：右键菜单改成一行；移动端最宽 70%，超出横滑 */
    max-width: min(70vw, 620px);
    overflow-x: auto;
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
.me-ctx-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: auto;
    flex: 0 0 auto;
    white-space: nowrap;
    padding: 6px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: 13px;
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
    /* v1.3.1.2：行高来自「样式设置」，没设置时还是 1.78 */
    line-height: var(--gh-line-height, 1.78);
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
    height: calc(1em * 1.7);
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
.me-preview :deep(ul:has(input[type='checkbox']) li) {
    align-items: center;
}
.me-preview :deep(ul:has(input[type='checkbox']) li > input[type='checkbox']) {
    margin: 0 0.4em 0 0;
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

.me-htmlmd-dialog {
    width: 98vw !important;
    max-width: 98vw;
    height: 98vh;
    max-height: 98vh !important;
    margin: 1vh auto !important;
    display: flex;
    flex-direction: column;
}
.me-htmlmd-dialog .el-dialog__body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    padding: 8px 10px;
    box-sizing: border-box;
}
</style>
