<template>
    <!--
        笔记管理（v1.2.0 首发热身：瞬间）
        ----------------------------------------------------------------------------
        v1.1.2 版式（对照需求逐条落实）：
          第一行 = 页面切换下拉（底部含「切换实例」）+ 搜索 / 标签管理 / 刷新 / 回收站 / 发布 / 更多菜单
          第二行 = 类型标签页（全部 / 瞬间 / 待办 / 导航 / 文章 / 收集）+ 媒体类型 + 排序

        几个刻意的设计：
          · 搜索在桌面端是输入框、在移动端是一个图标，点开才在下面展开一行（需求原文）；
          · 发布按钮的文案跟着「当前类型」变（发布瞬间 / 添加待办 / 添加导航 / 发布文章 / 添加收集）；
          · 标签管理不是弹窗，而是和「回收站」一样的页面模式 ——
            这样功能栏的分类切换天然可用（需求：切到哪个分类就管哪一类的标签）；
          · 移动端左右滑动内容区可循环切换类型（到头继续滑就回到另一端）。
    -->
    <div
        class="nt-page"
        ref="page"
        :class="{ 'has-instance-badge': instanceSeq > 0, 'has-page-bg': !!pageBgUrl }"
        :style="instanceBadgeStyle"
    >
        <!--
            v1.1.8：笔记页背景图（笔记设置 → 通用设置 → 笔记页背景图）。
            机制照抄「系统管理 → 网页设置 → 管理页背景图」：
              · 只在**日间模式**出现（夜间直接不渲染，暗色下壁纸基本被遮住，白加载一趟）；
              · 多张时**每次刷新随机**取一张（用 data 里的 bgSeed 做种子，同一页面停留期间不变，
                避免任何一次重渲染就换图）；
              · 用 <img> 而不是 background-image，为的是能等 @load 后再淡入 —— 图没到之前
                不盖住页面底色，不会出现「先白一下再变图」的闪动。
            整个元素 pointer-events: none，不拦任何点击。
        -->
        <img
            v-if="pageBgUrl"
            :key="pageBgUrl"
            class="nt-page-bg"
            :class="{ 'is-shown': bgShown }"
            :src="pageBgUrl"
            alt=""
            aria-hidden="true"
            decoding="async"
            @load="bgShown = true"
            @error="onPageBgError"
        />
        <!-- 第一行顶栏 -->
        <header
            ref="topbarRef"
            class="nt-topbar"
            :class="{ 'is-hidden': topbarHidden, 'is-solid': topbarSolid }"
        >
            <!--
                v1.1.3：把「左侧页面切换 + 右侧按钮组」包进 .nt-topbar-main。
                顶栏本身改成纵向排列：第一行永远是这一整行，移动端展开的搜索行是它的下一个兄弟，
                所以搜索行展开时不会参与第一行的 flex 换行计算（需求：不影响顶部行的排列结构）。
            -->
            <div class="nt-topbar-main">
                <div class="nt-topbar-left">
                    <DashboardTabs active-tab="notes">
                        <!--
                            实例切换收进「页面切换」下拉的底部 —— 与图床管理页（/dashboard）完全一致：
                            下拉尾部一条分隔线 + 一条「切换实例」，切换后按钮名称后（移动端悬浮在右上角）显示序号。
                        -->
                        <template #extra-item="{ close }">
                            <div class="page-option-sep" aria-hidden="true"></div>
                            <button
                                type="button"
                                class="page-option admin-page-instance-option"
                                @click.stop="openInstanceFromPageSwitch(close)"
                            >
                                <span v-if="instanceSeq > 0" class="admin-page-instance-seq">{{ instanceSeq }}</span>
                                <font-awesome-icon v-else icon="server" class="admin-page-instance-icon" />
                                <span class="admin-page-instance-text">{{ $t('instancePicker.title') }}</span>
                            </button>
                        </template>
                    </DashboardTabs>
                </div>

                <div ref="topbarRightRef" class="nt-topbar-right">
                    <!--
                        v1.1.3：配色按需求重排 —— 「发布」提到最前，其后才是搜索 / 标签管理 / 刷新 / 回收站，
                        最后是更多菜单。移动端这一组改成可以左右滑动（.nt-topbar-right 见样式），
                        不再换行／挤成两行。
                    -->
                    <button type="button" class="nt-publish-btn" :title="publishLabel" @click="openPublish">
                        <font-awesome-icon icon="plus" class="nt-publish-icon" />
                        <span class="nt-publish-text">{{ publishLabel }}</span>
                    </button>

                    <!-- 桌面端搜索：与图床管理页（/dashboard）同一套外观与交互 -->
                    <div v-if="!isMobile" class="nt-search-card">
                        <el-input
                            ref="searchInput"
                            v-model="search"
                            size="small"
                            :placeholder="$t('notes.searchPlaceholder')"
                            enterkeyhint="search"
                            @keyup.enter="reload"
                            @clear="reload"
                        >
                            <template #prefix>
                                <!-- 搜索范围：直接嵌在输入框起始位置，与输入框合成一个整体 -->
                                <el-select
                                    v-model="searchType"
                                    size="small"
                                    class="nt-search-type"
                                    popper-class="compact-select-popper"
                                    @change="reload"
                                >
                                    <el-option
                                        v-for="opt in searchTypeOptions"
                                        :key="opt.value"
                                        :label="opt.label"
                                        :value="opt.value"
                                    />
                                </el-select>
                                <span class="nt-search-sep" aria-hidden="true"></span>
                            </template>
                            <template #suffix>
                                <button
                                    v-if="search.length > 0"
                                    type="button"
                                    class="nt-search-clear"
                                    :aria-label="$t('dashboard.clearSearch')"
                                    :title="$t('dashboard.clearSearch')"
                                    @mousedown.prevent
                                    @click.stop="clearSearch"
                                >
                                    <font-awesome-icon icon="times" />
                                </button>
                                <button
                                    type="button"
                                    class="nt-search-trigger"
                                    :aria-label="$t('notes.searchPlaceholder')"
                                    :title="$t('notes.searchPlaceholder')"
                                    @mousedown.prevent
                                    @click="reload"
                                >
                                    <font-awesome-icon icon="search" class="nt-search-icon" />
                                </button>
                            </template>
                        </el-input>
                    </div>
                    <!-- 移动端：图标 → 点开在下面展开一行搜索框 -->
                    <button
                        v-else
                        type="button"
                        class="nt-icon-btn"
                        :class="{ 'is-on': mobileSearchOpen }"
                        :title="$t('notes.searchPlaceholder')"
                        @click="toggleMobileSearch"
                    >
                        <font-awesome-icon icon="search" />
                    </button>

                    <button
                        type="button"
                        class="nt-icon-btn"
                        :class="{ 'is-on': tagMode }"
                        :title="$t('notes.tagAdmin')"
                        @click="toggleTagMode"
                    >
                        <font-awesome-icon icon="tags" />
                    </button>
                    <button type="button" class="nt-icon-btn" :title="$t('notes.refresh')" @click="refreshList">
                        <font-awesome-icon icon="sync" :class="{ 'fa-spin': loading }" />
                    </button>
                    <button
                        type="button"
                        class="nt-icon-btn"
                        :class="{ 'is-on': trashMode }"
                        :title="$t('notes.trash')"
                        @click="toggleTrash"
                    >
                        <font-awesome-icon icon="trash-alt" />
                    </button>

                    <!--
                        更多菜单（v1.1.3）：配色模式切换提到「我的账户」前面，
                        其余顺序不变：配色 / 我的账户 / 系统管理 / 笔记设置 / 退出登录。
                    -->
                    <el-dropdown
                        ref="moreDropdown"
                        trigger="click"
                        placement="bottom-end"
                        popper-class="nt-more-popper"
                        @command="onMoreCommand"
                        @visible-change="onMoreVisibleChange"
                    >
                        <button type="button" class="nt-icon-btn" :title="$t('notes.more')" :aria-label="$t('notes.more')">
                            <font-awesome-icon icon="ellipsis-v" />
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item command="theme">
                                    <font-awesome-icon :icon="themeIcon" class="nt-menu-icon" />{{ themeText }}
                                </el-dropdown-item>
                                <el-dropdown-item command="account">
                                    <font-awesome-icon icon="user" class="nt-menu-icon" />{{ $t('dashboard.myAccount') }}
                                </el-dropdown-item>
                                <el-dropdown-item v-if="isAdmin" command="system">
                                    <font-awesome-icon icon="cogs" class="nt-menu-icon" />{{ $t('dashboard.systemManage') }}
                                </el-dropdown-item>
                                <!-- v1.1.2.1：笔记设置（按用户保存），放在「退出登录」上一行 -->
                                <el-dropdown-item command="noteSettings">
                                    <font-awesome-icon icon="sliders-h" class="nt-menu-icon" />{{ $t('notes.settings') }}
                                </el-dropdown-item>
                                <el-dropdown-item command="logout" divided>
                                    <font-awesome-icon icon="sign-out-alt" class="nt-menu-icon" />{{ $t('dashboard.logout') }}
                                </el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </div>
            </div>

            <!-- 移动端展开的搜索行（再点一次搜索图标：清空 + 收起） -->
            <!--
                移动端展开的搜索行（再点一次搜索图标：清空 + 收起）
                v1.1.3：结构与桌面端完全一致 —— 搜索类目嵌在输入框起始位置 + 细分隔线 +
                尾部「清空 / 搜索」两个按钮。之前这里只有一个光秃秃的输入框，
                手上没法选范围，只能回桌面端切；现在两端共用 .nt-search-card 这一套样式。
            -->
            <div v-if="isMobile && mobileSearchOpen" class="nt-msearch">
                <div class="nt-search-card">
                    <el-input
                        ref="mobileSearchInput"
                        v-model="search"
                        size="small"
                        enterkeyhint="search"
                        :placeholder="$t('notes.searchPlaceholder')"
                        @keyup.enter="reload"
                        @clear="reload"
                    >
                        <template #prefix>
                            <!-- 搜索范围：编辑的搜索框里也要能切类目 -->
                            <el-select
                                v-model="searchType"
                                size="small"
                                class="nt-search-type"
                                popper-class="compact-select-popper"
                                @change="reload"
                            >
                                <el-option
                                    v-for="opt in searchTypeOptions"
                                    :key="opt.value"
                                    :label="opt.label"
                                    :value="opt.value"
                                />
                            </el-select>
                            <span class="nt-search-sep" aria-hidden="true"></span>
                        </template>
                        <template #suffix>
                            <button
                                v-if="search.length > 0"
                                type="button"
                                class="nt-search-clear"
                                :aria-label="$t('dashboard.clearSearch')"
                                :title="$t('dashboard.clearSearch')"
                                @mousedown.prevent
                                @click.stop="clearSearch"
                            >
                                <font-awesome-icon icon="times" />
                            </button>
                            <button
                                type="button"
                                class="nt-search-trigger"
                                :aria-label="$t('notes.searchPlaceholder')"
                                :title="$t('notes.searchPlaceholder')"
                                @mousedown.prevent
                                @click="reload"
                            >
                                <font-awesome-icon icon="search" class="nt-search-icon" />
                            </button>
                        </template>
                    </el-input>
                </div>
            </div>
        </header>

        <!-- 第二行工具栏 -->
        <div ref="toolbarRef" class="nt-toolbar" :class="{ 'is-hidden': topbarHidden, 'is-solid': topbarSolid }">
            <div class="nt-types" role="tablist">
                <button
                    v-for="t in typeTabs"
                    :key="t.value"
                    type="button"
                    role="tab"
                    class="nt-type"
                    :class="{ 'is-active': kind === t.value }"
                    :aria-selected="kind === t.value"
                    @click="switchKind(t.value)"
                >{{ $t(t.label) }}</button>
            </div>
            <div class="nt-tools">
                <el-select
                    ref="mediaSelect"
                    v-model="mediaKind"
                    class="nt-media"
                    size="small"
                    @change="reload"
                    @visible-change="(v) => onSelectVisible('media', v)"
                >
                    <!--
                        v1.1.3：值从空串改成 'all'。Element Plus 把 '' 当成「没选」，
                        校验 / 占位符逻辑会显示出「请选择」而不是「全部类型」。
                    -->
                    <el-option :label="$t('notes.mediaAll')" value="all" />
                    <el-option :label="$t('notes.mediaText')" value="text" />
                    <el-option :label="$t('notes.mediaImage')" value="image" />
                    <el-option :label="$t('notes.mediaVideo')" value="video" />
                    <el-option :label="$t('notes.mediaAudio')" value="audio" />
                    <el-option :label="$t('notes.mediaMixed')" value="mixed" />
                </el-select>
                <el-select
                    ref="sortSelect"
                    v-model="sortValue"
                    class="nt-sort"
                    size="small"
                    @change="reload"
                    @visible-change="(v) => onSelectVisible('sort', v)"
                >
                    <el-option v-for="s in sortOptions" :key="s.value" :label="$t(s.label)" :value="s.value" />
                </el-select>
                <!-- 标签筛选态：让用户一眼看出「现在列表是按标签过滤的」，并给一个快捷清除 -->
                <button v-if="tagId && !tagMode" type="button" class="nt-filter-chip" @click="clearTagFilter">
                    <font-awesome-icon icon="tag" class="nt-filter-icon" />#{{ tagName }}
                    <font-awesome-icon icon="times" class="nt-filter-close" />
                </button>
            </div>
        </div>

        <!-- 内容区（移动端在这里左右滑动切类型） -->
        <!--
            v1.1.3：touchmove 不能再是 passive —— 判明是「横滑切类型」之后要主动 preventDefault，
            否则浏览器会一边执行边缘返回、一边画那层拉动伸缩的预览动画（需求点名的现象）。
            touchstart / touchend 保持 passive（不需要阻止默认行为，被动监听更顺）。
        -->
        <main
            class="nt-main"
            @touchstart.passive="onMainTouchStart"
            @touchmove="onMainTouchMove"
            @touchend.passive="onMainTouchEnd"
            @touchcancel.passive="onMainTouchEnd"
        >
            <!-- 标签管理模式：内容区整体换成标签管理（分类栏照旧可用） -->
            <NoteTagPanel
                v-if="tagMode"
                ref="tagPanel"
                :instance-id="instanceId"
                :kind="kind"
                @changed="reload"
            />

            <template v-else>
                <div v-if="loading && !list.length" class="nt-loading">
                    <font-awesome-icon icon="spinner" spin />
                    <span>{{ $t('notes.loading') }}</span>
                </div>

                <div v-else-if="!list.length" class="nt-empty">
                    <font-awesome-icon :icon="emptyIcon" class="nt-empty-icon" />
                    <p class="nt-empty-title">{{ emptyTitle }}</p>
                    <p class="nt-empty-tip">{{ emptyTip }}</p>
                    <button v-if="canPublishCurrent" type="button" class="nt-empty-btn" @click="openPublish">
                        {{ publishLabel }}
                    </button>
                </div>

                <div v-else class="nt-list">
                    <MomentCard
                        v-for="n in list"
                        :key="n.id"
                        :ref="`card-${n.id}`"
                        :note="n"
                        @preview="(i) => openPreview(n, i)"
                        @edit="openEdit"
                        @delete="confirmDelete"
                        @restore="confirmRestore"
                        @purge="confirmPurge"
                        @tag-click="onTagClick"
                        @edit-time="openTimeEditor"
                    />
                </div>

                <div v-if="list.length" class="nt-more">
                    <!--
                        v1.1.7：手动模式才显示「加载更多」按钮；
                        自动模式滚到底就自己加载，这里只在请求进行中给一句轻提示，不占按钮位。
                    -->
                    <template v-if="hasMore">
                        <el-button
                            v-if="pageLoadMode === 'manual'"
                            size="small"
                            :loading="loading"
                            @click="loadMore"
                        >
                            {{ $t('notes.loadMore') }}
                        </el-button>
                        <span v-else-if="loading" class="nt-end">{{ $t('notes.loadingMore') }}</span>
                    </template>
                    <span v-else class="nt-end">{{ $t('notes.listEnd', { n: total }) }}</span>
                </div>
            </template>
        </main>

        <!-- 发布 / 编辑 -->
        <MomentPublishDialog
            v-model="publishVisible"
            :note="editing"
            :instance-id="instanceId"
            @saved="onSaved"
        />

        <!--
            v1.1.3：「全部」类型下点「发布笔记」→ 先选类型再进编辑页。
            只列出五类；还没开放的直接在按钮上标「即将开放」，点下去给明确提示，
            不做「点了没反应」或「假装能编辑」这种事。
        -->
        <el-dialog
            v-model="publishTypeVisible"
            :title="$t('notes.publishTypeTitle')"
            :width="dialogWidth"
            append-to-body
            align-center
            class="note-publish-type-dialog"
        >
            <p class="npt-tip">{{ $t('notes.publishTypeTip') }}</p>
            <div class="npt-grid">
                <button
                    v-for="t in typeTabs.filter((x) => x.value)"
                    :key="'pt-' + t.value"
                    type="button"
                    class="npt-item"
                    :class="{ 'is-disabled': t.value !== 'moment' }"
                    @click="choosePublishKind(t.value)"
                >
                    <font-awesome-icon :icon="publishKindIcon(t.value)" class="npt-icon" />
                    <span class="npt-name">{{ $t(t.label) }}</span>
                    <span v-if="t.value !== 'moment'" class="npt-soon">{{ $t('notes.typeNotReady') }}</span>
                </button>
            </div>
        </el-dialog>

        <!-- 笔记设置（v1.1.2.1）：按实例保存，改完立刻作用到列表里的附件区 -->
        <NoteSettingsDialog v-model="settingsVisible" :instance-id="instanceId" />

        <!--
            v1.1.6：修改「实际发布时间」。
            入口 = 卡片标题旁的时间（点击）。只改发布时间的展示口径，不动入库时间，
            排序（publishedAt）与「历史记录」都跟着变。
        -->
        <el-dialog
            v-model="timeEditorVisible"
            :title="$t('notes.editPublishedAt')"
            width="360px"
            append-to-body
            class="nt-time-dialog"
        >
            <!--
                v1.1.7：移动端面板居中。
                日期面板是 teleport 到 body 的 popper，默认贴着输入框往下弹，
                手机上经常被屏幕底部裁掉 —— 用 popper-class 在窄屏下改成屏幕居中的浮层。
            -->
            <el-date-picker
                v-model="timeEditorValue"
                type="datetime"
                :placeholder="$t('notes.publishedAtPlaceholder')"
                format="YYYY-MM-DD HH:mm"
                value-format="x"
                popper-class="nt-time-popper"
                style="width: 100%"
            />
            <p class="nt-time-tip">{{ $t('notes.publishedAtTip') }}</p>
            <template #footer>
                <el-button size="small" @click="timeEditorVisible = false">{{ $t('common.cancel') }}</el-button>
                <el-button size="small" type="primary" :loading="timeEditorSaving" @click="savePublishedAt">
                    {{ $t('common.save') }}
                </el-button>
            </template>
        </el-dialog>

        <!-- 附件灯箱：一屏 9 个只是列表形态，这里能翻完该瞬间的全部附件 -->
        <MediaPreviewOverlay
            v-if="previewItems.length"
            v-model="previewVisible"
            :items="previewItems"
            :start-index="previewIndex"
            :show-detail="true"
            :detail-open="detailVisible"
            @detail="openFileDetail"
            @record-detail="openFileDetail"
            @viewed="handlePreviewViewed"
            @close-detail="detailVisible = false"
        />

        <!--
            文件详情（v1.1.3：与「图床管理」页完全一致）
            ------------------------------------------------------------------
            同一个组件 FileDetailDialog，但之前只喂了 file / fileLink 两样东西：
              · 没传 urls → 原始链接 / Markdown / HTML / BBCode 全是空的；
              · fileLink 用的是灯箱当前预览地址，而不是详情页统一口径的 ?from=admin 预览地址；
              · 下载 / 删除 等动作 emit 出来没人接 → 按钮点了没反应。
            现在统一走 utils/fileDetail 的 buildFileDetail()（图床管理页用的就是它），
            并把结果里的 file / fileLink / urls 三样一起喂进去。
            标签管理 / 黑名单 / 白名单仍关闭（show-advanced=false）—— 那是文件管理页的批量能力，
            笔记页没有对应的选择上下文。
        -->
        <FileDetailDialog
            v-model="detailVisible"
            :file="detailFile"
            :file-link="detailFileLink"
            :urls="detailUrls"
            @download="onDetailDownload"
            @delete="onDetailDelete"
            @tag-management="onDetailTags"
            @block="onDetailBlock"
            @white="onDetailWhite"
            @metadata-updated="onDetailMetadata"
            @file-renamed="onDetailRenamed"
        />

        <!--
            v1.1.8（需求）：笔记里点开附件的「文件详情」，顶部要和图床管理页一样有
            「标签 / 黑名单 / 白名单」三个按钮。所以这里补上标签管理弹窗，
            三个动作的实现与图床管理页同口径（同一个接口、同样的确认文案）。
        -->
        <TagManagementDialog
            v-model="tagDialogVisible"
            :file-id="tagFileId"
            :file-metadata="tagFileMetadata"
            @tags-updated="onDetailTagsUpdated"
        />

        <!-- 实例切换（与 /dashboard 同一套交互） -->
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
                <div v-if="!instances.length" class="instance-switch-empty">
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
import fetchWithAuth from '@/utils/fetchWithAuth';
import DashboardTabs from '@/components/DashboardTabs.vue';
import MediaPreviewOverlay from '@/components/dashboard/MediaPreviewOverlay.vue';
import FileDetailDialog from '@/components/dashboard/FileDetailDialog.vue';
// v1.1.8：附件详情里的「标签」按钮需要一个标签管理弹窗（与图床管理页同一个组件）
import TagManagementDialog from '@/components/dashboard/TagManagementDialog.vue';
import MomentCard from '@/components/notes/MomentCard.vue';
import MomentPublishDialog from '@/components/notes/MomentPublishDialog.vue';
import NoteTagPanel from '@/components/notes/NoteTagPanel.vue';
import NoteSettingsDialog from '@/components/notes/NoteSettingsDialog.vue';
import { extOf, formatSize } from '@/utils/notes';
import { buildFileDetail } from '@/utils/fileDetail';
import { loadNoteSettings, applyCachedSettings, noteSettings, parsePageBg } from '@/utils/noteSettings';
import { writeThemeCookie } from '@/utils/themeCookie';
// v1.1.3：实例切换密码守卫（与图床管理页 / 首页同一份实现）
import { ensureInstanceUnlocked } from '@/utils/instanceSwitch';
import { registerLayer, unregisterLayer } from '@/utils/layerStack';
import { bindScrollDismiss } from '@/utils/scrollDismiss';
import recordBrowse from '@/utils/browseRecord';

const PAGE_SIZE = 20;
/** 桌面端：离开顶部多少像素后允许隐藏两行栏 */
const SCROLL_HIDE_PX = 60;
/** 移动端：阈值调小（需求：轻滚一点就收起两行） */
const SCROLL_HIDE_PX_MOBILE = 12;
/** 移动端触发隐藏/显示所需的最小位移（越小越灵敏） */
const SCROLL_DELTA_MOBILE = 1;
const SCROLL_DELTA_DESKTOP = 6;
/** 移动端左右滑动切类型的判定：水平位移阈值 + 与垂直分量的比例 */
const SWIPE_MIN_PX = 60;
const SWIPE_RATIO = 1.5;
/** 屏幕边缘这几十像素交给系统「返回」手势，不参与切类型 */
const SWIPE_EDGE_PX = 30;

/** 类型轮播顺序：与功能栏一致，用于左右滑动循环 */
const KIND_CYCLE = ['', 'moment', 'todo', 'nav', 'article', 'collection'];

export default {
    name: 'NotesManagePage',
    components: {
        DashboardTabs,
        MediaPreviewOverlay,
        FileDetailDialog,
        TagManagementDialog,
        MomentCard,
        MomentPublishDialog,
        NoteTagPanel,
        NoteSettingsDialog
    },
    data() {
        return {
            kind: '',
            /*
             * v1.1.8：笔记页背景图的「随机种子」。
             * 需求是「多张时每次刷新随机一张」—— 用一个 0~1 的随机数当种子，
             * 由它去换算数组下标，而不是在 computed 里直接 Math.random()：
             * computed 会在任何依赖变化时重算，直接随机会让「点一下排序」都换一张背景图。
             * 种子只在页面实例创建时取一次，刷新页面才会变。
             */
            bgSeed: Math.random(),
            /** 背景图是否已加载完（load 之后再淡入，避免先白一下再变图） */
            bgShown: false,
            // v1.1.3：'all' 而不是 ''（见模板里的注释）
            mediaKind: 'all',
            // v1.1.3：搜索范围 —— all | title | content | tag | other（与图床管理页同一套口径）
            searchType: 'all',
            // v1.1.3：「全部」类型下点发布 → 先选类型
            publishTypeVisible: false,
            // 标签筛选（点卡片上的 #标签 触发）
            tagId: '',
            tagName: '',
            search: '',
            mobileSearchOpen: false,
            // 排序：只保留第二行这一处（第一行不放排序，避免两套控件打架）
            /*
             * v1.1.8（需求）：「最新发布」要按**发布时间**降序，不再按创建时间。
             * 发布时间可以手工校正（点瞬间头部的时间改），创建时间则在库里固定、不提供修改。
             * 老数据 publishedAt 为空时后端会把它排到最后（nulls last）。
             */
            sortKey: 'publishedAt',
            sortOrder: 'desc',
            trashMode: false,
            // 标签管理模式（与回收站同一层面的页面模式）
            tagMode: false,
            instanceId: '',
            instances: [],
            showInstanceDialog: false,
            list: [],
            total: 0,
            page: 1,
            loading: false,
            publishVisible: false,
            // v1.1.2.1：笔记设置弹窗（更多菜单 → 笔记设置）
            settingsVisible: false,
            editing: null,
            previewVisible: false,
            previewItems: [],
            previewIndex: 0,
            // v1.1.6：修改发布时间的弹窗（value 用毫秒时间戳字符串，与 el-date-picker value-format="x" 对应）
            timeEditorVisible: false,
            timeEditorValue: null,
            timeEditorSaving: false,
            timeEditorNote: null,
            detailVisible: false,
            /** v1.1.8：附件详情里的标签管理弹窗 */
            tagDialogVisible: false,
            tagFileId: '',
            detailFile: null,
            detailFileLink: '',
            // v1.1.3：详情页各复制格式（原始链接 / Markdown / HTML / BBCode / TG / S3）
            detailUrls: { originUrl: '', mdUrl: '', htmlUrl: '', bbUrl: '', tgId: '', S3Location: '', S3CdnFileUrl: '' },
            topbarHidden: false,
            topbarSolid: false,
            lastScrollTop: 0,
            isMobile: typeof window !== 'undefined' ? window.innerWidth <= 768 : false,
            topRO: null,
            swipeX: null,
            swipeY: null
        };
    },
    computed: {
        typeTabs() {
            return [
                { value: '', label: 'notes.typeAll' },
                { value: 'moment', label: 'notes.typeMoment' },
                { value: 'todo', label: 'notes.typeTodo' },
                { value: 'nav', label: 'notes.typeNav' },
                { value: 'article', label: 'notes.typeArticle' },
                { value: 'collection', label: 'notes.typeCollection' }
            ];
        },
        /** 搜索范围：与图床管理页同一套交互（嵌在搜索框起始位置），选项按笔记的字段重新定 */
        searchTypeOptions() {
            return [
                { value: 'all', label: this.$t('notes.searchTypeAll') },
                { value: 'title', label: this.$t('notes.searchTypeTitle') },
                { value: 'content', label: this.$t('notes.searchTypeContent') },
                { value: 'tag', label: this.$t('notes.searchTypeTag') },
                { value: 'other', label: this.$t('notes.searchTypeOther') }
            ];
        },
        sortOptions() {
            return [
                { value: 'newest', label: 'notes.sortNewest' },
                { value: 'oldest', label: 'notes.sortOldest' },
                { value: 'updated', label: 'notes.sortUpdated' }
            ];
        },
        sortValue: {
            get() {
                return `${this.sortKey === 'updatedAt' ? 'updated' : this.sortOrder === 'asc' ? 'oldest' : 'newest'}`;
            },
            set(v) {
                if (v === 'oldest') {
                    // 最早发布 = 发布时间升序（同一口径，避免两种时间混着排）
                    this.sortKey = 'publishedAt';
                    this.sortOrder = 'asc';
                } else if (v === 'updated') {
                    this.sortKey = 'updatedAt';
                    this.sortOrder = 'desc';
                } else {
                    this.sortKey = 'publishedAt';
                    this.sortOrder = 'desc';
                }
            }
        },
        hasMore() {
            return this.list.length < this.total;
        },
        /**
         * v1.1.7：翻页方式（笔记设置 → 通用设置 → 页面加载设置）。
         * auto = 滚到底自动加载更多（默认）；manual = 只在底部显示「加载更多」按钮。
         */
        /** v1.1.8：标签弹窗要的元数据（与图床管理页同一个入参形态） */
        tagFileMetadata() {
            return (this.detailFile && this.detailFile.metadata) || {};
        },
        pageLoadMode() {
            return noteSettings.general && noteSettings.general.pageLoad === 'manual' ? 'manual' : 'auto';
        },
        /**
         * v1.1.8：当前要显示的笔记页背景图地址（空串 = 不设）。
         *   · 夜间模式一律返回空 —— 需求：背景图只在日间模式生效；
         *   · 多张时按 bgSeed 取一张，同一页面停留期间稳定不变，刷新才换。
         * 读的是模块级 reactive 的 noteSettings，设置请求回来后会自动重算并换上。
         */
        pageBgUrl() {
            if (this.$store.getters.useDarkMode) return '';
            const list = parsePageBg(noteSettings.general && noteSettings.general.pageBg);
            if (!list.length) return '';
            const i = Math.min(list.length - 1, Math.floor(this.bgSeed * list.length));
            return list[i] || '';
        },
        /** 发布按钮文案随当前类型变化（需求原文） */
        publishLabel() {
            const map = {
                // v1.1.3：「全部」下不再假装知道要发什么 —— 按钮叫「发布笔记」，点开先选类型
                '': 'notes.publishNote',
                moment: 'notes.publishMoment',
                todo: 'notes.addTodo',
                nav: 'notes.addNav',
                article: 'notes.publishArticle',
                collection: 'notes.addCollection'
            };
            return this.$t(map[this.kind] || 'notes.publishMoment');
        },
        /** 目前只有「瞬间」实装，其它类型的编辑页还没做 */
        canPublishCurrent() {
            return this.kind === '' || this.kind === 'moment';
        },
        emptyIcon() {
            if (this.trashMode) return 'trash-alt';
            if (this.kind && this.kind !== 'moment') return 'inbox';
            return 'book';
        },
        emptyTitle() {
            if (this.trashMode) return this.$t('notes.trashEmpty');
            if (this.kind && this.kind !== 'moment') return this.$t('notes.typeNotReady');
            if (this.search || (this.mediaKind && this.mediaKind !== 'all')) return this.$t('notes.noMatch');
            return this.$t('notes.emptyTitle');
        },
        emptyTip() {
            if (this.kind && this.kind !== 'moment' && !this.trashMode) return this.$t('notes.typeNotReadyTip');
            return this.$t('notes.emptyTip');
        },
        isAdmin() {
            return this.$store.getters.isAdminRole === true;
        },
        /** 当前实例的创建序号（默认实例 = 0，不显示角标） */
        instanceSeq() {
            if (!this.instanceId) return 0;
            const hit = this.instances.find((i) => String(i.id) === String(this.instanceId));
            if (!hit) return 0;
            const idx = Number(hit.index);
            if (Number.isFinite(idx) && idx > 0) return idx;
            const pos = this.instances.findIndex((i) => String(i.id) === String(this.instanceId));
            return pos >= 0 ? pos + 1 : 0;
        },
        /** 序号用带圈数字：①-⑳，超过就退回 (21) 这种写法 */
        instanceBadgeStyle() {
            const n = this.instanceSeq;
            if (!n) return null;
            const circled = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
            const text = n <= circled.length ? circled[n - 1] : `(${n})`;
            return { '--instance-seq': `"${text}"` };
        },
        themeIcon() {
            const mode = this.themeMode;
            if (mode === 'auto') return 'circle-half-stroke';
            return this.$store.getters.useDarkMode ? 'sun' : 'moon';
        },
        themeMode() {
            if (!this.$store.getters.cusDarkMode) return 'auto';
            return this.$store.getters.useDarkMode ? 'dark' : 'light';
        },
        themeText() {
            // 与顶栏更多菜单一致：显示「点了之后会切到哪个模式」
            if (this.themeMode === 'auto') return this.$t('theme.lightMode');
            if (this.themeMode === 'light') return this.$t('theme.darkMode');
            return this.$t('theme.autoMode');
        },
        dialogWidth() {
            return typeof window !== 'undefined' && window.innerWidth < 768 ? '92%' : '480px';
        }
    },
    created() {
        this.instanceId = this.readInstanceId();
        /*
         * v1.1.2.1：笔记设置（附件区大小 / 位置），按实例隔离。
         * 先同步贴 Cookie 缓存（首屏就是最终尺寸，不闪），再向服务端要最新值。
         */
        this.applyInstanceSettings();
    },
    watch: {
        /*
         * v1.1.3：合并两个 watch 块。原来这里和上面的 watch 是重复声明的两个键，
         * 后写的会把先写的整个覆盖 —— isMobile 的监听其实一直没生效，
         * 屏幕宽度变化时既没有收起移动端搜索行，也没有重新量两行栏高度。
         */
        isMobile(v) {
            if (!v) this.mobileSearchOpen = false;
            this.$nextTick(this.syncTopHeights);
        },
        /*
         * v1.1.2：灯箱 + 详情页叠加时的「逐层关闭」。
         * 灯箱打开时已往 layerStack 登记了 'media-viewer'，详情弹窗是后开的，
         * 必须也登记一层才会排在栈顶 —— 否则移动端边缘滑动会直接把灯箱关掉、
         * 详情还挂在屏幕上，与需求「先关详情、再关灯箱」相反。
         * esc:false 让 Element Plus 自己处理 Esc（它的处理更聪明：下拉展开、
         * 输入法候选未结束时只收下拉不关弹窗）。
         */
        detailVisible(v) {
            if (v) {
                registerLayer('note-file-detail', () => { this.detailVisible = false; }, { esc: false });
            } else {
                unregisterLayer('note-file-detail');
            }
        },
        /**
         * v1.1.8：背景图换了地址（设置刚加载完 / 切实例 / 换了一张）→ 先退回透明，
         * 等新图 @load 再淡入。否则 <img> 换了 src 会沿用上一张的淡入状态。
         */
        pageBgUrl() {
            this.bgShown = false;
        },
    },
    async mounted() {
        window.addEventListener('scroll', this.onPageScroll, true);
        window.addEventListener('resize', this.onWindowResize);
        this.syncTopHeights();
        // 顶栏 / 工具栏高度会随内容变化（搜索行展开、类型标签换行），用 ResizeObserver 盯着最省心
        if (typeof ResizeObserver !== 'undefined') {
            this.topRO = new ResizeObserver(() => this.syncTopHeights());
            if (this.$refs.topbarRef) this.topRO.observe(this.$refs.topbarRef);
            if (this.$refs.toolbarRef) this.topRO.observe(this.$refs.toolbarRef);
        }
        await this.loadInstances();
        await this.reload();
        this.syncTopHeights();
    },
    beforeUnmount() {
        window.removeEventListener('scroll', this.onPageScroll, true);
        window.removeEventListener('resize', this.onWindowResize);
        if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
        // 页面卸载时兜底摘掉详情层，避免残留导致下一次返回被「吃掉」
        unregisterLayer('note-file-detail');
        if (this.topRO) {
            this.topRO.disconnect();
            this.topRO = null;
        }
        this.releaseMoreDismiss();
        if (this._mediaUnbind) {
            this._mediaUnbind();
            this._mediaUnbind = null;
        }
        if (this._sortUnbind) {
            this._sortUnbind();
            this._sortUnbind = null;
        }
    },
    methods: {
        /* ── 实例 ───────────────────────────────────────────────── */
        readInstanceId() {
            try {
                return localStorage.getItem('gohub_instance_id') || '';
            } catch (e) {
                return '';
            }
        },
        async loadInstances() {
            try {
                const res = await fetchWithAuth('/api/instances');
                const data = await res.json().catch(() => []);
                this.instances = Array.isArray(data) ? data : [];
            } catch (e) {
                this.instances = [];
            }
        },
        instanceSeqOf(ins) {
            const idx = Number(ins.index);
            if (Number.isFinite(idx) && idx > 0) return idx;
            const pos = this.instances.findIndex((i) => i.id === ins.id);
            return pos >= 0 ? pos + 1 : 0;
        },
        openInstanceFromPageSwitch(closeFn) {
            this.showInstanceDialog = true;
            if (typeof closeFn === 'function') closeFn();
        },
        /** v1.1.3：目标实例启用了切换密码时，先验证再切（与图床管理页同一份守卫） */
        async switchInstanceTo(id) {
            const next = id == null ? '' : String(id);
            const ok = await ensureInstanceUnlocked(next);
            if (!ok) return;
            this.showInstanceDialog = false;
            this.instanceId = next;
            this.applyInstance();
        },
        applyInstance() {
            // 与「图床文件管理」共用同一个存储键 —— 在这里切实例，文件管理页也跟着切
            try {
                localStorage.setItem('gohub_instance_id', this.instanceId || '');
            } catch (e) {
                /* 忽略隐私模式写入失败 */
            }
            this.tagId = '';
            this.tagName = '';
            // v1.1.2.1：笔记设置按实例隔离 —— 先同步贴上新实例的缓存尺寸，再向服务端要最新值
            this.applyInstanceSettings();
            this.$message.success(this.$t('instancePicker.switchSuccess'));
            // 实例序号角标会改动按钮宽度 → 可能触发换行，量高要等两帧之后再取
            this.$nextTick(() => {
                this.syncTopHeights();
                requestAnimationFrame(() => this.syncTopHeights());
            });
            this.reload();
        },
        /**
         * 应用当前实例的笔记设置：
         *   · applyCachedSettings 是同步的，先把 Cookie 里这个实例的尺寸摆上去（首屏不闪）；
         *   · loadNoteSettings 异步拿服务端的最新值（别的设备可能改过）。
         */
        applyInstanceSettings() {
            applyCachedSettings(this.instanceId);
            loadNoteSettings(this.instanceId);
        },
        /**
         * v1.1.8：背景图加载失败 —— 静默处理，只保持透明并清掉元素。
         * 这里刻意不弹提示：背景图坏掉不影响任何功能，弹一个红条反而盖住内容；
         * 用户打开笔记设置就能看到自己填的地址，想改随时能改。
         */
        onPageBgError() {
            this.bgShown = false;
        },
        async openInstanceManagement() {
            const username = this.$store.getters.sessionUser || '';
            let url = '/customerConfig';
            try {
                const res = await fetchWithAuth('/api/manage/users', { method: 'GET' });
                const list = res.ok ? await res.json() : [];
                const hit = (Array.isArray(list) ? list : []).find((u) => u && u.username === username);
                if (hit && hit.id) url = `/customerConfig/edit/${encodeURIComponent(hit.id)}?anchor=instances`;
            } catch (e) {
                /* 取不到主键就退回用户管理列表 */
            }
            window.open(url, '_blank', 'noopener');
        },

        /* ── 顶栏动作 ───────────────────────────────────────────── */
        toggleMobileSearch() {
            this.mobileSearchOpen = !this.mobileSearchOpen;
            if (this.mobileSearchOpen) {
                // 展开：聚焦输入框，不立刻搜索（用户还没输入）
                this.$nextTick(() => {
                    const el = this.$refs.mobileSearchInput;
                    const input = el && (el.input || el.$el?.querySelector('input'));
                    if (input && typeof input.focus === 'function') input.focus();
                });
            } else {
                // 收起：清空内容并重新加载（需求：再次点击会清空搜索框内容并隐藏）
                this.search = '';
                this.reload();
            }
        },
        /** 一键清空搜索词（范围保留，用户通常还要在同一范围里再搜） */
        clearSearch() {
            this.search = '';
            this.reload();
        },
        /**
         * 更多菜单打开时挂一个滚动监听：滚动就跑（v1.1.3 需求：移动端下拉页在滚动时自动隐藏）。
         * 只监听一段很短的时间窗 —— 菜单开着的时候用户本来就该操作菜单，滚动意味着「我改主意了」。
         */
        onMoreVisibleChange(open) {
            if (open) {
                if (this._moreUnbind) return;
                this._moreUnbind = bindScrollDismiss(() => {
                    const dd = this.$refs.moreDropdown;
                    if (dd && typeof dd.handleClose === 'function') dd.handleClose();
                });
            } else {
                this.releaseMoreDismiss();
            }
        },
        releaseMoreDismiss() {
            if (this._moreUnbind) {
                this._moreUnbind();
                this._moreUnbind = null;
            }
        },
        /**
         * 第二行的两个下拉（媒体类型 / 排序）：展开后一滚动就收起。
         *
         * v1.1.4：不再走「模拟点击外部」—— Element Plus 2.4+ 的点击外判判定改成了
         * pointerdown，派发 mousedown 已经收不起来。el-select 实例上有 blur()，
         * 它走的就是「失焦即收起」的官方路径，直接调最稳。
         */
        onSelectVisible(which, open) {
            const key = `_${which}Unbind`;
            if (open) {
                if (this[key]) return;
                const refName = which === 'media' ? 'mediaSelect' : 'sortSelect';
                this[key] = bindScrollDismiss(() => {
                    const sel = this.$refs[refName];
                    if (sel && typeof sel.blur === 'function') sel.blur();
                });
            } else if (this[key]) {
                this[key]();
                this[key] = null;
            }
        },
        onMoreCommand(cmd) {
            if (cmd === 'account') {
                window.open('/customerConfig', '_blank', 'noopener');
                return;
            }
            if (cmd === 'system') {
                window.open('/systemConfig#status', '_blank', 'noopener');
                return;
            }
            // v1.1.2.1：笔记设置（按用户保存：附件区大小 / 位置）
            if (cmd === 'noteSettings') {
                this.settingsVisible = true;
                return;
            }
            if (cmd === 'logout') {
                this.logout();
                return;
            }
            if (cmd === 'theme') this.cycleTheme();
        },
        logout() {
            fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authType: 'admin' })
            }).finally(() => {
                this.$store.commit('setAdminLoggedIn', false);
                this.$router.push('/adminLogin');
            });
        },
        /** 配色模式三态循环：跟随系统 → 浅色 → 深色 → 跟随系统 */
        cycleTheme() {
            if (this.themeMode === 'auto') {
                this.$store.commit('setCusDarkMode', true);
                this.$store.commit('setUseDarkMode', false);
                writeThemeCookie('light');
            } else if (this.themeMode === 'light') {
                this.$store.commit('setCusDarkMode', true);
                this.$store.commit('setUseDarkMode', true);
                writeThemeCookie('dark');
            } else {
                this.$store.commit('setCusDarkMode', false);
                writeThemeCookie('auto');
            }
        },

        /* ── 列表 ───────────────────────────────────────────────── */
        switchKind(v) {
            if (this.kind === v) return;
            this.kind = v;
            if (this.tagMode) return; // 标签管理模式由面板自己按 kind 过滤
            this.reload();
        },
        /** 移动端左右滑动循环切换类型 */
        cycleKind(dir) {
            const cur = KIND_CYCLE.indexOf(this.kind);
            const base = cur < 0 ? 0 : cur;
            const next = (base + dir + KIND_CYCLE.length) % KIND_CYCLE.length;
            this.switchKind(KIND_CYCLE[next]);
        },
        onMainTouchStart(e) {
            this.swipeX = null;
            if (!this.isMobile) return;
            // 弹层打开时不响应（灯箱 / 详情 / 发布 / 留言 / 实例弹窗 / 笔记设置）
            if (this.previewVisible || this.publishVisible || this.showInstanceDialog || this.settingsVisible) return;
            const t = e.touches && e.touches[0];
            if (!t) return;
            const w = window.innerWidth;
            // 屏幕两端留给系统返回手势
            if (t.clientX <= SWIPE_EDGE_PX || t.clientX >= w - SWIPE_EDGE_PX) return;
            // 横向可滚动的控件（类型栏）与表单控件不参与
            const el = e.target;
            if (el && el.closest && el.closest('.nt-types, .no-hswipe-guard, input, textarea, .el-select')) return;
            this.swipeX = t.clientX;
            this.swipeY = t.clientY;
        },
        onMainTouchMove(e) {
            if (this.swipeX === null) return;
            const t = e.touches && e.touches[0];
            if (!t) return;
            const dy = Math.abs(t.clientY - this.swipeY);
            const dx = Math.abs(t.clientX - this.swipeX);
            // 明显是纵向滚动 → 直接放弃这次手势，避免滑到一半突然切了类型
            if (dy > 24 && dy > dx) {
                this.swipeX = null;
                return;
            }
            /*
             * v1.1.3：确认是横滑（横向分量明显占优）就把这次手势吃掉。
             * 不吃的话浏览器会把它当成「返回上一页」，屏幕两侧出现拉动伸缩的预览动画 ——
             * 与「左右滑动切换笔记类型」这个功能正面冲突。
             */
            if (dx >= 12 && dx > dy * SWIPE_RATIO && e.cancelable) {
                e.preventDefault();
                this.swipeBlocking = true;
            }
        },
        onMainTouchEnd(e) {
            if (this.swipeX === null) return;
            const x0 = this.swipeX;
            const y0 = this.swipeY;
            this.swipeX = null;
            const t = (e.changedTouches && e.changedTouches[0]) || null;
            if (!t) return;
            const dx = t.clientX - x0;
            const dy = t.clientY - y0;
            if (Math.abs(dx) < SWIPE_MIN_PX) return;
            if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
            // 左滑 → 下一个类型；右滑 → 上一个类型（到头/到尾都循环）
            this.cycleKind(dx < 0 ? 1 : -1);
        },
        toggleTagMode() {
            this.tagMode = !this.tagMode;
            if (this.tagMode) {
                // 标签管理和回收站是两个互斥的页面模式
                this.trashMode = false;
                this.tagId = '';
                this.tagName = '';
            }
        },
        toggleTrash() {
            this.trashMode = !this.trashMode;
            if (this.trashMode) this.tagMode = false;
            this.reload();
        },
        clearTagFilter() {
            this.tagId = '';
            this.tagName = '';
            this.page = 1;
            this.fetchList(true);
        },
        onTagClick(tag) {
            // 点标签 = 按标签筛选；再点同一个标签 = 取消筛选
            this.search = '';
            this.mediaKind = '';
            this.tagMode = false;
            if (this.tagId === tag.id) {
                this.tagId = '';
                this.tagName = '';
            } else {
                this.tagId = tag.id;
                this.tagName = tag.name;
            }
            this.page = 1;
            return this.fetchList(true);
        },
        buildQuery() {
            const qs = new URLSearchParams();
            qs.set('page', String(this.page));
            qs.set('pageSize', String(PAGE_SIZE));
            qs.set('instanceId', this.instanceId || '');
            qs.set('sort', this.sortKey);
            qs.set('order', this.sortOrder);
            if (this.kind) qs.set('kind', this.kind);
            if (this.mediaKind && this.mediaKind !== 'all') qs.set('mediaKind', this.mediaKind);
            if (this.search.trim()) {
                // 原样传：后端自己解析 #标签 / -#标签，并把剩下的词按 searchType 搜
                qs.set('search', this.search.trim());
                if (this.searchType && this.searchType !== 'all') qs.set('searchType', this.searchType);
            }
            if (this.tagId) qs.set('tagId', this.tagId);
            if (this.trashMode) qs.set('status', 'deleted');
            return qs;
        },
        reload() {
            this.page = 1;
            this.tagId = '';
            this.tagName = '';
            return this.fetchList(true);
        },
        /**
         * 「刷新」按钮（v1.1.2 修复）：
         * 旧实现直接复用 reload()，而 reload() 会顺手清掉标签筛选 —— 用户点了以为没反应
         * （筛选被悄悄重置、列表看起来"没变"）。这里改成只重拉当前条件下的第一页：
         * 清空列表、给出 loading、保留搜索/筛选/排序，行为与「刷新」两个字一致。
         */
        async refreshList() {
            if (this.tagMode) {
                // 标签管理模式下刷新交给面板自己（它有自己的刷新按钮与数据源）
                const panel = this.$refs.tagPanel;
                if (panel && typeof panel.load === 'function') return panel.load();
                return;
            }
            this.page = 1;
            this.list = [];
            this.total = 0;
            return this.fetchList(true);
        },
        loadMore() {
            if (this.loading || !this.hasMore) return;
            this.page += 1;
            return this.fetchList(false);
        },
        /**
         * v1.1.7：自动加载模式下的「滚到底就继续加载」。
         * 提前 240px 触发，滑到底时下一批已经就位，不会看到「到底停一下再出内容」。
         * 手动模式直接返回，底部只留「加载更多」按钮（原有行为）。
         */
        maybeAutoLoad() {
            if (this.pageLoadMode !== 'auto') return;
            if (this.loading || !this.hasMore || !this.list.length) return;
            const doc = document.documentElement;
            const bottom = (window.scrollY || doc.scrollTop || 0) + window.innerHeight;
            if (bottom >= doc.scrollHeight - 240) this.loadMore();
        },
        async fetchList(reset) {
            this.loading = true;
            try {
                const qs = this.buildQuery();
                const res = await fetchWithAuth(`/api/notes/list?${qs.toString()}`);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || 'load failed');
                const rows = Array.isArray(data.list) ? data.list : [];
                this.total = Number(data.total) || 0;
                if (reset) {
                    this.list = rows;
                } else {
                    this.list = this.list.concat(rows);
                }
            } catch (e) {
                this.$message.error(this.$t('notes.loadFail'));
            } finally {
                this.loading = false;
                /*
                 * v1.1.7 自动加载：首屏内容不满一屏时不会有 scroll 事件，
                 * 所以每批数据落地后主动补一次「是否到底」的判断，否则用户得先滚一下才会继续加载。
                 */
                this.$nextTick(() => this.maybeAutoLoad());
            }
        },
        /* ── 发布 / 编辑 ────────────────────────────────────────── */
        /**
         * v1.1.3：「全部」类型下按钮是「发布笔记」，点开先让用户选类型再进编辑页。
         * 选了还没开放的类型就照实提示，而不是假装能发。
         */
        openPublish() {
            if (this.kind === '') {
                this.publishTypeVisible = true;
                return;
            }
            if (!this.canPublishCurrent) {
                this.$message.warning(this.$t('notes.typeNotReadyTip'));
                return;
            }
            this.editing = null;
            this.publishVisible = true;
        },
        publishKindIcon(kind) {
            const map = {
                moment: 'bolt',
                todo: 'list',
                nav: 'compass',
                article: 'file-alt',
                collection: 'layer-group'
            };
            return map[kind] || 'note-sticky';
        },
        /** 从「发布笔记」类型选择页里选中一类 */
        choosePublishKind(k) {
            this.publishTypeVisible = false;
            if (k !== 'moment') {
                this.$message.warning(this.$t('notes.typeNotReadyTip'));
                return;
            }
            this.editing = null;
            this.publishVisible = true;
        },
        openEdit(note) {
            this.editing = note;
            this.publishVisible = true;
        },
        onSaved() {
            this.reload();
        },

        /* ── 删除 / 恢复 / 彻底删除 ─────────────────────────────── */
        async confirmDelete(note) {
            try {
                await this.$confirm(this.$t('notes.deleteConfirm'), this.$t('notes.deleteTitle'), {
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    type: 'warning'
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(`/api/notes/${encodeURIComponent(note.id)}`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('notes.deletedOk'));
                this.reload();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },
        async confirmRestore(note) {
            try {
                const res = await fetchWithAuth(`/api/notes/${encodeURIComponent(note.id)}/restore`, { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('notes.restoredOk'));
                this.reload();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },
        async confirmPurge(note) {
            try {
                await this.$confirm(this.$t('notes.purgeConfirm'), this.$t('notes.purge'), {
                    confirmButtonText: this.$t('notes.purge'),
                    cancelButtonText: this.$t('common.cancel'),
                    type: 'error'
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(`/api/notes/${encodeURIComponent(note.id)}/purge`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('notes.purgedOk'));
                this.reload();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },

        /* ── 灯箱 / 文件详情 ────────────────────────────────────── */
        /**
         * v1.1.6：点标题旁的时间 → 校正「实际发布时间」。
         * 取当前 publishedAt（没有则退回入库时间），用 el-date-picker 改完直接 PUT 回后端。
         */
        openTimeEditor(note) {
            if (!note) return;
            this.timeEditorNote = note;
            const ts = Number(note.publishedAt || note.createdAt || Date.now());
            /*
             * v1.1.6：value-format="x" 的模型值必须是**数字**。
             * 之前传 String(ts)，el-date-picker 会当成日期字符串解析 → 输入框里显示成 1797 年。
             */
            this.timeEditorValue = ts > 0 ? ts : Date.now();
            this.timeEditorVisible = true;
        },
        async savePublishedAt() {
            const note = this.timeEditorNote;
            if (!note) return;
            const ms = Number(this.timeEditorValue || 0);
            if (!Number.isFinite(ms) || ms <= 0) {
                this.$message.warning(this.$t('notes.publishedAtInvalid'));
                return;
            }
            this.timeEditorSaving = true;
            try {
                const res = await fetchWithAuth(`/api/notes/${encodeURIComponent(note.id)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    // 只送 publishedAt + instanceId，其余字段后端保持原值
                    body: JSON.stringify({ instanceId: note.instanceId || '', publishedAt: ms })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('notes.publishedAtSaved'));
                this.timeEditorVisible = false;
                this.reload();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            } finally {
                this.timeEditorSaving = false;
            }
        },
        openPreview(note, index) {
            const assets = (note.assets || []).filter(Boolean);
            if (!assets.length) return;
            this.previewItems = assets.map((a) => ({
                // key 用 File_ID（= /file/<name> 的标识），灯箱的「详情」事件带回来的就是它
                key: a.name || a.fileId,
                name: a.originalName || a.name,
                url: a.url,
                kind: a.mediaKind === 'file' ? 'other' : a.mediaKind,
                ext: extOf(a.originalName || a.name),
                sizeText: formatSize(a.size),
                user: '',
                recordId: a.fileId || ''
            }));
            this.previewIndex = Math.min(index, this.previewItems.length - 1);
            this.previewVisible = true;
        },
        /** 灯箱右上角「详情」/ 移动端下拉 → 打开文件详情（与图床文件管理页同一个弹窗） */
        /**
         * v1.1.6：附件灯箱关闭 → 记录浏览时间（历史记录页「最近浏览」用它筛）。
         * 笔记附件只带 File_ID（= /file/<name>），后端同时认 id 与 name，无需再转一次。
         */
        handlePreviewViewed(payload) {
            const ids = payload && Array.isArray(payload.ids) ? payload.ids : [];
            if (ids.length) recordBrowse(ids);
        },
        /** 把一条文件记录套进详情弹窗的三件套（file / fileLink / urls） */
        applyDetailFile(file) {
            const built = buildFileDetail(file);
            this.detailFile = built.file;
            this.detailFileLink = built.fileLink;
            this.detailUrls = built.urls;
        },
        async openFileDetail(payload) {
            const key = (payload && (payload.key || payload.name)) || '';
            if (!key) return;
            // 先按「只有文件名」把弹窗开起来（不空白等接口），元数据回来再补齐一次
            this.applyDetailFile({ name: key, metadata: {} });
            this.detailVisible = true;
            try {
                const res = await fetchWithAuth(`/api/manage/metadata/${encodeURIComponent(key)}`);
                const json = await res.json().catch(() => ({}));
                const data = (json && json.data) || {};
                if (data.metadata) this.applyDetailFile({ name: data.name || key, metadata: data.metadata });
            } catch (e) {
                /* 拿不到元数据也把弹窗开着，用户点「刷新」还能再试 */
            }
        },
        /** 详情页「下载」：与图床管理页同一口径（走对外链接，浏览器自己决定下载还是预览） */
        onDetailDownload() {
            const url = this.detailUrls && this.detailUrls.originUrl;
            if (!url) return;
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        },
        /**
         * 详情页「删除」：与图床管理页一样调用同一个删除接口。
         * 笔记这边不额外拦截 —— 附件是松散引用（note_assets 只存 files.id，不建外键），
         * 文件被删掉后列表里的那一格会自动跳过，不会把整条笔记带崩。
         */
        async onDetailDelete() {
            const key = this.detailFile && this.detailFile.name;
            if (!key) return;
            try {
                await this.$confirm(this.$t('dashboard.deleteConfirm'), this.$t('notes.deleteTitle'), {
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    type: 'warning'
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(
                    `/api/manage/delete/${encodeURIComponent(key)}?instanceId=${encodeURIComponent(this.instanceId || '')}`,
                    { method: 'GET' }
                );
                if (!res.ok) throw new Error(this.$t('common.failed'));
                this.$message.success(this.$t('dashboard.deleteSuccess'));
                this.detailVisible = false;
                this.refreshList();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },
        /* ── v1.1.8：附件详情里的「标签 / 黑名单 / 白名单」（与图床管理页同口径） ── */
        onDetailTags() {
            const key = this.detailFile && this.detailFile.name;
            if (!key) return;
            this.tagFileId = key;
            this.tagDialogVisible = true;
        },
        onDetailTagsUpdated(tags) {
            const key = this.tagFileId || (this.detailFile && this.detailFile.name);
            if (!key) return;
            // 标签变了 → 详情里的元数据与链接一起刷新（标签会进 URL 展开 / 复制内容）
            this.onDetailMetadata(key, { Tags: tags });
        },
        /** 黑名单：已在名单里再点一次 = 移出（与图床管理页的 toggle 语义一致） */
        onDetailBlock() {
            const current = String((this.detailFile && this.detailFile.metadata && this.detailFile.metadata.ListType) || 'None');
            if (current === 'Block') {
                this.patchListType('None', 'blockRemoved', 'blockFailed', 'Block');
                return;
            }
            this.$confirm(this.$t('dashboard.blockConfirm'), this.$t('dashboard.deleteConfirmTitle'), {
                confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
                cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
                type: 'warning'
            })
                .then(() => this.patchListType('Block', 'blockSuccess', 'blockFailed'))
                .catch(() => {});
        },
        /** 白名单：语义同黑名单 */
        onDetailWhite() {
            const current = String((this.detailFile && this.detailFile.metadata && this.detailFile.metadata.ListType) || 'None');
            if (current === 'White') {
                this.patchListType('None', 'whiteRemoved', 'whiteFailed', 'White');
                return;
            }
            this.$confirm(this.$t('dashboard.whiteConfirm'), this.$t('dashboard.deleteConfirmTitle'), {
                confirmButtonText: this.$t('dashboard.deleteConfirmOk'),
                cancelButtonText: this.$t('dashboard.deleteConfirmCancel'),
                type: 'warning'
            })
                .then(() => this.patchListType('White', 'whiteSuccess', 'whiteFailed'))
                .catch(() => {});
        },
        /**
         * 写 ListType（None / Block / White）。
         * 笔记页没有 tableData，改完只需要同步 detailFile，列表里的缩略图不受影响。
         */
        async patchListType(value, successKey, failedKey) {
            const key = this.detailFile && this.detailFile.name;
            if (!key) return;
            try {
                const res = await fetchWithAuth(`/api/manage/metadata/${encodeURIComponent(key)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ListType: value })
                });
                if (!res.ok) throw new Error('request failed');
                this.$message.success(this.$t(`dashboard.${successKey}`));
                this.onDetailMetadata(key, { ListType: value });
            } catch (e) {
                this.$message.error(this.$t(`dashboard.${failedKey}`));
            }
        },
        /** 详情页里改了名 / 改了元数据 → 列表里的附件信息跟着刷新 */
        onDetailRenamed() {
            this.refreshList();
        },
        onDetailMetadata(name, metadata) {
            if (!this.detailFile) return;
            // 元数据变了（改名 / 渠道 / 标签）→ urls 要跟着重算，否则复制出来的还是旧链接
            this.applyDetailFile({
                name: name || this.detailFile.name,
                metadata: { ...(this.detailFile.metadata || {}), ...(metadata || {}) }
            });
        },

        /* ── 顶栏吸顶 ───────────────────────────────────────────── */
        onPageScroll() {
            const top = window.scrollY || document.documentElement.scrollTop || 0;
            this.topbarSolid = top > 8;
            const hidePx = this.isMobile ? SCROLL_HIDE_PX_MOBILE : SCROLL_HIDE_PX;
            const delta = this.isMobile ? SCROLL_DELTA_MOBILE : SCROLL_DELTA_DESKTOP;
            if (top > hidePx && top > this.lastScrollTop + delta) {
                this.topbarHidden = true;
            } else if (top < this.lastScrollTop - delta || top < Math.min(40, hidePx)) {
                this.topbarHidden = false;
            }
            this.lastScrollTop = top;
            // v1.1.7：自动加载模式下的「滚到底继续加载」
            this.maybeAutoLoad();
        },
        /**
         * 把两行固定栏的实测高度写进 --nt-topbar-h / --nt-toolbar-h。
         * 内容区留白与第二行的 top 都取这两个值，改布局就只剩一处要维护。
         */
        /**
         * 把两行固定栏的实测高度写进 --nt-topbar-h / --nt-toolbar-h。
         *
         * v1.1.3 修复「切换实例后回滚页面，两行栏之间出现一条缝」：
         *   旧实现用 offsetHeight，它是**取整**的（60.4px → 60）。
         *   第二行的 top 取的正是这个整数，于是第二行比第一行的真实底边高 0.4px，
         *   露出底下页面背景 —— 一条发丝宽的缝。刷新后布局恰好落在整数高度上，
         *   缝又「自己好了」，这也是它只在某些时刻出现的原因。
         *   改用 getBoundingClientRect().height（带小数），并把结果保留两位小数写进 CSS 变量。
         *
         * 量高度这件事本身也有时机问题：切实例会改标题宽度、触发重新换行，
         * 所以这里一律读**当前帧布局完成之后**的值（组件内调用点都包了 nextTick）。
         */
        syncTopHeights() {
            /*
             * 不能直接用 this.$el：本组件模板的根节点前面有一段注释块，
             * Vue 3 因此把它当成 Fragment，$el 拿到的是**片段的起始注释节点** ——
             * 注释节点没有 style，下面第一个 if 就会静默 return，
             * 结果是 --nt-topbar-h / --nt-toolbar-h 从来没被写过（一直吃 60px / 44px 兜底值）。
             * 移动端搜索行一展开，顶栏从 57px 长到 95px，工具栏却还钉在 60px，
             * 类型标签行被顶栏盖住 —— 就是这里没生效导致的。
             * 固定用 ref="page" 的那个真实 div。
             */
            const root = (this.$refs && this.$refs.page) || this.$el;
            if (!root || !root.style) return;
            const measure = (el) => {
                if (!el || typeof el.getBoundingClientRect !== 'function') return 0;
                return Math.round(el.getBoundingClientRect().height * 100) / 100;
            };
            const topH = measure(this.$refs.topbarRef);
            const toolH = measure(this.$refs.toolbarRef);
            if (topH) root.style.setProperty('--nt-topbar-h', `${topH}px`);
            if (toolH) root.style.setProperty('--nt-toolbar-h', `${toolH}px`);
        },
        onWindowResize() {
            this.isMobile = window.innerWidth <= 768;
            this.syncTopHeights();
            if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
            this.resizeTimer = window.setTimeout(() => {
                // 宽度变化 → 行高与换行都会变，重新判定每张卡的「全文」按钮
                for (const key of Object.keys(this.$refs || {})) {
                    if (!key.startsWith('card-')) continue;
                    const ref = this.$refs[key];
                    const card = Array.isArray(ref) ? ref[0] : ref;
                    if (card && typeof card.measure === 'function') card.measure();
                }
            }, 200);
        }
    }
};
</script>

<style scoped>
.nt-page {
    box-sizing: border-box;
    min-height: 100vh;
    /*
     * 顶部两行都是 fixed，高度会随「搜索行展开 / 类型标签换行」变化，
     * 所以留白不写死，由 syncTopHeights() 把实测高度写进这两个自定义属性。
     */
    padding-top: calc(var(--nt-topbar-h, 60px) + var(--nt-toolbar-h, 44px) + 8px);
    background: var(--note-page-bg, transparent);
    /*
     * 全局 #app 上有一条历史遗留的 `text-align: center`（图床首页居中标题用），
     * 会被继承下来把瞬间正文也居中 —— 正文必须是左对齐，这里在页面根部复位一次。
     */
    text-align: left;
}

/* ── 笔记页背景图（v1.1.8）────────────────────────────────── */
/*
 * 为什么必须给 .nt-page 造一个层叠上下文：
 * 背景元素是 `z-index: -1`，如果页面根节点没有自己的层叠上下文，它会跑到**根上下文**的负层，
 * 被 body 的底色（日间是浅灰白）盖住 —— 图加载了却看不见，这正是「管理页背景图」最早踩过的坑。
 * isolation: isolate 让它留在 .nt-page 内部：垫在所有内容下面、页面底色上面。
 */
.nt-page.has-page-bg {
    position: relative;
    z-index: 0;
    isolation: isolate;
    background: transparent;
}

.nt-page-bg {
    position: fixed;
    inset: 0;
    z-index: -1;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    opacity: 0;
    /* 淡入慢一点（0.9s）：背景突然跳出来很扎眼 */
    transition: opacity 0.9s ease-in-out;
    /* 纯装饰层，绝不能拦住任何点击 / 滑动 */
    pointer-events: none;
    user-select: none;
}

.nt-page-bg.is-shown {
    opacity: 1;
}

/* 移动端背景层用 fixed + 100% 高，避免 iOS 地址栏收起时露出一条底边 */
@media (max-width: 768px) {
    .nt-page-bg {
        height: 100vh;
        height: 100dvh;
    }
}

/* ── 第一行 ─────────────────────────────────────────────── */
.nt-topbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 40;
    /*
     * v1.1.3：纵向排列 —— 第一行永远是「页面切换 + 按钮组」这一整行，
     * 移动端展开的搜索行是它的下一个兄弟，独立占一行。
     * 之前两行都在同一个 flex 容器里靠 flex-wrap 换行，搜索行一展开就会重算第一行的换行，
     * 按钮组被挤成两行、位置整体下移（需求点名的「影响顶部行的排列结构」）。
     */
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 8px 16px;
    background: var(--glass-bg);
    border-bottom: 1px solid var(--glass-border);
    backdrop-filter: blur(var(--glass-backdrop-blur, 10px));
    -webkit-backdrop-filter: blur(var(--glass-backdrop-blur, 10px));
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

/* 顶栏第一行：左侧页面切换 + 右侧按钮组，单行不换行 */
.nt-topbar-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
    flex-wrap: nowrap;
}

.nt-topbar.is-solid {
    background: var(--toolbar-solid-bg, #FAFAFB);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
}

.nt-topbar.is-hidden {
    transform: translateY(-100%);
}

/*
 * 第二行在第一行下面，只上移自身高度的话会停在第一行原来的位置露出来 ——
 * 必须把第一行的高度一起减掉，两行才会整体滑出屏幕。
 *
 * v1.1.2：补上 transform 过渡。之前只有第一行有 transition，
 * 移动端第二行是「瞬间跳走」，观感与第一行完全不同（需求点名的那个不对劲）。
 */
.nt-toolbar {
    position: fixed;
    top: var(--nt-topbar-h, 60px);
    left: 0;
    right: 0;
    z-index: 39;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    padding: 6px 16px 8px;
    background: var(--glass-bg);
    border-bottom: 1px solid var(--glass-border);
    backdrop-filter: blur(var(--glass-backdrop-blur, 10px));
    -webkit-backdrop-filter: blur(var(--glass-backdrop-blur, 10px));
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.nt-toolbar.is-solid {
    background: var(--toolbar-solid-bg, #FAFAFB);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
}

.nt-toolbar.is-hidden {
    transform: translateY(calc(-1 * var(--nt-topbar-h, 60px) - 100%));
}

.nt-page {
    /*
     * v1.1.3：顶栏所有控件统一高度。发布按钮、图标按钮、搜索框共用这一个变量 ——
     * 之前是三套各自写死的值（发布 30 / 图标 30 / 搜索 32），并排看就是参差不齐。
     */
    --nt-ctl-h: 30px;
}

.nt-topbar-left,
.nt-topbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: nowrap;
}

/*
 * 顶栏右侧按钮组：v1.1.3 起在移动端改成横向可滑动。
 * 手机上四个图标 + 发布按钮放不下一行，旧实现是换行 → 顶栏变两行、高度一变就抖。
 * 现在固定单行 + `overflow-x: auto`：放不下就左右滑，顶栏高度永远只由一行决定。
 * 桌面端不需要滑动（宽度足够），但保留同样的 flex 行为。
 */
.nt-topbar-right {
    flex: 1 1 auto;
    justify-content: flex-end;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
}

.nt-topbar-right::-webkit-scrollbar {
    display: none;
}

/*
 * 移动端展开的搜索行：整行占满，顶栏高度自动变高（ResizeObserver 会重新写入 --nt-topbar-h）。
 * 它是 .nt-topbar 的独立一行（纵向 flex 的第二个子项），不参与第一行的排列。
 */
.nt-msearch {
    width: 100%;
    min-width: 0;
}

/* 搜索行的输入框铺满整行：桌面端那套「固定 200px / 聚焦 300px」在手机上会溢出 */
.nt-msearch .nt-search-card,
.nt-msearch .nt-search-card :deep(.el-input),
.nt-msearch .nt-search-card :deep(.el-input__wrapper) {
    width: 100%;
    min-width: 0;
}

.nt-msearch .nt-search-card :deep(.el-input__inner),
.nt-msearch .nt-search-card:focus-within :deep(.el-input__inner) {
    width: 100%;
}

/* ── 搜索框（v1.1.3：与图床管理页 /dashboard 同一套外观与交互） ── */
.nt-search-card {
    display: flex;
    align-items: center;
    min-width: 0;
    flex: 0 1 auto;
}

.nt-search-card :deep(.el-input) {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
}

.nt-search-card :deep(.el-input__wrapper) {
    min-width: 0;
    height: var(--nt-ctl-h);
    padding: 0 12px;
    border-radius: 20px;
    background: var(--glass-bg);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
}

.nt-search-card :deep(.el-input__inner) {
    width: 200px;
    height: calc(var(--nt-ctl-h) - 2px);
    min-width: 0;
    border: none;
    background: none;
    font-size: 13px;
    transition: width 0.25s ease;
}

/* 点进搜索框自动变宽（需求：点击搜索框时也会自动变宽一点） */
.nt-search-card:focus-within :deep(.el-input__inner) {
    width: 300px;
}

@media (prefers-reduced-motion: reduce) {
    .nt-search-card :deep(.el-input__inner) {
        transition: none;
    }
}

/* 搜索范围下拉：透明、无描边，与输入框合成一个整体（图床管理页同款） */
.nt-search-card :deep(.el-input__prefix),
.nt-search-card :deep(.el-input__prefix-inner) {
    pointer-events: auto;
}

.nt-search-type {
    width: 68px;
    flex: 0 0 auto;
    margin-right: 2px;
}

.nt-search-type :deep(.el-select__wrapper) {
    min-height: 22px;
    padding: 0;
    background: transparent;
    box-shadow: none;
    font-size: 13px;
    font-weight: 500;
    color: var(--el-text-color-regular);
}

.nt-search-type :deep(.el-select__wrapper.is-hovering),
.nt-search-type :deep(.el-select__wrapper.is-focused) {
    background: transparent;
    box-shadow: none;
}

.nt-search-type :deep(.el-select__wrapper.is-focused) :deep(.el-select__selected-item) {
    color: var(--el-color-primary);
}

/* 范围与输入内容之间的细分隔线 */
.nt-search-sep {
    display: inline-block;
    width: 1px;
    height: 14px;
    margin-right: 8px;
    background: var(--el-border-color);
    opacity: 0.7;
}

.nt-search-card :deep(.el-input__suffix) {
    display: flex;
    align-items: center;
    gap: 4px;
}

.nt-search-clear,
.nt-search-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    border: none;
    background: transparent;
    color: var(--el-text-color-placeholder);
    font: inherit;
    cursor: pointer;
    outline: none;
    touch-action: manipulation;
    transition: color 0.2s ease;
}

.nt-search-clear:hover,
.nt-search-trigger:hover {
    color: var(--el-color-primary);
}

.nt-search-icon {
    cursor: pointer;
    opacity: 0.6;
}

.nt-search-trigger:hover .nt-search-icon {
    opacity: 1;
}

.nt-publish-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: var(--nt-ctl-h);
    padding: 0 14px;
    box-sizing: border-box;
    border: none;
    border-radius: 9px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
    flex: 0 0 auto;
    transition: filter 0.15s ease;
}

.nt-publish-btn:hover {
    filter: brightness(1.08);
}

.nt-publish-icon {
    font-size: 12px;
}

.nt-menu-icon {
    margin-right: 6px;
    font-size: 12px;
    opacity: 0.8;
}

/* ── 第二行工具栏 ───────────────────────────────────────── */
.nt-types {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: 10px;
    background: var(--note-tabs-bg, rgba(127, 127, 127, 0.1));
    overflow-x: auto;
    max-width: 100%;
    scrollbar-width: none;
}

.nt-types::-webkit-scrollbar {
    display: none;
}

.nt-type {
    padding: 4px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 13px;
    font-family: inherit;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.18s ease, color 0.18s ease;
}

.nt-type:hover {
    color: var(--el-color-primary);
}

.nt-type.is-active {
    background: var(--note-tab-active-bg, #fff);
    color: var(--el-color-primary);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.nt-tools {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
}

.nt-media {
    width: 108px;
}

.nt-sort {
    width: 118px;
}

.nt-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--nt-ctl-h, 30px);
    height: var(--nt-ctl-h, 30px);
    box-sizing: border-box;
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 12px;
    cursor: pointer;
    flex: 0 0 auto;
}

.nt-icon-btn:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary);
}

.nt-icon-btn.is-on {
    color: #fff;
    background: var(--el-color-primary);
    border-color: var(--el-color-primary);
}

.nt-icon-btn.is-on.is-danger {
    background: var(--el-color-danger);
    border-color: var(--el-color-danger);
}

/* 标签筛选 chip */
.nt-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border: 1px solid var(--el-color-primary);
    border-radius: 999px;
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.1));
    color: var(--el-color-primary);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
}

.nt-filter-icon {
    font-size: 10px;
}

.nt-filter-close {
    font-size: 9px;
    opacity: 0.75;
}

/* ── 内容 ───────────────────────────────────────────────── */
.nt-main {
    /*
     * v1.1.3：内容加载区只允许纵向平移。
     * 移动端在这个区域左右滑动是「切换笔记类型」的功能手势，浏览器若把它当成
     * 边缘返回，屏幕两侧就会出现拉动伸缩的预览动画（需求点名的现象）。
     * `touch-action: pan-y` 让浏览器在本区域内根本不认横向手势；
     * 手势本身仍由 onMainTouchMove 用 JS 判定（非 passive，可 preventDefault）。
     * 纵向滚动不受影响；该区域内没有横向滚动容器，因此不会误伤。
     */
    touch-action: pan-y;
    overscroll-behavior-x: contain;
    box-sizing: border-box;
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    padding: 14px 16px 40px;
}

.nt-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

/*
 * v1.1.2.2「分割线样式」：最后一条不再画分割线，否则列表末尾会多出一道悬空的线。
 * （卡片自己是不知道「我是不是最后一个」的，所以这条规则放在列表页）
 */
.nt-list :deep(.mc.is-divider:last-child) {
    border-bottom: none;
}

/* v1.1.6：修改发布时间弹窗里的一句说明 */
.nt-time-tip {
    margin: 10px 0 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.6;
}

.nt-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 80px 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

.nt-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 80px 10px;
    text-align: center;
}

.nt-empty-icon {
    font-size: 34px;
    color: var(--el-text-color-placeholder);
    margin-bottom: 6px;
}

.nt-empty-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--el-text-color-regular);
}

.nt-empty-tip {
    margin: 0;
    font-size: 12.5px;
    color: var(--el-text-color-secondary);
    max-width: 420px;
    line-height: 1.7;
}

.nt-empty-btn {
    margin-top: 10px;
    padding: 7px 16px;
    border: 1px solid var(--el-color-primary);
    border-radius: 9px;
    background: transparent;
    color: var(--el-color-primary);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
}

.nt-empty-btn:hover {
    background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.1));
}

.nt-more {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px 0 6px;
}

.nt-end {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

/* ── 页面切换下拉里的「切换实例」条目（与 /dashboard 同款外观） ── */
.nt-page :deep(.page-option-sep) {
    flex: 0 0 auto;
    height: 1px;
    margin: 6px 4px;
    background: var(--el-border-color-lighter);
    opacity: 0.9;
}

.nt-page :deep(.admin-page-instance-option) {
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
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: var(--page-option-font-size, 15px);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
}

.nt-page :deep(.admin-page-instance-option:hover) {
    color: var(--el-color-primary);
}

.nt-page :deep(.admin-page-instance-seq) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
}

.nt-page :deep(.admin-page-instance-icon) {
    font-size: 13px;
    opacity: 0.8;
}

/*
 * 实例序号角标：桌面端跟在「页面切换」按钮名称后面；
 * 移动端按钮很窄，改为悬浮在图标右上角（与 /dashboard 完全一致）。
 */
.nt-page.has-instance-badge :deep(.page-option.is-current .page-switcher-title::after) {
    content: var(--instance-seq, "");
    margin-left: 4px;
    font-size: 0.72em;
    font-weight: 700;
    line-height: 1;
    color: var(--tabs-switcher-accent-color, var(--el-color-primary));
    vertical-align: 1px;
}

@media (max-width: 768px) {
    .nt-topbar {
        /* v1.1.7：左上角「页面切换」按钮的左右外边距改为 5px（需求原文） */
        padding: 6px 5px;
        gap: 6px;
    }

    /*
     * 顶栏第一行（v1.1.3）：左侧「页面切换」固定不压缩，右侧按钮组横向可滑动
     * （需求：这些按钮改成可左右滑动）。搜索行展开时这一行的结构完全不变 ——
     * 它是 .nt-topbar 纵向排列下的另一行，不再影响这里的换行计算。
     */
    .nt-topbar-main {
        flex-wrap: nowrap;
        gap: 6px;
    }

    .nt-topbar-left {
        flex: 0 0 auto;
        flex-wrap: nowrap;
        /* 之前这里是 hidden —— 下拉菜单一展开就被裁掉，看起来像被下面的栏目盖住了 */
        overflow: visible;
        min-width: 0;
    }

    .nt-topbar-right {
        flex: 1 1 auto;
        justify-content: flex-start;
        gap: 6px;
        padding-bottom: 2px;
        overflow-x: auto;
        scroll-snap-type: none;
    }

    /* 手机上发布按钮只留图标，避免把顶栏撑爆 */
    .nt-publish-text {
        display: none;
    }

    .nt-publish-btn {
        padding: 0 10px;
    }

    .nt-toolbar {
        padding: 6px 8px;
        gap: 6px;
    }

    .nt-types {
        flex: 1 1 100%;
        max-width: 100%;
    }

    .nt-tools {
        flex: 1 1 100%;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 6px;
    }

    .nt-media {
        grid-column: 1 / 2;
        width: auto;
        min-width: 0;
    }

    .nt-sort {
        grid-column: 2 / 3;
        width: auto;
        min-width: 0;
    }

    .nt-filter-chip {
        grid-column: 1 / 3;
        justify-self: start;
    }

    .nt-main {
        padding: 10px 8px 30px;
    }

    .nt-list {
        gap: 8px;
    }

    .nt-page.has-instance-badge :deep(.page-option.is-current) {
        position: relative;
    }

    .nt-page.has-instance-badge :deep(.page-option.is-current .page-switcher-title::after) {
        content: none;
    }

    /*
     * 实例序号角标：移动端按钮很窄，序号跟在名称后面会把按钮撑爆 ——
     * 改成悬浮在**图标左上方**的小角标（v1.1.3 需求：从右上改到左上）。
     * 定位基准：按钮 padding-left 10px，图标从 x=10 起、宽 15px，
     * 角标压在图标左上角（left 6px / top -2px），既不挡图标主体也不占标题宽度。
     */
    .nt-page.has-instance-badge :deep(.page-option.is-current::after) {
        content: var(--instance-seq, "");
        position: absolute;
        z-index: 2;
        top: -2px;
        left: 6px;
        min-width: 14px;
        padding: 0 3px;
        border-radius: 999px;
        background: var(--el-color-primary);
        color: #fff;
        font-size: 9px;
        font-weight: 700;
        line-height: 14px;
        text-align: center;
    }
}

@media (prefers-reduced-motion: reduce) {
    .nt-topbar,
    .nt-toolbar {
        transition: none;
    }
}

/* ── 实例切换弹窗（与 /dashboard 同款） ─────────────────── */
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

<!--
    v1.1.3：发布类型选择弹窗的样式。
    必须放在**非 scoped** 块里：el-dialog 的 append-to-body 会把内容 teleport 到
    body 下，scoped 的 [data-v-*] 属性选不到（这是本项目踩过多次的坑）。
-->
<style>
.note-publish-type-dialog .npt-tip {
    margin: 0 0 12px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

.note-publish-type-dialog .npt-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 10px;
}

.note-publish-type-dialog .npt-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 18px 8px 16px;
    border: 1px solid var(--el-border-color);
    border-radius: 12px;
    background: var(--el-fill-color-blank, #fff);
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.note-publish-type-dialog .npt-item:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
    transform: translateY(-1px);
}

.note-publish-type-dialog .npt-item.is-disabled {
    opacity: 0.55;
}

.note-publish-type-dialog .npt-item.is-disabled:hover {
    border-color: var(--el-border-color);
    color: var(--el-text-color-primary);
    transform: none;
}

.note-publish-type-dialog .npt-icon {
    font-size: 20px;
}

.note-publish-type-dialog .npt-soon {
    position: absolute;
    top: 6px;
    right: 6px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--el-fill-color, #f0f2f5);
    color: var(--el-text-color-secondary);
    font-size: 10px;
    font-weight: 500;
    line-height: 16px;
}

/*
 * v1.1.7：移动端「修改发布时间」的日期面板居中。
 * 面板是 teleport 到 body 的 popper，默认贴着输入框往下弹，
 * 手机上会被屏幕底部裁掉一半 —— 窄屏下改成屏幕正中的浮层（并隐藏指向箭头）。
 */
@media (max-width: 768px) {
    .el-picker__popper.nt-time-popper {
        position: fixed !important;
        top: 50% !important;
        left: 50% !important;
        right: auto !important;
        bottom: auto !important;
        margin: 0 !important;
        transform: translate(-50%, -50%) !important;
        max-width: 96vw;
    }

    .el-picker__popper.nt-time-popper .el-popper__arrow {
        display: none;
    }
}
</style>