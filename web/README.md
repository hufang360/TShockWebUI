# TShockWebUI 前端（web/）

React + TypeScript + Vite + Tailwind，最终产物由 **Go 后端内嵌**在单个容器镜像里提供。
数据从仓库根 `data/` 生成，构建时一并打包。

## 形态

- 前端 `base = /`，API 一律使用相对路径 `/api`（`http://IP:8080` 与 `https://域名` 通用）。
- 浏览器**不持有 TShock token**：登录/执行都走 `/api/*`，会话在后端 + `HttpOnly` Cookie。
- 详见 `../docs/ARCHITECTURE.md` 与 `../docs/API_SPEC.md`。

## 现状

阶段 0–4 已交付：编辑器 / 补全 / 物品搜索 / `[i:...]` 标签 / 图集图标 / 历史草稿 / 物品图鉴 /
合成表 / 富文本结果 / 首页卡片 / 多服务器切换 / 插件模块（玩家管理、鱼店、世界管理）。

- 参数补全：`data/commands.json` 的 `paramSets` 来自 TShock 源码用法串，`lib/completion.ts` 据此逐位判定参数类型；
  真实数据回归见 `src/lib/completion.realdata.test.ts`。
- 登录态由 `GET /api/session` + `HttpOnly` Cookie 维持（`tswui:auth` 已废弃并清理）。
- 后端见 `../server/`；架构见 `../docs/ARCHITECTURE.md`，待办见 `../docs/TODO.md`。

## 传输层选择

- 默认使用 `HttpTransport`（真实后端）。
- 无后端时用 `VITE_TRANSPORT=mock npm run dev` 进入 Mock 演示（界面会显式标注「Mock」）。
- 开发代理目标默认 `http://localhost:8080`，可用 `VITE_API_TARGET` 覆盖。

## 命令

```bash
cd web
npm install

npm run dev        # Vite 开发服务器 :5173（需把 /api 代理到后端 :8080）
npm run build      # 产物 web/dist/，base=/
npm run typecheck  # TypeScript 类型检查
npm run test:run   # vitest 单次运行
npm run lint       # oxlint
npm run coverage   # 覆盖率
```

## 数据

`data/` 是仓库根的生成数据。Vite 用 `vite.config.ts` 的 `dataDirPlugin` 把它挂到 `/data/*`：
开发时中间件直接读 `../data`（改数据刷新即可），构建时复制到 `dist/data/` 随前端产物一起内嵌。
（不再使用 `web/public/data` 符号链接，避开 Windows / CI 的符号链接问题。）

数据**按界面语言拆分**，`loadDataset(lang)` 只加载当前语言：

- 语言无关：`items.json` / `item-stats.json` / `recipes.json` / `items-atlas.json` / `commands.json` / `meta.json`；
- 当前语言：`loc.<culture>.json`（官方本地化：物品名 / 词缀名 / 配方组名）与
  `item-tips.<culture>.json`（提示行）；`culture = zh-Hans | en-US`。

物品/词缀名在 `loadDataset` 里从 `loc.ItemName` / `loc.Prefix` 解析后填充 `name`；
配方组名用 `locText()` 解析（支持 `Lang.misc[N] → LegacyMisc.N`）。
中文界面下「插入英文名」按需拉取 `loc.en-US.json`（`src/lib/loc.ts`）。

## 传输层（已实现）

```ts
// src/lib/transport.ts（契约）/ httpTransport.ts / mockTransport.ts
// 入口 re-export：src/lib/tshock.ts
export interface BackendTransport {
  readonly mock: boolean
  readonly label: string
  session(): Promise<{ authenticated: boolean; username: string | null }>
  login(username: string, password: string): Promise<{ username: string }>
  logout(): Promise<void>
  serverStatus(): Promise<ServerStatus>
  playersList(): Promise<string[]>
  runCommand(cmd: string): Promise<CommandResult>
}
```

- `HttpTransport`：调用 `/api/*`，带 `X-Requested-With: tswui`。
- `MockTransport`：离线/测试用，界面必须显式标注「Mock」。
- 由 `VITE_TRANSPORT=mock|http` 选择，默认 `http`。

## 目录

```
src/
├── App.tsx                    # 外壳、会话/服务状态编排
├── types.ts
├── lib/
│   ├── dataset.ts             # 静态 JSON 载入与索引
│   ├── items.ts               # 物品搜索、[i:...] 解析/生成
│   ├── commands.ts            # 指令解析与前端 Tier A 策略
│   ├── completion.ts          # 补全候选（纯函数）：指令名 / 玩家名 / 按参数类型取候选
│   ├── tshock.ts              # 传输层（阶段 2：BackendTransport）
│   ├── atlas.ts               # 图集单次加载
│   └── storage.ts             # tswui: localStorage 封装（不含 token）
├── hooks/
├── components/
└── pages/
```

## 安全约定

- localStorage **不存 token / 密码**；`tswui:auth` 已废弃（升级时清理）。
- 只请求同源 `/api/*` 与 `/data/*`，不接受任意 URL。
- 非 GET 请求带 `X-Requested-With: tswui`。

## UI 约定

- 组件库采用 **shadcn/ui** 约定：`components.json`、`cn`（clsx + tailwind-merge）、`cva`、Radix
  （`Slot` / `Tabs` / `Switch`）。原语在 `src/components/ui/`。
- 主题：使用 **shadcn 默认主题**（new-york / baseColor `slate`，light/dark），组件一律用语义 token；
  定义见 `src/index.css`。
- 指令编辑器为**单行**（`<textarea rows=1>`，Enter 执行；补全打开时 Enter/Tab 接受）。
- 国际化：`src/lib/i18n.tsx`（zh / en），设置内切换，持久化到 `tswui:settings.language`。
- 指令帮助文本取自 `data/commands.json` 的 `helpZh` / `helpEn`（由 TShock i18n 生成）。
