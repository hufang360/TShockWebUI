import { useId, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** 多行文本输入（shadcn/ui Textarea 结构；与 Input 使用同一套底色 / 聚焦环）。 */
export function Textarea({ className, id, name, ...props }: ComponentProps<'textarea'>) {
  const generatedId = useId()
  const textareaId = id ?? generatedId
  return (
    <textarea
      id={textareaId}
      name={name ?? textareaId}
      data-slot="textarea"
      className={cn(
        'min-h-20 w-full resize-y rounded-control bg-accent px-3 py-2 text-sm text-foreground',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
