/**
 * 指令字符串拼装的小工具（多处在用：NPC 详情、小抄页、Buff 详情）。
 *
 * TShock 的 `CommandArgs.ParseParameters()` 会处理引号，所以**含空格的参数必须加引号**，
 * 否则会被拆成多个参数（如 `/tpnpc Traveling Merchant`）。
 */

/** 含空格（或空串）时加双引号；其余原样返回。 */
export function quoteArg(arg: string): string {
  const value = String(arg)
  if (!value) return '""'
  return /\s/.test(value) ? `"${value}"` : value
}

/**
 * `/gbuff <玩家> <buff>`（TShock `GBuff()`：`<player> <buff name|ID> [seconds]`）。
 * 用数字 ID，避免依赖服务器语言的 buff 名称；不传秒数时插件默认 60 秒。
 */
export function gbuffCommand(player: string, buffId: number): string {
  return `/gbuff ${quoteArg(player)} ${buffId}`
}
