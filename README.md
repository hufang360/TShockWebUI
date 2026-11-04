# TShockWebUI

TShock 伴侣，面向服主，也面向玩家！

围绕着能在 网页 上执行指令来展开，TShock REST API 的，用户和权限遵守tshock那一套。

特色功能：

- 首页，预置了多张指令卡片，常用的 信息查询指令 包装成了卡片，每两分钟自动执行一次，快速获知服务器进展。
- 指令卡片，支持显示绝大多数指令的执行结果，还会显示物品图标（`[i:29]`），鼠标滑过图标还有 物品Tips。可自定义卡片宽度和是否自动执行。
- 物品查询，查物品id，查合成表，查微光分解/转换。搜集了游戏内制作界面的11个分组，还有一些个人偏好的物品id集合。还能模拟武器/饰品的各词缀的属性效果。
- 数据查询，支持查询多种`数据 ID`，包括 物品、NPC、Buff、图格 和 墙。
- 指令小抄，罗列指令用法和详细说明，还能快捷执行（目前体验还比较差，优化中）。
- 查看存档，支持查看 plr格式的玩家存档 和 wld格式的世界存档。也支持修改部分属性，已按 1.4.5.8 的存档格式做写回校验；由于个人能力有限，不保证修改后的存档在游戏里完全没问题。

- 信使插件，搭配本项目的 信使插件，还能和游戏内的玩家进行聊天。玩家搞建筑需要建筑材料，就在网页上提交 物资申请。

- 对接 鱼店 插件，可以在网页上购买鱼店商品。没有人比 🐟鱼店蜘蛛🕷 更懂鱼店，所以还是自己来吧。

- 对接 pm 插件，面向服主，提供查看背包，支持全部的玩家，甚至是离线玩家。网页端也支持导出玩家存档。
- 对接 wm 插件，拥有超多指令，主要面向服主！也有面向玩家的，像 世界信息 / Boss 进度 / 复活 NPC / 清理墓碑 等指令。具体权限由 TShock 按玩家身份判定。

- 多服务器支持，可以添加多个 tshock 服务器并切换（需开启 `TSHOCK_ALLOW_CUSTOM_TARGETS`，默认关）。

## 快速上手

**TShock 侧**
编辑 `config.json` 开启 TShock REST API 服务：

```json
"RestApiEnabled": true,
"RestApiPort": 7878,
"LogRest": true,
"RESTMaximumRequestsPerInterval": 50,
"RESTRequestBucketDecreaseIntervalMinutes": 10,
```

允许普通玩家使用 REST API 功能 + 通过 REST API 执行指令（把 `default` 换成玩家所在的组）：

```bash
/group addperm default tshock.rest.useapi
/group addperm default tshock.rest.command
```

- `tshock.rest.useapi`：允许创建 token（登录）
- `tshock.rest.command`：允许执行指令

安装信使插件：[WebUI-0.1.0-rc.8.dll](https://github.com/hufang360/TShockWebUI/releases/download/v0.1.0-rc.8/WebUI-0.1.0-rc.8.dll)。

---

**电脑端**
下载电脑版本，例如：

- Windows是 [tswui-0.1.0-rc.8-windows-amd64.exe](https://github.com/hufang360/TShockWebUI/releases/download/v0.1.0-rc.8/tswui-0.1.0-rc.8-windows-amd64.exe)
- macOS是 [tswui-0.1.0-rc.8-darwin-arm64](https://github.com/hufang360/TShockWebUI/releases/download/v0.1.0-rc.8/tswui-0.1.0-rc.8-darwin-arm64)
双击启动后，会弹出一个命令行窗口，不要关！
（这个可执行文件里面，包含了 前端产物 + `data/*.json` + 图集，无需nodejs等环境）
然后打开浏览器，访问 [http://127.0.0.1:8080](http://127.0.0.1:8080)
**网页端**

- 添加tshock服务器，中间填写你的联机IP，旁边的 `7878` 是 REST API 端口，一般不用改。
- 登录TShock，需要用到你在TShock服务器里的 玩家名和密码。如果忘了密码，请联系服主重置：`/user password 用户名 新密码`。

---

## 公网部署

**静态页面**
物品ID、数据ID、指令小抄、查看玩家存档、查看世界存档 等工具，不需要登录，也能使用！
如果只是想使用这些工具，可以直接访问： [hufang360.github.io/TShockWebUI/](https://hufang360.github.io/TShockWebUI/)
这个网页没有Go后端，无法和tshock服务器进行通讯。
**docker部署**

```bash
# 拉取镜像
# docker pull hufang360/tshockwebui:0.1.0-rc.8
docker pull ghcr.io/hufang360/tshockwebui:0.1.0-rc.8

# 启动容器
# http://服务器ip:18080
# Linux 上如果解析不了 host.docker.internal，加
#   --add-host host.docker.internal:host-gateway
# 或把 TSHOCK_URL 换成宿主机 IP。
docker run -d --name tswui -p 18080:8080 \
  -e TSHOCK_URL=http://host.docker.internal:7878 \
  -e TSHOCK_ALLOW_CUSTOM_TARGETS=true \
  ghcr.io/hufang360/tshockwebui:0.1.0-rc.8
```

## 架构

```text
浏览器 (React SPA, 生产 base=/, Pages 演示为子路径)
  ├─ 静态资源  /assets/*  /data/*        ← Go 内嵌提供
  ├─ 本机记忆  localStorage（无 token）
  └─ 同源 API  /api/*                    ← 唯一后端接口
                     │
                     ▼
单容器镜像 (~20MB, distroless)
  └─ Go 后端（Go 1.27，标准库 only）
       ├─ 静态资源服务（内嵌 webdist）
       ├─ 内存会话 + HttpOnly Cookie（持有 TShock token）
       ├─ Tier A 前置校验（内嵌 commands.json）
       └─ TShock 客户端 → env TSHOCK_URL
                     │
                     ▼
TShock REST API（默认 http://127.0.0.1:7878，同网络 compose 用 http://tshock:7878）
```

- **只暴露固定 `/api/*`**，不提供通用 `/tshock/` 代理。
- TShock token 只出现在「后端 → TShock」的出站请求里；不会出现在响应体、URL 与日志中。
- 后端在 `/api/status` 里探测 TShock `server/status`，前端与 `data/meta.json` 的 `gameVersion` 比对，不一致时告警。

详见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 本地开发

### 后端（`server/`，Go 1.27，标准库）

```bash
cd web && npm install && npm run build        # 前端产物

cd ../server
WEB_DIST_DIR=../web/dist TSHOCK_URL=http://127.0.0.1:7878 go run .   # :8080

go vet ./... && go test -race ./...
```

### 前端（`web/`，React 19 + Vite + TS + Tailwind）

```bash
cd web
npm install
npm run dev          # http://localhost:5173，/api 代理到 VITE_API_TARGET（默认 :8080）
npm run build        # 产物 web/dist/
npm run typecheck && npm run lint && npm run test:run
```

改 UI 推荐在仓库根用 `make dev-web`：vite 带 HMR 跑在 `:5173`，/api 转发给后端 `:18080`；
不想开两个终端就用 **`make dev-all`**（自动起容器后端 + vite）。容器后端自己就守着 `:18080`，
浏览器直接开 `http://localhost:18080` 是完整应用（旧 dist，无 HMR）。
详见 [`docs/开发速查.md`](docs/开发速查.md)。

无后端时可看纯前端演示（界面会显式标注 **Mock**）：

```bash
VITE_TRANSPORT=mock npm run dev
```

### 脚本速查

```bash
scripts/dev-native.sh                # 宿主直跑后端（绕过容器网络/代理）
BUILD_WEB=1 scripts/dev-native.sh    # 先构建前端再启动
scripts/build-binary.sh              # 构建单文件（内嵌前端+数据），无需 Docker/Node 运行
SMOKE=1 scripts/build-binary.sh      # 同上，构建后自动冒烟探测
VERSION=1.2.3 scripts/build-binary.sh    # 指定版本号（默认 git describe）
scripts/dev-container.sh             # 宿主构建 + 挂载到 distroless 容器，秒级迭代
scripts/dev-container.sh frontend    # 只重建前端：刷新浏览器即可
scripts/dev-container.sh backend     # 只重建后端并重启容器
scripts/run-container.sh             # 构建真镜像并运行（交付验证）
TSWUI_TOKEN=... server/scripts/smoke.sh   # 对已运行后端做端到端冒烟
```

---

## 版权

物品图标与游戏数据版权归 **Re-Logic** 所有；本仓库收录由本地游戏资源生成的图集 PNG（仅随本项目使用）。
