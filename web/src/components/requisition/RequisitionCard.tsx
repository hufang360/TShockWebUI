import { Check, PackageCheck, Trash2, X } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Badge, Button, Card, CardBody } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import type { Requisition, RequisitionStatus } from '@/lib/transport'
import type { Atlas, Item } from '@/types'

interface RequisitionCardProps {
  record: Requisition
  mode: 'mine' | 'review'
  itemsById: Map<number, Item>
  atlas?: Atlas | null
  busy?: boolean
  onCancel?: (record: Requisition) => void
  onApprove?: (record: Requisition) => void
  onDeny?: (record: Requisition) => void
  onDeliver?: (record: Requisition) => void
}

const STATUS_TONE: Record<RequisitionStatus, 'neutral' | 'warn' | 'mock' | 'success' | 'danger'> = {
  pending: 'warn',
  approved: 'mock',
  delivered: 'success',
  denied: 'danger',
  cancelled: 'neutral',
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

/** 一条物资申请：物品图标行 + 用途 / 备注 + 状态与操作。 */
export function RequisitionCard({
  record,
  mode,
  itemsById,
  atlas,
  busy,
  onCancel,
  onApprove,
  onDeny,
  onDeliver,
}: RequisitionCardProps) {
  const { t } = useI18n()
  const actions =
    mode === 'review' && (record.status === 'pending' || record.status === 'approved')

  return (
    <Card className="border border-border/50">
      <CardBody className="flex flex-col gap-2 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">#{record.id}</span>
          <Badge tone={STATUS_TONE[record.status] ?? 'neutral'}>
            {t(`requests.status.${record.status}`)}
          </Badge>
          {mode === 'review' && (
            <span className="text-xs text-muted-foreground">{record.player}</span>
          )}
          {record.deliveryError && (
            <Badge tone="danger">{t('requests.deliveryError', { msg: record.deliveryError })}</Badge>
          )}
          <span className="ml-auto text-2xs text-muted-foreground">{formatTime(record.createdAt)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {(record.items ?? []).map((it) => {
            const item = itemsById.get(it.id)
            return (
              <span key={it.id} className="inline-flex items-center gap-1.5">
                {item ? (
                  <ItemIcon item={item} atlas={atlas ?? undefined} size={22} />
                ) : (
                  <span className="text-2xs text-muted-foreground">#{it.id}</span>
                )}
                <span className="text-xs text-foreground/90">{item?.name ?? t('requests.unknownItem', { id: it.id })}</span>
                <span className="text-2xs text-muted-foreground">x{it.stack}</span>
              </span>
            )
          })}
        </div>

        <p className="text-xs whitespace-pre-wrap text-foreground/90">{record.reason}</p>
        {record.note && <p className="text-2xs text-muted-foreground">{record.note}</p>}

        {(record.reviewedBy || record.denyReason) && (
          <div className="flex flex-col gap-0.5 text-2xs text-muted-foreground">
            {record.reviewedBy && (
              <span>
                {t('requests.reviewedBy', {
                  name: record.reviewedBy,
                  time: formatTime(record.reviewedAt),
                })}
              </span>
            )}
            {record.denyReason && (
              <span className="text-destructive">
                {t('requests.denyReasonLabel', { reason: record.denyReason })}
              </span>
            )}
          </div>
        )}

        {actions && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {record.status === 'pending' && (
              <>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => onApprove?.(record)}>
                  <Check data-icon />
                  {t('requests.approve')}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onDeny?.(record)}>
                  <X data-icon />
                  {t('requests.deny')}
                </Button>
              </>
            )}
            {record.status === 'approved' && (
              <Button size="sm" variant="primary" disabled={busy} onClick={() => onDeliver?.(record)}>
                <PackageCheck data-icon />
                {t('requests.deliver')}
              </Button>
            )}
          </div>
        )}

        {mode === 'mine' && record.status === 'pending' && onCancel && (
          <div className="flex justify-end pt-1">
            <ConfirmButton
              size="sm"
              variant="ghost"
              confirmLabel={t('requests.cancelConfirm')}
              onConfirm={() => onCancel(record)}
              disabled={busy}
              icon={<Trash2 data-icon />}
            >
              {t('requests.cancel')}
            </ConfirmButton>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
