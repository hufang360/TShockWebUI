import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandTerminal } from '@/components/CommandTerminal'
import { makeDataset } from '@/test/fixtures'
import { I18nProvider } from '@/lib/i18n'
import { TerminalProvider } from '@/lib/terminalContext'
import { playerStubs } from '@/test/playerStubs'
import type { BackendTransport } from '@/lib/tshock'
import type { CommandDef, Dataset, Settings } from '@/types'
import { CommandTipsPage } from './CommandTipsPage'

const settings: Settings = {
  theme: 'dark',
  fontSize: 15,
  showIcons: true,
  insertWithCount: false,
  liveMode: false,
  language: 'zh',
  compact: true,
  commandInterval: 2000,
  refreshInterval: 120000,
  eventsRefreshInterval: 180000,
}

const npcs = [
  { id: 22, key: 'Guide', name: '向导', en: 'Guide' },
  { id: 107, key: 'GoblinTinkerer', name: '哥布林工匠', en: 'Goblin Tinkerer' },
  { id: 369, key: 'Angler', name: '渔夫', en: 'Angler' },
  { id: 50, key: 'KingSlime', name: '史莱姆王', en: 'King Slime', sb: 'king slime' },
  { id: 4, key: 'EyeofCthulhu', name: '克苏鲁之眼', en: 'Eye of Cthulhu', sb: 'eye of cthulhu' },
  { id: 126, key: 'Spazmatism', name: '魔焰眼', en: 'Spazmatism', sb: 'twins' },
  { id: 368, key: 'TravellingMerchant', name: '旅商', en: 'Traveling Merchant' },
]

/**
 * 参考行的语法来自 `data/commands.json`（TShock 源码提取），所以测试直接读**真实**那份，
 * 而不是 fixture 里的简化版：断言的内容就是页面上真正渲染的内容。
 */
const realCommands: CommandDef[] = (() => {
  const raw = JSON.parse(
    readFileSync(resolve(process.cwd(), '../data/commands.json'), 'utf8'),
  ) as { commands: CommandDef[] }
  return raw.commands
})()

/**
 * 默认用 fixture 的少量指令（孲 jsdom 渲染几百行表格很慢）；
 * 需要断言参考行内容的测试显式传 `makeTestDataset({ commands: realCommands })`。
 */
function makeTestDataset(overrides: Partial<Dataset> = {}): Dataset {
  const base = makeDataset(overrides)
  return {
    ...base,
    npcs,
    npcsById: new Map(npcs.map((npc) => [npc.id, npc])),
  }
}

const transport = {
  mock: false,
  label: 'test',
  runCommand: async () => ({ status: 'ok', output: [] }),
  ...playerStubs,
} as unknown as BackendTransport

function renderPage(dataset: Dataset = makeTestDataset(), onNavigate = vi.fn()) {
  const view = render(
    <I18nProvider lang="zh">
      <TerminalProvider>
        <CommandTipsPage dataset={dataset} onNavigate={onNavigate} />
        <CommandTerminal
          visible
          dataset={dataset}
          transport={transport}
          authenticated
          serverId="default"
          players={[]}
          ingameAllowed={false}
          runtimeValues={{}}
          settings={settings}
          onTokenInvalid={vi.fn().mockResolvedValue(true)}
          onLogin={vi.fn()}
          onNavigate={vi.fn()}
        />
      </TerminalProvider>
    </I18nProvider>,
  )
  return { ...view, onNavigate }
}

/** 表格内容（右侧分组栏里也有同名标题，所以断言都限定在表内）。 */
function table() {
  return within(screen.getByRole('table'))
}

/** 右侧分组栏。 */
function groupList() {
  return within(screen.getByRole('complementary'))
}

/** 点某条指令的「操作 → 终端」按钮（行本身不再响应单击）。 */
function fill(command: string | RegExp) {
  const name = typeof command === 'string' ? command : command
  const button = screen
    .getAllByRole('button', { name: /^填入指令浮窗：/ })
    .find((el) => {
      const label = el.getAttribute('aria-label') ?? ''
      return typeof name === 'string' ? label.includes(name) : name.test(label)
    })
  if (!button) throw new Error(`找不到填入按钮：${String(name)}`)
  fireEvent.click(button)
}

/** 打开（或复用）右下角浮窗里的输入框。 */
function inputValue(): string {
  const input = screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement
  return input.value
}

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('CommandTipsPage', () => {
  it('顶部提示权限与「不会自动执行」', () => {
    renderPage()
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText(/需要权限/)).toBeTruthy()
    expect(within(alert).getByText(/不会自动执行/)).toBeTruthy()
  })

  it('没有顶部 tab：左边搜索框，右边分组栏', () => {
    renderPage()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByPlaceholderText('搜索指令或名称')).toBeTruthy()

    // 分组栏：全部指令 + 各分组（世界 / NPC / 物品 / 增益 / 用户 / 服务器 …）
    const groups = groupList()
    expect(groups.getByRole('button', { name: /全部指令/ })).toBeTruthy()
    for (const title of [
      '世界事件',
      '入侵',
      '节日模式',
      '世界模式',
      '时间',
      '风',
      '召唤 Boss',
      '召唤 NPC',
      '传送 NPC',
      '刷怪率',
      '无敌模式',
      'NPC 管理',
      '物品',
      '增益',
      '生命与伤害',
      '传送与位置',
      '建筑与保护',
      '账号（玩家自己）',
      '用户账号',
      '封禁',
      '禁言 / 踢出',
      '用户组',
      '权限配置',
      '服务器与权限',
      '聊天与统计',
    ]) {
      expect(groups.getByRole('button', { name: new RegExp(title) })).toBeTruthy()
    }
  })

  it('点分组只显示那一组（再点「全部指令」回到全部）', () => {
    renderPage()
    fireEvent.click(groupList().getByRole('button', { name: /^物品/ }))
    expect(table().getByText('物品')).toBeTruthy()
    expect(table().queryByText('召唤 Boss')).toBeNull()
    expect(table().getByText(/^\/give /)).toBeTruthy()

    fireEvent.click(groupList().getByRole('button', { name: /全部指令/ }))
    expect(table().getByText('召唤 Boss')).toBeTruthy()
  })

  it('表格单击不填指令：只有操作列的终端按钮才填', () => {
    renderPage()
    // 点整行 / 指令文字 / 名称：都不该填进浮窗、也不该开浮窗
    fireEvent.click(screen.getByText('/worldevent bloodmoon'))
    fireEvent.click(screen.getByText('血月'))
    expect(screen.queryByTestId('terminal-window')).toBeNull()

    // 操作列：每行「终端 + 详情」两个按钮
    const fillButton = screen.getByRole('button', { name: '填入指令浮窗：/worldevent bloodmoon' })
    expect(screen.getByRole('button', { name: '指令帮助：/worldevent bloodmoon' })).toBeTruthy()
    fireEvent.click(fillButton)
    expect(inputValue()).toBe('/worldevent bloodmoon')
  })

  it('操作列的「详情」打开右侧抽屉：规范写法 / 权限 / 执行位置 / 说明', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    fireEvent.click(screen.getByRole('button', { name: '指令帮助：/worldevent invasion goblins' }))
    const drawer = within(screen.getByTestId('command-detail'))
    expect(drawer.getByText('指令帮助')).toBeTruthy()
    // 同一类指令的规范写法（这一条和 /worldevent invasion pirates 都归它管）
    expect(
      drawer.getByText('/worldevent invasion <goblins|snowmen|pirates|pumpkinmoon|frostmoon|martians>'),
    ).toBeTruthy()
    expect(drawer.getByText('入侵')).toBeTruthy()
    // 权限 / 能否网页执行 / 说明都来自 data/commands.json
    expect(drawer.getByText('tshock.world.events')).toBeTruthy()
    expect(drawer.getByText(/网页可执行/)).toBeTruthy()
    expect(drawer.getByText('允许你开始或停止各种世界事件。')).toBeTruthy()

    // 抽屉里也能直接填入
    fireEvent.click(drawer.getByRole('button', { name: /填入指令浮窗/ }))
    expect(inputValue()).toBe('/worldevent invasion goblins')
  })

  it('详情：只能游戏内执行的指令会写清楚', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    fireEvent.click(screen.getByRole('button', { name: '指令帮助：/register <password>' }))
    const drawer = within(screen.getByTestId('command-detail'))
    expect(drawer.getByText(/只能在游戏内执行/)).toBeTruthy()
    expect(drawer.getByText('tshock.account.register')).toBeTruthy()
    // 参考行没有「填入浮窗」，抽屉里也不给填入按钮
    expect(drawer.queryByRole('button', { name: /填入指令浮窗/ })).toBeNull()
  })

  it('指令列有最大宽度，悬停弹出完整指令的 Tooltip', async () => {
    renderPage()
    const cell = screen.getByText('/worldevent invasion pumpkinmoon')
    expect(cell.className).toContain('max-w-[11rem]')
    expect(cell.className).toContain('break-words')
    expect(cell.className).toContain('sm:truncate')

    fireEvent.pointerMove(cell, { pointerType: 'mouse' })
    fireEvent.pointerEnter(cell, { pointerType: 'mouse' })
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toBe('/worldevent invasion pumpkinmoon')

    // 指令列不再用原生 title（只留 Tooltip，避免两个提示叠在一起）
    expect(cell.getAttribute('title')).toBeNull()
  })

  it('世界相关的行与分类行都在表里，且分类行点一下不填浮窗', () => {
    renderPage()
    expect(table().getByText('世界事件')).toBeTruthy()
    expect(table().getByText('/worldevent <事件>')).toBeTruthy()
    expect(table().getByText('时间')).toBeTruthy()
    expect(table().getByText('/time <day|night|noon|midnight|hh:mm>')).toBeTruthy()
    expect(table().getByText('风')).toBeTruthy()
    expect(table().getByText('/wind <mph>（-40 ~ 40）')).toBeTruthy()

    fill('/time day')
    expect(inputValue()).toBe('/time day')

    fireEvent.click(table().getByText('/time <day|night|noon|midnight|hh:mm>'))
    fireEvent.click(table().getByText('时间'))
    expect(inputValue()).toBe('/time day')
  })

  it('搜索框按指令 / 名称过滤，没匹配就空态；搜索会清掉分组筛选', () => {
    renderPage()
    const search = screen.getByPlaceholderText('搜索指令或名称')

    fireEvent.change(search, { target: { value: 'bloodmoon' } })
    expect(table().getByText('/worldevent bloodmoon')).toBeTruthy()
    expect(table().queryByText('/worldevent eclipse')).toBeNull()
    expect(table().queryByText('世界模式')).toBeNull()

    // 中文名称也能搜
    fireEvent.change(search, { target: { value: '无风' } })
    expect(table().getByText('/wind 0')).toBeTruthy()
    expect(table().queryByText('/worldevent bloodmoon')).toBeNull()

    // 分类 / 语法也能搜：命中就整段留下
    fireEvent.change(search, { target: { value: '世界' } })
    expect(table().getByText('/worldmode expert')).toBeTruthy()
    expect(table().queryByText('/time day')).toBeNull()

    // 先选分组再搜索：搜索改回全部
    fireEvent.change(search, { target: { value: '' } })
    fireEvent.click(groupList().getByRole('button', { name: /^物品/ }))
    fireEvent.change(search, { target: { value: 'ban' } })
    expect(table().getByText('/ban list')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText('没有匹配的指令')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('/worldinfo 紧跟在 /evil 后面一行', () => {
    renderPage()
    const rows = screen.getAllByRole('row').map((row) => row.textContent ?? '')
    const evil = rows.findIndex((text) => text.includes('/evil'))
    const worldinfo = rows.findIndex((text) => text.includes('/worldinfo'))
    expect(evil).toBeGreaterThanOrEqual(0)
    expect(worldinfo).toBe(evil + 1)
  })

  it('事件 / 入侵二级 / 节日 / 世界模式 / 时间风 的指令都能填进浮窗', () => {
    renderPage()
    fill('/worldevent bloodmoon')
    expect(inputValue()).toBe('/worldevent bloodmoon')

    fill('/worldevent invasion goblins')
    expect(inputValue()).toBe('/worldevent invasion goblins')

    fill('/forcehalloween')
    expect(inputValue()).toBe('/forcehalloween')

    fill('/hardmode')
    expect(inputValue()).toBe('/hardmode')

    fill('/time day')
    expect(inputValue()).toBe('/time day')

    fill('/wind 20')
    expect(inputValue()).toBe('/wind 20')

    fill('/worldinfo')
    expect(inputValue()).toBe('/worldinfo')
  })

  it('刷怪率与无敌指令', () => {
    renderPage()
    expect(table().getByText('刷怪率')).toBeTruthy()
    fill('/maxspawns 5')
    expect(inputValue()).toBe('/maxspawns 5')
    fill('/spawnrate 600')
    expect(inputValue()).toBe('/spawnrate 600')
    fill('/godmode')
    expect(inputValue()).toBe('/godmode')
  })

  it('点 Boss 记录 → 打开浮窗并填入 /spawnboss <参数>，再点一条会覆盖', () => {
    renderPage()
    fill('/spawnboss "eye of cthulhu"')
    expect(screen.getByTestId('terminal-window')).toBeTruthy()
    expect(inputValue()).toBe('/spawnboss "eye of cthulhu"')

    fill('/spawnboss "king slime"')
    expect(inputValue()).toBe('/spawnboss "king slime"')
  })

  it('名称覆盖：twins 显示「双子魔眼」但参数仍是 twins', () => {
    renderPage()
    fill('/spawnboss twins')
    expect(inputValue()).toBe('/spawnboss twins')
  })

  it('召唤 NPC / 传送 NPC 的示例用 NPC ID 与英文名', () => {
    renderPage()
    fill('/spawnmob 22')
    expect(inputValue()).toBe('/spawnmob 22')
    fill('/spawnmob 368')
    expect(inputValue()).toBe('/spawnmob 368')

    fill('/tpnpc Angler')
    expect(inputValue()).toBe('/tpnpc Angler')
    fill('/tpnpc "Goblin Tinkerer"')
    expect(inputValue()).toBe('/tpnpc "Goblin Tinkerer"')
  })

  it('「在数据 ID → NPC 里查更多」跳到数据 ID 的 NPC tab', () => {
    const { onNavigate } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: /在数据 ID → NPC 里查更多/ }))
    expect(onNavigate).toHaveBeenCalledWith('dataid')
  })

  it('参考行：/give 的语法来自内置指令表，不可点填入，只能复制', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    const give = '/give <item type/id> <player> [item amount] [prefix id/name]'
    expect(table().getByText(give)).toBeTruthy()
    // 名称列直接用 TShock 的中文帮助（data/commands.json 的 helpZh）
    expect(table().getByText('给另一位玩家一件物品。')).toBeTruthy()

    // 没有「填入浮窗」按钮，只有复制 + 详情；点行也不会打开浮窗
    expect(screen.queryByRole('button', { name: `填入指令浮窗：${give}` })).toBeNull()
    expect(screen.getByRole('button', { name: `指令帮助：${give}` })).toBeTruthy()
    fireEvent.click(screen.getByText(give))
    expect(screen.queryByTestId('terminal-window')).toBeNull()

    // /item 是 allowServer=false：备注列标「仅游戏内」
    expect(table().getAllByText('仅游戏内').length).toBeGreaterThan(0)
    expect(table().getByText(/^\/item /)).toBeTruthy()
    expect(screen.getByRole('button', { name: `复制：${give}` })).toBeTruthy()
  })

  it('用户相关：账号 / 用户账号 / 封禁 / 禁言踢出 / 用户组', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    // 账号（只能在游戏内）
    fireEvent.click(groupList().getByRole('button', { name: /^账号（玩家自己）/ }))
    expect(table().getByText(/这四条只能在游戏内执行/)).toBeTruthy()
    expect(table().getByText('/register <password>')).toBeTruthy()

    // 用户账号：可点的 /user help + 参考行
    fireEvent.click(groupList().getByRole('button', { name: /^用户账号/ }))
    expect(table().getByText(/\/user add <用户名> <密码> <组>/)).toBeTruthy()
    expect(table().getByText('/accountinfo <username>')).toBeTruthy()
    fill('/user help')
    expect(inputValue()).toBe('/user help')

    // 封禁
    fireEvent.click(groupList().getByRole('button', { name: /^封禁/ }))
    expect(table().getByText(/\/ban add <目标> \[原因\]/)).toBeTruthy()
    expect(table().getByText(/默认 -a -u -ip/)).toBeTruthy()
    fill('/ban list')
    expect(inputValue()).toBe('/ban list')

    // 禁言 / 踢出 + 用户组（参考行来自内置指令表）
    fireEvent.click(groupList().getByRole('button', { name: /^禁言 \/ 踢出/ }))
    expect(table().getByText('/mute <player> [reason]')).toBeTruthy()
    expect(table().getByText('/kick <player> [reason]')).toBeTruthy()

    fireEvent.click(groupList().getByRole('button', { name: /^用户组/ }))
    expect(table().getByText('/group add <group name> [permissions]')).toBeTruthy()
  })

  it('权限配置：给 default 组开 WebUI / 插件权限，点一条填进浮窗', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    fireEvent.click(groupList().getByRole('button', { name: /^权限配置/ }))

    // 分区语法行：权限名带占位符，所以只给复制
    expect(table().getByText(/\/group addperm <组> <权限\.\.\.>/)).toBeTruthy()
    expect(table().getByText(/\/user group <玩家> <组>/)).toBeTruthy()

    // 具体行（命令原文见 notes.md）
    expect(
      table().getByText('/group addperm default tshock.rest.useapi tshock.rest.command'),
    ).toBeTruthy()
    expect(table().getByText('/group add GM * !tshock.ignore.ssc')).toBeTruthy()
    expect(table().getByText('/group addperm default tshock.tp.home')).toBeTruthy()
    expect(table().getByText('/group addperm default hf.recipe hf.search')).toBeTruthy()
    expect(table().getByText('/group addperm default worldinfo bossinfo')).toBeTruthy()
    expect(table().getByText('/group addperm default lookbag')).toBeTruthy()

    // 点了就填进浮窗（不自动执行）
    fill('/group addperm default lookbag')
    expect(inputValue()).toBe('/group addperm default lookbag')

    // 详情蘸屉：来自内置 /group，权限与执行位置照旧从 data/commands.json 取
    fireEvent.click(
      screen.getByRole('button', { name: '指令帮助：/group addperm default lookbag' }),
    )
    const drawer = within(screen.getByTestId('command-detail'))
    expect(drawer.getByText('tshock.admin.group')).toBeTruthy()
    expect(drawer.getByText(/网页可执行/)).toBeTruthy()
  })

  it('表格不在卡片里，也不自己滚：整页交给 AppShell 的 `<main>`', () => {
    renderPage()
    const root = screen.getByTestId('command-tips-page')
    // 整页滚动：页面不固定高度、不裁切，滚动条是浏览器右侧那条。
    expect(root.className).not.toContain('overflow-hidden')
    expect(root.querySelector('[data-slot="card"]')).toBeNull()

    const table = screen.getByRole('table')
    // 表格的容器不再溢出滚动（滚动交给 `<main>`）。
    expect(table.parentElement?.className).not.toContain('overflow-y-auto')
    // 搜索框仍在这个容器之外（它吸在顶栏下面）。
    const search = screen.getByPlaceholderText('搜索指令或名称')
    expect(table.parentElement?.contains(search)).toBe(false)
    expect(root.contains(search)).toBe(true)
  })
})
