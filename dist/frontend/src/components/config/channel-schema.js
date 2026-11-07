/**
 * 存储渠道 Schema —— 前端渠道配置的单一数据源。
 *
 * 字段 key 必须与后端适配器读取的 config 字段严格一致：
 *   S3 系（cos/minio/r2/s3）→ endpoint / region / accessKeyId|secretId / secretAccessKey|secretKey
 *                              / bucket / pathStyle / publicDomain / keyPrefix
 *   HTTP 系（easyimages/lsky/custom）→ apiUrl / fileField / tokenField / tokenHeader / tokenValue
 *                              / extraFields / responsePath / publicDomain / customDeleteUrl
 *   webdav → baseUri / username / password / publicDomain / directory
 *   immich → serverUrl / apiKey / albumId
 */

/**
 * 渠道类型，**顺序即渠道类型编号 typeCode 的升序**（上传设置分组 / 筛选下拉 / 添加渠道下拉均按此排序）：
 *   100 easyimages / 110 lsky / 120 immich / 130 minio / 140 r2 / 150 s3
 *   160 cos / 170 aliyun(ali) / 180 webdav / 190 custom / 999 local（内置，恒排最后）
 *   dedicated = 走自有专属通道（后端有独立适配器实现）
 *   generic   = 与「自定义 Web 通道」共用同一套通用 HTTP 上传适配器
 *   builtin   = 系统内置渠道，随安装自动存在，**不允许通过「添加渠道」创建**（排在最后）
 */
export const CHANNEL_TYPES = [
    { value: 'easyimages', label: 'EasyImages 简单图床', dedicated: false, generic: true, typeCode: 100 },
    { value: 'lsky', label: 'Lsky Pro 兰空图床', dedicated: false, generic: true, typeCode: 110 },
    { value: 'immich', label: 'Immich 相册', dedicated: true, typeCode: 120 },
    { value: 'minio', label: 'MinIO 对象存储', dedicated: true, typeCode: 130 },
    { value: 'r2', label: 'Cloudflare R2', dedicated: true, typeCode: 140 },
    { value: 's3', label: 'S3 兼容存储', dedicated: true, typeCode: 150 },
    { value: 'cos', label: '腾讯云 COS', dedicated: true, typeCode: 160 },
    { value: 'aliyun', label: '阿里云 OSS', dedicated: true, typeCode: 170 },
    { value: 'webdav', label: 'WebDAV 协议存储', dedicated: true, typeCode: 180 },
    { value: 'custom', label: '自定义 Web 通道', dedicated: false, generic: true, typeCode: 190 },
    { value: 'local', label: '本地存储', dedicated: true, builtin: true, typeCode: 999 },
    // v3.0.0：本地文件渠道 —— 只读浏览容器内已有目录，不参与上传（上传页/渠道选择里不会出现）
    // 排序：**必须排在「本地存储」之后**（typeCode 1000 最大）——
    // 上传设置的分组顺序直接按本数组顺序渲染，数组里放前面就会出现「本地文件在本地存储之前」。
    // 仅管理员可见/可用，不做渠道授权。
    { value: 'localfiles', label: '本地文件', dedicated: true, typeCode: 1000, readonly: true }
];

/** 「添加渠道」时可选类型 —— 排除系统内置渠道；
 *  v3.0.0：末尾追加「本地存储（自定义路径）」—— 允许新建 type=local 的自定义本地渠道（rootPath 自定），
 *  内置本地渠道 code=999999 仍随安装唯一存在、不可新增。 */
export const ADDABLE_CHANNEL_TYPES = [
    ...CHANNEL_TYPES.filter((t) => !t.builtin),
    { value: 'local', label: '本地存储', dedicated: true, typeCode: 998 }
];

/** 内置渠道的固定业务 ID（与后端 LOCAL_CHANNEL_CODE 保持一致，1.9.2 起为 999999） */
export const LOCAL_CHANNEL_CODE = '999999';
/** v3.0.0：内置「本地文件」渠道的固定业务 ID（与后端 LOCAL_FILES_CHANNEL_CODE 保持一致） */
export const LOCAL_FILES_CHANNEL_CODE = '999990';

/**
 * 渠道类型 → 后端 CHANNEL_LABEL（用于「渠道类型」筛选参数、卡片角标）。
 * 必须与 backend/src/common/file-view.ts 的 CHANNEL_LABEL 保持一致。
 */
export const CHANNEL_SHORT_LABEL = {
    cos: 'Tencent',
    minio: 'MinIO',
    r2: 'R2',
    s3: 'S3',
    aliyun: 'Aliyun',
    easyimages: 'Easy',
    lsky: 'Lsky',
    webdav: 'WebDAV',
    immich: 'Immich',
    custom: 'External',
    local: 'Local',
    localfiles: 'File'
};

/** 卡片上展示的摘要字段 */
export const SUMMARY_KEYS = {
    cos: [['bucket', 'Bucket'], ['region', '地域'], ['publicDomain', '外链域名']],
    minio: [['endpoint', 'Endpoint/服务地址'], ['bucket', 'Bucket']],
    r2: [['endpoint', '账户ID/Endpoint'], ['bucket', 'Bucket'], ['publicDomain', '外链域名']],
    s3: [['endpoint', 'Endpoint/服务地址'], ['bucket', 'Bucket']],
    aliyun: [['bucket', 'Bucket'], ['region', '地域'], ['publicDomain', '外链域名']],
    easyimages: [['apiUrl', 'Endpoint/服务地址'], ['publicDomain', '外链域名']],
    lsky: [['apiUrl', 'Endpoint/服务地址'], ['publicDomain', '外链域名']],
    webdav: [['baseUri', 'Endpoint/服务地址'], ['directory', '目录']],
    immich: [['serverUrl', 'Endpoint/服务地址'], ['albumId', '相册 ID']],
    custom: [['apiUrl', 'Endpoint/服务地址'], ['publicDomain', '外链域名']],
    // 本地存储：自定义路径时可展示 rootPath；对象前缀随配置展示（内置渠道两项都为空时隐藏）
    local: [['rootPath', '存储地址'], ['objectPrefix', '自定义存储前缀']]
};

/** 各类型顶部提示 */
export const TYPE_TIPS = {
    local: '自定义本地存储渠道：文件写入服务端容器内的指定目录（rootPath），可选择映射到宿主机目录；对象前缀与自定义命名支持占位符（前缀留空默认 {user}/{ID}/{y}/{m}），可启用容量限制。内置本地渠道（存储地址固定 uploads）随安装自动存在、不可删除，只能禁用。',
    cos: '腾讯云 COS 走专属通道：填写地域后可自动生成 Endpoint，也可手填 CDN 加速域名作为外链。',
    minio: 'MinIO 走专属通道：默认使用 Path-Style 寻址，桶需设置为「公开读」才能直接访问外链。若 MinIO 与图床同机 / 同 docker 网络，Endpoint 可直接填容器名（如 minio:9000）走内网通信。',
    r2: 'Cloudflare R2 走专属通道：Endpoint 可只填账户 ID（自动补全 r2.cloudflarestorage.com），外链需填写 r2.dev 子域或自定义域名。',
    s3: 'S3 兼容存储：通过标准 S3 协议接入（endpoint + 密钥 + 可选 Path-Style / 自定义 User-Agent），适用于 AWS S3 及各类 S3 协议对象存储（如阿里云 OSS、七牛、Backblaze B2、自建 MinIO 等）。自建服务可直接填内网 IP 或容器名。',
    aliyun: '阿里云 OSS 走专属通道：使用 OSS 官方接口与自有签名（不依赖 S3 兼容层），只需「Bucket + 地域 + AccessKey」即可；填了地域会自动推导 Endpoint（如 oss-cn-hangzhou.aliyuncs.com）。Bucket 需设置为「公共读」才能直接访问外链，或绑定自定义域名（CDN）后填在「自定义访问域名」。',
    easyimages: 'EasyImages 简单图床：填上传接口地址与 Token 即可，响应 URL 路径默认取 url。',
    lsky: 'Lsky Pro 兰空图床：v2 版接口为 /api/v1/upload，需带上 Authorization 头；v1 版响应路径为 data.url。',
    webdav: 'WebDAV 作为「存储渠道」：直接 PUT 文件到你的网盘，与「对外提供 WebDAV 服务」无关。地址同样支持内网 IP / 容器名（如 nas.local:5005/dav）。',
    immich: 'Immich 走专属通道：按「去重检查 → 上传 → 入相册 → 建分享链接」四步流程实现，外链为分享原图地址。服务地址支持填容器名（如 immich:2283）走内网。',
    custom: '自定义 Web 存储：只需「上传接口地址 + 文件字段名 + 响应 URL 路径」三件套即可接入任意 HTTP 图床；需要鉴权或附加参数时，用「自定义请求头 (JSON)」和「自定义Body (JSON)」。同时兼容主流通用 API：请求方法可选 POST/PUT/PATCH，请求体可选 multipart 或 JSON+Base64，响应 URL 路径支持多候选与自动探测，相对路径响应会自动补全域名。'
};

/**
 * 本地存储（内置渠道 code=999999）：
 * v3.0.0 契约字段 —— prefixPath 固定 uploads（只读）、objectPrefix、nameTemplate、
 * sizeLimitEnabled / sizeLimitGB、note。落盘规则：uploads/用户名/实例/对象前缀。
 */
export const LOCAL_BUILTIN_FIELDS = () => [
    f('prefixPath', '存储地址', {
        def: 'uploads',
        fixed: true,
        placeholder: 'uploads',
        tip: '系统内置路径，不可修改。实体文件按「uploads / 自定义存储前缀 / 文件名」落盘' +
            '（前缀留空时默认 {user}/{ID}/{y}/{m}），外链统一由本站 /file/ 代理下发。'
    }),
    f('objectPrefix', '自定义存储前缀（可选）', {
        placeholder: '{user}/{ID}/{y}/{m}',
        tip: OBJECT_PREFIX_TIP,
        quick: 'prefix'
    }),
    f('nameTemplate', '自定义文件命名（可选）', { placeholder: '{hash}', tip: CUSTOM_NAME_TIP, quick: 'name' }),
    { key: 'sizeLimitEnabled', label: '启用容量限制', type: 'switch', def: false },
    {
        key: 'sizeLimitGB',
        label: '容量上限 (GB)',
        type: 'number',
        def: 10,
        min: 0.1,
        step: 1,
        precision: 1,
        showWhen: { key: 'sizeLimitEnabled', value: true }
    },
    f('note', '备注', { type: 'textarea', placeholder: '给这个渠道写点备注，例如：用途、磁盘位置等' })
];

/**
 * v3.0.0（R11）：内置「本地文件」渠道（code=999990）的字段。
 * 浏览目录由系统生成（后端固定为 uploads 的绝对路径），**禁止变更** ——
 * 这里做成只读展示，避免管理员在 UI 上改了却被后端静默覆盖、误以为已生效。
 */
export const LOCAL_FILES_BUILTIN_FIELDS = () => [
    f('rootPaths', '浏览目录（容器内路径，系统固定）', {
        type: 'textarea',
        fixed: true,
        def: '',
        placeholder: 'uploads',
        tip: '系统内置的本地文件渠道：浏览目录固定为 uploads（容器内路径由后端强制写入），不可修改。' +
            '如需浏览其它目录，请用「添加渠道 → 本地文件」新建一个渠道。'
    }),
    f('hostPath', '宿主机映射目录（可选）', {
        // v1.0.2：与「浏览目录」保持一致的书写形态 —— 多行文本，一行对应一个容器内目录
        type: 'textarea',
        placeholder: '/vol1/docker/gohub-data',
        tip: '仅用于说明：填写 uploads 在宿主机上对应的目录，方便运维对照，不参与任何读写。一行一个，与「浏览目录」按顺序对应。'
    })
];

/**
 * 渠道类型 > 字段定义的分发（供 SysCogUpload 使用）。
 * v3.0.0（R11）：内置本地文件渠道（999990）与自建本地文件渠道字段不同 ——
 * 前者浏览目录只读，后者可自由填写。
 */
export const LOCAL_FILES_FIELDS = () => [
    f('rootPaths', '浏览目录（容器内路径，一行一个）', {
        required: true,
        type: 'textarea',
        def: '',
        placeholder: '/data/share\n/mnt/photos',
        suggest: ['/data', '/mnt', '/mnt/data', '/share', '/media', '/app/uploads'],
        tip: '容器内的绝对路径，一行一个，可填多个；本地文件管理页的根目录会把每个浏览目录显示为一级子目录。' +
            '系统只读取这些目录，不会修改或删除里面的任何文件；' +
            '以 . 开头、以 # 开头的文件以及 node_modules / .git 等目录默认隐藏。'
    }),
    f('hostPath', '宿主机映射目录（可选）', {
        // v1.0.2：改为多行文本，一行对应上面「浏览目录」里的一个容器内路径
        type: 'textarea',
        placeholder: '/vol1/docker/share\n/mnt/photos',
        tip: '仅用于说明：填写浏览目录在宿主机上对应的目录，方便运维对照，不参与任何读写。一行一个，与「浏览目录」按顺序对应。'
    })
];

/**
 * 本地存储（自定义渠道，type=local，code 为 99xxxx）：
 * v3.0.0 契约字段 —— rootPath（容器内地址，必填）、hostPath（可选，宿主机映射目录）、
 * objectPrefix、nameTemplate、sizeLimitEnabled / sizeLimitGB、note。
 */
export const LOCAL_CUSTOM_FIELDS = () => [
    /*
     * v1.0.1：存储地址改为「可输入的下拉」——
     * 选项只来自容器内**已真实映射**的目录（后端 /api/manage/channels/mounts），
     * 未映射的路径不会出现在选项里、也无法被选中。
     * 原因：写进未映射的容器路径时，文件只落在容器可写层，容器重建后连同实体文件一起丢失。
     */
    f('rootPath', '存储地址（容器内路径）', {
        type: 'pathSelect',
        required: true,
        placeholder: '从已映射目录中选择，或输入关键字筛选',
        tip: '只能选择容器内**已映射**的目录（下拉列表即容器内真实可写的挂载点），支持输入关键字快速筛选。' +
            '未映射的路径不允许选择 —— 那种路径的文件只存在于容器可写层，容器重建后会全部丢失。' +
            '如需新增目录，请先在 docker -v / compose volumes 里把它映射进容器。'
    }),
    /*
     * v1.0.1：同步到本地文件管理 —— 打开后这个存储地址会直接出现在
     * 「本地文件」页（/localFiles）的渠道选择里，可浏览、预览、批量上传到图床。
     */
    f('syncToLocalFiles', '同步到本地文件管理', {
        type: 'switch',
        def: false,
        tip: '开启后，该渠道的存储地址会自动出现在「本地文件」页（/localFiles）的渠道选择中，' +
            '可直接浏览、预览、批量上传目录内的文件；关闭则从该选择列表中移除（不影响已上传的文件）。'
    }),
    f('hostPath', '宿主机映射目录（可选）', {
        // v1.0.2：与本地文件渠道统一为多行文本
        type: 'textarea',
        placeholder: '/vol1/docker/gohub-data',
        tip: '当 rootPath 已通过 docker -v / compose 卷映射到宿主机时填写对应宿主机目录，便于直接在宿主机查看与管理实体文件；未映射则留空。一行一个。'
    }),
    f('objectPrefix', '自定义存储前缀（可选）', {
        placeholder: '{user}/{ID}/{y}/{m}',
        tip: OBJECT_PREFIX_TIP,
        quick: 'prefix'
    }),
    f('nameTemplate', '自定义文件命名（可选）', { placeholder: '{hash}', tip: CUSTOM_NAME_TIP, quick: 'name' }),
    { key: 'sizeLimitEnabled', label: '启用容量限制', type: 'switch', def: false },
    {
        key: 'sizeLimitGB',
        label: '容量上限 (GB)',
        type: 'number',
        def: 10,
        min: 0.1,
        step: 1,
        precision: 1,
        showWhen: { key: 'sizeLimitEnabled', value: true }
    },
    f('note', '备注', { type: 'textarea', placeholder: '给这个渠道写点备注，例如：用途、磁盘位置等' })
];

const f = (key, label, extra = {}) => ({ key, label, type: 'text', ...extra });

/**
 * 「服务地址 / Endpoint」统一提示 —— 支持内网 IP 与 Docker 容器名。
 *
 * 场景：GoHub 与 MinIO / Immich / 兰空 / WebDAV 等部署在同一台 NAS、
 * 同一个 docker compose 网络里时，用内网地址直连可以走内网链路（不经公网、
 * 不绕 CDN），上传明显更快。
 *
 * ⚠️ 关键点：渠道通信全部由「服务端」发起（后端去 PUT/POST 文件），
 * 浏览器只是把配置提交给后端 —— 所以图床自身对外是 https 也完全不影响
 * 用 http://minio:9000 这类内网地址通信，不存在混合内容拦截问题。
 */
const INTERNAL_ADDR_TIP =
    '支持内网直连：可直接填内网 IP 或 Docker 容器名（如 minio:9000、immich:2283、lsky:8080、192.168.1.10:9000、nas.local）。' +
    '与图床在同一网络时走内网通信、上传更快。不写协议时自动判断：内网 / 容器名按 http，公网域名按 https。' +
    '渠道通信由服务端发起，因此图床对外是 https 也不影响用内网地址连接。';

const OBJECT_PREFIX_TIP =
    '自定义存储前缀决定文件在存储桶 / 网盘里的目录层级，支持占位符：' +
    '{user} 当前账户用户名、{ID} 渠道 ID、{y} 年（4 位）、{m} 月（2 位）、{d} 日（2 位）、' +
    '{domain} 渠道外链域名（未配置外链域名时为空）。' +
    '例如填 {user}/{ID}/{y}/{m} 会存成 alice/992299/2026/11/xxx.png；' +
    '留空时：普通渠道按 {y}/{m}（年份/月份）归档，本地存储渠道按 {user}/{ID}/{y}/{m} 归档。' +
    '末尾斜杠会自动补齐，重复斜杠会自动合并。';

const CUSTOM_NAME_TIP =
    '自定义文件命名，支持占位符：' +
    '{hash} 内容哈希前 16 位、{filename} 原文件名（不含扩展名）、{uuid} 随机 UUID、{md5} 文件 MD5、' +
    '{timestamp} 13 位毫秒时间戳、{ext} 扩展名（含点）。' +
    '例如 {filename}-{timestamp}.{ext} 会生成 photo-1730112000000.png。' +
    '{filename} 只保留「文字 / 字母 / 数字 / - / _ / .」，首尾空格去掉、中间空格转 -。' +
    '留空则默认使用 {hash}（内容哈希前 16 位）；模板里没写 {ext} 时会自动补上原扩展名。';

/** 外链域名（publicDomain）类字段的提示 —— 与上传通道区分开 */
const PUBLIC_DOMAIN_TIP =
    '这里是「外链域名」，用来替换外链的域名部分（外链 = 此域名 + 对象路径），与上面的上传通道相互独立：' +
    '上传可以走内网地址，外链域名另填。' +
    '取值取决于外链分发模式：' +
    '① 代理模式（默认，图片由本图床转发给访客）→ 取流由服务端发起，这里同样可以填内网地址（如 http://minio:9000），' +
    '读写全走内网、速度最快，访客看到的仍是图床自己的域名；' +
    '② 302 重定向模式（访客浏览器直接打开该地址）→ 必须填公网可访问的地址，否则访客打不开图片。';

/** v2.8.7：内网通信域名（internalDomain）字段提示 */
const INTERNAL_DOMAIN_TIP =
    '可选。填容器内网 IP 或容器名作为通信地址（如 http://minio:9000、immich:2283），' +
    '设置后系统内部所有加载该渠道文件的地方（文件管理、文件详情、历史记录、访客图库、签发外链的代理转发等）' +
    '都会优先用这个内网地址取流：提高加载速度、节省公网流量；' +
    '未设置时用上面的公开访问域名，再为空则用 Endpoint。' +
    '注意：文件详情页「存储渠道 / 备份渠道」的渠道源链接仍使用公开访问域名；302 重定向模式下外链也走公开访问域名。';


/** 各类型的业务字段 */
export const CHANNEL_FIELDS = {
/**
 * 本地存储：v3.0.0 起指向内置渠道字段（LOCAL_BUILTIN_FIELDS）。
 * 自定义本地渠道的字段用 LOCAL_CUSTOM_FIELDS（由 SysCogUpload 按渠道 code 区分）。
 */
    /**
     * v3.0.0：本地文件渠道（只读浏览）。
     * v3.0.0（R8）：「浏览根目录」升级为「浏览目录」—— 支持多个目录（一行一个），
     * 本地文件管理页的根目录会把每个浏览目录渲染成一级子目录。
     * 兼容：旧配置只有 rootPath 单目录 —— 编辑时自动预填，后端读取时自动回落。
     * 该渠道不参与任何上传动作，仅供「本地文件」页浏览 / 预览 / 一键上传到图床。
     */
    localfiles: LOCAL_FILES_FIELDS,
    local: LOCAL_BUILTIN_FIELDS,
    cos: () => [
        f('bucket', '存储桶名称 (Bucket)', { required: true, placeholder: 'mybucket（可只填前缀，由 AppID 自动补全）' }),
        f('appid', 'APPID', {
            placeholder: '125xxxxxxxxx',
            tip: '腾讯云账号 APPID。COS 的 Bucket 全名必须是 <bucket>-<APPID>；填了这里，上面只填桶名前缀也会自动补全。'
        }),
        f('cosVersion', 'COS 版本', {
            type: 'select',
            def: 'v5',
            options: [
                { value: 'v5', label: 'V5（签名算法 v5，默认，与 PHP 案例一致）' },
                { value: 'v4', label: 'V4（AWS 签名 v4 / S3 兼容）' }
            ],
            tip: '本系统通过 COS 官方 S3 兼容协议上传，两种签名均可正常工作，默认使用 V5。'
        }),
        f('region', '所属地域 (Region)', { required: true, placeholder: 'ap-guangzhou' }),
        f('endpoint', 'Endpoint/服务地址', {
            placeholder: 'https://cos.{Region}.myqcloud.com',
            tip: '留空自动使用 https://cos.<region>.myqcloud.com；如使用私有或加速端点可在此覆盖。' + INTERNAL_ADDR_TIP
        }),
        f('publicDomain', '公开访问域名', {
            placeholder: 'https://{Bucket}.cos.{Region}.myqcloud.com',
            tip: '优先用于拼接外链（如 COS 的 CDN 加速域名）。留空则按 endpoint + bucket 自动拼接。' + PUBLIC_DOMAIN_TIP
        }),
        f('secretId', 'SecretId', { type: 'password', required: true, secret: true }),
        f('secretKey', 'SecretKey', { type: 'password', required: true, secret: true }),
        f('pathStyle', 'Path-Style 寻址', { type: 'switch', def: false }),
        f('objectPrefix', '自定义存储前缀（可选）', { placeholder: '{user}/{ID}/{y}/{m}', tip: OBJECT_PREFIX_TIP, quick: 'prefix' }),
        f('customName', '自定义文件命名（可选）', { placeholder: '{hash}', tip: CUSTOM_NAME_TIP, quick: 'name' }),
        f('suffix', '外链后缀（可选）', {
            placeholder: '?imageMogr2/thumbnail/800x',
            tip: '拼接在外链末尾的图片处理参数（对齐 PHP 案例的 tencent_suffix），如 COS 数据万象的 ?imageMogr2。'
        })
    ],
    minio: () => [
        f('endpoint', 'Endpoint/服务地址', {
            required: true,
            placeholder: 'minio:9000 / 192.168.1.10:9000 / http://127.0.0.1:9000',
            tip: INTERNAL_ADDR_TIP
        }),
        f('bucket', '存储桶名称 (Bucket)', { required: true, placeholder: 'gohub' }),
        f('region', 'Region', { placeholder: 'us-east-1', def: 'us-east-1' }),
        f('accessKeyId', 'AccessKey', { required: true, secret: true }),
        f('secretAccessKey', 'SecretKey', { type: 'password', required: true, secret: true }),
        f('publicDomain', '公开访问域名', {
            required: true,
            placeholder: 'https://minio.example.com 或 http://minio:9000',
            tip: 'v3.0.0 起只填域名即可（不要带 /存储桶），桶名由后端在拼链接时补上，' +
                '最终外链 = 域名/桶名/对象前缀/文件名（例如 https://minio.example.com/gohub/2026/10/xxx.png），' +
                '换桶名时外链会自动跟随变化。MinIO 需将桶设为公开读。' + PUBLIC_DOMAIN_TIP
        }),
        f('internalDomain', '内网通信域名（可选）', {
            placeholder: 'http://内网地址:端口 或 容器名称:端口',
            tip: '只填域名（如 http://minio:9000 或 http://192.168.1.10:9000），不需要带 /存储桶；' +
                '系统取流时会拼成 域名/桶名/对象前缀/文件名。' + INTERNAL_DOMAIN_TIP
        }),
        f('pathStyle', 'Path-Style 寻址', { type: 'switch', def: true, tip: 'MinIO 必须开启 Path-Style。' }),
        f('objectPrefix', '自定义存储前缀（可选）', { placeholder: '{user}/{ID}/{y}/{m}', tip: OBJECT_PREFIX_TIP, quick: 'prefix' }),
        f('customName', '自定义文件命名（可选）', { placeholder: '{hash}', tip: CUSTOM_NAME_TIP, quick: 'name' })
    ],
    r2: () => [
        f('endpoint', '账户 ID 或 Endpoint', {
            required: true,
            placeholder: '1a2b3c4d... 或 https://xxx.r2.cloudflarestorage.com',
            tip: '只填账户 ID 会自动补全为 https://<账户ID>.r2.cloudflarestorage.com。' +
                'R2 是 Cloudflare 云服务、通常无需内网直连；若确实要指向自建 S3 网关，' +
                '请写完整协议（如 http://192.168.1.10:9000），否则会被当成账户 ID 处理。'
        }),
        f('bucket', '存储桶名称 (Bucket)', { required: true, placeholder: 'gohub' }),
        f('accessKeyId', 'Access Key ID', { required: true, secret: true }),
        f('secretAccessKey', 'Secret Access Key', { type: 'password', required: true, secret: true }),
        f('publicDomain', '公开访问域名', {
            required: true,
            placeholder: 'https://pub-xxxx.r2.dev',
            tip: 'R2 直链需要开启公开访问（r2.dev 子域或绑定的自定义域名）。' + PUBLIC_DOMAIN_TIP
        }),
        f('objectPrefix', '自定义存储前缀（可选）', { placeholder: '{user}/{ID}/{y}/{m}', tip: OBJECT_PREFIX_TIP, quick: 'prefix' }),
        f('customName', '自定义文件命名（可选）', { placeholder: '{hash}', tip: CUSTOM_NAME_TIP, quick: 'name' })
    ],
    s3: () => [
        f('endpoint', 'Endpoint/服务地址', {
            required: true,
            placeholder: 'https://s3.us-east-1.amazonaws.com / minio:9000 / 192.168.1.10:9000',
            tip: INTERNAL_ADDR_TIP
        }),
        f('bucket', '存储桶名称 (Bucket)', { required: true, placeholder: 'gohub' }),
        f('region', 'Region', { placeholder: 'us-east-1', def: 'us-east-1' }),
        f('accessKeyId', 'Access Key ID', { required: true, secret: true }),
        f('secretAccessKey', 'Secret Access Key', { type: 'password', required: true, secret: true }),
        f('pathStyle', 'Path-Style 寻址', { type: 'switch', def: false }),
        f('publicDomain', '公开访问域名', {
            placeholder: 'https://cdn.example.com',
            tip: '留空则按 endpoint + bucket 自动拼接外链。' + PUBLIC_DOMAIN_TIP
        }),
        f('internalDomain', '内网通信域名（可选）', { placeholder: 'http://内网地址:端口 或 容器名称:端口', tip: INTERNAL_DOMAIN_TIP }),
        f('objectPrefix', '自定义存储前缀（可选）', { placeholder: '{user}/{ID}/{y}/{m}', tip: OBJECT_PREFIX_TIP, quick: 'prefix' }),
        f('customName', '自定义文件命名（可选）', { placeholder: '{hash}', tip: CUSTOM_NAME_TIP, quick: 'name' }),
        f('userAgent', '自定义 User-Agent（可选）', {
            placeholder: 'CloudFlare-ImgBed',
            tip: '部分 S3 兼容服务商把访问密钥与特定 UA 绑定，配置后请求头将直接替换为该值（只能包含可打印 ASCII 字符）。'
        })
    ],
    aliyun: () => [
        f('bucket', '存储桶名称 (Bucket)', { required: true, placeholder: 'my-bucket（需为公共读，或绑定自定义域名）' }),
        f('region', '所属地域 (Region)', {
            required: true,
            placeholder: 'oss-cn-hangzhou',
            tip: '按控制台的地域填写（可省略前缀 oss-，如填 cn-hangzhou），系统自动推导 Endpoint 为 oss-<region>.aliyuncs.com。'
        }),
        f('endpoint', 'Endpoint（可选）', {
            placeholder: '留空将按地域自动生成',
            tip: '留空自动使用 https://oss-<region>.aliyuncs.com；如需走传输加速域名、内网端点或自建代理网关，在此覆盖。' + INTERNAL_ADDR_TIP
        }),
        f('accessKeyId', 'AccessKeyId', { required: true, secret: true }),
        f('accessKeySecret', 'AccessKeySecret', { type: 'password', required: true, secret: true }),
        f('publicDomain', '公开访问域名', {
            placeholder: 'https://img.example.com',
            tip: '优先用于拼接外链（如 OSS 绑定的自定义域名 / CDN 加速域名）。留空则用 bucket.oss-<region>.aliyuncs.com（公共读才能直接访问）。' + PUBLIC_DOMAIN_TIP
        }),
        f('pathStyle', 'Path-Style 寻址', {
            type: 'switch',
            def: false,
            tip: '默认走 bucket.域名/key（虚拟主机风格）。若使用内网端点或代理网关不支持子域名，可开启后改用 域名/bucket/key。'
        }),
        f('objectPrefix', '自定义存储前缀（可选）', { placeholder: '{user}/{ID}/{y}/{m}', tip: OBJECT_PREFIX_TIP, quick: 'prefix' }),
        f('customName', '自定义文件命名（可选）', { placeholder: '{hash}', tip: CUSTOM_NAME_TIP, quick: 'name' }),
        f('suffix', '外链后缀（可选）', {
            placeholder: '?x-oss-process=image/resize,w_800',
            tip: '拼接在外链末尾的图片处理参数（OSS 图片处理为 x-oss-process），如 ?x-oss-process=image/resize,w_800/quality,q_80。'
        })
    ],
    easyimages: () => [
        f('apiUrl', 'Endpoint/服务地址', {
            required: true,
            placeholder: 'https://img.example.com/api/index.php 或 192.168.1.10/api/index.php',
            tip: INTERNAL_ADDR_TIP
        }),
        f('tokenValue', 'Token', {
            type: 'password',
            secret: true,
            tip: '对应 EasyImages 后台的 API Token。发送时作为表单字段 token 提交。'
        }),
        f('tokenField', 'Token 表单字段名', {
            placeholder: 'token',
            def: 'token',
            tip: 'Token 在 multipart 表单中的字段名。EasyImages 固定为 token —— 保留此字段是为了兼容其它同源图床（字段名不同时可直接改），不确定就保持默认。'
        }),
        f('fileField', '文件表单字段名', {
            placeholder: 'image',
            def: 'image',
            tip: '文件在 multipart 表单中的字段名。EasyImages 固定为 image（不是 file！填错就会报「没有选择上传的文件」）。同样可改以适配其它图床。'
        }),
        f('responsePath', '响应 URL 路径', { placeholder: 'url', def: 'url', tip: '响应 JSON 中外链所在路径，如 url、data.url、[0].src。' }),
        f('publicDomain', '公开访问域名', { required: true, placeholder: 'https://cdn.example.com', tip: PUBLIC_DOMAIN_TIP }),
        f('internalDomain', '内网通信域名（可选）', { placeholder: 'http://内网地址:端口 或 容器名称:端口', tip: INTERNAL_DOMAIN_TIP }),
        f('customDeleteUrl', '删除接口模板（可选）', { placeholder: 'https://img.example.com/app/del.php?hash=' })
    ],
    lsky: () => [
        f('apiUrl', 'Endpoint/服务地址', {
            required: true,
            placeholder: 'https://img.example.com/api/v1/upload 或 lsky:8080/api/v1/upload',
            tip: INTERNAL_ADDR_TIP
        }),
        f('tokenValue', 'Authorization 请求头值', {
            type: 'password',
            required: true,
            secret: true,
            tip: '需带前缀，例如：Bearer 1|xxxxxxxx。'
        }),
        f('tokenHeader', '认证请求头名', { placeholder: 'Authorization', def: 'Authorization' }),
        f('fileField', '文件表单字段名', { placeholder: 'file', def: 'file' }),
        f('extraFields', '附加表单字段 (JSON)', {
            type: 'textarea',
            placeholder: '{"strategy_id":"1"}',
            tip: 'Lsky Pro v2 需要指定存储策略 ID 时填写。'
        }),
        f('responsePath', '响应 URL 路径', { placeholder: 'data.links.url', def: 'data.links.url', tip: 'Lsky v1 用 data.url，v2 用 data.links.url。' }),
        f('publicDomain', '公开访问域名', { required: true, placeholder: 'https://cdn.example.com', tip: PUBLIC_DOMAIN_TIP }),
        f('internalDomain', '内网通信域名（可选）', { placeholder: 'http://内网地址:端口 或 容器名称:端口', tip: INTERNAL_DOMAIN_TIP })
    ],
    webdav: () => [
        f('baseUri', 'Endpoint/服务地址', {
            required: true,
            placeholder: 'https://dav.example.com/remote.php/dav/files/user 或 nas.local:5005/dav',
            tip: INTERNAL_ADDR_TIP
        }),
        f('username', '用户名', { placeholder: 'user' }),
        f('password', '密码 / 应用密码', { type: 'password', secret: true }),
        f('objectPrefix', '自定义存储前缀（可选）', {
            placeholder: '{user}/{ID}/{y}/{m}',
            tip: 'v3.0.0（R10）起「存储目录」并入本项：填 gohub 就存到 <Endpoint/服务地址>/gohub/ 下，' +
                '支持 {user}/{ID}/{y}/{m}/{d} 等占位符；上传后路径会固化落库，之后改这里不影响已存文件。' + OBJECT_PREFIX_TIP,
            quick: 'prefix'
        }),
        f('customName', '自定义文件命名（可选）', { placeholder: '{hash}', tip: CUSTOM_NAME_TIP, quick: 'name' }),
        f('publicDomain', '公开访问域名', {
            required: true,
            placeholder: 'https://img.example.com',
            tip: '该渠道下文件对公网的访问域名；代理模式取流仍优先用「内网通信域名」。' + PUBLIC_DOMAIN_TIP
        }),
        f('internalDomain', '内网通信域名（可选）', { placeholder: 'http://内网地址:端口 或 容器名称:端口', tip: INTERNAL_DOMAIN_TIP })
    ],
    immich: () => [
        f('serverUrl', 'Endpoint/服务地址', {
            required: true,
            placeholder: 'immich:2283 / 192.168.1.10:2283 / https://immich.example.com',
            tip: INTERNAL_ADDR_TIP
        }),
        f('apiKey', 'API Key', { type: 'password', required: true, secret: true }),
        f('albumId', '相册 ID（可选）', { placeholder: '上传后自动加入该相册' }),
        f('shareLinkId', '相册共享链接 ID / Key（可选）', {
            placeholder: '留空则每张图单独创建分享链接',
            tip: '可选项：填写后不再为每张图创建分享链接，直接复用该共享 Key 生成外链（适合已配置好相册共享链接的场景）。'
        }),
        f('domain', '公开访问域名', {
            required: true,
            placeholder: 'https://img.example.com',
            tip: '该渠道下文件对公网的访问域名（对齐 PHP 案例的 immich_domain）；代理模式取流优先用「内网通信域名」。' + PUBLIC_DOMAIN_TIP
        }),
        f('internalDomain', '内网通信域名（可选）', { placeholder: 'http://内网地址:端口 或 容器名称:端口', tip: INTERNAL_DOMAIN_TIP })
    ],
    custom: () => [
        // ---- 与 PHP 联调案例一一对应的核心字段（apiUrl / fileField / responsePath / publicDomain / headers / body），
        //      httpMethod 与 requestFormat 为「兼容主流通用 API」新增的可选项 ----
        f('apiUrl', 'Endpoint/服务地址', {
            required: true,
            placeholder: 'https://your-gohub.com/api/upload 或 192.168.1.10/api/upload',
            tip: '对齐 PHP 案例的 custom_api：文件将以 multipart/form-data POST 到这里。支持 {filename} {name} {ext} {mime} {size} {timestamp} {random} 占位符。' + INTERNAL_ADDR_TIP
        }),
        f('httpMethod', '请求方法', {
            type: 'select',
            def: 'POST',
            options: [
                { value: 'POST', label: 'POST（默认，绝大多数图床）' },
                { value: 'PUT', label: 'PUT' },
                { value: 'PATCH', label: 'PATCH' }
            ],
            tip: '对齐 PHP 案例的 POST 请求；少数自建接口要求 PUT / PATCH 时在这里切换。'
        }),
        f('requestFormat', '请求体格式', {
            type: 'select',
            def: 'multipart',
            options: [
                { value: 'multipart', label: 'multipart/form-data（默认，与 PHP 案例一致）' },
                { value: 'json', label: 'JSON + Base64（兼容只收 base64 的接口）' }
            ],
            tip: '选 JSON 时文件会转成 data:<mime>;base64,xxx 放进「文件表单字段名」指定的键，用于只接受 base64 的接口（如 SM.MS、ImgBB、聚合图床等）。'
        }),
        f('fileField', '文件表单字段名', {
            placeholder: 'image',
            def: 'image',
            tip: '对齐 PHP 案例的 custom_post_param，默认 image；若对方接口用 file 请改成 file。'
        }),
        f('responsePath', '响应 URL 路径', {
            placeholder: 'url',
            def: 'url',
            tip: '对齐 PHP 案例的 custom_json_path，默认 url；支持 a.b.c、[0].src、data.list.0.url 等路径，也可用「|」写多候选（如 data.url|url|data.links.url），填 auto 或留空则自动探测主流图床的常见位置。'
        }),
        f('publicDomain', '公开访问域名', {
            required: true,
            placeholder: 'https://cdn.example.com',
            tip: '对齐 PHP 案例的 custom_domain：该渠道下文件对公网的访问域名，用于加 CDN 或修正内网地址。' + PUBLIC_DOMAIN_TIP
        }),
        f('internalDomain', '内网通信域名（可选）', { placeholder: 'http://内网地址:端口 或 容器名称:端口', tip: INTERNAL_DOMAIN_TIP }),
        f('headers', '自定义请求头 (JSON)', {
            type: 'textarea',
            placeholder: '{"Authorization":"Bearer xxx","X-Custom":"1"}',
            tip: '对齐 PHP 案例的 custom_headers：任意请求头 JSON 对象（键与值都用双引号）。需要鉴权就写在这里。'
        }),
        f('body', '自定义Body (JSON)', {
            type: 'textarea',
            placeholder: '{"album":"default","strategy_id":"1"}',
            tip: '对齐 PHP 案例的 custom_body：随文件一起 POST 的额外表单字段，JSON 对象。'
        }),
        f('customDeleteUrl', '删除接口模板（可选）', {
            placeholder: 'https://your-gohub.com/api/delete?url={url}',
            tip: '含 {url} 占位符，删除时会替换为文件的完整外链地址。'
        }),
        f('customDeleteMethod', '删除请求方法', { placeholder: 'GET', def: 'GET' }),
        // ---- 以下为兼容早期版本的字段，新配置建议直接用上面的 headers / body ----
        f('tokenHeader', '【兼容】认证请求头名', { placeholder: 'Authorization' }),
        f('tokenValue', '【兼容】认证请求头值', { type: 'password', secret: true, tip: '可填写完整值，如 Bearer xxxx；缺 scheme 时自动补 Bearer。' }),
        f('tokenField', '【兼容】表单字段认证名', { placeholder: 'token' }),
        f('extraFields', '【兼容】附加表单字段 (JSON)', { type: 'textarea', placeholder: '{"album":"default"}' })
    ]
};

/**
 * 容量限制（所有类型通用，追加在业务字段之后）。
 * 后两项依赖「启用容量限制」，未开启时隐藏（showWhen 由 visibleFields 处理）。
 */
const QUOTA_FIELDS = () => [
    { key: 'quotaEnabled', label: '启用容量限制', type: 'switch', def: false },
    {
        key: 'quotaLimitGB',
        label: '容量上限 (GB)',
        type: 'number',
        def: 10,
        min: 0.1,
        step: 1,
        precision: 1,
        showWhen: { key: 'quotaEnabled', value: true }
    },
    {
        key: 'quotaThreshold',
        label: '告警阈值 (%)',
        type: 'number',
        def: 95,
        min: 50,
        max: 100,
        step: 5,
        showWhen: { key: 'quotaEnabled', value: true }
    }
];

/**
 * 按 showWhen 条件过滤字段。
 * showWhen: { key, value } —— 仅当 model[key] === value 时才渲染该字段。
 * @param {Array} fields
 * @param {object} model 当前渠道 config
 */
export function visibleFields(fields, model) {
    return (fields || []).filter((field) => {
        const cond = field.showWhen;
        if (!cond) return true;
        const actual = model ? model[cond.key] : undefined;
        return Array.isArray(cond.value) ? cond.value.includes(actual) : actual === cond.value;
    });
}

/** 生成某类型的完整字段列表（业务字段 + 容量字段）。
 *  v3.0.0：本地渠道的字段里已自带契约的「启用容量限制 / 容量上限」（sizeLimitEnabled / sizeLimitGB），
 *  不再追加通用容量字段（quotaEnabled 等）。 */
export function fieldsOf(type) {
    const base = CHANNEL_FIELDS[type] ? CHANNEL_FIELDS[type]() : [];
    if (type === 'local') return base;
    return [...base, ...QUOTA_FIELDS()];
}

/** 按给定字段列表生成默认 config 对象（供本地渠道等非 fieldsOf 来源使用） */
export function buildDefaultsFrom(fields) {
    const out = {};
    for (const field of fields || []) {
        if (field.def !== undefined) out[field.key] = field.def;
        else if (field.type === 'switch') out[field.key] = false;
        else out[field.key] = '';
    }
    return out;
}

/** 生成某类型的默认 config 对象（用于新增渠道时预填） */
export function buildDefaults(type) {
    const out = {};
    for (const field of fieldsOf(type)) {
        if (field.def !== undefined) out[field.key] = field.def;
        else if (field.type === 'switch') out[field.key] = false;
        else out[field.key] = '';
    }
    return out;
}
