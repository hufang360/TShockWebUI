import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import { SendPreview } from './SendPreview'

const dataset = makeDataset()

function renderPreview(props: Partial<Parameters<typeof SendPreview>[0]> = {}) {
  return render(
    <I18nProvider lang="zh">
      <SendPreview
        dataset={dataset}
        text="/give [i:29] hf 2"
        mode="command"
        username="hf"
        chatPrefix="[WebUI]"
        {...props}
      />
    </I18nProvider>,
  )
}

describe('SendPreview（发送内容预览）', () => {
  it('指令：标签渲染成物品图标，其余文字原样保留', () => {
    renderPreview()
    const preview = screen.getByTestId('send-preview')
    expect(preview.textContent).toContain('/give')
    expect(preview.textContent).toContain('hf 2')
    // `[i:29]` 变成图标，而不是继续显示标签原文。
    expect(preview.textContent).not.toContain('[i:29]')
    expect(preview.querySelector('img, canvas, svg')).toBeTruthy()
  })

  it('指令里没有标签就不显示（预览会和输入框一模一样，纯噪声）', () => {
    const { container } = renderPreview({ text: '/time 12:00' })
    expect(container.querySelector('[data-testid=send-preview]')).toBeNull()
  })

  it('聊天：显示 `[WebUI] 玩家名: 内容`，内容里的标签也渲染成图标', () => {
    renderPreview({ text: '你好 [i:29]', mode: 'chat' })
    const preview = screen.getByTestId('send-preview')
    expect(preview.textContent).toContain('[WebUI]')
    expect(preview.textContent).toContain('hf:')
    expect(preview.textContent).toContain('你好')
    expect(preview.textContent).not.toContain('[i:29]')
  })

  it('聊天用插件实际前缀（不是写死 [WebUI]）', () => {
    renderPreview({ text: 'hi', mode: 'chat', chatPrefix: '[网页]' })
    expect(screen.getByTestId('send-preview').textContent).toContain('[网页]')
  })

  it('空输入不渲染', () => {
    const { container } = renderPreview({ text: '   ', mode: 'chat' })
    expect(container.querySelector('[data-testid=send-preview]')).toBeNull()
  })
})
