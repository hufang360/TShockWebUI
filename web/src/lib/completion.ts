import { searchItems } from './items'
import { enumLabelsFor } from './commandMeta'
import type { CommandDef, CommandParam, CommandParamSet, Dataset, Item, Lang } from '@/types'

export type CompletionKind =
  | 'command'
  | 'item'
  | 'player'
  | 'prefix'
  | 'enum'
  | 'npc'
  | 'buff'
  | 'region'
  | 'warp'
  | 'permission'
  | 'group'

/**
 * 参数候选（取值 / 字面量子命令）最多列出多少条。
 * 比指令 / 玩家名的 12 条宽：多级子命令 + 取值可能几十条，太少会截断（如 `/fish` 有 18 个子命令）。
 * 下拉框自身可滚动，最多 72rem 高（见 CommandEditor）。
 */
const PARAM_SUGGESTION_LIMIT = 50

export interface CompletionItem {
  id: string
  kind: CompletionKind
  label: string
  detail: string
  /** 确认后插入编辑器的文本 */
  insert: string
  item?: Item
  command?: CommandDef
  /** allowServer=false：可插入但会提示只能在游戏内执行 */
  inGameOnly?: boolean
  /** 参数补全的替换范围（引号感知）。缺省时按空白分隔的词计算。 */
  range?: { start: number; end: number }
  /** 确认后追加的文本（参数值补一个空格，便于继续输入下一个参数）。 */
  suffix?: string
}

export interface CompletionInput {
  dataset: Dataset
  text: string
  caret: number
  players: string[]
  limit?: number
  /** 界面语言，决定指令帮助文本取中文还是英文 */
  lang?: Lang
  /**
   * 运行时补全数据（来自信使插件 /api/data）：区域 / 传送点只在 TShock 运行时存在，
   * 无法离线生成，因此由调用方登录后拉取并注入。
   */
  runtimeValues?: { regions?: string[]; warps?: string[] }
}

/** 计算光标所在词的替换范围（补全用）。 */
export interface WordRange {
  start: number
  end: number
}

/**
 * 求需要被补全替换的文本范围。
 * - 指令（首 token）：从 0 到首个空白（并吞掉后续空白），避免 `/help` 后拼接成 `/help time` 双空格。
 * - 参数：光标两侧同一“词”（以空白分隔）的整体范围。
 */
export function completionWordRange(text: string, caret: number, isCommand: boolean): WordRange {
  if (isCommand) {
    let end = text.search(/\s/)
    if (end === -1) end = text.length
    while (end < text.length && /\s/.test(text[end])) end++
    return { start: 0, end }
  }
  const before = text.slice(0, caret)
  const start = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'), before.lastIndexOf('\t')) + 1
  let end = caret
  while (end < text.length && !/\s/.test(text[end])) end++
  return { start, end }
}

/** 补全确认后应插入的文本（指令与参数值后各带一个空格）。 */
export function completionSnippet(item: CompletionItem): string {
  return `${item.insert}${item.kind === 'command' ? ' ' : (item.suffix ?? '')}`
}

/** 纯函数：返回补全后的完整文本与光标位置（便于单测）。 */
export function applyCompletion(
  text: string,
  caret: number,
  item: CompletionItem,
): { text: string; caret: number; start: number; end: number; snippet: string } {
  const snippet = completionSnippet(item)
  const { start, end } =
    item.range ?? completionWordRange(text, caret, item.kind === 'command')
  return {
    text: text.slice(0, start) + snippet + text.slice(end),
    caret: start + snippet.length,
    start,
    end,
    snippet,
  }
}

// ── 参数补全（数据来自 TShock 源码用法串，见 tools/gen-data.mjs）─────────────
//
// 设计约束：
//   1. 只有 data/commands.json 里带 paramSets 的指令才有参数补全；其余保持自由输入。
//   2. 只提供本地确实有数据源的候选（在线玩家 / 物品 / 词缀 / 源码里的枚举值 / 指令名）。
//   3. 候选一律用**无歧义的写法**插入：物品与词缀插 ID（TShock 的
//      GetItemByIdOrName / GetPrefixByIdOrName 都接受数字 ID），含空格的枚举值加双引号
//      （TShock Commands.cs:755 ParseParameters 支持引号）。
//   4. 词/范围计算是引号感知的，避免把已输入的双引号参数截断。

/** 参数词（引号感知）。 */
interface ArgToken {
  value: string
  start: number
  end: number
}

/** 从 `from` 起把文本切成参数词，`"..."` 视为一个整体。 */
export function tokenizeArgs(text: string, from: number): ArgToken[] {
  const out: ArgToken[] = []
  let i = from
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++
    if (i >= text.length) break
    const start = i
    let value = ''
    if (text[i] === '"') {
      i++
      while (i < text.length && text[i] !== '"') {
        value += text[i]
        i++
      }
      if (i < text.length) i++ // 收尾引号
    } else {
      while (i < text.length && !/\s/.test(text[i])) {
        value += text[i]
        i++
      }
    }
    out.push({ value, start, end: i })
  }
  return out
}

/** 首段（指令名）之后的起始下标；没有参数时为 -1。 */
function paramsStart(text: string): number {
  const m = text.search(/[\s\n\t]/)
  return m === -1 ? -1 : m
}

/** 用首段解析出指令（去斜杠，支持别名）。 */
export function resolveCommand(dataset: Dataset, firstToken: string): CommandDef | null {
  const token = firstToken.trim().replace(/^\/+/, '').toLowerCase()
  return token ? (dataset.commandsByToken.get(token) ?? null) : null
}

/**
 * 把已输入的参数词对齐到某个形态（paramSet）的参数下标。
 * 字面子命令必须逐字匹配，否则该形态不适用；返回匹配到的字面量数量作为优先级。
 */
function alignSet(set: CommandParamSet, args: ArgToken[]): { argIdx: number; literalScore: number } | null {
  let argIdx = 0
  let literalScore = 0
  for (const t of args) {
    const arg = set.args[argIdx]
    if (!arg) return { argIdx, literalScore } // 超出申明参数（自由追加）
    if (arg.literal) {
      if (t.value.toLowerCase() !== arg.literal.toLowerCase()) return null
      literalScore++
      argIdx++
      continue
    }
    if (!arg.variadic) argIdx++
  }
  return { argIdx, literalScore }
}

/** 光标所在的参数位。 */
export interface ParamSlot {
  command: CommandDef
  set: CommandParamSet
  /** 当前参数；超出申明范围时为 null（此时退回旧的玩家名补全） */
  arg: CommandParam | null
  /** 已输入的值（未含引号） */
  word: string
  start: number
  end: number
  /** 光标所在参数词的序号（用于列出所有匹配形态的字面量子命令） */
  editingIdx: number
  /** 参数词（引号感知，含 start/end） */
  tokens: ArgToken[]
}

/** 计算光标所在的参数位（纯函数）。指令只有一段或没有参数表时返回 null。 */
export function matchParamSlot(dataset: Dataset, text: string, caret: number): ParamSlot | null {
  const from = paramsStart(text)
  if (from === -1 || caret <= from) return null
  const command = resolveCommand(dataset, text.slice(0, from))
  const sets = command?.paramSets
  if (!command || !sets || sets.length === 0) return null

  const tokens = tokenizeArgs(text, from)
  // caret <= token.end 且（未到词尾 或 已在文末）→ 正在编辑该词；否则是在追加新参数。
  let editingIdx = tokens.findIndex(
    (t) => caret >= t.start && caret <= t.end && (caret < t.end || t.end === text.length),
  )
  let word = ''
  if (editingIdx >= 0) {
    word = tokens[editingIdx].value
  } else {
    editingIdx = tokens.filter((t) => t.end <= caret).length
  }
  const prior = tokens.slice(0, editingIdx)

  let best: { set: CommandParamSet; argIdx: number; literalScore: number } | null = null
  for (const set of sets) {
    const hit = alignSet(set, prior)
    if (!hit) continue
    if (!best || hit.literalScore > best.literalScore) best = { set, ...hit }
  }
  if (!best) return null

  const start = editingIdx < tokens.length ? tokens[editingIdx].start : caret
  const end = editingIdx < tokens.length ? tokens[editingIdx].end : caret
  return {
    command,
    set: best.set,
    arg: best.set.args[best.argIdx] ?? null,
    word,
    start,
    end,
    editingIdx,
    tokens,
  }
}

/** 指令的参数用法串（用于编辑器下方的参数提示）；有 `noteZh` / `noteEn` 时拼在后面。 */
export function paramHintFor(
  dataset: Dataset,
  text: string,
  caret: number,
  lang: Lang = 'zh',
): string | null {
  const slot = matchParamSlot(dataset, text, caret)
  if (!slot) return null
  const note = lang === 'en' ? slot.set.noteEn : slot.set.noteZh
  return note ? `${slot.set.syntax}　${note}` : slot.set.syntax
}

/**
 * 字面量子命令补全（如 `/pm export`、`/region define`、`/worldevent invasion`）。
 *
 * `matchParamSlot` 只会挑出一个“最佳形态”，列不全同一层的子命令；
 * 这里拿当前光标位置，遍历**所有**形态，把能匹配前置词的字面量都收集起来。
 */
function computeLiteralCompletions(
  dataset: Dataset,
  slot: ParamSlot,
  lang: Lang,
): CompletionItem[] {
  const prior = slot.tokens.slice(0, slot.editingIdx)
  const labels = enumLabelsFor(slot.command.name, lang, dataset.npcs)
  const out: CompletionItem[] = []
  const seen = new Set<string>()
  for (const set of slot.command.paramSets ?? []) {
    const hit = alignSet(set, prior)
    if (!hit) continue
    const arg = set.args[hit.argIdx]
    if (!arg?.literal || seen.has(arg.literal)) continue
    seen.add(arg.literal)
    out.push({
      id: `param:literal:${slot.command.name}:${arg.literal}`,
      kind: 'enum',
      label: arg.literal,
      detail: labels[arg.literal] ?? (lang === 'en' ? 'Sub-command' : '子命令'),
      insert: arg.literal,
      range: { start: slot.start, end: slot.end },
      suffix: ' ',
    })
  }
  const lower = slot.word.toLowerCase()
  if (!lower) return out.slice(0, PARAM_SUGGESTION_LIMIT)
  const starts = out.filter((c) => c.label.toLowerCase().startsWith(lower))
  const matched = starts.length
    ? starts
    : out.filter((c) => c.label.toLowerCase().includes(lower))
  return matched.slice(0, PARAM_SUGGESTION_LIMIT)
}

/** 计算当前光标处的补全候选（纯函数，便于测试）。 */
export function computeCompletions({
  dataset,
  text,
  caret,
  players,
  limit = 12,
  lang = 'zh',
  runtimeValues,
}: CompletionInput): CompletionItem[] {
  const before = text.slice(0, caret)
  const whitespaceIdx = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'), before.lastIndexOf('\t'))
  const wordStart = whitespaceIdx + 1
  const word = before.slice(wordStart)
  const firstTokenEnd = text.search(/[\s\n]/)
  const caretInFirstToken = caret <= (firstTokenEnd === -1 ? text.length : firstTokenEnd)

  if (caretInFirstToken) {
    const token = word.replace(/^\/+/, '').toLowerCase()
    const matches = dataset.commands
      .filter((cmd) => {
        if (!token) return true
        if (cmd.name.toLowerCase().startsWith(token)) return true
        if (cmd.name.toLowerCase().includes(token)) return true
        return cmd.aliases.some((a) => a.toLowerCase().includes(token))
      })
      .sort((a, b) => {
        const at = a.name.toLowerCase()
        const bt = b.name.toLowerCase()
        const ap = at.startsWith(token) ? 0 : 1
        const bp = bt.startsWith(token) ? 0 : 1
        return ap - bp || at.localeCompare(bt)
      })
      .slice(0, limit)

    return matches.map((cmd) => {
      const help = (lang === 'en' ? (cmd.helpEn ?? cmd.help) : (cmd.helpZh ?? cmd.help)) || ''
      const aliasText =
        cmd.aliases.length > 0
          ? `${lang === 'en' ? 'Aliases' : '别名'}：${cmd.aliases.map((a) => `/${a}`).join(' ')}`
          : ''
      return {
        id: `cmd:${cmd.name}`,
        kind: 'command',
        label: `/${cmd.name}`,
        detail: [help, aliasText].filter(Boolean).join(' · '),
        insert: `/${cmd.name}`,
        command: cmd,
        inGameOnly: !cmd.allowServer,
      }
    })
  }

  const slot = matchParamSlot(dataset, text, caret)

  // 1) 参数补全：按 TShock 源码的用法串判定「当前是第几个参数」，再按参数类型给候选。
  //    必须在 `if (!word)` 之前——打完参数补一个空格时 word 为空，仍需给出下一个参数的候选。
  const paramItems = computeParamCompletions({ dataset, text, caret, players, limit, lang, runtimeValues })
  if (paramItems.length > 0) return paramItems

  // 2) 参数位已确定但没有候选（text / number 等本地无数据源的参数）→ 不给无关候选，
  //    避免在 /time、/clear 这类严格取值处弹出玩家名误导玩家。
  if (slot?.arg) return []

  if (!word) return []

  // 3) 其余情况（指令没有参数表 / 已超出申明参数）保持原有行为：补全在线玩家名。
  const lower = word.toLowerCase()
  return players
    .filter((p) => p.toLowerCase().includes(lower))
    .slice(0, limit)
    .map((p) => ({
      id: `player:${p}`,
      kind: 'player' as const,
      label: p,
      detail: lang === 'en' ? 'Online player' : '在线玩家',
      insert: p,
    }))
}

/** 参数值补全（按参数类型取本地数据源）。 */
export function computeParamCompletions({
  dataset,
  text,
  caret,
  players,
  limit = 12,
  lang = 'zh',
  runtimeValues,
}: CompletionInput & { limit?: number }): CompletionItem[] {
  const slot = matchParamSlot(dataset, text, caret)
  if (!slot?.arg) return []

  // 字面量子命令（如 /pm export、/region define、/worldevent invasion）：
  // 把所有匹配形态里的字面量收集起来，与下面的按类型候选合并。
  const literalItems = computeLiteralCompletions(dataset, slot, lang)

  const { arg, word, start, end } = slot
  const range = { start, end }
  const lower = word.toLowerCase()
  // 先按前缀匹配，没有前缀命中再退回子串匹配（'ni' → night，而不是 night+midnight）。
  const filter = <T,>(list: T[], key: (x: T) => string[]): T[] => {
    if (!lower) return list
    const keys = list.map((x) => key(x).map((k) => k.toLowerCase()))
    const starts = list.filter((_, i) => keys[i].some((k) => k.startsWith(lower)))
    return starts.length > 0 ? starts : list.filter((_, i) => keys[i].some((k) => k.includes(lower)))
  }
  const zh = lang !== 'en'
  const out: CompletionItem[] = []
  // 含空格的值必须加双引号（Commands.cs:755 ParseParameters 支持引号）。
  const quoteIfSpace = (v: string) => (/\s/.test(v) ? `"${v}"` : v)

  switch (arg.kind) {
    case 'player':
      for (const p of filter(players, (p) => [p])) {
        out.push({
          id: `param:player:${p}`,
          kind: 'player',
          label: p,
          detail: zh ? '在线玩家' : 'Online player',
          insert: p,
          range,
          suffix: ' ',
        })
      }
      break
    case 'item':
      for (const it of searchItems(dataset.items, word, limit)) {
        out.push({
          id: `param:item:${it.id}`,
          kind: 'item',
          label: `${it.name} (${it.id})`,
          detail: it.key,
          // 插 ID：TShock 的 GetItemByIdOrName 接受 ID，且不含空格/引号问题
          insert: String(it.id),
          item: it,
          range,
          suffix: ' ',
        })
      }
      break
    case 'prefix':
      for (const pf of filter(dataset.prefixes, (x) => [x.name, x.key]).slice(0, limit)) {
        out.push({
          id: `param:prefix:${pf.id}`,
          kind: 'prefix',
          label: `${pf.name} (${pf.id})`,
          detail: pf.key,
          insert: String(pf.id),
          range,
          suffix: ' ',
        })
      }
      break
    case 'npc':
      // 插数字 ID：TShock 的 GetNPCByIdOrName 接受 ID，且无空格/引号歧义。
      for (const n of filter(dataset.npcs, (x) => [x.name, x.key]).slice(0, limit)) {
        out.push({
          id: `param:npc:${n.id}`,
          kind: 'npc',
          label: `${n.name} (${n.id})`,
          detail: n.key,
          insert: String(n.id),
          range,
          suffix: ' ',
        })
      }
      break
    case 'permission':
      // 插节点原文（`tshock.world.time`）；候选项来自 TShock 源码里的内置节点，
      // 自定义/插件节点只有运行期知道 —— 这里只是候选，手输任意值仍然有效。
      for (const p of filter(dataset.permissions.permissions, (x) => [x.node, x.desc]).slice(0, limit)) {
        out.push({
          id: `param:permission:${p.node}`,
          kind: 'permission',
          label: p.node,
          detail: p.desc,
          insert: p.node,
          range,
          suffix: ' ',
        })
      }
      break
    case 'group':
      for (const g of filter(dataset.permissions.groups, (x) => [x]).slice(0, limit)) {
        out.push({
          id: `param:group:${g}`,
          kind: 'group',
          label: g,
          detail: zh ? '内置用户组' : 'Built-in group',
          insert: g,
          range,
          suffix: ' ',
        })
      }
      break
    case 'buff':
      for (const b of filter(dataset.buffs, (x) => [x.name, x.key]).slice(0, limit)) {
        out.push({
          id: `param:buff:${b.id}`,
          kind: 'buff',
          label: `${b.name} (${b.id})`,
          detail: b.key,
          insert: String(b.id),
          range,
          suffix: ' ',
        })
      }
      break
    case 'region':
      for (const r of filter(runtimeValues?.regions ?? [], (x) => [x]).slice(0, limit)) {
        out.push({
          id: `param:region:${r}`,
          kind: 'region',
          label: r,
          detail: zh ? '区域' : 'Region',
          insert: quoteIfSpace(r),
          range,
          suffix: ' ',
        })
      }
      break
    case 'warp':
      for (const w of filter(runtimeValues?.warps ?? [], (x) => [x]).slice(0, limit)) {
        out.push({
          id: `param:warp:${w}`,
          kind: 'warp',
          label: w,
          detail: zh ? '传送点' : 'Warp',
          insert: quoteIfSpace(w),
          range,
          suffix: ' ',
        })
      }
      break
    case 'enum': {
      // enum 取值在补全里附上可读备注名（如 spawnboss 的 brain → 克苏鲁之脑）；
      // 同时允许按备注名搜索（输入「克苏鲁」也能命中 brain）。
      const labels = enumLabelsFor(slot.command.name, lang, dataset.npcs)
      for (const v of filter(arg.values ?? [], (v) => [v, labels[v] ?? ''])) {
        out.push({
          id: `param:enum:${v}`,
          kind: 'enum',
          label: v,
          detail: labels[v] ?? (zh ? '可选值' : 'Allowed value'),
          // 含空格的值必须加双引号（Commands.cs:755 ParseParameters 支持引号）
          insert: /\s/.test(v) ? `"${v}"` : v,
          range,
          suffix: ' ',
        })
      }
      break
    }
    case 'command':
      for (const cmd of filter(dataset.commands, (c) => [c.name, ...c.aliases]).slice(0, limit)) {
        out.push({
          id: `param:command:${cmd.name}`,
          kind: 'command',
          label: cmd.name,
          detail: (zh ? cmd.helpZh : cmd.helpEn) ?? cmd.help ?? '',
          // 参数里的指令名不带斜杠（TShock 自己解析时也无所谓）
          insert: cmd.name,
          range,
          suffix: ' ',
        })
      }
      break
    default:
      break
  }
  // 字面量子命令排在前，再拼按类型候选；同 kind+insert 去重。
  const merged = [...literalItems]
  const seen = new Set(literalItems.map((c) => `${c.kind}:${c.insert}`))
  for (const c of out) {
    const key = `${c.kind}:${c.insert}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(c)
  }
  return merged.slice(0, PARAM_SUGGESTION_LIMIT)
}
