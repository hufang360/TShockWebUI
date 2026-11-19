import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { templateFromSet } from '@/lib/cardParams'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import { CardParamForm } from './CardParamForm'

const dataset = makeDataset()
const give = dataset.commands.find((c) => c.name === 'give')!
const giveSet = give.paramSets![0]!

function renderForm(overrides: Partial<Parameters<typeof CardParamForm>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <I18nProvider lang="zh">
      <CardParamForm
        dataset={dataset}
        command={give}
        set={giveSet}
        template={templateFromSet('give', giveSet)}
        onChange={onChange}
        players={['Alice', 'Bob']}
        {...overrides}
      />
    </I18nProvider>,
  )
  return { onChange }
}

describe('CardParamForm', () => {
  it('只渲染「执行时填」的参数（固定 / 不传的不出现在卡片上）', () => {
    renderForm()
    expect(screen.getByLabelText('item type/id')).toBeTruthy()
    expect(screen.getByLabelText('player')).toBeTruthy()
    // 可选参数默认「不传」：卡片上没有它们的输入框。
    expect(screen.queryByLabelText('item amount')).toBeNull()
    expect(screen.queryByLabelText('prefix id/name')).toBeNull()
  })

  it('输入值回调带参数下标', () => {
    const { onChange } = renderForm()
    fireEvent.change(screen.getByLabelText('item type/id'), { target: { value: '29' } })
    expect(onChange).toHaveBeenCalledWith(0, '29')
  })

  it('玩家参数给在线玩家候选，点一下填入', async () => {
    const { onChange } = renderForm()
    const input = screen.getByLabelText('player')
    fireEvent.focus(input)
    fireEvent.click(await screen.findByRole('option', { name: /Alice/ }))
    expect(onChange).toHaveBeenCalledWith(1, 'Alice')
  })

  it('必填没填时给出「还需要填写」提示', () => {
    renderForm({ missing: [1] })
    expect(screen.getByText('还需要填写：玩家')).toBeTruthy()
  })

  it('没有「执行时填」的参数时不渲染表单', () => {
    const template = templateFromSet('give', giveSet)
    template.args = template.args.map((arg) => ({ ...arg, mode: 'fixed' as const, value: 'x' }))
    const { container } = render(
      <I18nProvider lang="zh">
        <CardParamForm
          dataset={dataset}
          command={give}
          set={giveSet}
          template={template}
          onChange={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(container.querySelector('[data-testid="card-param-form"]')).toBeNull()
  })
})
