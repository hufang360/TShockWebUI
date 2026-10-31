import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  AlertTriangle,
  Download,
  Droplets,
  Fish,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  ShoppingCart,
} from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'
import { ItemIcon } from '@/components/ItemIcon'
import { LoginGate } from '@/components/LoginGate'
import { SearchInput } from '@/components/SearchInput'
import { Notice } from '@/components/Notice'
import { CommandOutput } from '@/components/ResultPanel'
import { FishCommandCards } from '@/components/FishCommandCards'
import { TopBarActions } from '@/components/TopBar'
import { CELL_ICON_SIZE, GOOD_GRID, GoodCell, GoodThumb, goodPrefixName } from '@/components/fishshop/GoodCells'
import { GoodsTable } from '@/components/fishshop/GoodsTable'
import { usePageScrollReset, useStickyHeaderOffset } from '@/hooks/usePageScroll'
import { parseRichText } from '@/lib/richtext'
import { cn } from '@/lib/cn'
import { splitFishArgs } from '@/lib/fishArgs'
import { isDegradedGood } from '@/lib/fishGood'
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
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Spinner,
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
  /** 「页面设置 → 表格视图」。 */
  tableView?: boolean
  /** 最近购买的 5 件商品（去重、最新在前）：本机记忆，买完还能一键找回。 */
  recentBuys?: FishGood[]
}

const DEFAULT_STATE: FishUiState = { query: '' }

/** 「最近购买」最多记几件。 */
const RECENT_BUYS_MAX = 5

/**
 * 本机记忆的数据可能被改坏 / 版本升级后形状不对：只保留结构对得上的条目，
 * 按 `serial` 去重（同一件商品只留最新的一条），最多 `RECENT_BUYS_MAX` 条。
 */
function sanitizeRecentBuys(value: unknown): FishGood[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<number>()
  const out: FishGood[] = []
  for (const good of value) {
    if (!good || typeof (good as FishGood).serial !== 'number') continue
    if (typeof (good as FishGood).name !== 'string') continue
    const entry = good as FishGood
    if (seen.has(entry.serial)) continue
    seen.add(entry.serial)
    out.push(entry)
    if (out.length >= RECENT_BUYS_MAX) break
  }
  return out
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
  const selected = useMemo(() => {
    if (!selectedSnapshot) return null
    return shop?.goods.find((g) => g.serial === selectedSnapshot.serial) ?? selectedSnapshot
  }, [selectedSnapshot, shop])
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

  /** 买成功就记一笔（去重 + 最多 5 条，最新在前）。 */
  const rememberPurchase = useCallback(
    (good: FishGood) => {
      const current = sanitizeRecentBuys(ui.recentBuys).filter((g) => g.serial !== good.serial)
      setUi({ recentBuys: [good, ...current].slice(0, RECENT_BUYS_MAX) })
    },
    [setUi, ui.recentBuys],
  )

  /** 点「最近购买」：货架上还在就打开最新的那条（能直接再买），已经下架就用快照。 */
  const openRecent = useCallback(
    (good: FishGood) => {
      const live = shop?.goods.find((g) => g.serial === good.serial)
      openDetail(live ?? good)
    },
    [shop, openDetail],
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

  const keyword = ui.query.trim().toLowerCase()
  const goods = useMemo(() => {
    const list = shop?.goods ?? []
    if (!keyword) return list
    return list.filter(
      (g) =>
        g.name.toLowerCase().includes(keyword) ||
        String(g.serial).includes(keyword) ||
        g.desc.toLowerCase().includes(keyword) ||
        g.map.some((m) => m.toLowerCase().includes(keyword)),
    )
  }, [shop, keyword])

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
  const rootRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const stickyTop = useStickyHeaderOffset(toolbarRef)
  usePageScrollReset(rootRef)

  const hideMeta = ui.hideMeta === true
  const tableView = ui.tableView === true
  const recentBuys = useMemo(() => sanitizeRecentBuys(ui.recentBuys), [ui.recentBuys])
  const [settingsOpen, setSettingsOpen] = useState(false)

  /** 导出当前筛选结果（CSV）：`[i:..]` 这类富文本标签还原成 `#ID`，Excel 打开不乱。 */
  const exportGoods = useCallback(() => {
    const plain = (text: string | undefined) =>
      parseRichText(text ?? '')
        .map((token) =>
          token.kind === 'item'
            ? `#${token.itemId}${token.stack && token.stack > 1 ? `x${token.stack}` : ''}`
            : token.text,
        )
        .join('')
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`
    const csv = [
      ['Serial', 'Name', 'Cost', 'Tags', 'Comment', 'Description'],
      ...goods.map((good) => [
        String(good.serial),
        good.name,
        plain(good.cost),
        good.map.join(' / '),
        plain(good.comment),
        plain(good.desc),
      ]),
    ]
      .map((row) => row.map(escape).join(','))
      .join('\r\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'tswui-fish.csv'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }, [goods])

  /** 页面设置（与物品 ID 同规）：隐藏编号和名称 / 表格视图 / 导出表格。 */
  const fishSettingsControl = (
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('fish.settings')}
          title={t('fish.settings')}
          className={cn(
            'text-muted-foreground hover:bg-accent hover:text-foreground',
            settingsOpen && 'bg-accent text-foreground',
          )}
        >
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0" data-testid="fish-settings-popover">
        <div className="border-b px-4 py-3 text-sm font-semibold text-foreground">
          {t('fish.settings')}
        </div>
        <FieldGroup className="gap-0.5 p-2">
          <div className="px-2 py-1 text-2xs font-medium text-muted-foreground">
            {t('dex.viewSection')}
          </div>
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
          <Button
            size="sm"
            variant="outline"
            className="mx-2 mt-1 w-[calc(100%-1rem)]"
            onClick={exportGoods}
            disabled={goods.length === 0}
          >
            <Download />
            {t('fish.exportTable')}
          </Button>
        </FieldGroup>
      </PopoverContent>
    </Popover>
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
    <TopBarActions
      info={
        <InfoPopover label={t('home.pageInfo')} title={t('page.store.title')}>
          {t('page.store.desc')}
        </InfoPopover>
      }
    />
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
        className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_360px]"
        style={{ '--page-sticky-top': `${stickyTop}px` } as CSSProperties}
      >
        {pageActions}

        {/* 左：货架（REST API 不可用时只影响左侧，右侧指令卡片仍可用） */}
        <div className="flex min-w-0 flex-col gap-2 xl:min-h-0">
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
          {/* 吸顶工具条：搜索（结果数在框内）+ 最近购买 + 页面设置。
              货架（页面）往上滚时它留在顶栏下面，不用滚回顶部找搜索框。 */}
          <div
            ref={toolbarRef}
            className="sticky top-12 z-20 flex flex-col gap-2 bg-background py-1.5"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="w-full max-w-sm min-w-0">
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
              {recentBuys.length > 0 && (
                <div
                  data-testid="fish-recent-buys"
                  aria-label={t('fish.recentBuys')}
                  className="flex min-w-0 flex-wrap items-center gap-1"
                >
                  {recentBuys.map((good) => (
                    <Button
                      key={good.serial}
                      variant="secondary"
                      size="sm"
                      className="h-7 max-w-40 gap-1 px-1.5"
                      title={`${t('fish.recentBuys')}：#${good.serial} ${good.name}`}
                      onClick={() => openRecent(good)}
                    >
                      <GoodThumb good={good} dataset={dataset} size={18} />
                      <span className="truncate text-2xs">{good.name}</span>
                    </Button>
                  ))}
                </div>
              )}
              <div className="ml-auto flex shrink-0 items-center gap-1">{fishSettingsControl}</div>
            </div>
            {error && !selected && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          {loading && !shop ? (
            <div className={GOOD_GRID} role="status" aria-busy="true" aria-label={t('fish.loading')}>
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="grid place-items-center gap-1">
                  <Skeleton className="size-18 rounded-control" />
                  {!hideMeta && <Skeleton className="h-2.5 w-8" />}
                  {!hideMeta && <Skeleton className="h-3 w-12" />}
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
                  <EmptyTitle>{t('fish.empty')}</EmptyTitle>
                  <EmptyDescription>{t('fish.clickHint')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          ) : tableView ? (
            <GoodsTable rows={goods} dataset={dataset} onSelect={openDetail} />
          ) : (
            <div className={GOOD_GRID}>
              {goods.map((good) => (
                <GoodCell
                  key={good.serial}
                  good={good}
                  dataset={dataset}
                  hideMeta={hideMeta}
                  onSelect={openDetail}
                />
              ))}
            </div>
          )}
        </>
      )}
        </div>

        {/* 右列：指令卡片（只依赖 rawcmd，不依赖鱼店 REST API）。
            整页滚动只滚**左侧货架**：右列 `xl:sticky` 钉在顶栏下面，内容比一屏高时自己内部滚，
            这样往下翻商品时右侧的「钓鱼信息」不会跟着一起滚走。 */}
        <div className="min-w-0 xl:sticky xl:top-12 xl:flex xl:h-[calc(100dvh-4rem)] xl:flex-col xl:self-start">
          <FishCommandCards
            dataset={dataset}
            transport={transport}
            authenticated={authenticated}
            serverId={serverId}
            refreshInterval={refreshInterval}
            onTokenInvalid={onTokenInvalid}
            // 顶栏那个「刷新全部」同时刷新货架（输入框里不再单独放刷新按钮）。
            onManualRefresh={() => void loadShop()}
          />
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
                  <GoodThumb good={selected} dataset={dataset} size={CELL_ICON_SIZE} />
                  <p className="text-center text-base font-semibold text-foreground">
                    #{selected.serial}{' '}
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
              </div>

              {/* 底部操作区 */}
              <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
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
                    {/* 快捷关闭（弹框右上角也有 X） */}
                    <Button variant="outline" className="h-8 bg-card" onClick={closeDetail}>
                      {t('action.close')}
                      <Kbd>Esc</Kbd>
                    </Button>
                    <Button
                      ref={buyRef}
                      variant="primary"
                      className="h-8"
                      disabled={!argsReady || buyCooldown > 0 || blocked || degraded}
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
