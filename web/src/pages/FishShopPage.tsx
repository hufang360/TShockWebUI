import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, Fish, RefreshCw, ShieldAlert, ShoppingCart } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { CommandOutput } from '@/components/ResultPanel'
import { FishCommandCards } from '@/components/FishCommandCards'
import { cn } from '@/lib/cn'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardBody,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
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
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { useModuleState } from '@/hooks/useModuleState'
import { useDataset } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'
import { isRefreshDue, markRefreshed, refreshScope } from '@/lib/refreshGate'
import { parseRichText } from '@/lib/richtext'
import { TshockRequestError } from '@/lib/tshock'
import type { BackendTransport, FishBuyResult, FishCapabilities, FishGood, FishShop } from '@/lib/tshock'
import type { Dataset, Item } from '@/types'

/**
 * 鱼店（TShock 第三方插件 FishShop）。
 *
 * 参照「物品图鉴」：工具条一张卡片，商品网格直接铺在页面上（无卡片背景）；
 * 点击商品弹出详情弹框（价格 / 解锁 / 别名 / 商品 / 备注都渲染 [i:..] 图标）。
 *
 * 走插件自带的 REST 端点（/v3/fishshop/*）：
 *   - /api/fish/list → 货架（含 icon / buyMax / needArgs）
 *   - /api/fish/buy  → 为自己购买
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
const CELL_ICON_SIZE = 64

interface GoodItemTag {
  itemId: number
  stack?: number
  prefix?: number
}

/** 解析一段富文本里的第一个 `[i:..]` 标签。 */
function firstItemTag(source: string | undefined): GoodItemTag | null {
  if (!source) return null
  for (const token of parseRichText(source)) {
    if (token.kind === 'item') {
      return { itemId: token.itemId, stack: token.stack, prefix: token.prefixId }
    }
  }
  return null
}

/**
 * 是否「原生物品」：插件的 `desc` 里带 `[i:..]`（物品类商品都是这样）。
 * 服务 / 指令类商品的 `desc` 只有文字，`icon` 只是借来当识别的图（例如一本书），
 * 因此不算原生物品 → **不显示物品提示**（货架格子与详情页一致）。
 */
function goodIsNativeItem(good: FishGood): boolean {
  return firstItemTag(good.desc) !== null
}

/**
 * 从商品里取展示图标：优先插件返回的 `icon` 字段（服务类商品的 desc 只有文字），
 * 其次再解析 `desc` 里的第一个 `[i:..]` 标签。都没有则返回 null（走名称首字占位）。
 */
function goodIcon(good: FishGood): GoodItemTag | null {
  return firstItemTag(good.icon) ?? firstItemTag(good.desc)
}

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

  // 实时探测插件可用性（登录后 / 切换服务器后重探）。
  useEffect(() => {
    if (!authenticated) {
      setCapability(null)
      setProbeError(null)
      setShop(null)
      return
    }
    let cancelled = false
    setChecking(true)
    setProbeError(null)
    void (async () => {
      try {
        const cap = await transport.fishCapabilities()
        if (!cancelled) setCapability(cap)
      } catch (err) {
        if (cancelled) return
        if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
          onTokenInvalid()
        }
        setCapability(null)
        setProbeError(kindMessage(err))
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [serverId, authenticated, transport, onTokenInvalid, kindMessage])

  const canUse = capability?.plugin === true && capability.permission === true

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

  // 进入页面自动拉货架；受「页面数据刷新间隔」门控（切换服务器后按各自作用域重算）。
  useEffect(() => {
    if (!canUse) return
    const scope = refreshScope(serverId, 'shelf')
    if (!isRefreshDue(scope, refreshInterval)) return
    markRefreshed(scope)
    void loadShop()
  }, [canUse, loadShop, serverId, refreshInterval])

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
  }, [])

  const heading = (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold">{t('page.store.title')}</h2>
      <p className="text-xs text-muted-foreground">{t('page.store.desc')}</p>
    </div>
  )

  if (!authenticated) {
    return (
      <div className="flex flex-col gap-4">
        {heading}
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-3 pt-4">
            <p className="text-sm text-foreground/80">{t('fish.notLoggedIn')}</p>
            <Button variant="primary" onClick={onLogin}>
              {t('action.login')}
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <>
      <div
        ref={rootRef}
        // 两列共享行：row1 = 左页头 / 右表头，row2 = 左内容 / 右卡片列表。
        // 整页锁定到可用高度，两列在 row2 各自内部滚动（货架不再溢出到视口外）。
        className="grid gap-4 xl:h-[var(--fish-fill)] xl:grid-cols-[minmax(0,1fr)_360px] xl:grid-rows-[auto_minmax(0,1fr)]"
        style={fillHeight ? ({ '--fish-fill': `${fillHeight}px` } as CSSProperties) : undefined}
      >
        {/* 左上：页头 */}
        <div className="xl:col-start-1 xl:row-start-1">{heading}</div>

        {/* 左下：货架（REST API 不可用时只影响左侧，右侧指令卡片仍可用） */}
        <div className="flex min-w-0 flex-col gap-4 xl:col-start-1 xl:row-start-2 xl:min-h-0">
      {checking && (
        <Card>
          <CardBody className="flex items-center gap-2 pt-4 text-sm text-muted-foreground">
            <Spinner />
            {t('fish.checking')}
          </CardBody>
        </Card>
      )}

      {!checking && capability === null && probeError && (
        <Notice icon={<AlertTriangle />} title={t('fish.probeFailed')}>
          {probeError}
        </Notice>
      )}

      {!checking && capability?.plugin === false && (
        <Notice icon={<AlertTriangle />} title={t('fish.pluginMissing')}>
          {t('fish.pluginMissingHint')}
        </Notice>
      )}

      {!checking && capability?.plugin === true && !capability.permission && (
        <Notice icon={<ShieldAlert />} title={t('fish.noPermission')}>
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
              <span className="text-[10px] text-muted-foreground">
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
              <p className="p-3 text-xs text-muted-foreground">{t('fish.loading')}</p>
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

        {/* 右列：指令卡片（只依赖 rawcmd，不依赖鱼店 REST API）。
            xl 下 FishCommandCards 为 display:contents，其表头 / 列表分别落到 row1 / row2。 */}
        <FishCommandCards
          dataset={dataset}
          transport={transport}
          authenticated={authenticated}
          serverId={serverId}
          refreshInterval={refreshInterval}
          onTokenInvalid={onTokenInvalid}
        />
      </div>

      <Dialog open={selected !== null} onOpenChange={(o) => !o && closeDetail()}>
        <DialogContent
          className="max-w-xl"
          // 点击框外 / 遮罩不关闭：仅允许右上角关闭或 Esc。
          onInteractOutside={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            // 默认焦点：需填参数 → 参数输入框；否则 → 购买按钮。
            event.preventDefault()
            if (needArgs) argsRef.current?.focus()
            else buyRef.current?.focus()
          }}
        >
          {selected && (
            <>
              <DialogTitle>{t('fish.detail')}</DialogTitle>

              <div className="max-h-[70vh] flex flex-col gap-4 overflow-y-auto pr-1">
                {/* 图标单独一行 */}
                <div className="flex justify-center">
                  <GoodThumb good={selected} dataset={dataset} size={CELL_ICON_SIZE} />
                </div>

                {/* 序号 + 名称（词缀名放在商品名前，颜色同物品 tips 的琥珀色） */}
                <div className="text-center">
                  <p className="text-base font-semibold text-foreground">
                    #{selected.serial}{' '}
                    {goodPrefixName(selected, dataset) ? (
                      <span className="text-warning">{goodPrefixName(selected, dataset)} </span>
                    ) : null}
                    {selected.name}
                  </p>
                  {selected.refund && (
                    <div className="mt-1 flex justify-center">
                      <Badge tone="accent">{t('fish.refundable')}</Badge>
                    </div>
                  )}
                </div>

                {/* 价格 / 解锁 / 别名 / 限购 / 备注：固定标签列，视觉对齐 */}
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
                    <p className="text-[11px] text-muted-foreground">{t('fish.buyHint')}</p>
                    {selected.refund && (
                      <p className="text-[11px] text-warning">{t('fish.refundHint')}</p>
                    )}
                  </div>
                )}

                {!confirming && needArgs && (
                  <div className="flex items-center gap-2">
                    <span className="w-9 shrink-0 text-right text-[11px] text-muted-foreground">
                      {t('fish.args')}
                    </span>
                    <Input
                      ref={argsRef}
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      placeholder={t('fish.argsPlaceholder')}
                      aria-label={t('fish.args')}
                      className="min-w-0 flex-1"
                    />
                  </div>
                )}

                {!confirming && adjustable && (
                  <div className="flex items-center gap-2">
                    <span className="w-9 shrink-0 text-right text-[11px] text-muted-foreground">
                      {t('fish.amount')}
                    </span>
                    <Input
                      type="number"
                      min={1}
                      max={maxBuy}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      aria-label={t('fish.amount')}
                      className="w-24"
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {t('fish.buyMaxNote', { n: maxBuy })}
                    </span>
                  </div>
                )}

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {buyResult && (
                  <div
                    className={cn(
                      'flex flex-col gap-1 rounded-md bg-success/15 px-3 py-2',
                      buyCooldown > 0 && 'tswui-flash',
                    )}
                  >
                    {renderRich(
                      t('fish.buyOk', {
                        name: buyResult.name || selected.name,
                        n: buyResult.amount,
                        cost: buyResult.cost,
                      }),
                    )}
                    <p className="text-[11px] font-medium text-foreground">{t('fish.successHint')}</p>
                  </div>
                )}
              </div>

              {/* 底部操作区（底色比卡片深） */}
              <DialogFooter>
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
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** 商品里物品的词缀名（若有）；用于提示与名称前的词缀显示。 */
function goodPrefixName(good: FishGood, dataset: Dataset | null): string | undefined {
  const icon = goodIcon(good)
  return icon?.prefix != null ? dataset?.prefixesById.get(icon.prefix)?.name : undefined
}

/** 网格格子：图标 + 名称 + 编号。图标取自 icon 字段（其次 desc 的 [i:..] 标签）。 */
function GoodCell({
  good,
  dataset,
  onSelect,
}: {
  good: FishGood
  dataset: Dataset | null
  onSelect: (good: FishGood) => void
}) {
  const prefixName = goodPrefixName(good, dataset)
  return (
    <Button
      variant="ghost"
      onClick={() => onSelect(good)}
      aria-label={good.name}
      className="grid h-auto cursor-pointer place-items-center gap-1 rounded-xl px-1.5 py-1.5 font-normal hover:-translate-y-0.5 hover:bg-primary/10"
    >
      <GoodThumb good={good} dataset={dataset} size={CELL_ICON_SIZE} />
      <span className="w-full truncate text-center text-xs leading-4 text-foreground">
        {prefixName ? <span className="text-warning">{prefixName} </span> : null}
        {good.name}
      </span>
      <span className="font-pixel text-[10px] leading-none text-muted-foreground">#{good.serial}</span>
    </Button>
  )
}

/**
 * 商品图标：有物品标签用图集图标，否则用名称首字占位。
 * 只有**原生物品**（`desc` 带 `[i:..]`）悬停才显示物品提示；借来的识别图不显示。
 */
function GoodThumb({ good, dataset, size }: { good: FishGood; dataset: Dataset | null; size: number }) {
  const icon = goodIcon(good)
  const item: Item | undefined = icon ? dataset?.itemsById.get(icon.itemId) : undefined
  if (item) {
    return (
      <ItemIcon
        item={item}
        atlas={dataset?.atlas}
        size={size}
        stack={icon?.stack}
        prefix={goodPrefixName(good, dataset)}
        tooltip={goodIsNativeItem(good)}
      />
    )
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-lg bg-accent/60 text-sm text-foreground"
      style={{ width: size, height: size }}
    >
      {good.name.slice(0, 1) || '?'}
    </span>
  )
}

/** 固定标签列 + 内容，保证「价格 / 解锁 / 别名 / 商品 / 备注」左侧对齐。 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="mt-0.5 w-9 shrink-0 text-right text-[11px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  )
}

function Notice({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children?: React.ReactNode
}) {
  return (
    <Alert variant="warning">
      {icon}
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  )
}
