/**
 * 「我的 WebDAV」自助接口（v1.0.8）。
 * ----------------------------------------------------------------------------
 * 背景（用户连报两轮的问题）：
 *   普通用户在自己的账户编辑页里，前端读的是 `/api/manage/sysConfig/others` 与
 *   `/api/manage/users/:id/webdav`，这两个接口都由 AdminGuard 保护 —— 普通用户一律 403。
 *   前端把 403 归到 catch 分支，于是 `webdavGlobalEnabled = false`，
 *   页面就永远提示「系统管理 → 安全设置里的『对外 WebDAV』总开关还没打开」，
 *   而管理员进同一个页面却是正常的（他有权限），所以两边表现不一致。
 *
 * 这里补一组「本人可用」的接口，只暴露该账户自己的渠道与一个全局开关布尔值，
 * 不泄露任何其它系统配置：
 *
 *   GET    /api/webdav-self                 总开关 + 我的授权 + 我的渠道列表
 *   POST   /api/webdav-self                 新建渠道
 *   PATCH  /api/webdav-self/:channelId      改名称 / 备注
 *   POST   /api/webdav-self/:channelId/key  重新生成访问密钥
 *   DELETE /api/webdav-self/:channelId      删除渠道
 *
 * 所有写操作都先确认「该渠道属于当前登录账户」，管理员账户仍然禁止使用 WebDAV。
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { prisma } from '../common/prisma';
import { currentSession, isAdminRole } from '../auth/auth.guard';
import { SysConfigService } from '../settings/sysconfig.service';
import { webdavRoot } from './webdav.storage';
import {
  createChannel,
  deleteChannel,
  listChannelsOf,
  rotateChannelKey,
  updateChannel,
} from './channel-service';

@Controller('api/webdav-self')
export class WebDavSelfController {
  constructor(private readonly sysConfig: SysConfigService) {}

  /** 当前登录用户名；未登录直接 401（前端据此区分「未登录」与「没权限」） */
  private me(req: Request): { user: string; role: string } {
    const s = currentSession(req);
    if (!s?.user) throw new UnauthorizedException('未登录');
    return { user: s.user, role: String(s.role || '') };
  }

  /**
   * 对外 WebDAV 总开关（系统管理 → 安全设置）。
   * 配置存在 sysConfig 的 **others** 分区：`{ webdav: { enabled } }`。
   * 与 localfiles.controller 的 webdavOn() 保持同一判定（布尔与字符串两种存法都认）。
   */
  private async globalOn(): Promise<boolean> {
    try {
      const cfg: any = await this.sysConfig.get('others');
      const w = cfg?.webdav || {};
      return w.enabled === true || String(w.enabled) === 'true';
    } catch {
      return false;
    }
  }

  /** 取当前账户名下的一条渠道（不属于自己就当作不存在，避免探测别人的 id） */
  private async ownChannel(channelId: string, username: string) {
    const ch = await prisma.webDavChannel.findUnique({ where: { id: channelId } });
    if (!ch || ch.username !== username) return null;
    return ch;
  }

  /** 总开关 + 我的授权 + 我的渠道 */
  @Get()
  async overview(@Req() req: Request) {
    const { user, role } = this.me(req);
    const globalEnabled = await this.globalOn();
    const account = await prisma.user.findUnique({ where: { username: user } });
    /*
     * 老库升级上来的内建管理员不在 users 表里（用户名来自环境变量 / adminProfile），
     * 这里必须当成「管理员账户」处理 —— 返回 adminBlocked，而不是 401，
     * 否则前端会把它当成「未登录 / 没权限」，整块 WebDAV 又变成不显示。
     */
    if (!account) {
      if (isAdminRole(role)) {
        return {
          success: true,
          data: {
            globalEnabled,
            enabled: false,
            max: 0,
            adminBlocked: true,
            root: webdavRoot(),
            channels: [],
          },
        };
      }
      throw new UnauthorizedException('账户不存在');
    }
    const adminBlocked = isAdminRole(account.role);
    const channels = adminBlocked ? [] : await listChannelsOf(account.username);
    return {
      success: true,
      data: {
        /** 「对外 WebDAV」总开关 —— 普通用户也能读，只这一个布尔值 */
        globalEnabled,
        /** 管理员是否给该账户开了 WebDAV */
        enabled: !!account.webdavEnabled,
        /** 允许创建的数量上限 */
        max: Number(account.webdavMax) || 2,
        /** 管理员账户禁止使用 WebDAV */
        adminBlocked,
        /** 存储根（容器内路径），仅用于页面展示 */
        root: webdavRoot(),
        channels: channels.map((c) => ({
          id: c.id,
          name: c.name,
          path: c.path,
          accessKey: c.accessKey,
          note: c.note,
          createdAt: c.createdAt,
          mountPath: '/dav',
        })),
      },
    };
  }

  /** 新建我自己的渠道 */
  @Post()
  async create(
    @Req() req: Request,
    @Body() body: { name?: string; path?: string; note?: string; accessKey?: string },
  ) {
    const { user } = this.me(req);
    if (!(await this.globalOn())) {
      return { success: false, message: '对外 WebDAV 已停用（系统管理 → 安全设置）' };
    }
    const account = await prisma.user.findUnique({ where: { username: user } });
    if (!account) {
      return { success: false, message: '管理员账户禁止使用 WebDAV，请用普通账户创建' };
    }
    return createChannel(
      {
        username: account.username,
        role: account.role,
        webdavEnabled: account.webdavEnabled,
        webdavMax: account.webdavMax,
      },
      body,
    );
  }

  /** 改我自己渠道的名称 / 备注 */
  @Patch(':channelId')
  async update(@Req() req: Request, @Param('channelId') channelId: string, @Body() body: { name?: string; note?: string }) {
    const { user } = this.me(req);
    const ch = await this.ownChannel(channelId, user);
    if (!ch) return { success: false, message: 'WebDAV 渠道不存在' };
    return updateChannel(ch.id, body);
  }

  /** 重新生成我自己的访问密钥 */
  @Post(':channelId/key')
  async rotateKey(@Req() req: Request, @Param('channelId') channelId: string) {
    const { user } = this.me(req);
    const ch = await this.ownChannel(channelId, user);
    if (!ch) return { success: false, message: 'WebDAV 渠道不存在' };
    return rotateChannelKey(ch.id);
  }

  /** 删除我自己的渠道（磁盘目录保留） */
  @Delete(':channelId')
  async remove(@Req() req: Request, @Param('channelId') channelId: string) {
    const { user } = this.me(req);
    const ch = await this.ownChannel(channelId, user);
    if (!ch) return { success: false, message: 'WebDAV 渠道不存在' };
    return deleteChannel(ch.id);
  }
}
