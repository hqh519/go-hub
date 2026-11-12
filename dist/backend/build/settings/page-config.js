"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAGE_CONFIG_DEFAULTS = void 0;
exports.PAGE_CONFIG_DEFAULTS = {
    "config": [
        {
            "id": "siteTitle",
            "label": "网站标题",
            "label_en": "Site Title",
            "placeholder": "GoHub {pagename}",
            "tooltip": "支持占位符：<br/>{host} = 当前访问域名（不含 http:// 与 / 后的路径）<br/>{user} = 当前登录用户名（仅登录后生效）<br/>{pagename} = 当前页面名称（首页 / 图床管理 / 挂载管理 / 笔记管理 / 用户管理 / 系统管理 / 历史记录，仅登录后生效）<br/>留空默认：GoHub {pagename}<br/>例：{pagename} · {host}",
            "tooltip_en": "Placeholders: <br/>{host} = current domain (no protocol, no path) <br/>{user} = signed-in username (signed-in only) <br/>{pagename} = current page name (Home / Dashboard / Local files / Notes / Users / Settings / History; signed-in only) <br/>Empty value defaults to: GoHub {pagename} <br/>e.g. {pagename} · {host}",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "siteIcon",
            "label": "网站图标",
            "label_en": "Site Icon",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "defaultLanguage",
            "label": "默认语言",
            "label_en": "Default Language",
            "type": "select",
            "options": [
                {
                    "label": "简体中文",
                    "value": "zh-CN",
                    "label_en": "简体中文"
                },
                {
                    "label": "English",
                    "value": "en",
                    "label_en": "English"
                }
            ],
            "default": "zh-CN",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "ownerName",
            "label": "网站名称",
            "label_en": "Site Name",
            "placeholder": "Sanyue ImgHub",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "logoUrl",
            "label": "网站Logo",
            "label_en": "Site Logo",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "wallpaperEnabled",
            "label": "启用背景图",
            "label_en": "Enable Background Image",
            "type": "boolean",
            "default": true,
            "tooltip": "控制所有页面的背景图开关，关闭后将使用纯色背景",
            "tooltip_en": "Toggle background images across all pages. When off, a solid color background will be used",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "bkOpacity",
            "label": "背景图透明度",
            "label_en": "Background Opacity",
            "placeholder": "1",
            "tooltip": "0-1 之间的小数",
            "tooltip_en": "Decimal between 0 and 1",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "themeAutoRange",
            "label": "白天/夜间切换时间",
            "label_en": "Day / Night Switch Time",
            "placeholder": "[\"07:00\":\"19:00\"]",
            "placeholder_en": "[\"07:00\":\"19:00\"]",
            "tooltip": "主题选择「自动」时按此时间切换：区间内为白天、区间外为夜间。<br/>留空 = 默认 07:00—19:00，表示 07:00 切白天、19:00 切夜间。<br/>也支持 07:00-19:00 或 07:00,19:00 的写法。",
            "tooltip_en": "Used when the theme is set to Auto: inside the range is day mode, outside is night mode.<br/>Leave empty for the default 07:00—19:00 (day at 07:00, night at 19:00).<br/>07:00-19:00 and 07:00,19:00 are also accepted.",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "urlPrefix",
            "label": "默认URL前缀",
            "label_en": "Default URL Prefix",
            "tooltip": "自定义URL前缀，如：https://img.a.com/file/，留空则使用当前域名 <br/> 设置后将应用于客户端和管理端 <br/> 该选项用于CDN加速等场景，请确保自定义前缀可访问",
            "tooltip_en": "Custom URL prefix, e.g. https://img.a.com/file/. Leave empty to use current domain <br/> Applies to both client and admin <br/> This option is intended for scenarios such as CDN acceleration. Make sure the custom prefix is accessible",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "announcement",
            "label": "公告",
            "label_en": "Announcement",
            "type": "textarea",
            "tooltip": "支持HTML标签",
            "tooltip_en": "Supports HTML tags",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "showDirectorySuggestions",
            "label": "上传目录选项",
            "label_en": "Upload Directory Options",
            "type": "boolean",
            "default": true,
            "tooltip": "开启后前台上传页右上角显示目录输入框、右下角快捷栏显示「目录选择」。关闭后两处一并隐藏，上传将使用「默认上传目录」（留空则按年份/月份自动分类）",
            "tooltip_en": "When on, the upload page shows the folder input at the top right and the Directory button in the quick toolbar. When off both are hidden and uploads use Default Upload Directory",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultUploadFolder",
            "label": "默认上传目录",
            "label_en": "Default Upload Directory",
            "placeholder": "留空则按「年份/月份」自动分类，如 2026/10",
            "placeholder_en": "Leave empty to auto-classify by year/month, e.g. 2026/10",
            "tooltip": "上传时未指定目录则使用这里的目录；留空则按「年份/月份」自动创建分类（每次上传实时计算）",
            "tooltip_en": "Used when no directory is specified on upload. Leave empty to auto-create by year/month",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultUploadNameType",
            "label": "默认命名方式",
            "label_en": "Default Naming",
            "type": "select",
            "options": [
                {
                    "label": "默认",
                    "value": "default",
                    "label_en": "Default"
                },
                {
                    "label": "仅前缀",
                    "value": "index",
                    "label_en": "Prefix Only"
                },
                {
                    "label": "仅原名",
                    "value": "origin",
                    "label_en": "Original Name"
                },
                {
                    "label": "短链接",
                    "value": "short",
                    "label_en": "Short Link"
                }
            ],
            "placeholder": "default",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultUrlForm",
            "label": "默认外链格式",
            "label_en": "Default URL Format",
            "type": "select",
            "options": [
                {
                    "label": "URL",
                    "value": "url",
                    "label_en": "URL"
                },
                {
                    "label": "Markdown",
                    "value": "md",
                    "label_en": "Markdown"
                },
                {
                    "label": "HTML",
                    "value": "html",
                    "label_en": "HTML"
                },
                {
                    "label": "BBCode",
                    "value": "ubb",
                    "label_en": "BBCode"
                }
            ],
            "default": "url",
            "tooltip": "上传成功后默认复制/展示的链接格式",
            "tooltip_en": "Default link format shown/copied after upload",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultUploadConcurrency",
            "label": "前端并发数",
            "label_en": "Frontend Concurrency",
            "placeholder": "3",
            "tooltip": "留空默认 3。浏览器同时上传的文件数量：调大能更快传完一批文件，但会同时占用更多带宽与连接（图床/网络较弱时反而更容易超时）；调小排队更稳。建议 2~6",
            "tooltip_en": "Defaults to 3 when empty. Number of files the browser uploads at the same time. Higher finishes a batch faster but uses more bandwidth and connections; lower is gentler on weak networks. 2-6 recommended",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "mediaResourceGuardEnabled",
            "label": "影音压缩/转码控制",
            "label_en": "Media Compress/Transcode Guard",
            "type": "boolean",
            "default": true,
            "tooltip": "开启后：视频/音频开始压缩或转码前先检测服务器负载与可用内存，任一项达到下方阈值即放弃处理（文件照常上传、保留原文件，原因写入系统日志）。图片压缩不受本开关影响；关闭后不再做资源检测，始终尝试压缩/转码",
            "tooltip_en": "When on: before compressing or transcoding a video/audio file the server checks load and free memory; if either reaches the thresholds below the job is skipped (the file uploads normally and the original is kept, the reason is logged). Image compression is not affected. When off no resource check is made",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "mediaResourceLoadLimit",
            "label": "load1负载值",
            "label_en": "load1 Load Factor",
            "placeholder": "1.5",
            "tooltip": "仅在「影音压缩/转码控制」开启时生效。最近 1 分钟平均负载（load1）超过「该值 × CPU 核数」时放弃视频/音频的压缩与转码，例如 4 核填 1.5 即 load1 > 6 时放弃。留空默认 1.5；填 0 表示不按负载检测",
            "tooltip_en": "Effective only when the guard is on. Compression/transcoding is skipped when the 1-minute load average exceeds this factor × CPU cores (e.g. 4 cores × 1.5 = 6). Defaults to 1.5 when empty; 0 disables the load check",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "mediaResourceRamLimit",
            "label": "RAM安全值(MB)",
            "label_en": "RAM Floor (MB)",
            "placeholder": "256",
            "tooltip": "仅在「影音压缩/转码控制」开启时生效。系统可用内存低于该值（MB）时放弃视频/音频的压缩与转码。留空默认 256；填 0 表示不按内存检测。Docker 部署时读到的是宿主机（WSL2 虚拟机）的可用内存",
            "tooltip_en": "Effective only when the guard is on. Compression/transcoding is skipped when free memory drops below this value (MB). Defaults to 256 when empty; 0 disables the memory check. In Docker the value reflects the host machine (WSL2 VM)",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultAutoRetry",
            "label": "失败自动重试",
            "label_en": "Auto Retry on Failure",
            "type": "boolean",
            "default": true,
            "tooltip": "总开关：开启后上传失败会自动重试（前台上传 / 链接转存 / WebDAV / API 全部生效），同时决定前台上传设置里「其他 → 失败自动重试」开关是否显示；关闭后所有入口都不再自动重试，失败项停在列表里等手动处理",
            "tooltip_en": "Master switch: failed uploads are retried automatically (web upload, link transfer, WebDAV and API all covered). It also controls whether the Auto retry switch appears in the upload settings dialog. When off nothing retries automatically",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultRetryTimes",
            "label": "失败重试次数",
            "label_en": "Retry Attempts",
            "placeholder": "3",
            "tooltip": "留空默认 3 次；填 0 表示不限制（会一直重试到成功或被手动停止）。达到该次数后停止重试，失败文件保留在列表里",
            "tooltip_en": "Defaults to 3 when empty; 0 means unlimited (retries until success or manual stop). Once the limit is reached retries stop and failed files stay in the list",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultAutoSwitch",
            "label": "自动切换存储库",
            "label_en": "Auto Switch Storage Pool",
            "type": "boolean",
            "default": true,
            "tooltip": "建立在「失败自动重试」之上：仅当失败自动重试开启时本项才显示并生效——上传失败重试期间自动切换到下一个可用渠道（优先「设为备用库」的渠道池，按轮转顺序尝试）。关闭后重试仍执行，但只在主渠道上重试，不切换渠道；失败自动重试关闭时本项隐藏且完全不执行",
            "tooltip_en": "Depends on Auto Retry on Failure: this item only shows and takes effect when auto retry is on — on failure, retries switch to the next available channel (backup pool first, rotated). When off, retries still run but stay on the main channel; hidden and disabled entirely when auto retry is off",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "videoTranscodeIncompatible",
            "label": "视频兼容转码",
            "label_en": "Video Compatibility Transcode",
            "type": "boolean",
            "default": true,
            "tooltip": "开启后：上传 H.265/HEVC、ProRes、MPEG-4 Part 2 等浏览器无法播放编码的视频时，服务器自动转码为 H.264（需 ffmpeg，已内置）。已经是 H.264/AV1/VP9 的视频不会转码，无额外开销。与压缩开关相互独立",
            "tooltip_en": "When on: videos encoded in H.265/HEVC, ProRes or MPEG-4 Part 2 (which browsers cannot play) are automatically transcoded to H.264 (requires ffmpeg, bundled). H.264/AV1/VP9 videos pass through untouched. Independent of the compression switch",
            "hint": "可在用户编辑中对用户单独开启",
            "hint_en": "Can be enabled per user in user edit",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "videoTranscodeMaxSeconds",
            "label": "视频转码上限时长(秒)",
            "label_en": "Transcode Time Limit (s)",
            "placeholder": "600",
            "tooltip": "留空默认 600 秒；填 0 表示不限制。预估耗时或实际执行耗时超过该值即放弃这个视频的转码，保留原文件与外链",
            "tooltip_en": "Defaults to 600s when empty; 0 means unlimited. If the estimated or actual time exceeds it, transcoding for that video is abandoned and the original file is kept",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "videoTranscodeConcurrency",
            "label": "同时处理任务数（转码）",
            "label_en": "Concurrent Transcode Jobs",
            "placeholder": "1",
            "tooltip": "留空默认 1；填 0 表示不限制。全局同时执行的转码任务路数，低配机器建议保持 1",
            "tooltip_en": "Defaults to 1 when empty; 0 means unlimited. Global concurrency for transcoding jobs; keep 1 on low-end hardware",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultConvertToWebp",
            "label": "WebP转换",
            "label_en": "WebP Conversion",
            "type": "boolean",
            "default": false,
            "tooltip": "总开关：开启后前台上传页列表顶栏显示「转换为WebP」按钮，可把图片转成 WebP 再上传（体积更小）。关闭后该按钮不加载，也不再默认转换",
            "tooltip_en": "Master switch: when on, the upload page shows a Convert to WebP button in the list toolbar (smaller files). When off the button is hidden and images are not converted",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "webpMode",
            "label": "WebP转换模式",
            "label_en": "WebP Conversion Mode",
            "type": "select",
            "options": [
                {
                    "label": "无损转换",
                    "value": "lossless",
                    "label_en": "Lossless"
                },
                {
                    "label": "有损转换",
                    "value": "lossy",
                    "label_en": "Lossy"
                }
            ],
            "default": "lossless",
            "tooltip": "仅在「WebP转换」开启时显示并生效：无损转换画质完全保留（体积略大），有损转换体积更小（画质略有损失）。前台上传设置里可单独选择「跟随全局 / 无损 / 有损」覆盖本设置",
            "tooltip_en": "Shown and effective only when WebP Conversion is on: lossless keeps full quality (slightly larger), lossy is smaller with minor quality loss. The upload page can override it with Follow global / Lossless / Lossy",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultCustomerCompress",
            "label": "文件压缩",
            "label_en": "File Compression",
            "type": "boolean",
            "default": true,
            "tooltip": "总开关：开启后前台上传页会显示压缩相关设置（顶栏按钮、上传设置里的开关/阈值/百分比/禁止格式），API Token / WebDAV 上传的文件同样走压缩；关闭后这些入口全部隐藏且不再压缩。支持图片（jpg/png/webp，png 保持透明）、视频与音频（需服务器安装 ffmpeg）；gif 等无法压缩的格式会自动跳过，压缩失败也会跳过直接上传",
            "tooltip_en": "When on: uploads from the web UI, API tokens and WebDAV are all compressed. Supports images (jpg/png/webp, PNG keeps transparency), video and audio (requires ffmpeg). GIF and other unsupported formats are skipped, and failures fall back to the original file",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultCompressBar",
            "label": "最小压缩阈值",
            "label_en": "Min Compress Threshold",
            "placeholder": "5",
            "tooltip": "图片大小超过此值将自动压缩，单位MB，范围1-20",
            "tooltip_en": "Auto-compress when image exceeds this size (MB), range 1-20",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultCompressQuality",
            "label": "默认压缩期望",
            "label_en": "Default Compress Target",
            "placeholder": "80",
            "tooltip": "压缩后体积占原文件的百分比，范围 10-100。例如填 80 表示把原文件压缩到约 80% 的体积",
            "tooltip_en": "Target size as a percentage of the original (10-100). e.g. 80 means compress to ~80% of original size",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "compressMaxSeconds",
            "label": "压缩文件上限时长(秒)",
            "label_en": "Compress Time Limit (s)",
            "placeholder": "600",
            "tooltip": "留空默认 600 秒；填 0 表示不限制。预估耗时或实际执行耗时超过该值即放弃压缩，保留原文件",
            "tooltip_en": "Defaults to 600s when empty; 0 means unlimited. If the estimated or actual time exceeds it, compression is abandoned and the original file is kept",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "compressConcurrency",
            "label": "同时处理任务数（压缩）",
            "label_en": "Concurrent Compress Jobs",
            "placeholder": "1",
            "tooltip": "留空默认 1；填 0 表示不限制。全局同时执行的压缩任务路数，低配机器建议保持 1",
            "tooltip_en": "Defaults to 1 when empty; 0 means unlimited. Global concurrency for compression jobs; keep 1 on low-end hardware",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "uploadBkImg",
            "type": "textarea",
            "rows": 3,
            "label": "上传页背景图",
            "label_en": "Upload Background",
            "tooltip": "1.填写 bing 使用必应壁纸轮播 <br/> 2.填写 [\"url1\",\"url2\"] 使用多张图片轮播 <br/> 3.填写 [\"url\"] 使用单张图片",
            "tooltip_en": "1. Enter \"bing\" for Bing wallpaper rotation <br/> 2. Enter [\"url1\",\"url2\"] for multiple images <br/> 3. Enter [\"url\"] for a single image",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "adminLoginBkImg",
            "type": "textarea",
            "rows": 3,
            "label": "登录页背景图",
            "label_en": "Login Background",
            "tooltip": "1.填写 bing 使用必应壁纸轮播 <br/> 2.填写 [\"url1\",\"url2\"] 使用多张图片轮播 <br/> 3.填写 [\"url\"] 使用单张图片",
            "tooltip_en": "1. Enter \"bing\" for Bing wallpaper rotation <br/> 2. Enter [\"url1\",\"url2\"] for multiple images <br/> 3. Enter [\"url\"] for a single image",
            "category": "管理端设置",
            "category_en": "Admin Settings"
        },
        {
            "id": "adminBkImg",
            "type": "textarea",
            "rows": 3,
            "label": "管理页背景图",
            "label_en": "Admin Background",
            "tooltip": "1.填写 bing 使用必应壁纸轮播 <br/> 2.填写 [\"url1\",\"url2\"] 使用多张图片轮播 <br/> 3.填写 [\"url\"] 使用单张图片",
            "tooltip_en": "1. Enter \"bing\" for Bing wallpaper rotation <br/> 2. Enter [\"url1\",\"url2\"] for multiple images <br/> 3. Enter [\"url\"] for a single image",
            "category": "管理端设置",
            "category_en": "Admin Settings"
        },
        {
            "id": "footerLink",
            "label": "页脚传送门链接",
            "label_en": "Footer Portal Link",
            "type": "textarea",
            "rows": 8,
            "placeholder": "<a href=\"/\">传送门</a>\n<script>/* 统计代码等 */</script>",
            "tooltip": "多行文本框，支持直接粘贴 HTML / JS 代码（如统计代码、备案号、多条自定义链接等）。内容会注入到页面页脚的默认版权文字之后；贴入的 <script> 会正常执行",
            "tooltip_en": "Multi-line field; paste HTML / JS directly (analytics snippets, ICP number, multiple custom links). Injected after the default footer text, and <script> tags will execute",
            "category": "页脚设置",
            "category_en": "Footer Settings"
        },
        {
            "id": "disableFooter",
            "label": "隐藏页脚",
            "label_en": "Hide Footer",
            "type": "boolean",
            "default": false,
            "tooltip": "开启后前台页面底部不显示页脚（含上面的自定义代码）",
            "tooltip_en": "Hide the footer (including custom code above) on public pages",
            "category": "页脚设置",
            "category_en": "Footer Settings"
        },
        {
            "id": "allowedExtensions",
            "label": "允许的上传格式",
            "label_en": "Allowed File Extensions",
            "placeholder": "jpg,png,gif,jpeg,webp,bmp,mp4,webm,mov,m4v,mp3,m4a,aac,ogg",
            "tooltip": "英文逗号分隔，不带点号。v3.0.0 起只校验扩展名（不再用文件签名/magic bytes 拒收，签名不符仅记系统日志），因此头部不规范的 mp3、转封装视频也能正常上传",
            "tooltip_en": "Comma-separated, without dots. Since v3.0.0 only the extension is validated (a signature mismatch is logged, never rejected), so MP3s with unusual headers and remuxed videos upload fine",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "maxUploadSizeMB",
            "label": "单文件大小上限",
            "label_en": "Max Upload Size",
            "placeholder": "1024",
            "default": 1024,
            "tooltip": "单位 MB，留空默认 1024。分片/暂存上传已落盘，可放心调大（如 1024）以上传大视频；超过上限仍会被拒绝",
            "tooltip_en": "Unit: MB. Defaults to 1024 when empty. Chunked/staged uploads are written to disk, so a larger value (e.g. 1024) is safe for big videos",
            "hint": "可在用户编辑中对用户单独开启",
            "hint_en": "Can be enabled per user in user edit",
            "category": "客户端设置",
            "category_en": "Client Settings"
        }
    ]
};
