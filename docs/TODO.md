# TODO.md — 待办清单（已知未做项 / 有意推迟项）

本文件是**唯一**的「还没做」清单：每条都写清**现状证据、为什么没做、打算怎么做、怎么验收**。
需求基线见 `docs/设计原则与约束.md`（产品原则 / 范围 / 硬约束）；具体待办以本文件为准。

状态约定：`待定` = 未开始；`研究` = 需要先调研再定方案；`已有方案` = 方案明确，只差实施。

---

## P1 · 数据类补全缺口（参数补全的剩余部分）

`data/commands.json` 的 `paramSets` 只声明**本地真有数据源**的补全类型。
下面这些参数目前是 `kind: "text"`（只显示用法串提示，不给候选），不是 bug，是没数据源。

| 项 | 覆盖的指令 | 现状 | 现成数据源 | 状态 |
| --- | --- | --- | --- | --- |
| NPC / 怪物 / BOSS / 小动物名 | `/spawnmob`、`/butcher [NPC name\|ID]`、`/tpnpc`、`/kill` | **已实现** | `data/npcs.json` + `loc.NPCName` | 已完成 |
| buff 名 / ID | `/gbuff <buff>`、`/buff`（游戏内） | **已实现** | `data/buffs.json` + `loc.BuffName` | 已完成 |
| 权限节点 | `/group addperm <permissions...>`、`/group delperm`、`/account addperm` | **已实现** | **`data/permissions.json`**：`tools/gen-permissions.mjs` 从 TShock 源码 `TShockAPI/Permissions.cs`（`public static readonly` + `[Description]` 注解）+ `TShockAPI/Rest/RestPermissions.cs`（含 `tshock.rest.useapi/.command`）抽取 **175 个节点**，每个带 TShock 原文说明 | 已完成 |
| 用户组名 | `/group addperm <group name>`、`/itemban allow <item> <group>`、`/region allowg <group>` | **已实现（内置集合）** | 同一份 `data/permissions.json` 的 `groups`：`AddDefaultGroup()` + 两个配置项默认值 → **8 个内置组**（guest/default/vip/newadmin/admin/trustedadmin/owner/insecure-guest） | 已完成（自定义组仍需手输） |
| 区域名 / 传送点名 | `/region …`、`/warp <name>` | **已实现（运行时）** | 信使插件 `/webui/data?type=regions\|warps` → `/api/data`，前端登录后注入补全 | 已完成 |

实施记录（权限节点 / 用户组，已完成）：`tools/gen-permissions.mjs` 从 **TShock 源码**抽取
`data/permissions.json`（175 节点 × 带说明 + 8 内置组），`tools/gen-game-data.sh` 已串入流水线（重跑幂等）；
`types.ts` 的 `ParamKind` 增加 `permission` / `group`，`completion.ts` 增加两个分支（权限按**节点文本 + 说明**搜索），
`tools/gen-data.mjs` 的 `RUNTIME_KIND_BY_ARG` 把 `permissions` / `group name` / `group` 映射过去。
**边界**：这只是「内置 / 默认」集合 —— 自定义组与插件权限节点只有服务器运行期知道，补全给候选项但**允许手输任意值**；
信使插件仍然**不**提供运行期的组/权限列表（避免泄露权限结构）。
验收：`completion.realdata.test.ts` 覆盖 `/group addperm <组> <Tab>`、按说明搜（`rest`）、
`/itemban allow <物品> <Tab>`、`/region allowg <Tab>`；`dataset.realdata.test.ts` 覆盖数据结构与无重复。

实施记录（NPC / buff / 区域 / 传送点，已完成）：`tools/gen-data.mjs` 新增生成 `data/npcs.json` /
`data/buffs.json`（ID→内部名，名字取自 `loc.NPCName`/`loc.BuffName`）；`PARAM_KINDS`/后处理把
`NPC`/`buff`/`region`/`warpname` 等参数名映射到新 kind；`completion.ts` 增加 `npc`/`buff`/`region`/`warp` 分支；
区域/传送点由信使插件运行时提供。验收：`completion.realdata.test.ts` 与 `dataset.realdata.test.ts` 已覆盖；
`node tools/gen-data.mjs` 可重复生成。

---

## P2 · `/data/*.json` 的缓存语义 —— **已完成（2026-10-26）**

- 现状：`data/*.json` 返回 **内容哈希弱 ETag（`W/"…"`）+ `Cache-Control: no-cache`**，`If-None-Match` 命中回 **304**。
  升级后不再需要等一小时（之前的 `max-age=3600` 会让旧的 `commands.json` 继续生效，表现为参数补全静默消失）。
- 实现：`server/internal/api/handlers.go` 的 `isDataJSON` / `dataFile` / `serveDataJSON`
  （ETag 与字节按文件名缓存一次，内嵌资源不可变；`http.ServeContent` 负责条件请求与 Range）。
- 其他缓存语义不变：`/assets/*` 仍 `immutable`，图集 PNG 仍 `max-age=604800`，`/demo/*` 仍 `max-age=86400`。
- 验收：`TestDataJSONETagAnd304`（200 + ETag + no-cache / 命中 304 且无 body / 内容变化后 ETag 变化并 200 / HEAD 带 ETag /
  PNG 与 `/assets/*` 缓存头不变）；单二进制实测 `curl -I /data/commands.json` → `no-cache` + `W/"2f0e…"`，
  带 `If-None-Match` → **304 / 0 字节**，正文与 `data/commands.json` 逐字节一致。详见 `docs/记录-实现与验收.md`。

---

## P3 · 功能类（原则与设计已记录，非缺陷）

| 项 | 出处 | 说明 | 状态 |
| --- | --- | --- | --- |
| 编辑器内直接把 `[i:ID]` 渲染成图标 | `docs/设计原则与约束.md` §2.1（可选增强） | 结果区已渲染图标；编辑器内保持纯文本以保住原生编辑 / 撤销 / 光标行为 | 待定 |
| 更丰富的参数表单（下拉、开关代替裸文本） | `docs/设计原则与约束.md` §2.2（规划中） | 参数表已具备（`required` / `kind` / `values`），可据此做结构化输入控件 | 待定（属阶段 5） |
| Tier B 信使插件，支持 `AllowServer=false` 的 24 条指令 | `docs/设计原则与约束.md` §2.1 / `docs/ARCHITECTURE.md` §10 | 已随信使插件 WebUI 实现（`AllowInGameOnlyCommands`，前后端默认关）；**改为默认开需用户确认** | 已完成（默认关） |

> 注：`plugin/WebUI/` 是自研信使插件（用户明确要求，见 `docs/设计原则与约束.md` §4.5）：在线授权 / 批量执行 /
> 只读信息 / 事件 / 会话自助，以及 Tier B（`AllowInGameOnlyCommands`，前后端默认关）。它**不提权**——
> 权限就是 token 用户组；Tier B 只是把 `AllowServer=false` 的指令以真实在线玩家身份执行，仍不提权。

---

## P4 · 工程质量

| 项 | 现状 | 状态 |
| --- | --- | --- |
| `scripts/build-binary.ps1` 未在 Windows 实机验证 | 只做了语法复核（本机无 pwsh）；README 已标注 | **步骤见 [`验收清单.md`](验收清单.md) §D** | 待定 |
| Windows 二进制未在 Windows 上运行 | 只验证了能交叉编译出 `tswui.exe`（15MB） | **步骤见 [`验收清单.md`](验收清单.md) §D** | 待定 |
| 物资申请「在线发放」未用真实客户端验收 | 离线批准 / 补发 / 审核 / 限额 / item ban 判定已在 TShock 6.2.1 实测；在线 `GiveItemCheck` 路径需进服验收 | **步骤见 [`验收清单.md`](验收清单.md) §C** | 待验证 |
| `.plr` 编辑结果未用真实客户端验收 | 写回不变量（长度不变 / 只改目标字节 / 重新解析逐项一致）已用 **106 份真实存档**验证（`web/src/lib/save/localSaves.test.ts`），但「进游戏加载后生命 / 背包 / 词缀 / 模式确实生效」只能由客户端确认 | **步骤见 [`验收清单.md`](验收清单.md) §A** | 待验证（需真实客户端） |
| `.wld` 编辑结果未用真实客户端验收 | 同上：**75 个真实世界**通过了 改名 / 种子 / 难度 / 出生点 / 时间 / 月相 / 困难 / Boss 的写回与重新解析，段指针与 footer 同步也有断言；「游戏里能正常打开」仍需客户端确认 | **步骤见 [`验收清单.md`](验收清单.md) §B** | 待验证（需真实客户端） |
| 前端 i18n 键需人工对齐 zh/en | 已加 `web/src/lib/i18n.test.ts`：校验 zh/en 键集合与占位符一致（`dicts` 导出以便测试） | 已完成 |
| 命令执行限流按会话计数 | 多标签页共享额度（符合「每个玩家」语义）；如需按标签页可再议 | 已完成，仅备注 |

---

## P5 · UI 一致性与体验（来自 `docs/审查-UI一致性与体验.md`）

先看审查全文（含证据、降级矩阵、业务建议）：`docs/审查-UI一致性与体验.md`。

| 项 | 现状 / 证据 | 方案 | 状态 |
| --- | --- | --- | --- |
| 抽共享 `CardManagerSheet`，彻底统一「管理卡片」 | 首页 `HomeCardManager` 与模块/鱼店 `ModuleCardManagerDialog` 都复用 `components/CardManagerSheet.tsx`（添加卡片按钮按需展开表单、自定义卡片按需编辑、自动执行=`Checkbox`、删除=`ConfirmButton`；排序/可见性/恢复默认按需注入） | 已完成 |
| 微型字号刻度统一 | 已在 `index.css` 定义 `--text-2xs`(11px)；全站 `text-[10px]`/`text-[11px]`（共 99 处）→ `text-2xs`，与 `text-xs`(12px) 组成两级微字号刻度（例外：Terraria 物品提示的 15px 游戏字号） | 已完成 |
| 空态统一 | `Empty` 新增 `size="sm"` 紧凑变体；`recentEmpty` / `eventsEmpty` / `cards.empty` / `sessionsEmpty` / `noMatch` 裸 `<p>` 已改用 `Empty`+`EmptyDescription` | 已完成 |
| 破坏性删除确认一致 | 模块卡片 / 自定义模块 / 服务器 / 首页自定义卡片改为 `ConfirmButton` 二次确认（新增 `action.deleteConfirm`）；`ConfirmButton` 的 `children` 改可选以支持纯图标按钮 | 已完成 |
| 手写彩色提示改 `Alert` | `PlayerManagerPage`（错误）、`FishShopPage`（购买成功）已改为 `Alert variant="destructive|success"` | 已完成 |
| 巨型组件拆分 | 新增 `player/PlayerLookView`、`codex/CodexViews`、`fishshop/GoodCells`、`command/HistoryPanel`、`items/DexCell`、`items/DexPagination`、`items/PrefixPicker`、`home/commandCards`、`home/HomeOverviewCards`、`settings/CustomModulesSection`、`settings/PreferencesCards`、`AppRoutes` 与共享 `Notice`；PlayerManagerPage 1057→597、CodexPage 819→476、FishShopPage 781→663、CommandPage 712→574、ItemsPage 989→820、HomePage 872→640、SettingsPage 611→382、App 865→753 | 已完成 |
| 首页卡片拖拽无障碍 | 原生 HTML5 DnD + `GripVertical` 手柄之外，新增「上移 / 下移」图标按钮（键盘 / 触屏可用，首尾禁用），见 `components/CardManagerSheet.tsx` | 已完成 |
| 自定义模块导航排序 | 设置页自定义模块支持拖拽与键盘 / 触屏上移、下移；顺序存 `tswui:customModules` 并直接决定侧栏顺序 | 无 | 已完成 |
| 事件流 SSE 推送 + 可选持久化 + 更多事件类型 | **SSE 已实现**：`/api/events/stream`（后端 `feedhub` 每个上游共享轮询），前端在传输层支持时建长连接、不可用退回轮询；统一聊天模型（`type=chat` + `source=game\|webui`）已完成 | 有上限的追加文件保存历史；更多事件类型 + 前端过滤/高亮 | 待定（研究） |
| 网页聊天：回复/引用 + 内容区骨架 | 消息模型（`id`/`time` + 失败重试）已完成；自定义模块排序、懒加载路由、鱼店货架与角色背包骨架已完成 | 点消息引用 | 待定（P3） |
| 插件能力探测重复 | 已收敛：`GET /api/capabilities` 一次返回 `messenger/batch/player/fish/requests/webauth`，前端 App / 首页 / 设置页统一读它（`transport.capabilities()`；3 秒微缓存 + `?fresh=1`）。页面内「重新检测」仍走单点端点 | 无 | 已完成 |

> 已完成（近期）：自定义模块「名称 + 主指令 + 顶部说明」可配、首页「自动执行」控件统一为 `Checkbox`、插件卸载时「统一执行」开关显示一致、聊天统一 `type=chat`+`source`、发言 `id`/`time`+失败重试、`ChatPrefix` 可配；**聊天已独立成页**（`#/chat`，见 `docs/功能-服务器动态.md`），不再是「指令」页底部的模式切换。

---

## P6 · 世界存档（`.wld` 查看器）的后续

当前已交付：本地 `.wld` / `.wld.bak` / `.wld.bak2` 导入（**纯前端解析，文件不上传**）→ 按像素预算渲染缩略图
（小 / 中世界 1 图格 = 1 像素，大世界 2 图格/像素 = 4200×1200）+ 点开看 1:1 大图 + 世界基本信息 +
导出原文件 / 导出 PNG + 自带 Demo（`web/public/demo/world.wld`）。见 [`页面-世界存档.md`](页面-世界存档.md)。

| 项 | 现状 | 打算怎么做 | 状态 |
| --- | --- | --- | --- |
| 纯前端解析（不上传） | `.plr` 与 `.wld` 都在浏览器解析，后端导入接口已删除 | — | 已完成 |
| 点击缩略图看 1:1 大图 | 点击 → `Dialog` 里滚动查看（1 图格 = 1 像素；大世界 2 图格/像素） | 需要再精细就做下面的「滚轮缩放 / 平移」 | 已完成 |
| 自带 Demo | 工具卡「来个 Demo」拉 `web/public/demo/world.wld`（空白世界，81 KB，release 228） | 可换成 1.4.5.8 的空白世界，让「创建 / 最后游玩时间」等字段也能展示 | 待定 |
| 每服缓存没上限 | `worldPage.ts` 的 `worldCaches` 按 serverId 存整张位图（4200×1200 ≈ 20 MB），切多个服务器会累积 | 改成 LRU(2) 或只缓存 `info`（位图需要时重渲染，单次约 130ms） | 已完成（LRU(2)） |
| 图格 / 墙悬停详情（坐标 + 方块名） | **已完成**：渲染时顺手记录每列图格流偏移（`recordColumnOffsets`，8400 列 ≈ 34 KB），悬停时从列首解码到该行（`lib/save/worldTileAt.ts`），显示「图格名 · 墙：墙名 · 液体名 · (x, y)」，名字与查找图格同一套口径；缩略图下方还有**颜色图例**（占比最高的 6 种方块 + 色块 + 占比，色块与渲染同一张 `TILE_COLORS`） | — | 已完成 |
| 出生点 / 地牢 / 图例叠加 | 缩略图覆盖层画出生点（绿十字）与地牢（紫十字），越界不画 | 分层图例在「地图分析」里已有（分层区块） | 已完成（出生点 / 地牢标记） |
| 滚轮缩放 / 拖动平移（视口渲染） | 只能「点开看大图 + 滚动」 | 视口分块渲染 + 图格缓存的瓦片画布；量大时再考虑 Worker | 研究 |
| 箱子 / 招牌（第 3 / 4 段） | 已解析数量、逐箱内容、招牌全文、NPC 明细（含解析失败降级） | 见 [`功能-地图分析.md`](功能-地图分析.md) | 已完成 |
| 大世界 1:1（8400×2400 = 20.2M px） | **已完成**：顶栏「导出高清图」按 1 图格 = 1 像素重新渲染再编码（`renderWorldHiRes`，`ThumbOptions.res: 1`）。**实测**：8400×2400 → 450 ms / 位图 81 MB（含画布约 160 MB）；4200×1200 → 72 ms / 20 MB。> 8M px 先弹确认；> 24M px（`MAX_HIRES_PIXELS`）直接拒绝 | 手机端没有做「按画布面积自动降级」——目前靠确认框让人自己决定 | 已完成 |
| 颜色表补齐 | **已核对/补齐**：从游戏 `MapHelper.Initialize` 抽出 753（GiantTiki）= `array[158][0] × 0.95` 并写进生成器（表长 753 → 754）。剩下 127 / 135 / 210 / 428 / 504 / 541 **游戏本身没有图格颜色**（MapHelper 里只有墙色 `array4`，或完全没赋值），地图上本来就不可见 → 我们**故意**退回中性灰（比「整块透明」更有用），并写进生成器注释 | 等游戏以后给它们配色时再补 | 已完成（其余为游戏缺失） |
| tModLoader 世界（`.twld` 附带数据） | 只解析原版 `.wld`；`.twld` 忽略 | 需要 tModLoader 的 `TwldData` 结构；目前无需求 | 待定 |
| 大于 1.4.5.8 的世界文件 | 版本 > 326 直接拒绝并提示 | 跟随 `data/meta.json` 的 `gameVersion` 一起升（解析器要按新字段门槛对齐） | 待定 |
| 存档版本 → 游戏版本 | 世界面板显示「1.4.0.4（228）」（复用角色版本表 `lib/save/playerVersions.ts`，世界与角色共用 release 编号） | — | 已完成 |
| 导出 PNG 的自动化测试 | **已完成**：`src/test/canvasStub.ts` 提供记录调用的 canvas 桩（含 `ImageData` 替身），断言画布尺寸 = 位图 / 布局×pixelRatio、`putImageData` 用的是这张位图、文本含玩家名、MIME 是 `image/png`；文件名的清洗规则也有用例 | 真正的像素级比对仍需 headless Chrome（收益低，暂不做） | 已完成 |

---

## P7 · 玩家存档（`.plr`）还没读的字段

现状：解析到「矿车升级包」位图为止，已展示版本 / 模式 / 游戏时间 / 渔夫任务 / Golf / 死亡 /
最后保存 / 当前 BUFF，并可**编辑**生命 / 魔力 / 渔夫 / Golf / 模式 / 版本 / 背包 58 格 / 永久增强
（见 `docs/技术事实.md` 的角色存档字段清单、`docs/插件-玩家管理.md`「玩家存档」、`docs/计划-plr编辑.md`）。
下面这些在文件里、但还没解析 / 还没编辑：

| 项 | 文件字段 | 为什么没做 | 打算怎么做 | 状态 |
| --- | --- | --- | --- | --- |
| 研究进度（研究 Tab） | `creativeTracker`（≥218）：`int32` 条数 + (`string` 持久 ID + `int32` 数量) | **已完成**：条数显示在属性区；点数字打开明细弹窗（可按物品名 / 内部键名搜索，显示「物品 × 已研究数量」）。持久 ID 就是 `items.json` 的 `key`（GameDump 导出 6161 条对过，0 不一致），不需要额外数据表 | 老存档里已改名/移除的物品按原始键名显示（如 `EldMelter` → 1.4.5 是 `ElfMelter`） | 已完成 |
| 三套配装 | `Loadouts[3]`（各 20 装备 + 10 染料 + 10 隐藏位，≥262） | **已解析并展示**：`readPlrTail` 读完矿车升级位后继续读 `CurrentLoadoutIndex` + 3 套配装（物品是完整 `Item.Serialize`，收藏位仅 ≥322），`plrSlots` 映射到 TShock 的 260–349，界面沿用已有的配装块。实测本机 112 份存档里 100 份有这段（896 件配装物品） | 配装**编辑**未做（写回机制与背包同款，只是没开放入口） | 已完成（只读） |
| 编辑装备 / 银行 / 配装槽位 | 同上的容器数组 | **装备区已可编辑**（装备 20 / 染料 10 / 杂项装备 5 / 杂项染料 5 = 40 格，`PlrEdits.equipment`；这几组在文件里没有 stack，编辑器里数量输入禁用）。**已全部开放编辑**：装备 40 格、随身仓储 160 格（各 40）、三套配装 90 格（每套 20 装备 + 10 染料），写回都是 `id + stack + prefix`（装备区没有 stack 字段） | — | 已完成 |
| 重生点（多世界） | `spX/spY/spI/spN[200]` | **已展示**：「玩家存档」属性区下方按世界列出「世界名（坐标）」；导出图片不含（条目数不定）。实测本机 112 份真实存档**都是 0 条**（Terraria 只在设过床时才写），所以界面平时不出现 | 若以后要「按当前世界高亮」，需要把「世界存档」页选中的世界名传进来 | 已完成（数据已展示） |
| 4 个临时槽 | `_temporaryItemSlots`（≥214） | 只是手持临时物品，对「看存档」价值低 | 一般不展示 | 不做 |
| 旅途创意能力开关 | `CreativePowerManager`（≥220） | 每个能力 id 有自己的 payload，逐项适配成本高 | 只展示「已解锁 N 项」时再说 | 待定 |
| 声音变体 / 音高 | `voiceVariant`（≥280）/ `voicePitchOffset`（≥281） | 与展示无关 | 不做 | 不做 |
| 退款队列 / 一次性对话 | ≥300 / ≥310 | 与展示无关 | 不做 | 不做 |
| 团队 / 隐藏位 / 信息开关 / 建造者状态 / 酒保任务 | `team`、`hideVisibleAccessory`、`hideMisc`、`hideInfo`、`builderAccStatus`、`bartenderQuestLog` | 属于客户端偏好，不是玩家想看的角色信息 | 不做（已正确跳过） | 不做 |

> 注意：垃圾桶 `trashItem` **不在** `.plr` 里（运行时状态），本地存档的垃圾桶槽永远是空的，别当成 bug。

### P7.1 · 尾部结构非标准的存档（已知降级，不是「没发现」）

| 项 | 现状 | 为什么没做 | 打算怎么做 | 状态 |
| --- | --- | --- | --- | --- |
| 研究进度段**没有前导 `bool`** 的存档（实测 8 份 release 318 的服务器 SSC 文件） | 「研究进度 → 临时槽 → 创意能力 → 矿车升级位」解析失败时**停在原地**并置 `track.tailUnparsed = true`；属性 / 背包 / 永久增强照常可看可改，只有「矿车升级包」不可编辑并提示「这一项读不出来」 | 原版写端（1.4.5.5 / 1.4.5.8 都对过）**一定写那个 `bool`**，这批文件属于改过的服务端；从字节上无法可靠区分「缺 bool」与「其它变体」，猜偏移就可能写坏文件 | 需要该服务器所用客户端/服务端的写端逻辑（或一份它能正常加载的对照文件）才能安全支持 | 待定（需外部信息） |

---

## P8 · 世界存档（`.wld`）编辑

设计与分期见 [`计划-wld编辑.md`](计划-wld编辑.md)。W1–W4 均已交付：头部字段 / 世界名 / 种子 /
整类替换图格 / 箱子内容与招牌文本（后两者只改内容，不改数量与坐标）。

| 期 | 内容 | 状态 |
| --- | --- | --- |
| W1 | 头部定长字段就地改（难度 / 出生点 / 时间 / 月相 / 血月 / 日食 / 困难模式 / Boss 与事件进度） | 已完成 |
| W2 | 世界名 / 种子（头部段拼接 + 其余段平移 + **重写段指针表** + 同步 footer 里的世界名 + `Revision++`） | 已完成 |
| W3 | 图格替换的「安全子集」 | **已完成**：`lib/save/worldTileReplace.ts`。整类替换（世界里所有 A → B），只改 id 字节、**保留原 frame**；再加两条硬约束保证**文件长度/段指针/footer 全不变**（① 两边 id 字节宽度相同 ② `frameImportant` 同类），因此不重压 RLE、不重排段。UI 在「世界存档 → 编辑」里的「替换图格」卡片（填两个 id、显示将替换多少格、二次确认）。**已知限制**：同为 frame-important 但形状不同的两个图格（2×2 箱子 ↔ 3×2）换完 frame 仍是旧的，游戏里可能显示错位。 |
| W4 | 箱子 / 招牌编辑 | **已完成（只改内容，不改数量/坐标）**：箱子名（≤20 字符，游戏加载时会截断）、箱子里的物品（物品/数量/词缀/清空单格）、招牌文本（≤1000 字符）。写回时这两段是**变长**的 → 整段重建 + 后续段平移 + 重写段指针表（`worldWrite.ts` 的按段拼装）。**加减箱子 / 招牌**不做（要同步图格与索引）。 |

> 关键约束（务必看计划文档 §2）：`.wld` 的段指针表记录**每段结束位置**，任何长度变化都要平移后续段并重写指针；
> footer 里**重复存了世界名 + worldId**，加载时会逐字节比较，改名字不同步 footer 会导致世界打不开。

---

## 相关文档

- `docs/设计原则与约束.md` —— 产品原则、范围与硬约束。
- `docs/记录-实现与验收.md` —— 已完成任务的验收记录（含每项的实测证据）。
- `docs/TECHNICAL_RESEARCH.md` —— TShock 事实与出处；新增数据源前先读它。
