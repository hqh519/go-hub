/**
 * 文章板块接口封装（v1.4.0）
 * ----------------------------------------------------------------------------
 * 统一走 `/api/article`。文章（article）/ 待办（todo）/ 导航（nav）共用一套接口，
 * 靠 `type` 参数区分 —— 三种类型的字段与流程完全一致，没有必要写三套。
 *
 * 与 memoApi 一样：返回后端 data 字段（已剥掉 `{success:true}`），失败抛 Error；
 * 版本冲突单独抛一个带 `conflict = true` 的错误，调用方可以弹「覆盖 / 放弃」。
 */
import axios from '@/utils/axios';

const unwrap = (res) => {
  const body = res?.data ?? {};
  if (!body.success) {
    const err = new Error(body.message || '请求失败');
    err.conflict = !!body.conflict;
    err.version = body.version;
    throw err;
  }
  return body.data;
};

/** 统一错误提取（axios 的 4xx 也走这里，message 取后端的） */
export function articleError(e) {
  const body = e?.response?.data;
  if (body?.message) {
    const err = new Error(body.message);
    err.conflict = !!body.conflict;
    err.version = body.version;
    return err;
  }
  return e instanceof Error ? e : new Error(String(e || '请求失败'));
}

/**
 * 实例 id：与记事页同一口径。
 * 取值优先读「切换实例」写进 localStorage 的那一个，不依赖组件挂载顺序。
 */
let currentInstanceId = null;
export function setArticleInstance(id) {
  currentInstanceId = String(id ?? '');
}
function inst() {
  if (currentInstanceId !== null) return currentInstanceId;
  try {
    return localStorage.getItem('gohub_instance_id') || '';
  } catch (e) {
    return '';
  }
}

/* ── 分类目录 ───────────────────────────────────────────── */

export async function fetchFolders(type = 'article') {
  const res = await axios.get('/api/article/folders', { params: { instanceId: inst(), type } });
  return unwrap(res);
}

export async function createFolder(payload) {
  const res = await axios.post('/api/article/folders', { ...payload, instanceId: inst() });
  return unwrap(res);
}

export async function updateFolder(id, payload) {
  const res = await axios.put(`/api/article/folders/${encodeURIComponent(id)}`, { ...payload, instanceId: inst() });
  return unwrap(res);
}

export async function deleteFolder(id, type = 'article') {
  const res = await axios.delete(`/api/article/folders/${encodeURIComponent(id)}`, { params: { instanceId: inst(), type } });
  return unwrap(res);
}

export async function reorderFolders(payload) {
  const res = await axios.post('/api/article/folders/reorder', { ...payload, instanceId: inst() });
  return unwrap(res);
}

/* ── 文章 ───────────────────────────────────────────────── */

export async function fetchArticles(params = {}) {
  const res = await axios.get('/api/article/list', { params: { ...params, instanceId: inst() } });
  return unwrap(res);
}

export async function fetchArticle(id) {
  const res = await axios.get(`/api/article/${encodeURIComponent(id)}`, { params: { instanceId: inst() } });
  return unwrap(res);
}

export async function createArticle(payload = {}) {
  const res = await axios.post('/api/article', { ...payload, instanceId: inst() });
  return unwrap(res);
}

export async function updateArticle(id, payload = {}) {
  const res = await axios.put(`/api/article/${encodeURIComponent(id)}`, { ...payload, instanceId: inst() });
  return unwrap(res);
}

export async function saveArticleTabs(id, payload = {}) {
  const res = await axios.put(`/api/article/${encodeURIComponent(id)}/tabs`, { ...payload, instanceId: inst() });
  return unwrap(res);
}

export async function saveArticleTags(id, names = []) {
  const res = await axios.post(`/api/article/${encodeURIComponent(id)}/tags`, { names, instanceId: inst() });
  return unwrap(res);
}

export async function fetchArticleTagCandidates(type = 'article') {
  const res = await axios.get('/api/article/tags', { params: { instanceId: inst(), type } });
  return unwrap(res);
}

export async function deleteArticle(id) {
  const res = await axios.delete(`/api/article/${encodeURIComponent(id)}`, { params: { instanceId: inst() } });
  return unwrap(res);
}

export async function restoreArticle(id) {
  const res = await axios.post(`/api/article/${encodeURIComponent(id)}/restore`, { instanceId: inst() });
  return unwrap(res);
}

export async function purgeArticle(id) {
  const res = await axios.delete(`/api/article/${encodeURIComponent(id)}/purge`, { params: { instanceId: inst() } });
  return unwrap(res);
}

/**
 * 给 MemoEditor 用的适配器（v1.4.0）。
 *
 * 编辑器的保存语义是「保存这一篇的正文」，落到文章板块就是「保存当前页签」：
 *   · 传进来的 title 忽略 —— 文章标题由编辑页的标题模块单独保存，
 *     编辑器里的正文保存绝不能顺手把标题改掉；
 *   · 保存成功后把最新版本号 / 字数 / 待办统计回传，页面同步到侧栏。
 *
 * @param {{ id: string, tabs: Array, version: number, tabIndex: number }} ctx
 */
export function editorApiFor(ctx) {
  return {
    // 文章本期没有块索引与历史快照，编辑器里对应的两块直接关掉
    backlinks: false,
    history: false,
    async saveNote(_id, payload) {
      const tabs = ctx.tabs.map((t, i) => ({
        id: t.id || '',
        title: t.title || '',
        // 当前正在编辑的那个页签用编辑器里的最新正文，其余页签原样提交
        content: i === ctx.tabIndex ? String(payload?.content ?? '') : String(t.content || ''),
      }));
      const r = await saveArticleTabs(ctx.id, { tabs, version: ctx.version });
      if (r && Array.isArray(r.tabs)) {
        ctx.tabs = r.tabs;
        // 编辑器挂的是同一批对象，回填 id 后才能继续保存（否则每次都会新建页签）
        ctx.onTabs?.(r.tabs);
      }
      return { version: r?.version, updatedAt: r?.updatedAt, ...r };
    },
    async fetchNoteTags() {
      const a = await fetchArticle(ctx.id);
      return { tags: (a?.tags || []).map((name) => ({ name })) };
    },
    async saveNoteTags(_id, names) {
      const r = await saveArticleTags(ctx.id, names);
      return { tags: (r?.tags || []).map((name) => ({ name })) };
    },
  };
}
