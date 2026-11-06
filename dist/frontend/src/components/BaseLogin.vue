<template>
    <div class="login" :style="viewportStyle">
        <!--
            v2.6.0：右上角只留一个「更多菜单」按钮（同前端上传页右上角样式）——
            主题切换（白天/夜间/自动）与语言切换以文字项迁入菜单，另加「忘记密码」入口。
        -->
        <el-dropdown class="more-dropdown" trigger="click" @command="handleMenuCommand">
            <button type="button" class="more-button" :title="$t('login.moreMenu')" :aria-label="$t('login.moreMenu')">
                <font-awesome-icon icon="ellipsis-v" size="lg"/>
            </button>
            <template #dropdown>
                <el-dropdown-menu>
                    <el-dropdown-item command="toggleTheme">
                        <font-awesome-icon :icon="themeIcon" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ themeText }}
                    </el-dropdown-item>
                    <el-dropdown-item command="toggleLanguage">
                        <font-awesome-icon icon="globe" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $i18n.locale === 'zh-CN' ? 'English' : '简体中文' }}
                    </el-dropdown-item>
                    <el-dropdown-item command="forgotPassword" divided>
                        <font-awesome-icon icon="key" style="width: 16px; margin-right: 8px; text-align: center;"/>
                        {{ $t('login.forgotPassword') }}
                    </el-dropdown-item>
                </el-dropdown-menu>
            </template>
        </el-dropdown>
        <!-- v2.5.0：登录页不再显示左上角 LOGO（需求 v20261023-2；其余前端页面照常显示） -->
        <div class="login-container">
            <h1 class="login-title" tabindex="0">{{ title }}</h1>

            <!-- 动态渲染输入字段 -->
            <div v-for="(field, index) in fields" :key="field.key" class="input-container">
                <label
                    class="input-name"
                    :ref="`inputLabel${index}`"
                    :style="{ '--underline-width': labelUnderlineWidths[index] + 'px' }"
                >
                    {{ field.label }}
                </label>
                <div class="input-wrapper">
                    <el-input
                        v-model="formData[field.key]"
                        :placeholder="field.placeholder"
                        :type="field.type || 'text'"
                        :show-password="field.showPassword"
                        class="password-input"
                        @keyup.enter.native="handleSubmit"
                        @focus="handleInputFocus"
                        @blur="handleInputBlur"
                    >
                        <template #prefix v-if="field.icon">
                            <el-icon class="el-input__icon"><component :is="field.icon" /></el-icon>
                        </template>
                    </el-input>
                </div>
            </div>

            <el-button
                class="submit"
                :class="{ 'is-loading': loading }"
                type="primary"
                @click="handleSubmit"
                :disabled="loading"
            >
            <div v-if="loading" class="loading-ring"></div>
            <span v-else>{{ computedSubmitText }}</span>
            </el-button>
            <!-- v2.7.0：登录框下方的「忘记密码?」入口已移除（右上角更多菜单里已有） -->
        </div>

        <!-- 忘记密码：用户名 + 邮箱（邮箱不提示、纯记忆输入），匹配则发重置链接（10 分钟有效） -->
        <el-dialog
            v-model="showForgotDialog"
            :title="$t('login.forgotPassword')"
            :width="dialogWidth"
            append-to-body
            class="forgot-dialog"
        >
            <p class="forgot-hint">{{ $t('login.forgotHint') }}</p>
            <el-input
                v-model="forgotUsername"
                :placeholder="$t('login.forgotUsername')"
                class="forgot-input"
                clearable
            />
            <el-input
                v-model="forgotEmail"
                :placeholder="$t('login.forgotEmail')"
                class="forgot-input"
                clearable
                @keyup.enter="submitForgot"
            />
            <template #footer>
                <el-button @click="showForgotDialog = false">{{ $t('common.cancel') }}</el-button>
                <el-button type="primary" :loading="forgotBusy" @click="submitForgot">
                    {{ $t('login.forgotSubmit') }}
                </el-button>
            </template>
        </el-dialog>
        <Footer class="footer"/>
    </div>
</template>

<script>
import Footer from '@/components/Footer.vue';
import { mapGetters } from 'vuex';
import axios from '@/utils/axios';
import { setLocale } from '@/locales';
import { writeThemeCookie } from '@/utils/themeCookie';
import backgroundManager from '@/mixins/backgroundManager';

export default {
    name: 'BaseLogin',
    mixins: [backgroundManager],
    props: {
        // 页面标题
        title: {
            type: String,
            required: true
        },
        // 输入字段配置
        fields: {
            type: Array,
            required: true,
            // fields 格式: [{ key: 'username', label: '用户名', placeholder: '请输入用户名', type: 'text', showPassword: false }]
        },
        // 提交按钮文本
        submitText: {
            type: String,
            default: ''
        },
        // 背景图配置键名
        backgroundKey: {
            type: String,
            required: true
        },
        // 是否为管理端登录（影响背景样式）
        isAdmin: {
            type: Boolean,
            default: false
        },
        // 是否正在加载
        loading: {
            type: Boolean,
            default: false
        }
    },
    data() {
        return {
            formData: {},
            labelUnderlineWidths: [],
            isFocused: false,
            viewportHeight: 0,
            // v2.6.0：忘记密码
            showForgotDialog: false,
            forgotUsername: '',
            forgotEmail: '',
            forgotBusy: false
        }
    },
    computed: {
        ...mapGetters(['userConfig']),
        computedSubmitText() {
            return this.submitText || this.$t('login.submit');
        },
        /** 主题三态：auto（跟随系统）/ light / dark */
        themeMode() {
            if (!this.$store.getters.cusDarkMode) return 'auto';
            return this.$store.getters.useDarkMode ? 'dark' : 'light';
        },
        themeIcon() {
            // 显示下一个模式的图标（与上传页更多菜单一致）
            if (this.themeMode === 'auto') return 'sun';
            if (this.themeMode === 'light') return 'moon';
            return 'adjust';
        },
        themeText() {
            // 显示下一个模式的文字（文字模式，v2.6.0）
            if (this.themeMode === 'auto') return this.$t('theme.lightMode');
            if (this.themeMode === 'light') return this.$t('theme.darkMode');
            return this.$t('theme.autoMode');
        },
        dialogWidth() {
            return window.innerWidth < 768 ? '90%' : '420px';
        },
        viewportStyle() {
            // 当检测到虚拟键盘弹出时，将容器高度收缩到可见视口高度
            // 容器本身 flex 居中，高度缩小后登录卡片自然在可见区域内居中
            if (this.viewportHeight > 0) {
                return {
                    height: `${this.viewportHeight}px`,
                    minHeight: `${this.viewportHeight}px`
                };
            }
            return {};
        }
    },
    watch: {
        fields: {
            handler() {
                this.$nextTick(() => {
                    this.calculateLabelWidths();
                });
            },
            deep: true
        }
    },
    components: {
        Footer
    },
    mounted() {
        // 初始化表单数据
        this.initFormData();
        // 初始化背景图
        this.initializeBackground(this.backgroundKey, '.login', !this.isAdmin, true);
        // 在下一个tick计算标签宽度，确保DOM已经渲染
        this.$nextTick(() => {
            this.calculateLabelWidths();
        });
        // 监听 visualViewport 变化，检测虚拟键盘弹出
        this._handleViewportResize = this.handleViewportResize.bind(this);
        if (window.visualViewport) {
            this._initialHeight = window.visualViewport.height;
            window.visualViewport.addEventListener('resize', this._handleViewportResize);
        }
    },
    beforeDestroy() {
        if (window.visualViewport && this._handleViewportResize) {
            window.visualViewport.removeEventListener('resize', this._handleViewportResize);
        }
    },
    methods: {
        initFormData() {
            // 根据字段配置初始化表单数据
            const newFormData = {};
            this.fields.forEach(field => {
                newFormData[field.key] = '';
            });
            this.formData = newFormData;
            // 初始化下划线宽度数组
            this.labelUnderlineWidths = new Array(this.fields.length).fill(0);
        },
        calculateLabelWidths() {
            // 计算每个标签的文字宽度
            this.$nextTick(() => {
                this.fields.forEach((field, index) => {
                    const labelRef = this.$refs[`inputLabel${index}`];
                    if (labelRef && labelRef[0]) {
                        // 创建一个临时的canvas来测量文字宽度
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        
                        // 获取标签的计算样式
                        const labelElement = labelRef[0];
                        const computedStyle = window.getComputedStyle(labelElement);
                        
                        // 设置font样式以匹配标签
                        context.font = `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
                        
                        // 测量文字宽度
                        const textWidth = context.measureText(field.label).width;
                        
                        // 添加一些额外的边距，确保下划线覆盖整个文字
                        this.labelUnderlineWidths[index] = Math.ceil(textWidth) + 3;
                    }
                });
            });
        },
        handleSubmit() {
            if (this.loading) return;
            // 触发父组件的提交事件，传递表单数据
            this.$emit('submit', { ...this.formData });
        },
        /** v2.6.0：右上角更多菜单命令（主题 / 语言 / 忘记密码） */
        handleMenuCommand(command) {
            if (command === 'toggleTheme') {
                // 循环切换：auto -> light -> dark -> auto（与上传页更多菜单一致）
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
            } else if (command === 'toggleLanguage') {
                const next = this.$i18n.locale === 'zh-CN' ? 'en' : 'zh-CN';
                setLocale(next);
            } else if (command === 'forgotPassword') {
                this.forgotUsername = '';
                this.forgotEmail = '';
                this.showForgotDialog = true;
            }
        },
        /** v2.6.0：忘记密码 —— 用户名 + 邮箱匹配即发重置链接（后端统一应答，不暴露账户是否存在） */
        async submitForgot() {
            const username = String(this.forgotUsername || '').trim();
            const email = String(this.forgotEmail || '').trim();
            if (!username || !email) {
                this.$message.warning(this.$t('login.forgotRequired'));
                return;
            }
            this.forgotBusy = true;
            try {
                const res = await axios.post('/api/auth/password/forgot', { username, email }, { withCredentials: true });
                if (res.data?.success) {
                    this.$message.success(res.data.message || this.$t('login.forgotSent'));
                    this.showForgotDialog = false;
                } else {
                    this.$message.error(res.data?.message || this.$t('common.failed'));
                }
            } catch (e) {
                this.$message.error(e?.response?.data?.message || this.$t('common.failed'));
            } finally {
                this.forgotBusy = false;
            }
        },
        handleViewportResize() {
            if (!window.visualViewport) return;
            const currentHeight = window.visualViewport.height;
            // 键盘高度 = 初始视口高度 - 当前视口高度
            const keyboardHeight = this._initialHeight - currentHeight;
            // 设定阈值：视口缩小超过 150px 才认为是虚拟键盘弹出
            // 避免地址栏收缩等小幅变化误触发
            const KEYBOARD_THRESHOLD = 150;
            if (keyboardHeight > KEYBOARD_THRESHOLD) {
                // 将容器高度设为当前可见视口高度
                // flex 居中会让登录卡片自然在可见区域内居中，不会顶部溢出或底部留白
                this.viewportHeight = currentHeight;
            } else {
                this.viewportHeight = 0;
            }
        },
        handleInputFocus(event) {
            this.isFocused = true;
            const container = event.target.closest('.input-container');
            if (container) {
                const wrapper = container.querySelector('.input-wrapper');
                if (wrapper) {
                    wrapper.classList.add('focused');
                }
            }
        },
        handleInputBlur(event) {
            this.isFocused = false;
            const container = event.target.closest('.input-container');
            if (container) {
                const wrapper = container.querySelector('.input-wrapper');
                if (wrapper) {
                    wrapper.classList.remove('focused');
                }
            }
        }
    }
}
</script>

<style scoped>
.login {
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: column;
    min-height: 100vh;
    height: auto;
    background: var(--admin-container-bg-color, var(--bg-color));
    overflow-y: auto;
    padding: 20px 0;
    box-sizing: border-box;
    transition: height 0.35s ease-out, min-height 0.35s ease-out;
}

.login-title {
    font-size: 2.3rem;
    margin-bottom: 15px;
    color: var(--login-title-color);
    font-family: 'Pacifico', 'Noto Sans SC', sans-serif;
    cursor: pointer;
    transition: all 0.3s ease;
    letter-spacing: 2px;
    /* v2.8.0：与首页图床名称同款 —— 微微上下浮动 + hover 放大跳动 + 下划线展开（无链接） */
    position: relative;
    display: inline-block;
    padding-bottom: 8px;
    animation: loginTitleFloat 4s ease-in-out infinite;
}
@keyframes loginTitleFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-5px); }
}
/* hover 跳动（放大）会打断浮动动画，用内层无法加（纯文本节点），
   改为在动画帧里同时承载缩放：hover 时切换到带缩放的动画曲线 */
.login-title:hover,
.login-title:focus {
    text-shadow: 0 0 10px var(--login-title-glow-color, rgba(52, 152, 219, 0.5));
    animation: loginTitleFloatHover 1.2s ease-in-out infinite;
}
@keyframes loginTitleFloatHover {
    0%, 100% { transform: translateY(0) scale(1.06); }
    50% { transform: translateY(-5px) scale(1.06); }
}
@media (max-width: 768px) {
    .login-title {
        font-size: 1.5rem;
    }
}
/* hover 下划线：底部居中展开（与首页 .title::after 同款过渡） */
.login-title::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 3px;
    border-radius: 3px;
    background: var(--login-title-glow-color, rgba(52, 152, 219, 0.55));
    box-shadow: 0 0 8px var(--login-title-glow-color, rgba(52, 152, 219, 0.4));
    transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}
.login-title:hover::after,
.login-title:focus::after {
    width: 80%;
}

.login-container {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: auto;
    height: auto;
    width: 600px;
    border-radius: 12px;
    box-shadow: var(--login-container-box-shadow);
    background-color: var(--glass-bg) !important;
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border: 1px solid var(--glass-border);
    transition: all 0.3s ease;
    padding: 40px 0;
    gap: 20px;
    position: relative;
    z-index: 101;
}
@media (max-width: 768px) {
    .login-container {
        width: 85vw;
        padding: 25px 0;
        gap: 12px;
    }
}
.login-container:hover {
    box-shadow: var(--login-container-hover-box-shadow);
}

.input-container {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 80%;
    margin-bottom: 15px;
    position: relative;
    gap: 8px;
}
@media (max-width: 768px) {
    .input-container {
        width: 85%;
        gap: 4px;
        margin-bottom: 8px;
    }
}

.input-wrapper {
    position: relative;
    width: 100%;
    display: flex;
    flex-direction: column;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.input-icon {
    margin-right: 6px;
    font-size: 1rem;
}

.input-name {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--login-title-color);
    text-align: left;
    transition: all 0.3s ease;
    letter-spacing: 0.5px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding-left: 2px;
}

.input-name::after {
    content: '';
    position: absolute;
    left: 0;
    bottom: -2px;
    width: 0;
    height: 2px;
    background: var(--login-input-underline-color, #5b9bd3);
    transition: width 0.3s linear;
    border-radius: 1px;
}

.input-container:has(.input-wrapper.focused) .input-name::after,
.input-container:hover .input-name::after {
    width: var(--underline-width, 50px);
}

.input-container:has(.input-wrapper.focused) .input-name,
.input-container:hover .input-name {
    color: var(--login-input-label-focus-color, #5b9bd3);
}

@media (max-width: 768px) {
    .input-name {
        font-size: 0.85rem;
    }
}

.submit {
    margin-bottom: 10px;
    width: 50%;
    height: 48px;
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 2px;
    border-radius: 12px;
    background-color: var(--primary-color);
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    border: none;
    overflow: hidden;
    position: relative;
    padding: 0;
    display: flex;
    justify-content: center;
    align-items: center;
}

.submit.is-loading {
    width: 48px;
    border-radius: 50%;
    background-color: transparent !important;
    box-shadow: none !important;
    pointer-events: none;
}

/* Custom Ring Spinner */
.loading-ring {
    display: inline-block;
    width: 34px;
    height: 34px;
    border: 4px solid transparent;
    border-radius: 50%;
    border-top-color: var(--login-title-color, #ffffff);
    animation: spin 1s ease-in-out infinite;
    box-sizing: border-box;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
    .submit {
        width: 50%;
    }
}

.submit:not(.is-loading):hover,
.submit:not(.is-loading):focus {
    transform: scale(1.05);
    box-shadow: none;
}

.submit:disabled {
    cursor: default;
    transform: none;
}

.password-input {
    width: 100%;
    height: 50px;
    position: relative;
}

.password-input:deep(.el-input__prefix) {
    color: var(--login-input-icon-color, #59636E);
    font-size: 1rem;
    transition: color 0.3s ease;
}

.password-input:deep(.el-input__wrapper):focus-within .el-input__prefix {
    color: var(--login-input-label-focus-color, #5b9bd3);
}

.password-input:deep(.el-input__wrapper) {
    border-radius: 12px;
    background-color: var(--password-input-bg-color);
    border: 1px solid var(--glass-border);
    box-shadow: none;
    padding: 12px 16px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
}

.password-input:deep(.el-input__wrapper)::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
    transition: left 0.5s;
}

.password-input:deep(.el-input__wrapper):hover::before {
    left: 100%;
}

.password-input:deep(.el-input__wrapper):hover {
    box-shadow: none;
    border-color: var(--login-input-underline-color, #5b9bd3);
}

.password-input:deep(.el-input__wrapper):focus-within {
    border-color: var(--login-input-underline-color, #5b9bd3);
    box-shadow: none;
}

.password-input:deep(.el-input__inner) {
    color: var(--text-color, var(--login-input-text-color, #333));
    font-size: 1rem;
    font-weight: 500;
    background: transparent;
    border: none;
    box-shadow: none;
}

/* 深色模式下输入文字颜色增强 */
[data-theme="dark"] .password-input:deep(.el-input__inner),
.dark .password-input:deep(.el-input__inner) {
    color: var(--text-color, #ffffff) !important;
}

.password-input:deep(.el-input__inner)::placeholder {
    color: var(--placeholder-color, var(--text-color-secondary, rgba(150, 150, 150, 0.8)));
    font-weight: 400;
    transition: opacity 0.3s ease;
}

.password-input:deep(.el-input__wrapper):focus-within .el-input__inner::placeholder {
    opacity: 0.7;
}

.password-input:deep(.el-input__suffix) {
    color: var(--icon-color, #666);
}

.password-input:deep(.el-input__suffix-inner) {
    transition: color 0.3s ease;
}

.password-input:deep(.el-input__wrapper):hover .el-input__suffix-inner {
    color: var(--login-input-label-focus-color, #5b9bd3);
}

@media (max-width: 768px) {
    .password-input {
        width: 100%;
        height: 40px;
    }
    
    .password-input:deep(.el-input__wrapper) {
        padding: 8px 12px;
    }
}

.footer {
    position: fixed;
    bottom: 0;
    width: 100vw;
}

/* v2.6.0：右上角「更多菜单」按钮（同上传页右上角样式：毛玻璃 + 圆角） */
.more-dropdown {
    position: fixed;
    top: 30px;
    right: 30px;
    z-index: 100;
}
.more-button {
    width: 2.5rem;
    height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    background-color: var(--glass-bg);
    color: var(--text-color, inherit);
    cursor: pointer;
    box-shadow: none;
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    transition: background-color 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
}
.more-button:hover {
    transform: scale(1.05);
    border-color: var(--glass-border-hover);
}
@media (max-width: 768px) {
    .more-dropdown {
        top: 20px;
        right: 20px;
    }
    .more-button {
        width: 2rem;
        height: 2rem;
    }
}

/* v2.7.0：.forgot-link 已随登录框下方入口一起移除 */
.forgot-hint {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--text-color-secondary, #909399);
    line-height: 1.6;
}
.forgot-input {
    margin-bottom: 12px;
}
</style>
