import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { formatClock } from '@/lib/clock'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import { ResultPanel, type ResultEntry } from './ResultPanel'

const entry = (command: string, result: ResultEntry['result'], seq = 1): ResultEntry => ({
  seq,
  ts: Date.now(),
  command,
  result,
})

describe('ResultPanel', () => {
  it('把输出里的 [i:ID] 渲染成物品图标，其余保持文本', () => {
    const dataset = makeDataset()
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[entry('/give 29', { status: 'ok', output: ['获得 [i:29] 生命水晶'] })]}
          running={false}
          itemsById={dataset.itemsById}
          atlas={dataset.atlas}
        />
      </I18nProvider>,
    )
    expect(screen.getByRole('img', { name: '生命水晶' })).toBeTruthy()
    expect(screen.getByText(/获得/)).toBeTruthy()
  })

  it('未提供物品索引时按纯文本输出', () => {
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[entry('/give 29', { status: 'ok', output: ['获得 [i:29] 生命水晶'] })]}
          running={false}
        />
      </I18nProvider>,
    )
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/\[i:29\]/)).toBeTruthy()
  })

  it('富文本区域提供复制按钮，点击复制原始文本', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[entry('/time', { status: 'ok', output: ['第一行', '第二行'] })]}
          running={false}
        />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    expect(writeText).toHaveBeenCalledWith('第一行\n第二行')
  })

  it('把输出里的 [c/RRGGBB:..] 颜色标签渲染成彩色文本', () => {
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[
            entry('/playing', {
              status: 'ok',
              output: ['在线的玩家([c/AAFFAA:1]/8)', 'hf'],
            }),
          ]}
          running={false}
        />
      </I18nProvider>,
    )
    const colored = screen.getByText('1')
    expect(colored.tagName).toBe('SPAN')
    // 颜色通过 CSS 变量 + .ts-chat-color 提供（浅色主题下由 CSS 压暗保证对比度）
    expect(colored.style.getPropertyValue('--ts-color').toUpperCase()).toBe('#AAFFAA')
    expect(colored.className).toContain('ts-chat-color')
    // 标签外壳不应残留
    expect(screen.queryByText(/\[c\//)).toBeNull()
    // 其他行正常显示
    expect(screen.getByText('hf')).toBeTruthy()
  })

  it('默认只渲染最近 5 条，点「加载更早」展开旧结果', () => {
    const entries = Array.from({ length: 6 }, (_, i) =>
      entry(`/cmd ${i + 1}`, { status: 'ok', output: [`输出${i + 1}`] }, i + 1),
    )
    render(
      <I18nProvider lang="zh">
        <ResultPanel entries={entries} running={false} />
      </I18nProvider>,
    )
    // 最旧的第 1 条默认在窗口外，最新一条可见。
    expect(screen.queryByText('/cmd 1')).toBeNull()
    expect(screen.getByText('/cmd 6')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载更早的 1 条' }))
    expect(screen.getByText('/cmd 1')).toBeTruthy()
  })

  it('多次执行追加展示，不覆盖上一次结果', () => {
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[
            entry('/time', { status: 'ok', output: ['上午 8:30'] }, 1),
            entry('/who', { status: 'ok', output: ['在线玩家 (1): hf'] }, 2),
          ]}
          running={false}
        />
      </I18nProvider>,
    )
    expect(screen.getByText('/time')).toBeTruthy()
    expect(screen.getByText('/who')).toBeTruthy()
    expect(screen.getByText('上午 8:30')).toBeTruthy()
    expect(screen.getByText('在线玩家 (1): hf')).toBeTruthy()
  })

  it('每条结果是 Card；表头本身不折叠（点指令文字不会收起），折叠靠右上角的箭头按钮', () => {
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[entry('/time', { status: 'ok', output: ['上午 8:30'] })]}
          running={false}
        />
      </I18nProvider>,
    )
    const title = screen.getByText('/time')
    expect(title.closest('[data-slot="card"]')).toBeTruthy()
    expect(title.className).toContain('select-text')
    fireEvent.click(title)
    expect(screen.getByText('上午 8:30')).toBeTruthy()

    // 箭头按钮：展开态叫「折叠」，点一下只剩标题行，再点回来。
    const collapse = screen.getByRole('button', { name: '折叠' })
    expect(collapse.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(collapse)
    expect(screen.queryByText('上午 8:30')).toBeNull()
    const expand = screen.getByRole('button', { name: '展开' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(expand)
    expect(screen.getByText('上午 8:30')).toBeTruthy()
  })

  it('折叠时箭头常显（不用先 hover 才能展开回来），展开时跟其它操作一起淡入', () => {
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[{ ...entry('/time', { status: 'ok', output: ['上午 8:30'] }), collapsed: true }]}
          running={false}
        />
      </I18nProvider>,
    )
    expect(screen.queryByText('上午 8:30')).toBeNull()
    const expand = screen.getByRole('button', { name: '展开' })
    expect(expand.className).not.toContain('opacity-0')
  })

  it('折叠状态变化时回调（供本机持久化）', () => {
    const onToggleCollapse = vi.fn()
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[entry('/time', { status: 'ok', output: ['上午 8:30'] }, 7)]}
          running={false}
          onToggleCollapse={onToggleCollapse}
        />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '折叠' }))
    expect(onToggleCollapse).toHaveBeenCalledWith(7, true)
  })

  it('右上角「填充指令」：把指令交给回调（只填不执行）', () => {
    const onFillCommand = vi.fn()
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[entry('/time 12:00', { status: 'ok', output: ['上午 8:30'] })]}
          running={false}
          onFillCommand={onFillCommand}
        />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '填充指令' }))
    expect(onFillCommand).toHaveBeenCalledWith('/time 12:00')
  })

  it('右上角三个图标都带 Tooltip（填充指令 / 收藏 / 删除）', async () => {
    // 文案就是动作本身（不带「这条结果」这类补语）。
    for (const label of ['填充指令', '收藏', '删除']) {
      const { unmount } = render(
        <I18nProvider lang="zh">
          <ResultPanel
            entries={[entry('/time', { status: 'ok', output: ['上午 8:30'] })]}
            running={false}
            onRemove={vi.fn()}
            isFavorite={() => false}
            onToggleFavorite={vi.fn()}
            onFillCommand={vi.fn()}
          />
        </I18nProvider>,
      )
      const button = screen.getByRole('button', { name: label })
      fireEvent.pointerMove(button, { pointerType: 'mouse' })
      fireEvent.pointerEnter(button, { pointerType: 'mouse' })
      expect((await screen.findByRole('tooltip')).textContent).toContain(label)
      unmount()
    }
  })

  it('执行时间默认隐藏：和收藏 / 删除图标一样，hover 或聚焦卡片才出现', () => {
    const ts = new Date('2026-10-29T03:05:00Z').getTime()
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[{ seq: 1, ts, command: '/time', result: { status: 'ok', output: ['上午 8:30'] } }]}
          running={false}
        />
      </I18nProvider>,
    )
    const time = screen.getByText(formatClock('zh', ts))
    expect(time.className).toContain('opacity-0')
    expect(time.className).toContain('group-hover/result:opacity-100')
    expect(time.className).toContain('group-focus-within/result:opacity-100')
    // 触屏没有 hover：保持常显，否则永远看不到时间。
    expect(time.className).toContain('touch-visible')
  })

  it('鼠标选中指令文本不影响任何操作（文字可复制）', () => {    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[entry('/time', { status: 'ok', output: ['上午 8:30'] })]}
          running={false}
        />
      </I18nProvider>,
    )
    expect(screen.getByText('/time').className).toContain('select-text')
  })

  it('物品标签 stack>1 时在图标右下角显示数量', () => {
    const dataset = makeDataset()
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[entry('/give 29 5', { status: 'ok', output: ['获得 [i/s5:29] 生命水晶'] })]}
          running={false}
          itemsById={dataset.itemsById}
          atlas={dataset.atlas}
        />
      </I18nProvider>,
    )
    expect(screen.getByRole('img', { name: '生命水晶' })).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
  })

  it('悬停物品图标显示图标 / 词缀 / 名称 / 数量提示', async () => {
    const dataset = makeDataset()
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[
            entry('/give 29 5', {
              status: 'ok',
              output: ['获得 [i/p81/s5:29] 生命水晶'],
            }),
          ]}
          running={false}
          itemsById={dataset.itemsById}
          prefixesById={dataset.prefixesById}
          atlas={dataset.atlas}
        />
      </I18nProvider>,
    )
    fireEvent.mouseOver(screen.getByRole('img', { name: '生命水晶' }))
    // 提示有弹出延迟（避免太容易触发），等待其出现。
    const tip = await screen.findByRole('tooltip')
    expect(within(tip).getByText('传奇')).toBeTruthy()
    expect(within(tip).getByText('生命水晶')).toBeTruthy()
    expect(within(tip).getByText('x5')).toBeTruthy()
  })
})
