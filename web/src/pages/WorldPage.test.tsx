import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { clearWorldCache, DEMO_WORLD_URL } from '@/lib/worldPage'
import { buildWorld } from '@/test/worldFile'
import { WorldPage } from './WorldPage'

function renderPage(serverId = 'default') {
  return render(
    <I18nProvider lang="zh">
      <WorldPage serverId={serverId} />
    </I18nProvider>,
  )
}

/** 合成世界 → File（文件内容与真实存档同格式，全程本地解析）。 */
function worldFile(name = 'my-world.wld'): File {
  const bytes = buildWorld({
    width: 200,
    height: 600,
    name: '休渔期',
    seed: '987654321',
    groundLevel: 300,
    rockLevel: 450,
    tiles: (x, y) => {
      if (y < 300) return { typ: -1 }
      if (y < 450) return { typ: 0 }
      return x < 20 ? { typ: -1, liquid: 1, liquidAmount: 255 } : { typ: 1 }
    },
  })
  // Uint8Array 的泛型 buffer 与 BlobPart 兼容性：拷一份到 ArrayBuffer 再包 File。
  return new File([bytes.slice().buffer as ArrayBuffer], name)
}

let clicks: string[] = []
let realClick: () => void

beforeEach(() => {
  clearWorldCache()
  clicks = []
  realClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    clicks.push(this.download)
  }
  Object.defineProperty(URL, 'createObjectURL', { writable: true, value: vi.fn(() => 'blob:mock') })
  Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: vi.fn() })
  localStorage.clear()
})

afterEach(() => {
  HTMLAnchorElement.prototype.click = realClick
  vi.restoreAllMocks()
})

describe('WorldPage（查看世界）', () => {
  it('本地解析 .wld：显示世界信息、缩略图与两个导出按钮（不需要登录）', async () => {
    renderPage()

    expect(screen.queryByRole('button', { name: /导出 \.wld/ })).toBeNull()
    expect(screen.getByText('还没有选择世界存档')).toBeTruthy()

    fireEvent.change(screen.getByTestId('world-wld-input'), {
      target: { files: [worldFile()] },
    })

    expect(await screen.findByRole('heading', { name: '休渔期' })).toBeTruthy()
    expect(screen.getByText('专家')).toBeTruthy()
    expect(screen.getByText('小世界')).toBeTruthy()
    expect(screen.getByText('猩红')).toBeTruthy()
    expect(screen.getByText('困难模式')).toBeTruthy()
    expect(screen.getByText('已收藏')).toBeTruthy()
    expect(screen.getByText('本地导入')).toBeTruthy()
    expect(screen.getByText('醉汉世界')).toBeTruthy()
    expect(screen.getByText('克苏鲁之脑')).toBeTruthy() // 猩红世界的「邪恶 Boss」
    expect(screen.getByText('200 × 600')).toBeTruthy()
    expect(screen.getByText('987654321')).toBeTruthy()
    expect(screen.getByText('2024-05-06 07:08')).toBeTruthy()
    // 缩略图画在 canvas 上（jsdom 没有 2d 上下文，只断言元素存在）。
    expect(screen.getByTestId('world-thumbnail')).toBeTruthy()
    // 顶栏出现「导出图片」（挂载后才渲染，故用 findBy），工具卡出现「导出 .wld」。
    expect(await screen.findByRole('button', { name: '导出图片' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /导出 \.wld/ })).toBeTruthy()
    // 不涉及登录 / 服务器。
    expect(screen.queryByText('请先登录！')).toBeNull()
  })

  it('「来个 Demo」加载自带的空白世界（同样是本地解析）', async () => {
    // 直接读仓库里的那份 Demo 文件：保证测试与真实发布的资源是同一份。
    const demoBytes = readFileSync('public/demo/world.wld')
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe(DEMO_WORLD_URL)
      return new Response(new Uint8Array(demoBytes), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    try {
      renderPage()
      fireEvent.click(screen.getByRole('button', { name: /来个 Demo/ }))

      // 空白世界：名 / 尺寸 / 腐化 / 存档版本来自文件本身。
      expect(await screen.findByRole('heading', { name: '空的世界' })).toBeTruthy()
      expect(screen.getByText('4200 × 1200')).toBeTruthy()
      expect(screen.getByText('腐化')).toBeTruthy()
      expect(screen.getByText('228')).toBeTruthy()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      // 载入后也能导出原文件（就是这份 demo）。
      expect(screen.getByRole('button', { name: /导出 \.wld/ })).toBeTruthy()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('Demo 资源缺失时给出可读错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    )
    try {
      renderPage()
      fireEvent.click(screen.getByRole('button', { name: /来个 Demo/ }))
      expect(await screen.findByText(/Demo 世界加载失败/)).toBeTruthy()
      expect(screen.getByText('还没有选择世界存档')).toBeTruthy()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('点击缩略图打开 1:1 大图（看清方块）', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('world-wld-input'), {
      target: { files: [worldFile()] },
    })
    const zoomBtn = await screen.findByRole('button', { name: /点击查看原图/ })
    expect(screen.queryByTestId('world-thumbnail-zoom')).toBeNull()
    fireEvent.click(zoomBtn)
    expect(await screen.findByTestId('world-thumbnail-zoom')).toBeTruthy()
  })

  it('说明「全程在本机浏览器完成，不上传服务器」', () => {
    renderPage()
    expect(screen.getByText(/全部在你的浏览器里完成/)).toBeTruthy()
  })

  it('导出 .wld 下载的就是选中的原文件', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('world-wld-input'), {
      target: { files: [worldFile('my-world.wld')] },
    })
    const btn = await screen.findByRole('button', { name: /导出 \.wld/ })
    fireEvent.click(btn)
    expect(clicks).toEqual(['my-world.wld'])
  })

  it('导出图片：把缩略图编码成 PNG 下载（<世界名>.png）', async () => {
    // jsdom 没有 canvas 2d / toBlob / ImageData：补最小桩，验证「导出图片」链路。
    const putImageData = vi.fn()
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ putImageData })) as never
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb: BlobCallback) => {
      cb(new Blob(['png'], { type: 'image/png' }))
    }) as never
    const g = globalThis as { ImageData?: unknown }
    const realImageData = g.ImageData
    g.ImageData = class {
      constructor() {}
    }

    try {
      renderPage()
      fireEvent.change(screen.getByTestId('world-wld-input'), {
        target: { files: [worldFile()] },
      })
      const btn = await screen.findByRole('button', { name: '导出图片' })
      fireEvent.click(btn)
      await waitFor(() => expect(clicks).toEqual(['休渔期.png']))
    } finally {
      g.ImageData = realImageData
    }
  })

  it('解析失败展示具体原因，且不清上次结果（本次未导入成功）', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('world-wld-input'), {
      target: { files: [new File([new Uint8Array([1, 2, 3])], 'bad.wld')] },
    })
    expect(await screen.findByText(/不像是世界存档/)).toBeTruthy()
    expect(screen.getByText('还没有选择世界存档')).toBeTruthy()
  })

  it('超大文件直接拒绝，不做解析', async () => {
    renderPage()
    const big = worldFile('huge.wld')
    Object.defineProperty(big, 'size', { value: 64 * 1024 * 1024 + 1 })
    fireEvent.change(screen.getByTestId('world-wld-input'), { target: { files: [big] } })
    expect(await screen.findByText(/文件太大/)).toBeTruthy()
    expect(screen.getByText('还没有选择世界存档')).toBeTruthy()
  })

  it('拖入文件同样可以导入，且结果按服务器缓存', async () => {
    const view = renderPage('srv-a')
    fireEvent.drop(screen.getByTestId('world-drop'), {
      dataTransfer: { files: [worldFile('a.wld.bak')] },
    })
    expect(await screen.findByRole('heading', { name: '休渔期' })).toBeTruthy()

    // 切走再回来（重新挂载）仍显示上次解析结果。
    view.unmount()
    renderPage('srv-a')
    expect(await screen.findByRole('heading', { name: '休渔期' })).toBeTruthy()
  })
})
