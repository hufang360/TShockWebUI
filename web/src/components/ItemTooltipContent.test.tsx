import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { ItemDetailProvider } from '@/lib/itemDetailContext'
import { ItemFavoritesProvider, ItemFavoritesStoreProvider } from '@/lib/itemFavoritesContext'
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

  it('提供收藏上下文时右上角显示 ⭐，点击触发 toggle；收藏中时 aria-pressed', () => {
    const toggle = vi.fn()
    const { rerender } = render(
      <I18nProvider lang="zh">
        <ItemFavoritesProvider api={{ isFavorited: () => false, toggle }}>
          <ItemTooltipContent item={item} stat={{ tip: ['190近战伤害'] }} />
        </ItemFavoritesProvider>
      </I18nProvider>,
    )
    const star = screen.getByRole('button', { name: '收藏物品' })
    expect(star.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(star)
    expect(toggle).toHaveBeenCalledWith(4956)

    rerender(
      <I18nProvider lang="zh">
        <ItemFavoritesProvider api={{ isFavorited: () => true, toggle }}>
          <ItemTooltipContent item={item} stat={{ tip: ['190近战伤害'] }} />
        </ItemFavoritesProvider>
      </I18nProvider>,
    )
    expect(screen.getByRole('button', { name: '取消收藏' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('全局收藏 Provider：写本机 tswui:itemFavorites，再点一次取消（未登录任何页面也能收藏）', () => {
    localStorage.clear()
    render(
      <I18nProvider lang="zh">
        <ItemFavoritesStoreProvider>
          <ItemTooltipContent item={item} />
        </ItemFavoritesStoreProvider>
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '收藏物品' }))
    expect(
      JSON.parse(localStorage.getItem('tswui:itemFavorites') ?? '[]').map(
        (f: { id: number }) => f.id,
      ),
    ).toEqual([4956])

    fireEvent.click(screen.getByRole('button', { name: '取消收藏' }))
    expect(JSON.parse(localStorage.getItem('tswui:itemFavorites') ?? '[]')).toEqual([])
  })

  it('含玩家加成会重算的属性行（伤害/蓝耗）时，补一句「基础值」说明', () => {
    const { rerender } = render(
      <I18nProvider lang="zh">
        <ItemTooltipContent
          item={item}
          stat={{ tip: ['190近战伤害', '14%暴击率'], stats: { damage: 190, melee: true } }}
        />
      </I18nProvider>,
    )
    expect(screen.getByText('基础值 · 不含角色属性加成')).toBeTruthy()

    // 没有玩家加成相关的物品（如火把）不显示，避免噪音。
    rerender(
      <I18nProvider lang="zh">
        <ItemTooltipContent item={item} stat={{ tip: ['可放置'], stats: { material: true } }} />
      </I18nProvider>,
    )
    expect(screen.queryByText('基础值 · 不含角色属性加成')).toBeNull()
  })

  it('饰品词缀：显示精确效果行（玩家 Player.GrantPrefixBenefits）', () => {
    const { rerender } = render(
      <I18nProvider lang="zh">
        <ItemTooltipContent
          item={item}
          prefix="险恶"
          prefixMods={{ benefit: { key: 'damage', value: 4 } }}
          stat={{ tip: ['可装备'], stats: { accessory: true } }}
        />
      </I18nProvider>,
    )
    expect(screen.getByText('+4%伤害')).toBeTruthy()

    rerender(
      <I18nProvider lang="zh">
        <ItemTooltipContent
          item={item}
          prefix="奥秘"
          prefixMods={{ benefit: { key: 'mana', value: 20 } }}
          stat={{ tip: ['可装备'], stats: { accessory: true } }}
        />
      </I18nProvider>,
    )
    expect(screen.getByText('+20 魔力')).toBeTruthy()
  })

  it('词缀修正：伤害 / 暴击 / 速度 / 击退随词缀变化', () => {
    render(
      <I18nProvider lang="zh">
        <ItemTooltipContent
          item={item}
          prefix="传奇"
          prefixMods={{ dmg: 1.15, crt: 5, spd: 0.8, kb: 1.5 }}
          stat={{
            tip: ['100近战伤害', '4%暴击率', '普通速度', '较弱击退力'],
            stats: { damage: 100, crit: 0, useAnimation: 30, knockBack: 3.2, melee: true },
          }}
        />
      </I18nProvider>,
    )
    expect(screen.getByText('115近战伤害')).toBeTruthy()
    expect(screen.getByText('9%暴击率')).toBeTruthy()
    expect(screen.getByText('快速度')).toBeTruthy() // 30 × 0.8 = 24 → 快速度
    expect(screen.getByText('普通击退力')).toBeTruthy() // 3.2 × 1.5 = 4.8 → 普通击退力
  })
  it('物品提示底部「ID · key」一行带「合成表」入口：有 Provider 时点击打开详情', () => {
    const open = vi.fn()
    render(
      <I18nProvider lang="zh">
        <ItemDetailProvider api={{ open }}>
          <ItemTooltipContent item={item} stat={{ tip: ['190近战伤害'] }} />
        </ItemDetailProvider>
      </I18nProvider>,
    )
    const button = screen.getByRole('button', { name: '合成表' })
    fireEvent.click(button)
    expect(open).toHaveBeenCalledWith(4956)
  })

  it('没有 ItemDetailProvider 时不渲染「合成表」入口', () => {
    render(
      <I18nProvider lang="zh">
        <ItemTooltipContent item={item} stat={{ tip: ['190近战伤害'] }} />
      </I18nProvider>,
    )
    expect(screen.queryByRole('button', { name: '合成表' })).toBeNull()
  })

  it('详情面板（variant=panel）也带「合成表」入口', () => {
    const open = vi.fn()
    render(
      <I18nProvider lang="zh">
        <ItemDetailProvider api={{ open }}>
          <ItemTooltipContent item={item} variant="panel" />
        </ItemDetailProvider>
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '合成表' }))
    expect(open).toHaveBeenCalledWith(4956)
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
