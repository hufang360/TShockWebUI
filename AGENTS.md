# AGENTS.md — TShockWebUI

面向在本仓库工作的编码 Agent。

> **本文件只写长期不变的约定与索引。**端点、字段、页面结构、模块细节一律写进 `docs/`；
> 改功能时**不要**改本文件。只有当「项目定位 / 铁律 / 提问边界 / 交付要求」真的变了才动它。


## 项目是什么

Terraria TShock 服务器的**玩家 Web 指令伴侣**：浏览器里编辑指令 → 经**同源 `/api/*`** 调用本仓库自带的 Go 后端 → 后端再调 TShock REST → 返回真实结果。附带物品搜索与 `[i:...]` 图标标签。

不是管理后台；**不得**用管理员身份代替玩家执行操作。

## 先看哪里

1. `docs/设计原则与约束.md` —— 产品定位、范围边界、C1–C15 硬约束、设计理念（**范围与例外以它为准**）。
2. `docs/ARCHITECTURE.md` —— 单容器 + Go 后端架构、环境变量、构建与部署。
3. `docs/API_SPEC.md` —— `/api/*` 契约、错误码、前端传输层接口。
4. `docs/插件接入规范.md` —— 接入 TShock 插件的统一模板、capability 探测、协议握手（含已接入插件清单）。

其余文档（功能 / 页面 / 插件 / 事实 / 记录 / 待办）见 [`docs/README.md`](docs/README.md) 索引。
「还没做」以 `docs/TODO.md` 为准；历史验收见 `docs/记录-实现与验收.md`。

## 目标架构（一眼版）

```
浏览器 (React SPA, base=/, 相对路径)
  └─ 同源 /api/*  →  Go 单二进制（distroless, ~12MB）
                       ├─ 内嵌前端静态资源 (/assets /data)
                       ├─ 内存会话 + HttpOnly Cookie（持有 TShock token）
                       ├─ Tier A 前置校验（内嵌 commands.json）
                       └─ TShock 客户端 → env TSHOCK_URL (默认 http://127.0.0.1:7878)
```

- 交付：**单个 Docker 镜像**（另可产出单文件二进制）；访问可为 `http://IP:8080` 或 `https://域名`。
- 浏览器**不持有 TShock token**，密码只在 `POST /api/login` 的 body。
- 可选能力（未装插件即禁用）与插件模块清单：见 `docs/API_SPEC.md` 与 `docs/设计原则与约束.md` §2。
- **不暴露通用 `/tshock/` 代理**；只暴露固定 `/api/*`。

## 铁律
- 如何让用户更流畅、更符合直觉地使用我的产品
- 如何在产品出现异常信息时，不再让用户感到迷惑
- 涉及UI，Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.

- 先读现有代码再动手；**不无理由重建工程**；不擅自更换技术栈（后端语言已定为 **Go 标准库**）。
- **不虚构 TShock API**、不使用未经验证的指令格式：先看源码或实测，再封装，出处写进 `docs/`。
- 不把 Mock 冒充真实功能；Mock 模式必须在界面上明确区分。
- 不扩大范围：物品商店、管理员后台、多服务器**统一管理**、以及**未获确认**的插件扩展均属范围外。
  新模块 / 新用途先登记到 `docs/设计原则与约束.md` §2 并取得用户确认；插件接入按 `docs/插件接入规范.md` 走。
- **绝不提权**：用当前登录玩家自己的 token，权限由 TShock / 插件判定；不得用管理员身份代替玩家。
- **单容器、单端口**；浏览器只走同源 `/api/*`；**不得**引入通用 URL 转发 / `/tshock/` 直通。
- **TShock token 只能在后端内存**；浏览器不得持久化 token；任何 403 都要清会话回登录。
  （唯一例外：登录框的「记住密码」，见 `docs/设计原则与约束.md` §4.6。）
- 非 GET 请求必须校验 `X-Requested-With: tswui`；密码与 token 绝不进日志。
- `allowServer=false` 的指令前端直接拒绝、后端复检（Tier A）；Tier B 默认关。
- 只有实际验证通过的功能才能标记为完成；版本 / 协议不匹配必须报警，不许静默使用。
- **前端遵循 shadcn/ui 设计规范**：优先复用 `web/src/components/ui/` 里的组件（缺什么先按 shadcn 结构加，别手写）；
  语义色令牌优先于硬编码颜色。细节见 `docs/UI组件.md` 与本机 skill `.agents/skills/shadcn/`（**不入版本管理**）。

## 遇到这些必须停下来问用户

- 把 Tier B（`TSWUI_ALLOW_INGAME_COMMANDS` / 插件 `AllowInGameOnlyCommands`）从默认关改为默认开，
  或为自研信使插件新增越权 / 伪造身份类用途。
- 修改 TShock 侧配置（如 `RESTMaximumRequestsPerInterval`、`EnableTokenEndpointAuthentication`）。
- 任何要放宽权限、使用管理员身份、或扩大项目范围的改动。
- 生产 TShock 的对外地址 / 端口 / TLS 归属发生变化时。

## 交付时汇报

修改的文件、已完成功能、未完成功能、未解决问题与风险、下一步建议。所有结论要能对应到真实测试或数据来源。

## 更新日志（changelog）

- 文件：根目录 `changelog.md`。
- **只记「对外净变化」**：判断边界是「是否已发布」。相对**上一个已发布版本**的最终形态来写；两个未对外版本之间的内部迭代（改名 / 先加后删 / 重构 / 来回改 bug）**不单独记录**。
- 结构：首行 `# 更新日志`；未发布放 `## 未发布（vX.Y.Z-rc.N）`（发版时补日期）；已发布用 `## YYYYMMDD（vX.Y.Z）`，**新的在上**。
- 条目：无序列表，一条一事；太长换行拆成两级缩进子条目；通俗易懂，写清「做了什么、影响是什么」，多用指令 / 配置示例。
- 版本号来源：`web/package.json` 的 `version`（构建时注入前端 `__APP_VERSION__`，设置页底部展示）。改版本时同步 `changelog.md` 顶部标题。
