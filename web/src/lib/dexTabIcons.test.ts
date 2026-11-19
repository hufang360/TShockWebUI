// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dexTabIconUrl } from './dexTabIcons'

const dir = resolve(process.cwd(), '../data/dex-tab-icons')
const tabs = (
  JSON.parse(readFileSync(resolve(process.cwd(), '../data/item-groups.json'), 'utf8')) as {
    tabs: { id: string }[]
  }
).tabs

describe('dexTabIcons', () => {
  it('每个创意菜单页签都有对应图标，且没有多余文件', () => {
    const files = readdirSync(dir).filter((name) => name.endsWith('.png'))
    expect(files.sort()).toEqual(tabs.map((tab) => `${tab.id}.png`).sort())
  })

  it('图标是 30×30 的 PNG（与 Infinite_Icons.png 的单帧一致）', () => {
    for (const tab of tabs) {
      const png = readFileSync(resolve(dir, `${tab.id}.png`))
      expect([...png.subarray(1, 4)].map((b) => String.fromCharCode(b)).join('')).toBe('PNG')
      // IHDR 紧跟在 8 字节签名后面：宽 / 高各 4 字节大端
      expect(png.readUInt32BE(16)).toBe(30)
      expect(png.readUInt32BE(20)).toBe(30)
    }
  })

  it('URL 带 base（单容器根路径 / GitHub Pages 子路径都成立）', () => {
    expect(dexTabIconUrl('weapons')).toBe('/data/dex-tab-icons/weapons.png')
  })
})
