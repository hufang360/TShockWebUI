import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { ConfirmButton } from './ConfirmButton'

function renderButton(onConfirm = vi.fn()) {
  render(
    <I18nProvider lang="zh">
      <ConfirmButton onConfirm={onConfirm} confirmLabel="确认清空">
        清空结果
      </ConfirmButton>
    </I18nProvider>,
  )
  return onConfirm
}

describe('ConfirmButton', () => {
  it('首次点击只进入确认态，不执行', () => {
    const onConfirm = renderButton()
    fireEvent.click(screen.getByRole('button', { name: '清空结果' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '确认清空' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '清空结果' })).toBeNull()
  })

  it('点确认才执行一次并回到初始态', () => {
    const onConfirm = renderButton()
    fireEvent.click(screen.getByRole('button', { name: '清空结果' }))
    fireEvent.click(screen.getByRole('button', { name: '确认清空' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '清空结果' })).toBeTruthy()
  })

  it('点取消回到初始态且不执行', () => {
    const onConfirm = renderButton()
    fireEvent.click(screen.getByRole('button', { name: '清空结果' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '清空结果' })).toBeTruthy()
  })
})
