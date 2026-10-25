#!/usr/bin/env bash
#
# 快速构建并运行 TShockWebUI 单容器镜像。
#
# 用法：
#   scripts/run-container.sh                      # 构建镜像并（重）启动容器，映射到 :18080
#   NO_BUILD=1 scripts/run-container.sh           # 跳过构建，直接用现有镜像
#   SKIP_WEB_BUILD=1 scripts/run-container.sh     # 复用现有 web/dist，不重新构建前端
#   PORT=8080 scripts/run-container.sh            # 指定宿主机端口
#   TSHOCK_URL=http://host.docker.internal:7878 scripts/run-container.sh
#   TSHOCK_METHOD=GET scripts/run-container.sh    # 出站改回 GET（默认 POST）
#   NETWORK=ts_default TSHOCK_URL=http://tshock:7878 scripts/run-container.sh
#   FOREGROUND=1 scripts/run-container.sh         # 前台运行（看日志，Ctrl+C 停止）
#   CONTAINER=tswui-test PORT=18081 ...           # 用别的名字/端口起临时实例
#
# 说明：
# - WebUI 只暴露 8080；TShock REST(7878) 仍由 TShock 容器/宿主机自己管理。
# - 默认用 host.docker.internal 访问宿主机上的 TShock（与 s/ts/docker-compose.yml 的 7878 映射一致）。
#   Docker Desktop（macOS/Windows）自带该域名；Linux 上脚本会自动加 host-gateway 映射。
# - 走 HTTPS 反代时请设 COOKIE_SECURE=true。
set -euo pipefail

IMAGE=${IMAGE:-tshockwebui:dev}
CONTAINER=${CONTAINER:-tswui}
PORT=${PORT:-18080}
TSHOCK_URL=${TSHOCK_URL:-http://host.docker.internal:7878}
# 出站 HTTP 方法：GET 或 POST。TShock 不校验方法；默认 POST 用于规避机房
# 对未备案域名明文 GET 的 302 劫持（如腾讯云 webblock）。
TSHOCK_METHOD=${TSHOCK_METHOD:-POST}
COOKIE_SECURE=${COOKIE_SECURE:-false}
SESSION_TTL=${SESSION_TTL:-12h}
LOGIN_MAX_PER_MIN=${LOGIN_MAX_PER_MIN:-10}
COMMAND_MAX_PER_MIN=${COMMAND_MAX_PER_MIN:-60}
TRUST_PROXY=${TRUST_PROXY:-false}
LOG_LEVEL=${LOG_LEVEL:-info}
# 是否允许浏览器在界面里新增/切换自定义 TShock 上游（多服务器切换）。
ALLOW_CUSTOM_TARGETS=${TSHOCK_ALLOW_CUSTOM_TARGETS:-true}
ALLOW_INGAME_COMMANDS=${TSWUI_ALLOW_INGAME_COMMANDS:-false}
NETWORK=${NETWORK:-}
NO_BUILD=${NO_BUILD:-0}
SKIP_WEB_BUILD=${SKIP_WEB_BUILD:-0}
FOREGROUND=${FOREGROUND:-0}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

# 构建版本号（-X main.version）；默认取 git describe。
VERSION=${VERSION:-$(git -C "$ROOT_DIR" describe --tags --always --dirty 2>/dev/null || echo dev)}

if ! command -v docker >/dev/null 2>&1; then
  echo "错误：未找到 docker 命令，请先安装并启动 Docker。" >&2
  exit 1
fi

if [ "$NO_BUILD" != "1" ]; then
  # Dockerfile 只消费预构建的 web/dist：二进制与镜像共用同一份前端产物。
  if [ "$SKIP_WEB_BUILD" != "1" ]; then
    if ! command -v npm >/dev/null 2>&1; then
      echo "错误：未找到 npm，请先安装 Node 24+（或设 SKIP_WEB_BUILD=1 复用 web/dist）。" >&2
      exit 1
    fi
    echo "==> 构建前端（web/dist）"
    if [ ! -d web/node_modules ]; then
      (cd web && npm ci)
    fi
    (cd web && npm run build)
  elif [ ! -f web/dist/index.html ]; then
    echo "错误：SKIP_WEB_BUILD=1 但 web/dist/index.html 不存在。" >&2
    exit 1
  fi
  echo "==> 构建镜像 ${IMAGE}（版本 ${VERSION}）"
  docker build --build-arg "VERSION=$VERSION" -t "$IMAGE" .
else
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "错误：镜像 $IMAGE 不存在，去掉 NO_BUILD=1 先构建。" >&2
    exit 1
  fi
  echo "==> 跳过构建，使用现有镜像 $IMAGE"
fi

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "==> 移除旧容器 $CONTAINER"
  docker rm -f "$CONTAINER" >/dev/null
fi

# host.docker.internal：Docker Desktop 自带；其它环境（典型是 Linux）映射到宿主网关。
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
)
if [ ${#ADD_HOST_ARGS[@]} -gt 0 ]; then
  RUN_ARGS+=("${ADD_HOST_ARGS[@]}")
fi
if [ -n "$NETWORK" ]; then
  RUN_ARGS+=(--network "$NETWORK")
  echo "==> 加入 Docker 网络 ${NETWORK}（TSHOCK_URL 可用容器名，如 http://tshock:7878）"
fi

echo "==> 启动容器 $CONTAINER"
echo "    TSHOCK_URL = ${TSHOCK_URL}"
echo "    TSHOCK_METHOD = ${TSHOCK_METHOD}"
echo "    访问地址   = http://127.0.0.1:${PORT}"

if [ "$FOREGROUND" = "1" ]; then
  exec docker run --rm -it "${RUN_ARGS[@]}" "$IMAGE"
fi

RUN_ARGS+=(--restart unless-stopped)
docker run -d "${RUN_ARGS[@]}" "$IMAGE" >/dev/null

# 等待就绪并探活（无 curl 时只提示）。
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
    echo "警告：容器已启动但健康检查未通过，请查看日志：" >&2
    echo "  docker logs ${CONTAINER}" >&2
    exit 1
  fi
  echo "==> 就绪：http://127.0.0.1:${PORT}"
  # 顺便看一下 TShock 是否可达（/api/status 始终 200）。
  status=$(curl -fsS "http://127.0.0.1:${PORT}/api/status" 2>/dev/null || true)
  case "$status" in
    *'"reachable":true'*) echo "    TShock 可达 ✅" ;;
    *) echo "    注意：TShock 暂不可达，请检查 TSHOCK_URL=${TSHOCK_URL} 与 TShock 是否已启动" ;;
  esac
  exit 0
fi

echo "==> 已启动（未安装 curl，跳过健康检查）。查看日志： docker logs -f ${CONTAINER}"
