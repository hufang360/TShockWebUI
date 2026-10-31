import { useState } from 'react'
import { ChevronsUpDown, LogIn, LogOut, Server, UserRound } from 'lucide-react'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { ServerSwitcherDialog } from '@/components/ServerSwitcher'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { useSelfAvatar } from '@/lib/selfAvatar'
import type { ServerTarget } from '@/lib/servers'
import type { BackendTransport, ServerInfo } from '@/lib/tshock'

interface SidebarAccountMenuProps {
  /** 当前上游 id（用于取「自己」的外观缓存）。 */
  serverId: string
  /** 展示用的服务器地址（已遮挡；不再出现「服务器默认」文案）。 */
  serverLabel: string
  serverOnline: boolean
  username: string | null
  mock: boolean
  servers: ServerTarget[]
  activeId: string
  info: ServerInfo
  /** 用于「切换服务器」弹框逐行探测连通性。 */
  transport: BackendTransport
  onSelectServer: (id: string) => void
  onAddServer: (target: ServerTarget) => void
  onEditServer: (oldId: string, target: ServerTarget) => void
  onRemoveServer: (id: string) => void
  onLogin: () => void
  onLogout: () => void
}

/**
 * 侧栏底部账号卡片（NavUser 风格）：头像 + 用户名 + 服务器地址 + 展开箭头。
 * 点击展开菜单：切换服务器 / 登录·退出。
 * 头像联动「玩家管理」——查到当前登录账号本人时用其全身图。
 */
export function SidebarAccountMenu({
  serverId,
  serverLabel,
  serverOnline,
  username,
  mock,
  servers,
  activeId,
  info,
  transport,
  onSelectServer,
  onAddServer,
  onEditServer,
  onRemoveServer,
  onLogin,
  onLogout,
}: SidebarAccountMenuProps) {
  const { t } = useI18n()
  const [serverOpen, setServerOpen] = useState(false)
  const look = useSelfAvatar(serverId)
  const loggedIn = Boolean(username)

  const avatar = look ? (
    <span className="grid h-10 w-8 shrink-0 place-items-center overflow-hidden rounded-control bg-sidebar-accent">
      <PlayerAvatar look={look} scale={1} fill className="[image-rendering:pixelated]" />
    </span>
  ) : (
    <span className="grid size-9 shrink-0 place-items-center rounded-control bg-primary/15 text-muted-foreground">
      <UserRound className="size-4" />
    </span>
  )

  return (
    <>
      {/* 未登录：账号卡片上方放一条登录按钮，一点即开登录框（无需再进菜单）。 */}
      {!loggedIn && (
        <Button variant="primary" size="sm" className="w-full" onClick={onLogin}>
          <LogIn data-icon="inline-start" />
          {t('action.login')}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('account.menu')}
            className="flex w-full cursor-pointer items-center gap-2 rounded-control px-2 py-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent"
          >
            {avatar}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs text-foreground">
                  {username ?? t('account.notLoggedIn')}
                </span>
                {mock && <Badge tone="mock">Mock</Badge>}
              </span>
              <span className="mt-0.5 flex min-w-0 items-center gap-2 text-2xs text-muted-foreground">
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    serverOnline ? 'bg-success' : 'bg-destructive',
                  )}
                />
                <span className="truncate">{serverLabel}</span>
              </span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-60">
          {/* 菜单项 / 标签一律包在 DropdownMenuGroup 里（composition 规则）。 */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center gap-2">
              {avatar}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-semibold">
                  {username ?? t('account.notLoggedIn')}
                </span>
                <span className="truncate text-2xs font-normal text-muted-foreground">
                  {serverLabel}
                </span>
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setServerOpen(true)}>
              <Server />
              {t('servers.switch')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {username ? (
              <DropdownMenuItem variant="danger" onSelect={onLogout}>
                <LogOut />
                {t('action.logout')}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={onLogin}>
                <LogIn />
                {t('action.login')}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <ServerSwitcherDialog
        open={serverOpen}
        onOpenChange={setServerOpen}
        servers={servers}
        activeId={activeId}
        info={info}
        transport={transport}
        onSelect={onSelectServer}
        onAdd={onAddServer}
        onEdit={onEditServer}
        onRemove={onRemoveServer}
      />
    </>
  )
}
