/**
 * 切片列表模型：**网格切片**（行列切出来，可微调 / 可命名）+ **手动切片**（鼠标框选出来，可命名）。
 *
 * 身份用 `key` 字符串（`g:<网格下标>` / `m:<自增 id>`）而不是数组下标：
 * 改行列、删手动切片时下标会挪，key 不会，选中项和命名都跟着 key 走。
 */

import {
  defaultSlices,
  sliceName,
  type SheetSize,
  type SliceGrid,
  type SliceRect,
} from './slice'

/** 手动框选出来的切片（矩形已经在图片范围内）。 */
export interface ManualSlice {
  /** 页面内自增，删除后不复用。 */
  id: number
  rect: SliceRect
}

export interface SliceEntry {
  /** `g:<index>` / `m:<id>`。 */
  key: string
  /** 列表与导出顺序（从 0 起），序号徽标 = `index + 1`。 */
  index: number
  rect: SliceRect
  kind: 'grid' | 'manual'
  /** 没命名时的默认名：网格 `r1c1`，手动 `slice-<id>`。 */
  defaultName: string
  /** 用户命名（可能为空字符串）。 */
  name: string
  /** 展示 / 导出用：命名优先，否则默认名。 */
  displayName: string
  /** 网格切片是否被微调过（手动切片没有「默认网格」可比）。 */
  adjusted: boolean
}

export interface SliceModelInput {
  size: SheetSize
  grid: SliceGrid
  /** 网格切片的微调。 */
  overrides: ReadonlyMap<number, SliceRect>
  manual: readonly ManualSlice[]
  /** `key → 名字`。 */
  names: ReadonlyMap<string, string>
}

export function gridKey(index: number): string {
  return `g:${index}`
}

export function manualKey(id: number): string {
  return `m:${id}`
}

export function parseKey(key: string): { kind: 'grid' | 'manual'; value: number } | null {
  const match = /^([gm]):(-?\d+)$/.exec(key)
  if (!match) return null
  const value = Number(match[2])
  if (!Number.isFinite(value)) return null
  return { kind: match[1] === 'g' ? 'grid' : 'manual', value }
}

/** 组装列表：网格切片在前（按行列顺序），手动切片按创建顺序追加。 */
export function buildEntries({
  size,
  grid,
  overrides,
  manual,
  names,
}: SliceModelInput): SliceEntry[] {
  const base = defaultSlices(size, grid)
  const entries: SliceEntry[] = base.map((rect, index) => {
    const key = gridKey(index)
    const name = names.get(key) ?? ''
    const defaultName = sliceName(index, grid.cols)
    return {
      key,
      index,
      rect: overrides.get(index) ?? rect,
      kind: 'grid',
      defaultName,
      name,
      displayName: name.trim() || defaultName,
      adjusted: overrides.has(index),
    }
  })
  manual.forEach((slice, offset) => {
    const key = manualKey(slice.id)
    const name = names.get(key) ?? ''
    const defaultName = `slice-${slice.id}`
    const index = base.length + offset
    entries.push({
      key,
      index,
      rect: slice.rect,
      kind: 'manual',
      defaultName,
      name,
      displayName: name.trim() || defaultName,
      adjusted: false,
    })
  })
  return entries
}

/** 文件名里不允许出现的字符（Windows / macOS / Linux 取合集；含控制字符，故屏蔽该规则）。 */
// eslint-disable-next-line no-control-regex -- 文件名要剔除控制字符（\u0000-\u001f）
const INVALID_FILE_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g

/** 名字 → 安全的文件名片段（去掉路径分隔符与控制字符，压空格，限长 64）。 */
export function sanitizeFilePart(input: string, fallback: string): string {
  const cleaned = input
    .replace(INVALID_FILE_CHARS, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 64)
    .trim()
  return cleaned || fallback
}

/** 每张切片的文件名（不含 `.png`），重名自动加 `-2` / `-3`。 */
export function sliceFileNames(entries: readonly SliceEntry[]): string[] {
  const used = new Map<string, number>()
  return entries.map((entry) => {
    const base = sanitizeFilePart(entry.displayName, entry.defaultName)
    const key = base.toLowerCase()
    const count = (used.get(key) ?? 0) + 1
    used.set(key, count)
    return count === 1 ? base : `${base}-${count}`
  })
}
