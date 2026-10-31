# TShockWebUI — 常用任务入口（薄封装，真正逻辑在 scripts/ 与各子项目）
#
#   make            # 显示帮助
#   make data       # 生成 data/ 与颜色表（需 TR_SRC / SPRITE_DIR / TEDIT_DIR / dotnet 9）
#   make web        # 安装依赖并构建前端 → web/dist
#   make lint       # go vet + 前端 typecheck/lint
#   make test       # 后端 go test -race + 前端 vitest
#   make plugin     # 构建信使插件 → plugin/WebUI/bin/Debug/net9.0/WebUI.dll
#   make image      # 构建并运行交付镜像（scripts/run-container.sh）
#   make binary     # 构建单文件二进制（scripts/build-binary.sh）
#   make dev        # 宿主直跑后端（scripts/dev-native.sh）
#   make dev-web    # 改 UI 用这个：vite HMR 页面在 :5173，/api 转发给后端 :18080
#   make dev-all    # 一条命令：容器后端 :18080 + vite 页面 :5173（省两个终端）
#   make dev-container          # 挂载式容器后端（默认 :18080，浏览器直接开就是完整应用）
#   make dev-container-frontend # 只重建前端（刷 18080 即可，容器不重启）
#   make dev-container-backend  # 只重建后端并重启容器
#   make clean      # 清掉构建产物
#
# 约定：这里只做「一条命令 = 一个脚本/一段 make 逻辑」，不放业务实现；
# 需要新参数时用 `make <目标> 变量=值`（如 `make dev-web API_TARGET=http://127.0.0.1:8080`），
# 别把参数硬编码进目标里。每个目标上一行注释写清「什么时候用它、有什么副作用」。

SHELL := /usr/bin/env bash

# 开发端口：后端（容器或宿主）恒在 API_PORT=18080，vite 开发服务器在 WEB_PORT=5173。
# 定这个分工的理由（用户习惯）：18080 就是「完整应用」的地址——打开它看到的是后端服务的
# web/dist，可以当书签；要 HMR 时再开 5173（它把 /api 代理到 18080）。
# 一个端口只能一个进程，所以：18080 被后端占着时，vite 不能坐它；想要 18080 带 HMR 就只能
# 临时换对端口（make dev-all WEB_PORT=18080 API_PORT=18081）。
# 注意：交付验证（make image / scripts/run-container.sh）默认也是 18080，
#      与 make dev-container 不能同时跑（谁先占谁赢，后起的会报端口被占）。
WEB_PORT ?= 5173
API_PORT ?= 18080
API_TARGET ?= http://127.0.0.1:$(API_PORT)

.PHONY: help data web server lint test plugin image binary \
        dev dev-web dev-all dev-container dev-container-frontend dev-container-backend clean

help:
	@echo "TShockWebUI 任务："
	@echo "  —— 数据 ——"
	@echo "  make data          生成 data/（TR_SRC / SPRITE_DIR / dotnet 9）"
	@echo "  —— 构建 ——"
	@echo "  make web           安装依赖 + 构建前端（web/dist）"
	@echo "  make server        编译 Go 后端"
	@echo "  make plugin        构建信使插件 WebUI.dll"
	@echo "  —— 校验 ——"
	@echo "  make lint          go vet + 前端 typecheck/lint"
	@echo "  make test          后端 go test -race + 前端 vitest"
	@echo "  —— 开发（改代码）——"
	@echo "  make dev-all       一条命令：容器后端 :$(API_PORT) + vite 页面 :$(WEB_PORT)（前台）"
	@echo "  make dev-web       vite HMR 页面 :$(WEB_PORT)，/api → $(API_TARGET)"
	@echo "  make dev           宿主直跑后端（scripts/dev-native.sh，默认 :8080）"
	@echo "  make dev-container 挂载式容器后端（默认 :$(API_PORT)；浏览器直接开就是完整应用）"
	@echo "  make dev-container-frontend  只重建前端 dist（刷新即可）"
	@echo "  make dev-container-backend   只重建后端并重启容器"
	@echo "  —— 交付验证 ——"
	@echo "  make image         构建并运行交付镜像（scripts/run-container.sh）"
	@echo "  make binary        构建单文件二进制（scripts/build-binary.sh）"
	@echo "  make clean         清理构建产物"

# ---- 数据 ----------------------------------------------------------------
# 升级游戏版本 / 改生成器后才需要跑；产物直接写进 data/（勿手改）。耗时较久。
data:
	node tools/gen-data.mjs
	python3 tools/gen-atlas.py
	python3 tools/gen-player-atlas.py
	python3 tools/gen-npc-atlas.py
	python3 tools/gen-buff-atlas.py
	python3 tools/gen-brand-assets.py
	bash tools/gen-game-data.sh
	node tools/gen-world-colors.mjs   # 世界缩略图颜色表 → web/src/lib/save/worldColors.generated.ts（需 TEDIT_DIR）

# ---- 构建 ----------------------------------------------------------------
# 生产前端产物。用 npm ci（严格按 lockfile），本地临时试验请直接用 `make dev-web`。
web:
	cd web && npm ci && npm run build

# 只编译，不产物落地：用来快速确认后端能过编译（完整构建见 make binary / make image）。
server:
	cd server && go build ./...

# ---- 校验 ----------------------------------------------------------------
lint:
	cd server && go vet ./...
	cd web && npm run typecheck && npm run lint

test:
	cd server && go test -race ./...
	cd web && npm run test:run

# C# 信使插件（在线授权 / 批量执行等）。DLL 由 ts-sync-plugins 同步进 TShock。
plugin:
	cd plugin/WebUI && dotnet build -c Debug

# ---- 开发：前端热更新 -----------------------------------------------------
# 只改 web/ 下代码（UI、纯前端逻辑）时用它：vite dev 带 HMR，秒级生效。
# 浏览器开 http://localhost:$(WEB_PORT)；18080 那个地址仍是容器里的 web/dist（旧产物）。
# 前提：后端已在跑（默认容器 :$(API_PORT)）——先另开一个终端 `make dev-container`。
#   1) 后端没起：这里会先探 $(API_TARGET)/healthz 并提示，不会让你瞎看 proxy error；
#   2) 端口被占会直接报错（strictPort），不会静默换端口；
#   3) 换端口：make dev-web WEB_PORT=5174 API_PORT=8080 API_TARGET=http://127.0.0.1:8080
#   4) 纯静态页面（图鉴 / 存档解析）没有后端也能看：
#      cd web && VITE_TRANSPORT=mock npm run dev
dev-web:
	@curl -fsS -o /dev/null --max-time 2 $(API_TARGET)/healthz 2>/dev/null \
	  || { \
	    echo "⚠️  $(API_TARGET) 无响应：页面能打开，但 /api/* 会报 http proxy error，无法登录/执行指令。"; \
	    echo "    另开一个终端先启动后端：make dev-container   （容器 :$(API_PORT)）"; \
	    echo "    或宿主直跑：make dev，然后 make dev-web API_TARGET=http://127.0.0.1:8080"; \
	    echo; \
	  }
	cd web && VITE_PORT=$(WEB_PORT) VITE_API_TARGET=$(API_TARGET) npm run dev

# ---- 开发：后端 ----------------------------------------------------------
# 宿主直跑后端（不构建镜像）。默认 :8080；改端口 LISTEN=:18100 make dev。
# 只在改了 Go 代码、或需要重启后端时才重跑；纯前端改动不需要碰它。
dev:
	scripts/dev-native.sh

# 挂载式容器后端：宿主编译，distroless 容器运行，不 build 镜像。
# 默认跑在 API_PORT=18080 → 浏览器直接开 http://localhost:18080 就是完整应用（旧 dist）。
# TSHOCK_URL 默认 http://host.docker.internal:7878（宿主机上发布的 TShock REST）。
# 改了 web/ 想更新 18080 看到的页面：make dev-container-frontend（重建 dist，无 HMR）。
dev-container:
	PORT=$(API_PORT) scripts/dev-container.sh

# ---- 开发：一条命令 ------------------------------------------------------
# 起整套开发环境 = 容器后端（:$(API_PORT)）+ vite 页面（:$(WEB_PORT)，前台运行）。
# 相当于依次跑 make dev-container-backend && make dev-web，只是省得开两个终端。
# - web/dist 已存在时只重建 Go 后端（~2s）；缺了才走完整 dev-container（含 npm run build）。
# - Ctrl+C 只停 vite；容器留在后台继续跑（要停：docker rm -f tswui-dev）。
# - 之后只改 web/ 就不要重复跑本目标了，直接（或重新）`make dev-web`。
# - 想让 HMR 也落在 18080（后端让位）：make dev-all WEB_PORT=18080 API_PORT=18081
dev-all:
	@if [ -f web/dist/index.html ]; then \
	  echo "==> 复用现有 web/dist，只重建后端"; \
	  $(MAKE) --no-print-directory dev-container-backend; \
	else \
	  echo "==> web/dist 缺失，先完整构一次"\
	  $(MAKE) --no-print-directory dev-container; \
	fi
	@$(MAKE) --no-print-directory dev-web

# 只重建前端 dist（无需重启容器，刷新浏览器即可）。相当于「没有 HMR 的快速验证」。
dev-container-frontend:
	PORT=$(API_PORT) scripts/dev-container.sh frontend

# 只重建后端并重启容器（改了 Go 代码时用）。
dev-container-backend:
	PORT=$(API_PORT) scripts/dev-container.sh backend

# ---- 交付验证 ------------------------------------------------------------
# 真镜像（多阶段构建 + distroless），默认映射 :18080 —— 与 make dev-container / dev-all
# 抢同一端口，所以验证镜像前先停掉开发容器，或 NO_BUILD=1 PORT=18088 make image 换个口。
image:
	scripts/run-container.sh

# 单文件二进制（内嵌前端与 data），产物在 dist/。
binary:
	scripts/build-binary.sh

# ---- 清理 ----------------------------------------------------------------
# 只删构建产物与 server/internal/webdist 里的注入内容，不动 data/ 与源码。
clean:
	rm -rf dist
	rm -rf web/dist
	find server/internal/webdist -mindepth 1 ! -name .gitkeep -delete 2>/dev/null || true
	rm -rf plugin/WebUI/bin plugin/WebUI/obj
