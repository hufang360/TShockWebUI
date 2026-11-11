import { useRef } from 'react'

/**
 * 页面设置 Popover 的打开焦点：落到**第一个设置项**，而不是标题栏的「恢复默认」。
 *
 * Radix 的 `onOpenAutoFocus` 默认聚焦弹框里第一个可聚焦元素；标题栏加上图标按钮后，
 * 一打开就把它高亮出来，看着像「先点这里」。这里拦掉默认行为，手动把焦点交给设置项。
 */
export function useSettingsPopoverFocus() {
  const ref = useRef<HTMLDivElement>(null)

  const onOpenAutoFocus = (event: Event) => {
    event.preventDefault()
    ref.current
      ?.querySelector<HTMLElement>('[role="checkbox"], [role="combobox"], [role="switch"]')
      ?.focus()
  }

  return { ref, onOpenAutoFocus }
}
