import { useCallback, useRef, useState } from 'react'
import { inspectCommand, type CommandCheck } from '@/lib/commands'
import { useI18n } from '@/lib/i18n'
import { resultFromError, type BackendTransport } from '@/lib/tshock'
import type { CommandResult, Dataset, HistoryEntry } from '@/types'

type T = (key: string, vars?: Record<string, string | number>) => string

/** 把前置校验的拒绝原因翻成给玩家看的文案。 */
export function rejectedMessage(check: CommandCheck, t: T): string {
  if (check.reason === 'empty') return t('reason.empty')
  if (check.reason === 'unverified') return t('reason.unverified', { token: check.parsed?.token ?? '' })
  if (check.reason === 'in_game_only') {
    return t('reason.inGameOnly', { name: check.def?.name ?? check.parsed?.token ?? '' })
  }
  return check.message
}

export interface RunOutcome {
  /** 是否真的发起了执行（空输入 / 游戏内专用 / 未登录 / 并发时都是 false）。 */
  dispatched: boolean
  result?: CommandResult
}

export interface UseCommandRunnerOptions {
  dataset: Dataset
  transport: BackendTransport
  authenticated: boolean
  /** 信使插件是否允许 `allowServer=false` 的指令以在线玩家身份执行（Tier B）。 */
  ingameAllowed: boolean
  onTokenInvalid: () => Promise<boolean>
  /** 追加一条结果（被前置校验拒绝的也会追加，让玩家看到原因）。 */
  appendResult: (command: string, result: CommandResult) => void
  /** 追加一条历史（被拒绝的也记，便于回看当时为什么失败）。 */
  pushHistory: (entry: HistoryEntry) => void
}

/**
 * 指令执行的唯一入口（指令页 / 浮动终端共用）。
 *
 * 保持与改造前完全一致的流程：
 * 1. `inspectCommand` 前置校验（空输入 / `allowServer=false` 的 Tier A 拒绝）；
 * 2. 未登录 → 追加一条 `rejected`，不发请求；
 * 3. 正常执行；`token_invalid` 时弹登录框，登录成功后**重试一次**（上次并未真正执行）。
 *
 * 真正的权限判定始终在 TShock：这里只做纵深防御与结果归类。
 */
export function useCommandRunner({
  dataset,
  transport,
  authenticated,
  ingameAllowed,
  onTokenInvalid,
  appendResult,
  pushHistory,
}: UseCommandRunnerOptions): {
  running: boolean
  run: (text: string) => Promise<RunOutcome>
} {
  const { t } = useI18n()
  const [running, setRunning] = useState(false)
  // 并发保护用 ref：同一 tick 内的重复 Enter 也要挡住（state 尚未刷新）。
  const runningRef = useRef(false)

  const run = useCallback(
    async (text: string): Promise<RunOutcome> => {
      if (runningRef.current) return { dispatched: false }
      const inspected = inspectCommand(text, dataset)
      if (!inspected.parsed) {
        appendResult(inspected.normalized || '—', {
          status: 'rejected',
          output: [],
          message: t('reason.empty'),
        })
        return { dispatched: false }
      }
      if (inspected.executability === 'in_game_only' && !ingameAllowed) {
        appendResult(inspected.normalized, {
          status: 'rejected',
          output: [],
          message: rejectedMessage(inspected, t),
        })
        pushHistory({
          cmd: inspected.normalized,
          ts: Date.now(),
          ok: false,
          status: 'rejected',
        })
        return { dispatched: false }
      }
      if (!authenticated) {
        appendResult(inspected.normalized, {
          status: 'rejected',
          output: [],
          message: t('editor.notLoggedIn'),
        })
        return { dispatched: false }
      }
      runningRef.current = true
      setRunning(true)
      const runOnce = async (): Promise<CommandResult> => {
        try {
          // allowServer=false 的指令走插件「真实在线玩家」模式；其余走 rawcmd。
          return await transport.runCommand(
            inspected.normalized,
            inspected.executability === 'in_game_only',
          )
        } catch (err) {
          return resultFromError(err)
        }
      }
      try {
        let res = await runOnce()
        // token 失效（TShock 或 WebUI 容器重启）：弹出登录框，登录成功后自动重试一次。
        if (res.status === 'token_invalid') {
          const reauthed = await onTokenInvalid()
          if (reauthed) res = await runOnce()
        }
        appendResult(inspected.normalized, res)
        pushHistory({
          cmd: inspected.normalized,
          ts: Date.now(),
          ok: res.status === 'ok',
          status: res.status,
        })
        return { dispatched: true, result: res }
      } finally {
        runningRef.current = false
        setRunning(false)
      }
    },
    [
      dataset,
      authenticated,
      transport,
      onTokenInvalid,
      pushHistory,
      appendResult,
      t,
      ingameAllowed,
    ],
  )

  return { running, run }
}
