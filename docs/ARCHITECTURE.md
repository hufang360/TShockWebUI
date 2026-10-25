# ARCHITECTURE.md — 容器化技术架构（Go 后端）

文档版本：band3-1.0
适用范围：需求已实现；产品原则、范围与硬约束见 `docs/设计原则与约束.md`，本文是其架构落地。
**本文件与 `API_SPEC.md`、`记录-实现与验收.md` 一起，是新 Agent 开工的完整输入。**

---

## 0. 背景与变更原因

阶段 0 的结论是「纯静态、无后端、token 存 localStorage」，那是基于「nginx 反代 `/tshock/`」的早期部署方案。
该方案已被淘汰，相关配置与预览站点已从仓库移除。

我们在这里把架构升级为「单容器 + Go 极薄后端」，同时解决阶段 0 联调中实测到的两个真问题：

1. TShock `POST /v2/token/create` **不解析表单体**（会 500），登录凭证只能走 query string → 浏览器直连时密码会出现在 URL / 反代日志里。
2. TShock token 是可移植的 bearer，放在 `localStorage` 一旦 XSS 就会被盗走。

---

## 1. 决策记录（ADR）

| # | 决策 | 理由 |
| --- | --- | --- |
| ADR-1 | **单容器交付**：前端静态资源 + Go 后端 + TShock 反代合一 | 一份镜像、一个端口，IP:端口 / 域名都能用 |
| ADR-2 | **后端用 Go 1.27，标准库 only**，`CGO_ENABLED=0` 静态二进制 | 实测全量（含前端 + data）约 **16MB**；零依赖、无供应链风险、跨架构交叉编译 |
| ADR-3 | 运行时基础镜像用 **`gcr.io/distroless/static-debian12:nonroot`**（备选 `scratch`） | 加 ~2MB，自带 CA 证书（可反代 HTTPS 的 TShock）、非 root |
| ADR-4 | **浏览器不再持有 TShock token**；后端内存会话 + `HttpOnly` Cookie | token 不进 JS，XSS 无法直接搬走；凭证改走 POST body |
| ADR-5 | 浏览器**只调用固定 `/api/*`**，容器**不暴露通用 `/tshock/` 代理** | 收窄攻击面，避免「任意 URL 转发」；只暴露业务所需端点 |
| ADR-6 | 生产前端 `base=/`，API 用相对路径 `/api`、数据用 `/data`；GitHub Pages 演示用 `VITE_BASE=/<repo>/` | 同一份构建适配 `http://IP:8080` 与 `https://域名`；Pages 仅静态演示 |
| ADR-7 | TLS 由**外层**（Caddy/Nginx/Cloudflare）终止；容器内 HTTP `:8080` | 镜像保持小且简单；IP:端口 场景直接跑 HTTP |
| ADR-8 | 保留 **Mock 传输**，作为离线开发/自动化测试用，界面必须显式标注 | 不把 Mock 冒充真实功能（AGENTS 铁律） |
| ADR-9 | 已知 `allowServer=false` 由**前端和后端双重拒绝**；未知/插件指令**放行给 TShock 判定**（后端内嵌 `commands.json`） | 纵深防御；插件指令无法静态枚举，TShock 仍是最终权限边界 |
| ADR-10 | 会话仅存内存，进程重启即失效 | 无数据库、镜像无状态，代价是重启后需重登（可接受） |
| ADR-11 | 不做水平扩展（单实例） | 内存会话；玩家工具，单实例足够 |

---

## 2. 组件与数据流

```
浏览器 (React SPA；生产 base=/，GitHub Pages 演示为子路径)
  │  同源 fetch
  ├─ GET  /data/*.json  /data/items-atlas.png      ← Go 内嵌静态资源
  ├─ GET  /assets/*                                 ← Go 内嵌静态资源
  ├─ POST /api/login      {username,password}       ← 密码只在 body
  ├─ POST /api/login/online {username}              ← 「在线授权」，最多阻塞 60s
  ├─ GET  /api/capabilities                         ← 统一能力矩阵（一次拿到全部可选能力）
  ├─ GET  /api/webauth/capabilities                 ← 探测「在线授权」插件（分端点，按需）
  ├─ POST /api/batch      {cmds:[...]}              ← 首页「统一执行」批量跑
  ├─ GET  /api/batch/capabilities                   ← 探测「批量执行」插件（分端点，按需）
  ├─ POST /api/logout
  ├─ GET  /api/session
  ├─ GET  /api/status
  ├─ GET  /api/players
  └─ POST /api/command    {cmd}                     ← Cookie 会话
        │
        ▼
Go 后端（单进程，标准库）
  ├─ 静态资源服务（内嵌 webdist：index.html/assets/data）
  ├─ 会话层：map[sessionID]{username, tshockToken, upstream, exp} + 按上游命名的随机 Cookie
  ├─ TShock 客户端：/v2/token/create, /token/destroy, /tokentest,
  │                 /v2/server/status, /v2/players/list, /v3/server/rawcmd,
  │                 /webui/auth/*, /webui/restlimit, /webui/batch
  └─ Tier A 前置校验：内嵌 commands.json → 已知 allowServer=false 直接拒绝，未知指令放行
        │
        ▼  服务端发起（token 只出现在这里）
TShock REST API  (env TSHOCK_URL，默认 http://127.0.0.1:7878)
  └─ WebUI 信使插件（可选）：
       ├─ /webui/auth/{request,poll,cancel} → 玩家在游戏内 /web auth <code> 同意 → 插件铸造 REST token
       ├─ /webui/batch → 按 token 用户组逐条执行指令（与 rawcmd 同权限；`mode=player` 可跑 AllowServer=false，需显式开启）
       ├─ /webui/restlimit → TShock 建令牌限流只读快照（调用者自己 IP）；后端据此精确判 `rate_limited`
       ├─ /webui/{commands,me,data,serverinfo,events} → 只读信息；/webui/auth/{sessions,revoke} → 会话自助管理
       ├─ /webui/{chat} → 网页发言（带 [WebUI] 前缀）
       ├─ /webui/requests* → 物资申请（玩家提交 / 服主审核 / 补发；见 docs/插件-物资申请.md）
       └─ 高级指令 `/web limit [值|unlimited|default]` → 查看/放宽 RESTMaximumRequestsPerInterval（需 webui.admin + tshock.rest.cfg）
```

关键点：**TShock token 只存在于后端内存**，只出现在 Go → TShock 的出站请求里；浏览器、Cookie、URL、日志里都没有它。
「在线授权」是除密码之外的替代登录：**不新增权限**（仍要求 `tshock.rest.useapi`，token 权限与密码登录完全一致），
只是把「知道密码」换成「在线玩家本人在游戏内确认」。详见 `docs/API_SPEC.md` §1.1。

---

## 3. 目录结构

```
TShockWebUI/
├── AGENTS.md
├── Dockerfile                    # 预构建 web/dist → Go 交叉编译 → distroless（见 6.1）
├── data/                         # 生成的数据（勿手改；含图集 PNG）
├── deploy/                       # docker-compose 示例
├── docs/                         # 架构 / 接口 / 插件 / 专题文档
├── plugin/WebUI/                 # 信使插件（C# / net9.0，引用 TShock 6.2.1）
├── scripts/                      # 开发 / 构建 / 交付脚本
├── tools/                        # 数据与图集生成器（node / python / dotnet）
├── server/                       # Go 后端（标准库 only）
│   ├── main.go                   # 启动、路由、静态服务（//go:embed webdist）
│   ├── internal/
│   │   ├── api/                  # /api/* handlers、middleware
│   │   ├── config/               # env 解析
│   │   ├── plr/                  # .plr 存档解析（AES-128-CBC）
│   │   ├── session/              # 内存会话 + TTL
│   │   ├── tshock/               # TShock 客户端、错误分类、各插件客户端、commands.json
│   │   └── webdist/              # 前端产物（构建期注入，//go:embed）
│   └── scripts/                  # smoke.sh / sync-commands.sh
└── web/                          # 前端（React + Vite + TS + Tailwind）
```

Go 侧**不引入任何第三方模块**（`go.mod` 无 require）。gzip、路由（`http.ServeMux`）、Cookie、限流都用标准库实现。

## 4. Go 后端职责（详细）

### 4.1 静态资源
- `//go:embed all:webdist` 内嵌 `web/dist` 全部内容（构建期由脚本拷入 `server/internal/webdist/`；Dockerfile 消费预构建的 `web/dist`，不在镜像内跑 Node）。
- 路由：`/`、`/assets/*`、`/data/*`、`/favicon.png`（猛爪手套物品图标，`tools/gen-brand-assets.py` 生成）。
- 未命中的非 `/api` 路径回退到 `index.html`（SPA 兜底）。
- 缓存头：`/assets/*`（带哈希）`Cache-Control: public, max-age=31536000, immutable`；`/data/items-atlas.png` `max-age=604800`；JSON `max-age=3600`。
- 对文本类型（`text/html`、`text/css`、`application/javascript`、`application/json`、`image/svg+xml`）启用 gzip（自定义中间件，`gzip.Writer`，`Content-Encoding` 协商）。

### 4.2 会话层（`internal/session`）
- `Store`：`sync.RWMutex` + `map[string]*Session`。
- `Session{ ID, Username, TShockToken, CreatedAt, LastSeen }`。
- `ID` = `crypto/rand` 32 字节 → `base64.RawURLEncoding`。
- Cookie：名 `tswui_session`，`HttpOnly`、`SameSite=Strict`、`Path=/`、`Secure`（由 env 控制）。
- TTL：空闲超时（默认 12h），每次命中刷新 `LastSeen`；后台或惰性清理过期会话。
- 上限：`MaxSessions`（默认 10000）防止内存膨胀。
- 退出/`token_invalid` → 删除会话并清除 Cookie。

### 4.3 TShock 客户端（`internal/tshock`）
- 全部走 `TSHOCK_URL`，超时 `TSHOCK_TIMEOUT`（默认 10s）。
- **出站方法由 `TSHOCK_METHOD` 控制**（默认 `POST`，可设 `GET`）。TShock 不校验方法（只按 URI 路由），
  二者对所有端点等价；默认 POST 是为了规避部分机房把明文 GET 劫持成 302（实测腾讯云未备案域名拦截，
  见 `docs/REST_API限制.md` 第 1 节）。
- 参数**一律只在 query string**（TShock 不解析请求体），请求体恒为空。
- 方法（下文的 `{METHOD}` 即 `TSHOCK_METHOD`）：
  - `CreateToken(ctx, username, password)` → `{METHOD} {URL}/v2/token/create?username=..&password=..`
    （**必须 query**；表单体会 500，见 TECHNICAL_RESEARCH 2.2）
  - `DestroyToken(ctx, token)` → `{METHOD} {URL}/token/destroy/{token}?token=`
  - `TokenTest(ctx, token)` → `{METHOD} {URL}/tokentest?token=`
  - `ServerStatus(ctx, tokenOrEmpty)` → `{METHOD} {URL}/v2/server/status[?token=]`
  - `PlayersList(ctx, token)` → `{METHOD} {URL}/v2/players/list?token=`
  - `RawCmd(ctx, token, cmd)` → `{METHOD} {URL}/v3/server/rawcmd?cmd=<urlencode>&token=`
- 出站日志**只记录 endpoint，不记录 query**（token 在 query）。
- 错误分类（对应 `docs/设计原则与约束.md` §5 的结果模型）：
  - `401` → `bad_credentials`（登录）/ `token_invalid`
  - `403` 且 body 含 `token` → `token_invalid`；否则 `no_permission`
  - `5xx` / 连接失败 → `tshock_unavailable`
  - 超时 → `timeout`
  - 其他非 2xx / 非法 JSON → `bad_response`

### 4.4 Tier A 前置校验（`internal/tshock/commands.go`）
- 内嵌 `commands.json`（与前端同一份数据）。
- 解析指令首 token（去前导 `/`，取别名），查表：
  - 未知/插件指令（不在表内）→ **放行**，交由 TShock 判定（不存在 → `command_not_found`）。
  - `allowServer === false` → `{status:"rejected", message:"只能在游戏内执行"}`，不调用 TShock。
  - 允许 → 调 `RawCmd`。
- 这是纵深防御，不是权限边界；真正权限在 TShock（token 用户组的 `CanRun`）。

### 4.5 中间件（`internal/api/middleware.go`）
- 安全响应头（对所有响应）：`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、
  `Content-Security-Policy`（与前端 meta 一致：`default-src 'self'; ...; connect-src 'self'`）。
  若由外层终止 TLS，CSP 也可在外层下发，二者取一即可（内建更省事）。
- CSRF：所有 `POST /api/*` 必须带请求头 `X-Requested-With: tswui`，否则 `403 csrf`。
  配合 `SameSite=Strict` Cookie，足以挡住跨站表单提交。
- 缓存：`/api/*` 的 JSON 响应统一 `Cache-Control: no-store`（响应随登录态变化，禁止浏览器复用）；
  只有 `/assets/*`、`/data/*` 这类静态资源才走长缓存（见 §4.1）。
- 会话按上游隔离：`session.Session.Upstream` 记录所属上游，Cookie 名按上游派生
  （默认 `tswui_session`，自定义上游 `tswui_session_<hash>`）；上游不符一律视为未登录，
  绝不把 A 服的 token 发往 B 服（多服务器切换见 `docs/API_SPEC.md` §10）。
- 登录限流：按客户端 IP（`RemoteAddr`，可选 `X-Forwarded-For` 当 `TRUST_PROXY=true`）每 IP 每分钟 `LOGIN_MAX_PER_MIN` 次，超出 `429 rate_limited`。
- 指令执行限流：按**会话**（每个已登录玩家一个桶，`COMMAND_MAX_PER_MIN`/分钟），超出 `429 rate_limited`；
  在会话校验之后判定，未登录请求仍返回 `401`。按会话而非 IP 计数，避免经反代时所有玩家共用来源 IP 而互相限流。
- 访问日志：`method path status duration`，**绝不记录 query 与 body**。

### 4.6 健康检查
- `GET /healthz` → `200 {"status":"ok"}`
- `GET /healthz?deep=1` → 额外探测一次 TShock `server/status`，返回 `tshock_reachable: bool`（不返回 5xx）。
  两者都带后端构建版本号 `version`（`-X main.version` 注入，未注入为 `"dev"`）。

---

## 5. 配置（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LISTEN` | `:8080` | 监听地址 |
| `TSHOCK_URL` | `http://127.0.0.1:7878` | TShock REST 基址（同机 compose 用 `http://tshock:7878`） |
| `TSHOCK_METHOD` | `POST` | 调用 TShock REST 的 HTTP 方法：`GET` / `POST`。TShock 不校验方法；默认 POST 用于规避部分机房对未备案域名明文 GET 的 302 劫持 |
| `TSHOCK_TIMEOUT` | `10s` | 出站超时 |
| `COOKIE_SECURE` | `false` | 外层 HTTPS 时设 `true` |
| `SESSION_TTL` | `12h` | 会话空闲超时 |
| `MAX_SESSIONS` | `10000` | 会话数上限 |
| `LOGIN_MAX_PER_MIN` | `10` | 每 IP 每分钟登录尝试上限 |
| `COMMAND_MAX_PER_MIN` | `60` | 每个会话（玩家）每分钟指令执行上限 |
| `TRUST_PROXY` | `false` | 是否信任 `X-Forwarded-For`（仅当外层是自己可控的反代时开启） |
| `TSHOCK_ALLOW_CUSTOM_TARGETS` | `false` | 允许浏览器用 `X-TSWUI-Target` 切换 TShock 上游（多服务器；仅 host:port，见 API_SPEC §10）。公网部署建议保持 `false` |
| `TSWUI_AUTH_SECRET` | 空 | 与 WebUI 信使插件共享的密钥（插件 `Secret`）。两者都为空时不校验；公网部署务必设置 |
| `WEBAUTH_TIMEOUT` | `60s` | 「在线授权」等待玩家在游戏内确认的总时长 |
| `TSWUI_ALLOW_INGAME_COMMANDS` | `false` | Tier B：允许 `allowServer=false` 的指令交给插件以真实在线玩家身份执行（需插件侧同步开启） |
| `LOG_LEVEL` | `info` | `debug|info|warn|error` |

启动时打印一份**脱敏**配置（打印 `TSHOCK_URL` 但不打印任何凭证）。

---

## 6. 构建与部署

### 6.1 Dockerfile（预构建前端 + Go 交叉编译）

根目录 [`Dockerfile`](../Dockerfile)：**先用 `make web`（CI 由 `web` job 产出并下载 `web-dist`）生成 `web/dist`**，
再交给 `golang:1.27-alpine` 编译静态二进制（内嵌 `web/dist` 与 `data/`）→
`gcr.io/distroless/static-debian12:nonroot` 运行。**以根文件为唯一来源，此处不再内嵌副本（避免漂移）**。

- **前端只构建一次**：二进制 / GitHub Release 资产 / Docker 镜像共用同一份 `web/dist`。
- **不在镜像里跑 Node**：Dockerfile 只保留 Go 构建；`scripts/run-container.sh` 会在 `docker build` 前自动构建前端。
- **Go 在 `BUILDPLATFORM` 上交叉编译**：`GOOS=$TARGETOS GOARCH=$TARGETARCH` + `CGO_ENABLED=0`，
  arm64 镜像不再在 QEMU 里跑 Go 编译器；最终 distroless 阶段仍按目标平台生成。
- **可复现构建**：基础镜像按 digest 固定；Go 使用 `-trimpath -buildvcs=false -ldflags="-s -w -buildid= ..."`。
- 体积参考（本机实测）：二进制 ~16MB + distroless ~2MB → **镜像约 19–20MB**（amd64 19.9MB / arm64 19.2MB）。
- 多架构（先构建前端）：

  ```bash
  make web
  docker buildx build --platform linux/amd64,linux/arm64 -t tshockwebui .
  ```

- 若 TShock 走 HTTPS 且想再省：可换 `scratch`，但需自行注入 CA 证书；默认用 distroless。

### 6.2 docker-compose 示例（与 TShock 同机）

完整示例见 [`deploy/docker-compose.example.yml`](../deploy/docker-compose.example.yml)（**唯一来源**）：

```bash
docker compose -f deploy/docker-compose.example.yml up -d
```

要点：`TSHOCK_URL=http://tshock:7878`、无外层 TLS 时 `COOKIE_SECURE=false`、`webui` 依赖 `tshock`；
7878 只让 `webui` 容器访问，不对外。

### 6.3 访问方式

| 场景 | 访问 | 说明 |
| --- | --- | --- |
| 直接 IP:端口 | `http://<ip>:8080` | 明文 HTTP，建议仅内网/可信网络 |
| 套域名 + 外层 TLS | `https://tr.example.com` → 反代到 `:8080` | 外层设 `COOKIE_SECURE=true`；容器内仍是 HTTP |

外层反代不需要再配 `/tshock/`——浏览器只走 `/api/*`。


### 6.4 GitHub Pages（仅静态演示）

前端单独部署到 GitHub Pages 时没有同源 `/api/*`，因此构建固定使用 `VITE_TRANSPORT=mock`，
页面顶部会明确显示「演示模式，未连接真实服务器」。纯本地功能（物品 ID / 数据 ID / 查看存档 / 查看世界）正常；
**不能执行真实指令、不能登录真实 TShock**。

- 地址：<https://hufang360.github.io/TShockWebUI/>
- 工作流：`.github/workflows/pages.yml`
- 构建：`VITE_TRANSPORT=mock VITE_BASE=/<repo>/ npm run build`
- 生产部署仍以单容器 + 同源 `/api/*` 为准（§6.1）；Pages 只是展示用前端。

---

## 7. 开发工作流

```bash
# 1) 生成数据（版本变化时）
node tools/gen-data.mjs && python3 tools/gen-atlas.py

# 2) 后端（先跑，监听 :8080；指向本机 TShock）
cd server && TSHOCK_URL=http://127.0.0.1:7878 go run .

# 3) 前端开发服务器（:5173，/api 代理到 :8080）
cd web && npm run dev
```
- `web/vite.config.ts` 增加 `server.proxy`：`/api` → `http://localhost:8080`。
- 生产构建时前端 `base=/`；开发时也用 `/`。GitHub Pages 演示构建用 `VITE_BASE=/<repo>/` + `VITE_TRANSPORT=mock`，见 `.github/workflows/pages.yml`。
- Go 本地运行需要 `server/internal/webdist/` 有内容（或回退到从 `web/dist` 读盘，见 `记录-实现与验收.md`）。推荐：本地用 `WEB_DIST_DIR=../web/dist` 覆盖内嵌资源，避免每次 rebuild。

### 前端传输层（现状）

- 契约在 `web/src/lib/transport.ts`（`BackendTransport`），真实实现 `httpTransport.ts`，
  离线实现 `mockTransport.ts`，入口 re-export `tshock.ts`。
- 用 `VITE_TRANSPORT=mock|http` 切换（默认 `http`）；Mock 必须在界面上显式标注。
- 浏览器**不持有 TShock token**：登录态由 `GET /api/session` + `HttpOnly` Cookie 维持，
  `tswui:auth` 已废弃；`rawcmd`/`playersList` 不再由前端传 token。

---

## 8. 测试策略

### Go（`go test ./...`）
- `session`：创建/过期/上限/删除。
- `tshock`：用 `httptest.Server` 伪造 TShock，覆盖 200/401/403(token)/403(perm)/500/超时 的分类。
- `commands`：`allowServer=false` 拒绝、未知指令放行、别名解析（用真实 `commands.json`）。
- `api` handler：登录成功/失败、未认证访问、CSRF 缺失、限流、`/api/command` 全流程（fake TShock）。
- 版本规范化：`v1.4.5.8` → `1.4.5.8`。

### 前端（`vitest`）
- 现有 33 个用例保留；新增 `HttpTransport` 的 URL/错误映射测试（`fetch` mock）。
- 保留 App 冒烟测试（Mock 传输）。

### 真实联调（可选，构建标签或脚本）
- `TSHOCK_URL=http://127.0.0.1:7878 go test -tags integration ./internal/tshock`（默认不跑）。
- 手动验收见 `记录-实现与验收.md` 第 5 节。

---

## 9. TShock 侧前置条件（运维 checklist）

1. `RestApiEnabled = true`、`RestApiPort = 7878`（已确认本机环境满足）。
2. 玩家的用户组必须有 **`tshock.rest.useapi`**（建 token）与 **`tshock.rest.command`**（rawcmd）。
   默认 `guest`/`default` 组都没有，需管理员赋权。
3. **调大 `RESTMaximumRequestsPerInterval`**（建议 `60`）：经反代后 TShock 只看到网关 IP，
   所有玩家共用一个限流桶（实测 `<gateway-ip>`），默认 5/分钟会互相影响。
   装了 WebUI 插件后也可在游戏内 / 控制台执行 `/web limit 60`（或 `unlimited`）自动改并保存（需 `webui.admin` + `tshock.rest.cfg`）。
4. 可选：`EnableTokenEndpointAuthentication = false` 让 `/v2/server/status` 公开（否则登录前拿不到版本）。
   后端已兼容两种情况（401 也视为「可达」）。
5. `7878` 尽量只对本容器网络开放，不要暴露到公网。

---

## 10. 已知限制与后续

- 会话在内存：容器重启/多副本 → 需重登、无法水平扩展。
- TShock 限流按网关 IP 计数：只能通过调大阈值缓解；要按真实玩家 IP 需插件读 `X-Forwarded-For`（**尚未实现**）。
- 无数据库：历史/收藏在浏览器 localStorage（`tswui:*`）；服务器动态历史由**插件**按天落盘
  （`tshock/WebUI/events/*.jsonl`，默认保留 7 天 / 50MB），Go 后端本身仍无状态、不落盘。
- IPv6 与 `RemoteAddr` 解析、HTTPS 出站证书等需在实现时覆盖测试。
