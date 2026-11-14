/**
 * 去重判定（v1.2.1）
 * ============================================================
 * 背景（需求原文）：
 *   「如果上传文件后，对文件进行了压缩、转码、转 webp、编辑等处理，那么文件 md5 和大小
 *     都发生了变化，下次继续上传它的原始文件时就会检测不到重复文件的存在性。」
 *
 * 原因有两层，之前只解决了一半：
 *   1) 大小：`originalSize` 记的是压缩前的体积，所以「大小」这一侧本来就能对上；
 *   2) md5：`md5` 列在原位编辑（裁剪 / 压缩 / 转 WebP / 转码）后会被**刷新成新内容的 md5**
 *      （见 files/media-edit.ts 的 commitEdit）。一旦刷新，原始文件的 md5 就没有任何列
 *      还记着了 —— 再传一次原图，md5 比不上，自然判不成重复。
 *
 * 本版做法：
 *   · 新增 `originalMd5`：上传那一刻的原文件 md5，永不改变；
 *   · 判定改成两组，命中任意一组即视为重复：
 *       ① 上传大小 == 原始大小 且 上传 md5 == 原始 md5
 *       ② 上传大小 == 实际大小 且 上传 md5 == 实际 md5
 *          （库里没有实际值 / 实际值缺失时，回落用原始值）
 *
 * 为什么两组都要：①保证「原文件」永远能被认出来；②保证「已经被处理过的那个文件」
 * 被再次拖进来时也认得出——否则用户会看到同一个内容存了两份。
 */

/** 一次待判定的上传：大小 + 内容 md5 */
export interface DedupProbe {
  size: number;
  md5: string;
}

/** 库里的一条候选项（只要这几个字段，别的地方不必为它多查一遍库） */
export interface DedupCandidate {
  /** 当前实际大小 */
  size?: number | null;
  /** 原始大小（压缩前）；0 / 空 = 没记过 */
  originalSize?: number | null;
  /** 当前实际内容的 md5 */
  md5?: string | null;
  /** 最初的 md5（永不改变）；空 = 旧数据没这一列 */
  originalMd5?: string | null;
  /** v1.2.2：剪辑过的时间；有值 = 这条记录的内容已被裁剪/旋转/涂鸦/文字覆盖过 */
  editedAt?: Date | string | null;
}

const norm = (s?: string | null) => String(s || '').trim().toLowerCase();
const num = (n?: number | null) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/**
 * 是否同一个文件（命名沿用需求里的 IsDuplicateFile）。
 *
 * 注意「回落」的方向：原始值缺失时才用实际值兜底，反过来不成立 ——
 * 实际值是新内容的指纹，拿它冒充原始值会让「原文件重传」永远判不中。
 *
 * v1.2.2（需求）：**剪辑过的记录不参与组①**。
 *   一旦「保存并替换」把内容换成剪辑后的版本，这条记录的 originalSize / originalMd5
 *   指向的就是一个库里已经不存在的字节序列了 —— 拿它去认「重复文件」等于把两个
 *   不同内容判成同一个。所以有 editedAt 的记录只比对组②（实际大小 + 实际 md5）；
 *   从未剪辑过的记录才两组都试，任一组命中即重复。
 */
export function isDuplicateFile(probe: DedupProbe, rec: DedupCandidate): boolean {
  const md5 = norm(probe.md5);
  if (!md5 || !num(probe.size)) return false;

  const actualSize = num(rec.size);
  const actualMd5 = norm(rec.md5);
  const size = num(probe.size);
  const edited = !!rec.editedAt;

  // ① 原始文件：大小 + 最初的 md5 —— 剪辑过的记录跳过（见上）
  if (!edited) {
    const originSize = num(rec.originalSize) || actualSize;
    const originMd5 = norm(rec.originalMd5) || actualMd5;
    if (originMd5 && size === originSize && md5 === originMd5) return true;
  }
  // ② 库里当前实际内容：大小 + 当前实际 md5
  if (actualMd5 && size === actualSize && md5 === actualMd5) return true;
  return false;
}

/**
 * 生成候选集的查询条件（Prisma where 片段）。
 *
 * 只按 md5 圈定候选，大小交给 isDuplicateFile 精判 ——
 * 因为「原始大小 / 实际大小」是两套值，用 SQL 表达两组 OR 会又长又容易漏掉回落逻辑。
 * 候选记录一定至少有一个 md5 与待上传文件相同，量很小（同一份内容最多几个副本）。
 */
export function dedupCandidateWhere(md5: string): Record<string, unknown>[] {
  const v = String(md5 || '').trim();
  if (!v) return [];
  return [{ md5: v }, { originalMd5: v }];
}
