import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { DEFAULT_HOME_CARDS, type HomeCardsPrefs } from '@/lib/homeCards'
import { HomeCardManager } from './HomeCardManager'

function Harness({ initial = DEFAULT_HOME_CARDS }: { initial?: HomeCardsPrefs }) {
  const [prefs, setPrefs] = useState(initial)
  return (
    <I18nProvider lang="zh">
      <HomeCardManager open onOpenChange={() => {}} prefs={prefs} onChange={setPrefs} />
    </I18nProvider>
  )
}

function seedFavorites(cmds: string[]) {
  localStorage.setItem('tswui:favorites', JSON.stringify(cmds.map((cmd, i) => ({ cmd, ts: i }))))
}

afterEach(() => {
  localStorage.clear()
})

describe('HomeCardManager', () => {
  it('点击「添加」后聚焦到新卡片的名称输入框', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    const nameInput = screen.getByPlaceholderText('卡片名称')
    expect(document.activeElement).toBe(nameInput)
  })

  it('指令输入框关联收藏指令的下拉候选', () => {
    seedFavorites(['/time 12:00', '/who'])
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    const cmdInput = screen.getByPlaceholderText('/指令')
    const listId = cmdInput.getAttribute('list')
    expect(listId).toBeTruthy()

    const datalist = document.getElementById(listId!)
    expect(datalist).toBeTruthy()
    const values = Array.from(datalist!.querySelectorAll('option')).map((o) =>
      o.getAttribute('value'),
    )
    expect(values).toEqual(['/time 12:00', '/who'])
  })

  it('无收藏时下拉候选为空（不报错）', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    const cmdInput = screen.getByPlaceholderText('/指令')
    const datalist = document.getElementById(cmdInput.getAttribute('list')!)
    expect(datalist!.querySelectorAll('option')).toHaveLength(0)
  })
})
