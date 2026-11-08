<template>
    <!--
        v3.0.0：本地文件（只读浏览 + 一键上传到图床）
        ----------------------------------------------------------------------------
        · 数据来源：/api/localfiles/*（渠道 = 后台「存储渠道管理」里 type=localfiles 的渠道）
        · 只读：本页不修改、不删除源目录里的任何文件；勾选后「上传到图床」才会复制一份到图床
        · 上传走主链路（去重 → 压缩/转码 → 写渠道 → 落库 → 签发外链），源文件保持不变
    -->
    <div class="local-files-page" ref="page">
        <!--
            v3.0.0（R7）：顶栏
              · 左侧 = 页面切换下拉（复用后台管理页的切换按钮）+「本地文件」渠道下拉
                （渠道选择记忆到 localStorage，刷新 / 重新进入保持上次选择）
              · 右侧 = 上传到图床（在搜索框之前）→ 搜索 → 类型 → 排序 → 升/降序 →
                刷新 → 设置 → 夜间/日间模式切换
              · 吸附：固定顶部；向下滚动自动上滑隐藏，向上滚动立即出现
        -->
        <header class="lf-topbar" :class="{ 'is-hidden': topbarHidden, 'is-solid': topbarSolid }" ref="topbar">
            <div class="lf-topbar-left">
                <!-- v3.0.0（R9）：移动端目录切换按钮移到第一行最右侧（渠道下拉之后），图标换 folder -->
                <DashboardTabs active-tab="localFiles" />
                <el-select
                    v-if="channels.length"
                    v-model="channelId"
                    class="lf-channel"
                    size="small"
                    :title="$t('localFiles.channelSelect')"
                    @change="onChannelChange"
                >
                    <el-option v-for="c in channels" :key="c.id" :label="c.name" :value="c.id" />
                </el-select>
                <span v-else class="lf-channel-single">{{ $t('localFiles.noChannelShort') }}</span>
                <button
                    type="button"
                    class="lf-icon-btn lf-drawer-toggle lf-mobile-only"
                    :title="$t('localFiles.dirDrawer')"
                    :aria-label="$t('localFiles.dirDrawer')"
                    @click="treeDrawer = true"
                >
                    <font-awesome-icon icon="folder" />
                </button>
            </div>
            <div class="lf-topbar-right">
                <!--
                    v1.0.6：顶栏的「上传到图床」按钮移除 ——
                    选中文件后底部批量操作条里本来就有「上传」，两个入口做同一件事，
                    顶栏这个还常驻占位（未选中时是灰的），反而让人以为顶栏才是主入口。
                -->
                <!-- v3.0.0（R8）：移动端搜索改为按钮（点击在下方展开搜索框，同「文件管理」页效果） -->
                <button
                    type="button"
                    class="lf-icon-btn lf-mobile-search-toggle lf-mobile-only"
                    :class="{ 'is-active': mobileSearchOpen || search }"
                    :title="$t('localFiles.searchPlaceholder')"
                    :aria-label="$t('localFiles.searchPlaceholder')"
                    @click="toggleMobileSearch"
                >
                    <font-awesome-icon icon="search" />
                </button>
                <el-input
                    v-model="search"
                    class="lf-search"
                    size="small"
                    clearable
                    :placeholder="$t('localFiles.searchPlaceholder')"
                    @keyup.enter="applySearch"
                    @clear="applySearch"
                >
                    <template #suffix>
                        <font-awesome-icon icon="search" class="lf-search-icon" @click="applySearch" />
                    </template>
                </el-input>
                <el-select v-model="typeFilter" class="lf-type" size="small" @change="reload(1)">
                    <el-option :label="$t('localFiles.typeAll')" value="" />
                    <el-option :label="$t('localFiles.typeImage')" value="image" />
                    <el-option :label="$t('localFiles.typeVideo')" value="video" />
                    <el-option :label="$t('localFiles.typeAudio')" value="audio" />
                    <el-option :label="$t('localFiles.typeText')" value="text" />
                    <el-option :label="$t('localFiles.typePdf')" value="pdf" />
                    <!-- v3.0.0（R14）：只看「已落库」的文件（后端 type=inlibrary） -->
                    <el-option :label="$t('localFiles.typeInLibrary')" value="inlibrary" />
                    <el-option :label="$t('localFiles.typeOther')" value="other" />
                </el-select>
                <el-select v-model="sortKey" class="lf-sort" size="small" @change="reload(1)">
                    <el-option :label="$t('localFiles.sortName')" value="name" />
                    <el-option :label="$t('localFiles.sortSize')" value="size" />
                    <el-option :label="$t('localFiles.sortMtime')" value="mtime" />
                    <!-- v3.0.0（R12）：按是否落库（已落库在前；切换方向则未落库在前） -->
                    <el-option :label="$t('localFiles.sortInLibrary')" value="inLibrary" />
                </el-select>
                <!--
                    v3.0.0（R7）：排序方向、刷新、设置改为原生按钮 ——
                    el-button 切换 icon 时会带回弹动画 / 焦点框，看起来像「样式闪一下」。
                -->
                <button type="button" class="lf-icon-btn" :title="$t('localFiles.sortOrder')" @click="toggleOrder">
                    <font-awesome-icon :icon="order === 'asc' ? 'sort-alpha-down' : 'sort-alpha-up'" />
                </button>
                <!--
                    v3.0.0（R12）：视图切换（卡片 / 列表）——
                    与「图床文件管理」页同款分段滑块控件（lf-view-toggle），选择记忆到 localStorage。
                -->
                <div class="lf-view-toggle" :class="{ 'is-list': viewMode === 'list' }" role="group">
                    <button
                        type="button"
                        class="lf-view-button"
                        :class="{ 'is-active': viewMode === 'card' }"
                        :title="$t('localFiles.cardView')"
                        :aria-pressed="viewMode === 'card'"
                        @click="setViewMode('card')"
                    >
                        <font-awesome-icon icon="th-large" class="lf-view-icon" />
                    </button>
                    <button
                        type="button"
                        class="lf-view-button"
                        :class="{ 'is-active': viewMode === 'list' }"
                        :title="$t('localFiles.listView')"
                        :aria-pressed="viewMode === 'list'"
                        @click="setViewMode('list')"
                    >
                        <font-awesome-icon icon="list" class="lf-view-icon" />
                    </button>
                </div>
                <button type="button" class="lf-icon-btn" :title="$t('localFiles.refresh')" @click="refreshAll">
                    <font-awesome-icon icon="sync" :class="{ 'fa-spin': loading }" />
                </button>
                <button type="button" class="lf-icon-btn" :title="$t('localFiles.settings')" @click="openSettings">
                    <font-awesome-icon icon="cog" />
                </button>
                <AdminToggleDark class="lf-theme" />
            </div>
        </header>
        <!-- 顶栏固定定位后的占位（保证内容不被遮住） -->
        <div class="lf-topbar-spacer" :style="{ height: topbarHeight + 'px' }"></div>

        <!-- v3.0.0（R8）：移动端展开的搜索框（同「文件管理」页 —— 点搜索按钮才出现） -->
        <div v-if="mobileSearchOpen" class="lf-mobile-search">
            <el-input
                v-model="search"
                size="small"
                clearable
                :placeholder="$t('localFiles.searchPlaceholder')"
                @keyup.enter="applySearch"
                @clear="applySearch"
            >
                <template #suffix>
                    <font-awesome-icon icon="search" class="lf-search-icon" @click="applySearch" />
                </template>
            </el-input>
        </div>

        <div class="lf-body">
            <!-- 左侧目录树：可收起；高度 = 屏幕高度（去掉顶栏），自身滚动且不随页面滚动（固定吸附）
                 v3.0.0（R8）：目录可折叠 / 展开（名称前有展开按钮），移动端可从抽屉打开同一棵树
                 v3.0.0（R12）：外层 .lf-sidebar-ghost 仅占位（宽度跟随收起态），
                     真正的目录栏用 position: fixed 钉在左侧 ——
                     OverlayScrollbars 接管 html 后 body 带了 overflow-y:auto，
                     body 成了「不滚动的滚动容器」，position: sticky 因此永远不会生效
                     （症状就是页面一滚，目录栏跟着滚走）。 -->
            <div class="lf-sidebar-ghost" :class="{ 'is-collapsed': sidebarCollapsed }"></div>
            <aside class="lf-sidebar" :class="{ 'is-collapsed': sidebarCollapsed }">
                <button class="lf-sidebar-toggle" type="button" :title="$t('localFiles.toggleSidebar')" @click="sidebarCollapsed = !sidebarCollapsed">
                    <font-awesome-icon :icon="sidebarCollapsed ? 'chevron-right' : 'chevron-left'" />
                </button>
                <div v-show="!sidebarCollapsed" class="lf-tree">
                    <!-- v3.0.0（R14）：目录上方新增「全部收起 / 全部展开」一键切换 -->
                    <div class="lf-tree-head">
                        <span class="lf-tree-tip">{{ $t('localFiles.treeTitle') }}</span>
                        <button
                            type="button"
                            class="lf-tree-all"
                            :title="allTreeOpen ? $t('localFiles.treeCollapseAll') : $t('localFiles.treeExpandAll')"
                            @click="toggleTreeAll"
                        >
                            <font-awesome-icon :icon="allTreeOpen ? 'compress-alt' : 'expand-alt'" />
                        </button>
                    </div>
                    <button class="lf-tree-item" :class="{ 'is-active': dir === '' }" type="button" @click="enterDir('')">
                        <font-awesome-icon icon="home" class="lf-tree-icon" />{{ $t('localFiles.rootDir') }}
                    </button>
                    <button
                        v-for="node in visibleTreeNodes"
                        :key="node.path"
                        class="lf-tree-item"
                        :class="{ 'is-active': dir === node.path }"
                        type="button"
                        :style="{ paddingLeft: 12 + node.depth * 14 + 'px' }"
                        @click="enterDir(node.path)"
                    >
                        <!-- 展开按钮：有子目录才显示；点击只切换折叠态，不进目录
                             v3.0.0（R12）：箭头方向由 isTreeOpen 统一判断（默认展开 → 朝下旋转 90°） -->
                        <span
                            v-if="node.hasChildren"
                            class="lf-tree-caret"
                            :class="{ 'is-open': isTreeOpen(node.path) }"
                            role="button"
                            :title="$t('localFiles.treeToggle')"
                            @click.stop="toggleTreeNode(node.path)"
                        >
                            <font-awesome-icon icon="chevron-right" />
                        </span>
                        <span v-else class="lf-tree-caret is-leaf"></span>
                        <font-awesome-icon icon="folder" class="lf-tree-icon" />{{ node.label }}
                    </button>
                    <div v-if="!treeDirs.length" class="lf-tree-empty">{{ $t('localFiles.treeEmpty') }}</div>
                </div>
            </aside>

            <section class="lf-main">
                <!-- 面包屑 -->
                <div class="lf-breadcrumb">
                    <button class="lf-crumb" type="button" @click="enterDir('')">{{ $t('localFiles.rootDir') }}</button>
                    <template v-for="(seg, i) in dirSegments" :key="i">
                        <span class="lf-crumb-sep">/</span>
                        <button class="lf-crumb" type="button" @click="enterDir(dirSegments.slice(0, i + 1).join('/'))">{{ seg }}</button>
                    </template>
                    <span class="lf-count">{{ $t('localFiles.totalCount', { n: total }) }}</span>
                    <span v-if="truncated" class="lf-truncated">{{ $t('localFiles.truncated', { n: settings.maxPerDir }) }}</span>
                </div>

                <div v-if="!channels.length" class="lf-empty">
                    <font-awesome-icon icon="folder-open" class="lf-empty-icon" />
                    <p>{{ $t('localFiles.noChannel') }}</p>
                    <p class="lf-empty-hint">{{ $t('localFiles.noChannelHint') }}</p>
                </div>

                <div v-else-if="loading" class="lf-loading">
                    <font-awesome-icon icon="spinner" spin />
                </div>

                <!-- v3.0.0（R8）：目录和文件都没有才算空 —— 之前只有文件为空就报「没有可浏览的文件」，
                     有子目录的目录也被误判为空（目录卡片不渲染的根因） -->
                <div v-else-if="!entries.length && !dirs.length" class="lf-empty">
                    <font-awesome-icon icon="folder-open" class="lf-empty-icon" />
                    <p>{{ $t('localFiles.empty') }}</p>
                </div>

                <!-- v3.0.0（R12）：卡片 / 列表两种视图（视图切换按钮记忆在 localStorage） -->
                <div v-else>
                    <div v-if="viewMode === 'card'" class="lf-grid" :class="{ 'has-selection': selected.length > 0 }">
                        <!-- 目录 -->
                        <div
                            v-for="d in dirs"
                            :key="'d' + d"
                            class="lf-card is-dir"
                            @dblclick="enterDirJoin(d)"
                            @click="enterDirJoin(d)"
                        >
                            <div class="lf-thumb lf-dir-thumb">
                                <font-awesome-icon icon="folder" />
                            </div>
                            <div class="lf-name" :title="d">{{ d }}</div>
                            <!-- v1.0.6：WebDAV 渠道才允许重命名 / 删除 -->
                            <el-dropdown
                                v-if="isWebdavChannel"
                                class="lf-item-menu"
                                trigger="click"
                                placement="bottom-end"
                                @command="(cmd) => onItemCommand(cmd, dirEntry(d))"
                                @click.stop
                            >
                                <button type="button" class="lf-item-menu-btn" :title="$t('localFiles.moreActions')" @click.stop>
                                    <font-awesome-icon icon="ellipsis-h" />
                                </button>
                                <template #dropdown>
                                    <el-dropdown-menu>
                                        <el-dropdown-item command="rename">{{ $t('localFiles.rename') }}</el-dropdown-item>
                                        <el-dropdown-item command="delete" divided>{{ $t('localFiles.delete') }}</el-dropdown-item>
                                    </el-dropdown-menu>
                                </template>
                            </el-dropdown>
                        </div>
                        <!-- 文件
                             v3.0.0（R12）：
                             · 移除左上角「已入库」打勾角标（选中圆圈已能表达选中态，重复）；
                             · 右下角时间在已落库时替换为「已落库」；
                             · 文件名与文件管理页同款「开头…结尾」中段省略。 -->
                        <div
                            v-for="f in entries"
                            :key="f.path"
                            class="lf-card"
                            :class="{ 'is-selected': isSelected(f.path) }"
                        >
                            <span
                                class="lf-select"
                                role="checkbox"
                                :aria-checked="isSelected(f.path)"
                                :title="$t('localFiles.selectedCount', { n: selected.length })"
                                @click.stop="toggleSelect(f, $event)"
                                @mousedown.stop
                            >
                                <font-awesome-icon icon="check" />
                            </span>
                            <div class="lf-thumb" @click="openPreview(f)">
                                <img v-if="f.type === 'image'" :src="previewUrl(f)" :alt="f.name" loading="lazy" />
                                <!--
                                    v3.0.0（R7）：视频缩略图 —— 用 <video preload="metadata">
                                    取首帧（#t=0.5 定位到第 0.5 秒，避免纯黑首帧）。
                                    之前视频只显示一个图标，根本看不出内容。
                                -->
                                <video
                                    v-else-if="f.type === 'video'"
                                    class="lf-thumb-video"
                                    :src="videoThumbUrl(f)"
                                    preload="metadata"
                                    muted
                                    playsinline
                                ></video>
                                <font-awesome-icon v-else :icon="iconOf(f)" class="lf-thumb-icon" />
                            </div>
                            <div class="lf-name" :title="f.name" @click="onEntryNameClick(f)">
                                <span class="name-start">{{ nameParts(f.name).start }}</span><span class="name-end">{{ nameParts(f.name).end }}</span>
                            </div>
                            <div class="lf-meta">
                                <span>{{ formatSize(f.size) }}</span>
                                <span v-if="f.inLibrary" class="lf-meta-inlib">{{ $t('localFiles.uploadedMark') }}</span>
                                <span v-else>{{ formatTime(f.mtime) }}</span>
                            </div>
                            <!-- v1.0.6：WebDAV 渠道才允许重命名 / 删除 -->
                            <el-dropdown
                                v-if="isWebdavChannel"
                                class="lf-item-menu"
                                trigger="click"
                                placement="bottom-end"
                                @command="(cmd) => onItemCommand(cmd, f)"
                                @click.stop
                            >
                                <button type="button" class="lf-item-menu-btn" :title="$t('localFiles.moreActions')" @click.stop>
                                    <font-awesome-icon icon="ellipsis-h" />
                                </button>
                                <template #dropdown>
                                    <el-dropdown-menu>
                                        <el-dropdown-item command="rename">{{ $t('localFiles.rename') }}</el-dropdown-item>
                                        <el-dropdown-item command="delete" divided>{{ $t('localFiles.delete') }}</el-dropdown-item>
                                    </el-dropdown-menu>
                                </template>
                            </el-dropdown>
                        </div>
                    </div>

                    <!-- 列表视图：列 = 选择 / 缩略图 / 名称 / 类型 / 大小 / 修改时间 / 状态 -->
                    <div v-else class="lf-list" :class="{ 'has-selection': selected.length > 0, 'has-item-menu': isWebdavChannel }">
                        <div class="lf-list-head">
                            <span class="lf-col-check"></span>
                            <span class="lf-col-thumb"></span>
                            <span class="lf-col-name">{{ $t('localFiles.colName') }}</span>
                            <span class="lf-col-type">{{ $t('localFiles.colType') }}</span>
                            <span class="lf-col-size">{{ $t('localFiles.colSize') }}</span>
                            <span class="lf-col-time">{{ $t('localFiles.colTime') }}</span>
                            <span class="lf-col-state">{{ $t('localFiles.colState') }}</span>
                        </div>
                        <div
                            v-for="d in dirs"
                            :key="'ld' + d"
                            class="lf-list-row is-dir"
                            @click="enterDirJoin(d)"
                        >
                            <span class="lf-col-check"></span>
                            <span class="lf-col-thumb"><font-awesome-icon icon="folder" /></span>
                            <span class="lf-col-name" :title="d">{{ d }}</span>
                            <span class="lf-col-type">{{ $t('localFiles.typeDir') }}</span>
                            <span class="lf-col-size">—</span>
                            <span class="lf-col-time">—</span>
                            <span class="lf-col-state">—</span>
                            <el-dropdown
                                v-if="isWebdavChannel"
                                class="lf-item-menu"
                                trigger="click"
                                placement="bottom-end"
                                @command="(cmd) => onItemCommand(cmd, dirEntry(d))"
                                @click.stop
                            >
                                <button type="button" class="lf-item-menu-btn" :title="$t('localFiles.moreActions')" @click.stop>
                                    <font-awesome-icon icon="ellipsis-h" />
                                </button>
                                <template #dropdown>
                                    <el-dropdown-menu>
                                        <el-dropdown-item command="rename">{{ $t('localFiles.rename') }}</el-dropdown-item>
                                        <el-dropdown-item command="delete" divided>{{ $t('localFiles.delete') }}</el-dropdown-item>
                                    </el-dropdown-menu>
                                </template>
                            </el-dropdown>
                        </div>
                        <div
                            v-for="f in entries"
                            :key="'lf' + f.path"
                            class="lf-list-row"
                            :class="{ 'is-selected': isSelected(f.path) }"
                        >
                            <span
                                class="lf-select lf-select-inline"
                                role="checkbox"
                                :aria-checked="isSelected(f.path)"
                                :title="$t('localFiles.selectedCount', { n: selected.length })"
                                @click.stop="toggleSelect(f, $event)"
                                @mousedown.stop
                            >
                                <font-awesome-icon icon="check" />
                            </span>
                            <span class="lf-col-thumb" @click="openPreview(f)">
                                <img v-if="f.type === 'image'" :src="previewUrl(f)" :alt="f.name" loading="lazy" />
                                <font-awesome-icon v-else :icon="iconOf(f)" />
                            </span>
                            <span class="lf-col-name" :title="f.path" @click="onEntryNameClick(f)">
                                <span class="name-start">{{ nameParts(f.name).start }}</span><span class="name-end">{{ nameParts(f.name).end }}</span>
                            </span>
                            <span class="lf-col-type">{{ typeLabel(f.type) }}</span>
                            <span class="lf-col-size">{{ formatSize(f.size) }}</span>
                            <span class="lf-col-time">{{ formatTime(f.mtime) }}</span>
                            <span class="lf-col-state">
                                <span v-if="f.inLibrary" class="lf-meta-inlib">{{ $t('localFiles.uploadedMark') }}</span>
                                <span v-else class="lf-state-none">—</span>
                            </span>
                            <el-dropdown
                                v-if="isWebdavChannel"
                                class="lf-item-menu"
                                trigger="click"
                                placement="bottom-end"
                                @command="(cmd) => onItemCommand(cmd, f)"
                                @click.stop
                            >
                                <button type="button" class="lf-item-menu-btn" :title="$t('localFiles.moreActions')" @click.stop>
                                    <font-awesome-icon icon="ellipsis-h" />
                                </button>
                                <template #dropdown>
                                    <el-dropdown-menu>
                                        <el-dropdown-item command="rename">{{ $t('localFiles.rename') }}</el-dropdown-item>
                                        <el-dropdown-item command="delete" divided>{{ $t('localFiles.delete') }}</el-dropdown-item>
                                    </el-dropdown-menu>
                                </template>
                            </el-dropdown>
                        </div>
                    </div>
                </div>

                <div v-if="entries.length || dirs.length" class="lf-pager">
                    <el-pagination
                        layout="prev, pager, next"
                        :current-page="page"
                        :page-size="settings.pageSize"
                        :total="total"
                        small
                        background
                        @current-change="reload"
                    />
                    <!-- v3.0.0（R8）：加载更多 —— 只点击才追加下一页，不影响翻页 -->
                    <el-button
                        v-if="hasMorePages"
                        class="lf-load-more"
                        size="small"
                        :loading="loadingMore"
                        @click="loadMore"
                    >{{ $t('localFiles.loadMore') }}</el-button>
                </div>
            </section>
        </div>

        <!--
            底部批量操作条。
            v1.0.6：文案精简（「已选 x 个文件」→「x 个」、「取消选择」→「取消」、「上传到图床」→「上传」），
            并新增「下载」；移动端改为横向滑动、不换行（参考图床文件管理页的批量条）。
        -->
        <div v-if="selected.length" class="lf-batchbar">
            <div class="lf-batchbar-inner">
                <span class="lf-batch-text">{{ $t('localFiles.selectedCountShort', { n: selected.length }) }}</span>
                <el-button size="small" @click="clearSelection">{{ $t('localFiles.cancelShort') }}</el-button>
                <el-button size="small" type="primary" @click="openUpload">
                    <font-awesome-icon icon="cloud-upload-alt" style="margin-right: 4px;" />{{ $t('localFiles.uploadShort') }}
                </el-button>
                <el-button size="small" @click="downloadSelected">
                    <font-awesome-icon icon="download" style="margin-right: 4px;" />{{ $t('localFiles.downloadShort') }}
                </el-button>
            </div>
        </div>

        <!-- v3.0.0（R8）：移动端目录树抽屉 —— 顶栏「目录切换」按钮调出，与左侧目录树同构 -->
        <el-drawer
            v-model="treeDrawer"
            :title="$t('localFiles.treeTitle')"
            size="90%"
            append-to-body
            class="lf-tree-drawer"
        >
            <div class="lf-tree">
                <!-- v3.0.0（R14）：抽屉里同样提供「全部收起 / 全部展开」 -->
                <div class="lf-tree-head">
                    <span class="lf-tree-tip">{{ $t('localFiles.treeTitle') }}</span>
                    <button
                        type="button"
                        class="lf-tree-all"
                        :title="allTreeOpen ? $t('localFiles.treeCollapseAll') : $t('localFiles.treeExpandAll')"
                        @click="toggleTreeAll"
                    >
                        <font-awesome-icon :icon="allTreeOpen ? 'compress-alt' : 'expand-alt'" />
                    </button>
                </div>
                <button class="lf-tree-item" :class="{ 'is-active': dir === '' }" type="button" @click="drawerEnterDir('')">
                    <font-awesome-icon icon="home" class="lf-tree-icon" />{{ $t('localFiles.rootDir') }}
                </button>
                <button
                    v-for="node in visibleTreeNodes"
                    :key="'dr' + node.path"
                    class="lf-tree-item"
                    :class="{ 'is-active': dir === node.path }"
                    type="button"
                    :style="{ paddingLeft: 12 + node.depth * 14 + 'px' }"
                    @click="drawerEnterDir(node.path)"
                >
                    <span
                        v-if="node.hasChildren"
                        class="lf-tree-caret"
                        :class="{ 'is-open': isTreeOpen(node.path) }"
                        role="button"
                        :title="$t('localFiles.treeToggle')"
                        @click.stop="toggleTreeNode(node.path)"
                    >
                        <font-awesome-icon icon="chevron-right" />
                    </span>
                    <span v-else class="lf-tree-caret is-leaf"></span>
                    <font-awesome-icon icon="folder" class="lf-tree-icon" />{{ node.label }}
                </button>
                <div v-if="!treeDirs.length" class="lf-tree-empty">{{ $t('localFiles.treeEmpty') }}</div>
            </div>
        </el-drawer>

        <!-- v1.0.6：WebDAV 文件重命名 -->
        <el-dialog v-model="showRename" :title="$t('localFiles.rename')" width="420px" append-to-body>
            <p class="lf-rename-hint">{{ $t('localFiles.renameHint') }}</p>
            <el-input v-model="renameName" maxlength="255" @keyup.enter="doRename" />
            <template #footer>
                <el-button @click="showRename = false">{{ $t('common.cancel') }}</el-button>
                <el-button type="primary" :loading="renameBusy" @click="doRename">{{ $t('common.confirm') }}</el-button>
            </template>
        </el-dialog>

        <!-- 设置弹窗 -->
        <el-dialog v-model="showSettings" :title="$t('localFiles.settings')" width="420px" append-to-body>
            <el-form label-position="top">
                <el-form-item :label="$t('localFiles.pageSizeLabel')">
                    <el-input-number v-model="settingsForm.pageSize" :min="12" :max="200" :step="12" />
                </el-form-item>
                <el-form-item :label="$t('localFiles.maxPerDirLabel')">
                    <el-input-number v-model="settingsForm.maxPerDir" :min="100" :max="5000" :step="100" />
                </el-form-item>
                <el-form-item :label="$t('localFiles.previewMBLabel')">
                    <el-input-number v-model="settingsForm.previewThresholdMB" :min="1" :max="4096" :step="50" />
                </el-form-item>
            </el-form>
            <template #footer>
                <el-button @click="showSettings = false">{{ $t('common.cancel') }}</el-button>
                <el-button type="primary" :loading="settingsSaving" @click="saveSettings">{{ $t('common.confirm') }}</el-button>
            </template>
        </el-dialog>

        <!--
            上传弹窗：v1.0.7 起改用统一组件 UploadTargetDialog
            （同一套「目标渠道 / 归属实例 / 上传目录」也供视频灯箱的抓拍图上传复用）。
            v1.0.8：不再按「是否从灯箱打开」区分 z-index —— 硬设高值会让弹窗内的
            el-select 下拉浮层落到底下（浮层走 EP 递增，只有 32xx）。统一交给 EP 管理器。
        -->
        <UploadTargetDialog
            v-model="showUpload"
            :busy="uploading"
            :hint="$t('localFiles.uploadHint', { n: selected.length })"
            :prefill="uploadForm"
            @confirm="confirmUploadTarget"
        />

        <!-- 上传结果 -->
        <el-dialog v-model="showResult" :title="$t('localFiles.uploadResult')" width="620px" append-to-body>
            <div class="lf-result-summary">
                {{ $t('localFiles.resultSummary', { ok: resultOk, fail: resultFail, dup: resultDup }) }}
            </div>
            <div class="lf-result-list">
                <div v-for="(r, i) in results" :key="i" class="lf-result-row" :class="{ 'is-fail': !r.success }">
                    <!-- v3.0.0（R8）：上传成功后点文件名打开文件详情页 -->
                    <button
                        v-if="r.success && r.id"
                        class="lf-result-name is-link"
                        type="button"
                        :title="r.path"
                        @click="openResultDetail(r)"
                    >{{ r.name }}</button>
                    <span v-else class="lf-result-name" :title="r.path">{{ r.name }}</span>
                    <template v-if="r.success">
                        <span class="lf-result-ok">
                            <template v-if="r.dedup">{{ $t('localFiles.resultDedup') }}</template>
                            <template v-else>{{ $t('localFiles.resultOk') }}</template>
                        </span>
                        <span class="lf-result-id" :title="r.id">{{ r.id }}</span>
                        <button class="lf-result-copy" type="button" :title="linkOf(r)" @click="copyLink(r)">
                            <font-awesome-icon icon="copy" />
                        </button>
                    </template>
                    <template v-else>
                        <span class="lf-result-fail">{{ r.error }}</span>
                        <span class="lf-result-id"></span>
                        <span class="lf-result-copy"></span>
                    </template>
                </div>
            </div>
            <template #footer>
                <el-button v-if="resultFail" :loading="uploading" @click="retryFailed">{{ $t('localFiles.retryFailed') }}</el-button>
                <el-button type="primary" @click="showResult = false">{{ $t('localFiles.close') }}</el-button>
            </template>
        </el-dialog>

        <!-- 预览：复用统一的媒体灯箱 -->
        <MediaPreviewOverlay
            v-model="showPreview"
            :items="previewItems"
            :start-index="previewIndex"
            upload
            :upload-busy="lightboxUploading"
            @upload="openLightboxUpload"
            @record-detail="openLightboxRecordDetail"
        />

        <!--
            v1.0.5：灯箱内发起的上传 —— 完成后不关灯箱，只在顶部浮一张结果条，
            提供「完成」（留在灯箱）与「查看详情」（关灯箱、打开文件详情）两个出口。
        -->
        <transition name="lf-fade">
            <div v-if="lightboxUploadResult" class="lf-lightbox-result" role="status">
                <font-awesome-icon
                    :icon="lightboxUploadResult.success ? 'check' : 'exclamation-circle'"
                    class="lf-lightbox-result-icon"
                    :class="lightboxUploadResult.success ? 'is-ok' : 'is-fail'"
                />
                <span class="lf-lightbox-result-text">
                    <template v-if="lightboxUploadResult.success">
                        {{ lightboxUploadResult.dedup ? $t('localFiles.resultDedup') : $t('localFiles.resultOk') }}
                        <em class="lf-lightbox-result-name">{{ lightboxUploadResult.name }}</em>
                    </template>
                    <template v-else>{{ lightboxUploadResult.error || $t('localFiles.uploadFailed') }}</template>
                </span>
                <el-button size="small" @click="lightboxUploadResult = null">{{ $t('localFiles.done') }}</el-button>
                <el-button
                    v-if="lightboxUploadResult.success && lightboxUploadResult.id"
                    size="small"
                    type="primary"
                    @click="viewUploadedFromLightbox"
                >{{ $t('localFiles.viewDetail') }}</el-button>
            </div>
        </transition>

        <!-- v3.0.0（R8）：上传结果里的文件详情页（复用统一详情弹窗） -->
        <FileDetailDialog
            v-model="showDetail"
            :file="detailFile"
            :file-link="detailLink"
            :urls="detailUrls"
            :show-advanced="true"
        />
    </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import { fileLink } from '@/utils/fileLink';
import { copyText } from '@/utils/clipboard';
import { fetchStorageChannels, channelLabel } from '@/utils/storageChannels';
import { splitFileName } from '@/utils/fileName';
import { buildFileDetail } from '@/utils/fileDetail';
import UploadTargetDialog from '@/components/upload/UploadTargetDialog.vue';
import { ElMessageBox } from 'element-plus';
import MediaPreviewOverlay from '@/components/dashboard/MediaPreviewOverlay.vue';
import DashboardTabs from '@/components/DashboardTabs.vue';
import AdminToggleDark from '@/components/dashboard/AdminToggleDark.vue';
import FileDetailDialog from '@/components/dashboard/FileDetailDialog.vue';

/** v3.0.0（R7）：记住「上次选择的本地文件渠道」，刷新 / 重新进入沿用 */
const CHANNEL_STORE_KEY = 'gohub_localfiles_channel';
/** v3.0.0（R12）：记住「卡片 / 列表」视图选择 */
const VIEW_STORE_KEY = 'gohub_localfiles_view';
/*
 * v3.0.0（R15）：记忆当前浏览目录 ——
 * 按渠道分别存（切渠道各记各的），刷新 / 下次进入直接回到上次的路径。
 */
const DIR_STORE_PREFIX = 'gohub_localfiles_dir:';

export default {
    name: 'LocalFilesPage',
    components: { MediaPreviewOverlay, DashboardTabs, AdminToggleDark, FileDetailDialog, UploadTargetDialog },
    data() {
        return {
            channels: [],
            channelId: '',
            treeDirs: [],
            /*
             * v3.0.0（R12）：目录树导航默认收起 —— 桌面端只留一条窄边栏，
             * 需要时点箭头展开（本地文件以内容浏览为主，不需要常驻占宽）。
             */
            /*
         * v3.0.0（R16）：桌面端左侧目录导航面板默认展开（移动端由媒体查询整体隐藏，
         * 走顶栏「目录切换」抽屉，不受此值影响）。
         */
        sidebarCollapsed: false,
            // v3.0.0（R8）：目录树折叠态（path -> bool）与移动端抽屉
            treeExpanded: {},
            treeDrawer: false,
            // v3.0.0（R12）：卡片 / 列表视图
            viewMode: 'card',
            // v3.0.0（R8）：移动端搜索展开态
            mobileSearchOpen: false,
            // v3.0.0（R7）：顶栏固定 + 滚动方向显隐（与后台管理页顶栏同一套行为）
            topbarHidden: false,
            // v3.0.0（R11c）：页面滚动后顶栏背框改为不透明（去除玻璃透明与背景模糊）
            topbarSolid: false,
            topbarHeight: 58,
            lastScrollY: 0,
            dir: '',
            entries: [],
            dirs: [],
            total: 0,
            page: 1,
            truncated: false,
            loading: false,
            // v3.0.0（R8）：「加载更多」独立加载态
            loadingMore: false,
            search: '',
            typeFilter: '',
            sortKey: 'name',
            order: 'asc',
            settings: { pageSize: 50, maxPerDir: 200, previewThresholdMB: 500 },            settingsForm: { pageSize: 50, maxPerDir: 200, previewThresholdMB: 500 },
            showSettings: false,
            settingsSaving: false,
            selected: [],
            // v1.0.6：WebDAV 文件重命名 / 删除
            showRename: false,
            renameBusy: false,
            renameName: '',
            renameTarget: null,
            itemBusy: false,
            /** v1.0.5：移动端返回键接管开关（触屏设备才为 true） */
            isTouchNav: false,
        /* v3.0.0（R16）：Shift 区间选择的锚点路径 */
        anchorPath: '',
            showUpload: false,
            uploading: false,
            uploadForm: { channelId: '', instanceId: '', uploadFolder: '' },
            bedChannels: [],
            instances: [],
            showResult: false,
            results: [],
            /*
             * v1.0.5：灯箱内发起的上传。
             * uploadFromLightbox=true 时只传「当前预览的这一个文件」，
             * 且完成后不弹结果弹窗、不关灯箱，改由顶部结果条给出「完成 / 查看详情」。
             */
            uploadFromLightbox: false,
            lightboxUploadTarget: null,
            lightboxUploadResult: null,
            lightboxUploading: false,
            showPreview: false,
            previewIndex: 0,
            // v3.0.0（R8）：上传结果 → 文件详情页
            showDetail: false,
            detailFile: null,
        };
    },
    computed: {
        /**
         * v1.0.6：当前是否在浏览「WebDAV 文件」这条虚拟渠道。
         * 只有这条渠道允许重命名 / 删除 —— 其它本地文件渠道指向的是用户机器上的原始目录，只读。
         */
        isWebdavChannel() {
            return this.channelId === '__webdav__';
        },
        dirSegments() {
            return this.dir ? this.dir.split('/') : [];
        },
        /** 当前页可预览的媒体（图片/视频/音频/PDF/文本/表格）—— 与灯箱的 kind 契约一致 */
        previewItems() {
            const TABLE_EXT = ['csv', 'tsv'];
            return this.entries
                .filter((f) => ['image', 'video', 'audio', 'pdf', 'text'].includes(f.type))
                .map((f) => {
                    const ext = String(f.ext || '').toLowerCase();
                    const kind = TABLE_EXT.includes(ext) ? 'table' : f.type;
                    return {
                        key: f.path,
                        name: f.name,
                        url: this.previewUrl(f),
                        kind,
                        ext,
                        sizeText: this.formatSize(f.size),
                        user: '',
                        /*
                         * v1.0.8：已落库的文件带图床文件 ID（后端列表字段 inLibrary）。
                         * 灯箱据此把「上传」换成「详情」，点开就是它在图床里的详情页。
                         */
                        recordId: f.inLibrary || '',
                    };
                });
        },
        /** 上传结果统计：成功（新写入）/ 命中 MD5 去重 / 失败 */
        resultOk() {
            return this.results.filter((r) => r.success && !r.dedup).length;
        },
        resultDup() {
            return this.results.filter((r) => r.success && r.dedup).length;
        },
        resultFail() {
            return this.results.filter((r) => !r.success).length;
        },
        /**
         * v3.0.0（R8）：目录树折叠 —— 还有没有下一页
         */
        hasMorePages() {
            return this.page * this.settings.pageSize < this.total;
        },
        /** v3.0.0（R14）：带子目录的节点是否全部处于展开态（决定按钮显示「全部收起」还是「全部展开」） */
        allTreeOpen() {
            const dirs = this.treeDirs || [];
            for (const parent of dirs) {
                const hasChild = dirs.some((d) => d !== parent && d.startsWith(`${parent}/`));
                if (hasChild && !this.isTreeOpen(parent)) return false;
            }
            return true;
        },
        /**
         * v3.0.0（R8）：可见目录树节点 —— 父级折叠时隐藏子级；
         * treeDirs 是「父级在前」的排序路径数组，扫描一遍即可判断父子与折叠。
         */
        visibleTreeNodes() {
            const expanded = this.treeExpanded;
            const out = [];
            const hiddenUntilDepth = [];
            for (const raw of this.treeDirs) {
                const segs = String(raw).split('/').filter(Boolean);
                if (!segs.length) continue;
                // 任一祖先被折叠 → 该节点不可见
                let visible = true;
                for (let i = 1; i < segs.length; i++) {
                    const anc = segs.slice(0, i).join('/');
                    // v3.0.0（R15）：默认收起 —— 祖先没有被显式展开（true）时，子级不可见
                    if (expanded[anc] !== true) { visible = false; break; }
                }
                if (!visible) continue;
                const path = segs.join('/');
                out.push({
                    path,
                    label: segs[segs.length - 1],
                    depth: segs.length - 1,
                    hasChildren: this.treeDirs.some((d) => d !== path && d.startsWith(`${path}/`)),
                });
            }
            return out;
        },
        /** v3.0.0（R8）：详情弹窗 props（与历史记录页同一套构造逻辑） */
        detailProps() {
            return this.detailFile ? buildFileDetail(this.detailFile) : { file: null, fileLink: '', urls: {} };
        },
        detailLink() {
            return this.detailProps.fileLink;
        },
        detailUrls() {
            return this.detailProps.urls;
        },
    },
    mounted() {
        this.lastScrollY = this.currentScrollTop();
        // v3.0.0（R12）：恢复上次的视图模式（卡片 / 列表）
        try {
            const saved = localStorage.getItem(VIEW_STORE_KEY);
            if (saved === 'card' || saved === 'list') this.viewMode = saved;
        } catch (e) { /* 隐私模式忽略 */ }
        this.loadChannels();
        this.$nextTick(() => this.measureTopbar());
        document.addEventListener('scroll', this.handlePageScroll, { capture: true, passive: true });
        window.addEventListener('resize', this.measureTopbar, { passive: true });
        /*
         * v1.0.5：移动端返回键 = 回上一级目录（对齐「图床文件管理」页）。
         * 触屏判定用 matchMedia('(hover:none)')，桌面端完全不启用。
         */
        this.isTouchNav = typeof window !== 'undefined'
            && !!window.matchMedia
            && window.matchMedia('(hover: none)').matches;
        if (this.isTouchNav) {
            this.__popStateHandler = this.handleMobilePopState.bind(this);
            window.addEventListener('popstate', this.__popStateHandler);
            this.setupBodyMutationWatch();
        }
    },
    beforeUnmount() {
        document.removeEventListener('scroll', this.handlePageScroll, true);
        window.removeEventListener('resize', this.measureTopbar);
        if (this.__popStateHandler) {
            window.removeEventListener('popstate', this.__popStateHandler);
            this.__popStateHandler = null;
        }
        if (this.__bodyObserver) {
            this.__bodyObserver.disconnect();
            this.__bodyObserver = null;
        }
        if (this.scrollFrame !== undefined && this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
        if (this.topbarObserver) this.topbarObserver.disconnect();
    },
    watch: {
        /** v1.0.5：关灯箱就清掉灯箱内上传的结果条，避免下次打开还挂着上一条 */
        showPreview(v) {
            if (!v) this.lightboxUploadResult = null;
        },
        /** v1.0.5：上传弹窗关闭后退出「灯箱发起」模式（z-index / 目标文件都回到默认） */
        showUpload(v) {
            if (!v) {
                this.uploadFromLightbox = false;
                this.lightboxUploadTarget = null;
            }
        },
    },
    methods: {
        channelLabel,
        /** v3.0.0（R7）：当前页面滚动位置（兼容 OverlayScrollbars 接管 body 的情况） */
        currentScrollTop() {
            // v3.0.0（R11c）：兼容 OverlayScrollbars 接管 body 的桌面端（此时 scrollingElement 恒为 0）
            let y = Math.max(0, (document.scrollingElement || document.documentElement)?.scrollTop || 0);
            if (!y) y = Math.max(0, window.scrollY || 0);
            if (!y) y = Math.max(0, document.body?.scrollTop || 0);
            return y;
        },
        /** 顶栏随滚动方向显隐：向下滚 → 上滑隐藏；向上滚（或回到顶部）→ 立即显示 */
        handlePageScroll(event) {
            const target = event.target;
            const allowed = [document, window, document.scrollingElement, document.documentElement, document.body];
            // 任意元素内部滚动都不应影响本页顶栏（弹窗 / 侧栏 / 表格内部）
            if (target && target !== document && target !== window && !allowed.includes(target)) {
                const isScroller = target === document.scrollingElement;
                if (!isScroller) return;
            }
            if (this.scrollFrame) return;
            this.scrollFrame = requestAnimationFrame(() => {
                this.scrollFrame = null;
                const y = this.currentScrollTop();
                // v3.0.0（R11c）：离开顶部即切不透明背框（与方向无关，先于抖动过滤）
                const solid = y > 8;
                if (solid !== this.topbarSolid) this.topbarSolid = solid;
                const delta = y - this.lastScrollY;
                if (Math.abs(delta) < 2) return;
                this.lastScrollY = y;
                /*
                 * v3.0.0（R14）：桌面端顶栏常驻吸附 —— 滚动时不再上滑隐藏；
                 * 手机 / 平板保持原来的「下滑隐藏、上滑出现」，给内容让出高度。
                 */
                if (window.innerWidth > 1024) {
                    if (this.topbarHidden) this.topbarHidden = false;
                    return;
                }
                this.topbarHidden = !(y <= 40 || delta < 0);
            });
        },
        /** 量顶栏实际高度 → 写入 CSS 变量（占位与侧栏高度都靠它） */
        measureTopbar() {
            const el = this.$refs.topbar;
            if (!el) return;
            const h = Math.round(el.getBoundingClientRect().height) || 58;
            this.topbarHeight = h;
            const page = this.$refs.page;
            if (page) page.style.setProperty('--lf-topbar-h', `${h}px`);
        },
        /** 视频缩略图地址：#t=0.5 让浏览器定位到第 0.5 秒的画面作为封面 */
        videoThumbUrl(f) {
            return `${this.previewUrl(f)}#t=0.5`;
        },
        formatSize(bytes) {
            const n = Number(bytes) || 0;
            if (n < 1024) return `${n} B`;
            if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
            if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
            return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
        },
        formatTime(ms) {
            const t = Number(ms) || 0;
            if (!t) return '';
            const d = new Date(t);
            const p = (v) => String(v).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
        },
        iconOf(f) {
            if (f.type === 'video') return 'file-video';
            if (f.type === 'audio') return 'file-audio';
            if (f.type === 'pdf') return 'file-pdf';
            if (f.type === 'text') return 'file-alt';
            return 'file';
        },
        previewUrl(f) {
            return `/api/localfiles/preview?channelId=${encodeURIComponent(this.channelId)}&path=${encodeURIComponent(f.path)}`;
        },
        async loadChannels() {
            try {
                const res = await fetchWithAuth('/api/localfiles/channels');
                const json = await res.json().catch(() => ({}));
                this.channels = Array.isArray(json.data) ? json.data : [];
            } catch (e) {
                this.channels = [];
            }
            if (this.channels.length) {
                /*
                 * v3.0.0（R7）：优先用上次选择的渠道（localStorage 记忆）；
                 * 记忆的渠道已被删除 / 停用时回落到第一个可用渠道。
                 */
                let remembered = '';
                try {
                    remembered = localStorage.getItem(CHANNEL_STORE_KEY) || '';
                } catch (e) { /* 隐私模式忽略 */ }
                const hit = remembered && this.channels.find((c) => String(c.id) === String(remembered));
                this.channelId = hit ? hit.id : this.channels[0].id;
                this.rememberChannel(this.channelId);
                // v3.0.0（R15）：恢复到上次浏览的目录
                this.dir = this.recallDir(this.channelId);
                await this.loadSettings();
                await this.loadTree();
                if (this.dir) this.expandAncestors(this.dir);
                await this.reload(1);
            }
        },
        /** 记住当前渠道（刷新 / 重新进入沿用） */
        rememberChannel(id) {
            try {
                if (id) localStorage.setItem(CHANNEL_STORE_KEY, String(id));
                else localStorage.removeItem(CHANNEL_STORE_KEY);
            } catch (e) { /* 忽略 */ }
        },
        async onChannelChange() {
            this.rememberChannel(this.channelId);
            this.clearSelection();
            // v3.0.0（R15）：切渠道 → 回到该渠道上次浏览的目录（无记忆则根目录）
            this.dir = this.recallDir(this.channelId);
            await this.loadSettings();
            await this.loadTree();
            await this.reload(1);
        },
        async loadSettings() {
            try {
                const res = await fetchWithAuth('/api/localfiles/settings');
                const json = await res.json().catch(() => ({}));
                if (json.success && json.data) this.settings = { ...this.settings, ...json.data };
            } catch (e) {
                /* 用默认值 */
            }
        },
        openSettings() {
            this.settingsForm = { ...this.settings };
            this.showSettings = true;
        },
        async saveSettings() {
            this.settingsSaving = true;
            try {
                const res = await fetchWithAuth('/api/localfiles/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.settingsForm),
                });
                const json = await res.json().catch(() => ({}));
                if (!json.success) throw new Error(json.message || 'failed');
                this.settings = { ...this.settings, ...json.data };
                this.showSettings = false;
                this.$message?.success(this.$t('localFiles.settingsSaved'));
                await this.reload(1);
            } catch (e) {
                this.$message?.error(this.$t('localFiles.settingsFailed'));
            } finally {
                this.settingsSaving = false;
            }
        },
        /** v3.0.0（R12）：刷新 = 目录树 + 当前目录列表一起重读（外部新增目录能立刻进树） */
        async refreshAll() {
            await this.loadTree();
            await this.reload(this.page);
        },
        async loadTree() {
            if (!this.channelId) return;
            try {
                const res = await fetchWithAuth(`/api/localfiles/tree?channelId=${encodeURIComponent(this.channelId)}`);
                const json = await res.json().catch(() => ({}));
                this.treeDirs = json?.success ? json.data.dirs || [] : [];
            } catch (e) {
                this.treeDirs = [];
            }
        },
        enterDir(d) {
            const next = d || '';
            const entering = !!next && next !== this.dir && next.startsWith(`${this.dir || ''}`);
            this.dir = next;
            this.rememberDir(this.dir);
            this.clearSelection();
            this.expandAncestors(this.dir);
            // v1.0.5：进入子目录时压一条历史，返回键才有「上一级」可回
            if (entering) this.pushFolderHistory();
            this.reload(1);
        },
        /* ==================================================================
         * v1.0.5：移动端返回键 → 回上一级目录
         * 与「图床文件管理」页完全同款逻辑：
         *   · 有浮层（灯箱 / 弹窗）时把返回键让给浮层；
         *   · 程序自己触发的 popstate（浮层哨兵）不能当用户返回；
         *   · 已在根目录 → 屏蔽返回（补一条同 URL 历史，不离开本页）。
         * ================================================================== */
        pushFolderHistory() {
            if (!this.isTouchNav) return;
            try {
                window.history.pushState({ lfDir: this.dir || '' }, '', window.location.href);
            } catch (e) { /* 隐私模式等环境忽略 */ }
        },
        setupBodyMutationWatch() {
            if (typeof MutationObserver === 'undefined') return;
            this.__lastBodyMutationAt = 0;
            this.__bodyObserver = new MutationObserver(() => {
                this.__lastBodyMutationAt = Date.now();
            });
            this.__bodyObserver.observe(document.body, { childList: true });
        },
        /** 是否有可见浮层（EP 弹窗关掉后仍留在 DOM，必须看渲染盒子） */
        hasOpenFloatingLayer() {
            if (this.showPreview || this.showDetail || this.showUpload || this.showResult || this.showSettings) return true;
            if (this.treeDrawer) return true;
            const list = Array.from(document.querySelectorAll('.el-overlay'));
            const visible = list.some((el) => {
                if (!el || !el.isConnected) return false;
                const style = window.getComputedStyle(el);
                if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
                return el.getBoundingClientRect().width > 0 || el.getBoundingClientRect().height > 0;
            });
            if (visible) return true;
            return !!document.querySelector('.media-viewer');
        },
        handleMobilePopState() {
            if (!this.isTouchNav) return;
            if (this.hasOpenFloatingLayer()) return;
            // backGuard 退哨兵 / 灯箱自己退哨兵引起的 popstate → 忽略
            if (Date.now() - (this.__lastBodyMutationAt || 0) < 300) return;
            if (Date.now() - (window.__gohubBackGuardAt || 0) < 500) return;
            if (Date.now() - (window.__gohubMediaViewerPopAt || 0) < 500) return;
            const parts = String(this.dir || '').split('/').filter(Boolean);
            if (!parts.length) {
                // 已在根目录：屏蔽返回，留在本页
                try {
                    window.history.pushState({ lfDir: '' }, '', window.location.href);
                } catch (e) { /* 忽略 */ }
                return;
            }
            this.enterDir(parts.slice(0, -1).join('/'));
        },
        /** v3.0.0（R15）：记住当前渠道下的浏览路径 */
        rememberDir(dir) {
            const id = this.channelId;
            if (!id) return;
            try {
                const key = `${DIR_STORE_PREFIX}${id}`;
                if (dir) localStorage.setItem(key, String(dir));
                else localStorage.removeItem(key);
            } catch (e) { /* 隐私模式忽略 */ }
        },
        /** v3.0.0（R15）：取回上次的浏览路径（渠道不存在 / 已删时返回空串 = 根目录） */
        recallDir(id) {
            try {
                return (id && localStorage.getItem(`${DIR_STORE_PREFIX}${id}`)) || '';
            } catch (e) {
                return '';
            }
        },
        enterDirJoin(name) {
            this.enterDir(this.dir ? `${this.dir}/${name}` : name);
        },
        /* ---------------- v1.0.6：WebDAV 重命名 / 删除 ---------------- */
        /** 当前目录下的子项 → 完整虚拟路径（首段是渠道根名） */
        joinPath(name) {
            return this.dir ? `${this.dir}/${name}` : name;
        },
        /** 目录卡片 / 目录行 → 与文件同构的条目对象（模板里统一走 onItemCommand） */
        dirEntry(name) {
            return { path: this.joinPath(name), name, kind: 'dir' };
        },
        onItemCommand(cmd, item) {
            if (cmd === 'rename') this.openRenameDialog(item);
            else if (cmd === 'delete') this.confirmDelete(item);
        },
        openRenameDialog(item) {
            this.renameTarget = item;
            this.renameName = item?.name || '';
            this.showRename = true;
        },
        /** 重命名：只改同目录下的名字（后端已校验非法字符 / 重名 / 越界） */
        async doRename() {
            const name = String(this.renameName || '').trim();
            if (!name) {
                this.$message.warning(this.$t('localFiles.renameRequired'));
                return;
            }
            if (!this.renameTarget) return;
            if (name === this.renameTarget.name) {
                this.showRename = false;
                return;
            }
            this.renameBusy = true;
            try {
                const res = await fetchWithAuth('/api/localfiles/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channelId: this.channelId, path: this.renameTarget.path, name }),
                });
                const data = await res.json().catch(() => ({}));
                if (!data.success) {
                    this.$message.error(data.message || this.$t('common.failed'));
                    return;
                }
                // 选中态里的旧路径同步成新路径，否则重命名后勾选条会残留不存在的项
                const oldPath = this.renameTarget.path;
                const newPath = data.data?.path || oldPath;
                this.selected = this.selected.map((s) => (s === oldPath ? newPath : s));
                this.showRename = false;
                this.$message.success(this.$t('localFiles.renamed'));
                await this.refreshAll();
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.renameBusy = false;
            }
        },
        /** 删除：真删、不进回收站 —— 必须二次确认 */
        async confirmDelete(item) {
            if (!item?.path) return;
            try {
                await ElMessageBox.confirm(
                    this.$t('localFiles.deleteConfirm', { name: item.name }),
                    this.$t('localFiles.delete'),
                    {
                        type: 'warning',
                        confirmButtonText: this.$t('localFiles.delete'),
                        cancelButtonText: this.$t('common.cancel'),
                        confirmButtonClass: 'el-button--danger',
                    },
                );
            } catch {
                return;
            }
            this.itemBusy = true;
            try {
                const res = await fetchWithAuth('/api/localfiles/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channelId: this.channelId, paths: [item.path] }),
                });
                const data = await res.json().catch(() => ({}));
                if (!data.success) {
                    this.$message.error(data.message || this.$t('common.failed'));
                    return;
                }
                this.selected = this.selected.filter((s) => s !== item.path && !s.startsWith(`${item.path}/`));
                this.$message.success(this.$t('localFiles.deleted'));
                await this.refreshAll();
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.itemBusy = false;
            }
        },
        /** 移动端抽屉里进目录：进目录后顺手收起抽屉 */
        drawerEnterDir(d) {
            this.enterDir(d);
            this.treeDrawer = false;
        },
        /** v3.0.0（R8）：展开当前目录的全部祖先（目录树「自动展开路径」） */
        expandAncestors(dir) {
            const segs = String(dir || '').split('/').filter(Boolean);
            for (let i = 1; i < segs.length; i++) {
                const anc = segs.slice(0, i).join('/');
                this.treeExpanded = { ...this.treeExpanded, [anc]: true };
            }
        },
        /**
         * v3.0.0（R14）：一键全部收起 / 全部展开。
         * 依据当前状态决定方向：全开 → 全收起；只要有一个收起 → 全展开。
         */
        toggleTreeAll() {
            const dirs = this.treeDirs || [];
            const parents = dirs.filter((d) => dirs.some((x) => x !== d && x.startsWith(`${d}/`)));
            const collapse = this.allTreeOpen;
            const next = {};
            parents.forEach((p) => { next[p] = !collapse; });
            this.treeExpanded = next;
        },
        /** v3.0.0（R8）：切换目录折叠态 */
        toggleTreeNode(path) {
            this.treeExpanded = { ...this.treeExpanded, [path]: !this.isTreeOpen(path) };
        },
        /**
         * v3.0.0（R12）：目录是否处于展开态。
         * v3.0.0（R15）：默认改为「全部收起」—— treeExpanded 里没有键 = 收起，
         * 只有被用户 / 「全部展开」/ 进入目录（expandAncestors）显式置 true 才展开。
         * 目录树面板本身仍是默认展开可见，只是各层级不预先铺开。
         */
        isTreeOpen(path) {
            return this.treeExpanded[path] === true;
        },
        /** v3.0.0（R12）：卡片 / 列表视图切换（记忆到 localStorage） */
        setViewMode(mode) {
            if (mode !== 'card' && mode !== 'list') return;
            if (this.viewMode === mode) return;
            this.viewMode = mode;
            try {
                localStorage.setItem(VIEW_STORE_KEY, mode);
            } catch (e) { /* 忽略 */ }
        },
        /** v3.0.0（R12）：列表视图的「类型」列文案 */
        typeLabel(type) {
            const map = {
                image: 'typeImage',
                video: 'typeVideo',
                audio: 'typeAudio',
                text: 'typeText',
                pdf: 'typePdf',
                other: 'typeOther',
            };
            return map[type] ? this.$t(`localFiles.${map[type]}`) : this.$t('localFiles.typeOther');
        },
        /** v3.0.0（R8）：移动端搜索按钮 —— 展开 / 收起搜索框 */
        toggleMobileSearch() {
            this.mobileSearchOpen = !this.mobileSearchOpen;
            if (this.mobileSearchOpen) this.$nextTick(() => this.measureTopbar());
            else if (this.search) { this.search = ''; this.applySearch(); }
        },
        applySearch() {
            this.reload(1);
        },
        toggleOrder() {
            this.order = this.order === 'asc' ? 'desc' : 'asc';
            this.reload(this.page);
        },
        /** 组装列表请求参数（reload / loadMore 共用） */
        listQuery(page) {
            return new URLSearchParams({
                channelId: this.channelId,
                dir: this.dir,
                page: String(page),
                pageSize: String(this.settings.pageSize),
                type: this.typeFilter,
                sort: this.sortKey,
                order: this.order,
                search: this.search,
            });
        },
        async reload(page = 1) {
            if (!this.channelId) return;
            this.page = page;
            this.loading = true;
            try {
                const res = await fetchWithAuth(`/api/localfiles/list?${this.listQuery(page).toString()}`);
                const json = await res.json().catch(() => ({}));
                if (!json.success) throw new Error(json.message || 'load failed');
                const data = json.data;
                this.entries = (data.entries || []).filter((e) => e.kind === 'file');
                /*
                 * v3.0.0（R8）：目录清单优先用后端 data.dirs（当前目录的全部子目录，不受分页影响）——
                 * 之前目录只能从「当前页 entries」里挑，目录多的目录一翻页就丢、没文件的目录直接显示为空。
                 */
                const fromServer = Array.isArray(data.dirs) ? data.dirs : [];
                const fromEntries = (data.entries || []).filter((e) => e.kind === 'dir').map((e) => e.name);
                this.dirs = Array.from(new Set([...fromServer, ...fromEntries]));
                this.total = data.total || 0;
                this.truncated = !!data.truncated;
                if (data.settings) this.settings = { ...this.settings, ...data.settings };
            } catch (e) {
                this.entries = [];
                this.dirs = [];
                this.total = 0;
                this.$message?.error(this.$t('localFiles.loadFailed'));
            } finally {
                this.loading = false;
            }
        },
        /**
         * v3.0.0（R8）：加载更多 —— 点击一次追加一页；不影响翻页（翻页仍是整页替换）。
         */
        async loadMore() {
            if (this.loadingMore || !this.hasMorePages) return;
            this.loadingMore = true;
            try {
                const next = this.page + 1;
                const res = await fetchWithAuth(`/api/localfiles/list?${this.listQuery(next).toString()}`);
                const json = await res.json().catch(() => ({}));
                if (!json.success) throw new Error(json.message || 'load failed');
                const data = json.data;
                const files = (data.entries || []).filter((e) => e.kind === 'file');
                const known = new Set(this.entries.map((e) => e.path));
                this.entries = [...this.entries, ...files.filter((f) => !known.has(f.path))];
                const fromServer = Array.isArray(data.dirs) ? data.dirs : [];
                this.dirs = Array.from(new Set([...this.dirs, ...fromServer]));
                this.total = data.total || this.total;
                this.truncated = !!data.truncated;
                this.page = next;
            } catch (e) {
                this.$message?.error(this.$t('localFiles.loadFailed'));
            } finally {
                this.loadingMore = false;
            }
        },
        /**
         * v3.0.0（R15）：点文件名 —— 已落库的文件直接打开它在【图床】里的文件详情页；
         * 未落库的文件保持原行为（打开本地预览）。缩略图点击仍是本地预览，不受影响。
         */
        async onEntryNameClick(f) {
            if (f && f.inLibrary) {
                await this.openResultDetail({ id: f.inLibrary, path: f.path });
                return;
            }
            this.openPreview(f);
        },
        /**
         * v3.0.0（R8）：上传成功的结果里点文件名 → 打开文件详情页。
         * 本页手里只有 File_ID，先拉一次 /api/manage/metadata/<id> 再复用统一详情弹窗。
         */
        async openResultDetail(r) {
            if (!r?.id) return;
            try {
                const res = await fetchWithAuth(`/api/manage/metadata/${encodeURIComponent(r.id)}`);
                const json = await res.json().catch(() => ({}));
                if (!json?.success || !json.data) throw new Error(json?.message || 'not found');
                this.detailFile = { name: json.data.name || r.id, metadata: json.data.metadata || {} };
                this.showDetail = true;
            } catch (e) {
                this.$message?.error(this.$t('localFiles.detailFailed') || String(e.message || e));
            }
        },
        /**
         * v1.0.8：灯箱里点「详情」（或下拉面板里的同名项）——
         * 当前文件已落库时，直接打开它在图床里的文件详情页；灯箱保持打开（详情弹窗叠在上层）。
         */
        async openLightboxRecordDetail(item) {
            const id = item?.recordId;
            if (!id) return;
            await this.openResultDetail({ id, path: item.key });
        },
        /** v2.8.6 同款「开头…结尾」文件名切分 */
        nameParts(name) {
            return splitFileName(String(name || ''));
        },
        isSelected(path) {
            return this.selected.includes(path);
        },
        /*
         * v3.0.0（R16）：Shift + 点击选中圆圈 → 批量选中区间（与图床文件管理页同一套行为）。
         * 锚点 anchorPath 在普通点击时更新；shift 点击时把 [锚点, 当前] 之间所有条目并入选中。
         */
        toggleSelect(f, e) {
            if (e && e.shiftKey && this.anchorPath) {
                const order = this.entries.map((x) => x.path);
                const a = order.indexOf(this.anchorPath);
                const b = order.indexOf(f.path);
                if (a >= 0 && b >= 0) {
                    const [from, to] = a <= b ? [a, b] : [b, a];
                    const merged = new Set([...this.selected, ...order.slice(from, to + 1)]);
                    this.selected = [...merged];
                    this.$message && this.$message.success(
                        this.$t('localFiles.selectedCount', { n: this.selected.length })
                    );
                    return;
                }
            }
            this.anchorPath = f.path;
            if (this.isSelected(f.path)) this.selected = this.selected.filter((p) => p !== f.path);
            else this.selected = [...this.selected, f.path];
        },
        clearSelection() {
            this.selected = [];
            this.anchorPath = '';
        },
        /**
         * v1.0.6：把选中的文件下载到本地。
         *
         * 走 `/api/localfiles/preview?download=1`，由后端带上 Content-Disposition，
         * 浏览器才会存成文件而不是在标签页里打开（图片 / PDF 直接 open 只会预览）。
         *
         * 多个文件不能同时点 —— 浏览器会把连续的下载判定为「批量下载」并弹拦截提示，
         * 所以按 260ms 的间隔依次触发。选中的项若已不在当前页（翻页后），直接跳过。
         */
        downloadSelected() {
            const items = this.selected
                .map((p) => this.entries.find((f) => f.path === p))
                .filter(Boolean);
            if (!items.length) return;
            items.forEach((f, i) => {
                window.setTimeout(() => {
                    const a = document.createElement('a');
                    a.href = `${this.previewUrl(f)}&download=1`;
                    a.download = f.name || '';
                    a.rel = 'noopener';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }, i * 260);
            });
        },
        openPreview(f) {
            const idx = this.previewItems.findIndex((it) => it.key === f.path);
            // 不可在线预览的类型（压缩包 / 安装包等）直接走下载，避免灯箱里打开无关文件
            if (idx < 0) {
                window.open(`${this.previewUrl(f)}&download=1`, '_blank', 'noopener');
                return;
            }
            this.previewIndex = idx;
            this.showPreview = true;
        },
        /** 上传成功后签发的外链（与全站统一前缀，跟随自定义访问域名） */
        linkOf(r) {
            return r && r.id ? fileLink(r.id) : '';
        },
        async copyLink(r) {
            const url = this.linkOf(r);
            if (!url) return;
            const ok = await copyText(url);
            if (ok) this.$message?.success(this.$t('localFiles.linkCopied', { url }));
            else this.$message?.error(this.$t('localFiles.copyFailed'));
        },
        instanceLabel(ins) {            const idx = Number(ins.index) || 0;
            return idx > 0 ? this.$t('localFiles.instanceWithIndex', { name: ins.name, index: idx }) : ins.name;
        },
        /**
         * v3.0.0（R14）：已落库的文件不再重复上传 ——
         * 列表接口会给每个文件下发 inLibrary（命中图床记录的 File_ID / 地址），
         * 这里在打开上传弹窗和真正提交前各过滤一次，并提示跳过了几个。
         */
        filterInLibraryPaths(paths) {
            const map = new Map((this.entries || []).map((e) => [e.path, e]));
            const dup = [];
            const keep = [];
            (paths || []).forEach((p) => {
                const hit = map.get(p);
                if (hit && hit.inLibrary) dup.push(p);
                else keep.push(p);
            });
            return { keep, dup };
        },
        async openUpload() {
            this.uploadFromLightbox = false;
            this.lightboxUploadTarget = null;
            if (!this.selected.length) return;
            const { keep, dup } = this.filterInLibraryPaths(this.selected);
            if (dup.length) {
                this.$message?.warning(this.$t('localFiles.inLibrarySkipped', { n: dup.length }));
                this.selected = keep;
            }
            if (!this.selected.length) return;
            this.uploadForm = { channelId: '', instanceId: '', uploadFolder: '' };
            this.showUpload = true;
            await this.loadUploadOptions();
        },
        /**
         * v1.0.5：灯箱里点「上传」—— 目标就是当前正在预览的那一个文件。
         * 灯箱内部会随左右滑动换集，所以**必须由灯箱把当前项回传**，
         * 不能用外层的 previewIndex（那个只是打开时的起点）。
         */
        async openLightboxUpload(item) {
            const target = item || this.previewItems[this.previewIndex];
            if (!target?.key) return;
            const hit = (this.entries || []).find((e) => e.path === target.key);
            if (hit && hit.inLibrary) {
                this.$message?.info(this.$t('localFiles.alreadyUploaded'));
                return;
            }
            this.lightboxUploadTarget = { path: target.key, name: target.name };
            this.uploadFromLightbox = true;
            this.uploadForm = { channelId: '', instanceId: '', uploadFolder: '' };
            this.showUpload = true;
            await this.loadUploadOptions();
        },
        /** 渠道（主渠道）+ 实例列表：上传弹窗的两个下拉共用 */
        async loadUploadOptions() {
            try {
                const all = await fetchStorageChannels(true);
                /*
                 * v1.0.5：只列「当前账户可用的主渠道」——
                 * /api/channels 已按授权名单过滤（普通用户只拿到自己被授权的渠道），
                 * 这里再排掉备份渠道：备份渠道只做上传后的一比一镜像，不能当上传目标。
                 */
                this.bedChannels = (all || []).filter((c) => !c.isBackup);
            } catch (e) {
                this.bedChannels = [];
            }
            try {
                const res = await fetchWithAuth('/api/instances');
                const json = await res.json().catch(() => []);
                // v1.0.5：/api/instances 只返回「自己创建的 + 被拉入的」，天然就是该用户名下实例
                this.instances = Array.isArray(json) ? json : [];
            } catch (e) {
                this.instances = [];
            }
        },
        /**
         * 灯箱结果条 → 「查看详情」。
         * v1.0.7：**不再关灯箱** —— 详情弹窗直接叠在灯箱之上（EP 全局 zIndex 基准 3210，
         * 灯箱固定 3200），关掉详情后仍回到原来那张图，浏览位置不丢。
         * 旧实现先 `showPreview = false` 再开详情，视觉上就是「灯箱被踢掉又弹出详情」。
         */
        async viewUploadedFromLightbox() {
            const r = this.lightboxUploadResult;
            this.lightboxUploadResult = null;
            if (!r?.id) return;
            await this.openResultDetail(r);
        },
        /**
         * v1.0.7：统一上传弹窗（UploadTargetDialog）确认后回填表单并开始上传。
         * 旧实现把「开始上传」按钮直接绑在 doUpload 上，现在多了一层组件事件。
         */
        confirmUploadTarget(payload) {
            this.uploadForm = {
                channelId: payload?.channelId || '',
                instanceId: payload?.instanceId || '',
                uploadFolder: payload?.uploadFolder || ''
            };
            this.showUpload = false;
            this.doUpload();
        },
        async doUpload() {
            const fromLightbox = this.uploadFromLightbox;
            const paths = fromLightbox
                ? (this.lightboxUploadTarget ? [this.lightboxUploadTarget.path] : [])
                : this.selected;
            if (!paths.length) return;
            if (!fromLightbox) {
                // v3.0.0（R14）：提交前再兜底过滤一次（防止弹窗打开期间列表刷新导致误传）
                const { keep, dup } = this.filterInLibraryPaths(this.selected);
                if (dup.length) {
                    this.$message?.warning(this.$t('localFiles.inLibrarySkipped', { n: dup.length }));
                    this.selected = keep;
                    if (!this.selected.length) return;
                }
            }
            this.uploading = true;
            if (fromLightbox) this.lightboxUploading = true;
            try {
                const res = await fetchWithAuth('/api/localfiles/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        channelId: this.channelId,
                        paths: fromLightbox ? paths : this.selected,
                        targetChannelId: this.uploadForm.channelId || '',
                        instanceId: this.uploadForm.instanceId || '',
                        uploadFolder: this.uploadForm.uploadFolder || '',
                    }),
                });
                const json = await res.json().catch(() => ({}));
                if (!json.success) throw new Error(json.message || 'upload failed');
                this.results = Array.isArray(json.data) ? json.data : [];
                this.showUpload = false;
                if (fromLightbox) {
                    // 灯箱保持打开：只把这一次的结果挂到顶部结果条
                    const r = this.results[0];
                    this.lightboxUploadResult = r
                        ? { ...r, success: !!r.success }
                        : { success: false, error: this.$t('localFiles.uploadFailed') };
                    if (r && r.success) {
                        // 列表里的「已落库」标记同步刷新，避免再点一次又被后端跳过一次
                        const hit = (this.entries || []).find((e) => e.path === paths[0]);
                        if (hit) hit.inLibrary = true;
                    }
                } else {
                    this.showResult = true;
                }
            } catch (e) {
                this.$message?.error(this.$t('localFiles.uploadFailed'));
                if (fromLightbox) this.lightboxUploadResult = { success: false, error: this.$t('localFiles.uploadFailed') };
            } finally {
                this.uploading = false;
                this.lightboxUploading = false;
            }
        },
        async retryFailed() {
            const failed = this.results.filter((r) => !r.success).map((r) => r.path);
            if (!failed.length) return;
            this.selected = failed;
            this.showResult = false;
            this.uploading = true;
            try {
                const res = await fetchWithAuth('/api/localfiles/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        channelId: this.channelId,
                        paths: failed,
                        targetChannelId: this.uploadForm.channelId || '',
                        instanceId: this.uploadForm.instanceId || '',
                        uploadFolder: this.uploadForm.uploadFolder || '',
                    }),
                });
                const json = await res.json().catch(() => ({}));
                if (!json.success) throw new Error(json.message || 'upload failed');
                this.results = Array.isArray(json.data) ? json.data : [];
                this.showResult = true;
            } catch (e) {
                this.$message?.error(this.$t('localFiles.uploadFailed'));
            } finally {
                this.uploading = false;
            }
        },
    },
};
</script>

<style scoped>
.local-files-page {
    min-height: 100vh;
    background: var(--bg-color, #f5f6f8);
    color: var(--admin-container-color, #303133);
    padding-bottom: 72px;
    --lf-topbar-h: 58px;
}
/*
 * v3.0.0（R7）：顶栏改为固定吸附 ——
 * 页面主体滚动时它始终贴顶；向下滚动上滑隐藏、向上滚动 / 回到顶部立即出现
 * （与后台文件管理页顶栏同一套行为）。
 */
.lf-topbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 8px 16px;
    background: var(--glass-bg);
    border-bottom: 1px solid var(--glass-border);
    backdrop-filter: blur(var(--glass-backdrop-blur, 10px));
    -webkit-backdrop-filter: blur(var(--glass-backdrop-blur, 10px));
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

/* v3.0.0（R11c）：滚动后顶栏背框完全不透明（去掉玻璃半透明与背景模糊） */
.lf-topbar.is-solid {
    background: var(--toolbar-solid-bg, #FAFAFB);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
}

.lf-topbar.is-hidden {
    transform: translateY(-100%);
}
.lf-topbar-spacer {
    flex: 0 0 auto;
}
.lf-topbar-left,
.lf-topbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: wrap;
}
.lf-title {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
    white-space: nowrap;
}
.lf-channel {
    width: 180px;
}
.lf-channel-single {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.lf-search {
    width: 200px;
}
.lf-search-icon {
    cursor: pointer;
}
.lf-type,
.lf-sort {
    width: 118px;
}
/* 排序方向 / 刷新 / 设置：原生按钮，样式与 el-button small 对齐，切换时不闪 */
.lf-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 24px;
    min-width: 28px;
    padding: 0 7px;
    border: 1px solid var(--el-border-color);
    border-radius: var(--el-border-radius-base, 4px);
    background: var(--el-fill-color-blank, #fff);
    color: var(--el-text-color-regular);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    transition: color 0.16s ease, border-color 0.16s ease, background-color 0.16s ease;
}
.lf-icon-btn:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary-light-5);
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.08));
}
/* 夜间/日间模式切换：与全站顶栏按钮同尺寸 */
.lf-theme {
    flex: 0 0 auto;
}
/*
 * v3.0.0（R12）：视图切换（卡片 / 列表）——
 * 与「图床文件管理」页的 .breadcrumb-view-toggle 同款分段滑块：
 * 高度 24px（与顶栏其它小按钮一致），滑块 22×20。
 */
.lf-view-toggle {
    position: relative;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 24px;
    box-sizing: border-box;
    padding: 2px;
    border: 1px solid var(--el-border-color);
    border-radius: 6px;
    background: var(--el-fill-color-blank, #fff);
    overflow: hidden;
    transition: border-color 0.16s ease;
}
.lf-view-toggle:hover {
    border-color: var(--el-color-primary-light-5);
}
.lf-view-toggle::before {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 22px;
    height: 18px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--el-color-primary) 14%, transparent);
    transform: translateX(0);
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: none;
}
.lf-view-toggle.is-list::before {
    transform: translateX(24px);
}
.lf-view-button {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
}
.lf-view-button:focus,
.lf-view-button:focus-visible,
.lf-view-button:active {
    outline: none;
    box-shadow: none;
}
.lf-view-button.is-active {
    color: var(--el-color-primary);
}
/*
 * v3.0.0（R8）：移动端专属按钮 —— 桌面隐藏（display:none），≤1023px 才显示。
 *   · lf-drawer-toggle：目录切换（调出目录树抽屉）；
 *   · lf-mobile-search-toggle：搜索按钮（点击在顶栏下方展开搜索框）。
 */
.lf-mobile-only {
    display: none;
}
.lf-mobile-search-toggle.is-active {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary-light-5);
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.08));
}
/* 移动端展开的搜索行（顶栏占位之后、正常文档流内，不会盖住内容） */
.lf-mobile-search {
    display: none;
    padding: 8px 12px 4px;
    background: var(--glass-bg);
    border-bottom: 1px solid var(--glass-border);
}
.lf-body {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 16px;
}
/*
 * v3.0.0（R7）：左侧目录树
 *   · 高度 = 视口高度 − 顶栏高度 − 上下留白；
 *   · 自身 overflow: auto，目录多时在栏内滚动。
 * v3.0.0（R12）：改为 position: fixed 真正吸附（见模板注释：body 被 OS 设成
 *   overflow-y:auto 后 sticky 失效）；宽度 / 位置由同宽的占位块 .lf-sidebar-ghost 保证。
 */
.lf-sidebar-ghost {
    flex: 0 0 auto;
    width: 220px;
    transition: width 0.2s ease;
}
.lf-sidebar-ghost.is-collapsed {
    width: 32px;
}
.lf-sidebar {
    position: fixed;
    left: 16px;
    top: calc(var(--lf-topbar-h, 58px) + 12px);
    z-index: 20;
    align-self: flex-start;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 220px;
    flex: 0 0 auto;
    height: calc(100vh - var(--lf-topbar-h, 58px) - 24px);
    max-height: calc(100vh - var(--lf-topbar-h, 58px) - 24px);
    box-sizing: border-box;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    padding: 8px 6px 8px 0;
    overflow: auto;
    overscroll-behavior: contain;
    transition: width 0.2s ease;
}
.lf-sidebar.is-collapsed {
    width: 32px;
    padding: 8px 0;
    overflow: visible;
}
/*
 * 折叠按钮：原先用绝对定位 + 固定 20px，收起后外框只剩 28px，
 * 按钮被压扁变形。改成 flex 子项（统一尺寸/居中），收起时自己居中放置。
 */
.lf-sidebar-toggle {
    flex: 0 0 auto;
    align-self: flex-end;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    min-width: 22px;
    padding: 0;
    margin: 0 2px 4px 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
}
.lf-sidebar.is-collapsed .lf-sidebar-toggle {
    align-self: center;
    margin: 0;
}
.lf-sidebar-toggle:hover {
    color: var(--el-color-primary);
    background: var(--el-fill-color-light);
}
.lf-tree {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding-left: 6px;
}
/* v3.0.0（R14）：「目录」标题行 + 右侧「全部收起 / 全部展开」按钮 */
.lf-tree-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 4px 6px 8px;
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--el-bg-color);
}
.lf-tree-tip {
    font-size: 11px;
    color: var(--el-text-color-secondary);
    padding: 0;
}
.lf-tree-all {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 11px;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
}
.lf-tree-all:hover {
    background: var(--el-fill-color);
    color: var(--el-color-primary);
}
/*
 * v3.0.0（R8）：树项改为「内容多宽就多宽」（width:max-content），
 * 超宽时不再截断省略，而是让 .lf-tree 出现底部横向滚动条。
 */
.lf-tree-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: max-content;
    min-width: 100%;
    box-sizing: border-box;
    padding: 5px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
}
.lf-tree-item:hover {
    background: var(--el-fill-color-light);
}
.lf-tree-item.is-active {
    background: color-mix(in srgb, var(--el-color-primary) 14%, transparent);
    color: var(--el-color-primary);
    font-weight: 500;
}
.lf-tree-icon {
    font-size: 12px;
    opacity: 0.75;
}
/*
 * v3.0.0（R8）：折叠 / 展开箭头 ——
 *   · 有子目录：可点（点击只切换折叠态，不进目录），展开时旋转 90°；
 *   · 叶子节点：占位对齐（不可见但占同样宽度）。
 */
.lf-tree-caret {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    color: var(--el-text-color-secondary);
    font-size: 10px;
    cursor: pointer;
    transition: transform 0.15s ease;
}
.lf-tree-caret.is-open {
    transform: rotate(90deg);
}
.lf-tree-caret.is-leaf {
    visibility: hidden;
    cursor: default;
}
/* 树底部横向滚动条（目录名过长时出现） */
.lf-tree::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}
.lf-tree::-webkit-scrollbar-thumb {
    border-radius: 4px;
    background: var(--el-border-color-darker, #c0c4cc);
}
.lf-tree::-webkit-scrollbar-track {
    background: transparent;
}
.lf-tree-empty {
    font-size: 12px;
    color: var(--el-text-color-placeholder);
    padding: 8px;
}
.lf-main {
    flex: 1 1 auto;
    min-width: 0;
}
.lf-breadcrumb {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    padding: 4px 2px 10px;
    font-size: 12px;
}
.lf-crumb {
    border: 0;
    background: transparent;
    color: var(--el-color-primary);
    cursor: pointer;
    font-size: 12px;
    padding: 2px 4px;
    border-radius: 4px;
}
.lf-crumb:hover {
    background: var(--el-fill-color-light);
}
.lf-crumb-sep {
    color: var(--el-text-color-placeholder);
}
.lf-count {
    margin-left: auto;
    color: var(--el-text-color-secondary);
}
.lf-truncated {
    color: var(--el-color-warning);
}
.lf-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
}
.lf-card {
    position: relative;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    padding: 8px;
    cursor: pointer;
    transition: border-color 0.16s ease, box-shadow 0.16s ease;
}
.lf-card:hover {
    border-color: var(--glass-border-hover, var(--el-color-primary-light-5));
}
.lf-card.is-selected {
    border-color: var(--el-color-primary);
    box-shadow: 0 0 0 1px var(--el-color-primary) inset;
}
/*
 * v3.0.0（R9）：缩略图区域统一 1:1 正方形（桌面 / 移动端同比例，随卡片宽度自适应）。
 */
.lf-thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1 / 1;
    width: 100%;
    border-radius: 8px;
    overflow: hidden;
    background: var(--el-fill-color-light);
}
.lf-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
/* v3.0.0（R7）：视频缩略图（首帧画面）—— 与图片同样铺满缩略图区 */
.lf-thumb-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: #000;
    pointer-events: none;
}
.lf-thumb-icon {
    font-size: 30px;
    color: var(--el-text-color-secondary);
}
.lf-dir-thumb {
    color: var(--el-color-warning);
    font-size: 34px;
}
/*
 * v3.0.0（R8）：文件名中段省略（与文件管理页同款）——
 * 开头段可收缩省略、结尾段（扩展名+尾字符）固定不缩，长名保留扩展名可见。
 */
.lf-name {
    display: flex;
    align-items: baseline;
    min-width: 0;
    margin-top: 6px;
    font-size: 12px;
    line-height: 1.4;
    overflow: hidden;
    white-space: nowrap;
}
.lf-name .name-start {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.lf-name .name-end {
    flex: 0 0 auto;
    white-space: nowrap;
}
.lf-meta {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    margin-top: 2px;
    font-size: 11px;
    color: var(--el-text-color-secondary);
}
/* v3.0.0（R12）：已落库文件右下角显示「已落库」替代时间 */
.lf-meta-inlib {
    color: var(--el-color-success);
}
/*
 * v3.0.0（R12）：列表视图 ——
 *   列 = 选择 / 缩略图 / 名称 / 类型 / 大小 / 修改时间 / 状态（与文件管理页列表视图同一套信息层）。
 *   行高 40px，斑马格 + hover 着色；移动端隐藏「类型 / 修改时间」两列，名称自适应。
 */
.lf-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    background: var(--glass-bg);
    overflow: hidden;
}
.lf-list-head,
.lf-list-row {
    display: grid;
    grid-template-columns: 26px 30px minmax(0, 1fr) 70px 82px 132px 68px;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    min-height: 40px;
    box-sizing: border-box;
    font-size: 12px;
}
.lf-list-head {
    min-height: 34px;
    color: var(--el-text-color-secondary);
    font-size: 11px;
    background: var(--el-fill-color-lighter);
    border-bottom: 1px solid var(--glass-border);
}
.lf-list-row {
    border-bottom: 1px solid var(--el-border-color-lighter);
    cursor: pointer;
}
.lf-list-row:last-child {
    border-bottom: 0;
}
.lf-list-row:hover {
    background: var(--el-fill-color-light);
}
.lf-list-row.is-selected {
    background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
}
.lf-list-row.is-dir .lf-col-thumb {
    color: var(--el-color-warning);
}
.lf-col-check,
.lf-col-thumb,
.lf-col-size,
.lf-col-time,
.lf-col-state,
.lf-col-type {
    flex: 0 0 auto;
}
.lf-col-thumb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 5px;
    overflow: hidden;
    background: var(--el-fill-color-light);
    color: var(--el-text-color-secondary);
    font-size: 13px;
}
.lf-col-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.lf-col-name {
    display: flex;
    align-items: baseline;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
}
.lf-col-type,
.lf-col-size,
.lf-col-time,
.lf-col-state {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--el-text-color-secondary);
}
.lf-state-none {
    color: var(--el-text-color-placeholder);
}
/*
 * 列表行内的选中圆圈：v3.0.0（R14）改为常显（独立一列，不再靠悬停才出现）。
 * v3.0.0（R16）修复「表头与内容对不上」：.lf-select 定义在后面且同为单个类名选择器，
 * 会把这里的 position:static 覆盖成 position:absolute —— 圆圈脱离网格流后，
 * 后面的缩略图/名称/类型/大小/时间/状态整体左移一列，看起来就是「列名对不上列内容」。
 * 用 .lf-list-row 前缀提高优先级，把圆圈钉回第一列。
 */
.lf-list-row .lf-select-inline {
    position: static;
    top: auto;
    right: auto;
    opacity: 1;
    width: 18px;
    height: 18px;
    font-size: 10px;
    justify-self: center;
    flex: 0 0 auto;
}
.lf-list-row:hover .lf-select-inline {
    border-color: var(--el-color-primary);
}
/* v3.0.0（R14）：列表行选中后圆圈填充主题色（与卡片视图一致） */
.lf-list-row.is-selected .lf-select-inline {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary);
    color: #fff;
}
/*
 * v3.0.0（R8）：选中按钮 → 右上角小圆圈（旧 .lf-check 在左上角，已整体替换）。
 * v3.0.0（R12）：左上角「已入库」打勾角标已移除（.lf-badge 整块删除）。
 */
/*
 * v1.0.6：WebDAV 文件的「更多操作」按钮（重命名 / 删除）。
 * 卡片右上角（选中圆圈左侧）与列表行右侧各一个；默认透明，悬停才浮现。
 */
.lf-item-menu {
    position: absolute;
    top: 4px;
    right: 28px;
    z-index: 4;
    opacity: 0;
    transition: opacity 0.15s ease;
}
.lf-card:hover .lf-item-menu,
.lf-list-row:hover .lf-item-menu {
    opacity: 1;
}
@media (hover: none) {
    .lf-item-menu { opacity: 1; }
}
.lf-item-menu-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--bg-color, #fff);
    color: var(--el-text-color-secondary, #909399);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 0 0 1px var(--el-border-color-lighter, #ebeef5);
}
.lf-item-menu-btn:hover {
    color: var(--el-color-primary);
}
/* 列表行里的「更多」按钮：行本身是 grid，按钮绝对定位到右侧留白处 */
.lf-list.has-item-menu .lf-list-row {
    position: relative;
    padding-right: 36px;
}
.lf-list.has-item-menu .lf-list-row .lf-item-menu {
    top: 50%;
    right: 8px;
    transform: translateY(-50%);
}
.lf-rename-hint {
    margin: 0 0 10px;
    font-size: 13px;
    color: var(--el-text-color-secondary, #909399);
}
/* 右上角选中圆圈：默认隐藏，卡片悬停 / 列表已有选中时出现；选中后填充主题色并显示勾 */
.lf-select {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 3;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    box-sizing: border-box;
    border: 1.5px solid var(--el-border-color-darker, #909399);
    border-radius: 50%;
    background: var(--bg-color, #fff);
    color: transparent;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
}
.lf-card:hover .lf-select,
.lf-grid.has-selection .lf-select,
.lf-card.is-selected .lf-select {
    opacity: 1;
}
.lf-select:hover {
    border-color: var(--el-color-primary);
}
.lf-card.is-selected .lf-select {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary);
    color: #fff;
}
/* 触屏没有 hover：选中圆圈常显，否则手机上永远选不了第一个文件 */
@media (hover: none) {
    .lf-select {
        opacity: 1;
    }
}
.lf-empty,
.lf-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 60px 0;
    color: var(--el-text-color-secondary);
}
.lf-empty-icon {
    font-size: 34px;
    opacity: 0.6;
}
.lf-empty-hint {
    font-size: 12px;
    color: var(--el-text-color-placeholder);
}
.lf-pager {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 12px;
    padding: 14px 0 4px;
}
/* v3.0.0（R8）：加载更多（点击才追加下一页，与翻页并存） */
.lf-load-more {
    flex: 0 0 auto;
}
.lf-batchbar {
    position: fixed;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    max-width: calc(100vw - 24px);
    padding: 8px 14px;
    border-radius: 12px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    z-index: 30;
    box-sizing: border-box;
}
/*
 * v1.0.6：批量条内容改为可横向滑动、禁止换行（对齐「图床文件管理」页的批量条）。
 * 窄屏上按钮一多就会挤成两行、把页面内容顶上去，滑动比换行更好用。
 */
.lf-batchbar-inner {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
}
.lf-batchbar-inner::-webkit-scrollbar {
    display: none;
}
/* 按钮禁止被压缩成小方块，保证滑动时每个按钮宽度正常 */
.lf-batchbar-inner :deep(.el-button) {
    flex: 0 0 auto;
}
.lf-batch-text {
    flex: 0 0 auto;
    font-size: 13px;
}
.lf-hint {
    margin: 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.lf-result-summary {
    font-size: 13px;
    margin-bottom: 8px;
}
.lf-result-list {
    max-height: 46vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.lf-result-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    padding: 4px 6px;
    border-radius: 6px;
    background: var(--el-fill-color-lighter);
}
.lf-result-row.is-fail {
    background: color-mix(in srgb, var(--el-color-danger) 12%, transparent);
}
.lf-result-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
/* v3.0.0（R8）：上传成功后文件名可点击打开文件详情页 */
.lf-result-name.is-link {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--el-color-primary);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
}
.lf-result-name.is-link:hover {
    text-decoration: underline;
}
.lf-result-ok {
    color: var(--el-color-success);
    flex: 0 0 auto;
}
.lf-result-fail {
    color: var(--el-color-danger);
    flex: 0 0 auto;
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
/* 文件 ID 与外链复制（结果弹窗） */
.lf-result-id {
    flex: 0 0 auto;
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--el-text-color-secondary);
}
.lf-result-copy {
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    cursor: pointer;
    border-radius: 4px;
}
.lf-result-copy:hover {
    color: var(--el-color-primary);
    background: var(--el-fill-color);
}
/*
 * v3.0.0（R8）：移动端两行顶栏 ——
 *   第一行 = 目录切换 + 页面切换 + 渠道下拉（左侧组独占一行）；
 *   第二行 = 上传 / 搜索按钮 / 类型 / 排序 / 方向 / 刷新 / 设置 / 夜间（整行横向滑动）。
 * 桌面搜索框在移动端隐藏，改由搜索按钮在下方展开搜索行（lf-mobile-search）。
 */
@media (max-width: 1023px) {
    .lf-mobile-only {
        display: inline-flex;
    }
    .lf-mobile-search {
        display: block;
    }
    .lf-topbar {
        padding: 6px 8px;
        gap: 6px;
        flex-wrap: wrap;
    }
    .lf-topbar-left {
        flex: 1 1 100%;
        flex-wrap: nowrap;
    }
    /* 第二行整行横向滑动（与后台顶栏同一套做法） */
    .lf-topbar-right {
        flex: 1 1 100%;
        min-width: 0;
        flex-wrap: nowrap;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-x: contain;
        scrollbar-width: none;
        justify-content: flex-start;
    }
    .lf-topbar-right::-webkit-scrollbar {
        display: none;
    }
    .lf-topbar-right > * {
        flex: 0 0 auto;
    }
    /* 桌面搜索框隐藏（按钮 + 下方展开行代替） */
    .lf-topbar-right .lf-search {
        display: none;
    }
    .lf-channel {
        width: 130px;
    }
    .lf-type,
    .lf-sort {
        width: 96px;
    }
    .lf-sidebar {
        display: none;
    }
    .lf-sidebar-ghost {
        display: none;
    }
    .lf-body {
        padding: 8px 10px;
    }
    .lf-grid {
        grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
        gap: 8px;
    }
    /* v3.0.0（R12）：列表视图移动端只留「名称 / 大小 / 状态」，类型与修改时间隐藏 */
    .lf-list-head,
    .lf-list-row {
        grid-template-columns: 24px 26px minmax(0, 1fr) 62px 56px;
        gap: 5px;
        padding: 0 8px;
        min-height: 38px;
    }
    .lf-col-type,
    .lf-col-time {
        display: none;
    }
    /* v3.0.0（R9）：目录按钮靠第一行最右（第一行 = tabs + 渠道 + 目录按钮） */
    .lf-drawer-toggle {
        margin-left: auto;
    }
}
/* 目录树抽屉：给树一点内边距，同左侧目录树样式（作用域样式随插槽内容生效） */
.lf-tree-drawer .lf-tree {
    padding: 0 8px 12px;
}

/* ===== v1.0.5：灯箱内上传完成后的结果条（浮在灯箱之上，不关闭灯箱） ===== */
.lf-lightbox-result {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 3400;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(92vw, 720px);
    padding: 8px 12px;
    border-radius: 10px;
    background: rgba(28, 30, 36, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    color: #e9eaee;
    font-size: 13px;
    line-height: 1.5;
}

.lf-lightbox-result-icon {
    flex: 0 0 auto;
    font-size: 14px;
}

.lf-lightbox-result-icon.is-ok { color: #67c23a; }
.lf-lightbox-result-icon.is-fail { color: #f56c6c; }

.lf-lightbox-result-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.lf-lightbox-result-name {
    font-style: normal;
    opacity: 0.85;
    margin-left: 6px;
}

.lf-fade-enter-active,
.lf-fade-leave-active {
    transition: opacity 0.18s ease, transform 0.18s ease;
}

.lf-fade-enter-from,
.lf-fade-leave-to {
    opacity: 0;
    transform: translateX(-50%) translateY(-6px);
}

@media (max-width: 768px) {
    .lf-lightbox-result {
        top: auto;
        bottom: 16px;
        max-width: 94vw;
        flex-wrap: wrap;
    }
}
</style>

<!--
  非 scoped 样式：下拉面板是 teleport 到 body 的，带 data-v 的 scoped 规则选不中它。
  灯箱本身 z-index 3200，从灯箱里打开的上传弹窗被抬到 3400，
  但 Element Plus 的 select popper 走的是自己的 zIndexContext（2000 出头递增），
  于是「目标渠道 / 归属实例」的下拉明明展开了，却被弹窗遮罩整块盖住 ——
  表现就是用户说的「点了没反应、展示不出来」。这里把这两个面板抬到 3500。
-->
<style>
.lf-upload-select-popper {
    z-index: 3500 !important;
}
</style>
