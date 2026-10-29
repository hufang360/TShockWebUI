import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, PackagePlus, RefreshCw, Search, ShieldAlert, X } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { LoginGate } from '@/components/LoginGate'
import { Notice } from '@/components/Notice'
import { RequisitionCard } from '@/components/requisition/RequisitionCard'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebounced'
import { useDataset } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'
import { formatClock } from '@/lib/clock'

import { searchItems } from '@/lib/items'
import type {
  BackendTransport,
  Requisition,
  RequisitionItem,
  RequestCapabilities,
} from '@/lib/tshock'
import { TshockRequestError } from '@/lib/tshock'
import type { Item } from '@/types'

interface RequisitionPageProps {
  /** 当前上游 id：界面状态按服务器分开。 */
  serverId: string
  transport: BackendTransport
  authenticated: boolean
  /** 页面数据自动刷新间隔（毫秒，0 = 不自动刷新）。 */
  refreshInterval: number
  onTokenInvalid: () => Promise<boolean>
  onLogin: () => void
}

type Tab = 'mine' | 'review'

const MAX_ITEMS = 10
const MAX_STACK = 9999

/**
 * 物资申请（自研信使插件 WebUI 的 /webui/requests*）。
 *
 * 玩家：搜索物品 → 加入清单 → 填用途 → 提交；查看自己的申请状态 / 撤回。
 * 服主（有 webui.request.review）：多一个「待审核」tab，可通过 / 拒绝 / 补发。
 */
export function RequisitionPage({
  serverId,
  transport,
  authenticated,
  refreshInterval,
  onTokenInvalid,
  onLogin,
}: RequisitionPageProps) {
  const { t, lang } = useI18n()
  const dataset = useDataset()
  const items = useMemo(() => dataset?.items ?? [], [dataset])
  const itemsById = useMemo(() => dataset?.itemsById ?? new Map<number, Item>(), [dataset])
  const atlas = dataset?.atlas

  const [capability, setCapability] = useState<RequestCapabilities | null>(null)
  const [checking, setChecking] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)

  const [tab, setTab] = useState<Tab>('mine')
  const [reviewStatus, setReviewStatus] = useState<'pending' | 'all'>('pending')
  const [mine, setMine] = useState<Requisition[]>([])
  const [all, setAll] = useState<Requisition[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null)

  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, 180)
  const [cart, setCart] = useState<RequisitionItem[]>([])
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<Requisition | null>(null)

  const [denying, setDenying] = useState<Requisition | null>(null)
  const [denyReason, setDenyReason] = useState('')
  const [reviewBusy, setReviewBusy] = useState(false)

  const kindMessage = useCallback(
    (err: unknown): string => {
      if (err instanceof TshockRequestError) {
        switch (err.kind) {
          case 'token':
          case 'auth':
            return t('app.tokenInvalid')
          case 'permission':
            return err.message || t('requests.err.permission')
          case 'plugin_missing':
            return t('requests.err.pluginMissing')
          case 'plugin_outdated':
            return err.message || t('requests.err.pluginOutdated')
          case 'plugin_protocol':
            return err.message || t('requests.err.pluginOutdated')
          case 'rate_limited':
            return t('requests.err.rateLimited')
          case 'timeout':
            return t('requests.err.timeout')
          case 'unavailable':
            return t('requests.err.unavailable')
          case 'validation':
            return err.message
          default:
            return t('requests.err.badResponse')
        }
      }
      return err instanceof Error ? err.message : t('requests.err.badResponse')
    },
    [t],
  )

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
        void onTokenInvalid()
        return
      }
      setError(kindMessage(err))
    },
    [kindMessage, onTokenInvalid],
  )

  // 探测插件能力（登录后 / 切换服务器后重探）。
  useEffect(() => {
    if (!authenticated) {
      setCapability(null)
      setProbeError(null)
      setMine([])
      setAll([])
      return
    }
    let cancelled = false
    setChecking(true)
    setProbeError(null)
    void (async () => {
      try {
        const cap = await transport.requestCapabilities()
        if (cancelled) return
        setCapability(cap)
        setTab((current) => (cap.submit ? current : cap.review ? 'review' : current))
      } catch (err) {
        if (cancelled) return
        if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
          void onTokenInvalid()
          return
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

  const canSubmit = capability?.plugin === true && capability.submit === true
  const canReview = capability?.plugin === true && capability.review === true

  const loadMine = useCallback(async () => {
    if (!canSubmit) return
    try {
      setMine(await transport.requestList('all'))
      setLastLoadedAt(Date.now())
    } catch (err) {
      handleError(err)
    }
  }, [canSubmit, transport, handleError])

  const loadAll = useCallback(async () => {
    if (!canReview) return
    try {
      setAll(await transport.requestListAll(reviewStatus))
      setLastLoadedAt(Date.now())
    } catch (err) {
      handleError(err)
    }
  }, [canReview, transport, reviewStatus, handleError])

  const reload = useCallback(async () => {
    if (!canSubmit && !canReview) return
    setLoading(true)
    setError(null)
    try {
      if (tab === 'review' && canReview) await loadAll()
      else await loadMine()
    } finally {
      setLoading(false)
    }
  }, [canSubmit, canReview, tab, loadAll, loadMine])

  // 进入页面 / 切 tab / 改筛选时拉取；有刷新间隔时定时刷新。
  useEffect(() => {
    if (!canSubmit && !canReview) return
    void reload()
    if (refreshInterval <= 0) return
    const timer = setInterval(() => void reload(), refreshInterval)
    return () => clearInterval(timer)
  }, [canSubmit, canReview, reload, refreshInterval])

  const refreshEverything = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([canSubmit ? loadMine() : Promise.resolve(), canReview ? loadAll() : Promise.resolve()])
    } finally {
      setLoading(false)
    }
  }, [canSubmit, canReview, loadMine, loadAll])

  const results = useMemo(
    () => (debounced.trim() ? searchItems(items, debounced, 24) : []),
    [items, debounced],
  )

  const addItem = (item: Item) => {
    setSubmitted(null)
    setCart((prev) => {
      const existing = prev.find((x) => x.id === item.id)
      if (existing) {
        return prev.map((x) =>
          x.id === item.id ? { ...x, stack: Math.min(MAX_STACK, x.stack + 1) } : x,
        )
      }
      if (prev.length >= MAX_ITEMS) return prev
      return [...prev, { id: item.id, stack: 1 }]
    })
    setQuery('')
  }

  const setStack = (id: number, value: number) => {
    const stack = Math.max(1, Math.min(MAX_STACK, Number.isFinite(value) ? Math.floor(value) : 1))
    setCart((prev) => prev.map((x) => (x.id === id ? { ...x, stack } : x)))
  }

  const removeItem = (id: number) => setCart((prev) => prev.filter((x) => x.id !== id))

  const submit = useCallback(async () => {
    if (!canSubmit || cart.length === 0 || !reason.trim()) return
    setSubmitting(true)
    setError(null)
    setSubmitted(null)
    try {
      const record = await transport.requestCreate(cart, reason.trim(), note.trim())
      setSubmitted(record)
      setCart([])
      setReason('')
      setNote('')
      await refreshEverything()
    } catch (err) {
      handleError(err)
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, cart, reason, note, transport, refreshEverything, handleError])

  const cancel = useCallback(
    async (record: Requisition) => {
      setError(null)
      try {
        await transport.requestCancel(record.id)
        await refreshEverything()
      } catch (err) {
        handleError(err)
      }
    },
    [transport, refreshEverything, handleError],
  )

  const review = useCallback(
    async (record: Requisition, decision: 'approve' | 'deny', denial?: string) => {
      setReviewBusy(true)
      setError(null)
      try {
        await transport.requestReview(record.id, decision, denial ?? '')
        setDenying(null)
        setDenyReason('')
        await refreshEverything()
      } catch (err) {
        handleError(err)
      } finally {
        setReviewBusy(false)
      }
    },
    [transport, refreshEverything, handleError],
  )

  const deliver = useCallback(
    async (record: Requisition) => {
      setReviewBusy(true)
      setError(null)
      try {
        await transport.requestDeliver(record.id)
        await refreshEverything()
      } catch (err) {
        handleError(err)
      } finally {
        setReviewBusy(false)
      }
    },
    [transport, refreshEverything, handleError],
  )

  if (!authenticated) {
    return (
      <div className="flex flex-col gap-4">
        <LoginGate onLogin={onLogin} />
      </div>
    )
  }

  if (checking && !capability) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('requests.loading')}
        </div>
      </div>
    )
  }

  if (probeError) {
    return (
      <div className="flex flex-col gap-4">
        <Notice icon={<ShieldAlert />} title={t('requests.err.probeTitle')}>
          {probeError}
        </Notice>
      </div>
    )
  }

  if (!capability?.plugin) {
    return (
      <div className="flex flex-col gap-4">
        <Notice icon={<ShieldAlert />} title={t('requests.err.pluginMissing')}>
          {t('requests.err.pluginMissingHint')}
        </Notice>
      </div>
    )
  }

  if (!canSubmit && !canReview) {
    return (
      <div className="flex flex-col gap-4">
        <Notice icon={<ShieldAlert />} title={t('requests.err.permission')}>
          {t('requests.err.permissionHint')}
        </Notice>
      </div>
    )
  }

  const list = tab === 'review' ? all : mine
  const empty = list.length === 0

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>{error}</span>
            <Button size="sm" variant="ghost" onClick={() => setError(null)}>
              {t('app.gotIt')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {canReview ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="mine" variant="line" className="flex-none" disabled={!canSubmit}>
              {t('requests.mine')}
            </TabsTrigger>
            <TabsTrigger value="review" variant="line" className="flex-none">
              {t('requests.review')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="mine">{canSubmit && renderMine()}</TabsContent>
          <TabsContent value="review">{renderReview()}</TabsContent>
        </Tabs>
      ) : (
        renderMine()
      )}

      <Dialog
        open={denying != null}
        onOpenChange={(open) => {
          if (!open) setDenying(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('requests.denyTitle', { id: denying?.id ?? '' })}</DialogTitle>
            <DialogDescription>{t('requests.denyDesc')}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="requisition-deny-reason">{t('requests.denyReason')}</FieldLabel>
            <Textarea
              id="requisition-deny-reason"
              value={denyReason}
              maxLength={200}
              onChange={(e) => setDenyReason(e.target.value)}
              placeholder={t('requests.denyReasonPlaceholder')}
            />
            <FieldDescription>{t('requests.charCount', { n: denyReason.length })}</FieldDescription>
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDenying(null)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={!denyReason.trim() || reviewBusy}
              onClick={() => {
                if (denying) void review(denying, 'deny', denyReason)
              }}
            >
              {t('requests.denyConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )

  function renderMine() {
    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* 新建申请 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PackagePlus className="size-4" />
              {t('requests.new')}
            </CardTitle>
            <Badge tone={cart.length >= MAX_ITEMS ? 'warn' : 'neutral'}>
              {t('requests.itemCount', { n: cart.length })}
            </Badge>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="requisition-search">{t('requests.item')}</FieldLabel>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="requisition-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('requests.searchPlaceholder')}
                  className="pl-9"
                />
              </div>
              <FieldDescription>
                {cart.length >= MAX_ITEMS ? t('requests.cartMax') : t('requests.searchHint')}
              </FieldDescription>
            </Field>

            {query.trim() && (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border/50">
                {results.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                    {t('requests.noMatch')}
                  </p>
                ) : (
                  <ul className="divide-y divide-border/40">
                    {results.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                          onClick={() => addItem(item)}
                        >
                          <ItemIcon item={item} atlas={atlas} size={28} />
                          <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                          <span className="font-pixel text-2xs text-muted-foreground">#{item.id}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">{t('requests.cart')}</span>
                {cart.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setCart([])}
                    disabled={submitting}
                  >
                    <X data-icon />
                    {t('requests.clearCart')}
                  </Button>
                )}
              </div>
              {cart.length === 0 ? (
                <Empty size="sm">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <PackagePlus />
                    </EmptyMedia>
                    <EmptyTitle>{t('requests.cartEmpty')}</EmptyTitle>
                    <EmptyDescription>{t('requests.cartEmptyHint')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="flex flex-col gap-2">
                  {cart.map((it) => {
                    const item = itemsById.get(it.id)
                    return (
                      <li
                        key={it.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/40 px-2.5 py-2"
                      >
                        {item ? (
                          <ItemIcon item={item} atlas={atlas} size={26} />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {item?.name ?? t('requests.unknownItem', { id: it.id })}
                        </span>
                        <Input
                          type="number"
                          min={1}
                          max={MAX_STACK}
                          value={it.stack}
                          aria-label={t('requests.qty')}
                          onChange={(e) => setStack(it.id, Number(e.target.value))}
                          className="h-8 w-20"
                        />
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t('requests.remove')}
                          onClick={() => removeItem(it.id)}
                        >
                          <X data-icon />
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <Field>
              <FieldLabel htmlFor="requisition-reason">{t('requests.reason')}</FieldLabel>
              <Textarea
                id="requisition-reason"
                value={reason}
                maxLength={200}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('requests.reasonPlaceholder')}
              />
              <FieldDescription>{t('requests.charCount', { n: reason.length })}</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="requisition-note">{t('requests.note')}</FieldLabel>
              <Input
                id="requisition-note"
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('requests.notePlaceholder')}
              />
            </Field>

            {submitted && (
              <Alert variant="success">
                <AlertDescription>
                  {t('requests.submitted', { id: submitted.id })}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between gap-2">
              <span className="text-2xs text-muted-foreground">{t('requests.submitHint')}</span>
              <Button
                variant="primary"
                onClick={() => void submit()}
                disabled={submitting || cart.length === 0 || !reason.trim()}
              >
                {submitting ? <Spinner data-icon="inline-start" /> : <PackagePlus data-icon />}
                {submitting ? t('requests.submitting') : t('requests.submit')}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* 我的申请 */}
        <Card>
          <CardHeader>
            <CardTitle>{t('requests.listTitle')}</CardTitle>
            <div className="flex items-center gap-2">
              {lastLoadedAt && (
                <span className="hidden text-2xs text-muted-foreground sm:inline">
                  {t('requests.lastUpdated', { time: formatClock(lang, lastLoadedAt) })}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={loading}
                onClick={() => void refreshEverything()}
              >
                <RefreshCw data-icon className={loading ? 'animate-spin' : undefined} />
                {t('requests.refresh')}
              </Button>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {loading && mine.length === 0 ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Spinner /> {t('requests.loading')}
              </div>
            ) : mine.length === 0 ? (
              <Empty size="sm">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ClipboardList />
                  </EmptyMedia>
                  <EmptyTitle>{t('requests.empty')}</EmptyTitle>
                  <EmptyDescription>{t('requests.emptyHint')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              mine.map((record) => (
                <RequisitionCard
                  key={record.id}
                  record={record}
                  mode="mine"
                  itemsById={itemsById}
                  atlas={atlas}
                  busy={loading}
                  onCancel={(r) => void cancel(r)}
                />
              ))
            )}
          </CardBody>
        </Card>
      </div>
    )
  }

  function renderReview() {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            size="sm"
            aria-label={t('requests.filter')}
            value={reviewStatus}
            onChange={(e) => setReviewStatus(e.target.value === 'all' ? 'all' : 'pending')}
          >
            <NativeSelectOption value="pending">{t('requests.filter.pending')}</NativeSelectOption>
            <NativeSelectOption value="all">{t('requests.filter.all')}</NativeSelectOption>
          </NativeSelect>
          <span className="text-2xs text-muted-foreground">
            {t('requests.reviewHint')}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={loading}
            onClick={() => void refreshEverything()}
          >
            <RefreshCw data-icon className={loading ? 'animate-spin' : undefined} />
            {t('requests.refresh')}
          </Button>
        </div>

        {loading && all.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> {t('requests.loading')}
          </div>
        ) : empty ? (
          <Empty size="sm">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardList />
              </EmptyMedia>
              <EmptyTitle>{t('requests.reviewEmpty')}</EmptyTitle>
              <EmptyDescription>{t('requests.reviewEmptyHint')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          all.map((record) => (
            <RequisitionCard
              key={record.id}
              record={record}
              mode="review"
              itemsById={itemsById}
              atlas={atlas}
              busy={reviewBusy}
              onApprove={(r) => void review(r, 'approve')}
              onDeny={(r) => {
                setDenying(r)
                setDenyReason('')
              }}
              onDeliver={(r) => void deliver(r)}
            />
          ))
        )}
      </div>
    )
  }

}
