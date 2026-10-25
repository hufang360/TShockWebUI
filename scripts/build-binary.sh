#!/usr/bin/env bash
#
# 构建「单文件」可执行程序：把前端产物、data/*.json 与图集全部内嵌进一个 Go 二进制，
# 直接运行即可同时提供 Web 前端（/ /assets/* /data/*）与后端（/api/* /healthz），
# 不需要 Node、不需要 Docker、不依赖任何外部静态文件。
#
# 用法：
#   scripts/build-binary.sh                       # 为当前系统构建 → dist/tswui
#   GOOS=windows GOARCH=amd64 scripts/build-binary.sh   # 交叉编译 → dist/tswui.exe
#   GOARCH=arm64 scripts/build-binary.sh          # 换架构（同系统）
#   OUT=dist/trweb scripts/build-binary.sh        # 自定义输出路径
#   VERSION=1.2.3 scripts/build-binary.sh         # 指定版本号（默认取 git describe）
#   SKIP_WEB=1 scripts/build-binary.sh            # 复用已有 web/dist，跳过 npm build
#   SMOKE=1 scripts/build-binary.sh               # 构建后启动一次并探测 /healthz 与 /
#
# 版本号注入 -X main.version；用 `./dist/tswui -version` 与 `GET /healthz` 查看。
#
# 运行（默认 :8080，TShock 默认 http://127.0.0.1:7878）：
#   ./dist/tswui
#   LISTEN=:9000 TSHOCK_URL=http://192.168.1.10:7878 ./dist/tswui
#
# 说明：
# - 内嵌资源由 server/main.go 的 //go:embed all:internal/webdist 提供，因此构建前
#   必须把 web/dist 拷进 server/internal/webdist（本脚本负责）。
# - data/ 一律以仓库根目录为唯一来源；web/public/data 符号链接已移除（改为 Vite 插件 + Docker COPY data/ /data/）。
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

HOST_GOOS=$(go env GOHOSTOS 2>/dev/null || echo unknown)
HOST_GOARCH=$(go env GOHOSTARCH 2>/dev/null || echo unknown)
GOOS=${GOOS:-$HOST_GOOS}
GOARCH=${GOARCH:-$HOST_GOARCH}
SKIP_WEB=${SKIP_WEB:-0}
SMOKE=${SMOKE:-0}
SMOKE_PORT=${SMOKE_PORT:-18099}
# 版本号：优先 VERSION 环境变量，其次 git describe（无 git / 无 tag 时回退 dev）。
VERSION=${VERSION:-$(git -C "$ROOT_DIR" describe --tags --always --dirty 2>/dev/null || echo dev)}

if [ -z "${OUT:-}" ]; then
  if [ "$GOOS" = "windows" ]; then
    OUT="dist/tswui.exe"
  else
    OUT="dist/tswui"
  fi
fi
case "$OUT" in
  /*) OUT_ABS=$OUT ;;
  *) OUT_ABS="$ROOT_DIR/$OUT" ;;
esac

die() {
  echo "错误：$*" >&2
  exit 1
}
need() {
  command -v "$1" >/dev/null 2>&1 || die "未找到 ${1}，${2}"
}

need go "请先安装 Go 1.27+（https://go.dev/dl/）"
if [ "$SKIP_WEB" != "1" ]; then
  need node "请先安装 Node 24+（https://nodejs.org/）"
  need npm "请先安装 Node 24+（https://nodejs.org/）"
fi

echo "==> 目标平台 ${GOOS}/${GOARCH}（宿主 ${HOST_GOOS}/${HOST_GOARCH}），版本 ${VERSION}"

# ── 1. 生成数据自检 ─────────────────────────────────────────────
# 生成数据随仓库提交；若被删或未生成，这里提前失败并给出生成命令。
missing=""
for f in items.json prefixes.json buffs.json commands.json meta.json items-atlas.json \
  items-atlas.png player-atlas.json player-atlas.png buff-atlas.json buff-atlas.png recipes.json item-stats.json \
  item-tips.zh-Hans.json item-tips.en-US.json loc.zh-Hans.json loc.en-US.json; do
  [ -f "data/$f" ] || missing="$missing data/$f"
done
if [ -n "$missing" ]; then
  {
    echo "错误：缺少生成数据：$missing"
    echo "  请先执行（部分需要 dotnet 9 / python3-Pillow）："
    echo "    node tools/gen-data.mjs && python3 tools/gen-atlas.py && python3 tools/gen-player-atlas.py && python3 tools/gen-buff-atlas.py"
    echo "    bash tools/gen-game-data.sh"
  } >&2
  exit 1
fi

# ── 2. 前端构建 ────────────────────────────────────────────────
if [ "$SKIP_WEB" = "1" ]; then
  [ -f web/dist/index.html ] || die "web/dist/index.html 不存在，去掉 SKIP_WEB=1 重新构建"
  echo "==> 跳过前端构建（复用 web/dist）"
else
  if [ ! -d web/node_modules ]; then
    echo "==> 安装前端依赖"
    (cd web && npm install --no-audit --no-fund)
  fi
  echo "==> 构建前端（web/dist）"
  (cd web && npm run build)
fi

# ── 3. 把前端产物 + data 放进 server/internal/webdist ──────────
WD=server/internal/webdist
echo "==> 准备内嵌资源 $WD"
mkdir -p "$WD"
# 清空旧产物，保留 .gitkeep（占位文件，保证目录存在且 git 不报删除）
find "$WD" -mindepth 1 -maxdepth 1 ! -name '.gitkeep' -exec rm -rf {} +
cp -R web/dist/. "$WD/"
# data/ 以仓库根为唯一来源，覆盖 dist 里可能来自符号链接的副本
rm -rf "$WD/data"
mkdir -p "$WD/data"
cp -R data/. "$WD/data/"

# ── 4. 编译单文件 ──────────────────────────────────────────────
mkdir -p "$(dirname "$OUT_ABS")"
echo "==> 编译 ${OUT}（CGO_ENABLED=0，静态）"
(
  cd server
  CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" \
    go build -trimpath -buildvcs=false \
      -ldflags="-s -w -buildid= -X main.version=${VERSION}" -o "$OUT_ABS" .
)

size=$(wc -c <"$OUT_ABS" | tr -d ' ')
echo "==> 完成：$OUT  （$((size / 1024 / 1024)) MB / ${size} 字节）"

# ── 5. 可选冒烟测试（仅当目标平台 == 宿主平台）────────────────
if [ "$SMOKE" = "1" ]; then
  if [ "$GOOS" != "$HOST_GOOS" ] || [ "$GOARCH" != "$HOST_GOARCH" ]; then
    echo "==> 跳过冒烟测试（${GOOS}/${GOARCH} 无法在 ${HOST_GOOS}/${HOST_GOARCH} 上直接运行）"
  elif ! command -v curl >/dev/null 2>&1; then
    echo "==> 跳过冒烟测试（未安装 curl）"
  else
    echo "==> 冒烟测试 http://127.0.0.1:${SMOKE_PORT}"
    log=$(mktemp)
    LISTEN=":${SMOKE_PORT}" LOG_LEVEL=warn "$OUT_ABS" >"$log" 2>&1 &
    pid=$!
    trap 'kill "$pid" 2>/dev/null || true; rm -f "$log"' EXIT
    ready=0
    for _ in $(seq 1 40); do
      if curl -fsS "http://127.0.0.1:${SMOKE_PORT}/healthz" >/dev/null 2>&1; then
        ready=1
        break
      fi
      sleep 0.25
    done
    if [ "$ready" != "1" ]; then
      echo "  失败：健康检查未通过，日志如下" >&2
      cat "$log" >&2
      exit 1
    fi
    root_code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${SMOKE_PORT}/")
    data_code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${SMOKE_PORT}/data/meta.json")
    reported=$(curl -s "http://127.0.0.1:${SMOKE_PORT}/healthz")
    echo "  /healthz ${reported}"
    echo "  / HTTP ${root_code}，/data/meta.json HTTP ${data_code}"
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    trap - EXIT
    rm -f "$log"
  fi
fi

echo "==> 运行：$OUT  （默认监听 :8080，可用 LISTEN / TSHOCK_URL 等环境变量覆盖）"
