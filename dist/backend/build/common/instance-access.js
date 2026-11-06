"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userInInstance = userInInstance;
const prisma_1 = require("./prisma");
async function userInInstance(user, instanceId) {
    const id = String(instanceId || '');
    if (!id)
        return true;
    const me = String(user || '');
    if (!me)
        return false;
    const inst = await prisma_1.prisma.instance.findUnique({ where: { id } });
    if (!inst)
        return false;
    if (inst.ownerName === me)
        return true;
    try {
        const members = JSON.parse(inst.metas || '{}')?.members;
        return Array.isArray(members) && members.map((m) => String(m)).includes(me);
    }
    catch {
        return false;
    }
}
