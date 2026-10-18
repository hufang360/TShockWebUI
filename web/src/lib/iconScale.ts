/**
 * 物品图标的绘制尺寸计算 —— `ItemIcon` 的唯一尺寸出口（纯函数，便于单测）。
 *
 * 事实来源：Terraria 1.4.5.8 反编译源码
 * - `Terraria.UI/ItemSlot.cs:2847` `DrawItemIcon(..., float sizeLimit, ...)`：
 *   背包 / 箱子 / 聊天（`ItemSlot.cs:2500/2525`、`CoinSlot.cs:254`）调用点都传 `32f`；
 *   物品落到世界里用 40/20（`TileDrawing.cs:8094/8136`），鼠标手持用 9999（`Main.cs:45892`）。
 * - `Terraria.UI/ItemSlot.cs:2965` `DrawItem_GetColorAndScale`：**只在长边 > sizeLimit 时缩小，从不放大**
 *     `num = max(w,h) > sizeLimit ? sizeLimit / max(w,h) : 1`
 *     `finalDrawScale = inventoryScale * num`
 *   `inventoryScale` 等价于「一个 32px 图标框的缩放」：背包 0.85（`Main.cs:41768`）、
 *   聊天 `1 * 0.75`（`ItemTagHandler.cs:37`）、热键栏选中格 1.0（`Main.cs:44431`）。
 * - 聊天里的 `[i:..]` 占位宽度固定 `32 * 0.75 = 24px`（`ItemTagHandler.cs:52`），与图标实际大小无关。
 *
 * 前端等价公式：`scale = [box/32 取整（仅放大）] * (max(w,h) > 32 ? 32 / max(w,h) : 1)`。
 * 于是铜币（12×12）在任何方框里都只占 12/32，木剑（32×32）占满，天顶剑（56×56）被压到 32/32
 * —— 与游戏观感一致（金币天生小、武器天生大）；再叠加「放大取整」避免最近邻非整数放大。
 */

/** 游戏里图标方框的基准像素（`ItemSlot.DrawItemIcon` 的 `sizeLimit`，背包 / 聊天均为 32）。 */
export const ITEM_ICON_SIZE_LIMIT = 32

export type IconScaleMode =
  /** 与游戏一致：只缩不放，保留物品之间的原生大小差异。 */
  | 'game'
  /** 旧行为：contain 填满方框（会抹平物品之间的大小差异，仅特殊场景使用）。 */
  | 'fit'

/**
 * 采样方式：**缩小用插值，放大用最近邻**。
 *
 * - 游戏的背包 / 聊天只会缩小（`inventoryScale` ≤ 1，0.85 / 0.75），且用 `LinearClamp`，
 *   所以缩小时开插值 = 原味（见 `Main.cs:2955`）。
 * - Web 端大屏要把 32px 贴图放大（本项目按整数倍，如 2× → 64px）。整数倍放大用插值会发糊，
 *   而且贴图四周的透明像素会被混进来，在边缘渗出 1px 虚边 —— 这里必须用最近邻（像素完美）。
 * - 1:1 时插值是恒等，开不开都一样。
 */
export function shouldSmooth(spriteSide: number, contentSide: number): boolean {
  return contentSide < spriteSide
}

/**
 * 方框 → 缩放倍数的「像素取整」规则（仅 `game` 模式）：
 * 放大一律取整数倍（`floor`），缩小保持小数。
 *
 * 原因：图标按游戏的方式用双线性采样（`LinearClamp`，见 `ItemIcon`），非整数放大（如 `44/32 = 1.375×`）
 * 会把整张图重采样一遍，像素变糊；保持 1× 时是像素级无损。
 * 用 `floor` 而非 `round` 是为了保证结果永不超出方框（`48/32 = 1.5 → 1`，若 round 则 2 会溢出）。
 */
function boxScale(box: number): number {
  const mult = box / ITEM_ICON_SIZE_LIMIT
  return mult > 1 ? Math.floor(mult) : mult
}

/**
 * 图标在 `box × box` 方框内实际占用的 CSS 像素尺寸（等比，保持长宽比）。
 * 结果不会超出方框；贴图无效（宽或高 ≤0）时返回 0。
 */
export function iconContentSize(
  w: number,
  h: number,
  box: number,
  mode: IconScaleMode = 'game',
): { width: number; height: number } {
  if (!(w > 0) || !(h > 0) || !(box > 0)) return { width: 0, height: 0 }
  const longest = Math.max(w, h)
  const scale =
    mode === 'game'
      ? boxScale(box) * (longest > ITEM_ICON_SIZE_LIMIT ? ITEM_ICON_SIZE_LIMIT / longest : 1)
      : box / longest
  return { width: w * scale, height: h * scale }
}

/** NPC 贴图绘制时四周留白比例（与 `NpcSprite` / 物品图标一致，只影响需要缩小的贴图）。 */
export const NPC_THUMB_FILL = 0.94

/**
 * NPC 贴图在 `box × box` 方框内实际占用的 CSS 像素尺寸。
 *
 * - `game`（默认，与游戏一致）：**只缩不放**。游戏里 NPC 就是原生像素大小，
 *   小动物天生小、城镇 NPC 中等、Boss 天生大；之前一律 contain 填满方框把这些差异抹平了。
 * - `fit`：contain 填满方框（详情大图用，否则 10px 的小虫在大框里看不见）。
 */
export function npcContentSize(
  w: number,
  h: number,
  box: number,
  mode: IconScaleMode = 'game',
): { width: number; height: number } {
  if (!(w > 0) || !(h > 0) || !(box > 0)) return { width: 0, height: 0 }
  const fit = (box * NPC_THUMB_FILL) / Math.max(w, h)
  const scale = mode === 'game' ? Math.min(1, fit) : fit
  return { width: w * scale, height: h * scale }
}
