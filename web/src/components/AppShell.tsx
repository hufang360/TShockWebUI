import { PanelLeftClose, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { TopBarInfoSlot, TopBarProvider, TopBarSlot } from '@/components/TopBar'
import {
  Breadcrumb,
  Button,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  Separator,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
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

export type NavGroup =
  | 'primary'
  | 'library'
  | 'players'
  | 'world'
  | 'store'
  | 'services'
  | 'custom'
  | 'system'

export interface NavItem {
  id: TabId
  label: string
  icon: LucideIcon
  /** 侧栏分组；省略时归入“常用”。 */
  group?: NavGroup
  /** 悬停 / 聚焦导航项时预取目标页面。 */
  onPrefetch?: () => void
}

interface AppShellProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  /** 侧边栏导航项（由 App 按已激活模块动态生成）。 */
  nav: NavItem[]
  /** 侧栏页头的额外控件，如语言 / 主题快捷切换（放在「WebUI」右侧）。 */
  headerExtra?: ReactNode
  /** 顶栏右侧的全局操作（在页面操作之后，如浮动指令入口）。 */
  headerActions?: ReactNode
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

/** 侧栏分组的渲染顺序（空分组不渲染）。 */
const GROUP_ORDER: NavGroup[] = [
  'primary',
  'library',
  'players',
  'world',
  'store',
  'services',
  'custom',
  'system',
]

/** 分组标题；没有条目的分组不渲染标题，`system` 只有一项且不带标题。 */
const GROUP_LABEL_KEY: Partial<Record<NavGroup, string>> = {
  primary: 'nav.group.primary',
  library: 'nav.group.library',
  players: 'nav.group.players',
  world: 'nav.group.world',
  store: 'nav.group.store',
  services: 'nav.group.services',
  custom: 'nav.group.custom',
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
  const { t } = useI18n()
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <>
      {GROUP_ORDER.map((group) => {
        const items = nav.filter((item) => (item.group ?? 'primary') === group)
        if (items.length === 0) return null
        const labelKey = GROUP_LABEL_KEY[group]
        return (
          <SidebarGroup key={group} className="gap-1">
            {labelKey && <SidebarGroupLabel>{t(labelKey)}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={activeTab === item.id}
                      aria-current={activeTab === item.id ? 'page' : undefined}
                      onClick={() => {
                        onTabChange(item.id)
                        if (isMobile) setOpenMobile(false)
                      }}
                      onPointerEnter={item.onPrefetch}
                      onPointerDown={item.onPrefetch}
                      onFocus={item.onPrefetch}
                    >
                      <item.icon />
                      <span className="truncate">{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )
      })}
    </>
  )
}

export function AppShell({
  activeTab,
  onTabChange,
  nav,
  headerExtra,
  headerActions,
  headerRight,
  sidebarExtra,
  banner,
  children,
  sidebarCollapsed,
  onToggleSidebar,
  compact,
}: AppShellProps) {
  const { t } = useI18n()
  const activeItem = nav.find((item) => item.id === activeTab)
  const activeLabel =
    activeItem?.label ?? (activeTab === 'settings' ? t('settings.title') : '')
  const previousTab = useRef(activeTab)

  // 页面切换后把焦点交给主内容；配合路由骨架的 aria-live，读屏能感知新页面正在加载。
  useEffect(() => {
    if (previousTab.current === activeTab) return
    previousTab.current = activeTab
    document.getElementById('main-content')?.focus({ preventScroll: true })
  }, [activeTab])

  return (
    <SidebarProvider
      open={!sidebarCollapsed}
      onOpenChange={(open) => {
        // 把 Provider（含 Cmd/Ctrl+B、rail 拖动）的状态同步回 App 的持久化状态。
        if (open === sidebarCollapsed) onToggleSidebar()
      }}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        {t('nav.skipToContent')}
      </a>
      <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
        <TopBarProvider>
          <Sidebar collapsible="offcanvas" data-testid="sidebar">
            <SidebarHeader>
              <div className="flex items-center justify-between gap-2">
                <h1 className="min-w-0 truncate text-sm font-semibold">{t('app.title')}</h1>
                <div className="flex shrink-0 items-center gap-1">
                  {headerExtra}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="max-md:hidden"
                    onClick={onToggleSidebar}
                    aria-label={t('nav.hideSidebar')}
                    title={t('nav.hideSidebar')}
                  >
                    <PanelLeftClose />
                  </Button>
                </div>
              </div>
            </SidebarHeader>

            <SidebarContent>
              <SidebarNav nav={nav} activeTab={activeTab} onTabChange={onTabChange} />
            </SidebarContent>

            <SidebarFooter>
              {sidebarExtra}
              {headerRight}
            </SidebarFooter>
            <SidebarRail aria-label={t('nav.railToggle')} title={t('nav.railToggle')} />
          </Sidebar>

          <SidebarInset
            id="main-content"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {/* 内容区顶栏：收起 / 展开侧栏 + 当前位置；滚动时吸附在页面顶部。 */}
            <header className="relative sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-2 backdrop-blur md:px-3">
              {/* 移动端：打开抽屉；桌面端：只在侧栏收起时出现（展开态用侧栏页头的收起按钮）。 */}
              <SidebarTrigger
                className="md:hidden"
                aria-label={t('nav.openMenu')}
                title={t('nav.openMenu')}
              />
              {sidebarCollapsed && (
                <SidebarTrigger
                  className="-ml-1 hidden md:inline-flex"
                  aria-label={t('nav.showSidebar')}
                  title={t('nav.showSidebar')}
                />
              )}
              <Separator
                orientation="vertical"
                className={cn('!h-4', !sidebarCollapsed && 'md:hidden')}
              />
              <Breadcrumb className="min-w-0">
                <BreadcrumbList className="flex-nowrap">
                  <BreadcrumbItem className="min-w-0">
                    <BreadcrumbPage className="truncate">{activeLabel}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <TopBarInfoSlot />
              {/* 右侧：页面操作在前（上次刷新 / 刷新最左），全局入口（浮动指令）最后；
                  手机端全部收进 `…` 菜单。 */}
              <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5">
                <TopBarSlot extra={headerActions} />
              </div>
            </header>
            {banner}
            <div className="px-3 py-4 md:px-6">
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
        </TopBarProvider>
      </div>
    </SidebarProvider>
  )
}
