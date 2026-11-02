import { Info } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { HelpCard } from '@/components/HelpCard'
import { IconAction } from '@/components/IconAction'
import { TopBarActions } from '@/components/TopBar'
import { usePageHelp } from '@/hooks/usePageHelp'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/cn'

interface PageHelpProps {
  /** 记忆作用域（如 `tips` / `store` / `panel:world:`），每个页面各记各的。 */
  scopeId: string
  children: ReactNode
  /** 正文卡片外层类名（放在栅格里传 `col-span-full`，让它占满左右两栏上面一行）。 */
  className?: string
  /**
   * 强制展开（如本页卡片被全部隐藏）：此时说明卡片不可关闭 —— 否则页面会一片空白。
   */
  forceOpen?: boolean
}

/**
 * 「页面说明」：顶栏标题旁的 ⓘ + **内容区顶部**的说明卡片（占满左右两栏的上面一行）。
 *
 * - 首次进入自动展开；点 ✕ 关闭后按 scope 记在本机（`tswui:helpClosed`），之后只点 ⓘ 才出现；
 * - 标题固定「页面说明」——页面标题已经在顶栏面包屑里，这里不再重复；
 * - 说明正文来自各页面的 `page.*.desc`。
 */
export function PageHelp({ scopeId, children, className, forceOpen = false }: PageHelpProps) {
  const { t } = useI18n()
  const { closed, close } = usePageHelp(scopeId)
  const [open, setOpen] = useState(() => !closed)
  const shown = open || forceOpen

  return (
    <>
      <TopBarActions
        info={
          <IconAction
            label={t('home.pageInfo')}
            icon={Info}
            active={shown}
            onClick={() => setOpen((prev) => !prev)}
          />
        }
      />
      {shown && (
        <div className={cn('min-w-0', className)}>
          <HelpCard
            title={t('home.pageInfo')}
            onClose={
              forceOpen
                ? undefined
                : () => {
                    setOpen(false)
                    close()
                  }
            }
          >
            {children}
          </HelpCard>
        </div>
      )}
    </>
  )
}
