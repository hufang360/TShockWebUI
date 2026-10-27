#!/usr/bin/env bash
# gen-game-data.sh —— 生成 data/ 下的合成表 / 物品属性 / 分组 / 微光 / 词缀 / 图格墙表 / 物品上限 / 图格图例名
#
# 依赖：
#   - dotnet 9 SDK（首次会自动从 NuGet 还原 TShock 6.2.1 / OTAPI）
#   - TR_SRC 反编译源码目录（默认 <repo>/../tr-code-1458），
#     仅用于解析配方组名称与本地化文案
#
# 步骤：1) dotnet 调用游戏自身 Recipe.SetupRecipes() / Item.SetDefaults() / CreativeHelper 导出原始数据
#       2) Node 整理为 data/recipes.json、data/item-stats.json 与 data/item-groups.json
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

# 默认相对仓库定位：<repo>/../tr-code-1458
TR_SRC="${TR_SRC:-$REPO/../tr-code-1458}"

RECIPES_RAW="$(mktemp -t recipes-raw.XXXXXX.json)"
ITEMS_RAW="$(mktemp -t items-raw.XXXXXX.json)"
GROUPS_RAW="$(mktemp -t item-groups-raw.XXXXXX.json)"
PREFIX_SETS_RAW="$(mktemp -t prefix-sets-raw.XXXXXX.json)"
ITEM_DROPS_RAW="$(mktemp -t item-drops-raw.XXXXXX.json)"
TILE_STYLES_RAW="$(mktemp -t tile-styles-raw.XXXXXX.json)"
trap 'rm -f "$RECIPES_RAW" "$ITEMS_RAW" "$GROUPS_RAW" "$PREFIX_SETS_RAW" "$ITEM_DROPS_RAW" "$TILE_STYLES_RAW"' EXIT

echo "== GameDump (dotnet) =="
echo "   TR_SRC=$TR_SRC"
dotnet build "$HERE/gamedump" -c Release -v q
dotnet "$HERE/gamedump/bin/Release/net9.0/GameDump.dll" "$TR_SRC" "$RECIPES_RAW" "$ITEMS_RAW" "$GROUPS_RAW" "$PREFIX_SETS_RAW" "$ITEM_DROPS_RAW"

# 木匣掉落是运行时模拟（1e6 次/个），直接写成品供前端读；其余 raw 再经 Node 整理。
cp -f "$ITEM_DROPS_RAW" "$REPO/data/item-drops.json"

echo "== gen-recipes =="
TR_SRC="$TR_SRC" RAW="$RECIPES_RAW" OUT="$REPO/data/recipes.json" node "$HERE/gen-recipes.mjs"

echo "== gen-item-stats =="
TR_SRC="$TR_SRC" RAW="$ITEMS_RAW" OUT="$REPO/data/item-stats.json" node "$HERE/gen-item-stats.mjs"

echo "== gen-item-groups =="
RAW="$GROUPS_RAW" OUT="$REPO/data/item-groups.json" node "$HERE/gen-item-groups.mjs"

echo "== gen-shimmer =="
RAW="$ITEMS_RAW" OUT="$REPO/data/shimmer.json" node "$HERE/gen-shimmer.mjs"

echo "== gen-prefix-mods =="
TR_SRC="$TR_SRC" OUT="$REPO/data/prefix-mods.json" node "$HERE/gen-prefix-mods.mjs"

echo "== gen-prefix-sets =="
RAW="$PREFIX_SETS_RAW" OUT="$REPO/data/prefix-sets.json" node "$HERE/gen-prefix-sets.mjs"

echo "== item limits（.plr 编辑器的数量校验） =="
dotnet "$HERE/gamedump/bin/Release/net9.0/GameDump.dll" --item-limits "$REPO/data/item-limits.json"

echo "== gen-tile-names（图格 → 地图图例名来源） =="
TR_SRC="$TR_SRC" OUT="$REPO/data/tile-names.json" node "$HERE/gen-tile-names.mjs"

echo "== gen-permissions（权限节点 + 内置用户组） =="
TSHOCK_SRC="${TSHOCK_SRC:-$REPO/../TShock}" OUT="$REPO/data/permissions.json" node "$HERE/gen-permissions.mjs"

echo "== tile styles =="
dotnet "$HERE/gamedump/bin/Release/net9.0/GameDump.dll" --tile-styles "$TILE_STYLES_RAW"

echo "== gen-tile-wall =="
TR_SRC="$TR_SRC" RAW="$RECIPES_RAW" STYLES_RAW="$TILE_STYLES_RAW" \
  OUT="$REPO/data/tiles.json" OUT_WALL="$REPO/data/walls.json" node "$HERE/gen-tile-wall.mjs"

echo "完成。"
