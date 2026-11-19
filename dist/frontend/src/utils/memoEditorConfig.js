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
    'alignLeft alignCenter alignRight | indent outdent | hardBreak paragraph | table [tableAddRow tableAddCol tableDelRow tableDelCol tableMerge tableSplit tableDelete] callout mathBlock tabsBlock | image upload file video audio link linkExtract | outline foldAll | clear | undo redo',
];

/**
 * 可在工具栏里使用的工具名（设置页展示用）
 *
 * v1.3.5（需求：按相近类型重新排序）
 * 之前是「按版本追加」的顺序，同一类工具散落在数组各处，设置页读起来很乱。
 * 现在按功能归成十组，组内保持常用度排序；新增工具直接加到对应组末尾。
 */
export const TOOLBAR_TOKENS = [
    // 一、标题与段落结构
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'paragraph', 'blockquote', 'callout', 'mathBlock', 'tabsBlock', 'codeBlock', 'hr',
    // 二、文字格式
    'bold', 'italic', 'underline', 'strike', 'highlight', 'code',
    'fontSize', 'textColor', 'clear',
    // 三、列表
    'bulletList', 'orderedList', 'taskList', 'indent', 'outdent', 'listConvert',
    // 四、对齐与行级操作
    'alignLeft', 'alignCenter', 'alignRight',
    'hardBreak', 'insertLineBelow', 'selectLine', 'selectAll', 'deleteNode',
    // 五、插入内容
    'link', 'image', 'upload', 'file', 'video', 'audio', 'linkExtract', 'iframe',
    'table', 'emoji', 'symbol',
    'dateYmd', 'dateSlash', 'dateDash', 'dateCn', 'timeHms',
    'subDoc', 'publish',
    // 六、表格操作
    'tableAddRow', 'tableAddRowBefore', 'tableAddCol', 'tableAddColBefore',
    'tableDelRow', 'tableDelCol', 'tableMerge', 'tableSplit', 'tableDelete',
    // 七、内容工具（大纲 / 折叠 / 统计 / 查找 / HTML / 批注）
    'outline', 'foldAll', 'stats', 'findReplace',
    'htmlMd', 'htmlBlock', 'annotate',
    // 八、粘贴
    'paste', 'pasteKeep', 'pastePlain', 'pasteEscaped',
    // 九、媒体
    'imgSizeCycle', 'mediaPreview', 'mediaDetail',
    // 十、撤销 / 重做
    'undo', 'redo',
];

export default DEFAULT_TOOLBAR_LINES;
