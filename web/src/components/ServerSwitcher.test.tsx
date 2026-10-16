import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { BUILTIN_ID, type ServerTarget } from '@/lib/servers'
import type { ServerInfo } from '@/lib/tshock'
import { ServerSwitcherDialog } from './ServerSwitcher'

const saved: ServerTarget = {
  id: 'http://1.2.3.4:7878',
  scheme: 'http',
  host: '1.2.3.4',
  port: 7878,
}

const info: ServerInfo = {
  allowCustom: true,
  default: { scheme: 'http', host: '127.0.0.1', port: 7878 },
}

function renderDialog(overrides: Partial<Parameters<typeof ServerSwitcherDialog>[0]> = {}) {
  const handlers = { onSelect: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn(), onOpenChange: vi.fn() }
  render(
    <I18nProvider lang="zh">
      <ServerSwitcherDialog
        open
        servers={[]}
        activeId={BUILTIN_ID}
        info={info}
        {...handlers}
        {...overrides}
      />
    </I18nProvider>,
  )
  return handlers
}

describe('ServerSwitcherDialog', () => {
  it('列出默认上游地址，不出现「服务器默认」文案', () => {
    renderDialog()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('127.0.0.1:7878')).toBeTruthy()
    expect(screen.queryByText('服务器默认')).toBeNull()
  })

  it('新增自定义上游：host 与 port 分开，点击添加回调', () => {
    const { onAdd } = renderDialog()

    fireEvent.change(screen.getByLabelText('IP / 域名'), { target: { value: '1.2.3.4' } })
    fireEvent.change(screen.getByLabelText('端口'), { target: { value: '9999' } })
    fireEvent.click(screen.getByRole('button', { name: /添加/ }))

    expect(onAdd).toHaveBeenCalledWith({
      id: 'http://1.2.3.4:9999',
      scheme: 'http',
      host: '1.2.3.4',
      port: 9999,
    })
  })

  it('非法地址提示错误且不回调', () => {
    const { onAdd } = renderDialog()
    fireEvent.change(screen.getByLabelText('IP / 域名'), { target: { value: 'bad host' } })
    fireEvent.click(screen.getByRole('button', { name: /添加/ }))

    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByText('请填写有效的 IP / 域名与端口')).toBeTruthy()
  })

  it('选择已保存的上游并关闭弹框', () => {
    const { onSelect, onOpenChange } = renderDialog({ servers: [saved], activeId: BUILTIN_ID })
    fireEvent.click(screen.getByRole('button', { name: /1\.2\.3\.4:7878/ }))
    expect(onSelect).toHaveBeenCalledWith(saved.id)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('删除已保存的上游', () => {
    const { onRemove } = renderDialog({ servers: [saved] })
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onRemove).toHaveBeenCalledWith(saved.id)
  })

  it('服务器未开启自定义时隐藏新增表单', () => {
    renderDialog({ info: { allowCustom: false, default: null } })
    expect(screen.queryByLabelText('IP / 域名')).toBeNull()
    expect(screen.getByText('服务器管理员未开启自定义地址。')).toBeTruthy()
  })
})
