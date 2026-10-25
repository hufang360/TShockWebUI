import { useCallback, useMemo } from 'react'
import { inspectCommand } from '@/lib/commands'
import { computeCompletions, paramHintFor, type CompletionItem } from '@/lib/completion'
import type { Dataset, Lang } from '@/types'

/**
 * 指令编辑器需要的三样派生数据：前端执行策略 + 补全 + 参数提示。
 *
 * 「指令」页与浮动终端共用这一份实现，避免两边对同一条指令给出不同的可执行性判断
 * 或不同的补全候选（`allowServer=false` 的红色提示也必须一致）。
 */
export function useCommandEditing({
  dataset,
  text,
  players,
  language,
  runtimeValues,
}: {
  dataset: Dataset
  text: string
  players: string[]
  language: Lang
  runtimeValues?: { regions?: string[]; warps?: string[] }
}) {
  const check = useMemo(() => inspectCommand(text, dataset), [text, dataset])

  const getCompletions = useCallback(
    (value: string, caret: number): CompletionItem[] =>
      computeCompletions({
        dataset,
        text: value,
        caret,
        players,
        lang: language,
        runtimeValues,
      }),
    [dataset, players, language, runtimeValues],
  )

  // 当前参数的用法串（TShock 源码原文），显示在编辑器上方。
  const getParamHint = useCallback(
    (value: string, caret: number) => paramHintFor(dataset, value, caret, language),
    [dataset, language],
  )

  return { check, getCompletions, getParamHint }
}
