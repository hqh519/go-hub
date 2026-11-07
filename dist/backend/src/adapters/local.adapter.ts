import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, promises as fsp, statSync } from 'fs';
import { dirname, join, normalize, parse, sep } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { AdapterError, ChannelInfo, CopyInfo, StorageAdapter, UploadResult } from './adapter.interface';
import { backendRoot, backendSub } from '../common/project-paths';
import { appLog } from '../common/app-log';
import { LOCAL_DEFAULT_PREFIX, renderFileName, renderObjectPrefix, randomUuid } from '../common/path-template';

/**
 * 本地存储渠道适配器 —— v3.0.0
 *
 * v3.0.0 起本地存储分两种形态，共用本适配器：
 *   1) 内置本地渠道（code=999999，系统自动创建，不可删除）——
 *      config: { name, enabled, prefixPath(固定忽略，始终 uploads), objectPrefix,
 *                nameTemplate, sizeLimitEnabled, sizeLimitGB, note }
 *      落盘根：<后端根>/uploads
 *   2) 自定义本地渠道（「添加渠道」选 local 创建，code 99xxxx）——
 *      config: { name, enabled, rootPath(容器内存储地址), hostPath(仅展示),
 *                objectPrefix, nameTemplate, sizeLimitEnabled, sizeLimitGB, note }
 *      落盘根：<rootPath>（拒绝包含 '..'）
 *
 * ## 落盘规则（v3.0.0 R11 起）
 *   <根>/<objectPrefix 或 {user}/{ID}/{y}/{m}>/<文件名>
 *   · objectPrefix 支持 {user}{ID}{y}{m}{d}，留空时默认 `{user}/{ID}/{y}/{m}`；
 *     前缀里已含 {user} 时不再额外叠加「上传者/实例」目录（避免 alice/default/alice/…）；
 *     自定义前缀不含 {user} 时保持老布局 `<根>/<上传者>/<实例>/<前缀>/<文件名>`；
 *   · nameTemplate 支持 {filename}{uuid}{md5}{timestamp}{ext}：
 *       - 模板为空 → 沿用上传服务生成的 key 文件名（默认「原始文件名-时间戳」，保持既有命名兼容）；
 *       - 模板非空 → 适配器按模板重排文件名，磁盘同名冲突追加 -1/-2；
 *   · md5 占位符：整块 Buffer 上传可实时计算；磁盘路径流式上传不可得时用随机串兜底。
 *
 * ## 为什么要按上传者归档（v2.1.0 语义保留）
 *   1) 文件管理里改分类不改真实路径，不会出现「改一次目录搬运 GB 级数据」；
 *   2) 磁盘目录按时间分片，单目录文件数可控；
 *   3) 备份 / 迁移只需整目录拷贝。
 *
 * ## 直链
 * 本地文件没有「渠道直链」，buildDirectUrl 一律返回 null，
 * 由 /file/:name 走本站代理读取（外链域名、代理缓存、Range 复用同一套逻辑）。
 */
export class LocalAdapter implements StorageAdapter {
  /** 内置本地存储根目录：<后端根>/uploads */
  static root(): string {
    return backendSub('uploads');
  }

  /**
   * 解析渠道配置为本地存储参数（v3.0.0）。
   * 有 rootPath 的视为自定义本地渠道；否则按内置渠道处理（根固定 uploads）。
   */
  static readChannelCfg(channel?: ChannelInfo | null): {
    isCustom: boolean;
    rootPath: string;
    objectPrefix: string;
    nameTemplate: string;
    sizeLimitEnabled: boolean;
    sizeLimitGB: number;
  } {
    let cfg: Record<string, unknown> = {};
    try {
      cfg = typeof channel?.config === 'string' ? JSON.parse(channel.config || '{}') : channel?.config || {};
    } catch {
      cfg = {};
    }
    const rawRoot = String(cfg.rootPath || '').trim();
    return {
      isCustom: !!rawRoot,
      rootPath: LocalAdapter.sanitizeRootPath(rawRoot),
      objectPrefix: String(cfg.objectPrefix || '').trim(),
      nameTemplate: String(cfg.nameTemplate || '').trim(),
      sizeLimitEnabled: String(cfg.sizeLimitEnabled || '') === 'true' || cfg.sizeLimitEnabled === true,
      sizeLimitGB: Number(cfg.sizeLimitGB) || 0,
    };
  }

  /**
   * rootPath 安全校验（v3.0.0）：拒绝路径穿越。
   * 约定放宽为「容器内任意路径」，但严禁包含 '..'；
   * 相对路径按后端根目录解析。
   */
  static sanitizeRootPath(raw: string): string {
    const s = String(raw || '').trim().replace(/\\/g, '/');
    if (!s) return '';
    if (s.includes('..')) throw new AdapterError('rootPath 禁止包含 ".."（禁止路径穿越）', 'local');
    // 绝对路径（/data/... 或 Windows 盘符）原样使用；相对路径挂到后端根下
    if (/^\/|^[A-Za-z]:\//.test(s)) return s.replace(/\/+$/, '');
    return join(backendRoot(), s.replace(/^\/+/, ''));
  }

  /**
   * key → 磁盘相对路径（**不含上传者目录**）。
   *   `202610/ab12.jpg` → `2026/10/ab12.jpg`
   * 其它形态的 key（例如 S3 客户端直接给的多级路径、已展开的 remoteKey）原样保留，
   * 只做安全性校验（禁止 `..` 穿越）。
   */
  static toRelativePath(key: string): string {
    const clean = String(key || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .split('/')
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/');
    if (!clean) throw new AdapterError('key 为空，无法写入本地存储', 'local');
    // 年月段展开：202610 → 2026/10（仅在首段恰为 6 位数字时）
    const parts = clean.split('/');
    const head = parts[0];
    if (/^\d{6}$/.test(head)) {
      parts.splice(0, 1, head.slice(0, 4), head.slice(4));
    }
    return parts.join('/');
  }

  /** 上传者/实例目录名：只清洗路径分隔符等非法字符，保留中文/字母数字，空值归 default */
  static ownerSegment(owner?: string | null): string {
    const s = String(owner || '')
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/^\.+$/, '')
      .replace(/\/{2,}/g, '/');
    return s || 'default';
  }

  /** 实例目录名（v3.0.0）：空串/缺省 = 默认实例 → 'default' */
  static instanceSegment(instanceId?: string | null): string {
    return LocalAdapter.ownerSegment(instanceId || 'default');
  }

  /**
   * 新上传的 key → 带上传者目录的相对路径：
   *   `202610/ab12.jpg` + 用户 alice + 实例 i1 → `alice/i1/2026/10/ab12.jpg`
   * 已是展开形态（首段不是 6 位数字，如备份时传入的 remoteKey）则原样返回，
   * 避免重复叠加用户名/实例目录。
   */
  static toRelativePathFor(key: string, owner?: string | null, instanceId?: string | null): string {
    const rel = LocalAdapter.toRelativePath(key);
    const rawHead = String(key || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .split('/')[0];
    // 只有「刚生成的原始 key（202610/xxx）」才需要加上传者目录；
    // 已展开的 remoteKey（备份 / 补备份时传入）原样使用，避免重复叠加。
    if (!/^\d{6}$/.test(rawHead)) return rel;
    return `${LocalAdapter.ownerSegment(owner)}/${LocalAdapter.instanceSegment(instanceId)}/${rel}`;
  }

  /** 磁盘绝对路径（内置根 + 越界校验：结果必须仍在上传根目录内）—— 仅内置渠道用 */
  static absolutePath(key: string): string {
    const root = LocalAdapter.root();
    const abs = normalize(join(root, LocalAdapter.toRelativePath(key)));
    const rootWithSep = root.endsWith(sep) ? root : root + sep;
    if (!abs.startsWith(rootWithSep)) {
      throw new AdapterError('非法的本地存储路径', 'local');
    }
    return abs;
  }

  /** 本渠道的落盘根目录（内置 → uploads；自定义 → rootPath） */
  private baseRoot(channel?: ChannelInfo | null): string {
    const cfg = LocalAdapter.readChannelCfg(channel);
    return cfg.isCustom ? cfg.rootPath : LocalAdapter.root();
  }

  /** join 后做越界校验：结果必须仍在 base 内（防 remoteKey 被写脏后读到 base 外） */
  private static safeJoin(base: string, rel: string): string {
    const abs = normalize(join(base, rel));
    const baseWithSep = base.endsWith(sep) ? base : base + sep;
    if (!abs.startsWith(baseWithSep)) {
      throw new AdapterError('非法的本地存储路径', 'local');
    }
    return abs;
  }

  // ---------------- 渠道容量限制（v3.0.0） ----------------
  /**
   * sizeLimitEnabled + sizeLimitGB：按渠道根目录【实际磁盘占用】统计，
   * 达到上限后拒绝继续写入（抛 AdapterError，上传链路会自动切下一个渠道）。
   * 目录占用统计做 60 秒缓存 —— 每次上传都全量递归遍历磁盘代价太高。
   */
  private static usageCache = new Map<string, { bytes: number; at: number }>();

  static async dirUsageBytes(base: string): Promise<number> {
    const hit = LocalAdapter.usageCache.get(base);
    if (hit && Date.now() - hit.at < 60_000) return hit.bytes;
    let total = 0;
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 12) return; // 层数保护
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          await walk(p, depth + 1);
        } else if (e.isFile()) {
          try {
            total += statSync(p).size;
          } catch {
            /* 读取中被删等竞态，忽略 */
          }
        }
      }
    };
    await walk(base, 0);
    LocalAdapter.usageCache.set(base, { bytes: total, at: Date.now() });
    return total;
  }

  private async enforceSizeLimit(base: string, channel?: ChannelInfo | null): Promise<void> {
    const cfg = LocalAdapter.readChannelCfg(channel);
    if (!cfg.sizeLimitEnabled || cfg.sizeLimitGB <= 0) return;
    const used = await LocalAdapter.dirUsageBytes(base);
    const limit = cfg.sizeLimitGB * 1024 * 1024 * 1024;
    if (used >= limit) {
      throw new AdapterError(
        `本地存储渠道容量已达上限（已用 ${(used / 1024 ** 3).toFixed(2)}GB / 限制 ${cfg.sizeLimitGB}GB）`,
        'local',
      );
    }
  }

  // ---------------- 文件命名（v3.0.0） ----------------
  /**
   * 计算新上传的落盘相对路径：<上传者>/<实例>/<前缀或年月>/<文件名>。
   *   · key 首段是 6 位年月数字 → 视为「原始 key」，按渠道配置展开；
   *   · 其它形态（备份 / 补备份传入的已展开 remoteKey）原样保留，不重复归档；
   *   · nameTemplate 非空 → 按模板重排文件名（丢弃 key 自带命名），磁盘冲突追加 -1/-2；
   *   · nameTemplate 为空 → 沿用 key 的文件名（上游默认「原始文件名-时间戳」，命名兼容）。
   */
  private async buildRelKey(
    key: string,
    file: { buffer?: Buffer; originalName: string },
    channel: ChannelInfo,
    ctx?: { owner?: string; instanceId?: string },
  ): Promise<string> {
    return LocalAdapter.sanitizeRelKey(await this.buildRelKeyInner(key, file, channel, ctx));
  }

  /**
   * v1.0.3：落盘前的路径消毒 —— 这是**兜底**，不是主修方案。
   *
   * 主修在 `UploadService.convertChannel`：转存的 key 改为按目标渠道配置重新生成
   * （`makeKeyFor`），不再沿用源件的 remoteKey。所以第三方渠道那种 `assetId|checksum`
   * 的 key 已经不会出现在本地路径里了。
   *
   * 这里剩下的唯一来源是「用户上传的原始文件名本身就带非法字符」（如从 URL 登记下来的
   * `a|b.png`），文件名会被原样拼进 key。不消毒的话，Windows 上 writeFile 会抛
   * `EPERM: operation not permitted`，一次上传直接把整个流程打挂。
   *
   * 只替换「当前平台确实非法」的字符：Windows 处理 `<>:"|?*`、控制字符与结尾的点/空格；
   * 其余平台原样返回，保证已有文件的磁盘路径一个字节都不变（不会让老文件失联）。
   */
  private static sanitizeRelKey(relKey: string): string {
    const raw = String(relKey || '');
    if (process.platform !== 'win32') return raw;
    return raw
      .split('/')
      .map((seg) =>
        seg
          .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
          // Windows 会悄悄吃掉结尾的点与空格，显式换成下划线避免「写入名 ≠ 读取名」
          .replace(/[. ]+$/, (m) => '_'.repeat(m.length)),
      )
      .join('/');
  }

  private async buildRelKeyInner(
    key: string,
    file: { buffer?: Buffer; originalName: string },
    channel: ChannelInfo,
    ctx?: { owner?: string; instanceId?: string },
  ): Promise<string> {
    const cfg = LocalAdapter.readChannelCfg(channel);
    const ownerSeg = LocalAdapter.ownerSegment(ctx?.owner);
    const instSeg = LocalAdapter.instanceSegment(ctx?.instanceId);
    const keyNorm = String(key || '').replace(/\\/g, '/').replace(/^\/+/, '');

    /*
     * v3.0.0（R11）：前缀留空时本地渠道默认 `{user}/{ID}/{y}/{m}`，
     * 与上传链路 makeKeyFor 的默认值保持一致（否则「留空」时两处渲染出不同目录）。
     */
    const prefixTpl = cfg.objectPrefix || LOCAL_DEFAULT_PREFIX;
    const prefix = renderObjectPrefix(prefixTpl, new Date(), {
      channelId: (channel as unknown as { code?: string }).code || channel.id,
      user: ctx?.owner,
    });
    /*
     * 上游 makeKeyFor 已经按同一模板渲染过前缀（key 形如 alice/999999/2026/11/x.png）——
     * 直接沿用，避免二次渲染（否则自定义命名会被重算一次、前缀也可能叠两遍）。
     */
    if (prefix && (keyNorm === prefix || keyNorm.startsWith(`${prefix}/`))) {
      return keyNorm;
    }

    /*
     * v3.0.0（R10）：修复「本地存储渠道不按自定义文件命名」的根因。
     * 上游 makeKeyFor 产出的原始 key 是 `<年>/<月>/<文件名>`（如 2026/11/x.png），
     * 老版本还有 `202610/...` 六位年月形态。此前只认「首段是 6 位数字」，
     * 于是 `2026/11/...` 被误判成「已展开路径」直接返回 —— 自定义命名/前缀全部被跳过。
     */
    const segsOfKey = keyNorm.split('/');
    const rawHead = segsOfKey[0] || '';
    const looksRawKey = /^\d{6}$/.test(rawHead) || (/^\d{4}$/.test(rawHead) && /^\d{1,2}$/.test(segsOfKey[1] || ''));
    if (!looksRawKey) {
      // 已展开形态（备份 / 补备份传入的 remoteKey）：直接沿用（相对本渠道根）
      return keyNorm;
    }

    const tpl = cfg.nameTemplate;
    const rel = LocalAdapter.toRelativePath(key);
    /*
     * 前缀里已含 {user} 时不再叠加「上传者/实例」目录 ——
     * 否则会出现 alice/default/alice/999999/2026/11/ 这种重复段。
     * 未用 {user} 的自定义前缀仍保持老布局（上传者/实例/前缀/文件）。
     */
    const baseSegs = /\{user\}/i.test(prefixTpl) ? [] : [ownerSeg, instSeg];
    const dirSegs = [...baseSegs, prefix].filter(Boolean).join('/');

    let name: string;
    if (tpl) {
      const dot = file.originalName.lastIndexOf('.');
      const stem = dot > 0 ? file.originalName.slice(0, dot) : file.originalName;
      const ext = dot > 0 ? file.originalName.slice(dot + 1).toLowerCase() : '';
      // md5：整块 Buffer 可实时计算；磁盘路径流式上传不可得 → 随机串兜底
      const md5 = file.buffer
        ? createHash('md5').update(file.buffer).digest('hex')
        : randomUuid().replace(/-/g, '');
      name = renderFileName(tpl, { originalName: file.originalName, stem, ext, md5, timestamp: Date.now() });
    } else {
      // 只自定义了前缀：文件名仍沿用 key 的（默认「原始文件名-时间戳」）
      const segs = rel.split('/');
      name = segs[segs.length - 1] || rel;
    }
    // 磁盘冲突：追加 -1 / -2 …（插在扩展名前）
    const dirAbs = LocalAdapter.safeJoin(this.baseRoot(channel), dirSegs);
    const p = parse(name);
    for (let i = 1; i < 1000; i += 1) {
      const candidate = i === 1 ? name : `${p.name}-${i}${p.ext}`;
      if (!existsSync(join(dirAbs, candidate))) {
        name = candidate;
        break;
      }
    }
    return `${dirSegs ? `${dirSegs}/` : ''}${name}`;
  }

  async upload(
    file: { buffer: Buffer; mime: string; originalName: string },
    key: string,
    channel: ChannelInfo,
    ctx?: { owner?: string; instanceId?: string },
  ): Promise<UploadResult> {
    const base = this.baseRoot(channel);
    await this.enforceSizeLimit(base, channel);
    const relKey = await this.buildRelKey(key, file, channel, ctx);
    const abs = LocalAdapter.safeJoin(base, relKey);
    try {
      await fsp.mkdir(dirname(abs), { recursive: true });
      await fsp.writeFile(abs, file.buffer);
    } catch (err) {
      throw new AdapterError(`写入本地文件失败：${(err as Error).message}`, 'local');
    }
    // remoteKey 存「展开后」的相对路径（含上传者/实例目录），读取时按渠道根定位
    return {
      remoteKey: relKey,
      // v3.0.0（R10）：本地渠道的固化地址 = 相对渠道根的路径（域名由外链签发域名提供）
      objectPath: relKey,
      metas: {
        local: true,
        owner: LocalAdapter.ownerSegment(ctx?.owner),
        instanceId: LocalAdapter.instanceSegment(ctx?.instanceId),
      },
    };
  }

  /**
   * v2.8.3：磁盘路径直接落盘（大文件流式）。
   * 优先硬链接（同分区零拷贝），失败再 copyFile（跨分区/文件系统不支持硬链接）。
   */
  async uploadFile(
    path: string,
    _size: number,
    file: { mime: string; originalName: string },
    key: string,
    channel: ChannelInfo,
    ctx?: { owner?: string; instanceId?: string },
  ): Promise<UploadResult> {
    const base = this.baseRoot(channel);
    await this.enforceSizeLimit(base, channel);
    const relKey = await this.buildRelKey(key, { originalName: file.originalName }, channel, ctx);
    const abs = LocalAdapter.safeJoin(base, relKey);
    try {
      await fsp.mkdir(dirname(abs), { recursive: true });
      try {
        await fsp.link(path, abs);
      } catch {
        await fsp.copyFile(path, abs);
      }
    } catch (err) {
      throw new AdapterError(`写入本地文件失败：${(err as Error).message}`, 'local');
    }
    return {
      remoteKey: relKey,
      // v3.0.0（R10）：本地渠道的固化地址 = 相对渠道根的路径（域名由外链签发域名提供）
      objectPath: relKey,
      metas: {
        local: true,
        owner: LocalAdapter.ownerSegment(ctx?.owner),
        instanceId: LocalAdapter.instanceSegment(ctx?.instanceId),
      },
    };
  }

  async delete(copy: CopyInfo, channel: ChannelInfo): Promise<void> {
    const rel = String(copy.remoteKey || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel) return;
    // 按本渠道的落盘根定位（内置 → uploads；自定义 → rootPath），兼容历史 202610/ 形态
    const root = this.baseRoot(channel);
    let abs: string;
    try {
      abs = LocalAdapter.safeJoin(root, LocalAdapter.toRelativePath(rel));
    } catch {
      return;
    }
    try {
      await fsp.unlink(abs);
    } catch (err) {
      // 文件本来就不存在 → 视为删除成功（幂等）
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw new AdapterError(`删除本地文件失败：${(err as Error).message}`, 'local');
      }
    }
    /*
     * v1.0.1：文件删掉后，若所在目录已空则一并回收，并一直向上递归，
     * 直到遇到「还有内容」的目录或渠道根为止（渠道根永不删除）。
     * 只删空目录（readdir 为空才 rmdir），并行写入的其它文件不会被动到。
     */
    await LocalAdapter.pruneEmptyDirs(root, dirname(abs));
  }

  /**
   * v1.0.1：向上回收空目录。
   *   · 起点为被删文件所在目录，逐级向上；
   *   · 遇到非空目录立即停止（不越权清理别人还有文件的目录）；
   *   · 到达渠道根即停止（根目录本身永不删除）；
   *   · 任何一级失败（权限、占用）只记日志并停止，不影响主流程。
   */
  private static async pruneEmptyDirs(root: string, startDir: string): Promise<void> {
    let cur: string;
    let rootAbs: string;
    try {
      cur = normalize(startDir);
      rootAbs = normalize(root || '');
    } catch {
      return;
    }
    if (!rootAbs) return;
    const rootWithSep = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep;
    while (cur !== rootAbs && cur.startsWith(rootWithSep)) {
      try {
        const entries = await fsp.readdir(cur);
        if (entries.length) return;
        await fsp.rmdir(cur);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        // 目录已被别的请求清掉 / 不存在：继续向上没问题
        if (code !== 'ENOENT') {
          appLog.warn('upload', `回收空目录失败（已跳过）`, `${cur} ｜ ${(err as Error).message}`);
          return;
        }
      }
      const parent = dirname(cur);
      if (parent === cur) return;
      cur = parent;
    }
  }

  /** 本地文件不产生渠道直链 —— 由 /file/:name 代理下发 */
  buildDirectUrl(_copy: CopyInfo, _channel: ChannelInfo): string | null {
    return null;
  }
}

// ============================================================================
// 本地文件定位（读 / 下发用）
// ============================================================================

/** 在指定根目录下定位 remoteKey（含历史 202610/ 形态回退），找不到返回空串 */
function probeRoot(root: string, rel: string): string {
  try {
    const abs = normalize(join(root, LocalAdapter.toRelativePath(rel)));
    const rootWithSep = root.endsWith(sep) ? root : root + sep;
    if (abs.startsWith(rootWithSep) && existsSync(abs)) return abs;
  } catch {
    /* 越界 → 忽略 */
  }
  /*
   * 兼容历史/手工迁移的 `202610/xxx` 原始目录。
   * 这条回退分支**必须**自己做越界校验：`join` 会把 `..` 归一化掉，
   * 若直接 existsSync 就返回，等于给「库里的 remoteKey 被写脏」留了读任意文件的通道。
   */
  const legacy = normalize(join(root, rel));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (legacy.startsWith(rootWithSep) && existsSync(legacy)) return legacy;
  return '';
}

/**
 * 本地文件的绝对路径（供 /file 控制器直接读流）；不存在返回空串。
 * v3.0.0：先按内置 uploads 根定位；未命中再探测各自定义本地渠道的 rootPath
 * （自定义渠道的 remoteKey 是相对其 rootPath 的路径）。
 * 自定义渠道根目录清单做 30 秒缓存，避免每次外链访问都查库。
 */
export async function localFileAbsOf(remoteKey: string): Promise<string> {
  const rel = String(remoteKey || '').replace(/^\/+/, '');
  if (!rel) return '';
  // 1) 内置 uploads 根（绝大多数文件的落点）
  const builtin = probeRoot(LocalAdapter.root(), rel);
  if (builtin) return builtin;
  // 2) 自定义本地渠道的 rootPath
  try {
    // 延迟 require 避免 prisma 在适配器层形成硬依赖（测试/工具场景可单跑）
    const { prisma } = await import('../common/prisma');
    const channels = await prisma.channel.findMany({ where: { type: 'local' }, select: { id: true, config: true } });
    for (const ch of channels) {
      let root = '';
      try {
        const cfg = LocalAdapter.readChannelCfg({
          id: ch.id, name: '', type: 'local',
          config: (() => { try { return JSON.parse(ch.config || '{}'); } catch { return {}; } })(),
          metas: {},
        });
        root = cfg.rootPath;
      } catch {
        root = '';
      }
      if (!root || !existsSync(root)) continue;
      const hit = probeRoot(root, rel);
      if (hit) return hit;
    }
  } catch {
    /* 查库失败按未找到处理 */
  }
  return '';
}

/** 本地文件的绝对路径（仅内置 uploads 根；同步版保留给既有调用方） */
export function localFileAbs(remoteKey: string): string {
  const rel = String(remoteKey || '').replace(/^\/+/, '');
  if (!rel) return '';
  return probeRoot(LocalAdapter.root(), rel);
}

/**
 * 流式写入本地文件（后续给「分片落盘」用）。
 * 目前上传仍是整块 Buffer，此函数保留给后续优化，避免再改一次适配器签名。
 */
export async function writeLocalStream(relKey: string, source: Readable): Promise<void> {
  const abs = LocalAdapter.absolutePath(relKey);
  mkdirSync(dirname(abs), { recursive: true });
  await pipeline(source, createWriteStream(abs));
}
