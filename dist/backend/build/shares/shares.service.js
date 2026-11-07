"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHARE_PW_COOKIE_OPTIONS = exports.SharesService = exports.SHARE_PW_COOKIE = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
const app_log_1 = require("../common/app-log");
const file_view_1 = require("../common/file-view");
const folder_meta_service_1 = require("../files/folder-meta.service");
const instances_service_1 = require("../instances/instances.service");
const tags_1 = require("../common/tags");
exports.SHARE_PW_COOKIE = 'gohub_share_pw';
const SHARE_PW_MAX_AGE = 7 * 24 * 3600;
const pwLogThrottle = new Map();
function shouldLogPwFailure(key) {
    const now = Date.now();
    const last = pwLogThrottle.get(key) || 0;
    if (now - last < 60_000)
        return false;
    pwLogThrottle.set(key, now);
    if (pwLogThrottle.size > 500) {
        for (const [k, t] of pwLogThrottle)
            if (now - t > 60_000)
                pwLogThrottle.delete(k);
    }
    return true;
}
function toBool(v, fallback) {
    if (v === undefined || v === null || v === '')
        return fallback;
    if (typeof v === 'boolean')
        return v;
    const t = String(v).trim().toLowerCase();
    if (t === 'true' || t === '1' || t === 'on' || t === 'yes')
        return true;
    if (t === 'false' || t === '0' || t === 'off' || t === 'no')
        return false;
    return fallback;
}
function parseExpireAt(raw) {
    if (raw === undefined)
        return {};
    if (raw === null || String(raw).trim() === '')
        return { value: null };
    const d = new Date(String(raw).trim());
    if (Number.isNaN(d.getTime()))
        return { error: '到期时间格式不正确' };
    return { value: d };
}
function publiclyVisible(metasRaw) {
    const m = (0, file_view_1.safeParse)(metasRaw);
    return (m.ListType || 'None') !== 'Block' && m.Label !== 'adult';
}
let SharesService = class SharesService {
    async ownerIdOf(username) {
        const name = String(username || '').trim();
        if (!name)
            return '';
        try {
            const row = await prisma_1.prisma.user.findUnique({ where: { username: name }, select: { id: true } });
            if (row?.id)
                return row.id;
            const count = await prisma_1.prisma.user.count();
            return count > 0 ? name : 'admin';
        }
        catch {
            return name;
        }
    }
    async instanceListOf(username) {
        const name = String(username || '').trim();
        if (!name)
            return [];
        const myId = await this.ownerIdOf(name);
        const [mine, rough] = await Promise.all([
            prisma_1.prisma.instance.findMany({
                where: { ownerId: myId },
                select: { id: true, name: true, createdAt: true, metas: true },
            }),
            prisma_1.prisma.instance.findMany({
                where: { ownerId: { not: myId }, metas: { contains: `"${name}"` } },
                select: { id: true, name: true, createdAt: true, metas: true },
            }),
        ]);
        const joined = rough.filter((i) => (0, instances_service_1.readInstanceMembers)(i.metas).includes(name));
        return [...mine, ...joined]
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map((i) => ({ id: i.id, name: i.name, createdAt: i.createdAt }));
    }
    async indexMapsOf(owners) {
        const out = new Map();
        await Promise.all(owners.filter(Boolean).map(async (owner) => {
            const list = await this.instanceListOf(owner);
            const m = new Map();
            list.forEach((inst, i) => m.set(inst.id, { index: i + 1, name: inst.name }));
            out.set(owner, m);
        }));
        return out;
    }
    async instanceOfIndex(username, idx) {
        if (!Number.isFinite(idx) || idx < 0)
            return null;
        if (idx === 0)
            return { id: '', name: '默认' };
        const list = await this.instanceListOf(username);
        const hit = list[Math.floor(idx) - 1];
        return hit ? { id: hit.id, name: hit.name } : null;
    }
    buildUrl(owner, instanceIndex, type, target) {
        const base = `/browse/${encodeURIComponent(owner)}/${instanceIndex}/${type === 'tag' ? 'tag' : 'cate'}`;
        const segs = type === 'tag'
            ? String(target || '').trim()
                ? [String(target).trim()]
                : []
            : String(target || '')
                .split('/')
                .filter(Boolean);
        const tail = segs.map((s) => encodeURIComponent(s)).join('/');
        return tail ? `${base}/${tail}` : `${base}/`;
    }
    serializeRow(row, map) {
        const meta = row.instanceId ? map?.get(row.instanceId) : { index: 0, name: '默认' };
        const instanceIndex = meta?.index ?? 0;
        const instanceName = meta?.name ?? (row.instanceId ? '（实例已删除）' : '默认');
        return {
            id: row.id,
            owner: row.owner,
            instanceId: row.instanceId,
            instanceIndex,
            instanceName,
            type: row.type,
            target: row.target,
            url: this.buildUrl(row.owner, instanceIndex, row.type, row.target),
            enabled: row.enabled,
            expired: !!row.expireAt && row.expireAt.getTime() < Date.now(),
            encrypted: !!row.passwordHash,
            expireAt: row.expireAt ? row.expireAt.toISOString() : null,
            note: row.note || '',
            createdAt: row.createdAt.toISOString(),
        };
    }
    async canShare(username) {
        const u = String(username || '').trim();
        if (!u)
            return false;
        try {
            const row = await prisma_1.prisma.user.findUnique({ where: { username: u }, select: { role: true, shareEnabled: true } });
            if (!row)
                return true;
            if (row.role === 'admin' || row.role === 'super')
                return true;
            return row.shareEnabled === true;
        }
        catch {
            return false;
        }
    }
    async canUseInstance(username, instanceId, isAdmin) {
        if (!instanceId)
            return true;
        const inst = await prisma_1.prisma.instance.findUnique({
            where: { id: instanceId },
            select: { ownerId: true, ownerName: true, metas: true },
        });
        if (!inst)
            return false;
        if (isAdmin)
            return true;
        if (inst.ownerName === username)
            return true;
        if ((0, instances_service_1.readInstanceMembers)(inst.metas).includes(username))
            return true;
        return inst.ownerId === (await this.ownerIdOf(username));
    }
    async list(q, actor) {
        const page = Math.max(1, Number(q.page) || 1);
        const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));
        const where = {};
        if (actor.isAdmin) {
            const want = String(q.username || '').trim();
            if (want)
                where.owner = want;
        }
        else {
            where.owner = actor.user;
        }
        if (q.instanceId !== undefined)
            where.instanceId = String(q.instanceId ?? '');
        const type = String(q.type || '').trim();
        if (type === 'cate' || type === 'tag')
            where.type = type;
        const kw = String(q.keyword || '').trim();
        if (kw) {
            where.OR = [
                { target: { contains: kw, mode: 'insensitive' } },
                { note: { contains: kw, mode: 'insensitive' } },
            ];
        }
        const [total, rows] = await Promise.all([
            prisma_1.prisma.shareLink.count({ where }),
            prisma_1.prisma.shareLink.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ]);
        const maps = await this.indexMapsOf(Array.from(new Set(rows.map((r) => r.owner))));
        return {
            success: true,
            total,
            page,
            pageSize,
            data: rows.map((r) => this.serializeRow(r, maps.get(r.owner))),
        };
    }
    async upsert(actor, body) {
        const type = body?.type === 'tag' ? 'tag' : body?.type === 'cate' ? 'cate' : '';
        if (!type)
            return { error: 'type 只能是 cate 或 tag', status: 400 };
        const asUser = String(body?.username || '').trim();
        const owner = actor.isAdmin && asUser ? asUser : actor.user;
        if (!owner)
            return { error: '未登录', status: 401 };
        const instanceId = String(body?.instanceId ?? '');
        if (!(await this.canUseInstance(owner, instanceId, actor.isAdmin))) {
            return { error: '实例不存在或当前账户无权使用该实例', status: 400 };
        }
        if (!(await this.canShare(owner))) {
            return { error: '该账户未开启对外分享权限', status: 403 };
        }
        const target = type === 'tag' ? String(body?.target || '').trim().slice(0, 100) : (0, folder_meta_service_1.normalizeFolderPath)(body?.target);
        if (type === 'tag' && !target)
            return { error: '请指定要分享的标签', status: 400 };
        let tagId = '';
        if (type === 'tag') {
            const tag = await prisma_1.prisma.tag.findFirst({
                where: { name: target, instanceId, type: tags_1.TAG_TYPE_FILE },
                select: { id: true },
            });
            if (!tag)
                return { error: `标签「${target}」不存在`, status: 400 };
            tagId = tag.id;
        }
        const exp = parseExpireAt(body?.expireAt);
        if (exp.error)
            return { error: exp.error, status: 400 };
        const enabledGiven = body?.enabled !== undefined;
        const enabled = toBool(body?.enabled, true);
        const pwdGiven = body?.password !== undefined;
        const passwordHash = pwdGiven ? (String(body?.password || '') ? (0, folder_meta_service_1.sha256Hex)(String(body.password)) : '') : '';
        const noteGiven = body?.note !== undefined;
        const update = { tagId };
        if (enabledGiven)
            update.enabled = enabled;
        if (pwdGiven)
            update.passwordHash = passwordHash;
        if (exp.value !== undefined)
            update.expireAt = exp.value;
        if (noteGiven)
            update.note = String(body?.note || '').slice(0, 1000);
        const row = await prisma_1.prisma.shareLink.upsert({
            where: { owner_instanceId_type_target: { owner, instanceId, type, target } },
            create: {
                owner,
                instanceId,
                type,
                target,
                tagId,
                enabled,
                passwordHash,
                expireAt: exp.value ?? null,
                note: String(body?.note || '').slice(0, 1000),
            },
            update,
        });
        if (type === 'cate')
            await this.syncGallery(owner, instanceId, target, row.enabled);
        const maps = await this.indexMapsOf([owner]);
        app_log_1.appLog.info('share', `对外分享已保存：${type === 'tag' ? `标签 ${target}` : `目录 ${target || '（根目录）'}`}`, `owner=${owner} ｜ 实例=${instanceId || '默认'} ｜ 启用=${row.enabled} ｜ 加密=${!!row.passwordHash} ｜ 到期=${row.expireAt ? row.expireAt.toISOString() : '不限时'}`);
        return { item: this.serializeRow(row, maps.get(owner)) };
    }
    async patch(id, actor, body) {
        const row = await prisma_1.prisma.shareLink.findUnique({ where: { id: String(id || '') } });
        if (!row)
            return { error: '分享不存在', status: 404 };
        if (!actor.isAdmin && row.owner !== actor.user)
            return { error: '无权操作该分享', status: 403 };
        const exp = parseExpireAt(body?.expireAt);
        if (exp.error)
            return { error: exp.error, status: 400 };
        const data = {};
        if (body?.enabled !== undefined)
            data.enabled = toBool(body.enabled, row.enabled);
        if (body?.password !== undefined) {
            data.passwordHash = String(body.password || '') ? (0, folder_meta_service_1.sha256Hex)(String(body.password)) : '';
        }
        if (exp.value !== undefined)
            data.expireAt = exp.value;
        if (body?.note !== undefined)
            data.note = String(body.note || '').slice(0, 1000);
        const next = await prisma_1.prisma.shareLink.update({ where: { id: row.id }, data });
        if (next.type === 'cate')
            await this.syncGallery(next.owner, next.instanceId, next.target, next.enabled);
        if (body?.enabled !== undefined) {
            app_log_1.appLog.info('share', `${next.enabled ? '启用' : '停用'}对外分享：${next.target || '（根目录）'}`, `owner=${next.owner} ｜ 实例=${next.instanceId || '默认'} ｜ 类型=${next.type}`);
        }
        const maps = await this.indexMapsOf([next.owner]);
        return { item: this.serializeRow(next, maps.get(next.owner)) };
    }
    async remove(id, actor) {
        const row = await prisma_1.prisma.shareLink.findUnique({ where: { id: String(id || '') } });
        if (!row)
            return { error: '分享不存在', status: 404 };
        if (!actor.isAdmin && row.owner !== actor.user)
            return { error: '无权操作该分享', status: 403 };
        await prisma_1.prisma.shareLink.delete({ where: { id: row.id } });
        if (row.type === 'cate')
            await this.syncGallery(row.owner, row.instanceId, row.target, false);
        app_log_1.appLog.info('share', `删除对外分享：${row.target || '（根目录）'}`, `owner=${row.owner} ｜ 实例=${row.instanceId || '默认'} ｜ 类型=${row.type}`);
        return { success: true };
    }
    async batch(actor, body) {
        const ids = (Array.isArray(body?.ids) ? body.ids : []).map((x) => String(x || '')).filter(Boolean);
        const action = String(body?.action || '').trim();
        if (!ids.length)
            return { success: true, updated: 0 };
        if (!['enable', 'disable', 'password', 'delete'].includes(action)) {
            return { error: '不支持的操作', status: 400 };
        }
        const rows = await prisma_1.prisma.shareLink.findMany({ where: { id: { in: ids } } });
        const mine = rows.filter((r) => actor.isAdmin || r.owner === actor.user);
        if (!mine.length)
            return { success: true, updated: 0 };
        const targetIds = mine.map((r) => r.id);
        let updated = 0;
        if (action === 'delete') {
            const r = await prisma_1.prisma.shareLink.deleteMany({ where: { id: { in: targetIds } } });
            updated = r.count;
            await Promise.all(mine.filter((x) => x.type === 'cate').map((x) => this.syncGallery(x.owner, x.instanceId, x.target, false)));
        }
        else if (action === 'password') {
            const hash = String(body?.password || '') ? (0, folder_meta_service_1.sha256Hex)(String(body.password)) : '';
            const r = await prisma_1.prisma.shareLink.updateMany({ where: { id: { in: targetIds } }, data: { passwordHash: hash } });
            updated = r.count;
        }
        else {
            const enabled = action === 'enable';
            const r = await prisma_1.prisma.shareLink.updateMany({ where: { id: { in: targetIds } }, data: { enabled } });
            updated = r.count;
            await Promise.all(mine
                .filter((x) => x.type === 'cate')
                .map((x) => this.syncGallery(x.owner, x.instanceId, x.target, enabled)));
        }
        app_log_1.appLog.info('share', `批量${action === 'delete' ? '删除' : action === 'password' ? '改密码' : action === 'enable' ? '启用' : '停用'}对外分享`, `操作者=${actor.user} ｜ 命中 ${updated} 条`);
        return { success: true, updated };
    }
    async syncGallery(owner, instanceId, path, on) {
        const p = (0, folder_meta_service_1.normalizeFolderPath)(path);
        if (!p)
            return;
        try {
            const row = await prisma_1.prisma.folderMeta.findFirst({ where: { owner, instanceId, path: p } });
            if (row) {
                await prisma_1.prisma.folderMeta.update({ where: { id: row.id }, data: { gallery: on } });
            }
            else if (on) {
                await prisma_1.prisma.folderMeta.create({ data: { owner, instanceId, path: p, gallery: true } });
            }
        }
        catch (err) {
            app_log_1.appLog.warn('share', `同步目录属性 gallery 失败：${p}`, err?.message || String(err));
        }
        try {
            const key = 'sysConfig:others';
            const cur = await prisma_1.prisma.setting.findUnique({ where: { key } });
            const parsed = (0, file_view_1.safeParse)(cur?.value);
            const pb = parsed.publicBrowse || {};
            const dirs = (0, folder_meta_service_1.parseGalleryDirs)(pb.allowedDir);
            const next = (on ? Array.from(new Set([...dirs, p])) : dirs.filter((d) => d !== p)).sort();
            const merged = { ...parsed, publicBrowse: { ...pb, allowedDir: next.join('\n') } };
            await prisma_1.prisma.setting.upsert({
                where: { key },
                update: { value: JSON.stringify(merged) },
                create: { key, value: JSON.stringify(merged) },
            });
        }
        catch (err) {
            app_log_1.appLog.warn('share', `同步访客图库白名单失败：${p}`, err?.message || String(err));
        }
    }
    async resolveShare(q, ctx) {
        const owner = String(q.user || '').trim();
        if (!owner)
            return { ok: false, error: '缺少用户名' };
        const idx = Number(q.idx ?? 0);
        if (!Number.isFinite(idx) || idx < 0)
            return { ok: false, error: '实例序号不正确' };
        const user = await prisma_1.prisma.user.findUnique({ where: { username: owner }, select: { username: true } });
        if (!user && !(await this.isBuiltinAdminName(owner))) {
            return { ok: false, error: '用户不存在' };
        }
        const inst = await this.instanceOfIndex(owner, Math.floor(idx));
        if (!inst)
            return { ok: false, error: '实例不存在' };
        const kind = q.kind === 'tag' ? 'tag' : 'cate';
        const target = kind === 'tag' ? String(q.tag || '').trim() : (0, folder_meta_service_1.normalizeFolderPath)(q.path ?? q.dir);
        if (kind === 'tag' && !target)
            return { ok: false, error: '缺少标签名' };
        const share = await prisma_1.prisma.shareLink.findUnique({
            where: { owner_instanceId_type_target: { owner, instanceId: inst.id, type: kind, target } },
        });
        if (!share)
            return { ok: false, error: '分享不存在或已被取消' };
        if (!share.enabled)
            return { ok: false, error: '该分享已停用' };
        if (share.expireAt && share.expireAt.getTime() < Date.now())
            return { ok: false, error: '该分享已过期' };
        if (share.passwordHash) {
            const pw = String(q.pw || '');
            if (String(ctx.cookieHash || '') === share.passwordHash)
                return { ok: true, share };
            if (pw && (0, folder_meta_service_1.sha256Hex)(pw) === share.passwordHash)
                return { ok: true, share, setPwHash: share.passwordHash };
            if (pw && shouldLogPwFailure(`${share.id}::${ctx.ip || '-'}`)) {
                app_log_1.appLog.warn('share', `分享密码验证失败：${kind === 'tag' ? `标签 ${target}` : `目录 ${target || '（根目录）'}`}`, `owner=${owner} ｜ 实例=${inst.id || '默认'} ｜ 分享=${share.id}`, ctx.ip || '');
            }
            return { ok: false, needPassword: true, error: pw ? '密码错误' : undefined };
        }
        return { ok: true, share };
    }
    async isBuiltinAdminName(username) {
        const u = String(username || '').trim();
        if (!u)
            return false;
        const env = (process.env.ADMIN_USER || '').trim() || (process.env.SUPER_ADMIN_USERNAME || '').trim() || 'admin';
        if (u === env)
            return true;
        try {
            const admin = await prisma_1.prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
            return !!admin && admin.username === u;
        }
        catch {
            return false;
        }
    }
    fileWhere(share) {
        const where = {
            status: 'active',
            uploader: share.owner,
            instanceId: share.instanceId,
        };
        if (share.type === 'tag') {
            where.tags = {
                some: { tag: { name: share.target, instanceId: share.instanceId, owner: share.owner } },
            };
        }
        else if (share.target) {
            where.OR = [{ folder: share.target }, { folder: { startsWith: `${share.target}/` } }];
        }
        return where;
    }
    async publicAccess(q, ctx) {
        const r = await this.resolveShare(q, ctx);
        if (!r.ok) {
            return {
                success: !!r.needPassword,
                ok: false,
                ...(r.needPassword ? { needPassword: true } : {}),
                ...(r.error ? { error: r.error } : {}),
            };
        }
        const share = r.share;
        const name = share.type === 'tag'
            ? share.target
            : share.target
                ? share.target.split('/').filter(Boolean).pop() || share.target
                : '根目录';
        const count = await prisma_1.prisma.fileRecord.count({ where: this.fileWhere(share) });
        return {
            success: true,
            ok: true,
            name,
            owner: share.owner,
            instanceId: share.instanceId,
            kind: share.type,
            count,
            ...(r.setPwHash ? { setPwHash: r.setPwHash } : {}),
        };
    }
    async publicList(q, ctx) {
        const empty = {
            success: false,
            ok: false,
            files: [],
            directories: [],
            totalCount: 0,
            returnedCount: 0,
            allowedDirs: [],
            fromCache: false,
        };
        const r = await this.resolveShare(q, ctx);
        if (!r.ok) {
            return {
                ...empty,
                success: !!r.needPassword,
                needPassword: !!r.needPassword,
                ...(r.error ? { error: r.error } : {}),
            };
        }
        const share = r.share;
        const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? q.count ?? 50) || 50));
        const start = q.page ? (Math.max(1, Number(q.page) || 1) - 1) * pageSize : Math.max(0, Number(q.start || 0) || 0);
        const rows = await prisma_1.prisma.fileRecord.findMany({
            where: this.fileWhere(share),
            include: { copies: { include: { channel: true } } },
            orderBy: { createdAt: 'desc' },
        });
        const visible = rows.filter((x) => publiclyVisible(x.metas));
        const search = String(q.search || '').trim().toLowerCase();
        const wantType = String(q.type || '').trim().toLowerCase();
        const matched = visible.filter((x) => {
            if (search && !x.originalName.toLowerCase().includes(search) && !x.name.toLowerCase().includes(search))
                return false;
            if (wantType && (0, file_view_1.fileTypeOf)(x.mime) !== wantType)
                return false;
            return true;
        });
        const totalCount = matched.length;
        const paged = pageSize > 0 ? matched.slice(start, start + pageSize) : matched.slice(start);
        const basePrefix = share.type === 'tag' ? '' : share.target ? `${share.target}/` : '';
        const dirSet = new Set();
        for (const x of matched) {
            const full = (x.folder || '').replace(/\/+$/, '');
            if (basePrefix && full !== share.target && !full.startsWith(basePrefix))
                continue;
            const rest = full.slice(basePrefix.length);
            const i = rest.indexOf('/');
            if (i > 0)
                dirSet.add(basePrefix + rest.slice(0, i));
        }
        const directories = Array.from(dirSet).sort();
        return {
            success: true,
            ok: true,
            ...(r.setPwHash ? { setPwHash: r.setPwHash } : {}),
            files: paged.map((x) => (0, file_view_1.serializeFile)(x, x.copies)),
            directories,
            totalCount,
            returnedCount: paged.length,
            allowedDirs: share.type === 'cate' && share.target ? [share.target] : [],
            fromCache: false,
        };
    }
};
exports.SharesService = SharesService;
exports.SharesService = SharesService = __decorate([
    (0, common_1.Injectable)()
], SharesService);
exports.SHARE_PW_COOKIE_OPTIONS = {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SHARE_PW_MAX_AGE * 1000,
};
