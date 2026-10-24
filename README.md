# TShockWebUI

Terraria **TShock** 服务器的**玩家 Web 指令伴侣**：在浏览器里舒服地编辑指令、自动补全、
搜索物品并插入 `[i:...]` 标签，然后通过后端执行并看到**真实**的游戏输出。

- 交付形态：**单个 Docker 镜像**（前端 + Go 后端合一），一个端口，`http://IP:8080` 或 `https://域名` 都能用。
- 目标版本：**Terraria 1.4.5.8** / **TShock 6.2.1**，REST 端口 `7878`。
- 权限模型：以 **token 用户的用户组**身份执行，**严格继承权限、不提权**；不是服务器管理后台。

> 浏览器**不持有 TShock token**：密码只在 `POST /api/login` 的请求体里，token 只存在于后端内存，
> 浏览器拿到的是 `HttpOnly` Cookie。

---

## 功能

| 模块 | 说明 |
| --- | --- |
| 指令编辑器 | 单行输入（原生 `textarea`，中文输入法/光标/撤销不受影响），`Enter` 执行，`Ctrl/Cmd+Enter` 亦可 |
| 自动补全 | 指令名 / 别名 / 玩家名 / **参数值**（物品、词缀、枚举值、指令名）；按 TShock 源码用法串逐位判定参数类型；`↑/↓` 选择，`Enter`/`Tab` 接受，`Esc` 关闭 |
| 指令帮助 | 取自 TShock i18n 的中/英文帮助文本，随界面语言切换；编辑器下方显示当前参数的**用法串**；`allowServer=false` 的指令标红并说明「只能在游戏内执行」 |
| 物品搜索 | 按 ID / 中文名 / 英文名 / 内部名搜索（本地索引、防抖），可插入 `[i:ID]` 标签、ID、名称或英文名 |
| 物品图鉴 | 49 个物品集合、分页浏览、随机「换一批」；悬停图标弹出**游戏同款属性提示**（伤害/暴击/击退/防御…） |
| 合成表 | 本地合成表（`recipes.json`）展示「怎么合成 / 可用它合成什么」，不依赖服端指令与登录 |
| 富文本结果 | 解析 Terraria `[c/RRGGBB:text]` 颜色与 `[i:ID]` 图标标签，与 1.4.5.8 `ChatManager` 规则一致 |
| 物资申请 | 玩家搜索物品、填数量与用途提交给服主；服主在游戏内 `/web req` 或网页「待审核」审核，在线立即发放 / 离线下次登录发放（需信使插件 + `webui.request.use` / `review`） |
| 历史 / 草稿 / 收藏 | 全部存本机 `localStorage`（`tswui:*`），上限 100，不自动执行 |
| 会话 | 后端内存会话 + TTL；TShock 重启后刷新页面即回登录；执行遇 `token_invalid` 会弹登录框并**自动重试一次** |
| 多服务器切换 | 可选（默认关）。开启后可在界面维护多个 TShock 上游并用 `X-TSWUI-Target` 快速切换 |
| 界面 | shadcn/ui（new-york / slate），light/dark，中/英双语，无顶栏 + 可折叠侧栏，移动端抽屉式导航 |

界面默认主题为 dark；图标来自仓库内 `data/items-atlas.png`（生成物，版权属 Re-Logic）。

---

## 架构

```
浏览器 (React SPA, base=/)
  ├─ 静态资源  /assets/*  /data/*        ← Go 内嵌提供
  ├─ 本机记忆  localStorage（无 token）
  └─ 同源 API  /api/*                    ← 唯一后端接口
                     │
                     ▼
单容器镜像 (~13MB, distroless)
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
- 启动时后端探测 TShock `server/status`，与 `data/meta.json` 的 `gameVersion` 比对，不一致时告警。

详见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## 快速开始（Docker）


```bash
# 1) 构建镜像
docker build -t tshockwebui:latest .

# 2) 运行（TShock 在宿主机 :7878 时）
docker run -d --name tswui -p 8080:8080 \
  -e TSHOCK_URL=http://host.docker.internal:7878 \
  -e TSHOCK_ALLOW_CUSTOM_TARGETS=true \
  tshockwebui:latest
# 3) 打开 http://127.0.0.1:8080
```

或者用脚本（自动构建 + 探活 + 报告 TShock 可达性）：

```bash
scripts/run-container.sh                      # 映射到 :18080
PORT=8080 NETWORK=ts_default TSHOCK_URL=http://tshock:7878 scripts/run-container.sh
NO_BUILD=1 scripts/run-container.sh           # 跳过构建，用现有镜像
```

与 TShock 同机部署可直接参考 [`deploy/docker-compose.example.yml`](deploy/docker-compose.example.yml)：

```bash
docker compose -f deploy/docker-compose.example.yml up -d
```

> Linux 上脚本会自动加 `host.docker.internal:host-gateway`；macOS/Windows 的 Docker Desktop 自带该域名。

### TShock 侧前置条件（很重要）

1. `config.json`：`RestApiEnabled = true`、`RestApiPort = 7878`。
2. **给玩家用户组赋权**，否则密码正确也登不上（TShock 对「密码错」与「无权限」都返回 403）：

   ```
   /group addperm default tshock.rest.useapi tshock.rest.command
   ```

   - `tshock.rest.useapi`：允许创建 token（登录）
   - `tshock.rest.command`：允许执行指令
   - 带 `*` 的组（GM / newadmin / trustedadmin…）无需配置。
3. 经反代后 TShock 只看到网关 IP，所有玩家共用一个限流桶；建议调大
   `RESTMaximumRequestsPerInterval`（如 `60`）。
4. `7878` 尽量只对 WebUI 容器网络开放，不要暴露到公网。
5. 可选：用 `ApplicationRestTokens` 里的令牌免密登录（界面 `POST /api/login {token}`）。

---

## 单文件运行（macOS / Windows / Linux）

不需要 Docker、不需要 Node、不需要任何外部静态文件：前端产物 + `data/*.json` + 图集
全部由 `server/main.go` 的 `//go:embed all:internal/webdist` 内嵌进一个 Go 二进制，
运行后同时提供 Web 前端与 `/api/*` 后端。

```bash
scripts/build-binary.sh                       # 为当前系统构建 → dist/tswui
SKIP_WEB=1 SMOKE=1 scripts/build-binary.sh    # 复用 web/dist，构建后自动探测 /healthz 与 /
GOOS=windows GOARCH=amd64 scripts/build-binary.sh   # 交叉编译 → dist/tswui.exe
GOARCH=arm64 OUT=dist/trweb scripts/build-binary.sh # 换架构 / 自定义输出
VERSION=1.2.3 scripts/build-binary.sh          # 指定版本号（默认取 git describe）

./dist/tswui -version                         # tswui 1.2.3 (go1.27.2 darwin/arm64)
./dist/tswui                                  # → http://127.0.0.1:8080
LISTEN=:9000 TSHOCK_URL=http://192.168.1.10:7878 ./dist/tswui
```

**版本号**：`main.version` 由 `-ldflags "-X main.version=..."` 注入，三个地方可见——
`-version` 参数、启动日志、`GET /healthz`（`{"status":"ok","version":"..."}`）。
未注入时一切都是 `dev`。默认值取 `git describe --tags --always --dirty`；Docker 构建用
`--build-arg VERSION=...`（`scripts/run-container.sh` 自动传）。

Windows（PowerShell 5.1+ / 7+，见 [`scripts/build-binary.ps1`](scripts/build-binary.ps1)，
**该脚本尚未在 Windows 实机验证**）：

```powershell
.\scripts\build-binary.ps1 -SkipWeb -Smoke
.\dist\tswui.exe
```

实测（本机 darwin/arm64 构建 + 运行，无 `WEB_DIST_DIR`、纯内嵌资源）：

| 目标 | 编译 | 体积 | 运行验证 |
| --- | --- | --- | --- |
| darwin/arm64 | ✅ | 14 MB | ✅ `/` `/healthz` `/api/status` `/data/items-atlas.png` SPA 兜底 全部 200 |
| darwin/amd64 | ✅ | 15 MB | — |
| windows/amd64 | ✅ | 15 MB | 未在 Windows 实机运行 |
| linux/arm64 | ✅ | 14 MB | — |

注意：

1. **必须先把前端构建进 `server/internal/webdist/`**（脚本会自动做）；`webdist` 为空时二进制能编译，
   但启动即报 `内嵌前端资源缺少 index.html`。`WEB_DIST_DIR` 是「读磁盘」的开发模式，不是单文件模式。
2. `data/`（含图集 PNG）随仓库提交；构建脚本会先检查文件是否齐全，缺了就提示生成命令。
3. 脚本一律以仓库根 `data/` 为数据唯一来源；前端已移除 `web/public/data` 符号链接（改为 Vite 插件 + Docker `COPY data/ /data/`）。
4. 交叉编译只交叉 Go 部分；前端构建（npm）与平台无关，可在任一平台产出。
5. Windows 首次运行会弹防火墙授权，需放行才能从局域网访问 `:8080`。

---

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
npm run dev          # http://localhost:5173，/api 代理到 :8080（VITE_API_TARGET 可改）
npm run build        # 产物 web/dist/
npm run typecheck && npm run lint && npm run test:run
```

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

## 数据生成（升级游戏版本后必跑）

数据由脚本从**反编译源码与游戏资源**生成到 `data/`（**禁止手改**）：

```bash
node tools/gen-data.mjs          # 物品 / 词缀 / 指令（需 TR_SRC 指向 tr-code-1458）
python3 tools/gen-atlas.py       # 图标图集（需 Pillow，需 SPRITE_DIR）
python3 tools/gen-brand-assets.py # favicon + 登录框插画（猛爪手套，需 Pillow）
bash tools/gen-game-data.sh      # 合成表 + 物品属性（需 dotnet 9，自动还原 TShock NuGet 包）
```

生成后同步后端内嵌副本并自检：

```bash
server/scripts/sync-commands.sh
cd server && go test ./...
```

数据规模（Terraria 1.4.5.8）：物品 **6195**、词缀 **97**、核心指令 **95**、合成表 **3603**、图集 region **6133**。
字段说明见 [`data/README.md`](data/README.md)，图集版权说明见 [`docs/设计原则与约束.md`](docs/设计原则与约束.md) C11。

---

## 配置（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LISTEN` | `:8080` | 监听地址 |
| `TSHOCK_URL` | `http://127.0.0.1:7878` | TShock REST 基址 |
| `TSHOCK_METHOD` | `POST` | 调用 TShock REST 的 HTTP 方法（`GET`/`POST`）；默认 POST 可规避部分机房对明文 GET 的 302 劫持 |
| `COOKIE_SECURE` | `false` | 外层 HTTPS 时设 `true` |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

其余（会话 / 限流 / 多服务器 / 信使插件密钥 / `WEB_DIST_DIR` 等）**完整表见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §5（唯一事实源）**。

---

## API 一览

浏览器只调用同源 `/api/*`（完整契约、错误码与示例见 [`docs/API_SPEC.md`](docs/API_SPEC.md)）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/login` | 登录（账号密码或 `ApplicationRestToken`，仅在 body） |
| POST | `/api/logout` | 退出（销毁上游 token + 清会话） |
| GET | `/api/session` | 会话状态（存在会话时会校验上游 token） |
| GET | `/api/status` | TShock 可用性与版本（`serverversion` 已去前导 `v`） |
| GET | `/api/players` | 在线玩家名（补全用） |
| GET | `/api/servers` | 多服务器切换是否可用 + 默认上游 |
| POST | `/api/command` | 执行指令（后端复检 Tier A + `rawcmd`） |
| GET | `/healthz` | 健康检查（带构建版本号；`?deep=1` 附带 TShock 探活） |

约定：

- **所有非 GET 请求**必须带 `X-Requested-With: tswui`，否则 `403 csrf`。
- 请求级失败用统一错误信封 `{ "error": { "code": "...", "message": "..." } }`。
- **指令执行结果一律 HTTP 200 + `status`**：`ok` / `command_not_found` / `command_error` / `no_permission` /
  `token_invalid` / `unavailable` / `timeout` / `bad_response` / `rejected`。

### 关于 `allowServer=false` 的指令

`/i`、`/tp`、`/home`、`/buff` 等 24 条指令 TShock 的 REST `rawcmd` 无法执行：前端会直接标红拒绝，
后端做同样的复检（纵深防御），统一返回 `rejected`，提示「只能在游戏内执行」，**不发往 TShock**。

未知/插件指令（如 FishShop 的 `/fish`）**不前置拒绝**（`commands.json` 只含核心 95 条，无法静态枚举），
照常发往 TShock 由它判定。真正的权限边界始终在 TShock。

---

## 项目结构

```
TShockWebUI/
├── Dockerfile                  # 多阶段：前端 → Go → distroless（单容器）
├── data/                       # 生成的数据（勿手改）
├── deploy/                     # docker-compose 部署示例
├── dist/                       # 单文件构建产物（脚本生成，不入库）
├── docs/                       # 研究 / 架构 / API / 实施计划 / 专题文档
├── scripts/                    # 开发、单文件构建与交付脚本
├── server/                     # Go 后端（标准库 only）
├── tools/                      # 数据与图集生成器
└── web/                        # 前端（React + Vite + TS + Tailwind）
```

---

## 测试

```bash
# 后端
cd server && go vet ./... && go test -race ./...

# 真实 TShock 联调（默认不跑，需要可用 token）
TSHOCK_URL=http://127.0.0.1:7878 TSHOCK_TOKEN=simpleToken \
  go test -tags integration -run Integration -v ./internal/tshock

# 前端（152 个用例）
cd web && npm run typecheck && npm run lint && npm run test:run

# 端到端冒烟（对已运行的后端）
TSWUI_TOKEN=... server/scripts/smoke.sh
```

---

## 安全与已知限制

- 密码只在 `POST /api/login` body；后端日志不记录 query/body；登录失败提示不区分账号是否存在。
- Cookie `tswui_session`：`HttpOnly`、`SameSite=Strict`、`Path=/`；HTTPS 时 `Secure`（`COOKIE_SECURE=true`）。
- 唯一会落盘的凭据是登录框的「记住密码」（`tswui:login`，默认勾选，可关闭）；浏览器**始终不持有 TShock token**。
- 响应带 `nosniff` / `Referrer-Policy: no-referrer` / `CSP`；登录按 IP 限流。
- 会话仅在内存：容器重启需重登，不支持多副本水平扩展。
- TShock 限流按网关 IP 计数，多玩家共用；只能靠调大阈值缓解（按真实玩家 IP 需插件支持，未实现）。
- 无 HTTPS 时整站依赖可信网络，公网部署请在外层终止 TLS。

---

## 相关文档

| 文档 | 内容 |
| --- | --- |
| [`docs/设计原则与约束.md`](docs/设计原则与约束.md) | 产品原则、范围边界与**已核实的硬约束** |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 架构决策、Go 后端职责、构建部署 |
| [`docs/API_SPEC.md`](docs/API_SPEC.md) | `/api/*` 契约、错误码、前端传输层接口 |
| [`docs/记录-实现与验收.md`](docs/记录-实现与验收.md) | 历史任务与验收记录（非待办） |
| [`docs/TECHNICAL_RESEARCH.md`](docs/TECHNICAL_RESEARCH.md) | 每条 TShock 事实的源码 / 实测出处 |
| [`docs/REST_API限制.md`](docs/REST_API限制.md) | TShock REST API 的全部限制 |
| [`docs/功能-富文本解析.md`](docs/功能-富文本解析.md) | 执行结果的 Terraria 颜色 / 物品标签解析 |
| [`docs/功能-服务器动态.md`](docs/功能-服务器动态.md) | 首页「服务器动态」卡片（事件源 / 契约 / 限制） |
| [`docs/插件接入规范.md`](docs/插件接入规范.md) | 接入第三方 / 自研插件的统一模板与铁律 |
| [`docs/插件-玩家管理.md`](docs/插件-玩家管理.md) | PlayerManager 玩家管理模块（依赖 / REST / 字段） |
| [`docs/插件-鱼店.md`](docs/插件-鱼店.md) | FishShop 鱼店模块（依赖 / REST / 字段） |
| [`docs/插件-世界管理.md`](docs/插件-世界管理.md) | WorldModify 世界管理模块（依赖 / 指令 / 无权限处理） |
| [`docs/插件-信使.md`](docs/插件-信使.md) | 自研信使插件 WebUI：REST / 指令 / 配置 / 权限 |
| [`docs/插件-物资申请.md`](docs/插件-物资申请.md) | 物资申请：端点 / 权限 / 配置 / 发放规则 |
| [`plugin/WebUI/README.md`](plugin/WebUI/README.md) | 信使插件构建 / 部署 / 完整端点表 |
| [`docs/TODO.md`](docs/TODO.md) | 唯一的「还没做」清单 |
| [`docs/页面-物品图鉴.md`](docs/页面-物品图鉴.md) | 物品集合、分页与标签复制 |
| [`docs/功能-合成表与物品提示.md`](docs/功能-合成表与物品提示.md) | 合成表与游戏同款属性提示 |
| [`data/README.md`](data/README.md) | 生成数据字段说明 |
| [`server/README.md`](server/README.md) / [`web/README.md`](web/README.md) | 子项目说明 |
| [`AGENTS.md`](AGENTS.md) | 给编码 Agent 的仓库约定与铁律 |

---

## 版权

物品图标与游戏数据版权归 **Re-Logic** 所有；本仓库收录由本地游戏资源生成的图集 PNG（仅随本项目使用）。
