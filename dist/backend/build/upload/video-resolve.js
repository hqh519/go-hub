"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDirectMediaUrl = isDirectMediaUrl;
exports.extractCandidatesFromHtml = extractCandidatesFromHtml;
exports.resolveVideoFromHtml = resolveVideoFromHtml;
exports.resolveVideoPage = resolveVideoPage;
const app_log_1 = require("../common/app-log");
const VIDEO_EXT_RE = /\.(mp4|webm|mov|avi|mkv|m4v|flv|ts|mpg|mpeg|wmv|3gp)(\?|#|$)/i;
function isDirectMediaUrl(url) {
    return VIDEO_EXT_RE.test(url);
}
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE_HEADERS = {
    'user-agent': BROWSER_UA,
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
};
async function fetchText(url, referer, timeoutMs = 15000, finalUrl) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const resp = await fetch(url, {
            signal: ctrl.signal,
            redirect: 'follow',
            headers: { ...BASE_HEADERS, ...(referer ? { referer } : {}) },
        });
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}`);
        if (finalUrl)
            finalUrl.value = resp.url || url;
        return await resp.text();
    }
    finally {
        clearTimeout(timer);
    }
}
function safeJson(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function absolutize(u, base) {
    if (!u)
        return null;
    let cleaned = u.trim().replace(/\\\//g, '/').replace(/&amp;/g, '&');
    if (cleaned.startsWith('//'))
        cleaned = 'https:' + cleaned;
    try {
        const abs = new URL(cleaned, base);
        if (!['http:', 'https:'].includes(abs.protocol))
            return null;
        return abs.toString();
    }
    catch {
        return null;
    }
}
function extractCandidatesFromHtml(html, baseUrl) {
    const out = [];
    const push = (raw) => {
        if (!raw)
            return;
        const abs = absolutize(raw, baseUrl);
        if (abs && !out.includes(abs))
            out.push(abs);
    };
    const metaRe = /<meta[^>]+(?:property|name)\s*=\s*["'](og:video(?::url|:secure_url)?|twitter:player:stream)["'][^>]*>/gi;
    let m;
    while ((m = metaRe.exec(html)) !== null) {
        const tag = m[0];
        const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
        push(content);
    }
    const videoRe = /<(?:video|source)[^>]+>/gi;
    while ((m = videoRe.exec(html)) !== null) {
        const tag = m[0];
        if (/<source/i.test(tag) && !/type\s*=\s*["']video\//i.test(tag))
            continue;
        push(/src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]);
    }
    const jsonRe = /["'](?:playAddr|play_addr|videoUrl|video_url|playUrl|play_url|url|src)["']\s*:\s*["']([^"']+\.(?:mp4|webm|mov|m4v|flv)[^"']*)["']/gi;
    while ((m = jsonRe.exec(html)) !== null) {
        push(m[1]);
    }
    const decodedChunks = [];
    const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    while ((m = scriptRe.exec(html)) !== null) {
        try {
            decodedChunks.push(decodeURIComponent(m[1]));
        }
        catch {
        }
    }
    const urlListRe = /(?:https?%3A%2F%2F|https?:\\?\/\\?\/)[^\s"'<>\\)\]]+/gi;
    const videoHint = /mp4|video|play|aweme|motion|media|stream/i;
    for (const chunk of decodedChunks) {
        let um;
        while ((um = urlListRe.exec(chunk)) !== null) {
            const cand = um[0].replace(/\\/g, '');
            if (videoHint.test(cand))
                push(cand);
        }
    }
    for (const chunk of decodedChunks) {
        let jm;
        const chunkJsonRe = new RegExp(jsonRe.source, 'gi');
        while ((jm = chunkJsonRe.exec(chunk)) !== null) {
            push(jm[1]);
        }
    }
    const bareRe = /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi;
    while ((m = bareRe.exec(html)) !== null) {
        push(m[0]);
    }
    const bareDecodedRe = /https?:\/\/[^\s"'<>]+(?:\.mp4|mime_type%3Dvideo[^\s"'<>]*)[^\s"'<>]*/gi;
    for (const chunk of decodedChunks) {
        let bm;
        while ((bm = bareDecodedRe.exec(chunk)) !== null) {
            push(bm[0]);
        }
    }
    return out;
}
async function probeIsMedia(url, referer, timeoutMs = 12000) {
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
        resp.body?.cancel().catch(() => undefined);
        const mime = resp.headers.get('content-type')?.split(';')[0]?.trim() || '';
        if (/^text\/html/i.test(mime))
            return false;
        if (/^(video|audio)\//i.test(mime))
            return true;
        if (/^(application\/octet-stream|binary\/octet-stream)/i.test(mime))
            return true;
        if (resp.status === 206 && !mime)
            return true;
        return false;
    }
    catch {
        return false;
    }
    finally {
        clearTimeout(timer);
    }
}
function sanitizeName(title, ext = 'mp4') {
    const base = (title || '')
        .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
    return base ? `${base}.${ext}` : '';
}
async function resolveBilibili(url) {
    if (!/(?:^|\.)bilibili\.com$/i.test(new URL(url).hostname))
        return null;
    const bv = /\/video\/(BV[0-9A-Za-z]{10})/i.exec(url)?.[1];
    const aid = /\bav(\d+)\b/i.exec(url)?.[1];
    if (!bv && !aid)
        return null;
    const infoUrl = bv
        ? `https://api.bilibili.com/x/web-interface/view?bvid=${bv}`
        : `https://api.bilibili.com/x/web-interface/view?aid=${aid}`;
    const info = safeJson(await fetchText(infoUrl, 'https://www.bilibili.com/'));
    const data = info?.data;
    const cid = data?.cid || data?.pages?.[0]?.cid;
    const realBvid = data?.bvid || bv;
    if (!cid || !realBvid)
        return null;
    const playUrl = `https://api.bilibili.com/x/player/playurl?bvid=${realBvid}&cid=${cid}&qn=32&fnval=0&platform=html5`;
    const play = safeJson(await fetchText(playUrl, 'https://www.bilibili.com/'));
    const direct = play?.data?.durl?.[0]?.url;
    if (!direct)
        return null;
    return {
        directUrl: direct,
        referer: 'https://www.bilibili.com/',
        name: sanitizeName(data?.title || ''),
    };
}
async function resolveVideoFromHtml(pageUrl, html) {
    try {
        const bili = await resolveBilibili(pageUrl);
        if (bili) {
            app_log_1.appLog.info('video', 'B 站视频解析成功：' + (bili.name || bili.directUrl.slice(0, 80)));
            return { ok: true, video: bili };
        }
    }
    catch (e) {
        app_log_1.appLog.warn('video', 'B 站解析失败，回退通用解析', e.message);
    }
    const trimmed = html.length > 3 * 1024 * 1024 ? html.slice(0, 3 * 1024 * 1024) : html;
    const candidates = extractCandidatesFromHtml(trimmed, pageUrl);
    if (!candidates.length) {
        return { ok: false, message: '未能从页面中解析出视频地址（该平台可能有反爬限制）' };
    }
    for (const cand of candidates.slice(0, 6)) {
        const isMedia = await probeIsMedia(cand);
        if (isMedia) {
            app_log_1.appLog.info('video', `播放页解析成功（${new URL(pageUrl).hostname}）：${cand.slice(0, 100)}`);
            return { ok: true, video: { directUrl: cand } };
        }
    }
    return { ok: false, message: '页面中提取到的地址均不是可下载的视频（该平台可能有防盗链/签名限制）' };
}
async function resolveVideoPage(url) {
    if (isDirectMediaUrl(url))
        return { ok: true, video: { directUrl: url } };
    let pageUrl;
    try {
        pageUrl = new URL(url);
    }
    catch {
        return { ok: false, message: 'URL 无效' };
    }
    let html;
    const finalUrl = { value: url };
    try {
        html = await fetchText(url, undefined, 15000, finalUrl);
    }
    catch (e) {
        return { ok: false, message: `页面拉取失败: ${e.message}` };
    }
    return resolveVideoFromHtml(finalUrl.value, html);
}
