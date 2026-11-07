import { LocalAdapter } from '../adapters/local.adapter';
import { Body, Controller, Delete, Get, Injectable, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { prisma } from '../common/prisma';
import { CryptoService } from '../common/crypto.service';
import { AdminGuard, ManageAuthGuard, currentSession, isAdminRole } from '../auth/auth.guard';
import { SettingsService } from '../settings/settings.service';
import { createAdapter } from '../adapters/adapter.factory';
import { ChannelInfo } from '../adapters/adapter.interface';
import { StorageChannelService, StorageChannelInfo } from '../storage/storage-channel.service';
import { appLog } from '../common/app-log';
import { normalizeBucketDomain } from '../common/channel-domain';
import { listContainerMounts } from './mounts';

/** 各渠道配置中的敏感字段名 —— 返回时脱敏、保存时加密（须与适配器读取的字段名一致） */
const SECRET_FIELDS: Record<string, string[]> = {
  local: [],
  cos: ['secretId', 'secretKey'],
  minio: ['accessKeyId', 'secretAccessKey'],
  r2: ['accessKeyId', 'secretAccessKey'],
  s3: ['accessKeyId', 'secretAccessKey'],
  easyimages: ['tokenValue'],
  lsky: ['tokenValue'],
  webdav: ['password'],
  immich: ['apiKey'],
  custom: ['tokenValue'],
};

/**
 * 可通过「添加渠道」创建的类型。
 * v3.0.0 起包含 local —— 允许创建自定义本地存储渠道（自备容器内存储目录），
 * 与内置本地渠道（code=999999，根固定 uploads）并存：
 *   · 内置渠道根固定 <后端根>/uploads，不可删除；
 *   · 自定义渠道 config.rootPath 指定容器内存储地址（拒绝 '..' 穿越），可删除。
 */
export const CHANNEL_TYPES = ['cos', 'minio', 'r2', 's3', 'aliyun', 'easyimages', 'lsky', 'webdav', 'immich', 'custom', 'local', 'localfiles'] as const;

/** 系统内置、不可新增也不可删除的渠道（以 code 识别，见 remove 的删除保护） */
export const BUILTIN_CHANNEL_TYPES = ['local'] as const;

/** 内置本地渠道的固定业务 ID（6 位），全站以它识别 */
export const LOCAL_CHANNEL_CODE = '999999';

/** v3.0.0（R10）：内置「本地文件」浏览渠道的固定 code（不可删除、浏览目录不可改） */
export const LOCAL_FILES_CHANNEL_CODE = '999990';

/** 历史版本（≤1.9.1）内置本地渠道的业务 ID —— 启动时自动迁到 999999 */
export const LEGACY_LOCAL_CHANNEL_CODE = '100000';

/**
 * 渠道类型编号（写进 channels.typeCode，纯排序用，与渠道业务 ID `code` 无关）：
 *   100 easyimages / 110 lsky / 120 immich / 130 minio / 140 r2 / 150 s3
 *   160 cos / 170 aliyun(ali) / 180 webdav / 190 custom
 *   995 自定义本地渠道（排在 custom 之后、内置 local 之前）
 *   999 内置本地渠道（永远最后）
 * 全站所有渠道下拉框的排序：typeCode 升序 → code 升序。
 */
export const CHANNEL_TYPE_CODE: Record<string, number> = {
  easyimages: 100,
  lsky: 110,
  immich: 120,
  minio: 130,
  r2: 140,
  s3: 150,
  cos: 160,
  aliyun: 170,
  webdav: 180,
  custom: 190,
  // v3.0.0：本地文件渠道（只读浏览，不参与上传）—— 排在所有本地存储之后（最后）
  localfiles: 1000,
  local: 999,
};

/** 自定义本地渠道的类型编号（排在 custom 190 之后、内置 local 999 之前） */
export const CUSTOM_LOCAL_TYPE_CODE = 995;

/**
 * 取某渠道类型对应的类型编号（未知类型排最后，避免脏数据插到前面）。
 * 自定义本地渠道（local 类型但 code 不是 999999）用 995。
 */
export function channelTypeCode(type: string, code?: string): number {
  if (type === 'local' && code !== undefined && code !== LOCAL_CHANNEL_CODE) return CUSTOM_LOCAL_TYPE_CODE;
  return CHANNEL_TYPE_CODE[type] ?? 998;
}

/** 全站统一的渠道排序：typeCode 升序 → code 升序 */
export const CHANNEL_ORDER_BY = [{ typeCode: 'asc' as const }, { name: 'asc' as const }];

/**
 * 生成「测试连接」用的测试图：512×512 的合法 PNG。
 *
 * 为什么不用 1×1：部分图床（如 EasyImages 简单图床）会以
 * 「图片高度太小 / 图片太小」直接拒绝，导致测试连接误报失败。
 * 512×512 同时能覆盖绝大多数图床的最小尺寸校验。
 * 优先用 sharp 生成（项目已依赖）；失败时回落到内置 base64 小图。
 */
async function makeTestPng(): Promise<Buffer> {
  try {
    const sharp = (await import('sharp')).default;
    return await sharp({
      create: { width: 512, height: 512, channels: 3, background: { r: 84, g: 150, b: 214 } },
    })
      .png()
      .toBuffer();
  } catch {
    // 兜底：内置 1×1 PNG（极小概率走到）
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
  }
}

/** 判定「同一账户」的配置字段：账号/桶/端点一致即视为同账户 */
const IDENTITY_FIELDS: Record<string, string[]> = {
  cos: ['secretId', 'bucket', 'region'],
  minio: ['endpoint', 'bucket', 'accessKeyId'],
  r2: ['endpoint', 'bucket', 'accessKeyId'],
  s3: ['endpoint', 'bucket', 'accessKeyId'],
  easyimages: ['apiUrl', 'tokenValue'],
  lsky: ['apiUrl', 'tokenValue'],
  webdav: ['baseUri', 'username'],
  immich: ['serverUrl', 'apiKey'],
  custom: ['apiUrl', 'tokenValue'],
  // 本地渠道按存储目录区分「账户」—— 不同 rootPath 互为不同账户（内置渠道无 rootPath，自成一类）
  local: ['rootPath'],
};

/** 账户指纹：类型 + 身份字段（用于「备份渠道不能与主渠道同账户」校验） */
function channelIdentity(type: string, cfg: Record<string, string>): string {
  const fields = IDENTITY_FIELDS[type] || [];
  return `${type}::${fields.map((f) => cfg[f] || '').join('|')}`;
}

@Injectable()
export class ChannelsService {
  constructor(private settings: SettingsService) {}

  /** 解密后的完整配置（仅服务端内部使用） */
  decryptConfig(type: string, configJson: string): Record<string, string> {
    const cfg = JSON.parse(configJson || '{}');
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg)) {
      out[k] = SECRET_FIELDS[type]?.includes(k) ? CryptoService.decrypt(String(v)) : String(v);
    }
    /*
     * v3.0.0（R6）：读取侧统一归一化 MinIO 的访问域名 ——
     * 升级前保存的 `https://minio:9000/桶名` 在这里自动剥成 `https://minio:9000`，
     * 桶名改由适配器统一拼接。这样不需要数据迁移，存量配置也不会变成 /桶名/桶名。
     */
    return normalizeBucketDomain(type, out);
  }

  /** 脱敏后的配置（返回给前端） */
  maskConfig(type: string, configJson: string): Record<string, string> {
    const cfg = JSON.parse(configJson || '{}');
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg)) {
      out[k] = SECRET_FIELDS[type]?.includes(k) ? CryptoService.mask(CryptoService.decrypt(String(v))) : String(v);
    }
    return out;
  }

  /** 账户指纹（用于主/备渠道去重） */
  identityOf(type: string, configJson: string): string {
    return channelIdentity(type, this.decryptConfig(type, configJson));
  }

  /**
   * 确保「本地存储」内置渠道存在（幂等，每次启动都跑）。
   *
   * 规则：
   *   1) 按固定 code（999999）查找；不存在则创建（排序值 9999，永远排在列表最后）；
   *      1.9.2 之前用的是 100000，发现旧记录时原地改 code（连同 file_copies 的 channelId 引用不变，
   *      因为改的是同一条记录的 code 字段，id 不变）；
   *   2) 已存在时只修复四件事：type 被改坏、被意外禁用、typeCode 不是 999、以及
   *      「库里一条主渠道都没有」时兜底为主渠道 —— 不去覆盖用户改过的名字与容量设置；
   *   3) 库里已有主渠道时一律尊重用户设置，绝不抢占。
   */
  async ensureBuiltinLocalChannel(): Promise<void> {
    // 0) 存量迁移：旧的内置本地渠道 code 100000 → 999999
    const legacy = await prisma.channel.findUnique({ where: { code: LEGACY_LOCAL_CHANNEL_CODE } });
    if (legacy) {
      const taken = await prisma.channel.findUnique({ where: { code: LOCAL_CHANNEL_CODE } });
      if (!taken) {
        await prisma.channel.update({ where: { id: legacy.id }, data: { code: LOCAL_CHANNEL_CODE } });
      } else if (taken.id !== legacy.id) {
        // 极少数情况：999999 已被普通渠道占用（随机 code 撞上）→ 把占用者挪走，保证内置 ID 唯一
        let alt = '';
        for (let i = 0; i < 60 && !alt; i++) {
          const c = String(100000 + Math.floor(Math.random() * 899000));
          if (c !== LOCAL_CHANNEL_CODE && !(await prisma.channel.findUnique({ where: { code: c } }))) alt = c;
        }
        await prisma.channel.update({ where: { id: taken.id }, data: { code: alt || '100001' } });
        await prisma.channel.update({ where: { id: legacy.id }, data: { code: LOCAL_CHANNEL_CODE } });
      }
    }

    // 1) 回填所有渠道的类型编号（含历史数据）；类型被改坏的也顺手纠正。
    //    注意：自定义本地渠道（code ≠ 999999）固定 995，不能被内置规则的 999 冲掉。
    const all = await prisma.channel.findMany({ select: { id: true, type: true, typeCode: true, code: true } });
    for (const c of all) {
      const want = channelTypeCode(c.type, c.code);
      if (c.typeCode !== want) {
        await prisma.channel.update({ where: { id: c.id }, data: { typeCode: want } });
      }
    }

    const existing = await prisma.channel.findUnique({ where: { code: LOCAL_CHANNEL_CODE } });
    if (existing) {
      const patch: { type?: string; enabled?: boolean; isMain?: boolean; typeCode?: number } = {};
      if (existing.type !== 'local') patch.type = 'local';
      if (!existing.enabled) patch.enabled = true;
      if (existing.typeCode !== channelTypeCode('local')) patch.typeCode = channelTypeCode('local');
      // 没有任何主渠道 → 用本地存储兜底，避免上传时报「未配置可用的主渠道」
      if (!existing.isMain && !existing.isBackup) {
        const hasMain = await prisma.channel.count({
          where: { isMain: true, enabled: true, NOT: { id: existing.id } },
        });
        if (hasMain === 0) patch.isMain = true;
      }
      if (Object.keys(patch).length) {
        await prisma.channel.update({ where: { id: existing.id }, data: patch });
      }
      return;
    }
    /*
     * 名字冲突时加后缀，避免唯一约束报错导致启动失败。
     * v3.0.0：后缀改用「-系统」而不是「（系统）」—— 渠道编辑页的名字校验规则是
     * 仅允许「中英文 / 数字 / 下划线 / 连字符」，带全角括号的名字会被前端判为非法，
     * 导致这条内置渠道一旦改名就再也保存不回去。
     */
    let name = '本地存储';
    if (await prisma.channel.findUnique({ where: { name } })) name = '本地存储-系统';
    if (await prisma.channel.findUnique({ where: { name } })) name = '本地存储_系统';
    const hasMain = await prisma.channel.count({ where: { isMain: true } });
    await prisma.channel.create({
      data: {
        code: LOCAL_CHANNEL_CODE,
        name,
        type: 'local',
        typeCode: channelTypeCode('local'),
        enabled: true,
        isMain: hasMain === 0,
        isBackup: false,
        sortOrder: 9999,
        config: JSON.stringify({ quotaEnabled: 'false', quotaLimitGB: '10', quotaThreshold: '95' }),
      },
    });
  }

  /**
   * v3.0.0（R10）：确保「本地文件」内置浏览渠道存在（幂等，每次启动都跑）。
   *
   * 与 999999（本地存储）的区别：
   *   · 只浏览、不接受上传（type=localfiles，只读）；
   *   · 浏览目录固定为「本地存储」的内置根（<backend>/uploads），不允许改；
   *   · code=999990 固定，不可删除 —— 管理员额外创建的 localfiles 渠道是随机 6 位 code，
   *     两者互不影响（本条只保证 999990 这一条存在且配置不被改坏）。
   */
  async ensureBuiltinLocalFilesChannel(): Promise<void> {
    const root = LocalAdapter.root();
    const existing = await prisma.channel.findUnique({ where: { code: LOCAL_FILES_CHANNEL_CODE } });
    if (existing) {
      let cfg: Record<string, unknown> = {};
      try {
        cfg = JSON.parse(existing.config || '{}');
      } catch {
        cfg = {};
      }
      const current = Array.isArray(cfg.rootPaths) ? cfg.rootPaths : [];
      const patch: Record<string, unknown> = {};
      if (existing.type !== 'localfiles') patch.type = 'localfiles';
      if (!existing.enabled) patch.enabled = true;
      const wantCode = channelTypeCode('localfiles');
      if (existing.typeCode !== wantCode) patch.typeCode = wantCode;
      // 浏览目录固定为内置 uploads（被改过就纠正回来）
      if (current.length !== 1 || String(current[0]) !== root) {
        patch.config = JSON.stringify({ ...cfg, rootPaths: [root] });
      }
      if (Object.keys(patch).length) {
        await prisma.channel.update({ where: { id: existing.id }, data: patch as never });
      }
      return;
    }
    let name = '本地文件';
    if (await prisma.channel.findUnique({ where: { name } })) name = '本地文件-系统';
    if (await prisma.channel.findUnique({ where: { name } })) name = '本地文件_系统';
    await prisma.channel.create({
      data: {
        code: LOCAL_FILES_CHANNEL_CODE,
        name,
        type: 'localfiles',
        typeCode: channelTypeCode('localfiles'),
        enabled: true,
        isMain: false,
        isBackup: false,
        sortOrder: 9998,
        config: JSON.stringify({ rootPaths: [root] }),
      },
    });
  }
}

/** 渠道授权判定（实现在 common/channel-access，这里转出供其它模块复用） */
import { channelVisibleTo, parseAuthorizedUsers } from '../common/channel-access';
export { channelVisibleTo, parseAuthorizedUsers };

@Controller('api/channels')
export class ChannelsController {
  constructor(private svc: ChannelsService) {}

  /**
   * 上传页 / 管理页共用：按渠道类型分组返回（兼容原系统契约）
   *   { cos: [{id,name,enabled,isMain,isBackup,config}], minio: [...], ... }
   *
   * v202610221824 起按「用户授权」过滤：普通用户只拿到自己被授权的渠道 + 本地存储。
   */
  @Get()
  async list(@Req() req: Request, @Query('includeDisabled') includeDisabled?: string) {
    const session = currentSession(req);
    const admin = isAdminRole(session?.role);
    const username = session?.user || '';
    const channels = await prisma.channel.findMany({
      where: includeDisabled === 'true' && admin ? {} : { enabled: true },
      // 统一下拉排序：渠道类型编号升序 → 渠道 ID 升序
      orderBy: CHANNEL_ORDER_BY,
    });
    const grouped: Record<string, unknown[]> = {};
    for (const c of channels) {
      if (!channelVisibleTo(c.authorizedUsers, c.type, username, admin)) continue;
      if (!grouped[c.type]) grouped[c.type] = [];
      grouped[c.type].push({
        id: c.id,
        code: c.code,
        name: c.name,
        type: c.type,
        typeCode: c.typeCode,
        enabled: c.enabled,
        isMain: c.isMain,
        isBackup: c.isBackup,
        backupPool: c.backupPool,
        config: this.svc.maskConfig(c.type, c.config),
      });
    }
    return grouped;
  }
}

@Controller('api/manage/storage')
@UseGuards(AdminGuard)
export class StorageSettingsController {
  constructor(
    private settings: SettingsService,
    private svc: ChannelsService,
    private storageChannel: StorageChannelService,
  ) {}

  /** 读取分发设置：外链模式、当前访问渠道、代理参数、上传去重开关与范围、自定义访问域名、主/备渠道概览 */
  @Get()
  async get() {
    const [linkMode, accessChannel, proxyTimeoutMs, proxyCacheSeconds, dedupEnabled, dedupScope, customDomain] = await Promise.all([
      this.settings.getLinkMode(),
      this.settings.getAccessChannel(),
      this.settings.get('proxyTimeoutMs', '15000'),
      this.settings.get('proxyCacheSeconds', '86400'),
      this.settings.get('dedupEnabled', 'false'),
      this.settings.get('dedupScope', 'all'),
      this.settings.getCustomDomain(),
    ]);
    /*
     * 全局主/备渠道概览 —— 统一走 StorageChannelService.getStorageChannel('', type)，
     * 不再各自 find(c => c.isMain)。统一入口会跳过已禁用渠道并保持同一兜底顺序。
     */
    const pickBrief = (c: StorageChannelInfo | null) =>
      c ? { id: c.id, code: c.code, name: c.name, type: c.type, enabled: true } : null;
    return {
      linkMode,
      accessChannel,
      proxyTimeoutMs: Number(proxyTimeoutMs) || 15000,
      proxyCacheSeconds: Number(proxyCacheSeconds) || 86400,
      dedupEnabled: dedupEnabled === 'true',
      // v2.8.7b：去重范围支持 all / channel（同一渠道名称内）/ channelType（同一渠道类型内）
      dedupScope: dedupScope === 'channelType' ? 'channelType' : dedupScope === 'channel' ? 'channel' : 'all',
      customDomain,
      mainChannel: pickBrief(await this.storageChannel.getStorageChannel('', 'main')),
      backupChannel: pickBrief(await this.storageChannel.getStorageChannel('', 'backup')),
    };
  }

  /** 保存分发设置（仅保存传入字段） */
  @Post()
  async save(
    @Body()
    body: {
      linkMode?: string;
      accessChannel?: string;
      proxyTimeoutMs?: number;
      proxyCacheSeconds?: number;
      dedupEnabled?: boolean;
      dedupScope?: string;
      customDomain?: string;
    },
  ) {
    if (body.linkMode !== undefined) {
      const v = body.linkMode === 'redirect' ? 'redirect' : 'proxy';
      await this.settings.set('linkMode', v);
    }
    if (body.accessChannel !== undefined) {
      await this.settings.set('accessChannel', body.accessChannel === 'backup' ? 'backup' : 'main');
    }
    if (body.proxyTimeoutMs !== undefined) {
      const n = Math.min(120000, Math.max(1000, Number(body.proxyTimeoutMs) || 15000));
      await this.settings.set('proxyTimeoutMs', String(n));
    }
    if (body.proxyCacheSeconds !== undefined) {
      const n = Math.max(0, Number(body.proxyCacheSeconds) || 0);
      await this.settings.set('proxyCacheSeconds', String(n));
    }
    if (body.dedupEnabled !== undefined) {
      await this.settings.set('dedupEnabled', body.dedupEnabled ? 'true' : 'false');
    }
    if (body.dedupScope !== undefined) {
      // v2.8.7b：all / channel（同一渠道名称内）/ channelType（同一渠道类型内）
      const v = body.dedupScope === 'channelType' ? 'channelType' : body.dedupScope === 'channel' ? 'channel' : 'all';
      await this.settings.set('dedupScope', v);
    }
    if (body.customDomain !== undefined) {
      // 统一去掉首尾空白与结尾斜杠；允许带协议，未带协议时前端拼接时按 http(s) 处理
      const dom = String(body.customDomain || '').trim().replace(/\/+$/, '');
      await this.settings.set('customDomain', dom);
    }
    return { success: true };
  }
}

@Controller('api/manage/channels')
@UseGuards(AdminGuard)
export class ChannelManageController {
  constructor(private svc: ChannelsService) {}

  /**
   * 管理端渠道列表 —— 按类型分组返回（含已禁用渠道），config 已脱敏。
   * 形状与 /api/channels 一致，便于前端复用同一套渲染逻辑。
   */
  @Get()
  async list() {
    const channels = await prisma.channel.findMany({
      // 统一排序：渠道类型编号升序 → 渠道 ID 升序（前端下拉直接复用此顺序）
      orderBy: CHANNEL_ORDER_BY,
    });
    // 各渠道已用容量（按文件副本 size 累加）—— 供卡片上的容量进度条使用
    const copies = await prisma.fileCopy.findMany({
      where: { status: 'active' },
      include: { file: { select: { size: true } } },
    });
    const usageMB = new Map<string, number>();
    for (const c of copies) {
      usageMB.set(c.channelId, (usageMB.get(c.channelId) || 0) + (c.file?.size || 0) / 1024 / 1024);
    }

    const grouped: Record<string, unknown[]> = {};
    // 分组顺序同样按类型编号排（前端设置页按 key 顺序渲染分组标题）；
    // v3.0.0：CHANNEL_TYPES 已含 local（自定义本地渠道），内置渠道组也落在同一 key 下
    const addable = [...CHANNEL_TYPES].sort((a, b) => channelTypeCode(a) - channelTypeCode(b));
    for (const type of addable) grouped[type] = [];
    for (const c of channels) {
      const config = this.svc.maskConfig(c.type, c.config);
      (grouped[c.type] ||= []).push({
        id: c.id,
        code: c.code, // 6 位渠道 ID（内部识别用，创建后不变）
        name: c.name,
        type: c.type,
        typeCode: c.typeCode, // 渠道类型编号（排序依据）
        enabled: c.enabled,
        isMain: c.isMain,
        isBackup: c.isBackup,
        // 备用库（可多条）与用户授权名单 —— 后台渠道卡片的「更多」菜单与授权弹窗据此渲染
        backupPool: c.backupPool,
        authorizedUsers: parseAuthorizedUsers(c.authorizedUsers),
        sortOrder: c.sortOrder,
        config,
        quota: {
          enabled: config.quotaEnabled === 'true',
          limitGB: Number(config.quotaLimitGB) || 10,
          threshold: Number(config.quotaThreshold) || 95,
          usedMB: Math.round((usageMB.get(c.id) || 0) * 100) / 100,
        },
      });
    }
    return grouped;
  }

  /**
   * v1.0.1：容器内「已映射路径」清单 —— 本地存储渠道「存储地址」下拉的数据源。
   *
   * 只返回真实映射进来（或镜像内真实存在）的目录，避免用户填一个未映射的容器路径 ——
   * 那种目录的内容只存在于容器可写层，容器一重建就全部丢失。
   */
  @Get('mounts')
  async mounts() {
    try {
      const list = await listContainerMounts();
      return { success: true, data: list };
    } catch (err) {
      appLog.warn('channel', '读取容器内映射路径失败', (err as Error).message);
      return { success: false, message: '读取容器内映射路径失败', data: [] };
    }
  }

  /**
   * 编辑渠道用：返回**解密后的完整配置**（含明文密钥）。
   * 列表接口出于安全只回脱敏值（形如 `AKID****1234`），编辑弹窗点开「小眼睛」
   * 也只能看到这个掩码。管理端本身就有权查看与修改凭据，故编辑时单独拉一次明文回填，
   * 让「小眼睛」真的能看到完整值（保存时后端照旧重新加密写库）。
   */
  @Get(':id/plain')
  async plain(@Param('id') id: string) {
    const c = await prisma.channel.findUnique({ where: { id } });
    if (!c) return { success: false, message: '渠道不存在' };
    return { success: true, type: c.type, config: this.svc.decryptConfig(c.type, c.config) };
  }

  /** 主渠道 / 备份渠道各自唯一：置位时清掉其它记录的同一标记 */
  private async enforceUniqueFlags(id: string | null, isMain?: boolean, isBackup?: boolean) {
    if (isMain) {
      await prisma.channel.updateMany({
        where: id ? { isMain: true, NOT: { id } } : { isMain: true },
        data: { isMain: false },
      });
    }
    if (isBackup) {
      await prisma.channel.updateMany({
        where: id ? { isBackup: true, NOT: { id } } : { isBackup: true },
        data: { isBackup: false },
      });
    }
  }

  /**
   * v1.0.2：校验「当前登录管理员」的密码（用于修改存储地址这类高风险操作）。
   * 优先用 users 表里的密码哈希；表里没有该账户时回落到环境变量初始管理员。
   */
  private async verifyAdminPassword(req: Request, password: string): Promise<boolean> {
    const me = currentSession(req)?.user || '';
    const p = String(password || '');
    if (!me || !p) return false;
    try {
      const u = await prisma.user.findUnique({ where: { username: me } });
      if (u?.passwordHash) return CryptoService.verifyPassword(p, u.passwordHash);
    } catch {
      /* 表异常时继续走环境变量兜底 */
    }
    const envUser = (process.env.SUPER_ADMIN_USERNAME || process.env.ADMIN_USER || 'admin').trim();
    const envPass = process.env.SUPER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'gohub';
    return me === envUser && p === envPass;
  }

  /** 备份渠道允许与主渠道同类型，但不允许同账户（配置身份字段一致） */
  private async sameAccountAsMain(type: string, selfId: string | null, identity: string): Promise<string | null> {
    const main = await prisma.channel.findFirst({ where: { isMain: true, NOT: selfId ? { id: selfId } : undefined } });
    if (!main) return null;
    if (this.svc.identityOf(main.type, main.config) === identity) {
      return `备份渠道不能与主渠道「${main.name}」使用同一账户`;
    }
    return null;
  }

  /**
   * 生成唯一的 6 位数字渠道 ID（内部识别用；渠道名可改，ID 不变）。
   * 必须避开 LOCAL_CHANNEL_CODE（999999）—— 那是内置本地存储的固定 ID，
   * 一旦被普通渠道占用，启动时的幂等修复会把它的类型改写成 local。
   */
  private async nextCode(): Promise<string> {
    for (let i = 0; i < 60; i++) {
      const code = String(100000 + Math.floor(Math.random() * 899000));
      if (code === LOCAL_CHANNEL_CODE || code === LOCAL_FILES_CHANNEL_CODE) continue;
      if (!(await prisma.channel.findUnique({ where: { code } }))) return code;
    }
    const fallback = String(Date.now()).slice(-6);
    return fallback === LOCAL_CHANNEL_CODE || fallback === LOCAL_FILES_CHANNEL_CODE ? '100001' : fallback;
  }

  /**
   * 自定义本地渠道的 ID 生成（v3.0.0）：固定以 "99" 开头的 6 位数字（99xxxx），
   * 递增找空位、避开内置本地渠道的 999999 —— 一眼即可与普通渠道区分。
   */
  private async nextLocalCode(): Promise<string> {
    for (let n = 990000; n <= 999998; n++) {
      const code = String(n);
      if (code === LOCAL_CHANNEL_CODE || code === LOCAL_FILES_CHANNEL_CODE) continue;
      if (!(await prisma.channel.findUnique({ where: { code } }))) return code;
    }
    // 990000~999998 全满（理论不可能）→ 退回普通随机段
    return this.nextCode();
  }

  /**
   * 自定义本地渠道的 rootPath 校验（v3.0.0）：
   * 必填、拒绝 '..' 穿越；通过 LocalAdapter.sanitizeRootPath 解析出实际落盘根。
   */
  private validateLocalRootPath(raw: unknown): { ok: true; rootPath: string } | { ok: false; message: string } {
    const s = String(raw || '').trim();
    if (!s) return { ok: false, message: '自定义本地渠道必须填写 rootPath（容器内存储地址）' };
    if (s.includes('..')) return { ok: false, message: 'rootPath 禁止包含 ".."' };
    return { ok: true, rootPath: s };
  }

  /**
   * v3.0.0（R11）：本地文件渠道的「浏览目录」校验。
   *
   * 字段是 rootPaths（多行 / 数组），不是 rootPath ——
   * 早先 create() 对 localfiles 也去校验 rootPath，导致「明明填了浏览目录却一直提示
   * 必须填写 rootPath，怎么都存不上」。这里按真实字段解析：
   *   · rootPaths 为数组 → 逐个 trim；
   *   · 为字符串 → 按换行拆分（前端 textarea）；
   *   · 只有历史 rootPath 单值时当作一个目录。
   * 返回规范化的换行字符串（与前端 textarea 一致）。
   */
  private validateLocalRootPaths(raw: unknown): { ok: true; rootPaths: string } | { ok: false; message: string } {
    let list: string[] = [];
    if (Array.isArray(raw)) {
      list = raw.map((v) => String(v || '').trim());
    } else if (typeof raw === 'string') {
      list = raw.split(/\r?\n/).map((v) => v.trim());
    }
    list = list.filter(Boolean);
    if (!list.length) {
      return { ok: false, message: '本地文件渠道必须填写「浏览目录」（容器内绝对路径，一行一个）' };
    }
    const bad = list.find((p) => p.includes('..'));
    if (bad) return { ok: false, message: `浏览目录禁止包含 ".."：${bad}` };
    return { ok: true, rootPaths: list.join('\n') };
  }

  @Post()
  async create(@Body() body: { name: string; type: string; config?: Record<string, string>; isMain?: boolean; isBackup?: boolean }) {
    if (!CHANNEL_TYPES.includes(body.type as (typeof CHANNEL_TYPES)[number])) {
      return { success: false, message: `不支持的渠道类型: ${body.type}` };
    }
    if (!body.name || !String(body.name).trim()) {
      return { success: false, message: '渠道名称不能为空' };
    }
    if (body.isBackup && body.isMain) {
      return { success: false, message: '同一条渠道不能同时作为主渠道和备份渠道' };
    }
    const dup = await prisma.channel.findFirst({ where: { name: body.name } });
    if (dup) return { success: false, message: `渠道名称「${body.name}」已存在` };

    // v3.0.0：MinIO 的域名只填域名即可 —— 老配置里残留的 /bucket 在这里剥离，桶名由适配器拼接
    // v3.0.0：本地文件渠道是「只读浏览」渠道，不能作为主渠道 / 备份渠道参与上传
    if (body.type === 'localfiles' && (body.isMain || body.isBackup)) {
      return { success: false, message: '本地文件渠道只用于浏览本地目录，不能设为主渠道或备份渠道' };
    }
    const raw = normalizeBucketDomain(body.type, body.config || {});
    // v3.0.0：自定义本地渠道 —— rootPath 必填且拒绝 '..'
    // v3.0.0（R11）：本地文件渠道 —— 校验的是「浏览目录」rootPaths，不是 rootPath
    let rootPath = '';
    if (body.type === 'local') {
      const check = this.validateLocalRootPath(raw.rootPath);
      if (!check.ok) return { success: false, message: check.message };
      rootPath = check.rootPath;
    } else if (body.type === 'localfiles') {
      const check = this.validateLocalRootPaths(raw.rootPaths ?? raw.rootPath);
      if (!check.ok) return { success: false, message: check.message };
      raw.rootPaths = check.rootPaths;
      // 宿主机映射目录纯展示、可选：空值不要写进配置，避免前端出现「空字符串字段」
      if (!String(raw.hostPath || '').trim()) delete raw.hostPath;
    }
    if (body.isBackup) {
      const err = await this.sameAccountAsMain(body.type, null, channelIdentity(body.type, raw));
      if (err) return { success: false, message: err };
    }

    const encrypted: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      encrypted[k] = SECRET_FIELDS[body.type]?.includes(k) ? CryptoService.encrypt(String(v)) : String(v);
    }
    // v3.0.0：内置本地渠道用固定 code 999999（由启动逻辑保证存在）；
    // 自定义本地渠道以 "99" 开头递增找空位，类型编号 995。
    const isLocal = body.type === 'local';
    const ch = await prisma.channel.create({
      data: {
        name: body.name,
        type: body.type,
        typeCode: isLocal ? CUSTOM_LOCAL_TYPE_CODE : channelTypeCode(body.type), // 渠道类型编号（排序依据，创建时固化）
        config: JSON.stringify(encrypted),
        isMain: !!body.isMain,
        isBackup: !!body.isBackup,
        code: isLocal ? await this.nextLocalCode() : await this.nextCode(),
      },
    });
    await this.enforceUniqueFlags(ch.id, body.isMain, body.isBackup);
    appLog.info('channel', `新增渠道：${body.name}（${body.type}${isLocal ? `，rootPath=${rootPath}` : ''}）`, `code=${ch.code}`);
    return { success: true, data: { id: ch.id, code: ch.code } };
  }

  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      config?: Record<string, string>;
      enabled?: boolean;
      isMain?: boolean;
      isBackup?: boolean;
      /** v1.0.2：修改本地渠道「存储地址」时要求输入当前管理员密码 */
      adminPassword?: string;
    },
  ) {
    const ch = await prisma.channel.findUnique({ where: { id } });
    if (!ch) return { success: false, message: '渠道不存在' };
    if (body.isMain && body.isBackup) {
      return { success: false, message: '同一条渠道不能同时作为主渠道和备份渠道' };
    }
    // v3.0.0：本地文件渠道不参与上传，禁止被设为主渠道 / 备份渠道
    if (ch.type === 'localfiles' && (body.isMain || body.isBackup)) {
      return { success: false, message: '本地文件渠道只用于浏览本地目录，不能设为主渠道或备份渠道' };
    }
    // 渠道名可修改，但不允许与其它渠道重名
    if (body.name !== undefined && String(body.name).trim() !== ch.name) {
      const name = String(body.name).trim();
      if (!name) return { success: false, message: '渠道名称不能为空' };
      const dup = await prisma.channel.findFirst({ where: { name, NOT: { id } } });
      if (dup) return { success: false, message: `渠道名称「${name}」已存在` };
    }
    // 脱敏值（含 ****）不覆盖原密文
    const old = this.svc.decryptConfig(ch.type, ch.config);
    const merged: Record<string, string> = { ...old };
    for (const [k, v] of Object.entries(body.config || {})) {
      if (String(v).includes('****')) continue;
      merged[k] = v;
    }
    /*
     * v3.0.0（R10）：内置「本地文件」渠道（999990）的浏览目录固定为 uploads，禁止修改。
     */
    if (ch.code === LOCAL_FILES_CHANNEL_CODE) {
      merged.rootPaths = JSON.stringify([LocalAdapter.root()]);
      delete merged.rootPath;
    }
    /*
     * v3.0.0（R10）：公开访问域名在 UI 上已改为必填。
     * 后端做一次「软收敛」：为空时用 Endpoint 的站点源补上，避免存量渠道保存时被打回，
     * 也让「文件加载域名」永远有值可用（本地 / 本地文件渠道不参与）。
     */
    if (!['local', 'localfiles'].includes(ch.type)) {
      const pd = String(merged.publicDomain || '').trim();
      if (!pd) {
        const ep = String(
          merged.endpoint || merged.apiUrl || merged.serverUrl || merged.baseUri || merged.domain || '',
        ).trim();
        if (ep) {
          try {
            merged.publicDomain = new URL(/^https?:\/\//i.test(ep) ? ep : `https://${ep}`).origin;
          } catch {
            merged.publicDomain = ep;
          }
        }
      }
    }
    if (body.isBackup) {
      const err = await this.sameAccountAsMain(ch.type, id, channelIdentity(ch.type, merged));
      if (err) return { success: false, message: err };
    }
    /*
     * v1.0.2：本地存储渠道的「存储地址（容器内路径）」一旦保存就不能随手改 ——
     * 改错（或改成未映射路径）会导致容器重建后文件全部丢失。
     * 这里要求输入当前管理员密码二次确认；路径没变则不需要密码。
     */
    if (ch.type === 'local' || ch.type === 'localfiles') {
      const rootSig = (cfg: Record<string, string>) => {
        const rp = String(cfg.rootPaths || '').trim();
        const r = String(cfg.rootPath || '').trim();
        return `${rp}\u0000${r}`;
      };
      // 内置「本地文件」渠道的浏览目录是固定的，不参与校验
      if (ch.code !== LOCAL_FILES_CHANNEL_CODE && rootSig(old) !== rootSig(merged)) {
        if (!(await this.verifyAdminPassword(req, String(body?.adminPassword || '')))) {
          appLog.warn('channel', `修改本地存储地址被拦截：${ch.name}`, '未提供或提供了错误的管理员密码');
          return { success: false, needAdminPassword: true, message: '修改「存储地址（容器内路径）」需要验证管理员密码' };
        }
      }
    }
    const encrypted: Record<string, string> = {};
    // v3.0.0：MinIO 域名去掉历史残留的 /bucket（桶名由后端适配器拼接）
    for (const [k, v] of Object.entries(normalizeBucketDomain(ch.type, merged))) {
      encrypted[k] = SECRET_FIELDS[ch.type]?.includes(k) ? CryptoService.encrypt(v) : v;
    }
    await prisma.channel.update({
      where: { id },
      data: {
        name: body.name !== undefined ? String(body.name).trim() : ch.name,
        enabled: body.enabled ?? ch.enabled,
        isMain: body.isMain ?? ch.isMain,
        isBackup: body.isBackup ?? ch.isBackup,
        config: JSON.stringify(encrypted),
      },
    });
    await this.enforceUniqueFlags(id, body.isMain, body.isBackup);
    return { success: true };
  }

  /**
   * 渠道连通性测试 —— 真实上传一张 512x512 测试图并立即删除。
   * （用 512×512 而非 1×1：部分图床如 EasyImages 会以「图片高度太小」拒绝。）
   * 传 id：测已保存的渠道（用户新填的值若不含掩码则覆盖）；
   * 不传 id：测尚未保存的表单配置（新增渠道时的「测试连接」）。
   */
  @Post('test')
  async test(@Body() body: { id?: string; type?: string; config?: Record<string, string> }) {
    let type = body.type || '';
    let cfg: Record<string, string> = {};

    if (body.id) {
      const ch = await prisma.channel.findUnique({ where: { id: body.id } });
      if (!ch) return { success: false, message: '渠道不存在' };
      type = ch.type;
      cfg = this.svc.decryptConfig(ch.type, ch.config);
      for (const [k, v] of Object.entries(body.config || {})) {
        if (String(v).includes('****')) continue; // 掩码值不覆盖已存密文
        cfg[k] = v;
      }
    } else {
      cfg = body.config || {};
    }

    if (!CHANNEL_TYPES.includes(type as (typeof CHANNEL_TYPES)[number])) {
      return { success: false, message: `不支持的渠道类型: ${type || '(空)'}` };
    }
    // v3.0.0：本地文件渠道是只读浏览渠道，不参与上传，因此没有「连接测试」的概念
    if (type === 'localfiles') {
      return { success: false, message: '本地文件渠道只用于浏览本地目录，不支持上传测试' };
    }

    // v3.0.0：连接测试同样按「域名只填域名」处理（剥离历史 /bucket），保证测出来的外链与正式上传一致
    cfg = normalizeBucketDomain(type, cfg);

    const info: ChannelInfo = { id: body.id || 'channel-test', name: '连接测试', type, config: cfg, metas: {} };
    const key = `GoHub-test-${Date.now()}.png`;
    const png = await makeTestPng();

    const started = Date.now();
    try {
      const adapter = createAdapter(info);
      const res = await adapter.upload({ buffer: png, mime: 'image/png', originalName: 'test.png' }, key, info);
      const url = adapter.buildDirectUrl(
        { remoteKey: res.remoteKey, remoteUrl: res.remoteUrl || '', metas: {} },
        info,
      );
      // 清理测试文件（平台不支持删除时不影响判定）
      let cleaned = true;
      try {
        await adapter.delete({ remoteKey: res.remoteKey, remoteUrl: res.remoteUrl || '', metas: {} }, info);
      } catch {
        cleaned = false;
      }
      return {
        success: true,
        data: { url, key: res.remoteKey, cleaned, elapsedMs: Date.now() - started },
        message: cleaned ? '上传成功，测试文件已清理' : '上传成功（该渠道未配置删除接口，测试文件可能残留）',
      };
    } catch (err) {
      return { success: false, message: (err as Error).message, data: { elapsedMs: Date.now() - started } };
    }
  }

  /**
   * 设为 / 取消「备用库」（v202610221824）。
   *
   * 与「备份渠道」不同：
   *   - 备份渠道 isBackup 全局唯一，是主备双写的目标，失败只记日志不重传；
   *   - 备用库 backupPool 可以多个，是主渠道失败后的轮换池 —— 上传失败时
   *     按轮转游标依次尝试，直到有一条成功。
   */
  @Post(':id/pool')
  async setPool(@Param('id') id: string, @Body() body: { enabled?: boolean }) {
    const ch = await prisma.channel.findUnique({ where: { id } });
    if (!ch) return { success: false, message: '渠道不存在' };
    const enabled = body.enabled !== false;
    await prisma.channel.update({ where: { id }, data: { backupPool: enabled } });
    const count = await prisma.channel.count({ where: { backupPool: true } });
    return { success: true, data: { backupPool: enabled, count } };
  }

  /** 渠道的授权用户名单 + 全部账户候选 */
  @Get(':id/authorize')
  async getAuthorize(@Param('id') id: string) {
    const ch = await prisma.channel.findUnique({ where: { id } });
    if (!ch) return { success: false, message: '渠道不存在' };
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { username: true, nickname: true, role: true, avatar: true },
    });
    return {
      success: true,
      data: {
        authorizedUsers: parseAuthorizedUsers(ch.authorizedUsers),
        users: users.map((u) => ({
          username: u.username,
          nickname: u.nickname || u.username,
          role: u.role,
          avatar: u.avatar || '',
        })),
      },
    };
  }

  /** 保存授权用户名单（传空数组 = 取消所有人的授权） */
  @Post(':id/authorize')
  async setAuthorize(@Param('id') id: string, @Body() body: { usernames?: string[] }) {
    const ch = await prisma.channel.findUnique({ where: { id } });
    if (!ch) return { success: false, message: '渠道不存在' };
    // v3.0.0（R5）：本地文件渠道仅管理员可用，不接受授权名单
    if (ch.type === 'localfiles') return { success: false, message: '本地文件渠道不支持授权（仅管理员可用）' };
    const wanted = Array.isArray(body.usernames) ? body.usernames.map((x) => String(x || '').trim()).filter(Boolean) : [];
    // 只保留真实存在的账户，防止脏名字写进配置
    const exists = await prisma.user.findMany({
      where: { username: { in: wanted } },
      select: { username: true },
    });
    const valid = exists.map((u) => u.username);
    await prisma.channel.update({ where: { id }, data: { authorizedUsers: JSON.stringify(valid) } });
    return { success: true, data: { authorizedUsers: valid } };
  }

  /*
   * 【v2.4.0 迁移】GET allowed/list 已拆到下方 ChannelAllowedController：
   * 本控制器整体挂 AdminGuard，普通用户登录自己的编辑页时调它会被 403 拦截，
   * 导致「已授权渠道」下拉永远为空。allowed/list 接口内部本来就按会话角色过滤，
   * 改挂 ManageAuthGuard 即可（普通用户只能查自己）。
   */

  @Delete(':id')
  async remove(@Param('id') id: string) {
    // 删除保护（v3.0.0 起按 code 判定）：只有内置本地渠道（code=999999）不可删除；
    // 自定义本地渠道（99xxxx）与普通渠道一样允许删除（有副本时仍要求先迁移）。
    const target = await prisma.channel.findUnique({ where: { id } });
    if (target && target.code === LOCAL_CHANNEL_CODE) {
      return { success: false, message: '内置本地存储是系统渠道，不能删除（可以禁用以停用）' };
    }
    if (target && target.code === LOCAL_FILES_CHANNEL_CODE) {
      return { success: false, message: '内置本地文件浏览渠道是系统渠道，不能删除' };
    }
    /*
     * v3.0.0（R10）：只要库里还有该渠道的文件副本就禁止删除 ——
     * 包含正常文件、回收站里的文件（软删后副本行仍在）、登记文件，不限用户与实例。
     */
    const copies = await prisma.fileCopy.count({ where: { channelId: id } });
    if (copies > 0) {
      const [trash, registered] = await Promise.all([
        prisma.fileCopy.count({ where: { channelId: id, file: { status: 'deleted' } } }),
        prisma.fileCopy.count({ where: { channelId: id, file: { uploadSource: 'Record' } } }),
      ]);
      const detail = [
        `${copies} 个文件副本`,
        trash ? `其中回收站 ${trash} 个` : '',
        registered ? `登记文件 ${registered} 个` : '',
      ].filter(Boolean).join('，');
      return { success: false, message: `该渠道仍有 ${detail}，请先删除这些文件（含回收站与登记文件）后再删除渠道` };
    }
    await prisma.channel.delete({ where: { id } });
    return { success: true };
  }
}

/**
 * 某账户可用的渠道列表（下拉框数据源）—— v2.4.0 从 ChannelManageController 拆出。
 *
 * 为什么要单独一个控制器：原位置挂在整体 AdminGuard 的控制器里，
 * 普通用户登录自己的「用户编辑页」时调它直接 403，导致主渠道 / 备份渠道
 * 下拉永远加载不出管理员已授权的渠道。
 *
 * 守卫用 ManageAuthGuard（管理员与普通用户都可进入）：
 *   管理员 → 可查任意账户（username 参数），不传则返回全部渠道；
 *   普通用户 → 只能查自己，返回自己被授权的渠道 + 本地存储。
 */
@Controller('api/manage/channels')
@UseGuards(ManageAuthGuard)
export class ChannelAllowedController {
  @Get('allowed/list')
  async allowed(@Req() req: Request, @Query('username') username?: string) {
    const session = currentSession(req);
    const admin = isAdminRole(session?.role);
    const target = String(username || session?.user || '').trim();
    if (!admin && target && target !== session?.user) {
      return { success: false, message: '只能查看自己的渠道' };
    }
    const channels = await prisma.channel.findMany({
      where: { enabled: true },
      orderBy: CHANNEL_ORDER_BY,
    });
    const list = channels
      .filter((c) => (admin && !target ? true : channelVisibleTo(c.authorizedUsers, c.type, target, admin)))
      .map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        type: c.type,
        typeCode: c.typeCode,
        isMain: c.isMain,
        isBackup: c.isBackup,
        backupPool: c.backupPool,
      }));
    appLog.info('channel', `渠道下拉（allowed/list）：${session?.user || '-'}${target && target !== session?.user ? ` → ${target}` : ''}，共 ${list.length} 个`);
    return { success: true, data: list };
  }
}
