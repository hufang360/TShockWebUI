import { describe, expect, it } from 'vitest'
import { formatItemTag, parseItemTags, searchItems, wikiUrl } from './items'
import { testItems } from '@/test/fixtures'

describe('searchItems', () => {
  it('按 ID 精确匹配优先', () => {
    const results = searchItems(testItems, '29')
    expect(results[0]?.id).toBe(29)
  })

  it('按中文名搜索', () => {
    expect(searchItems(testItems, '生命')[0]?.id).toBe(29)
  })

  it('按英文名搜索（忽略大小写）', () => {
    expect(searchItems(testItems, 'zenith')[0]?.id).toBe(4956)
  })

  it('按内部名搜索', () => {
    expect(searchItems(testItems, 'FallenStar')[0]?.id).toBe(75)
  })

  it('空查询返回空数组', () => {
    expect(searchItems(testItems, '   ')).toEqual([])
  })

  it('无匹配返回空数组', () => {
    expect(searchItems(testItems, '不存在的物品xyz')).toEqual([])
  })
})

describe('parseItemTags', () => {
  it('解析基础标签', () => {
    const [tag] = parseItemTags('生命水晶 [i:29]')
    expect(tag?.itemId).toBe(29)
    expect(tag?.stack).toBeUndefined()
    expect(tag?.prefixId).toBeUndefined()
  })

  it('解析数量与词缀', () => {
    const [tag] = parseItemTags('[i/s21/p81:4956]')
    expect(tag).toMatchObject({ itemId: 4956, stack: 21, prefixId: 81 })
  })

  it('解析逗号版本（游戏生成格式）', () => {
    const [tag] = parseItemTags('[i/p81,s21:4956]')
    expect(tag).toMatchObject({ itemId: 4956, stack: 21, prefixId: 81 })
  })

  it('解析多个标签并给出位置', () => {
    const tags = parseItemTags('[i:29] 和 [i/s10:75]')
    expect(tags).toHaveLength(2)
    expect(tags[0]?.start).toBe(0)
    expect(tags[1]?.itemId).toBe(75)
  })

  it('无效格式不解析', () => {
    expect(parseItemTags('[i:abc]')).toEqual([])
    expect(parseItemTags('普通文本')).toEqual([])
  })
})

describe('formatItemTag', () => {
  it('无修饰符', () => {
    expect(formatItemTag(29)).toBe('[i:29]')
  })
  it('数量与词缀', () => {
    expect(formatItemTag(4956, { stack: 21, prefixId: 81 })).toBe('[i/p81/s21:4956]')
  })
  it('数量为 1 时省略', () => {
    expect(formatItemTag(29, { stack: 1 })).toBe('[i:29]')
  })
})

describe('wikiUrl', () => {
  it('中文走 /zh/wiki/<当前语言物品名>（URL 编码）', () => {
    expect(wikiUrl('铁镐', 'zh')).toBe('https://terraria.wiki.gg/zh/wiki/%E9%93%81%E9%95%90')
    expect(wikiUrl('八音盒（Boss 1）', 'zh')).toBe(
      'https://terraria.wiki.gg/zh/wiki/%E5%85%AB%E9%9F%B3%E7%9B%92%EF%BC%88Boss%201%EF%BC%89',
    )
  })

  it('英文走 /wiki/<英文名，空格转下划线>', () => {
    expect(wikiUrl('Iron Pickaxe', 'en')).toBe('https://terraria.wiki.gg/wiki/Iron_Pickaxe')
    expect(wikiUrl('Zenith', 'en')).toBe('https://terraria.wiki.gg/wiki/Zenith')
    // 括号类名字与 wiki 标题一致（实测 200）
    expect(wikiUrl('Music Box (Boss 1)', 'en')).toBe(
      'https://terraria.wiki.gg/wiki/Music_Box_(Boss_1)',
    )
  })

  it('默认语言是中文，并去除首尾空格', () => {
    expect(wikiUrl('铁镐')).toBe(wikiUrl('铁镐', 'zh'))
    expect(wikiUrl('  Zenith ', 'en')).toBe('https://terraria.wiki.gg/wiki/Zenith')
  })
})

