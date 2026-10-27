/**
 * 极简 canvas 桩：让「导出图片」在 jsdom 里也能跑到编码那一步。
 *
 * jsdom 没有 canvas 2d（`getContext` 返回 null / 抛 not implemented），所以之前只能测到「点了会走导出链路」。
 * 这里给一个**记录调用**的桩：不真的画，但能断言「画布尺寸对不对」「putImageData 用的是这张位图」
 * 「文本里有没有玩家名」——这正是版面回归最容易坏的地方。
 */

/** 记录到的绘制信息（每个用例后 `restore()` 清干净）。 */
export interface CanvasStubLog {
  /** 调用过 `getContext` 的画布尺寸（顺序即创建顺序）。 */
  canvases: { width: number; height: number }[]
  /** `putImageData` 的入参（位图尺寸与落点）。 */
  imageData: { width: number; height: number; x: number; y: number }[]
  /** `fillText` 画过的文本。 */
  texts: string[]
  /** `toBlob` 被调用的 MIME 类型。 */
  blobTypes: string[]
}

type Ctx = CanvasRenderingContext2D & Record<string, unknown>

/** 所有方法都是空实现；需要返回值的（measureText）给个近似值。 */
function makeCtx(canvas: HTMLCanvasElement, log: CanvasStubLog): Ctx {
  const noop = () => undefined
  const base: Record<string, unknown> = {
    canvas,
    measureText: (text: string) => ({ width: String(text).length * 7 }) as TextMetrics,
    getImageData: (x: number, y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h, x, y }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    putImageData: (data: { width: number; height: number }, x: number, y: number) => {
      log.imageData.push({ width: data.width, height: data.height, x, y })
    },
    fillText: (text: string) => {
      log.texts.push(String(text))
    },
    strokeText: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    drawImage: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    setTransform: noop,
    resetTransform: noop,
  }
  // 其余属性（fillStyle / lineWidth …）允许随意读写
  return new Proxy(base, {
    get: (target, key) => (key in target ? target[key as string] : undefined),
    set: (target, key, value) => {
      target[key as string] = value
      return true
    },
  }) as unknown as Ctx
}

/**
 * 装上桩。返回的 log 会在每次 `getContext` / `putImageData` / `toBlob` 时累积。
 * 用 `restore()` 还原（配合 `afterEach`）。
 */
export function installCanvasStub(): { log: CanvasStubLog; restore: () => void } {
  const log: CanvasStubLog = { canvases: [], imageData: [], texts: [], blobTypes: [] }
  const g = globalThis as Record<string, unknown>
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
  const hadImageData = 'ImageData' in g
  const original = {
    getContext: proto.getContext,
    toBlob: proto.toBlob,
    ImageData: g.ImageData,
  }

  if (!hadImageData) {
    class FakeImageData {
      data: Uint8ClampedArray
      width: number
      height: number
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data
        this.width = width
        this.height = height
      }
    }
    g.ImageData = FakeImageData
  }

  proto.getContext = function (this: HTMLCanvasElement) {
    log.canvases.push({ width: this.width, height: this.height })
    return makeCtx(this, log)
  }
  proto.toBlob = function (this: HTMLCanvasElement, cb: (blob: Blob | null) => void, type?: string) {
    log.blobTypes.push(type ?? '')
    cb(new Blob(['png'], { type: type ?? 'image/png' }))
  }

  return {
    log,
    restore: () => {
      proto.getContext = original.getContext
      proto.toBlob = original.toBlob
      if (hadImageData) g.ImageData = original.ImageData
      else delete g.ImageData
    },
  }
}
