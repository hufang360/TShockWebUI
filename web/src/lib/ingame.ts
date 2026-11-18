import type { CommandDef } from '@/types'

/**
 * 「哪些 `allowServer=false` 的指令可以在网页里执行」的策略。
 *
 * 判定方永远是服务器：后端 `TSWUI_ALLOW_INGAME_COMMANDS`（总闸）+ `TSWUI_INGAME_COMMANDS`（名单）
 * + 插件 `InGameOnlyAllowlist`（执行侧复检）。前端只照能力矩阵显示，
 * 提前拦下是为了不发无意义的请求，并且**把原因说清楚**（见 `ingameDenial`）。
 */
export interface IngamePolicy {
  /** 后端总闸 + 插件都在（`batch.ingame && batch.plugin`）。 */
  enabled: boolean
  /** 放行名单（小写、规范名）；空数组 = 不限定。 */
  commands: string[]
  /** 信使插件是否在装；缺省视为在装（测试 / 旧数据）。 */
  plugin?: boolean
  /** 上游 TShock 是否可达；缺省视为可达。 */
  reachable?: boolean
}

export const NO_INGAME: IngamePolicy = {
  enabled: false,
  commands: [],
  plugin: true,
  reachable: true,
}

/** `/spawnboss eye` → `spawnboss`。 */
export function commandToken(command: string): string {
  return (command.trim().replace(/^\/+/, '').split(/\s+/)[0] ?? '').toLowerCase()
}

/** 这条指令能不能以真实在线玩家身份执行。 */
export function ingameAllows(
  policy: IngamePolicy,
  names: Array<string | undefined | null>,
): boolean {
  return ingameDenial(policy, names) === null
}

/** 为什么不能执行（`null` = 可以执行）；文案由调用方按它选择，不靠一句笼统的话。 */
export type IngameDenial = 'unreachable' | 'no_plugin' | 'disabled' | 'not_in_list'

export function ingameDenial(
  policy: IngamePolicy,
  names: Array<string | undefined | null>,
): IngameDenial | null {
  if (policy.reachable === false) return 'unreachable'
  if (policy.plugin === false) return 'no_plugin'
  if (!policy.enabled) return 'disabled'
  if (policy.commands.length === 0) return null
  const allowed = new Set(policy.commands.map((c) => c.toLowerCase()))
  const hit = names.some((name) => Boolean(name) && allowed.has((name as string).toLowerCase()))
  return hit ? null : 'not_in_list'
}

/** 指令行 + 数据定义 → 不能执行的原因（`null` = 可以执行）。 */
export function ingameDenialOfCommand(
  policy: IngamePolicy,
  command: string,
  def?: CommandDef | null,
): IngameDenial | null {
  return ingameDenial(policy, [commandToken(command), def?.name, ...(def?.aliases ?? [])])
}

/** 指令行 + 数据定义 → 是否放行。 */
export function ingameAllowsCommand(
  policy: IngamePolicy,
  command: string,
  def?: CommandDef | null,
): boolean {
  return ingameDenialOfCommand(policy, command, def) === null
}

/** 从能力矩阵的 `batch` 字段（+ 上游可达性）归一成策略。 */
export function ingamePolicyFrom(
  batch: { plugin?: boolean; ingame?: boolean; ingameCommands?: string[] } | undefined | null,
  reachable = true,
): IngamePolicy {
  return {
    enabled: batch?.plugin === true && batch?.ingame === true,
    plugin: batch?.plugin === true,
    reachable,
    commands: (batch?.ingameCommands ?? []).map((name) => name.toLowerCase()),
  }
}
