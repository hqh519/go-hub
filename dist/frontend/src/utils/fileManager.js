// 文件管理器工具类
import fetchWithAuth from '@/utils/fetchWithAuth';
import { ElMessage } from 'element-plus';
import i18n from '@/locales';

class FileManager {
    constructor() {
        this.FILE_LIST_PATH = 'data/fileList.json';
        // 记录缓存归属的账户：同一浏览器上先以管理员登录、再换普通用户登录时，
        // 必须丢弃上一个账户的列表缓存，否则刷新瞬间会闪现非本人文件（越权内容）。
        this.CACHE_OWNER_PATH = 'data/fileList.owner';
        this.fileListCache = null;
        this.storageWarningShown = false;
        this.cacheOwner = null;
    }

    /**
     * 标记文件列表缓存归属的账户。
     * 账户发生变化（含首次进入）时立即清空内存与 localStorage 中的列表缓存，
     * 保证用户看到的第一帧只会是自己账户的数据 —— 真实数据由随后的列表请求填充。
     * @param {string} owner 当前会话账户名（普通用户 / 管理员）
     */
    setCacheOwner(owner) {
        const next = String(owner || '').trim();
        if (this.cacheOwner === next) return;
        this.cacheOwner = next;
        this.fileListCache = null;
        try {
            localStorage.removeItem(this.FILE_LIST_PATH);
            localStorage.setItem(this.CACHE_OWNER_PATH, next);
        } catch (error) {
            console.warn('Failed to reset file list cache owner:', error);
        }
    }

    // 从本地存储读取文件列表
    getLocalFileList() {
        const fileList = this.getMutableFileList();
        return {
            ...fileList,
            files: [...(fileList.files || [])],
            directories: [...(fileList.directories || [])],
            // v2.5.0：每个直接子目录的统计（{ folders, files }）—— 文件夹卡片展示用
            directoryStats: { ...(fileList.directoryStats || {}) },
        };
    }

    getMutableFileList() {
        if (this.fileListCache) {
            return this.fileListCache;
        }

        try {
            const fileList = localStorage.getItem(this.FILE_LIST_PATH);
            this.fileListCache = fileList ? JSON.parse(fileList) : this.createEmptyFileList();
            return this.fileListCache;
        } catch (error) {
            console.error('Error reading local file list:', error);
            this.fileListCache = this.createEmptyFileList();
            return this.fileListCache;
        }
    }

    // 更新内存缓存，并尽量持久化到 localStorage
    updateFileListCache(fileList) {
        this.fileListCache = fileList || this.createEmptyFileList();
        const persisted = this.persistFileListCache();

        return {
            cacheUpdated: true,
            persisted,
        };
    }

    persistFileListCache() {
        try {
            localStorage.setItem(this.FILE_LIST_PATH, JSON.stringify(this.fileListCache));
            return true;
        } catch (error) {
            this.handleStoragePersistError(error);
            return false;
        }
    }

    createEmptyFileList() {
        return { files: [], directories: [] };
    }

    handleStoragePersistError(error) {
        console.warn('File list is kept in memory because localStorage persistence failed:', error);

        try {
            localStorage.removeItem(this.FILE_LIST_PATH);
        } catch (removeError) {
            console.warn('Failed to remove stale file list cache:', removeError);
        }

        if (!this.storageWarningShown) {
            this.storageWarningShown = true;
            ElMessage.warning(i18n.global.t('dashboard.fileListMemoryCacheWarning'));
        }
    }

    // 添加新文件到列表
    addFile(newFile) {
        try {
            const fileList = this.getMutableFileList();
            fileList.files.push(newFile);
            return this.updateFileListCache(fileList).cacheUpdated;
        } catch (error) {
            console.error('Error adding file:', error);
            return false;
        }
    }

    // 添加新文件夹
    addFolder(folderName) {
        try {
            const fileList = this.getMutableFileList();
            if (!fileList.directories.includes(folderName)) {
                fileList.directories.push(folderName);
                return this.updateFileListCache(fileList).cacheUpdated;
            }
            return false; // 文件夹已存在
        } catch (error) {
            console.error('Error adding folder:', error);
            return false;
        }
    }

    // 移动文件或文件夹
    moveFile(oldPath, newPath, isFolder = false, currentPath = '') {
        try {
            let fileList = this.getMutableFileList();
            
            if (isFolder) {
                // 更新目录列表
                const oldFolderIndex = fileList.directories.indexOf(oldPath);
                if (oldFolderIndex !== -1) {
                    fileList.directories.splice(oldFolderIndex, 1);
                }

            } else {
                // 移动单个文件
                const fileIndex = fileList.files.findIndex(file => file.name === oldPath);
                if (fileIndex !== -1) {
                    // 从旧位置移除
                    fileList.files.splice(fileIndex, 1);
                }

            }

            // 如果新路径包含当前目录的直接子目录，则添加直接子目录
            if (newPath.startsWith(currentPath)) {
                const pathArray = newPath.substring(currentPath.length).split('/');
                if (pathArray.length > 1) {
                    const newFolder = currentPath + pathArray[0];
                    if (!fileList.directories.includes(newFolder)) {
                        fileList.directories.push(newFolder);
                    }
                }
            }

            return this.updateFileListCache(fileList).cacheUpdated;
        } catch (error) {
            console.error('Error moving file:', error);
            return false;
        }
    }

    // 从列表中删除文件
    removeFile(fileName) {
        try {
            let fileList = this.getMutableFileList();
            fileList.files = fileList.files.filter(file => file.name !== fileName);
            return this.updateFileListCache(fileList).cacheUpdated;
        } catch (error) {
            console.error('Error removing file:', error);
            return false;
        }
    }

    // 从列表中删除文件夹（同时删除该文件夹下的所有文件）
    removeFolder(folderName) {
        try {
            let fileList = this.getMutableFileList();
            fileList.files = fileList.files.filter(file => !file.name.startsWith(folderName + '/'));
            fileList.directories = fileList.directories.filter(dir => dir !== folderName);
            return this.updateFileListCache(fileList).cacheUpdated;
        } catch (error) {
            console.error('Error removing folder:', error);
            return false;
        }
    }

    // 获取指定目录下的文件和子目录
    getFilesInFolder(folderName) {
        try {
            const fileList = this.getMutableFileList();
            const files = fileList.files.filter(file => file.name.startsWith(folderName + '/'));
            const subdirectories = fileList.directories.filter(dir => dir.startsWith(folderName + '/'));
            return { files, directories: subdirectories };
        } catch (error) {
            console.error('Error getting files in folder:', error);
            return { files: [], directories: [] };
        }
    }

    // 构建筛选参数URL
    buildFilterParams(filters) {
        let params = '';
        // 访问状态筛选（综合判断）
        if (filters.accessStatus && filters.accessStatus.length > 0) {
            params += `&accessStatus=${encodeURIComponent(filters.accessStatus.join(','))}`;
        }
        // 黑白名单筛选（直接使用 ListType 字段）
        if (filters.listType && filters.listType.length > 0) {
            params += `&listType=${encodeURIComponent(filters.listType.join(','))}`;
        }
        if (filters.label && filters.label.length > 0) {
            params += `&label=${encodeURIComponent(filters.label.join(','))}`;
        }
        /*
         * v1.2.2（需求）：所有筛选组一律「勾了几个就传几个」，怎么组由下方的「且/或」决定。
         *   · 且(同时) → 逐值成条件（yes 与 no 同时勾 = 互斥 = 筛不出，属预期）；
         *   · 或(任意) → 分区内命中任一值即可（yes 与 no 同时勾 = 全部命中）。
         * 前端不再做「只勾一个才生效」的特殊处理，否则两组语义会不一致。
         */
        const yesNoCsv = (arr) => arr.map((v) => (v === 'has' ? 'yes' : 'no')).join(',');
        if (filters.refState && filters.refState.length > 0) {
            params += `&hasRef=${encodeURIComponent(yesNoCsv(filters.refState))}`;
        }
        if (filters.shareState && filters.shareState.length > 0) {
            params += `&hasShare=${encodeURIComponent(yesNoCsv(filters.shareState))}`;
        }
        if (filters.fileType && filters.fileType.length > 0) {
            params += `&fileType=${encodeURIComponent(filters.fileType.join(','))}`;
        }
        if (filters.channel && filters.channel.length > 0) {
            params += `&channel=${encodeURIComponent(filters.channel.join(','))}`;
        }
        if (filters.channelName && filters.channelName.length > 0) {
            params += `&channelName=${encodeURIComponent(filters.channelName.join(','))}`;
        }
        // v2.7.0：上传渠道筛选（Default / WebDAV / API-Web / API-S3）
        if (filters.uploadSource && filters.uploadSource.length > 0) {
            params += `&uploadSource=${encodeURIComponent(filters.uploadSource.join(','))}`;
        }
        // 备份状态筛选：backedup（已备份）/ unbackedup（未备份）
        if (filters.backup && filters.backup.length > 0) {
            params += `&backup=${encodeURIComponent(filters.backup.join(','))}`;
        }
        // 重定向筛选：yes（已设置重定向）/ no（未设置）
        if (filters.redirect && filters.redirect.length > 0) {
            params += `&redirect=${encodeURIComponent(filters.redirect.join(','))}`;
        }
        // 标签有无：has（含标签）/ none（未含标签）—— v1.2.2 起可同时勾，交给且/或
        if (filters.tags && filters.tags.length > 0) {
            params += `&hasTags=${encodeURIComponent(yesNoCsv(filters.tags))}`;
        }
        // 标签筛选弹窗：过滤标签 + 「或/且」模式
        if (filters.tagNames && filters.tagNames.length > 0) {
            params += `&filterTags=${encodeURIComponent(filters.tagNames.join(','))}`;
            params += `&tagMode=${filters.tagMode === 'or' ? 'or' : 'and'}`;
        }
        /*
         * v2.9.0：用户页筛选（多选，命中任一即可）。
         * 与「右上用户下拉」的 &user=（单选，归属过滤）是两个不同参数，互不覆盖。
         */
        if (filters.userNames && filters.userNames.length > 0) {
            params += `&filterUsers=${encodeURIComponent(filters.userNames.join(','))}`;
        }
        // v2.9.0：全局条件组合方式（all 同时 / any 任意）—— 默认 all 不传
        if (filters.matchMode === 'any') params += '&matchMode=any';
        // v2.8.7：日期范围筛选（按上传日期；YYYY-MM-DD，两端都含当天）
        if (filters.dateFrom) params += `&dateFrom=${encodeURIComponent(filters.dateFrom)}`;
        if (filters.dateTo) params += `&dateTo=${encodeURIComponent(filters.dateTo)}`;
        // 时区偏移（JS getTimezoneOffset 约定，分钟）—— 让「今天/本周」按浏览器本地时区切边界
        params += `&tz=${new Date().getTimezoneOffset()}`;
        // v2.8.7：大小范围筛选（字节）
        if ((Number(filters.sizeMin) || 0) > 0) params += `&sizeMin=${Number(filters.sizeMin)}`;
        if ((Number(filters.sizeMax) || 0) > 0) params += `&sizeMax=${Number(filters.sizeMax)}`;
        // v2.8.9：大小口径（actual 默认不传；original = 按压缩前的原始体积比较）
        if (filters.sizeMode === 'original') params += '&sizeMode=original';
        // v2.8.9：有效期 / 名称状态
        if (filters.validity && filters.validity.length > 0) {
            params += `&validity=${encodeURIComponent(filters.validity.join(','))}`;
        }
        if (filters.nameChanged && filters.nameChanged.length > 0) {
            params += `&nameChanged=${encodeURIComponent(filters.nameChanged.join(','))}`;
        }
        /*
         * v1.2.1：文件剪辑 / 文件MD5 两组筛选。
         * v1.2.2（需求）：取消「只勾一个才传」的门槛 —— 与所有其它分区一样全量传参，
         * 由下方「且/或」决定语义（且模式下两个都勾自然筛不出东西，那是用户的选择）。
         */
        if (filters.edited && filters.edited.length > 0) {
            params += `&edited=${encodeURIComponent(filters.edited.join(','))}`;
        }
        if (filters.md5Changed && filters.md5Changed.length > 0) {
            params += `&md5Changed=${encodeURIComponent(filters.md5Changed.join(','))}`;
        }
        // v2.8.9：尺寸筛选（快捷预设 + 自定义宽高）
        if (filters.dimPreset) params += `&dimPreset=${encodeURIComponent(filters.dimPreset)}`;
        if ((Number(filters.widthMin) || 0) > 0) params += `&widthMin=${Number(filters.widthMin)}`;
        if ((Number(filters.widthMax) || 0) > 0) params += `&widthMax=${Number(filters.widthMax)}`;
        if ((Number(filters.heightMin) || 0) > 0) params += `&heightMin=${Number(filters.heightMin)}`;
        if ((Number(filters.heightMax) || 0) > 0) params += `&heightMax=${Number(filters.heightMax)}`;
        /*
         * v3.0.0（R8）：评级筛选（评分 0-5 半星 / 等级 0-5）——
         * null = 该侧不限（不传）；「未评分 / 未设等级」= 0 与 0（要传，后端据此要求正好等于 0）。
         */
        const numParam = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
        if (numParam(filters.ratingMin) !== null) params += `&ratingMin=${numParam(filters.ratingMin)}`;
        if (numParam(filters.ratingMax) !== null) params += `&ratingMax=${numParam(filters.ratingMax)}`;
        if (numParam(filters.levelMin) !== null) params += `&levelMin=${numParam(filters.levelMin)}`;
        if (numParam(filters.levelMax) !== null) params += `&levelMax=${numParam(filters.levelMax)}`;
        return params;
    }

    /**
     * 组装「搜索类型 / 上传用户」等附加查询参数
     * @param {string} searchType 搜索类型 all|title|tag|category|user|other
     * @param {string} owner      上传用户（管理员筛选，空表示全部）
     */
    buildExtraParams(searchType, owner) {
        let params = '';
        if (searchType && searchType !== 'all') {
            params += `&searchType=${encodeURIComponent(searchType)}`;
        }
        if (owner && owner !== 'all') {
            params += `&user=${encodeURIComponent(owner)}`;
        }
        return params;
    }

    // 更新文件列表
    async refreshFileList(dir, search = '', includeTags = '', excludeTags = '', filters = {}, recursive = false, searchType = 'all', owner = '') {
        search = search.trim();
        try {
            let url = `/api/manage/list?count=60&dir=${dir}&search=${encodeURIComponent(search)}`;
            if (recursive) url += '&recursive=true';
            if (includeTags) {
                url += `&includeTags=${encodeURIComponent(includeTags)}`;
            }
            if (excludeTags) {
                url += `&excludeTags=${encodeURIComponent(excludeTags)}`;
            }
            // 添加筛选参数（支持多选）
            url += this.buildFilterParams(filters);
            // 搜索类型 + 上传用户
            url += this.buildExtraParams(searchType, owner);
            
            const response = await fetchWithAuth(url, {
                method: 'GET',
            });
            // 非 2xx（未登录 / 限流 / 服务异常）交给上层处理，
            // 不能把错误响应误判成「索引未就绪」而弹「索引构建中」
            if (!response.ok) {
                return false;
            }
            const newFileList = await response.json();
            // 仅当确实是「文件列表」响应、且明确标记未索引时才提示
            // （GoHub 基于 SQLite，列表实时查询，恒为 isIndexedResponse:true）
            if (
                newFileList &&
                Array.isArray(newFileList.files) &&
                newFileList.isIndexedResponse === false
            ) {
                ElMessage.warning(i18n.global.t('dashboard.indexingWarning'));
            }
            // 保存包含新字段的完整数据
            return this.updateFileListCache(newFileList).cacheUpdated;
        } catch (error) {
            console.error('Error refreshing file list:', error);
            return false;
        }
    }

    // 读取更多数据
    async loadMoreFiles(dir, search = '', includeTags = '', excludeTags = '', count = 60, filters = {}, recursive = false, searchType = 'all', owner = '') {
        search = search.trim();
        try {
            const fileList = this.getMutableFileList();
            const start = fileList.files.length;

            let url = `/api/manage/list?dir=${dir}&start=${start}&count=${count}&search=${encodeURIComponent(search)}`;
            if (recursive) url += '&recursive=true';
            if (includeTags) {
                url += `&includeTags=${encodeURIComponent(includeTags)}`;
            }
            if (excludeTags) {
                url += `&excludeTags=${encodeURIComponent(excludeTags)}`;
            }
            // 添加筛选参数（支持多选）
            url += this.buildFilterParams(filters);
            // 搜索类型 + 上传用户
            url += this.buildExtraParams(searchType, owner);

            const response = await fetchWithAuth(url, {
                method: 'GET',
            });
           
            const moreFiles = await response.json();
            fileList.files.push(...moreFiles.files);
            return this.updateFileListCache(fileList).cacheUpdated;
        } catch (error) {
            console.error('Error loading more files:', error);
            return { files: [], directories: [] };
        }
    }
}

export const fileManager = new FileManager();
