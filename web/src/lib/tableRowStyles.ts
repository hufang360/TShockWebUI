/**
 * 数据表格的行样式（指令小抄 / 常用表格共用）。
 *
 * 放在这里而不是各页面各写一份：两张表的行手感（悬停、斑马纹）必须完全一致。
 */
export const DATA_ROW_CLASS =
  'group/row cursor-pointer border-t border-border/40 align-top transition-colors hover:bg-accent/25'

/** 数据行斑马纹（非数据行不计数、也不上色）。 */
export const dataRowStripe = (index: number) => (index % 2 === 1 ? 'bg-muted/25' : '')
