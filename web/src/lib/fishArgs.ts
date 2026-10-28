/**
 * 鱼店 `buy` 的 `args` 解析（与插件的 `RestApi.SplitRestArgs` 逐条对齐）。
 *
 * 来源：插件源码 `TShockFishShop/RestApi.cs` 的 `SplitRestArgs`，规则是
 * - 按空白拆分；
 * - 双引号包住的内容算同一个参数（`"我的 小屋"` → 1 个参数）；
 * - `\"` 与 `\\` 是转义，其余反斜杠原样保留；
 * - 引号本身不进入参数值。
 *
 * 前端只用它算「填了几个参数」来判断能不能点购买（`argCount`），
 * 真正的解析仍由插件做——所以这里必须与插件**完全一致**，否则会出现
 * 「按钮能点但插件认为参数不够」或反过来。
 */
export function splitFishArgs(raw: string): string[] {
  const out: string[] = []
  if (!raw) return out

  let buf = ''
  let inQuote = false

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]

    if (c === '\\' && i + 1 < raw.length && (raw[i + 1] === '"' || raw[i + 1] === '\\')) {
      buf += raw[i + 1]
      i++
      continue
    }

    if (c === '"') {
      inQuote = !inQuote
      continue
    }

    if (!inQuote && /\s/.test(c)) {
      if (buf) {
        out.push(buf)
        buf = ''
      }
      continue
    }

    buf += c
  }

  if (buf) out.push(buf)
  return out
}
