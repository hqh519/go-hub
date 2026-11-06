"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAuthorizedUsers = parseAuthorizedUsers;
exports.channelVisibleTo = channelVisibleTo;
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
function channelVisibleTo(raw, type, username, admin) {
    if (admin)
        return true;
    if (!username)
        return false;
    return parseAuthorizedUsers(raw).includes(username);
}
