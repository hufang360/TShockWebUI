import type { ReactNode } from 'react'
import { CollapsibleCard } from '@/components/CollapsibleCard'
import {
  Field,
  FieldTitle,
  NativeSelect,
  NativeSelectOption,
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
}: PreferencesCardsProps) {
  const { t } = useI18n()
  return (
    <>
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

      <CollapsibleCard title={t('settings.execution')} bodyClassName="flex flex-col gap-0 pt-0">
        <SettingRow label={t('settings.commandInterval')}>
          <NativeSelect
            size="sm"
            value={settings.commandInterval}
            onChange={(e) => onChange({ commandInterval: Number(e.target.value) })}
            aria-label={t('settings.commandInterval')}
          >
            <NativeSelectOption value={0}>{t('settings.commandIntervalOff')}</NativeSelectOption>
            <NativeSelectOption value={1000}>
              {t('settings.commandIntervalSeconds', { n: 1 })}
            </NativeSelectOption>
            <NativeSelectOption value={2000}>
              {t('settings.commandIntervalSeconds', { n: 2 })}
            </NativeSelectOption>
            <NativeSelectOption value={5000}>
              {t('settings.commandIntervalSeconds', { n: 5 })}
            </NativeSelectOption>
          </NativeSelect>
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
            <NativeSelect
              size="sm"
              value={settings.eventsRefreshInterval}
              onChange={(e) => onChange({ eventsRefreshInterval: Number(e.target.value) })}
              aria-label={t('settings.eventsInterval')}
            >
              <NativeSelectOption value={60000} disabled={!canFastEvents}>
                {t('settings.refreshIntervalMinutes', { n: 1 })}
              </NativeSelectOption>
              <NativeSelectOption value={180000}>
                {t('settings.refreshIntervalMinutes', { n: 3 })}
              </NativeSelectOption>
              <NativeSelectOption value={300000}>
                {t('settings.refreshIntervalMinutes', { n: 5 })}
              </NativeSelectOption>
              <NativeSelectOption value={900000}>
                {t('settings.refreshIntervalMinutes', { n: 15 })}
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          {!canFastEvents && (
            <p className="text-xs leading-5 text-muted-foreground">
              {t('settings.eventsIntervalFastHint')}
            </p>
          )}
        </div>
        <Separator />
        <SettingRow label={t('settings.refreshInterval')}>
          <NativeSelect
            size="sm"
            value={settings.refreshInterval}
            onChange={(e) => onChange({ refreshInterval: Number(e.target.value) })}
            aria-label={t('settings.refreshInterval')}
          >
            <NativeSelectOption value={0}>{t('settings.refreshIntervalOff')}</NativeSelectOption>
            <NativeSelectOption value={60000}>
              {t('settings.refreshIntervalMinutes', { n: 1 })}
            </NativeSelectOption>
            <NativeSelectOption value={120000}>
              {t('settings.refreshIntervalMinutes', { n: 2 })}
            </NativeSelectOption>
            <NativeSelectOption value={300000}>
              {t('settings.refreshIntervalMinutes', { n: 5 })}
            </NativeSelectOption>
            <NativeSelectOption value={600000}>
              {t('settings.refreshIntervalMinutes', { n: 10 })}
            </NativeSelectOption>
          </NativeSelect>
        </SettingRow>
      </CollapsibleCard>
    </>
  )
}
