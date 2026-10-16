import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ItemIcon } from '@/components/ItemIcon'
import type { Atlas, Item } from '@/types'

/** 只关心尺寸，贴图内容无所谓（jsdom 里 canvas 不真正绘制，但 DOM/样式会渲染）。 */
const atlas: Atlas = {
  meta: {
    gameVersion: '1.4.5.8',
    width: 1024,
    height: 4584,
    limitWidth: 1024,
    padding: 0,
    textures: 3,
    items: 3,
    sheet: 'items-atlas.png',
    generatedBy: 'test',
    note: '',
  },
  regions: {
    // 铜币 12×12、木剑 32×32、天顶剑 56×56（真实贴图尺寸）
    '71': [0, 0, 12, 12],
    '24': [16, 0, 32, 32],
    '4956': [64, 0, 56, 56],
  },
}

function item(id: number, icon: number, sprite: [number, number]): Item {
  return { id, key: `k${id}`, name: `i${id}`, icon, frames: 1, sprite, tags: [] }
}
const COIN = item(71, 71, [12, 12])
const SWORD = item(24, 24, [32, 32])
const ZENITH = item(4956, 4956, [56, 56])

/** 取数量徽标（唯一一个带数字的 span）。 */
function badge(): HTMLElement {
  const el = screen.getByText('99')
  return el as HTMLElement
}

describe('ItemIcon 数量徽标', () => {
  it('stack ≤ 1 时不渲染徽标', () => {
    const { rerender } = render(<ItemIcon item={COIN} atlas={atlas} stack={1} tooltip={false} />)
    expect(screen.queryByText('1')).toBeNull()
    rerender(<ItemIcon item={COIN} atlas={atlas} tooltip={false} />)
    expect(screen.queryByText('1')).toBeNull()
  })

  it('可悬停看提示时给手形指针；关掉 tooltip 或无物品时不给', () => {
    const { container, rerender } = render(<ItemIcon item={COIN} atlas={atlas} />)
    const wrap = () => container.firstElementChild as HTMLElement
    expect(wrap().className).toContain('cursor-pointer')

    rerender(<ItemIcon item={COIN} atlas={atlas} tooltip={false} />)
    expect(wrap().className).not.toContain('cursor-pointer')

    // 未知物品（item 缺失）不弹提示 → 不给手形
    rerender(<ItemIcon item={undefined} atlas={atlas} />)
    expect(wrap().className).not.toContain('cursor-pointer')

    // 调用方可用 className 覆盖
    rerender(<ItemIcon item={COIN} atlas={atlas} className="cursor-default" />)
    expect(wrap().className).toContain('cursor-default')
    expect(wrap().className).not.toContain('cursor-pointer')
  })

  it('堆叠数量贴在方框右下角（不盖住居中的小图标）', () => {
    // 位置由 class 决定（right-0 bottom-0）；这里写成断言，防止以后被改成贴图标角而意外遮住小图标
    const { rerender } = render(
      <ItemIcon item={COIN} atlas={atlas} size={24} stack={99} tooltip={false} />,
    )
    expect(badge().className).toContain('right-0')
    expect(badge().className).toContain('bottom-0')
    expect(badge().style.right).toBe('')
    rerender(<ItemIcon item={ZENITH} atlas={atlas} size={24} stack={99} tooltip={false} />)
    expect(badge().className).toContain('right-0')
    expect(badge().className).toContain('bottom-0')
  })

  it('数量字号统一为 12px（不随图标大小变化），可用 maxStackSize 压低', () => {
    const { rerender } = render(
      <ItemIcon item={COIN} atlas={atlas} size={24} stack={99} tooltip={false} />,
    )
    expect(badge().style.fontSize).toBe('12px')

    // 与金币同样大小的图标在同一处显示相同的字号
    rerender(<ItemIcon item={SWORD} atlas={atlas} size={24} stack={99} tooltip={false} />)
    expect(badge().style.fontSize).toBe('12px')

    rerender(<ItemIcon item={COIN} atlas={atlas} size={44} stack={99} tooltip={false} />)
    expect(badge().style.fontSize).toBe('12px')

    // 大图标（天顶剑）也是 12px，不再放大
    rerender(<ItemIcon item={ZENITH} atlas={atlas} size={40} stack={99} tooltip={false} />)
    expect(badge().style.fontSize).toBe('12px')

    // 64×64 也是 12px
    rerender(<ItemIcon item={ZENITH} atlas={atlas} size={64} stack={99} tooltip={false} />)
    expect(badge().style.fontSize).toBe('12px')
  })

  it('描边模糊随字号缩放', () => {
    const { rerender } = render(
      <ItemIcon item={COIN} atlas={atlas} size={24} stack={99} tooltip={false} />,
    )
    expect(badge().style.textShadow).toContain('0 0 3px') // round(12 * 0.25)
    rerender(<ItemIcon item={ZENITH} atlas={atlas} size={40} stack={99} tooltip={false} />)
    expect(badge().style.textShadow).toContain('0 0 3px')
  })

  it('maxStackSize 是**上限**：可把统一字号再压低', () => {
    const { rerender } = render(
      <ItemIcon item={SWORD} atlas={atlas} size={24} stack={99} maxStackSize={11} tooltip={false} />,
    )
    expect(badge().style.fontSize).toBe('11px')
    rerender(
      <ItemIcon item={COIN} atlas={atlas} size={24} stack={99} maxStackSize={11} tooltip={false} />,
    )
    expect(badge().style.fontSize).toBe('11px')
    // 上限可以低过 12px（用户显式要求时以他为准）
    rerender(
      <ItemIcon item={COIN} atlas={atlas} size={24} stack={99} maxStackSize={8} tooltip={false} />,
    )
    expect(badge().style.fontSize).toBe('8px')
  })
})
