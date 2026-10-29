import type { Lang } from '@/lib/i18n'

/** 界面语言 → Intl locale。时间 / 数字一律跟界面语言走，不跟操作系统语言走。 */
const LOCALE: Record<Lang, string> = { zh: 'zh-CN', en: 'en-US' }

export function localeOf(lang: Lang): string {
  return LOCALE[lang] ?? LOCALE.zh
}

/**
 * 时钟：中文界面用 24 小时制（不带 AM/PM），英文界面用当地习惯。
 *
 * 之前各处直接 `new Date().toLocaleTimeString()`：格式取决于**浏览器/系统**语言，
 * 于是中文界面会出现「10:29:04 AM」，装了中文系统的英文用户又会看到「下午10:29」。
 */
export function formatClock(lang: Lang, date: Date | number): string {
  return new Date(date).toLocaleTimeString(localeOf(lang), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/** 时钟 + 日期（用于 title 悬浮提示）。 */
export function formatClockWithDate(lang: Lang, date: Date | number): string {
  return new Date(date).toLocaleString(localeOf(lang))
}
