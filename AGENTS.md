# AGENTS.md — TShockWebUI

面向在本仓库工作的编码 Agent。**先读本文件，再读 `docs/设计原则与约束.md`，然后读 `docs/` 下的架构与接口文档。**

## 项目是什么

Terraria TShock 服务器的**玩家 Web 指令伴侣**：浏览器里编辑指令 → 经**同源 `/api/*`** 调用本仓库自带的 Go 后端 → 后端再调 TShock REST → 返回真实结果。附带物品搜索与 `[i:...]` 图标标签。

不是管理后台；**不得**用管理员身份代替玩家执行操作。

## 当前状态（重要）

- **阶段 0–4 已交付**：数据生成、调研、React 前端（输入 / 补全 / 物品搜索 / 标签插入）、
  Go 后端 + 会话 + 容器化 + 真实联调，以及物品图鉴 / 合成表 / 第三方与自研插件模块。
- **交付形态**：单容器镜像 + 单文件二进制；不再维护任何 nginx 静态预览 / `/tshock/` 反代方案。
- **还没做的**以 `docs/TODO.md` 为准；已完成任务的验收记录见 `docs/记录-实现与验收.md`；
  产品原则、范围与硬约束见 `docs/设计原则与约束.md`。

## 必读顺序

> 文档总索引与命名约定见 [`docs/README.md`](docs/README.md)。

1. `docs/设计原则与约束.md` —— 产品原则、范围边界与**已核实的硬约束**。
2. `docs/ARCHITECTURE.md` —— 目标架构（单容器 + Go 后端 + 会话 + 反代）。
3. `docs/API_SPEC.md` —— `/api/*` 契约、错误码、前端传输层接口。
4. `docs/记录-实现与验收.md` —— 历史任务与验收记录（**非待办**）。
5. `docs/TECHNICAL_RESEARCH.md` —— 每一条 TShock 事实的源码 / 实测出处。
6. `docs/REST_API限制.md` —— TShock REST API 的全部限制（认证/权限/限流/方法/端点，源码 + 实测）。
7. `docs/技术事实.md` —— 已核实的运行事实（**别猜**）。
8. `docs/功能-富文本解析.md` —— 执行结果里的 Terraria 颜色 / 物品标签解析（**持续记录**）。
9. `docs/功能-服务器动态.md` —— 首页「服务器动态」卡片的专门文档（事件源 / 契约 / 限制）。
10. `docs/插件接入规范.md` —— **接入 TShock 插件的统一模板/约定**（每加一个插件照此写一篇
    `docs/插件-<名>.md`）。已接入：`docs/插件-玩家管理.md`、`docs/插件-鱼店.md`、
    `docs/插件-世界管理.md`、`docs/插件-信使.md`（自研）。
11. `docs/UI组件.md` —— 前端 shadcn/ui 组件清单、Sidebar / Tooltip 约定与设计规范（改前端先看这篇）。
12. `data/README.md`（数据字段）、`docs/页面-物品图鉴.md`（物品图鉴）、`docs/开发速查.md`（路径 / 命令 / 数据再生成）。

## 目标架构（一眼版）

```
浏览器 (React SPA, base=/, 相对路径)
  └─ 同源 /api/*  →  Go 单二进制（distroless, ~12MB）
                       ├─ 内嵌前端静态资源 (/assets /data)
                       ├─ 内存会话 + HttpOnly Cookie（持有 TShock token）
                       ├─ Tier A 前置校验（内嵌 commands.json）
                       └─ TShock 客户端 → env TSHOCK_URL (默认 http://127.0.0.1:7878)
```

- 交付：**单个 Docker 镜像**；访问可为 `http://IP:8080` 或 `https://域名`。
- 浏览器**不持有 TShock token**，密码只在 `POST /api/login` 的 body。
- 可选能力（未装插件即禁用）：**在线授权** `/api/login/online`、**批量执行** `/api/batch`、
  **只读信息 / 事件 / 会话** `/api/{commands,me,data,serverinfo,events,sessions}`、
  **Tier B**（`allowServer=false` 指令以真实在线玩家身份执行，默认关）、
  **多服务器切换**（`X-TSWUI-Target`，默认关）。细节见 `docs/API_SPEC.md` 与 `docs/插件-信使.md`。
- **不暴露通用 `/tshock/` 代理**；只暴露固定 `/api/*`。

## 铁律

- 先读现有代码再动手，**不无理由重建工程**，不擅自更换技术栈（后端语言已定为 **Go 标准库**）。
- **不虚构 TShock API**、不使用未经验证的指令格式；接口先实测再封装。
- 不把 Mock 冒充真实功能；Mock 模式必须在界面上明确区分。
- **单容器、单端口**；浏览器只走同源 `/api/*`；**不得**引入通用 URL 转发 / `/tshock/` 直通。
- **TShock token 只能在后端内存**；浏览器不得持久化 token；任何 403 都要清会话回登录。
  （例外：登录框的「记住密码」会把账号密码存本机 `tswui:login`，属用户明确要求的取舍；详见 `docs/设计原则与约束.md` §4.6。）
- 非 GET 请求必须校验 `X-Requested-With: tswui`；密码与 token 绝不进日志。
- 前端对 `allowServer=false` 直接拒绝；后端也要复检（纵深防御）；真正权限在 TShock。
- 只有实际验证通过的功能才能标记为完成；版本不匹配时必须报警而不是静默使用。
- **前端遵循 shadcn/ui 设计规范**：优先复用 `web/src/components/ui/` 里的组件（缺什么先按 shadcn 结构加，别手写）；
  语义色令牌优先于硬编码颜色；表单/输入、Dialog 结构、图标 `data-icon` 等按 `.agents/skills/shadcn/`（本机 skill，**不入版本管理**）的 Critical Rules 执行。
- 不扩大范围：物品商店、管理员后台、多服务器、以及**未获确认**的插件扩展（含 Tier B 越权用法）均属范围外。
  **已确认的例外**：
  1. 接入既有第三方插件的端点，用当前登录玩家自己的 token，权限由插件决定，
     插件缺失/无权限时模块提示。
     - **PlayerManager**（`/pm/*`）→「玩家管理」模块（看背包 + 下载 `.plr`），权限 `playermanager`。
     - **FishShop**（`/v3/fishshop/*`）→「鱼店」模块（货架 / 询价 / 购买），权限 `fishshop.rest.use` / `buy`。
     两个模块默认不在侧边栏显示，需在「设置 → 激活模块」里探测到插件后手动打开。
  2. **自研信使插件 `WebUI`**（用户明确要求，已确认）：
     - 「在线授权」登录：把网页登录请求转成在线玩家的一次游戏内确认，用玩家本人账号铸造 token；
     - 批量执行 / 只读信息（指令目录、区域、传送点、NPC/buff、世界状态、事件流）/ 会话自助管理；
     - **Tier B**（`AllowInGameOnlyCommands`，默认关）：以真实在线玩家身份执行 `allowServer=false` 的指令。
     以上均**不提权**，权限就是 token 用户组；范围限 `plugin/WebUI/`。
     超出这些（如绕过 `AllowServer` 以外的越权、伪造身份）**仍需先问用户**。

## 遇到这些必须停下来问用户

- 把 Tier B（`TSWUI_ALLOW_INGAME_COMMANDS` / 插件 `AllowInGameOnlyCommands`）从默认关改为默认开，
  或为自研信使插件新增越权 / 伪造身份类用途。
- 修改 TShock 侧配置（如 `RESTMaximumRequestsPerInterval`、`EnableTokenEndpointAuthentication`）。
- 任何要放宽权限、使用管理员身份、或扩大项目范围的改动。
- 生产 TShock 的对外地址 / 端口 / TLS 归属发生变化时。

## 交付时汇报

修改的文件、已完成功能、未完成功能、未解决问题与风险、下一步建议。所有结论要能对应到真实测试或数据来源。
