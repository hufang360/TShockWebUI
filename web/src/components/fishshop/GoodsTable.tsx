import { RichText } from '@/components/RichText'
import { GoodThumb } from '@/components/fishshop/GoodCells'
import { useI18n } from '@/lib/i18n'
import type { FishGood } from '@/lib/tshock'
import type { Dataset } from '@/types'

/**
 * 鱼店「表格视图」（页面设置里切换，与物品 ID 的表格视图同义的另一种看法）。
 *
 * 行不可点选中的按钮：整行 hover 高亮 + 键盘 Enter / 空格打开详情（与 `GoodCell` 的点击行为一致）。
 * 价格 / 备注里的 `[i:..]` 会渲染成图标；窄屏先收起「价格」，再收起「备注」，名称与编号始终可见。
 * 备注**单行截断**（`truncate` + `title` 看全文），一行一条商品，不会被长备注撑成两行。
 */
export function GoodsTable({
  rows,
  dataset,
  onSelect,
}: {
  rows: FishGood[]
  dataset: Dataset | null
  onSelect: (good: FishGood) => void
}) {
  const { t } = useI18n()
  return (
    <table className="w-full border-collapse text-left text-xs">
      <thead className="sticky top-[var(--page-sticky-top,0px)] z-10 bg-background/90 text-2xs text-muted-foreground backdrop-blur">
        <tr className="border-b border-border/60">
          <th scope="col" className="px-2 py-2 font-medium">
            {t('fish.col.serial')}
          </th>
          <th scope="col" className="px-2 py-2 font-medium">
            {t('fish.col.icon')}
          </th>
          <th scope="col" className="px-2 py-2 font-medium">
            {t('fish.col.name')}
          </th>
          <th scope="col" className="hidden px-2 py-2 font-medium sm:table-cell">
            {t('fish.col.cost')}
          </th>
          <th scope="col" className="hidden px-2 py-2 font-medium lg:table-cell">
            {t('fish.col.comment')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((good) => (
          <tr
            key={good.serial}
            tabIndex={0}
            onClick={() => onSelect(good)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onSelect(good)
            }}
            className="cursor-pointer border-b border-border/40 align-middle transition-colors hover:bg-accent/25 focus-visible:bg-accent/25 focus-visible:outline-none"
          >
            <td className="px-2 py-1.5 font-pixel text-2xs whitespace-nowrap text-muted-foreground">
              #{good.serial}
            </td>
            <td className="px-2 py-1.5">
              <GoodThumb good={good} dataset={dataset} size={24} />
            </td>
            <td className="px-2 py-1.5 text-foreground">{good.name}</td>
            <td className="hidden px-2 py-1.5 text-muted-foreground sm:table-cell">
              <RichText
                text={good.cost}
                itemsById={dataset?.itemsById}
                prefixesById={dataset?.prefixesById}
                atlas={dataset?.atlas}
              />
            </td>
            <td className="hidden px-2 py-1.5 text-muted-foreground lg:table-cell">
              {/* 单行截断（表格里长备注不换行、不撑高行高）；完整内容靠 `title` 悬停看。 */}
              <span
                className="block max-w-[22rem] truncate"
                title={good.comment || undefined}
              >
                <RichText
                  text={good.comment}
                  itemsById={dataset?.itemsById}
                  prefixesById={dataset?.prefixesById}
                  atlas={dataset?.atlas}
                />
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
