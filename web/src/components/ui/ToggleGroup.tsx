import type { ComponentProps } from 'react'
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const toggleGroupVariants = cva('flex w-fit items-center gap-1 rounded-lg', {
  variants: {
    variant: {
      default: 'bg-accent p-1',
      outline: 'bg-transparent',
    },
    size: {
      sm: 'h-8',
      md: 'h-9',
    },
  },
  defaultVariants: { variant: 'default', size: 'md' },
})

const toggleGroupItemVariants = cva(
  'inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      size: {
        sm: 'h-6 px-2',
        md: 'h-7 px-2.5',
      },
    },
    defaultVariants: { size: 'md' },
  },
)

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
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      type={type}
      className={cn(toggleGroupVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export type ToggleGroupItemProps = ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleGroupItemVariants>

export function ToggleGroupItem({ className, size, ...props }: ToggleGroupItemProps) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-size={size}
      className={cn(toggleGroupItemVariants({ size }), className)}
      {...props}
    />
  )
}
