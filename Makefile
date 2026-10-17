# TShockWebUI — 常用任务入口（薄封装，真正逻辑在 scripts/ 与各子项目）
#
#   make            # 显示帮助
#   make data       # 生成 data/（需 TR_SRC / SPRITE_DIR / dotnet 9）
#   make web        # 安装依赖并构建前端 → web/dist
#   make lint       # go vet + 前端 typecheck/lint
#   make test       # 后端 go test -race + 前端 vitest
#   make plugin     # 构建信使插件 → plugin/WebUI/bin/Debug/net9.0/WebUI.dll
#   make image      # 构建并运行交付镜像（scripts/run-container.sh）
#   make binary     # 构建单文件二进制（scripts/build-binary.sh）
#   make dev        # 宿主直跑后端（scripts/dev-native.sh）
#   make clean      # 清掉构建产物

SHELL := /usr/bin/env bash

.PHONY: help data web server lint test plugin image binary dev dev-container clean

help:
	@echo "TShockWebUI 任务："
	@echo "  make data          生成 data/（TR_SRC / SPRITE_DIR / dotnet 9）"
	@echo "  make web           安装依赖 + 构建前端（web/dist）"
	@echo "  make server        编译 Go 后端"
	@echo "  make lint          go vet + 前端 typecheck/lint"
	@echo "  make test          后端 go test -race + 前端 vitest"
	@echo "  make plugin        构建信使插件 WebUI.dll"
	@echo "  make image         构建并运行交付镜像（scripts/run-container.sh）"
	@echo "  make binary        构建单文件二进制（scripts/build-binary.sh）"
	@echo "  make dev           宿主直跑后端（scripts/dev-native.sh）"
	@echo "  make dev-container 挂载式容器开发（scripts/dev-container.sh）"
	@echo "  make clean         清理构建产物"

data:
	node tools/gen-data.mjs
	python3 tools/gen-atlas.py
	python3 tools/gen-brand-assets.py
	bash tools/gen-game-data.sh

web:
	cd web && npm ci && npm run build

server:
	cd server && go build ./...

lint:
	cd server && go vet ./...
	cd web && npm run typecheck && npm run lint

test:
	cd server && go test -race ./...
	cd web && npm run test:run

plugin:
	cd plugin/WebUI && dotnet build -c Debug

image:
	scripts/run-container.sh

binary:
	scripts/build-binary.sh

dev:
	scripts/dev-native.sh

dev-container:
	scripts/dev-container.sh

clean:
	rm -rf dist
	rm -rf web/dist
	find server/internal/webdist -mindepth 1 ! -name .gitkeep -delete 2>/dev/null || true
	rm -rf plugin/WebUI/bin plugin/WebUI/obj
