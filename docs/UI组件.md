# 前端 UI 组件（shadcn/ui）

对应目录：`web/src/components/ui/`
设计规范：`.agents/skills/shadcn/`（项目级 skill，含 Critical Rules：styling / forms / composition / icons / base-vs-radix）
项目配置：`web/components.json`（style `new-york`、base `radix`、Tailwind v4、lucide 图标、别名 `@/`）

> 视觉总规范（配色、字号角色、圆角、深度、组件观感）见仓库根 [`DESIGN.md`](../DESIGN.md)；本文件只管**组件用法与工程约定**。

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
| SearchInput | `components/SearchInput.tsx` | InputGroup + Button + Kbd | 搜索与最近搜索；左侧放大镜（`leadingIcon`）、右侧结果数（`resultLabel`）/ 清空 / 历史按钮 / 尾部图标（`trailingIcon`）；页面级搜索框开 `shortcut`：失焦且空时右侧显示 `kbd` `/`，按 `/` 聚焦。圆角与高度走 `InputGroup` 默认（`rounded-control`），页面不要再传 `rounded-full`。 |
| Textarea | `ui/Textarea.tsx` | — | 多行文本（物资申请的用途 / 拒绝原因） |
| InputGroup | `ui/InputGroup.tsx` | — | 输入框内的图标 / 按钮（`InputGroupInput` + `InputGroupAddon`），替代绝对定位按钮 |
| Label | `ui/Label.tsx` | radix label | 一般通过 `FieldLabel` 使用 |
| Field | `ui/Field.tsx` | — | `FieldGroup/Field/FieldLabel/FieldDescription/FieldTitle/FieldSet/FieldLegend`；表单一律用它 |
| Checkbox | `ui/Checkbox.tsx` | radix checkbox | 布尔勾选（表单/开关项） |
| Slider | `ui/Slider.tsx` | radix slider | 数值范围（如设置页字号） |
| ToggleGroup | `ui/ToggleGroup.tsx` | radix toggle-group | 2–5 选的选项集（主题 / 语言 / scheme） |
| Spinner | `ui/Spinner.tsx` | lucide | 加载指示；Button 内配 `data-icon`，独立展示配 `aria-label` |
| Empty | `ui/Empty.tsx` | — | 空状态（`EmptyHeader/Media/Title/Description/Content`），不要手写空态 |
| Toaster / toast | `ui/Sonner.tsx`（`sonner`） | sonner | 全局提示条：`App` 里挂一次 `<Toaster>`，业务里 `toast.success(...)`；多条自动堆叠、每条带关闭按钮、`duration` 秒级自动消失。配色走语义令牌（`--popover` / `--popover-foreground` / `--border`），`theme` 由 `settings.theme` 算好的 light/dark 传入（不引入 `next-themes`）。**不用于**验证真伪的结果（执行结果仍留在结果区） |
| Skeleton | `ui/Skeleton.tsx` | — | 加载占位；路由懒加载与后续内容区骨架统一使用，不手写 `animate-pulse` 色块 |
| Alert | `ui/Alert.tsx` | cva | Callout / banner / 错误提示；变体 `default/muted/destructive/warning/success/info` |
| Select | `ui/Select.tsx` | radix select | **全项目唯一的下拉组件**（原生 `<select>` / 旧的 `NativeSelect` 已全部移除）：`SelectTrigger size="sm"` 用于紧凑区；表单字段把 `id` 给 `SelectTrigger`、`Label htmlFor` 指过去即可；值统一是**字符串**（数字 / 枚举自己 `String()` / 解析回去） |
| Pagination | `ui/Pagination.tsx` | Button | 复用 Button（`<button>` + `disabled`）；页码窗口见 `lib/pagination.ts` 的 `paginationRange` |
| Tabs | `ui/Tabs.tsx` | radix tabs | 真正切换视图 / 面板时用；`TabsTrigger` 自带 `cursor-pointer`（可点击）与图标尺寸兜底 |
| Switch | `ui/Switch.tsx` | radix switch | |
| Dialog | `ui/Dialog.tsx` | radix dialog | 每个 Dialog 必须有 `DialogTitle`；`DialogFooter` = 底部操作区（`bg-background` + `border-t`）；`DialogContent` 支持 `overlay={false}`（不画暗色遮罩，配 `modal={false}` 用，行为接近 popover） |
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
  数据 ID 的主 Tabs 不包在 Card 内；玩家管理不重复渲染页面标题，
  页面级动作（简约视图 / 导出图片）进**顶栏右侧**，正文不放大按钮。
  工具面板（指令库 / 物品 / 收藏 / 历史）是弹框，里面用标准胶囊 Tabs，单行横向滚动。
  「指令」列表里 `allowServer=false`（只能游戏内执行）的指令**排到最后**，收进可折叠的「游戏内指令」分组（默认收起，
  搜索时自动展开），列表行仍带「游戏内」徽标。
- **输入框内图标 / 按钮用 `InputGroup` + `InputGroupAddon`**，不要 `relative` + 绝对定位。
- **聚焦环画在框外（`ring-2`），滚动容器要给它留 `p-1`**：`ring` 是盒子外面的 2px 阴影，
  而 `overflow-y-auto` / `overflow-hidden` 会把它裁掉——控件贴着滚动区左上边时，左边变成直线、
  两个上圆角缺一块（鱼店搜索框踩过这个坑）。所以带滚动容器的内容区统一留 4px 内边距：
  滚动区本体用 `p-1` / `px-1 py-1`（同数据图鉴、物品图鉴的列表滚动区），或列表外套一层 `p-1`。
  顺便给悬停上浮（`hover:-translate-y-0.5`）也留出了余量。
- **空状态用 `Empty`**；**提示 / Callout / banner 用 `Alert`**（不要手写彩色 div）。
- **加载占位用 `Skeleton`**；懒加载路由、鱼店货架和角色背包首次加载统一使用。
- **分隔线用 `Separator`**。
- **弹框底部操作区用 `DialogFooter`**：底色 `bg-background` + `border-t`；用负外边距抵消 `DialogContent` 的 `p-5` 做成通栏；物品详情 / 商品详情 的操作按钮都放在这里。
  （亮色下 `--background` 已改为与卡片同为白，靠顶部 `border-t` 区分；暗色下仍比卡片深。）
- **图标进组件用 `data-icon`**（`Button` / `TabsTrigger` / `ToggleGroupItem` / `CardTitle` 已统一兜底尺寸）。
- **覆盖 `Button` / `SidebarMenuButton` 的高度（或 `icon` 尺寸）时要带 `md:`  counterparts**：
  尺寸变体写的是 `h-10 md:h-9` / `size-10 md:size-9`，媒体查询变体在 CSS 里排在后面，
  所以 `className="h-auto"` 在 ≥768px 会被 `md:h-9` 盖回去（内容溢出、互相重叠）。
  要写 `h-auto md:h-auto`（鱼店商品格子踩过这个坑，见 `docs/插件-鱼店.md` §4）。
- **详情优先用右侧抽屉**（鱼店商品详情、数据ID的 NPC / 图格 / 墙 / Buff 详情用 `Sheet`；物品详情用可堆叠的 `Drawer`）：
  标题栏固定、中间内容滚动、右上角 × 关闭；居中 `Dialog` 只用于需要「必须做选择」的小弹框。
- **抽屉里可以再开抽屉时用 `Drawer`（Base UI）**：像物品详情那样「点配方材料 → 看材料详情 → 返回」的钻取，
  `Sheet`（radix dialog）做不到——它只会并排弹出、不会把父层缩小留在后面。叠层写法：把子 `<Drawer>`
  **渲染在父 `DrawerContent` 里**（Base UI 靠 React 树判定嵌套），`open` 受控、关掉就出栈。
  root 的 `onOpenChange(false)` 只表示「这一层要关」，收起动画结束后再出栈（父层的 `--nested-drawers` 才会减）。
- **带「最近搜索」的搜索框用 `SearchInput`**：历史下拉**默认聚焦时不弹、打字时弹**，另有输入框内的
  历史按钮可手动展开（`historyOnFocus` / `historyToggle`，见 `docs/功能-搜索记录.md`）。
- **搜索框右侧只有一个位置**：失焦且没内容时显示 `kbd` `/`（`shortcut`，中点可点在框里、也可直接按 `/`）；
  聚焦或有内容时换成**结果数**（`resultLabel`）+「最近搜索」按钮 + 清空按钮。结果数不再单独摆在输入框外面
  （物品 ID / 数据 ID / 鱼店都已收进框内，参考 shadcn `InputGroup` 的搜索示例）。
  `shortcut` **只在页面级搜索框开**：弹框 / 面板里的搜索框不要开（会和指令页的 `/` 抢焦点，
  而且浮层开着时 `/` 应该留在浮层里）。
- **勾选项（Checkbox + 文字）用 `Field orientation="horizontal"` + `FieldLabel htmlFor`**：
  `Field` 加 `w-auto` 才不会被 `w-full` 撑满整行，工具栏里可横向排列；`FieldLabel` 默认带 `text-foreground`，
  放进 `text-muted-foreground` 容器时需显式覆盖颜色。**不要**裸 `<label>` 包 `Checkbox` 再重复写 `aria-label`。
- **页面级分类导航用 `Tabs variant="line"`**：放在页面标题下方的第一行，主分类靠左；右侧可放同类工具（如页面设置 / 全屏按钮）；NPC 子分类使用胶囊 Tabs，视图类 Checkbox 收进页面设置 Popover。移动端保持单行横向滚动，不为控件另起多行。
- **卡片管理里的“自动执行”用 `Checkbox`**，与“显示/隐藏”的 `Switch` 语义分开；新增卡片和编辑自定义卡片都按需展开，不常驻表单。

## 间距（4px 网格）

所有 `padding` / `gap` / `margin` 都是 4px 的整数倍：**4 / 8 / 12 / 16 / 24 / 32**。`8px`（`gap-2` / `p-2`）是基准节奏。
不要写 `gap-1.5`(6px) / `px-2.5`(10px) / `py-3.5`(14px) 这类半格值——在密集列表里会累积成对不齐的缝。

**唯一例外**：贴着文字的光学微调可以用 2px（`gap-0.5` / `py-0.5` / `mt-0.5`），它们是校正不是节奏。
「指令 → 物品」提示（`ItemTooltipContent`）复刻游戏内观感，字号与内边距保持游戏原样，不受本规则约束。

## 圆角（同心五档）

圆角按「由外到内」同心缩小（r = R − p），只有五档，全部落在 4px 网格上；细节与取舍见 [`DESIGN.md`](../DESIGN.md) §Shapes。

| 令牌 | 值 | 内边距 | 用在哪 |
| --- | --- | --- | --- |
| `rounded-modal` | 24px | 16px | Dialog / Drawer / Sheet |
| `rounded-container` | 16px | 8px | Card / Popover / Alert / Empty |
| `rounded-menu` | 12px | 4px | DropdownMenu / Select / Tabs / ToggleGroup 容器 |
| `rounded-control` | 8px | 4px | Button / Input / Textarea / 菜单项 / 侧栏项 |
| `rounded-chip` | 4px | — | Kbd / Checkbox / 行内小标记 |

- 药丸与正圆一律 `rounded-full`（Badge / Switch / Slider / 圆形按钮 / 指令输入条）。
- 贴视口边缘的 `Sheet` 保持直角。
- 组件里一律写角色令牌；`rounded-sm`/`md`/`lg`/`xl`/`2xl` 已重映射到同一套网格（4/8/8/16/24）仅作兼容别名，
  生产代码已全部迁移，新代码不要再用。
- **同心的判据是「不得超过」**：内层圆角 ≤ 外框圆角 − 内边距；小于等于都安全，超过才会在角落拱出来。
  玩家头像 / 物品图标 / 图格这类内容缩略图按自身形状取圆角，不受此约束。
- 连续圆角（`corner-shape: superellipse(1.25)`）在 `src/index.css` 里作为渐进增强统一加在 `:where(*)` 上，`rounded-full` 例外为 `round`；组件里**不要**各自写 `corner-shape`。

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

## 字号角色（不要临时加字号）

界面字号是**角色**，不是数值。改字号前先找角色，找不到再讨论是否新增角色
（一眼能读出来的层次靠这五档，不靠 `text-[13px]` 这类任意值）：

| 角色 | 规格 | 用在哪 |
| --- | --- | --- |
| 页面标题 | `text-base`（16px）/ `font-semibold` | **只在内容区顶栏出现一次**（`AppShell` 的 `BreadcrumbPage`）。内容区里不要再重复同一句话当标题 |
| 卡片 / 分区标题 | `text-sm font-semibold tracking-wide` | `CardTitle`、分区标题 |
| 正文 / 值 | `text-sm`（14px） | 表单值、说明、`dd` 值 |
| 密排数据 | `text-xs`（12px） | 世界信息列表（配 `leading-5`）、表格、标签 |
| 元数据 | `text-2xs`（11px） | 时间戳、数量、脚注；行高由令牌 `--text-2xs--line-height: 1.5` 统一，不要在调用处再写 `leading-4/5` |

- 11px 元数据**不能**再用 `/70`、`/60` 这类透明度压暗（暗色下对比度会掉到 3.5:1 以下）：
  次要文字用完整的 `text-muted-foreground`，让字号承担「次要」。
- **会变化或需要纵向对齐的数字用 `tabular-nums`**：玩家数、运行时长、时钟、ID、计数。
  等宽像素数字（`font-pixel` + `leading-none`）用于图标角标，属于数据角色，不受上面行高规则约束。
- **时间格式化跟界面语言走**，不跟系统语言走：统一用 `lib/clock.ts` 的 `formatClock(lang, ts)` /
  `formatClockWithDate(lang, ts)`，不要直接 `new Date().toLocaleTimeString()`
  （否则中文界面会显示 `10:29:04 AM`，装中文系统的英文用户又会看到「下午10:29」）。
- 例外：Terraria 物品提示复刻游戏内 15px 字号（见「已核实的例外」与 `功能-合成表与物品提示.md`）。

### 「只在 hover 时出现」的元数据

卡片表头里的**次要操作与元数据**默认隐藏，hover / 聚焦卡片时一起淡入，避免一行里堆着时间和按钮：

- 规则：`touch-visible opacity-0 transition-opacity group-hover/<name>:opacity-100 group-focus-within/<name>:opacity-100`
  （`<name>` 是卡片自己的 group，如 `result` / `header` / `recipe` / `rich`）。
- **必须带 `touch-visible`**：触屏没有 hover，少了它手机上永远看不到（`index.css` 里用
  `@media (hover: none), (pointer: coarse)` 强制 `opacity: 1`）。
- 目前这么做的：指令结果卡片的**执行时间**、填充 / 收藏 / 删除按钮、富文本复制按钮、
  合成表条目的「⭐ 收藏 / 复制」两个按钮（同一块 hover 区，见 [`功能-合成表与物品提示.md`](功能-合成表与物品提示.md) §5）。
  时间与按钮同一时间淡入（隐藏时仍占位，hover 不会导致文字左右跳动）。

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
- 指令页空态**不画虚线框**：工作区本身就是画布，引导块（图标 + 「开始一条指令」+ 一行说明）在工作区垂直居中；
  输入框始终贴底，空态与有结果时位置不变（不跳动）。
  空态**只留图标 + 标题 + 一行说明**（`editor.emptyHint`：上面输入、回车执行，左下角有指令库 / 物品 / 收藏 / 历史，
  ↑ / ↓ 翻历史）：不再摆「打开指令库」大按钮与「最近执行」小标签——工具入口就在输入框左下角，
  清空结果后重复一遍只会让页面显得很吵。
- 指令页的结果操作都进顶栏右侧：`展开全部 → 折叠全部 → 清空结果`（**清空结果在最右**，垃圾桶图标，
  有结果才出现，仍需二次确认；`ConfirmButton size="icon-sm"` + `text-muted-foreground` 与相邻图标同档）。
  单条的填充 / 收藏 / 删除在卡片自己的右上角，是卡片级操作。
- 指令页右侧面板改名「工具面板」，改成**弹框**，开关是输入框左下角的四个按钮（见「指令页」）。
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
- **未登录时**只渲染「界面偏好」卡片 + 下面的 `LoginGate`（带一行说明），其余卡片都要 token，整块不渲染。
- 「界面偏好」只放字号 / 简约视图 / 语言 / 主题；“执行行为”单独放执行队列间隔与批量执行卡片；
  “数据刷新”只放服务器动态刷新间隔与页面数据刷新间隔。

## 响应式、触屏与 URL

- 数据 ID / 物品 ID 的图标网格：格子宽 **72**、图标 **64**；**列间距手机 8px（`gap-x-2`）/ 桌面 16px（`gap-x-4`）**，行距 16px。
  数据 ID 的 Boss 分类把贴图放大到 **128**、格子/图标区 **144**；页面设置可「隐藏 ID 和名称」，只留图标。
- 触屏设备（`hover: none` / `pointer: coarse`）上，折叠箭头、刷新、复制、收藏、删除等操作常显；桌面仍可 hover 渐进显示，键盘通过 `focus-within` 显示。
- 当前页签同步为 URL hash（映射见 `web/src/lib/routes.ts`）；浏览器前进 / 后退、刷新和分享链接均可用。localStorage 中的 `tswui:ui.activeTab` 仅作为无 hash 时的兜底。
  - 内置页面用短名：`#/home`、`#/cmd`（指令）、`#/chat`（聊天）、`#/commands`（指令小抄）、`#/items`、`#/dataid`、`#/plr`（玩家存档）、`#/pm`（玩家管理）、`#/wm`（世界管理）、`#/fish`（鱼店）、`#/settings`；`#/spawn` 旧链接回落到指令小抄。
  - 自定义插件页用**主指令**：`/clip` → `#/ext-clip`，`/chest` → `#/ext-chest`（`ext-` + 主指令第一段，小写）。
  - 旧地址继续兼容：`#/save`、`#/players`、`#/world`、`#/store`、`#/commands`、`#/spawn`、旧的自定义模块 `#/m:%3Cid%3E`，打开后会把地址替换成新的短名。
- `Input` / `Textarea` / `InputGroupInput` 未显式传 `id` 时自动生成稳定 id 与 name，避免表单字段缺少语义。
- **下拉一律用 `Select`（Radix）**，不要再写原生 `<select>` / 加回 `NativeSelect`：这是 shadcn 的标准做法，
  也是全站外观与键盘操作统一的前提。

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
  都用 `Tooltip` 显示上次执行时间（`执行于 …` / 尚未执行）。
- **只有首页「游戏时间」卡片左下角常显「上次刷新 13:32:50」**（`CommandCard` 的 `showLastRunAt`，目前只 `HomePage` 给 `time` 卡传）：
  游戏内时间一直在走，光看「当前时间是 20:41」无法判断是不是几分钟前的快照；对着**现实里的刷新时刻**才能决定要不要再点一下。
  `text-2xs` + `tabular-nums`，与 `footerNote` 同一行（时间在左、备注在右；只有时间时不靠右）。
  其他卡片（含鱼店右侧卡片）没传这个 prop，还是只看 Tooltip，底部不占行。
- **自动执行偏好**（`tswui:autoExec`，`lib/autoExec.ts`，key 如 `home:<id>` / `world:fixed:/relive`）：
  关闭后该卡片不随自动刷新 /「刷新全部」执行，只能点自己的按钮。首页「管理卡片」和模块「管理卡片」都有开关；
  首页默认开，世界管理的 `/relive`、`/cleartomb` 默认关（`ModuleCardDef.manual`）。
- **显示 / 隐藏**（`CardManagerSheet` 的 `visibility`，需要时由页面传）：隐藏的卡片既不渲染也不参与刷新。
  首页用它（`tswui:homeCards` 的 `hidden`）；鱼店用它把「鱼罐 / 消费榜 / 鱼篓榜」默认藏起来
  （`tswui:fishCards:hidden`，没记过的按卡片的 `defaultHidden`）。
  模块卡片的管理弹框是共享的 `ModuleCardManagerDialog`，传了 `visibility` 就出「显示 / 隐藏」开关，不传就不显示。
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
- 侧边栏使用轻量分组（只有两处标题）：**无标题首组**（首页 / 指令 / 聊天 / 物资申请，按使用频率排）→ **工具**（物品 ID / 数据 ID / 指令小抄 / 玩家存档 / 世界存档 / 精灵图；查询类 + 纯本地文件的公开工具）→ **扩展**（鱼店 / 玩家管理 / 世界管理 / 已激活自定义模块）→ **系统**（设置，恒在末尾，无标题）；空分类不渲染。
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
- `SidebarContent` 只放导航：分组标题只有「工具 / 扩展」，空分组不渲染；首组（首页 / 指令 / 聊天 / 物资申请）与 `system`（设置，只有一项）都**不带标题**。
- **`SidebarInset` 顶栏**（吸顶，`h-12`，**带下边线** `border-b`）分三段，互不干扰：
  1. **左**：`SidebarTrigger` + `Separator` + `Breadcrumb`（只显示当前页面）+ **页面说明 ⓘ**（`TopBarActions info=…` 的 `TopBarInfoSlot`）。
     顶栏只在侧栏收起时出现「显示侧栏」（桌面）；移动端保留「打开菜单」。
  2. **右**：`上次刷新 → 刷新 → 管理卡片 / 页面设置 → 指令(>_)`，即刷新类在最左、管理类在右、终端最后
     （**首页不放终端图标**，右侧只留刷新 / 管理卡片；聊天页把入口挑到了输入框旁）。
     图标固定：**管理卡片 = `PlayingCardsFan`**（首页 / 自定义模块 / 鱼店三处必须一致），**页面设置 = `Settings2`**——
     两者长得像，但一个是「挑卡片」，一个是「调这个页面的显示」，别混用。
  3. **手机端**：右侧只保留 `…`（`DropdownMenu`），页面操作与终端都在菜单里，**一行一个按钮（图标 + 名称）**，`…` 永远最右。
- **页面操作进顶栏**：`components/TopBar.tsx` 的 `<TopBarActions>`，`info` 属性放标题右侧，children 放右侧；没有 Provider 时（页面单测）原地渲染。
  图标按钮用 `components/IconAction.tsx`（`Tooltip`，不是 `title`；图标按「次要灰」着色，`size-4` + `icon-sm` 容器，
  与卡片页头的图标按钮同一档，详见组件清单）；说明类小字用 `components/InfoPopover.tsx`；全屏操作坞用 `components/FullscreenDock.tsx`。
- 正文内边距统一 `p-2`（与顶栏 `px-2` 对齐）。
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
  （`components/TerminalTopBarButton.tsx`，桌面排在页面操作之后；**手机端收在 `…` 菜单里**；「指令」「设置」页与**首页**不显示）：
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
| `LoginGate` | `components/LoginGate.tsx` | 未登录时的统一占位（`login.required` = 「请先登录！」 + 登录按钮，可选 `hint` 一行补充说明）；首页 / 指令 / 指令卡片模块 / 玩家管理 / 鱼店 / 设置共用。见「未登录的页面门控」 |
| `QuickPreferences` | `components/QuickPreferences.tsx` | 侧栏页头「WebUI」右侧的语言 / 主题多状态图标按钮。见「主题 / 语言快捷切换」 |
| `TopBar` | `components/TopBar.tsx` | `TopBarProvider` + `TopBarInfoSlot`（标题右侧说明）+ `TopBarSlot`（右侧操作 / 手机 `…` 下拉）+ `TopBarActions`（`info` 与 children 分槽投递）。无 Provider 时原地渲染（页面单测用） |
| `IconAction` | `components/IconAction.tsx` | 顶栏 / 工具条图标按钮：`ghost` + `icon-sm` + `Tooltip`，支持 `loading`（Spinner）与 `pressed`；**常态灰 `text-muted-foreground`、悬停才 `text-foreground`**（顶栏右侧 / 卡片页头一致，不再有纯黑混搭）；手机 `…` 菜单里通过 `data-action-label` 同一份 DOM 显示文字标签 |
| `InfoPopover` | `components/InfoPopover.tsx` | 「页面说明」info 图标 + Popover，收纳原先铺在正文里的小字说明 |
| `FullscreenDock` | `components/FullscreenDock.tsx` | 全屏结果页**右上角**操作坞：先露出，随后收成贴右边的竖条（左侧上下圆角、宽 12px）；悬停 / 聚焦 / 点击展开，展开后 4 秒无操作再收起 |
| `CommandLine` | `components/CommandLine.tsx` | 可复制指令块：**属性名在灰框外**，下面每条指令各自一行（点整行即复制，右侧图标只是提示），一条属性名可带多条指令（数据 ID 召唤指令、物品给予指令共用） |
| `CommandTerminal` / `TerminalTopBarButton` | `components/CommandTerminal.tsx` / `components/TerminalTopBarButton.tsx` | 浮动终端（桌面非模态浮窗 / 窄屏底部抽屉）与顶栏入口（**首页、指令、设置、聊天页不放**，其余页面登录后显示；手机在 `…` 菜单里）；开关状态在 `lib/terminalContext.tsx`。见 [`功能-浮动终端.md`](功能-浮动终端.md) |

## 未登录的页面门控

- 需要 token 才能取数的页面（首页、指令、玩家管理、鱼店、世界管理、自定义模块）在未登录时**隐藏自身内容**，
  只留页头 + `LoginGate`（`components/LoginGate.tsx`），点「登录」走 App 的登录框（`onLogin` 回调）。
- 文案统一为 `login.required`（「请先登录！」/「Please sign in!」），不再按页区分；需要解释「为什么这块要登录」时传
  `LoginGate` 的可选 `hint`（目前只有设置页用：「激活模块、数据刷新与在线账户需要登录服务器后才能用」）。
- **设置页是例外**：界面偏好（字号 / 简约视图 / 语言 / 主题）是纯本地设置，未登录也照常显示可用，
  登录提示放在偏好卡片**下面**，需要 token 的部分（激活模块 / 执行行为 / 数据刷新 / 信使诊断 / 在线账户）不渲染。
- 侧边栏入口本身仍可见（可点，点开只看到提示），不做整块隐藏。
- **玩家存档**（`save`）不需要 token（只上传本地 `.plr` 给后端解析），是**独立侧边栏菜单**，入口恒在、不受模块开关影响；
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
- 左栏顺序：世界信息 / 我的背包 → 在线玩家 + 游戏时间 → 死亡次数 + Boss 战伤害（各占半栏、同一行）→ Boss 进度；自定义卡片在 Boss 进度之前。
  半宽卡片为奇数时最后一张占整行，避免半格空白。
- **同一行的两张半宽卡等高**（`[&>[data-slot=card]]:h-full` + 网格默认拉伸）：
  视觉上成行成列，底边对齐。多出来的高度由**卡片里的灰底正文区吸收**（`CommandOutput fill` →
  富文本块 `flex-1` + 自己内部滚动），所以正文与页脚（备注 / 「上次刷新」）之间仍然是紧的，
  不会出现「等高之后卡片底部空一条」的裸空白（这个坑踩过两轮：先等高 → 有空白 → 改成 `self-start`
  不拉高 → 一行两张高度不一；最终方案 = 等高 + 空白留在灰底里）。
- 卡片高度按内容自适应；富文本结果按行数自然展开，不再强制撑满，也不出现多余的内部滚动条。
- 「服务器动态」卡片页头：**刷新** + **向右箭头**（都是 `IconAction`，同尺寸 / 同灰度；不再写「查看全部」文字），
  两个按钮**默认隐藏**，hover / 键盘聚焦表头才淡入（`opacity-0 group-hover/header:opacity-100 group-focus-within/header:opacity-100`，触屏常显）。
  卡片底部一行 `<世界名> · 刷新于 HH:MM:SS · 游戏内 HH:MM`。
- 「最近执行」高度也跟内容走（最多 5 条，一次全部露出，**卡片内不滚动**）；每行右端显示这条指令的**执行时间**
  （`formatClock`，与「指令 → 历史」面板同一格式）而不是箭头；指令被截断时 hover 整行用 `Tooltip` 出全文（不用原生 `title`）。
  整行仍是按钮：点了跳到指令页、填进输入框，并直接把焦点交给输入框。

## 图标网格（物品 ID / 数据 ID）

- 格宽 **72**、图标 **64**；列间距 **手机 8px / 桌面 16px**，行距 16px；格子默认**无底色**，hover 时只有 72×72 图标区铺 `bg-primary/10`，文字无背景，整格一起上浮。
- 物品 ID：虚拟滚动，格宽 72 / 高 106（隐藏 ID 和名称后 72），列间距随视口切换 8/16。
- **鱼店商品格子沿用同一套尺寸**（`components/fishshop/GoodCells.tsx` 的 `CELL_WIDTH` / `GOOD_GRID`）：
  列宽固定 72（`grid-cols-[repeat(auto-fill,4.5rem)]`，不拉伸）、`gap-2`（行 / 列都 8px，比物品 ID 更紧）；
  格子里从上到下是 **图标区 72×72 → `#编号` → 名称**，hover 底色只在图标区。
- 数据 ID：Boss 分类贴图 128、格子/图标区 144（2×）；页面设置提供「隐藏 ID 和名称」；
  召唤指令不按权限隐藏；「Boss召唤指令」一块内列两行（`/spawnboss "<sb>"` + 单字简写 `/sb eoc`），
  下面再一行「NPC召唤指令」；属性名在灰框外，每行自带复制。

## 玩家存档（`pages/PlrPage.tsx`）

- 侧边栏「玩家存档」（人头图标），公开工具：导入 `.plr` 不需要登录。
- 导入后顶栏右侧出现**导出图片**与**简约视图**两个图标按钮（没有导入文件时不显示）；
  工具栏（`size="sm"`）里提供 **导出 .plr**（outline，原文件原样下载，文件名保持）。
- 工具卡分两行：上行是按钮（导入 .plr / 来个 Demo / 导出 .plr / 编辑），
  下行是小字说明（`text-2xs`）；说明走自己的行，窄屏不会和按钮抢宽度。
- **解析完全在浏览器里**（`lib/save/plr.ts` 解密 + 解析）：文件不上传、只存在内存，没有体积上限与接口配额。

## 世界存档（`pages/WorldPage.tsx` + `components/world/WorldPanel.tsx`）

- 侧边栏「工具 › 世界存档」（`Map` 图标），地址 `#/wld`；公开工具、**纯本地解析**（不上传）。
- 顶栏右侧：**导出图片**（`IconAction` + `Camera`，导入后出现，与「玩家存档」同位置同外观）。
- 工具卡分两行：上行是按钮（`size="sm"`）——**导入 .wld**（primary；解析中转 Spinner）+ **来个 Demo**（outline + `Sparkles`，拉自带的空白世界）+
  **导出 .wld**（outline，导入过才显示）+ **编辑**；下行一行小字说明（格式；解析中改成「正在渲染缩略图… N%」，
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

## 精灵图（`pages/SpriteSheetPage.tsx`，分割 / 合并 / GIF）

- 侧边栏「工具 › 精灵图」（`ScissorsLineDashed`），地址 `#/slice`；公开工具、**纯本地**（不上传、不需要登录）。
- 页首左上角是**下划线 `Tabs`（分割 / 合并 / GIF）**，与「数据ID」同款；三个 tab 用 `hidden` 常驻挂载，
  切回来图片 / 帧序列还在，tab 记在 `tswui:spriteSheetTab`。
- 「合并」：工具条（导入多选 / 张数 / 输出尺寸 / 排列 `ToggleGroup` / 列数 / 间距 / 导出）+ 棋盘格预览 + 顺序列表（↑ ↓ ×）；
  「GIF」：工具条（导入 / 尺寸 · 帧数 · 循环 / 导出全部）+ 选中帧预览 + 帧缩略图条。
- **工具条与画布同一张卡**（没有独立的导入卡）：`size="sm"` 的**导入 PNG**（primary）+ 原图尺寸 +
  `[网格 | 框选]` `ToggleGroup`（`h-7`）+ 提示小字（容器 ≥820px 才显示）+ 右侧「缩放」`Select`（适应 / 50–800%，
  「适应」按宽高双约束）；整页可拖放（`data-testid="slice-drop"`）。
- 两栏（容器 ≥1100px 时右栏 **300px**，否则堆叠）：左「预览 canvas」（棋盘格底；网格按去重边界画细线、
  微调过的切片琥珀虚线、选中切片「聚光灯」+ 白晕主色框、左上角序号徽标；点击选中、方向键微调、
  框选模式拖出矩形新建切片），右栏**控件一律小号**（输入 `h-7`、按钮 `size="sm"`）：
  「切分设置」（行列 / 边距 / 间距 / 单元格尺寸 / 自动猜测 / 跳过全透明）+「切片 #n」
  （名称输入 + 72px 放大预览 + X / Y / 宽 / 高 + 微移四键 + 恢复 / 删除 + 导出）+「GIF 动画」
  （帧序列 chips + 加入 / 清空 + 96px 自动循环预览 + 帧间隔 / 循环 + 导出 GIF，≥2 帧才可导出）。
  下方整宽的「切片列表」横向滚动缩略图（点选 / 双击导出；命名过的在缩略图底部显示名字），
  统计「共 N 张 · 已微调 M 张 · 手动 K 张」放在标题行右侧（不单独占行）。
- 计算 / 微调 / 导出规则见 [`页面-精灵图.md`](页面-精灵图.md)。

## 指令页

- 没有顶部 tab：聊天已独立成页（见下节「聊天页」），本页只有指令编辑器。
- **输入框是聊天式卡片**（`components/Composer.tsx`，指令输入框与网页发言共用）：
  **输入在上、工具行在下** —— 工具按钮分两边：**左下角**是指令库 / 物品（`Library/BookOpen`，
  物品图标与侧栏「物品 ID」一致），**发送键左边**是收藏 / 历史（`Star/History`）；
  工具按钮是**方形**（`size-7 rounded-control`）、图标 `size-3`（比默认 `size-4` 小一号，视觉重量贴近输入文字），
  按钮组用 `p-1 -m-1` 给聚焦光圈留余量（`overflow-x-auto` 本来会把 2px 光圈上下切掉），
  右下一个主色圆发送键（「清空结果」在**顶栏最右**，见上节；工具行右侧只留给聊天页的发送相关按钮）。
  - 输入保持**单行横滚**（Enter 直接执行），`compact`（浮动终端）只是内边距/字号更小；
    桌面尺寸：输入行 `h-8`、工具 / 发送键 `size-7` / `size-8`，外壳 `px-2 py-1.5`。
  - **聚焦是外发光**：`focus-within:ring-[3px] ring-ring/25` + 边框变主色（不再用 `outline` 硬描边）；
    外壳外面留 `p-1`，光圈画在边框外面也不被相邻区域切掉。错误态（只能游戏内执行）同理换成 `destructive` 光圈。
  - 每个工具按钮**悬停 / 聚焦出 `Tooltip`**（`title` 不再用，避免和 Tooltip 重复）。
  - 点工具按钮：打开**工具弹框**并显示对应面板；当前面板的按钮高亮（`aria-pressed`）；
    开着弹框时点另一个按钮＝**直接换面板**（不是切 tab），再点同一个按钮收起。
  - 工具弹框（`components/command/CommandToolsDialog.tsx`）**不占页面宽度**：指令库 / 物品 / 收藏 / 历史四个面板都在里面。
    **弹框里没有 tab 栏**（已去掉：那行 tab 与左下角四个按钮重复，还白占 36px 高度），只渲染当前那一块；
    四个面板都是**单列**：「收藏」只显示**指令收藏**（搜索 + 批量删除 / 清空），
    物品收藏在「物品」面板（搜索为空时展示），合成记录收藏在「物品 ID → ⭐ 收藏」与聊天页（见下）。
    「物品 ID → ⭐ 收藏」的结果区左上角才是 **物品 / 合成表 / 常用** 三分类切换（见 [`页面-物品图鉴.md`](页面-物品图鉴.md)）。
    打开 / 换面板时焦点直接落在该面板的搜索框，选完 / `Esc` / 关掉后焦点回到指令输入框。
    面板外包一层 `p-1`：搜索框的聚焦光圈画在框外，贴着 `overflow-hidden` 的边会被切掉（两边像被剪断）。
  - 工具面板**就是 popover**（`ui/Popover.tsx`，不是居中弹框）：**宽度统一走
    `PANEL_POPOVER_WIDTH`（`w-[min(32rem,calc(100vw-1rem))]`，`ui/Popover.tsx` 导出的常量）**，
    与聊天页的「物品 / 合成表」弹框同宽，四个面板之间切来切去不会觉得宽窄在跳；
    以被点的那个工具按钮为锚点（隐形 `fixed` 锚点 = 按钮的 `getBoundingClientRect()`）`side="top" align="start"` 向上展开，
    碰撞检测会翻转 / 平移，高度吃 `--radix-popper-available-height`，不会跑出视口；
    **背景不变暗**、页面照常可操作，点外面 / `Esc` 收起（只是「挑一条指令 / 物品」，不需要打断操作）。
  - 面板内边距统一 `p-2`（指令库 / 物品 / 收藏 / 历史四个弹框、聊天页的物品弹框、合成记录收藏弹框都一致）；
    面板没有单独关闭按钮（点外面 / `Esc` 即可）。
  - **页面快捷键 `/`**：焦点不在输入框 / 弹框里时敲 `/` 直接聚焦指令输入框（空草稿顺手补一个 `/`，
    补全下拉立刻列全部指令；草稿非空则只聚焦、不改内容）。弹框开着时 `/` 留在弹框的搜索框里。
- 指令库在指令页的工具面板里（`CommandPickerPanel`，点一条填进页面输入框），开关是输入框左下角的「指令库」按钮。
  - **一条指令就是一行**：指令名（等宽体，`max-w-[40%]` 截断）+ 说明（占满剩余宽度、`truncate`），
    hover / 聚焦出 `Tooltip` 显示完整说明（不再用原生 `title`，也不再把说明折到第二行）。
  - 两个分组「**全部指令（n）**」「**游戏内指令（n）**」**都可折叠**（箭头在标题右侧）；
    标题在滚动区里 **`sticky top-0` 吸顶**（吸在搜索框下面那一行，带 `bg-popover` + 细分隔线），
    滚到「游戏内指令」时它顶掉上面那个标题。搜索时两个分组都自动展开。
  - `allowServer=false` 的指令**不再挂「游戏内」badge**：指令名直接用 `text-destructive`（红色）区分。
- 补全下拉框里的指令候选压成一行：**指令 / 别名 · 说明 / 权限**横排（不需要权限的指令不写字、不占位），
  小屏或装不下时说明换行；同一屏能多看几条。下拉框有描边（`border-border/60`）。
  **行内不写语法**：语法只在顶部帮助条里（否则同一条的用法 / 说明会在上下两行各出现一次）。
- 下拉框**顶部有一条「指令帮助」条**（`role="note"`，在滚动区之外，输入框的 `aria-describedby` 指过去）：
  敲指令名时预览 ↑↓ 高亮那条的**完整用法**（说明留在候选行，不重复）；进入参数区后显示当前形态的用法 + 备注，
  并把**正在填的参数**标成主色
  （如 `/accountinfo <username>`）。不可点、不参与 ↑↓ 高亮；参数位没有值候选时也不空着。
  **指令页不再有输入框上方那行用法小字**（已并入这里）。见 [`功能-指令多级补全与备注.md`](功能-指令多级补全与备注.md) §6。
- 下拉框**只在输入框有内容时才弹**（空着点一下 / 聚焦都不弹）；别名排在说明**前面**且不带「别名：」前缀，
  如 `/accountinfo /ai · 显示一个用户的信息。`。
- **每条结果是一张 `Card`**（`Card` + `CardHeader` + `CardBody`，不再是从前那种「点头部折叠」的手风琴）：
  标题行 `CardTitle` 是指令本身（`font-pixel text-sm` 等宽体，异常状态标红，可鼠标选中复制，
  超长用原生 `title` 提示全文）；右侧是执行时间 + 三个 24px 图标按钮 + 一个折叠箭头，
  **整行高 24px ≈ 指令文字高度**，不再被按钮撑高；富文本框内边距 `p-2`（右侧留 `pr-9` 给复制按钮）。
  - 三个操作按钮都是 `IconAction` 风格的自研 `ResultAction`（`Button size="icon"` + `Tooltip`，
    不写原生 `title`，避免两个提示叠在一起）：**填充指令**（终端图标，把这条指令填回输入框、**不执行**）/
    **收藏**（仅执行成功的结果显示，`aria-pressed` 表示状态）/ **删除**（提示与 aria-label 就是「删除」两个字）。
  - **折叠是单独的箭头按钮**（`ChevronDown`，`aria-expanded`，提示为「折叠 / 展开」）：表头本身**不可点**，
    因为指令文字要能拖选复制；`collapsed` 存在 `ResultEntry` 里随结果持久化（`useCommandResultsList.toggleCollapse`），
    切走再回来仍是折叠的。折叠时只留标题行（异常标红仍在标题上），且箭头**常显**
    （否则得先 hover 卡片才能展开回来）；展开时它跟其它操作一起 hover / 聚焦淡入。
  - 顶栏**有**「展开全部 / 折叠全部」：有结果才出现，无可展开 / 无可折叠时对应按钮禁用
    （`IconAction` + `Tooltip`，`useCommandResultsList.setAllCollapsed`）；清空结果排在它们右边（顶栏最右）。
  > 覆盖 `Button size="icon"` 的尺寸要**连 md 断点一起写**（`size-6 md:size-6`）：变体自带 `md:size-9`，
  > 只写 `size-6` 在桌面仍会变回 36px。
- 结果区**整页滚动**（见下节「整页滚动」）：结果多了就把页面撑高，滚动条是浏览器右侧那条；
  输入框（`Composer`）`sticky bottom-0` 钉在视口底部。仍**自动贴底**——执行后新结果直接出现在可见区底部，
  富文本（服务器返回后才有的内容）变高也继续跟随；用户手动往上翻看旧结果时不打扰
  （`ResultPanel` 的 `pageScroll` 开关把贴底跟随 / 加载更早改作用在 `<main>` 上）。

## 整页滚动（pageScroll）

「指令 / 聊天 / 指令小抄 / 物品 ID / 数据 ID」是**整页滚动**的页面：页面**不固定高度**，内容多就把页面撑高，
滚动条是浏览器右侧那条（AppShell 的 `<main>`），页面里**不再嵌**滚动区。

- 清单在 `lib/pageScroll.ts` 的 `PAGE_SCROLL_TABS`；`AppShell` 据此给 `<main>` 加
  `[scrollbar-gutter:stable]`（切筛选后内容变短、滚动条消失时，整列不会左右跳 8px）。
- **滚动位置属于页面**：切页后 `<main>` 会保留上一页的位置，所以每个页面挂载时都要复位或还原：
  - 无记忆的页面：`usePageScrollReset()`（指令小抄）；
  - 有记忆的页面：用 `usePageScroller()` 的 `scrollToTop()` / `scrollTo(上次位置)`（物品 ID / 数据 ID）；
  - 只拿一屏高当 `min-height` 的页面（指令）：`usePageHeight` 仍可用（它同时会复位滚动），
    但只写 `minHeight`，**不要**写 `height`。
- **吸顶 / 吸底用 `sticky`**：顶栏高度是 48px（`h-12`），页面内的工具条用 `sticky top-12`；
  再往下的 sticky（表头、分组侧栏）用 `--page-sticky-top`（`useStickyHeaderOffset()` 实测「48 + 工具条高度」写进页面根元素），
  写成 `top-[var(--page-sticky-top,0px)]`，这样工具条换行变高时表头也跟着走。
- **虚拟化要换宿主**：网格自己不再溢出滚动，所以 `scrollTop` / 可视高度都从宿主上取
  （`usePageScroller()` 返回 `host` / `offsetTop` / `viewportHeight` / `scrollTop`），
  `main.scrollTop` 要减掉「网格顶部在页面内容里的偏移」才是列表内位置。
- **全屏**（物品 ID / 数据 ID）时页面自己变成滚动区（`fixed inset-0 overflow-y-auto`），
  用 `usePageScroller(ref, { host: rootRef.current })` 显式指定宿主，`--page-sticky-top` 置 0。
- 贴底跟随 / 回到底部 / 加载更早这类「作用在滚动容器上」的逻辑都走 `useBottomList` 的 `scroller` 选项
  （`ServerFeedList` / `ResultPanel` 的 `pageScroll` 开关）。

## 聊天页（`pages/ChatPage.tsx`）

- 侧边栏首组，**紧跟「指令」下一行**（图标 `MessageCircle`），地址 `#/chat`；原来是指令页顶部的「聊天」tab。
- 整页 = **服务器动态列表（`ServerFeedTab`）+ 吸底网页发言框（`WebChatInput`）**：
  页面**不固定高度**（`usePageHeight` 只用来给根元素 `min-height`）：内容少时刚好一屏，内容多时由 AppShell 的 `<main>`
  整页滚动，**滚动条在浏览器右侧**（不再是嵌在列表里的那条）；输入区 `sticky bottom-0` 钉在视口底部，
  手机端带 `env(safe-area-inset-bottom)`。规则见上节「整页滚动」。
- 列表**不包 `Card`**（省下卡片边框与内边距），有新事件就停在最新一条（`followNewest`，滚的是 `<main>`）；
  `ServerFeedList` 的 `pageScroll` 开关负责把贴底跟随 / 回到底部 / 加载更早全部改作用在 `<main>` 上。
- 筛选 chips（全部 / 进服 / Boss / 事件 / 旅商 / 聊天）在**输入框正上方那一行**（靠左）；
  世界状态徽标（困难模式 / 血月 / 日食 / 下雨 / 入侵，最多 5 个）在**它的上一行、单行靠左**。
  刷新一簇（上次刷新文案 + 刷新按钮）与浮动终端入口都在**输入框发送按钮左边**（同一工具行）；
  顶栏在这页不再重复放终端按钮（`App` 里 `activeTab !== 'chat'` 才显示）。
- 发言草稿存 `tswui:chat:draft`：切到别的页面再回来，没发出去的内容还在。发言成功后立刻刷新事件流。
- 输入框**左下角**有两个按钮（并列，弹框宽度都走 `PANEL_POPOVER_WIDTH` = `w-[min(32rem,calc(100vw-1rem))]`；
  两者与指令页工具按钮同一套规格：`size-7 rounded-control` 方形小按钮 + `[&_svg]:size-3` 图标）：
  - **物品**（`components/ItemPickerPopover.tsx`）：点开是搜物品的 popover
    （`ItemSearchPanel` 的 `tagOnly` 模式，没有 tab 栏、没有「ID / 名称 / 标签」选择），
    点一条就把 `[i:ID]` **追加到输入框末尾**，并把光标交回输入框（`focusRequest`）。搜索为空时展示物品收藏。
  列表行**不描边**（`focus-visible:ring-0`）：键盘高亮 / 选中只用**更深的底色**（`bg-foreground/10`）表示，
  未选中行 hover 是 `bg-foreground/5`。
  - **合成表**（`components/RecipeFavoritesPopover.tsx`，`Hammer` 图标）：点开是收藏过的合成记录
    （`tswui:recipeFavorites`，**最近收藏的在最上面**），**点一条就填进输入框**，用的是**只用 `[i:ID]` 标签**的文本：
    `[i:126][i:315][i:314][i:13] @ [i:31] -> [i:296]`（材料连写、`@` 制作站、`->` 产物、不带名称与数量；
    徒手制作没有 `@` 段，反向微光记录是 `[i:产物] @ [i:5362] -> [i:材料]…`）—— 聊天里只有标签能显示成物品图标。
    草稿非空时自动补一个空格，填完收起弹框并把光标交回输入框。**没有「清空」按钮**；
    是否显示物品名称跟随「物品 ID → 页面设置 → 合成记录 → 显示物品名称」，固定单列；
    内容区外面再包一层 `p-1`，条目的 hover 光圈 / 浮起不会被裁掉。
- **页面快捷键 `/`**：焦点不在输入框 / 浮层里时敲 `/` 直接聚焦发言框（聊天不是指令，**不补 `/` 字符**）。
- 发言**成功**的反馈走全局 sonner 提示条（`已发送（显示为 [WebUI] hf）`，见「组件清单」的 Toaster）：
  堆叠、可单条关闭、4 秒自动消失；**失败**仍是输入框左下角（工具行左侧）红字 + 「重试」。
- 未登录只显示 `LoginGate`（不拉事件流）；事件流细节见 [`功能-服务器动态.md`](功能-服务器动态.md)。

## 指令小抄（`pages/CommandTipsPage.tsx`）

- 侧边栏「工具」分组，**紧跟「数据 ID」下一行**，图标 `ScrollText`，地址 `#/commands`。
- **没有顶部 tab**：**左边搜索框 + 表格，右边分组列表**（`lg` 起常驻，窄屏收进 `Drawer`）。
  分组定义在 `lib/commandTips.ts` 的 `TIPS_GROUPS`（世界 / NPC / 物品 / 增益 / 生命 / 传送 / 建筑 / 用户 / 服务器 / 聊天，共 24 组）。
- 行分两种：**具体指令行**（操作列的终端按钮填浮窗）与**参考行**（内置指令的语法，带占位符 → 只给复制按钮，
  `allowServer=false` 的备注列标「仅游戏内」）；参考行语法来自 `data/commands.json` 的 `paramSets`。
- **行本身不响应单击**（防误触）：最后一列是**操作**（终端 / 复制 + **详情**）。
  点详情打开右侧抽屉：规范写法（这一类指令怎么写，如 `/worldevent <事件>`）、分组、权限、能否网页执行、TShock 说明、别名。
- 搜索会清掉分组筛选；分区过滤规则是「有命中的行，或分区自身命中」，只有语法 / 说明的分区不会被误伤。
- **两个 tab 都是「一张可搜索的表」**（`SearchInput` + `CommandTable`）：分类与语法说明各占一行内置行，
  不参与点击填入（不是指令）；数据行点一下即填进浮窗。
- **表格不在卡片里，也不自己滚**：整页交给 AppShell 的 `<main>`（见「整页滚动」）；
  搜索框 + 分组按钮那一行 `sticky top-12` 吸在顶栏下面，表头再吸在它下面
  （`top-[var(--page-sticky-top,0px)]`）；桌面端右侧分组列表 `lg:sticky`，自己内部仍可滚（最多一屏高）。
- **指令列有最大宽度**（手机 11rem / `sm` 16rem / `xl` 22rem）：手机上换行不溢出，宽屏单行截断，
  悬停弹 `Tooltip` 看完整指令。
- 页面公开：不需要登录，也不依赖插件。
- 执行失败原因显示在**富文本下方的 `Alert`**（指令不存在 = warning，权限/执行错误 = destructive）。

## 物品给予指令

- 物品详情新增「物品给予指令」（`CommandLine` 两行样式）：`/give <物品ID> <玩家名>`；
  选了词缀时 `/give <物品ID> <玩家名> 1 <词缀ID>`。未登录不显示。

## 变更记录

历史变更（v1.2 → v1.53，含组件新增 / 重命名 / 布局改版）见
[`记录-改版日志.md`](记录-改版日志.md#ui-组件v12--v153)。本文件只写**当前**组件清单与使用约定。
