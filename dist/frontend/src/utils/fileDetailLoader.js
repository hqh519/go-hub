import fetchWithAuth from '@/utils/fetchWithAuth'
import { buildFileDetail } from '@/utils/fileDetail'

/**
 * 全站统一的「文件详情」加载入口。
 *
 * 所有需要弹出「文件详情」的地方（上传页 / 文件管理 / 历史记录 / 系统状态等）
 * 一律调用本函数获取详情数据，再交给 components/dashboard/FileDetailDialog.vue 展示，
 * 以保证任何入口调出的详情页：内容一致、链接口径一致、按钮与权限一致
 * （按钮与权限由 FileDetailDialog 内部按会话角色统一控制，入口无需各自实现）。
 *
 * @param {string} fileId  文件标识 File_ID
 * @param {object} [options]
 * @param {object}  [options.record]      已知记录 { name, metadata }：优先用本地数据秒开
 * @param {boolean} [options.refresh]     true 时强制回源拉取最新 metadata
 * @param {string}  [options.previewMode] 'admin' | 'user'，传给 buildFileDetail
 * @returns {Promise<{ file, fileLink, urls } | null>}
 *          与 buildFileDetail 相同结构的详情对象；后端查无记录且无本地数据时返回 null
 */
export async function loadFileDetail(fileId, options = {}) {
    if (!fileId) return null
    const record = options.record || {}
    let metadata = record.metadata || null

    if (!metadata || options.refresh) {
        const queryId = encodeURIComponent(record.name || fileId)
        const res = await fetchWithAuth(`/api/manage/metadata/${queryId}`)
        const json = await res.json().catch(() => null)
        if (json && json.success !== false && json.data) {
            metadata = json.data.metadata || {}
        } else if (!metadata) {
            return null
        }
        // 回源失败但本地已有数据时，容忍失败并用本地数据兜底
    }

    const name = record.name || fileId
    return buildFileDetail({ name, metadata }, { previewMode: options.previewMode || 'admin' })
}
