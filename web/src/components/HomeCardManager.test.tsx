import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { DEFAULT_HOME_CARDS, type HomeCardsPrefs } from '@/lib/homeCards'
import { HomeCardManager } from './HomeCardManager'

function Harness({ initial = DEFAULT_HOME_CARDS }: { initial?: HomeCardsPrefs }) {
  const [prefs, setPrefs] = useState(initial)
  return (
    <I18nProvider lang="zh">
      <HomeCardManager
        open
        onOpenChange={() => {}}
        prefs={prefs}
        onChange={setPrefs}
        isManual={() => false}
        onToggleManual={() => {}}
      />
    </I18nProvider>
  )
}

function seedFavorites(cmds: string[]) {
  localStorage.setItem('tswui:favorites', JSON.stringify(cmds.map((cmd, i) => ({ cmd, ts: i }))))
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
  it('添加表单默认收起，自动执行使用 Checkbox', () => {
    render(<Harness />)
    expect(screen.queryByLabelText('卡片名称')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '添加卡片' }))
    expect(screen.getByLabelText('卡片名称')).toBeTruthy()

    const autoExec = screen.getByRole('checkbox', { name: '游戏时间 自动执行' })
    expect(autoExec.getAttribute('data-state')).toBe('checked')
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

  it('按需展开的表单可添加自定义卡片', () => {
    render(<Harness />)
    addCard('我的卡片', 'time')
    const row = screen.getByRole('listitem', { name: '我的卡片' })
    expect(within(row).getByText('我的卡片')).toBeTruthy()
    expect(within(row).getByText('/time')).toBeTruthy()
  })

  it('自定义卡片指令输入框关联收藏指令的下拉候选', () => {
    seedFavorites(['/time 12:00', '/who'])
    render(<Harness />)
    addCard('卡片', 'time')
    const row = screen.getByRole('listitem', { name: '卡片' })
    fireEvent.click(within(row).getByRole('button', { name: '编辑' }))

    const cmdInput = screen.getAllByPlaceholderText('/指令').find((el) => el.getAttribute('list'))
    expect(cmdInput).toBeTruthy()

    const datalist = document.getElementById(cmdInput!.getAttribute('list')!)
    expect(datalist).toBeTruthy()
    const values = Array.from(datalist!.querySelectorAll('option')).map((o) =>
      o.getAttribute('value'),
    )
    expect(values).toEqual(['/time 12:00', '/who'])
  })

  it('无收藏时指令输入框不关联下拉候选（不报错）', () => {
    render(<Harness />)
    addCard('卡片', 'time')
    const row = screen.getByRole('listitem', { name: '卡片' })
    fireEvent.click(within(row).getByRole('button', { name: '编辑' }))
    const cmdInput = screen.getAllByPlaceholderText('/指令').find((el) => el.getAttribute('list'))
    expect(cmdInput).toBeUndefined()
  })

  it('可用「上移 / 下移」按钮调整顺序（键盘 / 触屏可达）', () => {
    render(<Harness />)
    const labels = () => screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))
    const before = labels()
    expect(before.length).toBeGreaterThan(1)
    // 第一项的上移按钮禁用
    expect(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: '上移' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(within(screen.getAllByRole('listitem')[1]).getByRole('button', { name: '下移' }))
    const after = labels()
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[2])
    expect(after[2]).toBe(before[1])
  })
})
