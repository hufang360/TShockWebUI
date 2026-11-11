// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildZip } from '@/lib/spriteSheet/zip'
import { loadDataset } from './dataset'
import { parseLanguagePack } from './languagePack/parse'
import { mergePacks } from './languagePack/store'

/**
 * 端到端：真实数据 + 真实材质包 → `loadDataset(lang, overrides)`。
 * 验证物品名 / NPC 名 / 物品提示（含 `{$}` 与 `{InputTrigger}` 展开）都走材质包文本。
 */
const dataDir = resolve(process.cwd(), '../data')

const mockFetch = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const rel = String(input).replace(/^.*\/data\//, '')
      try {
        return new Response(readFileSync(resolve(dataDir, rel)), { status: 200 })
      } catch {
        return new Response('not found', { status: 404 })
      }
    }),
  )

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

function jsonPackZip(categories: Record<string, Record<string, string>>): ArrayBuffer {
  return toArrayBuffer(
    buildZip([
      {
        name: '9/depots/105600/1/pack.json',
        data: new TextEncoder().encode(JSON.stringify({ Name: '测试语言包', Author: 'tester' })),
      },
      {
        name: '9/depots/105600/1/Content/Localization/zh-Hans/Items.json',
        data: new TextEncoder().encode(JSON.stringify({ ItemName: categories.ItemName ?? {} })),
      },
      {
        name: '9/depots/105600/1/Content/Localization/zh-Hans/NPCs.json',
        data: new TextEncoder().encode(JSON.stringify({ NPCName: categories.NPCName ?? {} })),
      },
      {
        name: '9/depots/105600/1/Content/Localization/zh-Hans/Game.json',
        data: new TextEncoder().encode(JSON.stringify(categories)),
      },
    ]),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('语言材质包 → 数据集', () => {
  it('内置包（CSV）：NPC 名与物品提示按包内文本', async () => {
    const bytes = new Uint8Array(readFileSync(resolve(dataDir, 'langpacks/2447707451.zip')))
    const pack = await parseLanguagePack(toArrayBuffer(bytes), '2447707451.zip', {
      inflateRaw: async (data) => new Uint8Array(inflateRawSync(data) as Uint8Array),
    })
    const overrides = mergePacks([{ ...pack, id: 'builtin:2447707451' }], 'zh-Hans')
    mockFetch()
    const ds = await loadDataset('zh', overrides)

    // 官方 1.4.5.8 是「毒兔兔 / 灰咕噜」，包是「猩红兔兔 / 灰咕噜兽」。
    expect(ds.npcsById.get(464)?.name).toBe('猩红兔兔')
    expect(ds.npcsById.get(385)?.name).toBe('灰咕噜兽')
    // MonkStaffT3：官方「手持时交互可施展另一种攻击！」，包内是 1.4.2 的老文案。
    expect(ds.itemStats.items['3858']?.tip).toContain("'<Right>握持时则可展开另一种攻击！'")
    // 未改名的物品保持官方文本。
    expect(ds.itemsById.get(4956)?.name).toBe('天顶剑')
  })

  it('JSON 包：ItemName 覆盖 + 提示重算（{$} / {InputTrigger} 展开）', async () => {
    const pack = await parseLanguagePack(
      jsonPackZip({
        ItemName: { Zenith: '天顶剑·改' },
        NPCName: { BlueSlime: '蓝色史莱姆' },
        ItemTooltip: { RodofDiscord: '将你传送到光标处\n[c/d45757:混沌]\n{$CommonItemTooltip.RightClickToOpen}' },
        CommonItemTooltip: { RightClickToOpen: '{InputTrigger_ToggleOrOpen}打开' },
      }),
      'test.zip',
    )
    const overrides = mergePacks([{ ...pack, id: 'test' }], 'zh-Hans')
    expect(overrides).toBeDefined()
    mockFetch()
    const ds = await loadDataset('zh', overrides)

    expect(ds.itemsById.get(4956)?.name).toBe('天顶剑·改')
    expect(ds.npcsById.get(1)?.name).toBe('蓝色史莱姆')
    // 颜色标签原样保留（渲染层解析）；{$} 与按键占位符已展开。
    expect(ds.itemStats.items['1326']?.tip).toEqual([
      '将你传送到光标处',
      '[c/d45757:混沌]',
      '开启/切换打开',
    ])
  })

  it('没有材质包时仍用构建期 tips（行为不变）', async () => {
    const tips = JSON.parse(
      readFileSync(resolve(dataDir, 'item-tips.zh-Hans.json'), 'utf8'),
    ) as { items: Record<string, string[]> }
    mockFetch()
    const ds = await loadDataset('zh')
    expect(ds.itemStats.items['1326']?.tip).toEqual(tips.items['1326'])
    expect(ds.npcsById.get(464)?.name).toBe('毒兔兔')
  })
})
