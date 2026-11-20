import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { needsUserInput, templateFromSet } from '@/lib/cardParams'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import { CustomCommandCard } from './CustomCommandCard'

const dataset = makeDataset()
const give = dataset.commands.find((c) => c.name === 'give')!
const giveSet = give.paramSets![0]!
const template = templateFromSet('give', giveSet)

function renderCard(overrides: Partial<Parameters<typeof CustomCommandCard>[0]> = {}) {
  const onRun = vi.fn()
  const onTemplateChange = vi.fn()
  const utils = render(
    <I18nProvider lang="zh">
      <CustomCommandCard
        card={{ id: 'c:1', name: '给物品', command: '/give', template }}
        dataset={dataset}
        title="给物品"
        onRun={onRun}
        onTemplateChange={onTemplateChange}
        collapseKey="test:give"
        players={['Alice', 'Bob']}
        {...overrides}
      />
    </I18nProvider>,
  )
  return { onRun, onTemplateChange, ...utils }
}

describe('CustomCommandCard', () => {
  it('普通指令卡片：照旧一条指令、点执行就发出', () => {
    const { onRun, container } = renderCard({
      card: { id: 'c:2', name: '在线玩家', command: '/who' },
    })
    expect(container.querySelector('[data-command]')?.getAttribute('data-command')).toBe('/who')
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    expect(onRun).toHaveBeenCalledWith('/who')
  })

  it('参数卡片：输入区在卡片正文里（不放页头），控件不占满整行', () => {
    const { container } = renderCard()
    const form = screen.getByTestId('card-param-form')
    expect(form.closest('[data-slot="card-body"]')).toBeTruthy()
    // 页头里没有参数输入框。
    const header = container.querySelector('[data-slot="card-header"]')
    expect(header ? header.querySelector('[data-slot="card-param-field"]') : null).toBeNull()
    // 输入框是固定宽度（不铺满一行）。
    const input = screen.getByLabelText('参数2')
    expect(input.className).toContain('w-24')
  })

  it('参数卡片：渲染需要现场填的参数，页脚显示拼好的指令', () => {
    const { container } = renderCard()
    expect(screen.getByTestId('card-param-form')).toBeTruthy()
    expect(screen.getByLabelText('参数1')).toBeTruthy()
    expect(screen.getByLabelText('参数2')).toBeTruthy()
    // 可选参数默认不传：卡片上没有它们的输入框。
    expect(screen.queryByLabelText('参数3')).toBeNull()
    expect(container.querySelector('[data-command]')?.getAttribute('data-command')).toBe('/give')
  })

  it('必填参数没填：按钮置灰 + 提示还缺什么；填完就能执行', () => {
    const { onRun } = renderCard()
    expect(screen.getByText('还需要填写：参数1、参数2')).toBeTruthy()
    const run = screen.getByRole('button', { name: '执行' })
    expect(run.hasAttribute('disabled')).toBe(true)
    fireEvent.click(run)
    expect(onRun).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('参数1'), { target: { value: '29' } })
    fireEvent.change(screen.getByLabelText('参数2'), { target: { value: 'Alice' } })
    expect(screen.queryByText(/还需要填写/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    expect(onRun).toHaveBeenCalledWith('/give 29 Alice')
  })

  it('页脚显示最终会执行的指令（填完先看一眼再点执行）', () => {
    renderCard()
    const preview = screen.getByTestId('card-command-preview')
    expect(preview.textContent).toBe('/give')
    fireEvent.change(screen.getByLabelText('参数1'), { target: { value: '29' } })
    fireEvent.change(screen.getByLabelText('参数2'), { target: { value: 'Alice' } })
    expect(screen.getByTestId('card-command-preview').textContent).toBe('/give 29 Alice')
  })

  it('输入的值会写回存储（停止输入后才写）', async () => {
    const { onTemplateChange } = renderCard()
    fireEvent.change(screen.getByLabelText('参数2'), { target: { value: 'Alice' } })
    await waitFor(() =>
      expect(onTemplateChange).toHaveBeenCalledWith({
        ...template,
        args: [{ mode: 'fill', value: '' }, { mode: 'fill', value: 'Alice' }, template.args[2], template.args[3]],
      }),
    )
  })

  it('模板对不上指令库：提示重新配置，不执行半截指令', () => {
    const { onRun } = renderCard({
      card: {
        id: 'c:3',
        name: '给物品',
        command: '/give',
        template: { ...template, syntax: 'give <player>' },
      },
    })
    expect(screen.getByText(/指令库已变化/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '执行' })).toBeNull()
    expect(onRun).not.toHaveBeenCalled()
  })

  it('没有指令的自定义卡片：提示未填写', () => {
    renderCard({ card: { id: 'c:4', name: '空卡片', command: '' } })
    expect(screen.getByText(/请先在上方「管理卡片」中填写指令/)).toBeTruthy()
  })

  it('needsUserInput：只有「执行时填」的参数才算需要现场填', () => {
    expect(needsUserInput({ template })).toBe(true)
    expect(
      needsUserInput({ template: { ...template, args: template.args.map((a) => ({ ...a, mode: 'fixed' as const })) } }),
    ).toBe(false)
    expect(needsUserInput({})).toBe(false)
  })
})
