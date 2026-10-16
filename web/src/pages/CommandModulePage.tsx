import { useMemo } from 'react'
import { ModuleCardsPanel, type PanelCard } from '@/components/ModuleCardsPanel'
import { useModuleCards } from '@/hooks/useModuleCards'
import { useI18n } from '@/lib/i18n'
import type { BackendTransport } from '@/lib/tshock'
import type { Dataset } from '@/types'

export interface FixedCardDef {
  nameKey: string
  command: string
  /** 默认手动执行（不随自动 / 刷新全部执行）。 */
  manual?: boolean
}

interface CommandModulePageProps {
  dataset: Dataset
  transport: BackendTransport
  authenticated: boolean
  serverId: string
  refreshInterval: number
  onTokenInvalid: () => Promise<boolean>
  /** 卡片存储所属模块 id（`world` / `m:<uuid>`）。 */
  moduleId: string
  title: string
  desc?: string
  /** 结果 key 前缀，避免不同模块冲突。 */
  keyPrefix: string
  /** 固定卡片（不可删除）。 */
  fixedCards?: FixedCardDef[]
}

/** 通用「指令卡片模块」页：世界管理 / 自定义模块共用。 */
export function CommandModulePage({
  dataset,
  transport,
  authenticated,
  serverId,
  refreshInterval,
  onTokenInvalid,
  moduleId,
  title,
  desc,
  keyPrefix,
  fixedCards,
}: CommandModulePageProps) {
  const { t } = useI18n()
  const { cards, add, remove } = useModuleCards(serverId, moduleId)

  const allCards: PanelCard[] = useMemo(
    () => [
      ...(fixedCards ?? []).map((c) => ({
        id: `fixed:${c.command}`,
        name: t(c.nameKey),
        command: c.command,
        manualKey: `${keyPrefix}fixed:${c.command}`,
        defaultManual: c.manual === true,
      })),
      ...cards.map((c) => ({
        id: c.id,
        name: c.name,
        command: c.command,
        custom: true,
        manualKey: `${keyPrefix}${c.id}`,
      })),
    ],
    [fixedCards, cards, t, keyPrefix],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      <ModuleCardsPanel
        dataset={dataset}
        transport={transport}
        authenticated={authenticated}
        serverId={serverId}
        refreshInterval={refreshInterval}
        onTokenInvalid={onTokenInvalid}
        keyPrefix={keyPrefix}
        title={t('modules.cards.title')}
        cards={allCards}
        onAddCard={add}
        onRemoveCard={remove}
      />
    </div>
  )
}
