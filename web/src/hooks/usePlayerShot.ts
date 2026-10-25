import { useCallback, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { downloadBlob, SHOT_GROUP_KEYS } from '@/lib/playerPage'
import { playerShotFilename, renderPlayerShot } from '@/lib/playerShot'
import type { PlayerLook } from '@/lib/tshock'
import type { Dataset } from '@/types'

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
            info: [
              `${t('players.hp')} ${target.health} / ${target.maxHealth}`,
              `${t('players.mp')} ${target.mana} / ${target.maxMana}`,
              `${t('players.quests')} ${Number(target.questsCompleted ?? 0)} ${t('players.questsUnit')}`,
              ...(target.spawnX >= 0
                ? [`${t('players.spawn')} ${target.spawnX}, ${target.spawnY}`]
                : []),
            ],
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
