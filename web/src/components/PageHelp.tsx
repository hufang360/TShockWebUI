import { Info } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { HelpCard } from '@/components/HelpCard'
import { IconAction } from '@/components/IconAction'
import { TopBarActions } from '@/components/TopBar'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/cn'

interface PageHelpProps {
  children: ReactNode
  /** 正文卡片外层类名（放在栅格里传 `col-span-full`，让它占满左右两栏上面一行）。 */
  className?: string
  /**
   * 强制展开（如本页卡片被全部隐藏）：此时说明卡片不可关闭，也不显示 ⓘ —— 否则页面会一片空白。
   */
  forceOpen?: boolean
}

/**
 * 「页面说明」：顶栏标题旁的 ⓘ + **内容区顶部**的说明卡片（占满左右两栏的上面一行）。
 *
 * - **默认收起**，点 ⓘ 才展开；开关不记忆，每次进页面都是收起状态；
 * - 标题固定「页面说明」——页面标题已经在顶栏面包屑里，这里不再重复；
 * - 说明正文来自各页面的 `page.*.desc`。
 */
export function PageHelp({ children, className, forceOpen = false }: PageHelpProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const shown = open || forceOpen

  return (
    <>
      {!forceOpen && (
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
      )}
      {shown && (
        <div className={cn('min-w-0', className)}>
          <HelpCard
            title={t('home.pageInfo')}
            onClose={forceOpen ? undefined : () => setOpen(false)}
          >
            {children}
          </HelpCard>
        </div>
      )}
    </>
  )
}
