import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream, promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// v1.0.9：转存的取源做成流式管道（大文件不整份进内存）
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { prisma } from '../common/prisma';
import { TAG_TYPE_FILE, findOrCreateTag } from '../common/tags';
import { CryptoService } from '../common/crypto.service';
import { SettingsService } from '../settings/settings.service';
import { SysConfigService } from '../settings/sysconfig.service';
import {
  DEFAULT_TAG_START as TAG_START_DEFAULT,
  DEFAULT_TAG_STOP as TAG_STOP_DEFAULT,
  DEFAULT_TAG_MAX_LEN as TAG_MAX_LEN_DEFAULT,
} from '../common/tag-defaults';
import { ChannelsService } from '../channels/channels.controller';
import { StorageChannelService, StorageChannelInfo } from '../storage/storage-channel.service';
import { createAdapter, toCopyInfo } from '../adapters/adapter.factory';
import { localFileAbsOf } from '../adapters/local.adapter';
import { AdapterError, ChannelInfo, StorageAdapter } from '../adapters/adapter.interface';
import { normalizeUploadSource, fileTypeOf, channelShort } from '../common/file-view';
import { appLog } from '../common/app-log';
import { joinObjectKey, LOCAL_DEFAULT_PREFIX, renderFileName, renderObjectPrefix, supportsPrefix } from '../common/path-template';
import { compressFile, compressMedia, readDimensions, readDimensionsFile } from '../common/compress';
import { postProcessMediaFile, enqueueMediaJob, mediaQueueStats, MEDIA_MAX_SECONDS } from './media-post';

/**
 * 压缩上限（字节）：超过就不压。
 * v2.8.3 起大文件压缩走磁盘路径（ffmpeg / sharp 直接读文件），不再整份读内存，
 * 所以上限从 512MB 提高到默认 4GB（可用 COMPRESS_MAX_MB 调整）。
 */
const COMPRESS_MAX_BYTES = Math.max(512, Number(process.env.COMPRESS_MAX_MB || 4096)) * 1024 * 1024;

/**
 * 没有「流式写入」能力的渠道（http-post / immich / aliyun 等）超过该阈值直接报错，
 * 而不是把 500MB 读进内存把进程拖垮。S3 / 本地 / WebDAV 走 uploadFile，不受此限。
 */
const STREAM_REQUIRED_BYTES = 256 * 1024 * 1024;

interface UploadOptions {
  /** 渠道类型过滤（cos/minio/r2…）：仅用于「按类型挑一条可用渠道」 */
  uploadChannel?: string;
  /**
   * 指定具体渠道 —— **只接受渠道 ID**（6 位 code，或数据库主键 id）。
   * 渠道名（name）仅作展示标识，不参与任何查找匹配。
   */
  channelId?: string;
  uploadNameType?: string; // default | index | original
  serverCompress?: boolean;
  /**
   * v2.8.8：本次上传是否执行「视频兼容转码」。
   * 仅在账户策略为「用户决定（user）」时生效；其它策略以账户/全局设置为准。
   */
  videoTranscode?: boolean;
  /** 压缩期望：压缩后体积占原文件的百分比（10-100）；0/缺省时读后台「网页设置 → 默认压缩期望」 */
  compressPercent?: number;
  uploadFolder?: string;
  uploader?: string;
  /** 上传者 IP（用于归属地查询、黑白名单统计） */
  ip?: string;
  /** 初始（压缩前）字节数 —— 前端本地压缩后仍会带上原始大小，缺省时用 buffer 长度 */
  originalSize?: number;
  /** 是否对本次上传执行备份（前端「上传设置 → 是否备份」开关；缺省 true） */
  backup?: boolean;
  /**
   * v3.0.0（R14）：调用方追加的自动标签（与 autoTag 的系统标签合并去重）。
   * 本地文件管理页传 ['本地上传']；视频抓拍前端传 ['视频抓拍']；Web/API 通道可经
   * query `extraTags` 传入（逗号分隔，后端会做长度/数量截断）。
   */
  extraTags?: string[];
  /**
   * 指定备份渠道（**只接受渠道 ID**：6 位 code 或主键 id）。
   * 用于 API Token 的 `backup` 参数 —— 不指定时由 getStorageChannel 依次退回
   * 「Token 级 → 账户级 → 全局备份渠道」。
   */
  backupChannelId?: string;
  /** 指定上传文件的归属账户（API Token 上传统一归属管理员账户） */
  owner?: string;
  /**
   * 上传渠道（上传来源入口），落库到 FileRecord.uploadSource，用于后台文件详情展示：
   *   Default（默认）—— GoHub 前端上传页
   *   WebDAV          —— 对外 WebDAV
   *   API-Web         —— API Token 的「Web 通用」通道
   *   API-S3          —— API Token 的「S3 协议」通道
   * 未传时按 Default 处理。
   */
  uploadSource?: string;
  /**
   * 上传开始时间（请求到达服务端的时刻）—— 用于详情页「上传时长 / 上传速度」。
   * 分块上传传第一片的 init 时刻；缺省时用 upload() 内部计时起点。
   */
  uploadStartedAt?: Date;
  /**
   * 本次上传的「允许的上传格式 / 单文件大小上限」覆盖值。
   * 前端上传页右下角设置里填了就用它，否则退回后台「上传相关配置」的全局值。
   */
  limitsOverride?: { exts?: string[]; maxMB?: number };
  /**
   * API Token 主键 id —— 交给 StorageChannelService 读取该 Token 上配置的
   * 默认主/备渠道（优先级高于账户级与全局设置）。
   */
  tokenId?: string;
  /**
   * 渠道解析时跳过「uploader 账户在用户管理里绑定的渠道」。
   * 「Web 通用」Token 未传 username 时使用：规则要求渠道优先级严格为
   * 「Token 上配置的渠道 → 全局默认」，不允许 owner 账户的绑定渠道插队。
   */
  ignoreUploaderChannel?: boolean;
  /**
   * 指定对外文件标识（fileRecord.name）。
   * S3 协议场景传入客户端上传时的 Object Key，使得客户端用「自定义域名 + key」
   * 自行拼出的地址恰好命中本站签发链接（否则客户端只能拼出一个不存在的地址）。
   */
  presetFileId?: string;
  /**
   * 跳过「文件类型白名单 + 大小上限」校验（默认 false）。
   *
   * 专供对外 WebDAV 通道：WebDAV 的定位是「同步 / 备份型传输通道」
   * （笔记平台、阅读平台、网盘客户端等），上传的可能是任意类型的文件，
   * 体积也常常远超网页上传的限制，因此不受这两项限制。
   * 注意：仅为「跳过类型与大小」，魔数比对、MIME 归一化等仍照常执行。
   */
  skipFileLimits?: boolean;
  /** 主渠道失败时按渠道 ID 顺序自动切换下一个渠道 */
  /** 是否允许「失败后换下一个渠道」；缺省 = 读后台「自动切换」配置（v2.8.9） */
  autoRetry?: boolean;
  /** 前端累计的重试轮次（写进文件处理事件，v2.8.9） */
  retryRound?: number;
  /** 上一次失败原因（写进文件处理事件，v2.8.9） */
  failReason?: string;
  /** WebP 未转换原因（前端本地转换，v2.8.9） */
  webpSkip?: string;
  /**
   * v3.0.0：文件归属实例 ID（空串 = 默认实例）。
   * 非空时校验 uploader 必须是该实例的创建者或成员，否则回退空串（默认实例）并记 warn。
   */
  instanceId?: string;
  /**
   * v3.0.0：前端 WebP 转换模式（lossless / lossy）。
   * 前端转换成功时文件已是 webp，后端只把 mode 记进处理事件；
   * 转换失败 / 放弃时带 webpSkip 原因，mode 一并写入。
   */
  webpMode?: string;
}

interface UploadInput {
  buffer: Buffer;
  mime: string;
  originalName: string;
  /**
   * v2.8.3：大文件以「磁盘路径」形式传入（分片合并结果 / 链接暂存），
   * 避免把 500MB 读进内存。有 path 时 buffer 允许为空。
   */
  path?: string;
  /** 文件字节数（有 path 时用于限额/校验/落库，避免反复 stat） */
  size?: number;
}

/**
 * 后置处理任务（v2.8.8）：文件已上传成功之后，再由全局单通道队列执行
 * 「先压缩、后转码」。任务只带最小必要信息，执行时重新读库确认文件仍有效。
 */
interface MediaPostJob {
  /** files 表主键 */
  recordId: string;
  /** 对外文件标识（日志用） */
  fileId: string;
  /** 目标渠道（原主渠道） */
  channelId: string;
  /** 本地源文件；为空时由 buffer 落一个临时文件 */
  srcPath: string;
  buffer: Buffer;
  mime: string;
  /** 原始扩展名（不含点） */
  ext: string;
  originalName: string;
  /** 命名策略（与新 key 保持同一套规则） */
  nameType?: string;
  compress: boolean;
  percent: number;
  transcode: boolean;
  uploader: string;
  ip: string;
  /** 临时文件由队列自己清理（buffer 落盘时） */
  tempOwned?: boolean;
}

@Injectable()
export class UploadService {
  /** 上传选项：IP 用于归属地查询与限制策略 */
  private static readonly DEFAULT_EXT = [
    'jpg', 'png', 'gif', 'jpeg', 'webp', 'bmp',
    'mp4', 'webm', 'mov', 'm4v',
    'mp3', 'm4a', 'aac', 'ogg',
  ];

  constructor(
    private settings: SettingsService,
    private channels: ChannelsService,
    private sysConfig: SysConfigService,
    private storageChannel: StorageChannelService,
  ) {}

  /**
   * 正在进行的「主渠道上传」数量（覆盖校验 → 压缩 → 写主渠道 → 落库全过程）。
   * 备份（低优先级）任务据此让路：主渠道上传期间备份不抢带宽，保证上传速度优先。
   */
  private activeUploads = 0;

  /**
   * 备用库轮转游标（v202610221824）。
   * 每次主渠道失败需要切换时取模决定从备用库池的哪一条开始，
   * 让多次上传均摊到各备用库，而不是永远先试同一条。
   */
  private poolCursor = 0;

  /**
   * 低优先级（备份）任务串行链。
   * 作用有两个：
   *   1) 串行化 —— 同一时刻最多只有一个备份上传在跑，不与主渠道争抢带宽；
   *   2) 让路 —— 每个任务真正开始前等待主渠道上传全部结束（见 waitForUploadIdle）。
   */
  private lowPriorityChain: Promise<unknown> = Promise.resolve();

  /** 低优先级任务：等主渠道空闲后串行执行；返回任务自身的返回值（异常会抛给调用方） */
  private enqueueLowPriority<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lowPriorityChain.then(async () => {
      await this.waitForUploadIdle();
      return task();
    });
    // 让链本身不因单个任务失败而中断，同时把异常照常抛给 await 的调用方
    this.lowPriorityChain = run.catch((err) => {
      console.error('[backup] 低优先级任务异常:', (err as Error)?.message || err);
      return undefined;
    });
    return run;
  }

  /**
   * 后台任务队列（不等待主渠道空闲）：用于「打标签 / IP 归属地补写 / IP 计数」这类
   * 毫秒级、不占带宽的收尾工作 —— 上传响应不必等它们，也不该被备份任务挡住。
   */
  private backgroundChain: Promise<unknown> = Promise.resolve();
  private enqueueBackground<T>(task: () => Promise<T>): Promise<T> {
    /*
     * v1.0.5：先让出一个事件循环再跑。
     * 上传响应是在本方法返回之后才写出去的，直接用 `backgroundChain.then(task)` 有可能
     * 在同一个 tick 里就把任务跑起来，与响应序列化抢同一个 tick —— 大文件上传时体感明显。
     * setImmediate 保证「响应先出去，收尾工作随后」。
     */
    const run = this.backgroundChain.then(() => new Promise<void>((r) => setImmediate(r))).then(task);
    this.backgroundChain = run.catch((err) => {
      console.warn('[bg] 后台任务异常:', (err as Error)?.message || err);
      return undefined;
    });
    return run;
  }

  /**
   * 自动打标签专用队列（v1.0.5）。
   *
   * 以前打标签和「IP 归属地补写」共用 backgroundChain —— 而归属地那条要**请求外部 API**
   * （冷启动 / 超时能挂好几秒）。标签任务排在它后面，就得等它跑完才轮到，
   * 表现为「上传完过一会儿标签才出现」，批量上传时更明显。
   *
   * 现在标签走自己的串行链：既不拖上传响应，也不会被网络请求饿住。
   * 仍然保持串行（不并发），避免同一批文件争抢 DB 连接、也不让标签创建互相打架。
   */
  private tagChain: Promise<unknown> = Promise.resolve();
  private enqueueTagTask<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tagChain.then(() => new Promise<void>((r) => setImmediate(r))).then(task);
    this.tagChain = run.catch((err) => {
      console.warn('[tag] 自动标签任务异常:', (err as Error)?.message || err);
      return undefined;
    });
    return run;
  }

  /**
   * 等待主渠道上传空闲。
   * 超时后仍继续执行 —— 否则主渠道持续繁忙时备份会被永久饿死（备份必须最终完成）。
   */
  private async waitForUploadIdle(maxWaitMs = 20000): Promise<void> {
    const started = Date.now();
    while (this.activeUploads > 0 && Date.now() - started < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  /**
   * 账户级「类型和大小限制」开关（后台「用户管理 → 编辑」里的同名开关）。
   *
   *   true  —— 受「允许上传格式 + 单文件大小上限」两项约束（默认）
   *   false —— 跳过这两项限制，可直接上传任意格式 / 任意体积
   *
   * 账户不存在时按 true 处理（初始管理员不在 users 表中，仍受限制；
   * 未登录的匿名上传同样受限），避免"查不到就放行"的安全缺口。
   */
  async userEnforceLimits(username: string): Promise<boolean> {
    const name = String(username || '').trim();
    if (!name) return true;
    try {
      const row = await prisma.user.findUnique({
        where: { username: name },
        select: { enforceLimits: true },
      });
      if (row) return row.enforceLimits !== false;
      /*
       * 内建管理员不在 users 表中：改读「用户管理 → 编辑管理员」保存的同名开关
       * （adminProfile）。读不到时仍按 true（受限），保持原有的保守默认。
       */
      const security: any = await this.sysConfig.get('security');
      const adminName =
        String(security?.auth?.admin?.adminUsername || '').trim() ||
        (process.env.ADMIN_USER || '').trim() ||
        'admin';
      if (name === adminName) {
        const prof: any = await this.sysConfig.get('adminProfile');
        return prof?.enforceLimits !== false;
      }
      return true;
    } catch {
      return true;
    }
  }

  /** 读取上传限制（来自「系统设置 → 页面设置」，缺失时用兜底值） */
  private async limits(): Promise<{ exts: string[]; maxMB: number }> {    try {
      const page: any = await this.sysConfig.get('page');
      const get = (id: string) => (page?.config || []).find((x: any) => x.id === id)?.value;
      const raw = get('allowedExtensions');
      const exts = String(raw || UploadService.DEFAULT_EXT.join(','))
        .split(',')
        .map((s: string) => s.trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean);
      const maxMB = Number(get('maxUploadSizeMB')) || 1024;
      return { exts: exts.length ? exts : UploadService.DEFAULT_EXT, maxMB };
    } catch {
      return { exts: UploadService.DEFAULT_EXT, maxMB: 1024 };
    }
  }

  /** 文件签名（magic bytes）比对：true 匹配 / false 不匹配 / null 无法判定（放行） */
  private signatureOk(buf: Buffer, ext: string): boolean | null {
    if (buf.length < 4) return null;
    const hex = buf.subarray(0, 16).toString('hex');
    const a4 = buf.subarray(0, 4).toString('latin1');
    const b4 = buf.subarray(4, 8).toString('latin1');
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return hex.startsWith('ffd8ff');
      case 'png':
        return hex.startsWith('89504e47');
      case 'gif':
        return a4 === 'GIF8';
      case 'webp':
        return a4 === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
      case 'bmp':
        return hex.startsWith('424d');
      case 'webm':
        return hex.startsWith('1a45dfa3');
      case 'ogg':
        return a4 === 'OggS';
      case 'mp4':
      case 'm4v':
      case 'm4a':
        return b4 === 'ftyp';
      case 'mov':
        return b4 === 'ftyp' || ['moov', 'mdat', 'free', 'wide'].includes(b4);
      case 'aac':
        return /^fff[019]/.test(hex);
      case 'mp3':
        return hex.startsWith('494433') || /^ff[ef][0-9a-f]/.test(hex);
      default:
        return null;
    }
  }

  /** 图片类扩展名集合（v2.8.2 图片互串宽容判定用） */
  private static readonly IMG_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);

  /** 按魔数识别真实图片格式；非已知图片签名返回 null（v2.8.2） */
  private static detectImageExt(buf: Buffer): string | null {
    if (buf.length < 12) return null;
    const hex = buf.subarray(0, 16).toString('hex');
    const a4 = buf.subarray(0, 4).toString('latin1');
    if (hex.startsWith('ffd8ff')) return 'jpg';
    if (hex.startsWith('89504e47')) return 'png';
    if (a4 === 'GIF8') return 'gif';
    if (a4 === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
    if (hex.startsWith('424d')) return 'bmp';
    return null;
  }

  /** 扩展名 → 权威 MIME 映射（与上传白名单一一对应） */
  private static readonly EXT_MIME: Record<string, string> = {    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
  };

  /**
   * MIME 归一化：以扩展名为准给出权威 MIME。
   *
   * 为什么必须做：curl、部分浏览器、以及各类脚本客户端对 mp4 / mp3 / m4a 等
   * 会统一发送 `application/octet-stream`。若原样落库，会导致：
   *   - 「视频按 MIME 分流」失效（视频被当成未知二进制）
   *   - 随机图 API 的 ?category=video|audio 筛选永远查不到
   *   - 后台列表的类型图标、前端预览方式判错
   * 因此落库前一律按扩展名归一化；白名单外的扩展名（用户自定义时）才回退客户端值。
   */
  private normalizeMime(originalName: string, clientMime: string): string {
    const ext = (originalName.split('.').pop() || '').toLowerCase();
    const mapped = UploadService.EXT_MIME[ext];
    if (mapped) return mapped;
    const cm = (clientMime || '').split(';')[0].trim().toLowerCase();
    if (cm && cm !== 'application/octet-stream') return cm;
    return 'application/octet-stream';
  }

  /**
   * 扩展名白名单 + 魔数 + 大小：三重服务端校验（客户端校验可被绕过）。
   *
   * v2.8.8：大小上限新增「账户级」一层 —— 用户管理里给某个账户设了
   * 「单文件大小限制」就用它封顶，留空才回落到后台全局的「单文件大小上限」。
   */
  private async validate(
    input: UploadInput,
    override?: { exts?: string[]; maxMB?: number },
    uploader?: string,
  ): Promise<string | null> {
    const base = await this.limits();
    const exts = override?.exts && override.exts.length ? override.exts : base.exts;
    const userMaxMB = await this.userMaxFileSizeMB(uploader);
    const maxMB =
      override?.maxMB && override.maxMB > 0
        ? override.maxMB
        : userMaxMB > 0
          ? userMaxMB
          : base.maxMB;
    const ext = (input.originalName.split('.').pop() || '').toLowerCase();
    if (!ext || ext === input.originalName.toLowerCase()) {
      return '无法识别文件类型（缺少扩展名）';
    }
    if (!exts.includes(ext)) {
      return `不支持的格式 .${ext}，允许：${exts.join('/')}`;
    }
    const size = Number(input.size || 0) || (input.path ? (await fsp.stat(input.path)).size : input.buffer.length);
    if (size > maxMB * 1024 * 1024) {
      const scope = userMaxMB > 0 && !(override?.maxMB && override.maxMB > 0)
        ? `该账户的单文件大小限制为 ${maxMB}MB`
        : `单文件大小上限 ${maxMB}MB（可在「其他设置 → 上传相关配置」调整）`;
      return `文件超过${scope}（当前 ${(size / 1024 / 1024).toFixed(1)}MB）`;
    }
    // 魔数只看文件头 64 字节：大文件不读整份，避免校验本身把内存吃掉
    const head = input.buffer.length ? input.buffer.subarray(0, 64) : await this.readHead(input.path || '', 64);
    if (this.signatureOk(head, ext) === false) {
      /*
       * v3.0.0：魔数校验降级为「仅记录，不再拒绝」——
       * 只校验扩展名 + 大小。背景：部分 MP3 以 0xFFFB 帧同步开头（无 ID3 头）、
       * 一些录制/转封装的文件头部不规范，魔数误判导致「文件名与扩展名不符，拒绝上传」；
       * 声明扩展名与真实内容同为图片格式时原本就放行，跨大类（如 exe 改名 .jpg）
       * 现在也不再拦截，但会记系统日志（upload 域，关键字「魔数不符放行」）便于事后排查。
       */
      const realExt = UploadService.detectImageExt(head);
      appLog.warn(
        'upload',
        `魔数不符放行（v3.0.0 起只验扩展名）：声明 .${ext}${realExt ? `，实际内容疑似 .${realExt}` : ''}`,
        input.originalName,
      );
      return null;
    }
    return null;
  }

  /** 读取文件头（最多 n 字节），用于大文件魔数校验 */
  private async readHead(path: string, n: number): Promise<Buffer> {
    if (!path) return Buffer.alloc(0);
    const fh = await fsp.open(path, 'r');
    try {
      const buf = Buffer.alloc(n);
      const { bytesRead } = await fh.read(buf, 0, n, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close().catch(() => undefined);
    }
  }

  /**
   * 图像审查 —— 按「系统设置 → 安全设置 → 上传审查」的配置调用第三方接口。
   * 返回非空字符串表示被拒绝（含原因）。审查接口异常时放行，避免第三方故障阻断上传。
   */
  private async moderate(buffer: Buffer, mime: string): Promise<string | null> {
    if (!mime.startsWith('image/')) return null;
    let cfg: any;
    try {
      const security: any = await this.sysConfig.get('security');
      cfg = security?.upload?.moderate;
    } catch {
      return null;
    }
    if (!cfg?.enabled) return null;

    const timeout = AbortSignal.timeout(8000);
    try {
      if (cfg.channel === 'moderatecontent.com') {
        if (!cfg.moderateContentApiKey) return null;
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), 'image');
        const resp = await fetch(
          `https://api.moderatecontent.com/moderate/?key=${encodeURIComponent(cfg.moderateContentApiKey)}`,
          { method: 'POST', body: form, signal: timeout },
        );
        const json: any = await resp.json();
        // rating_index: 1..5（1 最安全）；3 及以上视为不宜内容
        const idx = Number(json?.rating_index);
        if (Number.isFinite(idx) && idx >= 3) {
          return `图片未通过内容审查（评级 ${json?.rating_letter || idx}）`;
        }
      } else if (cfg.channel === 'nsfwjs') {
        if (!cfg.nsfwApiPath) return null;
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), 'image');
        const resp = await fetch(cfg.nsfwApiPath, { method: 'POST', body: form, signal: timeout });
        const json: any = await resp.json();
        let porn = 0;
        if (typeof json?.porn === 'number') {
          porn = json.porn;
        } else if (Array.isArray(json?.predictions)) {
          porn = Math.max(
            0,
            ...json.predictions
              .filter((p: any) => ['Porn', 'Hentai', 'Sexy'].includes(p?.className))
              .map((p: any) => Number(p?.probability) || 0),
          );
        }
        if (porn >= 0.6) {
          return `图片未通过内容审查（敏感度 ${porn.toFixed(2)}）`;
        }
      }
    } catch (err) {
      console.warn('[moderate] 审查接口异常，放行:', (err as Error).message);
    }
    return null;
  }

  /**
   * 只读缓存里的归属地（1 次 SQLite 查询，约 1ms）。
   * 上传主链路用它 —— 未命中时不再同步请求外部 API（最多会拖 6 秒），
   * 落库后由后台任务补写，上传速度不受归属地查询影响。
   */
  private async cachedAddress(ip: string): Promise<string> {
    if (!ip) return '';
    try {
      const cached = await prisma.ipRecord.findUnique({ where: { ip } });
      if (cached && (cached.country || cached.region || cached.city)) {
        return [cached.country, cached.region, cached.city].filter(Boolean).join(' ');
      }
    } catch {
      /* 忽略缓存查询失败 */
    }
    return '';
  }

  /**
   * IP 归属地查询 —— 结果写入 ip_records 表并缓存，重复 IP 不再请求。
   * 支持「自定义 API」（参数/响应字段可配）与默认 ip-api.com。
   */
  private async resolveAddress(ip: string): Promise<string> {
    if (!ip) return '';
    try {
      const cached = await prisma.ipRecord.findUnique({ where: { ip } });
      if (cached && (cached.country || cached.region || cached.city)) {
        return [cached.country, cached.region, cached.city].filter(Boolean).join(' ');
      }
    } catch {
      /* 忽略缓存查询失败 */
    }

    let cfg: any;
    try {
      const security: any = await this.sysConfig.get('security');
      cfg = security?.upload?.ipQuery;
    } catch {
      return '';
    }
    if (!cfg?.enabled) return '';

    const timeout = AbortSignal.timeout(6000);
    try {
      let country = '';
      let region = '';
      let city = '';
      if (cfg.channel === 'customApi' && cfg.customApi?.url) {
        let url = String(cfg.customApi.url);
        for (const p of cfg.customApi.params || []) {
          if (!p?.key) continue;
          url = url.replace(new RegExp(`\\{${p.key}\\}`, 'g'), encodeURIComponent(p.value === '{ip}' ? ip : p.value));
        }
        const resp = await fetch(url, { signal: timeout });
        const json: any = await resp.json();
        const pick = (path: string) =>
          String(path)
            .split('.')
            .reduce((o: any, k: string) => (o == null ? '' : o[k]), json) || '';
        const fields: string[] = cfg.customApi.responseFields || [];
        const parts = fields.map(pick).filter(Boolean);
        const address = parts.join(' ');
        if (address) await this.cacheAddress(ip, '', '', address);
        return address;
      }
      // 默认：ip-api.com（免费、无需 key）
      const resp = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN`, {
        signal: timeout,
      });
      const json: any = await resp.json();
      country = json?.country || '';
      region = json?.regionName || '';
      city = json?.city || '';
      const address = [country, region, city].filter(Boolean).join(' ');
      if (address) await this.cacheAddress(ip, country, region, [city].filter(Boolean).join(' '));
      return address;
    } catch (err) {
      console.warn('[ipQuery] 归属地查询失败:', (err as Error).message);
      return '';
    }
  }

  /** 归属地写库（缓存 + 上传计数） */
  private async cacheAddress(ip: string, country: string, region: string, city: string) {
    await prisma.ipRecord.upsert({
      where: { ip },
      update: { country, region, city },
      create: { ip, country, region, city },
    });
  }

  /** 上传计数与最近活跃时间（用于「用户管理」按 IP 汇总） */
  private async touchIp(ip: string, address: string) {
    if (!ip) return;
    try {
      const parts = (address || '').split(' ');
      await prisma.ipRecord.upsert({
        where: { ip },
        update: { uploadCount: { increment: 1 } },
        create: {
          ip,
          country: parts[0] || '',
          region: parts[1] || '',
          city: parts.slice(2).join(' '),
          uploadCount: 1,
        },
      });
    } catch (err) {
      console.warn('[ipRecord] 计数失败:', (err as Error).message);
    }
  }

  /**
   * 上传成功后异步打标签（不阻塞上传响应）：
   *   文件类型（image / video / audio / other）
   *   扩展名（不含点，如 png）
   *   存储渠道类型简称（COS / ALI / EI / LS / IM / MI / R2 / S3 / WD / DIY）
   *   上传渠道（Default / WebDAV / API-Web / API-S3）
   *   当前年份（如 2026）
   *   （v3.0.0 移除：文件宽度 / 文件高度不再各算标签）
   * v3.0.0：标签按实例隔离 —— upsert 用 [name, instanceId] 联合唯一键，instanceId 空 = 默认实例。
   * 开关：settings.autoTagEnabled（缺省开启，设成 false 可关闭）。
   * 全程 try/catch —— 打标签失败绝不能影响已经成功的上传。
   */
  private async autoTag(
    fileId: string,
    info: {
      originalName: string;
      mime: string;
      channelType: string;
      uploadSource?: string;
      /** v3.0.0：文件归属实例 ID（空串 = 默认实例，与文件记录一致） */
      instanceId?: string;
      /**
       * v1.0.0：标签归属用户名 —— 标签改为「按用户 + 实例」双重隔离，
       * 自动标签归属到上传者名下，其他人（含同实例的其他账户）不可见。
       */
      owner?: string;
      /** v3.0.0（R14）：调用方追加的标签（本地上传 / 视频抓拍 等），与自动标签合并去重 */
      extraTags?: string[];
      /** v1.0.1：图片 / 视频宽高（供 {width} / {height} 占位符使用，拿不到就跳过该标签） */
      width?: number;
      height?: number;
    },
  ): Promise<void> {
    try {
      const legacyOn = (await this.settings.get('autoTagEnabled', 'true')) !== 'false';
      const instanceId = String(info.instanceId || '').trim();
      // v1.0.0：标签归属者（未传则落到默认实例的公共标签 owner=''，与历史数据口径一致）
      const owner = String(info.owner || '').trim();
      /*
       * v1.0.1：自动标签规则改为后台可配置（系统管理 → 其他设置 → 文件标签添加设置）。
       * 原来写死的「文件类型 / 扩展名 / 渠道简称 / 上传方式 / 年份」已移除，
       * 统一由 autoTag.placeholders / extract / regex 三项决定。
       */
      let rules: { enabled: boolean; placeholders: string; extract: string; markerEnabled: boolean; startChars: string; stopChars: string; maxLen: number } = {
        enabled: true,
        placeholders: UploadService.DEFAULT_TAG_PLACEHOLDERS,
        extract: '',
        markerEnabled: true,
        startChars: UploadService.DEFAULT_TAG_START,
        stopChars: UploadService.DEFAULT_TAG_STOP,
        maxLen: UploadService.DEFAULT_TAG_MAX_LEN,
      };
      try {
        const cfg = await this.sysConfig.get('others');
        const at = (cfg && cfg.autoTag) || {};
        rules = {
          enabled: at.enabled === undefined ? true : !(at.enabled === false || String(at.enabled) === 'false'),
          placeholders:
            at.placeholders === undefined ? UploadService.DEFAULT_TAG_PLACEHOLDERS : String(at.placeholders ?? ''),
          extract: at.extract === undefined ? '' : String(at.extract ?? ''),
          // v1.0.5：这条规则可以单独关掉（界面上的「启用功能」勾选框），不影响上面两条
          markerEnabled:
            at.markerEnabled === undefined ? true : !(at.markerEnabled === false || String(at.markerEnabled) === 'false'),
          // v1.0.6：留空即视为「用默认值」，避免清空输入框后规则静默失效
          startChars:
            String(at.startChars ?? '').trim() || UploadService.DEFAULT_TAG_START,
          stopChars: String(at.stopChars ?? '').trim() || UploadService.DEFAULT_TAG_STOP,
          maxLen: at.maxLen === undefined ? UploadService.DEFAULT_TAG_MAX_LEN : Math.max(0, Number(at.maxLen) || 0),
        };
      } catch (err) {
        appLog.warn('upload', `读取自动标签规则失败，使用默认规则`, (err as Error)?.message || String(err));
      }
      const extraTags = (info.extraTags || [])
        .map((t) => String(t || '').trim().slice(0, 20))
        .filter(Boolean)
        .slice(0, 10);
      // 系统规则全部关闭且调用方也没给标签 → 什么都不做
      if (!(legacyOn && rules.enabled) && !extraTags.length) return;

      const autoNames: string[] = [];
      if (legacyOn && rules.enabled) {
        const now = new Date();
        const ext = info.originalName.includes('.')
          ? String(info.originalName.split('.').pop() || '').toLowerCase().replace(/^\./, '')
          : '';
        const vars: Record<string, string> = {
          mime: fileTypeOf(info.mime),
          ext,
          channelName: channelShort(info.channelType),
          uploadSource: normalizeUploadSource(info.uploadSource),
          y: String(now.getFullYear()),
          m: String(now.getMonth() + 1).padStart(2, '0'),
          d: String(now.getDate()).padStart(2, '0'),
          width: info.width ? String(info.width) : '',
          height: info.height ? String(info.height) : '',
        };
        // ① 占位符：逗号 / 顿号 / 换行分隔，每段渲染成一个标签（可混写固定文字）
        for (const piece of String(rules.placeholders || '').split(/[,，\n]/)) {
          const raw = piece.trim();
          if (!raw) continue;
          let resolved = false;
          const rendered = raw.replace(/\{(mime|ext|channelName|uploadSource|y|m|d|width|height)\}/g, (_m, k: string) => {
            const v = vars[k] || '';
            if (v) resolved = true;
            return v;
          });
          // 整段只有占位符且取值失败（如没有宽高）→ 不生成空标签 / 半截标签
          if (raw.includes('{') && !resolved) continue;
          const name = rendered.trim();
          if (name) autoNames.push(name);
        }
        // ② 提取指定内容：文件名包含指定内容 → 打上对应标签
        for (const rule of UploadService.parseTagExtractRules(rules.extract)) {
          if (String(info.originalName || '').includes(rule.find)) autoNames.push(rule.tag);
        }
        // ③ 从文件名提取（v1.0.5）：起始符集合 + 截断符集合 + 最大长度，可单独开关
        if (rules.markerEnabled) {
          for (const hit of UploadService.extractByMarkers(
            String(info.originalName || ''),
            rules.startChars,
            rules.stopChars,
            rules.maxLen,
          )) {
            autoNames.push(hit);
          }
        }
      }
      const names = Array.from(
        new Set(
          [...autoNames, ...extraTags]
            .map((v) => String(v || '').trim().slice(0, 20))
            .filter(Boolean),
        ),
      ).slice(0, 30);
      for (const name of names) {
        // v1.0.2：按「实例 + 类型 + 名称」找/建标签，owner 只记创建人（上传者）
        const tag = await findOrCreateTag(name, instanceId, owner, TAG_TYPE_FILE);
        const exists = await prisma.fileTag.findFirst({
          where: { fileId, tagId: tag.id },
          select: { id: true },
        });
        if (!exists) await prisma.fileTag.create({ data: { fileId, tagId: tag.id } });
      }
    } catch (err) {
      appLog.warn('upload', `自动打标签失败（不影响文件本身）`, (err as Error)?.message || String(err));
    }
  }

  /**
   * v1.0.2：自动标签的默认规则。
   *
   *   placeholders —— 文件类型 / 扩展名 / 渠道简称 / 上传方式 / 年份
   *   起始符 / 截断符 / 限长 —— 从文件名里取 `#关键词` 这类标签
   *
   * 说明：v1.0.1 用的是裸正则（DEFAULT_TAG_REGEX），写错一个字符就静默失效；
   * v1.0.2 换成「起始符 + 截断符 + 最大长度」三段式，默认值与旧的 `#` 规则基本等价。
   */
  static readonly DEFAULT_TAG_PLACEHOLDERS = '{mime},{ext},{channelName},{uploadSource},{y}';
  /**
   * v1.0.5：默认改为需求给定的一组值 —— 起始「# @ &」、截断「# @ & ! - _」、最多 10 字。
   *
   * 截断符里重复列出起始符是刻意的：`#美食#风景` 需要在前一个 `#` 处截断，
   * 否则会连成一条「美食#风景」。空格不进配置，由 extractByMarkers 写死。
   */
  static readonly DEFAULT_TAG_START = TAG_START_DEFAULT;
  /**
   * 空白恒为截断符（见 extractByMarkers），这里只列额外的符号。
   *
   * v1.0.6：改为**纯符号串**存储 —— 每个字符就是一个记号。
   * 起因是 v1.0.5 的 JSON 数组写法对用户太不友好（要在输入框里敲 `["#","@","&"]`），
   * 界面上改成直接敲 `#@&` 之后，存储也统一成同一形态，设置里看到的就是它生效的样子。
   *
   * 历史坑（保留说明，防止有人改回分隔符切分）：
   * v1.0.4 之前按「逗号 / 顿号 / 分号 / 空白」切分记号，而逗号本身就是截断符之一，
   * 整串会被切成 `['!！', '.。…']` 这种**多字符记号**，再拿单个字符去 startsWith
   * 永远不命中 —— 默认规则下的 `.`、`!`、`-` 其实一直没生效。
   */
  static readonly DEFAULT_TAG_STOP = TAG_STOP_DEFAULT;
  static readonly DEFAULT_TAG_MAX_LEN = TAG_MAX_LEN_DEFAULT;

  /**
   * v1.0.2：解析「起始符 / 截断符」配置。
   *
   * v1.0.6 定为两种写法：
   *   `#@&`            —— 纯符号串，**逐字符即逐记号**（当前界面与默认值的写法）
   *   `["#","@","&"]`  —— JSON 数组（旧版本存下来的配置，继续兼容读取）
   *
   * 为什么不能再用「逗号 / 分号 / 空白」切分：默认截断符里本身就含逗号、顿号、
   * 分号和一堆标点，按分隔符切会把 `!！,，.。` 变成单个多字符记号，逐字符匹配
   * 永远不命中（v1.0.4 的实际故障）。逐字符拆没有歧义。
   *
   * JSON 数组判定必须**首尾都是方括号且能解析成数组**：默认截断符里含 `[` `]`，
   * 只看首字符会把当前格式误判成 JSON。
   *
   * v1.0.4：起始符支持**空项**（`,@,&` 或 `["","@","&"]`），语义是「文件名开头」——
   * 让没有 `#` 前缀的文件也能按「第一段」打出标签。截断符不接受空项（否则任何字符
   * 都成了截断点，等于全部丢弃），因此由 keepEmpty 控制。
   */
  static parseMarkerList(raw: string, keepEmpty = false): string[] {
    const s = String(raw || '').trim();
    if (!s) return [];
    let items: string[] = [];
    if (s.startsWith('[') && s.endsWith(']')) {
      try {
        const j = JSON.parse(s);
        if (Array.isArray(j)) items = j.map((v) => String(v ?? ''));
      } catch {
        items = [];
      }
    }
    // 逐字符（按码点）拆分：`#@&` → ['#','@','&']，对中文 / emoji 也安全
    if (!items.length) items = Array.from(s);
    const cleaned = items.map((v) => String(v ?? '').trim());
    return Array.from(new Set(keepEmpty ? cleaned : cleaned.filter(Boolean)));
  }

  /**
   * v1.0.2：按「起始符 + 截断符 + 最大长度」从文件原名里抽取标签。
   *
   * 规则（与需求描述一致）：
   *   · 命中任一「起始符」后开始取内容；
   *   · 若紧跟的又是起始符（例如 `##标签`、`#@标签`），以**最后一个**为起始 —— 连续吃掉；
   *   · 一直取到「截断符」或空白（空白恒为截断符）或文件名结尾；
   *   · 取到的内容超过 maxLen（>0 时生效）就整条丢弃，不做截短；
   *   · 一条文件名里可以抽出多个标签，重复的只保留一次。
   *
   * v1.0.4 新增：起始符里允许出现**空项**（如 `,@,&`）。
   * 空的起始符表示「文件名开头」这一个位置 —— 它不是万能通配：
   * 只在整条文件名的第 0 位生效一次，不会把截断后的每一段都收成标签。
   * 典型的用法是 `猫咪照片!最终版` 配 起始 `,@`、截断 `!`、限长 8
   * → 得到「猫咪照片」，而不会额外得到「最终版」。
   */
  static extractByMarkers(originalName: string, startRaw: string, stopRaw: string, maxLen = 0): string[] {
    const name = String(originalName || '');
    if (!name) return [];
    const rawStarts = UploadService.parseMarkerList(startRaw, true);
    // 空项 = 行首算一个起始位置；其余空项没有意义，从常规匹配里剔除
    const hasEmptyStart = rawStarts.includes('');
    const starts = rawStarts.filter(Boolean);
    if (!starts.length && !hasEmptyStart) return [];
    const stops = UploadService.parseMarkerList(stopRaw);
    const isStop = (ch: string) => /[\s]/.test(ch) || stops.some((s) => ch.startsWith(s));
    const matchStart = (idx: number): string | null => {
      for (const s of starts) {
        if (s && name.startsWith(s, idx)) return s;
      }
      return null;
    };
    const out: string[] = [];
    let pos = 0;
    let guard = 0;
    while (pos < name.length && guard < 50) {
      guard += 1;
      // 找最近的一个起始符
      let hit = -1;
      let hitLen = 0;
      for (let i = pos; i < name.length; i += 1) {
        const s = matchStart(i);
        if (s) {
          hit = i;
          hitLen = s.length;
          break;
        }
      }
      if (hit < 0) {
        // 没有显式起始符：只有「空起始符 + 仍在开头」才继续，否则结束
        if (!hasEmptyStart || pos > 0) break;
        hit = 0;
        hitLen = 0;
      }
      let cur = hit + hitLen;
      // 连续起始符：以最后一个为起始
      for (;;) {
        const s = matchStart(cur);
        if (!s) break;
        cur += s.length;
      }
      // 一直取到截断符 / 空白 / 结尾
      let end = cur;
      while (end < name.length && !isStop(name[end])) end += 1;
      let content = name.slice(cur, end).trim();
      /*
       * v1.0.4：这一段的终点就是文件名的结尾时，把文件扩展名剥掉。
       * 否则「a@美食-b@风景.png」会得到「风景.png」—— 扩展名不是标签内容，
       * 用户配的限长也会被这 4 个字符白白吃掉。
       * 只剥「点 + 1~10 位英文数字」且只在结尾剥一次：
       *   `#v1.2.png` → `v1.2`（只去 .png）；`#标签.最终版` 不会动（中文不算扩展名）。
       */
      if (end >= name.length) content = content.replace(/\.[A-Za-z0-9]{1,10}$/, '');
      if (content && (maxLen <= 0 || content.length <= maxLen) && !out.includes(content)) out.push(content);
      // 从截断处继续找下一个（避免同一个起始符被重复消费）
      pos = end > hit ? end : hit + hitLen;
      if (out.length >= 20) break;
    }
    return out;
  }

  /**
   * v1.0.1：解析「提取指定内容」配置。
   *
   * 需求给的书写格式是 `["maomi":"猫咪"]`（不是严格 JSON），
   * 因此先按 JSON 解析（支持 `{"a":"b"}` / `[["a","b"]]` / `[{"find":"a","tag":"b"}]`），
   * 失败再走宽松匹配 `"键":"值"`，两种写法都能用。
   * 键 = 文件名里要出现的内容，值 = 要打的标签名。
   */
  static parseTagExtractRules(raw: string): { find: string; tag: string }[] {
    const out: { find: string; tag: string }[] = [];
    const s = String(raw || '').trim();
    if (!s) return out;
    const push = (find: unknown, tag: unknown) => {
      const f = String(find ?? '').trim();
      const t = String(tag ?? '').trim();
      if (f && t && !out.some((x) => x.find === f)) out.push({ find: f, tag: t });
    };
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j)) {
        for (const it of j) {
          if (Array.isArray(it) && it.length >= 2) push(it[0], it[1]);
          else if (it && typeof it === 'object') push((it as any).find ?? (it as any).key, (it as any).tag ?? (it as any).value);
          else if (typeof it === 'string') {
            const sep = it.indexOf(':');
            if (sep > 0) push(it.slice(0, sep), it.slice(sep + 1));
          }
        }
      } else if (j && typeof j === 'object') {
        for (const [k, v] of Object.entries(j as Record<string, unknown>)) push(k, v);
      }
      if (out.length) return out;
    } catch {
      /* 不是合法 JSON → 走宽松解析 */
    }
    const re = /["']([^"']+)["']\s*:\s*["']([^"']*)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) push(m[1], m[2]);
    return out;
  }

  /**
   * v3.0.0（R14）：从文件原名里提取「#话题」标签。
   * 规则（与需求逐字对应）：
   *   · 以 # 起始；标签内容只能是 中文/字母/数字；
   *   · 遇到任意符号（含空格）即截断，截断后的内容不算（#开心!!呀 → 只取「开心」）；
   *   · 超过 8 个字的整段放弃（#今天的天晴真的好舒服 → 不提取）；
   *   · 空格截断后的内容不算（#早晨 太阳 → 只取「早晨」，「太阳」不在 # 后）。
   * 最多提取 10 个，全部走去重。
   */
  static extractHashTags(originalName: string): string[] {
    const out: string[] = [];
    const re = /#([0-9A-Za-z\u4e00-\u9fff]{1,8})(?![0-9A-Za-z\u4e00-\u9fff])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(String(originalName || ''))) !== null) {
      const tag = m[1];
      if (tag && !out.includes(tag)) out.push(tag);
      if (out.length >= 10) break;
    }
    return out;
  }

  /** 解析渠道为适配器入参结构 */
  private toChannelInfo(c: { id: string; code?: string; name: string; type: string; config: string }): ChannelInfo {
    return {
      id: c.id,
      // v3.0.0（R11）：把 6 位业务 ID 透传给适配器 —— 存储路径的 {ID} 占位符要用它
      code: c.code,
      name: c.name,
      type: c.type,
      config: this.channels.decryptConfig(c.type, c.config),
      metas: {},
    };
  }

  /**
   * 渠道是否仍可写入 —— 启用容量限制且用量达到告警阈值时暂停写入。
   * 返回 true 表示可写。
   */
  async channelWritable(c: { id: string; config: string }): Promise<boolean> {
    let cfg: Record<string, string> = {};
    try {
      cfg = JSON.parse(c.config || '{}');
    } catch {
      return true;
    }
    if (cfg.quotaEnabled !== 'true') return true;
    const limitGB = Number(cfg.quotaLimitGB) || 10;
    const threshold = Number(cfg.quotaThreshold) || 95;
    const rows = await prisma.fileCopy.findMany({
      where: { channelId: c.id, status: 'active' },
      include: { file: { select: { size: true } } },
    });
    const usedGB = rows.reduce((a, b) => a + (b.file?.size || 0), 0) / 1024 / 1024 / 1024;
    return usedGB / limitGB < threshold / 100;
  }

  /**
   * 按渠道 ID 查找启用中的渠道（委托给 StorageChannelService，全站口径统一）。
   *
   * 只认「渠道 ID」：6 位 `code`（后台渠道列表展示的渠道 ID）或数据库主键 `id`。
   * 渠道名（name）不参与匹配 —— 它只是便于人看的标识，可随意改名，
   * 拿名字做匹配会在改名后静默失配（历史上就出现过这类问题）。
   */
  async findChannelById(key?: string) {
    return this.storageChannel.findById(key);
  }

  /**
   * 主渠道解析 —— 统一走 StorageChannelService.getStorageChannelCandidates('main')。
   *
   * 候选优先级（详见 StorageChannelService）：
   *   explicitId（前端上传设置里选的渠道 ID）
   *   → tokenId（API Token 上配置的默认渠道）
   *   → uploader（「用户管理」里为账户指定的渠道）
   *   → 全局（后台「上传设置」里指定的主渠道）
   *   → 兜底（按「渠道类型」在本类型内选）
   *
   * 候选里跳过已达容量阈值的渠道；显式指定的渠道超限时直接抛错（与旧行为一致）。
   */
  async resolveMainChannel(q: {
    channelId?: string;
    channelType?: string;
    uploader?: string;
    tokenId?: string;
    preferredId?: string;
  } = {}): Promise<StorageChannelInfo | null> {
    /*
     * v2.8.6：显式指定的渠道被停用 → 直接报错，绝不静默改投别的渠道。
     * 历史上 findById 会把停用渠道过滤掉，调用方于是一路回退到全局主渠道，
     * 用户完全无感（以为传到了自己选的渠道）。任何来源（网页 / WebDAV / API）都走这里。
     */
    if (q.channelId) {
      const raw = await this.storageChannel.findRawById(q.channelId);
      if (raw && !raw.enabled) {
        appLog.warn('upload', `拒绝上传：渠道「${raw.name}」已停用`, `渠道 ID=${raw.code}`);
        throw new Error(`渠道「${raw.name}」已停用，请先在后台「上传设置 → 存储渠道管理」启用后再上传`);
      }
    }
    const list = await this.storageChannel.getStorageChannelCandidates('main', {
      explicitId: q.channelId,
      channelType: q.channelType,
      uploader: q.uploader,
      tokenId: q.tokenId,
    });
    // 兼容旧调用方传入的「账户级渠道 ID」
    if (q.preferredId && !list.some((c) => c.id === q.preferredId)) {
      const extra = await this.storageChannel.findById(q.preferredId);
      if (extra) list.push(extra);
    }
    for (const c of list) {
      if (await this.channelWritable(c)) return c;
    }
    // 显式指定的渠道存在但已达容量阈值：报错，避免用户以为上传成功其实没写进去
    if (q.channelId && list.length) {
      throw new Error(`渠道「${list[0].name}」已达到容量阈值，写入已暂停`);
    }
    return null;
  }

  /**
   * 备份渠道解析 —— 统一走 StorageChannelService.getStorageChannelCandidates('backup')。
   *   explicitId（调用方显式指定）→ tokenId（Token 配置）→ uploader（账户指定）→ 全局备份渠道
   */
  async resolveBackupChannel(q: {
    explicitId?: string;
    uploader?: string;
    tokenId?: string;
    preferredId?: string;
  } = {}): Promise<StorageChannelInfo | null> {
    const list = await this.storageChannel.getStorageChannelCandidates('backup', {
      explicitId: q.explicitId,
      uploader: q.uploader,
      tokenId: q.tokenId,
    });
    if (q.preferredId && !list.some((c) => c.id === q.preferredId)) {
      const extra = await this.storageChannel.findById(q.preferredId);
      if (extra) list.push(extra);
    }
    for (const c of list) {
      if (await this.channelWritable(c)) return c;
    }
    return null;
  }

  /** 备份功能总开关 + 是否配置了备份渠道 */
  async backupEnabled(): Promise<boolean> {
    const sw = await this.settings.get('backupEnabled', 'true');
    return sw === 'true';
  }

  /**
   * 按命名策略生成存储 key。
   *
   * 两类渠道分开处理（v202610221824）：
   *   A. 支持「对象前缀 / 自定义文件命名」的渠道（minio / cos / aliyun / r2 / s3 / webdav / local）：
   *      前缀取渠道配置 objectPrefix，占位符 {user}{ID}{y}{m}{d}；
   *      为空时默认 `年/月`（2026/10），本地存储渠道默认 `{user}/{ID}/{y}/{m}`（v3.0.0 R11）。
   *      文件名取渠道配置 customName，占位符 {filename}{uuid}{md5}{timestamp}{ext}；
   *      为空时默认 `文件名-时间戳`。
   *   B. 其它渠道（easyimages / lsky / immich / custom）：沿用历史 `YYYYMM/随机名`，
   *      本地存储据此识别「首段 6 位数字」再叠加用户目录，不能随意改格式。
   */
  private makeKeyFor(
    channel: StorageChannelInfo,
    originalName: string,
    nameType: string | undefined,
    md5: string,
    /** v3.0.0（R9）：上传者用户名 —— 供前缀占位符 {user}（用户名 + 3 位随机数字）使用 */
    uploader?: string,
  ): string {
    const dot = originalName.lastIndexOf('.');
    const ext = dot > 0 ? originalName.slice(dot + 1).toLowerCase() : '';
    const stem = dot > 0 ? originalName.slice(0, dot) : originalName;

    if (supportsPrefix(channel.type)) {
      let cfg: Record<string, string> = {};
      try {
        cfg = this.channels.decryptConfig(channel.type, channel.config);
      } catch {
        cfg = {};
      }
      // 上传设置的「命名策略」（default/index/original）仅在渠道未自定义命名时生效
      let fileName: string;
      // 本地存储渠道的字段名是 nameTemplate（内置渠道 UI），其余渠道用 customName —— 两者都认
      const customName = String(cfg.customName || cfg.nameTemplate || '').trim();
      if (customName) {
        fileName = renderFileName(customName, { originalName, stem, ext, md5, timestamp: Date.now() });
      } else if (nameType === 'original') {
        fileName = ext ? `${stem}.${ext}` : stem;
      } else if (nameType === 'index') {
        fileName = `${Date.now()}.${ext || 'bin'}`;
      } else {
        // 默认：文件名-时间戳（需求规定的兜底格式）
        fileName = renderFileName('', { originalName, stem, ext, md5, timestamp: Date.now() });
      }
      // 前缀模板：优先新字段 objectPrefix，兼容历史字段 keyPrefix（cos/aliyun 旧称「指定存储路径」）。
      // 两者都为空 → 普通渠道兜底 `年/月`；本地存储渠道兜底 `{user}/{ID}/{y}/{m}`（v3.0.0 R11）。
      // 注意：前缀由这里统一渲染进 key，适配器不再二次拼接 keyPrefix，
      // 否则「自定义存储前缀」会被重复叠加（img/2026/10/img/2026/10/x.png）。
      // v3.0.0（R9）：前缀额外支持 {ID}（渠道 ID）/ {user}（当前用户名）/ {domain}（外链域名）
      const prefix = renderObjectPrefix(
        cfg.objectPrefix || cfg.keyPrefix,
        new Date(),
        {
          channelId: channel.code || channel.id,
          user: uploader,
          domain: cfg.publicDomain || cfg.domain,
        },
        channel.type === 'local' ? LOCAL_DEFAULT_PREFIX : undefined,
      );
      return joinObjectKey(prefix, fileName);
    }

    // B 类：历史格式保持不变
    const date = new Date();
    const datePath = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
    let name: string;
    switch (nameType) {
      case 'original':
        name = stem;
        break;
      case 'index':
        name = datePath + String(date.getTime());
        break;
      default: // default：随机短 ID
        name = CryptoService.shortId();
    }
    return `${datePath}/${name}${ext ? '.' + ext : ''}`;
  }

  /**
   * 解析上传目录（逻辑分类）：
   *   1) 前端上传页指定的目录（最优先）
   *   2) 后台「网页设置 → 客户端设置 → 默认上传目录」
   *   3) 兜底：按「年份/月份」自动分类，如 2026/10（每次上传实时计算）
   */
  private async resolveFolder(input?: string): Promise<string> {
    // v3.0.0：folder 归一化 —— 连续斜杠收敛为单个，再去掉首尾斜杠
    //（登记文件 / 前端粘贴目录常带「登记文件//2026/」这类脏路径，会让目录树推导出重复节点）
    const clean = (input || '').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
    if (clean) return clean;
    try {
      const page: any = await this.sysConfig.get('page');
      const v = String((page?.config || []).find((x: any) => x.id === 'defaultUploadFolder')?.value || '').trim();
      const dv = v.replace(/^\/+|\/+$/g, '');
      if (dv) return dv;
    } catch {
      /* 配置读取失败 → 走年月兜底 */
    }
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** 读取 page 分区某个配置项的值（统一 string，缺失返回 fallback） */
  private async pageValue(id: string, fallback = ''): Promise<string> {
    try {
      const page: any = await this.sysConfig.get('page');
      const hit = (page?.config || []).find((x: any) => x.id === id);
      if (hit && hit.value !== undefined && hit.value !== null) return String(hit.value);
    } catch {
      /* 配置读取失败 → 用默认值 */
    }
    return fallback;
  }

  /**
   * 后台「上传相关配置」里的媒体处理参数（v2.8.9）。
   * 空值 → 默认值；0 → 不限制；其它按正整数。
   */
  private async mediaSettings(): Promise<{
    compressMax: number;
    transcodeMax: number;
    compressConcurrency: number;
    transcodeConcurrency: number;
    retryEnabled: boolean;
    retryTimes: number;
    autoSwitch: boolean;
    guardEnabled: boolean;
    guardLoadFactor: number;
    guardRamFreeMB: number;
  }> {
    const num = (raw: string, fallback: number): number => {
      const t = String(raw ?? '').trim();
      if (t === '') return fallback;
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0) return fallback;
      return n === 0 ? 0 : Math.floor(n);
    };
    /** v3.0.0 第十三轮：允许小数（load1 倍率 1.5 这类），0 保留（= 关闭该项检测） */
    const numF = (raw: string, fallback: number): number => {
      const t = String(raw ?? '').trim();
      if (t === '') return fallback;
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0) return fallback;
      return n;
    };
    const bool = (raw: string, fallback: boolean): boolean => {
      const t = String(raw ?? '').trim().toLowerCase();
      if (t === '') return fallback;
      return t === 'true' || t === '1';
    };
    const [cMax, tMax, cConc, tConc, retry, times, autoSwitch, guardOn, guardLoad, guardRam] = await Promise.all([
      this.pageValue('compressMaxSeconds', '600'),
      this.pageValue('videoTranscodeMaxSeconds', '600'),
      this.pageValue('compressConcurrency', '1'),
      this.pageValue('videoTranscodeConcurrency', '1'),
      this.pageValue('defaultAutoRetry', 'true'),
      this.pageValue('defaultRetryTimes', '3'),
      this.pageValue('defaultAutoSwitch', 'true'),
      this.pageValue('mediaResourceGuardEnabled', 'true'),
      this.pageValue('mediaResourceLoadLimit', '1.5'),
      this.pageValue('mediaResourceRamLimit', '256'),
    ]);
    return {
      compressMax: num(cMax, 600),
      transcodeMax: num(tMax, 600),
      compressConcurrency: num(cConc, 1),
      transcodeConcurrency: num(tConc, 1),
      retryEnabled: bool(retry, true),
      retryTimes: num(times, 3),
      autoSwitch: bool(autoSwitch, true),
      guardEnabled: bool(guardOn, true),
      guardLoadFactor: numF(guardLoad, 1.5),
      guardRamFreeMB: numF(guardRam, 256),
    };
  }

  /** 后台默认压缩期望（百分比），非法时回退 80 */
  private async defaultCompressPercent(): Promise<number> {
    try {
      const page: any = await this.sysConfig.get('page');
      const v = Number((page?.config || []).find((x: any) => x.id === 'defaultCompressQuality')?.value);
      if (Number.isFinite(v) && v >= 10 && v <= 100) return v;
    } catch {
      /* 忽略 */
    }
    return 80;
  }

  /** 对外文件标识（/file/:name 的 name）：48 位数字+大小写字母组合，防随机遍历命中 */
  private makeFileId(): string {
    return CryptoService.fileId(48);
  }

  /**
   * 投递后置处理任务（v2.8.8）。
   * 调用点已经完成「写渠道 + 落库」，这里只负责准备本地源文件并塞进全局单通道队列。
   * 投递失败只记日志 —— 文件本身已经上传成功，不因此报错。
   */
  private deferMediaPostProcess(job: MediaPostJob): void {
    void (async () => {
      let path = job.srcPath;
      let tempOwned = false;
      try {
        if (!path) {
          const dir = join(tmpdir(), 'gohub-post');
          await fsp.mkdir(dir, { recursive: true });
          path = join(dir, `${job.fileId.replace(/[\\/:*?"<>|]/g, '_')}.${job.ext || 'bin'}`);
          await fsp.writeFile(path, job.buffer);
          tempOwned = true;
        }
      } catch (err) {
        appLog.warn(
          'compress',
          `后置压缩/转码任务创建失败（文件已上传成功，跳过处理）`,
          `${(err as Error).message} ｜ ${job.originalName}`,
          job.ip,
        );
        return;
      }
      // v2.8.9：压缩与转码各走一条通道，并发数由后台「同时处理任务数」决定（默认各 1 路）
      const ms = await this.mediaSettings();
      const lane = job.compress ? 'compress' : 'transcode';
      const limit = job.compress ? ms.compressConcurrency : ms.transcodeConcurrency;
      enqueueMediaJob(
        `${job.fileId}（${job.originalName}）`,
        () => this.runMediaPostProcess({ ...job, srcPath: path, buffer: Buffer.alloc(0), tempOwned }),
        lane,
        limit,
      );
      const stats = mediaQueueStats();
      appLog.info(
        'compress',
        `已排入后置处理队列：${job.originalName}`,
        `压缩=${job.compress ? `${job.percent}%` : '关'} ｜ 兼容转码=${job.transcode ? '开' : '关'} ｜ 通道=${lane}(${limit === 0 ? '不限' : `${limit} 路`}) ｜ 队列=${stats.pending} 等待 | 执行中=${stats.current || '无'}`,
        job.ip,
      );
    })();
  }

  /**
   * 执行后置处理：压缩 → 转码（串行，全局单通道）。
   *
   * 成功：把产物以**新 key** 写回同一渠道，更新副本与文件记录，再 best-effort 删除旧对象。
   * 失败/放弃：什么都不改 —— 渠道上的原文件与库记录保持上传时的状态。
   */
  private async runMediaPostProcess(job: MediaPostJob): Promise<void> {
    const t0 = Date.now();
    try {
      const rec = await prisma.fileRecord.findUnique({
        where: { id: job.recordId },
        select: { status: true, originalName: true, size: true, md5: true, instanceId: true },
      });
      if (!rec || rec.status !== 'active') {
        appLog.info('compress', `后置处理跳过：文件已删除或不在正常状态`, job.fileId, job.ip);
        return;
      }
      const ch = await prisma.channel.findUnique({ where: { id: job.channelId } });
      if (!ch) {
        appLog.warn('compress', `后置处理跳过：目标渠道已不存在`, job.fileId, job.ip);
        return;
      }

      const ms = await this.mediaSettings();
      const r = await postProcessMediaFile(job.srcPath, job.mime, job.ext, {
        compress: job.compress,
        percent: job.percent,
        transcode: job.transcode,
        compressMaxSeconds: ms.compressMax,
        transcodeMaxSeconds: ms.transcodeMax,
        // v3.0.0 第十三轮：影音压缩/转码资源闸门（后台可配置，仅视频/音频；图片压缩不经过）
        guard: { enabled: ms.guardEnabled, loadFactor: ms.guardLoadFactor, ramFreeMB: ms.guardRamFreeMB },
      });
      if (r.skipReason) {
        appLog.info(
          'compress',
          `后置处理未改变文件：${rec.originalName}`,
          `${r.skipReason} ｜ 耗时 ${r.elapsedMs ?? 0}ms${r.codec ? ` ｜ 编码=${r.codec}` : ''}`,
          job.ip,
        );
      }
      /*
       * v3.0.0：把压缩 / 转码结果写进文件处理事件（详情页「处理记录」一行）。
       * 契约：
       *   compress  { enabled(布尔，始终写入), status('done'|'skipped'|'failed'), reason?, ms?, size?, originalSize? }
       *   transcode { enabled, status('done'|'failed'|'skipped'), ms?, reason? }
       * compress.reason 是**语义值**（前端据此展示文案）：
       *   'off'       未开启压缩
       *   'webp'      文件已由前端转成 WebP，跳过压缩
       *   'threshold' 未达压缩阈值 / 判定为不值得压缩 / 压缩未生效
       *   ''          正常压缩（done）
       * size / originalSize 仅在压缩产物确定时有意义，未启用时不写。
       */
      const skipped = r.skipReason || '';
      const ev: Record<string, unknown> = {};
      if (job.compress) {
        ev.compress =
          r.stage === 'compress'
            ? { enabled: true, status: 'done', reason: '', ms: r.elapsedMs, size: r.size, originalSize: rec.size }
            : {
                enabled: true,
                status: 'skipped',
                /*
                 * v3.0.0（R8）：音频 / 视频压缩由后置队列执行，跳过原因**不是**「未达压缩阈值」——
                 * 用语义值 'media' + detail 原样记录真实原因（未装 ffmpeg / 预计超时 /
                 * 资源不足 / 压缩未生效 / 压缩开关未开启），详情页「处理记录」可读。
                 */
                reason: 'media',
                ms: r.elapsedMs,
                ...(skipped ? { detail: skipped } : {}),
              };
      } else {
        ev.compress = { enabled: false, status: 'skipped', reason: 'off' };
      }
      if (job.transcode) {
        ev.transcode =
          r.stage === 'transcode'
            ? { enabled: true, status: 'done', ms: r.elapsedMs }
            : r.stage === 'compress'
              ? { enabled: true, status: 'skipped', reason: '压缩产物已是 H.264，无需转码' }
              : {
                  enabled: true,
                  status: skipped ? 'failed' : 'skipped',
                  ms: r.elapsedMs,
                  reason: skipped || '无需转码或转码未生效',
                };
      } else {
        ev.transcode = { enabled: false, status: 'skipped', reason: '转码开关未开启' };
      }
      await this.writeProcessEvent(job.recordId, ev);

      if (!r.compressed || r.stage === 'none') return;

      const info = this.toChannelInfo(ch);
      const newName = r.ext ? rec.originalName.replace(/\.[^.]+$/, '') + r.ext : rec.originalName;
      const key = this.makeKeyFor(
        { id: ch.id, code: ch.code, name: ch.name, type: ch.type, config: ch.config },
        newName,
        job.nameType,
        rec.md5 || '',
        job.uploader,
      );
      const adapter = createAdapter(info);
      const up = await this.uploadToAdapter(
        adapter,
        { buffer: Buffer.alloc(0), path: r.path, size: r.size, mime: r.mime || job.mime, originalName: newName },
        key,
        info,
        job.uploader,
        rec.instanceId || '',
      );

      const copy = await prisma.fileCopy.findFirst({
        where: { fileId: job.recordId, channelId: ch.id },
        select: { id: true, remoteKey: true, remoteUrl: true, metas: true },
      });
      /*
       * v3.0.0（R10）：压缩/转码会换文件名 —— 固化地址必须同步更新，
       * 否则 objectPath 还指向旧对象（404）。旧 metas 保留（owner/instanceId 等）。
       */
      let prevMetas: Record<string, unknown> = {};
      try {
        const parsed = copy?.metas ? JSON.parse(copy.metas) : null;
        if (parsed && typeof parsed === 'object') prevMetas = parsed as Record<string, unknown>;
      } catch {
        prevMetas = {};
      }
      const writeData = this.copyWriteData(up, ch);
      await prisma.fileCopy.update({
        where: { fileId_channelId: { fileId: job.recordId, channelId: ch.id } },
        data: { ...writeData, metas: JSON.stringify({ ...prevMetas, ...JSON.parse(writeData.metas) }), status: 'active' },
      });
      await prisma.fileRecord.update({
        where: { id: job.recordId },
        data: { size: r.size, mime: r.mime || job.mime, originalName: newName },
      });

      // 旧对象删除是 best-effort：失败只会在渠道上留一个孤儿对象，不影响外链
      if (copy && (copy.remoteKey || copy.remoteUrl)) {
        try {
          await adapter.delete(toCopyInfo(copy), info);
        } catch (err) {
          appLog.warn('compress', `旧对象删除失败（不影响新外链）`, `${(err as Error).message} ｜ ${copy.remoteKey}`, job.ip);
        }
      }
      appLog.info(
        'compress',
        `后置${r.stage === 'transcode' ? '兼容转码' : '压缩'}完成：${rec.originalName} → ${newName}`,
        `${rec.size}B → ${r.size}B ｜ 耗时 ${Date.now() - t0}ms（估算 ${r.estimatedSeconds ?? '-'}s）｜ 渠道=${ch.name}`,
        job.ip,
      );
    } catch (err) {
      appLog.warn(
        'compress',
        `后置处理失败（渠道与原记录均保持不变）：${job.originalName}`,
        `${(err as Error).message} ｜ 耗时 ${Date.now() - t0}ms`,
        job.ip,
      );
    } finally {
      if (job.tempOwned && job.srcPath) await fsp.unlink(job.srcPath).catch(() => undefined);
      // 压缩 / 转码中间产物（.cmp.webp / .cmp.mp4 / .h264.mp4）
      for (const suffix of ['.cmp.mp4', '.cmp.webm', '.cmp.m4a', '.cmp.mp3', '.h264.mp4']) {
        await fsp.unlink(`${job.srcPath}${suffix}`).catch(() => undefined);
      }
    }
  }

  /**
   * 合并写入「文件处理事件」（v2.8.9）。
   * 存在 metas.ProcessEvent 里，只覆盖传入的字段，不动其它处理结果与归属地等字段。
   */
  private async writeProcessEvent(recordId: string, patch: Record<string, unknown>): Promise<void> {
    try {
      const cur = await prisma.fileRecord.findUnique({ where: { id: recordId }, select: { metas: true } });
      if (!cur) return;
      let metas: Record<string, any> = {};
      try {
        metas = JSON.parse(cur.metas || '{}');
      } catch {
        metas = {};
      }
      const prev = (metas.ProcessEvent && typeof metas.ProcessEvent === 'object' ? metas.ProcessEvent : {}) as Record<string, unknown>;
      metas.ProcessEvent = { ...prev, ...patch, updatedAt: new Date().toISOString() };
      await prisma.fileRecord.update({ where: { id: recordId }, data: { metas: JSON.stringify(metas) } });
    } catch (err) {
      appLog.warn('compress', `处理事件写入失败（不影响文件）`, (err as Error)?.message || String(err));
    }
  }

  /** 后置处理队列状态（系统状态 / 运维排查用） */
  mediaQueue() {
    return mediaQueueStats();
  }

  /** 单步时间上限（秒）—— 系统状态页展示用 */
  mediaMaxSeconds(): number {
    return MEDIA_MAX_SECONDS;
  }

  /**
   * 清洗外部传入的文件标识（S3 的 Object Key）。
   *   - 去掉协议头与查询串，去掉前导斜杠、`..` 等会破坏路由/越权的片段
   *   - 保留目录层级（/file/* 支持多级路径，如 `web/202610/ab.png`）
   */
  private sanitizeFileId(raw: string): string {
    let s = String(raw || '').trim();
    s = s.replace(/^https?:\/\/[^/]+/i, '');
    s = s.split('?')[0].split('#')[0];
    s = s
      .split('/')
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/');
    s = s.replace(/[\u0000-\u001f<>:"|*\\]/g, '_');
    return s.slice(0, 200);
  }

  /** 保证文件标识唯一：已存在时追加 `-1`、`-2`…（保留扩展名） */
  private async uniqueFileId(base: string): Promise<string> {
    const fallback = base || this.makeFileId();
    const ext = /\.[A-Za-z0-9]{1,8}$/.test(fallback) ? fallback.slice(fallback.lastIndexOf('.')) : '';
    const stem = ext ? fallback.slice(0, -ext.length) : fallback;
    for (let i = 0; i < 50; i += 1) {
      const candidate = i === 0 ? fallback : `${stem}-${i}${ext}`;
      const exists = await prisma.fileRecord.findFirst({
        where: { name: candidate },
        select: { id: true, name: true, status: true },
      });
      if (!exists) return candidate;
      /*
       * 名字被「回收站文件」占用 → 彻底删除它，把名字让给这次上传。
       * 典型场景：S3 客户端 DELETE（软删除进回收站）后重新 PUT 同名 key ——
       * 客户端拼的外链永远指向这个名字，不能因为回收站占用而变成 xxx-1。
       * 回收站那条的远端副本一并清理，不会留孤儿资源。
       */
      if (exists.status === 'deleted') {
        await this.removeFile(exists.id, exists.name);
        continue;
      }
    }
    return this.makeFileId();
  }

  /** 上传去重开关（后台「存储与分发设置」可开关） */
  private async dedupEnabled(): Promise<boolean> {
    try {
      return (await this.settings.get('dedupEnabled', 'false')) === 'true';
    } catch {
      return false;
    }
  }

  /**
   * 去重范围（仅当去重开关打开时生效）：
   *   all         —— 全库范围内比较（默认）：任意渠道上已有相同内容即复用外链
   *   channel     —— 仅在同一「渠道名称」内比较：先比渠道名，渠道名相同再比大小 + MD5
   *   channelType —— 仅在同一「渠道类型」内比较：先比渠道类型，类型相同再比大小 + MD5
   */
  private async dedupScope(): Promise<'all' | 'channel' | 'channelType'> {
    try {
      const v = await this.settings.get('dedupScope', 'all');
      return v === 'channel' ? 'channel' : v === 'channelType' ? 'channelType' : 'all';
    } catch {
      return 'all';
    }
  }

  /** 流式计算文件 MD5（大文件不读进内存） */
  private hashFile(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('md5');
      const stream = createReadStream(path);
      stream.on('data', (chunk) => hash.update(chunk as Buffer));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * 统一渠道写入：有 path 且适配器支持流式 → uploadFile；
   * 否则回退到整块 Buffer（并对超大文件设阈值，避免把进程撑爆）。
   */
  private async uploadToAdapter(
    adapter: StorageAdapter,
    file: UploadInput,
    key: string,
    info: ChannelInfo,
    owner?: string,
    // v3.0.0 多实例：透传归属实例给本地存储渠道（uploads/<用户名>/<实例ID>/…）
    instanceId?: string,
  ): Promise<{
    remoteKey: string;
    remoteUrl?: string;
    objectPath?: string;
    urlQuery?: string;
    metas?: Record<string, unknown>;
  }> {
    if (file.path && typeof adapter.uploadFile === 'function') {
      return adapter.uploadFile(
        file.path,
        file.size || 0,
        { mime: file.mime, originalName: file.originalName },
        key,
        info,
        { owner, instanceId },
      );
    }
    if (file.path) {
      const size = file.size || 0;
      if (size > STREAM_REQUIRED_BYTES) {
        throw new AdapterError(
          `渠道「${info.name || info.type}」不支持大文件流式写入，${Math.round(size / 1024 / 1024)}MB 超过直传安全阈值；请改用 S3 / 本地存储 / WebDAV 渠道`,
          info.type,
        );
      }
      const buffer = await fsp.readFile(file.path);
      return adapter.upload({ buffer, mime: file.mime, originalName: file.originalName }, key, info, { owner, instanceId });
    }
    return adapter.upload({ buffer: file.buffer, mime: file.mime, originalName: file.originalName }, key, info, { owner, instanceId });
  }

  /**
   * 服务端压缩（v2.3.0 起统一委托给 common/compress.ts）。
   * 保留这个薄封装是为了兼容历史调用点（内部已不再直接使用 sharp）。
   */
  private async compress(buffer: Buffer, mime: string, percent: number): Promise<{ buffer: Buffer; mime: string; ext: string }> {
    const ext = mime.split('/')[1] || '';
    const r = await compressMedia(buffer, mime, ext, percent);
    if (r.compressed) return { buffer: r.buffer, mime: r.mime || mime, ext: r.ext || `.${ext}` };
    return { buffer, mime, ext: ext ? `.${ext}` : '' };
  }

  /**
   * 「默认开启压缩」开关（后台 → 网页设置 → 默认开启压缩）。
   * 用于没有前端开关的上传入口（API Token / WebDAV）：前端上传页会显式传 serverCompress。
   */
  private async defaultServerCompress(): Promise<boolean> {
    try {
      const page: any = await this.sysConfig.get('page');
      const item = (page?.config || []).find((x: any) => x.id === 'defaultCustomerCompress');
      return item ? item.value === true || item.value === 'true' : true;
    } catch {
      return true;
    }
  }

  /**
   * 「视频兼容转码」全局开关（v2.8.4 引入；v2.8.5 起挂在后台 → 其他设置 → 上传相关配置）。
   * 只对浏览器播不了的编码（H.265/HEVC 等）转 H.264，与压缩开关相互独立 ——
   * 即使关闭压缩，华为等设备的 HEVC 视频也会被转码，解决「只有声音没画面」。
   */
  async globalTranscodeEnabled(): Promise<boolean> {
    try {
      const page: any = await this.sysConfig.get('page');
      const item = (page?.config || []).find((x: any) => x.id === 'videoTranscodeIncompatible');
      // 未保存过时 value 可能是 undefined，此时回退到 default 字段（默认开）
      if (!item) return true;
      if (item.value === undefined || item.value === null || item.value === '') return item.default !== false;
      return item.value === true || item.value === 'true';
    } catch {
      return true;
    }
  }

  /**
   * v2.8.8：账户级「视频兼容转码」策略（用户管理 → 编辑 → 管理员操作）。
   *   inherit 跟随全局 / off 禁用 / on 启用 / user 由用户在前台上传设置里选
   */
  async videoTranscodePolicy(username?: string): Promise<'inherit' | 'off' | 'on' | 'user'> {
    const name = String(username || '').trim();
    if (!name) return 'inherit';
    const normalize = (v: unknown): 'inherit' | 'off' | 'on' | 'user' =>
      v === 'off' || v === 'on' || v === 'user' ? v : 'inherit';
    try {
      const row = await prisma.user.findUnique({
        where: { username: name },
        select: { transcodePolicy: true },
      });
      if (row) return normalize(row.transcodePolicy);
      // 内建管理员不在 users 表中：读「用户管理 → 编辑管理员」保存的 adminProfile
      const prof = await this.adminProfileIfAdmin(name);
      if (prof) return normalize(prof.transcodePolicy);
      return 'inherit';
    } catch {
      return 'inherit';
    }
  }

  /**
   * 内建管理员档案（users 表里没有 admin 行时，用 sysConfig 的 adminProfile）。
   * 名字不匹配或读取失败返回 null。
   */
  private async adminProfileIfAdmin(username: string): Promise<Record<string, any> | null> {
    try {
      const security: any = await this.sysConfig.get('security');
      const adminName =
        String(security?.auth?.admin?.adminUsername || '').trim() ||
        (process.env.ADMIN_USER || '').trim() ||
        'admin';
      if (username !== adminName) return null;
      const prof: any = await this.sysConfig.get('adminProfile');
      return prof && typeof prof === 'object' ? prof : null;
    } catch {
      return null;
    }
  }

  /**
   * v2.8.8：最终是否执行兼容转码。
   * 优先级：账户策略 on/off（硬性） → 账户策略 user + 本次显式选择 → 全局开关。
   */
  async transcodeDecision(uploader?: string, explicit?: boolean): Promise<boolean> {
    const policy = await this.videoTranscodePolicy(uploader);
    if (policy === 'on') return true;
    if (policy === 'off') return false;
    if (policy === 'user' && typeof explicit === 'boolean') return explicit;
    return this.globalTranscodeEnabled();
  }

  /**
   * v2.8.8：账户级「单文件大小上限」（MB）。
   *   0 / 未设置 → 用全局「单文件大小上限」
   *   >0        → 该账户上传按此值封顶
   */
  async userMaxFileSizeMB(username?: string): Promise<number> {
    const name = String(username || '').trim();
    if (!name) return 0;
    try {
      const row = await prisma.user.findUnique({
        where: { username: name },
        select: { maxFileSizeMB: true },
      });
      if (row) return Math.max(0, Number(row.maxFileSizeMB) || 0);
      const prof = await this.adminProfileIfAdmin(name);
      if (prof) return Math.max(0, Number(prof.maxFileSizeMB) || 0);
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * 登录用户名 → 实例创建者 ID（users 表主键；内建管理员不在 users 表 → 'admin'）。
   * 与 InstancesService.ownerIdOf 同一套口径（上传侧就地实现，避免跨模块依赖）。
   */
  private async instanceOwnerIdOf(username: string): Promise<string> {
    const name = String(username || '').trim();
    if (!name) return '';
    try {
      const row = await prisma.user.findUnique({ where: { username: name }, select: { id: true } });
      if (row?.id) return row.id;
      const userCount = await prisma.user.count();
      return userCount > 0 ? name : 'admin';
    } catch {
      return name;
    }
  }

  /**
   * v3.0.0：上传归属实例校验。
   * instanceId 非空时，uploader 必须是该实例的创建者或 members 成员；
   * 校验失败（实例不存在 / 不是成员）回退空串（默认实例），并记一条 warn 日志。
   */
  private async resolveInstanceScope(instanceId: string | undefined, uploader: string | undefined, ip: string): Promise<string> {
    const id = String(instanceId || '').trim();
    if (!id) return '';
    try {
      const inst = await prisma.instance.findUnique({ where: { id } });
      if (!inst) {
        appLog.warn('upload', `实例归属校验失败：实例不存在，已回退默认实例`, `instanceId=${id}`, ip);
        return '';
      }
      let members: string[] = [];
      try {
        const parsed = JSON.parse(inst.metas || '{}');
        if (Array.isArray(parsed?.members)) members = parsed.members.map((m: unknown) => String(m || '').trim()).filter(Boolean);
      } catch {
        members = [];
      }
      const isOwner = inst.ownerName === uploader || (await this.instanceOwnerIdOf(uploader || '')) === inst.ownerId;
      if (isOwner || members.includes(String(uploader || '').trim())) return id;
      appLog.warn(
        'upload',
        `实例归属校验失败：用户 ${uploader || '(匿名)'} 不是实例「${inst.name}」的成员，已回退默认实例`,
        `instanceId=${id}`,
        ip,
      );
      return '';
    } catch (err) {
      appLog.warn('upload', `实例归属校验异常，已回退默认实例`, (err as Error)?.message || String(err), ip);
      return '';
    }
  }

  /**
   * 核心上传入口 —— 主渠道同步 → 建记录 → 备份渠道异步（低优先级，自动让路）。
   * 返回对外文件标识（/file/:id）。
   *
   * 注意：整段流程都计入 activeUploads，因此上传过程中触发的备份任务
   * 会一直等到本次（以及后续并发的）主渠道上传结束后才开始传输。
   */
  async upload(input: UploadInput, opts: UploadOptions): Promise<{ id: string; error?: string; dedup?: boolean; finalName?: string }> {
    this.activeUploads += 1;
    try {
      return await this.uploadInner(input, opts);
    } finally {
      this.activeUploads -= 1;
    }
  }

  private async uploadInner(input: UploadInput, opts: UploadOptions): Promise<{ id: string; error?: string; dedup?: boolean; finalName?: string }> {
    let { buffer, mime, originalName } = input;
    // v2.8.3：大文件走磁盘路径；small 文件仍是内存 Buffer。
    // size 统一在这里确定，后面所有限额/落库/备份都用它，避免 path/buffer 双份逻辑。
    let srcPath = input.path || '';
    let size = Number(input.size || 0);
    if (!size) {
      size = srcPath ? (await fsp.stat(srcPath)).size : buffer.length;
    }

    /*
     * 服务端校验：扩展名白名单 + 魔数 + 大小上限（客户端校验不可信）。
     * WebDAV 通道（opts.skipFileLimits）**完全跳过**这三项 —— 它的定位是
     * 「同步 / 备份型传输通道」，可能上传任意类型、任意体积的文件。
     */
    if (!opts.skipFileLimits) {
      const invalid = await this.validate(input, opts.limitsOverride, opts.uploader);
      if (invalid) return { id: '', error: invalid };
    }

    // 初始（压缩前）大小：前端本地压缩后仍会带原始字节数上来；缺省时用实际大小
    const originalSize = opts.originalSize && opts.originalSize > 0 ? opts.originalSize : size;

    // MIME 归一化：以扩展名为准（curl 等会把 mp4/mp3 传成 application/octet-stream）
    mime = this.normalizeMime(originalName, mime);

    // IP 归属地用的请求 IP（后面所有日志都用它）
    const uploadIp = opts.ip || '';

    // 主渠道 / 备份渠道统一由 StorageChannelService 按优先级解析：
    //   本次请求显式指定 → API Token 配置 → 「用户管理」账户指定 → 后台「上传设置」全局渠道
    // （ignoreUploaderChannel：Web 通用 Token 分支跳过「账户指定」一级，见 UploadOptions）
    // v2.8.5：解析提前到压缩之前 —— 去重需要按渠道范围比对，早点拿到渠道避免白压一遍
    let main: StorageChannelInfo | null = null;
    try {
      main = await this.resolveMainChannel({
        channelId: opts.channelId,
        channelType: opts.uploadChannel,
        uploader: opts.ignoreUploaderChannel ? undefined : opts.uploader,
        tokenId: opts.tokenId,
      });
    } catch (err) {
      return { id: '', error: (err as Error).message };
    }
    if (!main) {
      const hint = opts.channelId
        ? `渠道 ID「${opts.channelId}」不存在或已禁用`
        : opts.uploadChannel
          ? `没有可用的「${opts.uploadChannel}」渠道，且未设置全局主渠道`
          : '未指定渠道，且「用户管理」「上传设置」里都没有可用的主渠道';
      return { id: '', error: `未配置可用的主渠道（${hint}），请先在后台「存储渠道」检查` };
    }

    /*
     * 去重（可开关）—— v2.8.5 重做，核心变化：
     *   1) MD5 与大小一律按「压缩前的原文件」计算，且在压缩之前就查库：
     *      命中直接返回已有外链，不再做图像审查 / 压缩 / 转码 / 上传，真正的秒传；
     *   2) 用原始大小比对，而不是压缩后大小 —— 同一份原文件在不同压缩档位下
     *      压出来的字节数并不稳定（JPEG 重编码、ffmpeg 转码都带浮动），
     *      拿压缩后的大小 + 压缩后的 MD5 去比，会出现「同一个文件却判不成重复」；
     *   3) 库里 md5 列从本版起统一存「原始文件内容 MD5」，所以原样上传的历史记录
     *      也能被命中；老记录里 originalSize 为 0 的，用 size 兜底比较。
     * 范围（dedupScope）：
     *   all         —— 全库比较（默认）
     *   channel     —— 只在「同一渠道名称」内比较：先比渠道名，渠道名相同再比大小 + MD5
     *   channelType —— 只在「同一渠道类型」内比较：先比渠道类型，类型相同再比大小 + MD5
     */
    const md5 = srcPath ? await this.hashFile(srcPath) : createHash('md5').update(buffer).digest('hex');
    if (await this.dedupEnabled()) {
      const scope = await this.dedupScope();
      /*
       * v3.0.0：去重口径全站统一 —— 只在「内容」层面比（MD5 + 原始大小），
       * 再按渠道维度收窄，与上传用户 / 所在实例无关：
       *   all         → 任意渠道命中即复用
       *   channel     → 只看「同一渠道名称」上的副本
       *   channelType → 只看「同一渠道类型」上的副本
       * 同一份内容可能在多个渠道各有一份副本，所以取候选集（而不是 findFirst 一条），
       * 逐个比对渠道属性 —— 否则第一条恰好不是目标渠道时就会漏判。
       */
      const dups = await prisma.fileRecord.findMany({
        where: {
          status: 'active',
          md5,
          // 原始大小优先；老数据 originalSize 缺省为 0 时用 size 兜底（未压缩时两者相同）
          OR: [{ originalSize }, { size: originalSize }],
        },
        take: 50,
        select: {
          name: true,
          originalName: true,
          // v2.8.7b：附带渠道信息 —— 「同一渠道名称内 / 同一渠道类型内」两种范围都需要比对渠道属性
          copies: { select: { channelId: true, status: true, isPrimary: true, channel: { select: { name: true, type: true } } } },
        },
      });
      /** 取某条记录的「主渠道」副本（没有 isPrimary 标记时退化为第一份副本） */
      const primaryCopyOf = (d: (typeof dups)[number]) =>
        d.copies.find((c) => c.isPrimary) || d.copies[0];
      const hit =
        dups.find((d) => {
          if (scope === 'all') return true;
          const pc = primaryCopyOf(d);
          if (!pc) return false;
          return scope === 'channel'
            ? (pc.channel?.name || '') === main.name
            : (pc.channel?.type || '') === main.type;
        }) || null;
      if (!hit && dups.length) {
        const d0 = dups[0];
        const pc = primaryCopyOf(d0);
        appLog.info(
          'upload',
          `去重跳过：${originalName} 与已有文件 ${d0.name} 内容相同，但渠道${scope === 'channel' ? '名称' : '类型'}不同（去重范围为「${scope === 'channel' ? '同一渠道名称内' : '同一渠道类型内'}」）`,
          `目标渠道=${main.name}（类型=${main.type}） ｜ 已有文件渠道=${pc?.channel?.name || '未知'}（类型=${pc?.channel?.type || '未知'}）`,
          uploadIp,
        );
      }
      if (hit) {
        /*
         * v3.0.0（R10）：去重不再「借别人的外链」，而是为本次上传者/实例**克隆一份记录**。
         *
         * 旧行为直接返回源记录的 File_ID —— 外链、密码、限时、重定向、账户链接权限
         * 全部与原上传者共享：原主软删/彻底删除/关闭链接权限，后来者的地址就一起失效。
         *
         * 现在：新记录（新 File_ID、归属本次上传者与实例、个人字段清零）+
         * 新副本行（指向同一个远端对象，零字节冗余）。删除侧按引用计数决定是否删远端对象，
         * 只有最后一个使用者才真正删除远端文件。
         */
        const cloned = await this.cloneDedupRecord(hit.name, opts, uploadIp);
        appLog.info(
          'upload',
          `命中去重：${originalName} 与已有文件 ${hit.originalName}（${hit.name}）内容相同，已为本次上传克隆记录 ${cloned}`,
          `md5=${md5} ｜ 原始大小=${originalSize}B ｜ 范围=${scope === 'channel' ? `同一渠道名称内（${main.name}）` : scope === 'channelType' ? `同一渠道类型内（${main.type}）` : '全部渠道'}`,
          uploadIp,
        );
        return { id: cloned, dedup: true, finalName: originalName };
      }
    }

    /*
     * 图像审查（可开关；接口异常时放行）。
     * 大文件（>64MB 的图片极罕见）跳过：审查接口要求整图上传，读进内存不划算。
     */
    if (mime.startsWith('image/') && size <= 64 * 1024 * 1024) {
      const reviewBuffer = buffer.length ? buffer : await fsp.readFile(srcPath);
      const rejected = await this.moderate(reviewBuffer, mime);
      if (rejected) return { id: '', error: rejected };
    }

    // IP 归属地（可开关）：主链路只读缓存，未命中则落库后异步补写 ——
    // 归属地查询是外部网络请求（最长 6 秒），绝不能挡在上传主链路上。
    const uploadAddress = await this.cachedAddress(uploadIp);

    // v3.0.0：实例归属校验 —— 指定实例且 uploader 不是创建者/成员时回退默认实例（空串）
    const instanceScope = await this.resolveInstanceScope(opts.instanceId, opts.uploader, uploadIp);

    /*
     * 预处理（v2.8.8 重构）：
     *
     *   「先保证上传成功，再谈压缩与转码」—— 这是本版最重要的一条规则。
     *
     *   · 图片：仍在写渠道之前同步压（sharp 毫秒级，且任何异常都会退回原图，
     *     不存在「因为压缩把上传搞失败」的可能），保持既有行为与 WebP 转换体验；
     *   · 视频 / 音频：**不在这里处理**。合并请求里跑 ffmpeg（几百 MB 的 HEVC 在低配
     *     机器上要几十分钟）会被反向代理超时切断，前端重试又撞上「合并中」锁 ——
     *     这就是 v2.8.7 反复「合并后失败」的根因。改为落库成功后投递到全局单通道
     *     队列里做「先压缩、后转码」，预计超时/资源不足直接放弃（见 media-post.ts）；
     *   · 兼容转码开关按「账户策略 → 全局」解析（用户管理里可按账户强制开/关）。
     */
    const wantCompress = opts.serverCompress ?? (await this.defaultServerCompress());
    const isVideo = (mime || '').startsWith('video/');
    const isAudio = (mime || '').startsWith('audio/');
    const isImage = (mime || '').startsWith('image/');
    const wantTranscode = isVideo ? await this.transcodeDecision(opts.uploader, opts.videoTranscode) : false;
    const srcExt = originalName.includes('.') ? String(originalName.split('.').pop() || '') : '';
    const compressPercent =
      opts.compressPercent && opts.compressPercent > 0 ? opts.compressPercent : await this.defaultCompressPercent();

    /**
     * v2.8.9：图片是同步压缩的，这里把结果留下，稍后写进「文件处理事件」。
     * v3.0.0 契约：compress { enabled(布尔，始终写入), status, reason?, ms?, size?, originalSize? }
     *   reason 为语义值（前端据此展示文案）：
     *     'off'       未开启压缩
     *     'webp'      前端已转成 WebP，本次跳过服务端压缩
     *     'threshold' 未达压缩阈值 / 判定不值得压缩 / 压缩未生效
     *     ''          正常压缩
     * size = 压缩后字节数（仅压缩生效时写），originalSize = 压缩前字节数。
     */
    const webpConverted = !!opts.webpMode && !opts.webpSkip;
    const skipReasonOf = (): string => (webpConverted ? 'webp' : 'threshold');
    let imageCompress: Record<string, unknown> | undefined;
    if (isImage) {
      imageCompress = { enabled: wantCompress, status: 'skipped', reason: wantCompress ? skipReasonOf() : 'off', originalSize };
    } else if (!isVideo && !isAudio) {
      // 其它类型（文档 / 压缩包等）本来就不参与压缩：照样写一条，保证 enabled 恒为布尔
      imageCompress = { enabled: false, status: 'skipped', reason: 'off' };
    } else if (!wantCompress) {
      // 视频 / 音频：开启压缩时结果由后台队列补写，这里只在关闭时记一条
      imageCompress = { enabled: false, status: 'skipped', reason: 'off' };
    }
    if (wantCompress && isImage) {
      const c0 = Date.now();
      if (size > COMPRESS_MAX_BYTES) {
        imageCompress = { enabled: true, status: 'skipped', reason: 'threshold', originalSize };
        console.log(`[upload] 跳过压缩：文件 ${(size / 1024 / 1024).toFixed(1)}MB 超过压缩上限`);
      } else if (srcPath) {
        const r = await compressFile(srcPath, mime, srcExt, compressPercent);
        imageCompress = r.compressed
          ? { enabled: true, status: 'done', reason: '', ms: Date.now() - c0, size: r.size, originalSize }
          : { enabled: true, status: 'skipped', reason: skipReasonOf(), ms: Date.now() - c0, originalSize };
        if (r.compressed) {
          srcPath = r.path;
          size = r.size;
          mime = r.mime || mime;
          if (r.ext) originalName = originalName.replace(/\.[^.]+$/, '') + r.ext;
          appLog.info(
            'upload',
            `已压缩（流式）：${originalSize}B → ${size}B（${Math.round((1 - size / Math.max(1, originalSize)) * 100)}%）`,
            `${originalName} ｜ 期望 ${compressPercent}%`,
            uploadIp,
          );
        } else if (r.reason) {
          appLog.info('upload', `跳过压缩：${r.reason}`, originalName, uploadIp);
        }
      } else {
        const r = await compressMedia(buffer, mime, srcExt, compressPercent);
        imageCompress = r.compressed
          ? { enabled: true, status: 'done', reason: '', ms: Date.now() - c0, size: r.buffer.length, originalSize }
          : { enabled: true, status: 'skipped', reason: skipReasonOf(), ms: Date.now() - c0, originalSize };
        if (r.compressed) {
          const before = buffer.length;
          buffer = r.buffer;
          size = buffer.length;
          mime = r.mime || mime;
          if (r.ext) originalName = originalName.replace(/\.[^.]+$/, '') + r.ext;
          appLog.info(
            'upload',
            `已压缩：${before}B → ${buffer.length}B（${Math.round((1 - buffer.length / before) * 100)}%）`,
            `${originalName} ｜ 期望 ${compressPercent}%`,
            uploadIp,
          );
        } else if (r.reason) {
          appLog.info('upload', `跳过压缩：${r.reason}`, originalName, uploadIp);
        }
      }
    }

    /** 视频 / 音频：上传成功后由后台队列做「压缩 → 转码」（本次上传不受影响） */
    const mediaDeferred = (isVideo || isAudio) && (wantCompress || wantTranscode);

    // 尺寸（图片走 sharp）：详情页「图片尺寸」一直显示「无」就是因为这里从来没写过 metas.Width/Height。
    // 放在压缩之后读，拿到的是最终文件的真实尺寸。
    const dims = srcPath
      ? await readDimensionsFile(srcPath, mime, mime.split('/')[1] || '')
      : await readDimensions(buffer, mime, mime.split('/')[1] || '');

    const folder = await this.resolveFolder(opts.uploadFolder);
    const key = this.makeKeyFor(main, originalName, opts.uploadNameType, md5, opts.uploader);

    /*
     * 主渠道上传失败后的切换链：
     *   1) 「更多 → 设为备用库」标记的渠道（backupPool=true）组成备用库池，
     *      按轮转游标依次尝试 —— 每次上传把起点后移一位，避免总压在同一个备用库上；
     *   2) 池为空且调用方允许自动切换时，退回历史行为（全部启用渠道按 code 升序）。
     * 备份渠道（isBackup）不参与切换：备份失败只记日志，绝不反复重传。
     */
    // v2.8.9：「自动切换存储库」建立在「失败自动重试」之上——
    //   · 入口未传 autoRetry（WebDAV / API 等）→ 全局 retryEnabled && autoSwitch 决定；
    //   · 入口明确传 autoRetry=false（重试关闭）→ 不重试也不切换；
    //   · 全局切换开关关闭、重试开启 → 重试仍执行，只是不换渠道。
    const ms = await this.mediaSettings();
    const retryEnabled = opts.autoRetry === undefined ? ms.retryEnabled : opts.autoRetry;
    const allowSwitch = retryEnabled && ms.autoSwitch;
    const chain: StorageChannelInfo[] = [main];
    if (allowSwitch) {
      const pool = await prisma.channel.findMany({
        where: { enabled: true, backupPool: true, NOT: { id: main.id } },
        orderBy: { code: 'asc' },
      });
      if (pool.length) {
        const start = this.poolCursor++ % pool.length;
        const rotated = [...pool.slice(start), ...pool.slice(0, start)];
        for (const c of rotated) {
          chain.push({ id: c.id, code: c.code, name: c.name, type: c.type, config: c.config });
        }
      } else {
        const others = await prisma.channel.findMany({
          where: { enabled: true, NOT: { id: main.id } },
          orderBy: { code: 'asc' },
        });
        chain.push(...others);
      }
    }

    const startedAt = Date.now();
    let result: { remoteKey: string; remoteUrl?: string } | undefined;
    let usedChannel = main;
    let lastErr = '';
    for (const ch of chain) {
      if (ch.id !== main.id && !(await this.channelWritable(ch))) continue;
      try {
        const info = this.toChannelInfo(ch);
        result = await this.uploadToAdapter(createAdapter(info), {
          buffer,
          path: srcPath,
          size,
          mime,
          originalName,
        }, key, info, opts.uploader, instanceScope);
        usedChannel = ch;
        break;
      } catch (err) {
        lastErr = (err as Error).message || String(err);
        // 关键：渠道报错必须回传给前端（否则界面只有「上传失败」没有原因），
        // 同时写一条结构化日志，便于在后台「系统日志」里排查。
        appLog.warn(
          'upload',
          `渠道上传失败：${ch.name}（${ch.type}）${allowSwitch ? '，尝试自动切换下一个渠道' : ''}`,
          `${lastErr} ｜ key=${key} ｜ 大小=${size}B ｜ 文件=${originalName}`,
          uploadIp,
        );
      }
    }
    if (!result) {
      return {
        id: '',
        error: allowSwitch
          ? `所有可用渠道均上传失败（最后错误：${lastErr}）`
          : `存储渠道「${main.name}」上传失败：${lastErr}`,
      };
    }
    if (usedChannel.id !== main.id) {
      appLog.info('upload', `自动切换成功：${main.name} → ${usedChannel.name}（${usedChannel.type}）`, `key=${key}`, uploadIp);
    }
    appLog.info(
      'upload',
      `上传成功：${usedChannel.name}（${usedChannel.type}）`,
      `${key} ｜ ${size}B ｜ 耗时 ${Date.now() - startedAt}ms ｜ 文件=${originalName}`,
      uploadIp,
    );

    // 文件对外标识（/file/<name>）：
    //   默认用系统生成的随机 ID；S3 协议场景用客户端上传时的 Object Key，
    //   这样客户端用「自定义域名 + key」自行拼出的地址恰好就是本站的签发链接。
    /*
     * v2.8.9：组装「文件处理事件」—— 详情页在「重定向」下方单列一行展示。
     * 这里能确定的：失败次数 / 重试轮次 / 失败原因 / 自动切换到的渠道 / WebP 未转换原因 /
     * 图片的同步压缩结果。视频与音频的压缩、转码结果在后台队列完成后补写（writeProcessEvent）。
     */
    const processEvent: Record<string, unknown> = {};
    const retryRound = Math.max(0, Number(opts.retryRound) || 0);
    if (retryRound) {
      processEvent.retries = retryRound;
      processEvent.failCount = retryRound;
    }
    if (opts.failReason) processEvent.failReason = opts.failReason;
    if (usedChannel.id !== main.id) processEvent.switchedTo = usedChannel.name;
    if (imageCompress) processEvent.compress = imageCompress;
    // v3.0.0：webp { enabled, mode, status, reason? } ——
    // 前端转换成功时文件已是 webp（无 webpSkip），这里只记录 mode；
    // 转换失败 / 放弃时 webpSkip 带原因，mode 一并写入。
    const webpMode = opts.webpMode === 'lossless' || opts.webpMode === 'lossy' ? opts.webpMode : '';
    if (opts.webpSkip) {
      processEvent.webp = { enabled: true, mode: webpMode, status: 'skipped', reason: opts.webpSkip };
    } else if (webpMode) {
      processEvent.webp = { enabled: true, mode: webpMode, status: 'done' };
    }
    /*
     * v3.0.0 修复：WebP 事件只对图片文件记录 —— 之前非图片（视频/音频/文档）也带
     * webpMode 入参，会被记成「WebP 已转换」，且压缩判定把它当「已转跳过压缩」处理。
     * 现在非图片一律不写 webp 事件（压缩走 video/audio 自己的事件）。
     */
    if (!isImage) delete processEvent.webp;

    const fileId = opts.presetFileId
      ? await this.uniqueFileId(this.sanitizeFileId(opts.presetFileId))
      : this.makeFileId();
    const record = await prisma.fileRecord.create({
      data: {
        name: fileId,
        // 重命名历史：第一次的名字先写进来，之后重命名只更新 prevName（v2.3.0）
        firstName: fileId,
        prevName: '',
        originalName,
        size,
        originalSize,
        mime,
        md5,
        folder, // 逻辑分类（无指定目录时按 年份/月份 自动创建）
        uploader: opts.uploader || '',
        // 上传渠道（Default / WebDAV / API-S3 / API-Web）—— 后台文件详情里展示
        uploadSource: normalizeUploadSource(opts.uploadSource),
        ip: uploadIp,
        // v3.0.0：文件归属实例（空串 = 默认实例；越权上传已在上面回退为空串）
        instanceId: instanceScope,
        // 上传计时：开始（请求到达 / 第一片 init）→ 完成（记录落库），详情页据此算时长与速度
        uploadStartedAt: opts.uploadStartedAt || new Date(startedAt),
        uploadFinishedAt: new Date(),
        // metas 里带上归属地 + 真实尺寸（详情页「图片尺寸」读的就是这里）
        metas: JSON.stringify({
          UploadAddress: uploadAddress,
          ...(dims.width && dims.height ? { Width: dims.width, Height: dims.height } : {}),
          ...(Object.keys(processEvent).length ? { ProcessEvent: processEvent } : {}),
        }),
        // 主渠道副本与文件记录一次写入（嵌套 create = 同一事务），少一次往返
        // isPrimary 补记（v1.8.0：此前只靠「第一条副本即主副本」的隐式约定，字段一直是 false）
        copies: {
          create: {
            channelId: usedChannel.id,
            ...this.copyWriteData(result, usedChannel),
            status: 'active',
            isPrimary: true,
          },
        },
      },
    });

    /*
     * v2.8.8：视频 / 音频的「压缩 → 转码」投递到全局单通道队列。
     *
     * 此刻文件已经写进渠道、记录已经落库 —— 前端早就拿到成功响应了。
     * 后面无论 ffmpeg 跑多久、成功还是被放弃，都不会影响「文件上传成功」这个事实。
     */
    if (mediaDeferred) {
      this.deferMediaPostProcess({
        recordId: record.id,
        fileId,
        channelId: usedChannel.id,
        srcPath,
        buffer,
        mime,
        ext: srcExt,
        originalName,
        nameType: opts.uploadNameType,
        compress: wantCompress === true,
        percent: compressPercent,
        transcode: wantTranscode,
        uploader: opts.uploader || '',
        ip: uploadIp,
      });
    }

    /*
     * 以下三项都是「不影响上传结果」的收尾工作，全部丢到后台队列串行执行：
     *   1) IP 上传计数（用户管理按 IP 汇总）
     *   2) 归属地补写（缓存未命中时才会真的请求外部 API）
     *   3) 自动打标签（文件类型 / 扩展名 / 渠道简称 / 上传渠道 / 年份）
     * 上传响应立刻返回，不再等这些毫秒级甚至秒级的收尾动作。
     */
    this.enqueueBackground(() => this.touchIp(uploadIp, uploadAddress));
    if (uploadIp && !uploadAddress) {
      this.enqueueBackground(async () => {
        const addr = await this.resolveAddress(uploadIp);
        if (!addr) return;
        // 用最新的 metas 合并写回，避免覆盖期间其它字段的改动
        const cur = await prisma.fileRecord.findUnique({ where: { id: record.id }, select: { metas: true } });
        if (!cur) return;
        let metas: Record<string, unknown> = {};
        try {
          metas = JSON.parse(cur.metas || '{}');
        } catch {
          metas = {};
        }
        await prisma.fileRecord.update({
          where: { id: record.id },
          data: { metas: JSON.stringify({ ...metas, UploadAddress: addr }) },
        });
        await this.touchIp(uploadIp, addr);
      });
    }
    this.enqueueTagTask(() =>
      this.autoTag(record.id, {
        originalName,
        mime,
        /*
         * v1.0.2：`{channelName}` 的取值口径。
         *
         * 只要本次允许「主备双写」（opts.backup !== false，且账户 / 全局确实配了备渠道），
         * 同一份文件在两条渠道里都存在 —— 此时标签里的渠道名**固定取主渠道**，
         * 不再跟随 `usedChannel`（它会在主渠道报错时变成备渠道），否则同一批文件
         * 会出现「一半标主渠道、一半标备渠道」的标签漂移。
         *
         * 明确关闭备份（opts.backup === false）时只有一条渠道落库，
         * 就按实际落库的渠道打标签，主渠道失败自动切换也不会标错。
         */
        channelType: opts.backup === false ? usedChannel.type : main.type,
        uploadSource: opts.uploadSource,
        // v3.0.0：标签按实例隔离（与文件同实例）
        instanceId: instanceScope,
        // v1.0.0：标签同时按用户隔离 —— 归属到本次上传者
        owner: record.uploader,
        // v1.0.1：调用方指定标签；`#话题` 的提取改由后台「自定义规则」承担（默认规则即原逻辑）
        extraTags: [...(opts.extraTags || [])],
        // v1.0.1：图片 / 视频宽高，供 {width} / {height} 占位符使用
        width: dims.width,
        height: dims.height,
      }),
    );

    // 备份渠道异步上传：进入「低优先级队列」—— 不阻塞响应，且在主渠道上传期间让路，
    // 保证上传速度优先；失败标 failed，可后台补备份。
    // 前端「上传设置 → 是否备份」关闭（opts.backup === false）时跳过本次备份；
    // 备份渠道与本次实际使用的主渠道 ID 相同时也不备份。
    // 备份渠道统一由 StorageChannelService 解析：
    //   调用方显式指定（API 的 backup 参数）→ Token 配置 → 账户指定 → 全局备份渠道
    // 解析本身（查开关 + 查渠道）也放到后台队列执行，响应路径上不再多两次数据库查询。
    if (opts.backup !== false) {
      const payload: UploadInput = { buffer, path: srcPath, size, mime, originalName };
      this.enqueueBackground(async () => {
        if (!(await this.backupEnabled())) return;
        const backup = await this.resolveBackupChannel({
          explicitId: opts.backupChannelId,
          uploader: opts.ignoreUploaderChannel ? undefined : opts.uploader,
          tokenId: opts.tokenId,
        });
        if (!backup || backup.id === usedChannel.id) return;
        await this.enqueueLowPriority(async () => {
          await this.backupUpload(record.id, payload, key, backup, opts.uploader);
        });
      });
    }

    return { id: fileId, finalName: originalName };
  }

  /**
   * 「登记文件」（v2.8.8）：把**已经存在于其他渠道**的文件补一条记录进库，不需要上传。
   *
   * 用途：文件早就在对象存储 / 图床上了，只想让 GoHub 有一份可管理、可签发的记录
   * （外链、标签、分类、详情都一样），省掉「再传一遍」的流量与时间。
   *
   * 探测策略（全部有超时，绝不长时间挂住请求）：
   *   1) HEAD 拿 Content-Type / Content-Length；
   *   2) 拿不到就发 Range: bytes=0-0 的 GET，从 Content-Range 里读总长度；
   *   3) MD5 需要完整内容 —— 只在体积小于 RECORD_MD5_MAX_MB（默认 256MB）时下载计算，
   *      超过或失败一律留空（需求明确允许留空）。
   */
  async registerFile(input: {
    sourceUrl: string;
    originalName?: string;
    /** v2.8.9：源地址没有扩展名时的补充（可带点/不带点） */
    extension?: string;
    channelId: string;
    folder?: string;
    note?: string;
    uploader?: string;
    ip?: string;
    /** v3.0.0：归属实例 ID（空串 = 默认实例；同样做成员归属校验） */
    instanceId?: string;
  }): Promise<{
    id?: string;
    error?: string;
    info?: { name: string; size: number; mime: string; md5: string; channel: string };
  }> {
    const rawUrl = String(input.sourceUrl || '').trim();
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { error: '文件源地址格式不正确（需以 http:// 或 https:// 开头）' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { error: '文件源地址只支持 http / https 协议' };
    }

    // 渠道 ID 既接受主键 id，也接受 6 位 code（前端下拉传的是 code）
    const channelKey = String(input.channelId || '');
    if (!channelKey) return { error: '请选择存储渠道' };
    const ch = await prisma.channel.findFirst({
      where: { OR: [{ id: channelKey }, { code: channelKey }] },
    });
    if (!ch) {
      appLog.warn('record', '登记失败：所选存储渠道不存在', `channelId=${channelKey}`, String(input.ip || ''));
      return { error: '所选存储渠道不存在' };
    }
    if (!ch.enabled) {
      appLog.warn('record', `登记失败：存储渠道「${ch.name}」已停用`, `channelId=${channelKey}`, String(input.ip || ''));
      return { error: `存储渠道「${ch.name}」已停用，请先启用或换一个渠道` };
    }

    // ---- 1) 探测类型与大小 ----
    let contentType = '';
    let contentLength = 0;
    let reachable = false;
    const timeout = () => AbortSignal.timeout(20000);
    try {
      const head = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: timeout() });
      if (head.ok) {
        reachable = true;
        contentType = head.headers.get('content-type') || '';
        contentLength = Number(head.headers.get('content-length') || 0) || 0;
      }
    } catch {
      /* 有些源站不支持 HEAD，下面用 Range 探测 */
    }
    if (!contentLength || !contentType) {
      try {
        const probe = await fetch(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: timeout() });
        if (probe.ok || probe.status === 206) {
          reachable = true;
          contentType = contentType || probe.headers.get('content-type') || '';
          const range = probe.headers.get('content-range') || '';
          const total = Number(range.split('/')[1]) || 0;
          if (!contentLength) contentLength = total || 0;
        }
        await probe.body?.cancel().catch(() => undefined);
      } catch {
        /* 下面统一判可达性 */
      }
    }
    if (!reachable) {
      appLog.warn(
        'record',
        '登记失败：源地址不可访问',
        `源=${rawUrl} ｜ 渠道=${ch.name}`,
        String(input.ip || ''),
      );
      return { error: '无法访问该文件源地址（超时或被拒绝），请确认地址可公开访问' };
    }

    const mimeClean = (contentType || '').split(';')[0].trim().toLowerCase();
    /*
     * v3.0.0：登记文件的真实文件名（优先级从高到低）
     *   ① 调用方显式传入的 originalName；
     *   ② 源地址 URL 路径最后一段（decodeURIComponent、去掉查询串）—— 且必须是「像文件名的」；
     *   ③ 发一次 HEAD（失败退 GET 前 4KB）读 Content-Disposition 的 filename；
     *   ④ 都拿不到 → 登记文件-<13 位毫秒时间戳>。
     * 全过程 try/catch + 5 秒超时：取名失败绝不能让登记失败。
     */
    let originalName = this.sanitizeRecordName(String(input.originalName || '').trim());
    let nameSource = originalName ? 'input' : '';
    if (!originalName) {
      const resolved = await this.resolveRecordOriginalName(url);
      originalName = resolved.name;
      nameSource = resolved.from;
    }

    /*
     * v2.8.9：扩展名解析优先级
     *   1) 源地址最后一段自带扩展名（如 immich 之外的常规图床）；
     *   2) v3.0.0：文件名自带扩展名（可能来自 Content-Disposition，比 URL 更可信）；
     *   3) 源地址没有扩展名时，用「扩展名」输入框补的值（可带点可不带点）；
     *   4) 都没有 → 按响应头 MIME 推断；再不行用 bin。
     * 注意：immich 这类 /api/assets/{id}/original 链接没有扩展名，必须靠第 2/3 步。
     */
    const urlBase = (() => {
      const raw = url.pathname.split('/').filter(Boolean).pop() || '';
      try {
        return decodeURIComponent(raw);
      } catch {
        /* 残缺的百分号编码：按原样用，绝不因为一个 % 让整次登记失败 */
        return raw;
      }
    })();
    const urlExt = /\.([A-Za-z0-9]{1,10})$/.test(urlBase) ? String(urlBase.split('.').pop() || '').toLowerCase() : '';
    const nameExt = /\.([A-Za-z0-9]{1,10})$/.test(originalName)
      ? String(originalName.split('.').pop() || '').toLowerCase()
      : '';
    const givenExt = String(input.extension || '')
      .trim()
      .replace(/^\.+/, '')
      .toLowerCase();
    const validGivenExt = /^[a-z0-9]{1,10}$/.test(givenExt) ? givenExt : '';
    let ext = urlExt || nameExt || validGivenExt;
    const MIME_EXT: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/bmp': 'bmp',
      'image/avif': 'avif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
      'audio/ogg': 'ogg',
    };
    if (!ext) {
      ext = MIME_EXT[mimeClean] || 'bin';
    }
    // 名称没有扩展名（immich 链接常见）→ 用解析出的扩展名补全，否则 /file 无法判断类型
    if (!/\.[A-Za-z0-9]{1,10}$/.test(originalName)) originalName = `${originalName}.${ext}`;
    const mime = mimeClean || UploadService.EXT_MIME[ext] || 'application/octet-stream';

    // ---- 2) MD5（可选，失败留空）----
    const md5Cap = Math.max(1, Number(process.env.RECORD_MD5_MAX_MB || 256)) * 1024 * 1024;
    let md5 = '';
    let size = contentLength;
    let sampleBuffer: Buffer | undefined;
    const canHash = contentLength > 0 ? contentLength <= md5Cap : true;
    if (canHash) {
      try {
        const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
        if (res.ok && res.body) {
          const hash = createHash('md5');
          let total = 0;
          let over = false;
          // v2.8.9：顺手留一份 ≤8MB 的样本，用来读图片/视频尺寸（大文件跳过，不额外下载）
          const sampleLimit = 8 * 1024 * 1024;
          const chunks: Buffer[] = [];
          let sampled = 0;
          for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
            total += chunk.length;
            if (total > md5Cap) {
              over = true;
              break;
            }
            hash.update(chunk);
            if (sampled <= sampleLimit) {
              chunks.push(Buffer.from(chunk));
              sampled += chunk.length;
            }
          }
          if (over) {
            md5 = '';
            if (!size) size = 0;
          } else {
            md5 = hash.digest('hex');
            if (!size) size = total;
            if (sampled > 0 && sampled <= sampleLimit) sampleBuffer = Buffer.concat(chunks);
          }
        }
      } catch {
        md5 = '';
      }
    }
    if (!size) size = 0;

    // ---- 3) 落库 ----
    const uploadIp = String(input.ip || '');
    const uploadAddress = await this.cachedAddress(uploadIp);
    // v3.0.0：实例归属校验（同上传链路：不是成员则回退默认实例）
    const instanceScope = await this.resolveInstanceScope(input.instanceId, input.uploader, uploadIp);
    /*
     * v2.9.0：登记文件的分类兜底 —— 留空时落到「登记文件/年/月」，
     * 与普通上传的「年/月」区分开，便于在文件管理里单独归档。
     */
    const folderInput = String(input.folder || '').trim();
    let folder: string;
    if (folderInput) {
      folder = await this.resolveFolder(folderInput);
    } else {
      const now = new Date();
      folder = `登记文件/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    const fileId = await this.uniqueFileId(this.makeFileId());
    const now = new Date();
    /*
     * v3.0.0：登记文件的外链规则
     *   · 提交时按渠道类型解析三段域名：内网通信域名 → 公开访问域名 → Endpoint/服务地址，
     *     **逐段比对主机（host + 端口）**，命中哪一段就把这一段从源地址里剔除，
     *     剩下的路径就是 remoteKey；某一段的键为空只是跳过，继续比下一段。
     *   · 三段都匹配不上 → 直接登记失败（说明这个地址不属于所选渠道，登记了也加载不出来）；
     *   · remoteUrl 恒为空：读取时用渠道「当前」的实际加载域名拼路径，
     *     渠道域名一变，所有登记文件的外链自动跟着变。
     * 说明：读取侧（recordLoadOrigin）仍只认 internalDomain / publicDomain / apiUrl|endpoint，
     *       见 common/record-link.ts —— 两边要一起改才能让 immich / webdav 的直链也走渠道域名。
     */
    let recordCfg: Record<string, unknown> = {};
    try {
      recordCfg = (this.channels.decryptConfig(ch.type, ch.config) || {}) as Record<string, unknown>;
    } catch {
      recordCfg = {};
    }
    const candidates = this.channelDomainCandidates(ch.type, recordCfg);
    let domainHit = this.matchChannelSource(candidates, url);
    /*
     * v3.0.0（R10）：本地存储渠道没有「渠道域名」—— 它的访问域名就是外链签发域名 /
     * 当前访问域名。这类地址直接取 URL 的 path 作为固化地址即可（域名一律不落库）。
     */
    if (!domainHit && ch.type === 'local') {
      const rest = `${url.pathname.replace(/^\/+/, '')}${url.search || ''}`;
      if (rest) domainHit = { field: 'signOrigin', host: url.host.toLowerCase(), rest };
    }
    if (!domainHit) {
      appLog.warn(
        'record',
        `登记失败：源地址与渠道域名不匹配（${ch.name}）`,
        `源=${rawUrl} ｜ 渠道域名候选=${candidates.map((c) => `${c.field}=${c.host}`).join(' , ') || '无'}`,
        String(input.ip || ''),
      );
      return {
        error:
          `源地址不属于存储渠道「${ch.name}」：请确认地址的域名（含端口）与该渠道的「内网通信域名 / 公开访问域名 / Endpoint（服务地址）」之一一致`,
      };
    }
    /*
     * v3.0.0（第三轮）：objectKey 保留查询串（remoteKey 会被原样拼回外链）。
     * 只解码路径部分 —— 查询串里的 %26 / %3D 等一旦解码就会改变语义。
     */
    const qIdx = domainHit.rest.indexOf('?');
    const restPathRaw = qIdx === -1 ? domainHit.rest : domainHit.rest.slice(0, qIdx);
    const restQuery = qIdx === -1 ? '' : domainHit.rest.slice(qIdx);
    let restPathDecoded = restPathRaw;
    try {
      restPathDecoded = decodeURIComponent(restPathRaw);
    } catch {
      /* 残缺的百分号编码：按原样用 */
    }
    const objectKey = `${restPathDecoded}${restQuery}`;
    const dims = sampleBuffer
      ? await readDimensions(sampleBuffer, mime, ext)
      : { width: undefined, height: undefined };
    const record = await prisma.fileRecord.create({
      data: {
        name: fileId,
        firstName: fileId,
        prevName: '',
        originalName,
        size,
        originalSize: size,
        mime,
        md5,
        folder,
        uploader: String(input.uploader || ''),
        uploadSource: 'Record',
        ip: uploadIp,
        note: String(input.note || '').slice(0, 2000),
        // v3.0.0：登记文件同样归属到指定实例（空串 = 默认实例）
        instanceId: instanceScope,
        uploadStartedAt: now,
        uploadFinishedAt: now,
        metas: JSON.stringify({
          UploadAddress: uploadAddress,
          Registered: true,
          SourceUrl: rawUrl,
          SourceOnChannel: true,
          SourceHostField: domainHit.field,
          RecordPath: domainHit.rest,
          ...(dims.width && dims.height ? { Width: dims.width, Height: dims.height } : {}),
        }),
        /*
         * v3.0.0（R10）：登记文件同样遵循「域名不落库 + 固化地址落库」——
         *   objectPath = 剔除域名后的路径；urlQuery = 文件级查询串（如 immich 的 key/size/edited）。
         * remoteUrl 只留给「不属于任何渠道」的外部地址，这里为空。
         * remoteKey 保持「路径」，便于在渠道视角里看出文件位置。
         * 删除登记文件时 removeFile 不会去删源站对象（见其 Record 分支）。
         */
        copies: {
          create: {
            channelId: ch.id,
            remoteKey: restPathDecoded,
            remoteUrl: '',
            objectPath: restPathDecoded,
            urlQuery: restQuery.replace(/^\?/, ''),
            metas: JSON.stringify({ snap: { channelType: ch.type, registered: true, capturedAt: now.toISOString() } }),
            status: 'active',
            isPrimary: true,
          },
        },
      },
    });
    this.enqueueTagTask(() =>
      this.autoTag(record.id, {
        originalName,
        mime,
        channelType: ch.type,
        uploadSource: 'Record',
        // v3.0.0：标签按实例隔离（与登记文件同实例）
        instanceId: instanceScope,
        // v1.0.0：标签同时按用户隔离 —— 归属到登记人
        owner: record.uploader,
        // v1.0.1：宽高供 {width} / {height} 占位符使用
        width: dims.width,
        height: dims.height,
      }),
    );
    this.enqueueBackground(() => this.touchIp(uploadIp, uploadAddress));

    appLog.info(
      'record',
      `登记文件成功：${originalName}`,
      `渠道=${ch.name} ｜ ${size}B ｜ mime=${mime} ｜ md5=${md5 || '未获取'} ｜ 匹配域名=${domainHit.field}(${domainHit.host}) ｜ 路径=${domainHit.rest} ｜ 文件名来源=${nameSource} ｜ 分类=${folder}${folderInput ? '' : '（默认 登记文件/年/月）'} ｜ 源=${rawUrl}`,
      uploadIp,
    );
    return { id: fileId, info: { name: originalName, size, mime, md5, channel: ch.name } };
  }

  /**
   * v3.0.0：按渠道类型解析「内网通信域名 → 公开访问域名 → Endpoint/服务地址」三段候选。
   *
   * 各渠道历史命名不统一，统一在这里收敛（键名映射）：
   *   · 内网：internalDomain
   *   · 公开：publicDomain；immich 的公开访问域名键是 domain（兼容）
   *   · 端点：endpoint(minio/s3/cos/aliyun/r2)、apiUrl(easyimages/lsky/custom)、
   *           baseUri(webdav)、serverUrl(immich)
   * 某一段的键为空只是跳过，继续下一段 —— 不会因为某个键为空导致整体匹配失败。
   * 最后再用「配置里任意 http(s) 地址」兜底，避免自定义渠道的新字段漏判。
   */
  private channelDomainCandidates(type: string, cfg: Record<string, unknown>): { field: string; host: string }[] {
    const out: { field: string; host: string }[] = [];
    const seen = new Set<string>();
    const push = (field: string, raw: unknown) => {
      const host = UploadService.domainHostOf(raw);
      if (!host || seen.has(host)) return;
      seen.add(host);
      out.push({ field, host });
    };

    push('internalDomain', cfg.internalDomain);
    push('publicDomain', cfg.publicDomain);
    if (type === 'immich') push('domain', cfg.domain);

    const endpointKey: Record<string, string> = {
      minio: 'endpoint',
      r2: 'endpoint',
      s3: 'endpoint',
      cos: 'endpoint',
      aliyun: 'endpoint',
      easyimages: 'apiUrl',
      lsky: 'apiUrl',
      custom: 'apiUrl',
      webdav: 'baseUri',
      immich: 'serverUrl',
    };
    const key = endpointKey[type];
    if (key) push(key, cfg[key]);

    // 兜底：其它任意 http(s) 地址字段（含未来新增渠道），保持旧行为不漏判
    for (const [field, value] of Object.entries(cfg)) {
      if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) push(field, value);
    }
    return out;
  }

  /** 配置值 → 主机（host + 端口，小写）；支持省略协议的写法（如 192.168.1.5:2283） */
  private static domainHostOf(raw: unknown): string {
    const v = String(raw ?? '').trim();
    if (!v) return '';
    const abs = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
    try {
      return new URL(abs).host.toLowerCase();
    } catch {
      return '';
    }
  }

  /**
   * 源地址 → 命中的域名段 + 剩余路径（remoteKey）。
   * 只比「主机（host + 端口）」，协议 / 大小写 / 末尾斜杠差异都不影响；
   * 三段都未命中返回 null（调用方据此判定「地址不属于该渠道」）。
   */
  /**
   * 源地址 → 命中的渠道域名段 + 剩余部分。
   * v3.0.0（第三轮）：剩余部分从「仅 pathname」改为「pathname + 查询串」——
   * 形如 `.../api/thumbnail?key=abc&size=preview&c=1&edited=true` 的地址，
   * 丢掉 `?...` 后拼出来的外链会指向另一张图 / 404（表现为「地址被截断、识别不全」）。
   */
  private matchChannelSource(
    candidates: { field: string; host: string }[],
    sourceUrl: URL,
  ): { field: string; host: string; rest: string } | null {
    const target = sourceUrl.host.toLowerCase();
    const hit = candidates.find((c) => c.host === target);
    if (!hit) return null;
    const rest = `${sourceUrl.pathname.replace(/^\/+/, '')}${sourceUrl.search || ''}`;
    if (!rest) return null;
    return { ...hit, rest };
  }

  /**
   * v3.0.0：登记文件的文件名清洗 —— 去控制字符与路径分隔符 / 文件名非法字符，
   * 压缩空白，去前导点（避免隐藏文件与 ../ 穿越），长度上限 200。
   */
  private sanitizeRecordName(raw: string): string {
    return String(raw || '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .slice(0, 200);
  }

  /**
   * URL 最后一段是否「像个文件名」。没有扩展名、且是 download / original 这类
   * 通用动作词时不算 —— 这种地址的真实文件名只能从 Content-Disposition 拿。
   */
  private looksLikeFileName(seg: string): boolean {
    const s = String(seg || '').trim();
    if (!s) return false;
    if (/\.[A-Za-z0-9]{1,10}$/.test(s)) return true;
    const generic = new Set([
      'original', 'download', 'downloads', 'file', 'files', 'image', 'photo', 'picture',
      'asset', 'assets', 'media', 'content', 'data', 'raw', 'view', 'preview', 'thumb',
      'thumbnail', 'get', 'api', 'render',
    ]);
    if (generic.has(s.toLowerCase())) return false;
    return s.length >= 3;
  }

  /**
   * v3.0.0：读 Content-Disposition 的 filename（5 秒超时，任何异常都返回空串）。
   * 先 HEAD；HEAD 被拒或不带该头时，用 Range GET 只读响应头，读完立刻取消 body。
   */
  private async fetchDispositionName(url: URL): Promise<string> {
    const signal = AbortSignal.timeout(5000);
    try {
      const head = await fetch(url, { method: 'HEAD', redirect: 'follow', signal });
      let raw = head.headers.get('content-disposition') || '';
      if (!raw) {
        try {
          const get = await fetch(url, { headers: { Range: 'bytes=0-4095' }, redirect: 'follow', signal });
          raw = get.headers.get('content-disposition') || '';
          await get.body?.cancel().catch(() => undefined);
        } catch {
          /* GET 探测失败：按没有文件名处理 */
        }
      }
      return UploadService.parseDispositionFilename(raw);
    } catch {
      return '';
    }
  }

  /** 从 Content-Disposition 里取文件名（支持 filename* 的 RFC 5987 写法） */
  private static parseDispositionFilename(header: string): string {
    const raw = String(header || '');
    if (!raw) return '';
    const star = /filename\*\s*=\s*([^;]+)/i.exec(raw);
    if (star) {
      const v = star[1].trim().replace(/^"|"$/g, '');
      const m = /^[^']*'[^']*'(.*)$/.exec(v);
      const text = (m ? m[1] : v).trim();
      try {
        return decodeURIComponent(text);
      } catch {
        return text;
      }
    }
    const plain = /filename\s*=\s*("[^"]*"|[^;]+)/i.exec(raw);
    if (!plain) return '';
    const v = plain[1].trim().replace(/^"|"$/g, '').trim();
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }

  /**
   * v3.0.0：登记文件的真实文件名解析（任何异常都不能让登记失败）。
   * 顺序：URL 最后一段 → Content-Disposition 的 filename → 登记文件-<13 位毫秒时间戳>。
   */
  private async resolveRecordOriginalName(url: URL): Promise<{ name: string; from: string }> {
    let lastSeg = url.pathname.split('/').filter(Boolean).pop() || '';
    try {
      lastSeg = decodeURIComponent(lastSeg);
    } catch {
      /* 残缺的百分号编码：按原样用 */
    }
    const fromUrl = this.sanitizeRecordName(lastSeg);
    if (this.looksLikeFileName(fromUrl)) return { name: fromUrl, from: 'url' };
    /*
     * v3.0.0（第三轮）：路径段只是动作词（thumbnail / preview / original…）时，
     * 真实文件名往往在查询参数里，如 `.../api/thumbnail?key=2026/abc.webp&size=preview`。
     * 逐个参数值取最后一段试一次，能认出文件名就用它 —— 否则只能落到「登记文件-时间戳」。
     */
    for (const val of url.searchParams.values()) {
      const seg = String(val || '').split('/').filter(Boolean).pop() || '';
      const cleaned = this.sanitizeRecordName(seg);
      if (this.looksLikeFileName(cleaned)) return { name: cleaned, from: 'query' };
    }
    const fromHeader = this.sanitizeRecordName(await this.fetchDispositionName(url).catch(() => ''));
    if (fromHeader) return { name: fromHeader, from: 'header' };
    return { name: `登记文件-${Date.now()}`, from: 'fallback' };
  }

  private async backupUpload(
    fileId: string,
    file: UploadInput,
    key: string,
    backup: { id: string; name: string; type: string; config: string },
    owner?: string,
  ) {
    await prisma.fileCopy.upsert({
      where: { fileId_channelId: { fileId, channelId: backup.id } },
      update: { status: 'pending' },
      create: { fileId, channelId: backup.id, remoteKey: '', remoteUrl: '', status: 'pending' },
    });
    try {
      const info = this.toChannelInfo(backup);
      const adapter = createAdapter(info);
      const t0 = Date.now();
      // v3.0.0：备份落盘同样按文件归属实例分段（仅本地备份渠道生效）
      const rec4inst = await prisma.fileRecord.findUnique({ where: { id: fileId }, select: { instanceId: true } });
      const result = await this.uploadToAdapter(adapter, file, key, info, owner, rec4inst?.instanceId || '');
      await prisma.fileCopy.update({
        where: { fileId_channelId: { fileId, channelId: backup.id } },
        data: { ...this.copyWriteData(result, backup), status: 'active' },
      });
      appLog.info(
        'backup',
        `备份完成：${backup.name}（${backup.type}）`,
        `${key} ｜ ${file.size || file.buffer.length}B ｜ 耗时 ${Date.now() - t0}ms（低优先级，主渠道上传期间自动让路）`,
      );
    } catch (err) {
      appLog.error('backup', `备份渠道写入失败：${backup.name}（${backup.type}）`, `${(err as Error).message} ｜ key=${key}`);
      await prisma.fileCopy.update({
        where: { fileId_channelId: { fileId, channelId: backup.id } },
        data: { status: 'failed', metas: JSON.stringify({ error: (err as Error).message }) },
      });
    }
  }

  /**
   * 批量补备份（管理后台工具 / 文件管理「一键备份所有文件」批量操作）。
   * 入参既接受文件主键 id，也接受对外 File_ID（name）—— 前端文件列表里只有 name。
   * 已有备份的文件跳过并计入 skipped。
   */
  async rebackup(fileIds: string[]): Promise<{ ok: number; fail: number; skipped: number; total: number }> {
    let ok = 0;
    let fail = 0;
    let skipped = 0;
    const keys = (fileIds || []).filter(Boolean);
    const records = await prisma.fileRecord.findMany({
      where: { OR: [{ id: { in: keys } }, { name: { in: keys } }] },
      include: { copies: true },
    });
    // 备份渠道按「文件所属用户」解析 —— 用户管理里为该账户指定了备份渠道就用它，
    // 没指定则回退到后台「上传设置」里的全局备份渠道。
    const cache = new Map<string, StorageChannelInfo | null>();
    const backupFor = async (uploader?: string) => {
      const k = String(uploader || '');
      if (!cache.has(k)) cache.set(k, await this.resolveBackupChannel({ uploader: k || undefined }));
      return cache.get(k) ?? null;
    };
    for (const rec of records) {
      const backup = await backupFor(rec.uploader);
      if (!backup) {
        fail += 1;
        continue;
      }
      // 低优先级：等主渠道上传空闲后才拉取 + 写入，避免影响上传速度
      const outcome = await this.enqueueLowPriority<'ok' | 'fail' | 'skipped'>(async () => {
        if (!rec.copies.some((c) => c.status === 'active' && c.remoteKey)) return 'fail';
        // 已在备份渠道有 active 副本 → 跳过（不计入成功）
        if (rec.copies.some((c) => c.channelId === backup.id && c.status === 'active')) return 'skipped';
        try {
          await this.backupSingleFromMain(rec, backup);
          return 'ok';
        } catch (err) {
          console.error('[rebackup] 补备份失败:', rec.name, (err as Error).message);
          return 'fail';
        }
      });
      if (outcome === 'ok') ok += 1;
      else if (outcome === 'skipped') skipped += 1;
      else fail += 1;
    }
    return { ok, fail, skipped, total: records.length };
  }

  /**
   * 删除文件：先清「各渠道远端副本」，再删库记录（copies 随级联删除）。
   *
   * 供「文件管理 → 删除」与「S3 协议 DELETE /s3/<bucket>/<key>」共用 ——
   * 早期这段逻辑只写在 ManageController 的私有方法里，S3 通道无法复用，
   * 第三方客户端（插件 / 脚本）的删除请求永远失败。
   *
   * 远端删除失败**不阻断**流程（只记日志后继续删库）：否则残留记录会长期挂在
   * 文件列表里、点开却是死链，比"远端多留一个孤儿对象"更糟。
   */
  /**
   * 软删除：标记进回收站（status='deleted' + deletedAt），**不动任何远端副本**。
   * 恢复（restoreFile）即原样回到正常列表；只有回收站里的「彻底删除」才走 removeFile。
   */
  async softDeleteFile(id: string, name = ''): Promise<void> {
    await prisma.fileRecord.update({
      where: { id },
      data: { status: 'deleted', deletedAt: new Date() },
    });
    appLog.info('upload', `移入回收站：${name || id}`);
  }

  /** 从回收站恢复：清掉标记，远端副本从未被删，无需任何补偿动作 */
  async restoreFile(id: string, name = ''): Promise<void> {
    await prisma.fileRecord.update({
      where: { id },
      data: { status: 'active', deletedAt: null },
    });
    appLog.info('upload', `从回收站恢复：${name || id}`);
  }

  /**
   * 彻底删除：先删各渠道远端副本（远端失败不阻断，但记录日志），再删库记录。
   * 入口：回收站里的「彻底删除」。
   *
   * 实现已收敛到这一处 —— 与「S3 协议 DELETE /s3/<bucket>/<key>」
   * 通道共用同一套逻辑，避免两处实现各自漂移（早前 S3 通道就是因为拿不到这段逻辑，
   * 删除请求一律 404，第三方插件只能"传得上、删不掉"）。
   */
  /**
   * v3.0.0（R10）：去重命中时克隆记录与副本（方案 A）。
   *
   * 克隆什么：内容元数据 + 全部 active 副本行（同 remoteKey / objectPath，指向同一对象）。
   * 不克隆什么：访问量、评分、等级、备注、外链密码/限时/重定向、重命名历史 ——
   * 这些属于「个人使用状态」，必须归零重来，否则会与原主串味。
   */
  private async cloneDedupRecord(
    sourceName: string,
    opts: { uploader?: string; uploadSource?: string; instanceId?: string },
    ip: string,
  ): Promise<string> {
    const src = await prisma.fileRecord.findUnique({
      where: { name: sourceName },
      include: { copies: true },
    });
    if (!src) return sourceName;
    const fileId = this.makeFileId();
    const copies = src.copies
      .filter((c) => c.status === 'active' || c.isPrimary)
      .map((c) => ({
        channelId: c.channelId,
        remoteKey: c.remoteKey,
        remoteUrl: c.remoteUrl,
        objectPath: c.objectPath,
        urlQuery: c.urlQuery,
        metas: c.metas,
        status: c.status === 'failed' ? 'failed' : 'active',
        isPrimary: c.isPrimary,
      }));
    try {
      const created = await prisma.fileRecord.create({
        data: {
          name: fileId,
          firstName: fileId,
          prevName: '',
          originalName: src.originalName,
          size: src.size,
          originalSize: src.originalSize,
          mime: src.mime,
          hash: src.hash,
          md5: src.md5,
          folder: src.folder,
          uploader: opts.uploader || '',
          uploadSource: opts.uploadSource || 'Default',
          ip,
          instanceId: opts.instanceId || '',
          metas: src.metas,
          uploadStartedAt: new Date(),
          uploadFinishedAt: new Date(),
          copies: { create: copies },
        },
        select: { name: true },
      });
      return created.name;
    } catch (err) {
      appLog.warn('upload', `去重克隆失败，回退复用原外链`, `${(err as Error).message} ｜ 源=${sourceName}`, ip);
      return sourceName;
    }
  }

  /**
   * v3.0.0（R10）：副本落库数据。
   *
   * 只写四样东西：
   *   · remoteKey —— 渠道内标识（删除/移动用）
   *   · objectPath / urlQuery —— 固化寻址地址（域名永不落库）
   *   · metas.snap —— 配置快照（结构性字段，供日后追溯）
   *
   * 安全约束：快照字段是**白名单**，且再过滤一遍密钥类键名 ——
   * 绝不把整个 config（含 SecretKey/token/apiKey）写进明文的 metas。
   */
  private copyWriteData(
    result: { remoteKey: string; remoteUrl?: string; objectPath?: string; urlQuery?: string; metas?: Record<string, unknown> },
    channel: { type: string; config?: Record<string, string> | string },
  ) {
    const snap: Record<string, unknown> = {
      channelType: channel.type,
      capturedAt: new Date().toISOString(),
    };
    const allow = [
      'bucket', 'region', 'pathStyle', 'objectPrefix', 'nameTemplate', 'customName',
      'prefixPath', 'directory', 'albumId', 'shareLinkId', 'suffix', 'rootPath',
    ];
    let cfg: Record<string, string> = {};
    if (typeof channel.config === 'string') {
      // 兜底：密文配置或非法 JSON 都解析不出结构，快照退化为只记 channelType
      try {
        const parsed = JSON.parse(channel.config || '{}');
        if (parsed && typeof parsed === 'object') cfg = parsed as Record<string, string>;
      } catch {
        cfg = {};
      }
    } else {
      cfg = channel.config || {};
    }
    for (const k of allow) {
      const v = cfg[k];
      if (v === undefined || v === '') continue;
      if (/secret|token|password|api[-_]?key/i.test(k)) continue;
      snap[k] = v;
    }
    const metas: Record<string, unknown> = { ...(result.metas || {}), snap };
    return {
      remoteKey: result.remoteKey,
      remoteUrl: result.remoteUrl || '',
      objectPath: result.objectPath || '',
      urlQuery: result.urlQuery || '',
      metas: JSON.stringify(metas),
    };
  }

  async removeFile(id: string, name = ''): Promise<void> {
    const rec = await prisma.fileRecord.findUnique({
      where: { id },
      select: { uploadSource: true, originalName: true },
    });
    /*
     * v2.8.8：「登记文件」（uploadSource=Record）的文件本体在**别的系统/渠道**里，
     * 本系统只登记了它的地址。删记录时绝不能去删源站对象 —— 只删库。
     */
    const registered = normalizeUploadSource(rec?.uploadSource) === 'Record';
    const copies = await prisma.fileCopy.findMany({ where: { fileId: id } });
    let sharedSkipped = 0;
    for (const copy of copies) {
      if (registered) continue;
      // 没有 key 也没有 URL 的副本无从删起（例如历史脏数据），跳过避免误删渠道根目录
      if (!copy.remoteKey && !copy.remoteUrl && !copy.objectPath) continue;
      /*
       * v3.0.0（R10）：引用计数删除 —— 去重克隆出的多条记录共用同一个远端对象，
       * 只要还有任意一个「未在回收站」的记录引用它，就只删库不删远端。
       * 判定键：同渠道下 remoteKey 或 objectPath 相同（两者之一即可覆盖新老数据）。
       */
      const refKeys: Array<Record<string, string>> = [];
      if (copy.remoteKey) refKeys.push({ remoteKey: copy.remoteKey });
      if (copy.objectPath) refKeys.push({ objectPath: copy.objectPath });
      if (refKeys.length) {
        const shared = await prisma.fileCopy.count({
          where: {
            channelId: copy.channelId,
            fileId: { not: id },
            file: { status: 'active' },
            OR: refKeys,
          },
        });
        if (shared > 0) {
          sharedSkipped += 1;
          continue;
        }
      }
      const ch = await prisma.channel.findUnique({ where: { id: copy.channelId } });
      if (!ch) continue;
      try {
        const info: ChannelInfo = {
          id: ch.id,
          name: ch.name,
          type: ch.type,
          config: this.channels.decryptConfig(ch.type, ch.config),
          metas: {},
        };
        await createAdapter(info).delete(toCopyInfo(copy), info);
      } catch (err) {
        appLog.warn('upload', `远端删除失败（继续删库）${name || id}`, (err as Error).message);
      }
    }
    await prisma.fileRecord.delete({ where: { id } });
    appLog.info(
      'upload',
      `删除文件：${name || id}`,
      registered
        ? '登记文件：只删库记录，不动源站对象'
        : `远端副本 ${copies.length} 个${sharedSkipped ? `（其中 ${sharedSkipped} 个仍被其他记录/实例复用，仅删库）` : ''}`,
    );
  }

  /** 一键备份任务状态（内存态，服务重启即清零） */
  private backupAllJob: {
    running: boolean; total: number; done: number; ok: number; fail: number; startedAt: number; finishedAt: number;
  } | null = null;

  /**
   * 一键备份所有文件：找出「当前备份渠道上没有 active 副本」的文件，
   * 放入后台队列逐个补备份；已有备份的文件自动跳过。
   */
  startBackupAll(): { started: boolean; message?: string } {
    if (this.backupAllJob?.running) {
      return { started: false, message: '已有备份任务在进行中，请稍候' };
    }
    this.backupAllJob = { running: true, total: 0, done: 0, ok: 0, fail: 0, startedAt: Date.now(), finishedAt: 0 };
    void this.runBackupAll().catch((err) => {
      appLog.error('backup', `一键备份任务异常终止：${(err as Error).message}`);
      if (this.backupAllJob) {
        this.backupAllJob.running = false;
        this.backupAllJob.finishedAt = Date.now();
      }
    });
    return { started: true };
  }

  backupAllStatus() {
    return this.backupAllJob || { running: false, total: 0, done: 0, ok: 0, fail: 0, startedAt: 0, finishedAt: 0 };
  }

  private async runBackupAll() {
    const job = this.backupAllJob!;
    const records = await prisma.fileRecord.findMany({
      where: { status: 'active' },
      include: { copies: true },
      orderBy: { createdAt: 'desc' },
    });
    // 备份渠道按「文件所属用户」分别解析：
    //   用户管理里为该账户指定了备份渠道 → 用指定渠道；
    //   未指定 → 后台「上传设置」里的全局备份渠道。
    const cache = new Map<string, StorageChannelInfo | null>();
    const backupFor = async (uploader?: string) => {
      const k = String(uploader || '');
      if (!cache.has(k)) cache.set(k, await this.resolveBackupChannel({ uploader: k || undefined }));
      return cache.get(k) ?? null;
    };
    const pending: { rec: (typeof records)[number]; backup: StorageChannelInfo }[] = [];
    for (const rec of records) {
      const backup = await backupFor(rec.uploader);
      if (!backup) continue; // 该文件没有可用备份渠道，跳过
      if (rec.copies.some((c) => c.channelId === backup.id && c.status === 'active')) continue; // 已有备份
      pending.push({ rec, backup });
    }
    job.total = pending.length;
    if (!pending.length) {
      appLog.info('backup', '一键备份：所有文件均已有备份，无需处理');
      job.running = false;
      job.finishedAt = Date.now();
      return;
    }
    appLog.info('backup', `一键备份开始：共 ${pending.length} 个文件待备份`);
    for (const { rec, backup } of pending) {
      // 低优先级：逐个让路 —— 主渠道有上传任务时先让上传跑完，再补备份
      const okOne = await this.enqueueLowPriority(async () => {
        try {
          await this.backupSingleFromMain(rec, backup);
          return true;
        } catch (err) {
          appLog.error('backup', `一键备份失败：${rec.name}（${rec.originalName}）`, (err as Error).message);
          return false;
        }
      });
      if (okOne) job.ok += 1;
      else job.fail += 1;
      job.done += 1;
    }
    job.running = false;
    job.finishedAt = Date.now();
    appLog.info('backup', `一键备份完成：成功 ${job.ok}，失败 ${job.fail}，共 ${job.total}`);
  }

  /** 从主渠道副本拉回原文件并写入备份渠道 */
  private async backupSingleFromMain(
    rec: {
      id: string; name: string; mime: string; originalName: string;
      copies: { channelId: string; remoteKey: string; remoteUrl: string; status: string }[];
    },
    backup: { id: string; name: string; type: string; config: string },
  ) {
    if (rec.copies.some((c) => c.channelId === backup.id && c.status === 'active')) return; // 已有备份
    const mainCopy = rec.copies.find((c) => c.status === 'active' && c.remoteKey);
    if (!mainCopy) throw new Error('没有可用的主渠道副本');
    const mainCh = await prisma.channel.findUnique({ where: { id: mainCopy.channelId } });
    if (!mainCh) throw new Error('主渠道记录不存在');
    const mainInfo = this.toChannelInfo(mainCh);
    const mainAdapter = createAdapter(mainInfo);

    /*
     * 取源文件字节：
     *   普通渠道 → 用直链 HTTP 拉取；
     *   本地渠道 → 没有直链（buildDirectUrl 恒为 null），直接读磁盘。
     * 早期实现只走 HTTP，导致「主渠道是本地存储」时备份功能直接报「无法构造直链」。
     */
    let buf: Buffer;
    if (mainCh.type === 'local') {
      // v3.0.0：改用多根探测（内置 uploads + 自定义本地渠道 rootPath 都能取到）
      const abs = await localFileAbsOf(mainCopy.remoteKey);
      if (!abs) throw new Error('本地文件不存在，无法备份');
      buf = await fsp.readFile(abs);
    } else {
      const url = mainAdapter.buildDirectUrl(toCopyInfo(mainCopy), mainInfo);
      if (!url) throw new Error('无法构造主渠道直链');
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`源文件拉取失败 HTTP ${resp.status}`);
      buf = Buffer.from(await resp.arrayBuffer());
    }
    const info = this.toChannelInfo(backup);
    const adapter = createAdapter(info);
    const result = await adapter.upload(
      { buffer: buf, mime: rec.mime, originalName: rec.originalName },
      mainCopy.remoteKey,
      info,
    );
    await prisma.fileCopy.upsert({
      where: { fileId_channelId: { fileId: rec.id, channelId: backup.id } },
      update: { ...this.copyWriteData(result, backup), status: 'active' },
      create: { fileId: rec.id, channelId: backup.id, ...this.copyWriteData(result, backup), status: 'active' },
    });
  }

  /**
   * v1.0.3：文件在「本地存储渠道」与「第三方渠道」之间转存（转本地 / 转异地）。
   *
   * 设计约束（来自需求）：
   *   1) 只搬「实体文件 + 跟随渠道变化的数据」，**签发外链不变** ——
   *      所以 FileRecord 的 name / firstName / originalName / size / mime / folder /
   *      tags / 分类 / 上传时间 / 评分全部原样保留，只更新 FileCopy（渠道副本）。
   *   2) 源文件原封不动传到目标渠道：不压缩、不转码、不转 webp、不改文件名，
   *      沿用源副本的 remoteKey（渠道内标识），因此目标渠道的自定义命名规则不参与。
   *   3) 本地 → 第三方：上传成功后**删除本地实体文件**（需求明确要求，不可选）。
   *   4) 第三方 → 本地：由调用方选择「保留源件 / 删除源件」；
   *      **登记文件**（uploadSource=Record）一律禁止删除源件 —— 源文件不在本系统管辖范围。
   *   5) 只有「本地 ↔ 第三方」这一对方向允许；两个第三方渠道之间不支持直接转存
   *      （那属于备份而不是转存，避免把主副本指到一个和源同样脆弱的远端）。
   *
   * @returns { ok, message, channelName, direction, deletedSource }
   */
  async convertChannel(input: {
    recordId: string;
    targetChannelId: string;
    deleteSource?: boolean;
    /** 当前操作账户（只允许操作自己名下文件） */
    uploader: string;
    ip?: string;
  }): Promise<{
    ok: boolean;
    message?: string;
    channelName?: string;
    direction?: 'to-local' | 'to-remote';
    deletedSource?: boolean;
    /** v1.0.9：本次搬动的字节数与尝试次数（前端进度提示 / 日志用） */
    bytes?: number;
    attempts?: number;
    /** v1.0.9：失败时是否值得重试（源件不存在之类的错误为 false） */
    retryable?: boolean;
  }> {
    const rec = await prisma.fileRecord.findFirst({
      // recordId 兼容主键 id 与对外 File_ID（前端详情页只有 name）
      where: {
        uploader: input.uploader,
        status: 'active',
        OR: [{ id: input.recordId }, { name: input.recordId }],
      },
      include: { copies: { include: { channel: true } } },
    });
    if (!rec) return { ok: false, message: '文件不存在或无权操作' };

    const activeCopies = rec.copies.filter((c) => c.status === 'active');
    if (!activeCopies.length) return { ok: false, message: '该文件没有可用的渠道副本，无法转存' };
    const sourceCopy = activeCopies.find((c) => c.isPrimary) || activeCopies[0];
    const sourceCh = sourceCopy.channel;
    if (!sourceCh) return { ok: false, message: '源渠道记录已不存在，无法转存' };

    const targetCh = await prisma.channel.findUnique({ where: { id: input.targetChannelId } });
    if (!targetCh) return { ok: false, message: '目标渠道不存在' };
    if (!targetCh.enabled) return { ok: false, message: `目标渠道「${targetCh.name}」已停用` };
    /*
     * v1.0.4：备份渠道不能作为转存目标。
     *
     * 备份渠道在 v1.0.0 里的职责只有一条：上传成功后把同一份实体再写一份过去，
     * 主渠道出问题时兜底。它不是「可以选择的存储位置」。
     * 一旦允许转存进来，下面 ③ 的 existingTarget 分支会把那条 isPrimary=false 的
     * 备份副本改成 isPrimary=true，备份渠道就变成了业务渠道，语义被永久改变。
     */
    if (targetCh.isBackup) {
      return { ok: false, message: '「备份渠道」只做本份镜像，不能作为转存目标' };
    }
    if (targetCh.id === sourceCh.id) return { ok: false, message: '目标渠道与当前渠道相同，无需转存' };

    const isLocalType = (t: string) => t === 'local' || t === 'localfiles';
    const srcLocal = isLocalType(sourceCh.type);
    const dstLocal = isLocalType(targetCh.type);
    if (targetCh.type === 'localfiles') {
      return { ok: false, message: '「本地文件」是浏览入口，不能作为转存目标，请选择本地存储渠道' };
    }
    if (srcLocal && dstLocal) return { ok: false, message: '源渠道与目标渠道都是本地存储，无需转存' };
    if (!srcLocal && !dstLocal) {
      return { ok: false, message: '第三方渠道之间不支持直接转存，请先「转本地」再「转异地」' };
    }

    const registered = String(rec.uploadSource || '') === 'Record';
    // 本地 → 第三方：需求要求必须删掉本地实体文件；第三方 → 本地：由调用方决定
    const deleteSource = srcLocal ? true : input.deleteSource === true;
    if (deleteSource && registered) {
      return { ok: false, message: '登记文件不允许删除源件（源文件不在本系统管理范围内）' };
    }

    /*
     * ── ⓪ 先把「转存意图」写进源副本的 metas（单条 UPDATE，不进事务） ──
     *
     * v1.0.9：这一版把转存拆成「预登记 → 搬字节 → 切数据 → 清源件」四段，
     * 每一步都可以从中断处重来：
     *   · 预登记写在 file_copies.metas.__convert 里，记录目标渠道、方向、尝试次数，
     *     以及**目标渠道已经写成功的那份实体**（staged）；
     *   · 任何一步失败 → 标记 state=failed 并保留 staged，详情页按钮变「重试」；
     *   · 重试时如果目标渠道没变，直接跳过去重传，只补做数据切换；
     *   · 成功后数据切换会把 metas 整份换成「目标渠道」的快照，标记自然被清掉。
     *
     * 这样即使进程被重启、事务超时、远端断流，也不会出现「目标渠道有 177MB 孤儿、
     * 数据库还指着源渠道」的悬空状态 —— 有 staged 就能一键补完。
     */
    const prevMarker = this.readConvertMarker(sourceCopy.metas);
    const sameTarget = !!prevMarker && prevMarker.targetChannelId === targetCh.id;
    // 目标渠道换了：上一轮留在旧目标里的实体先清掉，避免养孤儿
    if (prevMarker?.staged && !sameTarget) await this.dropStagedCopy(prevMarker, input.ip);
    const marker: ConvertMarker = {
      state: 'pending',
      targetChannelId: targetCh.id,
      targetChannelName: targetCh.name,
      sourceChannelId: sourceCh.id,
      deleteSource,
      startedAt: Date.now(),
      attempts: (sameTarget ? Number(prevMarker?.attempts) || 0 : 0) + 1,
      ...(sameTarget && prevMarker?.staged ? { staged: prevMarker.staged } : {}),
    };
    try {
      await this.saveConvertMarker(sourceCopy.id, sourceCopy.metas, marker);
    } catch (err) {
      return { ok: false, message: `登记转存任务失败：${(err as Error).message}` };
    }
    /** 失败出口：把标记落成 failed（保留 staged），前端据此把按钮变成「重试」 */
    const fail = async (message: string, retryable = true) => {
      marker.state = 'failed';
      marker.lastError = message;
      await this.saveConvertMarker(sourceCopy.id, sourceCopy.metas, marker).catch(() => undefined);
      return { ok: false, message, retryable };
    };

    /* ── ① 取源文件字节（本地读磁盘 / 远端流式落临时文件，均不经过压缩转码） ── */
    const srcInfo = this.toChannelInfo(sourceCh as unknown as { id: string; code?: string; name: string; type: string; config: string });
    const srcAdapter = createAdapter(srcInfo);
    let srcPath = '';
    let tempSrc = '';
    let srcSize = 0;
    try {
      if (srcLocal) {
        const abs = await localFileAbsOf(sourceCopy.remoteKey);
        if (!abs) return await fail('本地源文件已不存在（可能被手工删除），无法转存', false);
        const st = await fsp.stat(abs).catch(() => null);
        if (!st || !st.isFile()) return await fail('本地源文件已不存在（可能被手工删除），无法转存', false);
        if (!st.size) return await fail('源文件为空，已取消转存', false);
        srcPath = abs;
        srcSize = st.size;
      } else {
        // preferInternal=true：优先走渠道配置的内网通信域名，省公网流量
        const url = srcAdapter.buildDirectUrl(toCopyInfo(sourceCopy as never), srcInfo, true);
        if (!url) return await fail('无法构造源渠道直链，转存失败');
        /*
         * v1.0.9：远端取源改成「流式下载到临时文件 + 三次重试 + 长度/MD5 校验」。
         * v1.0.8 及以前是 arrayBuffer() 一次性拉进内存 —— 170MB 的转存会同时占
         * 两三份内存，且中途断流只能整单失败。现在内存占用恒定，断流可重试。
         */
        const pulled = await this.downloadToTempFile(url, rec, input.ip);
        srcPath = pulled.path;
        tempSrc = pulled.path;
        srcSize = pulled.size;
      }
      if (!srcSize) return await fail('源文件为空，已取消转存', false);

    /*
     * ── ② 写入目标渠道（字节原样；但 key 必须按「目标渠道自己的配置」重新生成） ──
     *
     * v1.0.3 修正：这里曾经直接沿用源件的 remoteKey（`sourceCopy.remoteKey`），
     * 造成两个后果：
     *   1. 目标渠道的「自定义存储路径（objectPrefix）」「自定义文件命名（customName /
     *      nameTemplate）」全部不生效 —— local 适配器把这类 key 判定为「已展开路径」而
     *      原样落盘（这是备份链路防重复归档的保护分支，转存不该借用）；
     *   2. 第三方 key 的形态不可控：immich 是 `assetId|shareKey`、webdav 可能是远端
     *      绝对路径片段。直接当本地相对路径会绕过 `{user}/{ID}/{y}/{m}` 归档，破坏
     *      多账户 / 多实例隔离；Windows 上 `|` 还是非法字符，落盘直接 EPERM。
     *
     * 转存的语义是「用目标渠道的规则重新存一份」，所以 key 必须由 makeKeyFor 生成，
     * 与普通上传链路共用同一套前缀模板与命名策略。
     */
    const dstInfo = this.toChannelInfo(targetCh as unknown as { id: string; code?: string; name: string; type: string; config: string });
    const dstAdapter = createAdapter(dstInfo);
    /*
     * v1.0.9：上一轮已经把实体写进目标渠道（staged）且目标没变 → 不再重传，
     * 直接补做数据切换。这是「177MB 转存断在最后一步」最省事也最可靠的续跑方式。
     */
    let result: ConvertStaged | undefined = sameTarget ? prevMarker?.staged : undefined;
    if (!result) {
      const dstKey = this.makeKeyFor(
        { id: targetCh.id, code: targetCh.code, name: targetCh.name, type: targetCh.type, config: targetCh.config },
        rec.originalName,
        // 命名策略留空 = 走渠道配置；渠道未配置时按默认「原始文件名-时间戳」
        undefined,
        rec.md5 || (await this.md5OfFile(srcPath)),
        rec.uploader || '',
      );
      try {
        result = await this.uploadFileReliable(dstAdapter, srcPath, srcSize, rec, dstKey, dstInfo, {
          owner: rec.uploader || '',
          instanceId: rec.instanceId || '',
        });
      } catch (err) {
        appLog.warn(
          'channel',
          `文件转存失败：写入目标渠道「${targetCh.name}」出错`,
          `${(err as Error).message} ｜ 文件=${rec.name} ｜ 大小=${srcSize}B ｜ 第 ${marker.attempts} 次尝试`,
          input.ip,
        );
        return await fail(`写入目标渠道失败：${(err as Error).message}`);
      }
      // 实体已落目标渠道：先登记 staged，再做数据切换（切换失败也能一键续跑）
      marker.staged = result;
      try {
        await this.saveConvertMarker(sourceCopy.id, sourceCopy.metas, marker);
      } catch (err) {
        appLog.warn(
          'channel',
          '转存实体已写入，但「已暂存」标记落库失败（重试会重新上传）',
          `${(err as Error).message} ｜ 文件=${rec.name}`,
          input.ip,
        );
      }
      // 落盘型目标做一个字节数复核：完整传输优先于「看起来成功」
      if (dstLocal) {
        const dstAbs = await localFileAbsOf(result.remoteKey).catch(() => null);
        const st = dstAbs ? await fsp.stat(dstAbs).catch(() => null) : null;
        if (st && st.size !== srcSize) {
          return await fail(`目标渠道写入不完整（${st.size}/${srcSize} 字节），已中止切换`);
        }
      }
    }

    /* ── ③ 数据更新：**原地替换主副本这一条记录**，其余副本（含备份渠道）一律不动 ──
     *
     * v1.0.4 修正：旧实现是「updateMany 把所有副本 isPrimary 置 false + upsert 新增目标副本」，
     * 带来的问题：
     *   · 一次转存副本数 +1，界面上冒出「2 个备份渠道」；
     *   · updateMany 无差别扫到备份渠道副本（虽然值本来就是 false，但属于不必要的写）；
     *   · 主副本记录与新副本并存，取源/展示两侧各有各的判定口径，容易读旧渠道。
     *
     * 现在改成「主副本记录搬迁」：把主副本那条记录直接改指向目标渠道，
     * 副本总数不变，备份渠道副本一个字节都不碰。
     */
    const staged = result;
    if (!staged) return await fail('转存实体尚未就绪，请重试', true);
    /*
     * v1.0.9：改用**数组式事务**（一次性提交两条 DML），不再用 interactive transaction。
     *
     * P2028 的成因是「交互式事务从 BEGIN 到 COMMIT 超过 5 秒默认上限」——
     * 一旦数据库连接排队、行被锁，回调里只有两条 DML 也会被判超时，
     * 报错还会盖住真正的失败原因。数组式事务由驱动一次性下发并提交，
     * 没有回调等待窗口，也就没有这个 5 秒悬崖；真失败时错误信息更干净。
     */
    const writeData = { ...this.copyWriteData(staged, targetCh), status: 'active', isPrimary: true };
    // 目标渠道可能已经有副本记录（最典型：目标就是系统配置的备份渠道）
    const existingTarget = rec.copies.find((c) => c.channelId === targetCh.id && c.id !== sourceCopy.id);
    const ops: unknown[] = existingTarget
      ? [
          /*
           * 目标已有记录 → 把它升级为主副本；原主副本记录删除。
           * 这里「动」的仍然是用户主动选定的目标渠道，不是别的备份渠道；
           * 其它副本（例如另一个备份渠道）保持原样。
           */
          prisma.fileCopy.update({ where: { id: existingTarget.id }, data: writeData }),
          prisma.fileCopy.delete({ where: { id: sourceCopy.id } }),
        ]
      : [
          // 目标没有记录 → 直接改写主副本记录，不新增、不降级其它副本
          prisma.fileCopy.update({
            where: { id: sourceCopy.id },
            data: { channelId: targetCh.id, ...writeData },
          }),
        ];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await prisma.$transaction(ops as any);
    } catch (err) {
      const msg = `切换文件渠道数据失败：${(err as Error).message}`;
      appLog.error('channel', '文件转存：数据切换失败（实体已暂存在目标渠道，可重试）', msg, input.ip);
      return await fail(msg);
    }

    /* ── ④ 源件处理：只决定「实体留不留」——主副本记录在 ③ 已经搬走 ── */
    let deletedSource = false;
    if (deleteSource) {
      try {
        await srcAdapter.delete(toCopyInfo(sourceCopy as never), srcInfo);
      } catch (err) {
        // 实体删不掉不影响主副本已切到新渠道这个事实，记日志即可
        appLog.warn(
          'channel',
          `转存后删除源件失败（主副本已切到新渠道）：${sourceCh.name}`,
          `${(err as Error).message} ｜ 文件=${rec.name}`,
          input.ip,
        );
      }
      deletedSource = true;
    } else {
      /*
       * 保留源件 = 实体留在原渠道，并补一条「普通副本」记录（isPrimary = false）。
       *
       * 注意这条记录**不是**「备份渠道」：BackupChannels 只认渠道上的 isBackup 标记，
       * 所以界面不会再多出第二个「备份渠道」，也就不会出现「两个源到底读哪个」的歧义。
       * 它的作用只有两个：主渠道不可用时作为取源兜底；让保留的实体不至于变成查不到的孤儿。
       */
      await prisma.fileCopy
        .upsert({
          where: { fileId_channelId: { fileId: rec.id, channelId: sourceCh.id } },
          update: { status: 'active', isPrimary: false },
          create: {
            fileId: rec.id,
            channelId: sourceCh.id,
            remoteKey: sourceCopy.remoteKey,
            remoteUrl: sourceCopy.remoteUrl || '',
            objectPath: sourceCopy.objectPath || '',
            urlQuery: sourceCopy.urlQuery || '',
            // v1.0.9：__convert 是「这一轮转存的临时标记」，不能跟着留到普通副本上
            metas: JSON.stringify(this.withoutConvertMarker(sourceCopy.metas)),
            status: 'active',
            isPrimary: false,
          },
        })
        .catch(() => undefined);
    }

    appLog.info(
      'channel',
      `文件转存成功：${sourceCh.name}（${sourceCh.type}）→ ${targetCh.name}（${targetCh.type}）`,
      `${deletedSource ? '已删除源件' : '保留源件'} ｜ 文件=${rec.name} ｜ ${srcSize}B ｜ 第 ${marker.attempts} 次尝试 ｜ 外链不变`,
      input.ip,
    );

    return {
      ok: true,
      channelName: targetCh.name,
      direction: dstLocal ? 'to-local' : 'to-remote',
      deletedSource,
      bytes: srcSize,
      attempts: marker.attempts,
    };
    } finally {
      // 远端取源用的临时文件：无论成败都清掉（失败时它是半截/可疑数据）
      if (tempSrc) await fsp.rm(tempSrc, { force: true }).catch(() => undefined);
    }
  }

  /* ────────────────────────────────────────────────────────────────
   * v1.0.9：转存的可恢复性支撑
   * ──────────────────────────────────────────────────────────────── */

  /** 读副本 metas 里的转存标记（非法 JSON / 无标记一律返回 null） */
  private readConvertMarker(metas: string | null | undefined): ConvertMarker | null {
    try {
      const obj = JSON.parse(String(metas || '{}')) as Record<string, unknown>;
      const c = obj?.__convert;
      return c && typeof c === 'object' ? (c as ConvertMarker) : null;
    } catch {
      return null;
    }
  }

  /** 去掉 __convert 的副本 metas（保留渠道侧凭证） */
  private withoutConvertMarker(metas: string | null | undefined): Record<string, unknown> {
    let obj: Record<string, unknown> = {};
    try {
      obj = JSON.parse(String(metas || '{}')) as Record<string, unknown>;
    } catch {
      obj = {};
    }
    delete obj.__convert;
    return obj;
  }

  /**
   * 把转存标记合并进源副本的 metas。
   * 用单条 UPDATE（不套事务）：这一步必须尽可能快、尽可能简单，
   * 它是「后面所有步骤可续跑」的地基。
   */
  private async saveConvertMarker(copyId: string, baseMetas: string | null, marker: ConvertMarker) {
    const next = this.withoutConvertMarker(baseMetas);
    next.__convert = marker;
    await prisma.fileCopy.update({ where: { id: copyId }, data: { metas: JSON.stringify(next) } });
  }

  /** 清掉目标渠道上「上一轮已写入但没被接管」的实体（换了目标渠道时调用） */
  private async dropStagedCopy(marker: ConvertMarker, ip?: string) {
    const staged = marker.staged;
    if (!staged) return;
    try {
      const ch = await prisma.channel.findUnique({ where: { id: marker.targetChannelId } });
      if (!ch) return;
      const info = this.toChannelInfo(ch as unknown as { id: string; code?: string; name: string; type: string; config: string });
      const adapter = createAdapter(info);
      await adapter.delete(
        {
          remoteKey: staged.remoteKey,
          remoteUrl: staged.remoteUrl || '',
          objectPath: staged.objectPath || '',
          urlQuery: staged.urlQuery || '',
          metas: (staged.metas || {}) as Record<string, unknown>,
        },
        info,
      );
    } catch (err) {
      appLog.warn(
        'channel',
        '转存：清理上一轮暂存实体失败（目标渠道可能残留一个孤儿文件）',
        `${(err as Error).message} ｜ key=${staged.remoteKey}`,
        ip,
      );
    }
  }

  /** 流式计算文件 MD5（命名模板 {md5} 用；不整份读进内存） */
  private async md5OfFile(path: string): Promise<string> {
    const hash = createHash('md5');
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(path);
      rs.on('data', (c) => hash.update(c as Buffer));
      rs.on('error', reject);
      rs.on('end', () => resolve());
    });
    return hash.digest('hex');
  }

  /**
   * v1.0.9：远端取源 —— 流式落临时文件 + 三次重试 + 完整性校验。
   *
   * 「完整传输」是第一目标，所以这里做三道校验：
   *   1) 落盘字节数非 0；
   *   2) 有 Content-Length 时逐字节比对（断流最典型的形态就是「少了最后一段」）；
   *   3) 记录里存过 MD5 时比对（渠道能给出原始字节的前提下，这是最强校验）。
   * 任一条不过就删掉半截文件重试，三次都失败才把错误抛给上层（上层会保留 staged 供重试）。
   */
  private async downloadToTempFile(
    url: string,
    rec: { md5?: string | null; name?: string },
    ip?: string,
  ): Promise<{ path: string; size: number }> {
    const dir = await fsp.mkdtemp(join(tmpdir(), 'gohub-convert-')).catch(() => tmpdir());
    const dest = join(dir, `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const resp = await fetch(url);
        if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
        const expect = Number(resp.headers.get('content-length') || 0) || 0;
        const hash = createHash('md5');
        const tap = new Transform({
          transform(chunk, _enc, cb) {
            hash.update(chunk as Buffer);
            cb(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(resp.body as never), tap, createWriteStream(dest));
        const st = await fsp.stat(dest);
        if (!st.size) throw new Error('下载内容为空');
        if (expect && st.size !== expect) throw new Error(`下载不完整（${st.size}/${expect} 字节）`);
        const digest = hash.digest('hex');
        const want = String(rec.md5 || '').toLowerCase();
        if (want && want !== digest) throw new Error(`MD5 校验不一致（${digest} ≠ ${want}）`);
        return { path: dest, size: st.size };
      } catch (err) {
        lastErr = err as Error;
        await fsp.rm(dest, { force: true }).catch(() => undefined);
        appLog.warn(
          'channel',
          `转存取源失败（第 ${attempt}/3 次）：${rec.name || ''}`,
          lastErr.message,
          ip,
        );
        if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    throw new Error(`拉取源文件失败（已重试 3 次）：${lastErr?.message || '未知原因'}`);
  }

  /**
   * v1.0.9：写入目标渠道 —— 优先流式（uploadFile），失败自动重试。
   *
   * 旧实现是「整份 Buffer 交给适配器 upload()」，170MB 的文件直接吃掉 170MB×2 内存，
   * 且传输中途出错只能整单失败。现在：
   *   · 有 uploadFile 的渠道（本地 / S3 / WebDAV）走磁盘直传，内存占用恒定；
   *   · 没有的能力的渠道（http-post / immich / aliyun）在 256MB 以内才允许回退整份读，
   *     超过阈值直接报错，避免把进程拖死；
   *   · 每次失败按 400ms × 次数 退避后重试，最多 3 次。
   */
  private async uploadFileReliable(
    adapter: StorageAdapter,
    path: string,
    size: number,
    rec: { mime: string; originalName: string },
    key: string,
    info: ChannelInfo,
    ctx: { owner: string; instanceId: string },
  ): Promise<ConvertStaged> {
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        if (typeof adapter.uploadFile === 'function') {
          return await adapter.uploadFile(path, size, { mime: rec.mime, originalName: rec.originalName }, key, info, ctx);
        }
        if (size > STREAM_REQUIRED_BYTES) {
          throw new Error(
            `目标渠道不支持流式写入，${(size / 1024 / 1024).toFixed(0)}MB 超过安全阈值，已拒绝以免占满内存`,
          );
        }
        const buffer = await fsp.readFile(path);
        return await adapter.upload({ buffer, mime: rec.mime, originalName: rec.originalName }, key, info, ctx);
      } catch (err) {
        lastErr = err as Error;
        // 重试会重新生成 key（可能撞上已写入的半成品），因此只在明确可重试的错误上继续
        const code = (err as NodeJS.ErrnoException)?.code || '';
        const fatal = /不支持流式写入|超过安全阈值|413|401|403|404/i.test(lastErr.message) || code === 'ENOSPC';
        if (fatal || attempt === 3) break;
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    throw lastErr || new Error('写入目标渠道失败');
  }
}

/** v1.0.9：转存标记里「已写入目标渠道的那份实体」 */
interface ConvertStaged {
  remoteKey: string;
  remoteUrl?: string;
  objectPath?: string;
  urlQuery?: string;
  metas?: Record<string, unknown>;
}

/** v1.0.9：转存标记（落 file_copies.metas.__convert） */
interface ConvertMarker {
  state: 'pending' | 'failed';
  targetChannelId: string;
  targetChannelName?: string;
  sourceChannelId?: string;
  deleteSource?: boolean;
  startedAt: number;
  attempts: number;
  lastError?: string;
  staged?: ConvertStaged;
}
