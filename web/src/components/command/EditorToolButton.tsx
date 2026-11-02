import { IconAction, type IconActionProps } from '@/components/IconAction'
import { cn } from '@/lib/cn'

interface EditorToolButtonProps extends Omit<IconActionProps, 'size' | 'variant'> {
  /** 对应面板是否已打开（打开时按钮底色抬升）。 */
  active?: boolean
}

/**
 * 指令输入条 / 聊天输入条上的**方形工具按钮**（物品、合成表、指令库）。
 *
 * 入口（`CommandPage` 的工具条）原本自己写了一份
 * `size="icon"` + `size-7` + 灰阶 + `[&_svg]:size-3` 的 `Button`：尺寸覆盖只写了 base，
 * 变体的 `md:size-9` 还在，实际尺寸是「手机 28 / 桌面 36」，比工具条标准还大。
 * 现在统一走 `icon-xs`（36 / 24），图标依旧是 12px——方形控制块（不是圆钮），
 * 视觉重量和输入框里的文字更接近。
 */
export function EditorToolButton({ className, ...rest }: EditorToolButtonProps) {
  return <IconAction {...rest} size="icon-xs" className={cn('[&_svg]:size-3', className)} />
}
