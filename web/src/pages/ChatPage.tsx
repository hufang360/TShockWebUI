import { useRef, useState } from 'react'
import { ItemPickerPopover } from '@/components/ItemPickerPopover'
import { RecipeFavoritesPopover } from '@/components/RecipeFavoritesPopover'
import { LoginGate } from '@/components/LoginGate'
import { TerminalTopBarButton } from '@/components/TerminalTopBarButton'
import { ServerFeedTab } from '@/components/ServerFeed'
import { WebChatInput } from '@/components/WebChatInput'
import { CardBody } from '@/components/ui'
import { useItemFavoritesState } from '@/hooks/useItemFavoritesState'
import { useLocalState } from '@/hooks/useLocalState'
import { usePageHeight } from '@/hooks/usePageHeight'
import { StorageKeys } from '@/lib/storage'
import type { BackendTransport } from '@/lib/tshock'
import type { Dataset } from '@/types'

interface ChatPageProps {
  dataset: Dataset
  transport: BackendTransport
  authenticated: boolean
  /** 当前 TShock 上游 id；换服后要重新拉取事件流。 */
  serverId: string
  /** 事件流刷新间隔（毫秒）。 */
  refreshInterval: number
  /** token 失效时被调用；返回 Promise，登录成功 resolve(true)，取消 resolve(false)。 */
  onTokenInvalid: () => Promise<boolean>
  /** 未登录时点「登录」打开登录框。 */
  onLogin: () => void
}

/**
 * 聊天页（`#/chat`，侧栏紧跟「指令」下一行）。
 *
 * 服务器动态（`ServerFeedTab`）+ 贴底的网页发言框：与「指令」页共用同一套工作区骨架
 * （`usePageHeight` 只用来拿一屏高当 `min-height`、整页滚动、输入框 `sticky bottom-0`）。
 */
export function ChatPage({
  dataset,
  transport,
  authenticated,
  serverId,
  refreshInterval,
  onTokenInvalid,
  onLogin,
}: ChatPageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const fillHeight = usePageHeight(rootRef, authenticated)
  // 草稿存本机：切到别的页面再回来，没发出去的内容还在。
  const [text, setText] = useLocalState<string>(StorageKeys.chatDraft, '')
  // 发言成功后让事件流立刻刷新，自己发的话马上上屏。
  const [refreshToken, setRefreshToken] = useState(0)
  // 筛选 chips + 世界状态徽标那一行挂在**输入框正上方**（贴近列表底部）。
  const [filterSlot, setFilterSlot] = useState<HTMLElement | null>(null)
  // 「回到底部」浮按钮的宿主（吸底区域上方浮着，不撑高布局）。
  const [jumpSlot, setJumpSlot] = useState<HTMLElement | null>(null)
  // 刷新一簇（上次刷新 + 刷新按钮）的宿主：输入框发送按钮左边。
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null)
  // 插入物品标签后把光标交回输入框（`WebChatInput` 的 focusRequest）。
  const [focusToken, setFocusToken] = useState(0)
  // 物品弹框里「搜索为空时」展示的收藏（与图鉴 / 指令页共用同一份本机数据）。
  const { list: itemFavorites } = useItemFavoritesState()
  /** 物品弹框选中 → 把 `[i:ID]` 追加到输入框末尾，并把光标交回输入框。 */
  const appendItemTag = (tag: string) => {
    setText(`${text}${tag}`)
    setFocusToken((n) => n + 1)
  }
  /**
   * 合成表收藏里点一条 → 把带 `[i:ID]` 标签的记录填进输入框（`[i:11] x3 @ [i:17] → [i:22]`）。
   * 前面有内容时先补一个空格，别和上一段粘在一起。
   */
  const appendRecipeText = (snippet: string) => {
    setText((prev) => `${prev}${prev && !/\s$/.test(prev) ? ' ' : ''}${snippet}`)
    setFocusToken((n) => n + 1)
  }

  return (
    <div
      ref={rootRef}
      data-testid="chat-workspace"
      className="flex min-h-[360px] min-w-0 flex-col gap-1"
      // `minHeight` 而不是 `height`：内容少时刚好一屏（输入框贴底），内容多时由页面滚动——
      // 这样滚动条是 AppShell 主内容区（浏览器右侧）那条，而不是嵌在聊天列表里。
      style={fillHeight ? { minHeight: fillHeight } : undefined}
    >
      {!authenticated ? (
        <LoginGate onLogin={onLogin} />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 不包 Card：列表直接铺在工作区上，省下卡片边框与内边距的高度。
              pageScroll 下**不要** `min-h-0` / `overflow-hidden`：内容多时要把页面撑高、交给 `<main>` 滚。 */}
          <CardBody className="flex flex-1 flex-col pb-0">
            <ServerFeedTab
              transport={transport}
              authenticated={authenticated}
              serverId={serverId}
              refreshInterval={refreshInterval}
              refreshToken={refreshToken}
              onTokenInvalid={onTokenInvalid}
              itemsById={dataset.itemsById}
              prefixesById={dataset.prefixesById}
              atlas={dataset.atlas}
              filtersSlot={filterSlot}
              jumpSlot={jumpSlot}
              actionsSlot={actionsSlot}
              pageScroll
            />
          </CardBody>
          {/* 吸底：列表（页面）往上滚，这一块钉在视口底部；`-mb-2` 抵消 AppShell 的 `p-2`，
              滚到最底时不会突然多出 8px 空隙。 */}
          <div className="sticky bottom-0 z-10 -mb-2 flex flex-col gap-1.5 bg-background pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] relative">
            <div
              ref={setJumpSlot}
              className="pointer-events-none absolute inset-x-0 -top-10 flex justify-center"
            />
            <div ref={setFilterSlot} className="flex flex-col gap-1 empty:hidden" />
            <WebChatInput
              transport={transport}
              value={text}
              onValueChange={setText}
              onSent={() => setRefreshToken((n) => n + 1)}
              focusRequest={focusToken}
              slashToFocus
              // 输入框左下角：物品（搜物品 / 收藏，追加 [i:ID]）+ 合成表（收藏过的记录，点一条填带标签的文本）。
              leadingActions={
                <>
                  <ItemPickerPopover
                    dataset={dataset}
                    favorites={itemFavorites}
                    onPick={appendItemTag}
                  />
                  <RecipeFavoritesPopover dataset={dataset} onPick={appendRecipeText} />
                </>
              }
              // 发送按钮左边：上次刷新 + 刷新 + 终端入口（顶栏那套在这页就撤掉了）。
              actions={
                <>
                  <div ref={setActionsSlot} className="flex items-center gap-1 empty:hidden" />
                  <TerminalTopBarButton visible />
                </>
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}
