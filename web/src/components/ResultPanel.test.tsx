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

  it('点击整个表头折叠 / 展开结果卡片', () => {
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[entry('/time', { status: 'ok', output: ['上午 8:30'] })]}
          running={false}
        />
      </I18nProvider>,
    )
    // 默认展开，输出可见；点表头的指令文本即折叠。
    expect(screen.getByText('上午 8:30')).toBeTruthy()
    fireEvent.click(screen.getByText('/time'))
    expect(screen.queryByText('上午 8:30')).toBeNull()
    fireEvent.click(screen.getByText('/time'))
    expect(screen.getByText('上午 8:30')).toBeTruthy()
  })

  it('按 entry.collapsed 初始渲染为折叠状态', () => {
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[{ ...entry('/time', { status: 'ok', output: ['上午 8:30'] }), collapsed: true }]}
          running={false}
        />
      </I18nProvider>,
    )
    expect(screen.getByText('/time')).toBeTruthy()
    expect(screen.queryByText('上午 8:30')).toBeNull()
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

  it('折叠状态变化时回调（供本机记忆）', () => {
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
    fireEvent.click(screen.getByText('/time'))
    expect(onToggleCollapse).toHaveBeenCalledWith(7, true)
  })

  it('鼠标选中指令文本时点击不折叠（方便复制）', () => {
    const onToggleCollapse = vi.fn()
    const getSelection = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue({ toString: () => '/time' } as unknown as Selection)
    render(
      <I18nProvider lang="zh">
        <ResultPanel
          entries={[entry('/time', { status: 'ok', output: ['上午 8:30'] })]}
          running={false}
          onToggleCollapse={onToggleCollapse}
        />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByText('/time'))
    expect(onToggleCollapse).not.toHaveBeenCalled()
    getSelection.mockRestore()
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
