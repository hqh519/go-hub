"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.qqwryPath = qqwryPath;
exports.qqwryStatus = qqwryStatus;
exports.saveQqwry = saveQqwry;
exports.queryQqwry = queryQqwry;
exports.splitRegion = splitRegion;
const fs_1 = require("fs");
const path_1 = require("path");
const project_paths_1 = require("./project-paths");
function qqwryPath() {
    return (0, path_1.join)((0, project_paths_1.backendSub)('uploads'), 'ipdata', 'qqwry.dat');
}
let decoder = null;
function gbk() {
    if (!decoder)
        decoder = new TextDecoder('gbk');
    return decoder;
}
let state = null;
let loadError = '';
function readOffset3(buf, pos) {
    return buf[pos] + buf[pos + 1] * 256 + buf[pos + 2] * 65536;
}
function readString(buf, pos) {
    const mode = buf[pos];
    if (mode === 0x01) {
        return readRedirectTarget(buf, readOffset3(buf, pos + 1));
    }
    if (mode === 0x02) {
        const countryPos = readOffset3(buf, pos + 1);
        const country = gbk().decode(buf.subarray(countryPos, countryEnd(buf, countryPos)));
        const area = gbk().decode(buf.subarray(pos + 4, areaEnd(buf, pos + 4))).replace(/\s+/g, ' ').trim();
        return { text: `${country}\t${area}`, next: pos + 4 };
    }
    let p = pos + 1;
    const cStart = p;
    while (p < buf.length && buf[p] !== 0)
        p += 1;
    const country = gbk().decode(buf.subarray(cStart, p));
    const area = gbk().decode(buf.subarray(p + 1, areaEnd(buf, p + 1))).replace(/\s+/g, ' ').trim();
    return { text: `${country}\t${area}`, next: p };
}
function readRedirectTarget(buf, pos) {
    if (buf[pos] === 0x02) {
        const countryPos = readOffset3(buf, pos + 1);
        const country = gbk().decode(buf.subarray(countryPos, countryEnd(buf, countryPos)));
        const area = gbk().decode(buf.subarray(pos + 4, areaEnd(buf, pos + 4))).replace(/\s+/g, ' ').trim();
        return { text: `${country}\t${area}`, next: pos + 4 };
    }
    let p = pos;
    while (p < buf.length && buf[p] !== 0)
        p += 1;
    const country = gbk().decode(buf.subarray(pos, p));
    const area = gbk().decode(buf.subarray(p + 1, areaEnd(buf, p + 1))).replace(/\s+/g, ' ').trim();
    return { text: `${country}\t${area}`, next: p };
}
function countryEnd(buf, pos) {
    let p = pos;
    while (p < buf.length && buf[p] !== 0)
        p += 1;
    return p;
}
function areaEnd(buf, pos) {
    let p = pos;
    while (p < buf.length && buf[p] !== 0)
        p += 1;
    return p;
}
function load() {
    const file = qqwryPath();
    try {
        const st = (0, fs_1.statSync)(file);
        if (state && state.mtimeMs === st.mtimeMs && state.sizeBytes === st.size)
            return state;
        const buf = (0, fs_1.readFileSync)(file);
        if (buf.length < 16)
            throw new Error('文件太小，不是有效的 qqwry.dat');
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
    }
    catch (err) {
        const msg = err?.code === 'ENOENT' ? '尚未上传数据包' : String(err?.message || err);
        if (msg !== loadError)
            console.warn(`[qqwry] 数据包不可用：${msg}`);
        loadError = msg;
        state = null;
        return null;
    }
}
function qqwryStatus() {
    const s = load();
    if (!s)
        return { exists: false, sizeBytes: 0, records: 0, mtimeMs: 0, error: loadError };
    return { exists: true, sizeBytes: s.sizeBytes, records: s.count, mtimeMs: s.mtimeMs, error: '' };
}
function saveQqwry(content) {
    const file = qqwryPath();
    (0, fs_1.mkdirSync)((0, path_1.dirname)(file), { recursive: true });
    const tmp = `${file}.tmp`;
    (0, fs_1.writeFileSync)(tmp, content);
    (0, fs_1.renameSync)(tmp, file);
    state = null;
    const s = load();
    if (!s)
        throw new Error(loadError || '数据包解析失败');
    return { records: s.count, sizeBytes: s.sizeBytes };
}
function ipToLong(ip) {
    const m = String(ip || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m)
        return 0;
    const [a, b, c, d] = m.slice(1).map(Number);
    if (a > 255 || b > 255 || c > 255 || d > 255)
        return 0;
    return ((a << 24) >>> 0) + b * 65536 + c * 256 + d;
}
function queryQqwry(ip) {
    const s = load();
    if (!s)
        return null;
    const num = ipToLong(ip);
    if (!num)
        return null;
    const { buf, firstIndex, lastIndex } = s;
    let lo = 0;
    let hi = Math.floor((lastIndex - firstIndex) / 7);
    let recordPos = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const pos = firstIndex + mid * 7;
        const startIp = buf.readUInt32LE(pos);
        const endIp = buf.readUInt32LE(readOffset3(buf, pos + 4));
        if (num < startIp)
            hi = mid - 1;
        else if (num > endIp)
            lo = mid + 1;
        else {
            recordPos = readOffset3(buf, pos + 4);
            break;
        }
    }
    if (recordPos < 0)
        return null;
    let country = '';
    let area = '';
    const r = readString(buf, recordPos + 4);
    [country, area] = r.text.split('\t');
    country = country.replace(/\s+/g, ' ').trim();
    area = area.replace(/CZ88\.NET/gi, '').trim();
    return splitRegion(country, area);
}
function splitRegion(country, area) {
    const municipality = ['北京', '上海', '天津', '重庆'];
    const isDomestic = /(省|自治区|市)$/.test(country) || municipality.some((m) => country.startsWith(m));
    if (!isDomestic) {
        return { country, region: '', city: area || '' };
    }
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
    return { country: '中国', region: country, city: area || '' };
}
