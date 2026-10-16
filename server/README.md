# TShockWebUI 后端（server/）

Go 1.27，**标准库 only**（`go.mod` 无 require）。职责：

- 内嵌并服务前端静态资源（`/`、`/assets/*`、`/data/*`）；
- 固定的 `/api/*` 契约（`GET /api/session|status|players`、`POST /api/login|logout|command`、`GET /healthz`）；
- 内存会话 + `HttpOnly` Cookie（持有 TShock token）；
- Tier A 前置校验（内嵌 `data/commands.json`，`allowServer=false` / 未知指令直接拒绝）；
- TShock REST 客户端与错误分类。

契约见 `../docs/API_SPEC.md`，架构见 `../docs/ARCHITECTURE.md`。

## 目录

```
server/
├── main.go                       # 启动、路由装配、内嵌 webdist、优雅关闭
├── internal/
│   ├── config/config.go          # env 解析与校验
│   ├── session/store.go          # 内存会话（TTL / 上限 / 并发安全）
│   ├── tshock/client.go          # TShock REST 客户端 + 错误分类
│   ├── tshock/commands.go        # Tier A 校验（内嵌 commands.json）
│   ├── tshock/data/commands.json # data/commands.json 的同步副本
│   ├── api/handlers.go           # /api/* handlers + 静态资源
│   ├── api/middleware.go         # 安全头 / CSRF / 限流 / 日志 / gzip
│   └── webdist/                  # 构建期注入前端产物（本地用 WEB_DIST_DIR 覆盖）
└── scripts/sync-commands.sh      # 同步 commands.json 到内嵌副本
```

## 开发

```bash
# 需要先构建前端（或用 WEB_DIST_DIR 指向 web/dist）
cd web && npm run build

# 启动后端（:8080），指向本机 TShock
cd server && WEB_DIST_DIR=../web/dist TSHOCK_URL=http://127.0.0.1:7878 go run .
```

环境变量（完整表见 `../docs/ARCHITECTURE.md` 第 5 节）：
`LISTEN`、`TSHOCK_URL`、`TSHOCK_METHOD`、`TSHOCK_TIMEOUT`、`COOKIE_SECURE`、`SESSION_TTL`、
`MAX_SESSIONS`、`LOGIN_MAX_PER_MIN`、`COMMAND_MAX_PER_MIN`、`TRUST_PROXY`、`LOG_LEVEL`、`WEB_DIST_DIR`。

## 单文件构建

`server/main.go` 用 `//go:embed all:internal/webdist` 内嵌前端产物（含 `data/` 与图集），
所以只要先把 `web/dist` 与仓库 `data/` 拷进 `internal/webdist/`，`go build` 出来的就是
**单文件、可独立运行**的程序（不需要 Node、Docker 或任何外部静态文件）：

```bash
scripts/build-binary.sh                       # → dist/tswui（自动 npm build + 拷贝 + 编译）
SKIP_WEB=1 SMOKE=1 scripts/build-binary.sh    # 复用 web/dist，构建后探测 /healthz 与 /
GOOS=windows GOARCH=amd64 scripts/build-binary.sh   # 交叉编译 → dist/tswui.exe
VERSION=1.2.3 scripts/build-binary.sh         # 注入版本号（默认 git describe --always --dirty）
```

- `internal/webdist/` 除 `.gitkeep` 外不入库（见根 `.gitignore`）。
- `WEB_DIST_DIR` 非空时改为**读磁盘**（开发模式），不走内嵌资源；两者不要混用。
- `internal/webdist/` 为空时仍可编译，但启动会报 `内嵌前端资源缺少 index.html`。
- 版本号经 `-X main.version` 注入（`main.go` 的 `var version = "dev"`），可用
  `tswui -version`、启动日志、`GET /healthz` 三处确认；CGO_ENABLED=0 静态链接，无运行期依赖。

## 数据同步（版本升级时）

```bash
node tools/gen-data.mjs            # 重新生成 data/
server/scripts/sync-commands.sh    # 同步 commands.json 到内嵌副本
cd server && go test ./...         # 含内嵌副本一致性检查
```

## 测试

```bash
cd server
go vet ./...
go test -race ./...

# 真实 TShock 联调（默认不跑，需要可用 token）
TSHOCK_URL=http://127.0.0.1:7878 TSHOCK_TOKEN=simpleToken \
  go test -tags integration -run Integration -v ./internal/tshock
```

## 冒烟脚本

对已运行的后端做端到端检查（公共端点 + 登录 + 指令 + 安全）：

```bash
# 应用令牌
TSWUI_TOKEN=$TSHOCK_TOKEN server/scripts/smoke.sh
# 账号密码（会调 token/create，受 TShock 限流）
TSWUI_USER=hf TSWUI_PASS=****** server/scripts/smoke.sh
# 自定义地址
TSWUI_BASE=http://127.0.0.1:8080 server/scripts/smoke.sh
```

## 已知实现要点

- **登录必须 query string**：`POST /v2/token/create` 的表单体不被 TShock 解析（会 500）。
- **403 语义用 `/tokentest` 判定**：中文服务器把 token 写作“令牌”，仅靠文案会误判。
- **命令输出需解析文本**：`rawcmd` 对「权限不足 / 无效指令 / 仅限游戏内」返回 HTTP 200，
  提示在 output 里，且已本地化；`classifyOutput` 同时匹配中英文。
- **`/v2/players/list` 返回对象数组**，昵称字段是 `nickname`。
