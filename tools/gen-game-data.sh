#!/usr/bin/env bash
# gen-game-data.sh —— 生成 data/recipes.json 与 data/item-stats.json
#
# 依赖：
#   - dotnet 9 SDK（首次会自动从 NuGet 还原 TShock 6.2.1 / OTAPI）
#   - TR_SRC 反编译源码目录（默认 <repo>/../tr-code-1458），
#     仅用于解析配方组名称与本地化文案
#
# 步骤：1) dotnet 调用游戏自身 Recipe.SetupRecipes() / Item.SetDefaults() 导出原始数据
#       2) Node 整理为 data/recipes.json 与 data/item-stats.json
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

# 默认相对仓库定位：<repo>/../tr-code-1458
TR_SRC="${TR_SRC:-$REPO/../tr-code-1458}"

RECIPES_RAW="$(mktemp -t recipes-raw.XXXXXX.json)"
ITEMS_RAW="$(mktemp -t items-raw.XXXXXX.json)"
trap 'rm -f "$RECIPES_RAW" "$ITEMS_RAW"' EXIT

echo "== GameDump (dotnet) =="
echo "   TR_SRC=$TR_SRC"
dotnet build "$HERE/gamedump" -c Release -v q
dotnet "$HERE/gamedump/bin/Release/net9.0/GameDump.dll" "$TR_SRC" "$RECIPES_RAW" "$ITEMS_RAW"

echo "== gen-recipes =="
TR_SRC="$TR_SRC" RAW="$RECIPES_RAW" OUT="$REPO/data/recipes.json" node "$HERE/gen-recipes.mjs"

echo "== gen-item-stats =="
TR_SRC="$TR_SRC" RAW="$ITEMS_RAW" OUT="$REPO/data/item-stats.json" node "$HERE/gen-item-stats.mjs"

echo "完成。"
