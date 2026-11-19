import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { House } from 'lucide-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { DatasetProvider } from '@/lib/datasetContext'
import { ItemFavoritesStoreProvider } from '@/lib/itemFavoritesContext'
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

function renderDialog(
  props: {
    onNavigate?: () => void
    username?: string | null
    canRunCommands?: boolean
  } = {},
) {
  const onNavigate = vi.fn(props.onNavigate)
  const s = sources()
  const utils = render(
    <I18nProvider lang="zh">
      <DatasetProvider value={s.dataset}>
        <ItemFavoritesStoreProvider>
          <GlobalSearchDialog
            open
            onOpenChange={() => {}}
            sources={s}
            onNavigate={onNavigate}
            username={props.username ?? null}
            canRunCommands={props.canRunCommands ?? false}
            onRunCommand={async () => ({ status: 'ok', output: [] })}
          />
        </ItemFavoritesStoreProvider>
      </DatasetProvider>
    </I18nProvider>,
  )
  return { ...utils, onNavigate }
}

describe('GlobalSearchDialog', () => {
  it('输入后按分组展示结果，物品就地打开详情层（不跳页、不另开弹框）', async () => {
    const { onNavigate } = renderDialog()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '天顶' } })

    // 「天顶剑」既是物品也是物品集合：这里只点「物品」组里的那条。
    const itemsGroup = await screen.findByRole('group', { name: '物品' })
    const option = await within(itemsGroup).findByRole('option', { name: /天顶剑/ })
    expect(screen.getByRole('group', { name: '物品集合' })).toBeTruthy()
    fireEvent.click(option)

    // 详情内容就在弹框里（同一份 `ItemDetailPanel`），列表让位。
    const level = await screen.findByTestId('global-search-item')
    expect(within(level).getByTestId('item-tooltip').textContent).toContain('天顶剑')
    // 面板底部那三个按钮不在这一层出现：动作全走底栏快捷键。
    expect(within(level).queryByTestId('dex-detail-actions')).toBeNull()
    expect(screen.queryByRole('group', { name: '物品集合' })).toBeNull()
    // 只有一个弹框：没有另开物品详情弹框。
    expect(screen.queryByTestId('dex-detail-dialog')).toBeNull()
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('物品详情层：Esc 回列表并停回原来那行；⌘C / ⌘⇧C / ⌘⏎ = 复制 ID / 复制名称 / 去 Wiki', async () => {
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    })
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const { onNavigate } = renderDialog()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '天顶' } })
    const itemsGroup = await screen.findByRole('group', { name: '物品' })
    const option = await within(itemsGroup).findByRole('option', { name: /天顶剑/ })
    fireEvent.click(option)
    await screen.findByTestId('global-search-item')

    // 右下角：主操作直接写出来（快捷键在文字右边、合并在一个键帽里），其余在「操作」里。
    const keys = () => screen.getByTestId('global-search-keys').textContent ?? ''
    const primary = screen.getByTestId('global-search-primary')
    expect(primary.textContent).toContain('复制ID')
    expect(primary.querySelector('kbd')?.textContent).toMatch(/^(⌘C|Ctrl C)$/)
    expect(keys()).toContain('操作')
    expect(keys()).not.toContain('复制名称')
    fireEvent.pointerDown(screen.getByTestId('global-search-more'), { button: 0, ctrlKey: false })
    const menu = await screen.findByRole('menu')
    // 第一条固定是主操作；「返回」不进菜单（回上一层走左侧返回键 / Esc）。
    expect(within(menu).getAllByRole('menuitem')[0].textContent).toContain('复制ID')
    expect(within(menu).getByText('复制名称')).toBeTruthy()
    expect(within(menu).getByText('前往 Wiki')).toBeTruthy()
    expect(within(menu).queryByText('返回')).toBeNull()
    // 物品层的「操作」里还有收藏；点一下收藏这件物品。
    const favorite = within(menu).getByText('收藏')
    fireEvent.click(favorite)
    await waitFor(() => expect(localStorage.getItem('tswui:itemFavorites') ?? '').toContain('4956'))
    // 菜单项本身也能执行（鼠标路径）：点「复制名称」= 把名称写进剪贴板。
    fireEvent.pointerDown(screen.getByTestId('global-search-more'), { button: 0, ctrlKey: false })
    const menu2 = await screen.findByRole('menu')
    expect(within(menu2).getByText('取消收藏')).toBeTruthy()
    fireEvent.click(within(menu2).getByText('复制名称'))
    await waitFor(() => expect(written).toEqual(['天顶剑']))

    fireEvent.keyDown(input, { key: 'c', ctrlKey: true })
    await waitFor(() => expect(written).toEqual(['天顶剑', '4956']))
    fireEvent.keyDown(input, { key: 'c', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(written).toEqual(['天顶剑', '4956', '天顶剑']))

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(decodeURIComponent(String(openSpy.mock.calls[0]?.[0]))).toContain('天顶剑')

    // Esc 退层：回到列表，高亮停回刚才那行；不跳页。
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('global-search-item')).toBeNull())
    expect((input as HTMLInputElement).value).toBe('天顶')
    await waitFor(() =>
      expect(
        within(screen.getByRole('group', { name: '物品' }))
          .getByRole('option', { name: /天顶剑/ })
          .getAttribute('aria-selected'),
      ).toBe('true'),
    )
    expect(onNavigate).not.toHaveBeenCalled()
    openSpy.mockRestore()
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

  it('输入框不再画聚焦描边（ring）：焦点常驻在它上面', () => {
    renderDialog()
    const group = screen.getByTestId('global-search-input-group')
    // `InputGroup` 默认 `focus-within:ring-2`；这里用 ring-0 顶掉（twMerge 同组，后者生效）。
    expect(group.className).toContain('focus-within:ring-0')
  })

  it('二级：输入框左侧的放大镜变成返回键，点它回一级', async () => {
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
        <DatasetProvider value={makeDataset({ items: many })}>
          <GlobalSearchDialog
            open
            onOpenChange={() => {}}
            sources={sources({ dataset: makeDataset({ items: many }) })}
            onNavigate={() => {}}
            canRunCommands={false}
            onRunCommand={async () => ({ status: 'ok', output: [] })}
          />
        </DatasetProvider>
      </I18nProvider>,
    )
    const input = screen.getByRole('combobox')
    // 一级：没有返回键。
    expect(screen.queryByTestId('global-search-back')).toBeNull()

    fireEvent.change(input, { target: { value: '石头' } })
    fireEvent.click(await screen.findByRole('option', { name: /更多/ }))
    await screen.findByTestId('global-search-group')

    // 二级：放大镜换成返回键（悬停提示写 Esc），点一下回一级（高亮停回「更多」那行）。
    const back = screen.getByTestId('global-search-back')
    expect(back.getAttribute('aria-label')).toContain('Esc')
    fireEvent.click(back)
    await waitFor(() => expect(screen.queryByTestId('global-search-group')).toBeNull())
    expect(screen.queryByTestId('global-search-back')).toBeNull()
    expect((input as HTMLInputElement).value).toBe('石头')
  })

  it('⌘K 展开 / 收起「更多操作」（不用鼠标）', async () => {
    renderDialog()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'give' } })
    await screen.findByRole('group', { name: '指令' })

    fireEvent.keyDown(input, { key: 'k', ctrlKey: true })
    expect(await screen.findByRole('menu')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
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
          canRunCommands={false}
          onRunCommand={vi.fn()}
        />
      </I18nProvider>,
    )
    // 有最近搜索：Enter 搜索 + delete 图标删除（跳页命中会顺手把词记进最近搜索）。
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '眼' } })
    fireEvent.click(await screen.findByRole('option', { name: /克苏鲁之眼/ }))
    await screen.findByRole('option', { name: '眼' })

    // 主操作：⏎ 搜索（键帽是符号，不写英文单词）。
    const bar = screen.getByTestId('global-search-keys')
    expect([...bar.querySelectorAll('kbd')].map((el) => el.textContent)).toContain('⏎')
    expect(bar.textContent).not.toContain('Enter')
    // 删除在「更多操作」里：键帽是图标，没有文字。
    fireEvent.pointerDown(screen.getByTestId('global-search-more'), { button: 0, ctrlKey: false })
    const menu = await screen.findByRole('menu')
    expect(menu.textContent).toContain('删除')
    expect(menu.textContent).not.toContain('Delete')
    expect(menu.querySelectorAll('kbd svg').length).toBeGreaterThan(0)
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('底部复制提示：物品 → 复制 ID，指令 → 复制指令，无结果时不显示', async () => {
    renderDialog()
    const input = screen.getByRole('combobox')
    const keys = () => screen.getByTestId('global-search-keys').textContent ?? ''

    /** 「更多操作」里的动作名（主操作直接写在底栏）。 */
    const moreLabels = async () => {
      fireEvent.pointerDown(screen.getByTestId('global-search-more'), { button: 0, ctrlKey: false })
      const menu = await screen.findByRole('menu')
      const text = menu.textContent ?? ''
      fireEvent.keyDown(menu, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
      return text
    }

    fireEvent.change(input, { target: { value: '天顶' } })
    await screen.findByRole('group', { name: '物品' })
    await waitFor(() => expect(keys()).toContain('打开'))
    expect(await moreLabels()).toContain('复制 ID')

    // 未登录：指令的主操作是「查看」，复制指令在「更多操作」里。
    fireEvent.change(input, { target: { value: 'give' } })
    await screen.findByRole('group', { name: '指令' })
    await waitFor(() => expect(keys()).toContain('查看'))
    expect(await moreLabels()).toContain('复制指令')

    fireEvent.change(input, { target: { value: 'zzzz' } })
    await screen.findByText(/没有找到「zzzz」/)
    expect(screen.queryByTestId('global-search-more')).toBeNull()
  })

  it('NPC 命中后跳到数据 ID 并带上数据源与搜索词', async () => {
    const { onNavigate } = renderDialog()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '眼' } })

    fireEvent.click(await screen.findByRole('option', { name: /克苏鲁之眼/ }))
    expect(onNavigate).toHaveBeenCalledWith('dataid', { kind: 'npc', query: '克苏鲁之眼' })
  })

  it('回车执行高亮项，↓ 移动高亮', async () => {
    const { onNavigate } = renderDialog()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '物品' } })
    await screen.findByRole('option', { name: /物品 ID/ })

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    // 「物品」只命中页面与集合：向下一条后回车会落到物品集合（跳页而不是打开物品详情）。
    expect(screen.queryByTestId('global-search-item')).toBeNull()
    expect(onNavigate).toHaveBeenCalledWith('items', expect.objectContaining({ collectionId: expect.any(String) }))
  })

  it('指令行：登录后 Enter 都是「执行」（含必填参数），未登录是「查看」（行内无按钮）', async () => {
    const view = (canRunCommands: boolean) => (
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources()}
          onNavigate={vi.fn()}
          canRunCommands={canRunCommands}
          onRunCommand={async () => ({ status: 'ok', output: [] })}
        />
      </I18nProvider>
    )
    const hints = () => screen.getByTestId('global-search-keys').textContent ?? ''
    /** 行里不再有图标按钮：动作只写在底栏。 */
    const rowIcons = (row: HTMLElement) => row.querySelectorAll('[role="presentation"]').length

    const { rerender } = render(view(true))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'give' } })
    const giveRow = await screen.findByRole('option', { name: /\/give/ })
    // 必填参数不再拦执行：底栏写「执行」，行里也没有图标按钮。
    await waitFor(() => expect(hints()).toContain('执行'))
    expect(hints()).not.toContain('复制指令')
    fireEvent.pointerDown(screen.getByTestId('global-search-more'), { button: 0, ctrlKey: false })
    expect((await screen.findByRole('menu')).textContent).toContain('复制指令')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(rowIcons(giveRow)).toBe(0)

    // 未登录：不执行，Enter 变成「查看」（跳到指令小抄看用法）。
    rerender(view(false))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'give' } })
    await waitFor(() => expect(hints()).toContain('查看'))
    expect(hints()).not.toContain('执行')

    // 能裸跑的 /help：Enter = 执行（不是填终端）。
    rerender(view(true))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'help' } })
    await screen.findByRole('option', { name: /\/help/ })
    await waitFor(() => expect(hints()).toContain('执行'))

    // 未登录：不执行，Enter 只是打开（跳指令小抄）。
    rerender(view(false))
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
          canRunCommands={false}
          onRunCommand={async () => ({ status: 'ok', output: [] })}
        />
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '出生点' } })
    const group = await screen.findByRole('group', { name: '鱼店商品' })
    fireEvent.click(within(group).getByRole('option', { name: /传送回出生点/ }))
    // 带上编号：鱼店落到货架后直接打开这件商品的详情。
    expect(onNavigate).toHaveBeenCalledWith('store', {
      query: '传送回出生点',
      goodsSerial: 7,
    })
  })

  it('鱼店商品的次要信息是物品标签时渲染成图标，不显示原始 [i:..] 文本', async () => {
    render(
      <I18nProvider lang="zh">
        <DatasetProvider value={makeDataset()}>
          <GlobalSearchDialog
            open
            onOpenChange={() => {}}
            sources={sources({
              goods: [
                {
                  serial: 9,
                  name: '物品瓶',
                  iconId: 29,
                  // 价格写成物品标签（鱼店配置里很常见）
                  cost: '[i/s6:29][i:75]',
                  map: ['工具'],
                  desc: '',
                  unlock: '',
                  comment: '',
                },
              ] as unknown as GlobalSearchSources['goods'],
            })}
            onNavigate={vi.fn()}
            canRunCommands={false}
            onRunCommand={async () => ({ status: 'ok', output: [] })}
          />
        </DatasetProvider>
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '物品瓶' } })
    const group = await screen.findByRole('group', { name: '鱼店商品' })
    const row = within(group).getByRole('option', { name: /物品瓶/ })
    expect(row.textContent).not.toContain('[i')
    // 两个标签 → 两个 16px 小图标（行首那个 24px 是商品自己的图标）。
    const metaIcons = within(row)
      .getAllByRole('img')
      .filter((el) => el.getAttribute('width') === '16')
    expect(metaIcons.map((el) => el.getAttribute('aria-label'))).toEqual(['生命水晶', '坠落之星'])
    // 数量标签（s6）在图标角落里显示。
    expect(row.textContent).toContain('6')
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
    // 结果页上没有返回按钮：焦点留在输入框（底栏写着重跑 / 返回）。
    const input = screen.getByRole('combobox')
    expect(document.activeElement).toBe(input)
    expect(within(view).queryByRole('button', { name: '返回' })).toBeNull()

    // `Esc` 回到结果列表（不关弹框）
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('global-search-run')).toBeNull())
    expect(screen.getByRole('combobox')).toBeTruthy()
  })

  it('结果页再按 Enter 就再跑一遍：结果追加（不覆盖）；改成搜索词才回列表', async () => {
    const onRunCommand = vi
      .fn()
      .mockResolvedValueOnce({ status: 'ok' as const, output: ['服务器时间：中午'] })
      .mockResolvedValueOnce({ status: 'ok' as const, output: ['服务器时间：傍晚'] })
      .mockResolvedValue({ status: 'ok' as const, output: ['用法：/help 1'] })
    render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources()}
          onNavigate={vi.fn()}
          canRunCommands
          onRunCommand={onRunCommand}
        />
      </I18nProvider>,
    )
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '/help' } })
    const row = await screen.findByRole('option', { name: /执行指令：\/help/ })
    await waitFor(() => expect(row.getAttribute('aria-selected')).toBe('true'))
    fireEvent.keyDown(input, { key: 'Enter' })
    const view = await screen.findByTestId('global-search-run')
    expect(await within(view).findByText('服务器时间：中午')).toBeTruthy()
    // 输入框一直有焦点：同一个 Enter 就是再跑一遍，新结果接在后面（按 Esc 回列表前都留着）。
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onRunCommand).toHaveBeenCalledTimes(2))
    expect(onRunCommand).toHaveBeenLastCalledWith('/help')
    expect(await within(view).findByText('服务器时间：傍晚')).toBeTruthy()
    expect(within(view).getByText('服务器时间：中午')).toBeTruthy()
    expect(view.querySelectorAll('[data-run-entry]').length).toBe(2)

    // 列表底部固定的退路只跟最新一条走（这里两条都成功，所以没有）。
    expect(within(view).queryByRole('button', { name: '查看用法' })).toBeNull()

    // 补参数（`/help` → `/help 1`）**不丢已有结果**：还是结果页，Enter 就追加第三条。
    fireEvent.change(input, { target: { value: '/help 1' } })
    expect(screen.getByTestId('global-search-run')).toBeTruthy()
    expect(within(view).getByText('服务器时间：中午')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onRunCommand).toHaveBeenLastCalledWith('/help 1'))
    expect(await within(view).findByText('用法：/help 1')).toBeTruthy()
    expect(view.querySelectorAll('[data-run-entry]').length).toBe(3)
    // 每条自己带指令行，不会全写成输入框里最后那条。
    expect(within(view).getAllByText('/help', { selector: 'code' }).length).toBe(2)

    // 改成普通搜索词：离开结果页（否则 Enter 会跑错东西）。
    fireEvent.change(input, { target: { value: '石头' } })
    await waitFor(() => expect(screen.queryByTestId('global-search-run')).toBeNull())
  })

  it('执行结果用富文本渲染（`[c/..]` 上色、`[i:..]` 出物品图标）', async () => {
    render(
      <I18nProvider lang="zh">
        <GlobalSearchDialog
          open
          onOpenChange={() => {}}
          sources={sources()}
          onNavigate={vi.fn()}
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
    fireEvent.change(input, { target: { value: '眼' } })
    fireEvent.click(await screen.findByRole('option', { name: /克苏鲁之眼/ }))

    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
    expect(await screen.findByText('最近搜索')).toBeTruthy()
    // 最近搜索是可键盘选中的 option。
    expect(screen.getByRole('option', { name: '眼' })).toBeTruthy()
  })

  it('最近搜索：行尾 ✕ 可单条删除，删完回到空态提示', async () => {
    renderDialog()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '眼' } })
    fireEvent.click(await screen.findByRole('option', { name: /克苏鲁之眼/ }))

    const remove = await waitFor(() => {
      const el = document.querySelector('[data-recent-remove]')
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
    fireEvent.click(remove)

    await waitFor(() => expect(screen.queryByRole('option', { name: '眼' })).toBeNull())
    expect(screen.getByText(/可搜物品/)).toBeTruthy()
  })

  it('最近搜索：Delete / Backspace 删除高亮项（空查询时才接管）', async () => {
    renderDialog()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '眼' } })
    fireEvent.click(await screen.findByRole('option', { name: /克苏鲁之眼/ }))
    await waitFor(() => expect(screen.getByRole('option', { name: '眼' })).toBeTruthy())

    // 空查询 + 高亮第一条：Delete 直接删掉。
    const option = screen.getByRole('option', { name: '眼' })
    expect(option.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Delete' })
    await waitFor(() => expect(screen.queryByRole('option', { name: '眼' })).toBeNull())
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
    // 没有标题行：既没有「返回」按钮，也不写「物品 · 25 条」；条数在底栏左下。
    expect(within(detail).queryByRole('button', { name: '返回' })).toBeNull()
    expect(detail.textContent).not.toContain('物品 · 25 条')
    expect(screen.getByTestId('global-search-count').textContent).toBe('25 条')
    expect(within(detail).getByRole('option', { name: /更多/ }).textContent).toContain('物品 ID')
    expect(onNavigate).not.toHaveBeenCalled()

    // 「更多操作」里有「前往 物品 ID」：不用滚到 20 条之后再点那一行。
    fireEvent.pointerDown(screen.getByTestId('global-search-more'), { button: 0, ctrlKey: false })
    const menu = await screen.findByRole('menu')
    expect(menu.textContent).toContain('前往 物品 ID')
    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', ctrlKey: true })
    expect(onNavigate).toHaveBeenCalledWith('items', { query: '石头' })
  })

  it('二级：⌘⏎ 去目标页（命中没超上限也给这个出口）', async () => {
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
          canRunCommands={false}
          onRunCommand={async () => ({ status: 'ok', output: [] })}
        />
      </I18nProvider>,
    )
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '石头' } })
    fireEvent.click(await screen.findByRole('option', { name: /更多/ }))
    const detail = await screen.findByTestId('global-search-group')
    // 8 条命中：没有「更多」行（不需要分页），但仍然能一步去物品 ID。
    expect(within(detail).queryByRole('option', { name: /更多/ })).toBeNull()
    expect(screen.getByTestId('global-search-count').textContent).toBe('8 条')
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
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

  it('有必填参数的指令也直接执行（数据里的 required 不拦）：失败后给「查看用法」+「填入指令」', async () => {
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
    // 失败才给两个退路：看用法 / 把指令放回输入框补参数。
    expect(within(view).getByRole('button', { name: '查看用法' })).toBeTruthy()
    expect(within(view).getByRole('button', { name: '填入指令' })).toBeTruthy()

    // 填入 = 指令回到输入框（等价于用户自己敲了一遍），补完参数再回车。
    fireEvent.click(within(view).getByRole('button', { name: '填入指令' }))
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('/give')
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
          canRunCommands={false}
          onRunCommand={async () => ({ status: 'ok', output: [] })}
        />
      </I18nProvider>,
    )
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '石头' } })
    fireEvent.click(await screen.findByRole('option', { name: /更多/ }))
    const detail = await screen.findByTestId('global-search-group')
    // 二级第一行默认高亮：主操作是「打开」，复制在「更多操作」里。
    await waitFor(() =>
      expect(screen.getByTestId('global-search-primary').textContent).toContain('打开'),
    )
    fireEvent.pointerDown(screen.getByTestId('global-search-more'), { button: 0, ctrlKey: false })
    expect((await screen.findByRole('menu')).textContent).toContain('复制 ID')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
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
