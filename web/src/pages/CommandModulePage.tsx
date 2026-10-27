import { useMemo, useState } from 'react'
import { LoginGate } from '@/components/LoginGate'
import { ModuleCardsPanel, type PanelCard } from '@/components/ModuleCardsPanel'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui'
import { useModuleCards } from '@/hooks/useModuleCards'
import { useI18n } from '@/lib/i18n'
import { readJson, writeJson } from '@/lib/storage'
import type { BackendTransport } from '@/lib/tshock'
import type { Dataset } from '@/types'

export interface FixedCardDef {
  nameKey: string
  command: string
  /** 默认手动执行（不随自动 / 刷新全部执行）。 */
  manual?: boolean
}

/** 自定义模块右侧的「记事本」：内容按模块存本机。 */
function NotebookCard({ moduleId }: { moduleId: string }) {
  const { t } = useI18n()
  const key = `moduleNotes:${moduleId}` as Parameters<typeof readJson>[0]
  const [notes, setNotes] = useState(() => readJson<string>(key, ''))
  return (
    <Card className="flex min-h-64 flex-col xl:sticky xl:top-4 xl:self-start">
      <CardHeader className="shrink-0">
        <CardTitle>{t('modules.notebook')}</CardTitle>
      </CardHeader>
      <CardBody className="flex min-h-0 flex-1 flex-col">
        <textarea
          id={`module-notes-${moduleId}`}
          name={`module-notes-${moduleId}`}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
            writeJson(key, e.target.value)
          }}
          placeholder={t('modules.notebookPlaceholder')}
          aria-label={t('modules.notebook')}
          className="min-h-52 flex-1 resize-y rounded-lg bg-accent p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </CardBody>
    </Card>
  )
}

interface CommandModulePageProps {
  dataset: Dataset
  transport: BackendTransport
  authenticated: boolean
  serverId: string
  refreshInterval: number
  onTokenInvalid: () => Promise<boolean>
  /** 未登录时点「登录」打开登录框。 */
  onLogin: () => void
  /** 卡片存储所属模块 id（`world` / `m:<uuid>`）。 */
  moduleId: string
  title: string
  desc?: string
  /** 结果 key 前缀，避免不同模块冲突。 */
  keyPrefix: string
  /** 固定卡片（不可删除）。 */
  fixedCards?: FixedCardDef[]
  /** 固定卡片依赖的第三方插件名（如 `WorldModify`）：指令不存在时提示未安装。 */
  pluginName?: string
}

/** 通用「指令卡片模块」页：世界管理 / 自定义模块共用。 */
export function CommandModulePage({
  dataset,
  transport,
  authenticated,
  serverId,
  refreshInterval,
  onTokenInvalid,
  onLogin,
  moduleId,
  title,
  desc,
  keyPrefix,
  fixedCards,
  pluginName,
}: CommandModulePageProps) {
  const { t } = useI18n()
  const { cards, add, update, remove } = useModuleCards(serverId, moduleId)

  const allCards: PanelCard[] = useMemo(
    () => [
      ...(fixedCards ?? []).map((c) => ({
        id: `fixed:${c.command}`,
        name: t(c.nameKey),
        command: c.command,
        fixed: true,
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

  // 未登录：隐藏卡片列表（执行指令需要 token），只留登录提示。
  if (!authenticated) {
    return <LoginGate onLogin={onLogin} />
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 世界管理与自定义模块统一为两栏：左 = 指令卡片，右 = 记事本。 */}
      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <ModuleCardsPanel
            dataset={dataset}
            transport={transport}
            authenticated={authenticated}
            serverId={serverId}
            refreshInterval={refreshInterval}
            onTokenInvalid={onTokenInvalid}
            keyPrefix={keyPrefix}
            title={title}
            desc={desc}
            cards={allCards}
            onAddCard={add}
            onUpdateCard={update}
            onRemoveCard={remove}
            pluginName={pluginName}
          />
        </div>
        <NotebookCard moduleId={moduleId} />
      </div>
    </div>
  )
}
