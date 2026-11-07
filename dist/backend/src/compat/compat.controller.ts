/**
 * 兼容接口层 —— 补齐 Sanyue-ImgHub 前端调用、而 GoHub 后端尚未提供的接口。
 *
 * 覆盖范围：
 *   - 公开：/api/bing/wallpaper
 *   - 管理：apiTokens / quota / tags / move / cusConfig / batch（索引与备份）
 *   - AI 相关：保留路由但返回「未启用」（AI 模块按方案裁剪）
 *
 * 约定：所有返回结构严格对齐前端既有解析逻辑，避免页面报错。
 */
import { signOrigin } from '../common/request-origin';
import { Body, Controller, Delete, Get, Header, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { createHash, randomBytes } from 'crypto';
import { prisma } from '../common/prisma';
import { TAG_TYPE_FILE, findOrCreateTag } from '../common/tags';
import { CryptoService } from '../common/crypto.service';
import { AdminGuard, currentSession } from '../auth/auth.guard';
import { SettingsService } from '../settings/settings.service';
import { SysConfigService } from '../settings/sysconfig.service';
import { serializeFile } from '../common/file-view';
import { appLog } from '../common/app-log';
import { ipDisplayBatch } from '../common/ip-query';

/**
 * 读取通配路由（`xxx/*`）捕获到的完整路径。
 * File_ID 允许含目录层级（如 `风景/2026/abc`），普通 `:param` 不匹配斜杠。
 */
function wildcardParam(req: Request): string {
  const raw = String((req.params as Record<string, string>)['0'] ?? '');
  if (!raw) return '';
  if (!/%[0-9a-fA-F]{2}/.test(raw)) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** 解析 settings 里以 JSON 数组或逗号/换行分隔存储的 IP 列表 */
function parseIpList(raw: string): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
  } catch {
    /* fallthrough */
  }
  return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

function parseStrArray(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * v1.0.0：标签归属过滤条件（按用户隔离）。
 *
 * 现代码里标签按「实例 + 用户」双重隔离，这里只负责「用户」这一半；
 * 另外放行 owner='' 的历史标签 —— v1.0.0 迁移脚本会把存量标签回填到上传者名下，
 * 万一有遗漏（例如旧版本写入的公共标签），也要保证老数据仍然可见，不能凭空消失。
 */
/**
 * v1.0.0 标签归属作用域（标签只读接口用）。
 *
 * 归属维度是 (owner, instanceId)：每个用户在自己每个实例下各有一份标签。
 *   · 已登录 → 只看/只取自己名下的标签；
 *   · 未登录 → 一条都不返回。原来这里返回空对象 `{}`，等于把该实例下
 *     **所有用户**的标签名一起吐出来（接口本身没有登录守卫）。
 */
/**
 * v1.0.2：标签查询的公共作用域。
 *
 * 旧实现在这里按 owner 收窄（只返回自己的标签）。新模型下标签属于「实例 + 类型 + 名称」，
 * 实例内成员共用一套，因此这里只限定类型（文件标签）；实例条件由调用方补。
 * 未登录时返回「永不命中」的条件，避免把全库标签吐出去。
 */
function tagOwnerScope(req: Request): { type?: string; id?: { in: string[] } } {
  const me = currentSession(req)?.user || '';
  return me ? { type: TAG_TYPE_FILE } : { id: { in: [] } };
}

/* ------------------------------------------------------------------ */
/* 公开接口                                                            */
/* ------------------------------------------------------------------ */

@Controller('api')
export class PublicCompatController {
  /** 必应壁纸（前端背景图用）。本地部署默认返回空列表，前端会静默跳过。 */
  @Get('bing/wallpaper')
  bingWallpaper() {
    return { data: [] as { url: string }[] };
  }
}

/* ------------------------------------------------------------------ */
/* 管理接口                                                            */
/* ------------------------------------------------------------------ */

@Controller('api/manage')
@UseGuards(AdminGuard)
export class ManageCompatController {
  constructor(
    private settings: SettingsService,
    private sysConfig: SysConfigService,
  ) {}

  /**
   * 管理员账户名 —— API Token 上传的文件统一归属这个账户。
   * 取值优先级与「用户管理」保持一致：安全设置 adminUsername > ADMIN_USER > SUPER_ADMIN_USERNAME > admin。
   * （早期实现把 owner 写成字符串 'admin'，而真实管理员账号是 fain126，
   *   导致 Token 上传的文件在「按用户账户归集」里挂在一个不存在的账户下）
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

  /* ---------------- API Token ----------------
   * 两套自有规则（type）：
   *   web —— 外部用自定义 Web 通道接入：POST /api/token/upload，携带本 Token，
   *          Body 可指定 category(分类) / bucket(存储渠道 ID/名称) / backup(备份渠道 ID/名称)。
   *   s3  —— S3 协议接入：创建时生成 AccessKey / SecretKey / Region，
   *          Endpoint = <本站域名>/s3，Path-Style 寻址，PUT /s3/<bucket>/<key> 即可上传。
   * 两类 Token 上传的文件都归属管理员账户。
   */

  @Get('apiTokens')
  async listTokens(@Req() req: Request) {
    const rows = await prisma.apiToken.findMany({ orderBy: { createdAt: 'desc' } });
    const origin = signOrigin(req);
    return {
      tokens: rows.map((t) => {
        const metas = JSON.parse(t.metas || '{}');
        const type = t.type || metas.type || 'web';
        /**
         * 凭据「一直可查看、可复制」——
         * 早期实现只回显 `gb_••••••`，SecretKey 更是创建后即丢失；
         * 现在明文/密文都落库（AES-GCM 加密），管理接口按需解密返回，
         * 用户可以随时在界面上复制，不用「建完就找不回来」。
         * 注意：该接口受 AdminGuard 保护，仅管理员可见。
         */
        let plain = '';
        if (type === 's3') {
          // AccessKey 明文存 metas，SecretKey 加密存储
          plain = '';
        } else if (metas.tokenEnc) {
          try {
            plain = CryptoService.decrypt(metas.tokenEnc);
          } catch {
            plain = '';
          }
        }
        let secretKey = '';
        if (type === 's3' && metas.secretKeyEnc) {
          try {
            secretKey = CryptoService.decrypt(metas.secretKeyEnc);
          } catch {
            secretKey = '';
          }
        }
        return {
          id: t.id,
          name: t.name,
          type,
          // 兼容旧字段：web 类型显示明文；若历史数据没存密文，退回掩码占位
          token: type === 'web' ? plain || `${t.prefix}••••••••••••` : '',
          prefix: t.prefix,
          owner: metas.owner || 'admin',
          permissions: parseStrArray(t.permissions),
          enabled: t.enabled,
          // 「类型和大小限制」：默认开启；关闭后该 Token 传入的文件不受格式与大小上限约束
          enforceLimits: t.enforceLimits !== false,
          createdAt: t.createdAt,
          lastUsedAt: t.lastUsedAt,
          expiresAt: metas.expiresAt || null,
          autoDelete: !!metas.autoDelete,
          // S3 类型的完整接入信息
          endpoint: type === 's3' ? `${origin}/s3` : '',
          accessKey: metas.accessKey || '',
          secretKey,
          region: metas.region || '',
          defaultBucket: metas.defaultBucket || '',
          defaultBackup: metas.defaultBackup || '',
          defaultCategory: metas.defaultCategory || '',
        };
      }),
    };
  }

  @Post('apiTokens')
  async createToken(
    @Req() req: Request,
    @Body()
    body: {
      name?: string;
      type?: string;
      owner?: string;
      permissions?: string[];
      expiresAt?: string | null;
      autoDelete?: boolean;
      /** 「类型和大小限制」：默认开启（web 与 s3 两种 Token 均适用） */
      enforceLimits?: boolean;
      region?: string;
      defaultBucket?: string;
      defaultBackup?: string;
      defaultCategory?: string;
    },
  ) {
    const type = body.type === 's3' ? 's3' : 'web';
    // S3 类型：生成 AccessKey / SecretKey（明文加密落库，AdminGuard 保护下可随时回显复制）
    const accessKey = type === 's3' ? `gbk${randomBytes(10).toString('hex')}` : '';
    const secretKey = type === 's3' ? randomBytes(20).toString('hex') : '';
    // web 类型：生成 gb_ 前缀的 Bearer Token
    const raw = type === 'web' ? `gb_${randomBytes(24).toString('hex')}` : `s3_${randomBytes(24).toString('hex')}`;
    const tokenHash = createHash('sha256').update(type === 's3' ? `${accessKey}:${secretKey}` : raw).digest('hex');

    const created = await prisma.apiToken.create({
      data: {
        name: body.name || 'token',
        type,
        tokenHash,
        prefix: type === 'web' ? `gb_${raw.slice(3, 11)}` : accessKey.slice(0, 11),
        permissions: JSON.stringify(body.permissions || []),
        // 「类型和大小限制」：默认开启（未显式传 false 即视为开启）
        enforceLimits: body.enforceLimits !== false,
        metas: JSON.stringify({
          type,
          // owner = Token 上传文件的归属账户；缺省 / 旧值 'admin' 一律落到真实管理员账户
          owner: (() => {
            const o = String(body.owner || '').trim();
            return o && o !== 'admin' ? o : undefined;
          })() || (await this.adminUsername()),
          expiresAt: body.expiresAt || null,
          autoDelete: !!body.autoDelete,
          // 默认上传参数（选填）：不传时该 Token 使用系统默认
          defaultBucket: String(body.defaultBucket || '').trim(),
          defaultBackup: String(body.defaultBackup || '').trim(),
          defaultCategory: String(body.defaultCategory || '').trim(),
          ...(type === 's3'
            ? {
                accessKey,
                secretKeyEnc: CryptoService.encrypt(secretKey),
                // Region 由系统统一定义（客户端一律填 us-east-1，服务端不校验取值）
                region: 'us-east-1',
              }
            : { tokenEnc: CryptoService.encrypt(raw) }),
        }),
      },
    });
    const origin = signOrigin(req);
    // 创建时返回明文凭据（列表中也可再次查看）
    return {
      success: true,
      token: raw,
      data: {
        id: created.id,
        name: created.name,
        type,
        token: type === 'web' ? raw : '',
        endpoint: type === 's3' ? `${origin}/s3` : '',
        accessKey,
        secretKey,
        region: type === 's3' ? 'us-east-1' : '',
        permissions: parseStrArray(created.permissions),
        enforceLimits: created.enforceLimits !== false,
        createdAt: created.createdAt,
        expiresAt: body.expiresAt || null,
      },
    };
  }

  @Put('apiTokens')
  async updateToken(
    @Body()
    body: {
      tokenId?: string;
      name?: string;
      permissions?: string[];
      expiresAt?: string | null;
      autoDelete?: boolean;
      enabled?: boolean;
      /** 「类型和大小限制」：默认开启（web 与 s3 两种 Token 均适用） */
      enforceLimits?: boolean;
      region?: string;
      defaultBucket?: string;
      defaultBackup?: string;
      defaultCategory?: string;
    },
  ) {
    if (!body.tokenId) return { success: false, error: '缺少 tokenId' };
    const cur = await prisma.apiToken.findUnique({ where: { id: body.tokenId } });
    if (!cur) return { success: false, error: 'Token 不存在' };
    const metas = JSON.parse(cur.metas || '{}');
    metas.expiresAt = body.expiresAt ?? metas.expiresAt ?? null;
    metas.autoDelete = body.autoDelete ?? metas.autoDelete ?? false;
    if (body.defaultBucket !== undefined) metas.defaultBucket = String(body.defaultBucket || '').trim();
    if (body.defaultBackup !== undefined) metas.defaultBackup = String(body.defaultBackup || '').trim();
    if (body.defaultCategory !== undefined) metas.defaultCategory = String(body.defaultCategory || '').trim();
    // Region 由系统统一定义为 us-east-1，不再由前端配置
    metas.region = 'us-east-1';
    await prisma.apiToken.update({
      where: { id: body.tokenId },
      data: {
        name: body.name ? String(body.name) : cur.name,
        permissions: body.permissions ? JSON.stringify(body.permissions) : cur.permissions,
        enabled: body.enabled ?? cur.enabled,
        // 「类型和大小限制」：未传时保持原值（创建时默认为开启）
        enforceLimits: body.enforceLimits === undefined ? cur.enforceLimits : !!body.enforceLimits,
        metas: JSON.stringify(metas),
      },
    });
    return { success: true };
  }

  @Delete('apiTokens')
  async deleteToken(@Query('id') id: string) {
    if (!id) return { success: false, error: '缺少 id' };
    await prisma.apiToken.delete({ where: { id } }).catch(() => null);
    return { success: true };
  }

  /* ---------------- 容量统计 ---------------- */

  @Get('quota')
  async getQuota() {
    return { success: true, quotaStats: await this.channelStats() };
  }

  @Post('quota')
  async refreshQuota() {
    return { success: true, channelStats: await this.channelStats() };
  }

  private async channelStats() {
    const channels = await prisma.channel.findMany();
    const copies = await prisma.fileCopy.findMany({
      where: { status: 'active' },
      include: { file: { select: { size: true } } },
    });
    const out: Record<string, { usedMB: number; fileCount: number; limitMB: number }> = {};
    for (const c of channels) {
      const mine = copies.filter((x) => x.channelId === c.id);
      const bytes = mine.reduce((a, b) => a + (b.file?.size || 0), 0);
      out[c.name] = { usedMB: Math.round((bytes / 1024 / 1024) * 100) / 100, fileCount: mine.length, limitMB: 0 };
    }
    return out;
  }

  /* ---------------- 标签 ---------------- */

  /**
   * 标签自动补全。
   * v1.0.0：按「实例 + 用户」双重隔离 —— 只返回当前实例下、当前账户自己的标签，
   * 不再把其它实例 / 其它用户的标签一起吐出来（原来这里连 instanceId 条件都没有）。
   */
  @Get('tags/autocomplete')
  async tagAutocomplete(@Req() req: Request, @Query() q: { prefix?: string; limit?: string; instanceId?: string }) {
    const limit = Math.min(50, Math.max(1, Number(q.limit || 10)));
    const prefix = (q.prefix || '').trim();
    const rows = await prisma.tag.findMany({
      where: {
        instanceId: String(q.instanceId ?? ''),
        ...tagOwnerScope(req),
        ...(prefix ? { name: { startsWith: prefix } } : {}),
      },
      orderBy: { name: 'asc' },
      take: limit,
    });
    return { tags: rows.map((t) => t.name) };
  }

  /**
   * 全部标签（含使用次数）—— 文件管理「标签筛选」弹窗用。
   * 必须声明在 `tags/*` 之前，否则会被通配路由吃掉。
   * v1.0.0：同 autocomplete，限定当前实例 + 当前账户。
   */
  @Get('tags/all')
  async tagsAll(@Req() req: Request, @Query() q: { instanceId?: string }) {
    const rows = await prisma.tag.findMany({
      where: { instanceId: String(q.instanceId ?? ''), ...tagOwnerScope(req) },
      include: { _count: { select: { files: true } } },
      orderBy: { name: 'asc' },
    });
    return {
      // v2.9.0：附带 createdAt —— 筛选弹窗「标签」页默认按「最近创建」倒序取前 30 个
      tags: rows.map((t) => ({ name: t.name, count: t._count?.files || 0, createdAt: t.createdAt })),
    };
  }

  @Post('tags/apply')
  async tagsApply(@Req() req: Request, @Body() body: { fileIds?: string[]; tags?: string[]; action?: string }) {
    const ids = body.fileIds || [];
    const me = currentSession(req)?.user || '';
    for (const id of ids) await this.applyTags(id, body.tags || [], body.action || 'add', me);
    return { success: true, count: ids.length };
  }

  /**
   * 批量打标签 / 删标签 / 清空标签。
   *
   * v3.0.0（R17）修复「提示失败但实际已经加上标签」：
   *   前端 BatchTagDialog 的 finishTagOperation() 依赖 `results` 逐条回填，
   *   而这里原先只返回 `{ success, count }` —— 前端拿到 undefined 去 for...of
   *   直接抛 TypeError，被外层 catch 当成失败弹「添加失败」，可后端其实已经写库成功。
   *   现在按前端约定的结构返回：{ success, updated, results:[{ fileId, saved, tags, indexPending }] }。
   *
   * action：add = 追加 / remove = 删除指定标签 / set = 全量覆盖（先清空再写，tags 为空即清空）。
   */
  @Post('tags/batch')
  async tagsBatch(@Req() req: Request, @Body() body: { fileIds?: string[]; tags?: string[]; action?: string }) {
    const ids = Array.isArray(body.fileIds) ? body.fileIds : [];
    const me = currentSession(req)?.user || '';
    const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [];
    const raw = String(body.action || 'add').toLowerCase();
    const action = raw === 'remove' || raw === 'set' ? raw : 'add';
    const results: Array<{ fileId: string; saved: boolean; tags: string[]; indexPending: boolean; error?: string }> = [];
    for (const id of ids) {
      const rec = await this.findFile(id);
      if (!rec) {
        results.push({ fileId: String(id), saved: false, tags: [], indexPending: false, error: '文件不存在' });
        continue;
      }
      let savedTags: string[] = [];
      if (action === 'set') {
        // 全量覆盖：清空该文件的全部标签，再按需写入
        await prisma.fileTag.deleteMany({ where: { fileId: rec.id } });
        savedTags = tags.length ? await this.applyTags(id, tags, 'add', me) : [];
      } else {
        savedTags = await this.applyTags(id, tags, action, me);
      }
      results.push({ fileId: String(id), saved: true, tags: savedTags, indexPending: false });
    }
    const updated = results.filter((r) => r.saved).length;
    return {
      // 一条都没传 / 有文件没保存成功 → success=false（前端据此提示「部分保存」）
      success: ids.length > 0 && updated === ids.length,
      updated,
      count: ids.length,
      results,
    };
  }

  @Get('tags/*')
  async getTags(@Req() req: Request) {
    const rec = await this.findFile(wildcardParam(req));
    if (!rec) return { tags: [] };
    const rows = await prisma.fileTag.findMany({ where: { fileId: rec.id }, include: { tag: true } });
    return { tags: rows.map((r) => r.tag.name) };
  }

  @Post('tags/*')
  async updateTags(@Req() req: Request, @Body() body: { action?: string; tags?: string[] }) {
    const key = wildcardParam(req);
    const rec = await this.findFile(key);
    if (!rec) return { success: false, error: '文件不存在', tags: [] };
    const tags = await this.applyTags(key, body.tags || [], body.action || 'add', currentSession(req)?.user || '');
    return { success: true, tags, indexPending: false };
  }

  /** 兼容前端：fileId 传的是 File_ID（也可能是数据库主键） */
  private async findFile(key: string) {
    const k = String(key || '');
    const bare = k.replace(/\.[^.]*$/, '');
    return prisma.fileRecord.findFirst({ where: { OR: [{ id: k }, { name: k }, { name: bare }] } });
  }

  /**
   * v1.0.0：标签写入。
   * 归属口径改成「文件所在实例 + 操作者账户」—— 原来 instanceId 恒为空串、也没有 owner，
   * 于是任何一笔批量打标签都会在默认实例里建出所有人可见的公共标签（串实例 / 串用户）。
   */
  private async applyTags(fileKey: string, tags: string[], action: string, owner = ''): Promise<string[]> {
    const rec = await this.findFile(fileKey);
    if (!rec) return [];
    // 标签跟随文件所在实例（文件记录上的 instanceId，空串 = 默认实例）
    const instanceId = String(rec.instanceId || '');
    const tagOwner = String(owner || rec.uploader || '');
    for (const raw of tags) {
      const name = String(raw).trim();
      if (!name) continue;
      // v1.0.2：标签按「实例 + 类型 + 名称」确权，owner 只记创建人
      const tag = await findOrCreateTag(name, instanceId, tagOwner, TAG_TYPE_FILE);
      if (action === 'remove') {
        await prisma.fileTag.deleteMany({ where: { fileId: rec.id, tagId: tag.id } });
      } else {
        await prisma.fileTag.upsert({
          where: { fileId_tagId: { fileId: rec.id, tagId: tag.id } },
          update: {},
          create: { fileId: rec.id, tagId: tag.id },
        });
      }
    }
    const rows = await prisma.fileTag.findMany({ where: { fileId: rec.id }, include: { tag: true } });
    return rows.map((r) => r.tag.name);
  }

  /* ---------------- 移动（文件 / 文件夹） ---------------- */

  @Get('move/*')
  async move(@Req() req: Request, @Query() q: { folder?: string; dist?: string }) {
    const key = wildcardParam(req);
    const dist = (q.dist || '').replace(/^\/+|\/+$/g, '');
    if (q.folder === 'true') {
      // 移动整个目录：仅改 folder 前缀（真实存储路径不变）
      const oldPrefix = key.replace(/\/+$/, '');
      const rows = await prisma.fileRecord.findMany({
        where: { OR: [{ folder: oldPrefix }, { folder: { startsWith: `${oldPrefix}/` } }] },
      });
      for (const r of rows) {
        const suffix = r.folder.slice(oldPrefix.length).replace(/^\/+/, '');
        await prisma.fileRecord.update({
          where: { id: r.id },
          data: { folder: suffix ? `${dist}/${suffix}` : dist },
        });
      }
      return { success: true, moved: rows.length };
    }
    const rec = await this.findFile(key);
    if (!rec) return { success: false, error: '文件不存在' };
    await prisma.fileRecord.update({ where: { id: rec.id }, data: { folder: dist } });
    return { success: true };
  }

  /* ---------------- 用户管理（按 IP 汇总） ---------------- */

  @Get('cusConfig/list')
  async cusList(@Query() q: { start?: string; count?: string }) {
    const start = Math.max(0, Number(q.start || 0));
    const count = Math.min(500, Math.max(1, Number(q.count || 20)));
    const grouped = await prisma.fileRecord.groupBy({
      by: ['ip'],
      where: { status: 'active' },
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
    });
    const ips = grouped.map((g) => g.ip).filter(Boolean);
    const records = await prisma.ipRecord.findMany({ where: { ip: { in: ips } } });
    const addrOf = new Map(records.map((r) => [r.ip, [r.country, r.region, r.city].filter(Boolean).join(' ')]));
    // v2.6.0 #301：全系统 IP 显示统一 —— 附带格式化后的展示文本
    let displayOf = new Map<string, string>();
    try {
      displayOf = await ipDisplayBatch(ips, addrOf, this.sysConfig);
    } catch {
      /* 忽略 */
    }
    return grouped
      .filter((g) => g.ip)
      .slice(start, start + count)
      .map((g) => ({
        ip: g.ip,
        address: addrOf.get(g.ip) || '',
        display: displayOf.get(g.ip) || '',
        count: g._count._all,
      }));
  }

  /**
   * 展开某一行时的文件列表。
   *   ip=<地址>          —— 「按 IP 归集」用
   *   uploader=<用户名>  —— 「按用户账户归集」用
   * 两者互斥；都不传则返回空列表，避免误把全库文件吐出去。
   */
  @Get('cusConfig/files')
  async cusFiles(@Query() q: { ip?: string; uploader?: string; count?: string }) {
    const ip = q.ip || '';
    const uploader = q.uploader || '';
    if (!ip && !uploader) return { data: [] };
    const count = Math.min(2000, Math.max(1, Number(q.count || 100)));
    const rows = await prisma.fileRecord.findMany({
      where: { status: 'active', ...(ip ? { ip } : { uploader }) },
      orderBy: { createdAt: 'desc' },
      take: count,
      include: { copies: { include: { channel: true } }, tags: { include: { tag: true } } },
    });
    return { data: rows.map((r) => serializeFile(r, r.copies, { tags: r.tags.map((t) => t.tag.name) })) };
  }

  @Post('cusConfig/whiteip')
  async cusWhite(@Body() body: string | { ip?: string }) {
    const ip = this.readIp(body);
    if (!ip) return { success: false };
    const list = parseIpList(await this.settings.get('whiteIpList', '[]'));
    const block = parseIpList(await this.settings.get('blockIpList', '[]')).filter((x) => x !== ip);
    await this.settings.set('whiteIpList', JSON.stringify(Array.from(new Set([...list, ip]))));
    await this.settings.set('blockIpList', JSON.stringify(block));
    await prisma.ipRecord.upsert({
      where: { ip },
      update: { whitelisted: true, blocked: false },
      create: { ip, whitelisted: true },
    });
    return { success: true };
  }

  @Post('cusConfig/blockip')
  async cusBlock(@Body() body: string | { ip?: string }) {
    const ip = this.readIp(body);
    if (!ip) return { success: false };
    const list = parseIpList(await this.settings.get('blockIpList', '[]'));
    const white = parseIpList(await this.settings.get('whiteIpList', '[]')).filter((x) => x !== ip);
    await this.settings.set('blockIpList', JSON.stringify(Array.from(new Set([...list, ip]))));
    await this.settings.set('whiteIpList', JSON.stringify(white));
    await prisma.ipRecord.upsert({
      where: { ip },
      update: { blocked: true, whitelisted: false },
      create: { ip, blocked: true },
    });
    return { success: true };
  }

  /** 黑名单列表：前端按纯文本 split(',') 解析 */
  @Get('cusConfig/blockipList')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async cusBlockList() {
    return parseIpList(await this.settings.get('blockIpList', '[]')).join(',');
  }

  private readIp(body: string | { ip?: string }): string {
    if (typeof body === 'string') return body.trim();
    if (body && typeof body === 'object' && body.ip) return String(body.ip).trim();
    return '';
  }

  /* ---------------- 索引 / 备份（简化实现） ----------------
   * GoHub 使用 SQLite，列表查询本就是实时的，无需倒排索引。
   * 这些接口保留是为了让前端的「重建索引 / 导出备份」流程可正常走完。
   */

  /** 配置备份覆盖的分区（sysConfig 的整段 JSON） */
  private static readonly CONFIG_SECTIONS = ['page', 'upload', 'others', 'security', 'ai'] as const;

  /**
   * 配置备份（v2.8.5）：
   * 前端「系统状态 → 配置备份」拿这份数据写 JSON。
   * 只有 page / upload / others / security / ai 五个分区 —— 不再导出文件记录，
   * 备份文件小、生成快，恢复时也不会碰已上传的文件。
   */
  @Get('batch/settings')
  async batchSettings() {
    const settings: Record<string, any> = {};
    for (const section of ManageCompatController.CONFIG_SECTIONS) {
      try {
        // security 必须读【原始存储】：get() 会把口令/密钥脱敏成空串，脱敏值回灌等于抹掉口令
        settings[section] =
          section === 'security' ? await this.sysConfig.readSecurityRaw() : await this.sysConfig.get(section);
      } catch (err) {
        appLog.warn('config', `配置备份：读取分区 ${section} 失败`, (err as Error).message);
      }
    }
    appLog.info('config', '导出配置备份', `分区：${Object.keys(settings).join(' / ') || '无'}`);
    return { settings };
  }

  @Get('batch/index/config')
  async indexConfig() {
    return { success: true, chunkSize: 500, databaseType: 'sqlite' };
  }

  @Post('batch/index/chunk')
  async indexChunk() {
    return { success: true };
  }

  @Post('batch/index/finalize')
  async indexFinalize() {
    const started = Date.now();
    try {
      // 简化索引：SQLite 原生索引已够用，这里做一次重建 + 统计信息刷新 + 空间整理
      await prisma.$executeRawUnsafe('REINDEX');
      await prisma.$executeRawUnsafe('ANALYZE');
      await prisma.$executeRawUnsafe('VACUUM');
      const [files, copies] = await Promise.all([
        prisma.fileRecord.count(),
        prisma.fileCopy.count(),
      ]);
      return {
        success: true,
        message: `索引已重建并整理完成（${files} 个文件 / ${copies} 个副本，耗时 ${Date.now() - started}ms）`,
        data: { files, copies, elapsedMs: Date.now() - started },
      };
    } catch (err) {
      return { success: false, message: `索引维护失败: ${(err as Error).message}` };
    }
  }

  /**
   * 恢复配置（v2.8.5）：
   * 前端把备份里的 settings 分批 POST 过来（type='settings'，data = { 分区名: 分区内容 }）。
   * security 走 writeSecurityRaw —— 备份里的口令是散列/密文，不能再散列一遍；
   * 其余分区走 save() 的深合并，只覆盖备份里带的字段。
   * type='files' 的分块（旧版全量备份）这里直接跳过，不写入任何文件表。
   */
  @Post('batch/restore/chunk')
  async restoreChunk(@Body() body: { type?: string; data?: Record<string, any> }) {
    const type = String(body?.type || '');
    const data = (body?.data || {}) as Record<string, any>;
    if (type !== 'settings') return { success: true, restoredCount: 0, failedCount: 0 };

    const allowed = ManageCompatController.CONFIG_SECTIONS as readonly string[];
    let restoredCount = 0;
    let failedCount = 0;
    for (const [section, value] of Object.entries(data)) {
      if (!allowed.includes(section) || !value || typeof value !== 'object') {
        failedCount += 1;
        continue;
      }
      try {
        if (section === 'security') await this.sysConfig.writeSecurityRaw(value);
        else await this.sysConfig.save(section, value);
        restoredCount += 1;
      } catch (err) {
        failedCount += 1;
        appLog.error('config', `恢复配置失败：${section}`, (err as Error).message);
      }
    }
    appLog.warn('config', `恢复配置：成功 ${restoredCount} 项，失败 ${failedCount} 项`);
    return { success: restoredCount > 0 || failedCount === 0, restoredCount, failedCount };
  }

  /** 导出用：分页返回文件记录（模拟原系统 KV 列表游标） */
  @Get('batch/list')
  async batchList(@Query() q: { cursor?: string; limit?: string }) {
    const limit = Math.min(1000, Math.max(1, Number(q.limit || 500)));
    const start = Math.max(0, Number(q.cursor || 0) || 0);
    const total = await prisma.fileRecord.count({ where: { status: 'active' } });
    const rows = await prisma.fileRecord.findMany({
      where: { status: 'active' },
      orderBy: { createdAt: 'asc' },
      skip: start,
      take: limit,
      include: { copies: { include: { channel: true } } },
    });
    const next = start + rows.length < total ? String(start + rows.length) : '';
    return {
      success: true,
      keys: rows.map((r) => ({ name: r.name, metadata: serializeFile(r, r.copies).metadata })),
      cursor: next,
      total,
    };
  }

  /* ---------------- AI（按方案裁剪，仅保留占位） ---------------- */

  @Get('ai/tags')
  aiTagsGet() {
    return { success: false, error: 'AI 功能未启用', tags: [] };
  }

  @Post('ai/tags')
  aiTagsPost() {
    return { success: false, error: 'AI 功能未启用', tags: [] };
  }

  @Post('ai/test')
  aiTest() {
    return { success: false, error: 'AI 功能未启用' };
  }
}
