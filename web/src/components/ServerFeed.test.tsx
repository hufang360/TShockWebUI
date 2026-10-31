import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import type { BackendTransport } from '@/lib/tshock'
import { playerStubs } from '@/test/playerStubs'
import { makeDataset } from '@/test/fixtures'
import { ServerFeedList, ServerFeedTab, feedRefreshLabel, formatEventTime, formatGameTime } from './ServerFeed'

describe('formatGameTime', () => {
  it('白天从 4:30 起算', () => {
    expect(formatGameTime({ dayTime: true, time: 0 } as never)).toBe('04:30')
    expect(formatGameTime({ dayTime: true, time: 3600 } as never)).toBe('05:30')
  })

  it('夜晚从 19:30 起算', () => {
    expect(formatGameTime({ dayTime: false, time: 0 } as never)).toBe('19:30')
  })

  it('没有数据时返回 null；标签拼接刷新时间与游戏时间', () => {
    expect(formatGameTime(null)).toBeNull()
    const t = (key: string, vars?: Record<string, string | number>) =>
      key === 'home.feedRefreshedAt' ? `R:${vars?.time}` : `G:${vars?.time}`
    expect(feedRefreshLabel(t, 1000, { dayTime: true, time: 0 } as never)).toContain('G:04:30')
    expect(feedRefreshLabel(t, null, null)).toBeNull()
  })

  it('带上世界名（用来区分同一地址下先后开的不同服）', () => {
    const t = (key: string, vars?: Record<string, string | number>) =>
      key === 'home.feedRefreshedAt' ? `R:${vars?.time}` : `G:${vars?.time}`
    const label = feedRefreshLabel(t, 1000, { name: '山丘', dayTime: true, time: 0 } as never)
    expect(label).toMatch(/^山丘 · R:.+ · G:04:30$/)
  })
})

describe('formatEventTime', () => {
  const t = (key: string, vars?: Record<string, string | number>) =>
    key === 'feed.timeMinutesAgo' ? `${vars?.n}m` : key
  const now = new Date(2026, 0, 2, 12, 0, 0).getTime()

  it('刚刚 / N 分钟前 / 当天 / 昨天 / 更早', () => {
    expect(formatEventTime(t, new Date(now - 10_000).toISOString(), now)).toBe('feed.timeJustNow')
    expect(formatEventTime(t, new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m')
    expect(formatEventTime(t, new Date(2026, 0, 2, 9, 30).toISOString(), now)).toBe('09:30')
    expect(formatEventTime(t, new Date(2026, 0, 1, 23, 5).toISOString(), now)).toBe(
      'feed.timeYesterday',
    )
    expect(formatEventTime(t, new Date(2025, 11, 30, 8, 0).toISOString(), now)).toBe('12-30 08:00')
  })

  it('非法时间返回空串', () => {
    expect(formatEventTime(t, '', now)).toBe('')
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ServerFeedList', () => {
  it('渲染聊天事件里的 [i:ID] 为物品图标', () => {
    const dataset = makeDataset()
    render(
      <I18nProvider lang="zh">
        <ServerFeedList
          events={[
            { seq: 1, type: 'chat', text: 'Carol: 出售 [i:29] 和 [i/s5:75]', time: '' },
          ]}
          extra={null}
          itemsById={dataset.itemsById}
          prefixesById={dataset.prefixesById}
          atlas={dataset.atlas}
        />
      </I18nProvider>,
    )
    expect(screen.getByText(/Carol: 出售/)).toBeTruthy()
    expect(screen.getAllByRole('img').length).toBeGreaterThan(0)
  })

  it('未提供物品索引时聊天标签按纯文本输出', () => {
    render(
      <I18nProvider lang="zh">
        <ServerFeedList events={[{ seq: 1, type: 'chat', text: 'Carol: [i:29]', time: '' }]} extra={null} />
      </I18nProvider>,
    )
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/\[i:29\]/)).toBeTruthy()
  })

  it('显示刷新时间与当时的游戏内时间', () => {
    render(
      <I18nProvider lang="zh">
        <ServerFeedList
          events={[{ seq: 1, type: 'join', text: 'Alice 加入了服务器', time: '' }]}
          extra={{ dayTime: true, time: 3600 } as never}
          refreshedAt={new Date(2026, 0, 2, 3, 4, 5).getTime()}
        />
      </I18nProvider>,
    )
    expect(screen.getByText(/刷新于/)).toBeTruthy()
    expect(screen.getByText(/游戏内 05:30/)).toBeTruthy()
  })

  it('上游换了服时短暂提示「已切换服务器」', () => {
    const { rerender } = render(
      <I18nProvider lang="zh">
        <ServerFeedList events={[]} extra={null} switchedAt={null} />
      </I18nProvider>,
    )
    expect(screen.queryByText('已切换服务器')).toBeNull()

    rerender(
      <I18nProvider lang="zh">
        <ServerFeedList events={[]} extra={null} switchedAt={Date.now()} />
      </I18nProvider>,
    )
    expect(screen.getByText('已切换服务器')).toBeTruthy()
  })

  it('换服提示 10 秒后自己消失', () => {
    vi.useFakeTimers()
    render(
      <I18nProvider lang="zh">
        <ServerFeedList events={[]} extra={null} switchedAt={Date.now()} />
      </I18nProvider>,
    )
    expect(screen.getByText('已切换服务器')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.queryByText('已切换服务器')).toBeNull()
  })

  it('事件按时间升序渲染（最旧在上、最新在下），旧记录可懒加载', () => {
    const events = Array.from({ length: 31 }, (_, i) => ({
      seq: i + 1,
      type: 'join',
      text: `玩家${i + 1} 加入了服务器`,
      time: new Date(2026, 0, 1, 0, i).toISOString(),
    }))
    const { container } = render(
      <I18nProvider lang="zh">
        <ServerFeedList events={events} extra={null} />
      </I18nProvider>,
    )
    // 窗口为 30：最旧的第 1 条默认被隐藏，最后一条可见。
    expect(screen.queryByText('玩家1 加入了服务器')).toBeNull()
    expect(screen.getByText('玩家31 加入了服务器')).toBeTruthy()
    const texts = Array.from(container.querySelectorAll('li')).map((li) => li.textContent ?? '')
    const p2 = texts.findIndex((s) => s.includes('玩家2 加入了服务器'))
    const p30 = texts.findIndex((s) => s.includes('玩家30 加入了服务器'))
    expect(p2).toBeGreaterThanOrEqual(0)
    expect(p2).toBeLessThan(p30)

    // 点「加载更早」后第 1 条出现。
    fireEvent.click(screen.getByRole('button', { name: '加载更早的 1 条' }))
    expect(screen.getByText('玩家1 加入了服务器')).toBeTruthy()
  })

  it('跨天时插入日期分隔线', () => {
    // 固定在中午，避免测试在跨午夜时把 26 小时前算成“前天”。
    const now = new Date(2026, 9, 24, 12, 0, 0).getTime()
    vi.useFakeTimers()
    vi.setSystemTime(now)
    try {
      render(
        <I18nProvider lang="zh">
          <ServerFeedList
            events={[
              {
                seq: 1,
                type: 'join',
                text: 'Alice 加入了服务器',
                time: new Date(now - 26 * 3600_000).toISOString(),
              },
              { seq: 2, type: 'join', text: 'Bob 加入了服务器', time: new Date(now).toISOString() },
            ]}
            extra={null}
          />
        </I18nProvider>,
      )
      expect(screen.getByText('今天')).toBeTruthy()
      expect(screen.getByText('昨天')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('插件缺失时显示提示而不是列表', () => {
    render(
      <I18nProvider lang="zh">
        <ServerFeedList events={[]} extra={null} unavailable unavailableText="未安装插件" />
      </I18nProvider>,
    )
    expect(screen.getByText('未安装插件')).toBeTruthy()
  })
})

function makeTransport(overrides: Partial<BackendTransport> = {}): BackendTransport {
  return {
    mock: false,
    label: 'test',
    session: async () => ({ authenticated: true, username: 'hf' }),
    servers: async () => ({ allowCustom: false, default: null }),
    login: async () => ({ username: 'hf' }),
    loginWithToken: async () => ({ username: 'hf' }),
    logout: async () => {},
    serverStatus: async () => ({ reachable: true }),
    playersList: async () => [],
    runCommand: async () => ({ status: 'ok', output: [] }),
    ...playerStubs,
    ...overrides,
  }
}

function renderTab(transport: BackendTransport) {
  return render(
    <I18nProvider lang="zh">
      <ServerFeedTab
        transport={transport}
        authenticated
        serverId="default"
        refreshInterval={60000}
      />
    </I18nProvider>,
  )
}

describe('ServerFeedTab 手动刷新', () => {
  it('刷新按钮在顶栏：左边显示上次刷新时间', async () => {
    const transport = makeTransport({
      serverInfoExtra: async () => ({}) as never,
      eventsTail: async () => ({
        events: [{ seq: 1, type: 'join', text: 'Alice 加入了服务器', time: '' }],
        lastSeq: 1,
      }),
    } as never)
    renderTab(transport)

    expect(await screen.findByText('Alice 加入了服务器')).toBeTruthy()
    // 与首页 / 鱼店等模块同规：刷新按钮在顶栏，时间文案在它左边。
    const label = await screen.findByText(/^上次刷新 /)
    expect(label.className).toContain('text-2xs')
    expect(screen.getByRole('button', { name: /刷新服务器动态/ })).toBeTruthy()
  })

  it('刷新时按钮转圈并禁用，跑完恢复；期间会真的重新拉取', async () => {
    let resolveTail: (() => void) | null = null
    let calls = 0
    const eventsTail = vi.fn(async () => {
      calls += 1
      if (calls > 1) {
        // 第二次（手动刷新）先挂住，好观察转圈状态。
        await new Promise<void>((resolve) => {
          resolveTail = resolve
        })
      }
      return { events: [{ seq: 1, type: 'join', text: 'Alice 加入了服务器', time: '' }], lastSeq: 1 }
    })
    const transport = makeTransport({
      serverInfoExtra: async () => ({}) as never,
      eventsTail,
    } as never)
    renderTab(transport)

    expect(await screen.findByText('Alice 加入了服务器')).toBeTruthy()
    const button = screen.getByRole('button', { name: /刷新服务器动态/ })
    expect(button.hasAttribute('disabled')).toBe(false)

    fireEvent.click(button)
    // 转圈中：禁用 + 转圈图标，并且确实发起了第二次拉取。
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true))
    expect(eventsTail).toHaveBeenCalledTimes(2)
    expect(button.querySelector('.animate-spin')).toBeTruthy()

    act(() => resolveTail?.())
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
    // 事件没被清空
    expect(screen.getByText('Alice 加入了服务器')).toBeTruthy()
  })
})

describe('ServerFeedTab 类型筛选', () => {
  it('「进服」筛选仍同时显示进服和退服事件（只是改了文字）', async () => {
    const transport = makeTransport({
      events: async () => ({
        events: [
          { seq: 1, type: 'join', text: 'Alice 加入了服务器', time: new Date().toISOString() },
          { seq: 2, type: 'chat', text: 'Bob: 你好', time: new Date().toISOString() },
          { seq: 3, type: 'leave', text: 'Carol 离开了服务器', time: new Date().toISOString() },
        ],
        lastSeq: 3,
      }),
    })
    renderTab(transport)

    expect(await screen.findByText('Alice 加入了服务器')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '进服' }))
    expect(screen.getByText('Alice 加入了服务器')).toBeTruthy()
    expect(screen.getByText('Carol 离开了服务器')).toBeTruthy()
    expect(screen.queryByText('Bob: 你好')).toBeNull()
  })

  it('点「聊天」后只显示聊天事件', async () => {
    const transport = makeTransport({
      events: async () => ({
        events: [
          { seq: 1, type: 'join', text: 'Alice 加入了服务器', time: new Date().toISOString() },
          { seq: 2, type: 'chat', text: 'Bob: 你好', time: new Date().toISOString() },
        ],
        lastSeq: 2,
      }),
    })
    renderTab(transport)

    expect(await screen.findByText('Alice 加入了服务器')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '聊天' }))
    expect(screen.queryByText('Alice 加入了服务器')).toBeNull()
    expect(screen.getByText('Bob: 你好')).toBeTruthy()
  })

  it('「事件」筛选只显示世界公告', async () => {
    const transport = makeTransport({
      events: async () => ({
        events: [
          { seq: 1, type: 'join', text: 'Alice 加入了服务器', time: new Date().toISOString() },
          { seq: 2, type: 'announce', text: '光之女皇已苏醒！', time: new Date().toISOString() },
        ],
        lastSeq: 2,
      }),
    })
    renderTab(transport)

    expect(await screen.findByText('Alice 加入了服务器')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '事件' }))
    expect(screen.queryByText('Alice 加入了服务器')).toBeNull()
    expect(screen.getByText('光之女皇已苏醒！')).toBeTruthy()
  })
})

describe('ServerFeedList 新事件贴底', () => {
  const events = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      seq: i + 1,
      type: 'chat' as const,
      text: `msg ${i + 1}`,
      time: new Date(2026, 0, 2, 12, i).toISOString(),
    }))

  /** 给 jsdom 的滚动容器一套「可滚动」尺寸。 */
  function makeScrollable(el: HTMLElement) {
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true })
  }

  it('followNewest：刷新出新事件后停在最新一条（即使之前翻到了上面）', async () => {
    const list = (list_events: ReturnType<typeof events>) => (
      <I18nProvider lang="zh">
        <ServerFeedList events={list_events} extra={null} followNewest />
      </I18nProvider>
    )
    const { rerender } = render(list(events(5)))
    const ul = screen.getByText('msg 5').closest('ul') as HTMLElement
    makeScrollable(ul)
    // 用户翻到最上面看旧消息
    ul.scrollTop = 0
    fireEvent.scroll(ul)

    rerender(list(events(7)))
    await waitFor(() => expect(ul.scrollTop).toBe(1000))
    expect(screen.getByText('msg 7')).toBeTruthy()
  })

  it('不传 followNewest（首页卡片）：翻旧记录时新事件不把视图拉走', async () => {
    const list = (list_events: ReturnType<typeof events>) => (
      <I18nProvider lang="zh">
        <ServerFeedList events={list_events} extra={null} />
      </I18nProvider>
    )
    const { rerender } = render(list(events(5)))
    const ul = screen.getByText('msg 5').closest('ul') as HTMLElement
    makeScrollable(ul)
    ul.scrollTop = 0
    fireEvent.scroll(ul)

    rerender(list(events(7)))
    expect(ul.scrollTop).toBe(0)
  })
})

describe('ServerFeedList 页面级滚动（聊天页）', () => {
  const events = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      seq: i + 1,
      type: 'chat' as const,
      text: `msg ${i + 1}`,
      time: new Date(2026, 0, 2, 12, i).toISOString(),
    }))

  /** 给 jsdom 的滚动容器一套「可滚动」尺寸。 */
  function makeScrollable(el: HTMLElement) {
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true })
  }

  /** AppShell 里真正在滚的是 `<main>`：用它包住列表。 */
  const list = (list_events: ReturnType<typeof events>, slot?: HTMLElement) => (
    <I18nProvider lang="zh">
      <main data-testid="main">
        <ServerFeedList
          events={list_events}
          extra={null}
          followNewest
          pageScroll
          jumpSlot={slot ?? null}
        />
      </main>
    </I18nProvider>
  )

  it('列表自己不再滚动，贴底跟随时滚的是 <main>', async () => {
    const { rerender } = render(list(events(5)))
    const main = screen.getByTestId('main')
    const ul = screen.getByText('msg 5').closest('ul') as HTMLElement
    makeScrollable(ul)
    makeScrollable(main)
    // 列表不是滚动容器（没有 overflow-y-auto）
    expect(ul.className).not.toContain('overflow-y-auto')

    // 贴底状态下来新事件 → 页面滚到底
    rerender(list(events(7)))
    await waitFor(() => expect(main.scrollTop).toBe(1000))
  })

  it('用户往上翻看时「回到底部」按钮投到宿主里，点它把页面滚到底', async () => {
    const slot = document.createElement('div')
    document.body.appendChild(slot)
    const { rerender } = render(
      <I18nProvider lang="zh">
        <main data-testid="main">
          <ServerFeedList events={events(5)} extra={null} pageScroll jumpSlot={slot} />
        </main>
      </I18nProvider>,
    )
    const main = screen.getByTestId('main')
    makeScrollable(main)
    // 用户向上翻：离底部很远
    main.scrollTop = 0
    fireEvent.scroll(main)

    // 不跟随的首页式行为：新事件不把页面拉走
    rerender(
      <I18nProvider lang="zh">
        <main data-testid="main">
          <ServerFeedList events={events(7)} extra={null} pageScroll jumpSlot={slot} />
        </main>
      </I18nProvider>,
    )
    expect(main.scrollTop).toBe(0)
    // 浮按钮进到吸底区域的宿主里（页面上才看得到）
    const jump = await screen.findByRole('button', { name: /最新/ })
    expect(slot.contains(jump)).toBe(true)
    fireEvent.click(jump)
    expect(main.scrollTop).toBe(1000)
    slot.remove()
  })
})
