import { Card, CardBody, Checkbox, Input, Label, NativeSelect, NativeSelectOption } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { WORLD_NAME_MAX, type WorldEditDraft, type WorldEditIssue } from '@/lib/save/worldEdit'
import { WORLD_BOSS_KEYS, type WorldInfo, type WorldTrack } from '@/lib/save/worldFile'
import { bossKey, formatWorldClock, worldSizeKey } from '@/lib/worldPage'

interface WorldEditPanelProps {
  info: WorldInfo
  track: WorldTrack
  draft: WorldEditDraft
  issues: WorldEditIssue[]
  onChange: (next: WorldEditDraft) => void
}

/**
 * 「查看世界」的编辑态：世界名 / 种子 / 难度 / 出生点 / 时间 / 月相 / 困难模式 / Boss 进度。
 *
 * 纯受控组件：草稿与校验在 `lib/save/worldEdit.ts`，写回在 `lib/save/worldWrite.ts`。
 * （图格绘制不在这里 —— 见 `docs/计划-wld编辑.md` §3 C 级。）
 */
export function WorldEditPanel({ info, track, draft, issues, onChange }: WorldEditPanelProps) {
  const { t } = useI18n()

  const err = (field: string): string | null => {
    const issue = issues.find((i) => i.field === field)
    return issue ? t(issue.messageKey, issue.vars) : null
  }

  const num = (field: 'spawnX' | 'spawnY' | 'time' | 'moonPhase', label: string, hint?: string) => {
    const message = err(field)
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`wld-edit-${field}`}>{label}</Label>
        <Input
          id={`wld-edit-${field}`}
          type="number"
          value={String(draft[field])}
          aria-invalid={message ? true : undefined}
          onChange={(e) => onChange({ ...draft, [field]: Number(e.target.value) })}
        />
        {message ? (
          <p className="text-2xs text-destructive">{message}</p>
        ) : (
          hint && <p className="text-2xs text-muted-foreground tabular-nums">{hint}</p>
        )}
      </div>
    )
  }

  const nameIssue = err('name')
  const seedIssue = err('seed')

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-col gap-4 pt-4">
          <div className="grid gap-4 @[720px]:grid-cols-[repeat(2,minmax(0,1fr))]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wld-edit-name">{t('wld.name')}</Label>
              <Input
                id="wld-edit-name"
                value={draft.name}
                aria-invalid={nameIssue ? true : undefined}
                onChange={(e) => onChange({ ...draft, name: e.target.value })}
              />
              {nameIssue ? (
                <p className="text-2xs text-destructive">{nameIssue}</p>
              ) : (
                <p className="text-2xs text-muted-foreground">
                  {t('wld.edit.nameHint', { max: WORLD_NAME_MAX })}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wld-edit-seed">{t('wld.seed')}</Label>
              <Input
                id="wld-edit-seed"
                value={draft.seed}
                disabled={!track.seed}
                aria-invalid={seedIssue ? true : undefined}
                onChange={(e) => onChange({ ...draft, seed: e.target.value })}
              />
              {seedIssue ? (
                <p className="text-2xs text-destructive">{seedIssue}</p>
              ) : (
                <p className="text-2xs text-muted-foreground">
                  {track.seed ? t('wld.edit.seedHint') : t('wld.edit.seedReadOnly')}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wld-edit-mode">{t('wld.mode')}</Label>
              <NativeSelect
                id="wld-edit-mode"
                value={String(draft.gameMode)}
                onChange={(e) => onChange({ ...draft, gameMode: Number(e.target.value) })}
              >
                {/* release < 209 只有 bool（普通 / 专家）：大师 / 旅途在那种存档里存不下 */}
                {['classic', 'expert', 'master', 'journey']
                  .slice(0, track.gameModeIsInt === false ? 2 : 4)
                  .map((key, index) => (
                    <NativeSelectOption key={key} value={String(index)}>
                      {t(`wld.mode.${key}`)}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
              {err('gameMode') ? (
                <p className="text-2xs text-destructive">{err('gameMode')}</p>
              ) : (
                draft.gameMode !== info.gameMode &&
                draft.gameMode >= 1 && (
                  <p className="text-2xs text-destructive">{t('wld.edit.modeWarn')}</p>
                )
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wld-edit-moon">{t('wld.edit.moonPhase')}</Label>
              <NativeSelect
                id="wld-edit-moon"
                value={String(draft.moonPhase)}
                onChange={(e) => onChange({ ...draft, moonPhase: Number(e.target.value) })}
              >
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((phase) => (
                  <NativeSelectOption key={phase} value={String(phase)}>
                    {t('wld.edit.moonPhaseValue', { n: phase })}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {err('moonPhase') ? (
                <p className="text-2xs text-destructive">{err('moonPhase')}</p>
              ) : (
                <p className="text-2xs text-muted-foreground">{t('wld.edit.moonPhaseHint')}</p>
              )}
            </div>

            {num('spawnX', t('wld.edit.spawnX'), `0 – ${info.width - 1}`)}
            {num('spawnY', t('wld.edit.spawnY'), `0 – ${info.height - 1}`)}
            {num(
              'time',
              t('wld.edit.time'),
              `${formatWorldClock(draft.time)} · 0 – 53999`,
            )}

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t('wld.edit.flags')}</span>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                <label className="flex items-center gap-1.5">
                  <Checkbox
                    checked={draft.dayTime}
                    onCheckedChange={(next) => onChange({ ...draft, dayTime: next === true })}
                  />
                  {t('wld.edit.dayTime')}
                </label>
                <label className="flex items-center gap-1.5">
                  <Checkbox
                    checked={draft.bloodMoon}
                    onCheckedChange={(next) => onChange({ ...draft, bloodMoon: next === true })}
                  />
                  {t('wld.edit.bloodMoon')}
                </label>
                <label className="flex items-center gap-1.5">
                  <Checkbox
                    checked={draft.eclipse}
                    onCheckedChange={(next) => onChange({ ...draft, eclipse: next === true })}
                  />
                  {t('wld.edit.eclipse')}
                </label>
                <label
                  className="flex items-center gap-1.5"
                  title={t('wld.edit.hardmodeHint')}
                >
                  <Checkbox
                    checked={draft.hardmode}
                    onCheckedChange={(next) => onChange({ ...draft, hardmode: next === true })}
                  />
                  {t('wld.edit.hardmode')}
                </label>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3 pt-4">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium">{t('wld.edit.progress')}</span>
            <span className="text-2xs text-muted-foreground">{t('wld.edit.progressHint')}</span>
          </div>
          <div className="grid gap-x-4 gap-y-2 text-sm @[560px]:grid-cols-2 @[960px]:grid-cols-3">
            {WORLD_BOSS_KEYS.map((key) => {
              const label = t(`wld.boss.${bossKey(key, info.evil)}`)
              return (
                <label key={key} className="flex items-center gap-1.5">
                  <Checkbox
                    checked={draft.bosses[key] === true}
                    onCheckedChange={(next) =>
                      onChange({ ...draft, bosses: { ...draft.bosses, [key]: next === true } })
                    }
                  />
                  {label}
                </label>
              )
            })}
          </div>
        </CardBody>
      </Card>

      {/* 只读摘要：让人确认改的是哪个世界（尺寸 / 邪恶类型 / 存档版本）。 */}
      <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        <span className="tabular-nums">
          {info.width} × {info.height}
        </span>
        <span>·</span>
        <span>{t(`wld.size.${worldSizeKey(info.width)}`)}</span>
        <span>·</span>
        <span>{t(`wld.evil.${info.evil}`)}</span>
        <span>·</span>
        <span>{t('wld.version')} {info.release}</span>
        <span className="ml-auto">{t('wld.edit.readonlyNote')}</span>
      </div>
    </div>
  )
}
