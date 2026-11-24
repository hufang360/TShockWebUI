import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Terminal } from 'lucide-react'
import { CardParamForm } from '@/components/card/CardParamForm'
import { CommandCard } from '@/components/CommandCard'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui'
import { buildCardCommand, cardRunState, hasFillParams, type CardTemplate } from '@/lib/cardParams'
import { useI18n } from '@/lib/i18n'
import type { Atlas, CommandResult, Dataset, Item, Prefix } from '@/types'

/** 卡片最少需要的信息（首页 / 模块 / 鱼店三处自定义卡片共用的存储形态）。 */
export interface CustomCardData {
  id: string
  name: string
  command: string
  template?: CardTemplate
}

export interface CustomCommandCardProps {
  card: CustomCardData
  dataset: Dataset
  title: string
  icon?: ReactNode
  result?: CommandResult
  loading?: boolean
  unavailable?: boolean
  unavailableText?: ReactNode
  emptyText?: ReactNode
  action?: 'refresh' | 'run'
  /** 执行：传入最终指令（普通卡片是原文，参数卡片是拼好的）。 */
  onRun: (command: string) => void
  /** 参数卡片的值变了（失焦 / 停止输入后写回存储）。 */
  onTemplateChange?: (template: CardTemplate) => void
  collapseKey: string
  players?: string[]
  runtimeValues?: { regions?: string[]; warps?: string[] }
  footerNote?: ReactNode
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
  className?: string
}

/**
 * 用户自己添加的卡片：普通指令卡片 / 参数卡片 / 模板失效三种形态。
 *
 * 参数卡片的输入值既是「这次要执行的参数」也是「下次打开时的默认值」：
 * 本地立即生效（点执行就用），停止输入后再写回 localStorage（不逐键写整份存储）。
 */
export function CustomCommandCard({
  card,
  dataset,
  title,
  icon,
  result,
  loading,
  unavailable,
  unavailableText,
  emptyText,
  action = 'run',
  onRun,
  onTemplateChange,
  collapseKey,
  players = [],
  runtimeValues,
  footerNote,
  itemsById,
  prefixesById,
  atlas,
  className,
}: CustomCommandCardProps) {
  const { t } = useI18n()
  const template = card.template
  /** 参数值的本地草稿（只对 `fill` 参数有意义）。 */
  const [draft, setDraft] = useState<string[]>(() => template?.args.map((a) => a.value) ?? [])
  // 换了卡片 / 换了用法形态才重置草稿；值写回存储时不重置（否则输入框会跳字）。
  const draftKey = `${card.id}:${template?.syntax ?? ''}`
  const draftKeyRef = useRef(draftKey)
  useEffect(() => {
    if (draftKeyRef.current === draftKey) return
    draftKeyRef.current = draftKey
    setDraft(template?.args.map((a) => a.value) ?? [])
  }, [draftKey, template])

  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current)
    },
    [],
  )

  const state = cardRunState(dataset, card)

  if (template && state.broken) {
    return (
      <Card className={className} data-command={`/${template.command}`}>
        <CardHeader>
          <Terminal aria-hidden />
          <CardTitle className="min-w-0 truncate">{title}</CardTitle>
        </CardHeader>
        <CardBody className="flex-1">
          <p className="text-xs text-warning">{t('card.templateChanged')}</p>
        </CardBody>
      </Card>
    )
  }

  if (!template) {
    if (!state.command) {
      return (
        <Card className={className}>
          <CardHeader>
            {icon ?? <Terminal aria-hidden />}
            <CardTitle className="min-w-0 truncate">{title}</CardTitle>
          </CardHeader>
          <CardBody className="flex-1">
            <p className="text-xs text-warning">{t('home.customUnset')}</p>
          </CardBody>
        </Card>
      )
    }
    return (
      <CommandCard
        className={className}
        title={title}
        icon={icon ?? <Terminal />}
        command={state.command}
        result={result}
        loading={loading}
        unavailable={unavailable}
        unavailableText={unavailableText}
        emptyText={emptyText}
        footerNote={footerNote}
        action={action}
        collapseKey={collapseKey}
        onRefresh={unavailable ? undefined : () => onRun(state.command as string)}
        itemsById={itemsById}
        prefixesById={prefixesById}
        atlas={atlas}
      />
    )
  }

  const resolved = state.resolved as NonNullable<typeof state.resolved>
  /** 用当前草稿拼一份临时模板：执行与预览都用它（不必等写回存储）。 */
  const liveTemplate: CardTemplate = {
    ...template,
    args: template.args.map((arg, index) => ({ ...arg, value: draft[index] ?? arg.value })),
  }
  const built = buildCardCommand(liveTemplate, resolved.set)
  const ready = built.missing.length === 0
  const showForm = hasFillParams(template)

  const setValue = (index: number, value: string) => {
    const next = draft.map((v, i) => (i === index ? value : v))
    setDraft(next)
    if (!onTemplateChange) return
    // 停止输入再落盘：每敲一个键都写整份 localStorage 没必要。
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      onTemplateChange({
        ...template,
        args: template.args.map((arg, i) => ({ ...arg, value: next[i] ?? arg.value })),
      })
    }, 400)
  }

  return (
    <CommandCard
      className={className}
      title={title}
      icon={icon ?? <Terminal />}
      command={built.command}
      result={result}
      loading={loading}
      unavailable={unavailable}
      unavailableText={unavailableText}
      emptyText={emptyText}
      // 没有输入框可「贴在下面」的参数卡片（全固定值）：预览仍放页脚，别把它弄丢。
      footerNote={
        footerNote ??
        (showForm ? undefined : (
          <code
            className="min-w-0 truncate font-pixel text-2xs text-muted-foreground"
            data-testid="card-command-preview"
            title={built.command}
          >
            {built.command}
          </code>
        ))
      }
      action={action}
      collapseKey={collapseKey}
      runDisabled={!ready}
      paramForm={
        showForm ? (
          // 参数在右、指令在左：一行就能读完「这张卡跑什么 + 还有哪些值要填」，
          // 所以不再另起一行放完整指令预览。左边跟随草稿实时拼出最终指令（没填参数时就是 `/help` 本身）。
          <div className="flex min-w-0 items-center gap-2">
            <code
              className="min-w-20 flex-1 truncate font-pixel text-2xs text-muted-foreground"
              data-testid="card-command-preview"
              title={built.command}
            >
              {built.command}
            </code>
            <CardParamForm
              dataset={dataset}
              command={resolved.def}
              set={resolved.set}
              template={liveTemplate}
              onChange={setValue}
              players={players}
              runtimeValues={runtimeValues}
              missing={built.missing}
              disabled={unavailable}
            />
          </div>
        ) : undefined
      }
      // 参数没填也保留按钮（灰着）：让玩家看得见「这里有东西可以点，只是还没填完」。
      onRefresh={unavailable ? undefined : () => ready && onRun(built.command)}
      itemsById={itemsById}
      prefixesById={prefixesById}
      atlas={atlas}
    />
  )
}
