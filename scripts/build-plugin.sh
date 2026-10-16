#!/usr/bin/env bash
#
# 构建 TShockWebUI 的信使插件 WebUI（C# / net9.0，引用 TShock 6.2.1 NuGet）。
#
# 用法：
#   scripts/build-plugin.sh                          # Debug 构建，打印 DLL 路径
#   CONFIG=Release scripts/build-plugin.sh           # Release 构建
#   PLUGINS_DIR=/path/plugins scripts/build-plugin.sh   # 构建后把 DLL 拷进插件目录
#
# 说明：
# - 只产出 WebUI.dll；TShockAPI.dll / HttpServer.dll 由 TShock 服务端自带。
# - 顶层脚本的 ts-sync-plugins 会自动同步同级的插件工程里匹配 TFM 的 csproj 产物，
#   通常不需要手动指定 PLUGINS_DIR。
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROJ_DIR="$ROOT_DIR/plugin/WebUI"
CONFIG=${CONFIG:-Debug}
PLUGINS_DIR=${PLUGINS_DIR:-}

if ! command -v dotnet >/dev/null 2>&1; then
  echo "未找到 dotnet（需要 .NET 9 SDK）" >&2
  exit 1
fi

cd "$PROJ_DIR"
dotnet build -c "$CONFIG" "$@"

DLL="$PROJ_DIR/bin/$CONFIG/net9.0/WebUI.dll"
if [ ! -f "$DLL" ]; then
  echo "构建产物缺失：$DLL" >&2
  exit 1
fi
echo "插件：$DLL"

if [ -n "$PLUGINS_DIR" ]; then
  mkdir -p "$PLUGINS_DIR"
  cp -f "$DLL" "$PLUGINS_DIR/"
  echo "已复制到：$PLUGINS_DIR/WebUI.dll（重启 TShock 生效）"
fi
