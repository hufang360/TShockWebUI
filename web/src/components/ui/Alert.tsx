import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-x-3 gap-y-0.5 rounded-xl px-3.5 py-2.5 text-xs has-[>svg]:grid-cols-[auto_1fr] [&>svg]:size-4 [&>svg]:translate-y-0.5',
  {
    variants: {
      variant: {
        default: 'bg-accent text-foreground',
        muted: 'bg-accent/60 text-muted-foreground',
        destructive: 'bg-destructive/15 text-destructive',
        warning: 'bg-warning/15 text-warning',
        success: 'bg-success/15 text-success',
        info: 'bg-info/15 text-info',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface AlertProps
  extends ComponentProps<'div'>,
    VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        'col-start-2 min-h-4 font-medium tracking-tight',
        '[&_svg:not([class*="size-"])]:size-3.5',
        className,
      )}
      {...props}
    />
  )
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'col-start-2 grid justify-items-start gap-1 text-[11px] leading-4 text-current/80',
        '[&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  )
}
