import { CommandModulePage } from '@/pages/CommandModulePage'
import { CodexPage } from '@/pages/CodexPage'
import { CommandPage } from '@/pages/CommandPage'
import { FishShopPage } from '@/pages/FishShopPage'
import { HomePage } from '@/pages/HomePage'
import { ItemsPage } from '@/pages/ItemsPage'
import { PlayerManagerPage } from '@/pages/PlayerManagerPage'
import { SettingsPage } from '@/pages/SettingsPage'
import type { CustomModule } from '@/lib/customModules'
import { useI18n } from '@/lib/i18n'
import { MODULE_BY_ID, type ModuleId, type ModulesPrefs } from '@/lib/modules'
import type { BackendTransport } from '@/lib/tshock'
import type { Dataset, Settings, TabId } from '@/types'

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
        <ItemsPage dataset={dataset} focusItemId={dexFocus} onFocusConsumed={onFocusConsumed} />
      )}
      {activeTab === 'codex' && <CodexPage />}
      {activeTab === 'players' && (
        <PlayerManagerPage
          key={serverId}
          serverId={serverId}
          transport={transport}
          authenticated={authenticated}
          username={username}
          players={players}
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
  )
}
