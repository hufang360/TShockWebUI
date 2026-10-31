import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SliceEntry } from '@/lib/spriteSheet/model'
import { SliceCanvas } from './SliceCanvas'

/** 记录 canvas 调用顺序的极简 2D context。 */
function makeCtx() {
  const calls: string[] = []
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(() => calls.push('drawImage')),
    fillRect: vi.fn((_x: number, _y: number, w: number, h: number) =>
      calls.push(`fillRect:${w}x${h}`),
    ),
    strokeRect: vi.fn(() => calls.push('strokeRect')),
    beginPath: vi.fn(() => calls.push('beginPath')),
    moveTo: vi.fn(() => calls.push('moveTo')),
    lineTo: vi.fn(),
    stroke: vi.fn(() => calls.push('stroke')),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    fill: vi.fn(),
    roundRect: vi.fn(() => calls.push('roundRect')),
    fillText: vi.fn(() => calls.push('fillText')),
    measureText: () => ({ width: 8 }),
    imageSmoothingEnabled: true,
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    globalAlpha: 1,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
  }
  return { ctx, calls }
}

const src = { source: {} as CanvasImageSource, width: 64, height: 32 }

function entriesOf(rects: { x: number; y: number; w: number; h: number }[], adjusted = new Set<number>()): SliceEntry[] {
  return rects.map((rect, index) => ({
    key: `g:${index}`,
    index,
    rect,
    kind: 'grid' as const,
    defaultName: `r1c${index + 1}`,
    name: '',
    displayName: `r1c${index + 1}`,
    adjusted: adjusted.has(index),
  }))
}

const twoSlices = entriesOf([
  { x: 0, y: 0, w: 32, h: 32 },
  { x: 32, y: 0, w: 32, h: 32 },
])

let calls: string[] = []
let ctx: ReturnType<typeof makeCtx>['ctx']

beforeEach(() => {
  const made = makeCtx()
  ctx = made.ctx
  calls = made.calls
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never
  // jsdom 没有 pointer capture：拖拽框选用例需要它们存在。
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => true)
})

function renderCanvas(props: Partial<Parameters<typeof SliceCanvas>[0]> = {}) {
  return render(
    <SliceCanvas
      src={src}
      entries={twoSlices}
      selected={null}
      zoom={1}
      mode="grid"
      onSelect={vi.fn()}
      onNudge={vi.fn()}
      onCreate={vi.fn()}
      label="预览"
      {...props}
    />,
  )
}

describe('SliceCanvas 绘制分层', () => {
  it('未选中：网格按去重边界一次描边（2 格 → 3 条竖线 + 2 条横线），不画选中框', () => {
    renderCanvas()
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
    expect(ctx.moveTo).toHaveBeenCalledTimes(5)
    expect(ctx.stroke).toHaveBeenCalledTimes(1)
    expect(ctx.strokeRect).not.toHaveBeenCalled()
    expect(ctx.fillRect).not.toHaveBeenCalled()
    // 序号小徽标：两格各一个
    expect(ctx.roundRect).toHaveBeenCalledTimes(2)
    expect(ctx.fillText).toHaveBeenCalledTimes(2)
  })

  it('选中：压暗整图 → 重画选中区域 → 白色光晕 + 主色边框 → 徽标高亮', () => {
    renderCanvas({ selected: 'g:0' })
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 64, 32)
    expect(ctx.drawImage).toHaveBeenCalledTimes(2)
    expect(ctx.strokeRect).toHaveBeenCalledTimes(2)
    expect(ctx.setLineDash).not.toHaveBeenCalled()
    const idx = calls.indexOf('fillRect:64x32')
    expect(idx).toBeGreaterThan(calls.indexOf('drawImage'))
    expect(calls.indexOf('roundRect')).toBeGreaterThan(idx)
  })

  it('微调过的切片用虚线框标出（选中的那张不重复画虚线）', () => {
    renderCanvas({ entries: entriesOf(twoSlices.map((entry) => entry.rect), new Set([0, 1])) })
    expect(ctx.setLineDash).toHaveBeenCalledWith([4, 3])
    expect(ctx.strokeRect).toHaveBeenCalledTimes(2)

    ctx.strokeRect.mockClear()
    ctx.setLineDash.mockClear()
    renderCanvas({
      entries: entriesOf(twoSlices.map((entry) => entry.rect), new Set([1])),
      selected: 'g:1',
    })
    expect(ctx.strokeRect).toHaveBeenCalledTimes(2)
    expect(ctx.setLineDash).not.toHaveBeenCalled()
  })

  it('格子太小时不画序号徽标', () => {
    renderCanvas({ entries: entriesOf([{ x: 0, y: 0, w: 20, h: 12 }]) })
    expect(ctx.roundRect).not.toHaveBeenCalled()
    expect(ctx.fillText).not.toHaveBeenCalled()
  })
})

describe('SliceCanvas 交互', () => {
  it('网格模式：点一下按命中切片选中', () => {
    const onSelect = vi.fn()
    const { container } = renderCanvas({ onSelect })
    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    fireEvent.pointerDown(canvas, { clientX: 40, clientY: 10, pointerId: 1 })
    expect(onSelect).toHaveBeenCalledWith('g:1')
  })

  it('框选模式：拖出矩形 → onCreate；点一下（没拖开）仍然是选中', () => {
    const onCreate = vi.fn()
    const onSelect = vi.fn()
    const { container } = renderCanvas({ mode: 'marquee', onCreate, onSelect })
    const canvas = container.querySelector('canvas') as HTMLCanvasElement

    fireEvent.pointerDown(canvas, { clientX: 2, clientY: 2, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 20, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 30, clientY: 20, pointerId: 1 })
    expect(onCreate).toHaveBeenCalledWith({ x: 2, y: 2, w: 28, h: 18 })
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.pointerDown(canvas, { clientX: 40, clientY: 10, pointerId: 2 })
    fireEvent.pointerUp(canvas, { clientX: 40, clientY: 10, pointerId: 2 })
    expect(onSelect).toHaveBeenCalledWith('g:1')
  })

  it('框选期间画临时虚线框', () => {
    const { container, rerender } = renderCanvas({ mode: 'marquee' })
    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 16, clientY: 16, pointerId: 1 })
    rerender(
      <SliceCanvas
        src={src}
        entries={twoSlices}
        selected={null}
        zoom={1}
        mode="marquee"
        onSelect={vi.fn()}
        onNudge={vi.fn()}
        onCreate={vi.fn()}
        label="预览"
      />,
    )
    expect(ctx.setLineDash).toHaveBeenCalledWith([5, 4])
    expect(ctx.fillRect).toHaveBeenCalled()
  })
})
