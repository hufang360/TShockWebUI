import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'

/**
 * 可复制的指令块：**属性名在灰框外面**，下面每条指令各自一行（点整行或右侧图标都复制）。
 *
 * 多条指令共用一个属性名（如 Boss 召唤的完整写法 + 单字简写），这样不会出现两张只写了
 * 「（简写）」的卡片；一行一条也方便只复制其中一条。
 */
export function CommandLine({ label, commands }: { label: string; commands: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xs text-muted-foreground">{label}</span>
      <div className="flex flex-col gap-1">
        {commands.map((command) => (
          <CommandCopyRow key={command} command={command} />
        ))}
      </div>
    </div>
  )
}

function CommandCopyRow({ command }: { command: string }) {
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
    <button
      type="button"
      onClick={() => void copy()}
      title={command}
      aria-label={copied ? t('action.copied') : `${t('action.copy')} ${command}`}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 rounded-control bg-accent/40 px-2 py-2 text-left',
        'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{command}</code>
      <span className="shrink-0 text-muted-foreground">
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </span>
    </button>
  )
}
