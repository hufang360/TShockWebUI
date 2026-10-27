/**
 * `.wld` 编辑的**纯逻辑**：草稿 ↔ 校验 ↔ 差异补丁（与 `plrEdit.ts` 对称）。
 *
 * 校验口径（见 `docs/计划-wld编辑.md` §4）：
 * - 世界名 1–20 字符（游戏建世界限制；footer 会逐字节比较，超长还会影响文件名/UI）；
 * - 出生点必须在世界范围内（否则游戏会把玩家丢到地表）；
 * - 时间 0–54000（4:30 起算）、月相 0–8、难度 0–3；
 * - 种子只在「字符串形态」（release ≥ 180）时可改，且不会重新生成地形。
 */
import type { WorldInfo, WorldTrack } from './worldFile'
import type { WorldEdits } from './worldWrite'

/** 世界名上限（游戏建世界时的限制）。 */
export const WORLD_NAME_MAX = 20

/** 编辑草稿：所有可编辑字段的目标值。 */
export interface WorldEditDraft {
  name: string
  seed: string
  gameMode: number
  spawnX: number
  spawnY: number
  time: number
  dayTime: boolean
  moonPhase: number
  bloodMoon: boolean
  eclipse: boolean
  hardmode: boolean
  /** Boss / 事件位（值为 `true` 表示已击败）。 */
  bosses: Record<string, boolean>
}

export interface WorldEditIssue {
  field: string
  messageKey: string
  vars?: Record<string, string | number>
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)
/** 按「字符」数（不是字节）算长度：中文名 20 个字符看着才合理。 */
const charLen = (s: string): number => Array.from(s).length

/** 从解析结果生成草稿。 */
export function draftFromWorld(info: WorldInfo, track: WorldTrack): WorldEditDraft {
  const bosses: Record<string, boolean> = {}
  for (const key of Object.keys(track.bosses)) bosses[key] = false
  for (const key of info.bossesDowned) bosses[key] = true
  return {
    name: info.name,
    seed: info.seed,
    gameMode: info.gameMode,
    spawnX: info.spawn.x,
    spawnY: info.spawn.y,
    time: info.time,
    dayTime: info.dayTime,
    moonPhase: info.moonPhase,
    bloodMoon: info.bloodMoon,
    eclipse: info.eclipse,
    hardmode: info.hardmode,
    bosses,
  }
}

/** 校验草稿；返回空数组 = 可以保存。 */
export function validateWorldDraft(
  draft: WorldEditDraft,
  ctx: { info: WorldInfo; track: WorldTrack },
): WorldEditIssue[] {
  const issues: WorldEditIssue[] = []
  const { info, track } = ctx

  // 世界名：**只在真的改名时校验**。
  // 存档里的名字可能是别的工具写的超长名字（游戏自己建世界限 20 字符，但不代表文件里一定 ≤ 20），
  // 这时若不改名，我们根本不会写这个名字，不该因此把「改难度 / 出生点」也一起拦掉。
  const name = draft.name.trim()
  const nameUnchanged = name === info.name.trim()
  if (!nameUnchanged) {
    if (name.length === 0) issues.push({ field: 'name', messageKey: 'wld.edit.err.nameEmpty' })
    else if (charLen(name) > WORLD_NAME_MAX) {
      issues.push({
        field: 'name',
        messageKey: 'wld.edit.err.nameTooLong',
        vars: { max: WORLD_NAME_MAX },
      })
    }
  }
  // 种子：只有字符串形态才能改
  if (!track.seed && draft.seed !== info.seed) {
    issues.push({ field: 'seed', messageKey: 'wld.edit.err.seedReadOnly' })
  }

  const num = (field: keyof WorldEditDraft, value: number, min: number, max: number) => {
    if (!isInt(value)) {
      issues.push({ field, messageKey: 'save.edit.err.int' })
      return
    }
    if (value < min || value > max) {
      issues.push({ field, messageKey: 'save.edit.err.range', vars: { min, max } })
    }
  }

  // release < 209 的存档里难度是 **bool**（只有普通 / 专家两种），写 2/3 会被静默降级成「专家」。
  num('gameMode', draft.gameMode, 0, track.gameModeIsInt === false ? 1 : 3)
  num('spawnX', draft.spawnX, 0, Math.max(0, info.width - 1))
  num('spawnY', draft.spawnY, 0, Math.max(0, info.height - 1))
  num('time', draft.time, 0, 53_999)
  num('moonPhase', draft.moonPhase, 0, 8)

  return issues
}

/** 草稿 → 只包含**真正变化**的补丁。 */
export function buildWorldEdits(
  info: WorldInfo,
  track: WorldTrack,
  draft: WorldEditDraft,
): WorldEdits {
  const edits: WorldEdits = {}

  // 两边都按 trim 后比较：存档里的世界名可能带首尾空格（TEdit 等工具写的），
  // 只 trim 写入端会造成「一进编辑态就报有未保存改动」，而且一保存就把名字里的空格吃掉。
  const name = draft.name.trim()
  if (name !== info.name.trim()) edits.name = name
  if (draft.seed !== info.seed && track.seed) edits.seed = draft.seed
  if (draft.gameMode !== info.gameMode) edits.gameMode = draft.gameMode
  if (draft.spawnX !== info.spawn.x || draft.spawnY !== info.spawn.y) {
    edits.spawn = { x: draft.spawnX, y: draft.spawnY }
  }
  if (draft.time !== info.time) edits.time = draft.time
  if (draft.dayTime !== info.dayTime) edits.dayTime = draft.dayTime
  if (draft.moonPhase !== info.moonPhase) edits.moonPhase = draft.moonPhase
  if (draft.bloodMoon !== info.bloodMoon) edits.bloodMoon = draft.bloodMoon
  if (draft.eclipse !== info.eclipse) edits.eclipse = draft.eclipse
  if (draft.hardmode !== info.hardmode) edits.hardmode = draft.hardmode

  const bosses: Record<string, boolean> = {}
  for (const [key, on] of Object.entries(draft.bosses)) {
    const was = info.bossesDowned.includes(key)
    if (on !== was) bosses[key] = on
  }
  if (Object.keys(bosses).length > 0) edits.bosses = bosses

  return edits
}

/** 草稿是否有改动（UI 的「有未保存改动」判断）。 */
export function isWorldDraftDirty(
  info: WorldInfo,
  track: WorldTrack,
  draft: WorldEditDraft,
): boolean {
  return Object.keys(buildWorldEdits(info, track, draft)).length > 0
}
