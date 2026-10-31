import type { ReactNode } from 'react'
import { CollapsibleCard } from '@/components/CollapsibleCard'
import {
  Field,
  FieldTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Slider,
  Spinner,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import type { Lang, Settings } from '@/types'

/** 设置行：左标签 + 右侧控件。 */
export function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Field orientation="horizontal" className="flex-nowrap justify-between gap-3 py-2">
      <FieldTitle>{label}</FieldTitle>
      {children}
    </Field>
  )
}

interface PreferencesCardsProps {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  /** 仅 GM / superadmin / vip 可选 1 分钟刷新。 */
  canFastEvents: boolean
  /** 「统一执行」插件是否可用（null = 探测中）。 */
  batchPlugin: boolean | null
  batchMode: boolean
  onBatchModeChange: (on: boolean) => void
  /** 只渲染其中一组：设置页把「界面偏好」放左栏顶部，其余仍在右栏。 */
  section?: 'interface' | 'behavior' | 'all'
}

/**
 * 设置右列的「界面偏好」与「数据刷新」两张卡片（从 `SettingsPage` 抽出，见 docs/TODO.md U6）。
 * 纯受控：状态与持久化都在 `SettingsPage`。
 */
export function PreferencesCards({
  settings,
  onChange,
  canFastEvents,
  batchPlugin,
  batchMode,
  onBatchModeChange,
  section = 'all',
}: PreferencesCardsProps) {
  const { t } = useI18n()
  const showInterface = section !== 'behavior'
  const showBehavior = section !== 'interface'
  return (
    <>
      {showInterface && (
      <CollapsibleCard title={t('settings.heading')} bodyClassName="flex flex-col gap-0 pt-0">
        <SettingRow label={t('settings.fontSize')}>
          <div className="flex items-center gap-2">
            <Slider
              className="w-32"
              min={13}
              max={18}
              step={1}
              value={[settings.fontSize]}
              onValueChange={(v) => onChange({ fontSize: v[0] })}
              aria-label={t('settings.fontSize')}
            />
            <span className="w-5 text-right text-xs text-muted-foreground">
              {settings.fontSize}
            </span>
          </div>
        </SettingRow>
        <Separator />
        <SettingRow label={t('settings.compact')}>
          <Switch
            checked={settings.compact}
            onCheckedChange={(v) => onChange({ compact: v })}
            aria-label={t('settings.compact')}
          />
        </SettingRow>
        <Separator />
        <SettingRow label={t('settings.language')}>
          <ToggleGroup
            size="sm"
            value={settings.language}
            onValueChange={(v) => v && onChange({ language: v as Lang })}
            aria-label={t('settings.language')}
          >
            <ToggleGroupItem value="zh">中文</ToggleGroupItem>
            <ToggleGroupItem value="en">English</ToggleGroupItem>
          </ToggleGroup>
        </SettingRow>
        <Separator />
        <SettingRow label={t('settings.theme')}>
          <ToggleGroup
            size="sm"
            value={settings.theme}
            onValueChange={(v) => v && onChange({ theme: v as Settings['theme'] })}
            aria-label={t('settings.theme')}
          >
            <ToggleGroupItem value="auto">{t('settings.theme.auto')}</ToggleGroupItem>
            <ToggleGroupItem value="light">{t('settings.theme.light')}</ToggleGroupItem>
            <ToggleGroupItem value="dark">{t('settings.theme.dark')}</ToggleGroupItem>
          </ToggleGroup>
        </SettingRow>
      </CollapsibleCard>
      )}

      {showBehavior && (
      <>
      <CollapsibleCard title={t('settings.execution')} bodyClassName="flex flex-col gap-0 pt-0">
        <SettingRow label={t('settings.commandInterval')}>
          <Select
            value={String(settings.commandInterval)}
            onValueChange={(next) => onChange({ commandInterval: Number(next) })}
          >
            <SelectTrigger size="sm" className="min-w-28" aria-label={t('settings.commandInterval')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t('settings.commandIntervalOff')}</SelectItem>
              <SelectItem value="1000">
                {t('settings.commandIntervalSeconds', { n: 1 })}
              </SelectItem>
              <SelectItem value="2000">
                {t('settings.commandIntervalSeconds', { n: 2 })}
              </SelectItem>
              <SelectItem value="5000">
                {t('settings.commandIntervalSeconds', { n: 5 })}
              </SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <Separator />
        <Field
          orientation="horizontal"
          className="flex-nowrap items-center justify-between gap-3 py-2"
        >
          <div className="flex flex-col gap-0.5">
            <FieldTitle>{t('home.batch')}</FieldTitle>
            <p className="text-xs leading-4 text-muted-foreground">
              {batchPlugin === true ? t('home.batchHint') : t('home.batchUnavailable')}
            </p>
          </div>
          {batchPlugin === null ? (
            <Spinner className="text-muted-foreground" />
          ) : (
            <Switch
              checked={batchPlugin === true && batchMode}
              disabled={batchPlugin !== true}
              onCheckedChange={onBatchModeChange}
              aria-label={t('home.batch')}
            />
          )}
        </Field>
      </CollapsibleCard>

      <CollapsibleCard title={t('settings.dataRefresh')} bodyClassName="flex flex-col gap-0 pt-0">
        <div className="flex flex-col gap-1 py-2">
          <Field orientation="horizontal" className="flex-nowrap justify-between gap-3">
            <FieldTitle>{t('settings.eventsInterval')}</FieldTitle>
            <Select
              value={String(settings.eventsRefreshInterval)}
              onValueChange={(next) => onChange({ eventsRefreshInterval: Number(next) })}
            >
              <SelectTrigger size="sm" className="min-w-28" aria-label={t('settings.eventsInterval')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="60000" disabled={!canFastEvents}>
                  {t('settings.refreshIntervalMinutes', { n: 1 })}
                </SelectItem>
                <SelectItem value="180000">
                  {t('settings.refreshIntervalMinutes', { n: 3 })}
                </SelectItem>
                <SelectItem value="300000">
                  {t('settings.refreshIntervalMinutes', { n: 5 })}
                </SelectItem>
                <SelectItem value="900000">
                  {t('settings.refreshIntervalMinutes', { n: 15 })}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {!canFastEvents && (
            <p className="text-xs leading-5 text-muted-foreground">
              {t('settings.eventsIntervalFastHint')}
            </p>
          )}
        </div>
        <Separator />
        <SettingRow label={t('settings.refreshInterval')}>
          <Select
            value={String(settings.refreshInterval)}
            onValueChange={(next) => onChange({ refreshInterval: Number(next) })}
          >
            <SelectTrigger size="sm" className="min-w-28" aria-label={t('settings.refreshInterval')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t('settings.refreshIntervalOff')}</SelectItem>
              <SelectItem value="60000">
                {t('settings.refreshIntervalMinutes', { n: 1 })}
              </SelectItem>
              <SelectItem value="120000">
                {t('settings.refreshIntervalMinutes', { n: 2 })}
              </SelectItem>
              <SelectItem value="300000">
                {t('settings.refreshIntervalMinutes', { n: 5 })}
              </SelectItem>
              <SelectItem value="600000">
                {t('settings.refreshIntervalMinutes', { n: 10 })}
              </SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </CollapsibleCard>
      </>
      )}
    </>
  )
}
