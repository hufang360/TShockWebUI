import { lazy, Suspense } from 'react'
import { CommandPage } from '@/pages/CommandPage'
import { HomePage } from '@/pages/HomePage'
import { Skeleton } from '@/components/ui'
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary'
import type { CustomModule } from '@/lib/customModules'
import { useI18n } from '@/lib/i18n'
import { MODULE_BY_ID, isModuleEnabled, type ModuleId, type ModulesPrefs } from '@/lib/modules'
import type { BackendTransport } from '@/lib/tshock'
import type { Dataset, Settings, TabId } from '@/types'

// 首屏只保留首页与指令页；重数据页 / 插件页按导航需求加载。
const loadCommandModulePage = () => import('@/pages/CommandModulePage')
const loadCommandTipsPage = () => import('@/pages/CommandTipsPage')
const loadDataIdPage = () => import('@/pages/DataIdPage')
const loadFishShopPage = () => import('@/pages/FishShopPage')
const loadItemsPage = () => import('@/pages/ItemsPage')
const loadPlayerManagerPage = () => import('@/pages/PlayerManagerPage')
const loadPlrPage = () => import('@/pages/PlrPage')
const loadRequisitionPage = () => import('@/pages/RequisitionPage')
const loadSettingsPage = () => import('@/pages/SettingsPage')
const loadWorldPage = () => import('@/pages/WorldPage')

const CommandModulePage = lazy(() =>
  loadCommandModulePage().then((m) => ({ default: m.CommandModulePage })),
)
const CommandTipsPage = lazy(() =>
  loadCommandTipsPage().then((m) => ({ default: m.CommandTipsPage })),
)
const DataIdPage = lazy(() => loadDataIdPage().then((m) => ({ default: m.DataIdPage })))
const FishShopPage = lazy(() => loadFishShopPage().then((m) => ({ default: m.FishShopPage })))
const ItemsPage = lazy(() => loadItemsPage().then((m) => ({ default: m.ItemsPage })))
const PlayerManagerPage = lazy(() =>
  loadPlayerManagerPage().then((m) => ({ default: m.PlayerManagerPage })),
)
const PlrPage = lazy(() => loadPlrPage().then((m) => ({ default: m.PlrPage })))
const RequisitionPage = lazy(() =>
  loadRequisitionPage().then((m) => ({ default: m.RequisitionPage })),
)
const SettingsPage = lazy(() => loadSettingsPage().then((m) => ({ default: m.SettingsPage })))
const WorldPage = lazy(() => loadWorldPage().then((m) => ({ default: m.WorldPage })))

const routeLoaders: Partial<Record<TabId, () => Promise<unknown>>> = {
  items: loadItemsPage,
  dataid: loadDataIdPage,
  save: loadPlrPage,
  worldview: loadWorldPage,
  players: loadPlayerManagerPage,
  store: loadFishShopPage,
  requisition: loadRequisitionPage,
  commands: loadCommandTipsPage,
  world: loadCommandModulePage,
  settings: loadSettingsPage,
}

/** 导航悬停 / 聚焦时预取页面 chunk；失败不提示，真正导航时仍由 ErrorBoundary 兜底。 */
export function preloadRoute(tab: TabId) {
  const load = routeLoaders[tab] ?? (tab.startsWith('m:') ? loadCommandModulePage : undefined)
  void load?.().catch(() => {})
}

function RouteLoadingSkeleton() {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t('app.pageLoading')}</span>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-9 w-24 md:h-7" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
      </div>
    </div>
  )
}

export interface AppRoutesProps {
  activeTab: TabId
  dataset: Dataset
  transport: BackendTransport
  authenticated: boolean
  username: string | null
  serverId: string
  modules: ModulesPrefs
  settings: Settings
  players: string[]
  /** 信使插件是否允许以在线玩家身份执行（Tier B）。 */
  ingameAllowed: boolean
  /** 运行时补全数据（区域 / 传送点）。 */
  runtimeValues: { regions?: string[]; warps?: string[] }
  customModules: CustomModule[]
  dexFocus: number | null
  onNavigate: (tab: TabId) => void
  onLogin: () => void
  onTokenInvalid: () => Promise<boolean>
  onFocusConsumed: () => void
  onOpenInDex: (itemId: number) => void
  onModulesChange: (next: ModulesPrefs) => void
  onModuleUserSet: (id: ModuleId) => void
  onCustomModulesChange: (next: CustomModule[]) => void
  onSettingsChange: (patch: Partial<Settings>) => void
}

/**
 * 主内容路由（从 `App` 抽出，见 docs/TODO.md U6）：
 * 按 `activeTab` 渲染对应页面，并把会话 / 服务器 / 模块等上下文透传下去。
 */
export function AppRoutes({
  activeTab,
  dataset,
  transport,
  authenticated,
  username,
  serverId,
  modules,
  settings,
  players,
  ingameAllowed,
  runtimeValues,
  customModules,
  dexFocus,
  onNavigate,
  onLogin,
  onTokenInvalid,
  onFocusConsumed,
  onOpenInDex,
  onModulesChange,
  onModuleUserSet,
  onCustomModulesChange,
  onSettingsChange,
}: AppRoutesProps) {
  const { t } = useI18n()
  const openLogin = onLogin

  return (
    <RouteErrorBoundary key={activeTab}>
      <Suspense fallback={<RouteLoadingSkeleton />}>
    <>
      {activeTab === 'home' && (
        <HomePage
          dataset={dataset}
          transport={transport}
          authenticated={authenticated}
          username={username}
          serverId={serverId}
          modules={modules}
          refreshInterval={settings.refreshInterval}
          eventsRefreshInterval={settings.eventsRefreshInterval}
          onTokenInvalid={onTokenInvalid}
          onLogin={openLogin}
          onNavigate={onNavigate}
        />
      )}
      {activeTab === 'editor' && (
        <CommandPage
          dataset={dataset}
          transport={transport}
          authenticated={authenticated}
          settings={settings}
          serverId={serverId}
          players={players}
          ingameAllowed={ingameAllowed}
          runtimeValues={runtimeValues}
          onTokenInvalid={onTokenInvalid}
          onLogin={openLogin}
          onOpenInDex={onOpenInDex}
        />
      )}
      {activeTab === 'items' && (
        <ItemsPage
          dataset={dataset}
          focusItemId={dexFocus}
          onFocusConsumed={onFocusConsumed}
          username={username}
        />
      )}
      {activeTab === 'dataid' && (
        <DataIdPage authenticated={authenticated} serverId={serverId} transport={transport} />
      )}
      {activeTab === 'save' && <PlrPage serverId={serverId} transport={transport} />}
      {activeTab === 'worldview' && <WorldPage serverId={serverId} />}
      {activeTab === 'players' && (
        <PlayerManagerPage
          key={serverId}
          serverId={serverId}
          transport={transport}
          authenticated={authenticated}
          username={username}
          players={players}
          moduleEnabled={isModuleEnabled(modules, serverId, 'players')}
          onTokenInvalid={onTokenInvalid}
          onLogin={openLogin}
        />
      )}
      {activeTab === 'store' && (
        <FishShopPage
          serverId={serverId}
          transport={transport}
          authenticated={authenticated}
          refreshInterval={settings.refreshInterval}
          onTokenInvalid={onTokenInvalid}
          onLogin={openLogin}
        />
      )}
      {activeTab === 'requisition' && (
        <RequisitionPage
          serverId={serverId}
          transport={transport}
          authenticated={authenticated}
          refreshInterval={settings.refreshInterval}
          onTokenInvalid={onTokenInvalid}
          onLogin={openLogin}
        />
      )}
      {activeTab === 'commands' && (
        <CommandTipsPage dataset={dataset} onNavigate={onNavigate} />
      )}
      {activeTab === 'world' && (
        <CommandModulePage
          dataset={dataset}
          transport={transport}
          authenticated={authenticated}
          serverId={serverId}
          refreshInterval={settings.refreshInterval}
          onTokenInvalid={onTokenInvalid}
          onLogin={openLogin}
          moduleId="world"
          keyPrefix="world:"
          title={t('nav.world')}
          desc={t('page.world.desc')}
          fixedCards={MODULE_BY_ID.get('world')?.cards}
          pluginName={MODULE_BY_ID.get('world')?.pluginName}
        />
      )}
      {customModules
        .filter((mod) => mod.id === activeTab)
        .map((mod) => (
          <CommandModulePage
            key={mod.id}
            dataset={dataset}
            transport={transport}
            authenticated={authenticated}
            serverId={serverId}
            refreshInterval={settings.refreshInterval}
            onTokenInvalid={onTokenInvalid}
            onLogin={openLogin}
            moduleId={mod.id}
            keyPrefix={`${mod.id}:`}
            title={mod.name || t('modules.custom.untitled')}
            desc={mod.desc.trim() || t('modules.custom.hint')}
          />
        ))}
      {activeTab === 'settings' && (
        <SettingsPage
          settings={settings}
          onChange={onSettingsChange}
          serverId={serverId}
          transport={transport}
          authenticated={authenticated}
          modules={modules}
          onModulesChange={onModulesChange}
          onModuleUserSet={onModuleUserSet}
          customModules={customModules}
          onCustomModulesChange={onCustomModulesChange}
          onTokenInvalid={onTokenInvalid}
          onLogin={openLogin}
        />
      )}
    </>
      </Suspense>
    </RouteErrorBoundary>
  )
}
