import type { ReactNode } from 'react'
import {
  Activity,
  Backpack,
  Clock,
  Crown,
  Globe2,
  History,
  Server,
  Signpost,
  Skull,
  Swords,
  Terminal,
  Users,
} from 'lucide-react'
import type { BuiltinCardId } from '@/lib/homeCards'

/**
 * 首页「会自动执行、可获取数据」的内置指令卡片定义（从 `HomePage` 抽出，见 docs/TODO.md U6）。
 * 仅数据 + 图标，不含状态；`cmd` 按当前用户名生成要执行的指令（返回 null 表示缺必要信息）。
 */
export type CommandCardId = Extract<
  BuiltinCardId,
  'online' | 'time' | 'world' | 'bossinfo' | 'bossdamage' | 'alldeath' | 'lookbag'
>

export interface CommandCardDef {
  id: CommandCardId
  icon: ReactNode
  /** 按当前用户名生成要执行的指令；返回 null 表示缺必要信息（如未登录）。 */
  cmd: (username: string | null) => string | null
  /** 卡片底部备注（可选）。 */
  noteKey?: string
}

export const COMMAND_CARDS: CommandCardDef[] = [
  { id: 'online', icon: <Users />, cmd: () => '/who' },
  { id: 'time', icon: <Clock />, cmd: () => '/time' },
  { id: 'world', icon: <Globe2 />, cmd: () => '/worldinfo' },
  { id: 'bossinfo', icon: <Crown />, cmd: () => '/bossinfo' },
  { id: 'bossdamage', icon: <Swords />, cmd: () => '/bossdamage' },
  { id: 'alldeath', icon: <Skull />, cmd: () => '/alldeath', noteKey: 'home.alldeathNote' },
  {
    id: 'lookbag',
    icon: <Backpack />,
    // /lookbag 需要一个玩家名；「我的背包」用当前登录用户名。
    cmd: (username) => (username ? `/lookbag ${username}` : null),
  },
]

export const COMMAND_CARD_BY_ID = new Map(COMMAND_CARDS.map((c) => [c.id, c]))

/**
 * 每张首页卡片在「管理卡片」列表里显示的小图标 —— 与页面上那张卡的页头图标保持一致
 * （概览卡用它们 `HomeOverviewCards` 里的图标，指令卡用 `COMMAND_CARDS` 的图标）。
 */
const OVERVIEW_CARD_ICONS: Partial<Record<BuiltinCardId, ReactNode>> = {
  server: <Server />,
  events: <Activity />,
  recent: <History />,
  quick: <Signpost />,
}

export function homeCardIcon(id: string): ReactNode {
  const command = COMMAND_CARD_BY_ID.get(id as CommandCardId)
  if (command) return command.icon
  return OVERVIEW_CARD_ICONS[id as BuiltinCardId] ?? <Terminal />
}
