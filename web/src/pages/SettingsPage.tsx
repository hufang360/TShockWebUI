import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Plug, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Field,
  FieldLabel,
  FieldTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Separator,
  Slider,
  Spinner,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui'
import { CollapseChevron } from '@/components/CollapseChevron'
import { CollapsibleCard } from '@/components/CollapsibleCard'
import { LoginGate } from '@/components/LoginGate'
import { useI18n } from '@/lib/i18n'
import { APP_VERSION } from '@/lib/version'
import { useLocalState } from '@/hooks/useLocalState'
import { WebAccountSection } from '@/components/WebAccountSection'
import { MODULE_DEFS, isModuleEnabled, setModuleEnabled, type ModuleId, type ModulesPrefs } from '@/lib/modules'
import { createCustomModule, type CustomModule } from '@/lib/customModules'
import { normalizeCustomCommand } from '@/lib/homeCards'
import {
  DEFAULT_MODULE_CARDS,
  addModuleCard,
  createModuleCard,
  sanitizeModuleCards,
} from '@/lib/moduleCards'
import { StorageKeys } from '@/lib/storage'
import { TshockRequestError, type BackendTransport } from '@/lib/tshock'
import type { Lang, Settings } from '@/types'

interface SettingsPageProps {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  /** 当前上游 id：模块开关按服务器分开记忆。 */
  serverId: string
  transport: BackendTransport
  authenticated: boolean
  modules: ModulesPrefs
  onModulesChange: (next: ModulesPrefs) => void
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
    },
    [modules, serverId, onModulesChange],
  )

  /** 创建自定义模块：名称 + 指令前缀；自动创建一张「帮助」卡片 `/xx help`，并自动激活。 */
  const createModule = useCallback(() => {
    const name = newModuleName.trim()
    const cmd = normalizeCustomCommand(newModuleCommand)
    if (!name || !cmd) return
    const mod = createCustomModule(name)
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
        <p className="pt-1 text-center text-[10px] text-muted-foreground">TShockWebUI {APP_VERSION}</p>
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
          <p className="text-[11px] text-muted-foreground">{t('modules.activateHint')}</p>
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
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{t(def.requiresKey)}</p>
                    {cap.status === 'error' && cap.message && (
                      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-destructive">
                        <AlertTriangle className="size-3" />
                        {cap.message}
                      </p>
                    )}
                    {cap.status === 'no-permission' && (
                      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-warning">
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
          <p className="text-[10px] text-muted-foreground">{t('modules.note')}</p>
        </CollapsibleGroup>

        <CollapsibleGroup title={t('modules.tab.custom')}>
            <p className="text-[11px] text-muted-foreground">{t('modules.custom.hint')}</p>
            <div className="flex flex-col gap-2">
            {customModules.length > 0 && (
              <ul className="flex flex-col gap-2">
                {customModules.map((mod) => (
                  <li
                    key={mod.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl bg-accent/40 p-3"
                  >
                    {/* 名称可直接改：创建后仍能重命名。 */}
                    <Input
                      value={mod.name}
                      onChange={(e) =>
                        onCustomModulesChange(
                          customModules.map((x) =>
                            x.id === mod.id ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder={t('modules.custom.namePlaceholder')}
                      aria-label={t('modules.custom.name')}
                      className="h-8 min-w-0 flex-1 text-xs"
                    />
                    <Switch
                      checked={isModuleEnabled(modules, serverId, mod.id)}
                      disabled={!authenticated}
                      onCheckedChange={(v) => toggle(mod.id, v)}
                      aria-label={mod.name || t('modules.custom.untitled')}
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('modules.custom.remove')}
                      title={t('modules.custom.remove')}
                      onClick={() =>
                        onCustomModulesChange(customModules.filter((x) => x.id !== mod.id))
                      }
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-2 rounded-xl bg-accent/40 p-3 sm:flex-row sm:items-end">
              <Field className="min-w-0 flex-1">
                <FieldLabel htmlFor="custom-module-name">{t('modules.custom.name')}</FieldLabel>
                <Input
                  id="custom-module-name"
                  value={newModuleName}
                  onChange={(e) => setNewModuleName(e.target.value)}
                  placeholder={t('modules.custom.namePlaceholder')}
                  className="h-8 text-xs"
                />
              </Field>
              <Field className="min-w-0 flex-1">
                <FieldLabel htmlFor="custom-module-command">
                  {t('modules.custom.command')}
                </FieldLabel>
                <Input
                  id="custom-module-command"
                  value={newModuleCommand}
                  onChange={(e) => setNewModuleCommand(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createModule()
                  }}
                  placeholder={t('modules.custom.commandPlaceholder')}
                  className="h-8 font-pixel text-xs"
                />
              </Field>
              <Button size="sm" variant="primary" onClick={createModule}>
                <Plus data-icon="inline-start" />
                {t('modules.custom.create')}
              </Button>
            </div>
            </div>
        </CollapsibleGroup>
      </CollapsibleCard>
        </div>

        {/* 右列：界面偏好 / 数据刷新 / 在线授权 / 账户 */}
        <div className="flex min-w-0 flex-col gap-4">
      <CollapsibleCard title={t('settings.heading')} bodyClassName="flex flex-col gap-0 pt-0">
          <SettingRow label={t('settings.fontSize')}>
            <div className="flex items-center gap-2">
              <Slider
                className="w-32"
                min={13}
                max={18}
                step={1}
                value={[settings.fontSize]}
                onValueChange={(v) => onChange({ fontSize: v[0] })}
                aria-label={t('settings.fontSize')}
              />
              <span className="w-5 text-right text-xs text-muted-foreground">
                {settings.fontSize}
              </span>
            </div>
          </SettingRow>
          <Separator />
          <SettingRow label={t('settings.compact')}>
            <Switch
              checked={settings.compact}
              onCheckedChange={(v) => onChange({ compact: v })}
              aria-label={t('settings.compact')}
            />
          </SettingRow>
          <Separator />
          <SettingRow label={t('settings.language')}>
            <ToggleGroup
              size="sm"
              value={settings.language}
              onValueChange={(v) => v && onChange({ language: v as Lang })}
              aria-label={t('settings.language')}
            >
              <ToggleGroupItem value="zh">中文</ToggleGroupItem>
              <ToggleGroupItem value="en">English</ToggleGroupItem>
            </ToggleGroup>
          </SettingRow>
          <Separator />
          <SettingRow label={t('settings.theme')}>
            <ToggleGroup
              size="sm"
              value={settings.theme}
              onValueChange={(v) => v && onChange({ theme: v as Settings['theme'] })}
              aria-label={t('settings.theme')}
            >
              <ToggleGroupItem value="auto">{t('settings.theme.auto')}</ToggleGroupItem>
              <ToggleGroupItem value="light">{t('settings.theme.light')}</ToggleGroupItem>
              <ToggleGroupItem value="dark">{t('settings.theme.dark')}</ToggleGroupItem>
            </ToggleGroup>
          </SettingRow>
      </CollapsibleCard>

      <CollapsibleCard title={t('settings.dataRefresh')} bodyClassName="flex flex-col gap-0 pt-0">
          <SettingRow label={t('settings.commandInterval')}>
            <NativeSelect
              size="sm"
              value={settings.commandInterval}
              onChange={(e) => onChange({ commandInterval: Number(e.target.value) })}
              aria-label={t('settings.commandInterval')}
            >
              <NativeSelectOption value={0}>{t('settings.commandIntervalOff')}</NativeSelectOption>
              <NativeSelectOption value={1000}>
                {t('settings.commandIntervalSeconds', { n: 1 })}
              </NativeSelectOption>
              <NativeSelectOption value={2000}>
                {t('settings.commandIntervalSeconds', { n: 2 })}
              </NativeSelectOption>
              <NativeSelectOption value={5000}>
                {t('settings.commandIntervalSeconds', { n: 5 })}
              </NativeSelectOption>
            </NativeSelect>
          </SettingRow>
          <Separator />
          <div className="flex flex-col gap-1 py-2">
            <Field orientation="horizontal" className="flex-nowrap justify-between gap-3">
              <FieldTitle>{t('settings.eventsInterval')}</FieldTitle>
              <NativeSelect
                size="sm"
                value={settings.eventsRefreshInterval}
                onChange={(e) => onChange({ eventsRefreshInterval: Number(e.target.value) })}
                aria-label={t('settings.eventsInterval')}
              >
                <NativeSelectOption value={60000} disabled={!canFastEvents}>
                  {t('settings.refreshIntervalMinutes', { n: 1 })}
                </NativeSelectOption>
                <NativeSelectOption value={180000}>
                  {t('settings.refreshIntervalMinutes', { n: 3 })}
                </NativeSelectOption>
                <NativeSelectOption value={300000}>
                  {t('settings.refreshIntervalMinutes', { n: 5 })}
                </NativeSelectOption>
                <NativeSelectOption value={900000}>
                  {t('settings.refreshIntervalMinutes', { n: 15 })}
                </NativeSelectOption>
              </NativeSelect>
            </Field>
            {!canFastEvents && (
              <p className="text-[10px] leading-4 text-muted-foreground">
                {t('settings.eventsIntervalFastHint')}
              </p>
            )}
          </div>
          <Separator />
          <SettingRow label={t('settings.refreshInterval')}>
            <NativeSelect
              size="sm"
              value={settings.refreshInterval}
              onChange={(e) => onChange({ refreshInterval: Number(e.target.value) })}
              aria-label={t('settings.refreshInterval')}
            >
              <NativeSelectOption value={0}>{t('settings.refreshIntervalOff')}</NativeSelectOption>
              <NativeSelectOption value={60000}>
                {t('settings.refreshIntervalMinutes', { n: 1 })}
              </NativeSelectOption>
              <NativeSelectOption value={120000}>
                {t('settings.refreshIntervalMinutes', { n: 2 })}
              </NativeSelectOption>
              <NativeSelectOption value={300000}>
                {t('settings.refreshIntervalMinutes', { n: 5 })}
              </NativeSelectOption>
              <NativeSelectOption value={600000}>
                {t('settings.refreshIntervalMinutes', { n: 10 })}
              </NativeSelectOption>
            </NativeSelect>
          </SettingRow>
          <Separator />
          <Field orientation="horizontal" className="flex-nowrap items-center justify-between gap-3 py-2">
            <div className="flex flex-col gap-0.5">
              <FieldTitle>{t('home.batch')}</FieldTitle>
              <p className="text-[10px] leading-4 text-muted-foreground">
                {batchPlugin === true ? t('home.batchHint') : t('home.batchUnavailable')}
              </p>
            </div>
            {batchPlugin === null ? (
              <Spinner className="text-muted-foreground" />
            ) : (
              <Switch
                checked={batchMode}
                disabled={batchPlugin !== true}
                onCheckedChange={setBatchMode}
                aria-label={t('home.batch')}
              />
            )}
          </Field>
      </CollapsibleCard>

          <WebAccountSection transport={transport} authenticated={authenticated} serverId={serverId} />
        </div>
      </div>

      {/* 底部版本号 */}
      <p className="pt-1 text-center text-[10px] text-muted-foreground">TShockWebUI {APP_VERSION}</p>
    </div>
  )
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Field orientation="horizontal" className="flex-nowrap justify-between gap-3 py-2">
      <FieldTitle>{label}</FieldTitle>
      {children}
    </Field>
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
