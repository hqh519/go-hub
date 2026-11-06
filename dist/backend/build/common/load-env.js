"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const project_paths_1 = require("./project-paths");
function parseEnv(text) {
    const out = {};
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#'))
            continue;
        const eq = line.indexOf('=');
        if (eq <= 0)
            continue;
        const key = line.slice(0, eq).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
            continue;
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
            (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
            value = value.slice(1, -1);
        }
        out[key] = value;
    }
    return out;
}
function loadEnvFile() {
    const candidates = (0, project_paths_1.envCandidates)();
    for (const file of candidates) {
        if (!(0, fs_1.existsSync)(file))
            continue;
        try {
            const vars = parseEnv((0, fs_1.readFileSync)(file, 'utf8'));
            let applied = 0;
            for (const [k, v] of Object.entries(vars)) {
                if (process.env[k] === undefined) {
                    process.env[k] = v;
                    applied += 1;
                }
            }
            if (applied > 0)
                console.log(`[env] 已从 ${file} 载入 ${applied} 个变量`);
            return;
        }
        catch (err) {
            console.warn(`[env] 读取 ${file} 失败：${err.message}`);
        }
    }
}
loadEnvFile();
