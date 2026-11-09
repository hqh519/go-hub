/**
 * 文件视图工具 —— 把 GoHub 的 FileRecord 序列化为前端（Sanyue-ImgHub）
 * 期望的 `{ name, metadata }` 结构。
 *
 * 说明：metadata 的字段名与原系统（CloudFlare-ImgBed）严格保持一致，
 * 前端管理页 / 上传页 / 批量操作均依赖这些字段名，改动会导致页面失效。
 */
import type { Channel, FileCopy, FileRecord } from '@prisma/client';

/*
 * v1.0.5：详情页「源」对本地文件要显示**物理地址**（磁盘绝对路径 + 落盘文件名），
 * 而不是本站签发的外链。这里复用 local.adapter 的根目录口径，避免两处算出不同的路径。
 * local.adapter 不反向依赖本文件，不存在循环引用。
 */
import { localAbsPathOf } from '../adapters/local.adapter';

export type FileTypeName = 'image' | 'video' | 'audio' | 'txt' | 'pdf' | 'other';

/**
 * 「上传渠道」—— 文件是从哪个入口传上来的（落库 FileRecord.uploadSource）。
 * 后台文件详情的「上传用户」后面会显示这个值。
 *   Default —— 历史数据（v2.8.6 之前的前端上传页，统一按此归类）
 *   Upload  —— 前端上传页「文件」模式（v2.8.6 起）
 *   Fetch   —— 前端上传页「链接」模式转存 / 链接暂存提交（v2.8.6 起）
 *   WebDAV  —— 对外 WebDAV
 *   API-Web —— API Token 的「Web 通用」通道
 *   API-S3  —— API Token 的「S3 协议」通道
 *   Record  —— 「登记文件」：文件本来就在别的渠道上，这里只补一条记录（v2.8.8）
 *   StoreIn —— v1.1.0：文件由「异地渠道 → 本地渠道」转存而来（详情页显示「异地存入」）
 *   StoreOut—— v1.1.0：文件由「本地渠道 → 异地渠道」转存而来（详情页显示「本地转出」）
 *
 * 说明：StoreIn / StoreOut 记录的是**最近一次成功的转存方向**，由 convertChannel 写入；
 * 一个文件被反复转存时以最后一次成功的转存为准（不会因为方向来回而回退成 Default）。
 */
export const UPLOAD_SOURCES = ['Default', 'Upload', 'Fetch', 'WebDAV', 'API-Web', 'API-S3', 'Record', 'StoreIn', 'StoreOut'] as const;

/** 前端上传页允许声明的来源（其它来源只能由服务端通道自己写死，不接受外部指定） */
export const CLIENT_UPLOAD_SOURCES = ['Upload', 'Fetch'] as const;

/**
 * 归一化上传渠道值：空值/未知值一律按 Default（历史数据的文件都是前端上传页传的）。
 * 注意：调用方若想把前端声明的来源透传进来，必须先确认它在白名单内（见 CLIENT_UPLOAD_SOURCES）。
 */
export function normalizeUploadSource(raw?: string | null): string {
  const v = String(raw || '').trim();
  return (UPLOAD_SOURCES as readonly string[]).includes(v) ? v : 'Default';
}

/** 前端上传页声明的来源是否合法（只认 Upload / Fetch，避免伪造 WebDAV / API-* 来源） */
export function isClientUploadSource(raw?: string | null): boolean {
  return (CLIENT_UPLOAD_SOURCES as readonly string[]).includes(String(raw || '').trim());
}

/**
 * 上传计时派生字段（文件详情 →「上传时长 / 上传速度」）：
 *   UploadStartedAt / UploadFinishedAt —— ISO 字符串（空串 = 无记录）
 *   UploadDurationMs                   —— 毫秒（0 = 无记录）
 *   UploadSpeedMBps                    —— MB/s，按「当前文件体积 ÷ 耗时」计算，保留两位小数
 * 1.9.1 之前的记录没有这两列，统一返回 0/''，前端显示「未知」。
 */
export function buildUploadTiming(rec: {
  uploadStartedAt?: Date | null;
  uploadFinishedAt?: Date | null;
  size?: number;
}): Record<string, unknown> {
  const start = rec.uploadStartedAt ? new Date(rec.uploadStartedAt).getTime() : 0;
  const end = rec.uploadFinishedAt ? new Date(rec.uploadFinishedAt).getTime() : 0;
  const dur = start && end && end >= start ? end - start : 0;
  const bytes = Number(rec.size) || 0;
  const speed = dur > 0 && bytes > 0 ? bytes / (dur / 1000) / 1024 / 1024 : 0;
  return {
    UploadStartedAt: start ? new Date(start).toISOString() : '',
    UploadFinishedAt: end ? new Date(end).toISOString() : '',
    UploadDurationMs: dur,
    UploadSpeedMBps: speed ? Number(speed.toFixed(2)) : 0,
  };
}

/** 渠道类型 → 前端展示名（metadata.Channel） */
export const CHANNEL_LABEL: Record<string, string> = {
  cos: 'Tencent',
  minio: 'MinIO',
  r2: 'R2',
  s3: 'S3',
  aliyun: 'Aliyun',
  easyimages: 'Easy',
  lsky: 'Lsky',
  webdav: 'WebDAV',
  immich: 'Immich',
  custom: 'External',
  local: 'Local',
  localfiles: 'File',
};

/**
 * 渠道类型 → 简称（全站唯一来源）。
 *   腾讯云 COS = COS ｜ 阿里云 OSS = OSS ｜ 简单图床 = EI ｜ 兰空图床 = LS
 *   Immich = IM ｜ MinIO = MI ｜ R2 = R2 ｜ S3 = S3 ｜ WebDAV = WD ｜ 自定义 Web = DIY
 *   本地存储 = LOCAL
 * 文件管理卡片左上角角标、上传后自动标签、元数据 ChannelShort 均调用 channelShort()，
 * 新增渠道类型只需在这里加一行。
 */
export const CHANNEL_SHORT: Record<string, string> = {
  easyimages: 'EI',
  lsky: 'LS',
  cos: 'COS',
  aliyun: 'OSS',
  immich: 'IM',
  minio: 'MI',
  r2: 'R2',
  s3: 'S3',
  webdav: 'WD',
  custom: 'DIY',
  local: 'LCL',
  localfiles: 'File',
};

/**
 * 取某个渠道类型的简称。入参可以是类型（cos）或展示名（Tencent），
 * 兼容历史数据里直接存展示名的情况；未知类型原样大写返回（最多 4 位）。
 */
export function channelShort(typeOrLabel?: string | null): string {
  const raw = String(typeOrLabel || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase();
  if (CHANNEL_SHORT[key]) return CHANNEL_SHORT[key];
  // 展示名反查：Tencent → COS、Easy → EI、External → DIY …
  const byLabel = Object.keys(CHANNEL_LABEL).find((t) => CHANNEL_LABEL[t].toLowerCase() === key);
  if (byLabel && CHANNEL_SHORT[byLabel]) return CHANNEL_SHORT[byLabel];
  return raw.slice(0, 4).toUpperCase();
}

/**
 * v3.0.0（R14）：从「图片/视频/音频/其他」四分类升级为六分类 ——
 * 新增 txt（text/plain，纯文本）与 pdf（application/pdf）；
 * 「其他」不再包含这两类（md/csv/html 等 text/* 仍归「其他」）。
 * 注意：autoTag 会用本函数的返回值打「文件类型」标签，txt/pdf 文件今后
 * 会打 txt / pdf 标签而不是 other（随本需求一并生效）。
 */
export function fileTypeOf(mime: string): FileTypeName {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (!m) return 'other';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  /*
   * v3.0.0（R15）：所有「能用文本方式打开」的类型统一归 txt ——
   * 之前只认 text/plain，导致 html / php / js / yaml / jsonl / 各类源码
   * 落到「其他」，既不能在 TXT 灯箱里看，也筛不出来。
   * 判定按 MIME 的通用族来（text/* + 常见脚本/配置类 application/*），
   * 不靠扩展名，避免各渠道上传时 MIME 缺失导致口径不一致。
   */
  if (
    m.startsWith('text/') ||
    /^application\/(json|ld\+json|ndjson|x-ndjson|json5|javascript|ecmascript|x-javascript|x-httpd-php|php|x-sh|x-csh|x-yaml|yaml|x-toml|toml|x-properties|sql|x-python|x-ruby|x-perl|x-lua|x-php|x-httpd-php-source|graphql|xml|xhtml\+xml|x-latex|rtf)$/.test(m)
  ) {
    return 'txt';
  }
  return 'other';
}

/**
 * 从原始文件名取扩展名（小写、不带点）。
 * 优先 originalName；它缺失时用 MIME 反查；再无则空串。
 * 用于「文件类型」列展示成 `image / jpeg`，以及外链末尾补扩展名。
 */
export function fileExtOf(originalName: string, mime?: string): string {
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(String(originalName || ''));
  if (m) return m[1].toLowerCase();
  const sub = String(mime || '').split('/')[1] || '';
  const cleaned = sub.split(';')[0].replace(/^x-/, '').trim().toLowerCase();
  if (!cleaned) return '';
  return cleaned === 'jpeg' ? 'jpg' : cleaned;
}

/** 标识末尾是否已带扩展名（如 abc.png、2026/10/ab.webp） */
export function hasFileExt(id: string): boolean {
  return /\.[A-Za-z0-9]{1,12}$/.test(String(id || ''));
}

/**
 * 生成对外链接末尾【应当追加】的扩展名后缀（含点；不需要追加时返回空串）。
 *
 * v1.0.6 起**恒返回空串** —— 所有签发外链默认不带扩展名。
 *
 * 为什么改：详情页支持把本地图片「转 WebP」，而转码后扩展名会从 .png 变成 .webp。
 * 只要外链还带着扩展名，同一个文件的链接就会因为一次转码而失效（用户收藏/引用过的
 * 地址全部 404）。扩展名在 `/file/<标识>` 里本来就只是装饰 ——
 * 服务端按下标剥掉最后一段扩展名查库，带与不带都能访问（见 files.controller.ts
 * 的 nameCandidates）。干脆默认不生成，链接从此与文件格式解耦，转多少次都不变。
 *
 * 保留函数与参数，是为了不改动所有调用点：调用处仍可写成
 * `${prefix}${encodePath(id)}${extSuffixFor(id, name)}`，只是拼出来是空串。
 */
export function extSuffixFor(id: string, originalName: string): string {
  void id;
  void originalName;
  return '';
}

export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${i === 0 ? n : n.toFixed(2)} ${units[i]}`;
}

/** 安全解析 JSON 字符串，失败返回 {} */
export function safeParse(raw?: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface DirectoryTreeNode {
  name: string;
  path: string;
  children: DirectoryTreeNode[];
}

/**
 * 扁平目录列表 → 嵌套树（对齐原系统 /api/directoryTree 的响应结构）。
 * 输入 ['photos/', 'photos/2024/'] →
 * { name:'/', path:'', children:[{ name:'photos', path:'photos/', children:[…] }] }
 */
export function buildDirectoryTree(directories: string[]): DirectoryTreeNode {
  const root: DirectoryTreeNode = { name: '/', path: '', children: [] };
  const nodeMap = new Map<string, DirectoryTreeNode>([['', root]]);
  for (const dirPath of [...directories].sort()) {
    if (!dirPath) continue;
    const normalized = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
    const parts = normalized.split('/').filter(Boolean);
    let currentPath = '';
    let parent = root;
    for (const part of parts) {
      currentPath += `${part}/`;
      const existing = nodeMap.get(currentPath);
      if (existing) {
        parent = existing;
        continue;
      }
      const node: DirectoryTreeNode = { name: part, path: currentPath, children: [] };
      parent.children.push(node);
      nodeMap.set(currentPath, node);
      parent = node;
    }
  }
  const sortChildren = (node: DirectoryTreeNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.children.forEach(sortChildren);
  };
  sortChildren(root);
  return root;
}

/**
 * v3.0.0（R6）：该记录是否为「登记文件」。
 *
 * 两类文件的 remoteKey 语义不同，取流 / 直链构造必须分开：
 *   · 普通上传：key 相对【存储桶根 / 渠道根】，例如 MinIO 的 `2026/10/x.png`
 *     → 直链 = 域名 + 桶名 + key（桶名由适配器拼接，绝不能把桶名烤进 key ——
 *       S3 的 PutObject 本身就要单独传 Bucket，key 再带一遍会存成 bucket/bucket/…）；
 *   · 登记文件：key 是【剔除渠道域名后剩下的完整路径】，MinIO 已含桶名，
 *     例如 `test/2026/10/x.png` → 直链 = 域名 + key（再补桶名会变成 bucket/bucket）。
 */
export function isRecordFile(
  rec?: { uploadSource?: string | null; metas?: unknown } | null,
): boolean {
  if (!rec) return false;
  if (String(rec.uploadSource || '') === 'Record') return true;
  const metas =
    typeof rec.metas === 'string'
      ? safeParse(rec.metas)
      : (rec.metas as Record<string, unknown> | undefined);
  return !!(metas && (metas as Record<string, unknown>).Registered === true);
}

export type CopyWithChannel = FileCopy & { channel?: Channel | null };

export interface SerializeOptions {
  tags?: string[];
  /**
   * 可选：为某个渠道副本解析「该渠道内的真实直链」（S3 对象地址 / WebDAV 地址 …）。
   * 由控制器注入（需要适配器），file-view 本身不依赖 adapters 以免循环依赖。
   * 返回 null/空串表示无法构造（前端会回退到本站代理地址）。
   */
  /**
   * v3.0.0（R6）：第二个参数传入所属文件记录 ——
   * 解析器需要区分「普通上传副本」（key 相对桶根，必须由适配器补 bucket）
   * 与「登记文件副本」（key 已含桶名/完整路径，只能拼域名）。
   */
  resolveDirectUrl?: (copy: CopyWithChannel, rec?: FileRecord) => string | null;
  /**
   * v3.0.0（R10）：文件「加载地址」解析器（详情页「源」用）。
   * 与 resolveDirectUrl 的区别：这里走「文件加载域名」—— 代理模式下优先内网通信域名，
   * 也就是服务端真正去取流的那条地址；resolveDirectUrl 给的是对外公开地址。
   */
  resolveLoadUrl?: (copy: CopyWithChannel, rec?: FileRecord) => string | null;
}

/**
 * 构造前端可展示的 metadata。
 * 关键：所有派生字段（渠道名、目录、标签、尺寸）都在序列化时从当前配置实时计算，
 * 不依赖落库的快照值 —— 这样改渠道配置 / 改文件名，列表刷新后立即反映。
 */
/**
 * v1.0.4：主副本的唯一判定口径。
 *
 * 历史包袱：本文件与 files.controller 里曾有 4 处分别用 `channel.isMain`（渠道级全局角色）
 * 或「数组第一条」来猜主副本。上传场景下两者恰好等价，但**转存会把 isPrimary 指向新渠道**，
 * 而 channel.isMain 仍停在原渠道 —— 于是数据库说「主在本地」，界面和取源却说「主在旧渠道」，
 * 表现为：转存后详情页渠道不变、新副本被算成「备份渠道」。
 *
 * 统一顺序（越靠前越可信）：
 *   1) isPrimary 且 active —— 数据层记录的主副本，转存后就是它；
 *   2) isPrimary（即使非 active）—— 主副本实体暂时不可用时也别乱换渠道；
 *   3) 渠道 isMain —— 兼容 v1.8.0 之前 isPrimary 全为 false 的历史数据；
 *   4) 第一条 —— 最后兜底。
 */
export function pickPrimaryCopy<
  T extends { isPrimary?: boolean; status?: string; channel?: { isMain?: boolean } | null },
>(copies: T[] | null | undefined): T | undefined {
  const list = Array.isArray(copies) ? copies.filter(Boolean) : [];
  if (!list.length) return undefined;
  return (
    list.find((c) => c.isPrimary === true && (!c.status || c.status === 'active')) ||
    list.find((c) => c.isPrimary === true) ||
    list.find((c) => c.channel?.isMain === true) ||
    list[0]
  );
}

export function buildMetadata(
  rec: FileRecord,
  copies: CopyWithChannel[],
  opts: SerializeOptions = {},
): Record<string, unknown> {
  const metas = safeParse(rec.metas);
  const primary = pickPrimaryCopy(copies);
  const channelLabel = primary?.channel ? CHANNEL_LABEL[primary.channel.type] || primary.channel.type : '';

  /*
   * 备份渠道列表（v1.0.4 收紧）：
   *   只列**渠道上真的打了 isBackup 标记**的 active 副本。
   *
   * 旧实现是「除主副本外的所有 active 副本」，于是转存一次就多一条，界面上会出现
   * 「2 个备份渠道」—— 其中并没有一个是真正的备份渠道。收紧后：
   *   · 上传时主备双写产生的备份副本 → 仍然显示；
   *   · 转存留下的其他副本 → 进 OtherCopies（可排查，不当作备份）；
   * 语义回到「1 主 + 1 备」，与后台的渠道角色设置一致。
   */
  const backupChannels = copies
    .filter((c) => c !== primary && c.status === 'active' && c.channel?.isBackup)
    .map((c) => ({
      id: c.channelId,
      code: c.channel!.code || '',
      type: c.channel!.type,
      label: CHANNEL_LABEL[c.channel!.type] || c.channel!.type,
      // 简称（DIY / EI / LS / COS / ALI / IM / MI / R2 / S3 / WD）—— 文件管理卡片角标用
      short: channelShort(c.channel!.type),
      name: c.channel!.name,
      // 该副本在备份渠道内的真实直链（如 WebDAV 上的真实地址）
      url: (opts.resolveDirectUrl ? opts.resolveDirectUrl(c, rec) : '') || '',
    }));

  /*
   * 其余 active 副本：既不是主副本、所在渠道也没打 isBackup 标记。
   * 来源通常是 v1.0.3 及更早的转存（保留源件时留下的旧副本）或历史换渠道数据。
   * 只供排查 / 未来的「副本管理」使用，不参与「备份渠道」展示，避免出现「2 个备份」的错觉。
   */
  const otherCopies = copies
    .filter((c) => c !== primary && c.status === 'active' && c.channel && !c.channel.isBackup)
    .map((c) => ({
      id: c.channelId,
      type: c.channel!.type,
      name: c.channel!.name,
      label: CHANNEL_LABEL[c.channel!.type] || c.channel!.type,
    }));

  // 主渠道（存储渠道）副本在渠道内的真实直链（对外公开地址：公开访问域名 + 固化地址）
  const storageUrl = (primary && opts.resolveDirectUrl ? opts.resolveDirectUrl(primary, rec) : '') || '';
  /*
   * v3.0.0（R10）：文件「源」地址 —— 用「文件加载域名」拼（代理模式=内网通信域名）。
   * 用途是排查/校验「服务端到底从哪取流」，因此允许是内网地址；对外分享仍用 StorageUrl。
   */
  const loadUrl =
    (primary && (opts.resolveLoadUrl || opts.resolveDirectUrl)
      ? (opts.resolveLoadUrl || opts.resolveDirectUrl)!(primary, rec)
      : '') || '';

  // 初始大小（压缩前）：未记录或与当前大小相同时，回退为当前大小
  const size = Number(rec.size) || 0;
  const rawOriginalSize = Number((rec as unknown as { originalSize?: number }).originalSize) || 0;
  const originalSize = rawOriginalSize > 0 ? rawOriginalSize : size;

  const meta: Record<string, unknown> = {
    FileName: rec.originalName,
    // 重命名历史（v2.3.0）：详情页重命名对话框用它们提供「恢复初始名 / 恢复上一次」
    FileFirstName: (rec as unknown as { firstName?: string }).firstName || rec.name,
    FilePrevName: (rec as unknown as { prevName?: string }).prevName || '',
    FileType: fileTypeOf(rec.mime),
    FileExt: fileExtOf(rec.originalName, rec.mime),
    FileSize: formatSize(size),
    FileSizeBytes: size,
    // 初始（压缩前）大小：与当前大小不同时前端展示成 `初始 / 当前`
    FileSizeOriginal: formatSize(originalSize),
    FileSizeOriginalBytes: originalSize,
    MD5: (rec as unknown as { md5?: string }).md5 || '',
    Views: (rec as unknown as { views?: number }).views || 0,
    UploadIP: rec.ip || '',
    UploadAddress: (metas.UploadAddress as string) || '',
    // 上传者账户（用户账户体系：文件详情「上传用户」/ 排序 / 归集）
    UploadUser: (rec as unknown as { uploader?: string }).uploader || '',
    // 上传渠道：Default / WebDAV / API-Web / API-S3（文件详情「上传用户」后面展示）
    UploadSource: normalizeUploadSource((rec as unknown as { uploadSource?: string }).uploadSource),
    // 上传计时：详情页「上传时长 / 上传速度」；历史数据没有这两列 → 0，前端显示「未知」
    ...buildUploadTiming(rec as unknown as { uploadStartedAt?: Date | null; uploadFinishedAt?: Date | null; size?: number }),    // 重定向地址（非空时 /file/:name 会 302 到该地址）
    RedirectUrl: (rec as unknown as { redirectUrl?: string }).redirectUrl || '',
    // 限时访问截止时间（毫秒时间戳；0 = 永久有效）
    LinkExpiresAt: (rec as unknown as { linkExpiresAt?: Date | null }).linkExpiresAt
      ? (rec as unknown as { linkExpiresAt: Date }).linkExpiresAt.getTime()
      : 0,
    ListType: (metas.ListType as string) || 'None',
    // 评分 / 等级（v3.0.0 R8）：详情页展示 + 编辑；独立列存库
    Rating: Number((rec as unknown as { rating?: number }).rating) || 0,
    Level: Number((rec as unknown as { level?: number }).level) || 0,
    TimeStamp: rec.createdAt.getTime(),
    Label: (metas.Label as string) || 'None',
    Directory: rec.folder ? `${rec.folder.replace(/\/+$/, '')}/` : '',
    Tags: opts.tags || (metas.Tags as string[]) || [],
    Channel: channelLabel,
    // 渠道类型简称（前端卡片角标 / 自动标签统一从这里取，前端不再各自维护映射）
    ChannelShort: primary?.channel ? channelShort(primary.channel.type) : '',
    // 主渠道类型（cos/minio/r2/s3/aliyun/easyimages/lsky/webdav/immich/custom/local）
    // 列表视图用它渲染「渠道简称图标」，前端不再按名称反查类型
    ChannelType: primary?.channel?.type || '',
    ChannelId: primary?.channelId || '',
    ChannelCode: primary?.channel?.code || '',
    ChannelName: primary?.channel?.name || '',
    // 该文件在「存储渠道」内的真实直链（S3 地址 / WebDAV 地址 …），无法构造时为空
    StorageUrl: storageUrl,
    // 「源」：加载域名 + 固化地址（代理模式优先内网通信域名）
    LoadUrl: loadUrl || storageUrl,
    /*
     * v1.0.5：主副本在「本地存储」渠道时，给出磁盘上的**物理地址**（含真实落盘文件名）。
     * 非本地渠道一律空串，前端据此决定「源」显示物理路径还是外链。
     * 这一项只在已登录的详情接口里下发，不参与任何对外链接。
     */
    LocalPath: primary ? localAbsPathOf(primary.channel, primary.remoteKey || '') : '',
    BackupChannels: backupChannels,
    // v1.0.4：非主、非备份的其他副本（仅排查用，前端暂不渲染）
    OtherCopies: otherCopies,
    FileHash: rec.hash || '',
  };

  if (metas.Width) meta.Width = metas.Width;
  if (metas.Height) meta.Height = metas.Height;
  if (metas.ExternalLink) meta.ExternalLink = metas.ExternalLink;

  // 其余自定义 metas 一并带出（不覆盖上述关键字段）
  for (const [k, v] of Object.entries(metas)) {
    if (!(k in meta)) meta[k] = v;
  }
  return meta;
}

export function serializeFile(
  rec: FileRecord,
  copies: CopyWithChannel[],
  opts: SerializeOptions = {},
): { name: string; metadata: Record<string, unknown> } {
  return { name: rec.name, metadata: buildMetadata(rec, copies, opts) };
}

/** 规范化目录参数：去前导斜杠、统一尾斜杠（与原系统行为一致） */
export function normalizeDir(dir?: string): string {
  let d = (dir || '').replace(/\.\./g, '_').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (d.startsWith('/')) d = d.substring(1);
  if (d && !d.endsWith('/')) d += '/';
  return d;
}
