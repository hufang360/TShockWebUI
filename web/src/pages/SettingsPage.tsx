import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Plug, ShieldAlert } from 'lucide-react'
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Spinner,
  Switch,
} from '@/components/ui'
import { CollapseChevron } from '@/components/CollapseChevron'
import { CollapsibleCard } from '@/components/CollapsibleCard'
import { LoginGate } from '@/components/LoginGate'
import { useI18n } from '@/lib/i18n'
import { APP_VERSION } from '@/lib/version'
import { useLocalState } from '@/hooks/useLocalState'
import { PluginDiagnosticsCard } from '@/components/PluginDiagnosticsCard'
import { WebAccountSection } from '@/components/WebAccountSection'
import { CustomModulesSection } from '@/components/settings/CustomModulesSection'
import { PreferencesCards } from '@/components/settings/PreferencesCards'
import { MODULE_DEFS, isModuleEnabled, setModuleEnabled, type ModuleId, type ModulesPrefs } from '@/lib/modules'
import { createCustomModule, type CustomModule } from '@/lib/customModules'
import { normalizeCustomCommand } from '@/lib/homeCards'
import {
  DEFAULT_MODULE_CARDS,
  addModuleCard,
  createModuleCard,
  moduleCardsFor,
  sanitizeModuleCards,
  updateModuleCard,
} from '@/lib/moduleCards'
import { StorageKeys } from '@/lib/storage'
import { TshockRequestError, type BackendTransport } from '@/lib/tshock'
import type { Settings } from '@/types'

interface SettingsPageProps {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  /** 当前上游 id：模块开关按服务器分开记忆。 */
  serverId: string
  transport: BackendTransport
  authenticated: boolean
  modules: ModulesPrefs
  onModulesChange: (next: ModulesPrefs) => void
  /** 用户手动拨动模块开关时回调：App 据此记录「用户选择过」，之后不再被自动激活覆盖。 */
  onModuleUserSet?: (id: ModuleId) => void
  /** 用户自定义模块（名称 + 指令）。 */
  customModules: CustomModule[]
  onCustomModulesChange: (next: CustomModule[]) => void
  onTokenInvalid: () => void
  onLogin: () => void
}

/** 单个模块依赖插件的探测结果。 */
type CapStatus = 'checking' | 'ready' | 'no-permission' | 'missing' | 'error' | 'auth'

interface CapState {
  status: CapStatus
  message?: string
}

/**
 * 设置（作为右侧正文内容，而非弹框）。
 * 「激活模块」会实时探测插件：安装并授权后才能打开开关，入口随之出现在侧边栏。
 */
export function SettingsPage({
  settings,
  onChange,
  serverId,
  transport,
  authenticated,
  modules,
  onModulesChange,
  onModuleUserSet,
  customModules,
  onCustomModulesChange,
  onTokenInvalid,
  onLogin,
}: SettingsPageProps) {
  const { t } = useI18n()
  const [caps, setCaps] = useState<Record<ModuleId, CapState>>({
    players: { status: 'checking' },
    store: { status: 'checking' },
    // 世界管理不探测插件（无法可靠探知 WorldModify），只要登录即可激活。
    world: { status: 'ready' },
  })
  // 「统一执行」（批量执行）开关：全局偏好，首页与鱼店右侧卡片共用。
  const [batchMode, setBatchMode] = useLocalState(StorageKeys.homeBatch, false)
  // 用户是否手动改过：改过后不再被「检测到插件自动开启」覆盖。
  const [, setBatchModeSet] = useLocalState(StorageKeys.homeBatchSet, false)
  const [batchPlugin, setBatchPlugin] = useState<boolean | null>(null)
  const [, setRawModuleCards] = useLocalState(StorageKeys.moduleCards, DEFAULT_MODULE_CARDS)
  const [newModuleName, setNewModuleName] = useState('')
  const [newModuleCommand, setNewModuleCommand] = useState('')
  // 当前用户组：决定「服务器动态」能否选 1 分钟（仅 GM / superadmin / vip）。
  const [group, setGroup] = useState<string | null>(null)
  useEffect(() => {
    if (!authenticated) {
      setGroup(null)
      return
    }
    let cancelled = false
    void transport
      .me()
      .then((m) => {
        if (!cancelled) setGroup(m.group)
      })
      .catch(() => {
        if (!cancelled) setGroup(null)
      })
    return () => {
      cancelled = true
    }
  }, [authenticated, serverId, transport])
  const canFastEvents =
    group != null && ['gm', 'superadmin', 'vip'].includes(group.trim().toLowerCase())

  const probe = useCallback(async (id: ModuleId): Promise<CapState> => {
    if (id === 'world') return { status: 'ready' }
    try {
      const cap = id === 'players' ? await transport.playerCapabilities() : await transport.fishCapabilities()
      if (!cap.plugin) return { status: 'missing' }
      if (!cap.permission) return { status: 'no-permission' }
      return { status: 'ready' }
    } catch (err) {
      if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
        onTokenInvalid()
        return { status: 'auth' }
      }
      return { status: 'error', message: err instanceof Error ? err.message : t('modules.probeFailed') }
    }
  }, [transport, onTokenInvalid, t])

  const probeAll = useCallback(async () => {
    if (!authenticated) {
      setCaps({
        players: { status: 'auth' },
        store: { status: 'auth' },
        world: { status: 'auth' },
      })
      setBatchPlugin(null)
      return
    }
    setCaps({
      players: { status: 'checking' },
      store: { status: 'checking' },
      world: { status: 'ready' },
    })
    setBatchPlugin(null)
    const [players, store] = await Promise.all([probe('players'), probe('store')])
    setCaps({ players, store, world: { status: 'ready' } })
    try {
      const cap = await transport.batchCapabilities()
      setBatchPlugin(cap.plugin)
    } catch {
      setBatchPlugin(false)
    }
  }, [authenticated, probe, transport])

  // 切换服务器后必须重新探测（不同服务器安装的插件不同）。
  useEffect(() => {
    setCaps({
      players: { status: 'checking' },
      store: { status: 'checking' },
      world: { status: 'ready' },
    })
    setBatchPlugin(null)
    void probeAll()
  }, [probeAll, serverId])

  const toggle = useCallback(
    (id: ModuleId, on: boolean) => {
      onModulesChange(setModuleEnabled(modules, serverId, id, on))
      // 记录用户手动改过：登录后的「检测到插件自动激活」不再覆盖这个开关。
      onModuleUserSet?.(id)
    },
    [modules, serverId, onModulesChange, onModuleUserSet],
  )

  // 创建一个自定义模块：名称 + 主指令，自动建一张「帮助」卡片 `/xx help` 并激活。
  const createModule = useCallback(() => {
    const name = newModuleName.trim()
    const cmd = normalizeCustomCommand(newModuleCommand)
    if (!name || !cmd) return
    const mod = createCustomModule(name, cmd)
    onCustomModulesChange([...customModules, mod])
    // 去掉可能已带上的 help，统一拼成「<cmd> help」。
    const base = cmd.replace(/\s+help$/i, '')
    setRawModuleCards((prev) =>
      addModuleCard(
        sanitizeModuleCards(prev),
        serverId,
        mod.id,
        createModuleCard(t('modules.custom.helpCard'), `${base} help`),
      ),
    )
    onModulesChange(setModuleEnabled(modules, serverId, mod.id, true))
    setNewModuleName('')
    setNewModuleCommand('')
  }, [
    newModuleName,
    newModuleCommand,
    customModules,
    onCustomModulesChange,
    setRawModuleCards,
    serverId,
    onModulesChange,
    modules,
    t,
  ])

  // 修改已添加的自定义模块：名称直接改；主指令改时同步把「帮助」卡片改成 `<新主指令> help`。
  const updateCustomModule = useCallback(
    (id: string, patch: { name?: string; command?: string; desc?: string }) => {
      const before = customModules.find((m) => m.id === id)
      onCustomModulesChange(customModules.map((m) => (m.id === id ? { ...m, ...patch } : m)))
      if (patch.command === undefined || !before) return
      const newBase = normalizeCustomCommand(patch.command)
      const oldBase = normalizeCustomCommand(before.command)
      if (!newBase || newBase === oldBase) return
      setRawModuleCards((prev) => {
        const prefs = sanitizeModuleCards(prev)
        const cards = moduleCardsFor(prefs, serverId, id)
        // 自动生成的「帮助」卡片：指令以 ` help` 结尾（不依赖语言，故不按名字匹配）。
        const help = cards.find((c) => / help$/i.test(normalizeCustomCommand(c.command)))
        if (!help) return prev
        return updateModuleCard(prefs, serverId, id, help.id, { command: `${newBase} help` })
      })
    },
    [customModules, onCustomModulesChange, setRawModuleCards, serverId],
  )

  const statusText = useMemo(
    () => (s: CapStatus): string => t(`modules.status.${s}`),
    [t],
  )

  // 未登录：隐藏设置内容（模块探测 / 激活 / 自定义模块都要登录），只留标题 + 登录提示。
  if (!authenticated) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{t('settings.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('settings.note')}</p>
        </div>
        <LoginGate onLogin={onLogin} />
        <p className="pt-1 text-center text-2xs text-muted-foreground">TShockWebUI {APP_VERSION}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t('settings.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('settings.note')}</p>
      </div>

      {/* 两栏：左 = 激活模块；右 = 界面偏好 / 数据刷新 / 在线授权 / 账户 */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
      <CollapsibleCard
        title={t('modules.activate')}
        icon={<Plug />}
        bodyClassName="flex flex-col gap-3 pt-0"
        headerExtra={
          <Button size="sm" variant="ghost" onClick={() => void probeAll()}>
            {t('modules.recheck')}
          </Button>
        }
      >
        <CollapsibleGroup title={t('modules.tab.builtin')}>
          <p className="text-2xs text-muted-foreground">{t('modules.activateHint')}</p>
          <ul className="flex flex-col gap-2">
            {MODULE_DEFS.map((def) => {
              const cap = caps[def.id]
              const enabled = isModuleEnabled(modules, serverId, def.id)
              const usable = cap.status === 'ready'
              return (
                <li
                  key={def.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl bg-accent/40 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground">{t(def.titleKey)}</span>
                      <CapBadge status={cap.status} text={statusText(cap.status)} />
                    </div>
                    <p className="mt-0.5 text-2xs text-muted-foreground">{t(def.requiresKey)}</p>
                    {cap.status === 'error' && cap.message && (
                      <p className="mt-0.5 flex items-center gap-1 text-2xs text-destructive">
                        <AlertTriangle className="size-3" />
                        {cap.message}
                      </p>
                    )}
                    {cap.status === 'no-permission' && (
                      <p className="mt-0.5 flex items-center gap-1 text-2xs text-warning">
                        <ShieldAlert className="size-3" />
                        {t('modules.noPermissionHint')}
                      </p>
                    )}
                  </div>
                  {cap.status === 'checking' ? (
                    <Spinner className="text-muted-foreground" />
                  ) : (
                    <Switch
                      checked={enabled}
                      disabled={!usable}
                      onCheckedChange={(v) => toggle(def.id, v)}
                      aria-label={t(def.titleKey)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
          <p className="text-2xs text-muted-foreground">{t('modules.note')}</p>
        </CollapsibleGroup>

        <CollapsibleGroup title={t('modules.tab.custom')}>
          <CustomModulesSection
            customModules={customModules}
            modules={modules}
            serverId={serverId}
            authenticated={authenticated}
            onToggle={toggle}
            onUpdate={updateCustomModule}
            onRemove={(id) => onCustomModulesChange(customModules.filter((x) => x.id !== id))}
            newName={newModuleName}
            newCommand={newModuleCommand}
            onNewNameChange={setNewModuleName}
            onNewCommandChange={setNewModuleCommand}
            onCreate={createModule}
          />
        </CollapsibleGroup>
      </CollapsibleCard>
        </div>

        {/* 右列：界面偏好 / 数据刷新 / 在线授权 / 账户 */}
        <div className="flex min-w-0 flex-col gap-4">
      <PreferencesCards
        settings={settings}
        onChange={onChange}
        canFastEvents={canFastEvents}
        batchPlugin={batchPlugin}
        batchMode={batchMode}
        onBatchModeChange={(v) => {
          setBatchMode(v)
          setBatchModeSet(true)
        }}
      />

          <PluginDiagnosticsCard transport={transport} serverId={serverId} />
          <WebAccountSection transport={transport} authenticated={authenticated} serverId={serverId} />
        </div>
      </div>

      {/* 底部版本号 */}
      <p className="pt-1 text-center text-2xs text-muted-foreground">TShockWebUI {APP_VERSION}</p>
    </div>
  )
}

function CapBadge({ status, text }: { status: CapStatus; text: string }) {
  const tone = status === 'ready' ? 'success' : status === 'missing' ? 'danger' : status === 'no-permission' ? 'warn' : 'neutral'
  return <Badge tone={tone}>{text}</Badge>
}

/** 激活模块里的可折叠分组（已适配 / 自定义），默认展开。 */
function CollapsibleGroup({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-3">
      <CollapsibleTrigger className="group/title flex w-full cursor-pointer items-center gap-2 text-left">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <CollapseChevron open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3">{children}</CollapsibleContent>
    </Collapsible>
  )
}
