/**
 * 极简 User-Agent 解析（访问记录用）。
 *
 * 不引入 ua-parser-js 之类的依赖 —— 图床只需要「设备类型 / 浏览器 / 操作系统」
 * 三档粗粒度信息，正则可以覆盖 99% 的真实流量；识别不出来时一律返回「未知」，
 * 不做任何猜测。
 */
export interface UaInfo {
  device: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  browser: string;
  os: string;
}

const BOTS = /bot|crawler|spider|crawling|curl|wget|python-requests|httpclient|okhttp|headlesschrome|scrapy|go-http-client/i;

export function parseUa(raw?: string | null): UaInfo {
  const ua = String(raw || '');
  if (!ua) return { device: 'unknown', browser: '', os: '' };
  if (BOTS.test(ua)) {
    return { device: 'bot', browser: 'Bot', os: '' };
  }

  const device: UaInfo['device'] = /iPad|Tablet|PlayBook|Nexus 7|Nexus 9|SM-T/i.test(ua)
    ? 'tablet'
    : /Mobi|Android.*Mobile|iPhone|iPod|Windows Phone|BlackBerry|Opera Mini/i.test(ua)
      ? 'mobile'
      : 'desktop';

  let browser = 'Other';
  if (/Edg(?:e|A|iOS)?\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  else if (/MSIE |Trident\//i.test(ua)) browser = 'IE';

  let os = '';
  if (/Windows NT 10/i.test(ua)) os = 'Windows 10/11';
  else if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return { device, browser, os };
}

/**
 * 从 Referer 里取出「来路域名」。
 * 无法解析（空 / 非 HTTP 协议）时返回空串。
 */
export function refererHostOf(referer?: string | null): string {
  const raw = String(referer || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}
