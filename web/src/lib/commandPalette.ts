/**
 * 把指令填进**全局搜索面板**（`Ctrl/Cmd+K`）——「填充指令」等价于打开搜索框再敲进这条指令：
 * 面板顶部就是「执行指令 /xxx」那一行，改完参数直接回车即可跑。
 *
 * 入口散落在多层组件里（抽屉 → 面板 → 相关指令行、小抄表格、搜索弹框自身），逐层透传回调要穿过六七层，
 * 所以这里由 `App` 注册一个回调（与 `lib/editorFocus.ts` 的一次性信号同风格）。
 */
let opener: ((query: string) => void) | null = null

export function registerCommandPalette(open: ((query: string) => void) | null) {
  opener = open
}

/** 唤起搜索面板并填入指令（只填不执行）。 */
export function openCommandPalette(query: string) {
  opener?.(query)
}
