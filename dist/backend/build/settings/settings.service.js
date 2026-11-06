"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = void 0;
const request_origin_1 = require("../common/request-origin");
const common_1 = require("@nestjs/common");
const prisma_1 = require("../common/prisma");
let SettingsService = class SettingsService {
    cache = new Map();
    async get(key, fallback = '') {
        if (this.cache.has(key))
            return this.cache.get(key);
        const row = await prisma_1.prisma.setting.findUnique({ where: { key } });
        const v = row?.value ?? fallback;
        this.cache.set(key, v);
        return v;
    }
    async getJson(key, fallback) {
        const raw = await this.get(key, '');
        if (!raw)
            return fallback;
        try {
            return { ...fallback, ...JSON.parse(raw) };
        }
        catch {
            return fallback;
        }
    }
    async set(key, value) {
        await prisma_1.prisma.setting.upsert({
            where: { key },
            update: { value },
            create: { key, value },
        });
        this.cache.set(key, value);
    }
    async setJson(key, obj) {
        await this.set(key, JSON.stringify(obj));
    }
    async getServerDomain() {
        const v = (await this.get('serverDomain', '')).replace(/\/+$/, '');
        (0, request_origin_1.primeSignOrigin)(v);
        return v;
    }
    async getCustomDomain() {
        return (await this.get('customDomain', '')).trim().replace(/\/+$/, '');
    }
    async getLinkPrefix(fallbackOrigin) {
        const custom = await this.getCustomDomain();
        if (custom)
            return `${custom}/file/`;
        const prefix = (await this.get('urlPrefix', '')).trim();
        if (prefix)
            return prefix.endsWith('/') ? prefix : `${prefix}/`;
        return `${fallbackOrigin.replace(/\/+$/, '')}/file/`;
    }
    async getAccessChannel() {
        const v = await this.get('accessChannel', 'main');
        return v === 'backup' ? 'backup' : 'main';
    }
    async getLinkMode() {
        const v = await this.get('linkMode', 'proxy');
        return v === 'redirect' ? 'redirect' : 'proxy';
    }
};
exports.SettingsService = SettingsService;
exports.SettingsService = SettingsService = __decorate([
    (0, common_1.Injectable)()
], SettingsService);
