import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { prisma } from '../common/prisma';
import { appLog } from '../common/app-log';

/**
 * 实例（多实例方案 v3.0.0）服务层。
 *
 * 归属模型：
 *   · Instance.ownerId = 创建者的 users.id（内建管理员不在 users 表 → 固定 'admin'）；
 *   · 成员关系存 Instance.metas JSON 的 members 数组（用户名字符串，创建者自动进 members）；
 *   · 文件 / 标签按 FileRecord.instanceId / Tag.instanceId 隔离，空串 = 默认实例。
 */

/** 邀请码字符集：大小写字母 + 数字 */
const INVITE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 邀请码长度（8 位） */
const INVITE_CODE_LEN = 8;

/**
 * 读取 Instance.metas 里的成员数组（members 存用户名字符串）。
 * metas 损坏 / 字段缺失时返回空数组，绝不让读取动作抛异常。
 */
export function readInstanceMembers(metas: string): string[] {
  try {
    const parsed = JSON.parse(metas || '{}');
    const members = parsed?.members;
    if (!Array.isArray(members)) return [];
    return Array.from(new Set(members.map((m) => String(m || '').trim()).filter(Boolean)));
  } catch {
    return [];
  }
}

/** 生成 8 位邀请码（大小写字母 + 数字，crypto 随机） */
function makeInviteCode(): string {
  const buf = randomBytes(INVITE_CODE_LEN);
  let code = '';
  for (let i = 0; i < INVITE_CODE_LEN; i += 1) code += INVITE_CHARS[buf[i] % INVITE_CHARS.length];
  return code;
}

/** 实例对外序列化结构（GET 列表 / join 返回体） */
export interface InstanceItem {
  id: string;
  name: string;
  /** 备注仅创建者可见：非创建者恒返回空串 */
  note: string;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  isOwner: boolean;
  memberCount: number;
}

/** Prisma 唯一约束冲突（P2002） */
function isUniqueConflict(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}

@Injectable()
export class InstancesService {
  /**
   * 登录用户名 → 实例创建者 ID（users 表主键）。
   * 内建管理员不在 users 表中 → 固定返回 'admin'；
   * 极端情况（users 表非空却查不到该用户名）→ 返回用户名本身（不会匹配任何实例，防止越权命中）。
   */
  async ownerIdOf(username: string): Promise<string> {
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

  /** 实例对象 → 对外结构（按查看者视角决定 note 可见性与 isOwner） */
  private serialize(
    inst: { id: string; name: string; note: string; ownerId: string; ownerName: string; createdAt: Date; metas: string },
    viewerOwnerId: string,
  ): InstanceItem {
    const members = readInstanceMembers(inst.metas);
    const isOwner = inst.ownerId === viewerOwnerId;
    return {
      id: inst.id,
      name: inst.name,
      note: isOwner ? inst.note : '',
      ownerId: inst.ownerId,
      ownerName: inst.ownerName,
      createdAt: inst.createdAt.toISOString(),
      isOwner,
      memberCount: members.length,
    };
  }

  /** 当前用户相关的实例：自己创建的（isOwner=true）+ 被拉入的（isOwner=false），按 createdAt 升序 */
  async list(username: string): Promise<InstanceItem[]> {
    if (!String(username || '').trim()) return [];
    const myId = await this.ownerIdOf(username);
    // 先按 ownerId 精确取自己创建的；成员匹配用 metas 字符串包含（成员名带引号包在 JSON 里）做粗筛，
    // 再在应用层用 members 数组精确复核，避免误命中（如用户名是另一个用户名的子串）。
    const [mine, roughJoined] = await Promise.all([
      prisma.instance.findMany({ where: { ownerId: myId } }),
      prisma.instance.findMany({
        where: { ownerId: { not: myId }, metas: { contains: `"${username}"` } },
      }),
    ]);
    const joined = roughJoined.filter((inst) => readInstanceMembers(inst.metas).includes(username));
    return [...mine, ...joined]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((inst) => this.serialize(inst, myId));
  }

  /** 创建实例：同一创建者下 name 不可重复；创建者自动进 members */
  async create(username: string, rawName: string, note: string): Promise<{ item?: InstanceItem; error?: string }> {
    const name = String(rawName || '').trim().slice(0, 100);
    if (!name) return { error: '请填写实例名称' };
    const myId = await this.ownerIdOf(username);
    try {
      const inst = await prisma.instance.create({
        data: {
          ownerId: myId,
          ownerName: username,
          name,
          note: String(note || '').slice(0, 2000),
          metas: JSON.stringify({ members: [username] }),
        },
      });
      appLog.info('instance', `创建实例「${name}」成功`, `owner=${username}`, '');
      return { item: this.serialize(inst, myId) };
    } catch (err) {
      if (isUniqueConflict(err)) return { error: '同名实例已存在，请换一个名称' };
      appLog.warn('instance', `创建实例「${name}」失败`, (err as Error)?.message || String(err), '');
      return { error: '创建实例失败，请稍后重试' };
    }
  }

  /** 修改实例（名称 / 备注）—— 仅创建者 */
  async update(
    id: string,
    username: string,
    patch: { name?: string; note?: string },
  ): Promise<{ item?: InstanceItem; error?: string }> {
    const inst = await prisma.instance.findUnique({ where: { id } });
    if (!inst) return { error: '实例不存在' };
    const myId = await this.ownerIdOf(username);
    if (inst.ownerId !== myId) return { error: '仅创建者可修改实例' };
    const data: { name?: string; note?: string } = {};
    if (patch.name !== undefined) {
      const name = String(patch.name || '').trim().slice(0, 100);
      if (!name) return { error: '实例名称不能为空' };
      if (name !== inst.name) data.name = name;
    }
    if (patch.note !== undefined) data.note = String(patch.note || '').slice(0, 2000);
    try {
      const updated = await prisma.instance.update({ where: { id }, data });
      return { item: this.serialize(updated, myId) };
    } catch (err) {
      if (isUniqueConflict(err)) return { error: '同名实例已存在，请换一个名称' };
      return { error: '修改实例失败，请稍后重试' };
    }
  }

  /**
   * 删除实例 —— 仅创建者。
   * 前置检查：实例下存在任何 FileRecord（含回收站 status=deleted）→ 400 拒绝；
   * 允许删除时先删该实例的标签（file_tags 关联由级联处理），再删实例行。
   */
  async remove(id: string, username: string): Promise<{ error?: string }> {
    const inst = await prisma.instance.findUnique({ where: { id } });
    if (!inst) return { error: '实例不存在' };
    const myId = await this.ownerIdOf(username);
    if (inst.ownerId !== myId) return { error: '仅创建者可删除实例' };
    const fileCount = await prisma.fileRecord.count({ where: { instanceId: id } });
    if (fileCount > 0) {
      return { error: '实例下仍有文件（含回收站），无法删除' };
    }
    await prisma.$transaction([
      prisma.tag.deleteMany({ where: { instanceId: id } }),
      prisma.instance.delete({ where: { id } }),
    ]);
    appLog.info('instance', `删除实例「${inst.name}」成功`, `owner=${username}`, '');
    return {};
  }

  /** 生成（或更新）邀请码 —— 仅创建者 */
  async createInvite(id: string, username: string): Promise<{ inviteCode?: string; error?: string }> {
    const inst = await prisma.instance.findUnique({ where: { id } });
    if (!inst) return { error: '实例不存在' };
    const myId = await this.ownerIdOf(username);
    if (inst.ownerId !== myId) return { error: '仅创建者可生成邀请码' };
    /*
     * v3.0.0：邀请码必须全站唯一（老版本只重试 3 次，撞码后两个实例共用一枚码，
     * 加入时会随机进到别人的实例里）。这里改为循环重试最多 20 次，
     * 并把「自己的旧码」排除在冲突判断外；20 次仍撞码则直接报错，绝不写入重复值。
     */
    let code = makeInviteCode();
    let unique = false;
    for (let i = 0; i < 20; i += 1) {
      const exists = await prisma.instance.findFirst({
        where: { inviteCode: code, NOT: { id } },
        select: { id: true },
      });
      if (!exists) {
        unique = true;
        break;
      }
      appLog.warn('instance', `邀请码碰撞，重新生成（第 ${i + 1} 次）`, `code=${code}`);
      code = makeInviteCode();
    }
    if (!unique) {
      appLog.error('instance', '生成邀请码失败：连续 20 次与已有邀请码重复', `实例=${inst.name}`);
      return { error: '生成邀请码失败，请重试' };
    }
    await prisma.instance.update({ where: { id }, data: { inviteCode: code } });
    appLog.info('instance', `实例「${inst.name}」生成新邀请码`, `code=${code}`);
    return { inviteCode: code };
  }

  /**
   * 读取当前邀请码（**不生成**）—— 仅创建者。v3.0.0（第三轮）：
   * 邀请弹窗打开时只回显已有邀请码，没生成过就返回空串。
   */
  async getInvite(id: string, username: string): Promise<{ inviteCode?: string; error?: string }> {
    const inst = await prisma.instance.findUnique({ where: { id } });
    if (!inst) return { error: '实例不存在' };
    const myId = await this.ownerIdOf(username);
    if (inst.ownerId !== myId) return { error: '仅创建者可查看邀请码' };
    return { inviteCode: inst.inviteCode || '' };
  }

  /** 关闭邀请（inviteCode 置空）—— 仅创建者 */
  async closeInvite(id: string, username: string): Promise<{ error?: string }> {
    const inst = await prisma.instance.findUnique({ where: { id } });
    if (!inst) return { error: '实例不存在' };
    const myId = await this.ownerIdOf(username);
    if (inst.ownerId !== myId) return { error: '仅创建者可关闭邀请' };
    await prisma.instance.update({ where: { id }, data: { inviteCode: '' } });
    return {};
  }

  /**
   * 按「用户名 + 邀请码」加入实例（v3.0.0 双验证）：
   *   ① 用户名必填，且必须真实存在、处于启用状态；
   *   ② 用户名必须与当前登录账户一致 —— 防止拿到别人的邀请码就替他人入伙；
   *   ③ 邀请码必须有效（全站唯一，见 createInvite）。
   * 已加入幂等成功；任一校验失败返回 error。
   */
  async join(
    sessionUser: string,
    inputUsername: string,
    rawCode: string,
  ): Promise<{ item?: InstanceItem; error?: string }> {
    const name = String(inputUsername || '').trim();
    const code = String(rawCode || '').trim();
    if (!name) return { error: '请填写用户名' };
    if (!code) return { error: '请填写邀请码' };
    const user = await prisma.user.findUnique({
      where: { username: name },
      select: { username: true, enabled: true },
    });
    if (!user) {
      appLog.warn('instance', `加入实例失败：用户名不存在（${name}）`, `sessionUser=${sessionUser}`);
      return { error: '用户名不存在' };
    }
    if (!user.enabled) return { error: '该账户已被禁用，无法加入实例' };
    if (String(sessionUser || '') !== user.username) {
      appLog.warn('instance', '加入实例失败：用户名与当前登录账户不一致', `输入=${name} ｜ 会话=${sessionUser}`);
      return { error: '用户名与当前登录账户不一致' };
    }
    const username = user.username;
    const inst = await prisma.instance.findFirst({ where: { inviteCode: code } });
    if (!inst) return { error: '邀请码无效' };
    const members = readInstanceMembers(inst.metas);
    if (!members.includes(username)) {
      members.push(username);
      let metas: Record<string, unknown> = {};
      try {
        metas = JSON.parse(inst.metas || '{}');
      } catch {
        metas = {};
      }
      metas.members = members;
      await prisma.instance.update({ where: { id: inst.id }, data: { metas: JSON.stringify(metas) } });
      appLog.info('instance', `用户 ${username} 加入实例「${inst.name}」`, '', '');
    }
    const myId = await this.ownerIdOf(username);
    return { item: this.serialize({ ...inst, metas: JSON.stringify({ members }) }, myId) };
  }

  /** 成员列表 —— 仅创建者 */
  async members(id: string, username: string): Promise<{ list?: { username: string }[]; error?: string }> {
    const inst = await prisma.instance.findUnique({ where: { id } });
    if (!inst) return { error: '实例不存在' };
    const myId = await this.ownerIdOf(username);
    if (inst.ownerId !== myId) return { error: '仅创建者可查看成员列表' };
    return { list: readInstanceMembers(inst.metas).map((username) => ({ username })) };
  }

  /** 移除成员 —— 仅创建者；创建者自己不可移除 */
  async removeMember(id: string, username: string, target: string): Promise<{ error?: string }> {
    const inst = await prisma.instance.findUnique({ where: { id } });
    if (!inst) return { error: '实例不存在' };
    const myId = await this.ownerIdOf(username);
    if (inst.ownerId !== myId) return { error: '仅创建者可移除成员' };
    const targetName = String(target || '').trim();
    if (!targetName) return { error: '请指定要移除的成员' };
    if (targetName === inst.ownerName) return { error: '创建者不可被移除' };
    const members = readInstanceMembers(inst.metas);
    const next = members.filter((m) => m !== targetName);
    if (next.length === members.length) return { error: '该用户不是实例成员' };
    let metas: Record<string, unknown> = {};
    try {
      metas = JSON.parse(inst.metas || '{}');
    } catch {
      metas = {};
    }
    metas.members = next;
    await prisma.instance.update({ where: { id }, data: { metas: JSON.stringify(metas) } });
    appLog.info('instance', `创建者 ${username} 将 ${targetName} 移出实例「${inst.name}」`, '', '');
    return {};
  }
}
