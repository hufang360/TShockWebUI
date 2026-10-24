import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ClipboardList, Fish, Globe2, House, LayoutGrid, Plug, Settings as SettingsIcon, Terminal, Users } from 'lucide-react'
import { AppShell, type NavItem } from '@/components/AppShell'
import { AppRoutes, preloadRoute } from '@/components/AppRoutes'
import { ExecutionQueuePanel } from '@/components/ExecutionQueuePanel'
import { LoginDialog } from '@/components/LoginDialog'
import { QuickPreferences } from '@/components/QuickPreferences'
import { SidebarAccountMenu } from '@/components/SidebarAccountMenu'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardBody,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@/components/ui'
import { useLocalState } from '@/hooks/useLocalState'
import { preloadAtlasImage } from '@/lib/atlas'
import { loadLoginMemory, saveLoginMemory } from '@/lib/credentials'
import { loadDataset, reconcileDataVersion, withRuntimeCommands } from '@/lib/dataset'
import { CommandResultsProvider } from '@/lib/commandResults'
import { DatasetProvider } from '@/lib/datasetContext'
import { ExecutionQueueProvider } from '@/lib/executionQueue'
import { I18nProvider, translate } from '@/lib/i18n'
import { ItemDetailProvider, type ItemDetailApi } from '@/lib/itemDetailContext'
import {
  DEFAULT_MODULES,
  MODULE_DEFS,
  autoActivateModules,
  isCustomModuleId,
  isModuleEnabled,
  sanitizeModules,
  setModuleEnabled,
  type ModulesPrefs,
} from '@/lib/modules'
import { sanitizeCustomModules, type CustomModule } from '@/lib/customModules'
import { StorageKeys, removeKey } from '@/lib/storage'
import {
  BUILTIN_ID,
  addServerTarget,
  loadServers as loadServerTargets,
  hostPortLabel,
  maskHost,
  maskedTargetLabel,
  readActiveTargetId,
  resolveTarget,
  saveServers,
  updateServerTarget,
  writeActiveTargetId,
  type ServerTarget,
} from '@/lib/servers'
import { clearSelfAvatar } from '@/lib/selfAvatar'
import {
  createTransport,
  type BackendTransport,
  type RuntimeCommand,
  type ServerInfo,
  type ServerStatus,
  type Session,
} from '@/lib/tshock'
import type { Dataset, Me, Settings, TabId, UiState } from '@/types'

const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  fontSize: 15,
  showIcons: true,
  insertWithCount: false,
  liveMode: false,
  language: 'zh',
  compact: true,
  commandInterval: 2000,
  refreshInterval: 120000,
  eventsRefreshInterval: 180000,
}

const DEFAULT_UI: UiState = { activeTab: 'home', sidebarCollapsed: false }

const ANON: Session = { authenticated: false, username: null }

const DEFAULT_SERVER_INFO: ServerInfo = { allowCustom: false, default: null }

/**
 * TShock /v2/server/status 的 serverversion 形如 "v1.4.5.8"（带前导 v），
 * 而 data/meta.json 为 "1.4.5.8"。规范化后再比较，避免误报版本不一致。
 */
const normalizeVersion = (version: string) => version.trim().replace(/^v/i, '')

/** 页签与 URL hash 双向同步；不引入路由库，也不改变后端接口。 */
function readTabFromHash(): TabId | null {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash.replace(/^#\/?/, '')
  if (!raw) return null
  try {
    const decoded = decodeURIComponent(raw)
    // `#/cmd` 是规范地址；`#/editor` 作为旧链接兼容，会在同步 effect 中替换。
    if (decoded === 'cmd' || decoded === 'editor') return 'editor'
    return decoded as TabId
  } catch {
    return null
  }
}

function tabHash(tab: TabId): string {
  return `#/${encodeURIComponent(tab === 'editor' ? 'cmd' : tab)}`
}

interface AppProps {
  /** 测试或嵌入时可注入；默认按 VITE_TRANSPORT 选择。 */
  transport?: BackendTransport
}

export default function App({ transport: transportProp }: AppProps = {}) {
  const transport = useMemo(() => transportProp ?? createTransport(), [transportProp])

  const [dataset, setDataset] = useState<Dataset | null>(null)
  // 运行时指令目录（登录后从信使插件拉取，补全插件指令）。
  const [runtimeCommands, setRuntimeCommands] = useState<RuntimeCommand[]>([])
  // 后端是否允许把 allowServer=false 的指令交给插件以真实玩家身份执行。
  const [ingameAllowed, setIngameAllowed] = useState(false)
  // 运行时补全数据（区域 / 传送点）——只在 TShock 运行时存在。
  const [runtimeParams, setRuntimeParams] = useState<{ regions?: string[]; warps?: string[] }>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // settings 里可能缺字段或残留旧值（如 theme='darker'），做一次归一化。
  const [rawSettings, setSettings] = useLocalState(StorageKeys.settings, DEFAULT_SETTINGS)
  const settings = useMemo(() => {
    const merged: Settings = { ...DEFAULT_SETTINGS, ...rawSettings }
    if (merged.theme !== 'light' && merged.theme !== 'dark' && merged.theme !== 'auto') {
      merged.theme = 'dark'
    }
    if (merged.language !== 'zh' && merged.language !== 'en') merged.language = 'zh'
    if (typeof merged.compact !== 'boolean') merged.compact = true
    if (
      typeof merged.commandInterval !== 'number' ||
      !Number.isFinite(merged.commandInterval) ||
      merged.commandInterval < 0
    ) {
      merged.commandInterval = DEFAULT_SETTINGS.commandInterval
    }
    if (
      typeof merged.refreshInterval !== 'number' ||
      !Number.isFinite(merged.refreshInterval) ||
      merged.refreshInterval < 0
    ) {
      merged.refreshInterval = DEFAULT_SETTINGS.refreshInterval
    }
    if (
      typeof merged.eventsRefreshInterval !== 'number' ||
      !Number.isFinite(merged.eventsRefreshInterval) ||
      merged.eventsRefreshInterval <= 0
    ) {
      merged.eventsRefreshInterval = DEFAULT_SETTINGS.eventsRefreshInterval
    }
    return merged
  }, [rawSettings])
  const t = useMemo(
    () => (key: string, vars?: Record<string, string | number>) =>
      translate(settings.language, key, vars),
    [settings.language],
  )

  // 系统深色偏好（theme='auto' 时用）；jsdom 可能没有 matchMedia，降级为 false。
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  // theme='auto' 跟随系统；强制 light/dark 时忽略系统。
  const isDark = settings.theme === 'dark' || (settings.theme === 'auto' && systemDark)

  // 深色类挂到 <html>：Radix 的 portal（Dialog / Sheet / Select / DropdownMenu / Popover / Tooltip）
  // 渲染到 document.body，只有在 <html> 上才能继承 `.dark`；否则弹框在暗色下会是白底。
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', isDark)
    root.style.colorScheme = isDark ? 'dark' : 'light'
    return () => {
      root.classList.remove('dark')
      root.style.colorScheme = ''
    }
  }, [isDark])

  const [ui, setUi] = useLocalState(StorageKeys.ui, DEFAULT_UI)
  const preloadItems = useCallback(() => {
    preloadRoute('items')
    preloadAtlasImage(dataset?.atlas)
  }, [dataset?.atlas])
  const [hashTab, setHashTab] = useState<TabId | null>(readTabFromHash)
  const navigate = useCallback(
    (tab: TabId) => {
      setUi((prev) => ({ ...prev, activeTab: tab }))
      setHashTab(tab)
      const nextHash = tabHash(tab)
      if (window.location.hash !== nextHash) window.location.hash = nextHash
    },
    [setUi],
  )
  useEffect(() => {
    const onHashChange = () => setHashTab(readTabFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  // 「指令 → 物品」里点「前往物品图鉴」时带上要展示的物品 id；物品图鉴消费后清空。
  const [dexFocus, setDexFocus] = useState<number | null>(null)
  const consumeDexFocus = useCallback(() => setDexFocus(null), [])
  /**
   * 物品提示里的「合成表」入口（`ItemDetailProvider`）：跳到「物品图鉴」并打开该物品详情。
   * 图鉴页会用自己的 Provider 覆盖它（就地打开抽屉，不切页、不丢当前筛选）。
   */
  const itemDetailApi = useMemo<ItemDetailApi>(
    () => ({
      open: (itemId) => {
        setDexFocus(itemId)
        navigate('items')
      },
    }),
    [navigate],
  )
  // 已激活模块（侧边栏入口）；「设置」里探测到插件并打开开关后写入。
  const [rawModules, setModules] = useLocalState<ModulesPrefs>(StorageKeys.modules, DEFAULT_MODULES)
  const modules = useMemo(() => sanitizeModules(rawModules), [rawModules])
  // 用户手动改过开关的模块（按服务器记忆）：改过就不再被「检测到插件自动激活」覆盖。
  const [rawModulesSet, setModulesSet] = useLocalState<ModulesPrefs>(
    StorageKeys.modulesSet,
    DEFAULT_MODULES,
  )
  const modulesSet = useMemo(() => sanitizeModules(rawModulesSet), [rawModulesSet])
  // 供登录后的自动激活读取最新值，避免把 modules / modulesSet 塞进 effect 依赖。
  const modulesRef = useRef({ prefs: modules, userSet: modulesSet })
  useEffect(() => {
    modulesRef.current = { prefs: modules, userSet: modulesSet }
  }, [modules, modulesSet])
  // 用户自定义模块（名称 + 指令），存本机 `tswui:customModules`。
  const [rawCustomModules, setCustomModules] = useLocalState<CustomModule[]>(
    StorageKeys.customModules,
    [],
  )
  const customModules = useMemo(() => sanitizeCustomModules(rawCustomModules), [rawCustomModules])

  // 「统一执行」（批量执行）偏好：检测到信使插件后自动开启；用户手动改过则不再自动开。
  const [batchMode, setBatchMode] = useLocalState(StorageKeys.homeBatch, false)
  const [batchModeSet] = useLocalState(StorageKeys.homeBatchSet, false)
  const batchPrefsRef = useRef({ mode: batchMode, userSet: batchModeSet })
  useEffect(() => {
    batchPrefsRef.current = { mode: batchMode, userSet: batchModeSet }
  }, [batchMode, batchModeSet])

  // 多服务器：列表与当前选中项（activeId 写入 localStorage，transport 每次请求读取）。
  const [servers, setServers] = useState<ServerTarget[]>(() => loadServerTargets())
  const [activeServerId, setActiveServerId] = useState<string>(() => readActiveTargetId())

  // 兼容旧版持久化的 activeTab='history' / 'favorites' / 'npcs' / 'tiles' / 'codex'。
  // URL hash 优先于本机持久化；已停用模块的入口回退到首页。
  const activeTab: TabId = (() => {
    const raw = (hashTab ?? ui.activeTab) as string
    if (raw === 'history' || raw === 'favorites') return 'editor'
    if (raw === 'npcs' || raw === 'tiles' || raw === 'codex') return 'dataid'
    // 所有模块（含玩家管理）都严格跟随侧边栏开关；关闭后直达 URL 也回到首页。
    if (
      (raw === 'players' ||
        raw === 'store' ||
        raw === 'requisition' ||
        raw === 'world' ||
        isCustomModuleId(raw)) &&
      !isModuleEnabled(modules, activeServerId, raw)
    ) {
      return 'home'
    }
    return raw
  })()

  useEffect(() => {
    const nextHash = tabHash(activeTab)
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash)
    }
  }, [activeTab])

  // 侧边栏导航：固定项 + 已激活模块入口（玩家管理 / 鱼店）。
  // 注意：必须在任何 early return 之前声明（Hooks 顺序稳定）；模块按服务器区分。
  const nav = useMemo(() => {
    const items: NavItem[] = [
      { id: 'home', label: t('nav.home'), icon: House, group: 'primary' },
      { id: 'editor', label: t('nav.editor'), icon: Terminal, group: 'primary' },
      { id: 'items', label: t('nav.items'), icon: BookOpen, group: 'library', onPrefetch: preloadItems },
      { id: 'dataid', label: t('nav.dataId'), icon: LayoutGrid, group: 'library', onPrefetch: () => preloadRoute('dataid') },
    ]
    const icons: Record<string, typeof House> = { players: Users, store: Fish, requisition: ClipboardList, world: Globe2 }
    const groups: Record<string, NavItem['group']> = {
      players: 'players',
      world: 'world',
      store: 'store',
      requisition: 'services',
    }
    for (const def of MODULE_DEFS) {
      // 内置模块同样只由开关控制侧边栏显隐，不因插件未安装而锁定。
      if (!isModuleEnabled(modules, activeServerId, def.id)) continue
      items.push({
        id: def.id,
        label: t(def.titleKey),
        icon: icons[def.id] ?? House,
        group: groups[def.id] ?? 'services',
        onPrefetch: () => preloadRoute(def.id),
      })
    }
    for (const mod of customModules) {
      if (!isModuleEnabled(modules, activeServerId, mod.id)) continue
      items.push({
        id: mod.id,
        label: mod.name || t('modules.custom.untitled'),
        // 与「设置 → 激活模块」卡片同图标（lucide Plug）。
        icon: Plug,
        group: 'custom',
        onPrefetch: () => preloadRoute('world'),
      })
    }
    // 「设置」始终排在最后：新增模块（内置 / 自定义）都插在它前面。
    items.push({
      id: 'settings',
      label: t('settings.title'),
      icon: SettingsIcon,
      group: 'system',
      onPrefetch: () => preloadRoute('settings'),
    })
    return items
  }, [modules, activeServerId, t, customModules, preloadItems])

  const [serverInfo, setServerInfo] = useState<ServerInfo>(DEFAULT_SERVER_INFO)
  // 渲染缓存（不含 token）；真实登录态以 /api/session 为准。
  const [me, setMe] = useLocalState<Me | null>(StorageKeys.me, null)

  const [session, setSession] = useState<Session>(ANON)
  const [loginOpen, setLoginOpen] = useState(false)
  // 退出登录需要二次确认，避免误触。
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)
  // 登录框被动弹出时的说明 i18n key（token 失效 / 会话过期）。
  const [loginReason, setLoginReason] = useState<string | null>(null)
  const [players, setPlayers] = useState<string[]>([])
  const [status, setStatus] = useState<ServerStatus | null>(null)
  // 已通过登录动作建立会话；用于避免首屏 /api/session 的慢响应把登录态覆盖回未登录。
  const authedRef = useRef(false)
  // 等待登录结果的请求（token 失效时，指令执行会 await 它）。
  const pendingAuthRef = useRef<((ok: boolean) => void) | null>(null)

  const clearLocalUser = useCallback(() => {
    authedRef.current = false
    setSession(ANON)
    setMe(null)
    removeKey(StorageKeys.me)
  }, [setMe])

  /** 解析等待中的登录请求（成功 true / 取消 false）。 */
  const settleAuth = useCallback((ok: boolean) => {
    const resolve = pendingAuthRef.current
    pendingAuthRef.current = null
    resolve?.(ok)
  }, [])

  /**
   * 被动要求重新登录：清本地会话、弹出登录框，并返回一个 Promise，
   * 在玩家完成登录后 resolve(true)，取消登录则 resolve(false)。
   * 供 CommandPage 在 token 失效时 await，登录成功后可自动重试指令。
   */
  const requireLogin = useCallback(
    (reasonKey: string): Promise<boolean> => {
      clearLocalUser()
      setLoginReason(reasonKey)
      setLoginOpen(true)
      return new Promise<boolean>((resolve) => {
        // 若有旧的等待者，先让它失败，避免悬挂。
        pendingAuthRef.current?.(false)
        pendingAuthRef.current = resolve
      })
    },
    [clearLocalUser],
  )

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const ds = await loadDataset(settings.language)
      if (reconcileDataVersion(ds.meta)) {
        setNotice(translate(settings.language, 'app.versionChanged'))
      }
      setDataset(ds)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'data load failed')
    }
  }, [settings.language])

  useEffect(() => {
    void load()
  }, [load])

  // 物品图鉴是高频入口。首次打开时同时等待路由 chunk 与约 1.9 MB 图集解码，
  // 会在点击后形成明显长任务；在空闲时先预热，点击时就只剩页面渲染。
  useEffect(() => {
    if (!dataset) return
    const win = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(preloadItems, { timeout: 1500 })
      return () => win.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(preloadItems, 1200)
    return () => window.clearTimeout(id)
  }, [dataset, preloadItems])

  // 多服务器能力探测（是否允许自定义上游 + 后端默认地址）。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const info = await transport.servers()
      if (!cancelled) setServerInfo(info)
    })()
    return () => {
      cancelled = true
    }
  }, [transport])

  // 启动时清理已废弃的 tswui:auth（旧版曾存 token），再探测真实会话（设计原则与约束 C15）。
  useEffect(() => {
    removeKey(StorageKeys.auth)
    let cancelled = false
    void (async () => {
      const s = await transport.session()
      if (cancelled) return
      // 若期间用户已登录，忽略这个较早的未登录结果，避免把登录态覆盖掉。
      if (authedRef.current && !s.authenticated) return
      setSession(s)
      if (s.authenticated && s.username) {
        setMe({ username: s.username, savedAt: Date.now() })
      } else if (!s.authenticated) {
        // 本机记住了账密 → 说明玩家希望重启后自动重登，直接弹出登录框。
        const memory = loadLoginMemory(readActiveTargetId())
        if (memory.remember && memory.username && memory.password) {
          setLoginReason('app.sessionExpired')
          setLoginOpen(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [transport, setMe])

  // 状态探测 + 玩家列表（在线玩家需要会话；未登录时后端返回 401，这里静默降级）。
  useEffect(() => {
    if (!dataset) return
    let cancelled = false
    void (async () => {
      const s = await transport.serverStatus()
      if (!cancelled) setStatus(s)
      // 真实模式未登录时不请求在线玩家（避免无意义的 401）。
      if (!transport.mock && !session.authenticated) {
        if (!cancelled) setPlayers([])
        return
      }
      try {
        const list = await transport.playersList()
        if (!cancelled) setPlayers(list)
      } catch {
        if (!cancelled) setPlayers([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dataset, session.authenticated, transport, activeServerId])

  // 登录后拉取运行时指令目录 + 游戏内执行能力；切换服务器 / 退出登录要重新拉取。
  useEffect(() => {
    if (!dataset || !session.authenticated) {
      setRuntimeCommands([])
      setIngameAllowed(false)
      setRuntimeParams({})
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const cmds = await transport.runtimeCommands()
        if (!cancelled) setRuntimeCommands(cmds)
      } catch {
        if (!cancelled) setRuntimeCommands([])
      }
      // 统一能力矩阵：一次请求拿到批量执行 / 玩家管理 / 鱼店 / 物资申请等的可用性
      //（此前是分别打 4 个探测端点；首页与设置页读同一份，不再各自重复探测）。
      try {
        const caps = await transport.capabilities()
        if (!cancelled) {
          setIngameAllowed(caps.batch.ingame === true)
          // 「统一执行」：检测到信使插件后自动开启（用户手动关过则保持其选择）。
          const { mode, userSet } = batchPrefsRef.current
          if (caps.batch.plugin === true && !userSet && !mode) setBatchMode(true)
          // 检测到插件（玩家管理 / 鱼店 / 物资申请）→ 自动激活对应侧边栏入口；用户手动改过开关的不覆盖。
          // TShock 不可达时 caps.reachable=false，此时不据此改动模块开关。
          if (caps.reachable) {
            const { prefs, userSet: modUserSet } = modulesRef.current
            const next = autoActivateModules(prefs, modUserSet, activeServerId, {
              players: caps.player.plugin === true && caps.player.permission === true,
              store: caps.fish.plugin === true && caps.fish.permission === true,
              requisition:
                caps.requests.plugin === true && (caps.requests.submit === true || caps.requests.review === true),
            })
            if (next !== prefs) setModules(next)
          }
        }
      } catch {
        if (!cancelled) setIngameAllowed(false)
      }
      // 区域 / 传送点（插件缺失或权限不足时为空，不影响其它补全）。
      try {
        const [regions, warps] = await Promise.all([
          transport.pluginData('regions').catch(() => []),
          transport.pluginData('warps').catch(() => []),
        ])
        if (!cancelled) {
          setRuntimeParams({
            regions: regions.map((r) => r.name),
            warps: warps.map((w) => w.name),
          })
        }
      } catch {
        if (!cancelled) setRuntimeParams({})
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dataset, session.authenticated, transport, activeServerId, setBatchMode, setModules])

  // 静态数据集 + 运行时指令目录（仅补充本地没有的插件指令）。
  const effectiveDataset = useMemo(
    () => (dataset ? withRuntimeCommands(dataset, runtimeCommands) : null),
    [dataset, runtimeCommands],
  )

  const handleTokenInvalid = useCallback(
    () => requireLogin('app.tokenInvalid'),
    [requireLogin],
  )

  const handleLogout = useCallback(async () => {
    const name = session.username ?? me?.username ?? ''
    try {
      await transport.logout()
    } catch {
      /* 即使后端销毁失败也清除本地渲染缓存 */
    }
    clearLocalUser()
    // 换账号 / 退出后不保留上一个用户的头像。
    clearSelfAvatar()
    setNotice(null)
    // 主动退出时不再自动回填密码（保留用户名与「记住」偏好）；避免刷新后又被弹登录框。
    saveLoginMemory(activeServerId, {
      username: name,
      password: '',
      remember: loadLoginMemory(activeServerId).remember,
    })
  }, [transport, clearLocalUser, session.username, me?.username, activeServerId])

  // ---- 多服务器切换 ----

  /**
   * 选中某个上游。各服的会话在后端彼此独立（按上游分开的 Cookie），
   * 所以切换后**按新上游重新探测登录态**：这台服之前登录过就直接进去，
   * 没登录过才弹登录框；既不会串用别的服的 token，也不会把别的服踢下线。
   */
  const selectServer = useCallback(
    async (id: string) => {
      if (id === activeServerId) return
      writeActiveTargetId(id)
      setActiveServerId(id)
      clearLocalUser()
      setNotice(translate(settings.language, 'servers.switched'))
      let next: Session = ANON
      try {
        next = await transport.session()
      } catch {
        /* 探测失败按未登录处理 */
      }
      if (next.authenticated && next.username) {
        authedRef.current = true
        setSession(next)
        setMe({ username: next.username, savedAt: Date.now() })
        return
      }
      setLoginReason('servers.switched')
      setLoginOpen(true)
    },
    [activeServerId, transport, clearLocalUser, settings.language, setMe],
  )

  // 新增上游只写入列表，**不自动切换**（由玩家在列表里点选）。
  const addServer = useCallback((target: ServerTarget) => {
    setServers((prev) => {
      const next = addServerTarget(prev, target)
      saveServers(next)
      return next
    })
  }, [])

  // 修改已保存的上游：替换列表项；改的是当前上游时，地址已变、旧 token 失效，走一次切换（要求重新登录）。
  const updateServer = useCallback(
    (oldId: string, target: ServerTarget) => {
      setServers((prev) => {
        const next = updateServerTarget(prev, oldId, target)
        saveServers(next)
        return next
      })
      if (activeServerId === oldId) void selectServer(target.id)
    },
    [activeServerId, selectServer],
  )

  const removeServer = useCallback(
    (id: string) => {
      setServers((prev) => {
        const next = prev.filter((s) => s.id !== id)
        saveServers(next)
        return next
      })
      if (activeServerId === id) void selectServer(BUILTIN_ID)
    },
    [activeServerId, selectServer],
  )

  if (loadError) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <Card className="max-w-md">
          <CardBody className="flex flex-col gap-3 pt-4">
            <h1 className="text-base font-semibold text-destructive">{t('app.loadError')}</h1>
            <p className="text-sm text-foreground/80">{loadError}</p>
            <p className="text-xs text-foreground/60">{t('app.loadErrorHint')}</p>
            <Button variant="primary" onClick={() => void load()}>
              {t('app.retry')}
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  if (!dataset) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex items-center gap-3 text-foreground/80">
          <Spinner />
          {t('app.loading')}
        </div>
      </div>
    )
  }

  const username = session.username ?? me?.username ?? null
  // 渲染统一使用「静态数据 + 运行时插件指令」的合并数据集。
  const view = effectiveDataset ?? dataset
  const versionMismatch =
    status?.reachable === true &&
    status.serverversion != null &&
    normalizeVersion(status.serverversion) !== normalizeVersion(dataset.meta.gameVersion)

  const banner = (
    <div className="flex flex-col">
      {transport.mock && (
        <Alert variant="info" className="rounded-none px-4 py-1.5">
          <AlertDescription className="flex min-w-0 items-center gap-2 text-xs text-foreground">
            <Badge tone="mock">Mock</Badge>
            <span
              className="min-w-0 flex-1 truncate"
              title={t('app.mockBanner', { label: transport.label })}
            >
              {t('app.mockCompact')}
            </span>
          </AlertDescription>
        </Alert>
      )}
      {versionMismatch && (
        <Alert variant="warning" className="rounded-none px-4 py-1.5">
          <AlertDescription className="text-2xs">
            {t('app.versionMismatch', {
              server: status?.serverversion ?? '?',
              data: dataset.meta.gameVersion,
            })}
          </AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert variant="default" className="rounded-none px-4 py-1.5">
          <AlertDescription className="flex items-center justify-between gap-2 text-2xs text-foreground">
            <span>{notice}</span>
            <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
              {t('app.gotIt')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )

  // 侧栏账号卡片上的服务器地址（遮挡展示；内置项不再显示「服务器默认」）。
  const accountServerLabel =
    activeServerId === BUILTIN_ID
      ? serverInfo.default
        ? hostPortLabel(maskHost(serverInfo.default.host), serverInfo.default.port)
        : (status?.name ?? '—')
      : maskedTargetLabel(resolveTarget(servers, activeServerId))

  return (
    <I18nProvider lang={settings.language}>
      <DatasetProvider value={view}>
        <ExecutionQueueProvider interval={settings.commandInterval}>
        <CommandResultsProvider serverId={activeServerId}>
        <div className="h-full">
        <ItemDetailProvider api={itemDetailApi}>
        <AppShell
          activeTab={activeTab}
          onTabChange={navigate}
          nav={nav}
          headerExtra={
            <QuickPreferences
              theme={settings.theme}
              language={settings.language}
              onThemeChange={(theme) => setSettings({ ...settings, theme })}
              onLanguageChange={(language) => setSettings({ ...settings, language })}
            />
          }
          sidebarCollapsed={ui.sidebarCollapsed}
          onToggleSidebar={() => setUi({ ...ui, sidebarCollapsed: !ui.sidebarCollapsed })}
          compact={settings.compact}
          banner={banner}
          sidebarExtra={<ExecutionQueuePanel />}
          headerRight={
            <>
              <SidebarAccountMenu
                serverId={activeServerId}
                serverLabel={accountServerLabel}
                serverOnline={status?.reachable === true}
                username={username}
                mock={transport.mock}
                servers={servers}
                activeId={activeServerId}
                info={serverInfo}
                transport={transport}
                onSelectServer={(id) => void selectServer(id)}
                onAddServer={addServer}
                onEditServer={updateServer}
                onRemoveServer={removeServer}
                onLogin={() => {
                  setLoginReason(null)
                  setLoginOpen(true)
                }}
                onLogout={() => setConfirmLogoutOpen(true)}
              />
            </>
          }
        >
          <AppRoutes
            activeTab={activeTab}
            dataset={view}
            transport={transport}
            authenticated={session.authenticated}
            username={username}
            serverId={activeServerId}
            modules={modules}
            settings={settings}
            players={players}
            ingameAllowed={ingameAllowed}
            runtimeValues={runtimeParams}
            customModules={customModules}
            dexFocus={dexFocus}
            onNavigate={navigate}
            onLogin={() => {
              setLoginReason(null)
              setLoginOpen(true)
            }}
            onTokenInvalid={handleTokenInvalid}
            onFocusConsumed={consumeDexFocus}
            onOpenInDex={(itemId) => {
              setDexFocus(itemId)
              navigate('items')
            }}
            onModulesChange={setModules}
            onModuleUserSet={(id) =>
              setModulesSet((prev) => setModuleEnabled(prev, activeServerId, id, true))
            }
            onCustomModulesChange={setCustomModules}
            onSettingsChange={(patch) => setSettings({ ...settings, ...patch })}
          />
        </AppShell>
        </ItemDetailProvider>

        <Dialog open={confirmLogoutOpen} onOpenChange={setConfirmLogoutOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{t('logout.title')}</DialogTitle>
              <DialogDescription>{t('logout.message')}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmLogoutOpen(false)}>
                {t('action.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setConfirmLogoutOpen(false)
                  void handleLogout()
                }}
              >
                {t('action.logout')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <LoginDialog
          open={loginOpen}
          reason={loginReason ? t(loginReason) : undefined}
          serverId={activeServerId}
          serverLabel={accountServerLabel}
          serverOnline={status?.reachable === true}
          servers={servers}
          info={serverInfo}
          onSelectServer={(id) => void selectServer(id)}
          onAddServer={addServer}
          onEditServer={updateServer}
          onRemoveServer={removeServer}
          onClose={() => {
            setLoginOpen(false)
            setLoginReason(null)
            settleAuth(false)
          }}
          transport={transport}
          onSuccess={(user) => {
            const wasPending = pendingAuthRef.current != null
            authedRef.current = true
            setSession({ authenticated: true, username: user.username })
            setMe({ username: user.username, savedAt: Date.now() })
            setLoginReason(null)
            setNotice(wasPending ? t('app.reloginOk') : null)
            settleAuth(true)
          }}
        />
        </div>
        </CommandResultsProvider>
        </ExecutionQueueProvider>
      </DatasetProvider>
    </I18nProvider>
  )
}
