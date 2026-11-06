/**
 * 渠道可见性 / 用户授权（v202610221824）。
 *
 * 规则（需求约定）：
 *   - 管理员：全部渠道可见可用；
 *   - 普通用户：一律按渠道「用户授权」名单判定 —— 本地存储渠道自 v2.7.0 起与
 *     其它渠道完全同规则（名单为空 = 普通用户不可见，不再有「恒可用」兜底）；
 *   - 匿名上传兜底不受影响（存储候选只限制 role=user 的普通用户）。
 *
 * 放在 common 层是为了让 channels.controller 与 storage-channel.service 共用，
 * 避免两者互相 import 造成循环依赖。
 */

/** 解析渠道的授权用户列表（容错：脏数据按空数组处理） */
export function parseAuthorizedUsers(raw: string | undefined | null): string[] {
  try {
    const arr = JSON.parse(raw || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** 该渠道对某账户是否可见 / 可用 */
export function channelVisibleTo(
  raw: string | undefined | null,
  type: string,
  username: string,
  admin: boolean,
): boolean {
  if (admin) return true;
  if (!username) return false;
  // v2.7.0：本地存储渠道与其它渠道完全同规则 —— 只有授权名单里的普通用户可见可用
  // （原「local 空名单恒可用」兜底按需求取消，普通用户编辑页/上传设置不再显示未授权的本地存储）
  return parseAuthorizedUsers(raw).includes(username);
}
