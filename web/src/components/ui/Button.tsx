import type { ComponentProps, ReactNode } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  // 图标尺寸由组件统一处理：带显式 size-* 的保留（如图标按钮），其余兜底 size-4（shadcn 约定）
  // 图标按钮的尺寸只由 size 变体决定：调用点 className 不要再写 size-* / h-* / w-*。
  // 只写 base 会留下变体的 `md:size-*`（不同修饰符组，twMerge 不会消掉），结果是「手机小而桌面大」——正好反了。
  // 规范见 docs/计划-图标按钮规格.md §1.1。
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        sm: 'h-9 px-3 text-xs md:h-7',
        md: 'h-10 px-4 text-sm md:h-9',
        lg: 'h-11 px-5 text-base',
        // 三档图标按钮尺寸（手机放大触控目标，≥768px 回到桌面紧凑尺寸）
        'icon-xs': 'size-9 md:size-6', // 行内密集：结果卡角、表格单元格、tooltip 内
        'icon-sm': 'size-10 md:size-7', // 默认：顶栏、页头、工具条
        icon: 'size-10 md:size-9', // 主操作：输入条正圆发送键、分页箭头、Dialog ×
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps
  extends ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  children?: ReactNode
}

export function Button({
  variant,
  size,
  asChild = false,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
