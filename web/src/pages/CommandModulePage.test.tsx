import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { CommandResultsProvider } from '@/lib/commandResults'
import { ExecutionQueueProvider } from '@/lib/executionQueue'
import { DatasetProvider } from '@/lib/datasetContext'
import { resetRefreshGate } from '@/lib/refreshGate'
import { makeDataset } from '@/test/fixtures'
import { closeRowMenu, openRowMenu } from '@/test/managerSheet'
import { playerStubs } from '@/test/playerStubs'
import type { BackendTransport } from '@/lib/tshock'
import type { CommandResult } from '@/types'
import { CommandModulePage, type FixedCardDef } from './CommandModulePage'

function fakeTransport(runCommand: (cmd: string) => Promise<CommandResult>) {
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
    runCommand: vi.fn(runCommand),
    ...playerStubs,
  } as unknown as BackendTransport
}

function renderPage(
  transport: BackendTransport,
  fixedCards: FixedCardDef[] = [
    { nameKey: 'world.card.info', command: '/wi' },
    { nameKey: 'world.card.boss', command: '/bi' },
  ],
  authenticated = true,
  onLogin: () => void = vi.fn(),
) {
  return render(
    <I18nProvider lang="zh">
      <DatasetProvider value={makeDataset()}>
        <ExecutionQueueProvider interval={0}>
          <CommandResultsProvider serverId="default">
            <CommandModulePage
              dataset={makeDataset()}
              transport={transport}
              authenticated={authenticated}
              serverId="default"
              refreshInterval={0}
              onTokenInvalid={vi.fn().mockResolvedValue(true)}
              onLogin={onLogin}
              moduleId="world"
              keyPrefix="world:"
              desc="世界信息 / Boss 进度（WorldModify）。"
              fixedCards={fixedCards}
              pluginName="WorldModify"
            />
          </CommandResultsProvider>
        </ExecutionQueueProvider>
      </DatasetProvider>
    </I18nProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  resetRefreshGate()
})

afterEach(() => {
  localStorage.clear()
})

describe('CommandModulePage 未登录', () => {
  it('隐藏卡片列表，显示登录提示与登录按钮', () => {
    const onLogin = vi.fn()
    const transport = fakeTransport(async () => ({ status: 'ok', output: [] }))
    renderPage(transport, undefined, false, onLogin)

    expect(screen.getByText('请先登录！')).toBeTruthy()
    expect(screen.queryByText('指令卡片')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(onLogin).toHaveBeenCalledTimes(1)
  })
})

describe('CommandModulePage', () => {
  it('渲染固定卡片，并能添加自定义指令卡片', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: ['世界：测试'] })
    renderPage(fakeTransport(runCommand))

    // 固定卡片标题
    expect(screen.getByText('世界信息')).toBeTruthy()
    expect(screen.getByText('Boss 进度')).toBeTruthy()

    // 管理卡片弹框里添加一张卡片
    fireEvent.click(screen.getByRole('button', { name: /管理卡片/ }))
    fireEvent.click(screen.getByRole('button', { name: '添加卡片' }))
    fireEvent.change(screen.getByLabelText('卡片名称'), { target: { value: '时间' } })
    fireEvent.change(screen.getByLabelText('指令'), { target: { value: 'time' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    expect((await screen.findAllByText('时间')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('/time').length).toBeGreaterThan(0)
  })

  it('「管理卡片」的使用说明多一句「全部隐藏后右栏自动收起」', async () => {
    renderPage(fakeTransport(vi.fn().mockResolvedValue({ status: 'ok', output: [] })))
    fireEvent.click(await screen.findByRole('button', { name: /管理卡片/ }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText(/全部隐藏后右栏自动收起，左侧铺满/)).toBeTruthy()
    // 完成按钮带对勾图标。
    const done = within(sheet).getByRole('button', { name: '完成' })
    expect(done.querySelector('svg')).toBeTruthy()
  })

  it('记事本也出现在「管理卡片」里（可排序、默认在右侧）', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport(runCommand))

    fireEvent.click(screen.getByRole('button', { name: /管理卡片/ }))
    const sheet = await screen.findByRole('dialog')
    const row = within(sheet).getByRole('listitem', { name: '记事本' })
    // 默认宽度「右栏」；没有指令 → 标「非指令」。
    expect(within(row).getByLabelText('右栏')).toBeTruthy()
    expect(within(row).getByText('非指令')).toBeTruthy()

    // 排序：记事本默认排在最后，上移一格后进到倒数第二。
    const before = within(sheet)
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('aria-label'))
    const menu = await openRowMenu(row)
    fireEvent.click(within(menu).getByRole('menuitem', { name: '上移' }))
    await closeRowMenu()
    const after = within(sheet)
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('aria-label'))
    expect(after.indexOf('记事本')).toBe(before.indexOf('记事本') - 1)
  })

  it('卡片可隐藏：隐藏后不渲染但仍列在管理里；全部隐藏时帮助自动弹出', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport(runCommand))
    expect(await screen.findByText('世界信息')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /管理卡片/ }))
    const sheet = await screen.findByRole('dialog')
    const row = within(sheet).getByRole('listitem', { name: '世界信息' })
    fireEvent.click(within(row).getByLabelText('显示中'))
    // 行内出现闭眼徽标。
    expect(within(row).getByLabelText('已隐藏')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: '完成' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // 卡片不再渲染（另一张还在）。
    expect(screen.queryByText('世界信息')).toBeNull()
    expect(screen.getByText('Boss 进度')).toBeTruthy()

    // 把剩下两张也隐藏（含记事本）→ 页面没内容了，帮助自动顶出来。
    fireEvent.click(screen.getByRole('button', { name: /管理卡片/ }))
    const sheet2 = await screen.findByRole('dialog')
    for (const name of ['Boss 进度', '记事本']) {
      const r = within(sheet2).getByRole('listitem', { name })
      fireEvent.click(within(r).getByLabelText('显示中'))
    }
    fireEvent.click(within(sheet2).getByRole('button', { name: '完成' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // 一张卡都不剩 → 帮助自动顶出来（不用再点 ⓘ）。
    expect(await screen.findByText(/世界信息 \/ Boss 进度（WorldModify）/)).toBeTruthy()
  })

  it('帮助默认展开、关过就不再自动弹（按模块单独记忆）', async () => {
    renderPage(fakeTransport(vi.fn().mockResolvedValue({ status: 'ok', output: [] })))
    const help = /世界信息 \/ Boss 进度（WorldModify）/
    expect(await screen.findByText(help)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByText(help)).toBeNull())
    expect(JSON.parse(localStorage.getItem('tswui:helpClosed') ?? '{}')).toEqual({
      'panel:world:': true,
    })

    // 再点 ⓘ 仍能打开。
    fireEvent.click(screen.getByRole('button', { name: '页面说明' }))
    expect(await screen.findByText(help)).toBeTruthy()
  })

  it('新添加的卡片默认「小」且不自动执行；改成「大」后占整行', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport(runCommand))

    fireEvent.click(screen.getByRole('button', { name: /管理卡片/ }))
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: '添加卡片' }))
    fireEvent.change(within(sheet).getByLabelText('卡片名称'), { target: { value: '时间' } })
    fireEvent.change(within(sheet).getByLabelText('指令'), { target: { value: 'time' } })
    fireEvent.click(within(sheet).getByRole('button', { name: /^添加$/ }))

    const row = within(sheet).getByRole('listitem', { name: '时间' })
    expect(within(row).getByLabelText('左·小')).toBeTruthy()
    expect(within(row).getByLabelText('不自动执行')).toBeTruthy()

    fireEvent.click(within(row).getByLabelText('左·小'))
    expect(within(within(sheet).getByRole('listitem', { name: '时间' })).getByLabelText('左·大')).toBeTruthy()

    // 布局落到本机存储：宽度记住，顺序包含 2 张固定卡 + 新卡片 + 记事本。
    const layout = JSON.parse(localStorage.getItem('tswui:cardLayout') ?? '{}')
    const world = layout.byServer?.default?.['panel:world:']
    expect(Object.values(world.width)).toContain('full')
    expect(world.order).toHaveLength(4)
    expect(world.order).toContain('notebook')
  })

  it('「管理卡片」左下角有「恢复默认」：清掉排序 / 宽度 / 隐藏和自己加的卡片', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport(runCommand))

    fireEvent.click(screen.getByRole('button', { name: /管理卡片/ }))
    const sheet = await screen.findByRole('dialog')

    // 先改出一点非默认状态：加一张卡 + 把固定卡改成「小」。
    fireEvent.click(within(sheet).getByRole('button', { name: '添加卡片' }))
    fireEvent.change(within(sheet).getByLabelText('卡片名称'), { target: { value: '时间' } })
    fireEvent.change(within(sheet).getByLabelText('指令'), { target: { value: 'time' } })
    fireEvent.click(within(sheet).getByRole('button', { name: /^添加$/ }))
    const infoRow = within(sheet).getByRole('listitem', { name: '世界信息' })
    // 固定卡默认「左·大」，点一下循环到「右栏」。
    fireEvent.click(within(infoRow).getByLabelText('左·大'))
    expect(within(within(sheet).getByRole('listitem', { name: '世界信息' })).getByLabelText('右栏')).toBeTruthy()

    // 「恢复默认」是图标按钮（悬停提示），点一下变就地二次确认，确认后清空。
    const reset = within(sheet).getByRole('button', { name: '恢复默认' })
    fireEvent.click(reset)
    fireEvent.click(await within(sheet).findByRole('button', { name: '确认恢复' }))

    await waitFor(() => expect(within(sheet).queryByRole('listitem', { name: '时间' })).toBeNull())
    expect(within(within(sheet).getByRole('listitem', { name: '世界信息' })).getByLabelText('左·大')).toBeTruthy()
    const layout = JSON.parse(localStorage.getItem('tswui:cardLayout') ?? '{}')
    expect(layout.byServer?.default?.['panel:world:']).toBeUndefined()
  })

  it('手动执行的固定卡片：不自动执行、刷新全部也不执行，按钮为「执行」', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport(runCommand), [
      { nameKey: 'world.card.info', command: '/wi' },
      { nameKey: 'world.card.relive', command: '/relive', manual: true },
    ])

    // 自动只跑非手动的 /wi。
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/wi'))
    expect(runCommand).not.toHaveBeenCalledWith('/relive')

    // 手动卡片的按钮是「执行」，不是「刷新」。
    expect(screen.getByRole('button', { name: '执行' })).toBeTruthy()

    // 「刷新全部」也不会执行手动卡片。
    fireEvent.click(screen.getByRole('button', { name: /刷新全部/ }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(runCommand).not.toHaveBeenCalledWith('/relive')

    // 点卡片自己的按钮才执行。
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/relive'))
  })
})

describe('CommandModulePage 插件探测', () => {
  it('固定卡片「指令不存在」→ 提示插件未安装，卡片不再展示原始失败输出', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      status: 'command_not_found',
      output: ['输入的命令无效。使用/help 获取可用的指令列表。'],
      message: '指令不存在（提供该指令的插件可能未安装）',
    })
    renderPage(fakeTransport(runCommand))

    expect(await screen.findByText('服务器未安装 WorldModify 插件')).toBeTruthy()
    // 固定卡片统一显示「插件未安装」，不再展示 TShock 原文 / 后端提示
    expect(screen.getAllByText('插件未安装')).toHaveLength(2)
    expect(screen.queryByText('输入的命令无效。使用/help 获取可用的指令列表。')).toBeNull()
    expect(screen.queryByText('指令不存在（提供该指令的插件可能未安装）')).toBeNull()

    // 首轮只跑一次 /wi、/bi（不会因提示刷新而反复重跑）
    await waitFor(() => expect(runCommand).toHaveBeenCalledTimes(2))

    // 「管理卡片」里仍能看到固定卡片，并标「缺少插件」
    fireEvent.click(screen.getByRole('button', { name: /管理卡片/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByText('缺少插件')).toHaveLength(2)
  })

  it('无权限（no_permission）不算插件未安装', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      status: 'no_permission',
      output: ['你没有权限使用该指令。'],
      message: '权限不足，无法执行该指令',
    })
    renderPage(fakeTransport(runCommand))

    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/wi'))
    expect(screen.queryByText('服务器未安装 WorldModify 插件')).toBeNull()
    expect(screen.queryByText('插件未安装')).toBeNull()
  })

  it('「重新检测」：装上插件后提示消失、卡片恢复', async () => {
    let installed = false
    const runCommand = vi.fn().mockImplementation((cmd: string): Promise<CommandResult> => {
      if (!installed) {
        return Promise.resolve({
          status: 'command_not_found',
          output: ['输入的命令无效。使用/help 获取可用的指令列表。'],
          message: '指令不存在（提供该指令的插件可能未安装）',
        })
      }
      return Promise.resolve(
        cmd === '/wi'
          ? { status: 'ok', output: ['世界：测试'] }
          : { status: 'ok', output: [] },
      )
    })
    renderPage(fakeTransport(runCommand))

    expect(await screen.findByText('服务器未安装 WorldModify 插件')).toBeTruthy()

    installed = true
    fireEvent.click(screen.getByRole('button', { name: '重新检测' }))

    await waitFor(() => expect(screen.queryByText('服务器未安装 WorldModify 插件')).toBeNull())
    expect(await screen.findByText('世界：测试')).toBeTruthy()
  })
})
