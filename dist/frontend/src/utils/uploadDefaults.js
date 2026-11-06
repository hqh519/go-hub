/**
 * 从「网页设置」迁移到「其他设置 → 上传相关配置」的配置项 ID。
 *
 * 数据仍存在 sysConfig 的 page 分区（config 数组）里，只是 UI 搬家：
 *   · 网页设置（SysCogPage）不再重复展示这些项，但保存时仍整份回写，值不丢；
 *   · 其他设置（SysCogOthers）按这个清单筛出来渲染，保存时回写 page 分区。
 *
 * 两边共用同一份清单，避免以后新增/调整时出现「一边展示一边不展示」的错位。
 */
export const UPLOAD_DEFAULT_CONFIG_IDS = [
  'showDirectorySuggestions', // 目录候选项
  'defaultUploadFolder', // 默认上传目录
  'defaultUploadNameType', // 默认命名方式
  'defaultUrlForm', // 默认外链格式
  'defaultUploadConcurrency', // 前端并发数（v3.0.0 R11；留空 3）
  'mediaResourceGuardEnabled', // 影音压缩/转码控制（v3.0.0：资源闸门总开关，仅视频/音频）
  'mediaResourceLoadLimit', // load1负载值（v3.0.0：超过 倍率×核数 放弃压缩/转码；0=不检测）
  'mediaResourceRamLimit', // RAM安全值（v3.0.0：可用内存低于该值(MB) 放弃压缩/转码；0=不检测）
  'defaultAutoRetry', // 失败自动重试（v2.8.8 迁入；v2.8.9 改名并新增重试次数）
  'defaultRetryTimes', // 失败重试次数（v2.8.9）
  'defaultAutoSwitch', // 自动切换（v2.8.9：与「失败自动重试」拆开，本项只管渠道切换）
  'videoTranscodeIncompatible', // 视频兼容转码（v2.8.5 由网页设置迁入）
  'videoTranscodeMaxSeconds', // 视频转码上限时长（v2.8.9）
  'videoTranscodeConcurrency', // 转码同时处理任务数（v2.8.9）
  'defaultConvertToWebp', // WebP 转换（总开关）
  'webpMode', // WebP 转换模式（无损/有损；v3.0.0 迁入，随「WebP转换」开关联动显示）
  'defaultCustomerCompress', // 文件压缩（总开关）
  'defaultCompressBar', // 最小压缩阈值
  'defaultCompressQuality', // 默认压缩期望
  'compressMaxSeconds', // 压缩文件上限时长（v2.8.9）
  'compressConcurrency', // 压缩同时处理任务数（v2.8.9）
  'allowedExtensions', // 允许的上传格式
  'maxUploadSizeMB', // 单文件大小上限
];

export default UPLOAD_DEFAULT_CONFIG_IDS;
