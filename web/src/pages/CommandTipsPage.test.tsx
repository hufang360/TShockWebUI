import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
 * 默认用 fixture 的少量指令（jsdom 渲染几百行表格很慢）；
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

/** 展开所有折叠组（`/worldevent …`、`/worldmode …` 这类同前缀的行默认收起）。 */
function expandAllGroups() {
  for (const button of screen.getAllByRole('button', { expanded: false })) {
    fireEvent.click(button)
  }
}

function findRow(selector: 'data-command' | 'data-fold', value: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>(`tr[${selector}]`)].find(
      (el) => el.getAttribute(selector) === value,
    ) ?? null
  )
}

/** 单击一行（折叠组里的行先展开）→ 右侧详情抽屉。 */
function openDetail(command: string) {
  if (!findRow('data-command', command)) expandAllGroups()
  const row = findRow('data-command', command)
  if (!row) throw new Error(`找不到行：${command}`)
  fireEvent.click(row)
  return within(screen.getByTestId('command-detail'))
}

/** 单击一行 → 详情里「执行」（实际只是填进浮窗，不自动跑）。 */
function fill(command: string) {
  const drawer = openDetail(command)
  fireEvent.click(drawer.getByRole('button', { name: /执行/ }))
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
  it('权限提示收进标题旁的 ⓘ（首次自动展开，可关闭）', async () => {
    renderPage()
    const help = /各指令权限不同，由服务器判定/
    // 默认展开：说明就在正文顶部。
    expect(await screen.findByText(help)).toBeTruthy()
    expect(screen.getByText(/不会自动执行/)).toBeTruthy()
    // 关闭后不再自动显示（状态记在本机）。
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByText(help)).toBeNull())
    expect(JSON.parse(localStorage.getItem('tswui:helpClosed') ?? '{}')).toEqual({ tips: true })

    // 再点标题旁的 ⓘ 又能打开。
    fireEvent.click(screen.getByRole('button', { name: '页面说明' }))
    expect(await screen.findByText(help)).toBeTruthy()
  })

  it('没有顶部 tab：左边搜索框，右边分组栏', () => {
    renderPage()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByPlaceholderText('搜索指令或名称')).toBeTruthy()

    // 分组栏：全部指令 + 各分组（世界 / NPC / 物品 / 增益 / 玩家账号 / 服务器 …）
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
      '玩家账号',
      '封禁',
      '用户组',
      '权限配置',
      '服务器与权限',
      '聊天与统计',
    ]) {
      expect(groups.getByRole('button', { name: new RegExp(title) })).toBeTruthy()
    }
    // 账号 / 用户账号 已合并，禁言 / 踢出 并入封禁
    expect(groups.queryByRole('button', { name: /^用户账号/ })).toBeNull()
    expect(groups.queryByRole('button', { name: /^禁言/ })).toBeNull()
  })

  it('点分组只显示那一组（再点「全部指令」回到全部）', () => {
    renderPage()
    fireEvent.click(groupList().getByRole('button', { name: /^物品/ }))
    // `/give` + `/item` 折成一行
    expect(findRow('data-fold', '/give')).toBeTruthy()
    expect(table().queryByText('召唤 Boss')).toBeNull()

    fireEvent.click(groupList().getByRole('button', { name: /全部指令/ }))
    expect(table().getByText('召唤 Boss')).toBeTruthy()
  })

  it('主表不显示指令语法，也没有操作列和分组行', () => {
    renderPage()
    // 指令语法只在详情里
    expect(table().queryByText('/worldevent <事件>')).toBeNull()
    expect(table().queryByText('/time <day|night|noon|midnight|hh:mm>')).toBeNull()
    expect(table().queryByText('/wind <mph>（-40 ~ 40）')).toBeNull()

    // 分组标题不单独占一行，而是折叠行的说明
    expect(findRow('data-fold', '/worldevent')?.textContent).toContain('/worldevent世界事件')
    expect(findRow('data-fold', '/worldevent invasion')?.textContent).toContain(
      '/worldevent invasion入侵',
    )
    // 没有分组行（表格里只剩行，不再有「世界事件」这类跨列标题）
    expect(screen.getByRole('table').querySelector('[scope="colgroup"]')).toBeNull()

    // 表头：指令 / 说明（含原备注）/ 权限
    const headers = [...screen.getByRole('table').querySelectorAll('thead th')].map(
      (th) => th.textContent,
    )
    expect(headers).toEqual(['指令', '说明', '权限'])
  })

  it('同一前缀的指令默认折叠，点一下展开 / 收起', () => {
    renderPage()
    // `/worldevent invasion` 的 6 条收成一行，说明就是分组标题
    expect(findRow('data-command', '/worldevent invasion goblins')).toBeNull()
    const fold = findRow('data-fold', '/worldevent invasion')
    expect(fold?.textContent).toContain('/worldevent invasion入侵')

    // 世界模式也是折叠组
    expect(findRow('data-fold', '/worldmode')?.textContent).toContain('/worldmode世界模式')
    // 组里有同名指令时（`/worldevent rain`），说明用它的名称而不是分区标题
    expect(findRow('data-fold', '/worldevent rain')?.textContent).toContain('/worldevent rain雨')
    expect(findRow('data-command', '/worldmode expert')).toBeNull()

    fireEvent.click(fold!)
    const child = findRow('data-command', '/worldevent invasion goblins')
    expect(child).toBeTruthy()
    // 展开后子行显示完整指令
    expect(child?.textContent).toContain('/worldevent invasion goblins')
    expect(child?.textContent).toContain('哥布林入侵')

    fireEvent.click(fold!)
    expect(findRow('data-command', '/worldevent invasion goblins')).toBeNull()
  })

  it('单击表格即显示详情：行本身不直接填浮窗', () => {
    renderPage()
    const drawer = openDetail('/hardmode')
    expect(drawer.getByText('指令详情')).toBeTruthy()
    // 指令和说明都在正文里（不在顶栏）
    expect(drawer.getByText('/hardmode')).toBeTruthy()
    expect(drawer.getByText('切换困难模式')).toBeTruthy()
    expect(screen.queryByTestId('terminal-window')).toBeNull()

    fireEvent.click(drawer.getByRole('button', { name: /执行/ }))
    expect(inputValue()).toBe('/hardmode')
  })

  it('多子项的指令折成一行（/warp /region /itemban /projban /tileban /group /tp /death）', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    for (const stem of [
      '/warp',
      '/region',
      '/itemban',
      '/projban',
      '/tileban',
      '/group',
      '/tp',
      '/death',
    ]) {
      expect(findRow('data-fold', stem)).toBeTruthy()
    }
    // 子命令默认收起
    expect(findRow('data-command', '/region define <name>')).toBeNull()
    expect(findRow('data-command', '/group addperm <group> <permission>')).toBeNull()
    expect(findRow('data-command', '/pvpdeath')).toBeNull()

    expandAllGroups()
    expect(findRow('data-command', '/region define <name>')).toBeTruthy()
    expect(findRow('data-command', '/pvpdeath')).toBeTruthy()
  })

  it('只能在游戏内执行的指令用红色标出', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    // `/give` + `/item` 折成一行，展开后看子行：/item 只能在游戏内
    expandAllGroups()
    const item = screen.getByText('/item <item name/id> [item amount] [prefix id/name]')
    expect(item.className).toContain('text-destructive')
    // 网页可执行的保持普通颜色
    const give = screen.getByText('/give <item type/id> <player> [item amount] [prefix id/name]')
    expect(give.className).toContain('text-foreground')

    // 折叠行整组都只能在游戏内 → 前缀标红，且备注只写在折叠行
    const boss = findRow('data-fold', '/spawnboss')
    expect(boss?.querySelector('span.font-mono')?.className).toContain('text-destructive')
    expect(boss?.textContent).toContain('仅游戏内')
    const time = findRow('data-fold', '/time')
    expect(time?.querySelector('span.font-mono')?.className).toContain('text-foreground')

    const bossChild = findRow('data-command', '/spawnboss "king slime"')
    expect(bossChild?.textContent).not.toContain('仅游戏内')
  })

  it('详情是居中 dialog（宽度够放长指令），点遮罩或 × 关闭', async () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    openDetail('/worldevent invasion goblins')
    const dialog = await screen.findByTestId('command-detail')

    // 不再是右侧抽屉（抽屉太窄，指令语法 / 权限会频繁折行）
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull()
    expect(dialog.className).toContain('max-w-lg')
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeTruthy()

    // 打开时焦点落在弹框本身，不落在指令旁的复制键上
    expect(document.activeElement).toBe(dialog)
    expect(document.activeElement).not.toBe(within(dialog).getByTestId('command-detail-copy'))

    // 右上角 × 关掉
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByTestId('command-detail')).toBeNull())
  })

  it('详情 dialog：指令 / 说明 / 指令语法 / 权限', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    const drawer = openDetail('/worldevent invasion goblins')
    expect(drawer.getByText('指令详情')).toBeTruthy()
    // 指令块有复制按钮
    expect(drawer.getByTestId('command-detail-copy')).toBeTruthy()
    expect(drawer.getByText('哥布林入侵')).toBeTruthy()
    // 同一类指令的语法（这一条和 /worldevent invasion pirates 都归它管）
    expect(
      drawer.getByText('/worldevent invasion <goblins|snowmen|pirates|pumpkinmoon|frostmoon|martians>'),
    ).toBeTruthy()
    expect(drawer.queryByText(/分组/)).toBeNull()
    // 权限 / 能否网页执行 / 说明都来自 data/commands.json
    expect(drawer.getByText('tshock.world.events')).toBeTruthy()
    // 权限块也有复制按钮
    expect(drawer.getByTestId('command-detail-permission-copy')).toBeTruthy()

    // 详情里也能直接填进浮窗
    fireEvent.click(drawer.getByRole('button', { name: /执行/ }))
    expect(inputValue()).toBe('/worldevent invasion goblins')
  })

  it('详情：只能游戏内执行的指令用红字 + 「仅游戏内」徽标', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    const drawer = openDetail('/register <password>')
    const command = drawer.getByText('/register <password>')
    expect(command.className).toContain('text-destructive')
    expect(drawer.getByText('仅游戏内')).toBeTruthy()
    expect(drawer.getByText('tshock.account.register')).toBeTruthy()
    // 这几条不再显示「指令语法」与「使用提示」
    expect(drawer.queryByText('指令语法')).toBeNull()
    expect(drawer.queryByText('使用提示')).toBeNull()
    // 参考行没有「执行」，详情里也不给按钮
    expect(drawer.queryByRole('button', { name: /执行/ })).toBeNull()
  })

  it('指令列有最大宽度，悬停弹出完整指令的 Tooltip', async () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    const command = '/group addperm default tshock.rest.useapi tshock.rest.command'
    // 权限配置里的长指令归在 /group 折叠组里，先展开
    expandAllGroups()
    const cell = screen.getByText(command)
    expect(cell.className).toContain('max-w-[11rem]')
    // 单行、超出省略（不再换行）
    expect(cell.className).toContain('truncate')

    fireEvent.pointerMove(cell, { pointerType: 'mouse' })
    fireEvent.pointerEnter(cell, { pointerType: 'mouse' })
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toBe(command)

    // 指令列不再用原生 title（只留 Tooltip，避免两个提示叠在一起）
    expect(cell.getAttribute('title')).toBeNull()
  })

  it('搜索框按指令 / 名称过滤，没匹配就空态；搜索会清掉分组筛选', () => {
    renderPage()
    const search = screen.getByPlaceholderText('搜索指令或名称')

    fireEvent.change(search, { target: { value: 'bloodmoon' } })
    expect(table().getByText('/worldevent bloodmoon')).toBeTruthy()
    expect(table().queryByText('/worldevent eclipse')).toBeNull()
    expect(table().queryByText('世界模式')).toBeNull()

    // 中文名称也能搜
    fireEvent.change(search, { target: { value: '反向风' } })
    expect(table().getByText('/wind -20')).toBeTruthy()
    expect(table().queryByText('/worldevent bloodmoon')).toBeNull()

    // 分类 / 语法也能搜：命中就整段留下，且自动展开折叠组
    fireEvent.change(search, { target: { value: '世界模式' } })
    expect(table().getByText('/worldmode')).toBeTruthy()
    expect(findRow('data-command', '/worldmode expert')).toBeTruthy()
    expect(table().queryByText('/time')).toBeNull()

    // 先选分组再搜索：搜索改回全部
    fireEvent.change(search, { target: { value: '' } })
    fireEvent.click(groupList().getByRole('button', { name: /^物品/ }))
    fireEvent.change(search, { target: { value: 'ban' } })
    expect(table().getByText('/ban')).toBeTruthy()
    expect(findRow('data-command', '/ban list')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText('没有匹配的指令')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('每个分区的指令按 a~z 排序', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    // 世界模式分区（折叠行用前缀参与排序）：/evil → /hardmode → /worldinfo → /worldmode
    fireEvent.click(groupList().getByRole('button', { name: /^世界模式/ }))
    const shown = [...screen.getByRole('table').querySelectorAll('tbody tr')].map(
      (tr) => tr.querySelector('span.font-mono')?.textContent ?? '',
    )
    expect(shown).toEqual(['/evil', '/hardmode', '/worldinfo', '/worldmode'])
  })

  it('事件 / 入侵二级 / 节日 / 世界模式 / 时间风 的指令都能填进浮窗', () => {
    renderPage()
    fill('/worldevent bloodmoon')
    expect(inputValue()).toBe('/worldevent bloodmoon')

    fill('/worldevent invasion goblins')
    expect(inputValue()).toBe('/worldevent invasion goblins')

    fill('/forcehalloween')
    expect(inputValue()).toBe('/forcehalloween')

    fill('/worldmode expert')
    expect(inputValue()).toBe('/worldmode expert')

    fill('/time day')
    expect(inputValue()).toBe('/time day')

    fill('/wind 20')
    expect(inputValue()).toBe('/wind 20')

    fill('/worldinfo')
    expect(inputValue()).toBe('/worldinfo')
  })

  it('刷怪率与无敌指令', () => {
    renderPage()
    expect(findRow('data-fold', '/maxspawns')?.textContent).toContain('刷怪率')
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

  it('参考行：/give 的语法来自内置指令表，详情里只能复制', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    // `/give` + `/item` 折成一行，展开才看得到各自语法
    expandAllGroups()
    const give = '/give <item type/id> <player> [item amount] [prefix id/name]'
    expect(table().getByText(give)).toBeTruthy()
    // 说明列用 TShock 的中文帮助（data/commands.json 的 helpZh）
    expect(table().getByText('给另一位玩家一件物品。')).toBeTruthy()
    // /item 是 allowServer=false：说明列里跟一句「仅游戏内」（备注已并入说明）
    expect(table().getAllByText(/仅游戏内/).length).toBeGreaterThan(0)
    expect(table().getByText(/^\/item /)).toBeTruthy()

    const dialog = openDetail(give)
    expect(dialog.queryByRole('button', { name: /执行/ })).toBeNull()
    // 指令块上的复制按钮（点了不会填浮窗）
    fireEvent.click(dialog.getByTestId('command-detail-copy'))
    expect(screen.queryByTestId('terminal-window')).toBeNull()
  })

  it('玩家账号 / 封禁 / 用户组：分组提示收在详情里', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    // 玩家账号 = 原来的「账号（玩家自己）」+「用户账号」
    fireEvent.click(groupList().getByRole('button', { name: /^玩家账号/ }))
    expect(table().queryByText(/这四条只能在游戏内执行/)).toBeNull()
    expect(table().getByText('/register <password>')).toBeTruthy()
    expect(table().getByText('/accountinfo <username>')).toBeTruthy()

    // 自助指令各说各的：不套分区的语法与提示
    const accountDetail = openDetail('/register <password>')
    expect(accountDetail.queryByText('使用提示')).toBeNull()
    expect(accountDetail.queryByText('指令语法')).toBeNull()
    fireEvent.click(accountDetail.getByRole('button', { name: 'Close' }))

    fill('/user help')
    expect(inputValue()).toBe('/user help')

    // 封禁 = 原来的「封禁」+「禁言 / 踢出」
    fireEvent.click(groupList().getByRole('button', { name: /^封禁/ }))
    expect(table().queryByText(/默认 -a -u -ip/)).toBeNull()
    expect(table().getByText('/mute <player> [reason]')).toBeTruthy()
    expect(table().getByText('/kick <player> [reason]')).toBeTruthy()
    // `/kick` `/mute` 不套 `/ban` 的语法与提示
    const muteDetail = openDetail('/mute <player> [reason]')
    expect(muteDetail.queryByText('指令语法')).toBeNull()
    expect(muteDetail.queryByText('使用提示')).toBeNull()
    fireEvent.click(muteDetail.getByRole('button', { name: 'Close' }))

    // `/ban` 自己的提示还在
    const banDetail = openDetail('/ban list')
    expect(banDetail.getByText(/默认 -a -u -ip/)).toBeTruthy()
    fireEvent.click(banDetail.getByRole('button', { name: 'Close' }))

    fill('/ban list')
    expect(inputValue()).toBe('/ban list')

    fireEvent.click(groupList().getByRole('button', { name: /^用户组/ }))
    // /group 的 10 个子命令折成一行，展开才看得到
    expect(findRow('data-command', '/group add <group name> [permissions]')).toBeNull()
    expandAllGroups()
    expect(table().getByText('/group add <group name> [permissions]')).toBeTruthy()
  })

  it('权限配置：给 default 组开 WebUI / 插件权限，点一条填进浮窗', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    fireEvent.click(groupList().getByRole('button', { name: /^权限配置/ }))
    // 整个分组只剩两行：内置 /group（含 TShock 权限那两条）和插件权限的「hf 常用」
    expect(findRow('data-fold', '/group')).toBeTruthy()
    expect(findRow('data-fold', 'hf 常用')).toBeTruthy()
    expect(findRow('data-command', '/group addperm default lookbag')).toBeNull()

    expandAllGroups()
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

    // 带占位符的指令语法只在详情里；权限照旧从 data/commands.json 取
    const drawer = openDetail('/group addperm default lookbag')
    expect(drawer.getByText(/\/group addperm <组> <权限\.\.\.>/)).toBeTruthy()
    expect(drawer.getByText('tshock.admin.group')).toBeTruthy()
  })

  it('主表有权限列：没有权限写 `-`，折叠行整组一致才显示', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    // 折叠行整组权限一致 → 显示那一个
    expect(findRow('data-fold', '/time')?.textContent).toContain('tshock.world.time.set')

    fireEvent.click(groupList().getByRole('button', { name: /^服务器与权限/ }))
    const cells = (command: string) => {
      const row = findRow('data-command', command)
      if (!row) throw new Error(`找不到行：${command}`)
      return [...row.querySelectorAll('td')].map((td) => td.textContent)
    }
    // 有权限照写，无权限（`/help`）写 `-`
    expect(cells('/save').at(2)).toBe('tshock.world.save')
    expect(cells('/help <command/page>').at(2)).toBe('-')
  })

  it('同一条指令的两个方向也折叠：/give 收 /item、/buff 收 /gbuff', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    for (const stem of ['/give', '/buff']) {
      expect(findRow('data-fold', stem)).toBeTruthy()
    }
    // 展开后子行仍是完整指令
    expandAllGroups()
    expect(findRow('data-command', '/item <item name/id> [item amount] [prefix id/name]')).toBeTruthy()
    expect(findRow('data-command', '/gbuff <player> <buff> [duration]')).toBeTruthy()
  })

  it('说明列把备注并进来（列名「说明」、内容 `主说明 · 备注`）', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    const headers = [...screen.getByRole('table').querySelectorAll('thead th')].map(
      (th) => th.textContent,
    )
    expect(headers).toEqual(['指令', '说明', '权限'])

    // `/home` 只能游戏内 → 说明里跟一句「仅游戏内」；`/worldinfo` 能在网页跑 → 不带
    const home = [...(findRow('data-command', '/home')?.querySelectorAll('td') ?? [])].map(
      (td) => td.textContent ?? '',
    )
    expect(home[1]).toContain('将你传送到你的出生点。')
    expect(home[1]).toContain('仅游戏内')
    const worldinfo = [...(findRow('data-command', '/worldinfo')?.querySelectorAll('td') ?? [])].map(
      (td) => td.textContent ?? '',
    )
    expect(worldinfo[1]).not.toContain('仅游戏内')
  })

  it('详情：节日开关互相关联，并关联 /worldevent', () => {
    renderPage()
    const drawer = openDetail('/forcehalloween')
    expect(drawer.getByText('相关指令（2）')).toBeTruthy()
    // 关联按钮显示指令名（`/worldevent` 一族取第一行，但标签不变）
    expect(drawer.getByRole('button', { name: '/forcexmas' })).toBeTruthy()
    const worldevent = drawer.getByRole('button', { name: '/worldevent' })
    fireEvent.click(worldevent)
    // 点了切到世界事件那一条（不关弹框）：取的是该族第一行
    const next = within(screen.getByTestId('command-detail'))
    expect(next.getByRole('button', { name: '/forcexmas' })).toBeTruthy()
  })

  it('详情：参数是 NPC 的指令给「在数据 ID → NPC 里查更多」入口', () => {
    const { onNavigate } = renderPage()
    const drawer = openDetail('/spawnboss twins')
    fireEvent.click(drawer.getByRole('button', { name: /在数据 ID → NPC 里查更多/ }))
    expect(onNavigate).toHaveBeenCalledWith('dataid')

    // 不是 NPC 指令就没有这个入口
    const other = openDetail('/hardmode')
    expect(other.queryByRole('button', { name: /在数据 ID → NPC 里查更多/ })).toBeNull()
  })

  it('详情：相关指令点了会切到那一条（不关弹框）', () => {
    renderPage()
    const drawer = openDetail('/maxspawns 5')
    expect(drawer.getByText('相关指令（1）')).toBeTruthy()
    fireEvent.click(drawer.getByRole('button', { name: '/spawnrate' }))

    const next = within(screen.getByTestId('command-detail'))
    expect(next.getByText('/spawnrate')).toBeTruthy()
    expect(next.getByText('查询刷怪率')).toBeTruthy()
  })

  it('详情：别名单独一行（上标签、下别名）', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    const drawer = openDetail('/godmode')
    expect(drawer.getByText('别名').tagName).toBe('DT')
    expect(drawer.getByText('/god')).toBeTruthy()
  })

  it('没有语法的指令不在详情里编语法', () => {
    renderPage()
    for (const command of ['/hardmode', '/evil', '/worldinfo', '/forcehalloween', '/forcexmas']) {
      const drawer = openDetail(command)
      expect(drawer.queryByText('指令语法')).toBeNull()
      fireEvent.click(drawer.getByRole('button', { name: 'Close' }))
    }
  })

  it('刷怪率：/maxspawns 与 /spawnrate 各显示自己的语法', () => {
    renderPage()
    let drawer = openDetail('/maxspawns 5')
    expect(drawer.getByText('/maxspawns [数量|default]')).toBeTruthy()
    expect(drawer.queryByText('/spawnrate [数量|default]')).toBeNull()
    fireEvent.click(drawer.getByRole('button', { name: 'Close' }))

    drawer = openDetail('/spawnrate 600')
    expect(drawer.getByText('/spawnrate [数量|default]')).toBeTruthy()
    expect(drawer.queryByText('/maxspawns [数量|default]')).toBeNull()
  })

  it('多子项参考行的说明用子命令标签（/warp /region /itemban /projban /tileban /group）', () => {
    renderPage(makeTestDataset({ commands: realCommands }))
    expandAllGroups()
    for (const label of [
      '定义区域',
      '添加传送点',
      '添加物品禁令',
      '添加弹幕禁令',
      '添加图格禁令',
      '列出用户组权限',
    ]) {
      expect(table().getByText(label)).toBeTruthy()
    }
    // 首行没有子命令标签时仍用 TShock 中文帮助
    expect(table().getByText('将你传送到一个传送点或者管理传送点。')).toBeTruthy()
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
