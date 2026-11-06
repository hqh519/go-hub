"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdapterError = void 0;
class AdapterError extends Error {
    channelType;
    constructor(message, channelType) {
        super(`[${channelType}] ${message}`);
        this.channelType = channelType;
    }
}
exports.AdapterError = AdapterError;
