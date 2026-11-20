import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NO_INGAME } from '@/lib/ingame'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import { CardEditorPanel, type CardEditorDraft } from './CardEditorPanel'

const dataset = makeDataset()

function renderPanel(overrides: Partial<Parameters<typeof CardEditorPanel>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  const utils = render(
    <I18nProvider lang="zh">
      <CardEditorPanel
        dataset={dataset}
        ingame={NO_INGAME}
        players={['Alice', 'Bob']}
        submitLabel="添加"
        onSubmit={onSubmit}
        onCancel={onCancel}
        {...overrides}
      />
    </I18nProvider>,
  )
  return { onSubmit, onCancel, ...utils }
}

/** 面板的两行：名称+指令；操作按钮组 + 指令参数。 */
describe('CardEditorPanel', () => {
  it('两行布局：名称 / 指令 / 三个操作按钮 / 指令参数', () => {
    renderPanel()
    expect(screen.getByLabelText('名称')).toBeTruthy()
    expect(screen.getByLabelText('指令')).toBeTruthy()
    // 操作按钮组：当前值直接显示在按钮上。
    expect(screen.getByLabelText('左·小')).toBeTruthy()
    expect(screen.getByLabelText('自动执行')).toBeTruthy()
    expect(screen.getByLabelText('显示中')).toBeTruthy()
    expect(screen.getByRole('button', { name: /指令参数/ })).toBeTruthy()
  })

  it('填指令前不能提交；操作按钮组的设置随提交带出去', () => {
    const { onSubmit } = renderPanel()
    const submit = screen.getByRole('button', { name: '添加' })
    expect(submit.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '公告' } })
    fireEvent.change(screen.getByLabelText('指令'), { target: { value: '/help' } })

    // 尺寸循环：左·小 → 左·大；自动执行 → 手动；显示 → 隐藏。
    fireEvent.click(screen.getByLabelText('左·小'))
    expect(screen.getByLabelText('左·大')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('自动执行'))
    expect(screen.getByLabelText('不自动执行')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('显示中'))
    expect(screen.getByLabelText('已隐藏')).toBeTruthy()

    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith({
      name: '公告',
      command: '/help',
      template: undefined,
      width: 'full',
      manual: true,
      hidden: true,
    } satisfies CardEditorDraft)
  })

  it('「指令参数」是指令输入框内的 addon（在 input 组的右端）', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('指令'), { target: { value: 'give' } })
    const button = screen.getByRole('button', { name: /指令参数/ })
    expect(button.closest('[data-slot="input-group"]')).toBeTruthy()
    expect(button.closest('[data-align="inline-end"]')).toBeTruthy()
  })

  it('点输入框本身不会把候选关掉（回归：下拉闪一下就消失）', async () => {
    renderPanel()
    const input = screen.getByLabelText('指令') as HTMLInputElement
    fireEvent.focus(input)
    expect(await screen.findByRole('listbox')).toBeTruthy()

    // Radix 在没有 PopoverTrigger 时会把 anchor 上的这次点击当成「点外部」。
    fireEvent.pointerDown(input)
    fireEvent.click(input)
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy())
  })

  it('指令名有候选：输入片段点一条直接填成 /指令名', async () => {
    renderPanel()
    const input = screen.getByLabelText('指令') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'gi' } })
    fireEvent.click(await screen.findByRole('option', { name: /\/give/ }))
    expect(input.value).toBe('/give')
  })

  it('指令参数：按参数表配值，提交带上模板', async () => {
    const { onSubmit } = renderPanel()
    fireEvent.change(screen.getByLabelText('指令'), { target: { value: 'give' } })
    // 有参数表的指令：按钮上显示参数个数。
    const paramsButton = screen.getByRole('button', { name: /指令参数/ })
    expect(paramsButton.textContent).toContain('4')
    fireEvent.click(paramsButton)

    const popover = await screen.findByTestId('card-params-popover')
    // 必填参数（物品 / 玩家）默认「每次填写」；可选参数（数量 / 词缀）默认「不传」，只给取值方式。
    fireEvent.change(within(popover).getByLabelText('player'), { target: { value: 'Alice' } })

    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    const draft = onSubmit.mock.calls[0]?.[0] as CardEditorDraft
    expect(draft.command).toBe('/give')
    expect(draft.template?.command).toBe('give')
    expect(draft.template?.args[1]).toEqual({ mode: 'fill', value: 'Alice' })
    expect(draft.template?.args[2]).toEqual({ mode: 'omit', value: '' })
  })

  it('只能在游戏内执行的指令：说明原因并禁止提交', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('指令'), { target: { value: '/item' } })
    expect(screen.getByText(/只能在游戏内执行/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加' }).hasAttribute('disabled')).toBe(true)
  })

  it('指令里自带参数：提示去右侧配，且不能提交', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('指令'), { target: { value: '/time night' } })
    expect(screen.getByText(/指令只填指令名/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加' }).hasAttribute('disabled')).toBe(true)
  })

  it('没有参数表的指令：指令参数按钮置灰', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('指令'), { target: { value: 'help' } })
    expect(screen.getByRole('button', { name: /指令参数/ }).hasAttribute('disabled')).toBe(true)
  })

  it('编辑：预填名称 / 指令 / 尺寸 / 自动执行 / 显示', () => {
    const { onSubmit } = renderPanel({
      submitLabel: '保存',
      initial: {
        name: '给物品',
        command: '/give',
        template: {
          command: 'give',
          syntax: 'give <item type/id> <player> [item amount] [prefix id/name]',
          args: [
            { mode: 'fixed', value: '29' },
            { mode: 'fill', value: '' },
            { mode: 'omit', value: '' },
            { mode: 'omit', value: '' },
          ],
        },
        width: 'right',
        manual: true,
        hidden: true,
      },
    })
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('给物品')
    expect((screen.getByLabelText('指令') as HTMLInputElement).value).toBe('/give')
    expect(screen.getByLabelText('右栏')).toBeTruthy()
    expect(screen.getByLabelText('不自动执行')).toBeTruthy()
    expect(screen.getByLabelText('已隐藏')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    const draft = onSubmit.mock.calls[0]?.[0] as CardEditorDraft
    expect(draft).toMatchObject({ name: '给物品', command: '/give', width: 'right', manual: true, hidden: true })
    expect(draft.template?.args[0]).toEqual({ mode: 'fixed', value: '29' })
  })
})
