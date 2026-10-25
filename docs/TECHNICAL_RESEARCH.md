# 技术调研报告（阶段 0 交付物）

> 本文件只记录**已核实**的事实，每条都给出出处；产品原则与范围见 `docs/设计原则与约束.md`。
> 核实时间以本机源码 / 已解包资源为准。任何「未验证」项都明确标注。

## 0. 结论速览

| 事项 | 结论 | 可信度 |
| --- | --- | --- |
| Terraria 版本 | v1.4.5.8 | ✅ 源码 `AssemblyVersion` |
| TShock 版本 | 目标 v6.2.1 | ✅ 官方 tag 存在，REST 相关代码已比对 |
| rawcmd 是否继承玩家权限 | 是，严格继承用户组权限 | ✅ 源码验证 |
| rawcmd 能否跑所有玩家指令 | **否**，`AllowServer=false` 的指令会被拒绝 | ✅ 源码验证 |
| Token 语义 | 内存态、重启即失效、按 IP 限流 | ✅ 源码验证 |
| 物品数据来源 | 官方反编译源码 + 官方本地化 JSON | ✅ 已生成 |
| 物品图标来源 | 已解包贴图 `tr-sprite-1458` | ✅ 6195 个 ID 全部解析到图标 |
| `[i:...]` 标签语法 | `[i/s数量/p词缀:ID]` | ✅ 源码正则验证 |
| REST 传输尺寸 | 请求（query/body）可靠上限 **≈ 64 KiB**；响应**无 TShock 上限**（实测 192 MiB） | ✅ 实测，见 `docs/REST_API限制.md` §10 |
| PlayerManager 端点 | 第三方插件 `/pm/look`、`/pm/export`（共用 `playermanager` 权限） | ✅ 源码 + 实测 |

---

## 1. 版本

- **Terraria 1.4.5.8**：`tr-code-1458/Properties/AssemblyInfo.cs` → `AssemblyFileVersion("1.4.5.8")`。
- **TShock v6.2.1**：远程 `origin` 存在 tag `v6.2.1`（commit `b25b3e5`）。
  本地开发检出为 `v6.1.0-43`（`TShockAPI.csproj <Version>6.1.0</Version>`）。
  已 `git diff v6.1.0..v6.2.1` 比对 REST 相关文件：
  - `RestManager.cs`：仅 `/v3|/v4 players/read` 的物品过滤由 `p.active` 改为 `!p.IsAir`。
  - `rawcmd`、`token/create`、`tokentest`、权限判定逻辑**无变化**。
- 正式联调前仍需在目标服务器执行 `version` 指令确认运行时版本。

## 2. TShock REST API（已核实）

参考：`TShock/docs/rest-fields.md`（官方自动生成）+ 源码。

### 2.1 开关与端口
- `RestApiEnabled` 默认 **false**（`TShockLauncher.Tests/.../config.json`）。
- `RestApiPort` 默认 **7878**。
- `RESTMaximumRequestsPerInterval` 默认 **5**，`RESTRequestBucketDecreaseIntervalMinutes` 默认 **1**。
  → 建 token 的限流是**按来源 IP** 计数的。

### 2.2 创建 Token
- 路由：`/v2/token/create`。参数 `username` / `password` 只能放 **query string**。
  > ⚠️ 2026-10-13 实测纠正：`POST` 的 **表单体（`application/x-www-form-urlencoded`）不会被解析**，
  > `args.Parameters["username"]` 为 null → `Uri.UnescapeDataString(null)` 抛异常 → **HTTP 500**。
  > `GET ?username=&password=` 与 `POST ?username=&password=`（query）均正常。详见 2.9。
- 因此登录凭证必然出现在 URL 查询串 → **必须避免被 nginx / 中间设备日志记录**（见 2.9 与部署配置）。
- 参数：`username`、`password`（会做 `Uri.UnescapeDataString`）。
- 前置条件：该账号所属用户组必须有 `tshock.rest.useapi`（或组名为 `superadmin`），否则返回 403。
- 成功返回：`{ "response": "Successful login", "token": "<64位十六进制>" }`。
- Token 存在内存字典 `SecureRest.Tokens`：**TShock 重启后所有 token 失效**。
- 源码：`TShockAPI/Rest/SecureRest.cs`。

### 2.3 验证 Token
- `/tokentest?token=...` → `{ "response": "Token is valid...", "associateduser": "<用户名>" }`。
- 无效 token 返回 403。

### 2.4 玩家
- `/v2/players/list?token=...`：无需额外权限，返回在线玩家列表。
- `/v3/players/read?player=&token=...`：需要 `tshock.rest.users.info`，含 nickname/group/position/inventory 等。
- `/v4/players/read`：同上，物品为结构化 `NetItem`。

### 2.5 状态 / 版本探测（重要）
- `/v2/server/status?token=...`：**默认不需要 token**（`EnableTokenEndpointAuthentication=false` 时注册为公开路由）。
  返回 `name / serverversion / tshockversion / port / playercount / maxplayers / world / uptime / serverpassword`。
- 用途：
  1. 探测「TShock 服务不可用」。
  2. 启动时核对服务器 `serverversion` / `tshockversion` 是否与 `data/meta.json` 一致，不一致就告警。
- 带 `players=1` 时返回玩家列表；是否含 IP 取决于 token 用户组的 `tshock.rest.viewips` 权限。

### 2.6 玩家名补全的边界
- 在线玩家：`/v2/players/list`（无需额外权限）可拿。
- 离线账号：`/v2/users/list` 需要 `tshock.rest.users`（管理权限）。
  → 普通玩家的「玩家名补全」只能覆盖**在线玩家**，这一点要在 UI 上说清楚。

### 2.7 运行时「我能用哪些指令」
- 没有 REST 端点能列出指令。但可以用玩家的 token 调 rawcmd 执行 `help`：
  `Commands.Help` 会用 `cmd.CanRun(player)` 过滤，返回该玩家**有权限运行**的指令名（分页文本，如 `Commands (1/3): ...`）。
- 局限：输出是本地化文本且分页，需要解析；且不体现 `AllowServer` 约束。
  → 可作为阶段 2 的**运行时可执行集校准**，静态补全仍以 `data/commands.json` 为主。

### 2.8 执行指令
- 路由：`/v3/server/rawcmd?cmd=<完整指令>&token=...`。
- 需要 `tshock.rest.command`（常量 `RestPermissions.restrawcommand = "tshock.rest.command"`）。
- 执行方式（`RestManager.ServerCommandV3`）：
  ```
  Group g = TShock.Groups.GetGroupByName(token.UserGroupName);
  TSRestPlayer tr = new TSRestPlayer(token.Username, g);
  Commands.HandleCommand(tr, cmd);
  return { response: tr.GetCommandOutput() };
  ```
- **权限判定**：`Commands.HandleCommand` 对每条命令调用 `cmd.CanRun(player)`，用的是 token 所属用户组的权限。
  → **不会提权**；`tshock.su` 的 `sudo` 覆盖只对拥有该权限的账号生效。
- **关键限制**：`HandleCommand` 里有一条
  `else if (!cmd.AllowServer && !player.RealPlayer) → "You must use this command in-game."`
  `TSRestPlayer` 的 `Index = -1` → `RealPlayer == false`。
  → **`AllowServer=false` 的指令无法通过 rawcmd 执行**。
- 95 条核心指令中有 **24 条** `AllowServer=false`，包括玩家最常用的：
  `item(/i)`、`tp`、`tphere`、`home`、`spawn`、`buff`、`spawnboss`、`spawnmob`、`pos`、`grow`、
  `setspawn`、`setdungeon`、`party`、`wallow`、`death`、`pvpdeath`、`login/logout/register/password/setup`。
- 因此 **rawcmd 只能作为「服务器可执行指令」的通道**，不能作为玩家通用执行通道。

### 2.9 本机真实服务器实测（2026-10-13，已通过 nginx /tshock/ 反代验证）

目标：本机 Docker `ghcr.io/pryaxis/tshock:6.2.1`，配置 `s/ts/tshock/config.json`
（`RestApiEnabled=true`、`RestApiPort=7878`、`EnableTokenEndpointAuthentication=true`）。

- `/tshock/tokentest?token=simpleToken` → `200 { associateduser: "高端玩家" }`。
- `/tshock/v2/server/status?token=...` → `serverversion` 为 **`"v1.4.5.8"`（带前导 v）**，
  `tshockversion` 为 `"6.2.1.0"`，`world` 为中文名。
  → 前端与 `data/meta.json` 的 `1.4.5.8` 比较时**必须先去掉前导 `v`**，否则误报版本不一致。
- `EnableTokenEndpointAuthentication=true` 时 `/v2/server/status` **需要 token**（无 token 返回 401）。
  前端启动探测若允许匿名，需把该开关设为 false；否则探测也必须带 token。
- 无 token 访问 `/tshock/` 根路径 → TShock 返回自己的 404 JSON（说明反代前缀去掉正确）。
- **建 token 限流是全局共享的（部署相关）**：TShock 用 `context.RemoteEndPoint.Address` 计数。
  经 nginx/OrbStack 反代时，服务器看到的来源 IP 是 **网关（实测 `<gateway-ip>`）**，
  即**所有玩家共用一个桶**（默认 5 次/分钟），不是「每人 5 次」。
  实测日志：`<gateway-ip>的REST登录已被阻止...达到了 RESTMaximumRequestsPerInterval 的上限`。
  → 玩家可公开登录前，需调大 `RESTMaximumRequestsPerInterval`（或改为玩家直连 TShock，但那会引入 CORS 问题）。
- **凭证落盘风险（已缓解）**：默认 combined 日志会记录完整 query，把 `password=` 写进 `logs/<site-host>.log`。
  已在 nginx 为 `/tshock/` 单独配 `log_format tshock_access`（只记 `$uri`，不带 `?query`）→ `logs/tshock-access.log`。
  TShock 自身对 `/v2/token/create` 注册为 `DoLog = false`，不会记录该端点。

### 2.10 第三方插件 PlayerManager 的 REST 端点（非 TShock 本体）

来源：第三方插件 PlayerManager 源码 `PlayerManager/Rest.cs`（未入库）+ 本机实测。
PlayerManager 不是 Pryaxis 官方组件；服务器未安装时，TShock 对 `/pm/*` 返回 **404**（本项目据此判断「插件未安装」）。

| 端点 | 权限 | 返回 |
| --- | --- | --- |
| `GET /pm/look?name=&token=` | `playermanager` | 血量/蓝量 + `inventory`（`NetItem` 串）等 |
| `GET /pm/export?name=&base64=true&token=` | `playermanager` | `{"base64s":["<.plr 的 base64>"]}` |

- **两个端点共用同一个权限节点 `playermanager`**（`Rest.cs` 两处 `[Permission("playermanager")]`）：
  给普通玩家看背包，就等于同时给了导出存档的能力；要「只能看、不能导出」必须在插件侧拆权限。
- 区分三种情形：**404=未安装**；**403=无权限**（或 token 失效）；用空 `name` 调 `/pm/look` 返回 **400=插件存在**（报缺参数）。
- `inventory` 格式：`NetItem.ToString()` = `netId,stack,prefixId,favorited`，格子间用 `~`；共 **350 格**
  （`TShockAPI/NetItem.cs` 的 Index 常量：背包 59 / 装备 20 / 染料 10 / 杂项 5+5 / 猪猪 40 / 保险箱 40 /
  垃圾桶 1 / 熔炉 40 / 虚空袋 40 / 三套配装各 30）。
- 传输尺寸实测（用真实 `hf.plr`）：见 `docs/REST_API限制.md` §10.1。

## 3. 默认分组权限

`TShockAPI/DB/GroupManager.cs` 首次建库时创建的默认组：
- guest / default（注册用户）：只有建造、注册、登录、聊天等基础权限。
- **没有任何默认组包含 `tshock.rest.useapi` 或 `tshock.rest.command`**。

→ 要让玩家用 WebUI，服务器管理员必须显式给该用户组赋这两个权限。
→ 这也意味着「授权 WebUI」不会顺带给出玩家本来没有的游戏权限。

## 4. 物品数据

### 4.1 ID ↔ 内部名
- `tr-code-1458/Terraria.ID/ItemID.cs` 枚举：`public const short Zenith = 4956;`
- 已核对：`LifeCrystal=29`、`IronPickaxe=1`、`Zenith=4956`。
- 枚举中存在负值占位（`GoldPickaxeOld = -1` 等 48 个）必须排除；`ItemID.Count = 6196`。

### 4.2 名称（官方本地化）
- `tr-code-1458/Terraria.Localization.Content.zh-Hans.Items.json` → `.ItemName`（6184 条）
- 英文：`...en-US.Items.json`（注意：该文件含尾逗号，不是严格 JSON，需容错解析）
- 已核对：`Zenith → 天顶剑`、`IronPickaxe → 铁镐`。

### 4.3 词缀
- `Terraria.ID/PrefixID.cs`：`Legendary = 81`。
- 名称在本地化 `Prefix` 节点（中英各 97 条）。

### 4.4 物品标签（官方集合）
- `ItemID.cs` 内 `ItemID.Sets` 有 106 个集合，可为物品提供可扩展标签。
- 生成器只取其中面向玩家的白名单（食物、任务鱼、宝匣、材料、悠悠球……）。

## 5. 物品图标（本机已解包）

- 目录：`<仓库>/../tr-sprite-1458/Content/Images/`
- `Item_<id>.png` 共 **6134** 个；`ItemID.Count = 6196`。
- 缺贴图的 62 个 ID 全部由 `ItemID.Sets.TextureCopyLoad` 指定回退贴图；
  其中 `3705/3706 → 3665 → 48` 需要递归解析。**解析后 6195 个 ID 全部有图标。**
- 图标为原始贴图，动画物品是**纵向多帧**：
  - 帧数来源：`Main.InitializeItemAnimations()` 的 `DrawAnimationVertical(ticks, frames)`；
    食物类 `ItemID.Sets.IsFood` 统一 3 帧；占卜球 `DrawAnimationScryingOrb` 9 帧。
  - 例：`Item_75.png`（坠落之星）`22×208`，8 帧 → 每帧 `22×26`。
  - 前端渲染第一帧需按 `宽 × (高/帧数)` 裁剪。
- 版权：图标是 Re-Logic 的游戏资源，**不提交进仓库、不对外分发**；由构建机从本地游戏资源生成。
- 备选（不推荐）：`tr-wiki/images` 来自 terraria.wiki.gg，许可为 **CC BY-NC-SA 4.0**（禁商用）。

### 5.1 图集合成（本轮新增，已实现并验证）

参考本机 `FishShopConfig/img/`：
- 它把全部图标合成 `items.png`（密排；本项目生成的图集是 **1024 × 4906**，见下方差异）
  （`itemsPngInfo[id] = {x, y, w, h}`，动画物品存第一帧尺寸）。
- 摆法：按「高降序、宽升序」排序，逐行摆放，超过 1024 宽换行。
- **每格之间留 1px 透明缝**（`--padding 1`，三张图集一致）：前端缩小图标时会开插值，
  紧贴摆放时双线性采样会读到邻居精灵的纹素，图标边缘出现 1px 亮/暗线（见
  `docs/功能-富文本解析.md` §6.2）。参考项目是无 padding 的密排，本项目刻意不同。
- 前端 `ctx.drawImage(atlas, x, y, w, h, ...)`，采样用双线性（`imageSmoothingEnabled=true`，对齐游戏的 `LinearClamp`）。

本项目实现 `tools/gen-atlas.py`（Python + Pillow），已实际运行：

| 项 | 实测值 |
| --- | --- |
| 物品数 | 6195 |
| 唯一贴图 | 6133 |
| 图集尺寸 | 1024 × 4906（含每格 1px 缝；无 padding 时 1024 × 4584） |
| 体积 | 2.0 MB |
| 耗时 | 合成 1.16s + 编码约 4s |
| 校验 | `75 → [560,3042,22,26]`、`4956 → [658,152,56,56]`，裁切结果与源图第一帧逐像素一致 |

- 裁切 key 是**贴图 id**（`items.json` 里的 `item.icon`）；动画物品的 `w/h` 已是单帧尺寸。
- 62 个无自身贴图的物品通过 `icon` 复用回退贴图的区域，不需要额外名额。
- 高度 4906 < 8192，单张图集在所有主流浏览器可用；若将来超过需分页（或调小每格 padding）。
- 输出 `items-atlas.png` + `items-atlas.json`（均随仓库提交）。

## 6. `[i:...]` 标签语法

TShock 自己的解析（`TShockAPI/Utils.cs#GetItemFromTag`）：
```
\[i(tem)?(?:\/s(?<Stack>\d{1,4}))?(?:\/p(?<Prefix>\d{1,3}))?:(?<NetID>-?\d{1,4})\]
```
支持：`[i:29]`、`[i/s10:29]`、`[i/p81:4956]`、`[i/s21/p81:4956]`。
- 游戏自己生成的是**逗号版** `[i/p81,s21:4956]`（本地插件 `TShockChestTool` 有兼容实现）。
- `p81 = 传奇`（已核对 `prefix_id.md`）。
- `s` = 数量，`p` = 词缀；二者只影响**显示**，不是指令参数格式。

## 7. 历史决策（band2 纯静态方案，已废弃）

> band2 曾计划「纯静态站点 + nginx 反代 `/tshock/` + token 存 `localStorage` + 子路径 `base=/tr/`」。
> band3 已改为 **单容器 + Go 后端 + 后端内存会话 + HttpOnly Cookie**（见 `docs/ARCHITECTURE.md`）。
> 下面只保留仍成立的结论；其余（nginx、浏览器存 token、`tswui:auth` 键、子路径 base）全部废弃。
> 例外：2026-10 起 GitHub Pages **仅静态演示**（`VITE_TRANSPORT=mock`）重新使用 `VITE_BASE` 子路径，
> 不影响生产单容器的 `base=/` 与同源 `/api/*`（见 `docs/ARCHITECTURE.md` §6.4）。

**为什么浏览器不能直连 TShock REST**（`TShockAPI/Rest/Rest.cs`，结论仍成立）：

- 无 CORS 头（`Rest.OnRequest` 只写 `Content-Type` / `Server`）；无 OPTIONS 预检处理。
- 凭证只能放 query string，明文 HTTP 下 URL 可能被中间设备记录。
- 所以跨源时浏览器读不到响应 → 必须由**同源后端**转发（现由 Go `/api/*` 承担）。

**网关 IP 限流**：经后端 / 反代后 TShock 只看到网关 IP（见 §2.9），所有玩家共用一个限流桶；
「按玩家各自 IP」只在浏览器直连时成立。

界面记忆的当前设计见 `docs/设计原则与约束.md` §4.6；Tier B（`allowServer=false` 指令）见 `docs/插件-信使.md`。

## 8. band3 容器化与 Go 后端联调补记（2026-10-13）

本节记录阶段 2（单容器 + Go 后端）实现期间新核实的事实，均为本机实测。

### 8.1 真机实测（本机 TShock 6.2.1，`-lang 7` 中文）

- `/v2/server/status?token=simpleToken` → `serverversion=v1.4.5.8`、`tshockversion=6.2.1.0`、
  `world=中秋快乐`、`port=7777`。
- `EnableTokenEndpointAuthentication=true`、无 token 时 `/v2/server/status` → **HTTP 401**
  （中文 `未授权。指定的 API 终结点需要一个令牌。`）。
- `simpleToken` 是 ApplicationRestToken，关联用户 `高端玩家`。

### 8.2 ⚠️ 本地化陷阱（已修复，务必保留）

TShock 的错误与命令输出都经过 i18n（`i18n/zh_CN/TShockAPI.po`）。在中文服务器上：

| 场景 | 中文实际文案 | 影响 |
| --- | --- | --- |
| 403 无效 token | `未授权：指定的API端点需要授权令牌，但使用的令牌无效。` | **不含英文 `token`**，靠 `token` 关键字区分会误判为「权限不足」 |
| 200 权限不足 | `你没有权限使用该指令。` | 英文标记 `You do not have access...` 匹配不到 |
| 200 无效指令 | `输入的命令无效。使用/help 获取可用的指令列表。` | 英文标记匹配不到 |
| 200 仅限游戏内 | `你必须在游戏内使用该指令。` | 英文标记匹配不到 |

因此后端实现采用两条不依赖单一语言的策略（`server/internal/tshock/client.go`）：

1. **403 语义不靠文案**：先调 `/tokentest`；返回 2xx → `no_permission`，401/403 → `token_invalid`。
2. **命令输出判定含中英文标记**：`classifyOutput` 同时匹配英文原文与 zh_CN 译文。
   匹配前先归一化（转小写 + 空白合并），并按句式区分两类：
   - 「指令不存在」（`command_not_found`，说明提供该指令的插件没装）：
     en `Invalid command entered. …`（带 `entered`）/ zh `输入的命令无效。…`；
   - 其余「无效指令」类（`command_error`，用法/参数写错）：例如插件自己打印的 `无效指令：xxx`、
     `语法错误，输入 /fish help 查询用法` —— **故意不把这两类混在一起**，
     否则首页依赖插件的卡片会被误判成「插件未安装」而隐藏。

实测：`rawcmd /time`（simpleToken 所属组缺 `tshock.rest.command`）→ 后端分类
`no_permission`（而非 `token_invalid`）；`ServerStatus` 版本规范化为 `1.4.5.8`。

### 8.3 `/v2/players/list` 返回结构

不是字符串数组，而是对象数组：

```json
{ "players": [ { "nickname": "Alice", "username": "", "group": "guest", "team": 0, ... } ] }
```

昵称字段为 **`nickname`**（源码 `RestManager.PlayerFilter` 已核实）。后端提取 `nickname` 后
以 `{ "players": ["Alice", ...] }` 对外。

### 8.4 容器镜像

- Dockerfile：预构建 `web/dist` → `golang:1.27-alpine`（`BUILDPLATFORM` 上交叉编译，`TARGETOS/TARGETARCH`）→ `gcr.io/distroless/static-debian12:nonroot`。
- 实测镜像体积：当前约 **19–20MB**（≤ 30MB 目标；早期原型为 12.9MB）。
- 前端数据不再用 `web/public/data` 符号链接：`vite.config.ts` 的 `dataDirPlugin` 开发时从
  仓库根 `data/` 提供 `/data/*`，构建时复制到 `dist/data`；Dockerfile 把 `data/` 覆盖进 `server/internal/webdist/data/`。
- 静态资源的 SPA 兜底只对**无扩展名**路径生效；`/assets/*`、`/data/*` 缺失一律 404。

### 8.5 已验证的端到端行为（容器运行，`TSHOCK_URL=http://host.docker.internal:7878`）

- `GET /healthz` → `{"status":"ok"}`；`?deep=1` → `tshock_reachable:true`。
- `GET /api/status` → 无会话时 `{"reachable":true}`（TShock 要求 token，拿不到版本但仍可达）。
- 错误账号 `POST /api/login` → `401 bad_credentials`（TShock 403 统一文案，不泄露账号是否存在）。
- 无 `X-Requested-With: tswui` → `403 csrf`；未登录 `POST /api/command` → `401 not_authenticated`。
- `/assets/<hash>.js` → `Cache-Control: public, max-age=31536000, immutable` + gzip。

### 8.6 真实指令链路（用 ApplicationRestToken 验证）

TShock 的 `ApplicationRestTokens` 提供可直接使用的 token（本机 `config.json` 的 `ApplicationRestTokens` 里各有一个，
分别关联 `GM` 组与 `default` 组）。用该令牌预置会话后，走真实 `/api/command` handler 验证：

| 输入 | 后端分类 | 真实 output |
| --- | --- | --- |
| `/time` | `ok` | `["当前时间是19:18。"]` |
| `/who` | `ok` | `["目前没有在线的玩家。"]` |
| `/i 29` | `rejected`（Tier A，未发往 TShock） | — |
| `/definitely-not-real` | `rejected` | — |
| `/time`（用 `simpleToken`，组 default 缺 `tshock.rest.command`） | `no_permission` | 403 中文文案由 `/tokentest` 消歧 |

集成测试（默认不跑）：

```bash
TSHOCK_URL=http://127.0.0.1:7878 TSHOCK_TOKEN=$TSHOCK_TOKEN \
  go test -tags integration -run Integration -v ./internal/api ./internal/tshock
```

### 8.7 登录链路验收

- **应用令牌登录（已实现并真机验证）**：`POST /api/login {"token":"<应用令牌>"}` →
  `{"username":"GGMM"}` + `HttpOnly` Cookie；随后 `/api/command /time` → `ok` +
  `["当前时间是19:18。"]`；退出后再执行 → `401 not_authenticated`。
  这已覆盖完整的「登录 → 会话 → 执行 → 退出」HTTPS 链路（浏览器可直接复现）。
- **账号密码成功登录（已真机验证）**：`hf`（GM 组）/ 密码 → `POST /api/login` 返回 `{"username":"hf"}`。
  失败路径同样验证（错误密码 → `401 bad_credentials`）。
- **真实指令验证**（HF 在线时）：
  - `/give 123 hf 1` → `已将1个流星头盔给予hf。`（HF 离线时返回 `玩家不存在！`）。
  - `/playing` → `在线的玩家([c/AAFFAA:1]/8)` + 玩家名（带 Terraria 颜色标签）。
  - `/fish`（FishShop 插件指令，不在核心 `commands.json`）→ `语法错误，输入 /fish help 查询用法`。
    证明 Tier A **不再前置拒绝未知/插件指令**，而是放行给 TShock 判定。
  - `/i 29`（allowServer=false）→ `rejected`，不发出站请求。
- **普通玩家登录受限（硬约束）**：`default` 组没有 `tshock.rest.useapi` / `tshock.rest.command`，
  密码正确也会被拒（与密码错同为 403，后端无法区分）。服主需执行：
  `/group addperm default tshock.rest.useapi tshock.rest.command`。
  GM / trustedadmin / newadmin 等带 `*` 的组无需执行。前端登录失败时会展示该命令并提供复制。

端到端 curl 复现（需本机后端在跑）：

```bash
J=/tmp/c.txt
curl -s -c $J -X POST -H 'X-Requested-With: tswui' -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TSHOCK_TOKEN\"}" http://127.0.0.1:18082/api/login
curl -s -b $J -X POST -H 'X-Requested-With: tswui' -H 'Content-Type: application/json' \
  -d '{"cmd":"/time"}' http://127.0.0.1:18082/api/command
```

### 8.8 ⚠️ 建 token 的 IP 限流会伪装成「账号或密码错误」（实测）

- TShock `RESTMaximumRequestsPerInterval` 默认 **5**，`RESTRequestBucketDecreaseIntervalMinutes` 默认 **1**。
- 桶按**来源 IP**计数；经 Docker 端口映射/反代时，宿主机与容器都表现为网关 IP（实测 `<gateway-ip>`），**全站共用一桶**。
- 超限时 TShock 对 `/v2/token/create` 返回 **403**，文案与「密码错误 / 无权限」完全相同：
  `Username or password may be incorrect or this account may not have sufficient privileges.`
  → 后端无法区分，只能归为 `bad_credentials`。
- TShock 日志会打印：`{ip}的REST登录已被阻止，因为它目前有N个限流标识，并且达到了RESTMaximumRequestsPerInterval（一段时间内最大请求数量）的上限。`
- 桶**每 1 分钟只减 1**，所以连续多次尝试后需要较长时间恢复；重启 TShock 会清空内存桶。
- 后端登录失败提示已补充「也可能触发限流」的线索；`/api/login` 与 TShock 的 `token/create` 是 1:1 调用。

**运维建议**：测试/上线前把 `RESTMaximumRequestsPerInterval` 调大。
本机测试环境已按用户确认将 `Settings.RESTMaximumRequestsPerInterval` 由 **5 改为 60**（`s/ts/tshock/config.json`）并重启 TShock；
验证：连续 8 次账号密码登录全部成功。生产环境请自行评估。
