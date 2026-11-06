import type { Request } from 'express';
import { ensureProtocol } from './endpoint';

/**
 * 请求来源域名（全站唯一实现，v3.0.0 / R10）。
 *
 * 取值口径（已与需求确认）：
 *   外链访问域名（配置） > X-Forwarded-Host > Host > localhost
 *
 * 为什么必须先看 X-Forwarded-Host：
 *   开了 trust proxy 之后 req.protocol 会跟随 X-Forwarded-Proto，
 *   但 `req.get('host')` 仍是「最近一跳」的原始 Host —— 反代若把 Host 改写成上游地址
 *   （localhost:3619 / 容器名），签发出来的外链就会变成内网地址。
 *
 * 为什么还要做字符校验：
 *   X-Forwarded-* 是客户端可伪造的头。只接受 host[:port]，
 *   挡掉 `/`、`@`、空格、换行等注入字符，避免把外链签成任意域名。
 */
export function dynamicOrigin(req: Request): string {
  const xf = String(req.headers['x-forwarded-host'] || '')
    .split(',')[0]
    .trim();
  const raw = xf || String(req.headers.host || '').trim();
  const host = raw.replace(/\/.*$/, '').trim();
  if (!host || !/^[a-z0-9.\-]+(:\d+)?$/i.test(host)) return '';
  const protoRaw = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = protoRaw === 'https' ? 'https' : protoRaw === 'http' ? 'http' : req.protocol || 'http';
  return `${proto}://${host}`;
}

/**
 * 全站「外链访问域名」的内存缓存。
 * 由 SettingsService.getServerDomain() 每次读取时顺带刷新 ——
 * 这样所有签发点（上传响应、WebDAV、API Token、签到链接…）不需要各自 await 一次设置读取，
 * 又能保证「配置优先于请求头」。
 */
let configuredOrigin = '';

/** 刷新「外链访问域名」缓存（传空串表示未配置） */
export function primeSignOrigin(value?: string | null): void {
  const v = String(value || '').trim();
  configuredOrigin = v ? ensureProtocol(v).replace(/\/+$/, '') : '';
}

/**
 * 外链签发域名（同步版）：外链访问域名（配置） > X-Forwarded-Host > Host > localhost。
 * 全站拼绝对地址一律用它。
 */
export function signOrigin(req: Request): string {
  return configuredOrigin || dynamicOrigin(req) || 'http://localhost:3619';
}

/**
 * 外链签发域名（异步版）：配了「外链访问域名」就用配置（不受任何请求头影响），
 * 否则回退动态浏览域名。
 */
export function resolveOrigin(req: Request, configured?: string | null): string {
  const c = String(configured || '').trim();
  if (c) return ensureProtocol(c).replace(/\/+$/, '');
  return dynamicOrigin(req) || 'http://localhost:3619';
}
