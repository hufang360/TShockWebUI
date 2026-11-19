import { registerCommandPalette } from '@/lib/commandPalette'

/**
 * 搜索面板的测试替身：`openCommandPalette()` 实际由 `App` 注册，单测里组件是独立渲染的，
 * 所以换成记录器 —— 断言「点了之后要唤起面板，并且填进去的是哪条指令」。
 */
let last = ''

export function installCommandPaletteSpy() {
  last = ''
  registerCommandPalette((query) => {
    last = query
  })
}

/** 最后填进搜索面板的那条指令（没唤起过 = `''`）。 */
export function lastFilled(): string {
  return last
}
