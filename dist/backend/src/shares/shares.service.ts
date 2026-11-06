/**
 * 对外分享服务 —— v3.0.0
 *
 * 一条 ShareLink = 一个对外可访问的地址，来源只有两种：
 *   · type=cate → 文件夹属性里的「目录对外分享」，target = 目录路径（如 "2026/10"，空串 = 根目录）；
 *   · type=tag  → 标签属性里的「标签对外分享」，target = 标签名。
 *
 * 对外地址：/browse/<用户名>/<实例序号>/cate/<目录路径> 与 /browse/<用户名>/<实例序号>/tag/<标签名>。
 * 实例序号：0 = 默认实例（FileRecord.instanceId 空串）；>=1 = 该用户按 createdAt 升序的第 n 个 Instance。
 *
 * 本文件只做「数据 + 判定」，URL 拼接、Cookie 下发都在这里给出结果，由 controller 落成 HTTP 响应。
 * 依赖：prisma 单例 + 纯函数（folder-meta 的路径/哈希工具、file-view 的序列化）。
 */

import { Injectable } from '@nestjs/common';
import { Prisma, ShareLink } from '@prisma/client';
import { prisma } from '../common/prisma';
import { appLog } from '../common/app-log';
import { fileTypeOf, safeParse, serializeFile } from '../common/file-view';
import { normalizeFolderPath, parseGalleryDirs, sha256Hex } from '../files/folder-meta.service';
import { readInstanceMembers } from '../instances/instances.service';

/** 分享密码验证通过后种下的 Cookie：值 = 该分享的 passwordHash（sha256 十六进制） */
export const SHARE_PW_COOKIE = 'gohub_share_pw';

/** Cookie 有效期（秒）：7 天 */
const SHARE_PW_MAX_AGE = 7 * 24 * 3600;

/** 分享类型 */
export type ShareType = 'cate' | 'tag';

/** 操作者视角（controller 从会话里取） */
export interface ShareActor {
  user: string;
  isAdmin: boolean;
}

/** 管理端列表查询参数（均为字符串，来自 query） */
export interface ShareListQuery {
  username?: string;
  instanceId?: string;
  type?: string;
  keyword?: string;
  page?: string;
  pageSize?: string;
}

/** 新建 / 更新（upsert）入参 */
export interface ShareUpsertBody {
  type?: string;
  target?: string;
  tagId?: string;
  instanceId?: string;
  enabled?: boolean | string;
  password?: string;
  expireAt?: string | null;
  note?: string;
  /** 管理员可代指定用户操作 */
  username?: string;
}

/** 公开接口查询参数 */
export interface SharePublicQuery {
  user?: string;
  idx?: string;
  kind?: string;
  path?: string;
  tag?: string;
  pw?: string;
  page?: string;
  pageSize?: string;
  /** 兼容 PublicBrowse.vue 的 start / count / dir 写法 */
  start?: string;
  count?: string;
  dir?: string;
  search?: string;
  type?: string;
}
/** 管理端列表项（对外形状） */
export interface ShareItem {
  id: string;
  owner: string;
  instanceId: string;
  instanceIndex: number;
  instanceName: string;
  type: string;
  target: string;
  url: string;
  enabled: boolean;
  expired: boolean;
  encrypted: boolean;
  expireAt: string | null;
  note: string;
  createdAt: string;
}

/** 公开访问判定结果 */
export interface ShareAccessResult {
  success: boolean;
  ok: boolean;
  name?: string;
  owner?: string;
  instanceId?: string;
  kind?: string;
  count?: number;
  needPassword?: boolean;
  error?: string;
  /** 需要由 controller 种 Cookie 的哈希（密码验证成功时才出现） */
  setPwHash?: string;
}

/** 公开列表结果（结构与 files.controller 的 GET /api/public/list 对齐） */
export interface SharePublicListResult {
  success: boolean;
  ok: boolean;
  needPassword?: boolean;
  error?: string;
  setPwHash?: string;
  files: unknown[];
  directories: string[];
  totalCount: number;
  returnedCount: number;
  allowedDirs: string[];
  fromCache: boolean;
}

/** 密码失败日志限频：同分享 + 同 IP 一分钟只记一条（防刷屏） */
const pwLogThrottle = new Map<string, number>();

function shouldLogPwFailure(key: string): boolean {
  const now = Date.now();
  const last = pwLogThrottle.get(key) || 0;
  if (now - last < 60_000) return false;
  pwLogThrottle.set(key, now);
  if (pwLogThrottle.size > 500) {
    for (const [k, t] of pwLogThrottle) if (now - t > 60_000) pwLogThrottle.delete(k);
  }
  return true;
}

/** 布尔归一化（兼容 'true' / 'false' 字符串） */
function toBool(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  const t = String(v).trim().toLowerCase();
  if (t === 'true' || t === '1' || t === 'on' || t === 'yes') return true;
  if (t === 'false' || t === '0' || t === 'off' || t === 'no') return false;
  return fallback;
}

/**
 * 到期时间解析（三态）：
 *   undefined → 不修改（upsert 时保持原值）
 *   '' / null → 不限时（落库 NULL）
 *   其它      → ISO 字符串 → Date；非法值返回 {error}
 */
function parseExpireAt(raw: unknown): { value?: Date | null; error?: string } {
  if (raw === undefined) return {};
  if (raw === null || String(raw).trim() === '') return { value: null };
  const d = new Date(String(raw).trim());
  if (Number.isNaN(d.getTime())) return { error: '到期时间格式不正确' };
  return { value: d };
}

/** 公开可见性：黑名单 / 违规内容不外露（与 public/list 口径一致） */
function publiclyVisible(metasRaw: string): boolean {
  const m = safeParse(metasRaw);
  return ((m.ListType as string) || 'None') !== 'Block' && m.Label !== 'adult';
}

@Injectable()
export class SharesService {
  // ------------------------------------------------------------------
  // 实例序号
  // ------------------------------------------------------------------

  /**
   * 登录用户名 → 实例创建者 ID（与 InstancesService.ownerIdOf 同规则）：
   * users 表主键；内建管理员不在 users 表 → 'admin'；users 表为空时也按 'admin'。
   */
  private async ownerIdOf(username: string): Promise<string> {
    const name = String(username || '').trim();
    if (!name) return '';
    try {
      const row = await prisma.user.findUnique({ where: { username: name }, select: { id: true } });
      if (row?.id) return row.id;
      const count = await prisma.user.count();
      return count > 0 ? name : 'admin';
    } catch {
      return name;
    }
  }

  /**
   * 该用户可见的实例列表（自建 + 被拉入），按 createdAt 升序 ——
   * 与 GET /api/instances 的顺序完全一致，序号即数组下标 + 1。
   */
  async instanceListOf(username: string): Promise<{ id: string; name: string; createdAt: Date }[]> {
    const name = String(username || '').trim();
    if (!name) return [];
    const myId = await this.ownerIdOf(name);
    const [mine, rough] = await Promise.all([
      prisma.instance.findMany({
        where: { ownerId: myId },
        select: { id: true, name: true, createdAt: true, metas: true },
      }),
      prisma.instance.findMany({
        where: { ownerId: { not: myId }, metas: { contains: `"${name}"` } },
        select: { id: true, name: true, createdAt: true, metas: true },
      }),
    ]);
    const joined = rough.filter((i) => readInstanceMembers(i.metas).includes(name));
    return [...mine, ...joined]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((i) => ({ id: i.id, name: i.name, createdAt: i.createdAt }));
  }

  /** 实例 id → { index(1-based), name }；用于列表回显 */
  private async indexMapsOf(owners: string[]): Promise<Map<string, Map<string, { index: number; name: string }>>> {
    const out = new Map<string, Map<string, { index: number; name: string }>>();
    await Promise.all(
      owners.filter(Boolean).map(async (owner) => {
        const list = await this.instanceListOf(owner);
        const m = new Map<string, { index: number; name: string }>();
        list.forEach((inst, i) => m.set(inst.id, { index: i + 1, name: inst.name }));
        out.set(owner, m);
      }),
    );
    return out;
  }

  /** 序号 → 实例（0 = 默认实例；超出范围返回 null） */
  async instanceOfIndex(username: string, idx: number): Promise<{ id: string; name: string } | null> {
    if (!Number.isFinite(idx) || idx < 0) return null;
    if (idx === 0) return { id: '', name: '默认' };
    const list = await this.instanceListOf(username);
    const hit = list[Math.floor(idx) - 1];
    return hit ? { id: hit.id, name: hit.name } : null;
  }

  // ------------------------------------------------------------------
  // 对外地址
  // ------------------------------------------------------------------

  /** 拼对外地址：目录路径逐段 encodeURIComponent，标签名整体编码 */
  buildUrl(owner: string, instanceIndex: number, type: string, target: string): string {
    const base = `/browse/${encodeURIComponent(owner)}/${instanceIndex}/${type === 'tag' ? 'tag' : 'cate'}`;
    const segs =
      type === 'tag'
        ? String(target || '').trim()
          ? [String(target).trim()]
          : []
        : String(target || '')
            .split('/')
            .filter(Boolean);
    const tail = segs.map((s) => encodeURIComponent(s)).join('/');
    return tail ? `${base}/${tail}` : `${base}/`;
  }

  /** 行 → 对外结构（instanceIndex / instanceName 由实例列表推导） */
  private serializeRow(
    row: ShareLink,
    map?: Map<string, { index: number; name: string }>,
  ): ShareItem {
    const meta = row.instanceId ? map?.get(row.instanceId) : { index: 0, name: '默认' };
    const instanceIndex = meta?.index ?? 0;
    const instanceName = meta?.name ?? (row.instanceId ? '（实例已删除）' : '默认');
    return {
      id: row.id,
      owner: row.owner,
      instanceId: row.instanceId,
      instanceIndex,
      instanceName,
      type: row.type,
      target: row.target,
      url: this.buildUrl(row.owner, instanceIndex, row.type, row.target),
      enabled: row.enabled,
      expired: !!row.expireAt && row.expireAt.getTime() < Date.now(),
      encrypted: !!row.passwordHash,
      expireAt: row.expireAt ? row.expireAt.toISOString() : null,
      note: row.note || '',
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // 权限
  // ------------------------------------------------------------------

  /**
   * 该账户是否具备「对外分享」权限：
   *   · users 表查不到（内建管理员）→ 允许；
   *   · 管理员 / 超级管理员 → 允许；
   *   · 普通用户 → 读 User.shareEnabled（默认 false）。
   */
  async canShare(username: string): Promise<boolean> {
    const u = String(username || '').trim();
    if (!u) return false;
    try {
      const row = await prisma.user.findUnique({ where: { username: u }, select: { role: true, shareEnabled: true } });
      if (!row) return true;
      if (row.role === 'admin' || row.role === 'super') return true;
      return row.shareEnabled === true;
    } catch {
      return false;
    }
  }

  /** 用户是否为该实例的创建者 / 成员（管理员放行） */
  private async canUseInstance(username: string, instanceId: string, isAdmin: boolean): Promise<boolean> {
    if (!instanceId) return true;
    const inst = await prisma.instance.findUnique({
      where: { id: instanceId },
      select: { ownerId: true, ownerName: true, metas: true },
    });
    if (!inst) return false;
    if (isAdmin) return true;
    if (inst.ownerName === username) return true;
    if (readInstanceMembers(inst.metas).includes(username)) return true;
    return inst.ownerId === (await this.ownerIdOf(username));
  }

  // ------------------------------------------------------------------
  // 管理端
  // ------------------------------------------------------------------

  /** GET /api/shares —— 普通用户只看自己；管理员可按 username 过滤（空 = 全部） */
  async list(q: ShareListQuery, actor: ShareActor) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));

    const where: Prisma.ShareLinkWhereInput = {};
    if (actor.isAdmin) {
      const want = String(q.username || '').trim();
      if (want) where.owner = want;
    } else {
      where.owner = actor.user;
    }
    // instanceId 传了才过滤（空串 = 只看默认实例）
    if (q.instanceId !== undefined) where.instanceId = String(q.instanceId ?? '');
    const type = String(q.type || '').trim();
    if (type === 'cate' || type === 'tag') where.type = type;
    const kw = String(q.keyword || '').trim();
    if (kw) {
      where.OR = [
        { target: { contains: kw, mode: 'insensitive' } },
        { note: { contains: kw, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.shareLink.count({ where }),
      prisma.shareLink.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const maps = await this.indexMapsOf(Array.from(new Set(rows.map((r) => r.owner))));
    return {
      success: true,
      total,
      page,
      pageSize,
      data: rows.map((r) => this.serializeRow(r, maps.get(r.owner))),
    };
  }

  /**
   * POST /api/shares —— upsert（唯一键 owner + instanceId + type + target）。
   * password：明文 → sha256；'' = 清除；不传 = 保持不变。
   */
  async upsert(
    actor: ShareActor,
    body: ShareUpsertBody,
  ): Promise<{ item?: ShareItem; error?: string; status?: number }> {
    const type: ShareType | '' = body?.type === 'tag' ? 'tag' : body?.type === 'cate' ? 'cate' : '';
    if (!type) return { error: 'type 只能是 cate 或 tag', status: 400 };

    // 管理员可代用户操作（body.username 只对管理员生效）
    const asUser = String(body?.username || '').trim();
    const owner = actor.isAdmin && asUser ? asUser : actor.user;
    if (!owner) return { error: '未登录', status: 401 };

    const instanceId = String(body?.instanceId ?? '');
    if (!(await this.canUseInstance(owner, instanceId, actor.isAdmin))) {
      return { error: '实例不存在或当前账户无权使用该实例', status: 400 };
    }

    // 对外分享权限（非管理员且 User.shareEnabled=false → 403）
    if (!(await this.canShare(owner))) {
      return { error: '该账户未开启对外分享权限', status: 403 };
    }

    const target =
      type === 'tag' ? String(body?.target || '').trim().slice(0, 100) : normalizeFolderPath(body?.target);
    if (type === 'tag' && !target) return { error: '请指定要分享的标签', status: 400 };

    // type=tag：标签必须存在（同一实例 + 同一归属），并写 tagId（改名后仍可定位）
    // v1.0.0：加 owner 限定 —— 原来只按「标签名 + 实例」查，会匹配到同实例下别人的同名标签，
    // 等于把自己的分享挂到了他人的标签上（浏览时看到的是别人的文件）。
    let tagId = '';
    if (type === 'tag') {
      const tag = await prisma.tag.findFirst({
        where: { name: target, instanceId, owner },
        select: { id: true },
      });
      if (!tag) return { error: `标签「${target}」不存在`, status: 400 };
      tagId = tag.id;
    }

    const exp = parseExpireAt(body?.expireAt);
    if (exp.error) return { error: exp.error, status: 400 };

    const enabledGiven = body?.enabled !== undefined;
    const enabled = toBool(body?.enabled, true);
    const pwdGiven = body?.password !== undefined;
    const passwordHash = pwdGiven ? (String(body?.password || '') ? sha256Hex(String(body.password)) : '') : '';
    const noteGiven = body?.note !== undefined;

    // update 只写「本次显式传了」的字段，避免把未提交的字段清空
    const update: Prisma.ShareLinkUpdateInput = { tagId };
    if (enabledGiven) update.enabled = enabled;
    if (pwdGiven) update.passwordHash = passwordHash;
    if (exp.value !== undefined) update.expireAt = exp.value;
    if (noteGiven) update.note = String(body?.note || '').slice(0, 1000);

    const row = await prisma.shareLink.upsert({
      where: { owner_instanceId_type_target: { owner, instanceId, type, target } },
      create: {
        owner,
        instanceId,
        type,
        target,
        tagId,
        enabled,
        passwordHash,
        expireAt: exp.value ?? null,
        note: String(body?.note || '').slice(0, 1000),
      },
      update,
    });

    // 旧字段一致性：目录分享 → FolderMeta.gallery + 访客图库白名单同增同减
    if (type === 'cate') await this.syncGallery(owner, instanceId, target, row.enabled);

    const maps = await this.indexMapsOf([owner]);
    appLog.info(
      'share',
      `对外分享已保存：${type === 'tag' ? `标签 ${target}` : `目录 ${target || '（根目录）'}`}`,
      `owner=${owner} ｜ 实例=${instanceId || '默认'} ｜ 启用=${row.enabled} ｜ 加密=${!!row.passwordHash} ｜ 到期=${row.expireAt ? row.expireAt.toISOString() : '不限时'}`,
    );
    return { item: this.serializeRow(row, maps.get(owner)) };
  }

  /** PATCH /api/shares/:id —— 仅 owner 或管理员 */
  async patch(
    id: string,
    actor: ShareActor,
    body: { enabled?: boolean | string; password?: string; expireAt?: string | null; note?: string },
  ): Promise<{ item?: ShareItem; error?: string; status?: number }> {
    const row = await prisma.shareLink.findUnique({ where: { id: String(id || '') } });
    if (!row) return { error: '分享不存在', status: 404 };
    if (!actor.isAdmin && row.owner !== actor.user) return { error: '无权操作该分享', status: 403 };

    const exp = parseExpireAt(body?.expireAt);
    if (exp.error) return { error: exp.error, status: 400 };

    const data: Prisma.ShareLinkUpdateInput = {};
    if (body?.enabled !== undefined) data.enabled = toBool(body.enabled, row.enabled);
    if (body?.password !== undefined) {
      data.passwordHash = String(body.password || '') ? sha256Hex(String(body.password)) : '';
    }
    if (exp.value !== undefined) data.expireAt = exp.value;
    if (body?.note !== undefined) data.note = String(body.note || '').slice(0, 1000);

    const next = await prisma.shareLink.update({ where: { id: row.id }, data });
    if (next.type === 'cate') await this.syncGallery(next.owner, next.instanceId, next.target, next.enabled);

    if (body?.enabled !== undefined) {
      appLog.info(
        'share',
        `${next.enabled ? '启用' : '停用'}对外分享：${next.target || '（根目录）'}`,
        `owner=${next.owner} ｜ 实例=${next.instanceId || '默认'} ｜ 类型=${next.type}`,
      );
    }
    const maps = await this.indexMapsOf([next.owner]);
    return { item: this.serializeRow(next, maps.get(next.owner)) };
  }

  /** DELETE /api/shares/:id —— 仅 owner 或管理员 */
  async remove(id: string, actor: ShareActor): Promise<{ success?: boolean; error?: string; status?: number }> {
    const row = await prisma.shareLink.findUnique({ where: { id: String(id || '') } });
    if (!row) return { error: '分享不存在', status: 404 };
    if (!actor.isAdmin && row.owner !== actor.user) return { error: '无权操作该分享', status: 403 };
    await prisma.shareLink.delete({ where: { id: row.id } });
    // 目录分享删除后取消访客图库标记（旧字段保持一致）
    if (row.type === 'cate') await this.syncGallery(row.owner, row.instanceId, row.target, false);
    appLog.info(
      'share',
      `删除对外分享：${row.target || '（根目录）'}`,
      `owner=${row.owner} ｜ 实例=${row.instanceId || '默认'} ｜ 类型=${row.type}`,
    );
    return { success: true };
  }

  /** POST /api/shares/batch —— 批量启停 / 改密码 / 删除（只作用于有权限的行） */
  async batch(
    actor: ShareActor,
    body: { ids?: string[]; action?: string; password?: string },
  ): Promise<{ success?: boolean; updated?: number; error?: string; status?: number }> {
    const ids = (Array.isArray(body?.ids) ? body.ids : []).map((x) => String(x || '')).filter(Boolean);
    const action = String(body?.action || '').trim();
    if (!ids.length) return { success: true, updated: 0 };
    if (!['enable', 'disable', 'password', 'delete'].includes(action)) {
      return { error: '不支持的操作', status: 400 };
    }

    const rows = await prisma.shareLink.findMany({ where: { id: { in: ids } } });
    const mine = rows.filter((r) => actor.isAdmin || r.owner === actor.user);
    if (!mine.length) return { success: true, updated: 0 };
    const targetIds = mine.map((r) => r.id);

    let updated = 0;
    if (action === 'delete') {
      const r = await prisma.shareLink.deleteMany({ where: { id: { in: targetIds } } });
      updated = r.count;
      await Promise.all(
        mine.filter((x) => x.type === 'cate').map((x) => this.syncGallery(x.owner, x.instanceId, x.target, false)),
      );
    } else if (action === 'password') {
      const hash = String(body?.password || '') ? sha256Hex(String(body.password)) : '';
      const r = await prisma.shareLink.updateMany({ where: { id: { in: targetIds } }, data: { passwordHash: hash } });
      updated = r.count;
    } else {
      const enabled = action === 'enable';
      const r = await prisma.shareLink.updateMany({ where: { id: { in: targetIds } }, data: { enabled } });
      updated = r.count;
      await Promise.all(
        mine
          .filter((x) => x.type === 'cate')
          .map((x) => this.syncGallery(x.owner, x.instanceId, x.target, enabled)),
      );
    }
    appLog.info(
      'share',
      `批量${action === 'delete' ? '删除' : action === 'password' ? '改密码' : action === 'enable' ? '启用' : '停用'}对外分享`,
      `操作者=${actor.user} ｜ 命中 ${updated} 条`,
    );
    return { success: true, updated };
  }

  // ------------------------------------------------------------------
  // 访客图库（旧字段）同步
  // ------------------------------------------------------------------

  /**
   * 目录对外分享 → 同步 FolderMeta.gallery 与「其他设置 → 公开游览」白名单。
   * 直接读写 settings 表（不经过 SysConfigService）：避免另起一个带缓存的服务实例，
   * 把别的模块已缓存的 others 分区写脏。失败只记日志，绝不影响分享本身。
   */
  private async syncGallery(owner: string, instanceId: string, path: string, on: boolean): Promise<void> {
    const p = normalizeFolderPath(path);
    if (!p) return; // 根目录不参与访客图库白名单
    try {
      const row = await prisma.folderMeta.findFirst({ where: { owner, instanceId, path: p } });
      if (row) {
        await prisma.folderMeta.update({ where: { id: row.id }, data: { gallery: on } });
      } else if (on) {
        await prisma.folderMeta.create({ data: { owner, instanceId, path: p, gallery: true } });
      }
    } catch (err) {
      appLog.warn('share', `同步目录属性 gallery 失败：${p}`, (err as Error)?.message || String(err));
    }

    try {
      const key = 'sysConfig:others';
      const cur = await prisma.setting.findUnique({ where: { key } });
      const parsed = safeParse(cur?.value);
      const pb = (parsed.publicBrowse as Record<string, unknown>) || {};
      const dirs = parseGalleryDirs(pb.allowedDir);
      const next = (on ? Array.from(new Set([...dirs, p])) : dirs.filter((d) => d !== p)).sort();
      const merged = { ...parsed, publicBrowse: { ...pb, allowedDir: next.join('\n') } };
      await prisma.setting.upsert({
        where: { key },
        update: { value: JSON.stringify(merged) },
        create: { key, value: JSON.stringify(merged) },
      });
    } catch (err) {
      appLog.warn('share', `同步访客图库白名单失败：${p}`, (err as Error)?.message || String(err));
    }
  }

  // ------------------------------------------------------------------
  // 公开访问
  // ------------------------------------------------------------------

  /** 公开接口的公共校验：用户 → 实例序号 → 分享行 → 启停/到期 → 密码 */
  private async resolveShare(
    q: SharePublicQuery,
    ctx: { cookieHash: string; ip: string },
  ): Promise<{ ok: true; share: ShareLink; setPwHash?: string } | { ok: false; needPassword?: boolean; error?: string }> {
    const owner = String(q.user || '').trim();
    if (!owner) return { ok: false, error: '缺少用户名' };

    const idx = Number(q.idx ?? 0);
    if (!Number.isFinite(idx) || idx < 0) return { ok: false, error: '实例序号不正确' };

    // 用户存在性（内建管理员不在 users 表 → 放行，由分享行本身兜底）
    const user = await prisma.user.findUnique({ where: { username: owner }, select: { username: true } });
    if (!user && !(await this.isBuiltinAdminName(owner))) {
      return { ok: false, error: '用户不存在' };
    }

    const inst = await this.instanceOfIndex(owner, Math.floor(idx));
    if (!inst) return { ok: false, error: '实例不存在' };

    const kind: ShareType = q.kind === 'tag' ? 'tag' : 'cate';
    const target = kind === 'tag' ? String(q.tag || '').trim() : normalizeFolderPath(q.path ?? q.dir);
    if (kind === 'tag' && !target) return { ok: false, error: '缺少标签名' };

    const share = await prisma.shareLink.findUnique({
      where: { owner_instanceId_type_target: { owner, instanceId: inst.id, type: kind, target } },
    });
    if (!share) return { ok: false, error: '分享不存在或已被取消' };
    if (!share.enabled) return { ok: false, error: '该分享已停用' };
    if (share.expireAt && share.expireAt.getTime() < Date.now()) return { ok: false, error: '该分享已过期' };

    if (share.passwordHash) {
      const pw = String(q.pw || '');
      // Cookie 直接等于 passwordHash，或 ?pw= 明文 sha256 后等于它 —— 任一命中即放行
      if (String(ctx.cookieHash || '') === share.passwordHash) return { ok: true, share };
      if (pw && sha256Hex(pw) === share.passwordHash) return { ok: true, share, setPwHash: share.passwordHash };
      // 验证失败：同分享 + 同 IP 一分钟只记一条，防刷屏
      if (pw && shouldLogPwFailure(`${share.id}::${ctx.ip || '-'}`)) {
        appLog.warn(
          'share',
          `分享密码验证失败：${kind === 'tag' ? `标签 ${target}` : `目录 ${target || '（根目录）'}`}`,
          `owner=${owner} ｜ 实例=${inst.id || '默认'} ｜ 分享=${share.id}`,
          ctx.ip || '',
        );
      }
      return { ok: false, needPassword: true, error: pw ? '密码错误' : undefined };
    }
    return { ok: true, share };
  }

  /** 内建管理员账户名（users 表没有该行时用于兜底放行） */
  private async isBuiltinAdminName(username: string): Promise<boolean> {
    const u = String(username || '').trim();
    if (!u) return false;
    const env = (process.env.ADMIN_USER || '').trim() || (process.env.SUPER_ADMIN_USERNAME || '').trim() || 'admin';
    if (u === env) return true;
    try {
      const admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
      return !!admin && admin.username === u;
    } catch {
      return false;
    }
  }

  /** 分享目标对应的文件条件（kind=cate 按目录；kind=tag 按标签关联） */
  private fileWhere(share: ShareLink): Prisma.FileRecordWhereInput {
    const where: Prisma.FileRecordWhereInput = {
      status: 'active',
      uploader: share.owner,
      instanceId: share.instanceId,
    };
    if (share.type === 'tag') {
      // v1.0.0：标签同样限定归属 —— 同名标签在不同用户下可以并存，
      // 只按名字 + 实例匹配会把两个人的文件混进同一个对外页面。
      where.tags = {
        some: { tag: { name: share.target, instanceId: share.instanceId, owner: share.owner } },
      };
    } else if (share.target) {
      where.OR = [{ folder: share.target }, { folder: { startsWith: `${share.target}/` } }];
    }
    return where;
  }

  /** GET /api/shares/public/access —— 公开访问前置校验（前端据此决定是否弹密码框） */
  async publicAccess(q: SharePublicQuery, ctx: { cookieHash: string; ip: string }): Promise<ShareAccessResult> {
    const r = await this.resolveShare(q, ctx);
    if (!r.ok) {
      return {
        success: !!r.needPassword,
        ok: false,
        ...(r.needPassword ? { needPassword: true } : {}),
        ...(r.error ? { error: r.error } : {}),
      };
    }
    const share = r.share;
    const name =
      share.type === 'tag'
        ? share.target
        : share.target
          ? share.target.split('/').filter(Boolean).pop() || share.target
          : '根目录';
    const count = await prisma.fileRecord.count({ where: this.fileWhere(share) });
    return {
      success: true,
      ok: true,
      name,
      owner: share.owner,
      instanceId: share.instanceId,
      kind: share.type,
      count,
      ...(r.setPwHash ? { setPwHash: r.setPwHash } : {}),
    };
  }

  /**
   * GET /api/shares/public/list —— 公开列表。
   * 返回结构与 files.controller 的 GET /api/public/list 一致（files / directories /
   * totalCount / returnedCount / allowedDirs / fromCache），前端 PublicBrowse.vue 直接复用。
   */
  async publicList(q: SharePublicQuery, ctx: { cookieHash: string; ip: string }): Promise<SharePublicListResult> {
    const empty: SharePublicListResult = {
      success: false,
      ok: false,
      files: [],
      directories: [],
      totalCount: 0,
      returnedCount: 0,
      allowedDirs: [],
      fromCache: false,
    };

    const r = await this.resolveShare(q, ctx);
    if (!r.ok) {
      return {
        ...empty,
        success: !!r.needPassword,
        needPassword: !!r.needPassword,
        ...(r.error ? { error: r.error } : {}),
      };
    }
    const share = r.share;

    // 分页：page/pageSize 优先，兼容 PublicBrowse 的 start/count
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? q.count ?? 50) || 50));
    const start = q.page ? (Math.max(1, Number(q.page) || 1) - 1) * pageSize : Math.max(0, Number(q.start || 0) || 0);

    const rows = await prisma.fileRecord.findMany({
      where: this.fileWhere(share),
      include: { copies: { include: { channel: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // 公开可见性过滤（与 public/list 一致：黑名单 / 违规内容不外露）
    const visible = rows.filter((x) => publiclyVisible(x.metas));

    const search = String(q.search || '').trim().toLowerCase();
    const wantType = String(q.type || '').trim().toLowerCase();
    const matched = visible.filter((x) => {
      if (search && !x.originalName.toLowerCase().includes(search) && !x.name.toLowerCase().includes(search)) return false;
      if (wantType && fileTypeOf(x.mime) !== wantType) return false;
      return true;
    });

    const totalCount = matched.length;
    const paged = pageSize > 0 ? matched.slice(start, start + pageSize) : matched.slice(start);

    // 子目录聚合：当前目录下的直接子目录（full path，与 public/list 一致）
    const basePrefix = share.type === 'tag' ? '' : share.target ? `${share.target}/` : '';
    const dirSet = new Set<string>();
    for (const x of matched) {
      const full = (x.folder || '').replace(/\/+$/, '');
      if (basePrefix && full !== share.target && !full.startsWith(basePrefix)) continue;
      const rest = full.slice(basePrefix.length);
      const i = rest.indexOf('/');
      if (i > 0) dirSet.add(basePrefix + rest.slice(0, i));
    }
    const directories = Array.from(dirSet).sort();

    return {
      success: true,
      ok: true,
      ...(r.setPwHash ? { setPwHash: r.setPwHash } : {}),
      files: paged.map((x) => serializeFile(x, x.copies)),
      directories,
      totalCount,
      returnedCount: paged.length,
      // 该分享的可见根目录（前端沿用 allowedDirs 字段，不必改渲染逻辑）
      allowedDirs: share.type === 'cate' && share.target ? [share.target] : [],
      fromCache: false,
    };
  }
}

/** Cookie 属性（controller 下发时使用） */
export const SHARE_PW_COOKIE_OPTIONS = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SHARE_PW_MAX_AGE * 1000,
};
