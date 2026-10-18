# WebUI

TShockWebUI 的**信使插件**（C# / net9.0）：把网页端的请求转达给在线玩家与服务器，再把游戏内的真实结果带回网页。

> 版本 **0.1.0**（`WebUI.csproj`）；项目地址：本仓库 `plugin/WebUI/`（TShockWebUI）；目标框架 net9.0 / TShock 6.2.1；
> 配置 `<TShock SavePath>/WebUI/config.json`。

核心能力：

1. **在线授权登录**：玩家**不用密码**登录网页端——在网页输入玩家名 → 后端请求本插件 →
   插件给该在线玩家发一条游戏内消息 → 玩家输入 `/web auth <验证码>` 同意（或 `/web deny <验证码>` 拒绝）
   → 插件为其铸造一个 TShock REST token 交给后端建立会话。
2. **批量执行指令**：首页「统一执行」把一批指令一次性交给 `/webui/batch` 端点，
   由插件按调用者 token 的权限逐条执行并统一返回结果。
3. **只读信息与会话管理**：运行时指令目录（含插件指令，用于补全）、区域 / 传送点 / NPC / buff 补全数据、
   服务器状态与事件流（`/webui/{commands,me,data,serverinfo,events}`），以及网页会话的自助查看 / 吊销。
4. **Tier B（可选，默认关）**：`AllowInGameOnlyCommands=true` 时，以**真实在线玩家**身份执行
   `AllowServer=false` 的指令（权限仍是 token 用户组，不提权）。

> 授权请求 1 分钟内没有任何操作则自动失效；玩家不在线直接提示「该玩家不在线」。

## 它不做什么

- **不提权**：token 的用户组就是玩家账号本人所在组，权限与「账号密码登录」完全一致
  （仍要求组拥有 `tshock.rest.useapi`）。批量执行 / Tier B 的每条指令也都按该用户组判定权限。
- **不绕过 `AllowServer`**（Tier B 默认关）：默认情况下 `/web auth` 只是「确认登录」，批量执行同样由
  TShock 拒绝 `AllowServer=false` 的指令（与 rawcmd 一致）。
- 不落任何持久化凭证：token 加进 TShock 内存里的 REST token 表，TShock 重启即失效。

## 构建

需要 .NET 9 SDK（与 TShock v6.2.1 / net9.0 对齐）：

```bash
cd plugin/WebUI
dotnet build -c Debug        # → bin/Debug/net9.0/WebUI.dll
```

或：

```bash
scripts/build-plugin.sh      # 打印 DLL 路径
```

## 部署

1. 把 `WebUI.dll` 放进 TShock 的插件目录。
2. **重启 TShock**（插件不支持热重载）。
3. 启动日志应出现：
   ```
   [WebUI] REST 端点已注册：/webui/auth/*、/webui/batch、/webui/{commands,me,data,serverinfo,events,chat}
   [Server API] Info Plugin WebUI v0.1.0.0 (by TShockWebUI) initiated.
   ```

### 本机测试容器（一键）

本机 TShock 容器 `tshock` 的插件目录挂载在 `$HOME/tr/s/ts/plugins/`。构建 + 部署 + 重启：

```bash
bash scripts/build-plugin.sh PLUGINS_DIR="$HOME/tr/s/ts/plugins"
docker restart tshock
```

> 注意：顶层脚本的 `ts-sync-plugins` 只按固定深度扫描，**扫不到本仓库**（`plugin/WebUI/` 太深），
> 所以这里要手动指定 `PLUGINS_DIR`。

## 配置

首次启动生成 `tshock/WebUI/config.json`：

```json
{
  "Secret": "",
  "TimeoutSeconds": 60,
  "MaxRequestsPerMinute": 5,
  "PlayerCooldownSeconds": 60,
  "DeniedCooldownSeconds": 300,
  "MaxRequestsPerMinuteGlobal": 10,
  "MaxRequestsPerMinutePerIp": 3,
  "MaxPendingTickets": 64,
  "TokenTTLMinutes": 0,
  "AllowInGameOnlyCommands": false,
  "AllowChatConfirm": true,
  "RecordChat": true
}
```

| 字段 | 说明 |
| --- | --- |
| `Secret` | 与后端 `TSWUI_AUTH_SECRET` 共享的密钥。非空时所有 `/webui/auth/*` 都要求 `secret` 匹配。 |
| `TimeoutSeconds` | 一次授权请求的有效期（10–600 秒）。 |
| `MaxRequestsPerMinute` | 每个账号每分钟最多发起的请求数（防游戏内刷屏）。 |
| `PlayerCooldownSeconds` | 每次「新建票据」后的冷却（秒）：冷却期内重复请求只复用已有票据，**不再重复发游戏内消息**。 |
| `DeniedCooldownSeconds` | 玩家拒绝 / 票据过期后的额外冷却（秒）。 |
| `MaxRequestsPerMinuteGlobal` | 全服每分钟请求上限（防有人逐个骚扰在线玩家）；0 = 不限。 |
| `MaxRequestsPerMinutePerIp` | 同一来源 IP 每分钟请求上限（后端会传 `ip`）；0 = 不限。 |
| `MaxPendingTickets` | 同时存在的未完成票据上限（防内存增长）；0 = 不限。 |
| `TokenTTLMinutes` | 本插件铸造的 web token 有效期（分钟）。0 = 不过期（跟随后端会话/手动退出）。 |
| `AllowInGameOnlyCommands` | Tier B：是否允许以**真实在线玩家**身份执行 `AllowServer=false` 的指令（默认关；权限不多一分）。 |
| `AllowChatConfirm` | 是否允许玩家直接回复 `y`/`n` 确认（无需输入 `/web auth` 验证码）。 |
| `RecordChat` | 是否把玩家聊天记入「服务器动态」（事件流 `type=chat`，默认开）。仅普通聊天、不含指令；关掉即完全不采集聊天。 |
| `PersistEvents` | 是否把事件按天写入 `tshock/WebUI/events/*.jsonl`（默认开，重启不清空）；关掉退回纯内存。 |
| `PersistChat` | 是否把聊天也写入磁盘（默认**关**，保护隐私；仍会出现在内存事件流里）。 |
| `HistoryDays` | 事件历史保留天数（默认 7；<=0 不按天清理）。 |
| `HistoryMaxMB` | 事件历史目录大小上限 MB（默认 50；<=0 不按大小清理）。 |
| `AllowWebChat` | 是否允许网页端（`/webui/chat`）把文本发到游戏内聊天（带 `[WebUI]` 前缀，默认开）。 |
| `MaxWebChatPerMinute` | 同一账号每分钟最多经网页发送的聊天条数（默认 20；0 = 不限）。 |
| `ChatPrefix` | 网页发言在游戏内/事件流里的前缀（默认 `[WebUI]`）。 |

后端环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `TSWUI_AUTH_SECRET` | 空 | 必须与插件 `Secret` 一致；都为空时不校验 |
| `WEBAUTH_TIMEOUT` | `60s` | 后端等待玩家确认的总时长 |

> REST 端口（默认 7878）应只对后端可达。若不得不暴露，**务必设置 `Secret`**：
> 插件的 `/webui/auth/*` 本身不需要 token（调用方在登录前还没有 token），
> 真正的安全边界是「玩家在游戏内确认」。

## REST 端点（后端调用）

> `/webui/auth/*` 的 HTTP 状态恒为 200，业务状态在 `code` 字段；
> 其余端点是安全端点，沿用 401/403 语义。

| 端点 | 参数 | 返回 |
| --- | --- | --- |
| `/webui/meta` | `secret`（可选） | `{name,version,protocol,minProtocol,capabilities[]}`：协议握手。后端据此判定兼容性 / 能力；新增能力只改 `capabilities`，破坏性改动才 +1 `protocol` |
| `/webui/auth/request` | `name`、`secret` | `{code:"ok", ticket, expires, player, username}`；玩家不在线 → `{code:"offline"}` |
| `/webui/auth/poll` | `ticket`、`secret` | `{code:"ok", state:"pending"/"approved"/"denied"/"expired"}`；批准时附 `username` + `token`（仅返回一次） |
| `/webui/auth/cancel` | `ticket`、`secret` | `{code:"ok"}`（后端放弃等待时回收票据） |
| `/webui/restlimit` | `secret` | `{code:"ok", limit, bucket, intervalMinutes}`：TShock 建令牌限流只读快照，`bucket` 是调用者自己 IP 的计数（后端用它精确判限流） |
| `/webui/batch` | `cmds`（JSON 数组）、`token`、可选 `mode=server\|player` | `{status:"200", results:[{cmd, output:[...]}]}`（需 token + `tshock.rest.command`） |
| `/webui/commands` | `token` | `{commands:[{name,aliases,permissions,allowServer,help,doLog}]}`（TShock 运行时指令，含插件指令；**按调用者用户组过滤**，带权限的不下发） |
| `/webui/me` | `token` | `{username,group,permissions,canUseApi,canRunCommands}` |
| `/webui/data` | `type=regions\|warps\|npcs\|buffs`、`token` | `{regions/warps:[...]}` 或 `{npcs/buffs:[{id,name}]}` |
| `/webui/serverinfo` | `token` | 世界事件 / Boss 进度等 |
| `/webui/events` | `since`、`limit`、`tail`、`token` | `{events:[{seq,type,text,time,source?}],lastSeq,firstSeq?}`；`type ∈ join\|leave\|boss\|announce\|npc\|chat`；`announce` = 世界公告（Boss 苏醒 / 事件开始 / 入侵），`npc` = 旅商到达（其它城镇 NPC 与 NPC 死亡不记）；聊天的 `source ∈ game\|webui`；`tail=N` 取最新 N 条（磁盘历史，需能力 `events_history`） |
| `/webui/chat` | `text`、`token` | `{name,text,line,id,time,source}`：以配置前缀（默认 `[WebUI]`）广播到游戏内聊天（不伪造身份；在线禁言 → 403；超限流 → 429），并记入事件流 `type=chat, source=webui` |
| `/webui/auth/sessions` | `token` | `{sessions:[{id,created,expires,current}]}` |
| `/webui/auth/revoke` | `id` 或 `all=true`、`token` | `{revoked:n}` |

未安装插件的服务器对以上路径返回 404，后端据此提示「未安装插件」。

其它 `code`：`missing_name` / `no_account`（玩家未登录 TShock 账号）/ `no_api_permission` / `rate_limited`。
`secret` 不匹配返回 HTTP 403 + `{code:"forbidden"}`。

`/webui/batch` 的 `cmds` 需 URL 编码的 JSON 数组，如 `["/who","/time"]`；一次最多 64 条。
后端会在指令很多/很长时把一批拆成**多次** `/webui/batch` 请求（每次仍 ≤64 条）再拼接结果。
`mode=server`（默认）每条指令新建一个 `TSRestPlayer`（用户名/用户组取自 token，与 `/v3/server/rawcmd` 完全同构）；
`mode=player` 用真实在线玩家对象执行（仅在 `AllowInGameOnlyCommands=true` 时可用）。
两种模式的权限判定、`AllowServer` 限制、输出文案都与 `rawcmd` 一致。

## 游戏内指令

**统一入口**：`/web`（`/webui`），功能指令均为**二级子命令**；权限节点 `webui.use` / `webui.admin`：

```
/web auth <验证码>          # 同意（需 webui.use）
/web deny <验证码>          # 拒绝（需 webui.use）
/web limit                   # 查看 TShock 建令牌限流（需 webui.admin + tshock.rest.cfg）
/web limit <上限>            # 设为 N（≥1）；unlimited=1000000；default=5
```

- `auth` / `deny` 必须在游戏内由本人执行（控制台顶替不了玩家确认）。
- `limit` 会修改并保存 TShock 的 `config.json` 中的 `RESTMaximumRequestsPerInterval`——
  属用户明确要求的例外；同时要求 `webui.admin` 与 `tshock.rest.cfg`（控制台 / superadmin 满足）。
- 权限节点需服主授予，例如：`/group addperm default webui.use`、`/group addperm <管理组> webui.admin`。
  插件启动时若没任何组拥有 `webui.use` 会在控制台警告。
- `/webui/commands` 指令目录按调用者用户组过滤（与 TShock `/help` 的可见性一致），
  带权限的指令不会下发给普通玩家。

## 手动验收

1. 玩家 A 进入服务器并 `/login` 自己的账号（账号组需有 `tshock.rest.useapi`）。
2. 网页端打开登录框 → 「在线授权」→ 输入 A 的玩家名 → 请求登录。
3. A 的游戏内应收到带 6 位验证码的消息；网页显示「等待游戏内确认…」。
4. A 输入 `/web auth <验证码>` → 网页登录成功。
5. 反例：输入不在线的名字 → 网页提示「该玩家不在线」；
   60 秒不操作 → 提示超时；`/web deny <验证码>` → 提示「玩家已拒绝授权」。
