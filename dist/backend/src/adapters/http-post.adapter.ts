import { AdapterError, ChannelInfo, CopyInfo, StorageAdapter, UploadResult } from './adapter.interface';
import { ensureProtocol } from '../common/endpoint';
import { buildAssetUrl, splitAssetUrl } from '../common/asset-url';
import { getLoadDomain } from '../common/channel-domain';

/**
 * 通用 HTTP 上传适配器 —— 覆盖 3 个渠道类型：
 *   easyimages  EasyImages 简单图床
 *   lsky        Lsky Pro 兰空图床
 *   custom      自定义 Web 存储
 *
 * 三者本质相同：HTTP 请求一张图 → 解析响应拿 URL。
 * 差异仅在 endpoint / 认证字段 / 响应解析路径，全部做成配置模板，
 * 未来接任何新图床 = 填一个模板。
 *
 * 配置字段：
 *   apiUrl        上传接口完整 URL（支持 {filename} 等占位符）
 *   httpMethod    请求方法（默认 POST，少数图床用 PUT）
 *   requestFormat multipart（默认）| json —— json 时文件以 base64 data-url 放入 JSON body，
 *                 用于只接受 base64 的接口（如 SM.MS / ImgBB / 聚合图床一类）
 *   fileField     文件字段名（默认 file；EasyImages 为 image）
 *   tokenHeader   认证请求头名（如 lsky 的 Authorization）
 *   tokenValue    认证值（可含 {token} 占位，如 "Bearer {token}"）
 *   tokenField    或以表单字段认证（如 easyimages 的 token）
 *   extraFields   附加表单字段 JSON，如 {"strategy_id":"1"}
 *   body          附加表单字段 JSON（等价 extraFields，对齐 PHP 案例的 custom_body）
 *   headers       附加请求头 JSON，对齐 PHP 案例的 custom_headers
 *   responsePath  响应中取 URL 的 JSON 路径，如 data.url 或 [0].src；
 *                 支持 "|" 分隔多候选（如 data.url|url|data.links.url），
 *                 留空时自动按主流图床常见路径逐个尝试
 *   codePath      业务成功码字段路径（EasyImages 默认 code，须等于 200 才算成功）
 *   codeValue     业务成功码期望值（默认 200）
 *   publicDomain  域名重写（可选）：把响应 URL 的域名替换为此值
 *   customDeleteUrl 删除接口模板，含 {url} / {key} 占位（可选）
 *
 * 兼容要点（对齐 PHP 联调案例，并对主流通用 API 做超集）：
 *   1. 响应 URL 为相对路径（如 /file/xxx）时，自动用 publicDomain 或 apiUrl 的源补全；
 *   2. responsePath 支持多候选与常见路径兜底，接任意图床基本免调路径；
 *   3. 请求体同时支持 multipart 与 JSON+base64 两种主流形态；
 *   4. apiUrl / headers / body / tokenValue 均支持 {filename} {name} {ext} {mime} {size} {timestamp} {random} 占位符。
 */
const TOKEN_SECRET_FIELDS = ['tokenValue'];

export function httpAdapterSecretFields(): string[] {
  return TOKEN_SECRET_FIELDS;
}

/** 主流图床响应中 URL 的常见位置，responsePath 留空时按序尝试 */
const COMMON_RESPONSE_PATHS = [
  'url',
  'data.url',
  'data.link',
  'data.src',
  'data.path',
  'data.full_url',
  'data.image.url',
  'image.url',
  'links.url',
  'data.links.url',
  'result',
  'result.url',
  'path',
  'src',
  'file',
  '[0].src',
  '[0].url',
  'data.0.url',
  'data[0].url',
  'data.list.0.url',
];

export class HttpPostAdapter implements StorageAdapter {
  constructor(private channel: ChannelInfo) {}

  /** 安全解析 JSON 配置（非法直接忽略，不影响上传） */
  private jsonCfg(raw: string | undefined): Record<string, unknown> {
    if (!raw) return {};
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** 占位符替换：兼容需要把文件名/时间戳写进 URL 或表单的接口 */
  private fill(tpl: string, file: { buffer: Buffer; mime: string; originalName: string }): string {
    if (!tpl) return tpl;
    const name = file.originalName || 'file';
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot + 1) : '';
    const map: Record<string, string> = {
      filename: name,
      name: base,
      ext,
      mime: file.mime || '',
      size: String(file.buffer?.length ?? 0),
      timestamp: String(Math.floor(Date.now() / 1000)),
      random: Math.random().toString(36).slice(2, 10),
    };
    return tpl.replace(/\{(filename|name|ext|mime|size|timestamp|random)\}/g, (_, k: string) => map[k] ?? '');
  }

  /**
   * 上传文件名去重：优先取 key 的末段（本系统生成的随机 ID，天然唯一），
   * 若 key 末段缺少扩展名则补上原文件扩展名。
   * 目的：防止 Lsky/EasyImages 等功能床「同名覆盖」引发缩略图错乱。
   */
  private uniqueName(originalName: string, key: string): string {
    const base = (key || '').split('/').pop() || originalName || 'file';
    if (/\.[A-Za-z0-9]{1,8}$/.test(base)) return base;
    const dot = (originalName || '').lastIndexOf('.');
    return dot > 0 ? base + originalName.slice(dot) : base;
  }

  async upload(file: { buffer: Buffer; mime: string; originalName: string }, key: string, channel: ChannelInfo): Promise<UploadResult> {
    const cfg = channel.config;
    // apiUrl 支持内网 IP / Docker 容器名（如 lsky:8080、192.168.1.10:8080）：
    // 缺协议时按地址类型补（内网 http、公网 https），请求由服务端发起，
    // 因此图床对外是 https 不影响用内网地址上传。
    let rawApiUrl = ensureProtocol(this.fill(cfg.apiUrl || '', file));
    if (!rawApiUrl) throw new AdapterError('缺少 apiUrl 配置', channel.type);
    /*
     * 兰空（Lsky Pro）上传接口固定为 <站点>/api/v1/upload。
     * 用户填写时可能带尾斜杠、也可能已经写了 /upload，这里统一归一化，
     * 避免「少写一段路径就 404」这类配置错误（v202610221824）。
     */
    if (channel.type === 'lsky') rawApiUrl = normalizeLskyUrl(rawApiUrl);

    // 附加字段按「优先级从低到高」合并后一次性写入，避免同名字段重复提交。
    // extraFields（旧）< body（对齐 PHP custom_body）< tokenField/tokenValue（认证字段，最高）
    const fileField = cfg.fileField || 'file';
    const extra: Record<string, string> = {};
    for (const raw of [cfg.extraFields, cfg.body]) {
      for (const [k, v] of Object.entries(this.jsonCfg(raw))) {
        if (!k) continue;
        extra[k] = this.fill(typeof v === 'string' ? v : JSON.stringify(v), file);
      }
    }
    if (cfg.tokenField && cfg.tokenValue) extra[cfg.tokenField] = this.fill(String(cfg.tokenValue), file);
    // 文件字段名不允许被覆盖
    delete extra[fileField];

    const headers: Record<string, string> = { Accept: 'application/json' };
    // 认证方式二选一：tokenHeader（请求头认证，如 lsky 的 Authorization: Bearer xxx）
    // 或 tokenField（表单字段认证，如 easyimages 的 token）
    if (cfg.tokenHeader && cfg.tokenValue) {
      let token = this.fill(String(cfg.tokenValue).trim(), file);
      // Authorization 缺 scheme 时自动补 Bearer（避免用户漏填前缀导致 401）
      if (/^authorization$/i.test(cfg.tokenHeader) && token && !/^[A-Za-z]+\s/.test(token)) {
        token = `Bearer ${token}`;
      }
      headers[cfg.tokenHeader] = token;
    }
    // 附加请求头（对齐 PHP custom_headers）
    for (const [k, v] of Object.entries(this.jsonCfg(cfg.headers))) {
      if (k) headers[k] = this.fill(String(v), file);
    }

    // 请求体形态：multipart（默认）或 JSON + base64（部分图床只收 base64）
    const useJson = /^json$/i.test(String(cfg.requestFormat || '').trim());
    let body: BodyInit;
    if (useJson) {
      const payload: Record<string, string> = { ...extra };
      payload[fileField] = `data:${file.mime || 'application/octet-stream'};base64,${file.buffer.toString('base64')}`;
      body = JSON.stringify(payload);
      headers['Content-Type'] = 'application/json';
    } else {
      const form = new FormData();
      const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mime });
      // 以 key 的末段作为上传文件名（随机 ID + 扩展名），避免同名文件互相覆盖 ——
      // Lsky Pro 等图床按文件名落盘，重复上传同名图片会导致后一张覆盖前一张，
      // 于是「缩略图与实际文件不一致」。
      form.append(fileField, blob, this.uniqueName(file.originalName, key));
      for (const [k, v] of Object.entries(extra)) form.append(k, v);
      body = form;
    }

    const method = (cfg.httpMethod || 'POST').toUpperCase();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    let resp: Response;
    try {
      resp = await fetch(rawApiUrl, { method, body, headers, signal: ctrl.signal });
    } catch (err) {
      throw new AdapterError(`请求失败: ${(err as Error).message}`, channel.type);
    } finally {
      clearTimeout(timer);
    }
    const text = await resp.text();
    if (!resp.ok) {
      throw new AdapterError(`HTTP ${resp.status}: ${text.slice(0, 300)}`, channel.type);
    }

    let url = '';
    let respJson: Record<string, unknown> | null = null;
    try {
      const json = JSON.parse(text);
      respJson = json as Record<string, unknown>;
      // 业务成功码校验（EasyImages：code 必须为 200，否则即使有 url 也是失败）
      const codePath = cfg.codePath || (channel.type === 'easyimages' ? 'code' : '');
      if (codePath) {
        const code = pickPath(json, codePath);
        const expect = cfg.codeValue || '200';
        if (code !== '' && code !== expect) {
          throw new AdapterError(`接口返回失败码 ${code}（期望 ${expect}）：${responseMessage(json, text)}`, channel.type);
        }
      }
      // 未显式配置成功码时，仍识别主流的 {success:false} / {ok:false} 失败响应
      if (!codePath) {
        const flag = pickPath(json, 'success') || pickPath(json, 'ok');
        if (flag === 'false') {
          throw new AdapterError(`接口返回失败：${responseMessage(json, text)}`, channel.type);
        }
      }
      url = extractUrl(json, cfg.responsePath);
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      // 非 JSON 响应：整段视为 URL
      url = text.trim();
    }
    if (!url) {
      throw new AdapterError(
        `响应中未找到 URL（responsePath=${cfg.responsePath || '自动探测'}）: ${text.slice(0, 200)}`,
        channel.type
      );
    }
    url = normalizeUrl(url, cfg.publicDomain, rawApiUrl);
    /*
     * v3.0.0（R10）：域名永不落库 —— 只保存「URL 去掉 origin 的路径 + 文件级 query」。
     *   ① 文件加载时用渠道当前加载域名重新拼（改域名立即生效）；
     *   ② 路径与文件名是图床服务端生成的，属于结构性信息，一次固化不再跟随配置。
     * 同时把「远端删除凭证」写进 metas（此前没存，导致简单图床/兰空删不掉远端文件）：
     *   · EasyImages 响应里的 del（自带签名 hash 的删除地址）
     *   · Lsky 响应里的 data.key（DELETE /images/:key 需要）
     */
    /*
     * v3.0.0（R11）：远端删除凭证同样遵守「域名不落库」——
     * EasyImages 的 del 地址里带着域名，早先整条存进 metas.deleteUrl，
     * 渠道换域名 / 图床搬家后这条删除地址就变成死链。
     * 现在只存 deletePath（去 origin 的路径）+ deleteQuery，删除时用渠道【当前】域名重新拼。
     */
    const { objectPath, urlQuery } = splitAssetUrl(url);
    const metas: Record<string, unknown> = {};
    if (respJson) {
      const del = pickPath(respJson, 'del');
      if (del) {
        const delUrl = normalizeUrl(del, cfg.publicDomain, rawApiUrl);
        const delParts = splitAssetUrl(delUrl);
        if (delParts.objectPath) {
          metas.deletePath = delParts.objectPath;
          metas.deleteQuery = delParts.urlQuery;
        }
      }
      const imageKey = pickPath(respJson, 'data.key') || pickPath(respJson, 'key');
      if (imageKey) metas.imageKey = imageKey;
    }
    return { remoteKey: key, remoteUrl: '', objectPath, urlQuery, metas };
  }

  async delete(copy: CopyInfo, channel: ChannelInfo): Promise<void> {
    const cfg = channel.config;
    /*
     * v3.0.0（R10）：远端删除修复 —— 三类渠道各自的删除入口：
     *   EasyImages：上传响应里的 del 地址（带 hash，GET 即删）
     *               → R11 起只存 deletePath/deleteQuery，删除时用当前渠道域名重拼
     *   Lsky      ：DELETE <站点>/api/v1/images/<data.key> → metas.imageKey
     *   其它      ：customDeleteUrl 模板（{url} / {key}）
     */
    const meta = copy.metas || {};
    if (channel.type === 'easyimages') {
      let target = '';
      const delPath = String(meta.deletePath || '');
      if (delPath) {
        const base = getLoadDomain(channel.type, cfg, true);
        if (base) target = buildAssetUrl({ base, objectPath: delPath, urlQuery: String(meta.deleteQuery || '') });
      }
      // 兼容 R11 之前落库的存量数据（metas.deleteUrl 里是带域名的完整地址）：
      // 同样只取其 path + query，用渠道【当前】域名重拼 —— 否则老数据换域名后删不掉。
      if (!target && meta.deleteUrl) {
        const legacy = splitAssetUrl(ensureProtocol(String(meta.deleteUrl)));
        const base = getLoadDomain(channel.type, cfg, true);
        target = legacy.objectPath && base
          ? buildAssetUrl({ base, objectPath: legacy.objectPath, urlQuery: legacy.urlQuery })
          : ensureProtocol(String(meta.deleteUrl));
      }
      if (!target) return; // 无删除凭证 → 跳过（与「未配置删除接口」一致）
      const r = await fetch(target, { method: 'GET' });
      if (!r.ok && r.status !== 404) {
        throw new AdapterError(`删除失败: HTTP ${r.status}`, channel.type);
      }
      return;
    }
    if (channel.type === 'lsky' && meta.imageKey) {
      const origin = ensureProtocol(cfg.apiUrl || '');
      if (!origin) throw new AdapterError('缺少 apiUrl 配置', channel.type);
      const headers: Record<string, string> = { Accept: 'application/json' };
      const token = String(cfg.tokenValue || '').trim();
      if (token) headers[cfg.tokenHeader || 'Authorization'] = /^[A-Za-z]+\s/.test(token) ? token : `Bearer ${token}`;
      const r = await fetch(`${new URL(origin).origin}/api/v1/images/${encodeURIComponent(String(meta.imageKey))}`, {
        method: 'DELETE',
        headers,
      });
      if (!r.ok && r.status !== 404) {
        throw new AdapterError(`删除失败: HTTP ${r.status}`, channel.type);
      }
      return;
    }
    if (!cfg.customDeleteUrl) return; // 未配置删除接口则跳过
    const target = copy.remoteUrl || this.directUrlOf(copy, channel, false) || copy.remoteKey;
    const url = ensureProtocol(
      cfg.customDeleteUrl
        .replace('{url}', encodeURIComponent(target))
        .replace('{key}', encodeURIComponent(copy.remoteKey || '')),
    );
    try {
      const headers: Record<string, string> = {};
      if (cfg.tokenHeader && cfg.tokenValue) {
        let token = String(cfg.tokenValue).trim();
        if (/^authorization$/i.test(cfg.tokenHeader) && token && !/^[A-Za-z]+\s/.test(token)) {
          token = `Bearer ${token}`;
        }
        headers[cfg.tokenHeader] = token;
      }
      await fetch(url, { method: (cfg.customDeleteMethod || 'GET').toUpperCase(), headers });
    } catch (err) {
      throw new AdapterError(`删除失败: ${(err as Error).message}`, channel.type);
    }
  }

  /** 内部复用：按「固化地址 + 当前加载域名」拼出完整地址 */
  private directUrlOf(copy: CopyInfo, channel: ChannelInfo, preferInternal: boolean): string {
    if (!copy.objectPath) return '';
    const base = getLoadDomain(channel.type, channel.config, preferInternal);
    if (!base) return '';
    return buildAssetUrl({ base, objectPath: copy.objectPath, urlQuery: copy.urlQuery });
  }

  /** 直链：新数据用「动态域名 + 固化地址」，老数据回退 remoteUrl / remoteKey */
  buildDirectUrl(copy: CopyInfo, channel: ChannelInfo, preferInternal?: boolean): string | null {
    const cfg = channel.config;
    /*
     * v3.0.0（R10）：固化地址优先 —— 域名永远取渠道当前配置，改域名立即生效。
     * 代理模式优先内网通信域名，重定向模式用公开访问域名。
     */
    if (copy.objectPath) {
      const built = this.directUrlOf(copy, channel, !!preferInternal);
      if (built) return built;
    }
    let url = copy.remoteUrl;
    /*
     * v2.8.9：登记文件（uploadSource=Record）命中渠道域名时只存了路径（remoteKey），
     * remoteUrl 为空 —— 之前直接返回 null 导致文件加载不到。这里回退用 remoteKey 拼：
     *   normalizeUrl 会按「(preferInternal && 内网通信域名) → 公开访问域名 → 上传接口地址源」
     *   的顺序补全域名，相对路径（web/my-file/xxx.png）也能正确解析。
     * 普通上传的 remoteUrl 恒为完整 URL，不受此回退影响。
     */
    if (!url && copy.remoteKey) url = copy.remoteKey.replace(/^\/+/, '');
    if (!url) return null;
    // v2.8.7：preferInternal 时域名替换优先用「内网通信域名」
    url = normalizeUrl(url, (preferInternal && cfg.internalDomain) || cfg.publicDomain, cfg.apiUrl);
    return url;
  }
}

/**
 * 多候选 JSON 路径取值：
 *   - responsePath 支持 "|" 分隔的候选列表，按序命中即返回
 *   - 留空时按 COMMON_RESPONSE_PATHS 自动探测主流图床的常见位置
 */
function extractUrl(json: unknown, responsePath?: string): string {
  const raw = (responsePath || '').trim();
  const candidates = raw && !/^auto$/i.test(raw)
    ? raw.split('|').map((s) => s.trim()).filter(Boolean)
    : COMMON_RESPONSE_PATHS;
  for (const p of candidates) {
    const v = pickPath(json, p);
    if (v) return v;
  }
  return '';
}

/** 提取错误信息（兼容 message / msg / error / error.message） */
function responseMessage(json: unknown, fallback: string): string {
  for (const p of ['message', 'msg', 'error', 'error.message', 'data.message', 'errmsg']) {
    const v = pickPath(json, p);
    if (v) return v;
  }
  return fallback.slice(0, 200);
}

/**
 * URL 归一化：
 *   1. 配置了 publicDomain → 用其替换域名（保留路径与查询串）
 *   2. 协议相对 //host/path → 补 https:
 *   3. 绝对路径 /file/xxx → 用 publicDomain 或上传接口的源补全
 *   4. 裸路径 file/xxx → 同上，带斜杠拼接
 */
/**
 * 兰空（Lsky Pro）接口地址归一化：
 *   https://lsky.hqh555.top/api/v1          → .../api/v1/upload
 *   https://lsky.hqh555.top/api/v1/         → .../api/v1/upload
 *   https://lsky.hqh555.top/api/v1/upload   → 原样
 * 只补 /upload 这一段，不动用户填的域名与版本前缀（兼容 v1 / v2 部署）。
 */
function normalizeLskyUrl(url: string): string {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return u;
  if (/\/upload$/i.test(u)) return u;
  return `${u}/upload`;
}

function normalizeUrl(url: string, publicDomain?: string, apiUrl?: string): string {
  let val = String(url).trim();
  if (!val) return val;
  // 外链域名同样允许不写协议（如填 lsky:8080 走内网）：内网补 http、公网补 https
  const domain = ensureProtocol(publicDomain || '').replace(/\/+$/, '');

  // 1) 显式域名重写
  if (domain) {
    try {
      const parsed = new URL(val, apiUrl || undefined);
      return domain + parsed.pathname + parsed.search;
    } catch {
      /* 继续走下面的补全逻辑 */
    }
  }
  // 2) 协议相对：沿用上传接口的协议，接口不可解析时退回 https
  if (val.startsWith('//')) {
    const proto = /^(https?):/i.exec(apiUrl || '')?.[1] || 'https';
    return `${proto}:${val}`;
  }
  // 3) / 4) 相对路径补全
  if (/^https?:\/\//i.test(val)) return val;
  try {
    return new URL(val, apiUrl || undefined).toString();
  } catch {
    return val;
  }
}

/** 简易 JSON 路径取值：支持 a.b.c、[0].src、data.list.0.url */
function pickPath(obj: unknown, path: string): string {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur == null) return '';
    const m = seg.match(/^\[(\d+)\]$/);
    const idx = m ? Number(m[1]) : Number.NaN;
    if (!Number.isNaN(idx)) {
      cur = (cur as unknown[])[idx];
    } else if (Array.isArray(cur)) {
      cur = (cur as unknown[])[Number(seg)];
    } else {
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  if (cur == null) return '';
  if (typeof cur === 'string') return cur;
  if (typeof cur === 'number' || typeof cur === 'boolean') return String(cur);
  // 落到对象/数组上说明路径写错了，返回空让调用方报出明确错误
  return '';
}
