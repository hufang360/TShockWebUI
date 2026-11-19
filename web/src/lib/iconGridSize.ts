/**
 * 图标网格的「图标大小」档位名（物品 ID / 数据 ID / 鱼店货架的「页面设置 → 图标大小」共用这一套）。
 *
 * 各页的**像素**各自定义（物品 ID 在 `components/items/DexCell` 的 `ITEM_SIZES`、
 * 数据 ID 在 `components/dataid/DataIdViews` 的 `DATA_ID_SIZES`、鱼店在 `GoodCells` 的 `GOOD_SIZES`），
 * 这里只有档位名、默认值与容错，避免三页各写一份 `'lg' | 'md' | 'sm'` 和三个解析函数。
 *
 * `row` = **横条**：图标在左、`#编号` 与名称在右竖排（名称单行截断）。它跟小档一样是「纯图标 + 底板」的尺寸，
 * 只是格子被拉宽，见 `isIconPlateSize`。
 */
export type IconGridSize = 'lg' | 'md' | 'sm' | 'row'

export const DEFAULT_ICON_GRID_SIZE: IconGridSize = 'row'

/** 本机存的档位可能是旧版本 / 手改坏的值：认不出来就回到默认的「横条」。 */
export function resolveIconGridSize(value: unknown): IconGridSize {
  return value === 'md' || value === 'sm' || value === 'lg' || value === 'row'
    ? value
    : DEFAULT_ICON_GRID_SIZE
}

/** 哪些档位的**图标方块**自己垫底板（只有小档）；横条的底板铺在整条格子上，见 `ROW_PLATE_CLASS`。 */
export function isIconPlateSize(size: IconGridSize): boolean {
  return size === 'sm'
}

/**
 * 「隐藏编号和名称」开关在这些档位下没有意义：小档只放图标、横条的意义就是带文字。
 * 三页都按这个决定要不要渲染那个开关（存的值可能是别的档位留下的，切档时别让开关突然消失又出现）。
 */
export function showsMetaToggle(size: IconGridSize): boolean {
  return !isIconPlateSize(size) && size !== 'row'
}

/**
 * 图标区底板 / 外框：物品 ID / 数据 ID / 鱼店三个图标网格共用（配色只写在这里）。
 *
 * **小档（纯图标格子）亮暗都垫底板**：小档是 40px 格 / 32px 图标，密集排列时靠底板把格子分出来。
 * **中 / 大档只在暗色下垫底板**：亮色下大图标本来就清楚，再垫一层会跟物品美术抢眼；
 * 暗色下没有底板的话图标会浮在黑底上。
 *
 * 配色**一律走 shadcn 的 `secondary` 令牌**（= secondary 按钮的底色），不写死色值、不加描边：
 * 图标底板跟旁边的按钮 / 输入框是同一档灰，亮暗差异由 `--secondary` 在两套主题下各自给。
 */
const PLATE_BG = 'rounded-control bg-secondary'

/** 小档底板（亮暗都有）。 */
export const ICON_PLATE_CLASS = PLATE_BG

/** 中 / 大档底板：**只有暗色**（亮色下不垫底色，但保留 8px 圆角）。 */
export const ICON_PLATE_DARK_CLASS = 'dark:bg-secondary'

/**
 * 横条档的底板：铺在**整条格子**上（图标 + 编号 + 名称一起），不是只铺图标方块 ——
 * 横条本身就是「一行一块」的条目，只给图标上色会像被切成两截。
 *
 * hover / 键盘聚焦用 `hover:` / `focus-visible:`（不是 `group-hover/cell:`）：
 * 底板就长在格子自己身上，而 `group-*` 变体要求作用在**后代**元素上。
 */
export const ROW_PLATE_CLASS =
  // 与合成表条目（`RecipePanel` 的 `RECIPE_ROW_CLASS`）同色：常驻 `bg-accent/40`、悬停 `bg-accent`，
  // 只做颜色过渡、不做位移 —— 横条是一行一条，位移会跟上下行互相挤。
  'rounded-control bg-accent/40 px-2 transition-colors duration-150 hover:bg-accent focus-visible:bg-accent'

/**
 * 小档底板的 hover / 聚焦：**亮色压深 10%、暗色提亮 10%**（挂在图标方块上，所以用 `group-hover/cell:`）。
 * 横条的底色与合成表条目一致，见 `ROW_PLATE_CLASS`。
 */

/**
 * 小档底板的 hover / 键盘聚焦反馈。
 * 亮色**压深**、暗色**提亮**：底板是不透明色，亮色再提亮就会跟页面底色糊在一起。
 */
export const ICON_PLATE_HOVER_CLASS =
  'group-hover/cell:brightness-90 group-focus-visible/cell:brightness-90 dark:group-hover/cell:brightness-110 dark:group-focus-visible/cell:brightness-110'

/** 没有底板（亮色下的中 / 大档）时叠一层主色淡底；暗色下那里有底板，改成提亮。 */
const ICON_SURFACE_HOVER_CLASS =
  'group-hover/cell:bg-primary/10 group-focus-visible/cell:bg-primary/10 dark:group-hover/cell:bg-secondary dark:group-focus-visible/cell:bg-secondary dark:group-hover/cell:brightness-110 dark:group-focus-visible/cell:brightness-110'

/**
 * 图标区（图标外框）的类：小档亮暗都垫底板；中 / 大档只暗色垫（亮色保持无底色 + 8px 圆角）；
 * 横条档**图标本身不上色**（底色在整条格子上，见 `ROW_PLATE_CLASS`）。
 */
export function iconPlateClass(size: IconGridSize): string {
  if (size === 'row') return ''
  return isIconPlateSize(size)
    ? `${ICON_PLATE_CLASS} ${ICON_PLATE_HOVER_CLASS}`
    : `rounded-control ${ICON_PLATE_DARK_CLASS} ${ICON_SURFACE_HOVER_CLASS}`
}
