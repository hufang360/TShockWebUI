const cache = new Map<string, Promise<HTMLImageElement>>()

/** 图集只加载一次，并发请求共享同一个 Promise（设计原则与约束 C10）。 */
export function loadAtlasImage(url: string): Promise<HTMLImageElement> {
  const existing = cache.get(url)
  if (existing) return existing
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`图集加载失败：${url}`))
    img.src = url
  })
  cache.set(url, promise)
  return promise
}
