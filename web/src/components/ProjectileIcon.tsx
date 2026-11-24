import { useEffect, useRef, useState } from 'react'
import { loadProjectileAtlas, loadProjectileAtlasImage } from '@/lib/projectileAtlas'
import { iconContentSize, shouldSmooth } from '@/lib/iconScale'
import type { ProjectileAtlas } from '@/types'

/**
 * 按射弹图集裁切表绘制某个射弹（等比放入 size×size 的方框）。
 *
 * - 图集按需懒加载（首次渲染时拉取 `projectile-atlas.json` + PNG），不进入首屏 dataset；
 * - 加载中 / 区域缺失（1×1 占位贴图不收录）时保持透明，绝不抛错；
 * - 采样与物品图标一致：缩小用插值、放大用最近邻（像素风）。
 */
export function ProjectileIcon({
  id,
  size,
  className,
  name,
}: {
  /** 射弹 id（图集 regions 的键）。 */
  id: number | null
  /** CSS 像素方框边长。 */
  size: number
  className?: string
  name?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [atlas, setAtlas] = useState<ProjectileAtlas | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadProjectileAtlas()
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
    // 射弹贴图的长宽比差别很大（箭矢 14×32、大型弹幕接近正方形）：等比放进方框，不拉变形。
    const { width: cssW, height: cssH } = iconContentSize(w, h, size, 'fit')
    const dw = Math.max(1, Math.round(cssW * dpr))
    const dh = Math.max(1, Math.round(cssH * dpr))
    const dx = Math.round((canvas.width - dw) / 2)
    const dy = Math.round((canvas.height - dh) / 2)

    let cancelled = false
    loadProjectileAtlasImage(atlas)
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
  }, [atlas, id, size, failed])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size }}
      role="img"
      aria-label={name ?? `Projectile ${id ?? '?'}`}
    />
  )
}
