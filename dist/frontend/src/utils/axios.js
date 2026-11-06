import axios from 'axios';

// 创建 axios 实例
// GoHub：前端统一使用 /api 前缀（与后端真实路径一致）。
// 开发期由 Vite dev server 代理转发到后端，生产期与后端同源，baseURL 均为 '/'
const instance = axios.create({
  baseURL: '/',
  withCredentials: true, // 始终携带 Cookie（HttpOnly session cookie）
});

export default instance;
