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
| 权限节点 | `/group addperm <permissions...>`、`/group delperm` | 无候选 | 可从 `data/commands.json` 已有的 `permission` 字段 + TShock 的 `tshock.rest.*` 派生（**不完整**，需接受「只是常用集合」） | 研究 |
| 用户组名 | `/group <name>`、`/itemban allow <group>`、`/region allowg <group>` | 无候选 | 需 TShock 运行时数据；本插件未提供（避免泄露权限结构） | 待定 |
| 区域名 / 传送点名 | `/region …`、`/warp <name>` | **已实现（运行时）** | 信使插件 `/webui/data?type=regions\|warps` → `/api/data`，前端登录后注入补全 | 已完成 |

实施记录（NPC / buff / 区域 / 传送点，已完成）：`tools/gen-data.mjs` 新增生成 `data/npcs.json` /
`data/buffs.json`（ID→内部名，名字取自 `loc.NPCName`/`loc.BuffName`）；`PARAM_KINDS`/后处理把
`NPC`/`buff`/`region`/`warpname` 等参数名映射到新 kind；`completion.ts` 增加 `npc`/`buff`/`region`/`warp` 分支；
区域/传送点由信使插件运行时提供。验收：`completion.realdata.test.ts` 与 `dataset.realdata.test.ts` 已覆盖；
`node tools/gen-data.mjs` 可重复生成。

---

## P2 · `/data/*.json` 的缓存语义（升级后可能短暂用到旧数据）

- **现状证据**：`GET /data/commands.json` → `Cache-Control: public, max-age=3600`，**无 ETag / Last-Modified**
  （`server/internal/api/handlers.go`；`docs/ARCHITECTURE.md` §4.1 也是这么写的）。
- **影响**：升级 WebUI 后浏览器最多 1 小时仍用旧的 `commands.json`。
  实测：复用 headless Chrome profile 时，新增的 `paramSets` 读不到 → **参数补全整体静默消失**，
  清缓存/禁用缓存后立刻恢复。`items.json`、`recipes.json` 同理。
- **方案（已有方案）**：对 `/data/*` 加 **ETag**（内容哈希，启动时或首次请求时算一次）+
  `Cache-Control: no-cache`（允许本地缓存，但每次带 `If-None-Match` 校验，未变返回 `304`）。
  `items-atlas.png` 可继续长缓存。
- **涉及**：`server/internal/api/handlers.go`（+ 单测：二次请求 304、内容变化后 200）、`docs/ARCHITECTURE.md` §4.1。
- **风险**：改了所有数据端点的缓存语义，需确认不影响静态资源 `/assets/*` 的 `immutable` 长缓存。
- 验收：`curl -I` 两次，第二次 304；重启换数据后立刻生效；`/assets/*` 仍是 `immutable`。

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
| `scripts/build-binary.ps1` 未在 Windows 实机验证 | 只做了语法复核（本机无 pwsh）；README 已标注 | 待定 |
| Windows 二进制未在 Windows 上运行 | 只验证了能交叉编译出 `tswui.exe`（15MB） | 待定 |
| 物资申请「在线发放」未用真实客户端验收 | 离线批准 / 补发 / 审核 / 限额 / item ban 判定已在 TShock 6.2.1 实测；在线 `GiveItemCheck` 路径需进服验收 | 待验证 |
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
| 事件流 SSE 推送 + 可选持久化 + 更多事件类型 | 统一聊天模型（`type=chat` + `source=game\|webui`）已完成；现仍为轮询 | SSE 推送（REST 降级）；有上限的追加文件保存历史；更多事件类型 + 前端过滤/高亮 | 待定（研究） |
| 网页聊天：回复/引用 + 内容区骨架 | 消息模型（`id`/`time` + 失败重试）已完成；自定义模块排序、懒加载路由、鱼店货架与角色背包骨架已完成 | 点消息引用 | 待定（P3） |
| 插件能力探测重复 | 已收敛：`GET /api/capabilities` 一次返回 `messenger/batch/player/fish/requests/webauth`，前端 App / 首页 / 设置页统一读它（`transport.capabilities()`；3 秒微缓存 + `?fresh=1`）。页面内「重新检测」仍走单点端点 | 无 | 已完成 |

> 本轮已做：自定义模块「名称 + 主指令 + 顶部说明」可配、首页「自动执行」控件统一为 `Checkbox`、插件卸载时「统一执行」开关显示一致、聊天统一 `type=chat`+`source`、发言 `id`/`time`+失败重试、`ChatPrefix` 可配、指令页底部输入框支持聊天模式。

---

## 相关文档

- `docs/设计原则与约束.md` —— 产品原则、范围与硬约束。
- `docs/记录-实现与验收.md` —— 已完成任务的验收记录（含每项的实测证据）。
- `docs/TECHNICAL_RESEARCH.md` —— TShock 事实与出处；新增数据源前先读它。
