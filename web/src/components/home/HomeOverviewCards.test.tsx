import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { consumeEditorView } from '@/lib/editorView'
import { makeDataset } from '@/test/fixtures'
import { EventsCard } from './HomeOverviewCards'

const events = [
  { seq: 1, type: 'join' as const, text: 'Alice 加入了服务器', time: new Date().toISOString() },
]

function renderCard(onNavigate = vi.fn()) {
  render(
    <I18nProvider lang="zh">
      <EventsCard
        events={events}
        extra={null}
        refreshedAt={Date.now()}
        switchedAt={null}
        eventsPlugin
        dataset={makeDataset()}
        onRefresh={vi.fn()}
        onNavigate={onNavigate}
      />
    </I18nProvider>,
  )
  return { onNavigate }
}

afterEach(() => {
  consumeEditorView()
  vi.restoreAllMocks()
})

describe('EventsCard 的「查看全部」箭头', () => {
  it('宽屏：跳到「指令」页，不额外切 tab（两栏同屏，聊天就在右边）', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    const { onNavigate } = renderCard()
    fireEvent.click(screen.getByRole('button', { name: '查看全部' }))
    expect(onNavigate).toHaveBeenCalledWith('editor')
    expect(consumeEditorView()).toBeNull()
  })

  it('手机：跳到「指令」页，并要求切到聊天那一块', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    const { onNavigate } = renderCard()
    fireEvent.click(screen.getByRole('button', { name: '查看全部' }))
    expect(onNavigate).toHaveBeenCalledWith('editor')
    expect(consumeEditorView()).toBe('chat')
  })
})
