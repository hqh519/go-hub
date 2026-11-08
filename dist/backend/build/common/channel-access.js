"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTH_ALL = void 0;
exports.parseAuthorizedUsers = parseAuthorizedUsers;
exports.channelAuthAll = channelAuthAll;
exports.channelVisibleTo = channelVisibleTo;
exports.AUTH_ALL = '*';
function parseAuthorizedUsers(raw) {
    try {
        const arr = JSON.parse(raw || '[]');
        if (!Array.isArray(arr))
            return [];
        return arr.map((x) => String(x || '').trim()).filter(Boolean);
    }
    catch {
        return [];
    }
}
function channelAuthAll(raw) {
    return parseAuthorizedUsers(raw).includes(exports.AUTH_ALL);
}
function channelVisibleTo(raw, type, username, admin) {
    if (admin)
        return true;
    if (!username)
        return false;
    const list = parseAuthorizedUsers(raw);
    if (list.includes(exports.AUTH_ALL))
        return true;
    return list.includes(username);
}
