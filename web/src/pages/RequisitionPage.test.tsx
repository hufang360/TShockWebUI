import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { DatasetProvider } from '@/lib/datasetContext'
import { makeDataset } from '@/test/fixtures'
import { makeRequisition, playerStubs } from '@/test/playerStubs'
import type { BackendTransport, RequestCapabilities } from '@/lib/tshock'
import { RequisitionPage } from './RequisitionPage'

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

const CAP_ALL: RequestCapabilities = { plugin: true, submit: true, review: true }

function renderPage(transport: BackendTransport, authenticated = true) {
  render(
    <I18nProvider lang="zh">
      <DatasetProvider value={makeDataset()}>
        <RequisitionPage
          serverId="default"
          transport={transport}
          authenticated={authenticated}
          refreshInterval={0}
          onTokenInvalid={async () => true}
          onLogin={vi.fn()}
        />
      </DatasetProvider>
    </I18nProvider>,
  )
}

/** 「我的申请 / 待审核」外层 tab 里的「待审核」（内层还有一个同名的筛选 tab）。 */
async function reviewSection() {
  const outer = await screen.findByRole('tablist', { name: '申请分类' })
  return within(outer).getByRole('tab', { name: '待审核' })
}

/** 「待审核 / 全部」内层筛选 tab。 */
async function reviewFilter(name: '待审核' | '全部') {
  const inner = await screen.findByRole('tablist', { name: '筛选范围' })
  return within(inner).getByRole('tab', { name })
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('RequisitionPage', () => {
  it('未登录时显示登录入口', () => {
    renderPage(fakeTransport(), false)
    expect(screen.getByText('请先登录！')).toBeTruthy()
  })

  it('插件未安装时显示明确提示', async () => {
    renderPage(
      fakeTransport({
        requestCapabilities: async () => ({ plugin: false, submit: false, review: false }),
      }),
    )
    expect(
      await screen.findByText('服务器未安装支持物资申请的 WebUI 插件'),
    ).toBeTruthy()
  })

  it('无提交权限时提示需要 webui.request.use', async () => {
    renderPage(
      fakeTransport({
        requestCapabilities: async () => ({ plugin: true, submit: false, review: false }),
      }),
    )
    expect(await screen.findByText('没有物资申请权限')).toBeTruthy()
    expect(screen.getByText(/webui\.request\.use/)).toBeTruthy()
  })

  it('插件版本过旧时显示后端返回的具体原因', async () => {
    const { TshockRequestError } = await import('@/lib/tshock')
    renderPage(
      fakeTransport({
        requestCapabilities: async () => {
          throw new TshockRequestError('plugin_outdated', 'WebUI 0.0.9 不支持「requests」，请升级插件')
        },
      }),
    )
    expect(await screen.findByText(/不支持「requests」/)).toBeTruthy()
  })

  it('搜索物品、填用途并提交申请', async () => {
    const create = vi.fn(async () => makeRequisition({ id: 7, items: [{ id: 29, stack: 3 }] }))
    renderPage(
      fakeTransport({
        requestCapabilities: async () => CAP_ALL,
        requestList: async () => [],
        requestListAll: async () => [],
        requestCreate: create,
      }),
    )

    const search = await screen.findByPlaceholderText('搜索物品名称 / ID')
    fireEvent.change(search, { target: { value: '生命水晶' } })
    const result = await screen.findByRole('button', { name: /生命水晶/ })
    fireEvent.click(result)

    const qty = screen.getByLabelText('数量') as HTMLInputElement
    fireEvent.change(qty, { target: { value: '3' } })

    fireEvent.change(screen.getByLabelText('用途'), {
      target: { value: '建一个刷怪场' },
    })
    fireEvent.click(screen.getByRole('button', { name: /提交申请/ }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith([{ id: 29, stack: 3 }], '建一个刷怪场', ''),
    )
    expect(await screen.findByText('已提交申请 #7，等待服主审核。')).toBeTruthy()
  })

  it('待审核申请可撤回', async () => {
    const cancel = vi.fn(async () => makeRequisition({ id: 3, status: 'cancelled' }))
    renderPage(
      fakeTransport({
        requestCapabilities: async () => CAP_ALL,
        requestList: async () => [makeRequisition({ id: 3, reason: '测试撤回' })],
        requestListAll: async () => [],
        requestCancel: cancel,
      }),
    )

    expect(await screen.findByText('测试撤回')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /撤回/ }))
    fireEvent.click(await screen.findByRole('button', { name: '确认撤回' }))
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(3))
  })

  it('审核人可通过待审核申请', async () => {
    const review = vi.fn(async (id: number) => makeRequisition({ id, status: 'delivered' }))
    renderPage(
      fakeTransport({
        requestCapabilities: async () => CAP_ALL,
        requestList: async () => [],
        requestListAll: async () => [makeRequisition({ id: 9, player: 'Bob', reason: '建屋顶' })],
        requestReview: review,
      }),
    )

    fireEvent.mouseDown(await reviewSection())
    expect(await screen.findByText('建屋顶')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^通过$/ }))
    await waitFor(() => expect(review).toHaveBeenCalledWith(9, 'approve', ''))
  })

  it('拒绝申请必须填写原因', async () => {
    const review = vi.fn(async (id: number) => makeRequisition({ id, status: 'denied' }))
    renderPage(
      fakeTransport({
        requestCapabilities: async () => CAP_ALL,
        requestList: async () => [],
        requestListAll: async () => [makeRequisition({ id: 10, player: 'Bob', reason: '建屋顶' })],
        requestReview: review,
      }),
    )

    fireEvent.mouseDown(await reviewSection())
    fireEvent.click(await screen.findByRole('button', { name: /拒绝/ }))
    const confirm = await screen.findByRole('button', { name: '确认拒绝' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('拒绝原因'), { target: { value: '数量太多' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(review).toHaveBeenCalledWith(10, 'deny', '数量太多'))
  })

  it('搜索框右侧的「物品收藏」popover：点一件直接加进申请清单', async () => {
    // 收藏两件：生命水晶 / 天顶剑（按收藏时间倒序，最新在前）。
    localStorage.setItem(
      'tswui:itemFavorites',
      JSON.stringify([
        { id: 4956, ts: 2 },
        { id: 29, ts: 1 },
      ]),
    )
    renderPage(
      fakeTransport({
        requestCapabilities: async () => CAP_ALL,
        requestList: async () => [],
        requestListAll: async () => [],
      }),
    )

    const trigger = await screen.findByRole('button', { name: '物品收藏' })
    // 按钮是**输入框的 addon**（同一 `input-group` 里，不再单独贴在输入框右边）。
    expect(trigger.closest('[data-slot="input-group"]')).toBeTruthy()
    expect(trigger.closest('[data-slot="input-group-addon"]')).toBeTruthy()

    fireEvent.click(trigger)
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByText('生命水晶')).toBeTruthy()
    expect(within(panel).getByText('天顶剑')).toBeTruthy()

    // 点一件 → 加进清单并**自动收起浮层**（收藏本身保留）。
    fireEvent.click(within(panel).getByRole('button', { name: /把 生命水晶 加入申请清单/ }))
    expect(await screen.findByLabelText('数量')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(JSON.parse(localStorage.getItem('tswui:itemFavorites') as string)).toHaveLength(2)
  })

  it('收藏为空时 popover 给出怎么收藏的说明', async () => {
    renderPage(
      fakeTransport({
        requestCapabilities: async () => CAP_ALL,
        requestList: async () => [],
        requestListAll: async () => [],
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: '物品收藏' }))
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByText(/还没有收藏物品/)).toBeTruthy()
  })

  it('按 / 直接把焦点送进搜索框', async () => {
    renderPage(
      fakeTransport({
        requestCapabilities: async () => CAP_ALL,
        requestList: async () => [],
        requestListAll: async () => [],
      }),
    )
    const search = await screen.findByPlaceholderText('搜索物品名称 / ID')
    expect(document.activeElement).not.toBe(search)
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(search)
  })

  it('申请清单空态外面有虚线框', async () => {
    renderPage(
      fakeTransport({
        requestCapabilities: async () => CAP_ALL,
        requestList: async () => [],
        requestListAll: async () => [],
      }),
    )
    const hint = await screen.findByText('在上方搜索并点击物品即可加入。')
    const box = hint.closest('div.border-dashed') as HTMLElement
    expect(box).toBeTruthy()
    expect(box.className).toContain('border-dashed')
  })

  it('待审核：筛选是「待审核 / 全部」两个 tab，记录两列排布', async () => {
    const listAll = vi.fn(async (status: 'pending' | 'all') => [
      makeRequisition({ id: 11, player: 'Bob', reason: '甲' }),
      makeRequisition({ id: 12, player: 'Bob', reason: '乙' }),
      ...(status === 'all' ? [makeRequisition({ id: 13, player: 'Bob', reason: '丙' })] : []),
    ])
    renderPage(
      fakeTransport({
        requestCapabilities: async () => CAP_ALL,
        requestList: async () => [],
        requestListAll: listAll,
      }),
    )

    fireEvent.mouseDown(await reviewSection())
    expect(await screen.findByText('甲')).toBeTruthy()
    // 两个筛选 tab，不再是下拉框。
    expect(await reviewFilter('待审核')).toBeTruthy()
    expect(await reviewFilter('全部')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()

    // 两列网格：每张卡都有自己的 wrapper，且卡片按内容定高（self-start）。
    const grid = screen.getByText('甲').closest('div.grid') as HTMLElement
    expect(grid.className).toContain('md:grid-cols-2')
    expect(grid.className).toContain('content-start')
    expect((screen.getByText('甲').closest('div.self-start') as HTMLElement).className).toContain(
      'self-start',
    )

    // 切到「全部」会按 all 重新拉取。
    fireEvent.mouseDown(await reviewFilter('全部'))
    await waitFor(() => expect(listAll).toHaveBeenLastCalledWith('all'))
  })
})
