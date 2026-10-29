import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import type { CommandDef } from '@/types'
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

describe('CommandEditor 指令候选', () => {
  const cmd = (patch: Partial<CommandDef> & { name: string }): CommandDef => ({
    aliases: [],
    permission: null,
    help: 'help',
    allowServer: true,
    doLog: true,
    ...patch,
  })

  const items = [
    {
      id: 'cmd:user',
      kind: 'command' as const,
      label: '/user',
      detail: '管理用户账号。',
      insert: '/user',
      command: cmd({ name: 'user', permission: 'tshock.superadmin.user' }),
    },
    {
      id: 'cmd:help',
      kind: 'command' as const,
      label: '/help',
      detail: '列出指令或显示指令的帮助信息。',
      insert: '/help',
      command: cmd({ name: 'help' }),
    },
  ]

  /** 受控 harness：空输入不弹，输入 `/` 后才弹（组件按 value 内容决定）。 */
  function ListHarness() {
    const [value, setValue] = useState('')
    return (
      <I18nProvider lang="zh">
        <CommandEditor
          value={value}
          onChange={setValue}
          computeCompletions={() => items}
          onExecute={() => {}}
          busy={false}
          atlas={undefined}
        />
      </I18nProvider>
    )
  }

  const renderList = () => {
    const view = render(<ListHarness />)
    fireEvent.change(view.container.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: '/' },
    })
    return view
  }

  it('有权限需求的指令显示权限节点，没有权限需求的不显示「无需权限」', () => {
    const { container } = renderList()
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(within(options[0]).getByText('tshock.superadmin.user')).toBeTruthy()
    expect(within(options[1]).queryByText(/无需权限/)).toBeNull()
    expect(container.textContent).not.toContain('无需权限')
  })

  it('指令 / 说明 / 权限 收在同一行（一行一条，不写三行）', () => {
    renderList()
    const row = screen.getAllByRole('option')[0]
    // 三端文本同属一个横向容器，行高由一条文字决定。
    const line = row.querySelector('.flex-wrap')
    expect(line).toBeTruthy()
    expect(within(line as HTMLElement).getByText('/user')).toBeTruthy()
    expect(within(line as HTMLElement).getByText('管理用户账号。')).toBeTruthy()
    expect(within(line as HTMLElement).getByText('tshock.superadmin.user')).toBeTruthy()
  })
})

describe('CommandEditor 下拉框出现时机与外观', () => {
  const items = [
    {
      id: 'cmd:give',
      kind: 'command' as const,
      label: '/give',
      detail: '/g · 给玩家物品。',
      insert: '/give',
      command: {
        name: 'give',
        aliases: ['g'],
        permission: 'tshock.item.give',
        help: 'Gives another player an item.',
        allowServer: true,
        doLog: true,
      },
    },
  ]

  function Harness() {
    const [value, setValue] = useState('')
    return (
      <I18nProvider lang="zh">
        <CommandEditor
          value={value}
          onChange={setValue}
          computeCompletions={() => items}
          onExecute={() => {}}
          busy={false}
          atlas={undefined}
        />
      </I18nProvider>
    )
  }

  it('输入框为空时不弹下拉框（聚焦 / 点击也不弹），输入 `/` 才弹', () => {
    const { container } = render(<Harness />)
    const ta = container.querySelector('textarea') as HTMLTextAreaElement

    fireEvent.click(ta)
    expect(screen.queryAllByRole('option')).toHaveLength(0)

    fireEvent.change(ta, { target: { value: '/' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)

    // 清空后自己收起来
    fireEvent.change(ta, { target: { value: '' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('下拉框有描边', () => {
    const { container } = render(<Harness />)
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: '/' },
    })
    const panel = screen.getByRole('listbox').parentElement as HTMLElement
    expect(panel.className).toContain('border')
    expect(panel.className).toContain('border-border/60')
  })
})

describe('CommandEditor 历史回翻', () => {
  it('下拉关闭时 ↑ 逐条回翻历史（最新在前），再按 ↓ 往回', () => {
    const onChange = vi.fn()
    const { container } = render(
      <CommandEditor
        value=""
        onChange={onChange}
        computeCompletions={() => []}
        onExecute={() => {}}
        busy={false}
        atlas={undefined}
        history={['/time day', '/help']}
      />,
    )
    const ta = container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.keyDown(ta, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('/time day')
    fireEvent.keyDown(ta, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('/help')
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith('/time day')
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith('')
  })
})
