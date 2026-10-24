import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { TshockRequestError, type BackendTransport } from '@/lib/tshock'
import { WebChatInput } from './WebChatInput'

function makeTransport(overrides: Partial<BackendTransport> = {}): BackendTransport {
  return { sendChat: vi.fn(), ...overrides } as unknown as BackendTransport
}

function renderInput(transport: BackendTransport, overrides: { disabled?: boolean; pluginInstalled?: boolean } = {}) {
  return render(
    <I18nProvider lang="zh">
      <WebChatInput transport={transport} {...overrides} />
    </I18nProvider>,
  )
}

describe('WebChatInput', () => {
  it('输入并发送后调用 sendChat，并提示已发送', async () => {
    const sendChat = vi.fn(async (text: string) => ({ name: 'hf', text, line: `[WebUI] hf: ${text}` }))
    renderInput(makeTransport({ sendChat }))

    const input = screen.getByPlaceholderText('发消息给游戏内的玩家（会显示你是谁）')
    fireEvent.change(input, { target: { value: '大家好啊' } })
    fireEvent.click(screen.getByRole('button', { name: '发送发言' }))

    await waitFor(() => expect(sendChat).toHaveBeenCalledWith('大家好啊'))
    expect(await screen.findByText(/已发送/)).toBeTruthy()
  })

  it('禁用时展示明确占位文案', () => {
    renderInput(makeTransport(), { disabled: true })
    const input = screen.getByPlaceholderText('未安装信使插件，无法发言')
    expect(input).toHaveProperty('disabled', true)
  })

  it('事件流可用但发言端点 404 时，提示插件版本过旧', async () => {
    const sendChat = vi.fn(async () => {
      throw new TshockRequestError('plugin_missing', '未安装')
    })
    renderInput(makeTransport({ sendChat }), { pluginInstalled: true })

    fireEvent.change(screen.getByPlaceholderText('发消息给游戏内的玩家（会显示你是谁）'), {
      target: { value: 'hello' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送发言' }))

    expect(await screen.findByText('服务器信使插件版本过旧，升级后可用网页发言')).toBeTruthy()
  })

  it('发言失败时保留输入，可就地重试', async () => {
    let calls = 0
    const sendChat = vi.fn(async (text: string) => {
      calls += 1
      if (calls === 1) throw new Error('网络错误')
      return { name: 'hf', text, line: `[WebUI] hf: ${text}` }
    })
    renderInput(makeTransport({ sendChat }))

    const input = screen.getByPlaceholderText('发消息给游戏内的玩家（会显示你是谁）') as HTMLInputElement
    fireEvent.change(input, { target: { value: '你好' } })
    fireEvent.click(screen.getByRole('button', { name: '发送发言' }))

    expect(await screen.findByText('网络错误')).toBeTruthy()
    expect(input.value).toBe('你好')

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/已发送/)).toBeTruthy()
    expect(input.value).toBe('')
  })
})
