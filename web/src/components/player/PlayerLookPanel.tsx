import { PlayerAvatar } from '@/components/PlayerAvatar'
import {
  BackpackCluster,
  EquipCluster,
  Group,
  LoadoutBlock,
  PlayerInfoPanel,
  sliceGroup,
} from '@/components/player/PlayerLookView'
import { Badge, Separator } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { GROUP_ICON_IDS, LOADOUT_KEYS, PLAYER_SLOT_GROUPS } from '@/lib/playerSlots'
import type { PlayerLook } from '@/lib/tshock'

/**
 * 一个角色存档的只读视图：**人物全身图 + 属性 + 背包 / 装备 / 银行 / 配装**。
 *
 * 「玩家存档」（本地 .plr）与「玩家管理」（TShock `/pm/look`）共用同一套展示，
 * 只是数据来源不同；页面级动作（导出图片 / 简约视图）放在顶栏，不放这里。
 */
export function PlayerLookPanel({
  look,
  imported,
  compact,
  collapsed,
  onToggleCollapse,
}: {
  look: PlayerLook
  /** 数据来自本地 .plr（不显示在线 / 离线徽章）。 */
  imported: boolean
  /** 简约视图：隐藏银行与配装。 */
  compact: boolean
  collapsed: Record<string, boolean>
  onToggleCollapse: (key: string) => void
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-4">
      {/* 角色总览：**左侧全身图 + 右侧属性**作为一组，占内容区一半宽度；窄屏整行。 */}
      <div className="flex w-full items-start gap-5 @[820px]:w-1/2">
        {/* 角色全身图：只画皮肤 / 衣服 / 头发（不含盔甲饰品）。 */}
        <PlayerAvatar look={look} />
        {/* 属性区：左边留出间隔，名字加大、与属性行拉开，整体高度与人物接近。 */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 pt-2 pl-2">
          <div className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {look.name}
            {!imported && (
              <Badge tone={look.online ? 'success' : 'neutral'}>
                {look.online ? t('players.online') : t('players.offline')}
              </Badge>
            )}
          </div>
          <PlayerInfoPanel look={look} />
        </div>
      </div>

      <Separator />

      {/* 左右两组（用容器查询，`@container` 在 AppShell 内容区，兼顾侧栏/compact）：
          左组 = 背包（含钱币/弹药）+ 下方仓储（银行）；
          右组 = 装备区（杂项 + 染料/时装/装备）与配装泡在同一行，**配装在右侧**。
          内容够宽才并排；窄屏则左组在上、右组在下。 */}
      <div className="grid items-start gap-x-8 gap-y-6 @[1150px]:grid-cols-[auto_auto]">
        {/* 左组 */}
        <div className="flex flex-col gap-5">
          <BackpackCluster look={look} />
          {/* 银行：放到背包下方（精简视图下隐藏） */}
          {!compact && (
            <div className="flex flex-col gap-4">
              {PLAYER_SLOT_GROUPS.filter((g) => g.column === 2).map((group) => (
                <Group
                  key={group.key}
                  group={group}
                  items={sliceGroup(look, group)}
                  titleIconId={GROUP_ICON_IDS[group.key]}
                  open={!collapsed[group.key]}
                  onToggle={() => onToggleCollapse(group.key)}
                />
              ))}
            </div>
          )}
        </div>
        {/* 右组：装备区 + 配装（配装在右，排在同一行；精简视图下隐藏配装） */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-5">
          <EquipCluster look={look} />
          {!compact && (
            <div className="flex flex-wrap items-start gap-x-2 gap-y-5">
              {LOADOUT_KEYS.map((key) => (
                <LoadoutBlock
                  key={key}
                  look={look}
                  groupKey={key}
                  open={!collapsed[key]}
                  onToggle={() => onToggleCollapse(key)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
