#!/usr/bin/env bash
# 把仓库根的 data/commands.json 同步到 Go 后端的内嵌副本。
# 数据在版本升级后由 tools/gen-data.mjs 重新生成，随后运行本脚本。
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/../../data/commands.json"
dst="$here/../internal/tshock/data/commands.json"
cp -f "$src" "$dst"
echo "已同步 $src -> $dst"
