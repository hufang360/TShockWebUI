import { describe, expect, it } from 'vitest'
import { hasRichTags, parseRichText } from './richtext'

describe('parseRichText', () => {
  it('纯文本原样返回', () => {
    expect(parseRichText('当前时间是20:00。')).toEqual([
      { kind: 'text', text: '当前时间是20:00。' },
    ])
  })

  it('解析颜色标签 [c/RRGGBB:text]', () => {
    expect(parseRichText('在线的玩家([c/AAFFAA:1]/8)')).toEqual([
      { kind: 'text', text: '在线的玩家(' },
      { kind: 'color', color: '#AAFFAA', text: '1' },
      { kind: 'text', text: '/8)' },
    ])
  })

  it('支持 3 位缩写色值与大小写', () => {
    expect(parseRichText('[c/f0a:x]')).toEqual([{ kind: 'color', color: '#FF00AA', text: 'x' }])
  })

  it('解析物品标签 [i:ID] / [i/sN/pN:ID]', () => {
    expect(parseRichText('[i:29]')).toEqual([
      { kind: 'item', raw: '[i:29]', itemId: 29, stack: undefined, prefixId: undefined },
    ])
    expect(parseRichText('[i/s21/p81:4956]')).toEqual([
      { kind: 'item', raw: '[i/s21/p81:4956]', itemId: 4956, stack: 21, prefixId: 81 },
    ])
  })

  it('颜色与物品混排', () => {
    expect(parseRichText('获得 [c/55D284:[i:29]]')).toEqual([
      { kind: 'text', text: '获得 ' },
      { kind: 'color', color: '#55D284', text: '[i:29' },
      { kind: 'text', text: ']' },
    ])
  })

  it('非法颜色值按内部文本处理', () => {
    expect(parseRichText('[c/ZZZZZZ:x]')).toEqual([{ kind: 'text', text: 'x' }])
  })

  it('未知标签丢弃外壳只留文本（与 Terraria 一致）', () => {
    expect(parseRichText('[g/1:icon]')).toEqual([{ kind: 'text', text: 'icon' }])
  })

  it('转义 \\] 还原为 ]', () => {
    expect(parseRichText('[c/FFFFFF:a\\]b]')).toEqual([
      { kind: 'color', color: '#FFFFFF', text: 'a]b' },
    ])
  })

  it('反斜杠转义的标签不被解析', () => {
    expect(parseRichText('\\[c/AAFFAA:1]')).toEqual([{ kind: 'text', text: '\\[c/AAFFAA:1]' }])
  })

  it('hasRichTags 判断', () => {
    expect(hasRichTags('[c/AAFFAA:1]')).toBe(true)
    expect(hasRichTags('普通文本')).toBe(false)
  })
})
