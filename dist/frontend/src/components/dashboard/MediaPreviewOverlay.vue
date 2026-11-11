<template>
    <!--
      文件管理 · 媒体预览浮层（v3.0.0）

      触发点（卡片 / 列表视图都一样）：
        · 点缩略图 / 封面 → 本浮层（图片灯箱 / 视频播放器 / 音频播放器 / 其它通用弹窗）
        · 点文件名       → 文件详情页（行为不变）

      四套形态：
        1. 图片灯箱：全屏、左右切换、底部缩略图条、左上角文件名、
           顶部「幻灯片播放 + 速度」「实际大小 / 适应窗口」「关闭」
        2. 视频播放器：全屏播放（v3.0.0 顶栏浮层化，视频占满窗口）+ 左上角名称 + 右上角关闭 +
           右下角「更多设置」（播放速度、单次播放 / 单片循环 / 随机 / 顺序）+
           左下角视频目录
        3. 音频播放器：汇集当前页全部音频，成列表点播
        4. 其它类型：通用信息弹窗（复制链接 / 打开 / 查看详情）

      所有操作按钮 2 秒无操作自动隐藏，鼠标移动 / 触摸即重新出现；
      v3.0.0 新增 silent 静默状态：幻灯片切换 / 播放模式切换 / 滑动切换后强制隐藏
      操作与文件名，直到用户点击屏幕。
      键盘：← → 切换，Esc 关闭，空格 播放/暂停幻灯片。
      v3.0.0 交互增强：
        · 视频自动播放（muted 起播 → 尝试取消静音，失败留明显取消静音按钮）
        · 移动端长按视频 3 倍速（左上角「3x」角标）
        · 移动端图片：单击切换控件显示 / 双击切换实际大小与适应窗口
        · PC 图片：滚轮以鼠标为中心缩放（0.2x~5x）、左键拖拽手抓移动
        · 移动端所有模式左右滑动（阈值 60px）切换上/下一个
    -->
    <div
        v-if="modelValue"
        class="media-viewer"
        :class="{ 'is-idle': !controlsVisible || silent, 'is-video': current.kind === 'video', 'is-doc': current.kind === 'pdf', 'is-text': current.kind === 'text', 'is-audio': current.kind === 'audio', 'is-landscape': landscapeCss }"
        @mousemove="bumpControls"
        @touchstart.passive="bumpControls"
    >
        <!-- 背景遮罩：灰系偏暗、带透明度 + 轻微模糊 -->
        <div class="mv-backdrop" @click="onOutsideClick"></div>

        <!-- ── 顶栏 ───────────────────────────────────────────── -->
        <div class="mv-top">
            <div class="mv-title" :title="current.name">
                <span class="mv-title-name">{{ current.name }}</span>
                <span v-if="current.sizeText" class="mv-title-meta">{{ current.sizeText }}</span>
            </div>
            <div class="mv-tools">
                <template v-if="current.kind === 'image'">
                    <!-- 幻灯片播放 + 速度 -->
                    <button
                        type="button"
                        class="mv-btn"
                        :class="{ 'is-on': slideshowOn }"
                        :title="$t('mediaViewer.slideshow')"
                        :aria-label="$t('mediaViewer.slideshow')"
                        @click.stop="toggleSlideshow"
                    >
                        <font-awesome-icon :icon="slideshowOn ? 'pause' : 'play'"/>
                    </button>
                    <!-- 幻灯片速度：用内联面板而不是 el-dropdown ——
                         浮层 z-index 高于 EP 弹层，teleport 出去的 popper 会被盖住 -->
                    <div class="mv-inline-menu">
                        <button
                            type="button"
                            class="mv-btn mv-btn-text"
                            :class="{ 'is-on': slideMenuOpen }"
                            :title="$t('mediaViewer.slideshowSpeed')"
                            @click.stop="toggleSlideMenu"
                        >{{ slideSpeed }}s</button>
                        <div v-if="slideMenuOpen" class="mv-menu-panel mv-slide-menu" @click.stop>
                            <div class="mv-menu-label">{{ $t('mediaViewer.slideshowSpeed') }}</div>
                            <div class="mv-menu-chips">
                                <button
                                    v-for="s in slideSpeedOptions"
                                    :key="'sp' + s"
                                    type="button"
                                    class="mv-chip"
                                    :class="{ 'is-active': s === slideSpeed }"
                                    @click="setSlideSpeed(s)"
                                >{{ $t('mediaViewer.speedPerFrame', { s }) }}</button>
                            </div>
                        </div>
                    </div>
                    <!-- v3.0.0（R8）：「实际大小 / 适应窗口」移到底部缩略图行上方的居中缩放栏 -->
                </template>
                <!-- v3.0.0（R8）：md 目录大纲（仅 Markdown 文本预览） -->
                <button
                    v-if="canShowOutline"
                    type="button"
                    class="mv-btn"
                    :class="{ 'is-on': outlineOpen }"
                    :title="$t('mediaViewer.outline')"
                    :aria-label="$t('mediaViewer.outline')"
                    @click.stop="toggleOutline"
                >
                    <font-awesome-icon icon="list-ul"/>
                </button>
                <!--
                    v3.0.0（R9-F）：视频抓拍从右下角移到右上「详情」左侧。
                    v1.0.8：不再依赖 showDetail —— 「本地文件」页灯箱（不接详情）也要能抓拍，
                    抓拍只用到 videoEl 与当前文件名，与详情入口无关。
                -->
                <button
                    v-if="current.kind === 'video'"
                    type="button"
                    class="mv-btn"
                    :title="$t('mediaViewer.snapshot')"
                    :aria-label="$t('mediaViewer.snapshot')"
                    @click.stop="snapshotVideo"
                >
                    <font-awesome-icon icon="camera"/>
                </button>
                <!--
                    v3.0.0（R12）：文本灯箱「复制全文」按钮 ——
                    v3.0.0（R14）：按需求移到「详情」按钮左侧（复制 → 详情 → 关闭）。
                    复制的是已加载的正文（超 200KB 截断时复制截断后的内容，标题栏有提示）。
                -->
                <button
                    v-if="current.kind === 'text'"
                    type="button"
                    class="mv-btn"
                    :title="$t('mediaViewer.copyText')"
                    :aria-label="$t('mediaViewer.copyText')"
                    @click.stop="copyTextAll"
                >
                    <font-awesome-icon icon="copy"/>
                </button>
                <!-- v3.0.0（R8）：右上角「详情」按钮（关闭按钮左侧，所有类型通用）；
                     v3.0.0（R9-F）：改为不关灯箱、详情弹窗叠在灯箱上层；showDetail=false 时整个按钮不渲染
                     v3.0.0（R14）：打开详情时暂停视频/音频播放 -->
                <button
                    v-if="showDetail"
                    type="button"
                    class="mv-btn"
                    :title="$t('mediaViewer.viewDetail')"
                    :aria-label="$t('mediaViewer.viewDetail')"
                    @click.stop="goDetail"
                >
                    <font-awesome-icon icon="info-circle"/>
                </button>
                <!--
                    v1.0.5：关闭按钮左侧的「上传」入口（仅父组件开启 upload 时出现）。
                    典型场景：在「本地文件」页预览时想把当前这张图传到图床 ——
                    点这里选出渠道 / 实例 / 目录即可后台上传，灯箱**不关闭**。
                    v1.0.8：文件**已落库**时改显「详情」—— 重复上传没有意义，
                    直接打开它在图床里的文件详情页（recordId = 图床文件 ID）。
                -->
                <button
                    v-if="upload && current.recordId"
                    type="button"
                    class="mv-btn"
                    :title="$t('localFiles.viewDetail')"
                    :aria-label="$t('localFiles.viewDetail')"
                    @click.stop="openRecordDetail"
                >
                    <font-awesome-icon icon="info-circle"/>
                </button>
                <button
                    v-else-if="upload"
                    type="button"
                    class="mv-btn mv-upload"
                    :class="{ 'is-busy': uploadBusy }"
                    :title="$t('localFiles.uploadToBed')"
                    :aria-label="$t('localFiles.uploadToBed')"
                    :disabled="uploadBusy"
                    @click.stop="requestUpload"
                >
                    <font-awesome-icon :icon="uploadBusy ? 'spinner' : 'cloud-upload-alt'" :spin="uploadBusy"/>
                </button>
                <!--
                    v1.0.9：删除这里的「三点」下拉入口。
                    它与左侧的「上传 / 详情」按钮是同一件事的两种入口，顶栏因此出现
                    两个看起来都像「上传」的图标（用户反馈「为什么有两个上传按钮」）。
                    已落库项的「详情」、未落库项的「上传」都已有独立按钮，下拉是多余的。
                -->
                <span class="mv-tools-sep"></span>
                <button
                    type="button"
                    class="mv-btn mv-close"
                    :title="$t('common.close')"
                    :aria-label="$t('common.close')"
                    @click.stop="close"
                >
                    <font-awesome-icon icon="times"/>
                </button>
            </div>
        </div>

        <!-- ── 主舞台 ─────────────────────────────────────────── -->
        <!-- v3.0.0 舞台接管触摸：滑动切换 / 长按倍速 / 轻点与双击识别 -->
        <div
            class="mv-stage"
            :class="{ 'is-plain': plainKinds.includes(current.kind) }"
            @click.self="onOutsideClick"
            @touchstart.stop="onStageTouchStart"
            @touchmove.stop="onStageTouchMove"
            @touchend.stop="onStageTouchEnd"
            @touchcancel.stop="onStageTouchCancel"
        >
            <!-- 图片 -->
            <div v-if="current.kind === 'image'" class="mv-image-wrap" :class="{ 'is-actual': fitMode === 'actual' }">
                <!--
                    v1.0.4：原图占位。
                    列表里的缩略图（?thumb=320）早已被浏览器缓存，打开灯箱时它 0 请求即可显示；
                    原图即便存在远程渠道（要跨公网拉几百 KB~几 MB），用户也能立刻看到画面，
                    原图 onload 后淡入覆盖，不再是「白屏等一会才出现」。
                -->
                <img
                    v-if="current.thumb"
                    :src="current.thumb"
                    class="mv-image-ph"
                    :class="{ 'is-hidden': imageLoaded }"
                    alt=""
                    aria-hidden="true"
                    draggable="false"
                />
                <!-- v3.0.0 PC：滚轮缩放（以鼠标为中心）+ 左键拖拽移动；移动端点击行为由舞台触摸逻辑接管 -->
                <img
                    ref="imageEl"
                    :src="current.url"
                    :alt="current.name"
                    class="mv-image"
                    :class="{ 'is-dragging': imgDragging, 'is-loaded': imageLoaded }"
                    :style="imgStyle"
                    draggable="false"
                    fetchpriority="high"
                    @load="imageLoaded = true"
                    @error="imageLoaded = true"
                    @click.stop="onImageClick"
                    @mousedown="onImgMouseDown"
                    @wheel.prevent="onImageWheel"
                />
            </div>

            <!-- 视频 -->
            <!-- v3.0.0 长按手势：屏蔽长按弹出的系统「保存视频」菜单，否则系统菜单会抢占手势并触发 touchcancel -->
            <div v-else-if="current.kind === 'video'" class="mv-video-wrap" @click.stop @contextmenu.prevent>
                <!-- v3.0.0 自动播放改为脚本控制（muted 起播 → 尝试取消静音），不再用 autoplay 属性 -->
                <video
                    ref="videoEl"
                    @timeupdate="onVideoTimeUpdate"
                    :src="current.url"
                    class="mv-video"
                    :style="videoStyle"
                    controls
                    playsinline
                    @ended="handleVideoEnded"
                    @volumechange="syncVideoMuted"
                    @ratechange="onVideoRateChange"
                    @mousedown="onVideoMouseDown"
                    @dragstart.prevent
                ></video>

                <!-- v3.0.0 长按 3 倍速视觉提示 -->
                <div v-if="longPress3x" class="mv-3x-badge" :title="$t('mediaViewer.longPressSpeed')">3x</div>

                <!-- v3.0.0 muted 自动播放失败时的明显取消静音按钮（不随 is-idle 隐藏） -->
                <button v-if="videoMuted" type="button" class="mv-unmute" @click.stop="unmuteVideo">
                    <font-awesome-icon icon="volume-mute"/>
                    <span>{{ $t('mediaViewer.unmute') }}</span>
                </button>

                <!-- 右下角：更多设置（播放速度 + 播放模式）。
                     v3.0.0（R9-F）：抓拍按钮已移到右上「详情」左侧；
                     容器改为与左右切换箭头垂直居中对齐（见 CSS bottom: calc(50% - 16px)） -->
                <div class="mv-video-settings">
                    <button
                        type="button"
                        class="mv-btn"
                        :class="{ 'is-on': videoMenuOpen }"
                        :title="$t('mediaViewer.videoSettings')"
                        :aria-label="$t('mediaViewer.videoSettings')"
                        @click.stop="toggleVideoMenu"
                    >
                        <font-awesome-icon icon="cog"/>
                    </button>
                    <!-- v3.0.0 菜单改为 absolute 定位在按钮正上方（bottom: 100% 方向），按钮不位移 -->
                    <div v-if="videoMenuOpen" class="mv-menu-panel mv-video-menu" @click.stop>
                        <div class="mv-menu-label">{{ $t('mediaViewer.playbackSpeed') }}</div>
                        <div class="mv-menu-chips">
                            <button
                                v-for="r in videoRateOptions"
                                :key="'rate' + r"
                                type="button"
                                class="mv-chip"
                                :class="{ 'is-active': videoRate === r }"
                                @click="setVideoRate(r)"
                            >{{ r }}×</button>
                        </div>
                        <div class="mv-menu-label">{{ $t('mediaViewer.playMode') }}</div>
                        <div class="mv-menu-chips">
                            <button
                                v-for="m in videoModes"
                                :key="m.value"
                                type="button"
                                class="mv-chip"
                                :class="{ 'is-active': videoMode === m.value }"
                                @click="setVideoMode(m.value)"
                            >{{ m.label }}</button>
                        </div>
                        <!-- v3.0.0（R16）：画面方向 —— 支持切到横屏播放（移动端 CSS 旋转 / 桌面端全屏） -->
                        <div class="mv-menu-label">{{ $t('mediaViewer.screenOrientation') }}</div>
                        <div class="mv-menu-chips">
                            <button
                                type="button"
                                class="mv-chip"
                                :class="{ 'is-active': !videoLandscape }"
                                @click="setVideoLandscape(false)"
                            >{{ $t('mediaViewer.screenPortrait') }}</button>
                            <button
                                type="button"
                                class="mv-chip"
                                :class="{ 'is-active': videoLandscape }"
                                @click="setVideoLandscape(true)"
                            >{{ $t('mediaViewer.screenLandscape') }}</button>
                        </div>
                    </div>
                </div>

                <!--
                    v3.0.0（R16）：抓拍询问面板 —— 改为灯箱内的轻量面板，
                    不再用 Element Plus 的 $confirm（移动端会挂全屏 overlay / 锁滚动，
                    表现上就是「一抓拍灯箱像被顶掉了」）。全程留在灯箱内。
                -->
                <div v-if="snapshotPrompt" class="mv-menu-panel mv-snapshot-panel" @click.stop>
                    <div class="mv-menu-label">
                        {{ snapshotUploaded ? $t('mediaViewer.snapshotUploadedTitle') : $t('mediaViewer.snapshotUploadTitle') }}
                    </div>
                    <p class="mv-snapshot-name" :title="snapshotPrompt.name">{{ snapshotPrompt.name }}</p>
                    <p v-if="snapshotError" class="mv-snapshot-error" :title="snapshotError">
                        {{ $t('mediaViewer.snapshotUploadFailed') }}
                    </p>
                    <div class="mv-snapshot-actions">
                        <button
                            v-if="!snapshotUploaded"
                            type="button"
                            class="mv-chip is-active"
                            :disabled="snapshotUploading"
                            @click="openSnapshotTarget"
                        >
                            {{ snapshotUploading ? $t('mediaViewer.snapshotUploading') : $t('mediaViewer.snapshotUploadYes') }}
                        </button>
                        <button v-if="!snapshotUploaded" type="button" class="mv-chip" @click="downloadSnapshot">{{ $t('mediaViewer.snapshotDownload') }}</button>
                        <span v-else class="mv-snapshot-ok">{{ $t('mediaViewer.snapshotUploaded') }}</span>
                        <button type="button" class="mv-chip" @click="closeSnapshotPrompt">{{ $t('common.cancel') }}</button>
                        <!-- v3.0.0（R17）：上传完成后在「取消」后面出现「查看」，打开详情页且不关闭灯箱 -->
                        <button
                            v-if="snapshotUploaded"
                            type="button"
                            class="mv-chip is-active"
                            @click="viewUploadedSnapshot"
                        >{{ $t('mediaViewer.snapshotView') }}</button>
                    </div>
                </div>
            </div>

            <!-- 音频：当前页音频合集成播放列表 -->
            <div v-else-if="current.kind === 'audio'" class="mv-audio" @click.stop>
                <div class="mv-audio-head">
                    <font-awesome-icon icon="music" class="mv-audio-icon"/>
                    <div class="mv-audio-title">
                        <div class="mv-audio-name">{{ current.name }}</div>
                        <div class="mv-audio-sub">{{ $t('mediaViewer.audioCount', { count: audioItems.length }) }}</div>
                    </div>
                </div>
                <!-- v3.0.0：音频播放模式（单次 / 单曲循环 / 随机 / 顺序） -->
                <div class="mv-audio-modes">
                    <button
                        v-for="m in audioModes"
                        :key="'am' + m.value"
                        type="button"
                        class="mv-chip"
                        :class="{ 'is-active': audioMode === m.value }"
                        @click="setAudioMode(m.value)"
                    >{{ m.label }}</button>
                </div>
                <audio
                    ref="audioEl"
                    :src="current.url"
                    :loop="audioMode === 'single'"
                    controls
                    autoplay
                    class="mv-audio-player"
                    @ended="handleAudioEnded"
                ></audio>
                <div class="mv-audio-list">
                    <button
                        v-for="(a, i) in audioItems"
                        :key="'audio' + i"
                        type="button"
                        class="mv-audio-item"
                        :class="{ 'is-active': i === audioIndex }"
                        @click="playAudioAt(i)"
                    >
                        <span class="mv-audio-item-no">{{ i + 1 }}</span>
                        <span class="mv-audio-item-name" :title="a.name">{{ a.name }}</span>
                        <span class="mv-audio-item-size">{{ a.sizeText }}</span>
                        <font-awesome-icon :icon="i === audioIndex ? 'volume-up' : 'play'" class="mv-audio-item-icon"/>
                    </button>
                </div>
            </div>

            <!--
                v3.0.0：PDF —— 直接用浏览器内嵌查看器打开（不下载、不弹新窗口）。
            -->
            <div v-else-if="current.kind === 'pdf'" class="mv-doc" @click.stop>
                <iframe :src="current.url" class="mv-doc-frame" :title="current.name"></iframe>
            </div>

            <!--
                v3.0.0：纯文本 / 代码 / 配置（txt、md、json、log…）——
                以文本方式读取后按等宽字体渲染，超过上限截断并提示。
            -->
            <div v-else-if="current.kind === 'text'" class="mv-text" @click.stop>
                <!--
                    v3.0.0（R15）：TXT / MD 不再自带内嵌标题行 ——
                    标题与右侧按钮由灯箱顶栏（.mv-top，is-text 下浮层化）承担，
                    正文从窗口最上方开始，仅用 padding-top 让开顶栏。
                -->
                <!-- v3.0.0（R8）：Markdown 逐行渲染（带 data-line 锚点），供目录大纲跳转；其它文本保持整段 pre -->
                <pre v-if="!isMarkdown" class="mv-text-body">{{ textLoading ? $t('mediaViewer.textLoading') : textContent }}</pre>
                <div v-else ref="textBody" class="mv-text-body mv-text-md">
                    <div v-if="textLoading">{{ $t('mediaViewer.textLoading') }}</div>
                    <template v-else>
                        <div
                            v-for="(ln, li) in mdLines"
                            :key="'ln' + li"
                            class="mv-text-line"
                            :data-line="li"
                        >{{ ln === '' ? ' ' : ln }}</div>
                    </template>
                </div>
            </div>
            <!--
                v3.0.0（R7）：CSV / TSV 表格预览 —— 解析成表格，首行作表头，
                超过 500 行 / 40 列截断（大表格不把浏览器拖死）。
            -->
            <div v-else-if="current.kind === 'table'" class="mv-table" @click.stop>
                <div class="mv-text-head">
                    <span class="mv-text-name" :title="current.name">{{ current.name }}</span>
                    <span class="mv-text-meta">{{ textMeta }}</span>
                </div>
                <div class="mv-table-scroll">
                    <table class="mv-table-grid">
                        <thead>
                            <tr>
                                <th v-for="(cell, ci) in tableHeader" :key="'h' + ci">{{ cell }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(row, ri) in tableBody" :key="'r' + ri">
                                <td v-for="(cell, ci) in row" :key="'c' + ri + '-' + ci">{{ cell }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 其它类型：通用弹窗 -->
            <div v-else class="mv-other" @click.stop>
                <div class="mv-other-icon">
                    <font-awesome-icon icon="file" class="mv-other-glyph"/>
                    <span class="mv-other-ext">{{ (current.ext || 'file').toUpperCase() }}</span>
                </div>
                <div class="mv-other-name" :title="current.name">{{ current.name }}</div>
                <div class="mv-other-meta">
                    <span v-if="current.sizeText">{{ current.sizeText }}</span>
                    <span v-if="current.user">{{ current.user }}</span>
                </div>
                <div class="mv-other-actions">
                    <el-button size="small" @click="copyLink">
                        <font-awesome-icon icon="copy" class="mv-other-btn-icon"/>{{ $t('mediaViewer.copyLink') }}
                    </el-button>
                    <el-button size="small" @click="openLink">
                        <font-awesome-icon icon="external-link-alt" class="mv-other-btn-icon"/>{{ $t('mediaViewer.openLink') }}
                    </el-button>
                    <el-button v-if="showDetail" size="small" type="primary" @click="goDetail">
                        {{ $t('mediaViewer.viewDetail') }}
                    </el-button>
                </div>
            </div>

            <!--
                v3.0.0（R8）：md 目录大纲面板（顶栏大纲按钮下方）。
                必须放在上面 v-if / v-else-if 链**之外** —— 放在链中间会打断
                v-else 的配对，导致图片/视频/音频灯箱同时渲染出「通用弹窗」块。
            -->
            <div v-if="outlineOpen && canShowOutline" class="mv-menu-panel mv-outline-menu" @click.stop>
                <div class="mv-menu-label">{{ $t('mediaViewer.outline') }}</div>
                <button
                    v-for="(h, hi) in mdOutline"
                    :key="'ol' + hi"
                    type="button"
                    class="mv-outline-item"
                    :style="{ paddingLeft: (8 + (h.level - 1) * 14) + 'px' }"
                    :title="h.text"
                    @click="jumpToOutline(h)"
                >
                    <span class="mv-outline-h">H{{ h.level }}</span>
                    <span class="mv-outline-text">{{ h.text }}</span>
                </button>
            </div>

            <!-- v3.0.0 左下角视频目录：与右下角设置按钮对齐、同款样式、同样自动隐藏 -->
            <div v-if="current.kind === 'video'" class="mv-video-toc" @click.stop>
                <button
                    type="button"
                    class="mv-btn"
                    :class="{ 'is-on': tocOpen }"
                    :title="$t('mediaViewer.videoToc')"
                    :aria-label="$t('mediaViewer.videoToc')"
                    @click.stop="toggleToc"
                >
                    <font-awesome-icon icon="list"/>
                </button>
                <div v-if="tocOpen" class="mv-menu-panel mv-toc-menu">
                    <button
                        v-for="t in videoItems"
                        :key="'toc-' + t.index"
                        type="button"
                        class="mv-toc-item"
                        :class="{ 'is-active': t.index === index }"
                        @click.stop="goToVideo(t.index)"
                    >
                        <video :src="t.url" class="mv-toc-thumb" muted preload="metadata"></video>
                        <span class="mv-toc-name" :title="t.name">{{ t.name }}</span>
                        <font-awesome-icon :icon="t.index === index ? 'play' : 'file'" class="mv-toc-icon"/>
                    </button>
                </div>
            </div>

            <!--
                v1.1.4：上次播放进度提示。
                关闭视频灯箱时把播放时间点写进 localStorage；下次打开同一个视频，
                在左下「目录」与右下「设置」之间显示一行提示 + 「跳转」按钮。
            -->
            <div v-if="current.kind === 'video' && resumeAt > 0" class="mv-resume-tip" @click.stop>
                <font-awesome-icon icon="history" class="mv-resume-icon"/>
                <span class="mv-resume-text">{{ $t('mediaViewer.resumeTip', { time: resumeAtText }) }}</span>
                <button type="button" class="mv-resume-jump" @click.stop="jumpToResume">{{ $t('mediaViewer.resumeJump') }}</button>
                <button type="button" class="mv-resume-close" :title="$t('mediaViewer.resumeDismiss')" :aria-label="$t('mediaViewer.resumeDismiss')" @click.stop="dismissResume">
                    <font-awesome-icon icon="times"/>
                </button>
            </div>

            <!--
                左右切换（图片 / 视频 / 其它；音频用列表点播）
                v1.0.0：只在「同类型」文件之间循环 —— 图片灯箱只切图片、视频灯箱只切视频，
                PDF / 文本 / 音频各自独立，不再跨类型乱跳。当前类型只有 1 个时不显示箭头。
            -->
            <button
                v-if="canSwitchSameKind && current.kind !== 'audio'"
                type="button"
                class="mv-nav mv-nav-prev"
                :title="$t('mediaViewer.prev')"
                :aria-label="$t('mediaViewer.prev')"
                @click.stop="step(-1)"
            >
                <font-awesome-icon icon="chevron-left"/>
            </button>
            <button
                v-if="canSwitchSameKind && current.kind !== 'audio'"
                type="button"
                class="mv-nav mv-nav-next"
                :title="$t('mediaViewer.next')"
                :aria-label="$t('mediaViewer.next')"
                @click.stop="step(1)"
            >
                <font-awesome-icon icon="chevron-right"/>
            </button>

            <!--
                v3.0.0（R9-F）：图片缩放栏改为浮动在图片上层（stage 内部、链尾之后，不破坏 v-if 链）：
                缩小 / 实际大小·适应窗口 / 放大（每次 ±10%）。
                不再独占一行，图片默认可用高度因此扩大到「标题行 ~ 缩略图行」之间。
            -->
            <div v-if="current.kind === 'image'" class="mv-zoombar" @click.stop>
                <button
                    type="button"
                    class="mv-btn"
                    :title="$t('mediaViewer.zoomOut')"
                    :aria-label="$t('mediaViewer.zoomOut')"
                    @click.stop="zoomStep(-1)"
                >
                    <font-awesome-icon icon="search-minus"/>
                </button>
                <button
                    type="button"
                    class="mv-btn"
                    :class="{ 'is-on': fitMode === 'actual' }"
                    :title="fitMode === 'actual' ? $t('mediaViewer.fitWindow') : $t('mediaViewer.actualSize')"
                    :aria-label="fitMode === 'actual' ? $t('mediaViewer.fitWindow') : $t('mediaViewer.actualSize')"
                    @click.stop="toggleFit"
                >
                    <font-awesome-icon :icon="fitMode === 'actual' ? 'compress-alt' : 'expand-alt'"/>
                </button>
                <button
                    type="button"
                    class="mv-btn"
                    :title="$t('mediaViewer.zoomIn')"
                    :aria-label="$t('mediaViewer.zoomIn')"
                    @click.stop="zoomStep(1)"
                >
                    <font-awesome-icon icon="search-plus"/>
                </button>
            </div>
        </div>

        <!-- ── 底部缩略图条（仅图片灯箱） ─────────────────────── -->
        <div v-if="current.kind === 'image' && imageThumbs.length > 1" class="mv-thumbs" @click.stop>
            <div class="mv-thumbs-track" ref="thumbsTrack">
                <button
                    v-for="t in imageThumbs"
                    :key="'thumb-' + t.index"
                    type="button"
                    class="mv-thumb"
                    :class="{ 'is-active': t.index === index }"
                    :title="t.name"
                    :data-thumb-index="t.index"
                    @click="index = t.index"
                >
                    <img :src="t.url" :alt="t.name" loading="lazy"/>
                </button>
            </div>
        </div>

        <!-- v3.0.0（R8）：PDF 底部文档导航（桌面端显示，移动端隐藏）——当前页全部 PDF 的点播条 -->
        <div v-if="current.kind === 'pdf' && pdfItems.length > 1" class="mv-thumbs mv-doc-thumbs" @click.stop>
            <div class="mv-thumbs-track">
                <button
                    v-for="t in pdfItems"
                    :key="'pdfthumb-' + t.index"
                    type="button"
                    class="mv-thumb mv-thumb-doc"
                    :class="{ 'is-active': t.index === index }"
                    :title="t.name"
                    :data-thumb-index="t.index"
                    @click="index = t.index"
                >
                    <font-awesome-icon icon="file-pdf" class="mv-thumb-doc-icon"/>
                    <span class="mv-thumb-doc-name">{{ t.name }}</span>
                </button>
            </div>
        </div>

        <!--
            v1.0.7：抓拍图上传前先选「目标渠道 / 归属实例 / 上传目录」。
            组件与「本地文件」页上传弹窗完全同一套（UploadTargetDialog）。
            v1.0.8：**不再**给弹窗硬指定 z-index —— 见 UploadTargetDialog 顶部说明：
            硬设 3400 会让弹窗内部的 el-select 下拉浮层（走 EP 递增，约 3211）落到弹窗下面，
            表现为「下拉框点开看不见」。交给 EP 全局 zIndex 管理器即可，基准 3210 本就高于灯箱 3200。
        -->
        <UploadTargetDialog
            v-model="snapshotTarget"
            :busy="snapshotUploading"
            :prefill="snapshotTargetForm"
            :hint="$t('mediaViewer.snapshotTargetHint')"
            @confirm="doUploadSnapshot"
        />
    </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import { registerLayer, unregisterLayer } from '@/utils/layerStack';
// v1.0.7：抓拍图上传前选「目标渠道 / 归属实例 / 上传目录」，与本地文件页共用同一组件
import UploadTargetDialog from '@/components/upload/UploadTargetDialog.vue';

/**
 * 媒体预览浮层（v3.0.0）
 *
 * props.items 由父组件（AdminDashBoard）按「当前页可预览媒体」的顺序构造：
 *   { key, name, url, kind: 'image'|'video'|'audio'|'other', ext, sizeText, user }
 * 父组件只传当前页、且已按视图顺序排列，本组件不做任何请求。
 */

/* v3.0.0 控件自动隐藏时长：任何交互（点击 / 滑动 / 按键 / 切图）后统一等 2s 再进入 idle */
// v3.0.0：文本预览最多读取 200KB（超过截断，避免把超大日志灌进浏览器）
const TEXT_PREVIEW_MAX = 200 * 1024
const IDLE_MS = 2000
/* v3.0.0 移动端长按触发的等待时长与临时倍速 */
const LONG_PRESS_MS = 500
const LONG_PRESS_RATE = 3
/* 手指抖动阈值：超过它才算「滑动了」，长按作废（滑动切换仍按 60px 判定） */
const LONG_PRESS_CANCEL_PX = 16
/*
 * v1.1.4：屏幕两侧「边缘退出」手势。
 * 起手落在左右各 EDGE_BACK_PX 内、且横向朝屏幕内侧滑动超过 EDGE_BACK_TRIGGER_PX，
 * 就由灯箱自己退出（先关详情、再关灯箱）—— 同时全程 preventDefault，
 * 浏览器不会再执行「返回上一页」，页面也不会跟着后退。
 */
const EDGE_BACK_PX = 26
const EDGE_BACK_TRIGGER_PX = 64

export default {
    name: 'MediaPreviewOverlay',
    components: { UploadTargetDialog },
    props: {
        modelValue: { type: Boolean, default: false },
        items: { type: Array, default: () => [] },
        startIndex: { type: Number, default: 0 },
        /**
         * v3.0.0（R9-F）：是否展示「详情」入口（顶栏按钮 + 通用弹窗按钮）。
         * 只有父组件接了 @detail 事件时才传 true（如文件管理页）；
         * 未接监听的页面（如本地文件预览）不展示，避免出现点了没反应的死按钮。
         */
        showDetail: { type: Boolean, default: false },
        /**
         * v3.0.0（R15）：文件详情弹窗是否正开着。
         * 移动端「滑动屏幕返回」时先关详情、再关灯箱（需求），
         * 灯箱靠这个标记判断第一下返回该交给谁处理。
         */
        detailOpen: { type: Boolean, default: false },
        /** v1.0.5：关闭按钮左侧是否显示「上传」按钮（本地文件页用） */
        upload: { type: Boolean, default: false },
        /** v1.0.5：上传进行中（按钮转圈并禁用） */
        uploadBusy: { type: Boolean, default: false }
    },
    emits: ['update:modelValue', 'detail', 'close-detail', 'view-uploaded', 'upload', 'record-detail'],
    data() {
        return {
            index: 0,
            // 控件自动隐藏（2 秒无操作）
            controlsVisible: true,
            hideTimer: null,
            // v3.0.0 静默状态：幻灯片/播放模式/滑动切换后强制隐藏操作与名称，直到点击屏幕
            silent: false,
            // 图片
            fitMode: 'fit',            // fit = 适应窗口，actual = 实际大小
            // v1.0.4：原图是否已解码完成（false 时显示缩略图占位）
            imageLoaded: false,
            // v3.0.0 PC 图片滚轮缩放 + 拖拽状态
            imgScale: 1,
            imgX: 0,
            imgY: 0,
            imgDragging: false,
            /** v1.1.3：视频画面被放大后拖动位置时置位（拖动期间关掉 transition，否则会「追」得发飘） */
            vidDragging: false,
            /*
             * v1.0.0：视频灯箱双指缩放状态。
             * 刻意与图片的 imgScale/imgX/imgY 分开：图片那套还牵着 fitMode（适应窗口 /
             * 实际大小）、PC 滚轮与拖拽判定，共用一个变量会让「切集是否重置」互相干扰。
             */
            vidScale: 1,
            vidX: 0,
            vidY: 0,
            // 捏合进行中：关掉 transform 过渡，缩放跟手
            vidPinching: false,
            slideshowOn: false,
            slideMenuOpen: false,
            // v3.0.0（R8）：md 目录大纲面板开关
            outlineOpen: false,
            slideSpeed: 3,
            slideSpeedOptions: [1, 2, 3, 5, 8],
            slideTimer: null,
            // 视频
            videoMenuOpen: false,
            videoRate: 1,
            // v3.0.0 速度 chips 增加 3x / 4x
            videoRateOptions: [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4],
            // v3.0.0 播放模式：once = 单次播放，single = 单片循环，random = 随机，sequence = 顺序
            videoMode: 'sequence',
            // v3.0.0：音频播放模式（once=单次 / single=单曲循环 / random=随机 / sequence=顺序）
            audioMode: 'sequence',
            // v3.0.0：文本类预览内容 / 加载中 / 是否被截断
            textContent: '',
            textLoading: false,
            textTruncated: false,
            videoMuted: false,
            // v3.0.0 移动端长按 3 倍速
            longPress3x: false,
            // v3.0.0 左下角视频目录
            tocOpen: false,
            // v1.1.4：上次播放进度（秒；0 = 没有记忆，不显示提示行）
            resumeAt: 0,
            // v3.0.0（R9-F）：本次会话已用过的抓拍文件名（重名自动加序号）
            snapshotNames: {},
            // v3.0.0（R9-F）：抓拍图上传中标记
            snapshotUploading: false,
            // v3.0.0（R16）：抓拍询问面板（{ url, name } | null）—— 不再用 EP $confirm
            snapshotPrompt: null,
            // v1.0.7：抓拍图上传前的目标配置弹窗（渠道 / 实例 / 目录）
            snapshotTarget: false,
            snapshotTargetForm: { channelId: '', instanceId: '', uploadFolder: '' },
            /*
             * v3.0.0（R17）：抓拍图上传结果（{ id, name, src } | null）与失败原因。
             * 上传完成后不再弹全局提示（移动端那条 message 会盖住灯箱、并把灯箱顶掉），
             * 改为在面板内显示「已上传」并在「取消」后追加「查看」。
             */
            snapshotUploaded: null,
            snapshotError: '',
            // v3.0.0（R16）：视频横屏播放（videoLandscape = 用户选择；landscapeCss = 需要用 CSS 旋转兜底）
            videoLandscape: false,
            landscapeCss: false,
            // 音频
            audioIndex: 0
        }
    },
    computed: {
        // v3.0.0 播放模式顺序：单次播放 / 单片循环 / 随机播放 / 顺序播放
        /** v3.0.0：文本预览标题栏右侧的元信息（大小 · 截断提示） */
        textMeta() {
            const size = (this.current && this.current.sizeText) || '';
            const trunc = this.textTruncated ? this.$t('mediaViewer.textTruncated', { size: '200 KB' }) : '';
            return [size, trunc].filter(Boolean).join(' · ');
        },
        /** v3.0.0：音频播放模式（与视频同一套四档语义） */
        audioModes() {
            return this.videoModes
        },
        /* v1.1.4：记忆时间点的「分:秒」文本 */
        resumeAtText() {
            const total = Math.max(0, Math.floor(Number(this.resumeAt) || 0));
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const s = total % 60;
            const pad = (n) => String(n).padStart(2, '0');
            return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
        },
        /* ── v3.0.0（R8）：Markdown 目录大纲 ──────────────────── */
        /** 当前文本是否为 Markdown（md / markdown 扩展名） */
        isMarkdown() {
            const ext = String((this.current && this.current.ext) || '').toLowerCase()
            return this.current.kind === 'text' && (ext === 'md' || ext === 'markdown')
        },
        /** Markdown 按行拆分（逐行渲染，带 data-line 锚点供大纲跳转） */
        mdLines() {
            if (!this.isMarkdown) return []
            return String(this.textContent || '').split('\n')
        },
        /** 解析 ATX 标题（# ~ ######），返回 { level, text, line } 列表 */
        mdOutline() {
            if (!this.isMarkdown) return []
            const out = []
            const lines = this.mdLines
            for (let i = 0; i < lines.length; i++) {
                const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i])
                if (m && m[2]) out.push({ level: m[1].length, text: m[2], line: i })
            }
            return out
        },
        /** 是否显示大纲按钮（Markdown 且真的解析到了标题、且内容加载完成） */
        canShowOutline() {
            return this.isMarkdown && !this.textLoading && this.mdOutline.length > 0
        },
        /* ── v3.0.0（R8）：当前页全部 PDF（底部文档导航用） ───── */
        pdfItems() {
            return (this.items || [])
                .map((it, i) => ({ ...it, index: i }))
                .filter(it => it.kind === 'pdf')
        },
        /** v3.0.0（R7）：这些形态铺满整屏透明底，点空白只恢复控件、不退出预览 */
        plainKinds() {
            return ['audio', 'other', 'pdf', 'text', 'table']
        },
        /** v3.0.0（R7）：CSV / TSV → { header, body }（首行表头；最多 500 行 × 40 列） */
        tableData() {
            const text = String(this.textContent || '')
            if (!text) return { header: [], body: [] }
            const ext = String(this.current.ext || '').toLowerCase()
            const firstLine = text.split('\n')[0] || ''
            const delim = ext === 'tsv' ? '\t' : (ext === 'csv' ? ',' : (firstLine.includes('\t') ? '\t' : ','))
            const rows = []
            let row = []
            let cell = ''
            let inQuote = false
            for (let i = 0; i < text.length; i++) {
                const ch = text[i]
                if (inQuote) {
                    if (ch === '"') {
                        if (text[i + 1] === '"') {
                            cell += '"'
                            i++
                        } else {
                            inQuote = false
                        }
                    } else {
                        cell += ch
                    }
                    continue
                }
                if (ch === '"') { inQuote = true; continue }
                if (ch === delim) { row.push(cell); cell = ''; continue }
                if (ch === '\n') {
                    row.push(cell)
                    rows.push(row.slice(0, 40))
                    row = []
                    cell = ''
                    if (rows.length >= 500) break
                    continue
                }
                if (ch === '\r') continue
                cell += ch
            }
            if (cell.length || row.length) {
                row.push(cell)
                rows.push(row.slice(0, 40))
            }
            return { header: rows[0] || [], body: rows.slice(1) }
        },
        tableHeader() {
            return this.tableData.header
        },
        tableBody() {
            return this.tableData.body
        },
        videoModes() {
            return [
                { value: 'once', label: this.$t('mediaViewer.modeOnce') },
                { value: 'single', label: this.$t('mediaViewer.modeSingle') },
                { value: 'random', label: this.$t('mediaViewer.modeRandom') },
                { value: 'sequence', label: this.$t('mediaViewer.modeSequence') }
            ]
        },
        current() {
            const list = this.items || []
            return list[this.index] || { name: '', url: '', kind: 'other' }
        },
        canSwitch() {
            return (this.items || []).length > 1
        },
        /**
         * v1.0.0：当前文件所在「同类型」下标列表（按 items 原顺序）。
         * 上一页 / 下一页 / 键盘方向键 / 幻灯片都只在这份列表里循环，
         * 避免图片灯箱翻着翻着跳进视频、或 PDF 灯箱切到图片。
         */
        sameKindIndexes() {
            const kind = this.current && this.current.kind
            return (this.items || [])
                .map((it, i) => (it && it.kind === kind ? i : -1))
                .filter(i => i >= 0)
        },
        /** v1.0.0：当前类型至少 2 个才显示左右箭头（同类型切换才有意义） */
        canSwitchSameKind() {
            return this.sameKindIndexes.length > 1
        },
        imageThumbs() {
            // 缩略图条只放图片（视频/音频用左右切换，避免误点）
            return (this.items || [])
                .map((it, i) => ({ ...it, index: i }))
                .filter(it => it.kind === 'image')
        },
        // v3.0.0 当前页所有视频（目录列表用）
        videoItems() {
            return (this.items || [])
                .map((it, i) => ({ ...it, index: i }))
                .filter(it => it.kind === 'video')
        },
        audioItems() {
            return (this.items || []).filter(it => it.kind === 'audio')
        },
        // v3.0.0 触屏设备判定（移动端单击/双击/长按与 PC 滚轮/拖拽互斥）
        isTouch() {
            return typeof window !== 'undefined' && window.matchMedia &&
                window.matchMedia('(hover: none)').matches
        },
        // v3.0.0 图片缩放/拖拽 transform（transform-origin 默认中心，缩放围绕鼠标的数学基于此）
        imgStyle() {
            if (this.current.kind !== 'image') return null
            return {
                transform: `translate(${this.imgX}px, ${this.imgY}px) scale(${this.imgScale})`,
                transition: this.imgDragging ? 'none' : 'transform 0.15s ease'
            }
        },
        /* v1.0.0：视频画面缩放 transform（双指捏合），与图片同一套「中点锚定」数学 */
        videoStyle() {
            if (this.current.kind !== 'video') return null
            if (this.vidScale === 1 && this.vidX === 0 && this.vidY === 0) return null
            return {
                transform: `translate(${this.vidX}px, ${this.vidY}px) scale(${this.vidScale})`,
                transition: this.vidPinching || this.vidDragging ? 'none' : 'transform 0.15s ease'
            }
        },
        /**
         * v3.0.0（第三轮）：图片是否处于「非适应窗口」状态（实际大小，或被滚轮/双击放大）。
         * 这种状态下横向滑动是给图片自己移动用的，不能再翻页。
         */
        imageEnlarged() {
            if (this.current.kind !== 'image') return false
            return this.fitMode === 'actual' || Number(this.imgScale) > 1.01
        },
        /**
         * v1.1.3：视频画面是否被双指放大过。
         * 放大后横向 / 竖向滑动都应该用来「挪画面」，而不是切上一个 / 下一个 / 随机播放——
         * 否则用户想看画面另一部分，一滑就被翻走了（需求原文）。
         */
        videoEnlarged() {
            if (this.current.kind !== 'video') return false
            return Number(this.vidScale) > 1.01
        }
    },
    watch: {
        modelValue(val) {
            if (val) {
                this.index = Math.min(Math.max(0, this.startIndex), Math.max(0, (this.items || []).length - 1))
                this.videoMenuOpen = false
                this.slideMenuOpen = false
                this.tocOpen = false
                this.outlineOpen = false
                this.silent = false
                this.videoMuted = false
                this.longPress3x = false
                this.fitMode = 'fit'
                // v1.0.4：每次打开都重新走「缩略图占位 → 原图淡入」
                this.imageLoaded = false
                this.resetImageZoom()
                this.resetVideoZoom()
                this.controlsVisible = true
                this.audioIndex = Math.max(0, this.audioItems.findIndex(a => a.key === this.current.key))
                // v3.0.0：文本类预览按需拉取内容
                this.loadTextPreview()
                this.$nextTick(() => {
                    this.applyVideoSettings()
                    this.scrollThumbIntoView()
                    // v3.0.0 打开即视频：muted 自动播放，起播后尝试取消静音
                    if (this.current.kind === 'video') this.autoplayVideo(true)
                    // v3.0.0（R8）打开即音频：自动播放（打开动作本身带用户手势，一般不会被拦）
                    if (this.current.kind === 'audio') this.autoplayAudio()
                })
                this.bumpControls()
                this.bindKeys(true)
                // v1.1.4：接管屏幕两侧边缘的退出手势（滑动 = 关灯箱，不后退页面）
                this.bindEdgeBack(true)
                // v1.1.4：视频进入即读一次上次播放点（提示行只在有记忆时出现）
                this.refreshResumeAt()
                // v3.0.0 打开时压一条历史哨兵：移动端返回键只关灯箱，不退出页面
                this.pushHistorySentinel()
            } else {
                this.stopSlideshow()
                this.clearHideTimer()
                this.clearLongPress()
                // v3.0.0 关闭 / 切走时把长按 3x 恢复成用户选择的倍速，避免下次打开还是 3x
                this.endLongPress3x()
                this.endImgDrag()
                this.bindKeys(false)
                this.bindEdgeBack(false)
                this.pauseAll()
                // v3.0.0（R16）：关闭时退出横屏 / 全屏，清掉抓拍面板
                this.resetVideoLandscape()
                this.resetVideoZoom()
                this.snapshotPrompt = null
                this.snapshotUploaded = null
                this.snapshotError = ''
                this.videoLandscape = false
                // v3.0.0 关闭时清掉 popstate 监听并归还哨兵，避免多压历史
                this.releaseHistorySentinel()
            }
        },
        index() {
            /*
             * v1.1.3：切换时顺便预取相邻的图片。
             * 之前每翻一张都是「点下去才开始下载原图」，大图要等 1~2 秒，观感就是卡。
             * 这里在切完之后空闲时预取前后各一张（只预取图片，视频不预取 ——
             * 预取视频等于替用户下载几十 MB，得不偿失），用 new Image() 落浏览器缓存，
             * 下一次翻页直接命中，不再有黑屏等待。
             */
            // v1.1.4：切集前把上一条视频的播放点落地，再读这一条的记忆
            this.flushResume()
            this.preloadNearbyImages()
            this.videoMenuOpen = false
            this.tocOpen = false
            // v3.0.0（R8）：切集收起大纲面板
            this.outlineOpen = false
            // v3.0.0 切集：长按 3x 状态与临时倍速一并作废，新视频回到用户选择的倍速
            this.endLongPress3x()
            // v3.0.0（R16）：切走视频 / 关闭横屏状态
            if (this.current.kind !== 'video') this.resetVideoLandscape()
            // v1.1.4：切集后重读当前这条视频的记忆点
            this.$nextTick(() => this.refreshResumeAt())
            this.resetImageZoom()
            // v1.0.4：切集重新走「缩略图占位 → 原图淡入」
            this.imageLoaded = false
            // v1.0.0：切集时视频画面缩放一并复位，新视频从原始比例开始
            this.resetVideoZoom()
            this.audioIndex = Math.max(0, this.audioItems.findIndex(a => a.key === this.current.key))
            // v3.0.0：切到文本类就重新拉一次内容（其它类型清空，避免残留上一份）
            this.loadTextPreview()
            /*
             * v3.0.0（R5）：控件处于隐藏态时，切换（左右滑动 / 键盘方向键）**不得点亮控件** ——
             * 只有用户主动点击屏幕才唤出。原实现这里无条件 bumpControls()，
             * 于是「控件已隐藏 → 滑动切下一张」会突然把整排按钮弹出来。
             */
            if (this.silent || !this.controlsVisible) this.setIdleTimer()
            else this.bumpControls()
            this.$nextTick(() => {
                this.applyVideoSettings()
                this.scrollThumbIntoView()
                // v3.0.0 切到视频：优先原声播放，被拦截则回落 muted 起播
                if (this.current.kind === 'video') this.autoplayVideo(false)
                // v3.0.0（R8）切到音频：自动播放（audio 元素被复用时 autoplay 属性不会重新触发）
                if (this.current.kind === 'audio') this.autoplayAudio()
            })
        }
    },
    beforeUnmount() {
        this.stopSlideshow()
        this.clearHideTimer()
        this.clearLongPress()
        this.endLongPress3x()
        if (this._imgMove) window.removeEventListener('mousemove', this._imgMove)
        if (this._imgUp) window.removeEventListener('mouseup', this._imgUp)
        // v3.0.0（R16）：桌面长按的 document mouseup 监听
        if (this._docMouseUp) { document.removeEventListener('mouseup', this._docMouseUp, true); this._docMouseUp = null }
        if (this._imgTapTimer) clearTimeout(this._imgTapTimer)
        // v3.0.0 卸载只摘监听，不回退历史（避免在路由切换过程中再触发一次导航）
        this.detachHistoryGuard()
        this.bindKeys(false)
        // v1.1.4：卸载时摘掉边缘退出手势监听
        this.bindEdgeBack(false)
    },
    methods: {
        /**
         * v1.1.3：预取相邻图片（前后各一张）。
         * 只对同类型列表（imageItems）里的相邻项生效 —— 灯箱的「上一页/下一页」
         * 本来就在同类型之间切换，预取别的类型没有意义。
         */
        preloadNearbyImages() {
            if (typeof window === 'undefined') return
            if (!this.current || this.current.kind !== 'image') return
            // sameKindIndexes 就是「上一页 / 下一页」实际会走的那条序列
            const list = this.sameKindIndexes || []
            const pos = list.indexOf(this.index)
            if (pos < 0) return
            this._preloaded = this._preloaded || new Set()
            for (const step of [1, -1]) {
                const nbIndex = list[pos + step]
                const nb = nbIndex === undefined ? null : (this.items || [])[nbIndex]
                if (!nb || !nb.url) continue
                if (this._preloaded.has(nb.url)) continue
                this._preloaded.add(nb.url)
                const img = new Image()
                img.decoding = 'async'
                img.src = nb.url
            }
        },

        close() {
            this.$emit('update:modelValue', false)
        },
        /* ── v1.0.0 返回键 / Esc 逐层关闭：登记到统一浮层栈 ────────────────
         * 以前这里自己往历史压哨兵并监听 popstate，文件详情页（Element Plus 弹窗）
         * 由 backGuard 另压一条哨兵 —— 一次返回被两套逻辑同时消费，详情页和灯箱
         * 一起关掉。现在两边都只往 layerStack 登记，由它统一「一次只关栈顶一层」。
         * 灯箱先开、详情页后开，所以详情页天然在灯箱上面。 */
        pushHistorySentinel() {
            registerLayer('media-viewer', () => {
                if (this.modelValue) this.close()
            });
        },
        detachHistoryGuard() {
            unregisterLayer('media-viewer');
        },
        /* ── v1.1.4：屏幕两侧边缘退出 ────────────────────────────────────────
         * 需求：移动端打开灯箱后，从屏幕左右边缘往里滑（系统的「返回」手势）时，
         * 应该退出灯箱，而不是让页面后退。做法：
         *   1) 灯箱打开时在 window 捕获阶段挂 touchstart / touchmove / touchend；
         *   2) 起手在左右 EDGE_BACK_PX 内 → 记为一次候选；横向朝内移动即 preventDefault，
         *      浏览器不再画返回动画、也不会真的导航；
         *   3) 朝内位移达到 EDGE_BACK_TRIGGER_PX → 抬手时退出：详情开着先关详情，
         *      否则关灯箱（与 layerStack「一次只关最上面一层」的口径一致）。
         * 只在打开期间挂载，关闭 / 卸载即摘除，不影响其它页面。 */
        bindEdgeBack(on) {
            if (on) {
                if (this._edgeBackStart) return;
                this._edgeBackStart = (e) => this.onEdgeBackStart(e);
                this._edgeBackMove = (e) => this.onEdgeBackMove(e);
                this._edgeBackEnd = () => this.onEdgeBackEnd();
                window.addEventListener('touchstart', this._edgeBackStart, { capture: true, passive: true });
                // touchmove 必须非 passive —— 要靠 preventDefault 吃掉浏览器的返回手势
                window.addEventListener('touchmove', this._edgeBackMove, { capture: true, passive: false });
                window.addEventListener('touchend', this._edgeBackEnd, { capture: true, passive: true });
                window.addEventListener('touchcancel', this._edgeBackEnd, { capture: true, passive: true });
            } else {
                if (this._edgeBackStart) window.removeEventListener('touchstart', this._edgeBackStart, { capture: true });
                if (this._edgeBackMove) window.removeEventListener('touchmove', this._edgeBackMove, { capture: true });
                if (this._edgeBackEnd) {
                    window.removeEventListener('touchend', this._edgeBackEnd, { capture: true });
                    window.removeEventListener('touchcancel', this._edgeBackEnd, { capture: true });
                }
                this._edgeBackStart = null;
                this._edgeBackMove = null;
                this._edgeBackEnd = null;
                this._edgeBack = null;
            }
        },
        onEdgeBackStart(e) {
            this._edgeBack = null;
            if (!this.modelValue) return;
            if (!e.touches || e.touches.length !== 1) return;
            // 只对触屏（手指）生效；桌面鼠标不会产生 touch 事件，这里不用再判设备
            const t = e.touches[0];
            const w = window.innerWidth;
            const fromLeft = t.clientX <= EDGE_BACK_PX;
            const fromRight = t.clientX >= w - EDGE_BACK_PX;
            if (!fromLeft && !fromRight) return;
            this._edgeBack = { x: t.clientX, y: t.clientY, fromLeft, fired: false };
        },
        onEdgeBackMove(e) {
            const g = this._edgeBack;
            if (!g || !e.touches || e.touches.length !== 1) return;
            const t = e.touches[0];
            const dx = t.clientX - g.x;
            const dy = t.clientY - g.y;
            // 纵向占主导 = 用户在滚动内容，不当作退出
            if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
                this._edgeBack = null;
                return;
            }
            // 朝内方向：左侧边缘往右滑 / 右侧边缘往左滑
            const inward = g.fromLeft ? dx : -dx;
            if (inward < 0) return;
            // 一确认是边缘横滑就吃掉浏览器默认手势（返回动画 + 导航）
            if (inward >= 6 && e.cancelable) e.preventDefault();
            if (inward >= EDGE_BACK_TRIGGER_PX) g.fired = true;
        },
        onEdgeBackEnd() {
            const g = this._edgeBack;
            this._edgeBack = null;
            if (!g || !g.fired) return;
            // 逐层关闭：详情页开着先关详情，否则关灯箱
            if (this.detailOpen) this.$emit('close-detail');
            else this.close();
        },
        releaseHistorySentinel() {
            this.detachHistoryGuard();
        },
        /* ── v3.0.0 点击遮罩/舞台空白：幻灯片或静默状态下只恢复控件，不关闭 ── */
        onOutsideClick() {
            /*
             * v3.0.0：音频 / 其它（文档、压缩包等）模式的内容区是「全屏透明」的，
             * 随手一点就容易把预览关掉 —— 这两类改为「点空白只恢复控件，不关闭」，
             * 要退出请点右上角关闭按钮或按 Esc。
             * v3.0.0（R7）：PDF / 纯文本 / 表格同样铺满整屏透明底（见 .mv-stage.is-plain），
             * 点空白也不退出 —— 读文档时误点外围退出体验太差。
             */
            const kind = this.current && this.current.kind;
            if (this.plainKinds.includes(kind)) {
                this.silent = false;
                this.bumpControls();
                return;
            }
            if (this.silent || this.slideshowOn) {
                this.silent = false
                this.bumpControls()
                return
            }
            this.close()
        },
        /* ── 控件自动隐藏 ─────────────────────────────────── */
        /* v3.0.0：任何交互后延时 IDLE_MS（2s）再进入 idle，统一走 setIdleTimer */
        bumpControls() {
            /*
             * v3.0.0（R16）：真实交互必须同时清掉「静默态」。
             * 切下一个视频时 nextVideo() 会置 silent = true（干净画面），
             * 而根节点的 is-idle 判定是 `!controlsVisible || silent` ——
             * 只亮 controlsVisible 没用，silent 一直为真 → 鼠标一直 cursor:none、
             * 控件再也不出现。这里一并复位。
             */
            this.silent = false
            this.controlsVisible = true
            this.setIdleTimer()
        },
        setIdleTimer() {
            this.clearHideTimer()
            this.hideTimer = setTimeout(() => {
                this.hideTimer = null
                // 菜单展开时不隐藏，避免点不到按钮；收起菜单时会重新 bumpControls 计时
                if (this.videoMenuOpen || this.slideMenuOpen || this.tocOpen) return
                // v3.0.0（R12）：长按 3x 加速期间强制隐藏控件，不被计时器点亮
                if (this._lp3xActive) return
                this.controlsVisible = false
            }, IDLE_MS)
        },
        clearHideTimer() {
            if (this.hideTimer) {
                clearTimeout(this.hideTimer)
                this.hideTimer = null
            }
        },
        /* ── 切换 ─────────────────────────────────────────── */
        /**
         * v1.0.0：上一页 / 下一页只在「同类型」之间循环。
         * 原实现按 items 全长取模，图片灯箱会切到视频、PDF 会切到图片。
         * 现在取当前类型的下标列表，在其中前后移动；当前类型不足 2 个时不动。
         */
        /**
         * v1.0.1（桌面端 ↓ 键）：在同类型文件里随机跳一个（不是「下一个」）。
         * 只有一个同类型文件时什么都不做；控件显隐沿用 step() 的规则。
         */
        randomStep() {
            const pool = this.sameKindIndexes.filter((i) => i !== this.index)
            if (!pool.length) return
            this.index = pool[Math.floor(Math.random() * pool.length)]
            if (this.silent) this.setIdleTimer()
            else if (!this.controlsVisible) this.setIdleTimer()
            else this.bumpControls()
        },
        step(delta, opts) {
            const pool = this.sameKindIndexes
            if (pool.length < 2) return
            const pos = pool.indexOf(this.index)
            const base = pos >= 0 ? pos : 0
            const nextPos = (base + delta + pool.length) % pool.length
            this.index = pool[nextPos]
            /*
             * v3.0.0 静默切换（幻灯片 / 滑动）：
             *   已处于静默态 → 继续保持静默；
             *   用户刚唤出控件 → 不再立即隐藏（原来是切换瞬间就消失，观感一闪），
             *   统一交给 2s idle 计时器隐藏 —— 即「控件显示后 2 秒隐藏」。
             */
            if (opts && opts.silent) {
                if (this.silent) {
                    this.silent = true
                } else {
                    this.setIdleTimer()
                }
            } else if (!this.silent && this.controlsVisible) {
                // v3.0.0（R5）：控件已隐藏时不因切换而点亮（见 index watcher 同款说明）
                this.bumpControls()
            } else {
                this.setIdleTimer()
            }
        },
        /* ── 图片：适应窗口 / 实际大小 ────────────────────── */
        toggleFit() {
            this.fitMode = this.fitMode === 'fit' ? 'actual' : 'fit'
            this.resetImageZoom()
            this.bumpControls()
        },
        /* ── v3.0.0 PC 图片滚轮缩放（以鼠标位置为中心，0.2x ~ 5x）────── */
        onImageWheel(e) {
            if (this.isTouch || this.current.kind !== 'image') return
            const img = e.currentTarget
            if (!img) return
            const rect = img.getBoundingClientRect()
            const s0 = this.imgScale
            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
            const s1 = Math.min(5, Math.max(0.2, s0 * factor))
            if (s1 === s0) return
            // 鼠标相对「视觉中心」的偏移；缩放前后保持该点不动：offset' = offset + m * (1 - s1/s0)
            const mx = e.clientX - (rect.left + rect.width / 2)
            const my = e.clientY - (rect.top + rect.height / 2)
            this.imgX = this.imgX + mx * (1 - s1 / s0)
            this.imgY = this.imgY + my * (1 - s1 / s0)
            this.imgScale = s1
        },
        /* ── v3.0.0 PC 图片左键拖拽（手抓） ────────────────── */
        onImgMouseDown(e) {
            if (this.isTouch || e.button !== 0) return
            e.preventDefault()
            this.imgDragging = true
            const start = { x: e.clientX, y: e.clientY, ox: this.imgX, oy: this.imgY }
            let moved = false
            this._imgMove = (ev) => {
                const dx = ev.clientX - start.x
                const dy = ev.clientY - start.y
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true
                this.imgX = start.ox + dx
                this.imgY = start.oy + dy
            }
            this._imgUp = () => {
                this.endImgDrag()
                // 拖拽过则吞掉紧随其后的 click，避免误触「实际大小/适应窗口」
                if (moved) {
                    this._suppressImgClick = true
                    setTimeout(() => { this._suppressImgClick = false }, 0)
                }
            }
            window.addEventListener('mousemove', this._imgMove)
            window.addEventListener('mouseup', this._imgUp)
        },
        endImgDrag() {
            this.imgDragging = false
            if (this._imgMove) { window.removeEventListener('mousemove', this._imgMove); this._imgMove = null }
            if (this._imgUp) { window.removeEventListener('mouseup', this._imgUp); this._imgUp = null }
        },
        /* v3.0.0 PC 点击图片仍切换 实际大小/适应窗口；移动端走触摸逻辑 */
        onImageClick() {
            if (this.isTouch || this._suppressImgClick) return
            this.toggleFit()
            if (this.silent) {
                this.silent = false
                this.bumpControls()
            }
        },
        resetImageZoom() {
            this.imgScale = 1
            this.imgX = 0
            this.imgY = 0
            this.imgDragging = false
            // v1.0.0：切集 / 关闭时清掉未完成的双指缩放，避免残留手势状态吞掉下一次触摸
            this._pinch = null
        },
        /* v1.0.0：视频画面缩放复位（切集 / 关闭 / 切换画面方向时调用） */
        resetVideoZoom() {
            this.vidScale = 1
            this.vidX = 0
            this.vidY = 0
            this.vidPinching = false
            this.vidDragging = false
            this._pinch = null
        },
        /* ── v3.0.0 舞台触摸：滑动切换 / 长按 3 倍速 / 轻点与双击 ───── */
        onStageTouchStart(e) {
            // v1.1.4：这次触摸是屏幕边缘的「退出」手势 —— 舞台不接管（否则会顺手翻页）
            if (this._edgeBack) {
                this._tStart = null
                return
            }
            const t = e.touches && e.touches[0]
            if (!t) return
            // 按钮与菜单上的触摸不走手势逻辑
            const tg = e.target
            if (tg && tg.closest && tg.closest('button, .mv-menu-panel')) return
            /*
             * v1.0.0：图片 / 视频灯箱双指缩放 —— 只要有 2 根手指落在舞台上就进入缩放手势，
             * 并作废「滑动切页 / 轻点 / 长按」判定（否则捏合会被当成一次拖动）。
             * 缩放锚点为两指中点，缩放范围与 PC 滚轮一致（0.2x ~ 5x）。
             * v1.0.0：视频画面同样支持，状态走 vidScale/vidX/vidY。
             */
            if (e.touches.length >= 2 && (this.current.kind === 'image' || this.current.kind === 'video')) {
                const kind = this.current.kind
                this.clearLongPress()
                this._tStart = null
                this._tMoved = true
                this._tPanning = false
                const a = e.touches[0]
                const b = e.touches[1]
                this._pinch = {
                    kind,
                    startDist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1,
                    startScale: kind === 'video' ? (Number(this.vidScale) || 1) : (Number(this.imgScale) || 1)
                }
                if (kind === 'video') this.vidPinching = true
                else this.imgDragging = true
                return
            }
            this._tStart = { x: t.clientX, y: t.clientY }
            this._tMoved = false
            // v3.0.0（第三轮）：放大态图片的横向拖动 —— 记录上一个触点位置
            this._tLast = { x: t.clientX, y: t.clientY }
            this._tPanning = false
            // v3.0.0 记录「手势开始前控件是否本来就可见」。
            // 原实现在 handleImageTap 的 250ms 定时器里用「当时那一刻的 controlsVisible」
            // 判断这次轻点是唤出还是收起 —— 唤出把控件点亮后，判定读到的是刚点亮的 true，
            // 于是紧接着就被当成「收起」执行，用户感觉点了才出来就没了。
            // 改成以手势开始前的状态为准，唤出后一律重新走 IDLE_MS(2s) 计时。
            this._wasVisibleAtGesture = this.controlsVisible && !this.silent
            // 视频模式：按住 LONG_PRESS_MS 且未滑动 → 临时 3 倍速
            this.clearLongPress()
            if (this.current.kind === 'video') this.armLongPress()
        },
        onStageTouchMove(e) {
            /*
             * v1.0.0：双指缩放（图片灯箱）。
             * 每帧都用「手势起始比例 × 当前两指距离比」算绝对缩放值，
             * 避免逐帧累乘带来的抖动；锚点取当前两指中点，
             * 缩放后中点在屏幕上的位置保持不变（与 PC 滚轮缩放同一套公式）。
             */
            if (this._pinch && e.touches && e.touches.length >= 2) {
                const a = e.touches[0]
                const b = e.touches[1]
                const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1
                const s1 = Math.min(5, Math.max(0.2, this._pinch.startScale * (dist / this._pinch.startDist)))
                // v1.0.0：视频画面走自己的一套变量，锚点取 <video> 当前视觉中心
                if (this._pinch.kind === 'video') {
                    const s0 = Number(this.vidScale) || 1
                    if (Math.abs(s1 - s0) > 0.001) {
                        const v = this.$refs.videoEl
                        if (v && typeof v.getBoundingClientRect === 'function') {
                            const rect = v.getBoundingClientRect()
                            const mx = (a.clientX + b.clientX) / 2 - (rect.left + rect.width / 2)
                            const my = (a.clientY + b.clientY) / 2 - (rect.top + rect.height / 2)
                            this.vidX += mx * (1 - s1 / s0)
                            this.vidY += my * (1 - s1 / s0)
                        }
                        this.vidScale = s1
                    }
                    if (e.cancelable) e.preventDefault()
                    return
                }
                const s0 = Number(this.imgScale) || 1
                if (Math.abs(s1 - s0) > 0.001) {
                    const img = this.$refs.imageEl
                    if (img && typeof img.getBoundingClientRect === 'function') {
                        const rect = img.getBoundingClientRect()
                        // getBoundingClientRect 已包含 transform，rect 中心就是图片当前视觉中心
                        const mx = (a.clientX + b.clientX) / 2 - (rect.left + rect.width / 2)
                        const my = (a.clientY + b.clientY) / 2 - (rect.top + rect.height / 2)
                        this.imgX += mx * (1 - s1 / s0)
                        this.imgY += my * (1 - s1 / s0)
                    }
                    this.imgScale = s1
                }
                if (e.cancelable) e.preventDefault()
                return
            }
            const t = e.touches && e.touches[0]
            if (!t || !this._tStart) return
            const dx = Math.abs(t.clientX - this._tStart.x)
            const dy = Math.abs(t.clientY - this._tStart.y)
            if (dx > 10 || dy > 10) this._tMoved = true
            /*
             * v3.0.0（第三轮）：图片处于放大 / 实际大小时，滑动改为拖动图片本身
             * （不再翻页，见 onStageTouchEnd 的 imageEnlarged 判断）。
             */
            if (this.current.kind === 'image' && this.imageEnlarged && this._tLast) {
                if (this._tMoved) {
                    this.imgDragging = true
                    this.imgX += t.clientX - this._tLast.x
                    this.imgY += t.clientY - this._tLast.y
                    this._tPanning = true
                    if (e.cancelable) e.preventDefault()
                }
                this._tLast = { x: t.clientX, y: t.clientY }
            }
            /*
             * v1.1.3：视频被双指放大后，滑动改为**移动视频画面**（与图片放大态同一套逻辑）——
             * 此时不能再触发「切上一个/下一个」和「上拉随机播放」。
             */
            if (this.current.kind === 'video' && this.videoEnlarged && this._tLast) {
                if (this._tMoved) {
                    this.vidDragging = true
                    this.vidX += t.clientX - this._tLast.x
                    this.vidY += t.clientY - this._tLast.y
                    this._tPanning = true
                    if (e.cancelable) e.preventDefault()
                }
                this._tLast = { x: t.clientX, y: t.clientY }
            }
            // 只有真的滑出去了才作废长按；阈值给到 16px，避免手指微抖就取消
            if (dx > LONG_PRESS_CANCEL_PX || dy > LONG_PRESS_CANCEL_PX) this.clearLongPress()
        },
        onStageTouchEnd(e) {
            /*
             * v1.0.0：双指缩放收尾 —— 抬起任意一根手指即结束缩放。
             * 缩小到小于「适应窗口」时回弹到 1x，避免图片缩成很小一块飘在中间。
             * 这里标记 _tMoved = true 并清空 _tStart，确保这一串触摸不会被误判成轻点/翻页。
             */
            if (this._pinch) {
                if (!e.touches || e.touches.length < 2) {
                    const pinchingVideo = this._pinch.kind === 'video'
                    this._pinch = null
                    this._tStart = null
                    this._tMoved = true
                    this.imgDragging = false
                    this.vidPinching = false
                    if (pinchingVideo) {
                        // 视频缩到比原始画面还小时回弹，避免画面缩成一小块飘在中间
                        if ((Number(this.vidScale) || 1) < 1) this.resetVideoZoom()
                    } else if ((Number(this.imgScale) || 1) < 1) {
                        this.resetImageZoom()
                    }
                    if (this.silent) this.setIdleTimer()
                }
                return
            }
            const wasLongPress = this.endLongPress3x()
            // document 兜底可能已经先结束了长按，这里再用时间窗口兜一次，避免误判成轻点
            const justEndedLp = this._lpEndedAt && Date.now() - this._lpEndedAt < 400
            if (wasLongPress || justEndedLp) {
                this._lpEndedAt = 0
                this._tStart = null
                return
            }
            const st = this._tStart
            this._tStart = null
            this._tLast = null
            if (this._tPanning) {
                // 拖动过图片 / 放大后的视频：结束拖拽态（transition 恢复），不算轻点 / 更不翻页
                this._tPanning = false
                this.imgDragging = false
                this.vidDragging = false
                return
            }
            if (!st) return
            const tg = e.target
            if (tg && tg.closest && tg.closest('button, .mv-menu-panel')) return
            const t = e.changedTouches && e.changedTouches[0]
            const dx = t ? t.clientX - st.x : 0
            const dy = t ? t.clientY - st.y : 0
            // 所有模式：左右滑动（阈值 60px）切换上/下一个，切换后保持静默
            if (this._tMoved && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
                /*
                 * v3.0.0（第三轮）：图片被放大（实际大小 / 缩放 > 1）时，横向滑动是用来
                 * 拖动看图片另一部分的，直接翻页会让用户看不到想看的地方 ——
                 * 只有「适应窗口」状态才允许滑动切换上/下一个。
                 */
                if (this.imageEnlarged || this.videoEnlarged) return
                this.step(dx < 0 ? 1 : -1, { silent: true })
                return
            }
            /*
             * v3.0.0（R14）竖向手势（图片 / 视频 / 音频灯箱）：
             *   · 上拉（dy < -60）→ 随机切到同类型的一个媒体（图片→图片、视频→视频、音频→音频，保持静默）；
             *   · 下拉（dy > 60）→ 执行「详情」（打开文件详情页，灯箱保留在下面）。
             * 页面跟随滚动已在 .mv-image-wrap / .mv-video-wrap 上用 touch-action:none 禁掉。
             */
            if (this._tMoved && Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx)) {
                const kind = this.current.kind
                if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return
                if (kind === 'image' && this.imageEnlarged) return
                // v1.1.3：视频放大后，竖滑同样是在挪画面，不触发「上拉随机 / 下拉详情」
                if (kind === 'video' && this.videoEnlarged) return
                if (dy < 0) {
                    const sameKind = (this.items || [])
                        .map((it, i) => (it.kind === kind ? i : -1))
                        .filter(i => i >= 0)
                    if (!sameKind.length) return
                    const pool = sameKind.length > 1 ? sameKind.filter(i => i !== this.index) : sameKind
                    this.silent = true
                    this.index = pool[Math.floor(Math.random() * pool.length)]
                    this.$nextTick(() => {
                        if (this.current.kind === 'video') {
                            const v = this.$refs.videoEl
                            if (v) v.play().catch(() => {})
                        }
                    })
                    /*
                     * v1.0.9：已落库的文件（current.recordId 有值）下拉 → 打开它在图床里的
                     * 文件详情页；未落库才回落到「当前预览项」的元数据弹窗（showDetail）。
                     * 旧实现只看 showDetail，而本地文件页不接详情事件，于是下拉毫无反应。
                     */
                } else if (this.current.recordId) {
                    this.openRecordDetail()
                } else if (this.showDetail) {
                    this.goDetail()
                }
                return
            }
            if (this._tMoved) return
            if (this.current.kind === 'image') {
                // 移动端图片：单击（延迟 250ms 区分双击）切换控件，双击切换尺寸比例
                this.handleImageTap()
            } else if (this.current.kind === 'video') {
                /*
                 * v3.0.0（R7）：移动端视频「点屏幕」切换控件显隐。
                 * 原实现只 bumpControls()（永远点亮），于是把控件藏起来后再点屏幕毫无反应，
                 * 用户只能等 2 秒自动隐藏、也无法手动收起。现在按「手势开始前是否可见」取反：
                 *   可见 → 立即收起；不可见 → 唤出并重新计时。
                 */
                const wasVisible = this._wasVisibleAtGesture === true
                this.silent = false
                if (wasVisible) {
                    this.clearHideTimer()
                    this.controlsVisible = false
                } else {
                    this.bumpControls()
                }
            } else {
                this.silent = false
                this.bumpControls()
            }
        },
        onStageTouchCancel() {
            this.endLongPress3x()
            this._lpEndedAt = 0
            this._tStart = null
            this._tLast = null
            this._tPanning = false
            this._pinch = null
            this.imgDragging = false
            this.vidPinching = false
        },
        clearLongPress() {
            if (this._lpTimer) {
                clearTimeout(this._lpTimer)
                this._lpTimer = null
            }
        },
        /* ── v3.0.0 移动端长按 3 倍速 ─────────────────────────────────
         * 原实现为什么没生效（排查结论）：
         *   1) 只在 touchend 里改 playbackRate，而真正的 3x 是 500ms 定时器里写的；
         *      移动端 <video controls> 的原生控件层 + 长按系统「保存视频」菜单会吃掉
         *      舞台上的 touchend（先收到 touchcancel），于是 3x 刚生效就被回滚，
         *      用户只看到「3x」角标一闪 → 体感「只显示了提示没加速」。
         *   2) 定时器里保存的是 v.playbackRate（DOM 当时的真实值），松手却用
         *      this.videoRate 恢复；两者一旦不同步（切集后新 video 的 playbackRate
         *      还是默认 1，而 videoRate 可能是 2）就会恢复成错的值。
         *   3) 计时器 500ms 期间任何 applyVideoSettings()（切集、改倍速、改播放模式）
         *      都会把 playbackRate 覆写回 videoRate，角标还在但速度已经回去了。
         *   4) 滑动判定阈值只有 10px，长按期间手指微抖就会 clearLongPress，800ms 也不触发。
         * 现在的做法：
         *   · touchstart 立刻单独保存「用户原本选择的倍速」到 _lpBaseRate（不被 3 覆盖）；
         *   · 500ms 未滑动 → 写 playbackRate = 3（用 refs.videoEl，就是当前这个 video），
         *     并在 document 上挂 capture 阶段的 touchend/touchcancel 兜底恢复
         *     （原生控件吞掉舞台事件时也能恢复，不会一直卡在 3x）；
         *   · 用 @ratechange 兜底：长按期间若被外部改回其它速率，立即重新写回 3；
         *   · applyVideoSettings() 在长按期间直接跳过，不再覆盖；
         *   · 松手 / touchcancel / 切集 / 关闭灯箱都走 endLongPress3x() 恢复 _lpBaseRate。
         * 倍速取舍：长按一律按 3x（即使原速本来就是 3x / 4x 也统一成 3x），
         *   这样角标「3x」与实际速度永远一致；4x 用户松手后回到 4x 能明显感知。 */
        armLongPress() {
            this.clearLongPress()
            this._lpTimer = setTimeout(() => {
                this._lpTimer = null
                this.enterLongPress3x()
            }, LONG_PRESS_MS)
        },
        enterLongPress3x() {
            const v = this.$refs.videoEl
            if (!v || this.current.kind !== 'video') return
            // 用户原本选择的倍速单独存一份，绝不被 3 覆盖
            this._lpBaseRate = Number(this.videoRate) || 1
            this._lp3xActive = true
            this._lpEndedAt = 0
            this.longPress3x = true
            // v3.0.0（R12）：长按加速期间不显示控件（松手后保持隐藏，点屏幕再唤出）
            this.clearHideTimer()
            this.controlsVisible = false
            this.applyLongPressRate()
            // 兜底：原生控件层可能吞掉舞台的 touchend，只能在 document 上补一层
            if (!this._docLpEnd) {
                this._docLpEnd = () => { this.endLongPress3x() }
                document.addEventListener('touchend', this._docLpEnd, true)
                document.addEventListener('touchcancel', this._docLpEnd, true)
            }
        },
        applyLongPressRate() {
            const v = this.$refs.videoEl
            if (!v || !this._lp3xActive) return
            try { v.playbackRate = LONG_PRESS_RATE } catch (e) { /* 忽略：部分内核限制设置时机 */ }
        },
        /* 长按期间被外部（原生控件 / 切集 / 别的设置）改回其它速率 → 立刻补回 3x */
        onVideoRateChange() {
            const v = this.$refs.videoEl
            if (!v || !this._lp3xActive) return
            if (Math.abs(v.playbackRate - LONG_PRESS_RATE) > 0.001) this.applyLongPressRate()
        },
        /* 结束长按（松手 / cancel / 切集 / 关闭）：恢复用户原本选择的倍速 */
        endLongPress3x() {
            this.clearLongPress()
            if (this._docLpEnd) {
                document.removeEventListener('touchend', this._docLpEnd, true)
                document.removeEventListener('touchcancel', this._docLpEnd, true)
                this._docLpEnd = null
            }
            const active = !!this._lp3xActive
            this._lp3xActive = false
            this.longPress3x = false
            if (!active) {
                this._lpBaseRate = 0
                return false
            }
            const v = this.$refs.videoEl
            const base = this._lpBaseRate || this.videoRate || 1
            if (v) { try { v.playbackRate = base } catch (e) { /* 忽略 */ } }
            this._lpBaseRate = 0
            // 标记刚结束，供 touchend 判断「这次轻点来自长按手势」，
            // 无论 document 兜底和舞台 touchend 谁先跑都不会误判成轻点
            this._lpEndedAt = Date.now()
            return true
        },
        /* ── v3.0.0（R16）：桌面端长按鼠标左键 = 3 倍速 ──────────────
         * 与移动端长按同一套 enterLongPress3x/endLongPress3x，
         * 只是入口从 touchstart 换成 mousedown（左键），松手/离开窗口都恢复。 */
        onVideoMouseDown(e) {
            if (this.isTouch || (e && e.button !== 0)) return
            this.clearLongPress()
            this._lpTimer = setTimeout(() => {
                this._lpTimer = null
                this.enterLongPress3x()
            }, LONG_PRESS_MS)
            if (!this._docMouseUp) {
                this._docMouseUp = () => this.onVideoMouseEnd()
                document.addEventListener('mouseup', this._docMouseUp, true)
            }
        },
        onVideoMouseEnd() {
            if (this._docMouseUp) {
                document.removeEventListener('mouseup', this._docMouseUp, true)
                this._docMouseUp = null
            }
            this.clearLongPress()
            this.endLongPress3x()
        },
        /*
         * v3.0.0（R16）：视频横屏播放。
         *   移动端：优先全屏 + 屏幕方向锁定（Android Chrome）；不支持锁定时
         *           用 CSS 旋转 90° 兜底（iOS Safari / 微信内置浏览器）。
         *   桌面端：横屏 = 浏览器全屏（桌面屏幕本身就是横向）。
         */
        async setVideoLandscape(on) {
            if (this.videoLandscape === on) return
            this.videoLandscape = on
            this.videoMenuOpen = false
            this.bumpControls()
            const root = this.$el
            try {
                if (on) {
                    if (root && root.requestFullscreen && !document.fullscreenElement) {
                        await root.requestFullscreen().catch(() => {})
                    }
                    let locked = false
                    const so = window.screen && window.screen.orientation
                    if (this.isTouch && so && typeof so.lock === 'function') {
                        try {
                            await so.lock('landscape')
                            locked = true
                        } catch (e) { /* 不支持 / 被拒绝 → 走 CSS 旋转 */ }
                    }
                    this.landscapeCss = this.isTouch && !locked
                } else {
                    this.landscapeCss = false
                    const so = window.screen && window.screen.orientation
                    if (so && typeof so.unlock === 'function') {
                        try { so.unlock() } catch (e) { /* 忽略 */ }
                    }
                    if (document.fullscreenElement && document.exitFullscreen) {
                        await document.exitFullscreen().catch(() => {})
                    }
                }
            } catch (e) {
                this.landscapeCss = on && this.isTouch
            }
            this.bumpControls()
        },
        /* 关闭灯箱 / 切到非视频：退出横屏与全屏，避免状态残留到下一次打开 */
        resetVideoLandscape() {
            if (!this.videoLandscape && !this.landscapeCss) return
            this.videoLandscape = false
            this.landscapeCss = false
            const so = window.screen && window.screen.orientation
            if (so && typeof so.unlock === 'function') {
                try { so.unlock() } catch (e) { /* 忽略 */ }
            }
            if (document.fullscreenElement && document.exitFullscreen) {
                document.exitFullscreen().catch(() => {})
            }
        },
        /* v3.0.0 移动端图片：单击=切换操作按钮与文件名；双击=切换 实际大小/适应窗口 */
        handleImageTap() {
            const now = Date.now()
            if (this._lastImgTap && now - this._lastImgTap < 300) {
                if (this._imgTapTimer) { clearTimeout(this._imgTapTimer); this._imgTapTimer = null }
                this._lastImgTap = 0
                this.toggleFit()
                this.silent = false
                this.bumpControls()
            } else {
                this._lastImgTap = now
                if (this._imgTapTimer) clearTimeout(this._imgTapTimer)
                // v3.0.0 用「手势开始前」的可见状态决定这次是唤出还是收起，
                // 唤出后统一等 IDLE_MS(2s) 再 idle，不再点了就消失
                const wasVisible = this._wasVisibleAtGesture === true
                this._imgTapTimer = setTimeout(() => {
                    this._imgTapTimer = null
                    this.silent = false
                    if (wasVisible) {
                        this.clearHideTimer()
                        this.controlsVisible = false
                    } else {
                        this.bumpControls()
                    }
                }, 250)
            }
        },
        /* ── 图片：幻灯片 ─────────────────────────────────── */
        toggleSlideshow() {
            if (this.slideshowOn) {
                this.stopSlideshow()
            } else {
                this.slideshowOn = true
                this.scheduleSlide()
            }
            this.bumpControls()
        },
        scheduleSlide() {
            this.clearSlideTimer()
            // v3.0.0 幻灯片自动切换时静默：隐藏操作按钮与文件名，直到点击屏幕
            this.slideTimer = setInterval(() => this.step(1, { silent: true }), Math.max(1, this.slideSpeed) * 1000)
        },
        clearSlideTimer() {
            if (this.slideTimer) {
                clearInterval(this.slideTimer)
                this.slideTimer = null
            }
        },
        stopSlideshow() {
            this.slideshowOn = false
            this.clearSlideTimer()
        },
        toggleSlideMenu() {
            this.slideMenuOpen = !this.slideMenuOpen
            this.bumpControls()
        },
        setSlideSpeed(sec) {
            this.slideSpeed = Number(sec) || 3
            this.slideMenuOpen = false
            if (this.slideshowOn) this.scheduleSlide()
            this.bumpControls()
        },
        /* ── v3.0.0（R8）：md 目录大纲 ─────────────────────── */
        toggleOutline() {
            this.outlineOpen = !this.outlineOpen
            this.bumpControls()
        },
        /** 点击大纲项：滚动 Markdown 正文到对应标题行 */
        jumpToOutline(h) {
            const box = this.$refs.textBody
            if (!box) return
            const el = box.querySelector(`[data-line="${h.line}"]`)
            if (!el) return
            // mv-text-body 设了 position:relative，offsetTop 即相对正文容器
            box.scrollTop = Math.max(0, el.offsetTop - 10)
        },
        /* ── v3.0.0（R8）：缩放栏 ±10%（与滚轮缩放同一套 imgScale 变量） ── */
        zoomStep(dir) {
            if (this.current.kind !== 'image') return
            const s0 = Number(this.imgScale) || 1
            const factor = dir > 0 ? 1.1 : 1 / 1.1
            let s1 = Math.min(5, Math.max(0.2, s0 * factor))
            if (dir < 0 && s1 <= 1.01 && this.fitMode !== 'actual') {
                // 缩到不大于适应窗口就回正，避免留下缩过头的小图
                this.fitMode = 'fit'
                this.resetImageZoom()
                this.resetVideoZoom()
                this.bumpControls()
                return
            }
            this.imgScale = s1
            this.bumpControls()
        },
        /* ── 视频设置 ─────────────────────────────────────── */
        toggleVideoMenu() {
            this.videoMenuOpen = !this.videoMenuOpen
            if (this.videoMenuOpen) this.tocOpen = false
            this.bumpControls()
        },
        /* v3.0.0 左下角视频目录 */
        toggleToc() {
            this.tocOpen = !this.tocOpen
            if (this.tocOpen) this.videoMenuOpen = false
            this.bumpControls()
        },
        goToVideo(i) {
            this.tocOpen = false
            if (i === this.index) {
                this.bumpControls()
                return
            }
            this.index = i
            this.bumpControls()
        },
        applyVideoSettings() {
            const v = this.$refs.videoEl
            if (!v) return
            // v3.0.0 长按 3 倍速期间不允许被设置同步覆盖（否则角标还在、速度已回到原值）
            if (this._lp3xActive) return
            try {
                v.playbackRate = this.videoRate
                // 单片循环用原生 loop；单次播放/随机/顺序由 ended 事件接管
                v.loop = this.videoMode === 'single'
            } catch (e) { /* 忽略：部分浏览器限制设置时机 */ }
        },
        setVideoRate(rate) {
            this.videoRate = Number(rate) || 1
            // 长按进行中被改倍速：同步更新底色倍速，松手时恢复到新选择
            if (this._lp3xActive) this._lpBaseRate = this.videoRate
            this.applyVideoSettings()
            this.bumpControls()
        },
        setVideoMode(mode) {
            this.videoMode = mode
            this.applyVideoSettings()
            this.bumpControls()
        },
        /* ── v3.0.0 视频自动播放：muted 起播绕过限制，起播后尝试取消静音 ── */
        autoplayVideo(forceMuted) {
            const v = this.$refs.videoEl
            if (!v) return
            if (forceMuted) {
                try { v.muted = true } catch (e) { /* 忽略 */ }
                this.videoMuted = true
                const p = v.play()
                if (p && p.then) {
                    p.then(() => {
                        // 起播成功后尝试恢复声音
                        try { v.muted = false } catch (e) { /* 忽略 */ }
                    }).catch(() => { /* 保持静音，界面保留取消静音按钮 */ })
                }
            } else {
                const p = v.play()
                if (p && p.then) {
                    p.catch(() => {
                        // 原声播放被拦截：回落 muted 起播
                        try { v.muted = true } catch (e) { /* 忽略 */ }
                        this.videoMuted = true
                        const p2 = v.play()
                        if (p2 && p2.catch) p2.catch(() => {})
                    })
                }
            }
        },
        unmuteVideo() {
            const v = this.$refs.videoEl
            if (!v) return
            try { v.muted = false } catch (e) { /* 忽略 */ }
            this.videoMuted = false
            if (v.paused) v.play().catch(() => {})
        },
        syncVideoMuted() {
            const v = this.$refs.videoEl
            if (v) this.videoMuted = !!v.muted
        },
        handleVideoEnded() {
            if (this.current.kind !== 'video') return
            // v3.0.0 单次播放：播完即停
            if (this.videoMode === 'once') return
            if (this.videoMode === 'single') {
                // loop 已生效，这里是兜底
                const v = this.$refs.videoEl
                if (v) { v.currentTime = 0; v.play().catch(() => {}) }
                return
            }
            const videoIndexes = (this.items || [])
                .map((it, i) => (it.kind === 'video' ? i : -1))
                .filter(i => i >= 0)
            if (videoIndexes.length < 2) return
            /*
             * v1.0.0 静默自动切集：只换片源并接着播，不弹自定义控件、不动光标。
             * 同时把 controlsVisible 收掉，保证切换那一刻不会有控件「闪一下」，
             * 用户移动鼠标或点击屏幕时再由 bumpControls() 正常唤出。
             */
            this.silent = true
            this.clearHideTimer()
            this.controlsVisible = false
            if (this.videoMode === 'random') {
                const others = videoIndexes.filter(i => i !== this.index)
                this.index = others[Math.floor(Math.random() * others.length)]
            } else {
                const pos = videoIndexes.indexOf(this.index)
                this.index = videoIndexes[(pos + 1) % videoIndexes.length]
            }
            this.$nextTick(() => {
                const v = this.$refs.videoEl
                if (v) v.play().catch(() => {})
            })
        },
        /* ── v3.0.0 文本预览 ──────────────────────────────── */
        /**
         * 读取文本类文件（txt / md / json / log / csv / 代码…）并渲染。
         * - 用 fetch + arrayBuffer，按 UTF-8 解码（非法字节替换，不抛错）
         * - 超过 TEXT_PREVIEW_MAX（200KB）截断，并在标题栏提示
         * - 用递增 token 丢弃过期请求，避免快速切换时旧内容覆盖新文件
         */
        async loadTextPreview() {
            const cur = this.current;
            this.textTruncated = false;
            // v3.0.0（R7）：表格预览（csv/tsv）和文本预览共用同一份读文件逻辑
            if (!cur || (cur.kind !== 'text' && cur.kind !== 'table') || !cur.url) {
                this.textContent = '';
                this.textLoading = false;
                this._textToken = (this._textToken || 0) + 1;
                return;
            }
            const token = (this._textToken = (this._textToken || 0) + 1);
            this.textLoading = true;
            this.textContent = '';
            try {
                const res = await fetch(cur.url, { credentials: 'include' });
                if (!res.ok) throw new Error(String(res.status));
                const buf = await res.arrayBuffer();
                let bytes = new Uint8Array(buf);
                if (bytes.byteLength > TEXT_PREVIEW_MAX) {
                    bytes = bytes.slice(0, TEXT_PREVIEW_MAX);
                    this.textTruncated = true;
                }
                if (token !== this._textToken) return;
                this.textContent = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
            } catch (e) {
                if (token === this._textToken) this.textContent = this.$t('mediaViewer.textFailed');
            } finally {
                if (token === this._textToken) this.textLoading = false;
            }
        },
        /* ── 音频 ─────────────────────────────────────────── */
        playAudioAt(i) {
            const target = this.audioItems[i]
            if (!target) return
            const at = (this.items || []).findIndex(it => it.key === target.key)
            if (at < 0) return
            this.audioIndex = i
            this.index = at
            this.$nextTick(() => {
                const a = this.$refs.audioEl
                if (a) a.play().catch(() => {})
            })
            this.bumpControls()
        },
        /**
         * v3.0.0：按「播放模式」决定音频播完后做什么 ——
         *   once     单次播放：播完即停
         *   single   单曲循环：同一首重新播放（原生 loop 已处理，这里是兜底）
         *   random   随机播放：随机切到列表内另一首
         *   sequence 顺序播放：下一首，最后一首回到第一首
         */
        handleAudioEnded() {
            const total = this.audioItems.length
            if (!total) return;
            if (this.audioMode === 'once') return;
            if (this.audioMode === 'single') {
                this.playAudioAt(this.audioIndex);
                return;
            }
            if (total < 2) {
                if (this.audioMode !== 'once') this.playAudioAt(this.audioIndex);
                return;
            }
            if (this.audioMode === 'random') {
                let next = this.audioIndex;
                while (next === this.audioIndex) next = Math.floor(Math.random() * total);
                this.playAudioAt(next);
                return;
            }
            this.playAudioAt((this.audioIndex + 1) % total);
        },
        /** v3.0.0：切换音频播放模式（同步原生 loop 属性） */
        setAudioMode(mode) {
            this.audioMode = mode;
            const a = this.$refs.audioEl;
            if (a) {
                try { a.loop = mode === 'single'; } catch (e) { /* 忽略 */ }
            }
            this.bumpControls();
        },
        /* ── v3.0.0（R8）：音频自动播放（补 autoplay 属性覆盖不到的路径：切集复用元素等） ── */
        autoplayAudio() {
            const a = this.$refs.audioEl
            if (!a) return
            const p = a.play()
            if (p && p.catch) p.catch(() => { /* 自动播放被拦截：保持手动播放 */ })
        },
        /* ── v3.0.0（R8）：视频抓拍 —— 把当前帧画到 canvas 并下载为 PNG ──
           v3.0.0（R9-F）：①文件名直接用「原文件名.png」，重名自动加序号；
                           ②下载后询问是否一键上传到图床。
           v3.0.0（R17）：①点抓拍的同时把视频暂停（截到的就是用户看到的那一帧，也不容易糊）；
                          ②命名改为「视频原名-HHMMSS.png」，时间取当前播放位置。 */
        snapshotVideo() {
            const v = this.$refs.videoEl
            if (!v || !v.videoWidth || !v.videoHeight) {
                this.$message && this.$message.warning(this.$t('mediaViewer.snapshotNoFrame'))
                return
            }
            // v3.0.0（R17）：先暂停再取帧 —— 播放中 canvas.drawImage 取到的帧与用户看到的可能差一两帧
            let pausedAt = 0
            try {
                pausedAt = Number(v.currentTime) || 0
                if (!v.paused) v.pause()
            } catch (e) { /* 忽略：pause 失败不影响抓拍 */ }
            try {
                const canvas = document.createElement('canvas')
                canvas.width = v.videoWidth
                canvas.height = v.videoHeight
                canvas.getContext('2d').drawImage(v, 0, 0)
                const url = canvas.toDataURL('image/png')
                const base = String(this.current.name || 'video').replace(/\.[^.]+$/, '') || 'video'
                const name = this.uniqueSnapshotName(`${base}-${this.snapshotTimeLabel(pausedAt)}`)
                /*
                 * v3.0.0（R16）：抓拍后一律不自动下载，也不再弹 Element Plus 的 $confirm。
                 * 移动端 a[download].click() 会把页面切到下载 / 预览上下文（灯箱像是被顶掉）；
                 * $confirm 又会挂全屏 overlay 并锁滚动 —— 两者都是「抓拍就退出灯箱」的来源。
                 * 现在改为灯箱内的轻量面板：上传到图床 / 下载 / 取消，全程不离开灯箱。
                 */
                this.snapshotPrompt = { url, name }
                this.snapshotUploaded = null
                this.snapshotError = ''
                this.bumpControls()
            } catch (e) {
                // 画面被跨域污染等极端情况才会走到这里
                this.$message && this.$message.error(this.$t('mediaViewer.snapshotFailed'))
            }
        },
        /**
         * v3.0.0（R17）：把播放秒数格式化成 HHMMSS（例 12 秒 → "000012"）。
         * 超过 99 小时按实际位数补足，不截断，避免长时间视频命名撞车。
         */
        snapshotTimeLabel(seconds) {
            const total = Math.max(0, Math.floor(Number(seconds) || 0))
            const h = Math.floor(total / 3600)
            const m = Math.floor((total % 3600) / 60)
            const s = total % 60
            const pad = (n) => String(n).padStart(2, '0')
            return `${pad(h)}${pad(m)}${pad(s)}`
        },
        /* v3.0.0（R9-F）：抓拍文件名去重 —— base.png，重名依次 base(1).png、base(2).png… */
        uniqueSnapshotName(base) {
            let name = `${base}.png`
            let n = 1
            while (this.snapshotNames[name]) {
                name = `${base}(${n}).png`
                n += 1
            }
            this.snapshotNames[name] = true
            return name
        },
        /* v3.0.0（R16）：关闭抓拍面板 */
        closeSnapshotPrompt() {
            this.snapshotPrompt = null
            this.snapshotUploaded = null
            this.snapshotError = ''
        },
        /* v3.0.0（R17）：面板里点「查看」—— 把刚上传的文件交给父组件打开详情（灯箱保持打开） */
        viewUploadedSnapshot() {
            if (!this.snapshotUploaded) return
            this.$emit('view-uploaded', { ...this.snapshotUploaded })
        },
        /* v3.0.0（R16）：显式下载抓拍图（只有用户主动点「下载」时才触发） */
        downloadSnapshot() {
            const p = this.snapshotPrompt
            if (!p) return
            try {
                const a = document.createElement('a')
                a.href = p.url
                a.download = p.name
                document.body.appendChild(a)
                a.click()
                a.remove()
                this.$message && this.$message.success(this.$t('mediaViewer.snapshotDone'))
            } catch (e) {
                this.$message && this.$message.error(this.$t('mediaViewer.snapshotFailed'))
            }
            this.snapshotPrompt = null
        },
        /* v3.0.0（R9-F）：把抓拍 PNG 一键上传到图床（走默认渠道与命名规则），全程留在灯箱内 */
        /**
         * v1.0.7：点「上传到图床」时先弹目标配置页（渠道 / 实例 / 目录），
         * 由 doUploadSnapshot 拿到选择后再真正上传。
         * 之前是直接传到后端默认值（全局主渠道 + 默认实例 + 默认目录），抓拍图没处放。
         */
        openSnapshotTarget() {
            if (!this.snapshotPrompt || this.snapshotUploading) return
            this.snapshotTarget = true
        },
        doUploadSnapshot(target) {
            this.snapshotTarget = false
            this.snapshotTargetForm = {
                channelId: target?.channelId || '',
                instanceId: target?.instanceId || '',
                uploadFolder: target?.uploadFolder || ''
            }
            this.uploadSnapshot(target)
        },
        async uploadSnapshot(target) {
            const prompt = this.snapshotPrompt
            if (!prompt) return
            const { url: dataUrl, name } = prompt
            if (this.snapshotUploading) return
            this.snapshotUploading = true
            this.snapshotError = ''
            try {
                const blob = await (await fetch(dataUrl)).blob()
                const fd = new FormData()
                fd.append('file', blob, name)
                /*
                 * v3.0.0（R12）修复「抓拍上传一直失败」：
                 * fetchWithAuth 会自动补 /api 前缀，而上传接口是根路径 POST /upload（不带 /api），
                 * 之前请求被打到 /api/upload → 404，用户永远看到「上传失败」。
                 * 这里改用原生 fetch + credentials（登录态走 HttpOnly Cookie 自动携带）。
                 * v3.0.0（R14）：上传请求带 extraTags=视频抓拍 —— 抓拍图自动打「视频抓拍」标签；
                 * 上传在灯箱内后台进行，不退出灯箱。
                 * v3.0.0（R17）：完成/失败都不再弹 $message（移动端那条提示会把灯箱顶掉），
                 * 结果直接写进面板：成功显示「已上传」+「查看」，失败显示原因并可重试。
                 */
                /*
                 * v1.0.7：把用户在配置弹窗里选的「目标渠道 / 归属实例 / 上传目录」带上去。
                 * 三者都为空时行为与旧版完全一致（走后端默认值）。
                 */
                const qs = new URLSearchParams({ extraTags: '视频抓拍' })
                const picked = target || {}
                if (picked.channelId) qs.set('channelId', String(picked.channelId))
                if (picked.instanceId) qs.set('instanceId', String(picked.instanceId))
                if (picked.uploadFolder) qs.set('uploadFolder', String(picked.uploadFolder))
                const resp = await fetch('/upload?' + qs.toString(), {
                    method: 'POST',
                    credentials: 'include',
                    body: fd,
                })
                const data = await resp.json().catch(() => null)
                const ok = resp.ok && data && (Array.isArray(data) ? data.length > 0 : data.success !== false)
                if (!ok) {
                    const msg = data && !Array.isArray(data) && data.message ? data.message : ''
                    throw new Error(msg || `HTTP ${resp.status}`)
                }
                const item = Array.isArray(data) ? data[0] : (Array.isArray(data?.data) ? data.data[0] : null)
                this.snapshotUploaded = {
                    /*
                     * v1.0.9：id 必须取上传响应的 id（File_ID）。
                     * 旧实现取 name —— 那是「文件名」，不是 File_ID，父组件拿它去
                     * /api/manage/metadata/<id> 拉详情就直接 404，表现为
                     * 「抓拍上传完成后点查看打不开详情」。name 只作兜底。
                     */
                    id: String(item?.id || item?.name || ''),
                    src: String(item?.src || ''),
                    fileName: name,
                }
                // 之后只靠面板里的「查看」，不再自动收起
                this.bumpControls()
            } catch (e) {
                this.snapshotError = (e && e.message) || ''
            } finally {
                this.snapshotUploading = false
            }
        },
        /* ── 其它类型 ─────────────────────────────────────── */
        copyLink() {
            // 浮层里的预览地址带 ?from=admin（管理员会话专用），复制出去要换成公开地址
            const url = String(this.current.url || '').replace(/([?&])from=admin(&?)/, (m, p1, p2) => (p2 ? p1 : '')).replace(/[?&]$/, '')
            if (!url) return
            const text = `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`
            const done = () => this.$message && this.$message.success(this.$t('mediaViewer.copied'))
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(() => this.fallbackCopy(text, done))
            } else {
                this.fallbackCopy(text, done)
            }
        },
        fallbackCopy(text, done) {
            try {
                const el = document.createElement('textarea')
                el.value = text
                el.style.position = 'fixed'
                el.style.opacity = '0'
                document.body.appendChild(el)
                el.select()
                document.execCommand('copy')
                document.body.removeChild(el)
                done()
            } catch (e) { /* 忽略 */ }
        },
        openLink() {
            const url = this.current.url || ''
            if (url) window.open(url, '_blank', 'noopener')
        },
        /* v3.0.0（R9-F）：打开详情不再关闭灯箱 —— 详情弹窗经 EP 全局 zIndex 提升后叠在灯箱上层，
           关闭详情后灯箱原样保留（继续浏览）。
           v3.0.0（R14）：打开详情时暂停正在播放的视频 / 音频（需求：详情页展示时媒体暂停）。 */
        goDetail() {
            this.pauseAll()
            this.$emit('detail', this.current)
        },
        /**
         * v1.0.8：打开「已落库文件」在图床里的详情页。
         * 与 goDetail 的区别：那个是「当前预览项」的元数据弹窗（父组件自己拼），
         * 这个是本地文件页专用 —— 手里的 recordId 就是图床文件 ID，交父组件去拉详情。
         */
        openRecordDetail() {
            this.pauseAll()
            this.$emit('record-detail', this.current)
        },
        /**
         * v1.0.9：点「上传到图床」先把视频 / 音频暂停。
         * 上传弹窗会盖在灯箱上，视频还在后面继续播（声音也还在），观感很差；
         * 暂停后关掉弹窗也不会自己续播，用户要看得自己点播放。
         */
        requestUpload() {
            this.pauseAll()
            this.$emit('upload', this.current)
        },
        /* ── v3.0.0（R12）：文本灯箱「复制全文」────────────────── */
        copyTextAll() {
            const text = String(this.textContent || '')
            if (!text || this.textLoading) return
            const done = () => this.$message && this.$message.success(this.$t('mediaViewer.textCopied'))
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(() => this.fallbackCopy(text, done))
            } else {
                this.fallbackCopy(text, done)
            }
        },
        /* ── 其它 ─────────────────────────────────────────── */
        scrollThumbIntoView() {
            const track = this.$refs.thumbsTrack
            if (!track) return
            const el = track.querySelector(`[data-thumb-index="${this.index}"]`)
            if (el && el.scrollIntoView) {
                el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
            }
        },
        /* ── v1.1.4：视频播放进度记忆 ────────────────────────────────────────
         * 需求：关闭视频灯箱时记住播放到哪了（存浏览器），下次打开同一个视频，
         * 在下方「目录」「设置」之间提示「上次播放记忆在 x:xx」并可一键跳转。
         * 存储键用当前项稳定的 key（没有就退化为 url），只存秒数，不存任何用户信息。 */
        resumeStorageKey(item) {
            const it = item || this.current || {};
            const id = String(it.key || it.url || '');
            return id ? `gohub:videoResume:${id}` : '';
        },
        /**
         * 播放中持续记录「当前是哪条视频、播到哪」（timeupdate，约 4 次/秒）。
         * 之所以不直接在暂停时读 video 元素：切集时 index 先变、src 随后换掉，
         * 等在 watcher 里再读就已经是下一条视频了，会把进度写到别人名下。
         */
        onVideoTimeUpdate() {
            const v = this.$refs.videoEl;
            if (!v || !v.duration) return;
            this._lastVideoPoint = {
                key: this.resumeStorageKey(),
                t: Number(v.currentTime) || 0,
                dur: Number(v.duration) || 0,
            };
        },
        /** 关闭 / 切集时落地快照；靠片头（<3s）或已到结尾（<3s）就清掉记忆 */
        flushResume() {
            const p = this._lastVideoPoint;
            if (!p || !p.key) return;
            try {
                if (p.t < 3 || (p.dur && p.t > p.dur - 3)) window.localStorage.removeItem(p.key);
                else window.localStorage.setItem(p.key, String(Math.floor(p.t)));
            } catch (e) {
                /* 隐私模式 / 存储被禁用：静默忽略，不影响播放 */
            }
            this._lastVideoPoint = null;
        },
        /** 读取当前视频的记忆点（0 = 没有） */
        readResumeAt() {
            try {
                const key = this.resumeStorageKey();
                if (!key) return 0;
                const n = Number(window.localStorage.getItem(key));
                return Number.isFinite(n) && n > 0 ? n : 0;
            } catch (e) {
                return 0;
            }
        },
        /** 打开 / 切到视频时刷新提示行 */
        refreshResumeAt() {
            this.resumeAt = this.current && this.current.kind === 'video' ? this.readResumeAt() : 0;
        },
        /** 跳到记忆的时间点 */
        jumpToResume() {
            const v = this.$refs.videoEl;
            const t = Number(this.resumeAt) || 0;
            if (v && t > 0) {
                try {
                    v.currentTime = t;
                    const p = v.play();
                    if (p && typeof p.catch === 'function') p.catch(() => undefined);
                } catch (e) { /* 忽略 */ }
            }
            this.resumeAt = 0;
            this.bumpControls();
        },
        /** 忽略这次记忆（只藏提示，不删记录 —— 下次关闭时会重新写入） */
        dismissResume() {
            this.resumeAt = 0;
        },
        pauseAll() {
            // v1.1.4：暂停前先把当前播放点落地（关闭 / 切集 / 打开详情都会走这里）
            this.flushResume()
            const v = this.$refs.videoEl
            if (v) { try { v.pause() } catch (e) { /* 忽略 */ } }
            const a = this.$refs.audioEl
            if (a) { try { a.pause() } catch (e) { /* 忽略 */ } }
        },
        bindKeys(on) {
            if (on) {
                if (this._keyHandler) return
                this._keyHandler = (e) => {
                    if (!this.modelValue) return
                    // 输入框 / 文本域里不接管方向键（避免影响光标移动）
                    const t = e.target
                    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
                    /*
                     * v1.0.1（桌面端）：
                     *   ↓ 随机切换到下一个「同类型」文件（图片只换图片、视频只换视频）；
                     *   ↑ 打开文件详情并暂停正在播放的视频 / 音频。
                     * 左右方向键仍为按顺序切上一个 / 下一个。
                     */
                    if (e.key === 'ArrowDown') {
                        const kind = this.current && this.current.kind
                        if (kind === 'image' || kind === 'video') {
                            e.preventDefault()
                            this.randomStep()
                        }
                        return
                    }
                    if (e.key === 'ArrowUp') {
                        if (this.showDetail) {
                            e.preventDefault()
                            if (this.silent || !this.controlsVisible) this.setIdleTimer()
                            // goDetail 内部会 pauseAll()，视频随之暂停
                            this.goDetail()
                        }
                        return
                    }
                    // v3.0.0（R12）：方向键切换在控件隐藏 / 静默态下保持静默（不再点亮控件），
                    // 只重置 idle 计时；Esc 仍然唤出（因为它马上就要关灯箱了）。
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        if (this.silent || !this.controlsVisible) {
                            this.setIdleTimer()
                        } else {
                            this.bumpControls()
                        }
                        this.step(e.key === 'ArrowLeft' ? -1 : 1)
                        return
                    }
                    if (e.key === 'Escape' || e.code === 'Space') {
                        this.bumpControls()
                        if (this.silent) this.silent = false
                    }
                    /*
                     * v1.0.0：Esc 不再由这里关灯箱 —— 交给 utils/layerStack 统一接管，
                     * 一次 Esc 只关最上面那一层。详情页叠在灯箱上时，Esc 应该先关详情；
                     * 原来这里无条件 close()，会和详情页的 close-on-press-escape 同时执行，
                     * 结果两层一起没。
                     */
                    if (e.code === 'Space' && this.current.kind === 'image') {
                        e.preventDefault()
                        this.toggleSlideshow()
                    }
                }
                window.addEventListener('keydown', this._keyHandler)
            } else if (this._keyHandler) {
                window.removeEventListener('keydown', this._keyHandler)
                this._keyHandler = null
            }
        }
    }
}
</script>

<style scoped>
/* ── 整体：全屏、灰系偏暗带透明度 ─────────────────────────────── */
.media-viewer {
    position: fixed;
    inset: 0;
    z-index: 3200;
    display: flex;
    flex-direction: column;
    background: rgba(18, 19, 22, 0.86);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    color: #f2f3f5;
    user-select: none;
}
.mv-backdrop {
    position: absolute;
    inset: 0;
}
.media-viewer.is-idle {
    cursor: none;
}
/*
 * v1.0.0 修复「桌面端视频自动切到下一个后鼠标消失、点不到控件」：
 * 视频播完自动切集时会把 silent 置为 true（要求静默切换、不弹自定义控件），
 * 但 is-idle 同时把光标设成 cursor:none —— 播放器用的是浏览器原生控件条，
 * 光标一消失用户就找不到鼠标、也没法拖进度条，只能盲点。
 * 视频灯箱里始终保留系统光标，静默只作用于自定义控件的显隐。
 */
.media-viewer.is-idle.is-video {
    cursor: default;
}

/* ── 顶栏 ──────────────────────────────────────────────────── */
.mv-top {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.45), transparent);
    transition: opacity 0.25s ease;
}
.media-viewer.is-idle .mv-top {
    opacity: 0;
    pointer-events: none;
}
/*
 * v3.0.0（R15）：TXT / MD 全屏化 —— 顶栏浮层化（标题 + 右侧按钮直接压在正文上层），
 * 正文区从窗口上边缘开始、到下边缘结束，不再出现「上方留一条缝」。
 */
.media-viewer.is-text .mv-top {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 9;
    background: linear-gradient(to bottom, rgba(18, 19, 22, 0.92), rgba(18, 19, 22, 0));
}
.media-viewer.is-text .mv-stage {
    padding: 0;
}
/* v3.0.0 视频全屏化布局：顶栏浮层化（absolute 覆盖在视频上层），视频区域占满整个窗口高度 */
.media-viewer.is-video .mv-top {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    background: none;
    z-index: 3;
}
.mv-title {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
    flex: 1 1 auto;
}
.mv-title-name {
    font-size: 14px;
    font-weight: 500;
    color: #fff;
    max-width: 60vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mv-title-meta {
    font-size: 12px;
    opacity: 0.65;
    flex-shrink: 0;
}
.mv-tools {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
}
.mv-tools-sep {
    width: 1px;
    height: 18px;
    background: rgba(255, 255, 255, 0.18);
    margin: 0 4px;
}
.mv-btn {
    box-sizing: border-box;
    min-width: 32px;
    height: 32px;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    color: #f2f3f5;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}
.mv-btn:hover {
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
}
.mv-btn.is-on {
    background: color-mix(in srgb, var(--primary-color, #2563EB) 70%, transparent);
    border-color: color-mix(in srgb, var(--primary-color, #2563EB) 80%, transparent);
    color: #fff;
}
.mv-btn-text {
    font-size: 12px;
    font-weight: 600;
    min-width: 40px;
}
.mv-close:hover {
    background: rgba(220, 53, 69, 0.85);
    border-color: rgba(220, 53, 69, 0.9);
}

/* ── 舞台 ──────────────────────────────────────────────────── */
/*
 * v3.0.0（R12）：图片灯箱宽度 100% —— 左右不再留 56px 内边距，图片直接贴屏幕边缘
 * （左右切换箭头浮在图片上层）。
 */
.mv-stage {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    /*
     * v3.0.0（R14）：底部 8px → 2px —— 缩略图行 / 缩放栏下移后，
     * 把让出的空间还给图片浏览区（适应窗口比例的图片随之放大一点）。
     */
    padding: 4px 0 2px;
}
/* v3.0.0（R12）：视频灯箱宽度同样 100%，播放区贴满整个窗口 */
.media-viewer.is-video .mv-stage {
    padding: 0;
}
/* v3.0.0（R14）：TXT / MD 等纯文本灯箱 —— 舞台上下 padding 归零，
   浏览区高度 = 舞台 100% 且垂直居中，不再「上方留缝、下方溢出」。 */
.media-viewer.is-plain .mv-stage {
    padding: 0;
}
/* v3.0.0（R14）：整个灯箱根节点 pan-y —— 屏蔽浏览器「屏幕边缘滑动返回」的
   伸缩动画（图片 / 视频灯箱原本在媒体区已用 touch-action:none 屏蔽，
   这里补齐音频 / TXT / PDF 等其它灯箱）。pan-y 只禁横向浏览器手势，
   正文滚动（text body overflow:auto）与 JS 滑动切换不受影响。 */
.media-viewer {
    touch-action: pan-y;
}
/* v3.0.0（R12）：图片 / 视频区域禁掉浏览器默认触摸滚动 ——
   移动端上拉（随机视频）/ 下拉（详情）手势由 JS 接管，页面不能跟着滚 */
.mv-image-wrap,
.mv-video-wrap {
    touch-action: none;
}
.mv-image-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
}
/*
 * v1.0.4：原图占位层 —— 复用列表里已缓存的缩略图，铺满容器并高斯模糊。
 * 绝对定位是为了不参与 flex 布局（否则会和原图并排，把画面挤成两半）。
 */
.mv-image-ph {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    border-radius: 4px;
    filter: blur(12px);
    transform: scale(1.03);
    opacity: 1;
    transition: opacity 0.28s ease;
    pointer-events: none;
}
.mv-image-ph.is-hidden {
    opacity: 0;
}
.mv-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    cursor: zoom-in;
    /* v1.0.4：原图解码完成前透明，完成后淡入覆盖占位图 */
    opacity: 0;
    transition: opacity 0.28s ease;
}
.mv-image.is-loaded {
    opacity: 1;
}
/* v3.0.0 实际大小：水平居中、垂直方向贴顶部（不是左上角），超出可滚动 / 拖动查看 */
.mv-image-wrap.is-actual {
    align-items: flex-start;
    justify-content: center;
    overflow: auto;
}
.mv-image-wrap.is-actual .mv-image {
    max-width: none;
    max-height: none;
    /* 居中用 auto 外边距：未超出时左右均分剩余空间 = 视觉水平居中；
       超出时 auto 退化为 0，左边缘仍然可滚动到（用 justify-content 纯居中会裁掉左边） */
    margin: 0 auto;
    cursor: zoom-out;
}
/* v3.0.0 PC 图片滚轮缩放 + 左键拖拽：手抓光标 */
.mv-image {
    will-change: transform;
}
.mv-image.is-dragging {
    cursor: grabbing !important;
    transition: none !important;
}
.mv-video-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    /* v3.0.0 长按手势：禁掉长按弹出系统菜单 / 文本选择，保证 500ms 长按能触发 3x */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
}
.mv-video {
    max-width: 100%;
    max-height: 100%;
    background: #000;
    border-radius: 6px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    /* v1.0.0：双指缩放以画面中心为原点，与图片灯箱同一套数学 */
    transform-origin: center center;
    will-change: transform;
}
/* v3.0.0 视频全屏化：去圆角与阴影，贴近满窗 */
.media-viewer.is-video .mv-video {
    border-radius: 0;
    box-shadow: none;
}
/*
 * v3.0.0（R16）：横屏播放 —— 屏幕方向锁定不可用时（iOS / 微信内置浏览器）
 * 用 CSS 把视频容器旋转 90°，尺寸按视口对调，铺满整个屏幕。
 * 仅触屏启用：桌面端「横屏」走浏览器全屏，不旋转画面。
 */
@media (hover: none) and (pointer: coarse) {
    .media-viewer.is-landscape .mv-stage {
        position: relative;
        padding: 0;
    }
    .media-viewer.is-landscape .mv-video-wrap {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 100vh;
        height: 100vw;
        transform: translate(-50%, -50%) rotate(90deg);
        transform-origin: center center;
    }
    .media-viewer.is-landscape .mv-video {
        width: 100%;
        height: 100%;
        max-width: none;
        max-height: none;
        object-fit: contain;
    }
}
/* v3.0.0（R16）：抓拍询问面板（灯箱内轻量浮层，不上 EP overlay） */
.mv-snapshot-panel {
    position: absolute;
    left: 50%;
    bottom: 12vh;
    transform: translateX(-50%);
    z-index: 30;
    width: min(320px, 86vw);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px 16px;
    border-radius: 12px;
    background: rgba(28, 30, 34, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
}
.mv-snapshot-name {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.7);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mv-snapshot-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
/* v3.0.0（R17）：上传失败原因 / 已上传标记 */
.mv-snapshot-error {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
    color: #ff8a8a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mv-snapshot-ok {
    display: inline-flex;
    align-items: center;
    padding: 0 10px;
    height: 28px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    color: #79e0a4;
    background: rgba(35, 134, 84, 0.22);
    border: 1px solid rgba(121, 224, 164, 0.34);
}

/* 视频右下角设置。
   v3.0.0（R12）：「更多设置」移到右下角 —— 与「下一页」箭头同一条垂直线（right 对齐），
   贴底放置（bottom: 14px），不再与箭头同高。 */
.mv-video-settings {
    position: absolute;
    right: 10px;
    /* v3.0.0（R16）：「更多设置」按钮固定在页面高度下方 20vh 处 */
    bottom: 20vh;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    /* v3.0.0 设置按钮跟随 is-idle 一起隐藏 */
    transition: opacity 0.25s ease;
}
.media-viewer.is-idle .mv-video-settings {
    opacity: 0;
    pointer-events: none;
}
.mv-menu-panel {
    width: 200px;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(38, 40, 45, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
/* v3.0.0 设置弹出页显示在按钮正上方（bottom: 100% 方向），按钮本身不位移 */
.mv-video-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    z-index: 3;
}
/* 顶栏内的幻灯片速度面板：相对按钮定位，避免被浮层盖住 */
.mv-inline-menu {
    position: relative;
}
.mv-slide-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 230px;
    z-index: 3;
}
.mv-menu-label {
    font-size: 11px;
    opacity: 0.6;
    margin: 2px 0 6px;
}
.mv-menu-label + .mv-menu-chips {
    margin-bottom: 10px;
}
.mv-menu-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.mv-chip {
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.06);
    color: #e9eaec;
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 12px;
    line-height: 1.4;
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease;
}
.mv-chip:hover {
    background: rgba(255, 255, 255, 0.16);
}
.mv-chip.is-active {
    background: var(--primary-color, #2563EB);
    border-color: var(--primary-color, #2563EB);
    color: #fff;
}

/* ── v3.0.0 视频辅助浮层：取消静音按钮 / 3x 角标 ─────────────── */
.mv-unmute {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border: none;
    border-radius: 999px;
    background: rgba(220, 53, 69, 0.92);
    color: #fff;
    font-size: 13px;
    cursor: pointer;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
}
.mv-unmute:hover {
    background: rgba(220, 53, 69, 1);
}
.mv-3x-badge {
    position: absolute;
    top: 14px;
    left: 14px;
    z-index: 4;
    padding: 4px 10px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.25);
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    pointer-events: none;
}

/* ── v3.0.0 左下角视频目录：与右下角设置按钮对齐、同款样式、同样自动隐藏 ──
   v3.0.0（R12）：「目录预览」移到左下角 —— 与「上一页」箭头同一条垂直线（left 对齐），
   贴底放置（bottom: 14px），不再与箭头同高。 */
.mv-video-toc {
    position: absolute;
    left: 10px;
    /* v3.0.0（R16）：「目录」按钮固定在页面高度下方 20vh 处 */
    bottom: 20vh;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    transition: opacity 0.25s ease;
}
.media-viewer.is-idle .mv-video-toc {
    opacity: 0;
    pointer-events: none;
}

/*
 * v1.1.4：上次播放进度提示 —— 在左下「目录」与右下「设置」之间居中，
 * 竖直位置与两个按钮齐平（bottom: 20vh），高度也对齐按钮，视觉上是一条提示条。
 */
.mv-resume-tip {
    position: absolute;
    left: 50%;
    bottom: calc(20vh + 2px);
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: min(72vw, 560px);
    padding: 6px 10px 6px 12px;
    border-radius: 999px;
    background: rgba(30, 32, 36, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: #eef1f5;
    font-size: 12px;
    line-height: 1.4;
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    z-index: 4;
    transition: opacity 0.25s ease;
}

.media-viewer.is-idle .mv-resume-tip {
    opacity: 0;
    pointer-events: none;
}

.mv-resume-icon {
    font-size: 12px;
    opacity: 0.8;
}

.mv-resume-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.mv-resume-jump {
    flex: 0 0 auto;
    padding: 2px 10px;
    border: none;
    border-radius: 999px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
}

.mv-resume-jump:hover {
    background: var(--el-color-primary-light-3);
}

.mv-resume-close {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-size: 11px;
    cursor: pointer;
}

.mv-resume-close:hover {
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
}

@media (max-width: 768px) {
    .mv-resume-tip {
        max-width: 88vw;
        font-size: 11px;
        padding: 5px 8px 5px 10px;
        gap: 6px;
    }
}
.mv-toc-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    width: min(300px, 80vw);
    max-height: 52vh;
    overflow: auto;
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.mv-toc-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    color: #e9eaec;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: background 0.2s ease;
}
.mv-toc-item:hover {
    background: rgba(255, 255, 255, 0.14);
}
.mv-toc-item.is-active {
    background: color-mix(in srgb, var(--primary-color, #2563EB) 40%, transparent);
    border-color: color-mix(in srgb, var(--primary-color, #2563EB) 70%, transparent);
    color: #fff;
}
.mv-toc-thumb {
    width: 64px;
    height: 40px;
    object-fit: cover;
    border-radius: 4px;
    background: #000;
    flex-shrink: 0;
}
.mv-toc-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mv-toc-icon {
    flex-shrink: 0;
    opacity: 0.7;
}

/* ── 音频 ──────────────────────────────────────────────────── */
.mv-audio {
    width: min(560px, 92vw);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px;
    border-radius: 14px;
    background: rgba(38, 40, 45, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.12);
}
.mv-audio-head {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
}
.mv-audio-icon {
    width: 40px;
    height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: color-mix(in srgb, var(--primary-color, #2563EB) 60%, transparent);
    color: #fff;
    font-size: 16px;
    flex-shrink: 0;
}
.mv-audio-title {
    min-width: 0;
}
.mv-audio-name {
    font-size: 14px;
    font-weight: 500;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mv-audio-sub {
    font-size: 11px;
    opacity: 0.6;
    margin-top: 2px;
}
.mv-audio-player {
    width: 100%;
}
/* v3.0.0：音频播放模式按钮行（单次 / 单曲循环 / 随机 / 顺序） */
.mv-audio-modes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
/* v3.0.0：音频 / 其它模式的舞台全屏透明铺底 —— 内容卡片居中，空白处点击不会误关预览 */
.mv-stage.is-plain {
    background: transparent;
}

/* ── v3.0.0（R7）：CSV / TSV 表格预览 ───────────────────────── */
.mv-table {
    width: min(1200px, 96vw);
    height: min(86vh, 900px);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px 18px;
    border-radius: 14px;
    background: rgba(38, 40, 45, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.12);
}
.mv-table-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.3);
}
.mv-table-grid {
    border-collapse: collapse;
    font-size: 12px;
    color: #e6e6e6;
    white-space: nowrap;
}
.mv-table-grid th,
.mv-table-grid td {
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 5px 10px;
    text-align: left;
    max-width: 420px;
    overflow: hidden;
    text-overflow: ellipsis;
}
.mv-table-grid th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: rgba(56, 58, 64, 0.98);
    font-weight: 600;
    color: #fff;
}
.mv-table-grid tbody tr:nth-child(even) td {
    background: rgba(255, 255, 255, 0.03);
}
/*
 * v3.0.0（R15）：音频灯箱 —— 上下拉是「随机切换 / 打开详情」手势，
 * 舞台禁止浏览器默认纵向滚动，页面不会跟着手指跑；
 * 播放列表自己仍可纵向滚动（单独放行 pan-y）。
 */
.media-viewer.is-audio .mv-stage {
    touch-action: none;
    overscroll-behavior: none;
}
.mv-audio-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-right: 2px;
    touch-action: pan-y;
}
.mv-audio-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    color: #e9eaec;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.2s ease;
}
.mv-audio-item:hover {
    background: rgba(255, 255, 255, 0.13);
}
.mv-audio-item.is-active {
    background: color-mix(in srgb, var(--primary-color, #2563EB) 42%, transparent);
    border-color: color-mix(in srgb, var(--primary-color, #2563EB) 70%, transparent);
    color: #fff;
}
.mv-audio-item-no {
    width: 20px;
    flex-shrink: 0;
    text-align: center;
    opacity: 0.6;
    font-size: 12px;
}
.mv-audio-item-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mv-audio-item-size {
    flex-shrink: 0;
    font-size: 11px;
    opacity: 0.6;
}
.mv-audio-item-icon {
    flex-shrink: 0;
    font-size: 11px;
    opacity: 0.8;
}

/* ── v3.0.0：PDF 内嵌查看器 ─────────────────────────────────── */
/* v3.0.0（R8）：PDF 顶部改为实体「关闭行」——顶栏回到文档流（不再浮层化覆盖在
   文档上面挤不出位置），PDF iframe 占剩余高度；
   且 is-idle（控件自动隐藏）时顶栏保持可见，保证关闭行永远可点。 */
.media-viewer.is-doc .mv-top {
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0.25));
}
.media-viewer.is-doc.is-idle .mv-top {
    opacity: 1;
    pointer-events: auto;
}
.media-viewer.is-doc .mv-stage {
    padding: 0;
}
.mv-doc {
    width: 100%;
    height: 100%;
    display: flex;
    background: #fff;
    border-radius: 0;
    overflow: hidden;
    border: 0;
}
.mv-doc-frame {
    width: 100%;
    height: 100%;
    border: 0;
    background: #fff;
}

/* ── v3.0.0：纯文本预览 ────────────────────────────────────── */
/*
 * v3.0.0（R12）：TXT 灯箱 —— 外框高度占满舞台（= 屏幕 minus 顶栏），
 * 字号 12 → 14，正文左对齐。
 */
/*
 * v3.0.0（R15）：TXT / MD 灯箱铺满整个窗口 —— 上下左右都贴边，
 * 不再是一张「浮在中间、上下留缝」的深色卡片。
 * 标题行改为绝对定位浮在正文上层（见 .mv-text-head），
 * 正文用 padding-top 让开它，滚动时标题始终可见。
 */
.mv-text {
    position: relative;
    width: 100%;
    height: 100%;
    max-height: none;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0;
    border-radius: 0;
    background: rgba(30, 32, 36, 0.98);
    border: 0;
}
.mv-text-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
}
.mv-text-name {
    font-size: 14px;
    font-weight: 500;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mv-text-meta {
    font-size: 11px;
    opacity: 0.6;
    flex-shrink: 0;
}
.mv-text-body {
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    /* v3.0.0（R15）：顶部让开浮动的标题行 */
    padding: 48px 20px 24px;
    overflow: auto;
    border-radius: 0;
    background: rgba(0, 0, 0, 0.32);
    color: #e6e6e6;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
    font-size: 14px;
    line-height: 1.6;
    text-align: left;
    white-space: pre-wrap;
    word-break: break-word;
    tab-size: 4;
    /* v3.0.0（R8）：relative 让 md 行元素的 offsetTop 相对正文容器，供大纲跳转计算 */
    position: relative;
}
/* ── v3.0.0（R8）：Markdown 逐行渲染（目录大纲锚点） ────────── */
.mv-text-md .mv-text-line {
    white-space: pre-wrap;
    word-break: break-word;
    min-height: 1em;
}

/* ── 其它类型 ──────────────────────────────────────────────── */
.mv-other {
    width: min(460px, 92vw);
    padding: 28px 24px 22px;
    border-radius: 14px;
    background: rgba(38, 40, 45, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.12);
    text-align: center;
}
.mv-other-icon {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    margin-bottom: 14px;
}
.mv-other-glyph {
    font-size: 46px;
    opacity: 0.85;
}
.mv-other-ext {
    font-size: 11px;
    letter-spacing: 0.08em;
    opacity: 0.6;
}
.mv-other-name {
    font-size: 14px;
    font-weight: 500;
    color: #fff;
    margin-bottom: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mv-other-meta {
    display: flex;
    justify-content: center;
    gap: 12px;
    font-size: 12px;
    opacity: 0.6;
    margin-bottom: 18px;
}
.mv-other-actions {
    display: flex;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
}
.mv-other-btn-icon {
    margin-right: 4px;
}

/* ── 左右切换 ──────────────────────────────────────────────── */
.mv-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 42px;
    height: 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.42);
    color: #fff;
    font-size: 15px;
    cursor: pointer;
    transition: background 0.2s ease, opacity 0.25s ease;
}
.mv-nav:hover {
    background: rgba(255, 255, 255, 0.24);
}
.mv-nav-prev {
    left: 8px;
}
.mv-nav-next {
    right: 8px;
}
.media-viewer.is-idle .mv-nav {
    opacity: 0;
    pointer-events: none;
}

/* ── 底部缩略图条 ──────────────────────────────────────────── */
.mv-thumbs {
    position: relative;
    z-index: 2;
    /* v3.0.0（R14）：整行往下移 5px（padding-top 8 → 13） */
    padding: 13px 14px 12px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.5), transparent);
    transition: opacity 0.25s ease;
}
.media-viewer.is-idle .mv-thumbs {
    opacity: 0;
    pointer-events: none;
}
/* ── v3.0.0（R9-F）：图片缩放栏（浮动在图片上层：stage 内 absolute 底部居中药丸） ──
   不再独占一行 → 图片默认可用高度扩大到「标题行 ~ 缩略图行」之间
   v3.0.0（R12）：去掉三个按钮外层的共用背框（背景 / 边框 / 药丸内边距全部透明），
   只保留三个按钮自身的样式。 */
.mv-zoombar {
    position: absolute;
    left: 50%;
    /* v3.0.0（R14）：三按钮（缩小/尺寸切换/放大）整体下移 10px
       v3.0.0（R15）：再下移 15px（24 → 9） */
    bottom: 9px;
    transform: translateX(-50%);
    z-index: 4;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    padding: 0;
    border-radius: 999px;
    background: transparent;
    border: 0;
    transition: opacity 0.25s ease;
}
.media-viewer.is-idle .mv-zoombar {
    opacity: 0;
    pointer-events: none;
}
/* ── v3.0.0（R8）：PDF 底部文档导航条（桌面端） ──────────────── */
/*
 * v3.0.0（R12）：文档导航条改为悬浮在文档底层的绝对定位胶囊 ——
 * 之前它占文档流一行：控件隐藏后虽然 opacity:0，但那条「背景带」仍然占着
 * 底部高度、看起来像一层遮罩压在浏览区上；改为悬浮后文档永远占满，
 * 隐藏时连占位都不留（visibility:hidden）。
 */
.mv-doc-thumbs {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 4;
}
.media-viewer.is-doc.is-idle .mv-doc-thumbs {
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
}
.mv-thumb-doc {
    display: flex;
    align-items: center;
    gap: 8px;
    width: auto;
    min-width: 150px;
    max-width: 240px;
    height: 44px;
    padding: 0 12px;
    opacity: 0.75;
}
.mv-thumb-doc-icon {
    font-size: 18px;
    opacity: 0.85;
    flex-shrink: 0;
}
.mv-thumb-doc-name {
    font-size: 12px;
    color: #e9eaec;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
@media (max-width: 768px) {
    /* PDF 文档导航条仅桌面端显示 */
    .mv-doc-thumbs {
        display: none;
    }
}
/* ── v3.0.0（R8）：md 目录大纲面板 ──────────────────────────── */
.mv-outline-menu {
    position: absolute;
    top: 10px;
    right: 14px;
    width: min(340px, 84vw);
    max-height: 52vh;
    overflow: auto;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.mv-outline-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #e9eaec;
    font-size: 12px;
    line-height: 1.5;
    text-align: left;
    cursor: pointer;
    transition: background 0.2s ease;
}
.mv-outline-item:hover {
    background: rgba(255, 255, 255, 0.12);
}
.mv-outline-h {
    flex-shrink: 0;
    font-size: 10px;
    opacity: 0.55;
}
.mv-outline-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mv-thumbs-track {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 4px;
    scrollbar-width: thin;
}
.mv-thumbs-track::-webkit-scrollbar {
    height: 6px;
}
.mv-thumbs-track::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.25);
    border-radius: 3px;
}
.mv-thumb {
    flex: 0 0 auto;
    width: 72px;
    height: 54px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 6px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.08);
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}
.mv-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.mv-thumb:hover {
    opacity: 1;
    transform: translateY(-1px);
}
.mv-thumb.is-active {
    opacity: 1;
    border-color: var(--primary-color, #2563EB);
}

/* ── 移动端 ────────────────────────────────────────────────── */
@media (max-width: 768px) {
    .mv-top {
        padding: 8px 10px;
    }
    .mv-title-name {
        max-width: 42vw;
        font-size: 13px;
    }
    .mv-stage {
        padding: 0 0 6px;
    }
    /* v3.0.0 视频模式移动端同样满窗 */
    .media-viewer.is-video .mv-stage {
        padding: 0;
    }
    .mv-nav {
        width: 34px;
        height: 34px;
    }
    .mv-nav-prev {
        left: 4px;
    }
    .mv-nav-next {
        right: 4px;
    }
    .mv-thumb {
        width: 58px;
        height: 44px;
    }
    .mv-audio,
    .mv-other {
        width: 94vw;
        padding: 14px;
    }
    /* v3.0.0（R7）：表格预览移动端同样占满可用高度 */
    .mv-table {
        width: 96vw;
        height: 82vh;
        padding: 12px;
    }
    /*
     * v3.0.0（R12）：TXT 灯箱移动端 —— 外框高度占满屏幕，
     * 左右留白 / 内边距调小（正文区尽量宽）。
     */
    .mv-text {
        width: calc(100vw - 12px);
        height: 100%;
        max-height: none;
        padding: 10px 8px;
        border-radius: 10px;
    }
    .mv-text-body {
        font-size: 14px;
        padding: 10px;
    }
    /* v3.0.0 移动端取消静音按钮位置微调（避开顶栏） */
    .mv-unmute {
        top: 52px;
    }
    .mv-3x-badge {
        top: 52px;
    }
}
</style>
