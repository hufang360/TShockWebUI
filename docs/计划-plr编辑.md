# 计划 · `.plr` 编辑（玩家存档 → 编辑并另存）

> 状态：**已实现（2026-10-26）**，范围变更已登记在 [`设计原则与约束.md`](设计原则与约束.md) §2.1。
> 实现与验收见 `docs/记录-实现与验收.md`；§8 的待确认项已按用户「你先做」的指示取推荐值落地。

## 0. 一句话方案

**在浏览器里解密 → 只改动用户编辑的那几个定长字段 → 原样重新加密 → 下载新文件**。
不重写序列化器、不重排文件、不上传服务器：**解密后的明文**与原文件除了被改的字节外完全相同，文件长度也不变。
（注意 CBC 雪崩：改一个块会让它之后所有**密文**块都变，这是加密性质，不是内容变多。）

## 1. 需求（用户点名要能改的项）

| 项 | 存档字段 | 说明 |
| --- | --- | --- |
| 生命 | `statLife` / `statLifeMax` | 当前值 + 上限（只改当前值意义有限，建议一起放开） |
| 魔力 | `statMana` / `statManaMax` | 同上 |
| 渔夫任务 | `anglerQuestsFinished`（≥98） | 整数 |
| 版本 | `release`（文件头 int32） | 见 §6，**结构性问题**，需先确认范围 |
| 模式 | `difficulty`（≥17，1 字节） | 0 软核 / 1 中核 / 2 硬核 / 3 旅途 |
| Golf 分数 | `golferScoreAccumulated`（≥206） | 整数 |
| 背包物品 | `inventory[58]`：`id` int32 / `stack` int32 / `prefix` u8 / `favorited` bool（≥114） | 数量与词缀都要校验 |
| 永久增强 | `extraAccessory`、`unlockedBiomeTorches`、`unlockedSuperCart`、`ateArtisanBread`、6 个 `used*` | 与页面 `PERMANENT_BOOSTS` 一致 |

**明确不做**（本阶段）：装备 / 银行 / 配装槽位、研究进度、外观颜色、发型、声音、退款队列、一次性对话。
这些字段的原始字节**原样保留**，编辑器不碰。

## 2. 事实核对（都来自 1.4.5.8 反编译源码，路径已注明）

### 2.1 加密与写回

- 读：`Terraria/Player.cs:55724 LoadPlayer` —— `RijndaelManaged { Padding = PaddingMode.None }`，
  key 与 IV 都是 `ENCRYPTION_KEY`（`"h3y_gUyZ"` 的 UTF-16LE 字节）→ 与 `web/src/lib/save/aes.ts` 现有实现一致。
- 写：`Terraria/Player.cs:55409 Serialize` + `CreateEncryptor(...)`（默认 **PKCS7**）→ 文件末尾会多出 1~16 字节补位块。
  因为读取端是 `PaddingMode.None` 且 `BinaryReader` 读到最后一个字段就停，**补位块从来不参与解析**。
- 结论：**只要不改变明文长度**（我们只改 `int32` / `byte` / `bool`），把原文件末尾那些补位字节原样保留、
  用 `PaddingMode.None` 重新加密，就能得到「**明文**除改动处外完全相同、长度不变」的文件。
  - 单测钉死：`encrypt(decrypt(f)) === f`（逐字节）、`changedPlainOffsets()` 只命中被改字段的字节。
  - **CBC 雪崩**：密文从被改块起全部不同（每块用前一块密文做 IV），所以「密文 diff 很小」是错误的预期；
    正确的不变量在**明文**层面。
- 文件里没有校验和 / 签名 / 长度字段，因此不需要重算任何东西。

### 2.2 游戏会「自动纠正」非法值（所以必须前端先校验）

`Terraria/Item.cs:49493 FixAgainstExploit()`，在 `LoadPlayer_LastMinuteFixes` 里对**所有容器槽位**跑：

- `stack > maxStack` → 截到 `maxStack`；
- `prefix != 0 && !CanRollPrefix(prefix)` → 清零；
- `ItemID.Sets.ItemsThatShouldNotBeInInventory[type]` → 直接变成空气
  （1.4.5.8 的集合：`58, 184, 1734, 1735, 1867, 1868, 3453, 3454, 3455, 4143, 5013, 6135, 6136`）；
- 玩家属性：`statLifeMax > 500 → 500`、`statManaMax > 200 → 200`、`statMana > 400 → 400`（`Player.Deserialize`）。

也就是说写错不会炸档，但会被**静默改正**——所以这些限制我们必须在 UI 上一次说清，而不是让用户改完之后发现进游戏没变。

### 2.3 词缀合法性数据已经有了

`Item.CanRollPrefix(prefix)` = 「prefix ∈ `GetRollablePrefixes()`」（`Terraria/Item.cs:621`、`:1102`），
而 `data/prefix-sets.json` 就是 `tools/gamedump` 调用 `GetRollablePrefixes()` 导出的成品
（886 件物品、7 组去重集合），前端已加载成 `dataset.rollablePrefixesById`。
名字 / 效果：`dataset.prefixesById`（本地化名）+ `data/prefix-mods.json`（`lib/prefixes.ts` 的 `formatBenefit`）。
→ **词缀校验与展示零新增数据**。

### 2.4 物品数量上限没有数据（唯一缺口）

`Item.maxStack` 是运行时字段（`SetDefaults` 里赋值），我们的 `data/items.json` / `item-stats.json` 都没有它。
`ItemID.Count = 6195`（`data/items.json` 的 id 1..6195 连续）。

**方案**：给 `tools/gamedump` 增加一个轻量模式 `--item-limits <out>`，导出
`{ meta, maxStack: { [id]: int }, noInventory: [id...] }` → `data/item-limits.json`（约 60 KB）。
本机验证过 `GameDump.dll --tile-styles` 可跑（dotnet 10 运行 net9 产物 OK），加这个模式风险低。
前端进入编辑态时**懒加载**（同 `buff-atlas.json` 的做法），不进首屏 dataset。

### 2.5 编辑「矿车升级包」需要多读两段

`unlockedSuperCart` / `enabledSuperCart` 在 `release ≥ 253`，位置在**研究进度、4 个临时槽、旅途创意能力之后**：

- 研究进度（≥218）：`[bool 若 ≥282] + int32 条数 + 条数 ×(string 持久 ID + int32 数量)` —— 跳过即可；
- 临时槽（≥214）：`byte 位图` + 每个置位一个 `Item`（`Item.DeserializeFrom`：`int32 id + int32 stack + u8 prefix`，各 9 字节）；
- 创意能力（≥220）：`while (bool) { ushort id; payload }`，全游戏只有 3 个持久能力
  （`CreativePowers.cs` + `CreativePowerManager.Initialize` 的注册顺序）：**id 5 = Godmode(bool)、
  id 11 = FarPlacementRange(bool)、id 14 = SpawnRateSlider(float)**；未知 id 时游戏自己 `break`，我们也停。

顺带修一个现有小错：本地存档的 `unlockedSuperCart` 现在恒为 `false`（`plrToPlayerLook` 写死），
读到这里之后变成真值。

### 2.6 版本号（`release`）到底影响什么

`release` 只用于**条件解析**（`release >= N` 的字段门），没有任何校验和。源码里 `Deserialize` 的门槛共 59 个
（6,10,11,15,16,17,20,36,38,47,58,74,81,82,83,98,107,114,115,117,119,124,125,128,136,138,161,162,164,167,
181,182,197,198,199,200,202,206,210,214,218,220,229,230,249,252,253,254,255,256,260,262,280,281,283,300,310,322,324）。

**两个 release 之间的「布局」完全相同 ⟺ 它们落在同一段（相邻门槛之间）**：

| release | 同布局段 | 对应游戏版本（`playerVersions.ts`） |
| --- | --- | --- |
| 220–228 | `[220,228]` | 1.4.0.1 ~ 1.4.0.4 |
| 230–248 | `[230,248]` | 1.4.0.5 ~ 1.4.3.6 |
| 262–279 | `[262,279]` | 1.4.4 ~ 1.4.4.9 |
| 310–321 | `[310,321]` | 1.4.5.0 ~ 1.4.5.6 |
| 324+ | `[324,∞)` | 1.4.5.7 / 1.4.5.8（325、326 互改是安全的） |

所以：

- **同段内改数字 = 安全但基本没作用**（解析出的字段完全一样）；
- **跨段改数字 = 破坏**（多/少的字段没有数据，游戏会读偏，等于炸档）；
- **真正的「升级/降级存档」= 按目标版本重新序列化**，要补/删字段（比如降到 1.4.0 就没有研究进度、配装），
  属于「改写整份存档」，风险和收益都不划算。

## 3. 写回设计

### 3.1 数据流

```
File(.plr) --arrayBuffer--> Uint8Array --decrypt--> 明文 --parse（记录 offset 表）--> PlrPlayer + offsets
                                                                       │
                                           用户在 UI 上改字段（内存状态）│
                                                                       ▼
                    明文副本 --patch(offsets, 值)--> 新明文 --encrypt--> 新密文 --Blob--> 下载
```

- **offset 表**：`parsePlr` 增加「记录模式」（`parsePlr(data, { offsets: true })` → `{ player, offsets }`），
  每读一个可编辑字段时同时记下 `{ name, pos, size }`。
  - 好处：**不重写整份序列化器**；改动点精确、可断言（patch 前后 diff 只在预期块）。
  - 改 `release` 也必须走同一套：先确认目标 release **同段**，再改 4 字节。
- **不存明文到 localStorage**：解密的 `Uint8Array` 只活在页面内存里（与现有「文件不上传」一致），
  刷新即消失（与现在的「刷新页面清空上次导入」一致）。
- **加密**：`lib/save/aes.ts` 增加 `aes128CbcEncrypt(key, iv, data)`（与解密同一套 table/循环，`NoPadding`）。
- **下载**：沿用 `lib/playerPage.ts` 的 `downloadBlob`。文件名建议与原名相同（浏览器自动去重成 `xxx (1).plr`），
  用户自己覆盖原文件；`.plr.bak` 一律不碰（游戏自己会写）。

### 3.2 patch 的原子性

- 所有改动先在内存副本上应用；全部通过校验才产出文件（不会出现「改了一半」）。
- 「保存」= 生成并下载；页面上的预览同时更新成编辑后的数据（用户能立刻看到结果）。
- 「放弃修改」= 丢弃改动，回到导入时的状态（带一次确认，避免误点）。

## 4. 校验规则（UI 拦截 + 单测覆盖）

| 字段 | 规则 | 依据 |
| --- | --- | --- |
| `statLifeMax` | 100–500 的整数（推荐 20 的倍数，不强制） | 游戏上限 500（`Deserialize` 截断） |
| `statLife` | 0 ≤ 值 ≤ `statLifeMax` | 同上 |
| `statManaMax` | 0–200 | 游戏上限 200 |
| `statMana` | 0 ≤ 值 ≤ 400（允许保留原本的溢出值） | 游戏对 `statMana` 的上限是 400 |
| `anglerQuestsFinished` | 0 ≤ 值 ≤ 9999 | 计数器，给个荒谬上限 |
| `golferScoreAccumulated` | 0 ≤ 值 ≤ 2^31-1 | int32 |
| `difficulty` | 0–3；切到 2/3 时二次确认 | 枚举 |
| 物品 `id` | 0（空）或 1–6195 且 `dataset.itemsById` 有；命中 `noInventory` 列表拒绝 | `FixAgainstExploit` |
| 物品 `stack` | 空槽 = 0；非空 1 ≤ stack ≤ `maxStack[id]` | `FixAgainstExploit` 截断 |
| 物品 `prefix` | `prefix == 0` 或 ∈ `dataset.rollablePrefixesById[id]`；无该表 → 只能 0 | `CanRollPrefix` |
| `favorited` | 原样保留（编辑数量/词缀不改动它） | — |
| 永久增强 6+3 项 | 布尔勾选；`release` 不支持该字段的（如 226 没有 `ateArtisanBread`）**置灰并说明** | 字段门槛 |
| `release` | 仅同布局段可选（见 §2.6），其它版本置灰 + 原因 | 条件解析 |

## 5. UI 设计（shadcn/ui，遵循 `docs/UI组件.md`）

### 5.1 入口

- 「玩家存档」工具卡：导入 / 来个 Demo 右侧，`view &&` 时多一个 `Pencil` 按钮「编辑」（仅本地存档；「玩家管理」页不出现）。
- 点「编辑」→ 页面进入编辑态（同一页切换组件，不新增侧栏菜单）。

### 5.2 编辑态布局

```
[ 编辑存档 ]  ⚠ 本地文件不会被上传，保存后生成新文件由你替换
┌───────────── 角色（左：人物预览，右：表单）─────────────┐
│ 生命 [400] / 上限 [400]     魔力 [200] / 上限 [200]      │
│ 模式 [旅途 ▾]               版本 [1.4.0.2 ▾]（部分禁用）  │
│ 渔夫任务 [0]                Golf 分数 [0]                │
│ 永久增强 ☑恶魔之心 ☑火把神 ☐矿车 …                        │
└──────────────────────────────────────────────────────────┘
┌───────────── 背包（10×5 + 钱币/弹药 + 垃圾桶）────────────┐
│  点格子 → 右侧/弹窗编辑器：搜索物品 / 数量 / 词缀 / 清空    │
└──────────────────────────────────────────────────────────┘
[保存并下载 .plr]  [放弃修改]
```

- **表单控件**：数字用 `Input type=number` + `Label`；模式用 `NativeSelect`（或 `Select`）；版本用 `Select`
  （按 1.1.x / 1.2.x / 1.3.x / 1.4.x 分组，支持该段的才可点，其余 `disabled` 且带原因 tooltip）；
  永久增强用 `Checkbox` + 物品图标（复用 `ItemIcon`，与只读视图视觉一致）。
- **背包**：沿用现有 10×5 网格与槽位外观（`Slot` 的样式抽出共享），编辑态格子可点、hover 显示「点击编辑」；
  空槽显示 `Plus` 幽灵图标；有物品的格子右上角可「清空」。
- **槽位编辑器**：`Dialog`（桌面）/ `Drawer`（窄屏）—— 顶部搜索框（复用 `lib/items.ts` 的 `searchItems`），
  结果网格（`ItemIcon` + 名字），选中后出现「数量」「词缀」两个控件：
  - 数量：`Input` + 上限提示（`≤ maxStack`），超限立即红字并禁用保存；
  - 词缀：`Select`，选项 = 「无词缀」+ 该物品 `rollablePrefixesById` 的词缀（显示本地化名 + 效果摘要），
    不可上词缀的物品整体禁用并说明。
- **错误呈现**：字段下方一行红字（`text-xs text-destructive`），并禁用「保存」；不弹全局 Alert。
- **脏状态**：有未保存改动时点「放弃」/「重新导入」/ 切页 → 二次确认。

### 5.3 只读视图与编辑视图的一致性

两边共用同一套槽位网格与人物预览组件，避免「编辑里看到的样子 ≠ 保存后看到的样子」；
保存后立即用**重新解析的结果**刷新预览（而不是用内存里的编辑状态），这样「写出去的东西」和「看到的东西」永远一致。

## 6. 风险与限制（必须在界面上写清）

1. **TShock 服务器端角色（SSCC）**：`Main.ServerSideCharacter = true` 的服上角色数据存在服务器数据库，
   本地 `.plr` 完全不被使用 → 编辑没有效果。页面提示一句话（不弹窗）。
2. **游戏没退出就别改**：游戏退出/切角色时会把内存里的角色写回 `.plr`，覆盖你的编辑。提示「先退出该角色再替换文件」。
3. **非法值会被游戏静默纠正**（§2.2）：所以校验放在前面，避免「改了没生效」的困惑。
4. **只保证我们改的字段**：研究进度 / 配装 / 银行 / 退款队列等原样保留，但**不校验**它们与新数值的一致性
   （例如把生命上限改到 500 不会自动给生命水晶）。这是「编辑器」而不是「合法进度生成器」。
5. `.plr.bak` 不生成也不修改；不做云存档（Steam）路径处理。
6. 编辑是**纯本地**行为，不经过 `/api/*`、不需要登录（与现有页面一致），也不触碰任何提权路径。

## 7. 实施步骤（建议分 4 步，每步可独立验收）

| 步骤 | 内容 | 验收 |
| --- | --- | --- |
| A. 编解码底座 | `aes128CbcEncrypt`（`aes.ts` 里 S 盒 / 逆 S 盒都已生成，只差加密轮）；`encodePlr`（patch + encrypt）；`parsePlr` 记录 offset 表；顺手修正 `aes.ts` 顶部「写端补 0」的旧注释（实际是 PKCS7，读端忽略尾部） | 单测：`encrypt(decrypt(f)) === f`；patch 后 diff 命中预期块；重新解析得到新值、其余字段不变、长度不变 |
| B. 数据 | GameDump `--item-limits` → `data/item-limits.json`（maxStack + noInventory），懒加载 loader | `dataset.realdata.test.ts` 断言若干已知物品的上限（如火把 9999、天顶剑 1） |
| C. UI | 编辑态表单 + 槽位编辑器 + 校验 + 保存下载 + 脏状态确认 | RTL 用例：改生命/数量/词缀 → 保存触发下载且内容能重新解析成新值；非法值禁用保存并显示原因 |
| D. 收尾 | 文档（本文件转「已实现」+ `记录-实现与验收.md`）、changelog、`设计原则与约束.md` §2.1 登记 | `npx vitest run` / `tsc -b` / `oxlint` / `npm run build` 全绿 |

**手工验收（需要你来做）**：改一个角色 → 替换文件 → 进游戏确认生命/背包/词缀/模式生效；
再确认未编辑的字段（研究进度、配装、银行）没丢。

## 8. 已定方案（用户「你先做」后按推荐值落地）

| 问题 | 结论 |
| --- | --- |
| 版本（release） | **同布局段内可改**，其它版本不进下拉（跨段需要重写整份存档） |
| 生命 / 魔力上限 | **放开**（`statLifeMax` 100–500、`statManaMax` 0–200，当前值 ≤ 上限，魔力值允许到 400） |
| 下载文件名 | **沿用原名**（浏览器自动去重成 `xxx (1).plr`），方便直接替换 |
| 硬核 / 旅途 | 选中时在字段下方给红字提示（不弹窗） |
| 背包范围 | 只做 **58 格背包**（装备 / 银行 / 配装保持原样不碰） |
| 撤销 / 历史 | 不做；只有「放弃修改」（有改动时二次确认） |

## 9. 原始待确认清单（存档）

1. **版本（release）怎么处理？**
   - A（推荐）：**同布局段内可改**，其它版本置灰并说明「字段结构不同，需要重写整份存档」；
   - B：只读，只显示（最省事，也最不容易误导）；
   - C：做完整「升降级重写」（不推荐：要处理字段增删、数据丢失不可逆）。
2. **生命 / 魔力是否也放开上限**（`statLifeMax` / `statManaMax`）？不放开的话「生命」只能改当前值，实际意义很小。
3. **下载文件名**：沿用原名（`Joy.plr`，浏览器自动去重）还是加后缀（`Joy-edited.plr`）？
4. **是否需要一次确认**：切到「硬核」（死亡即永久）或「旅途」（会进入旅程模式）时，是否要求二次确认？
5. **背包范围**：只做背包 58 格（当前需求），还是顺带加装备/银行/配装（工作量 +1 档，但槽位渲染已经现成）？
6. **是否需要撤销/历史**：第一版建议不做（保留「放弃修改」即可）。
