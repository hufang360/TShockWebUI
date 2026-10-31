import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { toast } from 'sonner'
import { Toaster } from './Sonner'

afterEach(() => {
  toast.dismiss()
})

/** 取当前渲染出来的提示条（sonner 用 `<li data-sonner-toast>`）。 */
const toasts = () => document.querySelectorAll('[data-sonner-toast]')

/** sonner 的提示是全局单例、退场还有动画：计数类用例先清空，避免串到上一条用例。 */
async function clearToasts() {
  act(() => {
    toast.dismiss()
  })
  await waitFor(() => expect(toasts().length).toBe(0))
}

describe('Toaster（sonner）', () => {
  it('挂载出 sonner 容器，主题跟 props 走', async () => {
    render(<Toaster theme="dark" closeButton />)
    // sonner 的 `<ol data-sonner-toaster>` 只在至少有一条提示时才挂载。
    act(() => {
      toast.success('已发送')
    })
    const container = await waitFor(() => {
      const el = document.querySelector('[data-sonner-toaster]')
      if (!el) throw new Error('toaster 还没挂载')
      return el as HTMLElement
    })
    expect(container.getAttribute('data-sonner-theme')).toBe('dark')
  })

  it('多条提示堆叠，每条都有关闭按钮', async () => {
    render(<Toaster closeButton />)
    await clearToasts()

    act(() => {
      toast.success('已发送（显示为 [WebUI] hf）')
      toast.success('已发送（显示为 [WebUI] hf）')
    })

    await waitFor(() => expect(toasts().length).toBe(2))
    expect(document.querySelectorAll('[data-close-button]').length).toBe(2)
  })

  it('到时间自动关闭', async () => {
    render(<Toaster duration={1000} />)
    await clearToasts()
    act(() => {
      toast.success('已发送')
    })
    await waitFor(() => expect(toasts().length).toBe(1))

    // 真实定时器：sonner 到 duration 后自动销毁（含退场动画）。
    await waitFor(() => expect(toasts().length).toBe(0), { timeout: 5000 })
  })

  it('closeButtonAriaLabel 用界面语言', async () => {
    render(<Toaster closeButton toastOptions={{ closeButtonAriaLabel: '关闭' }} />)
    act(() => {
      toast.success('已发送')
    })
    expect(await screen.findByRole('button', { name: '关闭' })).toBeTruthy()
  })
})
