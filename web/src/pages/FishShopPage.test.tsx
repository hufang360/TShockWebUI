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
  return render(
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

  it('格子高度跟随内容：`h-auto` 必须同时写 `md:h-auto`', async () => {
    // 尺寸变体自带 `md:h-9`（媒体查询变体在后，会盖掉无断点的 `h-auto`）：只写 `h-auto` 时
    // ≥768px 的格子被锁成 36px，图标 / 名称溢出压到下一行，整片商品重叠。
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))

    const cell = await screen.findByRole('button', { name: '生命水晶' })
    expect(cell.className).toContain('h-auto')
    expect(cell.className).toContain('md:h-auto')
  })

  it('商品格子和「物品 ID」同尺寸同排版：72 宽 / 图标 64、编号在名称上面、hover 底色只在图标区', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))

    const cell = await screen.findByRole('button', { name: '生命水晶' })
    // 宽度上限 72（w-18），不随窗口拉伸；整格 hover 不铺底色。
    expect(cell.className).toContain('w-18')
    expect(cell.className).toContain('hover:bg-transparent')
    // 子节点顺序：图标区 → #编号 → 名称（编号在名称**上面**一行）。
    const parts = [...cell.children].map((el) => el.textContent?.trim() ?? '')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('')
    expect(parts[1]).toBe('#1')
    expect(parts[2]).toBe('生命水晶')
    // 底色只挂在 72×72 的图标区上。
    const surface = cell.querySelector('[data-testid="good-icon-surface"]') as HTMLElement
    expect(surface.className).toContain('size-18')
    expect(surface.className).toContain('group-hover/cell:bg-primary/10')
    // 网格：列宽固定 72、行列间距都是 8px。
    const grid = cell.parentElement as HTMLElement
    expect(grid.className).toContain('grid-cols-[repeat(auto-fill,4.5rem)]')
    expect(grid.className).toContain('gap-2')
  })

  it('右侧只保留「钓鱼信息」卡片，且不再有「游戏内指令」开关', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))

    await screen.findAllByText('生命水晶')
    expect(await screen.findByText('钓鱼信息')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '游戏内指令' })).toBeNull()
    // 已移除的卡片不再出现。
    expect(screen.queryByText('鱼罐')).toBeNull()
    expect(screen.queryByText('消费榜')).toBeNull()
    expect(screen.queryByText('鱼篓榜')).toBeNull()
  })

  it('非原生物品（指令类，desc 无 [i:..]）悬停不显示物品提示，图标不压透明度', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([ARG_GOOD]) }))

    const cell = await screen.findByRole('button', { name: '地图上找' })
    fireEvent.mouseOver(within(cell).getByRole('img'))
    // 给提示一点渲染时间，确认不会弹出。
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(screen.queryByRole('tooltip')).toBeNull()
    // 借来的识别图按正常透明度显示（与真物品一致）。
    expect(within(cell).getByRole('img').parentElement?.className ?? '').not.toContain('opacity-80')
  })

  it('件数与输入框在同一行（输入框宽度收窄），且不在卡片里、属于滚动区域', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))

    const count = await screen.findByText('1 件商品')
    const group = document.querySelector('[data-slot="input-group"]') as HTMLElement
    // 件数不再是输入框下面的一行：与输入框同一个 row 容器，且输入框宽度有上限。
    const row = group.parentElement as HTMLElement
    expect(row.contains(count)).toBe(true)
    expect(row.className).toContain('items-center')
    expect(group.className).toContain('max-w-sm')
    expect(count.className).toContain('shrink-0')
    // 头部白卡已移除：输入框直接铺在页面背景上，和货架同处一个滚动区域（往下滚会一起滚走）。
    expect(group.closest('[data-slot="card"]')).toBeNull()
    const scroller = group.closest('[class*="xl:overflow-y-auto"]') as HTMLElement | null
    expect(scroller).toBeTruthy()
    expect(scroller?.contains(screen.getByText('#1'))).toBe(true)

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
        fishCapabilities: async () => ({ plugin: false, rest: false, permission: false }),
      }),
    )
    expect(await screen.findByText('需安装 鱼店 插件，无法获取货架数据。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '生命水晶' })).toBeNull()
  })

  it('提示区有「重新检测」：装上插件后不用切页面（REST 延迟注册的兜底）', async () => {
    // 第一次探到「没装」，第二次（点重新检测）探到可用。
    const fishCapabilities = vi
      .fn()
      .mockResolvedValueOnce({ plugin: false, rest: false, permission: false })
      .mockResolvedValue({ plugin: true, rest: true, permission: true })
    const fishList = vi.fn(async () => shopOf([GOOD]))
    renderPage(fakeTransport({ fishCapabilities, fishList }))

    expect(await screen.findByText('需安装 鱼店 插件，无法获取货架数据。')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: /重新检测/ })[0])

    await waitFor(() => expect(fishCapabilities).toHaveBeenCalledTimes(2))
    // 检测通过后自动拉货架
    expect(await screen.findByRole('button', { name: '生命水晶' })).toBeTruthy()
  })

  it('插件可用但无权限时提示权限，钓鱼信息卡片仍可用', async () => {
    renderPage(
      fakeTransport({
        fishCapabilities: async () => ({ plugin: true, rest: true, permission: false }),
      }),
    )
    expect(await screen.findByText('老版本鱼店插件需要 fishshop.rest.use 权限，你的用户组没有。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '生命水晶' })).toBeNull()
    expect(await screen.findByText('钓鱼信息')).toBeTruthy()
  })

  it('老版本插件（没有 REST 接口）时提示版本过旧，钓鱼信息卡片仍可用', async () => {
    const fishList = vi.fn(async () => shopOf([]))
    renderPage(
      fakeTransport({
        fishCapabilities: async () => ({ plugin: true, rest: false, permission: false }),
        fishList,
      }),
    )
    expect(await screen.findByText('鱼店插件版本过旧')).toBeTruthy()
    // 没有 REST 就不该再拉货架。
    expect(fishList).not.toHaveBeenCalled()
    // 右侧指令卡片只走 rawcmd，照常渲染（只剩「钓鱼信息」）。
    expect(await screen.findByText('钓鱼信息')).toBeTruthy()
    expect(screen.queryByText('货架')).toBeNull()
  })

  it('货架接口业务失败（商店打烊）时展示上游原文，不说「没有匹配的商品」', async () => {
    renderPage(
      fakeTransport({
        fishList: async () => {
          throw new TshockRequestError('validation', '商店打烊', 400)
        },
      }),
    )
    // 上游文案原样展示：错误是商店状态，不是插件没有 / 搜不到东西。
    expect(await screen.findByText('商店打烊')).toBeTruthy()
    expect(screen.queryByText('没有匹配的商品')).toBeNull()
    expect(screen.queryByText('需安装 鱼店 插件，无法获取货架数据。')).toBeNull()
  })

  it('离开后再进入页面会重新拉货架（不受刷新间隔闸门影响）', async () => {
    const fishList = vi.fn(async () => shopOf([GOOD]))
    const first = renderPage(fakeTransport({ fishList }))
    await screen.findAllByText('生命水晶')
    first.unmount()
    renderPage(fakeTransport({ fishList }))
    await waitFor(() => expect(fishList).toHaveBeenCalledTimes(2))
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



  it('限购条件显示在详情里（限制一行）', async () => {
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
    expect(within(dialog).getByText('限制')).toBeTruthy()
    expect(within(dialog).getByText(/仅限用户组：GM/)).toBeTruthy()
    expect(within(dialog).getByText(/仅限玩家：hf、star/)).toBeTruthy()
    expect(within(dialog).getByText(/禁止玩家：bad/)).toBeTruthy()
  })

  it('限购次数 / 冷却 / 时机 / 购买前检查来自插件的结构化字段', async () => {
    const rich: FishGood = {
      ...GOOD,
      serial: 300,
      name: '召唤机械骷髅王',
      limit: 3,
      serverLimit: 10,
      cd: 60,
      serverCd: 30,
      needAlive: true,
      needNight: true,
      check: '需先击败骷髅王',
    }
    renderPage(fakeTransport({ fishList: async () => shopOf([rich]) }))
    fireEvent.click(await screen.findByRole('button', { name: '召唤机械骷髅王' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/每人限购 3 次/)).toBeTruthy()
    expect(within(dialog).getByText(/全服限量 10 件/)).toBeTruthy()
    expect(within(dialog).getByText(/冷却 60 秒/)).toBeTruthy()
    expect(within(dialog).getByText(/全服冷却 30 秒/)).toBeTruthy()
    expect(within(dialog).getByText('购买时机')).toBeTruthy()
    expect(within(dialog).getByText(/死亡时不能买/)).toBeTruthy()
    expect(within(dialog).getByText(/只能夜晚买/)).toBeTruthy()
    expect(within(dialog).getByText('购买前检查')).toBeTruthy()
    expect(within(dialog).getByText(/需先击败骷髅王/)).toBeTruthy()
  })

  it('白天 / 夜晚都不让买时只说一句，不并排显示自相矛盾的两行', async () => {
    const closed: FishGood = { ...GOOD, serial: 301, name: '全天关闭', needDay: true, needNight: true }
    renderPage(fakeTransport({ fishList: async () => shopOf([closed]) }))
    fireEvent.click(await screen.findByRole('button', { name: '全天关闭' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/白天和夜晚都不能买/)).toBeTruthy()
    expect(within(dialog).queryByText(/只能白天买/)).toBeNull()
    expect(within(dialog).queryByText(/只能夜晚买/)).toBeNull()
  })

  it('没有限购 / 时机 / 检查的商品不显示这些行', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText('限制')).toBeNull()
    expect(within(dialog).queryByText('购买时机')).toBeNull()
    expect(within(dialog).queryByText('购买前检查')).toBeNull()
  })

  it('多个透传参数时提示参数个数', async () => {
    const multi: FishGood = { ...ARG_GOOD, serial: 161, name: '放置建筑', argCount: 2 }
    renderPage(fakeTransport({ fishList: async () => shopOf([multi]) }))
    fireEvent.click(await screen.findByRole('button', { name: '放置建筑' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('参数（2 个，用空格分隔）')).toBeTruthy()
  })

  it('个人状态：先按 self=1 拉货架，拿不到就静默退回普通货架', async () => {
    const fishList = vi
      .fn()
      .mockRejectedValueOnce(new TshockRequestError('validation', '玩家 Alice 不在线，请先进入游戏', 400))
      .mockResolvedValue(shopOf([GOOD]))
    renderPage(fakeTransport({ fishList }))

    expect(await screen.findByRole('button', { name: '生命水晶' })).toBeTruthy()
    // 不在线不是错误：页面上不该出现那条文案
    expect(screen.queryByText(/不在线/)).toBeNull()
    // 第一次要个人状态，失败后第二次退回不带 self 的普通货架。
    expect(fishList.mock.calls[0][0]).toEqual({ self: true })
    expect(fishList.mock.calls[1]).toEqual([])
  })

  it('个人状态：显示还能买几次 / 冷却剩余', async () => {
    const good: FishGood = { ...GOOD, limit: 3, myCount: 2, myRemain: 1, myCdRemain: 30, canBuy: true }
    renderPage(fakeTransport({ fishList: async () => shopOf([good]) }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('我的进度')).toBeTruthy()
    expect(within(dialog).getByText(/还能买 1 次/)).toBeTruthy()
    expect(within(dialog).getByText(/冷却中，还需 30 秒/)).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: '购买' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('买完刷新货架后，弹框里的「我的进度」跟着更新', async () => {
    let remain = 1
    const fishList = vi.fn(async () =>
      shopOf([{ ...GOOD, limit: 3, myRemain: remain, myCount: 3 - remain, canBuy: true }]),
    )
    const fishBuy = vi.fn(async () => {
      remain = 0
      return { serial: 1, name: '生命水晶', amount: 1, requested: 1, refunded: false, cost: '5 金币' }
    })
    renderPage(fakeTransport({ fishList, fishBuy }))

    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/还能买 1 次/)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))

    // 刷新后回到「还能买 0 次」（上游 canBuy 仍是 true，Mock 没改它）
    await waitFor(() => expect(within(dialog).getByText(/还能买 0 次/)).toBeTruthy())
  })

  it('个人状态：上游说买不了时显示原因并禁用购买', async () => {
    const good: FishGood = { ...GOOD, canBuy: false, blockReason: '已达个人限购', myRemain: 0 }
    renderPage(fakeTransport({ fishList: async () => shopOf([good]) }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('已达个人限购')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: '购买' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('参数按插件的引号规则数：引号里的空格不算多一个参数', async () => {
    const multi: FishGood = { ...ARG_GOOD, serial: 162, name: '保存建筑', argCount: 2 }
    renderPage(fakeTransport({ fishList: async () => shopOf([multi]) }))
    fireEvent.click(await screen.findByRole('button', { name: '保存建筑' }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByRole('textbox', { name: '参数' })
    const buy = within(dialog).getByRole('button', { name: '购买' })

    fireEvent.change(input, { target: { value: '"我的 小屋"' } })
    expect((buy as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '"我的 小屋" 10' } })
    expect((buy as HTMLButtonElement).disabled).toBe(false)
  })

  it('商品没发出去（自动退款）时不说「已购买」', async () => {
    const fishBuy = vi.fn(async () => ({
      serial: 1,
      name: '柚子仪式',
      amount: 0,
      requested: 1,
      refunded: true,
      cost: '',
    }))
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]), fishBuy }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))

    expect(await within(dialog).findByText(/本次未发货，已全额退款/)).toBeTruthy()
    expect(within(dialog).queryByText(/已购买/)).toBeNull()
    // 什么都没发出去，不该让人等冷却（也不该出现「被夹小」提示）
    expect(within(dialog).queryByText(/单次上限只给了/)).toBeNull()
    expect((within(dialog).getByRole('button', { name: '购买' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('降级条目（配置有误）提示并禁用购买', async () => {
    const broken: FishGood = {
      ...GOOD,
      serial: 400,
      name: '坏商品',
      comment: '该商品配置有误，已降级显示（详情见服务端控制台）',
    }
    renderPage(fakeTransport({ fishList: async () => shopOf([broken]) }))
    fireEvent.click(await screen.findByRole('button', { name: '坏商品' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('这件商品配置有误，暂时买不了。')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: '购买' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('需要多个参数时，参数个数不够就不能点购买', async () => {
    const multi: FishGood = { ...ARG_GOOD, serial: 161, name: '放置建筑', argCount: 2 }
    renderPage(fakeTransport({ fishList: async () => shopOf([multi]) }))
    fireEvent.click(await screen.findByRole('button', { name: '放置建筑' }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByRole('textbox', { name: '参数' })
    const buy = within(dialog).getByRole('button', { name: '购买' })

    expect((buy as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '小房间' } })
    expect((buy as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '小房间 10' } })
    expect((buy as HTMLButtonElement).disabled).toBe(false)
  })

  it('实际成交件数被单次上限夹小时提示一句', async () => {
    const fishBuy = vi.fn(async () => ({
      serial: 1,
      name: '生命水晶',
      amount: 999,
      requested: 5000,
      cost: '5 金币',
    }))
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]), fishBuy }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '999' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))
    expect(await within(dialog).findByText(/单次上限只给了 999 件（你想买 5000 件）/)).toBeTruthy()
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
  it('鱼店 REST API 不可用（探测报错）时仍渲染 5 张指令卡片', async () => {
    renderPage(
      fakeTransport({
        fishCapabilities: async () => {
          throw new TshockRequestError('plugin_missing', '没有 REST API')
        },
      }),
    )
    expect(await screen.findByText('钓鱼信息')).toBeTruthy()
    expect(screen.queryByText('货架')).toBeNull()
  })

  it('点击卡片刷新会执行对应指令', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: ['已钓到 3 条鱼'] })
    renderPage(fakeTransport({ fishList: async () => shopOf([]), runCommand }))

    const card = (await screen.findByText('钓鱼信息')).closest('[data-slot="card"]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: '刷新' }))

    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/fish info'))
    expect((await screen.findAllByText('已钓到 3 条鱼')).length).toBeGreaterThan(0)
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
    expect(runBatch.mock.calls[0][0]).toEqual(['/fish info'])
    expect(runCommand).not.toHaveBeenCalled()
  })
})
