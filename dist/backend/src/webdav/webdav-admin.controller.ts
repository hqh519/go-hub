/**
 * WebDAV 渠道管理接口（v1.0.6）。
 *
 * 面向「用户管理 → 编辑账户 → WebDAV 管理」模块，全部要求管理员权限。
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
import { randomInt } from 'crypto';
import { prisma } from '../common/prisma';
import { AdminGuard } from '../auth/auth.guard';
import { cleanChannelPath } from './webdav.storage';
import { webdavRoot } from './webdav.storage';

/** 16 位访问密钥：大小写字母 + 数字 */
function makeAccessKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 16; i += 1) out += chars[randomInt(0, chars.length)];
  return out;
}

@Controller('api/manage')
@UseGuards(AdminGuard)
export class WebDavAdminController {
  /** 列出某账户的 WebDAV 渠道 */
  @Get('users/:id/webdav')
  async list(@Param('id') id: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return { success: false, message: '账户不存在' };
    const list = await prisma.webDavChannel.findMany({
      where: { username: user.username },
      orderBy: { createdAt: 'asc' },
    });
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
    if (user.role !== 'user') return { success: false, message: '管理员账户禁止使用 WebDAV，请用普通账户创建' };
    if (!user.webdavEnabled) return { success: false, message: '该账户尚未开启「启用 WebDAV 功能」' };

    const name = String(body.name || '').trim();
    const relPath = cleanChannelPath(String(body.path || ''));
    if (!name) return { success: false, message: '请填写 WebDAV 名称' };
    if (!relPath) return { success: false, message: '请填写存储路径' };

    /*
     * 访问密钥：页面会先给一个自动生成的 16 位串，用户也可以自己改。
     * 这里只做「字符集 + 长度」校验，不强制必须是 16 位（有人喜欢更长的口令）。
     */
    const wanted = String(body.accessKey || '').trim();
    let accessKey = makeAccessKey();
    if (wanted) {
      if (!/^[A-Za-z0-9]{8,64}$/.test(wanted)) {
        return { success: false, message: '访问密钥只能是 8~64 位大小写字母或数字' };
      }
      const dupKey = await prisma.webDavChannel.findFirst({ where: { accessKey: wanted } });
      if (dupKey) return { success: false, message: '该访问密钥已被占用，请点「重新生成」换一个' };
      accessKey = wanted;
    }

    const count = await prisma.webDavChannel.count({ where: { username: user.username } });
    if (count >= Math.max(1, user.webdavMax || 2)) {
      return { success: false, message: `最多只能创建 ${user.webdavMax || 2} 个 WebDAV 渠道` };
    }

    // 同一账户下：名称不可重复、一级目录不可重复
    const dupName = await prisma.webDavChannel.findFirst({ where: { username: user.username, name } });
    if (dupName) return { success: false, message: `名称「${name}」已被该账户的另一个 WebDAV 使用` };

    const firstSeg = relPath.split('/')[0];
    const sameUser = await prisma.webDavChannel.findMany({ where: { username: user.username } });
    /*
     * 需求：一级目录在同一用户下不能重复。
     * 不只是完全相同 —— `/文件` 和 `/文件/工作` 也算冲突：
     * 两个渠道指向同一棵目录树，客户端挂两个盘会看到同一批文件，容易误删。
     */
    const conflict = sameUser.find((c) => {
      const seg = String(c.path || '').split('/')[0];
      return seg === firstSeg;
    });
    if (conflict) return { success: false, message: `一级目录「${firstSeg}」已被 WebDAV「${conflict.name}」占用` };

    const ch = await prisma.webDavChannel.create({
      data: {
        username: user.username,
        name,
        path: relPath,
        accessKey,
        note: String(body.note || ''),
      },
    });
    return { success: true, data: ch };
  }

  /**
   * 改名称 / 备注。
   * 存储路径**不接受修改** —— 路径一改，已有文件就全成了孤儿（还在旧目录里，但没人指向它）。
   */
  @Patch('webdav/:channelId')
  async update(@Param('channelId') channelId: string, @Body() body: { name?: string; note?: string }) {
    const ch = await prisma.webDavChannel.findUnique({ where: { id: channelId } });
    if (!ch) return { success: false, message: 'WebDAV 渠道不存在' };
    const data: { name?: string; note?: string } = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return { success: false, message: '名称不能为空' };
      if (name !== ch.name) {
        const dup = await prisma.webDavChannel.findFirst({
          where: { username: ch.username, name, NOT: { id: ch.id } },
        });
        if (dup) return { success: false, message: `名称「${name}」已被占用` };
      }
      data.name = name;
    }
    if (body.note !== undefined) data.note = String(body.note || '');
    const next = await prisma.webDavChannel.update({ where: { id: ch.id }, data });
    return { success: true, data: next };
  }

  /** 重新生成访问密钥（旧密钥立即失效） */
  @Post('webdav/:channelId/key')
  async rotateKey(@Param('channelId') channelId: string) {
    const ch = await prisma.webDavChannel.findUnique({ where: { id: channelId } });
    if (!ch) return { success: false, message: 'WebDAV 渠道不存在' };
    const next = await prisma.webDavChannel.update({
      where: { id: ch.id },
      data: { accessKey: makeAccessKey() },
    });
    return { success: true, data: { id: next.id, accessKey: next.accessKey } };
  }

  /** 删除渠道（磁盘目录保留） */
  @Delete('webdav/:channelId')
  async remove(@Param('channelId') channelId: string) {
    const ch = await prisma.webDavChannel.findUnique({ where: { id: channelId } });
    if (!ch) return { success: false, message: 'WebDAV 渠道不存在' };
    await prisma.webDavChannel.delete({ where: { id: ch.id } });
    return { success: true, data: { id: ch.id } };
  }
}
