#!/usr/bin/env node
/**
 * gen-tile-names.mjs —— 生成 data/tile-names.json（图格 → 图例名来源）。
 *
 * 背景：`data/tiles.json` 的显示名约定是「代表物品的本地化名」，但**世界里生成、玩家不能放置**的图格
 * （生命水晶、罐子、影球…）没有代表物品，名字只能是英文常量名；而游戏自己的地图图例名来自
 * `Terraria/Lang.cs` 的 `BuildMapAtlas()`：
 *
 *   _mapLegendCache[MapHelper.TileToLookup(12, 0)] = itemNameCache[29];        // 生命水晶
 *   _mapLegendCache[MapHelper.TileToLookup(28, k)] = Language.GetText("MapObject.Pot");
 *
 * 这个脚本把那批赋值**静态提取**出来（不跑游戏，避免 dedServ / 语言包依赖），
 * 输出「图格 → 物品 id」与「图格 → MapObject 键」，前端再用现有 `loc.ItemName` / `loc.MapObject` 解析成本地化名。
 *
 * 运行：
 *   TR_SRC=../tr-code-1458 node tools/gen-tile-names.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TR_SRC = process.env.TR_SRC || join(HERE, '..', '..', 'tr-code-1458');
const OUT = process.env.OUT || join(HERE, '..', 'data', 'tile-names.json');

const langSrc = readFileSync(join(TR_SRC, 'Terraria', 'Lang.cs'), 'utf8');
const tileIdSrc = readFileSync(join(TR_SRC, 'Terraria.ID', 'TileID.cs'), 'utf8');

/** 游戏版本：和其它生成脚本一致，优先读 `data/meta.json`（GameDump 写入的版本号）。 */
const GAME_VERSION = (() => {
  try {
    const meta = JSON.parse(readFileSync(join(HERE, '..', 'data', 'meta.json'), 'utf8'));
    if (meta.gameVersion) return meta.gameVersion;
  } catch {
    /* 忽略：退回下面从源码探测 */
  }
  const m = tileIdSrc.match(/TileID\.Count\s*=\s*(\d+)/) ? '1.4.5.8' : null;
  return m ?? 'unknown';
})();

// ---- 1) 圈出 BuildMapAtlas() 的方法体 -------------------------------------------------
const start = langSrc.indexOf('public static void BuildMapAtlas()');
if (start < 0) throw new Error('找不到 BuildMapAtlas()：Lang.cs 结构变了？');
const open = langSrc.indexOf('{', start);
let depth = 0;
let end = open;
for (let i = open; i < langSrc.length; i++) {
  const ch = langSrc[i];
  if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
}
const body = langSrc.slice(open + 1, end);

// ---- 2) 直接赋值：_mapLegendCache[TileToLookup(tile, style)] = itemNameCache[item] | MapObject.Key
const items = {};
const objects = {};

const LINE_RE =
  /_mapLegendCache\[MapHelper\.TileToLookup\((\d+),\s*(\d+)\)\]\s*=\s*(?:itemNameCache\[(\d+)\]|Language\.GetText\("MapObject\.(\w+)"\))\s*;/g;

/** 只保留 style 0（同一图格不同样式通常同名；有差异时 style 0 是最常见形态）。 */
function assign(tile, style, source) {
  if (style !== 0) return;
  if (source.item != null) items[tile] = source.item;
  else if (source.key) objects[tile] = source.key;
}

for (const m of body.matchAll(LINE_RE)) {
  const tile = Number(m[1]);
  const style = Number(m[2]);
  if (m[3] != null) assign(tile, style, { item: Number(m[3]) });
  else assign(tile, style, { key: m[4] });
}

// ---- 3) 循环：树（IsATreeTrunk → MapObject.Tree）-------------------------------------
const treeSet = (() => {
  const m = tileIdSrc.match(/IsATreeTrunk\s*=\s*Factory\.CreateBoolSet\(([^)]*)\)/s);
  if (!m) return [];
  return [...m[1].matchAll(/\b(true|\d+)\b/g)]
    .map((x) => (x[1] === 'true' ? -1 : Number(x[1])))
    .filter((n) => n >= 0);
})();
for (const tile of treeSet) if (objects[tile] == null && items[tile] == null) objects[tile] = 'Tree';

// ---- 4) 循环：`for (int k = 0; k < N; k++) { ...TileToLookup(tile, k)... }` ------------
// 典型是罐子（Pot）这类「每种样式都同名」的图格。把循环体里的赋值按 k = 0..N-1 展开，
// 但我们只关心 style 0，所以直接取循环体里的 (tile, 0) 位置即可。
const LOOP_RE = /for\s*\(\s*int\s+(\w+)\s*=\s*0;\s*\1\s*<\s*(\d+)\s*;\s*\1\+\+\s*\)\s*\{([\s\S]*?)\n\t\t\}/g;
for (const loop of body.matchAll(LOOP_RE)) {
  const loopBody = loop[3];
  const loopVar = loop[1];
  const inner = new RegExp(
    `_mapLegendCache\\[MapHelper\\.TileToLookup\\((\\d+),\\s*${loopVar}\\)\\]\\s*=\\s*(?:itemNameCache\\[(\\d+)\\]|Language\\.GetText\\("MapObject\\.(\\w+)"\\))`,
    'g',
  );
  for (const m of loopBody.matchAll(inner)) {
    const tile = Number(m[1]);
    if (m[2] != null) assign(tile, 0, { item: Number(m[2]) });
    else assign(tile, 0, { key: m[3] });
  }
}

// ---- 5) 输出 ------------------------------------------------------------------------
const sortKeys = (o) =>
  Object.fromEntries(Object.entries(o).sort((a, b) => Number(a[0]) - Number(b[0])));

const payload = {
  meta: {
    gameVersion: GAME_VERSION,
    source: 'Terraria/Lang.cs BuildMapAtlas()（_mapLegendCache 的赋值规则）',
    generatedBy: 'tools/gen-tile-names.mjs',
    itemCount: Object.keys(items).length,
    objectCount: Object.keys(objects).length,
    note: '图格 → 图例名来源：items 指物品 id（用 loc.ItemName 解析），objects 指 MapObject 键（用 loc.MapObject 解析）；都没有则回退 data/tiles.json 的常量名',
  },
  items: sortKeys(items),
  objects: sortKeys(objects),
};

writeFileSync(OUT, JSON.stringify(payload, null, 1) + '\n');
console.log(
  `[tile-names] items=${payload.meta.itemCount} objects=${payload.meta.objectCount} -> ${OUT}`,
);
