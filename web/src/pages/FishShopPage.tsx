import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Droplets,
  Fish,
  Footprints,
  ListFilter,
  Maximize2,
  MessageSquare,
  Minimize2,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  ShoppingCart,
  Star,
} from 'lucide-react'
import { IconAction } from '@/components/IconAction'
import { SettingsPopoverHeader } from '@/components/SettingsPopoverHeader'
import { ContentScrim } from '@/components/ContentScrim'
import { PageHelp } from '@/components/PageHelp'
import { PluginHelp } from '@/components/PluginHelp'
import { TopBarActions } from '@/components/TopBar'
import { FullscreenDock } from '@/components/FullscreenDock'
import { ItemIcon } from '@/components/ItemIcon'
import { LoginGate } from '@/components/LoginGate'
import { SearchInput } from '@/components/SearchInput'
import { Notice } from '@/components/Notice'
import { CommandOutput } from '@/components/ResultPanel'
import { FishCommandCards } from '@/components/FishCommandCards'
import {
  CELL_ICON_SIZE,
  DEFAULT_GOOD_ICON_SIZE,
  GOOD_GRID_CLASS,
  GOOD_SIZES,
  GoodThumb,
  goodIcon,
  goodPrefixName,
  type GoodIconSize,
} from '@/components/fishshop/GoodCells'
import { GoodDiagram } from '@/components/fishshop/GoodDiagram'
import { FishDetailSurface } from '@/components/fishshop/FishDetailSurface'
import { GoodGrid } from '@/components/fishshop/GoodGrid'
import { GoodsTable } from '@/components/fishshop/GoodsTable'
import { ShopAwning } from '@/components/fishshop/ShopAwning'
import { useChatSend } from '@/hooks/useChatSend'
import { usePageScrollReset, useStickyHeaderOffset } from '@/hooks/usePageScroll'
import { useSettingsPopoverFocus } from '@/hooks/useSettingsPopoverFocus'
import { cn } from '@/lib/cn'
import type { IngamePolicy } from '@/lib/ingame'
import { showsMetaToggle } from '@/lib/iconGridSize'
import { splitFishArgs } from '@/lib/fishArgs'
import {
  FISH_CATEGORIES,
  matchFishCategories,
  resolveFishCategory,
  type FishCategoryId,
} from '@/lib/fishCategory'
import { diagramUrl } from '@/lib/fishDiagram'
import { isDegradedGood } from '@/lib/fishGood'
import { formatItemTag } from '@/lib/items'
import {
  findLiveGood,
  fishGoodKey,
  migrateRecentBuys,
  resolveStamps,
  sanitizeStamps,
  stampGood,
  type FishGoodStamp,
} from '@/lib/fishGoodKey'
import { PLUGIN_LINKS } from '@/lib/pluginLinks'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardBody,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Checkbox,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SheetHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui'
import { useLocalState } from '@/hooks/useLocalState'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useModuleState } from '@/hooks/useModuleState'
import { useNow } from '@/hooks/useNow'
import { formatClockWithDate, formatShortClock, formatShortDateTime } from '@/lib/clock'
import { useDataset } from '@/lib/datasetContext'
import {
  EMPTY_FISH_SHELF_STORE,
  isShelfStale,
  readFishShelfCache,
  writeFishShelfCache,
  type FishShelfStore,
} from '@/lib/fishShelfCache'
import { useI18n } from '@/lib/i18n'
import { useSearchIntent } from '@/lib/searchIntent'
import { StorageKeys } from '@/lib/storage'

import { TshockRequestError } from '@/lib/tshock'
import type { BackendTransport, FishBuyResult, FishCapabilities, FishGood, FishShop } from '@/lib/tshock'

/**
 * 鱼店（TShock 第三方插件 FishShop）。
 *
 * 参照「物品图鉴」：工具条一张卡片，商品网格直接铺在页面上（无卡片背景）；
 * 点击商品弹出详情弹框（价格 / 解锁 / 别名 / 限购 / 购买时机 / 备注都渲染 [i:..] 图标）。
 *
 * 走插件自带的 REST 端点（`/fishshop/*`）：
 *   - /api/fish/capabilities → 插件是否在 / 有没有 REST 接口 / 有没有权限（后端就是读一次 /fishshop/list）
 *   - /api/fish/list → 货架（含 icon / iconId / buyMax / needArgs / argCount / 限购与时机）
 *   - /api/fish/buy  → 为自己购买
 *
 * 货架是**配置快照**：拉到一次就存本机（按服务器，见 `lib/fishShelfCache.ts`），
 * 只有手动「刷新货架」与 `/fish reload` 成功后才重拉 — 服主改完配置通知玩家点一下即可。
 * 个人限购 / 冷却由购买时上游当场判，所以请求不带 `self`。
 *
 * 插件版本过旧（v1.6.2 之前只有游戏内指令）或没权限时，左侧只显示提示；
 * 右侧指令卡片只走 rawcmd，不依赖 REST，因此照常可用。
 */
interface FishShopPageProps {
  /** 当前上游 id：界面状态与货架按服务器分开。 */
  serverId: string
  transport: BackendTransport
  authenticated: boolean
  /** 右侧指令卡片的自动刷新间隔（毫秒，0 = 不自动刷新）。货架不参与：它只在手动刷新 / 重载配置时重拉。 */
  refreshInterval: number
  /** 哪些 `allowServer=false` 的指令能在网页执行（右侧卡片添加弹框用）。 */
  ingame: IngamePolicy
  players?: string[]
  runtimeValues?: { regions?: string[]; warps?: string[] }
  onTokenInvalid: () => Promise<boolean>
  onLogin: () => void
}

interface FishUiState extends Record<string, unknown> {
  query: string
  /** 「页面设置 → 隐藏编号和名称」：只显示图标（与物品 ID 的同一开关同义）。 */
  hideMeta?: boolean
  /** 「页面设置 → 图标大小」：小 / 中 / 大（32 / 48 / 64）。 */
  iconSize?: GoodIconSize
  /** 「页面设置 → 表格视图」。 */
  tableView?: boolean
  /** 「页面设置 → 货架层板」：默认显示（关掉就是纯网格，没有板线）。 */
  shelf?: boolean
  /** 「页面设置 → 遮阳伞」：默认显示（表格视图本来就不画）。 */
  awning?: boolean
  /** 工具条页签：全部 / 买过 / 收藏。 */
  tab?: FishTab
  /** 分组筛选（「收藏」右边那颗下拉，界面上叫「分组」）：单选，没选 = 不筛。 */
  category?: FishCategoryId
  /** 买过的商品（**按内容指纹去重、最新在前**，不存 serial）。 */
  buys?: FishGoodStamp[]
  /** 收藏的商品（同上）。 */
  favorites?: FishGoodStamp[]
  /** 打开着的详情（按内容指纹存快照，与「买过 / 收藏」同一套）：切到别的页面再回来，详情还开着。 */
  detail?: FishGoodStamp
  /** @deprecated 旧版本的「最近购买」（没有指纹），首次读到会迁移进 `buys`。 */
  recentBuys?: FishGood[]
}

/** 货架页签（全部 / 买过 / 收藏）。 */
const FISH_TABS = ['all', 'bought', 'favorite'] as const
type FishTab = (typeof FISH_TABS)[number]

const DEFAULT_STATE: FishUiState = { query: '' }

/** 本机存的「图标大小」可能是旧版本写坏的值：认不出来就回到默认的「中」（鱼店比物品 ID 小一档）。 */
function resolveIconSize(value: unknown): GoodIconSize {
  if (value === 'sm' || value === 'md' || value === 'lg' || value === 'row') return value
  return DEFAULT_GOOD_ICON_SIZE
}

/** 「买过 / 收藏」各存多少条（本机 localStorage；一个服通常也就几十到几百件商品）。 */
const SAVED_MAX = 80

/** 本机存的页签可能被改坏：认不出来就回到「全部」。 */
function resolveTab(value: unknown): FishTab {
  return value === 'bought' || value === 'favorite' ? value : 'all'
}

/** 网格图标尺寸：与「物品图鉴」一致（64px）。 */
export function FishShopPage({
  serverId,
  transport,
  authenticated,
  refreshInterval,
  ingame,
  players,
  runtimeValues,
  onTokenInvalid,
  onLogin,
}: FishShopPageProps) {
  const { t, lang } = useI18n()
  const dataset = useDataset()
  const [ui, setUi] = useModuleState<FishUiState>(serverId, 'store', DEFAULT_STATE)

  /** 全局搜索选中某件商品时带上编号：等货架到了再打开详情（冷启动时 intent 先于数据到达）。 */
  const [pendingSerial, setPendingSerial] = useState<number | null>(null)
  // 全局搜索选了「鱼店商品」：把词填进搜索框；带了编号就在货架就绪后直接打开那一件的详情。
  // （点「更多」进二级后走的是同一条路，只是没有编号 → 只筛词。）
  useSearchIntent(
    'store',
    useCallback((intent) => {
      if (intent.query != null) setUi({ query: intent.query, category: undefined })
      if (intent.goodsSerial != null) setPendingSerial(intent.goodsSerial)
    }, [setUi]),
  )
  const [capability, setCapability] = useState<FishCapabilities | null>(null)
  const [checking, setChecking] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [shop, setShop] = useState<FishShop | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 货架是配置快照：缓存在本机（按服务器分开），有缓存就不再请求。
  const [shelfStore, setShelfStore] = useLocalState<FishShelfStore>(
    StorageKeys.fishShelf,
    EMPTY_FISH_SHELF_STORE,
  )
  const shelfStoreRef = useRef(shelfStore)
  useEffect(() => {
    shelfStoreRef.current = shelfStore
  }, [shelfStore])
  /** 货架上次拉到的时间（ms）；null = 还没有货架。 */
  const [shelfAt, setShelfAt] = useState<number | null>(null)
  /** 已经为哪台服务器自动拉过一次（避免持续失败时无限重试；登出 / 换服时重置）。 */
  const autoFetchedFor = useRef<string | null>(null)
  // 每分钟重算一次：跨过 24 小时后「更新于 …」要自己变成警告色。
  const now = useNow(60_000)
  const shelfStale = isShelfStale(shelfAt, now)

  // 详情弹框：`selectedSnapshot` 只是「点了哪一条」，真正展示/购买用的是派生出来的
  // `selected`（同一 serial 的最新货架数据）——这样刷新货架后「我的进度」「能不能买」
  // 会自动跟着变，而货架暂时为空（加载失败）时仍能显示上一次的快照。
  //
  // 切到别的页面时本组件会被卸掉（`AppRoutes` 按 activeTab 条件渲染），所以「刚在看哪件」
  // 存在本机（`ui.detail`），回到鱼店时接着打开。
  const [selectedSnapshot, setSelected] = useState<FishGood | null>(
    () => sanitizeStamps([ui.detail], 1)[0]?.good ?? null,
  )
  // 恢复出来的详情不抢焦点：从别的页面切回来，光标不该被拉进详情里。
  const skipDetailAutofocus = useRef(selectedSnapshot !== null)
  // 右列（指令卡片 / 记事本）是否还有内容：全隐藏时左栏铺满整行。
  const [cardsVisible, setCardsVisible] = useState(true)
  // 货架上的「同款」：按**内容指纹**找，不按 serial —— 服主增删商品后 serial 会整体错位，
  // 按 serial 找会把「收藏的那件」打开成後面另一件商品。
  const selectedLive = useMemo(
    () => (selectedSnapshot ? findLiveGood(selectedSnapshot, shop?.goods ?? []) : null),
    [selectedSnapshot, shop],
  )
  const selected = selectedLive ?? selectedSnapshot
  const [amount, setAmount] = useState('1')
  const [args, setArgs] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [buying, setBuying] = useState(false)
  const [buyResult, setBuyResult] = useState<FishBuyResult | null>(null)
  // 购买成功后的冷却秒数：期间禁用购买按钮，避免连点重复购买。
  const [buyCooldown, setBuyCooldown] = useState(0)
  const argsRef = useRef<HTMLInputElement>(null)
  const buyRef = useRef<HTMLButtonElement>(null)

  const kindMessage = useCallback(
    (err: unknown): string => {
      if (err instanceof TshockRequestError) {
        switch (err.kind) {
          case 'token':
          case 'auth':
            return t('app.tokenInvalid')
          case 'permission':
            return t('fish.err.permission')
          case 'plugin_missing':
            return t('fish.err.pluginMissing')
          case 'plugin_outdated':
            return t('fish.err.pluginOutdated')
          case 'rate_limited':
            return t('fish.err.rateLimited')
          case 'timeout':
            return t('fish.err.timeout')
          case 'unavailable':
            return t('fish.err.unavailable')
          case 'validation':
            return err.message
          default:
            return t('fish.err.badResponse')
        }
      }
      return err instanceof Error ? err.message : t('fish.err.badResponse')
    },
    [t],
  )

  // 实时探测插件可用性（登录后 / 切换服务器后重探；「重新检测」按钮也复用这里）。
  //
  // 为什么要手动重探：FishShop 插件的 REST 端点是**插件初始化 5 秒后**才注册的
  // （插件源码 `TShockFishShop/FishShop.cs` 里 `await Task.Delay(5000)` 后调用 `RegisterRestApi()`），
  // 刚更新 / 重启插件就打开鱼店会探到 404；页面停留时不会自动再探，所以给个按钮。
  const probe = useCallback(async () => {
    if (!authenticated) {
      setCapability(null)
      setProbeError(null)
      setShop(null)
      return
    }
    setChecking(true)
    setProbeError(null)
    try {
      setCapability(await transport.fishCapabilities())
    } catch (err) {
      if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
        onTokenInvalid()
      }
      setCapability(null)
      setProbeError(kindMessage(err))
    } finally {
      setChecking(false)
    }
  }, [authenticated, transport, onTokenInvalid, kindMessage])

  // 能力 / 货架的写入方，给「拉完货架顺手把缓存写掉」用（避免给 loadShop 多加依赖）。
  const capabilityRef = useRef<FishCapabilities | null>(null)
  useEffect(() => {
    capabilityRef.current = capability
  }, [capability])

  // 进入页面 / 切换服务器 / 登入登出：有货架缓存就直接换上（连能力一起），**不发任何请求**。
  useEffect(() => {
    autoFetchedFor.current = null
    const hit = authenticated ? readFishShelfCache(shelfStoreRef.current, serverId) : null
    setCapability(hit?.capability ?? null)
    setShop(hit?.shop ?? null)
    setShelfAt(hit?.at ?? null)
    setProbeError(null)
  }, [authenticated, serverId])

  // 没有缓存才探测插件（serverId 也进依赖：切换服务器要重新探，插件 / 权限可能不同）。
  useEffect(() => {
    if (readFishShelfCache(shelfStoreRef.current, serverId)) return
    void probe()
  }, [serverId, probe])

  const plugin = capability?.plugin === true
  const restReady = capability?.rest === true
  const canUse = plugin && restReady && capability?.permission === true

  const loadShop = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 不带 `self`：货架是配置快照，个人限购 / 冷却由购买（`/fishshop/buy`）当场判。
      const data = await transport.fishList()
      const at = Date.now()
      setShop(data)
      setShelfAt(at)
      const cap = capabilityRef.current
      if (cap) {
        setShelfStore((prev) => writeFishShelfCache(prev, serverId, { at, shop: data, capability: cap }))
      }
    } catch (err) {
      if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
        onTokenInvalid()
      }
      // 拉失败时保留上一次的货架（缓存里的也算），别把已经看到的商品清成空白。
      setError(kindMessage(err))
    } finally {
      setLoading(false)
    }
  }, [transport, onTokenInvalid, kindMessage, serverId, setShelfStore])

  // 货架为空才主动拉一次（首次进入 / 换服务器 / 缓存被清）。之后只有手动刷新与重载配置会重拉：
  // 正常的再次进入命中缓存 → 0 次请求。
  useEffect(() => {
    if (!authenticated || !canUse || shop) return
    if (autoFetchedFor.current === serverId) return
    autoFetchedFor.current = serverId
    void loadShop()
  }, [authenticated, canUse, shop, serverId, loadShop])

  const openDetail = useCallback((good: FishGood) => {
    setSelected(good)
    setAmount('1')
    setArgs('')
    setConfirming(false)
    setBuyResult(null)
    setError(null)
    // 记住「现在看的是哪件」：切走再回来时详情还开着，不用重新翻货架。
    setUi({ detail: stampGood([], good, 1)[0] })
  }, [setUi])

  // 货架到位后打开「全局搜索选中的那件」。找不到（已下架 / 编号变了）就只保留搜索词。
  // 这里必须「数据到达 → setState」：搜索那次导航发生在货架请求之前，没有别的事件能触发。
  useEffect(() => {
    if (pendingSerial == null) return
    const good = shop?.goods.find((item) => item.serial === pendingSerial)
    if (good) {
      // oxlint-disable-next-line react/set-state-in-effect -- 与货架数据到达同步
      setPendingSerial(null)
      openDetail(good)
      return
    }
    if (shop) setPendingSerial(null)
  }, [pendingSerial, shop, openDetail])

  const closeDetail = useCallback(() => {
    setSelected(null)
    setConfirming(false)
    setBuyResult(null)
    setError(null)
    setUi({ detail: undefined })
  }, [setUi])

  // 桌面端：详情是非模态抽屉（不压暗、不锁页面，开着也能切页、逛货架）；
  // 窄屏仍是普通模态抽屉（手机上本来就铺满整屏）。
  const desktop = useMediaQuery('(min-width: 768px)')

  // 网页发言（`POST /api/chat`）：带 `[WebUI] 玩家名:` 前缀播到游戏内聊天，失败直接 toast。
  const { send: sendChat, sending: advertising } = useChatSend({
    transport,
    toastOnError: true,
  })

  /**
   * 「广告到游戏内」：`#2 [i:29] = [i/s2:73]`。
   *
   * - 商品段用标准物品标签（带词缀 / 数量），服务类商品（`id < 0`）没有物品，退化用商品名；
   * - 价格段直接用插件给的 `cost` 原文（它本来就是「tag + 文字」的富文本）；为空则说「免费」。
   */
  const advertise = useCallback(
    (good: FishGood) => {
      // 词缀优先取结构化字段 `prefix`，没有再取图标标签里写的（服主常只在图标上写 `[i/p60:..]`）。
      const icon = goodIcon(good)
      const prefixId = (good.prefix || icon?.prefix) ?? 0
      const tag =
        good.id != null && good.id > 0
          ? formatItemTag(good.id, { prefixId, stack: good.stack ?? icon?.stack })
          : good.name
      return sendChat(`#${good.serial} ${tag} = ${good.cost.trim() || t('fish.free')}`)
    },
    [sendChat, t],
  )

  /** 买过 / 收藏：都按内容指纹存（不存 serial，见 `lib/fishGoodKey.ts`）。 */
  const boughtStamps = useMemo(() => {
    if (Array.isArray(ui.buys)) return sanitizeStamps(ui.buys, SAVED_MAX)
    // 旧版本只记了 `recentBuys`：先按快照显示，下面的 effect 再落成正式记录。
    return migrateRecentBuys(ui.recentBuys) ?? []
  }, [ui.buys, ui.recentBuys])
  const favoriteStamps = useMemo(() => sanitizeStamps(ui.favorites, SAVED_MAX), [ui.favorites])

  // 旧数据迁移（只做一次）：`recentBuys` → `buys`，然后把旧字段清掉。
  useEffect(() => {
    if (Array.isArray(ui.buys) || !Array.isArray(ui.recentBuys) || ui.recentBuys.length === 0) return
    const migrated = migrateRecentBuys(ui.recentBuys)
    if (migrated) setUi({ buys: migrated, recentBuys: undefined })
  }, [ui.buys, ui.recentBuys, setUi])

  /** 买成功就记一笔「买过」。 */
  const rememberPurchase = useCallback(
    (good: FishGood) => setUi({ buys: stampGood(boughtStamps, good, SAVED_MAX) }),
    [setUi, boughtStamps],
  )

  /**
   * 收藏 / 取消收藏。
   * `alias` 是「打开详情时存的那份快照」：商品被改名后货架数据与快照的指纹不同，
   * 取消收藏时两个指纹都要能匹配上，否则点了没反应。
   */
  const toggleFavorite = useCallback(
    (good: FishGood, alias?: FishGood | null) => {
      const keys = new Set([fishGoodKey(good)])
      if (alias) keys.add(fishGoodKey(alias))
      const already = favoriteStamps.some((stamp) => keys.has(stamp.key))
      setUi({
        favorites: already
          ? favoriteStamps.filter((stamp) => !keys.has(stamp.key))
          : stampGood(favoriteStamps, good, SAVED_MAX),
      })
    },
    [setUi, favoriteStamps],
  )


  // 支持参数（指令类）时不调数量；只有 buyMax > 1 才显示数量调节。
  const needArgs = selected?.needArgs === true
  const maxBuy = selected?.buyMax ?? 1
  const adjustable = !needArgs && maxBuy > 1
  const buyAmount = needArgs ? 1 : adjustable ? Math.min(maxBuy, Math.max(1, Number.parseInt(amount, 10) || 1)) : 1
  // 需要的参数个数（只有 1 个时不特意提示，一个输入框本来就一眼能看懂）。
  // `{args}` 记 1（`{args}` 会拿到全部参数）；`{0}{1}…` 取最大序号 +1。
  // 少给参数会被插件拒或让指令缺参执行，所以这里先卡住。
  const argCount = selected?.argCount ?? (needArgs ? 1 : 0)
  // 参数**原样**发给插件（前端不做转义 / 拼接），个数则按插件的 `SplitRestArgs` 规则数：
  // 按空白拆、引号包住的算一个参数。两边规则不一致就会出现「按钮能点但插件认为参数不够」，
  // 所以这里复用同一套规则，见 `lib/fishArgs.ts`。
  const argTokens = splitFishArgs(args)
  const argsReady = !needArgs || argTokens.length >= Math.max(1, argCount)

  /** 打开详情时的默认焦点（抽屉 / 弹框共用）：需填参数 → 参数框，否则 → 购买按钮。 */
  const focusDetailOnOpen = useCallback(
    (event: Event) => {
      event.preventDefault()
      // 从别的页面切回来（详情是恢复出来的）：不抢焦点，让玩家接着操作页面。
      if (skipDetailAutofocus.current) {
        skipDetailAutofocus.current = false
        return
      }
      if (needArgs) argsRef.current?.focus()
      else buyRef.current?.focus()
    },
    [needArgs],
  )

  // 能否购买由上游 `buy` 当场判：货架只是配置快照，NPC 在场 / 昼夜 / 生态 / 个人限购与冷却
  // 都可能在两次刷新之间变。
  // 降级条目：商品自身配置有误时插件只回基础字段（其余为空），点进去也买不了。
  const degraded = isDegradedGood(selected)
  // 从「买过 / 收藏」打开、但货架上已经没有这件：只能看快照，不能买。
  // 货架还没拉回来（`shop === null`）时不算「已下架」——否则切回页面会先闪一句误导人的提示。
  const offShelf = selectedSnapshot !== null && selectedLive === null && shop !== null
  // 还没在**当前货架**上认出来（货架未到 / 已下架）：`serial` 可能已经指向别的商品，
  // 而插件是按配置下标发货的——这把不能拿它下单，否则会买到别的东西。
  const unresolved = selectedSnapshot !== null && selectedLive === null
  // ⭐ 是否已收藏：货架数据与打开时的快照两个指纹都算（商品被改名后两者不同）。
  const favorited = useMemo(() => {
    if (!selected) return false
    const keys = new Set([fishGoodKey(selected)])
    if (selectedSnapshot) keys.add(fishGoodKey(selectedSnapshot))
    return favoriteStamps.some((stamp) => keys.has(stamp.key))
  }, [selected, selectedSnapshot, favoriteStamps])
  // 建造类商品（鱼池 / 小房间 / 钓棚）多一张注解图：站哪个位置、上下几格、左右误差多少。
  const diagram = diagramUrl(selected)
  // 限购 / 冷却 / 时机：插件给的都是**静态上限**（"你还剩几次"只有购买时才知道），只做展示。
  const limitLines: string[] = []
  if (selected?.allowGroup?.length) {
    limitLines.push(`${t('fish.limitGroup')}：${selected.allowGroup.join('、')}`)
  }
  if (selected?.allowPlayers?.length) {
    limitLines.push(`${t('fish.limitPlayers')}：${selected.allowPlayers.join('、')}`)
  }
  if (selected?.denyPlayers?.length) {
    limitLines.push(`${t('fish.denyPlayers')}：${selected.denyPlayers.join('、')}`)
  }
  if ((selected?.limit ?? 0) > 0) {
    limitLines.push(t('fish.limitPerPlayer', { n: selected?.limit ?? 0 }))
  }
  if ((selected?.serverLimit ?? 0) > 0) {
    limitLines.push(t('fish.limitServer', { n: selected?.serverLimit ?? 0 }))
  }
  if ((selected?.cd ?? 0) > 0) {
    limitLines.push(t('fish.cd', { n: selected?.cd ?? 0 }))
  }
  if ((selected?.serverCd ?? 0) > 0) {
    limitLines.push(t('fish.serverCd', { n: selected?.serverCd ?? 0 }))
  }
  const hasLimit = limitLines.length > 0
  // needDay / needNight 是配置（settings.json 预设）里的「白天 / 夜晚不让买」，两个都为 true
  // 时等于全天关闭，直接说一句，别并排显示「只能白天买」「只能夜晚买」自相矛盾。
  const timingLines: string[] = []
  if (selected?.needAlive) timingLines.push(t('fish.needAlive'))
  if (selected?.needDay && selected?.needNight) {
    timingLines.push(t('fish.needDayNight'))
  } else if (selected?.needDay) {
    timingLines.push(t('fish.needDay'))
  } else if (selected?.needNight) {
    timingLines.push(t('fish.needNight'))
  }

  const confirmBuy = useCallback(async () => {
    if (!selected || !argsReady) return
    setBuying(true)
    setError(null)
    setBuyResult(null)
    try {
      const res = await transport.fishBuy(selected.serial, buyAmount, needArgs ? args.trim() : '')
      // 购买成功不关闭弹框：在界面显示结果（name/cost 里的 [i:..] 会渲染成图标）。
      setBuyResult(res)
      setConfirming(false)
      // 买成功就记进「最近购买」（已全额退款的没拿到东西，不记）。
      if (res.refunded !== true) rememberPurchase(selected)
      // 冷却数秒：按钮禁用 + 提示闪烁，避免玩家连点重复购买。
      // 没发货（已自动全额退款）时不给冷却：什么都没拿到，让人干等 3 秒只会莫名其妙。
      setBuyCooldown(res.refunded === true ? 0 : 3)
    } catch (err) {
      if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
        onTokenInvalid()
      }
      setError(kindMessage(err))
      setConfirming(false)
    } finally {
      setBuying(false)
    }
  }, [
    selected,
    argsReady,
    transport,
    buyAmount,
    needArgs,
    args,
    onTokenInvalid,
    kindMessage,
    rememberPurchase,
  ])

  // 冷却倒计时（每秒 -1，到 0 为止）。
  useEffect(() => {
    if (buyCooldown <= 0) return
    const timer = setTimeout(() => setBuyCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearTimeout(timer)
  }, [buyCooldown])

  // 页签：全部 = 当前货架；买过 / 收藏 = 本机记录（已下架的用快照占位）。
  const tab = resolveTab(ui.tab)
  const keyword = ui.query.trim().toLowerCase()
  const shelfGoods = useMemo(() => shop?.goods ?? [], [shop])
  const boughtRows = useMemo(() => resolveStamps(boughtStamps, shelfGoods), [boughtStamps, shelfGoods])
  const favoriteRows = useMemo(
    () => resolveStamps(favoriteStamps, shelfGoods),
    [favoriteStamps, shelfGoods],
  )
  // 分组筛选（「收藏」右边那颗下拉）：单选，`null` = 不筛。规则见 lib/fishCategory.ts。
  const category = resolveFishCategory(ui.category)
  /** 当前来源（页签 + 关键词）：分组的条数与筛选都在这上面算，三者是「且」的关系。 */
  const sourceGoods = useMemo(() => {
    const list =
      tab === 'bought'
        ? boughtRows.map((row) => row.good)
        : tab === 'favorite'
          ? favoriteRows.map((row) => row.good)
          : shelfGoods
    if (!keyword) return list
    return list.filter(
      (g) =>
        g.name.toLowerCase().includes(keyword) ||
        String(g.serial).includes(keyword) ||
        g.desc.toLowerCase().includes(keyword) ||
        g.map.some((m) => m.toLowerCase().includes(keyword)),
    )
  }, [tab, boughtRows, favoriteRows, shelfGoods, keyword])
  /** 每件商品的分组只算一次：下拉里的条数与列表筛选共用。 */
  const categoriesOf = useMemo(
    () => new Map(sourceGoods.map((good) => [good, matchFishCategories(good)])),
    [sourceGoods],
  )
  const categoryCounts = useMemo(() => {
    const counts = new Map<FishCategoryId, number>()
    for (const categories of categoriesOf.values()) {
      for (const id of categories) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [categoriesOf])
  /** 整张货架上有哪些分组（与当前页签无关）：只用来决定「下拉里列哪些」，不参与筛选。 */
  const shelfCategories = useMemo(() => {
    const present = new Set<FishCategoryId>()
    for (const good of shelfGoods) {
      for (const id of matchFishCategories(good)) present.add(id)
    }
    return present
  }, [shelfGoods])
  // 空分组不列出来（不留死入口）。判断看**整张货架**：否则切到「买过 / 收藏」时
  // 只要手里的商品都没分组，下拉就凭空消失，还把页签行抽短一截。
  // 已选中的更得留着，否则列表还空着，却没人知道刚才选了什么。
  const visibleCategories = useMemo(
    () =>
      FISH_CATEGORIES.flatMap(({ id, iconId }) => {
        const count = categoryCounts.get(id) ?? 0
        return count > 0 || shelfCategories.has(id) || id === category
          ? [{ id, iconId, count }]
          : []
      }),
    [categoryCounts, shelfCategories, category],
  )
  const goods = useMemo(
    () =>
      category
        ? sourceGoods.filter((good) => categoriesOf.get(good)?.includes(category))
        : sourceGoods,
    [sourceGoods, categoriesOf, category],
  )

  /** 富文本渲染（价格 / 解锁 / 别名 / 限购 / 备注都可能含 [i:..] 物品图标）。 */
  const renderRichLines = (lines: string[]) => (
    <CommandOutput
      result={{ status: 'ok', output: lines }}
      itemsById={dataset?.itemsById}
      prefixesById={dataset?.prefixesById}
      atlas={dataset?.atlas}
    />
  )
  const renderRich = (text: string) => renderRichLines([text])

  // 整页滚动（与指令 / 物品 ID / 数据 ID 一致）：货架跟着页面走，工具条吸在顶栏下面。
  // 工具条是 `canUse &&` 条件渲染的（要等能力探测 / 登录态），所以实测高度必须跟 `canUse` 重跑一次。
  const rootRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const stickyTop = useStickyHeaderOffset(toolbarRef, [canUse])
  usePageScrollReset(rootRef)

  const hideMeta = ui.hideMeta === true
  const tableView = ui.tableView === true
  const iconSize = resolveIconSize(ui.iconSize)
  const sizeSpec = GOOD_SIZES[iconSize]
  // 小档只放图标、横条的意义就是带文字：这两种档位下「隐藏编号和名称」没意义，不显示开关。
  const metaToggleVisible = showsMetaToggle(iconSize)
  const showMeta = sizeSpec.showMeta && !hideMeta
  // 货架板：表格视图没有格子、小档格子又密、横条是横排（板压不住位置），这几种都不画，开关也不显示。
  const shelfToggleVisible = !tableView && iconSize !== 'sm' && iconSize !== 'row'
  const shelfLines = shelfToggleVisible && ui.shelf !== false
  // 遮阳伞是「摊位」的一部分（不是格子的装饰），网格 / 空态 / 加载中都顶着同一块篷；
  // 表格视图没有格子不画；横条是紧凑的一列条目，顶着篷会挤（同货架板，开关也不显示）。
  const awningToggleVisible = !tableView && iconSize !== 'row'
  const awning = awningToggleVisible && ui.awning !== false
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsFocus = useSettingsPopoverFocus()
  // 「货架全屏」：顶栏以外的区域全部让给货架（与「物品 ID」同一套做法，Esc 退出）。
  const [shelfFullscreen, setShelfFullscreen] = useState(false)

  useEffect(() => {
    if (!shelfFullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShelfFullscreen(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [shelfFullscreen])

  /** 恢复默认：清掉本弹框里的视图开关与图标大小（不动搜索词 / 页签 / 买过 / 收藏）。 */
  const resetViewSettings = () => {
    setUi({
      iconSize: undefined,
      hideMeta: undefined,
      tableView: undefined,
      shelf: undefined,
      awning: undefined,
    })
  }

  /** 页面设置（与物品 ID 同规）：图标大小 / 隐藏编号和名称 / 表格视图。 */
  const fishSettingsControl = (
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
      <PopoverTrigger asChild>
        <IconAction label={t('fish.settings')} icon={Settings2} active={settingsOpen} />
      </PopoverTrigger>
      <PopoverContent
        ref={settingsFocus.ref}
        onOpenAutoFocus={settingsFocus.onOpenAutoFocus}
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)] p-0"
        data-testid="fish-settings-popover"
      >
        <SettingsPopoverHeader
          title={t('fish.settings')}
          onReset={resetViewSettings}
          resetTestId="fish-settings-reset"
        />
        <FieldGroup className="gap-0.5 p-2">
          <div className="px-2 py-1 text-2xs font-medium text-muted-foreground">
            {t('dex.viewSection')}
          </div>
          <div className="flex flex-col gap-1 px-2 py-1.5">
            <FieldLabel htmlFor="fish-icon-size" className="font-medium text-foreground">
              {t('iconSize')}
            </FieldLabel>
            <Select
              value={iconSize}
              onValueChange={(value) => setUi({ iconSize: value as GoodIconSize })}
            >
              <SelectTrigger id="fish-icon-size" size="sm" className="w-full" aria-label={t('iconSize')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lg" data-testid="fish-icon-size-lg">
                  {t('iconSize.lg')}
                </SelectItem>
                <SelectItem value="md" data-testid="fish-icon-size-md">
                  {t('iconSize.md')}
                </SelectItem>
                <SelectItem value="sm" data-testid="fish-icon-size-sm">
                  {t('iconSize.sm')}
                </SelectItem>
                <SelectItem value="row" data-testid="fish-icon-size-row">
                  {t('iconSize.row')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {metaToggleVisible && (
            <Field orientation="horizontal" className="items-start rounded-control px-2 py-2 hover:bg-accent/50">
              <Checkbox
                id="fish-hide-meta"
                checked={hideMeta}
                onCheckedChange={(value) => setUi({ hideMeta: value === true })}
                className="mt-0.5"
              />
              <FieldLabel htmlFor="fish-hide-meta" className="cursor-pointer font-medium text-foreground">
                {t('fish.hideMeta')}
              </FieldLabel>
            </Field>
          )}
          <Field orientation="horizontal" className="items-start rounded-control px-2 py-2 hover:bg-accent/50">
            <Checkbox
              id="fish-table-view"
              checked={tableView}
              onCheckedChange={(value) => setUi({ tableView: value === true })}
              className="mt-0.5"
            />
            <FieldLabel htmlFor="fish-table-view" className="cursor-pointer font-medium text-foreground">
              {t('fish.tableView')}
            </FieldLabel>
          </Field>
          {shelfToggleVisible && (
            <Field orientation="horizontal" className="items-start rounded-control px-2 py-2 hover:bg-accent/50">
              <Checkbox
                id="fish-shelf-lines"
                checked={ui.shelf !== false}
                onCheckedChange={(value) => setUi({ shelf: value === true })}
                className="mt-0.5"
              />
              <FieldLabel htmlFor="fish-shelf-lines" className="cursor-pointer font-medium text-foreground">
                {t('fish.shelfLines')}
              </FieldLabel>
            </Field>
          )}
          {awningToggleVisible && (
            <Field orientation="horizontal" className="items-start rounded-control px-2 py-2 hover:bg-accent/50">
              <Checkbox
                id="fish-awning"
                checked={ui.awning !== false}
                onCheckedChange={(value) => setUi({ awning: value === true })}
                className="mt-0.5"
              />
              <FieldLabel htmlFor="fish-awning" className="cursor-pointer font-medium text-foreground">
                {t('fish.awning')}
              </FieldLabel>
            </Field>
          )}
        </FieldGroup>
      </PopoverContent>
    </Popover>
  )

  const fullscreenToggle = (
    <IconAction
      label={shelfFullscreen ? t('dex.exitFullscreen') : t('fish.enterFullscreen')}
      icon={shelfFullscreen ? Minimize2 : Maximize2}
      pressed={shelfFullscreen}
      onClick={() => setShelfFullscreen((value) => !value)}
    />
  )

  /** 「重新检测」：刚装好 / 刚重启插件时 REST 端点会晚几秒才注册，点了不用切页面。 */
  const recheck = (
    <Button
      size="sm"
      variant="outline"
      className="h-7 bg-card"
      disabled={checking}
      onClick={() => void probe()}
    >
      {checking ? <Spinner aria-hidden data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
      {t('fish.recheck')}
    </Button>
  )

  const pageActions = (
    <PageHelp className="col-span-full" forceOpen={!cardsVisible}>
      <PluginHelp plugin={t('plugin.store.name')} en="FishShop" href={PLUGIN_LINKS.fishShop}>
        {t('page.store.desc')}
      </PluginHelp>
    </PageHelp>
  )

  if (!authenticated) {
    return (
      <div className="flex flex-col gap-2">
        <LoginGate onLogin={onLogin} />
      </div>
    )
  }

  return (
    <>
      <div className="relative">
      {/* 背景点缀：水波光晕 + 几条淡鱼（商店氛围） */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-16 -right-16 size-64 rounded-full bg-info/10 blur-3xl" />
        <div className="absolute -bottom-20 -left-16 size-72 rounded-full bg-primary/10 blur-3xl" />
        <Fish className="absolute top-4 left-1/3 size-24 -rotate-12 text-info/10" />
        <Fish className="absolute right-1/4 bottom-8 size-16 rotate-12 text-primary/10" />
        <Droplets className="absolute top-1/2 left-4 size-14 text-info/10" />
        <Droplets className="absolute top-8 right-10 size-10 text-info/10" />
      </div>
      <div
        ref={rootRef}
        // 整页滚动（与指令 / 物品 ID / 数据 ID 一致）：左货架 / 右指令卡片都跟着页面走，
        // 滚动条是浏览器右侧那条；搜索工具条吸在顶栏下面（`sticky top-12`）。
        className={cn(
          'grid gap-2',
          // 右列没内容（卡片与记事本都隐藏）时收成一栏，左边货架铺满。
          cardsVisible && !shelfFullscreen && 'xl:grid-cols-[minmax(0,1fr)_360px]',
        )}
        style={
          { '--page-sticky-top': `${shelfFullscreen ? 0 : stickyTop}px` } as CSSProperties
        }
      >
        {pageActions}

        {/* 左：货架。REST API 不可用时只影响左侧，右侧指令卡片仍可用。 */}
        <div
          data-testid="fish-shelf-panel"
          className={cn(
            'flex min-w-0 flex-col gap-2 xl:min-h-0',
            // 全屏：连内容区顶栏一起盖住（与「物品 ID」「数据 ID」同一套做法），
            // 右上角只留「退出全屏」（`FullscreenDock persistent`）。
            // 全屏不留内边距：工具条是第一个子元素、`sticky top-0`，容器留 padding 会让上沿露出一条滚过去的商品。
            shelfFullscreen && 'fixed inset-0 z-50 overflow-y-auto bg-background',
          )}
        >
        {/* 全屏是 z-50 的层叠上下文：商品详情的遮罩得画在里面，否则（z-45）会被压在下面。 */}
        {shelfFullscreen && desktop && selected !== null && (
          <ContentScrim full testId="fish-detail-scrim" onClick={closeDetail} />
        )}
        {/* 全屏盖住了顶栏：右上角只留「退出全屏」，常驻不收起（与「物品 ID」「数据 ID」一致）——
            页面设置在全屏里不给入口，要看设置先退出全屏。 */}
        {shelfFullscreen && (
          <FullscreenDock persistent label={t('dex.showActions')}>
            <IconAction
              size="icon-xs"
              label={t('dex.exitFullscreen')}
              icon={Minimize2}
              onClick={() => setShelfFullscreen(false)}
            />
          </FullscreenDock>
        )}

      {checking && (
        <Card>
          <CardBody className="flex items-center gap-2 pt-2 text-sm text-muted-foreground">
            <Spinner />
            {t('fish.checking')}
          </CardBody>
        </Card>
      )}

      {!checking && capability === null && probeError && (
        <Notice icon={<AlertTriangle />} title={t('fish.probeFailed')} action={recheck}>
          {probeError}
        </Notice>
      )}

      {!checking && capability !== null && plugin && !restReady && (
        <Notice icon={<AlertTriangle />} title={t('fish.outdated')} action={recheck}>
          {t('fish.outdatedHint')}
        </Notice>
      )}

      {!checking && capability !== null && !plugin && (
        <Notice icon={<AlertTriangle />} title={t('fish.pluginMissing')} action={recheck}>
          {t('fish.pluginMissingHint')}
        </Notice>
      )}

      {!checking && plugin && restReady && !capability?.permission && (
        <Notice icon={<ShieldAlert />} title={t('fish.noPermission')} action={recheck}>
          {t('fish.noPermissionHint')}
        </Notice>
      )}

      {canUse && (
        <>
          {/* 吸顶工具条：左侧「全部 / 买过 / 收藏」页签 + 行尾搜索框（结果数在框内）。
              货架（页面）往上滚时它留在顶栏下面，不用滚回顶部找搜索框。
              页面设置与刷新一样在顶栏右侧（`TopBarActions`）。 */}
          <div
            ref={toolbarRef}
            data-testid="fish-toolbar"
            className={cn(
              'sticky z-20 flex flex-col gap-2 bg-background p-1 sm:flex-row sm:flex-wrap sm:items-center',
              shelfFullscreen ? 'top-0 px-3 pt-3 pr-10 sm:px-4 sm:pt-4' : 'top-12',
            )}
          >
            {/* 左：页签（全部 / 买过 / 收藏）+ 分组。
                分组照抄「物品 ID」那一颗：竖线 + 幽灵按钮（`ListFilter` 图标 + 文字）。
                取消分组走菜单第一项「全部」（不另占一颗 × 按钮）。
                页签与分组二选一：选中分组时不再有任何页签处于选中态，点「全部」就回到整张货架。 */}
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground sm:w-auto">
              <div className="flex min-w-0 flex-wrap items-center rounded-container bg-accent p-0.5">
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  value={category ? '' : tab}
                  onValueChange={(value) => {
                    // 再点一下当前页签会传空串：保持原样。
                    if (!value) return
                    // 换页签一律清掉分组：买过 / 收藏 不分分组，「全部」就是整张货架。
                    setUi({ tab: value as FishTab, category: undefined })
                  }}
                  aria-label={t('fish.tabs')}
                  className="flex-wrap"
                >
                  <ToggleGroupItem value="all" data-testid="fish-tab-all">
                    {t('fish.tab.all')}
                    <span className="tabular-nums opacity-70">{shelfGoods.length}</span>
                  </ToggleGroupItem>
                  <ToggleGroupItem value="bought" data-testid="fish-tab-bought">
                    <Footprints data-icon="inline-start" />
                    {t('fish.tab.bought')}
                    <span className="tabular-nums opacity-70">{boughtStamps.length}</span>
                  </ToggleGroupItem>
                  <ToggleGroupItem value="favorite" data-testid="fish-tab-favorite">
                    <Star
                      className={cn(tab === 'favorite' && 'fill-current')}
                      data-icon="inline-start"
                    />
                    {t('fish.tab.favorite')}
                    <span className="tabular-nums opacity-70">{favoriteStamps.length}</span>
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              {/* 分组只在「全部」下出现：买过 / 收藏 是本机记录，不做分组。 */}
              {tab === 'all' && visibleCategories.length > 0 && (
                <>
                  <span
                    aria-hidden
                    data-testid="fish-category-separator"
                    className="mx-1 h-4 w-px shrink-0 bg-border"
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid="fish-category"
                        className={cn(
                          'max-w-56 shrink-0 gap-1.5 px-2 text-xs font-normal text-muted-foreground',
                          category && 'font-medium text-foreground',
                        )}
                      >
                        <ListFilter className="size-3.5 shrink-0" />
                        <span className="min-w-0 truncate">
                          {category
                            ? t('fish.groupCurrent', { name: t(`fish.cat.${category}`) })
                            : t('fish.category')}
                        </span>
                        <ChevronDown className="size-3.5 shrink-0" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-48">
                      {/* 「全部」= 不筛分组（与页签的「全部」同一个意思）。 */}
                      <DropdownMenuItem
                        data-testid="fish-cat-all"
                        onSelect={() => setUi({ category: undefined })}
                        className="gap-2"
                      >
                        <ListFilter className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate" data-testid="fish-cat-name-all">
                          {t('fish.tab.all')}
                        </span>
                        <span
                          className="tabular-nums text-muted-foreground"
                          data-testid="fish-cat-count-all"
                        >
                          {sourceGoods.length}
                        </span>
                        {!category && <Check className="ml-auto size-3.5 shrink-0" />}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {visibleCategories.map(({ id, iconId, count }) => (
                        <DropdownMenuItem
                          key={id}
                          data-testid={`fish-cat-${id}`}
                          onSelect={() => setUi({ category: category === id ? undefined : id })}
                          className="gap-2"
                        >
                          <ItemIcon
                            item={dataset?.itemsById.get(iconId)}
                            atlas={dataset?.atlas}
                            size={16}
                            tooltip={false}
                            className="shrink-0"
                          />
                          <span className="truncate" data-testid={`fish-cat-name-${id}`}>
                            {t(`fish.cat.${id}`)}
                          </span>
                          <span
                            className="tabular-nums text-muted-foreground"
                            data-testid={`fish-cat-count-${id}`}
                          >
                            {count}
                          </span>
                          {category === id && <Check className="ml-auto size-3.5 shrink-0" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>

            {/* 货架是配置快照：只在手动刷新 / 重载配置后重拉。
                「更新于 …」超过 24 小时变 warning 色 —— 服主可能改了价格但还没人重拉。 */}
            <div className="flex items-center gap-1">
              <IconAction
                size="icon-xs"
                label={t('fish.shelfRefresh')}
                icon={RefreshCw}
                loading={loading}
                testId="fish-shelf-refresh"
                onClick={() => void loadShop()}
              />
              {shelfAt != null && (
                <span
                  data-testid="fish-shelf-updated"
                  className={cn(
                    'text-2xs tabular-nums',
                    shelfStale ? 'text-warning' : 'text-muted-foreground',
                  )}
                  title={shelfStale ? t('fish.shelfStaleHint') : formatClockWithDate(lang, shelfAt)}
                >
                  {t('fish.shelfUpdated', {
                    time: shelfStale
                      ? formatShortDateTime(lang, shelfAt)
                      : formatShortClock(lang, shelfAt),
                  })}
                </span>
              )}
            </div>

            {/* 右：搜索框（与物品 ID / 数据 ID 一致，行尾 16rem；窄屏独占一行）。
                全屏也不改宽度：拉得越长越难扫，固定 16rem 在哪种视图下都一致。 */}
            <div data-testid="fish-search-wrap" className="w-full min-w-0 sm:ml-auto sm:w-64">
              <SearchInput
                value={ui.query}
                onValueChange={(query) => setUi({ query })}
                placeholder={t('fish.search')}
                aria-label={t('fish.search')}
                leadingIcon={<Search className="size-4 text-muted-foreground" />}
                // 货架条数在输入框右侧：失焦且没内容时让位给 `/` 快捷键提示。
                resultLabel={t('fish.total', { n: goods.length })}
                shortcut
                // 字号与物品 ID 的搜索框一致（比正文小一档）
                inputClassName="text-xs"
              />
            </div>
            {error && !selected && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          {/* 货架区留一圈内边距（`p-2`）：最后一行的板线 / 板下投影不会被容器下沿切掉。
              全屏时容器没有内边距了，这里补回来（与工具条左右对齐）。 */}
          <div
            className={cn('p-2', shelfFullscreen && 'px-3 pb-3 sm:px-4 sm:pb-4')}
          >
            {awning && <ShopAwning />}
            {loading && !shop ? (
              <div
                className={GOOD_GRID_CLASS[iconSize]}
                role="status"
                aria-busy="true"
                aria-label={t('fish.loading')}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="grid place-items-center gap-1">
                    <Skeleton
                      className="rounded-control"
                      style={{ width: sizeSpec.surface, height: sizeSpec.surface }}
                    />
                    {showMeta && <Skeleton className="h-2.5 w-8" />}
                    {showMeta && <Skeleton className="h-3 w-12" />}
                  </div>
                ))}
              </div>
            ) : goods.length === 0 ? (
              // 拉货架失败（如「商店打烊」）时错误已在工具条提示，这里不再说「没有匹配的商品」（会让人以为搜错了）。
              error ? null : (
                <Empty className="min-h-40 border border-dashed">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Fish />
                    </EmptyMedia>
                    <EmptyTitle>
                      {category
                        ? t('fish.emptyCategory')
                        : keyword
                          ? t('fish.empty')
                          : tab === 'bought'
                            ? t('fish.emptyBought')
                            : tab === 'favorite'
                              ? t('fish.emptyFavorite')
                              : t('fish.empty')}
                    </EmptyTitle>
                    {tab === 'all' && !keyword && !category && (
                      <EmptyDescription>{t('fish.clickHint')}</EmptyDescription>
                    )}
                  </EmptyHeader>
                </Empty>
              )
            ) : tableView ? (
              <GoodsTable rows={goods} dataset={dataset} onSelect={openDetail} />
            ) : (
              <GoodGrid
                goods={goods}
                dataset={dataset}
                size={iconSize}
                hideMeta={hideMeta}
                onSelect={openDetail}
                shelf={shelfLines}
              />
            )}
          </div>
        </>
      )}
        </div>

        {/* 右列：指令卡片（只依赖 rawcmd，不依赖鱼店 REST API）。
            整页滚动只滚**左侧货架**：右列 `xl:sticky` 钉在顶栏下面，内容比一屏高时自己内部滚，
            这样往下翻商品时右侧的「钓鱼信息」不会跟着一起滚走。
            卡片与记事本全隐藏时不渲染这一栏（只剩隐藏的容器，管理卡片从顶栏图标进）。 */}
        <div
          data-testid="fish-side"
          className={cn(
            'min-w-0',
            shelfFullscreen && 'hidden',
            cardsVisible &&
              !shelfFullscreen &&
              'xl:sticky xl:top-12 xl:flex xl:h-[calc(100dvh-4rem)] xl:flex-col xl:self-start',
            !cardsVisible && 'hidden',
          )}
        >
          <FishCommandCards
            onContentChange={setCardsVisible}
            dataset={dataset}
            transport={transport}
            authenticated={authenticated}
            serverId={serverId}
            refreshInterval={refreshInterval}
            ingame={ingame}
            players={players}
            runtimeValues={runtimeValues}
            onTokenInvalid={onTokenInvalid}
            // 执行 `/fish reload` 之后货架已经变了：重新拉一次，别让页面停在旧价格上。
            onConfigReloaded={() => void loadShop()}
          />
          {/* 顶栏挂载顺序 = 显示顺序：卡片那组（上次刷新 / 刷新全部 / 管理卡片）之后，
              所以「页面设置 / 全屏」排在它们右边。 */}
          {/* 全屏时这两个入口都不挂：顶栏已被盖住，右上角只留「退出全屏」。 */}
          {!shelfFullscreen && (
            <TopBarActions>
              {fishSettingsControl}
              {fullscreenToggle}
            </TopBarActions>
          )}
        </div>
      </div>
      </div>

      <FishDetailSurface
        desktop={desktop}
        showScrim={!shelfFullscreen}
        open={selected !== null}
        onClose={closeDetail}
        onOpenAutoFocus={focusDetailOnOpen}
      >
        {selected && (
          <>
            <SheetHeader className="shrink-0 border-b px-5 py-3 pr-12">
              <DialogTitle>{t('fish.detail')}</DialogTitle>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              <div className="flex flex-col items-center gap-2">
                <GoodThumb good={selected} dataset={dataset} size={CELL_ICON_SIZE} tooltip={false} />
                <p className="text-center text-base font-semibold text-foreground">
                  {/* 已下架的商品不再显示编号：编号是插件配置里的下标，早就不指向它了。 */}
                  {offShelf ? null : <>#{selected.serial} </>}
                  {goodPrefixName(selected, dataset) ? (
                    <span className="text-warning">{goodPrefixName(selected, dataset)} </span>
                  ) : null}
                  {selected.name}
                </p>
              </div>
              {/* 属性（价格 / 解锁 / 别名 / 限购 / 备注）：文字统一在值框上面一行的左上角 */}
              <dl className="flex flex-col gap-2">
                <DetailField label={t('fish.cost')}>
                  {selected.cost.trim() ? renderRich(selected.cost) : renderRich(t('fish.free'))}
                </DetailField>
                {selected.unlock.trim() && (
                  <DetailField label={t('fish.unlock')}>{renderRich(selected.unlock)}</DetailField>
                )}
                {selected.map.length > 0 && (
                  <DetailField label={t('fish.alias')}>{renderRich(selected.map.join(', '))}</DetailField>
                )}
                {hasLimit && <DetailField label={t('fish.limit')}>{renderRichLines(limitLines)}</DetailField>}
                {timingLines.length > 0 && (
                  <DetailField label={t('fish.timing')}>{renderRichLines(timingLines)}</DetailField>
                )}
                {selected.check?.trim() && (
                  <DetailField label={t('fish.check')}>{renderRich(selected.check)}</DetailField>
                )}
                {selected.comment.trim() && (
                  <DetailField label={t('fish.comment')}>{renderRich(selected.comment)}</DetailField>
                )}
              </dl>

              {/* 已下架 / 降级条目：这两个是商品本身的状态，不是「现在买不了」 */}
              {offShelf && !confirming && (
                <Alert>
                  <AlertDescription>{t('fish.offShelf')}</AlertDescription>
                </Alert>
              )}
              {degraded && !confirming && (
                <Alert>
                  <AlertDescription>{t('fish.degraded')}</AlertDescription>
                </Alert>
              )}

              {/* 确认 / 参数（操作按钮在底部操作区） */}
              {confirming && (
                <div className="flex flex-col gap-2 rounded-control bg-accent/50 p-3">
                  <p className="text-xs text-foreground">
                    {needArgs
                      ? t('fish.buyConfirmArgs', { args: args.trim() })
                      : t('fish.buyConfirm', { n: buyAmount })}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('fish.buyHint')}</p>
                </div>
              )}

              {!confirming && needArgs && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">
                    {argCount > 1 ? t('fish.argsMulti', { n: argCount }) : t('fish.args')}
                  </span>
                  <Input
                    ref={argsRef}
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    placeholder={t('fish.argsPlaceholder')}
                    aria-label={t('fish.args')}
                    className="min-w-0"
                  />
                </div>
              )}

              {!confirming && adjustable && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t('fish.amount')}</span>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={maxBuy}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      aria-label={t('fish.amount')}
                      className="w-24"
                    />
                    <span className="text-xs text-muted-foreground">
                      {t('fish.buyMaxNote', { n: maxBuy })}
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {buyResult && buyResult.refunded === true && (
                <Alert
                  className={cn('flex flex-col gap-1', buyCooldown > 0 && 'tswui-flash')}
                >
                  <AlertDescription>{renderRich(t('fish.buyRefunded', { name: buyResult.name || selected.name }))}</AlertDescription>
                </Alert>
              )}

              {buyResult && buyResult.refunded !== true && (
                <Alert
                  variant="success"
                  className={cn('flex flex-col gap-1', buyCooldown > 0 && 'tswui-flash')}
                >
                  <AlertDescription>
                    {renderRich(
                      t('fish.buyOk', {
                        name: buyResult.name || selected.name,
                        n: buyResult.amount,
                        cost: buyResult.cost,
                      }),
                    )}
                  </AlertDescription>
                  {buyResult.requested != null && buyResult.requested > buyResult.amount && (
                    <AlertDescription className="text-xs text-warning">
                      {t('fish.buyClamped', { n: buyResult.amount, req: buyResult.requested })}
                    </AlertDescription>
                  )}
                  <AlertDescription className="font-medium text-foreground">
                    {t('fish.successHint')}
                  </AlertDescription>
                </Alert>
              )}

              {/* 建筑预览固定在最下面（在「已售完 / 已购买」这些状态提示之后）：
                  它是「怎么做」的参考图，不是要先看的价格信息。居左 / 可折叠 / 点图放大。 */}
              {diagram && <GoodDiagram src={diagram} name={selected.name} />}
            </div>

            {/* 底部操作区：⭐ 收藏在最左，右侧是关闭 / 购买 */}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
              <div className="mr-auto flex items-center gap-1">
                <IconAction
                  label={favorited ? t('fish.unfavorite') : t('fish.favorite')}
                  icon={Star}
                  pressed={favorited}
                  testId="fish-favorite"
                  iconClassName={cn(favorited && 'fill-current text-warning')}
                  onClick={() => toggleFavorite(selected, selectedSnapshot)}
                />
                <IconAction
                  label={t('fish.advertise')}
                  icon={MessageSquare}
                  testId="fish-advertise"
                  disabled={advertising}
                  onClick={() => void advertise(selected)}
                />
              </div>
              {confirming ? (
                <>
                  <Button
                    variant="outline"
                    className="h-8 bg-card"
                    disabled={buying}
                    onClick={() => setConfirming(false)}
                  >
                    {t('action.cancel')}
                  </Button>
                  <Button variant="primary" className="h-8" disabled={buying} onClick={() => void confirmBuy()}>
                    {buying ? (
                      <Spinner aria-hidden data-icon="inline-start" />
                    ) : (
                      <ShoppingCart data-icon="inline-start" />
                    )}
                    {t('fish.confirmBuy')}
                  </Button>
                </>
              ) : (
                <>
                  {/* 快捷关闭（弹框右上角也有 X）：轻量文字按钮，不抢「购买」的位置 */}
                  <Button variant="outline" className="h-8 bg-card" onClick={closeDetail}>
                    {t('action.close')}
                  </Button>
                  <Button
                    ref={buyRef}
                    variant="primary"
                    className="h-8"
                    disabled={!argsReady || buyCooldown > 0 || degraded || unresolved}
                    onClick={() => setConfirming(true)}
                  >
                    <ShoppingCart data-icon="inline-start" />
                    {buyCooldown > 0 ? t('fish.cooldown', { n: buyCooldown }) : t('fish.buy')}
                  </Button>
                </>
              )}
            </div>

            {/* 空态 / 装饰：右下角半透明渔夫指南图标（鱼店氛围） */}
            <div
              aria-hidden
              className="pointer-events-none absolute right-6 bottom-16 opacity-[0.15]"
            >
              <ItemIcon
                item={dataset?.itemsById.get(3120)}
                atlas={dataset?.atlas}
                size={170}
                mode="fit"
                tooltip={false}
              />
            </div>
          </>
        )}
      </FishDetailSurface>
    </>
  )
}

/** 属性块：标签在值框**上面一行的左上角**（价格 / 解锁 / 别名 / 限购 / 备注统一）。 */
function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}
