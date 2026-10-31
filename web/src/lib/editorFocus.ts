/**
 * 「跳到指令页、把焦点直接交给输入框」的一次性信号。
 *
 * 首页「最近执行」点一行后：写入草稿 → `onNavigate('editor')` → `CommandPage` 挂载。
 * 挂载后输入框虽然通常已经自动聚焦，但焦点在跨页时会因浏览器 / 布局抖动丢掉，
 * 用户点完还得再点一次输入框才能接着改。这里用一个模块级标记表达「这次跳转要聚焦」，
 * `CommandPage` 挂载时消费一次即可（`focusRequest` 令牌 +1 → 光标落到末尾）。
 *
 * 刻意不用 localStorage：只对本次跳转生效，刷新页面不会莫名其妙抢焦点。
 */
let pending = false

/** 请求「下一次进入指令页时聚焦输入框」。 */
export function requestEditorFocus() {
  pending = true
}

/** 消费信号（读到即清空，避免后续普通导航重复抢焦点）。 */
export function consumeEditorFocus(): boolean {
  const value = pending
  pending = false
  return value
}
