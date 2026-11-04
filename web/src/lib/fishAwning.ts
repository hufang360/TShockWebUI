/**
 * 鱼店遮阳伞的几何（`ShopAwning` 只负责画，尺寸全在这里算）。
 *
 * 参考图里的透视：布条从一个**正上方**的消失点放射下来 —— 中间几条竖直、越靠两端越往外斜。
 * 所以消失点距离由「两端斜多少度」反推，宽窗口也不会斜得离谱。
 *
 * 两端的布条会被扇形推出画布：**只画完全落在画布内的那些**，两端各留一点空白
 * （参考图两端也有留白）。裁一半会得到尖楔一样的碎渣，夹到边界又会退化成细条，实测都不好看。
 *
 * 纯函数，单测见 `fishAwning.test.ts`（几何算错了画面上看不出来）。
 */

/** 立面 / 半圆收口的高度（收口 = 布条下端那个半圆）。 */
export const AWNING_SCALLOP = 16
export const AWNING_FACE = 44
export const AWNING_HEIGHT = AWNING_FACE + AWNING_SCALLOP

/** 一个「布位」= 一条蓝布 + 一条白布；蓝的比白的宽一点（参考图 33 / 24）。 */
export const AWNING_BLUE = 33
export const AWNING_WHITE = 24
export const AWNING_SLOT = AWNING_BLUE + AWNING_WHITE

/** 两端布条相对竖直方向斜出去多少度。 */
export const AWNING_EDGE_LEAN = 16
const EDGE_LEAN_SLOPE = 2 * Math.tan((AWNING_EDGE_LEAN * Math.PI) / 180)

export interface AwningStrip {
  /** 布条轮廓（两条斜边 + 下端半圆）。 */
  d: string
  /** 下端半圆的圆心与半径（布边卷下去的暗弧用）。 */
  arc: { cx: number; cy: number; r: number }
  /** 蓝布 / 白布；两端绕到背面的那两条由调用方画成灰色。 */
  tone: 'blue' | 'white'
}

export function buildAwningStrips(width: number): AwningStrip[] {
  if (width <= 0) return []
  const center = width / 2
  const vanish = Math.max(120, width / EDGE_LEAN_SLOPE)
  // 布条上端在篷顶（y=0），下端在 AWNING_HEIGHT；放射投影把上端的边往外推。
  const at = (x: number, y: number) => center + ((x - center) * (vanish + y)) / vanish
  const slots = Math.ceil(width / AWNING_SLOT) + 1
  const strips: AwningStrip[] = []
  const push = (left: number, right: number, tone: AwningStrip['tone']) => {
    const topLeft = at(left, 0)
    const topRight = at(right, 0)
    const bottomLeft = at(left, AWNING_HEIGHT)
    const bottomRight = at(right, AWNING_HEIGHT)
    // 完全在画布内才画：被边界切一半会变成尖楔
    if (Math.min(topLeft, bottomLeft) < 0 || Math.max(topRight, bottomRight) > width) return
    const r = (bottomRight - bottomLeft) / 2
    const arcY = AWNING_HEIGHT - r
    strips.push({
      d:
        `M${topLeft.toFixed(2)} 0` +
        `L${topRight.toFixed(2)} 0` +
        `L${bottomRight.toFixed(2)} ${arcY.toFixed(2)}` +
        `A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${bottomLeft.toFixed(2)} ${arcY.toFixed(2)}` +
        'Z',
      arc: { cx: (bottomLeft + bottomRight) / 2, cy: arcY, r },
      tone,
    })
  }
  for (let i = 0; i <= slots; i++) {
    const left = i * AWNING_SLOT
    // 同一根缝隙里两条紧挨着：布条是连成一片的蓝白相间篷布，不是一根根分开挂
    push(left, left + AWNING_BLUE, 'blue')
    push(left + AWNING_BLUE, left + AWNING_SLOT, 'white')
  }
  return strips
}
