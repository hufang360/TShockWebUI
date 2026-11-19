import { createContext, useContext, type ComponentProps } from 'react'
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const toggleGroupVariants = cva('flex w-fit items-center gap-1 rounded-menu', {
  variants: {
    variant: {
      default: 'bg-accent p-1',
      outline: 'bg-transparent',
      // 幽灵（ghost）：没有灰色容器垫底，按钮直接铺在页面底色上；高度交给按钮自己。
      ghost: 'h-auto gap-1 bg-transparent p-0',
    },
    size: {
      sm: 'h-8',
      md: 'h-9',
    },
  },
  defaultVariants: { variant: 'default', size: 'md' },
})

const toggleGroupItemVariants = cva(
  'inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-control text-xs font-medium whitespace-nowrap transition-colors text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        // 灰色容器内的分段按钮：选中 = 卡片色 + 投影（像一颗被按下的胶囊）
        default:
          'data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:shadow-sm',
        // 幽灵按钮：高亮用 `bg-foreground/10`。`bg-card` 在页面底色上（白 / 深底）几乎看不出选中，
        // 而 `foreground/10` 在两种主题下都读得出来（与 `Toggle` 同一套理由）。
        ghost:
          'hover:bg-foreground/5 data-[state=on]:bg-foreground/10 data-[state=on]:font-semibold data-[state=on]:text-foreground',
      },
      size: {
        sm: 'h-6 px-2',
        md: 'h-7 px-3',
        // 只有图标的方形按钮，尺寸阶梯与 `Button` 的 `icon-*` 一致（手机放大触控目标）；
        // `flex-none`：方形按钮不该被 `flex-1` 拉宽。
        'icon-xs': 'size-9 flex-none px-0 md:size-6',
        'icon-sm': 'size-10 flex-none px-0 md:size-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
)

type ToggleGroupItemVariant = NonNullable<VariantProps<typeof toggleGroupItemVariants>['variant']>

/** 变体让条目继承：Radix 不会把 `variant` 透传给条目，逐个手写容易漏一个。
 *  根上的 `outline` 只改容器（不垫灰底），条目照旧用 `default` 的选中样式。 */
const ToggleGroupVariantContext = createContext<ToggleGroupItemVariant>('default')

export type ToggleGroupProps = Omit<ToggleGroupPrimitive.ToggleGroupSingleProps, 'type'> &
  VariantProps<typeof toggleGroupVariants> & { type?: 'single' }

export function ToggleGroup({
  className,
  variant,
  size,
  type = 'single',
  ...props
}: ToggleGroupProps) {
  return (
    <ToggleGroupVariantContext.Provider value={variant === 'ghost' ? 'ghost' : 'default'}>
      <ToggleGroupPrimitive.Root
        data-slot="toggle-group"
        data-variant={variant}
        data-size={size}
        type={type}
        className={cn(toggleGroupVariants({ variant, size }), className)}
        {...props}
      />
    </ToggleGroupVariantContext.Provider>
  )
}

export type ToggleGroupItemProps = ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleGroupItemVariants>

export function ToggleGroupItem({ className, size, variant, ...props }: ToggleGroupItemProps) {
  const inherited = useContext(ToggleGroupVariantContext)
  const resolved = variant ?? inherited
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-size={size}
      data-variant={resolved}
      className={cn(toggleGroupItemVariants({ size, variant: resolved }), className)}
      {...props}
    />
  )
}
