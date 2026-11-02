import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { DEFAULT_HOME_CARDS, type HomeCardsPrefs } from '@/lib/homeCards'
import { closeRowMenu, openRowMenu } from '@/test/managerSheet'
import { HomeCardManager } from './HomeCardManager'

function Harness({ initial = DEFAULT_HOME_CARDS }: { initial?: HomeCardsPrefs }) {
  const [prefs, setPrefs] = useState(initial)
  const [manual, setManual] = useState<Record<string, boolean>>({})
  return (
    <I18nProvider lang="zh">
      <HomeCardManager
        open
        onOpenChange={() => {}}
        prefs={prefs}
        onChange={setPrefs}
        // 与首页一致：用户添加的卡片默认「不自动执行」。
        isManual={(id) => manual[id] ?? id.startsWith('c:')}
        onToggleManual={(id, value) => setManual((prev) => ({ ...prev, [id]: value }))}
      />
    </I18nProvider>
  )
}

function seedFavorites(cmds: string[]) {
  localStorage.setItem('tswui:favorites', JSON.stringify(cmds.map((cmd, i) => ({ cmd, ts: i }))))
}

/** 点行内的「编辑」按钮（在「是否显示」右边）。 */
function openEditor(row: HTMLElement) {
  fireEvent.click(within(row).getByRole('button', { name: '编辑' }))
}

/** 点「添加卡片」后，用按需展开的表单添加一张自定义卡片。 */
function addCard(name: string, command: string) {
  fireEvent.click(screen.getByRole('button', { name: '添加卡片' }))
  fireEvent.change(screen.getByLabelText('卡片名称'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('指令'), { target: { value: command } })
  fireEvent.click(screen.getByRole('button', { name: '添加' }))
}

afterEach(() => {
  localStorage.clear()
})

describe('HomeCardManager', () => {
  it('添加表单默认收起；行内徽标直接显示「自动执行」状态（不必进菜单）', async () => {
    render(<Harness />)
    expect(screen.queryByLabelText('卡片名称')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '添加卡片' }))
    expect(screen.getByLabelText('卡片名称')).toBeTruthy()

    // 内置卡片默认自动执行 → 行内是「自动执行」徽标。
    const row = screen.getByRole('listitem', { name: '游戏时间' })
    expect(within(row).getByLabelText('自动执行')).toBeTruthy()
    // 菜单里不再有「自动执行 / 是否显示 / 宽度」这三类项。
    const menu = await openRowMenu(row)
    expect(within(menu).queryByRole('menuitemcheckbox')).toBeNull()
    expect(within(menu).queryByRole('menuitemradio')).toBeNull()
    // 只剩排序 + 复制指令（内置卡没有编辑 / 删除）。
    expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      '上移',
      '下移',
      '复制指令',
    ])
  })

  it('点行内「自动执行」徽标即可切换成「不自动执行」', () => {
    render(<Harness />)
    const row = screen.getByRole('listitem', { name: '游戏时间' })
    fireEvent.click(within(row).getByLabelText('自动执行'))

    const toggled = screen.getByRole('listitem', { name: '游戏时间' })
    expect(within(toggled).getByLabelText('不自动执行')).toBeTruthy()
  })

  it('点行内尺寸徽标循环切换：左·小 → 左·大 → 右栏 → 左·小', () => {
    render(<Harness />)
    const size = () => screen.getByRole('listitem', { name: '游戏时间' })
    const clickCurrent = (name: string) => fireEvent.click(within(size()).getByLabelText(name))

    clickCurrent('左·小')
    expect(within(size()).getByLabelText('左·大')).toBeTruthy()
    clickCurrent('左·大')
    expect(within(size()).getByLabelText('右栏')).toBeTruthy()
    clickCurrent('右栏')
    expect(within(size()).getByLabelText('左·小')).toBeTruthy()
  })

  it('打开抽屉时焦点落在滚动区，不会让第一行按钮的 tooltip 自己弹出来', async () => {
    render(<Harness />)
    await waitFor(() =>
      expect(document.activeElement?.className).toContain('overflow-y-auto'),
    )
    // 第一行的拖拽手柄没有被聚焦（否则 Tooltip 会在打开 700ms 后自动出现）。
    const grip = within(screen.getByRole('listitem', { name: '服务器状态' })).getByRole('button', {
      name: '拖动排序',
    })
    expect(document.activeElement).not.toBe(grip)
  })

  it('说明文字放在正文底部（分割线之上有「使用说明」），不再占用正文开头', () => {
    render(<Harness />)
    // 没有「帮助」按钮了。
    expect(screen.queryByRole('button', { name: '帮助' })).toBeNull()

    const title = screen.getByText('使用说明')
    expect(screen.getByText(/设置成「自动执行」的卡片，会随自动刷新和「刷新全部」执行/)).toBeTruthy()
    expect(screen.getByText(/自定义卡片数据，按服务器分开存在本机/)).toBeTruthy()

    // 顺序：全部卡片都在说明之前（说明在列表下方）。
    const rows = screen.getAllByRole('listitem')
    const last = rows[rows.length - 1]
    expect(last.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('添加按钮在名称和指令都有效前保持禁用', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '添加卡片' }))
    const add = screen.getByRole('button', { name: '添加' })
    expect(add.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('卡片名称'), { target: { value: '我的卡片' } })
    expect(add.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('指令'), { target: { value: 'time' } })
    expect(add.hasAttribute('disabled')).toBe(false)
  })

  it('按需展开的表单可添加自定义卡片（默认小尺寸、不自动执行）', () => {
    render(<Harness />)
    addCard('我的卡片', 'time')
    const row = screen.getByRole('listitem', { name: '我的卡片' })
    expect(within(row).getByText('我的卡片')).toBeTruthy()
    expect(within(row).getByText('/time')).toBeTruthy()
    expect(within(row).getByLabelText('左·小')).toBeTruthy()
    expect(within(row).getByLabelText('不自动执行')).toBeTruthy()
  })

  it('点行内眼睛徽标即可隐藏 / 重新显示（不变灰、编辑按钮隐藏）', () => {
    render(<Harness />)
    const row = screen.getByRole('listitem', { name: '游戏时间' })
    fireEvent.click(within(row).getByLabelText('显示中'))

    const hiddenRow = screen.getByRole('listitem', { name: '游戏时间' })
    expect(within(hiddenRow).getByLabelText('已隐藏')).toBeTruthy()
    // 尺寸 / 自动执行徽标仍在（三件套始终显示），只是不可编辑。
    expect(within(hiddenRow).getByLabelText('左·小')).toBeTruthy()
    expect(hiddenRow.className).not.toContain('opacity-60')

    // 再点一次又显示回来。
    fireEvent.click(within(hiddenRow).getByLabelText('已隐藏'))
    expect(
      within(screen.getByRole('listitem', { name: '游戏时间' })).getByLabelText('显示中'),
    ).toBeTruthy()
  })

  it('内置卡片不再有「内置」徽标（有笔图标的才是自己加的）', async () => {
    render(<Harness />)
    const builtinRow = screen.getByRole('listitem', { name: '游戏时间' })
    expect(within(builtinRow).queryByText('内置')).toBeNull()
    expect(within(builtinRow).queryByRole('button', { name: '编辑' })).toBeNull()

    addCard('我的卡片', 'time')
    const customRow = screen.getByRole('listitem', { name: '我的卡片' })
    // 编辑是行内按钮（在「是否显示」右边）；内置卡没有。
    expect(within(customRow).getByRole('button', { name: '编辑' })).toBeTruthy()
    const menu = await openRowMenu(customRow)
    expect(within(menu).queryByRole('menuitem', { name: '编辑' })).toBeNull()
  })

  it('使用说明可以收起：收起后常驻 ⓘ 入口，点开又能看到，且三处共享同一份状态', async () => {
    // 说明块用正文判定（ⓘ 按钮里也藏着 aria-label 文本，别用 getByText('使用说明')）。
    const blockText = /设置成「自动执行」的卡片，会随自动刷新和「刷新全部」执行/
    const first = render(<Harness />)
    // 默认展开，页脚没有 ⓘ。
    expect(screen.getByText(blockText)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '使用说明' })).toBeNull()

    // 收起 → 说明消失，页脚出现 ⓘ 入口。
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByText(blockText)).toBeNull()
    const info = screen.getByRole('button', { name: '使用说明' })
    expect(info).toBeTruthy()

    // 重新打开 → 说明回来，ⓘ 仍在（收起过一次就一直显示）。
    fireEvent.click(info)
    expect(screen.getByText(blockText)).toBeTruthy()
    expect(screen.getByRole('button', { name: '使用说明' })).toBeTruthy()

    // 状态存在本机 key 上：重新挂载（相当于换一个抽屉）也是收起后的样子。
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    first.unmount()
    render(<Harness />)
    expect(screen.queryByText(blockText)).toBeNull()
    expect(screen.getByRole('button', { name: '使用说明' })).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('tswui:cardHelp') ?? '{}')).toEqual({
      closed: true,
      everClosed: true,
    })
  })

  it('「恢复默认」是纯图标按钮（悬停提示带名字），点一下就地二次确认', () => {
    render(<Harness />)
    const reset = screen.getByRole('button', { name: '恢复默认' })
    expect(reset.textContent?.trim()).toBe('')

    fireEvent.click(reset)
    expect(screen.getByRole('button', { name: '确认恢复' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
  })

  it('「更多」菜单里可以复制指令（规范化成带 / 的写法）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<Harness />)
    const row = screen.getByRole('listitem', { name: '游戏时间' })
    const menu = await openRowMenu(row)
    fireEvent.click(within(menu).getByRole('menuitem', { name: '复制指令' }))

    expect(writeText).toHaveBeenCalledWith('/time')
    // 复制后菜单项短暂变成「已复制」（菜单不关，方便连续操作）。
    expect(await within(menu).findByRole('menuitem', { name: '已复制' })).toBeTruthy()

    // 没有指令的卡片（记事本 / 状态卡）不出现「复制指令」。
    await closeRowMenu()
    const serverRow = screen.getByRole('listitem', { name: '服务器状态' })
    const serverMenu = await openRowMenu(serverRow)
    expect(within(serverMenu).queryByRole('menuitem', { name: '复制指令' })).toBeNull()
  })

  it('删除在「更多设置」菜单里，点开后再二次确认', async () => {
    render(<Harness />)
    addCard('我的卡片', 'time')
    const row = screen.getByRole('listitem', { name: '我的卡片' })

    const menu = await openRowMenu(row)
    fireEvent.click(within(menu).getByRole('menuitem', { name: '删除卡片' }))
    await closeRowMenu()

    // 弹出确认框，名称在描述里。
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('我的卡片')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }))

    expect(screen.queryByRole('listitem', { name: '我的卡片' })).toBeNull()
  })

  it('自定义卡片指令输入框关联收藏指令的下拉候选', async () => {
    seedFavorites(['/time 12:00', '/who'])
    render(<Harness />)
    addCard('卡片', 'time')
    const row = screen.getByRole('listitem', { name: '卡片' })
    openEditor(row)

    const cmdInput = screen.getAllByPlaceholderText('/指令').find((el) => el.getAttribute('list'))
    expect(cmdInput).toBeTruthy()

    const datalist = document.getElementById(cmdInput!.getAttribute('list')!)
    expect(datalist).toBeTruthy()
    const values = Array.from(datalist!.querySelectorAll('option')).map((o) =>
      o.getAttribute('value'),
    )
    expect(values).toEqual(['/time 12:00', '/who'])
  })

  it('无收藏时指令输入框不关联下拉候选（不报错）', async () => {
    render(<Harness />)
    addCard('卡片', 'time')
    const row = screen.getByRole('listitem', { name: '卡片' })
    openEditor(row)
    const cmdInput = screen.getAllByPlaceholderText('/指令').find((el) => el.getAttribute('list'))
    expect(cmdInput).toBeUndefined()
  })

  it('可用「上移 / 下移」调整顺序（键盘 / 触屏可达）', async () => {
    render(<Harness />)
    const labels = () => screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))
    const before = labels()
    expect(before.length).toBeGreaterThan(1)

    // 第一项的上移禁用
    const firstMenu = await openRowMenu(screen.getAllByRole('listitem')[0])
    expect(
      within(firstMenu).getByRole('menuitem', { name: '上移' }).getAttribute('data-disabled'),
    ).not.toBeNull()

    await closeRowMenu()
    const secondMenu = await openRowMenu(screen.getAllByRole('listitem')[1])
    fireEvent.click(within(secondMenu).getByRole('menuitem', { name: '下移' }))
    await closeRowMenu()

    const after = labels()
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[2])
    expect(after[2]).toBe(before[1])
  })
})
