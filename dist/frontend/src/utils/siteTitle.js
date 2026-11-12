/**
 * v1.1.6：网站标题占位符解析
 *
 * 后台「系统管理 → 网页设置 → 网站标题」现在支持三个占位符（大小写不敏感）：
 *   {host}     —— 当前访问域名，**不带协议头、不带 / 后的路径**（= location.host，含端口）
 *   {user}     —— 当前登录用户名；未登录时该占位符解析为空
 *   {pagename} —— 当前页面名称；未登录时不显示（解析为空）
 *
 * 页面名称映射（与需求一致，未列出的路径回落到「当前标题模板本身之外的默认名」：
 *   /              → 首页
 *   /dashboard     → 图床管理
 *   /localFiles    → 挂载管理
 *   /notes         → 笔记管理
 *   /customerConfig→ 用户管理（含其下所有子路径）
 *   /systemConfig  → 系统管理
 *   /manage/history→ 历史记录（仅登录后显示）
 *
 * 占位符解析为空时会留下多余的分隔符（例如 "{user} · GoHub" 变成 " · GoHub"），
 * 这里统一把首尾多余的分隔符和连续空白收拾掉，避免标题出现 "· GoHub" 这种情况。
 */

/**
 * v1.1.7：后台「网站标题」留空时的默认值 —— 带 {pagename}，
 * 这样默认标题就是「GoHub 首页 / GoHub 图床管理」这种带页面名的形态。
 */
export const DEFAULT_SITE_TITLE = 'GoHub {pagename}';

/** 页面路径 → 页面名称（未登录时 {pagename} 不显示，由调用方传空 user 控制） */
const PAGE_NAMES = {
    '/': '首页',
    '/dashboard': '图床管理',
    '/localFiles': '挂载管理',
    '/notes': '笔记管理',
    '/customerConfig': '用户管理',
    '/systemConfig': '系统管理',
    '/manage/history': '历史记录'
};

/** 取路径对应的页面名（/customerConfig 下的子路径也算「用户管理」） */
function pageNameOf(path) {
    if (PAGE_NAMES[path]) return PAGE_NAMES[path];
    if (path === '/customerConfig' || path.indexOf('/customerConfig/') === 0) return '用户管理';
    return '';
}

/** 去掉末尾斜杠，统一成 PAGE_NAMES 的键形态（兼容 /dashboard/ 这种写法） */
function normalizePath(path) {
    let p = String(path || '/').split('?')[0].split('#')[0];
    if (!p.startsWith('/')) p = `/${p}`;
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p || '/';
}

/** 当前访问域名：只要 host（域名 + 端口），不要协议头与路径 */
function currentHost() {
    if (typeof window === 'undefined') return '';
    return window.location.host || '';
}

/**
 * 解析标题模板
 * @param {string} template 后台配置的原始标题（可能含占位符）
 * @param {{user?: string, path?: string}} ctx 当前用户名（未登录传空）与当前路径
 * @returns {string} 最终写进 document.title 的文本
 */
export function resolveSiteTitle(template, ctx = {}) {
    const raw = String(template || '').trim() || DEFAULT_SITE_TITLE;
    const user = String(ctx.user || '').trim();
    const path = normalizePath(ctx.path);
    // 页面名称只在登录后才显示（需求：{pagename} 只有用户登录后才显示）
    const pageName = user ? pageNameOf(path) : '';

    const values = {
        host: currentHost(),
        user,
        pagename: pageName
    };

    let out = raw.replace(/\{\s*(host|user|pagename)\s*\}/gi, (_m, key) => values[String(key).toLowerCase()] || '');

    /*
     * 清理占位符留空后残留在两端的普通分隔符（- | · — – ~）与多余空格。
     * 循环几次是为了处理 " - {user} - " 这种两端各一个的情况。
     */
    const trimSep = (s) => s.replace(/^[\s\-|·•—–~]+/, '').replace(/[\s\-|·•—–~]+$/, '');
    for (let i = 0; i < 3; i += 1) out = trimSep(out);
    out = out.replace(/\s{2,}/g, ' ').trim();

    // 全被占位符吃掉（例如模板只有 {user} 而没登录）→ 回落到站点默认名
    return out || 'GoHub';
}

export default resolveSiteTitle;
