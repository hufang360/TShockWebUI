import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui'
import { useI18n } from '@/lib/i18n'

/**
 * 一条可复制的指令：**第一行是标签，第二行是指令 + 复制按钮**（数据 ID 的召唤指令、物品给予指令共用）。
 */
export function CommandLine({ label, command }: { label: string; command: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-accent/40 px-2 py-1.5">
      <span className="text-2xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1">
        <code
          className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
          title={command}
        >
          {command}
        </code>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => void copy()}
          aria-label={copied ? t('action.copied') : t('action.copy')}
          title={copied ? t('action.copied') : t('action.copy')}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  )
}
