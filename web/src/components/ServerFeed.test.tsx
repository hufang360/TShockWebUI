import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import { ServerFeedList, feedRefreshLabel, formatGameTime } from './ServerFeed'

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

  it('插件缺失时显示提示而不是列表', () => {
    render(
      <I18nProvider lang="zh">
        <ServerFeedList events={[]} extra={null} unavailable unavailableText="未安装插件" />
      </I18nProvider>,
    )
    expect(screen.getByText('未安装插件')).toBeTruthy()
  })
})
