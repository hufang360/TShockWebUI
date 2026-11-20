import { useEffect, useState } from 'react'
import type { BestiaryIconsData } from '@/types'

const BASE = import.meta.env.BASE_URL

/** 图标裁切表 + 贴图只拉一次（与 buff / NPC 图集同策略：失败清缓存，下次重试）。 */
let metaCache: Promise<BestiaryIconsData> | null = null
const imageCache = new Map<string, Promise<HTMLImageElement>>()

function loadMeta(): Promise<BestiaryIconsData> {
  if (!metaCache) {
    metaCache = Promise.resolve()
      .then(() => fetch(`${BASE}data/bestiary-icons.json`, { cache: 'no-store' }))
      .then(async (res) => {
        if (!res.ok) throw new Error(`加载 bestiary-icons.json 失败：HTTP ${res.status}`)
        return (await res.json()) as BestiaryIconsData
      })
      .catch((err: unknown) => {
        metaCache = null
        throw err
      })
  }
  return metaCache
}

function loadImage(meta: BestiaryIconsData, texture: 'tags' | 'rank'): Promise<HTMLImageElement> {
  const spec = meta.meta[texture]
  const url = `${BASE}data/${spec.file}?v=${spec.hash}`
  let promise = imageCache.get(url)
  if (!promise) {
    promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => {
        imageCache.delete(url)
        reject(new Error(`加载 ${spec.file} 失败`))
      }
      image.src = url
    })
    imageCache.set(url, promise)
  }
  return promise
}

/**
 * 「怪物图鉴」筛选器图标：从游戏原图 `Icon_Tags_Shadow`（16×5，每格 30×30）按帧号裁一格，
 * 「稀有」用 `Icon_Rank_Light`。懒加载，加载中 / 失败保持透明（不画占位方块）。
 */
export function BestiaryFilterIcon({
  id,
  filterKey,
  size,
  className,
}: {
  /** 图标裁切表里的过滤条目 key（`Bestiary_Biomes.Surface`…）。 */
  id: string
  filterKey?: 'tags' | 'rank'
  size: number
  className?: string
}) {
  const [meta, setMeta] = useState<BestiaryIconsData | null>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadMeta()
      .then((data) => {
        if (cancelled) return
        setMeta(data)
        const entry = data.filters.find((f) => f.key === id)
        return loadImage(data, entry?.texture ?? filterKey ?? 'tags')
      })
      .then((img) => {
        if (cancelled || !img) return
        setImage(img)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [id, filterKey])

  const entry = meta?.filters.find((f) => f.key === id)
  const spec = meta && entry ? meta.meta[entry.texture] : null

  return (
    <canvas
      aria-hidden
      className={className}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
      ref={(canvas) => {
        if (!canvas || !image || !spec || !entry || failed) return
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = size * dpr
        canvas.height = size * dpr
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        const cell = spec.cell
        const sx = (entry.frame % spec.cols) * cell
        const sy = Math.floor(entry.frame / spec.cols) * cell
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(image, sx, sy, cell, cell, 0, 0, canvas.width, canvas.height)
      }}
    />
  )
}
