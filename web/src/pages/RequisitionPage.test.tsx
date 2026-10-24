import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

    fireEvent.mouseDown(await screen.findByRole('tab', { name: '待审核' }))
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

    fireEvent.mouseDown(await screen.findByRole('tab', { name: '待审核' }))
    fireEvent.click(await screen.findByRole('button', { name: /拒绝/ }))
    const confirm = await screen.findByRole('button', { name: '确认拒绝' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('拒绝原因'), { target: { value: '数量太多' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(review).toHaveBeenCalledWith(10, 'deny', '数量太多'))
  })
})
