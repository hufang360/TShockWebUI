#!/usr/bin/env bash
#
# 开发用：**不构建镜像**，用「宿主构建 + 挂载运行」的方式把最新代码跑在容器里。
# 适合反复改前端 / 后端的快速回归；要验证最终交付镜像仍请用 scripts/run-container.sh。
#
# 用法：
#   scripts/dev-container.sh              # 构建前端 + 后端并（重）启动容器
#   scripts/dev-container.sh frontend     # 只重新构建前端：无需重启，刷新浏览器即可
#   scripts/dev-container.sh backend      # 只重新构建后端并重启容器
#   PORT=8081 scripts/dev-container.sh    # 换宿主机端口
#   TSHOCK_METHOD=GET scripts/dev-container.sh   # 出站改回 GET（默认 POST）
#   LOGS=1 scripts/dev-container.sh       # 前台跟随日志（Ctrl+C 停止）
#   CONTAINER=tswui-dev2 ...              # 多开一个实例
#
# 原理：
#   - 容器用 distroless 基础镜像，命令指向挂载进来的宿主编译产物 /tswui；
#   - 前端 dist 只读挂到 /webdist，后端以 WEB_DIST_DIR 读取 → 前端改动只需 npm run build；
#   - 因此完全不需要 docker build，也不占镜像构建缓存。
set -euo pipefail

IMAGE=${IMAGE:-gcr.io/distroless/static-debian12:nonroot}
CONTAINER=${CONTAINER:-tswui-dev}
PORT=${PORT:-18080}
TSHOCK_URL=${TSHOCK_URL:-http://host.docker.internal:7878}
TSHOCK_METHOD=${TSHOCK_METHOD:-POST}
COOKIE_SECURE=${COOKIE_SECURE:-false}
SESSION_TTL=${SESSION_TTL:-12h}
LOGIN_MAX_PER_MIN=${LOGIN_MAX_PER_MIN:-10}
COMMAND_MAX_PER_MIN=${COMMAND_MAX_PER_MIN:-60}
TRUST_PROXY=${TRUST_PROXY:-false}
ALLOW_CUSTOM_TARGETS=${TSHOCK_ALLOW_CUSTOM_TARGETS:-true}
ALLOW_INGAME_COMMANDS=${TSWUI_ALLOW_INGAME_COMMANDS:-false}
LOG_LEVEL=${LOG_LEVEL:-debug}
NETWORK=${NETWORK:-}
LOGS=${LOGS:-0}
MODE=${1:-all}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

# 构建版本号（-X main.version）；默认取 git describe。
VERSION=${VERSION:-$(git -C "$ROOT_DIR" describe --tags --always --dirty 2>/dev/null || echo dev)}
DEV_DIR="$ROOT_DIR/.dev"
mkdir -p "$DEV_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "错误：未找到 docker 命令。" >&2
  exit 1
fi

# 交叉编译目标：跟随 Docker 宿主架构（Apple Silicon 上是 arm64）。
arch=$(docker info --format '{{.Architecture}}' 2>/dev/null || true)
case "$arch" in
  aarch64 | arm64) GOARCH=arm64 ;;
  x86_64 | amd64) GOARCH=amd64 ;;
  *)
    echo "错误：无法识别 Docker 架构：${arch:-未知}" >&2
    exit 1
    ;;
esac

if [ "$MODE" = "all" ] || [ "$MODE" = "frontend" ]; then
  echo "==> 构建前端（宿主 npm run build）"
  (cd web && npm run build)
fi

if [ "$MODE" = "all" ] || [ "$MODE" = "backend" ]; then
  echo "==> 构建后端 linux/${GOARCH}（宿主，静态二进制，版本 ${VERSION}）"
  (cd server && CGO_ENABLED=0 GOOS=linux GOARCH="$GOARCH" \
    go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o "$DEV_DIR/tswui" .)
fi

# 只更新前端：后端从磁盘按需读取 /webdist，无需重启容器。
if [ "$MODE" = "frontend" ]; then
  echo "==> 前端已更新：刷新浏览器即可（容器无需重启）。"
  exit 0
fi

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "==> 移除旧容器 $CONTAINER"
  docker rm -f "$CONTAINER" >/dev/null
fi

# host.docker.internal：Docker Desktop 自带；其它环境映射到宿主网关。
ADD_HOST_ARGS=()
docker_os=$(docker info --format '{{.OperatingSystem}}' 2>/dev/null || true)
case "$docker_os" in
  *"Docker Desktop"*) ;;
  *) ADD_HOST_ARGS=(--add-host host.docker.internal:host-gateway) ;;
esac

RUN_ARGS=(
  --name "$CONTAINER"
  -p "${PORT}:8080"
  -e "LISTEN=:8080"
  -e "WEB_DIST_DIR=/webdist"
  -e "TSHOCK_URL=${TSHOCK_URL}"
  -e "TSHOCK_METHOD=${TSHOCK_METHOD}"
  -e "COOKIE_SECURE=${COOKIE_SECURE}"
  -e "SESSION_TTL=${SESSION_TTL}"
  -e "LOGIN_MAX_PER_MIN=${LOGIN_MAX_PER_MIN}"
  -e "COMMAND_MAX_PER_MIN=${COMMAND_MAX_PER_MIN}"
  -e "TRUST_PROXY=${TRUST_PROXY}"
  -e "TSHOCK_ALLOW_CUSTOM_TARGETS=${ALLOW_CUSTOM_TARGETS}"
  -e "TSWUI_ALLOW_INGAME_COMMANDS=${ALLOW_INGAME_COMMANDS}"
  -e "LOG_LEVEL=${LOG_LEVEL}"
  -v "$DEV_DIR/tswui:/tswui:ro"
  -v "$ROOT_DIR/web/dist:/webdist:ro"
)
if [ ${#ADD_HOST_ARGS[@]} -gt 0 ]; then
  RUN_ARGS+=("${ADD_HOST_ARGS[@]}")
fi
if [ -n "$NETWORK" ]; then
  RUN_ARGS+=(--network "$NETWORK")
  echo "==> 加入 Docker 网络 $NETWORK"
fi

if [ "$LOGS" = "1" ]; then
  echo "==> 前台运行（Ctrl+C 停止）"
  exec docker run --rm -it "${RUN_ARGS[@]}" "$IMAGE" /tswui
fi

echo "==> 启动容器 ${CONTAINER}（镜像 ${IMAGE}，无需 build）"
docker run -d "${RUN_ARGS[@]}" "$IMAGE" /tswui >/dev/null

if command -v curl >/dev/null 2>&1; then
  ready=0
  for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.5
  done
  if [ "$ready" != "1" ]; then
    echo "警告：健康检查未通过，查看日志： docker logs ${CONTAINER}" >&2
    exit 1
  fi
  echo "==> 就绪：http://127.0.0.1:${PORT}"
  status=$(curl -fsS "http://127.0.0.1:${PORT}/api/status" 2>/dev/null || true)
  case "$status" in
    *'"reachable":true'*) echo "    TShock 可达 ✅" ;;
    *) echo "    注意：TShock 暂不可达，请检查 TSHOCK_URL=${TSHOCK_URL}" ;;
  esac
  echo "    改前端：scripts/dev-container.sh frontend 后刷新页面"
  echo "    改后端：scripts/dev-container.sh backend"
  exit 0
fi

echo "==> 已启动。日志： docker logs -f ${CONTAINER}"
