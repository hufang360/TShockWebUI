import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { CommandResultsProvider } from '@/lib/commandResults'
import { ExecutionQueueProvider } from '@/lib/executionQueue'
import { DatasetProvider } from '@/lib/datasetContext'
import { resetRefreshGate } from '@/lib/refreshGate'
import { makeDataset } from '@/test/fixtures'
import { playerStubs } from '@/test/playerStubs'
import type { BackendTransport, FishGood, FishShop } from '@/lib/tshock'
import { TshockRequestError } from '@/lib/tshock'
import { FishShopPage } from './FishShopPage'

const GOOD: FishGood = {
  serial: 1,
  name: '生命水晶',
  icon: '[i:29]',
  buyMax: 999,
  needArgs: false,
  map: ['物品'],
  desc: '[i:29] 生命水晶',
  cost: '[i/s2:73] 2 金币',
  unlock: '',
  comment: '备注 [i:29]',
  refund: false,
}

const ARG_GOOD: FishGood = {
  serial: 160,
  name: '地图上找',
  icon: '[i:29]',
  buyMax: 1,
  needArgs: true,
  map: ['find'],
  desc: '全图查找',
  cost: '[i/s1:73] 1 金币',
  unlock: '',
  comment: '',
  refund: false,
}

function fakeTransport(overrides: Partial<BackendTransport> = {}): BackendTransport {
  return {
    mock: false,
    label: 'test',
    session: async () => ({ authenticated: true, username: 'Alice' }),
    login: async () => ({ username: 'Alice' }),
    loginWithToken: async () => ({ username: 'Alice' }),
    logout: async () => {},
    serverStatus: async () => ({ reachable: true }),
    servers: async () => ({ allowCustom: false, default: null }),
    playersList: async () => [],
    runCommand: async () => ({ status: 'ok', output: [] }),
    ...playerStubs,
    ...overrides,
  }
}

function renderPage(transport: BackendTransport) {
  render(
    <I18nProvider lang="zh">
      <DatasetProvider value={makeDataset()}>
        <ExecutionQueueProvider interval={0}>
          <CommandResultsProvider serverId="default">
            <FishShopPage
              serverId="default"
              transport={transport}
              authenticated
              refreshInterval={120000}
              onTokenInvalid={vi.fn()}
              onLogin={vi.fn()}
            />
          </CommandResultsProvider>
        </ExecutionQueueProvider>
      </DatasetProvider>
    </I18nProvider>,
  )
}

const shopOf = (goods: FishGood[]): FishShop => ({ name: 'Mock 鱼店', total: goods.length, goods })

beforeEach(() => {
  resetRefreshGate()
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('FishShopPage', () => {
  it('插件可用时以网格列出货架商品', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))

    expect((await screen.findAllByText('生命水晶')).length).toBeGreaterThan(0)
    expect(screen.getByText('#1')).toBeTruthy()
  })

  it('非原生物品（指令类，desc 无 [i:..]）悬停不显示物品提示', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([ARG_GOOD]) }))

    const cell = await screen.findByRole('button', { name: '地图上找' })
    fireEvent.mouseOver(within(cell).getByRole('img'))
    // 给提示一点渲染时间，确认不会弹出。
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('件数在头部文字行；刷新图标 tooltip 显示上次刷新时间', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))

    expect(await screen.findByText('1 件商品')).toBeTruthy()
    const group = document.querySelector('[data-slot="input-group"]') as HTMLElement
    fireEvent.focus(within(group).getByRole('button', { name: '刷新' }))
    const tip = await screen.findByRole('tooltip')
    expect(within(tip).getByText(/上次刷新/)).toBeTruthy()
  })

  it('词缀：格子在商品名前显示词缀名（warning 色），悬停图标提示也带词缀', async () => {
    const PREFIXED: FishGood = {
      ...GOOD,
      serial: 2,
      icon: '[i/p81:29]',
      desc: '[i/p81:29] 生命水晶',
    }
    renderPage(fakeTransport({ fishList: async () => shopOf([PREFIXED]) }))

    const cell = await screen.findByRole('button', { name: '生命水晶' })
    const prefix = within(cell).getByText('传奇')
    expect(prefix.className).toContain('text-warning')

    fireEvent.mouseOver(within(cell).getByRole('img', { name: '生命水晶' }))
    const tip = await screen.findByRole('tooltip')
    expect(within(tip).getByText('传奇')).toBeTruthy()
    expect(within(tip).getByText('生命水晶')).toBeTruthy()
  })

  it('点击商品弹出详情，价格与备注渲染为物品图标', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))

    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')

    // 标题是「序号 + 名称」
    expect(within(dialog).getByText('#1 生命水晶')).toBeTruthy()
    expect(within(dialog).getByText('2 金币')).toBeTruthy()
    // 图标行 + 价格图标 + 商品图标 + 备注图标
    expect(within(dialog).getAllByRole('img').length).toBeGreaterThanOrEqual(3)
    expect(within(dialog).getByRole('button', { name: '购买' })).toBeTruthy()
    // 询价按钮已移除（数据在 list 里已有）
    expect(within(dialog).queryByRole('button', { name: '询价' })).toBeNull()
  })

  it('未安装插件时提示并隐藏货架', async () => {
    renderPage(
      fakeTransport({
        fishCapabilities: async () => ({ plugin: false, permission: false }),
      }),
    )
    expect(await screen.findByText('服务器未安装 FishShop 插件，无法使用鱼店。')).toBeTruthy()
  })

  it('服务类商品用 icon 字段配置的图标（desc 无 [i:..] 也能显示）', async () => {
    const service: FishGood = {
      serial: 110,
      name: '野生狗奶',
      icon: '[i:29]',
      buyMax: 1,
      needArgs: false,
          map: ['freezetime'],
      desc: '野生狗奶',
      cost: '[i/s15:73]',
      unlock: '',
      comment: '',
      refund: false,
    }
    renderPage(fakeTransport({ fishList: async () => shopOf([service]) }))

    const cell = await screen.findByRole('button', { name: '野生狗奶' })
    expect(within(cell).getByRole('img')).toBeTruthy()
  })

  it('可购买多件时才显示数量框', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('spinbutton')).toBeTruthy()
    expect(within(dialog).getByText('最多 999 件')).toBeTruthy()
  })

  it('buyMax=1 的商品不显示数量框', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([ARG_GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '地图上找' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('spinbutton')).toBeNull()
  })

  it('购买：填数量后确认，调用 fishBuy 并显示成功', async () => {
    const fishBuy = vi.fn(async () => ({ serial: 1, name: '生命水晶', amount: 3, cost: '[i/s6:73] 6 金币' }))
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]), fishBuy }))

    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '3' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))

    await waitFor(() => expect(fishBuy).toHaveBeenCalledWith(1, 3, ''))
    // 购买成功不关闭弹框，在界面显示结果
    expect(await within(dialog).findByText(/已购买：生命水晶 × 3/)).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })



  it('限购条件显示在详情里', async () => {
    const limited: FishGood = {
      ...GOOD,
      serial: 228,
      name: 'GM',
      allowGroup: ['GM'],
      allowPlayers: ['hf', 'star'],
      denyPlayers: ['bad'],
    }
    renderPage(fakeTransport({ fishList: async () => shopOf([limited]) }))
    fireEvent.click(await screen.findByRole('button', { name: 'GM' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('限购')).toBeTruthy()
    expect(within(dialog).getByText(/仅限用户组：GM/)).toBeTruthy()
    expect(within(dialog).getByText(/仅限玩家：hf、star/)).toBeTruthy()
    expect(within(dialog).getByText(/禁止玩家：bad/)).toBeTruthy()
  })

  it('价格为空的商品显示带背景的“免费”', async () => {
    const free: FishGood = { ...GOOD, serial: 220, name: 'Boss战报', cost: '' }
    renderPage(fakeTransport({ fishList: async () => shopOf([free]) }))
    fireEvent.click(await screen.findByRole('button', { name: 'Boss战报' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('免费')).toBeTruthy()
  })

  it('需要参数的商品：填参数后按参数购买（数量固定 1）', async () => {
    const fishBuy = vi.fn(async () => ({ serial: 160, name: '地图上找', amount: 1, cost: '[i/s1:73] 1 金币' }))
    renderPage(fakeTransport({ fishList: async () => shopOf([ARG_GOOD]), fishBuy }))

    fireEvent.click(await screen.findByRole('button', { name: '地图上找' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: '参数' }), { target: { value: 'egg' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))

    await waitFor(() => expect(fishBuy).toHaveBeenCalledWith(160, 1, 'egg'))
  })

  it('购买成功后按钮冷却并提示闪烁（防重复购买）', async () => {
    const fishBuy = vi.fn(async () => ({ serial: 1, name: '生命水晶', amount: 1, cost: '2 金币' }))
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]), fishBuy }))

    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))
    await waitFor(() => expect(fishBuy).toHaveBeenCalled())

    // 冷却：按钮变为倒计时且禁用，避免连点重复购买
    const cdBtn = await within(dialog).findByRole('button', { name: /请稍候/ })
    expect((cdBtn as HTMLButtonElement).disabled).toBe(true)
    // 成功提示闪烁
    const ok = within(dialog).getByText(/已购买/)
    expect(ok.closest('.tswui-flash')).toBeTruthy()
    // 额外提示：去游戏内查收
    expect(within(dialog).getByText('请打开游戏，进行查收！')).toBeTruthy()
  })

  it('购买按钮同一行左侧有关闭按钮，可快捷关闭弹框', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /关闭/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('业务错误（钱不够）原样展示', async () => {
    const { TshockRequestError } = await import('@/lib/tshock')
    renderPage(
      fakeTransport({
        fishList: async () => shopOf([GOOD]),
        fishBuy: async () => {
          throw new TshockRequestError('validation', '钱不够', 400)
        },
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))
    expect(await within(dialog).findByText('钱不够')).toBeTruthy()
  })

  it('默认聚焦购买按钮；需要参数时聚焦参数输入框', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '购买' })))
  })

  it('需要参数时默认聚焦参数输入框', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([ARG_GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '地图上找' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: '参数' })),
    )
  })

  it('点击抽屉外区域关闭抽屉', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    await screen.findByRole('dialog')
    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('FishShopPage 右侧指令卡片', () => {
  it('鱼店 REST API 不可用（探测报错）时仍渲染 4 张指令卡片', async () => {
    renderPage(
      fakeTransport({
        fishCapabilities: async () => {
          throw new TshockRequestError('plugin_missing', '没有 REST API')
        },
      }),
    )
    expect(await screen.findByText('钓鱼信息')).toBeTruthy()
    expect(screen.getByText('鱼罐')).toBeTruthy()
    expect(screen.getByText('消费榜')).toBeTruthy()
    expect(screen.getByText('鱼篓榜')).toBeTruthy()
  })

  it('点击卡片刷新会执行对应指令', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: ['已钓到 3 条鱼'] })
    renderPage(fakeTransport({ fishList: async () => shopOf([]), runCommand }))

    const card = (await screen.findByText('钓鱼信息')).closest('[data-slot="card"]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: '刷新' }))

    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/fish info'))
    expect(await screen.findByText('已钓到 3 条鱼')).toBeTruthy()
  })

  it('统一执行：一次批量请求执行全部卡片', async () => {
    localStorage.setItem('tswui:homeBatch', 'true')
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    const runBatch = vi
      .fn()
      .mockImplementation((cmds: string[]) =>
        Promise.resolve(cmds.map(() => ({ status: 'ok', output: [] }))),
      )
    renderPage(fakeTransport({ fishList: async () => shopOf([]), runCommand, runBatch }))

    fireEvent.click(await screen.findByRole('button', { name: '刷新全部' }))
    await waitFor(() => expect(runBatch).toHaveBeenCalled())
    expect(runBatch.mock.calls[0][0]).toEqual(['/fish info', '/fish jar', '/fish rank', '/fish basket'])
    expect(runCommand).not.toHaveBeenCalled()
  })
})
