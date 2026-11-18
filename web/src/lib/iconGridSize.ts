/**
 * 图标网格的「图标大小」档位名（物品 ID / 数据 ID / 鱼店货架的「页面设置 → 图标大小」共用这一套）。
 *
 * 各页的**像素**各自定义（物品 ID 在 `components/items/DexCell` 的 `ITEM_SIZES`、
 * 数据 ID 在 `components/dataid/DataIdViews` 的 `DATA_ID_SIZES`、鱼店在 `GoodCells` 的 `GOOD_SIZES`），
 * 这里只有档位名、默认值与容错，避免三页各写一份 `'lg' | 'md' | 'sm'` 和三个解析函数。
 */
export type IconGridSize = 'lg' | 'md' | 'sm'

export const DEFAULT_ICON_GRID_SIZE: IconGridSize = 'lg'

/** 本机存的档位可能是旧版本 / 手改坏的值：认不出来就回到默认的「大」。 */
export function resolveIconGridSize(value: unknown): IconGridSize {
  return value === 'md' || value === 'sm' || value === 'lg' ? value : DEFAULT_ICON_GRID_SIZE
}
