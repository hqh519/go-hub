/**
 * 文档树节点设置（v1.3.9.1）
 * ----------------------------------------------------------------------------
 * 「节点设置」弹窗里的默认值、图标候选、以及「节点 → 图标」解析都收在这里：
 * 树组件（MemoTree）与设置弹窗（MemoTree 内嵌）共用同一份常量，避免两边各写一套
 * 导致「设置里选了、树上没变」。
 *
 * 图标一律用 FontAwesome 的单色图标名（不使用彩色 emoji），对应
 * @/utils/fontawesomeIcons.js 里已注册的 solid 图标，保证任何终端渲染一致。
 */

/** 5 种文档类型（顺序与后端 SYSTEM_ROOT_TITLES 一致） */
export const DOC_TYPES = [
    { key: 'note', label: 'memo.typeNote', icon: 'file-lines' },
    { key: 'diary', label: 'memo.typeDiary', icon: 'calendar-day' },
    { key: 'journal', label: 'memo.typeJournal', icon: 'pen-to-square' },
    { key: 'inspiration', label: 'memo.typeInspiration', icon: 'bolt' },
    { key: 'template', label: 'memo.typeTemplate', icon: 'clone' },
];

/** 每种类型的「页」默认图标（不含下级的节点） */
export const DEFAULT_TYPE_ICON = {
    note: 'file-lines',
    diary: 'calendar-day',
    journal: 'pen-to-square',
    inspiration: 'bolt',
    template: 'clone',
};

/** 节点设置默认值（与后端 DEFAULT_NODE_SETTINGS 逐字段对齐）
 * v1.3.9.2（需求）：初始默认值按参考图落定 —— 行高 30、显示关系线、
 * 目录节点用 book-bookmark，各类型页依次 file-lines / heart / feather-pointed / lightbulb，
 * 模板留空走默认图标。 */
export const DEFAULT_NODE_SETTINGS = {
    rowHeight: 30,
    showLines: true,
    /** 目录节点（含下级）的图标；空串 = 用默认文件夹 */
    folderIcon: 'book-bookmark',
    /** 各类型「页」的图标；空串 = 用 DEFAULT_TYPE_ICON 对应值 */
    typeIcons: { note: 'file-lines', diary: 'heart', journal: 'feather-pointed', inspiration: 'lightbulb', template: '' },
};

/**
 * 图标候选（单色 FontAwesome，全部已在 fontawesomeIcons.js 注册）。
 * value 为空串表示「默认」，其余每个都是一个图标名。
 *
 * v1.3.9.1（需求）：补入更多与笔记 / 日记 / 札记 / 灵感 / 文档 / 文章相关的图标
 * （book-open、newspaper、feather-pointed、pen-nib、pencil、
 *  file-pen、lightbulb、bookmark、book-bookmark 等），并在 fontawesomeIcons.js
 * 里统一注册，保证任何终端渲染一致。
 */
export const ICON_CHOICES = [
    '', 'folder', 'folder-open', 'folder-tree', 'file-lines', 'file', 'file-alt',
    'file-pen', 'file-signature', 'file-circle-plus', 'note-sticky',
    'book', 'book-open', 'book-bookmark', 'newspaper', 'bookmark', 'calendar',
    'calendar-day', 'edit', 'pen-to-square', 'pen-nib', 'pencil', 'feather-pointed',
    'lightbulb', 'bolt', 'clone', 'star', 'heart', 'tag', 'tags', 'compass',
    'layer-group', 'clipboard', 'clipboard-list', 'clock', 'list', 'table', 'code',
    'image', 'images', 'inbox', 'sun', 'moon', 'cloud', 'copy', 'database', 'globe',
    'hashtag', 'history', 'home', 'key', 'link', 'music', 'paperclip', 'paper-plane',
    'save', 'server', 'shield', 'sync', 'tools', 'user', 'users', 'highlighter',
    'shapes', 'chart-bar', 'film', 'terminal', 'heading', 'quote-right',
    'object-group', 'window-maximize',
];

/** 归一化：从服务端读来的设置可能缺项 / 越界，全部补齐裁切 */
export function normalizeNodeSettings(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const ti = s.typeIcons && typeof s.typeIcons === 'object' ? s.typeIcons : {};
    const typeIcons = {};
    for (const d of DOC_TYPES) {
        const v = ti[d.key];
        // v1.3.9.2：缺项时才落新默认值；用户显式选了「默认图标」（空串）要保留
        typeIcons[d.key] = typeof v === 'string' && ICON_CHOICES.includes(v) ? v : DEFAULT_NODE_SETTINGS.typeIcons[d.key] || '';
    }
    const rowHeight = Number(s.rowHeight);
    return {
        rowHeight: Number.isFinite(rowHeight) && rowHeight >= 22 && rowHeight <= 64 ? Math.round(rowHeight) : DEFAULT_NODE_SETTINGS.rowHeight,
        showLines: typeof s.showLines === 'boolean' ? s.showLines : DEFAULT_NODE_SETTINGS.showLines,
        folderIcon: typeof s.folderIcon === 'string' && ICON_CHOICES.includes(s.folderIcon) ? s.folderIcon : DEFAULT_NODE_SETTINGS.folderIcon,
        typeIcons,
    };
}

/**
 * 解析某个节点该显示哪个图标：
 *  · 系统一级节点（笔记/日记/札记/灵感/模板）：直接用「各类型页面图标」里本类型的图标，
 *    与下级同套图标、只靠颜色区分（一级节点着色、下级不着色）；
 *  · 目录节点（含下级）：folderIcon（空 = 默认 folder-open）；
 *  · 叶子节点页：对应 docType 的 typeIcons（空 = DEFAULT_TYPE_ICON）。
 */
export function iconForNode(node, settings) {
    const s = normalizeNodeSettings(settings);
    const typeIcon = s.typeIcons[node.docType] || DEFAULT_TYPE_ICON[node.docType] || 'file-lines';
    // v1.3.9.3（需求）：一级节点不再用系统专属图标，改为各类型页面的自身图标；
    // 颜色差异由模板里的 .is-system 控制，这里只决定图标名。
    if (node.isSystem) return typeIcon;
    const hasChildren = Array.isArray(node.children) ? node.children.length > 0 : !!node.directCount;
    if (hasChildren) return s.folderIcon || 'folder-open';
    return typeIcon;
}

/** 归一化后的类型图标（编辑器标题栏用，取「当前文档所属类型」的图标） */
export function typeIconOf(docType, settings) {
    const s = normalizeNodeSettings(settings);
    return s.typeIcons[docType] || DEFAULT_TYPE_ICON[docType] || 'file-lines';
}
