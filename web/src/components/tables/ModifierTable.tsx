import { Fragment, useState, type ReactNode } from 'react'
import { ListFilter, Search } from 'lucide-react'
import { SearchInput } from '@/components/SearchInput'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import type { ModifierTable as ModifierTableData } from '@/lib/commonTables'
import {
  MODIFIER_GROUPS,
  MODIFIER_STATS,
  type ModifierBenefitId,
  type ModifierGroupId,
  type ModifierStatId,
} from '@/lib/modifiers'
import { dataRowStripe } from '@/lib/tableRowStyles'
import { cn } from '@/lib/cn'
import type { Prefix } from '@/types'

/**
 * 词缀表（Modifiers）：一行一个词缀，列固定、空值显示 `–`。
 *
 * - 显示名不在数据里：按 id 取 `dataset.prefixesById` 的本地化名（语言材质包也能生效）。
 * - 饰品词缀在武器列上没有对应项，`benefit` 单独占「饰品效果」一列。
 * - 正负值用语义色：加绿、减红（和数据 ID、物品提示的写法一致）。
 * - 「备注」只写本地算得出来的事实：同名（不同 id 但同一显示名，靠分组区分）。
 */
export function ModifierTable({
  table,
  prefixesById,
  wikiLink,
}: {
  table: ModifierTableData
  prefixesById: Map<number, Prefix>
  /** 右上角的 wiki 入口（与搜索框同一行、紧挨分组按钮的左边）。 */
  wikiLink?: ReactNode
}) {
  const { t } = useI18n()
  const [groupId, setGroupId] = useState<ModifierGroupId | null>(null)
  const [groupOpen, setGroupOpen] = useState(false)
  const [query, setQuery] = useState('')

  const nameOf = (id: number) => prefixesById.get(id)?.name ?? `#${id}`
  // 同名判定：同一显示名对应多个 id 时，这些行都要提醒（如 传奇 / 传奇 Legendary2）。
  const nameCount = new Map<string, number>()
  for (const row of table.rows) {
    const name = nameOf(row.id)
    nameCount.set(name, (nameCount.get(name) ?? 0) + 1)
  }

  const q = query.trim().toLowerCase()
  const rows = table.rows
    .filter((row) => !groupId || row.groups.includes(groupId))
    .filter(
      (row) =>
        !q ||
        `${nameOf(row.id)} ${row.key}`.toLowerCase().includes(q),
    )
  const countOf = (id: ModifierGroupId | null) =>
    id ? table.rows.filter((row) => row.groups.includes(id)).length : table.rows.length

  const statLabel: Record<ModifierStatId, string> = {
    dmg: t('tables.mod.dmg'),
    speed: t('tables.mod.speed'),
    crit: t('tables.mod.crit'),
    mana: t('tables.mod.mana'),
    size: t('tables.mod.size'),
    velocity: t('tables.mod.velocity'),
    ap: t('tables.mod.ap'),
    tag: t('tables.mod.tag'),
    kb: t('tables.mod.kb'),
  }
  const benefitLabel: Record<ModifierBenefitId, string> = {
    defense: t('tables.benefit.defense'),
    mana: t('tables.benefit.mana'),
    crit: t('tables.benefit.crit'),
    damage: t('tables.benefit.damage'),
    moveSpeed: t('tables.benefit.moveSpeed'),
    meleeSpeed: t('tables.benefit.meleeSpeed'),
  }
  const groupLabel = (id: ModifierGroupId) => t(`tables.group.${id}`)

  // 正负值：加绿、减红；`–` 之类不是数值的走默认色。
  const signed = (value: string) => {
    if (value.startsWith('+')) return 'text-success'
    if (value.startsWith('−') || value.startsWith('-')) return 'text-destructive'
    return 'text-foreground'
  }
  const numberCell = (value: string) => (
    <td
      className={cn('px-2 py-2 text-xs whitespace-nowrap', value ? signed(value) : 'text-muted-foreground/50')}
    >
      {value || '–'}
    </td>
  )

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="w-full max-w-sm min-w-0">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('tables.search.modifier')}
            aria-label={t('tables.search.modifier')}
            leadingIcon={<Search className="size-4 text-muted-foreground" />}
            shortcut
          />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {wikiLink}
          <Popover open={groupOpen} onOpenChange={setGroupOpen}>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="sm" aria-expanded={groupOpen}>
                <ListFilter data-icon="inline-start" />
                {t('commands.groups')}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="end"
              sideOffset={6}
              className="w-56 p-2"
              data-testid="modifier-groups"
            >
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-2xs text-muted-foreground">{t('commands.groups')}</span>
                <span className="max-w-28 truncate text-2xs text-foreground">
                  {groupId ? groupLabel(groupId) : t('tables.groups.all')}
                </span>
              </div>
              <div className="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain">
                <GroupButton
                  active={groupId === null}
                  label={t('tables.groups.all')}
                  count={countOf(null)}
                  onClick={() => {
                    setGroupId(null)
                    setGroupOpen(false)
                  }}
                />
                {MODIFIER_GROUPS.map((id) => (
                  <GroupButton
                    key={id}
                    active={groupId === id}
                    label={groupLabel(id)}
                    count={countOf(id)}
                    onClick={() => {
                      setGroupId(id)
                      setGroupOpen(false)
                    }}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="min-w-0 overflow-clip rounded-container border border-border/60">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-12 z-10 bg-background">
            <tr className="divide-x divide-border/60 border-b border-border/60 bg-muted/50 text-2xs font-semibold text-muted-foreground">
              <th scope="col" className="px-2 py-2 font-medium">
                ID
              </th>
              <th scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                {t('tables.column.name')}
              </th>
              {MODIFIER_STATS.map((id) => (
                <th key={id} scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                  {statLabel[id]}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                {t('tables.mod.benefit')}
              </th>
              <th scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                {t('tables.mod.tier')}
              </th>
              <th scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                {t('tables.mod.value')}
              </th>
              <th scope="col" className="w-full max-w-0 px-2 py-2 font-medium whitespace-nowrap">
                {t('tables.mod.note')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={MODIFIER_STATS.length + 4} className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {t('tables.search.empty')}
                </td>
              </tr>
            )}
            {rows.map((row, index) => {
              const name = nameOf(row.id)
              const duplicated = (nameCount.get(name) ?? 0) > 1
              return (
                <tr
                  key={row.id}
                  className={cn(
                    'divide-x divide-border/60 border-t border-border/40 align-top',
                    dataRowStripe(index),
                  )}
                >
                  <td className="px-2 py-2 text-xs text-muted-foreground">{row.id}</td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap text-foreground">{name}</td>
                  {MODIFIER_STATS.map((id) => (
                    <Fragment key={id}>{numberCell(row.stats[id] ?? '')}</Fragment>
                  ))}
                  <td className="px-2 py-2 text-xs whitespace-nowrap">
                    {row.benefit ? (
                      <span className={signed(`+${row.benefit.value}`)}>
                        {benefitLabel[row.benefit.id]} +{row.benefit.value}
                        {row.benefit.id === 'defense' || row.benefit.id === 'mana' ? '' : '%'}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">–</span>
                    )}
                  </td>
                  {numberCell(row.tier)}
                  {numberCell(row.value)}
                  <td className="w-full max-w-0 px-2 py-2 text-xs text-muted-foreground">
                    <div className="truncate">
                      {duplicated ? t('tables.mod.note.duplicate') : '–'}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** 分组列表的一行：名称 + 条数。 */
function GroupButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-control px-2 py-1 text-left text-xs transition-colors',
        active ? 'bg-accent font-semibold text-foreground' : 'text-foreground hover:bg-accent/60',
      )}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 text-2xs text-muted-foreground">{count}</span>
    </button>
  )
}
