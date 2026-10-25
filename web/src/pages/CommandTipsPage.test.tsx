import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandTerminal } from '@/components/CommandTerminal'
import { makeDataset } from '@/test/fixtures'
import { I18nProvider } from '@/lib/i18n'
import { TerminalProvider } from '@/lib/terminalContext'
import { playerStubs } from '@/test/playerStubs'
import type { BackendTransport } from '@/lib/tshock'
import type { Dataset, Settings } from '@/types'
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

function makeTestDataset(): Dataset {
  const base = makeDataset()
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

/** 切到「NPC管理」tab（Radix Tabs 用 mousedown 激活）。 */
function openNpcTab() {
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'NPC管理' }))
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

  it('三个 tab：默认 / NPC管理 / 指令库（下划线样式）', () => {
    renderPage()
    const tabs = screen.getByRole('tablist')
    expect(within(tabs).getByRole('tab', { name: '默认' })).toBeTruthy()
    expect(within(tabs).getByRole('tab', { name: 'NPC管理' })).toBeTruthy()
    expect(within(tabs).getByRole('tab', { name: '指令库' })).toBeTruthy()
    // 默认 tab 是事件 / 世界模式 / 时间三张卡
    expect(screen.getByText('/worldevent <事件>')).toBeTruthy()
    expect(screen.getByText('入侵（/worldevent invasion <类型>）')).toBeTruthy()
    // 表格：指令在第一列
    expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('columnheader')[0].textContent).toBe('指令')
    expect(screen.getByText('世界模式')).toBeTruthy()
    expect(screen.getByText('/worldmode <normal|expert|master|journey>')).toBeTruthy()
    expect(screen.getByText('时间 / 风 / 世界信息')).toBeTruthy()
  })

  it('默认 tab：事件 / 入侵二级 / 节日 / 世界模式 / 时间风 的指令都能填进浮窗', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /\/worldevent bloodmoon/ }))
    expect(inputValue()).toBe('/worldevent bloodmoon')

    fireEvent.click(screen.getByRole('button', { name: /\/worldevent invasion goblins/ }))
    expect(inputValue()).toBe('/worldevent invasion goblins')

    fireEvent.click(screen.getByRole('button', { name: /\/forcehalloween/ }))
    expect(inputValue()).toBe('/forcehalloween')

    fireEvent.click(screen.getByRole('button', { name: /\/hardmode/ }))
    expect(inputValue()).toBe('/hardmode')

    fireEvent.click(screen.getByRole('button', { name: /\/time day$/ }))
    expect(inputValue()).toBe('/time day')

    fireEvent.click(screen.getByRole('button', { name: /\/wind 20$/ }))
    expect(inputValue()).toBe('/wind 20')

    fireEvent.click(screen.getByRole('button', { name: /\/worldinfo/ }))
    expect(inputValue()).toBe('/worldinfo')
  })

  it('NPC管理 tab：刷怪率与无敌指令', () => {
    renderPage()
    openNpcTab()
    expect(screen.getByText('刷怪率')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /\/maxspawns 5/ }))
    expect(inputValue()).toBe('/maxspawns 5')
    fireEvent.click(screen.getByRole('button', { name: /\/spawnrate 600/ }))
    expect(inputValue()).toBe('/spawnrate 600')
    fireEvent.click(screen.getByRole('button', { name: /\/godmode$/ }))
    expect(inputValue()).toBe('/godmode')
  })

  it('三张卡片：召唤 Boss / 召唤 NPC / 传送 NPC', () => {
    renderPage()
    openNpcTab()
    expect(screen.getByText('/spawnboss <Boss> [数量]')).toBeTruthy()
    expect(screen.getByText('/spawnmob <NPC 名称或 ID> [数量]')).toBeTruthy()
    expect(screen.getByText('/tpnpc <NPC 名称>')).toBeTruthy()
  })

  it('指令库 tab：列出全部指令，点一条填进浮窗', async () => {
    renderPage()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '指令库' }))
    const row = await screen.findByTitle('Shows command help.')
    fireEvent.click(row)
    const input = screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement
    expect(input.value).toBe('/help ')
  })

  it('点 Boss 记录 → 打开浮窗并填入 /spawnboss <参数>', () => {
    renderPage()
    openNpcTab()
    fireEvent.click(screen.getByRole('button', { name: /\/spawnboss "eye of cthulhu"/ }))
    expect(screen.getByTestId('terminal-window')).toBeTruthy()
    expect(inputValue()).toBe('/spawnboss "eye of cthulhu"')
  })

  it('再点一条会覆盖（不累加）', () => {
    renderPage()
    openNpcTab()
    fireEvent.click(screen.getByRole('button', { name: /\/spawnboss "eye of cthulhu"/ }))
    fireEvent.click(screen.getByRole('button', { name: /\/spawnboss "king slime"/ }))
    expect(inputValue()).toBe('/spawnboss "king slime"')
  })

  it('名称覆盖：twins 显示「双子魔眼」但参数仍是 twins', () => {
    renderPage()
    openNpcTab()
    fireEvent.click(screen.getByRole('button', { name: /\/spawnboss twins/ }))
    expect(inputValue()).toBe('/spawnboss twins')
  })

  it('召唤 NPC 示例用 NPC ID（向导 22 / 旅商 368）', () => {
    renderPage()
    openNpcTab()
    fireEvent.click(screen.getByRole('button', { name: /向导\s*#22/ }))
    expect(inputValue()).toBe('/spawnmob 22')
    fireEvent.click(screen.getByRole('button', { name: /旅商\s*#368/ }))
    expect(inputValue()).toBe('/spawnmob 368')
  })

  it('传送 NPC 示例：渔夫 / 哥布林工匠（/tpnpc 只认名称）', () => {
    renderPage()
    openNpcTab()
    fireEvent.click(screen.getByRole('button', { name: /渔夫\s*#369/ }))
    expect(inputValue()).toBe('/tpnpc Angler')
    fireEvent.click(screen.getByRole('button', { name: /哥布林工匠\s*#107/ }))
    expect(inputValue()).toBe('/tpnpc "Goblin Tinkerer"')
  })

  it('「在数据 ID → NPC 里查更多」跳到数据 ID 的 NPC tab', () => {
    const { onNavigate } = renderPage()
    openNpcTab()
    fireEvent.click(screen.getByRole('button', { name: /在数据 ID → NPC 里查更多/ }))
    expect(onNavigate).toHaveBeenCalledWith('dataid')
  })
})
