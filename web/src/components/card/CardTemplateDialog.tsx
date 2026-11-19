import { useEffect, useId, useMemo, useState } from 'react'
import { ChevronLeft, Search, Terminal } from 'lucide-react'
import { ParamValueControl } from '@/components/card/ParamValueField'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import {
  isLiteralArg,
  normalizeLegacyCommand,
  searchCardCommands,
  templateFromSet,
  templateSummary,
  hasValueParams,
  type CardArgMode,
  type CardTemplate,
} from '@/lib/cardParams'
import { cn } from '@/lib/cn'
import { ingameAllowsCommand, type IngamePolicy } from '@/lib/ingame'
import { useI18n } from '@/lib/i18n'
import type { CommandDef, CommandParamSet, Dataset } from '@/types'

/** 弹框提交的结果：`template` 有值 = 参数卡片，否则是普通指令卡片。 */
export interface CardDraft {
  name: string
  /** 基础指令（含前导 `/`）；参数卡片里是 `/<指令名>`。 */
  command: string
  template?: CardTemplate
}

export interface CardTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dataset: Dataset
  /** 哪些 `allowServer=false` 的指令能在网页执行（决定「仅游戏内」提示与能否保存）。 */
  ingame: IngamePolicy
  players?: string[]
  runtimeValues?: { regions?: string[]; warps?: string[] }
  /** 编辑已有卡片：它的名称 / 指令 / 模板。 */
  initial?: { name: string; command: string; template?: CardTemplate }
  onSubmit: (draft: CardDraft) => void
  /** 提交按钮文案（添加 / 保存）。 */
  submitLabel: string
}

type Mode = 'search' | 'command' | 'raw'

/**
 * 添加 / 编辑指令卡片：**从指令库选**（搜索名称 / 别名 / 中文帮助 / 子命令 / 枚举取值），
 * 再按参数表配每个参数的取值策略。
 *
 * 不引入 `{item}` 之类的手写模板语法：参数名、必填、取值都来自 `data/commands.json` 与
 * `lib/commandMeta.ts`，指令库更新后靠 `syntax` 重新对上（对不上时卡片会提示重新配置）。
 *
 * 仍支持直接写一条完整指令（搜索框里输入 `/xxx args` → 「使用…」）：老用法不能丢。
 */
export function CardTemplateDialog({
  open,
  onOpenChange,
  dataset,
  ingame,
  players = [],
  runtimeValues,
  initial,
  onSubmit,
  submitLabel,
}: CardTemplateDialogProps) {
  const { t, lang } = useI18n()
  const baseId = useId()
  const [mode, setMode] = useState<Mode>('search')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<CommandDef | null>(null)
  const [setIndex, setSetIndex] = useState(0)
  const [template, setTemplate] = useState<CardTemplate | null>(null)
  const [name, setName] = useState('')
  const [rawCommand, setRawCommand] = useState('')

  // 每次打开按 `initial` 重置：编辑参数卡片 → 直接进参数页；普通卡片 → 原始指令；新增 → 搜索页。
  useEffect(() => {
    if (!open) return
    const seeded =
      initial?.template != null ? resolveInitial(dataset, initial.template) : null
    if (seeded && initial?.template) {
      setMode('command')
      setPicked(seeded.def)
      setSetIndex(seeded.index)
      setTemplate(sanitizeClone(initial.template))
      setName(initial.name)
      setRawCommand('')
      setQuery('')
      return
    }
    if (initial?.command) {
      setMode('raw')
      setRawCommand(initial.command)
      setName(initial.name)
      setPicked(null)
      setTemplate(null)
      setQuery('')
      return
    }
    setMode('search')
    setQuery('')
    setPicked(null)
    setSetIndex(0)
    setTemplate(null)
    setName('')
    setRawCommand('')
    // 只在打开时重置；`initial` 由调用方在打开前确定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const hits = useMemo(
    () => (mode === 'search' ? searchCardCommands(dataset, query, lang, 40) : []),
    [mode, dataset, query, lang],
  )

  const sets = picked?.paramSets ?? []
  const set = sets[setIndex] ?? null
  /** 搜索框里已经是一条完整指令（`/give 29 张三`）：可以「照原样」建一张普通卡片。 */
  const rawFromQuery = normalizeLegacyCommand(query)
  const rawNormalized = normalizeLegacyCommand(rawCommand)

  /** 选了一条指令：进入参数页，参数表按默认策略铺开。 */
  const pick = (def: CommandDef) => {
    const first = def.paramSets?.[0] ?? null
    setPicked(def)
    setSetIndex(0)
    setTemplate(first ? templateFromSet(def.name, first) : null)
    setName(defaultCardName(def, first))
    setMode('command')
    setQuery('')
  }

  const changeSet = (next: number) => {
    if (!picked) return
    const target = picked.paramSets?.[next]
    if (!target) return
    setSetIndex(next)
    setTemplate(templateFromSet(picked.name, target))
    setName((current) => (current.trim() ? current : defaultCardName(picked, target)))
  }

  const updateArg = (index: number, patch: { mode?: CardArgMode; value?: string }) => {
    setTemplate((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        args: prev.args.map((arg, i) => (i === index ? { ...arg, ...patch } : arg)),
      }
    })
  }

  const inGameOnly = Boolean(
    picked && picked.allowServer === false && !ingameAllowsCommand(ingame, `/${picked.name}`, picked),
  )
  // 没有参数表的指令（/help、/hardmode 这类）照样能建卡片：只是存成普通卡片。
  const canSubmit =
    mode === 'raw'
      ? rawNormalized.length > 0
      : Boolean(picked && !inGameOnly && (set == null || template))

  const submit = () => {
    if (!canSubmit) return
    if (mode === 'raw') {
      onSubmit({ name: name.trim(), command: rawNormalized })
      return
    }
    if (!picked) return
    onSubmit({
      name: name.trim(),
      command: `/${picked.name}`,
      // 只有带参数的用法才存模板：纯字面量的指令（如 `/hardmode`）就是普通卡片。
      template: template && set && hasValueParams(set) ? template : undefined,
    })
  }

  const title = initial ? t('card.editTitle') : t('card.addTitle')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{t('card.searchCommand')}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 py-2">
          {mode === 'search' && (
            <>
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('card.searchPlaceholder')}
                  aria-label={t('card.searchCommand')}
                  className="h-8 pl-7 text-xs"
                />
              </div>

              {rawFromQuery && query.trim().startsWith('/') && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="justify-start"
                  onClick={() => {
                    setRawCommand(rawFromQuery)
                    setMode('raw')
                    setName('')
                  }}
                >
                  <Terminal data-icon="inline-start" />
                  {t('card.useRaw', { cmd: rawFromQuery })}
                </Button>
              )}

              {hits.length === 0 ? (
                <Empty size="sm">
                  <EmptyDescription>{t('card.noMatch')}</EmptyDescription>
                </Empty>
              ) : (
                <ul className="flex flex-col">
                  {hits.map((def) => {
                    const blocked =
                      def.allowServer === false &&
                      !ingameAllowsCommand(ingame, `/${def.name}`, def)
                    return (
                      <li key={def.name}>
                        <button
                          type="button"
                          onClick={() => pick(def)}
                          className={cn(
                            'flex w-full cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-left',
                            'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                          )}
                        >
                          <code className="shrink-0 font-pixel text-xs text-foreground">
                            /{def.name}
                          </code>
                          <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                            {(def.helpZh ?? def.help) || def.aliases.join(' ')}
                          </span>
                          {blocked && (
                            <Badge tone="neutral" className="shrink-0">
                              {t('card.inGameOnly')}
                            </Badge>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}

          {mode === 'command' && picked && (
            <>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="font-pixel text-sm font-semibold text-foreground">
                      /{picked.name}
                    </code>
                    {inGameOnly && <Badge tone="warn">{t('card.inGameOnly')}</Badge>}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">
                    {(picked.helpZh ?? picked.help) || ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => {
                    setMode('search')
                    setQuery('')
                  }}
                >
                  <ChevronLeft data-icon="inline-start" />
                  {t('card.changeCommand')}
                </Button>
              </div>

              {inGameOnly && (
                <p className="rounded-container bg-warning/10 px-2 py-1.5 text-2xs text-warning">
                  {t('card.inGameOnlyHint', { cmd: `/${picked.name}` })}
                </p>
              )}

              {sets.length > 1 && (
                <Field className="gap-1">
                  <FieldLabel htmlFor={`${baseId}-set`} className="text-2xs text-muted-foreground">
                    {t('card.setLabel')}
                  </FieldLabel>
                  <Select value={String(setIndex)} onValueChange={(v) => changeSet(Number(v))}>
                    <SelectTrigger id={`${baseId}-set`} size="sm" className="w-full font-pixel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sets.map((s, index) => (
                        <SelectItem key={s.syntax} value={String(index)} className="font-pixel">
                          {s.syntax}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {set && template && (
                <div className="flex flex-col gap-2">
                  <p className="font-pixel text-2xs text-muted-foreground">
                    {templateSummary(set)}
                  </p>
                  {set.args.map((arg, index) => {
                    const state = template.args[index]
                    if (!state) return null
                    if (isLiteralArg(arg)) {
                      // 字面子命令：必填的直接写进指令，可选的给「带上 / 不传」。
                      return (
                        <div key={index} className="flex items-center gap-2">
                          <code className="flex-1 font-pixel text-xs text-foreground">
                            {arg.literal}
                          </code>
                          {arg.required === false && (
                            <ModeSelect
                              value={state.mode === 'omit' ? 'omit' : 'fixed'}
                              options={['fixed', 'omit']}
                              onChange={(next) => updateArg(index, { mode: next })}
                              ariaLabel={`${arg.literal}`}
                            />
                          )}
                        </div>
                      )
                    }
                    return (
                      <div
                        key={index}
                        className="flex flex-col gap-1 rounded-container bg-accent/30 p-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-2xs font-medium text-foreground">
                            {arg.name ?? `#${index + 1}`}
                          </span>
                          <ModeSelect
                            value={state.mode}
                            options={
                              arg.required ? ['fill', 'fixed'] : ['fill', 'fixed', 'omit']
                            }
                            onChange={(next) => updateArg(index, { mode: next })}
                            ariaLabel={`${arg.name ?? `#${index + 1}`} · ${t('card.modeLabel')}`}
                          />
                        </div>
                        {state.mode !== 'omit' && (
                          <ParamValueControl
                            id={`${baseId}-arg-${index}`}
                            dataset={dataset}
                            command={picked}
                            arg={arg}
                            value={state.value}
                            onChange={(next) => updateArg(index, { value: next })}
                            players={players}
                            runtimeValues={runtimeValues}
                            label={arg.name ?? `#${index + 1}`}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {mode === 'raw' && (
            <Field className="gap-1">
              <FieldLabel htmlFor={`${baseId}-raw`} className="text-2xs text-muted-foreground">
                {t('card.commandLabel')}
              </FieldLabel>
              <Input
                id={`${baseId}-raw`}
                autoFocus
                value={rawCommand}
                onChange={(e) => setRawCommand(e.target.value)}
                placeholder="/give 29 玩家名 10"
                className="h-8 font-pixel text-xs"
              />
            </Field>
          )}

          {mode !== 'search' && (
            <Field className="gap-1">
              <FieldLabel htmlFor={`${baseId}-name`} className="text-2xs text-muted-foreground">
                {t('card.nameLabel')}
              </FieldLabel>
              <Input
                id={`${baseId}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('card.namePlaceholder')}
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
              />
            </Field>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('action.cancel')}
          </Button>
          <Button size="sm" variant="primary" disabled={!canSubmit} onClick={submit}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const MODE_LABEL_KEY: Record<CardArgMode, string> = {
  fill: 'card.modeFill',
  fixed: 'card.modeFixed',
  omit: 'card.modeOmit',
}

function ModeSelect({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: CardArgMode
  options: CardArgMode[]
  onChange: (next: CardArgMode) => void
  ariaLabel: string
}) {
  const { t } = useI18n()
  return (
    <Select value={value} onValueChange={(next) => onChange(next as CardArgMode)}>
      <SelectTrigger size="sm" className="w-24 shrink-0" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {t(MODE_LABEL_KEY[option])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** 默认卡片名：`/指令名 子命令`（子命令取用法串里第一个字面量）。 */
function defaultCardName(def: CommandDef, set: CommandParamSet | null): string {
  const literal = set?.args.find((arg) => isLiteralArg(arg))?.literal
  return literal ? `/${def.name} ${literal}` : `/${def.name}`
}

/** 编辑时把模板对回指令库（取指令 + 用法下标）。 */
function resolveInitial(
  dataset: Dataset,
  template: CardTemplate,
): { def: CommandDef; index: number } | null {
  const def = dataset.commandsByToken.get(template.command)
  if (!def) return null
  const index = def.paramSets?.findIndex((s) => s.syntax === template.syntax) ?? -1
  if (!def.paramSets || index < 0) return null
  if (def.paramSets[index]?.args.length !== template.args.length) return null
  return { def, index }
}

function sanitizeClone(template: CardTemplate): CardTemplate {
  return { ...template, args: template.args.map((arg) => ({ ...arg })) }
}
