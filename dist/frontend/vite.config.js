import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { fileURLToPath, URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 构建清理插件：保证产物目录不残留上一轮的旧哈希 chunk。
 *
 * 设计要点（踩过的坑）：
 * 1) 产物路径必须通过 configResolved 从【已解析的 config】计算，
 *    不能用 import.meta.url —— Vite 会先把 vite.config.js bundle 成临时文件再 import，
 *    此时 import.meta.url 指向临时文件，`new URL('./..')` 会算错目录，
 *    导致 existsSync 为 false、清理静默失效（旧哈希 chunk 长期堆积）。
 * 2) 不能在构建前清空整个目录 —— 本机宿主有 safe-delete 批量删除守卫，
 *    大批量删除会被拦截/中断（`SAFE_DELETE_BULK_GUARD_ERROR`），
 *    而 try/catch 会把错误吞掉，表现为「看起来成功、其实什么都没删」。
 * 3) 不能用 mtime 判断「本轮是否重新生成」—— Vite 的 copyPublicDir 在
 *    目标文件已存在时会【跳过拷贝】，public/ 下的字体、图片等 mtime 永远是旧的，
 *    按时间删会误删真实资源。
 *
 * 因此采用【保留集求差】：保留集 = 本轮 Rollup 实际生成的产物（writeBundle 的
 * bundle 清单）+ public/ 目录当前内容；删除「构建前存在但不在保留集」的文件，
 * 即本轮没有重新生成的遗留产物。删除量很小（几个文件），不触发批量守卫。
 */
function cleanOutDirPlugin() {
  let outDir = '';
  let publicDir = '';
  let before = null;
  const generated = new Set();

  const snapshot = (dir) => {
    const set = new Set();
    const walk = (d, rel) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path.join(d, entry.name), childRel);
        else set.add(childRel);
      }
    };
    if (fs.existsSync(dir)) walk(dir, '');
    return set;
  };

  return {
    name: 'GoHub-clean-outdir',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      publicDir = config.publicDir || path.resolve(config.root, 'public');
    },
    buildStart() {
      before = snapshot(outDir);
    },
    writeBundle(_options, bundle) {
      for (const key of Object.keys(bundle)) generated.add(key);
    },
    closeBundle() {
      if (!outDir || !before || !fs.existsSync(outDir)) return;
      // 保留集 = 本轮生成的产物 + public/ 当前内容
      const keep = new Set(generated);
      for (const rel of snapshot(publicDir)) keep.add(rel);

      let removed = 0;
      for (const rel of before) {
        if (keep.has(rel)) continue; // 本轮生成或来自 public → 保留
        try { fs.unlinkSync(path.join(outDir, rel)); removed++; } catch { /* ignore */ }
      }
      // 顺带回收因此变空的目录（非空会报错，忽略即可）
      const prune = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const p = path.join(dir, entry.name);
          prune(p);
          try { fs.rmdirSync(p); } catch { /* ignore */ }
        }
      };
      try { prune(outDir); } catch { /* ignore */ }
      if (removed) {
        // eslint-disable-next-line no-console
        console.log(`[clean-outdir] 已清理 ${removed} 个上一轮遗留产物`);
      }
    },
  };
}

// GoHub 前端构建配置
// 说明：前端请求统一使用 /api 前缀（与后端真实路径一致），
// 开发期由 Vite dev server 代理到后端 3619，生产期与后端同源部署，无需代理。
export default defineConfig({
  plugins: [
    cleanOutDirPlugin(),
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3619',
      '/upload': 'http://localhost:3619',
      '/file': 'http://localhost:3619',
      '/random': 'http://localhost:3619',
      '/dav': 'http://localhost:3619',
    },
  },
  build: {
    // 产物输出到本目录下的 app/。
    //
    // 这样 design 的好处（v1.6.0 目录重构）：
    // 1) debug/frontend 与 dist/frontend 使用【完全相同的配置】，
    //    两边都能独立 `npm run build`，不需要环境变量或路径替换；
    // 2) 产物（index.html + assets/）与源码（src/ + index.html 模板 + package.json）
    //    不会互相覆盖 —— Vite 的源入口 index.html 在根，产物入口在 app/index.html；
    // 3) 后端只需托管 <frontend>/app 这一个目录，路径稳定。
    outDir: './app',
    // 由 cleanOutDirPlugin 负责清理，这里关闭 Vite 自带的整目录删除
    emptyOutDir: false,
    chunkSizeWarningLimit: 2000,
    /*
     * v3.0.0（R19）：把「每个页面都要用」的三大件拆成独立 vendor chunk。
     * 目的：业务代码改动时（文件名哈希变化）用户不必重新下载 element-plus / 图标库，
     * 首屏也只多一个并行请求，不会把按需加载的重型库（pdf / xlsx 等）提前打进首屏 ——
     * 因此这里只覆盖确定「入口必用」的三个包，其余保持 Vite 默认分包。
     */
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/node_modules[/\\](element-plus|@element-plus)[/\\]/.test(id)) return 'vendor-element';
          if (/node_modules[/\\]@fortawesome[/\\]/.test(id)) return 'vendor-icons';
          if (/node_modules[/\\](vue|vue-router|vuex|vue-i18n|@vue)[/\\]/.test(id)) return 'vendor-vue';
          return;
        },
      },
    },
  },
});
