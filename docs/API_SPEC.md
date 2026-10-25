# API_SPEC.md — 后端 HTTP API 契约

文档版本：band3-1.0
对应实现：`server/internal/api`（Go，标准库）。
对应前端：`web/src/lib/tshock.ts` 的 `HttpTransport`。

**这是浏览器与后端之间唯一的接口契约。** 浏览器不直接访问 TShock，也不存在通用 `/tshock/` 代理。

---

## 0. 通用约定

- 基址：同源，**相对路径 `/api`**（`http://IP:8080` 或 `https://域名` 都适用）。
- 请求/响应体：`application/json; charset=utf-8`。
- 缓存：所有 `/api/*` 的 JSON 响应都带 `Cache-Control: no-store`（响应可能随登录态变化，
  例如 `/api/status` 有无 token 拿到的字段不同），浏览器不得复用。
- 认证：`HttpOnly` Cookie `tswui_session`（`SameSite=Strict`）。浏览器 JS **读不到**，也不需要读。
  **多服务器切换时按上游分 Cookie**：默认上游用 `tswui_session`，自定义上游用
  `tswui_session_<8位hash>` —— 各服的会话并存、互不覆盖，也绝不把 A 服的 token 发往 B 服（见 §10）。
- **多服务器切换（可选）**：请求头 `X-TSWUI-Target: http://host:port` 指定本次请求的 TShock 上游；
  缺省/空表示使用后端 `TSHOCK_URL`。后端仅在 `TSHOCK_ALLOW_CUSTOM_TARGETS=true` 时接受，
  并只允许 `http/https` + `host:port`（无路径/查询/账号信息，端口缺省 7878），详见第 10 节。
- **后端→TShock 的出站方法由 `TSHOCK_METHOD` 控制**（默认 `POST`，可设 `GET`）。
  TShock 不校验 HTTP 方法（只按 URI 路由），本文档下文标注的 `POST {TSHOCK_URL}/...`
  在 `TSHOCK_METHOD=GET` 时即为 `GET`；参数始终只在 query string（TShock 不解析请求体）。
- CSRF：所有非 GET 的 `/api/*` **必须**带请求头 `X-Requested-With: tswui`，缺失返回 `403 csrf`。
- 成功响应：`2xx` + 业务 JSON。
- 失败响应：统一错误信封
  ```json
  { "error": { "code": "bad_credentials", "message": "账号或密码错误" } }
  ```
  其中 `code` 是稳定的机器可读标识，`message` 面向玩家。

### 错误码表（`error.code`）

| code | HTTP | 含义 | 前端处理 |
| --- | --- | --- | --- |
| `csrf` | 403 | 缺少 CSRF 头 | 视为前端 bug / 被拦截 |
| `not_authenticated` | 401 | 无会话或会话过期 | 清本地用户状态，回登录 |
| `token_invalid` | 401 | 后端持有的 TShock token 失效 | 后端已清会话 → 回登录 |
| `bad_credentials` | 401 | 账号或密码错误 | 提示「账号或密码错误」 |
| `no_api_permission` | 403 | 账号所属组缺 `tshock.rest.useapi` | 提示联系管理员赋权 |
| `no_permission` | 403 | 已有 token 但缺所需权限（如 `tshock.rest.command`、`playermanager`） | 提示权限不足 |
| `plugin_not_installed` | 501 | 服务器未安装对应第三方 TShock 插件（PlayerManager / FishShop）或信使插件（含物资申请） | 提示「未安装插件」，隐藏模块 |
| `plugin_outdated` | 501 | 插件在装，但版本过旧缺少该端点/能力（如新版才有的 `/webui/chat`；或 v1.6.2 之前的 FishShop 没有 REST 接口） | 提示「插件版本过旧，请升级」（`message` 含版本/能力） |
| `plugin_protocol_mismatch` | 501 | 信使插件与后端协议不兼容 | 提示升级插件或后端；设置页「信使插件诊断」可查看两侧版本 |
| `player_offline` | 404 | 在线授权：目标玩家不在线 | 提示「该玩家不在线」 |
| `online_auth_denied` | 403 | 在线授权：玩家在游戏内拒绝 | 提示「玩家已拒绝授权」 |
| `online_auth_timeout` | 504 | 在线授权：等待确认超时 | 提示重新发起 |
| `online_auth_error` | 400/502 | 在线授权：其它插件业务失败 / 密钥不匹配 | 展示后端 `message` |
| `fishshop_error` | 400 | 鱼店业务失败（钱不够 / 商品不存在 / 商店打烊） | `message` 原样展示 |
| `request_error` | 400 | 物资申请业务失败（超出数量/待审上限、物品被禁用、申请已处理等） | `message` 原样展示 |
| `rate_limited` | 429 | 登录尝试或指令执行过于频繁 | 提示稍后重试，禁用按钮 |
| `tshock_unavailable` | 502 | TShock 不可达 / 5xx | 提示服务不可用 |
| `tshock_timeout` | 504 | 出站超时 | 提示重试，保留输入 |
| `bad_response` | 502 | TShock 返回非法/未知结构 | 通用错误提示 |
| `bad_request` | 400 | 请求体缺失/格式错误，或上游 4xx 业务错误（`message` 为上游原文，如 PlayerManager「未找到玩家」） | 展示后端 `message`（前端 `validation`） |
| `not_found` | 404 | 未知端点 | — |
| `method_not_allowed` | 405 | 方法错误 | — |

> 注意：**指令执行结果用 HTTP 200 + 业务 `status` 字段**表达（见 `/api/command`），
> 只有「请求本身失败」才用上表错误码。这与 TShock 的语义不同，由后端归一化。

---

## 1. `POST /api/login`

登录：后端调 TShock 建 token，建立会话。**密码只出现在请求体，绝不进 URL/日志。**

请求：
```json
{ "username": "alice", "password": "s3cret" }
```
- 限制：`username` 1–32 字符，`password` 1–128 字符；超限 → `400 bad_request`。

**可选扩展：用 TShock `ApplicationRestToken` 登录。**
不传账号密码、改传令牌即可（与账号密码互斥，令牌非空时优先）：
```json
{ "token": "<ApplicationRestTokens 里的令牌>" }
```
- 后端调 `POST {TSHOCK_URL}/tokentest?token=...` 验证并取回关联用户名。
- 令牌只在请求体，浏览器不持久化；权限完全按该令牌关联的用户组（不额外提权）。
- 无效/过期令牌 → `401 token_invalid`。
- 用途：服务器管理员用 `config.json` 的 `ApplicationRestTokens` 让 WebUI 免密登录；
  也可用于联调与自动化测试。

成功 `200`（并 `Set-Cookie: tswui_session=...`）：
```json
{ "username": "Alice" }
```
失败：
- 账号密码错 → `401 bad_credentials`
- 账号存在但组缺 `tshock.rest.useapi` → `403 no_api_permission`
- 限流 → `429 rate_limited`
- TShock 不可达 → `502 tshock_unavailable` / `504 tshock_timeout`

> **普通玩家默认无法登录**：`default` 组没有 `tshock.rest.useapi` / `tshock.rest.command`，
> 密码正确也会被拒（与密码错同为 403，后端无法区分）。服主需执行：
> `/group addperm default tshock.rest.useapi tshock.rest.command`。
> 前端在登录失败时会展示该命令并提供复制。

后端行为：
0. （可选）装了 WebUI 信使插件时，先调 `GET {TSHOCK_URL}/webui/restlimit` 看建令牌桶：
   `bucket >= limit` → 直接 `429 rate_limited`（精确，不再受同文案 403 误导）；未装 / 旧版插件（404）→ 跳过。
1. `POST {TSHOCK_URL}/v2/token/create?username=<urlenc>&password=<urlenc>`
2. `200` 且 body 含 `token` → 建会话、写 Cookie。
3. `403` → 统一 `bad_credentials`（TShock 对「密码错 / 无权限 / 限流」返回同一句 403；
   未装插件时无法区分，**不泄露账号是否存在**；装了插件时步骤 0 已排除限流）。
   前端把剩余可能原因渲染成逐条清单。
4. 不把 token 返回给浏览器。

---

## 1.1 `POST /api/login/online`（在线授权登录）

无需密码的登录方式：后端请求 **WebUI 信使插件**向指定在线玩家发送游戏内确认消息，
玩家在游戏内输入指令同意后，插件为其铸造一个 TShock REST token，后端照常建立会话。

请求：
```json
{ "username": "Alice" }
```
- `username` 是**玩家角色名**（1–32 字符）。
- 该请求**会阻塞**，直到玩家同意 / 拒绝 / 超时（默认 60 秒，`WEBAUTH_TIMEOUT`）。
- 该方式要求：玩家在线、已用 TShock 账号 `/login`、账号组有 `tshock.rest.useapi`。

成功 `200`（与密码登录相同，下发 `Set-Cookie: tswui_session=...`）：
```json
{ "username": "Alice" }
```

失败：

| 情况 | HTTP | `error.code` | `message` |
| --- | --- | --- | --- |
| 玩家不在线 | 404 | `player_offline` | 该玩家不在线 |
| 玩家未登录 TShock 账号 | 400 | `online_auth_error` | 插件文案（如「该玩家尚未登录 TShock 账号」） |
| 组缺 `tshock.rest.useapi` | 403 | `no_api_permission` | 联系管理员赋权 |
| 玩家拒绝 | 403 | `online_auth_denied` | 玩家已拒绝授权 |
| 超时未操作 | 504 | `online_auth_timeout` | 等待授权超时，请重新发起 |
| 未安装信使插件 | 501 | `plugin_not_installed` | 服务器未安装 WebUI 信使插件 |
| 插件密钥不匹配 | 502 | `online_auth_error` | 检查 `TSWUI_AUTH_SECRET` 与插件 `Secret` |
| 限流 | 429 | `rate_limited` | 稍后重试 |

The token 仍只在后端内存；插件铸造的 token 与 `/v2/token/create` 的结果同构，权限完全一致。

---

## 1.2 `GET /api/webauth/capabilities`

探测服务器是否安装了「在线授权」信使插件（无需会话）：

```json
{ "plugin": true }
```
- 后端用**空 `name`** 调一次插件 `/webui/auth/request`：404 = 未安装，其它 = 已安装。
- 前端据此决定「在线授权」入口是否可用（未安装时禁用并提示）。

---

## 1.3 `GET /api/plugin/status`（信使插件协议握手 / 诊断）

无需会话：后端用共享 `secret` 调插件 `/webui/meta`（登录前就能探测）。

```json
{
  "installed": true,
  "legacy": false,
  "version": "0.1.0.0",
  "protocol": 1,
  "minProtocol": 1,
  "capabilities": ["auth", "batch", "chat", "commands", "data", "events", "me", "restlimit", "serverinfo", "sessions"],
  "backendProtocol": 1,
  "compatible": true,
  "missingCapabilities": [],
  "reason": "ok"
}
```

- `reason ∈ ok | not_installed | legacy | protocol_mismatch | missing_capabilities`。
- **兼容规则**：`minProtocol ≤ backendProtocol ≤ protocol`，且 `capabilities` 覆盖后端所需能力。
- `legacy=true`：插件在装但没有 `/webui/meta`（旧版），按尽力兼容处理，建议升级。
- 契约与“如何新增能力 / 何时改协议号”见 `docs/插件接入规范.md` §协议握手。
- 前端展示：设置 → 「信使插件诊断」（版本 / 协议 / 能力 / 兼容性）。

---

## 2. `POST /api/logout`

请求：无 body。
成功 `200`：
```json
{ "ok": true }
```
后端行为：调 `POST {TSHOCK_URL}/token/destroy/{token}?token={token}`（失败也继续），删除会话、清 Cookie。

---

## 3. `GET /api/session`

探测当前会话（前端启动时调用）。

成功 `200`：
```json
{ "authenticated": true, "username": "Alice" }
```
或
```json
{ "authenticated": false, "username": null }
```
- **始终 200**，不因为未登录而报错。
- 若存在会话，后端会调用 TShock `/tokentest` 校验上游 token：
  - token 明确失效（401/403）→ 删除会话、清 Cookie，返回 `authenticated:false`
    （**TShock 重启后刷新页面即会回到登录**）。
  - 会话**与上游绑定**：本次请求的上游（`X-TSWUI-Target`）没有自己的会话时，直接返回
    `authenticated:false`，既不会串用别的服的 token，也不会把别的服踢下线。
  - TShock 不可达 / 超时 → **不强制登出**（保留会话，避免误清）。

---

## 4. `GET /api/status`

TShock 可用性与版本探测（对应 `v2/server/status`）。

成功 `200`：
```json
{
  "reachable": true,
  "name": "中秋快乐",
  "serverversion": "1.4.5.8",
  "tshockversion": "6.2.1.0",
  "port": 7777,
  "playercount": 0,
  "maxplayers": 8,
  "world": "中秋快乐",
  "uptime": "0.00:00:18",
  "serverpassword": false
}
```
- `serverversion` / `tshockversion` **已规范化**（去掉 TShock 返回的前导 `v`，如 `v1.4.5.8` → `1.4.5.8`）。
- `uptime` / `serverpassword` 透传自 TShock（首页「服务器状态」卡片展示运行时长与是否需要进入密码）。
- TShock 不可达时仍返回 `200`：
  ```json
  { "reachable": false }
  ```
  （前端据此显示「服务离线」，不当作请求失败。）
- **有会话就一定带该会话的 token**（`/v2/server/status` 允许匿名，但带上 token 才能让 TShock 识别调用者）；
  无会话或 `EnableTokenEndpointAuthentication=true` 导致 401 时，也返回 `reachable: true`，
  但版本字段为 `null`（登录后再次调用即可拿到）。
  响应带 `Cache-Control: no-store`，避免浏览器复用登录前的匿名响应（见 §0）。
  回归测试：`server/internal/api/handlers_test.go` 的 `TestStatusForwardsSessionToken`。

---

## 5. `GET /api/players`

在线玩家名（用于补全）。需要会话。

成功 `200`：
```json
{ "players": ["Alice", "Bob"] }
```
- 未登录 → `401 not_authenticated`。
- 上游 token 失效 → `401 token_invalid`（后端已清会话）。
- 说明：普通玩家只能拿到**在线**玩家；离线账号需 `tshock.rest.users`（管理权限），不在本接口范围。

---

## 5.1 `GET /api/player/capabilities`

> 插件接入细节（权限/字段/坑）见 [插件-玩家管理.md](插件-玩家管理.md)。

实时探测第三方插件 PlayerManager 的可用性（需要会话）。后端用**空 `name`** 调一次
`POST {TSHOCK_URL}/pm/look`：404 = 未安装，403 = 无权限，400 = 存在（插件报缺参数）。

成功 `200`：
```json
{ "plugin": true, "permission": false }
```
- `plugin=false` → 服务器未安装 PlayerManager，前端隐藏「玩家管理」模块并提示。
- `permission=false` → 已安装但当前用户组缺 `playermanager`，前端提示无权限。
- 上游 token 失效 → `401 token_invalid`（后端已清会话）。

> 该探测是只读的，不会导出/修改任何数据。

---

## 5.2 `GET /api/player/look?name=<玩家名>`

查看玩家血量/蓝量与背包（需要会话；上游需要 `playermanager` 权限）。
后端转发到 `POST {TSHOCK_URL}/pm/look`。

成功 `200`：
```json
{
  "name": "hf", "online": true,
  "health": 400, "maxHealth": 500, "mana": 100, "maxMana": 200,
  "items": [{ "slot": 0, "id": 4956, "stack": 1, "prefix": 0, "favorited": false }],
  "skinVariant": 0, "hair": 1, "hairDye": 0,
  "hairColor": 16843009, "pantsColor": null, "shirtColor": null,
  "underShirtColor": null, "shoeColor": null, "skinColor": null, "eyeColor": null,
  "extraSlot": false, "spawnX": -1, "spawnY": -1,
  "questsCompleted": 0, "usingBiomeTorches": false, "happyFunTorchTime": false,
  "unlockedBiomeTorches": false, "currentLoadoutIndex": 0,
  "ateArtisanBread": false, "usedAegisCrystal": false, "usedAegisFruit": false,
  "usedArcaneCrystal": false, "usedGalaxyPearl": false, "usedGummyWorm": false,
  "usedAmbrosia": false, "unlockedSuperCart": false, "enabledSuperCart": false
}
```
- `items` 按 TShock `NetItem` 槽位顺序排列（共 350 格，空格子 `id=0`）：
  背包 59 / 装备 20 / 染料 10 / 杂项装备 5 / 杂项染料 5 / 猪猪 40 / 保险箱 40 /
  垃圾桶 1 / 熔炉 40 / 虚空袋 40 / 三套配装各 30（20 装备 + 10 染料）。
  其中 `inventory[58]`（游戏里的鼠标手持临时槽）前端不展示。
- 外观字段（`skinVariant` / `hair` / `hairDye` / 各颜色）原样来自 PlayerManager，供前端画角色：
  颜色是 `TShock.Utils.EncodeColor` 的 **int32 小端 RGBA**（`R=b[0] G=b[1] B=b[2] A=b[3]`），
  可能为 `null`。`hideVisuals` 是 int 位掩码，当前后端未透出。
- 只读信息：`questsCompleted`（渔夫任务次数）、永久增强标记（`ateArtisanBread` / `usedAegis*` /
  `usedArcaneCrystal` / `usedGalaxyPearl` / `usedGummyWorm` / `usedAmbrosia`）、`extraSlot`
  （恶魔之心）、`unlockedBiomeTorches`（火把神）、`unlockedSuperCart` / `enabledSuperCart`、
  `spawnX`/`spawnY`、`currentLoadoutIndex`。
- 上游在线分支这些标记是 `0`/`1`、离线分支是 `true`/`false`，后端用 `flexBool` 统一为 `bool`。
- 缺少/非法 `name` → `400 bad_request`。
- 未安装插件 → `501 plugin_not_installed`；无权限 → `403 no_permission`。
- 限流：与 `/api/command` 共用按会话的限流器（`COMMAND_MAX_PER_MIN`），超出 `429 rate_limited`。

---

## 5.3 `GET /api/player/export?name=<玩家名>`

导出玩家角色存档 `.plr`（需要会话；上游需要 `playermanager` 权限）。
后端转发到 `POST {TSHOCK_URL}/pm/export?base64=true`，解码 `base64s[0]` 后**直接以附件流回浏览器**：

- 成功 `200`：`Content-Type: application/octet-stream`，
  `Content-Disposition: attachment; filename=...; filename*=UTF-8''<name>.plr`。
- 体积上限：`server/internal/tshock/client.go` 的 `maxExportBody = 12 MiB`（TShock 返回的 base64，
  解码后约 9 MiB）；超过按 `502 bad_response` 处理。
- 错误码与 §5.2 相同。
- 这是**管理员/服主能力**：只要用户组拿到 `playermanager`，就同时拥有 look 与 export。
  若要「普通玩家只能看、服主才能导出」，需在 PlayerManager 插件侧拆分权限（当前不分）。

---

## 5.4 本地存档解析（不在后端）

「查看存档」（`.plr`）与「查看世界」（`.wld`）都**完全在浏览器里解析**，后端不提供导入接口：

| 功能 | 实现 | 说明 |
| --- | --- | --- |
| 查看存档 | `web/src/lib/save/plr.ts`（AES-128-CBC 解密 + 字段解析） | 文件不离开浏览器；不需要登录 / 权限，也没有上传体积与限流问题 |
| 查看世界 | `web/src/lib/save/worldFile.ts` + `worldThumb.ts`（头部解析 + 图格 RLE + 缩略图） | 同上，缩略图在 `<canvas>` 上本地渲染，可导出 PNG |

> 早期版本曾有 `POST /api/player/import` 与 `POST /api/world/import`（后端解析）。现已删除：
> 后端不再接触玩家 / 世界存档，公网部署也就不存在「公开解析接口」的滥用面。

---

## 5.5 `GET /api/fish/capabilities`

> 插件接入细节（权限/字段/坑）见 [插件-鱼店.md](插件-鱼店.md)。

实时探测第三方插件 FishShop 的可用性（需要会话）。后端用**空 `serial`** 调一次
`POST {TSHOCK_URL}/fishshop/ask`（老版本 `v1.6.2 ~ v1.6.6` 的 `/v3/fishshop/ask` 由后端自动回退）：
403 = 无权限，400 = 存在（插件报「缺少 serial 参数」）。

新旧前缀都 `404` 时再跑一次只读的 rawcmd `/fish help`，用来区分：
- 指令不存在 → 没装插件；
- 指令能跑 → 装了老版本插件（v1.6.2 之前只有游戏内指令、没有 REST 接口）。

成功 `200`：
```json
{ "plugin": true, "rest": true, "permission": false }
```
- `plugin=false` → 未安装 FishShop（或无法确认），前端提示并在设置里禁用「鱼店」模块开关。
- `plugin=true, rest=false` → 装了**老版本插件**（没有 REST 接口），前端提示「版本过旧」；
  右侧「钓鱼信息」卡片（`/fish info`）不依赖接口，仍可用。
- `permission=false` → 已安装且提供 REST，但**老版本插件**缺 `fishshop.rest.use`（新版插件不需要任何
  自定义权限，探测走「缺 serial → 400」分支，`permission` 恒为 `true`）。
- 插件上游状态码：`401` 没带 token；`403` 只表示 token 无效 / 用户组已变动（老版本缺权限也是 403，
  后端用 `/tokentest` 区分后才会给 `permission=false`）。
- 上游 token 失效 → `401 token_invalid`（后端已清会话）。

---

## 5.6 `GET /api/fish/list`

查看鱼店货架（需要会话）。上游**新版不需要任何自定义权限**（只要 token 有效；老版本需要 `fishshop.rest.use`）。
后端转发到 `POST {TSHOCK_URL}/fishshop/list`（老版本回退 `/v3/fishshop/list`）。

成功 `200`：
```json
{
  "name": "鱼店", "total": 2,
  "goods": [{ "serial": 1, "name": "生命水晶", "icon": "[i:29]", "buyMax": 999, "needArgs": false,
              "map": ["物品"], "desc": "[i:29] 生命水晶 x5", "cost": "5 金币", "unlock": "",
              "comment": "" }]
}
```
- `icon` 是插件配置的商品图标标签（`[i:ID]`，可能为空）。服务类商品（时间/天气/buff 等）
  `desc` 只有文字，前端用 `icon` 显示真实图标；为空则回退解析 `desc`。
- `buyMax` 单次最多可购买件数（1 = 不显示数量调节框）。
- `needArgs` = 指令类商品含 `{args}`/`{0}` 占位符，购买时需填参数（此时不再调数量）。
- `comment`（备注）也可能含 `[i:..]` 物品标签，前端同样渲染成图标。
- 未安装插件 / 版本过旧 → `501 plugin_not_installed` / `501 plugin_outdated`；无权限 → `403 no_permission`。
- 业务失败（如「商店打烊」）→ `400 fishshop_error`，`message` 为上游原文。

---

## 5.7 `GET /api/fish/ask?serial=<编号>`

询价单条商品（字段同 `goods`，另含 `allowGroup`）。缺/非法 `serial` → `400 bad_request`。

---

## 5.8 `POST /api/fish/buy`

为自己购买（需要会话）。上游**新版不需要任何自定义权限**（老版本需要 `fishshop.rest.buy`）；
只能买 token 同名的在线玩家，SSC 开启时游客会被插件拒绝（400「游客无法访问鱼店」）。
**会扣费，故与 `/api/command` 共用按会话的限流器**。

请求：
```json
{ "serial": 3, "amount": 5, "args": "" }
```
- `amount` 缺省 / <1 归一化为 1；`args` 会替换指令类商品 `cmds` 的 `{args}` 占位符。

成功 `200`：`{ "serial": 3, "name": "...", "amount": 5, "cost": "25 金币" }`。
- 业务失败（钱不够 / 商品不存在 / 商店打烊）→ `400 fishshop_error`，`message` 为上游原文，
  前端直接展示（如「钱不够」）。
- 错误码与 §5.5 相同；超出限流 → `429 rate_limited`。

---

## 6. `POST /api/command`

执行指令。需要会话。

请求：
```json
{ "cmd": "/time 12:00" }
```
- `cmd` 为完整指令文本（前端已做前端侧 Tier A 预检，后端仍需再检一次）。
- **限流**（`docs/设计原则与约束.md` §5）：按**会话**计数，每个玩家每分钟 `COMMAND_MAX_PER_MIN`（默认 60）次；
  超出返回 `429 rate_limited`（请求级错误，非 200 + status），且**不发往 TShock**。

成功 `200`（**所有指令结果都用 200 + `status`**）：
```json
{
  "status": "ok",
  "output": ["已把时间设置为 12:00"],
  "message": ""
}
```

`status` 取值（与前端 `CommandResult` 一致）：

| status | 含义 | 触发 |
| --- | --- | --- |
| `ok` | 执行成功 | TShock 200 且输出非「拒绝/无效」 |
| `command_not_found` | 指令不存在（多为提供该指令的插件未安装） | TShock 200 且输出含 `Invalid command entered` / `输入的命令无效` |
| `command_error` | 指令语法/参数错误 | TShock 200 但输出含 `Invalid command` 等，或非 2xx 的指令级错误 |
| `no_permission` | 权限不足 | TShock 403 且 body 不含 token |
| `token_invalid` | token 失效 | TShock 403 且 body 含 token（后端清会话） |
| `unavailable` | 服务不可用 | 连接失败 / 5xx |
| `timeout` | 超时 | 出站超时 |
| `bad_response` | 响应异常 | 非法 JSON / 未知结构 |
| `rejected` | 被前置策略拒绝（未发往 TShock） | 已知且 `allowServer=false` |

后端行为：
1. 解析 `cmd` 首 token（去 `/`、查别名，用内嵌 `commands.json`）。
2. 空指令 → `{status:"rejected", message:"请输入指令"}`，**不调用 TShock**。
3. `allowServer === false` → `{status:"rejected", message:"/<name> 只能在游戏内执行"}`，**不调用 TShock**。
4. 未知/插件指令（不在 `commands.json`，如 `/fish`）→ **不拒绝**，交由 TShock 判定（不存在 → `command_not_found`）。
5. 否则 `POST {TSHOCK_URL}/v3/server/rawcmd?cmd=<urlenc>&token=<token>`，按上表映射。
6. `token_invalid` 时删除会话并清 Cookie（响应里仍返回 200 + status）。

> `rejected` 的判定依据是 `data/commands.json`，属 Tier A 策略；真正权限仍在 TShock。
> 插件指令无法静态枚举，因此未知指令必须放行给 TShock，否则 `/fish` 等无法使用。

---

## 6.1 `POST /api/batch`（批量执行）

需登录。首页「统一执行」把一组指令一次交给 **WebUI 信使插件** 执行。

请求：
```json
{ "cmds": ["/who", "/time", "/bossinfo"] }
```
- `cmds` 1–64 条，每条 ≤ 1024 字节（UTF-8）；超出 → `400 bad_request`。
- 限流：与 `/api/command` 共用一个按会话的限流器（每次请求计 1 次）。
- **自动拆包**：插件只能从 query string 取参（TShock 不解析请求体），一次请求的 URI 有限。
  当指令较多或较长时，后端会把这一批拆成多次 `/webui/batch` 请求（每次 ≤64 条且 URI 约 ≤6KB），
  再将结果按原顺序拼接。对前端**透明**：仍是一次 `POST /api/batch`、一次等长结果数组。
  任意一次子请求失败即整体失败。

成功 `200`（结果与 `cmds` **等长、同序**）：
```json
{ "results": [
  { "status": "ok", "output": ["在线玩家: Alice"], "message": "" },
  { "status": "ok", "output": ["世界时间：8:30"] },
  { "status": "rejected", "output": [], "message": "/i 只能在游戏内执行" }
] }
```
- 每条结果的 `status` 语义与 `/api/command` 完全相同（`ok` / `command_not_found` / `command_error` / `no_permission` / …）。
- Tier A：已知 `allowServer=false` 的指令由后端直接标为 `rejected`，**不发往插件**；其余发往 `/webui/batch`。
- 逐条权限仍由 TShock 按当前 token 用户组判定（与 rawcmd 一致，**不提权、不绕过 `AllowServer`**）。

失败（请求级，统一错误信封）：
- 未安装信使插件 → `501 plugin_not_installed`
- 缺 `tshock.rest.command` → `403 no_permission`
- `token_invalid` → `401 token_invalid`（后端清会话）
- 超时 / 不可达 → `504 tshock_timeout` / `502 tshock_unavailable`

---

## 6.2 `GET /api/capabilities`（统一能力矩阵，需登录）

一次请求返回这台服务器上**所有可选能力**的可用性，供前端启动 / 首页 / 设置页共用
（收敛前要分别打 `batch` / `player` / `fish` / `requests` / `webauth` 五个探测端点）。

```json
{
  "reachable": true,
  "messenger": { "installed": true, "legacy": false, "version": "0.1.0", "protocol": 1,
                 "minProtocol": 1, "capabilities": ["batch", "chat", "commands"],
                 "backendProtocol": 1, "compatible": true, "reason": "ok" },
  "batch":    { "plugin": true, "ingame": false },
  "player":   { "plugin": true, "permission": true },
  "fish":     { "plugin": true, "rest": true, "permission": true },
  "requests": { "plugin": true, "submit": true, "review": true },
  "webauth":  { "plugin": true }
}
```

- 各字段与对应分端点完全同构（`messenger` = `GET /api/plugin/status` 原样返回）。
- 各探测**并行**执行；单个探测失败只降级为「不可用」，不让整次请求失败。
- `reachable=false`：上游 TShock 不可达 / 超时 → 其余字段不可信，前端**不得**据此隐藏模块。
- `?fresh=1` 绕过 3 秒微缓存（设置页「重新检测」用）；上游不可达时不缓存。
- 前端：`transport.capabilities(fresh?)`（`web/src/lib/transport.ts`）。
  App 用它决定「统一执行」自动开启与模块自动激活；首页用它判断 `/lookbag`（PlayerManager）
  与批量执行是否可用；设置页用它渲染模块状态。
- 返回需要会话（401 `not_authenticated`）；各分端点仍保留（页面内「重新检测」按需单点探测）。

---

## 6.2.1 `GET /api/batch/capabilities`

探测服务器是否安装了支持批量执行的信使插件（无需会话）：

```json
{ "plugin": true, "ingame": false }
```
- 后端用**不带 token** 调一次插件 `/webui/batch`：404 = 未安装，401/403 = 已安装。
- `ingame` = 后端 `TSWUI_ALLOW_INGAME_COMMANDS=true` 且插件已装（允许把 `allowServer=false` 的指令
  交给插件、以真实在线玩家身份执行；还需插件侧 `AllowInGameOnlyCommands=true`）。
- 前端据此决定首页「统一执行」勾选框、以及编辑器能否执行仅限游戏内的指令；**切换服务器后必须重新探测**。

---

## 6.3 信使插件只读信息 / 会话管理（需登录）

以下端点都需会话；插件未安装时返回 `501 plugin_not_installed`。权限仍由插件判定，后端不提权。

### `GET /api/commands`
TShock **运行时**指令目录（含 `/fish`、`/pm`、本插件的 `/web` 等插件指令）：
```json
{ "commands": [ { "name": "fish", "aliases": [], "permissions": [], "allowServer": true, "help": "鱼店" } ] }
```
- 前端把本地静态数据里没有的指令合并进补全（本地数据有更完整的 `paramSets`，不覆盖）。

### `GET /api/me`
当前 token 用户档案：`{ username, group, permissions[], canUseApi, canRunCommands }`。
用于诊断「为什么登录/执行失败」。

### `GET /api/data?type=regions|warps|npcs|buffs`
补全数据源：`{ type, items: [{ id?, name }] }`（regions/warps 无 id）。
区域需 `tshock.region`、传送点需 `tshock.warp`，缺权限返回空列表；NPC/buff 全量返回（本地化名）。

### `GET /api/serverinfo`
世界事件 / Boss 进度等：`{ name, difficulty, hardMode, dayTime, time, bloodMoon, eclipse,
invasionType, invasionSize, raining, slimeRain, players, npcCount, maxNpc, bosses{} }`。

### `GET /api/events?since=&limit=&tail=`
服务器动态事件流：`{ events: [{ seq, type, text, time, source? }], lastSeq, firstSeq? }`；
`type ∈ join|leave|boss|announce|npc|chat`（`webui` 为旧插件的兼容值；`announce` = 世界公告如 Boss 苏醒 / 事件开始；`npc` = 旅商到达）。
- **增量轮询**：传 `since=` 上次的 `lastSeq`，返回之后的事件（插件缺失 / 旧插件均可用）。
- **取最近 N 条**：传 `tail=N` 返回**最新** N 条（升序），用于「打开网页先看最近 N 条」。
  新插件走磁盘历史（`/webui/events?tail=N`）；**旧插件（含 RC2）后端自动降级**：拉一页 `since=0` 再取尾部。
- 聊天的 `source ∈ game|webui`（`webui` = 网页发言，见下）；旧插件可能不返回 `source`。
- `chat` 为玩家聊天（插件配置 `RecordChat` 可关）；事件在插件内存（新插件另按天落盘，见插件文档），重启不一定清空。

### `GET /api/events/stream?since=`（SSE）
以 `text/event-stream` 持续推送（网页打开「动态」时用）：
- `event: message` + `data: <ServerEvent>`：一条事件；
- `event: world` + `data: <ServerInfoExtra>`：世界状态（约 20s 一帧；前端用它更新徽标 / 游戏内时间）；
- 心跳为注释帧 `: ping`；错误用 `event: error` + `data: {"code":"..."}` 后断开，前端据此降级为轮询。
- 需要登录；后端**每个上游共享一个轮询器**（`feedhub.go`）拉 `/webui/events?since=`，fan-out 给所有订阅者，
  因此 TShock REST 请求数与在线人数无关；轮询间隔空闲自适应（2.5s → 5s → 10s）。
- 传输层接口见 `BackendTransport.eventsStream?`（可选：未实现 / 连接失败时前端退回 `events()` 轮询）。

### `POST /api/chat`
网页发言：把文本广播到游戏内聊天（需要登录；插件缺失 → `plugin_not_installed`）。

- 请求：`{ "text": "..." }`（trim 后非空，≤200 字符）。
- 响应：`{ name, text, line, id?, time?, source? }`；`name` 为游戏内角色名（在线时）或账号名，
  `line` 是插件实际广播的那一行（前缀默认 `[WebUI]`，可配 `ChatPrefix`），`id`/`time` 供前端做发送状态。
- **不伪造身份**：插件统一加前缀并标明账号名（如 `[WebUI] hf: 你好`），与真实在线玩家的 `chat` 事件区分。
- 错误：空内容 → `400 bad_request`；插件关闭网页发言 → `403 no_permission`（保留插件原文）；
  超出每账号每分钟上限 → `429 rate_limited`（保留插件原文）；未登录 → `401 not_authenticated`。
- 插件侧开关 / 限流：`AllowWebChat`（默认开）、`MaxWebChatPerMinute`（默认 20）、`ChatPrefix`（默认 `[WebUI]`）。

### `GET /api/sessions`
本插件铸造的 web 会话列表（不含 token 明文）：`{ sessions: [{ id, created, expires, current }] }`。

### `POST /api/sessions/revoke`
吊销会话：`{ id }` 或 `{ all: true }`（保留当前会话）；返回 `{ revoked: n }`。

---

## 6.4 物资申请（需登录，自研信使插件 WebUI）

玩家向服主申请建筑 / 装备等物品；审核通过后由插件在游戏内发放（在线直接给，离线下次登录给）。
权限仍由插件判定：提交需要 `webui.request.use`，审核 / 补发需要 `webui.request.review`。

### `GET /api/requests/capabilities`
```json
{ "plugin": true, "submit": true, "review": false }
```
- `plugin=false`：插件未安装 / 旧版插件（无 `requests` 能力）；此时附 `reason` 说明原因
  （`not_installed` / `protocol_mismatch` / `missing_capabilities`，与信使插件握手同一套取值）。
- 插件声明 `requests` 但缺端点 → `501 plugin_outdated`。
- `submit=false`：当前用户组缺 `webui.request.use`。
- `review=false`：当前用户组缺 `webui.request.review`（或旧插件无 `requests_review` 能力）。

### `GET /api/requests?status=pending|approved|delivered|denied|cancelled|all`
我的申请（最多 50 条，最新在前）：`{ requests: Requisition[] }`。

### `POST /api/requests`
提交申请（需要 `X-Requested-With: tswui`）：
```json
{
  "items": [{ "id": 9, "stack": 300 }, { "id": 30, "stack": 100 }],
  "reason": "建城堡外墙",
  "note": "出生点东侧 200 格"
}
```
- `items` 1–10 行；`id` 必须是有效物品；`stack` 1–999999（插件再按 `maxStack × 10 组` 校验）。
- `reason` 必填 1–200 字符；`note` ≤200；不含换行 / 控制字符。
- 插件侧限额：每人 3 条待审、每天 10 条、两次提交至少间隔 10 秒、全服 200 条待审（均可配置）。
- 响应：`{ request: Requisition }`；业务失败 → `400 request_error`（保留插件原文）。

### `POST /api/requests/cancel`
撤回自己的待审申请：`{ "id": 12 }` → `{ "request": Requisition }`。

### `GET /api/requests/all?status=...`
审核列表（最多 100 条，最新在前）：`{ requests: Requisition[] }`；需要 `webui.request.review`。

### `POST /api/requests/review`
审核：`{ "id": 12, "decision": "approve" | "deny", "reason": "数量太多" }` → `{ "request": Requisition }`。
- `approve`：在线玩家立即发放（`RequestAutoDeliver=true`）；离线玩家状态变 `approved`，下次登录发放。
- `deny`：状态 `denied`，`reason` 必填（前端强制，插件缺省「未说明原因」）。

### `POST /api/requests/deliver`
补发已批准未发放的申请：`{ "id": 12 }` → `{ "request": Requisition }`。

`Requisition` 字段：
```json
{
  "id": 12, "account": "alice", "player": "Alice",
  "items": [{ "id": 9, "stack": 300 }],
  "reason": "建城堡外墙", "note": "出生点东侧 200 格",
  "status": "pending", "createdAt": "2025-10-20T10:00:00Z", "updatedAt": "2025-10-20T10:00:00Z",
  "reviewedBy": "", "reviewedAt": "", "denyReason": "", "deliveredAt": "", "deliveryError": "",
  "world": "world.wld"
}
```
- `status ∈ pending|approved|delivered|denied|cancelled`。
- 发放失败（如物品之后被禁用）保留 `approved` 并写 `deliveryError`，审核人可修正后补发。

---

## 6.5 `POST /api/command` 的 `ingame`（Tier B，默认关）

`cmd` 之外可传 `ingame: true`，表示这条指令 `allowServer=false`，请以**真实在线玩家**身份执行。
- 仅当 `TSWUI_ALLOW_INGAME_COMMANDS=true`（且插件侧开启）时生效；否则返回 `rejected`。
- 后端也会对内置白名单里已知 `allowServer=false` 的指令自动走此路径。
- 权限仍是 token 用户组，**不提权**；玩家必须在线，否则 `rejected` + 「该玩家不在线」。

---

## 7. `GET /healthz`

- `GET /healthz` → `200 {"status":"ok","version":"1.2.3"}`
- `GET /healthz?deep=1` → `200 {"status":"ok","version":"1.2.3","tshock_reachable":true|false}`

`version` 是后端构建版本号，由构建时 `-ldflags "-X main.version=..."` 注入（未注入时为 `"dev"`），
与 `tswui -version` 输出一致。

---

## 8. 前端传输层接口（`web/src/lib/tshock.ts`）

现接口 `TshockTransport` 需要重构为（去掉前端传 token）：

```ts
export interface BackendTransport {
  readonly mock: boolean
  readonly label: string

  session(): Promise<{ authenticated: boolean; username: string | null }>
  login(username: string, password: string): Promise<{ username: string }>
  loginOnline(username: string, signal?: AbortSignal): Promise<{ username: string }> // 见第 1.1 节
  webauthCapabilities(): Promise<WebAuthCapabilities>                              // 见第 1.2 节
  batchCapabilities(): Promise<BatchCapabilities>                                  // 见第 6.2.1 节
  runBatch(cmds: string[]): Promise<CommandResult[]>                               // 见第 6.1 节
  logout(): Promise<void>

  serverStatus(): Promise<ServerStatus>            // 见第 4 节
  playersList(): Promise<string[]>                 // 见第 5 节
  runCommand(cmd: string): Promise<CommandResult>   // 见第 6 节

  me(): Promise<MeInfo>                                              // 见第 6.3 节
  events(since: number, limit?: number): Promise<EventsPage>         // 见第 6.3 节
  eventsTail?(limit: number): Promise<EventsPage>                    // 见第 6.3 节（可选）
  eventsStream?(handlers: EventsStreamHandlers, since: number): () => void // SSE（可选）
  sendChat(text: string): Promise<ChatSendResult>                    // 见第 6.3 节「POST /api/chat」
  sessions(): Promise<SessionInfo[]>                                 // 见第 6.3 节
  revokeSessions(id?: string, all?: boolean): Promise<number>        // 见第 6.3 节
  pluginStatus(): Promise<PluginStatus>                              // 见第 1.3 节

  capabilities(fresh?: boolean): Promise<ServerCapabilities>           // 见第 6.2 节（统一能力矩阵）
  playerCapabilities(): Promise<PlayerCapabilities>                    // 见第 5.1 节
  playerLook(name: string): Promise<PlayerLook>                        // 见第 5.2 节
  playerExport(name: string): Promise<{ filename: string; blob: Blob }> // 见第 5.3 节

  fishCapabilities(): Promise<FishCapabilities>                        // 见第 5.5 节
  fishList(): Promise<FishShop>                                        // 见第 5.6 节
  fishAsk(serial: number): Promise<FishGood>                            // 见第 5.7 节
  fishBuy(serial: number, amount: number, args?: string): Promise<FishBuyResult> // 见第 5.8 节

  requestCapabilities(): Promise<RequestCapabilities>                    // 见第 6.4 节
  requestList(status?: string): Promise<Requisition[]>                  // 见第 6.4 节
  requestCreate(items: RequisitionItem[], reason: string, note?: string): Promise<Requisition>
  requestCancel(id: number): Promise<Requisition>
  requestListAll(status?: string): Promise<Requisition[]>
  requestReview(id: number, decision: 'approve' | 'deny', reason?: string): Promise<Requisition>
  requestDeliver(id: number): Promise<Requisition>
}
```

映射规则（`HttpTransport`）：
- `POST /api/login` 401 → `TshockRequestError('auth')`；403 → `('permission')`；429 → `('rate_limited')`。
- `POST /api/login/online`：`player_offline` / `online_auth_denied` → `('validation')`；`online_auth_timeout` → `('timeout')`；`online_auth_error` → `('validation')`（展示 `message`）。
- `POST /api/command`：直接返回 body 作为 `CommandResult`（HTTP 200）。
- `plugin_not_installed` → `('plugin_missing')`（前端提示「服务器未安装对应插件」）。
- `rate_limited` → `('rate_limited')`（如网页发言超出每账号每分钟上限，`message` 保留插件原文）。
- `fishshop_error` → `('validation')`（业务失败，`message` 原样展示给玩家）。
- 网络错误/504 → `('timeout')`；502 → `('unavailable')`。
- `serverStatus` 失败不抛错，返回 `{reachable:false}`。

`MockTransport` 保留，实现同一接口；`VITE_TRANSPORT=mock|http` 控制，默认 `http`；Mock 时界面必须有醒目标识。

---

## 9. 安全要求（实现时逐条对照）

- [ ] 密码只在 `POST /api/login` 的 body 中；后端日志不记录 body 与 query。
- [ ] TShock token 只存在于后端内存；不出现在任何响应体、Cookie 值以外的位置。
- [ ] Cookie：`HttpOnly`、`SameSite=Strict`、`Path=/`；HTTPS 时 `Secure`；
      多服务器切换时按上游分名（`tswui_session` / `tswui_session_<hash>`），token 不跨服使用。
- [ ] 所有非 GET 请求校验 `X-Requested-With: tswui`。
- [ ] 响应安全头：`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`CSP`。
- [ ] 登录按 IP 限流；`429` 时不泄露账号信息。
- [ ] 不提供通用 URL 转发 / 代理端点。
- [ ] 玩家管理（`/api/player/*`）复用**当前会话的 token**，不引入任何管理员身份；
      权限完全由上游 TShock / PlayerManager 判定，后端区分 `plugin_not_installed`(501) 与 `no_permission`(403)。
- [ ] 会话 TTL 与上限生效；`token_invalid` 立即清会话；会话绑定上游（上游不符按未登录处理）。
- [ ] 启动日志脱敏。

---

## 10. 多服务器切换（`GET /api/servers` + `X-TSWUI-Target`）

> 安全说明：这是**受控的、仅上游 host:port 的切换**，不是通用 URL 转发。
> 默认关闭（`TSHOCK_ALLOW_CUSTOM_TARGETS=false`），只有明确开启时才生效；
> 公网部署建议保持关闭，仅用 `TSHOCK_URL` 单服务器。

### `GET /api/servers`

告知前端是否允许自定义上游，以及后端默认上游（host / port 分开，便于界面控件）：

```json
{ "allowCustom": true, "default": { "scheme": "http", "host": "127.0.0.1", "port": 7878 } }
```

### `X-TSWUI-Target`

- 可选请求头，适用于所有 `/api/*`，值形如 `127.0.0.1:7878` / `http://1.2.3.4:7878` / `https://host:7878`。
- 后端规范化：只接受 `http`/`https`，不允许路径、查询、片段与账号信息；端口缺省 `7878`。
- `allowCustom=false` 或地址非法 → `400 bad_request`，不发往任何 TShock。
- **每台上游各有一条会话**（Cookie 名按上游派生，见 §0）。切到另一台上游时：
  - 该上游之前登录过 → `/api/session` 直接返回已登录，不弹登录框；
  - 没登录过 → 返回 `authenticated:false`，前端提示登录；
  - 当前上游的 token **不会**发往其它上游；`/api/logout` 也只清当前上游那条会话与 Cookie。
  token 永远只在后端内存（`session.Store`，进程重启即失效）。
