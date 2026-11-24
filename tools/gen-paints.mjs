#!/usr/bin/env node
/**
 * gen-paints.mjs — 生成 data/paints.json（油漆 / 涂料 ID 表）。
 *
 * 数据来源（Terraria 1.4.5.8 反编译源码，可用 TR_SRC 覆盖）：
 *   1. TR_SRC / Terraria.ID/PaintID.cs         -> 油漆 ID ↔ 常量名
 *   2. TR_SRC / Terraria.ID/PaintCoatingID.cs  -> 涂料 ID ↔ 常量名
 *   3. TR_SRC / Terraria/Item.cs               -> 物品的 `paint` / `paintCoating` 字段（哪种漆对应哪件物品）
 *
 * 为什么分成两组：游戏里是**两套独立的 ID 空间** —— 图格 / 墙上的 `paintColor`（1–30）
 * 与 `paintCoating`（1 夜明 / 2 回声）互不相干，数字会撞车（油漆 1 红漆 vs 涂料 1 夜明涂料）。
 *
 * 为什么 ID 必须有对应物品才收录：`PaintID.IlluminantPaint = 31` 只是 1.4 前的历史别名
 * （`Old_IlluminantPaint`），1.4 起「发光」改成了涂料，没有物品会设置 `paint = 31`；
 * 官方 Wiki 的油漆表也只到 30。跳过的 ID 记进 meta.skipped，不静默丢数据。
 *
 * 名称不落盘：与 items.json / buffs.json 一致，运行期用 `loc.ItemName` 按物品 id 解析。
 *
 * 运行：node tools/gen-paints.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');

const TR_SRC = process.env.TR_SRC || join(PROJECT, '..', 'tr-code-1458');
const OUT = process.env.OUT || join(PROJECT, 'data', 'paints.json');

const read = (p) => readFileSync(p, 'utf8');

/** `public const byte RedPaint = 1;` -> Map(id -> [常量名…])（保留别名，便于发现重复值）。 */
function parseEnumNames(src) {
  const byId = new Map();
  for (const m of src.matchAll(/public const (?:byte|int|short)\s+(\w+)\s*=\s*(\d+);/g)) {
    const id = Number(m[2]);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(m[1]);
  }
  return byId;
}

/**
 * 扫描 `Item.cs` 的 switch：`case <物品 id>:` 块里出现 `paint = N;` / `paintCoating = N;`
 * 就记下「漆种 → 物品 id」。`paint = 0;`（重置字段）在 case 块外，按值过滤掉。
 */
function parseItemPaints(src) {
  const paintOfItem = new Map();
  const coatingOfItem = new Map();
  let itemId = null;
  for (const line of src.split('\n')) {
    const caseMatch = /^\s*case (\d+):\s*$/.exec(line);
    if (caseMatch) {
      itemId = Number(caseMatch[1]);
      continue;
    }
    if (itemId == null) continue;
    const paint = /^\s*paint = (\d+);\s*$/.exec(line);
    if (paint) {
      const id = Number(paint[1]);
      if (id > 0) paintOfItem.set(id, itemId);
      continue;
    }
    const coating = /^\s*paintCoating = (\d+);\s*$/.exec(line);
    if (coating) {
      const id = Number(coating[1]);
      if (id > 0) coatingOfItem.set(id, itemId);
    }
  }
  return { paintOfItem, coatingOfItem };
}

function main() {
  const gameVersion = JSON.parse(read(join(PROJECT, 'data', 'meta.json'))).gameVersion;

  const paintNames = parseEnumNames(read(join(TR_SRC, 'Terraria.ID', 'PaintID.cs')));
  const coatingNames = parseEnumNames(read(join(TR_SRC, 'Terraria.ID', 'PaintCoatingID.cs')));
  const { paintOfItem, coatingOfItem } = parseItemPaints(read(join(TR_SRC, 'Terraria', 'Item.cs')));

  const build = (names, itemOf) => {
    const entries = [];
    const skipped = [];
    const id0 = [];
    for (const id of [...names.keys()].sort((a, b) => a - b)) {
      // 0 = None（不上漆），不是一种漆。
      if (id === 0) {
        id0.push(...names.get(id));
        continue;
      }
      const item = itemOf.get(id);
      if (item == null) {
        skipped.push({ id, key: names.get(id)[0] });
        continue;
      }
      entries.push({ id, key: names.get(id)[0], item });
    }
    return { entries, skipped, id0 };
  };

  const paint = build(paintNames, paintOfItem);
  const coating = build(coatingNames, coatingOfItem);

  const payload = {
    meta: {
      gameVersion,
      count: paint.entries.length + coating.entries.length,
      paintCount: paint.entries.length,
      coatingCount: coating.entries.length,
      source:
        'Terraria.ID/PaintID.cs + PaintCoatingID.cs（常量名）+ Terraria/Item.cs（item.paint / item.paintCoating → 物品 id）',
      generatedBy: 'tools/gen-paints.mjs',
      // 别名 / 跳过项都写清楚，避免以后有人以为漏了数据。
      skipped: paint.skipped,
      none: { paint: paint.id0, coating: coating.id0 },
      note:
        'group = paint（油漆，图格/墙的 paintColor）| coating（涂料，paintCoating）；两套 ID 空间互不相干、数字会重复。' +
        ' item = 该漆对应的物品 id（名称 / 图标都用它，运行期取 loc.ItemName）。' +
        ' 没有对应物品的 ID（如 PaintID.IlluminantPaint = 31，1.4 起改为「夜明涂料」）记在 meta.skipped。',
    },
    entries: [
      ...paint.entries.map((e) => ({ id: e.id, group: 'paint', key: e.key, item: e.item })),
      ...coating.entries.map((e) => ({ id: e.id, group: 'coating', key: e.key, item: e.item })),
    ],
  };

  writeFileSync(OUT, `${JSON.stringify(payload, null, 1)}\n`, 'utf8');
  const skippedNote = payload.meta.skipped.length
    ? `，跳过无物品的 ${payload.meta.skipped.map((s) => `${s.id}(${s.key})`).join(' ')}`
    : '';
  console.log(
    `油漆 ${paint.entries.length} 条 / 涂料 ${coating.entries.length} 条${skippedNote} -> ${OUT}`,
  );
}

main();
