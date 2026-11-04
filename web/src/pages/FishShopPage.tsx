import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  AlertTriangle,
  Droplets,
  Fish,
  Footprints,
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
import { PageHelp } from '@/components/PageHelp'
import { PluginHelp } from '@/components/PluginHelp'
import { TopBarActions } from '@/components/TopBar'
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
import { GoodGrid } from '@/components/fishshop/GoodGrid'
import { GoodsTable } from '@/components/fishshop/GoodsTable'
import { useChatSend } from '@/hooks/useChatSend'
import { usePageScrollReset, useStickyHeaderOffset } from '@/hooks/usePageScroll'
import { cn } from '@/lib/cn'
import { splitFishArgs } from '@/lib/fishArgs'
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui'
import { useModuleState } from '@/hooks/useModuleState'
import { useDataset } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'

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
 * 插件版本过旧（v1.6.2 之前只有游戏内指令）或没权限时，左侧只显示提示；
 * 右侧指令卡片只走 rawcmd，不依赖 REST，因此照常可用。
 */
interface FishShopPageProps {
  /** 当前上游 id：界面状态与货架按服务器分开。 */
  serverId: string
  transport: BackendTransport
  authenticated: boolean
  /** 页面数据自动刷新间隔（毫秒，0 = 不自动刷新）。 */
  refreshInterval: number
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
  /** 工具条页签：全部 / 买过 / 收藏。 */
  tab?: FishTab
  /** 买过的商品（**按内容指纹去重、最新在前**，不存 serial）。 */
  buys?: FishGoodStamp[]
  /** 收藏的商品（同上）。 */
  favorites?: FishGoodStamp[]
  /** @deprecated 旧版本的「最近购买」（没有指纹），首次读到会迁移进 `buys`。 */
  recentBuys?: FishGood[]
}

/** 货架页签（全部 / 买过 / 收藏）。 */
const FISH_TABS = ['all', 'bought', 'favorite'] as const
type FishTab = (typeof FISH_TABS)[number]

const DEFAULT_STATE: FishUiState = { query: '' }

/** 本机存的「图标大小」可能是旧版本写坏的值：认不出来就回到默认的「大」。 */
function resolveIconSize(value: unknown): GoodIconSize {
  return value === 'sm' || value === 'md' || value === 'lg' ? value : DEFAULT_GOOD_ICON_SIZE
}

/** 「买过 / 收藏」各存多少条（本机 localStorage；一个服通常也就几十到几百件商品）。 */
const SAVED_MAX = 80

/** 本机存的页签可能被改坏：认不出来就回到「全部」。 */
function resolveTab(value: unknown): FishTab {
  return value === 'bought' || value === 'favorite' ? value : 'all'
}

/** 网格图标尺寸：与「物品图鉴」一致（64px）。 */
export function FishShopPage({ serverId, transport, authenticated, refreshInterval, onTokenInvalid, onLogin }: FishShopPageProps) {
  const { t } = useI18n()
  const dataset = useDataset()
  const [ui, setUi] = useModuleState<FishUiState>(serverId, 'store', DEFAULT_STATE)
  const [capability, setCapability] = useState<FishCapabilities | null>(null)
  const [checking, setChecking] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [shop, setShop] = useState<FishShop | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 详情弹框：`selectedSnapshot` 只是「点了哪一条」，真正展示/购买用的是派生出来的
  // `selected`（同一 serial 的最新货架数据）——这样刷新货架后「我的进度」「能不能买」
  // 会自动跟着变，而货架暂时为空（加载失败）时仍能显示上一次的快照。
  const [selectedSnapshot, setSelected] = useState<FishGood | null>(null)
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

  // serverId 也进依赖：切换服务器要重新探（插件 / 权限可能不同）。
  useEffect(() => {
    void probe()
  }, [serverId, probe])

  const plugin = capability?.plugin === true
  const restReady = capability?.rest === true
  const canUse = plugin && restReady && capability?.permission === true

  const loadShop = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 先要「个人状态」（self=1）：能知道「还能买几次 / 冷却还剩几秒 / 为什么不能买」。
      // 它要求玩家在游戏里在线，不在线时上游 400 → 静默退回普通货架，不打扰玩家。
      let data: FishShop
      try {
        data = await transport.fishList({ self: true })
      } catch (err) {
        if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) throw err
        data = await transport.fishList()
      }
      setShop(data)
    } catch (err) {
      if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
        onTokenInvalid()
      }
      setShop(null)
      setError(kindMessage(err))
    } finally {
      setLoading(false)
    }
  }, [transport, onTokenInvalid, kindMessage])

  // 进入页面（含从其它页面切回来）总是拉一次货架：货架是组件内状态，离开页面即丢弃，
  // 若也走「刷新间隔」闸门就会出现「2 分钟内回到鱼店一片空白」。
  useEffect(() => {
    if (!canUse) return
    void loadShop()
  }, [canUse, loadShop, serverId])

  // 停留在页面时按「页面数据刷新间隔」自动刷新货架（0 = 不自动刷新）。
  useEffect(() => {
    if (!canUse || refreshInterval <= 0) return
    const timer = setInterval(() => void loadShop(), refreshInterval)
    return () => clearInterval(timer)
  }, [canUse, refreshInterval, loadShop, serverId])

  const openDetail = useCallback((good: FishGood) => {
    setSelected(good)
    setAmount('1')
    setArgs('')
    setConfirming(false)
    setBuyResult(null)
    setError(null)
  }, [])

  const closeDetail = useCallback(() => {
    setSelected(null)
    setConfirming(false)
    setBuyResult(null)
    setError(null)
  }, [])

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

  // 个人状态（只有货架带 `canBuy` 时才有；没带 = 不知道，不能当成「不能买」）。
  const hasSelfState = selected?.canBuy !== undefined
  // 上游已明确说不能买（限购已满 / 售完 / 冷却中 / 死了 / 昼夜不对…）→ 别让玩家白点一次。
  const blocked = selected?.canBuy === false
  // 降级条目：商品自身配置有误时插件只回基础字段（其余为空），点进去也买不了。
  const degraded = isDegradedGood(selected)
  // 从「买过 / 收藏」打开、但货架上已经没有这件：只能看快照，不能买。
  const offShelf = selectedSnapshot !== null && selectedLive === null
  // ⭐ 是否已收藏：货架数据与打开时的快照两个指纹都算（商品被改名后两者不同）。
  const favorited = useMemo(() => {
    if (!selected) return false
    const keys = new Set([fishGoodKey(selected)])
    if (selectedSnapshot) keys.add(fishGoodKey(selectedSnapshot))
    return favoriteStamps.some((stamp) => keys.has(stamp.key))
  }, [selected, selectedSnapshot, favoriteStamps])
  // 建造类商品（鱼池 / 小房间 / 钓棚）多一张注解图：站哪个位置、上下几格、左右误差多少。
  const diagram = diagramUrl(selected)
  const personalNotes: string[] = []
  if (hasSelfState) {
    if ((selected?.myRemain ?? -1) >= 0) {
      personalNotes.push(t('fish.myRemain', { n: selected?.myRemain ?? 0 }))
    }
    if ((selected?.serverRemain ?? -1) >= 0) {
      personalNotes.push(t('fish.serverRemain', { n: selected?.serverRemain ?? 0 }))
    }
    if ((selected?.myCdRemain ?? 0) > 0) {
      personalNotes.push(t('fish.myCd', { n: selected?.myCdRemain ?? 0 }))
    } else if ((selected?.serverCdRemain ?? 0) > 0) {
      personalNotes.push(t('fish.serverCdRemain', { n: selected?.serverCdRemain ?? 0 }))
    }
  }
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
      void loadShop()
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
    loadShop,
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
  const goods = useMemo(() => {
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
  // 小尺寸本来就只有图标：中 / 大的「隐藏编号和名称」在它上面没有意义，不显示这个开关。
  const metaToggleVisible = sizeSpec.showMeta
  const showMeta = sizeSpec.showMeta && !hideMeta
  // 货架板：表格视图没有格子、小尺寸格子又密，这两种情况本来就不画，所以开关也不显示。
  const shelfToggleVisible = !tableView && iconSize !== 'sm'
  const shelfLines = shelfToggleVisible && ui.shelf !== false
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  /** 页面设置（与物品 ID 同规）：图标大小 / 隐藏编号和名称 / 表格视图。 */
  const fishSettingsControl = (
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
      <PopoverTrigger asChild>
        <IconAction label={t('fish.settings')} icon={Settings2} active={settingsOpen} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0" data-testid="fish-settings-popover">
        <div className="border-b px-4 py-3 text-sm font-semibold text-foreground">
          {t('fish.settings')}
        </div>
        <FieldGroup className="gap-0.5 p-2">
          <div className="px-2 py-1 text-2xs font-medium text-muted-foreground">
            {t('dex.viewSection')}
          </div>
          <div className="flex flex-col gap-1 px-2 py-1.5">
            <FieldLabel htmlFor="fish-icon-size" className="font-medium text-foreground">
              {t('fish.iconSize')}
            </FieldLabel>
            <Select
              value={iconSize}
              onValueChange={(value) => setUi({ iconSize: value as GoodIconSize })}
            >
              <SelectTrigger id="fish-icon-size" size="sm" className="w-full" aria-label={t('fish.iconSize')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lg" data-testid="fish-icon-size-lg">
                  {t('fish.iconSize.lg')}
                </SelectItem>
                <SelectItem value="md" data-testid="fish-icon-size-md">
                  {t('fish.iconSize.md')}
                </SelectItem>
                <SelectItem value="sm" data-testid="fish-icon-size-sm">
                  {t('fish.iconSize.sm')}
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
    <PageHelp scopeId="store" className="col-span-full" forceOpen={!cardsVisible}>
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
          className={cn(
            'flex min-w-0 flex-col gap-2 xl:min-h-0',
            // 顶栏留着（退出全屏的按钮在顶栏），其余铺满。
            shelfFullscreen && 'fixed inset-x-0 top-12 bottom-0 z-40 overflow-y-auto bg-background p-3 sm:p-4',
          )}
        >
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
          {/* 吸顶工具条：搜索（结果数在框内）+ 右侧「全部 / 买过 / 收藏」页签。
              货架（页面）往上滚时它留在顶栏下面，不用滚回顶部找搜索框。
              页面设置与刷新一样在顶栏右侧（`TopBarActions`）。 */}
          <div
            ref={toolbarRef}
            className={cn(
              'sticky z-20 flex flex-col gap-2 bg-background p-1 sm:flex-row sm:flex-wrap sm:items-center',
              shelfFullscreen ? 'top-0' : 'top-12',
            )}
          >
            <div className="flex w-full min-w-0 items-center gap-2 sm:flex-1">
              <div className="w-full max-w-sm">
                <SearchInput
                  value={ui.query}
                  onValueChange={(query) => setUi({ query })}
                  placeholder={t('fish.search')}
                  aria-label={t('fish.search')}
                  leadingIcon={<Search className="size-4 text-muted-foreground" />}
                  // 货架条数在输入框右侧：失焦且没内容时让位给 `/` 快捷键提示。
                  resultLabel={t('fish.total', { n: goods.length })}
                  shortcut
                />
              </div>
            </div>
            {/* 手机上搜索独占第一行；页签从下一行开始、靠右（与「物品 ID」一致）。 */}
            <div className="ml-0 flex w-full flex-wrap items-center gap-2 text-xs text-muted-foreground sm:ml-auto sm:w-auto">
              <div className="flex min-w-0 items-center rounded-container bg-accent p-0.5">
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  value={tab}
                  onValueChange={(value) => {
                    // 再点一下当前页签会传空串：保持原样。
                    if (value) setUi({ tab: value as FishTab })
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
            </div>
            {error && !selected && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          {/* 货架区留一圈内边距（`p-2`）：最后一行的板线 / 板下投影不会被容器下沿切掉。 */}
          <div className="p-2">
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
                      {keyword
                        ? t('fish.empty')
                        : tab === 'bought'
                          ? t('fish.emptyBought')
                          : tab === 'favorite'
                            ? t('fish.emptyFavorite')
                            : t('fish.empty')}
                    </EmptyTitle>
                    {tab === 'all' && !keyword && (
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
            onTokenInvalid={onTokenInvalid}
            // 顶栏那个「刷新全部」同时刷新货架（输入框里不再单独放刷新按钮）。
            onManualRefresh={() => void loadShop()}
            // 执行 `/fish reload` 之后货架已经变了：重新拉一次，别让页面停在旧价格上。
            onConfigReloaded={() => void loadShop()}
          />
          {/* 顶栏挂载顺序 = 显示顺序：卡片那组（上次刷新 / 刷新全部 / 管理卡片）之后、
              全局动作（浮动终端）之前，所以「页面设置 / 全屏」正好夹在两者中间。 */}
          <TopBarActions>
            {fishSettingsControl}
            {fullscreenToggle}
          </TopBarActions>
        </div>
      </div>
      </div>

      <Sheet open={selected !== null} onOpenChange={(o) => !o && closeDetail()}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
          onOpenAutoFocus={(event) => {
            // 默认焦点：需填参数 → 参数输入框；否则 → 购买按钮。
            event.preventDefault()
            if (needArgs) argsRef.current?.focus()
            else buyRef.current?.focus()
          }}
        >
          {selected && (
            <>
              <SheetHeader className="shrink-0 border-b px-5 py-3 pr-12">
                <SheetTitle>{t('fish.detail')}</SheetTitle>
                <div className="mt-2 flex flex-col items-center gap-2">
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
              </SheetHeader>

              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                {/* 属性（价格 / 解锁 / 别名 / 限购 / 备注）：文字统一在值框上面一行的左上角 */}
                <dl className="flex flex-col gap-2">
                  <DetailField label={t('fish.cost')}>
                    {selected.cost.trim() ? renderRich(selected.cost) : renderRich(t('fish.free'))}
                  </DetailField>
                  {personalNotes.length > 0 && (
                    <DetailField label={t('fish.myState')}>{renderRichLines(personalNotes)}</DetailField>
                  )}
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

                {/* 上游已判定不能买（限购满了 / 售完 / 冷却中 / 死了 / 昼夜不对）：先说清楚，别让玩家白点 */}
                {offShelf && !confirming && (
                  <Alert>
                    <AlertDescription>{t('fish.offShelf')}</AlertDescription>
                  </Alert>
                )}
                {blocked && !confirming && (
                  <Alert>
                    <AlertDescription>{selected?.blockReason || t('fish.cannotBuy')}</AlertDescription>
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
                      disabled={!argsReady || buyCooldown > 0 || blocked || degraded || offShelf}
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
        </SheetContent>
      </Sheet>
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
