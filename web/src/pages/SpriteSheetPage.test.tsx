import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { clearSheetCache } from '@/lib/spriteSheet/sheetCache'
import { SpriteSheetPage } from './SpriteSheetPage'

vi.mock('@/lib/spriteSheet/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/spriteSheet/export')>()
  return {
    ...actual,
    sliceBlob: vi.fn(async () => new Blob(['slice'], { type: 'image/png' })),
    zipSlices: vi.fn(async () => new Blob(['zip'], { type: 'application/zip' })),
    canvasToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
    rgbaToPngBytes: vi.fn(async () => new Uint8Array([137, 80, 78, 71])),
    composeGifFrames: vi.fn(
      (_src: unknown, rects: { w: number; h: number }[]) => {
        const width = Math.max(1, ...rects.map((rect) => Math.round(rect.w)))
        const height = Math.max(1, ...rects.map((rect) => Math.round(rect.h)))
        return {
          width,
          height,
          frames: rects.map(() => ({
            data: new Uint8ClampedArray(width * height * 4).fill(255),
            canvas: document.createElement('canvas'),
          })),
        }
      },
    ),
  }
})

const downloadBlob = vi.fn()
vi.mock('@/lib/playerPage', () => ({ downloadBlob: (...args: unknown[]) => downloadBlob(...args) }))

import { sliceBlob, zipSlices } from '@/lib/spriteSheet/export'

function renderPage() {
  return render(
    <I18nProvider lang="zh">
      <SpriteSheetPage />
    </I18nProvider>,
  )
}

/** 导入一张 512×256 的「PNG」：解码被 mock，尺寸由用例决定。 */
async function importSheet(name = 'sheet.png', width = 512, height = 256) {
  Object.defineProperty(globalThis, 'createImageBitmap', {
    writable: true,
    value: vi.fn(async () => ({ width, height, close: vi.fn() })),
  })
  fireEvent.change(screen.getByTestId('slice-png-input'), {
    target: { files: [new File(['fake'], name, { type: 'image/png' })] },
  })
  await waitFor(() => expect(screen.getByText(new RegExp(`已导入 ${name}`))).toBeTruthy())
}

function previewCanvas(): HTMLCanvasElement {
  const canvas = screen.getByLabelText('精灵图预览').querySelector('canvas')
  if (!canvas) throw new Error('preview canvas missing')
  return canvas
}

/** 在预览上拖一个框（jsdom 的 getBoundingClientRect 为 0，坐标即图片坐标）。 */
function dragFrame(from: { x: number; y: number }, to: { x: number; y: number }) {
  const canvas = previewCanvas()
  fireEvent.pointerDown(canvas, { clientX: from.x, clientY: from.y, pointerId: 1 })
  fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y, pointerId: 1 })
  fireEvent.pointerUp(canvas, { clientX: to.x, clientY: to.y, pointerId: 1 })
}

beforeEach(() => {
  localStorage.clear()
  clearSheetCache()
  downloadBlob.mockClear()
  vi.mocked(sliceBlob).mockClear()
  vi.mocked(zipSlices).mockClear()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => true)
})

describe('精灵图分割页', () => {
  it('空态：提示导入，不显示导出', () => {
    renderPage()
    expect(screen.getByText('还没有选择精灵图')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '导出全部' })).toBeNull()
  })

  it('导入后默认 1×1，改行列后切片数跟着变', async () => {
    renderPage()
    await importSheet()
    expect(screen.getByText('原图 512×256')).toBeTruthy()
    expect(screen.getByText('共 1 张 · 已微调 0 张 · 手动 0 张')).toBeTruthy()
    expect(screen.getAllByTestId('slice-thumb')).toHaveLength(1)

    fireEvent.change(screen.getByLabelText('行数'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('列数'), { target: { value: '2' } })
    expect(screen.getByText('共 4 张 · 已微调 0 张 · 手动 0 张')).toBeTruthy()
    expect(screen.getAllByTestId('slice-thumb')).toHaveLength(4)
    expect(screen.getByText('单元格 256×128 px')).toBeTruthy()
  })

  it('选中切片后可改 X / 方向键微移，统计「已微调」', async () => {
    renderPage()
    await importSheet()
    fireEvent.change(screen.getByLabelText('列数'), { target: { value: '2' } })

    fireEvent.click(screen.getAllByTestId('slice-thumb')[1])
    const x = screen.getByLabelText('X') as HTMLInputElement
    expect(x.value).toBe('256')

    fireEvent.change(x, { target: { value: '300' } })
    expect(screen.getByText('共 2 张 · 已微调 1 张 · 手动 0 张')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '右移 1 px' }))
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe('301')

    fireEvent.click(screen.getByRole('button', { name: '恢复此切片' }))
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe('256')
    expect(screen.getByText('共 2 张 · 已微调 0 张 · 手动 0 张')).toBeTruthy()
  })

  it('命名：名字用于导出文件名；改行列时清掉网格切片的名称', async () => {
    renderPage()
    await importSheet()
    fireEvent.change(screen.getByLabelText('列数'), { target: { value: '2' } })

    fireEvent.click(screen.getAllByTestId('slice-thumb')[0])
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'hero' } })
    expect(screen.getAllByTestId('slice-thumb')[0].getAttribute('aria-label')).toBe('hero（#1）')

    fireEvent.click(screen.getByRole('button', { name: '导出此切片' }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(downloadBlob.mock.calls[0][1]).toBe('hero.png')

    fireEvent.change(screen.getByLabelText('列数'), { target: { value: '3' } })
    expect(
      screen.getByText('切分参数变了，已清掉 1 处微调 / 名称（手动框选的切片保留）。'),
    ).toBeTruthy()
    expect(screen.getAllByTestId('slice-thumb')[0].getAttribute('aria-label')).toBe('r1c1（#1）')
  })

  it('框选模式：拖一块就多一张手动切片，可命名 / 删除，且不受改行列影响', async () => {
    renderPage()
    await importSheet()

    fireEvent.click(screen.getByLabelText('框选'))
    dragFrame({ x: 0, y: 0 }, { x: 20, y: 20 })
    expect(screen.getByText('共 2 张 · 已微调 0 张 · 手动 1 张')).toBeTruthy()
    // 新建后自动选中，名称框的占位是默认名。
    expect((screen.getByLabelText('名称') as HTMLInputElement).placeholder).toBe('slice-1')

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'icon-a' } })
    expect(
      screen.getByText('共 2 张 · 已微调 0 张 · 手动 1 张'),
    ).toBeTruthy()

    fireEvent.change(screen.getByLabelText('列数'), { target: { value: '4' } })
    // 网格切片变多，手动那张和名字都还在。
    expect(screen.getByText('共 5 张 · 已微调 0 张 · 手动 1 张')).toBeTruthy()
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('icon-a')

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByText('共 4 张 · 已微调 0 张 · 手动 0 张')).toBeTruthy()
    expect(screen.getByText('在预览或下方列表点一个切片即可微调。')).toBeTruthy()
  })

  it('导出全部：文件名用命名，重名自动加 -2', async () => {
    renderPage()
    await importSheet()
    fireEvent.change(screen.getByLabelText('列数'), { target: { value: '2' } })

    const thumbs = () => screen.getAllByTestId('slice-thumb')
    fireEvent.click(thumbs()[0])
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'hero' } })
    fireEvent.click(thumbs()[1])
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'hero' } })

    fireEvent.click(screen.getByRole('button', { name: '导出全部' }))
    await waitFor(() => expect(zipSlices).toHaveBeenCalledTimes(1))
    const items = vi.mocked(zipSlices).mock.calls[0][1]
    expect(items).toHaveLength(2)
    expect(items.map((item) => item.name)).toEqual(['hero', 'hero-2'])
    expect(downloadBlob.mock.calls[0][1]).toBe('sheet-slices.zip')
  })

  it('GIF：加入帧序列后导出 .gif（间隔 / 帧数写进提示）', async () => {
    renderPage()
    await importSheet()
    fireEvent.change(screen.getByLabelText('列数'), { target: { value: '2' } })

    expect(screen.getByText('至少 2 帧才能生成 GIF。')).toBeTruthy()

    fireEvent.click(screen.getAllByTestId('slice-thumb')[0])
    fireEvent.click(screen.getByRole('button', { name: '加入当前切片' }))
    expect(screen.getByText('已加入帧序列（共 1 帧）。')).toBeTruthy()

    fireEvent.click(screen.getAllByTestId('slice-thumb')[1])
    fireEvent.click(screen.getByRole('button', { name: '加入当前切片' }))
    expect(screen.getByText('已加入帧序列（共 2 帧）。')).toBeTruthy()
    expect(screen.queryByText('至少 2 帧才能生成 GIF。')).toBeNull()

    fireEvent.change(screen.getByLabelText('帧间隔 (ms)'), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: '导出 GIF' }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    const [blob, file] = downloadBlob.mock.calls[0] as [Blob, string]
    expect(file).toBe('sheet-animation.gif')
    expect(blob.type).toBe('image/gif')
    expect(
      screen.getByText('已导出 sheet-animation.gif（2 帧，80 ms/帧）。'),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(screen.getByText('至少 2 帧才能生成 GIF。')).toBeTruthy()
  })

  it('Demo：已有图片时先确认覆盖；确认后套用图集切分参数', async () => {
    renderPage()
    await importSheet('mine.png', 64, 64)

    Object.defineProperty(globalThis, 'createImageBitmap', {
      writable: true,
      value: vi.fn(async () => ({ width: 1022, height: 428, close: vi.fn() })),
    })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['fake'], { type: 'image/png' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    // 已有图片 → 先弹确认；取消则什么都不变
    fireEvent.click(screen.getByRole('button', { name: '来个 Demo' }))
    expect(await screen.findByText('覆盖当前图片？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByText(/已导入 mine\.png/)).toBeTruthy()
    expect((screen.getByLabelText('行数') as HTMLInputElement).value).toBe('1')
    expect(fetchMock).not.toHaveBeenCalled()

    // 再次点击 → 确认覆盖
    fireEvent.click(screen.getByRole('button', { name: '来个 Demo' }))
    fireEvent.click(await screen.findByRole('button', { name: '覆盖并载入' }))
    await waitFor(() => expect(screen.getByText(/已载入 Buff 图集 Demo/)).toBeTruthy())
    expect((screen.getByLabelText('行数') as HTMLInputElement).value).toBe('13')
    expect((screen.getByLabelText('列数') as HTMLInputElement).value).toBe('31')
    expect(screen.getByText('共 403 张 · 已微调 0 张 · 手动 0 张')).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('自动猜测行列：512×256 → 2 列 × 1 行', async () => {
    renderPage()
    await importSheet()
    fireEvent.click(screen.getByRole('button', { name: '自动猜测行列' }))
    expect(screen.getByText('按 256×256 的单元格推算为 2 列 × 1 行。')).toBeTruthy()
    expect(screen.getByText('共 2 张 · 已微调 0 张 · 手动 0 张')).toBeTruthy()
  })
})

describe('右侧栏', () => {
  it('控件是小号（输入 h-7 / 卡片内边距收紧），两栏宽度 300px', async () => {
    renderPage()
    await importSheet()
    const rows = screen.getByLabelText('行数') as HTMLInputElement
    expect(rows.className).toContain('md:h-7')
    const grid = screen.getByText('切分设置').closest('[data-slot="card"]') as HTMLElement
    expect(within(grid).getByLabelText('列数')).toBeTruthy()
  })
})


describe('精灵图 tab', () => {
  it('左上角三个 tab：分割 / 合并 / GIF，切换会记到本机', async () => {
    renderPage()
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['分割', '合并', 'GIF'])

    fireEvent.mouseDown(screen.getByRole('tab', { name: '合并' }))
    expect(localStorage.getItem('tswui:spriteSheetTab')).toBe('"merge"')
    expect(screen.getByText('还没有选择图片')).toBeTruthy()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'GIF' }))
    expect(localStorage.getItem('tswui:spriteSheetTab')).toBe('"gif"')
    expect(screen.getByText('还没有选择 GIF')).toBeTruthy()

    fireEvent.mouseDown(screen.getByRole('tab', { name: '分割' }))
    expect(localStorage.getItem('tswui:spriteSheetTab')).toBe('"split"')
  })

  it('「来个 Demo」会载入自带的 data/buff-atlas.png（本地解码）', async () => {
    renderPage()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['fake'], { type: 'image/png' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    Object.defineProperty(globalThis, 'createImageBitmap', {
      writable: true,
      value: vi.fn(async () => ({ width: 320, height: 32, close: vi.fn() })),
    })

    fireEvent.click(screen.getByRole('button', { name: '来个 Demo' }))
    await waitFor(() => expect(screen.getByText(/已载入 Buff 图集 Demo/)).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('data/buff-atlas.png'),
      expect.anything(),
    )
    expect(screen.getByText('原图 320×32')).toBeTruthy()
    // Demo 自带切分参数：31 列 × 13 行、间距 1 px（共 403 格）
    expect((screen.getByLabelText('行数') as HTMLInputElement).value).toBe('13')
    expect((screen.getByLabelText('列数') as HTMLInputElement).value).toBe('31')
    expect((screen.getByLabelText('间距', { selector: '#slice-gap' }) as HTMLInputElement).value).toBe('1')
    expect(screen.getByText('共 403 张 · 已微调 0 张 · 手动 0 张')).toBeTruthy()
    vi.unstubAllGlobals()
  })
})

describe('合并', () => {
  it('多选 PNG → 显示张数与输出尺寸，可移除；导出 -merged.png', async () => {
    renderPage()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '合并' }))

    const sizes = [
      { width: 20, height: 10 },
      { width: 8, height: 6 },
    ]
    let call = 0
    Object.defineProperty(globalThis, 'createImageBitmap', {
      writable: true,
      value: vi.fn(async () => {
        const size = sizes[call++] ?? sizes[0]
        return { ...size, close: vi.fn() }
      }),
    })

    fireEvent.change(screen.getByTestId('merge-png-input'), {
      target: {
        files: [
          new File(['a'], 'a.png', { type: 'image/png' }),
          new File(['b'], 'b.png', { type: 'image/png' }),
        ],
      },
    })

    await waitFor(() => expect(screen.getByText('2 张图片')).toBeTruthy())
    // 横向：20 + 8，行高 = 10
    expect(screen.getByText('输出 28×10')).toBeTruthy()
    expect(screen.getByText('a.png')).toBeTruthy()
    expect(screen.getByText('b.png')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: '移除' })[0])
    expect(screen.getByText('1 张图片')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '导出精灵图' }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(downloadBlob.mock.calls[0][1]).toBe('b-merged.png')
  })
})

describe('GIF 分拆', () => {
  it('导入 GIF → 拆成帧 → 导出全部帧 ZIP', async () => {
    renderPage()
    const { encodeGif } = await import('@/lib/spriteSheet/gif')
    const gifBytes = encodeGif(
      [
        { data: new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]) },
        { data: new Uint8ClampedArray([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]) },
      ],
      { width: 2, height: 2, delayMs: 100, loop: 0 },
    )
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'GIF' }))
    fireEvent.change(screen.getByTestId('gif-split-input'), {
      target: { files: [new File([gifBytes.slice().buffer as ArrayBuffer], 'demo.gif', { type: 'image/gif' })] },
    })

    await waitFor(() => expect(screen.getByText('2×2 · 2 帧')).toBeTruthy())
    expect(screen.getByText('无限循环')).toBeTruthy()
    expect(screen.getAllByTestId('gif-frame-thumb')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '导出全部帧' }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    const [blob, file] = downloadBlob.mock.calls[0] as [Blob, string]
    expect(file).toBe('demo-frames.zip')
    expect(blob.type).toBe('application/zip')
    expect(screen.getByText('已导出 demo-frames.zip（2 帧）。')).toBeTruthy()
  })
})
