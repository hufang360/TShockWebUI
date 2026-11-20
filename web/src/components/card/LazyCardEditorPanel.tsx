import { lazy, Suspense } from 'react'
import type { CardEditorPanelProps } from './CardEditorPanel'

// 只有点「添加卡片」/ 参数卡片的 ✎ 时才需要：不占首屏兜底。
const CardEditorPanel = lazy(() =>
  import('./CardEditorPanel').then((m) => ({ default: m.CardEditorPanel })),
)

/** `CardEditorPanel` 的按需加载外壳（抽屉里展开时才拉 chunk）。 */
export function LazyCardEditorPanel(props: CardEditorPanelProps) {
  return (
    <Suspense fallback={null}>
      <CardEditorPanel {...props} />
    </Suspense>
  )
}
