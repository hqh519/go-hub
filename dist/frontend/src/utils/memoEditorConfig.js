/**
 * 编辑器默认工具栏 / 工具元数据（v1.3.0 引入，v1.3.1 扩充）
 * ----------------------------------------------------------------------------
 * 从组件里抽出来的原因：设置页要「重置成默认」，编辑器要「读配置渲染」，
 * 两处都需要同一份默认值。SFC 只能默认导出组件，写不成具名导出，所以放这里。
 */

/**
 * 默认两行工具栏。
 * 语法与需求原文一致：空格分隔工具名，`|` 生成分隔线，一行就是一排。
 * 用户在「编辑器设置」里改的就是这段文本，改完直接写进笔记设置的 editor.toolbarLines。
 *
 * v1.3.1 加入：highlight / table / callout / video / audio / outline / foldAll。
 * 仍然保持两行 —— 需求要的是「吸附在顶部的两行工具栏」，
 * 工具再多也靠横滑（移动端）/ 溢出（桌面端）消化，不往上堆行数。
 */
export const DEFAULT_TOOLBAR_LINES = [
    'h1 h2 h3 | bold italic strike underline code highlight | bulletList orderedList taskList | blockquote codeBlock hr',
    /*
     * v1.3.1.1（需求）：一行放不下就横滑。
     * 新增：对齐三件套、缩进、换行、段落、上传、链接提取、表格操作组。
     * 表格操作做成工具组 `[...]`，平时只占一个下箭头的位置。
     */
    'alignLeft alignCenter alignRight | indent outdent | hardBreak paragraph | table [tableAddRow tableAddCol tableDelRow tableDelCol tableMerge tableSplit tableDelete] callout | image upload file video audio link linkExtract | outline foldAll | clear | undo redo',
];

/** 可在工具栏里使用的工具名（设置页展示用） */
export const TOOLBAR_TOKENS = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'bold', 'italic', 'strike', 'underline', 'code', 'highlight',
    'bulletList', 'orderedList', 'taskList',
    'blockquote', 'codeBlock', 'hr',
    'table', 'callout',
    'link', 'image', 'file', 'video', 'audio',
    'outline', 'foldAll',
    // v1.3.1.1 新增
    'alignLeft', 'alignCenter', 'alignRight', 'indent', 'outdent',
    'hardBreak', 'paragraph', 'upload', 'linkExtract',
    'tableAddRow', 'tableAddCol', 'tableDelRow', 'tableDelCol', 'tableMerge', 'tableSplit', 'tableDelete',
    'clear', 'undo', 'redo',
    // v1.3.1.2 新增但上一版漏登记的 16 个
    'tableAddRowBefore', 'tableAddColBefore',
    'selectLine', 'selectAll',
    'dateYmd', 'dateSlash', 'dateDash', 'dateCn', 'timeHms',
    'emoji', 'symbol', 'iframe', 'findReplace', 'htmlMd', 'htmlBlock', 'annotate',
    // v1.3.2 新增
    'insertLineBelow', 'paste', 'pasteKeep', 'pastePlain', 'pasteEscaped',
];

export default DEFAULT_TOOLBAR_LINES;
