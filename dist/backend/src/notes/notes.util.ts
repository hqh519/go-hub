/**
 * 笔记板块 · 公共工具（v1.2.0）
 * ----------------------------------------------------------------------------
 * 这里放的全是「前后端必须用同一套口径」的规则：
 *   · 字数怎么数（瞬间 500 字上限）
 *   · 媒体类型怎么归类（纯文字 / 图片 / 视频 / 音频 / 混合）
 *   · 附件地址怎么拼（fileId → /file/<当前 File_ID>）
 *   · 标签名怎么清洗
 *
 * 为什么要单独成文件：字数与媒体类型都在「保存时算一次、列表直接读」的冗余列里，
 * 一旦前后端口径不一致，就会出现「前端说没超、后端说超了」这种最难解释的 bug。
 * 前端对应实现见 `frontend/src/utils/notes.js`，两处逻辑必须逐行等价。
 */

/**
 * 笔记类型（v1.3.0 起 memo 落地，其余仍为预留取值）
 *
 * v1.3.0 修正：原来的 `board` 换成 `memo` ——
 *   前端 `NotesManagePage.vue` 的 `KIND_CYCLE` 一直是 `square / moment / todo / nav /
 *   article / collection / memo`，`notes.typeMemo` 的文案与图标也早就存在；
 *   后端白名单里却写着 `board`，两边从来没有对齐过（点「笔记」分类会被后端拒绝）。
 *   这里统一成 `memo`，`board` 由 `normalizeNoteKind()` 兼容映射，历史数据不会失读。
 */
export const NOTE_KINDS = ['moment', 'article', 'collection', 'nav', 'todo', 'memo'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** 已废弃 / 被改名的类型 → 新名（读旧数据时兜底，写库时一律写新名） */
const NOTE_KIND_ALIASES: Record<string, NoteKind> = {
  board: 'memo',
};

/** 把任意输入收敛成合法类型；认不出返回空串（调用方按「没传」处理） */
export function normalizeNoteKind(raw: unknown): NoteKind | '' {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if ((NOTE_KINDS as readonly string[]).includes(s)) return s as NoteKind;
  const alias = NOTE_KIND_ALIASES[s];
  return alias || '';
}

/** 内容格式（v1.3.0） */
export const NOTE_CONTENT_FORMATS = ['', 'markdown'] as const;
export type NoteContentFormat = (typeof NOTE_CONTENT_FORMATS)[number];

/** 瞬间的媒体类型 */
export const MOMENT_MEDIA_KINDS = ['text', 'image', 'video', 'audio', 'mixed'] as const;
export type MomentMediaKind = (typeof MOMENT_MEDIA_KINDS)[number];

/**
 * 瞬间正文字数上限（只数汉字/字母/数字，不含标点与符号）。
 * v1.1.2：按需求由 500 提到 1000 —— 计数口径不变，标点/符号/空格仍不计入。
 */
export const DEFAULT_MOMENT_MAX_CHARS = 1000;

/** 单条留言的字数上限（v1.1.2，需求：每篇留言上限 500 字，计数规则同正文） */
export const MAX_COMMENT_CHARS = 500;

/**
 * 单篇附件的硬上限。
 * 需求是「列表只显示 9 个，超出部分点灯箱浏览」，所以 9 不是上限；
 * 但完全不设上限会让一个请求塞进几千个 fileId，这里取 50 作为防滥用边界。
 */
export const MAX_ASSETS_PER_NOTE = 50;

/** 单个标签名长度上限、单篇标签数量上限 */
export const MAX_TAG_NAME_LENGTH = 20;
export const MAX_TAGS_PER_NOTE = 20;

/** 可见性白名单（本版只落 private / public；specified = 指定人，留到分享版本） */
export const NOTE_VISIBILITIES = ['private', 'public', 'specified'] as const;

// ============================================================
//  笔记设置（v1.1.2.1）
//  ---------------------------------------------------------------------------
//  按**实例**保存（不是按用户、不是全局）：同一个实例里的人看到同一套附件区布局，
//  不同实例之间互不影响 —— 与文件 / 标签 / 笔记的隔离口径一致。
//  存储走设置表 key = `note-settings:<实例 id>`（默认实例用 `~default`），
//  值是一段 JSON —— 以后加「待办设置 / 导航设置 / 文章设置 / 收集设置」
//  只需要在同一个 JSON 里多挂一个键，不用改表结构、不用写迁移。
// ============================================================

/** 附件区大小模式：default = 保持现有布局；custom = 按「占页面最高比例」算 */
export const MOMENT_ATTACH_SIZES = ['default', 'custom'] as const;
/** 附件区水平位置：center = 居中（现有布局）；left = 与正文一样靠左 */
export const MOMENT_ATTACH_ALIGNS = ['center', 'left'] as const;

/**
 * v1.1.2.2 内容排版样式：
 *   default = 默认样式（每条瞬间一张带边框的卡片，现有观感）
 *   divider = 分割线样式（去掉外边框，条目之间用一条分割线隔开）
 */
export const MOMENT_LAYOUT_STYLES = ['default', 'divider'] as const;

/**
 * v1.1.2.2 附件数量加载（最多加载几行，每行 3 个）：
 *   3 = 加载三行（最多 9 个，现有行为）；2 = 加载两行（最多 6 个）；1 = 加载一行（最多 3 个）
 * 只影响「显示几个」，尺寸仍由 attachSize / attachRatio 决定。
 */
export const MOMENT_ATTACH_ROWS = [1, 2, 3] as const;

/** 「附件占页面最高比例」默认值 / 允许区间（百分比）。v1.1.2.3 起默认 35% */
export const DEFAULT_MOMENT_ATTACH_RATIO = 35;
export const MOMENT_ATTACH_RATIO_MIN = 5;
export const MOMENT_ATTACH_RATIO_MAX = 80;

/**
 * 显示个数 → 用户设定比例的折算系数（v1.1.2.3 需求原文表格）：
 *   一行 1 个        = 比例 x 80%
 *   一行 2 个        = 比例 x 70%
 *   一行 3 个        = 比例 x 60%
 *   两行 4 ~ 6 个    = 比例 x 80%
 *   三行 7 个及以上  = 比例 x 100%
 *
 * 注意口径是「**实际显示个数**」而不是「附件总数」：笔记设置里可以限制最多加载几行，
 * 被截断的部分不占高度，所以 9 个附件在「加载两行」下按 6 个（两行 80%）算。
 * 前端 `utils/noteSettings.js` 的 `attachHeightFactor()` 必须与这里保持一致。
 */
export function attachHeightFactorOf(count: number): number {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n <= 1) return 0.8;
  if (n === 2) return 0.7;
  if (n === 3) return 0.6;
  if (n <= 6) return 0.8;
  return 1;
}

/**
 * v1.1.2.3：**只有一个附件**时的折算系数。
 * 单附件按原图宽高比显示，总高度 = 页面高度 x 比例 x 80%（v1.1.2.2 是 70%）。
 * 前端 `utils/noteSettings.js` 里的 ATTACH_SINGLE_FACTOR 必须与这里保持一致。
 */
export const MOMENT_ATTACH_SINGLE_FACTOR = 0.8;

export interface MomentSettings {
  attachSize: (typeof MOMENT_ATTACH_SIZES)[number];
  attachRatio: number;
  attachAlign: (typeof MOMENT_ATTACH_ALIGNS)[number];
  /** v1.1.2.2：内容排版样式 */
  layoutStyle: (typeof MOMENT_LAYOUT_STYLES)[number];
  /** v1.1.2.2：附件最多加载几行（1 / 2 / 3） */
  attachRows: number;
}

/**
 * v1.1.7「通用设置」（笔记设置里排在「瞬间设置」前面的一个分类）：
 *   · pageLoad ：列表翻到底时的加载方式 —— auto 自动加载（默认）/ manual 手动点「加载更多」
 *   · fontSize ：瞬间正文的展示字号（px），只作用于正文，标题 / 日期等不动
 *   · pageBg   ：v1.1.8 新增 —— 笔记管理页的背景图（仅日间模式），
 *                存 `["url1","url2"]` 形式的字符串，多张时每次刷新随机取一张
 *
 * 默认值与前端 `utils/noteSettings.js` 的 DEFAULT_GENERAL_SETTINGS 必须完全一致。
 * 字号默认 14.5 = 当前列表里正文的实际字号（需求：「默认为当前的字号」）。
 */
export const NOTE_PAGE_LOAD_MODES = ['auto', 'manual'] as const;
export const DEFAULT_NOTE_PAGE_LOAD = 'auto';
export const DEFAULT_NOTE_FONT_SIZE = 14.5;
export const NOTE_FONT_SIZE_MIN = 12;
export const NOTE_FONT_SIZE_MAX = 22;

/**
 * 笔记页背景图的校验口径 —— 与「账户自定义背景图」（users.controller.ts 的 normalizeBkImg）
 * 刻意保持一致：同一产品里两处背景图能用什么地址、能填几张不该有两套答案。
 * 前端 `utils/noteSettings.js` 的 PAGE_BG_MAX_ITEMS / PAGE_BG_MAX_URL_LENGTH 同值。
 */
export const NOTE_PAGE_BG_MAX_ITEMS = 20;
export const NOTE_PAGE_BG_MAX_URL_LENGTH = 2000;

export interface GeneralSettings {
  pageLoad: (typeof NOTE_PAGE_LOAD_MODES)[number];
  fontSize: number;
  /** `["url1","url2"]`；空串 = 不设背景 */
  pageBg: string;
}

/**
 * 编辑器设置（v1.3.0）
 *
 * toolbarLines：一行一个工具栏，行内空格分隔工具名、`|` 生成分隔线。
 *   存字符串数组而不是结构化对象 —— 需求原文就是「输入名称」，
 *   用户改的是文本，存文本最直观；解析（split）放在渲染时做。
 * blockIds：保存时是否给内容块写 `^blk_` 行尾标记（默认关闭，见 memo.util.ts 说明）。
 */
export const EDITOR_TOOLBAR_MAX_LINES = 4;
export const EDITOR_TOOLBAR_MAX_LINE_LENGTH = 400;

/** 配色模式：跟随全局 / 白天 / 黑夜（v1.3.1.1） */
export const EDITOR_THEMES = ['auto', 'light', 'dark'] as const;
/** 历史记录自动保存间隔（分钟）允许区间 */
export const HISTORY_INTERVAL_MIN = 1;
export const HISTORY_INTERVAL_MAX = 120;
export const DEFAULT_HISTORY_INTERVAL = 3;

export interface EditorSettings {
  toolbarLines: string[];
  blockIds: boolean;
  /** v1.3.1.1：配色模式 —— auto = 跟随全站，light / dark = 编辑器独立配色 */
  theme: 'auto' | 'light' | 'dark';
  /** v1.3.1.1：光标停在空行时展示的「输入工具」配置（一行一条，支持 pc= / m= 前缀） */
  inputLines: string[];
  /** v1.3.1.1：「/」菜单工具配置（一行一条，支持 | 分隔线） */
  slashLines: string[];
  /*
   * v1.3.2（需求）：六类「上下文工具」各自可配。
   * 空数组 = 没配置过，前端用内置默认；这样升级后不会突然丢掉原来的菜单。
   */
  rightClickLines: string[];
  selectionLines: string[];
  selectImageLines: string[];
  selectVideoLines: string[];
  selectAudioLines: string[];
  selectFileLines: string[];
  /** v1.3.1.1：历史记录自动保存间隔（分钟） */
  historyInterval: number;
  /**
   * v1.3.1.2：滚动吸附（工具栏 / 标题栏 / 辅助栏），PC 与移动端各自独立，默认全关。
   * 分终端存是因为两端的可视高度差得远 —— 手机上三行都吸住会把正文压得只剩一小块。
   */
  sticky: EditorStickySettings;
  /**
   * v1.3.1.2：H1-H6 与正文的样式（字号用 em，随正文缩放；行高无单位）。
   * 之前这些数字写死在 CSS 里（--gh-h1-size 的 fallback），改一个字要改代码；
   * 现在搬进设置，前端把它们写成同样的 CSS 变量，样式表一行都不用动。
   */
  styles: EditorStyleSettings;
}

export interface EditorStyleSettings {
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  h5: number;
  h6: number;
  /** 正文行高（1.2 ~ 2.4） */
  lineHeight: number;
  /** v1.3.2：自定义 CSS（作用于编辑器正文区，选择器会自动加上作用域前缀） */
  customCss: string;
}

export const DEFAULT_EDITOR_STYLES: EditorStyleSettings = {
  h1: 1.75,
  h2: 1.45,
  h3: 1.24,
  h4: 1.1,
  h5: 1,
  h6: 0.94,
  lineHeight: 1.75,
  customCss: '',
};

/** 样式归一：数值夹在合理区间，防止「字号 0」这种把正文弄没的配置 */
export function normalizeEditorStyles(raw: unknown): EditorStyleSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number, dflt: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
  };
  return {
    h1: num(o.h1, 0.9, 3, DEFAULT_EDITOR_STYLES.h1),
    h2: num(o.h2, 0.9, 2.6, DEFAULT_EDITOR_STYLES.h2),
    h3: num(o.h3, 0.9, 2.2, DEFAULT_EDITOR_STYLES.h3),
    h4: num(o.h4, 0.85, 2, DEFAULT_EDITOR_STYLES.h4),
    h5: num(o.h5, 0.8, 1.8, DEFAULT_EDITOR_STYLES.h5),
    h6: num(o.h6, 0.75, 1.6, DEFAULT_EDITOR_STYLES.h6),
    lineHeight: num(o.lineHeight, 1.2, 2.4, DEFAULT_EDITOR_STYLES.lineHeight),
    // v1.3.2：自定义 CSS，长度封顶 4000 字，避免把整张设置行撑爆
    customCss: String(o.customCss || '').slice(0, 4000),
  };
}

/**
 * 单个终端的吸附开关。
 *
 * v1.3.3.2：移除 aux（辅助栏）—— 需求里「不再对辅助栏设置吸附功能」。
 * 旧数据里残留的 aux 字段在读入时被忽略（normalizeSticky 只取 toolbar / title），
 * 不会因为少一个键就报错，也不需要写迁移脚本。
 */
export interface StickyFlags {
  toolbar: boolean;
  title: boolean;
}

export interface EditorStickySettings {
  pc: StickyFlags;
  m: StickyFlags;
}

/** 吸附配置归一：非对象 / 缺字段一律按 false，不信任前端传值 */
export function normalizeSticky(raw: unknown): EditorStickySettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const one = (v: unknown): StickyFlags => {
    const x = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return { toolbar: x.toolbar === true, title: x.title === true };
  };
  return { pc: one(o.pc), m: one(o.m) };
}

/** 出厂默认工具栏（前端 utils/memoEditorConfig.js 同值，改这里要同步改那边） */
export const DEFAULT_EDITOR_TOOLBAR_LINES = [
  'h1 h2 h3 | bold italic strike underline code highlight | bulletList orderedList taskList | blockquote codeBlock hr',
  'alignLeft alignCenter alignRight | indent outdent | hardBreak paragraph | table [tableAddRow tableAddCol tableDelRow tableDelCol tableMerge tableSplit tableDelete] callout | image upload file video audio link linkExtract | outline foldAll | clear | undo redo',
];

/**
 * 工具栏行归一：去空行、压空白、限长限量。
 * 空的 `|` 不清理 —— 用户偶尔会留一个多余分隔线，视觉上只是多一条竖线，
 * 没必要为它清空用户配置（清空反而让人以为配置没保存）。
 */
export function normalizeToolbarLines(raw: unknown): string[] {
  let lines: unknown[] = [];
  if (Array.isArray(raw)) lines = raw;
  else if (typeof raw === 'string') lines = raw.split(/\r?\n/);
  const out = lines
    .map((l) => String(l ?? '').replace(/[\t ]+/g, ' ').trim().slice(0, EDITOR_TOOLBAR_MAX_LINE_LENGTH))
    .filter(Boolean)
    .slice(0, EDITOR_TOOLBAR_MAX_LINES);
  return out.length ? out : DEFAULT_EDITOR_TOOLBAR_LINES.slice();
}

export function normalizeEditorSettings(raw: unknown): EditorSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const themeRaw = String(o.theme || 'auto');
  const interval = Math.round(Number(o.historyInterval));
  return {
    toolbarLines: normalizeToolbarLines(o.toolbarLines),
    blockIds: o.blockIds === true,
    theme: themeRaw === 'light' || themeRaw === 'dark' ? themeRaw : 'auto',
    /*
     * 输入工具 / 斜杠菜单没有「出厂默认」概念（前端各自有内置列表），
     * 空数组表示「没配置过 → 用内置默认」，所以这里不做非空兜底。
     */
    inputLines: normalizeToolLines(o.inputLines, 8),
    slashLines: normalizeToolLines(o.slashLines, 12),
    rightClickLines: normalizeToolLines(o.rightClickLines, 12),
    selectionLines: normalizeToolLines(o.selectionLines, 12),
    selectImageLines: normalizeToolLines(o.selectImageLines, 8),
    selectVideoLines: normalizeToolLines(o.selectVideoLines, 8),
    selectAudioLines: normalizeToolLines(o.selectAudioLines, 8),
    selectFileLines: normalizeToolLines(o.selectFileLines, 8),
    historyInterval: Number.isFinite(interval)
      ? Math.min(HISTORY_INTERVAL_MAX, Math.max(HISTORY_INTERVAL_MIN, interval))
      : DEFAULT_HISTORY_INTERVAL,
    sticky: normalizeSticky(o.sticky),
    styles: normalizeEditorStyles(o.styles),
  };
}

/**
 * 工具行归一（输入工具 / 斜杠菜单共用）：
 * 去空行、压空白、限长、限条数。允许 `pc=` / `m=` 前缀与 `|` 分隔线，
 * 所以这里**不能**过滤 `|`，只做清洗。
 */
export function normalizeToolLines(raw: unknown, maxLines: number): string[] {
  let lines: unknown[] = [];
  if (Array.isArray(raw)) lines = raw;
  else if (typeof raw === 'string') lines = raw.split(/\r?\n/);
  return lines
    .map((l) => String(l ?? '').replace(/[\t ]+/g, ' ').trim().slice(0, EDITOR_TOOLBAR_MAX_LINE_LENGTH))
    .filter(Boolean)
    .slice(0, maxLines);
}

export interface NoteSettings {
  moment: MomentSettings;
  general: GeneralSettings;
  editor: EditorSettings;
  [key: string]: unknown;
}

/**
 * 把用户填的背景图文本收敛成 `["url1","url2"]`。
 * 能认 `["a","b"]`、单条 `a`，也能直接吃数组（前端回传时可能已是数组）。
 * 认不出的地址一律丢掉、绝不报错 —— 背景图纯粹是观感配置，
 * 不该因为它写错一个字符就把整份通用设置存不进去。
 */
export function normalizeNotePageBg(raw: unknown): string {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else {
    const text = String(raw ?? '').trim();
    if (!text) return '';
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) return '';
        arr = parsed;
      } catch {
        return '';
      }
    } else {
      /*
       * 与前端 parsePageBg 同口径：不强求方括号，一行一条也认。
       * 否则用户按行粘几条地址进来，整段会被当成「一条地址」过 http 校验后全部丢掉，
       * 表现为「我明明填了却没生效」。只按换行拆 —— 地址本身可能带逗号。
       */
      arr = text
        .split(/[\r\n]+/)
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }
  const list = arr
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .map((x) => x.slice(0, NOTE_PAGE_BG_MAX_URL_LENGTH))
    .filter((x) => /^https?:\/\//i.test(x) || x.startsWith('/'))
    .slice(0, NOTE_PAGE_BG_MAX_ITEMS);
  return list.length ? JSON.stringify(list) : '';
}

/** 把任意脏输入收敛成合法的「通用设置」（键缺失 / 非法时落默认，存过的值原样保留） */
export function normalizeGeneralSettings(raw: unknown): GeneralSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pageLoad = (NOTE_PAGE_LOAD_MODES as readonly string[]).includes(String(o.pageLoad))
    ? (String(o.pageLoad) as GeneralSettings['pageLoad'])
    : DEFAULT_NOTE_PAGE_LOAD;
  let fontSize = Number(o.fontSize);
  if (!Number.isFinite(fontSize) || fontSize <= 0) fontSize = DEFAULT_NOTE_FONT_SIZE;
  // 保留一位小数，避免前端滑块步进 0.5 时被四舍五入成整数
  fontSize = Math.min(NOTE_FONT_SIZE_MAX, Math.max(NOTE_FONT_SIZE_MIN, Math.round(fontSize * 10) / 10));
  const pageBg = normalizeNotePageBg(o.pageBg);
  return { pageLoad, fontSize, pageBg };
}

/**
 * 把任意脏输入收敛成合法的「瞬间设置」。
 *
 * v1.1.2.3 起出厂默认改为：指定比例 / 35% / 左对齐 / 分割线样式 / 加载两行。
 * 这里只在**键缺失或非法**时落默认值 —— 用户明确存过的值（哪怕是旧默认
 * 'default' / 'center' / 'default' / 3）原样保留，升级不会把人家改过的设置顶掉。
 */
export function normalizeMomentSettings(raw: unknown): MomentSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const size = (MOMENT_ATTACH_SIZES as readonly string[]).includes(String(o.attachSize))
    ? (String(o.attachSize) as MomentSettings['attachSize'])
    : 'custom';
  const align = (MOMENT_ATTACH_ALIGNS as readonly string[]).includes(String(o.attachAlign))
    ? (String(o.attachAlign) as MomentSettings['attachAlign'])
    : 'left';
  let ratio = Number(o.attachRatio);
  if (!Number.isFinite(ratio) || ratio <= 0) ratio = DEFAULT_MOMENT_ATTACH_RATIO;
  ratio = Math.min(MOMENT_ATTACH_RATIO_MAX, Math.max(MOMENT_ATTACH_RATIO_MIN, Math.round(ratio * 10) / 10));
  // 排版样式 / 附件行数：历史数据里没有这两个键 → 落到新的出厂默认（分割线 + 两行）
  const layoutStyle = (MOMENT_LAYOUT_STYLES as readonly string[]).includes(String(o.layoutStyle))
    ? (String(o.layoutStyle) as MomentSettings['layoutStyle'])
    : 'divider';
  const rowsNum = Math.round(Number(o.attachRows));
  const attachRows = (MOMENT_ATTACH_ROWS as readonly number[]).includes(rowsNum) ? rowsNum : 2;
  return { attachSize: size, attachRatio: ratio, attachAlign: align, layoutStyle, attachRows };
}

/** 整份笔记设置（未知分类原样透传，便于以后灰度上线新分类） */
export function normalizeNoteSettings(raw: unknown): NoteSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    ...o,
    general: normalizeGeneralSettings(o.general),
    moment: normalizeMomentSettings(o.moment),
    // v1.3.0：老库没有这个键 → 落出厂默认（不写库，等用户改设置时才落）
    editor: normalizeEditorSettings(o.editor),
  } as NoteSettings;
}

/**
 * 正文字数统计：只数「汉字 + 字母 + 数字」。
 *
 * 按需求原文「500 个字（不含标点和其他特殊符号）」：
 *   · 标点（，。！？、；：""''（）…）不计入
 *   · 空格 / 换行不计入
 *   · emoji / 特殊符号不计入
 *   · 中日韩汉字、拉丁字母、数字计入（`\p{L}` 已覆盖汉字与各语种字母）
 *
 * 用 for...of 按「码点」遍历而不是 `.length` —— 否则一个 emoji 会被算成 2 个字符，
 * 生僻字（代理对）也会算错。
 */
export function countTextChars(input: unknown): number {
  const s = String(input ?? '');
  if (!s) return 0;
  let n = 0;
  for (const ch of s) {
    if (/[\p{L}\p{N}]/u.test(ch)) n += 1;
  }
  return n;
}

/**
 * v1.2.2：留言字数只数「用户自己打的内容」，不数「回复 @某某：」这段前缀。
 *
 * 起因（需求原文）：前端把分母减掉了前缀长度，看起来数字变小了，本质还是被前缀占了额度。
 * 正确的口径是：500 字上限永远给用户，前缀只是展示用的引子。
 * 前缀格式由前端 `buildReplyContent` 拼出，正则必须与 `parseCommentContent` 一致。
 */
const REPLY_PREFIX_RE = /^回复 @[^：:\n]{1,40}[：:]/;

export function countCommentChars(input: unknown): number {
  const s = String(input ?? '');
  if (!s) return 0;
  return countTextChars(s.replace(REPLY_PREFIX_RE, ''));
}

/** 单个文件的媒体大类（用于九宫格排版与「媒体类型」聚合） */
export function mediaKindOfMime(mime: string): 'image' | 'video' | 'audio' | 'file' {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * 由附件 mime 列表推导瞬间的媒体类型：
 *   无附件                → text
 *   全部 image/*          → image
 *   全部 video/*          → video
 *   全部 audio/*          → audio
 *   其余（含多种、含普通文件） → mixed
 */
export function mediaKindOf(mimes: string[]): MomentMediaKind {
  const list = (mimes || []).filter(Boolean);
  if (list.length === 0) return 'text';
  const kinds = new Set(list.map((m) => mediaKindOfMime(m)));
  if (kinds.size > 1) return 'mixed';
  const only = Array.from(kinds)[0];
  if (only === 'image') return 'image';
  if (only === 'video') return 'video';
  if (only === 'audio') return 'audio';
  return 'mixed';
}

/**
 * 文件「当前」外链：`/file/<File_ID>`（逐段编码，File_ID 允许带目录层级）。
 *
 * 这是本模块唯一允许拼附件地址的地方。为什么不返回渠道直链：
 *   · 渠道直链带域名 —— 换自定义域名后历史数据全挂；
 *   · 渠道直链在「转存 / 存入本地」后会指向旧渠道 —— 换渠道后全挂；
 *   · `/file/<name>` 由服务端按当前主副本实时取流，改名/换渠道/换域名都自动跟随。
 *
 * 调用方必须用**当前**的 FileRecord.name 来拼（不是上传时记下的名字），
 * 文件改名后列表刷新即恢复，这也是「只存 fileId」的全部意义。
 */
export function fileUrlOf(name: string, thumb?: number): string {
  const raw = String(name || '').replace(/^\/+/, '');
  if (!raw) return '';
  const path = raw.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  const q = Number(thumb) > 0 ? `?thumb=${Math.round(Number(thumb))}` : '';
  return `/file/${path}${q}`;
}

/** 标签名清洗：去首尾空白、压缩内部空白、去重、限量 */
export function normalizeTagNames(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? String(raw).split(/[,，]/) : [];
  const out: string[] = [];
  for (const item of list) {
    let name = String(item ?? '')
      .replace(/[\r\n\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;
    if (name.length > MAX_TAG_NAME_LENGTH) name = name.slice(0, MAX_TAG_NAME_LENGTH);
    if (out.includes(name)) continue;
    out.push(name);
    if (out.length >= MAX_TAGS_PER_NOTE) break;
  }
  return out;
}

/** 安全 JSON.parse（坏数据不抛异常） */
export function safeParse(raw: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  const s = String(raw ?? '');
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : fallback;
  } catch {
    return fallback;
  }
}

/** 截断字符串（写日志用，避免把整篇正文灌进日志） */
export function brief(text: unknown, max = 60): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
