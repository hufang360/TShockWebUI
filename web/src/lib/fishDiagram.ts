import type { FishGood } from '@/lib/tshock'

/**
 * 建造类商品的**注解图**（`web/public/fishshop/diagram-*.png`：站哪个位置、往下/往上几格、左右误差多少）。
 *
 * **靠指令判断，不看商品名**：服主可以随便改商品名（「挖个坑」「建池子」），
 * 但 `cmds` 里的指令是商品真正的行为。`cmds` 由鱼店插件 `/fishshop/list|ask` 返回
 * （插件侧字段说明见 `TShockFishShop/docs/REST-API.md`，本仓库 `docs/插件-鱼店.md` §9.1）。
 *
 * 指令来源：`TShockWorldModify`（`/igen` 与 `/wm` 是同一个插件的两个入口）与 `TShockClipboard`（`/clip`）。
 */
const BASE = import.meta.env.BASE_URL

const DIAGRAMS = {
  /** `/igen pond [water/lava/honey/shimmer]`：以脚下为中心向下挖 16×26 的池子（各种液体共用一张图）。 */
  pond: `${BASE}fishshop/diagram-pond.png`,
  /** `/igen room [数量]`：以你为中心向上建 3 间玻璃小房间。 */
  room: `${BASE}fishshop/diagram-room.png`,
  /** `/igen shed`：小房间 + 鱼池（材料随生态）。 */
  shed: `${BASE}fishshop/diagram-shed.png`,
  /** `/clip paste spawnerfarm foot`：粘贴保存好的刷怪场（关键字认 `spawnerfarm`）。 */
  spawnerfarm: `${BASE}fishshop/diagram-spawnerfarm.png`,
} as const

export type FishDiagramKind = keyof typeof DIAGRAMS

/**
 * 商品 → 建造类型。命中一条就够；判断顺序有意义：
 *
 * 1. `spawnerfarm`：认关键字（`/clip paste spawnerfarm`、`/clip check spawnerfarm` 都算），先判它，
 *    别让「先备份再粘贴」这类组合指令里的别的词抢走；
 * 2. `shed` → `room` → `pond`：`/igen` / `/wm` 后面跟同名子指令才算，
 *    所以 `/igen pond water` 命中 pond，而 `/igen shed` 里有 `/igen` 但子指令是 shed，不会误判成 room。
 */
const RULES: { kind: FishDiagramKind; pattern: RegExp }[] = [
  { kind: 'spawnerfarm', pattern: /spawnerfarm/i },
  // `/igen room`、`/wm room`（`igen` 是 `wm` 的别名，两个都认）；`\b` 保证 room 后面是空格或结尾
  { kind: 'shed', pattern: /(?:^|\s)\/(?:igen|wm)\s+shed\b/i },
  { kind: 'room', pattern: /(?:^|\s)\/(?:igen|wm)\s+room\b/i },
  // pond 认 `/igen pond water|lava|honey|shimmer|main|full` 以及不带液体参数的写法
  { kind: 'pond', pattern: /(?:^|\s)\/(?:igen|wm)\s+pond\b/i },
]

/** 一组指令里是否含有 `pattern`（每条单独匹配，避免跨指令拼出来的假命中）。 */
function commandsMatch(cmds: readonly string[] | undefined, pattern: RegExp): boolean {
  return (cmds ?? []).some((cmd) => typeof cmd === 'string' && pattern.test(cmd))
}

/** 指令 → 建造类型；没有 `cmds`（旧插件 / 原版物品）或都对不上就返回 `null`。 */
export function diagramKind(good: FishGood | null | undefined): FishDiagramKind | null {
  const cmds = good?.cmds
  if (!cmds || cmds.length === 0) return null
  for (const rule of RULES) {
    if (commandsMatch(cmds, rule.pattern)) return rule.kind
  }
  return null
}

/** 商品对应的注解图 URL；不需要 / 对不上时返回 `null`（详情里就不出现图片块）。 */
export function diagramUrl(good: FishGood | null | undefined): string | null {
  const kind = diagramKind(good)
  return kind ? DIAGRAMS[kind] : null
}
