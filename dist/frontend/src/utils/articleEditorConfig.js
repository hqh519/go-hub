/**
 * 文章 / 待办编辑页的编辑器设置（v1.4.0）
 * ----------------------------------------------------------------------------
 * 文章板块与记事板块**共用同一套编辑器**，工具栏 / 样式 / 吸附这些偏好自然也应该
 * 共用同一份用户设置（后台「记事设置」里配的工具栏，写文章时同样生效）。
 *
 * 这里只做「拉取 + 兜底」，不做二次归一 —— 编辑器自己会对缺项回退默认值，
 * 在这里再抄一份归一逻辑只会在两处慢慢跑偏。
 */
import axios from '@/utils/axios';
import { DEFAULT_TOOLBAR_LINES } from '@/utils/memoEditorConfig';

export async function fetchEditorConfig(instanceId = '') {
    try {
        const res = await axios.get('/api/notes/settings', { params: { instanceId } });
        const editor = res?.data?.data?.editor || {};
        const lines =
            Array.isArray(editor.toolbarLines) && editor.toolbarLines.length
                ? editor.toolbarLines.map((x) => String(x || ''))
                : DEFAULT_TOOLBAR_LINES.slice();
        return { ...editor, toolbarLines: lines };
    } catch (e) {
        return { toolbarLines: DEFAULT_TOOLBAR_LINES.slice() };
    }
}
