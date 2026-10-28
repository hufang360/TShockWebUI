import { describe, expect, it } from 'vitest'
import { splitFishArgs } from './fishArgs'

// 与插件 `RestApi.SplitRestArgs` 对齐：前端只用来数参数个数（决定购买按钮能不能点）。
describe('splitFishArgs', () => {
  it('按空白拆分，忽略多余空格', () => {
    expect(splitFishArgs('a  b\tc\n')).toEqual(['a', 'b', 'c'])
  })

  it('空串 / 纯空白 → 没有参数', () => {
    expect(splitFishArgs('')).toEqual([])
    expect(splitFishArgs('   ')).toEqual([])
  })

  it('双引号包住的空格算同一个参数', () => {
    expect(splitFishArgs('"我的 小屋"')).toEqual(['我的 小屋'])
    expect(splitFishArgs('"我的 小屋" 10')).toEqual(['我的 小屋', '10'])
  })

  it('引号本身不进入参数值', () => {
    expect(splitFishArgs('"egg"')).toEqual(['egg'])
    expect(splitFishArgs('a"b c"d')).toEqual(['ab cd'])
  })

  it('\\" 与 \\\\ 是转义，其它反斜杠原样保留', () => {
    expect(splitFishArgs('a\\"b')).toEqual(['a"b'])
    expect(splitFishArgs('a\\\\b')).toEqual(['a\\b'])
    expect(splitFishArgs('a\\nb')).toEqual(['a\\nb'])
  })

  it('末尾未闭合的引号也照样收进当前参数', () => {
    expect(splitFishArgs('"未闭合')).toEqual(['未闭合'])
  })
})
