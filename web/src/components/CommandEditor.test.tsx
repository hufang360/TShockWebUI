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

  it('语法只出现在帮助条里，候选行不重复（行内 = 指令 / 别名 / 说明 / 权限）', () => {
    const { container } = render(
      <I18nProvider lang="zh">
        <CommandEditor
          value="/acc"
          onChange={() => {}}
          computeCompletions={() => [
            {
              id: 'cmd:accountinfo',
              kind: 'command',
              label: '/accountinfo',
              syntax: '<username>',
              detail: '/ai · 显示一个用户的信息。',
              insert: '/accountinfo',
              command: cmd({ name: 'accountinfo' }),
            },
          ]}
          onExecute={() => {}}
          busy={false}
          atlas={undefined}
        />
      </I18nProvider>,
    )
    fireEvent.click(container.querySelector('textarea') as HTMLTextAreaElement)

    const row = screen.getAllByRole('option')[0]
    expect(within(row).getByText('/accountinfo')).toBeTruthy()
    expect(within(row).getByText('/ai · 显示一个用户的信息。')).toBeTruthy()
    expect(within(row).queryByText('<username>')).toBeNull()

    // 语法不写进候选行，而是作为半透明幽灵文字补在输入框里（终端手感）。
    const ghost = container.querySelector('[data-slot="command-ghost"]') as HTMLElement
    expect(ghost.textContent).toBe('/accountinfo ')
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

describe('CommandEditor 幽灵文字（终端式指令用法）', () => {
  const helpProps = {
    value: '/accountinfo ',
    onChange: () => {},
    computeCompletions: () => [],
    getHelp: () => ({ syntax: '/accountinfo <username>', note: '显示一个用户的信息。' }),
    onExecute: () => {},
    busy: false,
    atlas: undefined,
  } as const

  const ghostOf = (container: HTMLElement) =>
    container.querySelector('[data-slot="command-ghost"]')

  it('没有候选时，用半透明文字补完用法剩下的部分（不弹空浮层）', () => {
    const { container } = render(
      <I18nProvider lang="zh">
        <CommandEditor {...helpProps} />
      </I18nProvider>,
    )
    fireEvent.click(container.querySelector('textarea') as HTMLTextAreaElement)

    // 不弹浮层：没有候选项就没有「↑↓ 选择」这种会误导的提示。
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('option')).toBeNull()

    const ghost = ghostOf(container) as HTMLElement
    // 图层里先放「已输入内容的不可见副本」用于对齐光标，所以只看补出来的那截；
    // 说明不塞进输入行（那在下拉框顶部那条里）。
    expect(ghost.textContent).toBe('/accountinfo <username>')
    expect(ghost.textContent?.endsWith(' <username>')).toBe(true)
    // 半透明 + 装饰性：不挡点击、读屏忽略。
    expect(ghost.className).toContain('text-muted-foreground/40')
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    expect(ghost.className).toContain('pointer-events-none')
  })

  it('有候选时补完当前词（Tab / Enter 接受的正是同一条）', () => {
    const { container } = render(
      <I18nProvider lang="zh">
        <CommandEditor
          value="/worldevent invasion gob"
          onChange={() => {}}
          computeCompletions={() => [
            {
              id: 'enum:goblins',
              kind: 'enum',
              label: 'goblins',
              detail: '',
              insert: 'goblins',
              suffix: ' ',
            },
          ]}
          onExecute={() => {}}
          busy={false}
          atlas={undefined}
        />
      </I18nProvider>,
    )
    fireEvent.click(container.querySelector('textarea') as HTMLTextAreaElement)
    // 补出来的正好是 Tab / Enter 会接受的内容（含它自带的尾随空格）。
    expect(ghostOf(container)?.textContent).toBe('/worldevent invasion goblins ')
  })

  it('光标不在末尾时不出幽灵文字（否则会盖住后面已输入的内容）', () => {
    const { container } = render(
      <I18nProvider lang="zh">
        <CommandEditor {...helpProps} />
      </I18nProvider>,
    )
    const ta = container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.click(ta)
    expect(ghostOf(container)).toBeTruthy()

    // 把光标移到开头。
    ta.setSelectionRange(0, 0)
    fireEvent.select(ta)
    expect(ghostOf(container)).toBeNull()
  })

  it('没有用法可补时不出幽灵文字', () => {
    const { container } = render(
      <I18nProvider lang="zh">
        <CommandEditor {...helpProps} getHelp={() => null} computeCompletions={() => []} />
      </I18nProvider>,
    )
    fireEvent.click(container.querySelector('textarea') as HTMLTextAreaElement)
    expect(ghostOf(container)).toBeNull()
  })

  it('下拉框里给完整用法 + 备注（幽灵文字只补当前词，二者互补）', () => {
    const { container } = render(
      <I18nProvider lang="zh">
        <CommandEditor
          {...helpProps}
          computeCompletions={() => [
            { id: 'player:Alice', kind: 'player', label: 'Alice', detail: '在线玩家', insert: 'Alice' },
          ]}
        />
      </I18nProvider>,
    )
    fireEvent.click(container.querySelector('textarea') as HTMLTextAreaElement)
    const note = screen.getByRole('note')
    expect(note.textContent).toContain('/accountinfo <username>')
    expect(note.textContent).toContain('显示一个用户的信息。')
    expect(container.querySelector('textarea')?.getAttribute('aria-describedby')).toBe(note.id)
  })

  it('没有候选时 Enter 直接执行指令（不会卡在空浮层里）', () => {
    const onExecute = vi.fn()
    const { container } = render(
      <I18nProvider lang="zh">
        <CommandEditor {...helpProps} onExecute={onExecute} />
      </I18nProvider>,
    )
    const ta = container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.click(ta)
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(onExecute).toHaveBeenCalledTimes(1)
  })

  it('没有候选时 ↓ 不会把草稿清空（回归：掉进历史回翻成空串 / undefined 崩掉）', () => {
    const onChange = vi.fn()
    const { container } = render(
      <I18nProvider lang="zh">
        <CommandEditor
          {...helpProps}
          onChange={onChange}
          history={['/time day', '/give 29 Alice']}
        />
      </I18nProvider>,
    )
    const ta = container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.click(ta)

    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    // 草稿原位（回翻回到「未在选择」时会把草稿还回来，而不是清空）。
    for (const call of onChange.mock.calls) expect(call[0]).toBe('/accountinfo ')
  })
})

describe('CommandEditor 历史回翻', () => {
  const history = ['/time day', '/give 29 Alice']
  const onChange = vi.fn()

  function renderHistory() {
    const view = render(
      <I18nProvider lang="zh">
        <CommandEditor
          value=""
          onChange={onChange}
          computeCompletions={() => []}
          onExecute={() => {}}
          busy={false}
          atlas={undefined}
          history={history}
        />
      </I18nProvider>,
    )
    return view.container.querySelector('textarea') as HTMLTextAreaElement
  }

  it('草稿处一直按下方向键不会取出不存在的历史（回归：undefined 崩页）', () => {
    onChange.mockClear()
    const ta = renderHistory()
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    // 始终停在草稿：写回空串，绝不是 undefined。
    for (const call of onChange.mock.calls) expect(call[0]).toBe('')
  })

  it('从草稿往上翻是最近一条，再往下回到草稿', () => {
    onChange.mockClear()
    const ta = renderHistory()
    fireEvent.keyDown(ta, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('/time day')
    fireEvent.keyDown(ta, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('/give 29 Alice')
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith('/time day')
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith('')
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
