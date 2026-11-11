// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { buildZip } from '@/lib/spriteSheet/zip'
import { readZip } from './zip'
import {
  LanguagePackError,
  parseCsv,
  parseLanguagePack,
  type LanguagePackErrorCode,
} from './parse'
import { mergePacks, type StoredLanguagePack } from './store'

const dataDir = resolve(process.cwd(), '../data')
const inflateRaw = async (data: Uint8Array) =>
  new Uint8Array(inflateRawSync(data) as Uint8Array)

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

/** 用 store-only 写一个 zip（文件名 → 文本）。 */
function makeZip(files: Record<string, string>): ArrayBuffer {
  return toArrayBuffer(
    buildZip(
      Object.entries(files).map(([name, text]) => ({
        name,
        data: new TextEncoder().encode(text),
      })),
    ),
  )
}

const PACK_JSON = JSON.stringify({ Name: '测试包', Author: 'tester', Version: { major: 1, minor: 2 } })

async function expectCode(promise: Promise<unknown>, code: LanguagePackErrorCode) {
  await expect(promise).rejects.toBeInstanceOf(LanguagePackError)
  await promise.catch((err: unknown) => {
    expect((err as LanguagePackError).code).toBe(code)
  })
}

describe('zip 读取', () => {
  it('store-only 条目', async () => {
    const files = await readZip(makeZip({ 'a/b.txt': 'hello', 'a/c.txt': '世界' }))
    const map = new Map(files.map((f) => [f.name, new TextDecoder().decode(f.bytes)]))
    expect(map.get('a/b.txt')).toBe('hello')
    expect(map.get('a/c.txt')).toBe('世界')
  })

  it('deflate 条目（真实内置包）', async () => {
    const bytes = new Uint8Array(readFileSync(resolve(dataDir, 'langpacks/2447707451.zip')))
    const files = await readZip(toArrayBuffer(bytes), { inflateRaw })
    expect(files.some((f) => f.name.endsWith('pack.json'))).toBe(true)
    expect(files.some((f) => /Content\/Localization\/zh-Hans\/Items\.csv/.test(f.name))).toBe(true)
  })

  it('非 ZIP 报错', async () => {
    await expect(readZip(new TextEncoder().encode('not a zip').buffer as ArrayBuffer)).rejects.toThrow()
  })
})

describe('CSV 解析', () => {
  it('BOM / 引号 / 逗号 / CRLF', () => {
    const rows = parseCsv('\uFEFFkey,translation\r\nItemName.A,"a,b"\r\nItemName.B,"say ""hi"""\r\n')
    expect(rows[0]).toEqual(['key', 'translation'])
    expect(rows[1]).toEqual(['ItemName.A', 'a,b'])
    expect(rows[2]).toEqual(['ItemName.B', 'say "hi"'])
  })
})

describe('材质包解析', () => {
  it('内置包（1.4.2 CSV + depot 包装层）', async () => {
    const bytes = new Uint8Array(readFileSync(resolve(dataDir, 'langpacks/2447707451.zip')))
    const pack = await parseLanguagePack(toArrayBuffer(bytes), '2447707451.zip', { inflateRaw })
    expect(pack.name).toBe('1.4.2 汉化修正')
    expect(pack.author).toBe('hufang360')
    expect(pack.format).toBe('csv')
    expect(pack.cultures).toEqual(['zh-Hans'])
    expect(pack.steamId).toBe(2447707451)
    expect(pack.entries['zh-Hans'].ItemName.Ruby).toBe('红玉')
    expect(pack.entries['zh-Hans'].NPCName.CrimsonBunny).toBe('猩红兔兔')
    expect(pack.entries['zh-Hans'].MapObject.Cobalt).toBe('钴')
  })

  it('JSON 包：只收白名单分类、忽略非 Localization 文件', async () => {
    const pack = await parseLanguagePack(
      makeZip({
        '1/depots/105600/9/pack.json': PACK_JSON,
        '1/depots/105600/9/workshop.json': JSON.stringify({ SteamEntryId: 42, ContentType: 'ResourcePack' }),
        '1/depots/105600/9/Content/Localization/zh-Hans/Items.json': JSON.stringify({
          ItemName: { Ruby: '红玉' },
          ItemTooltip: { RodofDiscord: '传送' },
          Bestiary_FlavorText: { X: '不需要' },
        }),
        // 仿冒文件（西里尔字母 е）：不在 Localization 目录，必须忽略。
        '1/depots/105600/9/Content/It\u0435ms.json': JSON.stringify({ ItemName: { Ruby: '假名' } }),
      }),
      'json.zip',
    )
    expect(pack.name).toBe('测试包')
    expect(pack.format).toBe('json')
    expect(pack.steamId).toBe(42)
    expect(pack.entries['zh-Hans'].ItemName.Ruby).toBe('红玉')
    expect(pack.entries['zh-Hans'].ItemTooltip.RodofDiscord).toBe('传送')
    expect(pack.entries['zh-Hans'].Bestiary_FlavorText).toBeUndefined()
  })

  it('缺少 pack.json / 损坏 / 无语言文件', async () => {
    await expectCode(parseLanguagePack(makeZip({ 'a.txt': 'x' }), 'a.zip'), 'no_pack')
    await expectCode(
      parseLanguagePack(makeZip({ 'pack.json': 'not json' }), 'b.zip'),
      'bad_pack',
    )
    await expectCode(
      parseLanguagePack(
        makeZip({ 'pack.json': PACK_JSON, 'Content/Images/x.png': 'x' }),
        'c.zip',
      ),
      'no_localization',
    )
  })
})

describe('合并优先级', () => {
  const pack = (id: string, entries: StoredLanguagePack['entries']): StoredLanguagePack => ({
    id,
    name: id,
    format: 'json',
    cultures: Object.keys(entries),
    sourceName: `${id}.zip`,
    bytes: 1,
    importedAt: 0,
    entries,
  })

  it('靠上的包优先，不同 key 叠加；只取当前语言', () => {
    const top = pack('top', { 'zh-Hans': { ItemName: { Ruby: '上', Sapphire: '上' } } })
    const bottom = pack('bottom', { 'zh-Hans': { ItemName: { Ruby: '下', Wood: '下' }, ItemTooltip: { X: 'y' } }, 'en-US': { ItemName: { Ruby: 'up' } } })
    const merged = mergePacks([top, bottom], 'zh-Hans')
    expect(merged?.ItemName).toEqual({ Ruby: '上', Sapphire: '上', Wood: '下' })
    expect(merged?.ItemTooltip).toEqual({ X: 'y' })
    expect(mergePacks([top], 'en-US')).toBeUndefined()
  })
})
