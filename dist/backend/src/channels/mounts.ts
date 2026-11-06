import { promises as fsp, existsSync } from 'fs';
import { backendRoot } from '../common/project-paths';

/**
 * v1.0.1：容器内「已映射路径」清单（本地存储渠道的存储地址下拉）。
 *
 * 为什么需要它：本地存储渠道的「存储地址」如果填入一个**没有映射到宿主机**的容器路径，
 * 文件就只落在容器可写层里 —— 容器一重建（docker compose up --build / 换镜像）
 * 整个目录连同所有实体文件一起消失。所以在 UI 上只允许从「真实映射进来的目录」里选。
 *
 * 数据来源：/proc/self/mountinfo（Linux / 容器内），按挂载点去重后过滤掉
 * 伪文件系统与容器运行时注入的单文件挂载（/etc/hosts、/etc/resolv.conf、/dev/* …）。
 * 非 Linux 环境（本机 Windows 调试）没有 mountinfo —— 退化为
 * 「后端数据目录 + 内置 uploads + 项目根」，至少本地开发时下拉不为空。
 */

/** 不对「用户可见」的伪文件系统挂载点前缀 */
const PSEUDO_PREFIXES = [
  '/proc',
  '/sys',
  '/dev',
  '/run',
  '/etc/hosts',
  '/etc/hostname',
  '/etc/resolv.conf',
  '/etc/localtime',
  '/etc/timezone',
  '/etc/passwd',
  '/etc/group',
  '/etc/shadow',
  '/etc/nsswitch.conf',
];

/** 伪文件系统类型（这些挂载点即使有目录也不是「用于存文件的卷」） */
const PSEUDO_FSTYPES = new Set([
  'proc', 'sysfs', 'devtmpfs', 'devpts', 'tmpfs', 'cgroup', 'cgroup2', 'mqueue',
  'securityfs', 'debugfs', 'tracefs', 'bpf', 'pstore', 'configfs', 'fusectl',
  'nsfs', 'hugetlbfs', 'autofs', 'binfmt_misc',
]);

export interface MountEntry {
  /** 容器内绝对路径 */
  path: string;
  /** 是否可写（W_OK），前端据此给「只读」提示 */
  writable: boolean;
  /** 宿主机来源（bind 挂载的源路径，拿不到则为空） */
  source: string;
}

function isPseudoPath(p: string): boolean {
  return PSEUDO_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`));
}

/** 解析 /proc/self/mountinfo；读不到（非 Linux）返回空数组 */
async function readMountInfo(): Promise<MountEntry[]> {
  const file = '/proc/self/mountinfo';
  if (!existsSync(file)) return [];
  let raw = '';
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    return [];
  }
  const out: MountEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    // 格式：id parent major:minor root mountPoint options [optional...] - fstype source superopts
    const parts = line.split(' ');
    if (parts.length < 7) continue;
    const mountPoint = parts[4];
    const sep = parts.indexOf('-');
    const fstype = sep >= 0 ? parts[sep + 1] || '' : '';
    const source = sep >= 0 ? parts[sep + 2] || '' : '';
    if (!mountPoint || mountPoint === '/') continue;
    if (isPseudoPath(mountPoint)) continue;
    if (PSEUDO_FSTYPES.has(fstype)) continue;
    // overlay / ext4 等根挂载已在上面按 mountPoint === '/' 排除
    out.push({ path: mountPoint, writable: false, source });
  }
  return out;
}

/** 去重 + 补上后端自身的数据目录（容器 / 本机调试都能用） + 探测可写性 */
export async function listContainerMounts(): Promise<MountEntry[]> {
  const seen = new Map<string, MountEntry>();
  const push = (p: string, source = '') => {
    if (!p || p === '/') return;
    const norm = p.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
    if (norm === '/') return;
    if (seen.has(norm)) return;
    seen.set(norm, { path: norm, writable: false, source });
  };

  for (const m of await readMountInfo()) push(m.path, m.source);

  /*
   * 兜底：容器里必定存在的两个数据目录（compose 默认挂 ./data 与 ./data/uploads），
   * 以及后端根目录（本机调试时它就是「已可访问」的目录）。
   * 已存在的目录即使没进 mountinfo（例如直接写在镜像层里）也允许选择 ——
   * 这里不主动加入「不存在」的路径，避免用户选到不存在的目录。
   */
  for (const p of ['/app/data', '/app/backend/uploads']) {
    if (existsSync(p)) push(p);
  }
  const root = backendRoot();
  if (root) push(root);

  const list = Array.from(seen.values());
  for (const m of list) {
    try {
      const st = await fsp.stat(m.path);
      if (!st.isDirectory()) {
        seen.delete(m.path);
        continue;
      }
      await fsp.access(m.path, 2 /* W_OK */);
      m.writable = true;
    } catch {
      // 不可访问 / 不可写：保留但标记只读（部分挂载是只读卷，仍有参考价值）
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.path.localeCompare(b.path));
}
