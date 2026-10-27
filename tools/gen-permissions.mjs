#!/usr/bin/env node
/**
 * gen-permissions.mjs —— 生成 `data/permissions.json`（权限节点 + TShock 默认用户组名）。
 *
 * 数据来源（都从 **TShock 源码**直接抽取，不手抄、可重复生成）：
 *   - 权限节点：`TShockAPI/Permissions.cs` 里所有
 *     `public static readonly string xxx = "tshock.…";`，连同紧邻的 `[Description("…")]`
 *     （TShock 就是用这个注解当「可读说明」，比我们另写一份描述更不容易漂）。
 *   - 默认用户组：`TShockAPI/DB/GroupManager.cs` 里的 `AddDefaultGroup("名字", …)`，
 *     外加 `TShockConfig.cs` 的 `DefaultGuestGroupName = "guest"` / `DefaultRegistrationGroupName = "default"`
 *     （这两个是配置项默认值，所以按名字抽常量）。
 *
 * 为什么只做「默认/内置」集合：真正的用户组与自定义权限节点只有服务器运行期才知道，
 * 我们的信使插件**故意不提供**（避免泄露权限结构）。所以补全给的是「常用集合」，
 * 界面上也要能接受用户手输任意值 —— 这只影响候选项，不影响执行。
 *
 * 运行：
 *   TSHOCK_SRC=../TShock node tools/gen-permissions.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TSHOCK_SRC = process.env.TSHOCK_SRC || join(HERE, '..', '..', 'TShock');
const OUT = process.env.OUT || join(HERE, '..', 'data', 'permissions.json');

const read = (rel) => readFileSync(join(TSHOCK_SRC, rel), 'utf8');

/**
 * 权限节点来自两个文件（都在 TShockAPI 里，缺一不可）：
 *   - `TShockAPI/Permissions.cs`：核心节点（`public static readonly string` + `[Description]`）
 *   - `TShockAPI/Rest/RestPermissions.cs`：REST 模块的节点（`public const string`，含 `tshock.rest.useapi/.command`）
 */
function collectPermissions() {
  const src = [read('TShockAPI/Permissions.cs'), read('TShockAPI/Rest/RestPermissions.cs')].join('\n');
  const out = [];
  // 逐行扫，记住最近一个 Description 注解（TShock 里注解就在常量上一行）
  let pendingDesc = null;
  for (const line of src.split('\n')) {
    const desc = /\[Description\("((?:[^"\\]|\\.)*)"\)\]/.exec(line);
    if (desc) {
      pendingDesc = desc[1].replace(/\\"/g, '"').trim();
      continue;
    }
    const decl = /public (?:static readonly|const) string\s+\w+\s*=\s*"([^"]+)"/.exec(line);
    if (decl) {
      out.push({ node: decl[1], desc: pendingDesc ?? '' });
      pendingDesc = null;
      continue;
    }
    if (line.trim() !== '' && !line.trim().startsWith('//')) pendingDesc = pendingDesc && line.trim() === '' ? null : pendingDesc;
  }
  // 去重（源码里可能有别名指向同一节点），保持稳定顺序
  const seen = new Set();
  return out.filter((p) => {
    if (seen.has(p.node)) return false;
    seen.add(p.node);
    return true;
  });
}

/** 默认用户组：`AddDefaultGroup("name", …)` + 两个配置项默认值 */
function collectGroups() {
  const src = read('TShockAPI/DB/GroupManager.cs');
  const cfg = read('TShockAPI/Configuration/TShockConfig.cs');
  const groups = new Set();
  for (const m of src.matchAll(/AddDefaultGroup\(\s*"([^"]+)"/g)) groups.add(m[1]);
  for (const [field, fallback] of [
    ['DefaultGuestGroupName', 'guest'],
    ['DefaultRegistrationGroupName', 'default'],
  ]) {
    const m = new RegExp(`${field}\\s*=\\s*"([^"]+)"`).exec(cfg);
    groups.add(m ? m[1] : fallback);
  }
  return [...groups].sort();
}

const permissions = collectPermissions();
const groups = collectGroups();

if (permissions.length === 0) {
  throw new Error(`没从 ${TSHOCK_SRC} 抽到权限节点（路径对吗？用 TSHOCK_SRC 指定 TShock 源码目录）`);
}

const payload = {
  meta: {
    tshockVersion: (() => {
      try {
        const csproj = read('TShockAPI/TShockAPI.csproj');
        const m = /<Version>([^<]+)<\/Version>/.exec(csproj);
        return m ? m[1] : 'unknown';
      } catch {
        return 'unknown';
      }
    })(),
    permissionCount: permissions.length,
    groupCount: groups.length,
    source:
      'TShockAPI/Permissions.cs + TShockAPI/Rest/RestPermissions.cs（含注解 [Description]）、' +
      'TShockAPI/DB/GroupManager.cs、TShockAPI/Configuration/TShockConfig.cs',
    generatedBy: 'tools/gen-permissions.mjs',
    note: '只是「内置 / 默认」集合：自定义组与插件权限节点只有服务器运行期知道，补全给候选项但允许手输任意值',
  },
  permissions,
  groups,
};

writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
console.log(`[permissions] ${permissions.length} nodes, ${groups.length} groups -> ${OUT}`);
