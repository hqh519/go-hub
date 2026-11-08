/**
 * 渠道可见性 / 用户授权（v202610221824）。
 *
 * 规则（需求约定）：
 *   - 管理员：全部渠道可见可用；
 *   - 普通用户：一律按渠道「用户授权」名单判定 —— 本地存储渠道自 v2.7.0 起与
 *     其它渠道完全同规则（名单为空 = 普通用户不可见，不再有「恒可用」兜底）；
 *   - 匿名上传兜底不受影响（存储候选只限制 role=user 的普通用户）。
 *
 * v1.0.6 新增「自动授权所有用户」：名单里出现哨兵 `*` 即视为对全体开放，
 * 包括**之后**新建的账户（新用户无需再逐条勾选）。
 * 用哨兵而不是给 Channel 加布尔字段，是为了让所有既有调用点（存储渠道选择、
 * 本地文件列表、上传设置…）**不改签名就自动生效** —— 它们都只是问
 * 「这个渠道对这个人可见吗」，可见性判定收在这一个函数里就够了。
 *
 * 放在 common 层是为了让 channels.controller 与 storage-channel.service 共用，
 * 避免两者互相 import 造成循环依赖。
 */

/** 授权名单里的「所有用户」哨兵 */
export const AUTH_ALL = '*';

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

/** 该渠道是否开了「自动授权所有用户」 */
export function channelAuthAll(raw: string | undefined | null): boolean {
  return parseAuthorizedUsers(raw).includes(AUTH_ALL);
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
  const list = parseAuthorizedUsers(raw);
  // v1.0.6：「自动授权所有用户」
  if (list.includes(AUTH_ALL)) return true;
  return list.includes(username);
}
