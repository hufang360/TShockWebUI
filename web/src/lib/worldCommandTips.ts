/**
 * 「小抄」页用的指令清单（**手工维护**）。
 *
 * 全部按 TShock 6.2.1 源码核实（`TShockAPI/Commands.cs`），这些指令都是 `allowServer=true`，
 * 所以能经 `/api/command`（rawcmd）执行；权限仍由 TShock 判定。
 *
 * | 指令 | 权限 | 参数来源 |
 * | --- | --- | --- |
 * | `/worldevent <事件>` | 按事件不同（`tshock.world.events` 或各事件节点） | `ManageWorldEvent()` 的 `switch` / `_validEvents` |
 * | `/worldevent invasion <类型>` | `tshock.world.events`（Invade） | `_validInvasions` |
 * | `/worldevent rain [slime\|coin]` | `tshock.world.events` | `Rain()` 的 `args.Parameters[1]` |
 * | `/forcehalloween`、`/forcexmas` | `tshock.world.sethalloween` / `setxmas` | 无参数，**再执行一次关闭** |
 * | `/worldmode <mode>` | `tshock.world.toggleexpert` | `_worldModes`（normal / expert / master / journey，creative 同 journey） |
 * | `/hardmode` | `tshock.world.hardmode` | 无参数，切换（`DisableHardmode` 时无法打开） |
 * | `/evil` | `tshock.world.switchevil` | 无参数，腐化 ⇄ 猩红切换 |
 * | `/time <…>` | `tshock.world.time.set` | `day / night / noon / midnight / hh:mm` |
 * | `/wind <mph>` | `tshock.world.wind` | -40 ~ 40 mph |
 * | `/worldinfo` | `tshock.world.info` | 无参数 |
 * | `/maxspawns [n\|default]` | `tshock.npc.maxspawns` | 无参数 = 查询；`default` = 5 |
 * | `/spawnrate [n\|default]` | `tshock.npc.spawnrate` | 无参数 = 查询；`default` = 600（越小刷得越快） |
 * | `/godmode [玩家]` | `tshock.godmode`（别人另需 `godmodeother`） | 无参数 = 自己 |
 */

export interface CommandTip {
  /** 点击后填进浮窗的**完整**指令（都是可执行的具体写法）。 */
  command: string
  label: { zh: string; en: string }
}

/** `/worldevent` 的事件（不含入侵，入侵见下）。 */
export const WORLD_EVENT_COMMANDS: CommandTip[] = [
  { command: '/worldevent meteor', label: { zh: '陨石', en: 'Meteorite' } },
  { command: '/worldevent fullmoon', label: { zh: '满月', en: 'Full moon' } },
  { command: '/worldevent bloodmoon', label: { zh: '血月', en: 'Blood moon' } },
  { command: '/worldevent eclipse', label: { zh: '日食', en: 'Solar eclipse' } },
  { command: '/worldevent sandstorm', label: { zh: '沙尘暴（再执行停止）', en: 'Sandstorm (toggle)' } },
  { command: '/worldevent rain', label: { zh: '下雨（再执行停止）', en: 'Rain (toggle)' } },
  { command: '/worldevent rain slime', label: { zh: '史莱姆雨（再执行停止）', en: 'Slime rain (toggle)' } },
  { command: '/worldevent rain coin', label: { zh: '金币雨（再执行停止）', en: 'Coin rain (toggle)' } },
  { command: '/worldevent lanternsnight', label: { zh: '灯笼夜', en: 'Lantern night' } },
  { command: '/worldevent meteorshower', label: { zh: '流星雨', en: 'Meteor shower' } },
]

/** `/worldevent invasion <类型>` 的二级参数。 */
export const WORLD_INVASION_COMMANDS: CommandTip[] = [
  { command: '/worldevent invasion goblins', label: { zh: '哥布林入侵', en: 'Goblin invasion' } },
  { command: '/worldevent invasion snowmen', label: { zh: '雪人军团', en: 'Frost legion' } },
  { command: '/worldevent invasion pirates', label: { zh: '海盗入侵', en: 'Pirate invasion' } },
  { command: '/worldevent invasion pumpkinmoon', label: { zh: '南瓜月', en: 'Pumpkin moon' } },
  { command: '/worldevent invasion frostmoon', label: { zh: '霜月', en: 'Frost moon' } },
  { command: '/worldevent invasion martians', label: { zh: '火星暴乱', en: 'Martian madness' } },
]

/** 节日模式：无参数，再执行一次关闭。 */
export const HOLIDAY_COMMANDS: CommandTip[] = [
  { command: '/forcehalloween', label: { zh: '万圣节模式（再执行关闭）', en: 'Halloween mode (toggle)' } },
  { command: '/forcexmas', label: { zh: '圣诞节模式（再执行关闭）', en: 'Christmas mode (toggle)' } },
]

/** 世界模式 / 困难模式 / 世界邪恶。 */
export const WORLD_MODE_COMMANDS: CommandTip[] = [
  { command: '/worldmode normal', label: { zh: '普通', en: 'Normal' } },
  { command: '/worldmode expert', label: { zh: '专家', en: 'Expert' } },
  { command: '/worldmode master', label: { zh: '大师', en: 'Master' } },
  { command: '/worldmode journey', label: { zh: '旅途（creative 同义）', en: 'Journey (creative alias)' } },
  { command: '/hardmode', label: { zh: '切换困难模式', en: 'Toggle hardmode' } },
  { command: '/evil', label: { zh: '切换腐化 / 猩红', en: 'Toggle corruption / crimson' } },
]

/** 时间 / 风 / 世界信息。 */
export const TIME_WIND_COMMANDS: CommandTip[] = [
  { command: '/time day', label: { zh: '白天', en: 'Day' } },
  { command: '/time night', label: { zh: '夜晚', en: 'Night' } },
  { command: '/time noon', label: { zh: '正午', en: 'Noon' } },
  { command: '/time midnight', label: { zh: '午夜', en: 'Midnight' } },
  { command: '/time 12:00', label: { zh: '指定时间（hh:mm）', en: 'Exact time (hh:mm)' } },
  { command: '/wind 20', label: { zh: '风 20 mph（范围 -40 ~ 40）', en: 'Wind 20 mph (range -40…40)' } },
  { command: '/wind 0', label: { zh: '无风', en: 'No wind' } },
  { command: '/wind -20', label: { zh: '反向风 20 mph', en: 'Reverse wind 20 mph' } },
  { command: '/worldinfo', label: { zh: '查看世界信息', en: 'World info' } },
]

/** 刷怪率（越大刷得越慢）。 */
export const SPAWN_RATE_COMMANDS: CommandTip[] = [
  { command: '/maxspawns', label: { zh: '查询刷怪上限', en: 'Show max spawns' } },
  { command: '/maxspawns 5', label: { zh: '上限设为 5', en: 'Set max spawns to 5' } },
  { command: '/maxspawns default', label: { zh: '恢复默认（5）', en: 'Reset to default (5)' } },
  { command: '/spawnrate', label: { zh: '查询刷怪率', en: 'Show spawn rate' } },
  { command: '/spawnrate 600', label: { zh: '刷怪率 600（越小越快）', en: 'Spawn rate 600 (lower = faster)' } },
  { command: '/spawnrate default', label: { zh: '恢复默认（600）', en: 'Reset to default (600)' } },
]

/**
 * 无敌模式：`/godmode` 切换**自己**；对别人用 `/godmode <玩家名>` 需要 `tshock.godmodeother`。
 */
export const GODMODE_COMMANDS: CommandTip[] = [
  { command: '/godmode', label: { zh: '切换自己无敌', en: 'Toggle godmode (self)' } },
]
