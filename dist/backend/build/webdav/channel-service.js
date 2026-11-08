"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeAccessKey = makeAccessKey;
exports.listChannelsOf = listChannelsOf;
exports.createChannel = createChannel;
exports.updateChannel = updateChannel;
exports.rotateChannelKey = rotateChannelKey;
exports.deleteChannel = deleteChannel;
const crypto_1 = require("crypto");
const prisma_1 = require("../common/prisma");
const webdav_storage_1 = require("./webdav.storage");
function makeAccessKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 16; i += 1)
        out += chars[(0, crypto_1.randomInt)(0, chars.length)];
    return out;
}
async function listChannelsOf(username) {
    return prisma_1.prisma.webDavChannel.findMany({ where: { username }, orderBy: { createdAt: 'asc' } });
}
async function createChannel(user, body) {
    if (user.role !== 'user') {
        return { success: false, message: '管理员账户禁止使用 WebDAV，请用普通账户创建' };
    }
    if (!user.webdavEnabled) {
        return { success: false, message: '该账户尚未开启「启用 WebDAV 功能」' };
    }
    const name = String(body.name || '').trim();
    const relPath = (0, webdav_storage_1.cleanChannelPath)(String(body.path || ''));
    if (!name)
        return { success: false, message: '请填写 WebDAV 名称' };
    if (!relPath)
        return { success: false, message: '请填写存储路径' };
    const wanted = String(body.accessKey || '').trim();
    let accessKey = makeAccessKey();
    if (wanted) {
        if (!/^[A-Za-z0-9]{8,64}$/.test(wanted)) {
            return { success: false, message: '访问密钥只能是 8~64 位大小写字母或数字' };
        }
        const dupKey = await prisma_1.prisma.webDavChannel.findFirst({ where: { accessKey: wanted } });
        if (dupKey)
            return { success: false, message: '该访问密钥已被占用，请点「重新生成」换一个' };
        accessKey = wanted;
    }
    const count = await prisma_1.prisma.webDavChannel.count({ where: { username: user.username } });
    if (count >= Math.max(1, user.webdavMax || 2)) {
        return { success: false, message: `最多只能创建 ${user.webdavMax || 2} 个 WebDAV 渠道` };
    }
    const dupName = await prisma_1.prisma.webDavChannel.findFirst({ where: { username: user.username, name } });
    if (dupName)
        return { success: false, message: `名称「${name}」已被该账户的另一个 WebDAV 使用` };
    const firstSeg = relPath.split('/')[0];
    const sameUser = await prisma_1.prisma.webDavChannel.findMany({ where: { username: user.username } });
    const conflict = sameUser.find((c) => String(c.path || '').split('/')[0] === firstSeg);
    if (conflict) {
        return { success: false, message: `一级目录「${firstSeg}」已被 WebDAV「${conflict.name}」占用` };
    }
    const ch = await prisma_1.prisma.webDavChannel.create({
        data: {
            username: user.username,
            name,
            path: relPath,
            accessKey,
            note: String(body.note || ''),
        },
    });
    return { success: true, data: ch };
}
async function updateChannel(channelId, body) {
    const ch = await prisma_1.prisma.webDavChannel.findUnique({ where: { id: channelId } });
    if (!ch)
        return { success: false, message: 'WebDAV 渠道不存在' };
    const data = {};
    if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name)
            return { success: false, message: '名称不能为空' };
        if (name !== ch.name) {
            const dup = await prisma_1.prisma.webDavChannel.findFirst({
                where: { username: ch.username, name, NOT: { id: ch.id } },
            });
            if (dup)
                return { success: false, message: `名称「${name}」已被占用` };
        }
        data.name = name;
    }
    if (body.note !== undefined)
        data.note = String(body.note || '');
    const next = await prisma_1.prisma.webDavChannel.update({ where: { id: ch.id }, data });
    return { success: true, data: next };
}
async function rotateChannelKey(channelId) {
    const ch = await prisma_1.prisma.webDavChannel.findUnique({ where: { id: channelId } });
    if (!ch)
        return { success: false, message: 'WebDAV 渠道不存在' };
    const next = await prisma_1.prisma.webDavChannel.update({
        where: { id: ch.id },
        data: { accessKey: makeAccessKey() },
    });
    return { success: true, data: { id: next.id, accessKey: next.accessKey } };
}
async function deleteChannel(channelId) {
    const ch = await prisma_1.prisma.webDavChannel.findUnique({ where: { id: channelId } });
    if (!ch)
        return { success: false, message: 'WebDAV 渠道不存在' };
    await prisma_1.prisma.webDavChannel.delete({ where: { id: ch.id } });
    return { success: true, data: { id: ch.id } };
}
