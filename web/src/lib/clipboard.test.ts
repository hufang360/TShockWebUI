import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

const originalExecCommand = document.execCommand

function stubClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
}

/** `execCommand` 桩：记录被复制的 textarea 值（模拟浏览器行为）。 */
function stubExecCommand(result = true) {
  const seen: string[] = []
  document.execCommand = ((command: string) => {
    if (command === 'copy') {
      const area = document.querySelector('textarea')
      if (area) seen.push((area as HTMLTextAreaElement).value)
    }
    return result
  }) as typeof document.execCommand
  return seen
}

afterEach(() => {
  document.execCommand = originalExecCommand
  delete (navigator as { clipboard?: unknown }).clipboard
})

describe('copyText', () => {
  it('有 Clipboard API 时优先用它', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    await expect(copyText('[i:29]')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('[i:29]')
  })

  it('http（无 Clipboard API）时退回 execCommand，并且不残留 textarea', async () => {
    const seen = stubExecCommand()
    await expect(copyText('/time day')).resolves.toBe(true)
    expect(seen).toEqual(['/time day'])
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('Clipboard API 被拒绝时再试兜底', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    const seen = stubExecCommand()
    await expect(copyText('abc')).resolves.toBe(true)
    expect(seen).toEqual(['abc'])
  })

  it('两条路径都不可用时返回 false，且不抛错（同步也不抛）', async () => {
    // jsdom 默认没有 navigator.clipboard，也不实现 execCommand。
    await expect(copyText('abc')).resolves.toBe(false)
  })

  it('execCommand 返回 false 时如实返回失败', async () => {
    stubExecCommand(false)
    await expect(copyText('abc')).resolves.toBe(false)
  })
})
