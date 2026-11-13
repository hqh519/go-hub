import { Injectable } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { PAGE_CONFIG_DEFAULTS } from './page-config';
import { hashSecret, isHashedSecret } from '../common/secret';
import { CryptoService } from '../common/crypto.service';
import { DEFAULT_TAG_START, DEFAULT_TAG_STOP, DEFAULT_TAG_MAX_LEN } from '../common/tag-defaults';

/** 深合并（数组直接替换，对象递归合并） */
function deepMerge<T>(base: T, patch: any): T {
  if (patch === undefined || patch === null) return base;
  if (Array.isArray(base) || Array.isArray(patch)) return (patch ?? base) as T;
  if (typeof base !== 'object' || typeof patch !== 'object') return (patch ?? base) as T;
  const out: any = { ...(base as any) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = k in (base as any) ? deepMerge((base as any)[k], v) : v;
  }
  return out;
}

function safeJson(raw: string, fallback: any) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * 系统设置服务 —— 对齐原系统（CloudFlare-ImgBed）的 /api/manage/sysConfig/* 契约。
 *
 * 每个分区以整段 JSON 存于 settings 表（key = sysConfig:<section>），
 * GET 时与「默认结构」深合并后返回，POST 时整体保存。
 * 这样前端的设置页可以原样使用，后端也不必理解每个字段的语义。
 */
@Injectable()
export class SysConfigService {
  constructor(private settings: SettingsService) {}

  private key(section: string) {
    return `sysConfig:${section}`;
  }

  /** 各分区的默认结构 */
  defaults(section: string): any {
    switch (section) {
      case 'page':
        return JSON.parse(JSON.stringify(PAGE_CONFIG_DEFAULTS));
      case 'security':
        return {
          auth: { user: { authCode: '' }, admin: { adminUsername: '', adminPassword: '' } },
          upload: {
            moderate: {
              enabled: false,
              channel: 'moderatecontent.com',
              moderateContentApiKey: '',
              nsfwApiPath: '',
            },
            ipQuery: {
              enabled: false,
              channel: 'customApi',
              customApi: { url: '', params: [{ key: 'ip', value: '{ip}' }], responseFields: [] },
            },
          },
          access: {
            allowedDomains: '',
            whiteListMode: false,
            imageTransformEnabled: false,
            imageTransformAllowedSizes: '',
            sessionSecure: false,
            // 会话有效期（天）：0 表示永久有效（不设置过期时间）
            userSessionMaxAge: 14,
            adminSessionMaxAge: 14,
            // ---- 失效文件替换（v2.3.0）----
            // 任何「不能正常访问」的文件链接（无权限 / 不存在 / 未开放 / 已过期）
            // 都改为加载 fallbackUrl：
            //   fallbackType = 'image'    → 直接下发该图片（访问链接不变，内容变成替换图）
            //   fallbackType = 'redirect' → 302 跳到该链接
            fallbackEnabled: false,
            fallbackType: 'image',
            fallbackUrl: '',
          },
          // ---- 发信邮箱（v2.3.0）----
          // 用于「邮箱验证 / 两步验证验证码 / 关闭 2FA 校验」，密码字段加密存储。
          mail: {
            enabled: false,
            host: '',
            port: 465,
            secure: true,
            user: '',
            pass: '',
            fromName: 'GoHub',
            fromAddress: '',
            replyTo: '',
          },
        };
      case 'upload':
        return {
          cos: this.emptyChannelType(),
          minio: this.emptyChannelType(),
          r2: this.emptyChannelType(),
          s3: this.emptyChannelType(),
          aliyun: this.emptyChannelType(),
          easyimages: this.emptyChannelType(),
          lsky: this.emptyChannelType(),
          webdav: this.emptyChannelType(),
          immich: this.emptyChannelType(),
          custom: this.emptyChannelType(),
        };
      case 'others':
        return {
          telemetry: { enabled: false, fixed: false }, // 远端遥测：按方案裁剪（不实现上报）
          randomImageAPI: { enabled: true, allowedDir: '', fixed: false }, // 随机图 API：默认开启，可关
          publicBrowse: { enabled: true, allowedDir: '', fixed: false }, // 公开画廊：默认开启，可关
          // 对外 WebDAV：把图床挂成网盘（Finder / 资源管理器 / RaiDrive 可挂载）
          // 上传渠道换用新系统渠道（channelName 存渠道 6 位 ID，空表示走全局主渠道）
          webdav: { enabled: false, rootPath: '', channelId: '', readonly: false },
          /*
           * v1.0.1：文件标签添加设置 —— 上传成功后自动打标签的规则。
           * 原来写死在 upload.service 里的静态规则已移除，改为这里可配：
           *   placeholders —— 占位符模板（逗号 / 换行分隔，每段渲染成一个标签）
           *                   支持 {mime} {ext} {channelName} {uploadSource}
           *                        {y} {m} {d} {width} {height}
           *   extract      —— 提取指定内容，格式 ["文件名片段":"标签名"]
           *   regex        —— 自定义规则，一行一条正则，取捕获组 1 作为标签名
           * 默认值与旧版行为等价（文件类型 / 扩展名 / 渠道简称 / 上传方式 / 年份 + #话题提取）。
           */
          autoTag: {
            enabled: true,
            placeholders: '{mime},{ext},{channelName},{uploadSource},{y}',
            extract: '',
            /*
             * v1.0.5：裸正则 → 「起始符 + 截断符 + 最大长度」三段式，界面改写成一句话。
             * 默认值对齐需求给定的一组：起始 # @ &、截断 # @ & ! - _、最多 10 字。
             * 截断符里重复列出起始符是为了让 `#美食#风景` 能在第二个 # 处断开。
             */
            markerEnabled: true,
            startChars: '["#","@","&"]',
            stopChars: '["#","@","&","!","-","_"]',
            maxLen: 10,
          },
          /*
           * v1.2.0：灯箱（文件预览浮层）外观。
           *   opacity —— 背景遮罩不透明度，0~1，默认 0.9（需求：留空即 0.9）。
           * 老库没有这一段，deepMerge 会补上默认值；读取时再由 normalizeOthers 兜一次范围。
           */
          viewer: {
            opacity: 0.9,
          },
        };
      case 'ai':
        return { canStoreCredentials: false, defaults: { tagPrompt: '' }, models: [] };
      default:
        return {};
    }
  }

  private emptyChannelType() {
    return { channels: [], loadBalance: { enabled: false, channels: [] } };
  }

  /** 读取分区配置（默认值 + 已保存值） */
  async get(section: string): Promise<any> {
    const raw = await this.settings.get(this.key(section), '');
    const stored = raw ? safeJson(raw, {}) : {};

    if (section === 'page') return this.mergePage(stored);
    if (section === 'security') return this.mergeSecurity(stored);
    const merged = deepMerge(this.defaults(section), stored);
    if (section === 'others') return this.normalizeOthers(this.upgradeLegacyTagRule(merged));
    return merged;
  }

  /**
   * v1.2.0：others 分区的取值兜底。
   *
   * 灯箱透明度是纯数值配置，前端可能传空串 / "abc" / -1 / 2 ——
   * 这里统一收口成 0~1 的两位小数，留空或非法一律回落 0.9（与默认值一致）。
   * 只归一化、不删字段：用户就是想要 0 或 1 时照原样保留。
   */
  private normalizeOthers(cfg: any) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    if (!cfg.viewer || typeof cfg.viewer !== 'object') cfg.viewer = {};
    const raw = cfg.viewer.opacity;
    const n = Number(raw);
    if (raw === null || raw === undefined || String(raw).trim() === '' || !Number.isFinite(n)) {
      cfg.viewer.opacity = 0.9;
    } else if (n <= 0) {
      cfg.viewer.opacity = 0;
    } else if (n >= 1) {
      cfg.viewer.opacity = 1;
    } else {
      cfg.viewer.opacity = Math.round(n * 100) / 100;
    }
    return cfg;
  }

  /**
   * v1.0.5 / v1.0.6：把「从未动过标签规则」的老安装一次性抬到新默认值。
   *
   * 为什么需要：`get()` 是「默认值 + 已保存值」深合并，老用户的库里有完整的一份
   * `startChars` / `stopChars` / `maxLen`，默认值改了也盖不掉。
   *
   * 判定原则：只搬「历史默认值」这一种已知形态，用户自己改过任何一项都原样保留。
   * v1.0.6 起起始符/截断符改为纯符号串存储，所以 v1.0.5 存的 JSON 数组也要一并改写；
   * 若只改默认常量而不同步库里的值，升级后设置页会显示 `["#","@","&"]` 而实际
   * 生效的却是别的东西 —— 这正是「设置里看着对、实际没提取成功」的来源。
   */
  private upgradeLegacyTagRule(cfg: any) {
    const at = cfg && cfg.autoTag;
    if (!at) return cfg;
    const LEGACY_STOP =
      '["!","！",",","，",".","。","-","—","_","、",";","；",":","：","?","？","(",")","（","）","[","]","【","】","{","}","<",">","《","》","|","/","\\\\"]';
    const START_DEFAULTS = ['#', '["#","@","&"]', DEFAULT_TAG_START];
    const STOP_DEFAULTS = [LEGACY_STOP, '["#","@","&","!","-","_"]', DEFAULT_TAG_STOP];
    const isStartDefault = START_DEFAULTS.includes(String(at.startChars ?? '').trim());
    const isStopDefault = STOP_DEFAULTS.includes(String(at.stopChars ?? '').trim());
    if (isStartDefault) at.startChars = DEFAULT_TAG_START;
    if (isStopDefault) at.stopChars = DEFAULT_TAG_STOP;
    // 限长只在「起止符都没动过」时才跟着升级，避免覆盖用户的自定义位数
    if (isStartDefault && isStopDefault && [14, 10].includes(Number(at.maxLen))) {
      at.maxLen = DEFAULT_TAG_MAX_LEN;
    }
    // v1.0.5 新增的独立开关：老库没有这个字段，补成「启用」
    if (at.markerEnabled === undefined) at.markerEnabled = true;
    return cfg;
  }

  /** 保存分区配置 */
  async save(section: string, body: any): Promise<any> {
    if (section === 'page') {
      const prevRaw = await this.settings.get(this.key(section), '');
      const prev = prevRaw ? safeJson(prevRaw, {}) : {};
      const next = this.processAnnouncement(body || {}, prev);
      await this.settings.set(this.key(section), JSON.stringify(next));
      return next;
    }
    if (section === 'security') {
      const prevRaw = await this.settings.get(this.key(section), '');
      const prev = prevRaw ? safeJson(prevRaw, {}) : {};
      const { next, adminChanged } = this.mergeSecurityForSave(body || {}, prev);
      await this.settings.set(this.key(section), JSON.stringify(next));
      // adminPasswordChanged：管理端账号发生变化，前端据此提示重新登录
      return { message: 'security settings saved', adminPasswordChanged: adminChanged };
    }
    // 其余分区：与已存值深合并后再写入。
    // 前端各设置页都提交完整对象，合并结果与「整体替换」一致；
    // 但支持「只提交自己关心的那一段」（例如安全设置页只写 webdav、
    // 其他设置页只写 access 的图片尺寸），不会把同分区的其它字段抹掉。
    const prevRaw = await this.settings.get(this.key(section), '');
    const prev = prevRaw ? safeJson(prevRaw, {}) : {};
    const next = deepMerge(prev, body || {});
    await this.settings.set(this.key(section), JSON.stringify(next));
    return next;
  }

  /**
   * 读取 security 分区的【原始存储内容】（不脱敏、不补默认值）。
   * 仅供内部使用：get() 会把密码置空，绝不能用它回写，否则会抹掉已存口令。
   */
  async readSecurityRaw(): Promise<any> {
    const raw = await this.settings.get(this.key('security'), '');
    return raw ? safeJson(raw, {}) : {};
  }

  /**
   * 直接写入 security 分区（不做任何密码语义处理）。
   * 仅供内部使用：把历史明文口令升级为散列后原地回写。
   */
  async writeSecurityRaw(next: any): Promise<void> {
    await this.settings.set(this.key('security'), JSON.stringify(next));
  }

  /* ---------------- page ---------------- */

  /** 把已保存的 config 值合并进 26 项描述数组 */
  private mergePage(stored: any) {
    const base: any = JSON.parse(JSON.stringify(PAGE_CONFIG_DEFAULTS));
    const storedItems: any[] = Array.isArray(stored?.config) ? stored.config : [];
    for (const item of storedItems) {
      const idx = base.config.findIndex((x: any) => x.id === item.id);
      if (idx !== -1) base.config[idx].value = item.value;
    }
    if (Number.isFinite(Number(stored?.announcementRefreshAt))) {
      base.announcementRefreshAt = Number(stored.announcementRefreshAt);
    }
    return base;
  }

  /** 公告内容变化时刷新 announcementRefreshAt（照搬原系统行为） */
  private processAnnouncement(settings: any, previousSettings: any) {
    const pick = (s: any) =>
      Array.isArray(s?.config) ? s.config.find((i: any) => i?.id === 'announcement')?.value ?? '' : '';
    const shouldRefresh = pick(settings) !== pick(previousSettings) || settings.refreshAnnouncement === true;
    delete settings.refreshAnnouncement;
    if (shouldRefresh) settings.announcementRefreshAt = Date.now();
    else if (previousSettings.announcementRefreshAt) settings.announcementRefreshAt = previousSettings.announcementRefreshAt;
    else delete settings.announcementRefreshAt;
    return settings;
  }

  /* ---------------- security ---------------- */

  /** 读取时隐藏密码明文（对齐原系统：返回 _hasPassword 标记） */
  private mergeSecurity(stored: any) {
    const merged = deepMerge(this.defaults('security'), stored) as any;
    if (merged.auth?.user?.authCode) {
      merged.auth.user._hasPassword = true;
      merged.auth.user.authCode = '';
    }
    if (merged.auth?.admin?.adminPassword) {
      merged.auth.admin._hasPassword = true;
      merged.auth.admin.adminPassword = '';
    }
    // 发信邮箱密码同样脱敏（v2.3.0）
    if (merged.mail?.pass) {
      merged.mail._hasPassword = true;
      merged.mail.pass = '';
    }
    return merged;
  }

  /**
   * 保存时：
   *   - 空密码表示「不修改」（保留原值）
   *   - _clear 表示显式清除
   *   - 新密码/认证码一律散列存储（scrypt），绝不落明文
   * 返回 { next, adminChanged }，adminChanged 用于判断是否需要让管理端重新登录。
   */
  private mergeSecurityForSave(body: any, prev: any): { next: any; adminChanged: boolean } {
    const base = deepMerge(this.defaults('security'), prev) as any;
    const out: any = { ...base };
    let adminChanged = false;

    if (body.upload) out.upload = deepMerge(base.upload, body.upload);
    if (body.access) {
      out.access = deepMerge(base.access, body.access);
      out.access.sessionSecure = out.access.sessionSecure === true;
      out.access.imageTransformEnabled = out.access.imageTransformEnabled === true;
      // 失效文件替换（v2.3.0）：类型只允许 image / redirect
      out.access.fallbackEnabled = out.access.fallbackEnabled === true;
      out.access.fallbackType = out.access.fallbackType === 'redirect' ? 'redirect' : 'image';
      out.access.fallbackUrl = String(out.access.fallbackUrl || '').trim();
    }
    // 发信邮箱（v2.3.0）：密码加密落库，空值 = 不修改
    if (body.mail) {
      const prevMail: any = base.mail || {};
      const m: any = { ...prevMail, ...body.mail };
      if (body.mail._clear) m.pass = '';
      else if (body.mail.pass) m.pass = `enc:${CryptoService.encrypt(String(body.mail.pass))}`;
      else m.pass = prevMail.pass || '';
      delete m._clear;
      delete m._hasPassword;
      m.port = Number(m.port) || 465;
      m.secure = m.secure !== false;
      m.enabled = m.enabled === true;
      for (const k of ['host', 'user', 'fromName', 'fromAddress', 'replyTo'] as const) {
        m[k] = String(m[k] ?? '').trim();
      }
      out.mail = m;
    }
    if (body.auth) {
      if (body.auth.user) {
        const u = { ...body.auth.user };
        if (u._clear) u.authCode = '';
        else if (u.authCode) u.authCode = this.toStoredSecret(u.authCode);
        else u.authCode = base.auth?.user?.authCode || '';
        delete u._clear;
        out.auth = { ...base.auth, user: u };
      }
      if (body.auth.admin) {
        const prevUser = String(base.auth?.admin?.adminUsername || '');
        const prevPass = String(base.auth?.admin?.adminPassword || '');
        const a = { ...body.auth.admin };
        if (a._clear) {
          a.adminPassword = '';
          a.adminUsername = '';
        } else if (a.adminPassword) {
          a.adminPassword = this.toStoredSecret(a.adminPassword);
        } else {
          a.adminPassword = prevPass; // 未填写密码 = 不修改
        }
        delete a._clear;
        out.auth = { ...(out.auth || base.auth), admin: a };
        adminChanged =
          String(out.auth.admin.adminPassword || '') !== prevPass ||
          String(out.auth.admin.adminUsername || '') !== prevUser;
      }
    }
    delete out.auth?.user?._hasPassword;
    delete out.auth?.admin?._hasPassword;
    return { next: out, adminChanged };
  }

  /** 明文 → 散列；已是散列则原样保留 */
  private toStoredSecret(plain: unknown): string {
    const v = String(plain ?? '');
    return isHashedSecret(v) ? v : hashSecret(v);
  }
}
