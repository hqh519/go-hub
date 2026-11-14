/**
 * 文件筛选求值（共享模块，v1.1.3）
 * ----------------------------------------------------------------------------
 * 为什么抽出来：
 *   「图床管理」页的筛选（常规 / 标签 / 日期 / 大小 / 尺寸）原本是
 *   FilesController 的私有方法 `filterGroups`，只有文件列表 / 回收站能用。
 *   v1.1.3 要求「瞬间编辑页 → 选择文件 → 图床文件」模式复刻同一套筛选范围，
 *   如果照抄一份，以后改一边漏一边。所以整段逻辑提到这里，
 *   FilesController 保留同名私有方法做**薄委托**（调用点一行都不用改），
 *   笔记选文件器（NotesService.pickFiles）直接调本模块 → 口径天然一致。
 *
 * 设计约束：
 *   · 纯函数，不碰 prisma、不碰 Nest 容器，只吃「一行文件记录 + 一组筛选值」；
 *   · 返回 boolean[]（每个数组项 = 一个独立条件），
 *     由调用方决定 all（全部满足）/ any（满足任一）；
 *   · 逐值拆分逻辑（pushGroup）与 matchMode 语义保持 v3.0.0 原样，
 *     不改任何既有筛选行为 —— 这次只是搬家。
 */
import {
  CHANNEL_LABEL,
  fileTypeOf,
  normalizeUploadSource,
  pickPrimaryCopy,
  safeParse,
} from './file-view';

/** 筛选参数（与 FilesController 原签名逐字段一致） */
export interface FileFilterOpts {
  /**
   * v1.2.2：这三个曾经是单值字符串（yes / no），前端只勾一个才传。
   * 现在统一成数组 —— 勾了几个就传几个，怎么组合完全交给「且/或」模式：
   *   且(all) → 逐值成条件，yes+no 同时勾必然无结果（这是预期，不是 bug）；
   *   或(any) → 分区内命中任一值即可，yes+no 同时勾则全部命中。
   */
  hasTags: string[];
  /** v1.1.6：引用 / 共用筛选（yes / no，可多选） */
  hasRef: string[];
  hasShare: string[];
  filterTags: string[];
  tagMode: string;
  listType: string[];
  label: string[];
  fileType: string[];
  channel: string[];
  channelName: string[];
  uploadSource: string[];
  backup: string[];
  redirect: string[];
  access: string[];
  validity: string[];
  nameChanged: string[];
  /** v1.2.1：剪辑状态筛选（edited / unedited），依据 FileRecord.editedAt */
  edited: string[];
  /** v1.2.1：MD5 变化筛选（changed / unchanged），依据 md5 与 originalMd5 是否一致 */
  md5Changed: string[];
  users: string[];
  fromMs: number;
  toMs: number;
  sizeMin: number;
  sizeMax: number;
  sizeMode: string;
  ratingMin: number | null;
  ratingMax: number | null;
  levelMin: number | null;
  levelMax: number | null;
  dimPreset: string[];
  widthMin: number;
  widthMax: number;
  heightMin: number;
  heightMax: number;
}

/** 逗号分隔参数 → 数组（与 FilesController 内部 splitCsv 同义） */
export function splitCsv(v?: string): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * v1.2.2：yes / no 型多选参数 —— 只保留合法值。
 * 非法值如果留在数组里，在「或」模式下会把整个分区变成恒真，等于静默吞掉这条筛选。
 */
export function splitYesNo(v?: string): string[] {
  return splitCsv(v)
    .map((s) => s.toLowerCase())
    .filter((s) => s === 'yes' || s === 'no');
}

/**
 * 数字区间参数：空 / 非数字 → null（= 该侧不限）。
 * 原样搬运 FilesController.numOrNullParam。
 */
export function numOrNull(raw: unknown, max: number): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(max, n));
}

/**
 * 从 query 里解析整套筛选参数。
 * 与 FilesController 里 `/api/files/list`、`/api/files/trash` 两处的内联解析同源，
 * 抽出来之后笔记选文件器也能用同一份（少一份漂移）。
 */
export function parseFileFilterQuery(q: Record<string, string | undefined>): FileFilterOpts {
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(q.dateFrom || '')) ? String(q.dateFrom) : '';
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(q.dateTo || '')) ? String(q.dateTo) : '';
  const tzMin = Number(q.tz);
  const tzOffset = Number.isFinite(tzMin) ? Math.max(-840, Math.min(840, tzMin)) : 0;
  const dayStartMs = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y, m - 1, d) + tzOffset * 60_000;
  };
  return {
    hasTags: splitYesNo(q.hasTags),
    hasRef: splitYesNo(q.hasRef),
    hasShare: splitYesNo(q.hasShare),
    filterTags: splitCsv(q.filterTags),
    tagMode: String(q.tagMode || 'and').toLowerCase() === 'or' ? 'or' : 'and',
    listType: splitCsv(q.listType),
    label: splitCsv(q.label),
    fileType: splitCsv(q.fileType),
    channel: splitCsv(q.channel),
    channelName: splitCsv(q.channelName),
    uploadSource: splitCsv(q.uploadSource).map((v) => normalizeUploadSource(v)),
    backup: splitCsv(q.backup),
    redirect: splitCsv(q.redirect),
    access: splitCsv(q.accessStatus),
    validity: splitCsv(q.validity).map((v) => v.toLowerCase()),
    nameChanged: splitCsv(q.nameChanged).map((v) => v.toLowerCase()),
    // v1.2.1：剪辑 / MD5 变化两组筛选（参数名与前端 query 键一致）
    edited: splitCsv(q.edited).map((v) => v.toLowerCase()),
    md5Changed: splitCsv(q.md5Changed).map((v) => v.toLowerCase()),
    users: splitCsv(q.filterUsers),
    fromMs: dateFrom ? dayStartMs(dateFrom) : 0,
    toMs: dateTo ? dayStartMs(dateTo) + 86_400_000 - 1 : 0,
    sizeMin: Math.max(0, Number(q.sizeMin) || 0),
    sizeMax: Math.max(0, Number(q.sizeMax) || 0),
    sizeMode: String(q.sizeMode || 'actual').toLowerCase() === 'original' ? 'original' : 'actual',
    ratingMin: numOrNull(q.ratingMin, 5),
    ratingMax: numOrNull(q.ratingMax, 5),
    levelMin: numOrNull(q.levelMin, 5),
    levelMax: numOrNull(q.levelMax, 5),
    dimPreset: splitCsv(q.dimPreset).map((v) => v.toLowerCase()),
    widthMin: Math.max(0, Number(q.widthMin) || 0),
    widthMax: Math.max(0, Number(q.widthMax) || 0),
    heightMin: Math.max(0, Number(q.heightMin) || 0),
    heightMax: Math.max(0, Number(q.heightMax) || 0),
  };
}

/** 是否「一个筛选值都没有」（用于决定要不要走内存筛选、列表如何提示） */
export function isEmptyFileFilter(f: FileFilterOpts): boolean {
  return (
    !f.hasTags.length &&
    !f.hasRef.length &&
    !f.hasShare.length &&
    !f.filterTags.length &&
    !f.listType.length &&
    !f.label.length &&
    !f.fileType.length &&
    !f.channel.length &&
    !f.channelName.length &&
    !f.uploadSource.length &&
    !f.backup.length &&
    !f.redirect.length &&
    !f.access.length &&
    !f.validity.length &&
    !f.nameChanged.length &&
    !f.edited.length &&
    !f.md5Changed.length &&
    !f.users.length &&
    !f.fromMs &&
    !f.toMs &&
    !f.sizeMin &&
    !f.sizeMax &&
    f.sizeMode !== 'original' &&
    f.ratingMin === null &&
    f.ratingMax === null &&
    f.levelMin === null &&
    f.levelMax === null &&
    !f.dimPreset.length &&
    !f.widthMin &&
    !f.widthMax &&
    !f.heightMin &&
    !f.heightMax
  );
}

/** 尺寸快捷选项匹配：宽高不分横竖（横屏/竖屏都能命中），分辨率档位按「短边」分桶 */
export function matchDimPreset(w: number, h: number, preset: string): boolean {
  if (!w || !h) return false;
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  const ratio = long / Math.max(1, short);
  switch (preset) {
    case 'landscape':
      return w > h;
    case 'portrait':
      return h > w;
    case 'square':
      return Math.abs(w - h) <= Math.max(2, Math.round(long * 0.01));
    case 'ratio-4-3':
      return Math.abs(ratio - 4 / 3) <= 0.06;
    case 'ratio-16-9':
      return Math.abs(ratio - 16 / 9) <= 0.08;
    case '360p':
      return short >= 300 && short < 420;
    case '480p':
      return short >= 420 && short < 600;
    case '720p':
      return short >= 600 && short < 840;
    case '1080p':
      return short >= 840 && short < 1300;
    case '2k':
      return short >= 1300 && short < 1800;
    case '4k':
      return short >= 1800 && short < 2600;
    case '8k':
      return short >= 4000;
    default:
      return false;
  }
}

/**
 * 逐条件求值。
 *
 * 与 v3.0.0 的 FilesController.filterGroups 完全一致（含注释里记录的
 * 「同时(all) → 逐值独立成条件」「任意(any) → 分区内 OR」的语义）。
 */
export function fileFilterGroups(
  r: any,
  f: FileFilterOpts,
  matchMode: 'all' | 'any' = 'all',
): boolean[] {
  const groups: boolean[] = [];
  /**
   * 多值分区的统一出口：
   *   同时(all) → 逐值独立成条件（每个值都必须命中，AND）；
   *   任意(any) → 分区一个条件，命中任一值即可（OR，旧行为）。
   */
  const pushGroup = (values: string[], pred: (v: string) => boolean) => {
    if (matchMode === 'all') values.forEach((v) => groups.push(pred(v)));
    else groups.push(values.some((v) => pred(v)));
  };

  const tagNames: string[] = Array.isArray(r.tags)
    ? r.tags.map((t: any) => t?.tag?.name).filter(Boolean)
    : [];
  /*
   * v1.2.2：这三组也改成 pushGroup —— 与其它多选分区完全同构。
   * 勾了 yes 和 no 两个值时：且模式 → 两个条件互斥，必然筛不出（预期）；
   * 或模式 → 任一命中，等价于不筛（也符合「有一个勾选项有内容就能筛出来」）。
   */
  const hasTagPred = (v: string) => (v === 'yes' ? tagNames.length > 0 : tagNames.length === 0);
  const hasRefPred = (v: string) => (v === 'yes' ? Number(r.refCount || 0) > 0 : Number(r.refCount || 0) <= 0);
  const hasSharePred = (v: string) =>
    v === 'yes' ? Number(r.shareCount || 0) > 0 : Number(r.shareCount || 0) <= 0;
  pushGroup(f.hasTags, hasTagPred);
  /*
   * v1.1.6：引用 / 共用筛选 —— 读 FileRecord 上的缓存列（refCount / shareCount）。
   * 调用方在启用这两项筛选时会先按需重算一遍统计（syncFileStats persist=false），
   * 所以这里可以直接用列值，不会因为缓存过期而筛错。
   */
  pushGroup(f.hasRef, hasRefPred);
  pushGroup(f.hasShare, hasSharePred);
  // 标签筛选有自己的「或/且」开关（tagMode），不参与这里的逐值拆分
  if (f.filterTags.length) {
    groups.push(
      f.tagMode === 'or'
        ? f.filterTags.some((t) => tagNames.includes(t))
        : f.filterTags.every((t) => tagNames.includes(t)),
    );
  }

  const metas = safeParse(r.metas);
  const listType = (metas.ListType as string) || 'None';
  const label = (metas.Label as string) || 'None';
  pushGroup(f.listType, (v) => v === listType);
  pushGroup(f.label, (v) => v === label);
  pushGroup(f.fileType, (v) => v === fileTypeOf(r.mime));

  const copies: any[] = Array.isArray(r.copies) ? r.copies : [];
  // v1.0.4：统一口径 —— 先认 fileCopy.isPrimary（转存后指向新渠道），再回退渠道 isMain
  const primary = pickPrimaryCopy(copies);
  const chType = primary?.channel?.type || '';
  const chLabel = chType ? CHANNEL_LABEL[chType] || chType : '';
  const chName = String(primary?.channel?.name || '');
  pushGroup(f.channel, (v) => v === chLabel);
  pushGroup(f.channelName, (v) => v === chName);
  // v3.0.0：上传渠道筛选新增「登记文件 (Record)」—— normalizeUploadSource 本就把
  // 'Record' 规范化为合法值（UPLOAD_SOURCES 白名单含 Record），这里无需特判
  pushGroup(f.uploadSource, (v) => v === normalizeUploadSource(r.uploadSource));
  pushGroup(f.users, (v) => v === String(r.uploader || ''));

  if (f.backup.length) {
    // v1.0.9：与取源口径保持一致 —— 只有 objectPath 的副本同样是「有备份」
    const hasBackup = copies.some(
      (c) => c !== primary && c?.status === 'active' && (c?.remoteKey || c?.remoteUrl || c?.objectPath),
    );
    pushGroup(f.backup, (v) => (v === 'backedup' ? hasBackup : !hasBackup));
  }

  if (f.redirect.length) {
    const has = !!r.redirectUrl;
    pushGroup(f.redirect, (v) => (v === 'yes' ? has : !has));
  }

  if (f.access.length) {
    // v2.9.0：已删除（回收站）—— 列表接口按 status='deleted' 取数后同样走这里判定
    const deleted = String(r.status || 'active') === 'deleted';
    /*
     * v3.0.0：已加密 —— metas.AccessPasswordHash 必须是「非空字符串」才算，
     * 库级粗筛只会命中出现该键的行，"AccessPasswordHash":"" 在这一步被排除。
     */
    const encrypted = !!String(metas.AccessPasswordHash || '').trim();
    pushGroup(
      f.access,
      (v) =>
        (v === 'encrypted' && encrypted) ||
        (v === 'deleted' && deleted) ||
        (!deleted && v === 'normal' && listType === 'None') ||
        (!deleted && v === 'block' && listType === 'Block') ||
        (!deleted && v === 'white' && listType === 'White'),
    );
  }

  if (f.fromMs || f.toMs) {
    const t = r.createdAt ? new Date(r.createdAt).getTime() : 0;
    groups.push(!!t && (!f.fromMs || t >= f.fromMs) && (!f.toMs || t <= f.toMs));
  }

  if (f.sizeMin > 0 || f.sizeMax > 0 || f.sizeMode === 'original') {
    const cmpSize = f.sizeMode === 'original' ? Number(r.originalSize) || r.size || 0 : r.size || 0;
    groups.push((!f.sizeMin || cmpSize >= f.sizeMin) && (!f.sizeMax || cmpSize <= f.sizeMax));
  }

  /*
   * v3.0.0（R8）：评级筛选 ——
   *   ratingMin/Max：null = 该侧不限；「未评分」= 0/0（评分必须等于 0）。
   *   levelMin/Max 同理（「未设等级」= 0/0）。
   */
  if (f.ratingMin !== null || f.ratingMax !== null || f.levelMin !== null || f.levelMax !== null) {
    const rating = Number((r as unknown as { rating?: number }).rating) || 0;
    const level = Number((r as unknown as { level?: number }).level) || 0;
    groups.push(
      (f.ratingMin === null || rating >= f.ratingMin) &&
        (f.ratingMax === null || rating <= f.ratingMax) &&
        (f.levelMin === null || level >= f.levelMin) &&
        (f.levelMax === null || level <= f.levelMax),
    );
  }

  if (f.validity.length) {
    const exp = r.linkExpiresAt as Date | null | undefined;
    const expMs = exp ? new Date(exp).getTime() : 0;
    const now = Date.now();
    pushGroup(
      f.validity,
      (v) =>
        (v === 'limited' && expMs > now) ||
        (v === 'expired' && expMs > 0 && expMs <= now) ||
        (v === 'permanent' && !expMs),
    );
  }

  if (f.nameChanged.length) {
    const renamed = !!String(r.prevName || '');
    pushGroup(f.nameChanged, (v) => (v === 'changed' ? renamed : !renamed));
  }

  /*
   * v1.2.1（需求）：
   *   edited     —— 剪辑状态。编辑页「保存并替换」成功时写 FileRecord.editedAt，
   *                 所以「剪辑过」= editedAt 有值，老数据为 null 一律算未剪辑。
   *   md5Changed —— 内容是否变化过。实际 md5 ≠ 原始 md5 即变化过；
   *                 原始 md5 缺失（v1.2.1 之前的老记录）时回落用实际 md5，判为未变化，
   *                 避免把历史文件整批误标成「变化过」。
   */
  if (f.edited.length) {
    const edited = !!r.editedAt;
    pushGroup(f.edited, (v) => (v === 'edited' ? edited : !edited));
  }
  if (f.md5Changed.length) {
    const cur = String(r.md5 || '').trim().toLowerCase();
    const origin = String(r.originalMd5 || '').trim().toLowerCase() || cur;
    const changed = !!cur && cur !== origin;
    pushGroup(f.md5Changed, (v) => (v === 'changed' ? changed : !changed));
  }

  if (f.dimPreset.length || f.widthMin || f.widthMax || f.heightMin || f.heightMax) {
    const w = Number((metas.Width as number) || 0);
    const h = Number((metas.Height as number) || 0);
    if (!w || !h) {
      groups.push(false);
    } else {
      const okRange =
        (!f.widthMin || w >= f.widthMin) &&
        (!f.widthMax || w <= f.widthMax) &&
        (!f.heightMin || h >= f.heightMin) &&
        (!f.heightMax || h <= f.heightMax);
      const okPreset = !f.dimPreset.length || f.dimPreset.some((p) => matchDimPreset(w, h, p));
      groups.push(okRange && okPreset);
    }
  }

  return groups;
}

/** 一行记录是否通过筛选（含 matchMode 语义） */
export function passesFileFilters(
  r: any,
  f: FileFilterOpts,
  matchMode: 'all' | 'any' = 'all',
): boolean {
  const groups = fileFilterGroups(r, f, matchMode);
  if (!groups.length) return true;
  return matchMode === 'any' ? groups.some(Boolean) : groups.every(Boolean);
}
