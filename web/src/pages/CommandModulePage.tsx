import { useMemo, useState, type ReactNode } from 'react'
import { NotebookPen, Terminal } from 'lucide-react'
import { LoginGate } from '@/components/LoginGate'
import { PageHelp } from '@/components/PageHelp'
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
          className="min-h-52 flex-1 resize-y rounded-control bg-accent p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
  /** 页面说明正文（世界管理传 `<PluginHelp>`，自定义模块传用户写的纯文本）。 */
  desc?: ReactNode
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
  desc,
  keyPrefix,
  fixedCards,
  pluginName,
}: CommandModulePageProps) {
  const { t } = useI18n()
  const { cards, add, update, remove, reset: resetCards } = useModuleCards(serverId, moduleId)
  // 本页卡片全被隐藏时，把「页面说明」顶出来（页面就不能关它了）。
  const [allHidden, setAllHidden] = useState(false)

  const allCards: PanelCard[] = useMemo(
    () => [
      ...(fixedCards ?? []).map((c) => ({
        id: `fixed:${c.command}`,
        name: t(c.nameKey),
        command: c.command,
        icon: <Terminal />,
        fixed: true,
        manualKey: `${keyPrefix}fixed:${c.command}`,
        defaultManual: c.manual === true,
      })),
      ...cards.map((c) => ({
        id: c.id,
        name: c.name,
        command: c.command,
        icon: <Terminal />,
        custom: true,
        manualKey: `${keyPrefix}${c.id}`,
        // 用户添加的卡片默认**不自动执行**（只能点卡片自己的按钮）。
        defaultManual: true,
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
      {/* 页面说明：顶栏 ⓘ 控制，正文里占满一行（在左右两栏上面）。 */}
      {desc && (
        <PageHelp scopeId={`panel:${keyPrefix}`} forceOpen={allHidden}>
          {desc}
        </PageHelp>
      )}
      {/* 世界管理与自定义模块：卡片按宽度分栏（小 / 大 在左栏，右 进右列）；
          记事本也参与同一套排序 / 宽度（默认在右列），所以交给面板统一渲染。 */}
      <ModuleCardsPanel
        dataset={dataset}
        transport={transport}
        authenticated={authenticated}
        serverId={serverId}
        refreshInterval={refreshInterval}
        onTokenInvalid={onTokenInvalid}
        keyPrefix={keyPrefix}
        cards={allCards}
        onEmptyChange={setAllHidden}
        extra={{
          id: 'notebook',
          name: t('modules.notebook'),
          icon: <NotebookPen />,
          node: <NotebookCard moduleId={moduleId} />,
        }}
        onAddCard={add}
        onUpdateCard={update}
        onRemoveCard={remove}
        onResetCards={resetCards}
        pluginName={pluginName}
      />
    </div>
  )
}
