/**
 * 指令卡片的「参数化指令」：卡片不再只是写死的一条指令，而是绑定指令库里的一个用法形态
 * （`data/commands.json` / `lib/commandMeta.ts` 的 `paramSets`），由参数表生成卡片上的输入项。
 *
 * 存储形态（`tswui:homeCards` 的 `custom[]`、`tswui:moduleCards`）：
 * - 老卡片只有 `{ name, command }` —— 原样执行，行为不变；
 * - 新卡片多一个 `template` —— 执行前用 `buildCardCommand()` 把值拼进指令。
 *
 * 参数取值策略（`mode`）：
 * - `fill`：卡片上留一个输入框，每次执行前填（值同时作为下次的默认值）；
 * - `fixed`：值固定在卡片里（等价于老卡片写死的指令，只是有控件帮忙选）；
 * - `omit`：不传（可选参数 / 可选字面子命令如 `/region info <区域> [-d]`）。
 *
 * 「参数值怎么填」不改指令库：语法、必填、枚举取值、字面量子命令全部来自 `paramSets`，不手写模板。
 */

import type { CommandDef, CommandParam, CommandParamSet, Dataset, Lang } from '@/types'
import { enumLabelsFor } from './commandMeta'
import { firstCommandLine } from './commands'

export type CardArgMode = 'fill' | 'fixed' | 'omit'

export interface CardArgState {
  mode: CardArgMode
  /** `fill` / `fixed` 的值（原样保存，拼指令时才加引号）；字面子命令不用它。 */
  value: string
}

/** 卡片绑定的参数化指令。 */
export interface CardTemplate {
  /** 规范指令名（小写、不含前导 `/`）。 */
  command: string
  /** 选中的用法形态（`CommandParamSet.syntax`）；指令库变化后靠它重新对上。 */
  syntax: string
  /** 与 `paramSet.args` 一一对应（含字面子命令）。 */
  args: CardArgState[]
}

export function isLiteralArg(arg: CommandParam): boolean {
  return typeof arg.literal === 'string' && arg.literal.length > 0
}

/** 某个参数在界面上默认的取值策略：必填 → 执行时填，可选 → 不传，字面量子命令 → 固定。 */
export function defaultArgMode(arg: CommandParam): CardArgMode {
  if (isLiteralArg(arg)) return arg.required === false ? 'omit' : 'fixed'
  return arg.required ? 'fill' : 'omit'
}

/** 用参数表生成一份默认模板（没有非字面量参数时模板没有意义，调用方应改用普通卡片）。 */
export function templateFromSet(command: string, set: CommandParamSet): CardTemplate {
  return {
    command: command.trim().replace(/^\/+/, '').toLowerCase(),
    syntax: set.syntax,
    args: set.args.map((arg) => ({
      mode: defaultArgMode(arg),
      value: isLiteralArg(arg) ? (arg.literal as string) : '',
    })),
  }
}

/** 这条用法里有没有「要填值」的参数（只有字面量子命令的用法不需要参数卡片）。 */
export function hasValueParams(set: CommandParamSet): boolean {
  return set.args.some((arg) => !isLiteralArg(arg))
}

/** 卡片上是否会出现输入框（有任意 `fill` 参数）。 */
export function hasFillParams(template: CardTemplate): boolean {
  return template.args.some((a) => a.mode === 'fill')
}

/**
 * 这张卡片是否必须手动执行：有「执行时填」的参数时，自动刷新 / 批量执行没有值可填，
 * 用上次的值跑等于悄悄替用户做了决定（`/give` 尤其不能这样）。
 */
export function needsUserInput(card: { template?: CardTemplate }): boolean {
  return Boolean(card.template && hasFillParams(card.template))
}

/**
 * 参数值里的空格必须加双引号（`Commands.cs` 的 `ParseParameters` 支持引号，见
 * `docs/功能-指令多级补全与备注.md`）。值里自带的引号会被去掉：TShock 不解析转义引号。
 */
export function quoteParamValue(value: string): string {
  const cleaned = value.replace(/"/g, '')
  return /\s/.test(cleaned) ? `"${cleaned}"` : cleaned
}

export interface BuiltCardCommand {
  /** 实际要执行的指令（含前导 `/`）。 */
  command: string
  /** 缺值的必填参数下标（空数组 = 可以执行）。 */
  missing: number[]
}

/**
 * 按参数表把卡片的值拼成一条指令。
 *
 * - `omit` 直接跳过；可选参数留空也等同于不传（不拼出空占位）；
 * - 必填参数没值 → 记进 `missing`，调用方据此禁用执行（绝不发一条半截指令）；
 * - 字面量子命令按 `mode` 决定是否带（如 `/region info <区域> [-d]`）。
 */
export function buildCardCommand(template: CardTemplate, set: CommandParamSet): BuiltCardCommand {
  const pieces: string[] = [`/${template.command}`]
  const missing: number[] = []
  set.args.forEach((arg, index) => {
    const state = template.args[index]
    if (!state || state.mode === 'omit') {
      if (arg.required && !isLiteralArg(arg)) missing.push(index)
      return
    }
    if (isLiteralArg(arg)) {
      pieces.push(arg.literal as string)
      return
    }
    const value = state.value.trim()
    if (!value) {
      if (arg.required) missing.push(index)
      return
    }
    pieces.push(quoteParamValue(value))
  })
  return { command: pieces.join(' '), missing }
}

export interface ResolvedCardTemplate {
  def: CommandDef
  set: CommandParamSet
}

/**
 * 把卡片模板对回指令库：指令还在、用法形态（`syntax`）还在、参数个数一致才算可用。
 *
 * 对不上就返回 null —— 调用方把卡片降级成「指令库已变化，请重新配置」，而不是拿着旧参数
 * 拼一条可能是错的指令发出去。
 */
export function resolveCardTemplate(
  dataset: Dataset,
  template: CardTemplate | undefined,
): ResolvedCardTemplate | null {
  if (!template) return null
  const def = dataset.commandsByToken.get(template.command)
  if (!def) return null
  const set = def.paramSets?.find((s) => s.syntax === template.syntax)
  if (!set) return null
  if (set.args.length !== template.args.length) return null
  return { def, set }
}

/** 参数在界面上的名字（字面子命令用原文）。 */
export function argLabel(arg: CommandParam, index: number, lang: Lang): string {
  if (isLiteralArg(arg)) return arg.literal as string
  return arg.name?.trim() || (lang === 'en' ? `arg ${index + 1}` : `参数 ${index + 1}`)
}

/** 参数类型的常用中文名（「还需要填写：玩家」这类整句里用它，比英文参数名好读）。 */
const KIND_LABEL: Partial<Record<NonNullable<CommandParam['kind']>, [string, string]>> = {
  player: ['玩家', 'Player'],
  item: ['物品', 'Item'],
  npc: ['生物', 'NPC'],
  buff: ['增益', 'Buff'],
  prefix: ['词缀', 'Prefix'],
  region: ['区域', 'Region'],
  warp: ['传送点', 'Warp'],
  group: ['用户组', 'Group'],
  permission: ['权限', 'Permission'],
  command: ['指令', 'Command'],
  number: ['数值', 'Number'],
  text: ['文本', 'Text'],
  enum: ['取值', 'Value'],
}

/** 缺值提示里的参数称呼：能按类型翻译就用中文类型名，否则用库里的参数名。 */
export function argMissingLabel(arg: CommandParam, index: number, lang: Lang): string {
  const pair = arg.kind ? KIND_LABEL[arg.kind] : undefined
  if (pair) return lang === 'en' ? pair[1] : pair[0]
  return argLabel(arg, index, lang)
}

/** 参数值的输入提示（取值来源 / 是否必填），只用于 placeholder，不替代校验。 */
export function argPlaceholder(arg: CommandParam, lang: Lang): string {
  const zh = lang !== 'en'
  if (arg.kind === 'enum') return zh ? '选择取值' : 'Choose a value'
  const kindHint: Partial<Record<NonNullable<CommandParam['kind']>, [string, string]>> = {
    player: ['玩家名', 'Player'],
    item: ['物品名或 ID', 'Item name or ID'],
    npc: ['NPC 名或 ID', 'NPC name or ID'],
    buff: ['Buff 名或 ID', 'Buff name or ID'],
    prefix: ['词缀名或 ID', 'Prefix name or ID'],
    region: ['区域名', 'Region'],
    warp: ['传送点名', 'Warp'],
    group: ['用户组', 'Group'],
    permission: ['权限节点', 'Permission'],
    // 「指令」类型是参数（要查的那一条），别和卡片自己的指令混为一谈。
    command: ['要查的指令名', 'Command to look up'],
    number: ['数字', 'Number'],
    text: ['文本', 'Text'],
  }
  const hint = arg.kind ? kindHint[arg.kind] : undefined
  if (hint) return zh ? hint[0] : hint[1]
  return arg.required ? (zh ? '必填' : 'Required') : zh ? '可留空' : 'Optional'
}

/** 结构校验：localStorage 里的模板可能被改坏 / 版本更旧，非法一律丢弃（卡片退回普通指令）。 */
export function sanitizeCardTemplate(value: unknown): CardTemplate | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<CardTemplate>
  const command = typeof raw.command === 'string' ? raw.command.trim().replace(/^\/+/, '') : ''
  const syntax = typeof raw.syntax === 'string' ? raw.syntax.trim() : ''
  if (!command || !syntax) return undefined
  if (!Array.isArray(raw.args)) return undefined
  const args: CardArgState[] = []
  for (const item of raw.args) {
    if (!item || typeof item !== 'object') return undefined
    const mode = (item as { mode?: unknown }).mode
    if (mode !== 'fill' && mode !== 'fixed' && mode !== 'omit') return undefined
    const rawValue = (item as { value?: unknown }).value
    args.push({ mode, value: typeof rawValue === 'string' ? rawValue : '' })
  }
  return { command: command.toLowerCase(), syntax, args }
}

// ── 指令库搜索（添加卡片时选指令） ──────────────────────────────────────────

/** 归一化搜索词：前导 `/` 不参与匹配（玩家习惯直接粘 `/give`）。 */
function normalizeQuery(query: string): string {
  return query
    .trim()
    .replace(/^\/+/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * 在指令库里搜指令：名称 / 别名 / 帮助 / 参数名 / 枚举取值的备注名。
 *
 * 只做前缀与子串匹配 + 计分排序（不做模糊匹配）：指令库只有 90 多条，
 * 玩家找的多半是「名字里有没有这个词」，可预期的排序比花哨的算法好用。
 */
export function searchCardCommands(
  dataset: Dataset,
  query: string,
  lang: Lang = 'zh',
  limit = 60,
): CommandDef[] {
  const q = normalizeQuery(query)
  const scored: { def: CommandDef; score: number }[] = []
  for (const def of dataset.commands) {
    const score = q ? commandScore(dataset, def, q, lang) : 0
    if (score < 0) continue
    scored.push({ def, score })
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.def.name.length - b.def.name.length ||
      a.def.name.localeCompare(b.def.name),
  )
  return scored.slice(0, limit).map((row) => row.def)
}

/** 命中优先级：数字越小越靠前；-1 = 不命中。 */
function commandScore(dataset: Dataset, def: CommandDef, q: string, lang: Lang): number {
  const name = def.name.toLowerCase()
  if (name === q) return 0
  if (name.startsWith(q)) return 1
  const aliases = def.aliases.map((a) => a.toLowerCase())
  if (aliases.some((a) => a === q)) return 2
  if (aliases.some((a) => a.startsWith(q))) return 3
  if (name.includes(q)) return 4
  if (aliases.some((a) => a.includes(q))) return 5
  const help = `${def.helpZh ?? ''} ${def.help ?? ''} ${def.helpEn ?? ''}`.toLowerCase()
  if (help.includes(q)) return 6
  // 参数名 / 字面子命令 / 枚举取值的中文名（搜「白天」也能找到 /time）
  const paramText: string[] = []
  for (const set of def.paramSets ?? []) {
    for (const arg of set.args) {
      if (arg.literal) paramText.push(arg.literal)
      if (arg.name) paramText.push(arg.name)
    }
  }
  const labels = enumLabelsFor(def.name, lang, dataset.npcs)
  paramText.push(...Object.values(labels))
  if (paramText.join(' ').toLowerCase().includes(q)) return 7
  return -1
}

/** 卡片指令的用法摘要（列表右侧展示）：`give <item type/id> <player> …`。 */
export function templateSummary(set: CommandParamSet): string {
  const args = set.syntax.replace(/^\S+\s*/, '').trim()
  return args || '—'
}

// ── 卡片运行状态 ────────────────────────────────────────────────────────────

/**
 * 卡片当前的执行状态：能不能跑、跑什么、还缺什么。
 *
 * - 老卡片（没有模板）：指令原文归一后照常执行；
 * - 模板对不上指令库（指令被移除 / 用法串变了 / 参数个数变了）：`broken`，卡片提示重新配置，**不发请求**；
 * - 必填参数没值：`command` 为 null，`missing` 给出要补的参数下标（页脚仍显示已填部分做预览）。
 */
export interface CardRunState {
  /** 可执行指令；null = 现在不能执行 */
  command: string | null
  /** 页脚预览（缺参数 / 模板失效时也给出可读内容） */
  preview: string
  /** 缺值的必填参数下标 */
  missing: number[]
  /** 模板对不上指令库 */
  broken: boolean
  /** 解析出的参数表（卡片上渲染输入框用）；普通卡片为 null */
  resolved: ResolvedCardTemplate | null
}

export interface CardLike {
  command: string
  template?: CardTemplate
}

/** 老卡片的指令归一：取第一条非空行、补前导 `/`。 */
export function normalizeLegacyCommand(input: string): string {
  const line = firstCommandLine(input).trim()
  if (!line) return ''
  return line.startsWith('/') ? line : `/${line}`
}

export function cardRunState(dataset: Dataset, card: CardLike): CardRunState {
  if (!card.template) {
    const command = normalizeLegacyCommand(card.command)
    return { command: command || null, preview: command, missing: [], broken: false, resolved: null }
  }
  const resolved = resolveCardTemplate(dataset, card.template)
  if (!resolved) {
    return {
      command: null,
      preview: `/${card.template.command}`,
      missing: [],
      broken: true,
      resolved: null,
    }
  }
  const built = buildCardCommand(card.template, resolved.set)
  return {
    command: built.missing.length === 0 ? built.command : null,
    preview: built.command,
    missing: built.missing,
    broken: false,
    resolved,
  }
}

// ── 指令输入框的解析（添加 / 编辑卡片面板用） ────────────────────────────────

export interface CardCommandInput {
  /** 去掉前导 `/` 的指令名（只取第一个词，小写）。 */
  token: string
  /** 指令名之后的原文（可能为空；参数卡片不该有）。 */
  args: string
  /** 指令库里对应的指令；没收录为 null。 */
  def: CommandDef | null
}

/**
 * 解析「指令」输入框：`/give`、`give`、`/give 29 张三` 都认。
 *
 * 参数卡片只接受指令名 —— 带了参数由调用方提示「参数请在「指令参数」里填」，
 * 不去猜那些多出来的词该落到哪个参数上。
 */
export function parseCardCommandInput(dataset: Dataset, input: string): CardCommandInput {
  const line = firstCommandLine(input).trim().replace(/^\/+/, '')
  const match = /^(\S*)\s*([\s\S]*)$/.exec(line)
  const token = (match?.[1] ?? '').toLowerCase()
  const args = (match?.[2] ?? '').trim()
  return { token, args, def: token ? (dataset.commandsByToken.get(token) ?? null) : null }
}
