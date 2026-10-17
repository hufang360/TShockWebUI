# TShock REST API 的限制（v6.2.1 实测 + 源码核对）

> 调查对象：TShock **6.2.1**（`ghcr.io/pryaxis/tshock:6.2.1`），Terraria 1.4.5.8。
> 源码：`TSHOCK_SRC`（默认 `<仓库>/../TShock`）的 `TShockAPI/Rest/*`。
> 实测：本机 TShock `http://127.0.0.1:7878`（`EnableTokenEndpointAuthentication=true`，`ApplicationRestTokens` 含 `simpleToken`）。
> 每一条结论都标注了出处（源码文件:行 或 实测命令）。

## 0. 结论速览

| 维度 | 限制 |
| --- | --- |
| 传输 | **纯 HTTP，无 TLS**；绑定 `Netplay.ServerIP`（默认 `0.0.0.0`）:`RestApiPort`（默认 7878） |
| HTTP 方法 | **不区分方法**：GET/POST/PUT/HEAD/OPTIONS 都命中同一处理器（按 URI 路由） |
| 方法选择 | 本项目出站默认 **POST**（`TSHOCK_METHOD=GET` 可切回）：部分机房（实测腾讯云）会把域名下的**明文 GET** 劫持成 302，POST 不受影响 |
| CORS | **不返回任何 `Access-Control-*` 头** → 浏览器跨域直接不可用 |
| 认证 | 绝大多数端点**必须带 token**；少数匿名（取决于配置） |
| 令牌 | **仅存内存**，重启即失效；**无 TTL**；组被删则失效 |
| 令牌来源 | `POST/GET /v2/token/create`（账号密码）或 `ApplicationRestTokens`（配置静态令牌） |
| 建令牌权限 | 账号所在组需有 `tshock.rest.useapi`（`superadmin` 除外） |
| 限流 | **只限 `/v2/token/create`**，按来源 IP 计数；其它端点**无速率限制** |
| 权限 | 每个端点声明所需权限；TShock 按 token 用户所在组判定，**不提权** |
| 参数 | 只从 query string / 表单取参；`token` 走 query；**表单体在建令牌端点会 500** |
| 响应 | JSON（`application/json; charset=utf-8`），含 `status` 字段；支持 `?jsonp=` 包裹 |
| 错误 | 未知端点 404；缺 token 401；token 无效 403；异常 500（**带 stacktrace**） |
| 传输尺寸 | 请求（query / body）可靠上限 **≈ 65 535 B**；响应**无 TShock 上限**（实测 192 MiB）→ 详见 §10 / §10.1 |

---

## 1. 传输层

- **无 HTTPS**：`RestApi = new SecureRest(Netplay.ServerIP, RestApiPort)`，底层 `HttpServer.HttpListener.Create(Ip, Port)`，没有证书/TLS 配置。→ 需要 HTTPS 必须在前面套反代。
  - 出处：`TShockAPI/TShock.cs:357`、`TShockAPI/Rest/Rest.cs:228`。
- **监听地址/端口**：`Netplay.ServerIP`（未显式设置时为 `IPAddress.Any`，即 `0.0.0.0`）+ `RestApiPort`（默认 7878）。可用启动参数 `-ip` / `-restport` 覆盖。
  - 出处：`TShockAPI/TShock.cs:291-292`、`TShockAPI/Configuration/TShockConfig.cs:638`。
- **必须显式启用**：`RestApiEnabled`（bool，默认 `false`）；为真才 `RestApi.Start()`。
  - 出处：`TShockAPI/TShock.cs:444-445`、`TShockConfig.cs:634`。
- **方法不被校验**：路由只按 `UriTemplate` 匹配（`Rest.cs` 的 `ProcessRequest`），不读 HTTP method。实测 GET/POST/HEAD/OPTIONS/PUT 对 `/v2/server/status` 均返回 200。
  - 出处：`Rest.cs:349-380`；实测见 §8。
- **中间层可能只劫持 GET**（不是 TShock 的行为，但会直接影响可用性）：实测腾讯云对「Host 为未备案域名」的**明文 GET** 注入
  `302 Location: https://dnspod.qcloud.com/static/webblock.html?d=<host>`（页面 `<title>备案</title>`），
  而 `POST/PUT/DELETE/OPTIONS/PATCH`（甚至任意自定义方法）不受影响；按 IP 或已备案域名做 Host 则正常。
  - 实测 2026-10：`curl http://<域名>:7878/v2/server/status` → 302 webblock；同 IP 改 `Host: <server-ip>` → 200。
  - 因此本项目出站方法默认 `POST`（`TSHOCK_METHOD`）；参数只在 query，故与 GET 等价。
  - 注意：Go 默认会把 302 上的 POST **降级为 GET 重发**，所以改用 POST 不是万能的；域名被拦时仍会拿到拦截页 HTML
    （表现为 `bad_response`）。根治办法是备案或直接用 IP。
- **无 CORS**：响应头只有 `Content-Type`/`Content-Length`/`Connection`/`Server: TShockAPI/6.2.1.0`，**无 `Access-Control-Allow-Origin`**。→ 任何浏览器页面都不能跨域调用（同源或走反代才行）。
  - 实测见 §8。
- **JSONP**：query 里带 `jsonp=cb` 时，响应被包成 `cb({...});`（`Rest.cs:333-338`）。这是一个潜在的 CSRF/数据外泄面（脚本标签可跨域读取）。
- **响应头泄露版本**：`Server: TShockAPI/<version>`。
- **响应状态**：`RestObject.Status`（默认 `"200"`）会同时写进 JSON 的 `status` 字段和 HTTP 状态码。
  - 出处：`RestObject.cs`、`Rest.cs:344-347`。

## 2. 认证与令牌

- **token 放 query**：`SecureRest.ExecuteCommand` 从 `parms["token"]` 取（query 参数）。没有 `Authorization` 头支持。
  - 出处：`TShockAPI/Rest/SecureRest.cs:200-215`。
- **三类端点**：
  - 匿名 `RestCommand`：不需要 token。
  - `SecureRestCommand`：**必须有 token**，否则 401 `Not authorized...requires a token`。
  - 无效/过期 token：403 `...provided token was not valid`。
- **服务端状态/规则/MOTD 视配置而定**：`EnableTokenEndpointAuthentication=true` 时它们注册为 `SecureRestCommand`（要 token）；否则注册为匿名 `RestCommand`。
  - 出处：`RestManager.cs:184-198`。
- **令牌获取**：
  - `GET/POST /v2/token/create?username=&password=` → 成功返回 `{"status":"200","response":"Successful login","token":"<64位hex>"}`。
  - 账号所在组必须有 `tshock.rest.useapi`（或账号组为 `superadmin`），否则 403。
  - 出处：`SecureRest.cs:104-180`。
- **令牌生命周期**：存在 `SecureRest.Tokens` 字典（内存），**无过期时间**；服务器重启即全部失效；`/token/destroy/{token}` 或 `/v3/token/destroy/all` 主动销毁；**组被删除后 token 失效**。
  - 出处：`SecureRest.cs:204-220`。
- **静态令牌 `ApplicationRestTokens`**：配置里预置 `{token: {Username, UserGroupName}}`，永不失效、**不受建令牌限流**，是服务端对接的推荐方式。
  - 出处：`TShockConfig.cs:658`、`SecureRest.cs:60-70`。
- **403 语义不区分**：密码错 / 组缺 `useapi` / 被限流，返回**同一句** 403 文案 → 调用方无法区分。本项目据此把三种可能拆成**逐条清单**提示玩家（`docs/UI组件.md` 登录框章节；英文界面走前端 i18n，不透出后端中文 message）。
  - 出处：`SecureRest.cs:126-176`。

## 3. 权限模型

- 每个 `SecureRestCommand` 声明若干权限；判定为「**列出的权限一个都没有**才拒绝」（`Permissions.All(perm => !HasPermission(perm))`）→ 只要拥有其中任意一个即可通过。
  - 出处：`SecureRest.cs:222-227`。
- 权限按 token 关联的**用户组**判定，`rawcmd` 也严格继承该组权限，**不提权**。
- 相关权限节点（`RestPermissions.cs`）：
  `tshock.rest.useapi`（建 token）、`tshock.rest.manage`（销毁全部 token）、
  `tshock.rest.command`（rawcmd）、`tshock.rest.cfg`、`tshock.rest.maintenance`、
  `tshock.rest.broadcast`、`tshock.rest.kick`、`tshock.rest.ban`、`tshock.rest.mute`、
  `tshock.rest.kill`、`tshock.rest.causeevents`、`tshock.rest.butcher`、`tshock.rest.viewips`、
  `tshock.rest.users.view/manage/info`、`tshock.rest.bans.view/manage`、`tshock.rest.groups.view/manage`。
- 普通玩家默认组 `default` **没有**这些权限 → 密码正确也建不了 token / 执行不了 rawcmd。

## 4. 限流（只针对建令牌）

- **只有 `/v2/token/create` 受限**；`rawcmd` 等其它端点**没有**速率限制（这点常被误解）。
- 计数按**来源 IP**（`context.RemoteEndPoint.Address`），存 `tokenBucket[ip]`。
- 每次尝试先 +1；**失败再额外 +1**（未知账号/密码错/缺 useapi）；达到 `RESTMaximumRequestsPerInterval` 后返回 403 并继续 +1。
- 定时器每 `RESTRequestBucketDecreaseIntervalMinutes`（**最小 1 分钟**）把所有 IP 计数 −1。
- 默认 `RESTMaximumRequestsPerInterval = 5` → 约 5 次成功或 3 次失败即被挡，之后每分钟恢复 1 次。
- 出处：`Rest.cs:237-241,320-334`、`SecureRest.cs:117-125`、`TShockConfig.cs:650,654`。
- **装了 WebUI 信使插件后可精确/可放宽**：插件暴露只读端点 `/webui/restlimit`（返回 `limit` 与**调用者自己 IP** 的 `bucket`，源码读 public 的 `Rest.tokenBucket`），后端在密码登录前调用 → 桶满直接判 `rate_limited`；服务端还可用 `/weblimit <值>|unlimited|default` 修改并保存 `RESTMaximumRequestsPerInterval`（高级指令，需 `tshock.rest.cfg`）。见 `docs/插件-信使.md`。

## 5. 端点清单（核心，v6.2.1）

> `Token` 列：`是`=必须 token；`配置`=取决于 `EnableTokenEndpointAuthentication`。
> `权限` 列：只要满足其中**任意一个**即可（空=仅需有效 token）。

| 端点 | Token | 权限 |
| --- | --- | --- |
| `/v2/token/create` | 否 | 账号组需 `tshock.rest.useapi` |
| `/token/destroy/{token}` | 是 | — |
| `/v3/token/destroy/all` | 是 | `tshock.rest.manage` |
| `/tokentest` | 是 | — |
| `/v2/server/status` | 配置 | — |
| `/v3/server/motd` | 配置 | — |
| `/v3/server/rules` | 配置 | — |
| `/v2/server/broadcast` | 是 | `tshock.rest.broadcast` |
| `/v3/server/reload` | 是 | `tshock.rest.cfg` |
| `/v2/server/off` | 是 | `tshock.rest.maintenance` |
| `/v3/server/rawcmd` | 是 | `tshock.rest.command` |
| `/v2/users/activelist` | 是 | `tshock.rest.users.view` |
| `/v2/users/list` | 是 | `tshock.rest.users.view` |
| `/v2/users/read` | 是 | `tshock.rest.users.view` |
| `/v2/users/create` | 是 | `tshock.rest.users.manage` |
| `/v2/users/destroy` | 是 | `tshock.rest.users.manage` |
| `/v2/users/update` | 是 | `tshock.rest.users.manage` |
| `/v3/bans/create` | 是 | `tshock.rest.ban` 或 `tshock.rest.bans.manage` |
| `/v3/bans/list` | 是 | `tshock.rest.bans.view` |
| `/v3/bans/read` | 是 | `tshock.rest.bans.view` |
| `/v3/bans/destroy` | 是 | `tshock.rest.bans.manage` |
| `/world/read` | 是 | — |
| `/world/meteor` | 是 | `tshock.rest.causeevents` |
| `/world/bloodmoon/{bloodmoon}` | 是 | `tshock.rest.causeevents` |
| `/v3/world/bloodmoon` | 是 | `tshock.rest.causeevents` |
| `/v2/world/save` | 是 | `tshock.rest.cfg` |
| `/v2/world/autosave/state/{state}` | 是 | `tshock.rest.cfg` |
| `/v3/world/autosave` | 是 | `tshock.rest.cfg` |
| `/v2/world/butcher` | 是 | `tshock.rest.butcher` |
| `/lists/players` | 是 | — |
| `/v2/players/list` | 是 | — |
| `/v3/players/read` | 是 | `tshock.rest.users.info` |
| `/v4/players/read` | 是 | `tshock.rest.users.info` |
| `/v2/players/kick` | 是 | `tshock.rest.kick` |
| `/v2/players/kill` | 是 | `tshock.rest.kill` |
| `/v2/players/mute` / `unmute` | 是 | `tshock.rest.mute` |
| `/v2/groups/list` / `read` | 是 | `tshock.rest.groups.view` |
| `/v2/groups/create` / `update` / `destroy` | 是 | `tshock.rest.groups.manage` |

- 出处：`RestManager.cs:184-296`。
- **别名/重定向**（`RegisterRedirect`）：`/status`→`/v2/server/status`、`/token/create`→`/v2/token/create`、`/players/list`→`/v2/players/list` 等（`RestManager.cs:200-248`）。
- 插件可通过 `TShock.RestApi.Register(new SecureRestCommand(...))` 自行注册端点（本服的 `/r`、`/bossinfo`、`/lookbag` 等就是插件指令，走的是 `rawcmd`，不是新端点）。
- `/v2/server/status` 支持 `?players=1`、`?rules=1` 附带额外数据；`players` 里的 IP 字段需 `tshock.rest.viewips`。

## 6. `/v3/server/rawcmd` 的额外限制

- 用 token 用户的**用户组**创建一个 `TSRestPlayer` 执行指令：`Commands.HandleCommand(tr, cmd)`，返回 `tr.GetCommandOutput()`。
  - 出处：`RestManager.cs:308-317`。
- 因此：
  1. **严格继承权限**，不因 REST 而提权；缺权限 → `你没有权限使用该指令`。
  2. `AllowServer=false` 的指令（`/i`、`/tp`、`/buff` 等）在**权限通过后**才被拒 → `你必须在游戏内使用该指令`；若连权限都没有，先报「无权限」。
  3. 未知指令 → `输入的命令无效…`（HTTP 仍 200）。
  4. **只捕获发给该玩家的消息**：`TSRestPlayer` 只重写 `SendMessage/SendInfoMessage/...`；指令若用 `TSPlayer.All.SendInfoMessage`（广播类，如 `/time day`）**不会**出现在 `response` 里。
  5. 输出是**字符串数组**（每个 `SendMessage` 一行）；换行符也在单行内（如 `/bossinfo` 的 `\n`）。
  6. `cmd` 为空 → 400 `cmd参数缺失或为空`。
- 出处：`TShockAPI/TSPlayer.cs:2567-2612`。

## 7. 相关配置项（`config.json` → `Settings`）

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `RestApiEnabled` | `false` | 是否启用 REST |
| `RestApiPort` | `7878` | REST 端口 |
| `LogRest` | `false` | 是否记录 REST 请求日志（token 已在日志里剔除） |
| `EnableTokenEndpointAuthentication` | `false` | `server/status`、`motd`、`rules` 是否也要 token |
| `RESTMaximumRequestsPerInterval` | `5` | **建令牌**的每 IP 上限 |
| `RESTRequestBucketDecreaseIntervalMinutes` | `1` | 计数恢复间隔（分钟，最小 1） |
| `ApplicationRestTokens` | `{}` | 预置静态令牌（`{token: {Username, UserGroupName}}`） |

- 出处：`TShockConfig.cs:634-658`。
- 启动参数：`-resttoken`（追加 superadmin 静态令牌）、`-restenable`、`-restport`、`-ip`（`TShock.cs:905-935`）。

## 8. 实测记录（本机 6.2.1，2026-10）

| 请求 | 结果 |
| --- | --- |
| `GET /v2/server/status`（无 token） | **401** |
| `GET /v2/server/status?token=simpleToken` | **200** |
| `POST /v2/server/status?token=simpleToken` | **200**（方法被忽略） |
| `HEAD` / `OPTIONS` / `PUT` 同端点 | **200**（方法被忽略） |
| 无效 token | **403** |
| 未知端点 `/v2/nope` | **404** |
| `/v3/server/rawcmd?cmd=/time`（无 token） | **401** |
| `/v3/server/rawcmd` 缺 `cmd` | **400** `cmd参数缺失或为空` |
| `/v3/server/rawcmd?cmd=/nonexistent` | 200 + `输入的命令无效…` |
| `/v3/server/rawcmd?cmd=/i 29`（该组无 `/i` 权限） | 200 + `你没有权限使用该指令` |
| `POST /v2/token/create`（**表单体**） | **500** |
| `POST /v2/token/create?username=&password=`（query） | **200** |
| `GET /v2/server/status?token=simpleToken&jsonp=cb` | `cb({...});` |
| 响应头 | 无 `Access-Control-*`；`Server: TShockAPI/6.2.1.0` |
| `/tokentest?token=simpleToken` | 200 + `associateduser` |
| `/v2/players/list?token=simpleToken` | 200 + `players` |
| `/status`、`/players/list`（别名） | 200（重定向生效） |

### 8.1 未备案域名被中间层劫持（2026-10，远程 6.2.1）

| 请求（Host = 未备案域名） | 结果 |
| --- | --- |
| `GET /v2/server/status` | **302** → `dnspod.qcloud.com/static/webblock.html?d=<host>`（无 TShock 头，非 TShock 所发） |
| 同 IP 换 `Host: <server-ip>`（或已备案/不存在的域名） | **200** + 正常 JSON |
| `POST /v2/token/create?username=&password=` | **200** + token（方法不被劫持） |
| `POST /tokentest?token=` | **200** + `associateduser` |
| `POST /v3/server/rawcmd?cmd=%2Fhelp&token=` | **200** + 指令列表 |
| `POST /v2/players/list?token=` | **200** + `players` |
| `HEAD` / `PUT` / `DELETE` / `OPTIONS` / `PATCH` / 自定义方法 | **200**（仅 GET 被劫持） |
| TCP 裸请求（自己拼 `GET ... Host: <域名>`） | 同样 302 → 确认是**按 Host 头**的中间层劫持，与客户端无关 |

→ 结论：`TSHOCK_METHOD=POST`（本项目默认）能让被拦截的域名继续可用；真正的修复是备案或用 IP。

## 9. 对 TShockWebUI 的直接影响

- **必须由后端代发**：无 CORS + token 不能落浏览器 → 浏览器只能走同源 `/api/*`，由后端持有 token（本项目的架构正好如此）。
- **`POST /v2/token/create` 只能用 query**：表单体会 500（实测），故本项目登录走 query。
- **建令牌限流是全局的**：反代后所有玩家共用一个来源 IP，`RESTMaximumRequestsPerInterval` 成为**全站**限额；本机已调到 `1000` 便于测试。
- **rawcmd 无速率限制**：首页多卡片连续执行不会被 REST 限流挡（之前排查的「空响应」是网络路径/代理问题，不是限流）。
- **403 不可区分**：密码错/缺权限/限流同文案；装了 WebUI 插件时后端先用 `/webui/restlimit` 排除限流（清单少一项），未装时前端把三种原因一并（逐条）提示。
- **`AllowServer=false` 仍要前端先拦**：否则会发出站请求；本项目 Tier A 已前置拒绝。
- **出站方法默认 POST**：TShock 不校验方法，而部分机房只劫持明文 GET（见 §1、§8.1）；
  `TSHOCK_METHOD=GET` 可切回旧行为（等价，但域名被栏时不可用）。
- **广播类指令输出拿不到**：结果面板只显示 `TSRestPlayer` 捕获到的行。

## 10. 传输尺寸上限（实测 2026-10，临时探针插件）

> 方法：临时插件注册匿名端点 `/tsui/probe/{echo,text,blob,upload,file,write}` 与命令 `/probesize <n>`，
> 实测后已卸载（源码未入库）。底层 HTTP 服务是 TShock 自带的古董库
> `prebuilts/HttpServer.dll`（直接 `HttpListener`，**不走** `Server` 类）。

| 方向 | 通道 | 可靠上限 | 超出后表现 |
| --- | --- | --- | --- |
| 服务端 → 客户端 | 响应体（JSON） | **无 TShock 上限**：64/128/192 MiB 均 200（192 MiB 用 1.5 s） | 受内存/客户端限制 |
| 客户端 → 服务端 | query string 参数 | **≤ ~65 000 B**（65000 5/5 成功） | ≥65400 起不稳定；≥65535 断连或 500 |
| 客户端 → 服务端 | 原始请求体（插件自读 `IRequest.Body`） | **≤ ~65 000 B**（可完整校验哈希） | >65535 大概率「Empty reply」（无响应、无日志） |
| TShockWebUI `/api/command` | 经 `rawcmd` 间接 | **< 4 MiB**（4194000 B 成功） | ≥4 MiB → `bad_response / TShock 返回非法 JSON` |

- **不解析请求体参数**（再次确认）：`POST /v3/server/rawcmd`（urlencoded / multipart 体）+ 无 `cmd` query → 400；
  表单体打 `/v2/token/create` → 500 `Value cannot be null (Parameter 'stringToUnescape')`（`SecureRest.cs:106`）。
  故 TShock 自带端点的参数**只能放 query**。**但**插件回调拿到 `RestRequestArgs.Request`（`IRequest : IMessage`），可直接读 `Request.Body`
  流（`Content-Length ≤ 2 000 000` 时为 `MemoryStream`，更大转临时 `FileStream`）——这是唯一可行的「上传」通道。
- **响应方向无 1 MB 限制**：`HttpServer.Server.MaxContentSize` 默认 1 000 000，但 TShock 只用 `HttpListener`，该检查（在 `Server.OnBeforeRequest`）永远不执行。
- **64 KiB 是 `HttpContext` 接收缓冲区大小**（`new byte[65535]`），也是「可靠上限」的由来，并非可配置项：
  - 请求行/体一次读满 65535 B 时 `OnReceive` 会 `BeginRead(_buffer, 0, 0)`（长度 0）→ 立刻当作「客户端断开」→ 空回复；
  - 请求行跨两次 `read` 时（例如 8 KB + 8 KB 分两次写）→ 解析器错位 → `HTTP/1.0 500 Unexpected new line: HTTP/1.1[CRLF]`；
  - 请求行总长 > 65535 → `System.IndexOutOfRangeException` in `HttpContext.ParseBuffer` → 500 HTML 错误页。
  - **跨公网尤为危险**：只要请求行被 TCP 分段（> ~1 MSS），即使只有几 KB 也可能触发错位。
- **二进制必须 base64**：响应恒为 `application/json`（`RestObject` 序列化），插件无法直接写裸字节（`Rest.OnRequest` 会覆盖响应流）；
  建议 base64url 去 padding（`-`/`_`），避免 `+`/`/`/`=` 被 query 解码影响。
- **TShockWebUI 现有约束**：`server/internal/tshock/client.go:27` `maxBody = 4 << 20`（`io.LimitReader` 截断 → JSON 解析失败）；
  `TSHOCK_TIMEOUT` 默认 **10s** 是整请求超时（含读响应体），大体积/慢生成必须一起调大。

**结论（地图片段下载）**：可行，但要（1）插件注册一个带 token 的 REST 端点返回 base64url 字符串；
（2）后端加一条路由把该端点数据流给浏览器；（3）当前 `maxBody` 下净数据 ≲ 3 MiB（base64 +33%）；
（4）**反向（上传到服务器）不可行**——query 与 body 都在 ~64 KiB 处崩溃，除非打补丁修 `HttpServer`。

### 10.1 真实文件实测：PlayerManager `/pm/export` 传输 `hf.plr`（2026-10）

用服务器上真实的玩家存档验证同一结论。
文件：`/tshock/PlayerManager/hf.plr` = **117 408 B**，sha256 `9d747216b497beb1faadf22f506890977425d86b5d9324877f8022ae3d1e43de`。
插件端点：`GET /pm/export?name=hf&base64=true&token=<t>` → `{"base64s":["<整个 .plr 的 base64>"]}`（权限 `playermanager`）。

| 方向 | 操作 | 结果 |
| --- | --- | --- |
| 下载（服务器 → 客户端，响应） | REST 返回该文件 | ✅ **1/1 成功**。HTTP 响应 **156 699 B**（base64，约 1.33×），耗时 **0.017 s**；解码后 sha256 与原文件**完全一致** |
| 上传（客户端 → 服务器，请求体） | 把同一文件 POST 回服务器 | ❌ **5 次仅 1 次成功**，其余 4 次连接被直接掐断（117 KB > 64 KB） |
| 对照：上传小文件 | 3 696 B 的另一个 `hf.plr` | ✅ 1/1 成功（< 64 KB） |

→ 坐实两点：**响应（下载）没有 64 KB 限制**（117 KB 一次完整拿回、校验通过；更大体积见上表 192 MiB）；
**请求（上传）才有 64 KB 限制**（117 KB 就基本传不上去，与 §10 的 65 535 B 缓冲区相符）。

本项目对该链路的封装：`/api/player/look`、`/api/player/export`（`docs/API_SPEC.md` §5.2/§5.3），
导出上限为 `server/internal/tshock/client.go` 的 `maxExportBody = 12 MiB`（TShock 返回的 base64，解码后约 9 MiB）。

## 11. 出处汇总

- `TShockAPI/Rest/Rest.cs`（路由、方法无关、JSONP、状态码、`DegradeBucket`）
- `TShockAPI/Rest/SecureRest.cs`（token 校验、权限判定、建令牌限流、静态令牌）
- `TShockAPI/Rest/RestCommand.cs`（`RestCommand` / `SecureRestCommand`）
- `TShockAPI/Rest/RestPermissions.cs`（权限节点）
- `TShockAPI/Rest/RestManager.cs`（端点注册与实现）
- `TShockAPI/TSPlayer.cs:2567`（`TSRestPlayer` 输出捕获）
- `TShockAPI/Configuration/TShockConfig.cs:634-658`（REST 配置）
- `TShockAPI/TShock.cs:291,357,444,905-935`（启动、绑定、参数）
