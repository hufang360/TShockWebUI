/**
 * 「分割」tab 的 Demo 素材：自带的 **buff 图集**（`data/buff-atlas.png`）。
 *
 * 切分参数来自图集的生成方式（`tools/gen-buff-atlas.py` + `data/buff-atlas.json` 的 meta）：
 * 400 张 Buff 图标全部是 **32×32**，按「高降序、宽升序」逐行摆放、**每格之间留 1px 透明缝**，
 * 图集宽 1022（= 31×32 + 30×1）、高 428（= 13×32 + 12×1），所以正好是
 * **31 列 × 13 行、边距 0、间距 1** 的均匀网格（403 格，最后 3 格为空）。
 *
 * 如果图集重新生成后布局变了，`demo.test.ts` 会拿 `data/buff-atlas.json` 的真实 meta 校验并失败，
 * 避免 Demo 用错误参数静默切歪。
 */

export const DEMO_SHEET_URL = `${import.meta.env.BASE_URL}data/buff-atlas.png`

export const DEMO_SHEET_NAME = 'buff-atlas.png'

/** 与 `data/buff-atlas.json` 的 meta 对齐（见文件头说明）。 */
export const DEMO_SHEET_GRID = { rows: 13, cols: 31, margin: 0, gap: 1 } as const
