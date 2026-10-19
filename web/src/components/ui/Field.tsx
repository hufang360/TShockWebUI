import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Label } from './Label'
import { cn } from '@/lib/utils'

/* ── 表单布局原语（shadcn/ui Field）───────────────────────────────
 * 约定：表单一律用 FieldGroup + Field（含 FieldLabel / FieldDescription），
 * 不再用裸 div + label + gap-*。校验态：Field 上加 `data-invalid`，
 * 控件上加 `aria-invalid`；禁用态：Field 上加 `data-disabled`，控件上加 `disabled`。 */

export function FieldGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-group"
      className={cn('group/field-group flex w-full flex-col gap-3', className)}
      {...props}
    />
  )
}

export function FieldSet({ className, ...props }: ComponentProps<'fieldset'>) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn('flex flex-col gap-3', className)}
      {...props}
    />
  )
}

export function FieldLegend({
  className,
  variant = 'legend',
  ...props
}: ComponentProps<'legend'> & { variant?: 'legend' | 'label' }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        'mb-2 font-medium',
        variant === 'legend' ? 'text-sm' : 'text-xs text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

const fieldVariants = cva('group/field flex w-full gap-1.5 data-[invalid=true]:text-destructive', {
  variants: {
    orientation: {
      vertical: 'flex-col *:w-full',
      horizontal: 'flex-row flex-wrap items-center',
      responsive: 'flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center',
    },
  },
  defaultVariants: { orientation: 'vertical' },
})

export interface FieldProps
  extends ComponentProps<'div'>,
    VariantProps<typeof fieldVariants> {}

export function Field({ className, orientation = 'vertical', ...props }: FieldProps) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  )
}

export function FieldLabel({ className, ...props }: ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn('group-data-[disabled=true]/field:opacity-50', className)}
      {...props}
    />
  )
}

export function FieldDescription({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn('text-2xs leading-4 text-muted-foreground', className)}
      {...props}
    />
  )
}

export function FieldTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-title"
      className={cn('flex items-center gap-2 text-xs font-medium text-foreground', className)}
      {...props}
    />
  )
}
