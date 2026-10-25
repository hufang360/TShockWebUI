import { readFileSync } from 'node:fs'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasetProvider } from '@/lib/datasetContext'
import { I18nProvider } from '@/lib/i18n'
import type { BackendTransport } from '@/lib/tshock'
import { makeDataset } from '@/test/fixtures'
import { playerStubs } from '@/test/playerStubs'
import { PlrPage } from './PlrPage'

function makeTransport(over: Partial<BackendTransport> = {}): BackendTransport {
  return {
    mock: false,
    label: 'test',
    session: async () => ({ authenticated: false, username: null }),
    servers: async () => ({ allowCustom: false, default: null }),
    login: async () => ({ username: 'Alice' }),
    loginWithToken: async () => ({ username: 'Alice' }),
    logout: async () => {},
    serverStatus: async () => ({ reachable: true }),
    playersList: async () => [],
    runCommand: async () => ({ status: 'ok', output: [] }),
    ...playerStubs,
    ...over,
  }
}

function renderPage(transport: BackendTransport) {
  return render(
    <I18nProvider lang="zh">
      <DatasetProvider value={makeDataset()}>
        <PlrPage serverId="default" transport={transport} />
      </DatasetProvider>
    </I18nProvider>,
  )
}

/** 真实 .plr（1.4.5.8 新角色，启动器生成）：解密与解析都在浏览器里做。 */
function plrFile(name = 'x.plr'): File {
  const bytes = readFileSync('src/lib/save/fixtures/webui-326.plr')
  return new File([new Uint8Array(bytes).slice().buffer as ArrayBuffer], name)
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { writable: true, value: vi.fn(() => 'blob:mock') })
  Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: vi.fn() })
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PlrPage（查看存档）', () => {
  it('不需要登录、也不经过服务器：本地解析 .plr 后显示角色与两个导出按钮', async () => {
    const transport = makeTransport()
    renderPage(transport)

    expect(screen.queryByRole('button', { name: '导出 .plr' })).toBeNull()
    fireEvent.change(screen.getByTestId('players-plr-input'), {
      target: { files: [plrFile()] },
    })

    expect(await screen.findByText('webui')).toBeTruthy() // 存档里的角色名
    expect(screen.queryByText('本地导入')).toBeNull()
    expect(screen.getByText('永久增强')).toBeTruthy()
    expect(await screen.findByRole('button', { name: /导出图片/ })).toBeTruthy()
    expect(screen.getByLabelText('简约视图')).toBeTruthy()
    // 原始 .plr 可原样导出（outline 按钮），不经过任何后端。
    expect(screen.getByRole('button', { name: '导出 .plr' })).toBeTruthy()
  })

  it('拖入 .plr 文件同样可以查看', async () => {
    renderPage(makeTransport())
    fireEvent.drop(screen.getByTestId('players-save-drop'), {
      dataTransfer: { files: [plrFile('drop.plr')] },
    })
    expect(await screen.findByText('webui')).toBeTruthy()
  })

  it('解析失败时显示具体原因（本地解析器给的原文）', async () => {
    renderPage(makeTransport())
    fireEvent.change(screen.getByTestId('players-plr-input'), {
      target: { files: [new File([new Uint8Array([1])], 'bad.plr')] },
    })
    expect(await screen.findByText(/不是有效的角色存档/)).toBeTruthy()
  })

  it('未导入时显示空态提示', () => {
    renderPage(makeTransport())
    expect(screen.getByText('还没有选择存档')).toBeTruthy()
    expect(screen.queryByLabelText('简约视图')).toBeNull()
  })
})
