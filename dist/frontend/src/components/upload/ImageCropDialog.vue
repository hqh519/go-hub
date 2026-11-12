<template>
    <el-dialog
        :model-value="modelValue"
        :title="$t(titleKey)"
        width="98%"
        append-to-body
        destroy-on-close
        class="image-crop-dialog"
        @update:model-value="$emit('update:modelValue', $event)"
        @opened="onOpened"
    >
        <div
            ref="stage"
            class="crop-stage"
            :class="{ 'is-painting': tool !== 'crop' }"
            @pointerdown="onStagePointerDown"
        >
            <img
                ref="img"
                :src="objectUrl"
                class="crop-img"
                draggable="false"
                @load="onImgLoad"
            />
            <!--
                v1.1.7：涂鸦 / 文字的叠加层（display 尺寸的 canvas，按 devicePixelRatio 放大）。
                不接收指针事件 —— 所有手势都由舞台统一分发，免得挡住选区拖动。
            -->
            <canvas ref="anno" class="crop-anno"></canvas>

            <!-- 选区：拖动内部平移，拖四角改大小，空白处拖动重新框选 -->
            <div
                v-if="sel.w > 0 && sel.h > 0"
                class="crop-selection"
                :class="{ 'is-paint': tool !== 'crop' }"
                :style="selectionStyle"
                @pointerdown.stop="onPointerDown($event, 'move')"
            >
                <span
                    v-for="corner in corners"
                    :key="corner"
                    class="crop-handle"
                    :class="`is-${corner}`"
                    @pointerdown.stop="onPointerDown($event, corner)"
                ></span>
            </div>

            <!-- 文字输入浮层：点一下图就出现在那个位置，回车确认 / Esc 取消 -->
            <div
                v-if="textDraft"
                class="crop-text-editor"
                :style="textEditorStyle"
                @pointerdown.stop
            >
                <input
                    ref="textInput"
                    v-model="textValue"
                    class="crop-text-field"
                    :style="{ color: brushColor }"
                    :placeholder="$t('uploadCrop.textPlaceholder')"
                    maxlength="60"
                    @keydown.enter.prevent="commitText"
                    @keydown.esc.prevent="cancelText"
                />
                <button type="button" class="crop-text-btn is-ok" @click="commitText">✓</button>
                <button type="button" class="crop-text-btn" @click="cancelText">✕</button>
            </div>
        </div>

        <!-- 工具切换：框选裁剪 / 画笔 / 文字 -->
        <div class="crop-toolbar">
            <div class="crop-modes">
                <button
                    v-for="m in tools"
                    :key="m.key"
                    type="button"
                    class="crop-mode"
                    :class="{ 'is-active': tool === m.key }"
                    @click="setTool(m.key)"
                >
                    <font-awesome-icon :icon="m.icon" class="crop-mode-icon" />{{ $t(m.label) }}
                </button>
            </div>
            <div class="crop-paint" v-if="tool !== 'crop' || annotations.length">
                <span class="crop-swatches">
                    <button
                        v-for="c in palette"
                        :key="c"
                        type="button"
                        class="crop-swatch"
                        :class="{ 'is-active': brushColor === c }"
                        :style="{ background: c }"
                        @click="brushColor = c"
                    ></button>
                </span>
                <span class="crop-widths" v-if="tool === 'brush'">
                    <button
                        v-for="w in brushSizes"
                        :key="w.key"
                        type="button"
                        class="crop-width"
                        :class="{ 'is-active': brushSize === w.v }"
                        @click="brushSize = w.v"
                    >
                        <i :style="{ width: `${w.dot}px`, height: `${w.dot}px` }"></i>
                    </button>
                </span>
                <span class="crop-widths" v-else-if="tool === 'text'">
                    <button
                        v-for="s in textSizes"
                        :key="s.key"
                        type="button"
                        class="crop-width is-text"
                        :class="{ 'is-active': textSize === s.v }"
                        @click="textSize = s.v"
                    >{{ s.label }}</button>
                </span>
                <el-button size="small" text :disabled="!annotations.length" @click="undoAnnotation">
                    {{ $t('uploadCrop.undo') }}
                </el-button>
                <el-button size="small" text :disabled="!annotations.length" @click="clearAnnotations">
                    {{ $t('uploadCrop.clear') }}
                </el-button>
            </div>
        </div>

        <div class="crop-tools">
            <span class="crop-size" v-if="outputSize">{{ $t('uploadCrop.outputSize', { w: outputSize.w, h: outputSize.h }) }}</span>
            <!--
                v1.0.5：旋转方向 —— 手机上拍的竖图经常带着 EXIF 方向，进到裁剪页是歪的。
                每次都从**原始文件**重新渲染（而不是在上一次结果上叠 90°），
                这样连点四次回到 0° 不会有任何画质损失。
                v1.1.7：涂鸦/文字的坐标也随之转 90°，跟着图一起转，不会错位。
            -->
            <div class="crop-rotate">
                <el-button size="small" :disabled="rotating" :title="$t('uploadCrop.rotateLeft')" @click="rotate(-1)">
                    <font-awesome-icon icon="undo" style="margin-right: 3px;"></font-awesome-icon>{{ $t('uploadCrop.rotateLeft') }}
                </el-button>
                <el-button size="small" :disabled="rotating" :title="$t('uploadCrop.rotateRight')" @click="rotate(1)">
                    <font-awesome-icon icon="redo" style="margin-right: 3px;"></font-awesome-icon>{{ $t('uploadCrop.rotateRight') }}
                </el-button>
                <span class="crop-angle">{{ rotation }}°</span>
                <el-button size="small" text :disabled="rotating || rotation === 0" @click="resetRotation">{{ $t('uploadCrop.rotateReset') }}</el-button>
            </div>
            <el-button size="small" text :disabled="tool !== 'crop'" @click="resetSelection">{{ $t('uploadCrop.reset') }}</el-button>
        </div>
        <p class="crop-hint">{{ hintText }}</p>

        <template #footer>
            <el-button @click="$emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
            <el-button type="primary" :loading="exporting" :disabled="!canCrop" @click="confirm">
                {{ $t(confirmKey) }}
            </el-button>
        </template>
    </el-dialog>
</template>

<script>
/**
 * 图片裁剪 / 剪辑（v2.3.0）—— 上传列表里「剪刀」按钮打开的处理页，
 * 文件详情页的「剪辑」也复用它。
 *
 * 与 AvatarCropper 的区别：那个只做正方形头像，这里要裁任意矩形，
 * 所以用「自由框选」：在图上拖出选区、拖四角改大小、拖选区内部平移。
 * 确认后在浏览器里按原图分辨率裁切，生成新的 File 交给上传队列，
 * 原图不会被上传，也不会有任何额外的服务端处理。
 *
 * v2.4.0：
 *   1) 弹窗改全屏（移动端 fullscreen；PC 大尺寸），裁剪操作区更大更好拖；
 *   2) 交互从 mouse/touch 双轨改为 Pointer Events 统一处理 ——
 *      旧实现移动端四角选点经常失效（touchstart 被 prevent 后拖动流不稳定），
 *      Pointer Events + setPointerCapture 在移动端与 PC 表现完全一致。
 *
 * v1.1.7（「裁剪」改名「剪辑」，并补上画笔 / 文字）：
 *   1) 三种工具：框选裁剪 / 画笔（自由涂鸦）/ 文字（点图放置后输入）。
 *      涂鸦与文字都存在 annotations 数组里，坐标是**相对整张图的归一化 0~1**，
 *      所以预览（display 尺寸的 canvas）和导出（原图分辨率的 canvas）用同一套
 *      绘制函数就能严格对齐，不需要分别维护两套坐标；
 *   2) 旋转时把涂鸦坐标一起转 90°（文字连同角度一起转），转四次回到原位不累积误差；
 *   3) 导出时先画裁剪区域，再把叠加层按「选区偏移」画上去 —— 落在选区外的部分
 *      自然被裁掉，和用户在预览里看到的一致；
 *   4) 移动端从满屏改成 98% 宽高，和其他弹窗统一。
 */
export default {
    name: 'ImageCropDialog',
    props: {
        modelValue: { type: Boolean, default: false },
        /** 待裁剪的 File（也允许直接给 blob URL 字符串 + name） */
        file: { type: File, default: null },
        /** 备用文件名（file 为空时用于生成结果文件名） */
        fileName: { type: String, default: '' },
        /** v1.1.7：标题文案键 —— 文件详情页叫「剪辑」，上传页仍叫「裁剪」 */
        titleKey: { type: String, default: 'uploadCrop.title' },
        /** v1.1.7：确认按钮文案键 */
        confirmKey: { type: String, default: 'uploadCrop.confirm' },
        /** v1.1.7：是否开放涂鸦 / 文字 */
        allowAnnotate: { type: Boolean, default: true },
    },
    emits: ['update:modelValue', 'done'],
    data() {
        return {
            objectUrl: '',
            /**
             * v1.0.5：原始文件的对象 URL。
             * 旋转时永远从它重新渲染，保证「转四次回到原位」不会累积重新编码的画质损失。
             */
            rawUrl: '',
            /** 当前旋转角度（0 / 90 / 180 / 270，顺时针） */
            rotation: 0,
            rotating: false,
            natural: { w: 0, h: 0 },
            /** 图片在舞台内的实际绘制区域（px） */
            disp: { left: 0, top: 0, w: 0, h: 0 },
            /** 选区：相对图片的归一化坐标 0~1 */
            sel: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
            drag: null,
            exporting: false,
            corners: ['nw', 'ne', 'sw', 'se'],
            /** v1.1.8：正在拖动的文字（null = 没在拖） */
            textDrag: null,
            /** v1.1.7：当前工具 —— crop / brush / text */
            tool: 'crop',
            /** v1.1.7：涂鸦与文字（归一化坐标） */
            annotations: [],
            drawing: null,
            brushColor: '#ff3b30',
            /** 笔宽：相对图片短边的比例 */
            brushSize: 0.008,
            /** 字号：相对图片短边的比例 */
            textSize: 0.06,
            palette: ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#0a84ff', '#ffffff', '#111111'],
            brushSizes: [
                { key: 'thin', v: 0.004, dot: 5 },
                { key: 'normal', v: 0.008, dot: 9 },
                { key: 'bold', v: 0.016, dot: 14 },
            ],
            textSizes: [
                { key: 's', v: 0.04, label: 'A' },
                { key: 'm', v: 0.06, label: 'A' },
                { key: 'l', v: 0.09, label: 'A' },
            ],
            /** 文字输入浮层的位置（归一化）与内容 */
            textDraft: null,
            textValue: '',
        };
    },
    computed: {
        visible: {
            get() { return this.modelValue; },
            set(v) { this.$emit('update:modelValue', v); },
        },
        tools() {
            const list = [{ key: 'crop', icon: 'crop', label: 'uploadCrop.toolCrop' }];
            if (this.allowAnnotate) {
                list.push({ key: 'brush', icon: 'paintbrush', label: 'uploadCrop.toolBrush' });
                list.push({ key: 'text', icon: 'font', label: 'uploadCrop.toolText' });
            }
            return list;
        },
        hintText() {
            if (this.tool === 'brush') return this.$t('uploadCrop.brushHint');
            if (this.tool === 'text') return this.$t('uploadCrop.textHint');
            return this.$t('uploadCrop.hint');
        },
        selectionStyle() {
            const d = this.disp;
            const s = this.sel;
            if (!d.w || !d.h) return { display: 'none' };
            return {
                left: `${d.left + s.x * d.w}px`,
                top: `${d.top + s.y * d.h}px`,
                width: `${s.w * d.w}px`,
                height: `${s.h * d.h}px`,
            };
        },
        textEditorStyle() {
            const d = this.disp;
            const t = this.textDraft;
            if (!d.w || !t) return { display: 'none' };
            const stageW = (this.$refs.stage && this.$refs.stage.clientWidth) || 0;
            const rawLeft = d.left + t.x * d.w;
            // 靠右边缘时往回拉一点，避免输入框跑到舞台外面去
            const left = stageW ? Math.min(rawLeft, Math.max(4, stageW - 208)) : rawLeft;
            return {
                left: `${Math.max(4, left)}px`,
                top: `${d.top + t.y * d.h}px`,
            };
        },
        outputSize() {
            const n = this.natural;
            const s = this.sel;
            if (!n.w || !n.h) return null;
            const w = Math.max(1, Math.round(s.w * n.w));
            const h = Math.max(1, Math.round(s.h * n.h));
            return { w, h };
        },
        canCrop() {
            return !!(this.outputSize && this.objectUrl);
        },
    },
    watch: {
        file() { this.loadImage(); },
        modelValue(v) {
            if (v) this.loadImage();
            else this.cleanupUrl();
        },
    },
    beforeUnmount() {
        this.cleanupUrl();
        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerUp);
        window.removeEventListener('pointermove', this.onDrawMove);
        window.removeEventListener('pointerup', this.onDrawUp);
        window.removeEventListener('pointercancel', this.onDrawUp);
        // v1.1.8：文字拖动同样要摘干净，否则关掉弹窗后还在监听
        window.removeEventListener('pointermove', this.onTextDragMove);
        window.removeEventListener('pointerup', this.onTextDragUp);
        window.removeEventListener('pointercancel', this.onTextDragUp);
    },
    methods: {
        handleResize() {
            this.measure();
        },
        cleanupUrl() {
            if (this.objectUrl && this.objectUrl.startsWith('blob:') && this.objectUrl !== this.rawUrl) {
                URL.revokeObjectURL(this.objectUrl);
            }
            if (this.rawUrl && this.rawUrl.startsWith('blob:')) URL.revokeObjectURL(this.rawUrl);
            this.objectUrl = '';
            this.rawUrl = '';
        },
        loadImage() {
            this.cleanupUrl();
            if (!this.file) return;
            this.rawUrl = URL.createObjectURL(this.file);
            this.objectUrl = this.rawUrl;
            this.rotation = 0;
            this.natural = { w: 0, h: 0 };
            // v1.1.7：换图后旧的涂鸦/文字一律作废，工具回到框选
            this.annotations = [];
            this.drawing = null;
            // v1.1.8：换图时把可能残留的文字拖动状态一起清掉
            this.onTextDragUp();
            this.textDraft = null;
            this.textValue = '';
            this.tool = 'crop';
            /*
             * v1.0.7：默认选区 = 整张图（不是原来的 80% 居中框）。
             * 大多数人是进来「只转个方向」的，原来的 0.1/0.1/0.8/0.8 会让一次
             * 旋转-保存变成「顺手裁掉四周 10%」，属于典型的误操作。
             * 现在不主动框选就不会裁到任何像素；要裁剪自己拖四角。
             */
            this.sel = { x: 0, y: 0, w: 1, h: 1 };
        },
        /**
         * 旋转 90°（dir = -1 逆时针 / 1 顺时针）。
         * 渲染源始终是 rawUrl，rotation 是「绝对角度」而非增量 —— 连点不会糊。
         */
        async rotate(dir) {
            if (!this.rawUrl || this.rotating) return;
            // 正在输入文字时先落定，避免旋转后浮层还挂在旧坐标上
            this.commitText();
            this.rotation = (this.rotation + (dir > 0 ? 90 : 270)) % 360;
            this.rotateAnnotations(dir);
            if (this.rotation === 0) {
                // 回到原位：直接用原图，重新编码这一步都省掉
                if (this.objectUrl !== this.rawUrl) URL.revokeObjectURL(this.objectUrl);
                this.objectUrl = this.rawUrl;
                this.$nextTick(() => this.renderAnnotations());
                return;
            }
            this.rotating = true;
            try {
                const url = await this.renderRotated(this.rotation);
                if (!url) return;
                if (this.objectUrl && this.objectUrl !== this.rawUrl) URL.revokeObjectURL(this.objectUrl);
                this.objectUrl = url;
            } finally {
                this.rotating = false;
            }
        },
        /** 把原图按 angle 旋转后画到 canvas，返回新的 blob URL */
        renderRotated(angle) {
            return new Promise((resolve) => {
                const base = new Image();
                base.onload = () => {
                    const w = base.naturalWidth;
                    const h = base.naturalHeight;
                    const swap = angle === 90 || angle === 270;
                    const canvas = document.createElement('canvas');
                    canvas.width = swap ? h : w;
                    canvas.height = swap ? w : h;
                    const ctx = canvas.getContext('2d');
                    ctx.translate(canvas.width / 2, canvas.height / 2);
                    ctx.rotate((angle * Math.PI) / 180);
                    ctx.drawImage(base, -w / 2, -h / 2, w, h);
                    // png / webp 保透明；其余走 jpeg 高质量
                    const keepAlpha = /png|webp|gif/i.test(this.file?.type || '');
                    canvas.toBlob(
                        (blob) => resolve(blob ? URL.createObjectURL(blob) : ''),
                        keepAlpha ? 'image/png' : 'image/jpeg',
                        0.96,
                    );
                };
                base.onerror = () => resolve('');
                base.src = this.rawUrl;
            });
        },
        resetRotation() {
            if (this.rotation === 0) return;
            this.commitText();
            // 反向转回去，涂鸦也跟着回来（转四次 = 回到初始状态，不累积误差）
            this.rotateAnnotations(-1);
            this.rotation = 0;
            if (this.objectUrl && this.objectUrl !== this.rawUrl) URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = this.rawUrl;
            this.$nextTick(() => this.renderAnnotations());
        },
        onOpened() {
            this.onImgLoad();
            window.addEventListener('resize', this.handleResize);
        },
        onImgLoad() {
            const img = this.$refs.img;
            if (img?.naturalWidth) {
                this.natural = { w: img.naturalWidth, h: img.naturalHeight };
            }
            this.measure();
        },
        /** 计算图片在舞台里的 contain 显示区域 */
        measure() {
            const stage = this.$refs.stage;
            const img = this.$refs.img;
            if (!stage || !img || !img.naturalWidth) return;
            const sw = stage.clientWidth;
            const sh = stage.clientHeight || Math.round(sw * 0.62);
            const scale = Math.min(sw / img.naturalWidth, sh / img.naturalHeight);
            const w = img.naturalWidth * scale;
            const h = img.naturalHeight * scale;
            this.disp = { left: (sw - w) / 2, top: (sh - h) / 2, w, h };
            this.$nextTick(() => this.renderAnnotations());
        },
        resetSelection() {
            // v1.0.7：重置 = 回到整图选区（与打开时的默认一致）
            this.sel = { x: 0, y: 0, w: 1, h: 1 };
        },
        /** v1.0.7：当前选区是否等于整张图（此时「保存」等于不裁剪） */
        isFullSelection() {
            const s = this.sel;
            return s.x <= 0.002 && s.y <= 0.002 && s.w >= 0.996 && s.h >= 0.996;
        },
        /** 指针坐标 → 图片归一化坐标（Pointer Events 自带 clientX/Y，鼠标触控统一） */
        toNorm(evt, clamp = true) {
            const stage = this.$refs.stage;
            const rect = stage.getBoundingClientRect();
            const d = this.disp;
            const x = (evt.clientX - rect.left - d.left) / (d.w || 1);
            const y = (evt.clientY - rect.top - d.top) / (d.h || 1);
            if (!clamp) return { x, y };
            return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
        },
        /* ------------------------- v1.1.7 工具切换 ------------------------- */
        setTool(key) {
            if (this.tool === key) return;
            this.commitText();
            this.tool = key;
            this.$nextTick(() => this.renderAnnotations());
        },
        /** 舞台按下：按当前工具分发（框选 / 画笔 / 文字） */
        onStagePointerDown(evt) {
            if (!this.disp.w) return;
            if (this.tool === 'brush') {
                this.startStroke(evt);
                return;
            }
            if (this.tool === 'text') {
                /*
                 * v1.1.8（需求）：文字放置之后要能移动位置。
                 * 先做命中判定 —— 按在已有文字上就拖动它，按在空白处才新建一段。
                 */
                const hit = this.hitText(evt);
                if (hit >= 0) this.startTextDrag(evt, hit);
                else this.placeText(evt);
                return;
            }
            this.onPointerDown(evt, null);
        },
        /* -------------------------- 画笔（涂鸦） -------------------------- */
        startStroke(evt) {
            if (evt.cancelable) evt.preventDefault();
            const p = this.toNorm(evt, false);
            this.drawing = {
                type: 'stroke',
                color: this.brushColor,
                width: this.brushSize,
                points: [this.clampPoint(p)],
            };
            try { evt.currentTarget?.setPointerCapture?.(evt.pointerId); } catch { /* 忽略 */ }
            window.addEventListener('pointermove', this.onDrawMove);
            window.addEventListener('pointerup', this.onDrawUp);
            window.addEventListener('pointercancel', this.onDrawUp);
            this.renderAnnotations();
        },
        clampPoint(p) {
            return { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
        },
        onDrawMove(evt) {
            if (!this.drawing) return;
            if (evt.cancelable) evt.preventDefault();
            const p = this.toNorm(evt, false);
            // 手指/鼠标划出图片外时暂停记录（否则会在边缘糊出一圈直线）
            if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
            const pts = this.drawing.points;
            const last = pts[pts.length - 1];
            const dx = (p.x - last.x) * (this.disp.w || 1);
            const dy = (p.y - last.y) * (this.disp.h || 1);
            // 采样：2px 以内的点丢弃，笔迹看不出来，点数量却能少一个量级
            if (dx * dx + dy * dy < 4) return;
            pts.push({ x: p.x, y: p.y });
            this.renderAnnotations();
        },
        onDrawUp() {
            window.removeEventListener('pointermove', this.onDrawMove);
            window.removeEventListener('pointerup', this.onDrawUp);
            window.removeEventListener('pointercancel', this.onDrawUp);
            if (!this.drawing) return;
            if (this.drawing.points.length) this.annotations.push(this.drawing);
            this.drawing = null;
            this.renderAnnotations();
        },
        /* ---------------------------- 文字 ---------------------------- */
        /*
         * v1.1.8：文字的命中判定。
         * 叠加层是 canvas，没有 DOM 元素可以点，所以自己算文本框：
         * 用与绘制时同一个字体 measureText 量宽度，高度按行高 1.25 估算，
         * 再留 6px 的手指余量（手机指尖比鼠标粗得多）。
         * 从后往前找 —— 后画的盖在上面，点到的是最上面那一段。
         */
        hitText(evt) {
            const cv = this.$refs.anno;
            const d = this.disp;
            if (!cv || !d.w || !d.h) return -1;
            const ctx = cv.getContext('2d');
            const base = Math.min(d.w, d.h);
            const p = this.toNorm(evt);
            const PAD = 6;
            for (let i = this.annotations.length - 1; i >= 0; i -= 1) {
                const a = this.annotations[i];
                if (a.type !== 'text') continue;
                const size = Math.max(8, a.size * base);
                let tw = size * String(a.text || '').length * 0.6;
                if (ctx) {
                    ctx.save();
                    ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
                    tw = ctx.measureText(String(a.text || '')).width;
                    ctx.restore();
                }
                const bw = (tw + PAD * 2) / d.w;
                const bh = (size * 1.25 + PAD * 2) / d.h;
                if (p.x >= a.x - PAD / d.w && p.x <= a.x + bw && p.y >= a.y - PAD / d.h && p.y <= a.y + bh) {
                    return i;
                }
            }
            return -1;
        },
        /** 开始拖动某一段文字：记下「按下的点」相对文字左上角的偏移，移动时保持不跳 */
        startTextDrag(evt, index) {
            if (evt.cancelable) evt.preventDefault();
            const a = this.annotations[index];
            if (!a) return;
            const p = this.toNorm(evt, false);
            this.textDrag = { index, dx: p.x - a.x, dy: p.y - a.y };
            this.$refs.stage?.classList.add('is-text-drag');
            try { evt.currentTarget?.setPointerCapture?.(evt.pointerId); } catch { /* 忽略 */ }
            window.addEventListener('pointermove', this.onTextDragMove);
            window.addEventListener('pointerup', this.onTextDragUp);
            window.addEventListener('pointercancel', this.onTextDragUp);
        },
        onTextDragMove(evt) {
            const drag = this.textDrag;
            if (!drag) return;
            if (evt.cancelable) evt.preventDefault();
            const a = this.annotations[drag.index];
            if (!a) return;
            const p = this.toNorm(evt, false);
            // 允许略微移出画布（拖回来还在），但不让它彻底丢了
            a.x = Math.min(1, Math.max(-0.05, p.x - drag.dx));
            a.y = Math.min(1, Math.max(-0.05, p.y - drag.dy));
            this.renderAnnotations();
        },
        onTextDragUp() {
            window.removeEventListener('pointermove', this.onTextDragMove);
            window.removeEventListener('pointerup', this.onTextDragUp);
            window.removeEventListener('pointercancel', this.onTextDragUp);
            this.textDrag = null;
            this.$refs.stage?.classList.remove('is-text-drag');
        },
        placeText(evt) {
            if (evt.cancelable) evt.preventDefault();
            // 上一段还没确认的文字先落定，避免被新的一次点击吞掉
            this.commitText();
            const p = this.toNorm(evt);
            this.textDraft = { x: p.x, y: p.y };
            this.textValue = '';
            this.$nextTick(() => this.$refs.textInput?.focus?.());
        },
        commitText() {
            const draft = this.textDraft;
            if (!draft) return;
            const text = String(this.textValue || '').trim();
            this.textDraft = null;
            this.textValue = '';
            if (text) {
                this.annotations.push({
                    type: 'text',
                    text,
                    color: this.brushColor,
                    size: this.textSize,
                    x: draft.x,
                    y: draft.y,
                    rot: 0,
                });
            }
            this.renderAnnotations();
        },
        cancelText() {
            this.textDraft = null;
            this.textValue = '';
            this.renderAnnotations();
        },
        /* ---------------------------- 撤销/清空 ---------------------------- */
        undoAnnotation() {
            if (!this.annotations.length) return;
            this.annotations.pop();
            this.renderAnnotations();
        },
        clearAnnotations() {
            if (!this.annotations.length) return;
            this.annotations = [];
            this.renderAnnotations();
        },
        /**
         * 旋转时同步旋转涂鸦/文字的坐标 —— 它们绑在「图片」上，图转就得跟着转。
         * 顺时针：(x, y) → (1 - y, x)；文字还要把自己的角度一起转 90°。
         */
        rotateAnnotations(dir) {
            if (!this.annotations.length) return;
            const cw = dir > 0;
            this.annotations = this.annotations.map((a) => {
                if (a.type === 'stroke') {
                    return {
                        ...a,
                        points: a.points.map((p) => (cw ? { x: 1 - p.y, y: p.x } : { x: p.y, y: 1 - p.x })),
                    };
                }
                return {
                    ...a,
                    x: cw ? 1 - a.y : a.y,
                    y: cw ? a.x : 1 - a.x,
                    rot: (a.rot || 0) + (cw ? Math.PI / 2 : -Math.PI / 2),
                };
            });
        },
        /**
         * 把叠加层画到任意 canvas 上 —— W/H 是目标绘制区尺寸。
         * 预览用 display 尺寸，导出用原图分辨率，同一函数，视觉完全一致。
         */
        paintItems(ctx, W, H, items) {
            if (!items || !items.length) return;
            const base = Math.min(W, H);
            const font = (size) => `600 ${size}px system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
            items.forEach((a) => {
                ctx.save();
                if (a.type === 'stroke') {
                    const pts = a.points || [];
                    if (!pts.length) { ctx.restore(); return; }
                    ctx.strokeStyle = a.color;
                    ctx.lineWidth = Math.max(1, a.width * base);
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.beginPath();
                    pts.forEach((p, i) => {
                        const x = p.x * W;
                        const y = p.y * H;
                        if (i === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    });
                    // 单点（点一下没拖动）也要留下一个圆点
                    if (pts.length === 1) {
                        const p = pts[0];
                        ctx.lineTo(p.x * W + 0.01, p.y * H);
                    }
                    ctx.stroke();
                } else if (a.type === 'text') {
                    const size = Math.max(8, a.size * base);
                    ctx.translate(a.x * W, a.y * H);
                    if (a.rot) ctx.rotate(a.rot);
                    ctx.font = font(size);
                    ctx.textBaseline = 'top';
                    ctx.fillStyle = a.color;
                    // 浅色字压在浅色照片上会看不见，给一点描边兜底
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
                    ctx.shadowBlur = size * 0.22;
                    ctx.fillText(a.text, 0, 0);
                }
                ctx.restore();
            });
        },
        /** 重画预览叠加层（含正在画的那一笔） */
        renderAnnotations() {
            const cv = this.$refs.anno;
            const d = this.disp;
            if (!cv || !d.w || !d.h) return;
            const dpr = window.devicePixelRatio || 1;
            const W = Math.max(1, Math.round(d.w));
            const H = Math.max(1, Math.round(d.h));
            const pw = Math.round(W * dpr);
            const ph = Math.round(H * dpr);
            if (cv.width !== pw || cv.height !== ph) {
                cv.width = pw;
                cv.height = ph;
            }
            cv.style.left = `${d.left}px`;
            cv.style.top = `${d.top}px`;
            cv.style.width = `${W}px`;
            cv.style.height = `${H}px`;
            const ctx = cv.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);
            const list = this.drawing ? [...this.annotations, this.drawing] : this.annotations;
            this.paintItems(ctx, W, H, list);
        },
        /* ------------------------- 原有的框选交互 ------------------------- */
        onPointerDown(evt, mode) {
            if (!this.disp.w) return;
            if (evt.cancelable) evt.preventDefault();
            const p = this.toNorm(evt);
            const s = { ...this.sel };
            this.drag = { mode, startX: p.x, startY: p.y, origin: s };
            if (!mode) {
                // 空白处按下：从该点开始重新框选
                this.sel = { x: p.x, y: p.y, w: 0, h: 0 };
            }
            // 捕获指针：后续 move/up 即使移出元素也持续派发给该元素所在的流
            try { evt.currentTarget?.setPointerCapture?.(evt.pointerId); } catch { /* 忽略 */ }
            window.addEventListener('pointermove', this.onPointerMove);
            window.addEventListener('pointerup', this.onPointerUp);
            window.addEventListener('pointercancel', this.onPointerUp);
        },
        onPointerMove(evt) {
            if (!this.drag) return;
            if (evt.cancelable) evt.preventDefault();
            const p = this.toNorm(evt);
            const { mode, origin, startX, startY } = this.drag;
            const dx = p.x - startX;
            const dy = p.y - startY;

            if (!mode) {
                // 新建选区：从起点拖到当前点
                const x = Math.min(startX, p.x);
                const y = Math.min(startY, p.y);
                this.sel = { x, y, w: Math.abs(dx), h: Math.abs(dy) };
                return;
            }
            if (mode === 'move') {
                const w = origin.w;
                const h = origin.h;
                const x = Math.min(1 - w, Math.max(0, origin.x + dx));
                const y = Math.min(1 - h, Math.max(0, origin.y + dy));
                this.sel = { x, y, w, h };
                return;
            }
            // 四角缩放
            let left = origin.x;
            let top = origin.y;
            let right = origin.x + origin.w;
            let bottom = origin.y + origin.h;
            if (mode.includes('w')) left = Math.min(right - 0.02, Math.max(0, origin.x + dx));
            if (mode.includes('n')) top = Math.min(bottom - 0.02, Math.max(0, origin.y + dy));
            if (mode.includes('e')) right = Math.max(left + 0.02, Math.min(1, origin.x + origin.w + dx));
            if (mode.includes('s')) bottom = Math.max(top + 0.02, Math.min(1, origin.y + origin.h + dy));
            this.sel = { x: left, y: top, w: right - left, h: bottom - top };
        },
        onPointerUp() {
            this.drag = null;
            window.removeEventListener('pointermove', this.onPointerMove);
            window.removeEventListener('pointerup', this.onPointerUp);
            window.removeEventListener('pointercancel', this.onPointerUp);
        },
        /**
         * v1.0.7：把「已旋转的 blob URL」变回 File —— 只转方向时直接上传它，不重绘。
         * 文件名沿用原名的基名 + blob 实际类型对应的扩展名。
         */
        async rotatedFile() {
            if (!this.objectUrl || this.objectUrl === this.rawUrl) return null;
            try {
                const r = await fetch(this.objectUrl);
                const blob = await r.blob();
                const mime = blob.type || this.file?.type || 'image/jpeg';
                const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
                const raw = String(this.file?.name || this.fileName || 'image');
                const base = raw.replace(/\.[^.]+$/, '') || 'image';
                return new File([blob], `${base}.${ext}`, { type: mime, lastModified: Date.now() });
            } catch {
                return null;
            }
        },
        /** 按选区在原图上裁切，生成新的 File */
        async confirm() {
            const img = this.$refs.img;
            const size = this.outputSize;
            if (!img || !size) return;
            this.commitText();
            this.exporting = true;
            try {
                /*
                 * v1.0.7：选区就是整图时不走 canvas —— 直接交出「原文件」或「已旋转的那份」。
                 * 原因：canvas 重绘对 jpg 是有损的（哪怕质量 0.94），只转个方向却掉画质
                 * 完全没必要；png/webp 也会被重新编码一遍、体积变大。
                 * v1.1.7：有涂鸦/文字时必须走 canvas，否则叠加层会丢。
                 */
                if (this.isFullSelection() && !this.annotations.length) {
                    const src = this.rotation === 0 ? this.file : await this.rotatedFile();
                    if (src) {
                        this.$emit('done', src);
                        this.$emit('update:modelValue', false);
                        return;
                    }
                    // 拿不到（极少见，blob 被回收）→ 落回 canvas 路径，至少能保存
                }

                const canvas = document.createElement('canvas');
                canvas.width = size.w;
                canvas.height = size.h;
                const ctx = canvas.getContext('2d');
                const n = this.natural;
                const s = this.sel;
                // png / webp 保留透明通道；jpg 之类先铺白底
                const keepAlpha = /png|webp|gif/i.test(this.file?.type || '') || /\.(png|webp|gif)$/i.test(this.fileName || '');
                if (!keepAlpha) {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, size.w, size.h);
                }
                ctx.drawImage(
                    img,
                    Math.round(s.x * n.w),
                    Math.round(s.y * n.h),
                    Math.round(s.w * n.w),
                    Math.round(s.h * n.h),
                    0,
                    0,
                    size.w,
                    size.h,
                );
                /*
                 * v1.1.7：叠加层按「整图分辨率」绘制，再把画布平移到选区的左上角 ——
                 * 落在选区外的笔迹自然被裁掉，和预览里看到的完全一致。
                 */
                if (this.annotations.length) {
                    ctx.save();
                    ctx.translate(-Math.round(s.x * n.w), -Math.round(s.y * n.h));
                    this.paintItems(ctx, n.w, n.h, this.annotations);
                    ctx.restore();
                }
                const mime = keepAlpha ? 'image/png' : 'image/jpeg';
                const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, 0.94));
                if (!blob) throw new Error('toBlob failed');
                const ext = keepAlpha ? 'png' : 'jpg';
                const raw = String(this.file?.name || this.fileName || 'image');
                const base = raw.replace(/\.[^.]+$/, '') || 'image';
                const cropped = new File([blob], `${base}.${ext}`, { type: mime, lastModified: Date.now() });
                this.$emit('done', cropped);
                this.$emit('update:modelValue', false);
            } catch (e) {
                this.$message?.error?.(this.$t('uploadCrop.failed'));
            } finally {
                this.exporting = false;
            }
        },
    },
};
</script>

<style scoped>
.crop-stage {
    position: relative;
    width: 100%;
    /*
     * v1.1.7：弹窗本身定高（桌面 92vh / 移动 98vh），body 是 flex 列，
     * 舞台吃满「头部 + 工具行 + 尾部」之外的全部空间 —— 不再用 vh 减法这种
     * 一改行数就要重新调的数字，工具行多一行也不会溢出。
     */
    flex: 1 1 auto;
    min-height: 220px;
    border-radius: 10px;
    overflow: hidden;
    background: #1f2430;
    touch-action: none;
    user-select: none;
    cursor: crosshair;
}

/* v1.1.7：画笔/文字模式下光标换成十字细线，避免误以为还能拖选区 */
.crop-stage.is-painting {
    cursor: crosshair;
}

/* v1.1.8：正在拖动文字时给一个「抓住」的光标 */
.crop-stage.is-text-drag {
    cursor: grabbing;
}

.crop-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
}

/* v1.1.7：涂鸦/文字叠加层 —— 位置与尺寸由 JS 按图片实际绘制区同步 */
.crop-anno {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
}

.crop-selection {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--el-color-primary, #409eff);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
    cursor: move;
}

/* v1.1.7：画图时选区只留一圈虚线提示「导出范围」，不再压暗、也不再接手势 */
.crop-selection.is-paint {
    border-style: dashed;
    border-color: rgba(255, 255, 255, 0.85);
    box-shadow: none;
    pointer-events: none;
    cursor: default;
}

.crop-handle {
    position: absolute;
    width: 14px;
    height: 14px;
    border-radius: 2px;
    background: var(--el-color-primary, #409eff);
    border: 2px solid #fff;
    box-sizing: border-box;
}

.crop-selection.is-paint .crop-handle {
    display: none;
}

.crop-handle.is-nw { left: -7px; top: -7px; cursor: nwse-resize; }
.crop-handle.is-ne { right: -7px; top: -7px; cursor: nesw-resize; }
.crop-handle.is-sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
.crop-handle.is-se { right: -7px; bottom: -7px; cursor: nwse-resize; }

/* v1.1.7：文字输入浮层 */
.crop-text-editor {
    position: absolute;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border-radius: 8px;
    background: rgba(20, 24, 32, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.24);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}

.crop-text-field {
    width: 150px;
    height: 28px;
    padding: 0 8px;
    border: none;
    outline: none;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.1);
    font-size: 13px;
    font-weight: 600;
    caret-color: #fff;
}

.crop-text-field::placeholder {
    color: rgba(255, 255, 255, 0.5);
    font-weight: 400;
}

.crop-text-btn {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
}

.crop-text-btn:hover {
    background: rgba(255, 255, 255, 0.22);
}

.crop-text-btn.is-ok {
    background: var(--el-color-primary, #409eff);
}

.crop-text-btn.is-ok:hover {
    background: var(--el-color-primary-light-3, #79bbff);
}

/* v1.1.7：工具栏（工具切换 + 画笔参数） */
.crop-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
}

.crop-modes {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--el-fill-color-light, #f5f7fa);
}

.crop-mode {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-regular, #606266);
    font-size: 12.5px;
    line-height: 1;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
}

.crop-mode:hover {
    color: var(--el-color-primary, #409eff);
}

.crop-mode.is-active {
    background: var(--el-bg-color-overlay, #fff);
    color: var(--el-color-primary, #409eff);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.crop-mode-icon {
    font-size: 12px;
}

.crop-paint {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

.crop-swatches {
    display: inline-flex;
    gap: 5px;
}

.crop-swatch {
    width: 16px;
    height: 16px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.85);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.16);
    cursor: pointer;
}

.crop-swatch.is-active {
    box-shadow: 0 0 0 2px var(--el-color-primary, #409eff);
}

.crop-widths {
    display: inline-flex;
    align-items: center;
    gap: 2px;
}

.crop-width {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
}

.crop-width.is-active {
    border-color: var(--el-color-primary, #409eff);
}

.crop-width i {
    display: block;
    border-radius: 50%;
    background: var(--el-text-color-regular, #606266);
}

.crop-width.is-text {
    width: 22px;
    font-size: 11px;
    color: var(--el-text-color-regular, #606266);
}

.crop-width.is-text:nth-child(1) { font-size: 10px; }
.crop-width.is-text:nth-child(2) { font-size: 12px; }
.crop-width.is-text:nth-child(3) { font-size: 14px; }

.crop-tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 8px;
}

/* v1.0.5：旋转方向一组按钮（左转 / 右转 / 当前角度 / 复位） */
.crop-rotate {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
}

.crop-rotate .el-button + .el-button {
    margin-left: 0;
}

.crop-angle {
    min-width: 38px;
    text-align: center;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--el-text-color-secondary);
}

.crop-size {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.crop-hint {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
}

/* 移动端：舞台吃掉 header/footer/工具行之外的全部空间；选点加大易触 */
@media (max-width: 768px) {
    .crop-stage {
        min-height: 180px;
        border-radius: 8px;
    }
    .crop-handle {
        width: 20px;
        height: 20px;
    }
    .crop-handle.is-nw { left: -10px; top: -10px; }
    .crop-handle.is-ne { right: -10px; top: -10px; }
    .crop-handle.is-sw { left: -10px; bottom: -10px; }
    .crop-handle.is-se { right: -10px; bottom: -10px; }
    .crop-mode {
        height: 30px;
        padding: 0 8px;
        font-size: 12px;
    }
    .crop-toolbar {
        gap: 6px;
    }
}
</style>

<!--
    v1.1.7：非 scoped 全局块 —— el-dialog 是 teleport 到 body 的，
    scoped 样式打不到弹窗根节点，只能在这里用「组件类名 + el-dialog 类名」双限定。
    移动端从「满屏」改成「98% 宽高」，和笔记发布、上传目标等弹窗保持一致。
-->
<style>
.image-crop-dialog.el-dialog {
    display: flex;
    flex-direction: column;
    /* v1.1.7：处理页宽高一起 98%（原来是「移动端满屏 / 桌面 92% 宽 + 靠内容撑高」） */
    height: 98vh;
    max-height: 98vh;
    margin: 1vh auto !important;
}

.image-crop-dialog .el-dialog__body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
}

@media (max-width: 768px) {
    .image-crop-dialog .el-dialog__body {
        padding-top: 6px;
        /*
         * v1.1.9（需求）：图片区放大到 70vh 后，弹窗里本来就塞不下工具行 / 提示行，
         * 它们会被推到可视区之外 —— 这里明确让 body 自己成为滚动容器（触屏给惯性滚动），
         * 用户可以往下滑看到底部的工具与功能，而不是被裁掉看不见、也点不到。
         */
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
    }
    /*
     * v1.1.8（需求）：移动端的图片加载区要更大 —— 最小不小于视口高度的 60%。
     * v1.1.9（需求）：继续放大到 70%。
     * 选择器写成「弹窗类 + 舞台类」而不是单个 .crop-stage：
     * scoped 块里有一条 `.crop-stage { min-height: 180px }`，带 data-v 属性后特异性比
     * 单独的 .crop-stage 更高，只写单类会被它盖住 —— 之前看似生效其实是 flex 拉伸的结果。
     */
    .image-crop-dialog .crop-stage {
        min-height: 70vh;
    }
}
</style>
