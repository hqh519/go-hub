import { signOrigin } from '../common/request-origin';
import { Body, Controller, Delete, Get, Head, HttpCode, Post, Put, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { createHash, createHmac, randomBytes } from 'crypto';
import { prisma } from '../common/prisma';
import { CryptoService } from '../common/crypto.service';
import { UploadService } from '../upload/upload.service';
import { SysConfigService } from '../settings/sysconfig.service';
import { SettingsService } from '../settings/settings.service';
import { NO_BACKUP_VALUES, StorageChannelService } from '../storage/storage-channel.service';
import { extSuffixFor } from '../common/file-view';
import { appLog } from '../common/app-log';
import { expandFolderPlaceholders } from './folder-placeholders';

/**
 * API Token 接入端点 —— 为 GoHub 规划的两套自有规则。
 *
 * 1) Web 通道（type=web）
 *    POST /api/token/upload
 *    鉴权：`Authorization: Bearer <token>` 或 `X-Api-Token: <token>` 或表单字段 token
 *    入参（multipart 或 JSON）：
 *      file      文件（multipart）；或 url 从远端链接转存
 *      token     API Token
 *      username  可选：按该账户的「用户管理」渠道绑定上传（并归属该账户）
 *                ⚠ 越权防护：Token 的 owner 绑定了具体账户时，username 只允许传该账户名，
 *                  否则 403；只有管理员 Token 可以驱动任意账户。账户不存在/已禁用返回 400。
 *      userstore 可选：'false' 表示忽略 username，改按 Token / 全局渠道
 *    渠道规则（v1.8.0 定稿，已移除 category / bucket / backup 三个参数）：
 *      传了 username 且 userstore !== false
 *        → 主渠道 = getStorageChannel(username, '')，备份渠道 = getStorageChannel(username, 'backup')
 *      否则
 *        → 主渠道 = Token 上配置的渠道 || 全局主渠道
 *          备份渠道 = Token 上配置的备份渠道 || 全局备份渠道
 *    出参：{ success, data: { name, url, dedup } }
 *      url 是 GoHub 的【签发链接】，已套用全站外链前缀（自定义访问域名优先）
 *
 * 2) S3 协议（type=s3）
 *    Endpoint = <本站域名>/s3 ，Path-Style 寻址，Region 固定为 us-east-1
 *      （服务端不校验 Region 取值，客户端一律填 us-east-1 即可）
 *      PUT    /s3/<bucket>/<key>   上传对象（bucket = 渠道 ID，即渠道 6 位 code）
 *      GET    /s3                  列出可用 bucket（即可用渠道）
 *      HEAD   /s3/<bucket>/<key>   探测对象是否存在
 *      DELETE /s3/<bucket>/<key>   删除对象（204；连同各渠道远端副本一起清理）
 *    AccessKey / SecretKey 由「安全设置 → API Token 管理」创建时生成（AWS SigV4 校验）。
 *
 *    **响应头契约（改动过的坑，勿回退）**：
 *      - `x-amz-request-id` 是**纯 ASCII 的请求追踪标识**，每次请求随机生成（AWS 语义）。
 *        早期实现把「文件标识（File_ID）」直接写进这个头：一旦客户端上传的 Object Key
 *        含中文等非 Latin-1 字符，Node 在 setHeader 阶段就会抛 ERR_INVALID_CHAR，
 *        客户端收到 **500** —— 而此时文件其实已经成功入库（表现为「报错但图片在」）。
 *      - 文件标识改由 `x-gohub-id`（按路径段 URI 编码，纯 ASCII）与
 *        `x-gohub-url` / `Location`（完整签发链接）对外提供。
 *      - 本控制器所有响应头一律经 setSafeHeader 写入，杜绝同类问题复发。
 *
 *    **bucket 取值规则（确保不会写错渠道）**：
 *      - `auto` 或空值        → 直接用该 Token 上配置的「默认存储渠道」存入
 *      - 合法的渠道 ID        → 存到该渠道
 *      - 传了值但查不到该渠道 → 同样回落到 Token 的「默认存储渠道」
 *    也就是说：任何异常取值最终都会落到 Token 的默认存储渠道，绝不会写到别的渠道上。
 *
 *    上传成功时响应头会带上 GoHub 的签发链接（`Location` 与 `x-gohub-url`）。
 *    另外，服务端会把客户端上传时的 Object Key 作为该文件的对外标识，
 *    因此客户端用「自定义域名（填 <本站域名>/file）+ key」自行拼出的地址
 *    与本站签发链接完全一致 —— 不再出现「客户端拼出一个访问不了的地址」的情况。
 *
 * 3) 渠道取值（两类协议通用）
 *    优先级：本次请求显式传入的渠道 → 该 Token 上配置的默认主/备渠道
 *          → 「用户管理」里为该账户指定的渠道 → 后台「上传设置」的全局主/备渠道。
 *    统一由 StorageChannelService.getStorageChannel 解析，任何地方都按【渠道 ID】匹配。
 */
@Controller()
export class TokenApiController {
  constructor(
    private uploadSvc: UploadService,
    private sysConfig: SysConfigService,
    private settings: SettingsService,
    private storageChannel: StorageChannelService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* 公共工具                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * 文件标识 → URL 路径段编码。
   * 文件标识允许包含目录层级（如 S3 客户端传上来的 `web/202610/ab.png`），
   * 因此按 `/` 分段编码，保留目录分隔符本身。
   */
  private encodePath(id: string): string {
    return String(id || '')
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
  }

  /**
   * 写入响应头的安全兜底（防 ERR_INVALID_CHAR）。
   *
   * HTTP 头只能承载 Latin-1，Node 在 setHeader 阶段就会校验：值里一旦含中文等
   * 码位 > 0xFF 的字符，整个请求会以 500 收场（哪怕文件已经入库）。
   * 本控制器多处头值来自用户可控数据（Object Key → 文件标识），
   * 因此统一从这里写入：超范围字符直接剔除，宁可少一个字符也不要 500。
   */
  private setSafeHeader(res: Response, name: string, value: string): void {
    res.setHeader(name, String(value ?? '').replace(/[^\t\x20-\x7e\xa0-\xff]/g, ''));
  }

  /**
   * 管理员账户名 —— API Token 上传的文件统一归属这个账户。
   * 取值优先级与「用户管理」保持一致：安全设置 adminUsername > ADMIN_USER > SUPER_ADMIN_USERNAME > admin。
   * （早期实现这里写死字符串 'admin'，与真实管理员账号对不上，会导致文件管理里看不到 Token 上传的文件）
   */
  private async adminUsername(): Promise<string> {
    try {
      const security = (await this.sysConfig.get('security')) as
        | { auth?: { admin?: { adminUsername?: string } }; admin?: { adminUsername?: string } }
        | undefined;
      // 真实结构是 security.auth.admin.adminUsername（历史实现读成 security.admin，永远取不到）
      const u = String(security?.auth?.admin?.adminUsername || security?.admin?.adminUsername || '').trim();
      if (u) return u;
    } catch {
      /* 忽略 */
    }
    return (process.env.ADMIN_USER || '').trim() || (process.env.SUPER_ADMIN_USERNAME || '').trim() || 'admin';
  }

  /* ------------------------------------------------------------------ */
  /* Web 通道                                                            */
  /* ------------------------------------------------------------------ */

  /** 解析 Token（请求头 / 表单 / query 三种来源） */
  private async resolveToken(req: Request, body?: Record<string, unknown>): Promise<{ ok: boolean; token?: typeof prisma.apiToken extends never ? never : Awaited<ReturnType<typeof prisma.apiToken.findUnique>>; error?: string }> {
    const hdr = String(req.headers['x-api-token'] || req.headers['authorization'] || '');
    let raw = hdr.replace(/^Bearer\s+/i, '').trim();
    if (!raw && body?.token) raw = String(body.token).trim();
    if (!raw && req.query.token) raw = String(req.query.token).trim();
    if (!raw) return { ok: false, error: '缺少 API Token' };

    const hash = createHash('sha256').update(raw).digest('hex');
    const t = await prisma.apiToken.findUnique({ where: { tokenHash: hash } });
    if (!t || !t.enabled) return { ok: false, error: 'Token 无效或已禁用' };
    const metas = JSON.parse(t.metas || '{}');
    if (metas.expiresAt && Date.parse(metas.expiresAt) < Date.now()) return { ok: false, error: 'Token 已过期' };
    void prisma.apiToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return { ok: true, token: t };
  }

  /**
   * bucket / backup 参数 → 渠道 ID。
   *
   * 只按【渠道 ID】匹配：6 位 `code`（后台「存储渠道」列表展示的渠道 ID）或数据库主键 `id`。
   * 渠道名（name）不参与匹配 —— 它只是便于人看的标识，可随时改名，拿名称匹配会在改名后静默失配。
   *
   * 返回空串表示「未指定」，交由 StorageChannelService 依次退回
   * 「Token 上配置的默认渠道 → 账户级 → 后台上传设置的全局渠道」。
   *
   * 下列取值一律视为「未指定」，直接走 Token 的默认存储渠道：
   *   - 空值 / 未传
   *   - `default`      —— 语义化写法，等价于「跟随默认渠道」
   *   - `auto`         —— S3 客户端常用的自适应写法（PicList / S3 工具等）
   *   - 关闭备份的哨兵值 `none` / `__none__` / `false` / `0`
   *   - 传了值但本系统查不到对应渠道 ID（无效值）—— 同样退回默认渠道，
   *     避免把文件写到一个"看起来指定了、其实不存在"的渠道上导致存储出错。
   */
  private async resolveChannelId(bucket?: string): Promise<string> {
    const key = String(bucket || '').trim();
    // 无值 / default / auto / 关闭备份的哨兵值 → 视为未指定
    const lower = key.toLowerCase();
    if (!key || lower === 'default' || lower === 'auto' || NO_BACKUP_VALUES.includes(lower)) return '';
    const ch =
      (await prisma.channel.findUnique({ where: { code: key } })) ||
      (await prisma.channel.findUnique({ where: { id: key } })) ||
      null;
    // 只接受启用中的渠道；无效值返回空串 → 由 StorageChannelService 兜底到 Token/全局渠道
    return ch && ch.enabled ? ch.id : '';
  }

  @Post('api/token/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  @HttpCode(200)
  async uploadByToken(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    const auth = await this.resolveToken(req, body);
    if (!auth.ok || !auth.token) return res.status(401).json({ success: false, message: auth.error });
    if ((auth.token.type || 'web') !== 'web') {
      return res.status(400).json({ success: false, message: '该 Token 为 S3 类型，请使用 S3 协议上传' });
    }

    // Token 上可预置默认值（创建 Token 时选填）：归属账户 + 默认主/备渠道
    const tokenMetas = JSON.parse(auth.token.metas || '{}') as {
      owner?: string;
      defaultBucket?: string;
      defaultBackup?: string;
      defaultCategory?: string;
    };

    /*
     * =====「Web 通用」渠道规则（v1.8.0 重构定稿）=====
     *
     * 请求参数：{ token, username, userstore }
     *   已移除 category / bucket / backup —— 分类改由系统默认规则决定
     *   （网页设置里的默认上传目录，留空则按「年份/月份」）。
     *
     * 判定：
     *   username 非空 && userstore !== false
     *     → 主渠道 = 该账户在「用户管理」里绑定的渠道，备份渠道同理；
     *       文件也归属该账户（这样在按账户归集里能对上）。
     *   否则
     *     → 主渠道 = Token 上配置的渠道 || 全局主渠道
     *       备份渠道 = Token 上配置的备份渠道 || 全局备份渠道
     *
     * 注意 userstore 只认显式的 false / 0 为「不用账户渠道」，
     * 未传或传 true 都按账户渠道处理 —— 避免调用方漏传字段导致渠道意外变化。
     */
    const usernameParam = String(body.username || '').trim();
    const userstoreRaw = String(body.userstore ?? '').trim().toLowerCase();
    const useUserStore = !!usernameParam && userstoreRaw !== 'false' && userstoreRaw !== '0';

    /*
     * ===== 越权防护（v1.7.0 新增 username，v1.8.0 同步加固）=====
     *
     * username 让调用方「以某个账户的身份」把文件写进该账户绑定的渠道，
     * 因此必须确认调用方有权代表这个账户：
     *   1) Token 上已绑定具体账户（owner 既不是空也不是管理员）→ 只允许该账户名；
     *      Token 的 owner 是管理员建 Token 时明确指定的，属于「专属凭证」。
     *   2) Token 属于管理员（owner 为空 / 'admin' / 等于当前管理员名）→ 视为服务级 Token，
     *      可以驱动任意账户，保留「一个 Token 服务多用户」的用法。
     * 另外要求账户存在且启用，避免把文件挂到一个不存在的用户名上
     * （那样文件归属会查无此人，文件管理里谁也看不到）。
     */
    if (useUserStore) {
      const tokenOwner = String(tokenMetas.owner || '').trim();
      const admin = await this.adminUsername();
      const isAdminToken = !tokenOwner || tokenOwner === 'admin' || tokenOwner === admin;
      if (!isAdminToken && tokenOwner !== usernameParam) {
        appLog.warn('token', 'API Token 越权尝试', `token=${auth.token.prefix} owner=${tokenOwner} username=${usernameParam}`);
        return res.status(403).json({ success: false, message: `该 Token 仅可为账户「${tokenOwner}」上传` });
      }
      const targetUser = await prisma.user.findUnique({ where: { username: usernameParam } });
      if (!targetUser || !targetUser.enabled) {
        return res.status(400).json({ success: false, message: `username「${usernameParam}」对应的账户不存在或已禁用` });
      }
    }

    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');

    let channelId = '';
    let backupChannelId = '';
    let owner = '';
    let ignoreUploaderChannel = false;
    if (useUserStore) {
      const mainCh = await this.storageChannel.getStorageChannel(usernameParam, '');
      const backupCh = await this.storageChannel.getStorageChannel(usernameParam, 'backup');
      channelId = mainCh?.id || '';
      backupChannelId = backupCh?.id || '';
      owner = usernameParam;
    } else {
      // 归属账户：Token 上配置的 owner；缺省或历史占位值 'admin' 一律落到真实管理员账户
      const rawOwner = String(tokenMetas.owner || '').trim();
      owner = rawOwner && rawOwner !== 'admin' ? rawOwner : await this.adminUsername();
      /*
       * v1.8.0 接入规则（else 分支的渠道优先级，严格两级）：
       *   存储渠道  = Token 上配置的「存储渠道」→ 全局默认存储渠道
       *   备份渠道  = Token 上配置的「备份渠道」→ 全局备份渠道
       * 在这里显式解析 Token 渠道（而不是依赖 tokenId 的隐式候选链），
       * 并让 upload() 跳过「owner 账户在用户管理里绑定的渠道」—— 否则
       * Token 没配渠道时会被 owner 的账户级绑定插队，与上述规则不符。
       */
      const tokenMainRaw = String(tokenMetas.defaultBucket || '').trim();
      const tokenBackupRaw = String(tokenMetas.defaultBackup || '').trim();
      if (tokenMainRaw) {
        channelId = (await this.storageChannel.findById(tokenMainRaw))?.id || '';
      }
      if (tokenBackupRaw && !NO_BACKUP_VALUES.includes(tokenBackupRaw.toLowerCase())) {
        backupChannelId = (await this.storageChannel.findById(tokenBackupRaw))?.id || '';
      }
      ignoreUploaderChannel = true;
    }

    // 备份开关：走账户分支时只要账户/全局有备份渠道就备份；
    // 走 Token 分支时仍尊重 Token 上配置的「关闭备份」哨兵值。
    const tokenBackupFlag = String(tokenMetas.defaultBackup || '').trim().toLowerCase();
    const backupOff = !useUserStore && NO_BACKUP_VALUES.includes(tokenBackupFlag);

    /*
     * 默认分类目录（v3.0.0 R18）：支持占位符 {tokenName} {user} {y} {m} {d}。
     * 展开在服务端做 —— 同一个 Token 被不同账户 / 不同时间使用时，
     * 目录会按「Token 名称 / 用户名 / 年月日」分别落位。
     */
    const tokenFolder = expandFolderPlaceholders(String(tokenMetas.defaultCategory || ''), {
      tokenName: auth.token.name,
      user: owner,
    });

    const opts = {
      channelId: channelId || undefined,
      // 渠道已在上面按 v1.8.0 规则显式解析，不再让 tokenId 参与隐式候选链
      tokenId: undefined,
      // 分类：Token 的「默认分类目录」（已展开占位符）；留空走「默认上传目录 → 年份/月份」
      uploadFolder: tokenFolder,
      uploadNameType: String(body.nameType || 'default'),
      uploader: owner,
      ip,
      serverCompress: body.compress === 'true' || body.compress === '1',
      compressPercent: Number(body.compressPercent || 0) || 0,
      backup: backupOff ? false : true,
      backupChannelId: backupChannelId || undefined,
      ignoreUploaderChannel,
      autoRetry: body.autoRetry === 'true',
      /*
       * 「类型和大小限制」（Token 编辑里的同名开关，默认开启）：
       *   开启 → 与网页上传一致，受允许格式 + 单文件大小上限约束
       *   关闭 → 跳过这两项限制
       */
      skipFileLimits: auth.token.enforceLimits === false,
      // 上传渠道：走「Web 通用」通道
      uploadSource: 'API-Web',
    };

    try {
      let buffer: Buffer;
      let mime: string;
      let originalName: string;
      if (file) {
        buffer = file.buffer;
        mime = file.mimetype;
        originalName = file.originalname;
      } else if (body.url) {
        const r = await fetch(String(body.url));
        if (!r.ok) return res.status(400).json({ success: false, message: `拉取链接失败 HTTP ${r.status}` });
        buffer = Buffer.from(await r.arrayBuffer());
        mime = r.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
        originalName = decodeURIComponent(String(body.url).split('/').pop() || 'file');
      } else {
        return res.status(400).json({ success: false, message: '缺少 file 或 url' });
      }

      const r = await this.uploadSvc.upload({ buffer, mime, originalName }, opts);
      if (r.error) return res.status(500).json({ success: false, message: r.error });
      // 对外只返回 GoHub 的「签发链接」，并走全站统一出口（自定义访问域名优先）
      const origin = signOrigin(req);
      const prefix = await this.settings.getLinkPrefix(origin);
      // 标识里已带扩展名就不再追加；没有则补上原文件扩展名（仅作标识用）
      const ext = extSuffixFor(r.id, originalName);
      return res.json({
        success: true,
        data: { name: r.id, url: `${prefix}${this.encodePath(r.id)}${ext}`, dedup: !!r.dedup },
      });
    } catch (err) {
      appLog.error('token', 'API Token 上传失败', (err as Error).message, ip);
      return res.status(500).json({ success: false, message: (err as Error).message });
    }
  }

  /* ------------------------------------------------------------------ */
  /* S3 协议                                                             */
  /* ------------------------------------------------------------------ */

  /** 从 Authorization 头解析出 AccessKey */
  private parseSigV4(headers: Record<string, string>) {
    const auth = headers['authorization'] || '';
    const m = /^AWS4-HMAC-SHA256\s+Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]+)$/i.exec(auth);
    if (!m) return null;
    return { accessKey: m[1], dateStamp: m[2], region: m[3], service: m[4], signedHeaders: m[5].split(';'), signature: m[6] };
  }

  /**
   * AWS SigV4 签名校验（简化实现，覆盖 PUT/HEAD/GET Object 场景）。
   * canonical request 的 URI 直接取原始请求路径（与客户端发送的编码保持一致），
   * query 按 key 排序后重新编码。
   */
  private verifySigV4(req: Request, body: Buffer, secretKey: string): { ok: boolean; error?: string } {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v;
    }
    const parsed = this.parseSigV4(headers);
    if (!parsed) return { ok: false, error: '仅支持 AWS4-HMAC-SHA256 签名' };

    const qIdx = req.originalUrl.indexOf('?');
    const path = qIdx === -1 ? req.originalUrl : req.originalUrl.slice(0, qIdx);
    const rawQuery = qIdx === -1 ? '' : req.originalUrl.slice(qIdx + 1);
    const query = rawQuery
      .split('&')
      .filter(Boolean)
      .map((kv) => {
        const i = kv.indexOf('=');
        return i === -1 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)];
      })
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    const canonicalHeaders = parsed.signedHeaders.map((h) => `${h}:${(headers[h] || '').trim()}\n`).join('');
    const payloadHash = headers['x-amz-content-sha256'] || createHash('sha256').update(body).digest('hex');
    const canonicalRequest = [req.method, path, query, canonicalHeaders, parsed.signedHeaders.join(';'), payloadHash].join('\n');

    const scope = `${parsed.dateStamp}/${parsed.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      headers['x-amz-date'] || headers['date'] || '',
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    let k = createHmac('sha256', `AWS4${secretKey}`).update(parsed.dateStamp, 'utf8').digest();
    k = createHmac('sha256', k).update(parsed.region, 'utf8').digest();
    k = createHmac('sha256', k).update('s3', 'utf8').digest();
    k = createHmac('sha256', k).update('aws4_request', 'utf8').digest();
    const expected = createHmac('sha256', k).update(stringToSign, 'utf8').digest('hex');
    if (expected !== parsed.signature) return { ok: false, error: `签名不匹配（accessKey=${parsed.accessKey}）` };
    return { ok: true };
  }

  /** 按 AccessKey 找到对应的 S3 Token 与明文 SecretKey */
  private async findS3Token(
    accessKey: string,
  ): Promise<{
    tokenId: string;
    /** Token 名称（「默认分类目录」占位符 {tokenName} 用） */
    tokenName: string;
    secretKey: string;
    owner: string;
    defaultBackup: string;
    defaultBucket: string;
    defaultCategory: string;
    /** 「类型和大小限制」开关（Token 编辑里配置，默认开启） */
    enforceLimits: boolean;
  } | null> {
    if (!accessKey) return null;
    const rows = await prisma.apiToken.findMany({ where: { type: 's3', enabled: true } });
    for (const t of rows) {
      const metas = JSON.parse(t.metas || '{}');
      if (metas.accessKey === accessKey && metas.secretKeyEnc) {
        try {
          return {
            tokenId: t.id,
            tokenName: String(t.name || '').trim(),
            secretKey: CryptoService.decrypt(metas.secretKeyEnc),
            owner: String(metas.owner || '').trim(),
            defaultBackup: String(metas.defaultBackup || '').trim(),
            defaultBucket: String(metas.defaultBucket || '').trim(),
            defaultCategory: String(metas.defaultCategory || '').trim(),
            enforceLimits: t.enforceLimits !== false,
          };
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  /** 从原始 URL 中还原 Object Key（兼容 bucket 后含多级路径 + 中文） */
  private objectKeyOf(req: Request, bucket: string): string {
    const qIdx = req.originalUrl.indexOf('?');
    const path = qIdx === -1 ? req.originalUrl : req.originalUrl.slice(0, qIdx);
    const after = path.replace(/^\/s3\//, '');
    const key = after.startsWith(`${bucket}/`) ? after.slice(bucket.length + 1) : after.split('/').slice(1).join('/');
    try {
      return decodeURIComponent(key);
    } catch {
      return key;
    }
  }

  /** ListBuckets：把可用渠道作为 bucket 列出（便于 s3 客户端浏览） */
  @Get('s3')
  async listBuckets(@Req() req: Request, @Res() res: Response) {
    const channels = await prisma.channel.findMany({ where: { enabled: true }, orderBy: { code: 'asc' } });
    const xml = channels
      .map((c) => `  <Bucket><Name>${c.code}</Name><CreationDate>${c.createdAt.toISOString()}</CreationDate></Bucket>`)
      .join('\n');
    void req;
    res.setHeader('Content-Type', 'application/xml');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<ListAllMyBucketsResult><Buckets>\n${xml}\n</Buckets></ListAllMyBucketsResult>`);
  }

  /** 上传对象：PUT /s3/<bucket>/<key> */
  @Put('s3/*')
  async putObject(@Req() req: Request, @Res() res: Response) {
    const rawPath = req.originalUrl.split('?')[0];
    const after = rawPath.replace(/^\/s3\/?/, '');
    const bucket = after.split('/')[0] ? decodeURIComponent(after.split('/')[0]) : '';
    if (!bucket) return res.status(400).send('缺少 bucket');

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k.toLowerCase()] = v;
    const parsed = this.parseSigV4(headers);
    if (!parsed) return res.status(403).send('仅支持 AWS4-HMAC-SHA256 签名');
    const found = await this.findS3Token(parsed.accessKey);
    if (!found) return res.status(403).send('AccessKey 无效或已禁用');

    const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const check = this.verifySigV4(req, body, found.secretKey);
    if (!check.ok) {
      appLog.warn('token', 'S3 签名校验失败', check.error);
      return res.status(403).send(check.error || '签名校验失败');
    }

    const key = this.objectKeyOf(req, bucket);
    // bucket 段即渠道 ID（6 位 code / 主键 id）；无效或未填时由 StorageChannelService
    // 依次退回「该 Token 配置的默认渠道 → 账户级 → 全局主渠道」。绝不臆造其它渠道。
    const channelId = await this.resolveChannelId(bucket);
    const ip = String(headers['x-forwarded-for'] || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    const originalName = key.split('/').pop() || key;
    const owner = found.owner && found.owner !== 'admin' ? found.owner : await this.adminUsername();
    const backupOff = NO_BACKUP_VALUES.includes(String(found.defaultBackup || '').trim().toLowerCase());
    /*
     * 逻辑分类目录（folder）：优先用 Token 上配置的「默认分类目录」。
     * 早前 S3 通道完全没传 folder，导致「默认分类目录」形同虚设 ——
     * 文件一律落到全局默认目录（或按 年/月 自动分类）。
     * v3.0.0（R18）：支持占位符 {tokenName} {user} {y} {m} {d}，与 Web 通用通道共用同一实现。
     * 留空时交给 UploadService 走「后台上传设置 → 年/月」的既有兜底。
     */
    const uploadFolder = expandFolderPlaceholders(String(found.defaultCategory || ''), {
      tokenName: found.tokenName,
      user: owner,
    });
    try {
      const r = await this.uploadSvc.upload(
        { buffer: body, mime: headers['content-type'] || 'application/octet-stream', originalName },
        {
          channelId: channelId || undefined,
          tokenId: found.tokenId, // Token 上配置的默认主/备渠道
          uploadNameType: 'default',
          uploadFolder, // Token 的「默认分类目录」
          uploader: owner, // 归属 Token 设定的账户，缺省为管理员
          ip,
          // 用客户端上传时的 Object Key 作为对外文件标识：
          // 这样客户端拿「自定义域名 + key」自行拼出的地址，恰好就是本站的签发链接。
          presetFileId: key,
          backup: !backupOff,
          /*
           * 「类型和大小限制」（Token 编辑里的同名开关，默认开启）：
           *   开启 → 受允许格式 + 单文件大小上限约束
           *   关闭 → 跳过这两项限制
           * 与「Web 通用」通道共用同一套判定，S3 与 Web 两种 Token 行为一致。
           */
          skipFileLimits: found.enforceLimits === false,
          // 上传渠道：走「S3 协议」通道
          uploadSource: 'API-S3',
        },
      );
      if (r.error) return res.status(500).send(r.error);
      void prisma.apiToken.update({ where: { id: found.tokenId }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
      res.setHeader('ETag', `"${createHash('md5').update(body).digest('hex')}"`);
      /*
       * ★ 请求追踪标识必须是纯 ASCII。
       *   早期这里直接写 r.id（= 客户端上传的 Object Key）：文件名含中文时，
       *   Node 的 setHeader 抛 ERR_INVALID_CHAR，整请求以 500 结束（文件却已入库）。
       *   现改为每次请求随机生成，与 AWS S3 的 request-id 语义一致。
       */
      res.setHeader('x-amz-request-id', randomBytes(16).toString('hex').toUpperCase());
      /*
       * 对外只签发 GoHub 的链接（走全站统一出口，自定义访问域名优先）：
       * 同时放进标准 Location 头与自定义头，方便客户端/网关直接取用，
       * 避免客户端拿 endpoint + bucket + key 自行拼出一个无法访问的地址。
       */
      const origin = signOrigin(req);
      const prefix = await this.settings.getLinkPrefix(origin);
      // 标识（= 客户端上传的 Object Key）里已带扩展名就不再追加
      const signedUrl = `${prefix}${this.encodePath(r.id)}${extSuffixFor(r.id, originalName)}`;
      this.setSafeHeader(res, 'Location', signedUrl);
      this.setSafeHeader(res, 'x-gohub-url', signedUrl);
      // 文件标识（按路径段 URI 编码，纯 ASCII）：供不便解析 URL 的客户端直接取用
      this.setSafeHeader(res, 'x-gohub-id', this.encodePath(r.id));
      return res.status(200).send('');
    } catch (err) {
      appLog.error('token', 'S3 上传失败', (err as Error).message, ip);
      return res.status(500).send((err as Error).message);
    }
  }

  /** 探测对象：HEAD /s3/<bucket>/<key>（按 key 末段匹配本系统文件） */
  @Head('s3/*')
  async headObject(@Req() req: Request, @Res() res: Response) {
    const bucket = decodeURIComponent(req.originalUrl.split('?')[0].replace(/^\/s3\/?/, '').split('/')[0]);
    const key = this.objectKeyOf(req, bucket);
    const rec = await prisma.fileRecord.findFirst({
      where: { status: 'active', OR: [{ name: key }, { originalName: key.split('/').pop() || key }] },
    });
    return rec ? res.status(200).send('') : res.status(404).send('');
  }

  /**
   * 删除对象：DELETE /s3/<bucket>/<key>
   *
   * 契约与 AWS S3 对齐：删除成功 **204 No Content**；对象不存在 **404**；
   * 签名/凭据问题 403（幂等 —— 重复删除同一个 key 第二次得到 404，符合 S3 语义）。
   *
   * 删除语义 = **软删除进回收站**：只改 `files.status='deleted'`（不动远端副本，
   * 客户端拼的外链即刻 404）。远端副本与库记录在回收站里「彻底删除」时才真正清理
   * （复用 `UploadService.removeFile`）；S3 客户端重新 PUT 同名 key 时也会自动让位。
   * 对客户端表现与真删除一致：被删 key 立刻 404、重复 DELETE 第二次得到 404（幂等），
   * 但管理员在回收站里仍可反悔 —— 这是比"真删"更安全的默认值。
   *
   * 兼容性说明：早期本通道只实现了 GET /s3、PUT /s3/*、HEAD /s3/*，
   * 任何 DELETE 都会落到 Nest 404，导致第三方插件「上传成功但删除永远失败」。
   */
  @Delete('s3/*')
  async deleteObject(@Req() req: Request, @Res() res: Response) {
    const rawPath = req.originalUrl.split('?')[0];
    const after = rawPath.replace(/^\/s3\/?/, '');
    const bucket = after.split('/')[0] ? decodeURIComponent(after.split('/')[0]) : '';
    if (!bucket) return res.status(400).send('缺少 bucket');

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k.toLowerCase()] = v;
    const parsed = this.parseSigV4(headers);
    if (!parsed) return res.status(403).send('仅支持 AWS4-HMAC-SHA256 签名');
    const found = await this.findS3Token(parsed.accessKey);
    if (!found) return res.status(403).send('AccessKey 无效或已禁用');

    /*
     * DELETE 无请求体：客户端通常声明 `x-amz-content-sha256: UNSIGNED-PAYLOAD`，
     * verifySigV4 优先取该头参与签名；仅当客户端没带时才回落到对 body 求 sha256，
     * 两种写法都能通过校验。
     */
    const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const check = this.verifySigV4(req, body, found.secretKey);
    if (!check.ok) {
      appLog.warn('token', 'S3 删除签名校验失败', check.error);
      return res.status(403).send(check.error || '签名校验失败');
    }

    const key = this.objectKeyOf(req, bucket);
    // 与 HEAD 相同的定位口径：既接受完整 File_ID，也接受补了扩展名的写法；
    // 只匹配 active —— 已在回收站的 key 对客户端等同"不存在"（幂等：重复 DELETE → 404）
    const record = await prisma.fileRecord.findFirst({
      where: { status: 'active', OR: [{ name: key }, { name: key.replace(/\.[^.]*$/, '') }] },
    });
    if (!record) return res.status(404).send('NoSuchKey');

    try {
      await this.uploadSvc.softDeleteFile(record.id, record.name);
    } catch (err) {
      appLog.error('token', 'S3 删除失败', `${record.name}：${(err as Error).message}`);
      return res.status(500).send((err as Error).message);
    }
    void prisma.apiToken.update({ where: { id: found.tokenId }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    appLog.info('token', 'S3 删除对象（进回收站）', `${record.name} ｜ bucket=${bucket}`);
    return res.status(204).send('');
  }
}
