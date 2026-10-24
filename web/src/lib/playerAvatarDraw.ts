import { buildPlayerDrawOps, resolveOps } from '@/lib/playerRender'
import type { PlayerLook } from '@/lib/tshock'
import type { PlayerAtlas } from '@/types'

/**
 * 角色全身图（皮肤 / 衣服 / 头发）的**绘制实现**，供两处共用：
 * - `components/PlayerAvatar.tsx`：页面里的角色预览（canvas 组件）；
 * - `lib/playerShot.ts`：「导出图片」把同一个人物画进截图。
 *
 * 合成层级 / 帧来自 `lib/playerRender.ts`；这里负责「逐层着色后按整数倍放大贴到目标画布」。
 * 放大用最近邻（像素风），与 `ItemIcon` 的 `game` 模式同一策略。
 */

/** 角色贴图单帧尺寸（`PlayerDrawLayers` 的站立帧）。 */
export const PLAYER_FRAME_W = 40
export const PLAYER_FRAME_H = 56

export interface DrawPlayerAvatarOptions {
  look: PlayerLook
  atlas: PlayerAtlas
  /** 玩家图集 PNG（已通过 `loadPlayerAtlasImage` 校验） */
  image: CanvasImageSource
  /** 目标画布左上角（CSS px） */
  x?: number
  y?: number
  /** 放大倍数（整数，默认 3） */
  scale?: number
}

/**
 * 在 `ctx` 的 `(x, y)` 处画一个 `40×56 × scale` 的全身图。
 * 缺少某个部件 / 图集时跳过（不抛错），由调用方决定整体降级。
 */
export function drawPlayerAvatar(
  ctx: CanvasRenderingContext2D,
  { look, atlas, image, x = 0, y = 0, scale = 3 }: DrawPlayerAvatarOptions,
): void {
  const ops = resolveOps(buildPlayerDrawOps(look), atlas)
  // 逐层着色的临时画布（40×56 原尺寸），每层画一次、贴一次。
  const layer = document.createElement('canvas')
  layer.width = PLAYER_FRAME_W
  layer.height = PLAYER_FRAME_H
  const lctx = layer.getContext('2d')
  if (!lctx) return

  const prevSmoothing = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  for (const op of ops) {
    const rect = atlas.regions[op.region]
    if (!rect) continue
    const [sx, sy] = rect
    const sh = Math.min(op.srcHeight, PLAYER_FRAME_H)
    const [r, g, b, a] = op.color

    lctx.clearRect(0, 0, PLAYER_FRAME_W, PLAYER_FRAME_H)
    lctx.globalCompositeOperation = 'source-over'
    lctx.drawImage(image, sx, sy, PLAYER_FRAME_W, sh, 0, 0, PLAYER_FRAME_W, sh)
    lctx.globalCompositeOperation = 'multiply'
    lctx.fillStyle = `rgb(${r}, ${g}, ${b})`
    lctx.fillRect(0, 0, PLAYER_FRAME_W, PLAYER_FRAME_H)
    lctx.globalCompositeOperation = 'destination-in'
    lctx.drawImage(image, sx, sy, PLAYER_FRAME_W, sh, 0, 0, PLAYER_FRAME_W, sh)
    lctx.globalCompositeOperation = 'source-over'

    ctx.globalAlpha = a / 255
    ctx.drawImage(
      layer,
      0,
      0,
      PLAYER_FRAME_W,
      PLAYER_FRAME_H,
      x,
      y,
      PLAYER_FRAME_W * scale,
      PLAYER_FRAME_H * scale,
    )
    ctx.globalAlpha = 1
  }
  ctx.imageSmoothingEnabled = prevSmoothing
}

/** 全身图的绘制尺寸（`40×56 × scale`）。 */
export function playerAvatarSize(scale = 3): { width: number; height: number } {
  return { width: PLAYER_FRAME_W * scale, height: PLAYER_FRAME_H * scale }
}
