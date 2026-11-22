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
    'foldAll h1 h2 h3 h4 h5 h6 | paragraph bold italic underline strike fontSize textColor highlight [对齐 alignLeft alignCenter alignRight] | taskList bulletList orderedList listConvert indent outdent | file upload linkExtract [浏览 image video audio]',
    'outline undo redo selectLine selectAll deleteNode clear | [插入 link whiteboard blockquote callout tabsBlock code codeBlock htmlBlock iframe annotate mathBlock subDoc] [粘贴 paste pasteKeep pastePlain pasteEscaped] [表格 table tableAddRow tableAddRowBefore tableAddCol tableAddColBefore tableDelRow tableDelCol tableMerge tableSplit tableDelete] [时间 dateYmd dateSlash dateDash dateCn timeHms] [工具 imgSizeCycle mediaPreview mediaDetail stats publish htmlMd importTemplate] | emoji symbol findReplace insertLineBelow hardBreak hr',
];

/** v1.3.7：光标工具栏出厂默认（`[组名 …]` 是一组下拉） */
export const DEFAULT_INPUT_TOOLS =
    '[标题 h1 h2 h3 h4 h5 h6] code codeBlock file upload linkExtract emoji symbol table hardBreak hr';

/** v1.3.7：标题与正文样式出厂默认 CSS */
export const DEFAULT_CUSTOM_CSS = [
    'h2 { font-size:1.8em; color:#CCFFFF; background-color: #64AA36; text-align: center; }',
    'h3 { font-size:1.8em; color:#FF9966; }',
    'h4 { font-size:1.6em; color:#0099FF; }',
    'h5 { font-size:1.4em; color:#CC0066; }',
    'h6 { font-size:1.2em; color:#006666; }',
    'p { line-height:1.8em; }',
].join('\n');

/** v1.3.7：滚动吸附出厂默认 —— PC 两行都吸，移动端只吸标题栏 */
export const DEFAULT_STICKY = {
    pc: { toolbar: true, title: true },
    m: { toolbar: false, title: true },
};

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
    // v1.3.9.1（需求）：设为上标 / 设为下标
    'superscript', 'subscript',
    // 三、列表
    'bulletList', 'orderedList', 'taskList', 'indent', 'outdent', 'listConvert',
    // 四、对齐与行级操作
    'alignLeft', 'alignCenter', 'alignRight',
    'hardBreak', 'insertLineBelow', 'selectLine', 'selectAll', 'deleteNode',
    // 五、插入内容
    'link', 'image', 'upload', 'file', 'video', 'audio', 'linkExtract', 'iframe',
    'table', 'whiteboard', 'emoji', 'symbol',
    'dateYmd', 'dateSlash', 'dateDash', 'dateCn', 'timeHms',
    'subDoc', 'publish',
    // 六、表格操作
    'tableAddRow', 'tableAddRowBefore', 'tableAddCol', 'tableAddColBefore',
    'tableDelRow', 'tableDelCol', 'tableMerge', 'tableSplit', 'tableDelete',
    // 七、内容工具（大纲 / 折叠 / 统计 / 查找 / HTML / 批注 / 导入模板）
    'outline', 'foldAll', 'stats', 'findReplace',
    'htmlMd', 'htmlBlock', 'annotate', 'importTemplate',
    // 八、粘贴
    'paste', 'pasteKeep', 'pastePlain', 'pasteEscaped',
    // 九、媒体
    'imgSizeCycle', 'mediaPreview', 'mediaDetail',
    // 十、撤销 / 重做
    'undo', 'redo',
];

export default DEFAULT_TOOLBAR_LINES;
