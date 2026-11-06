import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';

/**
 * 运行时目录定位（v1.6.0 目录重构的核心支撑）。
 *
 * 背景：v1.5.x 及以前，各处用「__dirname + '../../xxx'」硬数层数，
 * 一旦产物位置从 backend/dist 挪到别处（这次挪到 backend/build、再到 dist/backend），
 * 日志就会跑到 dist/logs、.env 就读不到。所以统一改为「按特征文件向上定位」。
 *
 * 约定：**后端根 = 距离当前文件最近、且包含 package.json 的祖先目录**。
 * 这个约定天然适配三种布局，无需任何环境变量：
 *
 *   开发   D:\...\GoHub\debug\backend\build\common\  → 向上 2 层 = debug\backend
 *   生产   D:\...\GoHub\dist\backend\build\common\   → 向上 2 层 = dist\backend
 *   容器   /app/backend/build/common/                    → 向上 2 层 = /app/backend
 *
 * 而前端产物一律位于「后端根的兄弟目录 frontend/app」：
 *   debug\frontend\app、dist\frontend\app、/app/frontend/app
 */
let cachedRoot = '';

/** 后端根目录（含 package.json / prisma / src 的那一层） */
export function backendRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      cachedRoot = dir;
      return dir;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  // 兜底：以启动时的工作目录为准（通常就是 backend/）
  cachedRoot = process.cwd();
  return cachedRoot;
}

/** 后端根下的某个路径 */
export function backendSub(...segments: string[]): string {
  return join(backendRoot(), ...segments);
}

/**
 * 前端产物目录 —— 判定标准是「目录里确实有 index.html」，
 * 避免命中一个空壳目录后 express.static 静默失效（首页 404 的经典成因）。
 */
export function frontendAppDir(): string {
  const root = backendRoot();
  const cwd = process.cwd();
  const candidates = [
    join(root, '..', 'frontend', 'app'), // 标准布局：debug/ 或 dist/ 内与 backend 并列
    join(root, '..', 'frontend'), // 产物直接放在 frontend 根（无 app 子层）
    join(root, '..', '..', 'dist', 'frontend', 'app'), // 从 backend/ 启动时的旧习惯
    join(cwd, 'dist', 'frontend', 'app'),
    join(cwd, '..', 'dist', 'frontend', 'app'),
    join(cwd, 'frontend-dist'), // 兼容 v1.5.x 旧布局
    join(root, '..', 'frontend-dist'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) return resolve(c);
  }
  return '';
}

/** 日志目录：<后端根>/logs */
export function logsDir(): string {
  return backendSub('logs');
}

/** .env 候选路径，按优先级排列 */
export function envCandidates(): string[] {
  return [backendSub('.env'), join(process.cwd(), '.env')];
}
