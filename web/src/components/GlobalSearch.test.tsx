import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { House } from 'lucide-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import type { GlobalSearchSources } from '@/lib/globalSearch'
import { forgetDrill } from '@/lib/searchDrill'
import { StorageKeys } from '@/lib/storage'
import { makeDataset } from '@/test/fixtures'
import { GlobalSearchDialog, GlobalSearchTrigger } from './GlobalSearch'

// 「最近搜索」落在 localStorage、「二级位置」落在模块级变量：测试之间会互相影响。
beforeEach(() => {
  localStorage.removeItem(`tswui:${StorageKeys.globalSearchHistory}`)
  forgetDrill()
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
    // 刚打开什么都没搜：只给「↑↓ 选择 / Esc 取消」这类通用提示。
    expect(keys.textContent).toContain('选择')
    expect(keys.textContent).toContain('取消')
    // 键帽用符号 / 图标，不写英文单词。
    expect(keys.textContent).not.toContain('Enter')
    expect(keys.textContent).not.toContain('Delete')
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
  })

  it('底栏键帽：⏎ 代替 Enter、delete 图标代替 Delete、⌘C 拆成两个键帽', async () => {
    const onRemove = vi.fn()
    render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources()}
          onNavigate={vi.fn()}
          onOpenItem={() => {}}
          canFillTerminal
          canRunCommands={false}
          onRunCommand={vi.fn()}
        />
      </I18nProvider>,
    )
    // 有最近搜索：Enter 搜索 + delete 图标删除。
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '天顶' } })
    const itemsGroup = await screen.findByRole('group', { name: '物品' })
    fireEvent.click(await within(itemsGroup).findByRole('option', { name: /天顶剑/ }))
    await screen.findByRole('option', { name: '天顶' })

    const bar = screen.getByTestId('global-search-keys')
    const kbds = [...bar.querySelectorAll('kbd')].map((el) => el.textContent)
    expect(kbds).toContain('⏎')
    // 删除键是图标，没有文字。
    expect(kbds.some((text) => text === 'Delete')).toBe(false)
    expect(bar.querySelectorAll('kbd svg').length).toBeGreaterThan(0)
    expect(onRemove).not.toHaveBeenCalled()
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

  it('指令行：登录后 Enter 都是「执行」（含必填参数），未登录是「查看」（行内无按钮）', async () => {
    const view = (canFillTerminal: boolean, canRunCommands: boolean) => (
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources()}
          onNavigate={vi.fn()}
          onOpenItem={() => {}}
          canFillTerminal={canFillTerminal}
          canRunCommands={canRunCommands}
          onRunCommand={async () => ({ status: 'ok', output: [] })}
        />
      </I18nProvider>
    )
    const hints = () => screen.getByTestId('global-search-keys').textContent ?? ''
    /** 行里不再有图标按钮：动作只写在底栏。 */
    const rowIcons = (row: HTMLElement) => row.querySelectorAll('[role="presentation"]').length

    const { rerender } = render(view(true, true))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'give' } })
    const giveRow = await screen.findByRole('option', { name: /\/give/ })
    // 必填参数不再拦执行：底栏写「执行」，行里也没有图标按钮。
    await waitFor(() => expect(hints()).toContain('执行'))
    expect(hints()).toContain('复制指令')
    expect(rowIcons(giveRow)).toBe(0)

    // 未登录：不执行，Enter 变成「查看」（跳到指令小抄看用法）。
    rerender(view(true, false))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'give' } })
    await waitFor(() => expect(hints()).toContain('查看'))
    expect(hints()).not.toContain('执行')

    // 能裸跑的 /help：Enter = 执行（不是填终端）。
    rerender(view(true, true))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'help' } })
    await screen.findByRole('option', { name: /\/help/ })
    await waitFor(() => expect(hints()).toContain('执行'))

    // 未登录：不执行，Enter 只是打开（跳指令小抄）。
    rerender(view(true, false))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'help' } })
    await waitFor(() => expect(hints()).not.toContain('执行'))
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

  it('执行结果用富文本渲染（`[c/..]` 上色、`[i:..]` 出物品图标）', async () => {
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
          onRunCommand={async () => ({
            status: 'ok' as const,
            output: ['[c/FF0000:红色文字] 拿到 [i:4956] 天顶剑'],
          })}
        />
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'help' } })
    const group = await screen.findByRole('group', { name: '指令' })
    fireEvent.click(within(group).getByRole('option', { name: /\/help/ }))

    const view = await screen.findByTestId('global-search-run')
    // 颜色标签变成带 `--ts-color` 的 span，不再是原文。
    const colored = await within(view).findByText('红色文字')
    expect(colored.className).toContain('ts-chat-color')
    expect((colored as HTMLElement).style.getPropertyValue('--ts-color')).toBe('#FF0000')
    expect(view.textContent).not.toContain('[c/FF0000')
    // `[i:4956]` 会被替换成图标（不再以原文显示在行里）。
    expect(view.querySelector('canvas, img, svg')).toBeTruthy()
  })

  it('未登录时不执行：仍然只是跳到常用表格（指令小抄那张表）', async () => {
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
    expect(onNavigate).toHaveBeenCalledWith('tables', { query: 'help' })
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

  it('一级「更多」进二级：二级最多 20 条，再多的才去页面', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
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
    // 一级：3 条命中 + 1 条「更多」（右侧是命中数，不跳页）。
    expect(screen.getAllByRole('option')).toHaveLength(4)
    expect(onNavigate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('option', { name: /更多/ }))
    const detail = await screen.findByTestId('global-search-group')
    // 二级：20 条 + 1 条「更多」出口（25 条命中），出口右侧写目标页名。
    expect(within(detail).getAllByRole('option')).toHaveLength(21)
    expect(detail.textContent).toContain('物品 · 25 条')
    expect(within(detail).getByRole('option', { name: /更多/ }).textContent).toContain('物品 ID')
    expect(onNavigate).not.toHaveBeenCalled()

    // 20 条之后再多的才去页面，并带上搜索词。
    fireEvent.click(within(detail).getByRole('option', { name: /更多/ }))
    expect(onNavigate).toHaveBeenCalledWith('items', { query: '石头' })
  })

  it('二级：Esc 回一级且保留搜索词，高亮停回「更多」那行', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: 200 + i,
      key: `Stone${i}`,
      name: `石头${i}`,
      icon: 29,
      frames: 1,
      sprite: [16, 16] as [number, number],
      tags: [],
    }))
    render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources({ dataset: makeDataset({ items: many }) })}
          onNavigate={() => {}}
          onOpenItem={() => {}}
          canFillTerminal
          canRunCommands={false}
          onRunCommand={async () => ({ status: 'ok', output: [] })}
        />
      </I18nProvider>,
    )
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '石头' } })
    fireEvent.click(await screen.findByRole('option', { name: /更多/ }))
    await screen.findByTestId('global-search-group')

    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('global-search-group')).toBeNull())
    // 词还在，高亮回到刚才那行（不用重新找）。
    expect((input as HTMLInputElement).value).toBe('石头')
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: /更多/ }).getAttribute('aria-selected'),
      ).toBe('true'),
    )
  })

  it('重开弹框总是空面板（二级不跨开关恢复）', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: 200 + i,
      key: `Stone${i}`,
      name: `石头${i}`,
      icon: 29,
      frames: 1,
      sprite: [16, 16] as [number, number],
      tags: [],
    }))
    const view = () => (
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources({ dataset: makeDataset({ items: many }) })}
          onNavigate={() => {}}
          onOpenItem={() => {}}
          canFillTerminal
          canRunCommands={false}
          onRunCommand={async () => ({ status: 'ok', output: [] })}
        />
      </I18nProvider>
    )
    const { unmount } = render(view())
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '石头' } })
    fireEvent.click(await screen.findByRole('option', { name: /更多/ }))
    await screen.findByTestId('global-search-group')
    unmount()

    render(view())
    // 弹框在 App 里按开关重挂载：重开就是空词 + 一级，不会把上次的二级「复活」。
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('')
    expect(screen.queryByTestId('global-search-group')).toBeNull()
  })

  it('同一次会话里 Esc 回一级后再进同一组，回到原来那一行；清空输入就不再记', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: 200 + i,
      key: `Stone${i}`,
      name: `石头${i}`,
      icon: 29,
      frames: 1,
      sprite: [16, 16] as [number, number],
      tags: [],
    }))
    render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources({ dataset: makeDataset({ items: many }) })}
          onNavigate={() => {}}
          onOpenItem={() => {}}
          canFillTerminal
          canRunCommands={false}
          onRunCommand={async () => ({ status: 'ok', output: [] })}
        />
      </I18nProvider>,
    )
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '石头' } })
    fireEvent.click(await screen.findByRole('option', { name: /更多/ }))
    const detail = await screen.findByTestId('global-search-group')
    // 高亮挪到第 3 行，再 Esc 回一级。
    const options = within(detail).getAllByRole('option')
    fireEvent.pointerMove(options[2])
    await waitFor(() => expect(options[2].getAttribute('aria-selected')).toBe('true'))
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('global-search-group')).toBeNull())

    // 再进同一组：回到第 3 行，而不是回到第一条。
    fireEvent.click(await screen.findByRole('option', { name: /更多/ }))
    const again = await screen.findByTestId('global-search-group')
    await waitFor(() =>
      expect(within(again).getAllByRole('option')[2].getAttribute('aria-selected')).toBe('true'),
    )

    // 清空输入 → 记忆作废：再搜同一个词进二级，回到第一条。
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('global-search-group')).toBeNull())
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.change(input, { target: { value: '石头' } })
    fireEvent.click(await screen.findByRole('option', { name: /更多/ }))
    const fresh = await screen.findByTestId('global-search-group')
    await waitFor(() =>
      expect(within(fresh).getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true'),
    )
  })

  it('有必填参数的指令也直接执行（数据里的 required 不拦）：失败后给「查看用法」+「填入终端」', async () => {
    const onRunCommand = vi.fn(async () => ({
      status: 'command_error' as const,
      output: ['用法：/give <物品> <玩家>'],
      message: '参数不足',
    }))
    render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources()}
          onNavigate={() => {}}
          onOpenItem={() => {}}
          canFillTerminal
          canRunCommands
          onRunCommand={onRunCommand}
        />
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'give' } })
    fireEvent.click(await screen.findByRole('option', { name: /\/give/ }))

    expect(onRunCommand).toHaveBeenCalledWith('/give')
    const view = await screen.findByTestId('global-search-run')
    expect(await within(view).findByText('参数不足')).toBeTruthy()
    // 失败才给两个退路：看用法 / 填终端补参数。
    expect(within(view).getByRole('button', { name: '查看用法' })).toBeTruthy()
    expect(within(view).getByRole('button', { name: '填入终端' })).toBeTruthy()
  })

  it('/give 29 Alice：置顶「执行指令」行，回车直接跑这一行', async () => {
    const onRunCommand = vi.fn(async () => ({ status: 'ok' as const, output: ['用法：/help <命令>'] }))
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
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '/give 29 Alice' } })
    const row = await screen.findByRole('option', { name: /执行指令：\/give 29 Alice/ })
    // 默认高亮这一行：底栏写「执行」，回车就是跑它。
    await waitFor(() => expect(screen.getByTestId('global-search-keys').textContent).toContain('执行'))
    expect(row.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onRunCommand).toHaveBeenCalledWith('/give 29 Alice'))
    const view = await screen.findByTestId('global-search-run')
    expect(await within(view).findByText('用法：/help <命令>')).toBeTruthy()
  })

  it('没有搜索结果时（如 /wm find 生命水晶）也给一行「执行指令」', async () => {
    const onRunCommand = vi.fn(async () => ({ status: 'ok' as const, output: ['找到了：洞穴层'] }))
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
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '/wm find 生命水晶' } })

    const row = await screen.findByRole('option', { name: /执行指令：\/wm find 生命水晶/ })
    // 这个查询没有别的命中：不显示「没有找到」，也不摆空分组。
    expect(screen.queryByText(/没有找到/)).toBeNull()
    expect(row.getAttribute('aria-selected')).toBe('true')

    fireEvent.click(row)
    await waitFor(() => expect(onRunCommand).toHaveBeenCalledWith('/wm find 生命水晶'))
    const view = await screen.findByTestId('global-search-run')
    expect(await within(view).findByText('找到了：洞穴层')).toBeTruthy()
  })

  it('仅游戏内的指令：标红、不可执行（回车只是去「指令小抄」看用法）', async () => {
    const onRunCommand = vi.fn()
    const onNavigate = vi.fn()
    const { unmount } = render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources()}
          onNavigate={onNavigate}
          onOpenItem={() => {}}
          canFillTerminal
          canRunCommands
          onRunCommand={onRunCommand}
        />
      </I18nProvider>,
    )
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'item' } })
    const row = await screen.findByRole('option', { name: /\/item/ })
    // 和「指令小抄」一致：语义红 + 右侧写「仅游戏内」。
    expect(row.className).toContain('text-destructive')
    expect(row.textContent).toContain('仅游戏内')
    await waitFor(() => expect(screen.getByTestId('global-search-keys').textContent).not.toContain('执行'))

    fireEvent.click(row)
    expect(onRunCommand).not.toHaveBeenCalled()
    expect(onNavigate).toHaveBeenCalledWith('tables', { query: 'item' })

    // 整行输入（`/item 29`）也一样：给一行红的，但不执行。
    unmount()
    const onNavigate2 = vi.fn()
    const onRun2 = vi.fn()
    render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources()}
          onNavigate={onNavigate2}
          onOpenItem={() => {}}
          canFillTerminal
          canRunCommands
          onRunCommand={onRun2}
        />
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/item 29' } })
    const line = await screen.findByRole('option', { name: /执行指令：\/item 29/ })
    expect(line.className).toContain('text-destructive')
    fireEvent.click(line)
    expect(onRun2).not.toHaveBeenCalled()
  })

  it('未登录时不给「执行指令」行（不会假装能跑）', async () => {
    render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources()}
          onNavigate={vi.fn()}
          onOpenItem={() => {}}
          canFillTerminal={false}
          canRunCommands={false}
          onRunCommand={vi.fn()}
        />
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/give 29 Alice' } })
    await screen.findByRole('group', { name: '指令' })
    expect(screen.queryByRole('option', { name: /执行指令/ })).toBeNull()
  })

  it('执行失败（如参数不全）时给「查看用法」跳到指令小抄', async () => {
    const onNavigate = vi.fn()
    render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources()}
          onNavigate={onNavigate}
          onOpenItem={() => {}}
          canFillTerminal
          canRunCommands
          onRunCommand={async () => ({ status: 'command_error', output: [], message: '用法错误' })}
        />
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'help' } })
    fireEvent.click(await screen.findByRole('option', { name: /\/help/ }))
    const view = await screen.findByTestId('global-search-run')
    expect(await within(view).findByText('用法错误')).toBeTruthy()

    fireEvent.click(within(view).getByRole('button', { name: '查看用法' }))
    expect(onNavigate).toHaveBeenCalledWith('tables', { query: 'help' })
  })

  it('二级里 ⌘C 复制高亮行的 ID（底栏跟着高亮行）', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: 200 + i,
      key: `Stone${i}`,
      name: `石头${i}`,
      icon: 29,
      frames: 1,
      sprite: [16, 16] as [number, number],
      tags: [],
    }))
    render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources({ dataset: makeDataset({ items: many }) })}
          onNavigate={() => {}}
          onOpenItem={() => {}}
          canFillTerminal
          canRunCommands={false}
          onRunCommand={async () => ({ status: 'ok', output: [] })}
        />
      </I18nProvider>,
    )
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '石头' } })
    fireEvent.click(await screen.findByRole('option', { name: /更多/ }))
    const detail = await screen.findByTestId('global-search-group')
    // 二级第一行默认高亮：底栏也跟着说「复制 ID」。
    await waitFor(() => expect(screen.getByTestId('global-search-keys').textContent).toContain('复制 ID'))
    expect(within(detail).getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')
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
