import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, Droplets, Fish, RefreshCw, ShieldAlert, ShoppingCart } from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'
import { ItemIcon } from '@/components/ItemIcon'
import { LoginGate } from '@/components/LoginGate'
import { Notice } from '@/components/Notice'
import { CommandOutput } from '@/components/ResultPanel'
import { FishCommandCards } from '@/components/FishCommandCards'
import { TopBarActions } from '@/components/TopBar'
import { CELL_ICON_SIZE, GoodCell, GoodThumb, goodPrefixName } from '@/components/fishshop/GoodCells'
import { cn } from '@/lib/cn'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardBody,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Kbd,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
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
 * 点击商品弹出详情弹框（价格 / 解锁 / 别名 / 商品 / 备注都渲染 [i:..] 图标）。
 *
 * 走插件自带的 REST 端点（新版 `/fishshop/*`，老版 `/v3/fishshop/*` 由后端回退）：
 *   - /api/fish/capabilities → 插件是否在 / 有没有 REST 接口 / 有没有权限
 *   - /api/fish/list → 货架（含 icon / buyMax / needArgs）
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
}

const DEFAULT_STATE: FishUiState = { query: '' }

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
  /** 货架上次刷新时间（刷新图标 tooltip 用）。 */
  const [lastShopLoadedAt, setLastShopLoadedAt] = useState<number | null>(null)

  // 详情弹框
  const [selected, setSelected] = useState<FishGood | null>(null)
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
      setShop(await transport.fishList())
      setLastShopLoadedAt(Date.now())
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

  // 支持参数（指令类）时不调数量；只有 buyMax > 1 才显示数量调节。
  const needArgs = selected?.needArgs === true
  const maxBuy = selected?.buyMax ?? 1
  const adjustable = !needArgs && maxBuy > 1
  const buyAmount = needArgs ? 1 : adjustable ? Math.min(maxBuy, Math.max(1, Number.parseInt(amount, 10) || 1)) : 1
  const argsReady = !needArgs || args.trim().length > 0
  const hasLimit =
    (selected?.allowGroup?.length ?? 0) > 0 ||
    (selected?.allowPlayers?.length ?? 0) > 0 ||
    (selected?.denyPlayers?.length ?? 0) > 0
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
      // 冷却数秒：按钮禁用 + 提示闪烁，避免玩家连点重复购买。
      setBuyCooldown(3)
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
  }, [selected, argsReady, transport, buyAmount, needArgs, args, loadShop, onTokenInvalid, kindMessage])

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

  // 右列高度 = 实测可用高度（sticky + 内部滚动），避免整页多出滚动。
  const rootRef = useRef<HTMLDivElement>(null)
  const [fillHeight, setFillHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const el = rootRef.current
    const scroller = el?.closest('main')
    if (!el || !(scroller instanceof HTMLElement)) return
    const measure = () => {
      const box = scroller.getBoundingClientRect()
      const top = el.getBoundingClientRect().top - box.top + scroller.scrollTop
      let wrap: HTMLElement | null = el
      while (wrap && wrap.parentElement !== scroller) wrap = wrap.parentElement
      const padBottom = wrap ? Number.parseFloat(getComputedStyle(wrap).paddingBottom) || 0 : 0
      setFillHeight(Math.max(280, Math.round(scroller.clientHeight - top - padBottom)))
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined
    ro?.observe(scroller)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
    // 依赖 authenticated：未登录时先渲染 LoginGate，rootRef 尚未挂载；登录后需重新量高。
  }, [authenticated])

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
        // 两列：左货架 / 右指令卡片，各自内部滚动；整页锁定到可用高度。
        className="grid gap-2 xl:h-[var(--fish-fill)] xl:grid-cols-[minmax(0,1fr)_360px]"
        style={fillHeight ? ({ '--fish-fill': `${fillHeight}px` } as CSSProperties) : undefined}
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
          {/* 头部：唯一一块白底区域（输入框 + 一行件数） */}
          <Card className="flex min-w-0 flex-col">
            <CardBody className="flex flex-col gap-2 py-3">
              <InputGroup>
                <InputGroupInput
                  value={ui.query}
                  onChange={(e) => setUi({ query: e.target.value })}
                  placeholder={t('fish.search')}
                  aria-label={t('fish.search')}
                />
                <InputGroupAddon align="inline-end">
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={loading}
                          aria-label={t('home.refresh')}
                          onClick={() => void loadShop()}
                        >
                          {loading ? (
                            <Spinner aria-hidden />
                          ) : (
                            <RefreshCw aria-hidden />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {lastShopLoadedAt
                          ? t('home.lastRefresh', {
                              time: new Date(lastShopLoadedAt).toLocaleTimeString(),
                            })
                          : t('home.neverRefreshed')}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </InputGroupAddon>
              </InputGroup>
              <span className="text-2xs text-muted-foreground">
                {t('fish.total', { n: goods.length })}
              </span>
              {error && !selected && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardBody>
          </Card>

          {/* 商品区：铺在页面背景上、无左右边距；自身是滚动区域（在 row2 内 flex-1 填满），滚轮不传递给右列 */}
          <div className="min-w-0 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain">
            {loading && !shop ? (
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CELL_ICON_SIZE + 24}px, 1fr))` }}
                role="status"
                aria-busy="true"
                aria-label={t('fish.loading')}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="grid place-items-center gap-2 rounded-xl p-2">
                    <Skeleton className="size-16 rounded-xl" />
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-2.5 w-10" />
                  </div>
                ))}
              </div>
            ) : goods.length === 0 ? (
              <Empty className="min-h-40 border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Fish />
                  </EmptyMedia>
                  <EmptyTitle>{t('fish.empty')}</EmptyTitle>
                  <EmptyDescription>{t('fish.clickHint')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CELL_ICON_SIZE + 24}px, 1fr))` }}
              >
                {goods.map((good) => (
                  <GoodCell key={good.serial} good={good} dataset={dataset} onSelect={openDetail} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
        </div>

        {/* 右列：指令卡片（只依赖 rawcmd，不依赖鱼店 REST API）。 */}
        <FishCommandCards
          dataset={dataset}
          transport={transport}
          authenticated={authenticated}
          serverId={serverId}
          refreshInterval={refreshInterval}
          onTokenInvalid={onTokenInvalid}
        />
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
                <div className="mt-2 flex flex-col items-center gap-1.5">
                  <GoodThumb good={selected} dataset={dataset} size={CELL_ICON_SIZE} />
                  <p className="text-center text-base font-semibold text-foreground">
                    #{selected.serial}{' '}
                    {goodPrefixName(selected, dataset) ? (
                      <span className="text-warning">{goodPrefixName(selected, dataset)} </span>
                    ) : null}
                    {selected.name}
                  </p>
                  {selected.refund && <Badge tone="accent">{t('fish.refundable')}</Badge>}
                </div>
              </SheetHeader>

              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                {/* 属性（价格 / 解锁 / 别名 / 限购 / 备注）：文字统一在值框上面一行的左上角 */}
                <dl className="flex flex-col gap-2">
                  <Field label={t('fish.cost')}>
                    {selected.cost.trim() ? renderRich(selected.cost) : renderRich(t('fish.free'))}
                  </Field>
                  {selected.unlock.trim() && (
                    <Field label={t('fish.unlock')}>{renderRich(selected.unlock)}</Field>
                  )}
                  {selected.map.length > 0 && (
                    <Field label={t('fish.alias')}>{renderRich(selected.map.join(', '))}</Field>
                  )}
                  {hasLimit && <Field label={t('fish.limit')}>{renderRichLines(limitLines)}</Field>}
                  {selected.comment.trim() && (
                    <Field label={t('fish.comment')}>{renderRich(selected.comment)}</Field>
                  )}
                </dl>

                {/* 确认 / 参数（操作按钮在底部操作区） */}
                {confirming && (
                  <div className="flex flex-col gap-2 rounded-lg bg-accent/50 p-3">
                    <p className="text-xs text-foreground">
                      {needArgs
                        ? t('fish.buyConfirmArgs', { args: args.trim() })
                        : t('fish.buyConfirm', { n: buyAmount })}
                    </p>
                    <p className="text-xs text-muted-foreground">{t('fish.buyHint')}</p>
                    {selected.refund && (
                      <p className="text-xs text-warning">{t('fish.refundHint')}</p>
                    )}
                  </div>
                )}

                {!confirming && needArgs && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t('fish.args')}</span>
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

                {buyResult && (
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
                      disabled={!argsReady || buyCooldown > 0}
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
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}
