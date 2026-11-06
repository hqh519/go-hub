/**
 * 纯真 IP 归属地本地数据包（qqwry.dat）解析（v2.6.0 #301）。
 *
 * 数据文件由管理员在后台上传，存放于 backend/uploads/ipdata/qqwry.dat
 * （uploads 整卷在 Docker 里持久化，重建容器不丢）。
 *
 * 实现要点：
 *   · 惰性加载 + mtime 缓存：重新上传后下一次查询自动换用新文件；
 *   · 二分查找索引区（7 字节/条：4 字节 IP + 3 字节记录偏移）；
 *   · 国家/地区字符串 GBK 解码（Node 内置全量 ICU 的 TextDecoder）；
 *   · 解析结果拆成 { country, region(省), city(地区) }，与 ip-api 的三段口径对齐。
 */

import { readFileSync, writeFileSync, renameSync, statSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { backendSub } from './project-paths';

/** 数据包固定路径：backend/uploads/ipdata/qqwry.dat（随 uploads 卷持久化） */
export function qqwryPath(): string {
  return join(backendSub('uploads'), 'ipdata', 'qqwry.dat');
}

let decoder: TextDecoder | null = null;
function gbk(): TextDecoder {
  if (!decoder) decoder = new TextDecoder('gbk');
  return decoder;
}

interface QqwryState {
  buf: Buffer;
  firstIndex: number; // 索引区起始偏移
  lastIndex: number; // 索引区结束偏移
  count: number;
  mtimeMs: number;
  sizeBytes: number;
}

let state: QqwryState | null = null;
let loadError = '';

/** 读 3 字节小端偏移 */
function readOffset3(buf: Buffer, pos: number): number {
  return buf[pos] + buf[pos + 1] * 256 + buf[pos + 2] * 65536;
}

/** 读取字符串（0 结尾；mode 0x02 时跟 4 字节再跳一次） */
function readString(buf: Buffer, pos: number): { text: string; next: number } {
  const mode = buf[pos];
  if (mode === 0x01) {
    // 重定向：跟着 3 字节绝对偏移 —— 目标处没有模式字节，直接是字符串区
    return readRedirectTarget(buf, readOffset3(buf, pos + 1));
  }
  if (mode === 0x02) {
    // 国名重定向 + 地区就地读取（紧跟 3 字节偏移之后）
    const countryPos = readOffset3(buf, pos + 1);
    const country = gbk().decode(buf.subarray(countryPos, countryEnd(buf, countryPos)));
    const area = gbk().decode(buf.subarray(pos + 4, areaEnd(buf, pos + 4))).replace(/\s+/g, ' ').trim();
    return { text: `${country}\t${area}`, next: pos + 4 };
  }
  // 普通模式：模式字节之后紧跟两个 0 结尾字符串连排
  let p = pos + 1;
  const cStart = p;
  while (p < buf.length && buf[p] !== 0) p += 1;
  const country = gbk().decode(buf.subarray(cStart, p));
  const area = gbk().decode(buf.subarray(p + 1, areaEnd(buf, p + 1))).replace(/\s+/g, ' ').trim();
  return { text: `${country}\t${area}`, next: p };
}

/** 0x01 重定向目标：通常直接是 country\0area\0，个别情形会再带 0x02 国名重定向 */
function readRedirectTarget(buf: Buffer, pos: number): { text: string; next: number } {
  if (buf[pos] === 0x02) {
    const countryPos = readOffset3(buf, pos + 1);
    const country = gbk().decode(buf.subarray(countryPos, countryEnd(buf, countryPos)));
    const area = gbk().decode(buf.subarray(pos + 4, areaEnd(buf, pos + 4))).replace(/\s+/g, ' ').trim();
    return { text: `${country}\t${area}`, next: pos + 4 };
  }
  let p = pos;
  while (p < buf.length && buf[p] !== 0) p += 1;
  const country = gbk().decode(buf.subarray(pos, p));
  const area = gbk().decode(buf.subarray(p + 1, areaEnd(buf, p + 1))).replace(/\s+/g, ' ').trim();
  return { text: `${country}\t${area}`, next: p };
}

function countryEnd(buf: Buffer, pos: number): number {
  let p = pos;
  while (p < buf.length && buf[p] !== 0) p += 1;
  return p;
}

function areaEnd(buf: Buffer, pos: number): number {
  let p = pos;
  while (p < buf.length && buf[p] !== 0) p += 1;
  return p;
}

/** 加载/重载数据包（mtime 变化自动生效） */
function load(): QqwryState | null {
  const file = qqwryPath();
  try {
    const st = statSync(file);
    if (state && state.mtimeMs === st.mtimeMs && state.sizeBytes === st.size) return state;
    const buf = readFileSync(file);
    if (buf.length < 16) throw new Error('文件太小，不是有效的 qqwry.dat');
    const firstIndex = buf.readUInt32LE(0);
    const lastIndex = buf.readUInt32LE(4);
    if (firstIndex <= 0 || lastIndex <= firstIndex || lastIndex >= buf.length) {
      throw new Error('索引区非法，不是标准的 qqwry.dat 格式');
    }
    state = {
      buf,
      firstIndex,
      lastIndex,
      count: Math.floor((lastIndex - firstIndex) / 7) + 1,
      mtimeMs: st.mtimeMs,
      sizeBytes: st.size,
    };
    loadError = '';
    console.log(`[qqwry] 数据包已加载：${state.count.toLocaleString()} 条记录，${(st.size / 1048576).toFixed(1)} MB`);
    return state;
  } catch (err: any) {
    const msg = err?.code === 'ENOENT' ? '尚未上传数据包' : String(err?.message || err);
    if (msg !== loadError) console.warn(`[qqwry] 数据包不可用：${msg}`);
    loadError = msg;
    state = null;
    return null;
  }
}

/** 数据包状态（后台设置页展示用） */
export function qqwryStatus(): { exists: boolean; sizeBytes: number; records: number; mtimeMs: number; error: string } {
  const s = load();
  if (!s) return { exists: false, sizeBytes: 0, records: 0, mtimeMs: 0, error: loadError };
  return { exists: true, sizeBytes: s.sizeBytes, records: s.count, mtimeMs: s.mtimeMs, error: '' };
}

/** 保存上传的数据包（写入固定路径） */
export function saveQqwry(content: Buffer): { records: number; sizeBytes: number } {
  const file = qqwryPath();
  mkdirSync(dirname(file), { recursive: true });
  // 先写临时文件再改名，避免写一半被并发查询读到
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
  state = null; // 强制下次查询重载
  const s = load();
  if (!s) throw new Error(loadError || '数据包解析失败');
  return { records: s.count, sizeBytes: s.sizeBytes };
}

/** IPv4 → 数值 */
function ipToLong(ip: string): number {
  const m = String(ip || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return 0;
  const [a, b, c, d] = m.slice(1).map(Number);
  if (a > 255 || b > 255 || c > 255 || d > 255) return 0;
  return ((a << 24) >>> 0) + b * 65536 + c * 256 + d;
}

/**
 * 查询归属地：返回 { country, region(省), city(地区) }；查不到 / 数据包不可用 → null。
 * region/city 拆分规则：
 *   · 国内「XX省YY市ZZ」→ region=XX省，city=YY市ZZ…；
 *   · 直辖市「北京市」→ region=北京市，city=区县部分；
 *   · 自治区「内蒙古自治区XX市」→ region=内蒙古自治区，city=其余；
 *   · 国外 → country=国家，region=''，city=地区字段原文。
 */
export function queryQqwry(ip: string): { country: string; region: string; city: string } | null {
  const s = load();
  if (!s) return null;
  const num = ipToLong(ip);
  if (!num) return null;
  const { buf, firstIndex, lastIndex } = s;

  // 二分查找：索引区 7 字节一条（IP + 3 字节记录偏移）
  let lo = 0;
  let hi = Math.floor((lastIndex - firstIndex) / 7);
  let recordPos = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const pos = firstIndex + mid * 7;
    const startIp = buf.readUInt32LE(pos);
    const endIp = buf.readUInt32LE(readOffset3(buf, pos + 4));
    if (num < startIp) hi = mid - 1;
    else if (num > endIp) lo = mid + 1;
    else {
      recordPos = readOffset3(buf, pos + 4);
      break;
    }
  }
  if (recordPos < 0) return null;

  // 记录结构：[4 字节结束 IP][1 字节模式][国家/地区字符串...]
  let country = '';
  let area = '';
  const r = readString(buf, recordPos + 4);
  [country, area] = r.text.split('\t');
  country = country.replace(/\s+/g, ' ').trim();
  area = area.replace(/CZ88\.NET/gi, '').trim();

  return splitRegion(country, area);
}

/** 把「国家字段 + 地区字段」拆成 country/region/city 三段 */
export function splitRegion(country: string, area: string): { country: string; region: string; city: string } {
  const municipality = ['北京', '上海', '天津', '重庆'];
  // 国外：国家字段不含省级后缀且地区字段有值
  const isDomestic = /(省|自治区|市)$/.test(country) || municipality.some((m) => country.startsWith(m));
  if (!isDomestic) {
    return { country, region: '', city: area || '' };
  }
  // 直辖市：国家字段就是「北京市」等
  const mun = municipality.find((m) => country.startsWith(m));
  if (mun && country.length <= 4) {
    return { country: '中国', region: country, city: area || '' };
  }
  const auton = country.match(/^(.+?自治区)/);
  if (auton) {
    return { country: '中国', region: auton[1], city: country.slice(auton[1].length) || area || '' };
  }
  const prov = country.match(/^(.+?省)/);
  if (prov) {
    return { country: '中国', region: prov[1], city: country.slice(prov[1].length) || area || '' };
  }
  // 兜底：整段当 region
  return { country: '中国', region: country, city: area || '' };
}
