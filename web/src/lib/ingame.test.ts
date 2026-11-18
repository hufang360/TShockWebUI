// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  commandToken,
  ingameAllows,
  ingameAllowsCommand,
  ingameDenial,
  ingameDenialOfCommand,
  ingamePolicyFrom,
  NO_INGAME,
  type IngamePolicy,
} from './ingame'
import type { CommandDef } from '@/types'

function def(partial: Partial<CommandDef>): CommandDef {
  return { name: 'spawnboss', aliases: ['sb'], help: '', allowServer: false, ...partial } as CommandDef
}

describe('ingameAllows', () => {
  it('未开启时一律不放行（名单写什么都不算）', () => {
    expect(ingameAllows(NO_INGAME, ['spawnboss'])).toBe(false)
    expect(ingameAllows({ enabled: false, commands: ['spawnboss'] }, ['spawnboss'])).toBe(false)
  })

  it('名单为空 = 不限定', () => {
    expect(ingameAllows({ enabled: true, commands: [] }, ['nothing'])).toBe(true)
  })

  it('按名字匹配，大小写不敏感', () => {
    expect(ingameAllows({ enabled: true, commands: ['spawnboss'] }, [undefined, 'SpawnBoss'])).toBe(true)
    expect(ingameAllows({ enabled: true, commands: ['spawnboss'] }, ['spawnmob'])).toBe(false)
  })
})

describe('commandToken', () => {
  it('取出首个 token，去前导斜杠、转小写', () => {
    expect(commandToken('/spawnboss "king slime"')).toBe('spawnboss')
    expect(commandToken('  /SB  eye')).toBe('sb')
    expect(commandToken('')).toBe('')
  })
})

describe('ingameAllowsCommand', () => {
  const policy: IngamePolicy = { enabled: true, commands: ['spawnboss', 'spawnmob'] }

  it('输入是别名也放行（数据里的规范名 / 别名都算）', () => {
    expect(ingameAllowsCommand(policy, '/sb eye', def({}))).toBe(true)
    expect(ingameAllowsCommand(policy, '/spawnmob 4', def({ name: 'spawnmob', aliases: ['sm'] }))).toBe(true)
  })

  it('不在名单里的指令不放行', () => {
    expect(ingameAllowsCommand(policy, '/tp 100 200', def({ name: 'tp', aliases: ['t'] }))).toBe(false)
  })

  it('未知指令只能用输入的 token 比对（插件指令没有本地定义）', () => {
    expect(ingameAllowsCommand({ enabled: true, commands: ['wm'] }, '/wm find 生命')).toBe(true)
    expect(ingameAllowsCommand(policy, '/wm find 生命')).toBe(false)
  })
})

describe('ingameDenial（说清是哪一环没开）', () => {
  const on: IngamePolicy = { enabled: true, commands: [], plugin: true, reachable: true }

  it('可达性 / 插件 / 总闸 / 名单，四种原因分得开', () => {
    expect(ingameDenial({ ...on, reachable: false }, ['spawnboss'])).toBe('unreachable')
    expect(ingameDenial({ ...on, plugin: false, enabled: false }, ['spawnboss'])).toBe('no_plugin')
    expect(ingameDenial({ ...on, enabled: false }, ['spawnboss'])).toBe('disabled')
    expect(ingameDenial({ ...on, commands: ['spawnmob'] }, ['spawnboss'])).toBe('not_in_list')
    expect(ingameDenial(on, ['spawnboss'])).toBeNull()
  })

  it('插件没装优先于总闸：此时「没开 TSWUI_ALLOW_INGAME_COMMANDS」是误导', () => {
    expect(ingameDenial({ enabled: false, commands: [], plugin: false }, ['spawnboss'])).toBe(
      'no_plugin',
    )
  })

  it('ingameDenialOfCommand 走别名归一', () => {
    const policy: IngamePolicy = { enabled: true, commands: ['spawnboss'], plugin: true }
    expect(ingameDenialOfCommand(policy, '/sb eye', def({}))).toBeNull()
    expect(ingameDenialOfCommand(policy, '/sm 4', def({ name: 'spawnmob', aliases: ['sm'] }))).toBe(
      'not_in_list',
    )
  })
})

describe('ingamePolicyFrom', () => {
  it('缺数据 / 没装插件 / 总闸关都不放行，但原因不同', () => {
    expect(ingamePolicyFrom(null)).toMatchObject({ enabled: false, plugin: false })
    expect(ingamePolicyFrom({ plugin: true, ingame: false })).toMatchObject({
      enabled: false,
      plugin: true,
    })
    expect(ingamePolicyFrom({ plugin: false, ingame: true })).toMatchObject({
      enabled: false,
      plugin: false,
    })
  })

  it('插件在装 + 总闸开才算开启；上游不可达要照实记下来', () => {
    expect(ingamePolicyFrom({ plugin: true, ingame: true })).toMatchObject({ enabled: true })
    expect(ingamePolicyFrom({ plugin: true, ingame: true }, false)).toMatchObject({
      enabled: true,
      reachable: false,
    })
  })

  it('名单转小写以便比较；缺字段 = 不限定（空名单）', () => {
    expect(ingamePolicyFrom({ plugin: true, ingame: true }).commands).toEqual([])
    expect(
      ingamePolicyFrom({ plugin: true, ingame: true, ingameCommands: ['SpawnBoss'] }).commands,
    ).toEqual(['spawnboss'])
  })
})
