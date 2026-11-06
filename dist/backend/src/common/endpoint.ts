/**
 * 存储渠道「服务地址 / Endpoint」统一处理。
 *
 * 背景（自部署场景的高频需求）：
 *   GoHub 往往与 MinIO / Immich / 兰空 / WebDAV 部署在同一台 NAS、
 *   同一个 docker compose 网络里。此时用「内网 IP」或「容器名」直连渠道，
 *   走内网链路（不经公网、不绕 CDN），上传速度明显更快。
 *
 *   例如渠道地址可以填：
 *     minio:9000            ← 同一 docker 网络里的容器名（服务名）
 *     192.168.1.10:9000     ← NAS 内网 IP
 *     nas.local             ← 局域网主机名
 *
 *   ⚠️ 关键点：渠道通信全部由「服务端」发起（后端进程去 PUT/POST 文件），
 *   前端浏览器只是把配置提交给后端。因此：
 *     - 浏览器的地址栏是 https（对外访问域名）完全没问题，
 *     - 后端仍可用 http://minio:9000 这类内网地址与渠道通信，
 *     - 不存在「混合内容 / Mixed Content」拦截问题（那只约束浏览器）。
 *
 * 用户不写协议时按地址类型自动补：
 *   内网 / 容器名        → http（自建服务普遍未开 TLS，补 https 会直接连不上）
 *   公网域名（含点号）   → https
 */

/**
 * 判断是否为内网 / 容器内地址。
 * 命中规则（按优先级）：
 *   localhost
 *   *.local / *.internal / *.lan
 *   不含点号的裸主机名（docker compose 服务名，如 minio、oss、webdav）
 *   RFC1918 私网 IPv4：10.x / 127.x / 192.168.x / 172.16-31.x / 169.254.x
 *   IPv6 本地链路与唯一本地地址：fe80::、fc00::/7（fc / fd 开头）
 */
export function looksInternalHost(raw: string): boolean {
  let h = String(raw || '').trim().toLowerCase();
  if (!h) return false;
  // 去掉协议与路径，只留主机部分
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0];
  const at = h.lastIndexOf('@'); // 容忍 user:pass@host 写法
  if (at !== -1) h = h.slice(at + 1);
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    h = end === -1 ? h.slice(1) : h.slice(1, end);
  } else {
    h = h.split(':')[0];
  }
  if (!h) return false;
  if (h === 'localhost') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  // 无点号 → docker compose 服务名 / 裸主机名（如 minio、oss）
  if (!h.includes('.')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true;
  return false;
}

/**
 * 补全协议：已是 http(s) 的原样返回；否则按地址类型选择默认协议。
 * 空值返回空串（由调用方决定是否报「缺少配置」）。
 */
export function ensureProtocol(raw: string): string {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return `${looksInternalHost(v) ? 'http' : 'https'}://${v}`;
}
