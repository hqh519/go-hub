"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstancesService = void 0;
exports.readInstanceMembers = readInstanceMembers;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const prisma_1 = require("../common/prisma");
const app_log_1 = require("../common/app-log");
const INVITE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const INVITE_CODE_LEN = 8;
function readInstanceMembers(metas) {
    try {
        const parsed = JSON.parse(metas || '{}');
        const members = parsed?.members;
        if (!Array.isArray(members))
            return [];
        return Array.from(new Set(members.map((m) => String(m || '').trim()).filter(Boolean)));
    }
    catch {
        return [];
    }
}
function makeInviteCode() {
    const buf = (0, crypto_1.randomBytes)(INVITE_CODE_LEN);
    let code = '';
    for (let i = 0; i < INVITE_CODE_LEN; i += 1)
        code += INVITE_CHARS[buf[i] % INVITE_CHARS.length];
    return code;
}
function isUniqueConflict(err) {
    return err?.code === 'P2002';
}
let InstancesService = class InstancesService {
    async ownerIdOf(username) {
        const name = String(username || '').trim();
        if (!name)
            return '';
        try {
            const row = await prisma_1.prisma.user.findUnique({ where: { username: name }, select: { id: true } });
            if (row?.id)
                return row.id;
            const userCount = await prisma_1.prisma.user.count();
            return userCount > 0 ? name : 'admin';
        }
        catch {
            return name;
        }
    }
    serialize(inst, viewerOwnerId) {
        const members = readInstanceMembers(inst.metas);
        const isOwner = inst.ownerId === viewerOwnerId;
        return {
            id: inst.id,
            name: inst.name,
            note: isOwner ? inst.note : '',
            ownerId: inst.ownerId,
            ownerName: inst.ownerName,
            createdAt: inst.createdAt.toISOString(),
            isOwner,
            memberCount: members.length,
        };
    }
    async list(username) {
        if (!String(username || '').trim())
            return [];
        const myId = await this.ownerIdOf(username);
        const [mine, roughJoined] = await Promise.all([
            prisma_1.prisma.instance.findMany({ where: { ownerId: myId } }),
            prisma_1.prisma.instance.findMany({
                where: { ownerId: { not: myId }, metas: { contains: `"${username}"` } },
            }),
        ]);
        const joined = roughJoined.filter((inst) => readInstanceMembers(inst.metas).includes(username));
        return [...mine, ...joined]
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map((inst) => this.serialize(inst, myId));
    }
    async create(username, rawName, note) {
        const name = String(rawName || '').trim().slice(0, 100);
        if (!name)
            return { error: '请填写实例名称' };
        const myId = await this.ownerIdOf(username);
        try {
            const inst = await prisma_1.prisma.instance.create({
                data: {
                    ownerId: myId,
                    ownerName: username,
                    name,
                    note: String(note || '').slice(0, 2000),
                    metas: JSON.stringify({ members: [username] }),
                },
            });
            app_log_1.appLog.info('instance', `创建实例「${name}」成功`, `owner=${username}`, '');
            return { item: this.serialize(inst, myId) };
        }
        catch (err) {
            if (isUniqueConflict(err))
                return { error: '同名实例已存在，请换一个名称' };
            app_log_1.appLog.warn('instance', `创建实例「${name}」失败`, err?.message || String(err), '');
            return { error: '创建实例失败，请稍后重试' };
        }
    }
    async update(id, username, patch) {
        const inst = await prisma_1.prisma.instance.findUnique({ where: { id } });
        if (!inst)
            return { error: '实例不存在' };
        const myId = await this.ownerIdOf(username);
        if (inst.ownerId !== myId)
            return { error: '仅创建者可修改实例' };
        const data = {};
        if (patch.name !== undefined) {
            const name = String(patch.name || '').trim().slice(0, 100);
            if (!name)
                return { error: '实例名称不能为空' };
            if (name !== inst.name)
                data.name = name;
        }
        if (patch.note !== undefined)
            data.note = String(patch.note || '').slice(0, 2000);
        try {
            const updated = await prisma_1.prisma.instance.update({ where: { id }, data });
            return { item: this.serialize(updated, myId) };
        }
        catch (err) {
            if (isUniqueConflict(err))
                return { error: '同名实例已存在，请换一个名称' };
            return { error: '修改实例失败，请稍后重试' };
        }
    }
    async remove(id, username) {
        const inst = await prisma_1.prisma.instance.findUnique({ where: { id } });
        if (!inst)
            return { error: '实例不存在' };
        const myId = await this.ownerIdOf(username);
        if (inst.ownerId !== myId)
            return { error: '仅创建者可删除实例' };
        const fileCount = await prisma_1.prisma.fileRecord.count({ where: { instanceId: id } });
        if (fileCount > 0) {
            return { error: '实例下仍有文件（含回收站），无法删除' };
        }
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.tag.deleteMany({ where: { instanceId: id } }),
            prisma_1.prisma.instance.delete({ where: { id } }),
        ]);
        app_log_1.appLog.info('instance', `删除实例「${inst.name}」成功`, `owner=${username}`, '');
        return {};
    }
    async createInvite(id, username) {
        const inst = await prisma_1.prisma.instance.findUnique({ where: { id } });
        if (!inst)
            return { error: '实例不存在' };
        const myId = await this.ownerIdOf(username);
        if (inst.ownerId !== myId)
            return { error: '仅创建者可生成邀请码' };
        let code = makeInviteCode();
        let unique = false;
        for (let i = 0; i < 20; i += 1) {
            const exists = await prisma_1.prisma.instance.findFirst({
                where: { inviteCode: code, NOT: { id } },
                select: { id: true },
            });
            if (!exists) {
                unique = true;
                break;
            }
            app_log_1.appLog.warn('instance', `邀请码碰撞，重新生成（第 ${i + 1} 次）`, `code=${code}`);
            code = makeInviteCode();
        }
        if (!unique) {
            app_log_1.appLog.error('instance', '生成邀请码失败：连续 20 次与已有邀请码重复', `实例=${inst.name}`);
            return { error: '生成邀请码失败，请重试' };
        }
        await prisma_1.prisma.instance.update({ where: { id }, data: { inviteCode: code } });
        app_log_1.appLog.info('instance', `实例「${inst.name}」生成新邀请码`, `code=${code}`);
        return { inviteCode: code };
    }
    async getInvite(id, username) {
        const inst = await prisma_1.prisma.instance.findUnique({ where: { id } });
        if (!inst)
            return { error: '实例不存在' };
        const myId = await this.ownerIdOf(username);
        if (inst.ownerId !== myId)
            return { error: '仅创建者可查看邀请码' };
        return { inviteCode: inst.inviteCode || '' };
    }
    async closeInvite(id, username) {
        const inst = await prisma_1.prisma.instance.findUnique({ where: { id } });
        if (!inst)
            return { error: '实例不存在' };
        const myId = await this.ownerIdOf(username);
        if (inst.ownerId !== myId)
            return { error: '仅创建者可关闭邀请' };
        await prisma_1.prisma.instance.update({ where: { id }, data: { inviteCode: '' } });
        return {};
    }
    async join(sessionUser, inputUsername, rawCode) {
        const name = String(inputUsername || '').trim();
        const code = String(rawCode || '').trim();
        if (!name)
            return { error: '请填写用户名' };
        if (!code)
            return { error: '请填写邀请码' };
        const user = await prisma_1.prisma.user.findUnique({
            where: { username: name },
            select: { username: true, enabled: true },
        });
        if (!user) {
            app_log_1.appLog.warn('instance', `加入实例失败：用户名不存在（${name}）`, `sessionUser=${sessionUser}`);
            return { error: '用户名不存在' };
        }
        if (!user.enabled)
            return { error: '该账户已被禁用，无法加入实例' };
        if (String(sessionUser || '') !== user.username) {
            app_log_1.appLog.warn('instance', '加入实例失败：用户名与当前登录账户不一致', `输入=${name} ｜ 会话=${sessionUser}`);
            return { error: '用户名与当前登录账户不一致' };
        }
        const username = user.username;
        const inst = await prisma_1.prisma.instance.findFirst({ where: { inviteCode: code } });
        if (!inst)
            return { error: '邀请码无效' };
        const members = readInstanceMembers(inst.metas);
        if (!members.includes(username)) {
            members.push(username);
            let metas = {};
            try {
                metas = JSON.parse(inst.metas || '{}');
            }
            catch {
                metas = {};
            }
            metas.members = members;
            await prisma_1.prisma.instance.update({ where: { id: inst.id }, data: { metas: JSON.stringify(metas) } });
            app_log_1.appLog.info('instance', `用户 ${username} 加入实例「${inst.name}」`, '', '');
        }
        const myId = await this.ownerIdOf(username);
        return { item: this.serialize({ ...inst, metas: JSON.stringify({ members }) }, myId) };
    }
    async members(id, username) {
        const inst = await prisma_1.prisma.instance.findUnique({ where: { id } });
        if (!inst)
            return { error: '实例不存在' };
        const myId = await this.ownerIdOf(username);
        if (inst.ownerId !== myId)
            return { error: '仅创建者可查看成员列表' };
        return { list: readInstanceMembers(inst.metas).map((username) => ({ username })) };
    }
    async removeMember(id, username, target) {
        const inst = await prisma_1.prisma.instance.findUnique({ where: { id } });
        if (!inst)
            return { error: '实例不存在' };
        const myId = await this.ownerIdOf(username);
        if (inst.ownerId !== myId)
            return { error: '仅创建者可移除成员' };
        const targetName = String(target || '').trim();
        if (!targetName)
            return { error: '请指定要移除的成员' };
        if (targetName === inst.ownerName)
            return { error: '创建者不可被移除' };
        const members = readInstanceMembers(inst.metas);
        const next = members.filter((m) => m !== targetName);
        if (next.length === members.length)
            return { error: '该用户不是实例成员' };
        let metas = {};
        try {
            metas = JSON.parse(inst.metas || '{}');
        }
        catch {
            metas = {};
        }
        metas.members = next;
        await prisma_1.prisma.instance.update({ where: { id }, data: { metas: JSON.stringify(metas) } });
        app_log_1.appLog.info('instance', `创建者 ${username} 将 ${targetName} 移出实例「${inst.name}」`, '', '');
        return {};
    }
};
exports.InstancesService = InstancesService;
exports.InstancesService = InstancesService = __decorate([
    (0, common_1.Injectable)()
], InstancesService);
