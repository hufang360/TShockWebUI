import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { rarityColor } from '@/lib/items'
import { ItemTooltipContent } from './ItemTooltipContent'

const item = {
  id: 4956,
  key: 'Zenith',
  name: '天顶剑',
  icon: 4956,
  frames: 1,
  sprite: [56, 56] as [number, number],
  tags: [],
}

describe('ItemTooltipContent', () => {
  it('渲染游戏同款属性行（按语言取 tip）', () => {
    render(
      <I18nProvider lang="zh">
        <ItemTooltipContent
          item={item}
          stat={{
            tip: ['190近战伤害', '14%暴击率'],
            stats: { rare: 10 },
          }}
        />
      </I18nProvider>,
    )
    expect(screen.getByTestId('item-tooltip')).toBeTruthy()
    expect(screen.getByText('天顶剑')).toBeTruthy()
    expect(screen.getByText('190近战伤害')).toBeTruthy()
    expect(screen.getByText('14%暴击率')).toBeTruthy()
  })

  it('无属性时至少显示名称行', () => {
    render(
      <I18nProvider lang="zh">
        <ItemTooltipContent item={item} />
      </I18nProvider>,
    )
    expect(screen.getByText('天顶剑')).toBeTruthy()
    expect(screen.queryByText('190近战伤害')).toBeNull()
  })

  it('统一样式：图标 28px、正文 15px、整块 font-medium、无模糊、左下角 ID · key', () => {
    render(
      <I18nProvider lang="zh">
        <ItemTooltipContent item={item} stat={{ tip: ['190近战伤害'], stats: { rare: 10 } }} />
      </I18nProvider>,
    )
    const box = screen.getByTestId('item-tooltip')
    expect(box.className).toContain('bg-black/85') // 半透明黑（比 70% 更实）
    expect(box.className).not.toContain('backdrop-blur') // 不加模糊
    expect(box.className).toContain('max-w-96') // 加宽（长描述）
    expect(box.className).toContain('font-medium')
    expect(box.className).toContain('text-[15px]')
    const canvas = box.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.style.width).toBe('28px')
    expect(screen.getByText('190近战伤害').parentElement?.className).toContain('text-sm leading-5')
    expect(within(box).getByText('4956 · Zenith')).toBeTruthy()
  })

})

describe('rarityColor', () => {
  it('按稀有度映射游戏颜色', () => {
    expect(rarityColor(0)).toBe('#FFFFFF')
    expect(rarityColor(1)).toBe('#9696FF')
    expect(rarityColor(10)).toBe('#FF2864')
    expect(rarityColor(11)).toBe('#B428FF')
  })
})
