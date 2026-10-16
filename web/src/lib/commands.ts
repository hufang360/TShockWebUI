import type { CommandDef, Dataset } from '@/types'

export interface ParsedCommand {
  /** 原始文本（保留用户输入） */
  raw: string
  /** 不带 / 的指令名（可能是别名） */
  token: string
  /** 指令名之后的参数部分（原样） */
  args: string
  /** 解析出的结构化定义；null 表示未知指令 */
  def: CommandDef | null
}

/** 取第一条非空行（指令为单行；多行只警告，不静默丢弃全部输入）。 */
export function firstCommandLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0)
  return line ?? ''
}

export function parseCommand(text: string): ParsedCommand | null {
  const line = firstCommandLine(text).trim()
  if (!line) return null
  const withoutSlash = line.replace(/^\/+/, '')
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(withoutSlash)
  if (!match) return null
  return {
    raw: line,
    token: match[1] ?? '',
    args: match[2] ?? '',
    def: null,
  }
}

export type Executability =
  /** 可以通过 rawcmd 执行（仍受 TShock 权限约束） */
  | 'executable'
  /** 不在内置白名单（如插件指令）：仍可执行，交由 TShock 判定 */
  | 'unverified'
  /** allowServer=false：只能在游戏内执行（C6），前端不发请求 */
  | 'in_game_only'

export interface CommandCheck {
  parsed: ParsedCommand | null
  def: CommandDef | null
  executability: Executability
  message: string
  /** 机器可读的拒绝原因，便于前端做 i18n（message 仅作兜底） */
  reason: CommandReason
  /** 归一化后的执行文本，保证带前导 / */
  normalized: string
  /** 输入包含多行非空内容（只执行第一行） */
  extraLines: boolean
}

export type CommandReason = 'empty' | 'unverified' | 'in_game_only' | null

/** 解析并给出前端执行策略（真正的权限判定在 TShock）。 */
export function inspectCommand(text: string, dataset: Dataset): CommandCheck {
  const parsed = parseCommand(text)
  const extraLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).length > 1
  if (!parsed) {
    return {
      parsed: null,
      def: null,
      executability: 'unverified',
      reason: 'empty',
      message: '请输入指令',
      normalized: '',
      extraLines,
    }
  }
  const def = dataset.commandsByToken.get(parsed.token.toLowerCase()) ?? null
  const normalized = `/${parsed.token}${parsed.args ? ` ${parsed.args}` : ''}`

  if (!def) {
    return {
      parsed,
      def: null,
      executability: 'unverified',
      reason: 'unverified',
      message: `未知指令 /${parsed.token}（不在内置白名单，将交由 TShock 校验）`,
      normalized,
      extraLines,
    }
  }
  if (!def.allowServer) {
    return {
      parsed,
      def,
      executability: 'in_game_only',
      reason: 'in_game_only',
      message: `/${def.name} 只能在游戏内执行，WebUI 无法通过 REST 执行`,
      normalized,
      extraLines,
    }
  }
  return {
    parsed,
    def,
    executability: 'executable',
    reason: null,
    message: '',
    normalized,
    extraLines,
  }
}
