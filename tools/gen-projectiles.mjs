#!/usr/bin/env node
/**
 * gen-projectiles.mjs — 生成 data/projectiles.json（射弹 ID 表）。
 *
 * 数据来源（Terraria 1.4.5.8 反编译源码）：
 *   TR_SRC / Terraria.ID/ProjectileID.cs -> 射弹 ID ↔ 常量名（0–1135，Count = 1136）
 *
 * 名称不落盘：常量名就是官方本地化的 key（`loc.ProjectileName`，由 tools/gen-data.mjs 生成），
 * 与 items.json / npcs.json / buffs.json 同一套约定。没有本地化名的（多为内部 / 占位 ID）显示内部名。
 *
 * 贴图与帧数不在这里：图标图集由 tools/gen-projectile-atlas.py 负责（它自己解析
 * `Main.projFrames` 取第一帧），本文件只做「ID ↔ 内部名」这一份权威表。
 *
 * 运行：node tools/gen-projectiles.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');

const TR_SRC = process.env.TR_SRC || join(PROJECT, '..', 'tr-code-1458');
const OUT = process.env.OUT || join(PROJECT, 'data', 'projectiles.json');

const read = (p) => readFileSync(p, 'utf8');

function main() {
  const gameVersion = JSON.parse(read(join(PROJECT, 'data', 'meta.json'))).gameVersion;
  const src = read(join(TR_SRC, 'Terraria.ID', 'ProjectileID.cs'));

  // 同一 id 可能有别名（如 `Count` 这类不是实例的常量要单独排除）。
  const byId = new Map();
  for (const m of src.matchAll(/public const (?:short|int)\s+(\w+)\s*=\s*(\d+);/g)) {
    const id = Number(m[2]);
    if (m[1] === 'Count') continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(m[1]);
  }

  const projectiles = [...byId.keys()]
    .sort((a, b) => a - b)
    .map((id) => ({ id, key: byId.get(id)[0] }));

  const payload = {
    meta: {
      gameVersion,
      count: projectiles.length,
      source: 'Terraria.ID/ProjectileID.cs + loc.ProjectileName',
      generatedBy: 'tools/gen-projectiles.mjs',
      note:
        'id 0 = None（不是射弹）。名称为空时显示内部名（约 100 个内部 / 占位 ID 没有官方本地化名）。' +
        ' 图标见 data/projectile-atlas.json（首帧，等比缩进 48px 框）。',
    },
    projectiles,
  };

  writeFileSync(OUT, `${JSON.stringify(payload, null, 1)}\n`, 'utf8');
  console.log(`射弹 ${projectiles.length} 条 -> ${OUT}`);
}

main();
