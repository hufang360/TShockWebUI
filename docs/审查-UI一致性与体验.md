# UI/UX 一致性与体验审查

> 范围：`web/src/` 全站前端 + 「服务器动态 / 网页发言 / Web UI ↔ 游戏内聊天」这条业务线。
> 目的：找出**体验不一致、偏离 shadcn 规范、可明显改进**的地方，并给出处理建议。
> 本文件是**分析记录**；待办以 `docs/TODO.md` 为准（唯一「还没做」清单），本轮已处理的列在 §5。

---

## 1. 结论速览

1. 全站基本盘已经很整齐（无 `space-y-*`、语义色令牌、`Field`/`Empty`/`Alert`/`Separator` 等组件复用率高、主题/语言/i18n 完整）。
2. 最突出的三类问题：
   - **「管理卡片」有两套交互**（首页 `HomeCardManager` vs 模块/鱼店 `ModuleCardManagerDialog`），控件与流程不一致；
   - **微型字号 `text-[10px]` / `text-[11px]` 泛滥**（合计约 91 处），与 12/14px 的主刻度脱节；
   - **空态 / 错误态 / 破坏性确认**在各处各写各的，缺少统一约定。
3. 业务上，「服务器动态 + 网页发言」方向正确，建议往**统一事件模型（聊天带来源）+ 推送替代轮询 + 少量持久化**演进。
4. 插件卸载后各能力**基本能优雅降级**（见 §3），本轮补了「统一执行」开关的显示一致性。

---

## 2. 业务建议：服务器动态 / 网页聊天 / Web UI ↔ 游戏聊天

### 2.1 服务器动态（Server Feed）

现状：`join / leave / boss / chat / webui` 五类；插件内存环形缓冲 500 条、重启清空；前端按设置间隔轮询。

建议（按价值排序）：

1. **统一事件模型，聊天带「来源」**：把 `chat` 与 `webui` 合并为 `type: chat` + `source: game|webui`，
   `webui` 保留为渲染提示（前缀色）。这样前端/第三方消费方只需处理一种聊天类型，来源可扩展（如未来「Discord 转发」）。
   - 注意：改字段属于**破坏性/半破坏性**变更 → 走协议握手（可用「新增 `source`、旧端缺省为 game」的兼容写法，先不动协议号）。
2. **推送替代轮询**：事件流本质是「服务器 → 浏览器」的单向广播，`setInterval` 轮询既有延迟又浪费。
   可用 **SSE**（`GET /api/events/stream`，Go 后端 SSE，插件仍是轮询/REST 源）拼一个「准实时」通道；
   REST 轮询保留为降级路径。对「网页发言立即上屏」体验提升明显。
3. **适度持久化**：内存环形缓冲导致「刷新即丢历史」。可选落一个**有上限的追加文件**（按大小滚动，只读最近 N 条），
   让「动态」有历史感；但要写清隐私边界（聊天内容）。
4. **更多事件类型 + 前端过滤/高亮**：死亡、入侵开始/结束、血月/日食切换、Boss 召唤、成就、玩家里程碑；
   前端按类型筛选、关键词高亮、只看某玩家。
5. **去重 / 合并**：高峰进出服会刷屏；可对同类事件做时间窗合并（如「Alice 等 3 人加入了服务器」）。

### 2.2 网页聊天（Web UI ↔ 游戏内）

现状：网页可把文本经 `/webui/chat` 广播到游戏内（带 `[WebUI]` 前缀、不伪造身份、在线禁言 403、每账号限流）。
游戏内聊天也会出现在「动态」里（`type=chat`）。

建议：

1. **消息模型补齐**：给发言返回 `id` 与 `time`，前端做「发送中 / 已发送 / 失败重试」；失败保留输入、可一键重发（不做假成功）。
2. **回复 / 引用**（可选）：网页侧点一条聊天消息 → 输入框带上 `@某人` 或引用片段，对指挥/公告场景很实用。
3. **频道 / 前缀可配**：现在前缀硬编码 `[WebUI]`。可加插件配置 `ChatPrefix`，甚至可选「发送到某个频道/世界组」。
4. **网页侧禁言（管理能力，需确认）**：插件可加「管理员在网页禁言某账号的网页发言」。
   属于管理能力扩展，**超出当前已确认范围，需先问用户**，不建议本轮做。
5. **可发现性**：目前入口藏在「指令 → 动态」底部。可考虑在首页「服务器动态」卡片也放一个「发一句」入口（复用同一输入组件）。
6. **与游戏内身份的一致性**：网页用角色名（在线时）或账号名；建议在 UI 明确标注实际显示名（`feed.chatSent` 已带），避免玩家疑惑。

### 2.3 Web UI 整体

1. **导航可配置**：自定义模块多了以后，侧边栏顺序/分组建议可拖拽排序（现在只能删了重建）。
2. **「管理卡片」统一**：见 §4 U1。
3. **微型字号规范**：见 §4 U2。
4. **加载骨架**：大块内容（图鉴、玩家背包）目前是 Spinner 占位；可上 Skeleton 提升感知性能（P3）。

---

## 3. 插件卸载后的降级矩阵（已核实）

卸载/未安装 WebUI 信使插件后各能力的实际行为（本轮核查 `web/src` + `server/internal/api`）：

| 能力 | 依赖 | 卸载后的行为 | 判定方式 |
| --- | --- | --- | --- |
| 服务器动态卡片 / 「动态」tab | `/webui/events` | **隐藏 / 提示未安装**；`useServerFeed` 30s 慢速重试，装回自动恢复 | `plugin_missing` → `available=false` |
| 网页发言输入框 | `/webui/chat` | **禁用**；发送报「未安装/版本过旧」 | `available` / `plugin_outdated` |
| 统一执行（批量执行） | `/webui/batch` | **自动回退为逐条执行**（消费者都判 `batchPlugin===true`）；设置开关显示为关、禁用 | `batchCapabilities.plugin=false` |
| Tier B（`allowServer=false`） | `/webui/batch?mode=player` | 关闭（`ingame=false`） | `batchCapabilities.ingame=false` |
| 在线授权登录 | `/webui/auth/*` | 登录框「在线授权」入口**禁用** | `webauthCapabilities.plugin=false` |
| 在线授权 / 账户会话 | `/webui/auth/sessions` | 卡片显示「未安装」+ 可重检 | `plugin_missing` |
| 「信使插件诊断」 | `/webui/meta` | 显示 `not_installed` / `legacy`，提示升级 | `PluginStatus.reason` |
| **自定义模块（含卡片）** | 无（走 rawcmd） | **不受影响，继续可用** | — |
| 玩家管理 / 鱼店 / 世界管理 | 各自插件 | 与 WebUI 插件无关 | 各自 `capabilities` |

结论：**插件卸载后，依赖它的能力会降级/停用，且不报错崩溃；自定义模块与其它第三方模块不受影响。**
本轮额外修复：设置里「统一执行」开关在插件缺失时不再显示为「已开但不可点」的割裂态（改为显示关闭，保留用户原偏好，装回后恢复）。

---

## 4. UI 一致性问题清单

> 严重度：P1 = 明显影响体验 / 易误解；P2 = 明显不一致；P3 = 打磨项。

| ID | 严重度 | 问题 | 证据（文件） | 建议 |
| --- | --- | --- | --- | --- |
| U1 | P1 | **「管理卡片」两套交互**：自动执行控件 `Checkbox` vs `Switch`；添加流程「追加空行」vs「底部表单」；首页可拖拽排序/可隐藏，模块不可；底部「恢复默认 / 完成 / 说明」仅首页有 | `components/HomeCardManager.tsx` vs `components/ModuleCardManagerDialog.tsx` | 抽共享 `CardManagerSheet`：统一「添加=底部表单、自动执行=Switch、删除、说明」，排序/可见性作为可选能力注入 |
| U2 | P2 | **微型字号滥用**：`text-[10px]` 44 处 + `text-[11px]` 47 处，与 `text-xs`(12) / `text-sm`(14) 刻度脱节；同一个「小字」在不同文件用不同尺寸 | 全站 `*.tsx` | 在 `index.css` 定义并统一到 2 个刻度（如 `text-2xs`=11px 用于辅助、`text-xs`=12px 用于正文）；替换全部任意值 |
| U3 | P2 | **空态不统一**：已有 `Empty`（33 处），但仍有多处裸 `<p>` | `HomePage`(recentEmpty)、`ServerFeed`(eventsEmpty)、`ModuleCardsPanel`(cards.empty)、`WebAccountSection`(sessionsEmpty)、`ItemSearchPanel`(noMatch) | 统一用 `Empty`（或定义紧凑变体 `Empty size="sm"`），空态文案集中管理 |
| U4 | P2 | **破坏性删除确认不一致**：清空类用 `ConfirmButton`，但模块卡片、自定义模块、服务器删除是**单击即删** | `ModuleCardManagerDialog`(129)、`SettingsPage`(358)、`ServerSwitcher`(253) | 统一策略：能撤销的用「删除 + 撤销 toast」；不能撤销的（服务器、模块）用 `ConfirmButton` 或二次确认 |
| U5 | P3 | **手写彩色提示 div 绕过 `Alert`** | `PlayerManagerPage.tsx:529`（`bg-destructive/15`）、`FishShopPage.tsx:611`（`bg-success/15`） | 改 `Alert variant="destructive|success"`，与全站一致 |
| U6 | P2 | **巨型组件**：`PlayerManagerPage` 1057 / `ItemsPage` 868 / `HomePage` 839 / `App` 827 / `FishShopPage` 779 / `CommandPage` 681 / `SettingsPage` 605 行 | 见文件 | 按「数据/视图/子面板」拆分；优先 `HomePage` / `SettingsPage` / `App` |
| U7 | P2 | **原生 HTML5 拖拽排序**（首页卡片管理）：无键盘可达、移动端不友好、无 aria | `HomeCardManager.tsx` | 引入轻量 DnD（dnd-kit）或至少提供键盘「上移/下移」 |
| U8 | P3 | **按钮变体语义漂移**：同为「刷新/整理」，有的 `secondary`、有的 `outline`、有的 `ghost`；「统一执行」开关位置也换过 | `ModuleCardsPanel` / `HomePage` / `SettingsPage` | 定一份「按钮语义表」：主操作 primary、次操作 secondary、工具图标 ghost、危险 danger |
| U9 | P3 | **探测重复**：`batchCapabilities` 在 App / HomePage / ModuleCardsPanel / FishCommandCards / SettingsPage 各自探测 | 多文件 | 收敛为「一处探测 + 上下文共享」（可并入未来的 `/api/plugin/status` 统一能力矩阵） |

> 说明：§1 提到的查询还发现 3 处 `absolute`（`ItemIcon` 堆叠角标、鱼店背景点缀、图鉴虚拟行）——都是合理用法，不算问题。

---

## 5. 本轮已处理

| 项 | 说明 |
| --- | --- |
| 自定义模块可配「名称 + 主指令 + 顶部说明文字」 | `CustomModule` 新增 `desc`；设置列表里三项都可编辑；改主指令同步「帮助」卡片；模块页 `desc` = 用户填写（留空回退默认提示） |
| 插件卸载后「统一执行」开关显示一致 | 插件缺失时开关显示为关（保留用户偏好，装回后恢复），不再是「已开但灰」 |
| 「管理卡片」自动执行控件统一 | 首页由 `Checkbox` 改为 `Switch`，与模块/鱼店一致（U1 的第一项） |
| 统一聊天事件模型（§2.1.1） | 聊天统一为 `type=chat` + `source=game\|webui`（旧 `type=webui` 仍兼容）；插件、后端、前端、卡片配色一起改 |
| 网页聊天消息模型（§2.2.1） | `/webui/chat` 返回 `id`/`time`/`source`；前端失败保留输入、可就地「重试」，不造假成功 |
| 前缀可配（§2.2.3） | 插件配置 `ChatPrefix`（默认 `[WebUI]`），不再硬编码 |
| 发言入口可发现性（§2.2.5） | 抽出共享 `components/WebChatInput.tsx`；当时首页「服务器动态」卡片底部也放了入口。**后续改动**：首页卡片太小，已移除首页入口，回复玩家统一在「指令 → 动态」 |
| 手写彩色提示改 `Alert`（U5） | `PlayerManagerPage` 错误提示、`FishShopPage` 购买成功提示去掉手写 `bg-destructive/15`、`bg-success/15` div，改用 `Alert variant="destructive|success"` |
| i18n 键一致性单测 | 新增 `web/src/lib/i18n.test.ts`：zh/en 键集合相等 + 同键占位符一致 |
| 抽共享 `CardManagerSheet`（U1） | 新增 `components/CardManagerSheet.tsx`；首页 `HomeCardManager` 与模块/鱼店 `ModuleCardManagerDialog` 都改为复用：添加=底部表单、自动执行=`Switch`、删除=`ConfirmButton`、说明；排序/可见性/恢复默认按需注入 |
| 微型字号刻度统一（U2） | `index.css` 新增 `--text-2xs`（11px）；全站 `text-[10px]`/`text-[11px]`（共 99 处）→ `text-2xs` |
| 空态统一（U3） | `Empty` 新增 `size="sm"`；`recentEmpty` / `eventsEmpty` / `cards.empty` / `sessionsEmpty` / `noMatch` 裸 `<p>` 改用 `Empty`+`EmptyDescription` |
| 破坏性删除确认一致（U4） | 模块卡片 / 自定义模块 / 服务器 / 首页自定义卡片改 `ConfirmButton` 二次确认（新增 `action.deleteConfirm`） |
| 首页卡片拖拽无障碍（U7） | `CardManagerSheet` 在拖拽手柄外新增「上移 / 下移」按钮（首尾禁用），键盘 / 触屏可用 |
| 巨型组件拆分（U6） | 新增 `components/player/PlayerLookView.tsx`、`codex/CodexViews.tsx`、`fishshop/GoodCells.tsx`、`command/HistoryPanel.tsx`、`items/DexCell.tsx`、`items/DexPagination.tsx`、`items/PrefixPicker.tsx`、`home/commandCards.tsx`、`home/HomeOverviewCards.tsx`、`settings/CustomModulesSection.tsx`、`settings/PreferencesCards.tsx`、`AppRoutes.tsx`、共享 `Notice.tsx`；PlayerManagerPage 1057→597、CodexPage 819→476、FishShopPage 781→663、CommandPage 712→574、ItemsPage 989→820、HomePage 872→640、SettingsPage 611→382、App 865→753 |

## 6. 待分解（roadmap → 详见 `docs/TODO.md`）

- U1/U2/U3/U4/U5/U6/U7：**均已完成**（见 §5）。
- P4-5 事件流：**SSE 推送**（统一模型已完成）、可选持久化、更多事件类型 + 前端过滤/高亮（§2.1）。
- P4-6 网页聊天：回复/引用、导航可排序、加载骨架（消息模型已完成）（§2.2/§2.3）。
