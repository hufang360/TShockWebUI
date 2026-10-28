import type { FishGood } from '@/lib/tshock'

/**
 * 是否「降级条目」：插件对**自身配置有误**的商品只回基础字段（其余文本为空、数值 0/1、数组为空），
 * `comment` 固定以「该商品配置有误」开头。这种条目点进去也买不了（上游没有价格 / 商品）。
 *
 * 来源：插件源码 `TShockFishShop/RestApi.cs` 的 `MinimalGoodsJson`（`GoodsJsonSafe` 的兜底），
 * 与插件 `docs/REST-API.md` §2.1「降级条目」说明一致。
 *
 * 只能靠文案判断：没有更强的结构化信号（`cost` 为空也可能是免费商品）。插件改文案时这里要一起改。
 */
export function isDegradedGood(good: FishGood | null | undefined): boolean {
  return (good?.comment ?? '').startsWith('该商品配置有误')
}
