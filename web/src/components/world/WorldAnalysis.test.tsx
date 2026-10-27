import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DatasetProvider } from '@/lib/datasetContext'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import type { WorldInfo } from '@/lib/save/worldFile'
import type { WorldSections } from '@/lib/save/worldStats'
import type { WorldTileStats } from '@/lib/save/worldThumb'
import { WorldAnalysis } from './WorldAnalysis'

const zone = (key: 'surface' | 'underground' | 'cavern' | 'underworld', total: number, air: number) => ({
  key,
  total,
  air,
  tiles: new Map<number, number>(),
  liquid: { water: 0, lava: 0, honey: 0, shimmer: 0 },
})

const stats = (over: Partial<WorldTileStats> = {}): WorldTileStats => ({
  tiles: new Map([
    [1, 60], // 石头（代表物品 3）
    [0, 30], // 土（代表物品 2）
    [5, 10], // 其它
  ]),
  walls: new Map([[1, 20]]),
  air: 100,
  liquid: { water: 12, lava: 0, honey: 0, shimmer: 0 },
  total: 200,
  zoneBounds: [0, 50, 120, 180],
  zones: [zone('surface', 50, 50), zone('underground', 70, 20), zone('cavern', 60, 10), zone('underworld', 20, 0)],
  ...over,
})

const sections = (over: Partial<WorldSections> = {}): WorldSections => ({
  chests: 2,
  chestList: [
    { x: 1, y: 6, name: '宝箱', items: [{ slot: 0, id: 29, stack: 3, prefix: 0 }, { slot: 1, id: 75, stack: 99, prefix: 0 }], capacity: 40 },
    { x: 2, y: 6, name: '', items: [{ slot: 0, id: 29, stack: 2, prefix: 0 }], capacity: 40 },
  ],
  signList: [{ x: 3, y: 2, text: '你好' }],
  npcList: [{ netId: 22, name: '向导', x: 100, y: 100, homeX: 50, homeY: 20, homeless: false }],
  chestItems: new Map([
    [29, 5],
    [75, 3],
  ]),
  chestItemKinds: 2,
  signs: 1,
  npcs: 3,
  tileEntities: 4,
  ...over,
})

const worldInfo: WorldInfo = {
  release: 326,
  revision: 3,
  favorite: false,
  name: '休渔期',
  seed: 'seed-42',
  worldGenVersion: 0,
  guid: '',
  worldId: 4242,
  width: 100,
  height: 200,
  gameMode: 1,
  specialSeeds: [],
  evil: 'corruption',
  hardmode: true,
  bossesDowned: ['eyeOfCthulhu'],
  spawn: { x: 10, y: 20 },
  dungeon: { x: 30, y: 40 },
  groundLevel: 50,
  rockLevel: 70,
  createdAt: null,
  lastPlayed: null,
  time: 0,
  dayTime: true,
  moonPhase: 1,
  bloodMoon: false,
  eclipse: false,
}

function renderPanel(s = stats(), sec = sections()) {
  return render(
    <I18nProvider lang="zh">
      <DatasetProvider value={makeDataset()}>
        <WorldAnalysis info={worldInfo} stats={s} sections={sec} />
      </DatasetProvider>
    </I18nProvider>,
  )
}

describe('WorldAnalysis（地图分析）', () => {
  it('显示空气占比、液体与各段计数', () => {
    renderPanel()
    expect(screen.getByText('地图分析')).toBeTruthy()
    expect(screen.getByText('共 200 格 · 3 种图格')).toBeTruthy()
    expect(screen.getByText('50.0%')).toBeTruthy() // 空气 100 / 200
    expect(screen.getByText('12')).toBeTruthy() // 水量（只显示 > 0 的液体）
    expect(screen.queryByText('岩浆')).toBeNull()
    expect(screen.getByText('2')).toBeTruthy() // 箱子
    expect(screen.getByText('4')).toBeTruthy() // 图格实体
  })

  it('图格按数量降序，名字用代表物品的本地化名（拿不到物品名才回退常量名）', () => {
    const { container } = renderPanel()
    const rows = [...container.querySelectorAll('[data-testid="analysis-tiles"] > li')]
    // fixture 里图格 1 的代表物品是 29（生命水晶）→ 显示物品名而不是常量名 Stone
    void screen
    expect(rows[0].textContent).toContain('生命水晶')
    expect(rows[0].textContent).toContain('60')
    expect(rows[0].textContent).toContain('30.0%')
    // 图格 0 没有代表物品 → 回退常量名 Dirt
    expect(rows[1].textContent).toContain('Dirt')
  })

  it('墙体默认折叠，点开后显示', () => {
    const { container } = renderPanel()
    expect(container.querySelector('[data-testid="analysis-walls"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /墙体（1 种）/ }))
    expect(container.querySelectorAll('[data-testid="analysis-walls"] > li').length).toBe(1)
  })

  it('段计数读不到（null）时不显示对应项', () => {
    renderPanel(
      stats(),
      sections({ chests: null, signs: null, npcs: null, tileEntities: null, chestItems: null, chestItemKinds: null }),
    )
    expect(screen.queryByText('箱子')).toBeNull()
    expect(screen.queryByText('招牌')).toBeNull()
    expect(screen.queryByText('城镇 NPC')).toBeNull()
    expect(screen.queryByText('图格实体')).toBeNull()
    // 箱子物品统计也跟着不显示
    expect(screen.queryByText(/箱子里的物品/)).toBeNull()
  })

  it('点「箱子」打开明细：逐箱位置与内容', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /箱子/ }))
    expect(await screen.findByText('箱子明细（2）')).toBeTruthy()
    expect(screen.getByText('[1, 6] · 宝箱')).toBeTruthy()
    // 「生命水晶」在明细和「箱子里的物品」Top 里都会出现
    expect(screen.getAllByText('生命水晶').length).toBeGreaterThan(0)
    expect(screen.getByText('×99')).toBeTruthy()
  })

  it('点「招牌」看全文，点「城镇 NPC」看名字与位置', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /招牌/ }))
    expect(await screen.findByText('招牌明细（1）')).toBeTruthy()
    expect(screen.getByText('你好')).toBeTruthy()
  })

  it('图格实体没有明细 → 不可点击', () => {
    renderPanel()
    const btn = screen.getByRole('button', { name: /图格实体/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('「导出分析」下载一份文本报告', () => {
    const created: Blob[] = []
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      value: vi.fn((b: Blob) => {
        created.push(b)
        return 'blob:mock'
      }),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: vi.fn() })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /导出分析/ }))
    expect(clickSpy).toHaveBeenCalled()
    expect(created).toHaveLength(1)
    expect(created[0].type).toContain('text/plain')
    clickSpy.mockRestore()
  })

  it('分层区块显示四层的 y 范围与空气占比', () => {
    const { container } = renderPanel()
    const rows = [...container.querySelectorAll('[data-testid="analysis-zones"] > li')]
    expect(rows).toHaveLength(4)
    expect(rows[0].textContent).toContain('地表')
    expect(rows[0].textContent).toContain('y 0–49')
    expect(rows[0].textContent).toContain('空气 100.0%')
    expect(rows[3].textContent).toContain('地狱')
    expect(rows[3].textContent).toContain('y 180–199')
  })

  it('明细里搜索：按物品名过滤箱子，并显示匹配数', async () => {
    const { container } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /箱子/ }))
    expect(await screen.findByText('匹配 2 / 2')).toBeTruthy()

    const search = screen.getByPlaceholderText('搜索（物品名 / 招牌文本 / NPC 名）')
    fireEvent.change(search, { target: { value: '坠落' } })
    expect(await screen.findByText('匹配 1 / 2')).toBeTruthy()
    // 只剩第一个箱子（含坠落之星）
    expect(screen.queryByText('[2, 6]')).toBeNull()
    void container
  })

  it('图格种类超过 12 时出现「展开全部」，展开后全部列出', () => {
    const many = new Map<number, number>()
    for (let id = 0; id < 20; id++) many.set(id, 100 - id)
    const { container } = renderPanel(stats({ tiles: many }))
    const tileRows = () =>
      container.querySelectorAll('[data-testid="analysis-tiles"] > li').length
    const expand = screen.getByRole('button', { name: /展开全部 20 种/ })
    expect(tileRows()).toBe(12)
    fireEvent.click(expand)
    expect(tileRows()).toBe(20)
  })
})

describe('地图分析：显示名与查找图格同一套口径', () => {
  it('图格 12 显示「生命水晶」而不是常量名 Heart（tileNameById 优先）', () => {
    renderPanel(
      stats({
        tiles: new Map([
          [12, 4], // 生命水晶：常量名 Heart，图例名 = 物品 29
          [1, 2],
        ]),
      }),
    )
    const rows = [...document.querySelectorAll('[data-testid="analysis-tiles"] > li')]
    expect(rows[0].textContent).toContain('生命水晶')
    expect(rows[0].textContent).not.toContain('Heart')
  })
})
