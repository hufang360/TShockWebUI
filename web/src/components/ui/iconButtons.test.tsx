import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'

/**
 * 图标按钮规格护栏（见 `docs/计划-图标按钮规格.md`）。
 *
 * 这些规则用「扫源码」而不是跑渲染来守，因为坏味道就写在 JSX 里：
 * `cn()` 是 twMerge，只写 base 的尺寸覆盖**不会**消掉变体带来的 `md:size-*`，
 * 结果是「手机小而桌面大」（正好和设计意图相反），而肉眼看代码完全看不出来。
 */

const SRC = resolve(process.cwd(), 'src')

/** 允许「手写图标按钮」的文件：每一条都必须说明为什么不能用 `IconAction`。 */
const BUTTON_ALLOWLIST = new Map<string, string>([
  ['components/IconAction.tsx', '实现本身'],
  ['components/command/EditorToolButton.tsx', 'IconAction 的输入条包装'],
  ['components/ui/Button.tsx', '尺寸变体的定义处'],
  ['components/ui/Sidebar.tsx', 'shadcn 原语（SidebarTrigger），保持与上游一致'],
  ['components/ui/Pagination.tsx', 'shadcn 原语（PaginationLink）'],
  ['components/CommandCard.tsx', '紧凑态是图标、常规态带文字，尺寸随内容切换'],
  ['components/QuickPreferences.tsx', '语言按钮是文字（中 / EN），不是图标'],
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (name.endsWith('.tsx') && !name.includes('.test.')) out.push(path)
  }
  return out
}

/** 从 `start` 处的 `<Tag` 起，取到标签结束的 `>`（跳过 `{}` 内的 `>`，如箭头函数）。 */
function startTag(text: string, start: number): string {
  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    else if (ch === '>' && depth === 0) return text.slice(start, i + 1)
  }
  return text.slice(start)
}

/** 只写 base 的尺寸工具类（`size-7` / `h-9` / `w-6`）——带 `md:` 等修饰符的不算。 */
const BARE_SIZE = /(?<![\w:-])(?:size|h|w)-\d+(?:\.\d+)?(?![\w-])/g

function bareSizeTokens(className: string): string[] {
  const hits: string[] = []
  for (const match of className.matchAll(BARE_SIZE)) {
    const before = className.slice(0, match.index).trimEnd()
    // 前一个词若以 `:` 结尾，说明这是 `md:size-7` 这类带修饰符的写法——安全。
    if (before.endsWith(':')) continue
    hits.push(match[0])
  }
  return hits
}

describe('图标按钮规格', () => {
  const files = walk(SRC).map((path) => ({
    rel: relative(SRC, path),
    text: readFileSync(path, 'utf8'),
  }))

  it('图标按钮不再用 className 覆盖尺寸（尺寸只由 size 变体决定）', () => {
    const offenders: string[] = []
    for (const { rel, text } of files) {
      for (const match of text.matchAll(/<Button\b/g)) {
        const tag = startTag(text, match.index)
        if (!/size="icon/.test(tag)) continue
        const className = /className=(?:"([^"]*)"|\{cn\(\s*([\s\S]*?)\)\})/.exec(tag)
        const cls = className?.[1] ?? className?.[2] ?? ''
        const bad = bareSizeTokens(cls)
        if (bad.length === 0) continue
        const line = text.slice(0, match.index).split('\n').length
        offenders.push(`${rel}:${line} → ${bad.join(' ')}`)
      }
    }
    expect(
      offenders,
      '图标按钮的尺寸请改用 size="icon-xs|icon-sm|icon"；只在需要恒定尺寸时成对写 md:',
    ).toEqual([])
  })

  it('图标按钮统一走 IconAction（灰阶 + Tooltip + aria-label）', () => {
    const offenders: string[] = []
    for (const { rel, text } of files) {
      if (BUTTON_ALLOWLIST.has(rel)) continue
      for (const match of text.matchAll(/<Button\b/g)) {
        const tag = startTag(text, match.index)
        if (!/size="icon/.test(tag)) continue
        // 手写"次要灰"＝IconAction 默认样式的复制粘贴。
        if (!/text-muted-foreground/.test(tag)) continue
        const line = text.slice(0, match.index).split('\n').length
        offenders.push(`${rel}:${line}`)
      }
    }
    expect(offenders, '改用 IconAction（label + icon，自带 Tooltip 与灰阶）').toEqual([])
  })

  it('图标按钮一律有可读名称（aria-label 或 sr-only 文本）', () => {
    const offenders: string[] = []
    for (const { rel, text } of files) {
      if (BUTTON_ALLOWLIST.has(rel)) continue
      for (const match of text.matchAll(/<Button\b/g)) {
        const tag = startTag(text, match.index)
        if (!/size="icon/.test(tag)) continue
        if (/aria-label=/.test(tag)) continue
        const line = text.slice(0, match.index).split('\n').length
        offenders.push(`${rel}:${line}`)
      }
    }
    expect(offenders, '纯图标按钮必须有 aria-label（IconAction 的 label 会生成）').toEqual([])
  })
})

describe('图标按钮尺寸阶梯', () => {
  /** 手机 <768px 放大触控目标，≥768px 回到桌面紧凑尺寸（见 DESIGN.md §Layout）。 */
  const LADDER = {
    'icon-xs': 'size-9 md:size-6',
    'icon-sm': 'size-10 md:size-7',
    icon: 'size-10 md:size-9',
  } as const

  it('三档尺寸：icon-xs 36/24、icon-sm 40/28、icon 40/36', () => {
    for (const [size, expected] of Object.entries(LADDER)) {
      render(<Button data-testid={`btn-${size}`} size={size as keyof typeof LADDER} />)
      expect(screen.getByTestId(`btn-${size}`).className).toContain(expected)
    }
  })

  it('只写 base 的尺寸覆盖留有 `md:size-*` 尾巴（这就是禁止覆盖的原因）', () => {
    // 反例固定成断言：`size="icon" + h-7 w-7` 桌面端仍是 36px，与设计意图相反。
    render(<Button data-testid="bad" size="icon" className="h-7 w-7" />)
    const className = screen.getByTestId('bad').className
    expect(className).toContain('h-7')
    expect(className).toContain('md:size-9')
  })
})
