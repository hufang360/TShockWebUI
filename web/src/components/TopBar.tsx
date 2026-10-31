import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui'
import { useIsMobile } from '@/hooks/use-mobile'
import { useI18n } from '@/lib/i18n'

/**
 * 内容区顶栏的三个挂载点：
 * - **页面说明**（`<TopBarActions info=…>`）→ 面包屑右侧，始终在左侧；
 * - **页面操作**（`<TopBarActions>` 的 children）→ 顶栏右侧：上次刷新 / 刷新 / 管理卡片；
 * - **全局动作**（AppShell 的 `headerActions`，浮动指令）→ 桌面端排在页面操作之后；
 *   手机端连同页面操作一起收进 `…` 菜单。
 *
 * 挂载前不渲染（避免首帧闪到正文里）；没有 Provider 时（页面单测）原地渲染，方便断言。
 */
type SlotApi = {
  setSlot: (el: HTMLElement | null) => void
  setInfoSlot: (el: HTMLElement | null) => void
  register: (delta: number) => void
  registerInfo: (delta: number) => void
}

const SlotContext = createContext<HTMLElement | null>(null)
const InfoSlotContext = createContext<HTMLElement | null>(null)
const ApiContext = createContext<SlotApi | null>(null)
const CountContext = createContext({ actions: 0, info: 0 })

export function TopBarProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [infoSlot, setInfoSlot] = useState<HTMLElement | null>(null)
  const [counts, setCounts] = useState({ actions: 0, info: 0 })
  const register = useCallback(
    (delta: number) =>
      setCounts((prev) => ({ ...prev, actions: Math.max(0, prev.actions + delta) })),
    [],
  )
  const registerInfo = useCallback(
    (delta: number) => setCounts((prev) => ({ ...prev, info: Math.max(0, prev.info + delta) })),
    [],
  )
  const api = useMemo<SlotApi>(
    () => ({ setSlot, setInfoSlot, register, registerInfo }),
    [register, registerInfo],
  )
  return (
    <ApiContext.Provider value={api}>
      <CountContext.Provider value={counts}>
        <SlotContext.Provider value={slot}>
          <InfoSlotContext.Provider value={infoSlot}>{children}</InfoSlotContext.Provider>
        </SlotContext.Provider>
      </CountContext.Provider>
    </ApiContext.Provider>
  )
}

/** 面包屑右侧的「页面说明」插槽（只有页面提供了 info 才占位）。 */
export function TopBarInfoSlot() {
  const api = useContext(ApiContext)
  const { info } = useContext(CountContext)
  if (!api || info === 0) return null
  return <div ref={api.setInfoSlot} className="flex shrink-0 items-center" />
}

/** 顶栏右侧插槽：页面操作 + 全局动作（手机端合成 `…` 菜单）。 */
export function TopBarSlot({ extra }: { extra?: ReactNode }) {
  const api = useContext(ApiContext)
  const { actions } = useContext(CountContext)
  const isMobile = useIsMobile()
  const { t } = useI18n()

  if (!api) return null
  if (!isMobile) {
    return (
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <div ref={api.setSlot} className="flex min-w-0 items-center gap-2" />
        {extra}
      </div>
    )
  }
  if (actions === 0 && !extra) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('nav.moreActions')}
          title={t('nav.moreActions')}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-auto min-w-44 max-w-[calc(100vw-1rem)] rounded-control p-1"
      >
        <div
          className={
            'flex flex-col gap-0.5 [&_[data-action-label]]:inline ' +
            '[&_button]:h-8 [&_button]:w-full [&_button]:justify-start [&_button]:gap-2 ' +
            '[&_button]:rounded-control [&_button]:px-2 [&_button]:text-sm [&_button]:font-normal ' +
            '[&_svg]:size-4 [&_svg]:text-muted-foreground'
          }
        >
          <div ref={api.setSlot} className="flex flex-col gap-0.5" />
          {extra}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TopBarActions({ info, children }: { info?: ReactNode; children?: ReactNode }) {
  const slot = useContext(SlotContext)
  const infoSlot = useContext(InfoSlotContext)
  const api = useContext(ApiContext)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (!api) return
    if (children) api.register(1)
    if (info) api.registerInfo(1)
    return () => {
      if (children) api.register(-1)
      if (info) api.registerInfo(-1)
    }
    // children / info 只用于判断是否占用槽位；内容变化不需要重复登记。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, Boolean(children), Boolean(info)])

  if (!mounted) return null
  // 有 Provider（真实页面）时必须等插槽挂载；没有 Provider（页面单测）才原地渲染。
  if (!api) {
    return (
      <>
        {info}
        {children}
      </>
    )
  }
  return (
    <>
      {info && infoSlot ? createPortal(info, infoSlot) : null}
      {children && slot ? createPortal(children, slot) : null}
    </>
  )
}
