import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import type { Lang, ThemeName } from '@/types'

/** 主题循环顺序：点击按钮切到下一个状态。 */
const THEME_ORDER: ThemeName[] = ['auto', 'light', 'dark']
/** 每个主题状态的图标（自动 = 电脑 / 浅色 = 太阳 / 深色 = 月亮）。 */
const THEME_ICON = { auto: Monitor, light: Sun, dark: Moon } as const
const THEME_LABEL_KEY = {
  auto: 'settings.theme.auto',
  light: 'settings.theme.light',
  dark: 'settings.theme.dark',
} as const

interface QuickPreferencesProps {
  theme: ThemeName
  language: Lang
  onThemeChange: (theme: ThemeName) => void
  onLanguageChange: (language: Lang) => void
}

/**
 * 侧栏页头的语言 / 主题快捷切换：两个多状态图标按钮。
 *
 * - 主题：自动（电脑）→ 浅色（太阳）→ 深色（月亮），点击循环。
 * - 语言：中文 ↔ English，按钮显示当前语言代码。
 */
export function QuickPreferences({
  theme,
  language,
  onThemeChange,
  onLanguageChange,
}: QuickPreferencesProps) {
  const { t } = useI18n()
  const themeName = t(THEME_LABEL_KEY[theme])
  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]
  const ThemeIcon = THEME_ICON[theme]
  const languageName = t(`settings.language.${language}`)

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onThemeChange(nextTheme)}
        aria-label={t('settings.theme.toggle', { name: themeName })}
        title={t('settings.theme.toggle', { name: themeName })}
      >
        <ThemeIcon data-icon="inline-start" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-[10px] font-semibold"
        onClick={() => onLanguageChange(language === 'zh' ? 'en' : 'zh')}
        aria-label={t('settings.language.toggle', { name: languageName })}
        title={t('settings.language.toggle', { name: languageName })}
      >
        {language === 'zh' ? '中' : 'EN'}
      </Button>
    </>
  )
}
