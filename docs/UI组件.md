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
| Badge | `ui/Badge.tsx` | cva | `tone` 变体：`neutral/accent/gold/danger/success/warn/mock/purple`（语义色） |
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
| Select | `ui/Select.tsx` | radix select | 需要**分组 / 分隔线 / 选中对勾**时用（如物品图鉴主筛选）；`SelectTrigger size="sm"` 用于紧凑区；表单无 JS 场景继续用 `NativeSelect` |
| Pagination | `ui/Pagination.tsx` | Button | 复用 Button（`<button>` + `disabled`）；页码窗口见 `lib/pagination.ts` 的 `paginationRange` |
| Tabs | `ui/Tabs.tsx` | radix tabs | 真正切换视图 / 面板时用；`TabsTrigger` 自带 `cursor-pointer`（可点击）与图标尺寸兜底 |
| Switch | `ui/Switch.tsx` | radix switch | |
| Dialog | `ui/Dialog.tsx` | radix dialog | 每个 Dialog 必须有 `DialogTitle`；`DialogFooter` = 底部操作区（`bg-background` + `border-t`） |
| DropdownMenu | `ui/DropdownMenu.tsx` | radix dropdown-menu | 菜单项包在 `DropdownMenuGroup` 里；侧栏底部账号卡片（`SidebarAccountMenu`）用它 |
| Sheet | `ui/Sheet.tsx` | radix dialog | 侧边抽屉（Sidebar 移动端用） |
| Tooltip | `ui/Tooltip.tsx` | radix tooltip | 需要 `TooltipProvider` 祖先（`SlotTooltip` 自带一个） |
| Popover | `ui/Popover.tsx` | radix popover | 点击 / 受控展开的浮层（`PopoverContent` 默认 `side=bottom` / `sideOffset=6`）；登录框「登录帮助」用它 |
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
- 「界面偏好」只放字号 / 简约视图 / 语言 / 主题（自动 / 浅色 / 深色）/ 统一执行；「数据刷新」单独一张卡片：
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
- 侧边栏顺序：首页 → 指令 → 物品图鉴 → 已激活内置模块 → 自定义模块 → **设置（恒在末尾）**。
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
- `SidebarHeader` 放品牌（`W` 方块 + **WebUI**，无副标题）、语言 / 主题快捷按钮（`headerExtra`，见下）与「隐藏侧栏」按钮；`SidebarContent` 只放导航；`SidebarFooter` 放执行队列（`sidebarExtra`）+ 账号卡片，**队列恒在账号上方**；
- **「设置」是导航项且固定排在末尾**（`App.tsx` 的 `nav` 在遍历模块后 `push({ id: 'settings' })`）：新增内置 / 自定义模块都插在它前面。原页脚里的 `SettingsMenu` 已移除。
  `SidebarInset`（`<main>`）是滚动容器（图鉴等页面用 `closest('main')` 量高度）。
- 侧栏底部账号区是 `SidebarAccountMenu`（NavUser 风格，`DropdownMenu`）：头像 + 用户名 + 服务器地址（**不再显示「服务器默认」**）+ 展开箭头；
  菜单项为「切换服务器」（`ServerSwitcherDialog`）与「登录 / 退出」。头像会联动玩家管理——查到当前登录账号本人时用其全身图（`lib/selfAvatar.ts`，内存、按服务器分开）。
- **未登录时**在账号卡片**上方**多渲染一条通栏主色登录按钮（`Button variant="primary"`），点击**直接打开登录框**（不必先进菜单）；已登录时不渲染该按钮。账号卡片本身保持原样（菜单里仍可切换服务器 / 退出）。
- 测试定位：`data-testid="sidebar"`，收起状态读 `data-collapsed`（`data-state` 同义）。

## 主题 / 语言快捷切换

侧栏左上角（「隐藏侧栏」按钮旁）放两个**多状态图标按钮**（`components/QuickPreferences.tsx`，经 `AppShell` 的 `headerExtra` 传入），避免为改主题/语言专门进设置页：

- **主题**：`auto → light → dark` 循环，图标 自动=`Monitor`（电脑）/ 浅色=`Sun`（太阳）/ 深色=`Moon`（月亮）。
- **语言**：中文 ↔ English，按钮直接显示当前语言代码（`中` / `EN`）。
- 两者都有 `title` + `aria-label`（`settings.theme.toggle` / `settings.language.toggle`），值为当前状态与可读名称。
- `theme='auto'` 由 `App` 监听 `prefers-color-scheme`（`systemDark`）决定是否加 `.dark`；`light` / `dark` 忽略系统。恢复默认 `dark`。
- 设置页的「主题」`ToggleGroup` 同步支持三态（`settings.theme.auto/light/dark`）。

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
| `LoginGate` | `components/LoginGate.tsx` | 未登录时的统一占位（`login.required` = 「请先登录！」 + 登录按钮）；首页 / 指令 / 指令卡片模块 / 玩家管理 / 鱼店 / 设置共用。见「未登录的页面门控」 |
| `QuickPreferences` | `components/QuickPreferences.tsx` | 侧栏页头的语言 / 主题多状态图标按钮。见「主题 / 语言快捷切换」 |

## 未登录的页面门控

- 需要 token 才能取数的页面（首页、指令、玩家管理、鱼店、世界管理、自定义模块、设置）在未登录时**隐藏自身内容**，
  只留页头 + `LoginGate`（`components/LoginGate.tsx`），点「登录」走 App 的登录框（`onLogin` 回调）。
- 文案统一为 `login.required`（「请先登录！」/「Please sign in!」），不再按页区分。
- 侧边栏入口本身仍可见（可点，点开只看到提示），不做整块隐藏。

## 登录框（`components/LoginDialog.tsx`）

以「初次使用只看一件事」为先：默认只展示**账号密码**主路径，其余收起来。**大屏（`sm+`）为左右两栏**：
左栏是表单（`p-5`），右栏是纯装饰插画（`web/public/login-art.png`，猛爪手套物品贴图，由 `tools/gen-brand-assets.py` 生成）+ 品牌文字「WebUI / TShock伴侣」；小屏插画列隐藏，表单占满整宽。
左栏垂直排布对齐参考图：**标题居中**、**登录按钮通栏**（`size="lg" w-full`）、底部不用深色操作区。

- **当前服务器行**（单行，位于次要登录方式下面一行）：`Server` 图标 + 遮挡后的地址（`truncate`）+ 在线圆点 + 切换图标（不再显示「服务器」文字），点击打开 `ServerSwitcherDialog`（受控实例，与侧栏账号菜单同一组件）；切换后 `serverId` 变化 → 重新回填该服务器的记忆密码。
- **主路径**：玩家名 / 密码 / 记住密码 + **通栏主按钮**；不再默认展示三种方式的 `Tabs`。
- **主按钮**：`<Button variant="primary" size="lg" className="w-full">`，放在 `FieldGroup` 之后；在线授权等待中时按钮下方单独出现「取消等待」文字链接（其余模式直接点右上角 X 关闭，不再单列「取消」）。
- **次要入口**：「其他登录方式」分隔行（`Separator` + 文案）+ 两个通栏 `variant="outline"` **Alt Line 按钮**（`KeyRound` **令牌登录** / `Gamepad2` 在线授权）；切到令牌 / 在线授权后，**同一位置、同一小区域样式**改为单个通栏 outline 按钮「**密码登录**」（`UserRound`，`login.backToPassword`）返回。
- **术语统一**：登录字段一律叫「玩家名」（`login.username`），不再混用「用户名 / TShock 账号」。
- **地址格式**：`lib/servers.ts` 的 `hostPortLabel()` 统一拼接 `host:port`，IPv6 自动加方括号（`[2001:db8::1]:7878`）；`targetLabel` / `maskedTargetLabel` / 账号卡片 / 切换弹框都用它。
- **无 `DialogFooter`**：登录框不再使用带底色 / 顶部分隔线的底部操作区（去掉深色底）；「登录帮助」`Popover` 用 `mt-auto` 推到左栏**左下角**（`justify-start`，浮层 `align="start"`），次要登录方式与服务器行都在主按钮下方。
- **登录失败提示**：TShock 对「密码错 / 组缺 `tshock.rest.useapi` / 建令牌限流」返回**同一条 403**（`SecureRest.cs:117-176`），后端无法区分；密码登录失败时前端不再透出后端那句中文长句，而是渲染**逐条可核对的清单**（`login.failedTitle` / `login.failedWhy` / `login.cause.credentials|permission|rateLimit`），下方仍是可复制的赋权命令。英文界面也随之正确本地化。
- **帮助浮层**：模式相关帮助 + 注册提示收进该 `Popover`（`login.help`，图标 + 文字），**hover 或点击**展开（hover 关闭有 150ms 延迟）；默认不占版面。
  - hover 打开不抢焦点（`onOpenAutoFocus` preventDefault），关闭也不把焦点弹回触发按钮（`onCloseAutoFocus` preventDefault）——避免「点输入框→闪一下→又弹回来」的死循环；点到浮层外面（如输入框）会关闭并聚焦目标（`onFocusOutside` / `onInteractOutside`）。
- **切换服务器弹框**（标题现为「后端服务器」）：见下。

## 后端服务器弹框（`components/ServerSwitcher.tsx`）

侧栏账号卡片与登录框都会打开它。\n
- **列表行**：整行（地址 + 操作按钮）共用背景/hover；每行显示**完整 URL**（`scheme://host:port`，`lib/servers.ts` 的 `targetUrl()`），不再单列 http/https 标签；账号卡片 / 登录框等「外面」仍用 `hostPortLabel()` 的 `host:port` 简略形式。
- **连通性检测**：每行一个**图标按钮**（在垃圾桶左边；内置项没有垃圾桶，就这一个）。图标随状态：已连通 = `Wifi`（绿）、无法连接 = `WifiOff`（红）、检测中 = `LoaderCircle` 转圈。点击该行按钮重新检测（`transport.serverStatus(header)`，内置项传空串）。打开 / 列表变化时自动全量探测一次。
- **新增**：默认收起表单，列表下方一个通栏 `variant="outline"` 「添加服务器」按钮；点开才出现「协议（只读）+ 主机 + 端口 + HTTPS 勾选」一行。**新增只入库、不自动切换**（`App.addServer` 不再调 `selectServer`）。
- **修改**：每行（内置项除外）有铅笔按钮，点开预填表单，保存调 `onEdit(oldId, target)`（`lib/servers.ts` 的 `updateServerTarget()`）；改的是当前上游时会走一次切换并要求重新登录。
- **测试定位**：`getByRole('button', { name: /添加服务器/ })`、`编辑` / `删除` / `保存`。
- 登录原因（如会话过期 `app.sessionExpired`）与帮助文案里可能有 `\n`：渲染处用 `whitespace-pre-line` 保留换行（HTML 默认会把 `\n` 折叠为空格）。
- 错误 / 无权限提示仍在出错时才出现（含可复制的赋权命令）。

## 变更记录

- v1.33：物品图鉴：默认「全部物品」（去掉手气不错 / 换一批）、「分组 + 集合」合并为一个 InputGroup 下拉、tips 悬停延迟 350ms；合成表分区图标固定 531/36/5362、条件图标化（猩红 5533 / 腐化 5532 / 水 206 / 蜂蜜 1128 / 岩浆 207 / 雪 593）、`notDecraftable` 紫色「不微光」标签、制作站前加分割线、条目 hover 右上角浮动复制（含 / 不含 `[i:..]` 标签，两个勾选框移到内容下方居左）。指令：执行按钮改小飞机图标、结果卡片收藏 / 删除与折叠箭头同步 hover、已收藏为实心星（不黄色）。新增 `Badge` 的 `purple` 语义色、`SearchInput` / `CollapseChevron` / `ConfirmButton` / `BatchDeleteControls` / `SelectIndicator` / `useBatchSelect` / `useRovingFocus`。
- v1.32：卡片表头统一为 `[图标] 标题 [状态] ……………… [刷新] [∨]`：右侧操作按钮**默认隐藏、hover 表头才显、折叠时不显**；折叠箭头移到最右（展开 hover 显、折叠常显）。`CollapseChevron` 新增 `reveal` 参数。首页：最近执行限 5 条；快捷入口改 outline，文本「指令 / 物品图鉴」+ 鱼店 / 玩家管理（仅模块激活）+ 设置；管理卡片：指令换行、自动执行改 `Checkbox`、可见性改 `Switch`、去掉上下箭头。指令：左栏卡片透明无投影、输入框与执行按钮白底（outline）。自定义模块：管理卡片也改右侧 `Sheet`；页面两栏（左卡片 / 右记事本 textarea）。物品图鉴：合成表 / 用于合成 / 微光转换图标 = 531 / 36 / 5362。
- v1.31：全站折叠箭头统一为 `components/CollapseChevron.tsx`：**展开时箭头在文字右侧、默认隐藏、hover 标题才淡入（向下）；折叠时始终显示（向右）**；触发元素带 `group/title`。应用：`CollapsibleCard`（设置页全部卡片 / 账户）、`CommandCard`（首页 / 鱼店 / 模块指令卡片）、玩家管理分组标题、合成表分区、指令结果卡片、指令右栏整列。新增：设置页激活模块图标尺寸向首页卡片靠齐；HomeCardManager 改**右侧 `Sheet` 抽屉**（标题改「管理卡片」）；首页左栏改**单列 + `min-h-28 max-h-96`**；鱼店/模块指令卡片支持折叠；`ModuleCardManagerDialog` 自定义卡片可**再次编辑**；物品图鉴搜索框加清空按钮（`SearchInput`）；合成表分区图标固定（无 / 22 / 11）且「N 条未显示」可点加载更多、可分解物品在合成表补一条 5362（微光）分解记录；物品详情词缀下拉与 tips 并排（group）；指令收藏去掉小字行、物品 tab 默认展示收藏（点击追加 ID 并从收藏移除）。
- v1.30：设置页改**两栏**（`xl:grid-cols-[minmax(0,1fr)_360px]`）：左列 = 激活模块，右列 = 界面偏好 / 数据刷新 / 在线授权 / 账户（`WebAccountSection`）；**「统一执行」从「界面偏好」移到「数据刷新」卡片**。
- v1.29：指令页左列改为**单张 `Card`**（参考鱼店两栏）：整页 `xl:h-[var(--cmd-fill)]` 锁到实测可用高度；卡片内 = 头部（标题 + 清空结果）+ **可滚动结果区**（`ResultPanel` 改 `flex-1 min-h-0 overflow-y-auto`）+ `Separator` + **底部输入框**；去掉原来的 sticky 吸附输入框与 `min-h-[40vh]`。修复：量高 `useLayoutEffect` 依赖 `authenticated`——未登录时先渲染 `LoginGate`、`rootRef` 未挂载，登录后需重新量高，否则卡片高度变窄（刷新才恢复）；鱼店同款问题一并修复。
- v1.28：指令页右侧 tab 键盘交互 / 布局细节：「指令」与「收藏」搜索框 `↑↓/Enter` 进入列表、列表内 `↑↓` 移动并高亮；指令搜索忽略前导 `/`（`/setup` 可匹配）；「收藏」点击/Enter 即送入左侧输入框（物品追加 ID、指令替换内容）；去掉指令收藏行首图标；「删除」入口移到「清空」左侧，历史在其左侧新增「去重」（保留最新）；四个 tab 搜索框统一为 `SearchInput`（有内容时右边缘出现圆形 ✕）；指令编辑器输入框有内容时也在右边缘显示圆形 ✕。新增 `hooks/useRovingFocus.ts`、`components/SearchInput.tsx`。
- v1.27：指令页右侧 tab 重构：物品搜索框缩小且边距对齐（键盘上下键高亮当前行）；「指令」tab 去掉收藏星标、搜索框字体缩小；「收藏」tab 改为单行条目 + 可折叠「物品（N）/指令（N）」分区，点选 + Ctrl / ⌘ 点击送入左侧输入框，去掉执行 / 载入 / 逐行删除 / 回车图标；「历史」tab 新增搜索；收藏与历史右上角新增「删除」批量选择（默认不显示逐行删除图标），抽出 `useBatchSelect` / `BatchDeleteControls` / `SelectIndicator`。
- v1.26：登录框左栏对齐参考图：标题居中（`text-lg`）、登录按钮改**通栏 `size="lg"`**、去掉 `DialogFooter` 深色底（「登录帮助」居中置底、取消按钮只在在线授权等待时出现）；右栏文字改为「WebUI / TShock伴侣」。令牌 / 在线授权下的返回按钮参照「其他登录方式」小区域（分隔行 + 通栏 outline 按钮 `UserRound`），文案统一为「密码登录」、令牌按钮改为「令牌登录」；「登录帮助」移到左下角；修复赋权提示里长命令行按 max-content 撑出左栏、盖到右侧插画的问题（`AlertDescription` + 行容器加 `min-w-0`）；密码登录失败的 403 拆成逐条清单（新增 `login.failedTitle` / `login.failedWhy` / `login.cause.*`），文案改走 i18n（英文界面不再显示后端中文 message）。
- v1.25：站点 favicon 换成**猛爪手套**物品图标（`web/public/favicon.png`，`tools/gen-brand-assets.py` 由物品图集生成，替换原 shadcn `favicon.svg`）；登录框大屏改**左右两栏**（右侧插画列 + 品牌，小屏隐藏）；「访问令牌 · 在线授权」从文字链改为「其他登录方式」分隔行 + 两个 Alt Line 按钮。
- v1.23：指令页「收藏 / 历史」统一：行底色统一 `bg-accent/40`；删除统一 `Trash2` + `icon-sm`（历史新增独立文案 `editor.historyRemove`）；收藏空态改用 `Empty`；收藏新增「清空收藏」（物品 + 指令）与说明行；收藏搜索同时过滤物品与指令；指令收藏/历史改为**点行内文字载入编辑器**（`CornerDownLeft` 提示），收藏的 ▶ 禁用时提示原因。新增共享 `ConfirmButton`（就地二次确认，`action.clearConfirm` / `action.cancel`），用于**清空结果 / 清空历史 / 清空收藏 / 清空队列**及首页「恢复默认卡片」。
- v1.26：物品图鉴工具条改版：**一级模式 `ToggleGroup`（手气不错 / 全部物品 / 制作界面 / ⭐ 收藏）+ `分组` 二级下拉**（收藏与制作界面平级、一键可达）；`ToggleGroupItem` 加 `cursor-pointer`。
- v1.25：物品详情新增**词缀下拉预览**（伤害/暴击/速度/击退随词缀变化，数据 `data/prefix-mods.json`）；鱼店详情抽屉重排（标题「商品详情」+ 图标/名称居中在下、价格标签在上、右下角 3120 图标点缀、点外关闭）+ 鱼店页面背景点缀（水波光晕 + 淡鱼）。
- v1.24：物品图鉴详情抽屉在无合成信息时右下角加**半透明工作台插画**；鱼店商品详情由居中 `Dialog` 改为**右侧 `Sheet` 抽屉**（标题栏左图标 + 名称，字段列对齐，点外不关）。
- v1.23：物品图鉴详情从居中弹框改为**右侧抽屉**（`Sheet`）；合成表图标去掉外框格子、数量改为图标角标（不再有 `×N` 文字）。
- v1.22：物品图鉴主筛选从 `Select` 改为 **`DropdownMenu`（漏斗 +「筛选」描边按钮 + 菜单）**；左侧新增 ⭐ 收藏开关（`ItemFavoritesProvider`）；物品提示可鼠标滑入/选中文字，右上角 ⭐ 收藏；「物品分组」默认选「工具」并取消「全部」页签；每页新增 360 且跨刷新记忆；`TabsTrigger` 加 `cursor-pointer`。
- v1.21：物品图鉴筛选收敛为**单个主 `Select` + 上下文控件**（全部物品→「换一批」；物品分组→创意菜单 Tabs；集合分组→第二级集合 `Select`），新增 `ui/Select.tsx`（Radix `@radix-ui/react-select`，分隔线用 `SelectSeparator`）；翻页默认每页 100（`PAGE_SIZE`；选项仍 50 / 100 / 200 / 500）。
- v1.20：登录框底部改用 `DialogFooter`（AlertDialog 同款底色/分隔线）；「访问令牌 · 在线授权」居左；当前服务器行去掉「服务器」文字，改为图标 + 地址 + 圆点 + 切换图标。
- v1.19：连通性检测改为每行图标按钮（`Wifi`/`WifiOff`/`LoaderCircle`），放在垃圾桶左边；内置项只有检测按钮。
- v1.18：后端服务器弹框（`ServerSwitcherDialog`）重做：标题改「后端服务器」；列表显示完整 URL、加逐行连通性圆点；新增默认收起、通栏 outline「添加服务器」按钮且新增不自动切换；支持修改已保存地址；登录框内「访问令牌 / 在线授权 / 服务器、账号卡片」可点元素统一手型。
- v1.17：登录框修复帮助浮层「点输入框又弹回」的焦点死循环（不抢焦点 / 不还焦点 / outside 关闭）；当前服务器行移到次要登录方式下一行；切换服务器弹框打开时聚焦 IP 输入框。
- v1.16：登录框「登录帮助」改到底部（取消/登录所在行的左侧）并用 `Popover`（hover / 点击）；「访问令牌 · 在线授权」加醒目；服务器行下移一点；新增 `ui/Popover.tsx`（依赖 `@radix-ui/react-popover`）。
- v1.15：`ServerSwitcherDialog` 地址行整合为「协议（只读输入框）+ 主机 + 端口」一行，协议由底部「HTTPS」勾选框切换；服务器列表整行（地址 + 垃圾桶）共用背景/hover，去掉横向滚动条（`overflow-x-hidden`）。
- v1.14：统一「玩家名」术语；服务器地址统一走 `hostPortLabel`（IPv6 加方括号，切换弹框内置项也补上 scheme 标签）；登录框服务器行改为单行。
- v1.13：登录框简化（默认只看账号密码，次要方式与帮助收起）+ 顶部「当前服务器」行可直接打开切换服务器弹框。
- v1.12：侧栏账号卡片未登录时，在其上方新增一条登录按钮，点击直接打开登录框。
- v1.11：侧栏「执行队列」从导航区移到页脚、固定在账号卡片上方（`AppShell` 的 `sidebarExtra` 渲染进 `SidebarFooter`）；去掉与页脚重复的内边距。
- v1.10：「设置」从侧栏页脚移入导航并固定排在末尾（模块恒在其上）；删除 `SettingsMenu`（含单测）。
- v1.9：侧栏左上角新增语言 / 主题多状态图标按钮 `QuickPreferences`；主题新增 `auto`（跟随系统 `prefers-color-scheme`），`ThemeName = 'light' | 'dark' | 'auto'`；设置页主题 `ToggleGroup` 同步支持三态。
- v1.8：新增 `LoginGate`；首页 / 指令 / 指令卡片模块（世界管理 + 自定义）/ 玩家管理 / 鱼店 / 设置未登录时统一为「隐藏内容 + 请先登录！」。
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
