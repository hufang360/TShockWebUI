/**
 * 「查看世界 → 编辑」里的**图格替换**卡片（W3 安全子集）。
 *
 * 交互刻意做得保守：
 * 1. 只填两个图格 id（旁边实时显示名字与将替换多少格，数量取自缩略图同一次解码的统计）；
 * 2. 点「替换」先弹确认（说明：不可撤销、会生成新文件、服务器正在用要先关服）；
 * 3. 确认后才真正改写字节 → 由父组件下载并刷新预览。
 *
 * 为什么不做"点地图某一格改"：改单格通常要拆 RLE，段长度一变就得重压整段 + 重写指针表 + 同步 footer，
 * 是唯一能造成世界打不开的操作。整类替换不改变 RLE 分组，**文件长度、段指针、footer 全不变**。
 */
import { useState } from 'react'
import { AlertTriangle, Replace } from 'lucide-react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Card, CardBody, Input, Label } from '@/components/ui'
import { useDataset } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'
import type { WorldTileStats } from '@/lib/save/worldThumb'
import { checkTileReplace } from '@/lib/save/worldTileReplace'
import type { ParsedWorld } from '@/lib/save/worldFile'

interface WorldTileReplaceProps {
  world: ParsedWorld
  stats: WorldTileStats
  /** 确认替换后回调（父组件负责写字节、下载、刷新预览）。 */
  onReplace: (from: number, to: number) => void
  disabled?: boolean
}

export function WorldTileReplace({ world, stats, onReplace, disabled }: WorldTileReplaceProps) {
  const { t } = useI18n()
  const dataset = useDataset()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const fromId = Number(from)
  const toId = Number(to)
  const hasBoth = from.trim() !== '' && to.trim() !== '' && Number.isInteger(fromId) && Number.isInteger(toId)
  const validIds = dataset ? new Set(dataset.tiles.entries.map((tile) => tile.id)) : undefined
  const problem = hasBoth ? checkTileReplace(world, fromId, toId, validIds) : null
  const count = hasBoth && !problem && Number.isInteger(fromId) ? (stats.tiles.get(fromId) ?? 0) : 0

  const nameOf = (id: number) =>
    dataset?.tileNameById.get(id) ?? dataset?.tilesById.get(id)?.key ?? `#${id}`

  const reason = problem ? problem.message : count === 0 ? t('wld.replace.none') : null
  const canRun = hasBoth && !problem && count > 0 && !disabled

  return (
    <Card>
      <CardBody className="flex flex-col gap-3 pt-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="text-sm font-medium">{t('wld.replace.title')}</h3>
          <span className="text-2xs text-muted-foreground">{t('wld.replace.hint')}</span>
        </div>

        <div className="grid gap-3 @[520px]:grid-cols-[1fr_auto_1fr]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wld-replace-from">{t('wld.replace.from')}</Label>
            <Input
              id="wld-replace-from"
              type="number"
              inputMode="numeric"
              min={0}
              value={from}
              placeholder={t('wld.replace.idPlaceholder')}
              onChange={(e) => setFrom(e.target.value)}
            />
            <p className="min-h-4 text-2xs text-muted-foreground">
              {from.trim() === '' ? '' : `${nameOf(fromId)}${Number.isInteger(fromId) ? ` · ${(stats.tiles.get(fromId) ?? 0).toLocaleString()} 格` : ''}`}
            </p>
          </div>
          <Replace className="mt-6 hidden size-4 text-muted-foreground @[520px]:block" aria-hidden />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wld-replace-to">{t('wld.replace.to')}</Label>
            <Input
              id="wld-replace-to"
              type="number"
              inputMode="numeric"
              min={0}
              value={to}
              placeholder={t('wld.replace.idPlaceholder')}
              onChange={(e) => setTo(e.target.value)}
            />
            <p className="min-h-4 text-2xs text-muted-foreground">
              {to.trim() === '' ? '' : nameOf(toId)}
            </p>
          </div>
        </div>

        {reason && (
          <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
            <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
            {reason}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <ConfirmButton
            variant="outline"
            size="sm"
            disabled={!canRun}
            title={t('wld.replace.confirmDesc', {
              from: hasBoth ? nameOf(fromId) : '?',
              to: hasBoth ? nameOf(toId) : '?',
              n: count,
            })}
            confirmLabel={t('wld.replace.confirmAction')}
            onConfirm={() => onReplace(fromId, toId)}
          >
            <Replace data-icon="inline-start" />
            {t('wld.replace.action')}
          </ConfirmButton>
          <span className="text-2xs text-muted-foreground tabular-nums">
            {hasBoth && !problem ? t('wld.replace.count', { n: count.toLocaleString() }) : ''}
          </span>
        </div>
      </CardBody>
    </Card>
  )
}
