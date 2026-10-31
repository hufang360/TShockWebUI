import { useLocalState } from '@/hooks/useLocalState'
import { useI18n } from '@/lib/i18n'
import { StorageKeys } from '@/lib/storage'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui'
import { GifFramesWorkspace } from '@/components/sprite/GifFramesWorkspace'
import { MergeWorkspace } from '@/components/sprite/MergeWorkspace'
import { SplitWorkspace } from '@/components/sprite/SplitWorkspace'

type SliceTab = 'split' | 'merge' | 'gif'

const TABS: SliceTab[] = ['split', 'merge', 'gif']

/**
 * 「精灵图」（`#/slice`）—— 公开本地工具，三个 tab：
 * - **分割**：PNG 精灵表按行列 / 框选切开，命名微调后导出单张、ZIP 或 GIF 动画；
 * - **合并**：多张 PNG 拼成一张精灵图；
 * - **GIF**：把一张 GIF 按帧拆成 PNG。
 *
 * 都不读 TShock、不需要登录与权限，**文件不上传**（`lib/spriteSheet/`）。入口恒在侧边栏「工具」分组。
 */
export function SpriteSheetPage() {
  const { t } = useI18n()
  const [stored, setTab] = useLocalState<SliceTab>(StorageKeys.spriteSheetTab, 'split')
  const tab: SliceTab = TABS.includes(stored) ? stored : 'split'

  return (
    <div className="flex flex-col gap-3">
      {/* 左上角 tab（与「数据ID」同款下划线样式） */}
      <Tabs value={tab} onValueChange={(value) => setTab(value as SliceTab)}>
        <TabsList aria-label={t('slice.tabs')} variant="line" className="w-full justify-start">
          <TabsTrigger value="split" variant="line" className="flex-none">
            {t('slice.tab.split')}
          </TabsTrigger>
          <TabsTrigger value="merge" variant="line" className="flex-none">
            {t('slice.tab.merge')}
          </TabsTrigger>
          <TabsTrigger value="gif" variant="line" className="flex-none">
            {t('slice.tab.gif')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* 三个 tab 都常驻挂载（用 hidden 切换），切回来时图片 / 帧序列还在。 */}
      <div className={tab === 'split' ? 'contents' : 'hidden'}>
        <SplitWorkspace />
      </div>
      <div className={tab === 'merge' ? 'contents' : 'hidden'}>
        <MergeWorkspace />
      </div>
      <div className={tab === 'gif' ? 'contents' : 'hidden'}>
        <GifFramesWorkspace />
      </div>
    </div>
  )
}
