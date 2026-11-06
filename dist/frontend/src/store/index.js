import { createStore } from 'vuex'
import axios from '@/utils/axios';
import createPersistedState from 'vuex-persistedstate';
import { setLinkPrefix } from '@/utils/fileLink';

export default createStore({
  state: {
    userConfig: null,
    bingWallPapers: [],
    // 会话状态标记（不存储密码，实际认证通过 HttpOnly Cookie）
    adminLoggedIn: false,
    adminAccessStarted: false,
    adminAuthWarningVisible: false,
    userLoggedIn: false,
    // 统一账户体系：当前登录账户信息（role: admin | user | super）
    sessionRole: null,
    sessionUser: null,
    /** 当前登录用户的头像 URL（未设置时为空，前端回落系统 logo） */
    sessionAvatar: '',
    isSuper: false,
    canEdit: true,
    canDelete: true,
    uploadMethod: 'default',
    uploadCopyUrlForm: '',
    compressConfig: {
      customerCompress: undefined,
      compressBar: undefined,
      compressPercent: undefined,
      serverCompress: undefined,
      convertToWebp: undefined,
      // v2.8.9：前台「失败自动重试」开关（上传设置 → 其他，只管上传 / 转存）
      localAutoRetry: undefined,
    },
    storeUploadChannel: '',
    storeChannelName: null, // 指定的渠道名称，null表示从未选择，''表示用户主动清空
    storeAutoRetry: true,
    storeUploadNameType: '',
    uploadFolder: '',
    customUrlSettings: {
      useCustomUrl: 'false',
      customUrlPrefix: '',
      customDomain: '',
    },
    adminUrlSettings: {
      useCustomUrl: 'false',
      customUrlPrefix: '',
    },
    autoReUpload: true,
    // v2.8.7：后台文件管理全局视频静音开关（true=静音）。控制预览浮层与文件详情页的视频声音
    globalVideoMuted: true,
    // 深色模式
    useDarkMode: null,
    cusDarkMode: false,
  },
  getters: {
    userConfig: state => state.userConfig,
    bingWallPapers: state => state.bingWallPapers,
    adminLoggedIn: state => state.adminLoggedIn,
    userLoggedIn: state => state.userLoggedIn,
    sessionRole: state => state.sessionRole,
    sessionUser: state => state.sessionUser,
    isSuper: state => state.isSuper,
    canEdit: state => state.canEdit,
    canDelete: state => state.canDelete,
    // 是否具备后台管理（系统管理 / 用户管理 / 网页设置）权限
    isAdminRole: state => state.sessionRole === 'admin' || state.sessionRole === 'super',
    storeUploadMethod: state => state.uploadMethod,
    uploadCopyUrlForm: state => state.uploadCopyUrlForm,
    compressConfig: state => state.compressConfig,
    storeUploadChannel: state => state.storeUploadChannel,
    storeChannelName: state => state.storeChannelName,
    storeUploadNameType: state => state.storeUploadNameType,
    customUrlSettings: state => state.customUrlSettings,
    storeAutoRetry: state => state.storeAutoRetry,
    adminUrlSettings: state => state.adminUrlSettings,
    storeUploadFolder: (state) => {
      return state.uploadFolder || localStorage.getItem('uploadFolder') || ''
    },
    useDarkMode: state => state.useDarkMode,
    cusDarkMode: state => state.cusDarkMode,
    storeAutoReUpload: state => state.autoReUpload,
    globalVideoMuted: state => state.globalVideoMuted,
  },
  mutations: {
    setUserConfig(state, userConfig) {
      state.userConfig = userConfig;
      // 同步全站文件链接前缀（后端已按「自定义访问域名 > 默认URL前缀 > 本站」算好）
      setLinkPrefix(userConfig?.urlPrefix);
    },
    setBingWallPapers(state, bingWallPapers) {
      state.bingWallPapers = bingWallPapers;
    },
    setAdminLoggedIn(state, loggedIn) {
      state.adminLoggedIn = loggedIn;
      if (!loggedIn) {
        state.adminAccessStarted = false;
        state.adminAuthWarningVisible = false;
      }
    },
    beginAdminAccess(state, { required, fresh }) {
      if (!required && (fresh || !state.adminAccessStarted)) state.adminAuthWarningVisible = true;
      state.adminAccessStarted = true;
    },
    dismissAdminAuthWarning(state) {
      state.adminAuthWarningVisible = false;
    },
    setUserLoggedIn(state, loggedIn) {
      state.userLoggedIn = loggedIn;
    },
    // 写入统一账户会话信息（登录成功 / sessionCheck 探测后调用）
    setSession(state, payload) {
      const info = payload || {};
      state.sessionRole = info.role || null;
      state.sessionUser = info.username || null;
      if (info.avatarUrl !== undefined) state.sessionAvatar = info.avatarUrl || '';
      state.isSuper = !!info.isSuper || info.role === 'super';
      state.canEdit = info.canEdit !== false;
      state.canDelete = info.canDelete !== false;
      // 同步两套布尔标记，兼容旧组件
      state.userLoggedIn = info.valid !== false && !!info.role;
      state.adminLoggedIn = info.role === 'admin' || info.role === 'super';
    },
    clearSession(state) {
      state.sessionRole = null;
      state.sessionUser = null;
      state.sessionAvatar = '';
      state.isSuper = false;
      state.canEdit = true;
      state.canDelete = true;
      state.userLoggedIn = false;
      state.adminLoggedIn = false;
    },
    setUploadMethod(state, uploadMethod) {
      state.uploadMethod = uploadMethod;
    },
    setUploadCopyUrlForm(state, uploadCopyUrlForm) {
      state.uploadCopyUrlForm = uploadCopyUrlForm;
    },
    setCompressConfig(state, { key, value }) {
      state.compressConfig[key] = value;
    },
    setStoreUploadChannel(state, uploadChannel) {
      state.storeUploadChannel = uploadChannel;
    },
    setStoreChannelName(state, channelName) {
      state.storeChannelName = channelName;
    },
    setStoreUploadNameType(state, storeUploadNameType) {
      state.storeUploadNameType = storeUploadNameType;
    },
    setCustomUrlSettings(state, { key, value }) {
      state.customUrlSettings[key] = value;
    },
    setStoreAutoRetry(state, storeAutoRetry) {
      state.storeAutoRetry = storeAutoRetry;
    },
    setAdminUrlSettings(state, { key, value }) {
      state.adminUrlSettings[key] = value;
    },
    setUseDarkMode(state, useDarkMode) {
      state.useDarkMode = useDarkMode;
    },
    setCusDarkMode(state, cusDarkMode) {
      state.cusDarkMode = cusDarkMode;
    },
    setStoreUploadFolder(state, folder) {
      state.uploadFolder = folder
      localStorage.setItem('uploadFolder', folder)
    },
    setStoreAutoReUpload(state, autoReUpload) {
      state.autoReUpload = autoReUpload;
    },
    // v2.8.7：后台文件管理全局视频静音开关
    setGlobalVideoMuted(state, muted) {
      state.globalVideoMuted = !!muted;
    }
  },
  actions: {
    async fetchUserConfig({ commit }) {
      try {
        const response = await axios.get('/api/userConfig');
        commit('setUserConfig', response.data);
      } catch (error) {
        console.log(error);
      }
    },
    async fetchBingWallPapers({ commit }) {
      try {
        const response = await axios.get('/api/bing/wallpaper');
        const wallpapers = response.data.data;
        const bingWallPapers = wallpapers.map(wallpaper => {
          return {
            url: 'https://www.bing.com' + wallpaper.url,
          };
        }
        );

        //预加载图片，阻塞直到图片加载完成
        await Promise.all(bingWallPapers.map(wallpaper => {
          return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = resolve;
            img.onerror = reject;
            img.src = wallpaper.url;
          });
        }));
        commit('setBingWallPapers', bingWallPapers);
      } catch (error) {
        console.log(error);
      }
    }
  },
  modules: {
  },
  plugins: [createPersistedState({
    // 只持久化非敏感数据，不持久化认证状态
    paths: [
      'userConfig',
      'uploadMethod',
      'uploadCopyUrlForm',
      'compressConfig',
      'storeUploadChannel',
      'storeChannelName',
      'storeAutoRetry',
      'storeUploadNameType',
      'uploadFolder',
      'customUrlSettings',
      'adminUrlSettings',
      'autoReUpload',
      'globalVideoMuted',
      'useDarkMode',
      'cusDarkMode',
    ]
  })]
})
