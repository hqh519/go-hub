<template>
    <!--
        v3.0.0：dashboard-page-v3 = 本页专属的样式作用域标记。
        页面切换下拉 / 顶栏属于 AdminHeader（共享组件），这里不改它，
        改为在本页挂一个标记类，用全局样式（见文件末尾非 scoped 块）限定只影响本页：
          · 下拉列表尾部注入「切换实例」条目（Teleport）
          · 页面切换按钮名称后的实例序号角标（CSS ::after）
          · 移动端顶行五个按钮整组靠右
    -->
    <div
        class="container dashboard-page-v3"
        :class="{ 'has-instance-badge': instanceSeq > 0, 'is-toolbar-stuck': breadcrumbStuck }"
        :style="instanceBadgeStyle"
    >
        <el-container direction="vertical">
            <!-- 「链接格式」是面向管理员的默认外链格式设置，普通用户隐藏该入口 -->
            <!-- v3.0.0：移动端「更多菜单」里的标签管理 → 切到标签管理模式 -->
            <!--
                v3.0.0：本页的「链接格式 / 标签管理 / 声音切换」都由工具栏内部提供图标按钮，
                因此给顶栏传 show-link-format=false（不再渲染右侧工具组的链接格式按钮），
                并用 inline-actions 告诉「更多菜单」不要再重复这三项。
            -->
            <AdminHeader
                active-tab="dashboard"
                :show-link-format="false"
                :inline-actions="true"
                @link-format="showUrlDialog = true"
                @tag-management="enterTagMode"
            >
            >
                <!--
                    v3.0.0（R17）：实例入口已收进左上角「页面切换」弹窗列表的尾部，
                    通过 AdminHeader → DashboardTabs 的 #page-extra 插槽注入（原来是 Teleport）。
                -->
                <template #page-extra="{ close }">
                    <div class="page-option-sep" aria-hidden="true"></div>
                    <button
                        type="button"
                        class="page-option admin-page-instance-option"
                        @click.stop="openInstanceFromPageSwitch(close)"
                    >
                        <!-- v3.0.0：已切换到具体实例时，图标改为该实例的创建序号（默认实例保持 server 图标） -->
                        <span v-if="instanceSeq > 0" class="admin-page-instance-seq">{{ instanceSeq }}</span>
                        <font-awesome-icon v-else icon="server" class="admin-page-instance-icon"/>
                        <span class="admin-page-instance-text">{{ $t('instancePicker.title') }}</span>
                    </button>
                </template>
                <template #search>
                    <div class="search-area" :class="{ 'mobile-search-open': mobileSearchOpen }">
                    <div class="search-card" :class="{ 'is-settings-open': searchSettingsOpen }">
                            <el-input
                                ref="searchInput"
                                v-model="tempSearch"
                                size="small"
                                :placeholder="$t('dashboard.searchPlaceholder')"
                                enterkeyhint="search"
                                @compositionstart="searchComposing = true"
                                @compositionend="searchComposing = false"
                                @keydown.enter="handleSearchEnter"
                                @keyup.enter="handleSearchEnter"
                            >
                                <template #prefix>
                                    <!-- 搜索范围：直接嵌在搜索框起始位置，与输入框合成一个整体 -->
                                    <el-select
                                        v-model="searchType"
                                        size="small"
                                        class="search-type-select"
                                        popper-class="compact-select-popper"
                                        @change="handleSearchTypeChange"
                                    >
                                        <el-option
                                            v-for="opt in searchTypeOptions"
                                            :key="opt.value"
                                            :label="opt.label"
                                            :value="opt.value"
                                        />
                                    </el-select>
                                    <span class="search-scope-sep" aria-hidden="true"></span>
                                </template>
                                <template #suffix>
                                    <!-- 一键清空：仅当搜索框有内容时显示，位于搜索按钮左侧 -->
                                    <button
                                        v-if="tempSearch.length > 0"
                                        type="button"
                                        class="search-clear-trigger"
                                        :aria-label="$t('dashboard.clearSearch')"
                                        :title="$t('dashboard.clearSearch')"
                                        @mousedown.prevent
                                        @click.stop="handleClearSearch"
                                    >
                                        <font-awesome-icon icon="times" class="search-clear-icon" />
                                    </button>
                                    <!--
                                        v2.9.0：搜索图标只负责「执行搜索」。
                                        原来悬停 / 长按弹出的「展示文件夹 / 全部展开」菜单已迁到
                                        卡片/列表视图切换按钮后面，改成两个图标按钮。
                                    -->
                                    <button
                                        type="button"
                                        class="search-icon-trigger"
                                        :aria-label="$t('dashboard.searchPlaceholder')"
                                        @mousedown.prevent
                                        @contextmenu.prevent
                                        @click="handleSearchIconClick"
                                    >
                                        <font-awesome-icon icon="search" class="search-icon" />
                                    </button>
                                </template>
                            </el-input>
                        </div>
                        <!--
                            v3.0.0：顶栏按钮条（搜索 / 筛选 / 标签管理 / 刷新 / 回收站 / 声音 / 链接格式）。
                            · 桌面端：display:contents —— 按钮直接参与 .search-area 的 flex 布局（间距 6px）
                            · 移动端：变成单行横向滚动的按钮条，左侧「页面切换」与右侧「更多菜单」固定不动
                        -->
                        <div class="search-actions">
                        <!-- v2.8.9：移动端搜索按钮（样式同筛选），点一下展开/收起搜索框；刷新页面回到隐藏 -->
                        <span
                            class="el-dropdown-link filter-trigger mobile-search-trigger"
                            role="button"
                            tabindex="0"
                            :title="$t('dashboard.searchPlaceholder')"
                            :aria-label="$t('dashboard.searchPlaceholder')"
                            :aria-expanded="mobileSearchOpen"
                            @click="toggleMobileSearch"
                            @keydown.enter="toggleMobileSearch"
                        >
                            <font-awesome-icon icon="search" class="header-icon"/>
                            <!-- v3.0.0：搜索框存在内容（已提交或输入中）时显示提醒角标，
                                 即使搜索框收起也能知道当前带着搜索条件 -->
                            <span
                                v-if="search.trim() || tempSearch.trim()"
                                class="mobile-search-dot"
                                aria-hidden="true"
                            ></span>
                        </span>
                        <!-- v2.8.7：筛选改弹窗（筛选 / 日期 / 大小 三标签页）；有任一筛选值时按钮显示角标 + 高亮提示 -->
                        <span
                            class="el-dropdown-link filter-trigger filter-dialog-trigger"
                            :class="{ 'is-active': activeFilterCount > 0 }"
                            role="button"
                            tabindex="0"
                            :title="$t('filter.dialogTitle')"
                            :aria-label="$t('filter.dialogTitle')"
                            @click="showFilterDialog = true"
                            @keydown.enter="showFilterDialog = true"
                        >
                            <el-badge :value="activeFilterCount" :hidden="activeFilterCount === 0" class="filter-badge">
                                <font-awesome-icon icon="filter" class="header-icon"/>
                            </el-badge>
                        </span>
                        <FilterDialog
                            v-model="showFilterDialog"
                            v-model:filters="filters"
                            :channelNameOptions="channelNameOptions"
                            :tagOptions="allTags"
                            :userOptions="userFilterOptions"
                            @change="handleFilterChange"
                        />
                        <!-- v3.0.0：筛选按钮后面的「标签管理」—— PC 工具栏入口（移动端已收进更多菜单），
                             进入后文件列表区隐藏、改为标签管理模式面板，按钮显示激活态 -->
                        <span
                            class="el-dropdown-link filter-trigger tag-mode-trigger"
                            :class="{ 'is-active': tagModeActive }"
                            role="button"
                            tabindex="0"
                            :title="$t('dashboard.tagManagement')"
                            :aria-label="$t('dashboard.tagManagement')"
                            :aria-pressed="tagModeActive"
                            @click="toggleTagMode"
                            @keydown.enter="toggleTagMode"
                        >
                            <font-awesome-icon icon="tags" class="header-icon"/>
                            <i v-if="tagModeActive" class="tag-mode-dot"></i>
                        </span>
                        <!-- v2.8.7c：标签筛选已并入筛选弹窗「标签」页，顶栏原「标签」按钮移除 -->
                        <!-- v2.8.8：刷新 / 回收站 / 声音 三个按钮收进一个容器 —— 移动端整组靠右（见 AdminHeader 断点样式） -->
                        <div class="dashboard-header-buttons">
                            <!-- 刷新：不刷新页面，重新拉取当前分类下的文件列表 -->
                            <el-button
                                class="refresh-files-btn"
                                size="small"
                                :title="$t('dashboard.refreshFiles')"
                                :aria-label="$t('dashboard.refreshFiles')"
                                @click="handleRefreshFiles"
                            >
                                <font-awesome-icon icon="sync" :class="{ 'fa-spin': refreshLoading }" class="refresh-files-icon"/>
                            </el-button>
                            <!-- 回收站：切换查看已删除（软删除）的文件，可恢复或彻底删除 -->
                            <el-button
                                class="refresh-files-btn trash-btn"
                                :class="{ 'is-active': trashMode }"
                                size="small"
                                :title="trashMode ? $t('dashboard.trashExit') : $t('dashboard.trashEnter')"
                                :aria-label="trashMode ? $t('dashboard.trashExit') : $t('dashboard.trashEnter')"
                                @click="toggleTrashMode"
                            >
                                <font-awesome-icon icon="trash-alt" :class="{ 'fa-spin': trashLoading }" class="refresh-files-icon"/>
                                <!-- v3.0.0（R7）：进入回收站模式时右上角橙红提示点 -->
                                <i v-if="trashMode" class="trash-mode-dot" aria-hidden="true"></i>
                            </el-button>
                            <!--
                                v2.8.7：全局视频静音开关 —— v3.0.0（R14）按需求迁到「文件详情页 → 下载按钮后面」，
                                顶栏不再保留（状态仍在 store，详情页与预览浮层共用）。
                            -->
                        </div>
                        <!--
                            v3.0.0：链接格式入口 —— 从右侧工具组移出（桌面端与移动端同一位置）。
                            移动端同时也从「更多菜单」里移出，改为这里的图标按钮。
                        -->
                        <button
                            v-if="isAdminRole"
                            class="link-format-btn"
                            type="button"
                            :title="$t('dashboard.linkFormat')"
                            :aria-label="$t('dashboard.linkFormat')"
                            @click="showUrlDialog = true"
                        >
                            <font-awesome-icon icon="link" class="refresh-files-icon"/>
                        </button>
                        </div>
                    </div>
                </template>
            </AdminHeader>
            <el-main class="main-container" :class="{ 'has-batch-toolbar': selectedFiles.length > 0 }">
            <!-- 回收站模式提示条：明确当前列表是已删除文件（外链已 404，可恢复或彻底删除） -->
            <div v-if="trashMode" class="trash-banner" role="status">
                <font-awesome-icon icon="trash-alt" class="trash-banner-icon"/>
                <span class="trash-banner-text">{{ $t('dashboard.trashBanner') }}</span>
                <!-- v1.0.3：回收站内层级导航 —— 当前所在目录 + 返回上一级 -->
                <span class="trash-path" :title="trashPath || $t('dashboard.trashRoot')">
                    <font-awesome-icon icon="folder" class="trash-path-icon"/>
                    {{ trashPath || $t('dashboard.trashRoot') }}
                </span>
                <button v-if="trashPath" type="button" class="trash-up-btn" @click="leaveTrashDir">
                    <font-awesome-icon icon="arrow-left"/> {{ $t('dashboard.trashBackUp') }}
                </button>
            </div>
            <!-- 目录导航（v3.0.0：标签管理模式下第二行整行隐藏，第一行工具栏保留） -->
            <!-- v3.0.0（R4）：外层只做「吸顶时的占位」，移动端吸顶由 JS 切 fixed 实现 -->
            <div
                v-if="!tagModeActive"
                ref="breadcrumbStickyWrap"
                class="breadcrumb-sticky-wrap"
                :class="{ 'is-search-open': mobileSearchOpen }"
            >
            <div
                ref="breadcrumbBar"
                class="breadcrumb-container"
                :class="{ 'is-stuck': breadcrumbStuck, 'is-header-hidden': breadcrumbHeaderHidden }"
            >
                <!-- v3.0.0（R5）：移动端横向滑动只作用于这一段，「数量统计」固定在最右侧 -->
                <div class="breadcrumb-scroll-area">
                    <DashboardCheckbox
                        :checked="selectPage"
                        :indeterminate="selectedPageFiles && !selectPage"
                        variant="breadcrumb"
                        @click="handleSelectPage"
                    />
                    <div
                        class="breadcrumb-view-toggle"
                        :class="{ 'is-list': viewMode === 'list' }"
                        role="group"
                    >
                        <button
                            class="breadcrumb-view-button"
                            :class="{ 'is-active': viewMode === 'card' }"
                            type="button"
                            :title="$t('dashboard.cardView')"
                            :aria-pressed="viewMode === 'card'"
                            @click="setViewMode('card')"
                        >
                            <font-awesome-icon icon="th-large" class="breadcrumb-view-icon"></font-awesome-icon>
                        </button>
                        <button
                            class="breadcrumb-view-button"
                            :class="{ 'is-active': viewMode === 'list' }"
                            type="button"
                            :title="$t('dashboard.listView')"
                            :aria-pressed="viewMode === 'list'"
                            @click="setViewMode('list')"
                        >
                            <font-awesome-icon icon="list" class="breadcrumb-view-icon"></font-awesome-icon>
                        </button>
                    </div>
                    <!--
                        v3.0.0：内容展示方式（展示文件夹 = 按目录分层，默认 / 直接展开文件 = 当前目录递归平铺）。
                        对「全部内容」生效（不依赖搜索或筛选），切换即重新加载（后端 flat 参数）。
                    -->
                    <div
                        class="breadcrumb-view-toggle search-scope-toggle"
                        :class="{ 'is-expanded': searchResultDisplay === 'expanded' }"
                        role="group"
                        :aria-label="$t('fileManager.displayMode')"
                    >
                        <button
                            class="breadcrumb-view-button"
                            :class="{ 'is-active': searchResultDisplay === 'folders' }"
                            type="button"
                            :title="$t('fileManager.showFolders')"
                            :aria-pressed="searchResultDisplay === 'folders'"
                            @click="selectSearchResultDisplay('folders')"
                        >
                            <font-awesome-icon icon="folder-tree" class="breadcrumb-view-icon"></font-awesome-icon>
                        </button>
                        <button
                            class="breadcrumb-view-button"
                            :class="{ 'is-active': searchResultDisplay === 'expanded' }"
                            type="button"
                            :title="$t('fileManager.expandFiles')"
                            :aria-pressed="searchResultDisplay === 'expanded'"
                            @click="selectSearchResultDisplay('expanded')"
                        >
                            <font-awesome-icon icon="bars" class="breadcrumb-view-icon"></font-awesome-icon>
                        </button>
                    </div>
                    <el-dropdown
                        ref="sortDropdown"
                        trigger="click"
                        class="breadcrumb-sort-dropdown"
                        @command="setSortField"
                        @visible-change="handleSortDropdownVisible"
                    >
                        <button
                            class="breadcrumb-sort-button"
                            type="button"
                            :title="sortLabel"
                        >
                            <svg class="breadcrumb-sort-icon" viewBox="0 0 30 18" aria-hidden="true">
                                <g v-if="sortField === 'time'" class="sort-field-glyph">
                                    <circle cx="7.5" cy="9" r="5.5" />
                                    <path d="M7.5 5.5V9L10 10.5" />
                                </g>
                                <g v-else-if="sortField === 'size'" class="sort-field-glyph">
                                    <path d="M2 4H13M2 9H10M2 14H7" />
                                </g>
                                <g v-else-if="sortField === 'rawName'" class="sort-field-glyph">
                                    <path d="M5.5 3L4 15M11 3L9.5 15M2.5 7H13M2 11H12.5" />
                                </g>
                                <g v-else-if="sortField === 'views'" class="sort-field-glyph">
                                    <path d="M2 9S4.5 4.5 7.5 4.5 13 9 13 9 10.5 13.5 7.5 13.5 2 9 2 9Z" />
                                    <circle cx="7.5" cy="9" r="1.8" />
                                </g>
                                <g v-else class="sort-field-glyph">
                                    <path d="M2.5 14L7.5 3L12.5 14M4.3 10H10.7" />
                                </g>
                                <path
                                    v-if="sortOrder === 'asc'"
                                    class="sort-order-glyph"
                                    d="M23 13.5V4.5M19 8.5L23 4.5L27 8.5"
                                />
                                <path
                                    v-else
                                    class="sort-order-glyph"
                                    d="M23 4.5V13.5M19 9.5L23 13.5L27 9.5"
                                />
                            </svg>
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu class="sort-dropdown-menu">
                                <div class="sort-order-wrapper">
                                    <el-radio-group v-model="sortOrder" size="small" @change="setSortOrder">
                                        <el-radio-button label="asc">{{ $t('dashboard.sortAsc') }}</el-radio-button>
                                        <el-radio-button label="desc">{{ $t('dashboard.sortDesc') }}</el-radio-button>
                                    </el-radio-group>
                                </div>

                                <el-divider class="sort-divider" />

                                <el-dropdown-item command="time" :class="{ 'is-selected': sortField === 'time' }">
                                    <span>{{ $t('dashboard.sortByTime') }}</span>
                                    <font-awesome-icon v-if="sortField === 'time'" icon="check" class="sort-field-check" />
                                </el-dropdown-item>
                                <el-dropdown-item command="size" :class="{ 'is-selected': sortField === 'size' }">
                                    <span>{{ $t('dashboard.sortBySize') }}</span>
                                    <font-awesome-icon v-if="sortField === 'size'" icon="check" class="sort-field-check" />
                                </el-dropdown-item>
                                <!-- 「文件名」排在「文件 ID」之前 -->
                                <el-dropdown-item command="fileName" :class="{ 'is-selected': sortField === 'fileName' }">
                                    <span>{{ $t('dashboard.sortByFileName') }}</span>
                                    <font-awesome-icon v-if="sortField === 'fileName'" icon="check" class="sort-field-check" />
                                </el-dropdown-item>
                                <el-dropdown-item command="rawName" :class="{ 'is-selected': sortField === 'rawName' }">
                                    <span>{{ $t('dashboard.sortByRawName') }}</span>
                                    <font-awesome-icon v-if="sortField === 'rawName'" icon="check" class="sort-field-check" />
                                </el-dropdown-item>
                                <el-dropdown-item command="fileType" :class="{ 'is-selected': sortField === 'fileType' }">
                                    <span>{{ $t('dashboard.sortByFileType') }}</span>
                                    <font-awesome-icon v-if="sortField === 'fileType'" icon="check" class="sort-field-check" />
                                </el-dropdown-item>
                                <el-dropdown-item command="views" :class="{ 'is-selected': sortField === 'views' }">
                                    <span>{{ $t('dashboard.sortByViews') }}</span>
                                    <font-awesome-icon v-if="sortField === 'views'" icon="check" class="sort-field-check" />
                                </el-dropdown-item>
                                <!-- 「上传用户」放在排序项目最后 -->
                                <el-dropdown-item command="uploader" :class="{ 'is-selected': sortField === 'uploader' }">
                                    <span>{{ $t('dashboard.sortByUploader') }}</span>
                                    <font-awesome-icon v-if="sortField === 'uploader'" icon="check" class="sort-field-check" />
                                </el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                    <!--
                        v3.0.0：移动端「目录导航选择」改为与「排序」同款的下拉按钮 ——
                        · 「当前」= 只在当前路径的父子层级里导航（原有行为）；
                        · 「全局」= 列出该实例全部目录（按层级缩进、可搜索），点击直接跳转。
                        每次打开弹窗都回到「当前」。
                    -->
                    <!--
                        v3.0.0（R7）：桌面端在原有「点击展开（默认当前层级）」之上叠加「悬停即展开」——
                        悬停打开时直接进入「全局」模式并加载当前实例下的全部目录（按目录树缩进）；
                        触屏 / 窄屏仍只走点击，行为与之前完全一致。
                    -->
                    <div
                        class="breadcrumb-dir-wrap"
                        @mouseenter="handleDirHoverEnter"
                        @mouseleave="handleDirHoverLeave"
                    >
                    <el-dropdown
                        ref="dirDropdown"
                        trigger="click"
                        class="breadcrumb-dir-dropdown"
                        popper-class="dir-hover-popper"
                        @command="navigateToFolder"
                        @visible-change="handleDirDropdownVisible"
                    >
                        <button type="button" class="breadcrumb-dir-button" :title="currentDirFullPath">
                            <font-awesome-icon icon="folder-open" class="breadcrumb-dir-icon"/>
                            <span class="breadcrumb-dir-text">{{ currentDirFullPath }}</span>
                            <font-awesome-icon icon="chevron-down" class="breadcrumb-dir-arrow"/>
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu class="dir-dropdown-menu">
                                <!-- 顶行「当前 / 全局」切换：样式照抄「排序」下拉顶行的单选按钮组 -->
                                <div class="sort-order-wrapper dir-scope-wrapper">
                                    <el-radio-group v-model="dirScope" size="small" @change="handleDirScopeChange">
                                        <el-radio-button label="current">{{ $t('fileManager.dirScopeCurrent') }}</el-radio-button>
                                        <el-radio-button label="global">{{ $t('fileManager.dirScopeGlobal') }}</el-radio-button>
                                    </el-radio-group>
                                </div>
                                <el-divider class="sort-divider" />
                                <!-- 全局模式：目录可能很多，提供搜索 -->
                                <div v-if="dirScope === 'global'" class="dir-search-wrapper" @click.stop>
                                    <el-input
                                        v-model="dirSearch"
                                        size="small"
                                        clearable
                                        :placeholder="$t('fileManager.dirSearchPlaceholder')"
                                    >
                                        <template #prefix>
                                            <font-awesome-icon icon="search" class="dir-search-icon"/>
                                        </template>
                                    </el-input>
                                </div>
                                <el-dropdown-item
                                    v-for="opt in activeDirOptions"
                                    :key="'dir-' + opt.path"
                                    :command="opt.path"
                                    :class="{ 'is-selected': opt.path === normalizedCurrentPath, 'is-ancestor': opt.isAncestor }"
                                >
                                    <span class="dir-item" :style="{ paddingLeft: (opt.depth * 14) + 'px' }">
                                        <font-awesome-icon :icon="opt.depth === 0 ? 'home' : 'folder'" class="dir-item-icon"/>
                                        {{ opt.label }}
                                    </span>
                                </el-dropdown-item>
                                <div
                                    v-if="dirScope === 'global' && allFoldersLoading"
                                    class="dir-empty"
                                >{{ $t('common.loading') }}</div>
                                <div
                                    v-else-if="globalDirEmpty"
                                    class="dir-empty"
                                >{{ $t('fileManager.dirGlobalEmpty') }}</div>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                    </div>
                    <!--
                        v3.0.0（R9）：桌面端面包屑已删除，与「目录导航」按钮合二为一 ——
                        路径展示直接并入目录导航按钮（按钮文本 = 根目录 / 一级 / 二级…），
                        快速跳转沿用下拉里的「当前」层级列表。
                    -->
                    <div class="breadcrumb-right-group">
                        <!-- v2.9.0：右上「用户选择」移除 —— 用户筛选已并入「筛选」弹窗的「用户」页 -->
                        <!-- 新建目录：位于历史记录左侧 -->
                        <el-button class="new-folder-btn" size="small" :title="$t('dashboard.newFolder')" :aria-label="$t('dashboard.newFolder')" @click="handleCreateFolder">
                            <font-awesome-icon icon="plus" class="new-folder-icon"/>
                            <span class="new-folder-text">{{ $t('dashboard.newFolder') }}</span>
                        </el-button>
                        <!-- v2.8.8：登记文件（与前台共用同一弹窗）—— 把一个已在别处的文件登记进系统，不重复上传
                             v2.9.0：打开时把「当前所在目录」代入弹窗的「文件分类」 -->
                        <el-button class="new-folder-btn record-file-btn" size="small" :title="$t('recordFile.title')" :aria-label="$t('recordFile.title')" @click="openRecordDialog">
                            <font-awesome-icon icon="file-circle-plus" class="new-folder-icon"/>
                            <span class="new-folder-text">{{ $t('recordFile.title') }}</span>
                        </el-button>
                        <!-- 历史记录：位于数量统计徽章左侧
                             v2.8.6b：去掉 primary plain 配色 —— 文本/边框颜色与「新建目录」一致 -->
                        <el-button class="history-btn" size="small" :title="$t('dashboard.history')" @click="goHistoryPage">
                            <font-awesome-icon icon="history" class="history-btn-icon"/>
                            <span class="history-btn-text">{{ $t('dashboard.history') }}</span>
                        </el-button>
                    </div>
                </div>
                <!--
                    v3.0.0（R7）：数量统计徽章改为「一键复位」按钮 ——
                    点击即清空搜索关键词、标签搜索、筛选弹窗里的全部条件（含且/或模式），
                    回到默认状态。有生效中的搜索 / 筛选时高亮提示可点。
                -->
                <button
                    type="button"
                    class="stats-badge"
                    :class="{ 'is-active': hasActiveQuery }"
                    :title="hasActiveQuery ? $t('dashboard.statsBadgeResetTitle') : $t('dashboard.totalFiles', { count: $data.Number })"
                    :aria-label="hasActiveQuery ? $t('dashboard.statsBadgeResetTitle') : $t('dashboard.totalFiles', { count: $data.Number })"
                    @click="resetAllQueryConditions"
                >
                    <font-awesome-icon icon="database" class="stats-badge-icon"/>
                    {{ Number }}
                </button>
            </div>
            </div>
            
            <!-- v3.0.0：标签管理模式 —— 文件列表区隐藏，改由 TagModePanel 接管 -->
            <TagModePanel
                v-if="tagModeActive"
                ref="tagModePanel"
                :instance-id="instanceId"
                @close="exitTagMode"
                @changed="handleTagModeChanged"
            />
            <!-- v3.0.0：顶部哨兵 —— 从下往上滚到顶时自动补载上一页（unshift 且保持滚动位置） -->
            <div v-if="!tagModeActive" ref="topSentinel" class="list-sentinel"></div>
            <template v-if="!tagModeActive">
            <!-- 卡片视图 -->
            <div
                v-if="viewMode === 'card'"
                class="content"
                :class="{ 'is-drag-selecting': isDragging }"
                ref="cardContainerRef"
                @touchstart.passive="handlePageSwipeStart"
                @touchend.passive="handlePageSwipeEnd"
                @touchcancel.passive="resetPageSwipe"
            >
                <!-- 加载骨架屏 -->
                <SkeletonLoader v-if="loading" type="card" :count="pageSize" />
                <!-- 空状态 -->
                <div v-else-if="paginatedTableData.length === 0" class="empty-state">
                    <font-awesome-icon icon="folder-open" class="empty-icon" />
                    <p class="empty-text">{{ hasSearchOrFilter ? $t('dashboard.noMatchingFiles') : $t('dashboard.currentDirEmpty') }}</p>
                    <p class="empty-hint">{{ hasSearchOrFilter ? $t('dashboard.adjustSearchHint') : $t('dashboard.uploadHint') }}</p>
                </div>
                <!-- 文件夹和文件列表 -->
                <template v-else v-for="(item, index) in paginatedTableData" :key="`${item.isFolder ? 'folder' : 'file'}:${item.name}`">
                    <!-- 文件夹卡片（v1.0.3：回收站里同样是文件夹卡片 —— 点进去看这一层删了什么） -->
                    <FolderCard
                        v-if="isFolder(item)"
                        :name="item.name"
                        v-model:selected="item.selected"
                        :folderStats="item.metadata?.folderStats || null"
                        :shared="!!item.shared"
                        :sharedOwner="item.sharedOwner || ''"
                        :sharedSelf="!!item.sharedSelf"
                        :sharedReadonly="isSharedReadonly(item)"
                        :displayName="item.displayName || ''"
                        :showActions="!isSearchMode && !trashMode"
                        :deleting="isDeleting(item)"
                        :deleting-label="trashMode ? $t('dashboard.trashProcessing') : ''"
                        :disableTooltip="disableTooltip"
                        :showSelect="hasSelectedFolders"
                        @click.capture="handleShiftClickCapture($event, index)"
                        @enter="enterFolderItem(item)"
                        @props="trashMode ? null : openFolderProps(item)"
                        @copy="trashMode ? null : handleFolderCopy(item.name)"
                        @move="trashMode ? null : handleMove(index, item.name)"
                        @delete="trashMode ? null : handleDelete(index, item.name)"
                        @touchstart="handleFolderTouchStart(item, index)"
                        @touchend="handleTouchEnd"
                        @touchmove="handleTouchEnd"
                    />
                    <!-- 文件卡片 -->
                    <FileCard 
                        v-else
                        :item="item"
                        v-model:selected="item.selected"
                        :fileLink="getFileLink(item.name)"
                        :previewSrcList="item.previewSrcList"
                        :disableTooltip="disableTooltip"
                        :deleting="isDeleting(item)"
                        :deleting-label="trashMode ? $t('dashboard.trashProcessing') : ''"
                        :showSelect="hasSelectedFiles"
                        :sharedReadonly="isSharedReadonly(item)"
                        @click.capture="handleShiftClickCapture($event, index)"
                        @detail="openDetailDialog(index, item.name)"
                        @openLink="handleOpenLink(item.name)"
                        @copy="handleCopy(index, item.name)"
                        @move="handleMove(index, item.name)"
                        @delete="handleDelete(index, item.name)"
                        @download="handleDownload(item.name)"
                        @touchstart="handleTouchStart(item, index)"
                        @touchend="handleTouchEnd"
                        @touchmove="handleTouchEnd"
                        @previewMedia="openMediaPreview"
                    />
                </template>
            </div>
            <!-- 列表视图 -->
            <div
                v-else
                class="list-view"
                :class="{ 'is-drag-selecting': isDragging }"
                ref="listContainerRef"
                @touchstart.passive="handlePageSwipeStart"
                @touchend.passive="handlePageSwipeEnd"
                @touchcancel.passive="resetPageSwipe"
            >
                <!--
                    v2.5.0：列表视图改为「历史记录列表」样式（圆角卡片行、无表头）——
                    表头整行移除，全选入口保留在面包屑左侧的「本页全选」复选框。
                -->
                <!-- 列表骨架屏 -->
                <SkeletonLoader v-if="loading" type="list" :count="pageSize" />
                <!-- 空状态 -->
                <div v-else-if="paginatedTableData.length === 0" class="empty-state list-empty">
                    <font-awesome-icon icon="folder-open" class="empty-icon" />
                    <p class="empty-text">{{ hasSearchOrFilter ? $t('dashboard.noMatchingFiles') : $t('dashboard.currentDirEmpty') }}</p>
                    <p class="empty-hint">{{ hasSearchOrFilter ? $t('dashboard.adjustSearchHint') : $t('dashboard.uploadHint') }}</p>
                </div>
                <!-- 实际数据 -->
                <template v-else>
                    <FileListItem
                        v-for="(item, index) in paginatedTableData"
                        :key="`${item.isFolder ? 'folder' : 'file'}:${item.name}`"
                        :item="item"
                        v-model:selected="item.selected"
                        :fileLink="getFileLink(item.name)"
                        :sharedReadonly="isSharedReadonly(item)"
                        :deleting="isDeleting(item)"
                        :deleting-label="trashMode ? $t('dashboard.trashProcessing') : ''"
                        :folderHint="trashMode && !isFolder(item) ? (item.folder || '') : ''"
                        @click.capture="handleShiftClickCapture($event, index)"
                        @enter="enterFolderItem(item)"
                        @props="openFolderProps(item)"
                        @detail="openDetailDialog(index, item.name)"
                        @copy="handleCopy(index, item.name)"
                        @folderCopy="handleFolderCopy(item.name)"
                        @move="handleMove(index, item.name)"
                        @delete="handleDelete(index, item.name)"
                        @download="handleDownload(item.name)"
                        @openLink="handleOpenLink(item.name)"
                        @touchstart="isFolder(item) ? handleFolderTouchStart(item, index) : handleTouchStart(item, index)"
                        @touchend="handleTouchEnd"
                        @touchmove="handleTouchEnd"
                        @previewMedia="openMediaPreview"
                    />
                </template>
            </div>
            
            <!-- 选区矩形覆盖层 -->
            <div
              v-if="isDragging"
              class="drag-select-overlay"
              :style="{
                position: 'fixed',
                left: selectionRect.left + 'px',
                top: selectionRect.top + 'px',
                width: selectionRect.width + 'px',
                height: selectionRect.height + 'px'
              }"
            ></div>
            </template>

            <!-- v3.0.0：底部哨兵 —— 滚动到底自动追加下一页（与「加载更多」同一加载函数） -->
            <div v-if="!tagModeActive" ref="bottomSentinel" class="list-sentinel"></div>

            <div v-if="!tagModeActive" class="pagination-container">
                <div class="pagination-center">
                    <!-- v3.0.0：分页按后端总数（listTotal）计算，翻页时用该页数据替换列表 -->
                    <el-pagination
                        v-if="listTotal > effectivePageSize"
                        background
                        layout="prev, pager, next"
                        :total="listTotal"
                        :page-size="effectivePageSize"
                        :current-page="currentPage"
                        :pager-count="pagerCount"
                        @current-change="handlePageChange">
                    </el-pagination>
                    <!--
                        v3.0.0：「加载更多」= 把下一页追加到当前列表（不翻页、不改当前页码）；
                        没有更多时按钮直接隐藏。v3.0.0：底部自动加载已移除，仅手动点击本按钮加载。
                        v3.0.0：底部「重新加载」按钮已移除（刷新走顶栏「刷新」）。
                    -->
                    <el-button
                        v-if="hasMoreRows"
                        type="primary"
                        @click="loadMoreData()"
                        :loading="listLoading"
                        class="load-more">
                        {{ $t('dashboard.loadMore') }}
                        <span class="load-more-count">(+{{ Math.max(listTotal - loadedRows, 0) }})</span>
                    </el-button>
                </div>
                <div class="pagination-right">
                    <span class="page-total">{{ $t('dashboard.totalPages', { count: realTotalPages }) }}</span>
                    <div class="page-jump">
                        <span>{{ $t('dashboard.jumpTo') }}</span>
                        <el-input 
                            v-model="jumpPage" 
                            size="small" 
                            class="jump-input"
                            @keyup.enter="handleJumpPage"
                        />
                        <el-button size="small" type="primary" @click="handleJumpPage" class="jump-btn">GO</el-button>
                    </div>
                </div>
            </div>
            </el-main>
        </el-container>
        <BatchActionBar
            :selected-count="selectedFiles.length"
            :mode="trashMode ? 'trash' : 'normal'"
            @action="handleBatchAction"
            @clear="clearSelection"
        />
        <!-- v3.0.0（R9）：悬停预览浮层（HoverPreview）已随「小眼睛」一并移除 -->
        <!-- 文件详情弹窗 -->
        <FileDetailDialog
            v-model="showdetailDialog"
            :file="detailFile"
            :fileLink="getFileLink(detailFile?.name)"
            :urls="allUrl"
            :trashMode="trashMode"
            :trashBusy="trashBusy"
            @download="handleDownload(detailFile?.name)"
            @tagManagement="handleTagManagement(detailFile?.name)"
            @block="handleBlock(detailFile?.name)"
            @white="handleWhite(detailFile?.name)"
            @delete="handleDetailDelete(detailFile?.name)"
            @restore="handleDetailTrash('restore', detailFile)"
            @purge="handleDetailTrash('purge', detailFile)"
            @metadataUpdated="handleMetadataUpdated"
            @fileRenamed="handleFileRenamed"
        />
        <el-dialog :title="$t('dashboard.linkFormat')" v-model="showUrlDialog" :width="dialogWidth" :show-close="false" class="settings-dialog settings-dialog-scope">
            <div class="dialog-section">
                <div class="section-header">
                    <span class="section-title">{{ $t('settings.defaultCopyLink') }}</span>
                </div>
                <div class="section-content">
                    <el-radio-group v-model="defaultUrlFormat" class="radio-card-group grid-2x2">
                        <el-radio label="originUrl" class="radio-card">
                            <font-awesome-icon icon="link" class="radio-icon"/>
                            <span>{{ $t('settings.rawLink') }}</span>
                        </el-radio>
                        <el-radio label="mdUrl" class="radio-card">
                            <font-awesome-icon icon="code" class="radio-icon"/>
                            <span>Markdown</span>
                        </el-radio>
                        <el-radio label="htmlUrl" class="radio-card">
                            <font-awesome-icon icon="code-branch" class="radio-icon"/>
                            <span>HTML</span>
                        </el-radio>
                        <el-radio label="bbUrl" class="radio-card">
                            <font-awesome-icon icon="quote-right" class="radio-icon"/>
                            <span>BBCode</span>
                        </el-radio>
                    </el-radio-group>
                </div>
            </div>

            <div class="dialog-section">
                <div class="section-header">
                    <span class="section-title">{{ $t('settings.customLink') }}</span>
                    <el-tooltip :content="$t('settings.customLinkTooltip')" placement="top" raw-content>
                        <font-awesome-icon icon="question-circle" class="section-help-icon"/>
                    </el-tooltip>
                </div>
                <div class="section-content">
                    <div class="setting-item">
                        <span class="setting-label">{{ $t('settings.enableCustom') }}</span>
                        <el-switch v-model="useCustomUrl" active-value="true" inactive-value="false" />
                    </div>
                    <div class="setting-item" v-if="useCustomUrl === 'true'">
                        <span class="setting-label">{{ $t('settings.customPrefix') }}</span>
                        <el-input v-model="customUrlPrefix" :placeholder="$t('settings.customPrefixPlaceholder')" class="setting-input"/>
                    </div>
                </div>
            </div>

            <div class="dialog-action">
                <el-button type="primary" @click="showUrlDialog = false" class="confirm-btn">{{ $t('settings.confirm') }}</el-button>
            </div>
        </el-dialog>

        <!-- Tag Management Dialog -->
        <TagManagementDialog
            v-model="showTagDialog"
            :fileId="currentTagFile"
            :fileMetadata="tagFileMetadata"
            @tagsUpdated="handleTagsUpdated"
        />

        <!-- Batch Tag Management Dialog -->
        <BatchTagDialog
            v-model="showBatchTagDialog"
            :selectedFiles="selectedFiles"
            @tagsUpdated="handleBatchTagsUpdated"
        />
        <!-- 移动端操作菜单 -->
        <MobileActionSheet
            v-model="showMobileActionModal"
            :title="mobileActionIsFolder ? getFolderName(mobileActionFile?.name || '') : (mobileActionFile?.metadata?.FileName || getFileName(mobileActionFile?.name || ''))"
            :isFolder="mobileActionIsFolder"
            :sharedReadonly="isSharedReadonly(mobileActionFile)"
            :sharedNoDelete="isSharedToMe(mobileActionFile)"
            @action="handleMobileAction"
        />
        <!-- 标签筛选弹窗：多选已有标签，「或 / 且」切换 -->
        <el-dialog
            v-model="showTagFilterDialog"
            :title="$t('dashboard.tagFilter')"
            :width="dialogWidth"
            class="tag-filter-dialog"
            append-to-body
        >
            <div class="tag-filter-toolbar">
                <el-radio-group v-model="tagModeDraft" size="small">
                    <el-radio-button label="or">{{ $t('dashboard.tagModeOr') }}</el-radio-button>
                    <el-radio-button label="and">{{ $t('dashboard.tagModeAnd') }}</el-radio-button>
                </el-radio-group>
                <span class="tag-filter-hint">
                    {{ tagModeDraft === 'or' ? $t('dashboard.tagModeOrHint') : $t('dashboard.tagModeAndHint') }}
                </span>
            </div>
            <div class="tag-filter-list" v-loading="tagFilterLoading">
                <button
                    v-for="t in allTags"
                    :key="t.name"
                    type="button"
                    class="tag-filter-chip"
                    :class="{ 'is-selected': tagDraft.includes(t.name) }"
                    :aria-pressed="tagDraft.includes(t.name)"
                    @click="toggleTagDraft(t.name)"
                >
                    <span class="tag-filter-name">{{ t.name }}</span>
                    <span class="tag-filter-count">{{ t.count }}</span>
                </button>
                <div v-if="!tagFilterLoading && allTags.length === 0" class="tag-filter-empty">
                    {{ $t('dashboard.tagFilterEmpty') }}
                </div>
            </div>
            <template #footer>
                <el-button @click="showTagFilterDialog = false">{{ $t('common.cancel') }}</el-button>
                <el-button @click="clearTagFilter" :disabled="tagDraft.length === 0">{{ $t('dashboard.tagFilterClear') }}</el-button>
                <el-button type="primary" @click="applyTagFilter">{{ $t('common.confirm') }}</el-button>
            </template>
        </el-dialog>

        <!-- v2.8.8：登记文件弹窗（与前台「登记文件」同一组件、同一套字段与探测逻辑） -->
        <RecordFileDialog
            v-model="showRecordDialog"
            :isAdmin="true"
            :initialFolder="recordInitialFolder"
            @registered="handleRecorded"
        />

        <!-- v2.9.0：媒体预览浮层（点缩略图触发）—— 图片灯箱 / 视频播放器 / 音频播放器 / 通用弹窗 -->
        <MediaPreviewOverlay
            v-model="showMediaPreview"
            :items="mediaPreviewItems"
            :startIndex="mediaPreviewIndex"
            show-detail
            :detailOpen="showdetailDialog"
            @detail="handleMediaPreviewDetail"
            @close-detail="showdetailDialog = false"
            @view-uploaded="handleViewUploadedSnapshot"
        />

        <!--
            移动文件对话框
            v3.0.0：批量移动时开 showInstancePicker ——
            先在弹窗内选「接收实例」，再按目标实例拉目录树选目录（两步每次都重走）。
        -->
        <MoveFileDialog
            v-model="showMoveDialog"
            :current-directory="currentPath"
            :is-batch-move="isBatchMove"
            :initial-path="moveTargetPath"
            :show-instance-picker="isBatchMove"
            :instance-id="instanceId"
            @confirm="confirmMove"
        />

        <!-- v3.0.0：批量编辑原名 -->
        <BatchOriginalNameDialog
            v-model="showBatchNameDialog"
            :ids="selectedFileIds"
            @done="handleBatchMutated"
        />
        <!-- v3.0.0：批量限时 / 重定向（按点进来的按钮预设页签） -->
        <BatchExpiryDialog
            v-model="showBatchExpiryDialog"
            :ids="selectedFileIds"
            :initial-mode="batchExpiryMode"
            @done="handleBatchMutated"
        />
        <!-- v3.0.0：目录属性（点文件夹名称打开；组件由其它代理提供，缺失时降级提示） -->
        <FolderPropsDialog
            v-if="hasFolderPropsDialog"
            :visible="showFolderProps"
            :folder-path="folderPropsTarget.path"
            :folder-name="folderPropsTarget.name"
            :instance-id="instanceId"
            @close="showFolderProps = false"
            @update:visible="showFolderProps = $event"
            @saved="handleFolderPropsSaved"
        />

        <!--
            v3.0.0：「切换实例」居中弹窗（入口在左上角页面切换下拉的尾部）
            · 列出「默认 + 各实例」，按 index 升序，名称前显示序号（默认实例不显示）；
            · 底部「实例管理」链接 → 新标签打开用户管理页的实例管理锚点。
        -->
        <el-dialog
            v-model="showInstanceDialog"
            :title="$t('instancePicker.title')"
            :width="dialogWidth"
            append-to-body
            align-center
            class="instance-switch-dialog"
        >
            <div class="instance-switch-list">
                <button
                    type="button"
                    class="instance-switch-item"
                    :class="{ 'is-active': !instanceId }"
                    @click="switchInstanceTo('')"
                >
                    <span class="instance-switch-icon"><font-awesome-icon icon="server"/></span>
                    <span class="instance-switch-name">{{ $t('instancePicker.defaultInstance') }}</span>
                    <font-awesome-icon v-if="!instanceId" icon="check" class="instance-switch-check"/>
                </button>
                <button
                    v-for="ins in orderedInstances"
                    :key="'sw-' + ins.id"
                    type="button"
                    class="instance-switch-item"
                    :class="{ 'is-active': String(instanceId) === String(ins.id) }"
                    @click="switchInstanceTo(ins.id)"
                >
                    <span class="instance-switch-seq">{{ instanceSeqOf(ins) }}</span>
                    <span class="instance-switch-name">{{ ins.name }}</span>
                    <span v-if="ins.note" class="instance-switch-note">{{ ins.note }}</span>
                    <font-awesome-icon
                        v-if="String(instanceId) === String(ins.id)"
                        icon="check"
                        class="instance-switch-check"
                    />
                </button>
                <div v-if="!orderedInstances.length" class="instance-switch-empty">
                    {{ $t('instancePicker.empty') }}
                </div>
            </div>
            <div class="instance-switch-footer">
                <button type="button" class="instance-switch-manage" @click="openInstanceManagement">
                    {{ $t('instancePicker.manage') }}
                </button>
            </div>
        </el-dialog>

    </div>
</template>

<script>
import { mapGetters } from 'vuex';
import JSZip from 'jszip';
import AdminHeader from '@/components/dashboard/AdminHeader.vue';
import TagManagementDialog from '@/components/dashboard/TagManagementDialog.vue';
import BatchTagDialog from '@/components/dashboard/BatchTagDialog.vue';
import SkeletonLoader from '@/components/dashboard/SkeletonLoader.vue';
import FileCard from '@/components/dashboard/FileCard.vue';
import FolderCard from '@/components/dashboard/FolderCard.vue';
import MoveFileDialog from '@/components/dashboard/MoveFileDialog.vue';
import FileListItem from '@/components/dashboard/FileListItem.vue';
// v2.9.0：媒体预览浮层（图片灯箱 / 视频播放器 / 音频播放器 / 通用弹窗）
import MediaPreviewOverlay from '@/components/dashboard/MediaPreviewOverlay.vue';
import FileDetailDialog from '@/components/dashboard/FileDetailDialog.vue';
import BatchActionBar from '@/components/dashboard/BatchActionBar.vue';
import MobileActionSheet from '@/components/dashboard/MobileActionSheet.vue';
import DashboardCheckbox from '@/components/dashboard/DashboardCheckbox.vue';
// v3.0.0：标签管理模式面板 / 批量改原名 / 批量限时·重定向
import TagModePanel from '@/components/dashboard/TagModePanel.vue';
import BatchOriginalNameDialog from '@/components/dashboard/BatchOriginalNameDialog.vue';
import BatchExpiryDialog from '@/components/dashboard/BatchExpiryDialog.vue';
import FilterDialog from '@/components/dashboard/FilterDialog.vue';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
// v2.8.8：登记文件弹窗（与前台共用同一组件）
import RecordFileDialog from '@/components/upload/RecordFileDialog.vue';
import { fileManager } from '@/utils/fileManager';
// v1.1.3：实例切换密码守卫（三个页面共用同一份实现）
import { ensureInstanceUnlocked } from '@/utils/instanceSwitch';
import { thumbUrl } from '@/utils/thumb';
import { registerLayer, unregisterLayer } from '@/utils/layerStack';
// 文件详情通用数据构造器（与「历史记录」页共用同一套模板 + 同一套链接拼装逻辑）
import {
    buildFileDetailUrls as buildFileDetailUrlsUtil,
    fileExtOf as fileExtOfUtil,
    withExt as withExtUtil,
    filePublicUrl as filePublicUrlUtil,
} from '@/utils/fileDetail';
import { CHANNEL_TYPES } from '@/components/config/channel-schema';
import { channelTypeCode } from '@/utils/storageChannels';
import fetchWithAuth from '@/utils/fetchWithAuth';
import axios from '@/utils/axios';
import { validateFolderPath } from '@/utils/pathValidator';
import { copyText } from '@/utils/clipboard';
import { getLinkPrefix } from '@/utils/fileLink';
import backgroundManager from '@/mixins/backgroundManager';
import pageActivation from '@/mixins/pageActivation';
import { ref, defineAsyncComponent } from 'vue';
import { useDragSelect } from '@/utils/dashboard/useDragSelect.js';
import { bindScrollDismiss } from '@/utils/scrollDismiss';

/*
 * v3.0.0：目录属性弹窗（FolderPropsDialog.vue）由其它代理并行新建。
 * 这里用 import.meta.glob 做「可选加载」：文件还没落地时不会让构建失败，
 * 点到文件夹名称时给一条提示（落地后自动生效，无需再改本文件）。
 */
const folderPropsModules = import.meta.glob('../components/dashboard/FolderPropsDialog.vue');
// 取第一个加载器（glob 的 key 形式随 Vite 版本可能是相对路径或绝对路径，不依赖具体 key）
const folderPropsLoader = Object.values(folderPropsModules)[0];
const FolderPropsDialog = folderPropsLoader ? defineAsyncComponent(folderPropsLoader) : null;

/** v3.0.0：实例选择的 localStorage 键（值 = 实例 id 或空串 = 默认实例） */
const INSTANCE_STORAGE_KEY = 'gohub_instance_id';

/** v3.0.0：默认筛选条件（清空 / 切实例时复用，避免遗漏字段） */
function createEmptyFilters() {
    return {
        accessStatus: [],
        listType: [],
        label: [],
        fileType: [],
        channel: [],
        channelName: [],
        uploadSource: [],
        backup: [],
        redirect: [],
        tags: [],
        tagNames: [],
        // 标签模式默认「且」（and），与后端口径一致
        tagMode: 'and',
        datePreset: '',
        dateFrom: '',
        dateTo: '',
        sizePreset: '',
        sizeMin: 0,
        sizeMax: 0,
        sizeUnit: 'MB',
        sizeMode: 'actual',
        validity: [],
        nameChanged: [],
        userNames: [],
        // v3.0.0：用户共享单选项（'mine' | 'tome' | ''）
        shareScope: '',
        // 全局条件组合：and（且）/ or（或）
        matchMode: 'and',
        dimPreset: '',
        widthMin: 0,
        widthMax: 0,
        heightMin: 0,
        heightMax: 0,
        // v3.0.0（R8）：评级（评分 / 等级范围；null = 不限）
        ratingMin: null,
        ratingMax: null,
        levelMin: null,
        levelMax: null
    };
}

/** v3.0.0：读取持久化的实例 id（没有则默认实例） */
function readStoredInstanceId() {
    try {
        return localStorage.getItem(INSTANCE_STORAGE_KEY) || '';
    } catch {
        return '';
    }
}

const SORT_FIELDS = ['time', 'size', 'fileName', 'rawName', 'fileType', 'views', 'uploader'];
const SORT_ORDERS = ['asc', 'desc'];
const SEARCH_RESULT_DISPLAYS = ['folders', 'expanded'];
// v3.0.0（R12）：回收站每页条数（需求：每页 48 条；普通文件列表仍为 24）
const TRASH_PAGE_SIZE = 48;

function getStoredOption(key, validValues, fallback) {
    try {
        const value = localStorage.getItem(key);
        return validValues.includes(value) ? value : fallback;
    } catch {
        return fallback;
    }
}

export default {
name: 'AdminDashBoard',
mixins: [backgroundManager, pageActivation],
data() {
    return {
        Number: 0,
        directFileCount: 0, // 当前目录直接子文件数量
        directFolderCount: 0, // 当前目录直接子文件夹数量
        showLogoutButton: false,
        tableData: [],
        tempSearch: '',
        search: '',
        searchKeywords: '', // Keywords only (without tag filters) for backend search
        searchIncludeTags: '', // 包含的标签，逗号分隔
        searchExcludeTags: '', // 排除的标签，逗号分隔
        // 搜索类型：搜索前先选（全部 / 标题 / 标签 / 分类 / 用户 / 其他）
        searchType: 'all',
        // 上传用户筛选（仅管理员，默认全部）
        userFilter: 'all',
        userOptions: [],
        isSearchMode: false,
        /*
         * v3.0.0：内容展示方式 —— 'folders'（展示文件夹，按目录分层，默认）/
         * 'expanded'（直接展开文件，当前目录递归平铺）。不做持久化，刷新后回到默认。
         */
        searchResultDisplay: 'folders',
        searchSettingsOpen: false,
        // v2.8.9：移动端搜索框是否展开（不持久化 —— 刷新页面默认收起）
        mobileSearchOpen: false,
        searchIconPressTimer: null,
        searchIconPressStart: null,
        searchIconLongPressed: false,
        // v3.0.0：搜索防抖计时器（回车提交时先清掉，保证立即查询）
        searchDebounceTimer: null,
        // v3.0.0：中文输入法组词中（此时回车只是确认候选词，不触发搜索）
        searchComposing: false,
        // v3.0.0（第三轮）：回车提交去重时间戳（keydown + keyup 各触发一次时只提交一次）
        lastSearchSubmitAt: 0,
        currentPage: 1,
        pageSize: 24, // v2.5.0：卡片视图每行 8 个 × 3 行 = 24（与历史记录封面样式对齐）
        selectedFiles: [],
        sortField: getStoredOption('sortField', SORT_FIELDS, 'time'),
        sortOrder: getStoredOption('sortOrder', SORT_ORDERS, 'desc'),
        isUploading: false,
        showdetailDialog: false,
        detailFile: null,
        activeUrlTab: 'originUrl',
        defaultUrlFormat: 'originUrl',
        showUrlDialog: false,
        useCustomUrl: 'false', // 是否启用自定义链接
        customUrlPrefix: '', // 自定义链接前缀
        loading: false, // 加载状态
        currentPath: '', // 当前文件夹路径
        refreshLoading: false,
        // 回收站模式：查看软删除文件，可恢复 / 彻底删除
        trashMode: false,
        trashLoading: false,
        /*
         * v1.0.3：回收站内当前所在目录（与普通浏览的 currentPath 分开，互不干扰）。
         * 空串 = 回收站根目录；进入子目录后只显示该层的子目录与文件。
         */
        trashPath: '',
        trashParent: '',
        normalTableData: [], // 退出回收站时还原普通文件列表
        // v3.0.0（R12）：进入回收站前的分页状态（退出时还原，避免沿用回收站的总数/页码）
        normalListState: null,
        // v3.0.0（R12）：回收站服务端分页 —— 每页 48 条（与普通列表的 24 条区分开）
        trashTotal: 0,
        // v3.0.0（R12）：正在删除的条目 key 集合（卡片/列表行显示转圈遮罩，需求 43）
        deletingKeys: [],
        /*
         * v1.0.1：回收站「恢复 / 彻底删除」执行中标记。
         * 回收站条目常常是从「文件详情」弹窗里操作的，而卡片上的转圈遮罩被弹窗盖住看不见，
         * 所以再把同一个状态传给详情弹窗，让它的「恢复 / 彻底删除」按钮也转圈并禁用，
         * 与普通文件软删除时的反馈保持一致。
         */
        trashBusy: false,
        // v3.0.0（R12）：目录属性里的自定义名称（path → 名称），列表/全局目录各存一份
        folderNameMap: {},
        allFolderNames: {},
        showTagDialog: false, // 标签管理对话框
        showBatchTagDialog: false, // 批量标签管理对话框
        currentTagFile: '', // 当前标签管理的文件
        viewMode: 'card', // 视图模式：card 或 list
        // v3.0.0（R4）：移动端「全选 / 视图切换」工具栏是否已吸附到顶栏下方（仅用于附加背景，不影响定位）
        breadcrumbStuck: false,
        // v3.0.0（R14）：第二行吸附的复位阈值（未吸附时测量并缓存，避免吸附期间布局变化导致提前复位）
        breadcrumbThreshold: null,
        // v3.0.0（R5）：顶栏是否处于「向下滚动已上滑隐藏」状态 —— 第二行与顶栏同进同出
        breadcrumbHeaderHidden: false,
        // v2.8.5：悬停预览大图（PC 卡片小眼睛 / 列表缩略图）
        showMobileActionModal: false, // 移动端操作模态框
        mobileActionFile: null, // 当前移动端操作的文件
        mobileActionIndex: -1, // 当前移动端操作的文件索引
        mobileActionIsFolder: false, // 是否为文件夹操作
        longPressTimer: null, // 长按计时器
        // v3.0.0：目录导航下拉「当前」模式的候选目录（当前目录的直接子目录，后端 /list 下发的 directories）
        directories: [],
        jumpPage: '', // 跳转页码输入
        // 筛选相关状态（数组形式支持多选）
        filters: {
            accessStatus: [], // 访问状态: 'normal'(正常), 'blocked'(已屏蔽)
            listType: [],     // 黑白名单: 'White', 'Block', 'None'
            label: [],         // 审查结果: 'normal', 'teen', 'adult'
            fileType: [],      // 文件类型: 'image', 'video', 'audio', 'other'
            channel: [],       // 渠道类型: 后端 CHANNEL_LABEL（COS/MinIO/R2/S3/EasyImages/Lsky/WebDAV/Immich/External）
            channelName: [],   // 渠道名称: 动态获取
            backup: []         // 备份状态: 'backedup' | 'unbackedup'
            ,redirect: []      // 重定向: 'yes'（已设置） | 'no'（未设置）
            ,tags: []          // 标签有无: 'has'（含标签） | 'none'（未含标签）
            ,tagNames: []      // 标签筛选弹窗选中的标签名
            ,tagMode: 'and'    // 标签筛选模式: 'and'（且/全部） | 'or'（或/任一），默认「且」
            // v2.8.7：日期 / 大小筛选（筛选弹窗「日期」「大小」标签页）
            ,datePreset: ''    // 日期快捷预设: today|yesterday|beforeYesterday|thisWeek|lastWeek|thisMonth
            ,dateFrom: ''      // 起始日期 YYYY-MM-DD（含当天）
            ,dateTo: ''        // 结束日期 YYYY-MM-DD（含当天）
            ,sizePreset: ''    // 大小快捷预设: lt100k|lt1m|lt10m|lt100m|gt100m
            ,sizeMin: 0        // 最小大小（字节，0 = 不限）
            ,sizeMax: 0        // 最大大小（字节，0 = 不限）
            ,sizeUnit: 'MB'    // 自定义大小输入单位
            // v2.8.9：大小口径 / 有效期 / 名称状态 / 尺寸
            ,sizeMode: 'actual'  // 'actual'（实际大小）| 'original'（原始大小）
            ,validity: []        // 有效期: 'limited' | 'expired' | 'permanent'
            ,nameChanged: []     // 名称状态: 'changed'（已改名） | 'unchanged'（未改名）
            ,userNames: []       // v2.9.0 用户页：上传用户（多选，命中任一即可）
            ,shareScope: ''      // v3.0.0 用户共享：'mine'（我共享的）| 'tome'（共享给我的）| ''
            ,matchMode: 'and'    // v3.0.0 条件组合方式: 'and'（且） | 'or'（或）
            ,dimPreset: ''       // 尺寸快捷: landscape|portrait|square|ratio-4-3|ratio-16-9|360p…8k
            ,widthMin: 0         // 宽最小（px，0 = 不限）
            ,widthMax: 0         // 宽最大
            ,heightMin: 0        // 高最小
            ,heightMax: 0        // 高最大
            // v3.0.0（R8）：评级筛选（评分 0-5 半星 / 等级 0-5；null = 该侧不限）
            ,ratingMin: null
            ,ratingMax: null
            ,levelMin: null
            ,levelMax: null
        },
        // v2.8.7：筛选弹窗显隐
        showFilterDialog: false,
        // v2.8.8：登记文件弹窗显隐（与前台共用 RecordFileDialog）
        showRecordDialog: false,
        // v2.9.0：打开登记弹窗时快照当前目录，作为「文件分类」默认值
        recordInitialFolder: '',
        // v2.9.0：媒体预览浮层（点缩略图打开；索引为当前页可预览媒体列表里的位置）
        showMediaPreview: false,
        mediaPreviewIndex: 0,
        channelNameOptions: [], // 动态从文件列表中提取
        // 标签筛选弹窗
        showTagFilterDialog: false,
        allTags: [], // [{ name, count }]
        tagFilterLoading: false,
        tagDraft: [], // 弹窗内待应用的标签（点确定才生效）
        // v3.0.0：标签模式草稿默认「且」（and）
        tagModeDraft: 'and',
        // 移动文件对话框相关状态
        showMoveDialog: false, // 移动文件对话框
        moveTargetPath: '/', // 移动目标路径
        moveFileKey: '', // 当前移动的文件key
        moveFileIndex: -1, // 当前移动的文件索引
        isBatchMove: false, // 是否为批量移动
        pageSwipeStartX: null,
        pageSwipeStartY: null,
        pageSwipeStartTime: 0,
        /* ---------------- v3.0.0 多实例 ---------------- */
        instanceId: readStoredInstanceId(), // '' = 默认实例
        instances: [],
        /* ---------------- v3.0.0（R7）目录导航悬停展开 ---------------- */
        dirHoverOpened: false,
        dirHoverLeaveTimer: null,
        /* ---------------- v3.0.0 标签管理模式 ---------------- */
        tagModeActive: false,
        /* ---------------- v3.0.0 列表窗口（服务端分页） ---------------- */
        listTotal: 0,        // 后端返回的文件总数（当前目录 / 扁平化后）
        fileWindowStart: 0,  // 当前已加载窗口在文件序列中的起始偏移
        fileWindowCount: 0,  // 当前已加载的文件条数
        listLoading: false,
        lastAutoLoadAt: 0,
        /* ---------------- v3.0.0 批量操作弹窗 ---------------- */
        showBatchNameDialog: false,
        showBatchExpiryDialog: false,
        batchExpiryMode: 'expiry',
        /* ---------------- v3.0.0 实例切换弹窗 ---------------- */
        showInstanceDialog: false,
        /* ---------------- v3.0.0 目录导航下拉：当前 / 全局 ---------------- */
        dirScope: 'current',      // 'current'（父子层级）| 'global'（该实例全部目录）
        dirSearch: '',
        allFolders: [],           // GET /api/manage/folders/all 的结果（字符串路径数组）
        allFoldersLoading: false,
        /* ---------------- v3.0.0 列表缓存时间（页面重新可见时判断是否过期） ---------------- */
        lastListLoadedAt: 0,
        /* ---------------- v3.0.0（R16）Shift 区间选择：上次单击选中的行号锚点 ---------------- */
        lastSelectedIndex: -1,
        /* ---------------- v3.0.0 移动端返回键：目录层级守卫 ---------------- */
        isTouchNav: false,
        /* ---------------- v3.0.0 目录属性 ---------------- */
        showFolderProps: false,
        folderPropsTarget: { path: '', name: '' },
        hasFolderPropsDialog: Boolean(FolderPropsDialog)
    }
},
components: {
    AdminHeader,
    TagManagementDialog,
    BatchTagDialog,
    SkeletonLoader,
    FileCard,
    FolderCard,
    FileListItem,
    MediaPreviewOverlay,
    FileDetailDialog,
    BatchActionBar,
    MobileActionSheet,
    DashboardCheckbox,
    TagModePanel,
    BatchOriginalNameDialog,
    BatchExpiryDialog,
    // v3.0.0：目录属性弹窗（可选加载，缺失时为 null 不注册）
    ...(FolderPropsDialog ? { FolderPropsDialog } : {}),
    FilterDialog,
    MoveFileDialog,
    LanguageSwitcher,
    RecordFileDialog
},
setup() {
    const cardContainerRef = ref(null);
    const listContainerRef = ref(null);
    const viewModeRef = ref('card');
    const itemsRef = ref([]);

    const { isDragging, selectionRect } = useDragSelect({
        modes: {
            card: { containerRef: cardContainerRef, itemSelector: '.file-card, .folder-card' },
            list: { containerRef: listContainerRef, itemSelector: '.list-item' },
        },
        viewMode: viewModeRef,
        items: itemsRef,
    });

    return {
        cardContainerRef,
        listContainerRef,
        viewModeRef,
        itemsRef,
        isDragging,
        selectionRect,
    };
},
computed: {
    tagFileMetadata() { return this.tableData.find(file => file.name === this.currentTagFile)?.metadata || {}; },
    ...mapGetters(['adminUrlSettings', 'userConfig']),
    /**
     * v3.0.0（R16）：当前账户是否开启两步验证 ——
     * 由 /api/userConfig 的 accountTotpEnabled 下发，
     * 回收站彻底删除据此决定「只验动态码」还是「输入确认删除」。
     */
    accountTotpEnabled() {
        return this.userConfig?.accountTotpEnabled === true;
    },
    /** v2.8.7：全局视频静音开关（Vuex 持久化，跨页面记忆） */
    globalVideoMuted() {
        return this.$store.state.globalVideoMuted;
    },
    filteredTableData() {
        return this.tableData;
    },
    /*
     * v3.0.0：分页改为「服务端总数」驱动 —— 列表里只放当前已加载的窗口
     * （翻页时整页替换，加载更多时向后追加，往上滚时向前补载）。
     */
    totalPages() {
        return Math.ceil(this.listTotal / this.effectivePageSize) || 1;
    },
    realTotalPages() {
        return Math.ceil(this.listTotal / this.effectivePageSize) || 1;
    },
    /** 已加载的窗口里还有没有下一页（加载更多按钮的显隐依据） */
    hasMoreRows() {
        return this.fileWindowStart + this.fileWindowCount < this.listTotal;
    },
    /** v3.0.0（R12）：分页条实际使用的每页条数 —— 回收站 48，普通列表 24 */
    effectivePageSize() {
        return this.trashMode ? TRASH_PAGE_SIZE : this.pageSize;
    },
    /** 加载更多按钮上的「(＋N)」剩余条数 */
    loadedRows() {
        return this.fileWindowStart + this.fileWindowCount;
    },
    /** 当前窗口里文件夹行数（它们不参与分页，永远排在文件行前面） */
    folderRowCount() {
        return this.tableData.filter((item) => item.isFolder).length;
    },
    /** v3.0.0：选中文件的 File_ID 列表（批量改原名 / 限时 / 重定向用） */
    selectedFileIds() {
        return this.selectedFiles.filter((f) => !f.isFolder).map((f) => f.name);
    },
    /**
     * v3.0.0：卡片视图里是否存在「被选中的文件」。
     * 有 → 所有文件卡片常显右上角勾选框，避免用户找不到多选入口。
     */
    hasSelectedFiles() {
        return this.selectedFiles.some((f) => !f.isFolder);
    },
    /**
     * v3.0.0（R14）：卡片视图里是否存在「被选中的文件夹」。
     * 有 → 其余文件夹卡片也常显右上角选择圆圈（与文件卡片同口径）。
     */
    hasSelectedFolders() {
        return this.selectedFiles.some((f) => !!f.isFolder);
    },
    /** v3.0.0：实例列表按创建序号（index，1-based）升序，用于「切换实例」弹窗与序号角标 */
    orderedInstances() {
        return [...(this.instances || [])].sort((a, b) => {
            const ia = Number(a?.index) || 0;
            const ib = Number(b?.index) || 0;
            if (ia !== ib) return ia - ib;
            const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
            return ta - tb;
        });
    },
    /**
     * v3.0.0：当前实例的创建序号（默认实例 = 0，表示不显示角标）。
     * 取 /api/instances 下发的 index（1-based）；缺失时回落到列表顺序。
     */
    instanceSeq() {
        if (!this.instanceId) return 0;
        const hit = this.orderedInstances.find((i) => String(i.id) === String(this.instanceId));
        if (!hit) return 0;
        const idx = Number(hit.index);
        if (Number.isFinite(idx) && idx > 0) return idx;
        const pos = this.orderedInstances.findIndex((i) => String(i.id) === String(this.instanceId));
        return pos >= 0 ? pos + 1 : 0;
    },
    /** v3.0.0：序号角标文案（②、③…；超过 20 用 (n)），通过 CSS 变量交给页面切换按钮的 ::after */
    instanceBadgeStyle() {
        const n = this.instanceSeq;
        if (!n) return null;
        const circled = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
        const text = n <= circled.length ? circled[n - 1] : `(${n})`;
        return { '--instance-seq': `"${text}"` };
    },
    /** v3.0.0：目录导航下拉的候选项（按 dirScope 切换「当前 / 全局」） */
    activeDirOptions() {
        if (this.dirScope !== 'global') return this.directoryNavOptions;
        const keyword = String(this.dirSearch || '').trim().toLowerCase();
        const list = keyword
            ? (this.allFolders || []).filter((p) => String(p).toLowerCase().includes(keyword))
            : (this.allFolders || []);
        // v3.0.0（R8）：悬停展开 = 当前实例目录树 + 当前路径链自动高亮（祖先 / 当前）
        const cur = this.normalizedCurrentPath;
        const out = [{ path: '', label: this.$t('dashboard.rootDirectory'), depth: 0, isAncestor: !!cur, isCurrent: !cur }];
        list.forEach((raw) => {
            const path = String(raw).replace(/^\/+|\/+$/g, '');
            if (!path) return;
            const parts = path.split('/').filter(Boolean);
            const isCurrent = path === cur;
            const isAncestor = !isCurrent && cur.startsWith(`${path}/`);
            out.push({ path, label: this.displayFolderName(path), depth: parts.length, isAncestor, isCurrent });
        });
        return out;
    },
    /** v3.0.0（R12）：目录显示名（目录属性里改过名就用自定义名称，否则用路径末段） */
    folderNameOf() {
        return { ...(this.allFolderNames || {}), ...(this.folderNameMap || {}) };
    },
    /** v3.0.0：全局模式下没有可跳转目录（根目录那条不算）时的空态 */
    globalDirEmpty() {
        if (this.dirScope !== 'global' || this.allFoldersLoading) return false;
        return !this.allFolders.length;
    },
    /** 当前目录（去掉首尾斜杠），用于目录下拉的选中态 */
    normalizedCurrentPath() {
        return String(this.currentPath || '').replace(/^\/+|\/+$/g, '');
    },
    currentDirLabel() {
        return this.displayFolderName(this.normalizedCurrentPath);
    },
    /** v3.0.0（R9）：完整路径展示（并入目录导航按钮）—— 根目录 / 一级 / 二级 */
    currentDirFullPath() {
        const parts = this.normalizedCurrentPath.split('/').filter(Boolean);
        if (!parts.length) return this.$t('dashboard.rootDirectory');
        // v3.0.0（R12）：每一级都优先用目录属性里的自定义名称
        let acc = '';
        return parts
            .map((part) => {
                acc = acc ? `${acc}/${part}` : part;
                return this.displayFolderName(acc);
            })
            .join(' / ');
    },
    /**
     * v3.0.0：目录导航下拉的候选项 —— 根目录 + 当前路径的每一级（面包屑层级）
     * + 当前目录的直接子目录，深度决定缩进。
     */
    directoryNavOptions() {
        const out = [{ path: '', label: this.$t('dashboard.rootDirectory'), depth: 0 }];
        const parts = this.normalizedCurrentPath.split('/').filter(Boolean);
        let acc = '';
        parts.forEach((part, index) => {
            acc = acc ? `${acc}/${part}` : part;
            out.push({ path: acc, label: this.displayFolderName(acc), depth: index + 1 });
        });
        (this.directories || []).forEach((dir) => {
            const path = String(dir).replace(/^\/+|\/+$/g, '');
            out.push({ path, label: this.displayFolderName(path), depth: parts.length + 1 });
        });
        return out;
    },
    // 计算当前激活的筛选条件数量（数组形式）
    activeFilterCount() {
        // v2.8.7：数组条件 + 日期 / 大小条件一起计数（任一标签页有值 → 筛选按钮显示角标）
        let count = Object.values(this.filters).reduce((acc, v) => acc + (Array.isArray(v) ? v.length : 0), 0);
        if (this.filters.dateFrom || this.filters.dateTo) count += 1;
        if ((Number(this.filters.sizeMin) || 0) > 0 || (Number(this.filters.sizeMax) || 0) > 0) count += 1;
        // v3.0.0：用户共享（单选字符串）同样计入角标
        if (this.filters.shareScope) count += 1;
        // v2.8.9：原始大小口径、尺寸条件同样计入角标
        if (this.filters.sizeMode === 'original') count += 1;
        if (
            this.filters.dimPreset ||
            (Number(this.filters.widthMin) || 0) > 0 || (Number(this.filters.widthMax) || 0) > 0 ||
            (Number(this.filters.heightMin) || 0) > 0 || (Number(this.filters.heightMax) || 0) > 0
        ) count += 1;
        // v3.0.0（R8）：评级条件（任一侧非 null）同样计入角标
        const hasRatingFilter = ['ratingMin', 'ratingMax', 'levelMin', 'levelMax']
            .some((k) => this.filters[k] !== null && this.filters[k] !== undefined);
        if (hasRatingFilter) count += 1;
        return count;
    },
    // 判断是否处于搜索或筛选模式
    hasSearchOrFilter() {
        return this.isSearchMode || this.activeFilterCount > 0;
    },
    /**
     * v3.0.0（R7）：当前是否存在任何「搜索 / 筛选」条件 ——
     * 数量统计徽章据此切换「一键复位」提示与高亮态。
     */
    hasActiveQuery() {
        return !!(
            this.activeFilterCount > 0 ||
            String(this.searchKeywords || '').trim() ||
            String(this.searchIncludeTags || '').trim() ||
            String(this.searchExcludeTags || '').trim() ||
            (this.searchType && this.searchType !== 'all') ||
            (this.isAdminRole && this.userFilter && this.userFilter !== 'all')
        );
    },
    /** 是否管理员（普通用户看不到用户筛选等管理项） */
    isAdminRole() {
        return this.$store.getters.isAdminRole === true;
    },
    /** 搜索类型下拉选项 */
    searchTypeOptions() {
        return [
            { value: 'all', label: this.$t('dashboard.searchTypeAll') },
            { value: 'title', label: this.$t('dashboard.searchTypeTitle') },
            { value: 'tag', label: this.$t('dashboard.searchTypeTag') },
            { value: 'category', label: this.$t('dashboard.searchTypeCategory') },
            { value: 'user', label: this.$t('dashboard.searchTypeUser') },
            { value: 'note', label: this.$t('dashboard.searchTypeNote') },
            { value: 'other', label: this.$t('dashboard.searchTypeOther') },
        ];
    },
    /**
     * v3.0.0：「直接展开文件」对全部内容生效（不再只在搜索/筛选时递归）——
     * 它决定列表请求是否带 flat=true（递归平铺当前目录、不返回文件夹）。
     */
    recursiveSearchResults() {
        return this.searchResultDisplay === 'expanded';
    },
    /**
     * v2.9.0：当前页「可预览媒体」平铺列表（按当前视图顺序，不含文件夹）
     * 供媒体预览浮层的左右切换、底部缩略图条、音频播放列表使用；
     * 只覆盖当前页，与「汇集当前页音频」的需求一致，不额外请求后端。
     */
    mediaPreviewItems() {
        const out = [];
        (this.paginatedTableData || []).forEach((row) => {
            if (this.isFolder(row)) return;
            const meta = row.metadata || {};
            const kind = this.mediaKindOf(row);
            const ext = this.fileExt(meta) || this.fileExt(row.name) || '';
            out.push({
                key: row.name,
                name: (meta.FileName || row.name || '').split('/').pop(),
                url: this.getFileLink(row.name, meta),
                kind,
                ext,
                /*
                 * v1.0.4：灯箱占位图。与卡片缩略图同源（同为 thumb=320），
                 * 打开灯箱时浏览器缓存直接命中，原图还在路上就先有画面可看。
                 * 尺寸与 FileCard 保持 320：尺寸一变就是新 URL，缓存必然落空。
                 */
                thumb: kind === 'image' ? thumbUrl(this.getFileLink(row.name, meta), 320) : '',
                sizeText: this.fileSizeTextOf(meta),
                user: meta.UploadUser || ''
            });
        });
        return out;
    },
    paginatedTableData() {
        /*
         * v3.0.0：不再做本地切片 —— 列表里出现的就是「已加载窗口」的全部行
         * （翻页 = 服务端整页替换；加载更多 = 向窗口尾部追加；上滚 = 向头部补载）。
         */
        const sortedData = this.sortData(this.filteredTableData);
        let data = sortedData;
        // 增加previewSrcList属性，用于预览图片
        const fullList = data.filter(file => this.isImage(file)).map(file => this.getFileLink(file.name));
        data.forEach(file => {
            if (this.isImage(file)) {
                // 重新排序，索引大于等于当前索引的元素在前，否则在后
                file.previewSrcList = fullList.slice(fullList.indexOf(this.getFileLink(file.name))).concat(fullList.slice(0, fullList.indexOf(this.getFileLink(file.name))));
            }
        });
        // 增加channelTag属性，用于显示渠道信息（统一走后端下发的简称）
        data.forEach(file => {
            const short = file.metadata?.ChannelShort;
            const channel = file.metadata?.Channel;
            if (short) {
                file.channelTag = short;
            } else if (!channel) {
                file.channelTag = this.$t('dashboard.unknownTag');
            } else if (channel === 'External') {
                file.channelTag = 'DIY';
            } else {
                file.channelTag = channel;
            }
            // 备份渠道角标：有备份才展示
            const backups = file.metadata?.BackupChannels;
            file.backupTags = Array.isArray(backups)
                ? backups.map((b) => (b.label && b.name ? `${b.label} / ${b.name}` : b.name || b.label || '')).filter(Boolean)
                : [];
            file.viewsCount = Number(file.metadata?.Views || 0);
        });
        return data;
    },
    sortLabel() {
        const labelKeys = {
            time: 'dashboard.sortByTime',
            size: 'dashboard.sortBySize',
            rawName: 'dashboard.sortByRawName',
            fileName: 'dashboard.sortByFileName',
            views: 'dashboard.sortByViews',
            uploader: 'dashboard.sortByUploader',
            fileType: 'dashboard.sortByFileType'
        };
        const fieldLabel = this.$t(labelKeys[this.sortField] || labelKeys.time);
        const orderLabel = this.$t(this.sortOrder === 'desc' ? 'dashboard.sortDesc' : 'dashboard.sortAsc');
        return `${fieldLabel} · ${orderLabel}`;
    },
    dialogWidth() {
        return window.innerWidth > 768 ? '50%' : '90%';
    },
    detailDialogWidth() {
        return window.innerWidth > 768 ? '70%' : '90%';
    },
    accessType() {
        if (this.detailFile?.metadata?.ListType === 'White') {
            return this.$t('filter.normal');
        } else if (this.detailFile?.metadata?.ListType === 'Block' || this.detailFile?.metadata?.Label === 'adult') {
            return this.$t('filter.blocked');
        } else {
            return this.$t('filter.normal');
        }
    },
    allUrl() {
        // 统一走 utils/fileDetail —— 与「历史记录」页共用同一套链接拼装逻辑
        return buildFileDetailUrlsUtil(this.detailFile || {});
    },
    tableColumnNum() {
        return window.innerWidth > 768 ? 3 : 1;
    },
    tablePreviewSpan() {
        return window.innerWidth > 768 ? 2 : 1;
    },
    disableTooltip() {
        return window.innerWidth < 768;
    },
    selectPage() {
        // 如果当前页所有文件都被选中，则返回 true，否则返回 false
        // v3.0.0（R8）：只读共享条目不可选中，不参与「全选完成」判定
        const selectable = this.paginatedTableData.filter(file => !this.isSharedReadonly(file));
        return selectable.length > 0 && selectable.every(file => file.selected);
    },
    selectedPageFiles() {
        // 如果当前页有文件被选中，则返回 true，否则返回 false
        return this.paginatedTableData.some(file => file.selected);
    },
    /** 本站访问域名（仅用于非文件链接） */
    linkOrigin() {
        return document.location.origin;
    },
    /** 文件外链前缀：全站统一出口（自定义访问域名优先）；启用「自定义链接格式」时用其自定义前缀 */
    rootUrl() {
        if (this.useCustomUrl === 'true') {
            const p = String(this.customUrlPrefix || '');
            return p && !p.endsWith('/') ? `${p}/` : p;
        }
        return getLinkPrefix();
    },
    isSelectAll: {
        get() {
            return this.paginatedTableData.length > 0 && this.paginatedTableData.every(file => file.selected);
        },
        set(val) {
            this.paginatedTableData.forEach(file => file.selected = val);
        }
    },
    isIndeterminate() {
        const selectedCount = this.paginatedTableData.filter(file => file.selected).length;
        return selectedCount > 0 && selectedCount < this.paginatedTableData.length;
    },
    pagerCount() {
        return window.innerWidth < 768 ? 5 : 7;
    },
    /**
     * v2.9.0：筛选弹窗「用户」页的候选。
     * v1.0.3：文件管理已改为「每个账户只看自己名下的文件」（管理员不再跨账户可见），
     * 用户筛选失去意义，直接不给候选 —— 弹窗里的「用户」页会自动隐藏。
     */
    userFilterOptions() {
        return [];
    }
},
watch: {
    // v2.8.7b：筛选弹窗打开时加载全部标签（供弹窗「标签」页多选）
    showFilterDialog(v) {
        if (v) this.loadAllTags();
    },
    // Sync viewMode data property to the ref used by useDragSelect
    viewMode: {
        handler(newVal) {
            this.viewModeRef = newVal;
        },
        immediate: true
    },
    // Sync paginatedTableData computed property to the ref used by useDragSelect
    paginatedTableData: {
        handler(newVal) {
            this.itemsRef = newVal;
        },
        immediate: true
    },
    tableData: {
        handler(newData) {
            /*
             * v1.0.2：恢复文件夹可选中 —— 目录条目参与多选，
             * 这里只兜底剔除「只读共享」条目（文件 / 目录都适用）。
             */
            newData.forEach((it) => { if (it.selected && this.isSharedReadonly(it)) it.selected = false; });
            // selectedFiles 增加 newData中新选中，不包含在 selectedFiles 中的文件
            this.selectedFiles = this.selectedFiles.concat(newData.filter(file => file.selected && !this.selectedFiles.includes(file)));
            // selectedFiles 删掉 newData 中已取消选中的文件
            this.selectedFiles = this.selectedFiles.filter(file => file.selected);
            // selectedFiles 删掉 tableData 中已删除的文件
            this.selectedFiles = this.selectedFiles.filter(file => newData.includes(file));
        },
        deep: true
    },
    defaultUrlFormat(newFormat) {
        localStorage.setItem('defaultUrlFormat', newFormat);
    },
    // v3.0.0：标签管理模式会移除列表哨兵节点，切回来时重新挂载观察者
    tagModeActive(v) {
        this.$nextTick(() => {
            if (!v) this.setupListObservers();
            else this.teardownListObservers();
        });
    },
    // v3.0.0：「直接展开文件 / 展示文件夹」切换后列表结构变化，重挂哨兵
    searchResultDisplay() {
        this.$nextTick(() => this.setupListObservers());
    },
    showdetailDialog(newVal) {
        if (newVal) {
            this.activeUrlTab = this.defaultUrlFormat || 'originUrl';
            /*
             * v1.0.2：显式把「文件详情」登记为一层浮层。
             *
             * 原来靠 backGuard 用 MutationObserver 观察 .el-overlay 来登记，登记时刻比
             * 灯箱晚一帧甚至更久；叠在灯箱上时如果登记还没生效，返回键 / Esc 会认为栈顶
             * 仍是灯箱 → 先关灯箱、详情页反而留在屏幕上（用户反馈的原问题）。
             * 这里在弹窗真正打开时立即登记（此时灯箱早已在栈里），栈顶顺序天然正确。
             *
             * v1.0.3：`esc: false` —— 桌面端 Esc 交给 Element Plus 自己处理，
             * 这样弹窗里展开的下拉框 / 输入法候选会先收起来，而不是一按 Esc 就关整个详情页；
             * 弹窗关掉后栈顶回到灯箱，再按一次 Esc 才关灯箱。移动端返回键仍由浮层栈
             * 调用下面这个 close 回调，逐层关闭。
             */
            registerLayer('file-detail', () => { this.showdetailDialog = false; }, { esc: false });
        } else {
            unregisterLayer('file-detail');
        }
    },
    customUrlPrefix(val) {
        this.$store.commit('setAdminUrlSettings', { key: 'customUrlPrefix', value: val })
    },
    useCustomUrl(val) {
        this.$store.commit('setAdminUrlSettings', { key: 'useCustomUrl', value: val })
    },
    currentPath(val) {
        // 页面切换时，取消选择的内容
        this.tableData.forEach(file => file.selected = false);
        // v3.0.0（R16）：换目录重置 Shift 区间锚点
        this.lastSelectedIndex = -1;
        // v2.7.0：目录记忆 —— 每次切换目录都持久化，重新进入文件管理页时恢复
        try { sessionStorage.setItem('dashboardCurrentPath', val || ''); } catch (e) { /* 忽略 */ }
    },
    currentPage() {
        // v3.0.0（R16）：翻页后行号对应的数据变了，重置 Shift 区间锚点
        this.lastSelectedIndex = -1;
    }
},
methods: {
    /*
     * v3.0.0（R16）：不再「自动刷新」文件列表。
     * 此前页面重新激活（切标签页回来 / 窗口聚焦，且距上次加载超过 5 分钟）会静默重拉，
     * 用户要求：只有点击「刷新」按钮（或执行上传/删除等主动操作）才刷新内容。
     * 钩子保留（mixin 契约），但不再发任何请求。
     */
    onPageActivate() {
        // v3.0.0（R16）：禁止自动刷新 —— 内容仅在点击刷新按钮 / 主动操作后更新
    },
    // 切换视图模式
    setViewMode(mode) {
        if (this.viewMode === mode) {
            return;
        }
        this.viewMode = mode;
        localStorage.setItem('viewMode', this.viewMode);
    },
    // 列表视图全选当前页
    handleSelectAllPage(val) {
        /*
         * v1.0.2：恢复文件夹可选中 —— 全选覆盖文件与文件夹。
         * 只读共享条目（文件 / 目录）仍不参与选择。
         */
        this.paginatedTableData.forEach(item => {
            item.selected = val ? !this.isSharedReadonly(item) : false;
        });
    },
    /*
     * v3.0.0（R16）：Shift + 点击复选框 → 批量选中区间（PC 端）。
     * 在 capture 阶段拦截：按住 Shift 点击时阻止 el-checkbox 自己的单选切换，
     * 改为把 [锚点行, 当前行] 之间所有条目一键勾选；普通点击则记录锚点。
     * 锚点在翻页 / 切目录 / 清空选择时重置。
     */
    handleShiftClickCapture(e, index) {
        const t = e.target;
        if (!t || typeof t.closest !== 'function') return;
        const box = t.closest('.card-select, .list-col-checkbox');
        if (!box) return;
        if (e.shiftKey) {
            if (this.lastSelectedIndex < 0) {
                // 没有锚点：退化为单选本次点击行
                e.preventDefault();
                e.stopPropagation();
                // v1.0.2：文件夹恢复可选中（只读共享仍排除）
                const cur = this.paginatedTableData[index];
                if (cur && !this.isSharedReadonly(cur)) cur.selected = true;
                this.lastSelectedIndex = index;
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const a = Math.min(this.lastSelectedIndex, index);
            const b = Math.max(this.lastSelectedIndex, index);
            // v1.0.2：区间选择包含文件夹，只读共享条目跳过
            let count = 0;
            this.paginatedTableData.forEach((it, i) => {
                if (i >= a && i <= b && !this.isSharedReadonly(it)) { it.selected = true; count += 1; }
            });
            if (count) this.$message && this.$message.success(this.$t('dashboard.shiftRangeSelected', { count }));
            return;
        }
        // 普通点击：记录锚点（勾选/取消交给 el-checkbox 自己）
        this.lastSelectedIndex = index;
    },
    // 移动端长按开始
    handleTouchStart(item, index) {
        this.longPressTimer = setTimeout(() => {
            this.mobileActionFile = item;
            this.mobileActionIndex = index;
            this.mobileActionIsFolder = false;
            this.showMobileActionModal = true;
        }, 500); // 500ms 长按触发
    },
    // 移动端长按结束/取消
    handleTouchEnd() {
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
    },
    // 文件夹长按开始
    handleFolderTouchStart(item, index) {
        this.longPressTimer = setTimeout(() => {
            this.mobileActionFile = item;
            this.mobileActionIndex = index;
            this.mobileActionIsFolder = true;
            this.showMobileActionModal = true;
        }, 500);
    },
    // 处理移动端操作
    handleMobileAction(action) {
        const file = this.mobileActionFile;
        const index = this.mobileActionIndex;
        this.showMobileActionModal = false;
        
        if (!file) return;
        
        switch (action) {
            case 'detail':
                this.openDetailDialog(index, file.name);
                break;
            case 'copy':
                this.handleCopy(index, file.name);
                break;
            case 'folderCopy':
                this.handleFolderCopy(file.name);
                break;
            case 'download':
                this.handleDownload(file.name);
                break;
            case 'move':
                this.handleMove(index, file.name);
                break;
            case 'delete':
                // v3.0.0（R8）：别人共享给我的（无论只读/编辑）一律不可删除 —— 前端拦截 + 后端同样守卫
                if (this.isSharedToMe(file)) {
                    this.$message.warning(this.$t('fileManager.sharedNoDeleteHint'));
                    break;
                }
                this.handleDelete(index, file.name);
                break;
            case 'tag':
                this.handleTagManagement(file.name);
                break;
            case 'select':
                // v3.0.0：进入多选并选中该文件
                this.selectSingleItem(file);
                break;
        }
    },

    /** v3.0.0：把某个文件/文件夹加入多选（移动端长按菜单「选择」） */
    selectSingleItem(file) {
        if (!file) return;
        // v3.0.0（R8）：只读共享条目不可选中（v1.0.2 起文件夹同样可选）
        if (this.isSharedReadonly(file)) {
            this.$message.warning(this.$t('fileManager.sharedReadonlyHint'));
            return;
        }
        file.selected = true;
        if (!this.selectedFiles.includes(file)) this.selectedFiles = [...this.selectedFiles, file];
    },
    // 获取标签颜色
    getTagColor(index) {
        const colors = [
            'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
            'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
            'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
            'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)'
        ];
        return colors[index % colors.length];
    },
    // 视频hover播放控制
    handleVideoHover(event, isEnter) {
        const video = event.target;
        if (isEnter) {
            video.play().catch(() => {});
        } else {
            video.pause();
            video.currentTime = 0;
        }
    },
    // 格式化文件大小
    formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '-';
        bytes = Number(bytes);
        if (isNaN(bytes)) return '-';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) {
            bytes /= 1024;
            i++;
        }
        return bytes.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
    },
    cancelSearchIconPress() {
        clearTimeout(this.searchIconPressTimer);
        this.searchIconPressTimer = null;
        this.searchIconPressStart = null;
    },
    handleSearchIconClick(event) {
        if (this.searchIconLongPressed) {
            event.preventDefault();
            return;
        }
        return this.handleSearch();
    },
    selectSearchResultDisplay(mode) {
        /*
         * v3.0.0（第三轮）：记住用户的「手动」选择 ——
         * 手动点回「展示文件夹」后，提交搜索/筛选时不再自动切走（除非他又手动选了「直接展开」）。
         */
        // v3.0.0：点切换按钮不再把焦点抢到搜索框（旧实现里有 searchInput.focus()）
        return this.setSearchResultDisplay(mode);
    },
    /**
     * v3.0.0（第三轮）：提交搜索 / 筛选时，若还停在「展示文件夹」模式，
     * 自动切到「直接展开文件」—— 搜索结果被折叠进文件夹里等于没搜到，用户还得再点一次。
     * v3.0.0：每次提交搜索/筛选都要执行一次切换（此前用户手动选回「展示文件夹」后
     * 会被 keepFoldersDisplay 兜住、只在第一次切换 —— 按需求移除该兜底）。
     * 这里只改值、不刷新：调用方紧接着就会 refreshFileList()。
     */
    autoExpandOnSubmit() {
        if (this.searchResultDisplay !== 'folders') return;
        this.searchResultDisplay = 'expanded';
    },
    setSearchResultDisplay(mode) {
        if (!SEARCH_RESULT_DISPLAYS.includes(mode) || mode === this.searchResultDisplay) return;
        this.searchResultDisplay = mode;
        /*
         * v3.0.0：不持久化 —— 刷新页面恒回到「展示文件夹」（默认值）；
         * 顺手清掉历史版本写入的同一个键，避免旧偏好残留。
         */
        try {
            localStorage.removeItem('searchResultDisplay');
        } catch (error) {
            /* 忽略存储异常 */
        }
        // 对「全部内容」生效：切换即重新加载（flat 参数由 recursiveSearchResults 带出）
        this.currentPage = 1;
        this.clearSelection();
        return this.refreshFileList();
    },
    /** 一键清空搜索框（按钮仅在搜索框有内容时显示） */
    handleClearSearch() {
        const hadAppliedSearch = Boolean(this.search);
        this.tempSearch = '';
        this.$nextTick(() => this.$refs.searchInput?.focus());
        if (hadAppliedSearch) {
            this.handleSearch();
        }
    },
    /** 跳转到「历史记录」页（新标签打开，不打断当前的文件管理操作） */
    goHistoryPage() {
        const url = this.$router.resolve({ name: 'history' }).href;
        window.open(url, '_blank', 'noopener');
    },
    /** 卡片左下角「打开链接」：新标签打开该文件的外链 */
    handleOpenLink(name) {
        const url = this.getFileLink(name);
        if (url) window.open(url, '_blank', 'noopener');
    },
    /** 搜索类型变化：立即按新类型重新检索 */
    handleSearchTypeChange() {
        this.handleSearch();
    },
    /** 上传用户筛选变化（仅管理员） */
    handleUserFilterChange() {
        this.currentPage = 1;
        this.refreshFileList();
    },
    /** 拉取用户下拉选项（仅管理员） */
    async fetchUserOptions() {
        if (!this.isAdminRole) return;
        try {
            const res = await fetchWithAuth('/api/manage/users/options', { method: 'GET' });
            if (!res.ok) return;
            const list = await res.json();
            this.userOptions = Array.isArray(list) ? list : [];
        } catch {
            this.userOptions = [];
        }
    },
    /** 新建逻辑目录（记录在当前账户下） */
    async handleCreateFolder() {
        let name;
        try {
            const r = await this.$prompt(this.$t('dashboard.newFolderPrompt'), this.$t('dashboard.newFolder'), {
                confirmButtonText: this.$t('common.confirm'),
                cancelButtonText: this.$t('common.cancel'),
                inputPlaceholder: this.$t('dashboard.newFolderPlaceholder'),
                inputValidator: (v) => {
                    const t = String(v || '').trim();
                    if (!t) return this.$t('dashboard.newFolderRequired');
                    if (/[\\/:*?"<>|]/.test(t)) return this.$t('dashboard.newFolderInvalid');
                    return true;
                },
            });
            name = r.value.trim();
        } catch {
            return;
        }
        const path = [this.currentPath, name].filter(Boolean).join('/');
        try {
            // 后端契约为 { dir, name }（dir = 当前所在目录，name = 新目录名）
            const res = await axios.post('/api/manage/folder', { dir: this.currentPath, name, path, instanceId: String(this.instanceId || '') }, { withCredentials: true });
            if (res.data?.success) {
                this.$message.success(this.$t('common.success'));
                await this.refreshFileList();
            } else {
                this.$message.error(res.data?.message || this.$t('common.failed'));
            }
        } catch (e) {
            this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
        }
    },
    /**
     * v3.0.0：回车提交搜索 —— 立即执行一次查询，不等输入防抖 / 不依赖失焦。
     * 中文输入法组词中的回车（确认候选词）不触发搜索。
     */
    handleSearchEnter(e) {
        /*
         * v3.0.0（第三轮）修「移动端回车提交不生效」：
         *   ① 移动端部分输入法只发 keydown、不发 keyup（或反之）→ 模板里 keydown / keyup 都挂上；
         *   ② searchComposing 是 compositionstart 打的标记，移动端输入法常漏发 compositionend，
         *      标记会一直为 true，回车被永久吞掉 → 改看原生事件自带的 isComposing（及 keyCode 229），
         *      组词中才略过，并顺手把标记复位；
         *   ③ keydown + keyup 会各触发一次 → 同一内容极短时间内只提交一次。
         */
        const composing =
            (e && (e.isComposing === true || e.keyCode === 229)) || (this.searchComposing && !e);
        if (composing) return;
        this.searchComposing = false;
        const now = Date.now();
        if (this.lastSearchSubmitAt && now - this.lastSearchSubmitAt < 250) return;
        this.lastSearchSubmitAt = now;
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = null;
        this.handleSearch();
    },
    handleSearch() {
        this.search = this.tempSearch;
        this.isSearchMode = this.search.trim() !== '';
        this.currentPage = 1; // 重置到第一页
        // v3.0.0（第三轮）：提交搜索时若还在「展示文件夹」，自动改「直接展开文件」
        this.autoExpandOnSubmit();

        // 解析搜索字符串，提取标签和关键字
        // 支持 #tag 表示包含标签，-#tag 表示排除标签
        if (this.search && this.search.trim()) {
            const includeTags = [];
            const excludeTags = [];
            
            // 匹配 -#tag 和 #tag
            let searchText = this.search;
            
            // 先匹配排除标签 -#tag
            const excludeTagRegex = /-#([\w\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\.\+\-]+)/g;
            searchText = searchText.replace(excludeTagRegex, (match, tag) => {
                excludeTags.push(tag.toLowerCase());
                return ' ';
            });
            
            // 再匹配包含标签 #tag
            const includeTagRegex = /#([\w\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\.\+\-]+)/g;
            searchText = searchText.replace(includeTagRegex, (match, tag) => {
                includeTags.push(tag.toLowerCase());
                return ' ';
            });
            
            // 清理剩余的关键字（去除多余空格）
            this.searchKeywords = searchText.replace(/\s+/g, ' ').trim();
            
            // 构建标签查询字符串
            this.searchIncludeTags = includeTags.join(',');
            this.searchExcludeTags = excludeTags.join(',');
            
            console.log('Search keywords:', this.searchKeywords);
            console.log('Include tags:', this.searchIncludeTags);
            console.log('Exclude tags:', this.searchExcludeTags);
        } else {
            this.searchKeywords = '';
            this.searchIncludeTags = '';
            this.searchExcludeTags = '';
        }

        this.refreshFileList();
    },
    // 处理筛选变化（来自 FilterDialog 组件）
    async handleFilterChange({ type, filters }) {
        this.filters = filters;
        /*
         * v2.9.0：「常规 → 访问状态」里的「已删除」= 看回收站文件。
         * 勾选后自动切到回收站视图（恢复 / 彻底删除等操作都在那边），
         * 取消勾选则退回普通列表；其它筛选条件在两种视图里同样生效。
         */
        const wantTrash = Array.isArray(filters?.accessStatus) && filters.accessStatus.includes('deleted');
        this.currentPage = 1;
        if (wantTrash) {
            // 已经在回收站里就只重载数据，避免把回收站数据误存成「普通列表备份」
            await this.enterTrashMode(this.trashMode);
            return;
        }
        // v3.0.0（第三轮）：提交筛选时若还在「展示文件夹」，自动改「直接展开文件」
        // （回收站分支不走这里：回收站保持原有展示方式，不被顺手改掉）
        this.autoExpandOnSubmit();
        if (this.trashMode) {
            this.trashMode = false;
            this.tableData = this.normalTableData;
        }
        this.refreshFileList();
    },
    // 清除所有筛选条件（v3.0.0：统一走 createEmptyFilters，tagMode/matchMode 默认 and）
    clearFilters() {
        this.filters = createEmptyFilters();
        this.tagDraft = [];
        this.tagModeDraft = 'and';
        this.currentPage = 1;
        this.refreshFileList();
    },
    /**
     * v3.0.0（R7）：数量统计徽章 = 一键复位。
     * 清空「搜索关键词 / 标签搜索（含 #标签、-标签）/ 搜索类型 / 用户筛选 / 筛选弹窗全部条件」
     * 并回到第一页重新加载；当前目录、视图模式、排序不属于「筛选条件」，保持不变。
     */
    async resetAllQueryConditions() {
        this.tempSearch = '';
        this.search = '';
        this.searchKeywords = '';
        this.searchIncludeTags = '';
        this.searchExcludeTags = '';
        this.searchType = 'all';
        this.isSearchMode = false;
        this.mobileSearchOpen = false;
        this.userFilter = 'all';
        this.filters = createEmptyFilters();
        this.tagDraft = [];
        this.tagModeDraft = 'and';
        this.currentPage = 1;
        if (this.trashMode) {
            // 回收站视图下同样复位条件并重载回收站列表
            await this.enterTrashMode(true);
            return;
        }
        await this.refreshFileList();
        this.$message?.success(this.$t('dashboard.statsBadgeResetDone'));
    },
    /* ---------------- 标签筛选弹窗 ---------------- */
    openTagFilterDialog() {
        this.tagDraft = [...(this.filters.tagNames || [])];
        this.tagModeDraft = this.filters.tagMode === 'or' ? 'or' : 'and';
        this.showTagFilterDialog = true;
        this.loadAllTags();
    },
    async loadAllTags() {
        this.tagFilterLoading = true;
        try {
            /*
             * v3.0.0：标签候选按实例取（/api/tags/manage 带 instanceId）——
             * 返回 { success, data:[{ id, name, count, encrypted, createdAt }] }；
             * 旧接口 /api/manage/tags/all 不分实例，仅作为兜底。
             */
            let list = [];
            const res = await fetchWithAuth(`/api/tags/manage?instanceId=${encodeURIComponent(this.instanceId || '')}&sort=createdAt&order=desc`);
            const json = await res.json().catch(() => ({}));
            if (Array.isArray(json?.data)) {
                list = json.data.map((t) => ({ name: t.name, count: Number(t.count) || 0, createdAt: t.createdAt }));
            } else {
                // v1.0.0：兜底接口也要带实例（否则会把其它实例的标签一并列出来）
                const fallback = await fetchWithAuth(`/api/manage/tags/all?instanceId=${encodeURIComponent(this.instanceId || '')}`);
                const fj = await fallback.json().catch(() => ({}));
                list = Array.isArray(fj?.tags) ? fj.tags : [];
            }
            /*
             * v2.9.0：筛选弹窗「标签」页默认展示「最近创建的前 30 个」（倒序），
             * 所以这里按 createdAt 倒序；没有 createdAt 的老数据排在后面按名称排。
             */
            this.allTags = list
                .filter((t) => Number(t.count) > 0)
                .sort((a, b) => {
                    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    if (ta !== tb) return tb - ta;
                    return String(a.name).localeCompare(String(b.name));
                });
        } catch (e) {
            this.allTags = [];
        } finally {
            this.tagFilterLoading = false;
        }
    },
    toggleTagDraft(name) {
        const i = this.tagDraft.indexOf(name);
        if (i === -1) this.tagDraft.push(name);
        else this.tagDraft.splice(i, 1);
    },
    clearTagFilter() {
        this.tagDraft = [];
    },
    applyTagFilter() {
        this.filters = {
            ...this.filters,
            tagNames: [...this.tagDraft],
            tagMode: this.tagModeDraft
        };
        this.showTagFilterDialog = false;
        this.currentPage = 1;
        this.refreshFileList();
    },
    // 从 API 获取所有渠道名称
    async extractChannelNames() {        try {
            const response = await fetchWithAuth('/api/channels?includeDisabled=true', {
                method: 'GET'
            });

            if (response.ok) {
                const channels = await response.json();
                const channelOptions = [];

                // 类型映射（显示名称）—— 与 channel-schema 的 CHANNEL_TYPES 保持一致
                const typeLabels = {};
                for (const t of CHANNEL_TYPES) typeLabels[t.value] = t.label;

                // 按类型提取渠道名称，channel.type是类型内部存储名称，value 为类型标识
                Object.entries(channels).forEach(([type, channelList]) => {
                    // v3.0.0（R9）：「本地文件」渠道不参与上传，渠道名称筛选里同样不出现
                    if (type === 'localfiles') return;
                    if (Array.isArray(channelList) && channelList.length > 0) {
                        channelList.forEach(channel => {
                            if (channel.name) {
                                channelOptions.push({
                                    name: channel.name,
                                    type: channel.type,
                                    // 排序依据：渠道类型编号 + 渠道 ID（与后端 / 其他下拉完全一致）
                                    typeCode: Number(channel.typeCode) || channelTypeCode(channel.type),
                                    code: channel.code || '',
                                    typeLabel: typeLabels[type] || type,
                                    // 使用 channel.type:channel.name 作为唯一标识
                                    value: `${channel.type}:${channel.name}`,
                                });
                            }
                        });
                    }
                });

                // 统一排序：类型编号升序 → name a→z
                channelOptions.sort((a, b) => {
                    if (a.typeCode !== b.typeCode) return a.typeCode - b.typeCode;
                    return String(a.name).localeCompare(String(b.name));
                });

                this.channelNameOptions = channelOptions;
            }
        } catch (error) {
            console.error('Failed to fetch channel names:', error);
        }
    },
    handleDownload(key, metadata) {
        const meta = metadata || this.tableData.find(file => file.name === key)?.metadata;
        const link = document.createElement('a');
        link.href = this.getFileLink(key, meta);
        // v3.0.0（R16）：下载文件名用「文件原名」（metadata.FileName = originalName），
        // 没有原名时回退显示名；同源下载浏览器会采纳该名称。
        const originalName = String(meta?.FileName || '').trim();
        link.download = originalName || key;
        link.click();
    },
    /** 取文件扩展名（优先 metadata.FileExt，其次从显示文件名推断）—— 统一走 utils/fileDetail */
    fileExt(fileOrMetadata) {
        return fileExtOfUtil(fileOrMetadata);
    },
    /**
     * 在链接末尾补上扩展名 —— 仅用于直观展示文件类型（已有扩展名则原样返回）。
     * 统一走 utils/fileDetail。
     */
    withExt(url, ext) {
        return withExtUtil(url, ext);
    },
    openDetailDialog(index, key) {
        const target = this.paginatedTableData[index];
        // v3.0.0（R14）：回收站里的「文件夹条目」没有文件详情，点击不打开详情弹窗
        if (target && target.isFolder) return;
        this.detailFile = target;
        this.showdetailDialog = true;
    },
    handleTabClick(tab) {
        this.activeUrlTab = tab.props.name;
    },
    async handleUrlClick(event) {
        // 复制到剪贴板（兼容 http / 老旧浏览器）
        const ok = await copyText(event.target.value);
        this.$message({
            type: ok ? 'success' : 'error',
            message: this.$t(ok ? 'dashboard.copySuccess' : 'dashboard.copyFailed')
        });
    },
    handleDetailDelete(key) {
        // 回收站模式：详情页「删除」按钮已切换为「恢复」，这里兜底走恢复
        if (this.trashMode) {
            const item = this.tableData.find(file => file.name === key);
            if (item) this.trashRestoreItems([item]);
            return;
        }
        this.confirmDeleteByWord('dashboard.deleteConfirm').then(() => {
        fetchWithAuth(`/api/manage/delete/${key}?instanceId=${encodeURIComponent(this.instanceId || '')}`, { method: 'GET' })
            .then(response => {
            if (response.ok) {
                const fileIndex = this.tableData.findIndex(file => file.name === key);
                if (fileIndex !== -1) {
                this.tableData.splice(fileIndex, 1);
                // v3.0.0：窗口内少了一条，同步计数（「加载更多」剩余量据此计算）
                this.fileWindowCount = Math.max(0, this.fileWindowCount - 1);
                }
            } else {
                return Promise.reject('Request failed');
            }
            })
            .then(() => {
            this.updateStats(-1, false);
            this.$message.success(this.$t('dashboard.deleteSuccess'));
            this.showdetailDialog = false;
            })
            .catch(() => this.$message.error(this.$t('dashboard.deleteFailed')));
        }).catch(() => console.log('Delete cancelled'));
    },
    /** 详情弹窗里的回收站操作（恢复 / 彻底删除） */
    handleDetailTrash(action, file) {
        if (!file) return;
        if (action === 'restore') {
            this.trashRestoreItems([file]);
        } else {
            this.trashPurgeItems([file]);
        }
    },
    /**
     * v2.6.0 #303：黑名单 toggle ——
     * 未在黑名单 → 确认后加入（Block）；已在黑名单 → 直接移出（恢复 None）。
     */
    handleBlock(key) {
        const current = String(this.detailFile?.metadata?.ListType || 'None');
        if (current === 'Block') {
            this.patchListType(key, 'None', 'blockRemoved', 'blockFailed', 'Block');
            return;
        }
        this.$confirm(this.$t('dashboard.blockConfirm'), this.$t('dashboard.deleteConfirmTitle'), {
            confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
            cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
            type: 'warning'
        }).then(() => {
            this.patchListType(key, 'Block', 'blockSuccess', 'blockFailed');
        }).catch(
            () => console.log('Block cancelled')
        );
    },
    /** v2.6.0 #303：白名单 toggle（同黑名单） */
    handleWhite(key) {
        const current = String(this.detailFile?.metadata?.ListType || 'None');
        if (current === 'White') {
            this.patchListType(key, 'None', 'whiteRemoved', 'whiteFailed', 'White');
            return;
        }
        this.$confirm(this.$t('dashboard.whiteConfirm'), this.$t('dashboard.deleteConfirmTitle'), {
            confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
            cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
            type: 'warning'
        }).then(() => {
            this.patchListType(key, 'White', 'whiteSuccess', 'whiteFailed');
        }).catch(
            () => console.log('White cancelled')
        );
    },
    /**
     * ListType 统一落地：PATCH 元数据 + 同步表格行/详情弹窗状态。
     * prevListType：移出时传被移出的名单（从该名单计数减一），加入时不传。
     */
    patchListType(key, value, successKey, failedKey, prevListType) {
        fetchWithAuth(`/api/manage/metadata/${encodeURIComponent(key)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ListType: value })
        })
            .then(response => {
                if (response.ok) {
                    const fileIndex = this.tableData.findIndex(file => file.name === key);
                    if (fileIndex !== -1) {
                        this.tableData[fileIndex].metadata.ListType = value;
                    }
                    // 详情弹窗里的文件对象同步刷新（按钮 toggle 文案 / 访问状态标签）
                    if (this.detailFile?.name === key) {
                        this.detailFile = { ...this.detailFile, metadata: { ...this.detailFile.metadata, ListType: value } };
                    }
                } else {
                    return Promise.reject('Request failed');
                }
            })
            .then(() => {
                this.$message.success(this.$t(`dashboard.${successKey}`));
                if (prevListType) this.refreshListTypeCount(prevListType, -1);
                else this.refreshListTypeCount(value, 1);
            })
            .catch(() => this.$message.error(this.$t(`dashboard.${failedKey}`)));
    },
    /** 黑白名单侧边统计计数增减（存在该计数字段时） */
    refreshListTypeCount(type, delta) {
        const key = type === 'Block' ? 'blockCount' : 'whiteCount';
        if (this[key] !== undefined && typeof this[key] === 'number') {
            this[key] = Math.max(0, this[key] + delta);
        }
    },
    /**
     * 打开登记文件弹窗（v2.9.0）
     * 把当前所在目录快照进 recordInitialFolder，弹窗会把它填到「文件分类」；
     * 在根目录时传空串，弹窗留空 → 后端落「登记文件/年/月」。
     */
    openRecordDialog() {
        // 去掉结尾斜杠：/2026/ → 2026，避免后端把空段当成路径层级
        this.recordInitialFolder = String(this.currentPath || '').replace(/^\/+|\/+$/g, '');
        this.showRecordDialog = true;
    },
    /**
     * 登记文件成功回调（v2.8.8）
     * 关弹窗 + 提示 + 刷新当前目录列表（新记录会立即出现在文件列表里）。
     */
    handleRecorded() {
        // 成功提示由 RecordFileDialog 自己弹（带文件名与大小），这里只负责收尾
        this.showRecordDialog = false;
        if (typeof this.handleRefreshFiles === 'function') this.handleRefreshFiles();
    },

    // ==================== 回收站 ====================
    /** 进入 / 退出回收站模式 */
    /** v2.8.7：切换全局视频静音（预览浮层 + 文件详情页视频共用这一个开关） */
    toggleVideoMuted() {
        this.$store.commit('setGlobalVideoMuted', !this.globalVideoMuted);
        this.$message({
            type: 'success',
            message: this.globalVideoMuted ? this.$t('dashboard.videoMutedOn') : this.$t('dashboard.videoMutedOff')
        });
    },

    async toggleTrashMode() {
        if (this.trashLoading) return;
        if (this.trashMode) {
            // 退出：还原普通文件列表
            this.clearSelection();
            this.tableData = this.normalTableData;
            this.showdetailDialog = false;
            this.trashMode = false;
            // v1.0.3：退出回收站时回到回收站根目录，下次进入不会停在深层目录
            this.trashPath = '';
            this.trashParent = '';
            /*
             * v3.0.0（R12）：回收站改服务端分页（每页 48）后会改写 listTotal / 窗口状态，
             * 退出时必须把普通列表的分页状态还原，否则页码/总数会沿用回收站的数字。
             */
            const st = this.normalListState;
            if (st) {
                this.listTotal = st.listTotal;
                this.fileWindowStart = st.fileWindowStart;
                this.fileWindowCount = st.fileWindowCount;
                this.currentPage = st.currentPage;
                this.normalListState = null;
            }
            // v2.9.0：手动退出回收站时同步取消筛选里的「已删除」，否则角标与实际视图不一致
            if (Array.isArray(this.filters?.accessStatus) && this.filters.accessStatus.includes('deleted')) {
                this.filters = {
                    ...this.filters,
                    accessStatus: this.filters.accessStatus.filter((v) => v !== 'deleted')
                };
            }
            return;
        }
        await this.enterTrashMode();
    },
    async enterTrashMode(preserveNormal = false, page = 1, append = false) {
        this.trashLoading = true;
        try {
            // v2.8.7：回收站同样带上搜索 / 筛选 / 日期 / 大小等条件（后端联合过滤）
            const fm = (await import('@/utils/fileManager')).fileManager;
            const filterParams = fm.buildFilterParams(this.filters) + fm.buildExtraParams(this.searchType, this.userFilter);
            const searchQ = this.searchKeywords ? `&search=${encodeURIComponent(this.searchKeywords)}` : '';
            // v3.0.0：回收站同样按当前实例隔离
            const instanceQ = `&instanceId=${encodeURIComponent(this.instanceId || '')}`;
            /*
             * v3.0.0（R12）：回收站改「服务端分页 + 每页 48 条」（需求 42）。
             * 以前是整表返回，条目多时首屏明显卡；现在 page/pageSize 交给后端切片。
             */
            const pageQ = `&page=${Math.max(1, Number(page) || 1)}&pageSize=${TRASH_PAGE_SIZE}`;
            /*
             * v1.0.3：回收站按目录层级浏览 —— 带上当前所在目录（空串 = 根）。
             * 后端只返回该层的子目录 + 直接子文件，进入子目录后文件才可见。
             */
            const dirQ = `&dir=${encodeURIComponent(this.trashPath || '')}`;
            const resp = await fetchWithAuth(
                `/api/manage/trash?1=1${filterParams}${searchQ}${instanceQ}${pageQ}${dirQ}`
            );
            if (!resp.ok) throw new Error('Request failed');
            const data = await resp.json();
            this.trashParent = String(data.parent || '');
            // 备份普通列表，切换渲染数据（v2.9.0：回收站内刷新时不要覆盖这份备份）
            if (!preserveNormal) {
                this.normalTableData = this.tableData;
                // v3.0.0（R12）：连分页状态一起备份，退出回收站时还原
                this.normalListState = {
                    listTotal: this.listTotal,
                    fileWindowStart: this.fileWindowStart,
                    fileWindowCount: this.fileWindowCount,
                    currentPage: this.currentPage
                };
            }
            if (!append) this.clearSelection();
            const items = Array.isArray(data.items) ? data.items : [];
            const rows = items.map((it) => this.convertTrashItem(it));
            const total = Number(data.total ?? rows.length) || 0;
            const start = (Math.max(1, Number(page) || 1) - 1) * TRASH_PAGE_SIZE;
            if (append) {
                this.tableData = [...this.tableData, ...rows];
                this.fileWindowCount += rows.length;
            } else {
                this.tableData = rows;
                this.fileWindowStart = start;
                this.fileWindowCount = rows.length;
                this.currentPage = Math.max(1, Number(page) || 1);
            }
            this.trashTotal = total;
            this.listTotal = total;
            this.updateStats(total, true);
            this.trashMode = true;
            if (total === 0) {
                this.$message.info(this.$t('dashboard.trashEmpty'));
            }
        } catch (e) {
            this.$message.error(this.$t('dashboard.trashLoadFailed'));
        } finally {
            this.trashLoading = false;
        }
    },
    /**
     * v1.0.3：进入回收站内的子目录（只显示这一层的子目录与文件）。
     * 目录树在回收站里由「已删目录登记 + 文件原路径」共同反推，所以任何一层都能进。
     */
    async enterTrashDir(path) {
        const next = String(path || '').replace(/^\/+|\/+$/g, '');
        if (next === this.trashPath) return;
        this.trashPath = next;
        await this.enterTrashMode(true, 1, false);
    },
    /** 回收站里「返回上一级」 */
    async leaveTrashDir() {
        if (!this.trashPath) return;
        await this.enterTrashDir(String(this.trashParent || ''));
    },
    /** 统一的「进入目录」入口：普通模式进当前浏览目录，回收站模式进回收站目录 */
    enterFolderItem(item) {
        if (this.trashMode) {
            this.enterTrashDir(item?.trashPath || item?.name || '');
            return;
        }
        this.enterFolder(item?.name);
    },
    /** 把回收站接口的条目转成卡片/列表渲染需要的结构 */
    convertTrashItem(it) {
        const primary = (it.channels || []).find(c => c.isPrimary) || (it.channels || [])[0] || {};
        const deletedAtText = it.deletedAt ? new Date(it.deletedAt).toLocaleString() : '';
        return {
            name: it.name,
            // v3.0.0（R14）：后端会把「已删除的文件夹」作为 isFolder 条目混排进回收站，这里原样透传
            isFolder: !!it.isFolder,
            /*
             * v1.0.3：回收站内的目录路径（id 形如 folder:<路径>）。
             * 点击文件夹卡片就是进入这一层，看它里面删掉的内容。
             */
            trashPath: it.isFolder ? String(it.trashPath || String(it.id || '').replace(/^folder:/, '')) : '',
            selected: false,
            trashId: it.id,
            // 详情页「文件状态」据此显示「已删除」
            status: it.status || 'deleted',
            metadata: {
                FileName: it.originalName || it.name,
                RawName: it.name,
                // 卡片/列表视图判断视频/图片靠 FileType（回收站条目没有扩展名后缀）
                FileType: it.isFolder ? 'folder' : (it.mime || ''),
                FileExt: (String(it.originalName || '').split('.').pop() || '').toLowerCase(),
                FileSizeBytes: Number(it.size) || 0,
                TimeStamp: it.deletedAt || '',
                UploadUser: it.uploader || '',
                UploadSource: it.uploadSource || 'Default',
                Channel: primary.name || '',
                ChannelShort: primary.name || '',
                MimeType: it.mime || '',
                Status: it.status || 'deleted',
                Tags: [],
                TrashDeletedAt: deletedAtText,
                TrashChannels: (it.channels || []).map(c => c.name).filter(Boolean)
            }
        };
    },
    /**
     * 批量恢复 / 批量彻底删除（回收站模式）。
     * v3.0.0（R14）：返回完整 data —— 开启 2FA 时后端回 `{ success:false, needTotp:true }`，
     * 需要带着 totpCode 再请求一次（此前只取 results，2FA 拦截会被当成「成功 0 条」）。
     */
    async trashBatchRequest(items, action, totpCode = '') {
        const ids = items.map(it => it.trashId).filter(Boolean);
        if (ids.length === 0) return { results: [] };
        const resp = await fetchWithAuth('/api/manage/trash/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, action, totpCode })
        });
        if (!resp.ok) throw new Error('Request failed');
        const data = await resp.json();
        return {
            results: Array.isArray(data.results) ? data.results : [],
            needTotp: !!data.needTotp,
            message: data.message || '',
        };
    },
    /**
     * v3.0.0（R14）：两步验证动态码输入框（回收站彻底删除专用）。
     * 未开启 2FA 的账户不会走到这里（后端直接放行），交互与「输入确认删除」保持一致。
     */
    askTrashTotp(message) {
        return this.$prompt(message || this.$t('dashboard.trashTotpPrompt'), this.$t('dashboard.trashTotpTitle'), {
            confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
            cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
            inputPattern: /^\s*\d{6,8}\s*$/,
            inputErrorMessage: this.$t('dashboard.trashTotpInvalid'),
            inputPlaceholder: this.$t('dashboard.trashTotpPlaceholder'),
            type: 'warning'
        });
    },
    /** 恢复（撤销软删除标记，文件回到普通列表） */
    trashRestoreItems(items) {
        if (!items.length) return;
        this.$confirm(
            this.$t('dashboard.trashRestoreConfirm', { count: items.length }),
            this.$t('dashboard.trashTitle'),
            { confirmButtonText: this.$t('dashboard.trashRestore'), cancelButtonText: this.$t('dashboard.deleteConfirmCancel'), type: 'info' }
        ).then(async () => {
            // v3.0.0（R12，需求 43）：恢复期间同样显示转圈（回收站条目用 trashId 作 key）
            const keys = items.map((it) => it.trashId || it.name);
            this.setDeleting(keys, true);
            this.trashBusy = true;
            try {
                await this.trashBatchRequest(items, 'restore');
                this.removeTrashItems(items);
                this.$message.success(this.$t('dashboard.trashRestoreSuccess'));
            } catch (e) {
                this.$message.error(this.$t('dashboard.trashRestoreFailed'));
            } finally {
                this.setDeleting(keys, false);
                this.trashBusy = false;
            }
        }).catch(() => {});
    },
    /** 彻底删除（连远端副本一起清理，不可恢复）
     *  v3.0.0（R16）：验证方式二选一 ——
     *    开启两步验证 → 只输入 2FA 动态码（不再要求「确认删除」）；
     *    未开启 2FA   → 仍然手动输入「确认删除」防误删。 */
    trashPurgeItems(items) {
        if (!items.length) return;
        if (this.accountTotpEnabled) {
            this.runTrashPurge(items);
            return;
        }
        this.confirmDeleteByWord('dashboard.trashPurgeConfirm')
            .then(() => this.runTrashPurge(items))
            .catch(() => {});
    },
    /**
     * v3.0.0（R14）：彻底删除执行体 —— 开启 2FA 的账户先要求输入动态验证码，
     * 校验通过后再删除；验证码错误会再次弹窗允许重试，取消则放弃（什么都不删）。
     */
    async runTrashPurge(items, totpCode = '') {
        if (!items.length) return;
        const keys = items.map((it) => it.trashId || it.name);
        this.setDeleting(keys, true);
        this.trashBusy = true;
        /*
         * v1.0.2：除了卡片上的转圈遮罩，再叠一层全屏 loading ——
         * 用户反馈「回收站删除时看不到正在删除的提示」：单条删除的请求很快，
         * 卡片遮罩一闪而过等于没有；全屏遮罩能给出确定反馈，也顺便挡住重复点击。
         */
        const loading = this.$loading({ lock: true, text: this.$t('dashboard.deletingHint') });
        let loadingClosed = false;
        const closeLoading = () => {
            if (loadingClosed) return;
            loadingClosed = true;
            try { loading.close(); } catch { /* 已关闭 */ }
        };
        try {
            const data = await this.trashBatchRequest(items, 'purge', totpCode);
            if (data.needTotp) {
                closeLoading();
                this.setDeleting(keys, false);
                this.trashBusy = false;
                let code = '';
                try {
                    const r = await this.askTrashTotp(data.message);
                    code = String(r?.value || '').trim();
                } catch (e) {
                    return;
                }
                return this.runTrashPurge(items, code);
            }
            this.removeTrashItems(items);
            this.$message.success(this.$t('dashboard.trashPurgeSuccess'));
        } catch (e) {
            this.$message.error(this.$t('dashboard.trashPurgeFailed'));
        } finally {
            closeLoading();
            this.setDeleting(keys, false);
            this.trashBusy = false;
        }
    },
    /** 从回收站视图移除已处理的条目 */
    removeTrashItems(items) {
        const ids = new Set(items.map((it) => it.trashId).filter(Boolean));
        const names = new Set(items.map((it) => it.name));
        this.tableData = this.tableData.filter((f) => !(f.trashId && ids.has(f.trashId)) && !names.has(f.name));
        this.selectedFiles = [];
        /*
         * v3.0.0（R12）：回收站改服务端分页后，本地删完要按剩余总数补拉当前页
         * （否则当前页会「缺几条」，翻页时页码与后端切片对不上）。
         * 当前页被删空且不是第一页 → 回退一页。
         */
        this.trashTotal = Math.max(0, this.trashTotal - items.length);
        this.listTotal = this.trashTotal;
        this.fileWindowCount = Math.max(0, this.fileWindowCount - items.length);
        if (this.detailFile && names.has(this.detailFile.name)) {
            this.showdetailDialog = false;
            this.detailFile = null;
        }
        if (this.trashTotal === 0) {
            this.tableData = [];
            this.fileWindowStart = 0;
            this.fileWindowCount = 0;
            this.currentPage = 1;
            this.updateStats(0, true);
            return;
        }
        const maxPage = Math.max(1, Math.ceil(this.trashTotal / TRASH_PAGE_SIZE));
        this.enterTrashMode(true, Math.min(this.currentPage, maxPage));
    },
    /**
     * 危险操作确认框：必须手动输入「确认删除」才能继续（防误删）。
     * 返回 Promise，输入匹配时 resolve。
     */
    confirmDeleteByWord(messageKey = 'dashboard.deleteConfirmPrompt') {
        const word = this.$t('dashboard.deleteConfirmWord');
        const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return this.$prompt(this.$t(messageKey), this.$t('dashboard.deleteConfirmTitle'), {
            confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
            cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
            inputPattern: new RegExp(`^\\s*${escaped}\\s*$`),
            inputErrorMessage: this.$t('dashboard.deleteConfirmInputError'),
            inputPlaceholder: this.$t('dashboard.deleteConfirmPlaceholder'),
            type: 'warning'
        });
    },
    handleDelete(index, key) {
        // 回收站模式下卡片上的「删除」= 恢复该文件
        if (this.trashMode) {
            const item = this.tableData.find(file => file.name === key);
            if (item) this.trashRestoreItems([item]);
            return;
        }
        // v3.0.0（R8）：别人共享给我的（无论只读/编辑）一律不可删除
        const delTarget = this.tableData.find(file => file.name === key);
        if (delTarget && this.isSharedToMe(delTarget)) {
            this.$message.warning(this.$t('fileManager.sharedNoDeleteHint'));
            return;
        }
        // 判断是否为文件夹
        const isFolder = this.tableData.find(file => file.name === key).isFolder;

        this.confirmDeleteByWord(isFolder ? 'dashboard.deleteFolderConfirm' : 'dashboard.deleteFileConfirm').then(async () => {
        /*
         * v3.0.0（R12，需求 43）：删除期间该条目显示转圈遮罩（正在删除…），
         * 避免点了没反应又重复点击；请求结束后无论成败都撤掉遮罩。
         */
        this.setDeleting([key], true);
        try {
            // v1.0.2：目录路径按段编码，避免名字里带 # / ? / 空格时 URL 被截断导致「删除没反应」
            const encKey = String(key).split('/').map(encodeURIComponent).join('/');
            const response = await fetchWithAuth(`/api/manage/delete/${encKey}?folder=${isFolder}&instanceId=${encodeURIComponent(this.instanceId || '')}`, { method: 'GET' });
            const body = await response.json().catch(() => ({}));
            // 目录删除返回 { success:true, deleted:0 }（空目录）也算成功
            if (!response.ok || body?.success === false) throw new Error(body?.message || 'failed');
            const fileIndex = this.tableData.findIndex(file => file.name === key);
            if (fileIndex !== -1) this.tableData.splice(fileIndex, 1);
            this.updateStats(-1, false);
            fileManager.removeFile(key);
            this.$message.success(this.$t('dashboard.deleteSuccess'));
        } catch (err) {
            this.$message.error(err?.message && err.message !== 'failed' ? err.message : this.$t('dashboard.deleteFailed'));
        } finally {
            this.setDeleting([key], false);
        }
        }).catch(() => console.log('Delete cancelled'));
    },
    /** v3.0.0（R12）：标记 / 取消「正在删除」的条目（卡片与列表行据此显示转圈） */
    setDeleting(keys, on) {
        const list = Array.isArray(keys) ? keys.filter(Boolean) : [keys].filter(Boolean);
        if (!list.length) return;
        const set = new Set(this.deletingKeys);
        list.forEach((k) => (on ? set.add(k) : set.delete(k)));
        this.deletingKeys = Array.from(set);
    },
    isDeleting(item) {
        if (!item) return false;
        return this.deletingKeys.includes(item.trashId || item.name);
    },
    handleBatchDelete() {
        // 回收站模式：批量操作走「彻底删除」（需输入确认删除）
        if (this.trashMode) {
            this.trashPurgeItems(this.selectedFiles);
            return;
        }
        /*
         * v3.0.0（R9）：别人共享给我的目录（只读或编辑）→ 批量禁止删除
         * （只读条目本就不可选中，这里兜底拦截编辑权限共享 + 与详情页口径一致）。
         */
        if (!this.isAdminRole && this.selectedFiles.some(file => this.isSharedToMe(file))) {
            this.$message.warning(this.$t('fileManager.sharedNoDeleteHint'));
            return;
        }
        this.confirmDeleteByWord('dashboard.batchDeleteConfirm').then(async () => {
        /*
         * v3.0.0（R12）：批量删除改成「逐条解析响应」——
         * 原来只要 HTTP 200 就算成功，后端返回 {success:false} 或 deleted=0 时
         * （典型：目录里全是别人上传的文件 / 共享目录）前端仍把条目从列表里删掉，
         * 刷新后目录又冒出来，看起来就是「选中文件夹删除不成功」。
         */
        const targets = [...this.selectedFiles];
        let successNum = 0;
        const errors = [];
        // v3.0.0（R12，需求 43）：批量删除期间逐条显示转圈遮罩
        this.setDeleting(targets.map((f) => f.name), true);
        try {
        for (const file of targets) {
            try {
                const resp = await fetchWithAuth(
                    `/api/manage/delete/${file.name}?folder=${file.isFolder ? 'true' : 'false'}&instanceId=${encodeURIComponent(this.instanceId || '')}`,
                    { method: 'GET' }
                );
                const body = await resp.json().catch(() => ({}));
                /*
                 * v3.0.0（R12）：目录删除的成功判定不能只看 deleted ——
                 * 「新建目录」登记的空目录一条文件记录都没有，后端返回 deleted:0，
                 * 旧逻辑当成失败 → 选中文件夹批量删除永远提示失败（需求 45）。
                 * 现在：目录只要 success !== false 就算删掉；文件仍要求 deleted > 0。
                 */
                const okByBody = resp.ok && body?.success !== false;
                const deleted = Number(body?.deleted ?? 0);
                const isOk = okByBody && (file.isFolder || deleted > 0);
                if (isOk) {
                    successNum += 1;
                    const fileIndex = this.tableData.findIndex((f) => f.name === file.name);
                    if (fileIndex !== -1) this.tableData.splice(fileIndex, 1);
                    fileManager.removeFile(file.name);
                } else {
                    errors.push({ name: file.name, message: body?.message || '' });
                }
            } catch (e) {
                errors.push({ name: file.name, message: '' });
            }
        }
        } finally {
            this.setDeleting(targets.map((f) => f.name), false);
        }
        this.selectedFiles = [];
        this.fileWindowCount = Math.max(0, this.fileWindowCount - successNum);
        this.updateStats(-successNum, false);
        if (successNum > 0) this.$message.success(this.$t('dashboard.batchDeleteSuccess'));
        if (errors.length) {
            this.$message.warning(errors[0].message || this.$t('dashboard.batchDeleteFailed'));
        }
        // 与后端重新对齐（目录可能因权限/空目录等原因仍在）
        await this.loadListWindow({ page: this.currentPage || 1, force: true });
        }).catch(() => console.log('Batch delete cancelled'));
    },
    async handleBatchCopy() {
        // 分离文件和文件夹
        const files = this.selectedFiles.filter(item => !item.isFolder);
        const folders = this.selectedFiles.filter(item => item.isFolder);
        
        // 如果有文件夹，显示加载状态
        let loading = null;
        if (folders.length > 0) {
            loading = this.$loading({
                lock: true,
                text: this.$t('dashboard.fetchingFileList')
            });
        }
        
        try {
            // 收集所有文件（包括文件夹内的文件）
            let allFiles = [...files];
            
            // 递归获取所有文件夹内的文件
            for (const folder of folders) {
                try {
                    const response = await fetchWithAuth(
                        `/api/manage/list?dir=${encodeURIComponent(folder.name)}&recursive=true&count=-1&instanceId=${encodeURIComponent(this.instanceId || '')}`,
                        { method: 'GET' }
                    );
                    const data = await response.json();
                    if (data.files && data.files.length > 0) {
                        allFiles = allFiles.concat(data.files);
                    }
                } catch (error) {
                    console.error(`获取文件夹 ${folder.name} 内容失败:`, error);
                }
            }
            
            if (loading) loading.close();
            
            if (allFiles.length === 0) {
                this.$message.warning(this.$t('dashboard.noLinksAvailable'));
                return;
            }
            
            // 生成所有链接
            const links = allFiles.map(file => {
                return this.generateFileLink(file.name, file.metadata);
            }).filter(link => link);
            
            if (links.length === 0) {
                this.$message.warning(this.$t('dashboard.noLinksAvailable'));
                return;
            }
            
            // 复制到剪贴板
            const text = links.join('\n');
            const ok = await copyText(text);
            if (ok) {
                this.$message.success(this.$t('dashboard.batchCopySuccess', { count: links.length }));
            } else {
                this.$message.error(this.$t('dashboard.batchCopyFailed'));
            }
        } catch (error) {
            if (loading) loading.close();
            console.error('Batch copy failed:', error);
            this.$message.error(this.$t('dashboard.batchCopyFailed'));
        }
    },
    async handleCopy(index, key) {
        const item = this.paginatedTableData[index];
        const ext = this.fileExt(item);
        let text = '';
        if (item.metadata?.Channel === 'External') {
            const external = this.withExt(item.metadata?.ExternalLink, ext);
            switch (this.defaultUrlFormat) {
                case 'originUrl':
                    text = external;
                    break;
                case 'mdUrl':
                    text = `![${item.metadata?.FileName || key}](${external})`;
                    break;
                case 'htmlUrl':
                    text = `<img src="${external}" alt="${item.metadata?.FileName || key}">`;
                    break;
                case 'bbUrl':
                    text = `[img]${external}[/img]`;
                    break;
                case 'tgId':
                    text = item.metadata?.TgFileId || 'none';
                    break;
                case 's3Location':
                    text = item.metadata?.S3Location || 'none';
                    break;
            }
        } else {
            const url = this.withExt(`${this.rootUrl}${key}`, ext);
            switch (this.defaultUrlFormat) {
                case 'originUrl':
                    text = url;
                    break;
                case 'mdUrl':
                    text = `![${item.metadata?.FileName || key}](${url})`;
                    break;
                case 'htmlUrl':
                    text = `<img src="${url}" alt="${item.metadata?.FileName || key}">`;
                    break;
                case 'bbUrl':
                    text = `[img]${url}[/img]`;
                    break;
                case 'tgId':
                    text = item.metadata?.TgFileId || 'none';
                    break;
                case 's3Location':
                    text = item.metadata?.S3Location || 'none';
                    break;
            }
        }
        const ok = await copyText(text);
        this.$message({
            type: ok ? 'success' : 'error',
            message: this.$t(ok ? 'dashboard.copyFileLinkSuccess' : 'dashboard.copyFailed')
        });
    },
    updateStats(num, init = false) {
        if (init) {
            this.Number = num;
        } else {
            this.Number += num;
        }
    },
    setSortField(field) {
        if (!SORT_FIELDS.includes(field)) return;
        this.sortField = field;
        this.currentPage = 1;
        localStorage.setItem('sortField', field);
    },
    setSortOrder(order) {
        if (!SORT_ORDERS.includes(order)) return;
        this.sortOrder = order;
        this.currentPage = 1;
        localStorage.setItem('sortOrder', order);
    },
    sortData(data) {
        if (!Array.isArray(data)) return [];

        const folders = data.filter(file => file.isFolder);
        const files = data.filter(file => !file.isFolder);

        const getSizeInBytes = (item) => {
            const parseSize = (value) => {
                if (value === null || value === undefined || value === '') return null;
                const parsedValue = Number(value);
                return Number.isFinite(parsedValue) ? parsedValue : null;
            };
            const sizeInBytes = parseSize(item.metadata?.FileSizeBytes);
            if (sizeInBytes !== null) return sizeInBytes;

            const sizeInMegabytes = parseSize(item.metadata?.FileSize);
            if (sizeInMegabytes !== null) return sizeInMegabytes * 1024 * 1024;

            return parseSize(item.size) ?? 0;
        };

        const getValue = (item) => {
            switch (this.sortField) {
                case 'size':
                    return getSizeInBytes(item);
                case 'rawName':
                    return item.metadata?.RawName || item.name || '';
                case 'fileName':
                    return item.metadata?.FileName || item.name || '';
                case 'views':
                    return Number(item.metadata?.Views || 0);
                // 上传用户：按 UploadUser 排序（未记录时用 uploader 兜底）
                case 'uploader':
                    return item.metadata?.UploadUser || item.uploader || '';
                // 文件类型：按扩展名排序
                case 'fileType': {
                    const n = item.metadata?.FileName || item.name || '';
                    const dot = n.lastIndexOf('.');
                    return dot > -1 ? n.slice(dot + 1).toLowerCase() : '';
                }
                case 'time':
                default:
                    return item.metadata?.TimeStamp ? new Date(item.metadata.TimeStamp).getTime() : 0;
            }
        };

        const compare = (a, b) => {
            const valA = getValue(a);
            const valB = getValue(b);

            let result = 0;
            if (typeof valA === 'string' || typeof valB === 'string') {
                result = String(valA || '').localeCompare(String(valB || ''));
            } else {
                result = valA - valB;
            }

            return this.sortOrder === 'desc' ? -result : result;
        };

        folders.sort(compare);
        files.sort(compare);

        return folders.concat(files);
    },
    handleVideoClick(event) {
        const videoElement = event.target;
        if (videoElement.requestFullscreen) {
            videoElement.requestFullscreen();
        } else if (videoElement.webkitRequestFullscreen) {
            // Safari/Old Chrome
            videoElement.webkitRequestFullscreen();
        } else if (videoElement.mozRequestFullScreen) {
            // Firefox
            videoElement.mozRequestFullScreen();
        } else if (videoElement.msRequestFullscreen) {
            // IE/Edge
            videoElement.msRequestFullscreen();
        }
    },

    handleSelectPage() {
        /*
         * v3.0.0（R8）：全选跳过「只读共享」条目（别人共享给我且权限为只读）——
         * 这些条目不可选中（卡片/列表的选择框已隐藏），全选也不得绕过。
         * 取消全选时无差别全部清掉（保持行为简单可靠）。
         */
        if (this.selectPage) {
            this.paginatedTableData.forEach(file => file.selected = false);
        } else {
            this.paginatedTableData.forEach(file => {
                if (!this.isSharedReadonly(file)) file.selected = true;
            });
        }
    },
    /** v3.0.0（R8）：该条目是否「别人共享给我且为只读」—— 不可选中、无目录属性入口 */
    isSharedReadonly(item) {
        return !!(item && item.shared && !item.sharedSelf && item.sharedPerm === 'readonly');
    },
    /** v3.0.0（R8）：该条目是否「别人共享给我的」（无论只读/编辑）—— 一律不可删除 */
    isSharedToMe(item) {
        return !!(item && item.shared && !item.sharedSelf);
    },
    clearSelection() {
        this.tableData.forEach(file => file.selected = false);
        this.selectedFiles = [];
        // v3.0.0（R16）：清空选择时同步重置 Shift 区间锚点
        this.lastSelectedIndex = -1;
    },
    handleBatchAction(command) {
        // 回收站模式：批量工具栏只有「恢复 / 彻底删除」
        if (this.trashMode) {
            if (command === 'restore') {
                this.trashRestoreItems([...this.selectedFiles]);
            } else if (command === 'purge') {
                this.trashPurgeItems([...this.selectedFiles]);
            }
            return;
        }
        if (command === 'copy') {
            this.handleBatchCopy();
        } else if (command === 'delete') {
            this.handleBatchDelete();
        } else if (command === 'download') {
            this.handleBatchDownload();
        } else if (command === 'move') {
            this.handleBatchMove();
        } else if (command === 'tagManagement') {
            this.handleBatchTagManagement();
        } else if (command === 'originalName') {
            // v3.0.0：批量编辑原名
            this.openBatchNameDialog();
        } else if (command === 'expiry' || command === 'redirect' || command === 'password') {
            // v3.0.0：批量限时 / 重定向 / 加密 —— 同一个处理页，按按钮预设打开页签
            this.openBatchExpiryDialog(command);
        } else if (command === 'ban') {
            this.handleBatchBlock();
        } else if (command === 'white') {
            this.handleBatchWhite();
        } else if (command === 'backupSelected') {
            this.handleBatchBackupSelected();
        }
    },
    /**
     * 一键备份所选文件（从「上传设置」迁移过来）：
     * 交由后端检测哪些选中文件还没有备份，仅对未备份的执行备份。
     */
    async handleBatchBackupSelected() {
        const files = this.selectedFiles.filter((f) => !f.isFolder);
        if (files.length === 0) {
            this.$message.warning(this.$t('dashboard.selectFilesFirst'));
            return;
        }
        try {
            await this.$confirm(
                this.$t('dashboard.backupSelectedConfirm', { count: files.length }),
                this.$t('dashboard.backupSelected'),
                {
                    confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
                    cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
                    type: 'warning'
                }
            );
        } catch {
            return;
        }
        const loading = this.$loading({ lock: true, text: this.$t('dashboard.backupSelected') });
        try {
            const resp = await fetchWithAuth('/api/manage/files/batch/backupSelected', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileIds: files.map((f) => f.name) })
            });
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok || body?.success === false) {
                throw new Error(body?.message || `HTTP ${resp.status}`);
            }
            const r = body?.data || body || {};
            const ok = Number(r.ok || 0);
            const fail = Number(r.fail || 0);
            const skipped = Number(r.skipped || 0);
            if (ok === 0 && fail === 0 && skipped > 0) {
                this.$message.info(this.$t('dashboard.backupSelectedNone'));
            } else if (ok === 0 && fail === 0 && skipped === 0) {
                this.$message.warning(this.$t('dashboard.backupSelectedFailed'));
            } else {
                this.$message.success(this.$t('dashboard.backupSelectedSuccess', { ok, fail, skipped }));
            }
        } catch (error) {
            console.error('Batch backup failed:', error);
            this.$message.error(this.$t('dashboard.backupSelectedFailed'));
        } finally {
            loading.close();
        }
    },
    handleMove(index, key) {
        // 打开自定义移动对话框
        this.moveFileKey = key;
        this.moveFileIndex = index;
        this.isBatchMove = false;
        this.moveTargetPath = '/';
        this.showMoveDialog = true;
    },
    handleBatchMove() {
        /*
         * v3.0.0：批量移动改成弹窗内的两步流程（先选接收实例，再选该实例下的目录），
         * 由 MoveFileDialog 的 showInstancePicker 承担；这里不再预先弹「选实例」对话框。
         */
        this.isBatchMove = true;
        this.moveTargetPath = '/';
        this.showMoveDialog = true;
    },
    // 确认移动操作（v3.0.0：第二个参数 = 目标实例 id，由 MoveFileDialog 两步流程给出）
    confirmMove(targetPath, targetInstanceId) {
        let value = String(targetPath || '').trim();
        /*
         * v3.0.0（R12）：目录名容错 —— 校验器要求路径以 / 开头，
         * 但用户在移动弹窗里通常直接输「漫画」这样的目录名，
         * 旧逻辑直接报「路径必须以 / 开头」然后拒绝（提示 3 秒自动消失），
         * 表现就是「选中文件夹点移动没反应/移动不成功」（需求 45）。
         * 现在自动补上前导斜杠再校验，纯目录名 / 带斜杠路径都能走通。
         */
        if (value && !value.startsWith('/')) value = `/${value}`;
        // 使用共享验证器验证路径
        const validation = validateFolderPath(value);
        if (!validation.valid) {
            this.$message.error(validation.error);
            return;
        }
        // 去掉开头的 /，结尾若没有 /，则加上
        const newPath = value.replace(/^\/+/, '') + (value.endsWith('/') ? '' : value === '' ? '' : '/');
        const instanceForMove = String(targetInstanceId ?? this.instanceId ?? '');
        // 判断目标文件夹是否是当前文件夹（跨实例移动不受此限制）
        if (newPath === this.currentPath && instanceForMove === String(this.instanceId || '')) {
            this.$message.warning(this.$t('dashboard.moveTargetSameAsCurrent'));
            return;
        }
        
        // 关闭对话框
        this.showMoveDialog = false;
        
        if (this.isBatchMove) {
            // 批量移动（v3.0.0：带上目标实例）
            this.executeBatchMove(newPath, instanceForMove);
        } else {
            // 单个文件/目录移动（v1.0.2：把目标实例一起传下去，跨实例移动才真的生效）
            this.executeSingleMove(newPath, instanceForMove);
        }
    },
    /**
     * v1.0.3：全屏「正在移动…」遮罩。
     *
     * 与回收站彻底删除的写法保持一致：$loading({ lock: true }) 锁定交互，
     * 返回的关闭函数做成**幂等**（内部 closed 标志位），
     * 这样 finally / catch / 早退分支里重复调用都不会报 "close of undefined"。
     */
    beginMoving() {
        const loading = this.$loading({ lock: true, text: this.$t('dashboard.movingHint') });
        let closed = false;
        return () => {
            if (closed) return;
            closed = true;
            try { loading.close(); } catch (e) { /* 已关闭 */ }
        };
    },
    // 执行单个文件 / 目录移动
    executeSingleMove(newPath, targetInstanceId = this.instanceId) {
        const key = this.moveFileKey;
        const item = this.tableData.find(file => file.name === key);
        const isFolder = !!item?.isFolder;
        const targetFolder = String(newPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
        /*
         * v3.0.0（R12）：统一走 POST /api/manage/batch/move ——
         * 原来的 GET /api/manage/move 在 compat 控制器里、只对管理员开放，
         * 普通用户移动自己的文件/目录一律 403（表现为「移动不成功」）。
         * 新接口同时支持文件 ids 与目录 folders，权限与批量移动一致。
         *
         * v1.0.2：补上目标实例 —— 之前单个移动恒传「当前实例」，
         * 在弹窗里选了别的实例也不会生效（看起来像移动失败）。
         * 后端约定：body.instanceId = 目标实例（空串 = 默认实例）。
         */
        const moveInstance = String(targetInstanceId ?? this.instanceId ?? '');
        const body = isFolder
            ? { folders: [key], folder: targetFolder, instanceId: moveInstance, fromInstanceId: String(this.instanceId || '') }
            : { ids: [key], folder: targetFolder, instanceId: moveInstance, fromInstanceId: String(this.instanceId || '') };
        // v1.0.3：移动期间显示全屏「正在移动…」遮罩（幂等关闭）
        const closeMoving = this.beginMoving();
        fetchWithAuth('/api/manage/batch/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(async (response) => {
                const result = await response.json().catch(() => ({}));
                if (!response.ok || result?.success === false) throw new Error(result?.message || 'failed');
                const fileIndex = this.tableData.findIndex(file => file.name === key);
                if (fileIndex !== -1) {
                    // 更新本地文件管理器
                    const newKey = newPath + key.split('/').pop();
                    fileManager.moveFile(key, newKey, isFolder, this.currentPath);
                    // 移除文件
                    this.tableData.splice(fileIndex, 1);
                    // 强制重新渲染内容
                    this.$nextTick(() => {
                        const tempData = [...this.tableData];
                        this.tableData = [];
                        this.$nextTick(() => {
                            this.tableData = tempData;
                        });
                    });
                }
                this.updateStats(-1, false);
                this.$message.success(this.$t('dashboard.moveSuccess'));
                await this.loadListWindow({ page: this.currentPage || 1 });
                this.refreshLocalFileList();
            })
            .catch(() => this.$message.error(this.$t('dashboard.moveFailed')))
            .finally(closeMoving);
    },
    /**
     * 执行批量移动（v3.0.0）
     * 文件与目录合并成一次 POST /api/manage/batch/move（后端同时支持 ids / folders）。
     */
    async executeBatchMove(newPath, targetInstanceId = this.instanceId) {
        const files = this.selectedFiles.filter((f) => !f.isFolder);
        const folders = this.selectedFiles.filter((f) => f.isFolder);
        const targetFolder = String(newPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
        // v1.0.3：批量移动同样加全屏「正在移动…」遮罩
        const closeMoving = this.beginMoving();
        try {
            /*
             * v3.0.0（R12）：文件与目录合并成一次请求（后端 batch/move 同时支持 folders）。
             * 目录移动会保留目录名与内部层级，并把目录属性（加密 / 共享 / 名称）一起搬走；
             * 跨实例移动现在也支持目录（原实现只给一句「不支持」提示）。
             */
            const resp = await fetchWithAuth('/api/manage/batch/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ids: files.map((f) => f.name),
                    folders: folders.map((f) => f.name),
                    folder: targetFolder,
                    instanceId: String(targetInstanceId || ''),
                    // v1.0.2：源实例，跨实例移动时后端据此定位要搬走的数据
                    fromInstanceId: String(this.instanceId || '')
                })
            });
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok || body?.success === false) throw new Error(body?.message || 'failed');
            /*
             * v3.0.0（R12）：成功条数 = 文件条数（updated）+ 目录个数（movedFolders）。
             * 旧实现只算 updated（文件行数），移动空目录时恒为 0 → 提示成功但计数为 0，
             * 看起来像「移动没生效」（需求 45）。
             */
            const movedFiles = Number(body?.updated || 0);
            const movedFolders = Number(body?.movedFolders || 0);
            if (!movedFiles && !movedFolders) {
                this.$message.warning(this.$t('dashboard.moveFailed'));
                return;
            }
            if (body?.failed?.length) {
                const first = body.failed[0]?.error || '';
                this.$message.warning(first || this.$t('dashboard.moveFailed'));
            }
            this.clearSelection();
            this.updateStats(-movedFiles, false);
            this.$message.success(this.$t('dashboard.moveSuccess'));
            await this.loadListWindow({ page: 1 });
            // 目录结构变了 → 目录导航候选与目录显示名同步刷新
            this.loadAllFolders().catch(() => undefined);
        } catch (e) {
            this.$message.error(this.$t('dashboard.moveFailed'));
        } finally {
            closeMoving();
        }
    },
    handleBatchBlock(){
        this.$confirm(this.$t('dashboard.batchBlockConfirm'), this.$t('dashboard.deleteConfirmTitle'), {
            confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
            cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
            type: 'warning'
        }).then(() => {
            // 跳过文件夹
            const promises = this.selectedFiles.map(file => {
                if (file.isFolder) {
                    return Promise.resolve({ ok: false });
                }
                return fetchWithAuth(`/api/manage/block/${file.name}`, { method: 'GET' });
            });

            Promise.all(promises)
                .then(results => {
                    results.forEach((response, index) => {
                        if (response.ok) {
                            const fileIndex = this.tableData.findIndex(file => file.name === this.selectedFiles[index].name);
                            if (fileIndex !== -1) {
                                this.tableData[fileIndex].metadata.ListType = 'Block';
                            }
                        }
                    });
                    this.$message.success(this.$t('dashboard.batchBlockSuccess'));
                })
                .catch(() => this.$message.error(this.$t('dashboard.batchBlockFailed')));
        }).catch(() => console.log('Batch block cancelled'));
    },
    handleBatchWhite(){
        this.$confirm(this.$t('dashboard.batchWhiteConfirm'), this.$t('dashboard.deleteConfirmTitle'), {
            confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
            cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
            type: 'warning'
        }).then(() => {
            // 跳过文件夹
            const promises = this.selectedFiles.map(file => {
                if (file.isFolder) {
                    return Promise.resolve({ ok: false });
                }
                return fetchWithAuth(`/api/manage/white/${file.name}`, { method: 'GET' });
            });

            Promise.all(promises)
                .then(results => {
                    results.forEach((response, index) => {
                        if (response.ok) {
                            const fileIndex = this.tableData.findIndex(file => file.name === this.selectedFiles[index].name);
                            if (fileIndex !== -1) {
                                this.tableData[fileIndex].metadata.ListType = 'White';
                            }
                        }
                    });
                    this.$message.success(this.$t('dashboard.batchWhiteSuccess'));
                })
                .catch(() => this.$message.error(this.$t('dashboard.batchWhiteFailed')));
        }).catch(() => console.log('Batch white cancelled'));
    },
    handleBatchDownload() {
        // 将选中文件打包成 zip 文件下载
        const zip = new JSZip();
        const folder = zip.folder('files');
        // 构造Promise数组，等待所有文件下载完成后再打包
        const fileNameCount = {}; // 用于跟踪文件名出现的次数

        const downloadPromises = this.selectedFiles.map(async file => {
            // 跳过文件夹
            if (file.isFolder) {
                return;
            }
            const response = await fetch(this.getFileLink(file.name));
            const blob = await response.blob();
            // 检查文件名是否已经存在
            let fileName = file.metadata?.FileName || file.name;
            if (fileNameCount[fileName]) {
                // 如果已经存在，则在文件名后加上编号
                const extension = fileName.substring(fileName.lastIndexOf('.'));
                const baseName = fileName.substring(0, fileName.lastIndexOf('.'));
                fileName = `${baseName}(${fileNameCount[fileName]})${extension}`;
                fileNameCount[file.name]++;
            } else {
                // 如果不存在，则初始化为1
                fileNameCount[fileName] = 1;
            }
            // 将文件添加到 zip 文件夹中
            folder.file(fileName, blob);
        });

        Promise.all(downloadPromises)
            .then(() => zip.generateAsync({ type: 'blob' }))
            .then(blob => {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = 'files.zip';
                link.click();
            });
    },
    isVideo(file) {
        // 排除音频文件
        if (this.isAudio(file)) return false;
        let flag = file.metadata?.FileType?.includes('video');
        // 用文件名后缀判断是否为视频文件
        if (!flag) {
            const videoExtensions = ['mp4', 'webm', 'ogg', 'avi', 'mov', 'flv', 'wmv', 'mkv', 'rmvb', '3gp', 'mpg', 'mpeg', 'm4v', 'f4v', 'rm', 'asf', 'dat', 'ts', 'vob', 'swf', 'divx', 'xvid', 'm2ts', 'mts', 'm2v', '3g2', '3gp2', '3gpp', '3gpp2', 'mpe', 'm1v', 'mpv', 'mpv2', 'mp2v', 'm2t', 'm2ts', 'm2v', 'm4v'];
            const extension = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
            flag = videoExtensions.includes(extension);
        }
        return flag;
    },
    isAudio(file) {
        let flag = file.metadata?.FileType?.includes('audio');
        // 用文件名后缀判断是否为音频文件
        if (!flag) {
            const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'ape', 'aiff', 'alac', 'opus', 'mid', 'midi', 'm4b', 'm4p', 'm4r', 'amr', 'au', 'ra', 'ram'];
            const extension = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
            flag = audioExtensions.includes(extension);
        }
        return flag;
    },
    /**
     * v2.9.0：判断一行数据属于哪种媒体，供预览浮层决定形态。
     * v3.0.0：新增 pdf / text —— 常用文档格式直接在灯箱里预览。
     */
    mediaKindOf(file) {
        const type = String(file?.metadata?.FileType || '').toLowerCase();
        if (type.includes('image')) return 'image';
        if (type.includes('video')) return 'video';
        if (type.includes('audio')) return 'audio';
        const ext = String(this.fileExt(file?.metadata || {}) || this.fileExt(file?.name || '') || '').toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif', 'ico', 'tiff', 'tif'].includes(ext)) return 'image';
        if (['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'flv', 'wmv', 'ts', 'm3u8'].includes(ext)) return 'video';
        if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'wma'].includes(ext)) return 'audio';
        // v3.0.0：PDF 用内嵌查看器直接打开
        if (ext === 'pdf') return 'pdf';
        /*
         * v3.0.0（R7）：CSV / TSV 走表格预览（首行表头 + 可滚动表格），
         * 比纯文本对齐好读得多；解析在预览组件内部完成，不额外请求。
         */
        if (ext === 'csv' || ext === 'tsv') return 'table';
        // v3.0.0：纯文本类（txt / md / json / 日志 / 配置 / 代码）直接读出来渲染
        /*
         * v3.0.0（R15）：凡是「能用文本方式打开」的都进 TXT 灯箱 ——
         * 补齐服务端脚本 / 前端框架文件 / 各类配置与源代码扩展名
         * （此前只有 html / js / yaml 等少数几种，php、vue、toml 等会被当成「其他」）。
         */
        if ([
            'txt', 'text', 'md', 'markdown', 'json', 'jsonl', 'ndjson', 'json5', 'log', 'csv', 'tsv',
            'ini', 'conf', 'cfg', 'properties', 'yml', 'yaml', 'toml', 'xml', 'plist', 'xaml',
            'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl',
            'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'vue', 'svelte',
            'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1',
            'py', 'go', 'java', 'kt', 'kts', 'scala', 'groovy', 'gradle',
            'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'm', 'mm', 'swift', 'rs', 'dart',
            'rb', 'php', 'phtml', 'pl', 'pm', 'lua', 'r', 'jl', 'tex', 'rst', 'proto',
            'sql', 'graphql', 'gql', 'env', 'lock', 'map', 'diff', 'patch', 'srt', 'vtt',
            'htaccess', 'dockerfile', 'makefile', 'gitignore', 'editorconfig',
            'service', 'nginx', 'asm', 's'
        ].includes(ext)) return 'text';
        return 'other';
    },
    /** v2.9.0：预览浮层顶栏显示的文件大小文案 */
    fileSizeTextOf(meta) {
        const bytes = Number(meta?.FileSizeBytes) || 0;
        if (!bytes) {
            const mb = Number(meta?.FileSize) || 0;
            return mb ? `${mb} MB` : '';
        }
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
        return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    },
    /**
     * 打开媒体预览（v2.9.0）
     * 点缩略图 / 封面触发：图片 → 灯箱，视频 → 播放器，音频 → 播放器，其它 → 通用弹窗。
     * 索引在当前页可预览媒体列表里查找，保证左右切换从被点的那一个开始。
     */
    openMediaPreview(item) {
        const key = item && (item.name || item.key);
        const list = this.mediaPreviewItems || [];
        const at = list.findIndex(it => it.key === key);
        this.mediaPreviewIndex = at >= 0 ? at : 0;
        this.showMediaPreview = true;
    },
    /** 预览浮层里点「查看详情」→ 复用文件详情弹窗 */
    handleMediaPreviewDetail(payload) {
        const key = payload && payload.key;
        if (!key) return;
        const index = (this.paginatedTableData || []).findIndex(row => row.name === key);
        if (index >= 0) this.openDetailDialog(index, key);
    },
    /**
     * v3.0.0（R17）：视频灯箱里「抓拍 → 上传 → 查看」。
     * 刚上传的抓拍图不在当前页列表里（列表没刷新，也不该因为抓拍被刷新），
     * 因此这里按上传返回的 File_ID + 抓拍文件名直接构造详情数据对象，
     * 交给同一个 FileDetailDialog 渲染（字段与正常记录一致：name + metadata）。
     * 灯箱保持打开，关掉详情页还回到原来的视频帧。
     */
    handleViewUploadedSnapshot(payload) {
        const id = payload && payload.id;
        if (!id) {
            this.$message.error(this.$t('mediaViewer.snapshotFailed'));
            return;
        }
        const fileName = String(payload.fileName || payload.name || '').trim() || `${id}.png`;
        this.detailFile = {
            name: id,
            metadata: {
                FileName: fileName,
                FileFirstName: fileName,
                FileType: 'image/png',
                Directory: this.currentPath || '',
                TimeStamp: Date.now(),
                // 抓拍图由上传接口自动打「视频抓拍」标签，这里同步给详情页展示
                Tags: ['视频抓拍'],
            },
        };
        this.showdetailDialog = true;
    },
    isImage(file) {
        let flag = file.metadata?.FileType?.includes('image');
        // 用文件名后缀判断是否为图片文件
        if (!flag) {
            const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'psd', 'ai', 'eps', 'raw', 'cr2', 'nef', 'orf', 'sr2', 'dng', 'arw', 'rw2', 'raf', 'pef', 'x3f', 'srf', 'erf', 'mrw', 'nrw', 'kdc', 'dcr', 'mef', 'mos', 'crw', 'raf', 'rwl', 'srw', '3fr', 'fff', 'iiq', 'qtk', 'bay', 'k25', 'kdc', 'dcs', 'drf', 'dng', 'erf', 'kdc', 'mdc', 'mef', 'mos', 'mrw', 'nef', 'nrw', 'orf', 'pef', 'ptx', 'pxn', 'r3d', 'raf', 'raw', 'rwl', 'rw2', 'rwz', 'sr2', 'srf', 'x3f'];
            const extension = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
            flag = imageExtensions.includes(extension);
        }
        return flag;
    },
    /**
     * 对外可复制的完整外链：含访问域名，**不带** ?from=admin。
     * 用于「文件详情 → 原始链接 / Markdown / HTML / BBCode」以及各类复制入口。
     */
    filePublicUrl(filename, metadata) {
        const meta = metadata || this.tableData.find(file => file.name === filename)?.metadata;
        // 全站统一出口：后台设置了「自定义访问域名」时自动跟随（utils/fileDetail）
        return filePublicUrlUtil(filename, meta || filename);
    },
    /**
     * 后台内部预览 / 取流地址：带 ?from=admin 走管理员会话，不受黑白名单与域名白名单限制。
     * 只用于 <img>/<video> 预览、批量下载 fetch —— 不要拿它当对外链接展示。
     */
    getFileLink(filename, metadata) {
        const meta = metadata || this.tableData.find(file => file.name === filename)?.metadata;
        const path = this.withExt(`/file/${filename}`, this.fileExt(meta || filename));
        return `${path}?from=admin`;
    },
    /* v3.0.0（R9）：悬停预览（HoverPreview / 小眼睛）已整体移除，相关方法一并删除 */
    isMobileViewport() {
        // v20261027：阈值 768 → 1024 —— 平板也按触屏处理（悬浮提示改点击、启用触屏手势）
        return window.innerWidth <= 1024;
    },
    /** v2.8.9：移动端展开 / 收起搜索框（展开后自动聚焦输入框） */
    toggleMobileSearch() {
        this.mobileSearchOpen = !this.mobileSearchOpen;
        /*
         * v3.0.0：收起的同时清空搜索框 —— 移动端搜索框默认收起，
         * 若收起时残留旧关键字，下次展开会误以为没生效；这里一并清掉
         * 未提交的输入（tempSearch）与已提交的搜索（search）并回到普通列表。
         */
        if (!this.mobileSearchOpen) {
            if (this.tempSearch || this.search) {
                this.tempSearch = '';
                if (this.search) {
                    this.search = '';
                    this.isSearchMode = false;
                    this.currentPage = 1;
                    this.refreshFileList();
                }
            }
            return;
        }
        this.$nextTick(() => {
            const input = this.$refs.searchInput;
            if (input && typeof input.focus === 'function') input.focus();
        });
    },
    updateResponsivePageSize() {
        // v2.8.2：全终端统一每页 24（含文件夹一起计数），不再按视口降为 18/16
        const nextPageSize = 24;
        // v3.0.0（R4）：窗口尺寸变化时重算第二行工具栏的吸顶态
        this.updateBreadcrumbStuck();
        if (this.pageSize === nextPageSize) return;
        const firstVisibleIndex = (this.currentPage - 1) * this.pageSize;
        this.pageSize = nextPageSize;
        this.currentPage = Math.min(
            Math.floor(firstVisibleIndex / nextPageSize) + 1,
            this.realTotalPages
        );
    },
    isSwipeIgnoredTarget(target) {
        return Boolean(target?.closest?.('button, a, input, textarea, select, .el-checkbox, .action-btn, .list-action-btn'));
    },
    /**
     * v3.0.0（R4）：移动端「全选 / 视图切换」工具栏吸顶（桌面端完全不启用）。
     * 本站由 OverlayScrollbars 接管 body 滚动（body 自身带 overflow: hidden auto），
     * 原生 position: sticky 不生效 —— 所以用「越过阈值 → 切 fixed + 外层占位」实现：
     *   · 顶栏可见时贴在顶栏下方；滚回它原本的位置（阈值以下）立即复位，回到普通文档流。
     * v3.0.0（R5）：改为与顶栏同进同出 —— 向下滚动顶栏上滑隐藏时，第二行也一并上滑收起
     * （.is-header-hidden 的 transform），只有向上滚动、顶栏显示时才吸附在顶栏下方。
     */
    handleBreadcrumbScroll() {
        if (this.breadcrumbStuckFrame) return;
        this.breadcrumbStuckFrame = requestAnimationFrame(() => {
            this.breadcrumbStuckFrame = null;
            this.updateBreadcrumbStuck();
        });
    },
    /** 顶栏显隐变化（自定义事件）—— 不是高频事件，直接同步重算，避免跟随滞后一帧 */
    handleHeaderToggle(event) {
        this.breadcrumbHeaderHidden = Boolean(event && event.detail && event.detail.hidden);
        this.updateBreadcrumbStuck();
    },
    /**
     * 吸顶时工具栏应有的 top：顶栏静止位置底部 + 2px。
     * v1.0.8：吸附态与常态统一成 2px（原先两处都是 8px，用户要求贴紧顶栏）。
     * 用 offsetTop/offsetHeight 而不是 getBoundingClientRect —— 顶栏显隐靠 transform 位移，
     * rect 会随动画/隐藏状态变化；offset 只反映布局位置，任何时刻都是「顶栏展开时」的底部。
     */
    breadcrumbStickyTop() {
        const header = document.querySelector('.admin-header-content');
        if (!header) return 52;
        return Math.round(header.offsetTop + header.offsetHeight + 2);
    },
    /** 吸顶中：按顶栏显隐状态同步 fixed 的 top（顶栏隐藏时贴 0，让 -100% 位移能整行滑出屏幕） */
    syncBreadcrumbStuckTop() {
        const bar = this.$refs.breadcrumbBar;
        if (!bar || !this.breadcrumbStuck) return;
        bar.style.top = (this.breadcrumbHeaderHidden ? 0 : this.breadcrumbStickyTop()) + 'px';
    },
    /**
     * v3.0.0（R11）：当前滚动位置 —— 兼容三种滚动容器：
     *   · 原生滚动（触屏，html/body）：document.scrollingElement.scrollTop / window.scrollY；
     *   · OverlayScrollbars 接管 body（桌面窄窗 <768px 时吸顶逻辑也会走到）：viewport 元素 scrollTop；
     *   · 兜底 body.scrollTop。
     */
    currentScrollY() {
        const doc = document.scrollingElement || document.documentElement;
        let y = doc.scrollTop || window.scrollY || 0;
        if (!y) {
            const osViewport = document.querySelector('[data-overlayscrollbars-viewport]');
            if (osViewport) y = osViewport.scrollTop || 0;
        }
        if (!y) y = document.body.scrollTop || 0;
        return y;
    },
    updateBreadcrumbStuck() {
        /*
         * v3.0.0（R8）：移动端（≤768px）第二行恢复「顶栏下方吸附」——
         * 越过原始位置后切 fixed 贴在顶栏下（与顶栏同进同出），滚回原位立即复位；
         * 桌面 / 平板（>768px）维持静态背框，并把历史 fixed 内联样式复位
         * （窗口尺寸变化 / 热更新时也安全）。
         */
        if (window.innerWidth > 768 || this.tagModeActive) {
            if (this.breadcrumbStuck) this.applyBreadcrumbStuck(false);
            return;
        }
        const wrap = this.$refs.breadcrumbStickyWrap;
        const bar = this.$refs.breadcrumbBar;
        if (!wrap || !bar) return;
        const scrollY = this.currentScrollY();
        /*
         * v3.0.0（R14）：复位阈值只在「未吸附」时测量并缓存 ——
         * 吸附期间 bar 是 fixed、回收站提示条 / 顶栏显隐都会改动文档流，
         * 每帧实时测量会把阈值算大，导致「还没滚回原位就提前复位」。
         * 判定一律用缓存值；复位后（未吸附）下一帧重新测量，保证布局变化能生效。
         */
        if (!this.breadcrumbStuck || this.breadcrumbThreshold === null) {
            // 原始位置 = 占位容器在文档流里的顶部（占位高度在 fixed 化过程中不变，结果稳定）
            this.breadcrumbThreshold = wrap.getBoundingClientRect().top + scrollY;
        }
        const threshold = this.breadcrumbThreshold;
        const shouldStick = scrollY > threshold + 1;
        if (shouldStick !== this.breadcrumbStuck) {
            this.applyBreadcrumbStuck(shouldStick);
        } else if (this.breadcrumbStuck) {
            this.syncBreadcrumbStuckTop();
        }
    },
    applyBreadcrumbStuck(on) {
        const wrap = this.$refs.breadcrumbStickyWrap;
        const bar = this.$refs.breadcrumbBar;
        if (!wrap || !bar) {
            this.breadcrumbStuck = false;
            return;
        }
        if (!on) {
            if (!this.breadcrumbStuck) return;
            // v3.0.0（R14）：复位后清掉缓存阈值 —— 下一帧按当前布局重新测量
            this.breadcrumbThreshold = null;
            wrap.style.height = '';
            bar.style.position = '';
            bar.style.top = '';
            bar.style.left = '';
            bar.style.width = '';
            bar.style.zIndex = '';
            // v3.0.0（R11）：fixed 化时清掉的上下外边距要还原（文档流里仍靠它们撑 10px 间距）
            bar.style.marginTop = '';
            bar.style.marginBottom = '';
            bar.style.removeProperty('--breadcrumb-hide-y');
            this.breadcrumbStuck = false;
            return;
        }
        /*
         * v3.0.0（R8）：吸附分支（仅 ≤768px 被调用）——
         *   · 先把占位容器高度钉住（flow-root 含内 margin，翻页 / 加载不跳动）；
         *   · 背框切 fixed：左右各留 4px，与移动端顶栏背框完全同宽（100% - 8px）。
         */
        wrap.style.height = wrap.offsetHeight + 'px';
        bar.style.position = 'fixed';
        bar.style.top = (this.breadcrumbHeaderHidden ? 0 : this.breadcrumbStickyTop()) + 'px';
        // v3.0.0（R11）：fixed 元素的 margin 依然生效（margin-top 10px 会把工具栏再往下推 10px，
        // 导致与顶栏的间距变成 15px 而不是 5px）—— 吸附期间上下外边距清零，复位时还原
        bar.style.marginTop = '0';
        bar.style.marginBottom = '0';
        /*
         * v3.0.0（R11c）：吸附态的背框宽度与常态完全一致 ——
         * 常态是主内容区宽度（左右各 10px 内边距，即 100% - 20px，left 10px）；
         * 之前固定成「顶栏同宽」（left 4px / 100% - 8px），吸附瞬间会变宽，视觉上跳一下。
         */
        bar.style.left = '10px';
        bar.style.width = 'calc(100% - 20px)';
        bar.style.zIndex = '35';
        this.breadcrumbStuck = true;
    },
    handlePageSwipeStart(event) {
        if (!this.isMobileViewport() || this.isDragging || this.loading || this.showMobileActionModal || this.tagModeActive || this.isSwipeIgnoredTarget(event.target)) {
            this.resetPageSwipe();
            return;
        }
        const touch = event.touches?.[0];
        if (!touch) return;
        this.pageSwipeStartX = touch.clientX;
        this.pageSwipeStartY = touch.clientY;
        this.pageSwipeStartTime = Date.now();
    },
    /**
     * v3.0.0（R12）：移动端左右滑动 = 切换「内容展示方式」。
     * v3.0.0（R14）：改为轮回切换 —— 不再「左滑/右滑各对应一个模式」，
     * 只要横向滑动达标就切到另一个模式（连续同方向滑动会来回轮回），
     * 与滑动方向无关；这样空白区域随便左右滑都能切换。
     * 原先这里是「左右滑动翻页」，用户要求改成切换展示模式（翻页用底部页码）。
     */
    async handlePageSwipeEnd(event) {
        if (this.pageSwipeStartX === null || this.pageSwipeStartY === null) return;
        const touch = event.changedTouches?.[0];
        if (!touch) {
            this.resetPageSwipe();
            return;
        }
        const deltaX = touch.clientX - this.pageSwipeStartX;
        const deltaY = touch.clientY - this.pageSwipeStartY;
        const elapsed = Date.now() - this.pageSwipeStartTime;
        this.resetPageSwipe();

        if (elapsed > 700 || Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) {
            return;
        }
        const next = this.searchResultDisplay === 'folders' ? 'expanded' : 'folders';
        this.selectSearchResultDisplay(next);
        this.$message.info(
            next === 'folders' ? this.$t('fileManager.showFolders') : this.$t('fileManager.expandFiles')
        );
    },
    resetPageSwipe() {
        this.pageSwipeStartX = null;
        this.pageSwipeStartY = null;
        this.pageSwipeStartTime = 0;
    },
    async goToSwipePage(page) {
        // v3.0.0：翻页一律走服务端整页替换（不再「按需补载到第 N 页」）
        if (page < 1 || page > this.realTotalPages || page === this.currentPage) return;
        this.handlePageChange(page);
    },
    // 跳转到指定页码
    handleJumpPage() {
        const page = parseInt(this.jumpPage);
        if (isNaN(page) || page < 1) {
            this.$message.warning(this.$t('dashboard.invalidPageNumber'));
            return;
        }
        if (page > this.realTotalPages) {
            this.$message.warning(this.$t('dashboard.pageExceedsMax', { max: this.realTotalPages }));
            return;
        }
        // v3.0.0：直接请求该页并整页替换列表
        this.handlePageChange(page);
        this.jumpPage = '';
    },
    /**
     * v3.0.0（R12，需求 44）：目录显示名。
     * 目录属性里的「目录名称」只改展示、不改真实路径（文件夹仍按原路径存取），
     * 因此所有展示目录名的地方都必须过一层本函数，否则就会出现「改了名还是旧名」。
     */
    displayFolderName(path) {
        const p = String(path || '').replace(/^\/+|\/+$/g, '');
        if (!p) return this.$t('dashboard.rootDirectory');
        const map = this.folderNameOf || {};
        const custom = map[p];
        if (custom) return custom;
        const parts = p.split('/').filter(Boolean);
        return parts[parts.length - 1] || p;
    },
    // 判断是否为文件夹
    isFolder(item) {
        // 尊重文件列表的类型，避免把递归结果中的文件误判为文件夹。
        if (typeof item.isFolder === 'boolean') {
            return item.isFolder;
        }
        
        // 获取真实的文件路径（去除URL前缀）
        let path = item.name;
        if (path.startsWith('http')) {
            path = path.split('/file/')[1];
        }
        
        // 如果文件名包含'/'，需要判断是否是当前路径下的文件
        if (path && path.includes('/')) {
            // 获取相对于当前路径的部分
            const relativePath = this.currentPath ? 
                path.substring(this.currentPath.length) : 
                path;
            
            // 如果在根目录，第一个斜杠前的部分就是文件夹
            if (this.currentPath === '') {
                return !path.split('/')[0].includes('.');
            }
            
            // 如果在子文件夹中，检查相对路径是否还包含其他文件夹
            return relativePath.includes('/');
        }
        
        return false;
    },
    
    // 获取文件夹名称
    getFolderName(path) {
        let folderName = '';
        // 如果是文件夹路径，只返回最后一级文件夹名
        if (path && path.includes('/')) {
            const parts = path.split('/');
            // 如果是根目录下的文件夹
            if (this.currentPath === '') {
                folderName = parts[0];
            } else {
                // 如果是子文件夹
                const relativePath = path.substring(this.currentPath.length);
                folderName = relativePath.split('/')[0];
            }
        } else {
            folderName = path;
        }

        const maxLength = 20; // Adjust max length as needed
        if (folderName.length > maxLength) {
            const startLength = Math.floor((maxLength - 3) / 2);
            const endLength = Math.ceil((maxLength - 3) / 2);
            return `${folderName.substring(0, startLength)}...${folderName.substring(folderName.length - endLength)}`;
        }
        return folderName;
    },
    
    // 获取文件名称（去除路径和URL前缀）
    getFileName(path) {
        let fileName = path.split('/').pop();
        const maxLength = 20; // Adjust max length as needed, ensure it fits in one line
        if (fileName.length > maxLength) {
            const startLength = Math.floor((maxLength - 3) / 2);
            const endLength = Math.ceil((maxLength - 3) / 2);
            return `${fileName.substring(0, startLength)}...${fileName.substring(fileName.length - endLength)}`;
        }
        return fileName;
    },
    
    // 获取文件名前半部分（用于中间省略效果）
    getFileNameStart(name) {
        if (!name) return '';
        // 如果文件名较短，返回全部
        if (name.length <= 30) return name;
        // 保留开头部分（约60%的长度用于显示前半部分）
        const dotIndex = name.lastIndexOf('.');
        if (dotIndex > 0) {
            // 有扩展名的情况：返回文件名主体部分
            const baseName = name.substring(0, dotIndex);
            const keepLength = Math.min(baseName.length, Math.floor(name.length * 0.6));
            return baseName.substring(0, keepLength);
        }
        // 无扩展名的情况
        return name.substring(0, Math.floor(name.length * 0.6));
    },
    
    // 获取文件名后半部分（用于中间省略效果）
    getFileNameEnd(name) {
        if (!name) return '';
        // 如果文件名较短，返回空
        if (name.length <= 30) return '';
        // 保留末尾部分（包含扩展名）
        const dotIndex = name.lastIndexOf('.');
        if (dotIndex > 0) {
            // 有扩展名的情况：返回最后几个字符 + 扩展名
            const ext = name.substring(dotIndex);
            const baseName = name.substring(0, dotIndex);
            const keepLength = Math.min(8, Math.floor(baseName.length * 0.2));
            return '…' + baseName.substring(baseName.length - keepLength) + ext;
        }
        // 无扩展名的情况
        const keepLength = Math.min(10, Math.floor(name.length * 0.3));
        return '…' + name.substring(name.length - keepLength);
    },
    
    // 进入文件夹
    enterFolder(folderPath) {
        this.currentPage = 1;
        // 确保路径末尾有 '/'
        this.currentPath = folderPath + (folderPath.endsWith('/') ? '' : '/');
        // v3.0.0：移动端进入子目录时压一条历史，返回键先回上一级而不是离开页面
        this.pushFolderHistory();
        // 刷新文件列表，到指定currentPath下
        this.refreshFileList();
    },
    
    // 导航到指定文件夹
    navigateToFolder(path) {
        this.currentPage = 1;
        // 确保空路径时不添加 '/'
        this.currentPath = path ? (path + (path.endsWith('/') ? '' : '/')) : '';
        // v3.0.0（R7）：悬停展开的目录下拉在跳转后收起，避免浮层一直挂着
        if (this.dirHoverOpened) {
            this.dirHoverOpened = false;
            const dd = this.$refs.dirDropdown;
            if (dd && typeof dd.handleClose === 'function') dd.handleClose();
        }
        // v3.0.0：移动端目录跳转同样压一条历史
        this.pushFolderHistory();
        // 刷新文件列表，到指定currentPath下
        this.refreshFileList();
    },

    /* ==========================================================================
     * v3.0.0 移动端返回键：回到上一级目录
     * --------------------------------------------------------------------------
     * 进入子目录时 pushState 一条 {folder} 历史；按返回键（popstate）时
     *   · 不在根目录 → 回上一级目录，并补压一条占位历史（返回键只回目录、不离开页面）；
     *   · 已在根目录 → 不拦截，交给浏览器真正返回。
     * 桌面端不启用（matchMedia('(hover:none)') 判断）。
     * 浮层（弹窗 / 灯箱）打开时 popstate 由浮层自己消费，本页不处理。
     * ========================================================================== */

    /** 是否触屏设备（hover:none）—— 只有触屏才接管返回键 */
    isTouchViewport() {
        try {
            return window.matchMedia('(hover: none)').matches;
        } catch (e) {
            return false;
        }
    },
    /** 是否有「可见的」Element Plus 浮层（.el-overlay 关闭后仍留在 DOM 里，必须看渲染盒子） */
    hasVisibleOverlay() {
        const list = Array.from(document.querySelectorAll('.el-overlay'));
        return list.some((el) => {
            if (!el || !el.isConnected) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return el.getClientRects().length > 0;
        });
    },
    /** 当前是否有浮层打开（有则把返回键让给浮层：backGuard 关弹窗 / 灯箱自己消费） */
    hasOpenFloatingLayer() {
        // v3.0.0（R18）修复：hoverPreview 字段从未在 data 里定义过，
        // 旧代码在这里直接读 .visible 抛 TypeError，导致整条移动端 popstate
        // 处理（回上一级目录 / 根目录屏蔽返回）实际上一直在报错中断。
        if (this.hoverPreview && this.hoverPreview.visible) return true;
        if (this.showMediaPreview) return true;
        if (this.showdetailDialog || this.showFilterDialog || this.showTagFilterDialog) return true;
        if (this.showUrlDialog || this.showMoveDialog || this.showMobileActionModal) return true;
        if (this.showTagDialog || this.showBatchTagDialog || this.showBatchNameDialog) return true;
        if (this.showBatchExpiryDialog || this.showFolderProps || this.showRecordDialog) return true;
        if (this.showInstanceDialog) return true;
        // Element Plus 的弹窗 / MessageBox 浮层 + 灯箱（自定义浮层，不是 .el-overlay）
        if (this.hasVisibleOverlay()) return true;
        if (document.querySelector('.media-viewer')) return true;
        return false;
    },
    /** 进入子目录时压一条历史（根目录不需要压） */
    pushFolderHistory() {
        if (!this.isTouchNav) return;
        try {
            window.history.pushState({ folder: this.currentPath || '' }, '', window.location.href);
        } catch (e) { /* 隐私模式等环境忽略 */ }
    },
    /**
     * v3.0.0：记录 body 直接子节点变化的时间。
     *
     * utils/backGuard 在「浮层元素的增删」时会把 history.back() 用来退掉自己的哨兵条目，
     * 这会触发一次 popstate —— 必须和「用户按了返回键」区分开，否则会莫名其妙回上一级目录。
     * 程序触发的 popstate 总是紧跟在一次 body 子节点变化之后，这里用 300ms 时间窗过滤；
     * 真正的返回键操作不会伴随这种变化。
     * （只观察 body 直接子节点：弹窗 / 消息框都挂在这里，列表重渲染不会触发）
     */
    setupBodyMutationWatch() {
        if (typeof MutationObserver === 'undefined') return;
        this.__lastBodyMutationAt = 0;
        this.__bodyObserver = new MutationObserver(() => {
            this.__lastBodyMutationAt = Date.now();
        });
        this.__bodyObserver.observe(document.body, { childList: true });
    },
    /** popstate：不在根目录就回上一级，并补一条占位历史 */
    handleMobilePopState() {
        if (!this.isTouchNav) return;
        // 浮层打开时由浮层自己消费（弹窗 → backGuard 关弹窗；灯箱 → 灯箱自己处理）
        if (this.hasOpenFloatingLayer()) return;
        // 程序触发的 popstate（backGuard 退哨兵）紧跟在 body 子树变化之后 → 忽略
        if (Date.now() - (this.__lastBodyMutationAt || 0) < 300) return;
        // v3.0.0（R18）：这次 popstate 已被浮层消费（backGuard 先补压哨兵再关一层）
        // —— 浮层可能就是灯箱，关掉后 hasOpenFloatingLayer() 立刻变 false，
        // 不拦的话会被当成本页的返回键，顺手回上一级目录。
        if (Date.now() - (window.__gohubBackGuardAt || 0) < 500) return;
        // v3.0.0（R8）修复「移动端关灯箱误触返回上一级」：
        // 灯箱主动关闭时会 history.back() 退掉自己的哨兵条目并打
        // window.__gohubMediaViewerPopAt 时间戳 —— 这次 popstate 是程序触发的，
        // 不能当成「用户按返回键」去回上一级目录。
        if (Date.now() - (window.__gohubMediaViewerPopAt || 0) < 500) return;
        const parts = this.normalizedCurrentPath.split('/').filter(Boolean);
        if (!parts.length) {
            /*
             * v3.0.0（R14）：已在根目录 → 屏蔽返回（不再离开文件管理页）。
             * 原来这里直接 return，浏览器会退到进入本页之前的历史；
             * 回补一条同 URL 的历史，让这一次返回「无效果」。
             */
            try {
                window.history.pushState({ folder: '' }, '', window.location.href);
            } catch (e) { /* 隐私模式等环境忽略 */ }
            return;
        }
        const parent = parts.slice(0, -1).join('/');
        this.navigateToFolder(parent);
        // navigateToFolder 已压过一条（此时 currentPath 已是父级）
    },

    // 顶部工具栏「刷新」：不刷新页面，重新加载当前分类下的文件
    async handleRefreshFiles() {
        if (this.refreshLoading) return;
        try {
            await this.refreshFileList();
            this.$message.success(this.$t('dashboard.refreshed'));
        } catch (e) {
            if (e && e.message !== 'Unauthorized') {
                this.$message.error(this.$t('dashboard.syncDataError'));
            }
        }
    },

    /* ==========================================================================
     * v3.0.0 目录导航下拉：「当前 / 全局」切换
     * ========================================================================== */

    /** 下拉展开 / 收起：每次打开都回到「当前」，并清空全局搜索 */
    handleDirDropdownVisible(visible) {
        // v1.1.3：打开期间一滚动就收起（移动端需求）
        if (visible) this.bindDropdownScrollDismiss('dir');
        else this.releaseDropdownScrollDismiss('dir');
        if (!visible) return;
        /*
         * v3.0.0（R12）：悬停展开与点击展开统一回到「当前」层级。
         * 原先悬停会直接切到「全局」，鼠标只是划过就会跳成整实例的全部目录，
         * 与「默认显示当前」的要求相反。
         */
        this.dirScope = 'current';
        this.dirSearch = '';
    },
    /** v1.1.3：排序下拉打开 → 绑定「滚动即收起」 */
    handleSortDropdownVisible(visible) {
        if (visible) this.bindDropdownScrollDismiss('sort');
        else this.releaseDropdownScrollDismiss('sort');
    },
    /**
     * v1.1.3：下拉展开期间，页面一滚动就收起（移动端需求）。
     * el-dropdown 有 handleClose，但滚动可能来自页内滚动容器，
     * 统一用 utils/scrollDismiss 处理，与笔记管理页共用同一套行为。
     */
    bindDropdownScrollDismiss(key) {
        const refMap = { sort: 'sortDropdown', dir: 'dirDropdown' };
        this._ddUnbind = this._ddUnbind || {};
        if (this._ddUnbind[key]) return;
        this._ddUnbind[key] = bindScrollDismiss(() => {
            const dd = this.$refs[refMap[key]];
            if (dd && typeof dd.handleClose === 'function') dd.handleClose();
        });
    },
    releaseDropdownScrollDismiss(key) {
        if (this._ddUnbind && this._ddUnbind[key]) {
            this._ddUnbind[key]();
            this._ddUnbind[key] = null;
        }
    },
    /** v3.0.0（R7）：桌面端鼠标悬停「目录导航」→ 展开下拉（默认仍是「当前」层级） */
    handleDirHoverEnter() {
        if (this.suppressDirHover()) return;
        this.clearDirHoverTimer();
        this.dirHoverOpened = true;
        this.dirScope = 'current';
        const dd = this.$refs.dirDropdown;
        if (dd && typeof dd.handleOpen === 'function') dd.handleOpen();
    },
    handleDirHoverLeave() {
        if (this.suppressDirHover()) return;
        this.clearDirHoverTimer();
        this.dirHoverLeaveTimer = setTimeout(() => {
            this.dirHoverLeaveTimer = null;
            // 指针已经移进浮层（或在浮层里操作搜索框）时不关闭
            if (document.querySelector('.dir-hover-popper:hover')) return;
            const dd = this.$refs.dirDropdown;
            if (dd && typeof dd.handleClose === 'function') dd.handleClose();
            this.dirHoverOpened = false;
        }, 320);
    },
    clearDirHoverTimer() {
        if (this.dirHoverLeaveTimer) {
            clearTimeout(this.dirHoverLeaveTimer);
            this.dirHoverLeaveTimer = null;
        }
    },
    /** 触屏 / 窄屏（≤1023）不做悬停展开，避免和点击 / 滚动冲突 */
    suppressDirHover() {
        if (typeof window === 'undefined') return true;
        return window.innerWidth <= 1023 || window.matchMedia('(hover: none)').matches;
    },
    /** 切到「全局」时按当前实例拉取全部目录 */
    handleDirScopeChange(scope) {
        if (scope === 'global') this.loadAllFolders();
    },
    /** GET /api/manage/folders/all?instanceId= → { success, data: ['2026','2026/10',...] } */
    async loadAllFolders() {
        this.allFoldersLoading = true;
        try {
            const res = await fetchWithAuth(
                `/api/manage/folders/all?instanceId=${encodeURIComponent(this.instanceId || '')}`,
                { method: 'GET' }
            );
            const json = await res.json().catch(() => ({}));
            const list = Array.isArray(json?.data) ? json.data : [];
            // 按路径排序，父级天然排在子级之前（'2026' < '2026/10'）
            this.allFolders = list
                .map((p) => String(p).replace(/^\/+|\/+$/g, ''))
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
            /*
             * v3.0.0（R12）：全局目录树也吃「目录属性里的自定义名称」——
             * 只改 meta 不改路径，以前全局导航里永远是旧名字（需求 44）。
             */
            this.allFolderNames = json?.displayNames && typeof json.displayNames === 'object'
                ? json.displayNames
                : {};
        } catch (e) {
            this.allFolders = [];
        } finally {
            this.allFoldersLoading = false;
        }
    },

    /* ==========================================================================
     * v3.0.0 列表加载 —— 服务端分页窗口
     * --------------------------------------------------------------------------
     * 与旧实现的差别：
     *   · 请求一律带 instanceId（空串 = 默认实例）与 flat（直接展开文件时为 true）；
     *   · 列表只保存「当前窗口」的数据：翻页 = 整页替换，加载更多 = 尾部追加一页，
     *     向上滚到顶 = 头部补载一页并保持滚动位置；
     *   · 总数（listTotal）来自后端，分页按钮按它计算，不在本地切片。
     * ========================================================================== */

    /** 组装列表请求 URL（搜索 / 标签 / 筛选 / 搜索类型 / 用户 / 实例 / flat 全带上） */
    buildListUrl(start, count) {
        let url = `/api/manage/list?count=${count}&start=${start}`
            + `&dir=${encodeURIComponent(this.currentPath || '')}`
            + `&search=${encodeURIComponent((this.searchKeywords || '').trim())}`
            + `&instanceId=${encodeURIComponent(this.instanceId || '')}`;
        // 直接展开文件 = 递归平铺当前目录（后端不返回文件夹聚合）
        if (this.recursiveSearchResults) url += '&flat=true';
        if (this.searchIncludeTags) url += `&includeTags=${encodeURIComponent(this.searchIncludeTags)}`;
        if (this.searchExcludeTags) url += `&excludeTags=${encodeURIComponent(this.searchExcludeTags)}`;
        /*
         * 筛选参数沿用 utils/fileManager 的拼装（与其它页面同一口径）；
         * 它内部只认 matchMode=any/all，这里先屏蔽，再统一按 and/or 显式传一次
         * —— 后端两种写法都认，前端固定用 and/or 避免中文或其它值。
         */
        /*
         * v3.0.0：两个「不走数组」的筛选项单独拼：
         *   · 已加密 → encryptedOnly=1（accessStatus 里只保留 normal / blocked / deleted）
         *   · 用户共享 → shareScope=mine|tome（单选）
         */
        const accessStatus = (this.filters.accessStatus || []).filter((v) => v !== 'encrypted');
        url += fileManager.buildFilterParams({ ...this.filters, accessStatus, shareScope: '', matchMode: '' });
        if ((this.filters.accessStatus || []).includes('encrypted')) url += '&encryptedOnly=1';
        if (this.filters.shareScope) url += `&shareScope=${this.filters.shareScope === 'tome' ? 'tome' : 'mine'}`;
        url += `&matchMode=${this.filters.matchMode === 'or' ? 'or' : 'and'}`;
        url += fileManager.buildExtraParams(this.searchType, this.isAdminRole ? this.userFilter : '');
        return url;
    },

    /** 把 /api/manage/list 的响应转成表格行（保留已有勾选状态） */
    buildRowsFromResponse(data) {
        const selectedKeys = new Set(
            this.tableData.filter((item) => item.selected)
                .map((item) => `${item.isFolder ? 'folder' : 'file'}:${item.name}`)
        );
        const folderStatsMap = data.directoryStats || {};
        /*
         * v3.0.0：「共享」标识 —— 后端 sharedFolders 给出「可查看的共享目录全集」
         * （我共享出去的 + 共享给我的）；目录本身与其下任意层级子目录都算共享范围，
         * 因此这里按前缀匹配给每个目录卡片打标（共享者与被共享者都能看到）。
         */
        const sharedFolders = Array.isArray(data.sharedFolders) ? data.sharedFolders : [];
        // v3.0.0（R12）：目录属性里改过的「目录名称」（path → 名称）
        const folderNames = data.folderDisplayNames && typeof data.folderDisplayNames === 'object'
            ? data.folderDisplayNames
            : {};
        /*
         * v3.0.0（R12，需求 44）：把本页拿到的自定义目录名缓存下来 ——
         * 目录导航（当前路径链 / 全局树）与卡片共用同一份映射，
         * 这样「文件夹属性改名」在页面上任何位置都是新名字。
         */
        this.folderNameMap = { ...(this.folderNameMap || {}), ...folderNames };
        const sharedOf = (path) => sharedFolders.find(
            (s) => s && s.path && (path === s.path || path.startsWith(`${s.path}/`))
        );
        const folderItems = (this.recursiveSearchResults ? [] : (data.directories || [])).map((folder) => {
            const sharedHit = sharedOf(folder);
            const folderPerm = sharedHit ? (sharedHit.mine ? 'edit' : (sharedHit.sharedPerm || 'edit')) : '';
            // v3.0.0（R12）：只读共享目录不可选中 —— 防止刷新后沿用旧的勾选状态
            const folderReadonly = !!(sharedHit && !sharedHit.mine && folderPerm === 'readonly');
            return {
                name: folder,
                isFolder: true,
                selected: !folderReadonly && selectedKeys.has(`folder:${folder}`),
                shared: !!sharedHit,
                sharedOwner: sharedHit?.owner || '',
                // v3.0.0（R5）：mine = 我共享出去的（提示「你的共享文件」），否则是别人共享给我的
                sharedSelf: !!sharedHit?.mine,
                // v3.0.0（R12）：目录也要带共享权限 —— 否则「只读」共享目录仍可选中 / 打开属性
                sharedPerm: folderPerm,
                // v3.0.0（R12）：目录属性里的自定义名称（空 = 用路径末段）
                displayName: folderNames[folder] || '',
                metadata: { FileName: folderNames[folder] || folder.split('/').pop(), folderStats: folderStatsMap[folder] || null }
            };
        });
        const fileItems = (data.files || []).map((file) => {
            // v3.0.0（R12）：只读共享文件不可选中（刷新后同样清零，避免旧勾选残留）
            const fileReadonly = !!(file.shared && !file.sharedSelf && file.sharedPerm === 'readonly');
            return {
            name: file.name,
            isFolder: false,
            selected: !fileReadonly && selectedKeys.has(`file:${file.name}`),
            metadata: file.metadata,
            /*
             * v3.0.0（R7）：「共享」标识必须跟着文件行走。
             * 原实现只挑 name / isFolder / selected / metadata 四个字段，
             * 后端给文件算好的 shared / sharedOwner / sharedSelf 全被丢掉 ——
             * 于是「共享」标识只出现在目录卡片上（发起方看得到），
             * 接收方进到共享目录里看文件时反而没有任何标识。
             */
            shared: !!file.shared,
            sharedOwner: file.sharedOwner || '',
            sharedSelf: !!file.sharedSelf,
            /*
             * v3.0.0（R12）：sharedPerm 同样必须透传！
             * 详情页「只读共享 → 顶部按钮全部隐藏」的判定依赖 f.sharedPerm，
             * 这里漏挑字段会让判定恒为 false，只读共享文件的编辑/重命名等按钮照旧显示。
             */
            sharedPerm: file.sharedPerm || '',
            instanceId: file.instanceId || '',
            folder: file.folder || ''
            };
        });
        return { folderItems, fileItems };
    },

    /**
     * 加载列表窗口
     * @param {number|null} page     指定页码（整页替换）
     * @param {boolean} append       在窗口尾部追加下一页
     * @param {boolean} prepend      在窗口头部补载上一页（保持滚动位置）
     */
    async loadListWindow({ page = null, append = false, prepend = false, force = false } = {}) {
        if (this.trashMode) {
            /*
             * v3.0.0（R12）：回收站走自己的服务端分页 ——
             * 翻页 = 拉对应 page，加载更多 = 拉下一页并追加，
             * 刷新（无参）= 重拉当前页。
             */
            if (append) {
                await this.enterTrashMode(true, this.currentPage + 1, true);
            } else if (page !== null) {
                await this.enterTrashMode(true, page);
            } else {
                await this.enterTrashMode(true, this.currentPage || 1);
            }
            return;
        }
        /*
         * v3.0.0：force = 顶栏「刷新」专用 ——
         * 以前这里一句 `if (this.listLoading) return` 会把刷新请求静默吞掉
         * （某次请求中断 / 组件切换后标记卡在 true），表现为「点刷新没反应、只能整页刷新」。
         * 刷新时强制进入，且请求带 cache:'no-store' 绕过浏览器 HTTP 缓存。
         */
        if (this.listLoading && !force) return;
        const size = this.pageSize;
        let start = 0;
        if (page !== null) start = Math.max(0, (page - 1) * size);
        else if (append) start = this.fileWindowStart + this.fileWindowCount;
        else if (prepend) start = Math.max(0, this.fileWindowStart - size);

        this.listLoading = true;
        if (!append && !prepend) this.loading = true;
        const beforeTop = prepend ? this.currentScrollTop() : 0;
        const beforeHeight = prepend ? this.currentScrollHeight() : 0;
        try {
            const res = await fetchWithAuth(this.buildListUrl(start, size), {
                method: 'GET',
                // v3.0.0：管理端列表一律不吃浏览器缓存，确保「刷新」拿到刚上传的文件
                cache: 'no-store'
            });
            if (!res.ok) throw new Error(res.status === 401 ? 'Unauthorized' : 'Request failed');
            const data = await res.json();
            const { folderItems, fileItems } = this.buildRowsFromResponse(data);

            this.directories = Array.isArray(data.directories) ? data.directories : [];
            // v3.0.0：记录本次成功加载的时间（页面重新可见时用它判断是否超过 5 分钟）
            this.lastListLoadedAt = Date.now();
            this.listTotal = Number(data.totalCount || 0);
            this.directFileCount = Number(data.directFileCount || 0);
            this.directFolderCount = Number(data.directFolderCount || 0);
            this.updateStats(this.listTotal, true);

            if (append) {
                this.tableData = [...this.tableData, ...fileItems];
                this.fileWindowCount += fileItems.length;
            } else if (prepend) {
                const next = [...this.tableData];
                next.splice(this.folderRowCount, 0, ...fileItems);
                this.tableData = next;
                this.fileWindowStart = start;
                this.fileWindowCount += fileItems.length;
            } else {
                this.tableData = [...folderItems, ...fileItems];
                this.fileWindowStart = start;
                this.fileWindowCount = fileItems.length;
                this.currentPage = page || 1;
            }

            if (prepend) await this.restoreScrollAfterPrepend(beforeTop, beforeHeight);
        } catch (error) {
            if (error.message !== 'Unauthorized') {
                console.error('Error fetching file list:', error);
                this.$message.error(this.$t('dashboard.fetchFileListFailed'));
            }
        } finally {
            this.listLoading = false;
            this.loading = false;
        }
    },

    /** 当前页面滚动位置 / 文档高度（补载上一页后用来还原滚动，避免列表跳一下） */
    currentScrollTop() {
        const scroller = document.scrollingElement || document.documentElement;
        return Math.max(window.scrollY || 0, scroller?.scrollTop || 0, document.body?.scrollTop || 0);
    },
    currentScrollHeight() {
        return Math.max(
            document.documentElement?.scrollHeight || 0,
            document.body?.scrollHeight || 0
        );
    },
    async restoreScrollAfterPrepend(beforeTop, beforeHeight) {
        await this.$nextTick();
        const delta = this.currentScrollHeight() - beforeHeight;
        if (delta <= 0) return;
        const targets = new Set([document.scrollingElement, document.documentElement, document.body].filter(Boolean));
        targets.forEach((el) => {
            el.scrollTop = Math.max(0, beforeTop) + delta;
        });
    },

    // 兼容旧调用：读取当前页数据（整页替换）
    async fetchFileList() {
        await this.loadListWindow({ page: this.currentPage || 1 });
    },

    // 刷新文件列表（回收站模式下走回收站接口）
    async refreshFileList() {
        if (this.trashMode) {
            // v3.0.0（R12）：回收站刷新保持当前页码（服务端分页后按页重拉）
            await this.enterTrashMode(true, this.currentPage || 1);
            return;
        }
        this.refreshLoading = true;
        try {
            /*
             * v3.0.0 修复「刷新按钮加载不出最新文件」：
             *   ① 先清掉可能卡住的 listLoading 标记（旧实现会在这里被静默 return）；
             *   ② force 进入 + cache:'no-store'，强制向服务端要最新列表；
             *   ③ 顺带刷新「目录导航」的候选目录，新目录也能立刻出现。
             */
            this.listLoading = false;
            await this.loadListWindow({ page: 1, force: true });
            this.loadAllFolders().catch(() => undefined);
        } finally {
            this.refreshLoading = false;
        }
    },

    // 刷新本地文件列表（变更后重新拉当前页）
    async refreshLocalFileList() {
        this.refreshLoading = true;
        try {
            await this.loadListWindow({ page: this.currentPage || 1 });
        } finally {
            this.refreshLoading = false;
        }
    },

    /**
     * v3.0.0：加载更多 —— 把下一页追加到当前列表（不翻页、不改当前页码）。
     * 与滚动哨兵共用这一个函数；没有更多时直接返回。
     * @param {boolean} auto 由 IntersectionObserver 自动触发（不弹提示）
     */
    async loadMoreData(auto = false) {
        if (!this.hasMoreRows || this.listLoading) return;
        const beforeCount = this.tableData.length;
        await this.loadListWindow({ append: true });
        const added = Math.max(0, this.tableData.length - beforeCount);
        if (!auto && added === 0) this.$message.info(this.$t('dashboard.loadMoreFailed'));
    },

    /** v3.0.0：向上滚到顶时补载上一页（结果 unshift 到列表头，滚动位置不跳） */
    async loadPreviousPage() {
        if (this.fileWindowStart <= 0 || this.listLoading) return;
        await this.loadListWindow({ prepend: true });
    },

    /** 翻页：用该页数据整页替换列表 */
    handlePageChange(page) {
        if (page === this.currentPage && this.tableData.length > 0) return;
        this.loadListWindow({ page });
    },

    /** v3.0.0：滚动哨兵（底部追加 / 顶部补载） */
    setupListObservers() {
        if (typeof IntersectionObserver === 'undefined') return;
        this.teardownListObservers();
        const options = { root: null, rootMargin: '160px 0px', threshold: 0 };
        /*
         * v3.0.0：底部哨兵的「滚动到底自动追加」已按需求移除 ——
         * 拉到底部也不会自动加载，「加载更多」按钮必须手动点击，点一次加载一页，
         * 不点击就永远不加载；翻页按钮（el-pagination）不受影响，照常整页替换。
         * v3.0.0（R9）：顶部哨兵的「往上滚自动补载前面的页」同样移除 ——
         * 翻到非第一页后往回滚动时不再自动加载前三页 / 上一页，加载一律只认「加载更多」按钮
         * （loadPreviousPage 函数保留但不再有自动触发入口）。
         */
    },
    teardownListObservers() {
        if (this.bottomObserver) {
            this.bottomObserver.disconnect();
            this.bottomObserver = null;
        }
        if (this.topObserver) {
            this.topObserver.disconnect();
            this.topObserver = null;
        }
    },

    /* ==========================================================================
     * v3.0.0 多实例
     * ========================================================================== */

    /** GET /api/instances —— 当前用户相关实例（默认实例不在列表里） */
    async fetchInstances() {
        try {
            const res = await fetchWithAuth('/api/instances', { method: 'GET' });
            if (!res.ok) return;
            const list = await res.json();
            const items = Array.isArray(list) ? list : [];
            // v3.0.0：按创建序号 index（1-based）升序；缺失时回落到创建时间
            this.instances = items.slice().sort((a, b) => {
                const ia = Number(a?.index) || 0;
                const ib = Number(b?.index) || 0;
                if (ia !== ib) return ia - ib;
                const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return ta - tb;
            });
            // 本地缓存的实例已被删除时回落到默认实例
            if (this.instanceId && !this.instances.some((i) => String(i.id) === String(this.instanceId))) {
                this.applyInstance('');
            }
        } catch (e) {
            this.instances = [];
        }
    },

    /** v3.0.0：实例序号（后端 index 为 1-based；缺省按列表顺序） */
    instanceSeqOf(ins) {
        const idx = Number(ins?.index);
        if (Number.isFinite(idx) && idx > 0) return idx;
        const pos = this.orderedInstances.findIndex((i) => String(i.id) === String(ins?.id));
        return pos >= 0 ? pos + 1 : 0;
    },

    /**
     * v3.0.0：打开居中的「切换实例」弹窗（入口在页面切换弹窗列表尾部）。
     * v3.0.0（R17）：页面切换已成弹窗，收起来这件事交给 DashboardTabs 通过插槽传进来的 close ——
     * 不再去 DOM 里模拟点击 / mouseleave（那套依赖已经删掉的下拉结构）。
     */
    openInstanceDialog(closeFn) {
        this.showInstanceDialog = true;
        if (typeof closeFn === 'function') closeFn();
    },
    /** v3.0.0（R17）：页面切换弹窗里的「切换实例」条目 —— 先收起页面弹窗，再开实例弹窗 */
    openInstanceFromPageSwitch(closeFn) {
        this.openInstanceDialog(closeFn);
    },
    /**
     * v3.0.0：实例管理 —— 新标签打开「用户管理 · 该账户的实例管理」。
     * 说明：本工程用户编辑页的真实路由是 /customerConfig/edit/:id（:id 为账户主键），
     * 没有 /user-edit，因此这里先按当前登录名在 /api/manage/users 里定位主键再打开；
     * 定位不到时退回用户管理列表，避免打开 404 页。
     */
    async openInstanceManagement() {
        const username = this.$store.getters.sessionUser || '';
        let url = '/customerConfig';
        try {
            const res = await fetchWithAuth('/api/manage/users', { method: 'GET' });
            const list = res.ok ? await res.json() : [];
            const hit = (Array.isArray(list) ? list : []).find((u) => u && u.username === username);
            if (hit?.id) url = `/customerConfig/edit/${encodeURIComponent(hit.id)}?anchor=instances`;
        } catch (e) {
            /* 取不到主键就退回用户管理列表 */
        }
        window.open(url, '_blank', 'noopener');
    },
    /**
     * v3.0.0：弹窗里选择某个实例（切换后整体重载：清筛选 / 搜索 / 回根目录 / 重拉列表与标签）
     * v1.1.3：目标实例若启用了切换密码，先验证再切；已在本会话验证过则直接过。
     */
    async switchInstanceTo(id) {
        const next = id == null ? '' : String(id);
        const ok = await ensureInstanceUnlocked(next);
        if (!ok) return;
        this.showInstanceDialog = false;
        this.applyInstance(next);
    },

    /**
     * 切换实例：写入 localStorage → 清空筛选 / 搜索 / 回到根目录 → 重新拉列表与标签
     */
    applyInstance(nextId) {
        const next = String(nextId || '');
        if (next === this.instanceId) return;
        this.instanceId = next;
        try {
            localStorage.setItem(INSTANCE_STORAGE_KEY, next);
        } catch (e) {
            /* 忽略存储异常 */
        }
        // 整体重载
        this.tempSearch = '';
        this.search = '';
        this.searchKeywords = '';
        this.searchIncludeTags = '';
        this.searchExcludeTags = '';
        this.isSearchMode = false;
        this.tagModeActive = false;
        this.clearSelection();
        this.filters = createEmptyFilters();
        this.tagDraft = [];
        this.tagModeDraft = 'and';
        this.currentPath = '';
        this.currentPage = 1;
        this.listTotal = 0;
        this.fileWindowStart = 0;
        this.fileWindowCount = 0;
        this.directories = [];
        // v3.0.0：目录下拉的「全局」候选属于旧实例，一并清掉
        this.allFolders = [];
        this.dirScope = 'current';
        this.dirSearch = '';
        this.tableData = [];
        this.refreshFileList();
        this.loadAllTags();
    },

    /* ==========================================================================
     * v3.0.0 标签管理模式
     * ========================================================================== */

    toggleTagMode() {
        if (this.tagModeActive) {
            this.exitTagMode();
        } else {
            this.enterTagMode();
        }
    },
    enterTagMode() {
        if (this.tagModeActive) return;
        this.tagModeActive = true;
        this.clearSelection();
    },
    exitTagMode() {
        if (!this.tagModeActive) return;
        this.tagModeActive = false;
        // 标签改名 / 删除后筛选候选要同步
        this.loadAllTags();
    },
    /** 标签管理模式里改动了标签（改名 / 合并 / 删除 / 加密）→ 同步候选并重载列表 */
    handleTagModeChanged() {
        this.loadAllTags();
    },

    /* ==========================================================================
     * v3.0.0 目录属性（点文件夹名称打开）
     * ========================================================================== */

    openFolderProps(item) {
        if (!this.hasFolderPropsDialog) {
            this.$message.info(this.$t('fileManager.folderPropsUnavailable'));
            return;
        }
        const path = String(item?.name || '').replace(/\/+$/, '');
        this.folderPropsTarget = {
            path,
            name: path.split('/').filter(Boolean).pop() || path
        };
        this.showFolderProps = true;
    },
    handleFolderPropsSaved() {
        this.showFolderProps = false;
        // 目录名 / 属性变化后刷新当前列表
        this.loadListWindow({ page: this.currentPage || 1 });
    },

    /* ==========================================================================
     * v3.0.0 批量：编辑原名 / 限时 / 重定向
     * ========================================================================== */

    openBatchNameDialog() {
        if (!this.selectedFileIds.length) {
            this.$message.warning(this.$t('dashboard.selectFilesFirst'));
            return;
        }
        this.showBatchNameDialog = true;
    },
    openBatchExpiryDialog(command) {
        if (!this.selectedFileIds.length) {
            this.$message.warning(this.$t('dashboard.selectFilesFirst'));
            return;
        }
        // v3.0.0：限时 / 重定向 / 加密 三个按钮共用同一个处理页，只决定默认页签
        this.batchExpiryMode = ['redirect', 'password'].includes(command) ? command : 'expiry';
        this.showBatchExpiryDialog = true;
    },
    /** 批量接口完成后：刷新列表（原文名 / 限时 / 重定向 / 加密都会影响展示） */
    handleBatchMutated() {
        this.loadListWindow({ page: this.currentPage || 1 });
    },

    // Tag management methods
    handleTagManagement(fileId) {
        this.currentTagFile = fileId;
        this.showTagDialog = true;
    },
    handleBatchTagManagement() {
        if (this.selectedFiles.length === 0) {
            this.$message.warning(this.$t('dashboard.selectFilesFirst'));
            return;
        }
        this.showBatchTagDialog = true;
    },
    handleTagsUpdated(tags) {
        this.handleBatchTagsUpdated([{ fileId: this.currentTagFile, tags, saved: true }]);
    },
    handleBatchTagsUpdated(results) {
        const updates = new Map(results.filter(result => result.saved).map(result => [result.fileId, result.tags]));
        for (const file of this.tableData) {
            if (updates.has(file.name)) file.metadata = { ...file.metadata, Tags: updates.get(file.name) };
        }
        if (this.detailFile && updates.has(this.detailFile.name)) {
            this.detailFile.metadata = { ...this.detailFile.metadata, Tags: updates.get(this.detailFile.name) };
        }
        const cached = fileManager.getLocalFileList();
        for (const file of cached.files || []) {
            if (updates.has(file.name)) file.metadata = { ...file.metadata, Tags: updates.get(file.name) };
        }
        fileManager.updateFileListCache(cached);
    },
    handleMetadataUpdated(fileId, updatedMetadata) {
        // 更新 tableData 中对应文件的 metadata
        const fileIndex = this.tableData.findIndex(f => f.name === fileId);
        if (fileIndex !== -1) {
            this.tableData[fileIndex].metadata = { ...this.tableData[fileIndex].metadata, ...updatedMetadata };
        }
        // 如果 detailFile 正在显示该文件，同步更新 detailFile
        if (this.detailFile && this.detailFile.name === fileId) {
            this.detailFile.metadata = { ...this.detailFile.metadata, ...updatedMetadata };
        }
    },
    handleFileRenamed(oldFileId, newFileId, updatedMetadata) {
        // 更新 tableData 中对应文件的 name（File_ID）和 metadata
        const fileIndex = this.tableData.findIndex(f => f.name === oldFileId);
        if (fileIndex !== -1) {
            this.tableData[fileIndex].name = newFileId;
            this.tableData[fileIndex].metadata = { ...this.tableData[fileIndex].metadata, ...updatedMetadata };
        }
        // 更新 detailFile 引用并关闭/重新打开详情弹窗以刷新链接
        if (this.detailFile && this.detailFile.name === oldFileId) {
            this.detailFile.name = newFileId;
            this.detailFile.metadata = { ...this.detailFile.metadata, ...updatedMetadata };
            // 关闭详情弹窗，然后在下一个 tick 重新打开以刷新所有链接
            this.showdetailDialog = false;
            this.$nextTick(() => {
                this.showdetailDialog = true;
            });
        }
    },
    // 生成单个文件链接
    generateFileLink(key, metadata) {
        const isExternal = metadata?.Channel === 'External';
        const ext = this.fileExt(metadata || key);
        const baseUrl = this.withExt(isExternal ? metadata?.ExternalLink : `${this.rootUrl}${key}`, ext);
        const fileName = metadata?.FileName || key;
        
        switch (this.defaultUrlFormat) {
            case 'originUrl':
                return baseUrl;
            case 'mdUrl':
                return `![${fileName}](${baseUrl})`;
            case 'htmlUrl':
                return `<img src="${baseUrl}" alt="${fileName}">`;
            case 'bbUrl':
                return `[img]${baseUrl}[/img]`;
            default:
                return baseUrl;
        }
    },
    // 复制文件夹中所有文件的链接
    async handleFolderCopy(folderName) {
        // 显示加载状态
        const loading = this.$loading({
            lock: true,
            text: this.$t('dashboard.fetchingFileList')
        });
        
        try {
            // 调用 list API 递归获取文件夹内所有文件
            const response = await fetchWithAuth(
                `/api/manage/list?dir=${encodeURIComponent(folderName)}&recursive=true&count=-1&instanceId=${encodeURIComponent(this.instanceId || '')}`,
                { method: 'GET' }
            );
            
            const data = await response.json();
            loading.close();
            
            if (!data.files || data.files.length === 0) {
                this.$message.warning(this.$t('dashboard.folderEmptyNoLinks'));
                return;
            }
            
            // 根据当前链接格式生成所有文件链接
            const links = data.files.map(file => {
                return this.generateFileLink(file.name, file.metadata);
            }).filter(link => link);
            
            if (links.length === 0) {
                this.$message.warning(this.$t('dashboard.noLinksAvailable'));
                return;
            }
            
            // 复制到剪贴板
            const text = links.join('\n');
            const ok = await copyText(text);
            if (ok) {
                this.$message.success(this.$t('dashboard.copiedFileLinks', { count: links.length }));
            } else {
                this.$message.error(this.$t('dashboard.copyFolderLinksFailed'));
            }
        } catch (error) {
            loading.close();
            console.error('Copy folder links failed:', error);
            this.$message.error(this.$t('dashboard.copyFolderLinksFailed'));
        }
    },
},
mounted() {
    // 文件列表缓存按账户隔离：切换账户（例如同一浏览器先管理员后普通用户）时
    // 先丢弃上一个账户的缓存，避免刷新瞬间闪现非本人文件。
    fileManager.setCacheOwner(this.$store.getters.sessionUser || '');
    // 初始化背景图
    this.initializeBackground('adminBkImg', '.container', false, true);
    this.updateResponsivePageSize();
    window.addEventListener('resize', this.updateResponsivePageSize);
    // v2.8.5：滚动（含列表内部滚动，capture 捕获）时收起悬停预览浮层
    window.addEventListener('scroll', this.closeHoverPreview, true);
    // v3.0.0（R4）：移动端第二行工具栏吸顶状态（背景随吸顶态切换）
    window.addEventListener('scroll', this.handleBreadcrumbScroll, { passive: true, capture: true });
    // v3.0.0（R4/R5）：顶栏显隐切换后立即重算吸顶位置（保证第二行与顶栏同进同出、不滞后一帧）
    window.addEventListener('gohub:header-toggle', this.handleHeaderToggle);
    this.$nextTick(this.updateBreadcrumbStuck);

    /*
     * 其他页面通过 URL query / sessionStorage 指定进入本页时的初始视图：
     *   ?tag=… / dashboardInitialTag    —— 文件详情里的「文件标签」（新标签页打开走 query）
     *   ?folder=… / dashboardInitialFolder —— 系统状态「最近上传」的分类列、文件详情里的「文件分类」
     * 标签优先：带标签进来时回到根目录，避免当前分类里恰好没有该标签的文件导致空列表。
     */
    const queryTag = this.$route?.query?.tag;
    const queryFolder = this.$route?.query?.folder;
    const initialTag = queryTag ? String(queryTag) : sessionStorage.getItem('dashboardInitialTag');
    if (initialTag) {
        if (queryTag) {
            // 用过即清（replace，避免刷新时重复带上 query）
            this.$router.replace({ path: '/dashboard' }).catch(() => {});
        } else {
            sessionStorage.removeItem('dashboardInitialTag');
            sessionStorage.removeItem('dashboardInitialFolder');
        }
        this.currentPath = '';
        this.filters.tagNames = [initialTag];
        this.filters.tagMode = 'and';
        this.tagDraft = [initialTag];
        this.tagModeDraft = 'and';
    } else if (queryFolder !== undefined && queryFolder !== null) {
        // 文件详情「文件分类」新标签页跳转（?folder=…）
        const folder = String(queryFolder);
        if (queryFolder !== '') this.$router.replace({ path: '/dashboard' }).catch(() => {});
        this.currentPath = folder.replace(/\/+$/, '') ? folder.replace(/\/+$/, '') + '/' : '';
    } else {
        const initialFolder = sessionStorage.getItem('dashboardInitialFolder');
        if (initialFolder) {
            sessionStorage.removeItem('dashboardInitialFolder');
            this.currentPath = initialFolder.replace(/\/+$/, '') ? initialFolder.replace(/\/+$/, '') + '/' : '';
        } else {
            // v2.7.0：目录记忆 —— 无显式跳转参数时，恢复上次停留的目录
            // （例如在 2026/10 下开过历史记录页/其它页面，回到文件管理仍停在 2026/10）
            const savedPath = sessionStorage.getItem('dashboardCurrentPath');
            if (savedPath) {
                this.currentPath = savedPath;
            }
        }
    }

    this.loading = true;
    // 路由守卫已通过 /api/auth/sessionCheck 验证认证状态
    this.showLogoutButton = this.$store.state.adminLoggedIn;
    // 首次加载时刷新文件列表
    this.refreshFileList()
        .then(() => {
            // 获取所有渠道名称
            return this.extractChannelNames();
        })
        .catch((err) => {
            if (err.message !== 'Unauthorized') {
                this.$message.error(this.$t('dashboard.syncDataError'));
            }
        })
        .finally(() => {
            this.loading = false;
        });
    
    // 读取自定义链接设置项
    this.customUrlPrefix = this.adminUrlSettings.customUrlPrefix;
    this.useCustomUrl = this.adminUrlSettings.useCustomUrl;

    // 恢复视图模式偏好
    const savedViewMode = localStorage.getItem('viewMode');
    if (savedViewMode === 'card' || savedViewMode === 'list') {
        this.viewMode = savedViewMode;
    }

    // 上传用户筛选下拉（仅管理员）
    this.fetchUserOptions();

    // v3.0.0：实例列表（只有默认实例时不显示下拉框）
    this.fetchInstances();

    /*
     * v3.0.0：移动端返回键接管（进入子目录后按返回 = 回上一级目录）。
     * 触屏判定用 matchMedia('(hover:none)')，桌面端完全不启用。
     */
    this.isTouchNav = this.isTouchViewport();
    if (this.isTouchNav) {
        this.__popStateHandler = this.handleMobilePopState.bind(this);
        window.addEventListener('popstate', this.__popStateHandler);
        this.setupBodyMutationWatch();
    }

    // v3.0.0：滚动哨兵（底部追加下一页 / 顶部补载上一页）
    this.$nextTick(() => this.setupListObservers());
},
beforeUnmount() {
    this.cancelSearchIconPress();
    // v1.0.2：离开页面时把「文件详情」这一层从浮层栈摘掉，避免残留导致返回键空关
    unregisterLayer('file-detail');
    this.clearDirHoverTimer();
    this.teardownListObservers();
    window.removeEventListener('resize', this.updateResponsivePageSize);
    window.removeEventListener('scroll', this.closeHoverPreview, true);
    // v3.0.0（R4）：移除第二行工具栏吸顶状态监听
    window.removeEventListener('scroll', this.handleBreadcrumbScroll, true);
    window.removeEventListener('gohub:header-toggle', this.handleHeaderToggle);
    if (this.breadcrumbStuckFrame) {
        cancelAnimationFrame(this.breadcrumbStuckFrame);
        this.breadcrumbStuckFrame = null;
    }
    // v3.0.0：移除移动端返回键（回上一级目录）监听
    if (this.__popStateHandler) {
        window.removeEventListener('popstate', this.__popStateHandler);
        this.__popStateHandler = null;
    }
    if (this.__bodyObserver) {
        this.__bodyObserver.disconnect();
        this.__bodyObserver = null;
    }
}

};
</script>

<style src="@/styles/settings-dialog.css"></style>
<style scoped src="@/styles/admin-common.css"></style>

<style scoped>
.container {
    background: var(--admin-container-bg-color);
    min-height: 100vh;
    font-family: 'Arial', sans-serif;
    color: var(--admin-container-color);
    margin: 0;
    padding: 0;
}

/* v2.8.7：筛选弹窗触发按钮（沿用 AdminHeader 的 .filter-trigger 基础样式；
   有任一筛选值时图标着主题色 + 角标提示） */
.filter-dialog-trigger {
    cursor: pointer;
    border-radius: 8px;
    transition: color 0.2s ease, background-color 0.2s ease;
}
.filter-dialog-trigger:hover .header-icon {
    color: var(--primary-color-accent, var(--el-color-primary));
}
.filter-dialog-trigger.is-active .header-icon {
    color: var(--primary-color-accent, var(--el-color-primary));
}

/*
 * v3.0.0：「标签管理 / 刷新 / 回收站 / 声音」与顶栏「筛选」按钮完全一致 ——
 * 同尺寸（--admin-header-action-size）、同内边距（0）、同圆角（8px）、
 * 同图标字号（--admin-header-action-font-size，与筛选按钮的 20px 对齐）。
 */
/* 刷新 / 回收站 / 声音 三个按钮的容器：桌面端同样保持 6px 组内间距（与 search-area 的 gap 一致） */
.dashboard-header-buttons {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
/*
 * v3.0.0：「搜索 / 筛选 / 标签管理 / 刷新 / 回收站 / 声音 / 链接格式」按钮条。
 * 桌面端 display:contents —— 按钮直接成为 .search-area 的 flex 子项，间距与其他按钮一致（6px）；
 * 移动端改为单行横向滚动（见下方断点：左侧页面切换、右侧更多菜单固定不滑）。
 */
.search-actions {
    display: contents;
}
/* v3.0.0：链接格式按钮是原生 button，与工具栏其它图标按钮同尺寸、同圆角、同悬停色 */
.link-format-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    cursor: pointer;
}
.refresh-files-btn,
.tag-mode-trigger,
.link-format-btn {
    width: var(--admin-header-action-size, 32px);
    height: var(--admin-header-action-size, 32px);
    min-width: var(--admin-header-action-size, 32px);
    padding: 0;
    margin: 0;
    border: 0 !important;
    border-radius: 8px;
    background: transparent !important;
    color: var(--admin-theme-toggle-color, var(--el-text-color-secondary));
    font-size: var(--admin-header-action-font-size, 20px);
    line-height: 1;
    box-shadow: none !important;
    transition: color 0.2s ease;
}
/* 标签管理模式按钮：激活态用主题色 + 右上角圆点提示 */
.tag-mode-trigger {
    position: relative;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* v3.0.0（R7）：字号比同排图标按钮再大一点点 */
    font-size: calc(var(--admin-header-action-font-size, 20px) + 2px) !important;
}
.tag-mode-trigger:hover .header-icon,
.tag-mode-trigger.is-active .header-icon {
    color: var(--primary-color-accent, var(--el-color-primary));
}
/* v3.0.0（R7）：提示点放大并改为橙红色 */
.tag-mode-dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ff5a2b;
    box-shadow: 0 0 0 1.5px var(--glass-bg);
    pointer-events: none;
}
/* v3.0.0：移动端「标签管理」已从更多菜单移到工具栏图标按钮，不再隐藏 */
.refresh-files-btn:hover,
.refresh-files-btn:focus,
.refresh-files-btn:focus-visible,
.tag-mode-trigger:focus,
.tag-mode-trigger:focus-visible,
.link-format-btn:hover,
.link-format-btn:focus,
.link-format-btn:focus-visible {
    border: 0 !important;
    background: transparent !important;
    color: var(--primary-color-accent, var(--el-color-primary));
    box-shadow: none !important;
    outline: none;
}
.refresh-files-btn.is-active {
    color: var(--primary-color-accent, var(--el-color-primary));
}
.refresh-files-icon {
    /* v3.0.0：跟随按钮字号（与「筛选」图标一致），不再单独写死 13px */
    font-size: 1em;
    line-height: 1;
}
/* v2.8.9：移动端搜索按钮 —— 样式与筛选按钮一致的图标触发器；PC 端不显示 */
.search-area .mobile-search-trigger {
    display: none;
    /* v3.0.0：相对定位，承载「搜索框有内容」提醒角标 */
    position: relative;
}
/* v3.0.0：搜索框存在内容时的小红点角标（仅移动端搜索按钮上显示） */
.search-area .mobile-search-dot {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--el-color-danger, #f56c6c);
    border: 1.5px solid var(--bg-color, #fff);
    pointer-events: none;
}
@media (max-width: 1023px) {
    .search-area .mobile-search-trigger {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 6px 10px;
        flex: 0 0 auto;
    }
    /* 搜索框默认收起，点「搜索」按钮才展开 */
    .search-area .search-card {
        display: none;
    }
    /*
     * v3.0.0（R5）：展开时不再挤进顶行（会把按钮条挤成两行），改为悬浮在顶栏正下方 ——
     * 顶行始终是「页面切换 + 可滑动按钮条 + 更多菜单」单行。
     */
    .search-area.mobile-search-open .search-card {
        display: flex;
        position: absolute;
        left: 6px;
        right: 6px;
        top: calc(100% + 4px);
        z-index: 5;
        flex: 0 0 auto;
        min-width: 0;
        padding: 4px 6px;
        border-radius: 12px;
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.08);
        backdrop-filter: blur(var(--glass-backdrop-blur)) saturate(1.4);
        -webkit-backdrop-filter: blur(var(--glass-backdrop-blur)) saturate(1.4);
    }
}
/* v3.0.0：移动端 / 平板（≤1024）声音切换已从更多菜单移到工具栏图标按钮，不再隐藏 */
/* 回收站模式提示条（v2.8.6：底色加深，暗色/亮色下都足够醒目） */
.trash-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    padding: 8px 14px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 500;
    color: var(--el-color-danger);
    background: color-mix(in srgb, var(--el-color-danger) 18%, var(--toolbar-button-bg-color, #fff));
    border: 1px solid color-mix(in srgb, var(--el-color-danger) 45%, transparent);
}
.trash-banner-icon {
    font-size: 13px;
}
.trash-banner-text {
    line-height: 1.4;
}
/* v1.0.3：回收站层级导航——当前目录 + 返回上一级 */
.trash-path {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 46%;
    padding: 2px 8px;
    border-radius: 999px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: color-mix(in srgb, var(--el-color-danger) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--el-color-danger) 32%, transparent);
}
.trash-path-icon {
    font-size: 12px;
    flex: none;
}
.trash-up-btn {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    font-size: 12px;
    font-weight: 600;
    color: var(--el-color-danger);
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--el-color-danger) 40%, transparent);
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.15s ease;
    flex: none;
}
.trash-up-btn:hover {
    background: color-mix(in srgb, var(--el-color-danger) 14%, transparent);
}
/* 回收站按钮：激活态高亮（v3.0.0 R7 改版）——
   日间模式下原来是「透明底 + 白图标」，在白底工具栏上几乎看不到；
   现在统一用「淡红底 + 红色图标 + 红边」表示回收站态，暗色模式下同样清晰。 */
.trash-btn.is-active {
    color: var(--el-color-danger) !important;
    background: color-mix(in srgb, var(--el-color-danger) 14%, var(--glass-bg)) !important;
    border: 1px solid color-mix(in srgb, var(--el-color-danger) 42%, transparent) !important;
    border-radius: 8px;
}
html.dark .trash-btn.is-active,
.dark .trash-btn.is-active {
    color: #ff9a9a !important;
    background: color-mix(in srgb, var(--el-color-danger) 26%, transparent) !important;
    border-color: color-mix(in srgb, var(--el-color-danger) 55%, transparent) !important;
}
/* 回收站提示点：进入回收站模式时显示在按钮右上角（橙红） */
/* v3.0.0（R8）：点用 absolute 定位，锚点是最近 positioned 祖先 ——
   按钮自身必须是 relative，否则会飘到顶栏右上角 */
.trash-btn {
    position: relative;
}
.trash-mode-dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ff5a2b;
    box-shadow: 0 0 0 1.5px var(--glass-bg);
    pointer-events: none;
}

/* v2.8.7b：声音切换按钮 —— 默认（静音）态与左侧回收站按钮默认样式完全一致；
   开启声音（is-active）时保持当前高亮不变 */
.mute-toggle-btn:not(.is-active) {
    color: var(--el-button-text-color, var(--el-text-color-regular));
    background-color: var(--el-button-bg-color, var(--el-fill-color-blank));
    border-color: var(--el-button-border-color, var(--el-border-color));
}
.mute-toggle-btn:not(.is-active):hover,
.mute-toggle-btn:not(.is-active):focus {
    color: var(--el-button-hover-text-color, var(--el-color-primary));
    background-color: var(--el-button-hover-bg-color, var(--el-color-primary-light-9));
    border-color: var(--el-button-hover-border-color, var(--el-color-primary-light-7));
    outline: none;
}

/* 标签筛选按钮：选中态高亮为蓝色 */
.tag-filter-badge {
    /* 间距交给 .search-area 的 gap，多个 margin 叠起来会显得太散 */
    margin-left: 0;
    flex: 0 0 auto;
}
.tag-filter-btn {
    padding: 6px 10px;
}
.tag-filter-btn.is-active {
    color: #fff;
    background: var(--el-color-primary);
    border-color: var(--el-color-primary);
}
.tag-filter-icon {
    font-size: 13px;
}

/* 标签筛选弹窗 */
.tag-filter-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 12px;
}
.tag-filter-hint {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    line-height: 1.5;
}
.tag-filter-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    max-height: 46vh;
    overflow-y: auto;
    padding: 4px 2px;
    min-height: 80px;
}
.tag-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--el-border-color);
    /* 圆角按钮（原来是 999px 的胶囊/圆圈，PC 端显得过大） */
    border-radius: 8px;
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-primary);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    outline: none;
    -webkit-tap-highlight-color: transparent;
    transition: all 0.18s ease;
}
/* PC 端点击后不要出现聚焦边框 */
.tag-filter-chip:focus,
.tag-filter-chip:focus-visible {
    outline: none;
    box-shadow: none;
}
.tag-filter-chip:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
}
/* 被选中的标签：蓝色背景 */
.tag-filter-chip.is-selected {
    background: var(--el-color-primary);
    border-color: var(--el-color-primary);
    color: #fff;
}
.tag-filter-count {
    font-size: 11px;
    opacity: 0.65;
}
.tag-filter-chip.is-selected .tag-filter-count {
    opacity: 0.9;
}
.tag-filter-empty {
    width: 100%;
    padding: 24px 0;
    text-align: center;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

/* 确保el-container和el-main不裁剪内容 */
:deep(.el-container) {
    overflow: visible;
}

:deep(.el-main) {
    overflow: visible;
}

:deep(.el-dialog) {
    border-radius: 12px;
    background-color: var(--dialog-bg-color);
    box-shadow: var(--dialog-box-shadow);
}

@media (max-width: 768px) {
    .pagination-container :deep(.btn-prev),
    .pagination-container :deep(.btn-next) {
        display: none !important;
    }
}


/* v3.0.0（R4）：吸顶占位容器 —— flow-root 让内部 margin 计入自身高度，吸顶时高度可精确保留 */
.breadcrumb-sticky-wrap {
    display: flow-root;
}

/* 面包屑容器，包含路径和文件数量 */
.breadcrumb-container {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
    padding: 0 10px; /* 与 .content 的 padding 对齐 */
    margin-top: 2px; /* v3.0.0（R9）：与顶行的间隔减半（原 4px） */
    margin-bottom: 2px; /* v3.0.0（R9）：与下方文件区的间隔减半（原 4px） */
}

/*
 * v3.0.0（R5）：横向滑动区 —— 除「数量统计」徽章外的整行按钮都放在这里。
 * 桌面端 flex:1 撑满，面包屑右组用 margin-left:auto 照旧贴右，徽章作为独立兄弟贴最右侧；
 * 移动端由本层承担横向滚动，徽章留在滚动区外，因此永远固定在最右侧。
 */
.breadcrumb-scroll-area {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    flex: 1 1 auto;
    min-width: 0;
}

.breadcrumb-view-toggle {
    position: relative;
    height: 32px;
    box-sizing: border-box;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    background: var(--glass-bg);
    box-shadow: none;
    overflow: hidden;
    transition: background-color 0.2s ease, border-color 0.2s ease;
}

.breadcrumb-view-toggle:hover {
    border-color: var(--glass-border-hover);
}

/* 视图切换按钮不出现聚焦边框（outline / focus-ring） */
.breadcrumb-view-toggle:focus,
.breadcrumb-view-toggle:focus-visible,
.breadcrumb-view-toggle:active {
    outline: none;
    outline-offset: 0;
    box-shadow: none;
}
.breadcrumb-view-toggle:focus-visible {
    border-color: var(--glass-border);
}
.breadcrumb-view-toggle:where(:focus, :focus-visible)::after {
    content: none;
}

.breadcrumb-view-toggle::before {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 28px;
    height: 26px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
    transform: translateX(0);
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: none;
}

.breadcrumb-view-toggle.is-list::before {
    transform: translateX(30px);
}

/* v2.9.0：搜索结果展示切换（展示文件夹 / 全部展开）—— 与视图切换同款滑块
   v3.0.0：去掉 6px 额外左边距（第二行间距统一交给 .breadcrumb-container 的 gap） */
.search-scope-toggle {
    margin-left: 0;
}
.search-scope-toggle.is-expanded::before {
    transform: translateX(30px);
}

.breadcrumb-view-button {
    position: relative;
    z-index: 1;
    width: 28px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 5px;
    color: var(--el-text-color-secondary);
    background: transparent;
    cursor: pointer;
    transition: color 0.16s ease;
}

.breadcrumb-view-button:hover {
    color: var(--primary-color-accent);
}

.breadcrumb-view-button.is-active {
    color: var(--primary-color-accent);
    background: transparent;
    box-shadow: none;
}

.breadcrumb-view-icon {
    width: 14px;
    height: 14px;
}

.breadcrumb-sort-dropdown {
    flex: 0 0 auto;
}

.breadcrumb-sort-button {
    width: 44px;
    height: 32px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    color: var(--el-text-color-secondary);
    background: var(--glass-bg);
    box-shadow: none;
    cursor: pointer;
    transition: color 0.16s ease, background-color 0.2s ease, border-color 0.2s ease;
}

.breadcrumb-sort-button:hover,
.breadcrumb-sort-button:focus-visible {
    border-color: var(--glass-border-hover);
    color: var(--primary-color-accent);
}

.breadcrumb-sort-button:focus-visible {
    outline: none;
}

.breadcrumb-sort-icon {
    width: 30px;
    height: 18px;
    overflow: visible;
}

.sort-field-glyph,
.sort-order-glyph {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.sort-order-glyph {
    stroke-width: 1.9;
}

@media (max-width: 768px) {
    /*
     * v3.0.0（R5）：移动端第二行改为「静态常显背框」——
     * 不再随滚动吸附 / 切换 fixed，默认状态就是带玻璃背框的一行；
     * 背框宽度与第一行顶栏背框完全一致（顶栏 gutter=4px，主内容区左右 padding=10px，
     * 因此这里左右各外扩 6px → 100% - 8px，与顶栏同宽）。
     */
    .breadcrumb-container {
        flex-direction: row;
        align-items: center;
        gap: 8px;
        /* v3.0.0（R7）：上下内边距 4px、左右 3px；外层圆角收到 5px */
        padding: 4px 3px;
        /* v3.0.0（R11c）：与顶栏的间隔 8px，与下方文件区仍隔 10px
           v1.0.8：与顶行间隔收到 2px（用户要求「第二行距顶行栏 2px」） */
        margin-top: 2px;
        margin-bottom: 10px;
        margin-left: -6px;
        margin-right: -6px;
        border-radius: 5px;
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.08);
        backdrop-filter: blur(var(--glass-backdrop-blur)) saturate(1.4);
        -webkit-backdrop-filter: blur(var(--glass-backdrop-blur)) saturate(1.4);
        flex-wrap: nowrap;
        overflow: visible;
    }
    /*
     * v3.0.0（R8）：移动端第二行恢复吸附（JS 切 fixed，见 updateBreadcrumbStuck）——
     *   · is-stuck：加过渡与更明显的投影（浮在内容上方）；
     *   · is-stuck + is-header-hidden：随顶栏一起上滑滑出屏幕（top 已被 JS 同步为 0）。
     */
    .breadcrumb-container.is-stuck {
        transition: transform 0.24s ease;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.14);
    }
    .breadcrumb-container.is-stuck.is-header-hidden {
        transform: translateY(calc(-100% - 12px));
    }
    /* 除「数量统计」外的所有按钮：单行横向滑动（隐藏滚动条，手势滑动） */
    .breadcrumb-scroll-area {
        flex: 1 1 auto;
        min-width: 0;
        flex-wrap: nowrap;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-x: contain;
        scrollbar-width: none;
    }
    /* v3.0.0（R5）：原「滚动吸附 / 随顶栏隐藏」的一整套 fixed 样式已移除 ——
       第二行现在恒为静态背框，跟随页面正常滚动（详见上方 .breadcrumb-container 注释）。 */
    .breadcrumb-scroll-area::-webkit-scrollbar {
        display: none;
    }
    /* 滑动行内的按钮一律不收缩，保证横向可滑出完整内容 */
    .breadcrumb-scroll-area > * {
        flex-shrink: 0;
    }
    /* 数量统计：留在滚动区外，固定在最右侧 */
    .breadcrumb-container > .stats-badge {
        flex: 0 0 auto;
    }
    .breadcrumb-view-toggle {
        height: 28px;
        padding: 2px;
        border-radius: 8px;
    }
    .breadcrumb-view-toggle::before {
        width: 24px;
        height: 22px;
        border-radius: 6px;
    }
    .breadcrumb-view-toggle.is-list::before {
        transform: translateX(26px);
    }
    /* v3.0.0（R5）：移动端滑块步长与 is-list 一致（26px = 24px 按钮 + 2px 间隔），
       此前漏了这条覆盖，仍按桌面 30px 平移 → 选中「直接展示文件」时背框整体偏右 4px */
    .search-scope-toggle.is-expanded::before {
        transform: translateX(26px);
    }
    .breadcrumb-view-button {
        width: 24px;
        height: 22px;
        border-radius: 6px;
    }
    .breadcrumb-view-icon {
        width: 12px;
        height: 12px;
    }
    .breadcrumb-sort-button {
        width: 40px;
        height: 28px;
        border-radius: 8px;
    }
    .breadcrumb-sort-icon {
        width: 27px;
        height: 16px;
    }
}

/* 文件数量小徽章 + 历史记录按钮（右侧一组） */
.breadcrumb-right-group {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    flex-shrink: 0;
    min-width: 0;
}

/* Element Plus 默认给相邻 el-button 加 margin-left: 12px，
   会让「新建目录 → 历史记录」的间距（12+8=20）明显大于「用户选择 → 新建目录」（8）。
   组内统一交给 gap 控制，间距处处均匀。 */
.breadcrumb-right-group :deep(.el-button + .el-button),
.breadcrumb-right-group :deep(.el-select + .el-button) {
    margin-left: 0;
}

.breadcrumb-right-group .stats-badge {
    margin-left: 0;
}

/* v3.0.0（R5）：数量统计徽章已移出右侧按钮组，作为第二行容器的独立末位子项 ——
   去掉它自带的 margin-left:auto（贴右交给 .breadcrumb-scroll-area 的 flex:1 完成） */
.breadcrumb-container > .stats-badge {
    margin-left: 0;
}

.history-btn {
    /* 与左右两侧 size="small" 按钮（24px）等高，避免比旁边按钮高出一截 */
    height: 24px;
    padding: 0 10px;
    border-radius: 8px;
    font-size: 12px;
    flex-shrink: 0;
}

.history-btn-icon {
    margin-right: 4px;
    font-size: 11px;
}

/* v2.9.0：新建目录 / 登记文件 / 历史记录 —— 与「排序」按钮同款外观：
   玻璃底 + 1px 边框 + 10px 圆角 + 次要色文字，hover 时边框与文字转主题色 */
.new-folder-btn,
.history-btn {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--glass-border) !important;
    border-radius: 10px !important;
    background: var(--glass-bg) !important;
    color: var(--el-text-color-secondary) !important;
    box-shadow: none !important;
    font-size: 12px;
    transition: color 0.16s ease, border-color 0.2s ease, background-color 0.2s ease;
}
.new-folder-btn:hover,
.new-folder-btn:focus,
.history-btn:hover,
.history-btn:focus {
    border-color: var(--glass-border-hover) !important;
    background: var(--glass-bg) !important;
    color: var(--primary-color-accent, var(--el-color-primary)) !important;
}
.new-folder-btn .new-folder-icon,
.history-btn .history-btn-icon {
    font-size: 12px;
    margin-right: 5px;
}

/* v2.9.0 / v3.0.0：移动端顶行按钮（搜索 / 筛选 / 标签管理 / 刷新 / 回收站 / 声音 / 链接格式）
   全部收进 .search-actions 按钮条 —— 单行横向滚动、整组靠右、尺寸与间距统一 */
@media (max-width: 1023px) {
    /*
     * 按钮条：flex 收缩 + overflow-x:auto —— 宽度不够时可以在条内左右滑动查看，
     * 左侧「页面切换」与右侧「更多菜单」是它的兄弟节点，不参与滚动，位置固定。
     */
    .search-actions {
        order: 1;
        display: flex;
        align-items: center;
        gap: 6px;
        /* v3.0.0（R5）：撑满「页面切换」与「更多菜单」之间的空间并在此区间内横向滑动 */
        flex: 1 1 auto;
        min-width: 0;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-x: contain;
        scrollbar-width: none;
    }
    /* v3.0.0（R5）：按钮条内固定顺序 —— 搜索 → 筛选 → 标签管理 → 刷新/回收站/声音 → 链接格式
       （之前依赖 order 兜底规则，链接格式会被排到「声音切换」前面） */
    .search-actions .mobile-search-trigger { order: 1; }
    .search-actions .filter-dialog-trigger { order: 2; }
    .search-actions .tag-mode-trigger { order: 3; }
    .search-actions .dashboard-header-buttons { order: 4; }
    .search-actions .link-format-btn { order: 5; }
    .search-actions::-webkit-scrollbar {
        display: none;
    }
    .search-actions > * {
        flex: 0 0 auto;
        margin-left: 0 !important;
        margin-right: 0 !important;
    }
    .refresh-files-btn,
    .link-format-btn {
        margin: 0;
        padding: 0;
    }
    .search-area .mobile-search-trigger,
    .filter-dialog-trigger,
    .tag-mode-trigger,
    .link-format-btn,
    .refresh-files-btn {
        padding: 0 !important;
        margin: 0 !important;
        width: var(--admin-header-action-size, 32px) !important;
        height: var(--admin-header-action-size, 32px) !important;
        min-width: var(--admin-header-action-size, 32px) !important;
    }
}

@media (max-width: 768px) {
    .history-btn {
        height: 28px;
        font-size: 11px;
        padding: 0 8px;
        border-radius: var(--el-border-radius-base);
    }

    .history-btn-text {
        display: none;
    }

    .history-btn-icon {
        margin-right: 0;
    }

    /* v3.0.0（R9）：移动端「历史记录」与「数量统计」等高（28px）——
       之前基础样式 32px 只在 .new-folder-btn 上被覆盖，历史记录仍高出一截 */
    .history-btn {
        height: 28px;
        padding: 0 10px;
    }

    /* v2.7.0：文件数量统计徽章圆角/高度与「新建目录」按钮一致 */
    .stats-badge {
        height: 28px;
        padding: 0 10px;
        border-radius: var(--el-border-radius-base);
        box-sizing: border-box;
    }

    /* v3.0.0（R8）：移动端「新建目录 / 登记文件」与徽章、历史记录等高（28px），
       之前保持桌面 32px，在第二行里明显高出一截 */
    .new-folder-btn {
        height: 28px;
        padding: 0 8px;
        border-radius: var(--el-border-radius-base);
    }
    .new-folder-btn .new-folder-icon {
        margin-right: 4px;
    }
}

.stats-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    color: var(--el-text-color-secondary);
    background: var(--glass-bg);
    /* v3.0.0（R5）：高度与内边距对齐「历史记录」按钮（32px / 0 12px），两者并排同高 */
    height: 32px;
    padding: 0 12px;
    box-sizing: border-box;
    border-radius: 12px;
    border: 1px solid var(--glass-border);
    box-shadow: none;
    transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: auto;
    /* v3.0.0（R7）：现在是「一键复位」按钮 */
    cursor: pointer;
}
.stats-badge:hover {
    border-color: var(--glass-border-hover);
}
/* 有搜索 / 筛选条件时高亮，提示「点一下即可复位」 */
.stats-badge.is-active {
    color: var(--primary-color-accent, var(--el-color-primary));
    border-color: color-mix(in srgb, var(--primary-color) 45%, transparent);
    background: color-mix(in srgb, var(--primary-color) 10%, var(--glass-bg));
}
.stats-badge.is-active:hover {
    background: color-mix(in srgb, var(--primary-color) 18%, var(--glass-bg));
}

.stats-badge-icon {
    font-size: 11px;
    opacity: 0.8;
}

@media (max-width: 768px) {
    .stats-badge {
        font-size: 10px;
        /*
         * v3.0.0（R12）：之前这里只改了字号和内边距，高度仍被后面的基础样式
         * （32px）盖回去，「数量统计」比旁边的「历史记录」（28px）高出一截。
         * 这里显式定高，与移动端 .history-btn / .new-folder-btn 的 28px 对齐。
         */
        height: 28px;
        padding: 0 8px;
        box-sizing: border-box;
        border-radius: 8px;
    }
    
    .stats-badge-icon {
        font-size: 9px;
    }
    /* v3.0.0（R7）：移动端「筛选」按钮上的条件数量角标调小（原尺寸盖住了图标） */
    .filter-badge :deep(.el-badge__content) {
        height: 14px;
        min-width: 14px;
        padding: 0 3px;
        font-size: 9px;
        line-height: 14px;
        border-radius: 7px;
    }
}
/* v3.0.0（R7）：移动端搜索框展开时，第二行工具栏整行下移，给悬浮的搜索框让出位置 */
@media (max-width: 1023px) {
    .breadcrumb-sticky-wrap.is-search-open {
        padding-top: 46px;
    }
}
/* v3.0.0（R7）：目录导航悬停展开的包裹层 —— 保持原布局（不改变第二行间距） */
.breadcrumb-dir-wrap {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
}


/* 搜索区域样式（包含搜索框和筛选按钮） */
.search-area {
    min-width: 0;
    display: flex;
    align-items: center;
    /* 工具栏按钮间距：原 8px + 各按钮 margin-left 会叠成 16px，收紧到 6px */
    gap: 6px;
}
/* v2.8.5：搜索区拉伸只在手机/平板竖屏生效（≤1023）；平板横屏（1024 起）与 PC 一致 */
@media (max-width: 1023px) {
    .search-area {
        width: 100%;
        gap: 6px;
    }
}

/* 搜索卡片样式 */
.search-icon-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-touch-callout: none;
    outline: none;
    visibility: hidden;
    pointer-events: none;
}

.search-icon-trigger:focus-visible {
    outline: 2px solid var(--primary-color-accent);
    outline-offset: 3px;
    border-radius: 3px;
}

.search-card:focus-within .search-icon-trigger,
.search-card.is-settings-open .search-icon-trigger {
    visibility: visible;
    pointer-events: auto;
}

/* 一键清空按钮：仅在搜索框有内容时显示，位于搜索按钮左侧 */
.search-clear-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    margin-right: 2px;
    border: none;
    background: transparent;
    color: var(--el-text-color-placeholder);
    font: inherit;
    cursor: pointer;
    pointer-events: auto;
    outline: none;
    touch-action: manipulation;
    transition: color 0.2s ease;
}

.search-clear-trigger:hover {
    color: var(--el-text-color-regular);
}

.search-clear-trigger:focus-visible {
    outline: 2px solid var(--primary-color-accent);
    outline-offset: 2px;
    border-radius: 3px;
}

.search-clear-icon {
    font-size: 12px;
}

.search-result-menu {
    min-width: 200px;
}

.search-result-option {
    width: 100%;
    font-family: inherit;
    text-align: left;
}

.search-result-settings-title {
    padding: 6px 12px;
    margin-bottom: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
}

.search-result-option-icon {
    width: 16px;
    margin-right: 8px;
    flex-shrink: 0;
}

.search-result-option-check {
    margin-left: auto;
    padding-left: 12px;
    color: var(--primary-color-accent);
}

.search-card {
    display: flex;
    align-items: center;
    min-width: 0;
}
.search-card :deep(.el-input) {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
}
.search-card :deep(.el-input__wrapper) {
    min-width: 0;
    padding: 0 14px;
    border-radius: 20px;
    background: var(--glass-bg);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
}
/* 搜索范围下拉（已嵌入 el-input 的 #prefix 插槽）：
   - EP 默认给 .el-input__prefix 加了 pointer-events:none，嵌进去的下拉点不动，这里放开；
   - 下拉自身的底色/描边去掉，只留文字与箭头，视觉上与输入框合成一个整体。 */
.search-card :deep(.el-input__prefix),
.search-card :deep(.el-input__prefix-inner) {
    pointer-events: auto;
}
.search-type-select {
    width: 74px;
    flex: 0 0 auto;
    margin-right: 2px;
}
.user-filter-select {
    width: 110px;
    flex: 0 0 auto;
}
.search-type-select :deep(.el-select__wrapper),
.user-filter-select :deep(.el-select__wrapper) {
    min-height: 26px;
    padding: 0 10px;
}
/* 嵌在搜索框内的下拉：透明、无描边，只作为「范围」选择区 */
.search-card :deep(.el-input__prefix .el-select__wrapper) {
    padding: 0 4px 0 0;
    background: transparent;
    box-shadow: none;
    font-size: 14px;
    font-weight: 500;
    color: var(--el-text-color-regular);
}
.search-card :deep(.el-input__prefix .el-select__wrapper.is-hovering),
.search-card :deep(.el-input__prefix .el-select__wrapper.is-focused) {
    background: transparent;
    box-shadow: none;
}
.search-card :deep(.el-input__prefix .el-select__wrapper.is-focused)
    :deep(.el-select__selected-item) {
    color: var(--primary-color-accent);
}
/* 范围与输入内容之间的细分隔线 */
.search-scope-sep {
    display: inline-block;
    width: 1px;
    height: 16px;
    margin-right: 8px;
    background: var(--el-border-color);
    opacity: 0.7;
}
.search-type-select :deep(.el-select__selected-item),
.user-filter-select :deep(.el-select__selected-item) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.search-card :deep(.el-input__inner) {
    width: 240px;
    height: 40px;
    font-size: 1.2em;
    min-width: 0;
    border: none;
    transition: width 0.25s ease;
    background: none;
}

.search-card :deep(.el-input__inner::placeholder) {
    color: var(--el-text-color-placeholder);
    font-style: italic;
    font-weight: 400;
    font-size: 14px;
    opacity: 0.6;
    letter-spacing: 0.5px;
    transition: all 0.3s ease;
}

.search-card :deep(.el-input__inner:focus::placeholder) {
    opacity: 0.4;
    transform: translateX(5px);
}
@media (max-width: 768px) {
    .search-card :deep(.el-input__wrapper) {
        padding: 0 12px;
    }

    .search-card {
        flex: 1;
    }

    .search-card :deep(.el-input__inner) {
        width: 100%;
        height: 32px;
        font-size: 1em;
    }
}
.search-card:focus-within :deep(.el-input__inner),
.search-card.is-settings-open :deep(.el-input__inner) {
    width: 350px;
}
@media (max-width: 768px) {
    .search-card:focus-within :deep(.el-input__inner),
    .search-card.is-settings-open :deep(.el-input__inner) {
        width: 100%;
    }
}
@media (prefers-reduced-motion: reduce) {
    .search-card :deep(.el-input__inner),
    .search-card :deep(.el-input__inner::placeholder) {
        transition: none;
    }
}
.search-icon {
    cursor: pointer;
    color: var(--admin-container-color);
    transition: all 0.3s ease;
    font-size: 1.3em;
    opacity: 0;
    transform: scale(0.8);
    pointer-events: none;
}
.search-card:focus-within .search-icon,
.search-card.is-settings-open .search-icon {
    opacity: 1;
    transform: scale(1);
    pointer-events: auto;
}
.search-icon-trigger:hover .search-icon {
    color: var(--primary-color-accent);
    transform: scale(1.2);
}
.search-card :deep(.el-input__suffix) {
    display: flex;
    align-items: center;
    right: 10px;
}

/* 主容器样式 */
.main-container {
    display: flex;
    flex-direction: column;
    padding: 20px 60px;
    min-height: calc(100vh - 80px);
    transition: padding-bottom 0.24s ease;
}

.main-container.has-batch-toolbar {
    padding-bottom: 72px;
}

@media (max-width: 768px) {
    .main-container {
        margin-top: 0;
        padding: 8px 10px 16px;
    }
    .main-container.has-batch-toolbar {
        padding-bottom: 86px;
    }
}

.content {
    display: grid;
    /* v2.5.0：卡片改为历史记录封面样式 —— 每行 8 个 × 每页 3 行（pageSize=24） */
    grid-template-columns: repeat(8, 1fr);
    grid-template-rows: none;
    gap: 16px;
    padding: 10px;
    padding-bottom: 0px;
    flex-grow: 1;
    min-height: 80vh;
    align-content: start;
}

.content.is-drag-selecting,
.list-view.is-drag-selecting {
    cursor: crosshair;
}

.content.is-drag-selecting :deep(.file-card:hover),
.content.is-drag-selecting :deep(.folder-card:hover),
.content.is-drag-selecting :deep(.img-card:hover) {
    transform: none;
}

.content.is-drag-selecting :deep(.file-card:hover .image-preview),
.content.is-drag-selecting :deep(.img-card:hover .image-preview),
.content.is-drag-selecting :deep(.img-card:hover .video-preview),
.content.is-drag-selecting :deep(.img-card:hover .file-icon),
.content.is-drag-selecting :deep(.img-card:hover .folder-icon-svg) {
    transform: none;
}

.content.is-drag-selecting :deep(.image-preview:hover) {
    opacity: 1;
}

.content.is-drag-selecting :deep(.action-btn:hover) {
    transform: none;
    background: rgba(255, 255, 255, 0.15);
}

.list-view.is-drag-selecting :deep(.list-item:hover) {
    background: transparent;
}

.list-view.is-drag-selecting :deep(.list-action-btn:hover) {
    color: var(--el-text-color-regular);
    background: var(--el-fill-color);
}

.list-view.is-drag-selecting :deep(.list-action-danger:hover) {
    background: var(--el-fill-color);
}

/* 空状态样式 */
.empty-state {
    grid-column: 1 / -1;
    grid-row: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    color: var(--admin-container-color);
    opacity: 0.6;
}

.empty-icon {
    font-size: 64px;
    margin-bottom: 20px;
    color: var(--admin-container-color);
    opacity: 0.3;
}

.empty-text {
    font-size: 18px;
    font-weight: 500;
    margin: 0 0 8px 0;
}

.empty-hint {
    font-size: 14px;
    margin: 0;
    opacity: 0.7;
}

.list-empty {
    padding: 80px 20px;
}

/* 移动端卡片视图 */
@media (max-width: 768px) {
    .content {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-template-rows: none;
        gap: 8px;
        margin-top: 15px;
        padding: 0;
        flex-grow: 0;
        min-height: auto;
        align-content: start;
        align-items: start;
    }
}

/* 平板端卡片视图：按可用宽度递减列数（桌面档 8 列 × 3 行 = 24） */
@media (min-width: 1024px) and (max-width: 1199px) {
    .content {
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 14px;
    }
}

@media (min-width: 769px) and (max-width: 1023px) {
    .content {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
    }
}

/* v2.8.2 #A1：平板竖屏每行 3 个 —— 与历史记录页对齐；下限放宽到 600px
   （部分安卓平板竖屏 CSS 视口宽 640~700，原 700/769 下限盖不住仍显示 2 列） */
@media (min-width: 600px) and (max-width: 1023px) and (orientation: portrait) {
    .content {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}

/* 平板端页面内边距收敛（桌面档保持 20px 60px 不变） */
@media (min-width: 769px) and (max-width: 1199px) {
    .main-container {
        padding: 16px 24px;
    }
}

/* 列表视图样式 —— v2.5.0：改为「历史记录列表」的圆角卡片行（无外框容器、无表头） */
.list-view {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 15px;
    overflow-x: auto;
    overflow-y: visible;
}

.question-icon {
    margin: 0 3px;
}

/* v3.0.0（R9）：桌面端面包屑已删除（并入目录导航按钮），相关样式一并移除 */

/* 移动端目录触发按钮 */
.mobile-directory-trigger {
    display: none;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    height: 28px;
    box-sizing: border-box;
    gap: 6px;
    padding: 0 10px;
    background: var(--glass-bg);
    border-radius: 8px;
    border: 1px solid var(--glass-border);
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease;
}
.mobile-directory-trigger:active {
    border-color: var(--glass-border-hover);
}

.breadcrumb-view-toggle,
.breadcrumb,
.stats-badge,
.refresh-btn,
.mobile-directory-trigger {
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
}

.mobile-directory-icon {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--primary-color-accent);
}

.mobile-directory-path {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    color: var(--el-text-color-primary);
    max-width: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.mobile-directory-arrow {
    flex: 0 0 auto;
    font-size: 8px;
    color: var(--el-text-color-secondary);
}

/* 桌面端显示面包屑，隐藏移动端触发器 */
.desktop-only {
    display: block;
}

@media (max-width: 768px) {
    .mobile-directory-trigger {
        display: flex;
        /* v2.8.7b：禁止被同行按钮挤压（flex-shrink:0），配合容器横向滑动；
           overflow:hidden + path ellipsis 保证内容超宽时只裁文字，图标 / 背景框不错位 */
        flex: 0 0 auto;
        max-width: 40vw;
        min-width: 0;
        overflow: hidden;
    }
    
    .desktop-only {
        display: none !important;
    }
    
    .breadcrumb-container {
        /* v3.0.0（R7）：内边距由上方 768px 块统一控制（4px 3px），此处不再覆盖 */
        margin-left: 0;
        width: 100%;
        box-sizing: border-box;
        /* v2.8.7：移动端改单行横向滑动（上面的 .breadcrumb-container 已设 nowrap + overflow-x），
           不再整体换行 —— 塞不下的部分左右滑出查看 */
        flex-wrap: nowrap;
        gap: 8px;
    }

    /* 右侧按钮组：跟随单行滑动，不再换行（v3.0.0：组内间距与外层 gap 一致 = 8px） */
    .breadcrumb-right-group {
        gap: 8px;
        flex-wrap: nowrap;
        justify-content: flex-start;
    }

    /* 「新建目录」在窄屏只留图标，省下横向空间 */
    .new-folder-btn {
        height: 28px;
        min-width: 28px;
        width: 28px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
    }

    .new-folder-text {
        display: none;
    }

    /* 移动端只显示一个「＋」图标（folder-plus 未注册字体图标，此前会显示为空白） */
    .new-folder-icon {
        margin-right: 0;
        font-size: 13px;
    }
}

/* 框选选区矩形覆盖层 */
.drag-select-overlay {
    position: fixed;
    background: rgba(24, 144, 255, 0.1);
    border: 1px solid rgba(24, 144, 255, 0.6);
    pointer-events: none;
    z-index: 9999;
    border-radius: 2px;
}


.sort-dropdown-menu {
    min-width: 205px;
}

.sort-order-wrapper {
    padding: 0 12px;
    text-align: center;
}

.sort-divider {
    margin: 8px 0 !important;
}

.sort-dropdown-menu :deep(.el-dropdown-menu__item) {
    justify-content: space-between;
}

.sort-dropdown-menu :deep(.el-dropdown-menu__item.is-selected) {
    color: var(--primary-color-accent);
}

.sort-field-check {
    width: 12px;
    margin-left: 16px;
}


/* ============================================================================
 * v3.0.0 工具栏 / 第二行 / 目录下拉 / 实例下拉 / 滚动哨兵
 * ========================================================================= */

/* A2/A4：第二行（全选、视图切换、展示方式、目录、排序）按钮间距统一、圆角统一（6px） */
.breadcrumb-container {
    gap: 8px;
}
.breadcrumb-view-toggle,
.breadcrumb-sort-button,
.breadcrumb-dir-button {
    border-radius: 6px;
}
.breadcrumb-view-button {
    border-radius: 4px;
}
.breadcrumb-view-toggle::before {
    border-radius: 4px;
}
.mobile-directory-trigger {
    border-radius: 6px;
}
/* 同一行右侧的「新建目录 / 登记文件 / 历史记录 / 面包屑 / 数量徽章」圆角一并收到 6px */
.breadcrumb-container .breadcrumb,
.breadcrumb-container .new-folder-btn,
.breadcrumb-container .record-file-btn,
.breadcrumb-container .history-btn,
.breadcrumb-container .stats-badge {
    border-radius: 6px !important;
}

/* A1：移动端「新建目录 / 登记文件 / 历史记录」图标水平垂直居中 */
@media (max-width: 768px) {
    .breadcrumb-right-group .new-folder-btn,
    .breadcrumb-right-group .record-file-btn,
    .breadcrumb-right-group .history-btn {
        width: 28px;
        min-width: 28px;
        height: 28px;
        padding: 0;
        margin: 0;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        border-radius: 6px;
    }
    .breadcrumb-right-group .new-folder-btn :deep(span),
    .breadcrumb-right-group .record-file-btn :deep(span),
    .breadcrumb-right-group .history-btn :deep(span) {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0;
        margin: 0;
        padding: 0;
        line-height: 1;
        width: 1em;
        height: 1em;
    }
    /* 关键：盖上前面「.new-folder-btn .new-folder-icon { margin-right: 5px }」的更高优先级，
       否则图标会被右边距挤出中心 */
    .breadcrumb-right-group .new-folder-btn .new-folder-icon,
    .breadcrumb-right-group .record-file-btn .new-folder-icon,
    .breadcrumb-right-group .history-btn .history-btn-icon {
        margin: 0;
        padding: 0;
        width: 1em;
        height: 1em;
        font-size: 13px;
        line-height: 1;
        display: inline-block;
    }

    /*
     * v3.0.0（第三轮）：移动端「新建目录 / 登记文件 / 历史记录」改为纯图标按钮。
     * 上面那条 :deep(span) 的 display:inline-flex 优先级（3 个类）高于前面的
     * .new-folder-text / .history-btn-text（1 个类）的 display:none，
     * 结果文字没被真正隐藏 —— 按钮内部还占着 11×11 的空白块，图标也不居中。
     * 这里在同层级用 !important 明确关掉文字。
     */
    .breadcrumb-right-group .new-folder-btn .new-folder-text,
    .breadcrumb-right-group .record-file-btn .new-folder-text,
    .breadcrumb-right-group .history-btn .history-btn-text {
        display: none !important;
    }
}

/* A6：目录导航下拉（与「排序」按钮同款：玻璃底 + 1px 边框 + 6px 圆角 + 次要色）
   v3.0.0（R8）：桌面端也显示 —— 之前只有 ≤768px 才 display:block，
   导致「悬停展开目录树下拉」在桌面端完全不出现（遗留问题根因）。 */
.breadcrumb-dir-dropdown {
    display: block;
    flex: 0 0 auto;
}
.breadcrumb-dir-button {
    height: 32px;
    max-width: 42vw;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    border: 1px solid var(--glass-border);
    color: var(--el-text-color-secondary);
    background: var(--glass-bg);
    box-shadow: none;
    cursor: pointer;
    font-size: 12px;
    transition: color 0.16s ease, background-color 0.2s ease, border-color 0.2s ease;
}
.breadcrumb-dir-button:hover,
.breadcrumb-dir-button:focus-visible {
    border-color: var(--glass-border-hover);
    color: var(--primary-color-accent);
    outline: none;
}
.breadcrumb-dir-icon {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--primary-color-accent);
}
.breadcrumb-dir-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
}
.breadcrumb-dir-arrow {
    flex: 0 0 auto;
    font-size: 8px;
}
.dir-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
}
.dir-item-icon {
    width: 12px;
    font-size: 11px;
    opacity: 0.7;
}
@media (max-width: 768px) {
    .breadcrumb-dir-button {
        height: 28px;
        padding: 0 8px;
    }
}

/* A3/G：实例切换弹窗（入口已收进左上角「页面切换」下拉尾部，见文末 Teleport） */
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
    width: 100%;
    box-sizing: border-box;
    padding: 9px 12px;
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.18s ease, background-color 0.18s ease;
}
.instance-switch-item:hover {
    border-color: var(--glass-border-hover);
}
.instance-switch-item.is-active {
    border-color: var(--primary-color-accent, var(--el-color-primary));
    background: color-mix(in srgb, var(--primary-color, var(--el-color-primary)) 10%, transparent);
    color: var(--primary-color-accent, var(--el-color-primary));
}
.instance-switch-icon {
    width: 12px;
    flex: 0 0 auto;
    font-size: 11px;
    opacity: 0.75;
}
.instance-switch-seq {
    flex: 0 0 auto;
    min-width: 18px;
    font-size: 11px;
    font-weight: 600;
    opacity: 0.65;
}
.instance-switch-name {
    flex: 0 0 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
}
.instance-switch-note {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    opacity: 0.55;
}
.instance-switch-check {
    width: 12px;
    flex: 0 0 auto;
    margin-left: auto;
}
.instance-switch-empty {
    padding: 16px 0;
    text-align: center;
    font-size: 12px;
    opacity: 0.6;
}
.instance-switch-footer {
    margin-top: 12px;
    text-align: right;
}
.instance-switch-manage {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--primary-color-accent, var(--el-color-primary));
    font-family: inherit;
    font-size: 12px;
    text-decoration: underline;
    cursor: pointer;
}

/* E：标签管理模式下的空态 / 列表区高度对齐 */
.tag-mode-active .main-container {
    justify-content: flex-start;
}

/* D：滚动哨兵（不可见、不占位，仅用于触发 IntersectionObserver） */
.list-sentinel {
    width: 100%;
    height: 1px;
    flex: 0 0 auto;
    pointer-events: none;
}

/* A11：「加载更多」上的剩余条数 */
.load-more-count {
    margin-left: 4px;
    opacity: 0.75;
    font-size: 11px;
}

/* D23：目录导航下拉的「当前 / 全局」切换（样式与「排序」下拉顶行单选组一致） */
.dir-scope-wrapper {
    padding: 0 12px;
    text-align: center;
}
.dir-search-wrapper {
    padding: 0 12px 6px;
}
.dir-search-icon {
    width: 12px;
    opacity: 0.6;
}
.dir-empty {
    padding: 8px 16px 10px;
    font-size: 12px;
    opacity: 0.6;
    text-align: center;
}
.dir-dropdown-menu {
    max-height: 60vh;
    overflow-y: auto;
}
/* v3.0.0（R8）：悬停展开的目录树 —— 当前路径的祖先目录淡色高亮，形成「已展开路径」的视觉引导 */
.dir-dropdown-menu .el-dropdown-menu__item.is-ancestor .dir-item {
    color: var(--primary-color-accent);
    opacity: 0.75;
    font-weight: 500;
}

/*
 * v3.0.0（R6）：移动端第二行工具栏的按钮间距收紧 ——
 * 每个按钮左右外边距各减 2px，即相邻按钮间距 8px → 4px（三处 gap 统一）。
 * 必须写在 scoped 块末尾：前面的 8px 定义带 [data-v-*] 属性，特异性更高，
 * 放到下面的非 scoped 块里会被压过去（实测 gap 仍是 8px）。
 */
@media (max-width: 768px) {
    .breadcrumb-container {
        gap: 4px;
    }

    .breadcrumb-scroll-area {
        gap: 4px;
    }

    .breadcrumb-right-group {
        gap: 4px;
    }

    /*
     * v3.0.0（R11c）：第二行与顶行 / 文件区的间距 ——
     *   · 顶行：占位容器上移 20px（抵消顶栏占位高度的 +12px 余量与主区 padding-top 8px），
     *     加上第二行自身的 margin-top 8px → 与顶栏背框下沿的视觉间距恰为 8px；
     *   · 文件区：.content / .list-view 的 margin-top: 15px 归零，
     *     间距由第二行自身的 margin-bottom 10px 提供。
     */
    .breadcrumb-sticky-wrap {
        margin-top: -20px;
    }

    /*
     * v3.0.0（R14）：回收站模式下取消这 -20px ——
     * 回收站提示条（trash-banner）取代了顶行的视觉间距，再上移就会与提示条叠在一起
     * （移动端「提示区和第二行重叠」的根因）。
     */
    .trash-banner + .breadcrumb-sticky-wrap {
        margin-top: 0;
    }

    .content,
    .list-view {
        margin-top: 0;
    }

    /*
     * v3.0.0（R14）：文件加载区横向手势交给页面 JS（左右滑动切换展示模式）——
     * touch-action: pan-y 屏蔽浏览器自带的横向手势（含屏幕边缘滑动返回的伸缩动画），
     * 纵向滚动照常。与灯箱里 .mv-stage 的处理同源。
     */
    .content,
    .list-view {
        touch-action: pan-y;
    }
}
</style>

<style>
/*
 * ============================================================================
 * v3.0.0：本页对共享顶栏组件（AdminHeader / DashboardTabs）的「限定作用域」增强
 * ----------------------------------------------------------------------------
 * 这些 DOM 属于共享组件，本页不修改它们；所有规则都挂在 `.dashboard-page-v3`
 * （本页根节点上的标记类）之下，离开本页后选择器不再命中。
 * ============================================================================
 */

/*
 * A2：桌面端顶栏 9 个按钮（筛选 / 标签管理 / 刷新 / 回收站 / 声音 / 链接格式 / 夜间 / 语言 / 退出）
 * 统一为同一套尺寸（--admin-header-action-size 32px）与同一套间距（6px）——
 * 工具栏与右侧工具组之间的 16px 也一并收成 6px，让「声音 → 链接格式 → 夜间」连续同距。
 */
.dashboard-page-v3 .admin-header-content .admin-header-tools {
    gap: 6px;
}

/*
 * v3.0.0（R11b）：页面回滚、顶栏与第二行进入「吸附态」时，两行的玻璃透明效果全部去掉 ——
 * 背景改为完全不透明（不透明色贴近常态玻璃的观感），并关闭背景模糊，
 * 避免下方文件卡片/文字从背框里透出来。滚回顶部复位后自动恢复玻璃质感。
 * 桌面 / 平板（>768px）不吸附，is-toolbar-stuck 不会出现，样式不受影响。
 */
.dashboard-page-v3.is-toolbar-stuck .admin-header-content::before,
.dashboard-page-v3.is-toolbar-stuck .breadcrumb-container {
    background: var(--toolbar-solid-bg, #FAFAFB);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
}

@media (max-width: 1023px) {
    /* 移动端：左侧「页面切换」固定，中间按钮条横向滑动，右侧「更多菜单」固定 */
    .dashboard-page-v3 .admin-header-content > .tabs {
        margin-right: 0;
    }
    .dashboard-page-v3 .admin-header-content .search-actions .mobile-search-trigger {
        margin-left: 0 !important;
    }
    .dashboard-page-v3 .admin-header-content .search-actions .filter-trigger {
        margin-left: 0 !important;
        margin-right: 0 !important;
    }
    .dashboard-page-v3 .admin-header-content .search-actions .dashboard-header-buttons {
        margin-left: 0 !important;
        gap: 6px;
    }
}

/* D5：页面切换下拉列表尾部注入的「切换实例」条目（Teleport 进来，需在本页补样式） */
/* v3.0.0：已切换实例时，「切换实例」条目图标位置显示实例创建序号（与图标同尺寸对齐） */
.admin-page-instance-option .admin-page-instance-seq {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--el-color-primary, #409eff);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
}
/*
 * v3.0.0（R18）：页面切换恢复为下拉（原样式），「切换实例」作为下拉尾部的一条 .page-option
 * 由插槽注入 —— 它仍然位于 .dashboard-page-v3 之下，选择器前缀一并加回。
 */
.dashboard-page-v3 .page-option-sep {
    flex: 0 0 auto;
    height: 1px;
    margin: 6px 4px;
    background: var(--el-border-color-lighter);
    opacity: 0.9;
}

.dashboard-page-v3 .admin-page-instance-option {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    box-sizing: border-box;
    height: var(--page-option-height, 37px);
    padding: 0 12px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--admin-container-color);
    font-family: inherit;
    font-size: var(--page-option-font-size, 15px);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: color 0.16s ease;
}

.dashboard-page-v3 .admin-page-instance-option:hover {
    color: var(--tabs-switcher-accent-color, var(--primary-color-accent));
}

.dashboard-page-v3 .admin-page-instance-icon {
    width: 16px;
    color: var(--tabs-switcher-accent-color, var(--primary-color-accent));
}

/* 图标位显示实例创建序号时，尺寸与图标对齐 */
.admin-page-instance-option .admin-page-instance-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

@media (max-width: 768px) {
    .dashboard-page-v3 .admin-page-instance-option {
        gap: 6px;
        padding: 0 10px;
        font-size: var(--page-option-font-size, 12px);
    }
    .dashboard-page-v3 .admin-page-instance-icon {
        width: 15px;
    }
}

/*
 * v1.1.3：原来这里用 !important 手工补一段背景板高度（多注入了一条「切换实例」+ 分隔线）。
 * 现在 DashboardTabs 自己按 --page-extra-count / --page-extra-gap 算进去了，
 * 两页（图床管理 / 笔记管理）共用同一套口径，不再需要各页各补一份。
 */

/* D6：当前不是默认实例时，在「页面切换」按钮名称后显示实例序号（②、③…） */
.dashboard-page-v3.has-instance-badge .page-option.is-current .page-switcher-title::after {
    content: var(--instance-seq, "");
    margin-left: 4px;
    font-size: 0.72em;
    font-weight: 700;
    line-height: 1;
    color: var(--tabs-switcher-accent-color, var(--primary-color-accent));
    vertical-align: 1px;
}

/*
 * v3.0.0（第三轮）：移动端「页面切换」按钮宽度本来就紧（名称还会被截成省略号），
 * 序号跟在名称后面会把按钮撑爆 / 显示不全 → 改成悬浮在按钮图标右上角的小角标，
 * 完全不占用标题文字宽度。桌面端仍保持「名称后」的写法不变。
 */
@media (max-width: 768px) {
    .dashboard-page-v3.has-instance-badge .page-option.is-current {
        position: relative;
    }

    .dashboard-page-v3.has-instance-badge .page-option.is-current .page-switcher-title::after {
        content: none;
    }

    .dashboard-page-v3.has-instance-badge .page-option.is-current::after {
        content: var(--instance-seq, "");
        position: absolute;
        z-index: 2;
        /* 图标占位：padding-left 10px + 图标宽 15px → 角标压在图标右肩上 */
        left: 15px;
        top: 1px;
        min-width: 13px;
        height: 13px;
        padding: 0 2px;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        font-size: 9px;
        font-weight: 700;
        line-height: 1;
        color: #fff;
        background: var(--tabs-switcher-accent-color, var(--primary-color-accent, #2563EB));
        box-shadow: 0 0 0 1.5px var(--tabs-switcher-current-bg, var(--toolbar-button-bg-color, #fff));
        pointer-events: none;
    }
}
</style>
