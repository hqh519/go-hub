/**
 * 全站文件链接统一出口。
 *
 * 背景：以前各处各自用 `window.location.origin + '/file/'` 拼文件外链，
 * 导致后台设置了「自定义访问域名」之后，只有少数页面跟随新域名，
 * 文件管理 / 历史记录 / 文件详情 / 系统状态 / 上传页各自为政。
 *
 * 现在统一从这里取前缀。前缀由后端 `/api/userConfig` 的 `urlPrefix` 下发，
 * 后端优先级：上传设置的「自定义访问域名」> 页面设置「默认URL前缀」> 本站 /file/。
 * 因此只要改一次自定义域名，全站文件链接一起跟随。
 *
 * ⚠️ 只用于【文件链接】。页面地址、接口地址等非文件链接不要用这里。
 */

/** 兜底前缀：本站 /file/（未拿到后端配置时使用） */
function fallbackPrefix() {
  return `${window.location.protocol}//${window.location.host}/file/`;
}

/** 归一化：确保以「/」结尾；空值返回空串 */
function normalize(prefix) {
  const s = String(prefix || '').trim();
  if (!s) return '';
  return s.endsWith('/') ? s : `${s}/`;
}

let currentPrefix = '';

/** 设置全局文件链接前缀（由 store 的 userConfig 驱动） */
export function setLinkPrefix(prefix) {
  currentPrefix = normalize(prefix);
}

/** 当前生效的文件链接前缀 */
export function getLinkPrefix() {
  return currentPrefix || fallbackPrefix();
}

/**
 * 构造文件外链。
 * @param {string} name File_ID（可带目录层级）
 * @param {string} [ext] 末尾扩展名，可为 '' / '.jpg'（也可不带点）
 * @returns {string} 形如 https://cdn.example.com/file/abc123.jpg
 *
 * ⚠️ `name` 本身**已经带扩展名**时（S3 / WebDAV 上传的 key 例如 `photo.png`），
 *    不再追加 ext —— 否则会拼出 `photo.png.png`。
 */
export function fileLink(name, ext = '') {
  const raw = String(name ?? '');
  const suffix = ext && !String(ext).startsWith('.') ? `.${ext}` : String(ext || '');
  // name 已含扩展名（自带后缀或与目标后缀相同）→ 原样返回
  if (!suffix || /\.[A-Za-z0-9]{1,12}$/.test(raw)) {
    return `${getLinkPrefix()}${encodeURI(raw)}`;
  }
  return `${getLinkPrefix()}${encodeURI(raw)}${suffix}`;
}
