#!/usr/bin/env bash
#
# 在**宿主**上直接跑后端（不用 Docker）。
#
# 用途：当你所在网络把 Docker/OrbStack 的容器出站流量走了代理（Clash 等），
# 导致容器访问公网 TShock（如 <server-ip>:7878）失败、而宿主机能直连时，
# 用本脚本即可绕过容器网络，直接用宿主机的出口访问远端。
#
# 用法：
#   scripts/dev-native.sh                 # 构建后端并前台启动（默认 :8080）
#   BUILD_WEB=1 scripts/dev-native.sh     # 先 npm run build 再启动
#   LISTEN=:18100 scripts/dev-native.sh   # 换端口
#   TSHOCK_URL=http://127.0.0.1:7878 scripts/dev-native.sh
#   TSHOCK_METHOD=GET scripts/dev-native.sh   # 出站改回 GET（默认 POST）
#
# 访问 http://127.0.0.1:<端口>；多服务器切换默认开启，可在界面里选远端地址。
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

LISTEN=${LISTEN:-:8080}
TSHOCK_URL=${TSHOCK_URL:-http://127.0.0.1:7878}
# 出站 HTTP 方法：GET 或 POST（默认 POST，规避机房对明文 GET 的 302 劫持）。
TSHOCK_METHOD=${TSHOCK_METHOD:-POST}
TSHOCK_ALLOW_CUSTOM_TARGETS=${TSHOCK_ALLOW_CUSTOM_TARGETS:-true}
COOKIE_SECURE=${COOKIE_SECURE:-false}
LOG_LEVEL=${LOG_LEVEL:-info}
BUILD_WEB=${BUILD_WEB:-0}
# 构建版本号（-X main.version）；默认取 git describe。
VERSION=${VERSION:-$(git -C "$ROOT_DIR" describe --tags --always --dirty 2>/dev/null || echo dev)}

mkdir -p "$ROOT_DIR/.dev"

if [ "$BUILD_WEB" = "1" ] || [ ! -f "$ROOT_DIR/web/dist/index.html" ]; then
  echo "==> 构建前端"
  (cd web && npm run build)
fi

echo "==> 构建后端（宿主二进制，版本 ${VERSION}）"
(cd server && go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o "$ROOT_DIR/.dev/tswui-native" .)

echo "==> 启动：http://127.0.0.1${LISTEN}  (TSHOCK_URL=${TSHOCK_URL})"
exec env \
  LISTEN="$LISTEN" \
  WEB_DIST_DIR="$ROOT_DIR/web/dist" \
  TSHOCK_URL="$TSHOCK_URL" \
  TSHOCK_METHOD="$TSHOCK_METHOD" \
  TSHOCK_ALLOW_CUSTOM_TARGETS="$TSHOCK_ALLOW_CUSTOM_TARGETS" \
  COOKIE_SECURE="$COOKIE_SECURE" \
  LOG_LEVEL="$LOG_LEVEL" \
  "$ROOT_DIR/.dev/tswui-native"
