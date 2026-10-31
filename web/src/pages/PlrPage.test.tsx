import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasetProvider } from '@/lib/datasetContext'
import { I18nProvider } from '@/lib/i18n'
import { resetItemLimitsCache } from '@/lib/itemLimits'
import { DEMO_PLR_URL } from '@/lib/playerPage'
import { parsePlr, parsePlrFile } from '@/lib/save/plr'
import type { BackendTransport } from '@/lib/tshock'
import type { Dataset } from '@/types'
import { makeDataset } from '@/test/fixtures'
import { playerStubs } from '@/test/playerStubs'
import { PlayerInfoPanel } from '@/components/player/PlayerLookView'
import { PlayerLookPanel } from '@/components/player/PlayerLookPanel'
import { emptyPlrPlayer, plrSlots } from '@/lib/save/plr'
import { emptyPlayerLook } from '@/lib/tshock'
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

function renderPage(transport: BackendTransport, overrides: Partial<Dataset> = {}) {
  return render(
    <I18nProvider lang="zh">
      <DatasetProvider value={makeDataset(overrides)}>
        <PlrPage serverId="default" transport={transport} />
      </DatasetProvider>
    </I18nProvider>,
  )
}

/** 「来个 Demo」那份真实存档（1.4.0.2 旅途角色）。 */
function joyFile(): File {
  const bytes = readFileSync('public/demo/Joy.plr')
  return new File([new Uint8Array(bytes).slice().buffer as ArrayBuffer], 'Joy.plr')
}

/** 假的 `data/item-limits.json`：只要能被编辑流程读到即可（物品名/图标来自 dataset fixture）。 */
function itemLimitsFetch() {
  return vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).endsWith('data/item-limits.json')) {
      return new Response(
        JSON.stringify({
          meta: { gameVersion: '1.4.5.8', itemCount: 3, source: 'test', generatedBy: 'test', note: '' },
          maxStack: { '29': 9999, '75': 9999, '4956': 9999 },
          noInventory: [58],
        }),
        { status: 200 },
      )
    }
    return new Response('', { status: 404 })
  })
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

describe('PlrPage（玩家存档）', () => {
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

  it('「来个 Demo」载入自带的角色存档（同样是本地解析）', async () => {
    // 直接读仓库里的那份 Demo 文件：保证测试与真实发布的资源是同一份。
    const demoBytes = readFileSync('public/demo/Joy.plr')
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      // 页面还会拉别的静态资源（如人物图集），这里只关心 demo 存档。
      if (String(url) !== DEMO_PLR_URL) return new Response('', { status: 404 })
      return new Response(new Uint8Array(demoBytes), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    try {
      renderPage(makeTransport())
      fireEvent.click(screen.getByRole('button', { name: /来个 Demo/ }))

      // 角色名来自文件本身。
      expect(await screen.findByText('Joy')).toBeTruthy()
      const demoCalls = fetchSpy.mock.calls.filter((call) => String(call[0]) === DEMO_PLR_URL)
      expect(demoCalls).toHaveLength(1)
      // 载入后也能导出原文件（就是这份 demo）。
      expect(screen.getByRole('button', { name: '导出 .plr' })).toBeTruthy()
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
      renderPage(makeTransport())
      fireEvent.click(screen.getByRole('button', { name: /来个 Demo/ }))
      expect(await screen.findByText(/Demo 存档加载失败/)).toBeTruthy()
      expect(screen.getByText('还没有选择存档')).toBeTruthy()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('本地存档把版本 / 模式 / 游戏时间 / Golf / 渔夫任务 / BUFF 都显示出来', async () => {
    renderPage(makeTransport())
    // Joy.plr：release 226（1.4.0.2）、旅途模式、游玩 134617 秒、Golf 0、渔夫 0、BUFF 190（300 秒）。
    fireEvent.change(screen.getByTestId('players-plr-input'), {
      target: {
        files: [new File([new Uint8Array(readFileSync('public/demo/Joy.plr'))], 'Joy.plr')],
      },
    })

    expect(await screen.findByText('Joy')).toBeTruthy()
    expect(screen.getByText('1.4.0.2')).toBeTruthy() // 存档版本 → 游戏版本
    expect(screen.getByText('旅途')).toBeTruthy() // 难度
    expect(screen.getByText('37:23:37')).toBeTruthy() // 游玩时长（134617 秒，HH:MM:SS）
    expect(screen.getByText('Golf 分数')).toBeTruthy()
    expect(screen.getByText('当前 BUFF')).toBeTruthy()
    // 测试数据里没有 190 号 Buff 的名字，图标按 id 兜底（真实数据走 dataset 的中文名）。
    expect(screen.getByRole('img', { name: '#190' })).toBeTruthy()
    expect(screen.getByText('5:00')).toBeTruthy() // 剩余 BUFF 时间（18000 tick）
    expect(screen.getByText('最后保存')).toBeTruthy()
  })

  it('编辑生命后保存：下载的 .plr 能解析出新值，预览同步更新', async () => {
    vi.stubGlobal('fetch', itemLimitsFetch())
    try {
      renderPage(makeTransport())
      fireEvent.change(screen.getByTestId('players-plr-input'), {
        target: { files: [joyFile()] },
      })
      expect(await screen.findByText('Joy')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: /编辑$/ }))
      const life = (await screen.findByLabelText('生命')) as HTMLInputElement
      fireEvent.change(life, { target: { value: '300' } })

      const save = screen.getByRole('button', { name: /保存并下载/ }) as HTMLButtonElement
      await waitFor(() => expect(save.disabled).toBe(false))
      fireEvent.click(save)

      // 下载出去的就是新的 .plr：再解析一次，生命应当是 300（其余字段不变）。
      const blob = (URL.createObjectURL as unknown as { mock: { calls: [Blob][] } }).mock
        .calls.at(-1)![0]
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const edited = parsePlrFile(bytes)
      expect(edited.health).toBe(300)
      expect(edited.name).toBe('Joy')

      // 预览同步成保存后的数据（不再是编辑态）。
      expect(await screen.findByText('已生成新的 .plr 文件（已下载），请用它替换原文件。')).toBeTruthy()
      expect(screen.getByRole('button', { name: /编辑$/ })).toBeTruthy()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('item-limits 还没加载完时不给保存（否则堆叠 / 禁入背包的校验会缺席）', async () => {
    // `loadItemLimits` 有模块级缓存：先清掉，才真的会去请求（且一直不 resolve）
    resetItemLimitsCache()
    // 一直不 resolve 的 fetch：模拟 70 KB 的 item-limits.json 还在路上
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    try {
      renderPage(makeTransport())
      fireEvent.change(screen.getByTestId('players-plr-input'), {
        target: { files: [joyFile()] },
      })
      expect(await screen.findByText('Joy')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /编辑$/ }))
      const life = (await screen.findByLabelText('生命')) as HTMLInputElement
      fireEvent.change(life, { target: { value: '300' } })
      const save = screen.getByRole('button', { name: /保存并下载/ }) as HTMLButtonElement
      expect(save.disabled).toBe(true)
    } finally {
      vi.unstubAllGlobals()
      resetItemLimitsCache()
    }
  })

  it('超出上限的值不给保存', async () => {
    vi.stubGlobal('fetch', itemLimitsFetch())
    try {
      renderPage(makeTransport())
      fireEvent.change(screen.getByTestId('players-plr-input'), {
        target: { files: [joyFile()] },
      })
      expect(await screen.findByText('Joy')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /编辑$/ }))

      const lifeMax = (await screen.findByLabelText('生命上限')) as HTMLInputElement
      fireEvent.change(lifeMax, { target: { value: '999' } })
      expect(await screen.findByText('范围 0 – 500')).toBeTruthy()
      expect((screen.getByRole('button', { name: /保存并下载/ }) as HTMLButtonElement).disabled).toBe(
        true,
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('版本下拉只提供同一字段布局段内的版本', async () => {
    vi.stubGlobal('fetch', itemLimitsFetch())
    try {
      renderPage(makeTransport())
      fireEvent.change(screen.getByTestId('players-plr-input'), {
        target: { files: [joyFile()] },
      })
      expect(await screen.findByText('Joy')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /编辑$/ }))

      // Radix Select：点开触发器，选项是 role=option（文本形如「1.4.4.9（226）」）。
      fireEvent.click(await screen.findByLabelText('版本'))
      const labels = (await screen.findAllByRole('option')).map((o) => o.textContent ?? '')
      const releases = labels
        .map((text) => Number(/（(\d+)）/.exec(text)?.[1]))
        .filter((n) => Number.isFinite(n))
      // Joy 是 release 226，同段是 [220,228]
      expect(releases.length).toBeGreaterThan(0)
      expect(releases.every((v) => v >= 220 && v <= 228)).toBe(true)
      expect(releases).toContain(226)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('背包格子可以换物品 / 数量 / 词缀，保存后写进文件', async () => {
    vi.stubGlobal('fetch', itemLimitsFetch())
    try {
      renderPage(makeTransport(), {
        // 天顶剑可滚「传奇」(81)
        rollablePrefixesById: new Map([[4956, [81]]]),
      })
      fireEvent.change(screen.getByTestId('players-plr-input'), {
        target: { files: [joyFile()] },
      })
      expect(await screen.findByText('Joy')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /编辑$/ }))

      // 打开背包第 1 格 → 搜「天顶」→ 选中 → 数量 3 → 词缀传奇 → 放进
      fireEvent.click(await screen.findByLabelText('编辑背包第 1 格'))
      const search = await screen.findByPlaceholderText('搜索物品（名字 / ID）')
      fireEvent.change(search, { target: { value: '天顶' } })
      fireEvent.click(await screen.findByText('天顶剑'))

      const stack = (await screen.findByLabelText('数量')) as HTMLInputElement
      fireEvent.change(stack, { target: { value: '3' } })
      // Radix Select：点开「词缀」再点选项。
      fireEvent.click(await screen.findByLabelText('词缀'))
      fireEvent.click(await screen.findByRole('option', { name: /传奇/ }))
      fireEvent.click(screen.getByRole('button', { name: /放进去/ }))

      const save = screen.getByRole('button', { name: /保存并下载/ }) as HTMLButtonElement
      await waitFor(() => expect(save.disabled).toBe(false))
      fireEvent.click(save)

      const blob = (URL.createObjectURL as unknown as { mock: { calls: [Blob][] } }).mock
        .calls.at(-1)![0]
      const edited = parsePlrFile(new Uint8Array(await blob.arrayBuffer()))
      // 背包第 1 格（TShock 槽 0）= 天顶剑 ×3 + 传奇
      expect(edited.items[0]).toMatchObject({ id: 4956, stack: 3, prefix: 81 })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('永久增强只允许改这份存档里真实存在的字段（1.4.0.2 存档只有恶魔之心）', async () => {
    vi.stubGlobal('fetch', itemLimitsFetch())
    try {
      renderPage(makeTransport())
      fireEvent.change(screen.getByTestId('players-plr-input'), {
        target: { files: [joyFile()] },
      })
      expect(await screen.findByText('Joy')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /编辑$/ }))

      // 恶魔之心（3335，≥125）在 1.4.0.2 存档里有，可以勾
      // （fixture 数据集只有 3 件物品，图标名回退成 #id；真实数据里是「恶魔之心」等中文名）
      const demonHeart = (await screen.findByRole('checkbox', { name: /#3335/ })) as HTMLButtonElement
      expect(demonHeart.disabled).toBe(false)
      fireEvent.click(demonHeart)
      expect(demonHeart.getAttribute('aria-checked')).toBe('true')

      // 火把神（5043，≥229）/ 工匠面包（5326，≥256）是该版本之后的字段 → 置灰
      expect((screen.getByRole('checkbox', { name: /#5043/ }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('checkbox', { name: /#5326/ }) as HTMLButtonElement).disabled).toBe(true)
      // 并且界面上有解释（不是静默变灰）
      expect(screen.getByText(/灰色项是 1\.4\.0\.2 时的存档还没有的字段/)).toBeTruthy()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('1.4.5.8 存档：9 项永久增强全部可改（含矿车升级包）', async () => {
    vi.stubGlobal('fetch', itemLimitsFetch())
    try {
      renderPage(makeTransport())
      // 仓库里的真实 1.4.5.8 新角色（release 326）
      fireEvent.change(screen.getByTestId('players-plr-input'), {
        target: {
          files: [new File([new Uint8Array(readFileSync('src/lib/save/fixtures/webui-326.plr'))], 'webui.plr')],
        },
      })
      expect(await screen.findByText('webui')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /编辑$/ }))

      // 3335 恶魔之心 / 5043 火把神 / 5289 矿车 / 5326 面包 / 5337-5342 六个消耗品
      const boostIds = [3335, 5043, 5289, 5326, 5337, 5338, 5339, 5340, 5341, 5342]
      for (const id of boostIds) {
        const box = (await screen.findByRole('checkbox', { name: new RegExp(`#${id}`) })) as HTMLButtonElement
        expect(box.disabled).toBe(false)
      }
      // 1.4.5.8 存档里没有「老版本」的提示
      expect(screen.queryByText(/灰色项是/)).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
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

describe('玩家存档：研究进度与多世界重生点', () => {
  it('本地存档显示「已研究 N 种」（Joy = 705），没有床重生点时不显示列表', async () => {
    vi.stubGlobal('fetch', itemLimitsFetch())
    try {
      renderPage(makeTransport())
      fireEvent.change(screen.getByTestId('players-plr-input'), {
        target: { files: [joyFile()] },
      })
      expect(await screen.findByText('Joy')).toBeTruthy()
      expect(screen.getByText('已研究')).toBeTruthy()
      expect(screen.getByText('705')).toBeTruthy()
      expect(screen.queryByTestId('players-spawns')).toBeNull()

      // 点「705」打开研究进度明细：能按名字搜到，且显示已研究数量
      fireEvent.click(screen.getByTestId('players-research-open'))
      expect(await screen.findByTestId('players-research-list')).toBeTruthy()
      expect(screen.getByText('共研究 705 种物品（旅途模式的研究进度）。')).toBeTruthy()
      const search = screen.getByLabelText('搜索物品名 / 内部键名')
      fireEvent.change(search, { target: { value: '生命水晶' } })
      expect(screen.getByText('生命水晶')).toBeTruthy()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('有重生点时按世界列出（世界名 + 坐标），世界名为空则回退 #worldId', () => {
    render(
      <I18nProvider lang="zh">
        <DatasetProvider value={makeDataset()}>
          <PlayerInfoPanel
            look={{
              ...emptyPlayerLook('搬运工'),
              spawns: [
                { x: 100, y: 200, worldId: 4242, world: '主世界' },
                { x: 7, y: 8, worldId: 9, world: '' },
              ],
              researchedCount: 12,
            }}
          />
        </DatasetProvider>
      </I18nProvider>,
    )
    const box = screen.getByTestId('players-spawns')
    expect(box.textContent).toContain('重生点（2）')
    expect(box.textContent).toContain('主世界')
    expect(box.textContent).toContain('100, 200')
    expect(box.textContent).toContain('#9')
    expect(screen.getByText('12')).toBeTruthy()
  })
})

describe('玩家存档：三套配装', () => {
  it('`.plr` 的配装物品会渲染出「配装 1（2）」，空配装不显示', () => {
    // 用真实的槽位映射（plrSlots）铺 350 格，再往第 1 套配装塞两件
    const fake = {
      ...emptyPlrPlayer(),
      loadouts: [
        {
          armor: Array.from({ length: 20 }, (_, i) =>
            i === 0 ? { id: 4956, stack: 1, prefix: 0, favorited: false } : { id: 0, stack: 0, prefix: 0, favorited: false },
          ),
          dye: Array.from({ length: 10 }, (_, i) =>
            i === 0 ? { id: 29, stack: 1, prefix: 0, favorited: false } : { id: 0, stack: 0, prefix: 0, favorited: false },
          ),
          hide: Array.from({ length: 10 }, () => false),
        },
      ],
    }
    const look = { ...emptyPlayerLook('搬运工'), items: plrSlots(fake), currentLoadoutIndex: 0 }
    render(
      <I18nProvider lang="zh">
        <DatasetProvider value={makeDataset()}>
          <PlayerLookPanel
            look={look}
            imported
            compact={false}
            collapsed={{}}
            onToggleCollapse={() => {}}
          />
        </DatasetProvider>
      </I18nProvider>,
    )
    // 第 1 套配装有两件 → 标题带件数；第 2 / 3 套是空的 → 整块不渲染
    expect(screen.getByText('配装 1（2）')).toBeTruthy()
    expect(screen.queryAllByText(/配装\s*[23]/)).toHaveLength(0)
  })
})

describe('玩家存档：装备区编辑', () => {
  it('点装备格 → 编辑器以「装备模式」打开（数量禁用），换物品后保存生效', async () => {
    vi.stubGlobal('fetch', itemLimitsFetch())
    try {
      renderPage(makeTransport())
      fireEvent.change(screen.getByTestId('players-plr-input'), {
        target: { files: [joyFile()] },
      })
      expect(await screen.findByText('Joy')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /编辑$/ }))

      // 装备区一定渲染出来（5 列），点「装备 第 1 格」
      expect(await screen.findByTestId('plr-edit-equipment')).toBeTruthy()
      fireEvent.click(screen.getByTestId('plr-edit-equip-armor-0'))

      // 装备模式的对话框：标题带分组名，数量输入禁用并有说明
      expect(await screen.findByText('装备 1')).toBeTruthy()
      const stack = screen.getByLabelText('数量') as HTMLInputElement
      expect(stack.disabled).toBe(true)
      expect(screen.getByText('装备格不存数量')).toBeTruthy()

      // 搜到天顶剑并确认
      fireEvent.change(screen.getByPlaceholderText(/搜索物品/), { target: { value: '天顶' } })
      fireEvent.click(await screen.findByRole('button', { name: /天顶剑/ }))
      fireEvent.click(screen.getByRole('button', { name: '放进去' }))

      // 保存后下载的文件里，装备第 1 格就是天顶剑（4956），数量是 0（该格不存数量）
      const save = screen.getByRole('button', { name: /保存并下载/ }) as HTMLButtonElement
      await waitFor(() => expect(save.disabled).toBe(false))
      fireEvent.click(save)
      const blob = (URL.createObjectURL as unknown as { mock: { calls: [Blob][] } }).mock.calls.at(-1)![0]
      const edited = parsePlr(new Uint8Array(await blob.arrayBuffer()))
      expect(edited.armor[0].id).toBe(4956)
      // 装备格在文件里不存数量；解析后按「有物品 → 1」归一化
      expect(edited.armor[0].stack).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('玩家存档：随身仓储编辑', () => {
  it('点猪猪第 1 格 → 编辑器带分组名与数量（仓储有 stack）→ 保存后生效', async () => {
    vi.stubGlobal('fetch', itemLimitsFetch())
    try {
      renderPage(makeTransport())
      fireEvent.change(screen.getByTestId('players-plr-input'), {
        target: { files: [joyFile()] },
      })
      expect(await screen.findByText('Joy')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /编辑$/ }))

      // 仓储默认收起（250 格的网格默认展开太压人）：先展开
      fireEvent.click(await screen.findByTestId('plr-edit-storage-toggle'))
      expect(screen.getByTestId('plr-edit-storage')).toBeTruthy()
      fireEvent.click(screen.getByTestId('plr-edit-storage-piggyBank-0'))
      // 标题带「猪猪储钱罐 1」；数量可改（仓储与背包一样有 stack）
      expect(await screen.findByText('猪猪存钱罐 1')).toBeTruthy()
      expect((screen.getByLabelText('数量') as HTMLInputElement).disabled).toBe(false)

      fireEvent.change(screen.getByPlaceholderText(/搜索物品/), { target: { value: '生命水晶' } })
      fireEvent.click(await screen.findByRole('button', { name: /生命水晶/ }))
      fireEvent.change(screen.getByLabelText('数量'), { target: { value: '7' } })
      fireEvent.click(screen.getByRole('button', { name: '放进去' }))

      const save = screen.getByRole('button', { name: /保存并下载/ }) as HTMLButtonElement
      await waitFor(() => expect(save.disabled).toBe(false))
      fireEvent.click(save)
      const blob = (URL.createObjectURL as unknown as { mock: { calls: [Blob][] } }).mock.calls.at(-1)![0]
      const edited = parsePlr(new Uint8Array(await blob.arrayBuffer()))
      expect(edited.piggyBank[0]).toMatchObject({ id: 29, stack: 7 })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('玩家存档：三套配装编辑', () => {
  it('点第 1 套配装的装备第 1 格 → 编辑器带「配装 1 装备 1」→ 保存后生效', async () => {
    vi.stubGlobal('fetch', itemLimitsFetch())
    try {
      renderPage(makeTransport())
      // 配装是 1.4.3（release ≥262）才有的：用仓库里的真实 1.4.5.8 夹具（Joy 是 1.4.0.2，没有这段）
      const bytes326 = readFileSync('src/lib/save/fixtures/webui-326.plr')
      fireEvent.change(screen.getByTestId('players-plr-input'), {
        target: {
          files: [new File([new Uint8Array(bytes326).slice().buffer as ArrayBuffer], 'webui-326.plr')],
        },
      })
      await screen.findByRole('button', { name: /编辑$/ })
      fireEvent.click(screen.getByRole('button', { name: /编辑$/ }))

      // 1.4.5.8 → 有配装段，三套都渲染
      // 配装也默认收起：先展开
      fireEvent.click(await screen.findByTestId('plr-edit-loadouts-toggle'))
      expect(screen.getByTestId('plr-edit-loadouts')).toBeTruthy()
      fireEvent.click(screen.getByTestId('plr-edit-loadout-0-armor-0'))
      expect(await screen.findByText('配装 1 装备 1')).toBeTruthy()

      fireEvent.change(screen.getByPlaceholderText(/搜索物品/), { target: { value: '天顶' } })
      fireEvent.click(await screen.findByRole('button', { name: /天顶剑/ }))
      fireEvent.click(screen.getByRole('button', { name: '放进去' }))

      const save = screen.getByRole('button', { name: /保存并下载/ }) as HTMLButtonElement
      await waitFor(() => expect(save.disabled).toBe(false))
      fireEvent.click(save)
      const blob = (URL.createObjectURL as unknown as { mock: { calls: [Blob][] } }).mock.calls.at(-1)![0]
      const edited = parsePlr(new Uint8Array(await blob.arrayBuffer()))
      expect(edited.loadouts[0].armor[0].id).toBe(4956)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('玩家存档：编辑面板的折叠', () => {
  it('「随身仓储」「配装」默认收起，点标题展开/收起；背包与装备区不折叠', async () => {
    vi.stubGlobal('fetch', itemLimitsFetch())
    try {
      renderPage(makeTransport())
      fireEvent.change(screen.getByTestId('players-plr-input'), {
        target: { files: [joyFile()] },
      })
      expect(await screen.findByText('Joy')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /编辑$/ }))

      // 默认：两个大块的网格都不在 DOM 里（CollapsibleContent 收起时不渲染）
      expect(await screen.findByTestId('plr-edit-storage-toggle')).toBeTruthy()
      expect(screen.queryByTestId('plr-edit-storage')).toBeNull()
      // 背包（58 格）与装备区（40 格）是常用的，保持常显
      expect(screen.getByTestId('plr-edit-equipment')).toBeTruthy()

      // 展开 → 出现；再点 → 收起
      fireEvent.click(screen.getByTestId('plr-edit-storage-toggle'))
      expect(screen.getByTestId('plr-edit-storage')).toBeTruthy()
      fireEvent.click(screen.getByTestId('plr-edit-storage-toggle'))
      expect(screen.queryByTestId('plr-edit-storage')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
