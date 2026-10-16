import { describe, expect, it } from 'vitest'
import { inspectCommand, parseCommand } from './commands'
import { makeDataset } from '@/test/fixtures'

const dataset = makeDataset()

describe('parseCommand', () => {
  it('解析指令与参数', () => {
    const parsed = parseCommand('/time 12:00')
    expect(parsed).toMatchObject({ token: 'time', args: '12:00' })
  })
  it('兼容缺少前导斜杠', () => {
    expect(parseCommand('help')?.token).toBe('help')
  })
  it('多行只取第一行', () => {
    expect(parseCommand('hello\nworld')?.token).toBe('hello')
  })
  it('空输入返回 null', () => {
    expect(parseCommand('   ')).toBeNull()
  })
})

describe('inspectCommand（Tier A 策略）', () => {
  it('allowServer=true 的已知指令可执行', () => {
    const check = inspectCommand('/time 12:00', dataset)
    expect(check.executability).toBe('executable')
    expect(check.normalized).toBe('/time 12:00')
  })

  it('通过别名解析到同一指令', () => {
    expect(inspectCommand('/?', dataset).def?.name).toBe('help')
  })

  it('allowServer=false 的指令被判定为只能在游戏内执行', () => {
    const check = inspectCommand('/i 29', dataset)
    expect(check.executability).toBe('in_game_only')
    expect(check.def?.name).toBe('item')
  })

  it('未知指令仍可执行，交由 TShock 校验', () => {
    const check = inspectCommand('/nope', dataset)
    expect(check.executability).toBe('unverified')
    expect(check.def).toBeNull()
  })

  it('插件指令（不在白名单）也可执行', () => {
    expect(inspectCommand('/fish', dataset).executability).toBe('unverified')
  })

  it('多行输入给出提示', () => {
    expect(inspectCommand('/help\n/time', dataset).extraLines).toBe(true)
  })
})
