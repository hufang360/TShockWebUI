import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { House } from 'lucide-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import type { GlobalSearchSources } from '@/lib/globalSearch'
import { StorageKeys } from '@/lib/storage'
import { makeDataset } from '@/test/fixtures'
import { GlobalSearchDialog, GlobalSearchTrigger } from './GlobalSearch'

// 「最近搜索」落在 localStorage：测试之间会互相影响（上一个用例 pick 过的词会留到下一条）。
beforeEach(() => {
  localStorage.removeItem(`tswui:${StorageKeys.globalSearchHistory}`)
})

function sources(overrides: Partial<GlobalSearchSources> = {}): GlobalSearchSources {
  return {
    pages: [
      { id: 'home', label: '首页', icon: House },
      { id: 'items', label: '物品 ID', icon: House },
      { id: 'dataid', label: '数据 ID', icon: House },
    ],
    dataset: makeDataset(),
    goods: [],
    ...overrides,
  }
}

function renderDialog(props: { onNavigate?: () => void; onOpenItem?: () => void } = {}) {
  const onNavigate = vi.fn(props.onNavigate)
  const onOpenItem = vi.fn(props.onOpenItem)
  const utils = render(
    <I18nProvider lang="zh">
      <GlobalSearchDialog
        open
        onOpenChange={() => {}}
        sources={sources()}
        onNavigate={onNavigate}
        onOpenItem={onOpenItem}
        canFillTerminal
        canRunCommands={false}
        onRunCommand={async () => ({ status: 'ok', output: [] })}
      />
    </I18nProvider>,
  )
  return { ...utils, onNavigate, onOpenItem }
}

describe('GlobalSearchDialog', () => {
  it('输入后按分组展示结果，物品点击即打开详情（不跳页）', async () => {
    const { onNavigate, onOpenItem } = renderDialog()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '天顶' } })

    // 「天顶剑」既是物品也是物品集合：这里只点「物品」组里的那条。
    const itemsGroup = await screen.findByRole('group', { name: '物品' })
    const option = await within(itemsGroup).findByRole('option', { name: /天顶剑/ })
    expect(screen.getByRole('group', { name: '物品集合' })).toBeTruthy()
    fireEvent.click(option)

    expect(onOpenItem).toHaveBeenCalledWith(4956)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('底部列出键盘提示，且没有「取消」按钮（Esc / 点遮罩关）', () => {
    renderDialog()
    // 命令面板用更小的圆角档（`radius="container"`，16px）。
    expect(screen.getByTestId('global-search-dialog').className).toContain('rounded-container')
    const keys = screen.getByTestId('global-search-keys')
    expect(keys.textContent).toContain('选择')
    expect(keys.textContent).toContain('Enter')
    expect(keys.textContent).toContain('Esc')
    expect(keys.textContent).toContain('取消')
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
  })

  it('底部复制提示：物品 → 复制 ID，指令 → 复制指令，无结果时不显示', async () => {
    renderDialog()
    const input = screen.getByRole('combobox')
    const keys = () => screen.getByTestId('global-search-keys').textContent ?? ''

    fireEvent.change(input, { target: { value: '天顶' } })
    await screen.findByRole('group', { name: '物品' })
    await waitFor(() => expect(keys()).toContain('复制 ID'))

    fireEvent.change(input, { target: { value: 'give' } })
    await screen.findByRole('group', { name: '指令' })
    await waitFor(() => expect(keys()).toContain('复制指令'))
    expect(keys()).not.toContain('复制 ID')

    fireEvent.change(input, { target: { value: 'zzzz' } })
    await screen.findByText(/没有找到「zzzz」/)
    expect(keys()).not.toContain('复制')
  })

  it('NPC 命中后跳到数据 ID 并带上数据源与搜索词', async () => {
    const { onNavigate, onOpenItem } = renderDialog()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '眼' } })

    fireEvent.click(await screen.findByRole('option', { name: /克苏鲁之眼/ }))
    expect(onNavigate).toHaveBeenCalledWith('dataid', { kind: 'npc', query: '克苏鲁之眼' })
    expect(onOpenItem).not.toHaveBeenCalled()
  })

  it('回车执行高亮项，↓ 移动高亮', async () => {
    const { onNavigate, onOpenItem } = renderDialog()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '物品' } })
    await screen.findByRole('option', { name: /物品 ID/ })

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    // 「物品」只命中页面与集合：向下一条后回车会落到物品集合（跳页而不是弹物品详情）。
    expect(onOpenItem).not.toHaveBeenCalled()
    expect(onNavigate).toHaveBeenCalledWith('items', expect.objectContaining({ collectionId: expect.any(String) }))
  })

  it('指令行：复制指令 + 填入终端（终端不可用时只有复制）', async () => {
    const onNavigate = vi.fn()
    const onOpenItem = vi.fn()
    const view = (canFillTerminal: boolean) => (
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources()}
          onNavigate={onNavigate}
          onOpenItem={onOpenItem}
          canFillTerminal={canFillTerminal}
          canRunCommands={false}
          onRunCommand={async () => ({ status: 'ok', output: [] })}
        />
      </I18nProvider>
    )
    const { rerender } = render(view(true))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'give' } })
    const commandRow = await screen.findByRole('option', { name: /\/give/ })
    const titles = () =>
      [...commandRow.querySelectorAll('[role="presentation"]')].map((el) => el.getAttribute('title'))
    expect(titles()).toEqual(['复制指令', '填入终端'])

    rerender(view(false))
    await waitFor(() => expect(titles()).toEqual(['复制指令']))
  })

  it('鱼店商品分组：点一行跳到鱼店并带上商品名', async () => {
    const onNavigate = vi.fn()
    render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources({
            goods: [
              {
                serial: 7,
                name: '传送回出生点',
                iconId: 50,
                cost: '10 金币',
                map: ['服务'],
                desc: '把你传回出生点',
                unlock: '',
                comment: '',
              },
            ] as unknown as GlobalSearchSources['goods'],
          })}
          onNavigate={onNavigate}
          onOpenItem={() => {}}
          canFillTerminal
          canRunCommands={false}
          onRunCommand={async () => ({ status: 'ok', output: [] })}
        />
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '出生点' } })
    const group = await screen.findByRole('group', { name: '鱼店商品' })
    fireEvent.click(within(group).getByRole('option', { name: /传送回出生点/ }))
    expect(onNavigate).toHaveBeenCalledWith('store', { query: '传送回出生点' })
  })

  it('可裸跑的指令：回车直接执行，并在二级页显示结果', async () => {
    const onRunCommand = vi.fn(async () => ({ status: 'ok' as const, output: ['服务器时间：中午'] }))
    render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources()}
          onNavigate={vi.fn()}
          onOpenItem={() => {}}
          canFillTerminal
          canRunCommands
          onRunCommand={onRunCommand}
        />
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'help' } })
    const group = await screen.findByRole('group', { name: '指令' })
    fireEvent.click(within(group).getByRole('option', { name: /\/help/ }))

    expect(onRunCommand).toHaveBeenCalledWith('/help')
    const view = await screen.findByTestId('global-search-run')
    expect(await within(view).findByText('服务器时间：中午')).toBeTruthy()

    // 「返回」回到结果列表（不关弹框）
    fireEvent.click(within(view).getByRole('button', { name: '返回' }))
    await waitFor(() => expect(screen.queryByTestId('global-search-run')).toBeNull())
    expect(screen.getByRole('combobox')).toBeTruthy()
  })

  it('未登录时不执行：仍然只是跳到指令小抄', async () => {
    const onNavigate = vi.fn()
    render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources()}
          onNavigate={onNavigate}
          onOpenItem={() => {}}
          canFillTerminal={false}
          canRunCommands={false}
          onRunCommand={vi.fn()}
        />
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'help' } })
    const group = await screen.findByRole('group', { name: '指令' })
    fireEvent.click(within(group).getByRole('option', { name: /\/help/ }))
    expect(onNavigate).toHaveBeenCalledWith('commands', { query: 'help' })
  })

  it('没有匹配时给一行说明', async () => {
    renderDialog()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzz' } })
    expect(await screen.findByText(/没有找到「zzzz」/)).toBeTruthy()
  })

  it('选中后清空输入，再次聚焦显示最近搜索', async () => {
    renderDialog()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '天顶' } })
    const itemsGroup = await screen.findByRole('group', { name: '物品' })
    fireEvent.click(await within(itemsGroup).findByRole('option', { name: /天顶剑/ }))

    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
    expect(await screen.findByText('最近搜索')).toBeTruthy()
    // 最近搜索是可键盘选中的 option。
    expect(screen.getByRole('option', { name: '天顶' })).toBeTruthy()
  })

  it('最近搜索：行尾 ✕ 可单条删除，删完回到空态提示', async () => {
    renderDialog()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '天顶' } })
    const itemsGroup = await screen.findByRole('group', { name: '物品' })
    fireEvent.click(await within(itemsGroup).findByRole('option', { name: /天顶剑/ }))

    const remove = await waitFor(() => {
      const el = document.querySelector('[data-recent-remove]')
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
    fireEvent.click(remove)

    await waitFor(() => expect(screen.queryByRole('option', { name: '天顶' })).toBeNull())
    expect(screen.getByText(/可搜物品/)).toBeTruthy()
  })

  it('最近搜索：Delete / Backspace 删除高亮项（空查询时才接管）', async () => {
    renderDialog()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '天顶' } })
    const itemsGroup = await screen.findByRole('group', { name: '物品' })
    fireEvent.click(await within(itemsGroup).findByRole('option', { name: /天顶剑/ }))
    await waitFor(() => expect(screen.getByRole('option', { name: '天顶' })).toBeTruthy())

    // 空查询 + 高亮第一条：Delete 直接删掉。
    const option = screen.getByRole('option', { name: '天顶' })
    expect(option.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Delete' })
    await waitFor(() => expect(screen.queryByRole('option', { name: '天顶' })).toBeNull())
    expect(screen.getByText(/可搜物品/)).toBeTruthy()
  })

  it('最近搜索：有搜索词时 Delete 不拦（留给输入框删字符）', async () => {
    renderDialog()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '天顶' } })
    const itemsGroup = await screen.findByRole('group', { name: '物品' })
    await within(itemsGroup).findByRole('option', { name: /天顶剑/ })

    const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    // 没被 preventDefault：输入框自己会处理退格。
    expect(event.defaultPrevented).toBe(false)
  })

  it('组内超过 3 条时给「全部」出口', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: 200 + i,
      key: `Stone${i}`,
      name: `石头${i}`,
      icon: 29,
      frames: 1,
      sprite: [16, 16] as [number, number],
      tags: [],
    }))
    const onNavigate = vi.fn()
    render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources({ dataset: makeDataset({ items: many }) })}
          onNavigate={onNavigate}
          onOpenItem={() => {}}
          canFillTerminal
          canRunCommands={false}
          onRunCommand={async () => ({ status: 'ok', output: [] })}
        />
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '石头' } })
    await screen.findByRole('option', { name: /石头0/ })
    // 3 条命中 + 1 条「全部」出口。
    expect(screen.getAllByRole('option')).toHaveLength(4)

    // 「全部」写成目标页面，用户知道点了会去哪。
    fireEvent.click(screen.getByRole('option', { name: /前往「物品 ID」查看更多/ }))
    expect(onNavigate).toHaveBeenCalledWith('items', { query: '石头' })
  })
})

describe('GlobalSearchTrigger（侧栏入口）', () => {
  it('是一个「像搜索框的按钮」：占位文案 + 右侧快捷键，点击即打开', () => {
    const onOpen = vi.fn()
    render(
      <I18nProvider lang="zh">
        <GlobalSearchTrigger onOpen={onOpen} />
      </I18nProvider>,
    )
    const trigger = screen.getByTestId('global-search-trigger')
    expect(trigger.textContent).toContain('搜索…')
    const hint = screen.getByTestId('global-search-shortcut')
    expect(['⌘K', 'Ctrl K']).toContain(hint.textContent)

    fireEvent.click(trigger)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('Ctrl/Cmd+K 打开弹框（不展开侧栏，也不需要输入框在场）', () => {
    const onOpen = vi.fn()
    render(
      <I18nProvider lang="zh">
        <GlobalSearchTrigger onOpen={onOpen} />
      </I18nProvider>,
    )
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(onOpen).toHaveBeenCalledTimes(2)

    // 带 Shift / Alt 的组合不算。
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, shiftKey: true })
    expect(onOpen).toHaveBeenCalledTimes(2)
  })
})
