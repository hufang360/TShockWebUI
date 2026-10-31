---
name: TShockWebUI
description: Terraria TShock 玩家的 Web 指令伴侣——暗色、密集、可点的随身工具台
colors:
  midnight-canvas: "oklch(0.129 0.042 264.695)"
  graphite-surface: "oklch(0.208 0.042 265.755)"
  slate-raised: "oklch(0.279 0.041 260.031)"
  paper-white: "oklch(0.984 0.003 247.858)"
  slate-muted: "oklch(0.704 0.04 256.788)"
  hairline-dark: "oklch(1 0 0 / 10%)"
  day-canvas: "#ffffff"
  day-sidebar: "#fafafa"
  day-ink: "oklch(0.22 0.015 264)"
  grass-green: "oklch(0.723 0.192 149.579)"
  amber-warning: "oklch(0.828 0.189 84.429)"
  signal-blue: "oklch(0.707 0.165 254.624)"
  ember-red: "oklch(0.704 0.191 22.216)"
  arcane-purple: "oklch(0.72 0.2 300)"
typography:
  page-title:
    fontFamily: "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  card-title:
    fontFamily: "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.43
    letterSpacing: "0.025em"
  body:
    fontFamily: "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  dense:
    fontFamily: "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.67
  meta:
    fontFamily: "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "ui-monospace, 'SFMono-Regular', 'Menlo', monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  chip: "4px"
  control: "8px"
  menu: "12px"
  container: "16px"
  modal: "24px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
components:
  button-primary:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.graphite-surface}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.slate-raised}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-outline:
    textColor: "{colors.paper-white}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-ghost:
    textColor: "{colors.paper-white}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "28px"
  badge-success:
    backgroundColor: "{colors.grass-green}"
    textColor: "{colors.midnight-canvas}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-warning:
    backgroundColor: "{colors.amber-warning}"
    textColor: "{colors.midnight-canvas}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  card:
    backgroundColor: "{colors.graphite-surface}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.container}"
  input:
    backgroundColor: "{colors.slate-raised}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  sidebar-item-active:
    backgroundColor: "{colors.slate-raised}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "32px"
---

# Design System: TShockWebUI

## Overview

**Creative North Star: 「玩家的工具台」**

这不是一个管理后台，是玩家手边摊开的一件工具：暗底、紧凑、处处可点。屏幕的大部分面积属于**数据**
（世界信息、背包、指令结果、物品网格），颜色和装饰一律退让，让绿色只用来回答一个问题——「现在能不能用」。

Layout 上它像终端：内容区顶栏只看得到当前页码和页面操作，左侧一条可收起的窄导航，
中间一栏是内容，需要对照时右侧再开一列工具。所有会让玩家「边看边点」的东西都贴着手指走——
输入框永远在底部，结果从顶端开始堆，不居中、不浮动。

「像素游戏感」只出现在**内容**里，不进结构：物品 / NPC / Buff 图标直接用游戏图集（版权属 Re-Logic），
物品提示框复刻游戏内观感（半透明黑底、按稀有度着色），计数角标用等宽像素字体。
框架本身仍是扁平的 shadcn 表面——圆角、细边框、色阶分层，没有一个投影在静止状态出现。

**Key Characteristics:**
- 暗色为默认，亮色是同构的第二套（画布纯白 / 侧栏 `#fafafa`）。
- 密度优先：页面间隙 8px 为基准，卡片内边距 8–12px，控件高度 28–36px。
- 彩色只做信号（在线 / 警告 / 演示 / 破坏性 / 配方），不做品牌装饰、不做色块背景。
- 深度靠边框与色阶，不靠投影；投影只属于浮层。
- 等宽字体只给「指令、ID、计数」，不用来营造技术感。

## Colors

暗色石板打底、近白作主色、五个语义色各管一件事。

### Primary
- **近白 Paper White**（`oklch(0.984 0.003 247.858)`）：暗色下的主按钮底色与正文色。主行动不是绿色，而是「最亮的那一块」——玩家一眼能找到发送键，而不是先学会品牌色。
- **石墨墨色 Day Ink**（`oklch(0.22 0.015 264)`）：亮色下的主按钮底色与正文色。亮色模式刻意**不用**绿色作主色，绿色只保留给状态。

### Secondary
- **抬升石板 Slate Raised**（`oklch(0.279 0.041 260.031)`）：输入框底、次级按钮、悬浮项（hover / 侧栏选中）；比卡片亮一档，用来表达「可交互」。
- **石墨表面 Graphite Surface**（`oklch(0.208 0.042 265.755)`）：卡片、弹层、侧栏的底色，暗色下与页面底形成第一层色阶。

### Tertiary
- **草绿 Grass Green**（`oklch(0.723 0.192 149.579)`）：唯一代表「好」的颜色——服务在线、执行成功、已安装。
- **琥珀 Amber**（`oklch(0.828 0.189 84.429)`）：需要注意但不阻塞（困难模式、下雨、限流提示、金色收藏星）。
- **信号蓝 Signal Blue**（`oklch(0.707 0.165 254.624)`）：信息与演示标注（`Mock` 徽标就是它）。
- **余烬红 Ember Red**（`oklch(0.704 0.191 22.216)`）：破坏性操作与失败；永远带文字，不只靠颜色。
- **奥术紫 Arcane**（`oklch(0.72 0.2 300)`）：只在合成表标记「需要微光分解」这类游戏机制，不挪作装饰。

### Neutral
- **午夜画布 Midnight Canvas**（`oklch(0.129 0.042 264.695)`）：暗色页面底，比卡片深一档，让卡片像「放在桌面上的东西」。
- **石板灰 Slate Muted**（`oklch(0.704 0.04 256.788)`）：次要文字的上限——时间戳、标签、说明；**不允许再叠加透明度压暗**。
- **发丝线 Hairline**（`oklch(1 0 0 / 10%)`）：暗色边框；亮色用 `oklch(0.929 0.013 255.508)`。
- **白昼画布 Day Canvas**（`#ffffff`）/ **侧栏 `#fafafa`**：亮色下用灰阶拉开侧栏与画布，不靠投影。

**The Signal-Only Color Rule.** 绿 / 琥珀 / 蓝 / 红 / 紫只出现在状态与游戏机制上。它们不足以构成品牌色，也永远不被用来铺背景、做渐变或标记「重要」——「重要」由字号、字重和位置承担。

## Typography

**Display / Body Font:** `system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif`
**Label / Mono Font:** `ui-monospace, 'SFMono-Regular', Menlo, monospace`（令牌 `--font-pixel`）

**Character:** 一个家族、五档角色。中文优先意味着字的**边界感**比个性重要：系统字体在 Win/Mac/iOS 上的苹方、微软雅黑、San Francisco 都能保证中文不糊、标点不塌。等宽只在「这是一串机器能读懂的东西」时出现——指令、ID、计数——而不是给标题加科技感。

### Hierarchy
- **Page Title**（600，`16px`，1.5）：内容区顶栏的当前页面名，**全站唯一一处页面名**。
- **Card Title**（600，`14px`，1.43，`tracking-wide`）：卡片与分区标题；带图标时图标固定 16px。
- **Body**（400，`14px`，1.5）：表单值、说明、`dd` 值。
- **Dense**（400，`12px`，1.67）：世界信息列表、表格、标签等密排数据。
- **Meta**（400/500，`11px`，1.5）：时间戳、计数、脚注；行高由令牌统一，调用处不再覆盖。
- **Mono**（400，`12–15px`，1.7）：指令输入框、指令 chips、ID、图标角标。

**The One Page Title Rule.** 页面名只在内容区顶栏出现一次；内容区里不再重复同一句话当标题。标题的层次由 16px 与 14px 的**台阶**承担，不靠 18px 以上的大字号。

**The 11px Floor Rule.** 11px 是最小字号，且必须是完整的 `muted-foreground`——不得再用 `/70`、`/60` 压暗（暗色下会掉到 3.5:1）。会变化或需要纵向对齐的数字一律 `tabular-nums`。

**The Language Clock Rule.** 时间格式跟**界面语言**走，不跟操作系统走（中文 24 小时制，不带 `AM`）；统一走 `lib/clock.ts`。

## Layout

侧栏 + 内容区两栏骨架。侧栏 `16rem`（收起为 `3rem` 图标栏，移动端抽屉 `18rem`），内容区顶栏高 `48px`
吸顶不滚走，页面内边距 `12px/16px`（≥768px 变 `24px`）。

- **紧凑视图**（默认开）给内容区加 Bootstrap 式容器：`max-w-xl → md:max-w-3xl → lg:max-w-5xl → xl:max-w-6xl → 2xl:max-w-7xl` 居中；关掉即通栏。
- **列数由容器宽度决定，不看视口**：内容区带 `@container`，页面用容器查询（`@sm:` / `@[260px]:`）决定是否分栏，这样侧栏展开/收起与紧凑模式的宽度都能被正确考虑。
- **页面分栏**：首页 `xl:grid-cols-[minmax(0,1fr)_360px]`（左指令卡 / 右概览）；指令页按同一比例分「工作区 / 工具面板」。
- **节奏（4px 网格）**：所有 padding / gap / margin 都是 **4px 的整数倍**——4 / 8 / 12 / 16 / 24 / 32。
  `8px`（`gap-2`、`p-2`）是基准节奏；12px 用于分区内部，16px 用于分区之间。卡片内边距 `8–16px`，卡片之间 `8px`。
  不要写 `gap-1.5`(6px)、`px-2.5`(10px)、`py-3.5`(14px) 这类半格值——差 2px 会在密集列表里累积成对不齐的缝。
- **2px 例外**：只有「贴着文字的光学微调」允许 2px（`*-0.5`）——提示文字与图标之间的 `gap-0.5`、
  行内标签的 `py-0.5`、把图标往上挪 1px 的 `mt-0.5`。它们是校正，不是节奏，所以不进网格。
- **页面级操作放内容区顶栏右侧**（刷新、管理、清空、面板开关），不占正文表头；正文从第一行就是内容。
- **空态**：不画边框、不居中成一块「岛」。主工作区（指令结果）的引导块在工作区居中，输入框始终贴底——空态与有结果时输入框位置一致。
- **移动端**：侧栏变抽屉，触控目标放大（按钮 `h-9`、图标按钮 `40px`，≥768px 才回到 `h-7` / `36px`）；页面内多段内容改为单列，工具面板以抽屉/Sheet 形式叠加。

## Elevation & Depth

**扁平 + 边框 + 色阶。** 静止状态下没有一个投影：卡片靠 `border`（暗色 `oklch(1 0 0 / 10%)`）与比页面亮一档的底色
浮起来；亮色靠纯白画布 + `#fafafa` 侧栏拉开层次。压缩高度时不增投影，只调色阶。

投影是**浮层专属**的语言：只有真正离开了文档流的东西才投影，而且档位固定——菜单 / 浮层 / 下拉 `shadow-lg`，
模态、抽屉、Sheet `shadow-2xl`，滑块与开关的旋钮 `shadow-sm`。卡片永远不用 `shadow-sm`。

### Shadow Vocabulary
- **`shadow-lg`**：DropdownMenu、Popover、Select 内容区——贴着触发器的临时层。
- **`shadow-2xl`**：Dialog、Sheet、Drawer——整块盖住页面的层，用强投影+遮罩说明「下面的东西暂时不属你」。
- **`shadow-sm`**：Slider 滑块、Switch 旋钮、选中的页签 / 分段（被选中的那一格从底色里浮起 1px）——只用在「同一容器内有东西被选中」的场合，不用于卡片。

**The Flat-By-Default Rule.** 页面与卡片在静止态永远是平的。看到投影，就该问一句：它是不是浮层？不是就删掉。

## Shapes

圆角只有**五档**，按「由外到内」同心缩小：**r = R − p**。同一个圆心，内外两条曲线才平行。

| 档位 | 令牌 | 值 | 内边距 | 里面装的是 |
| --- | --- | --- | --- | --- |
| 模态 | `rounded-modal` | `24px` | `16px` | 弹框 / 抽屉（Drawer，四边）→ 里面的按钮与输入框 |
| 容器 | `rounded-container` | `16px` | `8px` | 卡片 / 浮层 / 提示块 → 里面的控件 |
| 菜单 | `rounded-menu` | `12px` | `4px` | 菜单 / 下拉 / Tabs 容器 → 菜单项 |
| 控件 | `rounded-control` | `8px` | `4px` | 按钮 / 输入框 / 菜单项 → 角标、Kbd |
| 角标 | `rounded-chip` | `4px` | — | Kbd、勾选框、行内小标记（最小档） |

- 24 − 16 = 8、16 − 8 = 8、12 − 4 = 8、8 − 4 = 4：**每一层都对得上**，最小不低于 4px。
- 全部落在 4px 网格上；不存在 10px、14px 这种「差 2px」的值。
- 组件里一律写角色令牌（`rounded-container` 等）；`rounded-sm/md/lg/xl/2xl` 只是迁移期的兼容别名（已重映射到 4/8/8/16/24），新代码不要再用。
- 药丸与正圆**永远是 full**：`Badge`、`Switch`、`Slider`、圆形图标按钮、指令输入条。
- 边框统一 1px，颜色来自 `border` 令牌；不出现 2px 描边，也不出现彩色 `border-left` 装饰条。
- 贴着视口边缘的面板（`Sheet` 侧栏 / 移动端导航抽屉）保持**直角**：它有一边贴着屏幕边，没有完整外轮廓，
  硬加圆角只会在贴边处露出一条缝。这是「模态 24」唯一的例外。
- 卡片不嵌套卡片；需要分组时用间距与 1px 分隔线（`Separator`）。
- 像素感只来自内容资产（游戏图集图标）与等宽数字，不用像素边框、不用像素阴影。

**The Concentric Corner Rule.** 任何**容器 / 控件**的圆角不得超过「外框圆角 − 内边距」——超过了就会在角落拱出来；小于等于都安全，同级半径相同，五档之外不新增值，最小 4px。内容缩略图（玩家头像、物品 / NPC 图标、图格）按自身形状取圆角，不受此约束。

**The Continuous Corner Rule.** 圆角用**连续曲率**（squircle）：`@supports (corner-shape: superellipse(1.25))` 里给所有元素加 `corner-shape: superellipse(1.25)`，药丸与正圆例外（`corner-shape: round`，否则胶囊会被拉成软方角）。Chrome / Edge 139+ 直接生效；Safari 与 Firefox 跳过该块，用普通 `border-radius` 渲染——同一份圆角的两种画法，不是降级 hack。

## Components

### Buttons
- **Shape:** 控件圆角（10px），图标按钮正圆。
- **Primary:** 近白底 + 石墨字（暗色）/ 石墨底 + 白字（亮色）；高 36px（`md`）、28px（`sm`）、44px（`lg`）。
- **Hover / Focus:** `hover` 只改底色（主色 90% / 次级 80%），不做位移与缩放；焦点环 `ring-2 ring-ring`，环色随主题。
- **Secondary:** 抬升石板底，用于「打开指令库」这类次一级动作。
- **Outline / Ghost:** 描边版用于并列选项，Ghost 用于 chips、最近指令、表内动作。
- **Danger:** 余烬红底，仅用于不可逆操作，且必须配二次确认（`ConfirmButton`）。

### Chips
- **Style:** 圆角 full，`11px`/500，`padding 2px 8px`，底色是语义色的 15% 透明版、字用语义色本身（如 `success` 徽标：绿字绿底）。
- **State:** 只用一档，没有选中态——它们表达状态，不是筛选器。筛选器用 `ToggleGroup` 或 `Tabs`。

### Cards / Containers
- **Corner Style:** 14px。
- **Background:** 石墨表面（暗）/ 纯白（亮）。
- **Shadow Strategy:** 无（见 Elevation & Depth）。
- **Border:** 1px 发丝线。
- **Internal Padding:** `8px`（`CardHeader` 紧凑）与 `12px`（`CardBody`）。

### Inputs / Fields
- **Style:** 无描边，拾起 `slate-raised` 底；高 36px（工具栏里的紧凑版 28px）。
- **Focus:** `ring-2 ring-ring`，不加发光、不动边框色。
- **Error / Disabled:** 错误用 `ring-destructive/60` + 红字；禁用降透明度 50%，不换色。
- **表单结构:** 一律 `FieldGroup` + `Field`（标签 / 说明 / 控件），不手写 `div` + `label`。

### Navigation
- **Style:** 侧栏 `16rem`，分组标题 `11px`/500/`70%` 石板灰；导航项 `14px`，高 32px，圆角 8px。
- **State:** 选中项底色 `slate-raised` + 正文色；hover 同色但更浅；图标 16px 左对齐，文字超出截断。
- **Mobile:** 收进 Sheet 抽屉（`18rem`），点选后自动关闭；内容区顶栏左侧出现汉堡按钮。

### Command Composer（签名组件）
页面底部的指令输入条：全圆胶囊、等宽字体、行高 1.7，右侧一个正圆发送键。它是全站唯一「永远贴底」的组件——
空态与有结果时位置不变，执行后输入框清空，↑ 回翻历史，`Enter` 执行。补全浮层从输入框**向上**展开
（`bottom-full`），因为它总是贴着屏幕底边。

## Do's and Don'ts

### Do:
- **Do** 让颜色只回答「能 / 不能 / 注意」：状态用语义令牌 `success` / `warning` / `info` / `destructive` / `purple`。
- **Do** 用 8px 基准做间隙，间距一律落在 4px 网格上（4/8/12/16/24），靠**间距**分组，靠 1px `Separator` 分隔。
- **Do** 让数字对齐：会变化的计数、时长、ID 一律 `tabular-nums`；ID 与计数用等宽字体。
- **Do** 给每个页面一个 16px/600 的顶栏页面名，并且只给一次。
- **Do** 页面级操作放内容区顶栏右侧，正文第一行就是内容。
- **Do** 图标一律 lucide、`stroke` 一致、16px，进按钮用 `data-icon`。
- **Do** 用同心圆角：外框 24 / 容器 16 / 菜单 12 / 控件 8 / 角标 4，药丸保持 full；内边距变了就重算里面那一层。

### Don't:
- **Don't** 给卡片加投影，或用投影表达「层级更高」——层级用色阶与边框。
- **Don't** 用绿色当品牌色或主按钮色；绿色只表示成功与在线。
- **Don't** 在 11px 文字上再叠 `/70`、`/60` 透明度（暗色会低于 4.5:1）。
- **Don't** 用 `chart-1..5` 冒充状态色（明暗含义不一致），也不要在内容区重复页面名。
- **Don't** 用 emoji / Unicode 字符代替图标，也不要引入像素边框、像素阴影来「做游戏感」。
- **Don't** 手写空态、加载态、提示块：用 `Empty` / `Skeleton` / `Alert`。
- **Don't** 用行内样式或任意值字号（`text-[13px]`）绕过上面这套角色。
- **Don't** 写 10px / 14px 这类「差 2px」的圆角和间距（`px-2.5` / `py-3.5` / `gap-1.5`），2px 只留给 `*-0.5` 光学微调；也不要给 `rounded-full` 的元素套 `corner-shape`。
