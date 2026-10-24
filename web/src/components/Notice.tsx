import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui'

/**
 * 统一的「提示块」：警示色 `Alert` + 图标 + 标题（+ 可选说明）。
 * 用于插件未安装 / 无权限 / 探测失败等场景（玩家管理、鱼店等）。
 */
export function Notice({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
  /** 提示下方的操作（如「重新检测」）。 */
  action?: ReactNode
}) {
  return (
    <Alert variant="warning">
      {icon}
      <AlertTitle>{title}</AlertTitle>
      {(children || action) && (
        <AlertDescription>
          {children}
          {action}
        </AlertDescription>
      )}
    </Alert>
  )
}
