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

## 协作方式（防止长时间卡在无关步骤）

- **多部件改动先出方案再动代码**：等用户确认，不要边猜边实现边验证。
- **需求中途追加时先重述待办**：把新旧需求并成一条清单，不要一边继续旧岔路一边接新需求。
- **长文档分段读**（`docs/` 里动辄上千行）：按需 `grep` / 局部 `read`，整篇读进来会把后续每一步都变贵。

### 验证强度（实测：全量 129 文件 / 1400 用例 ≈ 21s 墙钟、约 170s CPU；10 核会吃满）

- **迭代期只跑相关文件**：`npx vitest run src/pages/XxxPage.test.tsx`（<3s，单核）；全量只在收尾跑一次。
- **不知道会牵连谁就用 `npm run test:changed`**：只跑 git 改动引用到的测试（改一个 util 通常 2s 内）。
  改了 `vite.config.ts` 会让这种增量失效、退回全量，属正常现象。
- 必须全量又不想把机器占满：`npx vitest run --maxWorkers=4`（~28s，CPU 约 130s）。
- 纯逻辑测试（不碰 DOM）在文件头写 `// @vitest-environment node`：省掉每个文件 ~0.3s 的 jsdom 建文档开销。
- **`tsc -b` 可常跑**（~4s）；**`vite build` 只在交付前**跑一次。
- **不启浏览器、不留后台进程**：收尾 `ps` 确认一遍（vite / 无头 Chrome / vitest）。
- **只在不确定的情况才截图查看界面**（改布局没把握时）；能靠代码或测试判断的不要开浏览器，
  视觉细节以用户截图为唯一依据。

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
- **每个版本两份单版本文件**（发版前必须齐备）：
  - `docs/changelog/<版本>.md`：按功能模块的详细更新；
  - `docs/release/<版本>.md`：**三段式**（新增 / 改进 / 修复）对外发布说明，GitHub Release 用它。
  用 `make release-docs` 从模板生成、`make release-check` 校验；完整流程见 `docs/发布流程.md`。
  根 `changelog.md` 是**全量历史**，单版本文件以它的该版本段落为准。

## 文档

README 由用户手动维护。不要改它的结构、措辞或顺序。

只在用户明确要求时改 README。改也只改他指定的部分。

其它文档按本节的规则写。细节进 `docs/`，索引见 `docs/README.md`。

格式由测试与 lint 守住：中文段落不折行、列表用 `-`、代码块写语言、不用裸 URL、
不留连续空行与行尾空格。改完跑 `cd web && npm run test:run` 与
`npx markdownlint-cli2 "README.md" "docs/*.md" "AGENTS.md"`。
