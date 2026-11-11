/**
 * 复制文本到剪贴板，**永不抛错**：成功返回 `true`，失败返回 `false`。
 *
 * 为什么不能只用 `navigator.clipboard`：它只在**安全上下文**（`https:` / `localhost`）里存在，
 * 而本项目的常规部署是 `http://IP:8080`（`设计原则与约束.md` C12）。那种页面里
 * `navigator.clipboard` 是 `undefined`，`navigator.clipboard.writeText(...)` 会**同步抛 TypeError**
 * （不是 Promise 拒绝，`.catch` 接不住）。所以：
 *
 * 1. 有 Clipboard API 就先用（现代浏览器 + https/localhost）；
 * 2. 否则退回隐藏 `textarea` + `document.execCommand('copy')`（http 下仍可用，虽已废弃）；
 * 3. 两条都失败才返回 `false` —— 调用方据此**不显示「已复制」**，不假装成功。
 */
export async function copyText(text: string): Promise<boolean> {
  const clipboard =
    typeof navigator !== 'undefined'
      ? (navigator.clipboard as { writeText?: (value: string) => Promise<void> } | undefined)
      : undefined
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // 权限被拒 / 页面失焦：继续走兜底，不要在这里判定失败。
    }
  }
  return copyWithExecCommand(text)
}

/** 隐藏 textarea + `execCommand('copy')`（非安全上下文的唯一可用路径）。 */
function copyWithExecCommand(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  // 不能用 `display: none` / `visibility: hidden`：那种元素选不中，execCommand 会失败。
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '-9999px'
  area.style.opacity = '0'
  document.body.appendChild(area)

  // 复制会抢走选区：记下原来的，复制完还回去（键盘用户不会丢焦点上下文）。
  const selection = typeof document.getSelection === 'function' ? document.getSelection() : null
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  let ok = false
  try {
    area.select()
    area.setSelectionRange(0, area.value.length)
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    document.body.removeChild(area)
    if (previous && selection) {
      selection.removeAllRanges()
      selection.addRange(previous)
    }
  }
  return ok
}
