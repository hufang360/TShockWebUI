import { useEffect, useRef, useState } from 'react'
import { loadNpcAtlas, loadNpcAtlasImage } from '@/lib/npcAtlas'
import { npcContentSize, shouldSmooth, type IconScaleMode } from '@/lib/iconScale'
import type { NpcAtlas } from '@/types'

/**
 * 按 NPC 图集裁切表绘制某个 NPC 的第一帧（等比放入 size×size 的方框）。
 *
 * - 图集按需懒加载（首次渲染时拉取 `npc-atlas.json` + PNG），不进入首屏 dataset；
 * - 加载中 / 区域缺失时保持透明，绝不抛错；
 * - 尺寸与采样：`game` 模式**只缩不放**，保留 NPC 之间的原生大小差异（与游戏一致，小动物小、Boss 大）；
 *   像素风放缩用最近邻，缩小用插值（与 `ItemIcon` 同策略）。
 */
export function NpcSprite({
  id,
  size,
  className,
  name,
  mode = 'game',
}: {
  /** NPC id（图集 regions 的键）。 */
  id: number | null
  /** CSS 像素方框边长。 */
  size: number
  className?: string
  name?: string
  /** 尺寸模式：`game`（默认）只缩不放；`fit` 填满方框（详情大图用）。 */
  mode?: IconScaleMode
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [atlas, setAtlas] = useState<NpcAtlas | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadNpcAtlas()
      .then((a) => {
        if (cancelled) return
        setAtlas(a)
        setFailed(false)
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
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const region = atlas && id != null ? atlas.regions[String(id)] : undefined
    // 加载中 / 缺失时保持透明，不绘制暗色方框与问号占位。
    if (!atlas || id == null || !region || failed) return

    const [x, y, w, h] = region
    // 尺寸规则见 lib/iconScale.ts 的 npcContentSize：game 只缩不放（保留游戏里的相对大小）。
    const { width: cssW, height: cssH } = npcContentSize(w, h, size, mode)
    const dw = Math.max(1, Math.round(cssW * dpr))
    const dh = Math.max(1, Math.round(cssH * dpr))
    const dx = Math.round((canvas.width - dw) / 2)
    const dy = Math.round((canvas.height - dh) / 2)

    let cancelled = false
    loadNpcAtlasImage(atlas)
      .then((img) => {
        if (cancelled) return
        // 采样：缩小插值（同游戏）、1:1 与放大用最近邻（像素完美，避免透明边缘渗色）。
        ctx.imageSmoothingEnabled = shouldSmooth(w, cssW)
        // 图集每格之间留 1px 透明缝（`--padding 1`），插值越界读到的是透明缝而不是邻居贴图。
        ctx.drawImage(img, x, y, w, h, dx, dy, dw, dh)
      })
      .catch(() => {
        /* 图集缺失时保持透明 */
      })
    return () => {
      cancelled = true
    }
  }, [atlas, id, size, mode, failed])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size }}
      role="img"
      aria-label={name ?? `NPC ${id ?? '?'}`}
    />
  )
}
