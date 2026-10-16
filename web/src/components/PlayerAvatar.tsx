import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { loadPlayerAtlas, loadPlayerAtlasImage } from '@/lib/playerAtlas'
import { buildPlayerDrawOps, resolveOps, type PlayerDrawOp } from '@/lib/playerRender'
import type { PlayerLook } from '@/lib/tshock'
import type { PlayerAtlas } from '@/types'

const FRAME_W = 40
const FRAME_H = 56

interface PlayerAvatarProps {
  look: PlayerLook
  /** 放大倍数（整数倍最近邻），默认 3（120×168 CSS px）。 */
  scale?: number
  /** 由外层容器决定显示尺寸（画布保持 40:56 比例）；用于侧栏小头像等场景。 */
  fill?: boolean
  className?: string
}

/**
 * 玩家角色全身图（创建角色界面那种预览）：只画皮肤 / 衣服 / 头发。
 *
 * 数据来自 `PlayerLook` 的外观字段（`/pm/look`），贴图来自 `data/player-atlas.*`
 * （懒加载，仅在渲染本组件时拉取）。合成层级/帧见 `lib/playerRender.ts`；
 * 灰色遮罩按玩家颜色相乘着色（等价游戏的 `spriteBatch` 颜色调制）。
 * 不含盔甲与饰品，也不依赖 `.plr` 导出。
 */
export function PlayerAvatar({ look, scale = 3, fill = false, className }: PlayerAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [atlas, setAtlas] = useState<PlayerAtlas | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadPlayerAtlas()
      .then((loaded) => {
        if (!cancelled) setAtlas(loaded)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !atlas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = FRAME_W * scale
    canvas.height = FRAME_H * scale

    const ops = resolveOps(buildPlayerDrawOps(look), atlas)
    // 逐层着色的临时画布（40×56，原尺寸）。
    const off = document.createElement('canvas')
    off.width = FRAME_W
    off.height = FRAME_H
    const octx = off.getContext('2d')

    let cancelled = false
    loadPlayerAtlasImage(atlas)
      .then((img) => {
        if (cancelled) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.imageSmoothingEnabled = false
        if (!octx) return
        for (const op of ops) drawOp(ctx, octx, img, atlas, op)
      })
      .catch(() => {
        /* 图集缺失：保留空白，不抛错 */
      })
    return () => {
      cancelled = true
    }
  }, [atlas, look, scale])

  if (failed) return null

  return (
    <canvas
      ref={canvasRef}
      className={cn('block', fill && 'h-full w-auto', className)}
      style={fill ? undefined : { width: FRAME_W * scale, height: FRAME_H * scale }}
      role="img"
      aria-label={look.name}
    />
  )
}

/**
 * 把图集里的一帧着上颜色后贴到主画布。
 *
 * 着色用 `multiply`（灰阶 × 颜色）再 `destination-in` 恢复原 alpha：
 * 等价游戏的「灰度遮罩 × 颜色调制」，且不会让透明区变成实心色块。
 * `color[3]` 通过主画布 `globalAlpha` 相乘（游戏颜色的 A 通道）。
 */
function drawOp(
  ctx: CanvasRenderingContext2D,
  octx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  atlas: PlayerAtlas,
  op: PlayerDrawOp,
) {
  const rect = atlas.regions[op.region]
  if (!rect) return
  const [x, y] = rect
  const sh = Math.min(op.srcHeight, FRAME_H)
  const [r, g, b, a] = op.color

  octx.clearRect(0, 0, FRAME_W, FRAME_H)
  octx.globalCompositeOperation = 'source-over'
  octx.drawImage(img, x, y, FRAME_W, sh, 0, 0, FRAME_W, sh)
  octx.globalCompositeOperation = 'multiply'
  octx.fillStyle = `rgb(${r}, ${g}, ${b})`
  octx.fillRect(0, 0, FRAME_W, FRAME_H)
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(img, x, y, FRAME_W, sh, 0, 0, FRAME_W, sh)
  octx.globalCompositeOperation = 'source-over'

  ctx.globalAlpha = a / 255
  ctx.drawImage(octx.canvas, 0, 0, FRAME_W, FRAME_H, 0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.globalAlpha = 1
}
