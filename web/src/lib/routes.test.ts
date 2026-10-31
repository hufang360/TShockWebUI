import { describe, expect, it } from 'vitest'
import { readTabFromHash, tabHash } from '@/lib/routes'
import type { CustomModule } from '@/lib/customModules'

function withHash(hash: string) {
  window.history.replaceState(null, '', hash)
}

const clip: CustomModule = {
  id: 'm:11111111-1111-1111-1111-111111111111',
  name: '图格剪贴板',
  command: '/clip',
  desc: '',
}
const chest: CustomModule = {
  id: 'm:22222222-2222-2222-2222-222222222222',
  name: '箱子小工具',
  command: 'chest',
  desc: '',
}
const mods = [clip, chest]

describe('routes', () => {
  it('内置页面使用短名 hash', () => {
    expect(tabHash('editor')).toBe('#/cmd')
    expect(tabHash('chat')).toBe('#/chat')
    expect(tabHash('save')).toBe('#/plr')
    expect(tabHash('players')).toBe('#/pm')
    expect(tabHash('world')).toBe('#/wm')
    expect(tabHash('store')).toBe('#/fish')
    expect(tabHash('items')).toBe('#/items')
    expect(tabHash('dataid')).toBe('#/dataid')
    expect(tabHash('spritesheet')).toBe('#/slice')
    expect(tabHash('settings')).toBe('#/settings')
  })

  it('自定义模块用「主指令」派生的 ext- 路由', () => {
    expect(tabHash(clip.id, mods)).toBe('#/ext-clip')
    expect(tabHash(chest.id, mods)).toBe('#/ext-chest')
  })

  it('短名 / ext 路由能解析回 tab', () => {
    withHash('#/chat')
    expect(readTabFromHash([])).toBe('chat')
    withHash('#/plr')
    expect(readTabFromHash([])).toBe('save')
    withHash('#/pm')
    expect(readTabFromHash([])).toBe('players')
    withHash('#/wm')
    expect(readTabFromHash([])).toBe('world')
    withHash('#/fish')
    expect(readTabFromHash([])).toBe('store')
    withHash('#/slice')
    expect(readTabFromHash([])).toBe('spritesheet')
    withHash('#/ext-clip')
    expect(readTabFromHash(mods)).toBe(clip.id)
    withHash('#/ext-chest')
    expect(readTabFromHash(mods)).toBe(chest.id)
  })

  it('旧地址继续兼容', () => {
    withHash('#/save')
    expect(readTabFromHash([])).toBe('save')
    withHash('#/players')
    expect(readTabFromHash([])).toBe('players')
    withHash('#/world')
    expect(readTabFromHash([])).toBe('world')
    withHash('#/store')
    expect(readTabFromHash([])).toBe('store')
    withHash('#/commands')
    expect(readTabFromHash([])).toBe('commands')
    withHash('#/spawn')
    expect(readTabFromHash([])).toBe('commands')
    withHash(`#/${encodeURIComponent(clip.id)}`)
    expect(readTabFromHash(mods)).toBe(clip.id)
  })

  it('无法识别的 ext- 路由返回 null', () => {
    withHash('#/ext-nope')
    expect(readTabFromHash(mods)).toBeNull()
  })
})
