import { useEffect, useRef, useState } from 'react'
import { ZoomIn } from 'lucide-react'
import { CollapseChevron } from '@/components/CollapseChevron'
import { ItemIcon } from '@/components/ItemIcon'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogTitle,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { useDataset } from '@/lib/datasetContext'
import { cn } from '@/lib/cn'

/** 标题前的图标：Terraria 物品 **3061**（渔夫的建造笔记），比一个通用图片图标更像「图纸」。 */
const TITLE_ICON_ID = 3061

/** 放大弹框里可选的倍率（`1/2` 用来看全局，`3×` 用来看格子数）；默认 1:1（图片原生像素）。 */
const ZOOM_LEVELS = [
  { value: '0.5', label: '1/2' },
  { value: '1', label: '1:1' },
  { value: '2', label: '2×' },
  { value: '3', label: '3×' },
] as const

type ZoomScale = (typeof ZOOM_LEVELS)[number]['value']

/**
 * 鱼店「建筑预览」：建造类商品（鱼池 / 小房间 / 钓棚 / 刷怪场）在详情最下面多出来的一张
 * **带格数标注的示意图**（`web/public/fishshop/diagram-*.png`：站哪个位置、往上/往下几格、左右误差多少）。
 *
 * - **标题样式**照抄物品详情的「合成」分区（现在是 `components/DetailSection.tsx`）：
 *   `text-sm font-medium` + 语义色标题 + 20px 物品图标（3061）+ 箭头同在触发器里；
 * - **只是预览**：图很小（高 ≤ 30vh、宽 ≤ 16rem），详细的看点击后的放大弹框；
 * - **居左**：图本身很窄，居中会离左侧属性文字很远；
 * - **可折叠**：不想看就收起来；
 * - **可放大**：点图 → `Dialog` 里按 `1/2 · 1:1 · 2× · 3×` 重绘。缩放一律**最近邻**（`pixelated`），
 *   格线和小字不会被插值糊掉。放大是**叠在 Sheet 上的一层 Dialog**：Radix 允许嵌套
 *   （只有最顶层可交互、Esc 只关最上层、点放大弹框不会关掉详情，有测试钉住）。
 */
export function GoodDiagram({
  src,
  name,
  className,
}: {
  /** 图片 URL（`lib/fishDiagram.ts` 的 `diagramUrl()`）。 */
  src: string
  /** 商品名，用于 alt。 */
  name: string
  className?: string
}) {
  const { t } = useI18n()
  const dataset = useDataset()
  const [open, setOpen] = useState(true)
  const [zoom, setZoom] = useState(false)
  const [scale, setScale] = useState<ZoomScale>('1')
  // 缩放要按**原始像素**算宽度（CSS 百分比算不出来）：加载完才知道真实宽度。
  // 没拿到之前按原尺寸显示（弹框里先出现图，再按倍率跳过去，不闪空白）。
  const [naturalWidth, setNaturalWidth] = useState(0)
  const zoomImgRef = useRef<HTMLImageElement>(null)
  const alt = t('fish.diagramAlt', { name })

  // 缩略图已经加载过同一张图时，放大弹框里的 `<img>` 可能**在读缓存时就把 load 跑完了**，
  // 那样 onLoad 就收不到。所以打开时再查一次 `complete`，否则倍率不生效。
  useEffect(() => {
    const el = zoomImgRef.current
    if (zoom && el?.complete && el.naturalWidth > 0) setNaturalWidth(el.naturalWidth)
  }, [zoom])

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('flex flex-col gap-1', className)}>
      <CollapsibleTrigger className="group/title flex w-full cursor-pointer items-center gap-2 text-sm font-medium">
        {/* 图标只是装饰（标题文字已经说清楚了）：对读屏隐藏，
            否则触发器的可访问名会变成「渔夫的建造笔记 建筑预览」。 */}
        <span aria-hidden className="flex shrink-0">
          <ItemIcon
            item={dataset?.itemsById.get(TITLE_ICON_ID)}
            atlas={dataset?.atlas}
            size={20}
            tooltip={false}
          />
        </span>
        <span className="truncate text-info">{t('fish.diagram')}</span>
        <CollapseChevron open={open} />
      </CollapsibleTrigger>

      <CollapsibleContent>
        {/* 居左（不 `mx-auto`）：`w-fit` 让按钮只包住图片本身，点哪里都是「放大」。 */}
        <button
          type="button"
          aria-label={t('fish.diagramZoom')}
          onClick={() => setZoom(true)}
          className="group/diagram relative block w-fit cursor-zoom-in rounded-control"
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            // 只是「预览」：高度不超过 30vh（原来 60vh 的一半）、宽度不超过 16rem，
            // 剩下的交给点击后的放大弹框。
            className="block h-auto max-h-[30vh] w-auto max-w-[min(100%,16rem)] rounded-control border"
          />
          {/* hover / 键盘聚焦才露出的放大角标（触屏常显）：图本身没有别的可点的地方。 */}
          <span className="pointer-events-none absolute right-1 bottom-1 grid size-6 place-items-center rounded-control bg-background/90 text-muted-foreground opacity-0 transition-opacity group-hover/diagram:opacity-100 group-focus-visible/diagram:opacity-100 touch-visible">
            <ZoomIn className="size-3.5" aria-hidden />
          </span>
        </button>
      </CollapsibleContent>

      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="w-auto max-w-[calc(100vw-2rem)] gap-2 p-2">
          {/* 标题行左边是名字、右边是倍率（关闭键在右上角，`pr-8` 让开它）。 */}
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle className="text-left text-xs font-medium text-muted-foreground">
              {t('fish.diagram')}
            </DialogTitle>
            <ToggleGroup
              type="single"
              size="sm"
              value={scale}
              onValueChange={(value) => value && setScale(value as ZoomScale)}
              aria-label={t('fish.diagramScale')}
              className="ml-auto"
            >
              {ZOOM_LEVELS.map((level) => (
                <ToggleGroupItem
                  key={level.value}
                  value={level.value}
                  size="sm"
                  className="px-2 tabular-nums"
                >
                  {level.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="max-h-[76dvh] overflow-auto overscroll-contain rounded-control">
            <img
              ref={zoomImgRef}
              src={src}
              alt={alt}
              draggable={false}
              onLoad={(event) => setNaturalWidth(event.currentTarget.naturalWidth)}
              className="block h-auto max-w-none"
              style={
                naturalWidth > 0
                  ? // 最近邻缩放：整倍数不糊，1/2 也保持硬边（不插值）
                    {
                      width: naturalWidth * Number(scale),
                      imageRendering: 'pixelated',
                    }
                  : undefined
              }
            />
          </div>
        </DialogContent>
      </Dialog>
    </Collapsible>
  )
}
