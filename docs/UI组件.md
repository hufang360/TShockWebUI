# 前端 UI 组件（shadcn/ui）

对应目录：`web/src/components/ui/`
设计规范：`.agents/skills/shadcn/`（项目级 skill，含 Critical Rules：styling / forms / composition / icons / base-vs-radix）
项目配置：`web/components.json`（style `new-york`、base `radix`、Tailwind v4、lucide 图标、别名 `@/`）

> 约定：**能用 `components/ui/` 里的组件就不要手写**；颜色一律走语义令牌（`bg-primary`、`text-muted-foreground`…），
> 不写硬编码 Tailwind 调色板色；间距用 `flex flex-col gap-*`（不用 `space-y-*`）；等宽高用 `size-*`；
> 图标进 Button 用 `data-icon="inline-start|inline-end"`（尺寸由 Button 统一，不再手写 `size-*`）。

## 组件清单

| 组件 | 文件 | 依赖 | 备注 |
| --- | --- | --- | --- |
| Button | `ui/Button.tsx` | radix slot + cva | 变体 `primary/secondary/outline/ghost/danger`；尺寸 `sm/md/lg/icon/icon-sm`；无 `isPending`，loading 用 `Spinner`；基础类含 `cursor-pointer`（Tailwind v4 的 button 默认是 `cursor: default`，这里改回手型） |
| Card | `ui/Card.tsx` | — | `Card/Header/Title/Body`（项目自有命名，非 shadcn 的 Content/Footer）；`CardTitle` 自动兜底图标尺寸；**默认不加边框**，靠「极浅灰画布 + 白色卡片」的对比区分 |
| Badge | `ui/Badge.tsx` | cva | `tone` 变体，success/warn/mock 走语义色 |
| Input / Kbd | `ui/Input.tsx` | — | |
| InputGroup | `ui/InputGroup.tsx` | — | 输入框内的图标 / 按钮（`InputGroupInput` + `InputGroupAddon`），替代绝对定位按钮 |
| Label | `ui/Label.tsx` | radix label | 一般通过 `FieldLabel` 使用 |
| Field | `ui/Field.tsx` | — | `FieldGroup/Field/FieldLabel/FieldDescription/FieldTitle/FieldSet/FieldLegend`；表单一律用它 |
| Checkbox | `ui/Checkbox.tsx` | radix checkbox | 布尔勾选（表单/开关项） |
| Slider | `ui/Slider.tsx` | radix slider | 数值范围（如设置页字号） |
| ToggleGroup | `ui/ToggleGroup.tsx` | radix toggle-group | 2–5 选的选项集（主题 / 语言 / scheme） |
| Spinner | `ui/Spinner.tsx` | lucide | 加载指示；Button 内配 `data-icon`，独立展示配 `aria-label` |
| Empty | `ui/Empty.tsx` | — | 空状态（`EmptyHeader/Media/Title/Description/Content`），不要手写空态 |
| Alert | `ui/Alert.tsx` | cva | Callout / banner / 错误提示；变体 `default/muted/destructive/warning/success/info` |
| Native Select | `ui/NativeSelect.tsx` | lucide | 无 JS 的原生 `<select>`；`size="sm"` 用于紧凑区 |
| Pagination | `ui/Pagination.tsx` | Button | 复用 Button（`<button>` + `disabled`）；页码窗口见 `lib/pagination.ts` 的 `paginationRange` |
| Tabs | `ui/Tabs.tsx` | radix tabs | 真正切换视图 / 面板时用；`TabsTrigger` 自动兜底图标尺寸 |
| Switch | `ui/Switch.tsx` | radix switch | |
| Dialog | `ui/Dialog.tsx` | radix dialog | 每个 Dialog 必须有 `DialogTitle`；`DialogFooter` = 底部操作区（`bg-background` + `border-t`） |
| DropdownMenu | `ui/DropdownMenu.tsx` | radix dropdown-menu | 菜单项包在 `DropdownMenuGroup` 里；侧栏底部账号卡片（`SidebarAccountMenu`）用它 |
| Sheet | `ui/Sheet.tsx` | radix dialog | 侧边抽屉（Sidebar 移动端用） |
| Tooltip | `ui/Tooltip.tsx` | radix tooltip | 需要 `TooltipProvider` 祖先（`SlotTooltip` 自带一个） |
| Separator | `ui/Separator.tsx` | radix separator | 分隔线一律用它，不要 `border-t/b` div 或 `<hr>` |
| Collapsible | `ui/Collapsible.tsx` | radix collapsible | 可折叠区块（玩家管理的银行 / 配装分区）；`CollapsibleTrigger` 包在自定义标题按钮上 |
| Sidebar | `ui/Sidebar.tsx` | Sheet + Tooltip + Button + Separator + `hooks/use-mobile` | 见下 |

`components/ui/index.ts` 统一再导出；业务代码从 `@/components/ui` 引入。

## 使用约定（Critical Rules 速查）

- **状态色走语义令牌**：`success` / `warning` / `info`（定义在 `src/index.css`，明暗两套）。
  不要再拿 `chart-1..5` 冒充成功 / 警告 / 金色——chart 系列明暗含义不一致（如 chart-4 亮色是黄、暗色是紫）。
- **加载态用 `Spinner`**：`<Button disabled><Spinner aria-hidden data-icon="inline-start" />保存中…</Button>`；
  独立展示时给 `aria-label`；不要再手写 `Loader2 animate-spin` / `animate-pulse` 圆点。
- **表单一律 `FieldGroup` + `Field`**（`FieldLabel` / `FieldDescription`），不要裸 `div` + `label` + `gap-*`；
  禁用态 `Field data-disabled` + 控件 `disabled`。
- **选项集（2–7）用 `ToggleGroup`**；真正的面板切换才用 `Tabs`。
- **输入框内图标 / 按钮用 `InputGroup` + `InputGroupAddon`**，不要 `relative` + 绝对定位。
- **空状态用 `Empty`**；**提示 / Callout / banner 用 `Alert`**（不要手写彩色 div）。
- **分隔线用 `Separator`**。
- **弹框底部操作区用 `DialogFooter`**：底色 `bg-background` + `border-t`；用负外边距抵消 `DialogContent` 的 `p-5` 做成通栏；物品详情 / 商品详情 的操作按钮都放在这里。
  （亮色下 `--background` 已改为与卡片同为白，靠顶部 `border-t` 区分；暗色下仍比卡片深。）
- **图标进组件用 `data-icon`**（`Button` / `TabsTrigger` / `ToggleGroupItem` / `CardTitle` 已统一兜底尺寸）。

## 卡片的「主 / 次」层次

- 亮色下 `--background` 用极浅蓝灰（`oklch(0.955 0.006 247.9)`）、`--card` 纯白 → **不用边框**就能区分卡片与画布；
  `Card` 只保留 `shadow-sm`。
- **首页为左右两栏**（`xl:grid-cols-[minmax(0,1fr)_360px]`）：
  - 右栏（概览）：服务器状态 / 服务器动态 / 快捷入口 / 最近执行（固定高度 `xl:h-56`、内部滚动）。
  - 左栏（指令）：其余指令卡片 + 自定义卡片，`sm:grid-cols-2` 两列铺开。
  - 两栏各自保持 `tswui:homeCards` 里的相对顺序（`RIGHT_COLUMN_IDS` 分栏）。
- 需要边框的特殊卡片（如鱼店头部卡片）由调用方单独加 `border`。

## 设置页（v1.4）

- 每张卡片用 `components/CollapsibleCard.tsx`（Card + Collapsible）：头部标题可点击折叠，头部右侧控件（重新检测 / 刷新）不参与折叠。
- 「激活模块」卡片内是 `Tabs`：**已适配**（玩家管理 / 鱼店 / 世界管理）/ **自定义**（自定义模块列表 + 创建）。
- 「界面偏好」只放字号 / 简约视图 / 语言 / 主题 / 统一执行；「数据刷新」单独一张卡片：
  执行队列间隔 + 服务器动态刷新间隔 + 页面数据刷新间隔。

## 页面数据刷新间隔（设置）

- 「设置 → 页面数据刷新间隔」存于 `settings.refreshInterval`（毫秒，`0` = 不自动刷新），控制：首页自动刷新全部、
  鱼店货架、鱼店右侧指令卡片刷新全部。
- 另有「设置 → 服务器动态刷新间隔」（`settings.eventsRefreshInterval`，1/3/5/15 分钟）：控制服务器动态轮询；
  **1 分钟仅 `GM` / `superadmin` / `vip` 组可选**（设置页拉 `/api/me` 得到组名）。
- 门控在 `lib/refreshGate.ts`：按 `服务器:模块`（`home` / `shelf` / `fish` / `panel:*`）分别记「上次刷新全部」时间；
  单个卡片的刷新不计入。`intervalMs = 0` 时只首次加载一次，之后不再自动刷新。
- 「页面数据刷新间隔」触发时，首页会把服务器动态一起刷新（`useServerFeed` 的 `refreshToken`）。

## 指令卡片刷新提示 / 自动执行

- `CommandCard` 右上角按钮语义可切：`action="refresh"`（默认，刷新图标）或 `action="run"`（手动执行，播放图标 + aria-label「执行」）；
  都用 `Tooltip` 显示上次执行时间（`执行于 …` / 尚未执行），卡片底部不再单独显示时间。
- **自动执行偏好**（`tswui:autoExec`，`lib/autoExec.ts`，key 如 `home:<id>` / `world:fixed:/relive`）：
  关闭后该卡片不随自动刷新 /「刷新全部」执行，只能点自己的按钮。首页「管理卡片」和模块「管理卡片」都有开关；
  首页默认开，世界管理的 `/relive`、`/cleartomb` 默认关（`ModuleCardDef.manual`）。
- `status === 'no_permission'` 时卡片**保留**，下方显示本地化「没有执行该指令的权限」，并隐藏后端重复的中文 message
  （与「未安装插件 → `command_error`」区分，见 `docs/插件-世界管理.md`）。

## 模块与指令卡片

- 内置模块（`MODULE_DEFS`）：玩家管理、鱼店、世界管理；自定义模块（`lib/customModules.ts`，id `m:`）由用户
  「填名称 + 指令前缀」创建，并自动生成一张「帮助」卡片（`/xx help`）；创建后可在列表中**直接改名**，激活后进侧边栏。
- 模块内的「用户添加的指令卡片」统一存 `tswui:moduleCards`（`lib/moduleCards.ts`，`byServer[serverId][moduleId]`）。
- 通用页 `pages/CommandModulePage.tsx` + `components/ModuleCardsPanel.tsx`：世界管理与自定义模块共用，
  支持逐张刷新 / 刷新全部 / 添加删除卡片 / 批量执行。鱼店右侧卡片（`FishCommandCards`）也用同一份 `moduleCards`
  追加自定义卡片。

## Sidebar

`AppShell.tsx` 用 shadcn `Sidebar` 重写，替换了早期的自研侧栏：

- `SidebarProvider` 受控于 App 的 `sidebarCollapsed`（Provider 内部切换，如 `Cmd/Ctrl+B`、rail 拖动，会经 `onOpenChange` 同步回 App）。
- `collapsible="offcanvas"`（**整体收起 / 展开**，与「隐藏侧栏 / 显示侧栏」文案一致）：
  收起时侧栏滑出屏幕、内容区占满，主区顶部出现「显示侧栏」按钮；不使用 `icon` 模式，因为侧栏底部是全宽的服务器/登录/设置控件，缩成 48px 会被截断。
- 移动端由 `Sidebar` 内部自动改用 `Sheet` 抽屉（不再自绘遮罩），`SidebarNav` 点选后调用 `useSidebar().setOpenMobile(false)` 收起。
- 导航项一律**单行**（图标 + 名称，`SidebarMenuButton` 默认 `h-8 text-sm`）；副标题不再放进按钮（两行会撑破 32px 高度）。
- `SidebarHeader` 放品牌（`W` 方块 + **WebUI**，无副标题）与「隐藏侧栏」按钮；`SidebarFooter` 放账号卡片 / 设置；`SidebarContent` 放导航与执行队列；
  `SidebarInset`（`<main>`）是滚动容器（图鉴等页面用 `closest('main')` 量高度）。
- 侧栏底部账号区是 `SidebarAccountMenu`（NavUser 风格，`DropdownMenu`）：头像 + 用户名 + 服务器地址（**不再显示「服务器默认」**）+ 展开箭头；
  菜单项为「切换服务器」（`ServerSwitcherDialog`）与「登录 / 退出」。头像会联动玩家管理——查到当前登录账号本人时用其全身图（`lib/selfAvatar.ts`，内存、按服务器分开）。
- 测试定位：`data-testid="sidebar"`，收起状态读 `data-collapsed`（`data-state` 同义）。

## Tooltip 的两套并存

- **物品提示 `ItemTooltip`**（自研，`components/ItemTooltip.tsx` + `ItemTooltipContent.tsx`）：
  游戏同款样式（半透明黑、无模糊、名称按稀有度着色、属性行、左下角 `ID · key`），固定定位 + portal，**全项目统一**。
- **文本提示 `SlotTooltip`**（`components/SlotTooltip.tsx`）：shadcn/Radix `Tooltip`，目前只用于玩家管理的**空格子** `#N` 提示。
  有物品的格子仍用 `ItemIcon` 自带的 `ItemTooltip`。

## 业务组件（非 ui/）

| 组件 | 文件 | 说明 |
| --- | --- | --- |
| `ItemIcon` | `components/ItemIcon.tsx` | 按物品图集裁切图标（`game`/`fit` 模式、堆叠数量、富提示） |
| `ItemTooltip` | `components/ItemTooltip.tsx` | 游戏同款物品提示（固定定位 + portal） |
| `PlayerAvatar` | `components/PlayerAvatar.tsx` | 玩家角色全身图：canvas 按 `lib/playerRender.ts` 的层级合成，贴图懒加载 `data/player-atlas.*`（见 [`计划-玩家全身图.md`](计划-玩家全身图.md)） |

## 变更记录

- v1.7：玩家管理新增角色全身图 `PlayerAvatar`（纯 canvas，不进 shadcn 组件清单）。
- v1.2：图鉴翻页器改 shadcn `Pagination` + `NativeSelect`；`Button` 补 `data-icon` 尺寸兜底与 `icon/icon-sm`。
- v1.3：`AppShell` 改 shadcn `Sidebar`（offcanvas）；空格子提示改 shadcn `Tooltip`；登录框改 `Dialog`；全项目 `space-y-*` → `flex flex-col gap-*`；
  设置页原生 `<select>` 改 `NativeSelect`；新增 `Separator` / `Sheet`。
- v1.4：补齐缺失的 shadcn 组件（`Spinner` / `Empty` / `Alert` / `Field` / `InputGroup` / `Label` / `Checkbox` / `Slider` / `ToggleGroup`）；
  新增语义状态色 `success` / `warning` / `info` 并替换 `chart-*` 冒充；列表行 / 折叠 / 拖拽等裸 `<button>` 改 `Button`；
  分隔线改 `Separator`；登录 / 设置 / 服务器表单改 `Field`；加载态统一 `Spinner`；选项集改 `ToggleGroup`；
  空态统一 `Empty`；提示统一 `Alert`。
- v1.5：指令页（`CommandPage`，原 `EditorPage`）重构：右侧拆为 物品 / 指令 / 收藏 / 历史 四个 tab；
  结果卡片与历史“指令在最左、异常标红、收藏仅限成功结果”；底部输入框去掉多余标题行，补全下拉改为向上展开并把键盘提示收进下拉；
  物品面板精简（去标题 / 去小字，回车插入 ID）；玩家管理页 `PlayerManagerPage`（原 `PlayersPage`）重命名。
- v1.6：抽出共享 `CommandCard`（首页 + 鱼店右侧指令卡片复用）；鱼店右侧新增指令卡片列（`FishCommandCards`）；
  「统一执行」开关从首页搬到设置（`Switch`，`tswui:homeBatch`）；物品图鉴 toolbar/翻页器/详情弹框改版（见 `docs/页面-物品图鉴.md`）；
  新增 `DialogFooter`（底部操作区，底色比卡片深），物品详情 / 商品详情 的操作按钮移入底部。
