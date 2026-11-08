import { cn } from '@/lib/cn'

/**
 * 详情抽屉的遮罩：**只盖内容区**，左侧边栏露着（抽屉开着也能点导航切页面）。
 *
 * 为什么不用 `SheetContent` / `DrawerContent` 自带的遮罩：它们是 `inset-0`，会把侧栏一起压暗并挡住导航。
 * 这里从 `--content-left`（内容区左边界，见 `AppShell`）开始；窄屏侧栏是抽屉本身、内容从 0 开始，所以
 * `left-0 md:left-[var(--content-left,0px)]`。
 *
 * 层级 `z-[45]`：高于页面内容（20）与浮动终端 / 全屏（40），低于抽屉本身和其它模态层（50）——
 * 这样「展开侧栏」按钮（`z-46`）能浮在遮罩上，抽屉面板仍在遮罩之上。
 */
export function ContentScrim({
  onClick,
  testId,
  className,
}: {
  onClick?: () => void;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'fixed inset-y-0 right-0 left-0 z-[45] bg-black/50 md:left-[var(--content-left,0px)]',
        className,
      )}
    />
  )
}
