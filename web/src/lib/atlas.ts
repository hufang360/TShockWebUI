const cache = new Map<string, Promise<HTMLImageElement>>()

/** 图集裁切表的最小形状（三个图集的 meta 都带这些字段）。 */
export interface AtlasLike {
  meta: { sheet: string; hash?: string; width: number; height: number }
}

/**
 * 图集**裁切表 JSON** 的请求选项：一律绕过 HTTP 缓存（`no-store`）。
 *
 * 裁切表必须与 PNG 的**内容哈希**同步（见 `atlasImageUrl`）：如果浏览器手里是旧的裁切表
 * （历史上 `data/*.json` 曾被长缓存过），就会「旧坐标 + 新 PNG」→ 图标整体错位。
 * `no-store` 强制每次真正去服务器取，连**已经写进缓存的旧条目**也不会再用，从根上杜绝这种错位。
 * （PNG 本身带 `?v=<内容哈希>`，内容寻址，不需要 no-store。）
 */
export const ATLAS_JSON_FETCH: RequestInit = { credentials: 'same-origin', cache: 'no-store' }

/**
 * 图集 PNG 的 URL。图集是长缓存（见后端 `setCacheHeaders`），所以把**内容哈希**带上做缓存失效：
 * 图集一更新（如换了 NPC 贴图 / 重新生成），哈希就变，浏览器会重新拉取，
 * 避免出现「新的 regions 坐标 + 旧的 PNG」导致的图标错位。
 */
export function atlasImageUrl(sheet: string, hash?: string): string {
  const url = `${import.meta.env.BASE_URL}data/${sheet}`
  return hash ? `${url}?v=${encodeURIComponent(hash)}` : url
}

/** 图集只加载一次，并发请求共享同一个 Promise（设计原则与约束 C10）。 */
export function loadAtlasImage(url: string): Promise<HTMLImageElement> {
  const existing = cache.get(url)
  if (existing) return existing
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      // `onload` 只代表字节加载完成；第一次 drawImage 时仍可能同步解码整张巨图，
      // 在图鉴首屏同时绘制几十个 canvas 时会形成数百毫秒长任务。先异步解码，
      // 让实际画格子时只做裁切拷贝。
      const decoded = typeof img.decode === 'function' ? img.decode() : Promise.resolve()
      void decoded
        .catch(() => {
          /* 不支持 decode 或图片已损坏时仍交给 drawImage 处理 */
        })
        .then(() => resolve(img))
    }
    img.onerror = () => {
      cache.delete(url)
      reject(new Error(`图集加载失败：${url}`))
    }
    img.src = url
  })
  cache.set(url, promise)
  return promise
}

function sizeMatches(img: HTMLImageElement, atlas: AtlasLike): boolean {
  return img.naturalWidth === atlas.meta.width && img.naturalHeight === atlas.meta.height
}

/**
 * 加载图集 PNG 并**校验尺寸与裁切表一致**（纵深防御）。
 *
 * `atlasImageUrl` 的内容哈希已经能防「新坐标 + 旧 PNG」；这里再兜一层：万一浏览器缓存里
 * 恰好有一条尺寸不符的坏图（历史缓存 / 半截下载 / 部署时 PNG 与 JSON 不同步），
 * 就直接用带时间戳的 URL 重取一次绕开它；仍不一致就抛错，让调用方显示占位，
 * 绝不把「错位的贴图」画出来。
 */
export async function loadVerifiedAtlasImage(atlas: AtlasLike): Promise<HTMLImageElement> {
  const url = atlasImageUrl(atlas.meta.sheet, atlas.meta.hash)
  const img = await loadAtlasImage(url)
  if (sizeMatches(img, atlas)) return img

  // 坏缓存项：用每次不同的 URL 强制重取（同时把原来那条从单例缓存里删掉，下次重试）。
  cache.delete(url)
  const retryUrl = `${url}${url.includes('?') ? '&' : '?'}retry=${Date.now()}`
  const retried = await loadAtlasImage(retryUrl)
  if (sizeMatches(retried, atlas)) return retried
  cache.delete(retryUrl)
  throw new Error(
    `图集尺寸不匹配：${atlas.meta.sheet} ${retried.naturalWidth}×${retried.naturalHeight} ≠ 裁切表 ${atlas.meta.width}×${atlas.meta.height}`,
  )
}

/** 空闲时预热图集（加载 + 解码）；失败保持静默，真正使用时仍会重试。 */
export function preloadAtlasImage(atlas: AtlasLike | null | undefined): void {
  if (!atlas) return
  void loadVerifiedAtlasImage(atlas).catch(() => {})
}
