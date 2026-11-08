import { signOrigin } from '../common/request-origin';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UseInterceptors, UploadedFile } from '@nestjs/common';
import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FileRecord } from '@prisma/client';
import sharp from 'sharp'; // 图片尺寸处理（?width=&height=&fit= 缩放）
import { prisma } from '../common/prisma';
import { createAdapter, toCopyInfo } from '../adapters/adapter.factory';
import type { ChannelInfo } from '../adapters/adapter.interface';
import { localFileAbsOf } from '../adapters/local.adapter';
import { ChannelsService } from '../channels/channels.controller';
import { StorageChannelService, StorageChannelInfo } from '../storage/storage-channel.service';
import { UploadService } from '../upload/upload.service';
import { SettingsService } from '../settings/settings.service';
import { SysConfigService } from '../settings/sysconfig.service';
import { AdminGuard, ManageAuthGuard, SESSION_COOKIE, currentSession, isAdminRole, parseSession } from '../auth/auth.guard';
import { buildDirectoryTree, CHANNEL_LABEL, CopyWithChannel, fileExtOf, fileTypeOf, formatSize, isRecordFile, normalizeDir, normalizeUploadSource, pickPrimaryCopy, safeParse, serializeFile } from '../common/file-view';

// v1.0.5：详情页「原位媒体编辑」（裁剪 / 压缩 / 转 WebP / 视频转码）
import {
  compressInPlace,
  cropImage,
  logAbandoned,
  resolveMediaTarget,
  toWebp,
  transcodeInPlace,
  videoCodecLabel,
} from './media-edit';
import { probeVideoCodecFile } from '../common/compress';
import { appLog } from '../common/app-log';
import { frontendAppDir } from '../common/project-paths';
import { qqwryStatus, saveQqwry } from '../common/qqwry';
import { ipDisplayBatch, ipDisplayOf } from '../common/ip-query';
import { CryptoService } from '../common/crypto.service';
import { verifyTotp } from '../common/totp';
import { ensureBucketInKey, publicDomainOf, publicizeExternalUrl } from '../common/channel-domain';
import { hasRecordDomains, joinRecordUrl, recordLoadOrigin } from '../common/record-link';
import { userInInstance } from '../common/instance-access';
import { TAG_TYPE_FILE, findOrCreateTag } from '../common/tags';
import {
  FOLDER_TYPE_FILE,
  extraFoldersKey,
  extraFoldersOf,
  findFolderMeta,
  folderSharedPermission,
  folderSharedWithUser,
  listFoldersSharedBy,
  listSharedFoldersFor,
  normalizeFolderPath,
  normalizeSharedPerm,
  parseSharedUsers,
  requiredPasswordHashes,
  serializeFolderMeta,
  setGalleryPath,
  sha256Hex,
  shouldLogPasswordFailure,
} from './folder-meta.service';

/** 外链密码验证通过后种下的 Cookie（存已验证的 sha256 哈希数组，JSON） */
const FILE_PW_COOKIE = 'gohub_fpw';

/** 逗号分隔参数 → 数组 */
function splitCsv(v?: string): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/** 重命名请求体：新前端用 newFileId，旧调用方用 newName */
interface RenameBody {
  newFileId?: string;
  newName?: string;
}

/**
 * 读取通配路由（`xxx/*`）捕获到的完整路径。
 * File_ID 允许含目录层级（如 `风景/2026/abc`），普通 `:param` 不匹配斜杠，故统一用通配。
 * Express 已对捕获值做过一次 decode，这里仅在仍带转义时再解一次。
 */
function wildcardParam(req: Request): string {
  const raw = String((req.params as Record<string, string>)['0'] ?? '');
  if (!raw) return '';
  if (!/%[0-9a-fA-F]{2}/.test(raw)) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * 目录白名单匹配（参考原系统 isAllowedDirectory）：
 * 命中任一白名单目录即放行；白名单为空表示不限制。
 * 目录与白名单都按「去首尾斜杠、压缩重复斜杠」的规范形式比较。
 */
function dirAllowed(dir: string, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const norm = (s: string) => s.trim().replace(/^\/+/, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');
  const target = norm(dir || '');
  return allowed.some((a) => {
    const base = norm(a);
    if (!base) return true; // 白名单里写了空项 → 视为根目录，等于不限制
    return target === base || target.startsWith(`${base}/`);
  });
}

/** 定位前端构建产物中的静态文件（与 main.ts 共用 project-paths，保证规则唯一） */
function frontendAsset(...segments: string[]): string | null {
  const base = frontendAppDir();
  if (!base) return null;
  const p = join(base, ...segments);
  if (existsSync(p)) return p;
  return null;
}

const DAY_MS = 86400000;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → 该日 UTC 零点毫秒（作为「纯日期」坐标使用） */
function parseDayMs(s?: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 毫秒 → 'YYYY-MM-DD'（按 UTC 读数，配合时区偏移做本地日归组） */
function isoDayMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * 链接分发层 —— GoHub 外链签发的落点。
 *
 * GET /file/:name：
 *   1. 查文件记录 + 各渠道副本
 *   2. 按全局设置「当前访问渠道」(main|backup) 对副本排序
 *   3. 按渠道【当前配置】动态构造直链（key 不落库，改配置全站生效）
 *   4. 按 linkMode 分发：
 *        proxy    —— 服务端代理（默认）：转发 Range 与响应头，外链地址恒定
 *        redirect —— 302 临时重定向（禁用 301，避免被永久缓存）
 *   5. 所选渠道 404 / 5xx / 超时 → 自动降级到下一候选（另一渠道）
 *
 * 缓存策略：302 必须 no-cache；代理转发图片字节可长缓存 ——
 * 文件名是内容哈希，切渠道/改域名不影响同一 URL 的内容语义。
 */
/*
 * 说明：早期这里有一个独立的 globalMainChannel()（自己查 channel.findFirst({ isMain: true })），
 * 与 StorageChannelService 的兜底顺序各写一套，主渠道被禁用 / 存在多条 isMain 时会给出不同结果。
 * 现已删除，全站统一走 this.storageChannel.getStorageChannel(user, type)。
 */

@Controller()
export class LinkController {
  constructor(
    private settings: SettingsService,
    private channels: ChannelsService,
    private sysConfig: SysConfigService,
  ) {}

  /**
   * Referer 域名是否在允许清单内（参考原系统 isDomainAllowed）。
   *
   * 规则（v2.3.0 收紧）：
   *   - **无 Referer**（浏览器直接打开 / curl / 客户端）→ 放行。
   *     这是防盗链的通行做法：挡的是「别的站点嵌你的图」，不是「用户自己打开链接」。
   *   - 清单为空 → 不启用域名限制（白名单模式下等同于放行全部）。
   *   - 自身域名始终允许（后台预览、同站引用）。
   *   - 匹配方式：
   *       `*.example.com` → 任意子域（含 example.com 本身）
   *       `example.com`   → 精确匹配 example.com 与其子域 a.example.com
   *       不含点的短串（如 `555`）→ 仍按「包含」匹配（兼容历史配置）
   *     旧实现一律 includes，会把 `notexample.com` 误判成 `example.com` 的放行项，
   *     等于白名单形同虚设 —— 这里改成「精确 / 子域」匹配。
   */
  private domainAllowed(req: Request, allowedDomains?: string): boolean {
    const referer = req.headers.referer;
    if (!referer) return true;
    let host = '';
    try {
      host = new URL(String(referer)).hostname.toLowerCase();
    } catch {
      return false;
    }
    const domains = String(allowedDomains || '')
      .split(/[\n,;]+/)
      .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/[/:].*$/, ''))
      .filter(Boolean);
    // 空清单 = 不限制
    if (domains.length === 0) return true;
    const self = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (self && !domains.includes(self)) domains.push(self);

    return domains.some((raw) => {
      if (raw.startsWith('*.')) {
        const base = raw.slice(2);
        return host === base || host.endsWith(`.${base}`);
      }
      if (raw.includes('.')) return host === raw || host.endsWith(`.${raw}`);
      // 不含点的短串：保留「包含」语义（历史配置里常见只写域名的特征片段）
      return host.includes(raw);
    });
  }

  /**
   * 失效文件替换（v2.3.0）。
   *
   * 安全设置 → 访问管理 → 「失效文件替换地址」：
   *   fallbackType=image    → 直接下发该图片的字节（访问链接不变，内容换成替换图）
   *   fallbackType=redirect → 302 跳过去
   *
   * 覆盖场景：
   *   · 文件不存在 / 已进回收站
   *   · 无权限（黑白名单拦截、链接权限关闭）
   *   · 白名单模式下域名不在放行清单
   *   · 限时链接已过期
   * 未启用时保持原行为（原来的占位图 / 404 文案）。
   */
  private async readFallback(): Promise<{ enabled: boolean; type: 'image' | 'redirect'; url: string }> {
    try {
      const security: any = await this.sysConfig.get('security');
      const a = security?.access || {};
      return {
        enabled: a.fallbackEnabled === true && !!String(a.fallbackUrl || '').trim(),
        type: a.fallbackType === 'redirect' ? 'redirect' : 'image',
        url: String(a.fallbackUrl || '').trim(),
      };
    } catch {
      return { enabled: false, type: 'image', url: '' };
    }
  }

  /**
   * 「不能正常访问」时的统一出口：优先加载替换地址，否则执行传入的默认响应。
   */
  private async serveFallback(res: Response, isHead: boolean, fallback: () => unknown): Promise<void> {
    const cfg = await this.readFallback();
    if (!cfg.enabled) {
      fallback();
      return;
    }
    // 替换地址随时可能被管理员改掉，不能长缓存
    res.setHeader('Cache-Control', 'no-cache, max-age=0');
    if (cfg.type === 'redirect') {
      res.redirect(302, cfg.url);
      return;
    }
    try {
      const resp = await fetch(cfg.url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
      const type = resp.headers.get('content-type') || 'image/png';
      res.setHeader('Content-Type', type);
      res.status(200);
      if (isHead) {
        res.end();
        return;
      }
      Readable.fromWeb(resp.body as any).pipe(res);
      return;
    } catch (err) {
      appLog.warn('file', `失效替换图片加载失败：${(err as Error).message}`, cfg.url);
      if (!res.headersSent) res.status(404).send('Not Found');
    }
  }

  /**
   * 被拦截时的响应（参考原系统 returnBlockImg / returnWhiteListImg）：
   *   若配置了「失效文件替换地址」→ 优先生效（v2.3.0）；
   *   否则返回静态占位图（403 + image/png，<img> 标签仍能渲染出提示图），
   *   找不到静态图时回退为 302 跳到 /blockimg 或 /whiteliston 页面。
   */
  private renderBlocked(res: Response, kind: 'block' | 'white') {
    const asset = kind === 'block' ? 'BlockImg.png' : 'WhiteListOn.png';
    const page = kind === 'block' ? '/blockimg' : '/whiteliston';
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const local = frontendAsset('static', 'media', asset);
    if (local) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', 'inline');
      res.status(403);
      return res.sendFile(local);
    }
    return res.redirect(302, page);
  }

  /**
   * 访问控制（黑白名单 / 白名单模式 / 域名白名单）—— 与原系统 returnWithCheck 对齐：
   *   ListType=White  → 始终放行（本轮不做域名校验）
   *   ListType=Block  → 返回屏蔽图
   *   Label=adult     → 返回屏蔽图
   *   whiteListMode   → 非 White 文件要求 Referer 域名在 allowedDomains 内，否则返回白名单提示图
   *   ?from=admin     → 管理端预览：持管理员会话，或「登录账户就是该文件的上传者」时放行；
   *                     通过后不受上述限制（否则普通用户在自己后台预览自己的图会被 401 挡掉）
   */
  private async checkAccess(
    req: Request,
    res: Response,
    record: { metas: string; uploader?: string; folder?: string | null; instanceId?: string | null },
  ): Promise<boolean> {
    const metas = safeParse(record.metas);
    const listType = (metas.ListType as string) || 'None';

    if (req.query.from === 'admin') {
      const session = parseSession(req.cookies?.[SESSION_COOKIE]);
      const mine = !!session?.user && session.user === (record.uploader || '');
      /*
       * v3.0.0（第三轮）：目录「对用户共享」后，被共享用户点开共享文件同样带 ?from=admin，
       * 原先只放行「管理员 / 上传者本人」，被共享用户一律 401 → 前台卡片与预览全是「加载失败」。
       * 补一条：文件所在目录（含任一层父目录）已共享给当前登录用户 → 放行。
       */
      let sharedToMe = false;
      if (!isAdminRole(session?.role) && !mine && session?.user) {
        const hit = await folderSharedWithUser(record.folder, record.instanceId, session.user);
        sharedToMe = hit.shared;
      }
      if (!isAdminRole(session?.role) && !mine && !sharedToMe) {
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.status(401).send('Admin authentication required');
        return false;
      }
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return true;
    }

    const isHead = String(req.method).toUpperCase() === 'HEAD';
    if (listType === 'Block' || metas.Label === 'adult') {
      // 命中屏蔽：有「失效文件替换地址」就换成替换内容（v2.3.0），否则还是原来的屏蔽图
      await this.serveFallback(res, isHead, () => this.renderBlocked(res, 'block'));
      return false;
    }

    // 「链接权限」：用户管理里被关闭链接权限的账户，其文件外链一律不可访问
    // （后台预览带 from=admin，已在上面放行；这里只拦真正的对外访问）
    if (!(await this.linkAllowed(record.uploader))) {
      appLog.info('file', `链接权限已关闭，拒绝访问：${String((record as any).name || '')}`);
      await this.serveFallback(res, isHead, () => this.renderBlocked(res, 'block'));
      return false;
    }

    if (listType === 'White') return true;

    const security = (await this.sysConfig.get('security')) as { access?: Record<string, unknown> } | undefined;
    const access = security?.access || {};
    if (access.whiteListMode && !this.domainAllowed(req, access.allowedDomains as string)) {
      // 白名单模式下域名不在放行清单：换成「失效文件替换地址」（防盗链）
      appLog.info(
        'file',
        `白名单域名拒绝：referer=${String(req.headers.referer || '-')} path=${req.path}`,
      );
      await this.serveFallback(res, isHead, () => this.renderBlocked(res, 'white'));
      return false;
    }
    return true;
  }

  /**
   * 读取请求里「已验证过」的密码哈希集合（v3.0.0）：
   * Cookie gohub_fpw 存 JSON 数组（此前通过 ?pw= 验证成功时种下的 sha256）。
   */
  private verifiedPwHashes(req: Request): string[] {
    try {
      const raw = req.cookies?.[FILE_PW_COOKIE];
      const arr = typeof raw === 'string' ? JSON.parse(decodeURIComponent(raw)) : raw;
      return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)) : [];
    } catch {
      return [];
    }
  }

  /**
   * 「链接权限」判定：该上传者账户是否允许对外访问其文件链接。
   *   - 管理员账户不在 users 表中 → 视为允许；
   *   - 匿名上传（uploader 为空）→ 允许（历史数据不受影响）；
   *   - 普通用户 → 读 users.linkEnabled。
   * 结果做 10 秒内存缓存，避免每张图片都查一次库（开关变更 10 秒内生效）。
   */
  private linkCache = new Map<string, { allowed: boolean; at: number }>();
  private async linkAllowed(uploader?: string): Promise<boolean> {
    const u = String(uploader || '').trim();
    if (!u) return true;
    const hit = this.linkCache.get(u);
    const now = Date.now();
    if (hit && now - hit.at < 10_000) return hit.allowed;
    let allowed = true;
    try {
      const row = await prisma.user.findUnique({ where: { username: u }, select: { linkEnabled: true } });
      // 查不到该账户（管理员 / 已删除账户）时放行，避免误伤
      if (row) allowed = row.linkEnabled !== false;
    } catch {
      allowed = true;
    }
    this.linkCache.set(u, { allowed, at: now });
    return allowed;
  }

  /** 把可能是相对路径的重定向目标补成绝对地址（用于服务端内部转发） */  private absolutize(req: Request, target: string): string {
    const t = String(target || '').trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    const origin = signOrigin(req);
    return t.startsWith('/') ? `${origin}${t}` : `${origin}/${t}`;
  }

  /**
   * 本地存储渠道：直接读磁盘下发文件。
   *
   * 与 proxyStream 保持同样的对外行为：
   *   - 支持 Range（206），视频拖动进度条、音频 seek 都依赖它；
   *   - 带 Accept-Ranges 与长缓存（key 唯一，内容不会变）。
   * 差异：本地文件是「自己的磁盘」，不走 HTTP 拉取，所以没有任何超时/带宽中转损耗。
   */
  private async sendLocalFile(req: Request, res: Response, abs: string, record: FileRecord) {
    /*
     * v3.0.0（R10）：本地文件的缩略图同样走 sharp 缩放 ——
     * 本地读取虽然零网络开销，但原图体积没变（后台一屏几十张图照样吃流量）。
     * 输出是「文件 + 固定参数」的确定结果，可以长缓存。
     */
    const thumbRaw = String(req.query.thumb ?? '').trim();
    if (thumbRaw) {
      const ext = fileExtOf(record.originalName || record.name, record.mime || '').toLowerCase().replace(/^\./, '');
      if (['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(ext)) {
        try {
          const n = Number(thumbRaw);
          const w = Number.isFinite(n) && n > 0 ? Math.min(640, Math.max(64, Math.round(n))) : 320;
          const out = await sharp(abs).resize({ width: w, fit: 'cover' }).toBuffer({ resolveWithObject: true });
          const types: Record<string, string> = {
            jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif',
          };
          res.setHeader('Content-Type', types[out.info.format] || 'application/octet-stream');
          res.setHeader('Content-Length', String(out.data.length));
          // v1.0.4：管理员预览（?from=admin）已在 checkAccess 里声明 private，
          // 这里不能再无脑覆盖成 public —— 否则「仅登录可见」的图片被标成公开可缓存。
          if (!res.getHeader('Cache-Control')) {
            res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
          }
          res.setHeader('X-Imgbed-Transformed', '1');
          return res.end(out.data);
        } catch {
          // 解码失败（损坏/特殊色彩空间）→ 退回原文件，不阻断访问
        }
      }
    }
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      return res.status(404).send('Not Found');
    }
    const total = stat.size;
    const mime = record.mime || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Accept-Ranges', 'bytes');
    // 文件名由 key 决定且永不复用 → 可以长缓存；
    // 但管理员预览已在上游声明 private，保持私有（v1.0.4）
    if (!res.getHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }

    const range = String(req.headers['range'] || '');
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m) {
        let start = m[1] ? Number(m[1]) : NaN;
        let end = m[2] ? Number(m[2]) : NaN;
        if (Number.isNaN(start)) {
          // 后缀范围：bytes=-500 表示最后 500 字节
          if (Number.isNaN(end) || end <= 0) {
            res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
            return;
          }
          start = Math.max(0, total - end);
          end = total - 1;
        } else {
          if (Number.isNaN(end)) end = total - 1;
          end = Math.min(end, total - 1);
        }
        if (start > end || start >= total) {
          res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
          return;
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', String(end - start + 1));
        createReadStream(abs, { start, end }).on('error', () => res.end()).pipe(res);
        return;
      }
    }
    res.setHeader('Content-Length', String(total));
    createReadStream(abs).on('error', () => res.end()).pipe(res);
  }

  /** 代理模式：拉取上游并流式转发，支持 Range（206）与关键响应头透传 */
  private async proxyStream(
    req: Request,
    res: Response,
    candidates: { url: string; label: string }[],
    extraHeaders?: Record<string, string>,
  ) {
    const timeoutMs = Number(await this.settings.get('proxyTimeoutMs', '15000')) || 15000;
    const cacheSeconds = Number(await this.settings.get('proxyCacheSeconds', '86400')) || 86400;
    const range = req.headers['range'];
    let lastErr = '';

    for (const cand of candidates) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      // 客户端断开时同步中断上游请求
      const onClose = () => ctrl.abort();
      req.on('close', onClose);
      try {
        const headers: Record<string, string> = { 'User-Agent': 'GoHub-proxy', ...(extraHeaders || {}) };
        if (range) headers['Range'] = String(range);
        const upstream = await fetch(cand.url, { headers, signal: ctrl.signal, redirect: 'follow' });

        if (!upstream.ok && upstream.status !== 206) {
          lastErr = `${cand.label} → HTTP ${upstream.status}`;
          clearTimeout(timer);
          req.off('close', onClose);
          continue; // 404 / 5xx：降级到下一候选渠道
        }

        // 透传关键响应头（Range 场景必须带 Content-Range，否则视频拖动会崩）
        for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
          const v = upstream.headers.get(h);
          if (v) res.setHeader(h, v);
        }
        // 图片字节可长缓存；上游若自带 cache-control 则尊重它
        const upstreamCC = upstream.headers.get('cache-control');
        res.setHeader('Cache-Control', upstreamCC || `public, max-age=${cacheSeconds}, immutable`);
        res.setHeader('X-Imgbed-Source', encodeURIComponent(cand.label));
        res.status(upstream.status);

        if (!upstream.body) {
          clearTimeout(timer);
          req.off('close', onClose);
          return res.end();
        }
        const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
        nodeStream.on('error', () => { try { res.end(); } catch { /* ignore */ } });
        res.on('close', () => { try { nodeStream.destroy(); } catch { /* ignore */ } });
        nodeStream.pipe(res);
        return;
      } catch (err) {
        clearTimeout(timer);
        req.off('close', onClose);
        lastErr = `${cand.label} → ${(err as Error).message}`;
        continue;
      }
    }
    return res.status(502).send(`上游图床不可用：${lastErr}`);
  }

  /**
   * 解析外链请求上的图片尺寸参数（?width=&height=&fit=）。
   * 返回 {}  表示未携带参数或开关关闭（忽略，按原图返回）；
   * 返回 { error } 表示参数不合法（调用方回 400）；
   * 否则返回合法的 { width, height, fit }（均为可选）。
   * 参数约定：1-4096 的整数或 `auto`（auto = 由另一维度等比决定）；
   * fit 取值 cover / contain / fill / inside / outside（与 sharp resize 一致）。
   * 若配置了允许尺寸列表（imageTransformAllowedSizes，如 "320xauto,640xauto,1280x720"），
   * 则请求的组合必须在列表内，否则按不合法处理（防止被恶意拉大图刷流量）。
   */
  private async resolveImageTransform(
    req: Request,
  ): Promise<{ error?: string; width?: number | 'auto'; height?: number | 'auto'; fit?: string }> {
    const widthRaw = String(req.query.width ?? '').trim();
    const heightRaw = String(req.query.height ?? '').trim();
    const fitRaw = String(req.query.fit ?? '').trim().toLowerCase();
    /*
     * v3.0.0（R10）：后台内部缩略图专用参数 `thumb=<宽度>`。
     *
     * 后台列表 / 历史 / 系统状态 / 收集管理里的缩略图只需要小图，
     * 但不应受「图片尺寸处理」这个面向访客的开关与尺寸白名单限制 ——
     * 否则管理员关掉该功能后，后台缩略图会一次性全部退回原图（很费流量）。
     * 这里把它做成独立的内部通道：固定 cover、宽度上限 640、强缓存。
     */
    const thumbRaw = String(req.query.thumb ?? '').trim();
    if (thumbRaw) {
      const n = Number(thumbRaw);
      const w = Number.isFinite(n) && n > 0 ? Math.min(640, Math.max(64, Math.round(n))) : 320;
      return { width: w, fit: 'cover' };
    }
    if (!widthRaw && !heightRaw && !fitRaw) return {}; // 未携带尺寸参数

    const access = (await this.sysConfig.get('security'))?.access || {};
    if (access.imageTransformEnabled !== true) return {}; // 开关关闭：忽略参数

    // fit 校验
    let fit = '';
    if (fitRaw) {
      if (!['cover', 'contain', 'fill', 'inside', 'outside'].includes(fitRaw)) {
        return { error: 'fit 参数不合法（cover / contain / fill / inside / outside）' };
      }
      fit = fitRaw;
    }
    // width / height 校验（整数 1-4096 或 auto）
    const parseDim = (raw: string): number | 'auto' | undefined => {
      if (!raw) return undefined;
      if (/^auto$/i.test(raw)) return 'auto';
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 4096) return undefined;
      return n;
    };
    const width = parseDim(widthRaw);
    const height = parseDim(heightRaw);
    if (widthRaw && width === undefined) return { error: 'width 参数不合法（1-4096 的整数或 auto）' };
    if (heightRaw && height === undefined) return { error: 'height 参数不合法（1-4096 的整数或 auto）' };

    // 允许尺寸列表（白名单）：仅当请求组合命中列表才放行；列表为空表示不限制
    const allowed = String(access.imageTransformAllowedSizes || '').trim();
    if (allowed) {
      const list = allowed.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const key = `${width ?? 'auto'}x${height ?? 'auto'}`;
      if (!list.includes(key)) return { error: `该尺寸不在允许列表内（${list.join('、')}）` };
    }
    return { width, height, fit };
  }

  /**
   * 图片尺寸处理下发：拉取原图 → sharp 缩放 → 按实际输出格式下发。
   * 多候选渠道逐个尝试，单个失败（网络/解码）自动降级下一个，全部失败回 502。
   * 注意：动态缩放结果随参数变化，缓存时间给短（1 小时），避免 CDN 缓存键冲突。
   */
  private async serveTransformedImage(
    res: Response,
    candidates: { url: string; label: string }[],
    t: { width?: number | 'auto'; height?: number | 'auto'; fit?: string },
    longCache = false,
  ) {
    const timeoutMs = Number(await this.settings.get('proxyTimeoutMs', '15000')) || 15000;
    let lastErr = '';
    for (const cand of candidates) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const upstream = await fetch(cand.url, {
          headers: { 'User-Agent': 'GoHub-proxy' },
          signal: ctrl.signal,
          redirect: 'follow',
        });
        if (!upstream.ok) {
          lastErr = `${cand.label} → HTTP ${upstream.status}`;
          continue;
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        // 组装 sharp resize 选项：width/height 为 auto（或不传）时不设置该维度，由另一维度等比决定
        const option: sharp.ResizeOptions = { fit: (t.fit as sharp.ResizeOptions['fit']) || 'cover' };
        if (typeof t.width === 'number') option.width = t.width;
        if (typeof t.height === 'number') option.height = t.height;
        const out = await sharp(buf).resize(option).toBuffer({ resolveWithObject: true });
        const types: Record<string, string> = {
          jpeg: 'image/jpeg',
          png: 'image/png',
          webp: 'image/webp',
          avif: 'image/avif',
        };
        res.setHeader('Content-Type', types[out.info.format] || 'application/octet-stream');
        res.setHeader('Content-Length', String(out.data.length));
        /*
         * 缩略图是「文件内容 + 固定参数」的确定性结果（文件不可变），
         * 可以长缓存；普通访客指定的尺寸继续短缓存，避免参数组合污染 CDN。
         */
        res.setHeader(
          'Cache-Control',
          longCache ? 'public, max-age=2592000, immutable' : 'public, max-age=3600',
        );
        res.setHeader('X-Imgbed-Transformed', '1');
        return res.end(out.data);
      } catch (err) {
        lastErr = `${cand.label} → ${(err as Error).message}`;
      } finally {
        clearTimeout(timer);
      }
    }
    return res.status(502).send(`图片处理失败：${lastErr}`);
  }

  /**
   * 外链分发入口。
   * 用 `file/*` 而非 `file/:name`：File_ID 允许包含目录层级（如 `风景/2026/abc`），
   * `:name` 不匹配斜杠，会导致这类外链 404。
   */
  @Get('file/*')
  async serve(@Req() req: Request, @Res() res: Response) {
    const name = wildcardParam(req);
    /** HEAD 请求只回响应头（失效替换逻辑里要区分，避免把图片字节写进 HEAD 响应） */
    const isHead = String(req.method).toUpperCase() === 'HEAD';
    // 兼容前端契约：src 可能带扩展名（/file/abc123.jpg）
    // 后端一律按「去掉最后一段扩展名」查库，因此带不带扩展名都能访问，
    // 扩展名只起「直观展示文件类型」的作用，不影响代理 / 302 / 访问源切换。
    //
    // 额外兼容 S3 / WebDAV 客户端「自拼链接」的场景：
    //   客户端常把 bucket / 渠道 ID 也拼进路径（如 /file/805232/web/ab.png），
    //   这里对路径逐段剥离前缀再查库，保证「客户端拼出来的地址」同样可访问。
    const nameCandidates: string[] = [];
    const pushName = (v: string) => {
      const s = String(v || '').replace(/^\/+/, '');
      if (!s) return;
      if (!nameCandidates.includes(s)) nameCandidates.push(s);
      const b = s.replace(/\.[^.]*$/, '');
      if (b && b !== s && !nameCandidates.includes(b)) nameCandidates.push(b);
    };
    pushName(name);
    let rest = name;
    while (rest.includes('/')) {
      rest = rest.slice(rest.indexOf('/') + 1);
      pushName(rest);
    }
    /**
     * 回收站里的文件对外一律 404（恢复后自动恢复访问）；
     * 但 `?from=admin` 是管理端预览（下面 checkAccess 会校验管理员会话或上传者本人），
     * 回收站列表要能显示缩略图，所以这条通道放行 deleted 记录 —— 否则进回收站后
     * 卡片/列表全是「加载失败」。
     */
    const adminPreview = req.query.from === 'admin';
    const record = await prisma.fileRecord.findFirst({
      where: { ...(adminPreview ? {} : { status: 'active' }), OR: nameCandidates.map((n) => ({ name: n })) },
      include: { copies: true },
    });
    if (!record) {
      // 文件不存在 → 换成「失效文件替换地址」（未配置时照旧 404）
      await this.serveFallback(res, isHead, () => res.status(404).send('Not Found'));
      return;
    }

    /*
     * 限时访问（v2.1.0）：设置了截止时间且已过期。
     * v2.3.0 起改为加载「失效文件替换地址」（未配置时仍返回 410 Gone）。
     *   · 管理端预览（?from=admin）不受限，否则回收站 / 详情缩略图会失效；
     *   · 用 no-store 避免 CDN / 浏览器缓存住过期前的 200。
     */
    if (record.linkExpiresAt && !adminPreview && !isAdminRole(currentSession(req)?.role) && Date.now() > record.linkExpiresAt.getTime()) {
      res.setHeader('Cache-Control', 'no-store');
      await this.serveFallback(res, isHead, () => res.status(410).send('链接已过期'));
      return;
    }

    // 访问控制：黑白名单 / 白名单模式 / 域名白名单（放行返回 true）
    if (!(await this.checkAccess(req, res, record))) return;

    /*
     * v3.0.0 外链密码验证链：
     *   ① 文件自身 metas.AccessPasswordHash
     *   ② 所属各级目录 FolderMeta.passwordHash（folder 及全部父级路径）
     *   ③ 所属任意 Tag 的 metas.passwordHash
     * 任一层存在密码即要求验证；?pw= 明文或 Cookie（gohub_fpw，存已验证哈希）
     * 命中任一层哈希即放行，否则 401「需要密码」（与失效替换同样的 no-store 防缓存）。
     * 管理端预览（?from=admin）已在 checkAccess 验过会话，这里不再重复要密码。
     */
    if (!adminPreview) {
      const needHashes = await requiredPasswordHashes(record as never);
      if (needHashes.length) {
        const clientHashes = new Set<string>(this.verifiedPwHashes(req));
        const pwRaw = String(req.query.pw ?? '');
        let matchedByParam = false;
        if (pwRaw) {
          const given = sha256Hex(pwRaw);
          if (needHashes.includes(given)) {
            clientHashes.add(given);
            matchedByParam = true;
          }
        }
        if (needHashes.some((h) => clientHashes.has(h))) {
          // ?pw= 验证通过时种 Cookie，后续请求不用再带 pw（30 天）
          if (matchedByParam) {
            res.setHeader(
              'Set-Cookie',
              `${FILE_PW_COOKIE}=${encodeURIComponent(JSON.stringify(Array.from(clientHashes)))}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`,
            );
          }
        } else {
          // 验证失败：限频记日志（同文件 + 同 IP 一分钟一条），避免刷屏
          if (shouldLogPasswordFailure(record.name, req.ip || '')) {
            // v3.0.0：外链密码只认文件自身（目录 / 标签加密不再参与），故来源固定为「文件自身密码」
            appLog.warn('file', `外链密码验证失败：${record.name}`, '来源=文件自身密码', req.ip || '');
          }
          res.setHeader('Cache-Control', 'no-store');
          res.status(401).send('需要密码：请通过 ?pw=<密码> 访问该文件');
          return;
        }
      }
    }

    /**
     * 访问计数（「访问次数」功能）：
     *   - 只在真实下发文件（未命中黑白名单拦截、未 404）时计数
     *   - 管理端预览（?from=admin）不计入，否则后台列表一刷新就把计数刷爆
     *   - 异步写库且不 await，避免拖慢外链响应
     */
    if (req.query.from !== 'admin') {
      void prisma.fileRecord
        .update({ where: { id: record.id }, data: { views: { increment: 1 } } })
        .catch(() => undefined);
    }

    /**
     * 重定向：**在服务端内部完成转发**，浏览器地址栏始终是原来的外链。
     *   访问 /file/A（A 已设置重定向到 B）→ 内容取自 B，但 URL 仍是 /file/A。
     * 实现要点：
     *   1) 目标可能是相对路径（/file/xxx），先补成绝对地址；
     *   2) 用 X-Imgbed-Redirect-Depth 传递跳数，最多 3 跳，避免 A→B→A 死循环；
     *   3) 目标就是自己时直接 404，避免自引用把请求打爆。
     */
    if (record.redirectUrl) {
      const target = String(record.redirectUrl).trim();
      const abs = this.absolutize(req, target);
      // 自引用保护：目标解析回本文件本身
      const selfKey = decodeURIComponent(abs.split('?')[0].replace(/^.*\/file\//, '').replace(/\.[^.]*$/, ''));
      if (selfKey && (selfKey === record.name || selfKey === record.id)) {
        return res.status(404).send('Not Found');
      }
      const depth = Number(req.headers['x-gohub-redirect-depth'] || 0) || 0;
      if (depth >= 3) return res.status(508).send('重定向链路过长');
      res.setHeader('Cache-Control', 'no-cache, max-age=0');
      return this.proxyStream(req, res, [{ url: abs, label: 'redirect' }], {
        'X-Imgbed-Redirect-Depth': String(depth + 1),
      });
    }

    const prefer = await this.settings.getAccessChannel();
    let active = record.copies.filter((c) => c.status === 'active' && (c.remoteKey || c.remoteUrl));
    if (active.length === 0) {
      await this.serveFallback(res, isHead, () => res.status(404).send('Not Found'));
      return;
    }

    // ?channel=<渠道ID>：强制走指定渠道的直链（文件详情里点「存储渠道 / 备份渠道」用）
    const forceChannel = String(req.query.channel || '').trim();
    if (forceChannel) {
      active = active.filter((c) => c.channelId === forceChannel);
      if (active.length === 0) {
        await this.serveFallback(res, isHead, () => res.status(404).send('Not Found'));
        return;
      }
    }

    // 按「当前访问渠道」排序候选：首选渠道在前，另一渠道作为降级候选
    const channelIds = active.map((c) => c.channelId);
    const channels = await prisma.channel.findMany({ where: { id: { in: channelIds } } });
    /*
     * v1.0.4：取源口径统一到 fileCopy.isPrimary。
     *
     * 旧逻辑只认渠道级 isMain / isBackup，不认副本的 isPrimary —— 转存把 isPrimary 指到新渠道后，
     * 数据层换了主，外链却还在读旧渠道，表现为「转存后没生效」。
     * 新顺序（由「访问渠道」偏好决定先后）：
     *   默认  ：主副本 → 全局主渠道 → 全局备份渠道 → 未标记副本 → 已禁用兜底
     *   切备份：全局备份渠道 → 主副本 → 全局主渠道 → 未标记副本 → 已禁用兜底
     * 「切备份」必须排最前，否则后台的「访问渠道 = 备份」会失效。
     */
    const preferList = prefer === 'backup' ? ['backup', 'primary', 'main'] : ['primary', 'main', 'backup'];
    const enabledIds = new Set(channels.filter((c) => c.enabled).map((c) => c.id));
    const ordered: typeof active = [];
    const roleOf = (channelId: string): string => {
      const ch = channels.find((x) => x.id === channelId);
      if (!ch) return '';
      if (ch.isBackup) return 'backup';
      if (ch.isMain) return 'main';
      return '';
    };
    const byRole = (role: string, enabledOnly = false) => {
      for (const c of active) {
        if (ordered.includes(c)) continue;
        // 'primary' 是副本级标记，其余是渠道级角色
        if (role === 'primary' ? !c.isPrimary : roleOf(c.channelId) !== role) continue;
        if (enabledOnly && !enabledIds.has(c.channelId)) continue;
        ordered.push(c);
      }
    };
    // 一级：启用中的渠道按访问源优先级
    for (const role of preferList) byRole(role, true);
    // 二级：未打主/备标记的存量副本（启用中）
    for (const c of active) {
      if (!ordered.includes(c) && enabledIds.has(c.channelId)) ordered.push(c);
    }
    // 三级：兜底 —— 已禁用的渠道（全部不可用时至少尝试一次）
    for (const role of preferList) byRole(role);
    for (const c of active) if (!ordered.includes(c)) ordered.push(c);

    const candidates: { url: string; label: string }[] = [];
    /**
     * v2.8.7：先取外链模式 —— 决定直链用「内网通信域名」还是公开访问域名：
     *   · 代理模式（默认）：服务端自己拉源文件 → 优先内网域名（提速 + 省公网流量）；
     *   · 302 重定向：浏览器直连源站 → 内网地址外网打不开，仍用公开访问域名。
     * 文件详情页「存储渠道 / 备份渠道」源链接走 serializeFile 的 directUrlResolver
     * （不带 preferInternal），同样保持公开访问域名。
     */
    const mode = await this.settings.getLinkMode();
    const preferInternal = mode !== 'redirect';
    /**
     * 本地存储渠道没有「渠道直链」，必须由服务端直接读盘下发。
     * 只有在它之前没有任何可用的 URL 候选时才走本地 —— 保持「主渠道优先」的既有语义：
     *   主渠道是 COS → 走 COS；主渠道是本地存储 → 直接读盘。
     */
    for (const copy of ordered) {
      const ch = channels.find((c) => c.id === copy.channelId);
      if (!ch) continue;
      /*
       * v2.8.8：「登记文件」的副本里存的是**完整源地址**（remoteUrl），
       * 没有渠道内 object key —— 这类副本直接拿 remoteUrl 当候选。
       * custom 渠道例外：它本来就用 remoteUrl 做域名替换，交给适配器处理。
       */
      const absoluteRemote = /^https?:\/\//i.test(String(copy.remoteUrl || '')) ? String(copy.remoteUrl) : '';
      if (ch.type === 'local') {
        if (absoluteRemote) {
          candidates.push({ url: absoluteRemote, label: ch.name });
          continue;
        }
        /*
         * v3.0.0（R10）：本地渠道的「登记文件」没有磁盘实体 ——
         * 它的固化地址是本站另一条 /file 路径（如 file/<源文件ID>），
         * 这里把它作为候选交给 proxyStream 由服务端回源自取，避免直接 404。
         */
        if (isRecordFile(record) && copy.objectPath) {
          const q = String(copy.urlQuery || '').trim();
          candidates.push({
            url: `${signOrigin(req)}/${String(copy.objectPath).replace(/^\/+/, '')}${q ? `?${q}` : ''}`,
            label: ch.name,
          });
          continue;
        }
        if (candidates.length > 0) continue;
        // v3.0.0：先按内置 uploads 根定位，未命中再探测自定义本地渠道的 rootPath
        const abs = await localFileAbsOf(copy.remoteKey);
        if (!abs) continue;
        return this.sendLocalFile(req, res, abs, record);
      }
      const info = {
        id: ch.id,
        name: ch.name,
        type: ch.type,
        config: this.channels.decryptConfig(ch.type, ch.config),
        metas: {},
      };
      /*
       * v2.9.0：登记文件 —— 渠道内路径 + 渠道当前实际加载域名（代理模式优先内网域名，
       * 302 模式优先公开域名），保证渠道域名换了之后外链自动跟着变。
       * v3.0.0：传入渠道类型 —— immich 的公开域名/服务地址键名不同（domain/serverUrl），
       * 不传类型时 immich 登记文件会误走适配器直链，把 remoteKey 当 assetId 拼出重复路径。
       */
      /*
       * v3.0.0（R6）：这条「域名 + remoteKey」规则**只适用于登记文件**（key 是相对域名的完整路径）。
       * 普通上传副本的 key 是「相对桶根的对象键」（如 2026/10/x.png），必须交给适配器
       * buildDirectUrl 去补 bucket / directory —— 否则 MinIO 会拼出「域名/对象前缀/文件」，
       * 少了一层桶名，落库链接直接 403/404（此前没有上传来源判断，所有副本都被这条规则命中）。
       */
      /*
       * v3.0.0（R11）：登记文件的固化地址优先交给适配器拼 ——
       * objectPath + urlQuery + 渠道「当前」加载域名。
       * 例：immich 的登记路径是 api/assets/<id>/thumbnail，取流必须带上
       * ?key=<shareKey>（分享鉴权），早先这里只拼 remoteKey（纯路径）把 query 丢了，
       * 于是详情页直链能打开、后台缩略图 / 详情预览却 401 -> 502「加载失败」。
       */
      if (!absoluteRemote && copy.objectPath && isRecordFile(record)) {
        const recordDynamic = createAdapter(info).buildDirectUrl(toCopyInfo(copy), info, preferInternal);
        if (recordDynamic) {
          candidates.push({ url: recordDynamic, label: ch.name });
          continue;
        }
      }
      if (!absoluteRemote && copy.remoteKey && isRecordFile(record) && hasRecordDomains(info.config, ch.type)) {
        const recordUrl = joinRecordUrl(recordLoadOrigin(info.config, preferInternal, ch.type), ensureBucketInKey(ch.type, info.config, copy.remoteKey));
        if (recordUrl) {
          candidates.push({ url: recordUrl, label: ch.name });
          continue;
        }
      }
      /*
       * v3.0.0：动态直链优先 —— buildDirectUrl 按渠道【当前配置】实时构造
       * （preferInternal 时内网域名 → 公开域名 → Endpoint），渠道改域名后立即生效；
       * 上传时落库的 remoteUrl（完整直链）只作最后兜底（仅 remoteKey 为空的 legacy 记录会走到），
       * 不再作为首选，杜绝「上传时的源链接写死在库里、改配置后仍是死链」的问题。
       */
      const dynamicUrl = createAdapter(info).buildDirectUrl(toCopyInfo(copy), info, preferInternal);
      const url = dynamicUrl || (absoluteRemote && ch.type !== 'custom' ? absoluteRemote : '');
      if (url) candidates.push({ url, label: ch.name });
    }
    if (candidates.length === 0) {
      await this.serveFallback(res, isHead, () => res.status(404).send('Not Found'));
      return;
    }

    // 图片尺寸处理（?width=&height=&fit=）：仅代理模式生效，且只对可缩放的位图类型生效
    // （gif 含多帧动画、svg 为矢量，sharp 处理会丢帧/转码，均跳过按原图返回）
    const t = await this.resolveImageTransform(req);
    if (t.error) return res.status(400).send(t.error);
    /*
     * v3.0.0（R10）：扩展名要从「原始文件名 + MIME」取 ——
     * 新上传的 File_ID 是 48 位无后缀串（record.name），拿它取扩展名永远是空，
     * 会导致 ?width=/?thumb= 全部退化成原图。
     */
    const imgExt = fileExtOf(record.originalName || record.name, record.mime || '').toLowerCase().replace(/^\./, '');
    const scalable = ['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(imgExt);
    /*
     * v3.0.0（R10）：后台缩略图（thumb=）无论当前是代理还是 302 模式都由服务端出图 ——
     * 管理员可能在外网，直连渠道内网域名不可达；且缩略图本身就该大幅降体积。
     */
    const wantThumb = String(req.query.thumb ?? '').trim() !== '';
    if ((t.width || t.height) && scalable && (preferInternal || wantThumb)) {
      return this.serveTransformedImage(res, candidates, t, wantThumb);
    }
    if (preferInternal) return this.proxyStream(req, res, candidates);
    // 302（临时）+ no-cache：后台一键切换渠道、改配置域名，下一次访问立即生效。
    // 302 模式由源站直接下发原文件，图片尺寸参数不参与（忽略）。
    res.setHeader('Cache-Control', 'no-cache, max-age=0');
    return res.redirect(302, candidates[0].url);
  }

  // ==========================================================================
  // v3.0.0 文件夹属性 / 标签管理 API
  // 说明：app.module 本轮不允许改动（无法注册新控制器类），而本控制器的
  // @Controller() 前缀为空、装饰器内可直接写绝对路径，因此把新路由挂在这里，
  // 鉴权用方法级 @UseGuards(ManageAuthGuard)（与管理端现有用法一致）。
  // ==========================================================================

  /** 当前会话用户名（未登录空串） */
  private sessionUser(req: Request): string {
    return currentSession(req)?.user || '';
  }

  /** 当前会话是否管理员 */
  private sessionAdmin(req: Request): boolean {
    return isAdminRole(currentSession(req)?.role);
  }

  /**
   * GET /api/folders/meta?path=<urlencoded>&instanceId=
   * 读取目录属性（无则 {exists:false}）。
   * 权限：owner 本人或 admin（全量）；共享用户可读（隐藏 note）。
   */
  @Get('api/folders/meta')
  @UseGuards(ManageAuthGuard)
  async getFolderMeta(@Req() req: Request, @Query() q: Record<string, string>) {
    const path = normalizeFolderPath(q.path);
    if (!path) return { success: false, message: '缺少 path' };
    const row = await findFolderMeta(path, String(q.instanceId ?? ''));
    if (!row) return { exists: false };
    const me = this.sessionUser(req);
    const admin = this.sessionAdmin(req);
    const shared = parseSharedUsers(row.sharedUsers).includes(me);
    if (!admin && row.owner !== me && !shared) {
      return { exists: false, forbidden: true };
    }
    // 共享用户（非 owner 非 admin）可读但不给 note
    return { exists: true, meta: serializeFolderMeta(row, { hideNote: !admin && row.owner !== me }) };
  }

  /**
   * POST /api/folders/meta
   * body: { path, instanceId?, name?, password?, note?, sharedUsers?, gallery? }
   *   · password 传明文 → sha256 存 passwordHash；传空串清空加密；不传保持不变
   *   · name 仅展示用，存 metas.displayName
   *   · sharedUsers 为用户名数组（也兼容逗号分隔字符串）
   *   · gallery=true 时把目录写进「访客图库」白名单（其他设置 → 公开游览 allowedDir）
   * upsert（owner=当前用户名；同 owner + 实例 + path 唯一）。
   */
  @Post('api/folders/meta')
  @UseGuards(ManageAuthGuard)
  async saveFolderMeta(
    @Req() req: Request,
    @Body()
    body: {
      path?: string;
      instanceId?: string;
      name?: string;
      password?: string;
      note?: string;
      sharedUsers?: string[] | string;
      sharedPerm?: string;
      gallery?: boolean | string;
    },
  ) {
    const path = normalizeFolderPath(body?.path);
    if (!path) return { success: false, message: '缺少 path' };
    const me = this.sessionUser(req);
    if (!me) return { success: false, message: '未登录' };
    const instanceId = String(body?.instanceId ?? '');
    let row = await findFolderMeta(path, instanceId, me);

    // metas：displayName（仅展示用）
    const metasObj = row ? safeParse(row.metas) : {};
    if (body?.name !== undefined) metasObj.displayName = String(body.name || '').slice(0, 200);
    const metasJson = JSON.stringify(metasObj);

    // password：undefined=保持；''=清除；其它=sha256 明文
    let passwordHash = row?.passwordHash || '';
    if (body?.password !== undefined) {
      passwordHash = String(body.password || '') ? sha256Hex(String(body.password)) : '';
    }

    // sharedUsers：数组或逗号分隔字符串 → 去重清洗
    let sharedUsers = row?.sharedUsers || '[]';
    if (body?.sharedUsers !== undefined) {
      const list = Array.isArray(body.sharedUsers)
        ? body.sharedUsers
        : String(body.sharedUsers).split(',');
      sharedUsers = JSON.stringify(
        Array.from(new Set(list.map((s) => String(s || '').trim()).filter(Boolean))),
      );
    }

    // v3.0.0（R8）：共享权限（edit=可编辑 / readonly=只读）—— 只认合法值，历史行保持 edit
    const sharedPerm = body?.sharedPerm !== undefined ? normalizeSharedPerm(body.sharedPerm) : normalizeSharedPerm(row?.sharedPerm);

    const gallery = body?.gallery === undefined ? (row?.gallery ?? false) : body.gallery === true || body.gallery === 'true';

    if (row) {
      row = await prisma.folderMeta.update({
        where: { id: row.id },
        data: {
          passwordHash,
          note: body?.note !== undefined ? String(body.note || '').slice(0, 4000) : row.note,
          sharedUsers,
          sharedPerm,
          metas: metasJson,
          gallery,
        },
      });
    } else {
      row = await prisma.folderMeta.create({
        data: {
          owner: me,
          path,
          instanceId,
          // v1.0.3：目录属性按「实例 + 类型」隔离，这里固定写文件分类
          type: FOLDER_TYPE_FILE,
          passwordHash,
          note: String(body?.note || '').slice(0, 4000),
          sharedUsers,
          sharedPerm,
          metas: metasJson,
          gallery,
        },
      });
    }

    // gallery → 访客图库白名单（publicBrowse.allowedDir）同步增删。
    // 仅在请求显式带 gallery 字段（或新建行且 gallery=true）时才动白名单，
    // 避免只改密码/备注的保存把后台手工配置的白名单项误删。
    let galleryDirs: string[] | undefined;
    if (body?.gallery !== undefined || gallery) {
      try {
        galleryDirs = await setGalleryPath(this.sysConfig, path, gallery);
      } catch (err) {
        appLog.warn('file', `访客图库白名单更新失败：${path}`, (err as Error).message);
      }
    }
    appLog.info(
      'file',
      `目录属性已保存：${path}`,
      `实例=${instanceId || '默认'} ｜ 加密=${!!passwordHash} ｜ 共享=${parseSharedUsers(sharedUsers).length}人(${sharedPerm}) ｜ 访客图库=${gallery}`,
    );
    return { success: true, meta: serializeFolderMeta(row), galleryDirs };
  }

  /**
   * DELETE /api/folders/meta?path=&instanceId=
   * 删除属性行（仅 owner 本人或管理员）；行带 gallery 标记时顺带移出访客图库白名单。
   */
  @Delete('api/folders/meta')
  @UseGuards(ManageAuthGuard)
  async deleteFolderMeta(@Req() req: Request, @Query() q: Record<string, string>) {
    const path = normalizeFolderPath(q.path);
    if (!path) return { success: false, message: '缺少 path' };
    const row = await findFolderMeta(path, String(q.instanceId ?? ''));
    if (!row) return { success: false, message: '目录属性不存在' };
    const me = this.sessionUser(req);
    if (!this.sessionAdmin(req) && row.owner !== me) {
      return { success: false, message: '只有目录归属者或管理员可以删除目录属性' };
    }
    if (row.gallery) {
      try {
        await setGalleryPath(this.sysConfig, row.path, false);
      } catch {
        /* 白名单更新失败不阻塞删除 */
      }
    }
    await prisma.folderMeta.delete({ where: { id: row.id } });
    appLog.info('file', `目录属性已删除：${path}`, `owner=${row.owner}`);
    return { success: true };
  }

  /**
   * GET /api/folders/shared?instanceId=
   * 「共享给我的目录」列表：owner 是别人且当前用户在 sharedUsers 里。
   */
  @Get('api/folders/shared')
  @UseGuards(ManageAuthGuard)
  async sharedFolders(@Req() req: Request, @Query() q: Record<string, string>) {
    const list = await listSharedFoldersFor(this.sessionUser(req), String(q.instanceId ?? ''));
    return { success: true, data: list };
  }

  /**
   * GET /api/tags/manage?instanceId=&sort=createdAt|name|count&order=asc|desc
   * 当前实例（空 = 默认实例）下的全部标签，带 active 文件数与加密状态。
   * v1.0.2：改为「实例 + 类型」确权 —— 同实例内标签共享（owner 只作创建人展示）。
   */
  @Get('api/tags/manage')
  @UseGuards(ManageAuthGuard)
  async tagsManage(@Req() req: Request, @Query() q: Record<string, string>) {
    const instanceId = String(q.instanceId ?? '');
    const me = this.sessionUser(req);
    if (!me) return { success: true, data: [] };
    /*
     * v1.0.2：不再按 owner 收窄 —— 标签属于实例，实例内成员共用一套；
     * 用 type 区分用途（当前只有文件标签，后续内容系统接自己的 type）。
     */
    const tags = await prisma.tag.findMany({
      where: { instanceId, type: TAG_TYPE_FILE },
      orderBy: { createdAt: 'asc' },
    });
    // count：该标签下 status=active 的文件数（file_tags 关联 + 文件状态过滤）
    const links = await prisma.fileTag.findMany({
      where: { tagId: { in: tags.map((t) => t.id) } },
      select: { tagId: true, file: { select: { status: true } } },
    });
    const counts = new Map<string, number>();
    for (const l of links) {
      if ((l.file?.status || 'active') === 'active') counts.set(l.tagId, (counts.get(l.tagId) || 0) + 1);
    }
    const items = tags.map((t) => ({
      id: t.id,
      name: t.name,
      count: counts.get(t.id) || 0,
      encrypted: !!safeParse(t.metas).passwordHash,
      // v3.0.0：标签备注（存在 metas.note）
      note: String(safeParse(t.metas).note || ''),
      // v1.0.2：创建人（只作展示，不参与隔离）
      creator: t.owner || '',
      mine: String(t.owner || '') === me,
      createdAt: t.createdAt,
    }));
    const order = String(q.order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    const sort = String(q.sort || 'createdAt');
    items.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name) * order;
      if (sort === 'count') return (a.count - b.count) * order;
      return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * order;
    });
    return { success: true, data: items };
  }

  /**
   * PATCH /api/tags/:id  body: { name?, password? }
   * 改名（同实例内查重）或设置/清除密码（password 空串 = 清除，metas.passwordHash=sha256）。
   */
  @Patch('api/tags/:id')
  @UseGuards(ManageAuthGuard)
  async tagUpdate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { name?: string; password?: string; note?: string },
  ) {
    const tag = await prisma.tag.findUnique({ where: { id } });
    if (!tag) return { success: false, message: '标签不存在' };
    // v1.0.0：标签按 (用户 + 实例) 隔离 —— 先确认能进这个实例，再确认标签是自己的
    if (!(await this.canAccessInstance(req, tag.instanceId))) {
      return { success: false, message: '无权操作该实例下的标签' };
    }
    if (!this.canEditTag(req, tag)) return { success: false, message: '无权修改其他账户的标签' };
    const data: { name?: string; metas?: string } = {};
    if (body?.name !== undefined) {
      const name = String(body.name || '').trim();
      if (!name) return { success: false, message: '标签名不能为空' };
      if (name !== tag.name) {
        // v1.0.2：查重口径改成「同实例 + 同类型」
        const dup = await prisma.tag.findFirst({
          where: { name, instanceId: tag.instanceId, type: (tag as { type?: string }).type || TAG_TYPE_FILE, NOT: { id } },
        });
        if (dup) return { success: false, message: `同实例下已存在标签「${name}」` };
        data.name = name;
      }
    }
    // v3.0.0：标签备注（存在 metas.note，仅创建者可见）
    if (body?.note !== undefined) {
      const metas = safeParse(data.metas ? data.metas : tag.metas);
      const note = String(body.note || '').slice(0, 2000);
      if (note) metas.note = note;
      else delete metas.note;
      data.metas = JSON.stringify(metas);
    }
    if (body?.password !== undefined) {
      const metas = safeParse(data.metas ? data.metas : tag.metas);
      if (String(body.password || '')) metas.passwordHash = sha256Hex(String(body.password));
      else delete metas.passwordHash;
      data.metas = JSON.stringify(metas);
    }
    const updated = await prisma.tag.update({ where: { id }, data });
    appLog.info('file', `标签已更新：${tag.name} → ${updated.name}`, `加密=${!!safeParse(updated.metas).passwordHash}`);
    return {
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        encrypted: !!safeParse(updated.metas).passwordHash,
        note: String(safeParse(updated.metas).note || ''),
      },
    };
  }

  /**
   * DELETE /api/tags/:id —— 删标签并释放关联（file_tags 由外键 onDelete: Cascade 级联清理）。
   */
  @Delete('api/tags/:id')
  @UseGuards(ManageAuthGuard)
  async tagDelete(@Req() req: Request, @Param('id') id: string) {
    const tag = await prisma.tag.findUnique({ where: { id } });
    if (!tag) return { success: false, message: '标签不存在' };
    // v1.0.0：标签按 (用户 + 实例) 隔离 —— 先确认能进这个实例，再确认标签是自己的
    if (!(await this.canAccessInstance(req, tag.instanceId))) {
      return { success: false, message: '无权操作该实例下的标签' };
    }
    if (!this.canEditTag(req, tag)) return { success: false, message: '无权删除其他账户的标签' };
    await prisma.tag.delete({ where: { id } });
    appLog.info('file', `标签已删除：${tag.name}`, `实例=${tag.instanceId || '默认'}`);
    return { success: true };
  }

  /**
   * POST /api/tags/merge  body: { sourceIds: string[], targetName? , targetId? }
   * 把 sourceIds 全部关联的 file_tags 迁到目标标签（targetId 优先，否则按
   * targetName 在同一实例内找/建），随后删除 source 标签。
   */
  @Post('api/tags/merge')
  @UseGuards(ManageAuthGuard)
  async tagsMerge(
    @Req() req: Request,
    @Body() body: { sourceIds?: string[]; targetName?: string; targetId?: string },
  ) {
    const sourceIds = Array.isArray(body?.sourceIds) ? body.sourceIds.map(String).filter(Boolean) : [];
    if (!sourceIds.length) return { success: false, message: '缺少 sourceIds' };
    const sources = await prisma.tag.findMany({ where: { id: { in: sourceIds } } });
    if (!sources.length) return { success: false, message: '源标签不存在' };
    // v1.0.0：标签按用户隔离 —— 合并只允许在「自己名下」的标签之间进行
    if (sources.some((s) => !this.canEditTag(req, s))) {
      return { success: false, message: '无权合并其他账户的标签' };
    }
    const sourceIdSet = new Set(sources.map((s) => s.id));
    const instanceId = sources[0].instanceId;
    const owner = String(sources[0].owner || '');

    // 目标标签：targetId 优先；否则按 targetName 在同实例内找/建（复合唯一键 name_instanceId_owner）
    let target: { id: string; name: string } | null = null;
    if (body?.targetId) {
      const row = await prisma.tag.findUnique({ where: { id: String(body.targetId) } });
      if (row && this.canEditTag(req, row)) target = { id: row.id, name: row.name };
    }
    if (!target) {
      const name = String(body?.targetName || '').trim();
      if (!name) return { success: false, message: '缺少 targetId 或 targetName' };
      // v1.0.2：按「同实例 + 同类型」找/建，owner 只记创建人
      const row = await findOrCreateTag(name, instanceId, this.sessionUser(req), TAG_TYPE_FILE);
      target = { id: row.id, name: row.name };
    }
    if (sourceIdSet.has(target.id)) return { success: false, message: '目标标签不能同时是源标签' };

    // 迁移关联：目标上已存在的直接删源关联，否则改挂到目标
    let moved = 0;
    for (const sid of sourceIdSet) {
      const links = await prisma.fileTag.findMany({ where: { tagId: sid } });
      for (const link of links) {
        const exists = await prisma.fileTag.findUnique({
          where: { fileId_tagId: { fileId: link.fileId, tagId: target.id } },
        });
        if (exists) await prisma.fileTag.delete({ where: { id: link.id } });
        else {
          await prisma.fileTag.update({ where: { id: link.id }, data: { tagId: target.id } });
          moved += 1;
        }
      }
    }
    await prisma.tag.deleteMany({ where: { id: { in: Array.from(sourceIdSet) } } });
    appLog.info('file', `标签合并完成：${sourceIdSet.size} 个标签 → 「${target.name}」`, `迁移关联 ${moved} 条`);
    return { success: true, data: { moved, targetId: target.id, targetName: target.name } };
  }

  /**
   * v3.0.0 实例归属校验（标签 / 目录类接口共用）。
   *   · 空串 = 默认实例 —— 每个登录用户自己的初始空间，恒放行；
   *   · 非空实例 —— 创建者本人或 members 里的成员放行，管理员放行。
   */
  private async canAccessInstance(req: Request, instanceId: string): Promise<boolean> {
    if (this.sessionAdmin(req)) return true;
    // v1.0.1：判定逻辑抽到 common/instance-access，管理控制器的跨实例移动复用同一套
    return userInInstance(this.sessionUser(req), instanceId);
  }

  /**
   * v1.0.0 标签归属校验（标签类写操作共用）。
   *
   * 归属维度是 (owner, instanceId) 二元组 —— 每个用户在自己每个实例下各管各的标签：
   *   · owner 必须就是当前账户本人。**管理员也不再代管他人标签**，
   *     「标签管理」里每个人只看得到、也只动得了自己那份；
   *   · owner 为空串的是迁移前遗留的公共标签（回填后应已不存在），
   *     仍只允许管理员整理，避免普通用户误删老数据。
   * 实例维度由调用方配合 canAccessInstance() 校验（见 tagSplit）。
   */
  /**
   * v1.0.2：标签编辑权限。
   *
   * 旧的判定是「只能改自己 owner 的标签」—— 那是标签按用户隔离时代的规则。
   * 现在标签属于实例（instanceId + type + name 确权），实例内成员共用一套，
   * 因此「能进这个实例」就视为有权维护该实例的标签；creator 只用于展示。
   * 调用方（tagUpdate / tagDelete / tagMerge / tagSplit）都已先校验 canAccessInstance。
   */
  private canEditTag(req: Request, _tag: { owner?: string | null }): boolean {
    // 登录且能进该实例即可（实例校验在调用方完成）
    return !!this.sessionUser(req);
  }

  /**
   * POST /api/tags/:id/split  body: { names: string[] }
   *
   * v3.0.0「拆分标签」：把标签拆成一个或多个新标签，新标签关联的文件与被拆标签完全相同
   * （复制 file_tags 关联），原标签保持不变。
   *   · names 去空、去重，并剔除与原标签同名的项（同名等于没拆出来新标签）；
   *   · 同实例内已存在的同名标签直接复用，不重复创建；
   *   · 只能拆「自己实例」下的标签（instanceId 空串 = 默认实例）；标签不存在 → 404。
   * 返回 { success, created:[{id,name}], linked }（linked = 本次实际新建的关联条数）。
   */
  @Post('api/tags/:id/split')
  @UseGuards(ManageAuthGuard)
  async tagSplit(@Req() req: Request, @Param('id') id: string, @Body() body: { names?: string[] }) {
    const tag = await prisma.tag.findUnique({ where: { id: String(id || '') } });
    if (!tag) throw new NotFoundException('标签不存在');
    if (!(await this.canAccessInstance(req, tag.instanceId))) {
      throw new ForbiddenException('无权操作该实例下的标签');
    }
    // v1.0.0：拆分只允许在自己名下的标签上做（拆分产物同样归自己）
    if (!this.canEditTag(req, tag)) throw new ForbiddenException('无权拆分其他账户的标签');
    const owner = String(tag.owner || '');
    const raw = Array.isArray(body?.names) ? body.names : [];
    const names = Array.from(
      new Set(
        raw
          .map((n) => String(n ?? '').trim())
          .filter(Boolean)
          // 与原标签同名无意义（本身已存在且关联一致）
          .filter((n) => n !== tag.name),
      ),
    );
    if (!names.length) throw new BadRequestException('names 不能为空');

    // 被拆标签当前关联的文件（file_tags）
    const links = await prisma.fileTag.findMany({ where: { tagId: tag.id }, select: { fileId: true } });
    const created: { id: string; name: string }[] = [];
    let linked = 0;
    for (const name of names) {
      // v1.0.2：按「同实例 + 同类型」找/建（同名已存在则复用，不再按 owner 区分）
      const target = await findOrCreateTag(name, tag.instanceId, owner, TAG_TYPE_FILE);
      created.push({ id: target.id, name: target.name });
      if (links.length) {
        const res = await prisma.fileTag.createMany({
          data: links.map((l) => ({ fileId: l.fileId, tagId: target.id })),
          skipDuplicates: true,
        });
        linked += res.count;
      }
    }
    appLog.info(
      'tag',
      `拆分标签 ${tag.name} → ${created.map((c) => c.name).join('、')}`,
      `复制关联 ${linked} 条（源标签 ${links.length} 条 / 实例=${tag.instanceId || '默认'}）`,
    );
    return { success: true, created, linked };
  }

  /**
   * POST /api/tags/batch-password  body: { ids: string[], password }
   * 批量设置标签密码；password 空串 = 清除。
   */
  @Post('api/tags/batch-password')
  @UseGuards(ManageAuthGuard)
  async tagsBatchPassword(@Req() req: Request, @Body() body: { ids?: string[]; password?: string }) {
    const ids = Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (!ids.length) return { success: false, message: '缺少 ids' };
    let updated = 0;
    for (const id of ids) {
      const tag = await prisma.tag.findUnique({ where: { id } });
      if (!tag) continue;
      // v1.0.0：标签按用户隔离 —— 跳过不属于当前账户的标签
      if (!this.canEditTag(req, tag)) continue;
      const metas = safeParse(tag.metas);
      if (String(body?.password || '')) metas.passwordHash = sha256Hex(String(body.password));
      else delete metas.passwordHash;
      await prisma.tag.update({ where: { id }, data: { metas: JSON.stringify(metas) } });
      updated += 1;
    }
    appLog.info('file', `批量设置标签密码：${updated} 个`, String(body?.password || '') ? '设置' : '清除');
    return { success: true, data: { updated } };
  }
}

/**
 * 管理接口 —— 兼容前端 /api/manage/* 契约的核心子集。
 *
 * 权限模型（用户账户体系）：
 *   - 类级用 ManageAuthGuard：管理员与普通用户都可进入；
 *   - 普通用户只能看到/操作 `uploader === 自身用户名` 的文件与文件夹；
 *   - 系统级接口（统计/日志/设置/黑白名单/渠道/用户）用方法级 @UseGuards(AdminGuard) 兜住。
 */
@Controller('api/manage')
@UseGuards(ManageAuthGuard)
export class ManageController {
  constructor(
    private settings: SettingsService,
    private sysConfig: SysConfigService,
    private channelsSvc: ChannelsService,
    private uploadSvc: UploadService,
    private storageChannel: StorageChannelService,
  ) {}

  /** 当前会话是否管理员 */
  private admin(req: Request): boolean {
    return isAdminRole(currentSession(req)?.role);
  }

  /**
   * 把入参 fileIds 收敛为「当前用户有权操作」的子集。
   *
   * v1.0.3：**管理员不再豁免** —— 文件管理里每个账户（含管理员）只能看到、只能操作
   * 自己 uploader 名下的文件；跨账户的文件共享走「目录共享 / 对外分享」，不走管理端。
   */
  private async filterOwned(fileIds: string[], req: Request): Promise<string[]> {
    const user = currentSession(req)?.user || '';
    const rows = await prisma.fileRecord.findMany({
      where: { uploader: user, OR: [{ id: { in: fileIds } }, { name: { in: fileIds } }] },
      select: { id: true, name: true },
    });
    const ok = new Set<string>();
    for (const r of rows) {
      ok.add(r.id);
      ok.add(r.name);
    }
    return fileIds.filter((f) => ok.has(f));
  }

  /**
   * v3.0.0（R8）：评级筛选参数解析 —— 缺省 / 空串 / 非法 = null（该侧不限）；
   * 合法值收敛到 [0, max]。「未评分 / 未设等级」= 前端传 0 与 0（正好等于 0）。
   */
  private numOrNullParam(raw: unknown, max: number): number | null {
    if (raw === undefined || raw === null || String(raw) === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(max, n));
  }

  /**
   * v3.0.0（R12）：剔除「别人共享给我、且权限为只读」目录内的文件。
   *
   * 共享权限在「文件夹属性」里由归属者设定；接收方（普通用户）在只读目录内
   * 即使上传了自己的文件，也不能批量改名 / 限时 / 重定向 / 加密 / 移动 ——
   * 这些操作都会改变归属者目录下的内容呈现。删除另有独立守卫（见 remove()）。
   *
   * 返回 { ok, denied }：ok 为放行记录，denied 为被拦下的 File_ID / name（写日志用）。
   */
  private async dropReadonlyShared<T extends { name?: string; folder?: string | null; instanceId?: string | null }>(
    rows: T[],
    req: Request,
  ): Promise<{ ok: T[]; denied: string[] }> {
    const me = currentSession(req)?.user || '';
    if (!rows.length || !me) return { ok: rows, denied: [] };
    const cache = new Map<string, boolean>();
    const ok: T[] = [];
    const denied: string[] = [];
    for (const r of rows) {
      const folder = String(r.folder || '');
      const key = `${r.instanceId || ''}\u0000${folder}`;
      let readonly = cache.get(key);
      if (readonly === undefined) {
        const info = folder
          ? await folderSharedPermission(folder, r.instanceId || '', me)
          : { shared: false, owner: '', perm: 'edit' as const };
        readonly = info.shared && info.perm === 'readonly';
        cache.set(key, readonly);
      }
      if (readonly) denied.push(String(r.name || '').replace(/\.[^.]*$/, ''));
      else ok.push(r);
    }
    if (denied.length) {
      appLog.warn(
        'file',
        `批量操作已拦截（只读共享目录）：${denied.slice(0, 5).join(', ')}${denied.length > 5 ? ' …' : ''}`,
        `共 ${denied.length} 个文件位于别人共享给当前用户（${me}）的只读目录内`,
      );
    }
    return { ok, denied };
  }

  /** 普通用户是否有权编辑 / 删除文件（管理员恒为 true） */
  private async userPerm(req: Request, kind: 'edit' | 'delete'): Promise<boolean> {
    if (this.admin(req)) return true;
    const s = currentSession(req);
    if (!s) return false;
    const u = await prisma.user.findUnique({ where: { username: s.user } });
    if (!u || !u.enabled) return false;
    return kind === 'edit' ? u.canEdit : u.canDelete;
  }

  /**
   * v3.0.0「用户共享」筛选 —— 按 shareScope 取出目录清单（{ path, owner }）。
   *
   *   tome（共享给我的）：owner 不是当前用户、且 sharedUsers 含当前用户；
   *   mine（我共享的）  ：owner 是当前用户、且 sharedUsers 非空。
   *
   * sharedUsers 是 JSON 数组字符串，先用 `not: '[]'` 粗筛，再在内存里 parse 精确判断
   * （数据量是「某用户的目录数」量级，完全可控）。instanceId 空串 = 默认实例。
   * 返回结果按路径去重排序，供调用方拼 folder 前缀 OR 条件。
   */
  private async sharedScopeDirs(
    scope: 'mine' | 'tome',
    username: string,
    instanceId: string,
  ): Promise<{ path: string; owner: string }[]> {
    const user = String(username || '').trim();
    if (!user) return [];
    const rows = await prisma.folderMeta.findMany({
      where: {
        type: FOLDER_TYPE_FILE,
        ...(String(instanceId) === '*' ? {} : { instanceId: instanceId || '' }),
        sharedUsers: { not: '[]' },
      },
      select: { path: true, owner: true, sharedUsers: true },
    });
    const seen = new Set<string>();
    const out: { path: string; owner: string }[] = [];
    for (const r of rows) {
      const path = String(r.path || '').replace(/^\/+|\/+$/g, '');
      if (!path) continue;
      const shared = parseSharedUsers(r.sharedUsers);
      if (!shared.length) continue;
      const owner = String(r.owner || '');
      const hit =
        scope === 'tome'
          ? !!owner && owner !== user && shared.includes(user)
          : owner === user;
      const key = `${owner}\u0000${path}`;
      if (!hit || seen.has(key)) continue;
      seen.add(key);
      out.push({ path, owner });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * 文件列表 —— 严格对齐 Sanyue-ImgHub 契约：
   *   入参：dir / search / recursive / start / count / sum / includeTags / excludeTags
   *         以及筛选 listType / fileType / channel / channelName / label / accessStatus
   *   出参：{ files:[{name,metadata}], directories, totalCount, directFileCount,
   *          directFolderCount, returnedCount, indexLastUpdated, isIndexedResponse }
   */
  /**
   * v3.0.0 修复「同时(all)」模式失效：
   * 旧实现把同一分区的多个选中值压缩成【一个】布尔（分区内 OR）——
   * 前端 FilterDialog 的 draftCount 却把每个勾选值都算作独立条件，
   * 并承诺「同时 = 全部条件取交集」。于是「同时」模式勾选 图片+视频 得到的是
   * 两者的并集（分区内的 OR 把交集语义吃掉了）—— 这正是 bug 根因。
   * 修法：filterGroups 增加 matchMode 入参 ——
   *   · matchMode = all（同时）：每个选中值各自成为一个独立条件（AND 语义）；
   *   · matchMode = any（任意）：保持旧行为，分区内命中任一值即算（OR）。
   * 互斥维度（如 图片+视频）在「同时」模式下交集为空属预期行为（与前端提示一致）。
   */
  private filterGroups(
    r: any,
    f: {
      hasTags: string;
      filterTags: string[];
      tagMode: string;
      listType: string[];
      label: string[];
      fileType: string[];
      channel: string[];
      channelName: string[];
      uploadSource: string[];
      backup: string[];
      redirect: string[];
      access: string[];
      validity: string[];
      nameChanged: string[];
      users: string[];
      fromMs: number;
      toMs: number;
      sizeMin: number;
      sizeMax: number;
      sizeMode: string;
      /** v3.0.0（R8）：评级筛选（评分 0-5 半星步进 / 等级 0-5）—— absent = 不限 */
      ratingMin: number | null;
      ratingMax: number | null;
      levelMin: number | null;
      levelMax: number | null;
      dimPreset: string[];
      widthMin: number;
      widthMax: number;
      heightMin: number;
      heightMax: number;
    },
    matchMode: 'all' | 'any' = 'all',
  ): boolean[] {
    const groups: boolean[] = [];
    /**
     * 多值分区的统一出口：
     *   同时(all) → 逐值独立成条件（每个值都必须命中，AND）；
     *   任意(any) → 分区一个条件，命中任一值即可（OR，旧行为）。
     */
    const pushGroup = (values: string[], pred: (v: string) => boolean) => {
      if (matchMode === 'all') values.forEach((v) => groups.push(pred(v)));
      else groups.push(values.some((v) => pred(v)));
    };

    const tagNames: string[] = Array.isArray(r.tags) ? r.tags.map((t: any) => t?.tag?.name).filter(Boolean) : [];
    if (f.hasTags === 'yes') groups.push(tagNames.length > 0);
    else if (f.hasTags === 'no') groups.push(tagNames.length === 0);
    // 标签筛选有自己的「或/且」开关（tagMode），不参与这里的逐值拆分
    if (f.filterTags.length) {
      groups.push(
        f.tagMode === 'or'
          ? f.filterTags.some((t) => tagNames.includes(t))
          : f.filterTags.every((t) => tagNames.includes(t)),
      );
    }

    const metas = safeParse(r.metas);
    const listType = (metas.ListType as string) || 'None';
    const label = (metas.Label as string) || 'None';
    pushGroup(f.listType, (v) => v === listType);
    pushGroup(f.label, (v) => v === label);
    pushGroup(f.fileType, (v) => v === fileTypeOf(r.mime));

    const copies: any[] = Array.isArray(r.copies) ? r.copies : [];
    // v1.0.4：统一口径 —— 先认 fileCopy.isPrimary（转存后指向新渠道），再回退渠道 isMain
    const primary = pickPrimaryCopy(copies);
    const chType = primary?.channel?.type || '';
    const chLabel = chType ? CHANNEL_LABEL[chType] || chType : '';
    const chName = String(primary?.channel?.name || '');
    pushGroup(f.channel, (v) => v === chLabel);
    pushGroup(f.channelName, (v) => v === chName);
    // v3.0.0：上传渠道筛选新增「登记文件 (Record)」—— normalizeUploadSource 本就把
    // 'Record' 规范化为合法值（UPLOAD_SOURCES 白名单含 Record），这里无需特判
    pushGroup(f.uploadSource, (v) => v === normalizeUploadSource(r.uploadSource));
    pushGroup(f.users, (v) => v === String(r.uploader || ''));

    if (f.backup.length) {
      const hasBackup = copies.some((c) => c !== primary && c?.status === 'active' && (c?.remoteKey || c?.remoteUrl));
      pushGroup(f.backup, (v) => (v === 'backedup' ? hasBackup : !hasBackup));
    }

    if (f.redirect.length) {
      const has = !!r.redirectUrl;
      pushGroup(f.redirect, (v) => (v === 'yes' ? has : !has));
    }

    if (f.access.length) {
      // v2.9.0：已删除（回收站）—— 列表接口按 status='deleted' 取数后同样走这里判定
      const deleted = String(r.status || 'active') === 'deleted';
      /*
       * v3.0.0：已加密 —— metas.AccessPasswordHash 必须是「非空字符串」才算，
       * 库级粗筛只会命中出现该键的行，"AccessPasswordHash":"" 在这一步被排除。
       */
      const encrypted = !!String(metas.AccessPasswordHash || '').trim();
      pushGroup(f.access, (v) =>
        (v === 'encrypted' && encrypted) ||
        (v === 'deleted' && deleted) ||
        (!deleted && v === 'normal' && listType === 'None') ||
        (!deleted && v === 'block' && listType === 'Block') ||
        (!deleted && v === 'white' && listType === 'White'),
      );
    }

    if (f.fromMs || f.toMs) {
      const t = r.createdAt ? new Date(r.createdAt).getTime() : 0;
      groups.push(!!t && (!f.fromMs || t >= f.fromMs) && (!f.toMs || t <= f.toMs));
    }

    if (f.sizeMin > 0 || f.sizeMax > 0 || f.sizeMode === 'original') {
      const cmpSize =
        f.sizeMode === 'original' ? Number(r.originalSize) || r.size || 0 : r.size || 0;
      groups.push(
        (!f.sizeMin || cmpSize >= f.sizeMin) && (!f.sizeMax || cmpSize <= f.sizeMax),
      );
    }

    /*
     * v3.0.0（R8）：评级筛选 ——
     *   ratingMin/Max：null = 该侧不限；「未评分」= 0/0（评分必须等于 0）。
     *   levelMin/Max 同理（「未设等级」= 0/0）。
     */
    if (f.ratingMin !== null || f.ratingMax !== null || f.levelMin !== null || f.levelMax !== null) {
      const rating = Number((r as unknown as { rating?: number }).rating) || 0;
      const level = Number((r as unknown as { level?: number }).level) || 0;
      groups.push(
        (f.ratingMin === null || rating >= f.ratingMin) &&
        (f.ratingMax === null || rating <= f.ratingMax) &&
        (f.levelMin === null || level >= f.levelMin) &&
        (f.levelMax === null || level <= f.levelMax),
      );
    }

    if (f.validity.length) {
      const exp = r.linkExpiresAt as Date | null | undefined;
      const expMs = exp ? new Date(exp).getTime() : 0;
      const now = Date.now();
      pushGroup(f.validity, (v) =>
        (v === 'limited' && expMs > now) ||
        (v === 'expired' && expMs > 0 && expMs <= now) ||
        (v === 'permanent' && !expMs),
      );
    }

    if (f.nameChanged.length) {
      const renamed = !!String(r.prevName || '');
      pushGroup(f.nameChanged, (v) => (v === 'changed' ? renamed : !renamed));
    }

    if (f.dimPreset.length || f.widthMin || f.widthMax || f.heightMin || f.heightMax) {
      const w = Number((metas.Width as number) || 0);
      const h = Number((metas.Height as number) || 0);
      if (!w || !h) {
        groups.push(false);
      } else {
        const okRange =
          (!f.widthMin || w >= f.widthMin) && (!f.widthMax || w <= f.widthMax) &&
          (!f.heightMin || h >= f.heightMin) && (!f.heightMax || h <= f.heightMax);
        const okPreset = !f.dimPreset.length || f.dimPreset.some((p) => this.matchDimPreset(w, h, p));
        groups.push(okRange && okPreset);
      }
    }

    return groups;
  }

  /** 尺寸快捷选项匹配：宽高不分横竖（横屏/竖屏都能命中），分辨率档位按「短边」分桶 */
  private matchDimPreset(w: number, h: number, preset: string): boolean {
    if (!w || !h) return false;
    const short = Math.min(w, h);
    const long = Math.max(w, h);
    const ratio = long / Math.max(1, short);
    switch (preset) {
      case 'landscape':
        return w > h;
      case 'portrait':
        return h > w;
      case 'square':
        return Math.abs(w - h) <= Math.max(2, Math.round(long * 0.01));
      case 'ratio-4-3':
        return Math.abs(ratio - 4 / 3) <= 0.06;
      case 'ratio-16-9':
        return Math.abs(ratio - 16 / 9) <= 0.08;
      case '360p':
        return short >= 300 && short < 420;
      case '480p':
        return short >= 420 && short < 600;
      case '720p':
        return short >= 600 && short < 840;
      case '1080p':
        return short >= 840 && short < 1300;
      case '2k':
        return short >= 1300 && short < 1800;
      case '4k':
        return short >= 1800 && short < 2600;
      case '8k':
        return short >= 4000;
      default:
        return false;
    }
  }

  @Get('list')
  async list(@Req() req: Request, @Query() q: Record<string, string>) {
    // 「系统状态」页以 action=info 复用本路由，返回索引统计而非文件列表（仅管理员）
    if (q.action === 'info') {
      if (!this.admin(req)) return { forbidden: true, totalFiles: 0, channelStats: {}, typeStats: {}, uploadSourceStats: {}, mimeStats: {}, uploadTrend: { labels: [], total: [], groupBy: {} } };
      return this.indexInfo(q);
    }

    const session = currentSession(req);
    /*
     * 归属过滤（v1.0.3）：
     *   每个账户（含管理员）只列出自己 uploader 名下的文件。
     *   旧实现里管理员不传 ?user= 时 ownerFilter 为空串 = 全库可见，
     *   于是「管理员在文件管理里能看到并操作别人文件」——
     *   这是本次修复的核心：数据面一律按登录账户收窄，跨账户只能通过共享 / 对外分享。
     *   ?user= 参数保留但只允许等于自己（老前端 / 老书签不会报错）。
     */
    const ownerFilter = String(q.user || '') && q.user !== 'all' && String(q.user) === String(session?.user || '')
      ? String(q.user)
      : session?.user || '';
    const recursive = q.recursive === 'true';
    const dir = normalizeDir(q.dir);
    const search = (q.search || '').trim().toLowerCase();
    // 搜索类型：all(默认) | title 标题 | tag 标签 | category 分类 | user 用户 | note 备注 | other 其他
    const searchType = (q.searchType || 'all').toLowerCase();
    let count = q.count === undefined ? 50 : Number(q.count);
    if (Number.isNaN(count)) count = 50;
    const start = Math.max(0, Number(q.start || 0) || 0);
    const sumOnly = count === -1 && q.sum === 'true';

    const includeTags = splitCsv(q.includeTags);
    const excludeTags = splitCsv(q.excludeTags);
    // 「标签筛选」弹窗选中的标签：tagMode=or 命中任一即算，and（默认）必须全部命中
    // 与搜索里的 #tag（includeTags，恒为 and 语义）分开传参，避免同名参数互相覆盖。
    const filterTags = splitCsv(q.filterTags);
    const tagMode = String(q.tagMode || 'and').toLowerCase() === 'or' ? 'or' : 'and';
    // 是否含标签：yes = 只看有标签的文件，no = 只看没有标签的文件
    const hasTags = String(q.hasTags || '').toLowerCase();
    const fListType = splitCsv(q.listType);
    const fAccess = splitCsv(q.accessStatus);
    /*
     * v3.0.0「已加密」筛选：encryptedOnly=1 / true 与 accessStatus=encrypted 等价，二者都认
     * （同时传只算一个条件）。入列后与其他访问状态选项一样走 filterGroups 的 access 分区，
     * 因此与分页 / 其它筛选天然叠加，totalCount 口径一致。
     */
    if (q.encryptedOnly === '1' || q.encryptedOnly === 'true') {
      if (!fAccess.includes('encrypted')) fAccess.push('encrypted');
    }
    const encryptedOnly = fAccess.includes('encrypted');
    const fLabel = splitCsv(q.label);
    const fFileType = splitCsv(q.fileType);
    const fChannel = splitCsv(q.channel);
    const fChannelName = splitCsv(q.channelName);
    // v2.7.0：上传渠道筛选（Default / WebDAV / API-Web / API-S3）
    const fUploadSource = splitCsv(q.uploadSource).map((s) => normalizeUploadSource(s));
    const fBackup = splitCsv(q.backup);
    const fRedirect = splitCsv(q.redirect);

    /*
     * v2.8.7：日期 / 大小范围筛选（与搜索、搜索类型、用户、回收站状态、其余筛选条件
     * 全部一起做联合过滤 —— 有值的条件同时生效，返回满足全部条件的交集）。
     * 日期按「上传日期 createdAt」，前端传 YYYY-MM-DD（两端都含当天）；
     * tz = 浏览器 getTimezoneOffset()（分钟），按用户本地时区切当天边界，
     * 避免「今天 / 本周」在 UTC 容器里被切成前一天的 16:00。
     */
    const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(q.dateFrom || '')) ? String(q.dateFrom) : '';
    const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(q.dateTo || '')) ? String(q.dateTo) : '';
    const tzMin = Number(q.tz);
    const tzOffset = Number.isFinite(tzMin) ? Math.max(-840, Math.min(840, tzMin)) : 0;
    const dayStartMs = (date: string) => {
      const [y, m, d] = date.split('-').map(Number);
      // getTimezoneOffset() 为「本地 = UTC - offset」：东八区返回 -480，
      // 本地当天 00:00 的真实时刻 = Date.UTC(...) + offset 分钟
      return Date.UTC(y, m - 1, d) + tzOffset * 60_000;
    };
    const fromMs = dateFrom ? dayStartMs(dateFrom) : 0;
    const toMs = dateTo ? dayStartMs(dateTo) + 86_400_000 - 1 : 0;
    const sizeMin = Math.max(0, Number(q.sizeMin) || 0);
    const sizeMax = Math.max(0, Number(q.sizeMax) || 0);
    /*
     * v2.8.9 新增筛选：
     *   validity    —— 有效期：limited（已限时未过期）/ expired（已过期）/ permanent（永久有效）
     *   nameChanged —— 名称状态：changed（已改名，prevName 非空）/ unchanged（未改名）
     *   sizeMode    —— 大小口径：actual（当前大小，默认）/ original（压缩前大小）
     *   dimPreset   —— 尺寸快捷：landscape/portrait/square/ratio-4-3/ratio-16-9/360p…8k
     *   widthMin/Max、heightMin/Max —— 自定义宽高范围（像素）
     */
    const fValidity = splitCsv(q.validity).map((v) => v.toLowerCase());
    const fNameChanged = splitCsv(q.nameChanged).map((v) => v.toLowerCase());
    const sizeMode = String(q.sizeMode || 'actual').toLowerCase() === 'original' ? 'original' : 'actual';
    const fDimPreset = splitCsv(q.dimPreset).map((v) => v.toLowerCase());
    const widthMin = Math.max(0, Number(q.widthMin) || 0);
    const widthMax = Math.max(0, Number(q.widthMax) || 0);
    const heightMin = Math.max(0, Number(q.heightMin) || 0);
    const heightMax = Math.max(0, Number(q.heightMax) || 0);
    /*
     * v3.0.0（R8）：评级筛选解析 —— 参数缺省 / 空串 = 该侧不限（null）；
     * 「未评分 / 未设等级」= 前端传 0 与 0（要求正好等于 0）。
     */
    const numOrNull = (raw: unknown, max: number): number | null => {
      if (raw === undefined || raw === null || String(raw) === '') return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return Math.max(0, Math.min(max, n));
    };
    const ratingMin = numOrNull(q.ratingMin, 5);
    const ratingMax = numOrNull(q.ratingMax, 5);
    const levelMin = numOrNull(q.levelMin, 5);
    const levelMax = numOrNull(q.levelMax, 5);

    /*
     * v2.9.0：「筛选」弹窗新增两项能力
     *   · matchMode = all（同时，默认）/ any（任意）—— 决定各「分区」之间如何组合，
     *     分区内部仍是「或」（同一分区勾多个值命中任一即可）；
     *   · 访问状态含 deleted 时，把回收站记录（status='deleted'）一起取出来，
     *     供「已删除」选项筛选回收站文件。
     * v3.0.0：matchMode 兼容 'and'/'or' 写法（and→all 同时，or→any 任意），
     *         并把 matchMode 传给 filterGroups 实现「同时」模式下逐值 AND。
     */
    const matchModeRaw = String(q.matchMode || '').toLowerCase();
    const matchMode: 'all' | 'any' = matchModeRaw === 'any' || matchModeRaw === 'or' ? 'any' : 'all';
    const fUsers = splitCsv(q.filterUsers);
    const withDeleted = fAccess.includes('deleted');
    const filterOpts = {
      hasTags,
      filterTags,
      tagMode,
      listType: fListType,
      label: fLabel,
      fileType: fFileType,
      channel: fChannel,
      channelName: fChannelName,
      uploadSource: fUploadSource,
      backup: fBackup,
      redirect: fRedirect,
      access: fAccess,
      validity: fValidity,
      nameChanged: fNameChanged,
      users: fUsers,
      fromMs,
      toMs,
      sizeMin,
      sizeMax,
      sizeMode,
      ratingMin,
      ratingMax,
      levelMin,
      levelMax,
      dimPreset: fDimPreset,
      widthMin,
      widthMax,
      heightMin,
      heightMax,
    };

    /*
     * v3.0.0 多实例隔离：query.instanceId 空【串】或不传 = 默认实例（instanceId=''），
     * 前端切实例后永远带 instanceId 参数（含空串），因此这里绝不「不过滤」。
     * v3.0.0（R5）：新增 `*` = 全部实例（历史记录页的「全部实例」选项），此时不加实例条件。
     */
    const rawInstance = String(q.instanceId ?? '');
    const allInstances = rawInstance === '*';
    const instanceFilter = allInstances ? '' : rawInstance;

    /*
     * v3.0.0 共享范围筛选（shareScope）——「用户共享」视图：
     *   mine —— 我共享出去的：我名下 FolderMeta 且 sharedUsers 非空（即为共享状态）的目录；
     *   tome —— 共享给我的：他人名下 FolderMeta 且 sharedUsers 含我 的目录；
     *   空串 / 其它值 = 不筛（完全保持原有行为）。
     * 两种范围都取「目录本身 + 全部子目录」下的文件，并与 instanceId / 搜索 / 其它筛选叠加，
     * 分页语义（start / count / totalCount）不变。
     */
    const shareScope: '' | 'mine' | 'tome' =
      q.shareScope === 'mine' || q.shareScope === 'tome' ? q.shareScope : '';
    const shareDirs: { path: string; owner: string }[] = shareScope
      ? await this.sharedScopeDirs(shareScope, session?.user || '', allInstances ? '*' : instanceFilter)
      : [];
    /** 共享目录 → folder 的 OR 条件（目录本身 + 以「目录/」开头的全部子目录） */
    const shareFolderOr = shareDirs.flatMap((d) => [
      { folder: d.path },
      { folder: { startsWith: `${d.path}/` } },
    ]);

    const rows = await prisma.fileRecord.findMany({
      where: {
        status: withDeleted ? { in: ['active', 'deleted'] } : 'active',
        // v3.0.0（R5）：全部实例（instanceId=*）时不加实例条件
        ...(allInstances ? {} : { instanceId: instanceFilter }),
        // 共享范围生效时由 folder 前缀决定取数范围，不再按 uploader 收窄（共享目录里可能有成员文件）
        ...(ownerFilter && !shareScope ? { uploader: ownerFilter } : {}),
        /*
         * v3.0.0「已加密」筛选：先用 metas 里出现的 AccessPasswordHash 做库级粗筛，
         * 值是否为空串由 matched 阶段的 filterGroups 二次校验（避免误伤 "AccessPasswordHash":""）。
         */
        ...(encryptedOnly ? { metas: { contains: '"AccessPasswordHash"' } } : {}),
        // 没有符合条件的共享目录 → 恒假条件（空集），绝不退化成「不过滤」
        ...(shareScope
          ? shareFolderOr.length
            ? { OR: shareFolderOr }
            : { folder: { in: [] as string[] } }
          : {}),
      },
      include: {
        copies: { include: { channel: true } },
        tags: { include: { tag: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    /*
     * v3.0.0（第三轮）：取消「共享目录自动并入列表」。
     * 原实现会把共享给当前用户的目录下的文件直接塞进普通列表（不筛也能看到），
     * 与用户要求不符：被共享内容必须经「筛选 → 共享给我的」才加载。
     * 现在这里只准备「共享给我的目录清单」，用于给命中结果打「共享」标识
     * （前端卡片右下角 / 列表渠道简称后展示）；取数范围完全由 shareScope 决定。
     */
    /*
     * v3.0.0：「共享」标识要对**所有可查看共享内容的用户**展示 ——
     *   ① 别人共享给我的目录（tome）；
     *   ② 我共享出去的目录（mine）—— 共享者自己也要看到标识，否则无法确认共享是否生效。
     * 标识与 shareScope 筛选解耦：筛选只决定「取哪些行」，标识恒按可查看的共享目录全集计算。
     */
    /*
     * v3.0.0（R8）：sharedMark 每项带上 sharedPerm ——
     *   · toMe（别人共享给我的）→ 该条共享的权限（edit / readonly）；
     *   · byMe（我共享出去的）→ 我自己是归属者，恒为 edit（完整控制）。
     * 去重时 byMe 优先（先入列），保证「自己名下又恰好被别人共享的路径」按归属者处理。
     */
    const sharedMark: { path: string; owner: string; sharedPerm: 'edit' | 'readonly' }[] = [];
    if (session?.user) {
      // v3.0.0（R7）：'*' = 全部实例 —— 共享标识不能因为切了「全部实例」就消失
      const markInstance = allInstances ? '*' : instanceFilter;
      const [toMe, byMe] = await Promise.all([
        listSharedFoldersFor(session.user, markInstance),
        listFoldersSharedBy(session.user, markInstance),
      ]);
      const seenMark = new Set<string>();
      for (const d of [
        ...byMe.map((x) => ({ ...x, sharedPerm: 'edit' as const })),
        ...toMe,
      ]) {
        const key = `${d.path}\u0000${d.owner}`;
        if (seenMark.has(key)) continue;
        seenMark.add(key);
        sharedMark.push({ path: d.path, owner: d.owner, sharedPerm: d.sharedPerm });
      }
    }
    /**
     * 文件是否落在「共享目录」内 → 返回 { owner, self }（null = 不是共享文件）
     *
     * v3.0.0（第四轮）：取消「uploader 必须等于目录归属者」的限制。
     * 原实现只给「归属者自己上传的文件」打标，导致：
     *   · 接收方看不到别人目录里其他成员上传的文件；
     *   · 发起方自己看到的提示是「由我共享给你」（自己共享给自己）。
     * 现在按目录归属判断：owner === 当前用户 = 我共享出去的（前端显示「你的共享文件」），
     * 否则 = 别人共享给我的（前端显示「由 {owner} 共享给你」）。
     */
    const sharedInfoOf = (r: { folder?: string | null }): { owner: string; self: boolean; perm: 'edit' | 'readonly' } | null => {
      const f = r.folder || '';
      const hit = sharedMark.find((d) => f === d.path || f.startsWith(`${d.path}/`));
      if (!hit) return null;
      return { owner: hit.owner, self: hit.owner === session?.user, perm: hit.sharedPerm };
    };

    const allFolders = new Set(rows.map((r) => r.folder).filter(Boolean) as string[]);
    /*
     * v3.0.0：按 folder 字符串逐级补齐中间目录节点。
     * 典型场景：「登记文件」创建的记录只落在最深层（如 "登记文件/2026/10"），
     * 中间目录（"登记文件"、"登记文件/2026"）没有独立行 —— 不补齐的话
     * 目录树统计不出这些中间目录的子文件夹数量。
     */
    for (const f of Array.from(allFolders)) {
      const segs = String(f).split('/').filter(Boolean);
      for (let i = 1; i < segs.length; i++) allFolders.add(segs.slice(0, i).join('/'));
    }
    // 合并「已新建但暂无文件」的空目录（文件管理左上角「新建目录」登记的逻辑目录）
    // v3.0.0：shareScope 生效时这些登记目录不属于共享范围，不参与聚合
    // v1.0.0：登记目录按「账户 + 实例」隔离，这里必须带上当前实例（'*' = 全部实例合并）
    for (const d of shareScope ? [] : await this.extraFolders(req, allInstances ? '*' : instanceFilter)) allFolders.add(d);

    const matched = rows.filter((r) => {
      /* ---------- 搜索 / 标签搜索：不属于弹窗筛选，恒为 AND ---------- */
      if (search) {
        const tagNames = r.tags.map((t) => t.tag.name).join(',').toLowerCase();
        const mime = (r.mime || '').toLowerCase();
        const dirName = (r.folder || '').toLowerCase();
        const hit =
          searchType === 'title'
            ? r.originalName.toLowerCase().includes(search) || r.name.toLowerCase().includes(search)
            : searchType === 'tag'
              ? tagNames.includes(search)
              : searchType === 'category'
                ? dirName.includes(search)
                : searchType === 'user'
                  ? (r.uploader || '').toLowerCase().includes(search)
                  : searchType === 'note'
                    ? (r.note || '').toLowerCase().includes(search)
                    : searchType === 'other'
                      ? (r.md5 || '').toLowerCase().includes(search) ||
                        mime.includes(search) ||
                        (r.ip || '').includes(search)
                      : // all：文件名 / 文件ID / 链接 / 分类 / 标签 / md5 / 类型 / 用户 / 备注
                        r.originalName.toLowerCase().includes(search) ||
                        r.name.toLowerCase().includes(search) ||
                        (r.md5 || '').toLowerCase().includes(search) ||
                        dirName.includes(search) ||
                        tagNames.includes(search) ||
                        mime.includes(search) ||
                        (r.uploader || '').toLowerCase().includes(search) ||
                        (r.note || '').toLowerCase().includes(search);
        if (!hit) return false;
      }
      if (includeTags.length && !includeTags.every((t) => r.tags.map((x) => x.tag.name).includes(t))) return false;
      if (excludeTags.length && excludeTags.some((t) => r.tags.map((x) => x.tag.name).includes(t))) return false;

      /* ---------- 弹窗筛选：分区求值 → 按 all / any 组合 ---------- */
      const groups = this.filterGroups(r as unknown as Record<string, unknown>, filterOpts, matchMode);
      if (!groups.length) return true;
      return matchMode === 'any' ? groups.some(Boolean) : groups.every(Boolean);
    });

    /*
     * v3.0.0 搜索 / 筛选时裁剪「不相关的空目录」。
     *
     * 原实现问题：allFolders 直接由【未经过滤】的 rows 聚合（且还并入了登记空目录），
     * 于是关键词搜索或任意筛选生效时，当前目录下「没有任何命中内容」的文件夹照样返回 ——
     * 前端表现为：搜出来的结果里混着一堆点进去空空如也的目录。
     *
     * 修法：用与内容完全相同的口径反推目录集合 —— 本次查询的 rows 已经带了同一套 where
     * （instanceId / shareScope / 加密粗筛 / 归属），matched 又叠了搜索 + 全部弹窗筛选，
     * 所以「matched 里出现的 folder」天然就是「其下存在命中文件」的目录。只保留三类目录：
     *   ① 自身（含子目录）有命中文件的目录，及其逐级父目录；
     *   ② 目录名本身包含关键词（无关键词时不适用）；
     *   ③ 其下存在名称包含关键词的子目录（祖先链一并保留，否则无法逐级导航到它）。
     * 注意：这里【不能】拿「未带关键词的全库聚合」来算，否则会把不相关目录带出来。
     *
     * 无关键词、无任何筛选时整块跳过 —— 普通浏览行为完全不变（空目录照常显示）。
     */
    const filterActive =
      !!search ||
      !!includeTags.length ||
      !!excludeTags.length ||
      !!filterTags.length ||
      !!hasTags ||
      !!fListType.length ||
      !!fAccess.length ||
      !!fLabel.length ||
      !!fFileType.length ||
      !!fChannel.length ||
      !!fChannelName.length ||
      !!fUploadSource.length ||
      !!fBackup.length ||
      !!fRedirect.length ||
      !!fValidity.length ||
      !!fNameChanged.length ||
      !!fUsers.length ||
      !!fromMs ||
      !!toMs ||
      sizeMin > 0 ||
      sizeMax > 0 ||
      ratingMin !== null ||
      ratingMax !== null ||
      levelMin !== null ||
      levelMax !== null ||
      !!fDimPreset.length ||
      widthMin > 0 ||
      widthMax > 0 ||
      heightMin > 0 ||
      heightMax > 0 ||
      !!shareScope ||
      // 管理员用 ?user= 切到具体账户时同样算「筛选」（选「全部用户」不算）
      !!(this.admin(req) && q.user && q.user !== 'all');
    if (filterActive) {
      const keep = new Set<string>();
      const addChain = (p: string) => {
        const segs = String(p).split('/').filter(Boolean);
        for (let i = 1; i <= segs.length; i += 1) keep.add(segs.slice(0, i).join('/'));
      };
      // ① 有命中文件的目录（含逐级父目录）
      for (const r of matched) if (r.folder) addChain(r.folder);
      // ②③ 目录名 / 子目录名包含关键词（在 allFolders 上判，登记空目录也在内）
      if (search) {
        for (const f of Array.from(allFolders)) {
          const leaf = String(f).split('/').pop() || '';
          if (leaf.toLowerCase().includes(search)) addChain(f);
        }
      }
      allFolders.clear();
      for (const f of keep) allFolders.add(f);
    }

    /*
     * v3.0.0「直接展开文件」模式（flat=true）：
     * 不按 folder 分层 —— 直接返回当前目录（含子目录，folder 前缀匹配 currentPath 与
     * currentPath + '/'）下的全部文件，不返回文件夹聚合（folders/directories 恒空）。
     * 分页语义：对扁平化后的完整文件列表分页。
     */
    const flat = q.flat === 'true';

    // 目录归属：非递归时只保留当前目录的直接文件，并列出其直接子目录
    const dirBare = dir.replace(/\/+$/, '');
    let files;
    let directories: string[] = [];
    if (flat) {
      files = matched.filter((r) => (!dirBare ? true : r.folder === dirBare || r.folder.startsWith(`${dirBare}/`)));
    } else if (recursive) {
      files = matched.filter((r) => (!dirBare ? true : r.folder === dirBare || r.folder.startsWith(`${dirBare}/`)));
    } else {
      files = matched.filter((r) => (r.folder || '') === dirBare);
      const set = new Set<string>();
      for (const f of allFolders) {
        const full = `${f}/`;
        if (!full.startsWith(dir)) continue;
        const rest = full.slice(dir.length);
        const idx = rest.indexOf('/');
        if (idx !== -1) set.add(dir + rest.slice(0, idx));
      }
      directories = Array.from(set).sort();
    }

    // v2.5.0：每个直接子目录的统计（子文件夹数 / 直接文件数）—— 文件管理文件夹卡片展示用
    // v2.6.0：增加 creator / createdAt（创建用户与时间 = 该文件夹内最早一条文件记录）
    const directoryStats: Record<string, { folders: number; files: number; creator?: string; createdAt?: number }> = {};
    if (!flat && !recursive) {
      for (const d of directories) {
        const prefix = `${d}/`;
        let sub = 0;
        for (const f of allFolders) {
          if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) sub += 1;
        }
        // 创建用户 / 创建时间：文件夹本身是虚拟概念，取其中最早上传的文件归属者与时间
        let creator = '';
        let createdAt = 0;
        for (const r of matched) {
          if ((r.folder || '') !== d && !(r.folder || '').startsWith(prefix)) continue;
          const t = r.createdAt ? new Date(r.createdAt).getTime() : 0;
          if (!createdAt || (t && t < createdAt)) {
            createdAt = t;
            creator = r.uploader || '';
          }
        }
        directoryStats[d] = {
          folders: sub,
          // v2.7.0 修复：统计用 matched（全量过滤集）而不是 files ——
          // 非递归分支里 files 已被过滤成「当前目录的直接文件」，
          // 拿它统计子文件夹内的文件数恒为 0（正是文件夹卡片统计不准的根因）
          files: matched.filter((r) => (r.folder || '') === d).length,
          creator,
          createdAt,
        };
      }
    }

    const totalCount = files.length;
    if (sumOnly) return { sum: totalCount, indexLastUpdated: Date.now() };

    /*
     * v3.0.0（R12）：「目录属性 → 目录名称」改名后必须立刻在文件管理页生效。
     * displayName 一直只写在 FolderMeta.metas 里，列表接口从来没下发过，
     * 前端只能拿路径末段当名字 —— 于是「改了名还是显示旧名」。
     * 这里一次性查出本页所有子目录的 displayName，交给前端覆盖展示名（路径不变）。
     */
    const folderDisplayNames: Record<string, string> = {};
    if (directories.length) {
      try {
        const metaRows = await prisma.folderMeta.findMany({
          where: {
            type: FOLDER_TYPE_FILE,
            // 「全部实例」查看时不限实例（与列表口径一致）
            ...(allInstances ? {} : { instanceId: instanceFilter || '' }),
            path: { in: directories },
          },
          select: { path: true, metas: true },
        });
        for (const row of metaRows) {
          const name = String((safeParse(row.metas).displayName as string) || '').trim();
          if (name) folderDisplayNames[row.path] = name;
        }
      } catch (err) {
        appLog.warn('file', '目录显示名查询失败', (err as Error).message);
      }
    }

    const paged = count === -1 ? files.slice(start) : files.slice(start, start + count);
    // 渠道真实直链解析器（本页所有文件共用一份渠道配置缓存）
    const resolveDirectUrl = this.directUrlResolver();
    /*
     * v3.0.0（R11b）：文件详情弹窗直接吃本接口的行数据，因此这里必须同时给出「源」地址
     * （文件加载域名）—— 只传 resolveDirectUrl 时 LoadUrl 会回退成 StorageUrl，
     * 表现为「源」与「存储渠道 / 备份渠道」完全一样（immich 这类内网取流渠道尤其明显）。
     */
    const resolveLoadUrl = this.directUrlResolver(true);
    const fileItems = paged.map((r) => {
      const item = serializeFile(r, r.copies, { tags: r.tags.map((t) => t.tag.name), resolveDirectUrl, resolveLoadUrl });
      /*
       * v3.0.0（R7）：把所属实例带回列表 —— 历史记录页切「全部实例」时，
       * 后端已不过滤实例，但前端拿不到 instanceId，只能把每条都显示成「默认实例」，
       * 看起来像「没加载到其它实例的记录」。这里补上 id 与目录，供前端显示实例名。
       */
      (item as any).instanceId = r.instanceId || '';
      (item as any).folder = r.folder || '';
      // v3.0.0（第四轮）：「共享」标识 —— 目录及子目录下的全部文件，发起方与接收方都打标
      const sharedInfo = sharedInfoOf(r);
      if (sharedInfo) {
        (item as any).shared = true;
        (item as any).sharedOwner = sharedInfo.owner;
        (item as any).sharedSelf = sharedInfo.self;
        // v3.0.0（R8）：共享权限随条目下发（前端据此隐藏属性入口 / 禁止选中 / 隐藏删除）
        (item as any).sharedPerm = sharedInfo.perm;
      }
      return item;
    });
    /*
     * v3.0.0（R7）：实例名回填 —— 页面一次批量查出本页涉及到的实例名称，
     * 前端（历史记录 / 文件详情）无需依赖「实例下拉列表」即可显示正确实例名；
     * 默认实例（instanceId 为空串）不回填，由前端显示「默认实例」。
     */
    try {
      const instIdSet = new Set<string>();
      for (const i of fileItems as any[]) {
        const v = String(i.instanceId || '');
        if (v) instIdSet.add(v);
      }
      const instIds: string[] = Array.from(instIdSet);
      if (instIds.length) {
        const instRows = await prisma.instance.findMany({
          where: { id: { in: instIds } },
          select: { id: true, name: true },
        });
        const nameById = new Map(instRows.map((r) => [String(r.id), String(r.name)]));
        for (const item of fileItems as any[]) {
          const nm = nameById.get(String(item.instanceId || ''));
          if (nm) item.metadata = { ...(item.metadata || {}), InstanceName: nm };
        }
      }
    } catch (err) {
      // v3.0.0（R7）：实例名回填失败不影响列表主流程，但要留痕便于排查
      appLog.warn('file', `实例名回填失败（不影响列表）：${(err as Error)?.message || err}`);
    }
    // v2.6.0 #301：全系统 IP 显示统一 —— 批量补「IpDisplay」格式化字段
    try {
      const fallback = new Map<string, string>();
      for (const item of fileItems) {
        const m: any = item.metadata;
        if (m?.UploadIP) fallback.set(String(m.UploadIP), String(m.UploadAddress || ''));
      }
      const displays = await ipDisplayBatch(fileItems.map((i) => String((i.metadata as any)?.UploadIP || '')), fallback, this.sysConfig);
      for (const item of fileItems) {
        const m: any = item.metadata;
        const d = displays.get(String(m?.UploadIP || ''));
        if (m && d) m.IpDisplay = d;
      }
    } catch {
      /* 格式化失败不影响列表 */
    }
    return {
      files: fileItems,
      directories,
      // v3.0.0（R12）：目录显示名（path → 自定义名称），前端展示用，路径本身不变
      folderDisplayNames,
      // v3.0.0：flat=true（直接展开文件）模式下文件夹聚合恒为空
      folders: flat ? [] : undefined,
      /*
       * v3.0.0：「共享」目录清单（路径 + 归属者 + 是否我共享出去的）——
       * 前端据此给目录卡片打标识：目录本身与其全部子目录/文件都算共享范围。
       * 与 shareScope 筛选无关，恒按「我可查看的共享目录全集」下发。
       */
      sharedFolders: sharedMark.map((d) => ({
        path: d.path,
        owner: d.owner,
        mine: d.owner === (session?.user || ''),
        // v3.0.0（R12）：共享权限随目录清单下发 —— 前端据此禁止「只读」目录被选中/改属性
        sharedPerm: d.sharedPerm,
      })),
      flat,
      directoryStats,
      totalCount,
      directFileCount: files.length,
      directFolderCount: flat ? 0 : directories.length,
      returnedCount: paged.length,
      indexLastUpdated: Date.now(),
      isIndexedResponse: true,
    };
  }

  /**
   * 索引统计 —— 供「系统状态」页使用（GET /api/manage/list?action=info）。
   *
   * GoHub 底层是 SQLite，列表查询本就是实时的，没有独立倒排索引；
   * 这里按前端契约实时聚合出统计口径，保证状态页/图表可用且始终与库内一致。
   *
   * 入参：timezoneOffset(分钟，同 JS getTimezoneOffset) / trendMaxPoints /
   *       trendSeriesLimit / trendStartDate / trendEndDate
   * 出参：{ totalFiles, lastUpdated, channelStats, typeStats, uploadSourceStats, mimeStats,
   *        newestFile, oldestFile, uploadTrend:{ labels, total, groupBy } }
   */
  private async indexInfo(q: Record<string, string>) {
    const rows = await prisma.fileRecord.findMany({
      where: { status: 'active' },
      include: { copies: { include: { channel: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const primaryOf = (r: (typeof rows)[number]) => pickPrimaryCopy(r.copies);

    const totalFiles = rows.length;
    const lastUpdated = totalFiles ? rows[totalFiles - 1].createdAt.getTime() : Date.now();

    // ---------- 汇总统计（今日/昨日/本周/本月/本年上传、累计占用、文件夹数） ----------
    const offMinStat = Number(q.timezoneOffset || 0) || 0;
    const localMs = (d: Date) => d.getTime() - offMinStat * 60000;
    const dayStartMs = (ms: number) => {
      const d = new Date(ms);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    };
    const nowLocal = localMs(new Date());
    const todayStart = dayStartMs(nowLocal);
    const yesterdayStart = todayStart - DAY_MS;
    // 本周以周一为一周起点
    const dow = new Date(todayStart).getUTCDay(); // 0=周日
    const weekStart = todayStart - ((dow + 6) % 7) * DAY_MS;
    const monthStart = Date.UTC(new Date(nowLocal).getUTCFullYear(), new Date(nowLocal).getUTCMonth(), 1);
    const yearStart = Date.UTC(new Date(nowLocal).getUTCFullYear(), 0, 1);
    let todayCount = 0;
    let yesterdayCount = 0;
    let weekCount = 0;
    let monthCount = 0;
    let yearCount = 0;
    let totalSize = 0;
    let totalViews = 0;
    const folderSet = new Set<string>();
    for (const r of rows) {
      const t = localMs(r.createdAt);
      totalSize += r.size || 0;
      totalViews += r.views || 0;
      if (r.folder) folderSet.add(r.folder.replace(/\/+$/, ''));
      if (t >= todayStart) todayCount += 1;
      if (t >= yesterdayStart && t < todayStart) yesterdayCount += 1;
      if (t >= weekStart) weekCount += 1;
      if (t >= monthStart) monthCount += 1;
      if (t >= yearStart) yearCount += 1;
    }

    // 最近上传（默认 20 条，按时间倒序，供「系统状态」列表展示）
    const recentLimit = Math.min(100, Math.max(1, Number(q.recentLimit || 20) || 20));
    const recentFiles = [...rows]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, recentLimit)
      .map((r) => ({
        id: r.name,
        name: r.name,
        metadata: {
          FileName: r.originalName,
          FileType: fileTypeOf(r.mime),
          FileExt: fileExtOf(r.originalName, r.mime),
          FileSize: formatSize(r.size),
          FileSizeBytes: r.size,
          TimeStamp: r.createdAt.getTime(),
          Views: (r as unknown as { views?: number }).views || 0,
          // 上传用户（系统状态「最近上传」的用户列）
          User: r.uploader || '',
          // 分类（逻辑目录）—— 系统状态「最近上传」的分类列
          Directory: r.folder ? `${r.folder.replace(/\/+$/, '')}/` : '',
        },
      }));

    // 渠道分布 + 用户分布 + 状态分布（ListType）+ 上传接口分布 + 上传类型分布
    const channelStats: Record<string, number> = {};
    const userStats: Record<string, number> = {};
    const typeStats: Record<string, number> = {};
    /** 上传接口（Default / WebDAV / API-Web / API-S3）—— v2.8.5 */
    const uploadSourceStats: Record<string, number> = {};
    /** 上传类型（image / video / audio / other，按 mime 归类）—— v2.8.5 */
    const mimeStats: Record<string, number> = {};
    for (const r of rows) {
      const p = primaryOf(r);
      const chLabel = p?.channel
        ? p.channel.name || CHANNEL_LABEL[p.channel.type] || p.channel.type
        : 'Unknown';
      channelStats[chLabel] = (channelStats[chLabel] || 0) + 1;

      const userLabel = r.uploader || '(匿名)';
      userStats[userLabel] = (userStats[userLabel] || 0) + 1;

      const metas = safeParse(r.metas);
      const listType = (metas.ListType as string) || 'None';
      typeStats[listType] = (typeStats[listType] || 0) + 1;

      const sourceLabel = normalizeUploadSource((r as unknown as { uploadSource?: string }).uploadSource);
      uploadSourceStats[sourceLabel] = (uploadSourceStats[sourceLabel] || 0) + 1;

      const mimeLabel = fileTypeOf(r.mime);
      mimeStats[mimeLabel] = (mimeStats[mimeLabel] || 0) + 1;
    }

    const brief = (r?: (typeof rows)[number]) =>
      r
        ? {
            id: r.name,
            name: r.name,
            metadata: {
              FileName: r.originalName,
              FileType: fileTypeOf(r.mime),
              FileSizeBytes: r.size,
              TimeStamp: r.createdAt.getTime(),
            },
          }
        : null;

    // ---------- 上传趋势 ----------
    // 前端 getTimezoneOffset()：本地 = UTC - offset，故先平移再取 UTC 日历日
    const offMin = Number(q.timezoneOffset || 0) || 0;
    const maxPoints = Math.min(365, Math.max(2, Number(q.trendMaxPoints || 90) || 90));
    const seriesLimit = Math.max(1, Number(q.trendSeriesLimit || 8) || 8);

    const nowMs = Date.now();
    let endMs = parseDayMs(q.trendEndDate);
    if (!Number.isFinite(endMs)) endMs = parseDayMs(isoDayMs(nowMs - offMin * 60000))!;
    let startMs = parseDayMs(q.trendStartDate);
    if (!Number.isFinite(startMs)) startMs = endMs - 6 * DAY_MS;
    if (endMs < startMs) [startMs, endMs] = [endMs, startMs];
    // 超出上限时保留最近的一段
    if (Math.floor((endMs - startMs) / DAY_MS) + 1 > maxPoints) {
      startMs = endMs - (maxPoints - 1) * DAY_MS;
    }

    const labels: string[] = [];
    for (let t = startMs; t <= endMs; t += DAY_MS) labels.push(isoDayMs(t));
    const labelIndex = new Map(labels.map((l, i) => [l, i]));

    const total = new Array(labels.length).fill(0);
    const byType: Record<string, number[]> = {};
    const byName: Record<string, number[]> = {};
    const byUser: Record<string, number[]> = {};
    // v2.8.5：新增两个趋势维度 —— 上传接口 / 上传类型
    const bySource: Record<string, number[]> = {};
    const byMime: Record<string, number[]> = {};

    for (const r of rows) {
      const key = isoDayMs(r.createdAt.getTime() - offMin * 60000);
      const i = labelIndex.get(key);
      if (i === undefined) continue;
      total[i] += 1;

      const p = primaryOf(r);
      const typeLabel = p?.channel ? CHANNEL_LABEL[p.channel.type] || p.channel.type : 'Unknown';
      const nameLabel = p?.channel?.name || typeLabel;
      const userLabel = r.uploader || '(匿名)';
      const sourceLabel = normalizeUploadSource((r as unknown as { uploadSource?: string }).uploadSource);
      const mimeLabel = fileTypeOf(r.mime);
      if (!byType[typeLabel]) byType[typeLabel] = new Array(labels.length).fill(0);
      if (!byName[nameLabel]) byName[nameLabel] = new Array(labels.length).fill(0);
      if (!byUser[userLabel]) byUser[userLabel] = new Array(labels.length).fill(0);
      if (!bySource[sourceLabel]) bySource[sourceLabel] = new Array(labels.length).fill(0);
      if (!byMime[mimeLabel]) byMime[mimeLabel] = new Array(labels.length).fill(0);
      byType[typeLabel][i] += 1;
      byName[nameLabel][i] += 1;
      byUser[userLabel][i] += 1;
      bySource[sourceLabel][i] += 1;
      byMime[mimeLabel][i] += 1;
    }

    /** 取前 N 条，其余合并为「其他」 */
    const buildSeries = (map: Record<string, number[]>) => {
      const arr = Object.entries(map)
        .map(([name, data]) => ({ name, data, sum: data.reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.sum - a.sum || a.name.localeCompare(b.name));
      const head = arr.slice(0, seriesLimit).map(({ name, data }) => ({ name, data }));
      const tail = arr.slice(seriesLimit);
      if (tail.length) {
        const other = new Array(labels.length).fill(0);
        for (const s of tail) s.data.forEach((v, i) => (other[i] += v));
        head.push({ name: '__other__', isOther: true, data: other } as never);
      }
      return head;
    };

    return {
      totalFiles,
      lastUpdated,
      channelStats,
      userStats,
      typeStats,
      uploadSourceStats,
      mimeStats,
      newestFile: brief(rows[totalFiles - 1]),
      oldestFile: brief(rows[0]),
      recentFiles,
      stats: {
        today: todayCount,
        yesterday: yesterdayCount,
        week: weekCount,
        month: monthCount,
        year: yearCount,
        totalSize,
        totalViews,
        folderCount: folderSet.size,
      },
      uploadTrend: {
        labels,
        total,
        groupBy: {
          channel: { series: buildSeries(byType) },
          channelName: { series: buildSeries(byName) },
          user: { series: buildSeries(byUser) },
          uploadSource: { series: buildSeries(bySource) },
          mime: { series: buildSeries(byMime) },
        },
        range: { startDate: isoDayMs(startMs), endDate: isoDayMs(endMs) },
      },
      indexLastUpdated: Date.now(),
      isIndexedResponse: true,
    };
  }

  /**
   * 删除（文件 / 目录）→ **软删除：移入回收站**。
   * 前端约定用 GET + `?folder=true|false`（历史契约），这里 GET 与 DELETE 双注册。
   * 目录删除 = 目录下所有文件一起进回收站（不动远端副本，可整体恢复）。
   * 彻底删除（连远端副本一起清理）只在回收站里做：见 trash/purge 路由。
   * 路由用通配符，兼容 File_ID 中含目录层级（如 `风景/2026/abc`）的情况。
   */
  @Get('delete/*')
  deleteByGet(@Req() req: Request, @Query() q: { folder?: string; instanceId?: string }) {
    return this.remove(req, q);
  }

  @Delete('delete/*')
  deleteByDelete(@Req() req: Request, @Query() q: { folder?: string; instanceId?: string }) {
    return this.remove(req, q);
  }

  private async remove(req: Request, q: { folder?: string; instanceId?: string }) {
    if (!(await this.userPerm(req, 'delete'))) return { success: false, message: '没有删除权限' };
    const key = wildcardParam(req);
    if (!key) return { success: false, message: '缺少文件名' };
    // 普通用户只能删自己的文件
    const owner = currentSession(req)?.user || '';
    const own = owner ? { uploader: owner } : {};
    /*
     * v1.0.0：删除也必须限定实例 —— 原来只按 folder 前缀匹配，
     * 在 A 实例删「2026」会把 B 实例同名的「2026」目录下文件一起丢进回收站。
     * instanceId='*' 表示「全部实例」（历史记录页），其它值（含不传）按默认实例处理。
     */
    const delInstance = String(q.instanceId ?? '');
    const instWhere = delInstance === '*' ? {} : { instanceId: delInstance };

    /*
     * v3.0.0（R8）：共享目录内一律不可删除 ——
     * 别人共享给我的目录（无论只读还是编辑权限），里面的文件 / 目录都不能被我删掉
     * （连「我自己上传进去的」也不行，保证共享目录归属者的内容安全；管理员不受限）。
     */
    let sharedToMeDirs: { path: string; owner: string }[] = [];
    if (!this.admin(req) && owner) {
      sharedToMeDirs = await listSharedFoldersFor(owner, '*');
    }
    const sharedHitOf = (folder: string) =>
      sharedToMeDirs.find((d) => folder === d.path || folder.startsWith(`${d.path}/`));

    // 目录删除：按 folder 前缀批量删（软删除，可整体恢复；已在回收站的不重复处理）
    if (q.folder === 'true') {
      const prefix = key.replace(/\/+$/, '');
      const hit = sharedHitOf(prefix);
      if (hit) {
        return { success: false, message: `「${hit.path}」是 ${hit.owner} 共享给你的目录，不允许删除` };
      }
      const rows = await prisma.fileRecord.findMany({
        where: {
          status: 'active',
          ...own,
          ...instWhere,
          OR: [{ folder: prefix }, { folder: { startsWith: `${prefix}/` } }],
        },
      });
      for (const r of rows) await this.trashRecord(r.id, r.name);
      /*
       * v3.0.0（R12）：目录删除必须同时清掉「目录自身」的三处登记 ——
       *   ① settings.extraFolders（「新建目录」登记的空目录）：
       *      不清的话空目录不在 FileRecord 里，删完仍然出现在列表/目录导航，看起来就是「删除不成功」；
       *   ② FolderMeta（目录属性行）：全局目录导航会合并它，同样会让已删目录阴魂不散；
       *   ③ 记录一条日志，便于排查「删了还在」的反馈。
       * 说明：文件是软删除（进回收站），恢复文件时目录会重新出现，但属性需要重新设置。
       */
      const unregistered = await this.unregisterFolders(owner, prefix, delInstance === '*' ? '' : delInstance);
      let metaRemoved = 0;
      let metaSnapshot: Record<string, unknown> | null = null;
      try {
        const metas = await prisma.folderMeta.findMany({
          where: {
            type: FOLDER_TYPE_FILE,
            OR: [{ path: prefix }, { path: { startsWith: `${prefix}/` } }],
            ...(owner ? { owner } : {}),
            // v1.0.0：目录属性行同样按实例隔离，避免误删其它实例的同名目录属性
            ...(delInstance === '*' ? {} : { instanceId: delInstance }),
          },
        });
        if (metas.length) {
          /*
           * v3.0.0（R14）：目录进入回收站前，快照目录自身的属性行（path === prefix 那条）——
           * 回收站里会显示文件夹条目，恢复时把属性一并还原（目录下同名属性行已存在则不覆盖，
           * 因为软删期间用户可能重建了同名目录并重新设置了属性）。
           */
          const self = metas.find((m) => m.path === prefix);
          if (self) {
            const { id, createdAt, ...rest } = self as unknown as Record<string, unknown> & { id: string };
            metaSnapshot = rest;
          }
          const del = await prisma.folderMeta.deleteMany({ where: { id: { in: metas.map((m) => m.id) } } });
          metaRemoved = del.count;
        }
      } catch (err) {
        appLog.warn('file', `目录属性清理失败：${prefix}`, (err as Error).message);
      }
      /*
       * v3.0.0（R14）：目录本体登记进回收站（settings.deletedFolders）——
       * 回收站列表会显示文件夹条目；软删期间允许重建同名目录（登记无冲突检查），
       * 恢复目录时重新登记 + 还原属性，逐个恢复的文件自动合并进同名目录。
       */
      try {
        await this.addDeletedFolder(owner, {
          path: prefix,
          deletedAt: new Date().toISOString(),
          // v1.0.0：实例以请求为准（属性快照可能为空 / 全部实例场景）
          instanceId: delInstance === '*' ? String(metaSnapshot?.instanceId ?? '') : delInstance,
          meta: metaSnapshot,
        });
      } catch (err) {
        appLog.warn('file', `目录移入回收站登记失败：${prefix}`, (err as Error).message);
      }
      appLog.info(
        'file',
        `目录已移入回收站：${prefix}`,
        `文件 ${rows.length} 条 ｜ 登记目录 ${unregistered} 条 ｜ 目录属性 ${metaRemoved} 条`,
      );
      return { success: true, deleted: rows.length, folders: 1, unregistered, metaRemoved };
    }

    // v3.0.0（R8.1）：按名字查不到记录时（共享目录里的文件 owner 不是自己，会被 own 过滤掉），
    // 先看请求带的 folder 是否落在共享目录内 —— 命中就直接给「不允许删除」，而不是「文件不存在」。
    const reqFolder = String(q.folder || '');
    if (reqFolder && reqFolder !== 'true') {
      const hitByFolder = sharedHitOf(reqFolder);
      if (hitByFolder) {
        return { success: false, message: `「${hitByFolder.path}」是 ${hitByFolder.owner} 共享给你的目录，不允许删除` };
      }
    }
    const record = await prisma.fileRecord.findFirst({
      where: { status: 'active', ...own, OR: [{ name: key }, { name: key.replace(/\.[^.]*$/, '') }] },
    });
    if (!record) return { success: false, message: '文件不存在' };
    const sharedHit = sharedHitOf(record.folder || '');
    if (sharedHit) {
      return { success: false, message: `该文件位于 ${sharedHit.owner} 共享给你的「${sharedHit.path}」内，不允许删除` };
    }
    await this.trashRecord(record.id, record.name);
    return { success: true, deleted: 1 };
  }

  /** 移入回收站（软删除，不动远端副本） */
  private async trashRecord(id: string, name: string) {
    await this.uploadSvc.softDeleteFile(id, name);
  }

  // ==================== 回收站 ====================

  /**
   * 回收站列表：status='deleted' 的文件，按删除时间倒序。
   * 普通用户只能看到自己移入的文件；附带渠道概要（恢复/彻底删除时前端可直接展示影响面）。
   */
  @Get('trash')
  async trashList(@Req() req: Request, @Query() q: Record<string, string>) {
    const owner = currentSession(req)?.user || '';
    // v3.0.0：回收站同样按实例隔离（空串/不传 = 默认实例）
    const instanceFilter = String(q.instanceId ?? '');
    const rows = await prisma.fileRecord.findMany({
      where: {
        status: 'deleted',
        instanceId: instanceFilter,
        ...(owner ? { uploader: owner } : {}),
      },
      /*
       * v2.9.0：回收站与普通列表共用同一套筛选求值（filterGroups）——
       * 需要 copies.channel（渠道类型/名称）与 tags（标签页筛选），这里一并取回。
       */
      include: {
        copies: { include: { channel: true } },
        tags: { include: { tag: true } },
      },
      orderBy: { deletedAt: 'desc' },
      // v3.0.0（R12）：回收站改服务端分页后，取回上限提到 2000（筛选在内存里做，够用即可）
      take: 2000,
    });

    /*
     * 回收站筛选：与普通列表同一套参数（搜索 / 常规 / 标签 / 日期 / 大小 / 尺寸 / 用户），
     * 外加 v2.9.0 的 matchMode（同时 / 任意）。
     */
    const search = (q.search || '').trim().toLowerCase();
    // v3.0.0：matchMode 兼容 and/or 写法，并传给 filterGroups 实现「同时」逐值 AND
    const matchModeRaw = String(q.matchMode || '').toLowerCase();
    const matchMode: 'all' | 'any' = matchModeRaw === 'any' || matchModeRaw === 'or' ? 'any' : 'all';
    const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(q.dateFrom || '')) ? String(q.dateFrom) : '';
    const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(q.dateTo || '')) ? String(q.dateTo) : '';
    const tzMin = Number(q.tz);
    const tzOffset = Number.isFinite(tzMin) ? Math.max(-840, Math.min(840, tzMin)) : 0;
    const dayStartMs = (date: string) => {
      const [y, m, d] = date.split('-').map(Number);
      return Date.UTC(y, m - 1, d) + tzOffset * 60_000;
    };
    const fromMs = dateFrom ? dayStartMs(dateFrom) : 0;
    const toMs = dateTo ? dayStartMs(dateTo) + 86_400_000 - 1 : 0;

    const filterOpts = {
      hasTags: String(q.hasTags || '').toLowerCase(),
      filterTags: splitCsv(q.filterTags),
      tagMode: String(q.tagMode || 'and').toLowerCase() === 'or' ? 'or' : 'and',
      listType: splitCsv(q.listType),
      label: splitCsv(q.label),
      fileType: splitCsv(q.fileType),
      channel: splitCsv(q.channel),
      channelName: splitCsv(q.channelName),
      uploadSource: splitCsv(q.uploadSource).map((v) => normalizeUploadSource(v)),
      backup: splitCsv(q.backup),
      redirect: splitCsv(q.redirect),
      access: splitCsv(q.accessStatus),
      validity: splitCsv(q.validity).map((v) => v.toLowerCase()),
      nameChanged: splitCsv(q.nameChanged).map((v) => v.toLowerCase()),
      users: splitCsv(q.filterUsers),
      fromMs,
      toMs,
      sizeMin: Math.max(0, Number(q.sizeMin) || 0),
      sizeMax: Math.max(0, Number(q.sizeMax) || 0),
      sizeMode: String(q.sizeMode || 'actual').toLowerCase() === 'original' ? 'original' : 'actual',
      ratingMin: this.numOrNullParam(q.ratingMin, 5),
      ratingMax: this.numOrNullParam(q.ratingMax, 5),
      levelMin: this.numOrNullParam(q.levelMin, 5),
      levelMax: this.numOrNullParam(q.levelMax, 5),
      dimPreset: splitCsv(q.dimPreset).map((v) => v.toLowerCase()),
      widthMin: Math.max(0, Number(q.widthMin) || 0),
      widthMax: Math.max(0, Number(q.widthMax) || 0),
      heightMin: Math.max(0, Number(q.heightMin) || 0),
      heightMax: Math.max(0, Number(q.heightMax) || 0),
    };

    const filtered = rows.filter((r) => {
      if (search) {
        const hit =
          r.name.toLowerCase().includes(search) ||
          r.originalName.toLowerCase().includes(search) ||
          (r.uploader || '').toLowerCase().includes(search) ||
          (r.folder || '').toLowerCase().includes(search) ||
          (r.md5 || '').toLowerCase().includes(search);
        if (!hit) return false;
      }
      const groups = this.filterGroups(r as unknown as Record<string, unknown>, filterOpts, matchMode);
      if (!groups.length) return true;
      return matchMode === 'any' ? groups.some(Boolean) : groups.every(Boolean);
    });

    const channelIds = Array.from(new Set(filtered.flatMap((r) => r.copies.map((c) => c.channelId))));
    const channels = await prisma.channel.findMany({
      where: { id: { in: channelIds } },
      select: { id: true, name: true, type: true },
    });
    const chMap = new Map(channels.map((c) => [c.id, c]));
    const mapped = filtered.map((r) => ({
      id: r.id,
      name: r.name,
      originalName: r.originalName,
      size: r.size,
      mime: r.mime,
      folder: r.folder,
      uploader: r.uploader,
      uploadSource: r.uploadSource,
      status: r.status,
      deletedAt: r.deletedAt,
      channels: r.copies.map((c) => ({
        name: chMap.get(c.channelId)?.name || '(已删除渠道)',
        type: chMap.get(c.channelId)?.type || '',
        isPrimary: c.isPrimary,
        status: c.status,
      })),
    }));
    /*
     * v3.0.0（R12）：回收站改为服务端分页，默认每页 48 条（需求：每页 48）。
     * 以前一次性把全部结果丢给前端（take 500），条目一多首屏就卡；
     * page 缺省 = 1，pageSize 缺省 = 48，上限 200（防止被拿去当全量导出用）。
     */
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 48));
    const page = Math.max(1, Number(q.page) || 1);
    /*
     * v1.0.3：回收站改为「按目录层级浏览」。
     *
     * 旧行为：所有软删文件 + 已删目录条目拉平成一条列表，靠 folderHint 提示原目录，
     * 文件一多就完全看不出层级 —— 用户没法「进到某个目录里看看它删了什么」。
     *
     * 新行为：与文件管理列表一致 ——
     *   · 只有「当前目录」的直接子目录 + 直接子文件会被返回；
     *   · 子目录既包括 settings.deletedFolders 里登记过的已删目录，
     *     也包括「只删了里面的文件、目录本身没删」的隐式目录（由文件路径反推）；
     *   · 进入子目录用 ?dir=<路径>，返回上级用响应里的 parent。
     */
    const dirParam = String(q.dir || '').replace(/^\/+|\/+$/g, '');
    const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

    let folderEntries: { path: string; instanceId?: string; deletedAt: any }[] = [];
    try {
      folderEntries = (await this.listDeletedFoldersFor(req, owner)).filter(
        (e) => (e.instanceId || '') === instanceFilter,
      ) as typeof folderEntries;
    } catch (err) {
      appLog.warn('file', `回收站目录条目读取失败`, (err as Error).message);
    }

    // 所有仍然「存在层级」的路径（含逐级父目录），用于算出当前层的子目录
    const pathSet = new Set<string>();
    const addChain = (raw: string) => {
      const segs = String(raw || '').split('/').filter(Boolean);
      for (let i = 1; i <= segs.length; i += 1) pathSet.add(segs.slice(0, i).join('/'));
    };
    for (const r of filtered) if (r.folder) addChain(r.folder);
    for (const e of folderEntries) if (e.path) addChain(e.path);

    const children = Array.from(pathSet).filter((p) => parentOf(p) === dirParam);
    const latestDeletedAtUnder = (prefix: string) => {
      let latest = 0;
      for (const r of filtered) {
        const f = String(r.folder || '');
        if (f === prefix || f.startsWith(`${prefix}/`)) latest = Math.max(latest, new Date(r.deletedAt as any).getTime());
      }
      for (const e of folderEntries) {
        if (e.path === prefix || String(e.path).startsWith(`${prefix}/`)) {
          latest = Math.max(latest, new Date(e.deletedAt as any).getTime());
        }
      }
      return latest ? new Date(latest) : null;
    };

    const folderItems = children.map((p) => {
      const base = p.split('/').pop() || p;
      return {
        id: `folder:${p}`,
        name: base,
        originalName: base,
        size: 0,
        mime: '',
        folder: parentOf(p),
        // 前端据此进入回收站内的子目录（与 folder 字段区分：folder 是「原所在目录」）
        trashPath: p,
        uploader: owner,
        uploadSource: '',
        status: 'deleted',
        deletedAt: latestDeletedAtUnder(p),
        isFolder: true,
        registered: folderEntries.some((e) => e.path === p),
        channels: [],
      };
    });

    // 当前层的文件：folder 正好等于当前目录（不是「以它开头」，保证只显示直接子项）
    const levelFiles = mapped.filter((m) => String((m as any).folder || '') === dirParam);
    const merged = [
      ...(folderItems as unknown as typeof mapped),
      ...levelFiles,
    ];
    const total = merged.length;
    const start = (page - 1) * pageSize;
    const items = merged.slice(start, start + pageSize);
    return {
      success: true,
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      // v1.0.3：当前所在目录 + 上一级目录（前端面包屑 / 返回上级用）
      path: dirParam,
      parent: dirParam ? parentOf(dirParam) : '',
      isRoot: !dirParam,
    };
  }

  /** 从回收站恢复单个文件（撤销软删除标记）；v3.0.0（R14）：支持恢复文件夹条目 */
  @Get('trash/restore/*')
  async trashRestore(@Req() req: Request) {
    if (!(await this.userPerm(req, 'delete'))) return { success: false, message: '没有恢复权限' };
    const key = wildcardParam(req);
    /*
     * v1.0.1：恢复同样要限定归属（管理员不受限）——
     * 原来按 id 直接取记录，普通用户猜到别人的记录 id 就能把别人的文件从回收站里恢复出来。
     */
    const owner = currentSession(req)?.user || '';
    if (key.startsWith('folder:')) {
      const path = key.slice('folder:'.length);
      // v1.0.0：同一个路径在不同实例下可能各有一条回收站记录，取实例对得上的那条
      const entry = (await this.listDeletedFoldersFor(req, owner)).find((e) => e.path === path);
      if (entry) {
        const restored = await this.restoreFolderEntry(owner, path, String(entry.instanceId || ''));
        return { success: true, folder: true, restoredFiles: restored.filesRestored };
      }
      /*
       * v1.0.3：隐式目录 —— 目录本身没被删，只是里面的文件被删了。
       * 回收站按层级浏览时它同样是一个可进入的「文件夹」，恢复 = 把该路径下
       * （含各级子目录）仍在回收站里的文件全部恢复回原位。
       */
      const rows = await prisma.fileRecord.findMany({
        where: {
          status: 'deleted',
          uploader: owner,
          OR: [{ folder: path }, { folder: { startsWith: `${path}/` } }],
        },
        select: { id: true, name: true, folder: true, uploader: true, instanceId: true },
      });
      if (!rows.length) return { success: false, message: '回收站中不存在该目录' };
      for (const r of rows) {
        await this.uploadSvc.restoreFile(r.id, r.name);
        await this.restoreFolderChain(r.uploader || owner, r.folder || '', r.instanceId || '');
      }
      return { success: true, folder: true, restoredFiles: rows.length };
    }
    const record = await prisma.fileRecord.findFirst({
      where: { id: key, status: 'deleted', ...(owner ? { uploader: owner } : {}) },
    });
    if (!record) return { success: false, message: '回收站中不存在该文件' };
    await this.uploadSvc.restoreFile(record.id, record.name);
    // v1.0.1：文件回到原目录；原目录若还在回收站里，一并把目录（含属性）恢复回来
    await this.restoreFolderChain(record.uploader || owner, record.folder || '', record.instanceId || '');
    return { success: true };
  }

  /** 彻底删除单个文件（远端副本一并清理，不可恢复） */
  @Get('trash/purge/*')
  async trashPurge(@Req() req: Request, @Query() q: { totpCode?: string }) {
    return this.trashPurgeOne(req, String(q?.totpCode || ''));
  }

  @Delete('trash/purge/*')
  async trashPurgeDelete(@Req() req: Request, @Query() q: { totpCode?: string }) {
    return this.trashPurgeOne(req, String(q?.totpCode || ''));
  }

  private async trashPurgeOne(req: Request, totpCode = '') {
    if (!(await this.userPerm(req, 'delete'))) return { success: false, message: '没有删除权限' };
    const key = wildcardParam(req);
    const owner = currentSession(req)?.user || '';
    // v3.0.0（R14）：文件夹条目彻底删除 = 清登记 + 连带清掉该前缀下所有软删文件
    if (key.startsWith('folder:')) {
      const path = key.slice('folder:'.length);
      const hit = (await this.listDeletedFoldersFor(req, owner)).find((e) => e.path === path);
      if (hit) {
        const gate = await this.verifyTrashTotp(req, totpCode);
        if (gate) return gate;
        const n = await this.purgeFolderEntry(owner, path, String(hit.instanceId || ''));
        return { success: true, folder: true, purged: n };
      }
      // v1.0.3：隐式目录（目录本身没删，只删了里面的文件）→ 逐条彻底删除该前缀下的软删文件
      const rows = await prisma.fileRecord.findMany({
        where: {
          status: 'deleted',
          uploader: owner,
          OR: [{ folder: path }, { folder: { startsWith: `${path}/` } }],
        },
        select: { id: true, name: true, uploader: true, folder: true, instanceId: true },
      });
      if (!rows.length) return { success: false, message: '回收站中不存在该目录' };
      const gate2 = await this.verifyTrashTotp(req, totpCode);
      if (gate2) return gate2;
      for (const r of rows) {
        await this.uploadSvc.removeFile(r.id, r.name);
        await this.cleanupEmptiedFolderChain(r.uploader || owner, r.folder || '', r.instanceId || '');
      }
      return { success: true, folder: true, purged: rows.length };
    }
    const record = await prisma.fileRecord.findFirst({
      where: { id: key, status: 'deleted', ...(owner ? { uploader: owner } : {}) },
    });
    if (!record) return { success: false, message: '回收站中不存在该文件' };
    const gate = await this.verifyTrashTotp(req, totpCode);
    if (gate) return gate;
    await this.uploadSvc.removeFile(record.id, record.name);
    // v1.0.2：删完若该目录已空，登记与属性一起清掉（否则文件管理里留一个空条目）
    await this.cleanupEmptiedFolderChain(record.uploader || owner, record.folder || '', record.instanceId || '');
    return { success: true };
  }

  /**
   * 回收站批量操作：{ ids: string[], action: 'restore' | 'purge', totpCode? }。
   * 逐条处理并返回逐项结果 —— 单条失败（如权限不符）不影响其余条目。
   * v3.0.0（R14）：① ids 支持 `folder:<路径>` 形式的文件夹条目；
   * ② action=purge 时，若当前账户开启 2FA 必须带有效的动态验证码（整批一次验证）。
   */
  @Post('trash/batch')
  async trashBatch(@Req() req: Request, @Body() body: { ids?: string[]; action?: string; totpCode?: string }) {
    if (!(await this.userPerm(req, 'delete'))) return { success: false, message: '没有权限' };
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    const action = body.action === 'purge' ? 'purge' : 'restore';
    if (!ids.length) return { success: false, message: '缺少 ids' };
    const owner = currentSession(req)?.user || '';
    // v3.0.0（R14）：2FA 闸门 —— 开启两步验证的账户，彻底删除前必须验证动态码
    if (action === 'purge') {
      const gate = await this.verifyTrashTotp(req, body?.totpCode);
      if (gate) return gate;
    }
    const folderPaths = new Set((await this.listDeletedFoldersFor(req, owner)).map((e) => e.path));
    const rows = await prisma.fileRecord.findMany({
      where: { id: { in: ids }, status: 'deleted', ...(owner ? { uploader: owner } : {}) },
    });
    const found = new Set(rows.map((r) => r.id));
    const results: { id: string; ok: boolean; message?: string }[] = [];
    for (const id of ids) {
      // 文件夹条目：id 形如 folder:<路径>
      if (id.startsWith('folder:')) {
        const path = id.slice('folder:'.length);
        if (!folderPaths.has(path)) {
          /*
           * v1.0.3：可能是「隐式目录」—— 目录本身没被删，只有里面的文件进了回收站。
           * 这种目录在回收站里同样以文件夹形式出现，批量恢复 / 彻底删除按前缀整批处理。
           */
          try {
            const under = await prisma.fileRecord.findMany({
              where: {
                status: 'deleted',
                uploader: owner,
                OR: [{ folder: path }, { folder: { startsWith: `${path}/` } }],
              },
              select: { id: true, name: true, uploader: true, folder: true, instanceId: true },
            });
            if (!under.length) {
              results.push({ id, ok: false, message: '目录不存在或无权限' });
              continue;
            }
            for (const r of under) {
              if (action === 'purge') {
                await this.uploadSvc.removeFile(r.id, r.name);
                await this.cleanupEmptiedFolderChain(r.uploader || owner, r.folder || '', r.instanceId || '');
              } else {
                await this.uploadSvc.restoreFile(r.id, r.name);
                await this.restoreFolderChain(r.uploader || owner, r.folder || '', r.instanceId || '');
              }
            }
            results.push({ id, ok: true, message: `${action === 'purge' ? '连带删除' : '连带恢复'}文件 ${under.length} 条` });
          } catch (err) {
            results.push({ id, ok: false, message: (err as Error).message });
          }
          continue;
        }
        try {
          // v1.0.2：同名目录可能存在于多个实例 —— 取出实例，彻底删除时按实例清理登记
          const entry = (await this.listDeletedFoldersFor(req, owner)).find((e) => e.path === path);
          if (action === 'purge') {
            const n = await this.purgeFolderEntry(owner, path, String(entry?.instanceId || ''));
            results.push({ id, ok: true, message: `连带文件 ${n} 条` });
          } else {
            // v1.0.0：把实例一并带过去（同名目录可能存在于多个实例）
            const restored = await this.restoreFolderEntry(owner, path, String(entry?.instanceId || ''));
            results.push({ id, ok: true, message: `连带恢复文件 ${restored.filesRestored} 条` });
          }
        } catch (err) {
          results.push({ id, ok: false, message: (err as Error).message });
        }
        continue;
      }
      if (!found.has(id)) {
        results.push({ id, ok: false, message: '不存在或无权限' });
        continue;
      }
      try {
        const rec = rows.find((r) => r.id === id)!;
        if (action === 'purge') {
          await this.uploadSvc.removeFile(rec.id, rec.name);
          // v1.0.2：同单条彻底删除 —— 目录因此变空则清理登记与属性
          await this.cleanupEmptiedFolderChain(rec.uploader || owner, rec.folder || '', rec.instanceId || '');
        } else {
          await this.uploadSvc.restoreFile(rec.id, rec.name);
          // v1.0.1：文件回到原目录；原目录还在回收站里则一并恢复（含属性）
          await this.restoreFolderChain(rec.uploader || owner, rec.folder || '', rec.instanceId || '');
        }
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, message: (err as Error).message });
      }
    }
    return {
      success: true,
      action,
      results,
      okCount: results.filter((r) => r.ok).length,
      failCount: results.filter((r) => !r.ok).length,
    };
  }

  /* ================= v3.0.0（R14）：回收站文件夹 / 2FA / 评分共享编辑 ================= */

  /** 已删除文件夹登记（settings.deletedFolders）：{ [owner]: [{ path, deletedAt, instanceId, meta }] } */
  private async deletedFoldersRead(): Promise<
    Record<string, { path: string; deletedAt: string; instanceId: string; meta: Record<string, unknown> | null }[]>
  > {
    const raw = await this.settings.get('deletedFolders', '{}');
    return safeParse(raw) as Record<
      string,
      { path: string; deletedAt: string; instanceId: string; meta: Record<string, unknown> | null }[]
    >;
  }

  private async deletedFoldersWrite(
    map: Record<string, { path: string; deletedAt: string; instanceId: string; meta: Record<string, unknown> | null }[]>,
  ): Promise<void> {
    await this.settings.set('deletedFolders', JSON.stringify(map));
  }

  private async listDeletedFolders(owner: string) {
    const map = await this.deletedFoldersRead();
    return Array.isArray(map[owner]) ? map[owner] : [];
  }

  /**
   * v1.0.3：带「旧键兼容」的回收站目录读取。
   *
   * v1.0.2 及以前管理员删除目录时用的是空 owner 键（''），v1.0.3 起归到本人账户名下。
   * 升级后如果只看本人键，管理员原来删过的目录会在回收站里「凭空消失」，
   * 所以这里在管理员场景下把旧键条目一并合并进来（按 路径 + 实例 去重，本人键优先）。
   */
  private async listDeletedFoldersFor(req: Request, owner: string) {
    const mine = await this.listDeletedFolders(owner);
    if (!this.admin(req) || !owner) return mine;
    const legacy = await this.listDeletedFolders('');
    if (!legacy.length) return mine;
    const seen = new Set(mine.map((e) => `${e.path}\u0000${e.instanceId || ''}`));
    return [...mine, ...legacy.filter((e) => !seen.has(`${e.path}\u0000${e.instanceId || ''}`))];
  }

  private async addDeletedFolder(owner: string, entry: { path: string; deletedAt: string; instanceId: string; meta: Record<string, unknown> | null }) {
    const map = await this.deletedFoldersRead();
    // 同一目录重复删除（删 → 重建 → 再删）时覆盖旧条目
    const list = (map[owner] || []).filter((e) => e.path !== entry.path);
    list.unshift(entry);
    map[owner] = list;
    await this.deletedFoldersWrite(map);
  }

  private async removeDeletedFolder(owner: string, path: string) {
    const map = await this.deletedFoldersRead();
    if (!map[owner]) return null;
    const hit = map[owner].find((e) => e.path === path) || null;
    map[owner] = map[owner].filter((e) => e.path !== path);
    await this.deletedFoldersWrite(map);
    return hit;
  }

  /**
   * 从回收站恢复文件夹：重新登记目录（extraFolders）并还原属性快照。
   * 目录下的文件仍是软删状态 —— 逐个恢复时 folder 路径不变，会自动「合并」进
   * 这个（恢复出来的或软删期间重建的同名）目录，与需求语义一致。
   */
  private async restoreFolderEntry(
    owner: string,
    path: string,
    instanceId = '',
  ): Promise<{ metaRestored: number; filesRestored: number }> {
    const metaRestored = await this.reinstateFolder(owner, path, instanceId);
    /*
     * v3.0.0（R15）：恢复目录 = 连同目录内的文件一起还原。
     * 之前只恢复目录登记与属性，目录里的文件仍留在回收站里散着，
     * 用户看到「恢复了文件夹但文件没回来」，就等于没有恢复。
     * 这里按目录前缀（含子目录）批量把软删文件置回 active ——
     * 文件的 folder 字段从未改动，恢复后自然回到删除前的层级。
     */
    let filesRestored = 0;
    try {
      const res = await prisma.fileRecord.updateMany({
        where: {
          status: 'deleted',
          ...(owner ? { uploader: owner } : {}),
          // v1.0.0：只恢复本实例下同路径的文件，别把其它实例的同名目录一起拉回来
          instanceId,
          OR: [{ folder: path }, { folder: { startsWith: `${path}/` } }],
        },
        data: { status: 'active', deletedAt: null },
      });
      filesRestored = res.count;
    } catch (err) {
      appLog.warn('file', `回收站恢复目录内的文件失败：${path}`, (err as Error).message);
    }
    appLog.info('file', `目录已从回收站恢复：${path}`, `目录属性还原 ${metaRestored} 条 ｜ 连带恢复文件 ${filesRestored} 条`);
    return { metaRestored, filesRestored };
  }

  /**
   * v1.0.1：把一个「已删除目录」在结构上恢复回来（不碰文件状态）。
   *   · 重新登记到 settings.extraFolders（空目录也能在文件管理里出现）；
   *   · 从 settings.deletedFolders 里摘掉（回收站不再显示这个已删文件夹）；
   *   · 属性快照写回 FolderMeta（同名属性行已存在则不覆盖）。
   * 返回还原的属性条数（0 / 1）。
   */
  private async reinstateFolder(owner: string, path: string, instanceId = ''): Promise<number> {
    try {
      const raw = await this.settings.get('extraFolders', '{}');
      const map = safeParse(raw) as Record<string, string[]>;
      // v1.0.0：按「账户 + 实例」键重新登记，不能落到默认实例的旧键上
      const key = this.extraFoldersKey(owner, instanceId);
      const list = new Set(Array.isArray(map[key]) ? map[key] : []);
      list.add(path);
      map[key] = Array.from(list).sort();
      await this.settings.set('extraFolders', JSON.stringify(map));
    } catch (err) {
      appLog.warn('file', `回收站恢复目录登记失败：${path}`, (err as Error).message);
    }
    let metaRestored = 0;
    const entry = await this.removeDeletedFolder(owner, path);
    if (entry?.meta && Object.keys(entry.meta).length) {
      try {
        const exists = await prisma.folderMeta.findFirst({
          where: { path, instanceId, type: FOLDER_TYPE_FILE, ...(owner ? { owner } : {}) },
          select: { id: true },
        });
        // 同名属性行已存在（软删期间重建目录并设置了属性）→ 不覆盖，保留用户的新配置
        if (!exists) {
          await prisma.folderMeta.create({ data: entry.meta as never });
          metaRestored = 1;
        }
      } catch (err) {
        appLog.warn('file', `回收站恢复目录属性失败：${path}`, (err as Error).message);
      }
    }
    return metaRestored;
  }

  /**
   * v1.0.1：单个文件恢复时，把它原来所在的目录链一并恢复。
   *
   * 场景：删除目录 → 目录登记（extraFolders / FolderMeta）被清、回收站里留下文件夹条目，
   * 此时只恢复其中一个文件，文件虽然回到了原 folder，但目录本身仍在回收站里（且属性已丢）。
   * 这里按「从最外层到最内层」的顺序，把仍挂在回收站里、且是目标目录祖先的每一级都恢复回来：
   * 重新登记目录 + 还原属性快照 + 从回收站文件夹列表里摘掉。
   * 只处理「回收站里确实登记过」的层级；目录链上从未删除的层级不动。
   */
  private async restoreFolderChain(owner: string, folder: string, instanceId = '') {
    const f = String(folder || '').replace(/^\/+|\/+$/g, '').trim();
    if (!f) return 0;
    let entries: { path: string; instanceId?: string }[] = [];
    try {
      entries = await this.listDeletedFolders(owner);
    } catch (err) {
      appLog.warn('file', `读取回收站目录登记失败（跳过目录链恢复）`, (err as Error).message);
      return 0;
    }
    if (!entries.length) return 0;
    const sameInstance = (e: { instanceId?: string }) => String(e.instanceId || '') === String(instanceId || '');
    const segs = f.split('/').filter(Boolean);
    let restored = 0;
    for (let i = 1; i <= segs.length; i++) {
      const path = segs.slice(0, i).join('/');
      if (!entries.some((e) => e.path === path && sameInstance(e))) continue;
      await this.reinstateFolder(owner, path, instanceId);
      restored += 1;
    }
    if (restored) appLog.info('file', `文件恢复时一并恢复目录链：${f}`, `共恢复 ${restored} 级目录`);
    return restored;
  }

  /**
   * v1.0.2：彻底删除后，把「因此变空」的目录登记与属性快照一并清掉。
   *
   * 场景（用户反馈）：本地存储渠道里最后一张图被彻底删除 → 物理目录已被适配器递归回收，
   * 但 settings.extraFolders 的登记和 FolderMeta 行还在，文件管理里仍留着一个点进去空空的条目。
   * 处理：从最深一级往上走，只要该路径下（含子目录）已无 active 文件，
   * 就摘掉登记 + 删掉属性行；遇到第一个非空层级立刻停止（更上层必然也非空）。
   * 只删「确实变空」的层级，不碰还有文件的目录。
   */
  private async cleanupEmptiedFolderChain(owner: string, folder: string, instanceId = ''): Promise<number> {
    const f = String(folder || '').replace(/^\/+|\/+$/g, '').trim();
    if (!f) return 0;
    const segs = f.split('/').filter(Boolean);
    let cleaned = 0;
    for (let i = segs.length; i >= 1; i--) {
      const path = segs.slice(0, i).join('/');
      try {
        const under = await prisma.fileRecord.count({
          where: {
            status: 'active',
            instanceId,
            ...(owner ? { uploader: owner } : {}),
            OR: [{ folder: path }, { folder: { startsWith: `${path}/` } }],
          },
        });
        if (under > 0) break;
        const removedReg = await this.unregisterFolders(owner, path, instanceId);
        const delMeta = await prisma.folderMeta.deleteMany({
          where: { path, instanceId, type: FOLDER_TYPE_FILE, ...(owner ? { owner } : {}) },
        });
        if (removedReg || delMeta.count) cleaned += 1;
      } catch (err) {
        appLog.warn('file', `空目录登记清理失败：${path}`, (err as Error).message);
        break;
      }
    }
    if (cleaned) {
      appLog.info('file', `彻底删除后已清理空目录登记：${f}`, `共清理 ${cleaned} 级（登记 + 目录属性）`);
    }
    return cleaned;
  }

  /** 彻底删除回收站里的文件夹：清登记 + 连带清掉该前缀下所有软删文件记录 */
  private async purgeFolderEntry(owner: string, path: string, instanceId = ''): Promise<number> {
    await this.removeDeletedFolder(owner, path);
    const rows = await prisma.fileRecord.findMany({
      where: {
        status: 'deleted',
        ...(owner ? { uploader: owner } : {}),
        OR: [{ folder: path }, { folder: { startsWith: `${path}/` } }],
      },
      select: { id: true, name: true },
    });
    let n = 0;
    for (const r of rows) {
      try {
        await this.uploadSvc.removeFile(r.id, r.name);
        n++;
      } catch (err) {
        appLog.warn('file', `回收站目录连带删除失败：${r.name}`, (err as Error).message);
      }
    }
    /*
     * v1.0.2：目录连同内容一起彻底删除后，属性的残行与「变空的上级目录」登记也要清掉，
     * 否则文件管理里会留下点进去空空的条目（用户反馈的原问题）。
     */
    try {
      await prisma.folderMeta.deleteMany({
        where: {
          type: FOLDER_TYPE_FILE,
          ...(instanceId ? { instanceId } : {}),
          ...(owner ? { owner } : {}),
          OR: [{ path }, { path: { startsWith: `${path}/` } }],
        },
      });
      await this.cleanupEmptiedFolderChain(owner, path, instanceId);
    } catch (err) {
      appLog.warn('file', `回收站目录彻底删除后清理登记失败：${path}`, (err as Error).message);
    }
    appLog.info('file', `回收站目录已彻底删除：${path}`, `连带文件 ${n} 条（已恢复到别处/重建目录中的活跃文件不受影响）`);
    return n;
  }

  /**
   * v3.0.0（R14）：回收站「彻底删除」的两步验证闸门。
   * 仅当当前账户开启 2FA 时要求验证（TOTP 动态码）；未开启 / 无会话 → 放行。
   * 返回 null = 放行；否则返回给前端的响应体（needTotp=true，前端据此弹验证框重试）。
   */
  private async verifyTrashTotp(
    req: Request,
    code = '',
  ): Promise<{ success: false; needTotp: true; message: string } | null> {
    const me = currentSession(req)?.user || '';
    if (!me) return null;
    const u = await prisma.user.findUnique({
      where: { username: me },
      select: { totpEnabled: true, totpSecret: true },
    });
    if (!u || !u.totpEnabled || !u.totpSecret) return null;
    const c = String(code || '').trim();
    if (!c) {
      appLog.warn('file', `彻底删除被拦截：账户已开启两步验证`, `user=${me}`);
      return { success: false, needTotp: true, message: '该账户已开启两步验证，彻底删除需输入动态验证码' };
    }
    try {
      if (verifyTotp(CryptoService.decrypt(u.totpSecret), c)) return null;
    } catch {
      /* 解密失败按验证失败处理 */
    }
    appLog.warn('file', `彻底删除两步验证失败`, `user=${me}`);
    return { success: false, needTotp: true, message: '两步验证码不匹配' };
  }

  // ==========================================================================
  // v3.0.0 批量操作扩展（original-name / expiry / redirect / password / move）
  // ==========================================================================

  /** body.ids 归一化（数组、去空） */
  private bodyIds(body: { ids?: unknown }): string[] {
    return Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean) : [];
  }

  /** 批量取「当前用户有权操作」的完整记录（ids 兼容主键 id 与 File_ID/name） */
  private async loadOwned(ids: string[], req: Request) {
    if (!ids.length) return [];
    return prisma.fileRecord.findMany({
      where: {
        // v1.0.3：管理员同样只操作自己账户下的文件
        uploader: currentSession(req)?.user || '',
        OR: [{ id: { in: ids } }, { name: { in: ids } }],
      },
    });
  }

  /**
   * POST /api/manage/batch/original-name
   * body: { ids: string[], mode: replace|rewrite|prepend|append|ext, find?, replace?, value?, ext? }
   *   · replace —— originalName 中 find 全部替换为 replace
   *   · rewrite —— 擦除原名重写为 value；批内/库内重名时自动在扩展名前追加
   *                '-' + 13 位毫秒时间戳去重（value 自带扩展名则插在扩展名前）
   *   · prepend —— value 插到原名（含扩展名的整体名字）开头
   *   · append  —— value 插到扩展名之前
   *   · ext     —— 扩展名改为 ext（不带点也接受）
   * 返回 { updated, failed: [{id, error}] }；结果摘要写 appLog（域 manage）。
   */
  @Post('batch/original-name')
  async batchOriginalName(
    @Req() req: Request,
    @Body()
    body: { ids?: string[]; mode?: string; find?: string; replace?: string; value?: string; ext?: string },
  ) {
    if (!(await this.userPerm(req, 'edit'))) return { success: false, message: '没有编辑权限' };
    const ids = this.bodyIds(body);
    if (!ids.length) return { success: false, message: '缺少 ids' };
    const mode = String(body.mode || '');
    if (!['replace', 'rewrite', 'prepend', 'append', 'ext'].includes(mode)) {
      return { success: false, message: 'mode 不合法（replace / rewrite / prepend / append / ext）' };
    }
    // v3.0.0（R12）：只读共享目录内的文件不允许被接收方批量改原名
    const { ok: rows } = await this.dropReadonlyShared(await this.loadOwned(ids, req), req);
    const byKey = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      byKey.set(r.id, r);
      byKey.set(r.name, r);
    }

    const failed: { id: string; error: string }[] = [];
    const plan: { rec: (typeof rows)[number]; target: string }[] = [];
    for (const id of ids) {
      const rec = byKey.get(id);
      if (!rec) {
        failed.push({ id, error: '不存在或无权限' });
        continue;
      }
      const cur = rec.originalName;
      const dot = cur.lastIndexOf('.');
      const stem = dot > 0 ? cur.slice(0, dot) : cur;
      const ext = dot > 0 ? cur.slice(dot + 1) : '';
      let target = cur;
      try {
        if (mode === 'replace') {
          const find = String(body.find ?? '');
          if (!find) throw new Error('缺少 find');
          // v3.0.0：只在「主名」里替换，扩展名原样保留（即使 find 命中扩展名也不改后缀）
          const replaced = stem.split(find).join(String(body.replace ?? ''));
          if (!replaced.trim()) throw new Error('替换后名称为空');
          target = replaced + (ext ? `.${ext}` : '');
        } else if (mode === 'rewrite') {
          const value = String(body.value ?? '').trim();
          if (!value) throw new Error('缺少 value');
          // v3.0.0：value 自带扩展名则按 value 的扩展名（视为主动改后缀）；
          // 不带扩展名时补回原扩展名，保证「重写主名不丢后缀」。
          const hasExt = /\.[A-Za-z0-9]{1,12}$/.test(value);
          target = hasExt || !ext ? value : `${value}.${ext}`; // 重名去重在下方统一插入时间戳
        } else if (mode === 'prepend') {
          target = String(body.value ?? '') + cur;
        } else if (mode === 'append') {
          target = stem + String(body.value ?? '') + (ext ? `.${ext}` : '');
        } else if (mode === 'ext') {
          const e = String(body.ext ?? '').replace(/^\.+/, '').trim();
          if (!e) throw new Error('缺少 ext');
          target = `${stem}.${e}`;
        }
      } catch (err) {
        failed.push({ id, error: (err as Error).message });
        continue;
      }
      if (!target || target === cur) {
        failed.push({ id, error: '新名称为空或未变化' });
        continue;
      }
      plan.push({ rec, target });
    }

    /*
     * rewrite 的重名去重：目标名与「批内已占用」或「库内其它记录」冲突时，
     * 自动在扩展名前追加 '-' + 13 位毫秒时间戳；同毫秒仍撞再补序号，
     * 保证库内 originalName 不重复（同名多条各自加）。
     */
    const taken = new Set<string>();
    if (plan.length) {
      const exists = await prisma.fileRecord.findMany({
        where: {
          originalName: { in: plan.map((u) => u.target) },
          NOT: { id: { in: plan.map((u) => u.rec.id) } },
        },
        select: { originalName: true },
      });
      for (const e of exists) taken.add(e.originalName);
    }
    const applied: { rec: (typeof rows)[number]; target: string }[] = [];
    for (const u of plan) {
      let target = u.target;
      if (taken.has(target)) {
        const dot = target.lastIndexOf('.');
        const ts = String(Date.now());
        const withTs = (base: string, suffix: string) => {
          const d = base.lastIndexOf('.');
          return d > 0 ? `${base.slice(0, d)}-${suffix}${base.slice(d)}` : `${base}-${suffix}`;
        };
        target = withTs(target, ts);
        let n = 1;
        while (taken.has(target)) target = withTs(u.target, `${ts}-${n++}`);
      }
      taken.add(target);
      applied.push({ rec: u.rec, target });
    }

    let updated = 0;
    for (const u of applied) {
      try {
        await prisma.fileRecord.update({ where: { id: u.rec.id }, data: { originalName: u.target } });
        updated += 1;
      } catch (err) {
        failed.push({ id: u.rec.id, error: (err as Error).message });
      }
    }
    appLog.info('manage', `批量改名完成：mode=${mode}`, `总数=${ids.length} 更新=${updated} 失败=${failed.length}`);
    return { success: failed.length === 0, updated, failed };
  }

  /**
   * POST /api/manage/batch/expiry
   * body: { ids, linkExpiresAt: ISO字符串 | '' }（''=取消限时，恢复永久有效）。
   * 复用单文件设置的字段语义（FileRecord.linkExpiresAt）。
   */
  @Post('batch/expiry')
  async batchExpiry(@Req() req: Request, @Body() body: { ids?: string[]; linkExpiresAt?: string }) {
    if (!(await this.userPerm(req, 'edit'))) return { success: false, message: '没有编辑权限' };
    const ids = this.bodyIds(body);
    if (!ids.length) return { success: false, message: '缺少 ids' };
    // v3.0.0（R12）：只读共享目录内的文件不允许被接收方批量设限时
    const { ok: rows } = await this.dropReadonlyShared(await this.loadOwned(ids, req), req);
    const raw = String(body?.linkExpiresAt ?? '');
    let at: Date | null = null;
    if (raw) {
      const t = Date.parse(raw);
      if (!Number.isFinite(t)) return { success: false, message: 'linkExpiresAt 不是合法的时间字符串' };
      at = new Date(t);
    }
    const failed: { id: string; error: string }[] = [];
    let updated = 0;
    for (const r of rows) {
      try {
        await prisma.fileRecord.update({ where: { id: r.id }, data: { linkExpiresAt: at } });
        updated += 1;
      } catch (err) {
        failed.push({ id: r.id, error: (err as Error).message });
      }
    }
    appLog.info('manage', `批量限时${raw ? '设置' : '取消'}完成`, `更新=${updated} 失败=${failed.length}`);
    return { success: true, updated, failed };
  }

  /**
   * POST /api/manage/batch/redirect
   * body: { ids, redirectUrl }（''=取消重定向）。URL 校验与单文件设置一致（http/https）。
   */
  @Post('batch/redirect')
  async batchRedirect(@Req() req: Request, @Body() body: { ids?: string[]; redirectUrl?: string }) {
    if (!(await this.userPerm(req, 'edit'))) return { success: false, message: '没有编辑权限' };
    const ids = this.bodyIds(body);
    if (!ids.length) return { success: false, message: '缺少 ids' };
    // v3.0.0（R12）：只读共享目录内的文件不允许被接收方批量设重定向
    const { ok: rows } = await this.dropReadonlyShared(await this.loadOwned(ids, req), req);
    const url = String(body?.redirectUrl ?? '').trim();
    if (url) {
      try {
        const u = new URL(url);
        if (!['http:', 'https:'].includes(u.protocol)) return { success: false, message: '仅支持 http/https 地址' };
      } catch {
        return { success: false, message: 'URL 格式不正确' };
      }
    }
    const failed: { id: string; error: string }[] = [];
    let updated = 0;
    for (const r of rows) {
      try {
        await prisma.fileRecord.update({ where: { id: r.id }, data: { redirectUrl: url } });
        updated += 1;
      } catch (err) {
        failed.push({ id: r.id, error: (err as Error).message });
      }
    }
    appLog.info('manage', `批量重定向${url ? '设置' : '取消'}完成`, `更新=${updated} 失败=${failed.length}`);
    return { success: true, updated, failed };
  }

  /** 文件级加密写入：metas.AccessPasswordHash = sha256（''=清除），其余 metas 保持不变 */
  private async applyFilePassword(rec: { id: string; metas: string }, password: string): Promise<void> {
    const metas = safeParse(rec.metas);
    if (String(password || '')) metas.AccessPasswordHash = sha256Hex(String(password));
    else delete metas.AccessPasswordHash;
    await prisma.fileRecord.update({ where: { id: rec.id }, data: { metas: JSON.stringify(metas) } });
  }

  /**
   * POST /api/manage/batch/password
   * body: { ids, password }（password 空串 = 清除文件级加密）。
   */
  @Post('batch/password')
  async batchPassword(@Req() req: Request, @Body() body: { ids?: string[]; password?: string }) {
    if (!(await this.userPerm(req, 'edit'))) return { success: false, message: '没有编辑权限' };
    const ids = this.bodyIds(body);
    if (!ids.length) return { success: false, message: '缺少 ids' };
    // v3.0.0（R12）：只读共享目录内的文件不允许被接收方批量改访问密码
    const { ok: rows } = await this.dropReadonlyShared(await this.loadOwned(ids, req), req);
    const failed: { id: string; error: string }[] = [];
    let updated = 0;
    for (const r of rows) {
      try {
        await this.applyFilePassword(r, String(body?.password ?? ''));
        updated += 1;
      } catch (err) {
        failed.push({ id: r.id, error: (err as Error).message });
      }
    }
    appLog.info('manage', `批量${String(body?.password || '') ? '设置' : '清除'}文件密码完成`, `更新=${updated} 失败=${failed.length}`);
    return { success: true, updated, failed };
  }

  /**
   * POST /api/manage/:id/password
   * 单文件加密：{ password }（空串 = 清除）。metas.AccessPasswordHash = sha256。
   * 注意路由顺序：必须声明在 batch/* 之后，避免 ':id' 吃掉 'batch' 字面量。
   */
  @Post(':id/password')
  async setPassword(@Req() req: Request, @Param('id') id: string, @Body() body: { password?: string }) {
    if (!(await this.userPerm(req, 'edit'))) return { success: false, message: '没有编辑权限' };
    const owner = currentSession(req)?.user || '';
    const rec = await this.resolveFile(id, owner);
    if (!rec) return { success: false, message: '文件不存在' };
    await this.applyFilePassword(rec, String(body?.password ?? ''));
    appLog.info('manage', `文件密码已${String(body?.password || '') ? '设置' : '清除'}：${rec.name}`);
    return { success: true, data: { name: rec.name, encrypted: !!String(body?.password || '') } };
  }

  /**
   * POST /api/manage/batch/move
   * body: { ids, folder?, instanceId? }
   * 移动到目标目录（folder 空串 = 根目录）；v3.0.0 支持跨实例 ——
   * body.instanceId 会直接改写 FileRecord.instanceId，未同时给 folder 时落到目标实例根目录 ''。
   *
   * v3.0.0 补齐：
   *   · 目标实例必须存在（instanceId 非空时查 Instance，不存在返回 400；空串 = 默认实例，无实体行）；
   *   · 响应补充 { moved, instanceId }（moved 与历史字段 updated 同值，兼容旧前端）；
   *   · 日志统一为「[manage] 批量移动 n 个文件 → 实例 <id|default>」；
   *   · 文件的渠道副本（FileCopy）不随实例变化 —— 存储层 key 与实例无关，无需改写。
   */
  @Post('batch/move')
  async batchMove(
    @Req() req: Request,
    @Body() body: { ids?: string[]; folders?: string[]; folder?: string; instanceId?: string; fromInstanceId?: string },
  ) {
    if (!(await this.userPerm(req, 'edit'))) return { success: false, message: '没有编辑权限' };
    const ids = this.bodyIds(body);
    /*
     * v3.0.0（R12）：目录移动并入本接口。
     * 原先目录走 GET /api/manage/move（compat 控制器，AdminGuard）——
     * 普通用户一律 403，管理员移动后目录名还会被拍平（dist/suffix 丢掉了目录自身层级），
     * 表现就是「选中文件夹移动不成功」。现在与文件同一入口、同一套权限：
     *   · 目录内的记录按前缀重写 folder（保留目录名与内部层级）；
     *   · FolderMeta（目录属性 / 共享 / 加密）跟着搬家，属性不会丢。
     */
    const folders = (Array.isArray(body?.folders) ? body.folders : [])
      .map((f) => normalizeFolderPath(String(f || '')))
      .filter(Boolean);
    if (!ids.length && !folders.length) return { success: false, message: '缺少 ids' };
    if (body?.folder === undefined && body?.instanceId === undefined) {
      return { success: false, message: '缺少 folder 或 instanceId' };
    }
    // undefined = 不改实例；'' = 默认实例；其余 = 指定实例（必须已存在）
    const targetInstance = body?.instanceId !== undefined ? String(body.instanceId ?? '') : undefined;
    /*
     * v1.0.2：源实例（可选）。跨实例移动时必须知道「从哪个实例搬走」，
     * 否则源数据按目标实例过滤会一条都查不到（移动看起来没生效）。
     */
    const fromInstance = body?.fromInstanceId !== undefined ? String(body.fromInstanceId ?? '') : undefined;
    if (targetInstance) {
      const inst = await prisma.instance.findUnique({ where: { id: targetInstance }, select: { id: true } });
      if (!inst) throw new BadRequestException('目标实例不存在');
      /*
       * v1.0.1：跨实例移动只允许「移动到我有权限的实例」——
       * 原来只校验实例是否存在，普通用户可以把文件塞进别人的实例里。
       * 默认实例（空串）是每个账户自己的初始空间，恒放行（canAccessInstance 内部处理）。
       */
      if (!(await this.canAccessInstance(req, targetInstance))) {
        return { success: false, message: '无权移动到该实例' };
      }
    }
    const data: { folder?: string; instanceId?: string } = {};
    if (targetInstance !== undefined) data.instanceId = targetInstance;
    if (body?.folder !== undefined) data.folder = normalizeFolderPath(String(body.folder));
    // 跨实例移动但没指定目录 → 落到目标实例根目录
    else if (targetInstance !== undefined) data.folder = '';
    const failed: { id: string; error: string }[] = [];
    let moved = 0;
    // v1.0.1：跨实例移动时复制过去的标签关联条数（仅用于日志与响应）
    let tagCopied = 0;

    // ---------- 目录移动 ----------
    let movedFolders = 0;
    // v3.0.0（R12）：随目录一起搬家的「登记空目录」条数（日志与响应都带上）
    let movedRegistered = 0;
    if (folders.length) {
      const me = currentSession(req)?.user || '';
      const isAdmin = this.admin(req);
      const distBase = data.folder !== undefined ? data.folder : '';
      /*
       * v1.0.2：跨实例移动目录时的「源实例」——
       * 旧实现用 targetInstance 过滤源数据，跨实例时源行（在 A 实例）一条都查不到，
       * 表现就是「移动到另一个实例不生效」。现在区分 fromInstanceId（源）/ instanceId（目标）：
       *   · 前端会同时传两个；只传 instanceId 的老调用方按「同实例移动」处理。
       */
      const srcInstKey = fromInstance !== undefined
        ? String(fromInstance)
        : (targetInstance !== undefined ? String(targetInstance) : undefined);
      const dstInstKey = targetInstance !== undefined ? String(targetInstance) : srcInstKey;
      const srcInstWhere = srcInstKey !== undefined ? { instanceId: srcInstKey } : {};
      for (const f of folders) {
        // 只读共享目录不可移动（共享接收方）
        if (me) {
          // 同实例内移动时 targetInstance 就是当前实例；跨实例时按默认实例兜底判断
          const info = await folderSharedPermission(f, targetInstance || '', me);
          if (info.shared && info.perm === 'readonly') {
            failed.push({ id: f, error: '只读共享目录，不允许移动' });
            continue;
          }
        }
        const leaf = f.split('/').filter(Boolean).pop() || '';
        const newRoot = [distBase, leaf].filter(Boolean).join('/');
        /*
         * v1.0.2：按「源实例」取目录下的记录（同实例移动时源 = 目标，行为不变）。
         * instanceId 未给的老调用方保持原样（不按实例收窄）。
         */
        const moveInst = srcInstWhere;
        const rowsInFolder = await prisma.fileRecord.findMany({
          where: {
            ...(isAdmin ? {} : { uploader: me }),
            ...moveInst,
            OR: [{ folder: f }, { folder: { startsWith: `${f}/` } }],
          },
          select: { id: true, folder: true, instanceId: true, uploader: true },
        });
        for (const r of rowsInFolder) {
          const suffix = String(r.folder || '').slice(f.length).replace(/^\/+/, '');
          try {
            const fromInst = String(r.instanceId || '');
            const toInst = targetInstance !== undefined ? String(targetInstance) : fromInst;
            await prisma.fileRecord.update({
              where: { id: r.id },
              data: {
                folder: suffix ? `${newRoot}/${suffix}` : newRoot,
                ...(targetInstance !== undefined ? { instanceId: targetInstance } : {}),
              },
            });
            // v1.0.1：目录跨实例搬家时，目录内文件的标签同样复制到目标实例
            if (targetInstance !== undefined && toInst !== fromInst) {
              tagCopied += await this.copyTagsToInstance(r.id, fromInst, toInst, r.uploader || '');
            }
            moved += 1;
          } catch (err) {
            failed.push({ id: r.id, error: (err as Error).message });
          }
        }
        // 目录属性（加密 / 共享 / 访客图库标记 / 自定义名称）跟着搬家
        try {
          const metas = await prisma.folderMeta.findMany({
            where: { ...moveInst, type: FOLDER_TYPE_FILE, OR: [{ path: f }, { path: { startsWith: `${f}/` } }] },
          });
          for (const m of metas) {
            const suffix = String(m.path || '').slice(f.length).replace(/^\/+/, '');
            const nextPath = suffix ? `${newRoot}/${suffix}` : newRoot;
            try {
              await prisma.folderMeta.update({
                where: { id: m.id },
                data: {
                  path: nextPath,
                  ...(targetInstance !== undefined ? { instanceId: targetInstance } : {}),
                },
              });
            } catch (err) {
              /*
               * v1.0.2：目标目录已存在同名属性行 → 合并（保留目标已有配置，丢弃被搬过来的这条），
               * 否则唯一键 [owner, instanceId, path] 冲突会让整个目录移动报错。
               */
              if ((err as { code?: string }).code === 'P2002') {
                await prisma.folderMeta.delete({ where: { id: m.id } }).catch(() => undefined);
              } else {
                throw err;
              }
            }
          }
        } catch (err) {
          appLog.warn('file', `目录属性搬家失败：${f}`, (err as Error).message);
        }
        /*
         * v3.0.0（R12）：空目录（「新建目录」登记、无任何文件记录）也要搬家 ——
         * 它们只存在于 settings.extraFolders，不改写就会出现「移动后旧目录还在」的假失败。
         * v1.0.2：跨实例移动时从「源实例」的键搬到「目标实例」的键。
         */
        try {
          movedRegistered += await this.moveRegisteredFolders(
            isAdmin ? '' : me,
            [f],
            distBase,
            srcInstKey ?? '',
            dstInstKey ?? '',
          );
        } catch (err) {
          appLog.warn('file', `登记目录搬家失败：${f}`, (err as Error).message);
        }
        movedFolders += 1;
      }
    }

    // ---------- 文件移动 ----------
    // v3.0.0（R12）：只读共享目录内的文件不允许被接收方移动
    const { ok: rows } = await this.dropReadonlyShared(await this.loadOwned(ids, req), req);
    for (const r of rows) {
      try {
        /*
         * v1.0.2：给了源实例时必须对得上 —— 防止在 A 实例里误把 B 实例的同 id 记录搬走。
         */
        if (fromInstance !== undefined && String(r.instanceId || '') !== String(fromInstance)) {
          failed.push({ id: r.id, error: '文件不属于当前实例' });
          continue;
        }
        const fromInst = String(r.instanceId || '');
        const toInst = targetInstance !== undefined ? String(targetInstance) : fromInst;
        await prisma.fileRecord.update({ where: { id: r.id }, data });
        /*
         * v1.0.1：跨实例移动时把标签「复制」过去（源实例的标签保留在原实例，不搬走）。
         * 目标实例里已有同名标签则直接复用，避免重复创建。
         */
        if (targetInstance !== undefined && toInst !== fromInst) {
          const n = await this.copyTagsToInstance(r.id, fromInst, toInst, r.uploader || '');
          if (n) tagCopied += n;
        }
        moved += 1;
      } catch (err) {
        failed.push({ id: r.id, error: (err as Error).message });
      }
    }
    const dirText = data.folder === undefined ? '(不变)' : data.folder || '(根目录)';
    appLog.info(
      'manage',
      `批量移动 ${rows.length} 个文件 / ${movedFolders} 个目录 → 实例 ${targetInstance !== undefined ? targetInstance || 'default' : '(不变)'}`,
      `请求 ${ids.length} 个文件，成功 ${moved} 条记录，失败 ${failed.length} 个 ｜ 目标目录=${dirText}${tagCopied ? ` ｜ 复制标签 ${tagCopied} 条` : ''}`,
    );
    return {
      success: true,
      moved,
      movedFolders,
      movedRegistered,
      // v1.0.1：跨实例移动时复制过去的标签关联条数
      tagCopied,
      // 兼容旧字段：历史调用方读的是 updated
      updated: moved,
      ...(targetInstance !== undefined ? { instanceId: targetInstance } : {}),
      failed,
    };
  }

  /**
   * v1.0.1：实例归属校验（管理端控制器用）。
   * 与标签控制器那个同名方法走同一套判定（common/instance-access），避免两处漂移。
   */
  private async canAccessInstance(req: Request, instanceId: string): Promise<boolean> {
    if (this.admin(req)) return true;
    return userInInstance(currentSession(req)?.user || '', instanceId);
  }

  /**
   * v1.0.1：跨实例移动文件时把标签复制到目标实例。
   *
   * 语义是「复制」而不是「搬走」——源实例下的标签与关联原样保留，
   * 目标实例里按 (name, instanceId, owner) 找同一条标签：
   *   · 已存在 → 直接复用（不重复创建，也不覆盖原有 metas）；
   *   · 不存在 → 新建一条，继承源标签的 metas（颜色等展示属性）。
   * 返回新增的文件-标签关联条数。
   */
  private async copyTagsToInstance(
    fileId: string,
    fromInst: string,
    toInst: string,
    fallbackOwner = '',
  ): Promise<number> {
    if (String(fromInst) === String(toInst)) return 0;
    let copied = 0;
    try {
      const links = await prisma.fileTag.findMany({ where: { fileId }, include: { tag: true } });
      for (const link of links) {
        const src = link.tag;
        if (!src) continue;
        // 该关联已经指向目标实例的标签（历史脏数据）→ 无需复制
        if (String(src.instanceId || '') === String(toInst)) continue;
        /*
         * v1.0.2：目标实例里按「实例 + 类型 + 名称」复用同名标签（实例内只有一条），
         * 没有才新建；owner 记为创建人（源标签的创建人优先，回落到文件上传者）。
         */
        const target = await findOrCreateTag(
          src.name,
          toInst,
          String(src.owner || fallbackOwner || ''),
          String((src as { type?: string }).type || TAG_TYPE_FILE),
        );
        // 目标标签的展示属性（颜色等）以源标签为准补齐 —— 已有则不覆盖
        const srcMetas = String(src.metas || '{}');
        if (srcMetas && srcMetas !== '{}' && String(target.metas || '{}') === '{}') {
          await prisma.tag.update({ where: { id: target.id }, data: { metas: srcMetas } }).catch(() => undefined);
        }
        const exists = await prisma.fileTag.findFirst({
          where: { fileId, tagId: target.id },
          select: { id: true },
        });
        if (!exists) {
          await prisma.fileTag.create({ data: { fileId, tagId: target.id } });
          copied += 1;
        }
      }
    } catch (err) {
      // 标签复制失败不影响文件本身已经搬家成功，只记日志便于排查
      appLog.warn('manage', `跨实例移动时复制标签失败：${fileId}`, (err as Error).message);
    }
    return copied;
  }

  /**
   * 渠道直链解析器 —— 交给 buildMetadata 计算「该文件在存储/备份渠道内的真实直链」。
   *
   * 文件详情里点击「存储渠道 / 备份渠道」，需要跳转到文件在该渠道上的真实地址，
   * 例如 S3 桶里的对象 URL、WebDAV 服务器上的真实路径、自定义接口返回的原始外链。
   * 直链不落库，全部按渠道【当前配置】实时构造（改域名/桶后立即生效）。
   *
   * 按渠道 ID 缓存解密后的配置，避免列表页逐条文件重复做 AES 解密。
   */
  private directUrlResolver(preferInternal = false): (copy: CopyWithChannel, rec?: FileRecord) => string | null {
    const infoCache = new Map<string, ChannelInfo>();
    return (copy: CopyWithChannel, rec?: FileRecord): string | null => {
      const ch = copy.channel;
      if (!ch) return null;
      try {
        let info = infoCache.get(ch.id);
        if (!info) {
          info = {
            id: ch.id,
            name: ch.name,
            type: ch.type,
            config: this.channelsSvc.decryptConfig(ch.type, ch.config),
            metas: {},
          };
          infoCache.set(ch.id, info);
        }
        /*
         * v2.9.0：登记文件（remoteUrl 为空、remoteKey 存的是渠道内路径）——
         * 用渠道「当前」的实际加载域名拼路径。这里是详情页展示用的源链接，
         * 优先进公开访问域名（内网地址在浏览器里打不开），见 recordLoadOrigin。
         */
        /*
         * v3.0.0（R10）：登记文件现在也落 objectPath，直接走适配器的统一拼装；
         * 下面的旧分支只服务「objectPath 为空」的历史登记数据。
         */
        if (
          !copy.objectPath &&
          !copy.remoteUrl &&
          copy.remoteKey &&
          isRecordFile(rec) &&
          hasRecordDomains(info.config, ch.type)
        ) {
          const url = joinRecordUrl(
            recordLoadOrigin(info.config, preferInternal, ch.type),
            ensureBucketInKey(ch.type, info.config, copy.remoteKey),
          );
          if (url) {
            // v3.0.0（R15）：对外展示时同样净化成公网域名（Endpoint 可能是内网 / 容器名）
            return preferInternal ? url : publicizeExternalUrl(url, ch.type, info.config);
          }
        }
        /*
         * v3.0.0（R15）：「存储渠道 / 备份渠道」展示的是**对外**地址 ——
         * 这里只走构建直链（preferInternal=false），并把结果净化成公网域名：
         * 拼出来是内网 IP / 容器名时改用渠道「公开访问域名」重拼，
         * 没有公开域名则返回空串（前端显示「无对外直链」，不回退本站内网地址）。
         */
        if (!preferInternal) {
          const built = createAdapter(info).buildDirectUrl(toCopyInfo(copy), info, false);
          return publicizeExternalUrl(built, ch.type, info.config);
        }
        return createAdapter(info).buildDirectUrl(toCopyInfo(copy), info, preferInternal);
      } catch {
        return null;
      }
    };
  }

  /** 重命名 */
  /**
   * 重命名 File_ID（即外链标识 /file/:name）。
   * 前端用 POST + `{newFileId}`，这里同时兼容 PATCH 与 `{newName}`。
   *
   * 与原系统的差异：GoHub 的外链由本系统签发、远端只存 key，
   * 因此重命名只改本系统的标识与目录归属，无需搬动远端对象，
   * 旧外链会立即失效、新外链立即可用。
   */
  @Post('rename/*')
  renamePost(@Req() req: Request, @Body() body: RenameBody) {
    return this.doRename(wildcardParam(req), body, req);
  }

  /**
   * v2.9.0：「生成名称」—— 生成 48 位「大小写字母 + 数字」随机 File_ID，
   * 并与库中已有的 name 去重；只生成不写库，点「确认重命名」才落库。
   */
  @Get('rename/generate')
  async generateRenameName(@Req() req: Request) {
    if (!(await this.userPerm(req, 'edit'))) throw new ForbiddenException('没有编辑权限');
    for (let i = 0; i < 30; i += 1) {
      const candidate = CryptoService.fileId(48);
      const dup = await prisma.fileRecord.findFirst({ where: { name: candidate }, select: { id: true } });
      if (!dup) return { success: true, name: candidate };
    }
    appLog.warn('file', '生成重命名候选失败：连续 30 次与库中已有名称重复', '');
    throw new BadRequestException('生成名称失败，请重试');
  }

  @Patch('rename/*')
  rename(@Req() req: Request, @Body() body: RenameBody) {
    return this.doRename(wildcardParam(req), body, req);
  }

  private async doRename(oldId: string, body: RenameBody, req: Request) {
    if (!(await this.userPerm(req, 'edit'))) throw new ForbiddenException('没有编辑权限');
    const target = String(body.newFileId ?? body.newName ?? '').trim();
    if (!target) throw new BadRequestException('缺少 newFileId');

    const owner = currentSession(req)?.user || '';
    const rec = await this.resolveFile(oldId, owner);
    if (!rec) throw new NotFoundException('文件不存在');
    if (target === rec.name) throw new BadRequestException('文件名未发生变化');

    // 路径规范化：反斜杠转正、压缩重复斜杠、去掉路径穿越
    const newId = target
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/')
      .replace(/^\/+/, '')
      .replace(/\.\./g, '_');
    if (!newId) throw new BadRequestException('文件名不能为空');

    const conflict = await prisma.fileRecord.findFirst({ where: { name: newId, NOT: { id: rec.id } } });
    if (conflict) throw new ConflictException('目标文件名已存在');

    /*
     * v2.8.9：重定向地址里嵌着旧 File_ID（如 /file/oldname）时同步替换 ——
     * 不替换的话重命名后 /file/:newName 命中 redirectUrl 仍跳旧名 → 404，文件加载不出来。
     */
    const oldRedirect = String((rec as unknown as { redirectUrl?: string }).redirectUrl || '');
    const newRedirect = oldRedirect && oldRedirect.includes(rec.name) ? oldRedirect.split(rec.name).join(newId) : oldRedirect;

    /*
     * v2.9.0：重命名**只改 name 一个字段**。
     * 之前这里会把「新名字里的目录层级」写回 folder —— 生成的是 48 位随机串（不含目录），
     * 于是 folder 被清空、文件被自动挪到根目录，看起来像「分类被清除了」。
     * 文件的分类归属与 name 无关，必须保持原值。
     */
    const updated = await prisma.fileRecord.update({
      where: { id: rec.id },
      data: {
        name: newId,
        ...(newRedirect !== oldRedirect ? { redirectUrl: newRedirect } : {}),
        // 重命名历史（v2.3.0）：把「改之前叫什么」记到 prevName，
        // firstName 只在第一次重命名时补写（老数据可能为空）。
        // 这样改名改花了也能一键回到初始名 / 上一次的名字。
        prevName: rec.name,
        firstName: (rec as unknown as { firstName?: string }).firstName || rec.name,
      },
      include: { copies: { include: { channel: true } }, tags: { include: { tag: true } } },
    });

    appLog.info('file', `重命名：${rec.name} → ${newId}`);

    return {
      success: true,
      newFileId: newId,
      metadata: serializeFile(updated, updated.copies, { tags: updated.tags.map((t) => t.tag.name), resolveDirectUrl: this.directUrlResolver(), resolveLoadUrl: this.directUrlResolver(true) }).metadata,
    };
  }

  /** 元数据读写（metas 字段） */
  /**
   * 兼容前端契约：前端把「File_ID」（= /file/:name 的标识）当作 fileId 传参，
   * 因此这里同时接受 name / 去扩展名的 name / 数据库主键 id 三种写法。
   */
  private async resolveFile(fileId: string, owner = '') {
    const key = String(fileId || '');
    const bare = key.replace(/\.[^.]*$/, '');
    return prisma.fileRecord.findFirst({
      where: { ...(owner ? { uploader: owner } : {}), OR: [{ id: key }, { name: key }, { name: bare }] },
      include: { copies: { include: { channel: true } }, tags: { include: { tag: true } } },
    });
  }

  @Get('metadata/*')
  async getMeta(@Req() req: Request) {
    const owner = currentSession(req)?.user || '';
    const rec = await this.resolveFile(wildcardParam(req), owner);
    if (!rec) return { success: false, message: '文件不存在' };
    const metadata = serializeFile(rec, rec.copies, {
      tags: rec.tags.map((t) => t.tag.name),
      resolveDirectUrl: this.directUrlResolver(), resolveLoadUrl: this.directUrlResolver(true),
    }).metadata as Record<string, unknown>;
    // 限时：把截止时间带给前端（0 = 永久）
    metadata.LinkExpiresAt = rec.linkExpiresAt ? rec.linkExpiresAt.getTime() : 0;
    // v2.6.0 #301：全系统 IP 显示统一 —— 详情页直接拿格式化后的展示文本
    try {
      const m: any = metadata;
      if (m.UploadIP) {
        const r = await ipDisplayOf(String(m.UploadIP), String(m.UploadAddress || ''), this.sysConfig);
        m.IpDisplay = r.display;
        if (r.address) m.UploadAddress = r.address;
      }
    } catch {
      /* 忽略 */
    }
    return {
      success: true,
      data: {
        metas: rec.metas,
        name: rec.name,
        // 文件备注：作者本人或管理员可见（v2.4.0 起管理员放开 ——
        // 上传者账户被删/改名后，原「仅作者」规则会让备注对所有现存账户永久不可见）
        ...(this.canUseNote(req, rec) ? { note: rec.note, Note: rec.note } : {}),
        metadata,
      },
    };
  }

  /**
   * 是否是文件的「作者」（上传者本人）。
   * 历史数据 uploader 为空时（早期版本 / 管理员直传），仅管理员视为作者。
   */
  private isAuthor(req: Request, rec: { uploader?: string | null }): boolean {
    const me = currentSession(req)?.user || '';
    if (!me) return false;
    const up = String(rec.uploader || '');
    if (up) return up === me;
    return this.admin(req);
  }

  /** 备注/Note 的可见与可写判定：作者本人，或管理员（v2.4.0） */
  private canUseNote(req: Request, rec: { uploader?: string | null }): boolean {
    return this.admin(req) || this.isAuthor(req, rec);
  }

  /**
   * v3.0.0（R14）：评分 / 评级可写判定 ——
   * 作者本人或管理员（canUseNote），或该文件所在目录「共享给我且权限为可编辑」的接收方。
   * 共享只读的接收方仍然不可评分（维持只读语义）。
   */
  private async canRate(
    req: Request,
    rec: { uploader?: string | null; folder?: string | null; instanceId?: string | null },
  ): Promise<boolean> {
    if (this.canUseNote(req, rec)) return true;
    const me = currentSession(req)?.user || '';
    if (!me) return false;
    try {
      const hit = await folderSharedPermission(rec.folder || '', rec.instanceId || '', me);
      return hit.shared && hit.perm === 'edit';
    } catch {
      return false;
    }
  }

  /**
   * 限时访问（v2.1.0）：设置 / 取消文件的访问截止时间。
   *   body: { seconds: 3600 }              —— 从现在起 N 秒后失效
   *         { expiresAt: "2026-10-20T12:00" } —— 指定截止时间（本地/ISO 字符串或毫秒时间戳）
   *         { clear: true }                  —— 取消限时，恢复永久有效
   * 权限：文件作者本人或管理员（普通用户还要有 canEdit 权限）。
   */
  @Post('expiry/*')
  async setExpiry(
    @Req() req: Request,
    @Body() body: { seconds?: number | string; expiresAt?: string | number | null; clear?: boolean },
  ) {
    if (!(await this.userPerm(req, 'edit'))) return { success: false, message: '没有编辑权限' };
    const owner = currentSession(req)?.user || '';
    const rec = await this.resolveFile(wildcardParam(req), owner);
    if (!rec) return { success: false, message: '文件不存在' };
    if (!this.isAuthor(req, rec)) return { success: false, message: '只有上传者本人可以设置限时' };

    let at: Date | null = null;
    if (!body?.clear) {
      if (body?.expiresAt !== undefined && body?.expiresAt !== null && body?.expiresAt !== '') {
        const raw = typeof body.expiresAt === 'number' ? body.expiresAt : Date.parse(String(body.expiresAt));
        if (!Number.isFinite(raw)) return { success: false, message: '截止时间格式不正确' };
        at = new Date(raw);
      } else {
        const sec = Number(body?.seconds);
        if (!Number.isFinite(sec) || sec <= 0) return { success: false, message: '请设置有效时长或截止时间' };
        at = new Date(Date.now() + sec * 1000);
      }
      if (at.getTime() <= Date.now()) return { success: false, message: '截止时间必须晚于当前时间' };
    }

    await prisma.fileRecord.update({ where: { id: rec.id }, data: { linkExpiresAt: at } });
    // 外链本身不变，但缓存必须失效：旧 200 不能被 CDN/浏览器继续复用
    return {
      success: true,
      data: { name: rec.name, LinkExpiresAt: at ? at.getTime() : 0, link: `${await this.linkPrefixSafe()}/${rec.name}` },
    };
  }

  /** 外链前缀（用于限时保存后回显完整链接；失败时回退空串） */
  private async linkPrefixSafe(): Promise<string> {
    try {
      const s = this.settings;
      const domain = await s.getServerDomain();
      return (await s.getLinkPrefix(domain)).replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  @Put('metadata/*')
  async putMeta(@Req() req: Request, @Body() body: { metas?: string | Record<string, unknown> }) {
    return this.saveMeta(req, body);
  }

  /**
   * 兼容前端契约：文件详情「编辑 → 保存」用的是 PATCH 方法。
   * 早期只注册了 PUT，导致详情里改名/改类型保存时报 404 —— 这里补一个别名。
   */
  @Patch('metadata/*')
  async patchMeta(@Req() req: Request, @Body() body: { metas?: string | Record<string, unknown> }) {
    return this.saveMeta(req, body);
  }

  private async saveMeta(req: Request, body: { metas?: string | Record<string, unknown> }) {
    if (!(await this.userPerm(req, 'edit'))) return { success: false, message: '没有编辑权限' };
    const owner = currentSession(req)?.user || '';
    const rec = await this.resolveFile(wildcardParam(req), owner);
    if (!rec) return { success: false, message: '文件不存在' };

    /*
     * 兼容两种入参形状：
     *   1) { metas: "<json>" } / { metas: {...} } —— 直接替换 metas（批量/脚本调用）
     *   2) { FileName, FileType }               —— 文件详情「编辑」的扁平字段（前端实际用这个）
     * 旧实现只认第 1 种：前端传扁平字段时 `body.metas` 为 undefined，
     * 会被当成空对象覆盖写回，把标签/备注等已有 metas 全部抹掉。这里按形状分开处理。
     */
    let metasRaw: string;
    const patch: { originalName?: string; folder?: string; note?: string; rating?: number; level?: number } = {};
    if (body && body.metas !== undefined) {
      metasRaw = typeof body.metas === 'string' ? body.metas : JSON.stringify(body.metas || {});
    } else {
      const cur = safeParse(rec.metas);
      const b = (body || {}) as Record<string, unknown>;
      // 文件备注（v2.1.0）：作者本人或管理员可写（v2.4.0 管理员放开）；存 note 列，不进 metas，避免被覆盖写回抹掉
      if (b.Note !== undefined || b.note !== undefined) {
        if (!this.canUseNote(req, rec)) return { success: false, message: '只有上传者本人或管理员可以编辑备注' };
        patch.note = String(b.Note ?? b.note ?? '').slice(0, 4000);
      }
      /*
       * v3.0.0（R8）：评分 / 等级 —— 详情页点星 / 点心直接存库。
       *   Rating：0-5 整数（v3.0.0 R14 起取消半星）；0 = 未评分。
       *   Level ：0-5 整数（爱心等级）；0 = 未设。
       * 权限（v3.0.0 R14 放宽）：作者本人 / 管理员，或该文件所在目录
       * 「共享给我且权限为可编辑」的接收方（canRate）；备注权限不变。
       */
      if (b.Rating !== undefined || b.rating !== undefined) {
        if (!(await this.canRate(req, rec))) return { success: false, message: '只有上传者本人、管理员或可编辑共享用户可以评分' };
        const raw = Number(b.Rating ?? b.rating);
        // v3.0.0（R14）：评分取消半星 —— 统一取整到 1..5（0 = 未评分；旧 0.5 步进数据按四舍五入显示）
        patch.rating = Number.isFinite(raw) ? Math.max(0, Math.min(5, Math.round(raw))) : 0;
      }
      if (b.Level !== undefined || b.level !== undefined) {
        if (!(await this.canRate(req, rec))) return { success: false, message: '只有上传者本人、管理员或可编辑共享用户可以设置等级' };
        const raw = Number(b.Level ?? b.level);
        patch.level = Number.isFinite(raw) ? Math.max(0, Math.min(5, Math.round(raw))) : 0;
      }
      if (b.FileName !== undefined) {
        const next = String(b.FileName || '').trim();
        if (next) patch.originalName = next; // 显示文件名实际存在 originalName 上
      }
      if (b.FileType !== undefined) cur.FileType = String(b.FileType || '');
      // 黑白名单：文件详情页「黑名单 / 白名单」按钮（White / Block / None）
      if (b.ListType !== undefined) {
        const lt = String(b.ListType || '').trim();
        cur.ListType = lt === 'White' || lt === 'Block' ? lt : 'None';
      }
      // 分类目录：详情页「编辑」里重新选择目录（等价于文件管理的「移动」）
      if (b.Directory !== undefined) {
        patch.folder = normalizeDir(String(b.Directory || '')).replace(/\/+$/, '');
      }
      metasRaw = JSON.stringify(cur);
    }
    try {
      JSON.parse(metasRaw);
    } catch {
      return { success: false, message: 'metas 不是合法 JSON' };
    }
    await prisma.fileRecord.update({ where: { id: rec.id }, data: { metas: metasRaw, ...patch } });
    if (patch.note !== undefined) appLog.info('file', `文件备注已保存：${rec.name}`);
    if (patch.rating !== undefined || patch.level !== undefined) {
      appLog.info('file', `文件评分/等级已保存：${rec.name}`, `评分=${patch.rating ?? '-'} ｜ 等级=${patch.level ?? '-'}`);
    }
    const updated = await this.resolveFile(rec.name, owner);
    return {
      success: true,
      data: {
        metas: metasRaw,
        name: rec.name,
        ...(this.canUseNote(req, rec) ? { note: patch.note !== undefined ? patch.note : rec.note } : {}),
        metadata: updated
          ? serializeFile(updated, updated.copies, { tags: updated.tags.map((t) => t.tag.name), resolveDirectUrl: this.directUrlResolver(), resolveLoadUrl: this.directUrlResolver(true) }).metadata
          : undefined,
      },
    };
  }

  /**
   * 批量补备份（文件管理「一键备份所有文件」批量操作）。
   * 入参 fileIds 既可用数据库主键，也可用文件列表里的 File_ID（name）。
   * 内部会先检测每个文件的备份情况：已有备份的计入 skipped，只对没有备份的执行备份。
   */
  @Put('batch/rebackup')
  async rebackup(@Req() req: Request, @Body() body: { fileIds?: string[] }) {
    const ids = await this.filterOwned(body.fileIds || [], req);
    const r = await this.uploadSvc.rebackup(ids);
    return { success: true, data: r };
  }

  // 兼容两种调用路径：早期前端用 /api/manage/batch/...，管理页批量操作菜单用 /api/manage/files/batch/...
  @Post('batch/backupSelected')
  async backupSelected(@Req() req: Request, @Body() body: { fileIds?: string[] }) {
    return this.rebackup(req, body);
  }

  @Post('files/batch/backupSelected')
  async backupSelectedFiles(@Req() req: Request, @Body() body: { fileIds?: string[] }) {
    return this.rebackup(req, body);
  }

  /**
   * 单文件一键备份（文件详情「备份渠道」为空时的「一键备份」按钮）。
   * 复用批量补备份逻辑，只传一个 ID。
   */
  @Post('files/backup/*')
  async backupOne(@Req() req: Request) {
    const key = wildcardParam(req);
    if (!key) return { success: false, message: '缺少文件名' };
    const ids = await this.filterOwned([key], req);
    if (!ids.length) return { success: false, message: '文件不存在' };
    const r = await this.uploadSvc.rebackup(ids);
    return { success: r.ok > 0 || r.skipped > 0, data: r, message: r.ok > 0 ? '备份成功' : r.skipped > 0 ? '该文件已有备份' : '备份失败，请检查备份渠道配置' };
  }

  /**
   * 重定向：为单个文件设置 / 清除「重定向地址」。
   * 设置后 /file/:name 直接 302 到该地址（外链不变，实际文件源被替换）；
   * 传空字符串即恢复使用渠道真实直链。
   */
  @Post('files/redirect/*')
  async setRedirect(@Req() req: Request, @Body() body: { url?: string }) {
    if (!(await this.userPerm(req, 'edit'))) return { success: false, message: '没有编辑权限' };
    const owner = currentSession(req)?.user || '';
    const rec = await this.resolveFile(wildcardParam(req), owner);
    if (!rec) return { success: false, message: '文件不存在' };
    const url = String(body.url || '').trim();
    if (url) {
      try {
        const u = new URL(url);
        if (!['http:', 'https:'].includes(u.protocol)) return { success: false, message: '仅支持 http/https 地址' };
      } catch {
        return { success: false, message: 'URL 格式不正确' };
      }
    }
    await prisma.fileRecord.update({ where: { id: rec.id }, data: { redirectUrl: url } });
    return { success: true, data: { redirectUrl: url } };
  }

  /**
   * 新建逻辑分类目录（文件管理左上角「新建目录」按钮）。
   * 目录在本系统里是「逻辑分类」（不产生真实远端路径），因此新目录登记在
   * settings.extraFolders，键为「账户 + 实例」（见 extraFoldersKey）。
   * 目录树与列表的目录列会与「有文件的目录」合并展示。
   */
  @Post('folder')
  async createFolder(
    @Req() req: Request,
    @Query() q: Record<string, string>,
    @Body() body: { dir?: string; name?: string; path?: string; instanceId?: string },
  ) {
    // 兼容两种入参：{dir, name} 或直接给完整 {path}
    let base = String(body.dir || '').replace(/^\/+|\/+$/g, '');
    let rawName = body.name;
    if (!rawName && body.path) {
      const parts = String(body.path).replace(/^\/+|\/+$/g, '').split('/');
      rawName = parts.pop() || '';
      base = parts.join('/');
    }
    const name = String(rawName || '').trim().replace(/^\/+|\/+$/g, '').replace(/\.\./g, '_');
    if (!name) return { success: false, message: '目录名不能为空' };
    const full = base ? `${base}/${name}` : name;
    // v1.0.0：目录归属到「当前实例」—— body 优先，其次 query（前端切实例后必须带上）
    const instanceId = String(body?.instanceId ?? q?.instanceId ?? '');
    await this.registerFolder(req, full, instanceId);
    appLog.info('file', `新建目录：${full}`, `实例=${instanceId || '默认'}`);
    return { success: true, data: { path: full } };
  }

  /**
   * v1.0.0：settings.extraFolders 的存储键（实现见 folder-meta.service，两个控制器共用）。
   * 旧格式「账户 → 目录数组」没有实例维度，会导致 A 实例建的目录在 B 实例也出现；
   * 现在改为「账户::实例 → 目录数组」，默认实例沿用旧键，存量数据无需迁移。
   */
  private extraFoldersKey(owner: string, instanceId: string): string {
    return extraFoldersKey(owner, instanceId);
  }

  /**
   * 读取 extraFolders 里某账户在某实例下的目录。
   * instanceId = '*' 时表示「全部实例」：把该账户所有实例键下的目录合并返回。
   */
  private extraFoldersOf(map: Record<string, string[]>, owner: string, instanceId: string): string[] {
    return extraFoldersOf(map, owner, instanceId);
  }

  /** 登记逻辑目录（按账户 + 实例隔离） */
  private async registerFolder(req: Request, full: string, instanceId = '') {
    const owner = currentSession(req)?.user || '';
    const raw = await this.settings.get('extraFolders', '{}');
    let map: Record<string, string[]> = {};
    try {
      map = raw ? JSON.parse(raw) : {};
    } catch {
      map = {};
    }
    const key = this.extraFoldersKey(owner, instanceId);
    const list = new Set(Array.isArray(map[key]) ? map[key] : []);
    const fullPath = full.replace(/^\/+|\/+$/g, '');
    list.add(fullPath);
    map[key] = Array.from(list).sort();
    /*
     * v1.0.3：管理员登记目录的归属键从「空 owner」改成本人账户 ——
     * 顺手把旧键里的同一条摘掉，避免同目录在列表里出现两次（自愈式迁移）。
     */
    if (this.admin(req)) {
      const legacyKey = this.extraFoldersKey('', instanceId);
      if (Array.isArray(map[legacyKey])) {
        map[legacyKey] = map[legacyKey].filter((p: string) => p !== fullPath);
        if (!map[legacyKey].length) delete map[legacyKey];
      }
    }
    await this.settings.set('extraFolders', JSON.stringify(map));
  }

  /**
   * 读取当前用户在当前实例下可见的额外（空）目录列表。
   * v1.0.0：instanceId 为 '*' 时合并该账户全部实例（历史记录页「全部实例」用）。
   * v1.0.3：管理员额外合并旧版「空 owner 键」里的登记（升级后不会丢历史空目录）。
   */
  private async extraFolders(req: Request, instanceId = ''): Promise<string[]> {
    const owner = currentSession(req)?.user || '';
    try {
      const map = JSON.parse((await this.settings.get('extraFolders', '{}')) || '{}');
      const mine = this.extraFoldersOf(map, owner, instanceId);
      if (!this.admin(req) || !owner) return mine;
      const legacy = this.extraFoldersOf(map, '', instanceId);
      return Array.from(new Set([...mine, ...legacy])).sort();
    } catch {
      return [];
    }
  }

  /**
   * v3.0.0（R12）：「新建目录」登记的空目录（settings.extraFolders）随目录删除一起摘掉。
   * 空目录在 FileRecord 里没有任何记录，只删文件行的话它仍会被 extraFolders 撑回来。
   * v1.0.0：按「账户 + 实例」键摘除。
   * @returns 被摘掉的条目数
   */
  private async unregisterFolders(owner: string, prefix: string, instanceId = ''): Promise<number> {
    const p = String(prefix || '').replace(/^\/+|\/+$/g, '');
    if (!p) return 0;
    let map: Record<string, string[]> = {};
    try {
      map = JSON.parse((await this.settings.get('extraFolders', '{}')) || '{}');
    } catch {
      map = {};
    }
    const key = this.extraFoldersKey(owner, instanceId);
    const list = Array.isArray(map[key]) ? map[key] : [];
    const kept = list.filter((d) => d !== p && !String(d).startsWith(`${p}/`));
    const removed = list.length - kept.length;
    if (removed > 0) {
      map[key] = kept;
      await this.settings.set('extraFolders', JSON.stringify(map));
    }
    return removed;
  }

  /**
   * v3.0.0（R12）：目录移动时同步改写 settings.extraFolders。
   * 空目录（无文件记录）只能靠这份登记存活，不改写就会出现「移动后旧目录还在、新目录没出现」。
   * v1.0.2：支持跨实例 —— fromInstance 的键里搬走，写进 toInstance 的键（同名目录自动合并）。
   * @returns 被改写的条目数
   */
  private async moveRegisteredFolders(
    owner: string,
    folders: string[],
    distBase: string,
    fromInstance = '',
    toInstance = '',
  ): Promise<number> {
    if (!folders.length) return 0;
    let map: Record<string, string[]> = {};
    try {
      map = JSON.parse((await this.settings.get('extraFolders', '{}')) || '{}');
    } catch {
      map = {};
    }
    // v1.0.0：按「账户 + 实例」键读写；v1.0.2：源 / 目标实例可以是不同的键
    const srcKey = this.extraFoldersKey(owner, fromInstance);
    const dstKey = this.extraFoldersKey(owner, toInstance);
    let list: string[] = Array.isArray(map[srcKey]) ? [...map[srcKey]] : [];
    let changed = 0;
    for (const raw of folders) {
      const f = String(raw || '').replace(/^\/+|\/+$/g, '');
      if (!f) continue;
      const leaf = f.split('/').filter(Boolean).pop() || '';
      const newRoot = [String(distBase || '').replace(/^\/+|\/+$/g, ''), leaf].filter(Boolean).join('/');
      const next: string[] = [];
      for (const d of list) {
        if (d === f || d.startsWith(`${f}/`)) {
          const suffix = d.slice(f.length).replace(/^\/+/, '');
          next.push(suffix ? `${newRoot}/${suffix}` : newRoot);
          changed += 1;
        } else {
          next.push(d);
        }
      }
      list = next;
    }
    if (changed > 0) {
      map[srcKey] = Array.from(new Set(list)).sort();
      if (dstKey !== srcKey) {
        // 跨实例：目标键合并（去重），源键已在上一步剔除
        const dstList = Array.isArray(map[dstKey]) ? map[dstKey] : [];
        map[dstKey] = Array.from(new Set([...dstList, ...list])).sort();
      }
      await this.settings.set('extraFolders', JSON.stringify(map));
    }
    return changed;
  }

  /**
   * GET /api/manage/folders/all?instanceId=
   *
   * v3.0.0 全局目录列表（供「目录导航 → 全局」构建缩进树）：
   *   · FileRecord.folder 去重（status=active，限定 instanceId）；
   *   · 合并 FolderMeta.path（目录属性行，含没有文件的目录）；
   *   · 合并「新建目录」登记的 empty 目录（settings.extraFolders，按账户隔离）；
   *   · 按 folder 字符串逐级补齐中间目录节点（与列表 allFolders 的补齐规则一致）。
   *
   * 归属：管理员看全实例；普通用户只看自己的文件目录 + 共享给自己的目录 + 自己的目录属性行
   * （与 /api/manage/list 的可见范围保持一致，避免泄露他人目录路径）。
   * 返回 { success: true, data: ['2026', '2026/10', '登记文件', ...] }（已按路径排序）。
   */
  /**
   * v1.0.3：文件转存（本地 ↔ 第三方）—— 候选目标渠道与当前状态。
   *
   * GET /api/manage/convert/options/:id
   * 返回：
   *   direction        to-local（当前在第三方，要转本地）/ to-remote（当前在本地，要转异地）
   *   currentChannel   当前主副本所在渠道 { name, type }
   *   registered       是否登记文件（登记文件禁止删除源件）
   *   canDeleteSource  是否允许选择「删除源件」（转本地时才有意义）
   *   channels         候选目标渠道 [{ id, name, type }]（已停用的、浏览用的 localfiles 都排除）
   */
  @Get('convert/options/:id')
  async convertOptions(@Req() req: Request, @Param('id') id: string) {
    const me = currentSession(req)?.user || '';
    const rec = await prisma.fileRecord.findFirst({
      where: { uploader: me, status: 'active', OR: [{ id }, { name: id }] },
      include: { copies: { include: { channel: true } } },
    });
    if (!rec) return { success: false, message: '文件不存在或无权操作' };

    const copy =
      rec.copies.find((c) => c.status === 'active' && c.isPrimary) ||
      rec.copies.find((c) => c.status === 'active');
    const ch = copy?.channel || null;
    const isLocalType = (t: string) => t === 'local' || t === 'localfiles';
    const srcLocal = !!ch && isLocalType(ch.type);

    const all = await prisma.channel.findMany({
      /*
       * v1.0.4：排除备份渠道（isBackup）。
       *
       * v1.0.0 的语义是「主渠道负责存取，备份渠道只做上传时的一比一镜像」——
       * 备份渠道不参与取源排序、不承担业务流量。如果允许把它选成转存目标，
       * 转存的 existingTarget 分支会把那条备份副本升级成主副本，
       * 备份渠道从此变成工作渠道，与 v1.0.0 的行为不一致。
       */
      where: { enabled: true, isBackup: false },
      orderBy: [{ typeCode: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, type: true },
    });
    // 本地 → 只要第三方（排除一切本地形态）；第三方 → 只要本地存储渠道
    const channels = all.filter((c) =>
      srcLocal ? !isLocalType(c.type) : c.type === 'local',
    );
    const registered = String(rec.uploadSource || '') === 'Record';

    return {
      success: true,
      direction: srcLocal ? 'to-remote' : 'to-local',
      currentChannel: ch ? { name: ch.name, type: ch.type } : null,
      registered,
      // 转异地时本地源件必然删除，不给选择；转本地时才让用户选，登记文件一律禁止删除源件
      canDeleteSource: !srcLocal && !registered,
      forceDeleteSource: srcLocal,
      channels,
    };
  }

  /**
   * v1.0.3：执行转存。
   *
   * POST /api/manage/convert  { id, channelId, deleteSource? }
   * - 只搬实体文件与「跟随渠道变化」的数据（固化地址 / 渠道名 / 删除接口），
   *   文件名、类型、尺寸、分类、标签、上传时间全部不动，签发外链不变；
   * - 本地 → 第三方：原样上传后删除本地实体文件；
   * - 第三方 → 本地：deleteSource=true 时删除源渠道文件；登记文件禁止删除源件。
   */
  @Post('convert')
  async convertFile(@Req() req: Request, @Body() body: { id?: string; channelId?: string; deleteSource?: boolean }) {
    const me = currentSession(req)?.user || '';
    if (!me) return { success: false, message: '未登录' };
    if (!(await this.userPerm(req, 'edit'))) return { success: false, message: '没有编辑权限' };
    const id = String(body?.id || '');
    const channelId = String(body?.channelId || '');
    if (!id || !channelId) return { success: false, message: '缺少文件或目标渠道' };

    const r = await this.uploadSvc.convertChannel({
      recordId: id,
      targetChannelId: channelId,
      deleteSource: body?.deleteSource === true,
      uploader: me,
      ip: req.ip,
    });
    if (!r.ok) {
      appLog.warn('channel', `文件转存失败：${r.message || '未知原因'}`, `fileId=${id}`, req.ip);
      return { success: false, message: r.message || '转存失败' };
    }
    return { success: true, ...r };
  }

  @Get('folders/all')
  async foldersAll(@Req() req: Request, @Query() q: Record<string, string>) {
    const instanceId = String(q.instanceId ?? '');
    const admin = this.admin(req);
    const me = currentSession(req)?.user || '';

    const rows = await prisma.fileRecord.groupBy({
      by: ['folder'],
      where: { status: 'active', instanceId, uploader: me },
    });
    const base = new Set<string>(rows.map((r) => r.folder).filter(Boolean) as string[]);

    // 共享给我的目录（普通用户）：这些目录我可能一条文件都没有，但需要能导航到
    if (!admin) {
      for (const d of await listSharedFoldersFor(me, instanceId)) base.add(d.path);
    }
    // 目录属性行（FolderMeta.path）
    const metas = await prisma.folderMeta.findMany({
      where: { instanceId, type: FOLDER_TYPE_FILE, ...(admin ? {} : { owner: me }) },
      select: { path: true, metas: true },
    });
    // v3.0.0（R12）：目录属性里改过的名称（path → 自定义名称），随全局目录树一起下发
    const displayNames: Record<string, string> = {};
    for (const m of metas) {
      const p = String(m.path || '').replace(/^\/+|\/+$/g, '');
      if (!p) continue;
      base.add(p);
      const name = String((safeParse(m.metas).displayName as string) || '').trim();
      if (name) displayNames[p] = name;
    }
    // 已登记的「空目录」
    // v1.0.0：按当前实例读取（原来读的是账户级旧键，A 实例登记的目录会在所有实例里出现）
    for (const d of await this.extraFolders(req, instanceId)) {
      const p = String(d || '').replace(/^\/+|\/+$/g, '');
      if (p) base.add(p);
    }

    // 逐级补齐中间目录（"a/b/c" → "a"、"a/b"、"a/b/c"）
    const all = new Set<string>();
    for (const f of base) {
      const segs = f.split('/').filter(Boolean);
      for (let i = 1; i <= segs.length; i += 1) all.add(segs.slice(0, i).join('/'));
    }
    return {
      success: true,
      data: Array.from(all).sort((a, b) => a.localeCompare(b)),
      displayNames,
    };
  }

  /** 数据总览：文件量、容量、渠道状态、近 7 天趋势、副本分布（仅管理员） */
  @Get('stats')
  @UseGuards(AdminGuard)
  async stats() {
    const [fileCount, sizeAgg, channels] = await Promise.all([
      prisma.fileRecord.count({ where: { status: 'active' } }),
      prisma.fileRecord.aggregate({ where: { status: 'active' }, _sum: { size: true } }),
      prisma.channel.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ]);

    // 近 7 天上传趋势
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - 6);
    const recent = await prisma.fileRecord.findMany({
      where: { status: 'active', createdAt: { gte: since } },
      select: { createdAt: true },
    });
    const byDay: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      byDay[d.toISOString().slice(0, 10)] = 0;
    }
    for (const r of recent) {
      const k = r.createdAt.toISOString().slice(0, 10);
      if (k in byDay) byDay[k] += 1;
    }

    // 各渠道副本数量与状态
    const copies = await prisma.fileCopy.groupBy({
      by: ['channelId', 'status'],
      _count: { _all: true },
    });
    // 全局主/备渠道概览 —— 统一走 StorageChannelService.getStorageChannel('', type)
    const briefOf = (c: StorageChannelInfo | null) =>
      c ? { id: c.id, code: c.code, name: c.name, type: c.type, enabled: true } : null;

    return {
      success: true,
      data: {
        fileCount,
        totalSize: sizeAgg._sum.size || 0,
        channelCount: channels.length,
        mainChannel: briefOf(await this.storageChannel.getStorageChannel('', 'main')),
        backupChannel: briefOf(await this.storageChannel.getStorageChannel('', 'backup')),
        accessChannel: await this.settings.getAccessChannel(),
        backupEnabled: (await this.settings.get('backupEnabled', 'true')) === 'true',
        allowUpload: (await this.settings.get('allowUpload', 'true')) === 'true',
        serverDomain: (await this.settings.getServerDomain()) || '',
        byDay: Object.entries(byDay).map(([date, count]) => ({ date, count })),
        channels: channels.map((c) => {
          const mine = copies.filter((x) => x.channelId === c.id);
          const sum = (st: string) => mine.filter((x) => x.status === st).reduce((a, b) => a + b._count._all, 0);
          return {
            id: c.id,
            name: c.name,
            type: c.type,
            enabled: c.enabled,
            isMain: c.isMain,
            isBackup: c.isBackup,
            active: sum('active'),
            failed: sum('failed'),
            pending: sum('pending'),
          };
        }),
      },
    };
  }

  /** 黑白名单 —— 以 JSON 数组存 settings，UI 增删单条 IP（仅管理员） */
  @Get('lists')
  @UseGuards(AdminGuard)
  async lists() {
    return { success: true, data: await this.readLists() };
  }

  @Post('white/:ip')
  @UseGuards(AdminGuard)
  async addWhite(@Param('ip') ip: string) {
    return this.mutateList('whiteIpList', ip, 'add');
  }

  @Delete('white/:ip')
  @UseGuards(AdminGuard)
  async delWhite(@Param('ip') ip: string) {
    return this.mutateList('whiteIpList', ip, 'del');
  }

  @Post('block/:ip')
  @UseGuards(AdminGuard)
  async addBlock(@Param('ip') ip: string) {
    return this.mutateList('blockIpList', ip, 'add');
  }

  @Delete('block/:ip')
  @UseGuards(AdminGuard)
  async delBlock(@Param('ip') ip: string) {
    return this.mutateList('blockIpList', ip, 'del');
  }

  /** 安全总开关（黑白名单是否生效）（仅管理员） */
  @Put('lists/enabled')
  @UseGuards(AdminGuard)
  async setListsEnabled(@Body() body: { enabled?: boolean | string }) {
    const v = body.enabled === true || body.enabled === 'true';
    await this.settings.set('securityEnabled', v ? 'true' : 'false');
    return { success: true };
  }

  /**
   * v2.6.0 #301：IP 归属地本地数据包（qqwry.dat）。
   * GET  security/ip-query/dat —— 数据包状态（是否存在 / 条数 / 大小 / 错误）
   * POST security/ip-query/dat —— 上传覆盖（请求体为 dat 原始字节）
   */
  @Get('security/ip-query/dat')
  @UseGuards(AdminGuard)
  async ipQueryDatStatus() {
    return { success: true, data: qqwryStatus() };
  }

  @Post('security/ip-query/dat')
  @UseGuards(AdminGuard)
  async ipQueryDatUpload(@Req() req: Request) {
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 64 * 1024 * 1024; // 64MB 上限，防误传超大文件
    await new Promise<void>((resolve, reject) => {
      req.on('data', (c: Buffer) => {
        total += c.length;
        if (total > MAX) {
          reject(new Error('文件超过 64MB 上限'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve());
      req.on('error', reject);
    });
    const buf = Buffer.concat(chunks);
    if (!buf.length) return { success: false, message: '未收到数据包内容' };
    try {
      const r = saveQqwry(buf);
      console.log(`[security] qqwry.dat 上传成功：${r.records.toLocaleString()} 条，${(r.sizeBytes / 1048576).toFixed(1)} MB`);
      return { success: true, data: r };
    } catch (err: any) {
      console.error('[security] qqwry.dat 上传失败:', err?.message || err);
      return { success: false, message: String(err?.message || '数据包解析失败') };
    }
  }

  private async readLists(): Promise<{ white: string[]; block: string[]; enabled: boolean }> {
    const parse = (raw: string): string[] => {
      if (!raw) return [];
      try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v.map(String) : [];
      } catch {
        return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      }
    };
    return {
      white: parse(await this.settings.get('whiteIpList', '[]')),
      block: parse(await this.settings.get('blockIpList', '[]')),
      enabled: (await this.settings.get('securityEnabled', 'false')) === 'true',
    };
  }

  private async mutateList(key: string, ip: string, mode: 'add' | 'del') {
    const cur = await this.readLists();
    const list = key === 'whiteIpList' ? cur.white : cur.block;
    const next = mode === 'add'
      ? Array.from(new Set([...list, ip]))
      : list.filter((x) => x !== ip);
    await this.settings.set(key, JSON.stringify(next));
    return { success: true, data: await this.readLists() };
  }

  /**
   * 系统配置：/page /security /upload /others /ai
   * 直接返回配置对象本身（对齐原系统契约：前端 `this.settings = data`）。
   * 前端保存用 POST，同时兼容 PUT。
   */
  /** 对外 WebDAV 配置读写（系统管理 → 其他设置 → 对外 WebDAV） */
  @Get('webdav')
  @UseGuards(AdminGuard)
  async getWebdav() {
    const raw = await this.settings.get('webdav', '');
    try {
      return { success: true, data: raw ? JSON.parse(raw) : {} };
    } catch {
      return { success: true, data: {} };
    }
  }

  @Post('webdav')
  @UseGuards(AdminGuard)
  async saveWebdav(@Body() body: Record<string, unknown>) {
    await this.settings.set('webdav', JSON.stringify(body || {}));
    return { success: true };
  }

  @Get('sysConfig/:section')
  @UseGuards(AdminGuard)
  async getSysConfig(@Param('section') section: string) {
    return this.sysConfig.get(section);
  }

  /**
   * 系统日志（后台「系统日志」页）——内存环形缓冲 + 每日落盘文件。
   * 查询参数：level=info|warn|error|all、scope、keyword、limit、since(时间戳)
   */
  @Get('logs')
  @UseGuards(AdminGuard)
  getLogs(
    @Query()
    q: { level?: string; scope?: string; keyword?: string; limit?: string; since?: string; date?: string },
  ) {
    const data = appLog.list({
      level: q.level,
      scope: q.scope,
      keyword: q.keyword,
      limit: Number(q.limit) || 200,
      since: Number(q.since) || 0,
      date: q.date,
    });
    return { success: true, ...data, scopes: appLog.scopes(), stats: appLog.stats(), files: appLog.logFiles() };
  }

  /** 清空内存日志（磁盘文件保留，便于事后追溯）（仅管理员） */
  @Delete('logs')
  @UseGuards(AdminGuard)
  clearLogs() {
    return { success: true, cleared: appLog.clear() };
  }

  /** 打印一条日志（后台「测试日志」按钮用，验证链路是否通）（仅管理员） */
  @Post('logs/test')
  @UseGuards(AdminGuard)
  testLog() {
    appLog.info('debug', '这是一条来自后台的测试日志', `时间：${new Date().toLocaleString('zh-CN')}`);
    return { success: true };
  }

  /** 磁盘日志文件列表（后台「系统日志」页的「选择日志版本」下拉） */
  @Get('logs/files')
  @UseGuards(AdminGuard)
  logFiles() {
    return { success: true, data: appLog.logFiles() };
  }

  /**
   * 导出系统日志为 .log 文件（后台「系统日志」页的导出按钮）。
   * 支持与 /logs 相同的筛选参数；导出当前缓冲内的日志文本。
   */
  @Get('logs/export')
  @UseGuards(AdminGuard)
  exportLogs(
    @Query()
    q: { level?: string; scope?: string; keyword?: string; limit?: string; since?: string },
    @Res() res: Response,
  ) {
    const data = appLog.list({
      level: q.level,
      scope: q.scope,
      keyword: q.keyword,
      limit: Number(q.limit) || 5000,
      since: Number(q.since) || 0,
    });
    const text = (data.entries || [])
      .map((e: { at: number; level: string; scope: string; message: string; detail?: string; ip?: string }) =>
        `${new Date(e.at).toISOString()} [${e.level.toUpperCase()}] [${e.scope}] ${e.message}${e.detail ? ` ｜ ${e.detail}` : ''}${e.ip ? ` ｜ ip=${e.ip}` : ''}`,
      )
      .join('\n');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="GoHub-logs-${stamp}.log"`);
    return res.send(text || '(无日志)');
  }

  /** 一键备份所有文件：没有备份的文件进入后台队列补备份，已有备份的跳过（仅管理员） */
  @Post('backupAll/start')
  @UseGuards(AdminGuard)
  startBackupAll() {
    return { success: true, data: this.uploadSvc.startBackupAll() };
  }

  /** 一键备份进度查询（仅管理员） */
  @Get('backupAll/status')
  @UseGuards(AdminGuard)
  backupAllStatus() {
    return { success: true, data: this.uploadSvc.backupAllStatus() };
  }

  @Post('sysConfig/:section')
  @UseGuards(AdminGuard)
  async postSysConfig(
    @Param('section') section: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.persistSysConfig(section, body, res);
  }

  @Put('sysConfig/:section')
  @UseGuards(AdminGuard)
  async putSysConfig(
    @Param('section') section: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.persistSysConfig(section, body, res);
  }

  /**
   * 保存分区配置。管理端账号发生变更时清除当前会话，
   * 让前端提示「请重新登录」并强制用新口令验证（否则旧 Cookie 仍然有效）。
   */
  private async persistSysConfig(section: string, body: Record<string, unknown>, res: Response) {
    const out = await this.sysConfig.save(section, body);
    // v2.5.0：设置保存动作入系统日志（便于排查「保存失败」类问题）
    appLog.info('settings', `系统配置已保存：${section} 分区`);
    if (section === 'security' && (out as { adminPasswordChanged?: boolean })?.adminPasswordChanged) {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
    }
    return out;
  }

  /* ======================================================================
   * v1.0.5：原位媒体编辑（裁剪 / 压缩 / 转WebP / 转码）
   *
   * 硬约束（需求原话）：
   *   1. 只对「本地存储」渠道上的主副本生效 —— 远端对象存储无法原地改写；
   *   2. 原位替换：磁盘路径、文件名、扩展名全部不变，因此已经发出去的外链继续有效；
   *   3. 处理完同步刷新 size / width / height / md5，详情页立即显示新值。
   * ====================================================================== */

  /** 读取「系统设置→上传相关配置」里的时长上限（秒）；空/非法 → 默认值，0 → 不限制 */
  private async mediaLimitSeconds(id: string, fallback = 600): Promise<number> {
    try {
      const page: any = await this.sysConfig.get('page');
      const hit = (page?.config || []).find((x: any) => x.id === id);
      const raw = hit && hit.value !== undefined && hit.value !== null ? String(hit.value).trim() : '';
      if (raw === '') return fallback;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return fallback;
      return Math.floor(n);
    } catch {
      return fallback;
    }
  }

  /** 媒体类型判定：只用 mime 前缀，扩展名兜底 */
  private static mediaKindOf(mime: string, ext: string): 'image' | 'video' | 'audio' | '' {
    const m = String(mime || '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    const e = String(ext || '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'].includes(e)) return 'image';
    if (['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'].includes(e)) return 'video';
    if (['mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg'].includes(e)) return 'audio';
    return '';
  }

  /**
   * 探测「这个文件能不能原位编辑、能做哪几件事」。
   * 前端拿到结果后决定显示哪几个按钮，不自己猜扩展名。
   */
  @Get('media/info/:id')
  async mediaInfo(@Param('id') id: string, @Req() req: Request) {
    const owner = currentSession(req)?.user || '';
    const { target, reason } = await resolveMediaTarget(id, owner);
    if (!target) return { success: false, message: reason || '文件不可编辑' };
    const kind = ManageController.mediaKindOf(target.mime, target.ext);
    const isWebp = target.ext === 'webp' || String(target.mime || '').toLowerCase() === 'image/webp';
    /*
     * v1.0.6：视频直接把当前编码格式探出来给前端。
     * 转码确认页原先只有一句「要转成 H.264 吗」，用户看不到源编码就得盲选；
     * 这里顺手把 fourcc 翻成 H.264 / H.265 这类可读名字。
     * ffprobe 不可用时返回空串（前端会隐藏这一行），不影响其它能力。
     */
    let videoCodec = '';
    let videoCodecLabelText = '';
    if (kind === 'video') {
      try {
        videoCodec = await probeVideoCodecFile(target.abs);
        videoCodecLabelText = videoCodecLabel(videoCodec);
      } catch {
        videoCodec = '';
      }
    }
    return {
      success: true,
      data: {
        id: target.id,
        name: target.name,
        ext: target.ext,
        mime: target.mime,
        size: target.size,
        originalSize: target.originalSize,
        kind,
        /** fourcc 原值（avc1 / hvc1 …）与可读名，供转码确认页展示 */
        videoCodec,
        videoCodecLabel: videoCodecLabelText,
        /** 之前是否压缩过 —— 前端据此弹「二次确认」 */
        compressedBefore: target.compressedBefore,
        /** 固化存储地址（详情页「源」一栏与后端的本地磁盘地址保持一致） */
        localPath: target.abs,
        canCrop: kind === 'image',
        canCompress: kind === 'image' || kind === 'video' || kind === 'audio',
        /** 已经是 WebP 的不再提供「转WebP」（需求：已是 WebP 直接阻止） */
        canWebp: kind === 'image' && !isWebp,
        canTranscode: kind === 'video',
      },
    };
  }

  /**
   * 裁剪：前端用 canvas 裁好再以 multipart 传回结果图（不传坐标，避免服务端与前端
   * 对「旋转变换后的坐标系」理解不一致）。服务端只负责按原扩展名重新编码并原位落盘。
   */
  @Post('media/crop')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 64 * 1024 * 1024 } }))
  async mediaCrop(
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: any,
    @Req() req: Request,
  ) {
    const owner = currentSession(req)?.user || '';
    const id = String(body?.id ?? body?.fileId ?? '').trim();
    if (!id) return { success: false, message: '缺少文件标识' };
    if (!file?.buffer?.length) return { success: false, message: '没有收到裁剪后的图片数据' };

    const { target, reason } = await resolveMediaTarget(id, owner);
    if (!target) return { success: false, message: reason || '文件不可编辑' };

    const r = await cropImage(target, file.buffer);
    if (!r.ok) {
      appLog.warn('file', `原位裁剪失败：${target.name}`, r.message || '');
      return { success: false, message: r.message || '裁剪失败' };
    }
    appLog.info('file', `原位裁剪完成：${target.name}`, `${target.size} → ${r.size}`);
    return { success: true, data: r };
  }

  /**
   * 压缩：percent = 目标体积占原体积的百分比（20~95）。
   * 已经压缩过的文件必须带 confirm=1 才执行（前端弹二次确认）。
   */
  @Post('media/compress')
  async mediaCompress(@Body() body: Record<string, unknown>, @Req() req: Request) {
    const owner = currentSession(req)?.user || '';
    const id = String(body?.id ?? body?.fileId ?? '').trim();
    const percent = Number(body?.percent ?? 0);
    if (!id) return { success: false, message: '缺少文件标识' };
    if (!Number.isFinite(percent) || percent < 10 || percent > 99) {
      return { success: false, message: '压缩比例需在 10~99 之间（目标体积占原体积的百分比）' };
    }

    const { target, reason } = await resolveMediaTarget(id, owner);
    if (!target) return { success: false, message: reason || '文件不可编辑' };

    if (target.compressedBefore && String(body?.confirm ?? '') !== '1') {
      return {
        success: false,
        needConfirm: true,
        message: `「${target.name}」已经压缩过一次，再压会继续损失画质，确认继续吗？`,
      };
    }

    const maxSeconds = await this.mediaLimitSeconds('compressMaxSeconds', 600);
    const r = await compressInPlace(target, percent, maxSeconds);
    if (!r.ok) {
      if (/上限时长/.test(r.message || '')) logAbandoned(target.name, '压缩', r.message || '');
      return { success: false, message: r.message || '压缩失败' };
    }
    appLog.info('file', `原位压缩完成：${target.name}`, `${target.size} → ${r.size}（目标 ${percent}%）`);
    return { success: true, data: r };
  }

  /** 转 WebP：mode = lossy（有损，默认）| lossless（无损）；文件名与扩展名保持不变 */
  @Post('media/webp')
  async mediaWebp(@Body() body: Record<string, unknown>, @Req() req: Request) {
    const owner = currentSession(req)?.user || '';
    const id = String(body?.id ?? body?.fileId ?? '').trim();
    if (!id) return { success: false, message: '缺少文件标识' };
    const raw = String(body?.mode ?? body?.lossless ?? 'lossy').toLowerCase();
    const lossless = raw === 'lossless' || raw === 'true' || raw === '1';

    const { target, reason } = await resolveMediaTarget(id, owner);
    if (!target) return { success: false, message: reason || '文件不可编辑' };

    const r = await toWebp(target, lossless);
    if (!r.ok) return { success: false, message: r.message || '转 WebP 失败' };
    appLog.info('file', `原位转 WebP（${lossless ? '无损' : '有损'}）：${target.name}`, `${target.size} → ${r.size}`);
    return { success: true, data: r };
  }

  /** 视频转码：先探测编码，已是浏览器可播的 H.264 就直接拒绝；超时长上限则放弃并记录原因 */
  @Post('media/transcode')
  async mediaTranscode(@Body() body: Record<string, unknown>, @Req() req: Request) {
    const owner = currentSession(req)?.user || '';
    const id = String(body?.id ?? body?.fileId ?? '').trim();
    if (!id) return { success: false, message: '缺少文件标识' };

    const { target, reason } = await resolveMediaTarget(id, owner);
    if (!target) return { success: false, message: reason || '文件不可编辑' };

    const maxSeconds = await this.mediaLimitSeconds('videoTranscodeMaxSeconds', 600);
    const r = await transcodeInPlace(target, maxSeconds);
    if (!r.ok) {
      if (/上限时长/.test(r.message || '')) logAbandoned(target.name, '转码', r.message || '');
      return { success: false, message: r.message || '转码失败' };
    }
    appLog.info('file', `原位转码完成：${target.name}`, `${target.size} → ${r.size}`);
    return { success: true, data: r };
  }

}

/** 用户侧配置（上传页 / 登录页 / 全局背景图使用） */
@Controller('api')
export class UserConfigController {
  constructor(
    private settings: SettingsService,
    private sysConfig: SysConfigService,
    private uploadSvc: UploadService,
    private storageChannel: StorageChannelService,
  ) {}

  /** 渠道信息裁剪为前端需要的字段（id / code / name / type），null 原样返回 */
  private channelBrief(c: StorageChannelInfo | null): { id: string; code: string; name: string; type: string } | null {
    return c ? { id: c.id, code: c.code, name: c.name, type: c.type } : null;
  }

  /**
   * 用户侧配置 —— 直接返回配置对象（前端 `commit('setUserConfig', response.data)`）。
   * 字段名严格对齐原系统，取自页面设置（page）分区的 config 项。
   */
  /** 失败重试次数：留空 → 3；0 = 不限制；其余按正整数处理，上限 999 */
  private parseRetryTimes(raw: unknown): number {
    const n = Number(String(raw ?? '').trim());
    if (String(raw ?? '').trim() === '') return 3;
    if (!Number.isFinite(n) || n < 0) return 3;
    if (n === 0) return 0;
    return Math.min(999, Math.floor(n));
  }

  @Get('userConfig')
  async userConfig(@Req() req: Request) {
    const s = this.settings;
    // 当前登录账户 —— 用于解析「用户管理」里为该账户指定的主/备存储渠道
    const uploader = currentSession(req)?.user || '';
    const domain = (await s.getServerDomain()) || signOrigin(req);
    /*
     * v3.0.0（R16）：当前账户是否开启两步验证。
     * 回收站「彻底删除」据此决定验证方式：开启 2FA → 只验动态码，
     * 未开启 → 要求手动输入「确认删除」。前端不猜测，统一读这个值。
     */
    let accountTotpEnabled = false;
    let accountUploadBk: string[] = [];
    let accountAdminBk: string[] = [];
    if (uploader) {
      const u = await prisma.user
        .findUnique({
          where: { username: uploader },
          select: { totpEnabled: true, uploadBkImg: true, adminBkImg: true },
        })
        .catch(() => null);
      accountTotpEnabled = !!u?.totpEnabled;
      // 账户自定义背景图（空数组 = 未设置 → 继续用系统「网页设置」里的值）
      const parseBk = (raw?: string): string[] => {
        if (!raw) return [];
        try {
          const a = JSON.parse(raw);
          return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()) : [];
        } catch {
          return [];
        }
      };
      accountUploadBk = parseBk(u?.uploadBkImg);
      accountAdminBk = parseBk(u?.adminBkImg);
    }
    const bool = async (k: string, d = false) => (await s.get(k, d ? 'true' : 'false')) === 'true';

    let page: any = { config: [] };
    try {
      page = await this.sysConfig.get('page');
    } catch {
      /* 首次运行尚无配置 */
    }
    const pv = (id: string, d: any = '') => {
      const item = (page?.config || []).find((x: any) => x.id === id);
      return item && item.value !== undefined && item.value !== null && item.value !== '' ? item.value : d;
    };
    /** v2.8.9：布尔配置读取 —— 兼容真布尔与 'true'/'false' 字符串（存库后可能是任一形态） */
    const pb = (id: string, d = true): boolean => {
      const v = pv(id, d);
      if (typeof v === 'boolean') return v;
      const t = String(v).trim().toLowerCase();
      if (t === 'false' || t === '0' || t === 'off' || t === 'no') return false;
      if (t === 'true' || t === '1' || t === 'on' || t === 'yes') return true;
      return d;
    };
    /**
     * 背景图配置解析 —— 页面设置里保存的是原始字符串（如 `["url1","url2"]`、
     * `bing` 或单个 URL），这里统一归一化为 backgroundManager 期望的形状：
     * 数组 / 'bing' / 空数组。此前直接 asArr 字符串会得到 []，导致登录页、
     * 管理页背景图全部失效、上传页错误回退到内置默认背景。
     */
    const asBk = (v: any): string[] | string => {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') {
        const s = v.trim();
        if (!s) return [];
        if (s.toLowerCase() === 'bing') return 'bing';
        if (s.startsWith('[')) {
          try {
            const a = JSON.parse(s);
            return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()) : [];
          } catch {
            return [];
          }
        }
        return [s]; // 视为单个 URL
      }
      return [];
    };

    return {
      // 站点信息
      siteTitle: pv('siteTitle', 'GoHub') || 'GoHub',
      siteIcon: pv('siteIcon', ''),
      ownerName: pv('ownerName', ''),
      logoUrl: pv('logoUrl', ''),
      logoLink: pv('logoLink', ''),
      announcement: pv('announcement', ''),
      announcementRefreshAt: page?.announcementRefreshAt || 0,
      footerLink: pv('footerLink', ''),
      disableFooter: pv('disableFooter', false) === true,
      defaultLanguage: 'zh-CN',
      // 外链与上传
      serverDomain: domain,
      /*
       * 外链前缀（全站文件链接的唯一出口）。
       * 优先级：上传设置里的「自定义访问域名」> 页面设置「默认URL前缀」> 本站 /file/。
       * 全站（上传页 / 文件管理 / 历史记录 / 文件详情 / 系统状态 …）都用这一个值拼文件链接，
       * 因此改了自定义域名后，所有文件链接一起跟随，不需要逐处修改。
       */
      urlPrefix: await s.getLinkPrefix(domain),
      // 供前端做「仅替换文件链接」判断的原始自定义域名（未设置时为空串）
      customDomain: await s.getCustomDomain(),
      /*
       * 当前全局默认主存储渠道（isMain 且启用）。
       * 上传页「上传设置 → 渠道名称」需要把「跟随主渠道」解析成实际渠道展示出来，
       * 否则用户只知道跟着主渠道走，却看不到主渠道到底是哪一个。
       */
      defaultChannel: this.channelBrief(await this.storageChannel.getStorageChannel('', 'main')),
      /*
       * 当前生效的主 / 备份存储渠道 —— 统一走 StorageChannelService.getStorageChannel。
       * 登录账户在「用户管理」里指定了渠道就用指定的，否则用后台「上传设置」里的全局渠道。
       * 上传页「上传设置」用它展示，并作为「未指定渠道」时的默认上传渠道。
       */
      mainChannel: this.channelBrief(await this.storageChannel.getStorageChannel(uploader, 'main')),
      backupChannel: this.channelBrief(await this.storageChannel.getStorageChannel(uploader, 'backup')),
      allowUpload: await bool('allowUpload', true),
      // 上传默认值
      defaultUploadNameType: pv('defaultUploadNameType', 'default'),
      defaultUploadFolder: pv('defaultUploadFolder', ''),
      defaultConvertToWebp: pv('defaultConvertToWebp', false) === true,
      /*
       * v3.0.0：全局 WebP 转换模式下发给前台 ——
       * 上传设置里选「跟随全局」时按这个值展开（缺失按 lossless）；
       * 同时 webpEnabled 开关关闭时前台整个 WebP 入口都不加载，此值不生效。
       */
      webpMode: pv('webpMode', 'lossless') === 'lossy' ? 'lossy' : 'lossless',
      // v2.3.0：默认开启压缩（与后台「网页设置 → 默认开启压缩」的默认值保持一致）
      defaultCustomerCompress: pv('defaultCustomerCompress', true) === true,
      /*
       * v2.8.8：两个后台开关从「默认值」升级为「功能总开关」：
       *   webpEnabled     —— 关闭时前台列表顶栏的「转换为WebP」按钮不加载
       *   compressEnabled —— 关闭时前台所有压缩相关入口（顶栏按钮 / 上传设置里的
       *                      压缩开关·阈值·百分比·禁止格式）全部隐藏
       */
      webpEnabled: pv('defaultConvertToWebp', false) === true,
      compressEnabled: pv('defaultCustomerCompress', true) === true,
      /*
       * v2.8.8：视频兼容转码的账户策略。
       *   transcodePolicy —— inherit / off / on / user
       *   transcodeGlobal —— 后台全局开关当前值（策略为 inherit/user 时用户看到的「跟随全局」实际值）
       * 前台仅在 policy === 'user' 时显示下拉，其余由后台决定。
       */
      transcodePolicy: await this.uploadSvc.videoTranscodePolicy(uploader),
      transcodeGlobal: await this.uploadSvc.globalTranscodeEnabled(),
      /*
       * v2.8.9：把原来被合并的两个开关拆开 ——
       *   autoRetry   —— 「失败自动重试」总开关（决定前台上传设置里「其他 → 失败自动重试」是否显示，
       *                   以及所有入口是否允许重试）；
       *   retryTimes  —— 失败重试次数（留空 3，0 = 不限制）；
       *   autoSwitch  —— 「自动切换」：上传失败时是否换下一个渠道（与重试相互独立）。
       */
      /*
       * v3.0.0（R11）：前端并发数 —— 浏览器同时上传多少个文件。
       * 后台「其他设置 → 上传相关配置 → 前端并发数」控制，留空默认 3。
       * 夹在 1~10：太大容易在弱网/慢图床上把连接打满，反而更容易超时。
       */
      uploadConcurrency: Math.min(10, Math.max(1, Number(pv('defaultUploadConcurrency', '3')) || 3)),
      autoRetry: pb('defaultAutoRetry', true),
      retryTimes: this.parseRetryTimes(pv('defaultRetryTimes', '3')),
      autoSwitch: pb('defaultAutoSwitch', true),
      defaultCompressBar: pv('defaultCompressBar', '0.8'),
      // 压缩期望：已改为「压缩百分比」（如 80 = 压到原体积 80%）
      defaultCompressQuality: pv('defaultCompressQuality', '80'),
      // 外链格式与上传限制
      defaultUrlForm: pv('defaultUrlForm', 'url'),
      allowedExtensions: String(
        pv('allowedExtensions', 'jpg,png,gif,jpeg,webp,bmp,mp4,webm,mov,m4v,mp3,m4a,aac,ogg'),
      )
        .split(',')
        .map((x) => x.trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean),
      /*
       * v2.8.8：单文件大小上限 —— 账户在「用户管理 → 编辑」里设了「单文件大小限制」
       * 就用它，留空才回落到后台全局值。前端据此做上传前的预校验（提示更及时）。
       */
      maxUploadSizeMB:
        (await this.uploadSvc.userMaxFileSizeMB(uploader)) || (Number(pv('maxUploadSizeMB', 1024)) || 1024),
      // 背景图
      wallpaperEnabled: pv('wallpaperEnabled', false) === true,
      // 夜间/白天自动切换（关闭后固定白天样式）
      autoDarkMode: pv('autoDarkMode', true) !== false,
      bkInterval: Number(pv('bkInterval', 3000)) || 3000,
      bkOpacity: Number(pv('bkOpacity', 1)) || 1,
      /*
       * v1.0.3：白天/夜间自动切换时间（网页设置 · 全局设置）。
       * 原样下发给前端解析；留空表示用默认 08:00—20:00。
       */
      themeAutoRange: String(pv('themeAutoRange', '') || ''),
      /*
       * v3.0.0（R16）：账户自定义背景图优先 ——
       * 账户在「用户管理 → 编辑」里设置了就用账户的（覆盖系统「网页设置」里的同名字段），
       * 没设置（空数组）则回落到系统设置。每次刷新前端随机取一张。
       */
      uploadBkImg: accountUploadBk.length ? accountUploadBk : asBk(pv('uploadBkImg', [])),
      adminBkImg: accountAdminBk.length ? accountAdminBk : asBk(pv('adminBkImg', [])),
      adminLoginBkImg: asBk(pv('adminLoginBkImg', [])),
      showDirectorySuggestions: pv('showDirectorySuggestions', true) !== false,
      // v3.0.0（R16）：账户两步验证状态（回收站彻底删除的验证方式）
      accountTotpEnabled,
    };
  }

  /**
   * 目录树（上传页「上传目录」建议/分类选择的数据源）。
   * 响应结构与原系统一致：{ tree: { name, path, children } }，
   * 此前错误地返回扁平目录数组，前端取 data.tree 恒为 undefined，导致分类无法加载。
   *
   * v3.0.0：支持 ?instanceId= —— 只返回该实例下的目录（空串 / 不传 = 默认实例）。
   * 该接口同时被前台上传页的目录建议（DirectorySuggestionInput）使用，
   * 不带 instanceId 时行为与旧版一致（默认实例 = 既有数据所在的实例）。
   */
  @Get('directoryTree')
  async directoryTree(@Req() req: Request, @Query() q: Record<string, string>) {
    // 每个账户（含管理员）只看到自己的目录 —— v1.0.3 起管理员不再跨账户可见
    const session = currentSession(req);
    const owner = session?.user || '';
    // v3.0.0：实例维度（不传 = 默认实例）
    const instanceId = String(q.instanceId ?? '');
    try {
      const rows = await prisma.fileRecord.groupBy({
        by: ['folder'],
        where: { status: 'active', instanceId, ...(owner ? { uploader: owner } : {}) },
      });
      const dirs = rows.map((r) => r.folder).filter(Boolean) as string[];
      /*
       * v1.0.0：合并「新建目录」登记的空目录，且必须限定当前实例。
       * 原实现直接读 settings.extraFolders 的账户级旧键（map[owner]），
       * 没有实例维度 —— 于是 A 实例新建的目录切到 B 实例后照样出现在目录树里。
       */
      try {
        const map = JSON.parse((await this.settings.get('extraFolders', '{}')) || '{}');
        dirs.push(...extraFoldersOf(map, owner, instanceId));
      } catch {
        /* 忽略 */
      }
      return { success: true, tree: buildDirectoryTree(Array.from(new Set(dirs)).sort()) };
    } catch (err) {
      /*
       * v3.0.0（R14）：目录树是前台「上传目录 / 目录树选择」的数据源，
       * 查询失败时必须留痕（此前直接 500，前端只能显示「加载目录树失败」）。
       */
      appLog.error('file', `目录树加载失败：${(err as Error).message}`, `owner=${owner || '-'} instance=${instanceId || 'default'}`);
      throw err;
    }
  }

  /** 公开画廊 */
  @Get('public/list')
  async publicList(@Query() q: Record<string, string>, @Res() res: Response) {
    // 公开画廊开关 + 目录白名单（系统设置 → 其他设置 → 公开游览）
    const others = (await this.sysConfig.get('others')) as { publicBrowse?: Record<string, unknown> } | undefined;
    const cfg = others?.publicBrowse || {};
    if (cfg.enabled !== true) {
      return res.status(403).json({ error: 'Public browse is disabled' });
    }

    // v2.6.0：开放目录改多行输入（一行一个），兼容逗号分隔的旧格式
    const allowedDirs = String(cfg.allowedDir || '')
      .split(/[\n\r,]+/)
      .map((d) => d.trim())
      .filter(Boolean);

    const recursive = q.recursive === 'true';
    const dir = normalizeDir(q.dir);
    const bare = dir.replace(/\/+$/, '');
    if (!dirAllowed(bare, allowedDirs)) {
      return res.status(403).json({ error: 'Directory not allowed' });
    }

    const start = Math.max(0, Number(q.start || 0) || 0);
    const count = q.count === undefined ? 50 : Math.max(0, Number(q.count) || 0);
    const search = (q.search || '').trim().toLowerCase();
    const type = (q.type || '').trim().toLowerCase();

    const rows = await prisma.fileRecord.findMany({
      where: { status: 'active' },
      include: { copies: { include: { channel: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // 公开画廊只展示「正常」文件：黑名单 / 违规内容不外露
    const visible = rows.filter((r) => {
      const metas = safeParse(r.metas);
      return ((metas.ListType as string) || 'None') !== 'Block' && metas.Label !== 'adult';
    });

    const matched = visible.filter((r) => {
      const folder = (r.folder || '').replace(/\/+$/, '');
      if (recursive) {
        if (bare && folder !== bare && !folder.startsWith(`${bare}/`)) return false;
      } else if (folder !== bare) {
        return false;
      }
      if (search && !r.originalName.toLowerCase().includes(search) && !r.name.toLowerCase().includes(search)) return false;
      if (type && fileTypeOf(r.mime) !== type) return false;
      return true;
    });

    // 子目录：当前目录下的直接子目录，且必须落在白名单内
    const dirSet = new Set<string>();
    for (const r of visible) {
      const full = `${(r.folder || '').replace(/\/+$/, '')}/`;
      if (!full.startsWith(dir)) continue;
      const rest = full.slice(dir.length);
      const idx = rest.indexOf('/');
      if (idx !== -1) dirSet.add(dir + rest.slice(0, idx));
    }
    const directories = Array.from(dirSet)
      .map((d) => d.replace(/\/+$/, ''))
      .filter((d) => d !== '' && dirAllowed(d, allowedDirs))
      .sort();

    const totalCount = matched.length;
    const paged = count > 0 ? matched.slice(start, start + count) : matched.slice(start);

    return res.json({
      files: paged.map((r) => serializeFile(r, r.copies)),
      directories,
      totalCount,
      returnedCount: paged.length,
      allowedDirs,
      fromCache: false,
    });
  }

  /**
   * 随机图 API —— GET /api/random
   *
   * 输出形态：
   *   默认        → 302 跳转到随机图（可直接当 <img src=".../api/random"> 用）
   *   ?type=json  → 返回 JSON（也接受 ?json=1 / ?format=json）
   *
   * 筛选参数（可任意组合，缺省为「全库随机」）：
   *   ?dir=风景/2026          限定目录（含子目录请用 ?recursive=true）
   *   ?category=image|video|audio     按大类型（按 MIME 前缀）
   *   ?fileType=Image|Video|Audio     同 category，兼容后台列表口径
   *   ?ext=jpg,png,webp       按扩展名白名单
   *   ?channel=腾讯云COS       按渠道类型（中文名，见 CHANNEL_LABEL）
   *   ?channelName=主渠道A     按渠道名称
   *   ?label=xxx              按标签（metas.Label）
   *   ?access=normal|block|white      按访问状态
   *   ?count=1..10            一次取多张（>1 时 data 为数组）
   *
   * 兼容性：`data` 在 count=1 时为对象、count>1 时为数组；两者都额外带
   *         `list` 数组字段，方便调用方统一按列表消费。
   */
  @Get('random')
  async random(@Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const asJson = q.type === 'json' || q.json === '1' || q.format === 'json';

    // 随机图 API 开关 + 目录白名单（系统设置 → 其他设置 → 随机图 API）
    const others = (await this.sysConfig.get('others')) as { randomImageAPI?: Record<string, unknown> } | undefined;
    const randomCfg = others?.randomImageAPI || {};
    if (randomCfg.enabled !== true) {
      return asJson
        ? res.status(403).json({ success: false, error: 'Random is disabled', message: '随机图 API 已关闭' })
        : res.status(403).send('Random is disabled');
    }
    const allowedRandomDirs = String(randomCfg.allowedDir || '')
      .split(/[\n\r,]+/)
      .map((d) => d.trim())
      .filter(Boolean);

    const count = Math.min(10, Math.max(1, Number(q.count || 1) || 1));
    const recursive = q.recursive === 'true';

    // —— 可在 SQL 层表达的条件 ——
    const where: Record<string, unknown> = { status: 'active' };
    const dir = normalizeDir(q.dir);
    if (dir) {
      if (!dirAllowed(dir.replace(/\/+$/, ''), allowedRandomDirs)) {
        return asJson
          ? res.status(403).json({ success: false, error: 'Directory not allowed', message: '目录不在允许范围内' })
          : res.status(403).send('Directory not allowed');
      }
      const bare = dir.replace(/\/+$/, '');
      where.folder = recursive ? { startsWith: bare } : bare;
    } else if (allowedRandomDirs.length) {
      // 未指定目录时把候选限定在白名单目录内
      where.AND = allowedRandomDirs.map((d) => ({
        OR: [{ folder: d.replace(/\/+$/, '') }, { folder: { startsWith: `${d.replace(/\/+$/, '')}/` } }],
      }));
    }
    const cat = (q.category || q.fileType || '').toLowerCase();
    const prefix = cat.startsWith('img') || cat === 'image' ? 'image/' : cat === 'video' ? 'video/' : cat === 'audio' ? 'audio/' : '';
    if (prefix) where.mime = { startsWith: prefix };

    const exts = splitCsv(q.ext).map((e) => e.replace(/^\./, '').toLowerCase());
    if (exts.length) {
      // 注意：FileRecord.name 是「外链标识」（随机 ID，通常不带扩展名），
      // 用户可见的真实文件名在 originalName（后台重命名改的也是它）。
      // 因此两者都要匹配，否则 ?ext=png 永远查不到东西。
      where.OR = exts.flatMap((e) => [
        { originalName: { endsWith: `.${e}` } },
        { name: { endsWith: `.${e}` } },
      ]);
    }

    // 渠道 / 标签 / 访问状态存在关联表与 metas JSON 里，SQLite 侧不便表达 → 取回后内存过滤
    const needMemory = Boolean(q.channel || q.channelName || q.label || q.access);

    /** 公开可见性：黑名单与违规内容不通过任何公开接口外露 */
    const isPubliclyVisible = (metasRaw: string) => {
      const m = safeParse(metasRaw);
      return ((m.ListType as string) || 'None') !== 'Block' && m.Label !== 'adult';
    };

    const pick = async (): Promise<FileRecord[]> => {
      if (!needMemory) {
        // 先只取「标识 + metas」做公开性过滤，再洗牌抽样，最后回表取完整记录
        const candidates = await prisma.fileRecord.findMany({ where, select: { name: true, metas: true } });
        const names = candidates.filter((c) => isPubliclyVisible(c.metas)).map((c) => c.name);
        if (!names.length) return [];
        for (let i = names.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [names[i], names[j]] = [names[j], names[i]];
        }
        const chosen = names.slice(0, count);
        const recs = await prisma.fileRecord.findMany({ where: { name: { in: chosen } } });
        return chosen.map((n) => recs.find((r) => r.name === n)).filter(Boolean) as FileRecord[];
      }
      const rows = await prisma.fileRecord.findMany({
        where,
        orderBy: { id: 'asc' },
        include: { copies: { include: { channel: true } }, tags: { include: { tag: true } } },
      });
      const filtered = rows.filter((r) => {
        const metas = safeParse(r.metas);
        if (!isPubliclyVisible(r.metas)) return false;
        if (q.label && ((metas.Label as string) || 'None') !== q.label) return false;
        if (q.access) {
          const lt = (metas.ListType as string) || 'None';
          const ok =
            (q.access === 'normal' && lt === 'None') ||
            (q.access === 'block' && lt === 'Block') ||
            (q.access === 'white' && lt === 'White');
          if (!ok) return false;
        }
        if (q.channel || q.channelName) {
          const primary = pickPrimaryCopy(r.copies);
          const typeLabel = primary?.channel ? CHANNEL_LABEL[primary.channel.type] || primary.channel.type : '';
          if (q.channel && typeLabel !== q.channel) return false;
          if (q.channelName && (primary?.channel?.name || '') !== q.channelName) return false;
        }
        return true;
      });
      if (!filtered.length) return [];
      const shuffled = filtered.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, count);
    };

    const picked = await pick();
    if (!picked.length) {
      if (asJson) return res.json({ success: false, message: '没有符合条件的图片', data: [] });
      return res.status(404).send('没有符合条件的图片');
    }
    res.setHeader('Cache-Control', 'no-store');

    if (asJson) {
      // 随机图 API：对外返回的文件链接走全站统一出口（自定义访问域名优先）
      const origin = signOrigin(req);
      const prefix = await this.settings.getLinkPrefix(origin);
      const items = picked.map((r) => ({
        src: `${prefix}${encodeURIComponent(r.name)}`,
        url: `${prefix}${encodeURIComponent(r.name)}`,
        name: r.originalName,
        size: r.size,
        mime: r.mime,
        dir: r.folder || '',
      }));
      return res.json({ success: true, data: count === 1 ? items[0] : items, list: items });
    }
    return res.redirect(302, `/file/${picked[0].name}`);
  }
}
