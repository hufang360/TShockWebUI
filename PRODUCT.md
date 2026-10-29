# 产品

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **主要用户：拥有 TShock 账号的 Terraria 玩家。** 场景是坐在桌面浏览器前，想执行一条游戏指令却记不住语法、
  参数取值或物品名，而游戏内聊天框输入中文、改错、复制粘贴都很难受。要做的事：把一条**能跑通**的指令送到服端，
  看到**真实**的游戏输出。
- **次要场景，同一批玩家：** 搜索物品 ID / 名称 / 英文名；向服主提交物资申请并等审核；查看自己的本地
  `.plr` / `.wld` 文件（这两个功能**不需要账号**，是公开工具）。
- **分发对象：其他服主。** 产品会交给别台服务器的服主部署（单镜像 + `TSHOCK_URL`），因此默认值、
  README、错误提示都要对「陌生人的服务器、陌生的 TShock 版本偏差」成立。
- **服主本人：** 在游戏内 `/web req` 或网页「待审核」审物资申请；也可能用同一份界面当玩家用。
- **手机：** 次要入口。窄屏要能完成核心流程，但不为手机牺牲桌面密度。

## Product Purpose

浏览器里编辑指令 → 经同源 `/api/*` → 本仓库自带的 Go 后端 → TShock REST → 返回真实结果。
存在的原因是：Terraria 服端的指令体系复杂（数百条指令、上千物品、权限分组、`allowServer=false` 限制），
而游戏内聊天框不适合查、改、补全和验证。

**成功的样子：** 玩家不必背语法就能发出正确指令；服主只填一个 `TSHOCK_URL` 就能跑；
全程不出现提权（服务器上发生的所有事，权限都是 token 所属用户组的权限）；
本地文件工具在无登录、无上传的前提下可用。

## Positioning

**玩家侧的指令伴侣，而不是管理后台。** 关键在于一个别的同类产品无法照抄的机制组合：

- 后端内存会话 + `HttpOnly` Cookie，**浏览器从不持有 TShock token**（同类工具通常让浏览器直接持有 token）。
- 容器**不暴露通用 `/tshock/` 代理**，只暴露固定 `/api/*`，每个端点对应一个具体业务动作。
- 执行**严格继承 token 用户组权限**，不用管理员身份代替玩家。
- 附带一组**纯本地**的存档 / 世界文件工具（`web/src/lib/save/`）：解析、渲染、编辑、导出都在浏览器里做，
  文件不上传、不请求任何接口。

一个管理后台如果诚实描述自己，就说不出上面四条。

## Operating Context

- 交付：**单个 Docker 镜像**（distroless，约 20MB）或单文件二进制；一个端口 `8080`；
  TShock REST 默认 `http://127.0.0.1:7878`（同 compose 网络为 `http://tshock:7878`）。
- 目标版本 **Terraria 1.4.5.8 / TShock 6.2.1**；启动时比对 `data/meta.json` 的 `gameVersion`，不一致要告警。
- 部署环境**一般没有 HTTPS**；TLS 若存在则由外层（Caddy / Nginx / Cloudflare）终止。
- TShock 侧前置：`RestApiEnabled=true`、`RestApiPort=7878`、玩家用户组需被赋权
  `tshock.rest.useapi`（默认组没有）与 `tshock.rest.command`。
- 会话只在后端内存，进程或 TShock 重启 → 玩家需重登；遇 `token_invalid` 清会话回登录。
- 可选能力由插件决定：PlayerManager / FishShop / WorldModify / 自研信使插件 WebUI，
  登录时探测，未装即禁用；「查看存档 / 查看世界」不跟随任何模块开关。
- GitHub Pages 提供**仅 Mock** 的静态演示站（`VITE_TRANSPORT=mock`），界面上必须显式标注演示模式。
- 使用者的服务器规模、操作系统、玩家数**未知且未被记录**（不要编造）。

## Capabilities and Constraints

**已交付能力：** 指令编辑器（原生 `textarea`，`Enter` 执行 / `Ctrl+Cmd+Enter`）·
指令名 / 别名 / 玩家名 / 参数值补全（按 TShock 源码用法串逐位判定）· 指令帮助与用法串（中/英）·
物品搜索与 `[i:ID]` 插入 · 物品图鉴（49 个集合 + 游戏同款属性提示）· 本地合成表 ·
`[c/RRGGBB:text]` 与 `[i:ID]` 富文本结果 · 物资申请（提交 / 审核 / 在线或离线发放）·
历史 / 草稿 / 收藏（仅 `localStorage`，`tswui:*`，不自动执行）· 首页服务器动态与执行队列 ·
多服务器切换（**默认关**）· 浮动终端（桌面）/ 底部抽屉（窄屏）· 查看存档与查看世界（纯本地）·
中/英双语 · light/dark（默认 dark）· 可折叠侧栏 + 吸顶顶栏。

**硬约束（已核实，实现时不可绕过）：**
C1 物品数据须用 `tr-code-1458` 生成 · C2 TShock 6.2.1 / 7878 · C3–C5 建 token 与 rawcmd 的权限要求，
且 rawcmd 严格继承 token 用户组 · C6 `AllowServer=false` 的 24 条指令无法经 WebUI 执行（Tier A 前后端双重拒绝）·
C7/C10/C15 token 只存后端内存、浏览器只有 Cookie · C8 建 token 按来源 IP 限流，反代后共用一个桶 ·
C9 无效 token 与无权限都是 403，需结合响应体区分 · C11 Re-Logic 图标版权 · C12 按无 HTTPS 设计 ·
C13 `token/create` 不解析表单体，凭证只能走 query string 且必须由后端发起 ·
C14 生产形态是单容器镜像 · 非 GET 必须校验 `X-Requested-With: tswui`；密码与 token 绝不进日志。

**明确不在范围：** 管理员后台 · 完整经济系统 / 在线支付 / 插件市场 · 多服务器**统一管理** ·
服务器进程启停与资源监控 · 服务器上的世界文件管理 / 备份恢复 · AI 生成游戏指令 ·
用管理员身份代替玩家执行 · 自研插件的越权 / 伪造身份用途 · 上传本地存档 / 世界文件。

**未决（不要当成已有共识）：** 没有形式化的无障碍标准；没有遥测或使用统计；
其他服主实际部署的版本来路未验证（Tier B `TSWUI_ALLOW_INGAME_COMMANDS` 仍默认关，改动需用户确认）。

## Brand Commitments

- 名字 **TShockWebUI**（界面标题 `WebUI`，版本号来自 `web/package.json`，设置页底部展示）。
- **中文优先**：文档、文案、默认界面语言为中文；英文是**完整对等**的第二语言，不是事后补的字符串。
- 默认 dark 主题，light 可用；shadcn/ui（new-york / slate）+ 语义色令牌，不硬编码调色板色。
- 站点图标由物品图集生成（`tools/gen-brand-assets.py`），不用外部图库。
- 语气：直接、具体、不卖弄。错误信息要说明「发生了什么 + 下一步做什么」，不能只丢一个状态码。
- 界面克制：能用布局说明就不用副标题和说明段落。

## Evidence on Hand

**真实实测（TShock 6.2.1）：** `token/create` 不解析表单体（500）；建 token 按来源 IP 限流（默认 5 次/分钟，
反代后所有玩家共用一个桶）；`rawcmd` 对 `AllowServer=false` 直接拒绝；403 需按响应体区分
`token_invalid` / `no_permission`。出处：`docs/TECHNICAL_RESEARCH.md`、`docs/REST_API限制.md`、
`docs/技术事实.md`。

**由游戏与 TShock 源码生成的数据：** `data/items.json`、`npcs.json`、`buffs.json`、`commands.json`、
`recipes.json`、`permissions.json`（175 个权限节点，抽取自 TShock `Permissions.cs` 与 `RestPermissions.cs`，
带原文说明）、物品贴图集 PNG（版权属 Re-Logic，随仓库提交的生成物）。

**验收记录：** `docs/记录-实现与验收.md`（只追加）、`docs/验收清单.md`（需要真实游戏 / Windows 的步骤）。

**不存在的证据 —— 后续工作不得编造：** 没有真实玩家评价或推荐语，没有使用量 / 活跃服务器数 / 性能基准，
没有客户 logo、定价、许可证承诺，也没有"被 N 个服务器采用"这类数字。

## Product Principles

1. **玩家优先，不是管理员优先。** 功能先问"玩家在浏览器前要做什么"，再问"服主方便什么"。
2. **真实优先于好看。** 没有实测或源码出处的行为不写成能力；Mock 必须当场标出来。
3. **输入体验不可牺牲。** 输入法、光标、选择、撤销、补全都比花哨的交互更值钱。
4. **绝不提权。** 权限边界永远由 TShock / 插件判定；不做"帮你以管理员身份执行"的捷径。
5. **范围克制。** 新模块先登记范围并取得确认；单容器、单端口、固定 `/api/*` 不动摇。

## Accessibility & Inclusion

未确立形式化标准（WCAG 等）。分发给他人的服务器后，这会是一个待确认项。**需要保留的既有事实：**
编辑器用原生 `textarea`，中文输入法、光标、撤销不受影响；键盘可完成编辑与补全（`↑/↓` 选择、
`Enter`/`Tab` 接受、`Esc` 关闭）；中英双语对等；窄屏侧栏变抽屉且触控目标放大；
状态不能只靠颜色传达（Badge 带文字、Mock / 演示模式有横幅说明）。
