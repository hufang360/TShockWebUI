import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { CommandEditor } from './CommandEditor'

describe('CommandEditor 外部插入', () => {
  it('从未聚焦时把插入文本追加到末尾', () => {
    const onChange = vi.fn()
    render(
      <CommandEditor
        value="/time"
        onChange={onChange}
        computeCompletions={() => []}
        onExecute={() => {}}
        busy={false}
        atlas={undefined}
        insertRequest={{ token: 1, text: '[i:29]' }}
        onInsertHandled={() => {}}
      />,
    )
    expect(onChange).toHaveBeenCalledWith('/time[i:29]')
  })

  it('空编辑器插入即写入该文本', () => {
    const onChange = vi.fn()
    render(
      <CommandEditor
        value=""
        onChange={onChange}
        computeCompletions={() => []}
        onExecute={() => {}}
        busy={false}
        atlas={undefined}
        insertRequest={{ token: 2, text: '29' }}
        onInsertHandled={() => {}}
      />,
    )
    expect(onChange).toHaveBeenCalledWith('29')
  })
})

describe('CommandEditor 输入组与拦截提示', () => {
  const baseProps = {
    value: '/i 29',
    onChange: () => {},
    computeCompletions: () => [],
    busy: false,
    atlas: undefined,
  } as const

  it('invalid 时编辑器文本标红', () => {
    const { container } = render(<CommandEditor {...baseProps} onExecute={() => {}} invalid />)
    const ta = container.querySelector('textarea')
    expect(ta?.className).toContain('text-destructive')
  })

  it('执行按钮位于输入组内，点击触发 onExecute', () => {
    const onExecute = vi.fn()
    render(
      <I18nProvider lang="zh">
        <CommandEditor {...baseProps} onExecute={onExecute} />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    expect(onExecute).toHaveBeenCalledTimes(1)
  })

  // 参数提示（用法串原文）显示在编辑器下方。
  it('显示当前参数的用法串提示', () => {
    const { container } = render(
      <CommandEditor
        {...baseProps}
        onExecute={() => {}}
        getParamHint={() => 'give <item type/id> <player> [item amount] [prefix id/name]'}
      />,
    )
    expect(container.textContent).toContain('give <item type/id> <player>')
  })

  it('没有参数表时不显示用法串', () => {
    const { container } = render(
      <CommandEditor {...baseProps} onExecute={() => {}} getParamHint={() => null} />,
    )
    expect(container.textContent).not.toContain('<item type/id>')
  })

  // 设计原则与约束 §1.1 / §7：必须区分输入法确认候选与执行指令。
  it('输入法组合输入中按 Enter 不执行', () => {
    const onExecute = vi.fn()
    const { container } = render(<CommandEditor {...baseProps} onExecute={onExecute} />)
    const ta = container.querySelector('textarea') as HTMLTextAreaElement

    fireEvent.compositionStart(ta)
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(onExecute).not.toHaveBeenCalled()

    // 组合结束后 Enter 才真正执行（注入 isComposing 的浏览器行为由 ref 覆盖）。
    fireEvent.compositionEnd(ta)
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(onExecute).toHaveBeenCalledTimes(1)
  })

  it('无补全时 Enter 执行且不换行', () => {
    const onExecute = vi.fn()
    const { container } = render(<CommandEditor {...baseProps} onExecute={onExecute} />)
    const ta = container.querySelector('textarea') as HTMLTextAreaElement

    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    ta.dispatchEvent(ev)
    expect(onExecute).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
  })
})
