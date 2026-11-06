import { prisma } from './prisma';

/**
 * 实例归属判定（v1.0.1 抽出，供多个控制器共用）。
 *
 * 归属模型与 instances 模块保持一致：
 *   · 空串 = 默认实例 —— 每个登录账户自己的初始空间，恒放行；
 *   · 非空实例 —— 创建者本人或 metas.members 里的成员放行；
 *   · 管理员在调用方先行放行（这里只做「这个人是否属于这个实例」的判断）。
 *
 * 抽出来的原因：`canAccessInstance` 原本只存在于标签控制器，
 * 而「跨实例移动文件」在管理控制器里也需要同一套判定，复制一份必然漂移。
 */
export async function userInInstance(user: string, instanceId: string): Promise<boolean> {
  const id = String(instanceId || '');
  if (!id) return true;
  const me = String(user || '');
  if (!me) return false;
  const inst = await prisma.instance.findUnique({ where: { id } });
  if (!inst) return false;
  if (inst.ownerName === me) return true;
  try {
    const members = JSON.parse(inst.metas || '{}')?.members;
    return Array.isArray(members) && members.map((m: unknown) => String(m)).includes(me);
  } catch {
    return false;
  }
}
