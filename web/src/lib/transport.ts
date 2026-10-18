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
}

/** SSE 事件流回调（由传输层解析后回调）。 */
export interface EventsStreamHandlers {
  /** 收到一条事件。 */
  onEvent: (event: ServerEvent) => void
  /** 收到一帧世界状态（徽标 / 游戏内时间）；未实现 / 旧后端可不提供。 */
  onWorld?: (info: ServerInfoExtra) => void
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

/** `GET /api/fish/capabilities`：第三方插件 FishShop 的可用性。 */
export interface FishCapabilities {
  /** 服务器是否已安装 FishShop（/v3/fishshop/* 存在）。 */
  plugin: boolean
  /** 当前用户所在组是否有 fishshop.rest.use 权限。 */
  permission: boolean
}

/** 鱼店货架上的一条商品。 */
export interface FishGood {
  serial: number
  name: string
  /** 插件配置的商品图标标签（如 `[i:5041]`）；服务类商品的 desc 只有文字，靠它展示图标。可能为空。 */
  icon?: string
  /** 单次最多可购买件数（1 = 不允许调数量）。 */
  buyMax?: number
  /** 指令类商品含 `{args}`/`{0}` 占位符：购买时需填参数（此时不调数量）。 */
  needArgs?: boolean
  /** 分类 / 别名标签（插件侧为 List<string>）。 */
  map: string[]
  desc: string
  cost: string
  unlock: string
  comment: string
  refund: boolean
  /** 限购（空 = 不限）：限制用户组（白名单）。 */
  allowGroup?: string[]
  /** 限购（空 = 不限）：限制玩家（白名单）。 */
  allowPlayers?: string[]
  /** 限购：禁止玩家（黑名单）。 */
  denyPlayers?: string[]
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
  amount: number
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
  /** 解析本地 .plr 角色存档（**仅展示**，不上传保存到服务器；需要登录）。 */
  importPlayer(data: ArrayBuffer): Promise<PlayerLook>

  /** 实时探测第三方插件 FishShop：是否安装 / 是否有权限。 */
  fishCapabilities(): Promise<FishCapabilities>
  /** 查看鱼店货架（需要 fishshop.rest.use 权限）。 */
  fishList(): Promise<FishShop>
  /** 询价单条商品。 */
  fishAsk(serial: number): Promise<FishGood>
  /** 为自己购买；amount 默认 1，args 替换指令类商品的 {args} 占位符。 */
  fishBuy(serial: number, amount: number, args?: string): Promise<FishBuyResult>
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
