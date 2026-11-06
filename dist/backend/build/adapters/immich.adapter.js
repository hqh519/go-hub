"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImmichAdapter = void 0;
const crypto_1 = require("crypto");
const adapter_interface_1 = require("./adapter.interface");
const endpoint_1 = require("../common/endpoint");
const asset_url_1 = require("../common/asset-url");
class ImmichAdapter {
    headers(channel) {
        return { 'x-api-key': channel.config.apiKey, Accept: 'application/json' };
    }
    api(channel, path) {
        return (0, endpoint_1.ensureProtocol)(channel.config.serverUrl || '').replace(/\/+$/, '') + path;
    }
    linkBase(channel) {
        const base = (0, endpoint_1.ensureProtocol)(channel.config.publicDomain || channel.config.domain || '').replace(/\/+$/, '');
        return base;
    }
    internalLinkBase(channel) {
        const base = (0, endpoint_1.ensureProtocol)(channel.config.internalDomain || channel.config.publicDomain || channel.config.domain || channel.config.serverUrl || '').replace(/\/+$/, '');
        return base;
    }
    pathsOf(assetId, shareKey) {
        return {
            objectPath: `api/assets/${assetId}/original`,
            urlQuery: shareKey ? `key=${shareKey}` : '',
        };
    }
    async upload(file, key, channel) {
        const cfg = channel.config;
        if (!cfg.serverUrl || !cfg.apiKey)
            throw new adapter_interface_1.AdapterError('缺少 serverUrl / apiKey 配置', channel.type);
        try {
            const checksum = (0, crypto_1.createHash)('sha1').update(file.buffer).digest('hex');
            const checkResp = await fetch(this.api(channel, '/api/assets/bulk-upload-check'), {
                method: 'POST',
                headers: { ...this.headers(channel), 'Content-Type': 'application/json' },
                body: JSON.stringify({ assets: [{ checksum, id: key }] }),
            });
            if (checkResp.ok) {
                const checkJson = (await checkResp.json());
                const hit = checkJson.results?.find((r) => r.action === 'reject' && (r.assetId || r.id));
                const dupId = hit?.assetId || hit?.id;
                if (dupId)
                    return this.share(dupId, channel);
            }
            const now = new Date().toISOString();
            const form = new FormData();
            form.append('assetData', new Blob([new Uint8Array(file.buffer)], { type: file.mime }), file.originalName);
            form.append('deviceAssetId', `${key}-${Date.now()}`);
            form.append('deviceId', 'GoHub');
            form.append('fileCreatedAt', now);
            form.append('fileModifiedAt', now);
            form.append('isFavorite', 'false');
            const upResp = await fetch(this.api(channel, '/api/assets'), {
                method: 'POST',
                headers: this.headers(channel),
                body: form,
            });
            if (!upResp.ok) {
                const detail = await upResp.text().catch(() => '');
                throw new adapter_interface_1.AdapterError(`上传失败: HTTP ${upResp.status} ${detail.slice(0, 200)}`, channel.type);
            }
            const upJson = (await upResp.json());
            const assetId = Array.isArray(upJson) ? upJson[0]?.id : upJson.id;
            if (!assetId)
                throw new adapter_interface_1.AdapterError('响应中未找到 assetId', channel.type);
            return this.share(assetId, channel);
        }
        catch (err) {
            if (err instanceof adapter_interface_1.AdapterError)
                throw err;
            throw new adapter_interface_1.AdapterError(`请求失败: ${err.message}`, channel.type);
        }
    }
    async share(assetId, channel) {
        const cfg = channel.config;
        if (cfg.albumId) {
            const albumResp = await fetch(this.api(channel, `/api/albums/${encodeURIComponent(cfg.albumId)}/assets`), {
                method: 'PUT',
                headers: { ...this.headers(channel), 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [assetId] }),
            }).catch(() => undefined);
            if (albumResp && !albumResp.ok) {
                console.warn(`[immich] 加入相册失败 HTTP ${albumResp.status}（不阻断上传）`);
            }
        }
        const fixedKey = (cfg.shareLinkId || '').trim();
        if (fixedKey) {
            return {
                remoteKey: `${assetId}|${fixedKey}`,
                ...this.pathsOf(assetId, fixedKey),
                metas: { assetId, shareKey: fixedKey, albumId: cfg.albumId || '' },
            };
        }
        const shareResp = await fetch(this.api(channel, '/api/shared-links'), {
            method: 'POST',
            headers: { ...this.headers(channel), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'INDIVIDUAL',
                assetIds: [assetId],
                allowDownload: true,
                allowUpload: false,
                showMetadata: true,
            }),
        });
        if (!shareResp.ok) {
            const detail = await shareResp.text().catch(() => '');
            throw new adapter_interface_1.AdapterError(`创建分享链接失败: HTTP ${shareResp.status} ${detail.slice(0, 200)}（请确认 Immich 版本支持 /api/shared-links）`, channel.type);
        }
        const shareJson = (await shareResp.json());
        const shareKey = shareJson.key || shareJson.slug;
        if (!shareKey)
            throw new adapter_interface_1.AdapterError('分享响应中未找到 key/slug', channel.type);
        return {
            remoteKey: `${assetId}|${shareKey}`,
            ...this.pathsOf(assetId, shareKey),
            metas: { assetId, shareKey, albumId: cfg.albumId || '' },
        };
    }
    async delete(copy, channel) {
        const assetId = copy.remoteKey.split('|')[0];
        const resp = await fetch(this.api(channel, '/api/assets'), {
            method: 'DELETE',
            headers: { ...this.headers(channel), 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: true, ids: [assetId] }),
        });
        if (!resp.ok)
            throw new adapter_interface_1.AdapterError(`删除失败: HTTP ${resp.status}`, channel.type);
    }
    buildDirectUrl(copy, channel, preferInternal) {
        const base = preferInternal ? this.internalLinkBase(channel) : this.linkBase(channel);
        if (!base)
            return null;
        if (copy.objectPath) {
            return (0, asset_url_1.buildAssetUrl)({ base, objectPath: copy.objectPath, urlQuery: copy.urlQuery });
        }
        if (copy.remoteKey.includes('/')) {
            return `${base.replace(/\/+$/, '')}/${copy.remoteKey.replace(/^\/+/, '')}`;
        }
        const [assetId, shareKey] = copy.remoteKey.split('|');
        if (!assetId)
            return null;
        if (!shareKey)
            return `${base}/api/assets/${assetId}/original`;
        return `${base}/api/assets/${assetId}/original?key=${shareKey}`;
    }
}
exports.ImmichAdapter = ImmichAdapter;
