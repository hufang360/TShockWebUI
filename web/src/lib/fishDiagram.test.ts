// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { diagramKind, diagramUrl } from '@/lib/fishDiagram'
import type { FishGood } from '@/lib/tshock'

/** 只关心 `cmds` / `name`：其余字段与注解图无关。 */
const good = (cmds: string[] | undefined, name = '随便什么名字'): FishGood => ({
  serial: 1,
  name,
  buyMax: 1,
  needArgs: false,
  map: [],
  desc: '',
  cost: '',
  unlock: '',
  comment: '',
  cmds,
})

describe('fishDiagram（按 cmds 指令匹配）', () => {
  it('默认货架四条指令 → 四张图', () => {
    expect(diagramKind(good(['/igen room']))).toBe('room')
    expect(diagramKind(good(['/igen pond water']))).toBe('pond')
    expect(diagramKind(good(['/igen shed']))).toBe('shed')
    expect(diagramKind(good(['/wm backup', '/clip paste spawnerfarm foot']))).toBe('spawnerfarm')
  })

  it('鱼池的液体变体都算鱼池；不带液体参数也算', () => {
    expect(diagramKind(good(['/igen pond']))).toBe('pond')
    expect(diagramKind(good(['/igen pond lava']))).toBe('pond')
    expect(diagramKind(good(['/igen pond honey']))).toBe('pond')
    expect(diagramKind(good(['/igen pond shimmer']))).toBe('pond')
  })

  it('/wm 是 /igen 的另一个入口，也认', () => {
    expect(diagramKind(good(['/wm room']))).toBe('room')
    expect(diagramKind(good(['/wm pond water']))).toBe('pond')
    expect(diagramKind(good(['/wm shed']))).toBe('shed')
  })

  it('spawnerfarm 认关键字（paste / check 都算），且优先于其它词', () => {
    expect(diagramKind(good(['/clip paste spawnerfarm']))).toBe('spawnerfarm')
    expect(diagramKind(good(['/clip check spawnerfarm']))).toBe('spawnerfarm')
    // 组合指令里既粘贴刷怪场、又建池子：按关键字先判成刷怪场
    expect(diagramKind(good(['/igen pond water', '/clip paste spawnerfarm foot']))).toBe('spawnerfarm')
  })

  it('不看商品名：名字叫「鱼池」但指令是 /igen room 就是小房间', () => {
    expect(diagramKind(good(['/igen room'], '鱼池'))).toBe('room')
    // 反过来：名字随便起，只要指令对就出图
    expect(diagramKind(good(['/igen pond water'], '挖个坑'))).toBe('pond')
  })

  it('子指令要整词匹配，不会被相似写法骗到', () => {
    // `/igen roomy` / `/igen rooms` 不是 /igen room
    expect(diagramKind(good(['/igen roomy']))).toBeNull()
    expect(diagramKind(good(['/igen rooms 3']))).toBeNull()
    // 没有前导斜杠的不算指令
    expect(diagramKind(good(['igen room']))).toBeNull()
    // 其它子指令不算
    expect(diagramKind(good(['/igen wipe']))).toBeNull()
    expect(diagramKind(good(['/igen check pond']))).toBeNull()
  })

  it('没有 cmds（原版物品 / 旧插件）就不出图', () => {
    expect(diagramKind(good(undefined))).toBeNull()
    expect(diagramKind(good([]))).toBeNull()
    expect(diagramKind(null)).toBeNull()
  })

  it('返回随前端发布的静态资源路径（base = /）', () => {
    expect(diagramUrl(good(['/igen pond water']))).toBe('/fishshop/diagram-pond.png')
    expect(diagramUrl(good(['/igen room']))).toBe('/fishshop/diagram-room.png')
    expect(diagramUrl(good(['/igen shed']))).toBe('/fishshop/diagram-shed.png')
    expect(diagramUrl(good(['/clip paste spawnerfarm foot']))).toBe(
      '/fishshop/diagram-spawnerfarm.png',
    )
    expect(diagramUrl(good(['/time day']))).toBeNull()
    expect(diagramUrl(null)).toBeNull()
  })
})
