import type { CommandResult } from '@/types'

/**
 * 前端传输层契约（docs/API_SPEC.md 第 8 节）。
 *
 * 浏览器只与同源 `/api/*` 通信，**不持有 TShock token**；
 * token 由后端内存会话保管（设计原则与约束 C15）。真实实现见 `httpTransport.ts`，
 * 演示实现见 `mockTransport.ts`。
 */

/** `GET /api/status` 的响应；TShock 不可达时仅 `{ reachable:false }`。 */
export interface ServerStatus {
  reachable: boolean
  name?: string | null
  /** 已由后端规范化，无前导 v（如 1.4.5.8）。 */
  serverversion?: string | null
  tshockversion?: string | null
  port?: number | null
  playercount?: number | null
  maxplayers?: number | null
  world?: string | null
  /** TShock 运行时长，形如 "0.00:00:18"。 */
  uptime?: string | null
  /** 服务器是否设置了进入密码。 */
  serverpassword?: boolean | null
}

export interface Session {
  authenticated: boolean
  username: string | null
}

/** `GET /api/servers` 的响应：是否允许自定义上游，以及后端默认上游（host/port 分开）。 */
export interface ServerInfo {
  allowCustom: boolean
  default?: { scheme: string; host: string; port: number } | null
}

/** `GET /api/batch/capabilities`：批量执行信使插件的可用性。 */
export interface BatchCapabilities {
  /** 服务器是否已安装支持批量执行的信使插件（/webui/batch 存在）。 */
  plugin: boolean
  /** 后端是否允许把 allowServer=false 的指令交给插件以真实玩家身份执行。 */
  ingame?: boolean
}

/** `GET /api/commands`：TShock 运行时指令目录（含插件指令）。 */
export interface RuntimeCommand {
  name: string
  aliases: string[]
  permissions: string[]
  allowServer: boolean
  help: string
  doLog?: boolean
}

/** `GET /api/me`：当前 token 用户档案。 */
export interface MeInfo {
  username: string
  group: string
  permissions: string[]
  canUseApi: boolean
  canRunCommands: boolean
}

/** 补全 / 数据源里的一条 {id?, name}。 */
export interface NameItem {
  id?: number
  name: string
}

/** `GET /api/data?type=` 的合法类型。 */
export type PluginDataType = 'regions' | 'warps' | 'npcs' | 'buffs'

/** `GET /api/serverinfo`：世界事件 / Boss 进度等增强状态。 */
export interface ServerInfoExtra {
  name: string
  worldId: number
  difficulty: number
  hardMode: boolean
  dayTime: boolean
  time: number
  bloodMoon: boolean
  eclipse: boolean
  invasionType: number
  invasionSize: number
  raining: boolean
  slimeRain: boolean
  players: number
  npcCount: number
  maxNpc: number
  bosses: Record<string, boolean>
}

/** 服务器动态事件。 */
export interface ServerEvent {
  seq: number
  type: string
  text: string
  time: string
  /** 同类型事件的来源（如 `type=chat` 时 `game` | `webui`）；旧插件可能不返回。 */
  source?: string
}

export interface EventsPage {
  events: ServerEvent[]
  lastSeq: number
  /** 最新一批的起始 seq（新插件的 tail 模式返回）；缺省为 0。 */
  firstSeq?: number
  /**
   * 事件库实例标识（新插件返回）：同一个地址 / 端口下换了服（另一份存档目录）时它会变。
   * 变了就说明手上缓存的事件 / 世界状态属于另一个服，必须清空重拉。
   */
  instance?: string
}

/** SSE 事件流回调（由传输层解析后回调）。 */
export interface EventsStreamHandlers {
  /** 收到一条事件。 */
  onEvent: (event: ServerEvent) => void
  /** 收到一帧世界状态（徽标 / 游戏内时间）；未实现 / 旧后端可不提供。 */
  onWorld?: (info: ServerInfoExtra) => void
  /**
   * 上游换了实例（同一个地址 / 端口后面是另一个服）：调用方应清空列表并重拉。
   * 参数是新实例标识；旧后端不会发这一帧。
   */
  onReset?: (instance: string) => void
  /** 连接失败 / 中断（调用方据此降级为轮询）。 */
  onError: (err: unknown) => void
}

/** `POST /api/chat`：网页发言的结果（name 为游戏内角色名或账号名）。 */
export interface ChatSendResult {
  name: string
  text: string
  /** 插件实际广播的那一行（含可配置前缀，默认 `[WebUI]`）。 */
  line: string
  /** 插件生成的消息 id（用于去重 / 发送状态）。 */
  id?: string
  /** 发送时间（UTC ISO-8601）。 */
  time?: string
  source?: string
}

/** `GET /api/plugin/status`：信使插件握手结果（版本 / 协议 / 能力 / 兼容性）。 */
export interface PluginStatus {
  installed: boolean
  /** 旧版插件（无 `/webui/meta`）：按尽力兼容处理，但无法做版本/能力校验。 */
  legacy: boolean
  version?: string
  protocol: number
  minProtocol: number
  capabilities: string[]
  backendProtocol: number
  compatible: boolean
  missingCapabilities?: string[]
  /** `ok` | `not_installed` | `legacy` | `protocol_mismatch` | `missing_capabilities` */
  reason: string
}

/** 本插件铸造的一条 web 会话（不含 token 明文）。 */
export interface SessionInfo {
  id: string
  created: string
  expires: string | null
  current: boolean
}

/** `GET /api/webauth/capabilities`：「在线授权」信使插件的可用性。 */
export interface WebAuthCapabilities {
  /** 服务器是否已安装 WebUI（/webui/auth/* 存在）。 */
  plugin: boolean
}

/** `GET /api/player/capabilities`：第三方插件 PlayerManager 的可用性。 */
export interface PlayerCapabilities {
  /** 服务器是否已安装 PlayerManager（/pm/* 存在）。 */
  plugin: boolean
  /** 当前用户所在组是否有 playermanager 权限。 */
  permission: boolean
}

/** `GET /api/requests/capabilities`：物资申请模块的可用性。 */
export interface RequestCapabilities {
  /** 服务器插件是否支持物资申请（声明了 requests 能力）。 */
  plugin: boolean
  /** 当前用户能否提交 / 查看 / 撤回自己的申请（需要 webui.request.use）。 */
  submit: boolean
  /** 当前用户能否审核 / 补发（需要 webui.request.review）。 */
  review: boolean
  /** 不可用原因（空 = 可用）：not_installed / protocol_mismatch / missing_capabilities。 */
  reason?: string
}

export type RequisitionStatus = 'pending' | 'approved' | 'delivered' | 'denied' | 'cancelled'

/** 物资申请里的一行：物品 id + 总数量。 */
export interface RequisitionItem {
  id: number
  stack: number
}

/** `GET /api/requests`：一条物资申请。 */
export interface Requisition {
  id: number
  account: string
  player: string
  items: RequisitionItem[]
  reason: string
  note: string
  status: RequisitionStatus
  createdAt: string
  updatedAt: string
  reviewedBy: string
  reviewedAt: string
  denyReason: string
  deliveredAt: string
  deliveryError: string
  world: string
}

/** `GET /api/fish/capabilities`：第三方插件 FishShop 的可用性。 */
export interface FishCapabilities {
  /** 服务器在跑 FishShop（含「版本过旧、没有 REST 接口」）。 */
  plugin: boolean
  /** 插件注册了 REST 端点（v1.6.2+）；false = 老版本只有游戏内指令。 */
  rest: boolean
  /**
   * 当前用户能否访问鱼店。新版插件不需要任何额外权限（恒为 true）；
   * 只有老版本（v1.6.2 ~ v1.6.6）缺 `fishshop.rest.use` 时才是 false。
   */
  permission: boolean
}

/**
 * `GET /api/capabilities`：一次拿到这台服务器上所有可选能力的可用性。
 *
 * 收敛前的做法是分别打 batch/player/fish/requests/webauth 五个探测端点，
 * 启动时 + 首页 + 设置页各打一轮；现在统一读这一份。
 * `reachable === false` 表示上游 TShock 不可达/超时 → 其余字段不可信，别据此隐藏模块。
 */
export interface ServerCapabilities {
  reachable: boolean
  /** 信使插件握手（与 pluginStatus() 同结构）。 */
  messenger: PluginStatus
  batch: BatchCapabilities
  player: PlayerCapabilities
  fish: FishCapabilities
  requests: RequestCapabilities
  webauth: WebAuthCapabilities
}

/** 鱼店货架上的一条商品（字段见 `docs/REST-API.md` §2.1，上游「只增不改名」）。 */
export interface FishGood {
  serial: number
  name: string
  /** 插件配置的商品图标标签（如 `[i:5041]`）；服务类商品的 desc 只有文字，靠它展示图标。可能为空。 */
  icon?: string
  /** 图标的物品 id（`0` = 没配图标）：不想解析 `icon` 字符串就用它。 */
  iconId?: number
  /** 单次最多可购买件数（1 = 不允许调数量）。 */
  buyMax?: number
  /** 指令类商品含 `{args}`/`{0}` 占位符：购买时需填参数（此时不调数量）。 */
  needArgs?: boolean
  /** 需要的透传参数个数（`0` = 不需要；`{args}` 记 1；`{0}{1}…` 取最大序号 +1）。 */
  argCount?: number
  /** 分类 / 别名标签（插件侧为 List<string>）。 */
  map: string[]
  desc: string
  cost: string
  unlock: string
  comment: string
  /** 限购（空 = 不限）：限制用户组（白名单）。 */
  allowGroup?: string[]
  /** 限购（空 = 不限）：限制玩家（白名单）。 */
  allowPlayers?: string[]
  /** 限购：禁止玩家（黑名单）。 */
  denyPlayers?: string[]

  // ── 结构化追加字段（展示 / 粗筛能否购买） ──
  /** 商品 id：`>0` 原版物品，`<0` 内置商品/服务（多条商品可共用同一个 id）。 */
  id?: number
  /** 单次发放的堆叠数量。 */
  stack?: number
  /** 词缀数值 id（`0` = 无词缀）。 */
  prefix?: number
  /** 单件价格的铜币数（不含扣物品）。 */
  costMoney?: number
  /** 要扣的物品（不含货币）。 */
  costItems?: { id: number; stack: number }[]
  /** 购买前检查（`check`）的说明文本，空 = 无检查。 */
  check?: string
  /** 每个玩家的限购次数（`0` = 不限）。这是**配置值**，"还剩几次" 只有购买时才知道。 */
  limit?: number
  /** 全服限购总数（`0` = 不限）。 */
  serverLimit?: number
  /** 同一玩家重复购买的冷却秒数（`0` = 不限）。 */
  cd?: number
  /** 全服冷却秒数（`0` = 不限）。 */
  serverCd?: number
  /** 死亡状态不能买。 */
  needAlive?: boolean
  /** 只能白天买。 */
  needDay?: boolean
  /** 只能夜晚买。 */
  needNight?: boolean
  /** 店名（**只有 `ask` 返回**；list 的店名在顶层 name）。 */
  shop?: string

  // ── 个人状态（**仅请求带 `self=1` 时返回**；缺省 = 不知道，不是「不能买」） ──
  /** 粗判能否买（只算限购 / 冷却 / 白名单 / 生死昼夜，不含商品的 `check`）。`undefined` = 没带 self。 */
  canBuy?: boolean
  /** `canBuy === false` 时上游给的原因文案（如「已达个人限购」）。 */
  blockReason?: string
  /** 该玩家已买过几次（按商品 id 统计）。 */
  myCount?: number
  /** 全服已卖出几个。 */
  serverCount?: number
  /** 还能买几次；`-1` = 不限。 */
  myRemain?: number
  /** 全服还能卖几个；`-1` = 不限。 */
  serverRemain?: number
  /** 个人冷却剩余秒数（0 = 可买）。 */
  myCdRemain?: number
  /** 全服冷却剩余秒数（0 = 可买）。 */
  serverCdRemain?: number
}

/** `GET /api/fish/list`：货架。 */
export interface FishShop {
  name: string
  total: number
  goods: FishGood[]
}

/** `POST /api/fish/buy`：购买结果。 */
export interface FishBuyResult {
  serial: number
  name: string
  /** **实际成交件数**（会被 `buyMax` / 物品堆叠上限夹小）。 */
  amount: number
  /** 请求的件数（没被夹小时与 `amount` 相同）。 */
  requested?: number
  /**
   * `true` = 动作执行了但商品没发出去（仪式失败等），支付已自动全额退还到鱼罐，
   * 此时 `amount` 为 `0`、`cost` 为空串。
   */
  refunded?: boolean
  cost: string
}

/** 背包里的一个格子（空格子 id=0）。slot 见 `web/src/lib/playerSlots.ts` 的 `PLAYER_SLOT_GROUPS`。 */
export interface PlayerItem {
  slot: number
  id: number
  stack: number
  prefix: number
  favorited: boolean
}

/** `GET /api/player/look`：玩家血量/蓝量、背包、外观与只读信息。 */
export interface PlayerLook {
  name: string
  online: boolean
  health: number
  maxHealth: number
  mana: number
  maxMana: number
  items: PlayerItem[]
  // 外观（画角色用）
  skinVariant: number
  hair: number
  hairDye: number
  /** 颜色为 int32 小端 RGBA（R=b0 G=b1 B=b2 A=b3）；缺省为 null。 */
  hairColor: number | null
  pantsColor: number | null
  shirtColor: number | null
  underShirtColor: number | null
  shoeColor: number | null
  skinColor: number | null
  eyeColor: number | null
  // 其它只读信息
  /** 恶魔之心：额外配饰槽。 */
  extraSlot: boolean
  /** 重生点坐标（-1 = 未设置）。 */
  spawnX: number
  spawnY: number
  /** 渔夫任务完成次数。 */
  questsCompleted: number
  usingBiomeTorches: boolean
  happyFunTorchTime: boolean
  /** 火把神徽章（生态火把已解锁）。 */
  unlockedBiomeTorches: boolean
  currentLoadoutIndex: number
  /** 以下为永久增强类消耗品是否已使用。 */
  ateArtisanBread: boolean
  usedAegisCrystal: boolean
  usedAegisFruit: boolean
  usedArcaneCrystal: boolean
  usedGalaxyPearl: boolean
  usedGummyWorm: boolean
  usedAmbrosia: boolean
  unlockedSuperCart: boolean
  enabledSuperCart: boolean
  // 以下字段只有本地 `.plr` 存档（`lib/save/plr.ts`）会填，TShock `/pm/look` 不提供。
  /** 存档版本号（`.plr` 的 `release`，如 326）。 */
  saveVersion?: number
  /** 由存档版本号映到的游戏版本号（如 `1.4.5.8`）。 */
  gameVersion?: string
  /** 难度：0 软核 / 1 中核 / 2 硬核 / 3 旅途。 */
  difficulty?: number
  /** 游玩时长（.NET TimeSpan tick，10^7 = 1 秒）。 */
  playTimeTicks?: number
  /** Golf 累计分数。 */
  golferScore?: number
  /** 税收金币。 */
  taxMoney?: number
  /** PVE / PVP 死亡次数。 */
  deathsPve?: number
  deathsPvp?: number
  /** 最后一次保存时间（ISO 8601，UTC 墙上时间）。 */
  lastSaved?: string
  /** 当前生效的 BUFF（`ticks` 是剩余 tick，60 tick = 1 秒）。 */
  buffs?: { type: number; ticks: number }[]
  /** 已研究的物品种类数（`.plr` ≥218 的研究进度条数；读不到就不给）。 */
  researchedCount?: number
  /** 研究进度明细：`persistentId` 与 `data/items.json` 的 `key` 一致（如 `LifeCrystal`）。 */
  research?: { persistentId: string; count: number }[]
  /**
   * 按世界分开的重生点列表（`.plr` 的 `spX/spY/spI/spN`）。
   * 本地单文件里「玩家现在想用哪个世界」无法确定，所以整份列出，由界面展示世界名 + 坐标。
   */
  spawns?: { x: number; y: number; world: string; worldId: number }[]
}

/** 构造一个空白的 `PlayerLook`（Mock / 测试用；真实数据由后端 `/api/player/look` 提供）。 */
export function emptyPlayerLook(name: string, online = true): PlayerLook {
  return {
    name,
    online,
    health: 100,
    maxHealth: 100,
    mana: 0,
    maxMana: 0,
    items: [],
    skinVariant: 0,
    hair: 1,
    hairDye: 0,
    hairColor: null,
    pantsColor: null,
    shirtColor: null,
    underShirtColor: null,
    shoeColor: null,
    skinColor: null,
    eyeColor: null,
    extraSlot: false,
    spawnX: -1,
    spawnY: -1,
    questsCompleted: 0,
    usingBiomeTorches: false,
    happyFunTorchTime: false,
    unlockedBiomeTorches: false,
    currentLoadoutIndex: 0,
    ateArtisanBread: false,
    usedAegisCrystal: false,
    usedAegisFruit: false,
    usedArcaneCrystal: false,
    usedGalaxyPearl: false,
    usedGummyWorm: false,
    usedAmbrosia: false,
    unlockedSuperCart: false,
    enabledSuperCart: false,
  }
}

export interface BackendTransport {
  /** true = Mock 演示；界面必须显式标注，绝不冒充真实结果。 */
  readonly mock: boolean
  readonly label: string

  session(): Promise<Session>
  /** 多服务器切换信息（是否允许自定义上游）。 */
  servers(): Promise<ServerInfo>
  login(username: string, password: string): Promise<{ username: string }>
  /**
   * 用 TShock 的 ApplicationRestToken 登录（可选扩展，见 API_SPEC §1）。
   * 令牌只在请求 body，后端验证后同样只存内存。
   */
  loginWithToken(token: string): Promise<{ username: string }>
  /**
   * 「在线授权」登录：后端请信使插件向该在线玩家发确认消息，玩家在游戏内同意后建立会话。
   * 请求会阻塞到玩家同意/拒绝/超时（后端默认 60 秒），可用 signal 取消等待。
   */
  loginOnline(username: string, signal?: AbortSignal): Promise<{ username: string }>
  /** 探测「在线授权」信使插件是否安装。 */
  webauthCapabilities(): Promise<WebAuthCapabilities>
  /** 探测「批量执行」信使插件是否安装（首页「统一执行」依赖）。 */
  batchCapabilities(): Promise<BatchCapabilities>
  /**
   * 一次请求执行多条指令（需要批量执行信使插件）。
   * 结果与 cmds 等长、同序；单条结果语义与 runCommand 一致。
   */
  runBatch(cmds: string[]): Promise<CommandResult[]>
  logout(): Promise<void>

  /**
   * 探测上游连通情况。不传 `target` 时用当前选中的上游；
   * `target` 形如 `scheme://host:port`，传空串表示内置默认（不带 `X-TSWUI-Target`）。
   */
  serverStatus(target?: string): Promise<ServerStatus>
  playersList(): Promise<string[]>
  /** 执行一条指令；ingame=true 时走插件「真实玩家」模式（可跑 allowServer=false 的指令）。 */
  runCommand(cmd: string, ingame?: boolean): Promise<CommandResult>

  /** 运行时指令目录（含插件指令），用于补全。 */
  runtimeCommands(): Promise<RuntimeCommand[]>
  /** 当前用户档案（组 / 权限 / 是否可登录）。 */
  me(): Promise<MeInfo>
  /** 信使插件提供的补全数据源（区域 / 传送点 / NPC / buff）。 */
  pluginData(type: PluginDataType): Promise<NameItem[]>
  /** 世界事件 / Boss 进度等增强状态。 */
  serverInfoExtra(): Promise<ServerInfoExtra>
  /** 服务器动态事件流（轮询；since 为上次的 lastSeq）。 */
  events(since: number, limit?: number): Promise<EventsPage>
  /**
   * 取**最新** limit 条事件（升序），用于「打开网页先看最近 N 条」。
   * 可选：未实现的传输层（如 Mock）会退回 `events(since=0)`。
   */
  eventsTail?(limit: number): Promise<EventsPage>
  /**
   * 打开服务器动态 SSE 长连接，返回关闭函数。
   * 可选：未实现 / 连接失败时，hook 退回轮询。
   */
  eventsStream?(handlers: EventsStreamHandlers, since: number): () => void
  /**
   * 网页发言：把文本广播到游戏内聊天（会带 `[WebUI]` 前缀，与真实在线玩家区分）。
   * 需要登录；插件缺失/无权限/限流时抛错。
   */
  sendChat(text: string): Promise<ChatSendResult>
  /** 本插件的 web 会话列表。 */
  sessions(): Promise<SessionInfo[]>
  /** 信使插件握手结果（版本 / 协议 / 能力 / 兼容性）；用于「设置 → 信使插件」诊断。 */
  pluginStatus(): Promise<PluginStatus>
  /**
   * 统一能力矩阵：一次请求返回插件 / 批量 / 玩家管理 / 鱼店 / 物资申请 / 在线授权的可用性。
   * `fresh` 为 true 时绕过后端 3 秒微缓存（「重新检测」按钮用）。
   */
  capabilities(fresh?: boolean): Promise<ServerCapabilities>
  /** 吊销指定的 / 全部（保留当前）web 会话，返回吊销数量。 */
  revokeSessions(id?: string, all?: boolean): Promise<number>

  /** 实时探测第三方插件 PlayerManager：是否安装 / 是否有权限。 */
  playerCapabilities(): Promise<PlayerCapabilities>
  /** 查看玩家背包（需要 playermanager 权限）。 */
  playerLook(name: string): Promise<PlayerLook>
  /**
   * 下载玩家存档（.plr）。返回文件名与二进制内容；
   * 由调用方用 object URL 触发浏览器下载（这样能带上 X-TSWUI-Target 等请求头）。
   */
  playerExport(name: string): Promise<{ filename: string; blob: Blob }>

  /** 实时探测第三方插件 FishShop：是否安装 / 是否有权限。 */
  fishCapabilities(): Promise<FishCapabilities>
  /**
   * 查看鱼店货架（新版插件不需要额外权限；老版本需要 fishshop.rest.use）。
   *
   * `self: true` → 让上游按「当前登录玩家」算限购 / 冷却，每条多返回个人状态
   * （`canBuy` / `myRemain` / `myCdRemain` …）。代价是该玩家必须在线，否则上游 400。
   */
  fishList(opts?: { self?: boolean }): Promise<FishShop>
  /** 询价单条商品（`self` 同 `fishList`）。 */
  fishAsk(serial: number, opts?: { self?: boolean }): Promise<FishGood>
  /** 为自己购买；amount 默认 1，args 替换指令类商品的 {args} 占位符。 */
  fishBuy(serial: number, amount: number, args?: string): Promise<FishBuyResult>

  /** 实时探测物资申请模块（插件能力 + 当前用户权限）。 */
  requestCapabilities(): Promise<RequestCapabilities>
  /** 我的物资申请。 */
  requestList(status?: RequisitionStatus | 'all'): Promise<Requisition[]>
  /** 提交物资申请。 */
  requestCreate(items: RequisitionItem[], reason: string, note?: string): Promise<Requisition>
  /** 撤回自己的待审申请。 */
  requestCancel(id: number): Promise<Requisition>
  /** 审核列表（需要 webui.request.review）。 */
  requestListAll(status?: RequisitionStatus | 'all'): Promise<Requisition[]>
  /** 通过 / 拒绝申请（需要 webui.request.review）。 */
  requestReview(id: number, decision: 'approve' | 'deny', reason?: string): Promise<Requisition>
  /** 补发已批准但未发放的申请（需要 webui.request.review）。 */
  requestDeliver(id: number): Promise<Requisition>
}

/**
 * 传输层错误类别。错误分类由**后端**承担（HTTP 错误信封的 `error.code`），
 * 前端只做 code → 类别的薄映射。
 */
export type TshockErrorKind =
  | 'auth'
  | 'token'
  | 'permission'
  | 'plugin_missing'
  | 'plugin_outdated'
  | 'plugin_protocol'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'network'
  | 'bad_response'
  | 'validation'
  | 'unknown'

export class TshockRequestError extends Error {
  readonly kind: TshockErrorKind
  readonly httpStatus?: number

  constructor(kind: TshockErrorKind, message: string, httpStatus?: number) {
    super(message)
    this.name = 'TshockRequestError'
    this.kind = kind
    this.httpStatus = httpStatus
  }
}

/**
 * 把传输层抛出的错误归一化为 `CommandResult`（设计原则与约束 §5）。
 * 注意：后端对指令执行失败也返回 HTTP 200 + `status`，
 * 这里只负责「请求本身失败」的场景。
 */
export function resultFromError(err: unknown): CommandResult {
  if (err instanceof TshockRequestError) {
    switch (err.kind) {
      case 'token':
      case 'auth':
        return { status: 'token_invalid', output: [], message: err.message }
      case 'permission':
        return { status: 'no_permission', output: [], message: err.message }
      case 'unavailable':
      case 'network':
        return { status: 'unavailable', output: [], message: err.message }
      case 'timeout':
        return { status: 'timeout', output: [], message: err.message }
      case 'rate_limited':
        return { status: 'rate_limited', output: [], message: err.message }
      default:
        return { status: 'bad_response', output: [], message: err.message }
    }
  }
  return {
    status: 'bad_response',
    output: [],
    message: err instanceof Error ? err.message : '未知错误',
  }
}
