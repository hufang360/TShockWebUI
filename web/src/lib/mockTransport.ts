import type { CommandResult } from '@/types'
import {
  emptyPlayerLook,
  TshockRequestError,
  type BackendTransport,
  type BatchCapabilities,
  type ChatSendResult,
  type EventsPage,
  type FishBuyResult,
  type FishCapabilities,
  type FishGood,
  type FishShop,
  type MeInfo,
  type NameItem,
  type PlayerCapabilities,
  type PlayerItem,
  type PlayerLook,
  type PluginDataType,
  type PluginStatus,
  type RuntimeCommand,
  type ServerInfo,
  type ServerInfoExtra,
  type ServerStatus,
  type Session,
  type SessionInfo,
  type WebAuthCapabilities,
} from './transport'

/**
 * Mock 传输：仅用于无后端时的界面演示。
 * 所有输出以 [Mock] 开头，且 UI 顶部有醒目标识，绝不冒充真实服务器结果
 * （AGENTS.md 铁律）。协议与 `HttpTransport` 完全一致，便于替换。
 */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const MOCK_PLAYERS = ['Alice', 'Bob', 'Steve', '小美', 'Alex']

export class MockTransport implements BackendTransport {
  readonly mock = true
  readonly label = 'Mock（演示，未连接真实服务器）'

  #session: Session = { authenticated: false, username: null }
  #mockSeq = 6
  #mockEvents: EventsPage['events'] = [
    { seq: 1, type: 'join', text: '[Mock] Alice 加入了服务器', time: new Date().toISOString() },
    { seq: 2, type: 'boss', text: '[Mock] Boss「史莱姆王」被击败', time: new Date().toISOString() },
    { seq: 3, type: 'leave', text: '[Mock] Bob 离开了服务器', time: new Date().toISOString() },
    // 聊天可带物品标签：这里演示 `[i:..]` 渲染为图标（与结果面板同款富文本）。
    { seq: 4, type: 'chat', text: '[Mock] Carol: 出售 [i:29] 和 [i/s5:75]', time: new Date().toISOString() },
    // 世界公告（Boss 苏醒 / 事件开始 / 入侵）。
    { seq: 5, type: 'announce', text: '[Mock] 光之女皇已苏醒！', time: new Date().toISOString() },
    // NPC 到达 / 离开（旅商等）。
    { seq: 6, type: 'npc', text: '[Mock] 旅商已到达！', time: new Date().toISOString() },
  ]

  async session(): Promise<Session> {
    await delay(60)
    return { ...this.#session }
  }

  async servers(): Promise<ServerInfo> {
    await delay(40)
    return { allowCustom: true, default: { scheme: 'http', host: '127.0.0.1', port: 7878 } }
  }

  async login(username: string, password: string): Promise<{ username: string }> {
    await delay(220)
    if (!username.trim() || !password) {
      throw new TshockRequestError('validation', '请输入账号和密码')
    }
    if (password === 'wrong') {
      throw new TshockRequestError('auth', '账号或密码错误')
    }
    const name = username.trim()
    this.#session = { authenticated: true, username: name }
    return { username: name }
  }

  async loginWithToken(token: string): Promise<{ username: string }> {
    await delay(180)
    if (!token.trim()) {
      throw new TshockRequestError('validation', '请输入访问令牌')
    }
    if (token === 'bad') {
      throw new TshockRequestError('token', '访问令牌无效或已失效')
    }
    this.#session = { authenticated: true, username: 'token-user' }
    return { username: 'token-user' }
  }

  async loginOnline(username: string, signal?: AbortSignal): Promise<{ username: string }> {
    const name = username.trim()
    if (!name) throw new TshockRequestError('validation', '请输入玩家名')
    if (!MOCK_PLAYERS.includes(name)) {
      throw new TshockRequestError('validation', '该玩家不在线')
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await delay(500)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    this.#session = { authenticated: true, username: name }
    return { username: name }
  }

  async webauthCapabilities(): Promise<WebAuthCapabilities> {
    await delay(40)
    return { plugin: true }
  }

  async batchCapabilities(): Promise<BatchCapabilities> {
    await delay(40)
    return { plugin: true, ingame: true }
  }

  async runBatch(cmds: string[]): Promise<CommandResult[]> {
    const results: CommandResult[] = []
    for (const cmd of cmds) results.push(await this.runCommand(cmd))
    return results
  }

  async runtimeCommands(): Promise<RuntimeCommand[]> {
    await delay(60)
    return [
      { name: 'fish', aliases: ['钓鱼'], permissions: [], allowServer: true, help: '[Mock] 鱼店指令', doLog: true },
      { name: 'i', aliases: ['item'], permissions: [], allowServer: false, help: '[Mock] 给物品（仅游戏内）', doLog: true },
    ]
  }

  async me(): Promise<MeInfo> {
    await delay(50)
    return {
      username: this.#session.username ?? 'MockUser',
      group: 'default',
      permissions: ['tshock.rest.useapi', 'tshock.rest.command'],
      canUseApi: true,
      canRunCommands: true,
    }
  }

  async pluginData(type: PluginDataType): Promise<NameItem[]> {
    await delay(80)
    switch (type) {
      case 'regions':
        return [{ name: '主城' }, { name: '商店街' }]
      case 'warps':
        return [{ name: 'home' }, { name: 'shop' }]
      case 'npcs':
        return [
          { id: 1, name: '蓝史莱姆' },
          { id: 4, name: '史莱姆王' },
        ]
      case 'buffs':
        return [
          { id: 1, name: '黑曜石皮' },
          { id: 2, name: '再生' },
        ]
    }
  }

  async serverInfoExtra(): Promise<ServerInfoExtra> {
    await delay(100)
    return {
      name: 'MockWorld',
      worldId: 1,
      difficulty: 1,
      hardMode: true,
      dayTime: true,
      time: 13500,
      bloodMoon: false,
      eclipse: false,
      invasionType: 0,
      invasionSize: 0,
      raining: false,
      slimeRain: false,
      players: MOCK_PLAYERS.length,
      npcCount: 12,
      maxNpc: 200,
      bosses: { eyeOfCthulhu: true, skeletron: false, wallOfFlesh: true, moonLord: false },
    }
  }

  async events(since = 0): Promise<EventsPage> {
    await delay(90)
    return { events: this.#mockEvents.filter((e) => e.seq > since), lastSeq: this.#mockSeq }
  }

  async eventsTail(limit = 100): Promise<EventsPage> {
    await delay(80)
    const events = this.#mockEvents.slice(-limit)
    return { events, firstSeq: events[0]?.seq ?? 0, lastSeq: this.#mockSeq }
  }

  async sendChat(text: string): Promise<ChatSendResult> {
    await delay(120)
    const trimmed = text.trim()
    if (!trimmed) throw new TshockRequestError('validation', '发言内容不能为空')
    const name = this.#session.username ?? 'MockUser'
    const line = `[WebUI] ${name}: ${trimmed}`
    this.#mockSeq += 1
    const id = `m${this.#mockSeq}`
    const time = new Date().toISOString()
    this.#mockEvents = [
      ...this.#mockEvents,
      // 与插件一致：统一为 type=chat + source=webui。
      { seq: this.#mockSeq, type: 'chat', source: 'webui', text: line, time },
    ].slice(-20)
    return { name, text: trimmed, line, id, time, source: 'webui' }
  }

  async sessions(): Promise<SessionInfo[]> {
    await delay(50)
    return []
  }

  async pluginStatus(): Promise<PluginStatus> {
    await delay(40)
    return {
      installed: true,
      legacy: false,
      version: '0.1.0-mock',
      protocol: 1,
      minProtocol: 1,
      capabilities: ['auth', 'batch', 'chat', 'commands', 'data', 'events', 'me', 'serverinfo', 'sessions'],
      backendProtocol: 1,
      compatible: true,
      reason: 'ok',
    }
  }

  async revokeSessions(_id?: string, _all = false): Promise<number> {
    await delay(80)
    return 1
  }

  async logout(): Promise<void> {
    await delay(80)
    this.#session = { authenticated: false, username: null }
  }

  async serverStatus(_target?: string): Promise<ServerStatus> {
    await delay(160)
    return {
      reachable: true,
      name: 'Mock 测试服',
      serverversion: '1.4.5.8',
      tshockversion: '6.2.1-mock',
      port: 7777,
      playercount: MOCK_PLAYERS.length,
      maxplayers: 16,
      world: 'MockWorld',
      uptime: '0.00:12:34',
      serverpassword: false,
    }
  }

  async playersList(): Promise<string[]> {
    await delay(140)
    return [...MOCK_PLAYERS]
  }

  async runCommand(cmd: string, _ingame = false): Promise<CommandResult> {
    await delay(260)
    const token = cmd.replace(/^\/+/, '').split(/\s+/)[0]?.toLowerCase() ?? ''
    switch (token) {
      case 'help':
      case '?':
        return {
          status: 'ok',
          output: [
            '[Mock] Commands (1/1): /help /time /seed /who /list',
            '[Mock] 这是模拟输出，用于演示结果面板；未调用真实 TShock。',
          ],
        }
      case 'time':
        return { status: 'ok', output: ['[Mock] 世界时间：上午 8:30'] }
      case 'seed':
        return { status: 'ok', output: ['[Mock] 世界种子：1234567890'] }
      case 'worldinfo':
        return {
          status: 'ok',
          output: ['[Mock] 世界名称：MockWorld', '[Mock] 世界尺寸：8400 x 2400'] ,
        }
      case 'rules':
        return { status: 'ok', output: ['[Mock] 1. 请勿破坏他人建筑', '[Mock] 2. 友善交流'] }
      case 'who':
      case 'list':
        return {
          status: 'ok',
          output: [`[Mock] 在线玩家 (${MOCK_PLAYERS.length}): ${MOCK_PLAYERS.join(', ')}`],
        }
      case 'sudo':
        return {
          status: 'no_permission',
          output: ['[Mock] You do not have access to this command.'],
          message: '无权限执行该指令（Mock 演示）',
        }
      default:
        return {
          status: 'command_error',
          output: [`[Mock] Invalid command: ${token}`],
          message: '服务器返回：无效指令（Mock 演示）',
        }
    }
  }

  async playerCapabilities(): Promise<PlayerCapabilities> {
    await delay(80)
    return { plugin: true, permission: true }
  }

  async playerLook(name: string): Promise<PlayerLook> {
    await delay(240)
    const trimmed = name.trim()
    if (!trimmed) throw new TshockRequestError('validation', '请输入玩家名')
    return {
      ...emptyPlayerLook(trimmed, MOCK_PLAYERS.includes(trimmed)),
      health: 400,
      maxHealth: 500,
      mana: 180,
      maxMana: 200,
      items: mockInventory(),
      // Mock 也带一点只读信息，便于演示区域
      questsCompleted: 42,
      extraSlot: true,
      ateArtisanBread: true,
      usedAegisCrystal: true,
      usedAegisFruit: true,
      usedArcaneCrystal: true,
      usedGalaxyPearl: true,
      usedGummyWorm: true,
      usedAmbrosia: true,
      unlockedBiomeTorches: true,
      unlockedSuperCart: true,
    }
  }

  async playerExport(name: string): Promise<{ filename: string; blob: Blob }> {
    await delay(260)
    const trimmed = name.trim()
    if (!trimmed) throw new TshockRequestError('validation', '请输入玩家名')
    const blob = new Blob(['[Mock] 这不是真实 .plr 存档，仅用于演示下载流程。'], {
      type: 'application/octet-stream',
    })
    return { filename: `${trimmed}.plr`, blob }
  }

  async importPlayer(data: ArrayBuffer): Promise<PlayerLook> {
    await delay(200)
    if (data.byteLength === 0) throw new TshockRequestError('validation', '文件为空')
    return {
      ...emptyPlayerLook('本地角色', false),
      health: 120,
      maxHealth: 120,
      mana: 0,
      maxMana: 20,
      items: mockInventory(),
      skinVariant: 2,
      hair: 15,
    }
  }

  async fishCapabilities(): Promise<FishCapabilities> {
    await delay(80)
    return { plugin: true, permission: true }
  }

  async fishList(): Promise<FishShop> {
    await delay(220)
    return { name: 'Mock 鱼店', total: MOCK_GOODS.length, goods: MOCK_GOODS }
  }

  async fishAsk(serial: number): Promise<FishGood> {
    await delay(160)
    const good = MOCK_GOODS.find((g) => g.serial === serial)
    if (!good) throw new TshockRequestError('validation', `没有这个商品: ${serial}`)
    return { ...good, allowGroup: ['所有用户组'] }
  }

  async fishBuy(serial: number, amount: number, _args?: string): Promise<FishBuyResult> {
    await delay(240)
    const good = MOCK_GOODS.find((g) => g.serial === serial)
    if (!good) throw new TshockRequestError('validation', `没有这个商品: ${serial}`)
    return { serial, name: good.desc, amount: Math.max(1, amount), cost: good.cost }
  }
}

/** Mock 货架：字段与 FishShop `/v3/fishshop/list` 对齐。 */
const MOCK_GOODS: FishGood[] = [
  {
    serial: 1,
    name: '生命水晶',
    icon: '[i:29]',
    buyMax: 999,
    needArgs: false,
    map: ['物品'],
    desc: '[i:29] 生命水晶 x5',
    cost: '5 金币',
    unlock: '',
    comment: 'Mock 商品',
    refund: false,
  },
  {
    serial: 2,
    name: '天顶剑',
    icon: '[i/p81:4956]',
    buyMax: 1,
    needArgs: false,
    map: ['物品'],
    desc: '[i/p81:4956] 天顶剑',
    cost: '1 铂金币',
    unlock: '击败月亮领主',
    comment: '',
    refund: false,
  },
  {
    serial: 3,
    name: '召唤月亮领主',
    icon: '[i:75]',
    buyMax: 1,
    needArgs: false,
    map: ['Boss'],
    desc: '召唤 月亮领主',
    cost: '30 金币',
    unlock: '',
    comment: 'Mock 服务商品',
    refund: false,
  },
]

/** Mock 背包：固定几个格子（索引同 TShock NetItem 布局）。 */
function mockInventory(): PlayerItem[] {
  const filled: Record<number, { id: number; stack: number; prefix?: number }> = {
    0: { id: 4956, stack: 1 }, // 天顶剑
    1: { id: 29, stack: 5 }, // 生命水晶
    2: { id: 75, stack: 99 }, // 坠落之星
    10: { id: 1326, stack: 1 }, // 泰拉刃
    59: { id: 554, stack: 1, prefix: 15 }, // 示例护甲/饰品
    79: { id: 1405, stack: 1 }, // 示例染料
  }
  const items: PlayerItem[] = []
  for (let slot = 0; slot < 350; slot++) {
    const f = filled[slot]
    items.push({
      slot,
      id: f?.id ?? 0,
      stack: f?.stack ?? 0,
      prefix: f?.prefix ?? 0,
      favorited: false,
    })
  }
  return items
}
