/**
 * 键盘提示的文案（`⌘` / `Ctrl`）。
 *
 * 为什么不用 `navigator.platform`：它已被废弃，未来可能返回空串；
 * 新版 Chrome 用 `userAgentData.platform`（`macOS` / `Windows` / `Linux`）。
 * 两个都取不到就退回 `userAgent`（Safari / Firefox 走这条）。
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform || nav.platform || navigator.userAgent || ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** 主修饰键的显示形式：macOS 是 `⌘`，其余是 `Ctrl`。 */
export function modKeyLabel(): string {
  return isMacPlatform() ? '⌘' : 'Ctrl'
}

/** 组合键的显示形式（`⌘K` / `Ctrl K`）。 */
export function shortcutLabel(key: string): string {
  const mod = modKeyLabel()
  return mod === '⌘' ? `⌘${key}` : `${mod} ${key}`
}
