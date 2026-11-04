import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import type {
  LanguagePackSummary,
  LanguagePacksController,
} from '@/lib/languagePack/useLanguagePacks'
import { LanguagePackSection } from './LanguagePackSection'

const builtin: LanguagePackSummary = {
  id: 'builtin:2447707451',
  name: '1.4.2 汉化修正',
  author: 'hufang360',
  version: '1.1',
  format: 'csv',
  cultures: ['zh-Hans'],
  builtin: true,
  sourceName: '2447707451.zip',
  bytes: 1,
  enabled: false,
  hasCulture: true,
  counts: { itemName: 12, itemTooltip: 2, npcName: 8, total: 24 },
}

const uploaded: LanguagePackSummary = {
  id: 'abc',
  name: 'Potralia的个人汉化(26.10.26)',
  author: 'Potralia',
  version: '145.56',
  format: 'json',
  cultures: ['zh-Hans'],
  builtin: false,
  sourceName: 'potralia.zip',
  bytes: 470869,
  enabled: true,
  hasCulture: true,
  counts: { itemName: 6178, itemTooltip: 2438, npcName: 703, total: 9469 },
}

function controller(patch: Partial<LanguagePacksController> = {}): LanguagePacksController {
  return {
    packs: [builtin, uploaded],
    ready: true,
    busy: false,
    storageAvailable: true,
    overrides: undefined,
    importFile: vi.fn(async () => {}),
    setEnabled: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    ...patch,
  }
}

function renderSection(patch: Partial<LanguagePacksController> = {}) {
  const ctl = controller(patch)
  render(
    <I18nProvider lang="zh">
      <LanguagePackSection controller={ctl} />
    </I18nProvider>,
  )
  return ctl
}

describe('LanguagePackSection', () => {
  it('显示包信息、内置 / 旧格式标签与词条数', () => {
    renderSection()
    expect(screen.getByText('1.4.2 汉化修正')).toBeTruthy()
    expect(screen.getByText('Potralia的个人汉化(26.10.26)')).toBeTruthy()
    expect(screen.getByText('内置')).toBeTruthy()
    expect(screen.getByText('1.4.2 旧格式')).toBeTruthy()
    expect(screen.getByText(/物品名 6178 · 提示 2438 · NPC 703/)).toBeTruthy()
  })

  it('勾选 / 取消、上移下移、删除（内置包不可删）', () => {
    const ctl = renderSection()
    fireEvent.click(screen.getByRole('switch', { name: '启用 1.4.2 汉化修正' }))
    expect(ctl.setEnabled).toHaveBeenCalledWith('builtin:2447707451', true)

    fireEvent.click(screen.getAllByRole('button', { name: '上移' })[1])
    expect(ctl.move).toHaveBeenCalledWith('abc', -1)

    // 内置包没有删除按钮。
    expect(screen.queryByRole('button', { name: '删除 1.4.2 汉化修正' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '删除 Potralia的个人汉化(26.10.26)' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(ctl.remove).toHaveBeenCalledWith('abc')
  })

  it('上传入口接收 .zip；无当前语言文本时提示', () => {
    const ctl = renderSection({
      packs: [{ ...uploaded, hasCulture: false, enabled: true }],
    })
    expect(screen.getByText('当前语言无文本')).toBeTruthy()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toContain('.zip')
    const file = new File(['x'], 'x.zip', { type: 'application/zip' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(ctl.importFile).toHaveBeenCalledWith(file)
  })

  it('IndexedDB 不可用时给出提示', () => {
    renderSection({ storageAvailable: false })
    expect(screen.getByText(/本浏览器无法保存材质包/)).toBeTruthy()
  })
})
