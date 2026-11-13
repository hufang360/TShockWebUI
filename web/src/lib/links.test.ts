// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { LINK_GROUPS } from './links'

describe('常用链接', () => {
  const links = LINK_GROUPS.flatMap((group) => group.links)

  it('每条链接都有中英两份 https 地址与名称', () => {
    const bad = links.filter(
      (link) =>
        !link.href.zh.startsWith('https://') ||
        !link.href.en.startsWith('https://') ||
        !link.label.zh.trim() ||
        !link.label.en.trim(),
    )
    expect(bad).toEqual([])
  })

  it('id 唯一（用作 React key）', () => {
    const ids = links.map((link) => link.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('wiki 条目中英分别走 /zh/wiki/ 与 /wiki/', () => {
    const wikiGroup = LINK_GROUPS.find((group) => group.id === 'wiki')!
    expect(wikiGroup.links).toHaveLength(9)
    for (const link of wikiGroup.links) {
      expect(link.href.zh).toMatch(/^https:\/\/terraria\.wiki\.gg\/zh\/wiki\//)
      expect(link.href.en).toMatch(/^https:\/\/terraria\.wiki\.gg\/wiki\//)
    }
  })
})
