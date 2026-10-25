import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { PLAYER_FRAME_H, PLAYER_FRAME_W, drawPlayerAvatar } from '@/lib/playerAvatarDraw'
import { loadPlayerAtlas, loadPlayerAtlasImage } from '@/lib/playerAtlas'
import type { PlayerLook } from '@/lib/tshock'
import type { PlayerAtlas } from '@/types'

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
 * 数据来自 `PlayerLook` 的外观字段（`/pm/look` 或本地 .plr），贴图来自 `data/player-atlas.*`
 * （懒加载，仅在渲染本组件时拉取）。合成层级/帧见 `lib/playerRender.ts`，绘制见
 * `lib/playerAvatarDraw.ts`（「导出图片」用同一份实现）。不含盔甲与饰品。
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

    canvas.width = PLAYER_FRAME_W * scale
    canvas.height = PLAYER_FRAME_H * scale

    let cancelled = false
    loadPlayerAtlasImage(atlas)
      .then((img) => {
        if (cancelled) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        drawPlayerAvatar(ctx, { look, atlas, image: img, scale })
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
      className={cn('block bg-transparent', fill && 'h-full w-auto', className)}
      style={fill ? undefined : { width: PLAYER_FRAME_W * scale, height: PLAYER_FRAME_H * scale }}
      role="img"
      aria-label={look.name}
    />
  )
}
