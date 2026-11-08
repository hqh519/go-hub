/**
 * WebDAV 渠道的增删改核心逻辑（v1.0.8）。
 * ----------------------------------------------------------------------------
 * 为什么单独抽出来：
 *   v1.0.6 这套逻辑只存在于 `webdav-admin.controller.ts`（全程 AdminGuard），
 *   导致普通用户在自己的账户页里既读不到全局开关、也读不到/建不了自己的渠道 ——
 *   前端只能把「403」当「总开关没打开」，提示就永远是那一句（用户连报两轮）。
 *   v1.0.8 新增了面向本人的 `/api/webdav-self`，同一套校验必须两边共用，
 *   否则配额、重名、一级目录冲突这些规则迟早会走形。
 *
 * 这里**不做权限判断**：调用方负责确认「这个 user 是不是当前登录者 / 管理员」。
 */

import { randomInt } from 'crypto';
import { prisma } from '../common/prisma';
import { cleanChannelPath } from './webdav.storage';

/** 统一的返回结构（与项目其它 controller 一致） */
export interface ChannelResult {
  success: boolean;
  message?: string;
  data?: any;
}

/** 16 位访问密钥：大小写字母 + 数字 */
export function makeAccessKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 16; i += 1) out += chars[randomInt(0, chars.length)];
  return out;
}

/** 某账户的渠道列表（按创建时间升序） */
export async function listChannelsOf(username: string) {
  return prisma.webDavChannel.findMany({ where: { username }, orderBy: { createdAt: 'asc' } });
}

/**
 * 新建渠道。
 * `user` 必须是普通账户（role === 'user'）—— 管理员账户禁止用 WebDAV，
 * 这一条在调用方已经筛过，这里再兜一次，避免以后新增入口时漏判。
 */
export async function createChannel(
  user: { username: string; role: string; webdavEnabled: boolean; webdavMax: number },
  body: { name?: string; path?: string; note?: string; accessKey?: string },
): Promise<ChannelResult> {
  if (user.role !== 'user') {
    return { success: false, message: '管理员账户禁止使用 WebDAV，请用普通账户创建' };
  }
  if (!user.webdavEnabled) {
    return { success: false, message: '该账户尚未开启「启用 WebDAV 功能」' };
  }

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
  const conflict = sameUser.find((c) => String(c.path || '').split('/')[0] === firstSeg);
  if (conflict) {
    return { success: false, message: `一级目录「${firstSeg}」已被 WebDAV「${conflict.name}」占用` };
  }

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
export async function updateChannel(
  channelId: string,
  body: { name?: string; note?: string },
): Promise<ChannelResult> {
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
export async function rotateChannelKey(channelId: string): Promise<ChannelResult> {
  const ch = await prisma.webDavChannel.findUnique({ where: { id: channelId } });
  if (!ch) return { success: false, message: 'WebDAV 渠道不存在' };
  const next = await prisma.webDavChannel.update({
    where: { id: ch.id },
    data: { accessKey: makeAccessKey() },
  });
  return { success: true, data: { id: next.id, accessKey: next.accessKey } };
}

/** 删除渠道（磁盘目录保留：网盘数据不该因为删一条配置就消失） */
export async function deleteChannel(channelId: string): Promise<ChannelResult> {
  const ch = await prisma.webDavChannel.findUnique({ where: { id: channelId } });
  if (!ch) return { success: false, message: 'WebDAV 渠道不存在' };
  await prisma.webDavChannel.delete({ where: { id: ch.id } });
  return { success: true, data: { id: ch.id } };
}
