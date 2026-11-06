/**
 * v2.5.0（需求 v20261023-2）：视频播放页链接解析。
 *
 * 用户在「链接模式」里粘贴的可能是视频播放页（B 站 / 知乎 / 抖音 / 快手 /
 * 小红书 / 视频号 / 普通网页），而不是视频源地址。这里尽力从页面中提取出
 * 真实视频地址：
 *
 *   1. 平台专用解析（哔哩哔哩：BV/av → view API → playurl API，免登录可取 mp4）；
 *   2. 通用解析：og:video / twitter:player:stream / <video><source> / 常见 JSON 字段；
 *   3. 候选地址用 Range 探测验证 content-type 确实是媒体（而非又一个网页）。
 *
 * 说明：抖音 / 快手 / 视频号 / 小红书的播放地址大多需要签名或 Cookie，
 * 无法保证 100% 成功 —— 这里做「尽力而为」的通用解析，失败时返回明确错误，
 * 前端原样提示（不影响普通图片/直链转存）。
 */

import { appLog } from '../common/app-log';

/** 直链视频：无需解析，直接走原有转存 */
const VIDEO_EXT_RE = /\.(mp4|webm|mov|avi|mkv|m4v|flv|ts|mpg|mpeg|wmv|3gp)(\?|#|$)/i;

export function isDirectMediaUrl(url: string): boolean {
  return VIDEO_EXT_RE.test(url);
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE_HEADERS: Record<string, string> = {
  'user-agent': BROWSER_UA,
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

export interface ResolvedVideo {
  /** 解析出的真实视频地址 */
  directUrl: string;
  /** 部分平台 CDN 校验 Referer（如 B 站），下载时要带上 */
  referer?: string;
  /** 建议文件名（来自页面标题等，可缺省） */
  name?: string;
}

type ResolveResult = { ok: true; video: ResolvedVideo } | { ok: false; message: string };

/** 带超时的文本抓取（HTML / JSON API）；finalUrl 用于回传重定向后的最终地址 */
async function fetchText(url: string, referer?: string, timeoutMs = 15000, finalUrl?: { value: string }): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { ...BASE_HEADERS, ...(referer ? { referer } : {}) },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    if (finalUrl) finalUrl.value = resp.url || url;
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

function safeJson<T = any>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 相对地址 → 绝对地址；非 http(s) 丢弃 */
function absolutize(u: string, base: string): string | null {
  if (!u) return null;
  let cleaned = u.trim().replace(/\\\//g, '/').replace(/&amp;/g, '&');
  if (cleaned.startsWith('//')) cleaned = 'https:' + cleaned;
  try {
    const abs = new URL(cleaned, base);
    if (!['http:', 'https:'].includes(abs.protocol)) return null;
    return abs.toString();
  } catch {
    return null;
  }
}

/**
 * 通用 HTML 提取：按命中概率排序收集视频候选。
 * （export 仅为链路测试用：dev-tools/test-video-resolve.js 离线验证抖音 RENDER_DATA 解码）
 */
export function extractCandidatesFromHtml(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const push = (raw?: string | null) => {
    if (!raw) return;
    const abs = absolutize(raw, baseUrl);
    if (abs && !out.includes(abs)) out.push(abs);
  };

  // 1. og:video / twitter:player:stream
  const metaRe =
    /<meta[^>]+(?:property|name)\s*=\s*["'](og:video(?::url|:secure_url)?|twitter:player:stream)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) !== null) {
    const tag = m[0];
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    push(content);
  }

  // 2. <video src> / <source src type=video>
  const videoRe = /<(?:video|source)[^>]+>/gi;
  while ((m = videoRe.exec(html)) !== null) {
    const tag = m[0];
    if (/<source/i.test(tag) && !/type\s*=\s*["']video\//i.test(tag)) continue;
    push(/src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]);
  }

  // 3. 常见 JSON 字段（抖音 playAddr / 快手 videoUrl / 通用 playUrl 等）
  const jsonRe =
    /["'](?:playAddr|play_addr|videoUrl|video_url|playUrl|play_url|url|src)["']\s*:\s*["']([^"']+\.(?:mp4|webm|mov|m4v|flv)[^"']*)["']/gi;
  while ((m = jsonRe.exec(html)) !== null) {
    push(m[1]);
  }

  /*
   * v2.6.0（v20261024-1）：抖音 / 快手页面的数据藏在百分号编码的 RENDER_DATA
   * （或 __INITIAL_STATE__）里，上面按原文匹配的正则全都看不见 —— 先把整页做
   * decodeURIComponent 尝试解码，再用同样的规则跑一遍。解码失败（含裸 %）的
   * 片段 decodeURIComponent 会抛错，这里按 script 块分段解码，单块失败不影响其他。
   */
  const decodedChunks: string[] = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = scriptRe.exec(html)) !== null) {
    try {
      decodedChunks.push(decodeURIComponent(m[1]));
    } catch {
      /* 该块不是合法百分号编码，跳过 */
    }
  }
  // URL 数组字段：抖音 play_addr.url_list / 快手 photo.url 数组等。
  // 解码块里任何 http 地址都会被扫到（头像/封面/统计打点…），
  // 这里只保留带视频特征的地址，避免噪声挤掉真候选（调用方最多探测 6 条）。
  const urlListRe = /(?:https?%3A%2F%2F|https?:\\?\/\\?\/)[^\s"'<>\\)\]]+/gi;
  const videoHint = /mp4|video|play|aweme|motion|media|stream/i;
  for (const chunk of decodedChunks) {
    let um: RegExpExecArray | null;
    while ((um = urlListRe.exec(chunk)) !== null) {
      const cand = um[0].replace(/\\/g, '');
      if (videoHint.test(cand)) push(cand);
    }
  }
  for (const chunk of decodedChunks) {
    let jm: RegExpExecArray | null;
    const chunkJsonRe = new RegExp(jsonRe.source, 'gi');
    while ((jm = chunkJsonRe.exec(chunk)) !== null) {
      push(jm[1]);
    }
  }

  // 4. 裸视频直链兜底
  const bareRe = /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi;
  while ((m = bareRe.exec(html)) !== null) {
    push(m[0]);
  }
  // 4b. 解码块里的裸视频直链（含百分号编码形式还原）
  const bareDecodedRe = /https?:\/\/[^\s"'<>]+(?:\.mp4|mime_type%3Dvideo[^\s"'<>]*)[^\s"'<>]*/gi;
  for (const chunk of decodedChunks) {
    let bm: RegExpExecArray | null;
    while ((bm = bareDecodedRe.exec(chunk)) !== null) {
      push(bm[0]);
    }
  }

  return out;
}

/** Range 探测候选：确认是媒体（或至少不是网页） */
async function probeIsMedia(url: string, referer?: string, timeoutMs = 12000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        ...BASE_HEADERS,
        ...(referer ? { referer } : {}),
        range: 'bytes=0-0',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    // 读完立即释放连接
    resp.body?.cancel().catch(() => undefined);
    const mime = resp.headers.get('content-type')?.split(';')[0]?.trim() || '';
    if (/^text\/html/i.test(mime)) return false;
    if (/^(video|audio)\//i.test(mime)) return true;
    if (/^(application\/octet-stream|binary\/octet-stream)/i.test(mime)) return true;
    // 206 且未声明类型 → 大概率是媒体
    if (resp.status === 206 && !mime) return true;
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 文件名安全化（页面标题 → 文件名） */
function sanitizeName(title: string, ext = 'mp4'): string {
  const base = (title || '')
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return base ? `${base}.${ext}` : '';
}

/** 哔哩哔哩：BV/av → view API 拿 cid → playurl API 拿 mp4 直链（免登录 360P） */
async function resolveBilibili(url: string): Promise<ResolvedVideo | null> {
  if (!/(?:^|\.)bilibili\.com$/i.test(new URL(url).hostname)) return null;
  const bv = /\/video\/(BV[0-9A-Za-z]{10})/i.exec(url)?.[1];
  const aid = /\bav(\d+)\b/i.exec(url)?.[1];
  if (!bv && !aid) return null;

  const infoUrl = bv
    ? `https://api.bilibili.com/x/web-interface/view?bvid=${bv}`
    : `https://api.bilibili.com/x/web-interface/view?aid=${aid}`;
  const info = safeJson<any>(await fetchText(infoUrl, 'https://www.bilibili.com/'));
  const data = info?.data;
  const cid = data?.cid || data?.pages?.[0]?.cid;
  const realBvid = data?.bvid || bv;
  if (!cid || !realBvid) return null;

  // platform=html5 + fnval=0：免登录返回 mp4（durl）格式，无需 ffmpeg 合流
  const playUrl = `https://api.bilibili.com/x/player/playurl?bvid=${realBvid}&cid=${cid}&qn=32&fnval=0&platform=html5`;
  const play = safeJson<any>(await fetchText(playUrl, 'https://www.bilibili.com/'));
  const direct = play?.data?.durl?.[0]?.url;
  if (!direct) return null;

  return {
    directUrl: direct,
    referer: 'https://www.bilibili.com/',
    name: sanitizeName(data?.title || ''),
  };
}

/**
 * 从已抓取的页面 HTML 中解析视频地址（fetchRes 主链路使用：页面已抓好，避免二次下载）。
 */
export async function resolveVideoFromHtml(pageUrl: string, html: string): Promise<ResolveResult> {
  // 1. 平台专用解析（B 站 API 无需依赖页面内容）
  try {
    const bili = await resolveBilibili(pageUrl);
    if (bili) {
      appLog.info('video', 'B 站视频解析成功：' + (bili.name || bili.directUrl.slice(0, 80)));
      return { ok: true, video: bili };
    }
  } catch (e) {
    appLog.warn('video', 'B 站解析失败，回退通用解析', (e as Error).message);
  }

  // 2. 通用提取（HTML 已就绪，直接正则）
  const trimmed = html.length > 3 * 1024 * 1024 ? html.slice(0, 3 * 1024 * 1024) : html;
  const candidates = extractCandidatesFromHtml(trimmed, pageUrl);
  if (!candidates.length) {
    return { ok: false, message: '未能从页面中解析出视频地址（该平台可能有反爬限制）' };
  }

  for (const cand of candidates.slice(0, 6)) {
    const isMedia = await probeIsMedia(cand);
    if (isMedia) {
      appLog.info('video', `播放页解析成功（${new URL(pageUrl).hostname}）：${cand.slice(0, 100)}`);
      return { ok: true, video: { directUrl: cand } };
    }
  }

  return { ok: false, message: '页面中提取到的地址均不是可下载的视频（该平台可能有防盗链/签名限制）' };
}

/**
 * 独立入口：把「播放页链接」解析为「真实视频地址」。
 * 直接传入视频直链时原样返回（不带 referer）。
 */
export async function resolveVideoPage(url: string): Promise<ResolveResult> {
  // 直链视频：无需解析
  if (isDirectMediaUrl(url)) return { ok: true, video: { directUrl: url } };

  let pageUrl: URL;
  try {
    pageUrl = new URL(url);
  } catch {
    return { ok: false, message: 'URL 无效' };
  }

  let html: string;
  const finalUrl = { value: url };
  try {
    html = await fetchText(url, undefined, 15000, finalUrl);
  } catch (e) {
    return { ok: false, message: `页面拉取失败: ${(e as Error).message}` };
  }

  // v2.6.0：短链（b23.tv 等）302 后用最终地址解析，平台判断才不会落空
  return resolveVideoFromHtml(finalUrl.value, html);
}
