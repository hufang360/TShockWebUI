/**
 * 用户自定义模块（「设置 → 激活模块」里填名称 + 指令创建）。
 *
 * 定义存 localStorage `tswui:customModules`（本机、不区分服务器）：
 * `[{ id, name }]`，id 以 `m:` 开头。模块内的指令卡片存 `lib/moduleCards.ts`。
 */

import { CUSTOM_MODULE_PREFIX } from './modules'

export interface CustomModule {
  id: string
  name: string
}

function newId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${CUSTOM_MODULE_PREFIX}${rand}`
}

export function createCustomModule(name = ''): CustomModule {
  return { id: newId(), name }
}

export function sanitizeCustomModules(value: unknown): CustomModule[] {
  if (!Array.isArray(value)) return []
  const out: CustomModule[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const id = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : ''
    if (!id.startsWith(CUSTOM_MODULE_PREFIX) || id.length <= CUSTOM_MODULE_PREFIX.length) continue
    if (seen.has(id)) continue
    const rawName = (item as { name?: unknown }).name
    seen.add(id)
    out.push({ id, name: typeof rawName === 'string' ? rawName : '' })
  }
  return out
}
