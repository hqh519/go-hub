/**
 * WebDAV 渠道管理接口（v1.0.6，v1.0.8 重构为调用共享逻辑）。
 *
 * 面向「用户管理 → 编辑账户 → WebDAV 管理」模块，**全部要求管理员权限**。
 * （普通用户管理自己的渠道走 `/api/webdav-self`，见 webdav-self.controller.ts）
 *
 *   GET    /api/manage/users/:id/webdav       列出该账户的 WebDAV 渠道 + 配额
 *   POST   /api/manage/users/:id/webdav       新建渠道（名称 / 存储路径 / 备注，密钥自动生成）
 *   PATCH  /api/manage/webdav/:channelId      改名称 / 备注（改名称可，改路径不可）
 *   POST   /api/manage/webdav/:channelId/key  重新生成访问密钥（旧密钥立刻失效）
 *   DELETE /api/manage/webdav/:channelId      删除渠道
 *
 * 注意：这里**只增删渠道本身**，不碰文件。
 * 删除渠道时磁盘目录保留（网盘数据不该因为删一条配置就消失），
 * 需要的话管理员可以自行清理 webdav/{用户名}/{路径}。
 */
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { prisma } from '../common/prisma';
import { AdminGuard } from '../auth/auth.guard';
import { webdavRoot } from './webdav.storage';
import {
  createChannel,
  deleteChannel,
  listChannelsOf,
  rotateChannelKey,
  updateChannel,
} from './channel-service';

@Controller('api/manage')
@UseGuards(AdminGuard)
export class WebDavAdminController {
  /** 列出某账户的 WebDAV 渠道 */
  @Get('users/:id/webdav')
  async list(@Param('id') id: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return { success: false, message: '账户不存在' };
    const list = await listChannelsOf(user.username);
    return {
      success: true,
      data: {
        /** 管理员是否给这个账户开了 WebDAV（页面上那个开关） */
        enabled: user.webdavEnabled,
        /** 允许创建的数量上限 */
        max: user.webdavMax,
        /** 存储根（容器内路径），页面上展示给管理员看 */
        root: webdavRoot(),
        /**
         * 管理员账户不允许使用 WebDAV —— 前端据此隐藏整个模块并给出说明，
         * 后端 authenticate 里也会独立拦一遍。
         */
        adminBlocked: user.role !== 'user',
        channels: list.map((c) => ({
          id: c.id,
          name: c.name,
          path: c.path,
          accessKey: c.accessKey,
          note: c.note,
          createdAt: c.createdAt,
          /** 完整的挂载地址提示（不含协议与域名，前端自己拼） */
          mountPath: `/dav`,
        })),
      },
    };
  }

  /** 新建渠道 */
  @Post('users/:id/webdav')
  async create(
    @Param('id') id: string,
    @Body() body: { name?: string; path?: string; note?: string; accessKey?: string },
  ) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return { success: false, message: '账户不存在' };
    return createChannel(
      {
        username: user.username,
        role: user.role,
        webdavEnabled: user.webdavEnabled,
        webdavMax: user.webdavMax,
      },
      body,
    );
  }

  /** 改名称 / 备注（存储路径不可改） */
  @Patch('webdav/:channelId')
  async update(@Param('channelId') channelId: string, @Body() body: { name?: string; note?: string }) {
    return updateChannel(channelId, body);
  }

  /** 重新生成访问密钥（旧密钥立即失效） */
  @Post('webdav/:channelId/key')
  async rotateKey(@Param('channelId') channelId: string) {
    return rotateChannelKey(channelId);
  }

  /** 删除渠道（磁盘目录保留） */
  @Delete('webdav/:channelId')
  async remove(@Param('channelId') channelId: string) {
    return deleteChannel(channelId);
  }
}
