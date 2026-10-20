import type { LucideIcon } from 'lucide-react'
import { PanelLeft, PanelLeftClose } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Button,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import type { TabId } from '@/types'

export interface NavItem {
  id: TabId
  label: string
  icon: LucideIcon
}

interface AppShellProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  /** 侧边栏导航项（由 App 按已激活模块动态生成）。 */
  nav: NavItem[]
  /** 侧栏页头（收起按钮旁）的额外控件，如语言 / 主题快捷切换。 */
  headerExtra?: ReactNode
  /** 侧栏底部的玩家状态 / 设置等 */
  headerRight: ReactNode
  /** 侧栏底部额外区域（账号卡片上方，如执行队列） */
  sidebarExtra?: ReactNode
  banner?: ReactNode
  children: ReactNode
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  /** 紧凑视图：限制内容区最大宽度。 */
  compact?: boolean
}

/** 侧栏导航菜单：独立组件，便于在移动端点选后关闭抽屉。 */
function SidebarNav({
  nav,
  activeTab,
  onTabChange,
}: {
  nav: NavItem[]
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <SidebarMenu>
      {nav.map((item) => (
        <SidebarMenuItem key={item.id}>
          <SidebarMenuButton
            isActive={activeTab === item.id}
            onClick={() => {
              onTabChange(item.id)
              if (isMobile) setOpenMobile(false)
            }}
          >
            <item.icon />
            <span className="truncate">{item.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

export function AppShell({
  activeTab,
  onTabChange,
  nav,
  headerExtra,
  headerRight,
  sidebarExtra,
  banner,
  children,
  sidebarCollapsed,
  onToggleSidebar,
  compact,
}: AppShellProps) {
  const { t } = useI18n()
  const activeLabel =
    nav.find((item) => item.id === activeTab)?.label ??
    (activeTab === 'settings' ? t('settings.title') : '')

  return (
    <SidebarProvider
      open={!sidebarCollapsed}
      onOpenChange={(open) => {
        // 把 Provider（含 Cmd/Ctrl+B、rail 拖动）的状态同步回 App 的持久化状态。
        if (open === sidebarCollapsed) onToggleSidebar()
      }}
    >
      <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
        <Sidebar collapsible="offcanvas" data-testid="sidebar">
          <SidebarHeader>
            <div className="flex items-center justify-between gap-2">
              <h1 className="min-w-0 truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
                {t('app.title')}
              </h1>
              <div className="flex items-center gap-1">
                {headerExtra}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="max-md:hidden"
                  onClick={onToggleSidebar}
                  aria-label={t('nav.hideSidebar')}
                  title={t('nav.hideSidebar')}
                >
                  <PanelLeftClose data-icon="inline-start" />
                </Button>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarNav nav={nav} activeTab={activeTab} onTabChange={onTabChange} />
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            {sidebarExtra}
            {headerRight}
          </SidebarFooter>
          <SidebarRail aria-label={t('nav.toggleSidebar')} title={t('nav.toggleSidebar')} />
        </Sidebar>

        <SidebarInset className="min-h-0 flex-1 overflow-y-auto">
          {/* 移动端顶栏（打开抽屉）/ 桌面端收起时的展开按钮；桌面展开时不渲染，避免多出一条空导航条 */}
          <div
            className={cn(
              'sticky top-0 z-20 flex items-center gap-2 bg-background/95 px-3 py-2 backdrop-blur',
              !sidebarCollapsed && 'md:hidden',
            )}
          >
            <SidebarTrigger className="md:hidden" aria-label={t('nav.openMenu')} title={t('nav.openMenu')} />
            {sidebarCollapsed && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="max-md:hidden"
                onClick={onToggleSidebar}
                aria-label={t('nav.showSidebar')}
                title={t('nav.showSidebar')}
              >
                <PanelLeft data-icon="inline-start" />
              </Button>
            )}
            <span className="truncate text-sm font-semibold md:hidden">{activeLabel}</span>
          </div>
          {banner}
          <div className="px-3 py-4 md:px-6 md:py-7">
            {/* 紧凑视图 = Bootstrap container：居中 + 随断点的最大宽度；关闭 = container-fluid（100%）。 */}
            {/* `@container`：页面用容器查询（而不是视口断点）决定列数，
                这样侧栏展开/收起、以及 compact 最大宽度都能被正确考虑。 */}
            <div
              data-compact={compact ? 'true' : undefined}
              className={cn(
                'w-full @container',
                compact &&
                  'mx-auto max-w-xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl',
              )}
            >
              {children}
            </div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
