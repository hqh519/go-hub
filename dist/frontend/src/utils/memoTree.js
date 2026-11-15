/**
 * 目录树组装（v1.3.0）
 * ----------------------------------------------------------------------------
 * 后端返回的是**扁平**列表（id + parentId），因为：
 *   · 排序、移动、改名都只需改一行，扁平结构最简单；
 *   · 树形结构每次读都要递归拼，写的时候还得整棵回写。
 * 展示时才拼成树 —— 这一步放在前端做，后端不必为了渲染而改变存储形态。
 *
 * 不用 el-tree 自带的数据格式转换而是手写：需要处理三类脏数据
 *   · parentId 指向不存在的目录（父目录被删过）→ 当一级目录，不能让它消失；
 *   · 自己指向自己 → 忽略，否则会无限递归；
 *   · 环（A→B→A）→ 遍历时用 visited 拦掉，宁可少显示一个也不能卡死页面。
 */
export function buildTree(folders) {
    const list = (folders || []).map((f) => ({ ...f, children: [] }));
    const byId = new Map(list.map((f) => [f.id, f]));
    const roots = [];
    for (const f of list) {
        const parent = f.parentId ? byId.get(f.parentId) : null;
        if (parent && parent !== f) parent.children.push(f);
        else roots.push(f);
    }
    const sortFn = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name), 'zh');
    const visited = new Set();
    const walk = (arr) => {
        arr.sort(sortFn);
        for (const f of arr) {
            if (visited.has(f.id)) continue;
            visited.add(f.id);
            walk(f.children);
        }
    };
    walk(roots);
    return roots;
}

export default buildTree;
