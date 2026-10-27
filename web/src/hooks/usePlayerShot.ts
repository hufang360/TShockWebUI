import { useCallback, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import {
  downloadBlob,
  formatPlayTime,
  formatSaveTime,
  playerDifficultyKey,
  SHOT_GROUP_KEYS,
} from '@/lib/playerPage'
import { playerShotFilename, renderPlayerShot } from '@/lib/playerShot'
import type { PlayerLook } from '@/lib/tshock'
import type { Dataset } from '@/types'

/** 导出图片里的属性行：与页面 `PlayerInfoPanel` 同一套字段与顺序（本地存档多出几行）。 */
export function playerInfoLines(
  look: PlayerLook,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string[] {
  const playTime = formatPlayTime(look.playTimeTicks)
  const savedAt = formatSaveTime(look.lastSaved)
  const deaths = Number(look.deathsPve ?? 0) + Number(look.deathsPvp ?? 0)
  return [
    `${t('players.hp')} ${look.health} / ${look.maxHealth}`,
    `${t('players.mp')} ${look.mana} / ${look.maxMana}`,
    `${t('players.quests')} ${Number(look.questsCompleted ?? 0)} ${t('players.questsUnit')}`.trim(),
    ...(look.spawnX >= 0 ? [`${t('players.spawn')} ${look.spawnX}, ${look.spawnY}`] : []),
    ...(look.gameVersion ? [`${t('players.version')} ${look.gameVersion}`] : []),
    ...(look.difficulty != null
      ? [`${t('players.difficulty')} ${t(`players.difficulty.${playerDifficultyKey(look.difficulty)}`)}`]
      : []),
    ...(playTime ? [`${t('players.playTime')} ${playTime}`] : []),
    ...(look.golferScore != null ? [`${t('players.golf')} ${look.golferScore}`] : []),
    ...(deaths > 0 ? [`${t('players.deaths')} ${deaths}`] : []),
    ...(savedAt ? [`${t('players.lastSaved')} ${savedAt}`] : []),
    // 研究进度条数（本地存档才有）；重生点列表**不进图片**——条目数不定，图片只放固定行
    ...(look.researchedCount != null
      ? [`${t('players.research')} ${look.researchedCount} ${t('players.researchUnit')}`.trim()]
      : []),
  ]
}

/**
 * 「导出图片」：把角色（人物全身图 + 属性 + 背包 / 装备）画成 PNG。
 *
 * 「查看存档」与「玩家管理」两个页面共用：`playerShot` 是 canvas 合成（见 `lib/playerShot.ts`），
 * 不能直接截 DOM，所以逻辑只能放在这里，两边只负责渲染按钮。
 */
export function usePlayerShot(
  dataset: Dataset | null,
  onError: (message: string) => void,
): {
  /** 正在生成图片。 */
  shooting: boolean
  runShot: (target: PlayerLook, imported: boolean) => Promise<void>
} {
  const { t } = useI18n()
  const [shooting, setShooting] = useState(false)

  const runShot = useCallback(
    async (target: PlayerLook, imported: boolean) => {
      setShooting(true)
      try {
        const blob = await renderPlayerShot(
          target,
          {
            status: imported
              ? ''
              : target.online
                ? t('players.online')
                : t('players.offline'),
            info: playerInfoLines(target, t),
            groups: Object.fromEntries(SHOT_GROUP_KEYS.map((key) => [key, t(key)])),
            boostTitle: t('players.boost.title'),
          },
          dataset,
        )
        downloadBlob(blob, playerShotFilename(target.name))
      } catch {
        onError(t('players.shotFailed'))
      } finally {
        setShooting(false)
      }
    },
    [dataset, onError, t],
  )

  return { shooting, runShot }
}
