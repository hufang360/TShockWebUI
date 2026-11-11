import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { DatasetProvider } from '@/lib/datasetContext'
import { makeDataset } from '@/test/fixtures'
import { ItemDetailDialog } from './ItemDetailDialog'
import type { DetailEntry } from '@/lib/itemDetailContext'
import type { Dataset } from '@/types'

/** 一条合成记录：生命水晶（29）← 坠落之星（75），用来在弹框里点材料验证「叠一层」。 */
function datasetWithRecipe(): Dataset {
  return makeDataset({
    recipes: {
      meta: {
        gameVersion: '1.4.5.8',
        count: 1,
        groupCount: 0,
        source: 'test',
        generatedBy: 'test',
      },
      groups: {},
      recipes: [
        {
          result: { id: 29, stack: 1 },
          ingredients: [{ id: 75, stack: 1 }],
          station: -1,
          stationItems: [],
          env: [],
          flags: [],
        },
      ],
      byResult: { '29': [0] },
      byIngredient: { '75': [0] },
    },
  })
}

function renderDialog({
  dataset = datasetWithRecipe(),
  stack = [{ id: 29 }] as DetailEntry[],
  onPush = vi.fn(),
  onBack = vi.fn(),
  onClose = vi.fn(),
}: {
  dataset?: Dataset
  stack?: DetailEntry[]
  onPush?: (entry: DetailEntry) => void
  onBack?: () => void
  onClose?: () => void
} = {}) {
  render(
    <I18nProvider lang="zh">
      <DatasetProvider value={dataset}>
        <ItemDetailDialog
          dataset={dataset}
          stack={stack}
          username="Alice"
          authenticated
          onPush={onPush}
          onBack={onBack}
          onClose={onClose}
        />
      </DatasetProvider>
    </I18nProvider>,
  )
  return { onPush, onBack, onClose }
}

describe('ItemDetailDialog', () => {
  it('以弹框显示物品详情：tips + 底部操作区', () => {
    renderDialog()
    const dialog = screen.getByTestId('dex-detail-dialog')

    // 图鉴详情里那份 tips（不是悬停提示），名称在
    expect(within(dialog).getByTestId('item-tooltip').textContent).toContain('生命水晶')
    // 底部固定操作区：Wiki / 复制名称 / 复制 ID
    const actions = within(dialog).getByTestId('dex-detail-actions')
    expect(within(actions).getByRole('button', { name: '复制ID' })).toBeTruthy()
    expect(within(actions).getByRole('link', { name: '前往 Wiki' })).toBeTruthy()
    // 根层没有「返回」
    expect(within(dialog).queryByTestId('dex-detail-back')).toBeNull()
  })

  it('打开时焦点落在主操作「复制ID」上（不是 × 或 Wiki）', async () => {
    renderDialog()
    const dialog = screen.getByTestId('dex-detail-dialog')
    const copyId = within(dialog).getByRole('button', { name: '复制ID' })
    await waitFor(() => expect(document.activeElement).toBe(copyId))
  })

  it('右上角 × 关掉整个弹框', () => {
    const { onClose } = renderDialog()
    const dialog = screen.getByTestId('dex-detail-dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('叠层时（depth > 0）左上角有「返回」', () => {
    const { onBack } = renderDialog({ stack: [{ id: 29 }, { id: 75 }] })
    const dialog = screen.getByTestId('dex-detail-dialog')
    expect(within(dialog).getByTestId('item-tooltip').textContent).toContain('坠落之星')

    fireEvent.click(within(dialog).getByTestId('dex-detail-back'))
    expect(onBack).toHaveBeenCalled()
  })

  it('弹框里点配方材料的「物品详情」→ 叠一层（由外层 push），不跳页', async () => {
    const { onPush } = renderDialog()
    const dialog = screen.getByTestId('dex-detail-dialog')

    // 合成表第一行的材料图标 → 悬停出提示 → 点提示右上角 ⓘ
    const row = within(dialog).getAllByTestId('recipe-row')[0]
    fireEvent.mouseOver(within(row).getByRole('img', { name: '坠落之星' }))
    const tip = await screen.findByRole('tooltip')
    fireEvent.click(within(tip).getByRole('button', { name: '物品详情' }))

    expect(onPush).toHaveBeenCalledWith({ id: 75, prefixId: undefined, stack: undefined })
    // 不叠第二个弹框（同一个 Dialog 换内容）
    expect(screen.getAllByTestId('dex-detail-dialog')).toHaveLength(1)
  })
})
