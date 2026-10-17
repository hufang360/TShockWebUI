#!/usr/bin/env bash
# gen-game-data.sh —— 生成 data/recipes.json 与 data/item-stats.json 与 data/item-groups.json
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
trap 'rm -f "$RECIPES_RAW" "$ITEMS_RAW" "$GROUPS_RAW" "$PREFIX_SETS_RAW"' EXIT

echo "== GameDump (dotnet) =="
echo "   TR_SRC=$TR_SRC"
dotnet build "$HERE/gamedump" -c Release -v q
dotnet "$HERE/gamedump/bin/Release/net9.0/GameDump.dll" "$TR_SRC" "$RECIPES_RAW" "$ITEMS_RAW" "$GROUPS_RAW" "$PREFIX_SETS_RAW"

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

echo "完成。"
