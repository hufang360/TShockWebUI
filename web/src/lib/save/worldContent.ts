/**
 * 「箱子 / 招牌」内容的编辑草稿与差异（W4）。
 *
 * 与「世界字段」（`worldEdit.ts`）分开：那套是定长字段的草稿，这套是**变长段**的内容，
 * 写回时要重建整段并重排段指针（见 `worldWrite.ts` 的按段拼装）。
 *
 * 范围（故意只做「改内容」，不做「加减箱子」）：
 * - 箱子：**改名字（≤20 字符）与已有格子里的物品**（物品 / 数量 / 词缀 / 清空该格）；
 * - 招牌：**改文本**（≤1000 字符）；
 * - 箱子与招牌的**数量、坐标**不变 —— 加减箱子要同步图格（箱子图格）与索引，属于另一个量级的改动。
 */
import type { ChestDetail, SignDetail } from './worldStats'

/** 一个箱子的编辑草稿（`items` 只放非空格子，按 slot 索引）。 */
export interface ChestEdit {
  x: number
  y: number
  name: string
  capacity: number
  /** 下标 = 箱子内格位；`null` = 空槽。 */
  items: ({ id: number; stack: number; prefix: number } | null)[]
}

/** 招牌编辑草稿。 */
export interface SignEdit {
  x: number
  y: number
  text: string
}

/** 从解析结果生成草稿。 */
export function draftFromContent(chests: readonly ChestDetail[], signs: readonly SignDetail[]): {
  chests: ChestEdit[]
  signs: SignEdit[]
} {
  return {
    chests: chests.map((chest) => {
      const items: ChestEdit['items'] = Array.from({ length: chest.capacity }, () => null)
      for (const item of chest.items) {
        if (item.slot >= 0 && item.slot < chest.capacity) {
          items[item.slot] = { id: item.id, stack: item.stack, prefix: item.prefix }
        }
      }
      return { x: chest.x, y: chest.y, name: chest.name, capacity: chest.capacity, items }
    }),
    signs: signs.map((sign) => ({ x: sign.x, y: sign.y, text: sign.text })),
  }
}

/** 箱子名字上限（游戏加载时 `Utils.TrimUserString(name, 20)`）。 */
export const CHEST_NAME_MAX = 20
/** 招牌文本上限（游戏内编辑界面也远小于这个值；这里给一个宽松上界防手滑）。 */
export const SIGN_TEXT_MAX = 1000

export interface ContentIssue {
  /** `chests.3.name` / `chests.3.items.5` / `signs.2` 之类，UI 定位用。 */
  field: string
  messageKey: string
  vars?: Record<string, string | number>
}

/**
 * 校验内容草稿。只校验**改过**的箱子 / 招牌；物品规则与背包一致（id 存在 / 数量 ≤ maxStack / 词缀可滚）。
 */
export function validateContentDraft(
  draft: { chests: ChestEdit[]; signs: SignEdit[] },
  ctx: {
    chests: readonly ChestDetail[]
    signs: readonly SignDetail[]
    catalog: {
      hasItem(id: number): boolean
      maxStack(id: number): number | undefined
      blocked(id: number): boolean
      prefixes(id: number): readonly number[] | undefined
    }
  },
): ContentIssue[] {
  const issues: ContentIssue[] = []
  const { catalog } = ctx

  draft.chests.forEach((chest, ci) => {
    const before = ctx.chests[ci]
    if (!before) return
    if ((chest.name ?? '').trim() !== before.name) {
      const name = (chest.name ?? '').trim()
      if (name.length > CHEST_NAME_MAX) {
        issues.push({ field: `chests.${ci}.name`, messageKey: 'wld.content.err.nameTooLong', vars: { max: CHEST_NAME_MAX } })
      }
    }
    chest.items.forEach((item, slot) => {
      const prev = before.items.find((it) => it.slot === slot)
      const cur = item ? { id: item.id, stack: item.stack, prefix: item.prefix } : null
      const prevNorm = prev ? { id: prev.id, stack: prev.stack, prefix: prev.prefix } : null
      if (JSON.stringify(cur) === JSON.stringify(prevNorm)) return
      if (!cur) return // 清空：允许
      if (!catalog.hasItem(cur.id)) {
        issues.push({ field: `chests.${ci}.items.${slot}`, messageKey: 'save.edit.err.badItem', vars: { id: cur.id } })
        return
      }
      if (catalog.blocked(cur.id)) {
        issues.push({ field: `chests.${ci}.items.${slot}`, messageKey: 'save.edit.err.blockedItem' })
      }
      const max = catalog.maxStack(cur.id)
      if (max != null && (cur.stack < 1 || cur.stack > max)) {
        issues.push({ field: `chests.${ci}.items.${slot}`, messageKey: 'save.edit.err.stackRange', vars: { max } })
      } else if (max == null && cur.stack < 1) {
        issues.push({ field: `chests.${ci}.items.${slot}`, messageKey: 'save.edit.err.stackRange', vars: { max: 1 } })
      }
      const allowed = catalog.prefixes(cur.id) ?? []
      if (cur.prefix !== 0 && !allowed.includes(cur.prefix)) {
        issues.push({ field: `chests.${ci}.items.${slot}`, messageKey: 'save.edit.err.badPrefix' })
      }
    })
  })

  draft.signs.forEach((sign, si) => {
    const before = ctx.signs[si]
    if (!before || sign.text === before.text) return
    if (Array.from(sign.text).length > SIGN_TEXT_MAX) {
      issues.push({ field: `signs.${si}`, messageKey: 'wld.content.err.signTooLong', vars: { max: SIGN_TEXT_MAX } })
    }
  })

  return issues
}

/** 草稿 → 只含真正变化的内容（没改的箱子 / 招牌不进补丁）。 */
export function buildContentEdits(
  draft: { chests: ChestEdit[]; signs: SignEdit[] },
  original: { chests: readonly ChestDetail[]; signs: readonly SignDetail[] },
): {
  chests?: ChestDetail[]
  signs?: SignDetail[]
} {
  const out: { chests?: ChestDetail[]; signs?: SignDetail[] } = {}

  if (
    draft.chests.some((chest, ci) => {
      const before = original.chests[ci]
      if (!before) return false
      if ((chest.name ?? '').trim() !== before.name) return true
      return chest.items.some((item, slot) => {
        const prev = before.items.find((it) => it.slot === slot)
        const prevNorm = prev ? { id: prev.id, stack: prev.stack, prefix: prev.prefix } : null
        const cur = item ? { id: item.id, stack: item.stack, prefix: item.prefix } : null
        return JSON.stringify(cur) !== JSON.stringify(prevNorm)
      })
    })
  ) {
    // 整段重建：把草稿按解析结构还原成 `ChestDetail[]`（数量与坐标都沿用原值）
    out.chests = draft.chests.map((chest, ci) => {
      const before = original.chests[ci]
      const items = chest.items
        .map((item, slot) => (item ? { slot, id: item.id, stack: item.stack, prefix: item.prefix } : null))
        .filter((it): it is { slot: number; id: number; stack: number; prefix: number } => it != null)
      return {
        x: chest.x,
        y: chest.y,
        name: (chest.name ?? '').trim(),
        capacity: chest.capacity || before?.capacity || 40,
        items,
      }
    })
  }

  if (draft.signs.some((sign, si) => original.signs[si] && sign.text !== original.signs[si].text)) {
    out.signs = draft.signs.map((sign) => ({ text: sign.text, x: sign.x, y: sign.y }))
  }

  return out
}
