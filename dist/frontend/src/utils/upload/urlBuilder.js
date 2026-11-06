/**
 * URL 构建工具函数
 * 用于生成各种格式的文件链接（原始链接、Markdown、HTML、BBCode）
 */

/**
 * 取文件扩展名（小写、不带点）。
 * 优先用后端元数据 FileExt；缺失时从原始文件名推断。
 * @param {object} metadata 文件 metadata
 * @returns {string}
 */
export function fileExt(metadata) {
    if (!metadata) return ''
    if (metadata.FileExt) return String(metadata.FileExt).toLowerCase()
    const name = metadata.FileName || ''
    const m = /\.([A-Za-z0-9]{1,12})$/.exec(String(name))
    return m ? m[1].toLowerCase() : ''
}

/**
 * 给外链末尾补上扩展名（仅用于「直观展示文件类型」）。
 * 后端 /file/:name 会剥掉最后一段扩展名再查库，因此带不带扩展名都能访问，
 * 也不会影响代理 / 302 重定向 / 访问源切换。
 * @param {string} url 形如 https://host/file/<File_ID>
 * @param {object} metadata
 * @returns {string}
 */
export function withExt(url, metadata) {
    if (!url) return url
    const ext = fileExt(metadata)
    if (!ext) return url
    const [base, hash = ''] = String(url).split('#')
    const [path, query = ''] = base.split('?')
    if (/\.(jpg|jpeg|png|gif|webp|bmp|mp4|webm|mov|m4v|mp3|m4a|aac|ogg)$/i.test(path)) return url
    const next = `${path}.${ext}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`
    return next
}

/**
 * 根据 srcID 和文件名生成所有格式的 URL
 * @param {string} srcID - 文件资源 ID
 * @param {string} name - 文件名
 * @param {string} rootUrl - 链接前缀
 * @param {object} [metadata] - 文件元数据（用于补扩展名）
 * @returns {{ finalURL: string, mdURL: string, htmlURL: string, ubbURL: string }}
 */
export function buildFileUrls(srcID, name, rootUrl, metadata) {
    const url = withExt(rootUrl + srcID, metadata)
    return {
        finalURL: url,
        mdURL: `![${name}](${url})`,
        htmlURL: `<img src="${url}" alt="${name}">`,
        ubbURL: `[img]${url}[/img]`
    }
}

/**
 * 根据 selectedUrlForm 获取对应格式的 URL 值
 * @param {object} file - 文件对象，包含 finalURL/mdURL/htmlURL/ubbURL
 * @param {string} format - 格式类型：'url' | 'md' | 'html' | 'ubb'
 * @returns {string}
 */
export function getUrlByFormat(file, format) {
    const map = {
        url: file.finalURL,
        md: file.mdURL,
        html: file.htmlURL,
        ubb: file.ubbURL
    }
    return map[format] || file.finalURL
}

/**
 * 批量更新文件列表中的 URL（当自定义链接前缀变化时）
 * @param {Array} fileList - 文件列表
 * @param {string} rootUrl - 新的链接前缀
 */
export function updateFileListUrls(fileList, rootUrl) {
    fileList.forEach(item => {
        if (item.uploadChannel === 'external') {
            return
        }
        const urls = buildFileUrls(item.srcID, item.name, rootUrl, item.metadata)
        Object.assign(item, urls)
    })
}
