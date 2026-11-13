<template>
    <!--
        单条瞬间卡片（朋友圈式）
        ----------------------------------------------------------------------------
        正文截断规则（v1.1.2.3 起按「整块文字区」限高）：
          · 文字区 = 标题行 + 正文 + 「全文 / 收起」按钮，最高 = 页面高度 x 30%；
          · 从卡片的顶部边框 / 分割线开始算，到「全文」按钮那一行为止；
            附件区、底部操作行、留言区都不计入（需求原文如此）；
          · 超过才在正文后面显示「全文 / 收起」。

        为什么用 CSS flex 把正文压住、再只量一次 scrollHeight：
          单靠 CSS 不知道「到底有没有超出」，会出现两种错：所有卡片都显示「全文」
          （很难看），或真溢出了却不显示（内容看不到）。所以挂载后量一次，
          只有 scrollHeight > clientHeight 才认为溢出。

        排版样式（笔记设置 → 内容排版样式）：
          · 边框样式：带边框的卡片；
          · 分割线样式：去掉外边框，条目之间用一条与边框同色的分割线隔开。

        留言（v1.1.2.3）：
          · 留言直接显示在卡片底部（「更多」⋯ 按钮那一行的下一行），不再开弹窗；
          · 默认最多占视口高度 20%，超出显示「更多留言」，点开后铺满；
          · 样式照朋友圈：`姓名：内容`，点任意一条即回复该条（输入框自动带「回复 @姓名：」）。
    -->
    <article ref="root" class="mc" :class="{ 'is-deleted': note.status === 'deleted', 'is-divider': isDivider, 'is-square': square }">
        <!--
            v1.2.0（需求）：广场改成朋友圈式排版 —— 左侧发布者 1:1 头像（圆角 8px），
            右侧是「昵称 → 正文 → 附件」的常规内容列。非广场（我的笔记）不渲染头像列，
            .mc-layout 退化为普通块级容器，视觉与改动前完全一致。
        -->
        <div class="mc-layout">
        <div v-if="square" class="mc-avatar-col">
            <img
                v-if="authorAvatarUrl && !avatarFailed"
                :src="authorAvatarUrl"
                class="mc-avatar"
                :alt="authorName"
                loading="lazy"
                @error="avatarFailed = true"
            />
            <span v-else class="mc-avatar is-fallback" aria-hidden="true">{{ authorInitial }}</span>
        </div>
        <div class="mc-main">
        <!-- 昵称（仅广场）：没有昵称时回落用户名 -->
        <div v-if="square" class="mc-author">{{ authorName }}</div>
        <!-- 文字区：标题 + 正文 + 全文按钮，整块受 30% 视口高度约束 -->
        <div class="mc-text" :class="{ 'is-expanded': expanded }" :style="{ '--mc-text-max': maxTextHeight + 'px' }">
            <!-- 头部：时间 + 心情 + 天气 + 位置 + 可见性 -->
            <header class="mc-head">
                <!--
                    v1.1.8：瞬间不再有标题。
                    旧版本编辑页会把「日期 + 时间」自动填进标题，于是没写标题的瞬间看起来就像
                    「时间变成了标题」——而且标题是 12px 加粗、不可点，无法修改。
                    现在头部只留发布时间这一项：不加粗、任何一条都可以点开改（需求原文）。
                -->
                <button
                    v-if="note.mine !== false"
                    type="button"
                    class="mc-time mc-time-edit"
                    :title="$t('notes.editPublishedAt')"
                    @click.stop="$emit('edit-time', note)"
                >{{ timeText }}</button>
                <!-- v1.1.9.4：广场里别人的公开笔记，发布时间只读 -->
                <span v-else class="mc-time">{{ timeText }}</span>
                <span v-if="moodEmoji" class="mc-chip" :title="moodTitle">{{ moodEmoji }}</span>
                <span v-if="weatherEmoji" class="mc-chip" :title="weatherTitle">{{ weatherEmoji }}</span>
                <span v-if="note.moment && note.moment.location" class="mc-loc">
                    <!-- v1.1.8：地球图标改成定位针（需求原文：「位置」要一个定位图标） -->
                    <font-awesome-icon icon="location-dot" class="mc-loc-icon" />{{ note.moment.location }}
                </span>
                <span class="mc-spacer"></span>
                <!--
                    v1.2.0（需求）：
                      · 右上角不再显示笔记类型（图片 / 视频 / 混合）；
                      · 「公开」提示挪到这个位置（原来类型徽标所在处）。
                    广场里所有内容都是公开的，再挂一个「公开」只会重复，所以 square 下不显示。
                -->
                <span v-if="note.visibility === 'public' && !square" class="mc-public mc-public-corner">
                    {{ $t('notes.publicBadge') }}
                </span>
            </header>

            <!--
                正文（纯文本，不做 md 渲染；Vue 插值天然转义，不存在 XSS）
                v1.1.4：「全文」按钮不再独立成行 —— 折叠态把它绝对定位到正文**最后一行末尾**，
                正文里额外插一个等宽占位块，让最后一行提前让出按钮的位置，文字不会被压住。
            -->
            <div v-if="note.content" class="mc-body-wrap">
                <!--
                    v1.1.6：「全文 / 收起」都在正文最后一行末尾。
                    折叠态靠绝对定位 + 行内占位（见下）；展开态直接把按钮放进文字流尾部，
                    这样它天然落在最后一行末尾，而不是单独占一行。
                -->
                <div ref="body" class="mc-body" :style="bodyFontStyle">{{ note.content }}<span v-if="overflow && !expanded" class="mc-toggle-space" aria-hidden="true"></span><button
                        v-if="overflow && expanded"
                        type="button"
                        class="mc-toggle is-inline"
                        @click.stop="expanded = false"
                    >{{ $t('notes.collapse') }}</button></div>
                <button
                    v-if="overflow && !expanded"
                    type="button"
                    class="mc-toggle is-floating"
                    @click.stop="expanded = true"
                >{{ $t('notes.showFull') }}</button>
            </div>

        </div>

        <!-- 附件九宫格：超过「加载几行」的部分只显示 +N，点开灯箱看全部 -->
        <MomentGrid
            v-if="assets.length"
            :assets="assets"
            :divider="isDivider"
            @preview="(i) => $emit('preview', i)"
        />

        <!-- 底部：标签 + 操作 -->
        <footer class="mc-foot">
            <!-- v1.2.0（需求）：广场里不显示标签（朋友圈式浏览只留正文与图片） -->
            <div v-if="!square" class="mc-tags">
                <button
                    v-for="t in note.tags"
                    :key="t.id"
                    type="button"
                    class="mc-tag"
                    @click.stop="$emit('tag-click', t)"
                >#{{ t.name }}</button>
            </div>
            <div class="mc-actions">
                <template v-if="note.status === 'deleted'">
                    <button type="button" class="mc-act is-primary" :title="$t('notes.restore')" @click.stop="$emit('restore', note)">
                        <font-awesome-icon icon="undo" /><span class="mc-act-text">{{ $t('notes.restore') }}</span>
                    </button>
                    <button type="button" class="mc-act is-danger" :title="$t('notes.purge')" @click.stop="$emit('purge', note)">
                        <font-awesome-icon icon="trash-alt" /><span class="mc-act-text">{{ $t('notes.purge') }}</span>
                    </button>
                    <!-- 回收站里也保留留言入口（只读看历史留言），但不给编辑 / 删除 -->
                    <el-dropdown trigger="click" placement="top-end" @command="onCommand">
                        <button type="button" class="mc-act mc-more" :title="$t('notes.more')" @click.stop>
                            <font-awesome-icon icon="ellipsis-h" />
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item command="comment">{{ $t('notes.comment') }}</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </template>
                <template v-else-if="note.mine !== false">
                    <!--
                        v1.1.2（需求）：右下角「删除」后面加一个「更多」（3 点省略号）按钮，
                        把「编辑 / 删除」收进菜单，并在菜单里新增「留言」。
                        于是这里只剩一个 ⋯ 按钮，三个动作都在菜单里。
                    -->
                    <el-dropdown trigger="click" placement="top-end" @command="onCommand">
                        <button type="button" class="mc-act mc-more" :title="$t('notes.more')" @click.stop>
                            <font-awesome-icon icon="ellipsis-h" />
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item command="edit">
                                    <font-awesome-icon icon="edit" class="mc-menu-icon" />{{ $t('notes.edit') }}
                                </el-dropdown-item>
                                <el-dropdown-item command="comment">
                                    <font-awesome-icon icon="comment-dots" class="mc-menu-icon" />{{ $t('notes.comment') }}
                                </el-dropdown-item>
                                <el-dropdown-item command="delete" divided>
                                    <font-awesome-icon icon="trash-alt" class="mc-menu-icon is-danger" />{{ $t('notes.delete') }}
                                </el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </template>
                <template v-else>
                    <!--
                        v1.1.9.4（需求）：广场里别人的公开笔记 —— 只能看和留言，
                        不给编辑 / 删除（后端写接口同样按 author 拦截，前端只是不摆入口）。
                    -->
                    <el-dropdown trigger="click" placement="top-end" @command="onCommand">
                        <button type="button" class="mc-act mc-more" :title="$t('notes.more')" @click.stop>
                            <font-awesome-icon icon="ellipsis-h" />
                        </button>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item command="comment">{{ $t('notes.comment') }}</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </template>
            </div>
        </footer>

        <!--
            留言区（v1.1.2.3）：紧跟在「更多」⋯ 那一行下面。
            没有留言时整块不渲染 —— 否则每条瞬间底下都拖着一行「还没有留言」，太吵。
        -->
        <section
            v-if="commentList.length"
            class="mc-comments"
            :style="{ '--mc-comment-max': commentMaxHeight + 'px' }"
        >
            <!--
                v1.1.8（需求原文）：「留言数量超过留言显示区高度限制时，下方要显示一个更多按钮」。
                旧结构把「更多」按钮放在**同一个被 max-height + overflow:hidden 裁切的容器里**，
                按钮自己也被裁掉了 —— 于是内容一超限，屏幕上既看不到按钮、也看不出还有留言。
                现在只裁列表，按钮永远在裁切区外面。
            -->
            <div
                ref="commentBox"
                class="mc-comment-scroll"
                :class="{ 'is-collapsed': !commentExpanded }"
            >
            <ul class="mc-comment-list">
                <li
                    v-for="c in commentList"
                    :key="c.id"
                    class="mc-comment"
                    :class="{ 'is-reply': !!c.replyTo }"
                    @click.stop="replyTo(c)"
                    @contextmenu.prevent="openCommentMenu($event, c)"
                    @pointerdown="startCommentLongPress($event, c)"
                    @pointerup="cancelCommentLongPress"
                    @pointercancel="cancelCommentLongPress"
                    @pointerleave="cancelCommentLongPress"
                    @pointermove="onCommentPointerMove"
                >
                    <span class="mc-comment-author">{{ c.author || '—' }}</span>
                    <template v-if="c.replyTo">
                        <span class="mc-comment-sep">{{ $t('notes.commentReplyVerb') }}</span>
                        <span class="mc-comment-at">@{{ c.replyTo }}</span>
                    </template>
                    <span class="mc-comment-sep">：</span>
                    <span class="mc-comment-text">{{ c.text }}</span>
                </li>
            </ul>
            </div>
            <!--
                超出 20% 视口高度才出现；点开铺满全部。
                留言特别多（>100 条）时列表接口只带了前 100 条，这里顺带把剩下的补回来。
                刷新后 commentExpanded 恒为 false —— 需求要求默认收起。
            -->
            <button
                v-if="commentOverflow"
                type="button"
                class="mc-comment-more"
                :disabled="commentLoading"
                @click.stop="toggleComments"
            >
                {{ commentExpanded ? $t('notes.collapse') : (commentTruncated ? $t('notes.commentLoadRest', { n: commentTotal }) : $t('notes.commentMore', { n: commentTotal })) }}
                <font-awesome-icon :icon="commentExpanded ? 'chevron-up' : 'chevron-down'" class="mc-comment-more-icon" />
            </button>
        </section>

        <!--
            v1.1.7：留言的删除入口改成「长按 / 右键 → 菜单」。
            留言行尾部不再常驻一个 × —— 一条留言后面挂个叉既挡字又容易误点。
            菜单 teleport 到 body 并 fixed 定位，避免被卡片的 overflow 裁掉。
        -->
        <teleport to="body">
            <div
                v-if="commentMenu"
                class="mc-cmenu-mask"
                @click="closeCommentMenu"
                @contextmenu.prevent="closeCommentMenu"
                @touchmove.prevent="closeCommentMenu"
            >
                <div
                    class="mc-cmenu"
                    :style="{ left: commentMenu.x + 'px', top: commentMenu.y + 'px' }"
                    @click.stop
                >
                    <button type="button" class="mc-cmenu-item is-danger" @click="deleteFromMenu">
                        <font-awesome-icon icon="trash" class="mc-cmenu-icon" />{{ $t('notes.commentDelete') }}
                    </button>
                </div>
            </div>
        </teleport>

        <!--
            留言输入（v1.1.2.3）：只有在「正在写 / 回复」时才展开。
            入口有两个：⋯ 菜单里的「留言」（普通留言）与点某条留言（回复它）。
            回收站里的瞬间不给输入框（内容已删除，只留历史留言可看）。
        -->
        <div v-if="composerOpen && note.status !== 'deleted'" class="mc-composer">
            <textarea
                ref="composer"
                v-model="draft"
                class="mc-composer-input"
                rows="2"
                :placeholder="composerPlaceholder"
                @keydown.enter.ctrl.prevent="post"
                @keydown.enter.meta.prevent="post"
            ></textarea>
            <div class="mc-composer-foot">
                <span class="mc-composer-count" :class="{ 'is-over': charCount > commentMaxChars }">
                    {{ charCount }} / {{ commentMaxChars }}
                </span>
                <div class="mc-composer-btns">
                    <button type="button" class="mc-composer-btn" @click.stop="closeComposer">
                        {{ $t('common.cancel') }}
                    </button>
                    <button
                        type="button"
                        class="mc-composer-btn is-primary"
                        :disabled="posting || !canPost"
                        @click.stop="post"
                    >{{ $t('notes.commentPost') }}</button>
                </div>
            </div>
        </div>
        </div>
        </div>
    </article>
</template>

<script>
import MomentGrid from './MomentGrid.vue';
import fetchWithAuth from '@/utils/fetchWithAuth';
import {
    MOOD_OPTIONS,
    WEATHER_OPTIONS,
    emojiOfMood,
    emojiOfWeather,
    formatMomentTime,
    MOMENT_TEXT_MAX_RATIO,
    COMMENT_BLOCK_MAX_RATIO,
    COMMENT_MAX_CHARS,
    countTextChars,
    buildReplyContent,
    parseCommentContent
} from '@/utils/notes';
import { noteSettings, viewportHeight, DEFAULT_GENERAL_SETTINGS } from '@/utils/noteSettings';

export default {
    name: 'MomentCard',
    components: { MomentGrid },
    props: {
        note: { type: Object, required: true },
        /**
         * v1.2.0（需求）：是否「广场」形态。
         * 广场 = 朋友圈式浏览：左侧显示发布者头像 + 昵称，隐藏标签与「公开」徽标。
         * 默认 false，保证「我的笔记」页面的排版与改动前完全一致。
         */
        square: { type: Boolean, default: false }
    },
    /** 留言在卡片内部完成读写，只对外广播「这条瞬间的留言数变了」 */
    emits: ['preview', 'edit', 'delete', 'restore', 'purge', 'tag-click', 'comment-changed', 'edit-time'],
    data() {
        return {
            // 正文是否被折叠（用户可以点「全文」展开）
            expanded: false,
            // v1.2.0：头像加载失败（账户头像文件缺失）→ 回落到首字占位
            avatarFailed: false,
            // 正文是否真的溢出（决定要不要显示「全文」按钮）
            overflow: false,

            /* ── 留言（v1.1.2.3） ── */
            // 卡片内维护一份：新发的留言就地追加，不必整页重载
            localComments: null,
            // 本地留言条数（发 / 删之后以它为准，避免还拿列表接口里的旧 commentCount 判断「是否带全」）
            localCount: null,
            commentExpanded: false,
            // 留言区是否超出 20% 视口高度（决定要不要显示「更多留言」）
            commentOverflow: false,
            composerOpen: false,
            replyTarget: null,
            draft: '',
            posting: false,
            commentLoading: false,
            commentMaxChars: COMMENT_MAX_CHARS,
            // v1.1.7：长按 / 右键弹出的留言菜单（null = 未打开）
            commentMenu: null,
            // 长按计时的句柄与起点（移动超过阈值即视为滑动，取消长按）
            commentPressTimer: null,
            commentPressOrigin: null,
            // 长按已经弹出菜单时，紧随其后的 click 不能再当成「回复」
            suppressCommentClick: false
        };
    },
    computed: {
        assets() {
            return (this.note && this.note.assets) || [];
        },
        /** v1.1.2.3：整块文字区最大高度 = 视口高度 x 30% */
        maxTextHeight() {
            return Math.max(80, Math.round(viewportHeight.value * MOMENT_TEXT_MAX_RATIO));
        },
        /** 内容排版样式：divider = 去外边框 + 条目之间一条分割线 */
        isDivider() {
            return noteSettings.moment.layoutStyle === 'divider';
        },
        /**
         * v1.2.0（需求）：广场里的发布者信息。
         * 优先昵称，没有昵称回落用户名（与后台「用户管理」的展示口径一致）。
         */
        authorName() {
            const nick = String((this.note && this.note.authorNickname) || '').trim();
            if (nick) return nick;
            return String((this.note && this.note.author) || '').trim();
        },
        /** 头像地址：后端下发带版本戳的 URL，空串表示该账户没设过头像 */
        authorAvatarUrl() {
            return String((this.note && this.note.authorAvatarUrl) || '');
        },
        /** 没有头像时的文字占位：取昵称/用户名首字 */
        authorInitial() {
            const s = this.authorName;
            return s ? s.slice(0, 1).toUpperCase() : '?';
        },
        /**
         * v1.1.7：正文自定义字号（笔记设置 → 通用设置 → 字体大小设置）。
         * 与出厂值相同时返回 null —— 让样式表里的「桌面 14.5px / 移动 14px」自然生效，
         * 用户没动过设置就不会因为这条内联样式改变移动端的现有观感。
         */
        bodyFontStyle() {
            const px = Number(noteSettings.general && noteSettings.general.fontSize);
            if (!Number.isFinite(px) || px <= 0 || px === DEFAULT_GENERAL_SETTINGS.fontSize) return null;
            return { fontSize: `${px}px` };
        },
        timeText() {
            // v1.1.7：标题旁的时间带上星期，例如「11月11日 09:13 周三」
            return formatMomentTime(this.note.publishedAt || this.note.createdAt, (k) => this.$t(k), { week: true });
        },
        moodEmoji() {
            return emojiOfMood(this.note.moment && this.note.moment.mood);
        },
        weatherEmoji() {
            return emojiOfWeather(this.note.moment && this.note.moment.weather);
        },
        moodTitle() {
            const m = this.note.moment || {};
            const hit = MOOD_OPTIONS.find((x) => x.value === m.mood);
            // 优先按当前语言显示；枚举值被删掉（老数据）时退回发布时记下的名称快照
            return hit ? this.$t(hit.label) : (m.moodName || '');
        },
        weatherTitle() {
            const m = this.note.moment || {};
            const hit = WEATHER_OPTIONS.find((x) => x.value === m.weather);
            return hit ? this.$t(hit.label) : (m.weatherName || '');
        },

        /* ── 留言 ── */
        /** 服务端随列表给的原始留言（列表 / 详情接口一次批量返回） */
        serverComments() {
            return (this.note && this.note.comments) || [];
        },
        /**
         * 渲染用的留言：把「回复 @某某：」前缀拆成 replyTo + text，
         * 这样模板里可以给「回复 @某某」单独上色，而不是混在正文里。
         */
        commentList() {
            const rows = this.localComments || this.serverComments;
            return rows.map((c) => ({ ...c, ...parseCommentContent(c.content) }));
        },
        commentTotal() {
            // 本地发 / 删过就以本地为准：列表接口返回的 commentCount 此刻已经过期
            if (this.localCount !== null) return this.localCount;
            return Math.max(Number(this.note && this.note.commentCount) || 0, this.commentList.length);
        },
        /** 列表接口单条笔记最多带 100 条留言，没带全时点「更多」先补拉 */
        commentTruncated() {
            return this.commentTotal > this.commentList.length;
        },
        /** v1.1.2.3：留言区折叠时的高度上限 = 视口高度 x 20% */
        commentMaxHeight() {
            return Math.max(60, Math.round(viewportHeight.value * COMMENT_BLOCK_MAX_RATIO));
        },
        composerPlaceholder() {
            return this.replyTarget
                ? this.$t('notes.commentReplyTo', { name: this.replyTarget })
                : this.$t('notes.commentPlaceholderShort');
        },
        /**
         * 真正会提交的正文。
         * 回复时后端存的是一条带「回复 @某某：」前缀的完整留言，
         * 所以字数也要按**带前缀**的口径算 —— 否则用户写满 500 字会突然被后端拒掉。
         */
        effectiveContent() {
            return this.replyTarget ? buildReplyContent(this.replyTarget, this.draft) : this.draft;
        },
        charCount() {
            return countTextChars(this.effectiveContent);
        },
        canPost() {
            if (this.posting) return false;
            if (!this.draft.trim()) return false;
            return this.charCount <= this.commentMaxChars;
        }
    },
    watch: {
        /** 正文或附件变化后重新判定溢出（内容变了，超出与否也可能变） */
        'note.content'() {
            this.$nextTick(this.measure);
        },
        'assets.length'() {
            this.$nextTick(this.measure);
        },
        /** 窗口高度变了 → 30% / 20% 的阈值跟着变，要重新判定 */
        maxTextHeight() {
            this.$nextTick(this.measure);
        },
        commentMaxHeight() {
            this.$nextTick(this.measureComments);
        },
        expanded(v) {
            // 展开时不必再量；收起后恢复真实状态
            if (!v) this.$nextTick(this.measure);
        },
        commentList: {
            handler() {
                this.$nextTick(this.measureComments);
            },
            deep: true
        },
        commentExpanded() {
            this.$nextTick(this.measureComments);
        },
        /** 服务端数据回来（首屏先渲染缓存、后到真实留言）→ 覆盖本地副本 */
        serverComments() {
            this.localComments = null;
            this.localCount = null;
            this.$nextTick(this.measureComments);
        }
    },
    mounted() {
        // 等字体 / 布局稳定后再量，避免首屏量到错误的行高
        this.$nextTick(() => {
            this.measure();
            this.measureComments();
            window.setTimeout(() => {
                this.measure();
                this.measureComments();
            }, 300);
        });
    },
    beforeUnmount() {
        // v1.1.7：把长按计时器摘掉，避免卡片已卸载还去改 commentMenu
        this.cancelCommentLongPress();
        this.commentMenu = null;
    },
    methods: {
        /**
         * v1.1.8：卡片根元素。
         *
         * 模板根是 **fragment**（`<article>` + 一个 `<teleport>`），这种组件实例的
         * `this.$el` 不保证是元素 —— 实测会拿到注释占位节点，`getBoundingClientRect()`
         * 直接抛 "is not a function"。以前 `revealComposer` / `post` 都用 `this.$el`，
         * 一点留言就在 nextTick 里抛异常：滚动补偿整段被跳过，页面被浏览器自己
         * 「聚焦文本框」的默认行为搬走，看起来就是「整条笔记不见了」。
         * 现在统一走 ref 拿真实 DOM，取不到就返回 null，调用方自己做空判断。
         */
        cardEl() {
            const el = this.$refs.root;
            return el && typeof el.getBoundingClientRect === 'function' ? el : null;
        },
        /** 「更多」菜单：把动作统一转成对外的编辑 / 留言 / 删除事件 */
        onCommand(cmd) {
            if (cmd === 'edit') this.$emit('edit', this.note);
            else if (cmd === 'delete') this.$emit('delete', this.note);
            else if (cmd === 'comment') this.openComposer(null);
        },
        /**
         * 量一次正文的真实高度，和「30% 页面高度」比较。
         *
         * 文字区用 flex + max-height 压住，被压住的正文 `scrollHeight` 仍然是
         * **内容真实高度**（裁掉的部分也算），所以不必像 line-clamp 那样
         * 先拆 class 再量，也就没有拆装带来的闪动。
         */
        measure() {
            if (this.expanded) return; // 展开态下量不出「是否溢出」，跳过
            const el = this.$refs.body;
            if (!el) {
                this.overflow = false;
                return;
            }
            /*
             * v1.1.3：量不到布局时（元素还在渲染 / 被 display:none 掉 / 卡片刚挂载）
             * clientHeight 会是 0，此时 `scrollHeight > 2` 恒成立 —— 于是「全文」按钮
             * 在内容其实放得下时也冒出来。反过来如果一个元素临时没有高度，
             * 也不能据此把已有的 overflow 判成 false（那会让被裁掉的正文再也没法展开）。
             * 所以：没有布局宽度就直接不动结论，等下一次有效测量。
             */
            if (!el.clientWidth && !el.clientHeight) return;
            const full = el.scrollHeight;
            // +2px 容差：行高取整 / 亚像素会让「刚好到阈值」差 1px
            this.overflow = full > el.clientHeight + 2;
        },

        /* ── 留言 ─────────────────────────────────────────────── */
        /**
         * 展开输入框：replyTo 为空 = 直接留言，否则回复某条。
         *
         * v1.1.3 修复「点留言之后整条内容像不见了」：
         *   旧实现做了两件会动版面的事 ——
         *     ① `commentExpanded = true`：把留言区从 20% 视口高度「啪」地展开，卡片高度突变；
         *     ② `el.focus()`：不带参数时浏览器会把输入框**滚动到视口内**，
         *        卡片正文正好被滚出屏幕上方，看起来就像「内容消失了」。
         *   现在：不再强制展开留言区（要展开点「更多留言」），并把 focus 改成
         *   `preventScroll` —— 只给焦点、不搬页面；随后用 `scrollIntoView({block:'nearest'})`
         *   在**必要时**做最小幅度的滚动，保证输入框可见但不把正文顶走。
         */
        openComposer(name) {
            this.replyTarget = name || null;
            this.composerOpen = true;
            /*
             * v1.1.8（需求：「点自己 / 别人的留言，整条笔记都会隐藏不见」）：
             * 打开输入框会让卡片长高，加上软键盘引起的视口变化，卡片在屏幕上会整体位移 ——
             * 旧实现只用一个粗略的「够不够得着」公式滚一下，位移大了就再也追不回来。
             * 现在改成**锚定**：先把卡片此刻的位置记下来，插入输入框后把它按原样放回去，
             * 卡片在屏幕上的位置绝对不变；需要露出输入框时再由 revealComposer 做有上限的微调。
             */
            const card = this.cardEl();
            const anchorTop = card ? card.getBoundingClientRect().top : null;
            this.$nextTick(() => {
                const el = this.$refs.composer;
                if (el && typeof el.focus === 'function') {
                    try {
                        el.focus({ preventScroll: true });
                    } catch (e) {
                        el.focus();
                    }
                }
                // 版面变了（多出一个输入框）→ 正文的「全文 / 收起」判定要重算一次
                this.measure();
                this.measureComments();
                this.anchorCardTop(anchorTop);
                this.revealComposer();
            });
        },
        /**
         * 把卡片顶部恢复到 byTop（视口坐标）。
         * 差值超过 1px 才动，避免无谓的滚动事件打断外面正在进行的滚动动画。
         */
        anchorCardTop(byTop) {
            const card = this.cardEl();
            if (byTop == null || !card) return;
            const now = card.getBoundingClientRect().top;
            const delta = now - byTop;
            if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'auto' });
        },
        /**
         * 让输入框可见，但不以「把卡片顶走」为代价。
         * 允许的滚动上限 = 卡片顶部到视口顶部的距离（滚到卡片贴顶就停），
         * 这样标题 / 正文始终留在屏幕上，与需求「保持停在该瞬间的位置」一致。
         */
        revealComposer() {
            const card = this.cardEl();
            const el = this.$refs.composer;
            if (!card || !el) return;
            const vh = window.innerHeight;
            const r = el.getBoundingClientRect();
            if (r.top >= 8 && r.bottom <= vh - 8) return; // 本来就看得见，不动
            if (r.bottom > vh - 8) {
                const need = r.bottom - vh + 8;
                const room = Math.max(0, card.getBoundingClientRect().top - 8);
                const delta = Math.min(need, room);
                if (delta > 0) window.scrollBy({ top: delta, behavior: 'auto' });
            } else {
                window.scrollBy({ top: r.top - 8, behavior: 'auto' });
            }
        },
        closeComposer() {
            this.composerOpen = false;
            this.replyTarget = null;
            this.draft = '';
        },
        /** 点某条留言 = 回复它（朋友圈式：点谁回复谁） */
        replyTo(c) {
            // 长按刚弹过菜单：这一次 click 是长按的尾巴，不能顺手把回复框打开
            if (this.suppressCommentClick) return;
            if (this.note.status === 'deleted') return;
            this.openComposer(c.author || '');
        },
        /* ── 留言的「长按 / 右键 → 菜单」删除（v1.1.7） ─────────────── */
        /**
         * 按下开始计时：520ms 后弹菜单。
         * 只对自己的留言生效 —— 别人的留言本来也删不掉，长按弹个空菜单会让人以为坏了。
         */
        startCommentLongPress(e, c) {
            if (!c || !c.mine || this.note.status === 'deleted') return;
            // 鼠标只认左键；右键走 contextmenu 那条路
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            this.cancelCommentLongPress();
            this.commentPressOrigin = { x: e.clientX, y: e.clientY };
            this.commentPressTimer = window.setTimeout(() => {
                this.commentPressTimer = null;
                /*
                 * 长按结束浏览器还会补一个 click。这里置一个短时间的抑制位，
                 * 否则「弹菜单」的同时又跳出一个回复输入框，两个操作叠在一起。
                 */
                this.suppressCommentClick = true;
                window.setTimeout(() => {
                    this.suppressCommentClick = false;
                }, 700);
                this.showCommentMenu(this.commentPressOrigin.x, this.commentPressOrigin.y, c);
            }, 520);
        },
        /** 手指 / 鼠标一移动就取消长按（滚动列表不该误弹菜单） */
        onCommentPointerMove(e) {
            if (!this.commentPressTimer || !this.commentPressOrigin) return;
            const dx = Math.abs(e.clientX - this.commentPressOrigin.x);
            const dy = Math.abs(e.clientY - this.commentPressOrigin.y);
            if (dx > 10 || dy > 10) this.cancelCommentLongPress();
        },
        cancelCommentLongPress() {
            if (this.commentPressTimer) {
                window.clearTimeout(this.commentPressTimer);
                this.commentPressTimer = null;
            }
            this.commentPressOrigin = null;
        },
        /** 桌面端右键：直接弹菜单（等价于长按） */
        openCommentMenu(e, c) {
            if (!c || !c.mine || this.note.status === 'deleted') return;
            this.showCommentMenu(e.clientX, e.clientY, c);
        },
        /**
         * 菜单定位：以按下的点为左上角，超出视口就贴边收回来。
         * 尺寸写死成菜单的实际大小，避免先渲染再测量的抖动。
         */
        showCommentMenu(x, y, c) {
            const W = 132;
            const H = 42;
            const left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - W - 8));
            const top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - H - 8));
            this.commentMenu = { x: left, y: top, comment: c };
        },
        closeCommentMenu() {
            this.commentMenu = null;
        },
        deleteFromMenu() {
            const c = this.commentMenu && this.commentMenu.comment;
            this.commentMenu = null;
            if (c) this.removeComment(c);
        },
        /** 「更多留言」：没带全就先补拉，再展开；已展开则收起 */
        async toggleComments() {
            if (this.commentExpanded) {
                this.commentExpanded = false;
                return;
            }
            if (this.commentTruncated) await this.loadRemainingComments();
            this.commentExpanded = true;
        },
        /**
         * 补拉剩余留言。
         * 列表接口为了控制体积只带前 100 条（LIST_COMMENT_MAX），
         * 这里按 100 一页往后翻，最多翻 5 页（500 条）就停 —— 再多就属于异常数据了。
         */
        async loadRemainingComments() {
            if (this.commentLoading) return;
            this.commentLoading = true;
            try {
                let acc = (this.localComments || this.serverComments).slice();
                for (let i = 0; i < 5; i += 1) {
                    if (acc.length >= this.commentTotal) break;
                    const qs = new URLSearchParams({
                        instanceId: this.note.instanceId || '',
                        page: String(Math.floor(acc.length / 100) + 1),
                        pageSize: '100'
                    });
                    const res = await fetchWithAuth(
                        `/api/notes/${encodeURIComponent(this.note.id)}/comments?${qs.toString()}`
                    );
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok || data.success === false) break;
                    const rows = Array.isArray(data.list) ? data.list : [];
                    if (!rows.length) break;
                    const seen = new Set(acc.map((x) => x.id));
                    acc = acc.concat(rows.filter((r) => !seen.has(r.id)));
                }
                this.localComments = acc;
            } catch (e) {
                /* 补拉失败不影响已渲染的留言，用户再点一次即可 */
            } finally {
                this.commentLoading = false;
            }
        },
        /** 量留言区：折叠态下超出 20% 视口高度才显示「更多留言」 */
        measureComments() {
            const el = this.$refs.commentBox;
            if (!el) {
                this.commentOverflow = false;
                return;
            }
            // 展开后内容肯定超过 20%，这里直接保持按钮可见（换成「收起」），不能再量一次把它量掉
            if (this.commentExpanded) return;
            // 折叠态由 CSS max-height 压住，scrollHeight 仍是完整内容高度
            this.commentOverflow = el.scrollHeight > this.commentMaxHeight + 2;
        },
        async post() {
            if (!this.canPost) return;
            this.posting = true;
            try {
                // v1.1.7：发完留言要停在这条瞬间上 —— 先记下卡片此刻的位置，回填后再对齐
                const postCard = this.cardEl();
                const cardTop = postCard ? postCard.getBoundingClientRect().top : 0;
                const content = this.effectiveContent;
                const res = await fetchWithAuth(`/api/notes/${encodeURIComponent(this.note.id)}/comments`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content,
                        instanceId: this.note.instanceId || ''
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                const created = data.comment;
                if (created) {
                    const base = this.localComments || this.serverComments;
                    this.localComments = base.concat([created]);
                    this.localCount = this.localComments.length;
                }
                this.draft = '';
                this.replyTarget = null;
                this.$message.success(this.$t('notes.commentOk'));
                this.$nextTick(() => {
                    this.measureComments();
                    /*
                     * v1.1.7：新留言插在输入框上方，会把卡片撑高。
                     * 按「卡片顶部没有位移」为准做一次补偿滚动 —— 位移为 0 时什么都不做，
                     * 有位移（比如上面某条瞬间被删 / 图片加载完成）就把页面拉回原处。
                     */
                    const nowCard = this.cardEl();
                    const now = nowCard ? nowCard.getBoundingClientRect().top : 0;
                    const delta = now - cardTop;
                    if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'auto' });
                });
                this.$emit('comment-changed', { id: this.note.id, count: this.commentList.length });
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            } finally {
                this.posting = false;
            }
        },
        async removeComment(c) {
            try {
                await this.$confirm(this.$t('notes.commentDeleteConfirm'), this.$t('notes.commentDelete'), {
                    type: 'warning',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel')
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(`/api/notes/comments/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                const base = this.localComments || this.serverComments;
                this.localComments = base.filter((x) => x.id !== c.id);
                this.localCount = this.localComments.length;
                this.$message.success(this.$t('notes.commentDeleted'));
                this.$nextTick(() => this.measureComments());
                this.$emit('comment-changed', { id: this.note.id, count: this.commentList.length });
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        }
    }
};
</script>

<style scoped>
.mc {
    box-sizing: border-box;
    /* v1.1.7：左右内边距抽成变量 —— 分割线样式的下划线要按同一个值内缩，
       否则线比内容区宽出 2 倍内边距（需求原文要求两者等宽）。 */
    --mc-pad-x: 16px;
    padding: 14px var(--mc-pad-x) 10px;
    /* v1.1.2.2：外边框圆角 12px → 5px */
    border-radius: 5px;
    background: var(--note-card-bg, var(--admin-container-bg-color, #fff));
    border: 1px solid var(--note-card-border, var(--glass-border, rgba(127, 127, 127, 0.16)));
    box-shadow: var(--note-card-shadow, 0 1px 2px rgba(0, 0, 0, 0.03));
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
}

/* ── v1.2.0（需求）：广场 = 朋友圈式排版（左侧头像 + 昵称 / 右侧正文与图片） ──
   .mc-layout 恒为 flex：非广场时不渲染头像列，.mc-main 独占整行，
   视觉与改动前一致，不会因为多裹一层容器产生额外间距。 */
.mc-layout {
    display: flex;
    align-items: flex-start;
    gap: 10px;
}
.mc-avatar-col {
    flex: 0 0 auto;
    width: 40px;
}
.mc-avatar {
    display: block;
    width: 40px;
    height: 40px;
    border-radius: 8px;          /* 需求：头像圆角 8px，1:1 */
    object-fit: cover;
    background: rgba(127, 127, 127, 0.12);
}
.mc-avatar.is-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 600;
    color: var(--note-muted, var(--el-text-color-secondary));
}
.mc-main {
    flex: 1 1 auto;
    min-width: 0;                /* 允许内部文字正常折行，不撑破卡片 */
}
.mc-author {
    margin-bottom: 6px;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--note-author-color, var(--el-color-primary, #2f7bd6));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.mc:hover {
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.07);
}

/*
 * 分割线样式：
 *   外边框整圈隐藏，改成**下方一条**分割线，颜色与原来的边框线一致；
 *   卡片底色也去掉，否则相邻两条之间会露出两块色块，看着不像分隔。
 *   最后一条的分割线由列表页的 `:deep(.mc:last-child)` 去掉。
 */
.mc.is-divider {
    /*
     * v1.1.6：分割线样式不再把左右内边距清零 —— 那样标题 / 正文 / 附件区
     * 比「边框样式」宽出 32px，同一页切换排版时内容会左右跳一下（需求原文要求两者一致）。
     * 这里只去掉外框与底色，内边距沿用 .mc 的 14px 16px 10px。
     *
     * 另外三边保留 1px「透明边框」而不是 border: none —— 盒子是 border-box，
     * 边框消失会让内容区凭空多出 1px/边，与边框样式差 2px 宽。留透明边框后
     * 标题 / 文字 / 附件区的实际加载宽度与边框样式**逐像素一致**，只露出底边那条线。
     */
    border: 1px solid transparent;
    border-bottom-color: transparent;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    /* v1.1.7：下划线用伪元素画，左右按内边距内缩 —— 与内容加载区等宽 */
    position: relative;
}

/*
 * v1.1.7：分割线的实际绘制。
 * 以前直接用 border-bottom，它贴在盒子外沿，比内缩 16px（移动端 12px）的内容区宽出一倍内边距，
 * 看上去像「线比内容长出一截」。改成绝对定位的 1px 横线，left/right 与内边距同值，
 * 底边再下探 1px 补掉透明边框占的那 1px，视觉位置与原来的 border-bottom 完全重合。
 */
.mc.is-divider::after {
    content: '';
    position: absolute;
    left: var(--mc-pad-x);
    right: var(--mc-pad-x);
    bottom: -1px;
    height: 1px;
    background: var(--note-card-border, var(--glass-border, rgba(127, 127, 127, 0.16)));
    pointer-events: none;
}

.mc.is-divider:hover {
    box-shadow: none;
}

.mc.is-deleted {
    opacity: 0.72;
}

/*
 * 文字区（v1.1.2.3）：标题 + 正文 + 「全文」按钮装在这个盒子里，整块最高 30% 视口高度。
 * flex 让正文自己让位（header / 按钮 flex-shrink:0），版面不会出现「按钮被挤掉」。
 */
.mc-text {
    display: flex;
    flex-direction: column;
    max-height: var(--mc-text-max, 240px);
    overflow: hidden;
}

.mc-text.is-expanded {
    max-height: none;
    overflow: visible;
}

.mc-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    flex: 0 0 auto;
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--note-muted, var(--el-text-color-secondary));
}

/*
 * v1.1.8：头部只剩发布时间一项。
 * 不再加粗 —— 以前它同时充当「没写标题时的标题」，所以用了 600 字重；
 * 现在它就是一个可点的时间戳，字重交给父级 .mc-head（400）。
 */
.mc-time {
    color: var(--note-muted, var(--el-text-color-secondary));
}

/* 时间做成可点按钮（改发布时间），外观仍像文字，悬停才提示可点 */
.mc-time-edit {
    padding: 0 2px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-family: inherit;
    /* v1.1.8：字号跟随 .mc-head（12px）—— 它不再是「标题旁边的小字」 */
    font-size: inherit;
    line-height: 1.4;
    cursor: pointer;
    transition: color 0.15s ease, background 0.15s ease;
}

.mc-time-edit:hover {
    color: var(--el-color-primary);
    background: var(--el-fill-color-light, rgba(127, 127, 127, 0.12));
    text-decoration: underline;
}

.mc-chip {
    font-size: 14px;
    line-height: 1;
}

.mc-loc {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.mc-loc-icon {
    font-size: 10px;
    opacity: 0.7;
}

.mc-public {
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--note-public-bg, rgba(64, 158, 255, 0.14));
    color: var(--note-public-color, #2f7bd6);
    font-size: 11px;
}

.mc-spacer {
    flex: 1 1 auto;
}

/* v1.2.0（需求）：右上角的笔记类型徽标已移除，「公开」提示改到该位置 */
.mc-public-corner {
    margin-left: auto;
}

/*
 * 正文：flex 子项 + min-height:0 才能被压缩（默认 min-height:auto 会顶住高度），
 * overflow:hidden 把超出的部分裁掉；是否显示「全文」由 measure() 判定。
 */
/* v1.1.4：正文外层负责 flex 与相对定位（「全文」按钮要贴在这一块右下角） */
.mc-body-wrap {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
}

.mc-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    font-size: 14.5px;
    line-height: 1.75;
    color: var(--el-text-color-primary);
    /* 纯文本：保留用户输入的换行与连续空格 */
    white-space: pre-wrap;
    word-break: break-word;
}

/* 折叠态给「全文」按钮预留的行内占位 —— 让最后一行提前换行，按钮才有落脚处不压字 */
.mc-toggle-space {
    display: inline-block;
    width: 3.6em;
    height: 1px;
}

.mc-toggle {
    flex: 0 0 auto;
    align-self: flex-start;
    margin-top: 4px;
    padding: 0 6px;
    border: none;
    /* v1.1.6：按钮加背景色（需求原文），做成小圆角标签，压在文字上也看得清 */
    border-radius: 6px;
    background: var(--el-fill-color, rgba(127, 127, 127, 0.12));
    color: var(--el-color-primary);
    font-size: 13px;
    font-family: inherit;
    line-height: 1.6;
    cursor: pointer;
}

/*
 * v1.1.4：折叠态的按钮贴正文最后一行末尾。
 * 用绝对定位 + 行内占位（.mc-toggle-space）实现：占位块让最后一行提前让出宽度，
 * 按钮正好落在留白处，既不会压住文字，也不会掉到下一行开头。
 */
.mc-toggle.is-floating {
    position: absolute;
    right: 0;
    bottom: 0;
    margin-top: 0;
    padding-left: 6px;
    line-height: 1.75;
    font-size: 13px;
}

/* v1.1.6：展开态 = 文字流里的行内标签，落在最后一行末尾，不另起一行 */
.mc-toggle.is-inline {
    margin: 0 0 0 4px;
    /* pre-wrap 下不会自动断行，保证按钮整体不掉到下一行开头 */
    white-space: nowrap;
    vertical-align: baseline;
}

.mc-toggle:hover {
    text-decoration: underline;
}

.mc-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 10px;
    flex-wrap: wrap;
}

.mc-tags {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
}

.mc-tag {
    padding: 1px 7px;
    border: none;
    border-radius: 999px;
    background: var(--note-tag-bg, rgba(127, 127, 127, 0.12));
    color: var(--note-tag-color, var(--el-text-color-regular));
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
}

.mc-tag:hover {
    color: var(--el-color-primary);
}

.mc-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
}

.mc-act {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--note-muted, var(--el-text-color-secondary));
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
}

.mc-act:hover {
    background: var(--note-act-hover, rgba(127, 127, 127, 0.12));
    color: var(--el-color-primary);
}

.mc-act.is-danger:hover {
    background: rgba(245, 108, 108, 0.12);
    color: var(--el-color-danger);
}

.mc-act.is-primary:hover {
    background: rgba(103, 194, 58, 0.14);
    color: var(--el-color-success);
}

/* 「更多」按钮：三个点是竖向排列，宽度收窄一点更紧凑 */
.mc-more {
    padding: 3px 6px;
}

.mc-menu-icon {
    margin-right: 6px;
    font-size: 12px;
    opacity: 0.8;
}

.mc-menu-icon.is-danger {
    color: var(--el-color-danger);
}

/* ── 留言区（v1.1.2.3） ───────────────────────────────────── */

/*
 * 默认最高 20% 视口高度，超出部分裁掉并显示「更多留言」。
 * 用 max-height + overflow:hidden 而不是 JS 逐条算，滚动条不出现，视觉上像朋友圈。
 */
.mc-comments {
    margin-top: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--note-comment-bg, rgba(127, 127, 127, 0.06));
    /* v1.1.8：外层不再裁切 —— 裁切只作用在列表上（见 .mc-comment-scroll） */
    overflow: visible;
}

/*
 * v1.1.8：折叠态的高度限制移到这里，只裁留言列表本身。
 * 「更多 / 收起」按钮在它外面，所以永远不会被一起裁掉。
 */
.mc-comment-scroll.is-collapsed {
    max-height: var(--mc-comment-max, 160px);
    overflow: hidden;
}

.mc-comment-list {
    margin: 0;
    padding: 0;
    list-style: none;
}

.mc-comment {
    position: relative;
    padding: 3px 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--el-text-color-primary);
    word-break: break-word;
    white-space: pre-wrap;
    cursor: pointer;
}

.mc-comment:hover {
    background: var(--note-comment-hover, rgba(127, 127, 127, 0.08));
}

.mc-comment-author {
    color: var(--note-comment-name, #4b6bdc);
    font-weight: 600;
}

.mc-comment-sep {
    color: var(--note-muted, var(--el-text-color-secondary));
}

.mc-comment-at {
    color: var(--note-comment-name, #4b6bdc);
    font-weight: 600;
}

.mc-comment-text {
    color: var(--el-text-color-primary);
}

/* 删除按钮只在本人留言上出现，靠右侧、默认半透明，hover 明显 */
/*
 * v1.1.7：留言行尾的常驻「×」已去掉，删除改成长按 / 右键弹出的菜单。
 * 下面这两块是那个菜单（teleport 到 body，fixed 定位，不受卡片 overflow 影响）。
 */
.mc-cmenu-mask {
    position: fixed;
    inset: 0;
    z-index: 3200;
    background: transparent;
}

.mc-cmenu {
    position: fixed;
    min-width: 132px;
    padding: 4px;
    border: 1px solid var(--glass-border, rgba(127, 127, 127, 0.16));
    border-radius: 8px;
    background: var(--admin-container-bg-color, #fff);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}

.mc-cmenu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-regular);
    font: inherit;
    font-size: 13px;
    line-height: 1.4;
    text-align: left;
    cursor: pointer;
}

.mc-cmenu-item:hover {
    background: var(--el-fill-color-light);
}

.mc-cmenu-item.is-danger {
    color: var(--el-color-danger);
}

.mc-cmenu-item.is-danger:hover {
    background: rgba(245, 108, 108, 0.12);
}

.mc-cmenu-icon {
    width: 12px;
    font-size: 12px;
}

/* 移动端没有 hover，删除按钮常显（否则永远点不到） */
@media (hover: none) {
    .mc-comment-del {
        opacity: 0.55;
    }
}

.mc-comment-more {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-top: 4px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--note-comment-name, #4b6bdc);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
}

.mc-comment-more-icon {
    font-size: 9px;
}

/* 正在补拉剩余留言时按钮不可点，但不要变灰到看不见（它还是「加载中」的提示） */
.mc-comment-more:disabled {
    opacity: 0.6;
    cursor: default;
}

/* 输入区：宽度 100%（v1.1.2.3 需求「移动端留言输入框不能被挤压」） */
.mc-composer {
    margin-top: 8px;
    width: 100%;
    box-sizing: border-box;
}

.mc-composer-input {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-height: 56px;
    padding: 8px 10px;
    border: 1px solid var(--note-card-border, var(--glass-border, rgba(127, 127, 127, 0.2)));
    border-radius: 6px;
    background: var(--el-fill-color-blank, #fff);
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.6;
    resize: vertical;
    outline: none;
}

.mc-composer-input:focus {
    border-color: var(--el-color-primary);
}

.mc-composer-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 6px;
}

.mc-composer-count {
    font-size: 12px;
    color: var(--note-muted, var(--el-text-color-secondary));
}

.mc-composer-count.is-over {
    color: var(--el-color-danger);
    font-weight: 600;
}

.mc-composer-btns {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
}

.mc-composer-btn {
    padding: 4px 12px;
    border: 1px solid var(--note-card-border, var(--glass-border, rgba(127, 127, 127, 0.2)));
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
}

.mc-composer-btn:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
}

.mc-composer-btn.is-primary {
    border-color: transparent;
    background: var(--el-color-primary);
    color: #fff;
}

.mc-composer-btn.is-primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
}

@media (max-width: 768px) {
    .mc {
        /* v1.1.7：分割线内缩量跟着内边距走 */
        --mc-pad-x: 12px;
        padding: 12px var(--mc-pad-x) 8px;
        /* v1.1.2.2：移动端同样收成 5px，两端观感统一 */
        border-radius: 5px;
    }

    .mc.is-divider {
        /* v1.1.6：手机上同样保留左右内边距，与边框样式的加载宽度一致 */
        border-radius: 0;
    }

    .mc-body {
        font-size: 14px;
        line-height: 1.7;
    }

    /* 手机上操作按钮只留图标，避免挤占一行 */
    .mc-act-text {
        display: none;
    }

    .mc-act {
        padding: 5px 7px;
        font-size: 13px;
    }

    /* 移动端留言字号略小，行距保持一致，一行能多放几个字 */
    .mc-comment {
        font-size: 12.5px;
    }

    /* 输入框 100% 宽 + 不因 iOS 缩放而变形（font-size >= 16px 会阻止自动放大，但这里
       跟随设计稿用 14px，并显式 width:100%，不再被 flex 父级挤成半宽） */
    .mc-composer-input {
        width: 100%;
        font-size: 14px;
    }
}
</style>
