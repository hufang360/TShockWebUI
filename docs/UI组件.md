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
| Button | `ui/Button.tsx` | radix slot + cva | 变体 `primary/secondary/outline/ghost/danger`；尺寸 `sm/md/lg/icon/icon-sm`；移动端触控尺寸更大（`sm` 36px、`icon-sm` 40px），`md` 断点恢复桌面紧凑尺寸；无 `isPending`，loading 用 `Spinner`；基础类含 `cursor-pointer`（Tailwind v4 的 button 默认是 `cursor: default`，这里改回手型） |
| Card | `ui/Card.tsx` | — | `Card/Header/Title/Body`（项目自有命名，非 shadcn 的 Content/Footer）；`CardTitle` 自动兜底图标尺寸；`rounded-xl + border + bg-card`，不使用投影 |
| Badge | `ui/Badge.tsx` | cva | `tone` 变体：`neutral/accent/gold/danger/success/warn/mock/purple`（语义色） |
| Input / Kbd | `ui/Input.tsx` | — | |
| SearchInput | `components/SearchInput.tsx` | InputGroup + Button | 搜索与最近搜索；支持右侧搜索图标、胶囊外观、逐条删除历史。 |
| Textarea | `ui/Textarea.tsx` | — | 多行文本（物资申请的用途 / 拒绝原因） |
| InputGroup | `ui/InputGroup.tsx` | — | 输入框内的图标 / 按钮（`InputGroupInput` + `InputGroupAddon`），替代绝对定位按钮 |
| Label | `ui/Label.tsx` | radix label | 一般通过 `FieldLabel` 使用 |
| Field | `ui/Field.tsx` | — | `FieldGroup/Field/FieldLabel/FieldDescription/FieldTitle/FieldSet/FieldLegend`；表单一律用它 |
| Checkbox | `ui/Checkbox.tsx` | radix checkbox | 布尔勾选（表单/开关项） |
| Slider | `ui/Slider.tsx` | radix slider | 数值范围（如设置页字号） |
| ToggleGroup | `ui/ToggleGroup.tsx` | radix toggle-group | 2–5 选的选项集（主题 / 语言 / scheme） |
| Spinner | `ui/Spinner.tsx` | lucide | 加载指示；Button 内配 `data-icon`，独立展示配 `aria-label` |
| Empty | `ui/Empty.tsx` | — | 空状态（`EmptyHeader/Media/Title/Description/Content`），不要手写空态 |
| Skeleton | `ui/Skeleton.tsx` | — | 加载占位；路由懒加载与后续内容区骨架统一使用，不手写 `animate-pulse` 色块 |
| Alert | `ui/Alert.tsx` | cva | Callout / banner / 错误提示；变体 `default/muted/destructive/warning/success/info` |
| Native Select | `ui/NativeSelect.tsx` | lucide | 无 JS 的原生 `<select>`；`size="sm"` 用于紧凑区 |
| Select | `ui/Select.tsx` | radix select | 需要**分组 / 分隔线 / 选中对勾**时用（如物品图鉴主筛选）；`SelectTrigger size="sm"` 用于紧凑区；表单无 JS 场景继续用 `NativeSelect` |
| Pagination | `ui/Pagination.tsx` | Button | 复用 Button（`<button>` + `disabled`）；页码窗口见 `lib/pagination.ts` 的 `paginationRange` |
| Tabs | `ui/Tabs.tsx` | radix tabs | 真正切换视图 / 面板时用；`TabsTrigger` 自带 `cursor-pointer`（可点击）与图标尺寸兜底 |
| Switch | `ui/Switch.tsx` | radix switch | |
| Dialog | `ui/Dialog.tsx` | radix dialog | 每个 Dialog 必须有 `DialogTitle`；`DialogFooter` = 底部操作区（`bg-background` + `border-t`） |
| DropdownMenu | `ui/DropdownMenu.tsx` | radix dropdown-menu | 菜单项包在 `DropdownMenuGroup` 里；侧栏底部账号卡片（`SidebarAccountMenu`）用它 |
| Sheet | `ui/Sheet.tsx` | radix dialog | 侧边抽屉（Sidebar 移动端用 / 鱼店商品详情 / 数据ID 详情）；**不支持堆叠**，需要叠层就用 `Drawer` |
| Drawer | `ui/Drawer.tsx` | **Base UI** `@base-ui/react/drawer` | **可堆叠**抽屉（物品详情用；物品分组也复用为固定右侧抽屉）：详情桌面从右侧滑入、移动端从底部滑入（带拖拽手柄、可滑走关闭）；在内容里再渲染 `<Drawer>` 就叠一层，父层缩小变暗留在后面。`DrawerContent` 的宽度用 `[--drawer-content-width:…]` / 竖向高度用 `h-*`、`max-h-*`。**每个 Drawer 必须有 `DrawerTitle`** |
| Tooltip | `ui/Tooltip.tsx` | radix tooltip | 需要 `TooltipProvider` 祖先（`SlotTooltip` 自带一个） |
| Popover | `ui/Popover.tsx` | radix popover | 点击 / 受控展开的浮层（`PopoverContent` 默认 `side=bottom` / `sideOffset=6`）；登录框「登录帮助」、物品 ID / 数据 ID「页面设置」用它 |
| Separator | `ui/Separator.tsx` | radix separator | 分隔线一律用它，不要 `border-t/b` div 或 `<hr>` |
| Breadcrumb | `ui/Breadcrumb.tsx` | radix slot + lucide | 内容区顶栏只显示**当前页面**（不再带分组前缀）的 `Breadcrumb/BreadcrumbList/BreadcrumbItem/BreadcrumbPage`；纯展示，带 `aria-current="page"` |
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
- **页面级 `Tabs`（数据 ID 的 NPC / 图格 / 墙 / Buff）独占一整行**：
  数据 ID 的主 Tabs 不包在 Card 内；玩家管理不重复渲染页面标题，简约视图只在有角色数据时进入正文工具行。
  工具面板内的 物品 / 指令 / 收藏 / 历史 / 动态 使用标准胶囊 Tabs，单行横向滚动。
  「指令」列表里 `allowServer=false`（只能游戏内执行）的指令**排到最后**，收进可折叠的「游戏内指令」分组（默认收起，
  搜索时自动展开），列表行仍带「游戏内」徽标。
- **输入框内图标 / 按钮用 `InputGroup` + `InputGroupAddon`**，不要 `relative` + 绝对定位。
- **空状态用 `Empty`**；**提示 / Callout / banner 用 `Alert`**（不要手写彩色 div）。
- **加载占位用 `Skeleton`**；懒加载路由、鱼店货架和角色背包首次加载统一使用。
- **分隔线用 `Separator`**。
- **弹框底部操作区用 `DialogFooter`**：底色 `bg-background` + `border-t`；用负外边距抵消 `DialogContent` 的 `p-5` 做成通栏；物品详情 / 商品详情 的操作按钮都放在这里。
  （亮色下 `--background` 已改为与卡片同为白，靠顶部 `border-t` 区分；暗色下仍比卡片深。）
- **图标进组件用 `data-icon`**（`Button` / `TabsTrigger` / `ToggleGroupItem` / `CardTitle` 已统一兜底尺寸）。
- **详情优先用右侧抽屉**（鱼店商品详情、数据ID的 NPC / 图格 / 墙 / Buff 详情用 `Sheet`；物品详情用可堆叠的 `Drawer`）：
  标题栏固定、中间内容滚动、右上角 × 关闭；居中 `Dialog` 只用于需要「必须做选择」的小弹框。
- **抽屉里可以再开抽屉时用 `Drawer`（Base UI）**：像物品详情那样「点配方材料 → 看材料详情 → 返回」的钻取，
  `Sheet`（radix dialog）做不到——它只会并排弹出、不会把父层缩小留在后面。叠层写法：把子 `<Drawer>`
  **渲染在父 `DrawerContent` 里**（Base UI 靠 React 树判定嵌套），`open` 受控、关掉就出栈。
  root 的 `onOpenChange(false)` 只表示「这一层要关」，收起动画结束后再出栈（父层的 `--nested-drawers` 才会减）。
- **带「最近搜索」的搜索框用 `SearchInput`**：历史下拉**默认聚焦时不弹、打字时弹**，另有输入框内的
  历史按钮可手动展开（`historyOnFocus` / `historyToggle`，见 `docs/功能-搜索记录.md`）。
- **勾选项（Checkbox + 文字）用 `Field orientation="horizontal"` + `FieldLabel htmlFor`**：
  `Field` 加 `w-auto` 才不会被 `w-full` 撑满整行，工具栏里可横向排列；`FieldLabel` 默认带 `text-foreground`，
  放进 `text-muted-foreground` 容器时需显式覆盖颜色。**不要**裸 `<label>` 包 `Checkbox` 再重复写 `aria-label`。
- **页面级分类导航用 `Tabs variant="line"`**：放在页面标题下方的第一行，主分类靠左；右侧可放同类工具（如页面设置 / 全屏按钮）；NPC 子分类使用胶囊 Tabs，视图类 Checkbox 收进页面设置 Popover。移动端保持单行横向滚动，不为控件另起多行。
- **卡片管理里的“自动执行”用 `Checkbox`**，与“显示/隐藏”的 `Switch` 语义分开；新增卡片和编辑自定义卡片都按需展开，不常驻表单。

## 已核实的例外（不要当违规重复报）

全站基本盘已按 shadcn Critical Rules 收敛（无 `space-y-*`、类名不用模板字符串三元、无 `dark:` 颜色覆盖、
等宽高用 `size-*`、图标进组件用 `data-icon`）。以下是**核实过、刻意保留**的偏差：

| 位置 | 偏差 | 为什么保留 |
| --- | --- | --- |
| `components/ItemTooltipContent.tsx` | 大量硬编码色（`text-zinc-100` / `bg-black/85` / `text-amber-300` …） | 复刻 Terraria 游戏内物品提示的观感（名称按稀有度着色、半透明黑底、无模糊）；**不随站点明暗主题变化**，是游戏原样表现，换成语义令牌反而失真。详见 [`功能-合成表与物品提示.md`](功能-合成表与物品提示.md) |
| `components/ItemTooltip.tsx` | `className="... z-[100]"` | 自研提示（非 shadcn `Tooltip`），会从 `Sheet` / `Dialog`（`z-50`）内部触发，portal 到 `body` 后必须盖在它们上面；没有可复用的组件堆叠机制 |
| `components/ui/*` 内建 `aria-label`（`Close` / `Loading` / `pagination` …） | 英文硬编码 | 这些是 shadcn 原样组件，不依赖 `lib/i18n`（避免 ui 层耦合业务 i18n）。**业务侧调用时用 `aria-label` / `title` 覆盖**（如 `AppShell` 给 `SidebarTrigger` / `SidebarRail` 传 `nav.toggleSidebar` / `nav.railToggle`） |
| `components/ui/Card.tsx` | `Card` / `CardHeader` / `CardTitle` / `CardBody`，没有 `CardContent` / `CardFooter` | 项目自有命名（见组件清单）；布局语义一致，`CardFooter` 由 `DialogFooter` / `SheetFooter` 承担 |
| `components/ui/Drawer.tsx` | 依赖 **Base UI**（`@base-ui/react/drawer`），项目其余组件都是 radix；类名与 CSS 变量取自 shadcn 官方 Base UI 版 | `components.json` 的 base 仍是 `radix`。选它唯一原因是**可堆叠嵌套**：radix 侧（`Sheet` / vaul）没有「父抽屉缩小留在后面」的实现，且 vaul 已停止维护。只有物品详情用它，其它浮层继续走 radix，不要混用；Drawer 的替换元素用 Base UI 的 `render`（不是 `asChild`）|

## 卡片的「主 / 次」层次

- 亮色下 `--background` 是**纯白 `#ffffff`**（v1.50 起），`--sidebar` 为 `#fafafa` 用来区分侧栏；卡片靠 `border` 与画布区分。
  `Card` 只保留 `shadow-sm`。
- 亮色模式主色使用中性深灰，右侧主画布为 `#ffffff`、侧边栏为 `#fafafa`，输入框 / 浅色控件使用中性浅灰；暗色模式使用原有中性主色，不再跟随亮色改色。绿色只用于 `success` 等语义状态。
- 首页标题下固定一张紧凑的「指令」入口卡：有草稿时显示草稿并提供「继续编辑」，没有草稿时直接打开指令页；最近指令作为卡内快捷按钮。
- 指令卡片无结果时压成单行（标题、指令、状态、执行按钮），只在有加载 / 错误 / 输出时才展开为完整结果卡。
- **首页为左右两栏**（`xl:grid-cols-[minmax(0,1fr)_360px]`）：
  - 右栏（概览）：服务器状态 / 服务器动态 / 最近执行；「快捷入口」与侧栏重复，默认隐藏但保留在管理器中。
  - 左栏（指令）：其余指令卡片 + 自定义卡片。
  - 移动端先渲染概览列，再渲染指令列；`xl` 起恢复左右两栏。
  - 两栏各自保持 `tswui:homeCards` 里的相对顺序（`RIGHT_COLUMN_IDS` 分栏）。
- 指令页空态直接给出「浏览指令 / 收藏 / 最近执行」入口，不再只显示大块空白。
  空态下编辑器位于引导卡中央并自动聚焦；产生结果后编辑器回到结果区底部并固定。
- 指令页右侧面板改名「工具面板」；移动端点击「打开指令库」会自动滚到面板。
- 鱼店右侧只保留「钓鱼信息」卡片（`/fish info`），常显、无收起开关；其余 `/fish ...` 卡片已移除。
- 需要边框的特殊卡片（如鱼店头部卡片）由调用方单独加 `border`。

## 设置页（v1.4）

- 每张卡片用 `components/CollapsibleCard.tsx`（Card + Collapsible）：头部标题可点击折叠，头部右侧控件（重新检测 / 刷新）不参与折叠。
- 「激活模块」卡片内是 `Tabs`，按模块**来源**分三个 tab（`lib/modules.ts` 的 `ModuleDef.origin`）：
  - **内置模块**（`origin: 'webui'`）：随信使插件（WebUI）提供，目前是物资申请；
  - **已适配**（`origin: 'plugin'`）：第三方插件 PlayerManager（`/pm`）、FishShop（`/fish`）、WorldModify（`/wm`）；
  - **自定义**：自定义模块列表 + 创建表单。
  每个 tab 顶部一行说明，下方复用同一个 `ModuleRow`（名称 + 状态徽标 + 依赖说明 + 开关）。
  登录成功后 App 会探测插件，**已安装且有权限的玩家管理 / 鱼店会自动激活**（侧边栏入口直接出现）；
  用户手动拨过开关的模块记入 `tswui:modulesSet`，不再被自动激活覆盖；世界管理靠执行 `/wi` 探测
  （复用模块页最近一次结果，面板右上角「重新检测」强制重探），但**不参与自动激活**，保持手动。
- **模块开关与插件状态解耦**：内置 / 自定义模块（包括玩家管理）都能自由开关，开关只控制侧边栏显隐；插件未安装、无权限、版本过旧或后来被卸载时，
  开关仍可操作，状态徽标只用于说明页面数据是否可用。关闭模块后直达 URL 会回到首页。
- 两栏布局：**左列 = 界面偏好（置顶）→ 激活模块**；右列 = 执行行为 / 数据刷新 / 信使诊断 / 在线授权与账户。
- 「界面偏好」只放字号 / 简约视图 / 语言 / 主题；“执行行为”单独放执行队列间隔与批量执行卡片；
  “数据刷新”只放服务器动态刷新间隔与页面数据刷新间隔。

## 响应式、触屏与 URL

- 数据 ID / 物品 ID 的图标网格：格子宽 **72**、图标 **64**；**列间距手机 8px（`gap-x-2`）/ 桌面 16px（`gap-x-4`）**，行距 16px。
  数据 ID 的 Boss 分类把贴图放大到 **128**、格子/图标区 **144**；页面设置可「隐藏 ID 和名称」，只留图标。
- 触屏设备（`hover: none` / `pointer: coarse`）上，折叠箭头、刷新、复制、收藏、删除等操作常显；桌面仍可 hover 渐进显示，键盘通过 `focus-within` 显示。
- 当前页签同步为 URL hash（映射见 `web/src/lib/routes.ts`）；浏览器前进 / 后退、刷新和分享链接均可用。localStorage 中的 `tswui:ui.activeTab` 仅作为无 hash 时的兜底。
  - 内置页面用短名：`#/home`、`#/cmd`（指令）、`#/commands`（小抄）、`#/items`、`#/dataid`、`#/plr`（查看存档）、`#/pm`（玩家管理）、`#/wm`（世界管理）、`#/fish`（鱼店）、`#/settings`；`#/spawn` 旧链接回落到小抄。
  - 自定义插件页用**主指令**：`/clip` → `#/ext-clip`，`/chest` → `#/ext-chest`（`ext-` + 主指令第一段，小写）。
  - 旧地址继续兼容：`#/save`、`#/players`、`#/world`、`#/store`、`#/commands`、`#/spawn`、旧的自定义模块 `#/m:%3Cid%3E`，打开后会把地址替换成新的短名。
- `Input` / `Textarea` / `InputGroupInput` / `NativeSelect` 未显式传 `id` 时自动生成稳定 id 与 name，避免表单字段缺少语义。

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
  （与「指令不存在 → `command_not_found`」区分，见 `docs/插件-世界管理.md`）。
- `status === 'command_not_found'`（指令不存在 = 提供该指令的插件没装）时，**首页内置指令卡片**自动隐藏、
  在「管理卡片」里置灰并标「缺少插件」，也不再参与自动刷新 /「统一执行」；
  手动「刷新全部」**不跳过**这些卡片（并重探一次 PlayerManager），装上插件后点一下即可恢复；
  自定义卡片不隐藏（玩家自己填的指令，结果区展示即可）。
- **世界管理的固定卡片**同样把 `command_not_found` 当成「插件未安装」：由第一张固定卡片（`/wi`）探测，
  命中时页面顶部显示「服务器未安装 WorldModify 插件」+「重新检测」，4 张固定卡片改显示「插件未安装」
  （不展示 TShock 原文），「管理卡片」里置灰标「缺少插件」；`no_permission` 不算缺插件。
  缺插件期间自动刷新不再重跑固定卡片；设置页「激活模块 → 已适配」复用同一个 `/wi` 结果显示已安装 / 未安装 / 无权限，
  详见 `docs/插件-世界管理.md` §3。

## 模块与指令卡片

- 内置模块（`MODULE_DEFS`）：玩家管理、鱼店、世界管理；自定义模块（`lib/customModules.ts`，id `m:`）由用户
  「填名称 + 主指令」创建，并自动生成一张「帮助」卡片（`/xx help`）；创建后可在列表中**直接改名称 / 主指令 / 顶部说明**（
  `desc` 留空则回退默认提示），改主指令会同步「帮助」卡片；激活后进侧边栏。
- 模块内的「用户添加的指令卡片」统一存 `tswui:moduleCards`（`lib/moduleCards.ts`，`byServer[serverId][moduleId]`）。
- 侧边栏使用轻量分组：**常用**（首页 / 指令）→ **查询**（物品 ID / 数据 ID）→ **玩家**（玩家管理）→ **世界**（世界管理）→ **商店**（鱼店）→ **服务**（物资申请）→ **自定义**（已激活自定义模块）→ **系统**（设置，恒在末尾）；空分类不渲染。
- 自定义模块在设置页支持拖拽排序，并提供「上移 / 下移」按钮；数组顺序直接决定侧栏顺序，仍存 `tswui:customModules`。
- 通用页 `pages/CommandModulePage.tsx` + `components/ModuleCardsPanel.tsx`：世界管理与自定义模块共用，
  支持逐张刷新 / 刷新全部 / 添加删除卡片 / 批量执行。鱼店右侧卡片（`FishCommandCards`）也用同一份 `moduleCards`
  追加自定义卡片。

## Sidebar

`AppShell.tsx` 用 shadcn `Sidebar` 重写（平铺侧栏 + 内容区顶栏面包屑）：

- `SidebarProvider` 受控于 App 的 `sidebarCollapsed`（Provider 内部切换，如 `Cmd/Ctrl+B`、rail 拖动，会经 `onOpenChange` 同步回 App）。
- `AppShell` 在页面最前提供「跳到主内容」跳过链接，`<main id="main-content" tabIndex={-1}>` 作为目标。
- **`collapsible="offcanvas"`**：收起时侧栏完全滑出屏幕，内容区占满整宽；重新展开靠内容区顶栏的面板按钮（或 `Cmd/Ctrl+B` / 拖动侧栏边缘）。
- 侧栏与内容区都是平铺的（默认 `variant="sidebar"`，侧栏 `border-r`），不用 `inset` 的圆角卡片。
- 移动端由 `Sidebar` 内部自动改用 `Sheet` 抽屉（不再自绘遮罩），`SidebarNav` 点选后调用 `useSidebar().setOpenMobile(false)` 收起。
- 导航项一律**单行**（图标 + 名称，`SidebarMenuButton` 移动端 `h-10`、桌面 `md:h-8`）；副标题不再放进按钮。
- `SidebarHeader` 只放一行：「**WebUI**」文字（无图标 / 无副标题）+ 右侧语言 / 主题快捷按钮（`headerExtra`）+「隐藏侧栏」按钮。
- `SidebarContent` 只放导航：分组标题「常用 / 查询 / 玩家 / 世界 / 商店 / 服务 / 自定义」，空分组不渲染；`system`（设置）只有一项、不带标题。
- **`SidebarInset` 顶栏**（吸顶，`h-12`，**带下边线** `border-b`）分三段，互不干扰：
  1. **左**：`SidebarTrigger` + `Separator` + `Breadcrumb`（只显示当前页面）+ **页面说明 ⓘ**（`TopBarActions info=…` 的 `TopBarInfoSlot`）。
     顶栏只在侧栏收起时出现「显示侧栏」（桌面）；移动端保留「打开菜单」。
  2. **右**：`上次刷新 → 刷新 → 管理卡片 / 页面设置 → 指令(>_)`，即刷新类在最左、管理类在右、终端最后。
  3. **手机端**：右侧只保留 `…`（`DropdownMenu`），页面操作与终端都在菜单里，**一行一个按钮（图标 + 名称）**，`…` 永远最右。
- **页面操作进顶栏**：`components/TopBar.tsx` 的 `<TopBarActions>`，`info` 属性放标题右侧，children 放右侧；没有 Provider 时（页面单测）原地渲染。
  图标按钮用 `components/IconAction.tsx`（`Tooltip`，不是 `title`）；说明类小字用 `components/InfoPopover.tsx`；全屏操作坞用 `components/FullscreenDock.tsx`。
- 正文上下内边距统一 `px-3 py-4 md:px-6`。
- `SidebarFooter` 放执行队列（`sidebarExtra`）+ 账号卡片，**队列恒在账号上方**；
- **「设置」是导航项且固定排在末尾**（`App.tsx` 的 `nav` 在遍历模块后 `push({ id: 'settings' })`）：新增内置 / 自定义模块都插在它前面。原页脚里的 `SettingsMenu` 已移除。
  `SidebarInset`（`<main>`）是滚动容器（图鉴等页面用 `closest('main')` 量高度）。
- 侧栏底部账号区是 `SidebarAccountMenu`（NavUser 风格，`DropdownMenu`）：头像 + 用户名 + 服务器地址（**不再显示「服务器默认」**）+ 展开箭头；
  菜单项为「切换服务器」（`ServerSwitcherDialog`）与「登录 / 退出」。头像会联动玩家管理——查到当前登录账号本人时用其全身图（`lib/selfAvatar.ts`，内存、按服务器分开）。
- **未登录时**在账号卡片**上方**多渲染一条通栏主色登录按钮（`Button variant="primary"`），点击**直接打开登录框**（不必先进菜单）；已登录时不渲染该按钮。账号卡片本身保持原样（菜单里仍可切换服务器 / 退出）。
- 测试定位：`data-testid="sidebar"`，收起状态读 `data-collapsed`（`data-state` 同义）；顶栏按钮名为 `nav.toggleSidebar`（「收起 / 展开侧栏」），`SidebarRail` 用 `nav.railToggle`，避免两个同名按钮。

## 主题 / 语言快捷切换

侧栏**页头**放两个**多状态图标按钮**（`components/QuickPreferences.tsx`，经 `AppShell` 的 `headerExtra` 传入，在「WebUI」右侧），避免为改主题/语言专门进设置页：

- **主题**：`auto → light → dark` 循环，图标 自动=`Monitor`（电脑）/ 浅色=`Sun`（太阳）/ 深色=`Moon`（月亮）。
- **语言**：中文 ↔ English，按钮直接显示当前语言代码（`中` / `EN`）。
- 两者都有 `title` + `aria-label`（`settings.theme.toggle` / `settings.language.toggle`），值为当前状态与可读名称。
- `theme='auto'` 由 `App` 监听 `prefers-color-scheme`（`systemDark`）决定是否加 `.dark`；`light` / `dark` 忽略系统。恢复默认 `dark`。
- 设置页的「主题」`ToggleGroup` 同步支持三态（`settings.theme.auto/light/dark`）。

## 非模态浮层（浮动终端）

- 全站唯一的非模态浮层是**浮动终端**（`components/CommandTerminal.tsx`，窗口标题「指令」）。入口是**顶栏右侧的「指令」图标按钮**
  （`components/TerminalTopBarButton.tsx`，桌面排在页面操作之后；**手机端收在 `…` 菜单里**；「指令」「设置」页不显示）：
  `role="dialog"` + `aria-modal="false"`，自己处理拖动 / 缩放 / `Esc`，**不做焦点陷阱、不压暗页面**。
- 层级：`z-40`，低于所有模态层（`Sheet` / `Drawer` / `Dialog` 的 `z-50`）。打开模态时不强行关闭它。
- 关闭只认 `×` / `Esc` / 再点入口按钮（**不**响应点击外部），这样「边看页面边执行」才成立。
- 窗口几何存 `tswui:terminal`（见 `lib/terminalWindow.ts`），恢复时先 clamp 进视口。
- 需要模态交互时**不要**改它的样式来凑，直接用 `Sheet` / `Dialog`。

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
| `QuickPreferences` | `components/QuickPreferences.tsx` | 侧栏页头「WebUI」右侧的语言 / 主题多状态图标按钮。见「主题 / 语言快捷切换」 |
| `TopBar` | `components/TopBar.tsx` | `TopBarProvider` + `TopBarInfoSlot`（标题右侧说明）+ `TopBarSlot`（右侧操作 / 手机 `…` 下拉）+ `TopBarActions`（`info` 与 children 分槽投递）。无 Provider 时原地渲染（页面单测用） |
| `IconAction` | `components/IconAction.tsx` | 顶栏 / 工具条图标按钮：`ghost` + `icon-sm` + `Tooltip`，支持 `loading`（Spinner）与 `pressed`；手机 `…` 菜单里通过 `data-action-label` 同一份 DOM 显示文字标签 |
| `InfoPopover` | `components/InfoPopover.tsx` | 「页面说明」info 图标 + Popover，收纳原先铺在正文里的小字说明 |
| `FullscreenDock` | `components/FullscreenDock.tsx` | 全屏结果页**右上角**操作坞：先露出，随后收成贴右边的竖条（左侧上下圆角、宽 12px）；悬停 / 聚焦 / 点击展开，展开后 4 秒无操作再收起 |
| `CommandLine` | `components/CommandLine.tsx` | 可复制指令：第一行标签、第二行等宽指令 + 复制按钮（数据 ID 召唤指令、物品给予指令共用） |
| `CommandTerminal` / `TerminalTopBarButton` | `components/CommandTerminal.tsx` / `components/TerminalTopBarButton.tsx` | 浮动终端（桌面非模态浮窗 / 窄屏底部抽屉）与顶栏入口（除「指令」「设置」外所有页面，登录后显示；手机在 `…` 菜单里）；开关状态在 `lib/terminalContext.tsx`。见 [`功能-浮动终端.md`](功能-浮动终端.md) |

## 未登录的页面门控

- 需要 token 才能取数的页面（首页、指令、玩家管理、鱼店、世界管理、自定义模块、设置）在未登录时**隐藏自身内容**，
  只留页头 + `LoginGate`（`components/LoginGate.tsx`），点「登录」走 App 的登录框（`onLogin` 回调）。
- 文案统一为 `login.required`（「请先登录！」/「Please sign in!」），不再按页区分。
- 侧边栏入口本身仍可见（可点，点开只看到提示），不做整块隐藏。
- **查看存档**（`save`）不需要 token（只上传本地 `.plr` 给后端解析），是**独立侧边栏菜单**，入口恒在、不受模块开关影响；
  「玩家管理」（`players`）才跟随模块开关与 PlayerManager 插件。

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

侧栏账号卡片与登录框都会打开它。

- **列表行**：整行（地址 + 操作按钮）共用背景/hover；每行显示**完整 URL**（`scheme://host:port`，`lib/servers.ts` 的 `targetUrl()`），不再单列 http/https 标签；账号卡片 / 登录框等「外面」仍用 `hostPortLabel()` 的 `host:port` 简略形式。
- **连通性检测**：每行一个**图标按钮**（在垃圾桶左边；内置项没有垃圾桶，就这一个）。图标随状态：已连通 = `Wifi`（绿）、无法连接 = `WifiOff`（红）、检测中 = `LoaderCircle` 转圈。点击该行按钮重新检测（`transport.serverStatus(header)`，内置项传空串）。打开 / 列表变化时自动全量探测一次。
- **新增**：默认收起表单，列表下方一个通栏 `variant="outline"` 「添加服务器」按钮；点开才出现「协议（只读）+ 主机 + 端口 + HTTPS 勾选」一行。**新增只入库、不自动切换**（`App.addServer` 不再调 `selectServer`）。
- **修改**：每行（内置项除外）有铅笔按钮，点开预填表单，保存调 `onEdit(oldId, target)`（`lib/servers.ts` 的 `updateServerTarget()`）；改的是当前上游时会走一次切换并要求重新登录。
- **测试定位**：`getByRole('button', { name: /添加服务器/ })`、`编辑` / `删除` / `保存`。
- 登录原因（如会话过期 `app.sessionExpired`）与帮助文案里可能有 `\n`：渲染处用 `whitespace-pre-line` 保留换行（HTML 默认会把 `\n` 折叠为空格）。
- 错误 / 无权限提示仍在出错时才出现（含可复制的赋权命令）。

## 首页布局

- 两层结构：左栏 = 指令卡片（两列网格 `sm:grid-cols-2`），右栏 = 概览（服务器状态 / 服务器动态 / 快捷入口 / 最近执行，360px）。
- 左栏顺序：世界信息 / 我的背包 → 在线玩家 + 游戏时间 → 死亡次数 → Boss 战伤害 → Boss 进度；自定义卡片在 Boss 进度之前。
  半宽卡片为奇数时最后一张占整行，避免半格空白；卡片高度按内容自适应（不强制等高）。
- 卡片高度按内容自适应；富文本结果按行数自然展开，不再强制撑满，也不出现多余的内部滚动条。
- 「最近执行」固定高度 `xl:h-64`，最多 5 条，可完整显示，超出时卡片内滚动。

## 图标网格（物品 ID / 数据 ID）

- 格宽 **72**、图标 **64**；列间距 **手机 8px / 桌面 16px**，行距 16px；格子默认**无底色**，hover 时只有 72×72 图标区铺 `bg-primary/10`，文字无背景，整格一起上浮。
- 物品 ID：虚拟滚动，格宽 72 / 高 106（隐藏 ID 和名称后 72），列间距随视口切换 8/16。
- 数据 ID：Boss 分类贴图 128、格子/图标区 144（2×）；页面设置提供「隐藏 ID 和名称」；
  召唤指令为两行（标签 + 指令 + 复制），Boss 额外给单字简写（`/sb king`、`/sb eoc`）。

## 查看存档（`pages/PlrPage.tsx`）

- 侧边栏「查看存档」（人头图标），公开工具：导入 `.plr` 不需要登录。
- 导入后顶栏右侧出现**导出图片**与**简约视图**两个图标按钮（没有导入文件时不显示）；
  导入按钮旁提供 **导出 .plr**（outline，原文件原样下载，文件名保持）。
- **解析完全在浏览器里**（`lib/save/plr.ts` 解密 + 解析）：文件不上传、只存在内存，没有体积上限与接口配额。

## 查看世界（`pages/WorldPage.tsx` + `components/world/WorldPanel.tsx`）

- 侧边栏「世界」分组（`Map` 图标），**排在「世界管理」之前**，地址 `#/wld`；公开工具、**纯本地解析**（不上传）。
- 顶栏右侧：**导出图片**（`IconAction` + `Camera`，导入后出现，与「查看存档」同位置同外观）。
- 工具卡一行：**导入 .wld**（primary；解析中转 Spinner）+ **来个 Demo**（outline + `Sparkles`，拉自带的空白世界）+
  **导出 .wld**（outline，导入过才显示）+ 右侧一行说明（格式；解析中改成「正在渲染缩略图… N%」，
  用 `role="status"`）；文件选择框隐藏，整页可拖放（`data-testid="world-drop"`）。
- ~~工具卡下方固定一条 `Alert variant="info"`（`ShieldCheck`）~~：已按用户要求移除（2026-10-26），
  页面不再重复强调「本地解析」——工具卡右侧的说明文案已经交代清楚。
  空态用 `Empty`，错误用 `Alert variant="destructive"`。
- 概览卡：**缩略图**（`<canvas>` + `putImageData`，位图按像素预算做到 1 图格 = 1 像素，按容器平滑缩放；
  外层是可点击按钮，hover 显示「点击查看原图」→ `Dialog` 里放 1:1 大图 + `overflow-auto` 滚动）→
  标题行（世界名 + 难度 / 世界大小 / 邪恶 / 困难模式 / 已收藏 / 本地导入徽章）→ 特殊种子徽章行 → `Separator` →
  字段网格（`grid-cols-2 sm:grid-cols-3 xl:grid-cols-4`，每格「标签 `text-2xs` + 值 `text-sm`」，值空则整格不渲染）→
  `Separator` → Boss 进度徽章（`tone="success"`，没有就一句话）。
- 导出图片复用同一份位图（`canvas.toBlob` → 下载 `<世界名>.png`），不需要重新渲染。

## 指令页

- 顶部下划线 tab：**指令 / 聊天**（记忆到 `tswui:commandPageTab`）；聊天 = 服务器动态 + 发言框。
- 底部输入框右侧按钮与顶部 tab 双向联动；工具面板开关在顶栏右侧，面板无标题栏（**物品 / 收藏 / 历史**）。
- 指令库已移到独立的「小抄」页；空态里的「打开指令库」按钮跳到该页。

## 小抄（`pages/CommandTipsPage.tsx`）

- 侧边栏「常用」分组，**排在「指令」下方**，图标 `ScrollText`，地址 `#/commands`。
- 页面 tab：**默认 / NPC管理 / 指令库**；默认与 NPC管理是原小抄内容，指令库是原指令页工具面板的指令列表（点一条填进浮动终端）。
- 页面公开：不需要登录，也不依赖插件。
- 工具面板内容内部滚动，输入框固定在可见区域。
- 执行失败原因显示在**富文本下方的 `Alert`**（指令不存在 = warning，权限/执行错误 = destructive）。

## 物品给予指令

- 物品详情新增「物品给予指令」（`CommandLine` 两行样式）：`/give <物品ID> <玩家名>`；
  选了词缀时 `/give <物品ID> <玩家名> 1 <词缀ID>`。未登录不显示。

## 变更记录

历史变更（v1.2 → v1.53，含组件新增 / 重命名 / 布局改版）见
[`记录-改版日志.md`](记录-改版日志.md#ui-组件v12--v153)。本文件只写**当前**组件清单与使用约定。
