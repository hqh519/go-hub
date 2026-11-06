/**
 * 极简 .env 加载器（零依赖）。
 *
 * 为什么需要它：
 *   项目没有引入 dotenv，而 NestJS 的 ConfigModule 也未启用 ——
 *   此前 `process.env.ADMIN_PASSWORD` 等只能靠「代码里的默认值」生效，
 *   用户在 backend/.env 中修改的密码、授权码、限流开关实际上【不会生效】。
 *   （DATABASE_URL 之所以看起来正常，是因为 Prisma Client 内置了 dotenv 自动加载。）
 *
 * 优先级约定（与 Docker/生产环境习惯一致）：
 *   真实环境变量 > backend/.env 文件 > 代码内默认值
 *   即：只有当 process.env 中尚未定义该键时才写入，绝不覆盖已有值。
 *
 * 本模块是「副作用模块」，必须在 main.ts 中【最先导入】，
 * 以保证它先于 PrismaClient 的构造执行（Prisma 构造时就会读取 DATABASE_URL）。
 *
 * 用途分工：
 *   - backend/.env  → 本地开发 / 非容器部署（本文件负责加载）
 *   - 项目根 .env   → docker compose 变量替换（由 compose 自己读取，与本文件无关）
 */

import { existsSync, readFileSync } from 'fs';
import { envCandidates } from './project-paths';

/** 解析 .env 文本：支持 # 注释、KEY=VALUE、两侧引号、值内含 = 的情况 */
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnvFile(): void {
  // v1.6.0 起统一由 project-paths 定位「后端根」（按 package.json 向上查找），
  // 因此 debug/backend/.env、dist/backend/.env、容器 /app/backend/.env 都能命中，
  // 不再依赖「__dirname 向上数几层」这种一挪目录就失效的写法。
  const candidates = envCandidates();
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const vars = parseEnv(readFileSync(file, 'utf8'));
      let applied = 0;
      for (const [k, v] of Object.entries(vars)) {
        if (process.env[k] === undefined) {
          process.env[k] = v;
          applied += 1;
        }
      }
      // 只在真正加载到内容时打印一次，便于排查「改了 .env 没生效」类问题
      if (applied > 0) console.log(`[env] 已从 ${file} 载入 ${applied} 个变量`);
      return;
    } catch (err) {
      console.warn(`[env] 读取 ${file} 失败：${(err as Error).message}`);
    }
  }
}

loadEnvFile();

export {};
