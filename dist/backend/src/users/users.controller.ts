import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { prisma } from '../common/prisma';
import { normalizeUploadSource } from '../common/file-view';
import { CryptoService } from '../common/crypto.service';
import { backendSub } from '../common/project-paths';
import { generateTotpSecret, totpUri, verifyTotp } from '../common/totp';
import { consumeRecoveryCode, countRecoveryCodes, generateRecoveryCodes } from '../common/recovery';
import { MailService } from '../mail/mail.service';
import { maskEmail } from '../auth/auth.controller';
import { channelVisibleTo } from '../common/channel-access';
import { appLog } from '../common/app-log';
import { ManageAuthGuard, currentSession, isAdminRole } from '../auth/auth.guard';
import { SysConfigService } from '../settings/sysconfig.service';
import { SettingsService } from '../settings/settings.service';
import { ipDisplayBatch } from '../common/ip-query';

/** 会话有效期默认值（天）：账户留空时生效 */
const DEFAULT_SESSION_DAYS = 7;
/** 头像尺寸（正方形，px）—— 后台缩略图与前端 logo 都够用，单张约 10~20KB */
const AVATAR_SIZE = 256;
/** 用户公告在 settings 表里的键 */
const NOTICE_KEY = 'userNotice';

/**
 * 用户管理。
 *
 * 账户体系约定（v202610221824 重构）：
 *   - 管理员与普通用户**都在 users 表里**（管理员 = role 'admin' 的那条记录）；
 *     「安全设置 → 管理端认证」不再承担账号管理职责，用户名/密码统一在本页修改；
 *   - 用户名可自行修改，但全表唯一（改名前先查重）；
 *   - 普通用户只能看到并修改自己这一条（用户名/密码/昵称/邮箱/头像/2FA/会话有效期），
 *     其余管理字段（启用状态、权限、渠道、管理备注）只有管理员能改；
 *   - 渠道绑定只能从「该用户获授权」的渠道里选，越权值直接忽略。
 */
@Controller('api/manage/users')
@UseGuards(ManageAuthGuard)
export class UsersController {
  constructor(
    private sysConfig: SysConfigService,
    private settings: SettingsService,
    private mail: MailService,
  ) {}

  /** 当前会话是否管理员（admin / super） */
  private isAdmin(req: Request): boolean {
    return isAdminRole(currentSession(req)?.role);
  }

  /** 当前登录账户名 */
  private me(req: Request): string {
    return currentSession(req)?.user || '';
  }

  /** 管理员账户名：users 表里最早的 admin → 环境变量 → admin */
  private async adminUsername(): Promise<string> {
    try {
      const admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
      if (admin?.username) return admin.username;
    } catch {
      /* 忽略 */
    }
    return (process.env.ADMIN_USER || '').trim() || (process.env.SUPER_ADMIN_USERNAME || '').trim() || 'admin';
  }

  /**
   * 内建管理员账户的「用户管理」字段。
   * 仅当 users 表里一条 admin 都没有（老库升级）时才会用到 —— 其配置存 adminProfile。
   */
  private async readAdminProfile(): Promise<Record<string, unknown>> {
    try {
      const raw = await this.sysConfig.get('adminProfile');
      return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** 渠道 ID → 展示名 回显（「code · name」） */
  private async channelLabelMap(): Promise<Map<string, string>> {
    const channels = await prisma.channel.findMany({ select: { id: true, name: true, code: true } });
    const m = new Map<string, string>();
    for (const c of channels) {
      const label = c.code ? `${c.code} · ${c.name}` : c.name;
      m.set(c.id, label);
      if (c.code) m.set(c.code, label);
    }
    return m;
  }

  /** 用户公告（所有登录用户可读；管理员可写） */
  private async readNotice(): Promise<string> {
    return (await this.settings.get(NOTICE_KEY, '')) || '';
  }

  /**
   * 某账户「可用渠道」的 ID 集合（含渠道 id 与 6 位 code 两种写法）。
   *
   * 规则与 /api/channels 的可见性一致（统一走 channelVisibleTo）：
   *   · 管理员全部可用；普通用户只拿到 authorizedUsers 里点过名的渠道
   *     （v2.7.0 起本地存储渠道与其它渠道完全同规则，无恒可用兜底）。
   * 编辑页的主/备渠道下拉、保存时的越权校验都以此为准。
   */
  private async authorizedChannelIds(username: string): Promise<Set<string>> {
    const out = new Set<string>();
    const rows = await prisma.channel.findMany({
      select: { id: true, code: true, type: true, authorizedUsers: true },
    });
    let isAdmin = false;
    try {
      const me = await prisma.user.findUnique({ where: { username }, select: { role: true } });
      isAdmin = me?.role === 'admin';
    } catch {
      isAdmin = false;
    }
    for (const c of rows) {
      // v2.6.0：可见性判断统一走 channelVisibleTo（本地存储也支持授权名单）
      const ok = channelVisibleTo(c.authorizedUsers, c.type, username, isAdmin);
      if (!ok) continue;
      out.add(c.id);
      if (c.code) out.add(c.code);
    }
    return out;
  }

  /** 用户列表（管理员看全部 + 内建管理员行；普通用户只看自己） */
  @Get()
  async list(@Req() req: Request) {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    const cName = await this.channelLabelMap();
    const rows: Array<Record<string, unknown>> = users.map((u) => ({
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      email: u.email || '',
      avatar: u.avatar || '',
      role: u.role,
      enabled: u.enabled,
      canEdit: u.canEdit,
      canDelete: u.canDelete,
      linkEnabled: u.linkEnabled,
      // v3.0.0：对外分享权限（管理员默认拥有，与 sessionCheck 保持一致）
      shareEnabled: u.role === 'admin' || u.role === 'super' ? true : !!u.shareEnabled,
      enforceLimits: u.enforceLimits,
      // v2.8.8：账户级「视频兼容转码」策略 + 单文件大小限制
      transcodePolicy: u.transcodePolicy || 'inherit',
      maxFileSizeMB: Number(u.maxFileSizeMB) || 0,
      mainChannelId: u.mainChannelId,
      backupChannelId: u.backupChannelId,
      mainChannelName: cName.get(u.mainChannelId) || '',
      backupChannelName: cName.get(u.backupChannelId) || '',
      totpEnabled: u.totpEnabled,
      emailVerified: u.emailVerified,
      recoveryCount: countRecoveryCodes(u.recoveryHashes),
      frontSessionDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
      backSessionDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
      // 管理备注：仅管理员可见，下面非管理员分支会剔除该字段
      adminNote: u.adminNote || '',
      createdAt: u.createdAt,
    }));
    if (!this.isAdmin(req)) {
      const me = this.me(req);
      return rows
        .filter((r) => r.username === me)
        .map(({ adminNote: _omit, ...rest }) => rest);
    }
    // 老库（users 表无 admin）才补一行虚拟管理员
    const adminUser = await this.adminUsername();
    if (!rows.some((r) => r.role === 'admin')) {
      const prof = await this.readAdminProfile();
      const mainId = String(prof.mainChannelId || '');
      const backupId = String(prof.backupChannelId || '');
      rows.unshift({
        id: `__admin__${adminUser}`,
        username: adminUser,
        nickname: String(prof.nickname || '管理员'),
        email: String(prof.email || ''),
        avatar: '',
        role: 'admin',
        enabled: true,
        canEdit: true,
        canDelete: true,
        linkEnabled: true,
        shareEnabled: true,
        enforceLimits: prof.enforceLimits !== false,
        transcodePolicy: String(prof.transcodePolicy || 'inherit'),
        maxFileSizeMB: Number(prof.maxFileSizeMB) || 0,
        mainChannelId: mainId,
        backupChannelId: backupId,
        mainChannelName: cName.get(mainId) || '',
        backupChannelName: cName.get(backupId) || '',
        totpEnabled: false,
        frontSessionDays: DEFAULT_SESSION_DAYS,
        backSessionDays: DEFAULT_SESSION_DAYS,
        adminNote: String(prof.adminNote || ''),
        createdAt: null,
        builtin: true,
      });
    }
    return rows;
  }

  /** 精简列表 —— 供「文件管理 → 用户筛选下拉」「历史记录 → 用户筛选」使用 */
  @Get('options')
  async options(@Req() req: Request) {
    if (!this.isAdmin(req)) {
      const me = this.me(req);
      return me ? [{ username: me, nickname: me }] : [];
    }
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map((u) => ({
      username: u.username,
      nickname: u.nickname || u.username,
      avatar: u.avatar || '',
      role: u.role,
      // v2.9.0：筛选弹窗「用户」页按「最近创建」倒序，需要创建时间
      createdAt: u.createdAt,
    }));
  }

  /** 用户公告：读取（登录即可） */
  @Get('notice')
  async getNotice(@Req() req: Request) {
    if (!currentSession(req)) return { success: false, message: '未登录' };
    return { success: true, data: { content: await this.readNotice() } };
  }

  /** 用户公告：保存（仅管理员）。内容支持 HTML，前端按富文本渲染 */
  @Post('notice')
  async saveNotice(@Req() req: Request, @Body() body: { content?: string }) {
    if (!this.isAdmin(req)) return { success: false, message: '没有权限发布公告' };
    const content = String(body.content ?? '').slice(0, 20000);
    await this.settings.set(NOTICE_KEY, content);
    return { success: true, data: { content } };
  }

  /**
   * 归集统计：把文件按「用户账户」或「IP 地址」归集。
   *   mode=user（默认）→ key 为用户名
   *   mode=ip          → key 为 IP，附带归属地
   */
  @Get('collect')
  async collect(@Req() req: Request, @Query('mode') mode?: string) {
    const admin = this.isAdmin(req);
    const me = this.me(req);
    const byIp = admin && mode === 'ip';
    const files = await prisma.fileRecord.findMany({
      where: { status: 'active', ...(admin ? {} : { uploader: me || '' }) },
      select: {
        uploader: true, ip: true, size: true, createdAt: true, metas: true,
        uploadSource: true,
      },
    });

    const buckets = new Map<string, { key: string; count: number; size: number; lastAt: number; address?: string; sources: Set<string> }>();
    for (const f of files) {
      const key = (byIp ? f.ip : f.uploader) || (byIp ? '(未知IP)' : '(匿名)');
      const b = buckets.get(key) || { key, count: 0, size: 0, lastAt: 0, sources: new Set<string>() };
      b.count += 1;
      b.size += f.size || 0;
      b.lastAt = Math.max(b.lastAt, f.createdAt.getTime());
      b.sources.add(normalizeUploadSource(f.uploadSource));
      if (byIp && !b.address) {
        try {
          b.address = (JSON.parse(f.metas || '{}').UploadAddress as string) || '';
        } catch {
          /* 忽略 */
        }
      }
      buckets.set(key, b);
    }

    if (byIp) {
      const ips = Array.from(buckets.keys());
      const records = await prisma.ipRecord.findMany({ where: { ip: { in: ips } } });
      for (const r of records) {
        const b = buckets.get(r.ip);
        if (b) b.address = [r.country, r.region, r.city].filter(Boolean).join(' ') || b.address;
      }
      // v2.6.0 #301：全系统 IP 显示统一 —— 每行附格式化展示文本
      try {
        const fallback = new Map<string, string>();
        for (const [k, b] of buckets) if (byIp) fallback.set(k, b.address || '');
        const displays = await ipDisplayBatch(ips, fallback, this.sysConfig);
        for (const [k, b] of buckets) {
          const d = displays.get(k);
          if (d) (b as any).display = d;
        }
      } catch {
        /* 忽略 */
      }
    }

    const items = Array.from(buckets.values())
      .map(({ sources, ...b }) => ({
        ...b,
        uploadSources: Array.from(sources).sort(),
      }))
      .sort((a, b) => b.count - a.count);
    return { mode: byIp ? 'ip' : 'user', items };
  }

  /** 用户名合法性 + 唯一性校验（改名与新建共用） */
  private async checkUsername(username: string, selfId?: string): Promise<string | null> {
    if (!username) return '用户名不能为空';
    if (!/^[A-Za-z0-9_.@-]{2,32}$/.test(username)) {
      return '用户名仅支持字母/数字/_ . @ - ，长度 2-32';
    }
    const dup = await prisma.user.findFirst({
      where: { username, ...(selfId ? { NOT: { id: selfId } } : {}) },
    });
    if (dup) return `用户名「${username}」已存在`;
    return null;
  }

  /**
   * 单个账户详情（用户编辑独立页用）。
   * 权限与列表一致：管理员可查任意账户；普通用户只能查自己。
   */
  @Get(':id')
  async detail(@Req() req: Request, @Param('id') id: string) {
    const admin = this.isAdmin(req);
    // 老库虚拟管理员行
    if (id.startsWith('__admin__')) {
      if (!admin) return { success: false, message: '没有权限查看该账户' };
      const name = id.replace('__admin__', '');
      const prof = await this.readAdminProfile();
      return {
        success: true,
        data: {
          id,
          username: name,
          nickname: String(prof.nickname || '管理员'),
          email: String(prof.email || ''),
          avatar: '',
          role: 'admin',
          enabled: true,
          canEdit: true,
          canDelete: true,
          linkEnabled: true,
          // v3.0.0：管理员默认拥有对外分享权限
          shareEnabled: true,
          enforceLimits: prof.enforceLimits !== false,
          transcodePolicy: String(prof.transcodePolicy || 'inherit'),
          maxFileSizeMB: Number(prof.maxFileSizeMB) || 0,
          mainChannelId: String(prof.mainChannelId || ''),
          backupChannelId: String(prof.backupChannelId || ''),
          totpEnabled: false,
          frontSessionDays: DEFAULT_SESSION_DAYS,
          backSessionDays: DEFAULT_SESSION_DAYS,
          adminNote: String(prof.adminNote || ''),
          builtin: true,
        },
      };
    }
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { success: false, message: '用户不存在' };
    if (!admin && u.username !== this.me(req)) return { success: false, message: '没有权限查看该账户' };
    return {
      success: true,
      data: {
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        email: u.email || '',
        avatar: u.avatar || '',
        avatarUrl: u.avatar ? `/api/avatar/${encodeURIComponent(u.username)}?v=${encodeURIComponent(u.avatar)}` : '',
        role: u.role,
        enabled: u.enabled,
        canEdit: u.canEdit,
        canDelete: u.canDelete,
        linkEnabled: u.linkEnabled,
        // v3.0.0：对外分享权限（管理员默认拥有）
        shareEnabled: u.role === 'admin' || u.role === 'super' ? true : !!u.shareEnabled,
        enforceLimits: u.enforceLimits,
        // v2.8.8：账户级转码策略与单文件大小限制（管理员操作模块展示）
        transcodePolicy: u.transcodePolicy || 'inherit',
        maxFileSizeMB: Number(u.maxFileSizeMB) || 0,
        mainChannelId: u.mainChannelId,
        backupChannelId: u.backupChannelId,
        totpEnabled: u.totpEnabled,
        emailVerified: u.emailVerified,
        recoveryCount: countRecoveryCodes(u.recoveryHashes),
        recoveryAt: u.recoveryAt ? u.recoveryAt.getTime() : 0,
        // 邮箱服务是否已可用（前端据此决定「验证邮箱」按钮是否可点）
        mailReady: await this.mail.configured(),
        frontSessionDays: u.frontSessionDays ?? DEFAULT_SESSION_DAYS,
        backSessionDays: u.backSessionDays ?? DEFAULT_SESSION_DAYS,
        // v3.0.0（R16）：账户自定义背景图（JSON 数组字符串，空串 = 跟随系统设置）
        uploadBkImg: u.uploadBkImg || '',
        adminBkImg: u.adminBkImg || '',
        // v1.0.6：对外 WebDAV 授权（管理员操作 → 启用 WebDAV 功能 / 允许创建数量）
        webdavEnabled: !!u.webdavEnabled,
        webdavMax: Number(u.webdavMax) || 2,
        // 管理备注只回给管理员
        adminNote: admin ? u.adminNote || '' : '',
        createdAt: u.createdAt,
        // 是否本人（前端据此决定哪些字段可改用）
        self: u.username === this.me(req),
      },
    };
  }

  /** 创建普通用户（仅管理员） */
  @Post()
  async create(
    @Req() req: Request,
    @Body()
    body: {
      username?: string;
      password?: string;
      nickname?: string;
      email?: string;
      enabled?: boolean;
      canEdit?: boolean;
      canDelete?: boolean;
      linkEnabled?: boolean;
      /** v3.0.0：对外分享权限（管理员操作 → 分享权限） */
      shareEnabled?: boolean;
      enforceLimits?: boolean;
      /** v2.8.8：账户级「视频兼容转码」策略 */
      transcodePolicy?: string;
      /** v2.8.8：账户级单文件大小上限（MB，0 = 跟随全局） */
      maxFileSizeMB?: number;
      mainChannelId?: string;
      backupChannelId?: string;
      adminNote?: string;
    },
  ) {
    if (!this.isAdmin(req)) return { success: false, message: '没有权限创建用户' };
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const nameErr = await this.checkUsername(username);
    if (nameErr) return { success: false, message: nameErr };
    if (!password) return { success: false, message: '密码不能为空' };
    if (password.length < 4) return { success: false, message: '密码至少 4 位' };

    const u = await prisma.user.create({
      data: {
        username,
        passwordHash: CryptoService.hashPassword(password),
        uploadPassword: '',
        nickname: String(body.nickname || '').trim(),
        email: String(body.email || '').trim().slice(0, 120),
        role: 'user', // 后台创建一律普通用户
        enabled: body.enabled !== false,
        canEdit: body.canEdit !== false,
        canDelete: body.canDelete !== false,
        linkEnabled: body.linkEnabled !== false,
        enforceLimits: body.enforceLimits !== false,
        transcodePolicy: normalizeTranscodePolicy(body.transcodePolicy),
        maxFileSizeMB: clampMaxFileSizeMB(body.maxFileSizeMB),
        mainChannelId: String(body.mainChannelId || ''),
        backupChannelId: String(body.backupChannelId || ''),
        adminNote: String(body.adminNote || '').slice(0, 4000),
      },
    });
    return { success: true, data: { id: u.id } };
  }

  /**
   * 修改用户。
   *   本人可改：用户名 / 密码 / 昵称 / 邮箱 / 会话有效期（前后端）
   *   管理员另可改：启用状态 / 编辑权 / 删除权 / 链接权限 / 类型大小限制 / 主备渠道 / 管理备注
   */
  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      username?: string;
      password?: string;
      /** v2.6.0：本人改密验证 —— 原密码 / 邮箱验证码 / 2FA 动态码（三选一） */
      oldPassword?: string;
      emailCode?: string;
      totpCode?: string;
      /** v3.0.0（R12）：三选一合并为一个输入框后的统一凭据（自动识别类型） */
      verifyCode?: string;
      /** v2.6.0：管理员改他人密码时必填 —— 管理员自己的密码 */
      adminPassword?: string;
      nickname?: string;
      email?: string;
      enabled?: boolean;
      canEdit?: boolean;
      canDelete?: boolean;
      linkEnabled?: boolean;
      /** v3.0.0：对外分享权限（管理员操作 → 分享权限） */
      shareEnabled?: boolean;
      enforceLimits?: boolean;
      /** v2.8.8：账户级「视频兼容转码」策略 */
      transcodePolicy?: string;
      /** v2.8.8：账户级单文件大小上限（MB，0 = 跟随全局） */
      maxFileSizeMB?: number;
      mainChannelId?: string;
      backupChannelId?: string;
      adminNote?: string;
      frontSessionDays?: number | null;
      backSessionDays?: number | null;
      /** v3.0.0（R16）：账户自定义背景图（JSON 数组字符串） */
      uploadBkImg?: string;
      adminBkImg?: string;
      /** v1.0.6：对外 WebDAV 授权（仅管理员可改，在「管理员操作」里） */
      webdavEnabled?: boolean;
      webdavMax?: number;
    },
  ) {
    // ---- 老库的虚拟管理员行（users 表无 admin 时）----
    if (id.startsWith('__admin__')) {
      if (!this.isAdmin(req)) return { success: false, message: '只能修改自己的账户' };
      const patch: Record<string, unknown> = {};
      if (body.nickname !== undefined) patch.nickname = String(body.nickname);
      if (body.email !== undefined) patch.email = String(body.email);
      if (body.mainChannelId !== undefined) patch.mainChannelId = String(body.mainChannelId);
      if (body.backupChannelId !== undefined) patch.backupChannelId = String(body.backupChannelId);
      if (body.enforceLimits !== undefined) patch.enforceLimits = !!body.enforceLimits;
      if (body.transcodePolicy !== undefined) patch.transcodePolicy = normalizeTranscodePolicy(body.transcodePolicy);
      if (body.maxFileSizeMB !== undefined) patch.maxFileSizeMB = clampMaxFileSizeMB(body.maxFileSizeMB);
      if (body.adminNote !== undefined) patch.adminNote = String(body.adminNote).slice(0, 4000);
      await this.sysConfig.save('adminProfile', patch);
      return { success: true };
    }

    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { success: false, message: '用户不存在' };
    const admin = this.isAdmin(req);
    const self = u.username === this.me(req);
    if (!admin && !self) return { success: false, message: '只能修改自己的账户' };

    const data: Record<string, unknown> = {};

    // ---- 用户名（可改，全表唯一）----
    if (body.username !== undefined) {
      const next = String(body.username).trim();
      if (next !== u.username) {
        const err = await this.checkUsername(next, u.id);
        if (err) return { success: false, message: err };
        data.username = next;
      }
    }
    // ---- 密码（v2.6.0：改密必须先验证身份）----
    if (body.password !== undefined && body.password !== '') {
      if (String(body.password).length < 4) return { success: false, message: '密码至少 4 位' };
      if (admin && !self) {
        // 管理员改「他人」密码 → 必须输入管理员自己的密码
        const okAdmin = await this.verifyAdminPassword(req, String(body.adminPassword || ''));
        if (!okAdmin) return { success: false, message: '请输入正确的管理员密码后再修改他人密码' };
      } else {
        // 本人（含管理员本人）改密 → 原密码 / 邮箱验证码 / 2FA 动态码 三选一
        const v = this.verifySelfPassword(u, body);
        if (!v.ok) return { success: false, message: v.message };
      }
      data.passwordHash = CryptoService.hashPassword(String(body.password));
    }
    // ---- 基础资料（本人可改）----
    if (body.nickname !== undefined) data.nickname = String(body.nickname).slice(0, 60);
    if (body.email !== undefined) {
      const email = String(body.email).trim().slice(0, 120);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, message: '邮箱格式不正确' };
      if (email !== (u.email || '')) {
        // 已验证的邮箱不允许在这里直接改 —— 必须走「验证邮箱 → 收验证码 → 校验通过」流程，
        // 否则等于绕开验证把已验证标记挪到一个没验证过的地址上。
        if (u.emailVerified) {
          return { success: false, message: '该邮箱已验证，更换邮箱请点击「更换邮箱」并重新接收验证码' };
        }
        data.email = email;
        data.emailVerified = false;
      }
    }
    // ---- 会话有效期（本人可改；null/留空 = 默认 7 天）----
    for (const key of ['frontSessionDays', 'backSessionDays'] as const) {
      const raw = body[key];
      if (raw === undefined) continue;
      if (raw === null || String(raw).trim() === '') {
        data[key] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 3650) {
        return { success: false, message: '会话有效期需在 0~3650 天之间（0 = 永久）' };
      }
      data[key] = Math.floor(n);
    }

    /*
     * v3.0.0（R16）：账户自定义背景图 —— 本人与管理员都可改（属于账户个人偏好，
     * 只影响自己的上传页 / 管理页观感，不涉及全局配置）。
     */
    for (const key of ['uploadBkImg', 'adminBkImg'] as const) {
      if (body[key] === undefined) continue;
      const v = normalizeBkImg(body[key]);
      if (v === null) return { success: false, message: '背景图格式不正确，需为 ["图片地址1","图片地址2"]' };
      data[key] = v;
    }

    // ---- 以下字段仅管理员可改 ----
    if (admin) {
      if (body.enabled !== undefined) data.enabled = !!body.enabled;
      if (body.canEdit !== undefined) data.canEdit = !!body.canEdit;
      if (body.canDelete !== undefined) data.canDelete = !!body.canDelete;
      if (body.linkEnabled !== undefined) data.linkEnabled = !!body.linkEnabled;
      // v3.0.0：对外分享权限（管理员操作 → 分享权限）
      if (body.shareEnabled !== undefined) data.shareEnabled = !!body.shareEnabled;
      if (body.enforceLimits !== undefined) data.enforceLimits = !!body.enforceLimits;
      if (body.transcodePolicy !== undefined) data.transcodePolicy = normalizeTranscodePolicy(body.transcodePolicy);
      if (body.maxFileSizeMB !== undefined) data.maxFileSizeMB = clampMaxFileSizeMB(body.maxFileSizeMB);
      if (body.adminNote !== undefined) data.adminNote = String(body.adminNote).slice(0, 4000);
      /*
       * v1.0.6：对外 WebDAV 授权。
       * 只给普通用户开 —— 管理员账户一律禁止使用 WebDAV（需求约定），
       * 这里顺手把开关钳成 false，避免界面上误开却永远用不了。
       */
      if (body.webdavEnabled !== undefined) {
        data.webdavEnabled = u.role === 'user' ? !!body.webdavEnabled : false;
      }
      if (body.webdavMax !== undefined) {
        const n = Math.floor(Number(body.webdavMax));
        data.webdavMax = Number.isFinite(n) ? Math.min(50, Math.max(1, n)) : 2;
      }
    }
    // ---- 主/备渠道：本人也能改（v2.3.0）----
    // 但只能从「该账户已获授权」的渠道里选；空 = 跟随全局，'none' = 明确不备份。
    if (body.mainChannelId !== undefined || body.backupChannelId !== undefined) {
      const allowed = await this.authorizedChannelIds(u.username);
      if (body.mainChannelId !== undefined) {
        const v = String(body.mainChannelId || '');
        if (v && !allowed.has(v)) return { success: false, message: '该存储渠道未授权给此账户' };
        data.mainChannelId = v;
      }
      if (body.backupChannelId !== undefined) {
        const v = String(body.backupChannelId || '');
        if (v && v !== 'none' && !allowed.has(v)) return { success: false, message: '该备份渠道未授权给此账户' };
        data.backupChannelId = v;
      }
    }

    if (Object.keys(data).length === 0) return { success: false, message: '没有可修改的内容' };
    const updated = await prisma.user.update({ where: { id }, data });

    // 改名后：该账户名下文件的 uploader 字段同步，避免归集统计与「只能看自己的文件」失配
    if (data.username && updated.username !== u.username) {
      await prisma.fileRecord.updateMany({ where: { uploader: u.username }, data: { uploader: updated.username } });
    }
    return { success: true, data: { username: updated.username } };
  }

  /** 删除用户（其已上传文件保留，归属信息不清空）（仅管理员） */
  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    if (!this.isAdmin(req)) return { success: false, message: '没有权限删除用户' };
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { success: false, message: '用户不存在' };
    if (u.role === 'admin') return { success: false, message: '不能删除管理员账户' };
    await prisma.user.delete({ where: { id } });
    // 顺手删掉头像文件（固定命名，不删会残留）
    await fsp.unlink(join(avatarDir(), `${id}.webp`)).catch(() => undefined);
    return { success: true };
  }

  /* ================= 头像 ================= */

  /**
   * 上传头像（本人或管理员）。
   *
   * 落盘规则（需求约定）：
   *   - 固定路径 uploads/avatars/<userId>.webp —— 每次覆盖同一个文件，
   *     所以每个用户在磁盘上永远只有一张头像，不会随修改次数堆积；
   *   - 统一裁剪成 256×256 正方形（居中裁切 + webp 质量 88），
   *     前端已做在线裁剪的话这里相当于二次兜底；
   *   - 数据库只存版本戳（毫秒时间戳），前端用它做 URL 参数破缓存。
   */
  @Post(':id/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async uploadAvatar(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype?: string; originalname?: string; size?: number },
  ) {
    if (!file?.buffer?.length) return { success: false, message: '没有收到图片文件' };
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { success: false, message: '用户不存在' };
    if (!this.isAdmin(req) && u.username !== this.me(req)) return { success: false, message: '只能修改自己的头像' };

    let out: Buffer;
    try {
      const sharp = (await import('sharp')).default;
      out = await sharp(file.buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
        .webp({ quality: 88 })
        .toBuffer();
    } catch (err) {
      return { success: false, message: `图片处理失败：${(err as Error).message}` };
    }

    const dir = avatarDir();
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(join(dir, `${u.id}.webp`), out);

    const version = String(Date.now());
    await prisma.user.update({ where: { id: u.id }, data: { avatar: version } });
    return {
      success: true,
      data: {
        avatar: version,
        avatarUrl: `/api/avatar/${encodeURIComponent(u.username)}?v=${version}`,
      },
    };
  }

  /** 删除头像（恢复默认 logo） */
  @Delete(':id/avatar')
  async removeAvatar(@Req() req: Request, @Param('id') id: string) {
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { success: false, message: '用户不存在' };
    if (!this.isAdmin(req) && u.username !== this.me(req)) return { success: false, message: '只能修改自己的头像' };
    await fsp.unlink(join(avatarDir(), `${u.id}.webp`)).catch(() => undefined);
    await prisma.user.update({ where: { id: u.id }, data: { avatar: '' } });
    return { success: true };
  }

  /* ================= 邮箱验证（v2.3.0） ================= */

  /**
   * 发送邮箱验证码。
   *   body.email 缺省 → 发到账户当前邮箱（首次验证 / 重新验证）
   *   body.email 有值且与当前邮箱不同 → 发到新地址（「更换邮箱」流程）
   * 只有校验通过（:id/email/verify）才会真正写库并置 emailVerified。
   */
  @Post(':id/email/send-code')
  async sendEmailCode(@Req() req: Request, @Param('id') id: string, @Body() body: { email?: string }) {
    const target = await this.emailTarget(req, id);
    if (!target.u) return { success: false, message: target.err };
    const email = String(body?.email || target.u.email || '').trim().toLowerCase();
    if (!email) return { success: false, message: '请先填写邮箱地址' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, message: '邮箱格式不正确' };
    if (target.u.emailVerified && email === (target.u.email || '').toLowerCase()) {
      return { success: false, message: '该邮箱已验证，无需重复验证' };
    }
    if (!(await this.mail.configured())) {
      return { success: false, message: '管理员尚未配置发信邮箱（安全设置 → 邮箱配置）' };
    }
    const r = await this.mail.sendCode(email, 'verify-email', target.u.nickname || target.u.username);
    if (!r.ok) return { success: false, message: r.message };
    return { success: true, message: `验证码已发送至 ${maskEmail(email)}`, data: { email } };
  }

  /** 校验邮箱验证码：通过后写入 email 并置 emailVerified=true */
  @Post(':id/email/verify')
  async verifyEmail(@Req() req: Request, @Param('id') id: string, @Body() body: { email?: string; code?: string }) {
    const target = await this.emailTarget(req, id);
    if (!target.u) return { success: false, message: target.err };
    const email = String(body?.email || target.u.email || '').trim().toLowerCase();
    if (!email) return { success: false, message: '请先填写邮箱地址' };
    const code = String(body?.code || '').trim();
    // v3.0.0（R9 修复）：邮箱验证码为 6 位字母数字（与前端 R8 放开的规则一致）——
    // 此前后端仍只认纯数字，字母验证码即使输对也被这里拦下并提示「请输入 6 位验证码」。
    if (!/^[0-9A-Za-z]{6}$/.test(code)) return { success: false, message: '请输入 6 位验证码' };
    const r = this.mail.consumeCode(email, 'verify-email', code);
    if (!r.ok) return { success: false, message: r.message };

    // 其他账户已占用该邮箱 → 拒绝，避免「邮箱验证码登录」时不知道该给谁发
    const dup = await prisma.user.findFirst({
      where: { email, emailVerified: true, NOT: { id: target.u.id } },
      select: { username: true },
    });
    if (dup) return { success: false, message: '该邮箱已被其他账户验证使用' };

    await prisma.user.update({ where: { id: target.u.id }, data: { email, emailVerified: true } });
    appLog.info('user', `账户「${target.u.username}」邮箱验证通过（${maskEmail(email)}）`);
    return { success: true, message: '邮箱验证成功', data: { email, emailVerified: true } };
  }

  /** 取消邮箱验证（管理员 / 本人）—— 用于换绑前清理状态 */
  @Delete(':id/email/verified')
  async resetEmailVerified(@Req() req: Request, @Param('id') id: string) {
    const target = await this.emailTarget(req, id);
    if (!target.u) return { success: false, message: target.err };
    if (target.u.totpEnabled) return { success: false, message: '请先关闭两步验证，否则将无法接收验证码' };
    await prisma.user.update({ where: { id: target.u.id }, data: { emailVerified: false } });
    return { success: true, message: '已取消邮箱验证状态' };
  }

  /** 邮箱操作的权限校验：本人或管理员 */
  private async emailTarget(req: Request, id: string) {
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { u: null, err: '用户不存在' };
    if (!this.isAdmin(req) && u.username !== this.me(req)) return { u: null, err: '只能操作自己的账户' };
    return { u, err: '' };
  }

  /* ================= 两步验证（TOTP） ================= */

  /** 权限校验：本人或管理员 */
  private async totpTarget(req: Request, id: string) {
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { u: null, err: '用户不存在' };
    if (!this.isAdmin(req) && u.username !== this.me(req)) return { u: null, err: '只能操作自己的账户' };
    return { u, err: '' };
  }

  /**
   * v2.6.0：本人修改密码的身份验证 —— 原密码 / 邮箱验证码 / 2FA 动态码 三选一。
   * 依次尝试用户提交的凭据，任一通过即可；全部为空给出明确提示。
   */
  private verifySelfPassword(
    u: { passwordHash: string; email: string; emailVerified: boolean; totpEnabled: boolean; totpSecret: string },
    body: { oldPassword?: string; emailCode?: string; totpCode?: string; verifyCode?: string; verifyType?: string },
  ): { ok: boolean; message?: string } {
    /*
     * v3.0.0（R14）：编辑页一个输入框 + 三个显式切换按钮（原密码 / 邮箱验证 / 两步验证），
     * 前端提交 verifyType（password / email / totp）+ verifyCode —— 按选定方式校验，
     * 不再「按内容猜」；邮箱验证码为 6 位大小写字母 + 数字（R12 的 /^\d{6}$/ 限制是
     * 混合字符集验证码永远匹配不上的根因，此处一并修复）。
     * 未传 verifyType 时保留 R12 的自动识别（兼容旧前端 / API 调用方）。
     */
    const merged = String(body.verifyCode || '').trim();
    const vType = String(body.verifyType || '').trim().toLowerCase();
    if (merged && vType) {
      if (vType === 'password') {
        if (CryptoService.verifyPassword(merged, u.passwordHash)) return { ok: true };
        return { ok: false, message: '原密码不正确' };
      }
      if (vType === 'email') {
        if (!u.email || !u.emailVerified) return { ok: false, message: '该账户邮箱未验证，无法使用邮箱验证码改密' };
        const r = this.mail.consumeAnyCode(u.email, ['change-password', 'login'], merged);
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      }
      if (vType === 'totp') {
        if (!u.totpEnabled || !u.totpSecret) return { ok: false, message: '该账户未启用两步验证' };
        try {
          if (verifyTotp(CryptoService.decrypt(u.totpSecret), merged)) return { ok: true };
        } catch {
          /* 解密失败按动态码错误处理 */
        }
        return { ok: false, message: '动态码错误或已过期' };
      }
      return { ok: false, message: '身份验证方式无效' };
    }
    if (merged) {
      /* R12 兼容：未指定类型时按内容自动识别 */
      if (CryptoService.verifyPassword(merged, u.passwordHash)) return { ok: true };
      if (merged.length <= 8) {
        if (u.email && u.emailVerified) {
          const r = this.mail.consumeAnyCode(u.email, ['change-password', 'login'], merged);
          if (r.ok) return { ok: true };
        }
        if (u.totpEnabled && u.totpSecret) {
          try {
            if (verifyTotp(CryptoService.decrypt(u.totpSecret), merged)) return { ok: true };
          } catch {
            /* 解密失败按动态码错误处理 */
          }
        }
      }
      return { ok: false, message: '身份验证失败：原密码 / 邮箱验证码 / 两步验证动态码均不匹配' };
    }
    const oldPassword = String(body.oldPassword || '');
    const emailCode = String(body.emailCode || '').trim();
    const totpCode = String(body.totpCode || '').trim();
    if (!oldPassword && !emailCode && !totpCode) {
      return { ok: false, message: '修改密码需要验证身份：请输入原密码、邮箱验证码或两步验证动态码（任一）' };
    }
    if (oldPassword) {
      if (CryptoService.verifyPassword(oldPassword, u.passwordHash)) return { ok: true };
      return { ok: false, message: '原密码不正确' };
    }
    if (emailCode) {
      if (!u.email || !u.emailVerified) return { ok: false, message: '该账户邮箱未验证，无法使用邮箱验证码改密' };
      // 兼容「登录验证码 / 修改密码验证码」两个入口签发的码
      const r = this.mail.consumeAnyCode(u.email, ['change-password', 'login'], emailCode);
      return r.ok ? { ok: true } : { ok: false, message: r.message };
    }
    // totpCode
    if (!u.totpEnabled || !u.totpSecret) return { ok: false, message: '该账户未启用两步验证' };
    try {
      if (verifyTotp(CryptoService.decrypt(u.totpSecret), totpCode)) return { ok: true };
    } catch {
      return { ok: false, message: '动态码错误或已过期' };
    }
    return { ok: false, message: '动态码错误或已过期' };
  }

  /**
   * v2.6.0：管理员修改「他人」密码时，校验提交的是管理员自己的密码。
   * 依次对 users 表管理员记录 → .env 超管 → 安全设置历史兜底账号验证。
   */
  private async verifyAdminPassword(req: Request, adminPassword: string): Promise<boolean> {
    const pwd = String(adminPassword || '');
    if (!pwd) return false;
    const me = this.me(req);
    const row = me ? await prisma.user.findUnique({ where: { username: me } }) : null;
    if (row && row.role === 'admin') return CryptoService.verifyPassword(pwd, row.passwordHash);
    // 超管（仅 .env 配置）
    const suUser = (process.env.SUPER_ADMIN_USERNAME || '').trim();
    const suPass = process.env.SUPER_ADMIN_PASSWORD || '';
    if (suUser && suPass && me === suUser && pwd === suPass) return true;
    // 历史兜底：安全设置里的管理端账号
    try {
      const raw = await this.sysConfig.readSecurityRaw();
      const cfgPass = String(raw?.auth?.admin?.adminPassword || '');
      const cfgUser = String(raw?.auth?.admin?.adminUsername || '').trim() || 'admin';
      if (cfgPass && me === cfgUser && pwd === cfgPass) return true;
    } catch {
      /* 忽略配置读取失败 */
    }
    return false;
  }

  /**
   * v2.6.0：给目标账户发「修改密码」验证码（本人或管理员可调用）。
   * 前端用户编辑页「修改密码」区使用；与 2FA 的发码端点互相独立。
   */
  @Post(':id/password/send-code')
  async sendPasswordChangeCode(@Req() req: Request, @Param('id') id: string) {
    const { u, err } = await this.totpTarget(req, id);
    if (!u) return { success: false, message: err };
    if (!u.email || !u.emailVerified) return { success: false, message: '该账户邮箱未验证，无法发送验证码' };
    if (!(await this.mail.configured())) {
      return { success: false, message: '管理员尚未配置发信邮箱（安全设置 → 邮箱配置）' };
    }
    const r = await this.mail.sendCode(u.email, 'change-password', u.nickname || u.username);
    if (!r.ok) return { success: false, message: r.message };
    return { success: true, message: `验证码已发送至 ${maskEmail(u.email)}`, data: { email: maskEmail(u.email) } };
  }

  /** 生成密钥（暂不启用），返回二维码内容 */
  @Post(':id/totp/setup')
  async totpSetup(@Req() req: Request, @Param('id') id: string) {
    const { u, err } = await this.totpTarget(req, id);
    if (!u) return { success: false, message: err };
    if (u.totpEnabled) return { success: false, message: '该账户已启用两步验证，请先关闭再重新绑定' };
    // v2.3.0：启用 2FA 前必须先验证邮箱 —— 邮箱是「验证器丢失」时的唯一自助找回通道，
    // 没有验证过的邮箱就开启 2FA，等于把自己锁在门外。
    if (!u.email || !u.emailVerified) {
      return { success: false, message: '请先完成邮箱验证，再启用两步验证' };
    }
    const secret = generateTotpSecret();
    // 先加密存库：用户扫码后提交验证码时从这里取（避免中途刷新页面丢失）
    await prisma.user.update({
      where: { id: u.id },
      data: { totpSecret: CryptoService.encrypt(secret), totpEnabled: false },
    });
    return {
      success: true,
      data: {
        secret,
        uri: totpUri(secret, u.username),
        digits: 6,
        period: 30,
      },
    };
  }

  /** 提交动态码，启用两步验证 */
  @Post(':id/totp/enable')
  async totpEnable(@Req() req: Request, @Param('id') id: string, @Body() body: { code?: string }) {
    const { u, err } = await this.totpTarget(req, id);
    if (!u) return { success: false, message: err };
    if (u.totpEnabled) return { success: false, message: '该账户已启用两步验证' };
    if (!u.totpSecret) return { success: false, message: '请先生成密钥' };
    let secret = '';
    try {
      secret = CryptoService.decrypt(u.totpSecret);
    } catch {
      return { success: false, message: '密钥读取失败，请重新生成' };
    }
    if (!verifyTotp(secret, String(body.code || ''))) {
      return { success: false, message: '验证码错误或已过期' };
    }
    // 生成一次性恢复码：明文只在这里返回一次，库里只留摘要（v2.3.0）
    const { plain, hashes } = generateRecoveryCodes();
    await prisma.user.update({
      where: { id: u.id },
      data: {
        totpEnabled: true,
        backVerifiedAt: new Date(),
        recoveryHashes: JSON.stringify(hashes),
        recoveryAt: new Date(),
      },
    });
    appLog.info('auth', `账户「${u.username}」启用了两步验证（已生成 ${plain.length} 个恢复码）`);
    return {
      success: true,
      // 前端必须把 recoveryCodes 展示一次并要求用户抄下来；接口不会再次返回
      data: { recoveryCodes: plain },
      message: '两步验证已启用，请立即保存恢复码（仅显示这一次）',
    };
  }

  /** 重新生成恢复码（需要当前动态码；旧恢复码全部作废） */
  @Post(':id/totp/recovery')
  async regenerateRecovery(@Req() req: Request, @Param('id') id: string, @Body() body: { code?: string }) {
    const { u, err } = await this.totpTarget(req, id);
    if (!u) return { success: false, message: err };
    if (!u.totpEnabled) return { success: false, message: '该账户未启用两步验证' };
    let secret = '';
    try {
      secret = CryptoService.decrypt(u.totpSecret || '');
    } catch {
      secret = '';
    }
    if (!secret || !verifyTotp(secret, String(body?.code || ''))) {
      return { success: false, message: '动态码错误或已过期' };
    }
    const { plain, hashes } = generateRecoveryCodes();
    await prisma.user.update({
      where: { id: u.id },
      data: { recoveryHashes: JSON.stringify(hashes), recoveryAt: new Date() },
    });
    appLog.warn('auth', `账户「${u.username}」重新生成了恢复码（旧恢复码已全部作废）`);
    return { success: true, data: { recoveryCodes: plain }, message: '新的恢复码已生成，请立即保存（仅显示这一次）' };
  }

  /**
   * 「验证器丢失」时关闭两步验证（v2.3.0；v2.6.0 起二凭据任选其一）。
   * 提交「邮箱验证码」或「一枚恢复码」任意一个即可，不再要求同时提供。
   * 本人与管理员都可操作。
   */
  @Post(':id/totp/disable-fallback')
  async totpDisableFallback(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { emailCode?: string; recoveryCode?: string },
  ) {
    const { u, err } = await this.totpTarget(req, id);
    if (!u) return { success: false, message: err };
    if (!u.totpEnabled) return { success: true, message: '该账户未启用两步验证' };
    if (!u.email || !u.emailVerified) return { success: false, message: '该账户邮箱未验证，无法使用邮箱验证码关闭' };
    const emailCode = String(body?.emailCode || '').trim();
    const recoveryCode = String(body?.recoveryCode || '').trim();
    if (!emailCode && !recoveryCode) return { success: false, message: '请提供邮箱验证码或恢复码（任一即可）' };

    let method = '';
    let recoveryHashes = u.recoveryHashes;
    if (emailCode) {
      const mailRes = this.mail.consumeAnyCode(u.email, ['disable-2fa', 'login'], emailCode);
      if (!mailRes.ok) return { success: false, message: mailRes.message };
      method = '邮箱验证码';
    } else {
      const hit = consumeRecoveryCode(u.recoveryHashes, recoveryCode);
      if (!hit) return { success: false, message: '恢复码无效或已被使用' };
      recoveryHashes = JSON.stringify(hit.rest);
      method = '恢复码';
    }

    await prisma.user.update({
      where: { id: u.id },
      data: {
        totpEnabled: false,
        totpSecret: '',
        recoveryHashes,
        backVerifiedAt: null,
      },
    });
    appLog.warn('auth', `账户「${u.username}」通过「${method}」关闭了两步验证`);
    return { success: true, message: '两步验证已关闭，请重新绑定验证器' };
  }

  /**
   * 发送「关闭两步验证」用的邮箱验证码（v2.3.0）。
   *
   * 场景：验证器丢失 → 在用户编辑页点「忘记验证器」，需要邮箱验证码 + 一枚恢复码。
   * 这里刻意与 `/email/send-code` 分开：后者用于「验证邮箱」（要求邮箱尚未验证），
   * 本接口只对「已启用 2FA 且邮箱已验证」的账户发码，用途为 disable-2fa。
   */
  @Post(':id/totp/disable-code')
  async sendDisableCode(@Req() req: Request, @Param('id') id: string) {
    const { u, err } = await this.totpTarget(req, id);
    if (!u) return { success: false, message: err };
    if (!u.totpEnabled) return { success: false, message: '该账户未启用两步验证' };
    if (!u.email || !u.emailVerified) return { success: false, message: '该账户邮箱未验证，无法通过邮箱验证码关闭' };
    if (!(await this.mail.configured())) {
      return { success: false, message: '管理员尚未配置发信邮箱（安全设置 → 邮箱配置）' };
    }
    const r = await this.mail.sendCode(u.email, 'disable-2fa', u.nickname || u.username);
    if (!r.ok) return { success: false, message: r.message };
    return { success: true, message: `验证码已发送至 ${maskEmail(u.email)}`, data: { email: maskEmail(u.email) } };
  }

  /** 关闭两步验证（需当前动态码；本机也会顺带清掉密钥） */
  @Post(':id/totp/disable')
  async totpDisable(@Req() req: Request, @Param('id') id: string, @Body() body: { code?: string }) {
    const { u, err } = await this.totpTarget(req, id);
    if (!u) return { success: false, message: err };
    if (!u.totpEnabled) return { success: true };
    let secret = '';
    try {
      secret = CryptoService.decrypt(u.totpSecret || '');
    } catch {
      secret = '';
    }
    if (secret && !verifyTotp(secret, String(body.code || ''))) {
      return { success: false, message: '验证码错误或已过期' };
    }
    await prisma.user.update({
      where: { id: u.id },
      data: { totpEnabled: false, totpSecret: '', recoveryHashes: '[]', backVerifiedAt: null },
    });
    appLog.warn('auth', `账户「${u.username}」关闭了两步验证`);
    return { success: true };
  }
}

/**
 * v2.8.8：账户级「视频兼容转码」策略归一化。
 *   inherit 跟随全局（默认）/ off 禁用 / on 启用 / user 由用户在前台自行决定
 */
function normalizeTranscodePolicy(raw: unknown): 'inherit' | 'off' | 'on' | 'user' {
  const v = String(raw ?? '').trim();
  return v === 'off' || v === 'on' || v === 'user' ? v : 'inherit';
}

/**
 * v2.8.8：账户级「单文件大小限制」（MB）。
 * 0 = 留空，按全局「单文件大小上限」执行；上限兜到 1048576MB（1TB）。
 */
function clampMaxFileSizeMB(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(1048576, Math.round(n));
}

/**
 * v3.0.0（R16）：账户自定义背景图字段归一化。
 *
 * 前端输入框格式为 JSON 数组字符串：`["https://a.jpg","https://b.jpg"]`。
 * 兼容三种写法：空串（= 跟随系统设置）、合法 JSON 数组、单个 URL（自动包成数组）。
 * 只接受 http(s) / 站内绝对路径（/ 开头），最多 20 张，单条最长 2000 字符。
 * 返回 null 表示格式不合法（调用方回错误信息）。
 */
function normalizeBkImg(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (raw === null) return '';
  const text = String(raw).trim();
  if (!text) return '';
  let arr: unknown[];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return null;
      arr = parsed;
    } catch {
      return null;
    }
  } else {
    arr = [text];
  }
  const list = arr
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .map((x) => x.slice(0, 2000))
    .filter((x) => /^https?:\/\//i.test(x) || x.startsWith('/'))
    .slice(0, 20);
  // 数组里全是不合法地址 → 视为清空（不让脏数据落库）
  return list.length ? JSON.stringify(list) : '';
}

/** 头像目录：<后端根>/uploads/avatars */
function avatarDir(): string {
  return backendSub('uploads', 'avatars');
}

/**
 * 头像访问（公开）—— 前端 logo / 用户列表都直接用它。
 * 路径固定为 uploads/avatars/<userId>.webp，按用户名反查 id；
 * 找不到文件时返回 404，前端自动回落到系统 logo。
 */
@Controller('api/avatar')
export class AvatarController {
  @Get(':username')
  async get(@Param('username') username: string, @Res() res: Response) {
    const u = await prisma.user.findUnique({ where: { username } });
    if (!u || !u.avatar) return res.status(404).end();
    try {
      const buf = await fsp.readFile(join(avatarDir(), `${u.id}.webp`));
      res.setHeader('Content-Type', 'image/webp');
      // 版本戳在 URL 上（?v=），文件本身可以长缓存
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.end(buf);
    } catch {
      return res.status(404).end();
    }
  }
}
