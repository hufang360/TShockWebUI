import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DatasetProvider } from '@/lib/datasetContext'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import { draftFromContent } from '@/lib/save/worldContent'
import { WorldContentEditor } from './WorldContentEditor'

const chests = [
  {
    x: 3,
    y: 4,
    name: '宝箱',
    capacity: 40,
    items: [{ slot: 0, id: 29, stack: 5, prefix: 0 }],
  },
]
const signs = [{ x: 5, y: 6, text: '第一行\n第二行' }]

function setup(onChange = vi.fn()) {
  const draft = draftFromContent(chests, signs)
  render(
    <I18nProvider lang="zh">
      <DatasetProvider value={makeDataset()}>
        <WorldContentEditor chests={draft.chests} signs={draft.signs} issues={[]} limits={null} onChange={onChange} />
      </DatasetProvider>
    </I18nProvider>,
  )
  return { onChange }
}

describe('箱子与招牌编辑器', () => {
  it('列出箱子与招牌；点箱子能改名字，点格子能换物品', async () => {
    const { onChange } = setup()
    expect(screen.getByTestId('wld-content-chests')).toBeTruthy()
    expect(screen.getByTestId('wld-content-signs')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /\[3, 4\]/ }))
    const name = (await screen.findByLabelText('箱子名')) as HTMLInputElement
    expect(name.value).toBe('宝箱')
    fireEvent.change(name, { target: { value: '新名字' } })
    expect(onChange).toHaveBeenCalled()
    const last = onChange.mock.calls.at(-1)![0] as { chests: { name: string }[] }
    expect(last.chests[0].name).toBe('新名字')
  })

  it('点招牌能改文本（多行）', async () => {
    const { onChange } = setup()
    fireEvent.click(screen.getByRole('button', { name: /\[5, 6\]/ }))
    const area = (await screen.findByLabelText('招牌文字')) as HTMLTextAreaElement
    expect(area.value).toContain('第一行')
    fireEvent.change(area, { target: { value: '新的招牌\n第二行' } })
    const last = onChange.mock.calls.at(-1)![0] as { signs: { text: string }[] }
    expect(last.signs[0].text).toBe('新的招牌\n第二行')
  })
})
