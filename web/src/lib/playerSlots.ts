/**
 * TShock `NetItem` 的槽位布局（TShockAPI/NetItem.cs，共 350 格，见 `HIDDEN_SLOTS`）。
 *
 * 展示参照游戏背包（`Terraria/Main.cs` 的 `DrawInventory` / `DrawTrashItemSlot`）：
 * - 背包主格 0–49（10×5）；钱币 50–53、弹药 54–57 各一列，放在主格**右侧**；
 * - 垃圾桶（TShock 槽 179）放在背包主格**右下角**（游戏坐标在主格最后一列正下方）；
 * - 装备区是 5 个竖列，从左到右：染料 / 时装 / 装备 / 杂项染料 / 杂项装备；
 *   数据下标见下面各分组的 `start`（`armor` 前 10 是装备、后 10 是时装）。
 * - 随身仓储（猪猪 / 保险箱 / 熔炉 / 虚空袋）单独一列（页面右列）。
 *
 * 槽 58 不展示：那是游戏里 `inventory[58]`（鼠标手持的临时槽），TShock 会一并带在
 * `inventory` 串里，但没有 UI 意义。
 */
export interface SlotGroup {
  key: string
  start: number
  count: number
  cols: number
  /** 结果区第几列（1 = 左/角色，2 = 右/随身仓储）。 */
  column: 1 | 2
}

/** 不展示的槽位：游戏里 `inventory[58]` 是鼠标手持的临时槽（`Main.mouseItem`）。 */
export const HIDDEN_SLOTS: number[] = [58]

export const PLAYER_SLOT_GROUPS: SlotGroup[] = [
  // 背包主格（10×5）+ 钱币 / 弹药列 + 垃圾桶（右下角）
  { key: 'players.group.inventory', start: 0, count: 50, cols: 10, column: 1 },
  { key: 'players.group.coins', start: 50, count: 4, cols: 1, column: 1 },
  { key: 'players.group.ammo', start: 54, count: 4, cols: 1, column: 1 },
  { key: 'players.group.trash', start: 179, count: 1, cols: 1, column: 1 },
  // 装备区 5 个竖列（左 → 右）
  { key: 'players.group.dye', start: 79, count: 10, cols: 1, column: 1 },
  { key: 'players.group.vanity', start: 69, count: 10, cols: 1, column: 1 },
  { key: 'players.group.armor', start: 59, count: 10, cols: 1, column: 1 },
  { key: 'players.group.miscDye', start: 94, count: 5, cols: 1, column: 1 },
  { key: 'players.group.miscEquip', start: 89, count: 5, cols: 1, column: 1 },
  // 三套配装
  { key: 'players.group.loadout1', start: 260, count: 30, cols: 15, column: 1 },
  { key: 'players.group.loadout2', start: 290, count: 30, cols: 15, column: 1 },
  { key: 'players.group.loadout3', start: 320, count: 30, cols: 15, column: 1 },
  // 随身仓储（页面右列）
  { key: 'players.group.piggy', start: 99, count: 40, cols: 10, column: 2 },
  { key: 'players.group.safe', start: 139, count: 40, cols: 10, column: 2 },
  { key: 'players.group.forge', start: 180, count: 40, cols: 10, column: 2 },
  { key: 'players.group.void', start: 220, count: 40, cols: 10, column: 2 },
]

/** 装备区两组：A组（右）染料 / 时装 / 装备；B组（左）杂项染料 / 杂项装备。 */
export const EQUIP_GROUP_A = [
  'players.group.dye',
  'players.group.vanity',
  'players.group.armor',
] as const

export const EQUIP_GROUP_B = ['players.group.miscDye', 'players.group.miscEquip'] as const

/** 配装分组 key（按顺序）。 */
export const LOADOUT_KEYS = [
  'players.group.loadout1',
  'players.group.loadout2',
  'players.group.loadout3',
] as const

export function findGroup(key: string): SlotGroup {
  const g = PLAYER_SLOT_GROUPS.find((x) => x.key === key)
  if (!g) throw new Error(`未知槽位分组：${key}`)
  return g
}

/** 银行区标题前的物品图标（ItemIcon 的物品 id）。 */
export const GROUP_ICON_IDS: Record<string, number> = {
  'players.group.piggy': 87, // 猪猪储钱罐
  'players.group.safe': 346, // 保险箱
  'players.group.forge': 3813, // 护卫熔炉
  'players.group.void': 4131, // 虚空袋
}

/** 配装区单个配装的一列（每个配装 30 格 = 装备 10 + 时装 10 + 染料 10）。 */
export interface LoadoutColumn {
  key: string
  start: number
  count: number
}

export function loadoutColumns(start: number): LoadoutColumn[] {
  // 展示顺序参照装备区 A 组：染料 / 时装 / 装备。
  return [
    { key: 'players.group.dye', start: start + 20, count: 10 },
    { key: 'players.group.vanity', start: start + 10, count: 10 },
    { key: 'players.group.armor', start, count: 10 },
  ]
}
