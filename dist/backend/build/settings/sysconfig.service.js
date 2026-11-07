"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SysConfigService = void 0;
const common_1 = require("@nestjs/common");
const settings_service_1 = require("./settings.service");
const page_config_1 = require("./page-config");
const secret_1 = require("../common/secret");
const crypto_service_1 = require("../common/crypto.service");
function deepMerge(base, patch) {
    if (patch === undefined || patch === null)
        return base;
    if (Array.isArray(base) || Array.isArray(patch))
        return (patch ?? base);
    if (typeof base !== 'object' || typeof patch !== 'object')
        return (patch ?? base);
    const out = { ...base };
    for (const [k, v] of Object.entries(patch)) {
        out[k] = k in base ? deepMerge(base[k], v) : v;
    }
    return out;
}
function safeJson(raw, fallback) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
let SysConfigService = class SysConfigService {
    settings;
    constructor(settings) {
        this.settings = settings;
    }
    key(section) {
        return `sysConfig:${section}`;
    }
    defaults(section) {
        switch (section) {
            case 'page':
                return JSON.parse(JSON.stringify(page_config_1.PAGE_CONFIG_DEFAULTS));
            case 'security':
                return {
                    auth: { user: { authCode: '' }, admin: { adminUsername: '', adminPassword: '' } },
                    upload: {
                        moderate: {
                            enabled: false,
                            channel: 'moderatecontent.com',
                            moderateContentApiKey: '',
                            nsfwApiPath: '',
                        },
                        ipQuery: {
                            enabled: false,
                            channel: 'customApi',
                            customApi: { url: '', params: [{ key: 'ip', value: '{ip}' }], responseFields: [] },
                        },
                    },
                    access: {
                        allowedDomains: '',
                        whiteListMode: false,
                        imageTransformEnabled: false,
                        imageTransformAllowedSizes: '',
                        sessionSecure: false,
                        userSessionMaxAge: 14,
                        adminSessionMaxAge: 14,
                        fallbackEnabled: false,
                        fallbackType: 'image',
                        fallbackUrl: '',
                    },
                    mail: {
                        enabled: false,
                        host: '',
                        port: 465,
                        secure: true,
                        user: '',
                        pass: '',
                        fromName: 'GoHub',
                        fromAddress: '',
                        replyTo: '',
                    },
                };
            case 'upload':
                return {
                    cos: this.emptyChannelType(),
                    minio: this.emptyChannelType(),
                    r2: this.emptyChannelType(),
                    s3: this.emptyChannelType(),
                    aliyun: this.emptyChannelType(),
                    easyimages: this.emptyChannelType(),
                    lsky: this.emptyChannelType(),
                    webdav: this.emptyChannelType(),
                    immich: this.emptyChannelType(),
                    custom: this.emptyChannelType(),
                };
            case 'others':
                return {
                    telemetry: { enabled: false, fixed: false },
                    randomImageAPI: { enabled: true, allowedDir: '', fixed: false },
                    publicBrowse: { enabled: true, allowedDir: '', fixed: false },
                    webdav: { enabled: false, rootPath: '', channelId: '', readonly: false },
                    autoTag: {
                        enabled: true,
                        placeholders: '{mime},{ext},{channelName},{uploadSource},{y}',
                        extract: '',
                        startChars: '#',
                        stopChars: '["!","！",",","，",".","。","-","—","_","、",";","；",":","：","?","？","(",")","（","）","[","]","【","】","{","}","<",">","《","》","|","/","\\\\"]',
                        maxLen: 14,
                    },
                };
            case 'ai':
                return { canStoreCredentials: false, defaults: { tagPrompt: '' }, models: [] };
            default:
                return {};
        }
    }
    emptyChannelType() {
        return { channels: [], loadBalance: { enabled: false, channels: [] } };
    }
    async get(section) {
        const raw = await this.settings.get(this.key(section), '');
        const stored = raw ? safeJson(raw, {}) : {};
        if (section === 'page')
            return this.mergePage(stored);
        if (section === 'security')
            return this.mergeSecurity(stored);
        return deepMerge(this.defaults(section), stored);
    }
    async save(section, body) {
        if (section === 'page') {
            const prevRaw = await this.settings.get(this.key(section), '');
            const prev = prevRaw ? safeJson(prevRaw, {}) : {};
            const next = this.processAnnouncement(body || {}, prev);
            await this.settings.set(this.key(section), JSON.stringify(next));
            return next;
        }
        if (section === 'security') {
            const prevRaw = await this.settings.get(this.key(section), '');
            const prev = prevRaw ? safeJson(prevRaw, {}) : {};
            const { next, adminChanged } = this.mergeSecurityForSave(body || {}, prev);
            await this.settings.set(this.key(section), JSON.stringify(next));
            return { message: 'security settings saved', adminPasswordChanged: adminChanged };
        }
        const prevRaw = await this.settings.get(this.key(section), '');
        const prev = prevRaw ? safeJson(prevRaw, {}) : {};
        const next = deepMerge(prev, body || {});
        await this.settings.set(this.key(section), JSON.stringify(next));
        return next;
    }
    async readSecurityRaw() {
        const raw = await this.settings.get(this.key('security'), '');
        return raw ? safeJson(raw, {}) : {};
    }
    async writeSecurityRaw(next) {
        await this.settings.set(this.key('security'), JSON.stringify(next));
    }
    mergePage(stored) {
        const base = JSON.parse(JSON.stringify(page_config_1.PAGE_CONFIG_DEFAULTS));
        const storedItems = Array.isArray(stored?.config) ? stored.config : [];
        for (const item of storedItems) {
            const idx = base.config.findIndex((x) => x.id === item.id);
            if (idx !== -1)
                base.config[idx].value = item.value;
        }
        if (Number.isFinite(Number(stored?.announcementRefreshAt))) {
            base.announcementRefreshAt = Number(stored.announcementRefreshAt);
        }
        return base;
    }
    processAnnouncement(settings, previousSettings) {
        const pick = (s) => Array.isArray(s?.config) ? s.config.find((i) => i?.id === 'announcement')?.value ?? '' : '';
        const shouldRefresh = pick(settings) !== pick(previousSettings) || settings.refreshAnnouncement === true;
        delete settings.refreshAnnouncement;
        if (shouldRefresh)
            settings.announcementRefreshAt = Date.now();
        else if (previousSettings.announcementRefreshAt)
            settings.announcementRefreshAt = previousSettings.announcementRefreshAt;
        else
            delete settings.announcementRefreshAt;
        return settings;
    }
    mergeSecurity(stored) {
        const merged = deepMerge(this.defaults('security'), stored);
        if (merged.auth?.user?.authCode) {
            merged.auth.user._hasPassword = true;
            merged.auth.user.authCode = '';
        }
        if (merged.auth?.admin?.adminPassword) {
            merged.auth.admin._hasPassword = true;
            merged.auth.admin.adminPassword = '';
        }
        if (merged.mail?.pass) {
            merged.mail._hasPassword = true;
            merged.mail.pass = '';
        }
        return merged;
    }
    mergeSecurityForSave(body, prev) {
        const base = deepMerge(this.defaults('security'), prev);
        const out = { ...base };
        let adminChanged = false;
        if (body.upload)
            out.upload = deepMerge(base.upload, body.upload);
        if (body.access) {
            out.access = deepMerge(base.access, body.access);
            out.access.sessionSecure = out.access.sessionSecure === true;
            out.access.imageTransformEnabled = out.access.imageTransformEnabled === true;
            out.access.fallbackEnabled = out.access.fallbackEnabled === true;
            out.access.fallbackType = out.access.fallbackType === 'redirect' ? 'redirect' : 'image';
            out.access.fallbackUrl = String(out.access.fallbackUrl || '').trim();
        }
        if (body.mail) {
            const prevMail = base.mail || {};
            const m = { ...prevMail, ...body.mail };
            if (body.mail._clear)
                m.pass = '';
            else if (body.mail.pass)
                m.pass = `enc:${crypto_service_1.CryptoService.encrypt(String(body.mail.pass))}`;
            else
                m.pass = prevMail.pass || '';
            delete m._clear;
            delete m._hasPassword;
            m.port = Number(m.port) || 465;
            m.secure = m.secure !== false;
            m.enabled = m.enabled === true;
            for (const k of ['host', 'user', 'fromName', 'fromAddress', 'replyTo']) {
                m[k] = String(m[k] ?? '').trim();
            }
            out.mail = m;
        }
        if (body.auth) {
            if (body.auth.user) {
                const u = { ...body.auth.user };
                if (u._clear)
                    u.authCode = '';
                else if (u.authCode)
                    u.authCode = this.toStoredSecret(u.authCode);
                else
                    u.authCode = base.auth?.user?.authCode || '';
                delete u._clear;
                out.auth = { ...base.auth, user: u };
            }
            if (body.auth.admin) {
                const prevUser = String(base.auth?.admin?.adminUsername || '');
                const prevPass = String(base.auth?.admin?.adminPassword || '');
                const a = { ...body.auth.admin };
                if (a._clear) {
                    a.adminPassword = '';
                    a.adminUsername = '';
                }
                else if (a.adminPassword) {
                    a.adminPassword = this.toStoredSecret(a.adminPassword);
                }
                else {
                    a.adminPassword = prevPass;
                }
                delete a._clear;
                out.auth = { ...(out.auth || base.auth), admin: a };
                adminChanged =
                    String(out.auth.admin.adminPassword || '') !== prevPass ||
                        String(out.auth.admin.adminUsername || '') !== prevUser;
            }
        }
        delete out.auth?.user?._hasPassword;
        delete out.auth?.admin?._hasPassword;
        return { next: out, adminChanged };
    }
    toStoredSecret(plain) {
        const v = String(plain ?? '');
        return (0, secret_1.isHashedSecret)(v) ? v : (0, secret_1.hashSecret)(v);
    }
};
exports.SysConfigService = SysConfigService;
exports.SysConfigService = SysConfigService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [settings_service_1.SettingsService])
], SysConfigService);
