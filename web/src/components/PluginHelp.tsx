import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { useI18n } from '@/lib/i18n'

interface PluginHelpProps {
  /** 插件中文名（可带一句括号介绍）。 */
  plugin: string
  /** 插件英文名 / 程序集名，如 `WorldModify`。 */
  en: string
  /** 可选的一句话说明（渲染成「说明：…」）。 */
  note?: string
  /** 项目主页；给了就在插件名后面加一个 `↗`，新窗口打开。 */
  href?: string
  /** 正文（多行文本，用 `\n` 分段）。 */
  children: ReactNode
}

/**
 * 「页面说明」里的插件信息块：插件名称（+ 项目主页 ↗）/ 英文名称 / 说明，然后是正文。
 *
 * 名称与链接都从文案里拆出来，链接只挂在一个 `ExternalLink` 图标上，不把长 URL 铺在正文里。
 */
export function PluginHelp({ plugin, en, note, href, children }: PluginHelpProps) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <p className="flex flex-wrap items-center gap-x-1.5">
          <span>
            {t('pluginHelp.name')}
            {plugin}
          </span>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              title={t('pluginHelp.open')}
              aria-label={t('pluginHelp.open')}
              className="inline-flex items-center text-info transition-colors hover:text-info/80"
            >
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          )}
        </p>
        <p>
          {t('pluginHelp.en')}
          {en}
        </p>
        {note && (
          <p>
            {t('pluginHelp.note')}
            {note}
          </p>
        )}
      </div>
      <div className="whitespace-pre-line">{children}</div>
    </div>
  )
}
