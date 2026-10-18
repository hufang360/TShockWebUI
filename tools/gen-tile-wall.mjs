#!/usr/bin/env node
/**
 * gen-tile-wall.mjs —— 生成 data/tiles.json（图格 ID 表）与 data/walls.json（墙 ID 表）。
 *
 * 数据来源（与其它数据一致，全部来自本机可重复生成的文件，不手工编造）：
 *   - TR_SRC / Terraria.ID/TileID.cs  经典常量名（`public const ushort Name = N;`）
 *   - TR_SRC / Terraria.ID/WallID.cs  经典常量名
 *   - recipes-raw.json（GameDump 产出）里的 `itemTile` / `itemWall`：物品 → 它放置的图格 / 墙。
 *     用来给图格 / 墙找「代表物品」；显示名在运行期由该物品的官方本地化名解析
 *     （等价于游戏 `Lang.GetMapObjectName(MapHelper.TileToLookup(...))` 的常见情形，
 *      但无需加载语言包；拿不到名字时前端回退到常量名）。
 *   - recipes-raw.json 里的 `tileDims`：图格摆放尺寸（游戏 `TileObjectData` 的 Width×Height）。
 *     简单方块没有 TileObjectData（1×1，省略）；只有图格有，墙没有尺寸概念。
 *   - recipes-raw.json 里的 `tileFrameImportant`：frame-important 但无固定尺寸的图格（树/陷阱/铁轨…）。
 *     这些条目加 `frameImportant: true`，前端显示「无固定尺寸」而不是误报 1×1。
 *
 * 输出：id、内部名（常量名）、代表物品 id（可为 null）、图格的摆放尺寸 [宽, 高]（可选）。
 * 由 tools/gen-game-data.sh 调用（依赖同一次 GameDump 的 recipes-raw.json）。
 *
 * 运行：
 *   TR_SRC=../tr-code-1458 RAW=/tmp/recipes-raw.json \
 *     node tools/gen-tile-wall.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TR_SRC = process.env.TR_SRC || join(HERE, '..', '..', 'tr-code-1458');
const RAW = process.env.RAW || '/tmp/recipes-raw.json';
const OUT_TILE = process.env.OUT || join(HERE, '..', 'data', 'tiles.json');
const OUT_WALL = process.env.OUT_WALL || join(HERE, '..', 'data', 'walls.json');

const read = (p) => readFileSync(p, 'utf8');

/** `public const ushort Name = N;` -> Map(id -> 第一个常量名)。 */
function parseConstMap(text) {
  const map = new Map();
  for (const m of text.matchAll(/public const ushort (\w+) = (\d+);/g)) {
    const id = Number(m[2]);
    if (m[1] === 'Count') continue;
    if (!map.has(id)) map.set(id, m[1]);
  }
  return map;
}

/** itemId -> createTile/createWall（GameDump 的 int 字典；只保留 >= 0）。 */
function invert(idToTarget) {
  const targetToItem = new Map();
  const ids = Object.keys(idToTarget ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  for (const itemId of ids) {
    const target = idToTarget[String(itemId)];
    if (typeof target !== 'number' || target < 0) continue;
    if (!targetToItem.has(target)) targetToItem.set(target, itemId);
  }
  return targetToItem;
}

const raw = JSON.parse(read(RAW));
const tileKey = parseConstMap(read(join(TR_SRC, 'Terraria.ID/TileID.cs')));
const wallKey = parseConstMap(read(join(TR_SRC, 'Terraria.ID/WallID.cs')));
const tileItem = invert(raw.itemTile);
const wallItem = invert(raw.itemWall);
const tileDims = raw.tileDims ?? {};
const tileFrameImportant = new Set(raw.tileFrameImportant ?? []);

const build = (keys, items, dims, fi) =>
  [...keys.keys()]
    .sort((a, b) => a - b)
    .map((id) => {
      const entry = { id, key: keys.get(id), item: items.get(id) ?? null };
      const d = dims?.[String(id)];
      if (Array.isArray(d) && d.length === 2) entry.size = d;
      else if (fi?.has(id)) entry.frameImportant = true;
      return entry;
    });

const tiles = build(tileKey, tileItem, tileDims, tileFrameImportant);
const walls = build(wallKey, wallItem, null, null);

const write = (out, meta, entries, kind) => {
  writeFileSync(
    out,
    JSON.stringify(
      {
        meta: {
          gameVersion: raw.gameVersion,
          count: entries.length,
          withItem: entries.filter((e) => e.item != null).length,
          withSize: entries.filter((e) => e.size != null).length,
          source:
            `Terraria.ID/${kind}.cs + GameDump item${kind === 'TileID' ? 'Tile' : 'Wall'}` +
            (kind === 'TileID' ? ' + TileObjectData' : ''),
          generatedBy: 'tools/gen-tile-wall.mjs',
          note:
            'item = 放置该图格/墙的代表物品 id（运行期用它解析本地化名）；null = 无对应物品，显示 key。' +
            (kind === 'TileID'
              ? 'size = 图格摆放尺寸 [宽, 高]（游戏 TileObjectData；简单方块 1×1 省略）；frameImportant = 多格/动态但无固定尺寸（如树、陷阱）。'
              : ''),
        },
        entries,
      },
      null,
      1,
    ) + '\n',
  );
};

write(OUT_TILE, null, tiles, 'TileID');
write(OUT_WALL, null, walls, 'WallID');
console.log(
  `图格 ${tiles.length} 条（${tiles.filter((t) => t.item != null).length} 条有代表物品，${tiles.filter((t) => t.size != null).length} 条带尺寸）`,
);
console.log(`墙   ${walls.length} 条（${walls.filter((t) => t.item != null).length} 条有代表物品）`);
