/**
 * 笔记（memo）接口封装（v1.3.0）
 * ----------------------------------------------------------------------------
 * 统一走 `/api/memo`，与瞬间的 `/api/notes` 分开 ——
 * 两套接口的入参形态差别很大（瞬间是"发布一条动态"，笔记是"文档 + 目录树"），
 * 硬塞进一套路由会让参数校验变成一堆 if。
 *
 * 所有方法都返回后端 data 字段（已剥掉 `{success:true}`），失败抛 Error；
 * 版本冲突单独抛一个带 `conflict = true` 的错误，方便调用方弹专用提示。
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
export function memoError(e) {
  const body = e?.response?.data;
  if (body?.message) {
    const err = new Error(body.message);
    err.conflict = !!body.conflict;
    err.version = body.version;
    return err;
  }
  return e instanceof Error ? e : new Error(String(e || '请求失败'));
}

/** 实例参数：与项目其它模块同一口径，空 = 默认实例 */
let currentInstanceId = '';
export function setMemoInstance(id) {
  currentInstanceId = String(id || '');
}
function inst() {
  return currentInstanceId;
}

// -------- 目录 --------

export async function fetchFolders() {
  const res = await axios.get('/api/memo/folders', { params: { instanceId: inst() } });
  return unwrap(res);
}

export async function createFolder({ name, parentId = '' }) {
  const res = await axios.post('/api/memo/folders', { name, parentId, instanceId: inst() });
  return unwrap(res);
}

export async function updateFolder(id, patch) {
  const res = await axios.put(`/api/memo/folders/${encodeURIComponent(id)}`, { ...patch, instanceId: inst() });
  return unwrap(res);
}

export async function deleteFolder(id) {
  const res = await axios.delete(`/api/memo/folders/${encodeURIComponent(id)}`, { params: { instanceId: inst() } });
  return unwrap(res);
}

export async function reorderFolders(parentId, ids) {
  const res = await axios.post('/api/memo/folders/reorder', { parentId, ids, instanceId: inst() });
  return unwrap(res);
}

// -------- 笔记 --------

export async function fetchNotes(params = {}) {
  const res = await axios.get('/api/memo/list', { params: { ...params, instanceId: inst() } });
  return unwrap(res);
}

export async function fetchNote(id) {
  const res = await axios.get(`/api/memo/${encodeURIComponent(id)}`, { params: { instanceId: inst() } });
  return unwrap(res);
}

export async function createNote({ title = '', content = '', folderId = '' }) {
  const res = await axios.post('/api/memo', { title, content, folderId, instanceId: inst() });
  return unwrap(res);
}

export async function saveNote(id, { title, content, folderId, version }) {
  try {
    const res = await axios.put(`/api/memo/${encodeURIComponent(id)}`, {
      title,
      content,
      folderId,
      version,
      instanceId: inst(),
    });
    return unwrap(res);
  } catch (e) {
    throw memoError(e);
  }
}

export async function moveNote(id, folderId) {
  const res = await axios.post(`/api/memo/${encodeURIComponent(id)}/move`, { folderId, instanceId: inst() });
  return unwrap(res);
}

export async function trashNote(id) {
  const res = await axios.delete(`/api/memo/${encodeURIComponent(id)}`, { params: { instanceId: inst() } });
  return unwrap(res);
}

export async function restoreNote(id) {
  const res = await axios.post(`/api/memo/${encodeURIComponent(id)}/restore`, { instanceId: inst() });
  return unwrap(res);
}

export async function purgeNote(id) {
  const res = await axios.delete(`/api/memo/${encodeURIComponent(id)}/purge`, { params: { instanceId: inst() } });
  return unwrap(res);
}

/* ── v1.3.1：块索引与引用（对应 v1.5.0 计划） ───────────────── */

/** 某篇笔记的块列表（按阅读顺序，不含正文） */
export async function fetchNoteBlocks(id) {
  const res = await axios.get(`/api/memo/${encodeURIComponent(id)}/blocks`, { params: { instanceId: inst() } });
  return unwrap(res);
}

/** 按块 ID 跨笔记定位（引用块渲染、悬停预览用） */
export async function resolveBlock(blockId) {
  const res = await axios.get('/api/memo/blocks/resolve', { params: { blockId, instanceId: inst() } });
  return unwrap(res);
}

/** 反向链接：哪些笔记引用了本篇 */
export async function fetchBacklinks(id) {
  const res = await axios.get(`/api/memo/${encodeURIComponent(id)}/backlinks`, { params: { instanceId: inst() } });
  return unwrap(res);
}

/** 重解析本篇块索引（改了源码模式之后可手动触发） */
export async function rebuildIndex(id) {
  const res = await axios.post(`/api/memo/${encodeURIComponent(id)}/rebuild-index`, { instanceId: inst() });
  return unwrap(res);
}

/* ── v1.3.1.1：历史快照 ──────────────────────────────────────── */

/** 追加一条历史快照（服务端会跳过「与上一条相同」和空内容） */
export async function pushNoteHistory(id, payload = {}) {
  const res = await axios.post(`/api/memo/${encodeURIComponent(id)}/history`, {
    instanceId: inst(),
    ...payload,
  });
  return unwrap(res);
}

/** 历史列表（不含正文） */
export async function fetchNoteHistory(id) {
  const res = await axios.get(`/api/memo/${encodeURIComponent(id)}/history`, { params: { instanceId: inst() } });
  return unwrap(res);
}

/** 单条历史详情（含正文） */
export async function fetchNoteHistoryItem(id, hid) {
  const res = await axios.get(`/api/memo/${encodeURIComponent(id)}/history/${encodeURIComponent(hid)}`, {
    params: { instanceId: inst() },
  });
  return unwrap(res);
}

/** 恢复到某一版（服务端会先把当前内容存一条历史） */
export async function restoreNoteHistory(id, hid) {
  const res = await axios.post(`/api/memo/${encodeURIComponent(id)}/history/${encodeURIComponent(hid)}/restore`, {
    instanceId: inst(),
  });
  return unwrap(res);
}

/* ── v1.3.1.1：笔记标签 ─────────────────────────────────────── */

/** 本篇标签 */
export async function fetchNoteTags(id) {
  const res = await axios.get(`/api/memo/${encodeURIComponent(id)}/tags`, { params: { instanceId: inst() } });
  return unwrap(res);
}

/** 覆盖式保存标签（传名字数组） */
export async function saveNoteTags(id, tagNames) {
  const res = await axios.put(`/api/memo/${encodeURIComponent(id)}/tags`, {
    instanceId: inst(),
    tagNames,
  });
  return unwrap(res);
}

/** 标签候选（输入即查，按用户 + 实例隔离） */
export async function fetchTagCandidates(keyword = '') {
  const res = await axios.get('/api/memo/tags/candidates', {
    params: { keyword, instanceId: inst() },
  });
  return unwrap(res);
}
