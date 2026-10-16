import { useEffect, useRef } from 'react'
import { useItemTooltip } from '@/components/ItemTooltip'
import { loadAtlasImage } from '@/lib/atlas'
import { cn } from '@/lib/cn'
import { useItemStat } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'
import { iconContentSize, shouldSmooth, type IconScaleMode } from '@/lib/iconScale'
import type { Atlas, Item } from '@/types'

const BASE = import.meta.env.BASE_URL

interface ItemIconProps {
  item: Item | undefined
  atlas: Atlas | undefined
  /** CSS 像素尺寸（正方形方框，等价于游戏里「一个 32px 图标框的缩放」） */
  size?: number
  /**
   * 绘制模式，默认 `game`（与游戏一致）。
   * - `game`：长边 ≤32 的贴图 1:1（只缩不放），保留「金币小、武器大」的原生比例；
   *   等价于 `ItemSlot.DrawItem_GetColorAndScale`，见 `lib/iconScale.ts`。
   * - `fit`：contain 填满方框（旧行为），会抹平物品之间的大小差异。
   */
  mode?: IconScaleMode
  className?: string
  /** 无障碍名称；也是提示里显示的名称。**不使用原生 title 属性。** */
  name?: string
  /** 词缀显示名（如「传奇」）；有则在提示中名称前展示。 */
  prefix?: string | null
  /** 堆叠数量；>1 时在方框右下角显示数量（仿 Terraria）。 */
  stack?: number
  /** 数量字号上限（CSS px）；默认字号随**图标**实际大小缩放（9–18px），此值再封顶。 */
  maxStackSize?: number
  /** 悬停时显示富提示（图标 + 词缀 + 名称 + 数量）。默认开启；提示内部的图标会关闭以避免递归。 */
  tooltip?: boolean
}

/**
 * 按图集裁切表绘制物品第一帧（设计原则与约束 C10）。
 * 尺寸默认走 `game` 模式（只缩不放，等价于游戏的 `ItemSlot.DrawItem_GetColorAndScale`），
 * 保留物品之间的原生大小差异（金币小、武器大）；见 `lib/iconScale.ts` 与 `docs/功能-富文本解析.md` §6.1。
 * 找不到物品或 region 时绘制占位图，绝不抛错。
 * `stack > 1` 时在方框右下角叠加数量：**字号上限 18px，实际字号随图标大小缩放**（金币小、武器大），
 * 小图标旁边的数字不会像以前那样又大又远。为什么不把数字贴到图标角上：实测会盖掉 9px 的金币
 * （只剩 5/144 像素可见），方框角 + 小字号才是可用解。
 * 悬停时用 portal 弹出「图标 + 名称 + 数量」提示（portal 到 body，避免被结果面板的 overflow 容器裁切）。
 */
export function ItemIcon({
  item,
  atlas,
  size = 32,
  mode = 'game',
  className,
  name,
  prefix,
  stack,
  maxStackSize,
  tooltip = true,
}: ItemIconProps) {
  const { t } = useI18n()
  const stat = useItemStat(item?.id)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // 贴图区域（`null` 表示走占位图）。绘制区域 = 方框内等比居中后的实际尺寸。
  const region = atlas && item ? atlas.regions[String(item.icon)] : undefined
  const content = region
    ? iconContentSize(region[2], region[3], size, mode)
    : { width: size, height: size }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !atlas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // region / content 已在渲染期算好（依赖 item、atlas、size、mode，与下方 deps 一致）
    if (!region) {
      // 占位：暗色方框 + 问号
      ctx.fillStyle = '#27334a'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#64748b'
      ctx.font = `${Math.round(size * 0.6 * dpr)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('?', canvas.width / 2, canvas.height / 2)
      return
    }

    const [x, y, w, h] = region
    let cancelled = false
    loadAtlasImage(`${BASE}data/${atlas.meta.sheet}`)
      .then((img) => {
        if (cancelled) return
        // 等比放入 size×size 的方框并居中；尺寸规则见 lib/iconScale.ts（game 模式与游戏一致，只缩不放）
        const { width: cssW, height: cssH } = content
        // 四舍五入到设备像素整数：让同一图标在不同容器里落点一致（避免半像素相位差），与采样方式无关
        const dw = Math.round(cssW * dpr)
        const dh = Math.round(cssH * dpr)
        const dx = Math.round((canvas.width - dw) / 2)
        const dy = Math.round((canvas.height - dh) / 2)
        // 采样方式见 lib/iconScale.ts 的 shouldSmooth：缩小插值（同游戏 LinearClamp）、放大最近邻
        // （整数倍放大用插值会发糊，且贴图透明边缘会渗出 1px 虚边）
        ctx.imageSmoothingEnabled = shouldSmooth(w, cssW)
        ctx.drawImage(img, x, y, w, h, dx, dy, dw, dh)
      })
      .catch(() => {
        /* 图集缺失时保持占位（已在上面绘制） */
      })
    return () => {
      cancelled = true
    }
    // region / content 由 item、atlas、size、mode 派生（每次渲染都是新对象，不能进依赖）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, atlas, size, mode])

  const showStack = stack != null && stack > 1
  // 数量字号**统一为 12px**，不再随图标大小变化：同一处（同一方框尺寸）的数字大小一致，
  // 不会出现「金币 9px、大图标 18px」那样一排里大小参差。
  // 方框越大越明显的问题消失；调用方仍可用 `maxStackSize` 压低（如聊天里的 [i:..] 用 11px）。
  const stackFontSize = Math.min(12, maxStackSize ?? 12)
  // 描边/模糊也随字号缩放：固定 3px 模糊在 9px 小字号上会成一团黑，盖住小图标。
  const stackBlur = Math.max(1, Math.round(stackFontSize * 0.25))
  // 提示：整块样式与定位逻辑统一在 useItemTooltip（其它组件也用同一套）
  const canTip = tooltip && !!item
  const {
    ref: tooltipRef,
    props: tooltipProps,
    node: tooltipNode,
  } = useItemTooltip<HTMLSpanElement>({
    item,
    atlas,
    stat,
    prefix,
    stack,
    name,
    disabled: !canTip,
  })

  return (
    <span
      // 可悬停看提示的图标给手形指针，让“可交互”可被看到；className 放在最后以便调用方覆盖。
      className={cn(
        'relative inline-block shrink-0 align-middle',
        canTip && 'cursor-pointer',
        className,
      )}
      style={{ width: size, height: size }}
      ref={tooltipRef}
      {...tooltipProps}
    >
      {/* 不用 `image-rendering: pixelated`：游戏在同尺寸下也是双线性（LinearClamp），
          最近邻会把边缘变成硬像素点；canvas 后备存储与 CSS 尺寸之比通常是 1 或 2，插值影响很小。 */}
      <canvas
        ref={canvasRef}
        className="block"
        style={{ width: size, height: size }}
        role="img"
        aria-label={name ?? (item ? item.name : t('tag.unknown', { id: '?' }))}
      />
      {showStack && (
        <span
          className="pointer-events-none absolute right-0 bottom-0 font-pixel font-bold leading-none text-white"
          style={{
            fontSize: stackFontSize,
            // 四向描边 + 模糊，保证在亮色贴图上也能看清；模糊量随字号缩放（固定 3px 在 9px 小字号上会糊成一团）
            textShadow: `0 0 ${stackBlur}px #000, 0 0 ${stackBlur}px #000, 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000`,
          }}
        >
          {stack}
        </span>
      )}
      {tooltipNode}
    </span>
  )
}
