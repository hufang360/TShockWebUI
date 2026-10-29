import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Plug, ShieldAlert } from 'lucide-react'
import {
  Badge,
  Button,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import { CollapsibleCard } from '@/components/CollapsibleCard'
import { LoginGate } from '@/components/LoginGate'
import { useI18n } from '@/lib/i18n'
import { APP_VERSION } from '@/lib/version'
import { useCommandResults } from '@/lib/commandResults'
import { useLocalState } from '@/hooks/useLocalState'
import { PluginDiagnosticsCard } from '@/components/PluginDiagnosticsCard'
import { WebAccountSection } from '@/components/WebAccountSection'
import { CustomModulesSection } from '@/components/settings/CustomModulesSection'
import { PreferencesCards } from '@/components/settings/PreferencesCards'
import {
  MODULE_BY_ID,
  MODULE_DEFS,
  fixedCardResultKey,
  isModuleEnabled,
  setModuleEnabled,
  type ModuleDef,
  type ModuleId,
  type ModulesPrefs,
} from '@/lib/modules'
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
import { TshockRequestError, type BackendTransport, type ServerCapabilities } from '@/lib/tshock'
import type { CommandResult, Settings } from '@/types'

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
type CapStatus = 'checking' | 'ready' | 'no-permission' | 'missing' | 'outdated' | 'error' | 'auth'

interface CapState {
  status: CapStatus
  message?: string
}

/**
 * 世界管理没有 REST 探测端点，只能看 `/wi` 的执行结果（与模块页同一个结果 key）。
 * `command_error` 说明指令存在，只是参数/用法问题 → 已安装。
 */
function worldStateOf(res: CommandResult): CapState {
  switch (res.status) {
    case 'ok':
    case 'command_error':
      return { status: 'ready' }
    case 'no_permission':
      return { status: 'no-permission' }
    case 'command_not_found':
      return { status: 'missing' }
    case 'token_invalid':
      return { status: 'auth' }
    default:
      return { status: 'error', message: res.message }
  }
}

/**
 * 设置（作为右侧正文内容，而非弹框）。
 * 「激活模块」会实时探测插件并展示状态；开关本身只控制侧边栏入口显隐，不受安装状态限制。
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
    requisition: { status: 'checking' },
    world: { status: 'checking' },
  })
  // 世界管理的探测结果与模块页共用（key = 模块页的 `world:fixed:/wi`）。
  const { results: commandResults, setResult: setCommandResult } = useCommandResults()
  const worldProbeCommand = MODULE_BY_ID.get('world')?.cards?.[0]?.command ?? '/wi'
  const worldProbeKey = fixedCardResultKey('world', worldProbeCommand)
  // 用 ref 读缓存结果，避免 probeAll 因结果变化而重建（否则联调 effect 会反复探测）。
  const commandResultsRef = useRef(commandResults)
  useEffect(() => {
    commandResultsRef.current = commandResults
  }, [commandResults])
  // 「统一执行」（批量执行）开关：全局偏好，首页与鱼店右侧卡片共用。
  const [batchMode, setBatchMode] = useLocalState(StorageKeys.homeBatch, false)
  // 用户是否手动改过：改过后不再被「检测到插件自动开启」覆盖。
  const [, setBatchModeSet] = useLocalState(StorageKeys.homeBatchSet, false)
  const [batchPlugin, setBatchPlugin] = useState<boolean | null>(null)
  const [, setRawModuleCards] = useLocalState(StorageKeys.moduleCards, DEFAULT_MODULE_CARDS)
  // 「激活模块」按来源分 tab：内置（信使插件）/ 已适配（第三方插件）/ 自定义。
  const [moduleTab, setModuleTab] = useState<'builtin' | 'plugin' | 'custom'>('builtin')
  const webuiModules = MODULE_DEFS.filter((def) => def.origin === 'webui')
  const pluginModules = MODULE_DEFS.filter((def) => def.origin === 'plugin')
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

  /** 模块 id → 能力状态（纯函数，便于统一解释「缺插件 / 无权限 / 版本过旧」）。 */
  const capStateOf = useCallback(
    (id: ModuleId, caps: ServerCapabilities): CapState => {
      if (id === 'requisition') {
        if (!caps.requests.plugin) return { status: 'missing' }
        if (!caps.requests.submit && !caps.requests.review) return { status: 'no-permission' }
        return { status: 'ready' }
      }
      if (id === 'players') {
        if (!caps.player.plugin) return { status: 'missing' }
        if (!caps.player.permission) return { status: 'no-permission' }
        return { status: 'ready' }
      }
      if (!caps.fish.plugin) return { status: 'missing' }
      // 装了 v1.6.2 之前的老版本 FishShop：只有游戏内指令，没有 REST 接口。
      if (!caps.fish.rest) return { status: 'outdated' }
      if (!caps.fish.permission) return { status: 'no-permission' }
      return { status: 'ready' }
    },
    [],
  )

  /**
   * 世界管理探测：跑一次 `/wi`（非强制时先用模块页留下的最近结果）。
   * 与首页 / 模块页共用 `command_not_found` 判定，因此无需新接口、也不提权。
   */
  const probeWorld = useCallback(
    async (force: boolean): Promise<CapState> => {
      const cached = commandResultsRef.current[worldProbeKey]
      if (!force && cached) return worldStateOf(cached)
      try {
        const res = await transport.runCommand(worldProbeCommand)
        setCommandResult(worldProbeKey, res)
        if (res.status === 'token_invalid') {
          onTokenInvalid()
          return { status: 'auth' }
        }
        return worldStateOf(res)
      } catch (err) {
        if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
          onTokenInvalid()
          return { status: 'auth' }
        }
        return {
          status: 'error',
          message: err instanceof Error ? err.message : t('modules.probeFailed'),
        }
      }
    },
    [
      transport,
      setCommandResult,
      onTokenInvalid,
      t,
      worldProbeCommand,
      worldProbeKey,
    ],
  )

  const probeAll = useCallback(
    async (force = false) => {
      if (!authenticated) {
        setCaps({
          players: { status: 'auth' },
          store: { status: 'auth' },
          requisition: { status: 'auth' },
          world: { status: 'auth' },
        })
        setBatchPlugin(null)
        return
      }
      setCaps({
        players: { status: 'checking' },
        store: { status: 'checking' },
        requisition: { status: 'checking' },
        world: { status: 'checking' },
      })
      setBatchPlugin(null)
      // 统一能力矩阵：一次请求拿到全部插件状态（以前是 4 个端点各探一轮）。
      // fresh=true 绕过服务端 3 秒微缓存，保证「设置页」看到的是刚装上插件后的真实状态。
      try {
        const caps = await transport.capabilities(true)
        if (!caps.reachable) {
          // TShock 不可达：不给出「缺插件」的误导结论。
          const down: CapState = { status: 'error', message: t('modules.probeFailed') }
          setCaps({ players: down, store: down, requisition: down, world: down })
          setBatchPlugin(null)
          return
        }
        // 世界管理没有 REST 端点：复用最近一次 `/wi` 结果；「重新检测」强制重跑。
        const world = await probeWorld(force)
        setCaps({
          players: capStateOf('players', caps),
          store: capStateOf('store', caps),
          requisition: capStateOf('requisition', caps),
          world,
        })
        setBatchPlugin(caps.batch.plugin)
      } catch (err) {
        if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
          onTokenInvalid()
          setCaps({
            players: { status: 'auth' },
            store: { status: 'auth' },
            requisition: { status: 'auth' },
            world: { status: 'auth' },
          })
          setBatchPlugin(null)
          return
        }
        const failed: CapState = {
          status: 'error',
          message: err instanceof Error ? err.message : t('modules.probeFailed'),
        }
        setCaps({ players: failed, store: failed, requisition: failed, world: failed })
        setBatchPlugin(null)
      }
    },
    [authenticated, capStateOf, transport, onTokenInvalid, t, probeWorld],
  )

  // 切换服务器后必须重新探测（不同服务器安装的插件不同）。
  useEffect(() => {
    setCaps({
      players: { status: 'checking' },
      store: { status: 'checking' },
      requisition: { status: 'checking' },
      world: { status: 'checking' },
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

  // 自定义模块顺序即侧栏顺序：上移 / 下移与拖拽共用同一个数组重排。
  const moveCustomModule = useCallback(
    (id: string, delta: number) => {
      const from = customModules.findIndex((m) => m.id === id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= customModules.length) return
      const next = [...customModules]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      onCustomModulesChange(next)
    },
    [customModules, onCustomModulesChange],
  )

  const statusText = useMemo(
    () => (s: CapStatus): string => t(`modules.status.${s}`),
    [t],
  )

  // 未登录：隐藏设置内容（模块探测 / 激活 / 自定义模块都要登录），只留标题 + 登录提示。
  if (!authenticated) {
    return (
      <div className="flex flex-col gap-4">
        {/* 页面名只在顶栏出现一次，这里不再重复同一句话。 */}
        <p className="text-sm text-muted-foreground">{t('settings.note')}</p>
        <LoginGate onLogin={onLogin} />
        <p className="pt-1 text-center text-2xs text-muted-foreground">TShockWebUI {APP_VERSION}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('settings.note')}</p>

      {/* 两栏：左 = 界面偏好 / 激活模块；右 = 执行与数据刷新 / 在线授权 / 账户 */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
      <PreferencesCards
        section="interface"
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
      <CollapsibleCard
        title={t('modules.activate')}
        icon={<Plug />}
        bodyClassName="flex flex-col gap-3 pt-0"
        headerExtra={
          <Button size="sm" variant="ghost" onClick={() => void probeAll(true)}>
            {t('modules.recheck')}
          </Button>
        }
      >
        <Tabs
          value={moduleTab}
          onValueChange={(v) => setModuleTab(v as typeof moduleTab)}
          className="w-full gap-3"
        >
          <TabsList
            aria-label={t('modules.activate')}
            variant="line"
            className="w-full justify-start"
          >
            <TabsTrigger value="builtin" variant="line" className="flex-none">
              {t('modules.tab.builtin')}
            </TabsTrigger>
            <TabsTrigger value="plugin" variant="line" className="flex-none">
              {t('modules.tab.plugin')}
            </TabsTrigger>
            <TabsTrigger value="custom" variant="line" className="flex-none">
              {t('modules.tab.custom')}
            </TabsTrigger>
          </TabsList>

          {/* 内置：随信使插件（WebUI）提供的模块。 */}
          <TabsContent value="builtin" className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">{t('modules.tab.builtinHint')}</p>
            <ul className="flex flex-col gap-2">
              {webuiModules.map((def) => (
                <ModuleRow
                  key={def.id}
                  def={def}
                  cap={caps[def.id]}
                  enabled={isModuleEnabled(modules, serverId, def.id)}
                  statusText={statusText}
                  onToggle={toggle}
                />
              ))}
            </ul>
          </TabsContent>

          {/* 已适配：第三方插件（PlayerManager / FishShop / WorldModify）。 */}
          <TabsContent value="plugin" className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">{t('modules.tab.pluginHint')}</p>
            <ul className="flex flex-col gap-2">
              {pluginModules.map((def) => (
                <ModuleRow
                  key={def.id}
                  def={def}
                  cap={caps[def.id]}
                  enabled={isModuleEnabled(modules, serverId, def.id)}
                  statusText={statusText}
                  onToggle={toggle}
                />
              ))}
            </ul>
          </TabsContent>

          {/* 自定义：用户填名称 + 主指令创建的模块。 */}
          <TabsContent value="custom" className="flex flex-col gap-3">
            <CustomModulesSection
              customModules={customModules}
              modules={modules}
              serverId={serverId}
              authenticated={authenticated}
              onToggle={toggle}
              onUpdate={updateCustomModule}
              onRemove={(id) => onCustomModulesChange(customModules.filter((x) => x.id !== id))}
              onMove={moveCustomModule}
              newName={newModuleName}
              newCommand={newModuleCommand}
              onNewNameChange={setNewModuleName}
              onNewCommandChange={setNewModuleCommand}
              onCreate={createModule}
            />
          </TabsContent>
        </Tabs>
        <p className="text-xs text-muted-foreground">{t('modules.note')}</p>
      </CollapsibleCard>
        </div>

        {/* 右列：界面偏好 / 数据刷新 / 在线授权 / 账户 */}
        <div className="flex min-w-0 flex-col gap-4">
      <PreferencesCards
        section="behavior"
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
  const tone =
    status === 'ready'
      ? 'success'
      : status === 'missing'
        ? 'danger'
        : status === 'no-permission' || status === 'outdated'
          ? 'warn'
          : 'neutral'
  return <Badge tone={tone}>{text}</Badge>
}

/**
 * 「激活模块」里的一行：名称 + 能力徽标 + 依赖说明 + 开关。
 *
 * 开关只控制侧边栏入口，不受插件安装状态限制（装没装都能拨）；插件状态只作提示。
 */
function ModuleRow({
  def,
  cap,
  enabled,
  statusText,
  onToggle,
}: {
  def: ModuleDef
  cap: CapState
  enabled: boolean
  statusText: (status: CapStatus) => string
  onToggle: (id: ModuleId, on: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl bg-accent/40 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground">{t(def.titleKey)}</span>
          <CapBadge status={cap.status} text={statusText(cap.status)} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{t(def.requiresKey)}</p>
        {cap.status === 'error' && cap.message && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="size-3" />
            {cap.message}
          </p>
        )}
        {cap.status === 'no-permission' && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-warning">
            <ShieldAlert className="size-3" />
            {t('modules.noPermissionHint')}
          </p>
        )}
        {cap.status === 'outdated' && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-warning">
            <AlertTriangle className="size-3" />
            {t('modules.outdatedHint')}
          </p>
        )}
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={(v) => onToggle(def.id, v)}
        aria-label={t(def.titleKey)}
      />
    </li>
  )
}
