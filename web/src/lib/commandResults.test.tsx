import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CommandStatus } from '@/types'
import { CommandResultsProvider, useCommandResults } from './commandResults'

/** 极简消费者：显示某张卡的结果 + 一个写入按钮。 */
function Probe({ id, status = 'ok' }: { id: string; status?: CommandStatus }) {
  const { results, setResult } = useCommandResults()
  const result = results[id]
  return (
    <div>
      <span data-testid="output">{result?.output.join('|') ?? 'none'}</span>
      <span data-testid="status">{result?.status ?? 'none'}</span>
      <span data-testid="ts">{result?.ts ? 'has-ts' : 'no-ts'}</span>
      <button
        type="button"
        onClick={() => setResult(id, { status, output: ['第一行', '第二行'] })}
      >
        run
      </button>
    </div>
  )
}

function renderWith(serverId: string, id = 'home:who', status?: CommandStatus) {
  return render(
    <CommandResultsProvider serverId={serverId}>
      <Probe id={id} status={status} />
    </CommandResultsProvider>,
  )
}

const stored = () => JSON.parse(window.localStorage.getItem('tswui:cardResults') ?? '{}')

beforeEach(() => {
  window.localStorage.clear()
})

describe('卡片结果存储（落盘）', () => {
  it('写入后落到 tswui:cardResults，重新挂载（= 刷新浏览器）能读回来', () => {
    const first = renderWith('main')
    fireEvent.click(screen.getByRole('button', { name: 'run' }))
    expect(screen.getByTestId('output').textContent).toBe('第一行|第二行')
    // 统一打上完成时间（卡片左下角「执行于 …」用）
    expect(screen.getByTestId('ts').textContent).toBe('has-ts')
    expect(stored().main['home:who'].status).toBe('ok')
    first.unmount()

    renderWith('main')
    expect(screen.getByTestId('output').textContent).toBe('第一行|第二行')
    expect(screen.getByTestId('ts').textContent).toBe('has-ts')
  })

  it('按服务器分开：换了上游不会看到上一台服务器的结果', () => {
    const main = renderWith('main')
    fireEvent.click(screen.getByRole('button', { name: 'run' }))
    main.unmount()

    renderWith('other')
    expect(screen.getByTestId('output').textContent).toBe('none')
  })

  it('「指令不存在」不落盘：内存里拿去判定插件缺失，但刷新后不再弹陈年错误', () => {
    const first = renderWith('main', 'home:world', 'command_not_found')
    fireEvent.click(screen.getByRole('button', { name: 'run' }))
    expect(screen.getByTestId('status').textContent).toBe('command_not_found')
    expect(stored().main).toBeUndefined()
    first.unmount()

    renderWith('main', 'home:world')
    expect(screen.getByTestId('status').textContent).toBe('none')
  })

  it('本机数据脏了也不炸：非法状态 / 形状直接丢掉', () => {
    window.localStorage.setItem(
      'tswui:cardResults',
      JSON.stringify({
        main: {
          'home:who': { status: 'ok', output: ['合法', 3], ts: 1 },
          'home:bad': { status: 'nope', output: [] },
          'home:junk': 'not-an-object',
        },
        other: 'not-an-object',
      }),
    )
    renderWith('main')
    // 只保留合法的行；未知状态 / 非对象条目被丢掉（不是渲染崩溃）。
    expect(screen.getByTestId('output').textContent).toBe('合法')
  })
})
