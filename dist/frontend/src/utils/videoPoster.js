/**
 * 视频首帧缩略图（v1.1.2）
 * ----------------------------------------------------------------------------
 * 为什么放在前端做：
 *   · 后端目前只对图片用 sharp 出缩略图，视频抽帧要额外接 ffmpeg 到文件下发链路，
 *     那条链路是图床的核心出口，动它风险远大于收益（需求也明确「不要乱改图床」）；
 *   · `/file/<name>` 与页面同源，<video> + canvas 取帧不会有跨域污染；
 *   · 结果按 URL 缓存，同一张视频缩略图在整个会话里只算一次。
 *
 * 代价：每个视频需要下载一小段头部数据才能出帧，所以：
 *   · 并发限 2，只有「进入视口附近」的格子才会调用（调用方自己控制）；
 *   · 抽帧失败（编码不支持 / 网络中断）返回空串，调用方退回图标卡，不显示破图。
 */

const cache = new Map(); // url -> dataURL（'' = 已知失败）
const queue = [];
let running = 0;

const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 9000;
/** 取第几秒的帧：0 秒常是黑场，取 0.1s 之后的画面更可用 */
const SEEK_SECONDS = 0.1;

function pump() {
    while (running < MAX_CONCURRENT && queue.length) {
        const job = queue.shift();
        running += 1;
        grab(job.url)
            .then((dataUrl) => {
                cache.set(job.url, dataUrl || '');
                job.resolve(dataUrl || '');
            })
            .catch(() => {
                cache.set(job.url, '');
                job.resolve('');
            })
            .finally(() => {
                running -= 1;
                pump();
            });
    }
}

function grab(url) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        let done = false;
        const finish = (fn, arg) => {
            if (done) return;
            done = true;
            window.clearTimeout(timer);
            video.removeAttribute('src');
            try { video.load(); } catch (e) { /* 忽略 */ }
            fn(arg);
        };
        const timer = window.setTimeout(() => finish(resolve, ''), TIMEOUT_MS);

        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        // 部分浏览器需要这个属性才允许在后台解码首帧
        video.setAttribute('webkit-playsinline', 'true');

        const draw = () => {
            try {
                const w = video.videoWidth || 0;
                const h = video.videoHeight || 0;
                if (!w || !h) return finish(resolve, '');
                const canvas = document.createElement('canvas');
                // 缩略图不需要原始分辨率：最长边收在 480，避免大图占内存
                const scale = Math.min(1, 480 / Math.max(w, h));
                canvas.width = Math.max(1, Math.round(w * scale));
                canvas.height = Math.max(1, Math.round(h * scale));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                finish(resolve, canvas.toDataURL('image/jpeg', 0.72));
            } catch (e) {
                finish(reject, e);
            }
        };

        video.addEventListener('loadedmetadata', () => {
            const d = Number(video.duration);
            // 短视频直接取开头，长视频取 0.1s（很多编码首帧是全黑）
            video.currentTime = Number.isFinite(d) && d > SEEK_SECONDS ? SEEK_SECONDS : 0;
        });
        video.addEventListener('seeked', draw);
        // 有些格式 seek 不触发，canplay 兜底
        video.addEventListener('loadeddata', () => {
            if (done) return;
            if (!video.currentTime) draw();
        });
        video.addEventListener('error', () => finish(resolve, ''));
        video.src = url;
    });
}

/**
 * 取视频首帧（dataURL）。同 URL 只算一次。
 * @returns {Promise<string>} 失败返回空串
 */
export function videoPoster(url) {
    const key = String(url || '');
    if (!key) return Promise.resolve('');
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    return new Promise((resolve) => {
        queue.push({ url: key, resolve });
        pump();
    });
}

/** 是否已经有缓存（用于避免重复排队） */
export function hasPoster(url) {
    return cache.has(String(url || ''));
}
