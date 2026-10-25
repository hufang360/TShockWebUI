import { Fragment, useMemo, useState } from 'react'
import { ExternalLink, Terminal } from 'lucide-react'
import { CommandPickerPanel } from '@/components/CommandPickerPanel'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import { readDataIdState, rememberDataIdState } from '@/lib/dataIdState'
import { useI18n } from '@/lib/i18n'
import {
  SPAWN_BOSS_TIPS,
  SPAWN_MOB_EXAMPLES,
  TP_NPC_EXAMPLES,
  spawnBossCommand,
  spawnMobCommand,
  tpNpcCommand,
} from '@/lib/spawnTips'
import { useTerminal } from '@/lib/terminalContext'
import {
  GODMODE_COMMANDS,
  HOLIDAY_COMMANDS,
  SPAWN_RATE_COMMANDS,
  TIME_WIND_COMMANDS,
  WORLD_EVENT_COMMANDS,
  WORLD_INVASION_COMMANDS,
  WORLD_MODE_COMMANDS,
  type CommandTip,
} from '@/lib/worldCommandTips'
import { cn } from '@/lib/cn'
import type { Dataset, Npc, TabId } from '@/types'

interface CommandTipsPageProps {
  dataset: Dataset
  /** 「数据 ID → NPC」入口（查更多 NPC / 名称）。 */
  onNavigate: (tab: TabId) => void
  /** 点条目后的去向；默认填进浮动终端，指令页里改为填进页面输入框。 */
  onPick?: (command: string) => void
}

interface TableRow {
  command: string
  label: string
  note?: string
}

/**
 * 指令表格：**指令在第一列**，后面是名称 / 备注，最后一列「填入」按钮。
 *
 * - 整行可点（点击即填入浮窗），按钮同时提供键盘 / 读屏入口；
 * - 表格在卡片内滚动（`maxHeight`），行多也不会把页面撑长；
 * - 有分组时用 `colgroup` 行隔开（如「事件 / 入侵 / 节日」）。
 */
function CommandTable({
  groups,
  maxHeight = 'max-h-[26rem]',
  onPick,
}: {
  groups: { title?: string; rows: TableRow[] }[]
  maxHeight?: string
  onPick: (command: string) => void
}) {
  const { t } = useI18n()
  const hasNote = groups.some((group) => group.rows.some((row) => row.note))
  const columnCount = hasNote ? 4 : 3
  return (
    <div
      className={cn(
        'min-h-0 overflow-y-auto overscroll-contain rounded-lg border border-border/50',
        maxHeight,
      )}
    >
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="text-2xs text-muted-foreground">
            <th scope="col" className="px-2 py-1.5 font-medium">
              {t('commands.col.command')}
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              {t('commands.col.name')}
            </th>
            {hasNote && (
              <th scope="col" className="hidden px-2 py-1.5 font-medium sm:table-cell">
                {t('commands.col.note')}
              </th>
            )}
            <th scope="col" className="w-9 px-1 py-1.5">
              <span className="sr-only">{t('commands.col.fill')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group, groupIndex) => (
            <Fragment key={group.title ?? groupIndex}>
              {group.title && (
                <tr className="bg-accent/40">
                  <th
                    scope="colgroup"
                    colSpan={columnCount}
                    className="px-2 py-1 text-left text-2xs font-medium text-muted-foreground"
                  >
                    {group.title}
                  </th>
                </tr>
              )}
              {group.rows.map((row) => (
                <tr
                  key={row.command}
                  onClick={() => onPick(row.command)}
                  className="cursor-pointer border-t border-border/40 align-top transition-colors hover:bg-accent/50"
                >
                  <td
                    className="max-w-[18rem] truncate px-2 py-1.5 font-mono text-xs text-foreground"
                    title={row.command}
                  >
                    {row.command}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-foreground">{row.label}</td>
                  {hasNote && (
                    <td className="hidden px-2 py-1.5 text-2xs text-muted-foreground sm:table-cell">
                      {row.note ?? ''}
                    </td>
                  )}
                  <td className="px-1 py-0.5 text-right">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`${t('commands.col.fill')}：${row.command}`}
                      title={row.command}
                      onClick={(event) => {
                        event.stopPropagation()
                        onPick(row.command)
                      }}
                    >
                      <Terminal className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 一张「用法」卡：标题 + 语法 + 指令表格。 */
function TipsCard({
  title,
  usage,
  groups,
  footnote,
  maxHeight,
  onPick,
}: {
  title: string
  usage: string
  groups: { title?: string; rows: CommandTip[] }[]
  footnote?: string
  maxHeight?: string
  onPick: (command: string) => void
}) {
  const { lang } = useI18n()
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-wrap">
        <CardTitle>{title}</CardTitle>
        <span className="font-pixel text-2xs text-muted-foreground">{usage}</span>
      </CardHeader>
      <CardBody className="flex flex-col gap-2 pb-3">
        <CommandTable
          maxHeight={maxHeight}
          onPick={onPick}
          groups={groups.map((group) => ({
            title: group.title,
            rows: group.rows.map((row) => ({ command: row.command, label: row.label[lang] })),
          }))}
        />
        {footnote && <p className="text-2xs text-muted-foreground">{footnote}</p>}
      </CardBody>
    </Card>
  )
}

/**
 * 指令小抄（侧边栏「查询」分组）：`/worldevent`、`/worldmode`、`/time` 等世界操作，
 * 以及 `/spawnboss`、`/spawnmob`、`/tpnpc`、`/maxspawns`、`/godmode` 等 NPC 操作。
 *
 * 页面只**生成指令**：点一行把完整指令覆盖到右下角「指令」浮窗（不自动执行），
 * 权限与执行结果都由 TShock 判定（这些指令都是 `allowServer=true`，可以在浮窗里直接跑）。
 */
export function CommandTipsPage({ dataset, onNavigate, onPick }: CommandTipsPageProps) {
  const { t, lang } = useI18n()
  const { open } = useTerminal()
  const pick = onPick ?? open
  const [tab, setTab] = useState<'default' | 'npc' | 'library'>('default')

  // `sb` → NPC：用于取本地化名称（`/spawnboss` 的规范参数已在生成数据里）。
  const bySb = useMemo(() => {
    const map = new Map<string, Npc>()
    for (const npc of dataset.npcsById.values()) {
      if (npc.sb) map.set(npc.sb, npc)
    }
    return map
  }, [dataset])

  // 示例按钮按 `NPCID` 常量名解析（数据里没有就跳过，绝不瞎编 ID）。
  const byKey = useMemo(() => {
    const map = new Map<string, Npc>()
    for (const npc of dataset.npcs) map.set(npc.key, npc)
    return map
  }, [dataset])

  const bosses = useMemo(
    () =>
      SPAWN_BOSS_TIPS.map((tip) => {
        const npc = bySb.get(tip.sb)
        return {
          command: spawnBossCommand(tip.sb),
          label: tip.name?.[lang] ?? npc?.name ?? tip.sb,
          note: tip.note?.[lang],
        }
      }),
    [bySb, lang],
  )

  const mobExamples = SPAWN_MOB_EXAMPLES.map((key) => byKey.get(key)).filter(
    (npc): npc is Npc => Boolean(npc),
  )
  const tpExamples = TP_NPC_EXAMPLES.map((key) => byKey.get(key)).filter(
    (npc): npc is Npc => Boolean(npc),
  )

  /** 跳到「数据 ID」的 NPC tab（查全部 NPC 与名称）。 */
  const openDataIdNpc = () => {
    rememberDataIdState({ ...readDataIdState(), kind: 'npc', npcFilter: '', scrollTop: 0 })
    onNavigate('dataid')
  }

  const notice = (
    <Alert variant="info">
      <AlertDescription className="flex flex-col gap-1 text-xs">
        <span>{t('commands.notice.perm')}</span>
        <span>{t('commands.notice.fill')}</span>
      </AlertDescription>
    </Alert>
  )

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="w-full gap-4">
      <TabsList variant="line" className="w-full justify-start">
        <TabsTrigger value="default" variant="line" className="flex-none">
          {t('commands.tab.default')}
        </TabsTrigger>
        <TabsTrigger value="npc" variant="line" className="flex-none">
          {t('commands.tab.npc')}
        </TabsTrigger>
        <TabsTrigger value="library" variant="line" className="flex-none">
          {t('editor.tab.commands')}
        </TabsTrigger>
      </TabsList>

      {/* 默认：世界事件 / 世界模式 / 时间·风·世界信息 */}
      <TabsContent value="default" className="flex flex-col gap-3">
        {notice}
        <div className="grid gap-4 xl:grid-cols-2">
          <TipsCard
            title={t('commands.card.event')}
            usage={t('commands.card.event.usage')}
            groups={[
              { title: t('commands.group.events'), rows: WORLD_EVENT_COMMANDS },
              { title: t('commands.group.invasions'), rows: WORLD_INVASION_COMMANDS },
              { title: t('commands.group.holiday'), rows: HOLIDAY_COMMANDS },
            ]}
            onPick={pick}
          />
          <TipsCard
            title={t('commands.card.world')}
            usage={t('commands.card.world.usage')}
            groups={[{ rows: WORLD_MODE_COMMANDS }]}
            onPick={pick}
          />
          <TipsCard
            title={t('commands.card.time')}
            usage={t('commands.card.time.usage')}
            groups={[{ rows: TIME_WIND_COMMANDS }]}
            onPick={pick}
          />
        </div>
      </TabsContent>

      {/* NPC管理：召唤 Boss / 召唤 NPC / 传送 NPC / 刷怪率 / 无敌 */}
      <TabsContent value="npc" className="flex flex-col gap-3">
        {notice}
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader className="flex-wrap">
              <CardTitle>{t('spawn.boss.title')}</CardTitle>
              <span className="font-pixel text-2xs text-muted-foreground">
                {t('spawn.boss.usage')}
              </span>
            </CardHeader>
            <CardBody className="pb-3">
              <CommandTable
                groups={[{ rows: bosses }]}
                maxHeight="max-h-[30rem]"
                onPick={pick}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex-wrap">
              <CardTitle>{t('spawn.mob.title')}</CardTitle>
              <span className="font-pixel text-2xs text-muted-foreground">
                {t('spawn.mob.usage')}
              </span>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {mobExamples.map((npc) => (
                  <Button
                    key={npc.id}
                    variant="secondary"
                    size="sm"
                    onClick={() => pick(spawnMobCommand(npc.id))}
                  >
                    {npc.name}
                    <span className="font-pixel text-2xs text-muted-foreground">#{npc.id}</span>
                  </Button>
                ))}
              </div>
              <p className="text-2xs text-muted-foreground">{t('spawn.mob.hint')}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex-wrap">
              <CardTitle>{t('spawn.tp.title')}</CardTitle>
              <span className="font-pixel text-2xs text-muted-foreground">
                {t('spawn.tp.usage')}
              </span>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {tpExamples.map((npc) => (
                  <Button
                    key={npc.id}
                    variant="secondary"
                    size="sm"
                    onClick={() => pick(tpNpcCommand(npc))}
                  >
                    {npc.name}
                    <span className="font-pixel text-2xs text-muted-foreground">#{npc.id}</span>
                  </Button>
                ))}
              </div>
              <p className="text-2xs text-muted-foreground">{t('spawn.tp.hint')}</p>
              <Button
                variant="ghost"
                size="sm"
                className="self-start px-1 text-muted-foreground"
                onClick={openDataIdNpc}
              >
                <ExternalLink data-icon="inline-start" />
                {t('spawn.tp.moreNpcs')}
              </Button>
            </CardBody>
          </Card>

          <TipsCard
            title={t('commands.card.spawnrate')}
            usage={t('commands.card.spawnrate.usage')}
            groups={[{ rows: SPAWN_RATE_COMMANDS }]}
            onPick={pick}
          />
          <TipsCard
            title={t('commands.card.godmode')}
            usage={t('commands.card.godmode.usage')}
            groups={[{ rows: GODMODE_COMMANDS }]}
            footnote={t('commands.card.godmode.footnote')}
            onPick={pick}
          />
        </div>
      </TabsContent>

      {/* 指令库（原在指令页右侧工具面板）：点一条把指令填进浮动终端。 */}
      <TabsContent value="library" className="flex flex-col gap-3">
        <div className="h-[70vh] min-h-80">
          <CommandPickerPanel view="commands" dataset={dataset} onLoad={open} />
        </div>
      </TabsContent>
    </Tabs>
  )
}
